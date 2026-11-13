// ---------------------------------------------------------------------------
// unified-static-analysis Phase 6c — the Foldable half of the derivation
// capstone: any `* -> *` type WITHOUT an authored `Foldable` instance gets
// `foldr` (and the derived `toList` / `foldableLength` over it) for FREE.
//
// A single always-on structural `Foldable` instance keyed by
// `{$pattern:"engine:isUnaryConstructor"}` (registered at boot in
// system-entities.ts) resolves through the SHIPPED `matchStructural` substrate.
// Its `foldr = "engine:deriveFoldr"` is a category-B reflection+marshal bridge
// (engine-bodies-dispatch.ts) that reflects the dispatched value's owning type,
// marshals its schema across the `$`-key barrier via `marshalTraversalType`, and
// delegates the DECISION to the PURE Fenel `engine:deriveFoldrFold` body
// (fenel/modules/engine/derive-foldable.fenel) — the `$tag`-correct,
// multi-param-SOUND successor to the legacy `__case`-era TS `structuralFold`.
//
// THE HEADLINE: a user `FdBox a` / `FdTree a` / `FdLabelled String a` with NO
// nominal instance folds through the STRUCTURAL instance with NO per-type code:
//   • `foldr (+) 0 (FdBox 5)        == 5`               — element field
//   • `foldr (+) 0 (FdNode 1 ..)    == sum of every a`  — self-recursion
//   • `foldr (+) 0 (FdLabelled s a) == a`               — folds ONLY `a`, SKIPS
//                                                          the String (multi-param
//                                                          repair)
// driven through a REAL `{method:["Foldable","foldr",…]}` call (parse + evaluate),
// so it exercises `applyResolvedMethod → invokeFunction` with the fnId-STRING
// method (the dispatch-path lock). The dispatch position (2 — the `f<a>`) is
// pinned (D-6c-1); nominal precedence is asserted (D-6c-4).
//
// NESTED FOREIGN FUNCTOR (D-6b-5, closed in 6c): a `Maybe a` / `List a` field
// inside another functor re-dispatches `Foldable.foldr` on the nested value.
//
// Runs in-process via createRegistry + the boot dispatchRegistry (the
// derive-functor.test.ts pattern, no DB). type-to-set runs FIRST in the gate
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
import { parse } from "./fenel-parser";
import { evaluate } from "./json-logic";
import type { EvaluateContext } from "./json-logic";

// Throwaway user ADTs — parametric (carry `params`) ⇒ catalog `ctor:` section ⇒
// `kindArityOf > 0` ⇒ the `isUnaryConstructor` rule matches. `Fd…` prefix so they
// never collide with derive-functor.test.ts's `Df…` set (shared systemEntities).
const BOX = "FdBox"; // FdBox a = FdBox a               (* -> *)  — element only
const LABELLED = "FdLabelled"; // FdLabelled a = FdLabelled String a — the
//   multi-FIELD repair: a UNARY type with a NON-param field. foldr folds ONLY
//   `a`, SKIPS the fixed String (a binary type-VAR would make it `* -> * -> *`,
//   which the unary-keyed derived Foldable correctly does not dispatch on).
const PAIR2 = "FdPair2"; // FdPair2 e a = FdPair2 e a    (* -> * -> *) — BINARY
//   kind-soundness NEGATIVE: the bare key is `* -> * -> *`, so the unary-keyed
//   derived Foldable does NOT resolve for it.
const TREE = "FdTree"; // FdTree a = FdLeaf | FdNode a (FdTree) (FdTree) — recursive
const WRAP = "FdWrap"; // FdWrap a = FdWrap (List a) — the NESTED foreign functor
//   (D-6b-5): the param sits DIRECTLY under `List` ⇒ marshalled `TtApp` whose
//   args carry `TtVar "a"` ⇒ the fold re-dispatches `Foldable.foldr` on the list.

let ctx: EvaluateContext;
let reg: ReturnType<typeof createRegistry>;

const pushEntity = (id: string, type: unknown, params: string[]): void => {
  if (!systemEntities.some((e) => e.id === id)) {
    systemEntities.push({ id, type, params } as never);
  }
};

