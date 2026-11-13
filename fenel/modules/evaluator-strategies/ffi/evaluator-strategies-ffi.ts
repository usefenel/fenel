// ---------------------------------------------------------------------------
// Evaluator strategies — FFI leaf (the irreducible host bridges: the four
// evaluation strategies that re-enter the engine evaluator / partial-evaluator
// / compile-js pipeline, plus BOTH native maps in the both-maps-fallback shape).
//
// module-substrate Phase 3h — evaluator-strategies is the representative of the
// LAST unproven native-tier axis: the BOTH-MAPS-FALLBACK. `time` (3b) + `codec`
// (3d) proved the plain `nativeImpls` split; `picture` (3f) + the media cluster
// (3g) proved the ctx tier with a clean DISJOINT plain/ctx split. None forced a
// fnId into BOTH maps. evaluator-strategies does: every one of the four fnIds
// (eagerEval / lazyEval / partialEval / jitEval) is dual-registered —
//   - PLAIN map (`evaluatorNatives`) — calls `*Native(expr, ctx = undefined)`;
//   - CTX  map (`evaluatorNativesCtx`) — calls `*Native(ctx, expr)` with the
//     real `EvaluateContext`.
// Both forward to the SAME underlying impl. At `applyOp` `ctx.nativesCtx`
// strictly wins (json-logic.ts) — so the plain copy is dispatch-DEAD on that
// path. It is nonetheless LOAD-BEARING: `evaluator-dispatch.test.ts` builds its
// plain `natives` map directly from the re-exported `evaluatorNatives`
// (`rekeyNativesById(evaluatorNatives, "evaluator-strategies")`), a direct
// reader OUTSIDE `applyOp`. So the migration PRESERVES both maps byte-for-byte
// (parity-safe default; the brief's bet confirmed by grep). Which map an impl
// lands in (here, both) is the ONLY thing that decides plain-vs-ctx — the
// @native foreign decl in types.fenel is uniform, NO `@nativeCtx` marker.
//
// AXIS (brief axis #2) — this leaf imports `evaluate` + `EvaluateContext` from
// json-logic, the eval-result constructors from evaluator-class, and the
// dispatch bridges (partial-eval / compile-js / serialize) from
// engine-bodies-dispatch. partial-evaluator-substrate Phase 1R DELETED the TS
// `partial-evaluator.ts`; the PE now dispatches to the Fenel-bodied
// `engine:partialEvaluate` walker via `dispatchedPartialEvalInCtx` (the sole
// execution path, the 21.6.2 precedent). Same `fenel/ffi → engine` import edge
// picture opened; the 3b rootDir→repo-root build-wiring already makes it compile
// under `--noEmit`. At runtime the engine-seam → ffi-leaf → json-logic cycle is
// safe because `evaluate` / `invokeCallable`-equivalents are referenced at CALL
// time, not module-init.
//
// F-PERMANENT-REVISIT FLAG: the four `*EvalNative` impls are GENUINE bridge
// leaves — they re-enter the evaluator (and the dispatched PE walker /
// compile-js / `new Function`) to run user expressions + closures, which a
// `.fenel` body cannot do. But the
// pure helpers parked here for parity — `matchTopLevelCall` (single-key-object
// shape recognition), `firstUnboundVar` (a var-reference tree walk), and
// `JIT_FENEL_RUNTIME.concat` (string/list concat) — are PURE structural /
// arithmetic logic that compose from std fns. They are kept here to preserve
// Phase-3h PARITY (byte-for-byte), NOT because they belong at an ffi leaf; a
// Fenel re-port is a candidate for a later coordinated sweep (Fenel-first HARD
// RULE), but porting now would be the re-port the parity brief forbids.
//
// The content-gate (`ts-elimination-completion`) permits `.ts` under
// `fenel/modules/` ONLY inside an `ffi/` folder — this is the next such leaf
// (after time/ffi/ + codec/ffi/ + picture/ffi/ + the media cluster).
// ---------------------------------------------------------------------------

