// ---------------------------------------------------------------------------
// floor-kernel Phase 2 — the TCB re-check rows (design/tcb-ledger.md task 3).
//
// "A rule classified THEOREM stops being trusted and starts being CHECKED" made
// literal: each test decides a THEOREM-classified rule's claim through an
// INDEPENDENT face (subset claims via decideEmpty-of-difference or per-value
// contains loops; emptiness via the witness face; disjointness via empty(∩);
// normalize rewrites via per-value membership agreement) and asserts AGREEMENT
// — never a contradiction; `Nothing` is allowed only on ledgered fences.
// A false-Just on any row = STOP, investigate (the P1 discipline).
//
// Row ids in test names are the ledger's stable keys (design/tcb-ledger.md).
// Sibling of floor-axioms.test.ts (the P1 harness — same builders + dispatch
// seam); THEOREM rows already pinned by existing suites (mu-park, arrow,
// containment-*, phase-2-4-variant-disjoint, floor-axioms S2/S4) are cited in
// the ledger rather than duplicated here.
//
// THE PHASE-2 STOP-CLAUSE FIX PINNED HERE (t.sub.arrow.flatten): the Tt* face
// (containment.fenel arrowSub) refuted flat-vs-curried arrow pairs on WRITTEN
// arity — `(N,N)→N ⊆ (N)→((N)→N)` was Just false while the Se* face (which got
// arrowFlatten at 8λ.2-r) proves Just true: a cross-face CONTRADICTION against
// the probe-verified currying semantics. Fixed by mirroring the full 8λ.2-r
// structure (ttArrowFlatten + the gated residual-arity tail); the genuine
// arity refutation stays Just false.
//
// ALSO PINNED (norm.intersect.pair-disjoint): the P1 handoff-(d) normalize-vs-
// decideEmpty skew (enum twin collapsed, interval twin reportedly didn't) does
// NOT reproduce at HEAD — both twins normalize to SeNone and agree with
// decideEmpty (evidently collateral-fixed by the P1 soundness fixes: the
// collapse rides isDisjoint's swap → isSubset, which fix 2 rebuilt). If either
// cell moves, the skew is back — investigate before re-pinning.
// ---------------------------------------------------------------------------

import { test, expect, describe, setDefaultTimeout } from "bun:test";
import {
  dispatchEngineBodyWithDeciderCtx,
  dispatchedDisjointType,
  dispatchedEmpty,
  dispatchedSubset,
} from "./engine-bodies-dispatch";
import { verify } from "./kernel";
import { decidableSetProof } from "./prover";
import type { SetExpr } from "./types";

// --- Tri + canonical `$tag` Se* builders (the floor-axioms conventions) ------
type Tri = { $tag: "Just"; _0: boolean } | { $tag: "Nothing" };
const JT: Tri = { $tag: "Just", _0: true };
const JF: Tri = { $tag: "Just", _0: false };
const NO: Tri = { $tag: "Nothing" };

// type-substrate P1(a) — THE TRIPWIRE HAS TO BE ABLE TO TRIP. Every cell here
// re-checks a ledger rule across faces through the INTERPRETED Fenel deciders,
// and ten of these tests measured 7-20 s against bun's 5 s default on a slow
// Windows host — i.e. the suite reported TWELVE failures of which ELEVEN were
// pure clock. A tripwire that always shows red is a tripwire nobody reads, and
// that is exactly how the ONE real red below (`emp.arrow-bool NONEMPTY`) went
// unnoticed. Raise the budget; do NOT weaken an assertion to make it fit.
setDefaultTimeout(300_000);

