// ---------------------------------------------------------------------------

import type { CompileFieldSlot } from "../compilable";
// JsAst — the JavaScript target IR
//
// Phase 5 of the implementation roadmap. The JsAst dialect is the typed,
// JS-shaped IR that the `Codec<JsAst, String>` serialises into a JS
// source string. Per `design/structural-introspection.md` Instance 6:
//
//   "every level from source to target is a typed ADT, every transition
//    is term rewriting between typed ADTs, the only 'string emission'
//    step is the very last serialization (a `Codec<TargetIR, Bytes>`
//    instance)."
//
// This is the very last step: an ADT shaped after JS expressions (the JS
// expression subset the Phase 5 lowering needs). No `match` / `pipe` /
// `withInstance` — those compile away in earlier passes. Just the JS
// primitives that the serialiser can emit deterministically.
//
// Phase 5 expression subset (matches what `emitJs` produces from the
// closures-explicit IR):
//
//   - Literals: number / string / boolean / null
//   - Identifiers / member access
//   - Function calls
//   - Arrow functions (with optional explicit captures list — JS resolves
//     them via the enclosing lexical environment; the captures list is
//     metadata for downstream targets that don't have implicit closure
//     capture)
//   - Let-bindings encoded as IIFE-let (`((x, y, ...) => body)(v1, v2, ...)`)
//     or as nested arrow chains
//   - Ternary conditionals
//   - Object literals + array literals
//   - Binary operators (arithmetic / comparison / logical)
//   - Unary operators (negation / logical not)
//   - Sequence expressions (the comma operator) — useful for inlining
//     side-effect-free preliminary computations
//
// Phase 5 does NOT yet include:
//
//   - `if` statements / blocks / `return` — the IR is expression-shaped,
//     matching the Fenel source where every body is an expression.
//   - Async / await / generator / `for` / `while`.
//   - Destructuring patterns (the `CeMatch` lowering uses chained ternary
//     + property access, which the JsAst level captures structurally).
//
// Adding a new emission shape = adding a JsAst variant + a serialiser
// case. The encode → string step stays mechanical.
// ---------------------------------------------------------------------------

/** Primitive literal — emitted by `JSON.stringify` for safe quoting. */
export type JsLit = {
  readonly $tag: "JsLit";
  readonly value: number | string | boolean | null;
};

/** Identifier reference. */
export type JsVar = {
  readonly $tag: "JsVar";
  readonly name: string;
};

/** Member access: `object.property`. The property is a string identifier
 *  in Phase 5; computed-property access (`object[expr]`) lands when a use
 *  case demands it. */
export type JsMember = {
  readonly $tag: "JsMember";
  readonly object: JsAst;
  readonly property: string;
};

/** Function-call expression. */
export type JsCall = {
  readonly $tag: "JsCall";
  readonly callee: JsAst;
  readonly args: readonly JsAst[];
};

/** Arrow function. `captures` is metadata for non-JS targets (Wasm /
 *  native); the JS emitter ignores it — JS handles capture implicitly via
 *  lexical scope. */
export type JsArrow = {
  readonly $tag: "JsArrow";
  readonly params: readonly string[];
  readonly captures: readonly string[];
  readonly body: JsAst;
};

/**
 * Let-binding sequence rendered as an IIFE: `((p1, p2, …) => body)(v1,
 * v2, …)`. JS doesn't have an expression-form `let`, so the IIFE pattern
 * is the most compact equivalent — it preserves the binding semantics
 * (each value evaluated before being bound, all visible in `body`) and
 * stays an expression.
 *
 * Note: the values shadow rather than chain — `let x = e1; let y = e2(x)`
 * needs nested IIFEs (one per binding), since IIFE params can't see each
 * other. The emitter handles the chaining structurally.
 */
export type JsLet = {
  readonly $tag: "JsLet";
  readonly bindings: ReadonlyArray<{ readonly name: string; readonly value: JsAst }>;
  readonly body: JsAst;
};

/** Ternary conditional: `c ? t : e`. */
export type JsTernary = {
  readonly $tag: "JsTernary";
  readonly cond: JsAst;
  readonly then: JsAst;
  readonly else: JsAst;
};

/** Binary operator: `+ - * / % == != < <= > >= && || ??`. */
export type JsBinOp = {
  readonly $tag: "JsBinOp";
  readonly op: string;
  readonly left: JsAst;
  readonly right: JsAst;
};

/** Unary operator: `! - +`. */
export type JsUnaryOp = {
  readonly $tag: "JsUnaryOp";
  readonly op: string;
  readonly arg: JsAst;
};

/** Object literal: `{key1: v1, key2: v2, …}`. Keys are unquoted identifiers
 *  or quoted strings as the emitter sees fit; Phase 5 quotes always for
 *  safety against keyword collisions. */
export type JsObject = {
  readonly $tag: "JsObject";
  readonly fields: ReadonlyArray<{ readonly key: string; readonly value: JsAst }>;
};

/** Array literal: `[a, b, c, …]`. */
export type JsArray = {
  readonly $tag: "JsArray";
  readonly elements: readonly JsAst[];
};

/** Comma-sequence: `(a, b, c)`. Evaluates each left-to-right; the value
 *  is the rightmost. Useful for inlining preliminary computations into an
 *  expression context. */
export type JsSequence = {
  readonly $tag: "JsSequence";
  readonly exprs: readonly JsAst[];
};

export type JsAst =
  | JsLit
  | JsVar
  | JsMember
  | JsCall
  | JsArrow
  | JsLet
  | JsTernary
  | JsBinOp
  | JsUnaryOp
  | JsObject
  | JsArray
  | JsSequence;

// ---------------------------------------------------------------------------
// JsModule — the program-level envelope for the JS emission
// ---------------------------------------------------------------------------

/**
 * A compiled JS module bundle. Phase 5 emits a single arrow-function
 * expression — the compiled Fenel function — wrapped in a `JsArrow` whose
 * params are the source function's formal params. The `body` is the
 * lowered expression that returns the function's value.
 *
 * Future phases will add multi-function bundles (each compiled function
 * becomes a named export), runtime-helper preludes, and module-level
 * imports of the host runtime's helpers.
 */
export type JsModule = {
  readonly $tag: "JsModule";
  readonly name: string;
  /** Resolved parameter reflection retained beside final JS identifiers. */
  readonly fieldSlots: readonly CompileFieldSlot[];
  readonly entry: JsArrow;
};
