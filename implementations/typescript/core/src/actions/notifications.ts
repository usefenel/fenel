import { registerAction } from "./registry";

// ===========================================================================
// Notifications actions — action-subsumption Phase 3b (2026-06-08).
//
// The public action IS a typed Fenel function now (D1 COLLAPSE):
//   tg_dm → notify:sendTgDm  (fenel/modules/notify/tg-dm.fenel)
//
// The former TS handler (`tgDmHandler` + its `buttons ?? []` default + the
// bespoke non-`ActionResult` → ActionResult mapping + `validateActionParams`) is
// DELETED. The wrinkle: `sendTgDm`'s body returned a plain `{ profileId,
// delivered, hasTgHandle }` record that the handler wrapped; that NORMALIZE moved
// INTO the body (it now returns `ActionOk { data = {…}, profileId }`), so the
// generic dispatch fnRef path maps it via `actionResultAdtToTs` like every other
// action — no information lost. Dispatch validates params against
// `paramRecordOf("notify:sendTgDm")` (D2 — no `tg_dm_params` mirror entity),
// injects `adapter` (D4) + `accountId`, invokes, maps the ADT.
//
// This file is now just the explicit `name → fnRef` exposure list (D3).
// ===========================================================================

export function registerNotificationActions() {
  registerAction({
    name: "tg_dm",
    description: "Send a Telegram DM to a profile",
    fnRef: "notify:sendTgDm",
  });
}
