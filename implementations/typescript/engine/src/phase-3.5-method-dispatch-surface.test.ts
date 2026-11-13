// Phase 3.5 of typeclass-substrate-completion — conformance tests for the
// method-dispatch SURFACE: the model's core. A qualified method reference
// (`Monad.bind`) resolves its instance by use-site reflection on the runtime
// type of the dispatch argument, projects the method field, and applies —
// CLOS / Julia generic-function dispatch, no dictionary threading. Operators
// (`>>=`, `<>`) are Infixable notation over a qualified method.
//
// The instance corpus is fully Fenel-authored (Phases 3 → 3.2b). This phase
// builds the resolution surface ON TOP of the existing projected-`Instance`
// cache index (Decision #2 — Phase 4 swaps the index underneath without
// changing this surface). The five steps (design/unified-dispatch.md):
//   1. Parse `Class.method` to a qualified-method-ref node, distinct from a
//      constructor application and from `record.field` value access.
//   2. Derive the dispatch arg position from the class's method signature.
//   3. Resolve the `Class <key>` instance in scope (block → tag → global).
//   4. Project the method field.
//   5. Apply to the args.
//
// Blocks: (a) parser node vs construct vs field-access + round-trip;
// (b) dispatch-key derivation (arg-0 / arg-1 / return-position-none);
// (c) end-to-end resolution — ≥2 instances at different types pick different
// methods (the reflection / multiple-dispatch proof); (d) operator `>>=` /
// `<>` ≡ qualified method; (e) block-scope override shadows global;
// (f) Conflict / None / return-position-needs-witness surface as VALUES.
//
// Minimal fixture (Decision #8 — NOT the Functor/Monad/Monoid demo, which is
// Phase 5): a `Monoid a` (1 method `mappend`, arg-0 dispatch, List + String
// instances + an Infixable `<>`) carries the end-to-end apply / multiple-
// dispatch / block-override / operator proof; a `Monad m` (`bind`, arg-0,
// Maybe + List, Infixable `>>=`) carries the canonical-example parse + the
// reflection-over-constructed-values proof; a `Pointed m` (`pure : a -> m a`)
// carries the return-position case. Fixture classes are test-only (registered
// via `dispatchRegistry.defineClass`, NOT system entities) → audit delta-neutral.

import { describe, it, expect, beforeAll } from "bun:test";
import { parse } from "./fenel-parser";
import { print } from "./engine-bodies-dispatch";
import { evaluate, withInstance } from "./json-logic";
import type { EvaluateContext, TypeclassDictFrame } from "./json-logic";
import { createDispatchRegistry } from "./dispatch-registry";
import { getSystemEvaluateContext } from "./system-registry";
import {
  dispatchPositionForSeed,
  methodDispatchPosition,
  typeConstructorOf,
  resolveMethod,
  RETURN_POSITION,
} from "./effect-dispatch";
import { Nothing } from "./type-foundation";
import type { FenelType, FieldDef, Interface, Instance } from "./types";
import { GLOBAL_ONLY } from "./dispatch-registry";

// The two qualified-method operator Infixable instances (`>>=` → Monad.bind,
// `<>` → Monoid.mappend). typed-function-references Phase 12 moved the live
// instances to `fenel/std/parser-fixities.fenel`; this fresh throwaway registry
// seeds them as inline literals (byte-identical to the projection) so the
// introspection assertion below keeps passing in isolation.
const bindInfixable: Instance = {
  typeName: "Infixable",
  args: ["Monad.bind"],
  methods: { notation: ">>=", precedence: 1, associativity: "left" },
};
const mappendInfixable: Instance = {
  typeName: "Infixable",
  args: ["Monoid.mappend"],
  methods: { notation: "<>", precedence: 6, associativity: "right" },
};

const MONOID_LIST_MAPPEND = "test:phase35MonoidListMappend";
const MONOID_STRING_MAPPEND = "test:phase35MonoidStringMappend";
const MONAD_MAYBE_BIND = "test:phase35MonadMaybeBind";
const MONAD_LIST_BIND = "test:phase35MonadListBind";
const MONOID_LIST_OVERRIDE = "test:phase35MonoidListOverride";

