// decide-substrate Phase 8λ.1 — the `SeArrow` (exponential / function-signature)
// SET former: the emptiness arm (the exponential law), the variance containment
// arm (contravariant params / covariant return), the INTENSIONAL membership arm
// (named/`{$ref}`/partial fn values by signature subsumption — closures &
// effectful referents ⇒ Nothing), the const/vacuous witness, and the
// `$arrow`→`SeArrow` / `$void`→`SeNone` projection. Design:
// `design/arrow-synthesis.md`. Brief: `briefs/phase-8lambda-1-searrow.md`.
//
// Membership rides the `fnTypeMarker` ctx-native (a registry signature read),
// so the tests register fn signatures via the fixture map (the harness registry
// is fixed + cached — the `fnBody` precedent). The emptiness / variance /
// witness arms are pure and need no fixture.

import { test, expect, describe, afterEach } from "bun:test";
import { setDefaultTimeout } from "bun:test";

// type-substrate P1(a.5) — budget raise, no assertion weakened. This suite drives
// the INTERPRETED Fenel deciders and had rows measuring 7.6 s against bun's 5 s
// default BEFORE this phase and after it (verified identical on the pre-repair
// tree), so it was reporting CLOCK as failure. A gate nobody can read is how a
// genuine red went unnoticed at P1(a). Raise the budget; never weaken an
// assertion to fit it.
setDefaultTimeout(300_000);
import { contains, isSubset, isDisjoint, decideEmpty, witnessOf } from "./set-algebra";
import { typeToSetExpr } from "./fenel-check";
import { dispatchedSubset } from "./engine-bodies-dispatch";
import {
  __registerFnTypeMarkerFixtureForTests,
  __clearFnTypeMarkerFixturesForTests,
} from "./engine-bodies-dispatch";
import type { FenelType, FieldKey, SetExpr } from "./types";

const paramKey = (i: number): FieldKey => ({
  $tag: "NamedField",
  ref: { $ref: `10000000-0000-4000-8000-${String(i + 1).padStart(12, "0")}` },
});
const param = (i: number, name: string, type: FenelType) => ({ key: paramKey(i), name, type });

// MaybeBool → "true" | "false" | "nothing".
function mb(m: unknown): "true" | "false" | "nothing" {
  const x = m as { $tag?: string; _0?: unknown; value?: unknown };
  if (x?.$tag === "Just") return (x._0 ?? x.value) ? "true" : "false";
  return "nothing";
}

// FenelType arrow builder — `(t1, t2, …) → r`. Params get names p0,p1,….
const arrT = (params: FenelType[], ret: FenelType): FenelType =>
  ({ $arrow: { params: params.map((t, i) => param(i, `p${i}`, t)), returns: ret } } as unknown as FenelType);
const INT: FenelType = { $ref: "Int" } as unknown as FenelType;
const NUM: FenelType = { $ref: "Number" } as unknown as FenelType;
const VOID: FenelType = { $void: true } as unknown as FenelType;

// The projected SeArrow (via the 8λ.1 `$arrow`→SeArrow marshal).
const arrS = (params: FenelType[], ret: FenelType): SetExpr => typeToSetExpr(arrT(params, ret)) as SetExpr;

// Direct SeArrow / leaf builders over EMPTINESS-DECIDABLE sets (SeEnum / SeNone /
// SeAll) — the named-ref sets (ℤ/ℝ) are inhabitance-UNDECIDABLE in the SetExpr
// judgment (`SeRef → Nothing`; the Tt* branch is the precise one), so the
// exponential-emptiness LAW is demonstrated over decidable leaves.
const arrowSet = (paramSets: SetExpr[], ret: SetExpr): SetExpr =>
  ({
    $tag: "SeArrow",
    params: paramSets.map((s, i) => ({ $tag: "SetArrowParam", key: paramKey(i), wireName: `p${i}`, set: s })),
    returns: ret,
  } as unknown as SetExpr);
const enumS = (...vs: unknown[]): SetExpr => ({ $tag: "SeEnum", values: vs } as unknown as SetExpr);
const NONE: SetExpr = { $tag: "SeNone" } as unknown as SetExpr;

afterEach(() => __clearFnTypeMarkerFixturesForTests());