import {
  beginWhereProofFrame,
  endWhereProofFrame,
  evaluate,
  truthy,
  type EvaluateContext,
} from "../../../../implementations/typescript/engine/src/json-logic";
import { engineRequire } from "../../../../implementations/typescript/engine/src/engine-require";
import type { EvalResult } from "../../../../implementations/typescript/engine/src/evaluator-class";
import {
  evalOk,
  evalErr,
  evalErrorInternal,
  evalErrorBudget,
  evalErrorUnbound,
} from "../../../../implementations/typescript/engine/src/evaluator-class";
import { compileFenelToJsNative } from "../../../../implementations/typescript/engine/src/modules/compile-js";
import { functionRefHandle } from "../../../../implementations/typescript/engine/src/type-foundation";
import {
  dispatchedSerializeJsModule,
  dispatchedJsonLogicToExpr,
  dispatchedPartialEvalInCtx,
  harnessForTests,
} from "../../../../implementations/typescript/engine/src/engine-bodies-dispatch";
import type { CompileSource } from "../../../../implementations/typescript/engine/src/compilable";

// partial-evaluator-substrate Phase 1R — the TS `partial-evaluator.ts` was
// DELETED (the 21.6.2 precedent: the Fenel-bodied `engine:partialEvaluate`
// walker is the SOLE execution path, not a fallback). The two channels the
// retired module owned live here now: the recursive-inline depth budget default
// (read off the `PartialContext` extension of `EvaluateContext`) and the
// PE `_known` / `_partialBudget` extension fields, threaded through
// `dispatchedPartialEvalInCtx`.
type PartialContext = EvaluateContext & {
  /** Known variable bindings (the "static" channel of PE). */
  _known?: Record<string, unknown>;
  /** Recursive-inline depth budget. Default `DEFAULT_PE_BUDGET`. */
  _partialBudget?: number;
};

/** Default recursive-inlining depth budget for partial evaluation. */
const DEFAULT_PE_BUDGET = 8;

// ---------------------------------------------------------------------------
// EagerEvaluator — wraps the engine's native `evaluate` function.
//
// The native impl catches exceptions from `evaluate` and converts them to
// `Err InternalError`. The output is otherwise identical to the direct-call
// path — same JSON-Logic semantics, same operators, same call resolution.
//
// `UnboundVariable` detection: today's `evaluate` returns the var expression's
// fallback (default `null`) on unbound names — silent. We don't change that
// default (would break every existing caller); the structured-error variant is
// reserved for callers who opt in by setting `_strictUnbound: true` on the
// context, in which case `eagerEval` re-evaluates after a quick reference-walk.
// ---------------------------------------------------------------------------

function eagerEvalNative(rule: unknown, ctx?: EvaluateContext): EvalResult {
  const effectiveCtx = ctx ?? {};
  const localData = effectiveCtx._localData ?? {};
  // Strict-unbound mode: detect references to names not present in the
  // current data context before evaluating, so the structured error path
  // tests can assert UnboundVariable without depending on the legacy
  // silent-null behaviour. Disabled by default to preserve eager
  // faithfulness with the direct `evaluate` callers.
  if ((effectiveCtx as { _strictUnbound?: boolean })._strictUnbound) {
    const bound: Record<string, true> = {};
    for (const k of Object.keys(localData)) bound[k] = true;
    const unbound = firstUnboundVar(rule, bound);
    if (unbound !== null) return evalErr(evalErrorUnbound(unbound));
  }
  try {
    const result = evaluate(rule, localData, effectiveCtx);
    return evalOk(result);
  } catch (e) {
    const msg = (e as Error).message ?? String(e);
    return evalErr(evalErrorInternal(`EagerEvaluator: ${msg}`));
  }
}

// ---------------------------------------------------------------------------
// LazyEvaluator — call-by-name via Proxy-intercepted var lookups.
//
// Recognises `{call: [fnName, ...argExprs]}` (and the key-as-fnId form
// `{fnName: [...argExprs]}`) at the top level; binds each formal param to the
// unevaluated arg expression via a lazy data proxy; runs the body against the
// proxy. Each `{var: "paramName"}` reference inside the body triggers the proxy
// getter, which evaluates the arg expression fresh.
//
// Falls through to the eager path for any non-call expression — the contrast
// only matters at call boundaries.
// ---------------------------------------------------------------------------

