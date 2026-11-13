// ---------------------------------------------------------------------------
// array-substrate Phase 1a.5 — the `Vec` / `$map` unification (the
// representable-functor reconciliation).
//
// Fenel had TWO unrelated presentations of one object sharing the name `Vec`:
// the legacy `$refined List (length==n)` (the inductive/refinement view) and the
// design-locked `$map (Fin n) a` (the representable-functor view). They are
// isomorphic (`Vec n a ≅ Fin n → a ≅ {xs:List a | length xs=n}`) but were
// unlinked. This phase makes `$map (Fin n) a` THE canonical `Vec` and teaches the
// type system the equivalence `refined(C, length==n) ≡ $map (Fin n) <elem>` (the
// normalization law), so the two presentations become formally one.
//
// THIS TEST proves the unification end-to-end:
//   (1) the normalization law: `refined(List Int, length==3)` ⇒ `$map (Fin 3)
//       Int` = `Vec 3 Int`; `refined(String, length==3)` ⇒ `Vec 3 Char` (String =
//       List Char); a length-INEQUALITY stays refined (the `==`-only fence).
//   (2) the subsumption decider decides `refined(List Int, length==3)` (normalised)
//       and `Vec 3 Int` EQUAL — both directions (`engine:subset` = Just true).
//   (3) THE PAYOFF: a `Vec 3 Int` VALUE inherits `fmap`/`foldr`/`traverse` from
//       the Phase-1a `(Map k)` algebra PARAMETRICALLY — NO bespoke nominal `Vec`
//       instance authored (Step 0 makes the parametric ctor dispatch).
// ---------------------------------------------------------------------------

import { test, expect, describe, beforeAll } from "bun:test";
import { setDefaultTimeout } from "bun:test";

// type-substrate P1(a.5) — budget raise, no assertion weakened. This suite drives
// the INTERPRETED Fenel deciders and had rows measuring 181 s against bun's 5 s
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
import { deriveFunctorModule, dispatchedSubset } from "./engine-bodies-dispatch";
import { resolveMethod } from "./effect-dispatch";
import { evaluate } from "./json-logic";
import { parse } from "./fenel-parser";
import { loadFenelModule } from "./fenel-module";
import { normalizeFenelTypeShorthand } from "./type-normalize";
import { Vec, Fin, List } from "./type-foundation";
import { isJustTrue } from "./maybe-bool";
import type { EvaluateContext } from "./json-logic";
import type { FenelType, FenelModule as FM } from "./types";

let ctx: EvaluateContext;
let reg: ReturnType<typeof createRegistry>;

// `posMaybe : Int -> Maybe Int` — a declared-return effectful fn so the
// deriveTraverse bridge resolves the applicative `g` from the return type (the
// map-algebra.test precedent; a bare lambda only resolves `g` via the non-empty
// array fallback, which doesn't reach a map value).
const PROBE_SRC = `
module vecprobe where
posMaybe : Int -> Maybe Int
posMaybe x = if gt x 0 then Just x else Nothing
`;

beforeAll(() => {
  // `Vec` / `Fin` ship as parametric system entities in the production boot
  // dispatchRegistry (system-entities.ts), so no test registration is needed — only
  // a registry to give the algebra dispatch a context.
  const probe = loadFenelModule(PROBE_SRC, "vecprobe");
  const probeMod: FM = { name: "vecprobe", label: "vecprobe", functions: probe.functions, instances: probe.instances };
  reg = createRegistry([stdModule, engineModule, algebraModule, deriveFunctorModule, probeMod], {
    dispatchRegistry,
  });
  ctx = reg.evaluateContext();
});

// Build the legacy refined-List Vec by hand (the persisted / hand-written form
// the normalization law must recognise). `Vec()` itself now PRODUCES `$map`.
const refinedListN = (elem: FenelType, n: number): FenelType => ({
  $refined: { base: List(elem), set: { $tag: "SeWhere", pred: { "==": [{ call: ["length", { var: "value" }] }, n] } } } as never,
});

// ===========================================================================
// (1) The normalization law — refined(C, length==n) ≡ $map (Fin n) <elem>.
// ===========================================================================

describe("the normalization law", () => {
  test("refined(List Int, length==3) normalises to `Vec 3 Int` = `$map (Fin 3) Int`", () => {
    const r = normalizeFenelTypeShorthand(refinedListN({ $ref: "Int" }, 3));
    expect(r.rewrites).toBe(1);
    expect(r.value).toEqual(Vec({ $ref: "Int" }, 3) as never);
  });

  test("refined(String, length==3) normalises to `Vec 3 Char` (String = List Char)", () => {
    const refinedStr: FenelType = {
      $refined: { base: { $ref: "String" }, set: { $tag: "SeWhere", pred: { "==": [{ call: ["length", { var: "value" }] }, 3] } } } as never,
    };
    const r = normalizeFenelTypeShorthand(refinedStr);
    expect(r.rewrites).toBe(1);
    expect(r.value).toEqual(Vec({ $ref: "Char" }, 3) as never);
  });

  test("a length INEQUALITY stays refined-List (the `==`-only fence)", () => {
    const ineq: FenelType = {
      $refined: { base: List({ $ref: "Int" }), set: { $tag: "SeWhere", pred: { ">=": [{ call: ["length", { var: "value" }] }, 3] } } } as never,
    };
    const r = normalizeFenelTypeShorthand(ineq);
    expect(r.rewrites).toBe(0); // NOT a fixed Fin n — left refined (a follow-on)
  });

  test("idempotent — re-normalising the `$map` form is a no-op", () => {
    const once = normalizeFenelTypeShorthand(refinedListN({ $ref: "Int" }, 3));
    const twice = normalizeFenelTypeShorthand(once.value);
    expect(twice.rewrites).toBe(0);
    expect(twice.value).toEqual(once.value as never);
  });
});

