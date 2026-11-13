// ---------------------------------------------------------------------------
// expr-substrate Phase 8 — `evaluateWith` (the explicit-strategy entry)
//
// `evaluateWith strategy expr` is the VALUE-LEVEL sibling of the block-scoped
// `lazy {}` / `eager {}` / `partial {}` / `jit {}` form (exercised by
// evaluator-dispatch.test.ts). It selects an evaluation strategy by an
// EXPLICITLY-NAMED strategy (a String dispatch key) rather than by scope:
//
//   1. Eager ≡ direct — `evaluateWith "EagerStrategy" e` returns `Ok v` where
//      v is the direct `evaluate(e)` result, for a representative set of pure
//      shapes (the faithfulness anchor).
//   2. Lazy call-by-name — `evaluateWith "LazyStrategy"` over a call whose
//      unused argument is an exploding sub-expression returns `Ok` WITHOUT
//      forcing the unused arg. This is the Q6 strategy×effect proxy: an effect
//      (modeled as a call) in an unforced position does not fire.
//   3. Partial residual — `evaluateWith "PartialStrategy"` constant-folds a
//      fully-known expression (`Ok 30`) but returns a residual AST for an
//      expression still referencing an unknown var (the #3 set-algebra-to-fenel
//      relevant path).
//   4. Unknown strategy — surfaces a clean `Err InternalError`, NOT a silent
//      eager fallback.
//
// The body's DISPATCH (resolve `Evaluator <strategy>` via dispatchLookupOne,
// read `.eval`) is `.fenel`; only the ctx-threaded apply (`evalApply`) is
// native. Tests drive the registered Fenel body directly (bind args → evaluate
// body), mirroring engine-bodies-dispatch's harness so the `expr` AST is passed
// as a value, not re-evaluated.
// ---------------------------------------------------------------------------

import { describe, it, expect, beforeAll } from "vitest";
import { evaluate, type EvaluateContext } from "./json-logic";
import { createRegistry } from "./registry";
import { stdModule } from "./modules/std";
import { engineModule } from "./modules/engine";
import { dispatchModule } from "./modules/dispatch";
import { evaluatorStrategiesModule } from "./modules/evaluator-strategies";
import type { FenelFunction, FunctionBody } from "./types";
import { Nothing } from "./type-foundation";

// ---------------------------------------------------------------------------
// Harness — a registry carrying the engine body (`engine:evaluateWith`), the
// dispatch primitives (`dispatchLookupOne`), and the evaluator-strategies
// natives (the 4 `*Eval` + the `evalApply` seam). The Evaluator instances are
// read by `dispatchLookupOne` from the GLOBAL dispatchRegistry (populated at
// system-entities import) — verified present below.
// ---------------------------------------------------------------------------

let reg: ReturnType<typeof createRegistry>;
let baseCtx: EvaluateContext;
let evaluateWithBody: FunctionBody;

beforeAll(async () => {
  reg = createRegistry([stdModule, engineModule, dispatchModule, evaluatorStrategiesModule]);
  baseCtx = reg.evaluateContext();
  const fn = reg.getFunction("engine:evaluateWith");
  if (!fn || fn.body === undefined) throw new Error("engine:evaluateWith not registered");
  evaluateWithBody = fn.body;

  // Sanity: the Evaluator instances the body dispatches to are globally present.
  const { dispatchRegistry } = await import("./system-entities");
  const strategyNames = dispatchRegistry.listInstances("Evaluator").map((i) => i.args[0]);
  expect(strategyNames).toEqual(
    expect.arrayContaining(["EagerStrategy", "LazyStrategy", "PartialStrategy", "JitStrategy"]),
  );
});

/** Run `evaluateWith strategy expr` by binding args to the registered body and
 *  evaluating it — `expr` is threaded as a VALUE (no re-evaluation), exactly
 *  like dispatchEngineBody. `ctxOverride` injects test-local functions/natives
 *  (boom etc.) while preserving the registry's natives + nativesCtx. */
