// ---------------------------------------------------------------------------
// engine-require — a browser-safe synchronous replacement for the engine's
// internal lazy `require("./x")` calls.
//
// browser-engine-compat Phase 1b: the engine is bundled into the BROWSER
// (`distros/narthex/solid`, `ssr: false`). It relied on `require("./x")` at
// RUNTIME (inside dispatch functions, never at module-eval) to break the deep
// import cycles in its module graph — the lazy `require` defers a module's
// namespace resolution to first-use, AFTER every module has evaluated. Browser
// ESM has no `require`, so those calls throw `require is not defined`.
//
// The naive fix (`require`→static `import`) REORDERS module evaluation and
// cascades unboundedly (the registry-aggregator layer eagerly reads every
// module at eval-time — see `workstreams/browser-engine-compat/roadmap.md`
// § Surprises Phase 1). This shim avoids that: it keeps the calls as lazy
// RUNTIME lookups (eval order is UNCHANGED — the source of the cascade is gone),
// swapping only the browser-incompatible `require` primitive for a Map lookup.
//
// Every internal `require("./x")`/`require("../x")` becomes
// `engineRequire("<canonical-id>")` (id = the path relative to `engine/src`,
// forward-slashed). The targets self-populate the Map via `engine-modules.ts`
// (a static aggregator imported last by `index.ts`), so by the time any dispatch
// fires at runtime, every target has evaluated and registered. Its only imports
// are inert, import-free host state leaves, so foundational modules can import
// it without forming an initialization cycle.
//
// `node:*` requires are NOT rewritten — they live in server-only leaves that the
// browser never calls (and are already lazy per the crypto-ffi/codename-lock
// pattern).
// ---------------------------------------------------------------------------

import { getProxyTrackingDetector } from "./proxy-tracking-state";
import { sealEngineBodyHostState, type EngineBodyMemoHostServices, type EngineBodyReplayHostCapture } from "./engine-body-host-state";
import {
  cacheEngineModuleNamespace,
  deleteEngineModuleNamespace,
  engineModuleCompleted as moduleCompleted,
  engineModuleRegistered as moduleRegistered,
  getEngineModuleNamespace,
  registerCompletedEngineModule,
} from "./engine-module-state";

// S1 engine-body memo — was the realm's Proxy tracking (proxy-tracking-install.ts)
// installed before this module, the root every engine module imports, evaluated?
// Read once, here, so a later installation can never claim to be early.
const _proxyTrackingAtEngineRoot = getProxyTrackingDetector() !== null;

/** Whether Proxy tracking preceded the engine's root module in this realm. */
export function proxyTrackingInstalledBeforeEngine(): boolean {
  return _proxyTrackingAtEngineRoot;
}

// A host preload may publish capabilities and checked replay bytes before this
// root evaluates. Seal once: absent/late installation never certifies old code.
// Compiled render workers have no preload and retain the empty handoff.
const _engineBodyHost = sealEngineBodyHostState();

export function engineBodyMemoHostServices(): EngineBodyMemoHostServices | undefined {
  return _engineBodyHost.memo;
}

export function engineBodyReplayHostCapture(): EngineBodyReplayHostCapture | undefined {
  return _engineBodyHost.replay;
}

/** The process-start binding of the replay source epoch (S1b). */
export function engineBodyReplaySourceEpochBinding(): { readonly epoch?: string; readonly refused?: string } {
  const captured = _engineBodyHost.replay;
  return captured === undefined ? { refused: "host replay preload was not installed" }
    : captured.epoch === undefined ? { refused: captured.refused } : { epoch: captured.epoch };
}

// ---------------------------------------------------------------------------
// module-substrate M1 — the boot-readiness registers.
//
// The namespace register answers "do I have a namespace for this id"; it CANNOT
// answer "did that module finish evaluating", because it has TWO writers with
// different meanings: `registerEngineModule` (a module's own bottom-of-file
// self-registration, or the `engine-modules.ts` aggregator — both of which run
// only AFTER the module body completed) and `engineRequire`'s own on-demand
// cache write below (which stores whatever the host `require` handed back,
// including a cycle-partial namespace). M1's gate needs the first meaning only,
// so it gets its OWN register with ONE writer. Never fold these together.
// ---------------------------------------------------------------------------

// Namespace/completion storage lives in the inert engine-module-state leaf.
// Both loader and completion writes use that same captured-operation storage;
// read-only consumers need not evaluate this root's startup side effects.

/** Ids whose host `require` threw. Bun leaves such a module half-evaluated but
 *  still importable — hoisted function declarations stay callable while every
 *  `const`/`let` binding stays in TDZ forever — and a RE-require returns that
 *  zombie namespace without rethrowing. Latching the first error keeps the
 *  failure honest instead of handing out a booby-trapped namespace. */
