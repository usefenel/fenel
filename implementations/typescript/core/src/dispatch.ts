// ---------------------------------------------------------------------------
// Action dispatch — entry-point for invoking an Action by name.
//
// rights R2a — THE CHECK STEP IS GONE, AND SO IS THE ENGINE BEHIND IT. This
// function used to open with a `dispatch:check` round-trip into
// `fenel/modules/permissions/permissions.fenel`, a SECOND policy engine over a
// `Subject × Action × Resource` product whose live semantics at HEAD were:
// `System` → allow everything; an account-bound subject on its own account →
// allow; anonymous → `permission_policies` rows, of which no seeded one
// remained. Four TypeScript sites manufactured a `System` subject to get past
// it, which is what a policy engine whose subject is chosen by its caller is
// worth.
//
// Those three cases are now the three envelopes: the request-session member
// authority, the identity-realm authority at the privileged door, and the
// anonymous authority (∅ — every perform refused). Authorization is decided at
// EXERCISE, by `perform`, against the authority on the frame — so a body cannot
// be dispatched into a position its caller could not reach directly.
//
// What remains here is what was never a policy question: resolve the action,
// validate raw arguments against `paramRecordOf(fnRef)`, inject trusted
// context, invoke the referenced Fenel body, project its ActionResult ADT.
// ---------------------------------------------------------------------------

import { invokeIOActionAs } from "@fenel/runtime";
import { getAction, actionResultAdtToTs } from "./actions/registry";
import type {
  ActionContext,
  ActionResult,
  ActionResultAdt,
} from "./actions/registry";
import { ValidationError } from "./errors";
import type { ValidationIssue } from "./errors";

/** action-subsumption Phase 1 — the result of `state.validate_function_args`
 *  (validate args against `paramRecordOf(fnRef)`, D2). On success `value` is the
 *  body-ready arg record (Maybe params coerced to tagged form). */
type ValidateArgsResult =
  | { ok: true; value: Record<string, unknown> }
  | { ok: false; errors: ValidationIssue[] };

export async function dispatch(
  actionName: string,
  params: Record<string, unknown>,
  context: ActionContext,
): Promise<ActionResult> {
  const action = getAction(actionName);
  if (!action) {
    throw new Error(`Unknown action: ${actionName}`);
  }

  // action-subsumption Phase 1 (2026-06-08) — the generic typed-function path.
  // A ported action carries `fnRef` (the public action IS a typed Fenel
  // function), not a TS `handler`. Dispatch validates `params` against the
  // function's own param-record (`state.validate_function_args` →
  // `paramRecordOf(fnRef)`, D2), throwing `ValidationError` (→ 422, same shape
  // the old `validateActionParams` produced) on failure; injects the
  // context-supplied params (`adapter` (D4) + `accountId` — both in
  // `CONTEXT_INJECTED_PARAMS`, so neither is part of the validated user
  // contract; a body that declares either as a formal — e.g.
  // `inventory:getInventoryStatusAction accountId inventorySlug` — binds it
  // from here, and a body that doesn't simply ignores the extra env key);
  // invokes the body; and maps the returned `ActionResult` ADT at the boundary
  // (`actionResultAdtToTs` — `ActionErr` throws to the action error path). No
  // `<action>_params` mirror entity, no per-action TS marshalling.
  const validated = (await invokeIOActionAs(
    context.authority,
    null,
    "state.validate_function_args",
    { fnRef: action.fnRef, raw: params, partial: false },
  )) as ValidateArgsResult;
  if (!validated.ok) {
    throw new ValidationError(validated.errors);
  }
  const adt = (await invokeIOActionAs(context.authority, null, action.fnRef, {
    ...validated.value,
    adapter: context.adapter,
    accountId: context.accountId,
  })) as ActionResultAdt;
  return actionResultAdtToTs(adt);
}
