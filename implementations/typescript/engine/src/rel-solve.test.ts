// expr-substrate Phase 13 — conformance tests for `solveRel` / `solveFnRel`
// (multi-binder relational solve; stage-1 conjunctive Datalog over a THREADED
// finite fact base). brief:
// `workstreams/expr-substrate/briefs/phase-13-relational-solve.md`.
//
// The headline: `solveFn (\x y -> and (parentOf x y) (parentOf y "eleonora"))`
// over a 3-row facts env ⇒ the bindings `{x = "anna", y = "bob"}`. solve.test
// .ts / solve-affine.test.ts / refine.test.ts are PINNED surfaces — UNTOUCHED
// (this is a NEW sibling); the ≥2-var Nothing pin survives there as the
// UNSAFE-query case.

import { describe, it, expect } from "vitest";
import {
  dispatchEngineBody,
  dispatchedSolveRel,
  dispatchedSolveFnRel,
} from "./engine-bodies-dispatch";

// --- tiny Expr builders (plain $tag-tagged objects) ----------------------
const EVar = (name: string) => ({ $tag: "EVar", name });
const ELit = (value: unknown) => ({ $tag: "ELit", value });
const ECall = (fnId: string, args: unknown[]) => ({ $tag: "ECall", fnId, args });

// FenelClosure the way the `fn` op builds it (json-logic.ts:1729).
const closure = (
  params: string[],
  body: unknown,
  scope: Record<string, unknown> = {},
) => ({ __fenelFn: true as const, params, body, closure: scope });

type MaybeV = { $tag: string; _0?: unknown };

const rel = (name: string, arity: number, rows: unknown[][]) => ({ name, arity, rows });
const factsOf = (
  relations: ReturnType<typeof rel>[],
  rules: { name: string; params: string[]; body: unknown }[] = [],
) => ({ relations, rules });

// The canonical 3-row family relation (parent, child).
const PARENT = rel("parentOf", 2, [
  ["anna", "bob"],
  ["bob", "eleonora"],
  ["carl", "dan"],
]);

// ---------------------------------------------------------------------------
// The headline — the grandparent query, both entries.
// ---------------------------------------------------------------------------

describe("solveRel / solveFnRel — the grandparent headline", () => {
  it("solveFnRel: \\x y -> and (parentOf x y) (parentOf y \"eleonora\") ⇒ {x=anna, y=bob}", () => {
    const r = dispatchedSolveFnRel(
      closure(["x", "y"], {
        and: [
          { call: ["parentOf", { var: "x" }, { var: "y" }] },
          { call: ["parentOf", { var: "y" }, "eleonora"] },
        ],
      }),
      factsOf([PARENT]),
    ) as MaybeV;
    expect(r.$tag).toBe("Just");
    expect(r._0).toEqual([
      { name: "x", value: "anna" },
      { name: "y", value: "bob" },
    ]);
  });

  it("solveRel (Expr-direct): same query ⇒ same bindings (collectFreeVars order x,y)", () => {
    const expr = ECall("and", [
      ECall("parentOf", [EVar("x"), EVar("y")]),
      ECall("parentOf", [EVar("y"), ELit("eleonora")]),
    ]);
    const r = dispatchedSolveRel(expr, factsOf([PARENT])) as MaybeV;
    expect(r.$tag).toBe("Just");
    expect(r._0).toEqual([
      { name: "x", value: "anna" },
      { name: "y", value: "bob" },
    ]);
  });
});

// ---------------------------------------------------------------------------
// Single-var relational, constant select, repeated var.
// ---------------------------------------------------------------------------

describe("solveRel — 1-var / constant-select / repeated-var", () => {
  it("1-var: parentOf x \"eleonora\" ⇒ x=bob", () => {
    const r = dispatchedSolveRel(
      ECall("parentOf", [EVar("x"), ELit("eleonora")]),
      factsOf([PARENT]),
    ) as MaybeV;
    expect(r.$tag).toBe("Just");
    expect(r._0).toEqual([{ name: "x", value: "bob" }]);
  });

  it("constant select: parentOf \"bob\" y ⇒ y=eleonora", () => {
    const r = dispatchedSolveRel(
      ECall("parentOf", [ELit("bob"), EVar("y")]),
      factsOf([PARENT]),
    ) as MaybeV;
    expect(r.$tag).toBe("Just");
    expect(r._0).toEqual([{ name: "y", value: "eleonora" }]);
  });

  it("repeated var in ONE atom: eqRel x x ⇒ x=1 (matches only equal-pairs rows)", () => {
    const eqRel = rel("eqRel", 2, [
      [1, 1],
      [2, 3],
      [5, 5],
    ]);
    const r = dispatchedSolveRel(
      ECall("eqRel", [EVar("x"), EVar("x")]),
      factsOf([eqRel]),
    ) as MaybeV;
    expect(r.$tag).toBe("Just");
    expect(r._0).toEqual([{ name: "x", value: 1 }]);
  });
});

