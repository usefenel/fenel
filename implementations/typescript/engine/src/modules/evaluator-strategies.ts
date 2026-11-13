// ---------------------------------------------------------------------------
// Evaluator strategies — module-substrate Phase 3h seam (the BOTH-MAPS-FALLBACK
// representative).
//
// evaluator-strategies isolates the LAST unproven native-tier axis: the
// both-maps-fallback. `time` (3b) + `codec` (3d) proved the plain `nativeImpls`
// split; `picture` (3f) + the media cluster (3g) proved the ctx tier with a
// clean DISJOINT plain/ctx split. None forced a fnId into BOTH native maps.
// evaluator-strategies does — every one of the four fnIds (eagerEval / lazyEval
// / partialEval / jitEval) is dual-registered: the SAME codeName lands in BOTH
// `evaluatorNatives` (plain) AND `evaluatorNativesCtx` (ctx). At `applyOp`
// `ctx.nativesCtx` strictly wins, so the plain copy is dispatch-DEAD there — but
// it is LOAD-BEARING for the direct test reader `evaluator-dispatch.test.ts`
// (which builds its plain `natives` map from the re-exported `evaluatorNatives`),
// so the migration PRESERVES both maps byte-for-byte (parity-safe default).
//
// The ~563-LOC hand-assembled module (4 `defineFunction` specs + the inline
// native impls + helpers + the Fenel-instance projection) is RETIRED. The
// source of truth is now split:
//   - `fenel/modules/evaluator-strategies/types.fenel` — HEADER-LESS (the
//     hyphen blocks `module … where`; the name falls back to the loader arg),
//     the 4 `@native` FOREIGN DECLARATIONS (sig + @label/@description/
//     @category "evaluator"/@tags). 0 entities, 0 bodied helpers;
//   - `fenel/modules/evaluator-strategies/strategy-types.fenel` — four nominal
//     strategy declarations owned by the source container evaluatorStrategies;
//   - `fenel/modules/evaluator-strategies/ffi/evaluator-strategies-ffi.ts` —
//     the 4 native impls + helpers + BOTH native maps (the same 4 codeNames in
//     each) + the `*Native` re-exports the tests consume;
//   - `fenel/modules/evaluator-strategies/instances.fenel` — UNCHANGED; the 4
//     `Evaluator <Strategy>` dispatch instances (loaded `{ dispatchInstanceFile:
//     true }`), projected here via `pickEvaluatorInst`.
//
// This file is the thin SEAM: load the declarative types.fenel, load the
// instances.fenel, import the ffi leaf, route BOTH native maps via
// `rekeyNativesById`, merge `loaded.instances` (the per-function identity
// facets) with the 4 Evaluator dispatch instances, keep the 4 instance-const
// exports, and re-export the `*Native` fns so no consumer needs an edit.
//
// AXIS DECISIONS (brief):
//   #1 both-maps-fallback — seam-routing into BOTH maps suffices; the @native
//      foreign decl is UNIFORM, NO `@nativeCtx` marker (axis #4 holds for the
//      overlap case too). Confirmed end-to-end by the parity test's
//      dual-dispatch proof.
//   #2 ffi-leaf typing — the leaf imports the REAL engine internals (evaluate /
//      EvaluateContext / the eval-result ctors / the PE + compile-js bridges),
//      faithful to the retired module; the seam casts nothing (the ctx map is
//      already typed `(ctx: unknown, …)`).
//   plain-fallback verdict — LOAD-BEARING (direct reader in
//      evaluator-dispatch.test.ts), so PRESERVED.
// ---------------------------------------------------------------------------

import type { FenelModule, Instance } from "../types";
import { rekeyNativesById } from "../function-builder";
import { loadFenelModule } from "../fenel-module";
import EVALUATOR_TYPES_FENEL from "../../../../../fenel/modules/evaluator-strategies/types.fenel?raw";
import EVALUATOR_STRATEGY_TYPES_FENEL from "../../../../../fenel/modules/evaluator-strategies/strategy-types.fenel?raw";
import EVALUATOR_INSTANCES_FENEL from "../../../../../fenel/modules/evaluator-strategies/instances.fenel?raw";
import {
  EAGER_STRATEGY,
  LAZY_STRATEGY,
  PARTIAL_STRATEGY,
  JIT_STRATEGY,
} from "../evaluator-class";
import {
  evaluatorNatives,
  evaluatorNativesCtx,
  eagerEvalNative,
  lazyEvalNative,
  jitEvalNative,
} from "../../../../../fenel/modules/evaluator-strategies/ffi/evaluator-strategies-ffi";

