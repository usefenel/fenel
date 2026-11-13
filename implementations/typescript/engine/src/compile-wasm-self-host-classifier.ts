// SUBSTRATE
// ---------------------------------------------------------------------------
// Phase 5b30 — WASM self-host classifier
//
// Extracted from `compile-wasm-self-host.test.ts` in Phase 5b30 (matrix
// generator hardening — tier-(12-tooling) substrate sub-phase). Owns the
// WASM-target self-host harness's module-init, `buildFenelRuntime`, lazy
// import-driven sharedWasmFenelWrappers preparation, `runOne` classification,
// and `classifyFnId(fnId) → Promise<ClassifierResult>`
// API consumed by both `compile-wasm-self-host.test.ts` (bun:test
// integration) AND `scripts/generate-self-host-matrix.ts` (observation-
// truthful matrix cell rendering).
//
// **NO bun:test imports** — pure classification logic + setup.
// ---------------------------------------------------------------------------

import { hostDateParseNative } from "./modules/time";
import {
  pointNative,
  alphaBlendNative, colorNative,
} from "./modules/picture";
import {
  timeNative, amplitudeNative, monoNative,
  ampLNative, ampRNative, audioBufferNative,
} from "./modules/sound";
import {
  compileFenelToWasmNative,
  serializeWasmModuleNative,
} from "./modules/compile-wasm";
import * as imgOps from "./image-ops";
import type { CompileSource } from "./compilable";
import {
  compileConstructorSlotTable,
  compileConstructorWireNames,
  compileFunctionParamSlots,
  compileFunctionTypeOwnerIds,
} from "./compile-field-slots";
import {
  compileCallBindingsByFnId,
  type CompileCallBindings,
} from "./compile-call-bindings";
import type { FenelFunction } from "./types";
import { evaluate, invokeCallable, type EvaluateContext } from "./json-logic";
import { withEngineDispatchEvaluationSnapshot } from "./engine-bodies-dispatch";
import type { WasmModule } from "./ir/wasm-ast";
import {
  getRepositoryCompilerConstructorMetadataView,
  getRepositoryCompilerMetadataView,
  type RepositoryCompilerMetadataView,
} from "./compiler-metadata-view";
import { createDispatchRegistry } from "./dispatch-registry";
import {
  buildEffectStubsForFn,
  buildWasmEffectImports,
  constraintsToRequiresStrings,
} from "./effect-bootstrap-helpers";
import {
  buildSamples,
  effectfulCanary,
  PROBE_ARGS,
  SCRATCH_SCOPE,
  scopeForConstraint,
  WASM_EXPECTED_GAPS,
  type Sample,
} from "./self-host-samples";
import {
  buildSelfHostCandidateIndex,
  classifyFnIdsOnceAsync,
  memoizeAsyncFnIdClassification,
  projectSelfHostCandidateModule,
} from "./self-host-classification-cache";
import {
  exactImmutableDataEqual,
  exactImmutableDataSnapshot,
  immutableCandidateRoster,
} from "./self-host-immutable-data";
import { invokeSelfHostSourceBody } from "./self-host-body-oracle";
import {
  wasmLlvmBaseEngineContext as baseEngineCtx,
  wasmLlvmSelfHostModules as harnessModules,
} from "./self-host-wasm-llvm-bootstrap";

// Phase 5b30 — observed classifier result. Matrix-gen + .test.ts consume
// the same shape; gap pre-empt lives at the consumer layer.
export type ClassifierResult =
  | { status: "OK"; samplesCompared: number }
  | { status: "SKIP"; reason: string }
  | { status: "FAIL"; reason: string }
  | { status: "NO_SAMPLES" };

let compilerMetadataRegistry: RepositoryCompilerMetadataView | undefined;
const compilerCtorDefsByOwnerKey = new Map<string, ReturnType<typeof compileConstructorSlotTable>>();
function getCompilerMetadataRegistry(): RepositoryCompilerMetadataView {
  compilerMetadataRegistry ??= getRepositoryCompilerMetadataView();
  return compilerMetadataRegistry;
}
function getHarnessCtorDefs(fn?: FenelFunction): ReturnType<typeof compileConstructorSlotTable> {
  const preferredOwnerIds = fn === undefined ? [] : compileFunctionTypeOwnerIds(fn);
  const key = preferredOwnerIds.join("\0");
  const cached = compilerCtorDefsByOwnerKey.get(key);
  if (cached !== undefined) return cached;
  const table = compileConstructorSlotTable(
    getRepositoryCompilerConstructorMetadataView(),
    { preferredOwnerIds },
  );
  compilerCtorDefsByOwnerKey.set(key, table);
  return table;
}
function getCompilerFunction(fn: FenelFunction): FenelFunction {
  if (fn.id === effectfulCanary.id) return fn;
  const identified = getCompilerMetadataRegistry().getIdentifiedFunction(fn.id);
  if (identified === undefined) {
    throw new Error(`Wasm self-host compiler metadata: unresolved function owner ${fn.id}`);
  }
  return identified;
}

// ---------------------------------------------------------------------------
// `$fenel` runtime helpers — the host-side ABI the compiled modules expect.
// See historical notes in the legacy .test.ts file for the per-binding
// rationale; the runtime ships verbatim from 5b29 here.
// ---------------------------------------------------------------------------

type ClosureHandle = { __cl?: string; __userFn?: (...args: unknown[]) => unknown; env?: unknown };
export type AdtHandle = { $tag?: string } & Record<string, unknown>;

function defineOwnDataProperty(
  target: Record<string, unknown>,
  key: string,
  value: unknown,
): void {
  Object.defineProperty(target, key, {
    value,
    enumerable: true,
    configurable: true,
    writable: true,
  });
}

/** Build the interpreter oracle's parameter environment without inherited
 * semantic names or the legacy `__proto__` assignment setter. */
