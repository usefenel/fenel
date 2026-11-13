// ---------------------------------------------------------------------------
// Aggregable — typeclass + composition-shape recognition tests.
//
// Phase 9 of the implementation roadmap. Three things this suite
// exercises:
//
//   1. The std-aggregator Aggregable instances exist and carry the
//      expected structural metadata (inputType / outputType /
//      monotonicity / preimage and image fnIds).
//
//   2. `recognizeAggregableComposition` lifts the explicit composition
//      shape `{op: [{call: [aggFn, {var: "value"}]}, K]}` into an
//      output-space SetExpr, for every comparison operator and both
//      orientations (agg on the left vs right).
//
//   3. The setWhere decide procedures route through the recogniser to
//      retain exact enum subset / disjoint / empty proofs. Native numeric
//      ordering keeps a residual predicate: an interval would admit exact
//      integer records that the native comparison refuses.
//
//   4. Open-form output sets (no closed-form preimage) fall through to
//      the conservative `Nothing` — the algebra never accepts an
//      incorrect proof.
//
//   5. User-defined aggregators register via `registerAggregable` and
//      participate in composition-shape reasoning the same way as the
//      built-ins.
// ---------------------------------------------------------------------------

import { describe, it, expect } from "vitest";
// genericPreimageOf is now a production dispatch wrapper; initialize the same
// complete engine module aggregate the application installs before calling it.
import "./index";
import { isSubset, isDisjoint, decideEmpty, contains } from "./set-algebra";
// set-algebra-to-fenel Phase 3a-1 — the TS recogniser triad was retired; the
// recogniser is now the marshal-boundary wrapper over the Fenel
// `engine:recognizeAggregableComposition` body. Byte-identical surface.
import { dispatchedRecognizeAggregableComposition as recognizeAggregableComposition, harnessForTests } from "./engine-bodies-dispatch";
import {
  registerAggregable,
  unregisterAggregable,
  isAggregable,
  listAggregables,
  MONOTONE,
  NEITHER,
} from "./aggregable";
import {
  aggregableLength,
  aggregableCount,
  aggregableSum,
  aggregableAvg,
  aggregableMinimum,
  aggregableMaximum,
  aggregableDistinctCount,
  aggregableNatives,
  genericPreimageOf,
} from "./modules/aggregable";
import type { SetExpr } from "./types";
import { Just, Nothing } from "./type-foundation";
import { evaluate } from "./json-logic";

// ---------------------------------------------------------------------------
// Registry of std aggregables
// ---------------------------------------------------------------------------

describe("Aggregable registry — std aggregators pre-registered", () => {
  it("registers length / count / sum / avg / minimum / maximum / distinctCount", () => {
    // Importing the aggregable module pre-registers std names. Asserting
    // the membership ensures the module's load-time side effect ran.
    expect(isAggregable("length")).toBe(true);
    expect(isAggregable("count")).toBe(true);
    expect(isAggregable("sum")).toBe(true);
    expect(isAggregable("avg")).toBe(true);
    expect(isAggregable("minimum")).toBe(true);
    expect(isAggregable("maximum")).toBe(true);
    expect(isAggregable("distinctCount")).toBe(true);
  });

  it("non-std functions are not aggregable", () => {
    expect(isAggregable("unknownFn")).toBe(false);
    expect(isAggregable("")).toBe(false);
  });

  it("listAggregables returns the registered names", () => {
    const names = listAggregables();
    expect(names).toContain("length");
    expect(names).toContain("sum");
  });
});

// ---------------------------------------------------------------------------
// Instance shape — each std aggregator has an Aggregable instance with the
// expected metadata + fnId methods.
// ---------------------------------------------------------------------------

