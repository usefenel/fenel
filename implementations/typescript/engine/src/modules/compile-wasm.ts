// ---------------------------------------------------------------------------
// CompileWasm module — the WebAssembly 3.0 instance of Compilable + the
// per-step Fenel functions + the WasmModule ↔ Bytes codec + composition.
//
// Phase 13 of the implementation roadmap. Mirrors Phase 5's CompileJs in
// shape. Pipeline:
//
//   Source AST (JSON Logic)
//     ── compileWasmNormaliseToCore ──→ CoreProgram
//     ── compileWasmMakeEffectsExplicit ──→ EffectsExplicitProgram
//     ── compileWasmMakeClosuresExplicit ──→ ClosuresExplicitProgram
//     ── compileWasmLowerToWasmAst ──→ WasmModule
//     ── compileWasmSerializeWasmModule (Iso<Bytes, WasmModule>) ──→ Uint8Array
//
// The first three steps are REUSED from Phase 5 — the same Core /
// EffectsExplicit / ClosuresExplicit IR dialects feed into both targets.
// Validates the substrate's target-agnosticism claim: adding a new target
// is a `Compilable target` instance + a target IR ADT + a serialiser; the
// engine-side architecture doesn't change.
//
// Bootstrapping moment (per the brief): when `compileFenelToWasm` produces
// a Wasm module that, when instantiated via `WebAssembly.instantiate(bytes,
// imports)` and invoked, returns the same values as the engine's
// interpretation for the std-shaped pure-function subset.
// ---------------------------------------------------------------------------

import type {
  FenelModule,
  Instance,
} from "../types";
import { rekeyNativesById } from "../function-builder";
import { loadFenelModule, loadFenelModuleUnion } from "../fenel-module";
import type { CompileResult, CompileSource } from "../compilable";
import {
  compileErrorUnsupported,
  compileErr,
  compileSourceFromUnknown,
} from "../compilable";
import type { CoreProgram } from "../ir/core";
import type { EffectsExplicitProgram } from "../ir/effects-explicit";
import type { ClosuresExplicitProgram } from "../ir/closures-explicit";
import {
  dispatchedMakeEffectsExplicit,
  dispatchedMakeClosuresExplicit,
  dispatchedNormaliseToCore,
  dispatchedLowerToWasmAst,
  dispatchedSerializeWasmModule,
  withEngineDispatchEvaluationSnapshot,
} from "../engine-bodies-dispatch";
import type {
  WasmExport,
  WasmFunc,
  WasmFuncType,
  WasmModule,
  WasmValType,
} from "../ir/wasm-ast";
import {
  EXTERNREF,
  F64,
  I32,
} from "../ir/wasm-ast";
import IR_TYPES_SRC from "../../../../../fenel/modules/engine/ir-types.fenel?raw";
import WASM_TYPES_SRC from "../../../../../fenel/modules/compile-wasm/types.fenel?raw";
import COMPILE_WASM_INSTANCES_FENEL from "../../../../../fenel/modules/compile-wasm/instances.fenel?raw";
import COMPILE_WASM_SIGS_FENEL from "../../../../../fenel/modules/compile-wasm/sigs.fenel?raw";

// ---------------------------------------------------------------------------
// Fenel-authored function-spec surface — Phase 3v.5 (module-substrate)
// sources the 7 `compile-wasm:<step>` sigs from `compile-wasm/sigs.fenel`
// via a `loadFenelModuleUnion` over types/instances/sigs.fenel. Three of the
// seven sigs (normaliseToCore / makeEffectsExplicit / makeClosuresExplicit)
// carry an `@codeName "…ForWasm"` directive that preserves the byte-
// identical codeName the retired TS spec set. The hyphen in `compile-wasm`
// keeps a `module compile-wasm where` header from parsing, so the loader
// arg supplies the function-id namespace instead. The container itself is
// `compileWasm` (see the module export below).
// ---------------------------------------------------------------------------

const compileWasmUnion = loadFenelModuleUnion([
  { src: WASM_TYPES_SRC, name: "compile-wasm" },
  { src: COMPILE_WASM_INSTANCES_FENEL, name: "compile-wasm", opts: { dispatchInstanceFile: true } },
  { src: COMPILE_WASM_SIGS_FENEL, name: "compile-wasm" },
]).find((m) => m.name === "compile-wasm");
if (!compileWasmUnion) {
  throw new Error(
    "compile-wasm: loadFenelModuleUnion did not yield the `compile-wasm` group — Fenel sources out of sync with the seam (every compile-wasm/*.fenel must load under the `compile-wasm` arg)",
  );
}

