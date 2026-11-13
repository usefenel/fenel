// ---------------------------------------------------------------------------
// Items — ts-elimination-completion Phase 2 generic-loader seam.
//
// NEW module (items had no `.fenel` source before this phase). The source of
// truth is `fenel/modules/items/items.fenel`, which carries the `module items
// where` header, the per-function `name : Type` sigs, and the `@label` /
// `@description` / `@tags` / `@ioAction` facet directives the loader lifts into
// the SAME Codeable / Labelable / Describable / Categorizable / Taggable /
// IOInvokable `Instance`s a `defineFunction` spec would emit.
//
// This file is the thin SEAM (mirror of `inventory.ts` / `profiles.ts`): it
// loads that `.fenel` into a `FenelModule` and is registered at the same boot
// surfaces — engine `SYSTEM_MODULES` (system-entities.ts), `type-catalog.ts`,
// runtime `loadRegistry` (evaluator.ts), and the self-host matrix generator.
//
// The `module items where` header keeps the LEGACY lowercase `items:`
// id-prefix + `items` category byte-identical (no fnId rename — the
// lowercase→PascalCase canonicalisation is a deferred coordinated sweep). The
// `requires: [HasStateIO]` is supplied by `createRegistry`'s
// `attachInferredRequires` pass (transitive from the `state:*` calls).
// ---------------------------------------------------------------------------

import type { FenelModule } from "../types";
import { loadFenelModule } from "../fenel-module";
import ITEMS_FENEL from "../../../../../fenel/modules/items/items.fenel?raw";

// The `"items"` arg is a fallback only — the `module items where` header in
// the `.fenel` is authoritative (overrides it). `label` preserves the
// bundle's display label ("Items").
export const itemsModule: FenelModule = loadFenelModule(ITEMS_FENEL, "items", {
  label: "Items",
});
