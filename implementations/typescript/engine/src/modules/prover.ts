// ---------------------------------------------------------------------------
// Prover — module-substrate Phase 3i (close-out) seam — the both-maps capstone.
//
// prover registers the untrusted proposers (DecidableSetProver / ReductionProver
// / SampleTestProver / MonotonicityProver + the Phase-8 per-case checks) + the
// `kernel:verify` trust boundary, plus the 8 Prover dispatch instances. It is a
// PARTIAL 3/7 both-maps module: 3 of the 7 natives register in BOTH the plain
// `nativeImpls` AND the ctx `nativeImplsCtx` map (they re-enter the evaluator
// when a ctx is threaded but stay callable plain when it isn't — generalising
// 3h's total 4/4 overlap to the partial case).
//
// The ~1178-LOC hand-assembled module (7 `defineFunction` specs + the 6 inline
// `$variant` entity literals + the inline native impls) is RETIRED. The source
// of truth is now:
//   - `fenel/modules/prover/types.fenel` — the `module prover where` header + 6
//     `@native` decls (4 *Propose carry @codeName <name>Propose) + kernelVerify
//     + the 5 entity `data` decls (UnprovedReason / EpistemicStatus /
//     VerifyError / PropMonotonic / ProofStrategy — the closed Proposition +
//     ProofTerm sums RETIRED at decide-substrate Phase 2 K4: the claim currency
//     is the engine `Judgment`, the Prop*/proof tags survive as marker
//     vocabulary; see the types.fenel header);
//   - `fenel/modules/prover/routers.fenel` — expr-substrate Phase 6b: the 2
//     Fenel-bodied routers (`structuralPropose` / `smtPropose`) the 8→2
//     consolidation's two strategy instances name;
//   - `fenel/modules/prover/ffi/prover-ffi.ts` — the 7 proposer/kernel impls +
//     the plain & ctx native maps;
//   - `fenel/modules/prover/instances.fenel` — expr-substrate Phase 6b: the 8
//     per-shape Prover instances COLLAPSED to 2 (`Prover Structural` +
//     `Prover Smt`), loaded `{ dispatchInstanceFile: true }`, projected below.
//
// Thin seam: load types.fenel + routers.fenel + instances.fenel, re-id the cross-prefix
// `prover:kernelVerify` → `kernel:verify` (the trust boundary lives under the
// `kernel:` prefix; the same cross-prefix re-id the retired permissions module
// used),
// route BOTH native maps via `rekeyNativesById`, re-add the `kernel:kernelVerify`
// native at its explicit cross-prefix key, project the 8 Prover instance consts,
// and re-export every `*Native` + instance const + `proverNatives` +
// `isPropositionShape` (the heaviest consumer surface in the tree — a dropped
// re-export BREAKS THE BUILD: the law-validator, the self-host classifiers, and
// 4 test files import these by name). 0 consumer edits. No `@nativeCtx` marker
// (seam-routing suffices — axis #4).
// ---------------------------------------------------------------------------

import type { FenelModule, Instance, FenelFunction } from "../types";
import { rekeyNativesById } from "../function-builder";
import { loadFenelModule } from "../fenel-module";
import {
  decidableSetProposerNative,
  reductionProverNative,
  sampleTestProverNative,
  monotonicityProverNative,
  compilableSemanticCheckNative,
  partialEvaluatorSoundnessCheckNative,
  kernelVerifyNative,
  kernelVerifyNativeWrapped,
  proverNatives,
  proverNativesCtx,
  isPropositionShape,
} from "../../../../../fenel/modules/prover/ffi/prover-ffi";
import PROVER_TYPES_FENEL from "../../../../../fenel/modules/prover/types.fenel?raw";
import PROVER_ROUTERS_FENEL from "../../../../../fenel/modules/prover/routers.fenel?raw";
import PROVER_INSTANCES_FENEL from "../../../../../fenel/modules/prover/instances.fenel?raw";

// Declarative half — header + 6 @native decls + the 5 surviving ADT entities
// (Proposition/ProofTerm retired at decide-substrate Phase 2 K4).
// `loaded.functions` holds the 7 bodyless foreign decls (6 under `prover:` + the
// cross-prefix `prover:kernelVerify`); `loaded.instances` holds their per-fn
// identity ClassInstances; `loaded.entities` holds the 5 ADTs.
const loaded = loadFenelModule(PROVER_TYPES_FENEL, "prover", { label: "Prover" });

// expr-substrate Phase 6b — the 8→2 consolidation's two Fenel-bodied router
// fns (`prover:structuralPropose` / `prover:smtPropose`). Loaded as a sibling
// content file (a bodied `module prover where` alongside the @native types).
// `structuralPropose` pattern-matches the proposition $tag and delegates to
// the proposers by codeName; the fnId-keyed native aliases below make those
// codeName→spec.id→native calls resolve (the codeName≠fnId reconciliation).
const routers = loadFenelModule(PROVER_ROUTERS_FENEL, "prover", { label: "Prover" });

// ---------------------------------------------------------------------------
// Cross-prefix re-id: `prover:kernelVerify` → `kernel:verify`.
//
// `kernel:verify` is the trust boundary — registered under the `kernel:` prefix
// rather than `prover:`. A `module prover where` header prefixes every member
// `prover:`, so the cross-prefix member is authored as `prover:kernelVerify` and
// re-id'd here (the same cross-prefix mechanism the retired permissions module
// used). The
// rewrite touches the fn id + every identity instance keyed by the old id. The
// native is re-added at the explicit `kernel:kernelVerify` key below (NOT via
// `rekeyNativesById`, since `kernel:` ≠ the module name `prover`).
// ---------------------------------------------------------------------------

