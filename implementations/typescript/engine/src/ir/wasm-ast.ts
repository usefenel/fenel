// ---------------------------------------------------------------------------

import type { CompileFieldSlot } from "../compilable";
// WasmAst — the WebAssembly 3.0 target IR
//
// Phase 13 of the implementation roadmap. Sibling of `ir/js-ast.ts`. Where
// JsAst captures the JS expression subset the Phase 5 lowering needs,
// WasmAst captures the Wasm 3.0 module / instruction subset the Phase 13
// lowering needs. Per `design/structural-introspection.md` Instance 6:
//
//   "every level from source to target is a typed ADT, every transition
//    is term rewriting between typed ADTs, the only 'string emission'
//    step is the very last serialization (a `Codec<TargetIR, Bytes>`
//    instance)."
//
// For Wasm, the "very last step" is a `Codec<Bytes, WasmModule>` (the
// `.wasm` binary format per the W3C spec). The text format (`.wat`) is
// also encodable from this same AST, but binary is what runtimes consume.
//
// What's modelled:
//
//   - **Value types** — i32, i64, f32, f64 (the four numeric Wasm types) +
//     `externref` (host-managed reference, used here for non-numeric values
//     like strings and ADT instances at the JS/Wasm boundary) +
//     `funcref` (function reference, used for call_indirect).
//   - **Function types** — `(params*) -> (results*)`. Wasm allows multi-
//     value returns; Phase 13's lowering uses single results but the type
//     supports the general shape.
//   - **Imports** — function imports from the host's `$fenel` runtime
//     helper namespace (concat, etc.). Phase 13 only ships function imports;
//     memory / global / table imports are declared in the AST for future
//     phases but the bootstrap doesn't emit them.
//   - **Functions** — typed signatures + local declarations + instruction
//     body. The instruction stream is a typed list of WasmInstr variants.
//   - **Exports** — single entry function export. Phase 13 emits one
//     function per compiled program; multi-function bundles are a Phase 14+
//     concern.
//   - **WasmGC types** — `(struct …)` and `(array …)` declarations. The AST
//     declares them as first-class so a future "lower ADTs to WasmGC structs"
//     pass can use them. Phase 13 bootstrap uses `externref` for ADTs at the
//     boundary (matching the JS target's host-managed shape) — WasmGC native
//     ADT representation is a follow-on phase.
//
// What's deliberately NOT modelled in Phase 13:
//
//   - Memory section / linear memory / load-store ops — Phase 13's pure
//     subset doesn't need them; closure captures and constructed values
//     are routed through externref or WasmGC.
//   - Global section / mutable globals — same reason.
//   - Table / element section — call_indirect uses a table, but Phase 13's
//     bootstrap uses direct calls; indirect-call support lives in the AST
//     for follow-on use.
//   - Component Model (wit) — stretch goal per the brief; declared as
//     `componentExports` metadata on WasmModule, encoded by a future
//     Codec<String, WitInterface> sibling. The core-module binary remains
//     the wire format for Phase 13.
//
// Adding a new emission shape = adding a WasmInstr variant + a binary-
// encoder case. The encode → bytes step stays mechanical.
// ---------------------------------------------------------------------------

// ---------------------------------------------------------------------------
// Value types — Wasm 3.0 enumeration
//
// Per the W3C Wasm 3.0 spec §2.3.1, value types are i32 / i64 / f32 / f64
// (number types), v128 (vector type — not used in Phase 13), funcref /
// externref (reference types). WasmGC adds typed-ref forms like `(ref
// $structType)`; those are modelled as `RefStruct` / `RefArray` variants
// referencing a declared type index. The non-GC bootstrap doesn't use them
// but they exist in the AST.
// ---------------------------------------------------------------------------

export type WasmValType =
  | { readonly $tag: "I32" }
  | { readonly $tag: "I64" }
  | { readonly $tag: "F32" }
  | { readonly $tag: "F64" }
  | { readonly $tag: "Externref" }
  | { readonly $tag: "Funcref" }
  /** `(ref $structIdx)` — a typed reference to a WasmGC struct. The
   *  `typeIdx` references the module's type section. */
  | { readonly $tag: "RefStruct"; readonly typeIdx: number }
  /** `(ref $arrayIdx)` — a typed reference to a WasmGC array. */
  | { readonly $tag: "RefArray"; readonly typeIdx: number };

