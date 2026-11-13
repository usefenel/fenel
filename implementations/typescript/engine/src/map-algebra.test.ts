// ---------------------------------------------------------------------------
// array-substrate Phase 1a — `$map` joins the algebra (the representable-functor
// substrate).
//
// THE DELIVERABLE: the `$map`/`Map k` former gets its `Functor`/`Foldable`/
// `Traversable` instances, so ANY `$map`-shaped value — `Vec n a = $map (Fin n)
// a`, `Array`, a user `Map String User` — gets `fmap`/`foldr`/`traverse` over its
// VALUES for FREE through ONE structural `(Map k)` instance (system-entities.ts,
// keyed `{$pattern:"engine:isMapShaped"}`), NO per-type code. The method bodies
// (`algebra:mapFmap` / `mapFoldr` / `mapTraverse`, algebra-methods.fenel) iterate
// the value's `std:entries` directly — no schema marshal.
//
// THE STEP-0 DISPATCH VERDICT (probed, recorded in roadmap): runtime method
// dispatch keys on `typeConstructorOf(value)`, which reflects a value's `$tag`.
// The STRUCTURAL `isMapShaped` ByPattern instance FIRES for a `$map` value that
// carries a `$tag` naming a CONCRETE registered type whose schema is bare-`$map`
// (`typeConstructorOf → name → getEntityTypeByName → $map → marshalTraversalType →
// TtMap → isMapShaped True`). The `$tag` rides on the value as METADATA, so the
// bodies treat `$`-keyed entries specially: `fmap` PASSES THEM THROUGH (preserving
// `$tag` ⇒ the identity law holds), `foldr`/`traverse` SKIP them.
//
// THE ARRAY PAYOFF: a hand-built `Vec 3 Int` (a concrete `$map`) gets `fmap` by
// INHERITANCE — NO `Vec` Functor instance authored (the conservative path Phase 0
// proposed and this phase replaces). Phase 1b is "register Vec/Array; they
// inherit".
//
// THE BONUS (D-6c-3 closed): the derived Functor/Foldable/Traversable folds now
// DESCEND a `$map` FIELD whose values carry the functor param (`Foo a = Foo {
// table: Map String a }`) — a direct `algebra:map*` call (a bare map field has no
// `$tag` to re-dispatch on).
//
// Runs in-process via createRegistry + the boot dispatchRegistry (the
// derive-functor.test pattern, no DB): `[stdModule, engineModule, algebraModule,
// deriveFunctorModule]`. The `$map` structural instances ship in the production
// boot dispatchRegistry, so they need no test registration — only the throwaway
// `$map`-shaped + map-field ENTITIES are pushed (the `pushEntity` precedent) so
// `typeConstructorOf → getEntityTypeByName / ctor:` resolves their `$map` schema.
// ---------------------------------------------------------------------------

import { test, expect, describe, beforeAll } from "bun:test";
import { stdModule } from "./modules/std";
import { engineModule } from "./modules/engine";
import { algebraModule } from "./modules/algebra";
import { createRegistry } from "./registry";
import { dispatchRegistry, systemEntities } from "./system-entities";
import { deriveFunctorModule } from "./engine-bodies-dispatch";
import { resolveMethod } from "./effect-dispatch";
import { evaluate } from "./json-logic";
import { parse } from "./fenel-parser";
import { loadFenelModule } from "./fenel-module";
import type { FenelModule as FM } from "./types";
import type { EvaluateContext } from "./json-logic";

let ctx: EvaluateContext;
let reg: ReturnType<typeof createRegistry>;

// `posMaybe : Int -> Maybe Int` — an effectful fn with a CONCRETE declared return
// type, so the deriveTraverse bridge resolves the applicative `g` from the return
// (the sound path, the derive-applicative-traversable.test precedent). A bare
// lambda (no declared return) only resolves `g` via the non-empty array fallback,
// which doesn't reach a record value (the FooMap field-traverse case).
const PROBE_SRC = `
module mapprobe where
posMaybe : Int -> Maybe Int
posMaybe x = if gt x 0 then Just x else Nothing
`;

const pushEntity = (id: string, type: unknown, params: string[]): void => {
  if (!systemEntities.some((e) => e.id === id)) {
    systemEntities.push({ id, type, params } as never);
  }
};