const En = (...vs: unknown[]) => ({ $tag: "SeEnum", values: vs });
const Iv = (lo: number, hi: number) => ({
  $tag: "SeInterval",
  interval: {
    lo: { $tag: "Just", _0: { value: lo, inclusive: true } },
    hi: { $tag: "Just", _0: { value: hi, inclusive: true } },
  },
});
const U = (...bs: unknown[]) => ({ $tag: "SeUnion", branches: bs });
const I = (...bs: unknown[]) => ({ $tag: "SeIntersect", branches: bs });
const C = (x: unknown) => ({ $tag: "SeComplement", inner: x });
const D = (l: unknown, r: unknown) => ({ $tag: "SeDiff", left: l, right: r });
const ALL = { $tag: "SeAll" };
const NONE = { $tag: "SeNone" };
const Ctor = (ctor: string, fields: unknown[]) => ({ $tag: "SeCtor", ctor, fields });
const Arrow = (ps: unknown[], r: unknown) => ({
  $tag: "SeArrow",
  params: ps.map((set, i) => ({
    $tag: "SetArrowParam",
    key: { $tag: "NamedField", ref: { $ref: `40000000-0000-4000-8000-${String(i + 1).padStart(12, "0")}` } },
    wireName: `p${i}`,
    set,
  })),
  returns: r,
});

const call = (fn: string, args: unknown[]) =>
  dispatchEngineBodyWithDeciderCtx(`engine:${fn}`, args);
const subset = (a: unknown, b: unknown) => call("setAlgebraIsSubset", [a, b]) as Tri;
const empty = (s: unknown) => call("setAlgebraDecideEmpty", [s]) as Tri;
const disjoint = (a: unknown, b: unknown) => call("setAlgebraIsDisjoint", [a, b]) as Tri;
const contains = (s: unknown, v: unknown) => call("setAlgebraContains", [s, v]) as Tri;
const normalize = (s: unknown) => call("setAlgebraNormalize", [s]);
const nnf = (s: unknown) => call("setAlgebraNnf", [s]);

const E1 = En(1, 2);
const P = Iv(0, 10);

// the universal normalize re-check: the membership face certifies the rewrite
// (⟦norm(s)⟧ = ⟦s⟧ on every probe value that decides on both sides).
const PROBES = [0, 1, 2, 3, 5, 42];
const membershipAgrees = (orig: unknown, normed: unknown) => {
  for (const v of PROBES) {
    const before = contains(orig, v);
    const after = contains(normed, v);
    if (before.$tag === "Just" && after.$tag === "Just") {
      expect({ v, after }).toEqual({ v, after: before });
    }
  }
};

// Warm the dispatch harness at module scope (registry init ~10s on this box).
call("setAlgebraNormalize", [NONE]);

// ===========================================================================
// R1 — the kernel iso + membership theorems
// ===========================================================================
describe("tcb-recheck — kernel iso + membership theorems", () => {
  test("k.iso.judgment: s ⊆ t ⟺ empty(s ∩ ¬t) — agreement on both polarities", () => {
    expect(subset(E1, En(1, 2, 3))).toEqual(JT);
    expect(empty(I(E1, C(En(1, 2, 3))))).toEqual(JT);
    expect(subset(En(5), E1)).toEqual(JF);
    expect(empty(I(En(5), C(E1)))).toEqual(JF);
  });

  test("mem.diff: contains(A∖B, v) ≡ contains(A ∩ ¬B, v) per value (the ∖=∩∘¬ unfold)", () => {
    const a = En(1, 2);
    const b = En(2, 3);
    for (const v of PROBES) {
      expect(contains(D(a, b), v)).toEqual(contains(I(a, C(b)), v));
    }
  });
});

