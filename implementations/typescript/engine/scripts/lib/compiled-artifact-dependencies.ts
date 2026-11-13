/** Portable, import-inert dependency acquisition for compiled-artifact workers. */

import { randomBytes } from "node:crypto";
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

import {
  decodeStrictJson,
  sha256Hex,
  ToolchainEvidenceError,
  SUPPORTED_PACKAGE_MANAGER,
} from "./compiled-artifact-toolchain";

export const COMPILED_ARTIFACT_DEPENDENCY_SCHEMA =
  "fenel.compiled-artifact-dependencies.v1" as const;
export const COMPILED_ARTIFACT_IMPORTER =
  "implementations/typescript/engine" as const;
export const SUPPORTED_BUN_LOCKFILE_VERSION = 1 as const;

export type DependencyEvidenceErrorCode =
  | "cold-resolution-failed"
  | "concurrent-source-mutation"
  | "dependency-manifest-mismatch"
  | "invalid-package-manifest"
  | "invalid-lockfile"
  | "nonempty-dependency-closure"
  | "toolchain-integrity"
  | "unsafe-cold-workspace";

export class DependencyEvidenceError extends Error {
  readonly code: DependencyEvidenceErrorCode;

  constructor(code: DependencyEvidenceErrorCode, message: string, options?: ErrorOptions) {
    super(message, options);
    this.name = "DependencyEvidenceError";
    this.code = code;
  }
}

function fail(
  code: DependencyEvidenceErrorCode,
  message: string,
  cause?: unknown,
): never {
  throw new DependencyEvidenceError(
    code,
    message,
    cause === undefined ? undefined : { cause },
  );
}

function decodeUtf8(bytes: Uint8Array, context: string): string {
  try {
    return new TextDecoder("utf-8", { fatal: true }).decode(bytes);
  } catch (error) {
    fail("invalid-lockfile", `${context}: invalid UTF-8`, error);
  }
}

function readPackageManifest(bytes: Uint8Array): Record<string, unknown> {
  let value: unknown;
  try {
    // The shared decoder rejects duplicate object names; JSON.parse does not.
    value = decodeStrictJson(bytes, "compiled owner package.json");
  } catch (error) {
    if (error instanceof ToolchainEvidenceError) {
      fail("invalid-package-manifest", error.message, error);
    }
    throw error;
  }
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    fail("invalid-package-manifest", "package.json: root must be an object");
  }
  return value as Record<string, unknown>;
}

const MAP_DEPENDENCY_FIELDS = [
  "dependencies",
  "devDependencies",
  "optionalDependencies",
  "peerDependencies",
  "peerDependenciesMeta",
  "overrides",
  "resolutions",
  "imports",
  "patchedDependencies",
] as const;
const LIST_DEPENDENCY_FIELDS = [
  "bundledDependencies",
  "bundleDependencies",
  "workspaces",
  "trustedDependencies",
] as const;

function assertEmptyObjectField(
  manifest: Record<string, unknown>,
  field: (typeof MAP_DEPENDENCY_FIELDS)[number] | "pnpm",
): void {
  const value = manifest[field];
  if (value === undefined) return;
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    fail("invalid-package-manifest", `package.json.${field}: expected an object`);
  }
  if (Object.keys(value as Record<string, unknown>).length !== 0) {
    fail(
      "nonempty-dependency-closure",
      `package.json.${field}: package edges or resolution policy require acquired-closure support`,
    );
  }
}

function assertNoPackageEdges(manifest: Record<string, unknown>): void {
  if (manifest.name !== "@fenel/engine") {
    fail("invalid-package-manifest", "package.json: expected the @fenel/engine package");
  }
  if (manifest.version !== undefined && typeof manifest.version !== "string") {
    fail("invalid-package-manifest", "package.json.version: expected a string");
  }
  for (const field of MAP_DEPENDENCY_FIELDS) assertEmptyObjectField(manifest, field);
  assertEmptyObjectField(manifest, "pnpm");
  for (const field of LIST_DEPENDENCY_FIELDS) {
    const value = manifest[field];
    if (value === undefined) continue;
    if (!Array.isArray(value)) {
      fail("invalid-package-manifest", `package.json.${field}: expected an array`);
    }
    if (value.length !== 0) {
      fail(
        "nonempty-dependency-closure",
        `package.json.${field}: package edges require acquired-closure support`,
      );
    }
  }
}

interface LockImporterEvidence {
  readonly lockfileVersion: typeof SUPPORTED_BUN_LOCKFILE_VERSION;
  readonly importer: typeof COMPILED_ARTIFACT_IMPORTER;
}

