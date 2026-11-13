/** Immutable, marker-owned materialization and render-worker launcher for M3b. */

import { randomBytes } from "node:crypto";
import { decodePreparationPacket, type PreparationObservationPacket } from "./compiled-artifact-preparation-protocol";
import { captureWorkerDiagnostics } from "./compiled-artifact-worker-progress";
import { decodePreparationContractObservation, type PreparationContractObservation } from "./compiled-artifact-producer-observation";
import {
  closeSync,
  existsSync,
  lstatSync,
  mkdirSync,
  openSync,
  readFileSync,
  readdirSync,
  realpathSync,
  rmSync,
  writeSync,
} from "node:fs";
import { dirname, isAbsolute, relative, resolve, sep } from "node:path";
import type {
  CapturedByteStore,
  CompiledArtifactId,
  RepositoryRelativePath,
  Sha256Hex,
} from "./artifact-bytes";
import {
  compareUtf8Paths,
  digestByteManifest,
  repositoryRelativePath,
  sha256Raw,
} from "./artifact-bytes";
import { encodeCanonicalJson, parseCanonicalJson } from "./artifact-wire-json";
import {
  assertExactLfArtifact,
  compiledArtifactRecoveryStubs,
} from "./compiled-artifact-certificate";
import {
  COMPILED_ARTIFACT_DECLARED_ABSENT_ENVIRONMENT_KEYS,
  COMPILED_ARTIFACT_FIXED_PRESENT_ENVIRONMENT_KEYS,
  COMPILED_ARTIFACT_LOADED_MODULE_BUILTINS,
} from "./compiled-artifact-worker-policy";

export const SNAPSHOT_SCHEMA = "fenel.compiled-artifact-snapshot.v1" as const;
export const SNAPSHOT_OWNER_SCHEMA = "fenel.compiled-artifact-snapshot-owner.v1" as const;
export const SNAPSHOT_MANIFEST_PATH = ".m3b-snapshot-manifest.json" as const;
export const SNAPSHOT_OWNER_PATH = ".m3b-snapshot-owner.json" as const;
export const SNAPSHOT_TRACE_PATH = ".m3b-worker-trace.jsonl" as const;
export const SNAPSHOT_TEMP_PATH = ".tmp" as const;
export const SNAPSHOT_LOADED_MODULE_CACHE_SOURCES = Object.freeze([
  "Module._cache",
  "require.cache",
  "createRequire(import.meta.url).cache",
] as const);
export const SNAPSHOT_LOADED_MODULE_BUILTINS = COMPILED_ARTIFACT_LOADED_MODULE_BUILTINS;
export const SNAPSHOT_BOOTSTRAP_PATH = repositoryRelativePath(
  ".m3b-worker-bootstrap.ts",
);

const SNAPSHOT_ROOT_PATH = ".tmp-m3b-snapshots" as const;
const PRELOAD_PATH =
  "implementations/typescript/engine/scripts/lib/compiled-artifact-worker-preload.ts" as const;
const WORKER_PATHS: Readonly<Record<CompiledArtifactId, RepositoryRelativePath>> = Object.freeze({
  "compiled-parser": repositoryRelativePath(
    "implementations/typescript/engine/scripts/generate-compiled-parser-worker.ts",
  ),
  "compiled-resolver": repositoryRelativePath(
    "implementations/typescript/engine/scripts/generate-compiled-resolver-worker.ts",
  ),
});

export type SnapshotManifestRow = {
  readonly path: RepositoryRelativePath;
  readonly byteLength: number;
  readonly digest: Sha256Hex;
};

export type CompiledArtifactSnapshotManifest = {
  readonly schema: typeof SNAPSHOT_SCHEMA;
  readonly root: ".";
  readonly artifact: CompiledArtifactId;
  readonly rows: readonly SnapshotManifestRow[];
  readonly contentDigest: Sha256Hex;
};

export type SnapshotOwnerMarker = {
  readonly schema: typeof SNAPSHOT_OWNER_SCHEMA;
  readonly pid: number;
  readonly nonce: string;
};

export interface MaterializedCompiledArtifactSnapshot {
  readonly operation?: "render" | "prepare" | "prepare-contract";
  readonly artifact: CompiledArtifactId;
  readonly root: string;
  readonly workerPath: string;
  readonly entryPath: string;
  readonly preloadPath: string;
  readonly tracePath: string;
  readonly manifest: CompiledArtifactSnapshotManifest;
  readonly markerBytes: Uint8Array;
  cleanup(): void;
}

export interface MaterializeSnapshotInput {
  readonly operation?: "render" | "prepare" | "prepare-contract";
  readonly repositoryRoot: string;
  readonly artifact: CompiledArtifactId;
  readonly capturedBytes: CapturedByteStore;
  /** Exact source rows selected from the stable capture. Defaults to its full union. */
  readonly sourcePaths?: readonly RepositoryRelativePath[];
  /** Optional canonical dependency rows already dereferenced by acquisition. */
  readonly dependencyFiles?: readonly {
    readonly path: RepositoryRelativePath;
    readonly bytes: Uint8Array;
  }[];
  readonly nonce?: string;
}

export interface SnapshotWorkerResult {
  readonly artifact: CompiledArtifactId;
  readonly bytes: Uint8Array;
  readonly stdout: Uint8Array;
  readonly stderr: Uint8Array;
  readonly traceBytes: Uint8Array;
  readonly elapsedMs: number;
}

