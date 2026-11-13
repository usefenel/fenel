// ---------------------------------------------------------------------------
// Prover — FFI leaf (the 7 proposer / kernel-bridge natives).
//
// module-substrate Phase 3i parked the 7 native impls here; expr-substrate
// Phase 6b0 ported the PURE arms to `.fenel` (Rom directive 2026-06-11 —
// no pure logic in TS). The registered surface (fnIds, arities, natives-map
// keys, the 8 Prover dispatch instances) is UNCHANGED; what changed is what
// the natives DO:
//
//   decidableSetProposerNative   → marshal + pre-compute the tri-state
//                                  decide + dispatch `engine:proposeDecidableSet`
//                                  (routing/grading/witness logic is Fenel)
//   sampleTestProverNative       → marshal + dispatch `engine:proposeSampleTest`
//   monotonicityProverNative     → registry reads + marshal + dispatch
//                                  `engine:proposeMonotonic`
//   kernelVerifyNative           → kernel.verify (itself a 6b0 delegate over
//                                  `engine:verifyProof`)
//
// TS-residue ledger (6b0 — every surviving fn, categorised):
//   decidableSetProposerNative   — $-key marshal ($tag read) + the
//     isSubset/isDisjoint/decideEmpty re-run CALL (host re-entry bridge; the
//     set-algebra dispatchers route through the Fenel decider mirrors where
//     ported) + marker→ProofTerm/UnprovedReason `$tag` authoring.
//   sampleTestProverNative       — $-key marshal ($tag read, samples length)
//     + marker→shape authoring.
//   monotonicityProverNative     — Aggregable registry reads (isAggregable +
//     the lazy dispatchRegistry resolve — host registry bridge) + $tag/typeof
//     marshal + marker→shape authoring.
//   reductionProverNative        — GENUINE BRIDGE: reduces both PropEq
//     operands via the evaluator (host re-entry; un-portable by definition).
//   compilableSemanticCheckNative— GENUINE BRIDGE: compiles + executes via
//     `new Function` (host re-entry).
//   partialEvaluatorSoundnessCheckNative — GENUINE BRIDGE: partialEval +
//     evaluator re-entry.
//   kernelVerifyNative           — delegate to the kernel trust boundary.
//   isReducible / isCompilableCase / isPECase / isPropositionShape — typeof
//     shape guards for the bridge inputs (host-typeof boundary).
//   proposeOk/proposeErr + the maps + marker mapping — `$tag` authoring
//     boundary (a Fenel body cannot author `{$tag: …}` shapes).
//
// The content-gate (`ts-elimination-completion`) permits `.ts` under
// `fenel/modules/` ONLY inside an `ffi/` folder.
// ---------------------------------------------------------------------------

// browser-engine-compat Phase 1b: browser-safe lazy engine-module lookup (was require())
import { engineRequire } from "../../../../implementations/typescript/engine/src/engine-require";
import type {
  Proposition,
  ProofTerm,
  UnprovedReason,
  EqProposition,
} from "../../../../implementations/typescript/engine/src/prover";
import {
  reflProof,
  decidableSetProof,
  sampleTestProof,
  unprovedOutOfScope,
  unprovedUndecided,
  unprovedBudgetExceeded,
  unprovedWitnessError,
  isProposition,
} from "../../../../implementations/typescript/engine/src/prover";
import {
  verify,
  recheckPlanFor,
  decideByPlan,
  type VerifyResult,
} from "../../../../implementations/typescript/engine/src/kernel";
import { mJust, mJustFalse, mNothing, type MaybeBool } from "../../../../implementations/typescript/engine/src/maybe-bool";
import { deepEqual, truthy, type EvaluateContext } from "../../../../implementations/typescript/engine/src/json-logic";
import { resolveEvaluator } from "../../../../implementations/typescript/engine/src/evaluator-class";
import { compileFenelToJsNative } from "../../../../implementations/typescript/engine/src/modules/compile-js";
import {
  dispatchedSerializeJsModule,
  dispatchEngineBody,
  dispatchEngineBodyWithDeciderCtx,
  dispatchedPartialEvalInCtx,
  marshalPatterns,
} from "../../../../implementations/typescript/engine/src/engine-bodies-dispatch";
import type { CompileSource } from "../../../../implementations/typescript/engine/src/compilable";
import { positionalCompileFieldSlots } from "../../../../implementations/typescript/engine/src/compile-field-slots";
import { isAggregable } from "../../../../implementations/typescript/engine/src/aggregable";
// The typeclass registry is imported lazily — see `lookupAggregableMethods`.
// A direct top-level import would create a load-cycle with `system-entities.ts`
// (which imports `proverModule` from the seam that imports this leaf). Functions
// resolve the registry on demand, by which time both modules are initialised.