export function buildWasmCompilerEvaluationData(
  params: readonly { readonly name: string }[],
  args: readonly unknown[],
): Record<string, unknown> {
  const data = Object.create(null) as Record<string, unknown>;
  for (let i = 0; i < params.length; i++) {
    defineOwnDataProperty(data, params[i]!.name, args[i]);
  }
  return data;
}

export function rewireClosureHandles(
  value: unknown,
  instance: WebAssembly.Instance,
): unknown {
  if (value === null || typeof value !== "object") return value;
  if (Array.isArray(value)) {
    return value.map((v) => rewireClosureHandles(v, instance));
  }
  const obj = value as Record<string, unknown>;
  const closureName = Object.getOwnPropertyDescriptor(obj, "__cl");
  const closureEnv = Object.getOwnPropertyDescriptor(obj, "env");
  if (closureName !== undefined && closureEnv !== undefined) {
    if (!("value" in closureName) || typeof closureName.value !== "string" || !("value" in closureEnv)) {
      throw new TypeError("Wasm closure handle name and environment must be own data");
    }
    const callable = Object.getOwnPropertyDescriptor(obj, "__userFn");
    if (callable !== undefined) {
      if (!("value" in callable) || (callable.value !== undefined && typeof callable.value !== "function")) {
        throw new TypeError("Wasm closure handle callable must be own function data");
      }
      if (typeof callable.value === "function") return value;
    } else if ("__userFn" in obj) {
      throw new TypeError("Wasm closure handle callable must be own function data");
    }
  }
  if (
    Object.prototype.hasOwnProperty.call(obj, "__cl")
    && typeof obj.__cl === "string"
    && Object.prototype.hasOwnProperty.call(obj, "env")
    && (
      !Object.prototype.hasOwnProperty.call(obj, "__userFn")
      || obj.__userFn === undefined
    )
  ) {
    const fnName = obj.__cl;
    const env = obj.env;
    const exportFn = (instance.exports as Record<string, unknown>)[fnName] as
      | ((...a: unknown[]) => unknown)
      | undefined;
    if (typeof exportFn !== "function") {
      return value;
    }
    return {
      __userFn: (...args: unknown[]): unknown => exportFn(env, ...args),
      __cl: fnName,
      env,
    };
  }
  const out = Object.create(Object.getPrototypeOf(obj)) as Record<string, unknown>;
  for (const [k, v] of Object.entries(obj)) {
    defineOwnDataProperty(out, k, rewireClosureHandles(v, instance));
  }
  return out;
}

export function requireWasmStdConcatNative(
  natives: Readonly<Record<string, unknown>> | undefined,
): (...args: unknown[]) => unknown {
  const descriptor = Object.getOwnPropertyDescriptor(natives ?? {}, "std:concat");
  if (descriptor === undefined || !("value" in descriptor) || typeof descriptor.value !== "function") {
    throw new TypeError("Wasm runtime std:concat must be own function data");
  }
  return descriptor.value;
}

