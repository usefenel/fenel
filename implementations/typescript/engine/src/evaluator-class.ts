// ---------------------------------------------------------------------------
// Evaluator — the typeclass that turns Expressions into Values
//
// Phase 6 of the implementation roadmap, Instance 7 of the meta-pattern from
// `design/structural-introspection.md`. The shape:
//
//   class Evaluator strategy where
//     eval : Expression -> Context -> Result EvalError Value
//
//   instances:
//     EagerEvaluator      : Evaluator EagerStrategy   — call-by-value (today's default)
//     LazyEvaluator       : Evaluator LazyStrategy    — call-by-name (POC)
//     PartialEvaluator    : Evaluator PartialStrategy — symbolic / Futamura specialiser
//     JitEvaluator        : Evaluator JitStrategy     — PartialEvaluator ∘ CompileJs ∘ exec
//     -- later phases:
//     StreamingEvaluator
//     ParallelEvaluator
//     CachedEvaluator
//     TracedEvaluator
//
// The Fenel-distinctive thing: evaluation strategy is a *separate dispatched
// concern*, not a property baked into the language or each function. The
// same Expression value can be evaluated eagerly, lazily, symbolically, in
// parallel — by registering different `Evaluator strategy` instances and
// switching the scoped default. Per-scope dispatch (block / tag / global)
// means a single file can introduce a local lazy evaluator without touching
// anything else. This dissolves the lazy-vs-eager debates: it's a
// typeclass-dispatched instance, not a language-level decision.
//
// Phase 6 ships the substrate as additive: today's `evaluate` function in
// json-logic.ts continues to be the direct-call path; the EagerEvaluator
// instance wraps it as the typeclass-dispatched form, and the LazyEvaluator
// instance proves a non-default strategy can co-exist. Migrating every
// existing `import { evaluate }` call site to typeclass dispatch is
// mechanical follow-on work — not in scope for Phase 6.
// ---------------------------------------------------------------------------

import type { FenelType, FieldDef, Interface } from "./types";
import { Result, functionRefHandle } from "./type-foundation";
import {
  evaluate,
  installDispatchedEvaluator,
  type EvaluateContext,
  type TypeclassDictFrame,
} from "./json-logic";

// ---------------------------------------------------------------------------
// EvalError — structured failure shape returned by `eval`
//
// Today's `evaluate` returns `unknown` and throws on internal errors / mostly
// silently coerces on shape mismatches. The typeclass discipline forces the
// error path to be structured: every failure is a typed value the caller
// can pattern-match on.
//
// Phase 6 keeps the variant set tight; later phases extend it as the typed
// evaluator surfaces more diagnostic paths (e.g. `ArityMismatch`,
// `BudgetExceeded`, `EffectNotInScope`).
//
//   UnboundVariable    — `{var: "name"}` resolves to no binding in the
//                        current data context. Pre-Phase-6 evaluate()
//                        returns `null` or the supplied fallback; this
//                        variant exposes the failure as a typed `Err`.
//   TypeMismatch       — an operator received a value of the wrong shape
//                        (e.g. arithmetic on a non-number). Placeholder
//                        today; today's evaluator mostly silently coerces.
//                        Wired up incrementally as call sites adopt the
//                        typed surface.
//   UnsupportedOp      — the rule contains a JSON-Logic op the evaluator
//                        doesn't recognise.
//   InternalError      — invariant violation in the evaluator itself —
//                        the kind of failure today's `evaluate` would
//                        throw on. Wrapping it as a typed value keeps the
//                        caller in monadic-Result world.
// ---------------------------------------------------------------------------

export type EvalError =
  | { readonly $tag: "UnboundVariable"; readonly name: string }
  | { readonly $tag: "TypeMismatch"; readonly expected: string; readonly got: string }
  | { readonly $tag: "UnsupportedOp"; readonly op: string }
  | { readonly $tag: "BudgetExceeded"; readonly budget: number; readonly detail: string }
  | { readonly $tag: "InternalError"; readonly message: string };

