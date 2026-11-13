// Phase 5 of typeclass-substrate-completion — the PAYOFF conformance test.
//
// The canonical FP trinity — Functor / Monad / Monoid — lives ON THE MODEL:
// declared as ordinary Fenel record types (fenel/std/algebra.fenel + the
// dispatch-authoritative seeds in builtin-classes.ts), their Maybe / List /
// Result instances populated as ordinary Fenel-authored typed values
// (fenel/std/algebra-instances.fenel via engine/src/modules/algebra.ts), and
// `fmap` / `bind` (`>>=`) / `mappend` (`<>`) dispatching BY USE-SITE REFLECTION
// through the same general method-dispatch surface (Phase 3.5) every other
// typeclass / effect / capability uses — zero per-class TS logic.
//
// UNLIKE the Phase 3.5 oracle (which exercises the dispatch surface with
// synthetic fixtures on a fresh throwaway registry), this test runs against the
// REAL boot `dispatchRegistry` + the REAL evaluator (`getSystemEvaluateContext`),
// so a registration / load-order bug surfaces. The headline:
//
//   `Just 3 >>= (\x -> Just (add x 1))`  ⟹  `Just 4`
//
// dispatches `Monad.bind` to the Maybe instance purely by the value's runtime
// type — no `Monad` keyword, no per-class engine branch.
//
// Blocks: (a) classes registered in the boot registry + dispatch positions;
// (b) instances resolvable; (c) end-to-end dispatch over Maybe / List / Result
// via operators (`>>=` / `<>`) AND qualified methods (`Functor.fmap`);
// (d) the RETURN-POSITION boundary (`return` / `mempty`) pinned as
// None-with-reason (inference-owned, out of scope this phase).

import { describe, it, expect, beforeAll } from "bun:test";
import { parse } from "./fenel-parser";
import { evaluate } from "./json-logic";
import type { EvaluateContext } from "./json-logic";
import { dispatchRegistry } from "./system-entities";
import { getSystemEvaluateContext } from "./system-registry";
import { methodDispatchPosition, resolveMethod, RETURN_POSITION } from "./effect-dispatch";
import { GLOBAL_ONLY } from "./dispatch-registry";

let ctx: EvaluateContext;
beforeAll(() => {
  ctx = getSystemEvaluateContext();
});

const ev = (src: string) => evaluate(parse(src), {}, ctx);

// ---------------------------------------------------------------------------
// (a) The three classes are registered in the BOOT registry with the right
//     argument-position dispatch (fmap → arg 1, bind / mappend → arg 0) and
//     return-position for return / mempty.
// ---------------------------------------------------------------------------

describe("Phase 5 (a) — Functor / Monad / Monoid are real boot-registry classes", () => {
  it("getClass resolves all three in the boot dispatchRegistry", () => {
    expect(dispatchRegistry.getClass("Functor")).toBeDefined();
    expect(dispatchRegistry.getClass("Monad")).toBeDefined();
    expect(dispatchRegistry.getClass("Monoid")).toBeDefined();
  });

  it("argument-position methods derive the right dispatch position", () => {
    // `fmap : (a -> b) -> f a -> f b` — the arrow is arg 0, `f a` is arg 1.
    expect(methodDispatchPosition(dispatchRegistry, "Functor", "fmap")).toBe(1);
    // `bind : m a -> … ` and `mappend : a -> a -> a` dispatch on arg 0.
    expect(methodDispatchPosition(dispatchRegistry, "Monad", "bind")).toBe(0);
    expect(methodDispatchPosition(dispatchRegistry, "Monoid", "mappend")).toBe(0);
  });

  it("return / mempty are return-position (the class param heads no argument)", () => {
    expect(methodDispatchPosition(dispatchRegistry, "Monad", "return")).toBe(RETURN_POSITION);
    expect(methodDispatchPosition(dispatchRegistry, "Monoid", "mempty")).toBe(RETURN_POSITION);
  });
});

// ---------------------------------------------------------------------------
// (b) The Maybe / List / Result instances are Fenel-authored typed values
//     resolvable via the type-indexed query.
// ---------------------------------------------------------------------------

