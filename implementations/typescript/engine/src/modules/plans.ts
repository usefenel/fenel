// ---------------------------------------------------------------------------
// Plans — ts-elimination-completion Phase 2 generic-loader seam.
//
// NEW module (plans had no `.fenel` source before this phase). The source of
// truth is `fenel/modules/plans/plans.fenel`, which carries the `module plans
// where` header, the per-function `name : Type` sigs, and the `@label` /
// `@description` / `@tags` / `@ioAction` / `@codeName` facet directives the
// loader lifts into the SAME Codeable / Labelable / Describable /
// Categorizable / Taggable / IOInvokable `Instance`s a `defineFunction`
// spec would emit.
//
// This file is the thin SEAM (mirror of `items.ts` / `inventory.ts`): it loads
// that `.fenel` into a `FenelModule` and is registered at the same boot
// surfaces — engine `SYSTEM_MODULES` (system-entities.ts), `type-catalog.ts`,
// runtime `loadRegistry` (evaluator.ts), the self-host matrix generator, and
// the engine `package.json` exports map.
//
// The `module plans where` header keeps the LEGACY lowercase `plans:`
// id-prefix + `plans` category byte-identical (no fnId rename — the
// lowercase→PascalCase canonicalisation is a deferred coordinated sweep). The
// `requires: [HasStateIO]` is supplied by `createRegistry`'s
// `attachInferredRequires` pass (transitive from the `state:*` calls).
// ---------------------------------------------------------------------------

import type { FenelModule } from "../types";
import { loadFenelModule } from "../fenel-module";
import PLANS_FENEL from "../../../../../fenel/modules/plans/plans.fenel?raw";

// The `"plans"` arg is a fallback only — the `module plans where` header in
// the `.fenel` is authoritative (overrides it). `label` preserves the
// bundle's display label ("Plans").
export const plansModule: FenelModule = loadFenelModule(PLANS_FENEL, "plans", {
  label: "Plans",
});
