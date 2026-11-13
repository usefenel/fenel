// ---------------------------------------------------------------------------
// array-substrate Phase 1a.5 Step 0 — the structural-dispatch parametric-ctor
// fix (the dispatch unblock).
//
// THE FINDING (Phase-1a surprise #2): a PARAMETRIC `$map`-shaped constructor
// (`Vec n a = $map (Fin n) a`, `MapKV k v = $map k v`) lives in the catalog
// `ctor:` section, not `entity:`. `resolveStructural` (effect-dispatch.ts)
// resolved the dispatched type's schema via `getEntityTypeByName` — `entity:`
// ONLY — so a parametric ctor fast-missed `undefined` and never marshalled to
// `TtMap` ⇒ `isMapShaped` never fired ⇒ `resolveMethod("Functor","fmap",…)`
// returned `None` at 1a HEAD.
//
// THE FIX: `resolveStructural` now resolves the schema via `deriveResolveSchema`
// (the `ctor:`∪`entity:` resolver the derive bridges + `kindArityOf` already use
// — a CONSOLIDATION, the DECISION stays the `.fenel` `isMapShaped` predicate). So
// a parametric `$map`-shaped ctor marshals to `TtMap` and the structural
// `(Map k)` Functor instance fires PARAMETRICALLY.
//
// This probe registers a THROWAWAY parametric `$map`-shaped ctor (arity 2, so
// the `isUnaryConstructor` kind rule does NOT shadow the `isMapShaped` structural
// rule) and confirms `resolveMethod` now returns `Unique algebra:mapFmap`.
// Mirrors the map-algebra.test harness (in-process createRegistry, no DB).
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
import type { EvaluateContext } from "./json-logic";

let ctx: EvaluateContext;
let reg: ReturnType<typeof createRegistry>;

const pushEntity = (id: string, type: unknown, params: string[]): void => {
  if (!systemEntities.some((e) => e.id === id)) {
    systemEntities.push({ id, type, params } as never);
  }
};

beforeAll(() => {
  // A PARAMETRIC `$map`-shaped ctor — arity 2 (`MapKV k v = $map k v`), so it
  // lands in the catalog `ctor:` section (params non-empty), NOT `entity:`. At 1a
  // HEAD `resolveStructural` fast-missed it (`getEntityTypeByName` is `entity:`-
  // only). Arity 2 ⇒ the `isUnaryConstructor` (arity-EXACTLY-1) kind rule does NOT
  // match, isolating the `isMapShaped` structural rule under test.
  pushEntity(
    "MapKV",
    { $map: { keys: { $var: "k" }, values: { $var: "v" } } },
    ["k", "v"],
  );

  reg = createRegistry([stdModule, engineModule, algebraModule, deriveFunctorModule], {
    dispatchRegistry,
  });
  ctx = reg.evaluateContext();
});

describe("a parametric `$map`-shaped ctor resolves the structural algebra (Step 0)", () => {
  test("MapKV lands in the catalog `ctor:` section (not `entity:`)", () => {
    // eslint-disable-next-line @typescript-eslint/no-require-imports, @typescript-eslint/no-var-requires
    const { getCatalogEntry } = require("./type-catalog") as typeof import("./type-catalog");
    expect(getCatalogEntry("ctor:MapKV")?.entity?.type).toEqual({
      $map: { keys: { $var: "k" }, values: { $var: "v" } },
    } as never);
    expect(getCatalogEntry("entity:MapKV")).toBeUndefined();
  });

  test("there is NO bespoke `MapKV` Functor instance — it must ride the structural one", () => {
    const nominal = dispatchRegistry
      .listInstances("Functor")
      .find((i) => i.args[0] === "MapKV");
    expect(nominal).toBeUndefined();
  });

  test("resolveMethod returns `Unique algebra:mapFmap` (was `None` at 1a HEAD)", () => {
    const r = resolveMethod(
      "Functor",
      "fmap",
      [null, { $tag: "MapKV", a: 1, b: 2 }],
      ctx,
      dispatchRegistry,
    );
    expect(r.$tag).toBe("Unique");
    if (r.$tag === "Unique") {
      expect(r.method).toBe("algebra:mapFmap");
      expect(r.key).toBe("MapKV");
    }
  });

  test("`Foldable.foldr` / `Traversable.traverse` resolve structurally too", () => {
    // foldr dispatches on its container arg (index 2 of `foldr f z xs`).
    const f = resolveMethod("Foldable", "foldr", [null, null, { $tag: "MapKV", a: 1 }], ctx, dispatchRegistry);
    expect(f.$tag).toBe("Unique");
    if (f.$tag === "Unique") expect(f.method).toBe("algebra:mapFoldr");
    // traverse dispatches on its container arg (index 1 of `traverse g xs`).
    const t = resolveMethod("Traversable", "traverse", [null, { $tag: "MapKV", a: 1 }], ctx, dispatchRegistry);
    expect(t.$tag).toBe("Unique");
    if (t.$tag === "Unique") expect(t.method).toBe("algebra:mapTraverse");
  });

  test("the structural instance evaluates end-to-end (fmap maps the values, $tag fixed)", () => {
    const ADD1 = { fn: [["x"], { call: ["add", { var: "x" }, 1] }] };
    const out = evaluate(
      { method: ["Functor", "fmap", ADD1, { $tag: "MapKV", a: 1, b: 2 }] },
      {},
      ctx,
    );
    expect(out).toEqual({ $tag: "MapKV", a: 2, b: 3 });
    // foldr end-to-end (container is the 3rd arg).
    const sum = evaluate(
      { method: ["Foldable", "foldr", "add", 0, { $tag: "MapKV", a: 1, b: 2, c: 4 }] },
      {},
      ctx,
    );
    expect(sum).toBe(7);
  });
});
