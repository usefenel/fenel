// ---------------------------------------------------------------------------

import type { CompileFieldSlot } from "../compilable";
// Core IR — the first lowering of JSON Logic into a typed-data tree
//
// Phase 5 of the implementation roadmap. The "Core" dialect collapses the
// op-zoo of the source JSON-Logic AST (operator-form `{+: [a, b]}`,
// key-as-fnId `{add: [a, b]}`, explicit `{call: ["add", a, b]}` — all the
// same call) into one uniform shape: every call is `{$tag: "CoreCall",
// fnId, args}` regardless of how it was written. Variables, literals,
// conditionals, let-bindings, lambdas, ADT construction and pattern
// matching each have one canonical Core node.
//
// What Core deliberately doesn't do:
//
//   - **Doesn't infer types.** Type information that's already on the
//     source travels along; values that lack a declared type stay
//     ambiguous. Type-level reasoning is a separate concern.
//   - **Doesn't resolve calls.** A `CoreCall` carries the fnId as a string;
//     whether that fnId is a user function, a std op, or an effect method
//     is decided by the effect-explicit pass next in the pipeline.
//   - **Doesn't elaborate `match`.** Pattern shapes are recorded as-is;
//     pattern compilation (decision tree construction) is a Phase 6+
//     concern.
//
// What Core does:
//
//   - One call shape (`CoreCall`) replaces three source-level call shapes
//     (`{op: args}`, `{call: [fnId, ...]}`, key-as-fnId).
//   - Operator notation (`+`, `-`, `*`, `==`, `cat`, etc.) is rewritten to
//     the canonical codeName (`add`, `sub`, `mul`, `eq`, `concat`).
//   - Short-circuit `{if: …}` becomes `CoreIf` (kept structural so the
//     evaluator's lazy-args semantics survive); the eager `ifElse` function
//     call form becomes a regular `CoreCall("ifElse", …)`.
//   - Records (`{field1: v1, field2: v2, …}`) become `CoreRecord` with
//     explicit field list. ADT construction (`{construct: [Tag, …]}`)
//     becomes `CoreConstruct`.
//
// Phase 21.6.2 — the TS impl of `normaliseToCore` (and its lowering
// helpers) was deleted. The Fenel body in
// `fenel/modules/engine/normalise-to-core.fenel` (registered as
// `engine:normaliseToCore`) is the production path. The type
// definitions stay because every IR-shape consumer reads them.
// ---------------------------------------------------------------------------

/** A primitive literal: number, string, boolean, or null. */
export type CoreLit = {
  readonly $tag: "CoreLit";
  readonly value: number | string | boolean | null;
};

/** Reference to a name in scope (formal param / let binding / lambda param). */
export type CoreVar = {
  readonly $tag: "CoreVar";
  readonly name: string;
};

/**
 * Function call. `fnId` names the callee; resolution happens in later
 * passes. Args are evaluated strictly (the canonical Fenel function-call
 * convention). Short-circuit operators do NOT use `CoreCall` — they get
 * their own structural node so laziness is preserved through lowering.
 */
export type CoreCall = {
  readonly $tag: "CoreCall";
  readonly fnId: string;
  readonly args: readonly CoreExpr[];
};

/**
 * Conditional with lazy branches. The structural form is preserved (rather
 * than encoded as `CoreCall("ifElse", …)`) because the JS target wants a
 * ternary `c ? t : e` for it, and pattern-matching on the structural form
 * keeps the JS emitter direct. The eager `ifElse(c, t, e)` Fenel function
 * is a separate, distinguishable shape (`CoreCall("ifElse", [c, t, e])`).
 */
export type CoreIf = {
  readonly $tag: "CoreIf";
  readonly cond: CoreExpr;
  readonly then: CoreExpr;
  readonly else: CoreExpr;
};

/**
 * `let` bindings: a list of `name = value` pairs evaluated in order, each
 * binding visible to the next. JSON-Logic `{let: {…}}` evaluates to the
 * value of the LAST binding (there's no separate body), so the lowering
 * synthesises an implicit body — the variable bound last. Where the source
 * uses `do` + nested lets to express "bind then expression", the do form
 * captures the body explicitly.
 */
export type CoreLet = {
  readonly $tag: "CoreLet";
  readonly bindings: ReadonlyArray<{ readonly name: string; readonly value: CoreExpr }>;
  readonly body: CoreExpr;
};

/**
 * Sequence: evaluate each expression in order, return the last value.
 * Embedded `{let: {…}}` inside a `do` body becomes a let-binding stage
 * carried at the same level; the lowering normalises that.
 */
export type CoreDo = {
  readonly $tag: "CoreDo";
  readonly exprs: readonly CoreExpr[];
};

/**
 * Lambda. `params` are the bound names; `body` is evaluated with those
 * names in scope. Free variables (anything not in `params` and not a
 * global) are captured implicitly here — explicit capture is the
 * `ClosuresExplicit` level's job.
 */
export type CoreLambda = {
  readonly $tag: "CoreLambda";
  readonly params: readonly string[];
  readonly body: CoreExpr;
};