// ---------------------------------------------------------------------------
// Steps 1-3: reuse Phase 5's lowering
// ---------------------------------------------------------------------------

function normaliseToCoreNative(input: unknown): CompileResult<CoreProgram> {
  const src = asCompileSource(input);
  if (src.$tag === "Err") return src as CompileResult<CoreProgram>;
  return dispatchedNormaliseToCore(src._0);
}

function makeEffectsExplicitNative(input: unknown): CompileResult<EffectsExplicitProgram> {
  if (!isCoreProgram(input)) {
    return compileErr(compileErrorUnsupported("makeEffectsExplicit expects a CoreProgram", input));
  }
  return dispatchedMakeEffectsExplicit(input);
}

function makeClosuresExplicitNative(input: unknown): CompileResult<ClosuresExplicitProgram> {
  if (!isEffectsExplicitProgram(input)) {
    return compileErr(
      compileErrorUnsupported("makeClosuresExplicit expects an EffectsExplicitProgram", input),
    );
  }
  return dispatchedMakeClosuresExplicit(input);
}

// ---------------------------------------------------------------------------
// Step 4: lowerToWasmAst — ClosuresExplicit → WasmModule
//
// This is the only Phase 13-specific lowering. The other three steps reuse
// Phase 5 directly, which is the load-bearing demonstration that the
// substrate is target-agnostic.
//
// Wasm representation strategy:
//
//   - Numbers → f64 (matches the engine's number model: JS-native doubles)
//   - Booleans → i32 internally (Wasm-native; `f64.lt` etc. produce i32),
//     boxed to JS booleans at the function-return boundary via the
//     `$fenel.boxBool` runtime import
//   - Strings / ADTs / other values → externref (host-managed; the JS host
//     passes the underlying JS value through opaquely)
//   - Runtime helpers — anything that isn't a direct Wasm numeric op
//     routes through a `$fenel.<name>(...)` import. Phase 13 ships:
//
//       boxBool(i32 → externref) — wrap a Wasm-i32 bool into JS true/false
//       concat(externref, externref → externref) — string/array concat
//       <fnId>(externref... → externref) — fallback for any other call
//
//   - Constructors / records / pattern matching — Phase 13 routes them
//     through `$fenel.<ctor>` style helpers (matching the JS target's
//     "the host owns the runtime representation" posture). WasmGC-native
//     structs are a follow-on phase.
//
// Param type inference: walk the body collecting how each param is used.
// Add/sub/mul/div/etc. → f64. concat / unknown call → externref. The
// inferred types drive the function signature.
// ---------------------------------------------------------------------------

/** Domain of a Wasm value at the source level — drives type inference. */
export type WasmDomain =
  | { readonly $tag: "DomNum" } // f64
  | { readonly $tag: "DomBool" } // i32 internally, boxed externref at boundary
  | { readonly $tag: "DomRef" } // externref (string / ADT / record / …)
  | { readonly $tag: "DomUnknown" }; // not yet inferred

export const DOM_NUM: WasmDomain = { $tag: "DomNum" };
export const DOM_BOOL: WasmDomain = { $tag: "DomBool" };
export const DOM_REF: WasmDomain = { $tag: "DomRef" };
export const DOM_UNKNOWN: WasmDomain = { $tag: "DomUnknown" };

export function domainToValType(d: WasmDomain): WasmValType {
  switch (d.$tag) {
    case "DomNum":
      return F64;
    case "DomBool":
      return I32;
    case "DomRef":
    case "DomUnknown":
      return EXTERNREF;
  }
}

// ---------------------------------------------------------------------------
// Module-builder state — collects type signatures, imports, locals, and the
// final instruction stream while lowering one ClosuresExplicit program.
// ---------------------------------------------------------------------------

export type ModuleBuilder = {
  /** Function-type signatures collected for the type section, deduplicated
   *  by structural equality on (params, results). */
  types: WasmFuncType[];
  /** Imports collected. Each is one function import; the index of an
   *  import in the function index space is its position in this array
   *  (imports come before locally-defined functions). */
  imports: { module: string; name: string; typeIdx: number }[];
  /** Set of `<module>.<name>` imports needed; deduplicated. */
  importedNames: Map<string, { typeIdx: number; idx: number }>;
  /** Interned string literals — deduplicated by value. The map's index
   *  is the position in the per-module string pool; the lowered Wasm
   *  emits `i32.const <idx>; call $fenel.litString` to push the string
   *  as an externref. Phase 15 — supports string args in effect dispatch
   *  sites (e.g. `HasStateIO.set("key", v)`). */
  stringPool: Map<string, number>;
  /** Phase 18: per-closure Wasm functions accumulated during lowering.
   *  Each CeClosure emits one entry — the closure body lowered as a
   *  separate WasmFunc + exported under its `<entry>__cl<N>` name so
   *  the host runtime's `$fenel.callClosure` helper can resolve and
   *  invoke it. */
  pendingFuncs: WasmFunc[];
  /** Phase 18: matching exports for closure-body functions. The host
   *  uses `instance.exports[<entry>__cl<N>]` at invocation time. */
  pendingExports: WasmExport[];
  /** Phase 18: counter for fresh closure-body names. Bound to the
   *  program entry name so the symbol space is deterministic per
   *  compilation (`<entry>__cl0`, `<entry>__cl1`, …). */
  nextClosureId: number;
  /** Phase 18: entry-name prefix for closure-body name generation. */
  entryName: string;
};

