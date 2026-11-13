/** Privileged preload for an M3b immutable compiled-artifact render worker. */

import { createHash } from "node:crypto";
import { closeSync, existsSync, lstatSync, openSync, readFileSync, realpathSync, writeSync } from "node:fs";
import Module, { createRequire } from "node:module";
import { dirname, isAbsolute, relative, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";
import {
  COMPILED_ARTIFACT_DECLARED_ABSENT_ENVIRONMENT_KEYS,
  COMPILED_ARTIFACT_FIXED_PRESENT_ENVIRONMENT_KEYS,
  COMPILED_ARTIFACT_LOADED_MODULE_BUILTINS,
} from "./compiled-artifact-worker-policy";

const privilegedCloseSync = closeSync;
const privilegedOpenSync = openSync;
const privilegedWriteSync = writeSync;
const privilegedBufferFrom = Buffer.from;
const privilegedBufferConcat = Buffer.concat;
const privilegedExitListenerCount = process.listenerCount.bind(process, "exit");
const privilegedExistsSync = existsSync;
const privilegedLstatSync = lstatSync;
const privilegedReadFileSync = readFileSync;
const privilegedRealpathNative = realpathSync.native.bind(realpathSync);

type SnapshotManifest = {
  readonly schema: "fenel.compiled-artifact-snapshot.v1";
  readonly root: ".";
  readonly artifact: "compiled-parser" | "compiled-resolver";
  readonly rows: readonly {
    readonly path: string;
    readonly byteLength: number;
    readonly digest: string;
  }[];
  readonly contentDigest: string;
};

const launcherEnvironment = Bun.env;
const snapshotRootValue = launcherEnvironment["FENEL_M3B_SNAPSHOT_ROOT"];
const tracePathValue = launcherEnvironment["FENEL_M3B_TRACE_PATH"];
const workerPathValue = launcherEnvironment["FENEL_M3B_WORKER_PATH"];
if (snapshotRootValue === undefined || tracePathValue === undefined || workerPathValue === undefined) {
  throw new Error("M3b worker preload requires snapshot-root, trace-path, and worker-path launcher controls");
}
if (!isAbsolute(snapshotRootValue) || !isAbsolute(tracePathValue) || !isAbsolute(workerPathValue)) {
  throw new Error("M3b worker preload controls must be absolute paths");
}

const requestedSnapshotRoot = resolve(snapshotRootValue);
const requestedTracePath = resolve(tracePathValue);
const requestedRelativeTrace = relative(requestedSnapshotRoot, requestedTracePath);
if (requestedRelativeTrace !== ".m3b-worker-trace.jsonl") {
  throw new Error("M3b worker trace path must be the owned trace file inside the snapshot");
}
// Bun may expand an inherited Windows 8.3 path before presenting importer
// paths to plugin hooks. Canonicalize the existing root once so manifest and
// resolver keys use the same spelling on every hook.
const snapshotRoot = privilegedRealpathNative(requestedSnapshotRoot);
const tracePath = resolve(snapshotRoot, ".m3b-worker-trace.jsonl");
const relativeTrace = relative(snapshotRoot, tracePath);
if (relativeTrace !== ".m3b-worker-trace.jsonl") {
  throw new Error("M3b worker trace path must be the owned trace file inside the snapshot");
}
const rootStat = privilegedLstatSync(snapshotRoot);
if (!rootStat.isDirectory() || rootStat.isSymbolicLink()) {
  throw new Error("M3b worker snapshot root must be a plain directory");
}
if (privilegedExistsSync(tracePath)) {
  throw new Error("M3b worker trace path must not exist before the single-use worker starts");
}

// The trace is single-use, private evidence consumed only after worker exit.
// Retain one exclusive descriptor and bounded batches instead of opening and
// closing the file for every event. A killed worker without closing evidence
// remains a failed render; the trace is not a durable publication.
const traceFd = privilegedOpenSync(tracePath, "wx", 0o600);
const TRACE_BUFFER_LIMIT = 64 * 1024;
let traceChunks: Buffer[] = [];
let traceByteLength = 0;
let traceExiting = false;
let traceWriteFailed = false;
let traceWriteFailure: unknown;

function flushTrace(): void {
  if (traceWriteFailed) throw traceWriteFailure;
  if (traceByteLength === 0) return;
  try {
    const bytes = privilegedBufferConcat(traceChunks, traceByteLength);
    let offset = 0;
    while (offset < bytes.byteLength) {
      const written = privilegedWriteSync(traceFd, bytes, offset, bytes.byteLength - offset);
      if (written <= 0) throw new Error("short M3b trace write");
      offset += written;
    }
    traceChunks = [];
    traceByteLength = 0;
  } catch (error) {
    // A caught worker error must not let the closing hook retry an already
    // written prefix or publish successful evidence after trace IO failed.
    traceWriteFailed = true;
    traceWriteFailure = error;
    throw error;
  }
}

function trace(kind: string, detail: Readonly<Record<string, unknown>>): void {
  if (traceWriteFailed) throw traceWriteFailure;
  const bytes = privilegedBufferFrom(`${JSON.stringify({ kind, ...detail })}\n`, "utf8");
  traceChunks.push(bytes);
  traceByteLength += bytes.byteLength;
  if (traceExiting || traceByteLength >= TRACE_BUFFER_LIMIT) flushTrace();
}

const manifestPath = resolve(snapshotRoot, ".m3b-snapshot-manifest.json");
const manifestStat = privilegedLstatSync(manifestPath);
if (!manifestStat.isFile() || manifestStat.isSymbolicLink()) {
  throw new Error("M3b worker snapshot manifest must be one plain file");
}
const manifestValue: unknown = JSON.parse(privilegedReadFileSync(manifestPath, "utf8"));
if (manifestValue === null || typeof manifestValue !== "object" || Array.isArray(manifestValue)) {
  throw new Error("M3b worker snapshot manifest root must be an object");
}
const manifestRecord = manifestValue as Record<string, unknown>;
const manifestKeys = Object.keys(manifestRecord).sort();
if (manifestKeys.join("\0") !== ["artifact", "contentDigest", "root", "rows", "schema"].join("\0")) {
  throw new Error("M3b worker snapshot manifest has unknown or missing fields");
}
if (
  manifestRecord.schema !== "fenel.compiled-artifact-snapshot.v1"
  || manifestRecord.root !== "."
  || (manifestRecord.artifact !== "compiled-parser" && manifestRecord.artifact !== "compiled-resolver")
  || typeof manifestRecord.contentDigest !== "string"
  || !/^[0-9a-f]{64}$/u.test(manifestRecord.contentDigest)
  || !Array.isArray(manifestRecord.rows)
) {
  throw new Error("M3b worker snapshot manifest has the wrong schema");
}
const manifest = manifestRecord as SnapshotManifest;

const PATH_UTF8 = new TextEncoder();

function compareUtf8(left: string, right: string): number {
  const leftBytes = PATH_UTF8.encode(left);
  const rightBytes = PATH_UTF8.encode(right);
  const bound = Math.min(leftBytes.length, rightBytes.length);
  for (let index = 0; index < bound; index += 1) {
    const difference = leftBytes[index]! - rightBytes[index]!;
    if (difference !== 0) return difference;
  }
  return leftBytes.length - rightBytes.length;
}

function portableSnapshotPath(value: unknown): string {
  if (typeof value !== "string" || value.length === 0 || value !== value.normalize("NFC")) {
    throw new Error(`invalid M3b snapshot path ${JSON.stringify(value)}`);
  }
  if (
    value.includes("\\")
    || value.startsWith("/")
    || /^[A-Za-z]:/u.test(value)
    || /[\u0000-\u001f]/u.test(value)
  ) {
    throw new Error(`invalid M3b snapshot path ${JSON.stringify(value)}`);
  }
  const parts = value.split("/");
  if (parts.some((part) => part === "" || part === "." || part === "..")) {
    throw new Error(`invalid M3b snapshot path ${JSON.stringify(value)}`);
  }
  return value;
}

function assertPlainMaterializedPath(absolute: string): void {
  const rel = relative(snapshotRoot, absolute);
  if (rel === "" || isAbsolute(rel) || rel === ".." || rel.startsWith(`..${sep}`)) {
    throw new Error(`M3b materialized path escapes the snapshot: ${absolute}`);
  }
  let current = snapshotRoot;
  const parts = rel.split(/[\\/]/u);
  for (let index = 0; index < parts.length; index += 1) {
    current = resolve(current, parts[index]!);
    const stat = privilegedLstatSync(current);
    if (stat.isSymbolicLink()) {
      throw new Error(`M3b materialized path contains a link: ${absolute}`);
    }
    if (index === parts.length - 1 ? !stat.isFile() : !stat.isDirectory()) {
      throw new Error(`M3b materialized path is not a plain file: ${absolute}`);
    }
  }
}

const rows = new Map<string, { readonly byteLength: number; readonly digest: string }>();
const contentRows: { readonly path: string; readonly byteLength: number; readonly digest: string }[] = [];
const foldedPaths = new Map<string, string>();
let previousPath: string | undefined;
for (const row of manifest.rows) {
  if (row === null || typeof row !== "object" || Array.isArray(row)) {
    throw new Error("M3b snapshot row must be an object");
  }
  const rowRecord = row as unknown as Record<string, unknown>;
  if (Object.keys(rowRecord).sort().join("\0") !== ["byteLength", "digest", "path"].join("\0")) {
    throw new Error("M3b snapshot row has unknown or missing fields");
  }
  const path = portableSnapshotPath(rowRecord.path);
  const byteLength = rowRecord.byteLength;
  const digest = rowRecord.digest;
  if (!Number.isSafeInteger(byteLength) || (byteLength as number) < 0) {
    throw new Error(`invalid M3b snapshot byte length for ${path}`);
  }
  if (typeof digest !== "string" || !/^[0-9a-f]{64}$/u.test(digest)) {
    throw new Error(`invalid M3b snapshot digest for ${path}`);
  }
  if (previousPath !== undefined && compareUtf8(previousPath, path) >= 0) {
    throw new Error(`M3b snapshot rows are not in unique UTF-8 path order at ${path}`);
  }
  previousPath = path;
  const folded = path.toLowerCase();
  const foldedPrior = foldedPaths.get(folded);
  if (foldedPrior !== undefined) {
    throw new Error(`case-colliding M3b snapshot rows ${foldedPrior} and ${path}`);
  }
  foldedPaths.set(folded, path);
  const absolute = resolve(snapshotRoot, ...path.split("/"));
  const rel = relative(snapshotRoot, absolute);
  if (
    isAbsolute(rel)
    || rel === ".."
    || rel.startsWith(`..${sep}`)
    || rows.has(absolute)
  ) {
    throw new Error(`invalid or duplicate M3b snapshot row ${JSON.stringify(path)}`);
  }
  assertPlainMaterializedPath(absolute);
  rows.set(absolute, { byteLength: byteLength as number, digest });
  contentRows.push({ path, byteLength: byteLength as number, digest });
}
const computedContentDigest = createHash("sha256").update(JSON.stringify([
  "fenel.byte-manifest.v1",
  `snapshot:${manifest.artifact}`,
  contentRows.map((row) => [row.path, "regular-file", row.byteLength, row.digest]),
])).digest("hex");
if (computedContentDigest !== manifest.contentDigest) {
  throw new Error("M3b snapshot content digest does not bind its manifest rows");
}

const WORKER_SOURCE_BUILTINS = new Set([
  "node:crypto",
  "node:util",
]);
// The worker source closure may acquire node:crypto and the exact
// node:util.types.isProxy projection, only through reviewed CommonJS edges. The remaining rows are used solely by
// this privileged preload and may appear in the pinned runtime's detective
// caches; none is source authority for a render worker.
const LOADED_MODULE_BUILTINS = new Set<string>(COMPILED_ARTIFACT_LOADED_MODULE_BUILTINS);
const LOADED_MODULE_CACHE_SOURCES = Object.freeze([
  "Module._cache",
  "require.cache",
  "createRequire(import.meta.url).cache",
] as const);

function canonicalSnapshotAbsolute(path: string): string {
  const absolute = resolve(path);
  for (const base of [snapshotRoot, requestedSnapshotRoot]) {
    const rel = relative(base, absolute);
    if (rel === "" || (!isAbsolute(rel) && rel !== ".." && !rel.startsWith(`..${sep}`))) {
      return resolve(snapshotRoot, rel);
    }
  }
  return absolute;
}

function tracePathLabel(path: string): string {
  let candidate = path;
  if (candidate.startsWith("file:")) {
    try {
      candidate = fileURLToPath(candidate);
    } catch {
      return "<invalid-file-url>";
    }
  }
  if (!isAbsolute(candidate)) return candidate.replaceAll("\\", "/");
  const absolute = canonicalSnapshotAbsolute(candidate);
  const rel = relative(snapshotRoot, absolute);
  if (rel === "") return ".";
  if (!isAbsolute(rel) && rel !== ".." && !rel.startsWith(`..${sep}`)) {
    return rel.replaceAll("\\", "/");
  }
  return "<outside-snapshot>";
}

function traceSpecifierLabel(specifier: string): string {
  const raw = specifier.endsWith("?raw");
  const base = raw ? specifier.slice(0, -4) : specifier;
  const label = base.startsWith("file:") || isAbsolute(base) ? tracePathLabel(base) : base;
  return raw ? `${label}?raw` : label;
}

type LoadedModuleLabel = {
  readonly scope: "builtin" | "outside" | "snapshot";
  readonly value: string;
};

function loadedModuleLabel(cacheKey: string): LoadedModuleLabel {
  if (LOADED_MODULE_BUILTINS.has(cacheKey)) {
    return { scope: "builtin", value: cacheKey };
  }
  let candidate = cacheKey;
  const query = candidate.indexOf("?");
  const fragment = candidate.indexOf("#");
  if (fragment >= 0 || (query >= 0 && candidate.slice(query) !== "?raw")) {
    return { scope: "outside", value: "<redacted>" };
  }
  if (query >= 0) candidate = candidate.slice(0, query);
  if (candidate.startsWith("file:")) {
    try {
      candidate = fileURLToPath(candidate);
    } catch {
      return { scope: "outside", value: "<redacted>" };
    }
  } else if (!isAbsolute(candidate)) {
    return { scope: "outside", value: "<redacted>" };
  }
  const absolute = canonicalSnapshotAbsolute(candidate);
  const rel = relative(snapshotRoot, absolute);
  if (
    rel === ""
    || isAbsolute(rel)
    || rel === ".."
    || rel.startsWith(`..${sep}`)
    || !rows.has(absolute)
  ) {
    return { scope: "outside", value: "<redacted>" };
  }
  return { scope: "snapshot", value: rel.replaceAll("\\", "/") };
}

function moduleCacheKeys(value: unknown): readonly string[] {
  if (value === null || typeof value !== "object") {
    throw new Error("M3b detective module cache is absent or not an object");
  }
  const keys = Reflect.ownKeys(value);
  if (keys.some((key) => typeof key !== "string")) {
    throw new Error("M3b detective module cache contains a symbol key");
  }
  return keys as readonly string[];
}

const preloadCreatedRequire = createRequire(import.meta.url);
const guardedNodeUtil = preloadCreatedRequire("node:util") as Record<PropertyKey, unknown>;
const preloadLexicalRequire = require;
let loadedModulesEmitted = false;
process.once("exit", () => {
  // Worker exit listeners registered after this hook can still trace reads.
  // Flush those events synchronously; the OS closes the private descriptor
  // when the process exits if another listener prevents closing it here.
  traceExiting = true;
  try {
    if (loadedModulesEmitted) throw new Error("M3b loaded-module evidence was emitted twice");
    loadedModulesEmitted = true;
    const moduleConstructorCache = (Module as unknown as { readonly _cache?: unknown })._cache;
    const labelsByIdentity = new Map<string, LoadedModuleLabel>();
    for (const cache of [
      moduleConstructorCache,
      preloadLexicalRequire.cache,
      preloadCreatedRequire.cache,
    ]) {
      for (const key of moduleCacheKeys(cache)) {
        const label = loadedModuleLabel(key);
        labelsByIdentity.set(`${label.scope}\0${label.value}`, label);
      }
    }
    const labels = [...labelsByIdentity.values()].sort((left, right) =>
      compareUtf8(left.scope, right.scope) || compareUtf8(left.value, right.value));
    trace("loaded-modules", {
      mode: "detective",
      cacheSources: LOADED_MODULE_CACHE_SOURCES,
      labels,
    });
  } finally {
    try {
      flushTrace();
    } finally {
      if (privilegedExitListenerCount() === 0) privilegedCloseSync(traceFd);
    }
  }
});

function assertMaterialized(absolute: string): {
  readonly absolute: string;
  readonly byteLength: number;
  readonly digest: string;
} {
  const canonical = canonicalSnapshotAbsolute(absolute);
  const row = rows.get(canonical);
  if (row === undefined) {
    trace("escape-denied", { path: tracePathLabel(absolute) });
    throw new Error(`M3b worker attempted to load an unmaterialized file: ${absolute}`);
  }
  return { absolute: canonical, ...row };
}

function readVerified(absolute: string): Uint8Array {
  const row = assertMaterialized(absolute);
  assertPlainMaterializedPath(row.absolute);
  const bytes = privilegedReadFileSync(row.absolute);
  const digest = createHash("sha256").update(bytes).digest("hex");
  if (bytes.byteLength !== row.byteLength || digest !== row.digest) {
    throw new Error(`M3b materialized byte mismatch: ${row.absolute}`);
  }
  trace("read", { path: relative(snapshotRoot, row.absolute).replaceAll("\\", "/"), digest });
  return bytes;
}

// The preload itself is privileged only after its exact snapshot-owned bytes
// have been bound by the same manifest as the worker closure.
readVerified(fileURLToPath(import.meta.url));

const expectedWorkerRelative = manifest.artifact === "compiled-parser"
  ? "implementations/typescript/engine/scripts/generate-compiled-parser-worker.ts"
  : "implementations/typescript/engine/scripts/generate-compiled-resolver-worker.ts";
const configuredWorkerPath = canonicalSnapshotAbsolute(workerPathValue);
const expectedWorkerPath = resolve(snapshotRoot, ...expectedWorkerRelative.split("/"));
if (configuredWorkerPath !== expectedWorkerPath) {
  throw new Error(`M3b launcher worker path does not name ${expectedWorkerRelative}`);
}
const workerRow = assertMaterialized(configuredWorkerPath);
readVerified(workerRow.absolute);
const bootstrapPath = resolve(snapshotRoot, ".m3b-worker-bootstrap.ts");
readVerified(assertMaterialized(bootstrapPath).absolute);
const workerPathSymbol = Symbol.for("fenel.m3b.worker-path");
if (Object.prototype.hasOwnProperty.call(globalThis, workerPathSymbol)) {
  throw new Error("M3b worker path symbol was already defined");
}
Object.defineProperty(globalThis, workerPathSymbol, {
  configurable: false,
  enumerable: false,
  writable: false,
  value: workerRow.absolute,
});

const privilegedBunFile = Bun.file.bind(Bun);

function resolveMaterializedSpecifier(specifier: string, importer: string): string {
  const unresolved = isAbsolute(specifier) ? resolve(specifier) : resolve(dirname(importer), specifier);
  const candidates = [unresolved];
  const loadExtensions = [".ts", ".tsx", ".js", ".mjs", ".cjs", ".json"] as const;
  // Bun treats suffixes such as `.generated` as part of an extensionless module
  // name and still probes its load extensions (for example,
  // `parse-cache.generated` -> `parse-cache.generated.ts`).  `extname() === ""`
  // does not model that rule and would reject an acquired, materialized row.
  if (!loadExtensions.some((extension) => unresolved.endsWith(extension))) {
    for (const extension of loadExtensions) {
      candidates.push(`${unresolved}${extension}`);
    }
    for (const extension of loadExtensions) {
      candidates.push(resolve(unresolved, `index${extension}`));
    }
  }
  for (const candidate of candidates) {
    const canonical = canonicalSnapshotAbsolute(candidate);
    if (rows.has(canonical)) return canonical;
  }
  return assertMaterialized(unresolved).absolute;
}

// Bun 1.3.x installs preload plugins after parts of the entry graph have
// already been resolved, and built-in/bare dynamic imports may bypass these
// hooks entirely. The acquired, materialized source closure is therefore the
// primary import allowlist. This resolver is a defense-in-depth verifier for
// the runtime file/query edges that Bun does expose to preload plugins.
Bun.plugin({
  name: "fenel-m3b-snapshot-fence",
  setup(builder) {
    builder.onResolve({ filter: /.*/ }, (args) => {
      const specifier = args.path;
      const tracedSpecifier = traceSpecifierLabel(specifier);
      const tracedImporter = tracePathLabel(args.importer);
      if (specifier.startsWith("node:")) {
        if (specifier === "node:util") {
          const importer = args.importer.startsWith("file:") ? fileURLToPath(args.importer) : args.importer;
          const owner = importer.length === 0 ? "" : relative(snapshotRoot, canonicalSnapshotAbsolute(importer)).replaceAll("\\", "/");
          if (owner !== "implementations/typescript/engine/src/engine-bodies-dispatch.ts" || args.kind !== "require-call") {
            trace("builtin-denied", { specifier: tracedSpecifier, importer: tracedImporter });
            throw new Error("M3b worker node:util requires its exact reviewed CommonJS importer");
          }
        }
        if (!WORKER_SOURCE_BUILTINS.has(specifier)) {
          trace("builtin-denied", { specifier: tracedSpecifier, importer: tracedImporter });
          throw new Error(`M3b worker builtin is not declared: ${specifier}`);
        }
        trace("builtin", { specifier: tracedSpecifier, importer: tracedImporter });
        return undefined;
      }
      const raw = specifier.endsWith("?raw");
      const bare = raw ? specifier.slice(0, -4) : specifier;
      if (bare.includes("?") || bare.includes("#")) {
        trace("specifier-denied", { specifier: tracedSpecifier, importer: tracedImporter });
        throw new Error(`M3b worker import query is not declared: ${specifier}`);
      }
      if (
        !bare.startsWith(".")
        && !bare.startsWith("/")
        && !bare.startsWith("file:")
        && !/^[A-Za-z]:[\\/]/.test(bare)
      ) {
        trace("bare-denied", { specifier: tracedSpecifier, importer: tracedImporter });
        throw new Error(`M3b worker bare dependency is not materialized: ${specifier}`);
      }
      const importer = args.importer.length === 0 || args.importer === "bun:main"
        ? snapshotRoot
        : args.importer.startsWith("file:")
        ? fileURLToPath(args.importer)
        : args.importer;
      const resolvedSpecifier = bare.startsWith("file:") ? fileURLToPath(bare) : bare;
      const absolute = resolveMaterializedSpecifier(resolvedSpecifier, importer);
      const materialized = assertMaterialized(absolute);
      trace("resolve", {
        specifier: tracedSpecifier,
        importer: tracedImporter,
        path: relative(snapshotRoot, materialized.absolute).replaceAll("\\", "/"),
      });
      readVerified(materialized.absolute);
      return undefined;
    });
  },
});

const fixedPresent = Object.freeze({
  FENEL_PARSE_CACHE: "0",
  FENEL_PARSER_LEGACY: "1",
  FENEL_PARSER_INTERPRETED: "1",
  FENEL_RESOLVER_INTERPRETED: "1",
  NODE_ENV: "production",
  TZ: "UTC",
  LANG: "C",
  LC_ALL: "C",
  TEMP: resolve(snapshotRoot, ".tmp"),
  TMP: resolve(snapshotRoot, ".tmp"),
  TMPDIR: resolve(snapshotRoot, ".tmp"),
});
const fixedPresentKeys = Object.freeze(Object.keys(fixedPresent).sort());
if (
  fixedPresentKeys.length !== COMPILED_ARTIFACT_FIXED_PRESENT_ENVIRONMENT_KEYS.length
  || fixedPresentKeys.some((key, index) => (
    key !== COMPILED_ARTIFACT_FIXED_PRESENT_ENVIRONMENT_KEYS[index]
  ))
) {
  throw new Error("M3b worker fixed environment rows differ from the shared exact policy");
}
const declaredAbsent = new Set<string>(COMPILED_ARTIFACT_DECLARED_ABSENT_ENVIRONMENT_KEYS);

const mutableEnvironment = launcherEnvironment as Record<string, string | undefined>;
for (const key of Object.keys(mutableEnvironment)) delete mutableEnvironment[key];
if (Object.keys(mutableEnvironment).length !== 0) {
  throw new Error("M3b worker could not scrub the inherited environment");
}
for (const [key, value] of Object.entries(fixedPresent)) mutableEnvironment[key] = value;

function denyEnvironmentMutation(operation: string, property?: PropertyKey): never {
  const key = typeof property === "string" ? property : "<non-string>";
  trace("env-mutation-denied", { operation, key });
  throw new Error(`M3b worker may not mutate the environment (${operation} ${key})`);
}

const missingEnvironmentPrototype = new Proxy(Object.create(null) as Record<string, undefined>, {
  get(_target, property) {
    if (typeof property !== "string") return undefined;
    const declared = declaredAbsent.has(property);
    trace(declared ? "env-absent" : "env-undeclared", { key: property });
    if (!declared) throw new Error(`M3b worker read undeclared environment key ${property}`);
    return undefined;
  },
  set(_target, property) {
    return denyEnvironmentMutation("set", property);
  },
  defineProperty(_target, property) {
    return denyEnvironmentMutation("defineProperty", property);
  },
  deleteProperty(_target, property) {
    return denyEnvironmentMutation("deleteProperty", property);
  },
  setPrototypeOf() {
    return denyEnvironmentMutation("setPrototypeOf");
  },
  preventExtensions() {
    return denyEnvironmentMutation("preventExtensions");
  },
});
Object.setPrototypeOf(mutableEnvironment, missingEnvironmentPrototype);
for (const [key, value] of Object.entries(fixedPresent)) {
  Object.defineProperty(mutableEnvironment, key, {
    configurable: false,
    enumerable: true,
    writable: false,
    value,
  });
}

const environmentProxy = new Proxy(mutableEnvironment, {
  get(target, property, receiver) {
    if (typeof property !== "string") return Reflect.get(target, property, receiver);
    if (Object.hasOwn(fixedPresent, property)) {
      trace("env-present", { key: property });
      return fixedPresent[property as keyof typeof fixedPresent];
    }
    const declared = declaredAbsent.has(property);
    trace(declared ? "env-absent" : "env-undeclared", { key: property });
    if (!declared) throw new Error(`M3b worker read undeclared environment key ${property}`);
    return undefined;
  },
  ownKeys() {
    trace("env-enumeration-denied", {});
    throw new Error("M3b worker may not enumerate the environment");
  },
  set(_target, property) {
    return denyEnvironmentMutation("set", property);
  },
  defineProperty(_target, property) {
    return denyEnvironmentMutation("defineProperty", property);
  },
  deleteProperty(_target, property) {
    return denyEnvironmentMutation("deleteProperty", property);
  },
  setPrototypeOf() {
    return denyEnvironmentMutation("setPrototypeOf");
  },
  preventExtensions() {
    return denyEnvironmentMutation("preventExtensions");
  },
});
const processEnvironmentDescriptor = Object.getOwnPropertyDescriptor(process, "env");
Object.defineProperty(process, "env", {
  configurable: false,
  enumerable: processEnvironmentDescriptor?.enumerable ?? true,
  writable: false,
  value: environmentProxy,
});

function deny(name: string): never {
  trace("capability-denied", { capability: name });
  throw new Error(`M3b worker capability is denied: ${name}`);
}

function denyCallableCapability(
  target: object,
  property: PropertyKey,
  capability: string,
  enumerable?: boolean,
): void {
  const current = Object.getOwnPropertyDescriptor(target, property);
  Object.defineProperty(target, property, {
    configurable: false,
    enumerable: current?.enumerable ?? enumerable ?? false,
    writable: false,
    value: function deniedCapability(): never {
      return deny(capability);
    },
  });
}

function denyReadableCapability(
  target: object,
  property: PropertyKey,
  capability: string,
  enumerable?: boolean,
): void {
  const current = Object.getOwnPropertyDescriptor(target, property);
  Object.defineProperty(target, property, {
    configurable: false,
    enumerable: current?.enumerable ?? enumerable ?? true,
    get: () => deny(capability),
  });
}

// Bun 1.3.13 exposes this loader escape directly on process. A worker could
// otherwise acquire node:fs without an import edge and read ambient bytes.
denyCallableCapability(process, "getBuiltinModule", "process.getBuiltinModule");
denyReadableCapability(process, "platform", "process.platform");
denyReadableCapability(process, "arch", "process.arch");
denyReadableCapability(navigator, "platform", "navigator.platform");
denyReadableCapability(navigator, "arch", "navigator.arch");
const processReport = (process as unknown as { readonly report?: Record<string, unknown> }).report;
if (processReport !== undefined) {
  for (const method of ["getReport", "writeReport"]) {
    if (typeof processReport[method] === "function") {
      denyCallableCapability(processReport, method, `process.report.${method}`);
    }
  }
}

// The static acquisition ledger permits only reviewed, non-render occurrences
// of these host-sensitive surfaces. If generation unexpectedly reaches one,
// the runtime half of the fence fails rather than producing host-bound bytes.
const nativeDate = Date;
denyCallableCapability(nativeDate, "now", "time.Date.now");
const guardedDate = new Proxy(nativeDate, {
  apply(): never {
    return deny("time.Date()");
  },
  construct(target, argumentsList, newTarget) {
    if (argumentsList.length === 0) return deny("time.new-Date");
    return Reflect.construct(target, argumentsList, newTarget);
  },
});
Object.defineProperty(globalThis, "Date", {
  configurable: false,
  writable: false,
  value: guardedDate,
});
denyCallableCapability(Math, "random", "randomness.Math.random");
denyCallableCapability(performance, "now", "time.performance.now");
denyCallableCapability(String.prototype, "localeCompare", "locale.String.localeCompare");
for (const [prototype, methods] of [
  [String.prototype, ["toLocaleLowerCase", "toLocaleUpperCase"]],
  [Number.prototype, ["toLocaleString"]],
  [BigInt.prototype, ["toLocaleString"]],
  [Date.prototype, ["toLocaleDateString", "toLocaleString", "toLocaleTimeString"]],
  [Array.prototype, ["toLocaleString"]],
] as const) {
  for (const method of methods) denyCallableCapability(prototype, method, `locale.${method}`);
}
const nativeIntl = Intl;
Object.defineProperty(globalThis, "Intl", {
  configurable: false,
  writable: false,
  value: new Proxy(nativeIntl, {
    get(): never {
      return deny("locale.Intl");
    },
  }),
});

const guardedNodeCrypto = preloadCreatedRequire("node:crypto") as Record<PropertyKey, unknown>;
const randomNodeCryptoCallables = new Set([
  "getRandomValues", "randomBytes", "randomFill", "randomFillSync", "randomInt", "randomUUID",
]);
const guardedWebCryptos = new WeakSet<object>();
const guardedWebCryptoPrototypes = new WeakSet<object>();
const guardedSubtleCryptos = new WeakSet<object>();
const guardedSubtleCryptoPrototypes = new WeakSet<object>();
function guardWebCrypto(
  webCrypto: Record<string, unknown> | undefined,
  surface: string,
): void {
  if (webCrypto === undefined || guardedWebCryptos.has(webCrypto)) return;
  guardedWebCryptos.add(webCrypto);
  const webCryptoPrototype = Object.getPrototypeOf(webCrypto) as Record<string, unknown> | null;
  for (const method of ["getRandomValues", "randomUUID"]) {
    if (
      webCryptoPrototype !== null
      && !guardedWebCryptoPrototypes.has(webCryptoPrototype)
      && typeof webCryptoPrototype[method] === "function"
    ) {
      denyCallableCapability(webCryptoPrototype, method, `randomness.${surface}.${method}`);
    }
    if (method in webCrypto) denyCallableCapability(webCrypto, method, `randomness.${surface}.${method}`);
  }
  if (webCryptoPrototype !== null) guardedWebCryptoPrototypes.add(webCryptoPrototype);
  const subtle = webCrypto["subtle"];
  if (subtle !== null && typeof subtle === "object" && !guardedSubtleCryptos.has(subtle)) {
    guardedSubtleCryptos.add(subtle);
    const subtlePrototype = Object.getPrototypeOf(subtle) as Record<string, unknown> | null;
    const methods = subtlePrototype === null ? [] : Reflect.ownKeys(subtlePrototype);
    for (const method of methods) {
      if (typeof method === "string" && method !== "constructor" && typeof (subtle as Record<string, unknown>)[method] === "function") {
        if (!guardedSubtleCryptoPrototypes.has(subtlePrototype!)) {
          denyCallableCapability(subtlePrototype!, method, `host.${surface}.subtle.${method}`);
        }
        denyCallableCapability(subtle, method, `host.${surface}.subtle.${method}`);
      }
    }
    if (subtlePrototype !== null) guardedSubtleCryptoPrototypes.add(subtlePrototype);
  }
}
guardWebCrypto(globalThis.crypto as unknown as Record<string, unknown> | undefined, "crypto");
const nodeWebCryptoDescriptor = Object.getOwnPropertyDescriptor(guardedNodeCrypto, "webcrypto");
const nodeSubtleDescriptor = Object.getOwnPropertyDescriptor(guardedNodeCrypto, "subtle");
guardWebCrypto(
  nodeWebCryptoDescriptor !== undefined
    && "value" in nodeWebCryptoDescriptor
    && nodeWebCryptoDescriptor.value !== null
    && typeof nodeWebCryptoDescriptor.value === "object"
    ? nodeWebCryptoDescriptor.value as Record<string, unknown>
    : undefined,
  "node:crypto.webcrypto",
);
guardWebCrypto({
  subtle: nodeSubtleDescriptor !== undefined && "value" in nodeSubtleDescriptor
    ? nodeSubtleDescriptor.value
    : undefined,
}, "node:crypto");

let foundCreateHash = false;
let foundPinnedFips = false;
for (const key of Reflect.ownKeys(guardedNodeCrypto)) {
  const descriptor = Object.getOwnPropertyDescriptor(guardedNodeCrypto, key);
  if (descriptor === undefined) {
    throw new Error(`M3b worker could not inspect node:crypto export ${String(key)}`);
  }
  if (key === "createHash") {
    if (!("value" in descriptor) || typeof descriptor.value !== "function") {
      throw new Error("M3b worker node:crypto.createHash export is not a callable data property");
    }
    Object.defineProperty(guardedNodeCrypto, key, {
      configurable: false,
      enumerable: descriptor.enumerable,
      writable: false,
      value: descriptor.value,
    });
    foundCreateHash = true;
    continue;
  }
  if (key === "fips" && !descriptor.configurable) {
    // Bun 1.3.13 exposes fips as a non-configurable accessor, so it cannot be
    // replaced with a denied getter. This preload is not authority for that
    // residual surface: the source-acquisition fence admits only exact
    // createHash declarations. Still, bind the pinned runtime shape and value
    // here so an upgraded or FIPS-enabled runtime fails closed rather than
    // silently widening the worker's ambient observations.
    if (
      descriptor.enumerable
      || "value" in descriptor
      || typeof descriptor.get !== "function"
      || typeof descriptor.set !== "function"
      || Reflect.get(guardedNodeCrypto, key) !== 0
    ) {
      throw new Error("M3b worker cannot seal the unexpected node:crypto.fips surface");
    }
    foundPinnedFips = true;
    continue;
  }
  if (!descriptor.configurable) {
    throw new Error(`M3b worker cannot seal non-configurable node:crypto export ${String(key)}`);
  }
  const capabilityKey = typeof key === "string" ? key : String(key);
  const capability = `${
    typeof key === "string" && randomNodeCryptoCallables.has(key)
      ? "randomness.crypto"
      : "host.crypto"
  }.${capabilityKey}`;
  if ("value" in descriptor && typeof descriptor.value === "function") {
    denyCallableCapability(guardedNodeCrypto, key, capability, descriptor.enumerable);
  } else {
    denyReadableCapability(guardedNodeCrypto, key, capability, descriptor.enumerable);
  }
}
if (!foundCreateHash || !foundPinnedFips) {
  throw new Error("M3b worker node:crypto export surface does not match the pinned runtime");
}

// The source acquisition fence admits only one exact types.isProxy read from
// engine-bodies-dispatch.ts. Bun builtin require can bypass resolver hooks, so
// seal the actual cached module and its separately reachable types namespace.
const utilTypesDescriptor = Object.getOwnPropertyDescriptor(guardedNodeUtil, "types");
if (utilTypesDescriptor === undefined || !("value" in utilTypesDescriptor)
  || utilTypesDescriptor.value === null || typeof utilTypesDescriptor.value !== "object") {
  throw new Error("M3b worker node:util.types is not a data namespace");
}
const originalUtilTypes = utilTypesDescriptor.value as Record<PropertyKey, unknown>;
const isProxyDescriptor = Object.getOwnPropertyDescriptor(originalUtilTypes, "isProxy");
if (isProxyDescriptor === undefined || !("value" in isProxyDescriptor) || typeof isProxyDescriptor.value !== "function") {
  throw new Error("M3b worker node:util.types.isProxy is not a callable data property");
}
const nativeIsProxy = isProxyDescriptor.value;
const utilTypesTarget = Object.freeze(Object.defineProperty(Object.create(null) as object, "isProxy", {
  configurable: false, enumerable: true, writable: false, value: nativeIsProxy,
}));
const utilTypesFacade = new Proxy(utilTypesTarget, {
  get(_target, key) {
    if (key === "isProxy") return nativeIsProxy;
    return deny(`host.util.types.${String(key)}`);
  },
});
for (const key of Reflect.ownKeys(originalUtilTypes)) {
  const descriptor = Object.getOwnPropertyDescriptor(originalUtilTypes, key);
  if (descriptor === undefined || !descriptor.configurable) {
    throw new Error(`M3b worker cannot seal node:util/types export ${String(key)}`);
  }
  // Including isProxy: direct util/types aliases are not the admitted route.
  denyReadableCapability(originalUtilTypes, key, `host.util/types.${String(key)}`, descriptor.enumerable);
}
Object.freeze(originalUtilTypes);
for (const key of Reflect.ownKeys(guardedNodeUtil)) {
  const descriptor = Object.getOwnPropertyDescriptor(guardedNodeUtil, key);
  if (descriptor === undefined || !descriptor.configurable) {
    throw new Error(`M3b worker cannot seal node:util export ${String(key)}`);
  }
  if (key === "types") {
    Object.defineProperty(guardedNodeUtil, key, {
      configurable: false, enumerable: descriptor.enumerable, writable: false, value: utilTypesFacade,
    });
  } else {
    denyReadableCapability(guardedNodeUtil, key, `host.util.${String(key)}`, descriptor.enumerable);
  }
}
Object.freeze(guardedNodeUtil);

// Module._load is a different entry point from Bun's lowered require. Never
// create a util acquisition through it, including bare and subpath aliases.
const moduleLoadDescriptor = Object.getOwnPropertyDescriptor(Module, "_load");
if (moduleLoadDescriptor === undefined || !("value" in moduleLoadDescriptor) || typeof moduleLoadDescriptor.value !== "function") {
  throw new Error("M3b worker Module._load is not a callable data property");
}
const originalModuleLoad = moduleLoadDescriptor.value;
Object.defineProperty(Module, "_load", {
  configurable: false, enumerable: moduleLoadDescriptor.enumerable, writable: false,
  value: function guardedModuleLoad(this: unknown, ...arguments_: unknown[]): unknown {
    const request = arguments_[0];
    if (typeof request === "string" && (request === "util" || request === "node:util"
      || request.startsWith("util/") || request.startsWith("node:util/"))) {
      return deny("host.util.Module._load");
    }
    return Reflect.apply(originalModuleLoad, this, arguments_);
  },
});
// One acquisition witness; the native predicate itself is never wrapped or
// traced per call. Its source/module slots are locked above.
trace("builtin", { specifier: "node:util", importer: tracePathLabel(fileURLToPath(import.meta.url)) });


const guardedNodeFs = preloadCreatedRequire("node:fs") as Record<string, unknown>;
// Bun lazily constructs stdout/stderr through node:fs. Materialize those two
// inherited framing streams before the worker-visible fs constructors are denied.
void process.stdout;
void process.stderr;
for (const key of Reflect.ownKeys(guardedNodeFs)) {
  if (typeof key === "string" && typeof guardedNodeFs[key] === "function") {
    denyCallableCapability(guardedNodeFs, key, `filesystem.node:fs.${key}`);
  }
}
const guardedNodeFsPromises = preloadCreatedRequire("node:fs/promises") as Record<string, unknown>;
for (const key of Reflect.ownKeys(guardedNodeFsPromises)) {
  if (typeof key === "string" && typeof guardedNodeFsPromises[key] === "function") {
    denyCallableCapability(guardedNodeFsPromises, key, `filesystem.node:fs/promises.${key}`);
  }
}
const guardedBuffer = preloadCreatedRequire("node:buffer") as {
  readonly Buffer?: Record<string, unknown>;
};
if (guardedBuffer.Buffer !== undefined) {
  for (const method of ["allocUnsafe", "allocUnsafeSlow"]) {
    if (typeof guardedBuffer.Buffer[method] === "function") {
      denyCallableCapability(guardedBuffer.Buffer, method, `randomness.Buffer.${method}`);
    }
  }
}

Object.defineProperty(globalThis, "fetch", {
  configurable: false,
  writable: false,
  value: () => deny("network.fetch"),
});
// Deny the Worker read itself. `new Worker(new URL(..., import.meta.url))`
// otherwise evaluates the URL arguments before a denied constructor runs.
// The async registry asset may be in the owned source closure, but compiled
// rendering must never enter that host scheduling path or observe its URL.
if ("Worker" in globalThis) denyReadableCapability(globalThis, "Worker", "network.Worker");
for (const name of ["WebSocket"] as const) {
  if (name in globalThis) {
    Object.defineProperty(globalThis, name, {
      configurable: false,
      writable: false,
      value: function deniedConstructor(): never {
        return deny(`network.${name}`);
      },
    });
  }
}

const guardedBun = Bun as typeof Bun & Record<string, unknown>;
Object.defineProperty(guardedBun, "file", {
  configurable: false,
  writable: false,
  value: ((path: Parameters<typeof Bun.file>[0], ...rest: readonly unknown[]) => {
    // Bun's process.stdout/process.stderr WriteStream lazily calls Bun.file on
    // the two inherited output descriptors. Preserve only that internal
    // framing path; all pathname access and stdin/other descriptors fail.
    if (path === 1 || path === 2) {
      return Reflect.apply(privilegedBunFile, Bun, [path, ...rest]);
    }
    return deny("Bun.file");
  }) as typeof Bun.file,
});
for (const name of ["write", "spawn", "spawnSync", "dlopen", "resolve", "resolveSync", "randomUUIDv7"] as const) {
  Object.defineProperty(guardedBun, name, {
    configurable: false,
    writable: false,
    value: () => deny(`Bun.${name}`),
  });
}
Object.defineProperty(process, "dlopen", {
  configurable: false,
  writable: false,
  value: () => deny("process.dlopen"),
});
Object.defineProperty(process, "chdir", {
  configurable: false,
  writable: false,
  value: () => deny("process.chdir"),
});

trace("preload-ready", {
  snapshotRoot: ".",
  manifestRows: rows.size,
  resolverCoverage: "partial-runtime-hooks",
  primaryImportFence: "acquired-materialized-source-closure",
  fixedPresent: COMPILED_ARTIFACT_FIXED_PRESENT_ENVIRONMENT_KEYS,
  declaredAbsent: COMPILED_ARTIFACT_DECLARED_ABSENT_ENVIRONMENT_KEYS,
});