/**
 * ADT construction: `Just 5`, `Cons (head, tail)`, `Bot { token = "..." }`.
 * Phase 5 stores the constructor name + positional / named-field args as a
 * flat positional list; the named-field shape from the source is
 * normalised into the constructor's declared field order at lowering. When
 * the lowering doesn't know the field order (no registry context), it
 * preserves the source order and downstream lookup deals with it.
 *
 * Phase 21.1 — `fields` (when present) names each entry of `args` by index,
 * mirroring the engine's ctorDef-driven named-field shape. Per-target
 * lowerings (`compile-{js,wasm,llvm}.ts:CeConstruct`) read it to emit
 * `{$tag, <field>: value}` instead of the positional `{$tag, _N: value}`
 * fallback. Absence preserves Phase 19 behaviour for unregistered ADTs +
 * unit-test fixtures that build CoreConstruct directly.
 */
export type CoreConstruct = {
  readonly $tag: "CoreConstruct";
  readonly ctor: string;
  readonly args: readonly CoreExpr[];
  readonly fields?: readonly CompileFieldSlot[];
};

/** Anonymous record literal: `{x = 1, y = "hi"}` → `CoreRecord([…])`. */
export type CoreRecord = {
  readonly $tag: "CoreRecord";
  readonly fields: ReadonlyArray<{ readonly name: string; readonly value: CoreExpr }>;
};

/** Pattern match. Phase 5 supports the source shape; pattern compilation
 *  (decision-tree construction) is a Phase 6+ concern. */
export type CoreMatch = {
  readonly $tag: "CoreMatch";
  readonly scrutinee: CoreExpr;
  readonly arms: ReadonlyArray<{ readonly pattern: CorePattern; readonly body: CoreExpr }>;
};

/**
 * Pattern syntax. Phase 5 covers the four shapes that matter for the
 * JS-target's bootstrap:
 *
 *   PatLit    — match a literal value.
 *   PatVar    — bind a name to the matched value (wildcard with a name).
 *   PatWildcard — bind nothing.
 *   PatConstruct — match an ADT constructor; sub-patterns recurse.
 *
 * Pattern guards / refinement predicates / row patterns are out of scope
 * for Phase 5 — the JS subset doesn't yet need them.
 */
export type CorePattern =
  | { readonly $tag: "PatLit"; readonly value: number | string | boolean | null }
  | { readonly $tag: "PatVar"; readonly name: string }
  | { readonly $tag: "PatWildcard" }
  | {
      readonly $tag: "PatConstruct";
      readonly ctor: string;
      readonly args: readonly CorePattern[];
      /**
       * Phase 21.1 — when present, names each entry of `args` by index (the
       * source-level pattern's named-field keys, in declaration order).
       * Per-target pattern guards (`compile-{js,wasm,llvm}.ts`) read named
       * fields via `<scrut>.<field>` instead of positional `_N` indexing,
       * which lines up with the named-field ADT shape `CoreConstruct`
       * emits on the construct side. Absence preserves the Phase 19
       * positional-index read (so unregistered ADTs + hand-written test
       * fixtures still match).
       */
      readonly fields?: readonly CompileFieldSlot[];
    };

export type CoreExpr =
  | CoreLit
  | CoreVar
  | CoreCall
  | CoreIf
  | CoreLet
  | CoreDo
  | CoreLambda
  | CoreConstruct
  | CoreRecord
  | CoreMatch;

// ---------------------------------------------------------------------------
// Expr — the irreducible core IR (expr-substrate Phase 4c). Mirrors
// `fenel/std/expr.fenel` (7 cases). Replaces `CoreExpr` as the inter-pass IR:
// `normaliseToCore` delegates to `jsonLogicToExpr` and the effects/closures
// passes walk `Expr`, reconstituting `CeIf`/`CeLet`/`CeDo` into `CeExpr`. No
// EIf/ELet/EDo — `if` is `ECall "if"`, `let`/`do` are applied-`ELambda`-via-`$`.
//
// TYPE-ONLY mirror: the runtime IR values cross the dispatch boundary through
// `as` casts (the `.fenel` body is the execution path), so this is a
// documentation/honesty type, not a checked contract — same posture the
// `CoreExpr` mirror always had.
// ---------------------------------------------------------------------------
export type Expr =
  | { readonly $tag: "ELit"; readonly value: unknown }
  | { readonly $tag: "EVar"; readonly name: string }
  | { readonly $tag: "ECall"; readonly fnId: string; readonly args: readonly Expr[] }
  | { readonly $tag: "ELambda"; readonly params: readonly string[]; readonly body: Expr }
  | {
      readonly $tag: "EConstruct";
      readonly ctor: string;
      readonly args: readonly Expr[];
      readonly fields?: readonly CompileFieldSlot[];
    }
  | { readonly $tag: "ERecord"; readonly fields: ReadonlyArray<{ readonly name: string; readonly value: Expr }> }
  | {
      readonly $tag: "EMatch";
      readonly scrutinee: Expr;
      readonly arms: ReadonlyArray<{ readonly pattern: CorePattern; readonly body: Expr }>;
    };

// ---------------------------------------------------------------------------
// CoreProgram — the lowering output bundle
//
// A function source becomes a `CoreProgram`: its parameter list (typed
// names) + the body lowered to a CoreExpr. Param types travel through so
// later passes that need them (effect inference, monomorphisation) don't
// need to re-source the function.
// ---------------------------------------------------------------------------

export type CoreProgram = {
  readonly $tag: "CoreProgram";
  readonly name: string;
  readonly params: ReadonlyArray<CompileFieldSlot>;
  // expr-substrate Phase 4c — honest `Expr` body (was `CoreExpr`).
  readonly body: Expr;
  readonly requires: ReadonlyArray<string>;
};
