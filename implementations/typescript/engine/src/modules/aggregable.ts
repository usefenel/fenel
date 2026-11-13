// ---------------------------------------------------------------------------
// Aggregable module — SEAM (module-substrate Phase 3r, 2026-05-31).
//
// Phase 3r first moved the 15 public function specs (`<agg>PreimageOf` /
// `<agg>ImageOf` + `preimageRoundtripCheck`) to
// `fenel/modules/aggregable/aggregable.fenel`. This file remains the thin seam:
// it loads that source, merges the `Aggregable` dispatch instances from the
// `instances.fenel` sidecar, and wires only the remaining host leaves.
//
// floor-kernel Phase 4 ports the SetExpr-semantic half of preimageOf into
// aggregable.fenel. The seven public preimage functions and their shared
// generic classifier are Fenel bodies over the canonical Se* ADT. This seam
// retains only the irreducible dynamic-key JSON-Logic envelope constructors,
// the independent conservative image approximations, and the law harness.
//
// See:
//   - `implementations/typescript/engine/src/aggregable.ts` (typeclass + law)
//   - `implementations/typescript/engine/src/set-algebra.ts` (consumer)
// ---------------------------------------------------------------------------

import type { FenelModule, Instance, SetExpr } from "../types";
import { rekeyNativesById } from "../function-builder";
import { loadFenelModule } from "../fenel-module";
import { registerAggregable, isAggregable } from "../aggregable";
import { containsB } from "../set-algebra";
import { peelSetExpr, setExprToTag } from "../set-marker";
import AGGREGABLE_FENEL from "../../../../../fenel/modules/aggregable/aggregable.fenel?raw";
import AGGREGABLE_INSTANCES_FENEL from "../../../../../fenel/modules/aggregable/instances.fenel?raw";

// ---------------------------------------------------------------------------
// Maybe SetExpr helpers — match the canonical `Maybe` encoding from
// type-foundation (`{$tag: "Nothing"}` / `{$tag: "Just", _0}`).
// ---------------------------------------------------------------------------

type MaybeSetExpr =
  | { readonly $tag: "Nothing" }
  | { readonly $tag: "Just"; readonly _0: SetExpr };

const mNothing: MaybeSetExpr = { $tag: "Nothing" };
function mJust(value: SetExpr): MaybeSetExpr {
  return { $tag: "Just", _0: value };
}

// ---------------------------------------------------------------------------
// preimageOf — given an output set `S`, return the canonical Fenel SetExpr
// describing inputs `v` such that `agg(v) ∈ S`. For most aggregators the
// preimage is exactly the explicit composition `SeWhere { pred = {<op>:
// [agg(value), K]}}` form; the closed-form return is `Just <that $where>`.
//
// For non-trivial output sets that can't be expressed as a simple
// composition we return `Nothing` — the algebra falls through to the
// conservative answer rather than guessing.
//
// The shape classification and interval/enum policy live in Fenel. Only the
// JSON-Logic objects whose keys are runtime operator strings stay here.
// ---------------------------------------------------------------------------

/** Canonical boundary wrapper over the Fenel generic preimage body. */
function genericPreimageOf(aggFnName: string, outputSet: unknown): MaybeSetExpr {
  const { dispatchedAggregablePreimage } = engineRequire("engine-bodies-dispatch") as typeof import("../engine-bodies-dispatch");
  return dispatchedAggregablePreimage(aggFnName, outputSet) as MaybeSetExpr;
}

/** length / count: outputType is `Nat`, so the image of `$all` is `Nat`. */
function lengthLikeImageOf(_inputSet: unknown): MaybeSetExpr {
  // Without inspecting the input set further (Phase 9 is closed-form only),
  // the safest universal claim is `image ⊆ Nat`. Returning that lets
  // downstream code prove subset queries against `{$named: "Nat"}` even
  // when the input is opaque.
  return mJust({ $tag: "SeRef", handle: "Nat" });
}

/** sum: outputType is `Number` (or `Nat` over `Nat` lists). Same conservative
 *  posture: image ⊆ Number. */
function sumImageOf(_inputSet: unknown): MaybeSetExpr {
  return mJust({ $tag: "SeRef", handle: "Number" });
}

