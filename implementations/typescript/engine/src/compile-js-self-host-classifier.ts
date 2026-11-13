// SUBSTRATE
// ---------------------------------------------------------------------------
// Phase 5b30 — JS self-host classifier
//
// Extracted from `compile-js-self-host.test.ts` in Phase 5b30 (matrix
// generator hardening — tier-(12-tooling) substrate sub-phase). Owns the
// JS-target self-host harness's module-init, lazy sharedFenel helper substrate,
// runOne classification, and `classifyFnId(fnId) → ClassifierResult` API
// consumed by both `compile-js-self-host.test.ts` (bun:test integration)
// AND `scripts/generate-self-host-matrix.ts` (observation-truthful matrix
// cell rendering).
//
// **NO bun:test imports** — pure classification logic + setup. The
// `describe` / `it` / `expect` calls live exclusively in the .test.ts
// sibling; importing this file from the matrix generator must not fire
// bun:test side-effects outside the test runtime context.
// ---------------------------------------------------------------------------

import { stdModule } from "./modules/std";
import { telegramModule } from "./modules/telegram";
import { engineModule } from "./modules/engine";
import { localeModule } from "./modules/locale";
import { eventsModule } from "./modules/events";
import { timeModule, hostDateParseNative } from "./modules/time";
import { animationModule } from "./modules/animation";
import { pathModule } from "./modules/path";
import { trackModule } from "./modules/track";
import { emailModule } from "./modules/email";
import {
  pictureModule, pointNative,
  alphaBlendNative, colorNative,
} from "./modules/picture";
import {
  soundModule,
  timeNative, amplitudeNative, monoNative,
  ampLNative, ampRNative, audioBufferNative,
} from "./modules/sound";
import { compileFenelToJsNative } from "./modules/compile-js";
import {
  dispatchedSerializeJsModule,
  deriveFunctorModule,
  getResolverNamespace,
  withEngineDispatchEvaluationSnapshot,
} from "./engine-bodies-dispatch";
import { algebraModule } from "./modules/algebra";
import { dispatchModule } from "./modules/dispatch";
import { decidableMembershipModule } from "./modules/decidable-membership";
import { dispatchRegistry } from "./system-entities";
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
import type { FenelFunction, FenelModule } from "./types";
import {
  buildSelfHostCandidateIndex,
  classifyFnIdsOnce,
  memoizeFnIdClassification,
  projectSelfHostCandidateModule,
} from "./self-host-classification-cache";
import {
  exactImmutableDataEqual,
  exactImmutableDataSnapshot,
  immutableCandidateRoster,
} from "./self-host-immutable-data";
import { invokeSelfHostSourceBody } from "./self-host-body-oracle";

// resolution-substrate Phase 5.3 — a RESOLVER-ONLY slice of the dispatch module.
// The full `dispatchModule` also registers the value-level polymorphic `sample` /
// `render` (`dispatch:sample` / `dispatch:render`), which COLLIDE with
// `picture:sample` etc. in this harness ⇒ bare `sample` becomes `ambiguousModule`
// ⇒ the `picture:over` / `animation:overAnim` closures (which call bare `sample`)
// hard-error. The harness only needs dispatch for the `dispatch:rsv*` resolver
// closure (the `getResolverNamespace` manifest + the interpreted fallback), so
// slice to just those — the `set:contains`-slice precedent (Phase 1b finding #3,
// `engine-bodies-dispatch.ts`). The ADT entities stay (they don't collide; the
// resolver constructs them as literals). The full module is untouched in
// production.
const dispatchResolverSlice: FenelModule = {
  ...dispatchModule,
  functions: (dispatchModule.functions ?? []).filter((f) => f.id.startsWith("dispatch:rsv")),
  // Drop the identity (Codeable / IOInvokable) instances of the DROPPED dispatch
  // functions too — the `sample` / `render` codeName bindings live on their
  // `Codeable` instances, so filtering only the functions leaves the collision.
  // Keep rsv* instances + the non-dispatch-targeting ADT entity instances.
  instances: (dispatchModule.instances ?? []).filter((inst) => {
    const target = String((inst as { args?: unknown[] }).args?.[0] ?? "");
    return !target.startsWith("dispatch:") || target.startsWith("dispatch:rsv");
  }),
};
import { evaluate, invokeCallable, truthy, type EvaluateContext } from "./json-logic";
import {
  createEngineBootstrapRegistry,
  type RoutingTableValue,
} from "./registry";
import { functionRefHandle } from "./type-foundation";
import {
  getRepositoryCompilerConstructorMetadataView,
  getRepositoryCompilerMetadataView,
  type RepositoryCompilerMetadataView,
} from "./compiler-metadata-view";
import { createDispatchRegistry } from "./dispatch-registry";
import {
  buildEffectStubsForFn,
  constraintsToRequiresStrings,
} from "./effect-bootstrap-helpers";
import {
  buildSamples,
  effectfulCanary,
  JS_EXPECTED_GAPS,
  PROBE_ARGS,
  SCRATCH_SCOPE,
  scopeForConstraint,
  type Sample,
} from "./self-host-samples";