export function buildFenelRuntime(
  stringPool: readonly string[],
  importModule?: Pick<WasmModule, "imports">,
): {
  rt: Record<string, unknown>;
  setInstance: (i: WebAssembly.Instance) => void;
} {
  let instance: WebAssembly.Instance | undefined;
  const concatNative = requireWasmStdConcatNative(baseEngineCtx.natives);
  const rt: Record<string, unknown> = Object.assign(Object.create(null), {
    boxNum: (n: number): unknown => n,
    unboxNum: (v: unknown): number => (typeof v === "number" ? v : Number(v)),
    boxBool: (n: number): unknown => n !== 0,
    unboxBool: (v: unknown): number => (v ? 1 : 0),
    concat: concatNative,
    litString: (idx: number): string => stringPool[idx] ?? "",
    mod: (a: unknown, b: unknown): number =>
      typeof a === "number" && typeof b === "number"
        ? a % b
        : Number(a) % Number(b),
    envAlloc: (n: number): unknown[] => new Array(n),
    envSet: (env: unknown[], i: number, v: unknown): void => {
      env[i] = v;
    },
    envGet: (env: unknown[], i: number): unknown => env[i],
    makeClosure: (name: string, env: unknown[]): ClosureHandle => {
      if (instance === undefined) throw new Error("makeClosure: producing instance not bound");
      const exported = Object.getOwnPropertyDescriptor(instance.exports, name);
      if (exported === undefined || !("value" in exported) || typeof exported.value !== "function") {
        throw new Error(`makeClosure: no callable export '${name}' on producing instance`);
      }
      return rewireClosureHandles({ __cl: name, env }, instance) as ClosureHandle;
    },
    construct: (tag: unknown, _n: number): AdtHandle => {
      const tagStr = String(tag);
      if (tagStr === "$record") return {} as AdtHandle;
      return { $tag: tagStr } as AdtHandle;
    },
    setField: (v: AdtHandle, i: number, value: unknown): void => {
      v[`_${i}`] = value;
    },
    setFieldNamed: (v: AdtHandle, _i: number, name: unknown, value: unknown): void => {
      defineOwnDataProperty(v as Record<string, unknown>, String(name), value);
    },
    getField: (v: AdtHandle, i: number): unknown => v[`_${i}`],
    getFieldNamed: (v: AdtHandle, name: unknown): unknown => {
      const key = String(name);
      return Object.prototype.hasOwnProperty.call(v, key)
        ? (v as Record<string, unknown>)[key]
        : undefined;
    },
    hasField: (v: AdtHandle, i: number): number =>
      Object.prototype.hasOwnProperty.call(v, `_${i}`) ? 1 : 0,
    hasFieldNamed: (v: AdtHandle, name: unknown): number =>
      v && typeof v === "object"
        && Object.prototype.hasOwnProperty.call(v, String(name))
        ? 1
        : 0,
    tagEq: (v: AdtHandle, expected: unknown): number =>
      v && typeof v === "object" && v.$tag === String(expected) ? 1 : 0,
    litEq: (a: unknown, b: unknown): number => (Object.is(a, b) ? 1 : 0),
    matchFail: (_v: unknown): unknown => null,
    length: (s: unknown): number => {
      if (typeof s === "string") {
        let n = 0;
        for (const _ of s) n++;
        return n;
      }
      return Array.isArray(s) ? s.length : 0;
    },
    slice: (s: unknown, start: unknown, end: unknown): string =>
      String(s ?? "").slice(Number(start), end == null ? undefined : Number(end)),
    startsWith: (s: unknown, pre: unknown): number =>
      String(s ?? "").startsWith(String(pre ?? "")) ? 1 : 0,
    contains: (s: unknown, sub: unknown): number =>
      String(s ?? "").includes(String(sub ?? "")) ? 1 : 0,
    split: (s: unknown, d: unknown): string[] => String(s ?? "").split(String(d ?? "")),
    join: (arr: unknown, sep: unknown): string =>
      (Array.isArray(arr) ? arr : [arr]).map((v) => String(v ?? "")).join(String(sep ?? "")),
    replaceAll: (s: unknown, find: unknown, repl: unknown): string => {
      const str = String(s ?? "");
      const f = String(find ?? "");
      if (f === "") return str;
      return str.split(f).join(String(repl ?? ""));
    },
    head: (xs: unknown): unknown => {
      if (Array.isArray(xs)) {
        return xs.length > 0
          ? { $tag: "Just", _0: xs[0] }
          : { $tag: "Nothing" };
      }
      if (typeof xs === "string") {
        const it = xs[Symbol.iterator]().next();
        return it.done
          ? { $tag: "Nothing" }
          : { $tag: "Just", _0: it.value };
      }
      return { $tag: "Nothing" };
    },
    tail: (xs: unknown): unknown => {
      if (Array.isArray(xs)) {
        return xs.length > 0
          ? { $tag: "Just", _0: xs.slice(1) }
          : { $tag: "Nothing" };
      }
      if (typeof xs === "string") {
        const it = xs[Symbol.iterator]().next();
        return it.done
          ? { $tag: "Nothing" }
          : { $tag: "Just", _0: xs.slice(it.value.length) };
      }
      return { $tag: "Nothing" };
    },
    toString: (x: unknown): string => (x == null ? "" : String(x)),
    elem: (needle: unknown, haystack: unknown): number => {
      if (typeof haystack === "string") return haystack.includes(String(needle)) ? 1 : 0;
      if (Array.isArray(haystack)) return haystack.includes(needle) ? 1 : 0;
      return 0;
    },
    appendItem: (item: unknown, arr: unknown): unknown[] =>
      Array.isArray(arr) ? [...arr, item] : [item],
    sortLex: (arr: unknown): unknown[] =>
      Array.isArray(arr) ? [...arr].sort() : [],
    trim: (x: unknown): string => String(x ?? "").trim(),
    lower: (x: unknown): string => String(x ?? "").toLowerCase(),
    imageGrayscale: imgOps.imgGrayscale,
    imagePixelate: imgOps.imgPixelate,
    find: (pred: unknown, xs: unknown): unknown => {
      const invoke = (p: unknown, v: unknown): unknown => {
        if (typeof p === "function") return (p as (a: unknown) => unknown)(v);
        if (p && typeof p === "object") {
          const h = p as { __cl?: unknown; __userFn?: unknown };
          if (h.__cl !== undefined || h.__userFn !== undefined) {
            const dispatch = rt["callClosure_1"] as
              | ((handle: unknown, x: unknown) => unknown)
              | undefined;
            if (dispatch !== undefined) return dispatch(p, v);
          }
        }
        return false;
      };
      for (const v of Array.isArray(xs) ? xs : []) {
        if (invoke(pred, v)) return { $tag: "Just", _0: v };
      }
      return { $tag: "Nothing" };
    },
    hostDateParse: hostDateParseNative,
    point: pointNative,
    sampleAnim: (anim: unknown, t: unknown): unknown => {
      if (anim === null || typeof anim !== "object") return null;
      const obj = anim as Record<string, unknown>;
      const tag = obj.$tag as string | undefined;
      if (tag === "Animate") {
        const callable = (obj._0 ?? obj.value) as unknown;
        if (typeof callable === "function") return (callable as (x: unknown) => unknown)(t);
        return null;
      }
      if (tag === "Frames") {
        const seq = (obj._0 ?? obj.value) as Record<string, unknown> | undefined;
        if (!seq || !Array.isArray(seq.frames) || (seq.frames as unknown[]).length === 0 || !seq.fps) {
          return null;
        }
        const tSec = (t !== null && typeof t === "object" && "seconds" in (t as object))
          ? Number((t as { seconds: unknown }).seconds)
          : 0;
        const fps = Number(seq.fps);
        const frames = seq.frames as unknown[];
        const idx = Math.floor(tSec * fps);
        if (idx < 0 || idx >= frames.length) return null;
        return { $tag: "Raster", _0: frames[idx] };
      }
      return null;
    },
    floor: (x: unknown): number => Math.floor(Number(x)),
    sqrt: (x: unknown): number => Math.sqrt(Number(x)),
    alphaBlend: alphaBlendNative,
    color: colorNative,
    sample: (pic: unknown, p: unknown): unknown => {
      if (!pic || typeof pic !== "object") return { r: 0, g: 0, b: 0, a: 0 };
      const obj = pic as Record<string, unknown>;
      const tag = obj.$tag as string | undefined;
      if (tag === "Field") {
        const callable = (obj._0 ?? obj.value) as unknown;
        if (typeof callable === "function") {
          return (callable as (p: unknown) => unknown)(p);
        }
        if (callable && typeof callable === "object") {
          const handle = callable as { __cl?: unknown; __userFn?: unknown };
          if (handle.__cl !== undefined || handle.__userFn !== undefined) {
            const dispatch = rt["callClosure_1"] as
              | ((h: unknown, x: unknown) => unknown)
              | undefined;
            if (dispatch !== undefined) return dispatch(callable, p);
          }
        }
        return { r: 0, g: 0, b: 0, a: 0 };
      }
      if (tag === "Raster") {
        const img = (obj._0 ?? obj.value) as
          | { width?: unknown; height?: unknown; pixels?: unknown }
          | undefined;
        if (!img || typeof img !== "object") return { r: 0, g: 0, b: 0, a: 0 };
        const w = Number(img.width) || 0;
        const h = Number(img.height) || 0;
        if (w === 0 || h === 0) return { r: 0, g: 0, b: 0, a: 0 };
        const pt = (p && typeof p === "object")
          ? (p as { x?: unknown; y?: unknown })
          : { x: 0, y: 0 };
        const px = Math.max(0, Math.min(w - 1, Math.floor(Number(pt.x) || 0)));
        const py = Math.max(0, Math.min(h - 1, Math.floor(Number(pt.y) || 0)));
        if (!Array.isArray(img.pixels)) return { r: 0, g: 0, b: 0, a: 0 };
        return img.pixels[py * w + px] ?? { r: 0, g: 0, b: 0, a: 0 };
      }
      return { r: 0, g: 0, b: 0, a: 0 };
    },
    sin: (x: unknown): number => Math.sin(Number(x)),
    pow: (b: unknown, e: unknown): number => Math.pow(Number(b), Number(e)),
    sampleSound: (snd: unknown, t: unknown): unknown => {
      if (!snd || typeof snd !== "object") return { l: 0, r: 0 };
      const obj = snd as Record<string, unknown>;
      const tag = obj.$tag as string | undefined;
      if (tag === "Wave") {
        const callable = (obj._0 ?? obj.value) as unknown;
        if (typeof callable === "function") {
          return (callable as (t: unknown) => unknown)(t);
        }
        if (callable && typeof callable === "object") {
          const handle = callable as { __cl?: unknown; __userFn?: unknown };
          if (handle.__cl !== undefined || handle.__userFn !== undefined) {
            const dispatch = rt["callClosure_1"] as
              | ((h: unknown, x: unknown) => unknown)
              | undefined;
            if (dispatch !== undefined) return dispatch(callable, t);
          }
        }
        return { l: 0, r: 0 };
      }
      if (tag === "Buffer") {
        const buf = (obj._0 ?? obj.value) as
          | { sampleRate?: unknown; samples?: unknown }
          | undefined;
        if (!buf || typeof buf !== "object") return { l: 0, r: 0 };
        const sr = Number(buf.sampleRate) || 0;
        if (sr === 0 || !Array.isArray(buf.samples) || buf.samples.length === 0) {
          return { l: 0, r: 0 };
        }
        const tSec = (t !== null && typeof t === "object" && "seconds" in (t as object))
          ? Number((t as { seconds: unknown }).seconds)
          : 0;
        const idx = Math.floor(tSec * sr);
        if (idx < 0 || idx >= buf.samples.length) return { l: 0, r: 0 };
        return buf.samples[idx] ?? { l: 0, r: 0 };
      }
      return { l: 0, r: 0 };
    },
    time: timeNative,
    amplitude: amplitudeNative,
    mono: monoNative,
    ampL: ampLNative,
    ampR: ampRNative,
    audioBuffer: audioBufferNative,
  });
  for (let arity = 0; arity <= 3; arity++) {
    const helperName = `callClosure_${arity}`;
    rt[helperName] = (cl: ClosureHandle, ...args: unknown[]): unknown => {
      if (cl && cl.__userFn !== undefined) return cl.__userFn(...args);
      if (cl === undefined || cl.__cl === undefined) {
        throw new Error(`callClosure_${arity}: invalid closure handle`);
      }
      if (instance === undefined) throw new Error("callClosure_*: instance not bound");
      const fn = (instance.exports as Record<string, unknown>)[cl.__cl] as
        | ((...a: unknown[]) => unknown)
        | undefined;
      if (typeof fn !== "function") {
        throw new Error(`callClosure_${arity}: no export '${cl.__cl}'`);
      }
      return fn(cl.env, ...args);
    };
  }
  if (importModule !== undefined) {
    installRegistryWasmNativeImports(rt, importModule);
  }
  return {
    rt,
    setInstance: (i): void => {
      instance = i;
    },
  };
}

