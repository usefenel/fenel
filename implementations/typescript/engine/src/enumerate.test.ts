// expr-substrate Phase 15 — conformance tests for `enumerate` / `sample` /
// `optimize` (the findall family + seeded sampling + argmin/argmax, ALL
// compositions over the ONE WitSet marker vocabulary). brief:
// `workstreams/expr-substrate/briefs/phase-15-enumeration-sample-optimize.md`.
//
// THE LOAD-BEARING SPLIT: `Just [] ≠ Nothing` — SeNone enumerates to Just []
// (the empty set), whereas SeAll / SeWhere / WsInterval are NOT finitely
// enumerable ⇒ Nothing. The headline: solveFnRelAll returns EVERY grandparent
// pair, not just the first (the P13 payoff). solve / solve-affine / refine /
// rel-solve are PINNED surfaces — UNTOUCHED (this is a NEW sibling).

import { describe, it, expect } from "vitest";
import {
  dispatchEngineBody,
  dispatchedEnumerateSet,
  dispatchedSolveAll,
  dispatchedSolveFnAll,
  dispatchedSolveRelAll,
  dispatchedSolveFnRelAll,
  dispatchedSampleSet,
  dispatchedMinOfSet,
  dispatchedMaxOfSet,
} from "./engine-bodies-dispatch";

// --- tiny Expr builders (plain $tag-tagged objects) ----------------------
const EVar = (name: string) => ({ $tag: "EVar", name });
const ELit = (value: unknown) => ({ $tag: "ELit", value });
const ECall = (fnId: string, args: unknown[]) => ({ $tag: "ECall", fnId, args });

// FenelClosure the way the `fn` op builds it (json-logic.ts).
const closure = (
  params: string[],
  body: unknown,
  scope: Record<string, unknown> = {},
) => ({ __fenelFn: true as const, params, body, closure: scope });

// --- canonical Se* SetExpr builders (the registered $tag shapes) ----------
const SeEnum = (values: unknown[]) => ({ $tag: "SeEnum", values });
const SeNone = { $tag: "SeNone" };
const SeAll = { $tag: "SeAll" };
const SeWhere = { $tag: "SeWhere", pred: { $tag: "ELit", value: true } };
const SeComplement = (inner: unknown) => ({ $tag: "SeComplement", inner });
const SeUnion = (branches: unknown[]) => ({ $tag: "SeUnion", branches });
const SeIntersect = (branches: unknown[]) => ({ $tag: "SeIntersect", branches });
// MB = Maybe { value, inclusive } in the canonical positional encoding.
const MBjust = (value: unknown, inclusive: boolean) => ({ $tag: "Just", _0: { value, inclusive } });
const MBnone = { $tag: "Nothing" };
const SeInterval = (lo: unknown, hi: unknown) => ({ $tag: "SeInterval", interval: { lo, hi } });

type MaybeV = { $tag: string; _0?: unknown };

const rel = (name: string, arity: number, rows: unknown[][]) => ({ name, arity, rows });
const factsOf = (relations: ReturnType<typeof rel>[], rules: unknown[] = []) => ({ relations, rules });

// ---------------------------------------------------------------------------
// enumerateSet — the per-marker table (decision 1).
// ---------------------------------------------------------------------------