// ---------------------------------------------------------------------------
// Fixtures — test-only classes + instances on a FRESH THROWAWAY registry.
//
// Phase 5 of typeclass-substrate-completion registered the REAL Functor /
// Monad / Monoid classes + Maybe/List/Result instances into the boot
// `dispatchRegistry`. This oracle's synthetic `Monoid` / `Monad` fixtures reuse
// those exact names + keys (Monoid List/String, Monad Maybe/List) with
// DIFFERENT semantics (e.g. `bind` returns a `BoundBy…` marker, not a real
// monadic bind). Sharing the boot registry would make those keys ambiguous
// (two tied instances → Conflict) and dispatch the wrong method. So the
// fixtures live on a fresh `createDispatchRegistry()` (which is exactly how
// the Phase 5 brief — § "Why this phase exists" + watch-out #5 — describes
// this oracle: "synthetic … on a fresh throwaway registry"). The evaluation
// `ctx` overrides only `_specRegistry` to this fresh registry; `_caseOwner` /
// `_constructors` stay the boot ones so reflection (`{$tag:"Just"}` → "Maybe")
// and `construct` keep working. Every assertion + expected value is unchanged
// — only the registry the synthetic fixtures live on is isolated.
// ---------------------------------------------------------------------------

const dispatchRegistry = createDispatchRegistry();

// A full FieldDef param (the canonical-maybe absence-markers fill the
// mandatory label/ui/meta/default slots — the dispatch derivation only reads
// `.type`, but the type wants the whole shape).
const fp = (name: string, type: FenelType): FieldDef => ({
  name,
  type,
  label: Nothing,
  ui: Nothing,
  meta: {},
});

// Monoid a — single method `mappend : a -> a -> a` (class param `a` heads
// arg 0 → dispatch on arg 0). List + String instances with REAL semantics, so
// the apply step is observable and the two instances are distinguishable.
const monoidSeed: Interface = {
  name: "Monoid",
  params: [{ name: "a" }],
  methods: [
    {
      name: "mappend",
      params: [fp("_0", { $var: "a" }), fp("_1", { $var: "a" })],
      returns: { $var: "a" },
    },
  ],
};

// Monad m — `bind : m a -> (a -> m b) -> m b` (class param `m` heads arg 0).
// Methods are dispatch-proving markers (the Functor/Monad LAWS are Phase 5);
// here we only prove WHICH instance's method ran under reflection.
const monadSeed: Interface = {
  name: "Monad",
  params: [{ name: "m" }],
  methods: [
    {
      name: "bind",
      params: [
        fp("_0", { $el: { call: [{ $var: "m" }, { $var: "a" }] } }),
        fp("_1", { $arrow: { params: [], returns: { $var: "a" } } }),
      ],
      returns: { $el: { call: [{ $var: "m" }, { $var: "b" }] } },
    },
  ],
};

// Pointed m — `pure : a -> m a`. The class param `m` is in the RETURN type
// only → return-position dispatch (Decision #1, out of scope this phase).
const pointedSeed: Interface = {
  name: "Pointed",
  params: [{ name: "m" }],
  methods: [
    {
      name: "pure",
      params: [fp("_0", { $var: "a" })],
      returns: { $el: { call: [{ $var: "m" }, { $var: "a" }] } },
    },
  ],
};

// Functor f — `fmap : (a -> b) -> f a -> f b`. Class param `f` heads arg 1
// (the arrow is arg 0) → dispatch on arg 1. Synthetic (derivation unit test).
const functorSeed: Interface = {
  name: "Functor",
  params: [{ name: "f" }],
  methods: [
    {
      name: "fmap",
      params: [
        fp("_0", { $arrow: { params: [], returns: { $var: "b" } } }),
        fp("_1", { $el: { call: [{ $var: "f" }, { $var: "a" }] } }),
      ],
      returns: { $el: { call: [{ $var: "f" }, { $var: "b" }] } },
    },
  ],
};

let ctx: EvaluateContext;