// Phase 5b30 — observed-status classifier result. Matrix generator + .test.ts
// consume the same shape; cells / assertions branch on `status`.
//
// `GAP` is NOT a classifier status — gap pre-empt lives at the consumer
// layer (matrix-gen renders `GAP` when `EXPECTED_GAPS[fnId]` is set; .test.ts
// inverts the gap-as-expected-failure check against the observed status).
// Keeping the classifier gap-agnostic lets the matrix audit detect stale
// gaps (gap declared but observed runtime would PASS).
export type ClassifierResult =
  | { status: "OK"; samplesCompared: number }
  | { status: "SKIP"; reason: string }
  | { status: "FAIL"; reason: string }
  | { status: "NO_SAMPLES" };

// Shared base context for engine-side evaluation. The registry exposes
// `getFunction` / `natives` / `nativesCtx` so a Fenel body that calls
// `startsWith`, `slice`, `head`, etc. dispatches through std's natives at
// engine-eval time.
// resolution-substrate Phase 5.3 — the harness now ALSO loads algebra (the
// `Sequential` List/Vec instances + the `take`/`drop` bodies), deriveFunctor
// (Vec's derived Foldable, for the `drop` body's `foldableLength`),
// decidableMembership (the `set:contains` sibling binding that makes bare
// `contains` multi-binding) + dispatch (the `dispatch:rsv*` resolver closure)
// over the SHARED `dispatchRegistry` (the `Sequential`/`Containable`/`Functor`
// seeds). Without this, bare `take` binds only `std:take` ⇒ single-binding ⇒ no
// multi-binding dispatch site exists in the harness (the latent half of the bug
// — Phase-5 Step-0). With it, the projected routing table carries the
// `take → RDispatch "Sequential"` route + the `(Sequential, "Vec")` instance,
// and `getResolverNamespace(harnessRegistry)` is fresh (std + dispatch present).
const harnessModules = [
  stdModule, telegramModule, engineModule, localeModule,
  eventsModule, timeModule, animationModule, pathModule, trackModule, emailModule,
  pictureModule, soundModule,
  algebraModule, deriveFunctorModule, decidableMembershipModule, dispatchResolverSlice,
] as FenelModule[];
const harnessRegistry = createEngineBootstrapRegistry(harnessModules, { dispatchRegistry });
const baseEngineCtx = harnessRegistry.evaluateContext();

// The evaluator must remain on the bootstrap registry during this module's
// initialization: a full field-normalizing registry re-enters engine module
// loading. Compiler metadata is resolved lazily after the import graph settles.
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
    throw new Error(`JS self-host compiler metadata: unresolved function owner ${fn.id}`);
  }
  return identified;
}

// ---------------------------------------------------------------------------
// $fenel runtime — namespace the compiled JS may reference. See historical
// notes in `compile-js-self-host.test.ts` for the per-binding rationale; the
// runtime ships verbatim from 5b29 here.
// ---------------------------------------------------------------------------

