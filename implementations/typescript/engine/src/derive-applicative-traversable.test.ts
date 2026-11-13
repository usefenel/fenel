// ---------------------------------------------------------------------------
// unified-static-analysis Phase 6d — Applicative + Traversable, completing the
// derivable Haskell type-class hierarchy (Functor → Applicative → Monad /
// Foldable → Traversable) on the schema-fold substrate.
//
//   • Applicative — `ap` (dispatch arg 0) + `pure` (return-position). NOMINAL
//     Maybe/List/Result instances with REAL `algebra:*` bodies (no `g`-threading
//     problem). Derived Applicative is FENCED (D-6d-1).
//   • Traversable — `traverse` (dispatch arg 1) + `sequenceA` (= traverse id).
//     A single always-on structural instance keyed by
//     `{$pattern:"engine:isUnaryConstructor"}` gives every `* -> *` type
//     `traverse` for FREE via the generic `engine:deriveTraverse` bridge → the
//     pure `.fenel` `engine:deriveTraverseFold`/`…List` decision body.
//
// THE EMPTY-APPLICATIVE RESOLUTION (D-6d-2): `traverse f` must, in the empty
// case, return `pure (empty)` in the applicative `g` — but `g` is a TYPE (the
// return of `f : a -> g b`), not a runtime value. The bridge resolves `g`'s
// `pure`/`ap` from `f`'s declared RETURN TYPE (the sound path, covers the empty
// case) with a non-empty first-element fallback, and THREADS them into the body —
// so the body never guesses `g`. The all-empty-over-opaque-closure case is the
// documented fence (returns the value unchanged), unreachable when `f` carries a
// concrete return type (the tested case). NEVER a silently-wrong applicative.
//
// THE HEADLINE: a user `TvBox a` / `TvTree a` / `TvLabelled String a` with NO
// nominal instance traverses through the STRUCTURAL instance with NO per-type
// code, driven through a REAL `{method:["Traversable","traverse",…]}` call
// (parse + evaluate — `applyResolvedMethod → invokeFunction`, the fnId-string
// dispatch lock). Dispatch positions pinned (ap→0, traverse→1, D-6d-1); nominal
// precedence asserted.
//
// Runs in-process via createRegistry + the boot dispatchRegistry (the
// derive-foldable.test.ts pattern, no DB). type-to-set runs FIRST in the gate
// command to prime engine-body dispatch (dodge the type-catalog TDZ).
// ---------------------------------------------------------------------------

import { test, expect, describe, beforeAll } from "bun:test";
import { stdModule } from "./modules/std";
import { engineModule } from "./modules/engine";
import { algebraModule } from "./modules/algebra";
import { createRegistry } from "./registry";
import { dispatchRegistry, systemEntities } from "./system-entities";
import { deriveFunctorModule } from "./engine-bodies-dispatch";
import { resolveMethod, methodDispatchPosition } from "./effect-dispatch";
import { loadFenelModule } from "./fenel-module";
import { parse } from "./fenel-parser";
import { evaluate } from "./json-logic";
import type { EvaluateContext } from "./json-logic";
import type { FenelModule as FM } from "./types";

// Throwaway user ADTs — parametric (carry `params`) ⇒ catalog `ctor:` ⇒
// `kindArityOf > 0` ⇒ the `isUnaryConstructor` rule matches. `Tv…` prefix so they
// never collide with the `Df…`/`Fd…` sets (shared systemEntities).
const BOX = "TvBox"; //       TvBox a = TvBox a               — element only
const LABELLED = "TvLabelled"; // TvLabelled a = TvLabelled String a — fixed field + param
const PAIR2 = "TvPair2"; //   TvPair2 e a = TvPair2 e a       — BINARY (kind-soundness neg)
const TREE = "TvTree"; //     TvTree a = TvLeaf | TvNode a (TvTree) (TvTree) — recursive
const WRAP = "TvWrap"; //     TvWrap a = TvWrap (List a)      — nested foreign functor
const IDENT = "TvIdent"; //   TvIdent a = TvIdent a — an applicative whose pure/ap are REFERENCES
const BADAPP = "TvBadApp"; // TvBadApp a = TvBadApp a — an applicative whose pure is no callable
const KPAIR = "TvKPair"; //   TvKPair a = TvKPair a a — the structure traversed through them
// The section-(6) fixtures carry positional field keys (the canonical field
// shape), so structural dispatch can marshal them.
const pos = (index: number, type: unknown) => ({
  name: `_${index}`,
  key: { $tag: "PositionalField", index },
  type,
});