beforeAll(() => {
  // A CONCRETE `$map`-shaped entity (the user `Map String Number` case) — lands
  // in the catalog `entity:` section ⇒ getEntityTypeByName resolves it to a bare
  // `$map` ⇒ a `$map` value tagged "MapSN" marshals to `TtMap` ⇒ isMapShaped fires.
  pushEntity(
    "MapSN",
    { $map: { keys: { $tag: "SeRef", handle: "String" }, values: { $ref: "Number" } } },
    [],
  );
  // A CONCRETE `Vec 3 Int` = `$map (Fin 3) Int` — Fin 3 keys as a `[0,3)` refined
  // interval (cosmetic; isMapShaped only needs the `$map` shape). The array payoff:
  // it inherits `fmap` from the structural (Map k) instance with NO Vec instance.
  pushEntity(
    "Vec3Int",
    {
      $map: {
        keys: { $refined: { base: { $ref: "Number" }, set: { $tag: "SeInterval", interval: { lo: 0, hi: 3 } } } },
        values: { $ref: "Number" },
      },
    },
    [],
  );
  // The BONUS user type: `FooMap a = FooMap { table: Map String a }` — a UNARY
  // type (params ["a"]) whose only field is a `$map` carrying the functor param.
  // Lands in `ctor:` (parametric) ⇒ the derived Functor/Foldable/Traversable
  // (keyed isUnaryConstructor) dispatch on it, and the fold's `$map`-field arm
  // descends `table`.
  pushEntity(
    "FooMap",
    {
      $variant: {
        cases: [
          {
            name: "FooMap",
            fields: [
              { name: "table", type: { $map: { keys: { $tag: "SeRef", handle: "String" }, values: { $var: "a" } } } },
            ],
          },
        ],
      },
    },
    ["a"],
  );

  const probe = loadFenelModule(PROBE_SRC, "mapprobe");
  const probeMod: FM = { name: "mapprobe", label: "mapprobe", functions: probe.functions, instances: probe.instances };
  reg = createRegistry([stdModule, engineModule, algebraModule, deriveFunctorModule, probeMod], {
    dispatchRegistry,
  });
  ctx = reg.evaluateContext();
});

// add-1 lambda, as a JSON-Logic node (fmap/foldr need no applicative resolution,
// so a bare lambda is fine). `traverse` tests use the registered `posMaybe`
// (declared return ⇒ the bridge resolves `g`), evaluated against an env-bound
// tagged-map value (`Traversable.traverse posMaybe v`).
const ADD1 = { fn: [["x"], { call: ["add", { var: "x" }, 1] }] } as const;
const trav = (v: unknown): unknown => evaluate(parse("Traversable.traverse posMaybe v"), { v }, ctx);

// ===========================================================================
// (0) The structural `$map` algebra instances are registered at boot.
// ===========================================================================

describe("the structural `$map` algebra instances", () => {
  const findMapRule = (typeName: string) =>
    dispatchRegistry.listInstances(typeName).find(
      (i) =>
        i.args[0] &&
        typeof i.args[0] === "object" &&
        (i.args[0] as { $pattern?: unknown }).$pattern === "engine:isMapShaped",
    );

  test("Functor (Map k) is a `{$pattern:isMapShaped}` ByPattern rule → algebra:mapFmap", () => {
    const r = findMapRule("Functor");
    expect(r).toBeDefined();
    expect(r!.methods).toEqual({ fmap: "algebra:mapFmap" });
  });
  test("Foldable (Map k) → algebra:mapFoldr", () => {
    expect(findMapRule("Foldable")!.methods).toEqual({ foldr: "algebra:mapFoldr" });
  });
  test("Traversable (Map k) → algebra:mapTraverse", () => {
    expect(findMapRule("Traversable")!.methods).toEqual({ traverse: "algebra:mapTraverse" });
  });

  test("a `$map`-tagged value resolves the structural Functor instance (dispatch fires)", () => {
    const r = resolveMethod("Functor", "fmap", [null, { $tag: "MapSN", a: 1, b: 2 }], ctx, dispatchRegistry);
    expect(r.$tag).toBe("Unique");
    if (r.$tag === "Unique") {
      expect(r.method).toBe("algebra:mapFmap");
      expect(r.key).toBe("MapSN");
    }
  });
});

// ===========================================================================
// (1) fmap / foldr / traverse over a `$map` value — the full dispatch pipeline.
// ===========================================================================