/** Remove JSONC comments/trailing commas, then use the duplicate-key rejecting decoder. */
export function decodeBunLock(bytes: Uint8Array): Record<string, unknown> {
  const source = decodeUtf8(bytes, "bun.lock");
  if (source.startsWith("\ufeff") || source.includes("\0")) {
    fail("invalid-lockfile", "bun.lock: BOM and NUL are forbidden");
  }
  let json = "";
  let inString = false;
  for (let index = 0; index < source.length; index += 1) {
    const character = source[index]!;
    if (inString) {
      json += character;
      if (character === "\\") {
        if (++index < source.length) json += source[index]!;
      } else if (character === '"') inString = false;
    } else if (character === '"') {
      inString = true;
      json += character;
    } else if (character === "/" && source[index + 1] === "/") {
      while (index + 1 < source.length && source[index + 1] !== "\n") index += 1;
      json += " ";
    } else if (character === "/" && source[index + 1] === "*") {
      const end = source.indexOf("*/", index + 2);
      if (end < 0) fail("invalid-lockfile", "bun.lock: unclosed comment");
      index = end + 1;
      json += " ";
    } else {
      json += character;
    }
  }
  let strict = "";
  inString = false;
  for (let index = 0; index < json.length; index += 1) {
    const character = json[index]!;
    if (inString) {
      strict += character;
      if (character === "\\") {
        if (++index < json.length) strict += json[index]!;
      } else if (character === '"') inString = false;
    } else if (character === '"') {
      inString = true;
      strict += character;
    } else if (character === "," && /^[ \t\r\n]*[}\]]/u.test(json.slice(index + 1))) {
      // Bun's text lockfile writer emits trailing commas in objects and arrays.
    } else {
      strict += character;
    }
  }
  try {
    return lockObject(decodeStrictJson(strict, "bun.lock"), "root");
  } catch (error) {
    if (error instanceof DependencyEvidenceError) throw error;
    fail("invalid-lockfile", "bun.lock: invalid or duplicate JSONC structure", error);
  }
}

function lockObject(value: unknown, label: string): Record<string, unknown> {
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    fail("invalid-lockfile", `bun.lock: ${label} must be an object`);
  }
  return value as Record<string, unknown>;
}

/** Fail closed on importer fields or workspace resolutions that can introduce an edge. */
function proveEmptyLockImporter(
  bytes: Uint8Array,
  packageManifest?: Record<string, unknown>,
): LockImporterEvidence {
  const lock = decodeBunLock(bytes);
  if (lock.lockfileVersion !== SUPPORTED_BUN_LOCKFILE_VERSION || lock.configVersion !== 1) {
    fail("invalid-lockfile", "bun.lock: expected lockfileVersion 1 and configVersion 1");
  }
  const acceptedRootFields = new Set([
    "lockfileVersion", "configVersion", "workspaces", "packages", "overrides",
    "trustedDependencies", "patchedDependencies",
  ]);
  for (const field of Object.keys(lock)) {
    if (!acceptedRootFields.has(field)) fail("invalid-lockfile", `bun.lock: unsupported ${field}`);
  }
  const workspaces = lockObject(lock.workspaces, "workspaces");
  const importer = lockObject(workspaces[COMPILED_ARTIFACT_IMPORTER], "engine workspace");
  if (importer.name !== "@fenel/engine") {
    fail("invalid-lockfile", "bun.lock: engine workspace has the wrong package identity");
  }
  if (packageManifest !== undefined && importer.version !== undefined
      && importer.version !== packageManifest.version) {
    fail("invalid-lockfile", "bun.lock: engine workspace version differs from package.json");
  }
  for (const [field, value] of Object.entries(importer)) {
    if (field === "name") continue;
    if (field === "version" && typeof value === "string") continue;
    if ((MAP_DEPENDENCY_FIELDS as readonly string[]).includes(field)) {
      if (Object.keys(lockObject(value, `engine workspace.${field}`)).length === 0) continue;
      fail("nonempty-dependency-closure", `bun.lock: engine workspace.${field} adds package edges`);
    }
    fail("nonempty-dependency-closure", `bun.lock: unsupported engine workspace.${field}`);
  }
  for (const [path, value] of Object.entries(workspaces)) {
    if (path !== COMPILED_ARTIFACT_IMPORTER && lockObject(value, `workspace ${path}`).name === "@fenel/engine") {
      fail("invalid-lockfile", "bun.lock: duplicate engine workspace identity");
    }
  }
  const packages = lockObject(lock.packages, "packages");
  const engine = packages["@fenel/engine"];
  if (!Array.isArray(engine) || engine.length !== 1
      || engine[0] !== `@fenel/engine@workspace:${COMPILED_ARTIFACT_IMPORTER}`) {
    fail("invalid-lockfile", "bun.lock: engine package must resolve to its exact workspace");
  }
  return Object.freeze({
    lockfileVersion: SUPPORTED_BUN_LOCKFILE_VERSION,
    importer: COMPILED_ARTIFACT_IMPORTER,
  });
}