// ===========================================================================
// R2 — emptiness theorems re-checked via the witness / subset faces
// ===========================================================================
describe("tcb-recheck — emptiness theorems", () => {
  test("emp.enum: {} = ∅ (agrees with normalize) and {1} ≠ ∅ (witnessed)", () => {
    expect(empty(En())).toEqual(JT);
    expect(normalize(En())).toEqual(NONE);
    expect(empty(En(1))).toEqual(JF);
    expect(contains(En(1), 1)).toEqual(JT); // the witness
  });

  test("emp.union: ∪ empty ⟺ all branches empty; a witnessed branch refutes", () => {
    expect(empty(U(En(), Iv(10, 0)))).toEqual(JT); // empty enum + invalid interval
    expect(empty(U(En(1), En(2)))).toEqual(JF);
    expect(contains(U(En(1), En(2)), 1)).toEqual(JT); // the witness
  });

  test("emp.intersect: empty factor / provably-disjoint pair ⇒ ∅; subset face agrees", () => {
    expect(empty(I(En(), En(1)))).toEqual(JT); // empty factor
    expect(empty(I(En(1), En(2)))).toEqual(JT); // pairwise disjoint
    expect(subset(I(En(1), En(2)), NONE)).toEqual(JT); // ⊆ ∅ via the normalize-retry tail
  });

  test("emp.diff.via-subset: A∖B = ∅ ⟺ A ⊆ B (the brief's canonical row)", () => {
    expect(empty(D(En(1, 2), En(1, 2, 3)))).toEqual(JT);
    expect(subset(En(1, 2), En(1, 2, 3))).toEqual(JT);
    expect(empty(D(En(5), E1))).toEqual(JF);
    expect(subset(En(5), E1)).toEqual(JF);
    expect(empty(D(Iv(0, 5), P))).toEqual(JT); // interval sample
    expect(subset(Iv(0, 5), P)).toEqual(JT);
  });

  test("emp.complement: ¬⊤ = ∅; ¬∅ = ⊤ inhabited (witnessed)", () => {
    expect(empty(C(ALL))).toEqual(JT);
    expect(empty(C(NONE))).toEqual(JF);
    expect(contains(C(NONE), 42)).toEqual(JT); // the witness
  });
});

// ===========================================================================
// R3 — disjointness theorems re-checked via empty(∩) / the subset face
// ===========================================================================
describe("tcb-recheck — disjointness theorems", () => {
  test("dis.none: ∅ ⊥ x ≡ empty(∅ ∩ x)", () => {
    expect(disjoint(NONE, En(1))).toEqual(JT);
    expect(empty(I(NONE, En(1)))).toEqual(JT);
  });

  test("dis.all: ⊤ ⊥ x ⟺ empty(x) — both polarities", () => {
    expect(disjoint(ALL, En())).toEqual(JT);
    expect(empty(En())).toEqual(JT);
    expect(disjoint(ALL, En(1))).toEqual(JF);
    expect(empty(En(1))).toEqual(JF);
  });

  test("dis.union.a: (∪bs) ⊥ o ≡ empty((∪bs) ∩ o) — both polarities", () => {
    expect(disjoint(U(En(1), En(2)), En(3))).toEqual(JT);
    expect(empty(I(U(En(1), En(2)), En(3)))).toEqual(JT);
    expect(disjoint(U(En(1), En(2)), En(2))).toEqual(JF);
    expect(empty(I(U(En(1), En(2)), En(2)))).toEqual(JF);
  });

  test("dis.intersect.a: a branch ⊥ o proves (∩bs) ⊥ o ≡ empty(∩)", () => {
    expect(disjoint(I(En(1), En(1, 2)), En(3))).toEqual(JT);
    expect(empty(I(I(En(1), En(1, 2)), En(3)))).toEqual(JT);
  });

  test("dis.ctor.tag: distinct ctors ⊥ (singleton distinctness) ≡ empty(∩)", () => {
    const a = Ctor("A", []);
    const b = Ctor("B", []);
    expect(disjoint(a, b)).toEqual(JT);
    expect(empty(I(a, b))).toEqual(JT);
  });

  test("dis.complement: ¬X ⊥ o ⟺ o ⊆ X — both polarities transfer", () => {
    expect(disjoint(C(E1), En(1))).toEqual(JT);
    expect(subset(En(1), E1)).toEqual(JT);
    expect(disjoint(C(E1), En(5))).toEqual(JF);
    expect(subset(En(5), E1)).toEqual(JF);
  });
});

