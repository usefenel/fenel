// ---------------------------------------------------------------------------
// Evaluator dispatch — Phase 11 per-scope strategy selection
//
// Phase 6 added the `Evaluator strategy` typeclass + four instances (Eager /
// Lazy / Partial / Jit). Phase 11 makes them the *primary* surface: every
// engine + runtime call site that used to import `evaluate` directly now
// routes through `resolveEvaluator(ctx)`, which walks the dispatch
// precedence (block-scope `_dictStack` → tag-scope `_activeTags` → global)
// and returns the in-scope strategy as a `(rule, data, ctx) => unknown`
// callable.
//
// This file exercises:
//   1. Fallback — when no Evaluator frame is in scope, the resolver returns
//      `evaluate` directly (zero-overhead identity). Existing call sites
//      see byte-identical behavior.
//   2. Block scope — `withInstance` pushes a LazyStrategy frame; inner code
//      evaluates lazily (unused argument with side-effect is NOT forced)
//      while outer code stays eager.
//   3. Tag scope — when a non-eager Evaluator instance is wired through the
//      block stack with a tag-scope marker, the resolver picks it up only
//      when the matching tag is active.
//   4. Precedence — innermost frame wins (block-tag-global discipline).
//   5. Algebraic-effect discipline — the matched frame is stripped before
//      the strategy is invoked, so a strategy's body re-resolving sees the
//      OUTER scope (no infinite self-recursion).
//   6. Data threading — `_localData` flows through eager + lazy strategies
//      so `{var: "x"}` inside a `lazy { ... }` block resolves against the
//      caller's bindings.
//   7. Parser surface — `lazy { ... }` / `eager { ... }` / `partial { ... }`
//      / `jit { ... }` block forms parse to the expected `withInstance`
//      shape and dispatch correctly end-to-end.
// ---------------------------------------------------------------------------

import { describe, it, expect } from "vitest";
import { evaluate, withInstance, type EvaluateContext, type TypeclassDictFrame } from "./json-logic";
import {
  resolveEvaluator,
  EAGER_STRATEGY,
  LAZY_STRATEGY,
  PARTIAL_STRATEGY,
  JIT_STRATEGY,
} from "./evaluator-class";
import { evaluatorNatives, evaluatorStrategiesModule } from "./modules/evaluator-strategies";
import { rekeyNativesById } from "./function-builder";
import { parse } from "./fenel-parser";
import type { FenelFunction, FunctionBody } from "./types";
import { Nothing } from "./type-foundation";
// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Build an EvaluateContext wired with the evaluator-strategies natives
 *  table — what the engine's createRegistry would give every consumer. */
function ctxWithStrategies(extra?: Partial<EvaluateContext>): EvaluateContext {
  return {
    natives: rekeyNativesById(evaluatorNatives, "evaluator-strategies"),
    ...extra,
  };
}

/** Push an Evaluator instance frame on the dictStack. Strategy markers are
 *  the same constants the typeclass instances declare. */
function frameFor(strategy: string): TypeclassDictFrame {
  const evalFnId = `evaluator-strategies:${
    strategy === EAGER_STRATEGY
      ? "eagerEval"
      : strategy === LAZY_STRATEGY
        ? "lazyEval"
        : strategy === PARTIAL_STRATEGY
          ? "partialEval"
          : "jitEval"
  }`;
  return {
    typeName: "Evaluator",
    args: [strategy],
    methods: { eval: evalFnId },
  };
}

function userFn(id: string, paramNames: string[], body: FunctionBody): FenelFunction {
  return {
    id,
    params: paramNames.map((n) => ({ name: n, label: Nothing, type: { $ref: "Any" }, meta: {}, ui: Nothing })),
    returns: { $ref: "Any" },
    body,
  };
}

// ---------------------------------------------------------------------------
// 1. Fallback — no Evaluator frame ⇒ resolver returns the legacy evaluate
// ---------------------------------------------------------------------------

