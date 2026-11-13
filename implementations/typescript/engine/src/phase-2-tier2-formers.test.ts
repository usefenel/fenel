// ---------------------------------------------------------------------------
// containment-substrate Phase 2 Step 1b — the tier-2 cross-base FenelType formers.
//
// `$union` / `$intersect` / `$complement` are promoted to REAL FenelType
// constructors (types.ts) composing across DIFFERENT base types, built by the
// `unionTypes` / `intersectTypes` / `complementType` smart-ctors
// (type-foundation.ts). The containment trio (`subset` / `disjoint` / `empty`,
// containment.fenel) decides them structurally via the marshalled
// TtUnion/TtIntersect/TtComplement (marshalTraversalType) + the `tsKind` dispatch,
// REUSING the open DecidableMembership deciders (set:decideSubset/decideDisjoint).
//
// Every arm is SOUND: a positive verdict is only emitted when genuinely provable;
// otherwise `Nothing` (never a fabricated `Just`). These tests pin that soundness
// over the synthetic cross-base corpus (1a probe P4: no genuine untagged client)
// and the ISO-1/ISO-3 verification-plan (mutual-containment denotational equality).
// ---------------------------------------------------------------------------

import { test, expect, describe } from "bun:test";
import { setDefaultTimeout } from "bun:test";

// type-substrate P1(a.5) — budget raise, no assertion weakened. This suite drives
// the INTERPRETED Fenel deciders, and P1(a.5) added an `empty have` gate to the
// cross-kind subset terminal (the ∅-is-a-subset-of-everything premise the old
// blanket refutation left unstated). That is a real cost: the complement pairing slice
// measured under 5 s before the repair and ~10.8 s after, so bun's 5 s default
// turned a PASSING assertion into a red. The verdicts are identical either side —
// verified by running this file against the pre-repair tree. Raise the budget;
// never weaken an assertion to fit it.
setDefaultTimeout(300_000);
import {
  dispatchEngineBodyWithDeciderCtx,
  dispatchedSubset,
  dispatchedEmpty,
  dispatchedDisjointType,
  universeTypeSubsumes,
} from "./engine-bodies-dispatch";
import { unionTypes, intersectTypes, complementType } from "./type-foundation";
import type { FenelType, SetExpr } from "./types";

type Tri = { $tag: "Just"; _0: boolean } | { $tag: "Nothing" };
const JT: Tri = { $tag: "Just", _0: true };
const JF: Tri = { $tag: "Just", _0: false };
const NO: Tri = { $tag: "Nothing" };

const Num: FenelType = { $ref: "Number" };
const Str: FenelType = { $ref: "String" };
const Bool: FenelType = { $ref: "Boolean" };
const VOID: FenelType = { $void: true };
const UNIT_REC: FenelType = { $record: { fields: [] } };
const refined = (set: SetExpr): FenelType => ({ $refined: { base: Num, set } });
const sub = (a: unknown, b: unknown) => dispatchedSubset(a, b) as Tri;
const emp = (t: unknown) => dispatchedEmpty(t) as Tri;
const dis = (a: unknown, b: unknown) => dispatchedDisjointType(a, b) as Tri;

describe("Phase 2 Step 1b — tier-2 union subset", () => {
  test("RHS union: a branch ⊆ ⇒ Just true (Num ⊆ Num∪Str, Str ⊆ Num∪Str)", () => {
    expect(sub(Num, unionTypes([Num, Str]))).toEqual(JT);
    expect(sub(Str, unionTypes([Num, Str]))).toEqual(JT);
  });
  test("RHS union: no branch matches ⇒ Nothing (SOUND, not Just false)", () => {
    expect(sub(Bool, unionTypes([Num, Str]))).toEqual(NO);
  });
  test("LHS union: every branch ⊆ want ⇒ Just true ((Num∪Str) ⊆ (Num∪Str))", () => {
    expect(sub(unionTypes([Num, Str]), unionTypes([Num, Str]))).toEqual(JT);
  });
  test("LHS union: a branch abstains ⇒ Nothing ((Num∪Str) ⊆ Num — Str-vs-Num leaf abstains)", () => {
    // decide-substrate (Tt* named-leaf honesty): the Str ⊆ Num branch is the
    // named leaf String ⊆ Number, which the hierarchy doesn't relate ⇒ Nothing
    // (the closed-world abstention, not a fabricated Just false). The union fold
    // (mEvery) carries that Nothing ⇒ the whole union verdict is Nothing. Sound —
    // the fast branch abstains rather than commit; disjointness refutation is the
    // Park/SetExpr path's job (which is likewise Nothing on this leaf).
    expect(sub(unionTypes([Num, Str]), Num)).toEqual(NO);
  });
});

