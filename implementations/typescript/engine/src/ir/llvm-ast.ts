// ---------------------------------------------------------------------------

import type { CompileFieldSlot } from "../compilable";
// LlvmAst — the LLVM IR target IR dialect
//
// Phase 14 of the implementation roadmap. Sibling of `ir/js-ast.ts` (Phase 5)
// and `ir/wasm-ast.ts` (Phase 13). Where JsAst captures the JS expression
// subset and WasmAst the Wasm 3.0 module / instruction subset, LlvmAst
// captures the LLVM IR subset Phase 14's lowering needs.
//
// Per `design/structural-introspection.md` Instance 6:
//
//   "every level from source to target is a typed ADT, every transition is
//    term rewriting between typed ADTs, the only 'string emission' step is
//    the very last serialization (a `Codec<TargetIR, String>` instance)."
//
// For LLVM the "very last step" is `Iso<String, LlvmModule>` — the LLVM IR
// text format (`.ll`) per the LLVM Language Reference Manual. The bitcode
// form (`.bc`) is a sibling Codec for a follow-on phase.
//
// Per `design/survey/compilers-and-runtimes.md` §2.1 (LLVM) and
// recommendation R5 (tiered execution: interpreter → fast-JIT → optimised-
// AOT), LLVM is the natural choice for the slow optimising AOT tier. Phase
// 14 ships the IR text emitter; future phases compose `Iso<Bytes,
// LlvmBitcode>` for the binary form and `clang`-based bridging for native
// objects / executables.
//
// What's modelled:
//
//   - **Value types** — i1 (boolean), i8/i16/i32/i64 (integers), float /
//     double (FP), void, ptr (opaque pointer — LLVM 17+ unified), and
//     aggregate shapes (vector / array / struct). Declared for completeness;
//     the bootstrap mostly uses `double` (numbers) + `i1` (booleans) +
//     `ptr` (strings / ADTs).
//   - **Function definitions / declarations** — `define <ret> @name(<params>)
//     { … }` and `declare <ret> @name(<params>)` for externs. The Phase 14
//     lowering emits one definition per source function and one declaration
//     for each runtime-helper called.
//   - **Basic blocks** — labeled instruction sequences ending in a terminator
//     (`ret`, `br`, `br i1`, `switch`, `unreachable`). LLVM is SSA-form with
//     CFG; control flow is between basic blocks, never inside them.
//   - **Instructions** — arithmetic (`add` / `sub` / `mul` / `sdiv` / `srem`
//     / `fadd` / `fsub` / `fmul` / `fdiv`), bitwise (`and` / `or` / `xor`),
//     comparison (`icmp <pred>` / `fcmp <pred>`), conversions (`sitofp` /
//     `fptosi` / `zext` / `trunc` / `bitcast`), memory (`alloca` / `load` /
//     `store` — declared for alloca-style fallback; phi-style lowering
//     doesn't use them), control (`br` / `phi` / `ret`), calls (`call`).
//   - **Globals + constants** — declared (`@.str.0 = constant [N x i8] c"…"`
//     shape). Phase 14's bootstrap doesn't emit them; the AST has the
//     surface for follow-on phases.
//
// What's deliberately NOT modelled in Phase 14:
//
//   - **Metadata nodes** — `!dbg`, `!tbaa`, `!{…}`. LLVM accepts modules
//     without them; the bootstrap ships nothing in this section.
//   - **Attribute groups** — `attributes #0 = { nounwind … }`. Same reason.
//   - **Calling conventions** — `ccc` (default C) is implicit; other
//     conventions (`fastcc`, `coldcc`, …) require explicit emission.
//   - **Linkage / visibility / DLL storage class / thread-local model** —
//     all default to `external` / `default` / `dso_local` / non-tls. The
//     AST doesn't model the non-default forms.
//   - **TBAA / aliasing metadata** — required for production-grade
//     optimisation but `opt -O2` works without them.
//
// Adding a new instruction = adding a `LlvmInstr` variant + a text-emitter
// case in `compile-llvm.ts`. The emit step stays mechanical.
// ---------------------------------------------------------------------------

// ---------------------------------------------------------------------------
// Value types — the LLVM type system
//
// Per the LLVM Language Reference Manual "Type System" section: integer
// types (i1, i8, i16, i32, i64, …), floating-point (half / float / double /
// fp128), void, pointer (opaque after LLVM 17+ — no typed pointers), vector
// (`<N x T>`), array (`[N x T]`), struct (`{T1, T2, …}`), function types.
//
// Phase 14 models the subset the bootstrap needs + a few extras for
// follow-on phases. Reference types are out of scope until effectful
// lowering needs them.
// ---------------------------------------------------------------------------

