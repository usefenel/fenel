// ---------------------------------------------------------------------------
// Aggregable — typeclass-dispatched aggregator structural metadata
//
// Phase 9 of the implementation roadmap. Closes the loop Phase 3 left open
// when the closed `$preimage` SetExpr constructor was retired:
//
//   Pre-Phase 3: `{$preimage: { agg: "length", set: outputSet }}` was a
//   first-class SetExpr constructor. The set-algebra knew about it and
//   reasoned structurally — `preimage(agg, S1) ⊆ preimage(agg, S2) iff
//   S1 ⊆ S2` was a built-in rule.
//
//   Post-Phase 3: the predicate is written as the explicit composition
//   `{$where: { ">=": [{ call: ["length", { var: "value" }] }, 5] }}`. The
//   runtime evaluates this correctly via `length`'s native impl, but the
//   structural-subtype reasoning the dedicated constructor enabled was
//   gone (`whereToSetExpr` couldn't recover the algebraic rule).
//
//   Post-Phase 9: each aggregator declares an `Aggregable` instance
//   exposing its structural properties. The set-algebra recognises the
//   composition shape inside `$where`, looks up the Aggregable instance,
//   and routes through the typeclass-instance dispatch to restore the
//   structural reasoning. User aggregators participate automatically by
//   registering their own instance — generalises beyond `length` / `sum`
//   to any pure aggregator.
//
// The Fenel-distinctive thing: aggregator properties as typeclass
// instances, not a hardcoded magic-string table. The engine has no special
// knowledge of "length" — what it has is `Aggregable.length` registered
// with the structural data the algebra reads.
//
// See:
//   - `design/structural-introspection.md` (Instance 1 — the
//     DecidableMembership story this extends)
//   - `design/implementation-roadmap.md` (Phase 9 entry)
//   - `prompts/phase-9-aggregable.md` (the brief)
// ---------------------------------------------------------------------------

import type { FenelType, FieldDef, Interface } from "./types";

// ---------------------------------------------------------------------------
// Monotonicity — how an aggregator's preimage relates to output-set
// inclusion. Used by the set-algebra to choose the strongest structural
// rule available for a given aggregator.
//
// For any total function f and sets S1, S2:
//   S1 ⊆ S2  ⇒  f⁻¹(S1) ⊆ f⁻¹(S2)   (always — set theory)
//
// So the *forward* direction is always sound. The interesting question is
// the converse — whether structural disjointness / non-emptiness in
// output-space lifts to the input. `Monotone` declares it does; `Antitone`
// the inverse direction; `Neither` is the conservative default.
//
// Phase 9's algorithm only uses the forward direction (always safe), so
// every Aggregable instance can declare `Neither` and the algebra still
// works for the subset / disjoint rules. The richer monotonicity flag is
// metadata for future extensions (e.g. completeness arguments, image
// propagation).
// ---------------------------------------------------------------------------

export type Monotonicity =
  | { readonly $tag: "Monotone" }
  | { readonly $tag: "Antitone" }
  | { readonly $tag: "Neither" };

export const MONOTONE: Monotonicity = { $tag: "Monotone" };
export const ANTITONE: Monotonicity = { $tag: "Antitone" };
export const NEITHER: Monotonicity = { $tag: "Neither" };

// ---------------------------------------------------------------------------
// Aggregable agg — structural metadata for an aggregator function.
//
// The single type parameter `agg` is the aggregator's codeName — instances
// target it by name (`"length"`, `"sum"`, `"count"`, …). When the set-
// algebra sees `{call: [aggFnName, value]}` inside a `$where` predicate,
// it looks up `Aggregable [aggFnName]` to determine whether the aggregator
// participates in composition-shape reasoning.
//
// Methods. `inputType` / `outputType` / `monotonicity` are *static
// metadata*: stored as inline values in the instance's `methods` object
// (same pattern as `Categorizable.category`). `imageOf` / `preimageOf` hold
// the functions themselves, `SetExpr -> Maybe SetExpr` — a `.fenel` instance
// writes `imageOf = aggregable.lengthImageOf`, which loads as the reference
// `{$ref: "aggregable.lengthImageOf"}` (modules-as-values Phase 2b).
//
// Open-form cases. Many aggregators don't have a closed-form preimage /
// image for arbitrary output sets. The convention: `imageOf` / `preimageOf`
// return `Maybe SetExpr` — `Nothing` when no closed-form exists. The
// algebra falls through to the conservative answer; this is honest and
// safer than guessing.
// ---------------------------------------------------------------------------