describe("Phase 2 Step 1b — tier-2 intersect subset/empty", () => {
  test("RHS intersect: ⊆ every branch ⇒ Just true ({1,2} ⊆ {1,2,3} ∩ {1,2,4})", () => {
    expect(
      sub(
        refined({ $tag: "SeEnum", values: [1, 2] }),
        intersectTypes([refined({ $tag: "SeEnum", values: [1, 2, 3] }), refined({ $tag: "SeEnum", values: [1, 2, 4] })]),
      ),
    ).toEqual(JT);
  });
  test("empty(intersect) = disjoint branches: {1,2} ∩ {3,4} ⇒ Just true", () => {
    expect(
      emp(intersectTypes([refined({ $tag: "SeEnum", values: [1, 2] }), refined({ $tag: "SeEnum", values: [3, 4] })])),
    ).toEqual(JT);
  });
  test("empty(intersect) overlapping ⇒ Nothing (conservative, not Just false)", () => {
    expect(
      emp(intersectTypes([refined({ $tag: "SeEnum", values: [1, 2] }), refined({ $tag: "SeEnum", values: [2, 3] })])),
    ).toEqual(NO);
  });
  test("empty(intersect) any-branch-empty ⇒ Just true", () => {
    expect(emp(intersectTypes([VOID, Str]))).toEqual(JT);
  });
});

describe("Phase 2 Step 1b — tier-2 complement subset (have ⊆ ¬w ⟺ disjoint have w)", () => {
  test("disjoint inner ⇒ Just true ({1,2} ⊆ ¬{3,4})", () => {
    expect(sub(refined({ $tag: "SeEnum", values: [1, 2] }), complementType(refined({ $tag: "SeEnum", values: [3, 4] })))).toEqual(JT);
  });
  test("overlapping refinement predicates alone do not fabricate a type-level overlap witness", () => {
    // A refined type is base∩set. decideDisjoint(setA,setB)=Just false does not
    // prove baseA∩setA∩baseB∩setB inhabited (the common set value may lie
    // outside either base). The retired DisjointOperand path forwarded that
    // false polarity unsoundly; the unified TraversalType member now abstains.
    expect(sub(refined({ $tag: "SeEnum", values: [1, 2] }), complementType(refined({ $tag: "SeEnum", values: [2, 3] })))).toEqual(NO);
  });
});