describe("std Aggregable instances", () => {
  it("aggregableLength carries Nat outputType + length method ids", () => {
    expect(aggregableLength.typeName).toBe("Aggregable");
    expect(aggregableLength.args).toEqual(["length"]);
    expect(aggregableLength.methods?.outputType).toEqual({ $ref: "Nat" });
    expect(aggregableLength.methods?.monotonicity).toEqual(NEITHER);
    // modules-as-values Phase 2b: the methods hold the functions themselves,
    // written `aggregable.lengthImageOf` (a qualified reference).
    expect(aggregableLength.methods?.imageOf).toEqual({ $ref: "aggregable.lengthImageOf" });
    expect(aggregableLength.methods?.preimageOf).toEqual({ $ref: "aggregable.lengthPreimageOf" });
  });

  it("aggregableSum declares Monotone (preimage-monotone)", () => {
    expect(aggregableSum.args).toEqual(["sum"]);
    expect(aggregableSum.methods?.monotonicity).toEqual(MONOTONE);
    expect(aggregableSum.methods?.outputType).toEqual({ $ref: "Number" });
  });

  it("count / distinctCount produce Nat outputs", () => {
    expect(aggregableCount.methods?.outputType).toEqual({ $ref: "Nat" });
    expect(aggregableDistinctCount.methods?.outputType).toEqual({ $ref: "Nat" });
  });

  it("minimum / maximum / avg are registered with sensible defaults", () => {
    expect(aggregableMinimum.args).toEqual(["minimum"]);
    expect(aggregableMaximum.args).toEqual(["maximum"]);
    expect(aggregableAvg.args).toEqual(["avg"]);
  });
});

// ---------------------------------------------------------------------------
// preimageOf natives — closed-form per output-set shape
// ---------------------------------------------------------------------------

describe("genericPreimageOf — closed-form output-set shapes", () => {
  it("single-element $enum lifts to `agg(value) == K`", () => {
    const result = genericPreimageOf("length", { $tag: "SeEnum", values: [5] });
    expect(result.$tag).toBe("Just");
    if (result.$tag !== "Just") return;
    expect(result._0).toEqual({
      $tag: "SeWhere",
      pred: { "==": [{ call: ["length", { var: "value" }] }, 5] },
    });
  });

  it("multi-element $enum lifts to a union of single-value preimages", () => {
    const result = genericPreimageOf("length", { $tag: "SeEnum", values: [3, 5] });
    expect(result.$tag).toBe("Just");
    if (result.$tag !== "Just") return;
    expect(result._0).toEqual({
      $tag: "SeUnion",
      branches: [
        { $tag: "SeWhere", pred: { "==": [{ call: ["length", { var: "value" }] }, 3] } },
        { $tag: "SeWhere", pred: { "==": [{ call: ["length", { var: "value" }] }, 5] } },
      ],
    });
  });

  it("$interval with a lower bound abstains without output-carrier provenance", () => {
    const result = genericPreimageOf("length", {
      $tag: "SeInterval",
      interval: { lo: Just({ value: 5, inclusive: true }), hi: Nothing },
    });
    expect(result).toEqual(Nothing);
  });

  it("$interval with both bounds abstains without output-carrier provenance", () => {
    const result = genericPreimageOf("count", {
      $tag: "SeInterval",
      interval: { lo: Just({ value: 1, inclusive: true }), hi: Just({ value: 10, inclusive: false }) },
    });
    expect(result).toEqual(Nothing);
  });

  it("exact integer interval members are excluded by the former raw-comparison preimage", () => {
    const outputSet: SetExpr = {
      $tag: "SeInterval",
      interval: { lo: Just({ value: 1, inclusive: true }), hi: Just({ value: 10, inclusive: true }) },
    };
    const formerPredicate = {
      and: [
        { ">=": [{ call: ["id", { var: "value" }] }, 1] },
        { "<=": [{ call: ["id", { var: "value" }] }, 10] },
      ],
    };
    const unboundedOutputSet: SetExpr = {
      $tag: "SeInterval",
      interval: { lo: Just({ value: 1, inclusive: true }), hi: Nothing },
    };
    const formerLowerPredicate = { ">=": [{ call: ["id", { var: "value" }] }, 1] };
    // The shared engine harness executes the current Fenel id body in the same
    // registry/frame as genericPreimageOf. Full-profile field-lock acceptance
    // is an artifact check, separate from this carrier counterexample.
    const evalCtx = harnessForTests().ctx;
    // Large boxes are admitted beyond safe Number capacity; small boxed digits
    // are rejected. Pure spines keep the original finite-interval regression.
    for (const [value, interval, predicate] of [
      [{ $tag: "Nat", digits: "9007199254740992" }, unboundedOutputSet, formerLowerPredicate],
      [{ $tag: "Int", digits: "9007199254740992" }, unboundedOutputSet, formerLowerPredicate],
      [{ $tag: "Succ", _0: { $tag: "Zero" } }, outputSet, formerPredicate],
      [{ $tag: "Int", negative: false, magnitude: 5 }, outputSet, formerPredicate],
    ] as const) {
      // GLOBAL_ONLY: these literal intervals and pure id calls use no account data.
      expect(contains(interval, value, null)).toEqual(Just(true));
      expect(evaluate(predicate, { value }, evalCtx)).toBe(false);
    }
    expect(genericPreimageOf("id", outputSet)).toEqual(Nothing);
    expect(genericPreimageOf("id", unboundedOutputSet)).toEqual(Nothing);
  });

  it("$all → preimage is the universe (every input maps somewhere)", () => {
    expect(genericPreimageOf("length", { $tag: "SeAll" })).toEqual({
      $tag: "Just",
      _0: { $tag: "SeAll" },
    });
  });

  it("$none → preimage is empty", () => {
    expect(genericPreimageOf("length", { $tag: "SeNone" })).toEqual({
      $tag: "Just",
      _0: { $tag: "SeNone" },
    });
  });

  it("empty $enum → preimage is empty", () => {
    expect(genericPreimageOf("length", { $tag: "SeEnum", values: [] })).toEqual({
      $tag: "Just",
      _0: { $tag: "SeNone" },
    });
  });

  it("opaque shapes return `Nothing` (no closed-form preimage)", () => {
    expect(genericPreimageOf("length", { $tag: "SeRef", handle: "MyShape" })).toEqual({ $tag: "Nothing" });
    expect(genericPreimageOf("length", { $tag: "SePattern", pattern: { t: "any" } })).toEqual({
      $tag: "Nothing",
    });
  });
});

