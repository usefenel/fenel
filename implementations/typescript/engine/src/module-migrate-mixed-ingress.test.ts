// ---------------------------------------------------------------------------
// module-migrate-mixed-ingress.test.ts — module-substrate Phase 3p parity proof
// (the AGGREGATION-FRONTIER CLOSE + the MERGE-INTO-EXISTING op, exercised TWICE).
//
// Phase 3p DISSOLVES the LAST junk-drawer bundle, `mixed-ingress`. The retired
// ~349-LOC `engine/src/modules/mixed-ingress.ts` loaded SIX `.fenel` files under
// throwaway internal names, hand-extracted each body by id, re-wrapped all 14
// functions in `defineFunction` specs (stamping 5 public prefixes), surfaced the
// `SubscriptionDispatch` ADT, and exported ONE `mixedIngressModule`. Per the
// standing steer ("dissolve to semantic HOMES") each prefix lands in its home:
//   - `webhooks` (NEW, a 2-file `module webhooks where` UNION: calendly ∪ stripe)
//   - `subscriptions` (NEW, single-file + the `SubscriptionDispatch` ADT)
//   - `proxyLinks` (NEW, single-file; the lone surviving @category)
//   - `events:*` ×2 MERGE into the already-migrated `events` module
//   - `telegram:telegramWebhookDispatch` MERGES into the `telegram` union (Option C)
//
// This proves: same 14 ids + codeNames; identity facets byte-identical (Codeable
// /Labelable/Describable/Taggable ×14; Categorizable ONLY on proxyLinks:redirectClick,
// per the camelCase-prefix-vs-hyphenated-category wrinkle); the 3 new modules are
// SEPARATE with disjoint prefixes; webhooks is the 2-file union; events + telegram
// genuinely absorbed their slices; the 9 IO fns carry INFERRED HasStateIO while the
// 5 pure fns carry none; and `mixed-ingress.ts` is GONE.
// ---------------------------------------------------------------------------

import { test, expect, describe } from "bun:test";
import { existsSync } from "fs";
import { webhooksModule } from "./modules/webhooks";
import { subscriptionsModule } from "./modules/subscriptions";
import { proxyLinksModule } from "./modules/proxyLinks";
import { eventsModule } from "./modules/events";
import { telegramModule } from "./modules/telegram";
import { stdModule } from "./modules/std";
import { stateModule } from "./modules/state";
import { createRegistry } from "./registry";
import type { Instance, Constraint } from "./types";

const WEBHOOKS_IDS = [
  "webhooks:calendlyWebhook",
  "webhooks:handleCalendlyInviteeCreated",
  "webhooks:stripeWebhook",
  "webhooks:handleCheckoutSessionCompleted",
  "webhooks:recordOrEmptyForWebhook",
  "webhooks:dispatchPaymentCompleted",
];
const SUBSCRIPTIONS_IDS = [
  "subscriptions:subscriptionDispatchDecide",
  "subscriptions:maybeEq",
  "subscriptions:telegramCollectorArm",
  "subscriptions:userHandlerOrNone",
];
const PROXYLINKS_IDS = ["proxyLinks:redirectClick"];
const EVENTS_INGRESS_IDS = ["events:emitEvent", "events:eventsInbound"];
const TELEGRAM_SLICE_ID = "telegram:telegramWebhookDispatch";

const ALL_IDS = [
  ...EVENTS_INGRESS_IDS,
  ...WEBHOOKS_IDS,
  ...PROXYLINKS_IDS,
  ...SUBSCRIPTIONS_IDS,
  TELEGRAM_SLICE_ID,
];

// The 9 IO fns infer HasStateIO; the 5 pure fns carry none.
const PURE_IDS = ["webhooks:recordOrEmptyForWebhook", ...SUBSCRIPTIONS_IDS];
const IO_IDS = ALL_IDS.filter((id) => !PURE_IDS.includes(id));