// ---------------------------------------------------------------------------
// Effect-handler stubs.
// ---------------------------------------------------------------------------

const scratchStateStorage = new Map<string, unknown>();
const stubRegistry = createDispatchRegistry({ methodValues: "compiler-host-stubs" });
stubRegistry.defineClass({
  name: "HasStateIO",
  params: [{ name: "scope" }],
  methods: [
    { name: "set", params: [], returns: { $ref: "Unit" } },
    { name: "get", params: [], returns: { $ref: "String" } },
  ],
});
stubRegistry.addInstance({
  typeName: "HasStateIO",
  args: [SCRATCH_SCOPE],
  methods: {
    set: (key: unknown, value: unknown): unknown => {
      scratchStateStorage.set(String(key), value);
      return null;
    },
    get: (key: unknown): unknown => {
      const v = scratchStateStorage.get(String(key));
      return v === undefined ? { $tag: "Nothing" } : { $tag: "Just", _0: v };
    },
  },
});
stubRegistry.defineClass({
  name: "HasTelegramBot",
  params: [{ name: "scope" }],
  methods: [
    { name: "runCollector", params: [], returns: { $ref: "Id" } },
    { name: "stopCollector", params: [], returns: { $ref: "Unit" } },
    { name: "handleUpdate", params: [], returns: { $ref: "Unit" } },
    { name: "findBotById", params: [], returns: { $ref: "Maybe" } },
    { name: "sendMessageText", params: [], returns: { $ref: "Unit" } },
    { name: "sendFieldPrompt", params: [], returns: { $ref: "Unit" } },
  ],
});
stubRegistry.addInstance({
  typeName: "HasTelegramBot",
  args: [SCRATCH_SCOPE],
  methods: {
    runCollector: (): unknown => ({ $tag: "Ok", _0: "stub-bot-id" }),
    stopCollector: (): unknown => ({ $tag: "Nothing" }),
    handleUpdate: (): unknown => null,
    findBotById: (): unknown => ({ $tag: "Nothing" }),
    sendMessageText: (): unknown => null,
    sendFieldPrompt: (): unknown => null,
  },
});