export type LlvmValType =
  | { readonly $tag: "I1" }
  | { readonly $tag: "I8" }
  | { readonly $tag: "I16" }
  | { readonly $tag: "LlvmI32" }
  | { readonly $tag: "LlvmI64" }
  | { readonly $tag: "Float" }
  | { readonly $tag: "Double" }
  | { readonly $tag: "Void" }
  /** Opaque pointer — LLVM 17+ unified all typed-pointer forms into `ptr`.
   *  Older LLVMs (≤ 14) wrote `i8*`; modern emission targets `ptr`. */
  | { readonly $tag: "Ptr" }
  /** SIMD vector type — `<N x T>`. Declared for follow-on phases. */
  | { readonly $tag: "Vector"; readonly elemType: LlvmValType; readonly count: number }
  /** Fixed-size array — `[N x T]`. Declared for follow-on phases. */
  | { readonly $tag: "Array"; readonly elemType: LlvmValType; readonly count: number }
  /** Anonymous struct — `{T1, T2, …}`. Declared for follow-on phases. */
  | { readonly $tag: "Struct"; readonly fields: readonly LlvmValType[] };

/** Convenience constants for the types Phase 14 emits. */
export const LLVM_I1: LlvmValType = { $tag: "I1" };
export const LLVM_I8: LlvmValType = { $tag: "I8" };
export const LLVM_I16: LlvmValType = { $tag: "I16" };
export const LLVM_I32: LlvmValType = { $tag: "LlvmI32" };
export const LLVM_I64: LlvmValType = { $tag: "LlvmI64" };
export const LLVM_FLOAT: LlvmValType = { $tag: "Float" };
export const LLVM_DOUBLE: LlvmValType = { $tag: "Double" };
export const LLVM_VOID: LlvmValType = { $tag: "Void" };
export const LLVM_PTR: LlvmValType = { $tag: "Ptr" };

// ---------------------------------------------------------------------------
// Operands — values that appear inside an instruction
//
// LLVM operands are either constants, named-or-numbered local refs (`%foo` /
// `%0`), or global refs (`@bar` / `@.str.0`). The text emitter renders the
// `$tag` family + value into the appropriate text form; no further escaping
// is required.
// ---------------------------------------------------------------------------

export type LlvmOperand =
  | { readonly $tag: "ConstI1"; readonly value: boolean }
  | { readonly $tag: "ConstI32"; readonly value: number }
  | { readonly $tag: "ConstI64"; readonly value: bigint }
  | { readonly $tag: "ConstFloat"; readonly value: number }
  | { readonly $tag: "ConstDouble"; readonly value: number }
  /** `null` pointer constant — `ptr null` */
  | { readonly $tag: "ConstNullPtr" }
  /** Reference to a local register or block label parameter — `%name`. */
  | { readonly $tag: "LocalRef"; readonly name: string }
  /** Reference to a global / function — `@name`. */
  | { readonly $tag: "GlobalRef"; readonly name: string };

// ---------------------------------------------------------------------------
// Comparison predicates — LLVM IR distinguishes integer vs. float compares
//
// Per the LLVM Reference "icmp" / "fcmp" instructions:
//
//   icmp <pred> <ty> <op1>, <op2>   — pred ∈ {eq, ne, ugt, uge, ult, ule,
//                                            sgt, sge, slt, sle}
//   fcmp <pred> <ty> <op1>, <op2>   — pred ∈ {oeq, ogt, oge, olt, ole, one,
//                                            ord, ueq, ugt, uge, ult, ule,
//                                            une, uno, true, false}
//
// For Fenel numeric semantics (matches JS / IEEE 754), Phase 14 uses the
// **ordered** fcmp variants (`o…`) so NaN propagation matches `f64.gt` etc.
// in Wasm. Integer compares use signed variants (`s…`) since Fenel ints are
// signed.
// ---------------------------------------------------------------------------

export type IcmpPredicate =
  | "eq"
  | "ne"
  | "ugt"
  | "uge"
  | "ult"
  | "ule"
  | "sgt"
  | "sge"
  | "slt"
  | "sle";

export type FcmpPredicate =
  | "false"
  | "oeq"
  | "ogt"
  | "oge"
  | "olt"
  | "ole"
  | "one"
  | "ord"
  | "ueq"
  | "ugt"
  | "uge"
  | "ult"
  | "ule"
  | "une"
  | "uno"
  | "true";