describe("enumerateSet — per-marker extension", () => {
  it("WsEnum ⇒ Just (deduped values)", () => {
    const r = dispatchedEnumerateSet(SeEnum([5, 7, 5, 7])) as MaybeV;
    expect(r.$tag).toBe("Just");
    expect(r._0).toEqual([5, 7]);
  });

  it("SeNone ⇒ Just [] (THE empty-vs-undecidable split)", () => {
    const r = dispatchedEnumerateSet(SeNone) as MaybeV;
    expect(r.$tag).toBe("Just");
    expect(r._0).toEqual([]);
  });

  it("SeAll / SeWhere / WsComplement / WsInterval ⇒ Nothing (not finitely enumerable)", () => {
    expect((dispatchedEnumerateSet(SeAll) as MaybeV).$tag).toBe("Nothing");
    expect((dispatchedEnumerateSet(SeWhere) as MaybeV).$tag).toBe("Nothing");
    expect((dispatchedEnumerateSet(SeComplement(SeEnum([1]))) as MaybeV).$tag).toBe("Nothing");
    // the type-erased fence: markers carry no base type ⇒ no Int-stepping.
    expect((dispatchedEnumerateSet(SeInterval(MBjust(0, true), MBjust(9, true))) as MaybeV).$tag).toBe("Nothing");
  });

  it("WsUnion ⇒ Just (deduped concat) when ALL branches enumerate", () => {
    const r = dispatchedEnumerateSet(SeUnion([SeEnum([1, 2]), SeEnum([2, 3])])) as MaybeV;
    expect(r.$tag).toBe("Just");
    expect(r._0).toEqual([1, 2, 3]);
  });

  it("WsUnion with a non-enumerable branch ⇒ Nothing", () => {
    const r = dispatchedEnumerateSet(SeUnion([SeEnum([1]), SeInterval(MBnone, MBjust(5, true))])) as MaybeV;
    expect(r.$tag).toBe("Nothing");
  });

  it("WsIntersect of WsEnums ⇒ Just (EXACT intersection)", () => {
    const r = dispatchedEnumerateSet(SeIntersect([SeEnum([1, 2, 3]), SeEnum([2, 3, 4])])) as MaybeV;
    expect(r.$tag).toBe("Just");
    expect(r._0).toEqual([2, 3]);
  });

  it("WsIntersect with a non-WsEnum branch ⇒ Nothing (exactness over progress)", () => {
    const r = dispatchedEnumerateSet(SeIntersect([SeEnum([1, 2]), SeInterval(MBnone, MBjust(5, true))])) as MaybeV;
    expect(r.$tag).toBe("Nothing");
  });

  it("the relational SeEnum-of-binding-rows enumerates to all rows (Stage B, the P-1 form)", () => {
    const rows = [
      [{ name: "x", value: "anna" }, { name: "y", value: "bob" }],
      [{ name: "x", value: "carl" }, { name: "y", value: "dan" }],
    ];
    const r = dispatchedEnumerateSet(SeEnum(rows)) as MaybeV;
    expect(r.$tag).toBe("Just");
    expect(r._0).toEqual(rows);
  });
});

// ---------------------------------------------------------------------------
// solveAll / solveFnAll — single-free-var findall + the fences (decision 3).
// ---------------------------------------------------------------------------

describe("solveAll / solveFnAll — single-var findall", () => {
  it("solveAll (x == 5 or x == 7) ⇒ Just [5, 7]", () => {
    const expr = ECall("or", [
      ECall("eq", [EVar("x"), ELit(5)]),
      ECall("eq", [EVar("x"), ELit(7)]),
    ]);
    const r = dispatchedSolveAll(expr) as MaybeV;
    expect(r.$tag).toBe("Just");
    expect(r._0).toEqual([5, 7]);
  });

  it("solveAll single eq ⇒ Just [5]", () => {
    const r = dispatchedSolveAll(ECall("eq", [EVar("x"), ELit(5)])) as MaybeV;
    expect(r.$tag).toBe("Just");
    expect(r._0).toEqual([5]);
  });

  it("0-free-var fence (ELit true) ⇒ Nothing", () => {
    expect((dispatchedSolveAll(ELit(true)) as MaybeV).$tag).toBe("Nothing");
  });

  it("≥2-free-var fence (eq x y) ⇒ Nothing", () => {
    expect((dispatchedSolveAll(ECall("eq", [EVar("x"), EVar("y")])) as MaybeV).$tag).toBe("Nothing");
  });

  it("solveFnAll (\\x -> x == 5 or x == 7) ⇒ Just [5, 7]", () => {
    const r = dispatchedSolveFnAll(
      closure(["x"], { or: [{ call: ["eq", { var: "x" }, 5] }, { call: ["eq", { var: "x" }, 7] }] }),
    ) as MaybeV;
    expect(r.$tag).toBe("Just");
    expect(r._0).toEqual([5, 7]);
  });

  it("solveFnAll over a native / bodyless fn ⇒ Nothing (reify Err)", () => {
    expect((dispatchedSolveFnAll("std:add") as MaybeV).$tag).toBe("Nothing");
  });

  it("the reify-substitution payoff: captured y ⇒ solveFnAll (\\x -> x == y) ⇒ Just [5]", () => {
    const r = dispatchedSolveFnAll(
      closure(["x"], { call: ["eq", { var: "x" }, { var: "y" }] }, { y: 5 }),
    ) as MaybeV;
    expect(r.$tag).toBe("Just");
    expect(r._0).toEqual([5]);
  });
});