describe("Phase 5 (b) — the Maybe / List / Result instances are populated", () => {
  // modules-as-values Phase 2b: the method values are qualified references to
  // the same functions the HEAD id strings named (`algebra:maybeFmap`, …).
  it("Functor instances resolve their fmap method (Maybe / List / Result)", () => {
    expect(dispatchRegistry.resolve("Maybe", "Functor", GLOBAL_ONLY)).toEqual({ fmap: { $ref: "algebra.maybeFmap" } });
    expect(dispatchRegistry.resolve("List", "Functor", GLOBAL_ONLY)).toEqual({ fmap: { $ref: "std.map" } });
    expect(dispatchRegistry.resolve("Result", "Functor", GLOBAL_ONLY)).toEqual({ fmap: { $ref: "algebra.resultFmap" } });
  });

  it("Monad instances resolve bind (return is a return-position class field, no instance method)", () => {
    expect(dispatchRegistry.resolve("Maybe", "Monad", GLOBAL_ONLY)).toMatchObject({ bind: { $ref: "algebra.maybeBind" } });
    expect(dispatchRegistry.resolve("List", "Monad", GLOBAL_ONLY)).toMatchObject({ bind: { $ref: "algebra.listBind" } });
    expect(dispatchRegistry.resolve("Result", "Monad", GLOBAL_ONLY)).toMatchObject({ bind: { $ref: "algebra.resultBind" } });
  });

  it("Monoid instances resolve mappend (List / String) + carry the mempty constant", () => {
    expect(dispatchRegistry.resolve("List", "Monoid", GLOBAL_ONLY)).toMatchObject({ mappend: { $ref: "std.concat" }, mempty: [] });
    expect(dispatchRegistry.resolve("String", "Monoid", GLOBAL_ONLY)).toMatchObject({ mappend: { $ref: "std.concat" }, mempty: "" });
  });

  it("satisfies agrees with the reflected type-constructor keys", () => {
    expect(dispatchRegistry.satisfies("Maybe", "Monad", GLOBAL_ONLY)).toBe(true);
    expect(dispatchRegistry.satisfies("List", "Monoid", GLOBAL_ONLY)).toBe(true);
    expect(dispatchRegistry.satisfies("Result", "Functor", GLOBAL_ONLY)).toBe(true);
    // No Monoid instance for Maybe — the absence is observable, not a crash.
    expect(dispatchRegistry.satisfies("Maybe", "Monoid", GLOBAL_ONLY)).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// (c) END-TO-END — `.fenel` expressions evaluate correctly through the REAL
//     evaluator + boot registry, dispatching by use-site reflection.
// ---------------------------------------------------------------------------

describe("Phase 5 (c) — Monad bind (`>>=`) dispatches by the value's runtime type", () => {
  it("THE HEADLINE: `Just 3 >>= (\\x -> Just (add x 1))` ⟹ `Just 4`", () => {
    expect(ev("Just 3 >>= (\\x -> Just (add x 1))")).toEqual({ $tag: "Just", _0: 4 });
  });

  it("`Nothing >>= (\\x -> Just x)` short-circuits ⟹ `Nothing`", () => {
    expect(ev("Nothing >>= (\\x -> Just x)")).toEqual({ $tag: "Nothing" });
  });

  it("List bind: `[1, 2] >>= (\\x -> [x, x])` ⟹ `[1, 1, 2, 2]` (a different instance, same surface)", () => {
    expect(ev("[1, 2] >>= (\\x -> [x, x])")).toEqual([1, 1, 2, 2]);
  });

  it("Result bind: `Ok 3 >>= (\\x -> Ok (add x 1))` ⟹ `Ok 4`; `Err` passes through", () => {
    expect(ev("Ok 3 >>= (\\x -> Ok (add x 1))")).toEqual({ $tag: "Ok", _0: 4 });
    expect(ev("Err \"boom\" >>= (\\x -> Ok x)")).toEqual({ $tag: "Err", _0: "boom" });
  });
});

describe("Phase 5 (c) — Functor fmap dispatches by the value's runtime type", () => {
  it("`Functor.fmap (add 1) (Just 3)` ⟹ `Just 4`", () => {
    expect(ev("Functor.fmap (add 1) (Just 3)")).toEqual({ $tag: "Just", _0: 4 });
  });

  it("`Functor.fmap (add 1) [1, 2, 3]` ⟹ `[2, 3, 4]` (the List instance)", () => {
    expect(ev("Functor.fmap (add 1) [1, 2, 3]")).toEqual([2, 3, 4]);
  });

  it("`Functor.fmap (add 1) (Ok 3)` ⟹ `Ok 4` (the Result instance)", () => {
    expect(ev("Functor.fmap (add 1) (Ok 3)")).toEqual({ $tag: "Ok", _0: 4 });
  });
});

describe("Phase 5 (c) — Monoid mappend (`<>`) dispatches by the value's runtime type", () => {
  it("List Monoid: `[1, 2] <> [3]` ⟹ `[1, 2, 3]`", () => {
    expect(ev("[1, 2] <> [3]")).toEqual([1, 2, 3]);
  });

  it("String Monoid: `\"ab\" <> \"c\"` ⟹ `\"abc\"` (a second instance, same surface)", () => {
    expect(ev("\"ab\" <> \"c\"")).toBe("abc");
  });

  it("the operator and the qualified method are the same dispatch", () => {
    expect(ev("Monoid.mappend [1, 2] [3]")).toEqual([1, 2, 3]);
    expect(ev("Monad.bind (Just 3) (\\x -> Just (add x 1))")).toEqual({ $tag: "Just", _0: 4 });
  });
});

// ---------------------------------------------------------------------------
// (d) RETURN-POSITION boundary — `return` / `mempty` head no argument, so
//     there is nothing to reflect on. Resolution surfaces None-with-reason
//     (witness elaboration is inference-owned). DOCUMENTED, not implemented.
// ---------------------------------------------------------------------------

describe("Phase 5 (d) — return-position (`return` / `mempty`) is None-with-reason (inference-owned)", () => {
  it("`Monad.return` resolves to None carrying the documented reason", () => {
    const r = resolveMethod("Monad", "return", [42], ctx, dispatchRegistry);
    expect(r.$tag).toBe("None");
    if (r.$tag === "None") {
      expect(r.reason).toContain("return-position");
      expect(r.reason).toContain("inference workstream");
    }
  });

  it("`Monoid.mempty` resolves to None carrying the documented reason", () => {
    const r = resolveMethod("Monoid", "mempty", [], ctx, dispatchRegistry);
    expect(r.$tag).toBe("None");
    if (r.$tag === "None") {
      expect(r.reason).toContain("return-position");
      expect(r.reason).toContain("inference workstream");
    }
  });

  it("evaluating a return-position call throws a clear unresolved error (not a silent mis-dispatch)", () => {
    // Applied (1 arg) so dispatch actually fires — a bare `Monad.return`
    // eta-expands to a closure instead. The class param `m` heads no argument,
    // so resolution is None and the evaluator surfaces a clear error.
    expect(() => ev("Monad.return 5")).toThrow(/return-position|unresolved/);
  });
});