export function compiledArtifactSnapshotBootstrap(input: {
  readonly operation?: "render" | "prepare" | "prepare-contract";
  readonly artifact: CompiledArtifactId;
}): { readonly path: RepositoryRelativePath; readonly bytes: Uint8Array; readonly digest: Sha256Hex } {
  const exportName = input.operation === "prepare-contract"
    ? input.artifact === "compiled-parser" ? "runCompiledParserPreparationContractWorkerMain" : "runCompiledResolverPreparationContractWorkerMain"
    : input.operation === "prepare"
      ? input.artifact === "compiled-parser" ? "runCompiledParserPreparationWorkerMain" : "runCompiledResolverPreparationWorkerMain"
    : input.artifact === "compiled-parser" ? "runCompiledParserWorkerMain" : "runCompiledResolverWorkerMain";
  const text = `// Generated immutable M3b bootstrap; the preload binds the computed worker path.\n`
    + `const key = Symbol.for("fenel.m3b.worker-path");\n`
    + (input.operation === "prepare" || input.operation === "prepare-contract"
      ? `const slot = Object.getOwnPropertyDescriptor(globalThis, key);\n`
        + `if (slot === undefined || !("value" in slot) || typeof slot.value !== "string" || slot.configurable !== false || slot.writable !== false) throw new Error("M3b preparation requires the immutable preload binding");\n`
      : "")
    + `const target = (globalThis as unknown as Record<symbol, unknown>)[key];\n`
    + `if (typeof target !== "string") throw new Error("M3b preload did not bind the worker path");\n`
    + `const loaded = await import(target);\n`
    + `const main = (loaded as Record<string, unknown>)[${JSON.stringify(exportName)}];\n`
    + `if (typeof main !== "function") throw new Error("M3b worker lacks its declared main export");\n`
    + `await main();\n`;
  const bytes = new TextEncoder().encode(text);
  return Object.freeze({ path: SNAPSHOT_BOOTSTRAP_PATH, bytes, digest: sha256Raw(bytes) });
}

export type SnapshotWorkerSpawn = (input: {
  readonly command: readonly string[];
  readonly cwd: string;
  readonly env: Readonly<Record<string, string>>;
}) => Promise<{
  readonly exitCode: number;
  readonly stdout: Uint8Array;
  readonly stderr: Uint8Array;
}>;

function assertNonce(nonce: string): string {
  if (!/^[0-9a-f]{16,128}$/u.test(nonce)) {
    throw new Error("snapshot nonce must be 16..128 lowercase hexadecimal characters");
  }
  return nonce;
}

function assertInside(parent: string, target: string, allowParent = false): string {
  const base = resolve(parent);
  const absolute = resolve(target);
  const rel = relative(base, absolute);
  if (rel === "" || rel === ".") {
    if (allowParent) return absolute;
    throw new Error(`snapshot target must be below its owner root: ${target}`);
  }
  if (isAbsolute(rel) || rel === ".." || rel.startsWith(`..${sep}`)) {
    throw new Error(`snapshot target escapes its owner root: ${target}`);
  }
  return absolute;
}

function assertNoLinkAncestors(parent: string, target: string): void {
  const base = resolve(parent);
  const absolute = assertInside(base, target, true);
  const rel = relative(base, absolute);
  let current = base;
  const baseStat = lstatSync(base);
  if (!baseStat.isDirectory() || baseStat.isSymbolicLink()) {
    throw new Error(`snapshot owner root is not a plain directory: ${base}`);
  }
  if (rel === "" || rel === ".") return;
  for (const part of rel.split(/[\\/]/u)) {
    current = resolve(current, part);
    if (!existsSync(current)) break;
    const stat = lstatSync(current);
    if (stat.isSymbolicLink()) throw new Error(`snapshot path contains a link: ${current}`);
  }
}

function writeAll(fd: number, bytes: Uint8Array): void {
  let offset = 0;
  while (offset < bytes.byteLength) {
    const written = writeSync(fd, bytes, offset, bytes.byteLength - offset);
    if (written <= 0) throw new Error("short snapshot write");
    offset += written;
  }
}

function writeExclusive(path: string, bytes: Uint8Array): void {
  mkdirSync(dirname(path), { recursive: true, mode: 0o700 });
  const fd = openSync(path, "wx", 0o600);
  try {
    writeAll(fd, bytes);
    // This marker-owned snapshot is disposable. Complete writes and the
    // pre/post-worker byte checks establish evidence; crash durability does
    // not. Durable artifact/certificate publication uses its own writer.
  } finally {
    closeSync(fd);
  }
}

function manifestRows(
  rows: readonly { readonly path: RepositoryRelativePath; readonly bytes: Uint8Array }[],
): readonly SnapshotManifestRow[] {
  const exact = new Set<string>();
  const folded = new Map<string, string>();
  return Object.freeze(rows.map(({ path, bytes }) => {
    const canonical = repositoryRelativePath(path);
    if (exact.has(canonical)) throw new Error(`duplicate snapshot path ${canonical}`);
    const caseKey = canonical.normalize("NFC").toLowerCase();
    const prior = folded.get(caseKey);
    if (prior !== undefined && prior !== canonical) {
      throw new Error(`case-colliding snapshot paths ${prior} and ${canonical}`);
    }
    exact.add(canonical);
    folded.set(caseKey, canonical);
    return Object.freeze({
      path: canonical,
      byteLength: bytes.byteLength,
      digest: sha256Raw(bytes),
    });
  }).sort((left, right) => compareUtf8Paths(left.path, right.path)));
}