// ---------------------------------------------------------------------------
// THE GRANDPARENT FINDALL HEADLINE — solveRelAll / solveFnRelAll return ALL.
// ---------------------------------------------------------------------------

describe("solveRelAll / solveFnRelAll — the grandparent findall headline", () => {
  // two paths to eleonora: anna→bob→eleonora AND zoe→bob→eleonora.
  const PARENT2 = rel("parentOf", 2, [
    ["anna", "bob"],
    ["zoe", "bob"],
    ["bob", "eleonora"],
    ["carl", "dan"],
  ]);

  it("solveFnRelAll: \\x y -> and (parentOf x y) (parentOf y \"eleonora\") ⇒ BOTH {anna,bob} and {zoe,bob}", () => {
    const r = dispatchedSolveFnRelAll(
      closure(["x", "y"], {
        and: [
          { call: ["parentOf", { var: "x" }, { var: "y" }] },
          { call: ["parentOf", { var: "y" }, "eleonora"] },
        ],
      }),
      factsOf([PARENT2]),
    ) as MaybeV;
    expect(r.$tag).toBe("Just");
    expect(r._0).toEqual([
      [{ name: "x", value: "anna" }, { name: "y", value: "bob" }],
      [{ name: "x", value: "zoe" }, { name: "y", value: "bob" }],
    ]);
  });

  it("solveRelAll (Expr-direct): same query ⇒ BOTH bindings (collectFreeVars order x,y)", () => {
    const expr = ECall("and", [
      ECall("parentOf", [EVar("x"), EVar("y")]),
      ECall("parentOf", [EVar("y"), ELit("eleonora")]),
    ]);
    const r = dispatchedSolveRelAll(expr, factsOf([PARENT2])) as MaybeV;
    expect(r.$tag).toBe("Just");
    expect(r._0).toEqual([
      [{ name: "x", value: "anna" }, { name: "y", value: "bob" }],
      [{ name: "x", value: "zoe" }, { name: "y", value: "bob" }],
    ]);
  });

  it("safe-but-empty ⇒ Just [] (the NEW semantic split: no rows ≠ unsafe)", () => {
    // parentOf x "nobody" — grounded + safe, but no fact row matches.
    const r = dispatchedSolveRelAll(
      ECall("parentOf", [EVar("x"), ELit("nobody")]),
      factsOf([PARENT2]),
    ) as MaybeV;
    expect(r.$tag).toBe("Just");
    expect(r._0).toEqual([]);
  });

  it("unsafe (no relation grounds the vars): eq x y ⇒ Nothing", () => {
    const r = dispatchedSolveRelAll(
      ECall("eq", [EVar("x"), EVar("y")]),
      factsOf([PARENT2]),
    ) as MaybeV;
    expect(r.$tag).toBe("Nothing");
  });

  it("solveFnRelAll over a native / bodyless fn ⇒ Nothing (reify Err)", () => {
    expect((dispatchedSolveFnRelAll("std:add", factsOf([PARENT2])) as MaybeV).$tag).toBe("Nothing");
  });
});

