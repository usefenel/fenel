// decide-substrate rel-solve 13b — conformance tests for the STRATIFIED
// SEMI-NAIVE MATERIALIZATION pass (recursion + stratified negation over
// derived relations + `or` inside rule bodies — the last Prolog-class
// piece). brief:
// `workstreams/decide-substrate/briefs/phase-13b-semi-naive-recursion-stratified-negation.md`.
//
// The P13/P15/4T surface (`rel-solve.test.ts`) is the byte-identical
// regression pin for the UNFOLD mode; this file exercises the NEW
// materialize mode: transitive closure (incl. cycles in the DATA), mutual
// recursion, the non-linear doubly-recursive case, same-generation,
// two-strata negation, query-level `not` over a derived predicate,
// or-in-body splitting, the unstratifiable / unmaterializable / fuel
// fences, the safe-but-empty `Just [] ≠ Nothing` split, and the
// naive-vs-semi-naive agreement differential (the executable pin for the
// rel.fixpoint / rel.seminaive TCB-ledger rows).

import { describe, it, expect } from "vitest";
import { dispatchEngineBody, dispatchedSolveRel } from "./engine-bodies-dispatch";

// --- tiny Expr builders (plain $tag-tagged objects) ----------------------
const EVar = (name: string) => ({ $tag: "EVar", name });
const ELit = (value: unknown) => ({ $tag: "ELit", value });
const ECall = (fnId: string, args: unknown[]) => ({ $tag: "ECall", fnId, args });

type MaybeV = { $tag: string; _0?: unknown };

const rel = (name: string, arity: number, rows: unknown[][]) => ({ name, arity, rows });
const factsOf = (
  relations: ReturnType<typeof rel>[],
  rules: { name: string; params: string[]; body: unknown }[] = [],
) => ({ relations, rules });

const bindingsOf = (r: MaybeV) => r._0 as { name: string; value: unknown }[][];
const sortedRows = (rows: unknown[][]) => rows.map((r) => JSON.stringify(r)).sort();

// The canonical 4-person chain (parent, child): anna → bob → carl → dan.
const CHAIN = rel("parentOf", 2, [
  ["anna", "bob"],
  ["bob", "carl"],
  ["carl", "dan"],
]);

// ancestor(x, y) :- parentOf(x, y) | (parentOf(x, z), ancestor(z, y))
// — recursion AND or-in-body in one rule (one rule per head name; the
// disjunction of clauses is the or-body, split at materialization).
const ANCESTOR = {
  name: "ancestor",
  params: ["x", "y"],
  body: ECall("or", [
    ECall("parentOf", [EVar("x"), EVar("y")]),
    ECall("and", [
      ECall("parentOf", [EVar("x"), EVar("z")]),
      ECall("ancestor", [EVar("z"), EVar("y")]),
    ]),
  ]),
};

// ---------------------------------------------------------------------------
// Transitive closure — the headline recursion gain.
// ---------------------------------------------------------------------------

