// ---------------------------------------------------------------------------
// CompileLlvm module — the LLVM IR text instance of Compilable + the per-step
// Fenel functions + the LlvmModule ↔ String codec + composition.
//
// Phase 14 of the implementation roadmap. Sibling of Phase 5's CompileJs and
// Phase 13's CompileWasm. Pipeline:
//
//   Source AST (JSON Logic)
//     ── compileLlvmNormaliseToCore ──→ CoreProgram
//     ── compileLlvmMakeEffectsExplicit ──→ EffectsExplicitProgram
//     ── compileLlvmMakeClosuresExplicit ──→ ClosuresExplicitProgram
//     ── compileLlvmLowerToLlvmAst ──→ LlvmModule
//     ── compileLlvmSerializeLlvmModule (Iso<String, LlvmModule>) ──→ string
//
// The first three steps are REUSED from Phase 5 — the same Core /
// EffectsExplicit / ClosuresExplicit IR dialects feed into all three targets
// (JS, Wasm, LLVM). Phase 14 validates the substrate's target-agnosticism
// claim a second time: a new target is a `Compilable target` instance + a
// target IR ADT + a Codec; the engine-side architecture doesn't change.
//
// Bootstrapping moment (per the brief): when `compileFenelToLlvm` produces
// LLVM IR text that `llvm-as` parses + `lli` executes byte-identical to the
// engine's interpretation for the std-shaped pure-function subset.
//
// LLVM is the cross-language glue — Rust, Swift, Julia, Crystal, Pony,
// Haskell-via-LLVM, Clang/C, Lean 4 (via C), and dozens more lower through
// it. Adopting LLVM opens the path to native code (via `llc` / `clang` /
// `lld`), profile-guided optimisation, link-time optimisation, and every
// LLVM-backed analysis pass. Per `design/survey/compilers-and-runtimes.md`
// §2.1 and recommendation R5 (tiered execution: interpreter → fast-JIT →
// optimised-AOT), LLVM is the natural choice for the slow optimising AOT
// tier — Phase 14 ships the IR text emitter; future phases compose
// `Iso<Bytes, LlvmBitcode>` and the clang-based pipeline for object /
// executable output.
// ---------------------------------------------------------------------------

import type { FenelModule, Instance } from "../types";
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
  dispatchedLowerToLlvmAst,
  dispatchedSerializeLlvmModule,
  withEngineDispatchEvaluationSnapshot,
} from "../engine-bodies-dispatch";
import type { LlvmModule } from "../ir/llvm-ast";
import {
  LLVM_VOID,
  llvmValTypeEqual,
} from "../ir/llvm-ast";
import IR_TYPES_SRC from "../../../../../fenel/modules/engine/ir-types.fenel?raw";
import LLVM_TYPES_SRC from "../../../../../fenel/modules/compile-llvm/types.fenel?raw";
import COMPILE_LLVM_INSTANCES_FENEL from "../../../../../fenel/modules/compile-llvm/instances.fenel?raw";
import COMPILE_LLVM_SIGS_FENEL from "../../../../../fenel/modules/compile-llvm/sigs.fenel?raw";

// ---------------------------------------------------------------------------
// Fenel-authored function-spec surface — Phase 3v.5 (module-substrate)
// sources the 7 `compile-llvm:<step>` sigs from `compile-llvm/sigs.fenel`
// via a `loadFenelModuleUnion` over types/instances/sigs.fenel. Three of the
// seven sigs (normaliseToCore / makeEffectsExplicit / makeClosuresExplicit)
// carry an `@codeName "…ForLlvm"` directive that preserves the byte-
// identical codeName the retired TS spec set. The hyphen in `compile-llvm`
// keeps a `module compile-llvm where` header from parsing, so the loader
// arg supplies the function-id namespace instead. The container itself is
// `compileLlvm` (see the module export below).
// ---------------------------------------------------------------------------

const compileLlvmUnion = loadFenelModuleUnion([
  { src: LLVM_TYPES_SRC, name: "compile-llvm" },
  { src: COMPILE_LLVM_INSTANCES_FENEL, name: "compile-llvm", opts: { dispatchInstanceFile: true } },
  { src: COMPILE_LLVM_SIGS_FENEL, name: "compile-llvm" },
]).find((m) => m.name === "compile-llvm");
if (!compileLlvmUnion) {
  throw new Error(
    "compile-llvm: loadFenelModuleUnion did not yield the `compile-llvm` group — Fenel sources out of sync with the seam (every compile-llvm/*.fenel must load under the `compile-llvm` arg)",
  );
}

// ---------------------------------------------------------------------------
// Steps 1-3: reuse Phase 5's lowering (same as Phase 13)
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
// Step 4: lowerToLlvmAst — ClosuresExplicit → LlvmModule
//
// Phase 21.8 — the lowering ported to a Fenel body. The TS impl that
// used to live here (LlvmDomain ADT, Builder type, ~2000 LOC of per-
// CeExpr lowering helpers, coerceDomain table, top-level entry) was
// deleted; the production path now dispatches through
// `dispatchedLowerToLlvmAst` which evaluates the Fenel-bodied
// `engine:lowerToLlvmAst` function against a per-call HasLlvmBuilder
// natives map.
//
// Compare to Phase 21.7 Wasm port (compile-wasm.ts:lowerToWasmAst,
// now also a thin dispatch wrapper). The LLVM-target analogue of the
// final TS-only step is `emitModule` (the IR-text serialiser below),
// which mirrors the TS-only `serializeWasmModule` on the Wasm side.
// ---------------------------------------------------------------------------

