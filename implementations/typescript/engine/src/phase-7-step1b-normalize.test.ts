// ---------------------------------------------------------------------------
// set-algebra-to-fenel Phase 7 Step 1b — `normalizeType : Type -> Type` (P7-5).
// The minimal type-level canonicalizer: delegates inner-set simplification to
// the already-Fenel `setAlgebraNormalize` (via `dispatchedNormalize`) and applies
// the TWO type-envelope lifts ($refined{base,SeNone}⇒$void; $refined{base,SeAll}
// ⇒base) in the `engine:normalizeType` Fenel body (type-formers.fenel).
//
// The SOUNDNESS GATE is the denotation-preservation property (Q3): for every
// input T, `normalizeType T` must be type-EQUAL to T — checked via the Phase-6
// trio (mutual subset, or co-emptiness for the ⊥ cases). A normalize that
// changed denotation would silently corrupt types; this test is the guard.
// ---------------------------------------------------------------------------

import { test, expect, describe } from "bun:test";
import { setDefaultTimeout } from "bun:test";

// type-substrate P1(a.5) — budget raise, no assertion weakened. This suite drives
// the INTERPRETED Fenel deciders, and P1(a.5) added an `empty have` gate to the
// cross-kind subset terminal (the ∅-is-a-subset-of-everything premise the old
// blanket refutation left unstated). That is a real cost: the normalize idempotence fixpoint
// measured under 5 s before the repair and ~10.8 s after, so bun's 5 s default
// turned a PASSING assertion into a red. The verdicts are identical either side —
// verified by running this file against the pre-repair tree. Raise the budget;
// never weaken an assertion to fit it.
setDefaultTimeout(300_000);
import {
  dispatchedNormalizeType,
  dispatchedSubset,
  dispatchedEmpty,
} from "./engine-bodies-dispatch";
import {
  Refined,
  Void,
  Just,
  unionT,
  intersectT,
  complementT,
  diffT,
  topT,
  bottomT,
} from "./type-foundation";
import { buildSetExpr } from "./set-marker";

type Tri = { $tag: "Just"; _0: boolean } | { $tag: "Nothing" };
const JT: Tri = { $tag: "Just", _0: true };

const Int = { $ref: "Int" } as never;
const en = (vs: unknown[]) => buildSetExpr.enum(vs);
const bnd = (v: number, inc: boolean) => ({ value: v, inclusive: inc });
const ivc = (lo: number, hi: number) =>
  buildSetExpr.interval({ lo: Just(bnd(lo, true)), hi: Just(bnd(hi, true)) });

const normT = (t: unknown) => dispatchedNormalizeType(t);
const sub = (a: unknown, b: unknown) => dispatchedSubset(a, b) as Tri;
const emp = (t: unknown) => dispatchedEmpty(t) as Tri;
const tagOf = (t: unknown) =>
  t && typeof t === "object" ? Object.keys(t as object)[0] : String(t);

// denotation-preservation: normalizeType T must be type-EQUAL to T.
const assertDenotationPreserved = (t: unknown) => {
  const n = normT(t);
  const eEmpty = emp(t);
  if (eEmpty.$tag === "Just" && eEmpty._0 === true) {
    // ⊥ case: both empty ⇒ equal denotation
    expect(emp(n)).toEqual(JT);
  } else {
    expect(sub(t, n)).toEqual(JT);
    expect(sub(n, t)).toEqual(JT);
  }
  return n;
};

describe("Step 1b — envelope lift: refined-by-∅ ⇒ $void", () => {
  test("intersectT disjoint ⇒ $void", () => {
    const r = normT(intersectT(Int, [en([1, 2]), en([3, 4])]));
    expect(r).toEqual(Void);
  });
  test("diffT with A⊆B ({1,2}∖{1,2,3}) ⇒ $void", () => {
    const r = normT(diffT(Int, en([1, 2]), en([1, 2, 3])));
    expect(r).toEqual(Void);
  });
  test("interval disjoint intersect ⇒ $void", () => {
    const r = normT(intersectT(Int, [ivc(0, 10), ivc(20, 30)]));
    expect(r).toEqual(Void);
  });
  test("refined-by-empty-enum ⇒ $void", () => {
    const r = normT(Refined(Int, buildSetExpr.enum([])));
    expect(r).toEqual(Void);
  });
});

