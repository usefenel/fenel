import { registerAction } from "./registry";

// ===========================================================================
// Entitlements actions — action-subsumption (the public actions ARE typed Fenel
// functions; D1 COLLAPSE).
//
//   grant_entitlement  → entitlements:grantEntitlement   (Phase 3, 2026-06-08)
//   revoke_entitlement → entitlements:revokeEntitlement  (Phase 2)
//   check_access       → entitlements:checkAccess        (Phase 2, read-only)
//
// Every TS handler (+ its `toMaybe` marshalling + `validateActionParams` call)
// is DELETED. Dispatch (core/src/dispatch.ts) resolves each by name → fnRef,
// validates the incoming params against the function's own param-record
// (`paramRecordOf(fnRef)`, D2 — no `*_params` mirror entity), injects `adapter`
// (D4) + `accountId`, invokes the body, and maps the returned `ActionResult` ADT
// at the boundary. grant_entitlement's `startsAt ?? now` residual lives in the
// `.fenel` body (resolveStartsAt), untouched by the port.
//
// This file is now just the explicit `name → fnRef` exposure list (D3).
// ===========================================================================

export function registerEntitlementActions() {
  registerAction({
    name: "grant_entitlement",
    description: "Grant an entitlement to a profile",
    fnRef: "entitlements:grantEntitlement",
  });

  registerAction({
    name: "revoke_entitlement",
    description: "Revoke an entitlement (sets revokedAt)",
    fnRef: "entitlements:revokeEntitlement",
  });

  registerAction({
    name: "check_access",
    description:
      "Check if a profile has valid access to an item (read-only, no event)",
    fnRef: "entitlements:checkAccess",
  });
}