// type-substrate P1(a.18) — EXPLICIT HOOK TIMEOUT, and it is not a mask.
// `getSystemEvaluateContext()` below pays this process's COLD ENGINE BOOT, which
// on the Windows box takes ~220 s — far over bun's 5000 ms DEFAULT, which this
// hook never overrode, so the whole file reported one unnamed failure with no
// assertion ever evaluated. MEASURED at clean HEAD (218.8 s) and with P1(a.18)
// applied (227.8 s / 238.7 s): identical failure both ways, so the budget was
// wrong, not the behaviour.
beforeAll(() => {
  // Boot ctx for reflection (_caseOwner) + construction (_constructors), but
  // dispatch resolves against the isolated fresh `dispatchRegistry` (see fixtures
  // note above) so the synthetic fixtures don't collide with Phase 5's real
  // boot Functor/Monad/Monoid instances.
  const baseCtx = getSystemEvaluateContext();
  ctx = {
    ...baseCtx,
    _specRegistry: dispatchRegistry,
    // This fixture owns a fresh dispatch registry, so it must not retain the
    // boot registry's compiled routing-table projection.
    _routingTable: undefined,
    _routingTableVersion: undefined,
    natives: {
      ...(baseCtx.natives ?? {}),
      [MONOID_LIST_MAPPEND]: (...args: unknown[]) => [
        ...(args[0] as unknown[]),
        ...(args[1] as unknown[]),
      ],
      [MONOID_STRING_MAPPEND]: (...args: unknown[]) =>
        `${String(args[0])}${String(args[1])}`,
      [MONAD_MAYBE_BIND]: (...args: unknown[]) => ({
        $tag: "BoundByMaybe",
        _0: args[0],
      }),
      [MONAD_LIST_BIND]: (...args: unknown[]) => ({
        $tag: "BoundByList",
        _0: args[0],
      }),
      [MONOID_LIST_OVERRIDE]: () => "OVERRIDDEN",
    },
  };

  // Seed the operator-notation Infixable instances the introspection test (d)
  // reads (`>>=` → Monad.bind, `<>` → Monoid.mappend) — the boot registry
  // carries these via parser-fixities; the isolated fresh registry seeds them
  // explicitly so the `listInstances("Infixable")` assertion keeps passing.
  dispatchRegistry.addInstance(bindInfixable);
  dispatchRegistry.addInstance(mappendInfixable);

  dispatchRegistry.defineClass(monoidSeed);
  dispatchRegistry.addInstance({
    typeName: "Monoid",
    args: ["List"],
    methods: { mappend: MONOID_LIST_MAPPEND },
  });
  dispatchRegistry.addInstance({
    typeName: "Monoid",
    args: ["String"],
    methods: { mappend: MONOID_STRING_MAPPEND },
  });

  dispatchRegistry.defineClass(monadSeed);
  dispatchRegistry.addInstance({
    typeName: "Monad",
    args: ["Maybe"],
    methods: { bind: MONAD_MAYBE_BIND },
  });
  dispatchRegistry.addInstance({
    typeName: "Monad",
    args: ["List"],
    methods: { bind: MONAD_LIST_BIND },
  });

  dispatchRegistry.defineClass(pointedSeed);
}, 600_000);

// ---------------------------------------------------------------------------
// (a) Parser — qualified-method-ref node vs construct vs field-access.
// ---------------------------------------------------------------------------

