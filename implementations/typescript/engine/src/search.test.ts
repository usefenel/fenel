// decide-substrate Phase 4 — conformance tests for `search` / `searchTyped`
// (the fuel-bounded, emptiness-pruned witness search over ∪/∩/¬/diff Se*
// composites — DPLL(T), Fenel-native). brief:
// `workstreams/decide-substrate/briefs/phase-4-search-union-inhabitation.md`.
//
// THE HEADLINE: `(x == 1 or x == 5) and not (x == 5)` lowers (via comprehend) to
// SeIntersect [SeUnion[{1},{5}], SeComplement {5}] — inhabit returned Nothing
// today; search returns SvFound 1. Verdicts are lattice judgments + witnesses:
// every SvFound re-checks under the unchanged kernel via {w} ⊆ s (Phase 3 D
// made that OBJECT-complete, so binding-row / record witnesses re-check too).

import { describe, it, expect } from "vitest";
import {
  dispatchEngineBody,
  dispatchedSearch,
  dispatchedSearchTyped,
} from "./engine-bodies-dispatch";
import { decidableSetProposerNative } from "./modules/prover";
import { decidableSetProof } from "./prover";
import { verify } from "./kernel";
import { contains } from "./set-algebra";
import { Nothing } from "./type-foundation";

// --- tiny Expr builders (plain $tag-tagged objects) ----------------------
const EVar = (name: string) => ({ $tag: "EVar", name });
const ELit = (value: unknown) => ({ $tag: "ELit", value });
const ECall = (fnId: string, args: unknown[]) => ({ $tag: "ECall", fnId, args });

// --- canonical Se* SetExpr builders (the registered $tag shapes) ----------
const SeEnum = (values: unknown[]) => ({ $tag: "SeEnum", values });
const SeNone = { $tag: "SeNone" };
const SeAll = { $tag: "SeAll" };
const SeWhere = (pred: unknown) => ({ $tag: "SeWhere", pred });
const SeComplement = (inner: unknown) => ({ $tag: "SeComplement", inner });
const SeUnion = (branches: unknown[]) => ({ $tag: "SeUnion", branches });
const SeIntersect = (branches: unknown[]) => ({ $tag: "SeIntersect", branches });
const SeDiff = (left: unknown, right: unknown) => ({ $tag: "SeDiff", left, right });
// MB = Maybe { value, inclusive } in the canonical positional encoding.
const MBjust = (value: unknown, inclusive: boolean) => ({ $tag: "Just", _0: { value, inclusive } });
const SeInterval = (lo: unknown, hi: unknown) => ({ $tag: "SeInterval", interval: { lo, hi } });

type Verdict = { $tag: string; _0?: unknown };

const FUEL = 256;
const search = (s: unknown, fuel = FUEL) => dispatchedSearch(fuel, s) as Verdict;
const searchT = (base: string, s: unknown, fuel = FUEL) =>
  dispatchedSearchTyped(base, fuel, s) as Verdict;
const cph = (varName: string, expr: unknown) =>
  dispatchEngineBody("engine:comprehend", [varName, expr]);

// ---------------------------------------------------------------------------
// The headline — via comprehend + search, end-to-end.
// ---------------------------------------------------------------------------

describe("search — the headline (comprehend + search)", () => {
  it("(x == 1 or x == 5) and not (x == 5) ⇒ SvFound 1", () => {
    const expr = ECall("and", [
      ECall("or", [
        ECall("eq", [EVar("x"), ELit(1)]),
        ECall("eq", [EVar("x"), ELit(5)]),
      ]),
      ECall("not", [ECall("eq", [EVar("x"), ELit(5)])]),
    ]);
    const s = cph("x", expr);
    const r = search(s);
    expect(r.$tag).toBe("SvFound");
    expect(r._0).toBe(1);
  });
});

// ---------------------------------------------------------------------------
// Intersect — generator + filters.
// ---------------------------------------------------------------------------