// ---------------------------------------------------------------------------
// Image natives — coarse but always-sound output-type coverage
// ---------------------------------------------------------------------------

describe("imageOf natives — Nat / Number coverage", () => {
  it("length / count / distinctCount declare image ⊆ Nat", () => {
    expect(aggregableNatives["lengthImageOf"]!({ $tag: "SeAll" })).toEqual({
      $tag: "Just",
      _0: { $tag: "SeRef", handle: "Nat" },
    });
    expect(aggregableNatives["countImageOf"]!({ $tag: "SeAll" })).toEqual({
      $tag: "Just",
      _0: { $tag: "SeRef", handle: "Nat" },
    });
    expect(aggregableNatives["distinctCountImageOf"]!({ $tag: "SeAll" })).toEqual({
      $tag: "Just",
      _0: { $tag: "SeRef", handle: "Nat" },
    });
  });

  it("sum / avg declare image ⊆ Number", () => {
    expect(aggregableNatives["sumImageOf"]!({ $tag: "SeAll" })).toEqual({
      $tag: "Just",
      _0: { $tag: "SeRef", handle: "Number" },
    });
    expect(aggregableNatives["avgImageOf"]!({ $tag: "SeAll" })).toEqual({
      $tag: "Just",
      _0: { $tag: "SeRef", handle: "Number" },
    });
  });

  it("minimum / maximum return `Nothing` (closed-form not implemented)", () => {
    expect(aggregableNatives["minimumImageOf"]!({ $tag: "SeAll" })).toEqual({ $tag: "Nothing" });
    expect(aggregableNatives["maximumImageOf"]!({ $tag: "SeAll" })).toEqual({ $tag: "Nothing" });
  });
});

// ---------------------------------------------------------------------------
// recognizeAggregableComposition — the load-bearing pattern matcher
// ---------------------------------------------------------------------------