// ---------------------------------------------------------------------------
// Result helpers — match the Fenel-side shape (`{$tag: "Ok"/"Err", value}`)
// so the proposer outputs flow through evaluator dispatch without re-shaping.
// The kernel reads the same shape. (6b0 category: `$tag` authoring boundary.)
// ---------------------------------------------------------------------------

type ProposeOutcome =
  | { readonly $tag: "Ok"; readonly _0: ProofTerm }
  | { readonly $tag: "Err"; readonly _0: UnprovedReason };

const proposeOk = (t: ProofTerm): ProposeOutcome => ({ $tag: "Ok", _0: t });
const proposeErr = (r: UnprovedReason): ProposeOutcome => ({ $tag: "Err", _0: r });

// ---------------------------------------------------------------------------
// Boundary helpers — `$tag` extraction + the proposer-marker mapping.
// ---------------------------------------------------------------------------

/** `$tag` read leaf — "" when absent/non-string (the Fenel guard
 *  `startsWith propTag "Prop"` then rejects, mirroring isProposition). */
function propTagOf(x: unknown): string {
  const t = (x as { $tag?: unknown } | null | undefined)?.$tag;
  return typeof t === "string" ? t : "";
}

/** Proposer outcome-marker → the Ok ProofTerm / Err UnprovedReason shapes
 *  (6b0 category: `$tag` authoring boundary). */
function markerToPropose(marker: unknown): ProposeOutcome {
  const m = marker as {
    tag?: string;
    kind?: "subset" | "disjoint" | "empty" | "nonempty" | "witness" | "mu-induction";
    witness?: { left: unknown; right?: unknown };
    ptag?: string;
    propertyId?: string;
    samplesChecked?: number;
    allPassed?: boolean;
    rtag?: string;
    note?: string;
    counterexample?: unknown;
  };
  if (!m || typeof m !== "object") {
    throw new Error("prover-ffi: proposer body returned no outcome marker");
  }
  if (m.tag === "Ok") {
    if (m.ptag === "SampleTestResult") {
      return proposeOk(sampleTestProof(m.propertyId as string, m.samplesChecked as number, m.allPassed as boolean));
    }
    // decide-substrate 8λ.4 (Commit B) — the witness-value pattern marshal
    // (the dispatchedInhabit discipline): an inhabit-derived witness can be a
    // case-split closure whose {match:[…]} body carries raw Pattern ADT
    // values; author the wire $bind/$tag shapes at this egress. No-op for
    // pattern-free witnesses.
    return proposeOk(decidableSetProof(m.kind!, marshalPatterns(m.witness!) as typeof m.witness & object));
  }
  if (m.rtag === "WitnessError") return proposeErr(unprovedWitnessError(m.counterexample));
  if (m.rtag === "OutOfScope") return proposeErr(unprovedOutOfScope(m.note));
  if (m.rtag === "Undecided") return proposeErr(unprovedUndecided(m.note));
  return proposeErr(unprovedBudgetExceeded(m.note));
}

// ---------------------------------------------------------------------------
// DecidableSetProver — PropSubset / PropDisjoint / PropEmpty
// (routing/grading Fenel-bodied; the decide re-run is the justified bridge)
// ---------------------------------------------------------------------------