beforeAll(() => {
  pushEntity(
    BOX,
    { $variant: { cases: [{ name: "FdBox", fields: [{ name: "_0", type: { $var: "a" } }] }] } },
    ["a"],
  );
  pushEntity(
    LABELLED,
    {
      $variant: {
        cases: [
          {
            name: "FdLabelled",
            fields: [
              { name: "_0", type: { $ref: "String" } },
              { name: "_1", type: { $var: "a" } },
            ],
          },
        ],
      },
    },
    ["a"],
  );
  pushEntity(
    PAIR2,
    {
      $variant: {
        cases: [
          {
            name: "FdPair2",
            fields: [
              { name: "_0", type: { $var: "e" } },
              { name: "_1", type: { $var: "a" } },
            ],
          },
        ],
      },
    },
    ["e", "a"],
  );
  pushEntity(
    TREE,
    {
      $variant: {
        cases: [
          { name: "FdLeaf", fields: [] },
          {
            name: "FdNode",
            fields: [
              { name: "_0", type: { $var: "a" } },
              { name: "_1", type: { $ref: "FdTree" } },
              { name: "_2", type: { $ref: "FdTree" } },
            ],
          },
        ],
      },
    },
    ["a"],
  );
  pushEntity(
    WRAP,
    {
      // FdWrap a = FdWrap (List a) — the param under a DIFFERENT constructor.
      // The `{$el:{call:["List", {$var:"a"}]}}` field marshals to `TtApp{args:[
      // TtVar "a"]}` (the head `List` is dropped) — the one-level nested-functor
      // shape the fold re-dispatches on.
      $variant: {
        cases: [
          {
            name: "FdWrap",
            fields: [{ name: "_0", type: { $el: { call: ["List", { $var: "a" }] } } }],
          },
        ],
      },
    },
    ["a"],
  );

  reg = createRegistry([stdModule, engineModule, algebraModule, deriveFunctorModule], {
    dispatchRegistry,
  });
  ctx = reg.evaluateContext();
});

const ev = (src: string): unknown => evaluate(parse(src), {}, ctx);

// ===========================================================================
// (0) The always-on derived Foldable instance is registered + resolves; the
//     dispatch position is 2 (D-6c-1, derived from the `.fenel` decl).
// ===========================================================================

describe("the derived structural Foldable instance", () => {
  test("is registered at boot as a `{$pattern}` ByPattern rule (not a nominal arg)", () => {
    const insts = dispatchRegistry.listInstances("Foldable");
    const derived = insts.find(
      (i) =>
        i.args[0] &&
        typeof i.args[0] === "object" &&
        (i.args[0] as { $pattern?: unknown }).$pattern === "engine:isUnaryConstructor",
    );
    expect(derived).toBeDefined();
    expect(derived!.methods).toEqual({ foldr: "engine:deriveFoldr" });
  });

  test("`Foldable.foldr` dispatches on arg position 2 — the `f<a>` (D-6c-1, `.fenel`-derived)", () => {
    expect(methodDispatchPosition(dispatchRegistry, "Foldable", "foldr")).toBe(2);
  });

  test("a unary constructor with NO nominal instance resolves the derived foldr fnId", () => {
    const r = resolveMethod("Foldable", "foldr", [null, null, { $tag: "FdBox", _0: 5 }], ctx, dispatchRegistry);
    expect(r.$tag).toBe("Unique");
    if (r.$tag === "Unique") {
      expect(r.method).toBe("engine:deriveFoldr");
      expect(r.key).toBe("FdBox");
    }
  });
});

// ===========================================================================
// (1) THE HEADLINE — derivation via a REAL `{method:…}` call (the fnId-string
//     dispatch-path lock: applyResolvedMethod → invokeFunction).
// ===========================================================================

describe("derived foldr folds a user `* -> *` ADT with NO per-type code", () => {
  test("`Foldable.foldr add 0 (FdBox 5)` ⟹ `5` (element field)", () => {
    expect(ev("Foldable.foldr add 0 (FdBox 5)")).toBe(5);
  });

  test("the fold folds ONLY the functor param, SKIPS a non-param field", () => {
    // FdLabelled String a — `_0` is a fixed `String` (TtNamed "String", NOT the
    // param) ⇒ SKIPPED; `_1` is the param `a` ⇒ folded. THE structuralFold repair:
    // the legacy TS folded EVERY non-recursive field — it would have fed the "lbl"
    // String to the binop. Classifying by FUNCTOR-PARAM IDENTITY folds only `a`.
    expect(ev('Foldable.foldr add 0 (FdLabelled "lbl" 5)')).toBe(5);
  });

  test("self-recursive fields recurse: foldr over a FdTree sums every leaf `a`", () => {
    expect(ev("Foldable.foldr add 0 (FdNode 1 (FdNode 2 (FdLeaf) (FdLeaf)) (FdLeaf))")).toBe(3);
  });

  test("a nullary case of a recursive type folds to the seed", () => {
    expect(ev("Foldable.foldr add 100 (FdLeaf)")).toBe(100);
  });

  test("right-fold ORDER: `foldr sub 0 [1,2,3]` ⟹ 2 (right-assoc, not left)", () => {
    // foldr sub 0 [1,2,3] = sub 1 (sub 2 (sub 3 0)) = 1 - (2 - (3 - 0)) = 2.
    // A LEFT fold would give ((0-1)-2)-3 = -6, so this pins the foldr CONTRACT
    // (rightmost element touches the seed first) — the listFoldr body's order.
    expect(ev("Foldable.foldr sub 0 [1, 2, 3]")).toBe(2);
  });

  test("kind-soundness: a BINARY constructor does NOT derive Foldable (the unary bound)", () => {
    const r = resolveMethod("Foldable", "foldr", [null, null, { $tag: "FdPair2", _0: "e", _1: 5 }], ctx, dispatchRegistry);
    expect(r.$tag).toBe("None");
  });
});