/** Convenience constructors for the common types. */
export const I32: WasmValType = { $tag: "I32" };
export const I64: WasmValType = { $tag: "I64" };
export const F32: WasmValType = { $tag: "F32" };
export const F64: WasmValType = { $tag: "F64" };
export const EXTERNREF: WasmValType = { $tag: "Externref" };
export const FUNCREF: WasmValType = { $tag: "Funcref" };

// ---------------------------------------------------------------------------
// Function types — `(params) -> (results)`
// ---------------------------------------------------------------------------

export type WasmFuncType = {
  readonly $tag: "WasmFuncType";
  readonly params: readonly WasmValType[];
  readonly results: readonly WasmValType[];
};

export function funcType(
  params: readonly WasmValType[],
  results: readonly WasmValType[],
): WasmFuncType {
  return { $tag: "WasmFuncType", params, results };
}

// ---------------------------------------------------------------------------
// WasmGC types — struct / array declarations
//
// Declared at the module's type section; referenced by `(ref $typeIdx)`
// value types. Phase 13's bootstrap doesn't emit GC type declarations; they
// live here for the follow-on phase that lowers ADTs to native WasmGC.
// ---------------------------------------------------------------------------

/** A WasmGC struct field. `mutable` controls whether `struct.set` is
 *  allowed; `valType` is the field's type. */
export type WasmStructField = {
  readonly name?: string;
  readonly valType: WasmValType;
  readonly mutable: boolean;
};

/** A WasmGC struct type declaration. */
export type WasmStructType = {
  readonly $tag: "WasmStructType";
  readonly name?: string;
  readonly fields: readonly WasmStructField[];
};

/** A WasmGC array type declaration. */
export type WasmArrayType = {
  readonly $tag: "WasmArrayType";
  readonly name?: string;
  readonly element: WasmStructField;
};

/** Any of the type-section declarations. Phase 13's encoder emits the
 *  function-type form; struct/array encoding follows the GC spec when the
 *  follow-on phase lights it up. */
export type WasmTypeDecl = WasmFuncType | WasmStructType | WasmArrayType;

// ---------------------------------------------------------------------------
// Imports — Phase 13 uses function imports from a `$fenel` runtime
// namespace. Memory / global / table import variants exist in the AST for
// future phases.
// ---------------------------------------------------------------------------

export type WasmFuncImport = {
  readonly $tag: "WasmFuncImport";
  readonly module: string;
  readonly name: string;
  readonly funcType: WasmFuncType;
};

export type WasmMemImport = {
  readonly $tag: "WasmMemImport";
  readonly module: string;
  readonly name: string;
  /** Pages (64KiB each). `min` required; `max` optional. */
  readonly limits: { readonly min: number; readonly max?: number };
};

export type WasmGlobalImport = {
  readonly $tag: "WasmGlobalImport";
  readonly module: string;
  readonly name: string;
  readonly valType: WasmValType;
  readonly mutable: boolean;
};

export type WasmImport = WasmFuncImport | WasmMemImport | WasmGlobalImport;

// ---------------------------------------------------------------------------
// Instructions — typed ADT of the Wasm opcodes Phase 13 needs.
//
// Phase 13 subset:
//   - Numeric: i32/f64 constants + the arithmetic + comparison ops the
//     bootstrap exercises.
//   - Locals: get / set / tee.
//   - Control: structured `if` / `block` / `loop` + `br` / `br_if` + return.
//   - Calls: direct `call` (by function index) + indirect `call_indirect`
//     (by table + type index, for closure invocation in a follow-on phase).
//   - Reference: `ref.null externref`, `ref.is_null`.
//   - WasmGC: `struct.new` / `struct.get` / `struct.set` / `array.new` /
//     `array.get` declared but not emitted by the bootstrap.
//   - Exception handling: `try` / `throw` / `catch` declared as variants;
//     bootstrap uses tagged-union return values (see brief — option 1 over
//     option 2 for Result propagation).
//
// Adding an op = a new variant + an encoder case in `compile-wasm.ts`.
// ---------------------------------------------------------------------------

/** Block type for structured control flow. `Empty` = no result; `Result T`
 *  = single result of type T; `FuncType idx` = arbitrary multi-result
 *  signature (used when the block has multiple results). */
export type WasmBlockType =
  | { readonly $tag: "BlockTypeEmpty" }
  | { readonly $tag: "BlockTypeValue"; readonly valType: WasmValType }
  | { readonly $tag: "BlockTypeFunc"; readonly typeIdx: number };

export const BLOCK_EMPTY: WasmBlockType = { $tag: "BlockTypeEmpty" };
export function blockResult(valType: WasmValType): WasmBlockType {
  return { $tag: "BlockTypeValue", valType };
}