let ctx: EvaluateContext;

const pushEntity = (id: string, type: unknown, params: string[]): void => {
  if (!systemEntities.some((e) => e.id === id)) systemEntities.push({ id, type, params } as never);
};

// Effectful functions with CONCRETE return types — so the bridge resolves the
// applicative `g` from the declared return (the sound path, covers empty cases).
const PROBE_SRC = `
module tvprobe where
posMaybe : Int -> Maybe Int
posMaybe x = if gt x 0 then Just x else Nothing

posResult : Int -> Result String Int
posResult x = if gt x 0 then Ok x else Err "neg"

tvIdentPure : a -> TvIdent a
tvIdentPure x = TvIdent x

tvIdentAp : TvIdent (a -> b) -> TvIdent a -> TvIdent b
tvIdentAp tf tx = case tf of
  TvIdent f -> case tx of
    TvIdent x -> TvIdent (f x)

wrapIdent : Int -> TvIdent Int
wrapIdent x = TvIdent x

wrapBadApp : Int -> TvBadApp Int
wrapBadApp x = TvBadApp x
`;

beforeAll(() => {
  pushEntity(BOX, { $variant: { cases: [{ name: "TvBox", fields: [{ name: "_0", type: { $var: "a" } }] }] } }, ["a"]);
  pushEntity(
    LABELLED,
    { $variant: { cases: [{ name: "TvLabelled", fields: [{ name: "_0", type: { $ref: "String" } }, { name: "_1", type: { $var: "a" } }] }] } },
    ["a"],
  );
  pushEntity(
    PAIR2,
    { $variant: { cases: [{ name: "TvPair2", fields: [{ name: "_0", type: { $var: "e" } }, { name: "_1", type: { $var: "a" } }] }] } },
    ["e", "a"],
  );
  pushEntity(
    TREE,
    {
      $variant: {
        cases: [
          { name: "TvLeaf", fields: [] },
          { name: "TvNode", fields: [{ name: "_0", type: { $var: "a" } }, { name: "_1", type: { $ref: "TvTree" } }, { name: "_2", type: { $ref: "TvTree" } }] },
        ],
      },
    },
    ["a"],
  );
  pushEntity(
    WRAP,
    { $variant: { cases: [{ name: "TvWrap", fields: [{ name: "_0", type: { $el: { call: ["List", { $var: "a" }] } } }] }] } },
    ["a"],
  );
  pushEntity(IDENT, { $variant: { cases: [{ name: "TvIdent", fields: [pos(0, { $var: "a" })] }] } }, ["a"]);
  pushEntity(BADAPP, { $variant: { cases: [{ name: "TvBadApp", fields: [pos(0, { $var: "a" })] }] } }, ["a"]);
  pushEntity(KPAIR, { $variant: { cases: [{ name: "TvKPair", fields: [pos(0, { $var: "a" }), pos(1, { $var: "a" })] }] } }, ["a"]);
  // Applicative instances whose method values are function REFERENCES — one a
  // colon id, one a dotted `bundle.member` handle — the form instance fields
  // take when an author writes `pure = tvprobe.tvIdentPure`. TvBadApp's `pure`
  // is not a callable at all: the D-6d-2 fence must still hold for it.
  if (!dispatchRegistry.listInstances("Applicative").some((i) => i.args[0] === IDENT)) {
    dispatchRegistry.addInstance({
      typeName: "Applicative",
      args: [IDENT],
      methods: { pure: { $ref: "tvprobe:tvIdentPure" }, ap: { $ref: "tvprobe.tvIdentAp" } },
    });
  }
  if (!dispatchRegistry.listInstances("Applicative").some((i) => i.args[0] === BADAPP)) {
    dispatchRegistry.addInstance({
      typeName: "Applicative",
      args: [BADAPP],
      methods: { pure: 42, ap: { $ref: "tvprobe:tvIdentAp" } },
    });
  }

  const probe = loadFenelModule(PROBE_SRC, "tvprobe");
  const probeMod: FM = { name: "tvprobe", label: "tvprobe", functions: probe.functions, instances: probe.instances };
  const reg = createRegistry([stdModule, engineModule, algebraModule, deriveFunctorModule, probeMod], { dispatchRegistry });
  ctx = reg.evaluateContext();
});