describe("13b — transitive closure (ancestor)", () => {
  it("ancestor 'anna' y over the chain ⇒ ALL descendants {bob, carl, dan} (derivation order)", () => {
    const r = dispatchEngineBody("engine:solveRelAll", [
      ECall("ancestor", [ELit("anna"), EVar("y")]),
      factsOf([CHAIN], [ANCESTOR]),
    ]) as MaybeV;
    expect(r.$tag).toBe("Just");
    expect(r._0).toEqual([
      [{ name: "y", value: "bob" }],
      [{ name: "y", value: "carl" }],
      [{ name: "y", value: "dan" }],
    ]);
  });

  it("the witness entry (dispatchedSolveRel) ⇒ the first derived row", () => {
    const r = dispatchedSolveRel(
      ECall("ancestor", [ELit("anna"), EVar("y")]),
      factsOf([CHAIN], [ANCESTOR]),
    ) as MaybeV;
    expect(r.$tag).toBe("Just");
    expect(r._0).toEqual([{ name: "y", value: "bob" }]);
  });

  it("the full pair query enumerates the whole closure (6 pairs over the 3-edge chain)", () => {
    const r = dispatchEngineBody("engine:solveRelAll", [
      ECall("ancestor", [EVar("x"), EVar("y")]),
      factsOf([CHAIN], [ANCESTOR]),
    ]) as MaybeV;
    expect(r.$tag).toBe("Just");
    expect((r._0 as unknown[]).length).toBe(6);
  });

  it("a CYCLE in the DATA still terminates (least fixpoint saturates): a⇄b ⇒ ancestor a ∈ {b, a}", () => {
    const CYC = rel("parentOf", 2, [
      ["a", "b"],
      ["b", "a"],
    ]);
    const r = dispatchEngineBody("engine:solveRelAll", [
      ECall("ancestor", [ELit("a"), EVar("y")]),
      factsOf([CYC], [ANCESTOR]),
    ]) as MaybeV;
    expect(r.$tag).toBe("Just");
    expect(r._0).toEqual([
      [{ name: "y", value: "b" }],
      [{ name: "y", value: "a" }],
    ]);
  });

  it("safe-but-empty: the rule set over an EMPTY relation ⇒ relSolveSet Just (SeEnum []) but the witness ⇒ Nothing", () => {
    const facts = factsOf([rel("parentOf", 2, [])], [ANCESTOR]);
    const s = dispatchEngineBody("engine:relSolveSet", [
      ["y"],
      ECall("ancestor", [ELit("anna"), EVar("y")]),
      facts,
    ]) as MaybeV;
    expect(s.$tag).toBe("Just");
    expect((s._0 as { $tag: string; values: unknown[] }).$tag).toBe("SeEnum");
    expect((s._0 as { $tag: string; values: unknown[] }).values).toEqual([]);
    const w = dispatchedSolveRel(
      ECall("ancestor", [ELit("anna"), EVar("y")]),
      facts,
    ) as MaybeV;
    expect(w.$tag).toBe("Nothing");
  });
});

// ---------------------------------------------------------------------------
// Mutual recursion (even/odd) — one SCC, two predicates.
// ---------------------------------------------------------------------------

const ZERO = rel("zeroR", 1, [[0]]);
const SUCC = rel("succR", 2, [
  [0, 1],
  [1, 2],
  [2, 3],
  [3, 4],
]);
const EVEN = {
  name: "even",
  params: ["x"],
  body: ECall("or", [
    ECall("zeroR", [EVar("x")]),
    ECall("and", [ECall("succR", [EVar("y"), EVar("x")]), ECall("odd", [EVar("y")])]),
  ]),
};
const ODD = {
  name: "odd",
  params: ["x"],
  body: ECall("and", [ECall("succR", [EVar("y"), EVar("x")]), ECall("even", [EVar("y")])]),
};

describe("13b — mutual recursion (even/odd over successor facts)", () => {
  it("even x ⇒ {0, 2, 4} (round-alternating deltas across the two-predicate SCC)", () => {
    const r = dispatchEngineBody("engine:solveRelAll", [
      ECall("even", [EVar("x")]),
      factsOf([ZERO, SUCC], [EVEN, ODD]),
    ]) as MaybeV;
    expect(r.$tag).toBe("Just");
    expect(r._0).toEqual([
      [{ name: "x", value: 0 }],
      [{ name: "x", value: 2 }],
      [{ name: "x", value: 4 }],
    ]);
  });

  it("odd x ⇒ {1, 3}", () => {
    const r = dispatchEngineBody("engine:solveRelAll", [
      ECall("odd", [EVar("x")]),
      factsOf([ZERO, SUCC], [EVEN, ODD]),
    ]) as MaybeV;
    expect(r.$tag).toBe("Just");
    expect(r._0).toEqual([
      [{ name: "x", value: 1 }],
      [{ name: "x", value: 3 }],
    ]);
  });
});

// ---------------------------------------------------------------------------
// Non-linear recursion — TWO recursive atoms in one body (path ∘ path).
// The delta rewrite must fire per-position; missing one loses derivations.
// ---------------------------------------------------------------------------

