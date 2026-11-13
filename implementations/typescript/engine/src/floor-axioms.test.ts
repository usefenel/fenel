// ---------------------------------------------------------------------------
// floor-kernel Phase 1 — the Layer-1 floor-axiom witnesses + the decided-vs-
// fenced LEDGER (design/floor-kernel.md §3.2/§3.3; sibling of
// phase-2-floor-isos.test.ts).
//
// The law claims are BUILT IN FENEL (floor-axioms.fenel law builders — Se*
// values as data) and JUDGED IN FENEL (floorLawVerdicts → the trio:
// setAlgebraIsSubset both directions + setAlgebraDecideEmpty over both
// symmetric differences — the judgment-iso face). This file pins the verdict
// table (S2): drift in the deciders SHOWS UP as a ledger diff here, not
// silently. A `Just true` cell is a THEOREM INSTANCE the substrate certifies;
// a `Nothing` cell is an HONEST FENCE (complement fences — Phase 3's
// quantified motivation); a `Just false` cell is FORBIDDEN (a decider must
// never false-`Just` — the Tri discipline; S3 pins the invariant grid-wide).
//
// THE THREE SOUNDNESS FIXES this phase's probe forced (S3's regression pins;
// set-algebra-deciders.fenel "floor-kernel Phase 1 SOUNDNESS FIX"):
//   1. subsetAllArm — `⊤ ⊆ b` blanket-refuted Boolean COMPOUNDS
//      (`⊤ ⊆ A ∪ ¬A ⇒ Just false`, a false refutation that poisoned
//      decideEmptyDiff ⇒ the kernel's `nonempty` re-check). Compounds now
//      fence (∪/∖/¬ ⇒ Nothing) or decide exactly (∩ ⇒ the ∀-rule mEvery —
//      `⊤ ⊆ ∩[]` now Just true, the nullary meet).
//   2. subsetEnumArm — enum ⊆ ∪/∩/∖/¬ fell to the tail rules' mSome fold,
//      which falsely refuted a SPLITTING enum ({v,w} ⊆ {v} ∪ {w} ⇒ Just
//      false). Now the exact per-value membership loop (searchable-gated).
//   3. subsetSome — the b-∪ ∃-fold's "all branches refuted ⇒ refuted"
//      collapse is unsound whenever A splits across branches
//      ([0,10] ⊆ [0,5] ∪ [5,10]); the ∃-rule can prove, never refute.
//
// KERNEL FACE (S4, the brief's stretch): representative decided laws routed
// through verify() — the trusted kernel re-checks the trio's verdict and
// grades SolverChecked. "The substrate certifies its own algebra" literally.
//
// SeCtor CROSS-CTOR CELLS (S5) — REPAIRED by type-substrate P1(a)
// (`workstreams/type-substrate/briefs/phase-1a-sector-fringe-soundness.md`).
// This block used to pin four cells as KNOWN-UNSOUND-ON-NON-CANONICAL-
// OPERANDS. That framing was itself wrong on half the family: `$record`
// projects to `SeCtor ""` (typeRecordToSet; validate.fenel's emptySchema),
// so a `""`-vs-named pair is the everyday `$record`-meets-variant-case
// operand, not a hostile fixture. Six incorrect-DEFINITE-verdict paths were
// repaired across four faces (mem/emp/dis/sub + the μ twin + the arrow-ctor
// arm), with two root causes — have-side-only iteration, and `""` treated as
// a distinct TAG by the refutation legs while membership is `""`-agnostic.
// Every cell below is now either a CERTIFIED verdict or an HONEST FENCE;
// a `Just false` where the truth is `true` (or vice versa) is forbidden.
// If a cell moves, a later phase reclassified the SeCtor faces: update the
// verdict here, the tcb-ledger rows, and the roadmap together.
// ---------------------------------------------------------------------------

import { test, expect, describe } from "bun:test";
import {
  dispatchEngineBody,
  dispatchEngineBodyWithDeciderCtx,
  __registerFieldCurrentWireFixtureForTests,
  __clearFieldCurrentWireFixturesForTests,
} from "./engine-bodies-dispatch";
import { verify } from "./kernel";
import { decidableSetProof } from "./prover";
import type { Proposition } from "./prover";
import type { SetExpr } from "./types";

// --- Tri (the trio's Maybe<Bool>) ------------------------------------------
type Tri = { $tag: "Just"; _0: boolean } | { $tag: "Nothing" };
const JT: Tri = { $tag: "Just", _0: true };
const JF: Tri = { $tag: "Just", _0: false };
const NO: Tri = { $tag: "Nothing" };

