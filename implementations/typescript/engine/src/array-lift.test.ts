// ---------------------------------------------------------------------------
// array-substrate Phase 2 — `Lift` (broadcasting `each` / `zip2`).
//
// THE PAYOFF: the first real demonstration that *rank polymorphism IS dispatch*
// (no special-cased numpy-style shape machinery). On top of the 1c data layer
// (nested `Vec` value + scalar `Array [] a = a`), `zip2` lifts a binop over two
// arguments, BROADCASTING a rank-0 (scalar) operand into the other's frame.
// design/array-substrate.md § 2c.
//
// D1 (the broadcast realization, SETTLED by the Step-0 probe): `zip2` is a
// RANK-POLYMORPHIC DRIVER (`algebra:liftZip2`), NOT pure arg-1 dispatch — a
// scalar-first `zip2 add 5 vec` has no `Lift` instance at arg 1 (the scalar is
// rank-0, a KIND difference, § 2c). So the driver routes on the
// rank-0-vs-≥1 KIND test (`liftIsScalar` = "has NO data entries"; the probe found
// a scalar's `entries` is [], a Vec's is non-empty) + RECURSES, so a nested
// `Array` broadcasts through every rank. The kind test SELECTS the rank arm
// (instance resolution in spirit) — NOT a hand-rolled shape-EQUALITY `if` (that
// is the Phase-4 conformance arm — the fence).
//
// D2: `Lift (Map k)` is a STRUCTURAL ByPattern instance (the 1a `(Map k)` path),
// NOT a nominal `Lift Vec` (design § 4's "nominal" Phase-2 row was STALE —
// corrected). D3: `each` is a pure std alias over `Functor.fmap`, NOT a `Lift`
// method (it adds no new dispatch).
//
// Same-length rank-≥1 zip is key-aligned; DIFFERENT-length is the CONFORMANCE
// question = Phase 4 (key-EQUALITY refinement of `ssMap`, § 2b) — NOT handled
// here (Phase 2 assumes conformant shapes, the `vecIndex` in-domain precedent).
// ---------------------------------------------------------------------------

import { test, expect, describe, beforeAll } from "bun:test";
import { stdModule } from "./modules/std";
import { engineModule } from "./modules/engine";
import { algebraModule } from "./modules/algebra";
import { createRegistry } from "./registry";
import { dispatchRegistry } from "./system-entities";
import { deriveFunctorModule } from "./engine-bodies-dispatch";
import { resolveMethod } from "./effect-dispatch";
import { evaluate } from "./json-logic";
import type { EvaluateContext } from "./json-logic";

let ctx: EvaluateContext;

beforeAll(() => {
  const reg = createRegistry([stdModule, engineModule, algebraModule, deriveFunctorModule], {
    dispatchRegistry,
  });
  ctx = reg.evaluateContext();
});

// Vec values in the keyed dispatch repr (`{$tag:"Vec"}` — the 1c/1b convention).
const VEC = { $tag: "Vec", "0": 1, "1": 2, "2": 3 } as const;
const VEC10 = { $tag: "Vec", "0": 10, "1": 20, "2": 30 } as const;
// A nested `Array [2,3]` value (nested tagged Vec — 1c D1).
const ROW0 = { $tag: "Vec", "0": 1, "1": 2, "2": 3 };
const ROW1 = { $tag: "Vec", "0": 4, "1": 5, "2": 6 };
const ARR23 = { $tag: "Vec", "0": ROW0, "1": ROW1 };
const ADD = "add"; // the binop, by fnId

// ===========================================================================
// (1) The `Lift f` class is registered with the `zip2` dispatch seed (arg 1).
// ===========================================================================

describe("Lift — the class", () => {
  test("`Lift` is a registered class with the `zip2` dispatch seed (arg 1 — the Traversable shape)", () => {
    // `zip2 : (a -> b -> c) -> f<a> -> f<b> -> f<c>` ⇒ `f` heads arg 1 (after the
    // binop at 0) ⇒ dispatch position 1, derived from the `.fenel` decl (no TS seed).
    const r = resolveMethod("Lift", "zip2", [ADD, VEC, VEC10], ctx, dispatchRegistry);
    expect(r.$tag).toBe("Unique");
    if (r.$tag === "Unique") {
      expect(r.method).toBe("algebra:liftZip2");
      expect(r.key).toBe("Vec");
      expect(r.dispatchPos).toBe(1);
    }
  });

  test("`Lift (Map k)` is STRUCTURAL — there is NO bespoke nominal `Lift Vec`/`Lift Array`", () => {
    expect(dispatchRegistry.listInstances("Lift").find((i) => i.args[0] === "Vec")).toBeUndefined();
    expect(dispatchRegistry.listInstances("Lift").find((i) => i.args[0] === "Array")).toBeUndefined();
    // it rides the `{$pattern:"engine:isMapShaped"}` ByPattern instance:
    const structural = dispatchRegistry
      .listInstances("Lift")
      .find((i) => typeof i.args[0] === "object");
    expect(structural?.methods?.zip2).toBe("algebra:liftZip2");
  });
});