export const EMPTY_COMPILED_ARTIFACT_DEPENDENCY_MANIFEST = `${JSON.stringify({
  schema: COMPILED_ARTIFACT_DEPENDENCY_SCHEMA,
  importer: COMPILED_ARTIFACT_IMPORTER,
  packages: [],
  files: [],
  virtualResolutionMap: [],
})}\n`;

export interface EmptyCompiledArtifactDependencyProof {
  readonly schema: typeof COMPILED_ARTIFACT_DEPENDENCY_SCHEMA;
  readonly importer: typeof COMPILED_ARTIFACT_IMPORTER;
  readonly lockfileVersion: typeof SUPPORTED_BUN_LOCKFILE_VERSION;
  readonly packageJsonSha256: string;
  readonly bunLockSha256: string;
  readonly packageCount: 0;
  readonly fileCount: 0;
  readonly canonicalManifest: string;
  readonly dependencyDigest: string;
}

/** Mechanically prove the repository's current zero-package closure. */
export function proveEmptyCompiledArtifactDependencies(input: {
  readonly packageJsonBytes: Uint8Array;
  readonly bunLockBytes: Uint8Array;
}): EmptyCompiledArtifactDependencyProof {
  const manifest = readPackageManifest(input.packageJsonBytes);
  assertNoPackageEdges(manifest);
  const lock = proveEmptyLockImporter(input.bunLockBytes, manifest);
  const dependencyDigest = sha256Hex(
    new TextEncoder().encode(
      `fenel-compiled-artifact-dependency-digest-v1\0${EMPTY_COMPILED_ARTIFACT_DEPENDENCY_MANIFEST}`,
    ),
  );
  return Object.freeze({
    schema: COMPILED_ARTIFACT_DEPENDENCY_SCHEMA,
    importer: lock.importer,
    lockfileVersion: lock.lockfileVersion,
    packageJsonSha256: sha256Hex(input.packageJsonBytes),
    bunLockSha256: sha256Hex(input.bunLockBytes),
    packageCount: 0,
    fileCount: 0,
    canonicalManifest: EMPTY_COMPILED_ARTIFACT_DEPENDENCY_MANIFEST,
    dependencyDigest,
  });
}

const COLD_SNAPSHOT_ROOT = ".tmp-m3b-snapshots" as const;
const COLD_OWNER_MARKER = ".fenel-bun-cold-owner" as const;
const COLD_OWNER_SCHEMA = "fenel.bun-cold-owner.v1" as const;
const ROOT_WORKSPACE_PATTERNS = Object.freeze([
  "implementations/typescript/*",
  "distros/narthex/*",
]);
const ENGINE_PACKAGE_PATH = "implementations/typescript/engine/package.json" as const;
const ENGINE_OWNER_MARKER = ".fenel-bun-cold-engine" as const;
export interface ColdBunCommandPaths {
  readonly root: string;
  readonly workspace: string;
  readonly cache: string;
  readonly modules: string;
  readonly enginePackage: string;
  readonly lockfile: string;
  readonly bunExecutable: string;
}

export interface ColdBunCommandRequest {
  readonly argv: readonly string[];
  readonly cwd: string;
  readonly env: Readonly<Record<string, string>>;
  readonly paths: ColdBunCommandPaths;
}

export interface ColdBunCommandResult {
  readonly exitCode: number;
  readonly stdout: string;
  readonly stderr: string;
}

export interface ColdBunVerificationDependencies {
  readonly nonce?: () => string;
  readonly runBun?: (request: ColdBunCommandRequest) => Promise<ColdBunCommandResult>;
  /** Test seam after immutable input snapshot A and before Bun starts. */
  readonly afterSourceCapture?: (request: ColdBunCommandRequest) => void | Promise<void>;
  /** Test seam after Bun exits and before snapshot B/output validation. */
  readonly afterBun?: (request: ColdBunCommandRequest) => void | Promise<void>;
  /** Test seam between the two complete validated output captures. */
  readonly betweenOutputCaptures?: (request: ColdBunCommandRequest) => void | Promise<void>;
}

export interface ColdEmptyCompiledArtifactDependencyProof
  extends EmptyCompiledArtifactDependencyProof {
  readonly coldResolution: "verified";
  readonly observedCanonicalManifest: string;
  readonly sourceCaptureDigest: string;
  readonly bunExecutableSha256: string;
}

