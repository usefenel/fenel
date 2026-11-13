// ---------------------------------------------------------------------------
// array-substrate Phase 3 — the combinator library (`reduce`/`scan`/`transpose`/
// `reshape`). The array VOCABULARY composed from the shipped algebra (`Foldable.
// foldr` / `Foldable.toList` / `vecIndex` / `tabulateVec` / `rangeUpTo` / the std
// HOFs) — NO new engine TS, NO new `$`-constructor. design/array-substrate.md
// §1/§9 + notes/phase-3-prototype.md (the Step-0 design lock: NESTED stays locked;
// reduce/scan reduce the OUTER frame; the `tagVec` `$tag`-carry retag).
//
// `take`/`drop`/`rotate`/`grade` are SPLIT to Phase 3b (the brief's split sanction
// — `take`/`drop` collide with the std List natives, a subsume-vs-alias design
// question; `grade` needs a sort) — see the roadmap.
// ---------------------------------------------------------------------------

import { test, expect, describe, beforeAll } from "bun:test";
import { stdModule } from "./modules/std";
import { engineModule } from "./modules/engine";
import { algebraModule } from "./modules/algebra";
import { createRegistry } from "./registry";
import { dispatchRegistry } from "./system-entities";
import { deriveFunctorModule } from "./engine-bodies-dispatch";
import { evaluate } from "./json-logic";
import type { EvaluateContext } from "./json-logic";

let ctx: EvaluateContext;
beforeAll(() => {
  const reg = createRegistry([stdModule, engineModule, algebraModule, deriveFunctorModule], { dispatchRegistry });
  ctx = reg.evaluateContext();
});

// The keyed dispatch repr (`{$tag:"Vec", "0":…}`) — re-dispatchable at every rank.
const VEC = { $tag: "Vec", "0": 1, "1": 2, "2": 3 };
const ROW0 = { $tag: "Vec", "0": 1, "1": 2, "2": 3 };
const ROW1 = { $tag: "Vec", "0": 4, "1": 5, "2": 6 };
const ARR23 = { $tag: "Vec", "0": ROW0, "1": ROW1 };

// ===========================================================================
// (1) reduce (`f/`) — fold a binop over the elements (the general aggregator).
// ===========================================================================
describe("reduce — fold over a Foldable (Vec + an Array frame)", () => {
  test("`reduce add 0` sums a flat Vec (APL `+/`)", () => {
    expect(evaluate({ call: ["reduce", "add", 0, VEC] }, {}, ctx)).toBe(6);
  });

  test("`reduce add 0` works on a bare List too (any Foldable via dispatch)", () => {
    expect(evaluate({ call: ["reduce", "add", 0, [10, 20, 30]] }, {}, ctx)).toBe(60);
  });

  test("`reduce (zip2 add) 0` reduces the OUTER frame of an Array — sums the rows element-wise", () => {
    // foldr (liftZip2 add) 0 [ROW0,ROW1] = ROW0 + (ROW1 + 0) = [1+4, 2+5, 3+6].
    const ZIP_ADD = { fn: [["a", "b"], { call: ["liftZip2", "add", { var: "a" }, { var: "b" }] }] };
    expect(evaluate({ call: ["reduce", ZIP_ADD, 0, ARR23] }, {}, ctx)).toEqual({
      $tag: "Vec",
      "0": 5,
      "1": 7,
      "2": 9,
    });
  });
});

// ===========================================================================
// (2) scan (`f\`) — running prefix-reduce, shape-preserving + re-dispatchable.
// ===========================================================================
describe("scan — running prefix (scanl1), shape-preserving", () => {
  test("`scan add` produces the running sum, re-tagged as a Vec", () => {
    expect(evaluate({ call: ["scan", "add", VEC] }, {}, ctx)).toEqual({
      $tag: "Vec",
      "0": 1,
      "1": 3,
      "2": 6,
    });
  });

  test("scan PRESERVES `$tag` ⇒ the result re-dispatches (fmap fires over it)", () => {
    const scanned = { call: ["scan", "add", VEC] };
    const ADD1 = { fn: [["x"], { call: ["add", { var: "x" }, 1] }] };
    expect(evaluate({ method: ["Functor", "fmap", ADD1, scanned] }, {}, ctx)).toEqual({
      $tag: "Vec",
      "0": 2,
      "1": 4,
      "2": 7,
    });
  });

  test("`scan mul` (running product) — the aggregator generalizes", () => {
    expect(evaluate({ call: ["scan", "mul", VEC] }, {}, ctx)).toEqual({
      $tag: "Vec",
      "0": 1,
      "1": 2,
      "2": 6,
    });
  });
});

// ===========================================================================
// (3) transpose (`⍉`) — the Naperian distribute (swap the two leading axes).
// ===========================================================================
describe("transpose — the representable distribute ([2,3] → [3,2])", () => {
  test("`transpose` swaps the axes — cell [i][j] → [j][i]", () => {
    expect(evaluate({ call: ["transpose", ARR23] }, {}, ctx)).toEqual({
      $tag: "Vec",
      "0": { $tag: "Vec", "0": 1, "1": 4 },
      "1": { $tag: "Vec", "0": 2, "1": 5 },
      "2": { $tag: "Vec", "0": 3, "1": 6 },
    });
  });

  test("`transpose (transpose arr) ≡ arr` — round-trips (the Naperian involution)", () => {
    const round = { call: ["transpose", { call: ["transpose", ARR23] }] };
    expect(evaluate(round, {}, ctx)).toEqual(ARR23);
  });

  test("every level is `$tag`-tagged ⇒ the transposed result re-dispatches", () => {
    const t = evaluate({ call: ["transpose", ARR23] }, {}, ctx) as Record<string, unknown>;
    expect(t.$tag).toBe("Vec");
    expect((t["0"] as Record<string, unknown>).$tag).toBe("Vec");
  });
});

// ===========================================================================
// (4) reshape (`⍴`) — reinterpret the flat element sequence under a new shape.
// ===========================================================================
describe("reshape — flatten + re-chunk under a new shape", () => {
  test("`reshape [3,2]` re-chunks the flat [1..6] into 3 rows of 2", () => {
    expect(evaluate({ call: ["reshape", [3, 2], ARR23] }, {}, ctx)).toEqual({
      $tag: "Vec",
      "0": { $tag: "Vec", "0": 1, "1": 2 },
      "1": { $tag: "Vec", "0": 3, "1": 4 },
      "2": { $tag: "Vec", "0": 5, "1": 6 },
    });
  });

  test("`reshape [6]` flattens to a single rank-1 Vec", () => {
    expect(evaluate({ call: ["reshape", [6], ARR23] }, {}, ctx)).toEqual({
      $tag: "Vec",
      "0": 1,
      "1": 2,
      "2": 3,
      "3": 4,
      "4": 5,
      "5": 6,
    });
  });

  test("`reshape [2,3]` is the identity-shape round-trip of ARR23", () => {
    expect(evaluate({ call: ["reshape", [2, 3], ARR23] }, {}, ctx)).toEqual(ARR23);
  });

  test("reshape preserves `$tag` at every rank ⇒ re-dispatchable", () => {
    const r = evaluate({ call: ["reshape", [3, 2], ARR23] }, {}, ctx) as Record<string, unknown>;
    expect(r.$tag).toBe("Vec");
    expect((r["0"] as Record<string, unknown>).$tag).toBe("Vec");
  });
});
