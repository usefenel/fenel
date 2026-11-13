// ---------------------------------------------------------------------------
// module-migrate-purchases.test.ts — module-substrate Phase 3c parity proof.
//
// Tier-1 pure Shape-B migration WITH entities (proven by `time`). `purchases`
// had 35 `defineFunction` specs in `engine/src/modules/purchases.ts` plus two
// FSM ADTs (PurchaseState / PaymentStepState), bodies pulled from
// `fenel/modules/purchases/manage.fenel`. Phase 3c retired the TS spec wrapper
// — the `.fenel` file (renamed `purchases.fenel`) grew the `module purchases
// where` header, per-function `name : Type` sigs, the facet directives, and
// keeps the two `data`-style ADT decls — and the TS file shrank to a thin
// `loadFenelModule` seam (`purchasesModule`). The ADTs ride along on
// `loaded.entities`.
// ---------------------------------------------------------------------------

import { test, expect, describe } from "bun:test";
import { purchasesModule } from "./modules/purchases";
import { createRegistry } from "./registry";
import type { Instance } from "./types";

type Expected = { label: string; tags: string[]; ioAction?: string };
const EXPECTED: Record<string, Expected> = {
  liftPaymentStepStateStr: { label: "Lift payment-step state string", tags: ["purchase", "fsm", "pure", "phase-12d"] },
  paymentStepStateString: { label: "Payment-step state string", tags: ["purchase", "fsm", "pure", "phase-12d"] },
  purchaseStateString: { label: "Purchase state string", tags: ["purchase", "fsm", "pure", "phase-12d"] },
  nextPurchaseState: { label: "Next purchase state", tags: ["purchase", "fsm", "pure", "phase-12d"] },
  listOrEmpty: { label: "List or empty", tags: ["purchase", "defensive", "pure", "phase-12d"] },
  recordOrEmpty: { label: "Record or empty", tags: ["purchase", "defensive", "pure", "phase-12d"] },
  hasSteps: { label: "Has payment steps", tags: ["purchase", "predicate", "pure", "phase-12d"] },
  paymentStepCount: { label: "Payment step count", tags: ["purchase", "pure", "phase-12d"] },
  allStepsPaid: { label: "All steps paid", tags: ["purchase", "fsm", "pure", "phase-12d"] },
  findStepBySlug: { label: "Find step by slug", tags: ["purchase", "lookup", "pure", "phase-12d"] },
  findStepInPlan: { label: "Find step in plan", tags: ["purchase", "lookup", "pure", "phase-12d"] },
  createPurchase: { label: "Create purchase", tags: ["purchase", "create", "phase-13a"], ioAction: "purchases.create_purchase" },
  // ts-elimination-completion Phase 5 (5a-2) — findPlanBySlug + not-found guard
  // + plan-field defaulting folded into the body; the Just-arm extraction.
  createPurchaseWithPlan: { label: "Create purchase (plan known)", tags: ["purchase", "create", "ts-elimination"] },
  createPurchaseInner: { label: "Create purchase (inner — Result)", tags: ["purchase", "create", "phase-13a"] },
  createPurchaseProceed: { label: "Create purchase (proceed)", tags: ["purchase", "create", "phase-12d"] },
  createPaymentStepsFromPlan: { label: "Create payment steps from plan", tags: ["purchase", "create", "phase-12d"] },
  createStepForOnePlan: { label: "Create step for 1-step plan", tags: ["purchase", "create", "phase-12d"] },
  createStepsForExplicit: { label: "Create steps for explicit plan", tags: ["purchase", "create", "phase-12d"] },
  createOneAndContinue: { label: "Create one step and continue", tags: ["purchase", "create", "phase-12d"] },
  createOneStep: { label: "Create one payment step", tags: ["purchase", "create", "phase-12d"] },
  markStepPaid: { label: "Mark step paid", tags: ["purchase", "fsm", "phase-13a"], ioAction: "purchases.mark_step_paid" },
  markStepPaidInner: { label: "Mark step paid (inner — Result)", tags: ["purchase", "fsm", "phase-13a"] },
  markStepPaidWithPurchase: { label: "Mark step paid (purchase known)", tags: ["purchase", "fsm", "phase-12d"] },
  markStepPaidWithStep: { label: "Mark step paid (step known)", tags: ["purchase", "fsm", "idempotency", "phase-12d"] },
  markStepPaidProceed: { label: "Mark step paid (proceed)", tags: ["purchase", "fsm", "phase-12d"] },
  emitPaymentCompletedIfAllPaid: { label: "Emit payment_completed if all paid", tags: ["purchase", "event", "phase-12d"] },
  grantStepEntitlements: { label: "Grant step entitlements", tags: ["purchase", "entitlement", "phase-13a"], ioAction: "purchases.grant_step_entitlements" },
  grantStepEntitlementsInner: { label: "Grant step entitlements (inner — Result)", tags: ["purchase", "entitlement", "phase-13a"] },
  grantStepEntitlementsWithPurchase: { label: "Grant step entitlements (purchase known)", tags: ["purchase", "entitlement", "phase-12d"] },
  grantStepEntitlementsWithPlan: { label: "Grant step entitlements (plan known)", tags: ["purchase", "entitlement", "phase-12d"] },
  selectGrants: { label: "Select grants for step", tags: ["purchase", "entitlement", "pure", "phase-12d"] },
  selectStepGrants: { label: "Select grants (multi-step plan)", tags: ["purchase", "entitlement", "pure", "phase-12d"] },
  grantAll: { label: "Grant all entitlements", tags: ["purchase", "entitlement", "phase-12d"] },
  grantEach: { label: "Grant each (recursive)", tags: ["purchase", "entitlement", "phase-12d"] },
  grantOneAndContinue: { label: "Grant one and continue", tags: ["purchase", "entitlement", "phase-12d"] },
  grantOneEntitlement: { label: "Grant one entitlement", tags: ["purchase", "entitlement", "phase-12d"] },
};
const NAMES = Object.keys(EXPECTED);
const ids = NAMES.map((n) => `purchases:${n}`);

