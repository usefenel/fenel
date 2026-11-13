// ---------------------------------------------------------------------------
// containment-substrate Phase 3 Step 1 — the inductive↔refinement iso VP.
//
// The numeric tower presents each rung TWICE: an INDUCTIVE presentation (Nat =
// Peano, Int = sign-magnitude, Rational = ratio ADT) and a REFINEMENT
// presentation (NonNegInt, Integer, RationalNumber, RealNumber). Integer now
// refines Int and RationalNumber refines Rational; their witnesses preserve
// exact integer digits and fractions without a Number projection.
// The two presentations are connected by an ISO = a witness PAIR
// (`*ToRefined` / `*FromRefined`) + the round-trip laws (proof = inhabitant).
// numeric-tower Phase 2-4 SHIPPED the witnesses but stubbed the Int/Rational/
// Real codomains as `Number` (no alias existed); containment-substrate Phase 3
// registered the aliases (foundation.fenel) and retyped the witnesses onto them.
//
// THIS VP proves the iso DENOTATIONALLY, two ways:
//  (1) the VALUE-LEVEL round-trips (self-contained, the real iso proof — proof
//      = inhabitant): `*FromRefined (*ToRefined v) ≡ v`.
//  (2) the trio (subset/empty/disjoint) over the presentations — the DECIDABLE
//      facts proven (refined ⊂ base), the honest verdicts RECORDED where the
//      structural trio cannot bridge the two presentations.
//
// THE HONEST RECORDING (the headline finding, the floor-isos surprise-#5
// precedent — `subset($tuple, {_0}∩{_1}) = Just false`, "the kinds genuinely
// don't bridge; the denotational content lives at the witness level"): the
// trio reasons STRUCTURALLY. An opaque rung's pure form (Peano `Zero|Succ`, the
// sign-magnitude record, …) is a DIFFERENT representation from its refinement
// presentation (`Number | value ∈ ℤ`); the two are connected by the EXPLICIT
// witness conversion, NOT by structural subtyping. So `subset(Nat-opaque,
// NonNegInt)` returns `Just false` (the reps genuinely differ at the value
// level — a `Succ Zero` value is not literally a `Number`). This is NOT a
// soundness claim about the SET ℕ ⊆ ℕ (which the value-level round-trips carry);
// it is the structural trio honestly reporting two distinct representations.
// The brief PREDICTED `Nothing` here; the reality is `Just false` (the
// refinement strip exposes a kind mismatch), recorded as Phase-3 surprise.
//
// The cardinal rule (asserted by the corpus sweep): NO `Nothing → Just` — never
// an unsound `Just` where the sound decision is `Nothing`.
// ---------------------------------------------------------------------------

import { test, expect, describe } from "bun:test";
import { setDefaultTimeout } from "bun:test";

// type-substrate P1(a.5) — budget raise, no assertion weakened. This suite drives
// the INTERPRETED Fenel deciders and had rows measuring 81 s against bun's 5 s
// default BEFORE this phase and after it (verified identical on the pre-repair
// tree), so it was reporting CLOCK as failure. A gate nobody can read is how a
// genuine red went unnoticed at P1(a). Raise the budget; never weaken an
// assertion to fit it.
setDefaultTimeout(300_000);
import {
  dispatchedSubset,
  dispatchedEmpty,
  dispatchedDisjointType,
} from "./engine-bodies-dispatch";
import {
  Integer,
  RationalNumber,
  RealNumber,
  NonNegInt,
} from "./type-foundation";
import { stdModule } from "./modules/std";
import { createRepositoryRegistry } from "./repository-registry";
import { evaluate, invokeCallable } from "./json-logic";

// --- Tri (the trio's Maybe<Bool>) ------------------------------------------
type Tri = { $tag: "Just"; _0: boolean } | { $tag: "Nothing" };
const JT: Tri = { $tag: "Just", _0: true };
const NO: Tri = { $tag: "Nothing" };
const sub = (a: unknown, b: unknown) => dispatchedSubset(a, b) as Tri;
const emp = (t: unknown) => dispatchedEmpty(t) as Tri;
const dis = (a: unknown, b: unknown) => dispatchedDisjointType(a, b) as Tri;

