// ---------------------------------------------------------------------------
// ClosuresExplicit IR — Core (post-effects) + explicit free-variable capture
//
// Phase 5 of the implementation roadmap. The ClosuresExplicit dialect
// rewrites every `CoreLambda` to a `CeClosure` that carries the explicit
// free-variable list. This is "closure conversion" — the classical
// functional-compilers pass that takes implicit lexical capture and makes
// it a structural property of the lambda.
//
// Why it earns its own dialect:
//
//   - Code-gen targets need explicit captures. JS happens to implement
//     lexical closures natively, so the emitted code can use a regular
//     arrow function — but the IR shape is what later targets (Wasm,
//     native) will pivot on. Wasm specifically has no implicit lexical
//     environment; closures are records of (function-pointer, captures).
//   - Specialisation passes (monomorphisation, λ-lifting, defunctionalisa-
//     tion) operate on the captures list — knowing what's captured is
//     a precondition for any of them.
//   - Optimisation: a lambda with `captures: []` is a top-level function;
//     it can be lifted out as a regular `CoreCall` target with no
//     allocation. The discipline shows up at the dialect boundary, not at
//     emit time.
//
// Phase 21.6.2 — the TS impl of `makeClosuresExplicit` was deleted; the
// Fenel body in `fenel/modules/engine/make-closures-explicit.fenel`
// (registered as `engine:makeClosuresExplicit`) is the production path.
// The type definitions stay because every IR-shape consumer reads them.
// ---------------------------------------------------------------------------

import type { CorePattern } from "./core";
import type { CompileFieldSlot } from "../compilable";

// ---------------------------------------------------------------------------
// ClosuresExplicit AST — mirrors CoreExpr with one change: CoreLambda
// becomes CeClosure carrying `captures: string[]`.
// ---------------------------------------------------------------------------

export type CeLit = {
  readonly $tag: "CeLit";
  readonly value: number | string | boolean | null;
};

export type CeVar = {
  readonly $tag: "CeVar";
  readonly name: string;
};

export type CeCall = {
  readonly $tag: "CeCall";
  readonly fnId: string;
  readonly args: readonly CeExpr[];
};

export type CeIf = {
  readonly $tag: "CeIf";
  readonly cond: CeExpr;
  readonly then: CeExpr;
  readonly else: CeExpr;
};

export type CeLet = {
  readonly $tag: "CeLet";
  readonly bindings: ReadonlyArray<{ readonly name: string; readonly value: CeExpr }>;
  readonly body: CeExpr;
};

export type CeDo = {
  readonly $tag: "CeDo";
  readonly exprs: readonly CeExpr[];
};

/**
 * Closure with explicit captures. `params` are the lambda's bound names;
 * `captures` is the list of free-variable names the body reads from the
 * enclosing scope. The JS emitter renders this as an arrow function and
 * relies on JS's implicit lexical environment to make the captures
 * available; Wasm / native targets will materialise the captures as a
 * record passed alongside the function pointer.
 */
export type CeClosure = {
  readonly $tag: "CeClosure";
  readonly params: readonly string[];
  readonly captures: readonly string[];
  readonly body: CeExpr;
};

export type CeConstruct = {
  readonly $tag: "CeConstruct";
  readonly ctor: string;
  readonly args: readonly CeExpr[];
  /**
   * Phase 21.1 — passes through unchanged from `CoreConstruct.fields`.
   * When present, per-target lowerings emit named-field ADT shapes that
   * byte-equal the engine's ctorDef-driven `construct` op output.
   */
  readonly fields?: readonly CompileFieldSlot[];
};

export type CeRecord = {
  readonly $tag: "CeRecord";
  readonly fields: ReadonlyArray<{ readonly name: string; readonly value: CeExpr }>;
};

export type CeMatch = {
  readonly $tag: "CeMatch";
  readonly scrutinee: CeExpr;
  readonly arms: ReadonlyArray<{ readonly pattern: CorePattern; readonly body: CeExpr }>;
};

export type CeExpr =
  | CeLit
  | CeVar
  | CeCall
  | CeIf
  | CeLet
  | CeDo
  | CeClosure
  | CeConstruct
  | CeRecord
  | CeMatch;

/**
 * Program-level envelope mirroring `EffectsExplicitProgram` with the
 * closure-converted body.
 */
export type ClosuresExplicitProgram = {
  readonly $tag: "ClosuresExplicitProgram";
  readonly name: string;
  readonly params: ReadonlyArray<CompileFieldSlot>;
  readonly body: CeExpr;
};
