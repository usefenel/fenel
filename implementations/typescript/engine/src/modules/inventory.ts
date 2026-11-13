// ---------------------------------------------------------------------------
// Inventory — module-substrate Phase 3a generic-loader seam.
//
// FIRST `FenelModule` → `module … where` migration. The 11 `defineFunction`
// specs (signatures + identity facets) that used to live here are RETIRED —
// the source of truth is now `fenel/modules/inventory/manage.fenel`, which
// carries the `module inventory where` header, the per-function `name : Type`
// sigs, and the `@label` / `@description` / `@tags` / `@ioAction` facet
// directives. The loader lifts those into the SAME Codeable / Labelable /
// Describable / Categorizable / Taggable / IOInvokable `Instance`s the
// old defineFunction specs emitted.
//
// This file is the thin SEAM (DECISION 3): it loads that `.fenel` into a
// `FenelModule` and feeds the SAME boot surfaces the hand-written bundle did —
// engine `SYSTEM_MODULES` (instance-merge into the dispatchRegistry) + runtime
// `loadRegistry` (functions / IO-handler registration). Both lists already
// reference `inventoryModule` by name, so the seam is transparent: no list
// edits. Bodies were ALREADY `.fenel` (self-host invariant); now the
// declaration/registration wrapper is too.
//
// The `module inventory where` header keeps the LEGACY lowercase `inventory:`
// id-prefix + `inventory` category byte-identical (no fnId rename here — the
// lowercase→PascalCase canonicalisation is a deferred coordinated sweep that
// would have to rewrite stored function ids). Every fnId / codeName / label /
// category / description / tag / ioAction therefore resolves exactly as
// before — proven by `engine/src/module-migrate-inventory.test.ts`. The
// `requires: [HasStateIO]` the specs declared are now supplied by
// `createRegistry`'s `attachInferredRequires` pass (transitive from the
// `state:*` calls), so the effect audit stays clean.
//
// The other 45 modules stay on the TS `defineFunction` path — this is the
// gradual seam (mirrors the resolver's kept flat-global fallback), not a
// big-bang. See `workstreams/module-substrate/notes/migration-recipe.md`.
// ---------------------------------------------------------------------------

import type { FenelModule } from "../types";
import { loadFenelModule } from "../fenel-module";
import MANAGE_FENEL from "../../../../../fenel/modules/inventory/manage.fenel?raw";

// The `"inventory"` arg is a fallback only — the `module inventory where`
// header in the `.fenel` is authoritative (overrides it). `label` preserves
// the bundle's display label ("Inventory").
export const inventoryModule: FenelModule = loadFenelModule(MANAGE_FENEL, "inventory", {
  label: "Inventory",
});