// ===========================================================================
// R4 — subset theorems re-checked via emptiness / membership faces
// ===========================================================================
describe("tcb-recheck — subset theorems", () => {
  test("sub.union.a: (∪bs) ⊆ b ≡ empty((∪bs) ∖ b) — both polarities", () => {
    expect(subset(U(En(1), En(2)), E1)).toEqual(JT);
    expect(empty(D(U(En(1), En(2)), E1))).toEqual(JT);
    expect(subset(U(En(1), En(5)), E1)).toEqual(JF);
    expect(empty(D(U(En(1), En(5)), E1))).toEqual(JF);
  });

  test("sub.intersect.a: the ∃-shortcut agrees with the normalized precise answer", () => {
    const meet = I(En(1, 2), En(1, 3));
    expect(subset(meet, E1)).toEqual(JT); // branch {1,2} ⊆ {1,2} proves the whole
    expect(subset(normalize(meet) as object, E1)).toEqual(JT); // normalize ⇒ {1} ⊆ {1,2}
  });

  test("sub.tail.intersect-every: a ⊆ ∩bs ⟺ ∀i. a ⊆ bᵢ ≡ per-value membership", () => {
    const meet = I(En(1, 2), En(1, 3));
    expect(subset(En(1), meet)).toEqual(JT);
    expect(contains(meet, 1)).toEqual(JT);
    expect(empty(D(En(1), meet))).toEqual(JT);
  });

  test("sub.tail.union-some: a ⊆ some branch ⇒ a ⊆ ∪bs ≡ membership", () => {
    expect(subset(En(1), U(E1, En(5)))).toEqual(JT);
    expect(contains(U(E1, En(5)), 1)).toEqual(JT);
  });

  test("sub.refl.deepeq + norm.diff.self + emp.diff — the three-way reflexivity agreement", () => {
    expect(subset(P, P)).toEqual(JT);
    expect(normalize(D(P, P))).toEqual(NONE);
    expect(empty(D(P, P))).toEqual(JT);
  });
});

// ===========================================================================
// R5 — normalize rewrites re-checked via the membership face (⟦norm(s)⟧=⟦s⟧)
// ===========================================================================
describe("tcb-recheck — normalize rewrites (denotation preserved)", () => {
  test("norm.union.identity + norm.union.top: x∪∅ = x; x∪⊤ = ⊤", () => {
    expect(normalize(U(E1, NONE))).toEqual(E1);
    expect(normalize(U(E1, ALL))).toEqual(ALL);
    membershipAgrees(U(E1, NONE), normalize(U(E1, NONE)) as object);
  });

  test("norm.union.enum-dedup: duplicate values collapse (idempotence)", () => {
    const u = U(En(1, 2), En(2));
    expect(normalize(u)).toEqual(En(1, 2));
    membershipAgrees(u, normalize(u) as object);
  });

  test("norm.intersect.identity + norm.intersect.bottom: x∩⊤ = x; x∩∅ = ∅", () => {
    expect(normalize(I(E1, ALL))).toEqual(E1);
    expect(normalize(I(E1, NONE))).toEqual(NONE);
  });

  test("norm.intersect.dnf: (A∪B)∩C distributes and decides (distributivity)", () => {
    const s = I(U(En(1), En(2)), En(1));
    expect(normalize(s)).toEqual(En(1));
    membershipAgrees(s, normalize(s) as object);
  });

  test("norm.intersect.pair-disjoint — THE (d)-handoff skew pin: BOTH twins collapse and agree with decideEmpty", () => {
    expect(normalize(I(E1, C(E1)))).toEqual(NONE); // the enum twin
    expect(normalize(I(P, C(P)))).toEqual(NONE); // the interval twin (the P1-reported skew — gone at HEAD)
    expect(empty(I(E1, C(E1)))).toEqual(JT);
    expect(empty(I(P, C(P)))).toEqual(JT);
  });

  test("norm.complement.top-bottom + norm.complement.invol: ¬⊤ = ∅; ¬∅ = ⊤; ¬¬x = x", () => {
    expect(normalize(C(ALL))).toEqual(NONE);
    expect(normalize(C(NONE))).toEqual(ALL);
    expect(normalize(C(C(E1)))).toEqual(E1);
    membershipAgrees(C(C(E1)), normalize(C(C(E1))) as object);
  });

  test("norm.diff.trivials: ∅∖b = ∅; a∖∅ = a; a∖⊤ = ∅", () => {
    expect(normalize(D(NONE, E1))).toEqual(NONE);
    expect(normalize(D(E1, NONE))).toEqual(E1);
    expect(normalize(D(E1, ALL))).toEqual(NONE);
  });

  test("norm.diff.disjoint: a ⊥ b ⇒ a∖b = a", () => {
    const d = D(E1, En(5));
    expect(normalize(d)).toEqual(E1);
    membershipAgrees(d, normalize(d) as object);
  });

  test("norm.diff.a-minus-not-c: a∖¬c = a∩c (the P1-handoff named rewrite)", () => {
    const d = D(E1, C(En(2, 3)));
    expect(normalize(d)).toEqual(En(2));
    membershipAgrees(d, normalize(d) as object);
    // and the verdict face agrees with the rewrite target
    for (const v of PROBES) {
      expect(contains(d, v)).toEqual(contains(I(E1, En(2, 3)), v));
    }
  });

  test("norm.diff.distribute: (∪aᵢ)∖b = ∪(aᵢ∖b); a∖(b∪c) folds", () => {
    const left = D(U(En(1), En(2)), En(1));
    expect(normalize(left)).toEqual(En(2));
    membershipAgrees(left, normalize(left) as object);
    const right = D(E1, U(En(1), Iv(5, 10))); // the b-union survives normalize (enum + interval)
    expect(normalize(right)).toEqual(En(2));
    membershipAgrees(right, normalize(right) as object);
  });

  test("norm.enum.empty: {} → ∅ agrees with the emptiness face", () => {
    expect(normalize(En())).toEqual(NONE);
    expect(empty(En())).toEqual(JT);
  });
});