function lazyEvalNative(rule: unknown, ctx?: EvaluateContext): EvalResult {
  const effectiveCtx = ctx ?? {};
  const localData = effectiveCtx._localData ?? {};
  const call = matchTopLevelCall(rule);
  if (call === null) {
    // Non-call shape — no lazy benefit; eager fallback. Same exception
    // discipline as eagerEval.
    try {
      return evalOk(evaluate(rule, localData, effectiveCtx));
    } catch (e) {
      const msg = (e as Error).message ?? String(e);
      return evalErr(evalErrorInternal(`LazyEvaluator: ${msg}`));
    }
  }
  const { fnName, argExprs } = call;
  const fn = effectiveCtx.getFunction?.(fnName);
  if (!fn || !fn.params || fn.body === undefined) {
    // Not a user function with a body — no lazy machinery applies; eager
    // fallback handles the resolution.
    try {
      return evalOk(evaluate(rule, localData, effectiveCtx));
    } catch (e) {
      const msg = (e as Error).message ?? String(e);
      return evalErr(evalErrorInternal(`LazyEvaluator: ${msg}`));
    }
  }
  // Build per-param thunks. The proxy getter forces the matching expression
  // on every access — call-by-name (not call-by-need; no memoisation).
  const params = fn.params;
  // PROTOTYPE-FREE, and every trap below tests OWN properties. With an ordinary
  // `{}` the traps answered `"__proto__" in thunks` and `"toString" in thunks`
  // with true and then "forced" `Object.prototype` / a host function as if it
  // were an argument expression — `__proto__` is a perfectly valid Fenel binder.
  // Same laundering `ownDataRead` exists to stop, one layer out.
  const thunks: Record<string, unknown> = Object.create(null);
  for (let i = 0; i < params.length; i++) {
    const p = params[i];
    if (!p) continue;
    const argExpr = i < argExprs.length ? argExprs[i] : undefined;
    Object.defineProperty(thunks, p.name, {
      value: argExpr, enumerable: true, configurable: true, writable: true,
    });
  }
  const bound = (prop: string): boolean => Object.prototype.hasOwnProperty.call(thunks, prop);
  // Re-evaluate the arg expression fresh on every access — call-by-name (not
  // call-by-need; no memoisation), against the CALLER's local data so a thunk
  // referencing an outer let-bound name resolves through the original binding.
  const force = (name: string): unknown => evaluate(thunks[name], localData, effectiveCtx);
  const lazyData = new Proxy(Object.create(null) as Record<string, unknown>, {
    get(_t, prop) {
      if (typeof prop !== "string") return undefined;
      return bound(prop) ? force(prop) : undefined;
    },
    has(_t, prop) {
      return typeof prop === "string" && bound(prop);
    },
    // The `get` trap ALONE is not enough. Every name-bearing evaluator surface
    // reads bindings through `ownDataRead`, which is
    // `Object.getOwnPropertyDescriptor` — a trap `get` does not answer
    // (json-logic.ts; the hardening that made `__proto__` and accessors
    // ordinary data). Without this trap the proxy reported EVERY lazy formal as
    // ABSENT, so a lazy body's `{var: p}` fell through to the bare-ident
    // registry projection and then the fallback `null`: call-by-name returned
    // null for an ordinary `42`, and the "unforced argument never fires"
    // guarantee held only VACUOUSLY, because no argument was reachable at all.
    // A live regression from that hardening, surfaced by signature-substrate
    // slice 3c-D1.
    //
    // `configurable: true` is MANDATORY — the invariant check rejects a
    // non-configurable descriptor for a property the (extensible, empty) target
    // does not have. Forcing here is correct: a descriptor read on this scope IS
    // a semantic read of that binding, and `ownDataRead` requires
    // `"value" in descriptor` precisely so accessors cannot launder behaviour
    // into a data read, so a data descriptor is the only shape it accepts.
    getOwnPropertyDescriptor(_t, prop) {
      if (typeof prop !== "string" || !bound(prop)) return undefined;
      return { value: force(prop), enumerable: true, configurable: true, writable: true };
    },
    // NO `ownKeys` TRAP — deliberately, and this is the interesting half.
    //
    // Adding one looks like the obvious completion (it would let
    // `copyOwnDataContext` carry the parameters into a `let` / `case` / closure
    // scope, which it currently cannot). It is WRONG: `Object.keys` on a proxy
    // calls `ownKeys` and THEN `getOwnPropertyDescriptor` per key to filter by
    // enumerability, and `copyOwnDataContext` then calls `ownDataRead` on each
    // name — so every scope copy would force every thunk TWICE. A lazy body
    // shaped `let … in …` would evaluate all of its arguments, an unused
    // throwing argument would throw, and an unused diverging one would diverge.
    // That is not call-by-name at all; it converts a scope-completeness bug into
    // a semantic one, which is strictly worse.
    //
    // So the remaining limitation is stated instead of papered over: a lazy body
    // that COPIES its scope sees an empty one and loses its parameters. That is
    // pre-existing, and it is NOT a found-bit observation — the binding is
    // genuinely absent from the copy, so the read answers the fallback
    // uniformly and leaks nothing about any value. Fixing it properly needs
    // branded thunk CELLS that a scope copy preserves unforced and only
    // semantic reads unwrap, i.e. a change to the scope-copy protocol in
    // json-logic.ts, not to this file.
  });
  try {
    const result = evaluate(fn.body, lazyData, effectiveCtx);
    return evalOk(result);
  } catch (e) {
    const msg = (e as Error).message ?? String(e);
    return evalErr(evalErrorInternal(`LazyEvaluator: ${msg}`));
  }
}

