import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { loadFenelModule } from "./fenel-module";
import { evaluate, type EvaluateContext } from "./json-logic";
import { Just, Nothing } from "./type-foundation";
import { stdNatives } from "../../../../fenel/modules/std/ffi/std-ffi";
import type { FenelFunction } from "./types";

// Extends ledgered C1: actual ingress/helper source bodies with inert state
// and action boundaries. No registry, live IO, grant or replay guarantee.
const root = resolve(import.meta.dir, "../../../..");
const functions = new Map<string, FenelFunction>();
for (const [path, name] of [
  ["fenel/modules/email-webhooks/ingress.fenel", "emailWebhooks"],
  ["fenel/modules/webhooks/calendly.fenel", "webhooks"],
  ["fenel/modules/webhooks/stripe.fenel", "webhooks"],
  ["fenel/modules/events/ingress.fenel", "events"],
]) {
  const module = loadFenelModule(readFileSync(resolve(root, path!), "utf8"), name!,
    { bootstrapParser: "typescript" });
  for (const fn of module.functions ?? []) {
    functions.set(fn.id, fn);
    functions.set(fn.id.replace(":", "."), fn);
    functions.set(fn.id.slice(fn.id.indexOf(":") + 1), fn);
  }
}

type ObservedCall = { action: string; args: unknown[] };
const nothing = Nothing;
const delivered = { $tag: "Delivered", id: { $tag: "Id", _0: "message-one" }, at: 0 };
const recipient = Just({ local: "alice", domain: "example.invalid", displayName: nothing });
const maybeEvent = Just(delivered);
const emailPayload = { event: delivered, messageId: "message-one" };

function probe(fresh: boolean) {
  const calls: ObservedCall[] = [];
  const observe = (action: string, result?: unknown) => (...args: unknown[]) => {
    calls.push({ action, args });
    return result;
  };
  const context: EvaluateContext = {
    getFunction: name => functions.get(name),
    natives: Object.assign(Object.create(null), stdNatives, {
      markWebhookProcessed: observe("claim", fresh),
      appendEvent: observe("append"),
      dispatchEventTriggers: observe("trigger"),
      autoSuppressIfBadEvent: observe("suppress"),
      dispatchAction: observe("action"),
    }),
    _constructors: { Just: ["_0"], Nothing: [] },
  };
  return {
    calls,
    call(name: string, ...args: unknown[]): unknown {
      const fn = functions.get(name);
      if (!fn || fn.body === undefined) throw new Error(`Missing source webhook body: ${name}`);
      return evaluate(fn.body,
        Object.fromEntries(fn.params.map((param, i) => [param.name, args[i]])), context);
    },
  };
}

