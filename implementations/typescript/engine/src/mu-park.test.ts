// decide-substrate Phase 8μ.2 — the Park (Knaster-Tarski) SUBSET arms + the
// KERNEL rule + the Tt* reconciliation. `F[X:=T] ⊆ T ⟹ μX.F ⊆ T` for monotone
// F, landed as (a) a fuel-bounded decider arm pair on `setAlgebraIsSubset`
// (the a-side Park + the b-side bounded unroll), and (b) the first new
// trusted-kernel rule since the witness rule — `verifyMuInduction`
// (judgment.fenel), wired at kernel.fenel `vpJudgment` under proof.kind
// "mu-induction", with the `mu-induction` proposer (prover-logic.fenel). The
// headline: `⟦List Int⟧ ⊆ ⟦List Number⟧` flips `Nothing` → `Just true`.
// Design: `design/mu-induction.md` §0.1/§0.5/§3. Brief:
// `workstreams/decide-substrate/briefs/phase-8mu-2-park-kernel.md`.

import { describe, it, expect } from "vitest";
import { isSubset, contains } from "./set-algebra";
import { dispatchEngineBody, dispatchedSubset } from "./engine-bodies-dispatch";
import { typeToSetExpr } from "./fenel-check";
import { List } from "./type-foundation";
import { verify } from "./kernel";

import { setDefaultTimeout } from "bun:test";

// type-substrate P1(a.5) — the same budget raise P1(a) applied to ten sibling
// files, extended here. This suite drives the INTERPRETED Fenel deciders: under
// the contention of a multi-file batch run the Tt*-reconciliation row measured
// 7.5 s against bun's 5 s default, while the whole file passes 19/19 in 85 s
// when run solo. A red that is really a clock is exactly what hid a genuine red
// in tcb-recheck at P1(a). Budget raised; no assertion weakened.
setDefaultTimeout(300_000);
import { decidableSetProposerNative } from "./modules/prover";
import { decidableSetProof } from "./prover";
import type { SetExpr } from "./types";

function mb(m: unknown): "true" | "false" | "nothing" {
  const x = m as { $tag?: string; _0?: unknown; value?: unknown };
  if (x?.$tag === "Just") return (x._0 ?? x.value) ? "true" : "false";
  return "nothing";
}

const ctor = (c: string, fields: unknown[]): SetExpr =>
  ({ $tag: "SeCtor", ctor: c, fields } as unknown as SetExpr);
const MU_PARK_FIELD_IDS: Record<string, string> = {
  head: "62000000-0000-4000-8000-000000000001",
  tail: "62000000-0000-4000-8000-000000000002",
};
const fld = (wireName: string, set: SetExpr) => ({
  $tag: "SetCtorField",
  key: { $tag: "NamedField", ref: { $ref: MU_PARK_FIELD_IDS[wireName] } },
  wireName,
  set,
});
const enumS = (...vs: unknown[]): SetExpr => ({ $tag: "SeEnum", values: vs } as unknown as SetExpr);
const ref = (h: string): SetExpr => ({ $tag: "SeRef", handle: h } as unknown as SetExpr);
const mu = (v: string, body: SetExpr): SetExpr => ({ $tag: "SeMu", var: v, body } as unknown as SetExpr);
const compl = (inner: SetExpr): SetExpr => ({ $tag: "SeComplement", inner } as unknown as SetExpr);

const listInt = (): SetExpr => typeToSetExpr(List({ $ref: "Int" })) as unknown as SetExpr;
const listNumber = (): SetExpr => typeToSetExpr(List({ $ref: "Number" })) as unknown as SetExpr;

// The JEmpty subset judgment claim `μX.F ⊆ T` (the K2+ producer currency the
// kernel re-derives) — built via the canonical `propSubset` builder.
const subsetClaim = (s: SetExpr, t: SetExpr): unknown => dispatchEngineBody("engine:propSubset", [s, t]);

// Warm the dispatch harness at module scope (registry init is ~8 s on a slow
// Windows host) so the FIRST test's 5 s default budget clocks only the test.
// Without this the headline Park assertion times out on cold start alone —
// measured 9.0 s pre-type-substrate-P1(a), 8.7 s after. Same precedent as
// floor-axioms.test.ts.
dispatchEngineBody("noneToEmptyUnion", [{ $tag: "SeNone" }]);

describe("Park a-arm — recursive-type COVARIANT containment (the headline)", () => {
  it("⟦List Int⟧ ⊆ ⟦List Number⟧ = Just true (was Nothing pre-8μ.2)", () => {
    expect(mb(isSubset(listInt(), listNumber()))).toBe("true");
  });
  it("reflexivity still holds (the 8μ.1b deepEq tail): ⟦List Int⟧ ⊆ ⟦List Int⟧", () => {
    expect(mb(isSubset(listInt(), listInt()))).toBe("true");
  });
  it("the reverse ⟦List Number⟧ ⊆ ⟦List Int⟧ is an HONEST Nothing (named-subtype only proves)", () => {
    expect(mb(isSubset(listNumber(), listInt()))).toBe("nothing");
  });
});