export type WasmInstr =
  // ---- Constants ----
  | { readonly $tag: "I32Const"; readonly value: number }
  | { readonly $tag: "I64Const"; readonly value: bigint }
  | { readonly $tag: "F32Const"; readonly value: number }
  | { readonly $tag: "F64Const"; readonly value: number }
  // ---- Locals ----
  | { readonly $tag: "LocalGet"; readonly index: number }
  | { readonly $tag: "LocalSet"; readonly index: number }
  | { readonly $tag: "LocalTee"; readonly index: number }
  // ---- i32 arithmetic / logic ----
  | { readonly $tag: "I32Add" }
  | { readonly $tag: "I32Sub" }
  | { readonly $tag: "I32Mul" }
  | { readonly $tag: "I32DivS" }
  | { readonly $tag: "I32RemS" }
  | { readonly $tag: "I32And" }
  | { readonly $tag: "I32Or" }
  | { readonly $tag: "I32Xor" }
  | { readonly $tag: "I32Eqz" }
  | { readonly $tag: "I32Eq" }
  | { readonly $tag: "I32Ne" }
  | { readonly $tag: "I32LtS" }
  | { readonly $tag: "I32LeS" }
  | { readonly $tag: "I32GtS" }
  | { readonly $tag: "I32GeS" }
  // ---- f64 arithmetic ----
  | { readonly $tag: "F64Add" }
  | { readonly $tag: "F64Sub" }
  | { readonly $tag: "F64Mul" }
  | { readonly $tag: "F64Div" }
  | { readonly $tag: "F64Neg" }
  | { readonly $tag: "F64Abs" }
  // ---- f64 comparison (→ i32 0/1) ----
  | { readonly $tag: "F64Eq" }
  | { readonly $tag: "F64Ne" }
  | { readonly $tag: "F64Lt" }
  | { readonly $tag: "F64Le" }
  | { readonly $tag: "F64Gt" }
  | { readonly $tag: "F64Ge" }
  // ---- Conversions ----
  | { readonly $tag: "I32WrapI64" }
  | { readonly $tag: "I64ExtendI32S" }
  | { readonly $tag: "F64ConvertI32S" }
  | { readonly $tag: "I32TruncF64S" }
  // ---- Control flow ----
  | {
      readonly $tag: "If";
      readonly blockType: WasmBlockType;
      readonly then: readonly WasmInstr[];
      readonly else: readonly WasmInstr[];
    }
  | {
      readonly $tag: "Block";
      readonly blockType: WasmBlockType;
      readonly body: readonly WasmInstr[];
    }
  | {
      readonly $tag: "Loop";
      readonly blockType: WasmBlockType;
      readonly body: readonly WasmInstr[];
    }
  | { readonly $tag: "Br"; readonly depth: number }
  | { readonly $tag: "BrIf"; readonly depth: number }
  | { readonly $tag: "Return" }
  | { readonly $tag: "Unreachable" }
  | { readonly $tag: "Nop" }
  | { readonly $tag: "Drop" }
  | { readonly $tag: "Select" }
  // ---- Calls ----
  | { readonly $tag: "Call"; readonly funcIdx: number }
  | { readonly $tag: "CallIndirect"; readonly typeIdx: number; readonly tableIdx: number }
  // ---- Reference ops ----
  | { readonly $tag: "RefNull"; readonly heapType: "externref" | "funcref" }
  | { readonly $tag: "RefIsNull" }
  // ---- WasmGC (declared for follow-on phases) ----
  | { readonly $tag: "StructNew"; readonly typeIdx: number }
  | {
      readonly $tag: "StructGet";
      readonly typeIdx: number;
      readonly fieldIdx: number;
    }
  | {
      readonly $tag: "StructSet";
      readonly typeIdx: number;
      readonly fieldIdx: number;
    }
  | { readonly $tag: "ArrayNew"; readonly typeIdx: number }
  | { readonly $tag: "ArrayGet"; readonly typeIdx: number }
  | { readonly $tag: "ArraySet"; readonly typeIdx: number }
  | { readonly $tag: "ArrayLen" }
  // ---- Exception handling (declared for follow-on phases) ----
  | {
      readonly $tag: "Try";
      readonly blockType: WasmBlockType;
      readonly body: readonly WasmInstr[];
      readonly catches: readonly { readonly tagIdx: number; readonly body: readonly WasmInstr[] }[];
      readonly catchAll?: readonly WasmInstr[];
    }
  | { readonly $tag: "Throw"; readonly tagIdx: number };