describe("Phase 3.5 (a) — parser recognises the qualified-method-ref node", () => {
  it("`Class.method args` parses to {method: [cls, method, ...args]} — the canonical example", () => {
    expect(parse("Monad.bind x f")).toEqual({
      method: ["Monad", "bind", { var: "x" }, { var: "f" }],
    });
  });

  it("a bare `Class.method` (no args) parses to {method: [cls, method]} — a first-class value", () => {
    expect(parse("Monad.bind")).toEqual({ method: ["Monad", "bind"] });
  });

  it("does NOT regress value field-access (lowercase head stays {var})", () => {
    expect(parse("record.field")).toEqual({ var: "record.field" });
    expect(parse("bot.token")).toEqual({ var: "bot.token" });
  });

  it("does NOT regress constructor application (bare uppercase head, no dot)", () => {
    expect(parse("Bot { x = 1 }")).toEqual({ construct: ["Bot", { x: 1 }] });
    expect(parse("Bot")).toEqual({ construct: ["Bot"] });
    expect(parse("Just 3")).toEqual({ construct: ["Just", 3] });
  });

  it("edge cases: uppercase method segment + multi-dot chains are NOT qualified methods", () => {
    // modules-as-values Phase 5c-1a: neither is a constructor either (a
    // constructor name has no dot) — both are dotted paths, read like
    // `codec.isoBase64` (they used to become `{construct: ["Foo.Bar"]}`, a
    // bogus `{$tag: "Foo.Bar"}` at run time).
    // `Foo.Bar` — uppercase method → not a method ref; a dotted path.
    expect(parse("Foo.Bar")).toEqual({ var: "Foo.Bar" });
    // `A.b.c` — two dots → not a simple qualified method; a dotted path.
    expect(parse("A.b.c")).toEqual({ var: "A.b.c" });
    // In argument position a qualified method is the bare method node.
    expect(parse("id Monad.bind")).toEqual({ call: ["id", { method: ["Monad", "bind"] }] });
  });

  it("round-trips through the printer: method node prints `Class.method args` and re-parses identically", () => {
    for (const src of ["Monad.bind x f", "Monad.bind", "Monoid.mappend a b"]) {
      const ast = parse(src);
      expect(parse(print(ast))).toEqual(ast);
    }
    expect(print(parse("Monad.bind x f"))).toBe("Monad.bind x f");
    expect(print(parse("Monad.bind"))).toBe("Monad.bind");
  });
});

// ---------------------------------------------------------------------------
// (b) Dispatch-key derivation — arg-0 / arg-1 / return-position-none.
// ---------------------------------------------------------------------------

describe("Phase 3.5 (b) — dispatch position derived from the class method signature", () => {
  it("arg-0 dispatch: `bind : m a -> …` and `mappend : a -> a -> a` dispatch on arg 0", () => {
    expect(dispatchPositionForSeed(monadSeed, "bind")).toBe(0);
    expect(dispatchPositionForSeed(monoidSeed, "mappend")).toBe(0);
  });

  it("arg-1 dispatch: `fmap : (a -> b) -> f a -> f b` dispatches on arg 1 (the arrow is arg 0)", () => {
    expect(dispatchPositionForSeed(functorSeed, "fmap")).toBe(1);
  });

  it("return-position: `pure : a -> m a` has the class param in no argument → RETURN_POSITION", () => {
    expect(dispatchPositionForSeed(pointedSeed, "pure")).toBe(RETURN_POSITION);
  });

  it("the registry-backed lookup agrees + memoises (same value across calls)", () => {
    expect(methodDispatchPosition(dispatchRegistry, "Monad", "bind")).toBe(0);
    expect(methodDispatchPosition(dispatchRegistry, "Monad", "bind")).toBe(0);
    expect(methodDispatchPosition(dispatchRegistry, "Monoid", "mappend")).toBe(0);
    expect(methodDispatchPosition(dispatchRegistry, "Pointed", "pure")).toBe(RETURN_POSITION);
  });
});

// ---------------------------------------------------------------------------
// (c) Reflection + end-to-end resolution — the multiple-dispatch proof.
// ---------------------------------------------------------------------------

describe("Phase 3.5 (c) — reflection agrees with the registry matcher", () => {
  it("a constructed value reflects to its owning type-constructor; opaque atoms by JS shape", () => {
    expect(typeConstructorOf({ $tag: "Just", value: 3 }, ctx)).toBe("Maybe");
    expect(typeConstructorOf({ $tag: "Nothing" }, ctx)).toBe("Maybe");
    expect(typeConstructorOf({ $tag: "Ok", value: 1 }, ctx)).toBe("Result");
    expect(typeConstructorOf([1, 2, 3], ctx)).toBe("List");
    expect(typeConstructorOf("hi", ctx)).toBe("String");
    expect(typeConstructorOf(42, ctx)).toBe("Number");
    expect(typeConstructorOf(true, ctx)).toBe("Boolean");
  });

  it("the reflected key is exactly the key the registry indexes instances under (no silent miss)", () => {
    // Watch-out #2: reflection MUST agree with the matcher. `{$tag:"Just"}`
    // reflects to "Maybe", and the registry resolves a Monad instance for "Maybe".
    const key = typeConstructorOf({ $tag: "Just", value: 3 }, ctx)!;
    expect(dispatchRegistry.satisfies(key, "Monad", GLOBAL_ONLY)).toBe(true);
    const listKey = typeConstructorOf([1, 2], ctx)!;
    expect(dispatchRegistry.satisfies(listKey, "Monoid", GLOBAL_ONLY)).toBe(true);
  });
});