export interface ColdEmptyCompiledArtifactDependencyInput {
  readonly repositoryRoot: string;
  readonly bunExecutable: string;
  readonly bunExecutableSha256: string;
  readonly rootPackageJsonBytes: Uint8Array;
  readonly packageJsonBytes: Uint8Array;
  readonly bunLockBytes: Uint8Array;
  readonly expectedDependencyManifestBytes: Uint8Array;
}

interface GuardedFile {
  readonly label: string;
  readonly path: string;
  readonly bytes: Uint8Array;
}

interface ScannedTree {
  readonly directories: readonly string[];
  readonly files: readonly string[];
  readonly fileRows: readonly {
    readonly path: string;
    readonly byteLength: number;
    readonly digest: string;
  }[];
}

interface ColdOutputCapture {
  readonly digest: string;
  readonly observedCanonicalManifest: string;
}

function equalBytes(left: Uint8Array, right: Uint8Array): boolean {
  return left.byteLength === right.byteLength
    && left.every((value, index) => value === right[index]);
}

function coldInside(parent: string, target: string, allowEqual = false): string {
  const base = resolve(parent);
  const absolute = resolve(target);
  const rel = relative(base, absolute);
  if (rel === "" || rel === ".") {
    if (allowEqual) return absolute;
    fail("unsafe-cold-workspace", "cold dependency target must be below its owned root");
  }
  if (isAbsolute(rel) || rel === ".." || rel.startsWith(`..${sep}`)) {
    fail("unsafe-cold-workspace", "cold dependency target escapes its owned root");
  }
  return absolute;
}

function assertPlainDirectory(path: string, label: string): void {
  let stat;
  try {
    stat = lstatSync(path);
  } catch (error) {
    fail("unsafe-cold-workspace", `${label} is unreadable`, error);
  }
  if (!stat.isDirectory() || stat.isSymbolicLink()) {
    fail("unsafe-cold-workspace", `${label} is not a plain directory`);
  }
}

function writeExclusive(path: string, bytes: Uint8Array): void {
  const fd = openSync(path, "wx", 0o600);
  try {
    let offset = 0;
    while (offset < bytes.byteLength) {
      const written = writeSync(fd, bytes, offset, bytes.byteLength - offset);
      if (written <= 0) fail("unsafe-cold-workspace", `short write for ${path}`);
      offset += written;
    }
    // The cold workspace is disposable and its input/output bytes are
    // independently checked before and after Bun. It is not a durable output.
  } finally {
    closeSync(fd);
  }
}

function readPlainFile(path: string, label: string): Uint8Array {
  let stat;
  try {
    stat = lstatSync(path);
  } catch (error) {
    fail("concurrent-source-mutation", `${label} became unreadable`, error);
  }
  if (!stat.isFile() || stat.isSymbolicLink()) {
    fail("concurrent-source-mutation", `${label} is no longer a regular file`);
  }
  try {
    return new Uint8Array(readFileSync(path));
  } catch (error) {
    fail("concurrent-source-mutation", `${label} cannot be reread`, error);
  }
}

function normalizedTreePath(root: string, target: string): string {
  return relative(root, target).split(sep).join("/");
}

function scanPlainTree(root: string, label: string): ScannedTree {
  assertPlainDirectory(root, label);
  const directories: string[] = [];
  const files: string[] = [];
  const fileRows: { path: string; byteLength: number; digest: string }[] = [];
  const visit = (directory: string): void => {
    let names: string[];
    try {
      names = readdirSync(directory).sort();
    } catch (error) {
      fail("unsafe-cold-workspace", `${label} cannot be enumerated`, error);
    }
    for (const name of names) {
      const target = coldInside(root, resolve(directory, name));
      let stat;
      try {
        stat = lstatSync(target);
      } catch (error) {
        fail("unsafe-cold-workspace", `${label} entry became unreadable`, error);
      }
      const path = normalizedTreePath(root, target);
      if (stat.isSymbolicLink()) {
        fail("nonempty-dependency-closure", `${label} contains a link: ${path}`);
      }
      if (stat.isDirectory()) {
        directories.push(path);
        visit(target);
      } else if (stat.isFile()) {
        files.push(path);
        const bytes = readPlainFile(target, `${label} file ${path}`);
        fileRows.push({ path, byteLength: bytes.byteLength, digest: sha256Hex(bytes) });
      } else {
        fail("unsafe-cold-workspace", `${label} contains a special entry: ${path}`);
      }
    }
  };
  visit(root);
  return Object.freeze({
    directories: Object.freeze(directories.sort()),
    files: Object.freeze(files.sort()),
    fileRows: Object.freeze(fileRows.sort((left, right) =>
      left.path < right.path ? -1 : left.path > right.path ? 1 : 0
    )),
  });
}