describe("search — intersect (generator + filters)", () => {
  it("enum ∩ enum ⇒ SvFound (first common member)", () => {
    const r = search(SeIntersect([SeEnum([1, 2, 3]), SeEnum([2, 3, 4])]));
    expect(r.$tag).toBe("SvFound");
    expect(r._0).toBe(2);
  });

  it("enum ∩ ¬enum ⇒ SvFound (first member not excluded)", () => {
    const r = search(SeIntersect([SeEnum([1, 2, 3]), SeComplement(SeEnum([1, 2]))]));
    expect(r.$tag).toBe("SvFound");
    expect(r._0).toBe(3);
  });

  it("generator + where-filter ⇒ SvFound (Phase 4T Step W — the per-candidate $where value-threading LANDED)", () => {
    // {1,2,3,4,5} ∩ {value | value > 3} ⇒ 4 (1,2,3 decidably rejected). The
    // value-taking whereMember arm threads each candidate into the predicate
    // eval, so a SeWhere filter is trustworthy at any depth — the Phase-4
    // poison guard (SvUnknown) is retired and the named unlock lands.
    const r = search(
      SeIntersect([SeEnum([1, 2, 3, 4, 5]), SeWhere({ gt: [{ var: "value" }, 3] })]),
    );
    expect(r.$tag).toBe("SvFound");
    expect(r._0).toBe(4);
  });

  it("no generator-capable branch ⇒ SvUnknown", () => {
    const r = search(SeIntersect([SeComplement(SeEnum([1])), SeWhere({ "==": [1, 1] })]));
    expect(r.$tag).toBe("SvUnknown");
  });
});

// ---------------------------------------------------------------------------
// Diff — a ∩ ¬b.
// ---------------------------------------------------------------------------

describe("search — diff", () => {
  it("{1,2,3} \\ {2} ⇒ SvFound (first surviving member)", () => {
    const r = search(SeDiff(SeEnum([1, 2, 3]), SeEnum([2])));
    expect(r.$tag).toBe("SvFound");
    expect(r._0).toBe(1);
  });

  it("{1,2} \\ {1,2} ⇒ SvEmpty (complete generator, all excluded)", () => {
    const r = search(SeDiff(SeEnum([1, 2]), SeEnum([1, 2])));
    expect(r.$tag).toBe("SvEmpty");
  });
});

// ---------------------------------------------------------------------------
// Complement alone — no generator ⇒ SvUnknown (honest).
// ---------------------------------------------------------------------------

describe("search — bare complement", () => {
  it("¬{1,2} alone ⇒ SvUnknown (no generator — searchable only inside an intersect)", () => {
    const r = search(SeComplement(SeEnum([1, 2])));
    expect(r.$tag).toBe("SvUnknown");
  });
});

// ---------------------------------------------------------------------------
// The honest SvEmpty bar.
// ---------------------------------------------------------------------------

describe("search — the honest SvEmpty bar", () => {
  it("SeIntersect [{1,2}, ¬{1,2}] ⇒ SvEmpty (complete generator, every candidate rejected)", () => {
    const r = search(SeIntersect([SeEnum([1, 2]), SeComplement(SeEnum([1, 2]))]));
    expect(r.$tag).toBe("SvEmpty");
  });

  it("SeUnion [SeNone, SeNone] ⇒ SvEmpty (every branch decidably empty)", () => {
    const r = search(SeUnion([SeNone, SeNone]));
    expect(r.$tag).toBe("SvEmpty");
  });

  it("SeNone leaf ⇒ SvEmpty", () => {
    expect(search(SeNone).$tag).toBe("SvEmpty");
  });

  it("SeUnion with an undecidable branch ⇒ SvUnknown (withholds SvEmpty)", () => {
    // SeAll is inhabited-but-no-canonical-witness AND not decidably empty ⇒
    // the branch is SvUnknown, poisoning the union's SvEmpty.
    const r = search(SeUnion([SeNone, SeAll]));
    expect(r.$tag).toBe("SvUnknown");
  });
});

// ---------------------------------------------------------------------------
// The Nothing-filter poisoning — SvUnknown, never a dishonest SvEmpty.
// ---------------------------------------------------------------------------

describe("search — $where filters decide per-candidate (Phase 4T Step W; the poison guard retired)", () => {
  it("{1,2} ∩ {value|value>3} ⇒ SvEmpty (an honest $where-backed exhaustion — every candidate decidably rejected)", () => {
    // Pre-W this was the poison case (a nested contains(SeWhere, w) left `value`
    // unbound ⇒ a WRONG blanket Just false ⇒ the guard forced SvUnknown). With
    // whereMember threading each candidate, 1 and 2 are CORRECTLY rejected
    // (neither > 3) and the complete generator's exhaustion is a sound SvEmpty.
    const r = search(SeIntersect([SeEnum([1, 2]), SeWhere({ gt: [{ var: "value" }, 3] })]));
    expect(r.$tag).toBe("SvEmpty");
  });

  it("a SeWhere nested inside a ¬ filter also decides: {1,2} ∩ ¬{value|value>3} ⇒ SvFound 1", () => {
    const r = search(
      SeIntersect([SeEnum([1, 2]), SeComplement(SeWhere({ gt: [{ var: "value" }, 3] }))]),
    );
    expect(r.$tag).toBe("SvFound");
    expect(r._0).toBe(1);
  });
});