// --- canonical `$tag` Se* builders (the registered-ADT wire shapes) --------
const En = (...vs: unknown[]) => ({ $tag: "SeEnum", values: vs });
// Interval bounds are canonical Maybe<Bound> (canonical-maybe Phase 4 /
// migration 0054): `lo/hi: {$tag:"Just", _0:{value, inclusive}}`.
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
const FLOOR_FIELD_IDS: Record<string, string> = {
  x: "50000000-0000-4000-8000-000000000001",
  y: "50000000-0000-4000-8000-000000000002",
};
const Fld = (wireName: string, set: unknown) => ({
  $tag: "SetCtorField",
  key: { $tag: "NamedField", ref: { $ref: FLOOR_FIELD_IDS[wireName] } },
  wireName,
  set,
});
const Ctor = (ctor: string, fields: unknown[]) => ({ $tag: "SeCtor", ctor, fields });
// type-substrate P1(a) — a field whose WIRE and whose identity KEY are chosen
// independently, so a reserved wire (`$tag`, `$ref`, …) can be pinned without
// minting an unregistered key.
const FldW = (wireName: string, set: unknown, keyOf: string) => ({
  $tag: "SetCtorField",
  key: { $tag: "NamedField", ref: { $ref: FLOOR_FIELD_IDS[keyOf] } },
  wireName,
  set,
});
const Arrow = (params: unknown[], returns: unknown) => ({
  $tag: "SeArrow",
  params: params.map((set, i) => ({
    $tag: "SetArrowParam",
    key: { $tag: "PositionalField", index: i },
    wireName: `_${i}`,
    set,
  })),
  returns,
});

// --- the sample operands (data fragment ONLY — no arrows/μ (Phase 3), no
// SeWhere (opaque by design)) ------------------------------------------------
const E1 = En(1, 2);
const E2 = En(2, 3);
const P = Iv(0, 10);
const Q = Iv(5, 15);
const CT1 = Ctor("Pt", [Fld("x", E1), Fld("y", E2)]);
const CT2 = Ctor("Pt", [Fld("x", E1), Fld("y", En(2))]);

// --- invoke the Fenel-bodied law machinery ----------------------------------
const law = (builder: string, args: unknown[]) => dispatchEngineBody(builder, args);
type Verdicts = {
  name: string;
  fwd: Tri;
  bwd: Tri;
  empFwd: Tri;
  empBwd: Tri;
  bySubset: Tri;
  byEmpty: Tri;
};
const verdicts = (claim: unknown): Verdicts =>
  dispatchEngineBodyWithDeciderCtx("engine:floorLawVerdicts", [claim]) as Verdicts;
const subset = (a: unknown, b: unknown): Tri =>
  dispatchEngineBodyWithDeciderCtx("engine:setAlgebraIsSubset", [a, b]) as Tri;
const disjoint = (a: unknown, b: unknown): Tri =>
  dispatchEngineBodyWithDeciderCtx("engine:setAlgebraIsDisjoint", [a, b]) as Tri;
const empty = (a: unknown): Tri =>
  dispatchEngineBodyWithDeciderCtx("engine:setAlgebraDecideEmpty", [a]) as Tri;
const contains = (s: unknown, v: unknown): Tri =>
  dispatchEngineBodyWithDeciderCtx("engine:setAlgebraContains", [s, v]) as Tri;
const normalize = (a: unknown): unknown =>
  dispatchEngineBodyWithDeciderCtx("engine:setAlgebraNormalize", [a]);
// A field whose identity KEY, whose embedded wire, and whose registered CURRENT
// wire are all chosen independently — the only way to build the operands the
// resolved-wire clauses actually discriminate on.
const FldK = (keyId: string, wireName: string, set: unknown) => ({
  $tag: "SetCtorField",
  key: { $tag: "NamedField", ref: { $ref: keyId } },
  wireName,
  set,
});
const Mu = (v: string, body: unknown) => ({ $tag: "SeMu", var: v, body });
const Diff = (l: unknown, r: unknown) => ({ $tag: "SeDiff", left: l, right: r });
const KEY_1 = "51000000-0000-4000-8000-000000000001";
const KEY_2 = "51000000-0000-4000-8000-000000000002";