function buildManifest(
  artifact: CompiledArtifactId,
  rows: readonly SnapshotManifestRow[],
): CompiledArtifactSnapshotManifest {
  const summary = digestByteManifest(
    `snapshot:${artifact}`,
    rows.map((row) => ({
      path: row.path,
      kind: "regular-file" as const,
      byteLength: row.byteLength,
      sha256: row.digest,
    })),
  );
  return Object.freeze({
    schema: SNAPSHOT_SCHEMA,
    root: "." as const,
    artifact,
    rows,
    contentDigest: summary.digest,
  });
}

function markerBytes(nonce: string): Uint8Array {
  return encodeCanonicalJson({
    schema: SNAPSHOT_OWNER_SCHEMA,
    nonce,
    pid: process.pid,
  });
}

function validateOwnedSnapshotRoot(cacheRoot: string, root: string, marker: Uint8Array): void {
  const absolute = assertInside(cacheRoot, root);
  assertNoLinkAncestors(cacheRoot, absolute);
  const stat = lstatSync(absolute);
  if (!stat.isDirectory() || stat.isSymbolicLink()) {
    throw new Error("snapshot root is not a plain directory");
  }
  const observedMarker = readFileSync(resolve(absolute, SNAPSHOT_OWNER_PATH));
  if (!observedMarker.equals(Buffer.from(marker))) {
    throw new Error("snapshot owner marker mismatch; refusing cleanup");
  }
}

export function materializeCompiledArtifactSnapshot(
  input: MaterializeSnapshotInput,
): MaterializedCompiledArtifactSnapshot {
  const repositoryRoot = resolve(input.repositoryRoot);
  const cacheRoot = resolve(repositoryRoot, SNAPSHOT_ROOT_PATH);
  mkdirSync(cacheRoot, { recursive: true, mode: 0o700 });
  assertNoLinkAncestors(repositoryRoot, cacheRoot);
  const nonce = assertNonce(input.nonce ?? randomBytes(16).toString("hex"));
  const root = resolve(cacheRoot, `${process.pid}-${nonce}`);
  assertInside(cacheRoot, root);
  mkdirSync(root, { recursive: false, mode: 0o700 });
  const ownerBytes = markerBytes(nonce);
  let owned = true;
  try {
    writeExclusive(resolve(root, SNAPSHOT_OWNER_PATH), ownerBytes);
    mkdirSync(resolve(root, SNAPSHOT_TEMP_PATH), { recursive: false, mode: 0o700 });

    const materialized = new Map<RepositoryRelativePath, Uint8Array>();
    for (const path of input.sourcePaths ?? input.capturedBytes.paths) {
      if (!input.capturedBytes.has(path)) {
        throw new Error(`snapshot source path is absent from the stable capture: ${path}`);
      }
      materialized.set(path, input.capturedBytes.read(path));
    }
    for (const dependency of input.dependencyFiles ?? []) {
      const path = repositoryRelativePath(dependency.path);
      if (materialized.has(path)) throw new Error(`dependency path collides with source: ${path}`);
      materialized.set(path, new Uint8Array(dependency.bytes));
    }
    for (const stub of compiledArtifactRecoveryStubs()) {
      const path = repositoryRelativePath(stub.path);
      if (materialized.has(path)) {
        throw new Error(`recovery stub path was unexpectedly captured: ${path}`);
      }
      materialized.set(path, new Uint8Array(stub.bytes));
    }
    const bootstrap = compiledArtifactSnapshotBootstrap({ artifact: input.artifact, operation: input.operation });
    if (materialized.has(bootstrap.path)) {
      throw new Error(`snapshot bootstrap path was unexpectedly captured: ${bootstrap.path}`);
    }
    materialized.set(bootstrap.path, new Uint8Array(bootstrap.bytes));
    if (!materialized.has(repositoryRelativePath(PRELOAD_PATH))) {
      throw new Error("snapshot capture is missing the preload guard");
    }
    const workerRelative = WORKER_PATHS[input.artifact];
    if (!materialized.has(workerRelative)) {
      throw new Error(`snapshot capture is missing ${input.artifact} worker`);
    }

    const sourceRows = [...materialized.entries()].map(([path, bytes]) => ({ path, bytes }));
    const rows = manifestRows(sourceRows);
    for (const { path, bytes } of sourceRows) {
      const target = resolve(root, ...path.split("/"));
      assertInside(root, target);
      writeExclusive(target, bytes);
    }
    const manifest = buildManifest(input.artifact, rows);
    writeExclusive(resolve(root, SNAPSHOT_MANIFEST_PATH), encodeCanonicalJson(manifest));

    const snapshot: MaterializedCompiledArtifactSnapshot = Object.freeze({
      operation: input.operation ?? "render",
      artifact: input.artifact,
      root,
      workerPath: resolve(root, ...workerRelative.split("/")),
      entryPath: resolve(root, ...SNAPSHOT_BOOTSTRAP_PATH.split("/")),
      preloadPath: resolve(root, ...PRELOAD_PATH.split("/")),
      tracePath: resolve(root, SNAPSHOT_TRACE_PATH),
      manifest,
      markerBytes: new Uint8Array(ownerBytes),
      cleanup(): void {
        if (!owned) return;
        validateOwnedSnapshotRoot(cacheRoot, root, ownerBytes);
        rmSync(root, { recursive: true, force: false });
        owned = false;
      },
    });
    assertCompiledArtifactSnapshot(snapshot);
    return snapshot;
  } catch (error) {
    if (owned && existsSync(root)) {
      try {
        validateOwnedSnapshotRoot(cacheRoot, root, ownerBytes);
        rmSync(root, { recursive: true, force: false });
        owned = false;
      } catch (cleanupError) {
        throw new AggregateError([error, cleanupError], "snapshot creation and owned cleanup failed");
      }
    }
    throw error;
  }
}