// Identity facets lifted byte-for-byte from the retired `defineFunction` specs
// (codeName === id-suffix for all 14 — no @codeName needed).
const FACETS: Record<string, { codeName: string; label: string; tags: string[] }> = {
  "events:emitEvent": { codeName: "emitEvent", label: "Emit event", tags: ["events", "ingress", "phase-12c"] },
  "events:eventsInbound": { codeName: "eventsInbound", label: "Events inbound", tags: ["events", "ingress", "route", "phase-12c"] },
  "webhooks:calendlyWebhook": { codeName: "calendlyWebhook", label: "Calendly webhook", tags: ["webhook", "calendly", "route", "phase-12c"] },
  "webhooks:handleCalendlyInviteeCreated": { codeName: "handleCalendlyInviteeCreated", label: "Handle Calendly invitee.created", tags: ["webhook", "calendly", "phase-12c"] },
  "webhooks:stripeWebhook": { codeName: "stripeWebhook", label: "Stripe webhook", tags: ["webhook", "stripe", "route", "phase-12d"] },
  "webhooks:handleCheckoutSessionCompleted": { codeName: "handleCheckoutSessionCompleted", label: "Handle checkout.session.completed", tags: ["webhook", "stripe", "phase-12d"] },
  "webhooks:recordOrEmptyForWebhook": { codeName: "recordOrEmptyForWebhook", label: "Record or empty (webhook)", tags: ["webhook", "stripe", "defensive", "pure", "phase-12d"] },
  "webhooks:dispatchPaymentCompleted": { codeName: "dispatchPaymentCompleted", label: "Dispatch payment completed", tags: ["webhook", "stripe", "phase-12d"] },
  "proxyLinks:redirectClick": { codeName: "redirectClick", label: "Redirect click", tags: ["proxy-link", "redirect", "route", "phase-12c"] },
  "subscriptions:subscriptionDispatchDecide": { codeName: "subscriptionDispatchDecide", label: "Subscription dispatch decide", tags: ["subscription", "ingress", "route", "phase-12c"] },
  "subscriptions:maybeEq": { codeName: "maybeEq", label: "Maybe equals", tags: ["subscription", "pure", "phase-12c"] },
  "subscriptions:telegramCollectorArm": { codeName: "telegramCollectorArm", label: "Telegram collector arm", tags: ["subscription", "pure", "phase-12c"] },
  "subscriptions:userHandlerOrNone": { codeName: "userHandlerOrNone", label: "User handler or none", tags: ["subscription", "pure", "phase-12c"] },
  "telegram:telegramWebhookDispatch": { codeName: "telegramWebhookDispatch", label: "Telegram webhook dispatch", tags: ["telegram", "webhook", "route", "phase-12c"] },
};

// Instances spread across the 5 homes (3 new modules + the events & telegram merges).
const ALL_INSTANCES: Instance[] = [
  ...(webhooksModule.instances ?? []),
  ...(subscriptionsModule.instances ?? []),
  ...(proxyLinksModule.instances ?? []),
  ...(eventsModule.instances ?? []),
  ...(telegramModule.instances ?? []),
];

function methodOf(insts: Instance[], typeName: string, id: string): Record<string, unknown> | undefined {
  return insts.find((i) => i.typeName === typeName && i.args[0] === id)?.methods;
}

// ===========================================================================
// 1. THREE NEW SEPARATE MODULES — disjoint prefixes
// ===========================================================================

