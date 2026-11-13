import { registerAction } from "./registry";

// ===========================================================================
// Types actions — forms-collapse Phase 1 (D-REG = B, Rom 2026-06-08).
//
// The public action IS a typed Fenel function (D1 COLLAPSE):
//   register_type → types:registerType   (fenel/modules/types/register.fenel)
//
// This is the action-subsumption thesis applied to type-authoring itself: the
// action's single content param is a `FenelType` (typed `Type` = the
// {$type:true} universe), so its auto-derived input UX IS `TypeBuilder` and
// "register a type" is "submit a form whose type is FenelType." It REPLACES
// `create_form` — a form is the auto-derived input UX of a registered $record,
// not a bespoke entity (see design/forms-collapse.md).
//
// Dispatch (core/src/dispatch.ts) resolves `register_type` → fnRef, validates
// the incoming params against the function's own param-record
// (`paramRecordOf(fnRef)`, D2 — no `register_type_params` mirror entity),
// injects `adapter` (D4), invokes the body, and maps the returned `ActionResult`
// ADT at the boundary. `resourceKind: "entity_definition"` lets default policies
// match by kind.
// ===========================================================================

export function registerTypeActions() {
  registerAction({
    name: "register_type",
    description:
      "Register a Fenel type (its $record schema) — the FenelType-as-param action that replaces create_form",
    fnRef: "types:registerType",
    resourceKind: "entity_definition",
  });
}
