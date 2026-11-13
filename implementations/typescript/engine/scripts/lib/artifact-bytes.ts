import { createHash, randomBytes } from "node:crypto";
import { constants, watch, type BigIntStats, type FSWatcher } from "node:fs";
import {
  lstat,
  open,
  readdir,
  unlink,
} from "node:fs/promises";
import {
  isAbsolute,
  join,
  relative,
  resolve,
} from "node:path";

declare const repositoryRelativePathBrand: unique symbol;
declare const sha256HexBrand: unique symbol;

export type RepositoryRelativePath = string & {
  readonly [repositoryRelativePathBrand]: true;
};

export type Sha256Hex = string & {
  readonly [sha256HexBrand]: true;
};

export type CompiledArtifactId = "compiled-resolver" | "compiled-parser";

export interface ByteManifestRow {
  readonly path: RepositoryRelativePath;
  readonly kind: "regular-file";
  readonly byteLength: number;
  readonly sha256: Sha256Hex;
}

export interface ByteManifest {
  readonly schema: "fenel.byte-manifest.v1";
  readonly domain: string;
  readonly rows: readonly ByteManifestRow[];
  readonly fileCount: number;
  readonly byteLength: number;
  readonly digest: Sha256Hex;
}

export type CaptureDomain =
  | {
    readonly kind: "owner-overlay";
    readonly artifact: CompiledArtifactId;
    readonly exactFiles: readonly RepositoryRelativePath[];
    readonly recursiveRoots?: readonly RepositoryRelativePath[];
  }
  | {
    readonly kind: "envelope";
    readonly name: string;
    readonly exactFiles: readonly RepositoryRelativePath[];
  };

export interface StableEpochRequest {
  readonly repositoryRoot: string;
  readonly domains?: readonly CaptureDomain[];
}

export interface CapturedByteStore {
  readonly paths: readonly RepositoryRelativePath[];
  has(path: RepositoryRelativePath): boolean;
  /** Returns a defensive copy; callers cannot mutate the retained capture. */
  read(path: RepositoryRelativePath): Uint8Array;
}

export interface DismissedChangeEvent {
  readonly path: RepositoryRelativePath;
  readonly count: number;
}

export interface StableEpochCapture {
  readonly repositoryEpoch: Sha256Hex;
  readonly repository: ByteManifest;
  readonly domains: readonly ByteManifest[];
  readonly bytes: CapturedByteStore;
  /** Observational only; never participates in a manifest or epoch identity. */
  readonly dismissedChangeEvents: readonly DismissedChangeEvent[];
}

export type CaptureIssue =
  | { readonly code: "missing-input"; readonly path: RepositoryRelativePath }
  | { readonly code: "unreadable-input"; readonly path?: RepositoryRelativePath }
  | { readonly code: "ambiguous-input"; readonly paths: readonly RepositoryRelativePath[] }
  | { readonly code: "canonicalization-failed"; readonly path?: string }
  | { readonly code: "unsupported-entry"; readonly path: RepositoryRelativePath }
  | { readonly code: "watcher-unsupported" }
  | { readonly code: "watcher-error" | "watcher-loss" }
  | { readonly code: "covered-mutation"; readonly path?: RepositoryRelativePath }
  | { readonly code: "scan-mismatch" };

export type CaptureResult =
  | { readonly ok: true; readonly value: StableEpochCapture }
  | { readonly ok: false; readonly issue: CaptureIssue };

export interface ArtifactByteWatcher {
  close(): Promise<void>;
}

export interface ArtifactByteWatcherHandlers {
  readonly event: (
    eventType: "rename" | "change",
    filename: string | Uint8Array | null,
  ) => void;
  readonly error: (error: unknown) => void;
}

/** Injection surface for deterministic watcher/race tests. Production callers
 * should omit it. It cannot alter byte inventory or hashing policy. */
export interface ArtifactBytesTestDependencies {
  readonly watchFactory?: (
    repositoryRoot: string,
    handlers: ArtifactByteWatcherHandlers,
  ) => ArtifactByteWatcher;
  readonly createSentinel?: (absolutePath: string, payload: Uint8Array) => Promise<void>;
  readonly removeSentinel?: (absolutePath: string) => Promise<void>;
  readonly nonce?: () => string;
  readonly afterScan?: (phase: "A" | "B") => void | Promise<void>;
  readonly drainWatcher?: () => Promise<void>;
  readonly reportDismissedChangeEvents?: (
    events: readonly DismissedChangeEvent[],
  ) => void;
  readonly sentinelTimeoutMs?: number;
}