// ---------------------------------------------------------------------------
// Helpers (PURE — F-permanent FLAG above)
// ---------------------------------------------------------------------------

/** Recognise `{call: [fnName, ...args]}` or `{fnName: [...args]}` shape.
 *  Returns the parsed shape or null for anything else.
 *
 *  Non-trivial: a single-key object whose key is not a known JSON-Logic
 *  operator AND resolves through the registry is the key-as-fnId form.
 *  Without a context-aware check we conservatively recognise only the
 *  explicit `{call: …}` form here; the key-as-fnId form falls through to
 *  the eager path. Future tightening: pass the EvaluateContext into the
 *  recogniser so we can also accept `{add: […]}` for a user function `add`.
 */
function matchTopLevelCall(rule: unknown): { fnName: string; argExprs: unknown[] } | null {
  if (rule === null || typeof rule !== "object" || Array.isArray(rule)) return null;
  const obj = rule as Record<string, unknown>;
  const keys = Object.keys(obj);
  if (keys.length !== 1) return null;
  const key = keys[0]!;
  if (key === "call") {
    const args = obj["call"];
    if (!Array.isArray(args) || args.length === 0) return null;
    const fnName = args[0];
    if (typeof fnName !== "string") return null;
    return { fnName, argExprs: args.slice(1) };
  }
  return null;
}

/** Walk a JSON-Logic expression and return the name of the first `{var:
 *  "name"}` reference whose name doesn't appear in `bound`. Returns null if
 *  every var is bound. Used by EagerEvaluator's strict-unbound mode.
 *
 *  Conservative: scans the tree without descending into lambda bodies or
 *  case-arm patterns (which introduce their own bindings). For Phase 6's
 *  smoke test this is sufficient — the test uses a flat var reference, no
 *  shadowing.
 */
function firstUnboundVar(rule: unknown, bound: Record<string, true>): string | null {
  if (rule === null || rule === undefined) return null;
  if (typeof rule !== "object") return null;
  if (Array.isArray(rule)) {
    for (const child of rule) {
      const r = firstUnboundVar(child, bound);
      if (r !== null) return r;
    }
    return null;
  }
  const obj = rule as Record<string, unknown>;
  if ("var" in obj) {
    const v = obj["var"];
    const name = Array.isArray(v) ? v[0] : v;
    if (typeof name === "string" && name.length > 0 && !(name in bound)) {
      // Special handling for compound paths — only the head matters.
      const head = name.split(".")[0]!;
      if (!(head in bound)) return head;
    }
    return null;
  }
  for (const k of Object.keys(obj)) {
    const r = firstUnboundVar(obj[k], bound);
    if (r !== null) return r;
  }
  return null;
}

