// ---------------------------------------------------------------------------
// array-substrate Phase 1c — multi-rank `Array` + scalar rank-0.
//
// 1b made the ONE-axis `Vec` value real (membership + `Representable`). 1c adds
// the multi-rank `Array` ON TOP — which is just NESTED `Vec` (the subsumption:
// no `$array` primitive, ever). `Array [n0,n1,…] a = $opaque {name:"Array",
// pure: Vec n0 (Vec n1 (… a))}`; `Array [] a = a` (scalar rank-0 = bare
// element). design/array-substrate.md § 1.
//
// D1 (the repr-duality, SETTLED by the Step-0 probe): the canonical runtime
// VALUE of an `Array` is the nested TAGGED `Vec` value (`{$tag:"Vec"}` at every
// rank — NO `{$tag:"Array"}` value tag). So:
//   • it inherits `fmap`/`foldr` at the outer-frame rank DIRECTLY via the
//     structural `(Map k)` instance (no bespoke nominal `Array`/`Vec` instance);
//   • it indexes by RANK-RECURSION — `index (index arr i) j` — composing from
//     `Representable Vec` (D3: `Representable Array` DEFERRED to the Phase-2/3
//     `Lift`/`Rank` generalize, NOT authored as a bespoke multi-index instance);
//   • the nested JS-array form `[[…]]` is the `$opaque.repr` boundary/wire view
//     (the one-repr reconciliation is Phase 7).
//
// The membership floor (deliverable 4) sees through the `$opaque.pure` to the
// OUTER `Vec` → a length-n0 `$where`; the INNER element guard is "any"
// (length-only) — deep nested-element membership is the documented deferral
// (the 1b SURPRISE #1 `setContainsBool`-not-loaded frontier; recovered by
// validate-recursion + Phase-4 conformance).
// ---------------------------------------------------------------------------

import { test, expect, describe, beforeAll } from "bun:test";
import { stdModule } from "./modules/std";
import { engineModule } from "./modules/engine";
import { algebraModule } from "./modules/algebra";
import { createRegistry } from "./registry";
import { dispatchRegistry } from "./system-entities";
import { deriveFunctorModule } from "./engine-bodies-dispatch";
import { evaluate } from "./json-logic";
import { ArrayT, Vec } from "./type-foundation";
import { containsB as contains, typeToSetExpr } from "./index";
import type { EvaluateContext } from "./json-logic";
import type { FenelType } from "./types";

let ctx: EvaluateContext;

beforeAll(() => {
  const reg = createRegistry([stdModule, engineModule, algebraModule, deriveFunctorModule], {
    dispatchRegistry,
  });
  ctx = reg.evaluateContext();
});

const Number_: FenelType = { $ref: "Number" };

// A nested `Array [2,3] Int` runtime value — nested TAGGED `Vec` (D1: no `Array`
// value tag; `{$tag:"Vec"}` at every rank, the dispatch repr).
const ROW0 = { $tag: "Vec", "0": 1, "1": 2, "2": 3 };
const ROW1 = { $tag: "Vec", "0": 4, "1": 5, "2": 6 };
const ARR23 = { $tag: "Vec", "0": ROW0, "1": ROW1 };

// ===========================================================================
// (1) The builder — scalar rank-0 + the nested-`Vec` `$opaque` encoding (D2).
// ===========================================================================

describe("ArrayT — the builder (nested Vec + scalar rank-0)", () => {
  test("scalar `Array [] a = a` — rank-0 is the BARE element type (D2, § 2c)", () => {
    // NOT an `$opaque`, NOT a `$map` — the literal element type (a kind difference).
    expect(ArrayT([], Number_)).toEqual(Number_);
  });

  test("single-rank `Array [n] a` = `$opaque {name:\"Array\", pure: Vec n a}` (D2 — uniform wrap, NO repr field)", () => {
    const a1 = ArrayT([3], Number_);
    expect(a1).toEqual({ $opaque: { name: "Array", pure: Vec(Number_, 3) } });
    // `$opaque` carries NO `repr` field (retired representation-substrate 5a).
    if ("$opaque" in a1) expect("repr" in a1.$opaque).toBe(false);
  });

  test("multi-rank `Array [2,3] a` = `$opaque` over `Vec 2 (Array [3] a)` (nested Vec, wrap-outer-uniform)", () => {
    const a23 = ArrayT([2, 3], Number_);
    expect(a23).toEqual({
      $opaque: { name: "Array", pure: Vec(ArrayT([3], Number_), 2) },
    });
  });
});