describe("recognizeAggregableComposition — lifts predicates to outputSet", () => {
  it("retains the native predicate for `length(value) >= 5`", () => {
    const lifted = recognizeAggregableComposition({
      ">=": [{ call: ["length", { var: "value" }] }, 5],
    });
    expect(lifted).toEqual({
      aggFn: "length",
      outputSet: { $tag: "SeWhere", pred: { $tag: "ECall", fnId: "gte", args: [{ $tag: "EVar", name: "value" }, { $tag: "ELit", value: 5 }] } },
    });
  });

  it("recognises both operand orderings (`K >= length(value)`)", () => {
    const lifted = recognizeAggregableComposition({
      ">=": [10, { call: ["length", { var: "value" }] }],
    });
    expect(lifted).toEqual({
      aggFn: "length",
      outputSet: { $tag: "SeWhere", pred: { $tag: "ECall", fnId: "lte", args: [{ $tag: "EVar", name: "value" }, { $tag: "ELit", value: 10 }] } },
    });
  });

  it("retains strict comparisons (`length(value) > 5`) as predicates", () => {
    const lifted = recognizeAggregableComposition({
      ">": [{ call: ["length", { var: "value" }] }, 5],
    });
    expect(lifted).toEqual({
      aggFn: "length",
      outputSet: { $tag: "SeWhere", pred: { $tag: "ECall", fnId: "gt", args: [{ $tag: "EVar", name: "value" }, { $tag: "ELit", value: 5 }] } },
    });
  });

  it("recognises equality (`length(value) == 5`)", () => {
    const lifted = recognizeAggregableComposition({
      "==": [{ call: ["length", { var: "value" }] }, 5],
    });
    expect(lifted).toEqual({ aggFn: "length", outputSet: { $tag: "SeEnum", values: [5] } });
  });

  it("recognises `in` form (`length(value) in [1,2,3]`)", () => {
    const lifted = recognizeAggregableComposition({
      in: [{ call: ["length", { var: "value" }] }, [1, 2, 3]],
    });
    expect(lifted).toEqual({ aggFn: "length", outputSet: { $tag: "SeEnum", values: [1, 2, 3] } });
  });

  it("returns undefined for non-aggregable functions", () => {
    const lifted = recognizeAggregableComposition({
      ">=": [{ call: ["myCustomFn", { var: "value" }] }, 5],
    });
    expect(lifted).toBeUndefined();
  });

  it("returns undefined when value isn't bound to `value`", () => {
    const lifted = recognizeAggregableComposition({
      ">=": [{ call: ["length", { var: "other" }] }, 5],
    });
    expect(lifted).toBeUndefined();
  });

  it("returns undefined for unrelated predicates", () => {
    expect(recognizeAggregableComposition({ ">=": [{ var: "value" }, 5] })).toBeUndefined();
    expect(recognizeAggregableComposition({ and: [] })).toBeUndefined();
    expect(recognizeAggregableComposition({})).toBeUndefined();
  });
});

// ---------------------------------------------------------------------------
// setWhereDecideSubset — residual numeric ordering abstains. compToSet keeps
// SeWhere instead of an interval; the source's proof gate accepts Just true
// only, so distinct residual comparisons fall through to Nothing.
// ---------------------------------------------------------------------------

function whereLengthGte(n: number): SetExpr {
  return { $tag: "SeWhere", pred: { ">=": [{ call: ["length", { var: "value" }] }, n] } };
}

function whereSumLte(n: number): SetExpr {
  return { $tag: "SeWhere", pred: { "<=": [{ call: ["sum", { var: "value" }] }, n] } };
}

function whereLengthEq(n: number): SetExpr {
  return { $tag: "SeWhere", pred: { "==": [{ call: ["length", { var: "value" }] }, n] } };
}

describe("setWhereDecideSubset — Aggregable composition reasoning", () => {
  it("`length(v) >= 5` ⊆ `length(v) >= 3` abstains without carrier provenance", () => {
    expect(isSubset(whereLengthGte(5), whereLengthGte(3))).toEqual(Nothing);
  });

  it("`length(v) >= 10` ⊆ `length(v) >= 5` abstains without carrier provenance", () => {
    expect(isSubset(whereLengthGte(10), whereLengthGte(5))).toEqual(Nothing);
  });

  it("`length(v) >= 3` ⊆ `length(v) >= 5` — algebra falls through (Nothing)", () => {
    // Neither residual numeric comparison extracts to an exact interval.
    const result = isSubset(whereLengthGte(3), whereLengthGte(5));
    expect(result).toEqual({ $tag: "Nothing" });
  });

  it("`sum(v) <= 10` ⊆ `sum(v) <= 100` abstains without carrier provenance", () => {
    expect(isSubset(whereSumLte(10), whereSumLte(100))).toEqual(Nothing);
  });

  it("structural equality survives the new path (`length(v) >= 5` ⊆ itself)", () => {
    expect(isSubset(whereLengthGte(5), whereLengthGte(5))).toEqual({ $tag: "Just", _0: true });
  });

  it("different aggregators don't compare (length(v) ⊆ sum(v) — Nothing)", () => {
    const lhs = whereLengthGte(5);
    const rhs: SetExpr = { $tag: "SeWhere", pred: { ">=": [{ call: ["sum", { var: "value" }] }, 5] } };
    // Algebra returns Nothing — not a $preimage match.
    expect(isSubset(lhs, rhs)).toEqual({ $tag: "Nothing" });
  });
});