const ev = (src: string): unknown => evaluate(parse(src), {}, ctx);

// ===========================================================================
// (0) Classes registered; dispatch positions ap→0, traverse→1 (D-6d-1).
// ===========================================================================

describe("Applicative + Traversable classes are registered + dispatch positions pinned", () => {
  test("`Applicative.ap` dispatches on arg position 0 (the `f<(a->b)>`)", () => {
    expect(methodDispatchPosition(dispatchRegistry, "Applicative", "ap")).toBe(0);
  });

  test("`Applicative.pure` is return-position (not dispatched)", () => {
    expect(methodDispatchPosition(dispatchRegistry, "Applicative", "pure")).toBe(-1);
  });

  test("`Traversable.traverse` dispatches on arg position 1 (the `f<a>` structure)", () => {
    expect(methodDispatchPosition(dispatchRegistry, "Traversable", "traverse")).toBe(1);
  });

  test("the always-on derived Traversable instance is a `{$pattern}` ByPattern rule", () => {
    const derived = dispatchRegistry.listInstances("Traversable").find(
      (i) => i.args[0] && typeof i.args[0] === "object" && (i.args[0] as { $pattern?: unknown }).$pattern === "engine:isUnaryConstructor",
    );
    expect(derived).toBeDefined();
    expect(derived!.methods).toEqual({ traverse: "engine:deriveTraverse" });
  });
});

// ===========================================================================
// (1) APPLICATIVE — nominal `ap`/`pure` for Maybe/List/Result, driven through a
//     REAL `{method:["Applicative","ap",…]}` call (the dispatch lock).
// ===========================================================================

describe("Applicative.ap dispatches + evaluates through the nominal bodies", () => {
  test("Maybe: `ap (Just f) (Just x)` ⟹ `Just (f x)`; Nothing short-circuits", () => {
    expect(ev("Applicative.ap (Just (\\x -> add x 1)) (Just 5)")).toEqual({ $tag: "Just", _0: 6 });
    expect(ev("Applicative.ap (Nothing) (Just 5)")).toEqual({ $tag: "Nothing" });
    expect(ev("Applicative.ap (Just (\\x -> add x 1)) (Nothing)")).toEqual({ $tag: "Nothing" });
  });

  test("List: `ap fs xs` is the cartesian product `[f x | f <- fs, x <- xs]`", () => {
    expect(ev("Applicative.ap [(\\x -> add x 1), (\\x -> add x 10)] [1, 2]")).toEqual([2, 3, 11, 12]);
  });

  test("Result: `ap (Ok f) (Ok x)` ⟹ `Ok (f x)`; Err short-circuits", () => {
    expect(ev("Applicative.ap (Ok (\\x -> add x 1)) (Ok 5)")).toEqual({ $tag: "Ok", _0: 6 });
    expect(ev('Applicative.ap (Err "boom") (Ok 5)')).toEqual({ $tag: "Err", _0: "boom" });
  });

  test("dispatch position 0: `ap` keys on the wrapped-function arg (D-6d-1)", () => {
    const r = resolveMethod("Applicative", "ap", [{ $tag: "Just", _0: 1 }, { $tag: "Just", _0: 2 }], ctx, dispatchRegistry);
    expect(r.$tag).toBe("Unique");
    if (r.$tag === "Unique") {
      expect(r.key).toBe("Maybe");
      // modules-as-values Phase 2b: the instance holds a qualified reference.
      expect(r.method).toEqual({ $ref: "algebra.maybeAp" });
    }
  });

  // Applicative-law spot-checks (soundness footnote (a)).
  test("law: identity — `ap (pure id) v == v` (Maybe)", () => {
    expect(ev("Applicative.ap (Just (\\x -> x)) (Just 7)")).toEqual({ $tag: "Just", _0: 7 });
  });

  test("law: homomorphism — `ap (pure f) (pure x) == pure (f x)` (Maybe, via the maybePure handle)", () => {
    // pure = Just for Maybe; ap (Just f) (Just x) == Just (f x).
    expect(ev("Applicative.ap (Just (\\x -> mul x 2)) (Just 4)")).toEqual({ $tag: "Just", _0: 8 });
  });
});

// ===========================================================================
// (2) TRAVERSABLE — derived traverse over a user `* -> *` ADT with NO per-type
//     code, the applicative `g` resolved from `f`'s return type (D-6d-2).
// ===========================================================================