export function evalErrorUnbound(name: string): EvalError {
  return { $tag: "UnboundVariable", name };
}

export function evalErrorTypeMismatch(expected: string, got: string): EvalError {
  return { $tag: "TypeMismatch", expected, got };
}

export function evalErrorUnsupportedOp(op: string): EvalError {
  return { $tag: "UnsupportedOp", op };
}

export function evalErrorBudget(budget: number, detail: string): EvalError {
  return { $tag: "BudgetExceeded", budget, detail };
}

export function evalErrorInternal(message: string): EvalError {
  return { $tag: "InternalError", message };
}

// ---------------------------------------------------------------------------
// EvalResult — the typed Result alias every Evaluator instance returns.
//
// Matches the Fenel-side `Result EvalError Value` shape so the output flows
// through evaluator dispatch + pattern matching without reshaping. Identical
// posture to `CompileResult` in compilable.ts and `ProposeOutcome` in
// modules/prover.ts.
// ---------------------------------------------------------------------------

export type EvalResult =
  | { readonly $tag: "Ok"; readonly _0: unknown }
  | { readonly $tag: "Err"; readonly _0: EvalError };

export function evalOk(value: unknown): EvalResult {
  return { $tag: "Ok", _0: value };
}

export function evalErr(error: EvalError): EvalResult {
  return { $tag: "Err", _0: error };
}

// ---------------------------------------------------------------------------
// Strategy markers — opaque tokens that identify each Evaluator instance
//
// The instances are keyed by plain type-name strings in args[0] (the same
// posture as `CompileJs`, keyed "JsModule"). The strategy markers below are
// exported so callers / tests can reference them symbolically rather than
// stringly. Future phases may evolve these into typed entities once the
// strategy taxonomy stabilises.
// ---------------------------------------------------------------------------

export const EAGER_STRATEGY = "EagerStrategy" as const;
export const LAZY_STRATEGY = "LazyStrategy" as const;
export const PARTIAL_STRATEGY = "PartialStrategy" as const;
export const JIT_STRATEGY = "JitStrategy" as const;

export type EvalStrategy =
  | typeof EAGER_STRATEGY
  | typeof LAZY_STRATEGY
  | typeof PARTIAL_STRATEGY
  | typeof JIT_STRATEGY;

// ---------------------------------------------------------------------------
// ResidualExpression — what `PartialEvaluator.eval` returns under Option A
//
// Phase 7 keeps the typeclass signature uniform: every `Evaluator strategy`
// instance returns `Result EvalError Value`. The PartialEvaluator's "value"
// channel carries a residual expression — a JSON-Logic AST that any
// downstream evaluator can keep reducing when more inputs become known.
//
// Three shapes flow through `EvalResult.value` for the partial strategy:
//
//   1. **Concrete values** — primitives, records, tagged variants pass
//      through unchanged. `partialEval({+: [1, 2]}, {})` returns `Ok 3`.
//      These are values the evaluator could fully reduce.
//   2. **Residual AST** — a JSON-Logic expression with unreduced sub-terms.
//      `partialEval({+: [{var: "x"}, 1]}, {})` returns `Ok {…residual…}`.
//      Distinguishing "residual" from "data that happens to look like AST"
//      is the consumer's job — most consumers know whether they're reading
//      an output of the partial path. For consumers that need an explicit
//      marker, the `{$residual: …}` wrapper below is a structural sentinel.
//   3. **Partial application sentinel** — when a user function has had
//      some of its parameters bound (β-reduction over the known args) but
//      others remain unknown, the result is a `FenelPartial`-shaped value
//      (compatible with `invokeFunction`'s partial-app handling) so a
//      downstream evaluator can apply more args later.
//
// The `{$residual: …}` wrapper is exposed for callers that explicitly need
// to mark a sub-term as "this is unreduced AST, not data". The Phase 7
// implementation uses bare residual shapes (the JSON-Logic AST flows
// through unchanged) and only emits the wrapper at the result boundary
// when the top-level reduction couldn't proceed past the input shape.
//
//   {$residual: <expr>}                  — explicit unreduced-AST marker
//   {$partial: {fnId, collected,         — sentinel-compatible partial app
//               missing, arity}}           (carries the original args so
//                                          the JS-target codec / further
//                                          partial evals can pick up).
// ---------------------------------------------------------------------------

