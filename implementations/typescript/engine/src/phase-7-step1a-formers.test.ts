// ---------------------------------------------------------------------------
// set-algebra-to-fenel Phase 7 Step 1a — the tier-1 refinement-former smart
// constructors (type-foundation.ts: unionT / intersectT / complementT / diffT
// / topT / bottomT). These pin the §2c "decided for free" contract: each former,
// built via its smart constructor as a `$refined{base, set:Se*}`, is decided by
// the Phase-6 containment trio (subset / disjoint / empty) via the SetExpr
// predicate arm — with ZERO new decider arm (the refined leaf routes to the
// already-Fenel predicate arm).
//
// SOUNDNESS CONTRACT (the gate): `empty` over a refined base is Just-true-or-
// Nothing — it forwards only decideEmpty's positive empty-proof (emptyRefined /
// emTrueOnly), never a Just-false inhabited-claim. So `empty(overlapping ∩)` is
// Nothing BY DESIGN (a decider-level completeness boundary that folds into the
// tier-2 component-wise decider, P7-6 — NOT a regression). See the Step-0 probe
// note `notes/phase-7-step1a-step0-probe.md`.
// ---------------------------------------------------------------------------

import { test, expect, describe } from "bun:test";
import { setDefaultTimeout } from "bun:test";

// type-substrate P1(a.5) — budget raise, no assertion weakened. This suite drives
// the INTERPRETED Fenel deciders, and P1(a.5) threaded an extra `rp` parameter
// through the disjoint walk (the `$opaque`-peel flag). That is a real cost: rows
// here measured over 5 s against bun's 5 s default afterwards while their
// VERDICTS are unchanged. A red that is really a clock is how a genuine red went
// unnoticed at P1(a). Raise the budget; never weaken an assertion to fit it.
setDefaultTimeout(300_000);
import {
  dispatchedSubset,
  dispatchedDisjointType,
  dispatchedEmpty,
} from "./engine-bodies-dispatch";
import {
  Refined,
  Void,
  Just,
  Nothing,
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
const NO: Tri = { $tag: "Nothing" };

const Int = { $ref: "Int" } as never;
const refinedEnum = (vs: unknown[]) => Refined(Int, buildSetExpr.enum(vs));
const bound = (value: number, inclusive: boolean) => ({ value, inclusive });
const ivc = (lo: number, hi: number) =>
  buildSetExpr.interval({ lo: Just(bound(lo, true)), hi: Just(bound(hi, true)) });
const geq = (lo: number) =>
  buildSetExpr.interval({ lo: Just(bound(lo, true)), hi: Nothing });
const refinedIv = (lo: number, hi: number) => Refined(Int, ivc(lo, hi));
const en = (vs: unknown[]) => buildSetExpr.enum(vs);

const sub = (a: unknown, b: unknown) => dispatchedSubset(a, b) as Tri;
const dis = (a: unknown, b: unknown) => dispatchedDisjointType(a, b) as Tri;
const emp = (t: unknown) => dispatchedEmpty(t) as Tri;

describe("Phase 7 Step 1a — unionT decided by subset", () => {
  test("enum: {1,2} ⊆ unionT({1,2},{3,4}) ⊆ {1,2,3,4}", () => {
    const U = unionT(Int, [en([1, 2]), en([3, 4])]);
    expect(sub(refinedEnum([1, 2]), U)).toEqual(JT);
    expect(sub(U, refinedEnum([1, 2, 3, 4]))).toEqual(JT);
  });
  test("interval: [0,5] ⊆ unionT([0,10],[20,30]) ⊆ [0,30]", () => {
    const U = unionT(Int, [ivc(0, 10), ivc(20, 30)]);
    expect(sub(refinedIv(0, 5), U)).toEqual(JT);
    expect(sub(U, refinedIv(0, 30))).toEqual(JT);
  });
});

describe("Phase 7 Step 1a — intersectT decided by empty (sound contract)", () => {
  test("enum: empty(intersectT disjoint) = Just true", () => {
    expect(emp(intersectT(Int, [en([1, 2]), en([3, 4])]))).toEqual(JT);
  });
  test("enum: empty(intersectT overlapping) = Nothing (sound; the P7-6 tier-2 fold)", () => {
    expect(emp(intersectT(Int, [en([1, 2, 3]), en([3, 4])]))).toEqual(NO);
  });
  test("interval: empty(intersectT [0,5],[10,15] disjoint) = Just true; overlapping = Nothing", () => {
    expect(emp(intersectT(Int, [ivc(0, 5), ivc(10, 15)]))).toEqual(JT);
    expect(emp(intersectT(Int, [ivc(0, 10), ivc(5, 15)]))).toEqual(NO);
  });
});

describe("Phase 7 Step 1a — complementT decided by disjoint", () => {
  test("enum: disjoint({1,2}, complementT ¬{1,2}) = Just true", () => {
    expect(dis(refinedEnum([1, 2]), complementT(Int, en([1, 2])))).toEqual(JT);
  });
  test("interval: disjoint([0,∞), complementT ¬[0,∞)) = Just true", () => {
    expect(dis(Refined(Int, geq(0)), complementT(Int, geq(0)))).toEqual(JT);
  });
});

describe("Phase 7 Step 1a — diffT decided by empty", () => {
  test("enum: empty(diffT {1,2} ∖ {1,2,3}) = Just true (since {1,2} ⊆ {1,2,3})", () => {
    expect(emp(diffT(Int, en([1, 2]), en([1, 2, 3])))).toEqual(JT);
  });
  test("interval: empty(diffT [0,5] ∖ [0,10]) = Just true (since [0,5] ⊆ [0,10])", () => {
    expect(emp(diffT(Int, ivc(0, 5), ivc(0, 10)))).toEqual(JT);
  });
});

describe("Phase 7 Step 1a — topT (⊤) is the universal supertype over its base", () => {
  test("enum: subset(refined {1..5}, topT) = Just true", () => {
    expect(sub(refinedEnum([1, 2, 3, 4, 5]), topT(Int))).toEqual(JT);
  });
  test("interval: subset(refined [0,100], topT) = Just true", () => {
    expect(sub(refinedIv(0, 100), topT(Int))).toEqual(JT);
  });
});

describe("Phase 7 Step 1a — bottomT (⊥) is uninhabited; voidAsNone iso (ISO-3)", () => {
  test("empty(bottomT) = Just true; bottomT ≡ Void", () => {
    expect(emp(bottomT)).toEqual(JT);
    expect(bottomT).toEqual(Void);
  });
  test("empty(refined SeNone) = Just true (the $void ≅ $none iso, both sides agree)", () => {
    expect(emp(Refined(Int, buildSetExpr.none()))).toEqual(JT);
  });
});

describe("Phase 7 Step 1a — construct→decide round-trip idempotence", () => {
  test("subset(U, U) = Just true (reflexivity of a unionT former)", () => {
    const U = unionT(Int, [en([1, 2]), en([3, 4])]);
    expect(sub(U, U)).toEqual(JT);
  });
  test("a topT is a subtype of itself and a bottomT is empty", () => {
    expect(sub(topT(Int), topT(Int))).toEqual(JT);
    expect(emp(intersectT(Int, [en([1]), en([2])]))).toEqual(JT); // {1}∩{2}=∅
  });
});