export function newBuilder(entryName: string): ModuleBuilder {
  return {
    types: [],
    imports: [],
    importedNames: new Map(),
    stringPool: new Map(),
    pendingFuncs: [],
    pendingExports: [],
    nextClosureId: 0,
    entryName,
  };
}

/** Intern a string literal and return its pool index. Same string returns
 *  the same index; new strings extend the pool. */
export function internString(b: ModuleBuilder, value: string): number {
  const existing = b.stringPool.get(value);
  if (existing !== undefined) return existing;
  const idx = b.stringPool.size;
  b.stringPool.set(value, idx);
  return idx;
}

/** Intern a function type into the type section; returns its index. */
export function internType(b: ModuleBuilder, ft: WasmFuncType): number {
  for (let i = 0; i < b.types.length; i++) {
    if (funcTypeEqual(b.types[i]!, ft)) return i;
  }
  b.types.push(ft);
  return b.types.length - 1;
}

function funcTypeEqual(a: WasmFuncType, b: WasmFuncType): boolean {
  if (a.params.length !== b.params.length) return false;
  if (a.results.length !== b.results.length) return false;
  for (let i = 0; i < a.params.length; i++) {
    if (!valTypeEqual(a.params[i]!, b.params[i]!)) return false;
  }
  for (let i = 0; i < a.results.length; i++) {
    if (!valTypeEqual(a.results[i]!, b.results[i]!)) return false;
  }
  return true;
}

function valTypeEqual(a: WasmValType, b: WasmValType): boolean {
  if (a.$tag !== b.$tag) return false;
  if (a.$tag === "RefStruct" || a.$tag === "RefArray") {
    return a.typeIdx === (b as typeof a).typeIdx;
  }
  return true;
}

/** Intern a runtime helper import `$fenel.<name>` with the given function
 *  type; returns the function index. */
export function internImport(
  b: ModuleBuilder,
  name: string,
  ft: WasmFuncType,
): number {
  return internImportInModule(b, "$fenel", name, ft);
}

/** Intern an import in an arbitrary module namespace. The cache key is
 *  `<module>.<name>` so different modules can hold imports with the same
 *  local name (e.g. `$effect.HasStateIO.set` vs `$effect.HasCryptoRandom.set`
 *  collide on `set` if we keyed by name only). */
export function internImportInModule(
  b: ModuleBuilder,
  moduleName: string,
  name: string,
  ft: WasmFuncType,
): number {
  const key = `${moduleName}.${name}`;
  const existing = b.importedNames.get(key);
  if (existing !== undefined) return existing.idx;
  const typeIdx = internType(b, ft);
  const idx = b.imports.length;
  b.imports.push({ module: moduleName, name, typeIdx });
  b.importedNames.set(key, { typeIdx, idx });
  return idx;
}

// ---------------------------------------------------------------------------
// Step 5: serialize WasmModule → Uint8Array (the `.wasm` binary format)
//
// Phase 21.10.1 — fully Fenel-bodied. The encoder lives in
// `fenel/modules/engine/lower-to-wasm-ast.fenel` as `engine:encodeWasmModule`
// + ~40 helpers (encodeU32Leb / encodeS32Leb / encodeWasmValType /
// encodeWasmInstr / encodeWasmSection / …). This file retains only the
// thin `serializeWasmModuleNative` shell that forwards to the dispatch
// wrapper and the `funcTypeEqual` helper still used by `internType` in
// the lowering builder. The ByteWriter class + INSTR_OPCODES table +
// per-construct encoders + the imperative `encodeWasmModule` body were
// deleted in Phase 21.10.1 (~350 LOC removed); the dispatch wrapper
// converts the Fenel body's `List Number` return into `Uint8Array` at
// the boundary.
// ---------------------------------------------------------------------------