// ── projection ──────────────────────────────────────────────────────────────
describe("SeArrow — the $arrow / $void projection (was SeAll pre-8λ.1)", () => {
  test("$arrow projects to SeArrow (not the SeAll collapse)", () => {
    const proj = arrS([INT], NUM) as { $tag?: string; params?: unknown[]; returns?: unknown };
    expect(proj.$tag).toBe("SeArrow");
    expect(proj.params?.length).toBe(1);
  });
  test("$void projects to SeNone (the empty domain — vacuous-witness floor)", () => {
    const proj = typeToSetExpr(VOID) as { $tag?: string };
    expect(proj.$tag).toBe("SeNone");
  });
});

// ── emptiness (the exponential law) ─────────────────────────────────────────
describe("SeArrow — emptiness (empty iff return empty ∧ every param inhabited)", () => {
  test("({1})→∅ is EMPTY (no total fn to an empty codomain from a nonempty domain)", () => {
    expect(mb(decideEmpty(arrowSet([enumS(1)], NONE)))).toBe("true");
  });
  test("(∅)→{1} is NON-empty (the vacuous function inhabits)", () => {
    expect(mb(decideEmpty(arrowSet([NONE], enumS(1))))).toBe("false");
  });
  test("({1})→{1} is NON-empty (constant functions inhabit)", () => {
    expect(mb(decideEmpty(arrowSet([enumS(1)], enumS(1))))).toBe("false");
  });
  test("()→∅ (a thunk to the empty set) is EMPTY (empty iff return empty)", () => {
    expect(mb(decideEmpty(arrowSet([], NONE)))).toBe("true");
  });
  test("(Int)→Int is decidably NON-empty (8λ.1-r: atom-tower inhabitance — ℤ inhabited by construction)", () => {
    expect(mb(decideEmpty(arrS([INT], INT)))).toBe("false");
  });
  test("(Int)→Void is EMPTY through the projection (8λ.1-r: return SeNone + ℤ param inhabited)", () => {
    expect(mb(decideEmpty(arrS([INT], VOID)))).toBe("true");
  });
});

// ── the ∅-arrow subset corner (the 8λ.1-r soundness find) ───────────────────
describe("SeArrow — the emptiness-gated subset (∅-arrow ⊆ anything; the SeCtor emptyA precedent)", () => {
  test("a decidably-EMPTY arrow ⊆ a wider-arity arrow = Just true (was a FALSE REFUTATION pre-8λ.1-r)", () => {
    // ({1})→∅ is empty (exponential law) ⇒ ∅ ⊆ B regardless of arity/variance.
    expect(mb(isSubset(arrowSet([enumS(1)], NONE), arrowSet([enumS(1), enumS(2)], NONE)))).toBe("true");
  });
  test("(Int)→Void ⊆ (Int,Int)→Void = Just true through the projection", () => {
    expect(mb(isSubset(arrS([INT], VOID), arrS([INT, INT], VOID)))).toBe("true");
  });
  test("the arity refutation still fires when the LHS is decidably NONEMPTY", () => {
    expect(mb(isSubset(arrowSet([enumS(1), enumS(2)], enumS(5)), arrowSet([enumS(1)], enumS(5))))).toBe("false");
  });
});

// ── inhabitation (const / vacuous witnesses) ────────────────────────────────
describe("SeArrow — witness (const `\\_ -> w` / vacuous over an empty domain)", () => {
  test("({1})→{1} witnesses a const closure `\\_ -> w`", () => {
    const w = witnessOf(arrowSet([enumS(1)], enumS(1))) as { $tag?: string; _0?: { __fenelFn?: boolean; params?: string[] } };
    expect(w.$tag).toBe("Just");
    expect(w._0?.__fenelFn).toBe(true);
    expect(w._0?.params?.length).toBe(1);
  });
  test("(∅)→{1} witnesses a vacuous closure (some param empty)", () => {
    const w = witnessOf(arrowSet([NONE], enumS(1))) as { $tag?: string; _0?: { __fenelFn?: boolean } };
    expect(w.$tag).toBe("Just");
    expect(w._0?.__fenelFn).toBe(true);
  });
  test("8λ.2 — the witness closure's own re-certification now DECIDES (the 8λ.1 GAP closed)", () => {
    const w = witnessOf(arrowSet([enumS(1)], enumS(1))) as { _0?: unknown };
    // {closure} ⊆ SeArrow ⇒ Just true (the closure-membership CHECK face — 8λ.2:
    // the const witness `\_ -> 1` type-checks against ({1})→{1}, closing the GAP).
    expect(mb(contains(arrowSet([enumS(1)], enumS(1)), w._0, null))).toBe("true");
  });
});