describe("derived traverse over a user `* -> *` ADT (g resolved from f's return type)", () => {
  test("`traverse posMaybe (TvBox 5)` ⟹ `Just (TvBox 5)` (element field)", () => {
    expect(ev("Traversable.traverse posMaybe (TvBox 5)")).toEqual({ $tag: "Just", _0: { $tag: "TvBox", _0: 5 } });
  });

  test("the effect short-circuits: `traverse posMaybe (TvBox -3)` ⟹ `Nothing`", () => {
    expect(ev("Traversable.traverse posMaybe (TvBox (negate 3))")).toEqual({ $tag: "Nothing" });
  });

  test("traverses ONLY the functor param, LEAVES a non-param field", () => {
    // TvLabelled String a — `_0` String (left in the pure-wrapped value), `_1` a
    // (traversed). The String survives untouched inside the applicative.
    expect(ev('Traversable.traverse posMaybe (TvLabelled "lbl" 5)')).toEqual({
      $tag: "Just",
      _0: { $tag: "TvLabelled", _0: "lbl", _1: 5 },
    });
  });

  test("self-recursive fields recurse: traverse over a TvTree sequences every leaf", () => {
    const r = ev("Traversable.traverse posMaybe (TvNode 1 (TvNode 2 (TvLeaf) (TvLeaf)) (TvLeaf))");
    expect(r).toEqual({
      $tag: "Just",
      _0: { $tag: "TvNode", _0: 1, _1: { $tag: "TvNode", _0: 2, _1: { $tag: "TvLeaf" }, _2: { $tag: "TvLeaf" } }, _2: { $tag: "TvLeaf" } },
    });
  });

  test("a recursive subtree's effect short-circuits the whole traversal to Nothing", () => {
    expect(ev("Traversable.traverse posMaybe (TvNode 1 (TvNode (negate 9) (TvLeaf) (TvLeaf)) (TvLeaf))")).toEqual({ $tag: "Nothing" });
  });

  test("kind-soundness: a BINARY constructor does NOT derive Traversable (the unary bound)", () => {
    pushEntity(PAIR2, { $variant: { cases: [{ name: "TvPair2", fields: [{ name: "_0", type: { $var: "e" } }, { name: "_1", type: { $var: "a" } }] }] } }, ["e", "a"]);
    const r = resolveMethod("Traversable", "traverse", [null, { $tag: "TvPair2", _0: "e", _1: 5 }], ctx, dispatchRegistry);
    expect(r.$tag).toBe("None");
  });
});

// ===========================================================================
// (2b) NESTED FOREIGN FUNCTOR (D-6d-4): a `List a` field re-dispatches
//      `Traversable.traverse` on the nested value (one level).
// ===========================================================================

describe("nested foreign functor (D-6d-4): a List field traverses its elements", () => {
  test("`traverse posMaybe (TvWrap [1,2,3])` ⟹ `Just (TvWrap [1,2,3])`", () => {
    expect(ev("Traversable.traverse posMaybe (TvWrap [1, 2, 3])")).toEqual({
      $tag: "Just",
      _0: { $tag: "TvWrap", _0: [1, 2, 3] },
    });
  });

  test("an effect inside the nested functor short-circuits the whole result", () => {
    expect(ev("Traversable.traverse posMaybe (TvWrap [1, (negate 2), 3])")).toEqual({ $tag: "Nothing" });
  });

  test("an empty nested functor traverses to `Just (TvWrap [])`", () => {
    expect(ev("Traversable.traverse posMaybe (TvWrap [])")).toEqual({ $tag: "Just", _0: { $tag: "TvWrap", _0: [] } });
  });
});

// ===========================================================================
// (3) TRAVERSE over Maybe / List / Result, incl. THE EMPTY CASES (D-6d-2 — g
//     resolved from the return type, so the empty case is sound).
// ===========================================================================