// ===========================================================================
// (1b) DERIVED HELPERS — `toList` / `foldableLength` derive FROM `foldr` as
//      ordinary std functions over `Foldable` (work on the derived instance).
// ===========================================================================

describe("toList / foldableLength derive from foldr over the structural instance", () => {
  test("`toList (FdBox 5)` ⟹ `[5]`", () => {
    expect(ev("toList (FdBox 5)")).toEqual([5]);
  });

  test("`toList` over a FdTree collects every element in fold order", () => {
    expect(ev("toList (FdNode 1 (FdNode 2 (FdLeaf) (FdLeaf)) (FdLeaf))")).toEqual([1, 2]);
  });

  test("`foldableLength` counts the elements of a derived Foldable", () => {
    expect(ev("foldableLength (FdBox 5)")).toBe(1);
    expect(ev("foldableLength (FdNode 1 (FdNode 2 (FdLeaf) (FdLeaf)) (FdLeaf))")).toBe(2);
  });
});

// ===========================================================================
// (1c) NESTED FOREIGN FUNCTOR — D-6b-5 closed: a `List a` field folds its
//      elements by re-dispatching `Foldable.foldr` on the nested value.
// ===========================================================================

describe("nested foreign functor (D-6b-5): a List/Maybe field folds its elements", () => {
  test("`foldr add 0 (FdWrap [1,2,3])` folds the LIST elements (re-dispatch) ⟹ 6", () => {
    expect(ev("Foldable.foldr add 0 (FdWrap [1, 2, 3])")).toBe(6);
  });

  test("`toList (FdWrap [1,2,3])` ⟹ `[1,2,3]` (the nested elements flow out)", () => {
    expect(ev("toList (FdWrap [1, 2, 3])")).toEqual([1, 2, 3]);
  });

  test("an empty nested functor folds to the seed", () => {
    expect(ev("Foldable.foldr add 0 (FdWrap [])")).toBe(0);
  });
});

// ===========================================================================
// (2) NOMINAL PRECEDENCE — the authored Maybe/List/Result Foldable instances
//     WIN; the derived instance is the last-resort fall-through (D-6c-4).
// ===========================================================================

describe("nominal precedence: authored Foldable instances win over the derived fall-through", () => {
  test("`Just` resolves the AUTHORED `algebra:maybeFoldr`, NOT `engine:deriveFoldr`", () => {
    const r = resolveMethod("Foldable", "foldr", [null, null, { $tag: "Just", _0: 3 }], ctx, dispatchRegistry);
    expect(r.$tag).toBe("Unique");
    if (r.$tag === "Unique") {
      expect(r.key).toBe("Maybe");
      expect(r.method).toEqual({ $ref: "algebra.maybeFoldr" }); // the qualified reference (modules-as-values Phase 2b)
    }
  });

  test("an array resolves the AUTHORED List `algebra:listFoldr`, NOT `engine:deriveFoldr`", () => {
    const r = resolveMethod("Foldable", "foldr", [null, null, [1, 2, 3]], ctx, dispatchRegistry);
    expect(r.$tag).toBe("Unique");
    if (r.$tag === "Unique") {
      expect(r.key).toBe("List");
      expect(r.method).toEqual({ $ref: "algebra.listFoldr" }); // the qualified reference (modules-as-values Phase 2b)
    }
  });

  test("`Ok` resolves the AUTHORED `algebra:resultFoldr`, NOT `engine:deriveFoldr`", () => {
    const r = resolveMethod("Foldable", "foldr", [null, null, { $tag: "Ok", _0: 3 }], ctx, dispatchRegistry);
    expect(r.$tag).toBe("Unique");
    if (r.$tag === "Unique") {
      expect(r.key).toBe("Result");
      expect(r.method).toEqual({ $ref: "algebra.resultFoldr" }); // the qualified reference (modules-as-values Phase 2b)
    }
  });

  test("the authored instances EVALUATE through their nominal bodies", () => {
    expect(ev("Foldable.foldr add 0 (Just 3)")).toBe(3);
    expect(ev("Foldable.foldr add 100 (Nothing)")).toBe(100);
    expect(ev("Foldable.foldr add 0 [1, 2, 3]")).toBe(6);
    expect(ev("Foldable.foldr add 0 (Ok 5)")).toBe(5);
    expect(ev("Foldable.foldr add 0 (Err 9)")).toBe(0);
  });
});