let fnSamples: ReturnType<typeof buildSamples> | undefined;
function getFnSamples(): ReturnType<typeof buildSamples> {
  fnSamples ??= buildSamples("wasm", getHarnessCtorDefs());
  return fnSamples;
}
export const FN_SAMPLES = new Proxy({} as ReturnType<typeof buildSamples>, {
  get: (_target, key) => getFnSamples()[key as string],
  ownKeys: () => Reflect.ownKeys(getFnSamples()),
  getOwnPropertyDescriptor: (_target, key) =>
    Object.getOwnPropertyDescriptor(getFnSamples(), key),
});
export const EXPECTED_GAPS = WASM_EXPECTED_GAPS;

// ---------------------------------------------------------------------------
// Per-function row + runOne
// ---------------------------------------------------------------------------

export type Row =
  | { status: "ok"; fnId: string; samples: number }
  | { status: "skip"; fnId: string; reason: string }
  | { status: "fail"; fnId: string; reason: string };

type PreparedWasmArtifact = {
  readonly source: CompileSource;
  readonly mod: WasmModule;
  readonly bytes: Uint8Array;
  compiledModule?: WebAssembly.Module;
};

type PreparedWasmCompilation =
  | { readonly status: "ok"; readonly artifact: PreparedWasmArtifact }
  | { readonly status: "compile-failed"; readonly error: unknown }
  | { readonly status: "serialise-failed"; readonly error: string };

type PreparedWasmCompilationCacheEntry = {
  /** Isolated, deeply immutable source that actually produced `prepared`. */
  readonly inputFingerprint: CompileSource;
  readonly prepared: PreparedWasmCompilation;
};

// Shared-helper preparation and the observable classifier path use the same
// artifact only while the complete compiler input remains byte-for-byte data
// equivalent. Object identity alone is not authority: registry/test callers
// can retain and mutate a FenelFunction after its first classification. Every
// classified cell still receives a fresh WebAssembly.Instance and host runtime
// below.
const preparedWasmCompilations = new WeakMap<
  object,
  PreparedWasmCompilationCacheEntry
>();
let preparedWasmCompilationCount = 0;
let sharedWasmHelperInstantiationCount = 0;

function prepareWasmCompilation(fn: FenelFunction): PreparedWasmCompilation {
  const identifiedFn = getCompilerFunction(fn);
  const requires = fn.requires ?? [];
  const callBindings = moduleCallBindingsFor(fn);
  const ctorDefs = getHarnessCtorDefs(identifiedFn);
  const source: CompileSource = {
    name: fn.id,
    params: compileFunctionParamSlots(identifiedFn),
    body: fn.body,
    ...(callBindings === undefined ? {} : { callBindings }),
    ...(requires.length > 0
      ? { requires: constraintsToRequiresStrings(requires) }
      : {}),
    ctorDefs,
    ctorWireNames: compileConstructorWireNames(ctorDefs),
  };
  // Compile the isolated snapshot and retain that same snapshot as the exact
  // cache fingerprint. This catches nested/non-enumerable own-data mutation;
  // accessors, functions, exotic prototypes, and hostile proxies decline
  // caching because their value can vary without a comparable data change.
  const inputSnapshot = exactImmutableDataSnapshot(source);
  if (inputSnapshot.status === "ok") {
    const cached = preparedWasmCompilations.get(fn as object);
    if (
      cached !== undefined
      && exactImmutableDataEqual(cached.inputFingerprint, inputSnapshot.value)
    ) {
      return cached.prepared;
    }
  } else {
    preparedWasmCompilations.delete(fn as object);
  }
  const compilerInput = inputSnapshot.status === "ok"
    ? inputSnapshot.value
    : source;
  preparedWasmCompilationCount++;
  const compiled = compileFenelToWasmNative(compilerInput);
  let prepared: PreparedWasmCompilation;
  if (compiled.$tag === "Err") {
    prepared = { status: "compile-failed", error: compiled._0 };
  } else {
    const mod = compiled._0 as WasmModule;
    const serialised = serializeWasmModuleNative(mod);
    prepared = serialised.$tag === "Err"
      ? { status: "serialise-failed", error: serialised._0 }
      : { status: "ok", artifact: { source: compilerInput, mod, bytes: serialised._0 } };
  }
  if (inputSnapshot.status === "ok") {
    preparedWasmCompilations.set(fn as object, {
      inputFingerprint: inputSnapshot.value,
      prepared,
    });
  }
  return prepared;
}

function compiledWasmModule(artifact: PreparedWasmArtifact): WebAssembly.Module {
  artifact.compiledModule ??= new WebAssembly.Module(
    artifact.bytes as unknown as BufferSource,
  );
  return artifact.compiledModule;
}