function decidableSetProposerNative(proposition: unknown): ProposeOutcome {
  // K3 (decide-substrate Phase 2): the claim — a closed-sum Proposition
  // (compat until K4) or a Judgment (JEmpty/JInhabited) — routes through the
  // ONE Fenel shape recognizer (`engine:recheckPlan` via `recheckPlanFor`);
  // this seam keeps only the tri-state decide CALL keyed on the plan
  // (`decideByPlan`, the shared kernel seam — proposer catch flavour
  // "unknown"). The retired TS tag-ladder lived here pre-K3.
  const propTag = propTagOf(proposition);
  const decision = decideByPlan(recheckPlanFor(proposition), "unknown");
  // decide-substrate Phase 4T Step W — the DECIDER ctx: the nonempty arm's
  // search widening (proposeNonemptyViaSearch → searchCore → testFilters →
  // setAlgebraContains) reaches the membership seams (whereMember/namedMember/
  // patternMember) by bare name, so this dispatch must supply them (the
  // dispatchedInhabit precedent).
  const marker = dispatchEngineBodyWithDeciderCtx("engine:proposeDecidableSet", [
    propTag,
    proposition,
    decision,
  ]);
  return markerToPropose(marker);
}

// ---------------------------------------------------------------------------
// ReductionProver — PropEq propositions decided by evaluator reduction.
// 6b0 category: GENUINE BRIDGE — re-enters the evaluator to reduce both
// operands; the reduction itself cannot be a Fenel body (it IS evaluation).
// ---------------------------------------------------------------------------

function reductionProverNative(proposition: unknown, ctx?: EvaluateContext): ProposeOutcome {
  if (!isProposition(proposition)) {
    return proposeErr(unprovedOutOfScope("ReductionProver expects a structured Proposition"));
  }
  if (proposition.$tag !== "PropEq") {
    return proposeErr(unprovedOutOfScope(`ReductionProver doesn't handle ${proposition.$tag}`));
  }
  const eqProp = proposition as EqProposition;
  let lhs: unknown;
  let rhs: unknown;
  try {
    const evalFn = resolveEvaluator(ctx);
    lhs = isReducible(eqProp.lhs) ? evalFn(eqProp.lhs as Record<string, unknown>, {}, ctx) : eqProp.lhs;
    rhs = isReducible(eqProp.rhs) ? evalFn(eqProp.rhs as Record<string, unknown>, {}, ctx) : eqProp.rhs;
  } catch (e) {
    return proposeErr(
      unprovedUndecided(
        `ReductionProver: evaluator threw on reduction (${(e as Error).message ?? String(e)})`,
      ),
    );
  }
  if (!deepEqual(lhs, rhs)) {
    return proposeErr(unprovedWitnessError({ kind: "eq-refuted", lhs, rhs }));
  }
  return proposeOk(reflProof(lhs));
}

/** typeof shape guard for the reduction bridge (host-typeof boundary). */
function isReducible(x: unknown): boolean {
  if (x === null || typeof x !== "object" || Array.isArray(x)) return false;
  const obj = x as Record<string, unknown>;
  if ("$tag" in obj) return false;
  return Object.keys(obj).length > 0;
}

// ---------------------------------------------------------------------------
// SampleTestProver — PropForall propositions via inline samples
// (presence/budget/claim logic Fenel-bodied)
// ---------------------------------------------------------------------------

function sampleTestProverNative(proposition: unknown): ProposeOutcome {
  const propTag = propTagOf(proposition);
  const p = (proposition ?? {}) as { propertyId?: unknown; samples?: unknown };
  const samplesCount = Array.isArray(p.samples) ? p.samples.length : 0;
  const marker = dispatchEngineBody("engine:proposeSampleTest", [
    propTag,
    p.propertyId,
    samplesCount,
  ]);
  return markerToPropose(marker);
}

// ---------------------------------------------------------------------------
// kernel:verify — the trust-boundary entry point exposed to Fenel callers
// (delegates to kernel.ts's `verify`, itself a 6b0 delegate over
// `engine:verifyProof`).
// ---------------------------------------------------------------------------