describe("fmap / foldr / traverse over a `$map` value (dispatched)", () => {
  test("`Functor.fmap (add 1)` maps the VALUES, keys + $tag fixed", () => {
    const out = evaluate({ method: ["Functor", "fmap", ADD1, { $tag: "MapSN", a: 1, b: 2 }] }, {}, ctx);
    expect(out).toEqual({ $tag: "MapSN", a: 2, b: 3 });
  });

  test("Functor identity law: `fmap id` preserves the map (incl. $tag)", () => {
    const ID = { fn: [["x"], { var: "x" }] };
    const out = evaluate({ method: ["Functor", "fmap", ID, { $tag: "MapSN", a: 1, b: 2 }] }, {}, ctx);
    expect(out).toEqual({ $tag: "MapSN", a: 1, b: 2 });
  });

  test("`Foldable.foldr add 0` sums the present values (skips $tag)", () => {
    const out = evaluate({ method: ["Foldable", "foldr", "add", 0, { $tag: "MapSN", a: 1, b: 2, c: 4 }] }, {}, ctx);
    expect(out).toBe(7);
  });

  test("`Traversable.traverse posMaybe` collects into Just (all values positive)", () => {
    expect(trav({ $tag: "MapSN", a: 1, b: 2 })).toEqual({ $tag: "Just", _0: { a: 1, b: 2 } });
  });

  test("`Traversable.traverse posMaybe` short-circuits to Nothing on a non-positive value", () => {
    // a=0 ⇒ posMaybe 0 = Nothing ⇒ the whole map ⇒ Nothing.
    expect(trav({ $tag: "MapSN", a: 0, b: 2 })).toEqual({ $tag: "Nothing" });
  });
});

// ===========================================================================
// (2) THE ARRAY PAYOFF — a hand-built `Vec 3 Int` (a `$map`) inherits `fmap`
//     through the structural (Map k) instance, NO Vec instance authored.
// ===========================================================================

describe("Vec inherits the map algebra for free (the array payoff)", () => {
  test("there is NO bespoke `Vec3Int` Functor instance — it rides the structural one", () => {
    const vecNominal = dispatchRegistry
      .listInstances("Functor")
      .find((i) => i.args[0] === "Vec3Int");
    expect(vecNominal).toBeUndefined();
  });

  test("`fmap (add 1)` over a `Vec 3 Int` maps every element", () => {
    const out = evaluate({ method: ["Functor", "fmap", ADD1, { $tag: "Vec3Int", "0": 10, "1": 20, "2": 30 }] }, {}, ctx);
    expect(out).toEqual({ $tag: "Vec3Int", "0": 11, "1": 21, "2": 31 });
  });

  test("`foldr add 0` over a `Vec 3 Int` sums the elements", () => {
    const out = evaluate({ method: ["Foldable", "foldr", "add", 0, { $tag: "Vec3Int", "0": 10, "1": 20, "2": 30 }] }, {}, ctx);
    expect(out).toBe(60);
  });
});

// ===========================================================================
// (3) THE BONUS (D-6c-3 closed) — the derived folds DESCEND a `$map` field
//     carrying the functor param. `FooMap a = FooMap { table: Map String a }`.
// ===========================================================================

describe("derived folds descend a `$map` field (D-6c-3 closed)", () => {
  const foo = { $tag: "FooMap", table: { x: 1, y: 2 } };

  test("derived `fmap (add 1)` maps the values inside the `table` map field", () => {
    const out = evaluate({ method: ["Functor", "fmap", ADD1, foo] }, {}, ctx);
    expect(out).toEqual({ $tag: "FooMap", table: { x: 2, y: 3 } });
  });

  test("derived `foldr add 0` folds the values inside the `table` map field", () => {
    const out = evaluate({ method: ["Foldable", "foldr", "add", 0, foo] }, {}, ctx);
    expect(out).toBe(3);
  });

  test("derived `traverse` sequences the `table` map field's effects", () => {
    expect(trav(foo)).toEqual({ $tag: "Just", _0: { $tag: "FooMap", table: { x: 1, y: 2 } } });
  });
});

// ===========================================================================
// (4) NO REGRESSION — the nominal + unary-derived resolutions are unchanged
//     (the `$map` instance is a fall-through-for-`$map`-shape, dark to them).
// ===========================================================================

describe("the `$map` instance does not disturb existing resolutions", () => {
  test("`Just` still resolves the authored `algebra:maybeFmap` (nominal precedence)", () => {
    const r = resolveMethod("Functor", "fmap", [null, { $tag: "Just", _0: 3 }], ctx, dispatchRegistry);
    expect(r.$tag).toBe("Unique");
    if (r.$tag === "Unique") expect(r.method).toEqual({ $ref: "algebra.maybeFmap" }); // modules-as-values Phase 2b
  });
  test("an array still resolves the authored List `std:map`", () => {
    const r = resolveMethod("Functor", "fmap", [null, [1, 2, 3]], ctx, dispatchRegistry);
    expect(r.$tag).toBe("Unique");
    if (r.$tag === "Unique") expect(r.method).toEqual({ $ref: "std.map" }); // modules-as-values Phase 2b
  });
  test("nominal/derived bodies still evaluate end-to-end", () => {
    expect(evaluate({ method: ["Functor", "fmap", ADD1, { $tag: "Just", _0: 3 }] }, {}, ctx)).toEqual({ $tag: "Just", _0: 4 });
    expect(evaluate({ method: ["Functor", "fmap", ADD1, [1, 2, 3]] }, {}, ctx)).toEqual([2, 3, 4]);
  });
});