export type ResidualMarker = { readonly $residual: unknown };

export function isResidualMarker(value: unknown): value is ResidualMarker {
  return (
    typeof value === "object" &&
    value !== null &&
    !Array.isArray(value) &&
    "$residual" in (value as object)
  );
}

export function residualMarker(expr: unknown): ResidualMarker {
  return { $residual: expr };
}

export type PartialApplicationMarker = {
  readonly $partial: {
    readonly fnId: string;
    readonly knownArgs: ReadonlyArray<unknown>;
    readonly missingParams: ReadonlyArray<string>;
    readonly arity: number;
  };
};

export function isPartialApplicationMarker(
  value: unknown,
): value is PartialApplicationMarker {
  return (
    typeof value === "object" &&
    value !== null &&
    !Array.isArray(value) &&
    "$partial" in (value as object)
  );
}

export function partialApplicationMarker(
  fnId: string,
  knownArgs: ReadonlyArray<unknown>,
  missingParams: ReadonlyArray<string>,
  arity: number,
): PartialApplicationMarker {
  return { $partial: { fnId, knownArgs, missingParams, arity } };
}

// ---------------------------------------------------------------------------
// Evaluator typeclass declaration
//
// One method `eval : (Expression, EvaluateContext) -> Result EvalError Value`.
// The field holds the strategy function itself: a `.fenel` instance writes
// `eval = evaluatorStrategies.eagerEval`, loaded as the reference
// `{$ref: "evaluatorStrategies.eagerEval"}` (modules-as-values Phase 2b); the
// strategy wrapper below resolves it to the canonical id its natives are keyed
// by. The runtime resolves `{call: [{var: "eval"}, expr, ctx]}` via the
// registry, threading the per-strategy instance dispatch through the same
// primitive every other typeclass uses.
//
// Per `design/structural-introspection.md` Instance 7:
//
//   "Multiple evaluators coexist in scope, and each evaluation strategy
//    can carry its own epistemic-status output. A `TracedEvaluator`
//    produces both a value and a trace; a `SymbolicEvaluator` produces a
//    residual expression with proven equivalence to the original; a
//    `ProbabilisticEvaluator` produces a distribution over values, not a
//    point. Evaluation outcome shape becomes typeclass-dispatched."
//
// Phase 8 — `partial-evaluator-soundness` law promoted from Phase 7's
// sample-tested round-trip suite to a Forall proposition the law-validator
// iterates and the kernel re-checks via SampleTestResult. The law is
// scoped to the PartialStrategy instance through a property-side guard
// (`{eq: [{var: "eval"}, "evaluator-strategies:partialEval"]}`); non-PE
// instances vacuously satisfy the law (different strategies have their
// own semantic stories — Eager's faithfulness to the direct evaluator,
// Lazy's call-by-name divergence under non-terminating arguments — none
// of which the soundness identity below addresses).
//
// The semantic law is the partial-eval correctness identity:
//
//   evaluate(partialEval(e, ctx1), ctx2) ≡ evaluate(e, ctx1 ∪ ctx2)
//
// "PE doesn't change what the program computes, only when in the pipeline
// the computation happens." Per-case checks dispatch through
// `prover:partialEvaluatorSoundnessCheck`.
// ---------------------------------------------------------------------------

