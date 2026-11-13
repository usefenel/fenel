// ---------------------------------------------------------------------------
// Entitlements — ts-elimination-completion Phase 2 generic-loader seam.
//
// NEW module (entitlements had no `.fenel` source before this phase). The
// source of truth is `fenel/modules/entitlements/entitlements.fenel`, which
// carries the `module entitlements where` header, the per-function `name :
// Type` sigs, and the `@label` / `@description` / `@tags` / `@ioAction` /
// `@codeName` facet directives the loader lifts into the SAME Codeable /
// Labelable / Describable / Categorizable / Taggable / IOInvokable
// `Instance`s a `defineFunction` spec would emit.
//
// This file is the thin SEAM (mirror of `items.ts` / `plans.ts`): it loads
// that `.fenel` into a `FenelModule` and is registered at the same boot
// surfaces — engine `SYSTEM_MODULES` (system-entities.ts), `type-catalog.ts`,
// runtime `loadRegistry` (evaluator.ts), the self-host matrix generator, and
// the engine `package.json` exports map. The Group-3 read leaves the bodies
// consume (state:findItemBySlug + state:checkProfileAccess) were added to the
// state module + runtime state handlers in the same commit.
//
// The `module entitlements where` header keeps the LEGACY lowercase
// `entitlements:` id-prefix + `entitlements` category byte-identical (no fnId
// rename). `requires: [HasStateIO]` is supplied by `createRegistry`'s
// `attachInferredRequires` pass (transitive from the `state:*` calls).
// ---------------------------------------------------------------------------

import type { FenelModule } from "../types";
import { loadFenelModule } from "../fenel-module";
import ENTITLEMENTS_FENEL from "../../../../../fenel/modules/entitlements/entitlements.fenel?raw";

// The `"entitlements"` arg is a fallback only — the `module entitlements
// where` header in the `.fenel` is authoritative (overrides it). `label`
// preserves the bundle's display label ("Entitlements").
export const entitlementsModule: FenelModule = loadFenelModule(
  ENTITLEMENTS_FENEL,
  "entitlements",
  { label: "Entitlements" },
);