// ---------------------------------------------------------------------------
// PartialEvaluator — symbolic evaluation that returns a residual expression.
//
// Phase 1R flip: the core PE walker is now the Fenel-bodied
// `engine:partialEvaluate` (dispatched via `dispatchedPartialEvalInCtx`), NOT
// the deleted TS `partial-evaluator.ts`. This thin wrapper matches the
// typeclass-dispatch signature (rule, ctx) → EvalResult:
//   - reads "known inputs" (`ctx._known`) + the recursive-inline depth budget
//     (`ctx._partialBudget`, default 8) off the `PartialContext` extension;
//   - a NEGATIVE budget is the one error the walker can't express (it's total)
//     ⇒ `Err BudgetExceeded`, preserving the retired native's error surface
//     byte-for-byte;
//   - the caller ctx is threaded so `peEval` folds + `peFnSpec` introspection
//     resolve the caller's registered fns (the `extraFns` pattern generalized);
//   - the residual comes back ALREADY EGRESSED to JSON-Logic (the value channel
//     carries raw JSON-Logic — consumers `evaluate` it);
//   - the dispatch ingress is try/caught ⇒ `Err InternalError` parity (the
//     walker is total, but a marshal/lift throw must surface as a typed error).
// ---------------------------------------------------------------------------

function partialEvalForRegistry(
  rule: unknown,
  ctx?: EvaluateContext,
): EvalResult {
  const pctx = (ctx ?? {}) as PartialContext;
  const known = pctx._known ?? {};
  const budget = pctx._partialBudget ?? DEFAULT_PE_BUDGET;
  if (budget < 0) {
    return evalErr(evalErrorBudget(budget, "negative budget supplied to PartialEvaluator"));
  }
  try {
    const detailed = dispatchedPartialEvalInCtx(rule, known, budget, pctx);
    return evalOk(detailed.$tag === "Concrete" ? detailed.value : detailed.expr);
  } catch (e) {
    return evalErr(evalErrorInternal(`PartialEvaluator: ${(e as Error).message}`));
  }
}

// ---------------------------------------------------------------------------
// JitEvaluator — PartialEvaluator ∘ CompileJs ∘ exec.
//
// Partial-evaluate the input with the known bindings; if anything residual
// remains, compile the residual to JS via the `CompileJs` pipeline and run it
// via `new Function`. If PE already fully reduced the expression to a concrete
// value, the compile-and-exec round-trip is skipped and the value passes
// through directly — same observable behaviour as `EagerEvaluator` on that
// input. This is the smallest demonstration of the Futamura projection
// composition running end-to-end through the dispatch substrate; production-
// grade JIT (speculative deopt, inline caches, tiered compilation) is Phase 8+.
// ---------------------------------------------------------------------------

/**
 * Minimal `$fenel` runtime namespace the compiled JS expects. The JIT only
 * emits code that uses `$fenel.concat` (for string/list concat); other helpers
 * would surface here as additional fields. The JS-target test suite uses the
 * same shape — kept in sync via duplication for now. (PURE — F-permanent FLAG.)
 */
const JIT_FENEL_BASE_RUNTIME = {
  concat: (a: unknown, b: unknown): unknown => {
    if (Array.isArray(a) && Array.isArray(b)) return [...a, ...b];
    return String(a ?? "") + String(b ?? "");
  },
};