function kernelVerifyNative(proposition: unknown, proof: unknown): VerifyResult {
  return verify(proposition as Proposition, proof as ProofTerm);
}

// ---------------------------------------------------------------------------
// Proposition shape recognizer — guard for TS-side callers (the Fenel
// proposer bodies mirror it as `startsWith propTag "Prop"`).
// ---------------------------------------------------------------------------

function isPropositionShape(x: unknown): x is Proposition {
  return isProposition(x);
}

// ---------------------------------------------------------------------------
// CompilableSemanticProver — per-case check for `compilable-semantic-equivalence`.
// 6b0 category: GENUINE BRIDGE — compiles via the JS backend and executes
// the serialized module via `new Function` (host re-entry by definition).
// ---------------------------------------------------------------------------

const COMPILABLE_PROVER_BASE_FENEL = {
  concat: (a: unknown, b: unknown): unknown => {
    if (Array.isArray(a) && Array.isArray(b)) return [...a, ...b];
    return String(a ?? "") + String(b ?? "");
  },
};

type CompilableCase = {
  readonly name?: string;
  readonly paramNames?: ReadonlyArray<string>;
  readonly body?: unknown;
  readonly args?: ReadonlyArray<unknown>;
};

/** typeof shape guard for the compile bridge input (host-typeof boundary). */
function isCompilableCase(x: unknown): x is CompilableCase {
  if (!x || typeof x !== "object" || Array.isArray(x)) return false;
  const c = x as { paramNames?: unknown; body?: unknown; args?: unknown };
  return (
    Array.isArray(c.paramNames) &&
    Array.isArray(c.args) &&
    c.body !== undefined
  );
}

function compilableSemanticCheckNative(
  testCase: unknown,
  compileFnId: unknown,
  ctx?: EvaluateContext,
): MaybeBool {
  if (!isCompilableCase(testCase)) return mNothing;
  const c = testCase;
  const paramNames = c.paramNames!;
  const args = c.args!;

  const inputs = Object.create(null) as Record<string, unknown>;
  for (let i = 0; i < paramNames.length; i++) {
    Object.defineProperty(inputs, paramNames[i]!, {
      value: args[i],
      enumerable: true,
      configurable: true,
      writable: true,
    });
  }
  let direct: unknown;
  try {
    direct = resolveEvaluator(ctx)(c.body as Record<string, unknown>, inputs, ctx);
  } catch {
    return mJustFalse;
  }

  void compileFnId;
  const source: CompileSource = {
    name: c.name ?? "case",
    params: positionalCompileFieldSlots(paramNames),
    body: c.body,
    requires: [],
  };

  let compiled;
  try {
    compiled = compileFenelToJsNative(source);
  } catch {
    return mJustFalse;
  }
  if (compiled.$tag === "Err") return mJustFalse;

  let serialized;
  try {
    serialized = dispatchedSerializeJsModule(compiled._0);
  } catch {
    return mJustFalse;
  }
  if (serialized.$tag === "Err") return mJustFalse;

  try {
    // A2: publish existing callbacks at execution time, after module loading.
    const { stdModule } = engineRequire("modules/std") as typeof import("../../../../implementations/typescript/engine/src/modules/std");
    const and = stdModule.nativeImpls?.["std:and"];
    const or = stdModule.nativeImpls?.["std:or"];
    if (typeof and !== "function" || typeof or !== "function") throw new Error("compiled Boolean runtime unavailable");
    const COMPILABLE_PROVER_FENEL = { ...COMPILABLE_PROVER_BASE_FENEL, $structuralTruthy: truthy, and, or, "std:and": and, "std:or": or };
    // eslint-disable-next-line @typescript-eslint/no-implied-eval, no-new-func
    const fn = new Function(
      "$fenel",
      `return ${serialized._0};`,
    )(COMPILABLE_PROVER_FENEL) as (...callArgs: unknown[]) => unknown;
    const compiledResult = fn(...args);
    return mJust(deepEqual(direct, compiledResult));
  } catch {
    return mJustFalse;
  }
}

