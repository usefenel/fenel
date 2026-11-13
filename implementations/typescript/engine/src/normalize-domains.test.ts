// decide-substrate Phase 7 — NORMALIZATION + typed DOMAINS + the negated-order
// CERTIFICATE, over the PE-substrate Phase-3 branching faces (brief:
// `workstreams/decide-substrate/briefs/phase-7-normalize-domains.md`; design:
// `design/partial-evaluation.md` §5 + `design/symbolic-execution.md` 14c).
//
// Three widenings riding satSymbolicPaths / solveSymbolicPaths (widened IN
// PLACE; the dispatch wrappers keep their public shape):
//   1. PE-AS-NORMALIZER — `normalizeForDecide` runs before gate/mint/fork:
//      const-folds (`(2+3)*read k == 10` ⇒ affine ⇒ Just 2), dead-branch
//      pre-prune, whole-concrete collapse (fold-to-false ⇒ Just false via
//      forkResidualFalse; fold-to-true ⇒ Nothing, never Just true).
//   2. TYPED DOMAINS (14c) — a per-read domain from a scoped SymbolicDomain
//      instance (wins) or the method-return-type→typeToSetExpr; the WITNESS
//      face intersects (enum domain makes an interval-only pred witnessable:
//      `read k > 2` @ SeEnum [1,2,3] ⇒ Just 3), the REFUTATION face injects
//      numeric BOUNDS ATOMS (type-driven refutation, zero IO: `read k : [1,3]
//      ∧ read k > 5` ⇒ Just false).
//   3. The negated-order CERTIFICATE — both operands certified numeric ⇒
//      `¬(a≤b) ⇒ b<a` exact (closes the fork driver's flagged abstention).

import { describe, it, expect } from "vitest";
import {
  dispatchedSatSymbolicPaths,
  dispatchedSolveSymbolicPaths,
  dispatchedSatSymbolicPathsDom,
  dispatchedSolveSymbolicPathsDom,
  dispatchedSatSymbolicPathsScoped,
  dispatchedSolveSymbolicPathsScoped,
  dispatchedForkPaths,
} from "./engine-bodies-dispatch";
import { dispatchRegistry } from "./system-entities";
import { accountDispatchFrame } from "./authority-test-support";

// --- tiny Expr / Pattern builders (plain $tag-tagged objects) ------------
const EVar = (name: string) => ({ $tag: "EVar", name });
const ELit = (value: unknown) => ({ $tag: "ELit", value });
const ECall = (fnId: string, args: unknown[]) => ({ $tag: "ECall", fnId, args });
const EConstruct = (ctor: string, args: unknown[] = []) => ({ $tag: "EConstruct", ctor, args });
const EMatch = (scrutinee: unknown, arms: unknown[]) => ({ $tag: "EMatch", scrutinee, arms });
const PatVar = (name: string) => ({ $tag: "PatVar", name });
const PatConstruct = (ctor: string, args: unknown[] = []) => ({ $tag: "PatConstruct", ctor, args });

type MaybeV = { $tag: string; _0?: unknown };

const GET = "$effect:HasStateIO:getInstance";
const SET = "$effect:HasStateIO:setInstance"; // a WRITE method (not in `reads`)
const read = (k: string) => ECall(GET, [ELit(k)]);
const write = (k: string) => ECall(SET, [ELit(k)]);
const specHS = [{ effectClass: "HasStateIO", reads: ["getInstance"] }];
const JUST_FALSE = { $tag: "Just", _0: false };

// --- canonical Se* domains (the wire shape: Maybe { value, inclusive }) ---
const SeEnum = (values: unknown[]) => ({ $tag: "SeEnum", values });
const Just = (x: unknown) => ({ $tag: "Just", _0: x });
const Nothing = { $tag: "Nothing" };
const SeInterval = (lo: unknown, hi: unknown) => ({
  $tag: "SeInterval",
  interval: { $tag: "SetInterval", lo, hi },
});
const bound = (value: number, inclusive: boolean) => ({ value, inclusive });

const enum123 = SeEnum([1, 2, 3]);
const domEnum = [{ typeName: "HasStateIO", methodName: "getInstance", domain: enum123 }];
// [0, ∞) — lo=0 inclusive, hi unbounded
const iv0inf = SeInterval(Just(bound(0, true)), Nothing);
const domIv = [{ typeName: "HasStateIO", methodName: "getInstance", domain: iv0inf }];

// ---------------------------------------------------------------------------
// §1 — PE-AS-NORMALIZER
// ---------------------------------------------------------------------------