describe("13b — non-linear recursion (path :- edge | path∘path)", () => {
  const EDGE = rel("edge", 2, [
    [1, 2],
    [2, 3],
    [3, 4],
  ]);
  const PATH = {
    name: "path",
    params: ["x", "y"],
    body: ECall("or", [
      ECall("edge", [EVar("x"), EVar("y")]),
      ECall("and", [
        ECall("path", [EVar("x"), EVar("z")]),
        ECall("path", [EVar("z"), EVar("y")]),
      ]),
    ]),
  };

  it("the doubly-recursive closure is complete (6 pairs — incl. (1,4), needing BOTH delta positions)", () => {
    const r = dispatchEngineBody("engine:solveRelAll", [
      ECall("path", [EVar("x"), EVar("y")]),
      factsOf([EDGE], [PATH]),
    ]) as MaybeV;
    expect(r.$tag).toBe("Just");
    const rows = bindingsOf(r).map((b) => [b[0]!.value, b[1]!.value]);
    expect(sortedRows(rows)).toEqual(
      sortedRows([
        [1, 2],
        [2, 3],
        [3, 4],
        [1, 3],
        [2, 4],
        [1, 4],
      ]),
    );
  });
});

// ---------------------------------------------------------------------------
// Same-generation — the classic (base via residual eq; up/down via parentR).
// ---------------------------------------------------------------------------

describe("13b — same-generation", () => {
  const PERSON = rel("person", 1, [["p1"], ["p2"], ["c1"], ["c2"], ["c3"]]);
  const PARENTR = rel("parentR", 2, [
    ["c1", "p1"],
    ["c2", "p1"],
    ["c3", "p2"],
  ]);
  // sg(x,y) :- person(x), person(y), x = y
  //          | parentR(x,px), sg(px,py), parentR(y,py)
  const SG = {
    name: "sg",
    params: ["x", "y"],
    body: ECall("or", [
      ECall("and", [
        ECall("person", [EVar("x")]),
        ECall("person", [EVar("y")]),
        ECall("eq", [EVar("x"), EVar("y")]),
      ]),
      ECall("and", [
        ECall("parentR", [EVar("x"), EVar("px")]),
        ECall("sg", [EVar("px"), EVar("py")]),
        ECall("parentR", [EVar("y"), EVar("py")]),
      ]),
    ]),
  };

  it("sg = 5 reflexive pairs + the same-parent sibling pairs (c1,c2)/(c2,c1) — 7 rows", () => {
    const r = dispatchEngineBody("engine:solveRelAll", [
      ECall("sg", [EVar("x"), EVar("y")]),
      factsOf([PERSON, PARENTR], [SG]),
    ]) as MaybeV;
    expect(r.$tag).toBe("Just");
    const rows = bindingsOf(r).map((b) => [b[0]!.value, b[1]!.value]);
    expect(sortedRows(rows)).toEqual(
      sortedRows([
        ["p1", "p1"],
        ["p2", "p2"],
        ["c1", "c1"],
        ["c2", "c2"],
        ["c3", "c3"],
        ["c1", "c2"],
        ["c2", "c1"],
      ]),
    );
  });

  it("sg 'c1' y ⇒ {c1, c2} (residual-eq base + one recursive step)", () => {
    const r = dispatchEngineBody("engine:solveRelAll", [
      ECall("sg", [ELit("c1"), EVar("y")]),
      factsOf([PERSON, PARENTR], [SG]),
    ]) as MaybeV;
    expect(r.$tag).toBe("Just");
    expect(r._0).toEqual([
      [{ name: "y", value: "c1" }],
      [{ name: "y", value: "c2" }],
    ]);
  });
});

// ---------------------------------------------------------------------------
// Stratified negation — two strata decide; unstratifiable ⇒ Nothing.
// ---------------------------------------------------------------------------

