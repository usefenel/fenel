import { registerAction } from "./registry";

// ===========================================================================
// Email actions — action-subsumption Phase N (2026-06-10).
//
// The public action IS a typed Fenel function now (D1 COLLAPSE):
//   send_email → email:sendEmail  (fenel/modules/email/email.fenel)
//
// `send_email` was the LAST action still on the legacy
// `registerAction({handler})` + `validateActionParams` + `send_email_params`
// mirror-entity pattern. The TS handler (`sendEmailHandler` in
// runtime/src/handlers/email-action.ts — validate → appendEvent → profile
// lookup → buildEmailFromTemplate → the per-account provider chain) is DELETED.
// Its orchestration moved into the Fenel body; the only residual TS is the
// irreducible per-provider HTTP send leaf (`email.provider_send`, registered in
// runtime/src/providers.ts alongside the other capability handlers). Dispatch
// validates params against `paramRecordOf("email:sendEmail")` (D2 — no
// send_email_params), injects `adapter` (D4) + `accountId`, invokes, maps the
// ActionResult ADT.
//
// This action now registers from CORE (not runtime): the runtime-residence
// reason — the handler imported the provider impls, and core ← runtime would be
// a dependency cycle — vanishes with the handler. So `registerEmailActions()`
// joins the other `name → fnRef` shells here, called from actions/index.ts at
// import; the api server no longer wires it at boot.
// ===========================================================================

export function registerEmailActions() {
  registerAction({
    name: "send_email",
    description: "Queue an email to a profile using a template (typed pipeline)",
    fnRef: "email:sendEmail",
  });
}