const Just = (x: unknown) => ({ $tag: "Just", _0: x });
const Nothing = { $tag: "Nothing" };

// Warm the dispatch harness at module scope (registry init ~10s on this box)
// so the first test's 5s default timeout clocks only the test itself.
dispatchEngineBody("noneToEmptyUnion", [NONE]);

// ===========================================================================
// S1 — the derivation witnesses: Layer-1 formers rewritten over Layer 0,
// round-trip laws discharged (proof = inhabitant).
// ===========================================================================
describe("Phase 1 — derivation witnesses (Layer 1 over Layer 0)", () => {
  test("∖ = ∩ ∘ ¬ : diffToFloor rewrites SeDiff to SeIntersect [a, ¬b]", () => {
    expect(dispatchEngineBody("diffToFloor", [D(E1, E2)])).toEqual(I(E1, C(E2)));
  });
  test("floorToDiff ∘ diffToFloor = Just (round-trip)", () => {
    const d = D(E1, E2);
    expect(dispatchEngineBody("floorToDiff", [dispatchEngineBody("diffToFloor", [d])])).toEqual(
      Just(d),
    );
  });
  test("floorToDiff on a non-complement-2nd intersect ⇒ Nothing (partial bwd)", () => {
    expect(dispatchEngineBody("floorToDiff", [I(E1, E2)])).toEqual(Nothing);
  });

  test("De Morgan: intersectToNegUnion rewrites ∩ to ¬(∪¬)", () => {
    expect(dispatchEngineBody("intersectToNegUnion", [I(E1, E2)])).toEqual(U2C(E1, E2));
  });
  test("negUnionToIntersect ∘ intersectToNegUnion = Just (round-trip)", () => {
    const i = I(E1, E2);
    expect(
      dispatchEngineBody("negUnionToIntersect", [dispatchEngineBody("intersectToNegUnion", [i])]),
    ).toEqual(Just(i));
  });
  test("negUnionToIntersect on a plain (uncomplemented) union ⇒ Nothing", () => {
    expect(dispatchEngineBody("negUnionToIntersect", [C(U(E1, E2))])).toEqual(Nothing);
  });

  test("¬¬ involution: elimDoubleComplement (¬¬A) = A", () => {
    expect(dispatchEngineBody("elimDoubleComplement", [C(C(E1))])).toEqual(E1);
  });

  test("enum decomposition: enumToSingletonUnion / singletonUnionToEnum round-trip", () => {
    expect(dispatchEngineBody("enumToSingletonUnion", [E1])).toEqual(U(En(1), En(2)));
    expect(
      dispatchEngineBody("singletonUnionToEnum", [dispatchEngineBody("enumToSingletonUnion", [E1])]),
    ).toEqual(Just(E1));
  });
  test("singletonUnionToEnum on a mixed-former union ⇒ Nothing (partial bwd)", () => {
    expect(dispatchEngineBody("singletonUnionToEnum", [U(En(1), P)])).toEqual(Nothing);
  });

  test("⊥ = ∪∅ and ⊤ = ∩∅ (the nullary-combinator witnesses)", () => {
    expect(dispatchEngineBody("noneToEmptyUnion", [NONE])).toEqual(U());
    expect(dispatchEngineBody("allToEmptyIntersect", [ALL])).toEqual(I());
  });
});
// De Morgan RHS shape helper — ¬(¬a ∪ ¬b).
function U2C(a: unknown, b: unknown) {
  return C(U(C(a), C(b)));
}

