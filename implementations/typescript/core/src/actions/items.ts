import { registerAction } from "./registry";

// ===========================================================================
// Items actions — action-subsumption Phase 1 (the pilot, 2026-06-08).
//
// The two public actions ARE typed Fenel functions now (D1 COLLAPSE):
//   create_item → items:createItem   (fenel/modules/items/items.fenel)
//   update_item → items:updateItem
//
// The former TS handlers (`createItemHandler` / `updateItemHandler` + their
// `toMaybe` marshalling + `validateActionParams` calls) are DELETED. Dispatch
// (core/src/dispatch.ts) resolves these by name → fnRef, validates the incoming
// params against the function's own param-record (`paramRecordOf(fnRef)`, D2 —
// no `create_item_params` / `update_item_params` mirror entity), injects
// `adapter` (D4 — still an explicit param; the Channel arc removes it later),
// invokes the body, and maps the returned `ActionResult` ADT at the boundary.
//
// This file is now just the explicit `name → fnRef` exposure list (D3) — NOT a
// `PublicAction` marker, NOT the bare registry. The `registerAction` /
// `ActionDefinition` mechanism stays until the rights/ownership arc replaces
// the exposure list with policy-grant resolution.
// ===========================================================================

export function registerItemActions() {
  registerAction({
    name: "create_item",
    description: "Create a new item (product/access/resource)",
    fnRef: "items:createItem",
  });

  registerAction({
    name: "update_item",
    description: "Update an existing item",
    fnRef: "items:updateItem",
  });
}