// ── containment (variance) ──────────────────────────────────────────────────
describe("SeArrow — variance containment (contravariant params, covariant return)", () => {
  test("(Number)→Int ⊆ (Int)→Number — the Step-0 probe pair (Just true)", () => {
    expect(mb(isSubset(arrS([NUM], INT), arrS([INT], NUM)))).toBe("true");
  });
  test("(Int)→Number ⊆ (Number)→Int — the reverse is an honest Nothing", () => {
    expect(mb(isSubset(arrS([INT], NUM), arrS([NUM], INT)))).toBe("nothing");
  });
  test("(Int)→Int ⊆ (Int)→Int — reflexive (Just true)", () => {
    expect(mb(isSubset(arrS([INT], INT), arrS([INT], INT)))).toBe("true");
  });
  test("arity mismatch ⇒ Just false", () => {
    expect(mb(isSubset(arrS([INT, INT], NUM), arrS([INT], NUM)))).toBe("false");
  });
  test("agrees with the Tt* `arrowSub` fast branch where both decide — now vacuous, and asserted so", () => {
    // The 8μ.2 reconciliation: the SetExpr judgment must AGREE with the shipped
    // Tt* structural face on containment where both decide.
    //
    // type-substrate P1(a.7) made the Tt* arrow arm abstain in BOTH polarities,
    // so `tt` is "nothing" for EVERY pair here and the agreement check below can
    // no longer fire. A silently vacuous cross-face gate is exactly the failure
    // mode this suite exists to prevent, so the vacuity is now ASSERTED rather
    // than skipped: the Se* column keeps its four verdicts, the Tt* column is
    // uniformly "nothing", and a future arrow-recovery slice will have to delete
    // this assertion deliberately to restore the gate.
    const pairs: [FenelType[], FenelType, FenelType[], FenelType][] = [
      [[NUM], INT, [INT], NUM], // ⊆ (Just true)
      [[INT], INT, [INT], INT], // reflexive
      [[INT, INT], NUM, [INT], NUM], // arity mismatch (the callable-tail refutation — 8λ.2-r)
      [[INT], INT, [VOID], NUM], // want-side vacuous domain (8λ.2-r — both branches Just true)
    ];
    const seVerdicts: string[] = [];
    const ttVerdicts: string[] = [];
    for (const [ap, ar, bp, br] of pairs) {
      const judgment = mb(isSubset(arrS(ap, ar), arrS(bp, br)));
      const tt = mb(dispatchedSubset(arrT(ap, ar), arrT(bp, br)));
      seVerdicts.push(judgment);
      ttVerdicts.push(tt);
      if (judgment !== "nothing" && tt !== "nothing") expect(judgment).toBe(tt);
    }
    expect(seVerdicts).toEqual(["true", "true", "false", "true"]);
    expect(ttVerdicts).toEqual(["nothing", "nothing", "nothing", "nothing"]);
  });

  // ── 8λ.2-r — vacuous domains + the currying iso (see the roadmap note) ─────
  test("8λ.2-r want-side vacuous: (Int)→Int ⊆ (∅)→{1} ⇒ Just true (an empty-domain arrow contains ALL callables)", () => {
    expect(mb(isSubset(arrS([INT], INT), arrowSet([NONE], enumS(1))))).toBe("true");
  });
  test("8λ.2-r currying iso: (A,B)→C ⊆ (A)→((B)→C) and back ⇒ Just true BOTH ways (flatten-align; was a false refutation on written arity)", () => {
    expect(mb(isSubset(arrS([INT, INT], NUM), arrS([INT], arrT([INT], NUM))))).toBe("true");
    expect(mb(isSubset(arrS([INT], arrT([INT], NUM)), arrS([INT, INT], NUM)))).toBe("true");
  });
});

