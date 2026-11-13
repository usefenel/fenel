// ---------------------------------------------------------------------------
// Profiles — module-substrate Phase 3c generic-loader seam.
//
// Tier-1 pure Shape-B migration (mechanical repeat of Phase 3a's `inventory`).
// The 31 `defineFunction` specs (signatures + identity facets) that used to
// live here are RETIRED — the source of truth is now
// `fenel/modules/profiles/profiles.fenel`, which carries the `module profiles
// where` header, the per-function `name : Type` sigs, and the `@label` /
// `@description` / `@tags` / `@ioAction` facet directives. The loader lifts
// those into the SAME Codeable / Labelable / Describable / Categorizable /
// Taggable / IOInvokable `Instance`s the old defineFunction specs emitted.
//
// This file is the thin SEAM: it loads that `.fenel` into a `FenelModule`
// and feeds the SAME boot surfaces the hand-written bundle did — engine
// `SYSTEM_MODULES` (instance-merge into the dispatchRegistry) + runtime
// `loadRegistry` (functions / IO-handler registration). Both lists already
// reference `profilesModule` by name, so the seam is transparent: no list
// edits. Bodies were ALREADY `.fenel` (self-host invariant); now the
// declaration/registration wrapper is too.
//
// The `module profiles where` header keeps the LEGACY lowercase `profiles:`
// id-prefix + `profiles` category byte-identical (no fnId rename here — the
// lowercase→PascalCase canonicalisation is a deferred coordinated sweep).
// The `requires: [HasStateIO]` the specs declared are now supplied by
// `createRegistry`'s `attachInferredRequires` pass (transitive from the
// `state:*` / `dispatch:*` calls). Parity proven by
// `engine/src/module-migrate-profiles.test.ts`.
//
// NOTE: `dashboard.ts` loads its OWN `fenel/modules/dashboard/profiles.fenel`
// (a distinct file) — it does NOT consume this module's `.fenel`, so the
// rename here is local.
// ---------------------------------------------------------------------------

import type { FenelModule } from "../types";
import { loadFenelModule } from "../fenel-module";
import PROFILES_FENEL from "../../../../../fenel/modules/profiles/profiles.fenel?raw";

// The `"profiles"` arg is a fallback only — the `module profiles where`
// header in the `.fenel` is authoritative (overrides it). `label` preserves
// the bundle's display label ("Profiles").
export const profilesModule: FenelModule = loadFenelModule(PROFILES_FENEL, "profiles", {
  label: "Profiles",
});