// The `eval` method's type, written out as data exactly as the `.fenel`
// declaration (`fenel/std/interfaces.fenel`) parses: two positional
// parameters, and `Result EvalError Value` inlined as the variant the parser
// emits. Pinned against `seedFromType` of that declaration in
// `modules-as-values-phase-2b.test.ts`.
const NO_LABEL = { $tag: "Nothing" } as const;
const EXPRESSION_ARG: FieldDef = {
  name: "_0",
  key: { $tag: "PositionalField", index: 0 },
  label: NO_LABEL,
  type: { $ref: "Expression" },
  ui: NO_LABEL,
  meta: {},
};
const EVALUATE_CONTEXT_ARG: FieldDef = {
  name: "_1",
  key: { $tag: "PositionalField", index: 1 },
  label: NO_LABEL,
  type: { $ref: "EvaluateContext" },
  ui: NO_LABEL,
  meta: {},
};
const RESULT_EVAL_ERROR_VALUE: FenelType = {
  $variant: {
    cases: [
      {
        name: "Err",
        label: NO_LABEL,
        fields: [{ name: "_0", key: { $tag: "PositionalField", index: 0 }, label: NO_LABEL, type: { $ref: "EvalError" }, meta: {}, ui: NO_LABEL }],
      },
      {
        name: "Ok",
        label: NO_LABEL,
        fields: [{ name: "_0", key: { $tag: "PositionalField", index: 0 }, label: NO_LABEL, type: { $ref: "Value" }, meta: {}, ui: NO_LABEL }],
      },
    ],
  },
};

export const evaluator: Interface = {
  name: "Evaluator",
  description:
    "Evaluation strategies for Fenel expressions. Each instance is one strategy (EagerStrategy / LazyStrategy / PartialStrategy / JitStrategy / future TracedStrategy / …); `eval : (Expression, EvaluateContext) -> Result EvalError Value` interprets a JSON-Logic AST under that strategy. Per-scope dispatch (block / tag / global) lets a single `.fenel` file introduce a different evaluator for a sub-computation. PartialEvaluator returns a residual expression in the value channel; composing it with `Compilable.compile` derives the Futamura projection — a compiler from the interpreter, no bespoke JIT infrastructure. See `design/structural-introspection.md` Instance 7.",
  params: [{ name: "strategy" }],
  methods: [
    {
      name: "eval",
      description:
        "The strategy function, `(Expression, EvaluateContext) -> Result EvalError Value`. The implementation may wrap the engine's native `evaluate` (EagerEvaluator), thunk every sub-expression and force on demand (LazyEvaluator), symbolically evaluate to a residual expression (PartialEvaluator), or PE+compile+exec (JitEvaluator). Errors are structured EvalError values, not thrown exceptions — callers stay in monadic-Result world.",
      params: [EXPRESSION_ARG, EVALUATE_CONTEXT_ARG],
      returns: RESULT_EVAL_ERROR_VALUE,
    },
  ],
  laws: [
    {
      name: "partial-evaluator-soundness",
      description:
        "PartialEvaluator soundness: `evaluate(partialEval(e, ctx1), ctx2) ≡ evaluate(e, ctx1 ∪ ctx2)` — partially-evaluating an expression under known inputs and then evaluating the residual under additional inputs is observationally identical to evaluating the original expression under the combined context. Phase 8 promotes this from Phase 7's sample-tested coverage to a kernel-verified Forall (sample-tested). Scoped via a property-side guard to the `evaluator-strategies:partialEval` instance — other strategies' soundness stories are different laws (EagerEvaluator's faithfulness, LazyEvaluator's call-by-name semantics) and vacuously satisfy this one.",
      forall: [
        {
          name: "case",
          samples: [
            // Bound var, supplied via ctx1
            { expr: { var: "x" }, ctx1: { x: 5 }, ctx2: {} },
            // Bound var, supplied via ctx2 (residual references ctx2)
            { expr: { var: "x" }, ctx1: {}, ctx2: { x: 7 } },
            // Arithmetic, fully known via ctx1
            { expr: { "+": [{ var: "x" }, 1] }, ctx1: { x: 5 }, ctx2: {} },
            // Arithmetic, partly known via ctx1, completed via ctx2
            { expr: { "+": [{ var: "x" }, { var: "y" }] }, ctx1: { x: 5 }, ctx2: { y: 3 } },
            // Multiplication via ctx2 only
            { expr: { "*": [{ var: "x" }, 3] }, ctx1: {}, ctx2: { x: 4 } },
            // Nested with both contexts
            {
              expr: { "*": [{ "+": [{ var: "x" }, 2] }, { var: "y" }] },
              ctx1: { x: 4 },
              ctx2: { y: 3 },
            },
            // if — known condition pruned during PE
            { expr: { if: [{ var: "flag" }, "yes", "no"] }, ctx1: { flag: true }, ctx2: {} },
            { expr: { if: [{ var: "flag" }, "yes", "no"] }, ctx1: { flag: false }, ctx2: {} },
            // if — unknown condition stays residual; ctx2 supplies it
            { expr: { if: [{ var: "flag" }, "yes", "no"] }, ctx1: {}, ctx2: { flag: true } },
            // Constant folding fully known via ctx1 — residual must be the value
            { expr: { add: [10, 20] }, ctx1: {}, ctx2: {} },
            // Mixed primitive-only constant folds work under both contexts
            { expr: { mul: [{ var: "x" }, 5] }, ctx1: { x: 6 }, ctx2: {} },
            // and / or short-circuit
            { expr: { and: [{ var: "p" }, { var: "q" }] }, ctx1: { p: true }, ctx2: { q: true } },
            { expr: { or: [{ var: "p" }, { var: "q" }] }, ctx1: { p: false }, ctx2: { q: true } },
            // Pure literal — PE returns the value unchanged
            { expr: 42, ctx1: {}, ctx2: {} },
            { expr: "hello", ctx1: {}, ctx2: {} },
          ],
        },
      ],
      // Property-side guard: only run the actual soundness check on the
      // PartialEvaluator instance. For other Evaluator instances the law
      // returns `true` (vacuous) — those strategies have their own
      // semantic laws (Eager faithfulness etc.) which don't intersect
      // with PE's correctness identity.
      property: {
        if: [
          { "===": [{ var: "eval" }, "evaluator-strategies:partialEval"] },
          {
            deepEq: [
              { call: ["prover:partialEvaluatorSoundnessCheck", { var: "case" }] },
              { $tag: "Just", _0: true },
            ],
          },
          true,
        ],
      },
    },
  ],
};