// ---------------------------------------------------------------------------
// sampleSet — seeded determinism (decision 4).
// ---------------------------------------------------------------------------

describe("sampleSet — seeded pure choice", () => {
  const S = SeEnum([10, 20, 30]);

  it("same seed ⇒ same pick (deterministic, pinned)", () => {
    expect((dispatchedSampleSet(1, S) as MaybeV)._0).toBe(30);
    expect((dispatchedSampleSet(1, S) as MaybeV)._0).toBe(30);
    expect((dispatchedSampleSet(2, S) as MaybeV)._0).toBe(10);
  });

  it("a negative seed normalises into range (does not crash / stay negative)", () => {
    const r = dispatchedSampleSet(-5, S) as MaybeV;
    expect(r.$tag).toBe("Just");
    expect([10, 20, 30]).toContain(r._0);
  });

  it("empty enumeration (SeNone) ⇒ Nothing", () => {
    expect((dispatchedSampleSet(1, SeNone) as MaybeV).$tag).toBe("Nothing");
  });

  it("non-enumerable (interval — continuous) ⇒ Nothing (honest)", () => {
    expect((dispatchedSampleSet(1, SeInterval(MBjust(0, true), MBjust(9, true))) as MaybeV).$tag).toBe("Nothing");
  });
});

// ---------------------------------------------------------------------------
// minOfSet / maxOfSet — argmin/argmax, two tiers (decision 5).
// ---------------------------------------------------------------------------

describe("minOfSet / maxOfSet — optimize", () => {
  it("tier 1 over a numeric enum", () => {
    expect((dispatchedMinOfSet(SeEnum([3, 1, 2])) as MaybeV)._0).toBe(1);
    expect((dispatchedMaxOfSet(SeEnum([3, 1, 2])) as MaybeV)._0).toBe(3);
  });

  it("tier 1 over a STRING enum (the std minimum/maximum natives order strings; lt/gt would not)", () => {
    expect((dispatchedMinOfSet(SeEnum(["banana", "apple", "cherry"])) as MaybeV)._0).toBe("apple");
    expect((dispatchedMaxOfSet(SeEnum(["banana", "apple", "cherry"])) as MaybeV)._0).toBe("cherry");
  });

  it("the empty set ⇒ Nothing (no extremum of ∅)", () => {
    expect((dispatchedMinOfSet(SeNone) as MaybeV).$tag).toBe("Nothing");
    expect((dispatchedMaxOfSet(SeNone) as MaybeV).$tag).toBe("Nothing");
  });

  it("tier 2 — interval endpoints: inclusive ⇒ Just, exclusive/unbounded ⇒ Nothing", () => {
    const closed = SeInterval(MBjust(3, true), MBjust(7, true));
    expect((dispatchedMinOfSet(closed) as MaybeV)._0).toBe(3);
    expect((dispatchedMaxOfSet(closed) as MaybeV)._0).toBe(7);
    const openLo = SeInterval(MBjust(3, false), MBjust(7, true));
    expect((dispatchedMinOfSet(openLo) as MaybeV).$tag).toBe("Nothing"); // no attained infimum
    expect((dispatchedMaxOfSet(openLo) as MaybeV)._0).toBe(7);
    const unbounded = SeInterval(MBnone, MBjust(7, true));
    expect((dispatchedMinOfSet(unbounded) as MaybeV).$tag).toBe("Nothing");
  });

  it("tier 2 — WsIntersect folds the interval branches then takes the endpoint", () => {
    // x >= 3  ∩  x <= 7  ⇒ [3, 7]  ⇒ min 3, max 7.
    const branches = SeIntersect([
      SeInterval(MBjust(3, true), MBnone),
      SeInterval(MBnone, MBjust(7, true)),
    ]);
    expect((dispatchedMinOfSet(branches) as MaybeV)._0).toBe(3);
    expect((dispatchedMaxOfSet(branches) as MaybeV)._0).toBe(7);
  });

  it("a non-scalar extension (binding-rows) ⇒ Nothing (no canonical order — the Stage-B guard)", () => {
    const t = SeEnum([[{ name: "x", value: "anna" }], [{ name: "x", value: "bob" }]]);
    expect((dispatchedMinOfSet(t) as MaybeV).$tag).toBe("Nothing");
    expect((dispatchedMaxOfSet(t) as MaybeV).$tag).toBe("Nothing");
  });

  it("SeAll / SeWhere / WsComplement / union-of-intervals ⇒ Nothing", () => {
    expect((dispatchedMinOfSet(SeAll) as MaybeV).$tag).toBe("Nothing");
    expect((dispatchedMinOfSet(SeWhere) as MaybeV).$tag).toBe("Nothing");
    expect((dispatchedMinOfSet(SeComplement(SeEnum([1]))) as MaybeV).$tag).toBe("Nothing");
    const unionIntervals = SeUnion([SeInterval(MBjust(0, true), MBjust(1, true)), SeInterval(MBjust(5, true), MBjust(6, true))]);
    expect((dispatchedMinOfSet(unionIntervals) as MaybeV).$tag).toBe("Nothing");
  });
});

