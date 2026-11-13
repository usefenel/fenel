// ---------------------------------------------------------------------------
// module-migrate-payments.test.ts — module-substrate Phase 3c parity proof.
//
// Tier-1 (mostly-)pure Shape-B migration. `payments` had 26 `defineFunction`
// specs in `engine/src/modules/payments.ts` (signatures + identity), bodies
// pulled from `fenel/modules/payments/manage.fenel`. Phase 3c retired the TS
// spec wrapper — the `.fenel` file (renamed `payments.fenel`) grew the
// `module payments where` header, per-function `name : Type` sigs, and the
// `@label`/`@description`/`@tags`/`@ioAction`/`@codeName` facet directives —
// and the TS file shrank to a thin `loadFenelModule` seam (`paymentsModule`).
//
// Two non-default axes guarded here:
//   - `createStripeCheckoutSession` is a BODYLESS substrate primitive (`@native`
//     foreign decl; impl is a runtime IO handler, not on this module). It has
//     NO `.fenel` body — every-fn-has-a-body is asserted for the other 25.
//   - `listOrEmpty`/`hasSteps`/`maybeOr` carry a suffixed `@codeName`
//     (`…Payments`) — the global codeName disambiguates from `purchases`'
//     same-named helpers while the fnId keeps the short name.
// ---------------------------------------------------------------------------

import { test, expect, describe } from "bun:test";
import { paymentsModule } from "./modules/payments";
import { createRegistry } from "./registry";
import type { Instance } from "./types";

// `codeName` defaults to the key (def name); set explicitly where the
// retired spec used a different (suffixed) codeName.
type Expected = { label: string; tags: string[]; ioAction?: string; codeName?: string };
const EXPECTED: Record<string, Expected> = {
  listOrEmpty: { codeName: "listOrEmptyPayments", label: "List or empty (payments)", tags: ["payment", "defensive", "pure", "phase-12d"] },
  hasSteps: { codeName: "hasStepsPayments", label: "Has payment steps (payments)", tags: ["payment", "predicate", "pure", "phase-12d"] },
  findStepInPlanSteps: { label: "Find step in plan steps", tags: ["payment", "lookup", "pure", "phase-12d"] },
  maybeOr: { codeName: "maybeOrPayments", label: "Maybe or default (payments)", tags: ["payment", "pure", "maybe", "phase-12d"] },
  resolvePaymentTarget: { label: "Resolve payment target", tags: ["payment", "pure", "phase-12d"] },
  resolveMultiStepTarget: { label: "Resolve multi-step target", tags: ["payment", "pure", "phase-12d"] },
  resolveOneStepTarget: { label: "Resolve 1-step target", tags: ["payment", "pure", "phase-12d"] },
  pickProvider: { label: "Pick payment provider", tags: ["payment", "pure", "phase-12d"] },
  pickFirstProvider: { label: "Pick first provider", tags: ["payment", "pure", "phase-12d"] },
  createStripeCheckoutSession: { label: "Create Stripe checkout session", tags: ["payment", "stripe", "io", "checkout", "phase-12d"], ioAction: "payments.create_stripe_checkout_session" },
  // ts-elimination-completion Phase 5 (5a-3) — findPlanBySlug + findProfileById
  // + the two not-found guards folded into the body; the helper + two Just-arm
  // extractions + the send-side plan-name resolver.
  emailMaybe: { label: "Email maybe", tags: ["payment", "pure", "ts-elimination"] },
  createPaymentLink: { label: "Create payment link", tags: ["payment", "create", "phase-13a"], ioAction: "payments.create_payment_link" },
  createPaymentLinkWithPlan: { label: "Create payment link (plan known)", tags: ["payment", "create", "ts-elimination"] },
  createPaymentLinkWithProfile: { label: "Create payment link (profile known)", tags: ["payment", "create", "ts-elimination"] },
  createPaymentLinkInner: { label: "Create payment link (inner — Result)", tags: ["payment", "create", "phase-13a"] },
  createPaymentLinkChecked: { label: "Create payment link (target checked)", tags: ["payment", "phase-12d"] },
  createPaymentLinkPicked: { label: "Create payment link (provider picked)", tags: ["payment", "phase-12d"] },
  createPaymentLinkProceed: { label: "Create payment link (proceed)", tags: ["payment", "phase-12d"] },
  createStepAndCheckout: { label: "Create payment step + checkout", tags: ["payment", "phase-12d"] },
  finalizeCheckout: { label: "Finalize checkout", tags: ["payment", "stripe", "phase-12d"] },
  sendPaymentLink: { label: "Send payment link", tags: ["payment", "send", "phase-13a"], ioAction: "payments.send_payment_link" },
  resolvePlanName: { label: "Resolve plan name", tags: ["payment", "send", "ts-elimination"] },
  sendPaymentLinkInner: { label: "Send payment link (inner — Result)", tags: ["payment", "send", "phase-13a"] },
  makeCreateParams: { label: "Make create_payment_link params", tags: ["payment", "pure", "phase-12d"] },
  sendPaymentLinkAfterCreate: { label: "Send payment link (after create)", tags: ["payment", "send", "phase-12d"] },
  sendPaymentLinkChannels: { label: "Send payment link channels", tags: ["payment", "send", "phase-12d"] },
  dispatchEmailIfApplicable: { label: "Dispatch email if applicable", tags: ["payment", "email", "phase-12d"] },
  emailPaymentLink: { label: "Email payment link", tags: ["payment", "email", "phase-12d"] },
  dispatchTelegramIfApplicable: { label: "Dispatch telegram if applicable", tags: ["payment", "telegram", "phase-12d"] },
  telegramPaymentLink: { label: "Telegram payment link", tags: ["payment", "telegram", "phase-12d"] },
};
const NAMES = Object.keys(EXPECTED);
const ids = NAMES.map((n) => `payments:${n}`);
const codeNameOf = (n: string): string => EXPECTED[n]!.codeName ?? n;
const BODYLESS = new Set(["createStripeCheckoutSession"]); // @native foreign decl