const _failed = new Map<string, unknown>();

/** Nesting depth of `loadFenelModule`. Non-zero means a `.fenel` source is
 *  being parsed right now, i.e. we are somewhere inside the engine module
 *  graph's own initialization — the exact condition under which host-requiring
 *  a module of that graph re-enters an in-flight module. */
const _fenelModuleLoadStack: string[] = [];

/** Sources served by the TypeScript parser because the interpreted Fenel
 *  harness was not constructible at the time (`design/ts-exceptions-ledger.md`
 *  section B1). Each entry means "the committed parse cache is stale for this
 *  file". The audit turns a non-empty list into a CI failure so the parity
 *  window cannot be sat in silently. */
const _bootParseDeficits: Array<{
  readonly moduleName: string;
  readonly detail: string;
  /** True when the parse cache was deliberately DISABLED, so the miss carries no
   *  information about whether the committed cache is stale. The audit ignores
   *  these; the canary still sees them. */
  readonly cacheDisabled: boolean;
}> = [];

/** True when the host `require` is unavailable — i.e. the browser (ESM has no
 *  `require`), OR `FENEL_SIMULATE_BROWSER=1` (a Bun run reproducing the browser
 *  for the deterministic browser-compat gate). The single source of truth for
 *  "am I in a no-`require` environment", used by every `node:`/`require` guard
 *  (engineRequire's fallback, the compiled-artifact manifest hashes, the
 *  codeName-lock reader) so the sim exercises ALL of them. */
export function hostRequireUnavailable(): boolean {
  const sim =
    typeof process !== "undefined" && process.env && process.env["FENEL_SIMULATE_BROWSER"] === "1";
  // Production bundlers can install a callable CommonJS `require` shim in a
  // browser. It is not a native module loader: `node:crypto`, for example, is
  // then an empty externalized module. Require an actual Node/Bun host before
  // admitting the lazy native-module path. Only this boolean capability is
  // exposed; version strings do not enter catalog or artifact identity.
  const nativeHost = typeof process !== "undefined"
    && (typeof process.versions?.node === "string" || typeof process.versions?.bun === "string");
  return sim || !nativeHost || typeof require !== "function";
}

/** Register a module's namespace under its canonical id (path relative to
 *  `engine/src`, forward-slashed). Called by `engine-modules.ts` at load. */
export function registerEngineModule(id: string, ns: unknown): void {
  // module-substrate M1 — both callers are COMPLETION-ORDERED (a module's last
  // statement, or an aggregator whose static imports have all finished), so
  // this is the one sound place to record that the body ran to completion.
  registerCompletedEngineModule(id, ns);
}

/** Whether `id`'s module body ran to completion. Unlike
 *  `engineModuleRegistered`, this cannot be satisfied by `engineRequire`
 *  caching a cycle-partial namespace, so it is the signal M1's boot gate and
 *  its canary assert on. */
export function engineModuleCompleted(id: string): boolean {
  return moduleCompleted(id);
}

/** Bracket a `loadFenelModule` call. `loadFenelModule` is the only module-scope
 *  entry that can trigger a live parse, so this depth is the trustworthy "are
 *  we inside engine module-graph initialization" bit. Always pair via
 *  try/finally — an unbalanced exit would leave the engine permanently fenced
 *  onto the TypeScript parser. */
export function enterFenelModuleLoad(moduleName: string): void {
  _fenelModuleLoadStack.push(moduleName);
}

export function exitFenelModuleLoad(): void {
  _fenelModuleLoadStack.pop();
}

export function fenelModuleLoadDepth(): number {
  return _fenelModuleLoadStack.length;
}

/** The module name of the innermost in-flight `loadFenelModule`, for
 *  diagnostics. */
export function currentFenelModuleLoad(): string | undefined {
  return _fenelModuleLoadStack[_fenelModuleLoadStack.length - 1];
}

/** Record that a source had to be served by the TypeScript parser because the
 *  interpreted harness was not constructible. Deduplicated so a retry does not
 *  inflate the list. */