describe("email ingress selects its effectful branch after the dedup claim", () => {
  for (const provider of ["mailgun", "postmark", "resend", "ses"]) {
    test(`${provider}: a duplicate lifecycle event performs no append, trigger or suppression`, () => {
      const run = probe(false);
      expect(run.call("handleEmailEvent", provider, "event-one", maybeEvent, recipient, "unmapped"))
        .toEqual({ ok: true, deduped: true });
      expect(run.calls).toEqual([{ action: "claim", args: [provider, "event-one"] }]);
    });

    test(`${provider}: a fresh lifecycle event performs the existing ordered tail once`, () => {
      const run = probe(true);
      expect(run.call("handleEmailEvent", provider, "event-one", maybeEvent, recipient, "unmapped"))
        .toEqual({ ok: true });
      expect(run.calls).toEqual([
        { action: "claim", args: [provider, "event-one"] },
        { action: "append", args: ["email.delivered", emailPayload, nothing, nothing, nothing] },
        { action: "trigger", args: ["email.delivered", emailPayload] },
        { action: "trigger", args: ["email.event", emailPayload] },
        { action: "suppress", args: [provider, recipient, delivered] },
      ]);
    });
  }

  for (const provider of ["mailgun", "postmark", "resend"]) {
    test(`${provider}Events wrapper preserves both fresh and duplicate behavior`, () => {
      for (const fresh of [false, true]) {
        const run = probe(fresh);
        expect(run.call(`${provider}Events`, "event-one", maybeEvent, recipient, "unmapped"))
          .toEqual(fresh ? { ok: true } : { ok: true, deduped: true });
        expect(run.calls.map(call => call.action))
          .toEqual(fresh ? ["claim", "append", "trigger", "trigger", "suppress"] : ["claim"]);
        expect(run.calls[0]).toEqual({ action: "claim", args: [provider, "event-one"] });
      }
    });
  }

  test("an unmapped fresh event acknowledges without an effectful tail", () => {
    const run = probe(true);
    expect(run.call("handleEmailEvent", "mailgun", "event-one", nothing, nothing, "unsupported-event"))
      .toEqual({ ok: true, ignored: "unsupported-event" });
    expect(run.calls).toEqual([{ action: "claim", args: ["mailgun", "event-one"] }]);
  });

  for (const provider of ["mailgun", "postmark"]) {
    for (const fresh of [false, true]) {
      test(`${provider} inbound ${fresh ? "fresh" : "duplicate"} request selects only its intended tail`, () => {
        const email = { subject: "Local fixture", text: "No external delivery" };
        const payload = { email, messageId: "message-one" };
        const run = probe(fresh);
        expect(run.call(`${provider}Inbound`, "inbound-one", email, "message-one"))
          .toEqual(fresh ? { ok: true } : { ok: true, deduped: true });
        expect(run.calls).toEqual(fresh ? [
          { action: "claim", args: [provider, "inbound-one"] },
          { action: "append", args: ["email.received", payload, nothing, nothing, nothing] },
          { action: "trigger", args: ["email.received", payload] },
        ] : [{ action: "claim", args: [provider, "inbound-one"] }]);
      });
    }
  }
});

describe("provider event selectors invoke only the admitted event arm", () => {
  for (const eventType of ["invitee.canceled", "unknown.event", ""]) {
    test(`Calendly ${eventType || "empty"} event emits nothing`, () => {
      const run = probe(true);
      expect(run.call("calendlyWebhook", eventType, { email: "alice@example.invalid" }))
        .toEqual({ received: true });
      expect(run.calls).toEqual([]);
    });
  }

  test("Calendly invitee.created follows the real generic event tail once", () => {
    const payload = { email: "alice@example.invalid", scheduledAt: 0, callType: "fixture" };
    const run = probe(true);
    expect(run.call("calendlyWebhook", "invitee.created", payload)).toEqual({ received: true });
    expect(run.calls).toEqual([
      { action: "append", args: ["calendly_call_scheduled", payload, nothing, nothing, nothing] },
      { action: "trigger", args: ["calendly_call_scheduled", payload] },
    ]);
  });

  const checkoutObject = {
    id: "session-one", metadata: { purchaseId: "purchase-one", stepSlug: "step-one" },
  };
  for (const type of ["customer.created", "checkout.session.expired", ""]) {
    test(`Stripe ${type || "empty"} event cannot dispatch checkout actions despite valid metadata`, () => {
      const run = probe(true);
      expect(run.call("stripeWebhook", { type, data: { object: checkoutObject } }))
        .toEqual({ received: true });
      expect(run.calls).toEqual([]);
    });
  }

  test("Stripe checkout.session.completed dispatches the existing payment actions once in order", () => {
    const run = probe(true);
    expect(run.call("stripeWebhook", { type: "checkout.session.completed", data: { object: checkoutObject } }))
      .toEqual({ received: true });
    expect(run.calls).toEqual([
      { action: "action", args: ["mark_payment_step_paid", {
        purchaseId: "purchase-one", stepSlug: "step-one", provider: "stripe", providerRef: "session-one",
      }] },
      { action: "action", args: ["grant_step_entitlements", { purchaseId: "purchase-one", stepSlug: "step-one" }] },
    ]);
  });

  test("Stripe selected checkout with missing metadata remains an acknowledged no-op", () => {
    for (const metadata of [undefined, {}, { purchaseId: "purchase-one" }, { stepSlug: "step-one" }]) {
      const run = probe(true);
      expect(run.call("stripeWebhook", {
        type: "checkout.session.completed", data: { object: { id: "session-one", metadata } },
      })).toEqual({ received: true });
      expect(run.calls).toEqual([]);
    }
  });
});