function jitEvalNative(rule: unknown, ctx?: EvaluateContext): EvalResult {
  const pctx = (ctx ?? {}) as PartialContext;
  const known = pctx._known ?? {};
  const budget = pctx._partialBudget ?? DEFAULT_PE_BUDGET;
  // Phase 1R flip: the detailed concrete-vs-residual surface comes from the
  // Fenel-bodied walker via `dispatchedPartialEvalInCtx` — a Residual carries
  // JSON-Logic already egressed, ready for the compile path.
  let detailed: ReturnType<typeof dispatchedPartialEvalInCtx>;
  try {
    detailed = dispatchedPartialEvalInCtx(rule, known, budget, pctx);
  } catch (e) {
    return evalErr(
      evalErrorInternal(`JitEvaluator: partial-eval failed: ${(e as Error).message}`),
    );
  }
  // Concrete reduction — short-circuit the compile-and-exec path.
  if (detailed.$tag === "Concrete") return evalOk(detailed.value);

  // Conservative repair (Astra rounds 4-5, tcb `pe.jit.admission`): the emitted
  // JS operators mean the HARNESS's std natives, so a residual compiles only
  // with NO caller frame or the EXACT harness. Any caller-supplied object is
  // refused, a plain-looking one included: own keys prove nothing (a Proxy, or
  // private constructor state attached to a `{}`), so knowns passed in a
  // caller record cannot reach a compiled residual (Err).
  if (ctx !== undefined && ctx !== harnessForTests().ctx) {
    return evalErr(evalErrorInternal("JitEvaluator: a caller frame may give the compiled operators other meanings"));
  }

  // Residual — compile as a no-param function and execute.
  const source: CompileSource = {
    // This exact name selects the JIT admission in engine:emitJs (emit-js.fenel,
    // conservative PE repair 2026-10-16): inexact operator lowerings answer Err.
    name: "jitResidual",
    params: [],
    body: detailed.expr,
    requires: [],
  };
  const compiled = compileFenelToJsNative(source);
  if (compiled.$tag === "Err") {
    return evalErr(
      evalErrorInternal(
        `JitEvaluator: compile failed: ${JSON.stringify(compiled._0)}`,
      ),
    );
  }
  const serialized = dispatchedSerializeJsModule(compiled._0);
  if (serialized.$tag === "Err") {
    return evalErr(
      evalErrorInternal(`JitEvaluator: serialize failed: ${serialized._0}`),
    );
  }
  try {
    // A2: publish existing callbacks at execution time, after module loading.
    const { stdModule } = engineRequire("modules/std") as typeof import("../../../../implementations/typescript/engine/src/modules/std");
    const and = stdModule.nativeImpls?.["std:and"];
    const or = stdModule.nativeImpls?.["std:or"];
    if (typeof and !== "function" || typeof or !== "function") throw new Error("compiled Boolean runtime unavailable");
    const JIT_FENEL_RUNTIME = { ...JIT_FENEL_BASE_RUNTIME, $structuralTruthy: truthy, and, or, "std:and": and, "std:or": or };
    // eslint-disable-next-line @typescript-eslint/no-implied-eval, no-new-func
    const fn = new Function(
      "$fenel",
      `return ${serialized._0};`,
    )(JIT_FENEL_RUNTIME) as (...args: unknown[]) => unknown;
    return evalOk(fn());
  } catch (e) {
    return evalErr(
      evalErrorInternal(`JitEvaluator: exec failed: ${(e as Error).message}`),
    );
  }
}

// ---------------------------------------------------------------------------
// evalApply — expr-substrate Phase 8 apply seam (CTX-ONLY).
//
// The explicit-strategy entry `engine:evaluateWith strategy expr` does the
// DISPATCH in `.fenel` (resolve the `Evaluator <strategy>` instance via
// `dispatchLookupOne`, read its `.eval` fnId); this native is the irreducible
// final step — invoke the resolved eval ctx-native on `expr`, threading the
// live `EvaluateContext`, and return its `EvalResult` verbatim.
//
// Why native: a `.fenel` body cannot author the direct `ctx.nativesCtx[fnId](ctx,
// expr)` call — `EvaluateContext` is not a Fenel value, AND routing through the
// generic `{call:[fnId, expr]}` path trips json-logic.ts's arity-partial check
// (the `*Eval` foreign decls declare 2 params — expression + the ctx-threaded
// context — so a single explicit `expr` arg returns a `FenelPartial`). This
// mirrors `makeStrategyWrapper` in evaluator-class.ts, which bypasses
// `invokeFunction` for the identical reason. It is the SAME irreducible
// host-evaluator-re-entry category as the four `*Eval` natives above.
//
// Resolution order mirrors makeStrategyWrapper: ctx-natives (every built-in
// strategy lands here) → plain natives → registry-call fallback (user-defined
// Fenel-body strategies — none ship today). On a missing impl, returns an
// `Err InternalError` rather than throwing, so the explicit entry surfaces a
// clean typed error (e.g. an unknown / unwired strategy).
// ---------------------------------------------------------------------------

// ---------------------------------------------------------------------------
// peEval — partial-evaluator-substrate Phase 1 const-fold seam (CTX-ONLY).
//
// The Fenel-bodied `engine:partialEvaluate` walker decides fold-readiness (all
// leaves concrete-or-ELambda) and egresses the rebuilt call/construct tree via
// `exprToJsonLogic`; this native is the irreducible final step — re-enter the
// host `evaluate` on the rendered JSON-Logic (empty data context, live ctx for
// user-function dispatch), wrapping the outcome in a `Result String a`:
// `Ok foldedValue` on success, `Err message` on a host throw (the walker's
// fall-to-residual signal). NATIVE because a `.fenel` body cannot re-enter the
// interpreter — the SAME irreducible host-evaluator re-entry category as the
// four `*Eval` natives + `evalApply` (ledgered, `design/ts-exceptions-ledger.md`).
// Folds higher-order calls for free: an egressed `{fn:…}` becomes a host closure.
// ---------------------------------------------------------------------------

