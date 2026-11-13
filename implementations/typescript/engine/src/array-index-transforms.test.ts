// ---------------------------------------------------------------------------
// array-substrate Phase 3b — index transforms (`take`/`drop`/`rotate`) + `grade`.
// The second half of the combinator library, SPLIT out of Phase 3. Leading-axis
// prefix/suffix + cyclic shift + the sort-permutation, composed from the shipped
// vocabulary (`vecIndex` / `rangeUpTo` / `tagVec` / the std `sort` native) — NO new
// engine TS, NO new `$`-constructor. notes/phase-3b-prototype.md (the Step-0 lock).
//
// STEP-0 VERDICT (UPDATED — resolution-substrate Phase 2 Commit 4 SUBSUMED the alias):
// these were shipped as ALIASES (distinct codeNames `takeAxis`/`dropAxis`) because
// `std:take`/`std:drop` are perf-critical List→List natives (~181 hot-path sites incl.
// the parser/compiler) + the codeName resolver WAS last-wins. resolution-substrate
// Phase 1 replaced that last-wins with bare-name DISPATCH, so Commit 4 RENAMED
// `takeAxis`→`take` / `dropAxis`→`drop` — the now-multi-binding codeName dispatches
// `Sequential` List-vs-Vec by the arg's reflected type. The bare calls below are the
// Vec instance's `take`/`drop` (the values are `{$tag:"Vec"}`); results UNCHANGED.
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

const VEC4 = { $tag: "Vec", "0": 10, "1": 20, "2": 30, "3": 40 };
const ROW0 = { $tag: "Vec", "0": 1, "1": 2, "2": 3 };
const ROW1 = { $tag: "Vec", "0": 4, "1": 5, "2": 6 };
const ARR23 = { $tag: "Vec", "0": ROW0, "1": ROW1 };

// ===========================================================================
// (1) take (`↑`) / drop (`↓`) on a Vec — leading-axis prefix / suffix. Bare
// `take`/`drop` dispatch the `Sequential Vec` instance (Commit 4 collision).
// ===========================================================================
describe("take / drop on a Vec — leading-axis prefix/suffix, tag-preserving", () => {
  test("`take 2` — the first 2 cells, re-tagged as a Vec", () => {
    expect(evaluate({ call: ["take", 2, VEC4] }, {}, ctx)).toEqual({ $tag: "Vec", "0": 10, "1": 20 });
  });

  test("`drop 2` — all but the first 2 cells", () => {
    expect(evaluate({ call: ["drop", 2, VEC4] }, {}, ctx)).toEqual({ $tag: "Vec", "0": 30, "1": 40 });
  });

  test("on a nested Array — `drop 1` drops the first row; the surviving row stays a tagged Vec", () => {
    expect(evaluate({ call: ["drop", 1, ARR23] }, {}, ctx)).toEqual({ $tag: "Vec", "0": ROW1 });
    expect(evaluate({ call: ["take", 1, ARR23] }, {}, ctx)).toEqual({ $tag: "Vec", "0": ROW0 });
  });

  test("take/drop PRESERVE `$tag` ⇒ the result re-dispatches (fmap fires over it)", () => {
    const taken = { call: ["take", 2, VEC4] };
    const ADD1 = { fn: [["x"], { call: ["add", { var: "x" }, 1] }] };
    expect(evaluate({ method: ["Functor", "fmap", ADD1, taken] }, {}, ctx)).toEqual({ $tag: "Vec", "0": 11, "1": 21 });
  });

  test("`take 0` ⇒ the empty Vec; `drop 0` ⇒ the whole thing", () => {
    expect(evaluate({ call: ["take", 0, VEC4] }, {}, ctx)).toEqual({ $tag: "Vec" });
    expect(evaluate({ call: ["drop", 0, VEC4] }, {}, ctx)).toEqual({ $tag: "Vec", "0": 10, "1": 20, "2": 30, "3": 40 });
  });
});