export const evaluatorTypeclasses: Interface[] = [evaluator];

// ---------------------------------------------------------------------------
// resolveEvaluator — Phase 11 dispatch helper
//
// Engine + runtime call sites previously imported `evaluate` directly. Phase
// 11 routes them through `resolveEvaluator(ctx)`, which walks the dispatch
// precedence (block-scope `_dictStack` → tag-scope `_activeTags` → global
// registry / eager fallback) and returns a callable matching `evaluate`'s
// 3-arg signature `(rule, data?, ctx?) => unknown`.
//
// Fast path: when no `Evaluator` instance is in scope (the default), returns
// `evaluate` directly — zero overhead, byte-identical behavior. Engine call
// sites that don't opt into a strategy continue to behave exactly as
// pre-Phase-11.
//
// When an `Evaluator strategy` frame IS in scope, the resolver returns a
// wrapper that:
//   1. Pops the matched frame from the dictStack — any recursive
//      `resolveEvaluator(ctx)` inside the strategy's body sees the outer
//      scope (algebraic-effect-handler discipline).
//   2. Parks the caller's `data` into `ctx._localData` so the strategy
//      native can pick it up when it recurses into `evaluate(rule, data,
//      ctx)` for sub-expressions.
//   3. Invokes the strategy's `eval` method (registry / native dispatch)
//      and unwraps the EvalResult — Ok values pass through, Err values
//      throw so existing try/catch in callers surfaces the failure.
//
// User surface: a `.fenel` file writes `lazy { ... }` / `eager { ... }` /
// `partial { ... }` / `jit { ... }` blocks; the parser emits the
// corresponding `{withInstance: [{typeName: "Evaluator", args: [strategy], …},
// inner]}` op, which pushes the frame onto the dictStack while the inner
// body evaluates.
// ---------------------------------------------------------------------------