// The two function-typed methods, written out as data exactly as the `.fenel`
// declaration (`fenel/std/interfaces.fenel`) parses: one positional parameter,
// and `Maybe SetExpr` inlined as the variant the parser emits. Pinned against
// `seedFromType` of that declaration in `modules-as-values-phase-2b.test.ts`.
const NO_LABEL = { $tag: "Nothing" } as const;
const SET_EXPR_ARG: FieldDef = {
  name: "_0",
  key: { $tag: "PositionalField", index: 0 },
  label: NO_LABEL,
  type: { $ref: "SetExpr" },
  ui: NO_LABEL,
  meta: {},
};
const MAYBE_SET_EXPR: FenelType = {
  $variant: {
    cases: [
      { name: "Nothing", label: NO_LABEL },
      {
        name: "Just",
        label: NO_LABEL,
        fields: [
          {
            name: "_0",
            key: { $tag: "PositionalField", index: 0 },
            label: NO_LABEL,
            type: { $ref: "SetExpr" },
            meta: {},
            ui: NO_LABEL,
          },
        ],
      },
    ],
  },
};

export const aggregable: Interface = {
  name: "Aggregable",
  description:
    "Aggregator functions whose structural properties (input/output types, monotonicity, preimage/image SetExpr functions) the set-algebra can read for composition-shape reasoning. When a `$where` predicate contains `{call: [aggFnName, value]} <op> K`, the algebra looks up `Aggregable [aggFnName]` and uses the lifted output-set to decide subset / disjoint / empty queries — restoring the structural reasoning the retired `$preimage` SetExpr constructor enabled (Phase 3 → Phase 9 closure).",
  params: [{ name: "agg" }],
  methods: [
    {
      name: "inputType",
      description:
        "The Fenel type the aggregator consumes (e.g. `List a`, `String`). Stored as an inline Type value in the instance's methods.",
      params: [],
      returns: { $ref: "FenelType" },
    },
    {
      name: "outputType",
      description:
        "The Fenel type the aggregator produces (e.g. `Nat`, `Number`). Stored as an inline Type value.",
      params: [],
      returns: { $ref: "FenelType" },
    },
    {
      name: "monotonicity",
      description:
        "How the aggregator's preimage relates to output-set inclusion: `Monotone` / `Antitone` / `Neither`. Conservative metadata — Phase 9's algorithm only uses the always-sound forward direction (S1 ⊆ S2 ⇒ preimage(S1) ⊆ preimage(S2)), so the field is mostly informational today.",
      params: [],
      returns: { $ref: "Monotonicity" },
    },
    {
      name: "imageOf",
      description:
        "The image function, `SetExpr -> Maybe SetExpr`. Given an input set, return the aggregator's image (output set) when expressible in closed form; `Nothing` otherwise. Used for forward propagation through compositional shapes.",
      params: [SET_EXPR_ARG],
      returns: MAYBE_SET_EXPR,
    },
    {
      name: "preimageOf",
      description:
        "The preimage function, `SetExpr -> Maybe SetExpr`. Given an output set, return the canonical input preimage when expressible in closed form; `Nothing` otherwise. Mirrors the retired `$preimage { agg, set }` constructor's role — same structural intent, dispatched per-aggregator via typeclass instance lookup instead of pinned to a closed ADT case.",
      params: [SET_EXPR_ARG],
      returns: MAYBE_SET_EXPR,
    },
  ],
  laws: [
    {
      name: "aggregable-preimage-roundtrip",
      description:
        "Forward-direction soundness: for every output set `S` and value `v` such that `agg(v) ∈ S` is decidably true, the preimage of `S` contains `v`. Sample-tested over inline `(agg, S, v)` triples. Vacuously satisfied when `preimageOf(S) = Nothing` (the algebra makes no claim).",
      forall: [
        {
          name: "case",
          // Each sample is a (aggFn, outputSet, value) triple where
          // `agg(value)` provably lies in `outputSet`. The law asserts
          // that the preimage of `outputSet` contains `value`. Samples
          // are intentionally narrow — the law is a soundness sanity
          // check, not adversarial fuzzing.
          // Interval samples use the canonical `Maybe<Bound>` lo/hi shape
          // (migration 0054; these inert law samples were missed by that
          // sweep and fixed in expr-substrate Phase 6c — the bare-bound
          // form crashes `intervalToWhere` at evaluation time).
          samples: [
            // length: "hello" has length 5; preimage of {5} contains it.
            { aggFn: "length", outputSet: { $tag: "SeEnum", values: [5] }, value: "hello" },
            { aggFn: "length", outputSet: { $tag: "SeInterval", interval: { lo: { $tag: "Just", _0: { value: 3, inclusive: true } }, hi: { $tag: "Nothing" } } }, value: "hello" },
            // count: a 3-element list has count 3.
            { aggFn: "count", outputSet: { $tag: "SeEnum", values: [3] }, value: [1, 2, 3] },
            // sum: [4,5,6] sums to 15; preimage of [10, ∞) contains it.
            { aggFn: "sum", outputSet: { $tag: "SeInterval", interval: { lo: { $tag: "Just", _0: { value: 10, inclusive: true } }, hi: { $tag: "Nothing" } } }, value: [4, 5, 6] },
            // minimum: [5, 7, 9] minimum is `Just 5` since slice 3c-D2 repaired
            // `std:minimum` to the honest `List a -> Maybe a`. The output set
            // must therefore range over `Maybe a`: `SeEnum [5]` is now a
            // genuinely EMPTY preimage (`Just 5 ∉ {5}`), so the meaningful
            // sample is the tagged one, which the equality arm decides exactly
            // because `eq` is structural.
            { aggFn: "minimum", outputSet: { $tag: "SeEnum", values: [{ $tag: "Just", _0: 5 }] }, value: [5, 7, 9] },
          ],
        },
      ],
      // The per-case check delegates to `aggregable:preimageRoundtripCheck`,
      // a native that resolves the Aggregable instance for `case.aggFn`,
      // calls its `preimageOf` on `case.outputSet`, and asserts either
      // `Nothing` (vacuous) OR (`Just inputSet` ∧ `contains(inputSet,
      // case.value)` matches `agg(value) ∈ outputSet`). Returning `Just
      // true` proves the law for that case; `Nothing` records it as
      // un-checked (sample-tested epistemic posture).
      property: {
        deepEq: [
          { call: ["aggregable:preimageRoundtripCheck", { var: "case" }] },
          { $tag: "Just", _0: true },
        ],
      },
    },
  ],
};