function lowerToLlvmAstNative(input: unknown): CompileResult<LlvmModule> {
  if (!isClosuresExplicitProgram(input)) {
    return compileErr(
      compileErrorUnsupported("lowerToLlvmAst expects a ClosuresExplicitProgram", input),
    );
  }
  return dispatchedLowerToLlvmAst(input);
}

// ---------------------------------------------------------------------------
// Step 5: serialize LlvmModule → string (the `.ll` text format)
//
// Per the LLVM Language Reference Manual. The text format is human-readable
// and the canonical wire format for LLVM IR; tooling (`llvm-as`, `llc`,
// `opt`, `lli`) consumes it directly.
//
// Phase 21.10 — the IR-text emitter (originally Phase 14's ~230 LOC TS
// implementation: emitValType / emitDoubleLiteral / emitOperand /
// emitInstr / emitTerminator / emitBasicBlock / emitParams /
// emitDeclaration / emitDefinition / emitModule / emitStringConstant +
// the LLVM_INSTR_NAMES table) has been ported to a Fenel body. The
// production path now dispatches through `dispatchedSerializeLlvmModule`
// which evaluates the Fenel-bodied `engine:emitLlvmModule` function
// against the typed LlvmModule. Closes the LLVM pipeline: every step
// from raw source to IR text now runs through Fenel bodies. The
// retained `serializeLlvmModuleNative` is a thin shell that delegates
// to the dispatch wrapper.
// ---------------------------------------------------------------------------

function serializeLlvmModuleNative(input: unknown):
  | { $tag: "Ok"; _0: string }
  | { $tag: "Err"; _0: string } {
  return dispatchedSerializeLlvmModule(input);
}

// ---------------------------------------------------------------------------
// Decode side — Phase 14 placeholder, same posture as compile-js's
// `deserializeJsModule` + compile-wasm's `deserializeWasmModule`. Parsing
// `.ll` text back to a typed LlvmModule lands when a use case demands it
// (round-tripping optimised output, reading external IR for further
// rewriting, etc.).
// ---------------------------------------------------------------------------

function deserializeLlvmModuleNative(input: unknown): { $tag: "Err"; _0: string } {
  void input;
  return {
    $tag: "Err",
    _0: "Phase 14: deserializeLlvmModule is a placeholder; parse-side codec is out of scope.",
  };
}

// ---------------------------------------------------------------------------
// Composition: compileFenelToLlvm — the top-level pipeline
// ---------------------------------------------------------------------------