// ===========================================================================
// S2 — THE LEDGER. Law × sample × (fwd ⊆, bwd ⊆, empty(lhs∖rhs),
// empty(rhs∖lhs), eq-by-subset, eq-by-emptiness), frozen 2026-07-10.
// JT = theorem instance certified by the substrate; NO = honest fence.
// Six of 24 rows carry ≥1 honest fence after Phase 3c; the residual cells are
// interval splitting, ctor/top-cover, or compound De-Morgan precision limits,
// not a blanket complement-position fence. Non-contradiction, excluded middle,
// the nullary combinators, and the whole complement-free housekeeping fragment
// decide fully. byEmpty ≡ bySubset across the entire grid.
// floor-kernel Phase 3a UPDATE: the a-SeDiff subset arm (A∖B ⊆ C ⟺ A ⊆ B∪C,
// tcb-ledger sub.diff.arm) flipped diff-def (enums) NO→JT in fwd/empFwd/
// bySubset/byEmpty — the row is now FULLY decided (a-side ∖ left the fenced
// set; a-side ¬ remains, 3b/3c). Intervals stay fenced on the interval-split
// incompleteness (prec.sub.some-refute), ctors on the ¬-ctor fringe (8μ.1a).
// floor-kernel Phase 3c: the two landed consumers flip exactly 16 NO→JT cells:
// double-complement enum (4), interval/ctor (2 each), and excluded-middle
// enum/interval (4 each). Six of 24 rows retain a fence (diff/de-Morgan and the
// interval/ctor double-complement reverse directions); the grid still has zero
// JF. The top-cover/subset directions are now kernel-certifiable theorems.
// ===========================================================================
const LEDGER: {
  row: string;
  builder: string;
  args: unknown[];
  expect: [unknown, unknown, unknown, unknown, unknown, unknown]; // fwd bwd empF empB bySub byEmp
}[] = [
  { row: "diff-def (enums)", builder: "lawDiffDef", args: [E1, E2], expect: [JT, JT, JT, JT, JT, JT] },
  { row: "diff-def (intervals)", builder: "lawDiffDef", args: [P, Q], expect: [NO, NO, NO, NO, NO, NO] },
  { row: "diff-def (ctors)", builder: "lawDiffDef", args: [CT1, CT2], expect: [NO, NO, NO, NO, NO, NO] },
  { row: "de-morgan (enums)", builder: "lawDeMorganIntersect", args: [E1, E2], expect: [JT, NO, JT, NO, NO, NO] },
  { row: "de-morgan (intervals)", builder: "lawDeMorganIntersect", args: [P, Q], expect: [NO, NO, NO, NO, NO, NO] },
  { row: "double-complement (enum)", builder: "lawDoubleComplement", args: [E1], expect: [JT, JT, JT, JT, JT, JT] },
  { row: "double-complement (interval)", builder: "lawDoubleComplement", args: [P], expect: [JT, NO, JT, NO, NO, NO] },
  { row: "double-complement (ctor)", builder: "lawDoubleComplement", args: [CT1], expect: [JT, NO, JT, NO, NO, NO] },
  { row: "excluded-middle (enum)", builder: "lawExcludedMiddle", args: [E1], expect: [JT, JT, JT, JT, JT, JT] },
  { row: "excluded-middle (interval)", builder: "lawExcludedMiddle", args: [P], expect: [JT, JT, JT, JT, JT, JT] },
  { row: "non-contradiction (enum)", builder: "lawNonContradiction", args: [E1], expect: [JT, JT, JT, JT, JT, JT] },
  { row: "non-contradiction (interval)", builder: "lawNonContradiction", args: [P], expect: [JT, JT, JT, JT, JT, JT] },
  { row: "non-contradiction (ctor)", builder: "lawNonContradiction", args: [CT1], expect: [JT, JT, JT, JT, JT, JT] },
  { row: "nullary-union (∪∅ = ⊥)", builder: "lawNullaryUnion", args: [0], expect: [JT, JT, JT, JT, JT, JT] },
  { row: "nullary-intersect (∩∅ = ⊤)", builder: "lawNullaryIntersect", args: [0], expect: [JT, JT, JT, JT, JT, JT] },
  { row: "enum-decomposition (numbers)", builder: "lawEnumDecomposition", args: [E1], expect: [JT, JT, JT, JT, JT, JT] },
  { row: "enum-decomposition (strings)", builder: "lawEnumDecomposition", args: [En("a", "b")], expect: [JT, JT, JT, JT, JT, JT] },
  { row: "idempotent-union", builder: "lawIdempotentUnion", args: [E1], expect: [JT, JT, JT, JT, JT, JT] },
  { row: "idempotent-intersect", builder: "lawIdempotentIntersect", args: [E1], expect: [JT, JT, JT, JT, JT, JT] },
  { row: "commutative-union (enums)", builder: "lawCommutativeUnion", args: [E1, E2], expect: [JT, JT, JT, JT, JT, JT] },
  { row: "commutative-intersect (enums)", builder: "lawCommutativeIntersect", args: [E1, E2], expect: [JT, JT, JT, JT, JT, JT] },
  { row: "commutative-union (intervals)", builder: "lawCommutativeUnion", args: [P, Q], expect: [JT, JT, JT, JT, JT, JT] },
  { row: "absorption-union", builder: "lawAbsorbUnion", args: [E1, E2], expect: [JT, JT, JT, JT, JT, JT] },
  { row: "absorption-intersect", builder: "lawAbsorbIntersect", args: [E1, E2], expect: [JT, JT, JT, JT, JT, JT] },
];