// ---------------------------------------------------------------------------
// Cross-product vs shared-var-join correlation (decision 1).
// ---------------------------------------------------------------------------

describe("solveRel — cross-product vs shared-var correlation", () => {
  const r1 = rel("r1", 1, [[1], [2]]);
  const r2 = rel("r2", 1, [[3], [4]]);

  it("cross-product (no shared vars): and (r1 x) (r2 y) ⇒ first = {x=1, y=3}", () => {
    const r = dispatchedSolveRel(
      ECall("and", [ECall("r1", [EVar("x")]), ECall("r2", [EVar("y")])]),
      factsOf([r1, r2]),
    ) as MaybeV;
    expect(r.$tag).toBe("Just");
    expect(r._0).toEqual([
      { name: "x", value: 1 },
      { name: "y", value: 3 },
    ]);
  });

  it("shared-var join keeps the CORRELATION: and (edge x y) (node y), node={4} ⇒ {x=2, y=4}", () => {
    // edge pairs x with y; only the row whose y is in node survives — and x
    // must travel WITH its y (the correlation per-var domains would lose).
    const edge = rel("edge", 2, [
      [1, 3],
      [2, 4],
    ]);
    const node = rel("node", 1, [[4]]);
    const r = dispatchedSolveRel(
      ECall("and", [ECall("edge", [EVar("x"), EVar("y")]), ECall("node", [EVar("y")])]),
      factsOf([edge, node]),
    ) as MaybeV;
    expect(r.$tag).toBe("Just");
    expect(r._0).toEqual([
      { name: "x", value: 2 },
      { name: "y", value: 4 },
    ]);
  });
});

// ---------------------------------------------------------------------------
// Residual filters — affine (P12), P12-compound, string-eq, undecided.
// ---------------------------------------------------------------------------

describe("solveRel — residual filters (proven-rows)", () => {
  it("affine residual lt x y: pair={(5,2),(1,9)} ⇒ {x=1, y=9}", () => {
    const pair = rel("pair", 2, [
      [5, 2],
      [1, 9],
    ]);
    const r = dispatchedSolveRel(
      ECall("and", [ECall("pair", [EVar("x"), EVar("y")]), ECall("lt", [EVar("x"), EVar("y")])]),
      factsOf([pair]),
    ) as MaybeV;
    expect(r.$tag).toBe("Just");
    expect(r._0).toEqual([
      { name: "x", value: 1 },
      { name: "y", value: 9 },
    ]);
  });

  it("P12-compound residual 2*x + 1 <= y: pair={(2,3),(1,4)} ⇒ {x=1, y=4}", () => {
    const pair = rel("pair", 2, [
      [2, 3],
      [1, 4],
    ]);
    const residual = ECall("lte", [
      ECall("add", [ECall("mul", [ELit(2), EVar("x")]), ELit(1)]),
      EVar("y"),
    ]);
    const r = dispatchedSolveRel(
      ECall("and", [ECall("pair", [EVar("x"), EVar("y")]), residual]),
      factsOf([pair]),
    ) as MaybeV;
    expect(r.$tag).toBe("Just");
    expect(r._0).toEqual([
      { name: "x", value: 1 },
      { name: "y", value: 4 },
    ]);
  });

  it("string-eq residual: and (person x) (eq x \"bob\") ⇒ x=bob", () => {
    const person = rel("person", 1, [["anna"], ["bob"]]);
    const r = dispatchedSolveRel(
      ECall("and", [ECall("person", [EVar("x")]), ECall("eq", [EVar("x"), ELit("bob")])]),
      factsOf([person]),
    ) as MaybeV;
    expect(r.$tag).toBe("Just");
    expect(r._0).toEqual([{ name: "x", value: "bob" }]);
  });

  it("UNDECIDED residual ⇒ rows excluded ⇒ Nothing (proven-rows under-approx)", () => {
    const person = rel("person", 1, [["anna"], ["bob"]]);
    // `foo` is neither a relation nor a rule ⇒ a residual; closedEval can't
    // decide `foo(...)` ⇒ every row dropped ⇒ Nothing (we only assert proven).
    const r = dispatchedSolveRel(
      ECall("and", [ECall("person", [EVar("x")]), ECall("foo", [EVar("x")])]),
      factsOf([person]),
    ) as MaybeV;
    expect(r.$tag).toBe("Nothing");
  });
});