export function assertCompiledArtifactSnapshot(
  snapshot: MaterializedCompiledArtifactSnapshot,
): void {
  const root = resolve(snapshot.root);
  for (const row of snapshot.manifest.rows) {
    const target = assertInside(root, resolve(root, ...row.path.split("/")));
    const stat = lstatSync(target);
    if (!stat.isFile() || stat.isSymbolicLink()) {
      throw new Error(`snapshot row is not one regular file: ${row.path}`);
    }
    const bytes = readFileSync(target);
    if (bytes.byteLength !== row.byteLength || sha256Raw(bytes) !== row.digest) {
      throw new Error(`snapshot row differs from manifest: ${row.path}`);
    }
  }
  const rawManifest = readFileSync(resolve(root, SNAPSHOT_MANIFEST_PATH));
  const decoded = parseCanonicalJson(rawManifest) as Record<string, unknown>;
  if (
    decoded.schema !== SNAPSHOT_SCHEMA
    || decoded.artifact !== snapshot.artifact
    || decoded.contentDigest !== snapshot.manifest.contentDigest
  ) {
    throw new Error("snapshot manifest reread differs from intended identity");
  }
}

function decodeWorkerRecord(
  artifact: CompiledArtifactId,
  stdout: Uint8Array,
): Uint8Array {
  let text: string;
  try {
    text = new TextDecoder("utf-8", { fatal: true }).decode(stdout);
  } catch (error) {
    throw new Error(`${artifact} worker stdout is not UTF-8`, { cause: error });
  }
  if (!text.endsWith("\n") || text.slice(0, -1).includes("\n") || text.includes("\r")) {
    throw new Error(`${artifact} worker must emit exactly one LF-terminated stdout record`);
  }
  let record: unknown;
  try {
    record = JSON.parse(text);
  } catch (error) {
    throw new Error(`${artifact} worker stdout is not JSON`, { cause: error });
  }
  if (record === null || typeof record !== "object" || Array.isArray(record)) {
    throw new Error(`${artifact} worker stdout root is not an object`);
  }
  const value = record as Record<string, unknown>;
  const keys = Object.keys(value).sort();
  if (keys.join("\0") !== ["artifact", "bytesBase64", "schema"].join("\0")) {
    throw new Error(`${artifact} worker stdout has unknown or missing fields`);
  }
  if (value.schema !== "fenel.compiled-artifact-render.v1" || value.artifact !== artifact) {
    throw new Error(`${artifact} worker stdout has the wrong schema or artifact id`);
  }
  if (typeof value.bytesBase64 !== "string" || !/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/u.test(value.bytesBase64)) {
    throw new Error(`${artifact} worker stdout has invalid base64 bytes`);
  }
  const bytes = new Uint8Array(Buffer.from(value.bytesBase64, "base64"));
  if (Buffer.from(bytes).toString("base64") !== value.bytesBase64) {
    throw new Error(`${artifact} worker stdout base64 is not canonical`);
  }
  assertExactLfArtifact(bytes);
  return bytes;
}

async function defaultSpawn(input: {
  readonly command: readonly string[];
  readonly cwd: string;
  readonly env: Readonly<Record<string, string>>;
}): Promise<{ readonly exitCode: number; readonly stdout: Uint8Array; readonly stderr: Uint8Array }> {
  const child = Bun.spawn([...input.command], {
    cwd: input.cwd,
    env: { ...input.env },
    stdin: "ignore",
    stdout: "pipe",
    stderr: "pipe",
  });
  const [exitCode, stdout, stderr] = await Promise.all([
    child.exited,
    new Response(child.stdout).bytes(),
    captureWorkerDiagnostics(child.stderr),
  ]);
  return { exitCode, stdout, stderr };
}

export async function runCompiledArtifactSnapshotWorker(input: {
  readonly snapshot: MaterializedCompiledArtifactSnapshot;
  readonly bunExecutable: string;
  readonly spawn?: SnapshotWorkerSpawn;
}): Promise<SnapshotWorkerResult> {
  if (input.snapshot.operation !== undefined && input.snapshot.operation !== "render") throw new Error("render launcher cannot consume an observation snapshot");
  assertCompiledArtifactSnapshot(input.snapshot);
  if (!isAbsolute(input.bunExecutable)) {
    throw new Error("snapshot worker requires an absolute pinned Bun executable");
  }
  if (existsSync(input.snapshot.tracePath)) {
    throw new Error("snapshot worker trace already exists; snapshots are single-use");
  }
  const before = performance.now();
  const launched = await (input.spawn ?? defaultSpawn)({
    command: Object.freeze([
      resolve(input.bunExecutable),
      "--no-env-file",
      "--no-install",
      "--cwd",
      input.snapshot.root,
      "--preload",
      input.snapshot.preloadPath,
      input.snapshot.entryPath,
    ]),
    cwd: input.snapshot.root,
    env: Object.freeze({
      FENEL_M3B_SNAPSHOT_ROOT: input.snapshot.root,
      FENEL_M3B_TRACE_PATH: input.snapshot.tracePath,
      FENEL_M3B_WORKER_PATH: input.snapshot.workerPath,
    }),
  });
  const elapsedMs = performance.now() - before;
  const traceBytes = existsSync(input.snapshot.tracePath)
    ? new Uint8Array(readFileSync(input.snapshot.tracePath))
    : new Uint8Array();
  if (launched.exitCode !== 0) {
    throw new Error(
      `${input.snapshot.artifact} snapshot worker exited ${launched.exitCode}: ${new TextDecoder().decode(launched.stderr)}`,
    );
  }
  const bytes = decodeWorkerRecord(input.snapshot.artifact, launched.stdout);
  assertCompiledArtifactSnapshot(input.snapshot);
  validateSnapshotTrace(input.snapshot, traceBytes);
  return Object.freeze({
    artifact: input.snapshot.artifact,
    bytes,
    stdout: new Uint8Array(launched.stdout),
    stderr: new Uint8Array(launched.stderr),
    traceBytes,
    elapsedMs,
  });
}