// ---------------------------------------------------------------------------
// setWhereDecideDisjoint — disjointness reasoning over output sets
// ---------------------------------------------------------------------------

describe("setWhereDecideDisjoint — Aggregable composition reasoning", () => {
  it("`length(v) == 3` and `length(v) == 5` are disjoint (Just true)", () => {
    expect(isDisjoint(whereLengthEq(3), whereLengthEq(5))).toEqual({ $tag: "Just", _0: true });
  });

  it("`length(v) >= 10` and `length(v) <= 5` abstain without exact interval extraction", () => {
    const a = whereLengthGte(10);
    const b: SetExpr = { $tag: "SeWhere", pred: { "<=": [{ call: ["length", { var: "value" }] }, 5] } };
    expect(isDisjoint(a, b)).toEqual(Nothing);
  });

  it("`length(v) >= 5` and `length(v) >= 10` are NOT disjoint — Nothing", () => {
    // Residual numeric comparisons do not supply exact interval facts.
    const result = isDisjoint(whereLengthGte(5), whereLengthGte(10));
    expect(result).toEqual({ $tag: "Nothing" });
  });

  it("disjoint enum-shaped output sets prove disjointness", () => {
    const a: SetExpr = { $tag: "SeWhere", pred: { in: [{ call: ["length", { var: "value" }] }, [3, 5]] } };
    const b: SetExpr = { $tag: "SeWhere", pred: { in: [{ call: ["length", { var: "value" }] }, [10, 20]] } };
    expect(isDisjoint(a, b)).toEqual({ $tag: "Just", _0: true });
  });
});

// ---------------------------------------------------------------------------
// set-algebra-to-fenel 2b-where — the `$where` subset/disjoint arms now
// self-reason Fenel-side via cross-query re-entries over pre-marshalled lifts.
// Numeric comparisons cannot supply exact extraction: comprehendClosed
// rejects the SeWhere residual because interval membership admits additional
// integer carriers. The Aggregable path likewise retains the scalar predicate.
// Exact enum output proofs and conservative overlapping fall-through survive.
// ---------------------------------------------------------------------------

function whereValueGte(n: number): SetExpr {
  return { $tag: "SeWhere", pred: { ">=": [{ var: "value" }, n] } };
}

describe("2b-where — $where subset/disjoint re-entries", () => {
  it("SeWhere extraction — `value >= 5` ⊆ `value >= 3` preserves the numeric-carrier fence", () => {
    expect(isSubset(whereValueGte(5), whereValueGte(3))).toEqual(Nothing);
  });

  it("SeWhere extraction — `value >= 3` ⊆ `value >= 5` abstains without exact extraction", () => {
    // comprehendClosed returns Nothing instead of treating the broader
    // numeric interval as the exact native scalar predicate.
    expect(isSubset(whereValueGte(3), whereValueGte(5))).toEqual(Nothing);
  });

  it("Aggregable output-set fence — `length(v) >= 5` ⊆ `length(v) >= 3`", () => {
    // The output comparison retains SeWhere, so it cannot pass the Just-true
    // gate and reaches the conservative tail.
    expect(isSubset(whereLengthGte(5), whereLengthGte(3))).toEqual(Nothing);
  });

  it("Aggregable non-proof — `length(v) >= 3` ⊆ `length(v) >= 5` falls through", () => {
    // The output-set subset is non-positive; the body falls through to the
    // Fenel-owned SeWhere tail (structural eq fails ⇒ Nothing).
    expect(isSubset(whereLengthGte(3), whereLengthGte(5))).toEqual({ $tag: "Nothing" });
  });

  it("aggDisjoint lift — `length(v) in [1,2]` ⊥ `length(v) in [5,6]` (Just true)", () => {
    const a: SetExpr = { $tag: "SeWhere", pred: { in: [{ call: ["length", { var: "value" }] }, [1, 2]] } };
    const b: SetExpr = { $tag: "SeWhere", pred: { in: [{ call: ["length", { var: "value" }] }, [5, 6]] } };
    expect(isDisjoint(a, b)).toEqual({ $tag: "Just", _0: true });
  });

  it("aggDisjoint fall-through — overlapping `length(v) in [1,2]` ⊥ `length(v) in [2,3]` (Nothing)", () => {
    // The lifted enums share `2`, so `setAlgebraIsDisjoint` is not `Just true`;
    // the body returns Nothing (a non-positive lift does not refute).
    const a: SetExpr = { $tag: "SeWhere", pred: { in: [{ call: ["length", { var: "value" }] }, [1, 2]] } };
    const b: SetExpr = { $tag: "SeWhere", pred: { in: [{ call: ["length", { var: "value" }] }, [2, 3]] } };
    expect(isDisjoint(a, b)).toEqual({ $tag: "Nothing" });
  });
});