describe("traverse over the foundation Traversables incl. the empty case (D-6d-2)", () => {
  test("List (non-empty): `traverse posMaybe [1,2,3]` ⟹ `Just [1,2,3]`", () => {
    expect(ev("Traversable.traverse posMaybe [1, 2, 3]")).toEqual({ $tag: "Just", _0: [1, 2, 3] });
  });

  test("List effect short-circuits: `traverse posMaybe [1,-2,3]` ⟹ `Nothing`", () => {
    expect(ev("Traversable.traverse posMaybe [1, (negate 2), 3]")).toEqual({ $tag: "Nothing" });
  });

  test("THE EMPTY LIST: `traverse posMaybe []` ⟹ `Just []` (pure [], g from return type)", () => {
    expect(ev("Traversable.traverse posMaybe []")).toEqual({ $tag: "Just", _0: [] });
  });

  test("Maybe: `traverse posMaybe (Just 5)` ⟹ `Just (Just 5)`; the EMPTY `Nothing` ⟹ `Just Nothing`", () => {
    expect(ev("Traversable.traverse posMaybe (Just 5)")).toEqual({ $tag: "Just", _0: { $tag: "Just", _0: 5 } });
    expect(ev("Traversable.traverse posMaybe (Nothing)")).toEqual({ $tag: "Just", _0: { $tag: "Nothing" } });
  });

  test("Result with g = Result: `traverse posResult (Ok 5)` ⟹ `Ok (Ok 5)`; EMPTY `Err` ⟹ `Ok (Err …)`", () => {
    expect(ev("Traversable.traverse posResult (Ok 5)")).toEqual({ $tag: "Ok", _0: { $tag: "Ok", _0: 5 } });
    expect(ev('Traversable.traverse posResult (Err "x")')).toEqual({ $tag: "Ok", _0: { $tag: "Err", _0: "x" } });
  });
});

// ===========================================================================
// (4) sequenceA = traverse id, derived over Traversable.
// ===========================================================================

describe("sequenceA derives from traverse", () => {
  test("`sequenceA [Just 1, Just 2, Just 3]` ⟹ `Just [1,2,3]`", () => {
    expect(ev("sequenceA [Just 1, Just 2, Just 3]")).toEqual({ $tag: "Just", _0: [1, 2, 3] });
  });

  test("`sequenceA [Just 1, Nothing, Just 3]` ⟹ `Nothing`", () => {
    expect(ev("sequenceA [Just 1, Nothing, Just 3]")).toEqual({ $tag: "Nothing" });
  });
});

// ===========================================================================
// (5) NOMINAL PRECEDENCE — the authored Maybe/List/Result Traversable instances
//     WIN; the derived instance is the last-resort fall-through.
// ===========================================================================

describe("nominal precedence: authored Traversable instances win over the derived fall-through", () => {
  test("`Just` resolves the AUTHORED Maybe instance (key Maybe), not the `{$pattern}` rule", () => {
    const r = resolveMethod("Traversable", "traverse", [null, { $tag: "Just", _0: 3 }], ctx, dispatchRegistry);
    expect(r.$tag).toBe("Unique");
    if (r.$tag === "Unique") expect(r.key).toBe("Maybe");
  });

  test("an array resolves the AUTHORED List instance (key List)", () => {
    const r = resolveMethod("Traversable", "traverse", [null, [1, 2, 3]], ctx, dispatchRegistry);
    expect(r.$tag).toBe("Unique");
    if (r.$tag === "Unique") expect(r.key).toBe("List");
  });

  test("a user `TvBox` resolves the DERIVED structural instance (key TvBox)", () => {
    const r = resolveMethod("Traversable", "traverse", [null, { $tag: "TvBox", _0: 3 }], ctx, dispatchRegistry);
    expect(r.$tag).toBe("Unique");
    if (r.$tag === "Unique") {
      expect(r.key).toBe("TvBox");
      expect(r.method).toBe("engine:deriveTraverse");
    }
  });
});

// ===========================================================================
// (6) modules-as-values — the resolved Applicative's `pure`/`ap` may be
//     function REFERENCES (`{$ref}`), not only id strings. A reference used to
//     fail the string check, so `traverse` silently returned its input.
// ===========================================================================

describe("derived traverse with an Applicative whose pure/ap are references", () => {
  test("`traverse wrapIdent (TvKPair 1 2)` ⟹ `TvIdent (TvKPair 1 2)` (colon-id pure, dotted ap, two ap steps)", () => {
    expect(ev("Traversable.traverse wrapIdent (TvKPair 1 2)")).toEqual({
      $tag: "TvIdent",
      _0: { $tag: "TvKPair", _0: 1, _1: 2 },
    });
  });

  test("the D-6d-2 fence still holds: a `pure` that is no callable leaves the value unchanged", () => {
    expect(ev("Traversable.traverse wrapBadApp (TvKPair 1 2)")).toEqual({ $tag: "TvKPair", _0: 1, _1: 2 });
  });
});