// ---------------------------------------------------------------------------
// Instructions — the LLVM SSA op subset Phase 14 emits
//
// Each instruction in LLVM IR has up to one result register (named here as
// `result`). Terminators (ret / br / switch / unreachable) live in their own
// `LlvmTerminator` ADT because they end a basic block — every basic block
// has exactly one terminator at the end.
//
// Adding an op = a new variant + an emitter case in `compile-llvm.ts`.
// ---------------------------------------------------------------------------

/** A binary integer / float arithmetic op shape. `opType` is the operand
 *  type (also the result type for arithmetic). */
export type LlvmInstr =
  // ---- Integer arithmetic ----
  | { readonly $tag: "Add"; readonly result: string; readonly opType: LlvmValType; readonly lhs: LlvmOperand; readonly rhs: LlvmOperand }
  | { readonly $tag: "Sub"; readonly result: string; readonly opType: LlvmValType; readonly lhs: LlvmOperand; readonly rhs: LlvmOperand }
  | { readonly $tag: "Mul"; readonly result: string; readonly opType: LlvmValType; readonly lhs: LlvmOperand; readonly rhs: LlvmOperand }
  | { readonly $tag: "SDiv"; readonly result: string; readonly opType: LlvmValType; readonly lhs: LlvmOperand; readonly rhs: LlvmOperand }
  | { readonly $tag: "SRem"; readonly result: string; readonly opType: LlvmValType; readonly lhs: LlvmOperand; readonly rhs: LlvmOperand }
  // ---- Float arithmetic ----
  | { readonly $tag: "FAdd"; readonly result: string; readonly opType: LlvmValType; readonly lhs: LlvmOperand; readonly rhs: LlvmOperand }
  | { readonly $tag: "FSub"; readonly result: string; readonly opType: LlvmValType; readonly lhs: LlvmOperand; readonly rhs: LlvmOperand }
  | { readonly $tag: "FMul"; readonly result: string; readonly opType: LlvmValType; readonly lhs: LlvmOperand; readonly rhs: LlvmOperand }
  | { readonly $tag: "FDiv"; readonly result: string; readonly opType: LlvmValType; readonly lhs: LlvmOperand; readonly rhs: LlvmOperand }
  | { readonly $tag: "FNeg"; readonly result: string; readonly opType: LlvmValType; readonly operand: LlvmOperand }
  // ---- Bitwise ----
  | { readonly $tag: "And"; readonly result: string; readonly opType: LlvmValType; readonly lhs: LlvmOperand; readonly rhs: LlvmOperand }
  | { readonly $tag: "Or"; readonly result: string; readonly opType: LlvmValType; readonly lhs: LlvmOperand; readonly rhs: LlvmOperand }
  | { readonly $tag: "Xor"; readonly result: string; readonly opType: LlvmValType; readonly lhs: LlvmOperand; readonly rhs: LlvmOperand }
  // ---- Comparisons ----
  | {
      readonly $tag: "ICmp";
      readonly result: string;
      readonly predicate: IcmpPredicate;
      readonly opType: LlvmValType;
      readonly lhs: LlvmOperand;
      readonly rhs: LlvmOperand;
    }
  | {
      readonly $tag: "FCmp";
      readonly result: string;
      readonly predicate: FcmpPredicate;
      readonly opType: LlvmValType;
      readonly lhs: LlvmOperand;
      readonly rhs: LlvmOperand;
    }
  // ---- Conversions ----
  | { readonly $tag: "SIToFP"; readonly result: string; readonly fromType: LlvmValType; readonly value: LlvmOperand; readonly toType: LlvmValType }
  | { readonly $tag: "FPToSI"; readonly result: string; readonly fromType: LlvmValType; readonly value: LlvmOperand; readonly toType: LlvmValType }
  | { readonly $tag: "ZExt"; readonly result: string; readonly fromType: LlvmValType; readonly value: LlvmOperand; readonly toType: LlvmValType }
  | { readonly $tag: "SExt"; readonly result: string; readonly fromType: LlvmValType; readonly value: LlvmOperand; readonly toType: LlvmValType }
  | { readonly $tag: "Trunc"; readonly result: string; readonly fromType: LlvmValType; readonly value: LlvmOperand; readonly toType: LlvmValType }
  | { readonly $tag: "BitCast"; readonly result: string; readonly fromType: LlvmValType; readonly value: LlvmOperand; readonly toType: LlvmValType }
  // ---- Memory (declared for alloca-style fallback; phi-style lowering doesn't use them) ----
  | { readonly $tag: "Alloca"; readonly result: string; readonly elemType: LlvmValType }
  | { readonly $tag: "Load"; readonly result: string; readonly valType: LlvmValType; readonly ptr: LlvmOperand }
  | { readonly $tag: "Store"; readonly valType: LlvmValType; readonly value: LlvmOperand; readonly ptr: LlvmOperand }
  // ---- Phi — the SSA join primitive ----
  | {
      readonly $tag: "Phi";
      readonly result: string;
      readonly phiType: LlvmValType;
      readonly incoming: ReadonlyArray<{ readonly value: LlvmOperand; readonly label: string }>;
    }
  // ---- Call ----
  //
  // `result` is `undefined` for void calls; otherwise it's the SSA name of
  // the returned value. `fn` is typically a `GlobalRef` (`@fenel_concat`) but
  // can be any pointer-typed operand for indirect calls.
  | {
      readonly $tag: "Call";
      readonly result?: string;
      readonly retType: LlvmValType;
      readonly fn: LlvmOperand;
      readonly args: ReadonlyArray<{ readonly argType: LlvmValType; readonly value: LlvmOperand }>;
    };