const OLD_ID = "prover:kernelVerify";
const NEW_ID = "kernel:verify";

const proverFunctions: FenelFunction[] = [
  ...(loaded.functions ?? []).map((f) => (f.id === OLD_ID ? { ...f, id: NEW_ID } : f)),
  // The 2 Fenel-bodied routers (no cross-prefix re-id — plain `prover:` ids).
  ...(routers.functions ?? []),
];
const proverFunctionSignatureDeclarations = [
  ...(loaded.functionSignatureDeclarations ?? []),
  ...(routers.functionSignatureDeclarations ?? []),
];
const proverFunctionInstances: Instance[] = [
  ...(loaded.instances ?? []).map((i) =>
    Array.isArray(i.args) && i.args[0] === OLD_ID
      ? { ...i, args: [NEW_ID, ...i.args.slice(1)] }
      : i,
  ),
  // The routers' identity facets (Codeable/Labelable/Describable/Taggable).
  ...(routers.instances ?? []),
];

// ---------------------------------------------------------------------------
// The 2 Prover dispatch instances — Fenel-authored typed values in
// `instances.fenel` (expr-substrate Phase 6b 8→2 consolidation). The eight
// per-proposition-shape instances collapsed to `Prover Structural` +
// `Prover Smt` keyed off the `ProofStrategy` ctor names. The
// `loadFenelModule` projection produces the `{typeName, args, methods,
// label}` shape; the exported consts are thin projection lookups (the engine
// barrel re-exports them).
// ---------------------------------------------------------------------------

const proverFenelInstances =
  loadFenelModule(PROVER_INSTANCES_FENEL, "prover", { dispatchInstanceFile: true }).instances ?? [];
const pickProverInst = (args: string[]): Instance => {
  const key = JSON.stringify(args);
  const found = proverFenelInstances.find(
    (i) => i.typeName === "Prover" && JSON.stringify(i.args) === key,
  );
  if (!found) throw new Error(`prover: missing Fenel instance Prover ${key}`);
  return found;
};

export const structuralProverInstance: Instance = pickProverInst(["Structural"]);
export const smtProverInstance: Instance = pickProverInst(["Smt"]);

const proverInstances: Instance[] = [
  ...proverFunctionInstances,
  structuralProverInstance,
  smtProverInstance,
];

// ---------------------------------------------------------------------------
// Module export — picked up by SYSTEM_MODULES in system-entities.ts +
// system-registry.ts + the runtime loadRegistry.
// ---------------------------------------------------------------------------

export const proverModule: FenelModule = {
  ...loaded,
  functionNamespaceOverrides: [{ functionId: NEW_ID, namespace: "kernel" }],
  functions: proverFunctions,
  functionSignatureDeclarations: proverFunctionSignatureDeclarations,
  instances: proverInstances,
  // PLAIN map (7 keys, rekeyed `prover:<codeName>`) + the cross-prefix
  // `kernel:kernelVerify` native re-added explicitly (rekey only relabels the
  // `prover`-prefixed entries; `kernel:` ≠ the module name).
  nativeImpls: {
    ...rekeyNativesById(proverNatives, "prover"),
    "kernel:kernelVerify": kernelVerifyNativeWrapped,
    // expr-substrate Phase 6b — fnId-keyed aliases for the 4 proposer natives.
    // The Fenel router (`structuralPropose`) calls them by codeName
    // (`decidableSetProverPropose` etc.); the evaluator resolves codeName →
    // spec.id (`prover:decidableSetProver`) then looks up the native at
    // spec.id. Without these aliases the codeName≠fnId-suffix reconciliation
    // (the native rides the codeName key `prover:<name>Propose`) leaves the
    // native unreachable from a Fenel call, blocking the pure-Fenel router.
    // The codeName-keyed entries stay (production dispatch + the oracle).
    "prover:decidableSetProver": proverNatives["decidableSetProverPropose"]!,
    "prover:reductionProver": proverNatives["reductionProverPropose"]!,
    "prover:sampleTestProver": proverNatives["sampleTestProverPropose"]!,
    "prover:monotonicityProver": proverNatives["monotonicityProverPropose"]!,
  },
  // CTX map (the partial 3/7 overlap, rekeyed `prover:<codeName>`).
  nativeImplsCtx: rekeyNativesById(proverNativesCtx, "prover") as Record<
    string,
    (ctx: unknown, ...args: unknown[]) => unknown
  >,
};

// Re-export the natives + the shape recognizer so test code + the law-validator
// + the self-host classifiers exercise the impls directly — preserved
// byte-for-byte from the retired seam, so no consumer needs an edit.
export {
  decidableSetProposerNative,
  reductionProverNative,
  sampleTestProverNative,
  monotonicityProverNative,
  compilableSemanticCheckNative,
  partialEvaluatorSoundnessCheckNative,
  kernelVerifyNative,
  proverNatives,
  isPropositionShape,
};

// browser-engine-compat Phase 1b: self-register this module's live namespace so
// engineRequire("modules/prover") resolves even at EVAL-TIME (a caller that statically imports
// this module runs its own eval-time builder calls AFTER this module is fully loaded,
// i.e. before the index.ts aggregator runs). See engine-require.ts.
import * as __self_modules_prover from "./prover";
import { registerEngineModule as __reg_modules_prover } from "../engine-require";
__reg_modules_prover("modules/prover", __self_modules_prover);