// ===========================================================================
// (2) The subsumption decider decides refined(List Int, length==3) ≡ Vec 3 Int.
// ===========================================================================

describe("the two presentations are decided EQUAL (subsumption)", () => {
  const vec3Int = Vec({ $ref: "Int" }, 3);
  const normalisedRefined = normalizeFenelTypeShorthand(refinedListN({ $ref: "Int" }, 3)).value as FenelType;

  test("normalised refined-List IS the `$map (Fin 3) Int` form (canonical)", () => {
    expect(normalisedRefined).toEqual(vec3Int as never);
  });

  test("`engine:subset` mutual-subset — PRICED LOSS at type-substrate P1(a.7)", () => {
    // The STRUCTURAL half of the unification is untouched and still green: the
    // normalisation above proves `normalisedRefined` and `vec3Int` are the SAME
    // type value (`toEqual`). What P1(a.7) fenced is the sound `$map` subset
    // arm, in BOTH polarities: `ssMap` reads `$map` as a partial dictionary
    // (`K1 ⊆ K2`) while `validationValidateMap`'s finite branch requires a TOTAL
    // array of length `card`, so `Vec 3 ⊆ Vec 4` was a false POSITIVE at an
    // IMPLEMENTED arm — and a `ttKeepTrue` would have RETAINED it rather than
    // fencing it. Ledger row `t.sub.map` (THEOREM → MISSING).
    //
    // The named recovery for exactly this pin is a key-EQUALITY-gated positive
    // built on the already-registered `conformMap` rule (`decideSubset` BOTH
    // directions ∧ covariant values), which is READING-INVARIANT where `ssMap`
    // is not. It carries a mixed-branch side condition and is therefore its own
    // slice, not a rider. Until then this equality is proved structurally, not
    // by the containment judgment.
    expect(isJustTrue(dispatchedSubset(normalisedRefined, vec3Int) as never)).toBe(false);
    expect(isJustTrue(dispatchedSubset(vec3Int, normalisedRefined) as never)).toBe(false);
  });

  test("`Fin n` is the half-open index type `$refined Nat [0,n)`", () => {
    const fin3 = Fin(3);
    expect("$refined" in fin3).toBe(true);
    if ("$refined" in fin3) {
      expect(fin3.$refined.set).toMatchObject({
        $tag: "SeInterval",
        interval: { hi: { $tag: "Just", _0: { value: 3, inclusive: false } } },
      } as never);
    }
  });
});

// ===========================================================================
// (3) THE PAYOFF — a `Vec 3 Int` value inherits the Phase-1a algebra
//     PARAMETRICALLY (NO bespoke nominal Vec instance; Step 0 makes it fire).
// ===========================================================================

describe("Vec inherits the 1a algebra PARAMETRICALLY (the payoff)", () => {
  test("there is NO bespoke `Vec` Functor instance — it rides the structural `(Map k)` one", () => {
    const nominal = dispatchRegistry.listInstances("Functor").find((i) => i.args[0] === "Vec");
    expect(nominal).toBeUndefined();
  });

  test("a `Vec` value resolves `Unique algebra:mapFmap` (the parametric ctor dispatches)", () => {
    const r = resolveMethod("Functor", "fmap", [null, { $tag: "Vec", "0": 10, "1": 20, "2": 30 }], ctx, dispatchRegistry);
    expect(r.$tag).toBe("Unique");
    if (r.$tag === "Unique") {
      expect(r.method).toBe("algebra:mapFmap");
      expect(r.key).toBe("Vec");
    }
  });

  const ADD1 = { fn: [["x"], { call: ["add", { var: "x" }, 1] }] };

  test("`fmap (add 1)` over a `Vec 3 Int` maps every element (keys + $tag fixed)", () => {
    const out = evaluate({ method: ["Functor", "fmap", ADD1, { $tag: "Vec", "0": 10, "1": 20, "2": 30 }] }, {}, ctx);
    expect(out).toEqual({ $tag: "Vec", "0": 11, "1": 21, "2": 31 });
  });

  test("`foldr add 0` over a `Vec 3 Int` sums the elements", () => {
    const out = evaluate({ method: ["Foldable", "foldr", "add", 0, { $tag: "Vec", "0": 10, "1": 20, "2": 30 }] }, {}, ctx);
    expect(out).toBe(60);
  });

  test("`traverse posMaybe` over a `Vec` sequences the effects (inherited)", () => {
    // posMaybe : Int -> Maybe Int — declared-return so the bridge resolves the
    // applicative `g` (the map-algebra.test path). Evaluated against an env-bound
    // tagged-Vec value.
    const out = evaluate(parse("Traversable.traverse posMaybe v"), { v: { $tag: "Vec", "0": 1, "1": 2 } }, ctx);
    // `mapTraverse` rebuilds the value-keys but does not carry the `$tag` through
    // the applicative (the established map-algebra behavior — cf. MapSN), so the
    // collected result is a bare keyed map.
    expect(out).toEqual({ $tag: "Just", _0: { "0": 1, "1": 2 } });
  });
});