function evalWith(
  strategy: string,
  expr: unknown,
  ctxOverride?: Partial<EvaluateContext>,
): { $tag: string; _0?: unknown } {
  const ctx: EvaluateContext = { ...baseCtx, ...ctxOverride };
  return evaluate(evaluateWithBody, { strategy, expr }, ctx) as { $tag: string; _0?: unknown };
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
// 1. Eager ≡ direct
// ---------------------------------------------------------------------------

describe("evaluateWith EagerStrategy — faithful to direct evaluate", () => {
  const rules: unknown[] = [
    42,
    "hello",
    true,
    { "+": [1, 2, 3] },
    { "*": [{ "+": [2, 3] }, 4] },
    { if: [true, "yes", "no"] },
  ];

  it("returns Ok of the direct evaluate result for every shape", () => {
    for (const rule of rules) {
      const r = evalWith("EagerStrategy", rule);
      const direct = evaluate(rule, {}, {});
      expect(r.$tag).toBe("Ok");
      expect(r._0).toEqual(direct);
    }
  });

  it("the canonical arithmetic example reduces", () => {
    const r = evalWith("EagerStrategy", { "*": [{ "+": [2, 3] }, 4] });
    expect(r).toEqual({ $tag: "Ok", _0: 20 });
  });
});

// ---------------------------------------------------------------------------
// 2. Lazy call-by-name — Q6 strategy×effect proxy (unforced arg never fires)
// ---------------------------------------------------------------------------

describe("evaluateWith LazyStrategy — call-by-name (the unforced-effect proxy)", () => {
  it("an unused exploding argument is never forced (Ok, boom not called)", () => {
    const firstOnly = userFn("firstOnly", ["x", "y"], { var: "x" });
    let boomCalled = false;
    const r = evalWith(
      "LazyStrategy",
      { call: ["firstOnly", 42, { call: ["boom"] }] },
      {
        getFunction: (n: string) => (n === "firstOnly" ? firstOnly : baseCtx.getFunction?.(n)),
        natives: {
          ...baseCtx.natives,
          boom: () => {
            boomCalled = true;
            throw new Error("boom — must not fire under lazy");
          },
        },
      },
    );
    expect(r).toEqual({ $tag: "Ok", _0: 42 });
    expect(boomCalled).toBe(false);
  });

  it("contrast: under EagerStrategy the same exploding argument fires → Err", () => {
    const firstOnly = userFn("firstOnly", ["x", "y"], { var: "x" });
    let boomCalled = false;
    const r = evalWith(
      "EagerStrategy",
      { call: ["firstOnly", 42, { call: ["boom"] }] },
      {
        getFunction: (n: string) => (n === "firstOnly" ? firstOnly : baseCtx.getFunction?.(n)),
        natives: {
          ...baseCtx.natives,
          boom: () => {
            boomCalled = true;
            throw new Error("boom payload");
          },
        },
      },
    );
    expect(r.$tag).toBe("Err");
    expect(boomCalled).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// 3. Partial residual — the #3 set-algebra-to-fenel relevant path
// ---------------------------------------------------------------------------

describe("evaluateWith PartialStrategy — symbolic residual", () => {
  it("fully-known expression constant-folds to a concrete value", () => {
    const r = evalWith("PartialStrategy", { add: [10, 20] });
    expect(r).toEqual({ $tag: "Ok", _0: 30 });
  });

  it("an expression referencing an unknown var returns a residual AST (not a primitive)", () => {
    const r = evalWith("PartialStrategy", { "+": [{ var: "x" }, 1] });
    expect(r.$tag).toBe("Ok");
    // The value channel carries the residual JSON-Logic AST — an object that
    // still references the unknown `x`, NOT a folded primitive.
    expect(typeof r._0).toBe("object");
    expect(JSON.stringify(r._0)).toContain("x");
  });
});

// ---------------------------------------------------------------------------
// 4. Unknown strategy — clean Err, never a silent eager fallback
// ---------------------------------------------------------------------------

describe("evaluateWith — unknown strategy", () => {
  it("surfaces Err InternalError naming the strategy (not a silent eager value)", () => {
    const r = evalWith("NoSuchStrategy", { "+": [1, 2] });
    expect(r.$tag).toBe("Err");
    const err = r._0 as { $tag: string; message?: string };
    expect(err.$tag).toBe("InternalError");
    expect(err.message).toContain("NoSuchStrategy");
  });
});

// ---------------------------------------------------------------------------
// 5. modules-as-values — an Evaluator instance's `eval` may be a function
//    REFERENCE (`{$ref: handle}`) instead of an id string. `evalApply` used to
//    return `Err` for anything but a string. A reference must evaluate exactly
//    like the id string of the function it names, whatever the handle's form.
// ---------------------------------------------------------------------------

describe("evaluateWith — an Evaluator whose eval is a function reference", () => {
  let lazyId: string;
  let partialId: string;

  beforeAll(async () => {
    const { dispatchRegistry } = await import("./system-entities");
    // modules-as-values Phase 2b: the corpus instances hold a qualified
    // reference (`eval = evaluatorStrategies.lazyEval`); the id is the function
    // it names in this harness registry.
    const evalOf = (strategy: string): string => {
      const inst = dispatchRegistry.listInstances("Evaluator").find((i) => i.args[0] === strategy);
      const value = inst?.methods.eval;
      const handle = typeof value === "string" ? value : (value as { $ref?: unknown } | undefined)?.$ref;
      const id = typeof handle === "string" ? reg.getFunction(handle)?.id : undefined;
      if (id === undefined) throw new Error(`no resolvable eval for ${strategy}`);
      return id;
    };
    lazyId = evalOf("LazyStrategy");
    partialId = evalOf("PartialStrategy");
    const lazyMember = lazyId.slice(lazyId.indexOf(":") + 1);
    // Test-only strategy markers: each instance names the SAME function the
    // LazyStrategy / PartialStrategy instances name by id, through a reference.
    const refInstances: Array<[string, unknown]> = [
      ["RefLazyById", { $ref: lazyId }],
      ["RefLazyByCodeName", { $ref: lazyMember }],
      ["RefLazyDotted", { $ref: `${evaluatorStrategiesModule.name}.${lazyMember}` }],
      ["RefPartialById", { $ref: partialId }],
      ["RefUnresolved", { $ref: "evaluator-strategies:noSuchEval" }],
    ];
    for (const [marker, evalRef] of refInstances) {
      if (dispatchRegistry.listInstances("Evaluator").some((i) => i.args[0] === marker)) continue;
      dispatchRegistry.addInstance({ typeName: "Evaluator", args: [marker], methods: { eval: evalRef } });
    }
  });

  const lazyProbe = (strategy: string): { result: unknown; boomCalled: boolean } => {
    const firstOnly = userFn("firstOnly", ["x", "y"], { var: "x" });
    let boomCalled = false;
    const result = evalWith(
      strategy,
      { call: ["firstOnly", 42, { call: ["boom"] }] },
      {
        getFunction: (n: string) => (n === "firstOnly" ? firstOnly : baseCtx.getFunction?.(n)),
        natives: {
          ...baseCtx.natives,
          boom: () => {
            boomCalled = true;
            throw new Error("boom — must not fire under lazy");
          },
        },
      },
    );
    return { result, boomCalled };
  };

  it("a reference by colon id evaluates lazily, exactly like the id string", () => {
    const byString = lazyProbe("LazyStrategy");
    expect(byString).toEqual({ result: { $tag: "Ok", _0: 42 }, boomCalled: false });
    expect(lazyProbe("RefLazyById")).toEqual(byString);
  });

  it("a code-name handle and a dotted `bundle.member` handle resolve to the same strategy", () => {
    expect(lazyProbe("RefLazyByCodeName")).toEqual({ result: { $tag: "Ok", _0: 42 }, boomCalled: false });
    expect(lazyProbe("RefLazyDotted")).toEqual({ result: { $tag: "Ok", _0: 42 }, boomCalled: false });
  });

  it("a partial-evaluator reference returns the same residual as its id string", () => {
    const expr = { "+": [{ var: "x" }, 1] };
    const byString = evalWith("PartialStrategy", expr);
    expect(byString.$tag).toBe("Ok");
    expect(evalWith("RefPartialById", expr)).toEqual(byString);
    expect(evalWith("RefPartialById", { add: [10, 20] })).toEqual({ $tag: "Ok", _0: 30 });
  });

  it("a reference that resolves to no function is a loud Err, never a silent evaluation", () => {
    const r = evalWith("RefUnresolved", { add: [1, 2] });
    expect(r.$tag).toBe("Err");
    const err = r._0 as { $tag: string; message?: string };
    expect(err.$tag).toBe("InternalError");
    expect(err.message).toContain("evaluator-strategies:noSuchEval");
  });
});