describe("Phase 1 — the decided-vs-fenced ledger (drift shows up HERE)", () => {
  for (const { row, builder, args, expect: exp } of LEDGER) {
    test(row, () => {
      const v = verdicts(law(builder, args));
      expect([v.fwd, v.bwd, v.empFwd, v.empBwd, v.bySubset, v.byEmpty]).toEqual(
        exp as [Tri, Tri, Tri, Tri, Tri, Tri],
      );
    });
  }

  test("the claim data is witness-built (lawDiffDef's rhs IS diffToFloor's output)", () => {
    const claim = law("lawDiffDef", [E1, E2]) as { lhs: unknown; rhs: unknown };
    expect(claim.lhs).toEqual(D(E1, E2));
    expect(claim.rhs).toEqual(I(E1, C(E2)));
  });
});

// ===========================================================================
// S3 — the Tri-discipline invariant + the three soundness-fix regression
// pins. A decider must NEVER false-`Just`; before this phase, all four
// pinned cases returned a FALSE verdict.
// ===========================================================================
describe("Phase 1 — no false-Just (the soundness-fix regression pins)", () => {
  // EXPLICIT timeout: this walks the WHOLE ledger grid (144 expect() calls, six
  // Tri cells per law) through the interpreted Fenel deciders. It measured 21.8 s
  // on a slow Windows host BEFORE type-substrate P1(a) and 23.9 s after, so bun's
  // 5 s default was already wrong for it and the phase's judgment fence is not
  // what pushed it over. Keep the bound generous; if it ever approaches this,
  // that IS a perf regression worth investigating.
  test("the whole ledger grid carries ZERO Just false cells", () => {
    for (const { builder, args } of LEDGER) {
      const v = verdicts(law(builder, args));
      for (const cell of [v.fwd, v.bwd, v.empFwd, v.empBwd, v.bySubset, v.byEmpty]) {
        expect(cell).not.toEqual(JF);
      }
    }
  }, 180_000);

  test("Phase 3c consumes fix 1's fence: ⊤ ⊆ (A ∪ ¬A) is now a theorem", () => {
    expect(subset(ALL, U(E1, C(E1)))).toEqual(JT);
  });
  test("fix 1 (subsetAllArm ∩-rule): ⊤ ⊆ ∩[] decides Just true (the nullary meet; was Just false)", () => {
    expect(subset(ALL, I())).toEqual(JT);
  });
  test("fix 2 (subsetEnumArm): {v,w} ⊆ {v} ∪ {w} decides Just true (the splitting enum; was Just false)", () => {
    expect(subset(En(1, 2), U(En(1), En(2)))).toEqual(JT);
  });
  test("fix 2 keeps exact refutations: {5} ⊆ {1} ∪ {2} is Just false (a genuine escapee)", () => {
    expect(subset(En(5), U(En(1), En(2)))).toEqual(JF);
  });
  test("fix 3 (subsetSome): the interval split [0,10] ⊆ [0,5] ∪ [5,10] fences, never refutes (was Just false)", () => {
    expect(subset(Iv(0, 10), U(Iv(0, 5), Iv(5, 10)))).toEqual(NO);
  });
});