describe("13b — stratified negation", () => {
  const NODES = rel("nodes", 1, [["a"], ["b"], ["c"], ["d"]]);
  const EDGE = rel("edge", 2, [
    ["a", "b"],
    ["b", "c"],
  ]);
  const SOURCE = rel("sourceR", 1, [["a"]]);
  // reachableP(x) :- sourceR(x) | (edge(y,x), reachableP(y))   — stratum 1
  const REACHABLE = {
    name: "reachableP",
    params: ["x"],
    body: ECall("or", [
      ECall("sourceR", [EVar("x")]),
      ECall("and", [ECall("edge", [EVar("y"), EVar("x")]), ECall("reachableP", [EVar("y")])]),
    ]),
  };
  // unreachP(x) :- nodes(x), not reachableP(x)                 — stratum 2
  const UNREACH = {
    name: "unreachP",
    params: ["x"],
    body: ECall("and", [
      ECall("nodes", [EVar("x")]),
      ECall("not", [ECall("reachableP", [EVar("x")])]),
    ]),
  };

  it("two strata: unreachP x ⇒ {d} (the negating rule UNFOLDS; the negated recursive predicate MATERIALIZES)", () => {
    const r = dispatchEngineBody("engine:solveRelAll", [
      ECall("unreachP", [EVar("x")]),
      factsOf([NODES, EDGE, SOURCE], [REACHABLE, UNREACH]),
    ]) as MaybeV;
    expect(r.$tag).toBe("Just");
    expect(r._0).toEqual([[{ name: "x", value: "d" }]]);
  });

  it("QUERY-level not over a derived predicate antijoins its completed extension: nodes x ∧ ¬reachableP x ⇒ {d}", () => {
    const r = dispatchEngineBody("engine:solveRelAll", [
      ECall("and", [
        ECall("nodes", [EVar("x")]),
        ECall("not", [ECall("reachableP", [EVar("x")])]),
      ]),
      factsOf([NODES, EDGE, SOURCE], [REACHABLE]),
    ]) as MaybeV;
    expect(r.$tag).toBe("Just");
    expect(r._0).toEqual([[{ name: "x", value: "d" }]]);
  });

  it("UNSTRATIFIABLE (win/lose: win(x) :- move(x,y), not win(y)) ⇒ Nothing (a negative edge inside an SCC)", () => {
    const MOVE = rel("moveR", 2, [
      ["a", "b"],
      ["b", "c"],
    ]);
    const WIN = {
      name: "winR",
      params: ["x"],
      body: ECall("and", [
        ECall("moveR", [EVar("x"), EVar("y")]),
        ECall("not", [ECall("winR", [EVar("y")])]),
      ]),
    };
    const r = dispatchedSolveRel(
      ECall("winR", [EVar("x")]),
      factsOf([MOVE], [WIN]),
    ) as MaybeV;
    expect(r.$tag).toBe("Nothing");
  });

  it("a negated derived head with MISMATCHED arity still fences ⇒ Nothing (same verdict as pre-13b)", () => {
    const IS_PARENT = {
      name: "isParent",
      params: ["p"],
      body: ECall("parentOf", [EVar("p"), EVar("q")]),
    };
    const r = dispatchedSolveRel(
      ECall("and", [
        ECall("parentOf", [EVar("x"), EVar("y")]),
        ECall("not", [ECall("isParent", [EVar("y"), EVar("y")])]),
      ]),
      factsOf([CHAIN], [IS_PARENT]),
    ) as MaybeV;
    expect(r.$tag).toBe("Nothing");
  });
});

// ---------------------------------------------------------------------------
// or-in-body — a NON-recursive disjunctive rule now materializes (was fenced).
// ---------------------------------------------------------------------------

describe("13b — or inside a rule body", () => {
  it("pOrQ(x) :- relA(x) | relB(x) ⇒ the union {1, 2} (per-branch rules, shared 64-cap)", () => {
    const A = rel("relA", 1, [[1]]);
    const B = rel("relB", 1, [[2]]);
    const P_OR_Q = {
      name: "pOrQ",
      params: ["x"],
      body: ECall("or", [ECall("relA", [EVar("x")]), ECall("relB", [EVar("x")])]),
    };
    const r = dispatchEngineBody("engine:solveRelAll", [
      ECall("pOrQ", [EVar("x")]),
      factsOf([A, B], [P_OR_Q]),
    ]) as MaybeV;
    expect(r.$tag).toBe("Just");
    expect(r._0).toEqual([
      [{ name: "x", value: 1 }],
      [{ name: "x", value: 2 }],
    ]);
  });
});

// ---------------------------------------------------------------------------
// Fences — unmaterializable rule; fixpoint fuel (mechanical probes).
// ---------------------------------------------------------------------------