// Conservative repair (Rom 2026-10-16): the fold runs in its OWN where-proof
// frame, the innermost consumer of any no-value exit or door-crossing throw
// inside it, so a fold that fails (e.g. in a branch ordinary evaluation never
// takes) answers `Err` and cannot trip an enclosing proof. Frame semantics are
// unchanged; this only refuses.
function peEvalNative(ctx: EvaluateContext, jl: unknown): unknown {
  const frame = beginWhereProofFrame();
  try {
    const value = evaluate(jl, {}, ctx);
    if (frame.tripped) return { $tag: "Err", _0: "peEval: no value" };
    return { $tag: "Ok", _0: value };
  } catch (e) {
    const msg = (e as Error).message ?? String(e);
    return { $tag: "Err", _0: `peEval: ${msg}` };
  } finally {
    endWhereProofFrame(frame);
  }
}

// ---------------------------------------------------------------------------
// peFnSpec — partial-evaluator-substrate Phase 1 β-reduce seam (CTX-ONLY).
//
// The Fenel-bodied `engine:partialEvaluate` walker's on-demand fn-spec
// introspection (Step-0 D-3): `fnId ⇒ Nothing | Just {params, body}` where
// `body` is `Just <Expr>` (the raw registry body lifted via the live
// `dispatchedJsonLogicToExpr`) or `Nothing` (bodyless @native, or an adapter
// lift Err — the D-inline divergence class: TS specialises raw JL, Fenel keeps
// the residual call). Reads the THREADED ctx's `getFunction` so the parity
// oracle's extra test fns resolve identically on both sides. Registry read +
// marshal only — no decision logic (the walker gates on foldable set + budget).
// The SAME ledgered A2 host-re-entry class as its siblings (the lift re-enters
// the dispatch harness); the dispatch-harness re-entry is safe here: getHarness
// is cached, and evaluate is re-entrant (the D-3 re-entrancy probe = the
// β-reduce corpus rows passing).
// ---------------------------------------------------------------------------

function peFnSpecNative(ctx: EvaluateContext, fnId: unknown): unknown {
  if (typeof fnId !== "string") return { $tag: "Nothing" };
  const spec = ctx?.getFunction?.(fnId) as
    | { params?: ReadonlyArray<{ name: string }>; body?: unknown }
    | undefined;
  if (!spec || !Array.isArray(spec.params)) return { $tag: "Nothing" };
  const params = spec.params.map((p) => p.name);
  if (spec.body === undefined) {
    return { $tag: "Just", _0: { params, body: { $tag: "Nothing" } } };
  }
  const lifted = dispatchedJsonLogicToExpr(spec.body) as { $tag: string; _0?: unknown };
  const body =
    lifted.$tag === "Ok"
      ? { $tag: "Just", _0: lifted._0 }
      : { $tag: "Nothing" };
  return { $tag: "Just", _0: { params, body } };
}

function evalApplyNative(ctx: EvaluateContext, evalFn: unknown, expr: unknown): EvalResult {
  // modules-as-values — the Evaluator `eval` method value names a function by
  // id string (used as written, as before) or by a `{$ref}` function reference.
  // A reference's handle (an own-data read) is resolved through the threaded
  // registry to the canonical id the native tables are keyed by; one that
  // resolves to no function is an `Err`, never a silent evaluation.
  let evalFnId: string;
  if (typeof evalFn === "string") {
    evalFnId = evalFn;
  } else {
    const handle = functionRefHandle(evalFn);
    if (handle === undefined) {
      return evalErr(
        evalErrorInternal(
          `evalApply: eval method is neither a function id nor a function reference: ${String(evalFn)}`,
        ),
      );
    }
    const canonical = ctx?.getFunction?.(handle)?.id;
    if (typeof canonical !== "string" || canonical.length === 0) {
      return evalErr(
        evalErrorInternal(`evalApply: eval method reference "${handle}" resolves to no function`),
      );
    }
    evalFnId = canonical;
  }
  const ctxNatives = ctx?.nativesCtx as
    | Record<string, (ctx: EvaluateContext, ...args: unknown[]) => unknown>
    | undefined;
  const natives = ctx?.natives as
    | Record<string, (...args: unknown[]) => unknown>
    | undefined;
  if (ctxNatives && ctxNatives[evalFnId]) {
    return ctxNatives[evalFnId]!(ctx, expr) as EvalResult;
  }
  if (natives && natives[evalFnId]) {
    return natives[evalFnId]!(expr, ctx) as EvalResult;
  }
  // Body-based fallback — a user-defined Fenel-function strategy (none today).
  // Mirrors makeStrategyWrapper's registry-dispatch fallback; the result is a
  // typed EvalResult.
  const result = evaluate({ call: [evalFnId, expr] }, {}, ctx);
  if (result && typeof result === "object" && "$tag" in result) {
    return result as EvalResult;
  }
  return evalErr(
    evalErrorInternal(`evalApply: no evaluator impl resolved for eval method "${evalFnId}"`),
  );
}

