// ---------------------------------------------------------------------------
// EffectsExplicit IR — Core + explicit handler-dispatch sites
//
// Phase 5 ships the dialect; Phase 15 lit it up. The EffectsExplicit
// dialect makes every effect-laden call's dispatch site visible: instead of
// an implicit `requires: [HasStateIO]` on the function and an implicit
// lookup at runtime, the IR carries an explicit `(class, method, args)`
// shape at each call that resolves through a typeclass handler.
//
// Phase 21.6.2 — the TS impl of `parseEffectFnId` / `makeEffectsExplicit`
// was deleted. The Fenel bodies in `fenel/modules/engine/` (registered
// as `engine:parseEffectFnId` / `engine:makeEffectsExplicit`) are the
// production path; `engine-bodies-dispatch` is the wrapper that the
// compile pipelines invoke. The type definitions stay because every IR-
// shape consumer (marshalling, function signatures, audit scripts) reads
// them.
// ---------------------------------------------------------------------------

import { compileErrorEffectful } from "../compilable";
import type { CompileFieldSlot } from "../compilable";
import type { Expr } from "./core";

/**
 * An EffectsExplicit program. Body shape is the same `Expr` tree the pass
 * receives (expr-substrate Phase 4c — was `CoreExpr`) — the dispatch sites are
 * not RE-CONSTRUCTED, they're IDENTIFIED via the sentinel fnId convention. Each
 * per-target lowering pattern-matches on the sentinel in ECall.fnId to emit the
 * appropriate handler invocation; the `handlerSites` array provides the same
 * data in structured form for tooling that wants it (the audit / inspector /
 * type checker — they don't walk the tree themselves).
 */
export type EffectsExplicitProgram = {
  readonly $tag: "EffectsExplicitProgram";
  readonly name: string;
  readonly params: ReadonlyArray<CompileFieldSlot>;
  readonly body: Expr;
  /** The effect inventory — class names seen at dispatch sites in the body,
   *  deduplicated. Phase 15: populated from `$effect:` sentinel scan. */
  readonly effects: ReadonlyArray<string>;
  /** Handler-dispatch sites in the body. One entry per effect call site,
   *  in source-walk order. Phase 15 populates from `$effect:` sentinel scan. */
  readonly handlerSites: ReadonlyArray<HandlerSite>;
};

/**
 * A dispatch site — a call that resolves through a typeclass handler.
 *
 *   `typeName`  — the typeclass providing the method (e.g. "HasStateIO").
 *   `methodName` — which method on the class is dispatched (e.g. "set").
 *   `callPath`   — dotted-index path into the body (e.g. "1.0.2") for
 *                  tooling that needs to substitute the dispatched form at
 *                  this exact spot. The trace machinery uses the same path
 *                  shape; reusing it keeps the dispatch-site index aligned
 *                  with the trace nodes.
 */
export type HandlerSite = {
  readonly callPath: string;
  readonly typeName: string;
  readonly methodName: string;
};

/**
 * The sentinel fnId prefix that marks a CoreCall as an effect-dispatch site.
 * Reserved namespace — std functions never use it; the parser / function
 * builder reserves the prefix for typeclass-method calls.
 */
export const EFFECT_FN_ID_PREFIX = "$effect:";

// Re-export the legacy error constructor so callers that build their own
// effect-not-handled errors don't need a separate import path.
export { compileErrorEffectful };