export async function runOne(
  fn: FenelFunction,
  samples: ReadonlyArray<Sample>,
): Promise<Row> {
  return withEngineDispatchEvaluationSnapshot(() => runOneInSnapshot(fn, samples));
}

function runOneInSnapshot(
  fn: FenelFunction,
  samples: ReadonlyArray<Sample>,
): Row {
  const fnId = fn.id;
  if (samples.length === 0) {
    return { status: "skip", fnId, reason: "no samples declared" };
  }
  const requires = fn.requires ?? [];
  const prepared = prepareWasmCompilation(fn);
  if (prepared.status === "compile-failed") {
    return {
      status: "skip",
      fnId,
      reason: `compile failed: ${JSON.stringify(prepared.error)}`,
    };
  }
  if (prepared.status === "serialise-failed") {
    return { status: "skip", fnId, reason: `serialise failed: ${prepared.error}` };
  }
  const { artifact } = prepared;
  const { mod, source } = artifact;
  ensureSharedWasmImportsPrepared(mod);
  const ctx: EvaluateContext = {
    ...baseEngineCtx,
    natives: { ...(baseEngineCtx.natives ?? {}) },
  };
  let effectImports: Record<string, Record<string, (...a: unknown[]) => unknown>> = {};
  if (requires.length > 0) {
    let stubs;
    try {
      stubs = buildEffectStubsForFn(fn, ctx, stubRegistry, scopeForConstraint);
    } catch (e) {
      return { status: "skip", fnId, reason: `effect stubs failed: ${(e as Error).message}` };
    }
    ctx.natives = { ...(ctx.natives ?? {}), ...stubs.effectNatives };
    try {
      effectImports = buildWasmEffectImports(mod, ctx, stubRegistry, scopeForConstraint(requires[0]!));
    } catch (e) {
      return { status: "skip", fnId, reason: `wasm effect imports failed: ${(e as Error).message}` };
    }
  }
  let instance: WebAssembly.Instance;
  const { rt, setInstance } = buildFenelRuntime(mod.stringPool ?? [], mod);
  try {
    installSharedWasmWrappers(rt, mod);
    const importObject: Record<string, Record<string, unknown>> = {
      $fenel: rt as unknown as Record<string, unknown>,
      ...effectImports,
    };
    instance = new WebAssembly.Instance(
      compiledWasmModule(artifact),
      importObject as unknown as WebAssembly.Imports,
    );
    setInstance(instance);
  } catch (e) {
    return {
      status: "skip",
      fnId,
      reason: `instantiate failed: ${(e as Error).message}`,
    };
  }
  const exportName = source.name;
  const compiledFn = (instance.exports as Record<string, unknown>)[exportName] as
    | ((...args: unknown[]) => unknown)
    | undefined;
  if (typeof compiledFn !== "function") {
    return {
      status: "skip",
      fnId,
      reason: `compiled module has no '${exportName}' export`,
    };
  }
  const probeArgs = PROBE_ARGS[fnId] ?? [2];
  for (const args of samples) {
    const engineArgs = liftSampleForEngine(args, ctx);
    const compiledArgs = liftSampleForCompiledWasm(args, ctx);
    const engineResult = invokeSelfHostSourceBody(fn, engineArgs, ctx);
    let compiledResult: unknown;
    try {
      compiledResult = compiledFn(...compiledArgs);
    } catch (e) {
      return {
        status: "fail",
        fnId,
        reason: `runtime error on args ${JSON.stringify(args)}: ${(e as Error).message}`,
      };
    }
    let eq: boolean;
    try {
      eq = sameValue(engineResult, compiledResult, ctx, rt, probeArgs);
    } catch (e) {
      return {
        status: "fail",
        fnId,
        reason: `sameValue threw during closure probe on args ${JSON.stringify(args)}: ${(e as Error).message}`,
      };
    }
    if (!eq) {
      return {
        status: "fail",
        fnId,
        reason: `mismatch on args ${JSON.stringify(args)} — engine=${JSON.stringify(engineResult)}, compiled=${JSON.stringify(compiledResult)}`,
      };
    }
  }
  return { status: "ok", fnId, samples: samples.length };
}

function isFnSyntax(a: unknown): boolean {
  if (a === null || typeof a !== "object" || Array.isArray(a)) return false;
  const keys = Object.keys(a as object);
  return keys.length === 1 && keys[0] === "fn";
}

function liftSampleForEngine(args: ReadonlyArray<unknown>, ctx: EvaluateContext): unknown[] {
  return args.map((a) => (isFnSyntax(a) ? evaluate(a, {}, ctx) : a));
}

function liftSampleForCompiledWasm(args: ReadonlyArray<unknown>, ctx: EvaluateContext): unknown[] {
  return args.map((a) => {
    if (!isFnSyntax(a)) return a;
    const closure = evaluate(a, {}, ctx);
    return { __userFn: (...probe: unknown[]) => invokeCallable(closure, probe, ctx) };
  });
}

function sameValue(
  a: unknown,
  b: unknown,
  ctx?: EvaluateContext,
  rt?: Record<string, unknown>,
  probeArgs: ReadonlyArray<unknown> = [2],
): boolean {
  if (Object.is(a, b)) return true;
  if (a === null || b === null) return false;
  if (isFenelClosureSentinel(a) && isWasmClosureHandle(b) && ctx !== undefined && rt !== undefined) {
    const aRes = invokeCallable(a, probeArgs as unknown[], ctx);
    const dispatcher = rt[`callClosure_${probeArgs.length}`] as
      | ((handle: unknown, ...x: unknown[]) => unknown)
      | undefined;
    if (dispatcher === undefined) return false;
    const bRes = dispatcher(b, ...probeArgs);
    return sameValue(aRes, bRes, ctx, rt, probeArgs);
  }
  if (typeof a !== typeof b) return false;
  if (Array.isArray(a) && Array.isArray(b)) {
    if (a.length !== b.length) return false;
    for (let i = 0; i < a.length; i++) if (!sameValue(a[i], b[i], ctx, rt, probeArgs)) return false;
    return true;
  }
  if (typeof a === "object" && typeof b === "object") {
    const ak = Object.keys(a as object);
    const bk = Object.keys(b as object);
    if (ak.length !== bk.length) return false;
    for (const k of ak) {
      if (
        !sameValue(
          (a as Record<string, unknown>)[k],
          (b as Record<string, unknown>)[k],
          ctx,
          rt,
          probeArgs,
        )
      )
        return false;
    }
    return true;
  }
  return false;
}