function methodOf(insts: Instance[], typeName: string, id: string): Record<string, unknown> | undefined {
  return insts.find((i) => i.typeName === typeName && i.args[0] === id)?.methods;
}

describe("payments migration — header-driven identity", () => {
  test("the `module payments where` header is authoritative (lowercase prefix preserved)", () => {
    expect(paymentsModule.name).toBe("payments");
  });

  test("all 30 functions registered under the legacy `payments:` id-prefix", () => {
    expect((paymentsModule.functions ?? []).map((f) => f.id).sort()).toEqual([...ids].sort());
  });

  test("every Fenel-bodied function carries its body; the @native primitive is bodyless", () => {
    for (const f of paymentsModule.functions ?? []) {
      const name = f.id.slice("payments:".length);
      if (BODYLESS.has(name)) {
        expect(f.body, `${f.id} is a @native foreign decl — should be bodyless`).toBeUndefined();
      } else {
        expect(f.body, `${f.id} should have a body`).toBeDefined();
      }
    }
  });

  test("no entity contributed (payments declared none)", () => {
    expect(paymentsModule.entities ?? []).toEqual([]);
  });
});

describe("payments migration — identity-facet parity (directives → ClassInstances)", () => {
  const insts = paymentsModule.instances ?? [];

  test("Codeable: codeName preserved (suffixed `…Payments` where the spec disambiguated)", () => {
    for (const n of NAMES) {
      expect(methodOf(insts, "Codeable", `payments:${n}`)).toEqual({ codeName: codeNameOf(n) });
    }
  });

  test("Labelable: explicit @label preserved", () => {
    for (const n of NAMES) {
      expect(methodOf(insts, "Labelable", `payments:${n}`)).toEqual({ label: EXPECTED[n]!.label });
    }
  });

  // Phase 3j (identity-as-fallback): payments declares no @category, so NONE
  // carry a stored Categorizable — the `payments` category derives at read time
  // (displayCategory → the id's module-prefix).
  test("Categorizable: NONE stored — payments declares no @category (category derives at read time)", () => {
    for (const n of NAMES) {
      expect(methodOf(insts, "Categorizable", `payments:${n}`)).toBeUndefined();
    }
  });

  test("Taggable: tags preserved verbatim", () => {
    for (const n of NAMES) {
      expect(methodOf(insts, "Taggable", `payments:${n}`)).toEqual({ tags: EXPECTED[n]!.tags });
    }
  });

  test("Describable: a description is present for every function", () => {
    for (const n of NAMES) {
      const m = methodOf(insts, "Describable", `payments:${n}`);
      expect(m, `${n} should have a Describable`).toBeDefined();
      expect(typeof m!.description).toBe("string");
      expect((m!.description as string).length).toBeGreaterThan(0);
    }
  });

  test("Describable: backtick template span survives the round-trip (telegramPaymentLink)", () => {
    const m = methodOf(insts, "Describable", "payments:telegramPaymentLink");
    expect(m!.description as string).toContain("`Payment link for ${plan?.name ?? planSlug}: ${url}`");
  });

  test("IOInvokable: present for exactly the 3 io-tagged entry-points", () => {
    const ioIds = insts.filter((i) => i.typeName === "IOInvokable").map((i) => i.args[0]).sort();
    expect(ioIds).toEqual([
      "payments:createPaymentLink",
      "payments:createStripeCheckoutSession",
      "payments:sendPaymentLink",
    ]);
    expect(methodOf(insts, "IOInvokable", "payments:createStripeCheckoutSession")).toEqual({ ioAction: "payments.create_stripe_checkout_session" });
    expect(methodOf(insts, "IOInvokable", "payments:createPaymentLink")).toEqual({ ioAction: "payments.create_payment_link" });
    expect(methodOf(insts, "IOInvokable", "payments:sendPaymentLink")).toEqual({ ioAction: "payments.send_payment_link" });
  });

  test("no stray identity instances (only the expected facet set)", () => {
    // Phase 3j: no Categorizable (payments declares no @category — category
    // derives at read time via displayCategory).
    const counts: Record<string, number> = {};
    for (const i of insts) counts[i.typeName] = (counts[i.typeName] ?? 0) + 1;
    expect(counts).toEqual({
      Codeable: 30,
      Labelable: 30,
      Describable: 30,
      Taggable: 30,
      IOInvokable: 3,
    });
  });
});

describe("payments migration — resolution through createRegistry", () => {
  const reg = createRegistry([paymentsModule]);

  test("getFunction resolves every function by id AND by (possibly-suffixed) codeName", () => {
    for (const n of NAMES) {
      const id = `payments:${n}`;
      expect(reg.getFunction(id)?.id, `by id: ${id}`).toBe(id);
      expect(reg.getFunctionByCodeName(codeNameOf(n))?.id, `by codeName: ${codeNameOf(n)}`).toBe(id);
    }
  });

  test("listModuleMembers sees payments as a Module (view over the id namespace)", () => {
    expect(reg.listModuleMembers("payments").sort()).toEqual([...NAMES].sort());
  });
});