// ---------------------------------------------------------------------------
// setWhereDecideEmpty — empty-output-set lifts to empty input
// ---------------------------------------------------------------------------

describe("setWhereDecideEmpty — Aggregable empty propagation", () => {
  it("`length(v) < 0` preserves the numeric comparison extraction fence", () => {
    // The output lift retains SeWhere, rather than treating a native numeric
    // comparison as the broader interval. No exact output-set emptiness proof
    // passes this gate, even though length's declared return type is Nat.
    const a: SetExpr = { $tag: "SeWhere", pred: { "<": [{ call: ["length", { var: "value" }] }, 0] } };
    const result = decideEmpty(a);
    expect(result).toEqual(Nothing);
  });

  it("predicate referencing unknown var → falls through (Nothing)", () => {
    const a: SetExpr = { $tag: "SeWhere", pred: { ">=": [{ var: "other" }, 5] } };
    expect(decideEmpty(a)).toEqual({ $tag: "Nothing" });
  });

  // Phase 2a (set-algebra-to-fenel) — the empty $where arm now self-reasons
  // in the Fenel body via the ported recognizeAggregableComposition. The
  // `in []` form lifts to an empty $enum, so f⁻¹(∅) = ∅ ⇒ provably empty.
  // (The oracles above barely exercise the recognition; these pin it.)
  it("`length(v) in []` lifts to an empty enum — provably empty (Just true)", () => {
    const a: SetExpr = { $tag: "SeWhere", pred: { in: [{ call: ["length", { var: "value" }] }, []] } };
    expect(decideEmpty(a)).toEqual({ $tag: "Just", _0: true });
  });

  it("non-empty `in` enum → not provably empty (Nothing)", () => {
    const a: SetExpr = { $tag: "SeWhere", pred: { in: [{ call: ["length", { var: "value" }] }, [10, 20]] } };
    expect(decideEmpty(a)).toEqual({ $tag: "Nothing" });
  });

  it("non-aggregable `in []` → unrecognised, no empty claim (Nothing)", () => {
    // The recogniser only fires for registered Aggregables; an unregistered
    // function inside `in []` must NOT be lifted to the empty set.
    expect(isAggregable("notAnAgg")).toBe(false);
    const a: SetExpr = { $tag: "SeWhere", pred: { in: [{ call: ["notAnAgg", { var: "value" }] }, []] } };
    expect(decideEmpty(a)).toEqual({ $tag: "Nothing" });
  });
});

// ---------------------------------------------------------------------------
// Conservative fall-through — algebra never accepts an incorrect proof
// ---------------------------------------------------------------------------