function isFenelClosureSentinel(v: unknown): boolean {
  return typeof v === "object" && v !== null && (v as { __fenelFn?: unknown }).__fenelFn === true;
}

function isWasmClosureHandle(v: unknown): boolean {
  if (typeof v !== "object" || v === null) return false;
  const o = v as { __cl?: unknown; __userFn?: unknown };
  return o.__cl !== undefined || o.__userFn !== undefined;
}

// ---------------------------------------------------------------------------
// Candidate enumeration.
// ---------------------------------------------------------------------------

const candidateModules = harnessModules;
const candidateIndex = buildSelfHostCandidateIndex<FenelFunction>([
  ...candidateModules.map(projectSelfHostCandidateModule),
  { name: "phase20", functions: [effectfulCanary] },
]);
const callBindingsByFnId = compileCallBindingsByFnId(candidateModules);
function moduleCallBindingsFor(fn: FenelFunction): CompileCallBindings | undefined {
  return callBindingsByFnId.get(fn.id);
}
export const candidateFns = immutableCandidateRoster(candidateIndex.definitions);
const candidateFnById = candidateIndex.byFnId;

// ---------------------------------------------------------------------------
// Phase 21.2.1 — shared Wasm `$fenel` runtime with cross-Fenel-call substrate.
// ---------------------------------------------------------------------------

interface WasmFenelWrapper {
  fn: ((...args: unknown[]) => unknown) | undefined;
}

const sharedWasmFenelWrappers = new Map<string, WasmFenelWrapper>();
const sharedWasmHelperFns = candidateIndex.definitions.filter(
  (fn) => fn.body !== undefined && (fn.requires ?? []).length === 0,
);
const sharedWasmHelperByImportName = new Map<string, FenelFunction>();
const sharedWasmWrapperByImportName = new Map<string, WasmFenelWrapper>();
const sharedWasmHelperState = new Map<
  string,
  "preparing" | "ready" | "failed"
>();

function codeNameOf(fn: Pick<FenelFunction, "id">): string {
  return fn.id.includes(":") ? fn.id.slice(fn.id.indexOf(":") + 1) : fn.id;
}

for (const fn of sharedWasmHelperFns) {
  const wrapper: WasmFenelWrapper = { fn: undefined };
  sharedWasmFenelWrappers.set(fn.id, wrapper);
  sharedWasmHelperByImportName.set(fn.id, fn);
  sharedWasmWrapperByImportName.set(fn.id, wrapper);
}

// A short name is compatibility-only. Publish it exactly when the complete
// candidate roster proves that it has one definition; collisions stay absent
// instead of acquiring iteration-order meaning.
const uniqueHelperByCodeName = new Map<string, FenelFunction | null>();
for (const fn of sharedWasmHelperFns) {
  const codeName = codeNameOf(fn);
  uniqueHelperByCodeName.set(
    codeName,
    uniqueHelperByCodeName.has(codeName) ? null : fn,
  );
}
for (const [codeName, fn] of uniqueHelperByCodeName) {
  if (fn === null) continue;
  sharedWasmHelperByImportName.set(codeName, fn);
  sharedWasmWrapperByImportName.set(
    codeName,
    sharedWasmFenelWrappers.get(fn.id)!,
  );
}

function importedFenelHelperNames(mod: WasmModule): string[] {
  const names: string[] = [];
  for (const imp of mod.imports) {
    if (imp.$tag !== "WasmFuncImport" || imp.module !== "$fenel") continue;
    if (!sharedWasmHelperByImportName.has(imp.name)) continue;
    names.push(imp.name);
  }
  return names;
}

function installSharedWasmWrappers(
  rt: Record<string, unknown>,
  mod: WasmModule,
): void {
  for (const name of importedFenelHelperNames(mod)) {
    if (Object.prototype.hasOwnProperty.call(rt, name)) continue;
    const wrapper = sharedWasmWrapperByImportName.get(name)!;
    rt[name] = (...args: unknown[]): unknown => {
      const f = wrapper.fn;
      if (f === undefined) {
        throw new Error(`shared wasm $fenel[${JSON.stringify(name)}]: helper not bound`);
      }
      return f(...args);
    };
  }
}

/** Resolve bodyless `$fenel` imports through the same registry-native tables as
 * the interpreter oracle. Fenel-bodied imports remain owned by the lazy shared
 * helper compiler below, including bodies with an optional native perf branch. */
function installRegistryWasmNativeImports(
  rt: Record<string, unknown>,
  mod: Pick<WasmModule, "imports">,
): void {
  for (const imp of mod.imports) {
    if (imp.$tag !== "WasmFuncImport" || imp.module !== "$fenel") continue;
    const name = imp.name;
    if (Object.prototype.hasOwnProperty.call(rt, name)) continue;

    // A bare-name route that is absent from the projected table is represented
    // by the registry's `direct` verdict. Dispatch and ambiguity spellings must
    // stay unresolved; choosing either would bypass the shared resolver.
    if (!name.includes(":")) {
      const route = baseEngineCtx._resolveBareName?.(name);
      if (route?.kind !== "direct") continue;
    }

    const spec = baseEngineCtx.getFunction?.(name);
    if (spec === undefined || spec.body !== undefined) continue;
    const keys = spec.id === name ? [spec.id] : [spec.id, name];

    // Ctx-aware natives can receive callable values and therefore need an
    // explicit Wasm closure adapter; do not expose them through this plain
    // externref trampoline.
    let native: ((...args: unknown[]) => unknown) | undefined;
    for (const key of keys) {
      const candidate = baseEngineCtx.natives?.[key];
      if (typeof candidate === "function") {
        native = candidate;
        break;
      }
    }
    if (native !== undefined) rt[name] = native;
  }
}