// ---------------------------------------------------------------------------
// The two native maps — codeName → impl, BOTH carrying the SAME 4 codeNames
// (the both-maps-fallback). The seam rekeys each to the `evaluator-strategies:`
// id-namespace via `rekeyNativesById` and attaches `evaluatorNatives` to the
// FenelModule's `nativeImpls` (plain) + `evaluatorNativesCtx` to its
// `nativeImplsCtx` (ctx). The shapes are the SAME plain `Record<codeName, JsFn>`
// the spec file declared before the split; only the FILE LOCATION moved.
//
// The plain map is forwarded `ctx = undefined`; the ctx map threads the real
// `EvaluateContext` as its leading arg (the runtime invokes a ctx-native via
// `ctx.nativesCtx[id](ctx, …args)`). Both delegate to the same impl.
// ---------------------------------------------------------------------------

const evaluatorNatives: Record<string, (...args: unknown[]) => unknown> = {
  eagerEval: (expr, ctx) => eagerEvalNative(expr, ctx as EvaluateContext | undefined),
  lazyEval: (expr, ctx) => lazyEvalNative(expr, ctx as EvaluateContext | undefined),
  partialEval: (expr, ctx) => partialEvalForRegistry(expr, ctx as EvaluateContext | undefined),
  jitEval: (expr, ctx) => jitEvalNative(expr, ctx as EvaluateContext | undefined),
};

// Native impls that take EvaluateContext threaded through the engine — when
// callers dispatch via `{call: [{var: "eval"}, expr]}` the dispatched method
// needs access to the current registry. The runtime types `ctx` as `unknown`
// here (matching FenelModule.nativeImplsCtx), and inside each impl we cast and
// forward.
const evaluatorNativesCtx: Record<
  string,
  (ctx: unknown, ...args: unknown[]) => unknown
> = {
  eagerEval: (ctx, expr) => eagerEvalNative(expr, ctx as EvaluateContext),
  lazyEval: (ctx, expr) => lazyEvalNative(expr, ctx as EvaluateContext),
  partialEval: (ctx, expr) => partialEvalForRegistry(expr, ctx as EvaluateContext),
  jitEval: (ctx, expr) => jitEvalNative(expr, ctx as EvaluateContext),
  // expr-substrate Phase 8 — the apply seam (CTX-ONLY; no plain-map copy: it
  // needs the live ctx to re-enter the evaluator).
  evalApply: (ctx, evalFnId, expr) => evalApplyNative(ctx as EvaluateContext, evalFnId, expr),
  // partial-evaluator-substrate Phase 1 — the const-fold seam (CTX-ONLY; needs
  // the live ctx to re-enter the host evaluator for user-function dispatch).
  peEval: (ctx, jl) => peEvalNative(ctx as EvaluateContext, jl),
  // partial-evaluator-substrate Phase 1 Steps 3-5 — the β-reduce fn-spec
  // introspection (CTX-ONLY; reads the threaded ctx's getFunction).
  peFnSpec: (ctx, fnId) => peFnSpecNative(ctx as EvaluateContext, fnId),
};

export {
  eagerEvalNative,
  lazyEvalNative,
  jitEvalNative,
  evalApplyNative,
  peEvalNative,
  peFnSpecNative,
  evaluatorNatives,
  evaluatorNativesCtx,
};