describe("mixed-ingress dissolve — three NEW separate semantic modules", () => {
  test("webhooksModule is `webhooks` with exactly the 6 webhooks:* members (the 2-file UNION)", () => {
    expect(webhooksModule.name).toBe("webhooks");
    expect((webhooksModule.functions ?? []).map((f) => f.id).sort()).toEqual([...WEBHOOKS_IDS].sort());
    // Both files' members in ONE module: calendly's calendlyWebhook AND stripe's stripeWebhook.
    const ids = (webhooksModule.functions ?? []).map((f) => f.id);
    expect(ids).toContain("webhooks:calendlyWebhook");
    expect(ids).toContain("webhooks:stripeWebhook");
    expect((webhooksModule.functions ?? []).every((f) => f.id.startsWith("webhooks:"))).toBe(true);
  });

  test("subscriptionsModule is `subscriptions` with exactly the 4 subscriptions:* members + the ADT", () => {
    expect(subscriptionsModule.name).toBe("subscriptions");
    expect((subscriptionsModule.functions ?? []).map((f) => f.id).sort()).toEqual([...SUBSCRIPTIONS_IDS].sort());
    expect((subscriptionsModule.entities ?? []).map((e) => e.id)).toEqual(["SubscriptionDispatch"]);
  });

  test("proxyLinksModule is `proxyLinks` with exactly the 1 proxyLinks:* member", () => {
    expect(proxyLinksModule.name).toBe("proxyLinks");
    expect((proxyLinksModule.functions ?? []).map((f) => f.id)).toEqual([...PROXYLINKS_IDS]);
    expect(proxyLinksModule.entities ?? []).toHaveLength(0);
  });

  test("the three modules are disjoint — each owns only its own prefix", () => {
    expect((webhooksModule.functions ?? []).every((f) => f.id.startsWith("webhooks:"))).toBe(true);
    expect((subscriptionsModule.functions ?? []).every((f) => f.id.startsWith("subscriptions:"))).toBe(true);
    expect((proxyLinksModule.functions ?? []).every((f) => f.id.startsWith("proxyLinks:"))).toBe(true);
  });
});

// ===========================================================================
// 2. THE TWO MERGES-INTO-EXISTING (events + telegram)
// ===========================================================================

describe("mixed-ingress dissolve — events MERGE (the new substrate op)", () => {
  test("eventsModule absorbed both events:* ingress fns alongside its pre-existing members", () => {
    const ids = (eventsModule.functions ?? []).map((f) => f.id);
    // The 2 merged ingress fns …
    expect(ids).toContain("events:emitEvent");
    expect(ids).toContain("events:eventsInbound");
    // … coexist with the pre-existing constructors/natives (types.fenel).
    expect(ids).toContain("events:event");
    expect(ids).toContain("events:step");
    expect((eventsModule.functions ?? []).every((f) => f.id.startsWith("events:"))).toBe(true);
  });
});

describe("mixed-ingress dissolve — telegram MERGE (Option C, into the union)", () => {
  test("telegramModule absorbed telegram:telegramWebhookDispatch alongside its pre-existing members", () => {
    const ids = (telegramModule.functions ?? []).map((f) => f.id);
    expect(ids).toContain(TELEGRAM_SLICE_ID);
    // A pre-existing telegram member still present (no transient second module).
    expect(ids).toContain("telegram:fieldLabel");
  });
});

// ===========================================================================
// 3. REGISTRY RESOLUTION — all 14 by id + codeName
// ===========================================================================

describe("mixed-ingress dissolve — registry resolution by id + codeName", () => {
  const reg = createRegistry([
    stdModule,
    stateModule,
    eventsModule,
    webhooksModule,
    subscriptionsModule,
    proxyLinksModule,
    telegramModule,
  ]);

  test("all 14 resolve by id (incl. the events + telegram merges, alongside their pre-existing siblings)", () => {
    for (const id of ALL_IDS) {
      expect(reg.getFunction(id)?.id).toBe(id);
    }
    // Pre-existing siblings still resolve (the merges didn't displace them).
    expect(reg.getFunction("events:event")?.id).toBe("events:event");
    expect(reg.getFunction("telegram:fieldLabel")?.id).toBe("telegram:fieldLabel");
  });

  test("all 14 resolve by codeName", () => {
    for (const [id, f] of Object.entries(FACETS)) {
      expect(reg.getFunctionByCodeName(f.codeName)?.id).toBe(id);
    }
  });
});

// ===========================================================================
// 4. IDENTITY-FACET PARITY (directives → ClassInstances)
// ===========================================================================