// ---------------------------------------------------------------------------
// Terminators — every basic block ends in exactly one of these
// ---------------------------------------------------------------------------

export type LlvmTerminator =
  /** `ret <type> <value>` or `ret void` (omit `value`). */
  | { readonly $tag: "Ret"; readonly retType: LlvmValType; readonly value?: LlvmOperand }
  /** `br label %<target>` — unconditional branch. */
  | { readonly $tag: "Br"; readonly target: string }
  /** `br i1 <cond>, label %<ifTrue>, label %<ifFalse>` — conditional. */
  | { readonly $tag: "BrCond"; readonly cond: LlvmOperand; readonly ifTrue: string; readonly ifFalse: string }
  /** `switch <ty> <value>, label %<default> [<cases>]`. */
  | {
      readonly $tag: "Switch";
      readonly opType: LlvmValType;
      readonly value: LlvmOperand;
      readonly defaultLabel: string;
      readonly cases: ReadonlyArray<{ readonly caseValue: LlvmOperand; readonly target: string }>;
    }
  /** `unreachable` — terminator marking control flow that cannot happen. */
  | { readonly $tag: "LlvmUnreachable" };

// ---------------------------------------------------------------------------
// Basic blocks + functions
// ---------------------------------------------------------------------------

/** A single basic block: a label + a sequence of (non-terminator)
 *  instructions + exactly one terminator. */
export type LlvmBasicBlock = {
  readonly $tag: "LlvmBasicBlock";
  readonly label: string;
  readonly instructions: readonly LlvmInstr[];
  readonly terminator: LlvmTerminator;
};

/** Formal parameter shape. `name` is what appears as `%<name>` in the
 *  function body; `paramType` is the LLVM type. */
export type LlvmParam = {
  readonly name: string;
  readonly paramType: LlvmValType;
};

/** A function definition — header + basic blocks. The first block is the
 *  entry. Per LLVM IR convention, blocks appear in dominance order. */
export type LlvmFunctionDef = {
  readonly $tag: "LlvmFunctionDef";
  readonly name: string;
  readonly returnType: LlvmValType;
  readonly params: readonly LlvmParam[];
  readonly blocks: readonly LlvmBasicBlock[];
};

/** A function declaration — header only, no body. Used for externs the
 *  module calls (`declare ptr @fenel_concat(ptr, ptr)`). */
export type LlvmFunctionDecl = {
  readonly $tag: "LlvmFunctionDecl";
  readonly name: string;
  readonly returnType: LlvmValType;
  readonly params: readonly LlvmParam[];
};

// ---------------------------------------------------------------------------
// Globals — declared for follow-on phases
//
// LLVM IR globals appear at module scope:
//
//   @<name> = [linkage] [thread_local_model] [unnamed_addr] [addrspace]
//             [externally_initialized] <constant|global> <type> [<initializer>]
//
// Phase 14's bootstrap doesn't emit any. The AST surface exists so a
// follow-on phase can lower string literals + constant ADTs to typed
// globals + emit them through this shape.
// ---------------------------------------------------------------------------

export type LlvmGlobal = {
  readonly $tag: "LlvmGlobal";
  readonly name: string;
  readonly globalType: LlvmValType;
  readonly initializer?: LlvmOperand;
  /** `true` = `constant`, `false` = `global` (mutable). */
  readonly isConstant: boolean;
};

