// ---------------------------------------------------------------------------
// Evaluator typeclass — end-to-end tests for Phase 6
//
// Exercises:
//   1. EagerEvaluator faithfulness — for a small set of expressions, the
//      typeclass-dispatched eval produces the same value as the direct
//      `evaluate` call. The "this wrapper is faithful" anchor.
//   2. LazyEvaluator contrast — a function whose body uses only one of
//      its two parameters, called with an exploding expression in the
//      unused slot. EagerEvaluator returns `Err InternalError`; the same
//      call under LazyEvaluator returns `Ok value`. The smallest possible
//      signal that the strategy switch is observable.
//   3. Structured-error path — a body referencing an unbound variable
//      under strict mode returns `Err UnboundVariable`. The pre-Phase-6
//      direct `evaluate` returns the fallback `null` silently.
//
// Tests bypass the dispatch path and call the native impls directly —
// same posture as `prover.test.ts` / `compilable.test.ts`. The
// runtime-dispatch path is exercised by the audit script's law-validator
// runs (audit-effects.ts), which sees `Evaluator` as just another
// typeclass with its instance set.
// ---------------------------------------------------------------------------

import { describe, it, expect } from "vitest";
import { eagerEvalNative, lazyEvalNative } from "./modules/evaluator-strategies";
import { evaluate, type EvaluateContext } from "./json-logic";
import type { FenelFunction, FunctionBody } from "./types";
import { Nothing } from "./type-foundation";
// ---------------------------------------------------------------------------
// Test helpers
// ---------------------------------------------------------------------------

/** Build a minimal FenelFunction with `params` + a body that references
 *  formal-parameter names by `{var: "name"}`. */
function userFn(id: string, paramNames: string[], body: FunctionBody): FenelFunction {
  return {
    id,
    params: paramNames.map((n) => ({ name: n, label: Nothing, type: { $ref: "Any" }, meta: {}, ui: Nothing })),
    returns: { $ref: "Any" },
    body,
  };
}

/** Build an EvaluateContext that knows about a single user function +
 *  optionally one native impl keyed by name. */
function makeCtx(fn: FenelFunction, natives?: Record<string, (...args: unknown[]) => unknown>): EvaluateContext {
  return {
    getFunction: (name) => (name === fn.id ? fn : undefined),
    natives,
  };
}

// ---------------------------------------------------------------------------
// 1. EagerEvaluator faithfulness — wrapper produces the same value as the
//    direct evaluator for a handful of representative shapes.
// ---------------------------------------------------------------------------

describe("EagerEvaluator — wrapper faithfulness", () => {
  it("evaluates primitive literals identically", () => {
    for (const rule of [42, "hello", true, null]) {
      const eager = eagerEvalNative(rule);
      const direct = evaluate(rule, {}, {});
      expect(eager.$tag).toBe("Ok");
      if (eager.$tag === "Ok") expect(eager._0).toEqual(direct);
    }
  });

  it("evaluates arithmetic operators identically", () => {
    const rule = { "+": [1, 2, 3] };
    const eager = eagerEvalNative(rule);
    const direct = evaluate(rule, {}, {});
    expect(eager.$tag).toBe("Ok");
    if (eager.$tag === "Ok") expect(eager._0).toEqual(direct);
    expect(direct).toBe(6);
  });

  it("evaluates nested expressions identically", () => {
    const rule = { "*": [{ "+": [2, 3] }, 4] };
    const eager = eagerEvalNative(rule);
    const direct = evaluate(rule, {}, {});
    expect(eager.$tag).toBe("Ok");
    if (eager.$tag === "Ok") expect(eager._0).toEqual(direct);
    expect(direct).toBe(20);
  });

  it("evaluates user-function calls identically", () => {
    // f(x) = x + 1
    const f = userFn("f", ["x"], { "+": [{ var: "x" }, 1] });
    const ctx = makeCtx(f);
    const rule = { call: ["f", 10] };
    const eager = eagerEvalNative(rule, ctx);
    const direct = evaluate(rule, {}, ctx);
    expect(eager.$tag).toBe("Ok");
    if (eager.$tag === "Ok") expect(eager._0).toEqual(direct);
    expect(direct).toBe(11);
  });
});

// ---------------------------------------------------------------------------
// 2. LazyEvaluator contrast — same expression, different strategies, different
//    observed outcomes.
// ---------------------------------------------------------------------------