describe("normalizeForDecide — the PE normalizer front", () => {
  it("const-fold through the mint: eq (mul (add 2 3) (read k)) 10 ⇒ Just 2", () => {
    // (2+3)*r == 10 ⇒ 5*r == 10 ⇒ the P12 affine inversion witnesses 2.
    const prog = ECall("eq", [ECall("mul", [ECall("add", [ELit(2), ELit(3)]), read("k")]), ELit(10)]);
    expect(dispatchedSolveSymbolicPaths(specHS, prog)).toEqual({ $tag: "Just", _0: 2 });
  });

  it("dead-then FOLD + else-False: if (2+3==6) then (read k==1) else False ⇒ Just false", () => {
    // the then-arm's cond folds false (5≠6) ⇒ the arm is pruned before forking;
    // the else `False` folds to a constant-false residual ⇒ forkResidualFalse.
    const prog = ECall("if", [
      ECall("eq", [ECall("add", [ELit(2), ELit(3)]), ELit(6)]),
      ECall("eq", [read("k"), ELit(1)]),
      EConstruct("False"),
    ]);
    expect(dispatchedSatSymbolicPaths(specHS, prog)).toEqual(JUST_FALSE);
  });

  it("whole-concrete fold-to-TRUE ⇒ Nothing (never Just true)", () => {
    const prog = ECall("eq", [ECall("add", [ELit(2), ELit(3)]), ELit(5)]); // 5==5 ⇒ true
    expect((dispatchedSatSymbolicPaths(specHS, prog) as MaybeV).$tag).toBe("Nothing");
  });

  it("whole-concrete fold-to-FALSE ⇒ Just false", () => {
    const prog = ECall("eq", [ECall("add", [ELit(2), ELit(3)]), ELit(6)]); // 5==6 ⇒ false
    expect(dispatchedSatSymbolicPaths(specHS, prog)).toEqual(JUST_FALSE);
  });
});

// ---------------------------------------------------------------------------
// §2 — TYPED DOMAINS (explicit-arg core)
// ---------------------------------------------------------------------------

describe("typed domains — the witness intersect + the refutation bounds atoms", () => {
  it("enum witness: read k > 2 @ SeEnum [1,2,3] ⇒ Just 3 (interval-only pred, enum domain)", () => {
    const prog = ECall("gt", [read("k"), ELit(2)]);
    expect(dispatchedSolveSymbolicPathsDom(specHS, prog, domEnum, [])).toEqual({ $tag: "Just", _0: 3 });
  });

  it("bounds refutation: read k > 5 @ SeEnum [1,2,3] ⇒ Just false (min/max atoms, zero IO)", () => {
    const prog = ECall("gt", [read("k"), ELit(5)]);
    expect(dispatchedSatSymbolicPathsDom(specHS, prog, domEnum, [])).toEqual(JUST_FALSE);
  });

  it("interval-domain native-order fence: read k ≤ -1 @ SeInterval [0, ∞) abstains", () => {
    const prog = ECall("lte", [read("k"), ELit(-1)]);
    expect(dispatchedSatSymbolicPathsDom(specHS, prog, domIv, [])).toEqual(Nothing);
  });

  it("SeAll domain ⇒ NO atoms, verdict unchanged (a satisfiable pred stays Nothing)", () => {
    const domAll = [{ typeName: "HasStateIO", methodName: "getInstance", returnType: { tag: "TmAll" } }];
    const prog = ECall("gt", [read("k"), ELit(5)]); // satisfiable (6,7,…) with no domain
    expect((dispatchedSatSymbolicPathsDom(specHS, prog, [], domAll) as MaybeV).$tag).toBe("Nothing");
  });

  it("non-numeric enum domain ⇒ NO atoms (honest; a string enum contributes nothing)", () => {
    const domStr = [{ typeName: "HasStateIO", methodName: "getInstance", domain: SeEnum(["a", "b"]) }];
    const prog = ECall("gt", [read("k"), ELit(5)]);
    expect((dispatchedSatSymbolicPathsDom(specHS, prog, domStr, []) as MaybeV).$tag).toBe("Nothing");
  });
});

// ---------------------------------------------------------------------------
// §3 — TYPE-DERIVED domains (method return type → typeToSetExpr)
// ---------------------------------------------------------------------------