describe("resolveEvaluator — fallback path (no frame in scope)", () => {
  it("returns the legacy `evaluate` function directly when ctx is empty", () => {
    const fn = resolveEvaluator();
    expect(fn).toBe(evaluate);
  });

  it("returns evaluate when ctx has no _dictStack", () => {
    const fn = resolveEvaluator({});
    expect(fn).toBe(evaluate);
  });

  it("returns evaluate when _dictStack is non-empty but has no Evaluator frame", () => {
    const ctx: EvaluateContext = {
      _dictStack: [
        { typeName: "HasStateIO", args: ["account"], methods: {} },
      ],
    };
    const fn = resolveEvaluator(ctx);
    expect(fn).toBe(evaluate);
  });

  it("for the default eager fall-through, behavior is byte-identical to direct evaluate", () => {
    const rule = { "+": [{ "*": [2, 3] }, 4] };
    const direct = evaluate(rule, {}, {});
    const dispatched = resolveEvaluator()(rule, {}, {});
    expect(dispatched).toEqual(direct);
    expect(dispatched).toBe(10);
  });
});

// ---------------------------------------------------------------------------
// 2. Block scope — withInstance pushes a LazyStrategy frame
// ---------------------------------------------------------------------------

describe("resolveEvaluator — block-scoped lazy", () => {
  it("returns a lazy wrapper when a LazyStrategy frame is on the dictStack", () => {
    // f(x, y) = x — unused y; under lazy, y is never forced.
    const fn = userFn("firstOnly", ["x", "y"], { var: "x" });
    let boomCalled = false;
    const ctx = ctxWithStrategies({
      getFunction: (n) => (n === "firstOnly" ? fn : undefined),
      natives: {
        ...rekeyNativesById(evaluatorNatives, "evaluator-strategies"),
        boom: () => {
          boomCalled = true;
          throw new Error("boom");
        },
      },
    });

    const rule = { call: ["firstOnly", 42, { call: ["boom"] }] };

    // Under direct evaluate (eager), boom is called and throws.
    let eagerThrew = false;
    try {
      evaluate(rule, {}, ctx);
    } catch {
      eagerThrew = true;
    }
    expect(eagerThrew).toBe(true);
    expect(boomCalled).toBe(true);

    // Under lazy via dispatched resolver, boom is never called.
    boomCalled = false;
    const inLazy = withInstance(ctx, frameFor(LAZY_STRATEGY), (inner) =>
      resolveEvaluator(inner)(rule, {}, inner),
    );
    expect(inLazy).toBe(42);
    expect(boomCalled).toBe(false);
  });

  it("inner code under lazy stays lazy; outer code stays eager", () => {
    const fn = userFn("firstOnly", ["x", "y"], { var: "x" });
    let boomCalled = false;
    const ctx = ctxWithStrategies({
      getFunction: (n) => (n === "firstOnly" ? fn : undefined),
      natives: {
        ...rekeyNativesById(evaluatorNatives, "evaluator-strategies"),
        boom: () => {
          boomCalled = true;
          throw new Error("boom");
        },
      },
    });

    // Outer: no lazy scope → direct eager would call boom (separate
    // assertion). Inner: lazy scope skips boom.
    const inLazy = withInstance(ctx, frameFor(LAZY_STRATEGY), (inner) =>
      resolveEvaluator(inner)(
        { call: ["firstOnly", 1, { call: ["boom"] }] },
        {},
        inner,
      ),
    );
    expect(inLazy).toBe(1);
    expect(boomCalled).toBe(false);

    // Resolver outside the block returns plain evaluate again.
    const outerFn = resolveEvaluator(ctx);
    expect(outerFn).toBe(evaluate);
  });
});

// ---------------------------------------------------------------------------
// 2b. modules-as-values — a strategy frame whose `eval` is a function
//     REFERENCE (`{$ref: handle}`). The wrapper's native fast path used to take
//     only an id string, so a reference fell through to
//     `evaluate({call: [ref, rule]})`, which evaluates `rule` eagerly: a lazy
//     frame silently ran eager. The handle resolves to the canonical id first.
// ---------------------------------------------------------------------------