function methodOf(insts: Instance[], typeName: string, id: string): Record<string, unknown> | undefined {
  return insts.find((i) => i.typeName === typeName && i.args[0] === id)?.methods;
}

describe("purchases migration — header-driven identity", () => {
  test("the `module purchases where` header is authoritative (lowercase prefix preserved)", () => {
    expect(purchasesModule.name).toBe("purchases");
  });

  test("all 36 functions registered under the legacy `purchases:` id-prefix", () => {
    expect((purchasesModule.functions ?? []).map((f) => f.id).sort()).toEqual([...ids].sort());
  });

  test("every function carries its `.fenel` body", () => {
    for (const f of purchasesModule.functions ?? []) {
      expect(f.body, `${f.id} should have a body`).toBeDefined();
    }
  });

  test("the two FSM ADTs ride along as entities", () => {
    const entIds = (purchasesModule.entities ?? []).map((e) => e.id).sort();
    expect(entIds).toEqual(["PaymentStepState", "PurchaseState"]);
  });
});

describe("purchases migration — identity-facet parity (directives → ClassInstances)", () => {
  const insts = purchasesModule.instances ?? [];

  test("Codeable: codeName is the unprefixed name, keyed by the fnId", () => {
    for (const n of NAMES) {
      expect(methodOf(insts, "Codeable", `purchases:${n}`)).toEqual({ codeName: n });
    }
  });

  test("Labelable: explicit @label preserved", () => {
    for (const n of NAMES) {
      expect(methodOf(insts, "Labelable", `purchases:${n}`)).toEqual({ label: EXPECTED[n]!.label });
    }
  });

  // Phase 3j (identity-as-fallback): purchases declares no @category, so NONE
  // carry a stored Categorizable — the `purchases` category derives at read time
  // (displayCategory → the id's module-prefix).
  test("Categorizable: NONE stored — purchases declares no @category (category derives at read time)", () => {
    for (const n of NAMES) {
      expect(methodOf(insts, "Categorizable", `purchases:${n}`)).toBeUndefined();
    }
  });

  test("Taggable: tags preserved verbatim", () => {
    for (const n of NAMES) {
      expect(methodOf(insts, "Taggable", `purchases:${n}`)).toEqual({ tags: EXPECTED[n]!.tags });
    }
  });

  test("Describable: a description is present for every function", () => {
    for (const n of NAMES) {
      const m = methodOf(insts, "Describable", `purchases:${n}`);
      expect(m, `${n} should have a Describable`).toBeDefined();
      expect(typeof m!.description).toBe("string");
      expect((m!.description as string).length).toBeGreaterThan(0);
    }
  });

  test("Describable: embedded escaped quotes survive the round-trip", () => {
    const m = methodOf(insts, "Describable", "purchases:emitPaymentCompletedIfAllPaid");
    expect(m!.description as string).toContain('aggregateType=Just "purchase"');
  });

  test("IOInvokable: present for exactly the 3 io-tagged entry-points", () => {
    const ioIds = insts.filter((i) => i.typeName === "IOInvokable").map((i) => i.args[0]).sort();
    expect(ioIds).toEqual([
      "purchases:createPurchase",
      "purchases:grantStepEntitlements",
      "purchases:markStepPaid",
    ]);
    expect(methodOf(insts, "IOInvokable", "purchases:createPurchase")).toEqual({ ioAction: "purchases.create_purchase" });
    expect(methodOf(insts, "IOInvokable", "purchases:markStepPaid")).toEqual({ ioAction: "purchases.mark_step_paid" });
    expect(methodOf(insts, "IOInvokable", "purchases:grantStepEntitlements")).toEqual({ ioAction: "purchases.grant_step_entitlements" });
  });

  test("no stray identity instances (only the expected facet set)", () => {
    // Identity instances are keyed by a `purchases:<fn>` id; the ADT entities'
    // own identity instances (if any) key by the bare ADT name, so they don't
    // appear in this function-facet tally. Count only the function-keyed ones.
    const fnInsts = insts.filter((i) => typeof i.args[0] === "string" && (i.args[0] as string).startsWith("purchases:"));
    const counts: Record<string, number> = {};
    for (const i of fnInsts) counts[i.typeName] = (counts[i.typeName] ?? 0) + 1;
    // Phase 3j: no Categorizable (purchases declares no @category — category
    // derives at read time via displayCategory).
    expect(counts).toEqual({
      Codeable: 36,
      Labelable: 36,
      Describable: 36,
      Taggable: 36,
      IOInvokable: 3,
    });
  });
});

describe("purchases migration — resolution through createRegistry", () => {
  const reg = createRegistry([purchasesModule]);

  test("getFunction resolves every function by id AND by codeName", () => {
    for (const n of NAMES) {
      const id = `purchases:${n}`;
      expect(reg.getFunction(id)?.id, `by id: ${id}`).toBe(id);
      expect(reg.getFunctionByCodeName(n)?.id, `by codeName: ${n}`).toBe(id);
    }
  });

  test("listModuleMembers sees purchases as a Module (view over the id namespace)", () => {
    expect(reg.listModuleMembers("purchases").sort()).toEqual([...NAMES].sort());
  });
});