// ---------------------------------------------------------------------------
// relSolveSet — the split is the SET seam (decision 2). Probe the new core fn.
// ---------------------------------------------------------------------------

describe("relSolveSet — the set-returning core split", () => {
  const PARENT = rel("parentOf", 2, [["anna", "bob"], ["bob", "eleonora"]]);

  it("returns the SeEnum-of-binding-rows set (Just), not the first witness (Stage B)", () => {
    const expr = ECall("parentOf", [EVar("x"), EVar("y")]);
    const w = dispatchEngineBody("engine:relSolveSet", [["x", "y"], expr, factsOf([PARENT])]) as MaybeV;
    expect(w.$tag).toBe("Just");
    expect((w._0 as { $tag: string }).$tag).toBe("SeEnum");
    expect((w._0 as { values: unknown[] }).values).toEqual([
      [{ name: "x", value: "anna" }, { name: "y", value: "bob" }],
      [{ name: "x", value: "bob" }, { name: "y", value: "eleonora" }],
    ]);
  });

  it("safe-but-empty ⇒ Just (SeEnum []); a fence (empty vars) ⇒ Nothing", () => {
    const empty = dispatchEngineBody("engine:relSolveSet", [
      ["x"], ECall("parentOf", [EVar("x"), ELit("nobody")]), factsOf([PARENT]),
    ]) as MaybeV;
    expect(empty.$tag).toBe("Just");
    expect((empty._0 as { values: unknown[] }).values).toEqual([]);

    const fence = dispatchEngineBody("engine:relSolveSet", [
      [], ECall("parentOf", [EVar("x"), EVar("y")]), factsOf([PARENT]),
    ]) as MaybeV;
    expect(fence.$tag).toBe("Nothing");
  });
});

// ---------------------------------------------------------------------------
// Exemplifiable convergence — demonstrated, not wired (decision 8).
// ---------------------------------------------------------------------------

describe("enumerateSet — Exemplifiable shape demo (decision 8, demonstrated)", () => {
  it("enumerateSet output is a sample-list an Exemplifiable consumer can map over", () => {
    // 6c's Exemplifiable sources sample VALUES; enumerateSet yields exactly that
    // shape — a plain List the sampler/exemplar machinery consumes. Same
    // machinery, two consumers (the law-machinery wiring is the 6c follow-on).
    const r = dispatchedEnumerateSet(SeEnum([1, 2, 3])) as MaybeV;
    expect(r.$tag).toBe("Just");
    const samples = r._0 as number[];
    expect(Array.isArray(samples)).toBe(true);
    expect(samples.map((n) => n * 10)).toEqual([10, 20, 30]); // directly consumable
  });
});
