// ---------------------------------------------------------------------------
// PartialEvaluator — symbolic evaluation + Futamura projection tests
//
// Phase 7 of the implementation roadmap. Exercises:
//
//   1. **Constant folding** — `partialEval({+: [1, 2]}, {})` returns 3.
//   2. **Var substitution** — `partialEval({var: "x"}, {x: 5})` returns 5;
//      sub-expression substitution under arithmetic returns the folded value.
//   3. **Residual preservation** — an expression with unbound vars returns
//      a residual that, re-evaluated with those vars supplied, gives the
//      same value as evaluating the original with the combined inputs.
//   4. **Dead-branch pruning** — `if`s with known conditions drop the dead
//      branch; `and`/`or` short-circuit identities collapse.
//   5. **User-function β-reduction** — calls with all-known args fold;
//      calls with partial-known args inline the body with the known
//      bindings and leave a smaller residual.
//   6. **Recursion budget** — recursive functions inline up to the budget,
//      then leave the deepest call as a residual (no non-termination).
//   7. **Futamura projection demo** — a tiny dispatcher interpreter
//      specialised on a known op-string becomes a direct operation; the
//      residual compiles via `compileFenelToJs` to JS that runs the
//      specialised computation with no interpreter loop.
//   8. **JitEvaluator round-trip** — `jitEval(expr, ctx)` agrees with
//      `eagerEval(expr, ctx)` on representative inputs.
//   9. **Registry presence** — PartialEvaluator + JitEvaluator instances
//      surface through the typeclass registry.
//
// CONSERVATIVE REPAIR (2026-10-16): items 4 (and/or), 5, 6 and 7 are re-pinned
// — and/or stay residual, user calls are never inlined (residuals re-evaluate
// with the functions in scope), and the Futamura compile demo is skipped until
// the later arc. Soundness rows: partial-evaluate-conservative.test.ts.
// ---------------------------------------------------------------------------

import { describe, it, expect } from "vitest";
import { jitEvalNative, eagerEvalNative } from "./modules/evaluator-strategies";
import { compileFenelToJsNative } from "./modules/compile-js";
import {
  dispatchedSerializeJsModule,
  dispatchedPartialEvalDetailed,
  dispatchedExprToJsonLogic,
  harnessForTests,
} from "./engine-bodies-dispatch";
import { evaluate, type EvaluateContext } from "./json-logic";
import type { CompileSource } from "./compilable";
import { positionalCompileFieldSlots } from "./compile-field-slots";
import type { Constraint, FenelFunction, FunctionBody } from "./types";
import { Nothing } from "./type-foundation";

// ---------------------------------------------------------------------------
// partial-evaluator-substrate Phase 1R — the TS `partial-evaluator.ts` was
// DELETED; the PE is now the Fenel-bodied `engine:partialEvaluate` walker,
// reached via the dispatched surface (`dispatchedPartialEvalDetailed`). These
// 30 behavioral cases are re-based to that surface: the value channel egresses
// a residual `Expr` to JSON-Logic (`dispatchedExprToJsonLogic`), and local test
// functions join the foldable set through `extraFns` (stashed on the ctx as
// `_fns` so every call site below is UNCHANGED — same `(rule, known, ctx)`
// shape). The exact-shape assertions still hold: the egressed canonical forms
// (`{var:"p"}` / `{call:["f",10]}` / `{if:[…]}` / `{call:["add",…]}`) coincide
// with the retired native's output for these rows. The comprehensive TS/Fenel
// differential lives in `partial-evaluate-port.test.ts` (the ground-truth +
// divergence-class suite).
// ---------------------------------------------------------------------------

// A ctx that also carries its local fns so the PE helpers can add them to the
// foldable set (the retired native read the fold gate off `ctx.getFunction`;
// the dispatched surface takes an explicit fn list — `EvaluateContext` has no
// enumeration surface, so the test threads `_fns` alongside `getFunction`).
type TestCtx = EvaluateContext & {
  _fns?: FenelFunction[];
  _known?: Record<string, unknown>;
  _partialBudget?: number;
};