export interface SnapshotPreparationWorkerResult {
  readonly artifact: CompiledArtifactId;
  readonly observation: PreparationObservationPacket;
  readonly stdout: Uint8Array;
  readonly stderr: Uint8Array;
  readonly traceBytes: Uint8Array;
  readonly elapsedMs: number;
}

export async function runCompiledArtifactSnapshotPreparationWorker(input: {
  readonly snapshot: MaterializedCompiledArtifactSnapshot;
  readonly bunExecutable: string;
  readonly spawn?: SnapshotWorkerSpawn;
}): Promise<SnapshotPreparationWorkerResult> {
  if (input.snapshot.operation !== "prepare") throw new Error("preparation launcher requires a preparation snapshot");
  assertCompiledArtifactSnapshot(input.snapshot);
  if (!isAbsolute(input.bunExecutable)) {
    throw new Error("snapshot worker requires an absolute pinned Bun executable");
  }
  if (existsSync(input.snapshot.tracePath)) {
    throw new Error("snapshot worker trace already exists; snapshots are single-use");
  }
  const before = performance.now();
  const launched = await (input.spawn ?? defaultSpawn)({
    command: Object.freeze([
      resolve(input.bunExecutable),
      "--no-env-file",
      "--no-install",
      "--cwd",
      input.snapshot.root,
      "--preload",
      input.snapshot.preloadPath,
      input.snapshot.entryPath,
    ]),
    cwd: input.snapshot.root,
    env: Object.freeze({
      FENEL_M3B_SNAPSHOT_ROOT: input.snapshot.root,
      FENEL_M3B_TRACE_PATH: input.snapshot.tracePath,
      FENEL_M3B_WORKER_PATH: input.snapshot.workerPath,
    }),
  });
  const elapsedMs = performance.now() - before;
  const traceBytes = existsSync(input.snapshot.tracePath)
    ? new Uint8Array(readFileSync(input.snapshot.tracePath))
    : new Uint8Array();
  if (launched.exitCode !== 0) {
    throw new Error(
      `${input.snapshot.artifact} snapshot worker exited ${launched.exitCode}: ${new TextDecoder().decode(launched.stderr)}`,
    );
  }
  const observation = decodePreparationPacket(launched.stdout);
  if (observation.artifact !== input.snapshot.artifact) throw new Error("preparation observation names another artifact");
  assertCompiledArtifactSnapshot(input.snapshot);
  validateSnapshotTrace(input.snapshot, traceBytes);
  return Object.freeze({
    artifact: input.snapshot.artifact,
    observation,
    stdout: new Uint8Array(launched.stdout),
    stderr: new Uint8Array(launched.stderr),
    traceBytes,
    elapsedMs,
  });
}

/** Diagnostic-only launcher. It deliberately cannot return artifact bytes or
 * an owner freshness record. All immutable snapshot/trace checks remain the
 * same as full rendering; the selected worker stops before compilation.
 */
export async function runCompiledArtifactSnapshotPreparationContractWorker(input: {
  readonly snapshot: MaterializedCompiledArtifactSnapshot;
  readonly bunExecutable: string;
  readonly spawn?: SnapshotWorkerSpawn;
}): Promise<Readonly<{
  artifact: CompiledArtifactId; observation: PreparationContractObservation;
  stdout: Uint8Array; stderr: Uint8Array; traceBytes: Uint8Array; elapsedMs: number;
}>> {
  if (input.snapshot.operation !== "prepare-contract") throw new Error("contract checkpoint requires its exact observation snapshot");
  assertCompiledArtifactSnapshot(input.snapshot);
  if (!isAbsolute(input.bunExecutable)) throw new Error("snapshot worker requires an absolute pinned Bun executable");
  if (existsSync(input.snapshot.tracePath)) throw new Error("snapshot worker trace already exists; snapshots are single-use");
  const before = performance.now();
  const launched = await (input.spawn ?? defaultSpawn)({
    command: Object.freeze([resolve(input.bunExecutable), "--no-env-file", "--no-install", "--cwd",
      input.snapshot.root, "--preload", input.snapshot.preloadPath, input.snapshot.entryPath]),
    cwd: input.snapshot.root,
    env: Object.freeze({ FENEL_M3B_SNAPSHOT_ROOT: input.snapshot.root,
      FENEL_M3B_TRACE_PATH: input.snapshot.tracePath, FENEL_M3B_WORKER_PATH: input.snapshot.workerPath }),
  });
  const elapsedMs = performance.now() - before;
  const traceBytes = existsSync(input.snapshot.tracePath) ? new Uint8Array(readFileSync(input.snapshot.tracePath)) : new Uint8Array();
  if (launched.exitCode !== 0) throw new Error(`${input.snapshot.artifact} contract checkpoint exited ${launched.exitCode}: ${new TextDecoder().decode(launched.stderr)}`);
  const observation = decodePreparationContractObservation(launched.stdout);
  if (observation.artifact !== input.snapshot.artifact || observation.contract !== "entity-envelope") throw new Error("preparation checkpoint names another owner/contract");
  assertCompiledArtifactSnapshot(input.snapshot);
  validateSnapshotTrace(input.snapshot, traceBytes);
  return Object.freeze({ artifact: input.snapshot.artifact, observation,
    stdout: new Uint8Array(launched.stdout), stderr: new Uint8Array(launched.stderr), traceBytes, elapsedMs });
}