// ===========================================================================
// (2) rotate (`⌽`) — cyclic (left) shift of the leading axis.
// ===========================================================================
describe("rotate — cyclic shift of the leading axis", () => {
  test("`rotate 1` — left cyclic shift by 1", () => {
    expect(evaluate({ call: ["rotate", 1, VEC4] }, {}, ctx)).toEqual({ $tag: "Vec", "0": 20, "1": 30, "2": 40, "3": 10 });
  });

  test("`rotate 4` (= n) is the identity (full cycle)", () => {
    expect(evaluate({ call: ["rotate", 4, VEC4] }, {}, ctx)).toEqual({ $tag: "Vec", "0": 10, "1": 20, "2": 30, "3": 40 });
  });

  test("rotate PRESERVES `$tag`", () => {
    const r = evaluate({ call: ["rotate", 2, VEC4] }, {}, ctx) as Record<string, unknown>;
    expect(r.$tag).toBe("Vec");
    expect(r["0"]).toBe(30);
  });
});

// ===========================================================================
// (3) grade (`⍋`) — the sort-permutation (argsort), via the std `sort` native.
// ===========================================================================
describe("grade — the permutation that would sort the array (argsort)", () => {
  test("`grade [3,1,2]` ⇒ [1,2,0] (indices ordered by value)", () => {
    const XS = { $tag: "Vec", "0": 3, "1": 1, "2": 2 };
    expect(evaluate({ call: ["grade", XS] }, {}, ctx)).toEqual({ $tag: "Vec", "0": 1, "1": 2, "2": 0 });
  });

  test("`grade` of an already-sorted array is the identity permutation", () => {
    const XS = { $tag: "Vec", "0": 5, "1": 6, "2": 7, "3": 8 };
    expect(evaluate({ call: ["grade", XS] }, {}, ctx)).toEqual({ $tag: "Vec", "0": 0, "1": 1, "2": 2, "3": 3 });
  });

  test("grade composes — indexing the array by its grade yields the sorted array", () => {
    // sorted[i] = xs[grade(xs)[i]]; here xs = [30,10,20], grade = [1,2,0] ⇒ [10,20,30].
    const XS = { $tag: "Vec", "0": 30, "1": 10, "2": 20 };
    const g = evaluate({ call: ["grade", XS] }, {}, ctx) as Record<string, number>;
    const sorted = [0, 1, 2].map((i) => evaluate({ call: ["vecIndex", XS, g[String(i)]] }, {}, ctx));
    expect(sorted).toEqual([10, 20, 30]);
  });
});

// ===========================================================================
// (4) gradeDown (`⍒`) — the DESCENDING sort-permutation (array-substrate Phase 3c).
// The mirror of `grade`: `reverse` the ascending permutation (std:reverse over the
// index list — NO Vec reverse). Lands over the now-bare dispatched take/drop + the
// shipped `Sequential Vec` instance (resolution-substrate Phase 2 Commit 4).
// ===========================================================================
describe("gradeDown — the permutation that would sort the array descending", () => {
  test("`gradeDown [3,1,2]` ⇒ [0,2,1] (indices ordered by DESCENDING value)", () => {
    const XS = { $tag: "Vec", "0": 3, "1": 1, "2": 2 };
    expect(evaluate({ call: ["gradeDown", XS] }, {}, ctx)).toEqual({ $tag: "Vec", "0": 0, "1": 2, "2": 1 });
  });

  test("`gradeDown` of an already-sorted array is the reversed index permutation", () => {
    const XS = { $tag: "Vec", "0": 5, "1": 6, "2": 7, "3": 8 };
    expect(evaluate({ call: ["gradeDown", XS] }, {}, ctx)).toEqual({ $tag: "Vec", "0": 3, "1": 2, "2": 1, "3": 0 });
  });

  test("gradeDown composes — indexing the array by its gradeDown yields the descending-sorted array", () => {
    // sorted_desc[i] = xs[gradeDown(xs)[i]]; xs = [30,10,20], gradeDown = [0,2,1] ⇒ [30,20,10].
    const XS = { $tag: "Vec", "0": 30, "1": 10, "2": 20 };
    const g = evaluate({ call: ["gradeDown", XS] }, {}, ctx) as Record<string, number>;
    const sorted = [0, 1, 2].map((i) => evaluate({ call: ["vecIndex", XS, g[String(i)]] }, {}, ctx));
    expect(sorted).toEqual([30, 20, 10]);
  });
});