/** value channel: concrete fold or residual JSON-Logic (egressed from Expr). */
function partialEval(
  rule: unknown,
  knownInputs: Record<string, unknown> = {},
  ctx: TestCtx = {},
): unknown {
  const d = dispatchedPartialEvalDetailed(rule, knownInputs, ctx._partialBudget, ctx._fns);
  return d.$tag === "Concrete" ? d.value : dispatchedExprToJsonLogic(d.expr);
}

/** the concrete-vs-residual discrimination surface (residual carried as Expr). */
function partialEvalDetailed(
  rule: unknown,
  knownInputs: Record<string, unknown> = {},
  ctx: TestCtx = {},
): { $tag: "Concrete"; value: unknown } | { $tag: "Residual"; expr: unknown } {
  return dispatchedPartialEvalDetailed(rule, knownInputs, ctx._partialBudget, ctx._fns);
}

/** the EvalResult-shaped surface — `Ok value|residual` (reads _known/_partialBudget). */
function partialEvalNative(
  rule: unknown,
  ctx: TestCtx = {},
): { $tag: "Ok"; _0: unknown } {
  const d = dispatchedPartialEvalDetailed(rule, ctx._known ?? {}, ctx._partialBudget, ctx._fns);
  return { $tag: "Ok", _0: d.$tag === "Concrete" ? d.value : dispatchedExprToJsonLogic(d.expr) };
}
// ---------------------------------------------------------------------------
// Test helpers
// ---------------------------------------------------------------------------

function userFn(
  id: string,
  paramNames: string[],
  body: FunctionBody,
  requires?: Constraint[],
): FenelFunction {
  return {
    id,
    params: paramNames.map((n) => ({ name: n, label: Nothing, type: { $ref: "Any" }, meta: {}, ui: Nothing })),
    returns: { $ref: "Any" },
    body,
    ...(requires !== undefined ? { requires } : {}),
  };
}

/** The harness frame with a test ctx's local functions in front: re-evaluates a
 *  residual call (conservative mode keeps calls of user functions as written). */
function reevalCtx(ctx: TestCtx): EvaluateContext {
  const h = harnessForTests().ctx;
  return { ...h, getFunction: (n: string) => ctx.getFunction?.(n) ?? h.getFunction?.(n) };
}

function ctxWithFns(...fns: FenelFunction[]): TestCtx {
  const map = new Map(fns.map((f) => [f.id, f] as const));
  return {
    getFunction: (name) => map.get(name),
    _fns: fns,
  };
}

/** $fenel runtime stub used by the Futamura JIT demo. Same shape as the
 *  JIT path's runtime in `evaluator-strategies.ts` + the `compile-js`
 *  test suite. Only `concat` is needed for arithmetic targets. */
const $fenelRuntime = {
  concat: (a: unknown, b: unknown): unknown => {
    if (Array.isArray(a) && Array.isArray(b)) return [...a, ...b];
    return String(a ?? "") + String(b ?? "");
  },
};

// ---------------------------------------------------------------------------
// 1. Constant folding
// ---------------------------------------------------------------------------