/** avg: same conservative claim. */
function avgImageOf(_inputSet: unknown): MaybeSetExpr {
  return mJust({ $tag: "SeRef", handle: "Number" });
}

/** minimum / maximum: image is bounded by the input set itself for any
 *  non-empty input. Without input introspection, the broadest claim is
 *  `image ⊆ Any` — Nothing. */
function minMaxImageOf(_inputSet: unknown): MaybeSetExpr {
  return mNothing;
}

// ---------------------------------------------------------------------------
// preimageRoundtripCheck — backs the `aggregable-preimage-roundtrip` law.
//
// Given a sample case `{aggFn, outputSet, value}`, returns:
//   - `Just true`  — the law holds for this case (preimage exists, the
//                    aggregator's output on the sample value lies in the
//                    declared output set).
//   - `Just false` — preimage exists but the aggregator's output is
//                    outside the output set — hard refutation of the law.
//   - `Nothing`    — preimage returned `Nothing` (vacuous), the aggregator
//                    isn't registered, no closed-form JS aggregator is
//                    available, or the case was malformed. Recorded as
//                    un-checked.
//
// The check computes the aggregator's output directly in JS (rather than
// going through the registry's `length` call) so the law is checkable
// from any caller, including direct test invocations without a registry
// context. The contract is identical: if `agg(value) ∈ outputSet`, the
// preimage must contain `value`.
// ---------------------------------------------------------------------------

// `unknown` rather than `number | undefined` since slice 3c-D2: `minimum` /
// `maximum` are honestly `List a -> Maybe a`, so their modelled output is a
// TAGGED value. `undefined` keeps its meaning — "no closed-form JS model, record
// the case as un-checked".
const STD_AGG_JS: Record<string, (v: unknown) => unknown> = {
  length: (v) => {
    if (typeof v === "string") {
      // Code-point length — matches the std `length` native semantics.
      let n = 0;
      for (const _ of v) n++;
      return n;
    }
    if (Array.isArray(v)) return v.length;
    return undefined;
  },
  count: (v) => (Array.isArray(v) ? v.length : undefined),
  sum: (v) => {
    if (!Array.isArray(v)) return undefined;
    let s = 0;
    for (const e of v) {
      if (typeof e !== "number") return undefined;
      s += e;
    }
    return s;
  },
  avg: (v) => {
    if (!Array.isArray(v) || v.length === 0) return undefined;
    let s = 0;
    for (const e of v) {
      if (typeof e !== "number") return undefined;
      s += e;
    }
    return s / v.length;
  },
  // minimum / maximum — RE-MODELLED for the repaired `List a -> Maybe a`
  // contract (signature-substrate slice 3c-D2). These used to compute a RAW
  // numeric extremum, which made this harness a FALSE WITNESS the moment
  // `std:minimum` / `std:maximum` became honest: the law computes `agg(value)`
  // here in JS and never re-enters the registry, so a stale raw-`a` model would
  // keep answering about a contract the registry no longer implements. The
  // model below is an INDEPENDENT re-derivation of the repaired semantics (it
  // is deliberately not a call into the implementation): non-array => Nothing
  // (the natives' `toArr` maps every non-array to `[]`), empty => Nothing, a
  // singleton => Just x unexamined, otherwise Just the extremum while every
  // adjacent pair is number/number or string/string, else Nothing. Note the
  // output now lives in `Maybe a`, so a MEANINGFUL `outputSet` for these two is
  // a set of `Maybe a` (`SeEnum [Just 5]`), not of `a`.
  minimum: (v) => extremumModel(v, true),
  maximum: (v) => extremumModel(v, false),
  // distinctCount — RE-MODELLED for recipe-functions S1: distinctness is the
  // one value equality `eq` (structuralEq), no longer JS SameValueZero, so two
  // separately built `{$tag}` values count once and two NaNs count twice. Same
  // independence rule as extremumModel: a quadratic first-occurrence count
  // over `structuralEq`, not a call into `std:distinctCount`.
  distinctCount: (v) => {
    if (!Array.isArray(v)) return undefined;
    const { structuralEq } = engineRequire("json-logic") as typeof import("../json-logic");
    return v.filter((x, i) => !v.slice(0, i).some((y) => structuralEq(y, x))).length;
  },
};