function strictObject(value: unknown, label: string): Record<string, unknown> {
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    fail("unsafe-cold-workspace", `${label} is not an object`);
  }
  return value as Record<string, unknown>;
}

function validateRootPackage(input: ColdEmptyCompiledArtifactDependencyInput): void {
  let value: unknown;
  try {
    value = decodeStrictJson(input.rootPackageJsonBytes, "cold dependency root package.json");
  } catch (error) {
    fail("invalid-package-manifest", "root package.json is not strict JSON", error);
  }
  const root = strictObject(value, "root package.json");
  if (root.packageManager !== SUPPORTED_PACKAGE_MANAGER) {
    fail("toolchain-integrity", "root packageManager does not bind the selected Bun release");
  }
  if (
    !Array.isArray(root.workspaces)
    || root.workspaces.length !== ROOT_WORKSPACE_PATTERNS.length
    || root.workspaces.some((pattern, index) => pattern !== ROOT_WORKSPACE_PATTERNS[index])
  ) {
    fail("invalid-package-manifest", "root package.json has an unsupported workspace boundary");
  }
}

/**
 * The static proof establishes that no root policy can affect an engine edge.
 * Only the engine workspace enters this install: unrelated root
 * dependencies, hooks, overrides, patches, and registry URLs are never executed.
 */
function coldWorkspaceProjection(packageJsonBytes: Uint8Array): {
  readonly rootPackage: Uint8Array;
  readonly lock: Uint8Array;
} {
  const manifest = readPackageManifest(packageJsonBytes);
  const workspace = {
    name: "@fenel/engine",
    ...(manifest.version === undefined ? {} : { version: manifest.version }),
  };
  return Object.freeze({
    rootPackage: new TextEncoder().encode(`${JSON.stringify({
      name: "fenel-cold-dependency-check",
      private: true,
      workspaces: [COMPILED_ARTIFACT_IMPORTER],
    })}\n`),
    lock: new TextEncoder().encode(`${JSON.stringify({
      lockfileVersion: SUPPORTED_BUN_LOCKFILE_VERSION,
      configVersion: 1,
      workspaces: {
        "": { name: "fenel-cold-dependency-check" },
        [COMPILED_ARTIFACT_IMPORTER]: workspace,
      },
      packages: { "@fenel/engine": [`@fenel/engine@workspace:${COMPILED_ARTIFACT_IMPORTER}`] },
    })}\n`),
  });
}

function markerBytes(nonce: string): Uint8Array {
  return new TextEncoder().encode(`${JSON.stringify({ schema: COLD_OWNER_SCHEMA, nonce })}\n`);
}

function cleanupOwnedColdRoot(root: string, base: string, marker: Uint8Array): void {
  if (!existsSync(root)) return;
  coldInside(base, root);
  assertPlainDirectory(root, "cold dependency root");
  const observed = readPlainFile(resolve(root, COLD_OWNER_MARKER), "cold dependency owner marker");
  if (!equalBytes(observed, marker)) {
    fail("unsafe-cold-workspace", "cold dependency owner marker changed; refusing cleanup");
  }
  rmSync(root, { recursive: true, force: false });
}

function guardedCapture(rows: readonly GuardedFile[]): string {
  const parts: string[] = [];
  for (const row of rows) {
    const observed = readPlainFile(row.path, row.label);
    if (!equalBytes(observed, row.bytes)) {
      fail("concurrent-source-mutation", `${row.label} differs from its materialized input`);
    }
    parts.push(`${row.label}\0${observed.byteLength}\0${sha256Hex(observed)}`);
  }
  return sha256Hex(new TextEncoder().encode(
    `fenel-bun-cold-source-capture-v1\0${parts.join("\0")}`,
  ));
}

