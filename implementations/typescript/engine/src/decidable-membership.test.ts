// ---------------------------------------------------------------------------
// DecidableMembership — typeclass-driven SetExpr dispatch tests.
//
// Three things this suite exercises that the existing set-algebra tests
// don't:
//
//   1. The new per-shape exported impls (setIntervalContains etc.) work in
//      isolation, without going through the orchestrating dispatchers.
//      Lets future work refactor the orchestration layer without losing
//      coverage of the underlying decision procedures.
//
//   2. The typeclass-registry surface is real: a `{call: ["set:set...", set,
//      value]}` expression dispatches to the same impl as set-algebra's
//      in-engine fast-path. This is the integration point that lets
//      external systems plug in via DecidableMembership instances.
//
//   3. The new `decideEmpty` dispatcher tracks the structural-emptiness
//      lattice across all 11 shapes. Together with `isEmpty` (which pre-
//      normalises) it covers the same ground as the legacy
//      `"$none" in normalize(set)` check.
// ---------------------------------------------------------------------------

import { describe, it, expect } from "vitest";
import {
  containsB as contains,
  isSubsetB as isSubset,
  isDisjointB as isDisjoint,
  isEmptyB as isEmpty,
  decideEmptyB as decideEmpty,
  setAllContains as _setAllContains,
  setNoneContains as _setNoneContains,
  setEnumContains as _setEnumContains,
  setIntervalContains as _setIntervalContains,
  setNamedContains as _setNamedContains,
  setUnionContains as _setUnionContains,
  setIntersectContains as _setIntersectContains,
  setDiffContains as _setDiffContains,
  setComplementContains as _setComplementContains,
  // set-algebra-to-fenel Phase 3a — the per-shape `setXxxDecide*` exports
  // were deleted (Path-B-only duplicates). These per-shape unit assertions
  // re-pin to the top-level Fenel dispatchers (`isSubset` / `isDisjoint` /
  // `decideEmpty`), which decide the SAME tri-state for each shape (the
  // delegation `dmNatives` now uses). Mechanical test re-pin.
  isSubset as _isSubsetDispatch,
  isDisjoint as _isDisjointDispatch,
  decideEmpty as _decideEmptyDispatch,
  mGet,
} from "./set-algebra";

// Per-shape impls return MaybeBool (Phase 4); the existing assertions
// compare against booleans, so wrap each call to collapse Nothing → false.
// New tests targeting tri-state behaviour assert against MaybeBool values
// directly.
const setAllContains = (...args: Parameters<typeof _setAllContains>) => mGet(_setAllContains(...args), false);
const setNoneContains = (...args: Parameters<typeof _setNoneContains>) => mGet(_setNoneContains(...args), false);
const setEnumContains = (...args: Parameters<typeof _setEnumContains>) => mGet(_setEnumContains(...args), false);
const setIntervalContains = (...args: Parameters<typeof _setIntervalContains>) => mGet(_setIntervalContains(...args), false);
const setNamedContains = (...args: Parameters<typeof _setNamedContains>) => mGet(_setNamedContains(...args), false);
const setUnionContains = (...args: Parameters<typeof _setUnionContains>) => mGet(_setUnionContains(...args), false);
const setIntersectContains = (...args: Parameters<typeof _setIntersectContains>) => mGet(_setIntersectContains(...args), false);
const setDiffContains = (...args: Parameters<typeof _setDiffContains>) => mGet(_setDiffContains(...args), false);
const setComplementContains = (...args: Parameters<typeof _setComplementContains>) => mGet(_setComplementContains(...args), false);

// Phase 3a re-pin — each former per-shape decider now routes through the
// top-level dispatcher (collapsing Nothing → false as before).
const setAllDecideEmpty = (...args: Parameters<typeof _decideEmptyDispatch>) => mGet(_decideEmptyDispatch(...args), false);
const setNoneDecideEmpty = (...args: Parameters<typeof _decideEmptyDispatch>) => mGet(_decideEmptyDispatch(...args), false);
const setEnumDecideEmpty = (...args: Parameters<typeof _decideEmptyDispatch>) => mGet(_decideEmptyDispatch(...args), false);
const setIntervalDecideEmpty = (...args: Parameters<typeof _decideEmptyDispatch>) => mGet(_decideEmptyDispatch(...args), false);
const setUnionDecideEmpty = (...args: Parameters<typeof _decideEmptyDispatch>) => mGet(_decideEmptyDispatch(...args), false);
const setIntersectDecideEmpty = (...args: Parameters<typeof _decideEmptyDispatch>) => mGet(_decideEmptyDispatch(...args), false);
const setComplementDecideEmpty = (...args: Parameters<typeof _decideEmptyDispatch>) => mGet(_decideEmptyDispatch(...args), false);
const setDiffDecideEmpty = (...args: Parameters<typeof _decideEmptyDispatch>) => mGet(_decideEmptyDispatch(...args), false);