describe("mixed-ingress dissolve — identity-facet parity", () => {
  test("Codeable: codeName is the unprefixed name for all 14", () => {
    for (const [id, f] of Object.entries(FACETS)) {
      expect(methodOf(ALL_INSTANCES, "Codeable", id)).toEqual({ codeName: f.codeName });
    }
  });

  test("Labelable + Taggable: byte-identical to the retired specs (all 14)", () => {
    for (const [id, f] of Object.entries(FACETS)) {
      expect(methodOf(ALL_INSTANCES, "Labelable", id)).toEqual({ label: f.label });
      expect(methodOf(ALL_INSTANCES, "Taggable", id)).toEqual({ tags: f.tags });
    }
  });

  test("Describable: present + non-empty for all 14", () => {
    for (const id of Object.keys(FACETS)) {
      const m = methodOf(ALL_INSTANCES, "Describable", id);
      expect(typeof m?.description).toBe("string");
      expect((m!.description as string).length).toBeGreaterThan(0);
    }
  });

  // Phase 3j: the category derives at read time from the id prefix, so 4 of 5
  // prefixes drop @category. proxyLinks is the EXCEPTION — its camelCase prefix
  // derives "proxyLinks" ≠ the stored hyphenated "proxy-links", so it KEEPS the
  // directive for display-identical parity (the lone survivor in the dissolve).
  test("Categorizable: PRESENT only for proxyLinks:redirectClick (= proxy-links); ABSENT for the other 13", () => {
    expect(methodOf(ALL_INSTANCES, "Categorizable", "proxyLinks:redirectClick")).toEqual({ category: "proxy-links" });
    for (const id of ALL_IDS.filter((x) => x !== "proxyLinks:redirectClick")) {
      expect(methodOf(ALL_INSTANCES, "Categorizable", id)).toBeUndefined();
    }
  });

  // Law-count parity (Surprise #11): the dissolve re-emits the SAME law-
  // contributing instances the bundle did — Codeable ×14 + Labelable ×14 — just
  // spread across 3 new modules + the 2 merges. The audit counts identity, not
  // location, so the 2450 holds. IOInvokable ×0 (none carried an ioAction).
  test("law-contributing instance counts hold across the 14 (Codeable ×14, Labelable ×14, Categorizable ×1, IOInvokable ×0)", () => {
    const ours = (cls: string) => ALL_INSTANCES.filter((i) => i.typeName === cls && ALL_IDS.includes(String(i.args[0])));
    expect(ours("Codeable").length).toBe(14);
    expect(ours("Labelable").length).toBe(14);
    expect(ours("Describable").length).toBe(14);
    expect(ours("Taggable").length).toBe(14);
    expect(ours("Categorizable").length).toBe(1);
    expect(ours("IOInvokable").length).toBe(0);
  });
});

// ===========================================================================
// 5. INFERRED HasStateIO on the 9 IO fns; the 5 pure fns carry none
// ===========================================================================

describe("mixed-ingress dissolve — inferred HasStateIO (9 IO) / none (5 pure)", () => {
  const reg = createRegistry([
    stdModule,
    stateModule,
    eventsModule,
    webhooksModule,
    subscriptionsModule,
    proxyLinksModule,
    telegramModule,
  ]);
  const HAS_STATE_IO: Constraint[] = [{ class: { $tag: "Id", entityId: "HasStateIO" }, args: [{ $var: "scope" }] }];

  test("the 9 IO fns carry HasStateIO (INFERRED transitively from state:* / dispatch:* / emit calls)", () => {
    for (const id of IO_IDS) {
      expect(reg.getFunction(id)?.requires).toEqual(HAS_STATE_IO);
    }
  });

  test("the 5 pure fns carry NO requires", () => {
    for (const id of PURE_IDS) {
      expect(reg.getFunction(id)?.requires).toBeUndefined();
    }
  });

  test("the telegram slice infers HasStateIO transitively (via events:emitEvent, cross-module)", () => {
    expect(reg.getFunction(TELEGRAM_SLICE_ID)?.requires).toEqual(HAS_STATE_IO);
  });
});

// ===========================================================================
// 6. THE BUNDLE IS GONE
// ===========================================================================

describe("mixed-ingress dissolve — the bundle is GONE", () => {
  test("engine/src/modules/mixed-ingress.ts no longer exists", () => {
    expect(existsSync(new URL("./modules/mixed-ingress.ts", import.meta.url))).toBe(false);
  });
});