function coldEnvironment(root: string): Readonly<Record<string, string>> {
  const home = resolve(root, "home");
  const temp = resolve(root, "temp");
  const environment: Record<string, string> = {
    CI: "true",
    BUN_INSTALL_CACHE_DIR: resolve(root, "cache"),
    BUN_INSTALL_GLOBAL_DIR: resolve(home, "bun-global"),
    BUN_INSTALL_BIN: resolve(home, "bun-bin"),
    BUN_CONFIG_NO_CLEAR_TERMINAL: "1",
    BUN_CONFIG_NO_PROGRESS: "1",
    BUN_CONFIG_NO_STATS: "1",
    FORCE_COLOR: "0",
    HOME: home,
    LANG: "C",
    LC_ALL: "C",
    NO_COLOR: "1",
    NPM_CONFIG_CACHE: resolve(home, "npm-cache"),
    NPM_CONFIG_GLOBALCONFIG: resolve(home, "global.npmrc"),
    NPM_CONFIG_USERCONFIG: resolve(home, ".npmrc"),
    HTTP_PROXY: "http://127.0.0.1:9",
    HTTPS_PROXY: "http://127.0.0.1:9",
    NO_PROXY: "",
    TEMP: temp,
    TMP: temp,
    TMPDIR: temp,
    TZ: "UTC",
    USERPROFILE: home,
    XDG_CACHE_HOME: resolve(home, "xdg-cache"),
    XDG_CONFIG_HOME: resolve(home, "xdg-config"),
    XDG_DATA_HOME: resolve(home, "xdg-data"),
  };
  if (process.platform === "win32") {
    // Windows process creation requires its OS directory; package lookup stays closed.
    const systemRoot = process.env.SYSTEMROOT ?? process.env.SystemRoot;
    if (systemRoot === undefined || !isAbsolute(systemRoot)) {
      fail("unsafe-cold-workspace", "Windows lacks an absolute SYSTEMROOT for Bun process creation");
    }
    assertPlainDirectory(systemRoot, "Windows SYSTEMROOT");
    const drive = systemRoot.match(/^[A-Za-z]:/u)?.[0];
    if (drive === undefined) {
      fail("unsafe-cold-workspace", "Windows SYSTEMROOT lacks a drive-qualified path");
    }
    environment.SYSTEMDRIVE = drive.toUpperCase();
    environment.SYSTEMROOT = resolve(systemRoot);
    environment.WINDIR = resolve(systemRoot);
  }
  return Object.freeze(environment);
}

async function defaultRunBun(request: ColdBunCommandRequest): Promise<ColdBunCommandResult> {
  const child = Bun.spawn([...request.argv], {
    cwd: request.cwd,
    env: { ...request.env },
    stdin: "ignore",
    stdout: "pipe",
    stderr: "pipe",
  });
  const [exitCode, stdout, stderr] = await Promise.all([
    child.exited,
    new Response(child.stdout).text(),
    new Response(child.stderr).text(),
  ]);
  return Object.freeze({ exitCode, stdout, stderr });
}

function requireExactRows(actual: readonly string[], expected: readonly string[], label: string): void {
  if (actual.length !== expected.length || actual.some((row, index) => row !== expected[index])) {
    fail("nonempty-dependency-closure", `${label} contains unexpected dependency output: ${actual.join(",")}`);
  }
}

function validateColdOutputs(paths: ColdBunCommandPaths): ColdOutputCapture {
  const cache = scanPlainTree(paths.cache, "fresh Bun cache");
  const modules = scanPlainTree(paths.modules, "fresh Bun modules root");
  const workspace = scanPlainTree(paths.workspace, "cold Bun workspace");
  requireExactRows(cache.files, [], "fresh Bun cache");
  requireExactRows(cache.directories, [], "fresh Bun cache");
  requireExactRows(modules.files, [], "fresh Bun modules root");
  requireExactRows(modules.directories, [".bun"], "fresh Bun modules root");
  requireExactRows(workspace.directories, [
    "implementations", "implementations/typescript", COMPILED_ARTIFACT_IMPORTER,
    "node_modules", "node_modules/.bun",
  ], "cold Bun workspace");
  requireExactRows(workspace.files, [
    `implementations/typescript/engine/${ENGINE_OWNER_MARKER}`,
    ENGINE_PACKAGE_PATH, "bun.lock", "bunfig.toml", "package.json", ".npmrc",
  ].sort(), "cold Bun workspace");
  const lockBytes = readPlainFile(paths.lockfile, "Bun installed lock");
  const lock = decodeBunLock(lockBytes);
  proveEmptyLockImporter(lockBytes);
  requireExactRows(Object.keys(lockObject(lock.workspaces, "workspaces")).sort(),
    ["", COMPILED_ARTIFACT_IMPORTER], "Bun installed workspaces");
  requireExactRows(Object.keys(lockObject(lock.packages, "packages")),
    ["@fenel/engine"], "Bun installed package resolutions");
  const observedCanonicalManifest = `${JSON.stringify({
    schema: COMPILED_ARTIFACT_DEPENDENCY_SCHEMA,
    importer: COMPILED_ARTIFACT_IMPORTER,
    packages: [],
    files: cache.fileRows.map((row) => ({ path: row.path, byteLength: row.byteLength, sha256: row.digest })),
    virtualResolutionMap: [],
  })}\n`;
  return Object.freeze({
    digest: sha256Hex(new TextEncoder().encode(JSON.stringify({
      schema: "fenel.bun-cold-output-capture.v1",
      roots: [{ name: "cache", ...cache }, { name: "modules", ...modules }, { name: "workspace", ...workspace }],
    }))),
    observedCanonicalManifest,
  });
}

