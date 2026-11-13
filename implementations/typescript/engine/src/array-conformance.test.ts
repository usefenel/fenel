// ---------------------------------------------------------------------------
// array-substrate Phase 4 — `Rank` + conformability + the broadcast-realization
// (THE CRUX). The de-risked § 2 made real:
//
//   • CONFORMANCE = key-EQUALITY + covariant values (Q3, § 2b). `engine:conformable`
//     (containment.fenel) — a containment-family DECIDER (sibling of `subset`) that
//     flips the `$map` key axis from `⊆` (partial-dictionary) to `==` (mutual subset
//     = total-array equality) while keeping values covariant. `Vec 3` does NOT
//     conform to `Vec 4` (key-equality fails) but a covariant-value subtype DOES.
//     Seam: `dispatchedConformable` (the `dispatchedSubset` mirror).
//   • The `Rank` adverb (Q4) — `algebra:rank r f x` applies a cell-rank-`r` fn over
//     the leading frame axes (the Remora discipline). `rank 1 sumRow` reduces each
//     row of an Array[2,3]; `rank 0 (+1)` deep-maps every scalar cell.
//   • BROADCAST realization = A (Q1, § 9). The Phase-2 `liftZip2` driver IS the
//     representable formula `tabulate∘jointShape∘index` (scalar = constant functor);
//     broadcasting still works (Phase-2 behaviors re-confirmed). B rejected.
//
// design/array-substrate.md § 2b / § 9 + notes/phase-4-prototype.md (the Stage-1
// design lock). The conformance decider is dispatched (routes on `tsKind`, delegates
// to `set:decideSubset` both directions) — NEVER a hand-rolled shape-equality `if`
// (the § 7 fence).
// ---------------------------------------------------------------------------

import { test, expect, describe, beforeAll } from "bun:test";
import { setDefaultTimeout } from "bun:test";

// type-substrate P1(a.5) — budget raise, no assertion weakened. This suite drives
// the INTERPRETED Fenel deciders and had rows measuring 227 s against bun's 5 s
// default BEFORE this phase and after it (verified identical on the pre-repair
// tree), so it was reporting CLOCK as failure. A gate nobody can read is how a
// genuine red went unnoticed at P1(a). Raise the budget; never weaken an
// assertion to fit it.
setDefaultTimeout(300_000);
import { stdModule } from "./modules/std";
import { engineModule } from "./modules/engine";
import { algebraModule } from "./modules/algebra";
import { createRegistry } from "./registry";
import { dispatchRegistry } from "./system-entities";
import { deriveFunctorModule, dispatchedConformable, dispatchedSubset } from "./engine-bodies-dispatch";
import { evaluate } from "./json-logic";
import type { EvaluateContext } from "./json-logic";
import { Vec, ArrayT } from "./type-foundation";

let ctx: EvaluateContext;
beforeAll(() => {
  const reg = createRegistry([stdModule, engineModule, algebraModule, deriveFunctorModule], { dispatchRegistry });
  ctx = reg.evaluateContext();
});

type Tri = { $tag: "Just"; _0: boolean } | { $tag: "Nothing" };
const JT: Tri = { $tag: "Just", _0: true };
const JF: Tri = { $tag: "Just", _0: false };
const NO: Tri = { $tag: "Nothing" };
const Num = { $ref: "Number" };
// A genuine covariant value-subtype of Number (the sound decider proves `{1,2,3} ⊆
// Number`). NB: the literal `Int <: Number` is REFUTED by the sound decider's
// nominal hierarchy (Just false, NOT the Just-true Phase 0 assumed) — a pre-existing
// decider-hierarchy gap, off the array critical path; this enum subtype is the clean
// covariant-values demonstration the gate intends.
const SmallNums = { $refined: { base: Num, set: { $tag: "SeEnum" as const, values: [1, 2, 3] } } };

// ===========================================================================
// (1) CONFORMANCE — key-EQUALITY (Q3, the § 2b headline).
// ===========================================================================
describe("conformance — key-EQUALITY (both decideSubset directions)", () => {
  test("Vec 3 vs Vec 4 ⇒ NOT conformant (keys [0,3) ≠ [0,4))", () => {
    // The partial-dictionary `subset` USED to say Vec 3 <: Vec 4 (Just true) —
    // WRONG for total arrays, and this line pinned that trap as the motivation
    // for `conformable`. type-substrate P1(a.7) retired it at the source: the
    // same reading conflict is a false POSITIVE at validation's IMPLEMENTED
    // finite-map arm (which requires a TOTAL array of length `card`, so a
    // length-3 array validates as Vec 3 and is refused as Vec 4), so the sound
    // `$map` arm now abstains in both polarities (ledger row `t.sub.map`,
    // THEOREM → MISSING). The CONTRAST this test exists for is preserved and
    // sharpened: `subset` no longer claims anything, while `conformable` — which
    // flips the key axis to EQUALITY — still REFUTES. `conformable` is untouched
    // by that phase; it reaches `conformMap` directly and never enters `ssMap`.
    expect(dispatchedSubset(Vec(Num, 3), Vec(Num, 4))).toEqual(NO); // the ssMap ⊆ trap, now fenced
    expect(dispatchedConformable(Vec(Num, 3), Vec(Num, 4))).toEqual(JF); // conformance still refutes
    expect(dispatchedConformable(Vec(Num, 4), Vec(Num, 3))).toEqual(JF); // symmetric
  });

  test("Vec 3 vs Vec 3 ⇒ conformant (keys equal both directions)", () => {
    expect(dispatchedConformable(Vec(Num, 3), Vec(Num, 3))).toEqual(JT);
  });

  test("covariant VALUES — Vec 3 {1,2,3} conforms to Vec 3 Number (keys equal, values ⊆)", () => {
    expect(dispatchedConformable(Vec(SmallNums, 3), Vec(Num, 3))).toEqual(JT);
  });

  test("value refutation — Vec 3 Number does NOT conform to Vec 3 {1,2,3} (values not ⊆)", () => {
    // keys equal, but Number ⊄ {1,2,3} ⇒ the value axis refutes (covariant, sound).
    const r = dispatchedConformable(Vec(Num, 3), Vec(SmallNums, 3)) as Tri;
    expect(r.$tag === "Nothing" || (r.$tag === "Just" && r._0 === false)).toBe(true);
  });

  test("`$opaque`-wrapped Array peels to the inner $map — Array[3] conforms by shape", () => {
    // ArrayT([3], Number) = $opaque{name:Array, pure: Vec 3 Number}; conformable
    // peels the opaque to the inner Vec (transparency) and conforms it to a bare Vec.
    expect(dispatchedConformable(ArrayT([3], Num), Vec(Num, 3))).toEqual(JT);
    expect(dispatchedConformable(ArrayT([3], Num), Vec(Num, 4))).toEqual(JF);
  });
});