export function validateSnapshotTrace(
  snapshot: MaterializedCompiledArtifactSnapshot,
  traceBytes: Uint8Array,
): void {
  const tracePath = resolve(snapshot.tracePath);
  if (tracePath !== resolve(snapshot.root, SNAPSHOT_TRACE_PATH)) {
    throw new Error("snapshot trace path is not the controller-owned trace file");
  }
  assertNoLinkAncestors(snapshot.root, tracePath);
  const traceStat = lstatSync(tracePath);
  if (!traceStat.isFile() || traceStat.isSymbolicLink()) {
    throw new Error("snapshot trace is not one plain file");
  }
  const observedTraceBytes = readFileSync(tracePath);
  if (!observedTraceBytes.equals(Buffer.from(traceBytes))) {
    throw new Error("snapshot trace bytes differ from the controller-read trace");
  }

  let text: string;
  try {
    text = new TextDecoder("utf-8", { fatal: true }).decode(traceBytes);
  } catch (error) {
    throw new Error("snapshot trace is not UTF-8", { cause: error });
  }
  if (!text.endsWith("\n") || text.includes("\r")) {
    throw new Error("snapshot trace must be LF-terminated JSONL");
  }
  const policy = snapshotTracePolicy(snapshot);
  const allowed = new Set([
    "builtin",
    "env-absent",
    "env-present",
    "load",
    "loaded-modules",
    "preload-ready",
    "read",
    "resolve",
  ]);
  let preloadReady = 0;
  let loadedModules = 0;
  let loadedModulesIndex = -1;
  const lines = text.slice(0, -1).split("\n");
  for (const [index, line] of lines.entries()) {
    if (line.length === 0) throw new Error(`snapshot trace line ${index + 1} is empty`);
    let record: unknown;
    try {
      record = JSON.parse(line);
    } catch (error) {
      throw new Error(`snapshot trace line ${index + 1} is not JSON`, { cause: error });
    }
    if (record === null || typeof record !== "object" || Array.isArray(record)) {
      throw new Error(`snapshot trace line ${index + 1} is not an object`);
    }
    const value = record as Record<string, unknown>;
    if (JSON.stringify(value) !== line) {
      throw new Error(`snapshot trace line ${index + 1} is not minimally encoded JSON`);
    }
    const kind = value.kind;
    if (typeof kind !== "string" || !allowed.has(kind)) {
      throw new Error(`snapshot trace contains denied or unknown event ${String(kind)}`);
    }
    switch (kind) {
      case "builtin":
        assertExactTraceKeys(value, ["importer", "kind", "specifier"], index);
        assertAllowedLoadedBuiltin(value.specifier, `trace line ${index + 1} builtin`);
        assertTraceImporter(policy, value.importer, index);
        break;
      case "env-absent":
      case "env-present":
        assertExactTraceKeys(value, ["key", "kind"], index);
        assertTraceString(value.key, `snapshot trace line ${index + 1} environment key`);
        break;
      case "load":
      case "read": {
        assertExactTraceKeys(value, ["digest", "kind", "path"], index);
        const digest = assertTraceDigest(value.digest, index);
        assertManifestTraceObservation(policy, value.path, digest, `${kind} event`);
        break;
      }
      case "resolve":
        assertExactTraceKeys(value, ["importer", "kind", "path", "specifier"], index);
        assertSafeTraceSpecifier(value.specifier, index);
        assertTraceImporter(policy, value.importer, index);
        assertManifestTraceObservation(policy, value.path, undefined, "resolve event");
        break;
      case "preload-ready":
        assertPreloadReadyTrace(value, snapshot, index);
        preloadReady += 1;
        break;
      case "loaded-modules":
        assertLoadedModulesTrace(value, policy, index);
        loadedModules += 1;
        loadedModulesIndex = index;
        break;
    }
  }
  if (preloadReady !== 1) throw new Error("snapshot trace must contain exactly one preload-ready event");
  if (loadedModules !== 1) {
    throw new Error("snapshot trace must contain exactly one loaded-modules event");
  }
  if (loadedModulesIndex !== lines.length - 1) {
    throw new Error("snapshot loaded-modules witness must be the final trace event");
  }

  assertRecursiveSnapshotLayout(snapshot);
}

type SnapshotTracePolicy = {
  readonly snapshot: MaterializedCompiledArtifactSnapshot;
  readonly root: string;
  readonly rowsByRealPath: ReadonlyMap<string, SnapshotManifestRow>;
};

const LOADED_MODULE_BUILTIN_SET = new Set<string>(SNAPSHOT_LOADED_MODULE_BUILTINS);
const TRACE_UTF8 = new TextEncoder();

function compareTraceUtf8(left: string, right: string): number {
  const leftBytes = TRACE_UTF8.encode(left);
  const rightBytes = TRACE_UTF8.encode(right);
  const bound = Math.min(leftBytes.byteLength, rightBytes.byteLength);
  for (let index = 0; index < bound; index += 1) {
    const difference = leftBytes[index]! - rightBytes[index]!;
    if (difference !== 0) return difference;
  }
  return leftBytes.byteLength - rightBytes.byteLength;
}