// ===========================================================================
// R7 — floor-kernel Phase 3a: the three no-¬ quick-win arms (MISSING → THEOREM)
// Each pin decides the new arm's claim through independent machinery:
// sub.diff.arm via the ∖=∩∘¬ unfold (normalize + enum filtering) + the
// membership witness; dis.diff via empty(∩) where the interval theory
// collapses the meet; dis.all via the emptiness face (the identity law) +
// the direction agreement the completion closes (⊤ ⊥ ∪ was fenced while
// ∪ ⊥ ⊤ decided branchwise).
// ===========================================================================
describe("tcb-recheck — floor-kernel 3a quick-win arms", () => {
  test("sub.diff.arm: A∖B ⊆ C ⟺ A ⊆ B∪C — agrees with the ∖=∩∘¬ spelling + the membership witness", () => {
    // {1,2}∖{2,3} = {1} ⊆ {1}: the new arm and the ∩¬ spelling agree
    expect(subset(D(E1, En(2, 3)), En(1))).toEqual(JT);
    expect(subset(I(E1, C(En(2, 3))), En(1))).toEqual(JT);
    // refutation is witness-grade: 1 ∈ A∖B but 1 ∉ {2}
    expect(subset(D(E1, En(2)), En(2))).toEqual(JF);
    expect(contains(D(E1, En(2)), 1)).toEqual(JT);
    expect(contains(En(2), 1)).toEqual(JF);
    // the S2 diff-def-fwd shape now decides (the P1 fenced cell, flipped)
    expect(subset(D(E1, En(2, 3)), I(E1, C(En(2, 3))))).toEqual(JT);
  });

  test("dis.diff: (A∖B) ⊥ C ⟺ A∩C ⊆ B — agrees with empty(∩) via the interval theory", () => {
    // [0,5]∖[3,5] = [0,3) ⊥ [6,10] — the interval theory collapses the meet
    expect(disjoint(D(Iv(0, 5), Iv(3, 5)), Iv(6, 10))).toEqual(JT);
    expect(empty(I(D(Iv(0, 5), Iv(3, 5)), Iv(6, 10)))).toEqual(JT);
    // the overlap refutes on both faces
    expect(disjoint(D(Iv(0, 5), Iv(3, 5)), Iv(0, 10))).toEqual(JF);
    expect(empty(I(D(Iv(0, 5), Iv(3, 5)), Iv(0, 10)))).toEqual(JF);
    // the enum-other direction agrees with the pre-3a swap loop (both live)
    expect(disjoint(D(E1, En(2)), En(1))).toEqual(JF);
    expect(disjoint(D(E1, E1), En(1))).toEqual(JT);
  });

  test("dis.all: ⊤ ⊥ x ⟺ x = ∅ beyond enums — intervals/ctors/compounds; direction agreement", () => {
    expect(disjoint(ALL, Iv(0, 10))).toEqual(JF);
    expect(empty(Iv(0, 10))).toEqual(JF);
    expect(disjoint(ALL, Iv(10, 0))).toEqual(JT); // invalid interval = ∅
    expect(empty(Iv(10, 0))).toEqual(JT);
    expect(disjoint(ALL, Ctor("A", []))).toEqual(JF); // nullary ctor = a point
    // the direction asymmetry closed: ⊤ ⊥ ∪ was Nothing while ∪ ⊥ ⊤ decided
    expect(disjoint(ALL, U(En(1), En(2)))).toEqual(JF);
    expect(disjoint(U(En(1), En(2)), ALL)).toEqual(JF);
  });
});