describe("resolveEvaluator — a strategy frame whose eval is a reference", () => {
  const LAZY_ID = "evaluator-strategies:lazyEval";
  const lazySpec = (evaluatorStrategiesModule.functions ?? []).find((f) => f.id === LAZY_ID);

  function refCtx(onBoom: () => void): EvaluateContext {
    const fn = userFn("firstOnly", ["x", "y"], { var: "x" });
    // A registry-shaped `getFunction`: every handle of the lazy strategy (its
    // id, its code name, its dotted member name) resolves to the one spec
    // whose `id` is the canonical key of the natives table.
    const lazyHandles = new Set([LAZY_ID, "lazyEval", `${evaluatorStrategiesModule.name}.lazyEval`]);
    return ctxWithStrategies({
      getFunction: (n) => (n === "firstOnly" ? fn : lazyHandles.has(n) ? lazySpec : undefined),
      natives: {
        ...rekeyNativesById(evaluatorNatives, "evaluator-strategies"),
        boom: () => {
          onBoom();
          throw new Error("boom");
        },
      },
    });
  }

  function refFrame(evalValue: unknown): TypeclassDictFrame {
    return { typeName: "Evaluator", args: [LAZY_STRATEGY], methods: { eval: evalValue } };
  }

  it("the lazy spec is present (fixture sanity)", () => {
    expect(lazySpec?.id).toBe(LAZY_ID);
  });

  for (const handle of [LAZY_ID, "lazyEval", `${evaluatorStrategiesModule.name}.lazyEval`]) {
    it(`a lazy frame holding {$ref: "${handle}"} stays lazy (the unused arg is never forced)`, () => {
      let boomCalled = false;
      const ctx = refCtx(() => { boomCalled = true; });
      const rule = { call: ["firstOnly", 42, { call: ["boom"] }] };
      const result = withInstance(ctx, refFrame({ $ref: handle }), (inner) =>
        resolveEvaluator(inner)(rule, {}, inner),
      );
      expect(result).toBe(42);
      expect(boomCalled).toBe(false);
    });
  }

  it("a reference that resolves to no function is refused loudly before the rule runs", () => {
    let boomCalled = false;
    const ctx = refCtx(() => { boomCalled = true; });
    const rule = { call: ["firstOnly", 42, { call: ["boom"] }] };
    expect(() =>
      withInstance(ctx, refFrame({ $ref: "evaluator-strategies:noSuchEval" }), (inner) =>
        resolveEvaluator(inner)(rule, {}, inner),
      ),
    ).toThrow(/evaluator-strategies:noSuchEval/);
    expect(boomCalled).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// 3. Tag scope — Evaluator instance with `{kind:"tag"}` becomes visible when
//    the tag is active. Phase 11 doesn't register a tag-scoped Evaluator by
//    default; this test simulates one via the block-stack to exercise the
//    "tag scope sits between block and global" placement.
// ---------------------------------------------------------------------------

describe("resolveEvaluator — tag-scoped Evaluator activation", () => {
  it("a future tag-scoped Evaluator participates via the same dictStack mechanism", () => {
    // Tag scope is currently honored by the underlying typeclass registry;
    // Phase 11's resolver consults block scope first, then would consult
    // tag scope (none registered today) — global fallback is eager. The
    // observable behavior is: an Evaluator instance only takes effect if
    // pushed via withInstance OR registered in the global registry. We
    // verify the block path drives behavior; the absence of any
    // tag-scoped Evaluator instance means tag scope is a no-op fall-through
    // today.
    const fn = userFn("firstOnly", ["x", "y"], { var: "x" });
    const ctx = ctxWithStrategies({
      getFunction: (n) => (n === "firstOnly" ? fn : undefined),
      // Active tags include a hypothetical "lazy-flow" tag — no instance
      // is registered for it, so the resolver still falls through to
      // eager.
      _activeTags: ["lazy-flow"],
    });
    expect(resolveEvaluator(ctx)).toBe(evaluate);

    // With an explicit block-scoped Evaluator frame, the resolver returns
    // the dispatch wrapper (NOT the legacy evaluate).
    const inLazy = withInstance(ctx, frameFor(LAZY_STRATEGY), (inner) =>
      resolveEvaluator(inner),
    );
    expect(inLazy).not.toBe(evaluate);
  });
});

// ---------------------------------------------------------------------------
// 4. Precedence — innermost frame wins over outer frames
// ---------------------------------------------------------------------------

describe("resolveEvaluator — dispatch precedence", () => {
  it("innermost Evaluator frame wins over outer Evaluator frames", () => {
    // Outer: Eager. Inner: Lazy. The inner resolver should produce a lazy
    // wrapper; the outer one should produce eager (i.e. legacy evaluate).
    const fn = userFn("firstOnly", ["x", "y"], { var: "x" });
    let boomCalled = false;
    const ctx = ctxWithStrategies({
      getFunction: (n) => (n === "firstOnly" ? fn : undefined),
      natives: {
        ...rekeyNativesById(evaluatorNatives, "evaluator-strategies"),
        boom: () => {
          boomCalled = true;
          throw new Error("boom");
        },
      },
    });

    const result = withInstance(ctx, frameFor(EAGER_STRATEGY), (outerCtx) => {
      // EagerStrategy frame is a no-op short-circuit — resolveEvaluator
      // returns plain `evaluate`.
      expect(resolveEvaluator(outerCtx)).toBe(evaluate);

      // Push Lazy on top — the new innermost frame is Lazy.
      return withInstance(outerCtx, frameFor(LAZY_STRATEGY), (innerCtx) => {
        const innerEval = resolveEvaluator(innerCtx);
        expect(innerEval).not.toBe(evaluate);
        return innerEval(
          { call: ["firstOnly", 99, { call: ["boom"] }] },
          {},
          innerCtx,
        );
      });
    });
    expect(result).toBe(99);
    expect(boomCalled).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// 5. Algebraic-effect discipline — invoking the strategy strips its own
//    frame so any inner `resolveEvaluator(ctx)` sees the OUTER scope. Without
//    this, a strategy whose body re-resolves would loop on itself.
// ---------------------------------------------------------------------------

describe("resolveEvaluator — frame popping (algebraic-effect discipline)", () => {
  it("Lazy doesn't observe its own LazyStrategy frame inside the body", () => {
    // The lazy native's inner `evaluate` calls receive a ctx with the lazy
    // frame STRIPPED — any code inside that resolves the evaluator gets
    // the outer scope (eager by default), so the strategy can compose its
    // own recursion safely.
    //
    // Operationally this prevents a runaway: were the inner evaluate
    // calls to keep seeing LazyStrategy and re-route through lazyEval
    // recursively, every body call would spin up another lazy data
    // proxy and eventually overflow. The observed witness is that an
    // ordinary lazy call completes normally (no overflow), with the lazy
    // semantics applied at the OUTERMOST call boundary only.
    const fn = userFn("doubleY", ["y"], { "+": [{ var: "y" }, { var: "y" }] });
    const ctx = ctxWithStrategies({
      getFunction: (n) => (n === "doubleY" ? fn : undefined),
    });
    const result = withInstance(ctx, frameFor(LAZY_STRATEGY), (inner) =>
      resolveEvaluator(inner)({ call: ["doubleY", 7] }, {}, inner),
    );
    expect(result).toBe(14);
  });
});

// ---------------------------------------------------------------------------
// 6. Data threading — _localData flows from the caller through eager and
//    lazy strategies so `{var: "x"}` inside the body resolves correctly.
// ---------------------------------------------------------------------------

describe("resolveEvaluator — data threading via _localData", () => {
  it("eager strategy: caller-supplied data binds {var} references", () => {
    // Wrap evaluation in a (no-op) Eager block — resolveEvaluator returns
    // plain evaluate for the EagerStrategy short-circuit, so the call
    // site below is the legacy path. The data binding works trivially.
    const ctx = ctxWithStrategies();
    const wrapped = withInstance(ctx, frameFor(EAGER_STRATEGY), (inner) =>
      resolveEvaluator(inner)({ var: "x" }, { x: 5 }, inner),
    );
    expect(wrapped).toBe(5);
  });

  it("lazy strategy: caller-supplied data binds {var} references in non-call shapes", () => {
    // For a non-call expression, lazyEvalNative falls through to evaluate
    // — but uses ctx._localData (which our wrapper populates). Without
    // the threading, the var would be unbound (silent null).
    const ctx = ctxWithStrategies();
    const result = withInstance(ctx, frameFor(LAZY_STRATEGY), (inner) =>
      resolveEvaluator(inner)({ var: "outerVar" }, { outerVar: "hello" }, inner),
    );
    expect(result).toBe("hello");
  });
});

// ---------------------------------------------------------------------------
// 7. Pure-expression faithfulness — resolved evaluator returns the same
//    value as the legacy evaluate for a representative set of pure
//    expressions, both inside and outside an EagerStrategy block.
// ---------------------------------------------------------------------------

describe("resolveEvaluator — eager faithfulness across shapes", () => {
  const rules: { rule: unknown; data?: Record<string, unknown> }[] = [
    { rule: 42 },
    { rule: "hello" },
    { rule: true },
    { rule: { "+": [1, 2, 3] } },
    { rule: { "*": [{ "+": [2, 3] }, 4] } },
    { rule: { if: [true, "yes", "no"] } },
    { rule: { var: "x" }, data: { x: 7 } },
    { rule: { eq: [{ var: "x" }, 7] }, data: { x: 7 } },
  ];

  it("default path matches evaluate for every test rule", () => {
    for (const { rule, data } of rules) {
      const dispatched = resolveEvaluator()(rule, data ?? {}, {});
      const direct = evaluate(rule, data ?? {}, {});
      expect(dispatched).toEqual(direct);
    }
  });

  it("EagerStrategy block path matches evaluate for every test rule", () => {
    const ctx = ctxWithStrategies();
    for (const { rule, data } of rules) {
      const dispatched = withInstance(ctx, frameFor(EAGER_STRATEGY), (inner) =>
        resolveEvaluator(inner)(rule, data ?? {}, inner),
      );
      const direct = evaluate(rule, data ?? {}, ctx);
      expect(dispatched).toEqual(direct);
    }
  });
});

// ---------------------------------------------------------------------------
// 8. Parser surface — `lazy { ... }` / `eager { ... }` / `partial { ... }` /
//    `jit { ... }` parse to the expected withInstance shape.
// ---------------------------------------------------------------------------

describe("parser — evaluator-strategy block syntax", () => {
  it("`lazy { x }` parses to withInstance(Evaluator LazyStrategy, x)", () => {
    const ast = parse("lazy { 42 }") as Record<string, unknown>;
    expect(ast).toHaveProperty("withInstance");
    const [frame, body] = (ast as { withInstance: unknown[] }).withInstance as [
      { typeName: string; args: unknown[]; methods: { eval: string } },
      unknown,
    ];
    expect(frame.typeName).toBe("Evaluator");
    expect(frame.args).toEqual([LAZY_STRATEGY]);
    expect(frame.methods.eval).toBe("evaluator-strategies:lazyEval");
    expect(body).toBe(42);
  });

  it("`eager { ... }` / `partial { ... }` / `jit { ... }` parse with their respective markers", () => {
    const cases = [
      { src: "eager { 1 }", marker: EAGER_STRATEGY, fn: "evaluator-strategies:eagerEval" },
      { src: "partial { 2 }", marker: PARTIAL_STRATEGY, fn: "evaluator-strategies:partialEval" },
      { src: "jit { 3 }", marker: JIT_STRATEGY, fn: "evaluator-strategies:jitEval" },
    ];
    for (const c of cases) {
      const ast = parse(c.src) as { withInstance: unknown[] };
      const [frame, body] = ast.withInstance as [
        { typeName: string; args: unknown[]; methods: { eval: string } },
        unknown,
      ];
      expect(frame.typeName).toBe("Evaluator");
      expect(frame.args).toEqual([c.marker]);
      expect(frame.methods.eval).toBe(c.fn);
      expect(typeof body).toBe("number");
    }
  });

  it("`lazy do <expr> end` form parses identically", () => {
    const ast = parse("lazy do 42 end") as { withInstance: unknown[] };
    expect(Array.isArray(ast.withInstance)).toBe(true);
    const [frame, body] = ast.withInstance as [
      { typeName: string; args: unknown[] },
      unknown,
    ];
    expect(frame.args).toEqual([LAZY_STRATEGY]);
    expect(body).toBe(42);
  });

  it("`lazy` outside a block context stays an ordinary identifier", () => {
    // `let lazy = 5` — `lazy` is a let-binding name, not a keyword.
    const ast = parse("let lazy = 5") as { let: Record<string, unknown> };
    expect(ast.let).toEqual({ lazy: 5 });
  });

  it("evaluator-block end-to-end: lazy { firstOnly 1 boom() } returns 1 without calling boom", () => {
    // Parse Fenel surface, then evaluate against a ctx with the strategy
    // natives wired in. This is the user-facing path: `.fenel` file →
    // parse → evaluate → strategy dispatched without any TS glue.
    const fn = userFn("firstOnly", ["x", "y"], { var: "x" });
    let boomCalled = false;
    const ctx = ctxWithStrategies({
      getFunction: (n) => (n === "firstOnly" ? fn : undefined),
      natives: {
        ...rekeyNativesById(evaluatorNatives, "evaluator-strategies"),
        boom: () => {
          boomCalled = true;
          throw new Error("boom");
        },
      },
    });
    const ast = parse("lazy { firstOnly 1 (boom ()) }");
    const result = evaluate(ast, {}, ctx);
    expect(result).toBe(1);
    expect(boomCalled).toBe(false);
  });
});