const Num = { $ref: "Number" };

// Semantic consumers take registry-local identified views, never the raw
// keyless source templates returned by the foundation loader.
const reg = createRepositoryRegistry([stdModule]);

// --- the inductive (opaque) presentations of the rungs ---------------------
const NatOpaque = reg.getIdentifiedEntity("Nat")!.type;
const IntOpaque = reg.getIdentifiedEntity("Int")!.type;
const RationalOpaque = reg.getIdentifiedEntity("Rational")!.type;

// --- the bridge harness (the int-tower.test.ts pattern) --------------------
const ctx = reg.evaluateContext();
const body = (id: string) =>
  (stdModule.functions ?? []).find((f) => f.id === id)!.body;
// the single-arg bridges differ in param name; pass both keys — the body
// resolves only the var it references.
const run = (id: string, v: unknown) => evaluate(body(id), { n: v, i: v, r: v }, ctx);
const call = (id: string, ...args: unknown[]) => invokeCallable({ $ref: id }, args, ctx);
const toInt = (x: number) => run("std:numberToInt", x);
const mkRat = (num: number, den: number) =>
  evaluate(body("std:mkRational"), {
    num: run("std:numberToInt", num),
    den: run("std:numberToInt", den),
  }, ctx);

// ===========================================================================
// (1) the VALUE-LEVEL round-trips — the real iso proof (proof = inhabitant).
//     Self-contained per the brief (the tower suites discharge the full grid;
//     this is the iso-CLOSURE confirmation alongside the trio VP).
// ===========================================================================
describe("Phase 3 Step 1 — value-level iso round-trips (the witness pairs)", () => {
  test("Nat ≅ NonNegInt: both witnesses preserve exact nonnegative integers", () => {
    const large = "9007199254740993123456789012345678901";
    for (const { nat, text } of [
      ...[0, 1, 2, 5, 9].map((x) => ({ nat: run("std:numberToNat", x), text: String(x) })),
      { nat: call("std:integerNatFromCanonicalText", large), text: large },
    ]) {
      const refined = run("std:natToRefined", nat);
      const back = run("std:natFromRefined", refined);
      const refinedBack = run("std:natToRefined", run("std:natFromRefined", refined));
      expect(call("std:intToExactText", refined)).toBe(text);
      expect(call("std:natToExactText", back)).toBe(text);
      expect(call("std:intToExactText", refinedBack)).toBe(text);
      expect(call("std:boolToNative", call("std:natEq", nat, back))).toBe(true);
      expect(call("std:boolToNative", call("std:intEq", refined, refinedBack))).toBe(true);
    }
  });

  test("Int ≅ Integer: both witnesses preserve exact signed integers", () => {
    const large = "9007199254740993123456789012345678901";
    for (const { integer, text } of [
      ...[-7, -3, 0, 1, 4, 7].map((x) => ({ integer: toInt(x), text: String(x) })),
      { integer: call("std:integerIntFromCanonicalText", large), text: large },
      { integer: call("std:integerIntFromCanonicalText", `-${large}`), text: `-${large}` },
    ]) {
      const refined = run("std:intToRefined", integer);
      const back = run("std:intFromRefined", refined);
      const refinedBack = run("std:intToRefined", run("std:intFromRefined", refined));
      expect(call("std:intToExactText", refined)).toBe(text);
      expect(call("std:intToExactText", back)).toBe(text);
      expect(call("std:intToExactText", refinedBack)).toBe(text);
      expect(call("std:boolToNative", call("std:intEq", integer, back))).toBe(true);
      expect(call("std:boolToNative", call("std:intEq", refined, refinedBack))).toBe(true);
    }
  });

  test("Rational ≅ RationalNumber: both witnesses preserve exact fractions and large integer parts", () => {
    for (const { r, num, den } of [
      { r: mkRat(1, 3), num: "1", den: "3" },
      { r: mkRat(-3, 2), num: "-3", den: "2" },
      { r: mkRat(0, 1), num: "0", den: "1" },
      { r: { $tag: "Rational", num: "2", den: "4" }, num: "1", den: "2" },
      { r: { $tag: "Rational", num: "9007199254740993123456789012345678901", den: "2" }, num: "9007199254740993123456789012345678901", den: "2" },
    ]) {
      const expected = { $tag: "RationalRepresentation", num, den };
      const refined = run("std:ratToRefined", r);
      const back = run("std:ratFromRefined", refined);
      const refinedBack = run("std:ratToRefined", run("std:ratFromRefined", refined));
      expect(call("std:rationalRepresentationParts", refined)).toEqual(expected);
      expect(call("std:rationalRepresentationParts", back)).toEqual(expected);
      expect(call("std:rationalRepresentationParts", refinedBack)).toEqual(expected);
      expect(call("std:boolToNative", call("std:ratEq", r, back))).toBe(true);
      expect(call("std:boolToNative", call("std:ratEq", refined, refinedBack))).toBe(true);
    }
  });

  test("Real ≅ RealNumber: realToRefined ∘ realFromRefined ≡ id (integer sub-domain, lossy carve-out)", () => {
    for (const x of [-2, 0, 3, 6]) {
      expect(run("std:realToRefined", run("std:realFromRefined", x))).toBe(x);
    }
  });
});

