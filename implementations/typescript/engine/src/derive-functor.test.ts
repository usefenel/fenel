// ---------------------------------------------------------------------------
// unified-static-analysis Phase 6b — the derivation capstone: any `* -> *` type
// WITHOUT an authored `Functor` instance gets `fmap` for FREE.
//
// A single always-on structural `Functor` instance keyed by
// `{$pattern:"engine:isUnaryConstructor"}` (registered at boot in
// system-entities.ts) resolves through the SHIPPED `matchStructural` substrate
// (5c made kinds a live `ByPattern` bound; 6a made real parametric constructors
// dispatch by KIND). Its `fmap = "engine:deriveFmap"` is a category-B
// reflection+marshal bridge (engine-bodies-dispatch.ts) that reflects the
// dispatched value's owning type, marshals its schema across the `$`-key barrier
// via `marshalTraversalType`, and delegates the DECISION to the PURE Fenel
// `engine:deriveFmapFold` body (fenel/modules/engine/derive-functor.fenel) — the
// `$tag`-correct, multi-param-SOUND successor to the legacy `__case`-era TS
// `structuralMap`.
//
// THE HEADLINE: a user `DfBox a` / `DfTree a` / `DfPair2 e a` with NO nominal
// instance maps through the STRUCTURAL instance with NO per-type code:
//   • `fmap g (DfBox x)        == DfBox (g x)`              — element field
//   • `fmap g (DfNode x l r)   == DfNode (g x) (fmap..l) ..` — self-recursion
//   • `fmap g (DfPair2 e a)    == DfPair2 e (g a)`          — maps ONLY `a`,
//                                                             LEAVES `e` (the
//                                                             multi-param repair)
// driven through a REAL `{method:["Functor","fmap",…]}` call (parse + evaluate),
// so it exercises `applyResolvedMethod → invokeFunction` with the fnId-STRING
// method — the Agent-1 dispatch-path lock the prior structural tests never hit
// (they used a TS closure + bare `resolveEffect`).
//
// NOMINAL PRECEDENCE (D-6b-2): a real `Just`/array/`Ok` still resolves the
// AUTHORED `maybeFunctor`/`listFunctor`/`resultFunctor` — the nominal cascade
// wins BEFORE `resolveStructural`. Asserted via `resolveMethod` (the method
// projected is the authored fnId, NOT `engine:deriveFmap`).
//
// Runs in-process via createRegistry + the boot dispatchRegistry (the
// kind-bypattern.test.ts pattern, no DB) — `[stdModule, engineModule,
// algebraModule, deriveFunctorModule]` so the engine fold body + the bridge
// native + the nominal algebra bodies all resolve. The throwaway `Df…` entities
// are pushed into `systemEntities` (the `pushEntity` precedent) so they surface
// in the catalog `ctor:` section (parametric ⇒ `kindArityOf > 0`) and in
// `_caseOwner`. type-to-set runs FIRST in the gate command to prime engine-body
// dispatch (dodge the type-catalog TDZ).
// ---------------------------------------------------------------------------

import { test, expect, describe, beforeAll } from "bun:test";
import { stdModule } from "./modules/std";
import { engineModule } from "./modules/engine";
import { algebraModule } from "./modules/algebra";
import { createRegistry } from "./registry";
import { dispatchRegistry, systemEntities } from "./system-entities";
import { deriveFunctorModule } from "./engine-bodies-dispatch";
import { resolveMethod } from "./effect-dispatch";
import { parse } from "./fenel-parser";
import { evaluate } from "./json-logic";
import type { EvaluateContext } from "./json-logic";