function compileFenelToLlvmNative(input: unknown): CompileResult<LlvmModule> {
  return withEngineDispatchEvaluationSnapshot(() => {
    const step1 = normaliseToCoreNative(input);
    if (step1.$tag === "Err") return step1 as CompileResult<LlvmModule>;
    const step2 = makeEffectsExplicitNative(step1._0);
    if (step2.$tag === "Err") return step2 as CompileResult<LlvmModule>;
    const step3 = makeClosuresExplicitNative(step2._0);
    if (step3.$tag === "Err") return step3 as CompileResult<LlvmModule>;
    return lowerToLlvmAstNative(step3._0);
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

function isClosuresExplicitProgram(x: unknown): x is ClosuresExplicitProgram {
  return (
    typeof x === "object" &&
    x !== null &&
    (x as Record<string, unknown>)["$tag"] === "ClosuresExplicitProgram"
  );
}

// Silence unused warnings — exported types may surface in follow-on phases.
// `isLlvmModule` was the structural guard for the deleted (Phase 21.10)
// `serializeLlvmModuleNative` body; the dispatch wrapper owns the guard
// now (`isLlvmModuleDispatch` in engine-bodies-dispatch.ts).
void LLVM_VOID;
void llvmValTypeEqual;

// ---------------------------------------------------------------------------
// Fenel function specs — Phase 3v.5 (module-substrate) sourced the spec
// surface from `compile-llvm/sigs.fenel` via the union above. Every step is
// surfaced through the registry so downstream tooling — editor pickers,
// function-detail pages, audit scripts — can introspect / replace any
// individual pass. The 7 `defineFunction` blocks + `collectFunctions` call +
// `_compileLlvmDefined` const + the type-token consts retired here; the
// payload now lives in the `.fenel` file as `@native` sigs + identity
// facets (with `@codeName "*ForLlvm"` on the three target-suffixed steps).
// ---------------------------------------------------------------------------

const compileLlvmFunctions = compileLlvmUnion.functions ?? [];
const compileLlvmInstancesAll = compileLlvmUnion.instances ?? [];

// ---------------------------------------------------------------------------
// Native impls table
// ---------------------------------------------------------------------------

const compileLlvmNatives: Record<string, (...args: unknown[]) => unknown> = {
  normaliseToCoreForLlvm: (source) => normaliseToCoreNative(source),
  makeEffectsExplicitForLlvm: (core) => makeEffectsExplicitNative(core),
  makeClosuresExplicitForLlvm: (ee) => makeClosuresExplicitNative(ee),
  lowerToLlvmAst: (ce) => lowerToLlvmAstNative(ce),
  serializeLlvmModule: (mod) => serializeLlvmModuleNative(mod),
  deserializeLlvmModule: (encoded) => deserializeLlvmModuleNative(encoded),
  compileFenelToLlvm: (source) => compileFenelToLlvmNative(source),
};

// ---------------------------------------------------------------------------
// Instances — CompileLlvm : Compilable LlvmModule + Iso<String, LlvmModule>
// ---------------------------------------------------------------------------

// ---------------------------------------------------------------------------
// Instance projections — pulled from the union's instance list (sourced from
// `instances.fenel`). Phase 3.1 (typeclass-substrate-completion) authored
// these as Fenel-side typed values; Phase 3v.5 (module-substrate) routes the
// lookup through the same union the sig surface flows through. The exported
// consts are thin projection lookups (the engine barrel re-exports them).
// ---------------------------------------------------------------------------

const pickCompileLlvmInst = (typeName: string, args: string[]): Instance => {
  const key = JSON.stringify(args);
  const found = compileLlvmInstancesAll.find(
    (i) => i.typeName === typeName && JSON.stringify(i.args) === key,
  );
  if (!found) throw new Error(`compile-llvm: missing Fenel instance ${typeName} ${key}`);
  return found;
};

/**
 * `CompileLlvm : Compilable LlvmModule` — the LLVM-target Compilable
 * instance. `compile` resolves to the composed pipeline function. Sibling
 * of `compileJsInstance` (Phase 5) and `compileWasmInstance` (Phase 13).
 */
export const compileLlvmInstance: Instance = pickCompileLlvmInst("Compilable", ["LlvmModule"]);

/**
 * `Encodable<String, LlvmModule>` — the one-way codec from the typed
 * `LlvmModule` to the LLVM IR text format (`.ll`). Demoted from `Iso` in
 * expr-substrate Phase 6c: `deserializeLlvmModule` is the documented
 * Phase-14 placeholder (unconditional Err), so the Iso bijectivity laws
 * were unsatisfiable. Re-promote when a parse-side codec lands. The
 * bytecode form (`.bc`) stays a follow-on-phase sibling.
 */
export const encodableLlvmModule: Instance = pickCompileLlvmInst("Encodable", ["String", "LlvmModule"]);

// ---------------------------------------------------------------------------
// Module export — picked up by SYSTEM_MODULES in system-entities.ts /
// system-registry.ts. Recurring lesson: BOTH registries must list the new
// module (per CLAUDE.md note from prior phases; resurfaced in Phases 2, 5,
// 13, and now 14).
// ---------------------------------------------------------------------------

// ---------------------------------------------------------------------------
// Phase 4h — compile-pipeline IR program-envelope entities. The shared
// `ir-types.fenel` is owned by engineModule and pulled in here under
// `name: "engine"`; the target-specific compile-llvm entities ride the
// 3v.5 union above. `registerCatalogEntities` dedupes by id so the first
// registration wins. Loading both into `compileLlvmModule.entities` surfaces
// the function-spec tokens through the system-registry catalog walk.
//
// modules-as-values (2026-09-24) — the container is `compileLlvm`, an
// identifier, so its members read dotted; `functionNamespace` keeps every
// function id `compile-llvm:*`. The target types are members of this
// container, so they are restamped from the loader's `compile-llvm` to
// `compileLlvm` (`compiler-target-entities.ts` selects them by
// `module === name`); their `.fenel.lock` field rows were re-keyed to
// `type:compileLlvm:…` in place, keeping every UUID. The shared IR types stay
// owned by `engine`.
// ---------------------------------------------------------------------------

const compileLlvmIrTypesModule = loadFenelModule(IR_TYPES_SRC, "engine");

const compileLlvmEntities = [
  ...(compileLlvmIrTypesModule.entities ?? []),
  ...(compileLlvmUnion.entities ?? []).map((entity) => ({ ...entity, module: "compileLlvm" })),
];

export const compileLlvmModule: FenelModule = {
  name: "compileLlvm",
  functionNamespace: "compile-llvm",
  label: "Compile (LLVM IR text target)",
  functions: compileLlvmFunctions,
  instances: compileLlvmInstancesAll,
  entities: compileLlvmEntities,
  nativeImpls: rekeyNativesById(compileLlvmNatives, "compile-llvm"),
};

// Re-export the natives + composition for direct use in tests.
export {
  normaliseToCoreNative,
  makeEffectsExplicitNative,
  makeClosuresExplicitNative,
  lowerToLlvmAstNative,
  serializeLlvmModuleNative,
  compileFenelToLlvmNative,
  compileLlvmNatives,
};