export function recordBootParseDeficit(
  moduleName: string,
  detail: string,
  cacheDisabled: boolean,
): void {
  // Dedup, but NEVER let the first observation's cache state stick. A process
  // that parses a source with the cache disabled and then again with it enabled
  // has observed a GENUINELY stale committed cache the second time; if the
  // disabled record won, the audit would filter the only evidence and the
  // operator would see no log either. Upgrade instead (one-way: disabled →
  // enabled, never back).
  const existing = _bootParseDeficits.findIndex(
    (d) => d.moduleName === moduleName && d.detail === detail,
  );
  if (existing >= 0) {
    if (cacheDisabled || !_bootParseDeficits[existing]!.cacheDisabled) return;
    _bootParseDeficits[existing] = { moduleName, detail, cacheDisabled: false };
  } else {
    _bootParseDeficits.push({ moduleName, detail, cacheDisabled });
    if (cacheDisabled) return;
  }
  // Loud, once per distinct deficit. Silence is what made this defect cost two
  // incidents: the fallback used to happen anyway, undiagnosed, after
  // corrupting the module graph.
  console.error(
    `[fenel] parse cache STALE for module '${moduleName}' (key ${detail}). The interpreted `
    + `Fenel parser cannot run during engine module-graph initialization, so the TypeScript `
    + `parser (the ledgered B1 performance branch) served this source. Regenerate with: `
    + `bun implementations/typescript/engine/scripts/generate-parse-cache.ts --incremental`,
  );
}

/** The deficits recorded so far. Non-empty means the committed parse cache is
 *  stale for at least one source and must be regenerated
 *  (`generate-parse-cache.ts --incremental`). */
export function bootParseDeficits(): ReadonlyArray<{
  readonly moduleName: string;
  readonly detail: string;
  readonly cacheDisabled: boolean;
}> {
  return _bootParseDeficits;
}

/** Test-only reset for the deficit register. */
export function __clearBootParseDeficitsForTests(): void {
  _bootParseDeficits.length = 0;
}

/** Synchronous, browser-safe stand-in for `require("./x")` over engine-internal
 *  modules. `id` is the canonical module id (path relative to engine/src,
 *  forward-slashed).
 *
 *  Resolution order:
 *   1. The registered namespace (self-registered on load + by the aggregator).
 *      This is the ONLY path the browser ever uses — the aggregator
 *      (`engine-modules.ts`) has registered every target by the time any dispatch
 *      fires, and eval-time callers hit self-registered targets loaded ahead of
 *      them (they statically import the target's module).
 *   2. Bun/Node fallback: force-load on demand via the host `require`, exactly as
 *      the original `require("./x")` did. This is what makes a TEST that imports
 *      only a SUBSET of the engine (never the full `index.ts`, so the aggregator
 *      never ran) still resolve a harness module — the on-demand load matches the
 *      pre-Phase-1b behavior. `require` is undefined in browser ESM, so this arm
 *      is browser-inert (and never reached there — see #1). */
export function engineRequire<T = unknown>(id: string): T {
  const ns = getEngineModuleNamespace(id);
  // A host `require` reached through an import cycle can return an empty,
  // partially initialized namespace. Caching that object permanently poisons
  // later lazy dispatch even after the target module has finished evaluating
  // (notably registry bootstrap after parser/editor startup). An empty module
  // namespace cannot satisfy an engineRequire caller, so retry the host lookup
  // once the cycle has unwound instead of treating it as a durable hit.
  const partialNamespace =
    ns !== null
    && typeof ns === "object"
    && !Object.prototype.hasOwnProperty.call(ns, Symbol.toStringTag)
    && Reflect.ownKeys(ns).length === 0;
  if (ns !== undefined && !partialNamespace) return ns as T;
  if (partialNamespace) deleteEngineModuleNamespace(id);
  // Bun/Node on-demand fallback. `require` is a LEXICAL binding in Bun ESM (not
  // on globalThis); the browser has none. `hostRequireUnavailable()` also honors
  // `FENEL_SIMULATE_BROWSER=1` so a Bun run reproduces the browser exactly.
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const req: ((p: string) => unknown) | undefined =
    !hostRequireUnavailable() ? (require as (p: string) => unknown) : undefined;
  // module-substrate M1 — poison latch. A host `require` that throws (the
  // cycle re-entry this phase repairs) leaves Bun's module graph half-evaluated
  // but still importable, and a SECOND require returns that zombie namespace
  // WITHOUT rethrowing. Replaying the original error keeps every later caller
  // honest instead of handing out hoisted-functions-with-TDZ-consts.
  const failure = _failed.get(id);
  if (failure !== undefined) throw failure;
  if (req) {
    let loaded: unknown;
    try {
      loaded = req("./" + id);
    } catch (e) {
      _failed.set(id, e);
      throw e;
    }
    const loadedIsPartial =
      loaded !== null
      && typeof loaded === "object"
      && Reflect.ownKeys(loaded).length === 0;
    if (!loadedIsPartial) cacheEngineModuleNamespace(id, loaded);
    return loaded as T;
  }
  throw new Error(
    `engineRequire: module '${id}' not registered and no host require available — ` +
      `engine-modules.ts (the aggregator) has not evaluated it yet`,
  );
}

/** Test/introspection: whether a canonical id is registered. */
export function engineModuleRegistered(id: string): boolean {
  return moduleRegistered(id);
}
