// ---------------------------------------------------------------------------
// module-migrate-email-webhooks.test.ts — typed-function-references
// FenelModule-retirement Phase FM-retire-5 Step 5a parity proof.
//
// `email-webhooks` moved off its ~479-LOC TS wrapper (20 `defineFunction` specs
// over the body-only `ingress.fenel`) onto a single `module emailWebhooks where`
// `.fenel` (`ingress.fenel`) + a thin `loadFenelModule` seam. Importing
// `emailWebhooksModule` runs the loader at module-eval time, so a parse error in
// the `.fenel` fails this file.
//
// Pins the SUBSTRATE OUTCOME (not "the 20 specs exist"): every fn registered
// under the `emailWebhooks:` id-prefix (load-bearing — the api routes dispatch
// by that id), every fn carries its `.fenel` body, facet parity vs the retired
// specs (Codeable/Labelable/Describable/Taggable/Categorizable), the
// SesIngressDecision entity preserved, and the `@requires "HasStateIO"`
// byte-identity on exactly the 11 emit/handle fns.
//
// HEADER NAME subtlety: the header is `emailWebhooks` (NOT `email-webhooks`) so
// the function ids stay `emailWebhooks:<fn>` — the loader ties both the module
// name AND the id-prefix to the header. The human label is overridden back to
// "Email-webhook ingress". Because the id-prefix is `emailWebhooks` but the
// catalog category is `email-webhooks`, each fn carries an explicit
// `@category "email-webhooks"` (the Phase-3j rule: author @category only when it
// differs from the id prefix — here it does).
// ---------------------------------------------------------------------------

import { test, expect, describe } from "bun:test";
import { emailWebhooksModule } from "./modules/email-webhooks";
import type { Instance } from "./types";

type Expected = { label: string; tags: string[]; category: string; requires: boolean };

// The retired-spec identity snapshot (label / tags / category / @requires).
const RICH: Record<string, Expected> = {
  emitEmailEvent: { label: "Emit email event", tags: ["email", "webhook", "event", "phase-12c"], category: "email-webhooks", requires: true },
  emitEmailInbound: { label: "Emit email inbound", tags: ["email", "webhook", "inbound", "phase-12c"], category: "email-webhooks", requires: true },
  emailEventType: { label: "Email event type", tags: ["email", "webhook", "pure", "phase-12c"], category: "email-webhooks", requires: false },
  emitOrIgnore: { label: "Emit or ignore", tags: ["email", "webhook", "phase-12c"], category: "email-webhooks", requires: true },
  emitInbound: { label: "Emit inbound", tags: ["email", "webhook", "inbound", "phase-12c"], category: "email-webhooks", requires: true },
  handleEmailEvent: { label: "Handle email event", tags: ["email", "webhook", "phase-12c"], category: "email-webhooks", requires: true },
  handleEmailInbound: { label: "Handle email inbound", tags: ["email", "webhook", "inbound", "phase-12c"], category: "email-webhooks", requires: true },
  mailgunEvents: { label: "Mailgun events", tags: ["email", "webhook", "mailgun", "route", "phase-12c"], category: "email-webhooks", requires: true },
  mailgunInbound: { label: "Mailgun inbound", tags: ["email", "webhook", "mailgun", "inbound", "route", "phase-12c"], category: "email-webhooks", requires: true },
  postmarkEvents: { label: "Postmark events", tags: ["email", "webhook", "postmark", "route", "phase-12c"], category: "email-webhooks", requires: true },
  postmarkInbound: { label: "Postmark inbound", tags: ["email", "webhook", "postmark", "inbound", "route", "phase-12c"], category: "email-webhooks", requires: true },
  resendEvents: { label: "Resend events", tags: ["email", "webhook", "resend", "route", "phase-12c"], category: "email-webhooks", requires: true },
  sesArnMatches: { label: "SES ARN matches", tags: ["email", "webhook", "ses", "pure", "phase-12c"], category: "email-webhooks", requires: false },
  sesArnMismatch: { label: "SES ARN mismatch", tags: ["email", "webhook", "ses", "pure", "phase-12c"], category: "email-webhooks", requires: false },
  sesConfirmFromUrl: { label: "SES confirm from url", tags: ["email", "webhook", "ses", "pure", "phase-12c"], category: "email-webhooks", requires: false },
  sesConfirmDecision: { label: "SES confirm decision", tags: ["email", "webhook", "ses", "pure", "phase-12c"], category: "email-webhooks", requires: false },
  sesNotificationEmit: { label: "SES notification emit", tags: ["email", "webhook", "ses", "pure", "phase-12c"], category: "email-webhooks", requires: false },
  sesNotificationCheckArn: { label: "SES notification check arn", tags: ["email", "webhook", "ses", "pure", "phase-12c"], category: "email-webhooks", requires: false },
  sesNotificationDecision: { label: "SES notification decision", tags: ["email", "webhook", "ses", "pure", "phase-12c"], category: "email-webhooks", requires: false },
  // sesEvents returns the SesIngressDecision ADT — its IO is wrapper-executed, so it carries NO requires (matching the retired spec).
  sesEvents: { label: "SES events", tags: ["email", "webhook", "ses", "route", "phase-12c"], category: "email-webhooks", requires: false },
};