describe("Phase 3.5 (c) — end-to-end: reflect → resolve → project → apply", () => {
  it("≥2 instances at different types pick DIFFERENT methods (the reflection / multiple-dispatch win)", () => {
    // Monoid.mappend dispatches on arg 0's runtime type: a List value selects
    // the List instance (concat), a String value selects the String instance.
    expect(evaluate(parse("Monoid.mappend xs ys"), { xs: [1, 2], ys: [3, 4] }, ctx)).toEqual([1, 2, 3, 4]);
    expect(evaluate(parse("Monoid.mappend a b"), { a: "ab", b: "cd" }, ctx)).toBe("abcd");
  });

  it("Monad.bind dispatches on arg 0's constructor type (Maybe vs List → different methods)", () => {
    expect(evaluate(parse("Monad.bind m f"), { m: { $tag: "Just", value: 3 }, f: 0 }, ctx)).toEqual({
      $tag: "BoundByMaybe",
      _0: { $tag: "Just", value: 3 },
    });
    expect(evaluate(parse("Monad.bind m f"), { m: [1, 2], f: 0 }, ctx)).toEqual({
      $tag: "BoundByList",
      _0: [1, 2],
    });
  });

  it("resolveMethod returns Unique with the projected method + reflected key + dispatch source", () => {
    const r = resolveMethod("Monoid", "mappend", [[1], [2]], ctx, dispatchRegistry);
    expect(r.$tag).toBe("Unique");
    if (r.$tag === "Unique") {
      expect(r.key).toBe("List");
      expect(r.dispatchPos).toBe(0);
      expect(r.source).toBe("instance");
      expect(r.method).toBe(MONOID_LIST_MAPPEND);
    }
  });
});

// ---------------------------------------------------------------------------
// (d) Operators — Infixable notation over a qualified method.
// ---------------------------------------------------------------------------

describe("Phase 3.5 (d) — operators are Infixable over a qualified method", () => {
  it("`a >>= f` parses to the SAME node as `Monad.bind a f` (operator ≡ qualified method)", () => {
    expect(parse("x >>= f")).toEqual(parse("Monad.bind x f"));
    expect(parse("x >>= f")).toEqual({ method: ["Monad", "bind", { var: "x" }, { var: "f" }] });
  });

  it("`a <> b` parses to `Monoid.mappend a b` (the second qualified-method operator)", () => {
    expect(parse("a <> b")).toEqual(parse("Monoid.mappend a b"));
    expect(parse("a <> b")).toEqual({ method: ["Monoid", "mappend", { var: "a" }, { var: "b" }] });
  });

  it("the operator evaluates end-to-end through the SAME dispatch pipeline", () => {
    expect(evaluate(parse("xs <> ys"), { xs: [1, 2], ys: [3, 4] }, ctx)).toEqual([1, 2, 3, 4]);
    expect(evaluate(parse("a <> b"), { a: "x", b: "y" }, ctx)).toBe("xy");
    expect(evaluate(parse("m >>= f"), { m: { $tag: "Just", value: 9 }, f: 0 }, ctx)).toEqual({
      $tag: "BoundByMaybe",
      _0: { $tag: "Just", value: 9 },
    });
  });

  it("the operators are registered Infixable instances (introspection parity with `+`)", () => {
    const notations = new Set(dispatchRegistry.listInstances("Infixable").map((i) => i.methods?.notation));
    expect(notations.has(">>=")).toBe(true);
    expect(notations.has("<>")).toBe(true);
    // ...and their target is the qualified method, not a plain fnId.
    const bind = dispatchRegistry.listInstances("Infixable").find((i) => i.methods?.notation === ">>=");
    expect(bind?.args[0]).toBe("Monad.bind");
  });

  it("the printer renders the CANONICAL qualified form (operators are parse-only sugar)", () => {
    // Like `&&`/`||`, `>>=`/`<>` print back as the canonical method form.
    expect(print(parse("x >>= f"))).toBe("Monad.bind x f");
    expect(print(parse("a <> b"))).toBe("Monoid.mappend a b");
  });
});