describe("Park a-arm — the positivity + fuel guardrails", () => {
  const badMu = () => mu("X", compl(ref("X"))); // μX.¬X — non-positive
  it("a non-positive μ ⇒ Nothing (Park declines; not a false accept)", () => {
    expect(mb(isSubset(badMu(), enumS(1)))).toBe("nothing");
  });
  it("but reflexivity does NOT need positivity: μX.¬X ⊆ μX.¬X = Just true (deepEq)", () => {
    expect(mb(isSubset(badMu(), badMu()))).toBe("true");
  });
  it("a pathological out-of-phase μ-nest TERMINATES (fuel-bounded), never a wrong refutation", () => {
    // L = μX.Cons{head:{1}, tail:X}; R = μY.Cons{head:{1}, tail:Cons{head:{1}, tail:Y}}
    // R unrolls two Cons layers per step, so the b-unroll / Park recursion never
    // reaches a deepEq-reflexive tail — the fuel budget is what stops it. The
    // assertion that MATTERS is that this returns at all (no hang) and is sound
    // (never a spurious Just false).
    const L = mu("X", ctor("Cons", [fld("head", enumS(1)), fld("tail", ref("X"))]));
    const R = mu(
      "Y",
      ctor("Cons", [fld("head", enumS(1)), fld("tail", ctor("Cons", [fld("head", enumS(1)), fld("tail", ref("Y"))]))]),
    );
    const r = mb(isSubset(L, R));
    expect(["nothing", "true"]).toContain(r); // sound: never "false"
  });
});

// type-substrate P1(a) — the μ twin of the ordinary width repair. The Park
// fieldwise loop walked the HAVE side, so a want-only field was never examined
// and a tag-only / narrower have vacuously PROVED. The loop now iterates the
// WANT side, keeping the only-proves posture: a want key absent on the have
// side abstains. Brief:
// `workstreams/type-substrate/briefs/phase-1a-sector-fringe-soundness.md`.
describe("Park fieldwise — the WANT-side width repair (type-substrate P1(a))", () => {
  it("tag-only have ⊆ field-constrained want no longer vacuously proves", () => {
    // `Cons{} ⊆ Cons{head:{1}}` is FALSE under the open reading — a value
    // `{$tag:"Cons"}` inhabits the have and not the want. HEAD answered
    // "true" through the have-side walk; the want-side walk finds `head`
    // absent on the have side and abstains.
    const have = ctor("Cons", []);
    const want = ctor("Cons", [fld("head", enumS(1))]);
    expect(mb(isSubset(mu("X", have), want))).toBe("nothing");
  });
  it("a NARROWER have still proves through the μ (no precision lost)", () => {
    // Every want field is present on the have side and entails ⇒ Just true.
    const have = ctor("Cons", [fld("head", enumS(1)), fld("tail", enumS(2))]);
    const want = ctor("Cons", [fld("head", enumS(1, 9))]);
    expect(mb(isSubset(mu("X", have), want))).toBe("true");
  });
  it("the headline covariant containment is unchanged", () => {
    expect(mb(isSubset(listInt(), listNumber()))).toBe("true");
  });
});

describe("Park b-arm — the bounded unroll (SeCtor / enum ⊆ μ)", () => {
  const nil = { $tag: "Nil" };
  it("Nil-ctor SET ⊆ ⟦List Int⟧ via the b-side unroll", () => {
    expect(mb(isSubset(ctor("Nil", []), listInt()))).toBe("true");
  });
  it("{Nil} ⊆ ⟦List Int⟧ (enum value-membership through the μ)", () => {
    expect(mb(isSubset(enumS(nil), listInt()))).toBe("true");
  });
  it("{Cons 5 Nil} ⊆ ⟦List Int⟧", () => {
    expect(mb(isSubset(enumS({ $tag: "Cons", head: 5, tail: nil }), listInt()))).toBe("true");
  });
  it("a wrong-element list is NOT a member (the value-membership face; refutation via contains)", () => {
    // The refutation lands on the 8μ.1b value-membership face (contains), which
    // decides Just false. Through isSubset's enum arm it currently ABSTAINS
    // (Nothing) — a PRE-EXISTING membership-ctx incompleteness on the NEGATIVE
    // enum⊆μ direction (positive cases decide; Nothing is sound), orthogonal to
    // Park. Pinned here so the boundary is documented, not silently assumed.
    expect(mb(contains(listInt(), { $tag: "Cons", head: "x", tail: nil }, null))).toBe("false");
    expect(mb(isSubset(enumS({ $tag: "Cons", head: "x", tail: nil }), listInt()))).toBe("nothing");
  });
});