const setEnumDecideSubset = (...args: Parameters<typeof _isSubsetDispatch>) => mGet(_isSubsetDispatch(...args), false);
const setIntervalDecideSubset = (...args: Parameters<typeof _isSubsetDispatch>) => mGet(_isSubsetDispatch(...args), false);
const setUnionDecideSubset = (...args: Parameters<typeof _isSubsetDispatch>) => mGet(_isSubsetDispatch(...args), false);
const setEnumDecideDisjoint = (...args: Parameters<typeof _isDisjointDispatch>) => mGet(_isDisjointDispatch(...args), false);
const setIntervalDecideDisjoint = (...args: Parameters<typeof _isDisjointDispatch>) => mGet(_isDisjointDispatch(...args), false);
import { evaluate } from "./json-logic";
import { getSystemEvaluateContext } from "./system-registry";
import { dispatchRegistry } from "./system-entities";
import {
  dmInstanceInterval,
  dmInstanceEnum,
  dmInstancePattern,
  dmNatives,
} from "./modules/decidable-membership";
import {
  dispatchedContains,
  dispatchedDecideEmpty,
  dispatchedEnumerateSet,
  dispatchedIsDisjoint,
  dispatchedIsSubset,
  dispatchedMaxOfSet,
  dispatchedMinOfSet,
  dispatchedSampleSet,
} from "./engine-bodies-dispatch";
import { markDegradedTypeProjection } from "./set-marker";
import type { SetExpr } from "./types";
import { Just } from "./type-foundation";

// ---------------------------------------------------------------------------
// Per-shape contains impls — exercise each impl directly
// ---------------------------------------------------------------------------

