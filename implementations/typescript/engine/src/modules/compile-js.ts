// ---------------------------------------------------------------------------
// CompileJs module — the JS-target instance of Compilable + the per-step
// Fenel functions + the JsAst <-> String codec + the composition.
//
// Phase 5 of the implementation roadmap. Bring together the four IR
// dialects (Core / EffectsExplicit / ClosuresExplicit / JsAst) into one
// end-to-end pipeline:
//
//   Source AST (JSON Logic)
//     ── compileJsNormaliseToCore ──→ CoreProgram
//     ── compileJsMakeEffectsExplicit ──→ EffectsExplicitProgram
//     ── compileJsMakeClosuresExplicit ──→ ClosuresExplicitProgram
//     ── compileJsEmitJs ──→ JsModule
//     ── compileJsSerializeJsAst (Iso<String, JsModule>) ──→ JS source string
//
// Each step is a Fenel function with structural metadata (defineFunction
// surfaces it through the registry, the picker, the function-detail page)
// + a TS native impl. The composition function `compileFenelToJs` is also
// a Fenel function — the `CompileJs : Compilable JsModule` instance's
// `compile` method holds a reference to it.
//
// Phase 21.6.2 — the TS impls of `emitJs` and `serializeJsModule` were
// deleted. The Fenel bodies in `fenel/modules/engine/emit-js.fenel` and
// `fenel/modules/engine/serialize-js-module.fenel` (registered as
// `engine:emitJs` / `engine:serializeJsModuleEntry`) are the production
// path; the wrappers below dispatch to them via `engine-bodies-dispatch`.
// ---------------------------------------------------------------------------

import type {
  FenelModule,
  Instance,
} from "../types";
import { rekeyNativesById } from "../function-builder";
import { loadFenelModule, loadFenelModuleUnion } from "../fenel-module";
import type { CompileResult, CompileSource } from "../compilable";
import { compileErrorUnsupported, compileErr, compileSourceFromUnknown } from "../compilable";
import type { CoreProgram } from "../ir/core";
import type { EffectsExplicitProgram } from "../ir/effects-explicit";
import type { ClosuresExplicitProgram } from "../ir/closures-explicit";
import {
  dispatchedMakeEffectsExplicit,
  dispatchedMakeClosuresExplicit,
  dispatchedNormaliseToCore,
  dispatchedEmitJs,
  dispatchedSerializeJsModule,
  withEngineDispatchEvaluationSnapshot,
} from "../engine-bodies-dispatch";
import type { JsModule } from "../ir/js-ast";
import IR_TYPES_SRC from "../../../../../fenel/modules/engine/ir-types.fenel?raw";
import JS_TYPES_SRC from "../../../../../fenel/modules/compile-js/types.fenel?raw";
import COMPILE_JS_INSTANCES_FENEL from "../../../../../fenel/modules/compile-js/instances.fenel?raw";
import COMPILE_JS_SIGS_FENEL from "../../../../../fenel/modules/compile-js/sigs.fenel?raw";

// ---------------------------------------------------------------------------
// Fenel-authored function-spec surface — Phase 3v.5 (module-substrate) flips
// the 7 `compile-js:<step>` sigs from inline TS `defineFunction` blocks to a
// `loadFenelModuleUnion` over the three compile-js `.fenel` sources
// (types.fenel + instances.fenel + sigs.fenel). The hyphen in `compile-js`
// prevents a `module compile-js where` header from parsing (the ident lexer
// splits on `-`), so the loader-arg `name: "compile-js"` is the function-id
// namespace instead — every file shares it, the union groups them all under
// one group. The container itself is `compileJs` (see the module export
// below). The bodies stay TS-native (the `<step>Native` impls below);
// `nativeImpls` keyed by `compile-js:<codeName>` continues to satisfy
// dispatch the same way it did pre-3v.5.
// ---------------------------------------------------------------------------

const compileJsUnion = loadFenelModuleUnion([
  { src: JS_TYPES_SRC, name: "compile-js" },
  { src: COMPILE_JS_INSTANCES_FENEL, name: "compile-js", opts: { dispatchInstanceFile: true } },
  { src: COMPILE_JS_SIGS_FENEL, name: "compile-js" },
]).find((m) => m.name === "compile-js");
if (!compileJsUnion) {
  throw new Error(
    "compile-js: loadFenelModuleUnion did not yield the `compile-js` group — Fenel sources out of sync with the seam (every compile-js/*.fenel must load under the `compile-js` arg)",
  );
}

// ---------------------------------------------------------------------------
// Step 1: normaliseToCore — wrap the IR-module function as a registered
// Fenel function. The wrapper validates the input shape at the registry-
// native boundary, then dispatches to the Fenel body via
// `engine-bodies-dispatch`.
// ---------------------------------------------------------------------------

function normaliseToCoreNative(input: unknown): CompileResult<CoreProgram> {
  const src = asCompileSource(input);
  if (src.$tag === "Err") return src as CompileResult<CoreProgram>;
  return dispatchedNormaliseToCore(src._0);
}