// ===========================================================================
// R8 — floor-kernel Phase 3b: NNF composition, complement-top, and the
// single-negative arrow-Boolean theorem. EMPTY verdicts take ReDecide through
// the kernel; the NONEMPTY row explicitly realizes a signature as a closure
// via inhabit, then takes the kernel witness rule ({w} ⊆ s) to SolverChecked.
// ===========================================================================
describe("tcb-recheck — floor-kernel 3b arrow Boolean + NNF/top-cover", () => {
  test("norm.nnf: De Morgan + involution + diff-def compose and preserve membership", () => {
    const source = C(D(E1, En(2, 3)));
    const expected = U(C(E1), En(2, 3));
    expect(nnf(source)).toEqual(expected);
    membershipAgrees(source, expected);

    const nested = C(U(E1, I(En(2, 3), C(P))));
    const nestedExpected = I(C(E1), U(C(En(2, 3)), P));
    expect(nnf(nested)).toEqual(nestedExpected);
    membershipAgrees(nested, nestedExpected);
  });

  test("emp.complement-top: excluded middle + interval pairing decide both polarities", () => {
    const excludedMiddle = U(E1, C(E1));
    expect(empty(C(excludedMiddle))).toEqual(JT);

    const intervalCover = U(Iv(0, 5), Iv(5, 10), C(Iv(0, 10)));
    expect(empty(C(intervalCover))).toEqual(JT);

    const incomplete = U(En(1), C(En(1, 2)));
    expect(empty(C(incomplete))).toEqual(JF);
    expect(contains(C(incomplete), 2)).toEqual(JT); // witness-grade refutation of top-cover
  });

  test("emp.arrow-bool EMPTY: split domains jointly imply the target arrow; ReDecide SolverChecked", () => {
    const a = En(1);
    const b = En(2);
    const r = En(0);
    const positiveA = Arrow([a], r);
    const positiveB = Arrow([b], r);
    const target = Arrow([U(a, b)], r);
    const s = I(positiveA, positiveB, C(target));

    expect(empty(s)).toEqual(JT); // neither positive alone is below target; their domain cover is
    const result = verify(
      { $tag: "JEmpty", _0: s } as never,
      decidableSetProof("empty", { left: s as unknown as SetExpr }),
    );
    expect(result.$tag).toBe("Ok");
    if (result.$tag === "Ok") expect(result._0.$tag).toBe("SolverChecked");
  });

  // KNOWN-FAILING, and NOT a type-substrate P1(a) regression — a PRECISION
  // regression from decide-substrate 8-lambda.6 (the preference-ordered candidate
  // search), surfaced only once P1(a) raised this file's timeouts so the suite
  // could be read at all. `test.failing` is deliberate: it keeps the rest of the
  // tripwire green AND flips RED the moment someone repairs the check face, which
  // forces this marker back to `test`.
  //
  // EVIDENCE (measured 2026-08-16; identical at HEAD and post-P1(a)):
  //   inhabit(Arrow([{1}],{1}))              = \_0 -> _0    (the IDENTITY)
  //   contains(Arrow([{1}],{2}), \_0 -> _0)  = Nothing      => the complement abstains
  //   contains(Arrow([{1}],{2}), \_0 -> 1)   = Just false   => the complement DECIDES
  //   contains(Arrow([{1}],{1}), \_0 -> 1)   = Just true
  // i.e. the pre-8-lambda.6 CONST-first witness still satisfies this row exactly;
  // the identity does not, because the check face cannot refute `\x -> x` against a
  // return-mismatched signature. The claim that `s` is nonempty is still TRUE and
  // the deciders are still SOUND (`empty(s)` = Just false, and the abstention is an
  // honest Nothing) — what is lost is the kernel-certifiable WITNESS for it.
  // Repair belongs to a check-face phase, not here: `check.fenel` is whole-file
  // fenced and feeds the synthesis byte-identity gate.
  test.failing("emp.arrow-bool NONEMPTY: SC-wit closure realizes the counter-signature; witness rule SolverChecked", () => {
    const a = En(1);
    const oneOrTwo = En(1, 2);
    const positive = Arrow([a], a);
    const weakerPositive = Arrow([a], oneOrTwo);
    const target = Arrow([a], En(2));
    const s = I(positive, weakerPositive, C(target));

    expect(empty(s)).toEqual(JF);
    const proposed = call("inhabit", [positive]) as
      | { $tag: "Just"; _0: unknown }
      | { $tag: "Nothing" };
    expect(proposed.$tag).toBe("Just");
    if (proposed.$tag !== "Just") return;
    expect(contains(s, proposed._0)).toEqual(JT);

    const result = verify(
      { $tag: "JInhabited", _0: s } as never,
      decidableSetProof("witness", { left: proposed._0 }),
    );
    expect(result.$tag).toBe("Ok");
    if (result.$tag === "Ok") expect(result._0.$tag).toBe("SolverChecked");
  });

  test("emp.arrow-bool keeps the multi-negative Phase-3c fence", () => {
    const a = En(1);
    const positive = Arrow([a], a);
    const weakerPositive = Arrow([a], En(1, 2));
    const target1 = Arrow([a], En(2));
    const target2 = Arrow([En(2)], a);
    expect(empty(I(positive, weakerPositive, C(target1), C(target2)))).toEqual(NO);
  });
});