// Declarative half — the 4 `@native` foreign declarations. `loaded.instances`
// holds the per-function identity ClassInstances (Codeable / Labelable /
// Categorizable / Describable / Taggable for all 4) lifted from the @facet
// directives + the header-less name default. The `evaluator-strategies:` id
// prefix is preserved by the loader name arg (header-less → effectiveName falls
// back to it).
const loaded = loadFenelModule(EVALUATOR_TYPES_FENEL, "evaluator-strategies", {
  label: "Evaluator strategies",
});
const strategyTypes = loadFenelModule(EVALUATOR_STRATEGY_TYPES_FENEL, "evaluatorStrategies");

// ---------------------------------------------------------------------------
// Instances — one per strategy. Each `Evaluator <Strategy>` keys its eval impl
// off a strategy tag (args[0]). The 4 instances are Fenel-authored typed values
// in `instances.fenel` (loaded `{ dispatchInstanceFile: true }`); the exported
// consts are thin projection lookups (the engine barrel re-exports them, and
// downstream + tests import `eagerEvaluatorInstance` etc. directly).
// ---------------------------------------------------------------------------

const evaluatorFenelInstances =
  loadFenelModule(EVALUATOR_INSTANCES_FENEL, "evaluator-strategies", { dispatchInstanceFile: true }).instances ?? [];
const pickEvaluatorInst = (args: string[]): Instance => {
  const key = JSON.stringify(args);
  const found = evaluatorFenelInstances.find(
    (i) => i.typeName === "Evaluator" && JSON.stringify(i.args) === key,
  );
  if (!found) throw new Error(`evaluator-strategies: missing Fenel instance Evaluator ${key}`);
  return found;
};

export const eagerEvaluatorInstance: Instance = pickEvaluatorInst([EAGER_STRATEGY]);
export const lazyEvaluatorInstance: Instance = pickEvaluatorInst([LAZY_STRATEGY]);
export const partialEvaluatorInstance: Instance = pickEvaluatorInst([PARTIAL_STRATEGY]);
export const jitEvaluatorInstance: Instance = pickEvaluatorInst([JIT_STRATEGY]);

const evaluatorInstances: Instance[] = [
  ...(loaded.instances ?? []),
  eagerEvaluatorInstance,
  lazyEvaluatorInstance,
  partialEvaluatorInstance,
  jitEvaluatorInstance,
];

// ---------------------------------------------------------------------------
// Module export — picked up by SYSTEM_MODULES in system-entities.ts /
// system-registry.ts and the runtime's loadRegistry. BOTH native maps carry the
// same 4 ids — the both-maps-fallback — rekeyed codeName → `evaluator-strategies:codeName`.
//
// modules-as-values (2026-09-24) — the container is `evaluatorStrategies`, an
// identifier, so its members read dotted (`evaluatorStrategies.eagerEval`); a
// hyphenated name parses as a subtraction. `functionNamespace` keeps every
// function id `evaluator-strategies:*` (the loader argument above). The strategy
// types retain that actual source/container owner; the legacy native
// function namespace and both native maps keep their existing identities.
// ---------------------------------------------------------------------------

export const evaluatorStrategiesModule: FenelModule = {
  ...loaded,
  functionNamespace: "evaluator-strategies",
  name: "evaluatorStrategies",
  entities: [...(loaded.entities ?? []), ...(strategyTypes.entities ?? [])],
  instances: evaluatorInstances,
  nativeImpls: rekeyNativesById(evaluatorNatives, "evaluator-strategies"),
  nativeImplsCtx: rekeyNativesById(evaluatorNativesCtx, "evaluator-strategies"),
};

// Re-export the natives for direct use in tests — `evaluator-dispatch.test.ts`
// builds its plain `natives` map from `evaluatorNatives` (the load-bearing
// direct reader of the plain map), and `evaluator-class.test.ts` /
// `partial-evaluator.test.ts` exercise the `*Native` impls in isolation. The
// export surface is preserved byte-for-byte from the retired seam.
export {
  eagerEvalNative,
  lazyEvalNative,
  jitEvalNative,
  evaluatorNatives,
};

// browser-engine-compat Phase 1b: self-register this module's live namespace so
// engineRequire("modules/evaluator-strategies") resolves even at EVAL-TIME (a caller that statically imports
// this module runs its own eval-time builder calls AFTER this module is fully loaded,
// i.e. before the index.ts aggregator runs). See engine-require.ts.
import * as __self_modules_evaluator_strategies from "./evaluator-strategies";
import { registerEngineModule as __reg_modules_evaluator_strategies } from "../engine-require";
__reg_modules_evaluator_strategies("modules/evaluator-strategies", __self_modules_evaluator_strategies);