describe("type-derived domains — the return-type TypeMarker path", () => {
  // A TmRefined over a $all base carries its refinement SET raw (typeRefinedToSet:
  // base $all ⇒ tm.set), so a numeric-enum refinement projects to that bare set.
  const domTypesEnum = [
    { typeName: "HasStateIO", methodName: "getInstance", returnType: { tag: "TmRefined", base: { tag: "TmAll" }, set: enum123 } },
  ];

  it("type-derived bounds refutation: read k > 5 (return type ⊨ {1,2,3}) ⇒ Just false", () => {
    const prog = ECall("gt", [read("k"), ELit(5)]);
    expect(dispatchedSatSymbolicPathsDom(specHS, prog, [], domTypesEnum)).toEqual(JUST_FALSE);
  });

  it("type-derived witness: read k > 2 (return type ⊨ {1,2,3}) ⇒ Just 3", () => {
    const prog = ECall("gt", [read("k"), ELit(2)]);
    expect(dispatchedSolveSymbolicPathsDom(specHS, prog, [], domTypesEnum)).toEqual({ $tag: "Just", _0: 3 });
  });

  it("explicit SymbolicDomain instance WINS over the return type", () => {
    // domInsts enum [1,2,3] refutes read k > 5; a SeAll return type alone would not.
    const domAll = [{ typeName: "HasStateIO", methodName: "getInstance", returnType: { tag: "TmAll" } }];
    const prog = ECall("gt", [read("k"), ELit(5)]);
    expect(dispatchedSatSymbolicPathsDom(specHS, prog, domEnum, domAll)).toEqual(JUST_FALSE);
  });
});

// ---------------------------------------------------------------------------
// §4 — the negated-order CERTIFICATE
// ---------------------------------------------------------------------------

describe("negated-order certificate — ¬(a≤b) ⇒ b<a, both-numeric only", () => {
  // if (read k ≤ 5) then False else (read k ≤ 4): the then dies by False; the
  // else carries the CERTIFIED flip 5 < read k, which ∧ read k ≤ 4 refutes.
  const certProg = ECall("if", [
    ECall("lte", [read("k"), ELit(5)]),
    EConstruct("False"),
    ECall("lte", [read("k"), ELit(4)]),
  ]);

  it("HEADLINE: certified numeric domain ⇒ Just false (both paths die)", () => {
    expect(dispatchedSatSymbolicPathsDom(specHS, certProg, domEnum, [])).toEqual(JUST_FALSE);
  });

  it("the SAME pred with NO domain ⇒ Nothing (no over-certification; the else-flip is absent)", () => {
    expect((dispatchedSatSymbolicPaths(specHS, certProg) as MaybeV).$tag).toBe("Nothing");
  });

  it("a bare interval cannot certify a native Number carrier", () => {
    expect(dispatchedSatSymbolicPathsDom(specHS, certProg, domIv, [])).toEqual(Nothing);
  });

  it("does not prune an else branch witnessed by an admitted exact integer record", () => {
    // Nat 0 belongs to [0,1], while scalar lte(record,5) is false. The interval
    // supplies neither native-order bounds nor the negation certificate.
    const domain = [{ typeName: "HasStateIO", methodName: "getInstance", domain: SeInterval(Just(bound(0, true)), Just(bound(1, true))) }];
    const prog = ECall("if", [ECall("lte", [read("k"), ELit(5)]), EConstruct("False"), EConstruct("True")]);
    expect(dispatchedSatSymbolicPathsDom(specHS, prog, domain, [])).toEqual(Nothing);
  });

  it("the Phase-3 'negated ORDER contributes no atom' row stays green (raw forkPaths, uncertified EVars)", () => {
    // dispatchedForkPaths does NOT normalize + does NOT seed certs ⇒ the else-world
    // of if (a<=b) records ¬(a<=b) as opaque, NO atom (the Phase-3 verbatim row).
    type ForkOut = {
      paths: Array<{ atoms: { ltes: unknown[]; lts: unknown[] }; opaque: unknown[]; residual: any }>;
    };
    const prog = ECall("if", [ECall("lte", [EVar("a"), EVar("b")]), ELit("A"), ELit("B")]);
    const out = dispatchedForkPaths(prog, 64) as ForkOut;
    const elseP = out.paths.find((p) => p.residual.value === "B")!;
    expect(elseP.atoms.ltes).toEqual([]);
    expect(elseP.atoms.lts).toEqual([]);
    expect(elseP.opaque.length).toBe(1);
  });
});

// ---------------------------------------------------------------------------
// §5 — SCOPED (a SymbolicDomain instance via dispatchRegistry.addInstance)
// ---------------------------------------------------------------------------


// rights R3a — the ownership coordinate. A test can no longer plant a GLOBAL row
// in the shared registry and take it back out: `removeInstance` is owner-scoped,
// and the `Symbolic*` rosters are fenced to the repository for a ctx that
// derives no account. So the fixture rows are OWNED by a fixture account and the
// scoped calls run under that account's frame — which also makes the test say
// something stronger than it used to (the roster is selected by ownership).
const R3A_ACCOUNT = "r3a-symbolic-fixture-account";