// ---------------------------------------------------------------------------
// Step 2: makeEffectsExplicit — delegates to engine:makeEffectsExplicit
// ---------------------------------------------------------------------------

function makeEffectsExplicitNative(input: unknown): CompileResult<EffectsExplicitProgram> {
  if (!isCoreProgram(input)) {
    return compileErr(compileErrorUnsupported("makeEffectsExplicit expects a CoreProgram", input));
  }
  return dispatchedMakeEffectsExplicit(input);
}

// ---------------------------------------------------------------------------
// Step 3: makeClosuresExplicit — delegates to engine:makeClosuresExplicit
// ---------------------------------------------------------------------------

function makeClosuresExplicitNative(input: unknown): CompileResult<ClosuresExplicitProgram> {
  if (!isEffectsExplicitProgram(input)) {
    return compileErr(
      compileErrorUnsupported("makeClosuresExplicit expects an EffectsExplicitProgram", input),
    );
  }
  return dispatchedMakeClosuresExplicit(input);
}

// ---------------------------------------------------------------------------
// Step 4: emitJs — delegates to engine:emitJs
// ---------------------------------------------------------------------------

function emitJsNative(input: unknown): CompileResult<JsModule> {
  if (!isClosuresExplicitProgram(input)) {
    return compileErr(
      compileErrorUnsupported("emitJs expects a ClosuresExplicitProgram", input),
    );
  }
  return dispatchedEmitJs(input);
}

// ---------------------------------------------------------------------------
// Step 5: serializeJsModule — delegates to engine:serializeJsModuleEntry
// ---------------------------------------------------------------------------

function serializeJsModuleNative(input: unknown): { $tag: "Ok"; _0: string } | { $tag: "Err"; _0: string } {
  if (!isJsModule(input)) {
    return { $tag: "Err", _0: "serializeJsModule: expected a JsModule input" };
  }
  return dispatchedSerializeJsModule(input);
}

// ---------------------------------------------------------------------------
// Decode side — Phase 5 placeholder
//
// The encode law (`encode(decode(s)) = Ok s` when `decode(s) = Ok x`) is
// vacuous when every input decodes to Err; the round-trip on the encode
// side (sample-tested) is what we exercise. Future phases that need to
// re-parse compiled JS back into JsAst (e.g. for further rewriting) will
// drop a real parser here.
// ---------------------------------------------------------------------------

function deserializeJsModuleNative(input: unknown): { $tag: "Err"; _0: string } {
  void input;
  return { $tag: "Err", _0: "Phase 5: deserializeJsModule is a placeholder; parse-side codec is out of scope." };
}

// ---------------------------------------------------------------------------
// Composition: compileFenelToJs — the top-level pipeline
// ---------------------------------------------------------------------------

/**
 * The top-level `Compilable JsModule.compile` implementation. Threads the
 * four lowering steps through `Result CompileError _`; on first failure
 * short-circuits. The output is a `JsModule` — callers serialise via the
 * companion `Encodable String JsModule`.
 *
 * Treating the pipeline as a single function (rather than four separate
 * registry entries) is intentional: the `compile` method's signature is
 * `CompileSource → Result CompileError target`, so the bound function
 * has to be the composition, not any single intermediate step. The
 * per-step functions stay registered too (for introspection / replacement
 * / tracing), but the typeclass dispatch path resolves through a reference
 * to the composition.
 */