/**
 * A pinned Bun child that exits nonzero without printing anything is a host
 * fault, not dependency evidence: seen in identity regenerations on 2026-10-31
 * ("exited 66: no diagnostic", twice under memory pressure), never in 40
 * isolated runs. Such an exit gets one more complete attempt in a fresh cold
 * root (same argv, guards and output checks). An exit with a diagnostic, or a
 * second silent exit, fails as before.
 */
const COLD_RESOLUTION_ATTEMPTS = 2;
const silentBunExits = new WeakSet<Error>();

/**
 * Run pinned Bun against the proven engine-only lock projection and an empty
 * cache. Bun 1.3.13 has no install --offline flag: the zero-edge projection has
 * no fetch targets, and registry/proxy destinations are restricted to loopback.
 * This is dependency-level isolation, not an OS network sandbox.
 */
export async function coldResolveEmptyCompiledArtifactDependencies(
  input: ColdEmptyCompiledArtifactDependencyInput,
  dependencies: ColdBunVerificationDependencies = {},
): Promise<ColdEmptyCompiledArtifactDependencyProof> {
  for (let attempt = 1; ; attempt += 1) {
    try {
      return await coldResolveOnce(input, dependencies);
    } catch (error) {
      if (attempt >= COLD_RESOLUTION_ATTEMPTS || !(error instanceof Error) || !silentBunExits.has(error)) {
        throw error;
      }
      console.warn(`[compiled-artifact-dependencies] ${error.message}; one more attempt in a fresh cold root`);
    }
  }
}

