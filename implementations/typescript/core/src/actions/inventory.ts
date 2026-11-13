import { registerAction } from "./registry";

// ===========================================================================
// Inventory actions — action-subsumption (the public actions ARE typed Fenel
// functions; D1 COLLAPSE).
//
//   create_inventory     → inventory:createInventory          (Phase 3, 2026-06-08)
//   reserve_spot         → inventory:reserveSpot              (Phase 3)
//   release_spot         → inventory:releaseSpot              (Phase 2)
//   get_inventory_status → inventory:getInventoryStatusAction (Phase 2, read-only)
//
// Every TS handler (+ its `toMaybeStr` marshalling + `validateActionParams`
// call) is DELETED. Dispatch resolves each by name → fnRef, validates the
// incoming params against the function's own param-record (`paramRecordOf(fnRef)`,
// D2 — no `*_params` mirror entity), injects `adapter` (D4) + `accountId`,
// invokes the body, and maps the returned `ActionResult` ADT at the boundary.
//
// create_inventory's `enforce ?? "soft"` default + reserve_spot's capacity FSM
// stay in the `.fenel` bodies, untouched by the port. reserve_spot's `accountId`
// formal is supplied by the dispatcher (CONTEXT_INJECTED_PARAMS, sibling of
// adapter), so it never enters the public form.
//
// This file is now just the explicit `name → fnRef` exposure list (D3).
// ===========================================================================

export function registerInventoryActions() {
  registerAction({
    name: "create_inventory",
    description: "Create a tracked inventory with capacity",
    fnRef: "inventory:createInventory",
  });

  registerAction({
    name: "reserve_spot",
    description: "Lock a spot in an inventory for a profile",
    fnRef: "inventory:reserveSpot",
  });

  registerAction({
    name: "release_spot",
    description: "Release a reservation",
    fnRef: "inventory:releaseSpot",
  });

  registerAction({
    name: "get_inventory_status",
    description: "Get capacity/available/reserved counts (read-only)",
    fnRef: "inventory:getInventoryStatusAction",
  });
}