// ---------------------------------------------------------------------------
// Fuel exhaustion ⇒ SvUnknown "fuel".
// ---------------------------------------------------------------------------

describe("search — fuel", () => {
  it("fuel 0 ⇒ SvUnknown", () => {
    const r = search(SeIntersect([SeEnum([1, 2, 3]), SeComplement(SeEnum([1, 2]))]), 0);
    expect(r.$tag).toBe("SvUnknown");
    expect(r._0).toBe("fuel");
  });
});

// ---------------------------------------------------------------------------
// Scalar + OBJECT-row candidates (the Phase 3 D synergy — object witnesses).
// ---------------------------------------------------------------------------

describe("search — object-row witnesses (Phase 3 D)", () => {
  it("an enum of binding-row objects ∩ ¬{one row} ⇒ SvFound the surviving row", () => {
    const rowA = [{ name: "x", value: "anna" }];
    const rowB = [{ name: "x", value: "bob" }];
    const r = search(SeIntersect([SeEnum([rowA, rowB]), SeComplement(SeEnum([rowA]))]));
    expect(r.$tag).toBe("SvFound");
    // rowA is excluded (structural deep-eq); rowB survives.
    expect(r._0).toEqual(rowB);
  });

  it("an enum of rows \\ the same rows ⇒ SvEmpty (structural exhaustion)", () => {
    const rowA = [{ name: "x", value: "anna" }];
    const rowB = [{ name: "x", value: "bob" }];
    const r = search(SeDiff(SeEnum([rowA, rowB]), SeEnum([rowA, rowB])));
    expect(r.$tag).toBe("SvEmpty");
  });
});

// ---------------------------------------------------------------------------
// Typed interval stepping (searchTyped — the solver-extension de-fence).
// ---------------------------------------------------------------------------

describe("searchTyped — interval stepping", () => {
  it("integer interval endpoints remain usable as inexact witness candidates", () => {
    // The scalar endpoint 2 is a real witness without claiming a complete range.
    const interval = SeInterval(MBjust(2, true), MBjust(5, true));
    const r = searchT("Int", SeIntersect([interval, SeComplement(SeEnum([3]))]));
    expect(r.$tag).toBe("SvFound");
    expect(r._0).toBe(2);
  });

  it("exhausting integer interval endpoints stays unknown while an interior scalar inhabitant survives", () => {
    const interval = SeInterval(MBjust(2, true), MBjust(4, true));
    const remaining = SeIntersect([interval, SeComplement(SeEnum([2, 4]))]);
    // GLOBAL_ONLY: this structural membership fixture has no request account.
    expect(contains(remaining as never, 3, null)).toEqual({ $tag: "Just", _0: true });
    expect(searchT("Int", remaining).$tag).toBe("SvUnknown");
  });

  it("an explicit finite enum can still witness an admitted large exact integer carrier", () => {
    const exactInteger = { $tag: "Int", digits: "9007199254740993" };
    const interval = SeInterval(MBjust(2, true), Nothing);
    const r = searchT("Int", SeIntersect([
      SeEnum([exactInteger]), interval,
    ]));
    expect(r.$tag).toBe("SvFound");
    expect(r._0).toEqual(exactInteger);
  });

  it("untyped interval ∩ ¬{endpoint} ⇒ SvUnknown when only endpoints are excluded (inexact)", () => {
    // Untyped [2,5]: candidates are the inclusive endpoints {2,5}; excluding both
    // exhausts the INEXACT sample ⇒ SvUnknown (not SvEmpty — the interior is unchecked).
    const interval = SeInterval(MBjust(2, true), MBjust(5, true));
    const r = search(SeIntersect([interval, SeComplement(SeEnum([2, 5]))]));
    expect(r.$tag).toBe("SvUnknown");
  });

  it("untyped interval ∩ ¬{one endpoint} ⇒ SvFound the other endpoint", () => {
    const interval = SeInterval(MBjust(2, true), MBjust(5, true));
    const r = search(SeIntersect([interval, SeComplement(SeEnum([2]))]));
    expect(r.$tag).toBe("SvFound");
    expect(r._0).toBe(5);
  });
});

// ---------------------------------------------------------------------------
// Step E — the search-backed proposer: the certificates-by-construction loop
// CLOSED end-to-end (untrusted search → witness → unchanged kernel re-check).
// ---------------------------------------------------------------------------

const jInhabited = (s: unknown) => ({ $tag: "JInhabited", _0: s });