function ensureSharedWasmHelperPrepared(fn: FenelFunction): void {
  const existing = sharedWasmHelperState.get(fn.id);
  // `preparing` is a valid recursive edge. Wasm modules have no start
  // function, so the placeholder wrapper need only be bound before the first
  // exported invocation, after the complete dependency walk unwinds.
  if (existing !== undefined) return;
  sharedWasmHelperState.set(fn.id, "preparing");

  let prepared: PreparedWasmCompilation;
  try {
    prepared = prepareWasmCompilation(fn);
  } catch {
    sharedWasmHelperState.set(fn.id, "failed");
    return;
  }
  if (prepared.status !== "ok") {
    sharedWasmHelperState.set(fn.id, "failed");
    return;
  }
  const { artifact } = prepared;
  for (const name of importedFenelHelperNames(artifact.mod)) {
    ensureSharedWasmHelperPrepared(sharedWasmHelperByImportName.get(name)!);
  }

  try {
    const { rt: helperRt, setInstance: setHelperInstance } = buildFenelRuntime(
      artifact.mod.stringPool ?? [],
      artifact.mod,
    );
    installSharedWasmWrappers(helperRt, artifact.mod);
    const wasmInstance = new WebAssembly.Instance(
      compiledWasmModule(artifact),
      { $fenel: helperRt as unknown as WebAssembly.ModuleImports },
    );
    setHelperInstance(wasmInstance);
    const exported = (wasmInstance.exports as Record<string, unknown>)[fn.id];
    const wrapper = sharedWasmFenelWrappers.get(fn.id)!;
    if (typeof exported !== "function") {
      sharedWasmHelperState.set(fn.id, "failed");
      return;
    }
    const rawExport = exported as (...args: unknown[]) => unknown;
    wrapper.fn = (...args: unknown[]): unknown => {
      const raw = rawExport(...args);
      return rewireClosureHandles(raw, wasmInstance);
    };
    sharedWasmHelperInstantiationCount++;
    sharedWasmHelperState.set(fn.id, "ready");
  } catch {
    // Per-fnId classification retains the precise compile / instantiate
    // observation. A dependent cell sees the same unbound-helper behavior as
    // the former eager preparation pass.
    sharedWasmHelperState.set(fn.id, "failed");
  }
}

function ensureSharedWasmImportsPrepared(mod: WasmModule): void {
  for (const name of importedFenelHelperNames(mod)) {
    ensureSharedWasmHelperPrepared(sharedWasmHelperByImportName.get(name)!);
  }
}

/** Lightweight counters for focused tooling benchmarks. No runtime values or
 * instances escape; matrix cells remain isolated behind fresh instances. */
export function classifierPreparationStats(): {
  readonly eligibleHelpers: number;
  readonly compiledFunctions: number;
  readonly instantiatedHelpers: number;
  readonly readyHelpers: number;
  readonly failedHelpers: number;
} {
  let readyHelpers = 0;
  let failedHelpers = 0;
  for (const state of sharedWasmHelperState.values()) {
    if (state === "ready") readyHelpers++;
    if (state === "failed") failedHelpers++;
  }
  return {
    eligibleHelpers: sharedWasmHelperFns.length,
    compiledFunctions: preparedWasmCompilationCount,
    instantiatedHelpers: sharedWasmHelperInstantiationCount,
    readyHelpers,
    failedHelpers,
  };
}

/** Pay the repository/sample bootstrap once outside per-test timeout budgets.
 * Executable helper preparation deliberately stays lazy and import-driven: an
 * eager walk of the 4k+ helper roster makes both tests and matrix tooling
 * unusable, while adding no observation for the cell under test. */
export function prepareClassifier(): void {
  void getHarnessCtorDefs();
  void getFnSamples();
}

// ---------------------------------------------------------------------------
// Phase 5b30 — public classifier API.
// ---------------------------------------------------------------------------

function rowToResult(row: Row): ClassifierResult {
  switch (row.status) {
    case "ok": return { status: "OK", samplesCompared: row.samples };
    case "skip":
      if (row.reason === "no samples declared") return { status: "NO_SAMPLES" };
      return { status: "SKIP", reason: row.reason };
    case "fail": return { status: "FAIL", reason: row.reason };
  }
}

const classifyFnIdCached = memoizeAsyncFnIdClassification(
  async (fnId: string): Promise<ClassifierResult> => {
    const fn = candidateFnById.get(fnId)?.definition;
    if (fn === undefined) return { status: "NO_SAMPLES" };
    const samples = FN_SAMPLES[fnId] ?? [];
    if (samples.length === 0) return { status: "NO_SAMPLES" };
    return rowToResult(await runOne(fn, samples));
  },
);

export function classifyFnId(fnId: string): Promise<ClassifierResult> {
  return classifyFnIdCached(fnId);
}

/** Sequential, exactly-once batch observation. Shared helper artifacts are
 * reused, while each fnId still executes in its own fresh Wasm instance. */
export function classifyFnIds(
  fnIds: Iterable<string>,
): Promise<ReadonlyMap<string, ClassifierResult>> {
  return classifyFnIdsOnceAsync(fnIds, classifyFnId);
}