// ---------------------------------------------------------------------------
// Fences — unsafe / or / not / arity / empty.
// ---------------------------------------------------------------------------

describe("solveRel — stage-1 fences ⇒ Nothing", () => {
  it("unsafe (no relation grounds the vars): eq x y ⇒ Nothing", () => {
    const r = dispatchedSolveRel(
      ECall("eq", [EVar("x"), EVar("y")]),
      factsOf([PARENT]),
    ) as MaybeV;
    expect(r.$tag).toBe("Nothing");
  });

  it("decide-substrate P4T GAIN: relation atoms under `or` now SOLVE (DNF union) — first union row", () => {
    // Was the 13b or-fence (Nothing). dnfBranches splits into two conjunctive
    // branches; branch 1 (parentOf x y) yields (anna,bob) first ⇒ the witness.
    const r = dispatchedSolveRel(
      ECall("or", [ECall("parentOf", [EVar("x"), EVar("y")]), ECall("parentOf", [EVar("y"), EVar("x")])]),
      factsOf([PARENT]),
    ) as MaybeV;
    expect(r.$tag).toBe("Just");
    expect(r._0).toEqual([
      { name: "x", value: "anna" },
      { name: "y", value: "bob" },
    ]);
  });

  it("decide-substrate P4T GAIN: ground `not` over a relation atom ANTIJOINS (negation-as-failure)", () => {
    // Was the 13b not-fence (Nothing). x,y positively grounded; no reversed
    // pair is a fact ⇒ all 3 rows survive ⇒ the first witnesses.
    const r = dispatchedSolveRel(
      ECall("and", [
        ECall("parentOf", [EVar("x"), EVar("y")]),
        ECall("not", [ECall("parentOf", [EVar("y"), EVar("x")])]),
      ]),
      factsOf([PARENT]),
    ) as MaybeV;
    expect(r.$tag).toBe("Just");
    expect(r._0).toEqual([
      { name: "x", value: "anna" },
      { name: "y", value: "bob" },
    ]);
  });

  it("arity mismatch (parentOf x — 1 arg, arity 2) ⇒ Nothing", () => {
    const r = dispatchedSolveRel(
      ECall("parentOf", [EVar("x")]),
      factsOf([PARENT]),
    ) as MaybeV;
    expect(r.$tag).toBe("Nothing");
  });

  it("empty relation ⇒ Nothing", () => {
    const r = dispatchedSolveRel(
      ECall("parentOf", [EVar("x"), EVar("y")]),
      factsOf([rel("parentOf", 2, [])]),
    ) as MaybeV;
    expect(r.$tag).toBe("Nothing");
  });
});

// ---------------------------------------------------------------------------
// Rules — unfold (same answer as inline) + recursion (13b least fixpoint).
// ---------------------------------------------------------------------------

describe("solveRel — rule unfold + recursion", () => {
  // grandparentOf(a, c) :- parentOf(a, b), parentOf(b, c)  (body PRE-REIFIED).
  const grandparentRule = {
    name: "grandparentOf",
    params: ["a", "c"],
    body: ECall("and", [
      ECall("parentOf", [EVar("a"), EVar("b")]),
      ECall("parentOf", [EVar("b"), EVar("c")]),
    ]),
  };

  it("rule unfold: grandparentOf x \"eleonora\" ⇒ x=anna (same answer as the inline query)", () => {
    const r = dispatchedSolveRel(
      ECall("grandparentOf", [EVar("x"), ELit("eleonora")]),
      factsOf([PARENT], [grandparentRule]),
    ) as MaybeV;
    expect(r.$tag).toBe("Just");
    expect(r._0).toEqual([{ name: "x", value: "anna" }]);
  });

  it("recursive rule with NO base case (anc :- anc) ⇒ Nothing (13b: the least fixpoint is the EMPTY extension — same verdict as the old fence, via semantics)", () => {
    const ancRule = {
      name: "anc",
      params: ["a", "c"],
      body: ECall("anc", [EVar("a"), EVar("c")]),
    };
    const r = dispatchedSolveRel(
      ECall("anc", [EVar("x"), ELit("eleonora")]),
      factsOf([PARENT], [ancRule]),
    ) as MaybeV;
    expect(r.$tag).toBe("Nothing");
  });
});