/** The 3c-D2 `Maybe`-returning extremum, re-derived independently of both
 *  `std:minimum`'s Fenel body and its native perf branch, so the law harness
 *  models the contract rather than mirroring one implementation. */
function extremumModel(v: unknown, wantMin: boolean): unknown {
  if (!Array.isArray(v)) return { $tag: "Nothing" };
  if (v.length === 0) return { $tag: "Nothing" };
  let m: unknown = v[0];
  for (let i = 1; i < v.length; i++) {
    const x = v[i];
    const bothNumbers = typeof m === "number" && typeof x === "number";
    const bothStrings = typeof m === "string" && typeof x === "string";
    if (!bothNumbers && !bothStrings) return { $tag: "Nothing" };
    const takeX = wantMin
      ? (x as number | string) < (m as number | string)
      : (x as number | string) > (m as number | string);
    if (takeX) m = x;
  }
  return { $tag: "Just", _0: m };
}

function preimageRoundtripCheckNative(
  caseValue: unknown,
): { $tag: "Just"; _0: boolean } | { $tag: "Nothing" } {
  if (!caseValue || typeof caseValue !== "object") return { $tag: "Nothing" };
  const c = caseValue as { aggFn?: unknown; outputSet?: unknown; value?: unknown };
  const aggFn = typeof c.aggFn === "string" ? c.aggFn : undefined;
  if (!aggFn || !isAggregable(aggFn)) return { $tag: "Nothing" };
  if (peelSetExpr(c.outputSet) === null) return { $tag: "Nothing" };
  const outputSet = setExprToTag(c.outputSet);
  // Vacuous when no closed-form preimage — the law makes no claim.
  const preimage = genericPreimageOf(aggFn, outputSet);
  if (preimage.$tag === "Nothing") return { $tag: "Nothing" };
  // Compute the aggregator's output directly via the JS shortcut, then
  // assert `output ∈ outputSet` via the output-shape's `contains` (no
  // recursion through `setWhereContains` / the registry).
  const aggJs = STD_AGG_JS[aggFn];
  if (!aggJs) return { $tag: "Nothing" }; // user-aggregator with no JS shortcut
  const output = aggJs(c.value);
  if (output === undefined) return { $tag: "Nothing" };
  // HONEST SCOPE OF THIS CHECK (recorded by signature-substrate slice 3c-D2;
  // the defect is PRE-EXISTING, not introduced here). The documented law is the
  // IMPLICATION `agg(v) ∈ outputSet ⇒ v ∈ preimage(outputSet)`. What is
  // actually computed is only the ANTECEDENT — `preimage` above is consulted
  // for its `Nothing`-ness and then discarded, and the returned boolean is
  // `agg(v) ∈ outputSet`. So a sample whose antecedent FAILS is reported as a
  // refutation when the law is vacuously true of it, and the consequent is
  // never tested at all. Closing this needs `contains` over the generated
  // `SeWhere`, which means evaluating its predicate through a registry — the
  // one thing this native was deliberately built to avoid (see the header), so
  // it is a real gap rather than an oversight to patch in place. Recorded in
  // design/tcb-ledger.md with the 3c residuals; do not read a green
  // `aggregable-preimage-roundtrip` as evidence that the preimage CONTAINS
  // anything.
  const antecedent = containsB(outputSet, output, null);
  return { $tag: "Just", _0: antecedent };
}

// ---------------------------------------------------------------------------
// Native impls — only the dynamic-key JSON-Logic envelopes for the Fenel
// preimage body, the independent image approximations, and the law harness.
// Keyed by codeName; `rekeyNativesById` produces the id-form module keys.
// ---------------------------------------------------------------------------