// ---------------------------------------------------------------------------
// (e) Scope — a block-scope instance shadows the global one.
// ---------------------------------------------------------------------------

describe("Phase 3.5 (e) — block-scope instance overrides global (the override story)", () => {
  const overrideFrame: TypeclassDictFrame = {
    typeName: "Monoid",
    args: ["List"],
    methods: { mappend: MONOID_LIST_OVERRIDE },
  };

  it("a block frame for (Monoid, List) wins over the global List instance", () => {
    const result = withInstance(ctx, overrideFrame, (inner) =>
      evaluate(parse("Monoid.mappend xs ys"), { xs: [1, 2], ys: [3, 4] }, inner),
    );
    expect(result).toBe("OVERRIDDEN");
  });

  it("resolveMethod reports the block source for the overridden key", () => {
    const r = withInstance(ctx, overrideFrame, (inner) =>
      resolveMethod("Monoid", "mappend", [[1], [2]], inner, dispatchRegistry),
    );
    expect(r.$tag).toBe("Unique");
    if (r.$tag === "Unique") expect(r.source).toBe("block");
  });

  it("falls back to the global instance OUTSIDE the block", () => {
    expect(evaluate(parse("Monoid.mappend xs ys"), { xs: [1, 2], ys: [3, 4] }, ctx)).toEqual([1, 2, 3, 4]);
  });

  it("the block frame does NOT shadow a DIFFERENT key (String still resolves globally)", () => {
    const result = withInstance(ctx, overrideFrame, (inner) =>
      evaluate(parse("Monoid.mappend a b"), { a: "p", b: "q" }, inner),
    );
    expect(result).toBe("pq");
  });
});

// ---------------------------------------------------------------------------
// (f) LookupResult — Conflict / None / return-position surface as VALUES.
// ---------------------------------------------------------------------------

describe("Phase 3.5 (f) — ambiguity + absence + return-position are values, not crashes", () => {
  it("None: no instance for the reflected type → None with a reason", () => {
    const r = resolveMethod("Monoid", "mappend", [{ $tag: "Just", value: 1 }], ctx, dispatchRegistry);
    expect(r.$tag).toBe("None");
    if (r.$tag === "None") expect(r.reason).toContain("no Monoid instance");
  });

  it("return-position: a method whose class param is in no argument → None (needs witness)", () => {
    const r = resolveMethod("Pointed", "pure", [42], ctx, dispatchRegistry);
    expect(r.$tag).toBe("None");
    if (r.$tag === "None") {
      expect(r.reason).toContain("return-position");
      expect(r.reason).toContain("inference workstream");
    }
  });

  it("Conflict: ≥2 same-priority instances for the same key → Conflict carrying the candidates", () => {
    // Register a SECOND Monad instance for Maybe at the same (default) priority.
    dispatchRegistry.defineClass({
      name: "ConflictMonad",
      params: [{ name: "m" }],
      methods: monadSeed.methods,
    });
    dispatchRegistry.addInstance({
      typeName: "ConflictMonad",
      args: ["Maybe"],
      methods: { bind: "test:phase35ConflictBindA" },
    });
    dispatchRegistry.addInstance({
      typeName: "ConflictMonad",
      args: ["Maybe"],
      methods: { bind: "test:phase35ConflictBindB" },
    });
    const r = resolveMethod("ConflictMonad", "bind", [{ $tag: "Just", value: 1 }], ctx, dispatchRegistry);
    expect(r.$tag).toBe("Conflict");
    if (r.$tag === "Conflict") {
      expect(r.key).toBe("Maybe");
      expect(r.candidates).toHaveLength(2);
    }
  });

  it("the evaluator throws a clear error on an unresolved qualified-method call (real call site)", () => {
    expect(() => evaluate(parse("Monoid.mappend m n"), { m: { $tag: "Just", value: 1 }, n: 2 }, ctx)).toThrow(
      /unresolved Monoid\.mappend/,
    );
  });

  it("the evaluator throws a clear error on an ambiguous dispatch", () => {
    expect(() =>
      evaluate(parse("ConflictMonad.bind m f"), { m: { $tag: "Just", value: 1 }, f: 0 }, ctx),
    ).toThrow(/ambiguous ConflictMonad\.bind/);
  });
});