describe("13b — fences", () => {
  it("a context-safe-only RECURSIVE rule cannot materialize ⇒ Nothing (branch with ungrounded params)", () => {
    // badP(x) :- (relA(x), badP(x)) | x > 0 — the second branch grounds x by
    // NO positive atom; a finite standalone extension does not exist.
    const A = rel("relA", 1, [[1]]);
    const BAD = {
      name: "badP",
      params: ["x"],
      body: ECall("or", [
        ECall("and", [ECall("relA", [EVar("x")]), ECall("badP", [EVar("x")])]),
        ECall("gt", [EVar("x"), ELit(0)]),
      ]),
    };
    const r = dispatchedSolveRel(
      ECall("badP", [EVar("x")]),
      factsOf([A], [BAD]),
    ) as MaybeV;
    expect(r.$tag).toBe("Nothing");
  });

  it("relFixLoop: fuel exhausted with a NONEMPTY delta ⇒ Nothing (never a partial Just)", () => {
    const r = dispatchEngineBody("engine:relFixLoop", [
      [],
      [{ name: "p", rows: [] }],
      [{ name: "p", rows: [[1]] }],
      0,
    ]) as MaybeV;
    expect(r.$tag).toBe("Nothing");
  });

  it("relFixLoop: the same state with fuel 1 completes (the round derives nothing new)", () => {
    const r = dispatchEngineBody("engine:relFixLoop", [
      [],
      [{ name: "p", rows: [] }],
      [{ name: "p", rows: [[1]] }],
      1,
    ]) as MaybeV;
    expect(r.$tag).toBe("Just");
  });

  it("relFixpointFuel: min(4096, 1 + |rules|·cells^maxArity) — 2 fact cells, arity 1, 1 rule ⇒ 3", () => {
    const fuel = dispatchEngineBody("engine:relFixpointFuel", [
      [{ name: "p", params: ["x"], branches: [] }],
      [{ name: "r", arity: 1, rows: [[1], [2]] }],
    ]);
    expect(fuel).toBe(3);
  });

  it("relFixpointFuel caps at the 4096 fence constant", () => {
    const bigRows = Array.from({ length: 200 }, (_, i) => [i, i + 1]);
    const fuel = dispatchEngineBody("engine:relFixpointFuel", [
      [{ name: "p", params: ["x", "y"], branches: [] }],
      [{ name: "r", arity: 2, rows: bigRows }],
    ]);
    expect(fuel).toBe(4096);
  });
});

// ---------------------------------------------------------------------------
// The rel.seminaive differential — naive ≡ semi-naive on the recursive corpus
// (the executable cross-face pin for the rel.fixpoint / rel.seminaive
// TCB-ledger rows).
// ---------------------------------------------------------------------------

describe("13b — naive-vs-semi-naive agreement (the ledger pin)", () => {
  const extensionsOf = (r: MaybeV) => {
    const map = new Map<string, string[]>();
    for (const e of r._0 as { name: string; arity: number; rows: unknown[][] }[]) {
      map.set(e.name, sortedRows(e.rows));
    }
    return map;
  };

  const agree = (facts: unknown, sccPreds: string[]) => {
    const semi = dispatchEngineBody("engine:relMaterializeScc", [facts, [], sccPreds]) as MaybeV;
    const naive = dispatchEngineBody("engine:relMaterializeSccNaive", [facts, [], sccPreds]) as MaybeV;
    expect(semi.$tag).toBe("Just");
    expect(naive.$tag).toBe("Just");
    expect(extensionsOf(semi)).toEqual(extensionsOf(naive));
    return extensionsOf(semi);
  };

  it("ancestor over the CYCLIC graph: identical extensions", () => {
    const CYC = rel("parentOf", 2, [
      ["a", "b"],
      ["b", "a"],
      ["b", "c"],
    ]);
    const ext = agree(factsOf([CYC], [ANCESTOR]), ["ancestor"]);
    expect(ext.get("ancestor")!.length).toBe(6); // {a,b} each reach {a,b,c}; c reaches nothing — 2×3

  });

  it("even/odd (the two-predicate SCC): identical extensions", () => {
    const ext = agree(factsOf([ZERO, SUCC], [EVEN, ODD]), ["even", "odd"]);
    expect(ext.get("even")!.length).toBe(3);
    expect(ext.get("odd")!.length).toBe(2);
  });

  it("path (non-linear, two delta positions): identical extensions", () => {
    const EDGE = rel("edge", 2, [
      [1, 2],
      [2, 3],
      [3, 4],
    ]);
    const PATH = {
      name: "path",
      params: ["x", "y"],
      body: ECall("or", [
        ECall("edge", [EVar("x"), EVar("y")]),
        ECall("and", [
          ECall("path", [EVar("x"), EVar("z")]),
          ECall("path", [EVar("z"), EVar("y")]),
        ]),
      ]),
    };
    const ext = agree(factsOf([EDGE], [PATH]), ["path"]);
    expect(ext.get("path")!.length).toBe(6);
  });
});