// ---------------------------------------------------------------------------
// Aggregator export — consumed by builtin-classes.ts to merge into the
// global `builtinTypeclasses` array. Per-aggregator instances ride along
// through the aggregable module's SYSTEM_MODULES loop registration.
// ---------------------------------------------------------------------------

export const aggregableTypeclasses: Interface[] = [aggregable];

// ---------------------------------------------------------------------------
// Registry of known aggregable codeNames — populated at module-load time by
// the aggregable module's instance declarations. The set-algebra
// composition-shape recogniser consults this set (fast path; no typeclass-
// instance walk per recognition) to decide whether a `{call: [name, …]}`
// inside `$where` should lift through Aggregable.
//
// User aggregators register additional names via `registerAggregable` —
// matches the existing pattern for `registerNamedSet` / Decompose parsers.
// Re-registering is idempotent (set semantics).
// ---------------------------------------------------------------------------

const aggregableNames = new Set<string>();

export function registerAggregable(codeName: string): void {
  if (typeof codeName === "string" && codeName.length > 0) {
    aggregableNames.add(codeName);
  }
}

export function isAggregable(codeName: string): boolean {
  return aggregableNames.has(codeName);
}

export function listAggregables(): readonly string[] {
  return Array.from(aggregableNames).sort();
}

/** Test-only helper. Allows tests that register a custom aggregable to
 *  clean up afterwards. Production code never needs this. */
export function unregisterAggregable(codeName: string): void {
  aggregableNames.delete(codeName);
}

// browser-engine-compat Phase 1b: self-register this module's live namespace so
// engineRequire("aggregable") resolves even at EVAL-TIME (a caller that statically imports
// this module runs its own eval-time builder calls AFTER this module is fully loaded,
// i.e. before the index.ts aggregator runs). See engine-require.ts.
import * as __self_aggregable from "./aggregable";
import { registerEngineModule as __reg_aggregable } from "./engine-require";
__reg_aggregable("aggregable", __self_aggregable);