describe("Step 1b — envelope lift: refined-by-⊤ ⇒ base", () => {
  test("topT(Int) ⇒ Int (the base, indirection erased)", () => {
    const r = normT(topT(Int));
    expect(r).toEqual({ $ref: "Int" });
  });
});

describe("Step 1b — inner-set canonicalization is delegated (stays $refined)", () => {
  test("redundant union {1,2}∪{1,2} ⇒ $refined{Int, SeEnum{1,2}}", () => {
    const r = normT(unionT(Int, [en([1, 2]), en([1, 2])])) as {
      $refined?: { base: unknown; set: { $tag: string; values?: unknown[] } };
    };
    expect(tagOf(r)).toBe("$refined");
    expect(r.$refined!.set.$tag).toBe("SeEnum");
    expect(r.$refined!.set.values).toEqual([1, 2]);
  });
  test("overlapping intersect {1,2,3}∩{3,4} ⇒ $refined{Int, SeEnum{3}}", () => {
    const r = normT(intersectT(Int, [en([1, 2, 3]), en([3, 4])])) as {
      $refined?: { set: { $tag: string; values?: unknown[] } };
    };
    expect(tagOf(r)).toBe("$refined");
    expect(r.$refined!.set.values).toEqual([3]);
  });
  test("surviving compound: non-adjacent interval union stays $refined{SeUnion}", () => {
    const r = normT(unionT(Int, [ivc(0, 10), ivc(20, 30)])) as {
      $refined?: { set: { $tag: string } };
    };
    expect(tagOf(r)).toBe("$refined");
    expect(r.$refined!.set.$tag).toBe("SeUnion"); // no lift — correctly stays
  });
  test("surviving compound: interval complement stays $refined{SeComplement}", () => {
    const r = normT(complementT(Int, ivc(0, 10))) as {
      $refined?: { set: { $tag: string } };
    };
    expect(tagOf(r)).toBe("$refined");
    expect(r.$refined!.set.$tag).toBe("SeComplement");
  });
});

describe("Step 1b — DENOTATION-PRESERVATION (the soundness gate, via the trio)", () => {
  test("every former normalizes to a type-equal form", () => {
    assertDenotationPreserved(intersectT(Int, [en([1, 2]), en([3, 4])])); // ⊥
    assertDenotationPreserved(diffT(Int, en([1, 2]), en([1, 2, 3]))); // ⊥
    assertDenotationPreserved(topT(Int)); // ⇒ base
    assertDenotationPreserved(unionT(Int, [en([1, 2]), en([1, 2])])); // redundant
    assertDenotationPreserved(intersectT(Int, [en([1, 2, 3]), en([3, 4])])); // {3}
    assertDenotationPreserved(unionT(Int, [ivc(0, 10), ivc(20, 30)])); // survives
  });
});

describe("Step 1b — idempotence (normal-form fixpoint)", () => {
  const cases = [
    intersectT(Int, [en([1, 2]), en([3, 4])]),
    topT(Int),
    bottomT,
    unionT(Int, [en([1, 2]), en([1, 2])]),
    intersectT(Int, [en([1, 2, 3]), en([3, 4])]),
    unionT(Int, [ivc(0, 10), ivc(20, 30)]),
  ];
  test("normalizeType ∘ normalizeType = normalizeType", () => {
    for (const c of cases) {
      const once = normT(c);
      expect(normT(once)).toEqual(once);
    }
  });
});

describe("Step 1b — pass-through (MINIMAL: non-refined types unchanged)", () => {
  test("a bare base type ($ref) passes through", () => {
    expect(normT({ $ref: "Int" })).toEqual({ $ref: "Int" });
  });
  test("$void is a fixpoint", () => {
    expect(normT(Void)).toEqual(Void);
  });
  test("a $record passes through unchanged (no deep recursion)", () => {
    const rec = { $record: { fields: [{ name: "x", type: { $ref: "Int" } }] } };
    expect(normT(rec)).toEqual(rec);
  });
});