const aggregableNatives: Record<string, (...args: unknown[]) => unknown> = {
  preimagePredicateEnvelope: (aggFn, op, value) => ({
    [String(op)]: [{ call: [String(aggFn), { var: "value" }] }, value],
  }),
  preimageBooleanEnvelope: (op, predicates) => ({
    [String(op)]: predicates,
  }),
  lengthImageOf: (s) => lengthLikeImageOf(s),
  countImageOf: (s) => lengthLikeImageOf(s),
  sumImageOf: (s) => sumImageOf(s),
  avgImageOf: (s) => avgImageOf(s),
  minimumImageOf: (s) => minMaxImageOf(s),
  maximumImageOf: (s) => minMaxImageOf(s),
  distinctCountImageOf: (s) => lengthLikeImageOf(s),
  preimageRoundtripCheck: (c) => preimageRoundtripCheckNative(c),
};

// ---------------------------------------------------------------------------
// Aggregable instances — one per std aggregator. Fenel-authored typed values
// in fenel/modules/aggregable/instances.fenel (Phase 3.2b of typeclass-
// substrate-completion). The `loadFenelModule` projection produces the
// `{typeName, args, methods, label}` shape the set-algebra composition-shape
// recogniser reads (inputType / outputType FenelType refs, monotonicity
// variant, imageOf / preimageOf fnId strings, label).
//
// `args[0]` is the aggregator's codeName (not its id) — the set-algebra
// recognises `{call: ["length", value]}` and looks up `Aggregable [length]`.
//
// The exported consts below are thin projection lookups, preserved because the
// engine barrel (index.ts) re-exports them and aggregable.test.ts imports them.
// ---------------------------------------------------------------------------

const aggregableFenelInstances =
  loadFenelModule(AGGREGABLE_INSTANCES_FENEL, "aggregable", {
    dispatchInstanceFile: true,
    typeValuedFields: { Aggregable: ["inputType", "outputType"] },
  }).instances ?? [];

const pickAggregableInst = (aggName: string): Instance => {
  const found = aggregableFenelInstances.find(
    (i) => i.typeName === "Aggregable" && i.args[0] === aggName,
  );
  if (!found) throw new Error(`aggregable: missing Fenel instance Aggregable ${aggName}`);
  return found;
};

export const aggregableLength: Instance = pickAggregableInst("length");
export const aggregableCount: Instance = pickAggregableInst("count");
export const aggregableSum: Instance = pickAggregableInst("sum");
export const aggregableAvg: Instance = pickAggregableInst("avg");
export const aggregableMinimum: Instance = pickAggregableInst("minimum");
export const aggregableMaximum: Instance = pickAggregableInst("maximum");
export const aggregableDistinctCount: Instance = pickAggregableInst("distinctCount");

const aggregableDispatchInstances: Instance[] = [
  aggregableLength,
  aggregableCount,
  aggregableSum,
  aggregableAvg,
  aggregableMinimum,
  aggregableMaximum,
  aggregableDistinctCount,
];

// Pre-register std aggregator names so the set-algebra composition-shape
// recogniser knows about them without an explicit `registerAggregable`
// call. User aggregators register their own via `registerAggregable`.
for (const name of ["length", "count", "sum", "avg", "minimum", "maximum", "distinctCount"]) {
  registerAggregable(name);
}

// ---------------------------------------------------------------------------
// Module export — canonical preimage bodies + the remaining native envelopes,
// image approximations, and law harness. Dispatch instances are merged in.
// ---------------------------------------------------------------------------

const loaded = loadFenelModule(AGGREGABLE_FENEL, "aggregable", { label: "Aggregable" });

export const aggregableModule: FenelModule = {
  ...loaded,
  instances: [...(loaded.instances ?? []), ...aggregableDispatchInstances],
  nativeImpls: rekeyNativesById(aggregableNatives, "aggregable"),
};

// Re-export the natives for direct use in tests — avoids constructing a
// full module registry just to exercise the underlying preimage / image
// computations.
export { aggregableNatives, genericPreimageOf };

// browser-engine-compat: make the live module available to the lazy shared
// dispatch harness. Registration happens after module initialization, before
// any public genericPreimageOf call can dispatch.
import * as __self_modules_aggregable from "./aggregable";
import { engineRequire, registerEngineModule as __reg_modules_aggregable } from "../engine-require";
__reg_modules_aggregable("modules/aggregable", __self_modules_aggregable);