describe("LazyEvaluator vs EagerEvaluator — observable contrast", () => {
  it("Lazy: unused arg with side-effect is never evaluated; Eager: it is", () => {
    // Setup: a function that takes two args but uses only the first.
    // The second arg is a call to a native `boom` that throws when invoked.
    //
    // Under Eager: every arg is evaluated before the body runs → boom()
    //   throws → wrapped as Err InternalError.
    // Under Lazy: only referenced params are forced; the body references
    //   only x → boom never called → Ok 42.
    const firstOnly = userFn("firstOnly", ["x", "y"], { var: "x" });
    const natives = {
      boom: () => {
        throw new Error("boom — this arg should not be evaluated under Lazy");
      },
    };
    const ctx = makeCtx(firstOnly, natives);
    const rule = { call: ["firstOnly", 42, { call: ["boom"] }] };

    const eager = eagerEvalNative(rule, ctx);
    expect(eager.$tag).toBe("Err");
    if (eager.$tag === "Err") {
      expect(eager._0.$tag).toBe("InternalError");
      if (eager._0.$tag === "InternalError") {
        expect(eager._0.message).toContain("boom");
      }
    }

    const lazy = lazyEvalNative(rule, ctx);
    expect(lazy.$tag).toBe("Ok");
    if (lazy.$tag === "Ok") expect(lazy._0).toBe(42);
  });

  it("Lazy: a referenced arg is still evaluated (so a throwing referenced arg surfaces)", () => {
    // The body references y; Lazy must evaluate the y-arg when the body
    // accesses it. With a throwing y-arg, Lazy *should* return Err too —
    // call-by-name doesn't suppress errors in arguments that are
    // actually needed.
    const usesY = userFn("usesY", ["x", "y"], { var: "y" });
    const natives = {
      boom: () => {
        throw new Error("boom");
      },
    };
    const ctx = makeCtx(usesY, natives);
    const rule = { call: ["usesY", 1, { call: ["boom"] }] };

    const lazy = lazyEvalNative(rule, ctx);
    expect(lazy.$tag).toBe("Err");
    if (lazy.$tag === "Err") {
      expect(lazy._0.$tag).toBe("InternalError");
    }
  });

  it("Lazy: non-call expressions pass through to the eager path", () => {
    // No call → no lazy benefit → same result as eager.
    const rule = { "+": [10, 20] };
    const lazy = lazyEvalNative(rule);
    const eager = eagerEvalNative(rule);
    expect(lazy.$tag).toBe("Ok");
    expect(eager.$tag).toBe("Ok");
    if (lazy.$tag === "Ok" && eager.$tag === "Ok") {
      expect(lazy._0).toEqual(eager._0);
      expect(lazy._0).toBe(30);
    }
  });

  it("Lazy: re-evaluates an arg each time the body references it (call-by-name)", () => {
    // The body references y twice → the arg expression is evaluated twice.
    // We track invocations via a counter native. Call-by-name (not call-by-
    // need) re-runs each time; call-by-need would memoise.
    let counter = 0;
    const natives = {
      tick: () => {
        counter += 1;
        return counter;
      },
    };
    // double(y) = y + y — references the same arg twice.
    const doubleY = userFn("doubleY", ["y"], { "+": [{ var: "y" }, { var: "y" }] });
    const ctx = makeCtx(doubleY, natives);
    const rule = { call: ["doubleY", { call: ["tick"] }] };
    const lazy = lazyEvalNative(rule, ctx);
    expect(lazy.$tag).toBe("Ok");
    // tick was called twice: first reference produced 1, second 2 → sum 3.
    if (lazy.$tag === "Ok") expect(lazy._0).toBe(3);
    expect(counter).toBe(2);
  });
});

// ---------------------------------------------------------------------------
// 3. Structured-error path — strict-unbound mode surfaces UnboundVariable as
//    a typed Err. Default mode preserves today's silent-fallback behaviour.
// ---------------------------------------------------------------------------

describe("EagerEvaluator — structured EvalError path", () => {
  it("returns Err UnboundVariable when _strictUnbound is set", () => {
    const rule = { var: "missingVar" };
    const ctx: EvaluateContext = { _strictUnbound: true } as EvaluateContext;
    const r = eagerEvalNative(rule, ctx);
    expect(r.$tag).toBe("Err");
    if (r.$tag === "Err") {
      expect(r._0.$tag).toBe("UnboundVariable");
      if (r._0.$tag === "UnboundVariable") {
        expect(r._0.name).toBe("missingVar");
      }
    }
  });

  it("default mode preserves silent-fallback (no UnboundVariable error)", () => {
    const rule = { var: "missingVar" };
    const r = eagerEvalNative(rule);
    expect(r.$tag).toBe("Ok");
    // Today's evaluate returns null for unbound vars (the default fallback).
    if (r.$tag === "Ok") expect(r._0).toBeNull();
  });

  it("wraps internal evaluator throws as Err InternalError", () => {
    // Trigger a runtime exception via a native that throws.
    const natives = {
      kaboom: () => {
        throw new Error("kaboom payload");
      },
    };
    const r = eagerEvalNative({ call: ["kaboom"] }, { natives });
    expect(r.$tag).toBe("Err");
    if (r.$tag === "Err") {
      expect(r._0.$tag).toBe("InternalError");
      if (r._0.$tag === "InternalError") {
        expect(r._0.message).toContain("kaboom payload");
      }
    }
  });
});

// ---------------------------------------------------------------------------
// 4. Instances registered in the system registry — sanity check that the
//    Evaluator instances are discoverable through the typeclass registry.
// ---------------------------------------------------------------------------

describe("Evaluator instances — registry presence", () => {
  it("EagerEvaluator + LazyEvaluator are registered in the system typeclass registry", async () => {
    const { dispatchRegistry } = await import("./system-entities");
    const instances = dispatchRegistry.listInstances("Evaluator");
    const strategyNames = instances.map((i) => i.args[0]);
    expect(strategyNames).toContain("EagerStrategy");
    expect(strategyNames).toContain("LazyStrategy");
  });
});