function comparableRealPath(path: string): string {
  let canonical = realpathSync.native(path).normalize("NFC");
  if (process.platform === "win32") {
    canonical = canonical
      .replace(/^\\\\\?\\UNC\\/iu, "\\\\")
      .replace(/^\\\\\?\\/u, "")
      .toLowerCase();
  }
  return canonical;
}

function snapshotTracePolicy(snapshot: MaterializedCompiledArtifactSnapshot): SnapshotTracePolicy {
  const root = resolve(snapshot.root);
  const rowsByRealPath = new Map<string, SnapshotManifestRow>();
  for (const row of snapshot.manifest.rows) {
    const target = assertInside(root, resolve(root, ...row.path.split("/")));
    assertNoLinkAncestors(root, target);
    const key = comparableRealPath(target);
    const prior = rowsByRealPath.get(key);
    if (prior !== undefined && prior.path !== row.path) {
      throw new Error(`snapshot manifest rows alias the same real path: ${prior.path} and ${row.path}`);
    }
    rowsByRealPath.set(key, row);
  }
  return Object.freeze({ snapshot, root, rowsByRealPath });
}

function assertExactTraceKeys(
  record: Readonly<Record<string, unknown>>,
  expected: readonly string[],
  index: number,
): void {
  const actual = Object.keys(record).sort();
  const wanted = [...expected].sort();
  if (actual.join("\0") !== wanted.join("\0")) {
    throw new Error(`snapshot trace line ${index + 1} has unknown or missing fields`);
  }
}

function assertTraceString(value: unknown, context: string): string {
  if (
    typeof value !== "string"
    || value.length === 0
    || value !== value.normalize("NFC")
    || /[\u0000-\u001f\u007f]/u.test(value)
  ) {
    throw new Error(`${context} is not a canonical non-empty string`);
  }
  return value;
}

function assertTraceDigest(value: unknown, index: number): Sha256Hex {
  if (typeof value !== "string" || !/^[0-9a-f]{64}$/u.test(value)) {
    throw new Error(`snapshot trace line ${index + 1} has an invalid digest`);
  }
  return value as Sha256Hex;
}

function normalizedManifestTracePath(value: unknown, context: string): string {
  const original = assertTraceString(value, context);
  if (original.includes("#")) throw new Error(`${context} contains a denied fragment`);
  const query = original.indexOf("?");
  const path = query === -1
    ? original
    : query === original.length - "?raw".length && original.endsWith("?raw")
    ? original.slice(0, -"?raw".length)
    : (() => { throw new Error(`${context} contains a denied query`); })();
  if (
    path.includes("\\")
    || path.startsWith("/")
    || /^[A-Za-z]:/u.test(path)
    || /^[A-Za-z][A-Za-z0-9+.-]*:/u.test(path)
  ) {
    throw new Error(`${context} is not a snapshot-relative file reference`);
  }
  const parts = path.split("/");
  if (parts.some((part) => part === "" || part === "." || part === "..")) {
    throw new Error(`${context} is not a portable snapshot path`);
  }
  return path;
}

function assertManifestTraceObservation(
  policy: SnapshotTracePolicy,
  value: unknown,
  observedDigest: Sha256Hex | undefined,
  context: string,
): SnapshotManifestRow {
  const path = normalizedManifestTracePath(value, `snapshot ${context} path`);
  const target = assertInside(policy.root, resolve(policy.root, ...path.split("/")));
  assertNoLinkAncestors(policy.root, target);
  let stat;
  try {
    stat = lstatSync(target);
  } catch (error) {
    throw new Error(`snapshot ${context} names a missing manifest row: ${path}`, { cause: error });
  }
  if (!stat.isFile() || stat.isSymbolicLink()) {
    throw new Error(`snapshot ${context} does not name one plain manifest file: ${path}`);
  }
  const row = policy.rowsByRealPath.get(comparableRealPath(target));
  if (row === undefined) {
    throw new Error(`snapshot ${context} is not a materialized manifest row: ${path}`);
  }
  const bytes = readFileSync(target);
  const digest = sha256Raw(bytes);
  if (bytes.byteLength !== row.byteLength || digest !== row.digest) {
    throw new Error(`snapshot loaded module differs from manifest: ${row.path}`);
  }
  if (observedDigest !== undefined && observedDigest !== row.digest) {
    throw new Error(`snapshot ${context} digest differs from manifest: ${row.path}`);
  }
  return row;
}

function assertAllowedLoadedBuiltin(value: unknown, context: string): string {
  const specifier = assertTraceString(value, context);
  if (!LOADED_MODULE_BUILTIN_SET.has(specifier)) {
    throw new Error(`${context} is not an approved snapshot builtin: ${specifier}`);
  }
  return specifier;
}

function assertTraceImporter(
  policy: SnapshotTracePolicy,
  value: unknown,
  index: number,
): void {
  if (value === "" || value === ".") return;
  if (typeof value === "string" && LOADED_MODULE_BUILTIN_SET.has(value)) return;
  assertManifestTraceObservation(policy, value, undefined, `line ${index + 1} importer`);
}

function assertSafeTraceSpecifier(value: unknown, index: number): void {
  const specifier = assertTraceString(value, `snapshot trace line ${index + 1} specifier`);
  if (LOADED_MODULE_BUILTIN_SET.has(specifier)) return;
  if (
    specifier.startsWith("<")
    || /^(?:data|blob|https?|ftp|bun):/iu.test(specifier)
  ) {
    throw new Error(`snapshot trace line ${index + 1} contains a denied specifier`);
  }
}