// ---------------------------------------------------------------------------
// PartialEvaluatorSoundnessProver — per-case check for the PE soundness law.
// 6b0 category: GENUINE BRIDGE — PE + evaluator re-entry. partial-evaluator-
// substrate Phase 1R repointed the PE side through the dispatched surface
// (`dispatchedPartialEvalInCtx`, the Fenel-bodied `engine:partialEvaluate`
// walker) — the retired TS `partialEval` is gone. The D-E plumbing nuance: the
// law's positional `knownInputs` (`ctx1`) is the `known` arg (marshalled to the
// walker's `_known` channel); the caller ctx threads `getFunction`. A Concrete
// fold surfaces the value directly (re-evaluating a bare value is identity); a
// Residual surfaces egressed JSON-Logic the evaluator completes under `ctx2`.
// ---------------------------------------------------------------------------

type PESoundnessCase = {
  readonly expr?: unknown;
  readonly ctx1?: Record<string, unknown>;
  readonly ctx2?: Record<string, unknown>;
};

/** typeof shape guard for the PE bridge input (host-typeof boundary). */
function isPECase(x: unknown): x is PESoundnessCase {
  if (!x || typeof x !== "object" || Array.isArray(x)) return false;
  const c = x as { expr?: unknown; ctx1?: unknown; ctx2?: unknown };
  return (
    c.expr !== undefined &&
    typeof c.ctx1 === "object" &&
    c.ctx1 !== null &&
    typeof c.ctx2 === "object" &&
    c.ctx2 !== null
  );
}

function partialEvaluatorSoundnessCheckNative(
  testCase: unknown,
  ctx?: EvaluateContext,
): MaybeBool {
  if (!isPECase(testCase)) return mNothing;
  const { expr, ctx1, ctx2 } = testCase;
  const ctx1Bindings = ctx1 ?? {};
  const ctx2Bindings = ctx2 ?? {};

  const evalFn = resolveEvaluator(ctx);

  let lhs: unknown;
  try {
    const detailed = dispatchedPartialEvalInCtx(expr, ctx1Bindings, undefined, ctx);
    const residual = detailed.$tag === "Concrete" ? detailed.value : detailed.expr;
    lhs = evalFn(residual as Record<string, unknown>, ctx2Bindings, ctx);
  } catch {
    return mJustFalse;
  }

  let rhs: unknown;
  try {
    const merged = { ...ctx1Bindings, ...ctx2Bindings };
    rhs = evalFn(expr as Record<string, unknown>, merged, ctx);
  } catch {
    return mJustFalse;
  }

  return mJust(deepEqual(lhs, rhs));
}

// ---------------------------------------------------------------------------
// MonotonicityProver — Phase 12 worked example
// (decision ladder Fenel-bodied; the registry reads are the bridge)
// ---------------------------------------------------------------------------

/** Resolve an `Aggregable[aggName]` instance's methods. Imports the shared
 *  typeclass registry lazily to side-step the module load cycle with
 *  `system-entities.ts`. Returns `undefined` when no instance is registered.
 *  (6b0 category: host registry bridge.) */
function lookupAggregableMethods(aggName: string): Record<string, unknown> | undefined {
  // ⚠ rights R3a — THIS IS A HAND-TYPED STRUCTURAL `resolve` FACADE. It is
  // exactly the shape the compiler floor cannot see (Ruling 2): a two-argument
  // `resolve` written out inline does not fail `tsc` when the real registry
  // gains a required third parameter, which is why the scan-built census pin
  // roots include `fenel/modules/**/ffi` and not just `engine/src`.
  //
  // GLOBAL_ONLY: the monotonicity prover reasons over the repository's boot
  // aggregators, from a ctx-less native, and an account-registered `Aggregable`
  // steering a PROOF is a thing to fence rather than a feature to keep.
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const mod = engineRequire("system-entities") as {
    dispatchRegistry: {
      resolve: (
        target: string,
        cls: string,
        visibility: { readonly kind: "globalOnly" },
      ) => Record<string, unknown> | undefined;
    };
  };
  return mod.dispatchRegistry.resolve(aggName, "Aggregable", { kind: "globalOnly" });
}