// ---------------------------------------------------------------------------
// Functions — typed signatures + locals + body
// ---------------------------------------------------------------------------

/** Local variable declaration: `count` consecutive locals of `valType`.
 *  Wasm RLE-encodes locals this way; the AST mirrors it. */
export type WasmLocalDecl = {
  readonly count: number;
  readonly valType: WasmValType;
};

export type WasmFunc = {
  readonly $tag: "WasmFunc";
  /** Debug name (also reused as the export name when this function is
   *  exported). */
  readonly name: string;
  readonly funcType: WasmFuncType;
  /** Additional locals beyond the params. Wasm's locals are a single
   *  combined index space (params first, then declared locals); a
   *  reference to local `params.length + i` reads the i-th declared
   *  local. */
  readonly locals: readonly WasmLocalDecl[];
  readonly body: readonly WasmInstr[];
};

// ---------------------------------------------------------------------------
// Exports — Phase 13 emits a single function export per compiled program
// ---------------------------------------------------------------------------

export type WasmExport = {
  readonly $tag: "WasmExport";
  readonly name: string;
  readonly kind: "func" | "table" | "memory" | "global";
  readonly index: number;
};

// ---------------------------------------------------------------------------
// Component Model surface — `wit` interface (stretch goal per the brief)
//
// Declared as metadata on the module so a future
// `Codec<String, WitInterface>` sibling can emit `.wit` text alongside the
// `.wasm` binary. Phase 13 doesn't ship the encoder; the field is present
// so the Wasm-component-aware tooling can read the typed signatures from
// the same source of truth as the binary.
// ---------------------------------------------------------------------------

export type WasmComponentExport = {
  /** Function name as exposed to the component world. */
  readonly name: string;
  /** Param names + their high-level Fenel types (informational; the wire
   *  shape uses the function's Wasm types). */
  readonly params: ReadonlyArray<CompileFieldSlot>;
  /** Return value's high-level Fenel type. */
  readonly returnType?: unknown;
};

// ---------------------------------------------------------------------------
// WasmModule — the program-level envelope
//
// Mirrors `JsModule` in shape. Phase 13 emits one entry function per
// program; the type / import / export sections are populated to match.
// ---------------------------------------------------------------------------

export type WasmModule = {
  readonly $tag: "WasmModule";
  /** Source-level name (for debugging; also used as the entry export name
   *  when no explicit override is set). */
  readonly name: string;
  /** Resolved entry parameter reflection; never serialized into Wasm names. */
  readonly fieldSlots: readonly CompileFieldSlot[];
  /** Unique type declarations in the module. Indexed by position. */
  readonly types: readonly WasmTypeDecl[];
  /** Imported functions / memories / globals. Imported functions occupy
   *  the low indices of the function index space; locally-defined
   *  functions follow. */
  readonly imports: readonly WasmImport[];
  /** Locally-defined functions. Each function references one of the
   *  declared types by index. */
  readonly funcs: readonly WasmFunc[];
  /** Exported entities. Phase 13 emits a single function export. */
  readonly exports: readonly WasmExport[];
  /** Optional Component Model surface — populated when the lowering knows
   *  the high-level Fenel signature. */
  readonly componentExports?: readonly WasmComponentExport[];
  /** String literals interned from the source body. Indexed by position;
   *  the lowered code references them via `$fenel.litString(<idx>)`
   *  imports. The host runtime populates `$fenel.litString` from this
   *  pool at instantiation time. Phase 15 — added to support string args
   *  in effect-dispatch sites (e.g. `HasStateIO.set("key", v)`). */
  readonly stringPool?: readonly string[];
};

// ---------------------------------------------------------------------------
// Helpers — index-space arithmetic
//
// Wasm has a single function index space: imported functions first, then
// locally-defined functions. These helpers compute the right index for a
// given function so call-site emission doesn't have to track the boundary
// manually.
// ---------------------------------------------------------------------------

/** Count of function imports in the module — the first locally-defined
 *  function's index. */
export function importFuncCount(mod: WasmModule): number {
  let n = 0;
  for (const imp of mod.imports) {
    if (imp.$tag === "WasmFuncImport") n++;
  }
  return n;
}

/** Index of an imported function by (module, name), or -1 if not found. */
export function findImportIdx(
  mod: WasmModule,
  modName: string,
  name: string,
): number {
  let idx = 0;
  for (const imp of mod.imports) {
    if (imp.$tag === "WasmFuncImport") {
      if (imp.module === modName && imp.name === name) return idx;
      idx++;
    }
  }
  return -1;
}