// ===========================================================================
// S4 — the kernel face (the stretch task): representative DECIDED laws
// re-checked by the trusted kernel. verify() re-runs the trio on the claim
// shape and grades SolverChecked — the substrate certifying its own algebra.
// ===========================================================================
describe("Phase 1 — kernel re-check of decided law instances (SolverChecked)", () => {
  const solverChecked = (prop: Proposition, proof: Parameters<typeof verify>[1]) => {
    const result = verify(prop, proof);
    expect(result.$tag).toBe("Ok");
    if (result.$tag === "Ok") expect(result._0.$tag).toBe("SolverChecked");
  };

  test("non-contradiction as a kernel-certified subset theorem: (A ∩ ¬A) ⊆ ∅", () => {
    const s = I(E1, C(E1)) as unknown as SetExpr;
    const t = NONE as unknown as SetExpr;
    solverChecked(
      { $tag: "PropSubset", s, t } as Proposition,
      decidableSetProof("subset", { left: s, right: t }),
    );
  });

  test("non-contradiction as a kernel-certified emptiness theorem: (A ∩ ¬A) = ∅", () => {
    const s = I(E1, C(E1)) as unknown as SetExpr;
    solverChecked(
      { $tag: "PropEmpty", s } as Proposition,
      decidableSetProof("empty", { left: s }),
    );
  });

  test("De Morgan (fwd) as a kernel-certified subset theorem: (A ∩ B) ⊆ ¬(¬A ∪ ¬B)", () => {
    const s = I(E1, E2) as unknown as SetExpr;
    const t = U2C(E1, E2) as unknown as SetExpr;
    solverChecked(
      { $tag: "PropSubset", s, t } as Proposition,
      decidableSetProof("subset", { left: s, right: t }),
    );
  });

  test("the ∖-definition (bwd) as a kernel-certified subset theorem: (A ∩ ¬B) ⊆ (A ∖ B)", () => {
    const s = I(E1, C(E2)) as unknown as SetExpr;
    const t = D(E1, E2) as unknown as SetExpr;
    solverChecked(
      { $tag: "PropSubset", s, t } as Proposition,
      decidableSetProof("subset", { left: s, right: t }),
    );
  });

  test("Phase 3c: excluded-middle top-cover is kernel-certified", () => {
    const s = ALL as unknown as SetExpr;
    const t = U(E1, C(E1)) as unknown as SetExpr;
    solverChecked(
      { $tag: "PropSubset", s, t } as Proposition,
      decidableSetProof("subset", { left: s, right: t }),
    );
  });
});