describe("conservative fall-through — open-form preimages", () => {
  it("non-aggregable function inside $where → Nothing (no false subset claim)", () => {
    const a: SetExpr = { $tag: "SeWhere", pred: { ">=": [{ call: ["myCustomFn", { var: "value" }] }, 5] } };
    const b: SetExpr = { $tag: "SeWhere", pred: { ">=": [{ call: ["myCustomFn", { var: "value" }] }, 3] } };
    // Neither side recognises as Aggregable; the algebra returns Nothing
    // — never `Just true`. (After the user registers `myCustomFn` as
    // aggregable, the same query proves Just true; see the user-aggregator
    // test below.)
    expect(isSubset(a, b)).toEqual({ $tag: "Nothing" });
    expect(isDisjoint(a, b)).toEqual({ $tag: "Nothing" });
  });

  it("opaque output-set shape on one side → Nothing", () => {
    // length(v) in {$ref: "MyShape"} — the recogniser can't lift {$ref}
    // to an output set comparison; the rule doesn't fire. Falls through
    // to the existing tail rules, which surface Nothing.
    const a: SetExpr = { $tag: "SeWhere", pred: { ">=": [{ call: ["length", { var: "value" }] }, 5] } };
    const b: SetExpr = { $tag: "SeRef", handle: "MyOpaqueShape" };
    expect(isSubset(a, b)).toEqual({ $tag: "Nothing" });
  });
});

// ---------------------------------------------------------------------------
// User-defined aggregator — register at test time, exercise the same rules
// ---------------------------------------------------------------------------

describe("user-defined aggregator participates via registerAggregable", () => {
  it("registering `firstChar` enables composition-shape reasoning", () => {
    // Sanity: not registered yet.
    expect(isAggregable("firstChar")).toBe(false);
    const a: SetExpr = { $tag: "SeWhere", pred: { "==": [{ call: ["firstChar", { var: "value" }] }, "a"] } };
    const b: SetExpr = { $tag: "SeWhere", pred: { "==": [{ call: ["firstChar", { var: "value" }] }, "b"] } };

    // Before registration: algebra surfaces Nothing (honest).
    expect(isSubset(a, b)).toEqual({ $tag: "Nothing" });
    expect(isDisjoint(a, b)).toEqual({ $tag: "Nothing" });

    // Register the user aggregator.
    registerAggregable("firstChar");

    try {
      expect(isAggregable("firstChar")).toBe(true);

      // Now the disjointness rule fires: `firstChar(v) == "a"` and
      // `firstChar(v) == "b"` lift to disjoint $enum output sets.
      expect(isDisjoint(a, b)).toEqual({ $tag: "Just", _0: true });

      // And subset over a wider output set proves:
      const widerB: SetExpr = { $tag: "SeWhere", pred: { in: [{ call: ["firstChar", { var: "value" }] }, ["a", "b", "c"]] } };
      expect(isSubset(a, widerB)).toEqual({ $tag: "Just", _0: true });
    } finally {
      unregisterAggregable("firstChar");
    }
  });
});

// ---------------------------------------------------------------------------
// Preimage roundtrip native — Aggregable law's per-case checker
// ---------------------------------------------------------------------------

describe("preimageRoundtripCheck native — law's per-case witness", () => {
  it("`length('hello')` lands in preimage of {5}", () => {
    const check = aggregableNatives["preimageRoundtripCheck"]!;
    expect(check({ aggFn: "length", outputSet: { $tag: "SeEnum", values: [5] }, value: "hello" })).toEqual({
      $tag: "Just",
      _0: true,
    });
  });

  it("an interval preimage abstention also leaves the law antecedent probe unchecked", () => {
    const check = aggregableNatives["preimageRoundtripCheck"]!;
    expect(
      check({
        aggFn: "length",
        outputSet: { $tag: "SeInterval", interval: { lo: Just({ value: 3, inclusive: true }), hi: Nothing } },
        value: "hello",
      }),
    ).toEqual(Nothing);
  });

  it("unregistered aggregator → Nothing (vacuous)", () => {
    const check = aggregableNatives["preimageRoundtripCheck"]!;
    expect(check({ aggFn: "noSuchFn", outputSet: { $tag: "SeEnum", values: [1] }, value: "abc" })).toEqual({
      $tag: "Nothing",
    });
  });

  it("opaque output set (no closed-form preimage) → Nothing", () => {
    const check = aggregableNatives["preimageRoundtripCheck"]!;
    expect(
      check({ aggFn: "length", outputSet: { $tag: "SeRef", handle: "MyShape" }, value: "abc" }),
    ).toEqual({ $tag: "Nothing" });
  });
});