const $fenelBaseRuntime: Record<string, unknown> = {
  $structuralTruthy: truthy,
  concat: (a: unknown, b: unknown): unknown => {
    if (Array.isArray(a) && Array.isArray(b)) return [...a, ...b];
    return String(a ?? "") + String(b ?? "");
  },
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
  startsWith: (s: unknown, pre: unknown): boolean =>
    String(s ?? "").startsWith(String(pre ?? "")),
  contains: (s: unknown, sub: unknown): boolean =>
    String(s ?? "").includes(String(sub ?? "")),
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
      return xs.length > 0 ? { $tag: "Just", _0: xs[0] } : { $tag: "Nothing" };
    }
    if (typeof xs === "string") {
      const it = xs[Symbol.iterator]().next();
      return it.done ? { $tag: "Nothing" } : { $tag: "Just", _0: it.value };
    }
    return { $tag: "Nothing" };
  },
  tail: (xs: unknown): unknown => {
    if (Array.isArray(xs)) {
      return xs.length > 0 ? { $tag: "Just", _0: xs.slice(1) } : { $tag: "Nothing" };
    }
    if (typeof xs === "string") {
      const it = xs[Symbol.iterator]().next();
      return it.done ? { $tag: "Nothing" } : { $tag: "Just", _0: xs.slice(it.value.length) };
    }
    return { $tag: "Nothing" };
  },
  toString: (x: unknown): string => (x == null ? "" : String(x)),
  elem: (needle: unknown, haystack: unknown): boolean => {
    if (typeof haystack === "string") return haystack.includes(String(needle));
    if (Array.isArray(haystack)) return haystack.includes(needle);
    return false;
  },
  appendItem: (item: unknown, arr: unknown): unknown[] =>
    Array.isArray(arr) ? [...arr, item] : [item],
  sortLex: (arr: unknown): unknown[] =>
    Array.isArray(arr) ? [...arr].sort() : [],
  trim: (x: unknown): string => String(x ?? "").trim(),
  lower: (x: unknown): string => String(x ?? "").toLowerCase(),
  imageGrayscale: imgOps.imgGrayscale,
  imagePixelate: imgOps.imgPixelate,
  matchFail: (_v: unknown): unknown => null,
  hasOwn: (value: unknown, key: unknown): boolean =>
    value !== null
    && typeof value === "object"
    && Object.prototype.hasOwnProperty.call(value, String(key)),
  find: (pred: unknown, xs: unknown): unknown => {
    if (typeof pred !== "function") return { $tag: "Nothing" };
    for (const v of Array.isArray(xs) ? xs : []) {
      if ((pred as (a: unknown) => unknown)(v)) return { $tag: "Just", _0: v };
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
};

// ---------------------------------------------------------------------------
// Phase 20.0 — effect-handler stubs.
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
  fnSamples ??= buildSamples("js", getHarnessCtorDefs());
  return fnSamples;
}
export const FN_SAMPLES = new Proxy({} as ReturnType<typeof buildSamples>, {
  get: (_target, key) => getFnSamples()[key as string],
  ownKeys: () => Reflect.ownKeys(getFnSamples()),
  getOwnPropertyDescriptor: (_target, key) =>
    Object.getOwnPropertyDescriptor(getFnSamples(), key),
});
export const EXPECTED_GAPS = JS_EXPECTED_GAPS;

// ---------------------------------------------------------------------------
// Per-function result rows. Surfaces the report at the end of the test suite
// — kept here so consumers can drive their own reporting without re-running
// the classifier. The classifier itself does not mutate `rows`; mutation is
// the .test.ts consumer's responsibility (per-fnId test pushes its outcome).
// ---------------------------------------------------------------------------

export type Row =
  | { status: "ok"; fnId: string; samples: number }
  | { status: "skip"; fnId: string; reason: string }
  | { status: "fail"; fnId: string; reason: string };

type JsCompileArtifact =
  | { readonly status: "ok"; readonly fn: (...args: unknown[]) => unknown }
  | { readonly status: "skip"; readonly reason: string };

type JsCompileCacheEntry = {
  /** Deeply isolated complete compiler input that produced `artifact`. */
  readonly inputFingerprint: CompileSource;
  readonly artifact: JsCompileArtifact;
};

const sharedJsCompileArtifacts = new Map<string, JsCompileCacheEntry>();
let jsArtifactCompileAttempts = 0;
let sharedHelperCacheHits = 0;
let sharedHelperCompileSuccesses = 0;
let sharedHelperCompileFailures = 0;
const sharedHelperCompileIds: string[] = [];

export type JsClassificationDiagnostic = {
  readonly fnId: string;
  readonly elapsedMs: number;
  readonly artifactCompileAttempts: number;
  readonly sharedHelperCacheHits: number;
  /** Includes the entry fnId when this cell first compiled its own pure body. */
  readonly sharedCompileIds: readonly string[];
  /** Newly compiled cross-function dependencies, excluding the entry fnId. */
  readonly dependencyCompileIds: readonly string[];
};

export type JsClassifierStats = {
  readonly artifactCompileAttempts: number;
  readonly sharedHelperCacheHits: number;
  readonly sharedHelperCompileSuccesses: number;
  readonly sharedHelperCompileFailures: number;
  readonly sharedHelperCompileIds: readonly string[];
};

const classificationDiagnostics = new Map<string, JsClassificationDiagnostic>();

export function getClassifierStats(): JsClassifierStats {
  return Object.freeze({
    artifactCompileAttempts: jsArtifactCompileAttempts,
    sharedHelperCacheHits,
    sharedHelperCompileSuccesses,
    sharedHelperCompileFailures,
    sharedHelperCompileIds: Object.freeze([...sharedHelperCompileIds]),
  });
}

