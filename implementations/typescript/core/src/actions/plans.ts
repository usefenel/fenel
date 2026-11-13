import { registerAction } from "./registry";

// ===========================================================================
// Plans actions — action-subsumption Phase 3 (the body-residual bulk wave,
// 2026-06-08).
//
// The public actions ARE typed Fenel functions now (D1 COLLAPSE):
//   create_plan → plans:createPlan  (fenel/modules/plans/plans.fenel)
//   update_plan → plans:updatePlan
//
// Both TS handlers (+ their `toMaybe` marshalling + `validateActionParams`
// calls) are DELETED. Dispatch resolves them by name → fnRef, validates the
// incoming params against the function's own param-record (`paramRecordOf(fnRef)`,
// D2 — no `create_plan_params` / `update_plan_params` mirror entities), injects
// `adapter` (D4) + `accountId`, invokes the body, and maps the returned
// `ActionResult` ADT at the boundary. The body residuals (G2 1-vs-N-step
// exclusion / patch-merge) stay in the `.fenel` bodies, untouched by the port.
// The PlanGrant / PlanStep sub-record refinements are carried faithfully via the
// `{$ref}` named entities (createPlan's `grants` / `steps` sig types).
//
// This file is now just the explicit `name → fnRef` exposure list (D3).
// ===========================================================================

export function registerPlanActions() {
  registerAction({
    name: "create_plan",
    description: "Create a purchase plan (1-step or multi-step)",
    fnRef: "plans:createPlan",
  });

  registerAction({
    name: "update_plan",
    description: "Update an existing plan",
    fnRef: "plans:updatePlan",
  });
}