describe("scoped domains — an OWNED SymbolicDomain instance is resolved under its account", () => {
  it("an owned SymbolicDomain instance drives the witness + refutation", () => {
    const frame = accountDispatchFrame(R3A_ACCOUNT) as never;
    dispatchRegistry.addInstance({
      typeName: "Symbolic",
      args: ["HasStateIO"],
      methods: { reads: ["getInstance"] },
      scope: { kind: "account", accountId: R3A_ACCOUNT },
    });
    dispatchRegistry.addInstance({
      typeName: "SymbolicDomain",
      args: ["HasStateIO"],
      methods: { domains: [{ methodName: "getInstance", domain: enum123 }] },
      scope: { kind: "account", accountId: R3A_ACCOUNT },
    });
    try {
      // interval-only pred witnessable under the scoped enum domain
      expect(dispatchedSolveSymbolicPathsScoped(ECall("gt", [read("k"), ELit(2)]), frame)).toEqual({ $tag: "Just", _0: 3 });
      // bounds refutation from the scoped enum domain
      expect(dispatchedSatSymbolicPathsScoped(ECall("gt", [read("k"), ELit(5)]), frame)).toEqual(JUST_FALSE);
    } finally {
      // rights R3a — owner-scoped removal; see the ownership note at the top.
      dispatchRegistry.removeInstance("SymbolicDomain", "HasStateIO", R3A_ACCOUNT);
      dispatchRegistry.removeInstance("Symbolic", "HasStateIO", R3A_ACCOUNT);
    }
    // removed ⇒ no domain ⇒ the interval-only pred no longer witnesses (per-site mint ⇒ Nothing without spec).
    expect((dispatchedSolveSymbolicPathsScoped(ECall("gt", [read("k"), ELit(2)]), frame) as MaybeV).$tag).toBe("Nothing");
  });
});

// ---------------------------------------------------------------------------
// §6 — HONESTY (verbatim — the Phase-3 fences hold through the widening)
// ---------------------------------------------------------------------------

describe("honesty — the widening never over-certifies", () => {
  it("a WRITE site anywhere ⇒ Nothing (the lawful gate, unchanged)", () => {
    const prog = ECall("if", [ECall("eq", [read("k"), ELit(1)]), ECall("eq", [write("k"), ELit(2)]), EConstruct("False")]);
    expect((dispatchedSatSymbolicPathsDom(specHS, prog, domEnum, []) as MaybeV).$tag).toBe("Nothing");
  });

  it("an unmodeled class ⇒ Nothing (empty spec ⇒ gate fails)", () => {
    const prog = ECall("gt", [read("k"), ELit(5)]);
    expect((dispatchedSatSymbolicPathsDom([], prog, domEnum, []) as MaybeV).$tag).toBe("Nothing");
  });

  it("budget overflow ⇒ Nothing (completeness guard — even with domains)", () => {
    let counter = 0;
    const leaf = ECall("eq", [ELit(1), ELit(2)]);
    const build = (depth: number): unknown =>
      depth === 0
        ? leaf
        : ECall("if", [ECall("gt", [EVar("x" + counter++), ELit(0)]), build(depth - 1), build(depth - 1)]);
    const prog = build(7); // 2^7 = 128 leaves > 64
    expect((dispatchedSatSymbolicPaths([], prog) as MaybeV).$tag).toBe("Nothing");
  });

  it("a guarded match is FENCED ⇒ Nothing (no false refutation)", () => {
    const prog = EMatch(read("k"), [
      {
        pattern: PatConstruct("Just", [PatVar("v")]),
        guard: ECall("eq", [EVar("v"), ELit(1)]),
        body: ECall("eq", [read("k"), EConstruct("Nothing")]),
      },
    ]);
    expect((dispatchedSatSymbolicPathsDom(specHS, prog, domEnum, []) as MaybeV).$tag).toBe("Nothing");
  });

  it("the match distinctness headline survives normalization: case read k of Just v -> read k == Nothing ⇒ Just false", () => {
    // normalize folds `Nothing` to an ELit tagged record; the 6D lit-vs-ctor
    // distinctness rule refutes it against the arm's Just assumption.
    const prog = EMatch(read("k"), [
      { pattern: PatConstruct("Just", [PatVar("v")]), body: ECall("eq", [read("k"), EConstruct("Nothing")]) },
    ]);
    expect(dispatchedSatSymbolicPaths(specHS, prog)).toEqual(JUST_FALSE);
  });
});