// Throwaway user ADTs — parametric (carry `params`) so they live in the catalog
// `ctor:` section ⇒ `kindArityOf > 0` ⇒ the `isUnaryConstructor` rule matches.
const BOX = "DfBox"; // DfBox a = DfBox a                 (* -> *)  — element only
const LABELLED = "DfLabelled"; // DfLabelled a = DfLabelled String a  (* -> *) — the
//   multi-FIELD repair: a UNARY type with a NON-param field. The functor param
//   `a` coexists with a fixed `String`; fmap maps ONLY `a`, LEAVES the String.
//   This is the realistic structuralMap repair for the DERIVED path — a
//   different type-VAR `e` would make the type BINARY (`* -> * -> *`), which the
//   unary-keyed derived Functor (correctly) does not dispatch on (see PAIR2).
const PAIR2 = "DfPair2"; // DfPair2 e a = DfPair2 e a     (* -> * -> *) — BINARY,
//   the kind-soundness NEGATIVE: a binary constructor's bare key is `* -> * -> *`,
//   so the unary-keyed derived Functor does NOT resolve for it (5b surprise #3 —
//   the bare-constructor key loses the partial application that makes `Pair2 e`
//   a functor; nominal instances handle those, e.g. `Functor (Result e)`).
const TREE = "DfTree"; // DfTree a = DfLeaf | DfNode a (DfTree) (DfTree)  — recursive
const WRAP = "DfWrap"; // DfWrap a = DfWrap (List a) — the NESTED foreign functor
//   (D-6b-5, closed in 6c): the param sits DIRECTLY under `List`, marshalled to a
//   `TtApp` whose args carry `TtVar "a"` (the head `List` is dropped). fmap now
//   RE-DISPATCHES `Functor.fmap g` on the list field instead of leaving it.

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
    { $variant: { cases: [{ name: "DfBox", fields: [{ name: "_0", type: { $var: "a" } }] }] } },
    ["a"],
  );
  pushEntity(
    LABELLED,
    {
      $variant: {
        cases: [
          {
            name: "DfLabelled",
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
            name: "DfPair2",
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
          { name: "DfLeaf", fields: [] },
          {
            name: "DfNode",
            fields: [
              { name: "_0", type: { $var: "a" } },
              // Self-reference via the bare `{$ref:typeName}` handle — the
              // canonical recursive-ADT encoding `structuralView`/`marshalTraversalType`
              // detect (→ `TtNamed "DfTree"`); the fold recurses on it.
              { name: "_1", type: { $ref: "DfTree" } },
              { name: "_2", type: { $ref: "DfTree" } },
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
      // DfWrap a = DfWrap (List a) — the param under a DIFFERENT constructor.
      // `{$el:{call:["List", {$var:"a"}]}}` ⇒ `TtApp{args:[TtVar "a"]}` (head
      // dropped) — the one-level nested-functor shape fmap re-dispatches on.
      $variant: {
        cases: [
          {
            name: "DfWrap",
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
// (0) The always-on derived structural instance is registered + resolves.
// ===========================================================================

describe("the derived structural Functor instance", () => {
  test("is registered at boot as a `{$pattern}` ByPattern rule (not a nominal arg)", () => {
    const insts = dispatchRegistry.listInstances("Functor");
    const derived = insts.find(
      (i) =>
        i.args[0] &&
        typeof i.args[0] === "object" &&
        (i.args[0] as { $pattern?: unknown }).$pattern === "engine:isUnaryConstructor",
    );
    expect(derived).toBeDefined();
    expect(derived!.methods).toEqual({ fmap: "engine:deriveFmap" });
  });

  test("a unary constructor with NO nominal instance resolves the derived fmap fnId", () => {
    const r = resolveMethod("Functor", "fmap", [null, { $tag: "DfBox", _0: 5 }], ctx, dispatchRegistry);
    expect(r.$tag).toBe("Unique");
    if (r.$tag === "Unique") {
      expect(r.method).toBe("engine:deriveFmap");
      expect(r.key).toBe("DfBox");
    }
  });
});

// ===========================================================================
// (1) THE HEADLINE — derivation via a REAL `{method:…}` call (the fnId-string
//     dispatch-path lock: applyResolvedMethod → invokeFunction).
// ===========================================================================

describe("derived fmap maps a user `* -> *` ADT with NO per-type code", () => {
  test("`Functor.fmap (add 1) (DfBox 5)` ⟹ `DfBox 6` (element field)", () => {
    expect(ev("Functor.fmap (add 1) (DfBox 5)")).toEqual({ $tag: "DfBox", _0: 6 });
  });

  test("the fold preserves $tag + maps ONLY the functor param, LEAVES a non-param field", () => {
    // DfLabelled String a — `_0` is a fixed `String` (TtNamed "String", NOT the
    // param) ⇒ LEFT untouched; `_1` is the param `a` ⇒ mapped. THE structuralMap
    // repair: the legacy TS mapped EVERY non-recursive field — it would have
    // applied `add 1` to the "lbl" String. Classifying by FUNCTOR-PARAM IDENTITY
    // (D-6b-1) maps only `a`.
    expect(ev('Functor.fmap (add 1) (DfLabelled "lbl" 5)')).toEqual({
      $tag: "DfLabelled",
      _0: "lbl",
      _1: 6,
    });
  });

  test("self-recursive fields recurse: `fmap (add 1)` over a DfTree maps every leaf `a`", () => {
    // Nullary constructor ARGS are parenthesised — a bare uppercase ident in
    // argument position parses as a var-ref, not a nullary construct (the
    // `Cons (Just x) tail` paren convention extends to expression position).
    expect(ev("Functor.fmap (add 1) (DfNode 1 (DfNode 2 (DfLeaf) (DfLeaf)) (DfLeaf))")).toEqual({
      $tag: "DfNode",
      _0: 2,
      _1: { $tag: "DfNode", _0: 3, _1: { $tag: "DfLeaf" }, _2: { $tag: "DfLeaf" } },
      _2: { $tag: "DfLeaf" },
    });
  });

  test("a nullary case of a recursive type passes through unchanged", () => {
    expect(ev("Functor.fmap (add 1) (DfLeaf)")).toEqual({ $tag: "DfLeaf" });
  });

  test("kind-soundness: a BINARY constructor does NOT derive Functor (the unary bound)", () => {
    // DfPair2 e a is `* -> * -> *`; the derived instance is keyed by
    // `isUnaryConstructor`, so the bare `DfPair2` (arity 2) does NOT match. The
    // derivation respects the kind bound — Functor is `* -> *` only. (A real
    // binary-as-functor like `Result e` rides its NOMINAL instance, partial-app
    // aware; the bare-constructor dispatch key cannot express that — 5b#3.)
    const r = resolveMethod("Functor", "fmap", [null, { $tag: "DfPair2", _0: "e", _1: 5 }], ctx, dispatchRegistry);
    expect(r.$tag).toBe("None");
  });
});

// ===========================================================================
// (1b) NESTED FOREIGN FUNCTOR — D-6b-5 closed in 6c: a `List a` field inside
//      another functor maps its elements by re-dispatching `Functor.fmap`.
// ===========================================================================

describe("nested foreign functor (D-6b-5): a List/Maybe field maps its elements", () => {
  test("`fmap (add 1) (DfWrap [1,2,3])` maps the LIST elements (re-dispatch) ⟹ DfWrap [2,3,4]", () => {
    // `_0` is `List a` (TtApp carrying TtVar "a"). 6b LEFT it; 6c re-dispatches
    // `Functor.fmap g` on the field value → List's nominal `std:map` maps each.
    expect(ev("Functor.fmap (add 1) (DfWrap [1, 2, 3])")).toEqual({ $tag: "DfWrap", _0: [2, 3, 4] });
  });

  test("an empty nested functor field maps to itself", () => {
    expect(ev("Functor.fmap (add 1) (DfWrap [])")).toEqual({ $tag: "DfWrap", _0: [] });
  });
});

// ===========================================================================
// (2) NOMINAL PRECEDENCE — the authored Maybe/List/Result instances WIN; the
//     derived instance is the last-resort fall-through (D-6b-2).
// ===========================================================================

describe("nominal precedence: authored instances win over the derived fall-through", () => {
  test("`Just` resolves the AUTHORED `algebra:maybeFmap`, NOT `engine:deriveFmap`", () => {
    const r = resolveMethod("Functor", "fmap", [null, { $tag: "Just", _0: 3 }], ctx, dispatchRegistry);
    expect(r.$tag).toBe("Unique");
    if (r.$tag === "Unique") {
      expect(r.key).toBe("Maybe");
      expect(r.method).toEqual({ $ref: "algebra.maybeFmap" }); // the qualified reference (modules-as-values Phase 2b)
    }
  });

  test("an array resolves the AUTHORED List `std:map`, NOT `engine:deriveFmap`", () => {
    const r = resolveMethod("Functor", "fmap", [null, [1, 2, 3]], ctx, dispatchRegistry);
    expect(r.$tag).toBe("Unique");
    if (r.$tag === "Unique") {
      expect(r.key).toBe("List");
      expect(r.method).toEqual({ $ref: "std.map" }); // the qualified reference (modules-as-values Phase 2b)
    }
  });

  test("`Ok` resolves the AUTHORED `algebra:resultFmap`, NOT `engine:deriveFmap`", () => {
    const r = resolveMethod("Functor", "fmap", [null, { $tag: "Ok", _0: 3 }], ctx, dispatchRegistry);
    expect(r.$tag).toBe("Unique");
    if (r.$tag === "Unique") {
      expect(r.key).toBe("Result");
      expect(r.method).toEqual({ $ref: "algebra.resultFmap" }); // the qualified reference (modules-as-values Phase 2b)
    }
  });

  test("the authored instances still EVALUATE through their nominal bodies", () => {
    // Full end-to-end: nominal fmap bodies (algebra:* / std:map) run, NOT the fold.
    expect(ev("Functor.fmap (add 1) (Just 3)")).toEqual({ $tag: "Just", _0: 4 });
    expect(ev("Functor.fmap (add 1) [1, 2, 3]")).toEqual([2, 3, 4]);
    expect(ev("Functor.fmap (add 1) (Ok 3)")).toEqual({ $tag: "Ok", _0: 4 });
  });
});