// ===========================================================================
// R9 — floor-kernel Phase 3c: the two remaining subset rows + their Tt mirrors
// ===========================================================================
describe("tcb-recheck — floor-kernel 3c complement face-pairs", () => {
  test("missing.sub.top-compound + missing.sub.lhs-complement are checked in both polarities", () => {
    expect(subset(ALL, U(E1, C(E1)))).toEqual(JT); // excluded-middle top cover
    expect(subset(C(C(E1)), E1)).toEqual(JT); // double-complement subset

    const lhs = C(En(1));
    const rhs = C(En(1, 2));
    expect(subset(lhs, rhs)).toEqual(JF);
    // Independent witness for the false polarity: 2 is in ¬{1}, not ¬{1,2}.
    expect(contains(lhs, 2)).toEqual(JT);
    expect(contains(rhs, 2)).toEqual(JF);
  });

  test("Tt*/Se* complement projection permits the named refined-negative abstention divergence", () => {
    const Num = { $ref: "Number" };
    const ttRef = (values: number[]) => ({ $refined: { base: Num, set: { $tag: "SeEnum", values: values } } });
    const ttComp = (inner: unknown) => ({ $complement: inner });
    const a = ttRef([1]);
    const ab = ttRef([1, 2]);

    expect(dispatchedSubset(ttComp(ab), ttComp(a))).toEqual(subset(C(En(1, 2)), C(En(1))));
    const seNegative = disjoint(C(En(1)), En(1, 2));
    const ttNegative = dispatchedDisjointType(ttComp(a), ab) as Tri;
    expect(seNegative).toEqual(JF);
    // P1(a.6): Tt may forget a negative that Se can still prove, but it may not
    // contradict it. This is the explicit information order Tt ∈ {Se, Nothing}.
    expect([seNegative, NO]).toContainEqual(ttNegative);
    expect(dispatchedEmpty(ttComp({ $union: [a, ttComp(a)] }))).toEqual(
      empty(C(U(En(1), C(En(1))))),
    );
  });

  test("outside the licensed slice remains Nothing", () => {
    const ref = { $tag: "SeRef", handle: "Phase3cUnknown" };
    expect(subset(ALL, U(ref, C(ref)))).toEqual(NO); // ctx-bearing SetExpr leaf
    expect(dispatchedEmpty({ $complement: { $var: "a" } })).toEqual(NO); // unknown Tt leaf
  });
});