const strictUtf8 = new TextDecoder("utf-8", { fatal: true });
const INVALID_PORTABLE_SEGMENT = /[\u0000-\u001f<>:"/\\|?*]/u;
const WINDOWS_RESERVED_SEGMENT = /^(?:con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\.|$)/iu;
const DOMAIN_PATTERN = /^[A-Za-z0-9._:-]+$/u;

const makeFrozenPaths = (paths: readonly string[]): readonly RepositoryRelativePath[] =>
  Object.freeze(paths.map(repositoryRelativePath));

export const REPOSITORY_RECURSIVE_ROOTS = makeFrozenPaths([
  "fenel",
  "implementations/typescript/engine/src",
]);

export const REPOSITORY_EXACT_FILES = makeFrozenPaths([
  ".fenel.lock",
  ".gitattributes",
  "package.json",
  "bun.lock",
  "patches/@solidjs%2Fsignals@2.0.0-rc.7.patch",
  "tsconfig.base.json",
  "implementations/typescript/engine/package.json",
  "implementations/typescript/engine/tsconfig.json",
]);

export const RECOVERABLE_OUTPUT_EXCLUSIONS = makeFrozenPaths([
  "implementations/typescript/engine/src/generated/parse-cache.generated.ts",
  "implementations/typescript/engine/src/generated/signature-honesty-claims.json",
  "implementations/typescript/engine/src/generated/compiled-parser.generated.ts",
  "implementations/typescript/engine/src/generated/compiled-resolver.generated.ts",
  "implementations/typescript/engine/src/generated/compiled-parser.build-certificate.json",
  "implementations/typescript/engine/src/generated/compiled-resolver.build-certificate.json",
]);

export const ENVIRONMENT_ONLY_OWNER_INPUTS = makeFrozenPaths([
  ".github/fenel-artifact-toolchains.json",
]);

export const REPOSITORY_BYTE_UNIVERSE = Object.freeze({
  recursiveRoots: REPOSITORY_RECURSIVE_ROOTS,
  exactFiles: REPOSITORY_EXACT_FILES,
  exclusions: RECOVERABLE_OUTPUT_EXCLUSIONS,
});

const exclusionSet = new Set<string>(RECOVERABLE_OUTPUT_EXCLUSIONS);

class CaptureFailure extends Error {
  constructor(readonly issue: CaptureIssue) {
    super(issue.code);
  }
}

function fail(issue: CaptureIssue): never {
  throw new CaptureFailure(issue);
}

function portableSegment(segment: string): string {
  if (
    segment.length === 0
    || segment === "."
    || segment === ".."
    || segment.normalize("NFC") !== segment
    || INVALID_PORTABLE_SEGMENT.test(segment)
    || /[ .]$/u.test(segment)
    || WINDOWS_RESERVED_SEGMENT.test(segment)
  ) {
    throw new TypeError(`non-canonical repository path segment ${JSON.stringify(segment)}`);
  }
  return segment;
}

export function repositoryRelativePath(value: string): RepositoryRelativePath {
  if (
    typeof value !== "string"
    || value.length === 0
    || isAbsolute(value)
    || value.startsWith("/")
    || value.includes("\\")
  ) {
    throw new TypeError(`non-canonical repository-relative path ${JSON.stringify(value)}`);
  }
  for (const segment of value.split("/")) portableSegment(segment);
  return value as RepositoryRelativePath;
}

export function parseSha256Hex(value: string): Sha256Hex {
  if (!/^[0-9a-f]{64}$/u.test(value)) {
    throw new TypeError("expected one lowercase 64-hex SHA-256 digest");
  }
  return value as Sha256Hex;
}

export function sha256Raw(bytes: Uint8Array | string): Sha256Hex {
  return parseSha256Hex(
    createHash("sha256")
      .update(typeof bytes === "string" ? Buffer.from(bytes, "utf8") : bytes)
      .digest("hex"),
  );
}

export function compareUtf8Paths(
  left: RepositoryRelativePath,
  right: RepositoryRelativePath,
): number {
  return Buffer.compare(Buffer.from(left, "utf8"), Buffer.from(right, "utf8"));
}

function caseKey(path: RepositoryRelativePath): string {
  return path.normalize("NFC").toLowerCase();
}

function frozenRow(row: ByteManifestRow): ByteManifestRow {
  return Object.freeze({ ...row });
}

function canonicalManifestValue(
  domain: string,
  rows: readonly ByteManifestRow[],
): readonly unknown[] {
  return [
    "fenel.byte-manifest.v1",
    domain,
    rows.map((row) => [row.path, row.kind, row.byteLength, row.sha256]),
  ];
}

export function digestByteManifest(
  domain: string,
  inputRows: readonly ByteManifestRow[],
): ByteManifest {
  if (!DOMAIN_PATTERN.test(domain)) {
    throw new TypeError(`invalid manifest domain ${JSON.stringify(domain)}`);
  }
  const rows = inputRows.map((row) => {
    const path = repositoryRelativePath(row.path);
    if (row.kind !== "regular-file") throw new TypeError("unsupported manifest file kind");
    if (!Number.isSafeInteger(row.byteLength) || row.byteLength < 0) {
      throw new TypeError("manifest byte length must be one non-negative safe integer");
    }
    return frozenRow({
      path,
      kind: "regular-file",
      byteLength: row.byteLength,
      sha256: parseSha256Hex(row.sha256),
    });
  }).sort((left, right) => compareUtf8Paths(left.path, right.path));

  const exact = new Map<string, RepositoryRelativePath>();
  const folded = new Map<string, RepositoryRelativePath>();
  let byteLength = 0;
  for (const row of rows) {
    const priorExact = exact.get(row.path);
    if (priorExact !== undefined) {
      fail({ code: "ambiguous-input", paths: Object.freeze([priorExact, row.path]) });
    }
    const foldedKey = caseKey(row.path);
    const priorFolded = folded.get(foldedKey);
    if (priorFolded !== undefined && priorFolded !== row.path) {
      fail({ code: "ambiguous-input", paths: Object.freeze([priorFolded, row.path]) });
    }
    exact.set(row.path, row.path);
    folded.set(foldedKey, row.path);
    byteLength += row.byteLength;
    if (!Number.isSafeInteger(byteLength)) throw new TypeError("manifest byte total is unsafe");
  }
  const frozenRows = Object.freeze(rows);
  return Object.freeze({
    schema: "fenel.byte-manifest.v1" as const,
    domain,
    rows: frozenRows,
    fileCount: frozenRows.length,
    byteLength,
    digest: sha256Raw(JSON.stringify(canonicalManifestValue(domain, frozenRows))),
  });
}

export function computeOwnerEpoch(input: {
  readonly artifact: CompiledArtifactId;
  readonly repositoryEpoch: Sha256Hex;
  readonly ownerOverlayDigest: Sha256Hex;
  readonly dependencyDigest: Sha256Hex;
  readonly protocolVersion: string;
  readonly recoveryStubVersion: string;
  readonly portableGenerationAbi: string;
}): Sha256Hex {
  if (input.artifact !== "compiled-resolver" && input.artifact !== "compiled-parser") {
    throw new TypeError("invalid compiled artifact id");
  }
  for (const [name, value] of [
    ["protocolVersion", input.protocolVersion],
    ["recoveryStubVersion", input.recoveryStubVersion],
    ["portableGenerationAbi", input.portableGenerationAbi],
  ] as const) {
    if (value.length === 0) throw new TypeError(`${name} must not be empty`);
  }
  return sha256Raw(JSON.stringify([
    "fenel.compiled-owner-epoch.v1",
    input.artifact,
    parseSha256Hex(input.repositoryEpoch),
    parseSha256Hex(input.ownerOverlayDigest),
    parseSha256Hex(input.dependencyDigest),
    input.protocolVersion,
    input.recoveryStubVersion,
    input.portableGenerationAbi,
  ]));
}

interface PreparedDomain {
  readonly manifestDomain: string;
  readonly kind: CaptureDomain["kind"];
  readonly exactFiles: readonly RepositoryRelativePath[];
  readonly recursiveRoots: readonly RepositoryRelativePath[];
}

interface PreparedRequest {
  readonly repositoryRoot: string;
  readonly domains: readonly PreparedDomain[];
}

function validatedUniquePaths(
  paths: readonly RepositoryRelativePath[],
): readonly RepositoryRelativePath[] {
  const exact = new Map<string, RepositoryRelativePath>();
  const folded = new Map<string, RepositoryRelativePath>();
  const validated: RepositoryRelativePath[] = [];
  for (const input of paths) {
    const path = repositoryRelativePath(input);
    const priorExact = exact.get(path);
    if (priorExact !== undefined) {
      fail({ code: "ambiguous-input", paths: Object.freeze([priorExact, path]) });
    }
    const foldedKey = caseKey(path);
    const priorFolded = folded.get(foldedKey);
    if (priorFolded !== undefined && priorFolded !== path) {
      fail({ code: "ambiguous-input", paths: Object.freeze([priorFolded, path]) });
    }
    exact.set(path, path);
    folded.set(foldedKey, path);
    validated.push(path);
  }
  return Object.freeze(validated.sort(compareUtf8Paths));
}

function rejectNestedRoots(paths: readonly RepositoryRelativePath[]): void {
  for (let leftIndex = 0; leftIndex < paths.length; leftIndex += 1) {
    const left = paths[leftIndex]!;
    for (let rightIndex = leftIndex + 1; rightIndex < paths.length; rightIndex += 1) {
      const right = paths[rightIndex]!;
      if (pathContains(left, right) || pathContains(right, left)) {
        fail({ code: "ambiguous-input", paths: Object.freeze([left, right]) });
      }
    }
  }
}

function pathContains(parent: RepositoryRelativePath, child: RepositoryRelativePath): boolean {
  return child === parent || child.startsWith(`${parent}/`);
}

function prepareRequest(request: StableEpochRequest): PreparedRequest {
  if (typeof request.repositoryRoot !== "string" || request.repositoryRoot.length === 0) {
    fail({ code: "canonicalization-failed" });
  }
  const repositoryRoot = resolve(request.repositoryRoot);
  const domains: PreparedDomain[] = [];
  const names = new Set<string>();
  for (const input of request.domains ?? []) {
    let manifestDomain: string;
    let recursiveRoots: readonly RepositoryRelativePath[];
    if (input.kind === "owner-overlay") {
      if (input.artifact !== "compiled-resolver" && input.artifact !== "compiled-parser") {
        fail({ code: "canonicalization-failed" });
      }
      manifestDomain = `owner-overlay:${input.artifact}`;
      recursiveRoots = validatedUniquePaths(input.recursiveRoots ?? []);
      rejectNestedRoots(recursiveRoots);
      const forbidden = [
        ...RECOVERABLE_OUTPUT_EXCLUSIONS,
        ...ENVIRONMENT_ONLY_OWNER_INPUTS,
      ];
      for (const path of input.exactFiles) {
        const validated = repositoryRelativePath(path);
        if (forbidden.includes(validated)) {
          fail({ code: "ambiguous-input", paths: Object.freeze([validated]) });
        }
      }
      for (const root of recursiveRoots) {
        for (const path of forbidden) {
          if (pathContains(root, path)) {
            fail({ code: "ambiguous-input", paths: Object.freeze([root, path]) });
          }
        }
      }
    } else {
      if (!DOMAIN_PATTERN.test(input.name)) fail({ code: "canonicalization-failed" });
      manifestDomain = `envelope:${input.name}`;
      recursiveRoots = Object.freeze([]);
    }
    if (names.has(manifestDomain)) fail({ code: "ambiguous-input", paths: Object.freeze([]) });
    names.add(manifestDomain);
    domains.push(Object.freeze({
      manifestDomain,
      kind: input.kind,
      exactFiles: validatedUniquePaths(input.exactFiles),
      recursiveRoots,
    }));
  }
  domains.sort((left, right) =>
    Buffer.compare(Buffer.from(left.manifestDomain), Buffer.from(right.manifestDomain))
  );
  return Object.freeze({ repositoryRoot, domains: Object.freeze(domains) });
}

function repoAbsolute(repositoryRoot: string, path: RepositoryRelativePath): string {
  const absolute = resolve(repositoryRoot, ...path.split("/"));
  const back = relative(repositoryRoot, absolute);
  if (back === "" || back === ".." || back.startsWith(`..${process.platform === "win32" ? "\\" : "/"}`) || isAbsolute(back)) {
    fail({ code: "canonicalization-failed", path });
  }
  return absolute;
}

function relativeFromAbsolute(
  repositoryRoot: string,
  absolutePath: string,
): RepositoryRelativePath {
  const raw = relative(repositoryRoot, absolutePath).replaceAll("\\", "/");
  return repositoryRelativePath(raw);
}

function decodeDirectoryName(raw: Uint8Array): string {
  try {
    const decoded = strictUtf8.decode(raw);
    if (!Buffer.from(decoded, "utf8").equals(Buffer.from(raw))) {
      throw new TypeError("non-round-tripping UTF-8");
    }
    return portableSegment(decoded);
  } catch {
    fail({ code: "canonicalization-failed" });
  }
}

function issuePath(repositoryRoot: string, absolutePath: string): RepositoryRelativePath | undefined {
  try {
    return relativeFromAbsolute(repositoryRoot, absolutePath);
  } catch {
    return undefined;
  }
}

function fsFailure(
  repositoryRoot: string,
  absolutePath: string,
  error: unknown,
): never {
  const path = issuePath(repositoryRoot, absolutePath);
  const code = typeof error === "object" && error !== null && "code" in error
    ? String((error as { code?: unknown }).code)
    : "";
  if (code === "ENOENT" || code === "ENOTDIR") {
    if (path !== undefined) fail({ code: "missing-input", path });
  }
  fail({ code: "unreadable-input", ...(path === undefined ? {} : { path }) });
}

async function lstatRequired(
  repositoryRoot: string,
  absolutePath: string,
): Promise<BigIntStats> {
  try {
    return await lstat(absolutePath, { bigint: true });
  } catch (error) {
    return fsFailure(repositoryRoot, absolutePath, error);
  }
}

async function validateDirectoryPath(
  repositoryRoot: string,
  path: RepositoryRelativePath,
): Promise<void> {
  let current = repositoryRoot;
  const rootStat = await lstatRequired(repositoryRoot, current);
  if (!rootStat.isDirectory() || rootStat.isSymbolicLink()) {
    fail({ code: "unsupported-entry", path });
  }
  for (const part of path.split("/")) {
    current = join(current, part);
    const relativePath = relativeFromAbsolute(repositoryRoot, current);
    const stat = await lstatRequired(repositoryRoot, current);
    if (!stat.isDirectory() || stat.isSymbolicLink()) {
      fail({ code: "unsupported-entry", path: relativePath });
    }
  }
}

function sameStableStat(left: BigIntStats, right: BigIntStats): boolean {
  return left.dev === right.dev
    && left.ino === right.ino
    && left.mode === right.mode
    && left.size === right.size
    && left.mtimeNs === right.mtimeNs
    && left.ctimeNs === right.ctimeNs;
}

interface RaceWitness {
  readonly dev: bigint;
  readonly ino: bigint;
  readonly mode: bigint;
  readonly size: bigint;
  readonly mtimeNs: bigint;
  readonly ctimeNs: bigint;
}

function raceWitness(stat: BigIntStats): RaceWitness {
  return Object.freeze({
    dev: stat.dev,
    ino: stat.ino,
    mode: stat.mode,
    size: stat.size,
    mtimeNs: stat.mtimeNs,
    ctimeNs: stat.ctimeNs,
  });
}

function sameRaceWitness(left: RaceWitness, right: RaceWitness): boolean {
  return left.dev === right.dev
    && left.ino === right.ino
    && left.mode === right.mode
    && left.size === right.size
    && left.mtimeNs === right.mtimeNs
    && left.ctimeNs === right.ctimeNs;
}

interface PhysicalCapture {
  readonly row: ByteManifestRow;
  readonly witness: RaceWitness;
  readonly bytes?: Uint8Array;
}

interface ScanCapture {
  readonly repository: ByteManifest;
  readonly domains: readonly ByteManifest[];
  readonly bytes: ReadonlyMap<RepositoryRelativePath, Uint8Array>;
  readonly witnesses: ReadonlyMap<RepositoryRelativePath, RaceWitness>;
}

class ScanBuilder {
  private readonly physical = new Map<RepositoryRelativePath, PhysicalCapture>();
  private readonly folded = new Map<string, RepositoryRelativePath>();
  private readonly repositoryRows = new Map<RepositoryRelativePath, ByteManifestRow>();

  constructor(
    private readonly request: PreparedRequest,
    private readonly retainBytes: boolean,
  ) {}

  private registerPath(path: RepositoryRelativePath): void {
    const foldedKey = caseKey(path);
    const prior = this.folded.get(foldedKey);
    if (prior !== undefined && prior !== path) {
      fail({ code: "ambiguous-input", paths: Object.freeze([prior, path]) });
    }
    this.folded.set(foldedKey, path);
  }

  private async validateDirectoryChain(path: RepositoryRelativePath): Promise<void> {
    const parts = path.split("/");
    parts.pop();
    if (parts.length === 0) {
      const rootStat = await lstatRequired(this.request.repositoryRoot, this.request.repositoryRoot);
      if (!rootStat.isDirectory() || rootStat.isSymbolicLink()) {
        fail({ code: "unsupported-entry", path });
      }
      return;
    }
    await validateDirectoryPath(
      this.request.repositoryRoot,
      repositoryRelativePath(parts.join("/")),
    );
  }

  private async captureFile(path: RepositoryRelativePath): Promise<PhysicalCapture> {
    const prior = this.physical.get(path);
    if (prior !== undefined) return prior;
    this.registerPath(path);
    const absolutePath = repoAbsolute(this.request.repositoryRoot, path);
    await this.validateDirectoryChain(path);
    const before = await lstatRequired(this.request.repositoryRoot, absolutePath);
    if (!before.isFile() || before.isSymbolicLink()) {
      fail({ code: "unsupported-entry", path });
    }
    const noFollow = process.platform === "win32" ? 0 : (constants.O_NOFOLLOW ?? 0);
    let handle: Awaited<ReturnType<typeof open>> | undefined;
    try {
      handle = await open(absolutePath, constants.O_RDONLY | noFollow);
      const opened = await handle.stat({ bigint: true });
      if (!opened.isFile() || opened.isSymbolicLink() || !sameStableStat(before, opened)) {
        fail({ code: "covered-mutation", path });
      }
      const bytes = await handle.readFile();
      const afterRead = await handle.stat({ bigint: true });
      if (!sameStableStat(opened, afterRead)) fail({ code: "covered-mutation", path });
      if (opened.size > BigInt(Number.MAX_SAFE_INTEGER)) {
        fail({ code: "unsupported-entry", path });
      }
      const byteLength = Number(opened.size);
      if (bytes.byteLength !== byteLength) fail({ code: "covered-mutation", path });
      const afterPath = await lstatRequired(this.request.repositoryRoot, absolutePath);
      if (!sameStableStat(opened, afterPath)) fail({ code: "covered-mutation", path });
      const capture = Object.freeze({
        row: frozenRow({
          path,
          kind: "regular-file",
          byteLength,
          sha256: sha256Raw(bytes),
        }),
        witness: raceWitness(opened),
        ...(this.retainBytes ? { bytes: Uint8Array.from(bytes) } : {}),
      });
      this.physical.set(path, capture);
      return capture;
    } catch (error) {
      if (error instanceof CaptureFailure) throw error;
      return fsFailure(this.request.repositoryRoot, absolutePath, error);
    } finally {
      await handle?.close().catch(() => undefined);
    }
  }

  async captureExactFile(path: RepositoryRelativePath): Promise<PhysicalCapture> {
    return await this.captureFile(path);
  }

  private async readDirectoryNames(
    path: RepositoryRelativePath,
  ): Promise<readonly string[]> {
    const absolutePath = repoAbsolute(this.request.repositoryRoot, path);
    let rawNames: readonly Uint8Array[];
    try {
      rawNames = await readdir(absolutePath, { encoding: "buffer" }) as unknown as readonly Uint8Array[];
    } catch (error) {
      return fsFailure(this.request.repositoryRoot, absolutePath, error);
    }
    const ordered = [...rawNames].sort((left, right) =>
      Buffer.compare(Buffer.from(left), Buffer.from(right))
    );
    const names: string[] = [];
    let priorRaw: Uint8Array | undefined;
    for (const raw of ordered) {
      if (priorRaw !== undefined && Buffer.from(priorRaw).equals(Buffer.from(raw))) {
        fail({ code: "ambiguous-input", paths: Object.freeze([path]) });
      }
      priorRaw = raw;
      names.push(decodeDirectoryName(raw));
    }
    return names;
  }

  private async walkTree(
    root: RepositoryRelativePath,
    rows: Map<RepositoryRelativePath, ByteManifestRow>,
    common: boolean,
  ): Promise<void> {
    this.registerPath(root);
    await this.validateDirectoryChain(repositoryRelativePath(`${root}/.__directory_probe__`));
    const rootAbsolute = repoAbsolute(this.request.repositoryRoot, root);
    const rootStat = await lstatRequired(this.request.repositoryRoot, rootAbsolute);
    if (!rootStat.isDirectory() || rootStat.isSymbolicLink()) {
      fail({ code: "unsupported-entry", path: root });
    }
    const visit = async (directory: RepositoryRelativePath): Promise<void> => {
      for (const name of await this.readDirectoryNames(directory)) {
        const path = repositoryRelativePath(`${directory}/${name}`);
        this.registerPath(path);
        const absolutePath = repoAbsolute(this.request.repositoryRoot, path);
        const stat = await lstatRequired(this.request.repositoryRoot, absolutePath);
        if (common && exclusionSet.has(path)) {
          if (stat.isDirectory() && !stat.isSymbolicLink()) await visit(path);
          continue;
        }
        if (stat.isDirectory() && !stat.isSymbolicLink()) {
          await visit(path);
          continue;
        }
        if (!stat.isFile() || stat.isSymbolicLink()) {
          fail({ code: "unsupported-entry", path });
        }
        const captured = await this.captureFile(path);
        rows.set(path, captured.row);
      }
    };
    await visit(root);
  }

  async scan(): Promise<ScanCapture> {
    for (const root of [...REPOSITORY_RECURSIVE_ROOTS].sort(compareUtf8Paths)) {
      await this.walkTree(root, this.repositoryRows, true);
    }
    for (const path of [...REPOSITORY_EXACT_FILES].sort(compareUtf8Paths)) {
      const captured = await this.captureFile(path);
      this.repositoryRows.set(path, captured.row);
    }
    const repository = digestByteManifest("repository", [...this.repositoryRows.values()]);
    const domains: ByteManifest[] = [];
    for (const domain of this.request.domains) {
      const rows = new Map<RepositoryRelativePath, ByteManifestRow>();
      for (const root of domain.recursiveRoots) {
        const whollyCommon = REPOSITORY_RECURSIVE_ROOTS.some((commonRoot) =>
          pathContains(commonRoot, root)
        );
        if (!whollyCommon) await this.walkTree(root, rows, false);
      }
      for (const path of domain.exactFiles) {
        const common = this.repositoryRows.get(path);
        if (common !== undefined) continue;
        const captured = await this.captureFile(path);
        rows.set(path, captured.row);
      }
      for (const path of this.repositoryRows.keys()) rows.delete(path);
      domains.push(digestByteManifest(domain.manifestDomain, [...rows.values()]));
    }
    const bytes = new Map<RepositoryRelativePath, Uint8Array>();
    const witnesses = new Map<RepositoryRelativePath, RaceWitness>();
    for (const [path, captured] of this.physical) witnesses.set(path, captured.witness);
    if (this.retainBytes) {
      for (const [path, captured] of this.physical) {
        if (captured.bytes === undefined) throw new Error("retained scan omitted bytes");
        bytes.set(path, Uint8Array.from(captured.bytes));
      }
    }
    return Object.freeze({
      repository,
      domains: Object.freeze(domains),
      bytes,
      witnesses,
    });
  }
}

async function scanOnce(request: PreparedRequest, retainBytes: boolean): Promise<ScanCapture> {
  return await new ScanBuilder(request, retainBytes).scan();
}

function scanFingerprint(scan: ScanCapture): string {
  return JSON.stringify([
    "fenel.stable-byte-capture.v1",
    canonicalManifestValue(scan.repository.domain, scan.repository.rows),
    [...scan.domains]
      .sort((left, right) => Buffer.compare(Buffer.from(left.domain), Buffer.from(right.domain)))
      .map((manifest) => canonicalManifestValue(manifest.domain, manifest.rows)),
  ]);
}

function defaultWatchFactory(
  repositoryRoot: string,
  handlers: ArtifactByteWatcherHandlers,
): ArtifactByteWatcher {
  let watcher: FSWatcher;
  try {
    watcher = watch(
      repositoryRoot,
      { recursive: true, encoding: "buffer", persistent: false },
      (eventType, filename) => handlers.event(eventType, filename),
    );
  } catch (error) {
    handlers.error(error);
    throw error;
  }
  watcher.on("error", handlers.error);
  let closed = false;
  return Object.freeze({
    close: async (): Promise<void> => {
      if (closed) return;
      closed = true;
      await new Promise<void>((settle) => {
        watcher.once("close", settle);
        watcher.close();
      });
    },
  });
}

async function defaultCreateSentinel(absolutePath: string, payload: Uint8Array): Promise<void> {
  const handle = await open(absolutePath, "wx");
  try {
    await handle.writeFile(payload);
    await handle.sync();
  } finally {
    await handle.close();
  }
}

async function defaultDrainWatcher(): Promise<void> {
  await new Promise<void>((settle) => setImmediate(settle));
  await new Promise<void>((settle) => setImmediate(settle));
}

interface ResolvedTestDependencies {
  readonly watchFactory: NonNullable<ArtifactBytesTestDependencies["watchFactory"]>;
  readonly createSentinel: NonNullable<ArtifactBytesTestDependencies["createSentinel"]>;
  readonly removeSentinel: NonNullable<ArtifactBytesTestDependencies["removeSentinel"]>;
  readonly nonce: NonNullable<ArtifactBytesTestDependencies["nonce"]>;
  readonly afterScan: NonNullable<ArtifactBytesTestDependencies["afterScan"]>;
  readonly drainWatcher: NonNullable<ArtifactBytesTestDependencies["drainWatcher"]>;
  readonly reportDismissedChangeEvents: NonNullable<
    ArtifactBytesTestDependencies["reportDismissedChangeEvents"]
  >;
  readonly sentinelTimeoutMs: number;
}

function resolvedDependencies(
  dependencies: ArtifactBytesTestDependencies,
): ResolvedTestDependencies {
  return Object.freeze({
    watchFactory: dependencies.watchFactory ?? defaultWatchFactory,
    createSentinel: dependencies.createSentinel ?? defaultCreateSentinel,
    removeSentinel: dependencies.removeSentinel ?? unlink,
    nonce: dependencies.nonce ?? (() => randomBytes(16).toString("hex")),
    afterScan: dependencies.afterScan ?? (() => undefined),
    drainWatcher: dependencies.drainWatcher ?? defaultDrainWatcher,
    reportDismissedChangeEvents: dependencies.reportDismissedChangeEvents ?? ((events) => {
      if (events.length !== 0) {
        console.error(`[artifact-bytes] dismissed corroborated covered change events ${JSON.stringify(
          events.map(({ path, count }) => ({ path, count })),
        )}`);
      }
    }),
    sentinelTimeoutMs: dependencies.sentinelTimeoutMs ?? 5_000,
  });
}

async function deepestCoveredDirectory(request: PreparedRequest): Promise<RepositoryRelativePath> {
  let deepest = REPOSITORY_RECURSIVE_ROOTS[0]!;
  const folded = new Map<string, RepositoryRelativePath>();
  const depth = (path: RepositoryRelativePath): number => path.split("/").length;
  const register = (path: RepositoryRelativePath): void => {
    const key = caseKey(path);
    const prior = folded.get(key);
    if (prior !== undefined && prior !== path) {
      fail({ code: "ambiguous-input", paths: Object.freeze([prior, path]) });
    }
    folded.set(key, path);
  };
  const visit = async (directory: RepositoryRelativePath): Promise<void> => {
    register(directory);
    const absolutePath = repoAbsolute(request.repositoryRoot, directory);
    const stat = await lstatRequired(request.repositoryRoot, absolutePath);
    if (!stat.isDirectory() || stat.isSymbolicLink()) {
      fail({ code: "unsupported-entry", path: directory });
    }
    if (
      depth(directory) > depth(deepest)
      || (depth(directory) === depth(deepest) && compareUtf8Paths(directory, deepest) < 0)
    ) {
      deepest = directory;
    }
    let names: readonly Uint8Array[];
    try {
      names = await readdir(absolutePath, { encoding: "buffer" }) as unknown as readonly Uint8Array[];
    } catch (error) {
      return fsFailure(request.repositoryRoot, absolutePath, error);
    }
    const ordered = [...names].sort((left, right) => Buffer.compare(Buffer.from(left), Buffer.from(right)));
    for (const raw of ordered) {
      const name = decodeDirectoryName(raw);
      const child = repositoryRelativePath(`${directory}/${name}`);
      register(child);
      const childAbsolute = repoAbsolute(request.repositoryRoot, child);
      const childStat = await lstatRequired(request.repositoryRoot, childAbsolute);
      if (exclusionSet.has(child)) {
        if (childStat.isDirectory() && !childStat.isSymbolicLink()) await visit(child);
        continue;
      }
      if (childStat.isSymbolicLink()) fail({ code: "unsupported-entry", path: child });
      if (childStat.isDirectory()) await visit(child);
      else if (!childStat.isFile()) fail({ code: "unsupported-entry", path: child });
    }
  };
  for (const root of REPOSITORY_RECURSIVE_ROOTS) {
    await validateDirectoryPath(request.repositoryRoot, root);
    await visit(root);
  }
  return deepest;
}

function watcherPath(filename: string | Uint8Array | null): RepositoryRelativePath {
  if (filename === null) fail({ code: "watcher-loss" });
  let decoded: string;
  try {
    decoded = typeof filename === "string" ? filename : strictUtf8.decode(filename);
  } catch {
    fail({ code: "watcher-loss" });
  }
  if (process.platform === "win32") decoded = decoded.replaceAll("\\", "/");
  try {
    return repositoryRelativePath(decoded);
  } catch {
    fail({ code: "watcher-loss" });
  }
}

function waitForWatcherSequence(
  eventSequences: ReadonlyMap<RepositoryRelativePath, number>,
  path: RepositoryRelativePath,
  afterSequence: number,
  getFailure: () => CaptureIssue | undefined,
  timeoutMs: number,
): Promise<void> {
  return new Promise<void>((settle, reject) => {
    const started = Date.now();
    const poll = (): void => {
      const issue = getFailure();
      if (issue !== undefined) {
        reject(new CaptureFailure(issue));
        return;
      }
      if ((eventSequences.get(path) ?? 0) > afterSequence) {
        settle();
        return;
      }
      if (Date.now() - started >= timeoutMs) {
        reject(new CaptureFailure({ code: "watcher-unsupported" }));
        return;
      }
      setTimeout(poll, Math.min(10, timeoutMs));
    };
    poll();
  });
}

async function verifyRecursiveWatcher(
  request: PreparedRequest,
  dependencies: ResolvedTestDependencies,
): Promise<void> {
  const sentinelDirectory = await deepestCoveredDirectory(request);
  let sentinelName: string;
  try {
    sentinelName = portableSegment(`.fenel-m3b-watch-${process.pid}-${dependencies.nonce()}.sentinel`);
  } catch {
    fail({ code: "canonicalization-failed" });
  }
  const sentinelPath = repositoryRelativePath(`${sentinelDirectory}/${sentinelName}`);
  const sentinelAbsolute = repoAbsolute(request.repositoryRoot, sentinelPath);
  const events = new Map<RepositoryRelativePath, number>();
  let sequence = 0;
  let watcherFailure: CaptureIssue | undefined;
  let watcher: ArtifactByteWatcher;
  try {
    watcher = dependencies.watchFactory(request.repositoryRoot, {
      event: (_eventType, filename) => {
        try {
          const path = watcherPath(filename);
          sequence += 1;
          events.set(path, sequence);
        } catch (error) {
          watcherFailure = error instanceof CaptureFailure ? error.issue : { code: "watcher-loss" };
        }
      },
      error: () => {
        watcherFailure = { code: "watcher-error" };
      },
    });
  } catch {
    fail({ code: "watcher-unsupported" });
  }
  let owned = false;
  let removed = false;
  try {
    const beforeCreate = sequence;
    try {
      await dependencies.createSentinel(
        sentinelAbsolute,
        Buffer.from(`fenel watcher sentinel ${sentinelName}\n`, "utf8"),
      );
      owned = true;
    } catch (error) {
      const code = typeof error === "object" && error !== null && "code" in error
        ? String((error as { code?: unknown }).code)
        : "";
      if (code === "EEXIST") fail({ code: "ambiguous-input", paths: Object.freeze([sentinelPath]) });
      return fsFailure(request.repositoryRoot, sentinelAbsolute, error);
    }
    await waitForWatcherSequence(
      events,
      sentinelPath,
      beforeCreate,
      () => watcherFailure,
      dependencies.sentinelTimeoutMs,
    );
    const beforeDelete = sequence;
    try {
      await dependencies.removeSentinel(sentinelAbsolute);
      removed = true;
    } catch (error) {
      return fsFailure(request.repositoryRoot, sentinelAbsolute, error);
    }
    await waitForWatcherSequence(
      events,
      sentinelPath,
      beforeDelete,
      () => watcherFailure,
      dependencies.sentinelTimeoutMs,
    );
    // Windows may deliver ancestor-directory notifications after the exact
    // deletion notification. Keep the disposable watcher alive until those
    // queued notifications drain; otherwise a newly armed watcher can observe
    // the sentinel's directory-metadata tail as if it were an outside writer.
    await dependencies.drainWatcher();
    if (watcherFailure !== undefined) fail(watcherFailure);
  } finally {
    if (owned && !removed) await dependencies.removeSentinel(sentinelAbsolute).catch(() => undefined);
    try {
      await watcher.close();
    } catch {
      fail({ code: "watcher-error" });
    }
  }
}

function eventIntersectsPath(
  eventPath: RepositoryRelativePath,
  selectedPath: RepositoryRelativePath,
): boolean {
  return pathContains(eventPath, selectedPath) || pathContains(selectedPath, eventPath);
}

function eventIsCovered(
  request: PreparedRequest,
  eventPath: RepositoryRelativePath,
): boolean {
  // Bun/ReadDirectoryChangesW reports access metadata as `change` while this
  // scanner reads a subtree, and may coalesce ordinary filesystem events.
  // The event stream is therefore corroborating rather than complete: every
  // covered file `change` must reproduce a B row after close, while `rename`
  // fails. Verified ordinary-directory metadata is outside byte identity.
  for (const root of REPOSITORY_RECURSIVE_ROOTS) {
    if (eventIntersectsPath(eventPath, root)) {
      if (exclusionSet.has(eventPath)) continue;
      return true;
    }
  }
  for (const path of REPOSITORY_EXACT_FILES) {
    if (eventIntersectsPath(eventPath, path)) return true;
  }
  for (const domain of request.domains) {
    for (const path of domain.exactFiles) {
      if (eventIntersectsPath(eventPath, path)) return true;
    }
    for (const root of domain.recursiveRoots) {
      if (eventIntersectsPath(eventPath, root)) return true;
    }
  }
  return false;
}

function firstWitnessMismatch(
  first: ScanCapture,
  second: ScanCapture,
): RepositoryRelativePath | undefined {
  const paths = new Set<RepositoryRelativePath>([
    ...first.witnesses.keys(),
    ...second.witnesses.keys(),
  ]);
  for (const path of [...paths].sort(compareUtf8Paths)) {
    const left = first.witnesses.get(path);
    const right = second.witnesses.get(path);
    if (left === undefined || right === undefined || !sameRaceWitness(left, right)) return path;
  }
  return undefined;
}

async function isDirectoryMetadataChange(
  request: PreparedRequest,
  path: RepositoryRelativePath,
): Promise<boolean> {
  try {
    const stat = await lstat(repoAbsolute(request.repositoryRoot, path), { bigint: true });
    return stat.isDirectory() && !stat.isSymbolicLink();
  } catch {
    return false;
  }
}

async function corroborateChangeEvent(
  request: PreparedRequest,
  second: ScanCapture,
  path: RepositoryRelativePath,
): Promise<void> {
  const expectedBytes = second.bytes.get(path);
  const expectedWitness = second.witnesses.get(path);
  if (expectedBytes === undefined || expectedWitness === undefined) {
    fail({ code: "covered-mutation", path });
  }
  let observed: PhysicalCapture;
  try {
    observed = await new ScanBuilder(request, true).captureExactFile(path);
  } catch {
    fail({ code: "covered-mutation", path });
  }
  if (
    observed.bytes === undefined
    || !Buffer.from(observed.bytes).equals(Buffer.from(expectedBytes))
    || !sameRaceWitness(observed.witness, expectedWitness)
  ) {
    fail({ code: "covered-mutation", path });
  }
}

class ImmutableCapturedByteStore implements CapturedByteStore {
  readonly paths: readonly RepositoryRelativePath[];
  readonly #bytes: ReadonlyMap<RepositoryRelativePath, Uint8Array>;

  constructor(bytes: ReadonlyMap<RepositoryRelativePath, Uint8Array>) {
    const cloned = new Map<RepositoryRelativePath, Uint8Array>();
    for (const [path, value] of bytes) cloned.set(path, Uint8Array.from(value));
    this.#bytes = cloned;
    this.paths = Object.freeze([...cloned.keys()].sort(compareUtf8Paths));
    Object.freeze(this);
  }

  has(path: RepositoryRelativePath): boolean {
    return this.#bytes.has(path);
  }

  read(path: RepositoryRelativePath): Uint8Array {
    const bytes = this.#bytes.get(path);
    if (bytes === undefined) throw new RangeError(`captured path is absent: ${path}`);
    return Uint8Array.from(bytes);
  }
}

export async function captureStableEpoch(
  request: StableEpochRequest,
  testDependencies: ArtifactBytesTestDependencies = {},
): Promise<CaptureResult> {
  try {
    const prepared = prepareRequest(request);
    const dependencies = resolvedDependencies(testDependencies);
    await verifyRecursiveWatcher(prepared, dependencies);
    // Do not let delayed directory-metadata delivery from the disposable
    // sentinel watcher contaminate the freshly armed A/B watcher on Windows.
    await dependencies.drainWatcher();

    let watcherFailure: CaptureIssue | undefined;
    const watcherEvents: Array<{
      readonly eventType: "rename" | "change";
      readonly path: RepositoryRelativePath;
    }> = [];
    let watcher: ArtifactByteWatcher;
    try {
      watcher = dependencies.watchFactory(prepared.repositoryRoot, {
        event: (eventType, filename) => {
          try {
            const path = watcherPath(filename);
            watcherEvents.push(Object.freeze({ eventType, path }));
          } catch (error) {
            watcherFailure = error instanceof CaptureFailure ? error.issue : { code: "watcher-loss" };
          }
        },
        error: () => {
          watcherFailure = { code: "watcher-error" };
        },
      });
    } catch {
      fail({ code: "watcher-unsupported" });
    }

    let first: ScanCapture;
    let second: ScanCapture;
    try {
      first = await scanOnce(prepared, false);
      await dependencies.afterScan("A");
      second = await scanOnce(prepared, true);
      await dependencies.afterScan("B");
      await dependencies.drainWatcher();
    } finally {
      try {
        await watcher.close();
      } catch {
        watcherFailure = { code: "watcher-error" };
      }
    }
    if (watcherFailure !== undefined) fail(watcherFailure);
    if (scanFingerprint(first) !== scanFingerprint(second)) fail({ code: "scan-mismatch" });
    const witnessMismatch = firstWitnessMismatch(first, second);
    if (witnessMismatch !== undefined) {
      fail({ code: "covered-mutation", path: witnessMismatch });
    }

    const changeCounts = new Map<RepositoryRelativePath, number>();
    for (const event of watcherEvents) {
      if (!eventIsCovered(prepared, event.path)) continue;
      if (event.eventType === "rename") {
        fail({ code: "covered-mutation", path: event.path });
      }
      // Directory access metadata is not a byte-manifest row and may be
      // produced by the scanner itself on Windows. A non-row file/missing/link
      // path is never suppressible: corroboration below will fail without B
      // bytes and a B witness.
      if (
        !second.witnesses.has(event.path)
        && await isDirectoryMetadataChange(prepared, event.path)
      ) {
        continue;
      }
      changeCounts.set(event.path, (changeCounts.get(event.path) ?? 0) + 1);
    }
    const dismissedChangeEvents = Object.freeze(
      [...changeCounts]
        .sort(([left], [right]) => compareUtf8Paths(left, right))
        .map(([path, count]) => Object.freeze({ path, count })),
    );
    for (const { path } of dismissedChangeEvents) {
      await corroborateChangeEvent(prepared, second, path);
    }
    dependencies.reportDismissedChangeEvents(dismissedChangeEvents);

    const bytes = new ImmutableCapturedByteStore(second.bytes);
    return {
      ok: true,
      value: Object.freeze({
        repositoryEpoch: second.repository.digest,
        repository: second.repository,
        domains: second.domains,
        bytes,
        dismissedChangeEvents,
      }),
    };
  } catch (error) {
    if (error instanceof CaptureFailure) return { ok: false, issue: error.issue };
    if (error instanceof TypeError) return { ok: false, issue: { code: "canonicalization-failed" } };
    return { ok: false, issue: { code: "unreadable-input" } };
  }
}