describe("PartialEvaluator — constant folding", () => {
  it("folds {+: [1, 2]} to 3", () => {
    expect(partialEval({ "+": [1, 2] }, {})).toBe(3);
  });

  it("folds nested arithmetic", () => {
    expect(partialEval({ "*": [{ "+": [2, 3] }, 4] }, {})).toBe(20);
  });

  it("folds key-as-fnId for built-in ops", () => {
    expect(partialEval({ add: [10, 20] }, {})).toBe(30);
    expect(partialEval({ mul: [3, 7] }, {})).toBe(21);
  });

  it("leaves a primitive literal as itself", () => {
    expect(partialEval(42, {})).toBe(42);
    expect(partialEval("hello", {})).toBe("hello");
    expect(partialEval(true, {})).toBe(true);
    expect(partialEval(null, {})).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// 2. Var substitution
// ---------------------------------------------------------------------------

describe("PartialEvaluator — var substitution", () => {
  it("substitutes a bound var", () => {
    expect(partialEval({ var: "x" }, { x: 5 })).toBe(5);
  });

  it("folds arithmetic under a bound var", () => {
    expect(partialEval({ "+": [{ var: "x" }, 1] }, { x: 5 })).toBe(6);
  });

  it("folds a deeper nest with a bound var", () => {
    const expr = { "*": [{ "+": [{ var: "x" }, 2] }, 3] };
    expect(partialEval(expr, { x: 4 })).toBe(18);
  });

  // Conservative repair (2026-10-16): a record known is not quotable and a
  // dotted read is never projected, so the read stays residual (needs ctx1).
  it("keeps a dot-path read of a bound record residual (re-evaluates with the record)", () => {
    const expr = { "+": [{ var: "user.age" }, 1] };
    const r = partialEval(expr, { user: { age: 29 } });
    expect(evaluate(r, { user: { age: 29 } })).toBe(30);
  });
});

// ---------------------------------------------------------------------------
// 3. Residual preservation
// ---------------------------------------------------------------------------

describe("PartialEvaluator — residual preservation", () => {
  it("leaves an unbound var as residual", () => {
    const r = partialEval({ var: "x" }, {});
    // Re-evaluating with x supplied should give the value.
    expect(evaluate(r, { x: 7 })).toBe(7);
  });

  it("produces a residual that round-trips through evaluate", () => {
    const expr = { "+": [{ var: "x" }, 1] };
    const r = partialEval(expr, {});
    expect(evaluate(r, { x: 5 })).toBe(6);
  });

  it("folds the known part and keeps the unknown part as residual", () => {
    // (x + 1) * 3 with x unknown → residual {*: [{+: [x, 1]}, 3]}.
    // (PE doesn't algebraically distribute — keeps the structure.)
    const expr = { "*": [{ "+": [{ var: "x" }, 1] }, 3] };
    const r = partialEval(expr, {});
    // Re-evaluating with x=4 → (4+1)*3 = 15.
    expect(evaluate(r, { x: 4 })).toBe(15);
  });

  it("partialEvalDetailed flags concrete vs residual outputs explicitly", () => {
    const concrete = partialEvalDetailed({ "+": [1, 2] }, {});
    expect(concrete.$tag).toBe("Concrete");
    if (concrete.$tag === "Concrete") expect(concrete.value).toBe(3);

    const residual = partialEvalDetailed({ "+": [{ var: "x" }, 1] }, {});
    expect(residual.$tag).toBe("Residual");
  });
});

// ---------------------------------------------------------------------------
// 4. Dead-branch pruning
// ---------------------------------------------------------------------------

describe("PartialEvaluator — dead-branch pruning", () => {
  it("prunes a known-true if to the then branch", () => {
    expect(partialEval({ if: [true, "yes", "no"] }, {})).toBe("yes");
  });

  it("prunes a known-false if to the else branch", () => {
    expect(partialEval({ if: [false, "yes", "no"] }, {})).toBe("no");
  });

  it("prunes under a bound-var condition", () => {
    const expr = { if: [{ var: "flag" }, "on", "off"] };
    expect(partialEval(expr, { flag: true })).toBe("on");
    expect(partialEval(expr, { flag: false })).toBe("off");
  });

  it("leaves a residual if when the condition is unknown", () => {
    const expr = { if: [{ var: "flag" }, "on", "off"] };
    const r = partialEval(expr, {}) as Record<string, unknown>;
    expect(r).toHaveProperty("if");
    expect(evaluate(r, { flag: true })).toBe("on");
    expect(evaluate(r, { flag: false })).toBe("off");
  });

  // Conservative repair (2026-10-16, Astra round 3): `and` / `or` return an
  // operand VALUE and a dropped operand may be a read a proof sees, so they are
  // never reduced; the residual equals ordinary evaluation for every operand.
  it("keeps {and: [true, true, X]} residual, equal to ordinary for every X", () => {
    const expr = { and: [true, true, { var: "p" }] };
    const r = partialEval(expr, {});
    expect(r).toEqual(expr);
    for (const p of [false, 0, "x", true]) expect(evaluate(r, { p })).toEqual(evaluate(expr, { p }));
  });

  it("keeps {or: [false, true, X]} residual (ordinary: true)", () => {
    const expr = { or: [false, true, { var: "p" }] };
    const r = partialEval(expr, {});
    expect(r).toEqual(expr);
    expect(evaluate(r, { p: 0 })).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// 5. User-function β-reduction + inlining
// ---------------------------------------------------------------------------

describe("PartialEvaluator — user function inlining", () => {
  it("folds a call with all-known args", () => {
    // f(x) = x + 1
    const f = userFn("f", ["x"], { "+": [{ var: "x" }, 1] });
    const ctx = ctxWithFns(f);
    // Conservative repair (2026-10-16): user calls are never folded or inlined.
    const r = partialEval({ call: ["f", 10] }, {}, ctx);
    expect(r).toEqual({ call: ["f", 10] });
    expect(evaluate(r, {}, reevalCtx(ctx))).toBe(11);
  });

  it("β-reduces with partial knowledge: known param folds, unknown stays residual", () => {
    // f(a, b) = a + b * 2 ;  partialEval f(5, x)  →  5 + x * 2  (residual)
    const f = userFn("f", ["a", "b"], {
      "+": [{ var: "a" }, { "*": [{ var: "b" }, 2] }],
    });
    const ctx = ctxWithFns(f);
    const r = partialEval({ call: ["f", 5, { var: "x" }] }, {}, ctx);
    // Conservative repair: the call stays residual (no specialisation), so it
    // re-evaluates with the function in scope. x=3 → 11, x=10 → 25.
    expect(evaluate(r, { x: 3 }, reevalCtx(ctx))).toBe(11);
    expect(evaluate(r, { x: 10 }, reevalCtx(ctx))).toBe(25);
  });

  it("inlines a function whose body uses an outer var the call substitutes", () => {
    // f(x) = x * 3   ;   partialEval f({var: "y"}) → y * 3  (residual)
    const f = userFn("f", ["x"], { "*": [{ var: "x" }, 3] });
    const ctx = ctxWithFns(f);
    const r = partialEval({ call: ["f", { var: "y" }] }, {}, ctx);
    expect(evaluate(r, { y: 7 }, reevalCtx(ctx))).toBe(21);
    expect(evaluate(r, { y: 0 }, reevalCtx(ctx))).toBe(0);
  });

  it("does NOT inline an impure (`requires`-declared) function", () => {
    // f(x) = x + 1 but declares an effect → not inlined.
    const f = userFn("f", ["x"], { "+": [{ var: "x" }, 1] }, [
      { class: { $tag: "Id", entityId: "HasIO" }, args: [] },
    ]);
    const ctx = ctxWithFns(f);
    const r = partialEval({ call: ["f", 10] }, {}, ctx);
    // Since not inlined, the call stays residual. Re-eval should still
    // give the right answer when args are present.
    expect(r).toEqual({ call: ["f", 10] });
    // Evaluating the residual through the engine (which DOES resolve the
    // body) gives 11.
    expect(evaluate(r, {}, ctx)).toBe(11);
  });
});

// ---------------------------------------------------------------------------
// 6. Recursion budget
// ---------------------------------------------------------------------------

describe("PartialEvaluator — recursion budget", () => {
  it("inlines recursive calls within the budget and folds when the base case is reachable", () => {
    // power(b, e) = if e == 0 then 1 else b * power(b, e - 1)
    const power = userFn("power", ["b", "e"], {
      if: [
        { eq: [{ var: "e" }, 0] },
        1,
        {
          mul: [
            { var: "b" },
            { call: ["power", { var: "b" }, { sub: [{ var: "e" }, 1] }] },
          ],
        },
      ],
    });
    const ctx = ctxWithFns(power);
    // Specialise power(b, 3) with b unknown — budget high enough to fully
    // unroll. The residual should compute to `b * b * b * 1` (folded
    // multiplications under whatever shape PE chose).
    const r = partialEval(
      { call: ["power", { var: "b" }, 3] },
      {},
      ctx,
    );
    // Conservative repair: no unrolling; the residual call needs the function.
    expect(evaluate(r, { b: 2 }, reevalCtx(ctx))).toBe(8);
    expect(evaluate(r, { b: 5 }, reevalCtx(ctx))).toBe(125);
  });

  it("falls back to a residual call when the budget runs out", () => {
    // A deeply recursive function whose base case requires more than the
    // budget allows for inlining. The PE should bail to a residual call
    // (not loop forever).
    const countdown = userFn("countdown", ["n"], {
      if: [
        { lte: [{ var: "n" }, 0] },
        "done",
        { call: ["countdown", { sub: [{ var: "n" }, 1] }] },
      ],
    });
    const ctx = ctxWithFns(countdown);
    // Budget 2 with n=100 → can't reach the base case. Should produce a
    // residual (not throw / not loop).
    const r = partialEvalNative(
      { call: ["countdown", 100] },
      { ...ctx, _partialBudget: 2 },
    );
    expect(r.$tag).toBe("Ok");
    // Re-evaluating with the engine gives the correct full result.
    if (r.$tag === "Ok") {
      expect(evaluate(r._0, {}, ctx)).toBe("done");
    }
  });
});

// ---------------------------------------------------------------------------
// 7. Futamura projection demo — interpreter specialisation
// ---------------------------------------------------------------------------

describe("PartialEvaluator — Futamura projection demo (first projection)", () => {
  it("specialises a tiny dispatch interpreter to a known op", () => {
    // The "interpreter": dispatch(op, x, y) = match op of
    //   "add" → x + y
    //   "sub" → x - y
    //   "mul" → x * y
    //   _     → 0
    const dispatch = userFn("dispatch", ["op", "x", "y"], {
      match: [
        { var: "op" },
        "add",
        { add: [{ var: "x" }, { var: "y" }] },
        "sub",
        { sub: [{ var: "x" }, { var: "y" }] },
        "mul",
        { mul: [{ var: "x" }, { var: "y" }] },
        0,
      ],
    });
    const ctx = ctxWithFns(dispatch);

    // Specialise `dispatch("add", x, y)` — op known, args unknown.
    // The residual should be the add branch's body with x, y still
    // residual: `{add: [{var: "x"}, {var: "y"}]}`. No match, no dispatch
    // overhead.
    const residual = partialEval(
      { call: ["dispatch", "add", { var: "x" }, { var: "y" }] },
      {},
      ctx,
    );
    // Conservative repair (2026-10-16): no specialisation until the later
    // arc — the residual is the original call, re-evaluated with the
    // interpreter in scope. x=5, y=3 gives 8.
    expect(evaluate(residual, { x: 5, y: 3 }, reevalCtx(ctx))).toBe(8);
    expect(evaluate(residual, { x: 10, y: 4 }, reevalCtx(ctx))).toBe(14);
    // Same for "sub":
    const subResidual = partialEval(
      { call: ["dispatch", "sub", { var: "x" }, { var: "y" }] },
      {},
      ctx,
    );
    expect(evaluate(subResidual, { x: 10, y: 4 }, reevalCtx(ctx))).toBe(6);
  });

  // SKIPPED since the conservative repair (2026-10-16): the PE no longer
  // inlines user functions, so the residual still calls `dispatch` and the
  // first Futamura projection demo cannot specialise. Restored by the later
  // arc (workstreams/partial-evaluator-substrate/notes/
  // 2026-10-16-callback-fold-admission-plan.md, superseded revision 2).
  it.skip("compiles the specialised residual to JS via CompileJs (Futamura projection)", () => {
    // Same dispatcher.
    const dispatch = userFn("dispatch", ["op", "x", "y"], {
      match: [
        { var: "op" },
        "add",
        { add: [{ var: "x" }, { var: "y" }] },
        "sub",
        { sub: [{ var: "x" }, { var: "y" }] },
        0,
      ],
    });
    const ctx = ctxWithFns(dispatch);

    // Specialise to "add".
    const residual = partialEval(
      { call: ["dispatch", "add", { var: "x" }, { var: "y" }] },
      {},
      ctx,
    );

    // Compile the residual as a function of (x, y).
    const source: CompileSource = {
      name: "addSpecialised",
      params: positionalCompileFieldSlots(["x", "y"]),
      body: residual,
      requires: [],
    };
    const compiled = compileFenelToJsNative(source);
    expect(compiled.$tag).toBe("Ok");
    if (compiled.$tag !== "Ok") return;
    const serialised = dispatchedSerializeJsModule(compiled._0);
    expect(serialised.$tag).toBe("Ok");
    if (serialised.$tag !== "Ok") return;

    // Eval the JS and verify it computes x + y directly — no match, no
    // interpreter loop.
    // eslint-disable-next-line @typescript-eslint/no-implied-eval, no-new-func
    const fn = new Function("$fenel", `return ${serialised._0};`)($fenelRuntime) as (
      x: unknown,
      y: unknown,
    ) => unknown;
    expect(fn(5, 3)).toBe(8);
    expect(fn(10, 20)).toBe(30);
    // The compiled source should contain the literal `+` operator — not a
    // match construct, not a call to dispatch. The interpreter has been
    // *compiled away* via the Futamura projection.
    expect(serialised._0).toContain("+");
    expect(serialised._0).not.toContain("match");
    expect(serialised._0).not.toContain("dispatch");
  });
});

// ---------------------------------------------------------------------------
// 8. JitEvaluator round-trip
// ---------------------------------------------------------------------------

describe("JitEvaluator — round-trip equivalence to EagerEvaluator", () => {
  it("produces the same value as EagerEvaluator for primitive expressions", () => {
    const cases: unknown[] = [42, "hello", true, null, { "+": [2, 3] }, { mul: [4, 5] }];
    for (const c of cases) {
      const jit = jitEvalNative(c);
      const eager = eagerEvalNative(c);
      expect(jit.$tag).toBe("Ok");
      expect(eager.$tag).toBe("Ok");
      if (jit.$tag === "Ok" && eager.$tag === "Ok") {
        expect(jit._0).toEqual(eager._0);
      }
    }
  });

  it("refuses (Err) a known-inputs record as a caller frame instead of a wrong Ok", () => {
    const expr = { "+": [{ var: "x" }, 1] };
    const known = { x: 10 };
    const ctx = { _known: known } as EvaluateContext;
    const jit = jitEvalNative(expr, ctx);
    // Eager doesn't read `_known`; supply it as data via a let-wrapper
    // or call eagerEvalNative with a ctx that pre-substitutes — simplest
    // is to just evaluate normally with `x` in data.
    const direct = evaluate(expr, known);
    // Conservative repair, Astra round 5 (2026-10-17): knowns arrive in a
    // caller-supplied record, which the JIT cannot certify (a Proxy or private
    // constructor state passes any own-key check), so a residual is refused
    // with an honest Err instead of compiled.
    expect(direct).toBe(11);
    expect(jit.$tag).toBe("Err");
  });

  it("compiles-and-execs the residual when PE leaves one", () => {
    // PE leaves a residual `{add: [{var: "x"}, 1]}`; with x unbound,
    // the JIT's compile-and-exec path tries to run JS that references
    // an undefined `x` → throws → surfaces as Err.
    const r = jitEvalNative({ "+": [{ var: "x" }, 1] });
    // Should be Err — the residual has a free var.
    expect(r.$tag).toBe("Err");
  });
});

// ---------------------------------------------------------------------------
// 9. Registry presence
// ---------------------------------------------------------------------------

describe("PartialEvaluator + JitEvaluator — registry presence", () => {
  it("PartialEvaluator + JitEvaluator are registered in the system typeclass registry", async () => {
    const { dispatchRegistry } = await import("./system-entities");
    const instances = dispatchRegistry.listInstances("Evaluator");
    const strategyNames = instances.map((i) => i.args[0]);
    expect(strategyNames).toContain("EagerStrategy");
    expect(strategyNames).toContain("LazyStrategy");
    expect(strategyNames).toContain("PartialStrategy");
    expect(strategyNames).toContain("JitStrategy");
  });
});