const ALL_NAMES = Object.keys(RICH);
const ids = ALL_NAMES.map((n) => `emailWebhooks:${n}`);
const STATE_IO = [
  { class: { $tag: "Id", entityId: "HasStateIO" }, args: [{ $var: "scope" }] },
];

function methodOf(insts: Instance[], typeName: string, id: string): Record<string, unknown> | undefined {
  return insts.find((i) => i.typeName === typeName && i.args[0] === id)?.methods;
}

describe("email-webhooks migration — header-driven identity + roster", () => {
  test("the `module emailWebhooks where` header is authoritative (id-prefix preserved)", () => {
    expect(emailWebhooksModule.name).toBe("emailWebhooks");
  });

  test("module label overridden back to `Email-webhook ingress`", () => {
    expect(JSON.stringify(emailWebhooksModule.label)).toContain("Email-webhook ingress");
  });

  test("all 20 functions registered under the `emailWebhooks:` id-prefix", () => {
    expect((emailWebhooksModule.functions ?? []).map((f) => f.id).sort()).toEqual([...ids].sort());
  });

  test("the SesIngressDecision entity rides along from the `.fenel`", () => {
    expect((emailWebhooksModule.entities ?? []).map((e) => e.id)).toEqual(["SesIngressDecision"]);
  });
});

describe("email-webhooks migration — every fn is Fenel-bodied (0 defineFunction, 0 native)", () => {
  test("no bodyless functions — all 20 carry their `.fenel` body", () => {
    const bodyless = (emailWebhooksModule.functions ?? []).filter((f) => !f.body).map((f) => f.id);
    expect(bodyless).toEqual([]);
  });
});

describe("email-webhooks migration — @requires byte-identity (the 11 HasStateIO fns)", () => {
  test("exactly the 11 emit/handle fns carry `requires: [HasStateIO scope]`", () => {
    const withReq = (emailWebhooksModule.functions ?? [])
      .filter((f) => (f as { requires?: unknown[] }).requires)
      .map((f) => f.id)
      .sort();
    const expected = ALL_NAMES.filter((n) => RICH[n]!.requires).map((n) => `emailWebhooks:${n}`).sort();
    expect(withReq).toEqual(expected);
  });

  test("the requires constraint is byte-identical to the hand-written stateIORequires", () => {
    for (const n of ALL_NAMES.filter((x) => RICH[x]!.requires)) {
      const f = (emailWebhooksModule.functions ?? []).find((x) => x.id === `emailWebhooks:${n}`);
      expect((f as { requires?: unknown }).requires).toEqual(STATE_IO as never);
    }
  });

  test("the 9 pure/decision fns carry NO requires", () => {
    for (const n of ALL_NAMES.filter((x) => !RICH[x]!.requires)) {
      const f = (emailWebhooksModule.functions ?? []).find((x) => x.id === `emailWebhooks:${n}`);
      expect((f as { requires?: unknown }).requires).toBeUndefined();
    }
  });
});

describe("email-webhooks migration — identity-facet parity (directives → ClassInstances)", () => {
  const insts = emailWebhooksModule.instances ?? [];

  test("Codeable: codeName is the unprefixed name for every fn", () => {
    for (const n of ALL_NAMES) {
      expect(methodOf(insts, "Codeable", `emailWebhooks:${n}`)).toEqual({ codeName: n });
    }
  });

  test("Labelable + Taggable + Categorizable byte-identical for all 20 fns", () => {
    for (const n of ALL_NAMES) {
      expect(methodOf(insts, "Labelable", `emailWebhooks:${n}`)).toEqual({ label: RICH[n]!.label });
      expect(methodOf(insts, "Taggable", `emailWebhooks:${n}`)).toEqual({ tags: RICH[n]!.tags });
      expect(methodOf(insts, "Categorizable", `emailWebhooks:${n}`)).toEqual({ category: RICH[n]!.category });
    }
  });

  test("Describable present + non-empty for all 20 fns", () => {
    for (const n of ALL_NAMES) {
      const d = methodOf(insts, "Describable", `emailWebhooks:${n}`) as { description?: string } | undefined;
      expect(typeof d?.description).toBe("string");
      expect((d?.description ?? "").length).toBeGreaterThan(0);
    }
  });
});