// ===========================================================================
// (2) `zip2` — same-shape element-wise lift (the conformant case).
// ===========================================================================

describe("zip2 — same-shape element-wise", () => {
  test("`zip2 add vec vec` zips element-wise + PRESERVES `$tag` (the result re-dispatches)", () => {
    expect(evaluate({ call: ["liftZip2", ADD, VEC, VEC10] }, {}, ctx)).toEqual({
      $tag: "Vec",
      "0": 11,
      "1": 22,
      "2": 33,
    });
  });

  test("`Lift.zip2` (the method, dispatched Vec-first) gives the same result", () => {
    expect(evaluate({ method: ["Lift", "zip2", ADD, VEC, VEC10] }, {}, ctx)).toEqual({
      $tag: "Vec",
      "0": 11,
      "1": 22,
      "2": 33,
    });
  });

  test("the zipped result is itself re-liftable (zip2 of a zip2)", () => {
    const z = { call: ["liftZip2", ADD, VEC, VEC10] }; // {Vec, 11,22,33}
    expect(evaluate({ call: ["liftZip2", ADD, z, VEC] }, {}, ctx)).toEqual({
      $tag: "Vec",
      "0": 12,
      "1": 24,
      "2": 36,
    });
  });
});

// ===========================================================================
// (3) BROADCAST — the rank-0 scalar replicated into the frame (THE payoff).
// ===========================================================================

describe("zip2 — broadcast (rank-0 scalar replicated into the frame)", () => {
  test("`zip2 add scalar vec` broadcasts the scalar over the frame (scalar `+`)", () => {
    expect(evaluate({ call: ["liftZip2", ADD, 100, VEC] }, {}, ctx)).toEqual({
      $tag: "Vec",
      "0": 101,
      "1": 102,
      "2": 103,
    });
  });

  test("`zip2 add vec scalar` is symmetric (scalar on either side)", () => {
    expect(evaluate({ call: ["liftZip2", ADD, VEC, 100] }, {}, ctx)).toEqual({
      $tag: "Vec",
      "0": 101,
      "1": 102,
      "2": 103,
    });
  });

  test("`zip2 add scalar arr23` BROADCASTS through BOTH ranks (the recursion descends the frame)", () => {
    expect(evaluate({ call: ["liftZip2", ADD, 100, ARR23] }, {}, ctx)).toEqual({
      $tag: "Vec",
      "0": { $tag: "Vec", "0": 101, "1": 102, "2": 103 },
      "1": { $tag: "Vec", "0": 104, "1": 105, "2": 106 },
    });
  });

  test("both-scalars is the base case — `zip2 add 3 4 ≡ add 3 4`", () => {
    expect(evaluate({ call: ["liftZip2", ADD, 3, 4] }, {}, ctx)).toBe(7);
  });
});

// ===========================================================================
// (4) `each = fmap` (D3 — the APL map adverb, a derived std alias).
// ===========================================================================

describe("each — the map adverb (= fmap, inherited)", () => {
  const ADD1 = { fn: [["x"], { call: ["add", { var: "x" }, 1] }] };

  test("`each (add 1) vec` maps every element (≡ `fmap`)", () => {
    const viaEach = evaluate({ call: ["each", ADD1, VEC] }, {}, ctx);
    const viaFmap = evaluate({ method: ["Functor", "fmap", ADD1, VEC] }, {}, ctx);
    expect(viaEach).toEqual({ $tag: "Vec", "0": 2, "1": 3, "2": 4 });
    expect(viaEach).toEqual(viaFmap);
  });

  test("`each` is a derived std alias, NOT a `Lift` class method (D3)", () => {
    // `Lift` declares ONLY `zip2`; `each` is `algebra:each` over `Functor.fmap`.
    const structural = dispatchRegistry
      .listInstances("Lift")
      .find((i) => typeof i.args[0] === "object");
    expect(structural?.methods?.each).toBeUndefined();
  });
});