// ===========================================================================
// (2) The `Rank` adverb (Q4) — cell-rank-r framing over the leading axes.
// ===========================================================================
const ROW0 = { $tag: "Vec", "0": 1, "1": 2, "2": 3 };
const ROW1 = { $tag: "Vec", "0": 4, "1": 5, "2": 6 };
const ARR23 = { $tag: "Vec", "0": ROW0, "1": ROW1 };

describe("Rank — the cell-rank-r application adverb (`f⍤r`)", () => {
  // sumRow : a rank-1 cell fn — folds a row to its sum.
  const SUM_ROW = { fn: [["row"], { call: ["foldableLength", { var: "row" }] }] }; // length as a rank-1 probe
  // a scalar cell fn (+1).
  const ADD1 = { fn: [["x"], { call: ["add", { var: "x" }, 1] }] };

  test("`arrayRank` counts nesting depth — scalar 0, Vec 1, Array[2,3] 2", () => {
    expect(evaluate({ call: ["arrayRank", 5] }, {}, ctx)).toBe(0);
    expect(evaluate({ call: ["arrayRank", ROW0] }, {}, ctx)).toBe(1);
    expect(evaluate({ call: ["arrayRank", ARR23] }, {}, ctx)).toBe(2);
  });

  test("`rank 1 f arr23` frames a rank-1 cell fn over the leading axis (each row → its length 3)", () => {
    // every rank-1 row reduces to 3 (its length); framed back into the outer Vec.
    expect(evaluate({ call: ["rank", 1, SUM_ROW, ARR23] }, {}, ctx)).toEqual({
      $tag: "Vec",
      "0": 3,
      "1": 3,
    });
  });

  test("`rank 0 (+1) arr23` maps every SCALAR cell (the deepest rank — generalizes each)", () => {
    expect(evaluate({ call: ["rank", 0, ADD1, ARR23] }, {}, ctx)).toEqual({
      $tag: "Vec",
      "0": { $tag: "Vec", "0": 2, "1": 3, "2": 4 },
      "1": { $tag: "Vec", "0": 5, "1": 6, "2": 7 },
    });
  });

  test("`rank 1` on a flat Vec applies the cell fn at the top (Vec IS rank-1 ⇒ a cell)", () => {
    expect(evaluate({ call: ["rank", 1, SUM_ROW, ROW0] }, {}, ctx)).toBe(3);
  });
});

// ===========================================================================
// (3) BROADCAST still works (Q1 = A — the representable realization; Phase-2
//     behaviors re-confirmed through the same `liftZip2` driver).
// ===========================================================================
const VEC = { $tag: "Vec", "0": 1, "1": 2, "2": 3 };
const VEC10 = { $tag: "Vec", "0": 10, "1": 20, "2": 30 };

describe("broadcast realization = A — re-confirms Phase-2 (driver = tabulate∘jointShape∘index)", () => {
  test("same-shape element-wise (`tabulate the common frame`)", () => {
    expect(evaluate({ call: ["liftZip2", "add", VEC, VEC10] }, {}, ctx)).toEqual({
      $tag: "Vec",
      "0": 11,
      "1": 22,
      "2": 33,
    });
  });
  test("scalar broadcast both orders (`index scalar _ = scalar` — the constant functor)", () => {
    expect(evaluate({ call: ["liftZip2", "add", 100, VEC] }, {}, ctx)).toEqual({ $tag: "Vec", "0": 101, "1": 102, "2": 103 });
    expect(evaluate({ call: ["liftZip2", "add", VEC, 100] }, {}, ctx)).toEqual({ $tag: "Vec", "0": 101, "1": 102, "2": 103 });
  });
  test("nested rank-2 broadcast (the recursion descends the frame)", () => {
    expect(evaluate({ call: ["liftZip2", "add", 100, ARR23] }, {}, ctx)).toEqual({
      $tag: "Vec",
      "0": { $tag: "Vec", "0": 101, "1": 102, "2": 103 },
      "1": { $tag: "Vec", "0": 104, "1": 105, "2": 106 },
    });
  });
});