// ===========================================================================
// (2) Membership (deliverable 4) — the OUTER length check sees through
//     `$opaque.pure` to the outer `Vec` (length-n0); inner guard deferred.
// ===========================================================================

describe("ArrayT — membership (the OUTER length check, via `$opaque.pure`)", () => {
  test("`typeToSetExpr(Array [2,3] Number)` is a REAL predicate (not SeAll) — sees through `$opaque`", () => {
    const setExpr = typeToSetExpr(ArrayT([2, 3], Number_));
    expect(setExpr).not.toEqual({ $all: true });
  });

  test("`contains` accepts a well-formed `[2,3]` array (length-2 outer frame)", () => {
    const setExpr = typeToSetExpr(ArrayT([2, 3], Number_));
    expect(contains(setExpr, [[1, 2, 3], [4, 5, 6]], null, {}, ctx)).toBe(true);
  });

  test("`contains` REJECTS a wrong OUTER shape (length 1 / length 3)", () => {
    const setExpr = typeToSetExpr(ArrayT([2, 3], Number_));
    expect(contains(setExpr, [[1, 2, 3]], null, {}, ctx)).toBe(false); // length-1 outer
    expect(contains(setExpr, [[1, 2, 3], [4, 5, 6], [7, 8, 9]], null, {}, ctx)).toBe(false); // length-3
  });

  test("scalar `Array [] Number` round-trips — a bare scalar validates as the element type", () => {
    const setExpr = typeToSetExpr(ArrayT([], Number_)); // = typeToSetExpr(Number)
    expect(contains(setExpr, 42, null, {}, ctx)).toBe(true);
    expect(contains(setExpr, "nope", null, {}, ctx)).toBe(false);
  });
});

// ===========================================================================
// (3) The nested `Array` value INHERITS the algebra (no bespoke instance) +
//     indexes by rank-recursion — the D1 payoff (Step-0 probe, re-confirmed).
// ===========================================================================

describe("Array value inherits fmap/foldr + indexes by rank-recursion (D1)", () => {
  test("there is NO bespoke `Array` instance on any FP class (it rides nested `Vec`)", () => {
    for (const cls of ["Functor", "Foldable", "Representable"]) {
      expect(dispatchRegistry.listInstances(cls).find((i) => i.args[0] === "Array")).toBeUndefined();
    }
  });

  test("`fmap (fmap g)` over the nested value maps every CELL (rank-2, inherited)", () => {
    const ADD100 = { fn: [["x"], { call: ["add", { var: "x" }, 100] }] };
    const ROWMAP = { fn: [["row"], { method: ["Functor", "fmap", ADD100, { var: "row" }] }] };
    expect(evaluate({ method: ["Functor", "fmap", ROWMAP, ARR23] }, {}, ctx)).toEqual({
      $tag: "Vec",
      "0": { $tag: "Vec", "0": 101, "1": 102, "2": 103 },
      "1": { $tag: "Vec", "0": 104, "1": 105, "2": 106 },
    });
  });

  test("`fmap (foldr add 0)` over the outer frame sums each ROW (rank-1, inherited)", () => {
    const ROWSUM = { fn: [["row"], { method: ["Foldable", "foldr", "add", 0, { var: "row" }] }] };
    expect(evaluate({ method: ["Functor", "fmap", ROWSUM, ARR23] }, {}, ctx)).toEqual({
      $tag: "Vec",
      "0": 6,
      "1": 15,
    });
  });

  test("`foldr` over the outer frame folds the ROWS (counts 2)", () => {
    const COUNT = { fn: [["row", "n"], { call: ["add", { var: "n" }, 1] }] };
    expect(evaluate({ method: ["Foldable", "foldr", COUNT, 0, ARR23] }, {}, ctx)).toBe(2);
  });

  test("`index (index arr i) j` — rank-recursion indexing composes from `Representable Vec` (D3)", () => {
    const row1 = evaluate({ call: ["vecIndex", ARR23, 1] }, {}, ctx);
    expect(evaluate({ call: ["vecIndex", row1, 2] }, {}, ctx)).toBe(6); // arr[1][2]
    const row0 = evaluate({ call: ["vecIndex", ARR23, 0] }, {}, ctx);
    expect(evaluate({ call: ["vecIndex", row0, 0] }, {}, ctx)).toBe(1); // arr[0][0]
  });
});