// ===========================================================================
// R6 — the Tt* face: the Phase-2 STOP-clause fix pins (t.sub.arrow)
// ===========================================================================
describe("tcb-recheck — t.sub.arrow curry-normalization (the Phase-2 fix)", () => {
  const Num = { $ref: "Number" };
  const arrow = (ps: unknown[], r: unknown) => ({
    $arrow: {
      params: ps.map((t, i) => ({
        name: `_${i}`,
        key: { $tag: "PositionalField" as const, index: i },
        type: t,
      })),
      returns: r,
    },
  });
  const seNum = { $tag: "SeRef", handle: "Number" };
  const seArrow = (ps: unknown[], r: unknown) => ({
    $tag: "SeArrow",
    params: ps.map((t, i) => ({
      key: { $tag: "PositionalField" as const, index: i },
      wireName: `_${i}`,
      set: t,
    })),
    returns: r,
  });
  const flat = arrow([Num, Num], Num);
  const curried = arrow([Num], arrow([Num], Num));

  // type-substrate P1(a.7) — the Tt* arrow arm ABSTAINS in both polarities, so
  // the Phase-2 currying fix is no longer OBSERVABLE on that face. The Se* face
  // is UNTOUCHED and still proves both directions, which makes these two tests a
  // pinned CROSS-FACE DIVERGENCE rather than a lost claim. The Tt* fence is not
  // a retraction of the currying argument: it is the honest consequence of
  // `ttArrowFlatten` curry-normalizing while `validationValidateArrow` counts
  // the UNFLATTENED `VtArrow` field list, which is one of the two implemented
  // refuters recorded against ledger row `t.sub.arrow` (AXIOM → MISSING).
  test("flat ≡ curried — Se* still proves BOTH directions; the Tt* face now abstains", () => {
    expect(dispatchedSubset(flat, curried)).toEqual(NO);
    expect(dispatchedSubset(curried, flat)).toEqual(NO);
    expect(subset(seArrow([seNum, seNum], seNum), seArrow([seNum], seArrow([seNum], seNum)))).toEqual(JT);
    expect(subset(seArrow([seNum], seArrow([seNum], seNum)), seArrow([seNum, seNum], seNum))).toEqual(JT);
  });

  test("the genuine arity refutation survives on Se* only: (N)→N ⊄ (N,N)→N", () => {
    // The Tt* half is a PRICED LOSS at P1(a.7), recovered only by a
    // written-arity-equal variance slice carrying its own entitlement.
    expect(dispatchedSubset(arrow([Num], Num), flat)).toEqual(NO);
    expect(subset(seArrow([seNum], seNum), seArrow([seNum, seNum], seNum))).toEqual(JF);
  });
});