function serializeWasmModuleNative(
  input: unknown,
): { $tag: "Ok"; _0: Uint8Array } | { $tag: "Err"; _0: string } {
  if (!isWasmModule(input)) {
    return { $tag: "Err", _0: "serializeWasmModule: expected a WasmModule input" };
  }
  return dispatchedSerializeWasmModule(input);
}

// ---------------------------------------------------------------------------
// Decode side — Phase 13 placeholder, same posture as compile-js's
// `deserializeJsModule`. Parsing back a `.wasm` binary into a typed
// WasmModule lands when a real use case demands it (e.g. round-tripping
// compiled output for further rewrites).
// ---------------------------------------------------------------------------

function deserializeWasmModuleNative(input: unknown): { $tag: "Err"; _0: string } {
  void input;
  return {
    $tag: "Err",
    _0: "Phase 13: deserializeWasmModule is a placeholder; parse-side codec is out of scope.",
  };
}

// ---------------------------------------------------------------------------
// Composition: compileFenelToWasm — the top-level pipeline
// ---------------------------------------------------------------------------

function compileFenelToWasmNative(input: unknown): CompileResult<WasmModule> {
  return withEngineDispatchEvaluationSnapshot(() => {
    const step1 = normaliseToCoreNative(input);
    if (step1.$tag === "Err") return step1 as CompileResult<WasmModule>;
    const step2 = makeEffectsExplicitNative(step1._0);
    if (step2.$tag === "Err") return step2 as CompileResult<WasmModule>;
    const step3 = makeClosuresExplicitNative(step2._0);
    if (step3.$tag === "Err") return step3 as CompileResult<WasmModule>;
    return dispatchedLowerToWasmAst(step3._0);
  });
}

// ---------------------------------------------------------------------------
// Helpers: shape guards
// ---------------------------------------------------------------------------

function asCompileSource(input: unknown): CompileResult<CompileSource> {
  return compileSourceFromUnknown(input);
}

function isCoreProgram(x: unknown): x is CoreProgram {
  return (
    typeof x === "object" && x !== null && (x as Record<string, unknown>)["$tag"] === "CoreProgram"
  );
}

function isEffectsExplicitProgram(x: unknown): x is EffectsExplicitProgram {
  return (
    typeof x === "object" &&
    x !== null &&
    (x as Record<string, unknown>)["$tag"] === "EffectsExplicitProgram"
  );
}

export function isClosuresExplicitProgram(x: unknown): x is ClosuresExplicitProgram {
  return (
    typeof x === "object" &&
    x !== null &&
    (x as Record<string, unknown>)["$tag"] === "ClosuresExplicitProgram"
  );
}

function isWasmModule(x: unknown): x is WasmModule {
  return (
    typeof x === "object" && x !== null && (x as Record<string, unknown>)["$tag"] === "WasmModule"
  );
}

// ---------------------------------------------------------------------------
// Fenel function specs — Phase 3v.5 (module-substrate) sourced the spec
// surface from `compile-wasm/sigs.fenel` via the union above. Every step is
// surfaced through the registry so downstream tooling — editor pickers,
// function-detail pages, audit scripts — can introspect / replace any
// individual pass. The 7 `defineFunction` blocks + `collectFunctions` call +
// `_compileWasmDefined` const + the type-token consts retired here; the
// payload now lives in the `.fenel` file as `@native` sigs + identity
// facets (with `@codeName "*ForWasm"` on the three target-suffixed steps).
// ---------------------------------------------------------------------------

const compileWasmFunctions = compileWasmUnion.functions ?? [];
const compileWasmInstancesAll = compileWasmUnion.instances ?? [];

// ---------------------------------------------------------------------------
// Native impls table
// ---------------------------------------------------------------------------

const compileWasmNatives: Record<string, (...args: unknown[]) => unknown> = {
  normaliseToCoreForWasm: (source) => normaliseToCoreNative(source),
  makeEffectsExplicitForWasm: (core) => makeEffectsExplicitNative(core),
  makeClosuresExplicitForWasm: (ee) => makeClosuresExplicitNative(ee),
  lowerToWasmAst: (ce) => dispatchedLowerToWasmAst(ce as ClosuresExplicitProgram),
  serializeWasmModule: (mod) => serializeWasmModuleNative(mod),
  deserializeWasmModule: (encoded) => deserializeWasmModuleNative(encoded),
  compileFenelToWasm: (source) => compileFenelToWasmNative(source),
};

// ---------------------------------------------------------------------------
// Instances — CompileWasm : Compilable WasmModule + Iso<Bytes, WasmModule>
// ---------------------------------------------------------------------------