/** Engine-side evaluator callable — matches `evaluate`'s signature so
 *  dispatched and direct call sites share a calling convention. */
export type EngineEvaluator = (
  rule: unknown,
  data?: Record<string, unknown>,
  ctx?: EvaluateContext,
) => unknown;

/**
 * Resolve the in-scope Evaluator strategy and return a callable. Walks
 * `ctx._dictStack` innermost-first for an `Evaluator` frame; falls through
 * to today's `evaluate` (eager) when no override is in scope.
 *
 * Today only the four built-in strategies (Eager / Lazy / Partial / Jit)
 * exist. Tag-scoped Evaluator instances aren't built-in; if a future phase
 * registers one with `{kind: "tag", tag: T}` scope and `T` is in
 * `ctx._activeTags`, the resolver would consult it before falling through.
 * Phase 11 leaves the tag-scope path as the same eager fallback because
 * the engine registers no tag-scoped Evaluator instances.
 */
export function resolveEvaluator(ctx?: EvaluateContext): EngineEvaluator {
  const stack = ctx?._dictStack;
  if (!stack || stack.length === 0) return evaluate;
  for (let i = stack.length - 1; i >= 0; i--) {
    const f = stack[i]!;
    if (f.typeName !== "Evaluator") continue;
    if (f.args[0] === EAGER_STRATEGY) return evaluate;
    return makeStrategyWrapper(f, stack.slice(0, i));
  }
  return evaluate;
}

/**
 * Wrap a non-eager Evaluator frame as an `EngineEvaluator`. The strategy's
 * `eval` method is dispatched through the ctx's natives table (the fast
 * path used by every built-in strategy) or through the function registry
 * (slower, only hit by user-defined strategy bodies). The result is a
 * typed `EvalResult` — `Ok value` passes through; `Err error` throws.
 *
 * `outerStack` is the dictStack with the matched frame stripped — the
 * strategy is invoked under the OUTER scope, so its body's own
 * `resolveEvaluator(ctx)` resolves the next-innermost handler (the
 * standard algebraic-effect-handler discipline). Without this, a lazy
 * strategy whose body internally re-resolves would infinite-loop on
 * itself.
 */
function makeStrategyWrapper(
  frame: TypeclassDictFrame,
  outerStack: TypeclassDictFrame[],
): EngineEvaluator {
  const methodValue = (frame.methods as Record<string, unknown>)["eval"];
  return (rule, data, ctx) => {
    const innerCtx: EvaluateContext = {
      ...(ctx ?? {}),
      _dictStack: outerStack,
      // signature-substrate slice 3d-D3 — PRESENCE, not emptiness.
      //
      // This read used to test the caller's data for EMPTINESS (a key-count
      // probe) rather than for PRESENCE, which conflated an explicitly empty
      // scope with an absent one: a caller that deliberately passed `{}` to run
      // a rule under no bindings silently inherited the enclosing context's
      // stale ambient bindings instead, so a bare `{var: "x"}` inside could
      // resolve to an outer binding the caller had just cleared.
      //
      // Omission still inherits, and that is deliberate rather than an
      // oversight left in place: the wrapper's documented job (see the header
      // above) is to PARK the caller's data so the strategy native can pick it
      // up when it recurses, and a strategy that re-enters without restating
      // the scope means "carry on in the one I was given". Defaulting `data` to
      // `{}` here — matching `evaluate`'s own signature default — would ALSO
      // drop that re-entry case, which no defect motivates. The narrow repair
      // is the one that removes exactly the conflated case.
      _localData: data !== undefined ? data : ctx?._localData,
    };

    // The id to look up: the fnId string as written, or a `{$ref}` function
    // reference resolved to its canonical id first (see `strategyEvalFnId`).
    const evalFnId = strategyEvalFnId(methodValue, ctx);

    // Fast path: the eval method names a fnId and the ctx's natives map
    // (or ctx-aware natives map) carries the impl. Every built-in
    // strategy lands here — Eager (already short-circuited above), Lazy,
    // Partial, Jit.
    if (evalFnId !== undefined) {
      const ctxNatives = ctx?.nativesCtx as
        | Record<string, (ctx: EvaluateContext, ...args: unknown[]) => unknown>
        | undefined;
      const natives = ctx?.natives as
        | Record<string, (...args: unknown[]) => unknown>
        | undefined;
      if (ctxNatives && ctxNatives[evalFnId]) {
        return unwrapEvalResult(ctxNatives[evalFnId]!(innerCtx, rule));
      }
      if (natives && natives[evalFnId]) {
        return unwrapEvalResult(natives[evalFnId]!(rule, innerCtx));
      }
    }

    // Body-based fallback: the strategy is a user-defined Fenel function.
    // Dispatch through `evaluate({call: [methodValue, rule]}, …)` so the
    // registry lookup handles the call. The result is a typed EvalResult.
    const result = evaluate({ call: [evalFnId ?? methodValue, rule] }, data ?? {}, innerCtx);
    return unwrapEvalResult(result);
  };
}