describe("The Park KERNEL rule — verifyMuInduction (the TCB addition)", () => {
  it("round-trip: the proposer emits a mu-induction cert; the kernel re-derives ⇒ SolverChecked", () => {
    const claim = subsetClaim(listInt(), listNumber());
    const out = decidableSetProposerNative(claim) as { $tag: string; _0: { kind?: string } };
    expect(out.$tag).toBe("Ok");
    expect(out._0.kind).toBe("mu-induction"); // s is a μ ⇒ the STRONGER Park certificate
    const v = verify(claim as never, out._0 as never);
    expect(v.$tag).toBe("Ok");
    if (v.$tag === "Ok") expect(v._0.$tag).toBe("SolverChecked");
  });

  it("SOUNDNESS: a mu-induction cert for a FALSE μ-subset is REJECTED (the kernel re-derives, ignoring the witness)", () => {
    const claimFalse = subsetClaim(listNumber(), listInt()); // List Number ⊄ List Int
    // A malicious/buggy proposer hands a plausible-looking witness; the kernel
    // re-derives the premise F[X:=T] from the CLAIM's (s, t), so the witness is
    // never trusted — the false premise is what rejects it.
    const bogus = decidableSetProof("mu-induction", { left: listNumber(), right: listInt() });
    const v = verify(claimFalse as never, bogus);
    expect(v.$tag).toBe("Err");
  });

  it("the positivity gate rejects a mu-induction cert over a non-positive μ", () => {
    const badMu = mu("X", compl(ref("X")));
    const claimBad = subsetClaim(badMu, enumS(1));
    const bogus = decidableSetProof("mu-induction", { left: badMu, right: enumS(1) });
    const v = verify(claimBad as never, bogus);
    expect(v.$tag).toBe("Err");
  });

  it("a non-SeMu subset claim through the mu-induction arm is rejected (shape guard)", () => {
    // {1,2} ⊆ {1,2,3} is a real subset but s is NOT a μ — the mu-induction rule
    // must decline (verifyMuInduction requires a SeMu LHS).
    const claim = subsetClaim(enumS(1, 2), enumS(1, 2, 3));
    const bogus = decidableSetProof("mu-induction", { left: enumS(1, 2), right: enumS(1, 2, 3) });
    const v = verify(claim as never, bogus);
    expect(v.$tag).toBe("Err");
  });
});

describe("The Tt* reconciliation — the two μ-subtype paths (D-E)", () => {
  // decide-substrate (Tt* named-leaf honesty): the two paths now AGREE — both
  // decide Int ⊆ Number = Just true. The Tt* named leaf's old Just-false refutation
  // of the TRUE Int ⊆ Number was the branch-law violation this phase fixed: the
  // numeric TOP `Number` (≡ ℝ) was MISSING from the Subsumable hierarchy, so the
  // Tt* nominal bridge refuted a pair the projected-ℤ⊆ℝ Park path proves. Adding
  // `Number` as the ℝ/Real synonym converges the element leaf; the μ congruence
  // carries it identically on both paths.
  it("AGREE on the reflexive μ-congruence: List Int ⊆ List Int = Just true on BOTH paths", () => {
    expect(mb(dispatchedSubset(List({ $ref: "Int" }), List({ $ref: "Int" })))).toBe("true"); // Tt*
    expect(mb(isSubset(listInt(), listInt()))).toBe("true"); // Park / SetExpr
  });
  it("each path's List-wrapper verdict EQUALS its own element-leaf verdict, and the paths now AGREE (Just true)", () => {
    // Tt*: List Int ⊆ List Number MIRRORS Int ⊆ Number (both Just true now — the
    // Number-synonym Subsumable row makes the nominal bridge decide it; the μ
    // wrapper adds nothing).
    const ttLeaf = mb(dispatchedSubset({ $ref: "Int" }, { $ref: "Number" }));
    const ttList = mb(dispatchedSubset(List({ $ref: "Int" }), List({ $ref: "Number" })));
    expect(ttList).toBe(ttLeaf);
    expect(ttLeaf).toBe("true");
    // Park: ⟦List Int⟧ ⊆ ⟦List Number⟧ MIRRORS ⟦Int⟧ ⊆ ⟦Number⟧ (both Just true —
    // the projected ℤ ⊆ ℝ leaf proves; the μ congruence carries it). The two paths
    // agree leaf-for-leaf and wrapper-for-wrapper.
    const seLeaf = mb(isSubset(typeToSetExpr({ $ref: "Int" }) as never, typeToSetExpr({ $ref: "Number" }) as never));
    const seList = mb(isSubset(listInt(), listNumber()));
    expect(seList).toBe(seLeaf);
    expect(seLeaf).toBe("true");
    // The reconciliation is now full AGREEMENT: ttLeaf === seLeaf.
    expect(ttLeaf).toBe(seLeaf);
  });
});