// ---------------------------------------------------------------------------
// Effect imports — Phase 16 metadata
//
// Each `$effect:<Class>:<method>` sentinel call site in the lowered body
// produces a `declare ptr @fenel_<Class>_<method>(ptr, …)` extern + a `call`
// instruction at that site. The metadata recorded here is the structured
// view of those externs: the `(typeName, methodName, arity)` triple plus
// the C symbol the declaration uses. Sibling of `WasmModule.imports` filtered
// for `$effect.<Class>` modules — but exposed as structured metadata since
// the LLVM declaration namespace is flat (`fenel_*`) and the test harness
// can't otherwise distinguish runtime-helper externs from effect externs.
//
// Consumers: the test harness's per-module C-shim generator (one C function
// per entry, dispatching through the handler registry); WIT / Component-
// Model `Iso<…, LlvmModule>` codecs (a follow-on Phase that mirrors the
// Wasm Component Model emission roadmap).
// ---------------------------------------------------------------------------

export type LlvmEffectImport = {
  readonly typeName: string;
  readonly methodName: string;
  readonly arity: number;
  /** The C symbol the LLVM `declare` uses (e.g. `fenel_HasStateIO_set`). */
  readonly symbol: string;
};

// ---------------------------------------------------------------------------
// Module — the program-level envelope
//
// Mirrors `JsModule` / `WasmModule` in shape. Phase 14 emits one entry
// function definition per program + a small set of `declare`s for runtime
// helpers.
// ---------------------------------------------------------------------------

export type LlvmModule = {
  readonly $tag: "LlvmModule";
  /** Source-level name (also used as the entry function's name and the
   *  `ModuleID` comment header in the emitted IR text). */
  readonly name: string;
  /** Resolved entry parameter reflection retained beside emitted `%name`s. */
  readonly fieldSlots: readonly CompileFieldSlot[];
  /** Optional target triple (`x86_64-unknown-linux-gnu`, `arm64-apple-darwin`,
   *  …). When absent, LLVM tools default to the host triple. */
  readonly targetTriple?: string;
  /** Optional data layout string. Defaults to the host's layout when
   *  absent. */
  readonly dataLayout?: string;
  /** Module-level `declare`s for externally-defined functions called from
   *  this module. Phase 14 declares one per runtime helper used; Phase 16
   *  adds the `fenel_<Class>_<method>` declarations for effect imports. */
  readonly declarations: readonly LlvmFunctionDecl[];
  /** Module-level globals (string literals, constant ADTs). Phase 14
   *  bootstrap emits none. */
  readonly globals: readonly LlvmGlobal[];
  /** Function definitions. Phase 14 emits one entry function; follow-on
   *  phases may emit multiple when closures and ADT helpers land. */
  readonly definitions: readonly LlvmFunctionDef[];
  /** Effect-handler imports — Phase 16. One entry per unique
   *  `(typeName, methodName, arity)` triple in the lowered body. The
   *  serialiser doesn't consume this directly (the matching `declare`
   *  appears in `declarations`); it's metadata for the host runtime
   *  binder + tooling that wants to enumerate the dispatch surface. */
  readonly effectImports?: readonly LlvmEffectImport[];
  /** Interned string literals — Phase 16. Sibling of `WasmModule.stringPool`.
   *  The serialiser emits one `@.str.<i> = private unnamed_addr constant
   *  [N x i8] c"…\\00"` line per pool entry; the lowered body references
   *  them via `@.str.<i>` ptr operands. Empty / undefined when the body
   *  has no string literals. */
  readonly stringPool?: readonly string[];
};

// ---------------------------------------------------------------------------
// Helpers — equality + lookup
// ---------------------------------------------------------------------------

/** Structural equality on value types. Used to dedupe declarations. */
export function llvmValTypeEqual(a: LlvmValType, b: LlvmValType): boolean {
  if (a.$tag !== b.$tag) return false;
  switch (a.$tag) {
    case "Vector":
    case "Array": {
      const bb = b as typeof a;
      return a.count === bb.count && llvmValTypeEqual(a.elemType, bb.elemType);
    }
    case "Struct": {
      const bb = b as typeof a;
      if (a.fields.length !== bb.fields.length) return false;
      for (let i = 0; i < a.fields.length; i++) {
        if (!llvmValTypeEqual(a.fields[i]!, bb.fields[i]!)) return false;
      }
      return true;
    }
    default:
      return true;
  }
}

/** Find a declared function by name, or undefined. */
export function findLlvmDeclaration(mod: LlvmModule, name: string): LlvmFunctionDecl | undefined {
  return mod.declarations.find((d) => d.name === name);
}

/** Find a defined function by name, or undefined. */
export function findLlvmDefinition(mod: LlvmModule, name: string): LlvmFunctionDef | undefined {
  return mod.definitions.find((d) => d.name === name);
}