// ── disjointness ────────────────────────────────────────────────────────────
describe("SeArrow vs SeCtor — the RETRACTED value-sort axiom", () => {
  const ctor = (c: string, fields: unknown[]): SetExpr =>
    ({ $tag: "SeCtor", ctor: c, fields } as unknown as SetExpr);
  // STALE-ORACLE REPAIR (type-substrate P1(a.5), 2026-08-16). This block used to
  // be titled "disjointness vs SeCtor (callables carry no $tag)" and asserted
  // `Just true` in both directions. **type-substrate P1(a) RETRACTED that axiom
  // as FALSE** (`dis.arrow.ctor`, AXIOM → THEOREM): "a callable carries no
  // `$tag`" is a PRODUCER claim, and the membership faces admit values that are
  // both — `mem.ctor` accepts ANY `$tag`-matching record and `mem.arrow`
  // classifies by callable-key PRESENCE, so `{$tag:"P", $ref:f}` inhabits both
  // and the old `Just true` let the kernel grade `JEmpty` AND `JInhabited`
  // SolverChecked on the SAME intersection.
  //
  // P1(a) landed the decider change but did NOT re-pin this oracle, so the row
  // has been RED ever since — a test asserting a retracted axiom, which is the
  // executable twin of a stale claim column. Found by P1(a.5)'s blast-radius
  // sweep (the brief's suite list did not include this file) and repaired here
  // rather than inherited silently. Only `∅ ⊥ X` survives; everything else
  // abstains, and soundness is delegated wholly to the `emp` rows.
  test("SeArrow ∩ SeCtor ABSTAINS (Nothing), both directions — the axiom is retracted", () => {
    expect(mb(isDisjoint(arrS([INT], INT), ctor("Just", [])))).toBe("nothing");
    expect(mb(isDisjoint(ctor("Just", []), arrS([INT], INT)))).toBe("nothing");
  });
});

// ── membership (intensional — by signature) ─────────────────────────────────
describe("SeArrow — intensional membership per value shape", () => {
  test("a `{$ref}` named fn ⊆ SeArrow by signature subsumption (Just true)", () => {
    __registerFnTypeMarkerFixtureForTests("myInc", { params: [param(0, "x", INT)], returns: INT });
    // sig (Int)→Int ⊆ goal (Int)→Number (contravariant param Int⊆Int, covariant return Int⊆Number).
    expect(mb(contains(arrS([INT], NUM), { $ref: "myInc" }, null))).toBe("true");
  });
  test("a `{$ref}` fn is refuted against an incompatible goal (arity)", () => {
    __registerFnTypeMarkerFixtureForTests("myInc", { params: [param(0, "x", INT)], returns: INT });
    expect(mb(contains(arrS([INT, INT], INT), { $ref: "myInc" }, null))).toBe("false");
  });
  test("a `{__fenelPartial}` ⊆ SeArrow by its residual signature (Just true)", () => {
    __registerFnTypeMarkerFixtureForTests("add2", {
      params: [param(0, "a", INT), param(1, "b", INT)],
      returns: INT,
    });
    // add2 : (Int,Int)→Int; collected 1 arg ⇒ residual (Int)→Int ⊆ (Int)→Int.
    const partial = { __fenelPartial: true, fn: "add2", collected: [1], arity: 2 };
    expect(mb(contains(arrS([INT], INT), partial, null))).toBe("true");
  });
  test("a `{__fenelFn}` closure TYPE-CHECKS against the arrow goal (the 8λ.2 CHECK face)", () => {
    const closure = { __fenelFn: true, params: ["x"], body: { var: "x" }, closure: {} };
    // \x -> x ∈ (Int)→Int — the identity body checks: EVar x is bound to the goal
    // param domain Int, decideSubset Int ⊆ Int (the goal codomain) ⇒ Just true.
    expect(mb(contains(arrS([INT], INT), closure, null))).toBe("true");
  });
  test("an EFFECTFUL referent ⇒ Nothing (the effect fence — never a false accept)", () => {
    __registerFnTypeMarkerFixtureForTests("effInc", {
      params: [param(0, "x", INT)],
      returns: INT,
      requires: [{ class: { $tag: "Id", entityId: "HasStateIO" }, args: [{ $var: "scope" }] }],
    });
    expect(mb(contains(arrS([INT], INT), { $ref: "effInc" }, null))).toBe("nothing");
  });
  test("an ADVISORY/UNTRUSTED referent ⇒ Nothing (its inferred scheme is not a membership fact)", () => {
    __registerFnTypeMarkerFixtureForTests("advisoryInc", {
      params: [param(0, "x", INT)],
      returns: INT,
      trusted: false,
    });
    expect(mb(contains(arrS([INT], INT), { $ref: "advisoryInc" }, null))).toBe("nothing");
  });
  test("8λ.2-r sig vacuous: myInc ∈ (∅)→∅ ⇒ Just true (∀x∈∅ — regardless of the signature)", () => {
    __registerFnTypeMarkerFixtureForTests("myInc", { params: [param(0, "x", INT)], returns: INT });
    expect(mb(contains(arrowSet([NONE], NONE), { $ref: "myInc" }, null))).toBe("true");
  });
  test("8λ.2-r sig currying bridge: a flat 2-ary registered fn ∈ the curried goal (Int)→((Int)→Int) ⇒ Just true (partial application)", () => {
    __registerFnTypeMarkerFixtureForTests("add2", {
      params: [param(0, "a", INT), param(1, "b", INT)],
      returns: INT,
    });
    expect(mb(contains(arrS([INT], arrT([INT], INT)), { $ref: "add2" }, null))).toBe("true");
  });
  test("a bare string ⇒ Nothing (not a callable value — typed-fn-refs Phase 5; legacy name-strings fence honestly)", () => {
    __registerFnTypeMarkerFixtureForTests("myInc", { params: [param(0, "x", INT)], returns: INT });
    expect(mb(contains(arrS([INT], INT), "myInc", null))).toBe("nothing");
  });
  test("an unresolved `{$ref}` ⇒ Nothing (fnTypeMarker returns Nothing)", () => {
    expect(mb(contains(arrS([INT], INT), { $ref: "noSuchFn" }, null))).toBe("nothing");
  });
  test("a SCALAR value ⇒ Just false (a number is never callable — 8λ.1-r, the SeCtor scalar precedent)", () => {
    expect(mb(contains(arrS([INT], INT), 5, null))).toBe("false");
    expect(mb(contains(arrS([INT], INT), [1, 2], null))).toBe("false");
  });
  test("a POLYMORPHIC referent (free type var ⇒ SeAll components) ⇒ Nothing (the 8λ.1-r exactness fence — no instantiation in v1; was a FALSE REFUTATION)", () => {
    __registerFnTypeMarkerFixtureForTests("polyId", {
      params: [param(0, "x", { $var: "a" } as unknown as FenelType)],
      returns: { $var: "a" } as unknown as FenelType,
    });
    expect(mb(contains(arrowSet([enumS(1)], enumS(1)), { $ref: "polyId" }, null))).toBe("nothing");
  });
  test("a DEPENDENT-param referent ($el ⇒ SeAll param) ⇒ Nothing (8λ.1-r — the ⊤ is a marshal artifact, not a declared domain; was a FALSE ACCEPT)", () => {
    __registerFnTypeMarkerFixtureForTests("depFn", {
      params: [param(0, "x", { $el: { var: "y" } } as unknown as FenelType)],
      returns: INT,
    });
    expect(
      mb(contains(arrowSet([enumS(1, 2)], { $tag: "SeRef", handle: "ℤ" } as unknown as SetExpr), { $ref: "depFn" }, null)),
    ).toBe("nothing");
  });
});

