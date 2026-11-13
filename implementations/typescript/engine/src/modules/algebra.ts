// ---------------------------------------------------------------------------
// Algebra module — the Fenel-bodied method functions backing the Functor /
// Monad / Monoid instances, plus the projected instances themselves.
//
// Phase 5 of typeclass-substrate-completion (2026-05-29). The payoff of the
// workstream: the canonical FP trinity lives ON THE MODEL.
//
// typed-function-references · FenelModule-retirement Phase FM-retire-2
// (2026-06-06): the 5 `defineFunction` specs are RETIRED. Source of truth is
// `fenel/std/algebra-methods.fenel` — now a self-sufficient `module algebra
// where` file carrying the 5 generic-typed signatures + identity facets ABOVE
// the (unchanged) bodies. This seam collapses to the `templates.ts` shape (0
// `defineFunction`): it loads that file (functions + facets + bodies) and
// merges the `algebra-instances.fenel` dispatch instances exactly as before.
//
//   - The CLASSES (Functor / Monad / Monoid) are ordinary `.fenel` record
//     types in `fenel/std/algebra.fenel` — dispatch-authoritative as of Phase
//     3.3a: `buildRegistry` (system-entities.ts) derives their dispatch seeds
//     from those record types via `effect-dispatch.ts:seedFromType` and
//     `defineClass`es them. Loaded SEPARATELY; out of this seam.
//   - The METHOD BODIES are PURE Fenel (Fenel-first HARD RULE) — authored in
//     `fenel/std/algebra-methods.fenel`. List's fmap and both Monoid mappends
//     reuse `std:map` / `std:concat`; only Maybe/Result fmap+bind and List's
//     arg-flip bind need dedicated bodies.
//   - The INSTANCES are Fenel-authored typed values in
//     `fenel/std/algebra-instances.fenel`, projected to `Instance`s via the
//     `dispatchInstanceFile` loader. Each method value is an fnId STRING the
//     dispatch surface applies through `invokeFunction`.
//
// `fmap` / `bind` (`>>=`) / `mappend` (`<>`) dispatch by use-site reflection
// through the same general method-dispatch surface (Phase 3.5) every other
// typeclass / effect / capability uses — no per-class engine branch. See
// `design/unified-dispatch.md`.
// ---------------------------------------------------------------------------

import type { FenelModule } from "../types";
import { loadFenelModule } from "../fenel-module";
import ALGEBRA_METHODS_FENEL from "../../../../../fenel/std/algebra-methods.fenel?raw";
import ALGEBRA_INSTANCES_FENEL from "../../../../../fenel/std/algebra-instances.fenel?raw";

// The 5 method functions + identity facets + bodies (from algebra-methods.fenel,
// `module algebra where` → `algebra:*` ids matching the instances + the lock).
const loaded = loadFenelModule(ALGEBRA_METHODS_FENEL, "algebra", { label: "Algebra" });

// The Functor / Monad / Monoid / … dispatch instances — each method a qualified
// function reference (`fmap = algebra.maybeFmap`, modules-as-values Phase 2b)
// that the dispatch surface applies through `invokeFunction`.
const algebraTypeclassInstances =
  loadFenelModule(ALGEBRA_INSTANCES_FENEL, "algebra", { dispatchInstanceFile: true }).instances ?? [];

// ---------------------------------------------------------------------------
// Module export — picked up by SYSTEM_MODULES (system-entities.ts: instances
// → dispatchRegistry) and the system-registry module list (functions → registry).
// ---------------------------------------------------------------------------

export const algebraModule: FenelModule = {
  name: "algebra",
  label: "Algebra",
  functions: loaded.functions,
  instances: [...(loaded.instances ?? []), ...algebraTypeclassInstances],
};
