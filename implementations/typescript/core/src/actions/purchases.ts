import { registerAction } from "./registry";

// ===========================================================================
// Purchases actions — action-subsumption (the public actions ARE typed Fenel
// functions; D1 COLLAPSE).
//
//   create_purchase         → purchases:createPurchase        (Phase 3, 2026-06-08)
//   mark_payment_step_paid  → purchases:markStepPaid          (Phase 3)
//   grant_step_entitlements → purchases:grantStepEntitlements (Phase 2)
//
// Every TS handler (+ its marshalling + `validateActionParams` call) is DELETED.
// Dispatch resolves each by name → fnRef, validates the incoming params against
// the function's own param-record (`paramRecordOf(fnRef)`, D2 — no `*_params`
// mirror entity), injects `adapter` (D4) + `accountId`, invokes the body, and
// maps the returned `ActionResult` ADT at the boundary.
//
// The body residuals stay in the `.fenel` bodies, untouched by the port:
//   - create_purchase's `data ?? {}` default (now over the public `data` Maybe)
//     + plan-field defaulting;
//   - mark_payment_step_paid's optional `providerRef` (threaded as Maybe<String>
//     to the omit-when-absent addProviderRef merge) + step-complete FSM.
//
// This file is now just the explicit `name → fnRef` exposure list (D3).
// ===========================================================================

export function registerPurchaseActions() {
  registerAction({
    name: "create_purchase",
    description:
      "Start a purchase for a profile on a plan (creates payment steps)",
    fnRef: "purchases:createPurchase",
  });

  registerAction({
    name: "mark_payment_step_paid",
    description:
      "Mark a payment step as paid (auto-completes purchase when all steps done)",
    fnRef: "purchases:markStepPaid",
  });

  registerAction({
    name: "grant_step_entitlements",
    description:
      "Auto-grant all entitlements declared in a plan step for a purchase",
    fnRef: "purchases:grantStepEntitlements",
  });
}