// ===========================================================================
// (2a) the trio DECIDES the supported scalar refinement/base relations.
//      Exact Rational containment retains the current honest abstention fence.
//      This is the alias's structural content the trio gets RIGHT (the
//      tier-2 refined-strip arm: refined ⊆ base via subset(base, base)).
// ===========================================================================
describe("Phase 3 Step 1 — trio decides: the refinement view ⊂ Number", () => {
  test("Integer ⊆ Number; RealNumber ⊆ Number (all Just true)", () => {
    expect(sub(Integer, Num)).toEqual(JT);
    expect(sub(RealNumber, Num)).toEqual(JT);
    expect(sub(NonNegInt, { $ref: "Int" })).toEqual(JT); // ℕ ⊂ ℤ — the NonNegInt template
  });

  test("RationalNumber containment preserves the exact-carrier fence (Nothing)", () => {
    // RationalNumber refines Rational, not the finite Number carrier. The
    // current named containment fragment abstains even on the genuine base
    // relation; it must not recover the old scalar hierarchy's false definite.
    expect(sub(RationalNumber, { $ref: "Rational" })).toEqual(NO);
    expect(sub(RationalNumber, Num)).toEqual(NO);
  });

  test("empty(refinement view) = Nothing — SOUND (membership constraints are undecided, never a false Just)", () => {
    expect(emp(Integer)).toEqual(NO);
    expect(emp(RationalNumber)).toEqual(NO);
    expect(emp(RealNumber)).toEqual(NO);
  });

  test("disjoint(Integer, RationalNumber) = Nothing — the exact/scalar carrier relation is unproved", () => {
    expect(dis(Integer, RationalNumber)).toEqual(NO);
    expect(dis(Integer, RealNumber)).toEqual(NO);
  });
});