async function coldResolveOnce(
  input: ColdEmptyCompiledArtifactDependencyInput,
  dependencies: ColdBunVerificationDependencies,
): Promise<ColdEmptyCompiledArtifactDependencyProof> {
  validateRootPackage(input);
  const staticProof = proveEmptyCompiledArtifactDependencies({
    packageJsonBytes: input.packageJsonBytes,
    bunLockBytes: input.bunLockBytes,
  });
  if (!equalBytes(new TextEncoder().encode(staticProof.canonicalManifest), input.expectedDependencyManifestBytes)) {
    fail("dependency-manifest-mismatch", "packaged dependency manifest is not the canonical lock projection");
  }
  const projection = coldWorkspaceProjection(input.packageJsonBytes);
  // Bun resolves workspace packages to long Windows paths. Expand an 8.3 temp
  // alias before choosing cwd, or it invents an escaping workspace resolution.
  const repositoryRoot = realpathSync.native(resolve(input.repositoryRoot));
  const base = resolve(repositoryRoot, COLD_SNAPSHOT_ROOT);
  coldInside(repositoryRoot, base);
  mkdirSync(base, { recursive: true, mode: 0o700 });
  assertPlainDirectory(base, "cold dependency snapshot root");
  if (realpathSync(base) !== base) {
    fail("unsafe-cold-workspace", "cold dependency snapshot root resolves through an alias or link");
  }
  const nonce = dependencies.nonce?.() ?? randomBytes(16).toString("hex");
  if (!/^[0-9a-f]{16,128}$/u.test(nonce)) {
    fail("unsafe-cold-workspace", "cold dependency nonce must be lowercase hex");
  }
  const root = resolve(base, `bun-cold-${process.pid}-${nonce}`);
  coldInside(base, root);
  try {
    mkdirSync(root, { recursive: false, mode: 0o700 });
  } catch (error) {
    fail("unsafe-cold-workspace", "cannot exclusively create cold dependency root", error);
  }
  const ownerMarker = markerBytes(nonce);
  let owned = true;
  try {
    writeExclusive(resolve(root, COLD_OWNER_MARKER), ownerMarker);
    const workspace = resolve(root, "workspace");
    const cache = resolve(root, "cache");
    const inputs = resolve(root, "inputs");
    const home = resolve(root, "home");
    const temp = resolve(root, "temp");
    for (const directory of [workspace, cache, inputs, home, temp]) {
      coldInside(root, directory);
      mkdirSync(directory, { recursive: false, mode: 0o700 });
    }
    const engineDirectory = resolve(workspace, COMPILED_ARTIFACT_IMPORTER);
    mkdirSync(engineDirectory, { recursive: true, mode: 0o700 });
    const guarded: GuardedFile[] = [];
    const materialize = (label: string, path: string, bytes: Uint8Array): void => {
      coldInside(root, path);
      mkdirSync(dirname(path), { recursive: true, mode: 0o700 });
      const copied = new Uint8Array(bytes);
      writeExclusive(path, copied);
      guarded.push(Object.freeze({ label, path, bytes: copied }));
    };
    materialize("root package.json", resolve(inputs, "package.json"), input.rootPackageJsonBytes);
    materialize("repository bun.lock", resolve(inputs, "bun.lock"), input.bunLockBytes);
    materialize("expected dependency manifest", resolve(inputs, "dependencies.json"), input.expectedDependencyManifestBytes);
    materialize("closed root package.json", resolve(workspace, "package.json"), projection.rootPackage);
    materialize("projected bun.lock", resolve(workspace, "bun.lock"), projection.lock);
    const enginePackage = resolve(engineDirectory, "package.json");
    materialize("engine package.json", enginePackage, input.packageJsonBytes);
    materialize("engine owner marker", resolve(engineDirectory, ENGINE_OWNER_MARKER), ownerMarker);
    materialize("Bun user config", resolve(home, ".bunfig.toml"), new Uint8Array());
    materialize("npm user config", resolve(home, ".npmrc"), new Uint8Array());
    materialize("npm global config", resolve(home, "global.npmrc"), new Uint8Array());
    materialize("npm project config", resolve(workspace, ".npmrc"), new Uint8Array());
    const config = resolve(workspace, "bunfig.toml");
    materialize("Bun install config", config, new TextEncoder().encode([
      "[install]", 'registry = "http://127.0.0.1:9"', 'linker = "isolated"',
      "frozenLockfile = true", "ignoreScripts = true", "",
    ].join("\n")));
    const bunA = readPlainFile(input.bunExecutable, "pinned Bun executable");
    if (sha256Hex(bunA) !== input.bunExecutableSha256) {
      fail("toolchain-integrity", "pinned Bun executable does not match its environment digest");
    }
    const environment = coldEnvironment(root);
    const paths: ColdBunCommandPaths = Object.freeze({
      root, workspace, cache, modules: resolve(workspace, "node_modules"), enginePackage,
      lockfile: resolve(workspace, "bun.lock"), bunExecutable: resolve(input.bunExecutable),
    });
    const argv = Object.freeze([
      resolve(input.bunExecutable), "install", `--config=${config}`,
      "--frozen-lockfile", "--ignore-scripts", "--linker", "isolated", "--backend", "copyfile",
      "--cache-dir", cache, "--registry", "http://127.0.0.1:9", "--no-progress",
    ]);
    const request: ColdBunCommandRequest = Object.freeze({ argv, cwd: workspace, env: environment, paths });
    const sourceCaptureDigest = guardedCapture(guarded);
    await dependencies.afterSourceCapture?.(request);
    // Do not run with source bytes already known to differ from capture A.
    guardedCapture(guarded);
    const result = await (dependencies.runBun ?? defaultRunBun)(request);
    await dependencies.afterBun?.(request);
    if (guardedCapture(guarded) !== sourceCaptureDigest) {
      fail("concurrent-source-mutation", "cold dependency source capture changed across Bun");
    }
    if (!equalBytes(bunA, readPlainFile(input.bunExecutable, "pinned Bun executable"))) {
      fail("toolchain-integrity", "pinned Bun executable changed during cold resolution");
    }
    if (result.exitCode !== 0) {
      const detail = result.stderr.trim() || result.stdout.trim();
      const error = new DependencyEvidenceError(
        "cold-resolution-failed",
        `pinned Bun exited ${result.exitCode}: ${detail === "" ? "no diagnostic" : detail.slice(0, 2_000)}`,
      );
      if (detail === "") silentBunExits.add(error);
      throw error;
    }
    const outputCaptureA = validateColdOutputs(paths);
    await dependencies.betweenOutputCaptures?.(request);
    const outputCaptureB = validateColdOutputs(paths);
    if (outputCaptureA.digest !== outputCaptureB.digest
        || outputCaptureA.observedCanonicalManifest !== outputCaptureB.observedCanonicalManifest) {
      fail("concurrent-source-mutation", "cold dependency output changed across its A/B capture");
    }
    guardedCapture(guarded);
    if (outputCaptureB.observedCanonicalManifest !== staticProof.canonicalManifest) {
      fail("dependency-manifest-mismatch", "cold Bun result differs from the static dependency manifest");
    }
    return Object.freeze({
      ...staticProof,
      coldResolution: "verified",
      observedCanonicalManifest: outputCaptureB.observedCanonicalManifest,
      sourceCaptureDigest,
      bunExecutableSha256: input.bunExecutableSha256,
    });
  } catch (error) {
    if (owned && existsSync(root)) {
      try {
        cleanupOwnedColdRoot(root, base, ownerMarker);
        owned = false;
      } catch (cleanupError) {
        throw new AggregateError([error, cleanupError], "cold dependency verification and owned cleanup failed");
      }
    }
    throw error;
  } finally {
    if (owned && existsSync(root)) cleanupOwnedColdRoot(root, base, ownerMarker);
  }
}