describe("per-shape contains impls", () => {
  it("setAllContains / setNoneContains are trivial", () => {
    expect(setAllContains({ $tag: "SeAll" }, 0)).toBe(true);
    expect(setAllContains({ $tag: "SeAll" }, "anything")).toBe(true);
    expect(setNoneContains({ $tag: "SeNone" }, 0)).toBe(false);
    expect(setNoneContains({ $tag: "SeNone" }, null)).toBe(false);
  });

  it("setEnumContains uses list-includes", () => {
    expect(setEnumContains({ $tag: "SeEnum", values: [1, 2, 3] }, 2)).toBe(true);
    expect(setEnumContains({ $tag: "SeEnum", values: [1, 2, 3] }, 5)).toBe(false);
    expect(setEnumContains({ $tag: "SeEnum", values: ["a", "b"] }, "b")).toBe(true);
  });

  it("setIntervalContains delegates to inInterval", () => {
    const iv = { $tag: "SeInterval", interval: { lo: Just({ value: 0, inclusive: true }), hi: Just({ value: 10, inclusive: false }) } } as const;
    expect(setIntervalContains(iv, 0)).toBe(true);
    expect(setIntervalContains(iv, 5)).toBe(true);
    expect(setIntervalContains(iv, 10)).toBe(false); // exclusive hi
    expect(setIntervalContains(iv, -1)).toBe(false);
  });

  it("setNamedContains hits the named-set registry", () => {
    expect(setNamedContains({ $tag: "SeRef", handle: "Nat" }, 3, null)).toBe(true);
    expect(setNamedContains({ $tag: "SeRef", handle: "Nat" }, -1, null)).toBe(false);
    expect(setNamedContains({ $tag: "SeRef", handle: "String" }, "hi", null)).toBe(true);
  });

  it("setUnionContains short-circuits on first match", () => {
    const u: Extract<SetExpr, { $tag: "SeUnion" }> = {
      $tag: "SeUnion", branches: [{ $tag: "SeEnum", values: [1, 2] }, { $tag: "SeEnum", values: [10, 11] }],
    };
    expect(setUnionContains(u, 1, null)).toBe(true);
    expect(setUnionContains(u, 11, null)).toBe(true);
    expect(setUnionContains(u, 5, null)).toBe(false);
  });

  it("setIntersectContains requires every child to match", () => {
    const i: Extract<SetExpr, { $tag: "SeIntersect" }> = {
      $tag: "SeIntersect", branches: [{ $tag: "SeRef", handle: "Nat" }, { $tag: "SeEnum", values: [0, 1, 2, 3, 4, 5] }],
    };
    expect(setIntersectContains(i, 3, null)).toBe(true);
    expect(setIntersectContains(i, -1, null)).toBe(false); // fails Nat
    expect(setIntersectContains(i, 10, null)).toBe(false); // fails enum
  });

  it("setDiffContains is A and not B", () => {
    const d: Extract<SetExpr, { $tag: "SeDiff" }> = {
      $tag: "SeDiff", left: { $tag: "SeEnum", values: [1, 2, 3, 4, 5] }, right: { $tag: "SeEnum", values: [3] },
    };
    expect(setDiffContains(d, 1, null)).toBe(true);
    expect(setDiffContains(d, 3, null)).toBe(false);
    expect(setDiffContains(d, 5, null)).toBe(true);
  });

  it("setComplementContains inverts membership", () => {
    const c: Extract<SetExpr, { $tag: "SeComplement" }> = { $tag: "SeComplement", inner: { $tag: "SeEnum", values: [1, 2, 3] } };
    expect(setComplementContains(c, 0, null)).toBe(true);
    expect(setComplementContains(c, 1, null)).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// Per-shape decideSubset / decideDisjoint impls
// ---------------------------------------------------------------------------

describe("per-shape decideSubset impls", () => {
  it("setEnumDecideSubset: enum ⊆ enum (superset check)", () => {
    expect(setEnumDecideSubset({ $tag: "SeEnum", values: [1, 2] }, { $tag: "SeEnum", values: [1, 2, 3] })).toBe(true);
    expect(setEnumDecideSubset({ $tag: "SeEnum", values: [1, 4] }, { $tag: "SeEnum", values: [1, 2, 3] })).toBe(false);
  });

  it("setEnumDecideSubset: enum ⊆ interval (each value check)", () => {
    expect(setEnumDecideSubset(
      { $tag: "SeEnum", values: [3, 5, 7] },
      { $tag: "SeInterval", interval: { lo: Just({ value: 0, inclusive: true }), hi: Just({ value: 10, inclusive: true }) } },
    )).toBe(true);
    expect(setEnumDecideSubset(
      { $tag: "SeEnum", values: [3, 5, 11] },
      { $tag: "SeInterval", interval: { lo: Just({ value: 0, inclusive: true }), hi: Just({ value: 10, inclusive: true }) } },
    )).toBe(false);
  });

  it("setIntervalDecideSubset: interval ⊆ interval (range containment)", () => {
    const tight: SetExpr = { $tag: "SeInterval", interval: { lo: Just({ value: 5, inclusive: true }), hi: Just({ value: 10, inclusive: true }) } };
    const loose: SetExpr = { $tag: "SeInterval", interval: { lo: Just({ value: 0, inclusive: true }), hi: Just({ value: 20, inclusive: true }) } };
    expect(setIntervalDecideSubset(tight, loose)).toBe(true);
    expect(setIntervalDecideSubset(loose, tight)).toBe(false);
  });

  it("setUnionDecideSubset: every member ⊆ right", () => {
    expect(setUnionDecideSubset(
      { $tag: "SeUnion", branches: [{ $tag: "SeEnum", values: [1, 2] }, { $tag: "SeEnum", values: [3, 4] }] },
      { $tag: "SeEnum", values: [1, 2, 3, 4, 5] },
    )).toBe(true);
    expect(setUnionDecideSubset(
      { $tag: "SeUnion", branches: [{ $tag: "SeEnum", values: [1, 2] }, { $tag: "SeEnum", values: [3, 4] }] },
      { $tag: "SeEnum", values: [1, 2] },
    )).toBe(false);
  });
});

describe("per-shape decideDisjoint impls", () => {
  it("setEnumDecideDisjoint: disjoint enum lists", () => {
    expect(setEnumDecideDisjoint({ $tag: "SeEnum", values: [1, 2] }, { $tag: "SeEnum", values: [3, 4] })).toBe(true);
    expect(setEnumDecideDisjoint({ $tag: "SeEnum", values: [1, 2] }, { $tag: "SeEnum", values: [2, 3] })).toBe(false);
  });

  it("setIntervalDecideDisjoint: non-overlapping intervals", () => {
    expect(setIntervalDecideDisjoint(
      { $tag: "SeInterval", interval: { lo: Just({ value: 0, inclusive: true }), hi: Just({ value: 5, inclusive: true }) } },
      { $tag: "SeInterval", interval: { lo: Just({ value: 10, inclusive: true }), hi: Just({ value: 20, inclusive: true }) } },
    )).toBe(true);
    expect(setIntervalDecideDisjoint(
      { $tag: "SeInterval", interval: { lo: Just({ value: 0, inclusive: true }), hi: Just({ value: 5, inclusive: true }) } },
      { $tag: "SeInterval", interval: { lo: Just({ value: 3, inclusive: true }), hi: Just({ value: 8, inclusive: true }) } },
    )).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// decideEmpty — per-shape structural emptiness
// ---------------------------------------------------------------------------

describe("per-shape decideEmpty impls", () => {
  it("trivial shapes", () => {
    expect(setAllDecideEmpty({ $tag: "SeAll" })).toBe(false);
    expect(setNoneDecideEmpty({ $tag: "SeNone" })).toBe(true);
  });

  it("empty enum is empty; non-empty enum isn't", () => {
    expect(setEnumDecideEmpty({ $tag: "SeEnum", values: [] })).toBe(true);
    expect(setEnumDecideEmpty({ $tag: "SeEnum", values: [1] })).toBe(false);
  });

  it("invalid interval (lo > hi) is empty", () => {
    expect(setIntervalDecideEmpty({ $tag: "SeInterval", interval: { lo: Just({ value: 10, inclusive: true }), hi: Just({ value: 5, inclusive: true }) } })).toBe(true);
    expect(setIntervalDecideEmpty({ $tag: "SeInterval", interval: { lo: Just({ value: 5, inclusive: true }), hi: Just({ value: 5, inclusive: false }) } })).toBe(true);
    expect(setIntervalDecideEmpty({ $tag: "SeInterval", interval: { lo: Just({ value: 0, inclusive: true }), hi: Just({ value: 10, inclusive: true }) } })).toBe(false);
  });

  it("union empty iff every child empty", () => {
    expect(setUnionDecideEmpty({ $tag: "SeUnion", branches: [{ $tag: "SeNone" }, { $tag: "SeEnum", values: [] }] })).toBe(true);
    expect(setUnionDecideEmpty({ $tag: "SeUnion", branches: [{ $tag: "SeNone" }, { $tag: "SeEnum", values: [1] }] })).toBe(false);
  });

  it("intersect empty if any child empty, or if children pairwise disjoint", () => {
    expect(setIntersectDecideEmpty({ $tag: "SeIntersect", branches: [{ $tag: "SeNone" }, { $tag: "SeAll" }] })).toBe(true);
    expect(setIntersectDecideEmpty({ $tag: "SeIntersect", branches: [{ $tag: "SeEnum", values: [1, 2] }, { $tag: "SeEnum", values: [3, 4] }] })).toBe(true); // pairwise disjoint enums
    expect(setIntersectDecideEmpty({ $tag: "SeIntersect", branches: [{ $tag: "SeEnum", values: [1, 2] }, { $tag: "SeEnum", values: [2, 3] }] })).toBe(false);
  });

  it("complement empty iff inner is the universe", () => {
    expect(setComplementDecideEmpty({ $tag: "SeComplement", inner: { $tag: "SeAll" } })).toBe(true);
    expect(setComplementDecideEmpty({ $tag: "SeComplement", inner: { $tag: "SeEnum", values: [1] } })).toBe(false);
  });

  it("diff empty iff A empty or A ⊆ B", () => {
    expect(setDiffDecideEmpty({ $tag: "SeDiff", left: { $tag: "SeNone" }, right: { $tag: "SeAll" } })).toBe(true);
    expect(setDiffDecideEmpty({ $tag: "SeDiff", left: { $tag: "SeEnum", values: [1, 2] }, right: { $tag: "SeEnum", values: [1, 2, 3] } })).toBe(true);
    expect(setDiffDecideEmpty({ $tag: "SeDiff", left: { $tag: "SeEnum", values: [1, 2, 3] }, right: { $tag: "SeEnum", values: [1] } })).toBe(false);
  });
});

describe("decideEmpty (dispatcher) — direct shape-table dispatch", () => {
  it("walks the shape table without pre-normalisation", () => {
    expect(decideEmpty({ $tag: "SeNone" })).toBe(true);
    expect(decideEmpty({ $tag: "SeEnum", values: [] })).toBe(true);
    expect(decideEmpty({ $tag: "SeAll" })).toBe(false);
  });
});

describe("isEmpty (orchestrator) — pre-normalises, then decideEmpty", () => {
  it("catches emptiness only visible after normalisation", () => {
    // Two disjoint intervals intersected: structurally not empty per-shape
    // (intersect's children aren't $none), but normalize splays the
    // disjointness and yields $none.
    const set: SetExpr = { $tag: "SeIntersect", branches: [
        { $tag: "SeInterval", interval: { lo: Just({ value: 0, inclusive: true }), hi: Just({ value: 5, inclusive: true }) } },
        { $tag: "SeInterval", interval: { lo: Just({ value: 10, inclusive: true }), hi: Just({ value: 20, inclusive: true }) } },
      ] };
    expect(decideEmpty(set)).toBe(true); // intersect-pairwise-disjoint catches it
    expect(isEmpty(set)).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// Top-level dispatchers route through the shape table
// ---------------------------------------------------------------------------

describe("top-level dispatchers consult the shape table", () => {
  it("contains routes via setShape → SHAPE_CONTAINS_IMPLS", () => {
    // Structural smoke test — if dispatch worked at all, these all return
    // the right values. The specific behaviour is covered by the per-
    // shape tests above; here we're just verifying the dispatcher is
    // routing.
    expect(contains({ $tag: "SeAll" }, "anything", null)).toBe(true);
    expect(contains({ $tag: "SeNone" }, 0, null)).toBe(false);
    expect(contains({ $tag: "SeEnum", values: [1, 2, 3] }, 2, null)).toBe(true);
    expect(contains({ $tag: "SeIntersect", branches: [{ $tag: "SeRef", handle: "Nat" }, { $tag: "SeEnum", values: [3, 7] }] }, 3, null)).toBe(true);
  });

  it("isSubset trivial cases bypass the table; non-trivial route through", () => {
    // Trivials
    expect(isSubset({ $tag: "SeNone" }, { $tag: "SeEnum", values: [1] })).toBe(true);
    expect(isSubset({ $tag: "SeEnum", values: [1] }, { $tag: "SeAll" })).toBe(true);
    // Per-shape (left = SetEnum)
    expect(isSubset({ $tag: "SeEnum", values: [1, 2] }, { $tag: "SeEnum", values: [1, 2, 3] })).toBe(true);
    // Per-shape (left = SetUnion) recurses into right
    expect(isSubset(
      { $tag: "SeUnion", branches: [{ $tag: "SeEnum", values: [1] }, { $tag: "SeEnum", values: [2] }] },
      { $tag: "SeEnum", values: [1, 2, 3] },
    )).toBe(true);
  });

  it("isDisjoint tries both LEFT and RIGHT shape impls (symmetric)", () => {
    // Pattern vs numeric interval — the disjoint rule fires from the
    // Pattern impl regardless of which side the pattern is on, courtesy
    // of isDisjoint's symmetric-retry loop.
    const pattern: SetExpr = { $tag: "SePattern", pattern: { t: "match", pred: { $tag: "SeRef", handle: "char:ascii-letter" } } };
    const numInterval: SetExpr = { $tag: "SeInterval", interval: { lo: Just({ value: 0, inclusive: true }), hi: Just({ value: 10, inclusive: true }) } };
    expect(isDisjoint(pattern, numInterval)).toBe(true);
    expect(isDisjoint(numInterval, pattern)).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// Registry surface — instances ride through the typeclass registry
// ---------------------------------------------------------------------------

describe("DecidableMembership instances are registered", () => {
  it("dispatchRegistry has one instance per shape", () => {
    const instances = dispatchRegistry.listInstances("DecidableMembership");
    const shapes = new Set(instances.map((i) => i.args[0] as string));
    expect(shapes).toEqual(
      new Set([
        "SetAll", "SetNone", "SetEnum", "SetInterval", "SetNamed",
        "SetPattern", "SetWhere", "SetUnion", "SetIntersect", "SetDiff",
        "SetComplement",
        // decide-substrate Phase 8μ.1a/1b/8λ.1 — the datatype / fixpoint /
        // exponential SET-former shapes join the DecidableMembership family.
        "SetCtor", "SetMu", "SetArrow",
        // signature-substrate P4 slice 3a — the validation-only rigid atom.
        // Every method on this row is an abstention face (the four decisions go
        // through the polymorphic dispatchers, whose deciders carry explicit
        // `SeRigid` arms; `witness`/`enumerate` are the honest no-witness /
        // non-enumerable faces), so no shape is missing a row.
        "SetRigid",
      ]),
    );
  });

  it("each instance's methods reference the per-shape functions", () => {
    // modules-as-values Phase 2c: qualified references to the same functions
    // (`set.setIntervalContains` is `set:setIntervalContains`).
    expect(dmInstanceInterval.typeName).toBe("DecidableMembership");
    expect(dmInstanceInterval.args).toEqual(["SetInterval"]);
    expect(dmInstanceInterval.methods.contains).toEqual({ $ref: "set.setIntervalContains" });
    expect(dmInstanceInterval.methods.decideSubset).toEqual({ $ref: "set.setIntervalDecideSubset" });
    expect(dmInstanceInterval.methods.decideDisjoint).toEqual({ $ref: "set.setIntervalDecideDisjoint" });
    expect(dmInstanceInterval.methods.decideEmpty).toEqual({ $ref: "set.setIntervalDecideEmpty" });
    expect(dmInstanceEnum.methods.contains).toEqual({ $ref: "set.setEnumContains" });
    expect(dmInstancePattern.methods.contains).toEqual({ $ref: "set.setPatternContains" });
  });
});

describe("Fenel-function dispatch — {call: ['set:set...']} routes to natives", () => {
  const ctx = getSystemEvaluateContext();

  it("set:setEnumContains via evaluate matches the direct impl", () => {
    const enumSet = { $enum: [1, 2, 3] };
    expect(
      evaluate({ call: ["set:setEnumContains", enumSet, 2] }, {}, ctx),
    ).toEqual({ $tag: "Just", _0: true });
    expect(
      evaluate({ call: ["set:setEnumContains", enumSet, 5] }, {}, ctx),
    ).toEqual({ $tag: "Just", _0: false });
  });

  it("set:setIntervalDecideEmpty fires structurally on invalid bounds", () => {
    expect(
      evaluate(
        {
          call: [
            "set:setIntervalDecideEmpty",
            { $interval: { lo: Just({ value: 10, inclusive: true }), hi: Just({ value: 5, inclusive: true }) } },
          ],
        },
        {},
        ctx,
      ),
    ).toEqual({ $tag: "Just", _0: true });
  });

  it("set:setEnumDecideSubset dispatches the pairwise rule", () => {
    // Phase 4: native impls return MaybeBool — `Just true` for subset,
    // `Just false` otherwise.
    expect(
      evaluate(
        {
          call: [
            "set:setEnumDecideSubset",
            { $enum: [1, 2] },
            { $enum: [1, 2, 3] },
          ],
        },
        {},
        ctx,
      ),
    ).toEqual({ $tag: "Just", _0: true });
    expect(
      evaluate(
        {
          call: [
            "set:setEnumDecideSubset",
            { $enum: [1, 4] },
            { $enum: [1, 2, 3] },
          ],
        },
        {},
        ctx,
      ),
    ).toEqual({ $tag: "Just", _0: false });
  });
});

// ---------------------------------------------------------------------------
// Soundness — per the typeclass laws (sample-tested)
//
// The laws live on the DecidableMembership typeclass declaration; this
// section pins specific cases to catch regressions in the dispatchers
// themselves (the law-validator only iterates the inline samples, so a
// per-shape regression that misses every sample would slip).
// ---------------------------------------------------------------------------

describe("soundness — contains × decideSubset", () => {
  it("contains(s, x) ∧ decideSubset(s, t) ⇒ contains(t, x)", () => {
    const s: SetExpr = { $tag: "SeEnum", values: [1, 2, 3] };
    const t: SetExpr = { $tag: "SeEnum", values: [1, 2, 3, 4, 5] };
    expect(isSubset(s, t)).toBe(true);
    expect(contains(s, 2, null) && contains(t, 2, null)).toBe(true);
    expect(contains(s, 3, null) && contains(t, 3, null)).toBe(true);
  });
});

describe("soundness — decideDisjoint ⇒ no shared values", () => {
  it("disjoint enums have no common members", () => {
    const a: SetExpr = { $tag: "SeEnum", values: [1, 2, 3] };
    const b: SetExpr = { $tag: "SeEnum", values: [10, 11, 12] };
    expect(isDisjoint(a, b)).toBe(true);
    for (const x of [1, 2, 3, 10, 11, 12]) {
      expect(contains(a, x, null) && contains(b, x, null)).toBe(false);
    }
  });
});

describe("soundness — decideEmpty ⇒ no members", () => {
  it("emptyEnum has no members", () => {
    const empty: SetExpr = { $tag: "SeEnum", values: [] };
    expect(decideEmpty(empty)).toBe(true);
    for (const x of [0, 1, "anything"]) {
      expect(contains(empty, x, null)).toBe(false);
    }
  });

  it("invalid interval has no members", () => {
    const empty: SetExpr = { $tag: "SeInterval", interval: { lo: Just({ value: 10, inclusive: true }), hi: Just({ value: 5, inclusive: true }) } };
    expect(decideEmpty(empty)).toBe(true);
    for (const x of [0, 7, 15]) {
      expect(contains(empty, x, null)).toBe(false);
    }
  });
});

describe("degraded type projections are never membership evidence", () => {
  const nothing = { $tag: "Nothing" } as const;
  const all: SetExpr = { $tag: "SeAll" };
  const degradedAll = markDegradedTypeProjection(all);
  const degradedEnum = markDegradedTypeProjection({
    $tag: "SeEnum",
    values: [1],
  });
  const legacyWrapped = {
    $union: [degradedAll],
  } as unknown as SetExpr;

  it("guards polymorphic and per-shape DecidableMembership natives", () => {
    expect(dmNatives.contains!(degradedAll, 1)).toEqual(nothing);
    expect(dmNatives.contains!(legacyWrapped, 1)).toEqual(nothing);
    expect(dmNatives.decideSubset!(degradedAll, all)).toEqual(nothing);
    expect(dmNatives.decideDisjoint!(degradedAll, all)).toEqual(nothing);
    expect(dmNatives.decideEmpty!(degradedAll)).toEqual(nothing);
    expect(dmNatives.witness!(degradedAll)).toEqual(nothing);
    expect(dmNatives.enumerate!(degradedEnum)).toEqual(nothing);
    expect(dmNatives.setAllContains!(degradedAll, 1)).toEqual(nothing);
    expect(dmNatives.setAllDecideSubset!(degradedAll, all)).toEqual(nothing);
    expect(dmNatives.setAllDecideDisjoint!(degradedAll, all)).toEqual(nothing);
    expect(dmNatives.setAllDecideEmpty!(degradedAll)).toEqual(nothing);
  });

  it("guards the public judgment adapters, including legacy composition", () => {
    expect(dispatchedContains(degradedAll, 1, null)).toEqual(nothing);
    expect(dispatchedContains(legacyWrapped, 1, null)).toEqual(nothing);
    expect(dispatchedDecideEmpty(degradedAll)).toEqual(nothing);
    expect(dispatchedIsSubset(degradedAll, all)).toEqual(nothing);
    expect(dispatchedIsDisjoint(degradedAll, all)).toEqual(nothing);
    expect(dispatchedEnumerateSet(degradedEnum)).toEqual(nothing);
    expect(dispatchedSampleSet(7, degradedEnum)).toEqual(nothing);
    expect(dispatchedMinOfSet(degradedEnum)).toEqual(nothing);
    expect(dispatchedMaxOfSet(degradedEnum)).toEqual(nothing);
  });
});