describe("floor-kernel Phase 3c — complement face-pairs over TraversalType", () => {
  const A = refined({ $tag: "SeEnum", values: [1] });
  const AB = refined({ $tag: "SeEnum", values: [1, 2] });
  const comp = (t: FenelType) => complementType(t);

  test("disjoint complement theorem keeps the positive and abstains on refined negatives in both orders", () => {
    // ¬AB ⊥ A iff A⊆AB. The converse predicate refutation no longer
    // proves a type-level overlap: the common predicate value may miss the base.
    expect(dis(comp(AB), A)).toEqual(JT);
    expect(dis(A, comp(AB))).toEqual(JT);
    expect(dis(comp(A), AB)).toEqual(NO);
    expect(dis(AB, comp(A))).toEqual(NO);
  });

  test("LHS complement subset keeps its positive and picker posture while the refined negative abstains", () => {
    expect(sub(comp(AB), comp(A))).toEqual(JT); // ¬AB ⊆ ¬A
    expect(sub(comp(A), comp(AB))).toEqual(NO); // predicate-only refutation is not a carrier witness
    expect(sub(comp(comp(A)), A)).toEqual(JT); // double complement
    expect(sub(comp(comp(comp(A))), comp(A))).toEqual(JT); // smallest nested cycle shape
    expect(universeTypeSubsumes(comp(A), comp(AB))).toBe(true); // frozen picker posture
  });

  test("complement emptiness mirrors top-cover and keeps unknown aliases fenced", () => {
    expect(emp(comp(unionTypes([A, comp(A)])))).toEqual(JT); // ¬(A∪¬A)=∅
    expect(emp(comp(A))).toEqual(JF); // A is proper, so ¬A is inhabited
    expect(emp(comp({ $var: "a" } as FenelType))).toEqual(NO);
  });

  test("Tt*/Se* complement positives agree while the refined-negative Tt face abstains", () => {
    const En = (...values: unknown[]) => ({ $tag: "SeEnum", values });
    const C = (inner: unknown) => ({ $tag: "SeComplement", inner });
    const seDis = (a: unknown, b: unknown) =>
      dispatchEngineBodyWithDeciderCtx("engine:setAlgebraIsDisjoint", [a, b]) as Tri;
    expect(dis(comp(AB), A)).toEqual(seDis(C(En(1, 2)), En(1)));
    expect(seDis(C(En(1)), En(1, 2))).toEqual(JF);
    expect(dis(comp(A), AB)).toEqual(NO);
  });

  test("soundness repairs: refinement-vs-base and a type variable are not shape-disjoint", () => {
    expect(dis(A, Num)).toEqual(NO);
    expect(dis(Num, A)).toEqual(NO);
    expect(dis({ $var: "a" }, Num)).toEqual(NO);
  });
});

describe("Phase 2 Step 1b — tier-2 union empty (∪ empty iff ALL branches empty)", () => {
  test("two Void branches ⇒ Just true", () => {
    expect(emp(unionTypes([VOID, VOID]))).toEqual(JT);
  });
  test("a provably-inhabited branch ⇒ Just false (unit record inhabits)", () => {
    expect(emp(unionTypes([UNIT_REC, Str]))).toEqual(JF);
  });
  test("named-branch union with inhabited atoms ⇒ Just false: union[Num,Str]", () => {
    // The named atom floor can now prove the branches are inhabited, so the
    // union's emptiness is definitively refuted.
    expect(emp(unionTypes([Num, Str]))).toEqual(JF);
  });
});

describe("Phase 2 Step 1b — disjoint union-lift (the folded Phase-6 disjoint-lift)", () => {
  test("disjoint (Num∪Str) Boolean: every branch disjoint ⇒ Just true", () => {
    expect(dis(unionTypes([Num, Str]), Bool)).toEqual(JT);
  });
  test("SOUND: disjoint (Num∪Str) Num is NOT Just true (Num overlaps the union)", () => {
    // The structural 'different shape ⇒ disjoint' rule is UNSOUND for a union;
    // the component-wise lift must NOT claim disjointness here.
    expect(dis(unionTypes([Num, Str]), Num)).not.toEqual(JT);
  });
});

describe("Phase 2 Step 1b — the iso verification plan (denotational equality)", () => {
  test("ISO-1 refinedAsIntersect: refined{B,P} ≅ intersect(B, refined-by-P) — mutual ⊆", () => {
    const R = refined({ $tag: "SeEnum", values: [1, 2] });
    const RHS = intersectTypes([Num, R]);
    expect(sub(R, RHS)).toEqual(JT); // R ⊆ B ∩ refined-by-P
    expect(sub(RHS, R)).toEqual(JT); // B ∩ refined-by-P ⊆ R
  });
  test("ISO-3 voidAsNone: empty($void) = Just true (already holds)", () => {
    expect(emp({ $void: true })).toEqual(JT);
  });
});