// ---------------------------------------------------------------------------
// Dedupe + witness shape (internal-fn probes).
// ---------------------------------------------------------------------------

describe("solveRel — dedupe + witness shape", () => {
  it("projectTupleSet dedupes (set semantics): two rows projecting to anna ⇒ one", () => {
    const out = dispatchEngineBody("engine:projectTupleSet", [
      ["x"],
      { vars: ["x", "c"], rows: [["anna", "red"], ["anna", "blue"]] },
    ]) as { vars: string[]; rows: unknown[][] };
    expect(out.vars).toEqual(["x"]);
    expect(out.rows).toEqual([["anna"]]);
  });

  it("the relational tuple-set is SeEnum-of-binding-rows; inhabit ⇒ the first row (Stage B, the P-1 form)", () => {
    // rowsToBindings pre-zips each projected row with the vars at the emit
    // site; the witness is just inhabit's plain SeEnum arm.
    const rows = dispatchEngineBody("engine:rowsToBindings", [
      ["x", "y"],
      [["anna", "bob"], ["carl", "dan"]],
      [],
    ]);
    const w = dispatchEngineBody("engine:inhabit", [
      { $tag: "SeEnum", values: rows },
    ]) as MaybeV;
    expect(w.$tag).toBe("Just");
    expect(w._0).toEqual([
      { name: "x", value: "anna" },
      { name: "y", value: "bob" },
    ]);
  });

  it("a native / bodyless fn ⇒ Nothing (reify Err ⇒ Nothing) via solveFnRel", () => {
    expect((dispatchedSolveFnRel("std:add", factsOf([PARENT])) as MaybeV).$tag).toBe("Nothing");
  });
});

// ---------------------------------------------------------------------------
// decide-substrate Phase 4T Step C — or (DNF union) + ground not (antijoin).
// ---------------------------------------------------------------------------

