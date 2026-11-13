// partial-evaluator-substrate Phase 3 — conformance tests for the FORK DRIVER
// (path-sensitive symbolic execution; brief:
// `workstreams/partial-evaluator-substrate/briefs/phase-3-fork-driver.md`;
// design: `design/partial-evaluation.md` §5 + `design/symbolic-execution.md`).
//
// The fork driver walks a (post-PE, post-mint) residual `Expr`, forking the
// world at each residual branch (`if`/`?:` per chain link, forkable `EMatch`
// per arm) under a threaded PATH CONDITION, pruning refuted prefixes. It lifts
// the symbolize.fenel D-B branching fence:
//   • REFUTATION (`satSymbolicPaths`) — `if (read k==1) then (read k==2) else
//     False` now refutes (both paths die), where `satSymbolic` abstains; the
//     match headline `case read k of Just v -> (read k == Nothing)` refutes by
//     6D datatype distinctness; injectivity refutes through the fork.
//   • WITNESS (`solveSymbolicPaths`) — an equality-guarded branch witnesses via
//     the mint-shared read. Native numeric ordering stays an undecided residual
//     without a carrier/domain proof (the pre-existing 0771aa42 fence).
// Honesty: budget overflow / a write / an unmodeled class / a guarded match all
// degrade to Nothing; a negated ORDER condition contributes NO atom (the
// else-path must not assume `b < a`); never `Just true`.

import { describe, it, expect } from "vitest";
import {
  dispatchedForkPaths,
  dispatchedSatSymbolicPaths,
  dispatchedSolveSymbolicPaths,
  dispatchedSatSymbolic,
} from "./engine-bodies-dispatch";

// --- tiny Expr / Pattern builders (plain $tag-tagged objects) ------------
const EVar = (name: string) => ({ $tag: "EVar", name });
const ELit = (value: unknown) => ({ $tag: "ELit", value });
const ECall = (fnId: string, args: unknown[]) => ({ $tag: "ECall", fnId, args });
const EConstruct = (ctor: string, args: unknown[] = []) => ({ $tag: "EConstruct", ctor, args });
const EMatch = (scrutinee: unknown, arms: unknown[]) => ({ $tag: "EMatch", scrutinee, arms });
const PatVar = (name: string) => ({ $tag: "PatVar", name });
const PatConstruct = (ctor: string, args: unknown[] = []) => ({ $tag: "PatConstruct", ctor, args });
const PatLit = (value: unknown) => ({ $tag: "PatLit", value });
const PatWildcard = { $tag: "PatWildcard" };

type MaybeV = { $tag: string; _0?: unknown };
type ForkOut = {
  paths: Array<{ atoms: { eqs: unknown[]; neqs: unknown[]; ltes: unknown[]; lts: unknown[] }; opaque: unknown[]; residual: any; shadowable: boolean }>;
  complete: boolean;
};

const GET = "$effect:HasStateIO:getInstance";
const SET = "$effect:HasStateIO:setInstance"; // a WRITE method (not in `reads`)
const read = (k: string) => ECall(GET, [ELit(k)]);
const write = (k: string) => ECall(SET, [ELit(k)]);
const specHS = [{ effectClass: "HasStateIO", reads: ["getInstance"] }];

const JUST_FALSE = { $tag: "Just", _0: false };

// ---------------------------------------------------------------------------
// §1 — forkPaths: dead-branch pruning + the path-condition shape
// ---------------------------------------------------------------------------

