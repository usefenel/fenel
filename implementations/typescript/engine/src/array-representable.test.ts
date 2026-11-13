// ---------------------------------------------------------------------------
// array-substrate Phase 1b — the data layer: `Representable` + the `Vec`
// value-membership floor (the 1a.5 deferral CLOSED).
//
// Phase 1a.5 made `$map (Fin n) a` THE canonical `Vec` and proved it inherits
// the Phase-1a `Functor`/`Foldable`/`Traversable (Map k)` algebra PARAMETRICALLY
// — but DEFERRED the runtime length/element validation the refined-`List` form
// did (`typeToSetExpr($map)` was `SeAll`). Phase 1b makes the `Vec` value REAL:
//
//   (0) THE MEMBERSHIP FLOOR (deliverable 0) — a finite-Fin-keyed `$map` now has
//       a real value-membership SetExpr (`typeToSetExpr` ⇒ a `$where`: length==n
//       ∧ every element ∈ ⟦values⟧). PROVEN in `dependent-types.test.ts` (the
//       `contains` side) + `validate.test.ts` (the `validate()` side). This file
//       covers the `Representable` arm.
//   (1) `Representable f` — the array-flavored class (`f a ≅ (i -> a)`): an array
//       IS a total function from its index set to its values.
//   (2) `Representable Vec` — `index` (total lookup, dispatched) + `tabulateVec`
//       (the value-level builder; `tabulate` is return-position, the Monad.return
//       precedent). `index (tabulateVec n g) i ≡ g i` round-trips.
//   (3) RE-CONFIRM the 1a.5 payoff — the SAME `Vec` inherits `fmap`/`foldr`
//       PARAMETRICALLY (no bespoke nominal Vec instance), still true after the
//       data layer.
//
// `Array` multi-rank + scalar rank-0 are SPLIT to Phase 1c (see the roadmap) —
// the membership floor + Representable proved a full session.
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

// A `Vec 3 Int` runtime value in the keyed dispatch repr (the vec-map-unification
// precedent): `{$tag:"Vec", "0":…}`. The JS-array `$opaque.repr` view `[10,20,30]`
// indexes identically (both carry "0"/"1"/… keys).
const VEC3 = { $tag: "Vec", "0": 10, "1": 20, "2": 30 } as const;
const SQ = { fn: [["i"], { call: ["mul", { var: "i" }, { var: "i" }] }] };

// ===========================================================================
// (1) The `Representable f` class is registered (dispatch seed derived).
// ===========================================================================

describe("Representable — the class", () => {
  test("`Representable` is a registered class with the `index` dispatch seed (arg 0)", () => {
    // `index : f<a> -> i -> a` ⇒ `f` heads arg 0 ⇒ dispatch position 0, derived
    // from the `.fenel` decl exactly like Functor/Foldable (no TS seed literal).
    const r = resolveMethod("Representable", "index", [VEC3, 1], ctx, dispatchRegistry);
    expect(r.$tag).toBe("Unique");
    if (r.$tag === "Unique") {
      // modules-as-values Phase 2b: the instance holds a qualified reference.
      expect(r.method).toEqual({ $ref: "algebra.vecIndex" });
      expect(r.key).toBe("Vec");
      expect(r.dispatchPos).toBe(0);
    }
  });

  test("there is NO `tabulate` on the `Vec` instance — it is return-position (the Monad.return precedent)", () => {
    const inst = dispatchRegistry.listInstances("Representable").find((i) => i.args[0] === "Vec");
    expect(inst).toBeDefined();
    expect(inst?.methods?.index).toEqual({ $ref: "algebra.vecIndex" }); // modules-as-values Phase 2b
    expect(inst?.methods?.tabulate).toBeUndefined();
  });
});

// ===========================================================================
// (2) `Representable Vec` — index (TOTAL, dispatched) + tabulateVec (build).
// ===========================================================================

describe("Representable Vec — index + tabulate", () => {
  test("`index` is TOTAL: dispatches on a `Vec` value + looks up the in-domain element", () => {
    expect(evaluate({ method: ["Representable", "index", VEC3, 0] }, {}, ctx)).toBe(10);
    expect(evaluate({ method: ["Representable", "index", VEC3, 1] }, {}, ctx)).toBe(20);
    expect(evaluate({ method: ["Representable", "index", VEC3, 2] }, {}, ctx)).toBe(30);
  });

  test("`index` reads the JS-array `$opaque.repr` view identically (both reprs carry \"0\"/\"1\"/… keys)", () => {
    expect(evaluate({ call: ["vecIndex", [10, 20, 30], 2] }, {}, ctx)).toBe(30);
  });

  test("`tabulateVec n g` BUILDS a `Vec` by applying `g` at every index `[0..n-1]`", () => {
    expect(evaluate({ call: ["tabulateVec", 3, SQ] }, {}, ctx)).toEqual([0, 1, 4]);
    expect(evaluate({ call: ["tabulateVec", 0, SQ] }, {}, ctx)).toEqual([]); // empty index domain
  });

  test("`index (tabulateVec n g) i ≡ g i` — the representable isomorphism round-trips", () => {
    const built = { call: ["tabulateVec", 5, SQ] };
    expect(evaluate({ call: ["vecIndex", built, 0] }, {}, ctx)).toBe(0);
    expect(evaluate({ call: ["vecIndex", built, 3] }, {}, ctx)).toBe(9);
    expect(evaluate({ call: ["vecIndex", built, 4] }, {}, ctx)).toBe(16);
  });

  test("`rangeUpTo n` is the half-open index domain `[0..n-1]`", () => {
    expect(evaluate({ call: ["rangeUpTo", 4] }, {}, ctx)).toEqual([0, 1, 2, 3]);
    expect(evaluate({ call: ["rangeUpTo", 0] }, {}, ctx)).toEqual([]);
  });
});

// ===========================================================================
// (3) RE-CONFIRM the 1a.5 payoff — Vec STILL inherits the algebra
//     PARAMETRICALLY after the data layer (no bespoke nominal Vec instance).
// ===========================================================================

describe("Vec STILL inherits the (Map k) algebra parametrically (post-1b)", () => {
  test("there is NO bespoke `Vec` Functor instance — it rides the structural `(Map k)` one", () => {
    expect(dispatchRegistry.listInstances("Functor").find((i) => i.args[0] === "Vec")).toBeUndefined();
  });

  test("`fmap (add 1)` over the SAME `Vec` maps every element (inherited)", () => {
    const ADD1 = { fn: [["x"], { call: ["add", { var: "x" }, 1] }] };
    expect(evaluate({ method: ["Functor", "fmap", ADD1, VEC3] }, {}, ctx)).toEqual({
      $tag: "Vec",
      "0": 11,
      "1": 21,
      "2": 31,
    });
  });

  test("`foldr add 0` over the SAME `Vec` sums the elements (inherited)", () => {
    expect(evaluate({ method: ["Foldable", "foldr", "add", 0, VEC3] }, {}, ctx)).toBe(60);
  });
});