function monotonicityProverNative(proposition: unknown): ProposeOutcome {
  // $tag/typeof shape facts (marshal leaf) + the two registry reads (bridge);
  // the decision ladder + every message live in `engine:proposeMonotonic`.
  const shapeOk =
    typeof proposition === "object" &&
    proposition !== null &&
    (proposition as { $tag?: unknown }).$tag === "PropMonotonic" &&
    typeof (proposition as { agg?: unknown }).agg === "string";
  const aggName = shapeOk ? ((proposition as { agg?: unknown }).agg as string) : "";
  const isAgg = shapeOk ? isAggregable(aggName) : false;
  const methods = shapeOk && isAgg ? lookupAggregableMethods(aggName) : undefined;
  const hasMethods = !!methods;
  const mono = methods?.["monotonicity"] as { $tag?: unknown } | undefined;
  const monoShapeOk = !!mono && typeof mono === "object" && typeof mono.$tag === "string";
  const monoTag = monoShapeOk ? (mono!.$tag as string) : "";
  const marker = dispatchEngineBody("engine:proposeMonotonic", [
    shapeOk,
    aggName,
    isAgg,
    hasMethods,
    monoShapeOk,
    monoTag,
  ]);
  return markerToPropose(marker);
}

// ---------------------------------------------------------------------------
// Native impls tables — wire the registered fnIds back to the TS functions.
//
// `proverNatives` (PLAIN, 7 keys) → the module's `nativeImpls`;
// `proverNativesCtx` (CTX, exactly 3 of them — the partial 3/7 both-maps
// overlap: reductionProverPropose / compilableSemanticCheck /
// partialEvaluatorSoundnessCheck re-enter the evaluator when a ctx is threaded)
// → the module's `nativeImplsCtx`. The seam rekeys BOTH to `prover:<key>` and
// re-adds `kernel:kernelVerify` explicitly (cross-prefix). The map KEYS are the
// codeNames (the 4 *Propose codeNames are `<name>Propose` while the fnId-suffix
// is `<name>` — the codeName≠fnId-suffix reconciliation; the native key rides
// the codeName via rekey, NOT the fnId).
// ---------------------------------------------------------------------------

const proverNatives: Record<string, (...args: unknown[]) => unknown> = {
  decidableSetProverPropose: (proposition) => decidableSetProposerNative(proposition),
  reductionProverPropose: (proposition) => reductionProverNative(proposition),
  sampleTestProverPropose: (proposition) => sampleTestProverNative(proposition),
  monotonicityProverPropose: (proposition) => monotonicityProverNative(proposition),
  compilableSemanticCheck: (testCase, compileFnId) =>
    compilableSemanticCheckNative(testCase, compileFnId),
  partialEvaluatorSoundnessCheck: (testCase) =>
    partialEvaluatorSoundnessCheckNative(testCase),
  kernelVerify: (proposition, proof) => kernelVerifyNative(proposition, proof),
};

const proverNativesCtx: Record<
  string,
  (ctx: unknown, ...args: unknown[]) => unknown
> = {
  reductionProverPropose: (ctx, proposition) =>
    reductionProverNative(proposition, ctx as EvaluateContext),
  compilableSemanticCheck: (ctx, testCase, compileFnId) =>
    compilableSemanticCheckNative(testCase, compileFnId, ctx as EvaluateContext),
  partialEvaluatorSoundnessCheck: (ctx, testCase) =>
    partialEvaluatorSoundnessCheckNative(testCase, ctx as EvaluateContext),
};

// kernelVerify native at its cross-prefix key — the seam assigns
// `nativeImpls["kernel:kernelVerify"]` from this (rekeyNativesById only relabels
// entries sharing the module prefix; `kernel:` ≠ the module name).
function kernelVerifyNativeWrapped(proposition: unknown, proof: unknown): VerifyResult {
  return kernelVerifyNative(proposition, proof);
}

export {
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
};