// ---------------------------------------------------------------------------
// Instance projections — pulled from the union's instance list (sourced from
// `instances.fenel`). Phase 3.1 (typeclass-substrate-completion) authored
// these as Fenel-side typed values; Phase 3v.5 (module-substrate) routes the
// lookup through the same union the sig surface flows through. The exported
// consts are thin projection lookups (the engine barrel re-exports them).
// ---------------------------------------------------------------------------

const pickCompileWasmInst = (typeName: string, args: string[]): Instance => {
  const key = JSON.stringify(args);
  const found = compileWasmInstancesAll.find(
    (i) => i.typeName === typeName && JSON.stringify(i.args) === key,
  );
  if (!found) throw new Error(`compile-wasm: missing Fenel instance ${typeName} ${key}`);
  return found;
};

/**
 * `CompileWasm : Compilable WasmModule` — the Wasm-target Compilable
 * instance. `compile` resolves to the composed pipeline function. Sibling
 * of `compileJsInstance` from Phase 5.
 */
export const compileWasmInstance: Instance = pickCompileWasmInst("Compilable", ["WasmModule"]);

/**
 * `Encodable<Bytes, WasmModule>` — the one-way codec from the typed
 * `WasmModule` to `.wasm` bytes. Demoted from `Iso` in expr-substrate
 * Phase 6c: `deserializeWasmModule` is the documented Phase-13 placeholder
 * (unconditional Err), so the Iso bijectivity laws were unsatisfiable.
 * Re-promote when a parse-side codec lands.
 *
 * Naming convention: `Encodable<s, a>` reads `s = serialized,
 * a = structured` (the Phase 2 codec convention).
 */
export const encodableWasmModule: Instance = pickCompileWasmInst("Encodable", ["Bytes", "WasmModule"]);

// ---------------------------------------------------------------------------
// Module export — picked up by SYSTEM_MODULES in system-entities.ts /
// system-registry.ts. Recurring lesson: BOTH registries must list the new
// module (per CLAUDE.md note from prior phases).
// ---------------------------------------------------------------------------

// ---------------------------------------------------------------------------
// Phase 4h — compile-pipeline IR program-envelope entities. The shared
// `ir-types.fenel` is owned by engineModule and pulled in here under
// `name: "engine"`; the target-specific compile-wasm entities ride the
// 3v.5 union above. `registerCatalogEntities` dedupes by id so the first
// registration wins. Loading both into `compileWasmModule.entities` surfaces
// the function-spec tokens through the system-registry catalog walk.
//
// modules-as-values (2026-09-24) — the container is `compileWasm`, an
// identifier, so its members read dotted; `functionNamespace` keeps every
// function id `compile-wasm:*`. The target types are members of this
// container, so they are restamped from the loader's `compile-wasm` to
// `compileWasm` (`compiler-target-entities.ts` selects them by
// `module === name`); their `.fenel.lock` field rows were re-keyed to
// `type:compileWasm:…` in place, keeping every UUID. The shared IR types stay
// owned by `engine`.
// ---------------------------------------------------------------------------

const compileWasmIrTypesModule = loadFenelModule(IR_TYPES_SRC, "engine");

const compileWasmEntities = [
  ...(compileWasmIrTypesModule.entities ?? []),
  ...(compileWasmUnion.entities ?? []).map((entity) => ({ ...entity, module: "compileWasm" })),
];

export const compileWasmModule: FenelModule = {
  name: "compileWasm",
  functionNamespace: "compile-wasm",
  label: "Compile (Wasm 3.0 target)",
  functions: compileWasmFunctions,
  instances: compileWasmInstancesAll,
  entities: compileWasmEntities,
  nativeImpls: rekeyNativesById(compileWasmNatives, "compile-wasm"),
};

// Re-export the natives + composition for direct use in tests.
export {
  normaliseToCoreNative,
  makeEffectsExplicitNative,
  makeClosuresExplicitNative,
  serializeWasmModuleNative,
  compileFenelToWasmNative,
  compileWasmNatives,
};

// browser-engine-compat Phase 1b: self-register this module's live namespace so
// engineRequire("modules/compile-wasm") resolves even at EVAL-TIME (a caller that statically imports
// this module runs its own eval-time builder calls AFTER this module is fully loaded,
// i.e. before the index.ts aggregator runs). See engine-require.ts.
import * as __self_modules_compile_wasm from "./compile-wasm";
import { registerEngineModule as __reg_modules_compile_wasm } from "../engine-require";
__reg_modules_compile_wasm("modules/compile-wasm", __self_modules_compile_wasm);
