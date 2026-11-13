import { registerAction } from "./registry";

// ===========================================================================
// Channels actions — action-subsumption Phase 2 (the no-residual bulk wave,
// 2026-06-08).
//
// The public action IS a typed Fenel function now (D1 COLLAPSE):
//   create_channel → channels:createChannel  (fenel/modules/channels/channels.fenel)
//
// The former TS handler (`createChannelHandler` + its `toMaybe` marshalling +
// `validateActionParams` call) is DELETED. Dispatch (core/src/dispatch.ts)
// resolves this by name → fnRef, validates the incoming params against the
// function's own param-record (`paramRecordOf(fnRef)`, D2 — no
// `create_channel_params` mirror entity), injects `adapter` (D4 — still an
// explicit param; the Channel arc removes it later), invokes the body, and
// maps the returned `ActionResult` ADT at the boundary.
//
// This file is now just the explicit `name → fnRef` exposure list (D3).
// ===========================================================================

export function registerChannelActions() {
  registerAction({
    name: "create_channel",
    description: "Create a notification channel (TG group, webhook, email)",
    fnRef: "channels:createChannel",
  });
}