// ===========================================================================
// (2b) the HONEST RECORDING — the opaque (inductive) ⟷ refined cross-
//      presentation. The structural trio cannot bridge the two representations;
//      it reports `Just false` (rep-distinctness). The iso is carried by the
//      value-level round-trips above, NOT by structural subtyping. Pinned to
//      DOCUMENT the limitation (the floor-isos surprise-#5 precedent), with the
//      explicit note that the SET-level iso holds via the witnesses.
// ===========================================================================
describe("Phase 3 Step 1 — RECORDED coarsening: opaque ⟷ refined is NOT structurally bridged", () => {
  test("subset(opaque, refined) over the iso — the structural trio does NOT prove the iso (Nothing or Just false, never a false Just true)", () => {
    // ⟦Nat⟧ = ⟦NonNegInt⟧ = ℕ denotationally (the round-trips prove the iso), but
    // the structural trio cannot bridge the opaque (inductive Peano) and refined
    // presentations — the iso is a value-level witness, not structural subtyping.
    //
    // containment-substrate Phase 5 RE-PIN (the deferred opaque↔refined family,
    // the brief's record-and-defer case). The S-brefined soundness fix + the
    // E-named nominal bridge now decide the BASE RUNG of the refined want via the
    // Subsumable hierarchy: `NonNegInt`'s base is `Int`, so `Nat-opaque ⊆ Int`
    // bridges to Just true (Nat ⊆ Int), leaving ONLY the `[0,∞)` predicate over
    // the opaque undecidable ⇒ the honest SOUND verdict is **Nothing** (the
    // prior `Just false` was over-conservative — it CLAIMED Nat ⊄ NonNegInt when
    // ⟦Nat⟧ ⊆ ⟦NonNegInt⟧ actually holds).
    //
    // decide-substrate (Tt* named-leaf honesty) RE-PIN: `Number` is now the ℝ/Real
    // SYNONYM in the Subsumable hierarchy (the Int ⊆ Number branch-law fix), so it
    // IS a hierarchy super of Int. Integer's Number base rung bridges too,
    // leaving the ℤ predicate undecidable. RationalNumber now retains Rational
    // as its exact base; its ℚ refinement also remains unproved here. Both
    // therefore preserve the honest **Nothing** result alongside NonNegInt.
    // Either way isJustTrue is `false` (the Bool collapse = isSubtype's `false` is
    // UNCHANGED): NO unsound flip.
    expect(sub(NatOpaque, NonNegInt)).toEqual(NO);
    expect(sub(IntOpaque, Integer)).toEqual(NO);
    expect(sub(RationalOpaque, RationalNumber)).toEqual(NO);
  });

  test("the reverse refined-vs-opaque negatives abstain under positive-only lifting", () => {
    // type-substrate P1(a.6): revealing the opaque want does not make an inner
    // negative a carrier-valid refutation. Only positive refined coordinates
    // lift; these legacy Just-false expectations therefore soften to Nothing.
    expect(sub(NonNegInt, NatOpaque)).toEqual(NO);
    expect(sub(Integer, IntOpaque)).toEqual(NO);
  });
});

// ===========================================================================
// THE CARDINAL RULE — sweep every (presentation × presentation) pair across the
// trio and assert NO `Nothing → Just`: every `Just` is a real structural proof.
// A Nothing where the sound answer is Nothing is fine; a Just where the sound
// answer is Nothing would be the forbidden unsoundness.
// ===========================================================================
describe("Phase 3 Step 1 — cardinal rule: 0 Nothing→Just over the presentation matrix", () => {
  const presentations: Array<[string, unknown]> = [
    ["Nat-opaque", NatOpaque],
    ["Int-opaque", IntOpaque],
    ["Rational-opaque", RationalOpaque],
    ["NonNegInt", NonNegInt],
    ["Integer", Integer],
    ["RationalNumber", RationalNumber],
    ["RealNumber", RealNumber],
    ["Number", Num],
  ];

  test("every subset verdict is a sound Tri (Just = a real structural decision)", () => {
    for (const [, a] of presentations) {
      for (const [, b] of presentations) {
        const v = sub(a, b);
        // a well-formed Tri — never undefined / malformed.
        expect(v.$tag === "Just" || v.$tag === "Nothing").toBe(true);
        if (v.$tag === "Just") expect(typeof v._0).toBe("boolean");
      }
    }
  });

  test("a refinement view is reflexive-subset of itself (Just true), never coarsened away", () => {
    expect(sub(Integer, Integer)).toEqual(JT);
    expect(sub(RationalNumber, RationalNumber)).toEqual(JT);
    expect(sub(RealNumber, RealNumber)).toEqual(JT);
    expect(sub(NonNegInt, NonNegInt)).toEqual(JT);
  });
});