describe("search-backed proposer (Step E) — the certificates loop", () => {
  it("JInhabited over enum∩enum ⇒ Ok kind=nonempty (the D′-widened DECIDER answers before the witness arm)", () => {
    // Pre-D′ this exercised the witness arm (decideEmpty was Nothing on
    // enum∩enum). The Phase 4T D′ widening makes the decider itself decide it
    // (search-backed Just false = witnessed non-empty), so the proposer takes
    // the CLASSIC nonempty path — strictly better (no witness emission needed).
    const s = SeIntersect([SeEnum([2, 3, 4]), SeEnum([3, 4, 5])]);
    const claim = jInhabited(s);
    const out = decidableSetProposerNative(claim) as { $tag: string; _0: unknown };
    expect(out.$tag).toBe("Ok");
    const proof = out._0 as { $tag: string; kind: string };
    expect(proof.kind).toBe("nonempty");
    const vr = verify(claim as never, proof as never);
    expect(vr.$tag).toBe("Ok");
  });

  it("JInhabited over enum∩$where (decider-undecidable) ⇒ Ok kind=witness ⇒ kernel Ok SolverChecked", () => {
    // The witness arm's live territory post-D′: a $where-bearing composite is
    // NOT searchable from the bare decider (the ctx-native guard), so
    // decideEmpty stays Nothing — but the PROPOSER's dispatch carries the
    // decider ctx, so its search threads whereMember per candidate (Step W):
    // 2 is rejected (not > 2), 3 passes ⇒ witness 3. The kernel re-checks
    // {3} ⊆ s via decideSubset — Just true (the W synergy: the enum ⊆ $where
    // element-wise membership decides) ⇒ SolverChecked. NO new kernel rule.
    const s = SeIntersect([SeEnum([2, 3, 4]), SeWhere({ gt: [{ var: "value" }, 2] })]);
    const claim = jInhabited(s);
    const out = decidableSetProposerNative(claim) as { $tag: string; _0: unknown };
    expect(out.$tag).toBe("Ok");
    const proof = out._0 as { $tag: string; kind: string; witness: { left: unknown } };
    expect(proof.kind).toBe("witness");
    expect(proof.witness.left).toBe(3);
    const vr = verify(claim as never, proof as never);
    expect(vr.$tag).toBe("Ok");
  });

  it("a TAMPERED witness (not a member) ⇒ the unchanged kernel rejects (WitnessRejected)", () => {
    const s = SeIntersect([SeEnum([2, 3, 4]), SeWhere({ gt: [{ var: "value" }, 2] })]);
    const claim = jInhabited(s);
    const bad = verify(claim as never, decidableSetProof("witness", { left: 2 }) as never);
    expect(bad.$tag).toBe("Err");
  });
});

// ---------------------------------------------------------------------------
// Step D′ — the emptiness widening (the decider's search fall-through).
// ---------------------------------------------------------------------------

describe("decideEmpty — the search widening (Phase 4T Step D′)", () => {
  it("enum∩enum overlap ⇒ Just false (witnessed non-empty — was Nothing)", () => {
    const r = dispatchEngineBody("engine:setAlgebraDecideEmpty", [
      SeIntersect([SeEnum([2, 3, 4]), SeEnum([3, 4, 5])]),
    ]) as Verdict;
    expect(r).toEqual({ $tag: "Just", _0: false });
  });

  it("enum ∩ ¬enum fully excluded ⇒ Just true (a search-backed refutation — was Nothing)", () => {
    const r = dispatchEngineBody("engine:setAlgebraDecideEmpty", [
      SeIntersect([SeEnum([1, 2]), SeComplement(SeEnum([1, 2]))]),
    ]) as Verdict;
    expect(r).toEqual({ $tag: "Just", _0: true });
  });

  it("a $where-bearing composite stays Nothing from the BARE decider (the ctx-native guard)", () => {
    const r = dispatchEngineBody("engine:setAlgebraDecideEmpty", [
      SeIntersect([SeEnum([1, 2]), SeWhere({ gt: [{ var: "value" }, 3] })]),
    ]) as Verdict;
    expect(r.$tag).toBe("Nothing");
  });

  it("the CORE stays connective-only (the cycle-break): enum∩enum overlap ⇒ Nothing from core", () => {
    const r = dispatchEngineBody("engine:setAlgebraDecideEmptyCore", [
      SeIntersect([SeEnum([2, 3, 4]), SeEnum([3, 4, 5])]),
    ]) as Verdict;
    expect(r.$tag).toBe("Nothing");
  });
});