describe("forkPaths — eager dead-branch pruning", () => {
  it("dead branch: if (read k==1 ∧ read k==2) then A else B ⇒ the then-path is PRUNED", () => {
    const A = ELit("A"), B = ELit("B");
    const cond = ECall("and", [ECall("eq", [read("k"), ELit(1)]), ECall("eq", [read("k"), ELit(2)])]);
    const out = dispatchedForkPaths(ECall("if", [cond, A, B]), 64) as ForkOut;
    expect(out.complete).toBe(true);
    expect(out.paths.length).toBe(1); // the then-world died on the EUF lit-conflict
    expect(out.paths[0]!.residual).toEqual(B); // only the else survives
  });

  it("a non-branch top-level expr is a single leaf (residual = the whole expr, empty atoms)", () => {
    const prog = ECall("eq", [read("k"), ELit(1)]);
    const out = dispatchedForkPaths(prog, 64) as ForkOut;
    expect(out.paths.length).toBe(1);
    expect(out.paths[0]!.residual).toEqual(prog);
    expect(out.paths[0]!.atoms.eqs).toEqual([]); // conditions live in atoms, not the leaf
  });

  it("negated ORDER contributes NO atom — the else-path of if (a<=b) must NOT assume b<a", () => {
    const prog = ECall("if", [ECall("lte", [EVar("a"), EVar("b")]), ELit("A"), ELit("B")]);
    const out = dispatchedForkPaths(prog, 64) as ForkOut;
    const thenP = out.paths.find((p) => p.residual.value === "A")!;
    const elseP = out.paths.find((p) => p.residual.value === "B")!;
    expect(thenP.atoms.ltes.length).toBe(1); // a <= b
    // the else-world: ¬(a<=b) is OPAQUE (same-type ⟺ b<a, but cross-type unsound) ⇒ no atom.
    expect(elseP.atoms.ltes).toEqual([]);
    expect(elseP.atoms.lts).toEqual([]);
    expect(elseP.opaque.length).toBe(1); // the raw not(lte a b), recorded for the witness
  });

  it("budget overflow ⇒ complete=false (the completeness signal; no truncation)", () => {
    const prog = ECall("if", [ECall("gt", [EVar("a"), ELit(0)]), ELit("A"), ELit("B")]);
    const out = dispatchedForkPaths(prog, 1) as ForkOut; // 2 paths > budget 1
    expect(out.paths.length).toBe(2);
    expect(out.complete).toBe(false);
  });

  it("a guarded match is FENCED — the whole EMatch stays as an opaque residual leaf", () => {
    const prog = EMatch(read("k"), [
      { pattern: PatConstruct("Just", [PatVar("v")]), guard: ECall("eq", [EVar("v"), ELit(1)]), body: ECall("eq", [read("k"), EConstruct("Nothing")]) },
    ]);
    const out = dispatchedForkPaths(prog, 64) as ForkOut;
    expect(out.paths.length).toBe(1);
    expect(out.paths[0]!.residual).toEqual(prog); // no arm forked
  });
});

// ---------------------------------------------------------------------------
// §2 — satSymbolicPaths: the BRANCHING refutation face (the D-B fence lifted)
// ---------------------------------------------------------------------------

describe("satSymbolicPaths — branching refutation", () => {
  it("HEADLINE: if (read k==1) then (read k==2) else False ⇒ Just false (both paths die)", () => {
    const prog = ECall("if", [
      ECall("eq", [read("k"), ELit(1)]),
      ECall("eq", [read("k"), ELit(2)]),
      EConstruct("False"),
    ]);
    expect(dispatchedSatSymbolicPaths(specHS, prog)).toEqual(JUST_FALSE);
    // the NON-branching satSymbolic abstains on the very same predicate (the lifted fence).
    expect((dispatchedSatSymbolic(specHS, prog) as MaybeV).$tag).toBe("Nothing");
  });

  it("both-die literals: if (read k==5) then (1==2) else (2==3) ⇒ Just false", () => {
    const prog = ECall("if", [
      ECall("eq", [read("k"), ELit(5)]),
      ECall("eq", [ELit(1), ELit(2)]),
      ECall("eq", [ELit(2), ELit(3)]),
    ]);
    expect(dispatchedSatSymbolicPaths(specHS, prog)).toEqual(JUST_FALSE);
  });

  it("MATCH headline: case read k of Just v -> (read k == Nothing) ⇒ Just false (6D distinctness)", () => {
    const prog = EMatch(read("k"), [
      { pattern: PatConstruct("Just", [PatVar("v")]), body: ECall("eq", [read("k"), EConstruct("Nothing")]) },
    ]);
    expect(dispatchedSatSymbolicPaths(specHS, prog)).toEqual(JUST_FALSE);
  });

  it("INJECTIVITY through the fork: arm Just v, body forces read k == Just read2 ∧ f v ≠ f read2 ⇒ Just false", () => {
    const read2 = read("k2");
    const body = ECall("and", [
      ECall("eq", [read("k"), EConstruct("Just", [read2])]),
      ECall("neq", [ECall("f", [EVar("v")]), ECall("f", [read2])]),
    ]);
    const prog = EMatch(read("k"), [{ pattern: PatConstruct("Just", [PatVar("v")]), body }]);
    expect(dispatchedSatSymbolicPaths(specHS, prog)).toEqual(JUST_FALSE);
  });

  it("a satisfiable branching predicate ⇒ Nothing (never Just true)", () => {
    const prog = ECall("if", [
      ECall("gt", [read("k"), ELit(40)]),
      ECall("eq", [read("k"), ELit(42)]), // then-path is satisfiable (42)
      EConstruct("False"),
    ]);
    expect((dispatchedSatSymbolicPaths(specHS, prog) as MaybeV).$tag).toBe("Nothing");
  });

  it("budget overflow ⇒ Nothing (completeness guard — even when EVERY leaf refutes)", () => {
    // balanced if-tree, distinct non-refuting conds, a refutable leaf (1==2):
    // 2^7 = 128 leaves > 64 ⇒ complete=false ⇒ abstain (never a false Just false).
    let counter = 0;
    const leaf = ECall("eq", [ELit(1), ELit(2)]);
    const build = (depth: number): unknown =>
      depth === 0 ? leaf : ECall("if", [ECall("gt", [EVar("x" + counter++), ELit(0)]), build(depth - 1), build(depth - 1)]);
    const prog = build(7);
    expect((dispatchedSatSymbolicPaths([], prog) as MaybeV).$tag).toBe("Nothing");
  });

  it("a WRITE site anywhere ⇒ Nothing (the lawful gate, unchanged)", () => {
    const prog = ECall("if", [
      ECall("eq", [read("k"), ELit(1)]),
      ECall("eq", [write("k"), ELit(2)]),
      EConstruct("False"),
    ]);
    expect((dispatchedSatSymbolicPaths(specHS, prog) as MaybeV).$tag).toBe("Nothing");
  });

  it("a class NOT declared Symbolic ⇒ Nothing (unmodeled effect — honest)", () => {
    const prog = ECall("if", [ECall("eq", [read("k"), ELit(1)]), ECall("eq", [read("k"), ELit(2)]), EConstruct("False")]);
    expect((dispatchedSatSymbolicPaths([], prog) as MaybeV).$tag).toBe("Nothing"); // empty spec
    expect((dispatchedSatSymbolicPaths([{ effectClass: "HasCryptoRandom", reads: ["nextNumber"] }], prog) as MaybeV).$tag).toBe("Nothing");
  });

  it("a fenced (guarded) match ⇒ Nothing (no false refutation)", () => {
    const prog = EMatch(read("k"), [
      { pattern: PatConstruct("Just", [PatVar("v")]), guard: ECall("eq", [EVar("v"), ELit(1)]), body: ECall("eq", [read("k"), EConstruct("Nothing")]) },
    ]);
    expect((dispatchedSatSymbolicPaths(specHS, prog) as MaybeV).$tag).toBe("Nothing");
  });
});