function assertPreloadReadyTrace(
  record: Readonly<Record<string, unknown>>,
  snapshot: MaterializedCompiledArtifactSnapshot,
  index: number,
): void {
  assertExactTraceKeys(record, [
    "declaredAbsent",
    "fixedPresent",
    "kind",
    "manifestRows",
    "primaryImportFence",
    "resolverCoverage",
    "snapshotRoot",
  ], index);
  if (
    record.snapshotRoot !== "."
    || record.manifestRows !== snapshot.manifest.rows.length
    || record.resolverCoverage !== "partial-runtime-hooks"
    || record.primaryImportFence !== "acquired-materialized-source-closure"
  ) {
    throw new Error("snapshot preload-ready event does not describe the immutable snapshot fence");
  }
  for (const [key, expected] of [
    ["fixedPresent", COMPILED_ARTIFACT_FIXED_PRESENT_ENVIRONMENT_KEYS],
    ["declaredAbsent", COMPILED_ARTIFACT_DECLARED_ABSENT_ENVIRONMENT_KEYS],
  ] as const) {
    const values = record[key];
    if (
      !Array.isArray(values)
      || values.length !== expected.length
      || values.some((value, valueIndex) => value !== expected[valueIndex])
    ) {
      throw new Error(`snapshot preload-ready ${key} differs from the exact worker policy`);
    }
  }
}

function assertLoadedModulesTrace(
  record: Readonly<Record<string, unknown>>,
  policy: SnapshotTracePolicy,
  index: number,
): void {
  assertExactTraceKeys(record, ["cacheSources", "kind", "labels", "mode"], index);
  if (record.mode !== "detective") {
    throw new Error("snapshot loaded-modules event must identify detective evidence");
  }
  if (
    !Array.isArray(record.cacheSources)
    || record.cacheSources.length !== SNAPSHOT_LOADED_MODULE_CACHE_SOURCES.length
    || record.cacheSources.some((source, sourceIndex) => (
      source !== SNAPSHOT_LOADED_MODULE_CACHE_SOURCES[sourceIndex]
    ))
  ) {
    throw new Error("snapshot loaded-modules event has the wrong cache-source union");
  }
  if (!Array.isArray(record.labels)) {
    throw new Error("snapshot loaded-modules labels must be an array");
  }
  let previous: string | undefined;
  for (const [labelIndex, label] of record.labels.entries()) {
    if (label === null || typeof label !== "object" || Array.isArray(label)) {
      throw new Error(`snapshot loaded-modules label ${labelIndex + 1} is not an object`);
    }
    const labelRecord = label as Record<string, unknown>;
    const keys = Object.keys(labelRecord).sort();
    if (keys.join("\0") !== ["scope", "value"].join("\0")) {
      throw new Error(`snapshot loaded-modules label ${labelIndex + 1} has unknown or missing fields`);
    }
    const scope = labelRecord.scope;
    const value = assertTraceString(
      labelRecord.value,
      `snapshot loaded-modules label ${labelIndex + 1}`,
    );
    if (scope !== "builtin" && scope !== "snapshot" && scope !== "outside") {
      throw new Error(`snapshot loaded-modules label ${labelIndex + 1} has an unknown scope`);
    }
    const sortKey = `${scope}\0${value}`;
    if (previous !== undefined && compareTraceUtf8(previous, sortKey) >= 0) {
      throw new Error("snapshot loaded-modules labels are not in unique UTF-8 order");
    }
    previous = sortKey;
    if (scope === "outside") {
      throw new Error("snapshot loaded-modules witness contains an outside module");
    }
    if (scope === "builtin") {
      assertAllowedLoadedBuiltin(value, `snapshot loaded-modules label ${labelIndex + 1}`);
    } else {
      assertManifestTraceObservation(policy, value, undefined, "loaded-modules witness");
    }
  }
}

function assertRecursiveSnapshotLayout(snapshot: MaterializedCompiledArtifactSnapshot): void {
  const root = resolve(snapshot.root);
  const manifestFiles = new Set<string>(snapshot.manifest.rows.map((row) => row.path));
  const manifestDirectories = new Set<string>();
  for (const path of manifestFiles) {
    const parts = path.split("/");
    for (let end = 1; end < parts.length; end += 1) {
      manifestDirectories.add(parts.slice(0, end).join("/"));
    }
  }
  const controllerFiles = new Set<string>([
    SNAPSHOT_OWNER_PATH,
    SNAPSHOT_MANIFEST_PATH,
    SNAPSHOT_TRACE_PATH,
  ]);

  const walk = (directory: string, prefix: string, isTemporary: boolean): void => {
    for (const name of readdirSync(directory)) {
      const target = resolve(directory, name);
      const path = prefix.length === 0 ? name : `${prefix}/${name}`;
      const stat = lstatSync(target);
      if (stat.isSymbolicLink()) {
        throw new Error(`snapshot recursive layout contains a link: ${path}`);
      }
      if (isTemporary || path === SNAPSHOT_TEMP_PATH) {
        if (stat.isDirectory()) walk(target, path, true);
        else if (!stat.isFile()) {
          throw new Error(`snapshot temporary layout contains a non-file entry: ${path}`);
        }
        continue;
      }
      if (controllerFiles.has(path) || manifestFiles.has(path)) {
        if (!stat.isFile()) throw new Error(`snapshot expected one plain file at ${path}`);
        continue;
      }
      if (manifestDirectories.has(path)) {
        if (!stat.isDirectory()) throw new Error(`snapshot expected one plain directory at ${path}`);
        walk(target, path, false);
        continue;
      }
      throw new Error(`snapshot acquired an unmanifested recursive entry: ${path}`);
    }
  };

  walk(root, "", false);
}