/** The natives key an Evaluator frame's `eval` method names. A fnId string is
 *  used as written, exactly as before. A `{$ref: handle}` function reference
 *  (an own-data handle, `functionRefHandle`) is resolved through the ctx's
 *  registry to the function's canonical id, which is what the natives tables
 *  are keyed by. Without this a reference fell through to the body-based
 *  `{call: [ref, rule]}`, which evaluates `rule` as an eager argument, so a lazy
 *  or partial frame silently ran eager. A reference that resolves to no
 *  function throws (the wrapper's `Err` channel) before `rule` runs. Any other
 *  value is `undefined`: the body-based fallback, as before. */
function strategyEvalFnId(
  methodValue: unknown,
  ctx: EvaluateContext | undefined,
): string | undefined {
  if (typeof methodValue === "string") return methodValue;
  const handle = functionRefHandle(methodValue);
  if (handle === undefined) return undefined;
  const canonical = ctx?.getFunction?.(handle)?.id;
  if (typeof canonical !== "string" || canonical.length === 0) {
    throw new Error(
      `Evaluator: InternalError: eval method reference "${handle}" resolves to no function`,
    );
  }
  return canonical;
}

/** Pull the inner value out of an `Ok` result; throw on `Err`. Returns the
 *  raw value when the result isn't tagged (defensive — strategy natives
 *  may produce a bare value in degenerate cases). */
function unwrapEvalResult(result: unknown): unknown {
  if (result && typeof result === "object" && "$tag" in result) {
    const tagged = result as { $tag: string; _0?: unknown };
    if (tagged.$tag === "Ok") return tagged._0;
    if (tagged.$tag === "Err") {
      const err = tagged._0 as { $tag?: string; [k: string]: unknown } | undefined;
      const detail =
        (err && (err.message as string | undefined)) ??
        (err && (err.name as string | undefined)) ??
        (err && (err.op as string | undefined)) ??
        "";
      throw new Error(
        `Evaluator: ${err?.$tag ?? "EvalError"}${detail ? `: ${detail}` : ""}`,
      );
    }
  }
  return result;
}

// Install the dispatched evaluator hook into json-logic.ts so the
// `withInstance` op routes body evaluation through `resolveEvaluator(ctx)`.
// Without this, a `lazy { ... }` block would push the LazyStrategy frame onto
// the dictStack but the body would still run through the legacy direct
// `evaluate` — no lazy semantics would apply. The hook makes the
// strategy effective for the whole body, which is the user-facing
// contract from the Phase 11 brief.
installDispatchedEvaluator((rule, data, ctx) =>
  resolveEvaluator(ctx)(rule, data, ctx),
);

// Suppress lint warnings for re-exports kept available to downstream
// consumers without forcing a deeper import path.
void Result;