// ---------------------------------------------------------------------------
// §3 — solveSymbolicPaths: the BRANCHING witness face (the D-B witness lifted)
// ---------------------------------------------------------------------------

describe("solveSymbolicPaths — branching witness", () => {
  it("numeric-order headline without a domain abstains under the native-carrier fence", () => {
    const prog = ECall("if", [
      ECall("gt", [read("k"), ELit(40)]),
      ECall("eq", [read("k"), ELit(42)]),
      EConstruct("False"),
    ]);
    expect(dispatchedSolveSymbolicPaths(specHS, prog)).toEqual({ $tag: "Nothing" });
  });

  it("an equality-guarded branch witnesses through the same shared read", () => {
    const prog = ECall("if", [
      ECall("eq", [read("k"), ELit(42)]),
      ECall("eq", [read("k"), ELit(42)]),
      EConstruct("False"),
    ]);
    expect(dispatchedSolveSymbolicPaths(specHS, prog)).toEqual({ $tag: "Just", _0: 42 });
  });

  it("a numeric-order single-read predicate without a domain remains undecided", () => {
    const prog = ECall("if", [ECall("gt", [read("k"), ELit(0)]), ECall("eq", [read("k"), ELit(7)]), EConstruct("False")]);
    expect(dispatchedSolveSymbolicPaths(specHS, prog)).toEqual({ $tag: "Nothing" });
  });

  it("a single-read predicate under a literal-true branch still witnesses", () => {
    const prog = ECall("if", [ELit(true), ECall("eq", [read("k"), ELit(7)]), EConstruct("False")]);
    expect(dispatchedSolveSymbolicPaths(specHS, prog)).toEqual({ $tag: "Just", _0: 7 });
  });

  it("the witness face abstains on a match arm (the fresh payload var trips solve's single-unknown fence)", () => {
    const prog = EMatch(read("k"), [{ pattern: PatConstruct("Just", [PatVar("v")]), body: ECall("eq", [EVar("v"), ELit(7)]) }]);
    // and(eq(?sym, Just ?fork), eq(?fork, 7)) has TWO free vars ⇒ solve ⇒ Nothing (honest).
    expect((dispatchedSolveSymbolicPaths(specHS, prog) as MaybeV).$tag).toBe("Nothing");
  });

  it("a WRITE site anywhere ⇒ Nothing (the lawful gate, unchanged)", () => {
    const prog = ECall("if", [ECall("gt", [read("k"), ELit(40)]), ECall("eq", [write("k"), ELit(42)]), EConstruct("False")]);
    expect((dispatchedSolveSymbolicPaths(specHS, prog) as MaybeV).$tag).toBe("Nothing");
  });
});

