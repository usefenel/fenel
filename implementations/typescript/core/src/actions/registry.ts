import type { AuthorityRef } from "@fenel/engine/authority";

/**
 * The runtime context every action handler receives.
 *
 * `subject` is the actor making the call — the source of truth for
 * identity and (eventually) permission decisions.
 *
 * `accountId` is the *resource partition* the action operates against. In
 * the common case it equals `subjectAccountId(subject)` (a user / bot
 * acting on its own account's data), but it is NOT a strict derivative —
 * an anonymous form submission has `subject = anonymous` while
 * `accountId` is the form owner's account. Construction sites set this
 * field explicitly to disambiguate.
 *
 * `adapter` is the entry channel (`"api"`, `"webapp"`, `"telegram"`,
 * `"stripe_webhook"`, `"system"`, …) — used by handlers to tag emitted
 * events with their origin. Distinct from `subject.$tag`: a single
 * subject may flow through multiple adapters during a session.
 */
/** rights R2a — the context carries the AUTHORITY the action runs under, not a
 *  `Subject` the caller chose. A subject is attribution; an authority is what
 *  the execution may actually do, and it cannot be manufactured by whoever is
 *  calling. (`systemSubject()` was manufactured at four sites precisely because
 *  it could be.) */
export type ActionContext = {
  authority: AuthorityRef;
  accountId: string;
  adapter: string;
};

export type ActionResult = {
  success: boolean;
  data?: Record<string, unknown>;
  aggregateType?: string;
  aggregateId?: string;
  profileId?: string;
};

/**
 * Phase 13a-1 — ActionResult lifted to a Fenel ADT
 * (fenel/modules/core/action-result.fenel). Bodies in the 12d C-port
 * surfaces (inventory / purchases / payments / profiles / imports / forms)
 * return this shape; the `actionResultAdtToTs` adapter translates to the
 * TS-side ActionResult interface above so downstream consumers
 * (dispatch loop, HTTP handlers reading `result.success` / `result.data`)
 * stay backward-compatible.
 */
type MaybeStr =
  | { $tag: "Just"; _0: string }
  | { $tag: "Nothing" };

export type ActionResultAdt =
  | {
      $tag: "ActionOk";
      data: Record<string, unknown>;
      aggregateType: MaybeStr;
      aggregateId: MaybeStr;
      profileId: MaybeStr;
    }
  | { $tag: "ActionErr"; message: string };

function unwrapMaybeStr(m: MaybeStr): string | undefined {
  return m.$tag === "Just" ? m._0 : undefined;
}

/**
 * Translate the ActionResult ADT (returned from Fenel bodies) to the TS
 * ActionResult interface. `ActionErr` throws — the dispatch loop catches
 * and maps to the action error path; `ActionOk` produces the
 * `{success: true, data, aggregateType, aggregateId, profileId}` shape
 * downstream consumers expect.
 */
export function actionResultAdtToTs(adt: ActionResultAdt): ActionResult {
  if (adt.$tag === "ActionErr") {
    throw new Error(adt.message);
  }
  return {
    success: true,
    data: adt.data,
    aggregateType: unwrapMaybeStr(adt.aggregateType),
    aggregateId: unwrapMaybeStr(adt.aggregateId),
    profileId: unwrapMaybeStr(adt.profileId),
  };
}

export type ActionDefinition = {
  name: string;
  description: string;
  /**
   * The action implementation: a function id (`items:createItem`). The action
   * IS a typed Fenel function — dispatch validates args against
   * `paramRecordOf(fnRef)` (the function's own param-record, D2), injects
   * `adapter` (D4) + `accountId`, invokes the body, and maps the returned
   * `ActionResult` ADT at the boundary. No `<action>_params` mirror entity, no
   * per-action TS handler.
   *
   * action-subsumption Phase N (2026-06-10) — the legacy `handler?:
   * ActionHandler` form (a TS closure that ran its own `validateActionParams` +
   * marshalling) is RETIRED: `send_email` was its last user and is now
   * `email:sendEmail`. Every action is a `name → fnRef` shell. The exposure
   * registry stays explicit (D3) until the rights/ownership arc replaces it
   * with policy-grant resolution.
   */
  fnRef: string;
  /**
   * Resource-kind tag used when the dispatcher checks permissions for
   * this action. Defaults to `"account"` — actions that touch a specific
   * resource type (forms, pages, items) should declare it so default
   * policies can match by kind.
   */
  resourceKind?: string;
};

const registry = new Map<string, ActionDefinition>();

export function registerAction(action: ActionDefinition) {
  if (registry.has(action.name)) {
    throw new Error(`Action "${action.name}" is already registered`);
  }
  registry.set(action.name, action);
}

export function getAction(name: string): ActionDefinition | undefined {
  return registry.get(name);
}

export function listActions(): ActionDefinition[] {
  return Array.from(registry.values());
}