// ── the μ×λ positivity interaction (the soundness-critical arm) ──────────────
describe("SeArrow — μ×λ positivity (sePositive rejects negative occurrences)", () => {
  const mu = (v: string, body: SetExpr): SetExpr => ({ $tag: "SeMu", var: v, body } as unknown as SetExpr);
  const arrow = (paramSet: SetExpr, ret: SetExpr): SetExpr =>
    ({ $tag: "SeArrow", params: [{ $tag: "SetArrowParam", key: paramKey(0), wireName: "p", set: paramSet }], returns: ret } as unknown as SetExpr);
  const ref = (h: string): SetExpr => ({ $tag: "SeRef", handle: h } as unknown as SetExpr);
  const enumS = (...vs: unknown[]): SetExpr => ({ $tag: "SeEnum", values: vs } as unknown as SetExpr);

  test("μX. A→X (var in RETURN = positive) ⇒ the μ face DECIDES (empty — no finite such fn)", () => {
    // F(∅) = A→∅ = ∅ (A inhabited) ⇒ LFP = ∅. Positive ⇒ the face fires.
    expect(mb(decideEmpty(mu("X", arrow(enumS(1), ref("X")))))).toBe("true");
  });
  test("μX. X→A (var in PARAM = negative) ⇒ non-monotone ⇒ the μ face degrades to Nothing", () => {
    // sePositive false (X at negative parity under an arrow param) ⇒ seMuFaceOk
    // false ⇒ Nothing (Park would be UNSOUND on a non-monotone body — the arm
    // that makes the fall-through REJECT it instead of wrongly accepting).
    expect(mb(decideEmpty(mu("X", arrow(ref("X"), enumS(1)))))).toBe("nothing");
  });
});