export function getClassificationDiagnostic(
  fnId: string,
): JsClassificationDiagnostic | undefined {
  return classificationDiagnostics.get(fnId);
}

function sourceForFunction(fn: FenelFunction, identifiedFn: FenelFunction): CompileSource {
  const requires = fn.requires ?? [];
  const callBindings = moduleCallBindingsFor(fn);
  const ctorDefs = getHarnessCtorDefs(identifiedFn);
  return {
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
}

function compileJsArtifact(
  source: CompileSource,
  runtime: Record<string, unknown>,
): JsCompileArtifact {
  jsArtifactCompileAttempts += 1;
  const compiled = compileFenelToJsNative(source);
  if (compiled.$tag === "Err") {
    return { status: "skip", reason: `compile failed: ${JSON.stringify(compiled._0)}` };
  }
  const serialised = dispatchedSerializeJsModule(compiled._0);
  if (serialised.$tag === "Err") {
    return { status: "skip", reason: `serialise failed: ${serialised._0}` };
  }
  try {
    // eslint-disable-next-line @typescript-eslint/no-implied-eval, no-new-func
    const fn = new Function("$fenel", `return ${serialised._0};`)(runtime) as (
      ...args: unknown[]
    ) => unknown;
    return { status: "ok", fn };
  } catch (e) {
    return { status: "skip", reason: `eval failed: ${(e as Error).message}` };
  }
}

// ---------------------------------------------------------------------------
// Test harness — one fn, all samples
// ---------------------------------------------------------------------------

export function runOne(fn: FenelFunction, samples: ReadonlyArray<Sample>): Row {
  return withEngineDispatchEvaluationSnapshot(() => runOneInSnapshot(fn, samples));
}

function runOneInSnapshot(fn: FenelFunction, samples: ReadonlyArray<Sample>): Row {
  const fnId = fn.id;
  if (samples.length === 0) {
    return { status: "skip", fnId, reason: "no samples declared" };
  }
  ensureSharedFenelCompiled();
  const identifiedFn = getCompilerFunction(fn);
  const requires = fn.requires ?? [];
  const source = sourceForFunction(fn, identifiedFn);
  const ctx: EvaluateContext = {
    ...baseEngineCtx,
    natives: { ...(baseEngineCtx.natives ?? {}) },
  };
  let $fenel: Record<string, unknown> = sharedFenel;
  if (requires.length > 0) {
    let stubs;
    try {
      stubs = buildEffectStubsForFn(fn, ctx, stubRegistry, scopeForConstraint);
    } catch (e) {
      return { status: "skip", fnId, reason: `effect stubs failed: ${(e as Error).message}` };
    }
    $fenel = Object.assign(
      Object.create(null) as Record<string, unknown>,
      sharedFenel,
      { $effect: stubs.effectNamespace },
    );
    ctx.natives = { ...(ctx.natives ?? {}), ...stubs.effectNatives };
  }
  const artifact = requires.length === 0
    ? compileSharedJsFunction(fn, source)
    : compileJsArtifact(source, $fenel);
  if (artifact.status === "skip") {
    return { status: "skip", fnId, reason: artifact.reason };
  }
  const compiledFn = artifact.fn;
  const probeArgs = PROBE_ARGS[fnId] ?? [2];
  for (const args of samples) {
    const engineArgs = liftSampleForEngine(args, ctx);
    const compiledArgs = liftSampleForCompiledJs(args, ctx);
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
      eq = sameValue(engineResult, compiledResult, ctx, probeArgs);
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

function liftSampleForCompiledJs(args: ReadonlyArray<unknown>, ctx: EvaluateContext): unknown[] {
  return args.map((a) => {
    if (!isFnSyntax(a)) return a;
    const closure = evaluate(a, {}, ctx);
    return (...probe: unknown[]) => invokeCallable(closure, probe, ctx);
  });
}

function sameValue(
  a: unknown,
  b: unknown,
  ctx?: EvaluateContext,
  probeArgs: ReadonlyArray<unknown> = [2],
): boolean {
  if (Object.is(a, b)) return true;
  if (a === null || b === null) return false;
  if (isFenelClosureSentinel(a) && typeof b === "function" && ctx !== undefined) {
    const aRes = invokeCallable(a, probeArgs as unknown[], ctx);
    const bRes = (b as (...args: unknown[]) => unknown)(...probeArgs);
    return sameValue(aRes, bRes, ctx, probeArgs);
  }
  if (typeof a !== typeof b) return false;
  if (Array.isArray(a) && Array.isArray(b)) {
    if (a.length !== b.length) return false;
    for (let i = 0; i < a.length; i++) if (!sameValue(a[i], b[i], ctx, probeArgs)) return false;
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

// ---------------------------------------------------------------------------
// Candidate enumeration.
// ---------------------------------------------------------------------------

const candidateModules = [
  stdModule, telegramModule, engineModule, localeModule,
  eventsModule, timeModule, animationModule, pathModule, trackModule, emailModule,
  pictureModule,
  soundModule,
  // resolution-substrate Phase 5.3 — algebra's `take`/`drop`/`splitAt` + Vec
  // helpers are the bodied dispatch TARGETS (`algebra:take` etc.) the compiled
  // `$fenel` dispatcher routes to; deriveFunctor + decidableMembership round
  // out the dispatch closure; the dispatch RESOLVER SLICE carries the `rsv*`
  // bodies (the sample/render-free slice — see harnessRegistry above).
  algebraModule, deriveFunctorModule, decidableMembershipModule, dispatchResolverSlice,
];

const routingTable: RoutingTableValue = harnessRegistry.routingTable();
// The projected Fenel verdict populates global dispatcher bindings. Source
// declarations retain their own lexical targets through the binding projection.
const dispatchRouteNames = new Set(
  routingTable.routes.filter((r) => r.resolution.$tag === "RDispatch").map((r) => r.name),
);
const ambiguousRouteNames = new Set(
  routingTable.routes
    .filter((r) => r.resolution.$tag === "RAmbiguousClass" || r.resolution.$tag === "RAmbiguousModule")
    .map((r) => r.name),
);

/** The registry encodes its hot RDirect verdict as a route-index miss. A
 * present row authorizes a compatibility alias only if it explicitly remains
 * RDirect; every current or future non-direct verdict fails closed. */
function routingAllowsDirectAlias(name: string): boolean {
  if (!Object.prototype.hasOwnProperty.call(routingTable.routeIdx, name)) return true;
  return routingTable.routeIdx[name]?.$tag === "RDirect";
}
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
// Phase 21.2 — shared `$fenel` runtime with cross-Fenel-call substrate.
// Registers every pure Fenel-bodied candidate up front and compiles each at
// most once on executable demand; cross-fn dispatch + self-recursion resolve
// through the stable lazy wrappers.
//
// resolution-substrate Phase 5.3 — the NAMESPACE RE-KEY + the compiled Fenel
// DISPATCHER install (the actual compiled-path bug fix). The old first-wins
// loop (`if (codeName in sharedFenel) continue`) installed ONE function per
// codeName, so a compiled bare multi-binding `take 2 xs` (lowered to a static
// `$fenel.take(2, xs)`) silently mis-resolved. Now:
//   (1) every candidate — REGISTRY NATIVE and Fenel-BODIED — installs under its
//       FULL fnId key (`$fenel["std:take"]` vs `$fenel["algebra:take"]`,
//       distinct), so a dispatcher can call the resolved target by fnId.
//   (2) single-binding codeNames install their one fn under the codeName (the
//       base runtime wins, then first bodied — byte-identical to the old loop).
//   (3) a multi-binding codeName whose projected route is `RDispatch cls`
//       installs a DISPATCHER closure: it calls the compiled Fenel resolver
//       (the 5.2 `getResolverNamespace` artifact) over the build-static routing
//       table + the reflected args, then invokes the resolved full-fnId entry.
// The "which codeNames dispatch" DECISION is the projected Fenel routing table's
// `routes` (an `RDispatch` route), NOT a re-derived TS classification — the new
// TS is pure POPULATION GLUE (Fenel-first; the resolver stays the sole dispatch
// authority). Flagged: ADDS to the already-ledgered self-host bootstrap seam.

// The projected Fenel verdict drives both compatibility aliases and dispatch.
// A route-table miss is RDirect; RAmbiguous* names are deliberately absent and
// RDispatch names are installed as dispatchers below. TypeScript populates the
// projected verdict and never chooses among competing declarations.
// The compiled Fenel resolver (5.2). Fresh against `harnessRegistry` (std +
// dispatch present); a stale artifact ⇒ null ⇒ the dispatchers fall back to the
// interpreted body (rare — the CI `--check` gate keeps the artifact fresh).
const resolverNamespace = getResolverNamespace(harnessRegistry);

const shortCodeOf = (id: string): string =>
  id.includes(":") ? id.slice(id.indexOf(":") + 1) : id;

function defineCompilerMapEntry(
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

function compilerMapHasOwn(target: Record<string, unknown>, key: string): boolean {
  return Object.prototype.hasOwnProperty.call(target, key);
}

/** Build the interpreter oracle's parameter environment from current wire
 * projections without exposing semantic names to Object.prototype. */
export function buildCompilerEvaluationData(
  params: readonly { readonly name: string }[],
  args: readonly unknown[],
): Record<string, unknown> {
  const data = Object.create(null) as Record<string, unknown>;
  for (let i = 0; i < params.length; i++) {
    defineCompilerMapEntry(data, params[i]!.name, args[i]);
  }
  return data;
}

const sharedFenel = Object.assign(
  Object.create(null) as Record<string, unknown>,
  $fenelBaseRuntime,
);
for (const name of ambiguousRouteNames) delete sharedFenel[name];
for (const name of dispatchRouteNames) delete sharedFenel[name];

// (a) every registry native under its FULL fnId key (the dispatch targets +
//     the bodied targets' native deps). Distinct keys ⇒ never a collision.
const harnessNatives = (baseEngineCtx as { natives?: Record<string, unknown> }).natives ?? {};
for (const [fnId, impl] of Object.entries(harnessNatives)) {
  if (typeof impl !== "function") continue;
  defineCompilerMapEntry(sharedFenel, fnId, impl);
}

// Routing-table MISS is the registry's direct fast path. Project exact full
// native ids to a short compatibility key only when the complete native roster
// proves one semantic owner. Explicit ambiguous and dispatch routes remain
// fenced; TypeScript never chooses among collisions.
const uniqueNativeByCodeName = new Map<string, unknown | null>();
for (const [fnId, impl] of Object.entries(harnessNatives)) {
  if (typeof impl !== "function" || !fnId.includes(":")) continue;
  const codeName = shortCodeOf(fnId);
  uniqueNativeByCodeName.set(
    codeName,
    uniqueNativeByCodeName.has(codeName) ? null : impl,
  );
}

// (b) Install one lazy wrapper for every pure Fenel-bodied candidate under the
//     FULL fnId key and, only when the projected routing table has no dispatch
//     or ambiguity row (its RDirect fast-path verdict), under the compatibility
//     codeName. A helper is compiled on first executable demand, not merely
//     because some unrelated matrix row has samples. The artifact cache is also
//     consumed by that helper's own classification, so every compiler input is
//     compiled at most once in this process.
let sharedFenelCompiled = false;
function compileSharedJsFunction(
  fn: FenelFunction,
  currentSource?: CompileSource,
  publishCanonicalArtifact = false,
): JsCompileArtifact {
  const source = currentSource
    ?? sourceForFunction(fn, getCompilerFunction(fn));
  // A function id is only an index into this cache, never freshness authority.
  // Snapshot before reading the cache, compile that same isolated snapshot, and
  // compare every own data descriptor on the next lookup. Mutable callers can
  // therefore neither rewrite the retained fingerprint nor race compilation.
  const inputSnapshot = exactImmutableDataSnapshot(source);
  const cached = sharedJsCompileArtifacts.get(fn.id);
  if (
    inputSnapshot.status === "ok"
    && cached !== undefined
    && exactImmutableDataEqual(cached.inputFingerprint, inputSnapshot.value)
  ) {
    sharedHelperCacheHits += 1;
    if (publishCanonicalArtifact && cached.artifact.status === "ok") {
      defineCompilerMapEntry(sharedFenel, fn.id, cached.artifact.fn);
    }
    return cached.artifact;
  }
  if (inputSnapshot.status === "uncacheable") {
    sharedJsCompileArtifacts.delete(fn.id);
  }
  const compilerInput = inputSnapshot.status === "ok"
    ? inputSnapshot.value
    : source;
  sharedHelperCompileIds.push(fn.id);
  let artifact: JsCompileArtifact;
  try {
    artifact = compileJsArtifact(compilerInput, sharedFenel);
  } catch (e) {
    artifact = {
      status: "skip",
      reason: `compile setup failed: ${(e as Error).message}`,
    };
  }
  if (inputSnapshot.status === "ok") {
    sharedJsCompileArtifacts.set(fn.id, {
      inputFingerprint: inputSnapshot.value,
      artifact,
    });
  }
  if (artifact.status === "ok") {
    sharedHelperCompileSuccesses += 1;
    if (publishCanonicalArtifact) {
      defineCompilerMapEntry(sharedFenel, fn.id, artifact.fn);
    }
  } else {
    sharedHelperCompileFailures += 1;
  }
  return artifact;
}

function lazySharedJsFunction(fn: FenelFunction): (...args: unknown[]) => unknown {
  return (...args: unknown[]): unknown => {
    // Only this closure captures a canonical candidate-index definition. Public
    // runOne callers may reuse the exact artifact cache, but cannot publish an
    // arbitrary same-id body into the dependency namespace.
    const artifact = compileSharedJsFunction(fn, undefined, true);
    if (artifact.status === "skip") {
      throw new Error(`shared JS helper ${fn.id}: ${artifact.reason}`);
    }
    return artifact.fn(...args);
  };
}

function ensureSharedFenelCompiled(): void {
  if (sharedFenelCompiled) return;
  sharedFenelCompiled = true;
  for (const { definition: fn } of candidateFnById.values()) {
    if (fn.body === undefined) continue;
    if ((fn.requires ?? []).length > 0) continue;
    const codeName = shortCodeOf(fn.id);
    const lazy = lazySharedJsFunction(fn);
    // These exact native performance slots are part of the compiler ABI.
    // Preserve their already projected callbacks, never a spelling-wide rule.
    const keepStockBoolean = (fn.id === "std:and" || fn.id === "std:or")
      && typeof harnessNatives[fn.id] === "function";
    if (!keepStockBoolean) defineCompilerMapEntry(sharedFenel, fn.id, lazy);
    if (
      !compilerMapHasOwn(sharedFenel, codeName)
      && routingAllowsDirectAlias(codeName)
    ) {
      defineCompilerMapEntry(sharedFenel, codeName, lazy);
    }
  }
}

/** Warm repository identity metadata outside an individual test's timeout
 * budget, then register lazy helper wrappers. Function compilation remains
 * executable-demand-only. */
export function prepareClassifier(): void {
  getHarnessCtorDefs();
  ensureSharedFenelCompiled();
}

// (c) gap-fill native codeNames the bodied dispatch targets need (`mapGet` /
//     `fromEntries` / … — natives with no curated base-runtime nor bodied
//     equivalent). Only a route-table miss (RDirect) authorizes a short alias.
for (const [codeName, impl] of uniqueNativeByCodeName) {
  if (impl === null) continue;
  if (
    compilerMapHasOwn(sharedFenel, codeName)
    || !routingAllowsDirectAlias(codeName)
  ) continue;
  defineCompilerMapEntry(sharedFenel, codeName, impl);
}

// (d) install the compiled Fenel DISPATCHER for each multi-binding `RDispatch`
//     codeName. The dispatcher reflects the args via the 5.2 resolver, then
//     invokes the resolved full-fnId entry. frames/tags are []/[] — block scope
//     is lexical (compile-time), so the compiled `$fenel` has no runtime
//     dict-stack. The compiled emitter pre-curries partial applications (a bare
//     `take 2` lowers to `(xs) => $fenel.take(2, xs)`), so the dispatcher is
//     only reached fully-applied ⇒ `UnderApplied` does not arise here (the
//     interpreted-path eta wrinkle is Phase 5.4); a defensive throw guards it.
//     The `Resolved` payload is the instance's method value; see
//     `compiledDispatchTargetId` below for how it names a `$fenel` entry.
// rights R3a — GLOBAL_ONLY, DECLARED: the self-host harness runs under no
// authenticated frame, so the resolver's sixth argument (the frame's own
// account) is `Nothing` and no account-owned row is visible here. Passing only
// five arguments made the interpreted fallback return a curried partial, so
// every compiled dispatch threw while the compiled resolver was stale.
const HARNESS_ACCOUNT = Object.freeze({ $tag: "Nothing" });

function compiledDispatcher(name: string): (...args: unknown[]) => unknown {
  return (...args: unknown[]): unknown => {
    const outcome = (
      resolverNamespace !== null
        ? (resolverNamespace["rsvResolveBareName"] as (...a: unknown[]) => Record<string, unknown>)(
            routingTable, name, args, [], [], HARNESS_ACCOUNT,
          )
        : (evaluate(
            { call: ["dispatch:rsvResolveBareName", { var: "t" }, { var: "n" }, { var: "a" }, { var: "f" }, { var: "g" }, { var: "acct" }] } as never,
            { t: routingTable, n: name, a: args, f: [], g: [], acct: HARNESS_ACCOUNT },
            baseEngineCtx,
          ) as Record<string, unknown>)
    );
    switch (outcome.$tag) {
      case "Resolved": {
        const targetId = compiledDispatchTargetId(name, outcome._0);
        const target = sharedFenel[targetId];
        if (typeof target !== "function") {
          throw new Error(
            `compiled dispatch "${name}": resolved fnId "${targetId}" is not installed in $fenel`,
          );
        }
        return (target as (...a: unknown[]) => unknown)(...args);
      }
      case "Conflicted":
        throw new Error(`compiled dispatch "${name}": conflicting instances for key "${String(outcome._0)}"`);
      case "Ambiguous":
        throw new Error(`compiled dispatch "${name}": ambiguous bare name`);
      default:
        // Direct / NoInstance / UnderApplied — none should arise in the
        // fully-applied compiled path; surface loudly rather than mis-dispatch.
        throw new Error(`compiled dispatch "${name}": unresolved (${String(outcome.$tag)})`);
    }
  };
}
for (const name of dispatchRouteNames) {
  defineCompilerMapEntry(sharedFenel, name, compiledDispatcher(name));
}

/** The `$fenel` key a resolver `Resolved` payload names for the compiled
 *  dispatcher of bare `name`. The payload is the class instance's method value:
 *  an id string is used as written, as before; a `{$ref}` function reference
 *  (an own-data handle) is resolved through the harness registry to the
 *  canonical id `$fenel` entries are keyed by (a dotted or code-name handle is
 *  not itself a key). A reference that resolves to no function, or any other
 *  value, throws — never a mis-dispatch. Exported for its test. */
export function compiledDispatchTargetId(name: string, resolved: unknown): string {
  if (typeof resolved === "string") return resolved;
  const handle = functionRefHandle(resolved);
  const canonical = handle === undefined ? undefined : harnessRegistry.getFunction(handle)?.id;
  if (canonical === undefined) {
    throw new Error(
      handle === undefined
        ? `compiled dispatch "${name}": resolved method ${String(resolved)} is neither a fnId nor a function reference`
        : `compiled dispatch "${name}": resolved method reference "${handle}" resolves to no function`,
    );
  }
  return canonical;
}

/** The compiled dispatcher installed in the shared `$fenel` runtime for a bare
 *  `RDispatch` route name, or `undefined`. Read-only access for tests: it hands
 *  out the installed closure and compiles nothing. */
export function compiledDispatcherFor(
  name: string,
): ((...args: unknown[]) => unknown) | undefined {
  if (!dispatchRouteNames.has(name)) return undefined;
  const entry = sharedFenel[name];
  return typeof entry === "function" ? (entry as (...args: unknown[]) => unknown) : undefined;
}

// ---------------------------------------------------------------------------
// Phase 5b30 — public classifier API.
//
// Observes the runtime status of a single fnId WITHOUT pre-empting on
// EXPECTED_GAPS. The matrix generator + .test.ts both invoke this; gap
// overlay is applied by the consumer (matrix renders `GAP`; .test.ts
// inverts the expected-failure check). The classifier is the truth source
// for "what did the harness actually observe at this fnId on this target".
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

const classifyFnIdCached = memoizeFnIdClassification((fnId: string): ClassifierResult => {
  const startedAt = performance.now();
  const artifactAttemptsBefore = jsArtifactCompileAttempts;
  const cacheHitsBefore = sharedHelperCacheHits;
  const sharedIdsBefore = sharedHelperCompileIds.length;
  const fn = candidateFnById.get(fnId)?.definition;
  const samples = fn === undefined ? [] : FN_SAMPLES[fnId] ?? [];
  const result = fn === undefined || samples.length === 0
    ? { status: "NO_SAMPLES" as const }
    : rowToResult(runOne(fn, samples));
  const sharedCompileIds = Object.freeze(sharedHelperCompileIds.slice(sharedIdsBefore));
  classificationDiagnostics.set(fnId, Object.freeze({
    fnId,
    elapsedMs: performance.now() - startedAt,
    artifactCompileAttempts: jsArtifactCompileAttempts - artifactAttemptsBefore,
    sharedHelperCacheHits: sharedHelperCacheHits - cacheHitsBefore,
    sharedCompileIds,
    dependencyCompileIds: Object.freeze(sharedCompileIds.filter((id) => id !== fnId)),
  }));
  return result;
});

export function classifyFnId(fnId: string): ClassifierResult {
  return classifyFnIdCached(fnId);
}

/** Batch observation for matrix consumers. Duplicate fnIds preserve one
 * compile/run result and expected-gap declarations remain outside this API. */
export function classifyFnIds(
  fnIds: Iterable<string>,
): ReadonlyMap<string, ClassifierResult> {
  return classifyFnIdsOnce(fnIds, classifyFnId);
}