describe("solveRel — or/not widening (decide-substrate Phase 4T Step C)", () => {
  it("the antijoin actually DROPS rows: parentOf x y AND not (parentOf y 'eleonora') excludes anna→bob", () => {
    // bob parents eleonora, so the (anna, bob) row is antijoined away; the
    // first surviving row is (bob, eleonora).
    const r = dispatchedSolveRel(
      ECall("and", [
        ECall("parentOf", [EVar("x"), EVar("y")]),
        ECall("not", [ECall("parentOf", [EVar("y"), ELit("eleonora")])]),
      ]),
      factsOf([PARENT]),
    ) as MaybeV;
    expect(r.$tag).toBe("Just");
    expect(r._0).toEqual([
      { name: "x", value: "bob" },
      { name: "y", value: "eleonora" },
    ]);
  });

  it("UNSAFE negation (a not-var ungrounded by any positive atom) ⇒ Nothing (the safety condition)", () => {
    // z appears only under not ⇒ open-domain quantification ⇒ fence.
    const r = dispatchedSolveRel(
      ECall("and", [
        ECall("parentOf", [EVar("x"), EVar("y")]),
        ECall("not", [ECall("parentOf", [EVar("y"), EVar("z")])]),
      ]),
      factsOf([PARENT]),
    ) as MaybeV;
    expect(r.$tag).toBe("Nothing");
  });

  it("solveRelAll over an `or` returns the COMPLETE union (deduped)", () => {
    // (parentOf x 'bob') or (parentOf 'bob' x) ⇒ x ∈ {anna, eleonora}.
    const r = dispatchEngineBody("engine:solveRelAll", [
      ECall("or", [
        ECall("parentOf", [EVar("x"), ELit("bob")]),
        ECall("parentOf", [ELit("bob"), EVar("x")]),
      ]),
      factsOf([PARENT]),
    ]) as MaybeV;
    expect(r.$tag).toBe("Just");
    expect(r._0).toEqual([
      [{ name: "x", value: "anna" }],
      [{ name: "x", value: "eleonora" }],
    ]);
  });

  it("or nested under and distributes (DNF product): grandparent-of-eleonora OR parent-of-dan", () => {
    const r = dispatchEngineBody("engine:solveRelAll", [
      ECall("and", [
        ECall("parentOf", [EVar("x"), EVar("y")]),
        ECall("or", [
          ECall("parentOf", [EVar("y"), ELit("eleonora")]),
          ECall("parentOf", [EVar("y"), ELit("dan")]),
        ]),
      ]),
      factsOf([PARENT]),
    ]) as MaybeV;
    expect(r.$tag).toBe("Just");
    // branch 1: y parents eleonora ⇒ (anna, bob); branch 2: y parents dan ⇒ none
    // (nobody parents a parent of dan except… carl parents dan, so y=carl needs
    // parentOf x carl — no fact). Union = [(anna, bob)].
    expect(r._0).toEqual([
      [
        { name: "x", value: "anna" },
        { name: "y", value: "bob" },
      ],
    ]);
  });

  it("a rel-FREE `or` stays a residual (proven-rows path byte-preserved)", () => {
    const AGE = rel("ageOf", 2, [
      ["anna", 63],
      ["bob", 41],
      ["carl", 20],
    ]);
    const r = dispatchEngineBody("engine:solveRelAll", [
      ECall("and", [
        ECall("ageOf", [EVar("x"), EVar("a")]),
        ECall("or", [ECall("gt", [EVar("a"), ELit(60)]), ECall("lt", [EVar("a"), ELit(30)])]),
      ]),
      factsOf([AGE]),
    ]) as MaybeV;
    expect(r.$tag).toBe("Just");
    expect(r._0).toEqual([
      [
        { name: "x", value: "anna" },
        { name: "a", value: 63 },
      ],
      [
        { name: "x", value: "carl" },
        { name: "a", value: 20 },
      ],
    ]);
  });

  it("closed-world honesty: not over an EMPTY relation keeps every row (negation-as-failure)", () => {
    const EMPTY = rel("banned", 1, []);
    const r = dispatchEngineBody("engine:solveRelAll", [
      ECall("and", [
        ECall("parentOf", [EVar("x"), EVar("y")]),
        ECall("not", [ECall("banned", [EVar("x")])]),
      ]),
      factsOf([PARENT, EMPTY]),
    ]) as MaybeV;
    expect(r.$tag).toBe("Just");
    expect((r._0 as unknown[]).length).toBe(3);
  });

  it("13b GAIN: a negated RULE head now DECIDES (stratified negation — the derived predicate materializes; the antijoin runs its completed extension)", () => {
    // isParent = {anna, bob, carl}; (anna, bob) antijoins away (bob IS a
    // parent); the first surviving row is (bob, eleonora). Was the 4T fence
    // (Nothing) — the exact seam 13b removes.
    const r = dispatchedSolveRel(
      ECall("and", [
        ECall("parentOf", [EVar("x"), EVar("y")]),
        ECall("not", [ECall("isParent", [EVar("y")])]),
      ]),
      factsOf([PARENT], [
        { name: "isParent", params: ["p"], body: ECall("parentOf", [EVar("p"), EVar("q")]) },
      ]),
    ) as MaybeV;
    expect(r.$tag).toBe("Just");
    expect(r._0).toEqual([
      { name: "x", value: "bob" },
      { name: "y", value: "eleonora" },
    ]);
  });

  it("13b GAIN: recursion under `or` in a rule body now DECIDES (anc :- parentOf | anc saturates to the parentOf rows)", () => {
    // Was the recursion fence (Nothing). The or-body splits into per-branch
    // rules; the recursive branch derives nothing new ⇒ the least fixpoint
    // is exactly the parentOf extension; the first witness is (anna, bob).
    const anc = {
      name: "anc",
      params: ["a", "b"],
      body: ECall("or", [
        ECall("parentOf", [EVar("a"), EVar("b")]),
        ECall("anc", [EVar("a"), EVar("b")]),
      ]),
    };
    const r = dispatchedSolveRel(
      ECall("anc", [EVar("x"), EVar("y")]),
      factsOf([PARENT], [anc]),
    ) as MaybeV;
    expect(r.$tag).toBe("Just");
    expect(r._0).toEqual([
      { name: "x", value: "anna" },
      { name: "y", value: "bob" },
    ]);
  });
});