function compileFenelToJsNative(input: unknown): CompileResult<JsModule> {
  return withEngineDispatchEvaluationSnapshot(() => {
    const step1 = normaliseToCoreNative(input);
    if (step1.$tag === "Err") return step1 as CompileResult<JsModule>;
    const step2 = makeEffectsExplicitNative(step1._0);
    if (step2.$tag === "Err") return step2 as CompileResult<JsModule>;
    const step3 = makeClosuresExplicitNative(step2._0);
    if (step3.$tag === "Err") return step3 as CompileResult<JsModule>;
    return emitJsNative(step3._0);
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
    typeof x === "object" &&
    x !== null &&
    (x as Record<string, unknown>)["$tag"] === "CoreProgram"
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

function isJsModule(x: unknown): x is JsModule {
  return (
    typeof x === "object" &&
    x !== null &&
    (x as Record<string, unknown>)["$tag"] === "JsModule"
  );
}

// ---------------------------------------------------------------------------
// Fenel function specs — Phase 3v.5 (module-substrate) sourced the spec
// surface from `compile-js/sigs.fenel` via the union above (every step is
// surfaced through the registry so downstream tooling — editor pickers,
// function-detail pages, audit scripts — can introspect / replace any
// individual pass). The 7 `defineFunction` blocks + `collectFunctions` call
// + `_compileJsDefined` const + the type-token consts retired here; their
// payload now lives in the `.fenel` file as `@native` sigs + `@label` /
// `@description` / `@category` / `@tags` directives.
// ---------------------------------------------------------------------------

const compileJsFunctions = compileJsUnion.functions ?? [];
const compileJsInstances = compileJsUnion.instances ?? [];

// ---------------------------------------------------------------------------
// Native impls table
// ---------------------------------------------------------------------------

const compileJsNatives: Record<string, (...args: unknown[]) => unknown> = {
  normaliseToCore: (source) => normaliseToCoreNative(source),
  makeEffectsExplicit: (core) => makeEffectsExplicitNative(core),
  makeClosuresExplicit: (ee) => makeClosuresExplicitNative(ee),
  emitJs: (ce) => emitJsNative(ce),
  serializeJsModule: (mod) => serializeJsModuleNative(mod),
  deserializeJsModule: (encoded) => deserializeJsModuleNative(encoded),
  compileFenelToJs: (source) => compileFenelToJsNative(source),
};

// ---------------------------------------------------------------------------
// Instance projections — pulled from the union's instance list (sourced from
// `instances.fenel`). Phase 3.1 (typeclass-substrate-completion) authored
// these as Fenel-side typed values; Phase 3v.5 (module-substrate) routes the
// lookup through the same union the sig surface flows through. The exported
// consts are thin projection lookups (the engine barrel re-exports them).
// ---------------------------------------------------------------------------

const pickCompileJsInst = (typeName: string, args: string[]): Instance => {
  const key = JSON.stringify(args);
  const found = compileJsInstances.find(
    (i) => i.typeName === typeName && JSON.stringify(i.args) === key,
  );
  if (!found) throw new Error(`compile-js: missing Fenel instance ${typeName} ${key}`);
  return found;
};

/**
 * `CompileJs : Compilable JsModule` — the JS-target Compilable instance.
 * `compile` resolves to the composed pipeline function. Args[0] is the type
 * the compiler returns (`JsModule`); the other targets register their own
 * `Compilable WasmModule` / `Compilable LlvmModule` instances under
 * different args[0] values.
 */
export const compileJsInstance: Instance = pickCompileJsInst("Compilable", ["JsModule"]);

/**
 * `Encodable<String, JsModule>` — the one-way codec from the typed
 * `JsModule` to JS source. Demoted from `Iso` in expr-substrate Phase 6c:
 * `deserializeJsModule` is the documented Phase-5 placeholder
 * (unconditional Err), so the Iso bijectivity laws were unsatisfiable —
 * the instance now claims exactly what it delivers. Re-promote when a
 * real parse-side codec lands.
 */
export const encodableJsModule: Instance = pickCompileJsInst("Encodable", ["String", "JsModule"]);

// ---------------------------------------------------------------------------
// Module export — picked up by SYSTEM_MODULES in system-entities.ts /
// system-registry.ts.
// ---------------------------------------------------------------------------

// ---------------------------------------------------------------------------
// Phase 4h — compile-pipeline IR program-envelope entities. The shared
// `ir-types.fenel` (7 entities — CompileFieldSlot / CompileSource / CompileError
// / CoreProgram / EffectsExplicitProgram / HandlerSite /
// ClosuresExplicitProgram) is owned
// by engineModule and pulled in here under `name: "engine"`; the target-
// specific compile-js types (JsAst / JsStmt / JsLoopFn / JsModule /
// CallMapping) ride the
// 3v.5 union above. `registerCatalogEntities` dedupes by id so the first
// registration wins. Loading both into `compileJsModule.entities` surfaces
// the function-spec tokens through the system-registry catalog walk.
//
// modules-as-values (2026-09-24) — the container is `compileJs`, an
// identifier, so its members read dotted (`compileJs.compileFenelToJs`); a
// hyphenated name parses as a subtraction. `functionNamespace` keeps every
// function id `compile-js:*`. The loader stamps the target types with its
// argument, `compile-js`; they are members of this container, so they are
// restamped `compileJs`, as the container's own types are everywhere else
// (`compiler-target-entities.ts` selects them by `module === name`). Their
// `.fenel.lock` field rows were re-keyed to `type:compileJs:…` in place,
// keeping every UUID. The shared IR types stay owned by `engine`.
// ---------------------------------------------------------------------------

const compileJsIrTypesModule = loadFenelModule(IR_TYPES_SRC, "engine");

const compileJsEntities = [
  ...(compileJsIrTypesModule.entities ?? []),
  ...(compileJsUnion.entities ?? []).map((entity) => ({ ...entity, module: "compileJs" })),
];

export const compileJsModule: FenelModule = {
  name: "compileJs",
  functionNamespace: "compile-js",
  label: "Compile (JS target)",
  functions: compileJsFunctions,
  instances: compileJsInstances,
  entities: compileJsEntities,
  nativeImpls: rekeyNativesById(compileJsNatives, "compile-js"),
};

// Re-export the natives + composition for direct use in tests (the test
// suite exercises each step in isolation, plus the end-to-end pipeline).
export {
  normaliseToCoreNative,
  makeEffectsExplicitNative,
  makeClosuresExplicitNative,
  emitJsNative,
  serializeJsModuleNative,
  compileFenelToJsNative,
  compileJsNatives,
};