// ---------------------------------------------------------------------------
// §4 — decide-substrate 8μ.3: the fork-driver SeCtor negative-match wiring
//   • DEAD-ARM PRUNING — an arm after a catch-all is unreachable (negDom SeNone).
//   • the SHADOWABLE LIFT — a k≥1 arm whose projection is provably disjoint from
//     every prior arm (SeCtor distinctness / distinct-lit) is no longer skipped.
// The cross-arm REFUTATION corpus (§2) stays VERBATIM (positives untouched).
// ---------------------------------------------------------------------------

describe("8μ.3 — fork-driver SeCtor negatives (dead-arm prune + shadowable lift)", () => {
  it("dead-arm prune: case (read k) of w -> A ; Just v -> B ⇒ the Just arm is DEAD (after the catch-all) ⇒ 1 path", () => {
    const prog = EMatch(read("k"), [
      { pattern: PatVar("w"), body: ELit("A") },
      { pattern: PatConstruct("Just", [PatVar("v")]), body: ELit("B") },
    ]);
    const out = dispatchedForkPaths(prog, 64) as ForkOut;
    expect(out.complete).toBe(true);
    expect(out.paths.length).toBe(1); // arm-2 pruned: complement(SeAll) = SeNone = ∅
    expect(out.paths[0]!.residual).toEqual(ELit("A"));
  });

  it("dead-arm prune: a wildcard-then-arm also prunes (PatWildcard is a catch-all)", () => {
    const prog = EMatch(read("k"), [
      { pattern: PatWildcard, body: ELit("A") },
      { pattern: PatLit(1), body: ELit("B") },
    ]);
    const out = dispatchedForkPaths(prog, 64) as ForkOut;
    expect(out.paths.length).toBe(1);
    expect(out.paths[0]!.residual).toEqual(ELit("A"));
  });

  it("shadowable lift: case (read k) of Just v -> A ; Nothing -> B ⇒ BOTH paths witness-safe (SeCtor distinctness)", () => {
    const prog = EMatch(read("k"), [
      { pattern: PatConstruct("Just", [PatVar("v")]), body: ELit("A") },
      { pattern: PatConstruct("Nothing", []), body: ELit("B") },
    ]);
    const out = dispatchedForkPaths(prog, 64) as ForkOut;
    expect(out.paths.length).toBe(2);
    const justP = out.paths.find((p) => p.residual.value === "A")!;
    const nothingP = out.paths.find((p) => p.residual.value === "B")!;
    expect(justP.shadowable).toBe(false); // arm-0 always witness-safe
    expect(nothingP.shadowable).toBe(false); // arm-1 LIFTED — Nothing ∩ Just = ∅
  });

  it("NO false lift: overlapping ctors keep shadowable=true — case (read k) of Just a -> A ; Just b -> B (same ctor ⇒ not disjoint)", () => {
    const prog = EMatch(read("k"), [
      { pattern: PatConstruct("Just", [PatVar("a")]), body: ELit("A") },
      { pattern: PatConstruct("Just", [PatVar("b")]), body: ELit("B") },
    ]);
    const out = dispatchedForkPaths(prog, 64) as ForkOut;
    const secondP = out.paths.find((p) => p.residual.value === "B")!;
    expect(secondP.shadowable).toBe(true); // same ctor overlaps ⇒ conservatively shadowed
  });

  it("shadowable lift (witness): case (read k) of 1 -> (read k==9) ; 2 -> (read k==2) ⇒ Just 2 (arm-2 lit disjoint from arm-1 lit ⇒ no longer skipped)", () => {
    const prog = EMatch(read("k"), [
      { pattern: PatLit(1), body: ECall("eq", [read("k"), ELit(9)]) }, // ?sym==1 ∧ ?sym==9 ⇒ unsat ⇒ no witness
      { pattern: PatLit(2), body: ECall("eq", [read("k"), ELit(2)]) }, // ?sym==2 ⇒ witness 2 (was skipped pre-8μ.3)
    ]);
    expect(dispatchedSolveSymbolicPaths(specHS, prog)).toEqual({ $tag: "Just", _0: 2 });
  });

  it("the MATCH refutation headline is unchanged: case read k of Just v -> (read k == Nothing) ⇒ Just false", () => {
    const prog = EMatch(read("k"), [
      { pattern: PatConstruct("Just", [PatVar("v")]), body: ECall("eq", [read("k"), EConstruct("Nothing")]) },
    ]);
    expect(dispatchedSatSymbolicPaths(specHS, prog)).toEqual(JUST_FALSE);
  });
});