// ===========================================================================
// S5 — the SeCtor cross-ctor cells, REPAIRED: decided-or-fenced
// (type-substrate P1(a)). The `""` cells are CANONICAL-reachable — `$record`
// projects to `SeCtor ""` — and the width cells are the noncanonical fringe.
// A definite cell is a certified verdict; a `Nothing` cell is an honest
// fence. Each test names its HEAD value so a partial revert is visible.
// ===========================================================================
describe("Phase 1 — SeCtor cross-ctor cells (repaired: decided or fenced)", () => {
  const tagOnly = Ctor("Pt", []);
  const fieldOnly = Ctor("", [Fld("x", E1), Fld("y", E2)]);

  test("canonical-domain facts hold: same-ctor fieldwise subset decides", () => {
    // Same key set on both sides ⇒ want-side iteration is byte-stable here.
    expect(subset(CT2, CT1)).toEqual(JT);
  });
  test("the ∩-of-degenerate-forms now FENCES (was Just true, defect-derived)", () => {
    // ⚠ THIS CELL NEEDS **BOTH** REPAIRS. The HEAD `Just true` had two
    // independent defective routes: (a) the ∃-branch through the have-side
    // fieldwise walk (`tagOnly ⊆ CT1` vacuously proved), and (b) a
    // `norm.intersect.pair-disjoint` collapse to SeNone, because
    // `dis(tagOnly, fieldOnly)` falsely answered Just true on the
    // `""`-vs-named leg. A partial revert can green this cell FOR THE WRONG
    // REASON — re-derive both routes before trusting it.
    expect(subset(I(tagOnly, fieldOnly), CT1)).toEqual(NO);
  });
  test("fwd inclusion now PROVES (was Just false — a false refutation)", () => {
    // `sub.tail.intersect-every`: CT1 ⊆ tagOnly is the same-tag want-`[]`
    // case ⇒ JT, and CT1 ⊆ fieldOnly is the `""`-want fieldwise case ⇒ JT.
    // Membership is `""`-agnostic, so the `""` want constrains fields only;
    // the old distinct-tag refutation was simply wrong here.
    expect(subset(CT1, I(tagOnly, fieldOnly))).toEqual(JT);
  });
  test("tag-only ⊆ field-constrained same-ctor now FENCES (was a false Just true)", () => {
    // `Pt{} ⊆ Pt{x:{1}}` is FALSE under the open reading. Want-side
    // iteration finds the want key absent on the have side and abstains —
    // the Se face has no "members lack this key" fact to refute with.
    expect(subset(tagOnly, Ctor("Pt", [Fld("x", En(1))]))).toEqual(NO);
  });

  // ---- path #4: `""` is not a distinct TAG for the disjointness face -----
  test("`\"\"`-vs-named disjointness now decides by FIELDS (was a false Just true)", () => {
    // `{$tag:"P", x:1}` inhabits BOTH, so they are NOT disjoint.
    expect(disjoint(Ctor("", [Fld("x", En(1))]), Ctor("P", [Fld("x", En(1))]))).toEqual(JF);
    // ...and the genuine shared-pair-disjoint proof still fires.
    expect(disjoint(Ctor("", [Fld("x", En(1))]), Ctor("P", [Fld("x", En(2))]))).toEqual(JT);
  });
  test("both-named distinct ctors keep the genuine tag-distinctness theorem", () => {
    expect(disjoint(Ctor("P", []), Ctor("Q", []))).toEqual(JT);
  });

  // ---- path #5: the all-overlap terminal never saw b-only keys ------------
  test("width-asymmetric overlap now FENCES (was a false Just false)", () => {
    // b carries a b-only ∅ field ⇒ b is EMPTY ⇒ they ARE disjoint, so the
    // HEAD `Just false` ("they overlap") was a false definite verdict.
    expect(
      disjoint(Ctor("P", [Fld("x", En(1))]), Ctor("P", [Fld("x", En(1)), Fld("y", NONE)])),
    ).toEqual(NO);
  });

  // ---- path #6: the 8λ.1 value-sort axiom, RETIRED AS FALSE ---------------
  test("SeArrow ⊥ SeCtor is retired: BOTH `\"\"` and NAMED ctors fence", () => {
    // `mem.ctor` accepts any `$tag`-matching record (open membership) and
    // `mem.arrow` classifies by callable-KEY PRESENCE, so `{$tag:"P",$ref:f}`
    // inhabits both sorts — the old unconditional Just true let the kernel
    // grade JEmpty AND JInhabited on the same intersection.
    expect(disjoint(Arrow([], E1), Ctor("", []))).toEqual(NO); // was JT, false
    expect(disjoint(Arrow([], E1), Ctor("P", []))).toEqual(NO); // was JT, false
  });
  test("...but the emptiness fragment (∅ ⊥ X) survives, both polarities", () => {
    expect(disjoint(Arrow([], E1), Ctor("P", [Fld("x", NONE)]))).toEqual(JT);
    expect(disjoint(Arrow([E1], NONE), Ctor("P", []))).toEqual(JT);
  });
  test("the arrow-ctor COHERENCE TRIO: mem decides what dis may no longer deny", () => {
    // The three faces must agree on one operand pair. Before the repair,
    // emp said "empty" while mem said "inhabited" — a TCB contradiction.
    expect(empty(I(Arrow([], E1), Ctor("P", [])))).toEqual(NO); // was JT, false
    expect(empty(I(Arrow([], E1), Ctor("", [])))).toEqual(NO); // was JT, false
  });

  // ---- the emptiness ripple of path #4 ------------------------------------
  test("the `\"\"`-record ∩ named-case emptiness collapse is gone", () => {
    expect(
      empty(I(Ctor("", [Fld("x", En(1))]), Ctor("P", [Fld("x", En(1))]))),
    ).toEqual(NO); // was JT, false
  });

  // ---- the §2.5 judgment fence (reserved wires + resolved-wire injectivity)
  test("a reserved resolved wire fences every STRUCTURAL SeCtor face together", () => {
    // `$tag` is an admissible field WIRE at the slot validator — nothing
    // reserves it — so `SeCtor("", [K@$tag:{"P"}])` would denote exactly the
    // P-tagged values, falsifying the `ac=""`-vs-named refutation this phase
    // KEEPS; and `emp(SeCtor("P",[K@$tag:{"Q"}]))` claimed NONEMPTY for an
    // empty set. Fenced, so mem/emp/dis/sub cannot disagree.
    const tagWire = Ctor("", [FldW("$tag", En("P"), "x")]);
    expect(subset(tagWire, Ctor("P", []))).toEqual(NO); // NOT the HEAD JF
    expect(empty(Ctor("P", [FldW("$tag", En("Q"), "x")]))).toEqual(NO); // was JF
    expect(contains(Ctor("P", [FldW("$tag", En("Q"), "x")]), { $tag: "P" })).toEqual(NO);
    expect(
      disjoint(Ctor("P", [FldW("$ref", En("f"), "x")]), Ctor("P", [Fld("x", En(1))])),
    ).toEqual(NO);
  });

  // ---- the kept legs, as regressions --------------------------------------
  test("kept: `\"\"`-have vs named-want still refutes (now a theorem ON the fence)", () => {
    // Valid ONLY because the fence excludes a `$tag` field wire: with it
    // excluded, a's field product is tag-independent, so an inhabited a
    // admits a member carrying any tag ∉ {bc}.
    expect(subset(fieldOnly, CT1)).toEqual(JF);
  });
  test("precision GAIN: have-only keys no longer force Nothing", () => {
    // `Pt{x,y} ⊆ Pt{x}` now proves — an extra have constraint only shrinks a.
    expect(subset(CT1, Ctor("Pt", [Fld("x", E1)]))).toEqual(JT);
  });
  test("reflexivity is preserved (identical fields resolve identically)", () => {
    expect(subset(CT1, CT1)).toEqual(JT);
  });

  // ---- the three DISCRIMINATING pins (result-review round 1) --------------
  // Both reviewers observed that the repairs above were regression-locked only
  // for the RESERVED-wire clause: reverting resolved-wire injectivity, the
  // wire-aware equality walk, or the ∃-leg wire guard left every other cell in
  // this file green. Each test below fails on exactly one reverted clause.

  test("DISCRIMINATES resolved-wire INJECTIVITY: two keys on one host property", () => {
    // The shared slot validator dedups the EMBEDDED wireName ("oldA" != "oldB")
    // and passes. But both keys RESOLVE to `x`, so membership demands
    // `v.x ∈ {1}` AND `v.x ∈ {2}` — the set is EMPTY. Without injectivity the
    // product rule sees two nonempty factors and answers Just false
    // ("nonempty"), which the kernel can certify as JInhabited with NO witness
    // at all, through the decideEmpty delegate. Same root for dis(R,R): the
    // all-overlap terminal says "they overlap" while ∅ ⊥ ∅ is true.
    __registerFieldCurrentWireFixtureForTests(KEY_1, "x");
    __registerFieldCurrentWireFixtureForTests(KEY_2, "x");
    try {
      const R = Ctor("P", [FldK(KEY_1, "oldA", En(1)), FldK(KEY_2, "oldB", En(2))]);
      expect(empty(R)).toEqual(NO); // reverting injectivity ⇒ JF, a false "nonempty"
      expect(disjoint(R, R)).toEqual(NO); // reverting injectivity ⇒ JF, a false "overlap"
    } finally {
      __clearFieldCurrentWireFixturesForTests();
    }
  });

  test("DISCRIMINATES the wire-aware setSemanticEq walk: the μ shortcut sits ABOVE the loops", () => {
    // Registry-UNKNOWN key, divergent embedded hints ⇒ A reads host `x` and B
    // reads host `y`. `{$tag:"P", x:1}` is in A and not in B, so A ⊄ B and
    // A ∖ B is nonempty. The public SeCtor-vs-SeCtor route never reaches
    // setSemanticEq (subsetCtorArm intercepts), which is why the fieldwise
    // guard alone does NOT pin this: setAlgebraMuSubset opens with the equality
    // shortcut, and setAlgebraNormDiffMain collapses the difference by the same
    // predicate. Reverting only setSemanticCtorFieldsEqGo ⇒ JT here and SeNone
    // below, both false.
    const A = Ctor("P", [FldK(KEY_1, "x", En(1))]);
    const B = Ctor("P", [FldK(KEY_1, "y", En(1))]);
    expect(contains(A, { $tag: "P", x: 1 })).toEqual(JT); // the counterexample, first
    expect(contains(B, { $tag: "P", x: 1 })).toEqual(JF);
    expect(subset(Mu("X", A), Mu("X", B))).toEqual(NO);
    expect(normalize(Diff(A, B))).not.toEqual(NONE);
  });

  test("DISCRIMINATES the ∃ disjointness wire guard: divergent wires are not one coordinate", () => {
    // A constrains host `before`, B constrains host `after`; `{before:1, after:2}`
    // inhabits BOTH, so they are NOT disjoint. Without the guard the aligned
    // pair looks like one coordinate, `{1} ⊥ {2}` fires, and the ∃ leg answers
    // Just true — a false definite verdict. The existing set-marker rename cell
    // cannot catch this: its two fields carry the SAME set, so the ∃ leg never
    // fires there either way.
    const A = Ctor("", [FldK(KEY_1, "before", En(1))]);
    const B = Ctor("", [FldK(KEY_1, "after", En(2))]);
    expect(contains(A, { before: 1, after: 2 })).toEqual(JT);
    expect(contains(B, { before: 1, after: 2 })).toEqual(JT);
    expect(disjoint(A, B)).toEqual(NO); // reverting the guard ⇒ JT, a false "disjoint"
  });
});
