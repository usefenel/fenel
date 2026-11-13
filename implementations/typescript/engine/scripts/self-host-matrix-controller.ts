/**
 * Public, import-inert controller for the self-host matrix.
 *
 * The internal worker executes only after this controller has captured and
 * materialized an owned source package.  Required-v1 repair reproduces two
 * guarded private renders from one capture, audits their wires, seals one
 * candidate, rechecks the live capture, and publishes atomically once.
 */

import { randomBytes } from "node:crypto";
import {
  closeSync,
  constants,
  existsSync,
  fstatSync,
  fsyncSync,
  lstatSync,
  mkdirSync,
  openSync,
  readFileSync,
  readdirSync,
  realpathSync,
  renameSync,
  rmSync,
  unlinkSync,
  watch,
  writeFileSync,
  writeSync,
  type BigIntStats,
} from "node:fs";
import { builtinModules } from "node:module";
import {
  dirname,
  extname,
  isAbsolute,
  join,
  posix,
  relative,
  resolve,
  sep,
} from "node:path";
import { spawnSync } from "node:child_process";
import {
  compareUtf8Paths,
  digestByteManifest,
  parseSha256Hex,
  repositoryRelativePath,
  sha256Raw,
  type ArtifactByteWatcher,
  type ArtifactByteWatcherHandlers,
  type ByteManifest,
  type ByteManifestRow,
  type DismissedChangeEvent,
  type RepositoryRelativePath,
  type Sha256Hex,
} from "./lib/artifact-bytes";
import {
  decodeArtifactToolchainManifest,
  osFamilyFromPlatform,
  selectBunToolchain,
} from "./lib/compiled-artifact-toolchain";
import { acquireCompiledArtifactEnvironment } from "./lib/compiled-artifact-environment";
import {
  coldResolveEmptyCompiledArtifactDependencies,
  proveEmptyCompiledArtifactDependencies,
} from "./lib/compiled-artifact-dependencies";
import {
  censusSourceAcquisitions,
  type ComputedFileAcquisitionObservation,
  type DynamicCodeConstructorObservation,
  type HostSensitiveOperationKind,
  type IdentifierObservation,
  type MemberAccessObservation,
  type SourceAcquisitionCensusOptions,
} from "./lib/compiled-artifact-acquisition";
import {
  compareUtf8,
  encodeCanonicalJson,
  expectClosedKeys,
  expectGitOid,
  expectNonEmptyWireString,
  expectSafeUint,
  expectSha256,
  expectWireArray,
  expectWireLiteral,
  expectWireRecord,
  expectWireString,
  parseCanonicalJson,
} from "./lib/artifact-wire-json";
import {
  CURRENT_SELF_HOST_MATRIX_MODE,
  LEGACY_STAMPLESS_TOMBSTONE_DIGEST,
  MATRIX_NO_FAILURE_DIGEST,
  SELF_HOST_MATRIX_CERTIFICATE_HELPER_PATH,
  SELF_HOST_MATRIX_CONTROLLER_PATH,
  SELF_HOST_MATRIX_EXACT_INPUTS,
  SELF_HOST_MATRIX_GENERATOR_PATH,
  SELF_HOST_MATRIX_PATH,
  SELF_HOST_MATRIX_RECURSIVE_ROOTS,
  SELF_HOST_MATRIX_TOOLCHAIN_MANIFEST_PATH,
  UNAVAILABLE_MATRIX_IDENTITY_DIGEST,
  MatrixCertificateError,
  MatrixCliError,
  assertMatrixCandidateEqualsCommitted,
  computeMatrixPackageDigest,
  encodeMatrixControllerReceipt,
  evaluateMatrixState,
  makeMatrixControllerReceipt,
  makeMatrixEnvironmentCertificate,
  makeMatrixInputsCertificate,
  makeMatrixLeg,
  matrixStampFor,
  matrixFailureDigest,
  matrixArtifactIdentity,
  normalizeMatrixControllerArgs,
  parseMatrixControllerReceipt,
  parseMatrixDocument,
  insertMatrixStamp,
  replaceMatrixPresentation,
  type MatrixArtifactIdentity,
  type MatrixControllerReceipt,
  type MatrixDecision,
  type MatrixDocumentObservation,
  type MatrixEnvironmentCertificate,
  type MatrixInputsCertificate,
  type MatrixLeg,
  type MatrixMode,
  type MatrixReceiptOperation,
  type MatrixRelationEvidence,
  type MatrixResult,
} from "./lib/self-host-matrix-certificate";

const MATRIX_SNAPSHOT_ROOT = ".tmp-m3b-snapshots" as const;
const MATRIX_SNAPSHOT_MARKER = ".fenel-m3b-matrix-owner.json" as const;
const MATRIX_WORKER_GUARD_PATH = ".m3b-matrix-worker-preload.ts" as const;
const MATRIX_WORKER_GUARD_TRACE_PATH = ".m3b-matrix-worker-guard.jsonl" as const;
const MATRIX_WORKER_MANIFEST_PATH = ".m3b-matrix-worker-manifest.json" as const;
const MATRIX_WORKER_REQUEST_PATH = ".m4-matrix-worker-request.json" as const;
const MATRIX_WORKER_REQUEST_SCHEMA = "fenel.self-host-matrix-worker-request.v1" as const;
const MATRIX_WORKER_AUTHORIZATION_SCHEMA =
  "fenel.self-host-matrix-worker-authorization.v1" as const;
const MATRIX_REPORT_SOURCE_PATH = repositoryRelativePath(
  "implementations/typescript/engine/scripts/self-host-matrix-report.fenel",
);
const MATRIX_REPORT_SMOKE_OUTPUT_PATH = ".m4-private/report-smoke.json" as const;
const MATRIX_REPORT_CANDIDATE_OUTPUT_PATH = ".m4-private/candidate.md" as const;
const MATRIX_REPORT_RAW_FACETS_OUTPUT_PATH = ".m4-private/raw-facets.json" as const;
const MATRIX_REPORT_AUDIT_OUTPUT_PATH = ".m4-private/audit.json" as const;
const MATRIX_REPORT_RAW_FACETS_SCHEMA = "fenel.self-host-matrix-raw-facets.v1" as const;
const MATRIX_REPORT_AUDIT_SCHEMA = "fenel.self-host-matrix-report-audit.v1" as const;
const MATRIX_CATEGORY_PREIMAGE_PREFIX = "fenel.self-host-matrix.category.v1\n" as const;
const MATRIX_TAG_PREIMAGE_PREFIX = "fenel.self-host-matrix.tags.v1\n" as const;
const MATRIX_EXPECTED_ROSTER_COUNT = 41 as const;
const MATRIX_EXPECTED_GROUPING_FACTS = Object.freeze([
  Object.freeze({ fnId: "engine:llvmDomainToValType", area: "engine: LLVM helper" }),
  Object.freeze({ fnId: "std:.", area: "std:function" }),
] as const);
const MATRIX_REPORT_SMOKE_REQUEST_BYTES = encodeCanonicalJson(Object.freeze({
  schema: MATRIX_WORKER_REQUEST_SCHEMA,
  task: "report-smoke",
  reportSource: MATRIX_REPORT_SOURCE_PATH,
  outputs: Object.freeze({ smoke: MATRIX_REPORT_SMOKE_OUTPUT_PATH }),
}));
const MATRIX_REPORT_SMOKE_OUTPUT_BYTES = encodeCanonicalJson(Object.freeze({
  bootDeficitDelta: 0,
  loadDepthBefore: 0,
  provenanceDelta: Object.freeze({ fenel: 1, ts: 0 }),
  result: "matrix-report-isolated-v1",
  schema: "fenel.self-host-matrix-report-smoke.v1",
}));
const MATRIX_DEPENDENCY_MANIFEST_NAME = "manifest.json" as const;
const ROOT_PACKAGE_PATH = repositoryRelativePath("package.json");
const BUN_LOCK_PATH = repositoryRelativePath("bun.lock");
const ENGINE_PACKAGE_PATH = repositoryRelativePath("implementations/typescript/engine/package.json");
const MATRIX_JS_CLASSIFIER_PATH = repositoryRelativePath(
  "implementations/typescript/engine/src/compile-js-self-host-classifier.ts",
);
const MATRIX_JS_CONSTRUCTOR_EXPRESSION = 'new Function("$fenel", `return ${serialised._0};`)(runtime)';
const MATRIX_JS_CONSTRUCTOR_STATEMENT = MATRIX_JS_CONSTRUCTOR_EXPRESSION;
const SOURCE_EXTENSIONS = Object.freeze([
  ".cjs", ".cts", ".js", ".jsx", ".json", ".mjs", ".mts", ".ts", ".tsx",
] as const);
const ALL_RUNTIME_BUILTINS = new Set([
  ...builtinModules,
  ...builtinModules.map((name) => `node:${name}`),
  "bun:ffi",
  "bun:sqlite",
]);
const MATRIX_SOURCE_RUNTIME_BUILTINS = new Set([
  "bun:ffi",
  "node:child_process",
  "node:crypto",
  "node:fs",
  "node:os",
  "node:path",
  "node:url",
  "node:util",
]);
const MATRIX_GUARD_RUNTIME_BUILTINS = new Set([
  ...MATRIX_SOURCE_RUNTIME_BUILTINS,
  "node:dgram",
  "node:dns",
  "node:dns/promises",
  "node:fs/promises",
  "node:http",
  "node:http2",
  "node:https",
  "node:module",
  "node:net",
  "node:tls",
]);

type MatrixSourceBuiltinGrant = {
  readonly specifier: string;
  readonly declaration: string;
  readonly expectedCount: number;
};

const MATRIX_GENERATOR_PATH_DECLARATION =
  'import { basename, dirname, isAbsolute, normalize, resolve } from "node:path";' as const;
const MATRIX_GENERATOR_CRYPTO_DECLARATION =
  'import { createHash } from "node:crypto";' as const;
const MATRIX_GENERATOR_FS_DECLARATION =
  'const { readFileSync, writeFileSync } = require("node:fs");' as const;

const MATRIX_LLVM_CLASSIFIER_PATH = repositoryRelativePath(
  "implementations/typescript/engine/src/compile-llvm-self-host-classifier.ts",
);
const MATRIX_SOURCE_BUILTIN_GRANTS: ReadonlyMap<RepositoryRelativePath, readonly MatrixSourceBuiltinGrant[]> =
  new Map<RepositoryRelativePath, readonly MatrixSourceBuiltinGrant[]>([
    [repositoryRelativePath(SELF_HOST_MATRIX_GENERATOR_PATH), Object.freeze([
      Object.freeze({
        specifier: "node:crypto",
        declaration: MATRIX_GENERATOR_CRYPTO_DECLARATION,
        expectedCount: 1,
      }),
      Object.freeze({
        specifier: "node:fs",
        declaration: MATRIX_GENERATOR_FS_DECLARATION,
        expectedCount: 1,
      }),
      Object.freeze({
        specifier: "node:path",
        declaration: MATRIX_GENERATOR_PATH_DECLARATION,
        expectedCount: 1,
      }),
    ])],
    [MATRIX_LLVM_CLASSIFIER_PATH, Object.freeze([
      Object.freeze({ specifier: "node:fs", declaration: 'import * as fs from "node:fs";', expectedCount: 1 }),
      Object.freeze({ specifier: "node:os", declaration: 'import * as os from "node:os";', expectedCount: 1 }),
      Object.freeze({ specifier: "node:path", declaration: 'import * as path from "node:path";', expectedCount: 1 }),
      Object.freeze({ specifier: "node:url", declaration: 'import { fileURLToPath } from "node:url";', expectedCount: 1 }),
      Object.freeze({
        specifier: "bun:ffi",
        declaration: 'const ffi = HAS_CLANG ? await import("bun:ffi") : undefined;',
        expectedCount: 1,
      }),
    ])],
    [repositoryRelativePath("fenel/modules/crypto/ffi/crypto-ffi.ts"), Object.freeze([
      Object.freeze({
        specifier: "node:crypto",
        declaration:
          'const { randomBytes, scryptSync, timingSafeEqual } = require("node:crypto") as typeof import("node:crypto");',
        expectedCount: 1,
      }),
    ])],
    [repositoryRelativePath("implementations/typescript/engine/src/engine-bodies-dispatch.ts"), Object.freeze([
      Object.freeze({
        specifier: "node:crypto",
        declaration: 'const { createHash } = require("node:crypto") as typeof import("node:crypto");',
        expectedCount: 6,
      }),
    Object.freeze({
      specifier: "node:util",
      declaration: 'const candidate = (require("node:util") as typeof import("node:util")).types.isProxy;',
      expectedCount: 1,
    }),
    ])],
  ]);
const MATRIX_LLVM_SHAPE_ONLY_TCB_PINS = Object.freeze([
  Object.freeze({ object: "os", member: "tmpdir", expectedCount: 1 }),
  Object.freeze({ object: "fs", member: "mkdtempSync", expectedCount: 1 }),
  Object.freeze({ object: "fs", member: "writeFileSync", expectedCount: 3 }),
  Object.freeze({ object: "fs", member: "rmSync", expectedCount: 1 }),
  Object.freeze({ object: "process", member: "platform", expectedCount: 3 }),
] as const);
const MATRIX_LLVM_NAMESPACE_IDENTIFIER_PINS = Object.freeze([
  Object.freeze({ identifier: "ffi", expectedCount: 3 }),
  Object.freeze({ identifier: "fs", expectedCount: 6 }),
  Object.freeze({ identifier: "os", expectedCount: 2 }),
  Object.freeze({ identifier: "process", expectedCount: 6 }),
] as const);

type MatrixHostSensitivityPin = {
  readonly path: RepositoryRelativePath;
  readonly kind: HostSensitiveOperationKind;
  readonly expectedCount: number;
};

const MATRIX_HOST_SENSITIVITY_PINS: readonly MatrixHostSensitivityPin[] = Object.freeze([
  Object.freeze({ path: repositoryRelativePath("fenel/modules/crypto/ffi/crypto-ffi.ts"), kind: "randomness", expectedCount: 6 }),
  Object.freeze({ path: repositoryRelativePath("fenel/modules/dispatch/ffi/dispatch-ffi.ts"), kind: "current-time", expectedCount: 1 }),
  Object.freeze({ path: repositoryRelativePath("fenel/modules/std/ffi/std-ffi.ts"), kind: "current-time", expectedCount: 1 }),
  Object.freeze({ path: repositoryRelativePath("fenel/modules/std/ffi/std-ffi.ts"), kind: "locale-format", expectedCount: 2 }),
  Object.freeze({ path: repositoryRelativePath("fenel/modules/time/ffi/time-ffi.ts"), kind: "current-time", expectedCount: 2 }),
  Object.freeze({ path: MATRIX_JS_CLASSIFIER_PATH, kind: "current-time", expectedCount: 2 }),
  Object.freeze({ path: MATRIX_LLVM_CLASSIFIER_PATH, kind: "absolute-path", expectedCount: 2 }),
  Object.freeze({ path: MATRIX_LLVM_CLASSIFIER_PATH, kind: "platform-architecture", expectedCount: 3 }),
  Object.freeze({ path: repositoryRelativePath("implementations/typescript/engine/src/engine-bodies-dispatch.ts"), kind: "current-time", expectedCount: 2 }),
  // Acquisition already pins the exact Worker/URL consumer, asset and probe;
  // the render guard denies Worker access before its URL argument is evaluated.
  Object.freeze({ path: repositoryRelativePath("implementations/typescript/engine/src/field-identity-worker-client.ts"), kind: "absolute-path", expectedCount: 1 }),
  Object.freeze({ path: repositoryRelativePath("implementations/typescript/engine/src/self-host-classification-cache.ts"), kind: "current-time", expectedCount: 4 }),
]);

export interface CapturedMatrixSource {
  readonly rows: readonly ByteManifestRow[];
  readonly bytes: ReadonlyMap<RepositoryRelativePath, Uint8Array>;
}

export interface CapturedMatrixPackage {
  readonly repositoryRoot: string;
  readonly source: CapturedMatrixSource;
  readonly inputs: MatrixInputsCertificate;
  readonly environment: MatrixEnvironmentCertificate;
  readonly sourceCommit: string;
  readonly verified: string;
  readonly verifiedAtSha: string;
  readonly controllerDigest: Sha256Hex;
  readonly packageDigest: Sha256Hex;
  readonly documentBytes: Uint8Array | null;
  readonly observation: MatrixDocumentObservation | null;
  readonly artifactBefore: MatrixArtifactIdentity;
  readonly workerEnvironment: Readonly<Record<string, string>>;
  readonly toolchainManifestBytes: Uint8Array;
  /** Canonical mechanical projection of the exact non-builtin package closure. */
  readonly dependencyManifestBytes: Uint8Array;
  /** Digest emitted by the static+cold dependency proof, distinct from the row-manifest digest. */
  readonly dependencyProofDigest: Sha256Hex;
  /** Live-capture-only race witnesses; immutable check packages omit these. */
  readonly liveWitnesses?: ReadonlyMap<RepositoryRelativePath, MatrixRaceWitness>;
}

export interface MatrixRenderResult {
  readonly ok: boolean;
  readonly candidateBytes: Uint8Array | null;
  readonly workerStdout: string;
  readonly error: string | null;
  /** Present only after a full controller-issued render wire has closed. */
  readonly evidence?: MatrixRenderEvidence;
}

export interface MatrixRawFacetRow {
  readonly fnId: string;
  readonly categoryPresent: boolean;
  readonly category: string;
  readonly tagsPresent: boolean;
  readonly tags: readonly string[];
}

export interface MatrixRawFacetProjection {
  readonly schema: typeof MATRIX_REPORT_RAW_FACETS_SCHEMA;
  readonly rows: readonly MatrixRawFacetRow[];
}

export interface MatrixReportAudit {
  readonly schema: typeof MATRIX_REPORT_AUDIT_SCHEMA;
  readonly categoryCount: number;
  readonly categoryPreimage: string;
  readonly categoryDigest: Sha256Hex;
  readonly tagCount: number;
  readonly tagPreimage: string;
  readonly tagDigest: Sha256Hex;
  readonly categorizableRepresentativeIds: readonly string[];
  readonly taggableRepresentativeIds: readonly string[];
  readonly rosterCount: number;
  readonly rosterKeys: readonly string[];
  readonly acquisitionKeys: readonly string[];
  readonly rowCount: number;
  readonly declaredObservedAsymmetryCount: number;
  readonly declaredObservedAsymmetries: readonly Readonly<{
    readonly fnId: string;
    readonly target: "js" | "wasm" | "llvm";
    readonly className: "stale-gap" | "silent-skip" | "escaped-fail";
    readonly declared: string;
    readonly observed: string;
  }>[];
  readonly groupingFacts: readonly Readonly<{ readonly fnId: string; readonly area: string }>[];
  readonly reportSourceDigest: Sha256Hex;
}

export interface MatrixRenderEvidence {
  readonly rawFacetBytes: Uint8Array;
  readonly auditBytes: Uint8Array;
  readonly rawFacets: MatrixRawFacetProjection;
  readonly audit: MatrixReportAudit;
  readonly materializationRoot: string;
  readonly workerPid: number;
}

export interface MatrixReportSmokeRun {
  readonly outputBytes: Uint8Array;
  readonly materializationRoot: string;
  readonly workerPid: number;
}

export interface MatrixReportSmokeProof {
  readonly first: MatrixReportSmokeRun;
  readonly second: MatrixReportSmokeRun;
}

interface MatrixWorkerStartWitness {
  readonly materializationRoot: string;
  readonly workerPid: number;
}

export interface MatrixControllerDependencies {
  readonly mode: MatrixMode;
  readonly repositoryRoot: string;
  readonly capture: (input: {
    readonly packagePath: string | null;
    readonly presentation?: {
      readonly sourceCommit: string;
      readonly verified: string;
      readonly verifiedAtSha: string;
    };
  }) => Promise<CapturedMatrixPackage>;
  readonly render: (
    captured: CapturedMatrixPackage,
    input: { readonly progress: boolean; readonly check: boolean },
  ) => Promise<MatrixRenderResult>;
  readonly assertCurrent: (captured: CapturedMatrixPackage) => Promise<void>;
  readonly publish: (
    captured: CapturedMatrixPackage,
    candidateBytes: Uint8Array,
  ) => Promise<Uint8Array>;
  readonly reread: (captured: CapturedMatrixPackage) => Promise<Uint8Array | null>;
  readonly stdout: (bytes: Uint8Array) => void;
  readonly stderr: (message: string) => void;
}

export interface MatrixControllerRunResult {
  readonly exitCode: 0 | 1 | 2 | 20 | 21;
  readonly receipt: MatrixControllerReceipt;
}

export interface MatrixCaptureTestDependencies {
  readonly afterScan?: (phase: "A" | "B") => void | Promise<void>;
  readonly watchFactory?: (
    repositoryRoot: string,
    handlers: ArtifactByteWatcherHandlers,
  ) => ArtifactByteWatcher;
  readonly createSentinel?: (absolutePath: string, payload: Uint8Array) => Promise<void>;
  readonly removeSentinel?: (absolutePath: string) => Promise<void>;
  readonly nonce?: () => string;
  readonly drainWatcher?: () => Promise<void>;
  readonly reportDismissedChangeEvents?: (
    events: readonly DismissedChangeEvent[],
  ) => void;
  readonly watcherTimeoutMs?: number;
  /** Test-only source-commit observation for the final one-capture assertion. */
  readonly sourceCommit?: (repositoryRoot: string) => string;
  /** Test-only replacement for the production pinned-Bun cold proof. */
  readonly verifyColdDependencies?: MatrixColdDependencyVerifier;
}

export interface MatrixColdDependencyVerificationInput {
  readonly repositoryRoot: string;
  readonly source: CapturedMatrixSource;
  readonly toolchainManifestBytes: Uint8Array;
  readonly dependencyManifestBytes: Uint8Array;
  readonly dependencyProofDigest: Sha256Hex;
}

export type MatrixColdDependencyVerifier = (
  input: MatrixColdDependencyVerificationInput,
) => Promise<void>;

interface StableMatrixCapture {
  readonly source: CapturedMatrixSource;
  readonly toolchainManifestBytes: Uint8Array;
  readonly documentBytes: Uint8Array | null;
  readonly liveWitnesses?: ReadonlyMap<RepositoryRelativePath, MatrixRaceWitness>;
  /** Observational only; never participates in a matrix identity. */
  readonly dismissedChangeEvents: readonly DismissedChangeEvent[];
}

class MatrixControllerFailure extends Error {
  constructor(message: string) {
    super(message);
    this.name = "MatrixControllerFailure";
  }
}

function relativePath(repositoryRoot: string, absolutePath: string): RepositoryRelativePath {
  const raw = relative(repositoryRoot, absolutePath).replaceAll("\\", "/");
  return repositoryRelativePath(raw);
}

function within(repositoryRoot: string, target: string): boolean {
  const rel = relative(resolve(repositoryRoot), resolve(target));
  return rel === "" || rel === "." || (!isAbsolute(rel) && rel !== ".." && !rel.startsWith(`..${sep}`));
}

function assertWithin(repositoryRoot: string, target: string, label: string): void {
  if (!within(repositoryRoot, target)) throw new MatrixControllerFailure(`${label} escapes its owned root`);
}

export interface MatrixRaceWitness {
  readonly dev: bigint;
  readonly ino: bigint;
  readonly mode: bigint;
  readonly size: bigint;
  readonly mtimeNs: bigint;
  readonly ctimeNs: bigint;
}

interface MatrixPhysicalCapture {
  readonly row: ByteManifestRow;
  readonly bytes: Uint8Array;
  readonly witness: MatrixRaceWitness;
}

interface MatrixSourceScan {
  readonly source: CapturedMatrixSource;
  readonly witnesses: ReadonlyMap<RepositoryRelativePath, MatrixRaceWitness>;
}

interface MatrixLiveScan {
  readonly source: CapturedMatrixSource;
  readonly toolchainRow: ByteManifestRow;
  readonly documentRow: ByteManifestRow | null;
  readonly toolchainBytes?: Uint8Array;
  readonly documentBytes?: Uint8Array;
  readonly bytes: ReadonlyMap<RepositoryRelativePath, Uint8Array>;
  readonly witnesses: ReadonlyMap<RepositoryRelativePath, MatrixRaceWitness>;
}

function sameMatrixStableStat(left: BigIntStats, right: BigIntStats): boolean {
  return left.dev === right.dev
    && left.ino === right.ino
    && left.mode === right.mode
    && left.size === right.size
    && left.mtimeNs === right.mtimeNs
    && left.ctimeNs === right.ctimeNs;
}

function matrixRaceWitness(stat: BigIntStats): MatrixRaceWitness {
  return Object.freeze({
    dev: stat.dev,
    ino: stat.ino,
    mode: stat.mode,
    size: stat.size,
    mtimeNs: stat.mtimeNs,
    ctimeNs: stat.ctimeNs,
  });
}

function sameMatrixRaceWitness(left: MatrixRaceWitness, right: MatrixRaceWitness): boolean {
  return left.dev === right.dev
    && left.ino === right.ino
    && left.mode === right.mode
    && left.size === right.size
    && left.mtimeNs === right.mtimeNs
    && left.ctimeNs === right.ctimeNs;
}

function physicalFile(
  repositoryRoot: string,
  path: RepositoryRelativePath,
): MatrixPhysicalCapture {
  const absolute = resolve(repositoryRoot, ...path.split("/"));
  assertWithin(repositoryRoot, absolute, path);
  let cursor = repositoryRoot;
  for (const part of path.split("/").slice(0, -1)) {
    cursor = join(cursor, part);
    const stat = lstatSync(cursor, { bigint: true });
    if (!stat.isDirectory() || stat.isSymbolicLink()) {
      throw new MatrixControllerFailure(`matrix input directory is not plain: ${relativePath(repositoryRoot, cursor)}`);
    }
  }
  const before = lstatSync(absolute, { bigint: true });
  if (!before.isFile() || before.isSymbolicLink()) {
    throw new MatrixControllerFailure(`matrix input is not a plain regular file: ${path}`);
  }
  const noFollow = process.platform === "win32" ? 0 : (constants.O_NOFOLLOW ?? 0);
  let descriptor: number | undefined;
  try {
    descriptor = openSync(absolute, constants.O_RDONLY | noFollow);
    const opened = fstatSync(descriptor, { bigint: true });
    if (!opened.isFile() || opened.isSymbolicLink() || !sameMatrixStableStat(before, opened)) {
      throw new MatrixControllerFailure(`matrix input changed while opened: ${path}`);
    }
    if (opened.size > BigInt(Number.MAX_SAFE_INTEGER)) {
      throw new MatrixControllerFailure(`matrix input is too large to capture: ${path}`);
    }
    const bytes = new Uint8Array(readFileSync(descriptor));
    const afterRead = fstatSync(descriptor, { bigint: true });
    const afterPath = lstatSync(absolute, { bigint: true });
    if (
      !sameMatrixStableStat(opened, afterRead)
      || !sameMatrixStableStat(opened, afterPath)
      || opened.size !== BigInt(bytes.byteLength)
    ) {
      throw new MatrixControllerFailure(`matrix input changed while read: ${path}`);
    }
    return Object.freeze({
      row: Object.freeze({
        path,
        kind: "regular-file" as const,
        byteLength: bytes.byteLength,
        sha256: sha256Raw(bytes),
      }),
      bytes,
      witness: matrixRaceWitness(opened),
    });
  } finally {
    if (descriptor !== undefined) closeSync(descriptor);
  }
}

function directoryNames(repositoryRoot: string, directory: RepositoryRelativePath): readonly string[] {
  const absolute = resolve(repositoryRoot, ...directory.split("/"));
  const stat = lstatSync(absolute);
  if (!stat.isDirectory() || stat.isSymbolicLink()) {
    throw new MatrixControllerFailure(`matrix recursive root is not a plain directory: ${directory}`);
  }
  const names = readdirSync(absolute, { encoding: "buffer" })
    .map((raw) => {
      const decoded = new TextDecoder("utf-8", { fatal: true }).decode(raw);
      repositoryRelativePath(`${directory}/${decoded}`);
      return decoded;
    })
    .sort((left, right) => Buffer.compare(Buffer.from(left), Buffer.from(right)));
  const folded = new Set<string>();
  for (const name of names) {
    const key = name.normalize("NFC").toLowerCase();
    if (name.normalize("NFC") !== name || folded.has(key)) {
      throw new MatrixControllerFailure(`matrix directory contains ambiguous names: ${directory}`);
    }
    folded.add(key);
  }
  return Object.freeze(names);
}

function scanMatrixSourceWithWitness(
  repositoryRoot: string,
  retainBytes: boolean,
): MatrixSourceScan {
  const rows = new Map<RepositoryRelativePath, ByteManifestRow>();
  const bytes = new Map<RepositoryRelativePath, Uint8Array>();
  const witnesses = new Map<RepositoryRelativePath, MatrixRaceWitness>();
  const add = (path: RepositoryRelativePath): void => {
    if (rows.has(path)) return;
    const captured = physicalFile(repositoryRoot, path);
    rows.set(path, captured.row);
    if (retainBytes) bytes.set(path, captured.bytes);
    witnesses.set(path, captured.witness);
  };
  const visit = (directory: RepositoryRelativePath): void => {
    for (const name of directoryNames(repositoryRoot, directory)) {
      const path = repositoryRelativePath(`${directory}/${name}`);
      const absolute = resolve(repositoryRoot, ...path.split("/"));
      const stat = lstatSync(absolute);
      if (stat.isSymbolicLink()) throw new MatrixControllerFailure(`matrix source contains a symlink: ${path}`);
      if (stat.isDirectory()) visit(path);
      else if (stat.isFile()) add(path);
      else throw new MatrixControllerFailure(`matrix source contains a non-file entry: ${path}`);
    }
  };
  for (const root of SELF_HOST_MATRIX_RECURSIVE_ROOTS) visit(root);
  for (const exact of SELF_HOST_MATRIX_EXACT_INPUTS) add(exact);
  const orderedRows = Object.freeze([...rows.values()].sort((left, right) => compareUtf8Paths(left.path, right.path)));
  return Object.freeze({
    source: Object.freeze({ rows: orderedRows, bytes }),
    witnesses,
  });
}

function scanMatrixSource(repositoryRoot: string): CapturedMatrixSource {
  return scanMatrixSourceWithWitness(repositoryRoot, true).source;
}

function sourceFingerprint(source: CapturedMatrixSource): string {
  return JSON.stringify(source.rows.map((row) => [row.path, row.byteLength, row.sha256]));
}

function eventPath(filename: string | Uint8Array | null): RepositoryRelativePath {
  if (filename === null) throw new MatrixControllerFailure("matrix watcher lost an event path");
  const decoded = (typeof filename === "string"
    ? filename
    : new TextDecoder("utf-8", { fatal: true }).decode(filename))
    .replaceAll("\\", "/");
  return repositoryRelativePath(decoded);
}

function pathIntersects(left: RepositoryRelativePath, right: RepositoryRelativePath): boolean {
  return left === right || left.startsWith(`${right}/`) || right.startsWith(`${left}/`);
}

function matrixEventIsCovered(path: RepositoryRelativePath): boolean {
  return SELF_HOST_MATRIX_RECURSIVE_ROOTS.some((root) => pathIntersects(path, root))
    || SELF_HOST_MATRIX_EXACT_INPUTS.some((file) => pathIntersects(path, file))
    || pathIntersects(path, repositoryRelativePath(SELF_HOST_MATRIX_TOOLCHAIN_MANIFEST_PATH))
    || pathIntersects(path, repositoryRelativePath(SELF_HOST_MATRIX_PATH));
}

async function drainEvents(): Promise<void> {
  await new Promise<void>((settle) => setImmediate(settle));
  await new Promise<void>((settle) => setImmediate(settle));
}

function defaultMatrixWatchFactory(
  repositoryRoot: string,
  handlers: ArtifactByteWatcherHandlers,
): ArtifactByteWatcher {
  let watcher;
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

interface ResolvedMatrixCaptureDependencies {
  readonly afterScan: NonNullable<MatrixCaptureTestDependencies["afterScan"]>;
  readonly watchFactory: NonNullable<MatrixCaptureTestDependencies["watchFactory"]>;
  readonly createSentinel: NonNullable<MatrixCaptureTestDependencies["createSentinel"]>;
  readonly removeSentinel: NonNullable<MatrixCaptureTestDependencies["removeSentinel"]>;
  readonly nonce: NonNullable<MatrixCaptureTestDependencies["nonce"]>;
  readonly drainWatcher: NonNullable<MatrixCaptureTestDependencies["drainWatcher"]>;
  readonly reportDismissedChangeEvents: NonNullable<
    MatrixCaptureTestDependencies["reportDismissedChangeEvents"]
  >;
  readonly watcherTimeoutMs: number;
  readonly sourceCommit: (repositoryRoot: string) => string;
}

function resolvedMatrixCaptureDependencies(
  dependencies: MatrixCaptureTestDependencies,
): ResolvedMatrixCaptureDependencies {
  return Object.freeze({
    afterScan: dependencies.afterScan ?? (() => undefined),
    watchFactory: dependencies.watchFactory ?? defaultMatrixWatchFactory,
    createSentinel: dependencies.createSentinel ?? (async (absolutePath, payload) => {
      writeFileSync(absolutePath, payload, { flag: "wx" });
    }),
    removeSentinel: dependencies.removeSentinel ?? (async (absolutePath) => unlinkSync(absolutePath)),
    nonce: dependencies.nonce ?? (() => randomBytes(8).toString("hex")),
    drainWatcher: dependencies.drainWatcher ?? drainEvents,
    reportDismissedChangeEvents: dependencies.reportDismissedChangeEvents ?? ((events) => {
      if (events.length !== 0) {
        console.error(`[matrix] dismissed corroborated covered change events ${JSON.stringify(events)}`);
      }
    }),
    watcherTimeoutMs: dependencies.watcherTimeoutMs ?? 5_000,
    sourceCommit: dependencies.sourceCommit ?? gitCommit,
  });
}

function matrixLiveScan(repositoryRoot: string, retainBytes: boolean): MatrixLiveScan {
  const scanned = scanMatrixSourceWithWitness(repositoryRoot, retainBytes);
  const toolchain = physicalFile(
    repositoryRoot,
    repositoryRelativePath(SELF_HOST_MATRIX_TOOLCHAIN_MANIFEST_PATH),
  );
  const document = readOptionalMatrixCapture(repositoryRoot);
  const bytes = new Map(scanned.source.bytes);
  const witnesses = new Map(scanned.witnesses);
  if (retainBytes) bytes.set(toolchain.row.path, toolchain.bytes);
  witnesses.set(toolchain.row.path, toolchain.witness);
  if (document !== null) {
    if (retainBytes) bytes.set(document.row.path, document.bytes);
    witnesses.set(document.row.path, document.witness);
  }
  return Object.freeze({
    source: scanned.source,
    toolchainRow: toolchain.row,
    documentRow: document?.row ?? null,
    ...(retainBytes ? { toolchainBytes: toolchain.bytes } : {}),
    ...(retainBytes && document !== null ? { documentBytes: document.bytes } : {}),
    bytes,
    witnesses,
  });
}

function matrixLiveFingerprint(scan: MatrixLiveScan): string {
  return JSON.stringify([
    "fenel.self-host-matrix-live-capture.v1",
    sourceFingerprint(scan.source),
    scan.toolchainRow,
    scan.documentRow,
  ]);
}

function firstMatrixWitnessMismatch(
  first: MatrixLiveScan,
  second: MatrixLiveScan,
): RepositoryRelativePath | undefined {
  const paths = new Set([...first.witnesses.keys(), ...second.witnesses.keys()]);
  for (const path of [...paths].sort(compareUtf8Paths)) {
    const left = first.witnesses.get(path);
    const right = second.witnesses.get(path);
    if (left === undefined || right === undefined || !sameMatrixRaceWitness(left, right)) return path;
  }
  return undefined;
}

function matrixDirectoryMetadataChange(repositoryRoot: string, path: RepositoryRelativePath): boolean {
  try {
    const stat = lstatSync(resolve(repositoryRoot, ...path.split("/")), { bigint: true });
    return stat.isDirectory() && !stat.isSymbolicLink();
  } catch {
    return false;
  }
}

function corroborateMatrixChange(
  repositoryRoot: string,
  second: MatrixLiveScan,
  path: RepositoryRelativePath,
  boundary: "capture" | "final assertion" = "capture",
): void {
  const expectedBytes = second.bytes.get(path);
  const expectedWitness = second.witnesses.get(path);
  if (expectedBytes === undefined || expectedWitness === undefined) {
    throw new MatrixControllerFailure(`matrix source changed during ${boundary}: ${path}`);
  }
  let observed: MatrixPhysicalCapture;
  try {
    observed = physicalFile(repositoryRoot, path);
  } catch {
    throw new MatrixControllerFailure(`matrix source changed during ${boundary}: ${path}`);
  }
  if (
    !Buffer.from(observed.bytes).equals(Buffer.from(expectedBytes))
    || !sameMatrixRaceWitness(observed.witness, expectedWitness)
  ) {
    throw new MatrixControllerFailure(`matrix source changed during ${boundary}: ${path}`);
  }
}

async function proveMatrixWatcher(
  repositoryRoot: string,
  dependencies: ResolvedMatrixCaptureDependencies,
): Promise<void> {
  const sentinel = repositoryRelativePath(
    `implementations/typescript/engine/scripts/.fenel-m3b-matrix-watch-${process.pid}-${dependencies.nonce()}.sentinel`,
  );
  const sentinelAbsolute = resolve(repositoryRoot, ...sentinel.split("/"));
  const proofEvents: Array<{ readonly eventType: "change" | "rename"; readonly path: RepositoryRelativePath }> = [];
  let proofError: unknown;
  let proofWatcher: ArtifactByteWatcher;
  try {
    proofWatcher = dependencies.watchFactory(repositoryRoot, {
      event: (eventType, filename) => {
        try {
          proofEvents.push(Object.freeze({ eventType, path: eventPath(filename) }));
        } catch (error) {
          proofError = error;
        }
      },
      error: (error) => {
        proofError = error;
      },
    });
  } catch (error) {
    throw new MatrixControllerFailure(`recursive matrix watcher is unsupported: ${String(error)}`);
  }
  const waitForSentinel = async (after: number): Promise<void> => {
    const started = Date.now();
    while (!proofEvents.slice(after).some((event) => event.path === sentinel)) {
      if (proofError !== undefined) throw new MatrixControllerFailure(`matrix watcher failed: ${String(proofError)}`);
      if (Date.now() - started >= dependencies.watcherTimeoutMs) {
        throw new MatrixControllerFailure("recursive matrix watcher missed its sentinel");
      }
      await new Promise<void>((settle) => setTimeout(settle, 10));
    }
  };
  let sentinelOwned = false;
  try {
    const beforeCreate = proofEvents.length;
    await dependencies.createSentinel(
      sentinelAbsolute,
      new TextEncoder().encode(`matrix watcher sentinel ${process.pid}\n`),
    );
    sentinelOwned = true;
    await waitForSentinel(beforeCreate);
    const beforeDelete = proofEvents.length;
    await dependencies.removeSentinel(sentinelAbsolute);
    sentinelOwned = false;
    await waitForSentinel(beforeDelete);
    await dependencies.drainWatcher();
    if (proofError !== undefined) throw new MatrixControllerFailure(`matrix watcher failed: ${String(proofError)}`);
  } finally {
    if (sentinelOwned) await dependencies.removeSentinel(sentinelAbsolute).catch(() => undefined);
    try {
      await proofWatcher.close();
    } catch (error) {
      throw new MatrixControllerFailure(`matrix watcher failed while closing: ${String(error)}`);
    }
  }
}

async function captureStableMatrixSource(
  repositoryRoot: string,
  testDependencies: MatrixCaptureTestDependencies = {},
): Promise<StableMatrixCapture> {
  const dependencies = resolvedMatrixCaptureDependencies(testDependencies);
  await proveMatrixWatcher(repositoryRoot, dependencies);
  await dependencies.drainWatcher();
  const events: Array<{ readonly eventType: "change" | "rename"; readonly path: RepositoryRelativePath }> = [];
  let watcherError: unknown;
  let watcher: ArtifactByteWatcher;
  try {
    watcher = dependencies.watchFactory(repositoryRoot, {
      event: (eventType, filename) => {
        try {
          events.push(Object.freeze({ eventType, path: eventPath(filename) }));
        } catch (error) {
          watcherError = error;
        }
      },
      error: (error) => {
        watcherError = error;
      },
    });
  } catch (error) {
    throw new MatrixControllerFailure(`recursive matrix watcher is unsupported: ${String(error)}`);
  }
  let first: MatrixLiveScan;
  let second: MatrixLiveScan;
  try {
    first = matrixLiveScan(repositoryRoot, false);
    await dependencies.afterScan("A");
    second = matrixLiveScan(repositoryRoot, true);
    await dependencies.afterScan("B");
    await dependencies.drainWatcher();
  } finally {
    try {
      await watcher.close();
    } catch (error) {
      watcherError = error;
    }
  }
  if (watcherError !== undefined) {
    throw new MatrixControllerFailure(`matrix watcher failed: ${String(watcherError)}`);
  }
  if (matrixLiveFingerprint(first) !== matrixLiveFingerprint(second)) {
    throw new MatrixControllerFailure("matrix live scans differ");
  }
  const witnessMismatch = firstMatrixWitnessMismatch(first, second);
  if (witnessMismatch !== undefined) {
    throw new MatrixControllerFailure(`matrix live witness scans differ: ${witnessMismatch}`);
  }
  const changeCounts = new Map<RepositoryRelativePath, number>();
  for (const event of events) {
    if (!matrixEventIsCovered(event.path)) continue;
    if (event.eventType === "rename") {
      throw new MatrixControllerFailure(`matrix source changed during capture: ${event.path}`);
    }
    if (!second.witnesses.has(event.path) && matrixDirectoryMetadataChange(repositoryRoot, event.path)) {
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
    corroborateMatrixChange(repositoryRoot, second, path);
  }
  dependencies.reportDismissedChangeEvents(dismissedChangeEvents);
  if (second.toolchainBytes === undefined) {
    throw new MatrixControllerFailure("matrix B scan omitted retained toolchain bytes");
  }
  if (second.documentRow !== null && second.documentBytes === undefined) {
    throw new MatrixControllerFailure("matrix B scan omitted retained document bytes");
  }
  return Object.freeze({
    source: second.source,
    toolchainManifestBytes: second.toolchainBytes,
    documentBytes: second.documentBytes ?? null,
    liveWitnesses: second.witnesses,
    dismissedChangeEvents,
  });
}

function resolveSourceImport(
  source: CapturedMatrixSource,
  from: RepositoryRelativePath,
  specifierWithQuery: string,
  engineExports: ReadonlyMap<string, RepositoryRelativePath>,
): RepositoryRelativePath | null {
  const specifier = specifierWithQuery.endsWith("?raw")
    ? specifierWithQuery.slice(0, -4)
    : specifierWithQuery;
  if (ALL_RUNTIME_BUILTINS.has(specifier)) {
    if (!MATRIX_SOURCE_RUNTIME_BUILTINS.has(specifier)) {
      throw new MatrixControllerFailure(`matrix runtime imports undeclared host builtin ${specifier}`);
    }
    return null;
  }
  if (specifier === "@fenel/engine" || specifier.startsWith("@fenel/engine/")) {
    const subpath = specifier === "@fenel/engine" ? "." : `.${specifier.slice("@fenel/engine".length)}`;
    const target = engineExports.get(subpath);
    if (target === undefined) throw new MatrixControllerFailure(`matrix worker imports unexported engine subpath ${specifier}`);
    return target;
  }
  if (!specifier.startsWith(".")) {
    throw new MatrixControllerFailure(`matrix dependency closure contains unsupported bare package ${specifier}`);
  }
  const logical = posix.normalize(posix.join(posix.dirname(from), specifier));
  if (logical === ".." || logical.startsWith("../") || logical.startsWith("/")) {
    throw new MatrixControllerFailure(`matrix import ${specifier} escapes the captured repository`);
  }
  const base = repositoryRelativePath(logical);
  const candidates = SOURCE_EXTENSIONS.includes(extname(base) as (typeof SOURCE_EXTENSIONS)[number])
    ? [base]
    : [
      base,
      ...SOURCE_EXTENSIONS.map((extension) => repositoryRelativePath(`${base}${extension}`)),
      ...SOURCE_EXTENSIONS.map((extension) => repositoryRelativePath(`${base}/index${extension}`)),
    ];
  const matches = candidates.filter((candidate) => source.bytes.has(candidate));
  if (matches.length !== 1) {
    throw new MatrixControllerFailure(`matrix import ${specifier} from ${from} has ${matches.length} captured targets`);
  }
  return matches[0]!;
}

function assertMatrixSourceBuiltinGrants(
  path: RepositoryRelativePath,
  source: string,
  acquisitions: readonly { readonly kind: string; readonly specifier: string }[],
  censusOptions: SourceAcquisitionCensusOptions,
): void {
  const observed = new Map<string, number>();
  for (const edge of acquisitions) {
    const specifier = edge.specifier.endsWith("?raw")
      ? edge.specifier.slice(0, -4)
      : edge.specifier;
    if (specifier === "node:util" && (edge.kind !== "commonjs-module" || edge.specifier !== "node:util")) {
      throw new MatrixControllerFailure(`matrix node:util requires its exact CommonJS acquisition at ${path}`);
    }
    if (ALL_RUNTIME_BUILTINS.has(specifier)) {
      observed.set(specifier, (observed.get(specifier) ?? 0) + 1);
    }
  }
  const grants = MATRIX_SOURCE_BUILTIN_GRANTS.get(path) ?? Object.freeze([]);
  const expected = new Map<string, number>();
  let masked = source;
  for (const grant of grants) {
    expected.set(grant.specifier, (expected.get(grant.specifier) ?? 0) + grant.expectedCount);
    const declarationCount = source.split(grant.declaration).length - 1;
    if (declarationCount !== grant.expectedCount) {
      throw new MatrixControllerFailure(
        `matrix builtin declaration changed at ${path}: ${grant.specifier} has ${declarationCount} exact forms; expected ${grant.expectedCount}`,
      );
    }
    masked = masked.replaceAll(grant.declaration, grant.declaration.replace(/[^\r\n]/gu, " "));
  }
  let residual;
  try {
    residual = censusSourceAcquisitions(path, masked, Object.freeze({
      allowComputedFileAcquisition: censusOptions.allowComputedFileAcquisition,
      allowDynamicCodeConstructor: censusOptions.allowDynamicCodeConstructor,
    }));
  } catch (error) {
    throw new MatrixControllerFailure(`matrix builtin grant masking failed at ${path}: ${String(error)}`);
  }
  const residualBuiltins = residual.acquisitions
    .map((edge) => edge.specifier.endsWith("?raw") ? edge.specifier.slice(0, -4) : edge.specifier)
    .filter((specifier) => ALL_RUNTIME_BUILTINS.has(specifier));
  if (residualBuiltins.length !== 0) {
    throw new MatrixControllerFailure(
      `matrix builtin declarations are not executable exact grants at ${path}: ${residualBuiltins.join(", ")}`,
    );
  }
  for (const specifier of new Set([...observed.keys(), ...expected.keys()])) {
    const observedCount = observed.get(specifier) ?? 0;
    const expectedCount = expected.get(specifier) ?? 0;
    if (observedCount !== expectedCount) {
      throw new MatrixControllerFailure(
        `matrix builtin acquisition changed at ${path}: ${specifier} has ${observedCount} runtime edges; expected ${expectedCount}`,
      );
    }
  }
}

function assertClosedMatrixRuntime(source: CapturedMatrixSource): void {
  const packagePath = repositoryRelativePath("implementations/typescript/engine/package.json");
  const packageBytes = source.bytes.get(packagePath);
  if (packageBytes === undefined) throw new MatrixControllerFailure("captured matrix package omits engine package.json");
  const packageJson = JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(packageBytes)) as {
    exports?: Readonly<Record<string, string>>;
  };
  if (packageJson.exports === undefined) throw new MatrixControllerFailure("engine package exports are absent");
  const engineExports = new Map<string, RepositoryRelativePath>();
  for (const [key, relativeTarget] of Object.entries(packageJson.exports)) {
    if (typeof relativeTarget !== "string" || !relativeTarget.startsWith("./")) {
      throw new MatrixControllerFailure(`unsupported engine export target for ${key}`);
    }
    engineExports.set(
      key,
      repositoryRelativePath(`implementations/typescript/engine/${relativeTarget.slice(2)}`),
    );
  }
  const entrypoint = repositoryRelativePath(SELF_HOST_MATRIX_GENERATOR_PATH);
  const generatorText = new TextDecoder("utf-8", { fatal: true }).decode(
    source.bytes.get(entrypoint) ?? new Uint8Array(),
  );
  const requestReadExpression = "readFileSync(requestPath)";
  const authorizationGlobalExpression = "globalThis,\n    MATRIX_WORKER_AUTHORIZATION_GLOBAL,";
  const exactWorkerShape = Object.freeze([
    "const requestBytes = new Uint8Array(readFileSync(requestPath));",
    "const outputPath = resolve(dirname(requestPath), request.outputs.smoke);",
    "resolve(base, request.outputs.candidate)",
    "resolve(base, request.outputs.rawFacets)",
    "resolve(base, request.outputs.audit)",
    'const raw = await import("./self-host-matrix-report.fenel?raw");',
    "if (import.meta.main) {",
  ]);
  if (
    exactWorkerShape.some((expression) => generatorText.split(expression).length !== 2)
    || generatorText.split(authorizationGlobalExpression).length !== 2
    || (generatorText.match(/\breadFileSync\(/gu) ?? []).length !== 1
    || (generatorText.match(/\bwriteFileSync\(/gu) ?? []).length !== 4
    || generatorText.includes("node:child_process")
    || generatorText.includes("process.cwd")
    || generatorText.includes("docs/SELF_HOST_MATRIX.md")
    || generatorText.includes("FENEL_MATRIX_PROGRESS")
  ) {
    throw new MatrixControllerFailure("matrix generator's closed request/private-output IO shape changed");
  }
  const queue = [entrypoint];
  const seen = new Set<RepositoryRelativePath>();
  const hostSensitivityCounts = new Map<string, number>();
  const engineRequireBase = repositoryRelativePath("implementations/typescript/engine/src/.matrix-engine-require.ts");
  while (queue.length > 0) {
    const path = queue.shift()!;
    if (seen.has(path)) continue;
    seen.add(path);
    const bytes = source.bytes.get(path);
    if (bytes === undefined) throw new MatrixControllerFailure(`matrix runtime path is not captured: ${path}`);
    if (![".ts", ".tsx", ".mts", ".cts", ".js", ".jsx", ".mjs", ".cjs"].includes(extname(path))) continue;
    const text = new TextDecoder("utf-8", { fatal: true }).decode(bytes);
    const censusText = path === entrypoint
      ? text.replace(
        authorizationGlobalExpression,
        authorizationGlobalExpression.replace("globalThis", "({})"),
      )
      : text;
    const acquisitionCensusText = path === entrypoint
      ? censusText.replaceAll(MATRIX_GENERATOR_FS_DECLARATION, 'void require("node:fs");')
      : censusText;
    let census;
    const llvmShapeOnlyMembers = new Map<string, number>();
    const llvmNamespaceIdentifiers = new Map<string, number>();
    try {
      const censusOptions: SourceAcquisitionCensusOptions = Object.freeze({
        allowComputedFileAcquisition: (observation: ComputedFileAcquisitionObservation) => (
          observation.path === entrypoint
          && observation.kind === "literal-read"
          && observation.callee === "readFileSync"
          && observation.expression === requestReadExpression
        ),
        allowDynamicCodeConstructor: (observation: DynamicCodeConstructorObservation) => (
          observation.path === MATRIX_JS_CLASSIFIER_PATH
          && observation.callee === "Function"
          && observation.expression === MATRIX_JS_CONSTRUCTOR_EXPRESSION
        ),
        observeMemberAccess: (observation: MemberAccessObservation) => {
          if (path !== MATRIX_LLVM_CLASSIFIER_PATH) return;
          const key = `${observation.object}.${observation.member}`;
          const guardedNamespace = observation.object === "fs"
            || observation.object === "os"
            || (observation.object === "process" && observation.member === "platform");
          if (!guardedNamespace) return;
          if (!MATRIX_LLVM_SHAPE_ONLY_TCB_PINS.some((pin) => `${pin.object}.${pin.member}` === key)) {
            throw new MatrixControllerFailure(`matrix LLVM shape-only TCB gained ${key}`);
          }
          llvmShapeOnlyMembers.set(key, (llvmShapeOnlyMembers.get(key) ?? 0) + 1);
        },
        observeIdentifier: (observation: IdentifierObservation) => {
          if (path !== MATRIX_LLVM_CLASSIFIER_PATH) return;
          if (!MATRIX_LLVM_NAMESPACE_IDENTIFIER_PINS.some((pin) => pin.identifier === observation.identifier)) {
            return;
          }
          llvmNamespaceIdentifiers.set(
            observation.identifier,
            (llvmNamespaceIdentifiers.get(observation.identifier) ?? 0) + 1,
          );
        },
      });
      census = censusSourceAcquisitions(path, acquisitionCensusText, censusOptions);
      assertMatrixSourceBuiltinGrants(path, censusText, census.acquisitions, censusOptions);
    } catch (error) {
      throw new MatrixControllerFailure(`matrix runtime acquisition census failed: ${path}: ${String(error)}`);
    }
    for (const operation of census.hostSensitiveOperations) {
      const key = `${operation.path}\0${operation.kind}`;
      hostSensitivityCounts.set(key, (hostSensitivityCounts.get(key) ?? 0) + 1);
    }
    if (path === MATRIX_LLVM_CLASSIFIER_PATH) {
      for (const pin of MATRIX_LLVM_SHAPE_ONLY_TCB_PINS) {
        const key = `${pin.object}.${pin.member}`;
        const count = llvmShapeOnlyMembers.get(key) ?? 0;
        if (count !== pin.expectedCount) {
          throw new MatrixControllerFailure(
            `matrix LLVM shape-only TCB changed at ${path}: ${key} has ${count} lexical members; expected ${pin.expectedCount}`,
          );
        }
      }
      for (const pin of MATRIX_LLVM_NAMESPACE_IDENTIFIER_PINS) {
        const count = llvmNamespaceIdentifiers.get(pin.identifier) ?? 0;
        if (count !== pin.expectedCount) {
          throw new MatrixControllerFailure(
            `matrix LLVM namespace TCB changed at ${path}: ${pin.identifier} has ${count} lexical identifiers; expected ${pin.expectedCount}`,
          );
        }
      }
    }
    if (
      (path === entrypoint && (
        census.computedFileAcquisitions.length !== 1
        || census.computedFileAcquisitions[0]?.expression !== requestReadExpression
      ))
      || (path !== entrypoint && census.computedFileAcquisitions.length !== 0)
    ) {
      throw new MatrixControllerFailure(`matrix runtime computed filesystem census changed: ${path}`);
    }
    if (
      (path === MATRIX_JS_CLASSIFIER_PATH && (
        census.dynamicCodeConstructors.length !== 1
        || text.split(MATRIX_JS_CONSTRUCTOR_STATEMENT).length !== 2
      ))
      || (path !== MATRIX_JS_CLASSIFIER_PATH && census.dynamicCodeConstructors.length !== 0)
    ) {
      throw new MatrixControllerFailure(`matrix runtime dynamic-code census changed: ${path}`);
    }
    for (const edge of census.acquisitions) {
      if (edge.kind === "literal-read") {
        const target = repositoryRelativePath(posix.normalize(edge.specifier));
        if (!source.bytes.has(target)) {
          throw new MatrixControllerFailure(`matrix runtime reads uncaptured literal path ${edge.specifier}`);
        }
        continue;
      }
      if (edge.kind === "literal-directory" || edge.kind === "literal-glob") {
        const lexical = edge.specifier.replaceAll("\\", "/");
        if (lexical.startsWith("/") || lexical.split("/").some((part) => part === "..")) {
          throw new MatrixControllerFailure(`matrix runtime filesystem acquisition escapes capture: ${edge.specifier}`);
        }
        if (
          edge.kind === "literal-directory"
          && ![...source.bytes.keys()].some((candidate) => candidate.startsWith(`${lexical.replace(/\/$/u, "")}/`))
        ) {
          throw new MatrixControllerFailure(`matrix runtime lists uncaptured directory ${edge.specifier}`);
        }
        continue;
      }
      const target = edge.kind === "engine-require"
        ? resolveSourceImport(source, engineRequireBase, `./${edge.specifier}`, engineExports)
        : resolveSourceImport(source, path, edge.specifier, engineExports);
      if (
        target !== null
        && !edge.specifier.endsWith("?raw")
        && !seen.has(target)
      ) queue.push(target);
    }
  }
  for (const grantedPath of MATRIX_SOURCE_BUILTIN_GRANTS.keys()) {
    if (source.bytes.has(grantedPath) && !seen.has(grantedPath)) {
      throw new MatrixControllerFailure(`captured matrix builtin grant is unreachable: ${grantedPath}`);
    }
  }
  const observedHostSensitivity = [...hostSensitivityCounts].map(([key, expectedCount]) => {
    const [pathValue, kind] = key.split("\0") as [RepositoryRelativePath, HostSensitiveOperationKind];
    return Object.freeze({ path: pathValue, kind, expectedCount });
  }).sort((left, right) =>
    compareUtf8Paths(left.path, right.path)
    || (left.kind < right.kind ? -1 : left.kind > right.kind ? 1 : 0));
  const expectedHostSensitivity = MATRIX_HOST_SENSITIVITY_PINS.filter((pin) => seen.has(pin.path)).sort((left, right) =>
    compareUtf8Paths(left.path, right.path)
    || (left.kind < right.kind ? -1 : left.kind > right.kind ? 1 : 0));
  if (JSON.stringify(observedHostSensitivity) !== JSON.stringify(expectedHostSensitivity)) {
    throw new MatrixControllerFailure(
      `matrix host-sensitivity census changed: observed ${JSON.stringify(observedHostSensitivity)}`,
    );
  }
}

export function computeMatrixControllerDigest(source: CapturedMatrixSource): Sha256Hex {
  const identities = [SELF_HOST_MATRIX_CERTIFICATE_HELPER_PATH, SELF_HOST_MATRIX_CONTROLLER_PATH]
    .map(repositoryRelativePath)
    .map((path) => {
      const bytes = source.bytes.get(path);
      if (bytes === undefined) throw new MatrixControllerFailure(`matrix controller identity omits ${path}`);
      return Object.freeze({ path, byteLength: bytes.byteLength, digest: sha256Raw(bytes) });
    });
  return sha256Raw(JSON.stringify(["fenel.self-host-matrix-controller-identity.v1", identities]));
}

function utcDate(now = new Date()): string {
  return now.toISOString().slice(0, 10);
}

function gitCommit(repositoryRoot: string): string {
  const result = spawnSync("git", ["rev-parse", "HEAD"], {
    cwd: repositoryRoot,
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
  });
  const value = result.status === 0 ? result.stdout.trim() : "";
  if (!/^[0-9a-f]{40}$/u.test(value)) {
    throw new MatrixControllerFailure("matrix source commit is uncomputable");
  }
  return value;
}

function workerEnvironmentRows(repositoryRoot: string): {
  readonly normalized: readonly { readonly key: string; readonly value: string }[];
  readonly actual: Readonly<Record<string, string>>;
} {
  const normalized: Array<{ readonly key: string; readonly value: string }> = [
    { key: "LANG", value: "C.UTF-8" },
    { key: "LC_ALL", value: "C.UTF-8" },
    { key: "NO_COLOR", value: "1" },
    { key: "PATH", value: "<matrix-package>/.bin" },
    { key: "TEMP", value: "<matrix-package>/.tmp" },
    { key: "TMP", value: "<matrix-package>/.tmp" },
    { key: "TZ", value: "UTC" },
  ];
  if (process.platform === "win32") {
    const systemRoot = process.env.SYSTEMROOT;
    const comspec = process.env.COMSPEC;
    if (systemRoot === undefined || comspec === undefined) {
      throw new MatrixControllerFailure("Windows matrix environment lacks SYSTEMROOT or COMSPEC");
    }
    normalized.push({ key: "COMSPEC", value: comspec }, { key: "SYSTEMROOT", value: systemRoot });
  }
  normalized.sort((left, right) => Buffer.compare(Buffer.from(left.key), Buffer.from(right.key)));
  const actual = Object.fromEntries(normalized.map((row) => [
    row.key,
    row.value
      .replace("<matrix-package>/.bin", resolve(repositoryRoot, MATRIX_SNAPSHOT_ROOT, ".private-bin"))
      .replace("<matrix-package>/.tmp", resolve(repositoryRoot, MATRIX_SNAPSHOT_ROOT, ".private-tmp")),
  ]));
  return Object.freeze({ normalized: Object.freeze(normalized), actual: Object.freeze(actual) });
}

function measureMatrixWorkerIntl(environment: Readonly<Record<string, string>>): {
  readonly locale: string;
  readonly timezone: string;
} {
  const script = "const r=Intl.DateTimeFormat().resolvedOptions();process.stdout.write(JSON.stringify({locale:r.locale,timezone:r.timeZone}));";
  const result = spawnSync(process.execPath, ["--no-env-file", "--no-install", "-e", script], {
    env: environment,
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
  });
  if (result.status !== 0) {
    throw new MatrixControllerFailure(`matrix worker locale probe failed: ${result.stderr.trim()}`);
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(result.stdout);
  } catch (error) {
    throw new MatrixControllerFailure(`matrix worker locale probe emitted invalid JSON: ${String(error)}`);
  }
  if (parsed === null || typeof parsed !== "object" || Array.isArray(parsed)) {
    throw new MatrixControllerFailure("matrix worker locale probe did not emit one object");
  }
  const record = parsed as Record<string, unknown>;
  if (
    Object.keys(record).sort().join("\0") !== ["locale", "timezone"].join("\0")
    || typeof record.locale !== "string"
    || record.locale.length === 0
    || record.timezone !== "UTC"
  ) {
    throw new MatrixControllerFailure("matrix worker locale/timezone differs from the closed environment");
  }
  return Object.freeze({ locale: record.locale, timezone: record.timezone });
}

export function captureMatrixEnvironment(
  repositoryRoot: string,
  toolchainBytes: Uint8Array,
): { readonly certificate: MatrixEnvironmentCertificate; readonly worker: Readonly<Record<string, string>> } {
  const manifest = decodeArtifactToolchainManifest(toolchainBytes);
  const osFamily = osFamilyFromPlatform(process.platform);
  if (osFamily === null) throw new MatrixControllerFailure(`unsupported matrix platform ${process.platform}`);
  const row = selectBunToolchain(manifest, { osFamily, arch: process.arch });
  const executableDigest = sha256Raw(readFileSync(process.execPath));
  if (executableDigest !== row.binarySha256) throw new MatrixControllerFailure("matrix controller is not running the manifest-pinned Bun executable");
  if (Bun.version !== row.bunRelease || Bun.revision !== row.bunRevision) {
    throw new MatrixControllerFailure("matrix controller Bun release/revision differs from the toolchain row");
  }
  const environment = workerEnvironmentRows(repositoryRoot);
  const intl = measureMatrixWorkerIntl(environment.actual);
  const externalTool = manifest.selfHostMatrix.externalTool;
  const certificate = makeMatrixEnvironmentCertificate({
    osFamily,
    arch: process.arch as "arm64" | "x64",
    bun: {
      executableSha256: executableDigest,
      release: Bun.version,
      revision: Bun.revision,
      webkit: process.versions.webkit ?? "unavailable",
      icu: process.versions.icu ?? "unavailable",
      unicode: process.versions.unicode ?? "unavailable",
    },
    toolchainManifestDigest: sha256Raw(toolchainBytes),
    locale: intl.locale,
    timezone: intl.timezone,
    parentEnvironment: environment.normalized,
    externalTool: {
      mode: externalTool.mode,
      privatePath: "<matrix-package>/.bin",
      clang: "absent",
    },
  });
  return Object.freeze({ certificate, worker: environment.actual });
}

function readOptionalMatrixCapture(repositoryRoot: string): MatrixPhysicalCapture | null {
  const target = resolve(repositoryRoot, SELF_HOST_MATRIX_PATH);
  const docs = dirname(target);
  const docsStat = lstatSync(docs);
  if (!docsStat.isDirectory() || docsStat.isSymbolicLink()) {
    throw new MatrixControllerFailure("matrix artifact parent is not one plain directory");
  }
  try {
    lstatSync(target, { bigint: true });
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return null;
    throw error;
  }
  return physicalFile(repositoryRoot, repositoryRelativePath(SELF_HOST_MATRIX_PATH));
}

function readOptionalMatrix(repositoryRoot: string): Uint8Array | null {
  return readOptionalMatrixCapture(repositoryRoot)?.bytes ?? null;
}

type MatrixDependencyEvidence = {
  readonly manifestBytes: Uint8Array;
  readonly proofDigest: Sha256Hex;
};

function requiredSourceBytes(
  source: CapturedMatrixSource,
  path: RepositoryRelativePath,
): Uint8Array {
  const bytes = source.bytes.get(path);
  if (bytes === undefined) throw new MatrixControllerFailure(`matrix source omits dependency input ${path}`);
  return bytes;
}

function proveMatrixDependencyEvidence(source: CapturedMatrixSource): MatrixDependencyEvidence {
  const proof = proveEmptyCompiledArtifactDependencies({
    packageJsonBytes: requiredSourceBytes(source, ENGINE_PACKAGE_PATH),
    bunLockBytes: requiredSourceBytes(source, BUN_LOCK_PATH),
  });
  return Object.freeze({
    manifestBytes: new TextEncoder().encode(proof.canonicalManifest),
    proofDigest: parseSha256Hex(proof.dependencyDigest),
  });
}

function assertMatrixDependencyEvidence(
  source: CapturedMatrixSource,
  manifestBytes: Uint8Array,
  proofDigest: Sha256Hex,
): MatrixDependencyEvidence {
  const expected = proveMatrixDependencyEvidence(source);
  if (!Buffer.from(expected.manifestBytes).equals(Buffer.from(manifestBytes))) {
    throw new MatrixControllerFailure("matrix dependency manifest is not the canonical package/lock projection");
  }
  if (expected.proofDigest !== proofDigest) {
    throw new MatrixControllerFailure("matrix dependency proof digest differs from the package/lock projection");
  }
  return expected;
}

/**
 * Reproduce the exact zero-dependency projection with the manifest-pinned Bun
 * installer in a fresh marker-owned workspace. The resolver itself rejects every
 * observed package byte, link, virtual-map row, or mutable A/B output.
 */
export async function verifyColdMatrixDependencies(
  input: MatrixColdDependencyVerificationInput,
): Promise<void> {
  const expected = assertMatrixDependencyEvidence(
    input.source,
    input.dependencyManifestBytes,
    input.dependencyProofDigest,
  );
  const acquired = await acquireCompiledArtifactEnvironment({
    repositoryRoot: input.repositoryRoot,
    toolchainManifestBytes: input.toolchainManifestBytes,
    rootPackageJsonBytes: requiredSourceBytes(input.source, ROOT_PACKAGE_PATH),
  }, { allowNetwork: true });
  const cold = await coldResolveEmptyCompiledArtifactDependencies({
    repositoryRoot: input.repositoryRoot,
    bunExecutable: acquired.bunExecutable,
    bunExecutableSha256: acquired.environment.bun.executableDigest,
    rootPackageJsonBytes: requiredSourceBytes(input.source, ROOT_PACKAGE_PATH),
    packageJsonBytes: requiredSourceBytes(input.source, ENGINE_PACKAGE_PATH),
    bunLockBytes: requiredSourceBytes(input.source, BUN_LOCK_PATH),
    expectedDependencyManifestBytes: input.dependencyManifestBytes,
  });
  if (
    cold.coldResolution !== "verified"
    || cold.dependencyDigest !== expected.proofDigest
    || cold.observedCanonicalManifest !== new TextDecoder().decode(expected.manifestBytes)
  ) {
    throw new MatrixControllerFailure("cold matrix dependency proof differs from its static projection");
  }
}

export async function captureMatrixPackage(
  repositoryRoot: string,
  input: {
    readonly presentation?: {
      readonly sourceCommit: string;
      readonly verified: string;
      readonly verifiedAtSha: string;
    };
    readonly testDependencies?: MatrixCaptureTestDependencies;
  } = {},
): Promise<CapturedMatrixPackage> {
  const root = resolve(repositoryRoot);
  const stable = await captureStableMatrixSource(root, input.testDependencies);
  const source = stable.source;
  assertClosedMatrixRuntime(source);
  const toolchainBytes = stable.toolchainManifestBytes;
  const dependency = proveMatrixDependencyEvidence(source);
  await (input.testDependencies?.verifyColdDependencies ?? verifyColdMatrixDependencies)({
    repositoryRoot: root,
    source,
    toolchainManifestBytes: toolchainBytes,
    dependencyManifestBytes: dependency.manifestBytes,
    dependencyProofDigest: dependency.proofDigest,
  });
  const inputs = makeMatrixInputsCertificate({
    sourceRows: source.rows,
    dependencyRows: [],
  });
  const environment = captureMatrixEnvironment(root, toolchainBytes);
  const sourceCommit = input.presentation?.sourceCommit ?? gitCommit(root);
  const verified = input.presentation?.verified ?? utcDate();
  const verifiedAtSha = input.presentation?.verifiedAtSha ?? sourceCommit.slice(0, 7);
  if (!sourceCommit.startsWith(verifiedAtSha)) {
    throw new MatrixControllerFailure("captured presentation SHA does not prefix the source commit");
  }
  const documentBytes = stable.documentBytes;
  const artifactBefore = matrixArtifactIdentity(documentBytes);
  const controller = computeMatrixControllerDigest(source);
  const packageDigest = computeMatrixPackageDigest({
    inputsDigest: inputs.digest,
    environmentDigest: environment.certificate.digest,
    controllerDigest: controller,
    sourceCommit,
    verified,
    verifiedAtSha,
    initialArtifact: artifactBefore,
  });
  let observation: MatrixDocumentObservation | null = null;
  if (documentBytes !== null) observation = parseMatrixDocument(documentBytes);
  return Object.freeze({
    repositoryRoot: root,
    source,
    inputs,
    environment: environment.certificate,
    sourceCommit,
    verified,
    verifiedAtSha,
    controllerDigest: controller,
    packageDigest,
    documentBytes,
    observation,
    artifactBefore,
    workerEnvironment: environment.worker,
    toolchainManifestBytes: toolchainBytes,
    dependencyManifestBytes: dependency.manifestBytes,
    dependencyProofDigest: dependency.proofDigest,
    ...(stable.liveWitnesses === undefined ? {} : { liveWitnesses: stable.liveWitnesses }),
  });
}

export async function assertCurrentMatrixPackage(
  captured: CapturedMatrixPackage,
  testDependencies: MatrixCaptureTestDependencies = {},
): Promise<void> {
  if (captured.liveWitnesses === undefined) {
    throw new MatrixControllerFailure("captured matrix package omits live race witnesses");
  }
  const dependencies = resolvedMatrixCaptureDependencies(testDependencies);
  const events: Array<{ readonly eventType: "change" | "rename"; readonly path: RepositoryRelativePath }> = [];
  let watcherError: unknown;
  const watcher = dependencies.watchFactory(captured.repositoryRoot, {
    event: (eventType, filename) => {
      try {
        events.push(Object.freeze({ eventType, path: eventPath(filename) }));
      } catch (error) {
        watcherError = error;
      }
    },
    error: (error) => {
      watcherError = error;
    },
  });
  let live: MatrixLiveScan;
  try {
    await dependencies.afterScan("A");
    live = matrixLiveScan(captured.repositoryRoot, true);
    await dependencies.afterScan("B");
    await dependencies.drainWatcher();
  } finally {
    try {
      await watcher.close();
    } catch (error) {
      watcherError = error;
    }
  }
  if (watcherError !== undefined) {
    throw new MatrixControllerFailure(`matrix final watcher failed: ${String(watcherError)}`);
  }
  if (dependencies.sourceCommit(captured.repositoryRoot) !== captured.sourceCommit) {
    throw new MatrixControllerFailure("matrix source commit changed before publication");
  }
  const changeCounts = new Map<RepositoryRelativePath, number>();
  for (const event of events) {
    if (!matrixEventIsCovered(event.path)) continue;
    if (event.eventType === "rename") {
      throw new MatrixControllerFailure(`matrix input changed during final assertion: ${event.path}`);
    }
    if (!live.witnesses.has(event.path) && matrixDirectoryMetadataChange(captured.repositoryRoot, event.path)) {
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
    corroborateMatrixChange(captured.repositoryRoot, live, path, "final assertion");
  }
  dependencies.reportDismissedChangeEvents(dismissedChangeEvents);
  if (sourceFingerprint(live.source) !== sourceFingerprint(captured.source)) {
    throw new MatrixControllerFailure("live matrix source bytes changed before publication");
  }
  if (
    live.toolchainRow.byteLength !== captured.toolchainManifestBytes.byteLength
    || live.toolchainRow.sha256 !== sha256Raw(captured.toolchainManifestBytes)
  ) {
    throw new MatrixControllerFailure("live matrix toolchain bytes changed before publication");
  }
  const liveDocument = live.documentBytes ?? null;
  if (
    (liveDocument === null) !== (captured.documentBytes === null)
    || (
      liveDocument !== null
      && captured.documentBytes !== null
      && !Buffer.from(liveDocument).equals(Buffer.from(captured.documentBytes))
    )
  ) {
    throw new MatrixControllerFailure("live matrix artifact bytes changed before publication");
  }
  const liveInputs = makeMatrixInputsCertificate({
    sourceRows: live.source.rows,
    dependencyRows: [],
  });
  if (liveInputs.digest !== captured.inputs.digest) {
    throw new MatrixControllerFailure("live matrix inputs changed before publication");
  }
  if (computeMatrixControllerDigest(live.source) !== captured.controllerDigest) {
    throw new MatrixControllerFailure("live matrix controller identity changed before publication");
  }
  const paths = new Set([...captured.liveWitnesses.keys(), ...live.witnesses.keys()]);
  for (const path of [...paths].sort(compareUtf8Paths)) {
    const expected = captured.liveWitnesses.get(path);
    const observed = live.witnesses.get(path);
    if (expected === undefined || observed === undefined || !sameMatrixRaceWitness(expected, observed)) {
      throw new MatrixControllerFailure(`live matrix race witness changed before publication: ${path}`);
    }
  }
}

const MATRIX_CHECK_PACKAGE_SCHEMA = "fenel.self-host-matrix-check-package.v1" as const;

type MatrixCheckPackageMetadata = {
  readonly schema: typeof MATRIX_CHECK_PACKAGE_SCHEMA;
  readonly sourceCommit: string;
  readonly verified: string;
  readonly verifiedAtSha: string;
  readonly sourceDigest: Sha256Hex;
  readonly dependencyDigest: Sha256Hex;
  readonly dependencyManifestDigest: Sha256Hex;
  readonly dependencyProofDigest: Sha256Hex;
  readonly toolchainManifestDigest: Sha256Hex;
  readonly inputsDigest: Sha256Hex;
  readonly environmentDigest: Sha256Hex;
  readonly controllerDigest: Sha256Hex;
  readonly packageDigest: Sha256Hex;
  readonly initialArtifact: MatrixArtifactIdentity;
};

function packageMetadata(captured: CapturedMatrixPackage): MatrixCheckPackageMetadata {
  return Object.freeze({
    schema: MATRIX_CHECK_PACKAGE_SCHEMA,
    sourceCommit: captured.sourceCommit,
    verified: captured.verified,
    verifiedAtSha: captured.verifiedAtSha,
    sourceDigest: captured.inputs.source.digest,
    dependencyDigest: captured.inputs.dependencies.digest,
    dependencyManifestDigest: sha256Raw(captured.dependencyManifestBytes),
    dependencyProofDigest: captured.dependencyProofDigest,
    toolchainManifestDigest: captured.environment.toolchainManifestDigest,
    inputsDigest: captured.inputs.digest,
    environmentDigest: captured.environment.digest,
    controllerDigest: captured.controllerDigest,
    packageDigest: captured.packageDigest,
    initialArtifact: captured.artifactBefore,
  });
}

function artifactIdentityFromWire(value: unknown, path: string): MatrixArtifactIdentity {
  const record = expectWireRecord(value, path);
  const kind = expectWireLiteral(record.kind, ["absent", "present"] as const, `${path}.kind`);
  if (kind === "absent") {
    expectClosedKeys(record, ["kind"], [], path);
    return Object.freeze({ kind });
  }
  expectClosedKeys(record, ["kind", "byteLength", "digest"], [], path);
  const byteLength = record.byteLength;
  if (!Number.isSafeInteger(byteLength) || (byteLength as number) < 0) {
    throw new MatrixControllerFailure(`${path}.byteLength is not a non-negative safe integer`);
  }
  return Object.freeze({
    kind,
    byteLength: byteLength as number,
    digest: parseSha256Hex(expectSha256(record.digest, `${path}.digest`)),
  });
}

function parsePackageMetadata(bytes: Uint8Array): MatrixCheckPackageMetadata {
  const record = expectWireRecord(parseCanonicalJson(bytes), "matrixPackage");
  expectClosedKeys(record, [
    "schema",
    "sourceCommit",
    "verified",
    "verifiedAtSha",
    "sourceDigest",
    "dependencyDigest",
    "dependencyManifestDigest",
    "dependencyProofDigest",
    "toolchainManifestDigest",
    "inputsDigest",
    "environmentDigest",
    "controllerDigest",
    "packageDigest",
    "initialArtifact",
  ], [], "matrixPackage");
  return Object.freeze({
    schema: expectWireLiteral(record.schema, [MATRIX_CHECK_PACKAGE_SCHEMA] as const, "matrixPackage.schema"),
    sourceCommit: expectGitOid(record.sourceCommit, "matrixPackage.sourceCommit"),
    verified: expectWireString(record.verified, "matrixPackage.verified"),
    verifiedAtSha: expectWireString(record.verifiedAtSha, "matrixPackage.verifiedAtSha"),
    sourceDigest: parseSha256Hex(expectSha256(record.sourceDigest, "matrixPackage.sourceDigest")),
    dependencyDigest: parseSha256Hex(expectSha256(record.dependencyDigest, "matrixPackage.dependencyDigest")),
    dependencyManifestDigest: parseSha256Hex(expectSha256(
      record.dependencyManifestDigest,
      "matrixPackage.dependencyManifestDigest",
    )),
    dependencyProofDigest: parseSha256Hex(expectSha256(
      record.dependencyProofDigest,
      "matrixPackage.dependencyProofDigest",
    )),
    toolchainManifestDigest: parseSha256Hex(expectSha256(record.toolchainManifestDigest, "matrixPackage.toolchainManifestDigest")),
    inputsDigest: parseSha256Hex(expectSha256(record.inputsDigest, "matrixPackage.inputsDigest")),
    environmentDigest: parseSha256Hex(expectSha256(record.environmentDigest, "matrixPackage.environmentDigest")),
    controllerDigest: parseSha256Hex(expectSha256(record.controllerDigest, "matrixPackage.controllerDigest")),
    packageDigest: parseSha256Hex(expectSha256(record.packageDigest, "matrixPackage.packageDigest")),
    initialArtifact: artifactIdentityFromWire(record.initialArtifact, "matrixPackage.initialArtifact"),
  });
}

function exactDirectoryEntries(
  directory: string,
  expected: readonly string[],
  label: string,
): void {
  const stat = lstatSync(directory);
  if (!stat.isDirectory() || stat.isSymbolicLink()) {
    throw new MatrixControllerFailure(`${label} is not one plain directory`);
  }
  const actual = readdirSync(directory).sort((left, right) => Buffer.compare(Buffer.from(left), Buffer.from(right)));
  const orderedExpected = [...expected].sort((left, right) => Buffer.compare(Buffer.from(left), Buffer.from(right)));
  if (JSON.stringify(actual) !== JSON.stringify(orderedExpected)) {
    throw new MatrixControllerFailure(`${label} has missing or extra entries`);
  }
}

function enumeratePlainFiles(root: string): readonly RepositoryRelativePath[] {
  const files: RepositoryRelativePath[] = [];
  const visit = (directory: string, prefix: string): void => {
    const stat = lstatSync(directory);
    if (!stat.isDirectory() || stat.isSymbolicLink()) {
      throw new MatrixControllerFailure("matrix package namespace contains a non-plain directory");
    }
    const names = readdirSync(directory).sort((left, right) => Buffer.compare(Buffer.from(left), Buffer.from(right)));
    const folded = new Set<string>();
    for (const name of names) {
      const path = prefix.length === 0 ? name : `${prefix}/${name}`;
      const canonical = repositoryRelativePath(path);
      const foldedPath = canonical.toLowerCase();
      if (folded.has(foldedPath)) throw new MatrixControllerFailure("matrix package namespace has a case collision");
      folded.add(foldedPath);
      const absolute = resolve(directory, name);
      const child = lstatSync(absolute);
      if (child.isSymbolicLink()) throw new MatrixControllerFailure(`matrix package namespace contains a symlink: ${canonical}`);
      if (child.isDirectory()) visit(absolute, canonical);
      else if (child.isFile()) files.push(canonical);
      else throw new MatrixControllerFailure(`matrix package namespace contains a non-file: ${canonical}`);
    }
  };
  visit(root, "");
  return Object.freeze(files.sort(compareUtf8Paths));
}

export function writeMatrixCheckPackage(
  captured: CapturedMatrixPackage,
  targetPath: string,
): string {
  assertMatrixDependencyEvidence(
    captured.source,
    captured.dependencyManifestBytes,
    captured.dependencyProofDigest,
  );
  const rebuiltInputs = makeMatrixInputsCertificate({
    sourceRows: captured.source.rows,
    dependencyRows: [],
  });
  if (rebuiltInputs.digest !== captured.inputs.digest) {
    throw new MatrixControllerFailure("matrix package inputs differ from its captured source and dependency closure");
  }
  const target = resolve(targetPath);
  const parent = dirname(target);
  assertWithin(parent, target, "matrix check-package target");
  if (existsSync(target)) throw new MatrixControllerFailure("matrix check-package target already exists");
  mkdirSync(parent, { recursive: true });
  const temp = resolve(parent, `.${target.split(/[\\/]/u).at(-1)!}.m3b-${process.pid}-${randomBytes(12).toString("hex")}.tmp`);
  assertWithin(parent, temp, "matrix check-package temp");
  mkdirSync(temp, { recursive: false });
  let owned = true;
  try {
    const sourceRoot = resolve(temp, "source");
    mkdirSync(sourceRoot, { recursive: true });
    for (const row of captured.source.rows) {
      const bytes = captured.source.bytes.get(row.path);
      if (bytes === undefined || bytes.byteLength !== row.byteLength || sha256Raw(bytes) !== row.sha256) {
        throw new MatrixControllerFailure(`matrix package source row differs from capture: ${row.path}`);
      }
      const destination = resolve(sourceRoot, ...row.path.split("/"));
      assertWithin(sourceRoot, destination, row.path);
      mkdirSync(dirname(destination), { recursive: true });
      writeFileSync(destination, bytes, { flag: "wx" });
    }
    const artifactRoot = resolve(temp, "artifact");
    mkdirSync(artifactRoot, { recursive: true });
    if (captured.documentBytes !== null) {
      writeFileSync(resolve(artifactRoot, "SELF_HOST_MATRIX.md"), captured.documentBytes, { flag: "wx" });
    }
    const dependencyRoot = resolve(temp, "dependencies");
    mkdirSync(dependencyRoot, { recursive: true });
    writeFileSync(
      resolve(dependencyRoot, MATRIX_DEPENDENCY_MANIFEST_NAME),
      captured.dependencyManifestBytes,
      { flag: "wx" },
    );
    const environmentRoot = resolve(temp, "environment");
    mkdirSync(environmentRoot, { recursive: true });
    writeFileSync(
      resolve(environmentRoot, "fenel-artifact-toolchains.json"),
      captured.toolchainManifestBytes,
      { flag: "wx" },
    );
    writeFileSync(resolve(temp, "metadata.json"), encodeCanonicalJson(packageMetadata(captured)), { flag: "wx" });
    renameSync(temp, target);
    owned = false;
    syncDirectoryBestEffort(parent);
    let published: CapturedMatrixPackage;
    try {
      published = loadMatrixCheckPackage(captured.repositoryRoot, target);
    } catch (error) {
      rmSync(target, { recursive: true, force: false });
      syncDirectoryBestEffort(parent);
      throw error;
    }
    if (published.packageDigest !== captured.packageDigest) {
      throw new MatrixControllerFailure("published matrix check package identity differs from capture");
    }
    return target;
  } finally {
    if (owned && existsSync(temp)) rmSync(temp, { recursive: true, force: false });
  }
}

export function loadMatrixCheckPackage(
  repositoryRoot: string,
  packagePath: string,
): CapturedMatrixPackage {
  const root = resolve(packagePath);
  exactDirectoryEntries(
    root,
    ["artifact", "dependencies", "environment", "metadata.json", "source"],
    "matrix check package",
  );
  const metadataPath = resolve(root, "metadata.json");
  const metadataStat = lstatSync(metadataPath);
  if (!metadataStat.isFile() || metadataStat.isSymbolicLink()) throw new MatrixControllerFailure("matrix package metadata is not plain");
  const metadata = parsePackageMetadata(new Uint8Array(readFileSync(metadataPath)));
  exactDirectoryEntries(resolve(root, "environment"), ["fenel-artifact-toolchains.json"], "matrix package environment");
  const toolchainPath = resolve(root, "environment", "fenel-artifact-toolchains.json");
  const toolchainStat = lstatSync(toolchainPath);
  if (!toolchainStat.isFile() || toolchainStat.isSymbolicLink()) throw new MatrixControllerFailure("matrix package toolchain manifest is not plain");
  const toolchainManifestBytes = new Uint8Array(readFileSync(toolchainPath));
  if (sha256Raw(toolchainManifestBytes) !== metadata.toolchainManifestDigest) {
    throw new MatrixControllerFailure("matrix package toolchain manifest digest mismatch");
  }
  const dependencyRoot = resolve(root, "dependencies");
  exactDirectoryEntries(
    dependencyRoot,
    [MATRIX_DEPENDENCY_MANIFEST_NAME],
    "matrix package dependencies",
  );
  const dependencyManifestPath = resolve(dependencyRoot, MATRIX_DEPENDENCY_MANIFEST_NAME);
  const dependencyManifestStat = lstatSync(dependencyManifestPath);
  if (!dependencyManifestStat.isFile() || dependencyManifestStat.isSymbolicLink()) {
    throw new MatrixControllerFailure("matrix package dependency manifest is not plain");
  }
  const dependencyManifestBytes = new Uint8Array(readFileSync(dependencyManifestPath));
  if (sha256Raw(dependencyManifestBytes) !== metadata.dependencyManifestDigest) {
    throw new MatrixControllerFailure("matrix package dependency manifest digest mismatch");
  }
  const sourceRoot = resolve(root, "source");
  const source = scanMatrixSource(sourceRoot);
  const enumerated = enumeratePlainFiles(sourceRoot);
  if (JSON.stringify(enumerated) !== JSON.stringify(source.rows.map((row) => row.path))) {
    throw new MatrixControllerFailure("matrix package source namespace has unowned extra files");
  }
  assertClosedMatrixRuntime(source);
  assertMatrixDependencyEvidence(source, dependencyManifestBytes, metadata.dependencyProofDigest);
  const inputs = makeMatrixInputsCertificate({
    sourceRows: source.rows,
    dependencyRows: [],
  });
  if (
    inputs.source.digest !== metadata.sourceDigest
    || inputs.dependencies.digest !== metadata.dependencyDigest
    || inputs.digest !== metadata.inputsDigest
  ) {
    throw new MatrixControllerFailure("matrix package input certificate mismatch");
  }
  const environment = captureMatrixEnvironment(repositoryRoot, toolchainManifestBytes);
  if (environment.certificate.digest !== metadata.environmentDigest) {
    throw new MatrixControllerFailure("matrix package environment is foreign to this check process");
  }
  const controller = computeMatrixControllerDigest(source);
  if (controller !== metadata.controllerDigest) throw new MatrixControllerFailure("matrix package controller digest mismatch");
  if (controller !== rawControllerDigest(repositoryRoot)) {
    throw new MatrixControllerFailure("matrix package controller differs from the executing controller");
  }
  const artifactRoot = resolve(root, "artifact");
  exactDirectoryEntries(
    artifactRoot,
    metadata.initialArtifact.kind === "present" ? ["SELF_HOST_MATRIX.md"] : [],
    "matrix package artifact",
  );
  let documentBytes: Uint8Array | null = null;
  if (metadata.initialArtifact.kind === "present") {
    const artifactPath = resolve(artifactRoot, "SELF_HOST_MATRIX.md");
    const artifactStat = lstatSync(artifactPath);
    if (!artifactStat.isFile() || artifactStat.isSymbolicLink()) {
      throw new MatrixControllerFailure("matrix package artifact is not plain");
    }
    documentBytes = new Uint8Array(readFileSync(artifactPath));
  }
  if (JSON.stringify(matrixArtifactIdentity(documentBytes)) !== JSON.stringify(metadata.initialArtifact)) {
    throw new MatrixControllerFailure("matrix package artifact identity mismatch");
  }
  const packageDigest = computeMatrixPackageDigest({
    inputsDigest: inputs.digest,
    environmentDigest: environment.certificate.digest,
    controllerDigest: controller,
    sourceCommit: metadata.sourceCommit,
    verified: metadata.verified,
    verifiedAtSha: metadata.verifiedAtSha,
    initialArtifact: metadata.initialArtifact,
  });
  if (packageDigest !== metadata.packageDigest) throw new MatrixControllerFailure("matrix package digest mismatch");
  return Object.freeze({
    repositoryRoot: resolve(repositoryRoot),
    source,
    inputs,
    environment: environment.certificate,
    sourceCommit: metadata.sourceCommit,
    verified: metadata.verified,
    verifiedAtSha: metadata.verifiedAtSha,
    controllerDigest: controller,
    packageDigest,
    documentBytes,
    observation: documentBytes === null ? null : parseMatrixDocument(documentBytes),
    artifactBefore: metadata.initialArtifact,
    workerEnvironment: environment.worker,
    toolchainManifestBytes,
    dependencyManifestBytes,
    dependencyProofDigest: metadata.dependencyProofDigest,
  });
}

/** Load the closed package first, then reproduce its dependency closure cold. */
export async function loadVerifiedMatrixCheckPackage(
  repositoryRoot: string,
  packagePath: string,
  verifyColdDependencies: MatrixColdDependencyVerifier = verifyColdMatrixDependencies,
): Promise<CapturedMatrixPackage> {
  const captured = loadMatrixCheckPackage(repositoryRoot, packagePath);
  await verifyColdDependencies({
    repositoryRoot: captured.repositoryRoot,
    source: captured.source,
    toolchainManifestBytes: captured.toolchainManifestBytes,
    dependencyManifestBytes: captured.dependencyManifestBytes,
    dependencyProofDigest: captured.dependencyProofDigest,
  });
  return captured;
}

function snapshotDirectory(captured: CapturedMatrixPackage): string {
  const root = resolve(captured.repositoryRoot, MATRIX_SNAPSHOT_ROOT);
  mkdirSync(root, { recursive: true });
  const rootStat = lstatSync(root);
  if (!rootStat.isDirectory() || rootStat.isSymbolicLink()) {
    throw new MatrixControllerFailure("matrix snapshot namespace is not one plain directory");
  }
  const directory = resolve(root, `matrix-${process.pid}-${randomBytes(12).toString("hex")}`);
  assertWithin(root, directory, "matrix snapshot");
  mkdirSync(directory, { recursive: false });
  try {
    writeFileSync(resolve(directory, MATRIX_SNAPSHOT_MARKER), JSON.stringify({
      schema: "fenel.self-host-matrix-snapshot-owner.v1",
      packageDigest: captured.packageDigest,
    }) + "\n", { flag: "wx" });
    return directory;
  } catch (error) {
    rmSync(directory, { recursive: true, force: false });
    throw error;
  }
}

function matrixReportSourceDigest(captured: CapturedMatrixPackage): Sha256Hex {
  const bytes = captured.source.bytes.get(MATRIX_REPORT_SOURCE_PATH);
  if (bytes === undefined) {
    throw new MatrixControllerFailure(`captured matrix package omits ${MATRIX_REPORT_SOURCE_PATH}`);
  }
  const row = captured.source.rows.find((candidate) => candidate.path === MATRIX_REPORT_SOURCE_PATH);
  const digest = sha256Raw(bytes);
  if (row === undefined || row.byteLength !== bytes.byteLength || row.sha256 !== digest) {
    throw new MatrixControllerFailure("captured matrix report source differs from its manifest row");
  }
  return digest;
}

export function matrixRenderRequestBytes(
  captured: CapturedMatrixPackage,
  progress: boolean,
): Uint8Array {
  return encodeCanonicalJson(Object.freeze({
    schema: MATRIX_WORKER_REQUEST_SCHEMA,
    task: "render" as const,
    reportSource: MATRIX_REPORT_SOURCE_PATH,
    reportSourceDigest: matrixReportSourceDigest(captured),
    progress,
    presentation: Object.freeze({
      verified: captured.verified,
      verifiedAtSha: captured.verifiedAtSha,
    }),
    outputs: Object.freeze({
      candidate: MATRIX_REPORT_CANDIDATE_OUTPUT_PATH,
      rawFacets: MATRIX_REPORT_RAW_FACETS_OUTPUT_PATH,
      audit: MATRIX_REPORT_AUDIT_OUTPUT_PATH,
    }),
  }));
}

function expectWireBoolean(value: unknown, path: string): boolean {
  if (typeof value !== "boolean") {
    throw new MatrixControllerFailure(`${path}: expected boolean`);
  }
  return value;
}

function sortedUniqueWireStrings(value: unknown, path: string): readonly string[] {
  const values = expectWireArray(value, path).map((entry, index) =>
    expectNonEmptyWireString(entry, `${path}[${index}]`));
  for (let index = 1; index < values.length; index += 1) {
    if (compareUtf8(values[index - 1]!, values[index]!) >= 0) {
      throw new MatrixControllerFailure(`${path}: expected UTF-8 ordered unique strings`);
    }
  }
  return Object.freeze(values);
}

export function decodeMatrixRawFacets(bytes: Uint8Array): MatrixRawFacetProjection {
  const record = expectWireRecord(parseCanonicalJson(bytes), "matrixRawFacets");
  expectClosedKeys(record, ["schema", "rows"], [], "matrixRawFacets");
  expectWireLiteral(
    record.schema,
    [MATRIX_REPORT_RAW_FACETS_SCHEMA] as const,
    "matrixRawFacets.schema",
  );
  const rows = expectWireArray(record.rows, "matrixRawFacets.rows").map((value, index) => {
    const path = `matrixRawFacets.rows[${index}]`;
    const row = expectWireRecord(value, path);
    expectClosedKeys(
      row,
      ["fnId", "categoryPresent", "category", "tagsPresent", "tags"],
      [],
      path,
    );
    const fnId = expectNonEmptyWireString(row.fnId, `${path}.fnId`);
    const categoryPresent = expectWireBoolean(row.categoryPresent, `${path}.categoryPresent`);
    const category = expectWireString(row.category, `${path}.category`);
    const tagsPresent = expectWireBoolean(row.tagsPresent, `${path}.tagsPresent`);
    const tags = Object.freeze(expectWireArray(row.tags, `${path}.tags`).map((tag, tagIndex) =>
      expectWireString(tag, `${path}.tags[${tagIndex}]`)));
    if (!categoryPresent && category.length !== 0) {
      throw new MatrixControllerFailure(`${path}: absent category must use the canonical empty string`);
    }
    if ((!tagsPresent && tags.length !== 0) || (tags.length > 0 && !tagsPresent)) {
      throw new MatrixControllerFailure(`${path}: tag presence differs from its declared list`);
    }
    return Object.freeze({ fnId, categoryPresent, category, tagsPresent, tags });
  });
  for (let index = 1; index < rows.length; index += 1) {
    if (compareUtf8(rows[index - 1]!.fnId, rows[index]!.fnId) >= 0) {
      throw new MatrixControllerFailure("matrixRawFacets.rows: expected UTF-8 ordered unique fnIds");
    }
  }
  return Object.freeze({ schema: MATRIX_REPORT_RAW_FACETS_SCHEMA, rows: Object.freeze(rows) });
}

export function decodeMatrixReportAudit(
  bytes: Uint8Array,
  reportSourceDigest: Sha256Hex,
): MatrixReportAudit {
  const record = expectWireRecord(parseCanonicalJson(bytes), "matrixReportAudit");
  expectClosedKeys(record, [
    "schema",
    "categoryCount",
    "categoryPreimage",
    "categoryDigest",
    "tagCount",
    "tagPreimage",
    "tagDigest",
    "categorizableRepresentativeIds",
    "taggableRepresentativeIds",
    "rosterCount",
    "rosterKeys",
    "acquisitionKeys",
    "rowCount",
    "declaredObservedAsymmetryCount",
    "declaredObservedAsymmetries",
    "groupingFacts",
    "reportSourceDigest",
  ], [], "matrixReportAudit");
  expectWireLiteral(record.schema, [MATRIX_REPORT_AUDIT_SCHEMA] as const, "matrixReportAudit.schema");
  const categoryCount = expectSafeUint(record.categoryCount, "matrixReportAudit.categoryCount");
  const categoryPreimage = expectNonEmptyWireString(
    record.categoryPreimage,
    "matrixReportAudit.categoryPreimage",
  );
  const categoryDigest = parseSha256Hex(expectSha256(
    record.categoryDigest,
    "matrixReportAudit.categoryDigest",
  ));
  const tagCount = expectSafeUint(record.tagCount, "matrixReportAudit.tagCount");
  const tagPreimage = expectNonEmptyWireString(record.tagPreimage, "matrixReportAudit.tagPreimage");
  const tagDigest = parseSha256Hex(expectSha256(record.tagDigest, "matrixReportAudit.tagDigest"));
  const categorizableRepresentativeIds = sortedUniqueWireStrings(
    record.categorizableRepresentativeIds,
    "matrixReportAudit.categorizableRepresentativeIds",
  );
  const taggableRepresentativeIds = sortedUniqueWireStrings(
    record.taggableRepresentativeIds,
    "matrixReportAudit.taggableRepresentativeIds",
  );
  const rosterCount = expectSafeUint(record.rosterCount, "matrixReportAudit.rosterCount");
  const rosterKeys = Object.freeze(expectWireArray(record.rosterKeys, "matrixReportAudit.rosterKeys")
    .map((value, index) => expectNonEmptyWireString(value, `matrixReportAudit.rosterKeys[${index}]`)));
  const acquisitionKeys = Object.freeze(expectWireArray(
    record.acquisitionKeys,
    "matrixReportAudit.acquisitionKeys",
  ).map((value, index) =>
    expectNonEmptyWireString(value, `matrixReportAudit.acquisitionKeys[${index}]`)));
  const rowCount = expectSafeUint(record.rowCount, "matrixReportAudit.rowCount");
  const declaredObservedAsymmetryCount = expectSafeUint(
    record.declaredObservedAsymmetryCount,
    "matrixReportAudit.declaredObservedAsymmetryCount",
  );
  const declaredObservedAsymmetries = Object.freeze(expectWireArray(record.declaredObservedAsymmetries, "matrixReportAudit.declaredObservedAsymmetries")
    .map((value, index) => {
      const path = `matrixReportAudit.declaredObservedAsymmetries[${index}]`;
      const entry = expectWireRecord(value, path);
      expectClosedKeys(entry, ["fnId", "target", "className", "declared", "observed"], [], path);
      return Object.freeze({
        fnId: expectNonEmptyWireString(entry.fnId, `${path}.fnId`),
        target: expectWireLiteral(entry.target, ["js", "wasm", "llvm"] as const, `${path}.target`),
        className: expectWireLiteral(entry.className, ["stale-gap", "silent-skip", "escaped-fail"] as const, `${path}.className`),
        declared: expectNonEmptyWireString(entry.declared, `${path}.declared`),
        observed: expectNonEmptyWireString(entry.observed, `${path}.observed`),
      });
    }));
  if (declaredObservedAsymmetryCount !== declaredObservedAsymmetries.length) {
    throw new MatrixControllerFailure("matrix report audit asymmetry count differs from its source entries");
  }
  const groupingFacts = Object.freeze(expectWireArray(record.groupingFacts, "matrixReportAudit.groupingFacts")
    .map((value, index) => {
      const path = `matrixReportAudit.groupingFacts[${index}]`;
      const fact = expectWireRecord(value, path);
      expectClosedKeys(fact, ["fnId", "area"], [], path);
      return Object.freeze({
        fnId: expectNonEmptyWireString(fact.fnId, `${path}.fnId`),
        area: expectNonEmptyWireString(fact.area, `${path}.area`),
      });
    }));
  const observedReportSourceDigest = parseSha256Hex(expectSha256(
    record.reportSourceDigest,
    "matrixReportAudit.reportSourceDigest",
  ));
  if (
    categoryCount === 0
    || tagCount === 0
    || categoryCount !== categorizableRepresentativeIds.length
    || tagCount !== taggableRepresentativeIds.length
  ) {
    throw new MatrixControllerFailure("matrix report audit has empty or inconsistent facet evidence");
  }
  if (!categoryPreimage.startsWith(`${MATRIX_CATEGORY_PREIMAGE_PREFIX}${categoryCount}\n`)) {
    throw new MatrixControllerFailure("matrix report category preimage has the wrong domain/count header");
  }
  if (!tagPreimage.startsWith(`${MATRIX_TAG_PREIMAGE_PREFIX}${tagCount}\n`)) {
    throw new MatrixControllerFailure("matrix report tag preimage has the wrong domain/count header");
  }
  if (sha256Raw(categoryPreimage) !== categoryDigest || sha256Raw(tagPreimage) !== tagDigest) {
    throw new MatrixControllerFailure("matrix report audit preimage digest differs from its bytes");
  }
  if (
    rosterCount !== MATRIX_EXPECTED_ROSTER_COUNT
    || rosterKeys.length !== rosterCount
    || new Set(rosterKeys).size !== rosterKeys.length
    || acquisitionKeys.length !== rosterCount
    || new Set(acquisitionKeys).size !== acquisitionKeys.length
    || JSON.stringify([...acquisitionKeys].sort(compareUtf8))
      !== JSON.stringify([...rosterKeys].sort(compareUtf8))
  ) {
    throw new MatrixControllerFailure("matrix report audit roster evidence is not the exact closed bijection extent");
  }
  if (declaredObservedAsymmetryCount !== 0) {
    throw new MatrixControllerFailure(`matrix report audit contains declared/observed asymmetries: ${JSON.stringify(declaredObservedAsymmetries)}`);
  }
  if (JSON.stringify(groupingFacts) !== JSON.stringify(MATRIX_EXPECTED_GROUPING_FACTS)) {
    throw new MatrixControllerFailure("matrix report audit grouping facts differ from the intended projection");
  }
  if (observedReportSourceDigest !== reportSourceDigest) {
    throw new MatrixControllerFailure("matrix report audit source digest differs from captured report bytes");
  }
  return Object.freeze({
    schema: MATRIX_REPORT_AUDIT_SCHEMA,
    categoryCount,
    categoryPreimage,
    categoryDigest,
    tagCount,
    tagPreimage,
    tagDigest,
    categorizableRepresentativeIds,
    taggableRepresentativeIds,
    rosterCount,
    rosterKeys,
    acquisitionKeys,
    rowCount,
    declaredObservedAsymmetryCount,
    declaredObservedAsymmetries,
    groupingFacts,
    reportSourceDigest: observedReportSourceDigest,
  });
}

function validateMatrixReportEvidence(
  captured: CapturedMatrixPackage,
  candidateBytes: Uint8Array,
  rawFacetBytes: Uint8Array,
  auditBytes: Uint8Array,
): Readonly<{
  observation: MatrixDocumentObservation;
  rawFacets: MatrixRawFacetProjection;
  audit: MatrixReportAudit;
}> {
  let candidateText: string;
  try {
    candidateText = new TextDecoder("utf-8", { fatal: true }).decode(candidateBytes);
  } catch {
    throw new MatrixControllerFailure("matrix render candidate is not valid UTF-8");
  }
  if (!candidateText.endsWith("\n") || candidateText.includes("\r")) {
    throw new MatrixControllerFailure("matrix render candidate must be LF-only and LF-terminated");
  }
  const observation = parseMatrixDocument(candidateBytes);
  if (observation.stampClass !== "absent") {
    throw new MatrixControllerFailure("matrix render candidate must be unstamped");
  }
  if (
    observation.presentation.verified !== captured.verified
    || observation.presentation.verifiedAtSha !== captured.verifiedAtSha
  ) {
    throw new MatrixControllerFailure("matrix render candidate presentation differs from its capture");
  }
  const rawFacets = decodeMatrixRawFacets(rawFacetBytes);
  if (rawFacets.rows.length === 0) {
    throw new MatrixControllerFailure("matrix raw facet projection is empty");
  }
  const audit = decodeMatrixReportAudit(auditBytes, matrixReportSourceDigest(captured));
  if (audit.rowCount !== rawFacets.rows.length) {
    throw new MatrixControllerFailure("matrix audit row count differs from the raw facet projection");
  }
  const rawCategoryIds = rawFacets.rows
    .filter((row) => row.categoryPresent)
    .map((row) => row.fnId);
  const rawTagIds = rawFacets.rows
    .filter((row) => row.tagsPresent)
    .map((row) => row.fnId);
  if (
    audit.categoryCount !== rawCategoryIds.length
    || JSON.stringify(audit.categorizableRepresentativeIds) !== JSON.stringify(rawCategoryIds)
    || audit.tagCount !== rawTagIds.length
    || JSON.stringify(audit.taggableRepresentativeIds) !== JSON.stringify(rawTagIds)
  ) {
    throw new MatrixControllerFailure("matrix audit facet representatives differ from raw presence evidence");
  }
  const pinned = [
    Object.freeze({
      fnId: "std:.",
      category: "function",
      tags: ["function", "combinator", "operator", "higher-order"] as const,
    }),
    Object.freeze({
      fnId: "engine:llvmDomainToValType",
      category: "engine-internal",
      tags: ["engine", "internal", "llvm", "phase-21"] as const,
    }),
  ] as const;
  for (const expected of pinned) {
    const row = rawFacets.rows.find((candidate) => candidate.fnId === expected.fnId);
    if (
      row === undefined
      || !row.categoryPresent
      || row.category !== expected.category
      || !row.tagsPresent
      || JSON.stringify(row.tags) !== JSON.stringify(expected.tags)
      || !audit.categorizableRepresentativeIds.includes(expected.fnId)
      || !audit.taggableRepresentativeIds.includes(expected.fnId)
    ) {
      throw new MatrixControllerFailure(`matrix report omits pinned raw facet evidence for ${expected.fnId}`);
    }
  }
  return Object.freeze({ observation, rawFacets, audit });
}

function materializeMatrixPackage(
  captured: CapturedMatrixPackage,
  task: "render" | "report-smoke" = "render",
  progress = false,
): string {
  const directory = snapshotDirectory(captured);
  try {
    for (const row of captured.source.rows) {
      const bytes = captured.source.bytes.get(row.path);
      if (bytes === undefined || bytes.byteLength !== row.byteLength || sha256Raw(bytes) !== row.sha256) {
        throw new MatrixControllerFailure(`captured matrix package row is inconsistent: ${row.path}`);
      }
      const target = resolve(directory, ...row.path.split("/"));
      assertWithin(directory, target, row.path);
      mkdirSync(dirname(target), { recursive: true });
      writeFileSync(target, bytes, { flag: "wx" });
    }
    mkdirSync(resolve(directory, ".tmp"), { recursive: true });
    mkdirSync(resolve(directory, ".bin"), { recursive: true });
    mkdirSync(resolve(directory, ".m4-private"), { recursive: false });
    const requestBytes = task === "report-smoke"
      ? MATRIX_REPORT_SMOKE_REQUEST_BYTES
      : matrixRenderRequestBytes(captured, progress);
    writeFileSync(resolve(directory, MATRIX_WORKER_REQUEST_PATH), requestBytes, { flag: "wx" });
    const requestRow = Object.freeze({
      path: repositoryRelativePath(MATRIX_WORKER_REQUEST_PATH),
      kind: "regular-file" as const,
      byteLength: requestBytes.byteLength,
      sha256: sha256Raw(requestBytes),
    });
    const guard = Object.freeze({
      task,
      requestPath: resolve(directory, MATRIX_WORKER_REQUEST_PATH),
      requestDigest: requestRow.sha256,
      outputPaths: (task === "report-smoke"
        ? [MATRIX_REPORT_SMOKE_OUTPUT_PATH]
        : [
          MATRIX_REPORT_CANDIDATE_OUTPUT_PATH,
          MATRIX_REPORT_RAW_FACETS_OUTPUT_PATH,
          MATRIX_REPORT_AUDIT_OUTPUT_PATH,
        ]).map((path) => resolve(directory, path)),
    });
    const guardBytes = new TextEncoder().encode(
      matrixWorkerGuardSource(
        resolve(directory, MATRIX_WORKER_GUARD_TRACE_PATH),
        resolve(directory, SELF_HOST_MATRIX_GENERATOR_PATH),
        guard,
      ),
    );
    writeFileSync(resolve(directory, MATRIX_WORKER_GUARD_PATH), guardBytes, { flag: "wx" });
    const runtimeManifest = digestByteManifest("self-host-matrix-worker-runtime", [
      ...captured.source.rows,
      Object.freeze({
        path: repositoryRelativePath(MATRIX_WORKER_GUARD_PATH),
        kind: "regular-file" as const,
        byteLength: guardBytes.byteLength,
        sha256: sha256Raw(guardBytes),
      }),
      requestRow,
    ]);
    writeFileSync(
      resolve(directory, MATRIX_WORKER_MANIFEST_PATH),
      encodeCanonicalJson(runtimeManifest),
      { flag: "wx" },
    );
    return directory;
  } catch (error) {
    cleanupSnapshot(captured.repositoryRoot, directory);
    throw error;
  }
}

export function matrixWorkerGuardSource(
  tracePath: string,
  workerPath = resolve(dirname(tracePath), SELF_HOST_MATRIX_GENERATOR_PATH),
  worker?: Readonly<{
    task: "render" | "report-smoke";
    requestPath: string;
    requestDigest: Sha256Hex;
    outputPaths: readonly string[];
  }>,
): string {
  const configuration = JSON.stringify({
    tracePath: resolve(tracePath),
    workerPath: resolve(workerPath),
    manifestPath: resolve(dirname(tracePath), MATRIX_WORKER_MANIFEST_PATH),
    outputPaths: worker?.outputPaths.map((path) => resolve(path))
      ?? [resolve(dirname(tracePath), SELF_HOST_MATRIX_PATH)],
    task: worker?.task ?? "render",
    requestPath: worker?.requestPath ?? null,
    requestDigest: worker?.requestDigest ?? null,
    builtins: [...MATRIX_GUARD_RUNTIME_BUILTINS].sort(),
  });
  return String.raw`// Snapshot-local M3b matrix capability and input guard. Generated by the controller.
import { createHash } from "node:crypto";
import { appendFileSync, lstatSync, readFileSync, realpathSync } from "node:fs";
import Module, { createRequire } from "node:module";
import { dirname, isAbsolute, relative, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";

const configuration = __MATRIX_GUARD_CONFIGURATION__;
const requestedRoot = dirname(configuration.tracePath);
const snapshotRoot = realpathSync.native(requestedRoot);
const tracePath = resolve(snapshotRoot, relative(requestedRoot, configuration.tracePath));
const manifestPath = resolve(snapshotRoot, relative(requestedRoot, configuration.manifestPath));
const outputPaths = configuration.outputPaths.map((path) =>
  resolve(snapshotRoot, relative(requestedRoot, path)));
const outputPathSet = new Set(outputPaths);
const workerPath = resolve(snapshotRoot, relative(requestedRoot, configuration.workerPath));
const requestPath = configuration.requestPath === null
  ? null
  : resolve(snapshotRoot, relative(requestedRoot, configuration.requestPath));
const privilegedAppendFileSync = appendFileSync;
const privilegedReadFileSync = readFileSync;
const privilegedLstatSync = lstatSync;
const allowedBuiltins = new Set(configuration.builtins);
let gitAttempts = 0;
let unexpectedAttempts = 0;
const record = (value) => privilegedAppendFileSync(tracePath, JSON.stringify(value) + "\n", "utf8");

const rootStat = privilegedLstatSync(snapshotRoot);
if (!rootStat.isDirectory() || rootStat.isSymbolicLink()) throw new Error("matrix snapshot root is not plain");
const manifestStat = privilegedLstatSync(manifestPath);
if (!manifestStat.isFile() || manifestStat.isSymbolicLink()) throw new Error("matrix worker manifest is not plain");
const manifest = JSON.parse(privilegedReadFileSync(manifestPath, "utf8"));
if (manifest === null || typeof manifest !== "object" || Array.isArray(manifest)) {
  throw new Error("matrix worker manifest is not an object");
}
if (Object.keys(manifest).sort().join("\0") !== ["byteLength", "digest", "domain", "fileCount", "rows", "schema"].join("\0")) {
  throw new Error("matrix worker manifest has unknown or missing fields");
}
if (manifest.schema !== "fenel.byte-manifest.v1" || manifest.domain !== "self-host-matrix-worker-runtime" || !Array.isArray(manifest.rows)) {
  throw new Error("matrix worker manifest has the wrong schema");
}

const utf8 = new TextEncoder();
const compareUtf8 = (left, right) => {
  const a = utf8.encode(left);
  const b = utf8.encode(right);
  const bound = Math.min(a.length, b.length);
  for (let index = 0; index < bound; index += 1) {
    if (a[index] !== b[index]) return a[index] - b[index];
  }
  return a.length - b.length;
};
const within = (root, target) => {
  const rel = relative(root, target);
  return rel === "" || (!isAbsolute(rel) && rel !== ".." && !rel.startsWith(".." + sep));
};
const canonicalAbsolute = (value) => {
  const absolute = resolve(value);
  for (const base of [snapshotRoot, requestedRoot]) {
    const rel = relative(base, absolute);
    if (rel === "" || (!isAbsolute(rel) && rel !== ".." && !rel.startsWith(".." + sep))) {
      return resolve(snapshotRoot, rel);
    }
  }
  return absolute;
};
const pathValue = (value) => {
  if (typeof value === "string") return value.startsWith("file:") ? fileURLToPath(value) : value;
  if (value instanceof URL) return fileURLToPath(value);
  if (value instanceof Uint8Array) return new TextDecoder("utf-8", { fatal: true }).decode(value);
  throw new Error("matrix filesystem path is not a pathname");
};
const plainFile = (absolute) => {
  if (!within(snapshotRoot, absolute)) throw new Error("matrix materialized path escapes the snapshot");
  const rel = relative(snapshotRoot, absolute);
  let cursor = snapshotRoot;
  const parts = rel.split(/[\\/]/u);
  for (let index = 0; index < parts.length; index += 1) {
    cursor = resolve(cursor, parts[index]);
    const stat = privilegedLstatSync(cursor);
    if (stat.isSymbolicLink()) throw new Error("matrix materialized path contains a link");
    if (index === parts.length - 1 ? !stat.isFile() : !stat.isDirectory()) {
      throw new Error("matrix materialized path is not plain");
    }
  }
};

const rows = new Map();
const orderedRows = [];
const directories = new Set([snapshotRoot]);
const directoryChildren = new Map();
let previousPath;
for (const row of manifest.rows) {
  if (row === null || typeof row !== "object" || Array.isArray(row)) throw new Error("matrix worker row is not an object");
  if (Object.keys(row).sort().join("\0") !== ["byteLength", "kind", "path", "sha256"].join("\0")) {
    throw new Error("matrix worker row has unknown or missing fields");
  }
  if (typeof row.path !== "string" || row.path.length === 0 || row.path.includes("\\") || row.path.startsWith("/") || row.path.split("/").some((part) => part === "" || part === "." || part === "..")) {
    throw new Error("matrix worker row path is not portable");
  }
  if (previousPath !== undefined && compareUtf8(previousPath, row.path) >= 0) throw new Error("matrix worker rows are not ordered");
  previousPath = row.path;
  if (row.kind !== "regular-file" || !Number.isSafeInteger(row.byteLength) || row.byteLength < 0 || typeof row.sha256 !== "string" || !/^[0-9a-f]{64}$/u.test(row.sha256)) {
    throw new Error("matrix worker row is malformed");
  }
  const absolute = resolve(snapshotRoot, ...row.path.split("/"));
  if (!within(snapshotRoot, absolute) || rows.has(absolute)) throw new Error("matrix worker row escapes or duplicates");
  plainFile(absolute);
  const bytes = privilegedReadFileSync(absolute);
  const digest = createHash("sha256").update(bytes).digest("hex");
  if (bytes.byteLength !== row.byteLength || digest !== row.sha256) throw new Error("matrix worker row bytes differ from manifest");
  rows.set(absolute, { path: row.path, byteLength: row.byteLength, digest: row.sha256 });
  orderedRows.push(row);
  const parts = row.path.split("/");
  let parent = snapshotRoot;
  for (let index = 0; index < parts.length; index += 1) {
    const name = parts[index];
    let children = directoryChildren.get(parent);
    if (children === undefined) {
      children = new Set();
      directoryChildren.set(parent, children);
    }
    children.add(name);
    if (index < parts.length - 1) {
      parent = resolve(parent, name);
      directories.add(parent);
    }
  }
}
const manifestDigest = createHash("sha256").update(JSON.stringify([
  "fenel.byte-manifest.v1",
  "self-host-matrix-worker-runtime",
  orderedRows.map((row) => [row.path, row.kind, row.byteLength, row.sha256]),
])).digest("hex");
const totalBytes = orderedRows.reduce((sum, row) => sum + row.byteLength, 0);
if (manifest.fileCount !== orderedRows.length || manifest.byteLength !== totalBytes || manifest.digest !== manifestDigest) {
  throw new Error("matrix worker manifest summary differs from rows");
}
const outputRelatives = outputPaths.map((path) => relative(snapshotRoot, path).replaceAll("\\", "/"));
const expectedOutputRelatives = configuration.task === "report-smoke"
  ? [".m4-private/report-smoke.json"]
  : requestPath === null
    ? ["docs/SELF_HOST_MATRIX.md"]
    : [".m4-private/candidate.md", ".m4-private/raw-facets.json", ".m4-private/audit.json"];
if (JSON.stringify(outputRelatives) !== JSON.stringify(expectedOutputRelatives)) {
  throw new Error("matrix worker output paths are not exactly owned for their task");
}
for (let index = 0; index < outputPaths.length; index += 1) {
  const outputPath = outputPaths[index];
  const outputRelative = outputRelatives[index];
  directories.add(dirname(outputPath));
  const outputChildren = directoryChildren.get(dirname(outputPath)) ?? new Set();
  outputChildren.add(outputRelative.split("/").at(-1));
  directoryChildren.set(dirname(outputPath), outputChildren);
}

const verifyRow = (absolute) => {
  const canonical = canonicalAbsolute(absolute);
  const row = rows.get(canonical);
  if (row === undefined) throw new Error("matrix read is outside the materialized manifest");
  plainFile(canonical);
  const bytes = privilegedReadFileSync(canonical);
  const digest = createHash("sha256").update(bytes).digest("hex");
  if (bytes.byteLength !== row.byteLength || digest !== row.digest) throw new Error("matrix materialized bytes changed");
  return row;
};
verifyRow(fileURLToPath(import.meta.url));
verifyRow(workerPath);
if (requestPath !== null) {
  const requestRow = verifyRow(requestPath);
  if (configuration.requestDigest !== requestRow.digest) {
    throw new Error("matrix worker authorization digest differs from its manifested request row");
  }
  const authorization = Object.freeze({
    schema: "${MATRIX_WORKER_AUTHORIZATION_SCHEMA}",
    requestPath: configuration.requestPath,
    requestDigest: requestRow.digest,
    task: configuration.task,
  });
  Object.defineProperty(globalThis, "__FENEL_SELF_HOST_MATRIX_WORKER_AUTHORIZATION__", {
    value: authorization,
    enumerable: false,
    writable: false,
    configurable: false,
  });
} else if (configuration.task !== "render" || configuration.requestDigest !== null) {
  throw new Error("matrix worker guard task configuration is not closed");
}
record({ kind: "worker-start", task: configuration.task, pid: process.pid, materializationRoot: snapshotRoot });

const denied = (surface, operation, args) => {
  const command = typeof args[0] === "string" ? args[0] : Array.isArray(args[0]) ? args[0].map(String).join(" ") : "<non-string>";
  unexpectedAttempts += 1;
  record({ kind: "subprocess-attempt", surface, operation, command, disposition: "unexpected-denied" });
  const error = new Error("unexpected subprocess/native load denied by matrix package");
  error.code = "ENOENT";
  throw error;
};
const filesystemDenied = (operation, value) => {
  unexpectedAttempts += 1;
  let path = "<non-path>";
  try {
    const absolute = canonicalAbsolute(pathValue(value));
    path = within(snapshotRoot, absolute) ? relative(snapshotRoot, absolute).replaceAll("\\", "/") : "<outside-snapshot>";
  } catch {}
  record({ kind: "filesystem-attempt", operation, path, disposition: "unexpected-denied" });
  const error = new Error("unexpected filesystem access denied by matrix package");
  error.code = "EACCES";
  throw error;
};
const capabilityDenied = (surface, operation) => {
  unexpectedAttempts += 1;
  record({ kind: "capability-attempt", surface, operation, disposition: "unexpected-denied" });
  const error = new Error("unexpected host capability denied by matrix package");
  error.code = "EACCES";
  throw error;
};
const denyCallableProperty = (target, operation, surface) => {
  Object.defineProperty(target, operation, {
    configurable: false,
    writable: false,
    value: function deniedCapability(..._args) { return capabilityDenied(surface, operation); },
  });
};
const denyReadableProperty = (target, operation, surface) => {
  const descriptor = Object.getOwnPropertyDescriptor(target, operation);
  if (descriptor !== undefined && descriptor.configurable !== true) {
    throw new Error("matrix capability guard cannot replace non-configurable " + surface + "." + String(operation));
  }
  Object.defineProperty(target, operation, {
    configurable: false,
    enumerable: descriptor?.enumerable ?? true,
    get: () => capabilityDenied(surface, String(operation)),
  });
};
const readPath = (operation, value, allowOutput) => {
  let absolute;
  try { absolute = canonicalAbsolute(pathValue(value)); }
  catch { return filesystemDenied(operation, value); }
  if (allowOutput && outputPathSet.has(absolute)) {
    record({ kind: "filesystem-read", operation, path: relative(snapshotRoot, absolute).replaceAll("\\", "/") });
    return absolute;
  }
  try {
    const row = verifyRow(absolute);
    record({ kind: "filesystem-read", operation, path: row.path, digest: row.digest });
    return absolute;
  } catch {
    return filesystemDenied(operation, value);
  }
};
const metadataPath = (operation, value) => {
  let absolute;
  try { absolute = canonicalAbsolute(pathValue(value)); }
  catch { return filesystemDenied(operation, value); }
  if (rows.has(absolute) || directories.has(absolute) || outputPathSet.has(absolute)) {
    record({ kind: "filesystem-metadata", operation, path: relative(snapshotRoot, absolute).replaceAll("\\", "/") || "." });
    return absolute;
  }
  return filesystemDenied(operation, value);
};

// Materialize every guard-owned builtin before sealing shared exports. Bun's
// builtin initializers consult one another (notably node:child_process reads
// node:os); loading one after a denied getter is installed would make guard
// initialization order, rather than worker behavior, the failure source.
const nodeCrypto = require("node:crypto");
const nodeUtil = require("node:util");
const nodeOs = require("node:os");
const nodeFs = require("node:fs");
const fsPromises = require("node:fs/promises");
const childProcess = require("node:child_process");
const ffi = require("bun:ffi");
const ffiNative = ffi.native;
const bunFfi = Bun.FFI;
const networkModules = ["node:http", "node:https", "node:http2", "node:net", "node:tls", "node:dns", "node:dns/promises", "node:dgram"].map((specifier) => {
  const loadedModule = require(specifier);
  const entries = Object.entries(loadedModule);
  const promises = loadedModule.promises !== null && typeof loadedModule.promises === "object" ? loadedModule.promises : undefined;
  const promiseEntries = promises === undefined ? [] : Object.entries(promises);
  return { specifier, module: loadedModule, entries, promises, promiseEntries };
});
// The source fence admits only the exact types.isProxy read. Retain that raw
// native predicate while sealing the cached module and util/types namespace.
const utilTypesDescriptor = Object.getOwnPropertyDescriptor(nodeUtil, "types");
if (utilTypesDescriptor === undefined || !("value" in utilTypesDescriptor)
  || utilTypesDescriptor.value === null || typeof utilTypesDescriptor.value !== "object") {
  throw new Error("matrix node:util.types is not a data namespace");
}
const originalUtilTypes = utilTypesDescriptor.value;
const isProxyDescriptor = Object.getOwnPropertyDescriptor(originalUtilTypes, "isProxy");
if (isProxyDescriptor === undefined || !("value" in isProxyDescriptor) || typeof isProxyDescriptor.value !== "function") {
  throw new Error("matrix node:util.types.isProxy is not a callable data property");
}
const nativeIsProxy = isProxyDescriptor.value;
const utilTypesTarget = Object.freeze(Object.defineProperty(Object.create(null), "isProxy", {
  configurable: false, enumerable: true, writable: false, value: nativeIsProxy,
}));
const utilTypesFacade = new Proxy(utilTypesTarget, {
  get(_target, key) {
    if (key === "isProxy") return nativeIsProxy;
    return capabilityDenied("node:util.types", String(key));
  },
});
for (const key of Reflect.ownKeys(originalUtilTypes)) {
  const descriptor = Object.getOwnPropertyDescriptor(originalUtilTypes, key);
  if (descriptor === undefined || !descriptor.configurable) {
    throw new Error("matrix cannot seal node:util/types export " + String(key));
  }
  // Including isProxy: direct util/types aliases are not the admitted route.
  denyReadableProperty(originalUtilTypes, key, "node:util/types");
}
Object.freeze(originalUtilTypes);
for (const key of Reflect.ownKeys(nodeUtil)) {
  const descriptor = Object.getOwnPropertyDescriptor(nodeUtil, key);
  if (descriptor === undefined || !descriptor.configurable) {
    throw new Error("matrix cannot seal node:util export " + String(key));
  }
  if (key === "types") {
    Object.defineProperty(nodeUtil, key, {
      configurable: false, enumerable: descriptor.enumerable, writable: false, value: utilTypesFacade,
    });
  } else {
    denyReadableProperty(nodeUtil, key, "node:util");
  }
}
Object.freeze(nodeUtil);
// Module._load is distinct from Bun's lowered require. No util acquisition is
// admitted through this route, including bare and subpath aliases.
const moduleLoadDescriptor = Object.getOwnPropertyDescriptor(Module, "_load");
if (moduleLoadDescriptor === undefined || !("value" in moduleLoadDescriptor) || typeof moduleLoadDescriptor.value !== "function") {
  throw new Error("matrix Module._load is not a callable data property");
}
const originalModuleLoad = moduleLoadDescriptor.value;
Object.defineProperty(Module, "_load", {
  configurable: false, enumerable: moduleLoadDescriptor.enumerable, writable: false,
  value: function guardedModuleLoad(...arguments_) {
    const request = arguments_[0];
    if (typeof request === "string" && (request === "util" || request === "node:util"
      || request.startsWith("util/") || request.startsWith("node:util/"))) {
      return capabilityDenied("node:util", "Module._load");
    }
    return Reflect.apply(originalModuleLoad, this, arguments_);
  },
});
const allowedNodeCryptoCallables = new Set(["createHash"]);
for (const operation of Reflect.ownKeys(nodeCrypto)) {
  if (
    typeof operation === "string"
    && !allowedNodeCryptoCallables.has(operation)
    && typeof nodeCrypto[operation] === "function"
  ) denyCallableProperty(nodeCrypto, operation, "node:crypto");
}
const guardedWebCryptos = new WeakSet();
const guardedWebCryptoPrototypes = new WeakSet();
const guardedSubtleCryptos = new WeakSet();
const guardedSubtleCryptoPrototypes = new WeakSet();
const guardWebCrypto = (webCrypto, surface) => {
  if (webCrypto === undefined || webCrypto === null || typeof webCrypto !== "object" || guardedWebCryptos.has(webCrypto)) return;
  guardedWebCryptos.add(webCrypto);
  const webCryptoPrototype = Object.getPrototypeOf(webCrypto);
  for (const operation of ["getRandomValues", "randomUUID"]) {
    if (
      webCryptoPrototype !== null
      && !guardedWebCryptoPrototypes.has(webCryptoPrototype)
      && typeof webCryptoPrototype[operation] === "function"
    ) denyCallableProperty(webCryptoPrototype, operation, surface);
    if (typeof webCrypto[operation] === "function") denyCallableProperty(webCrypto, operation, surface);
  }
  if (webCryptoPrototype !== null) guardedWebCryptoPrototypes.add(webCryptoPrototype);
  const subtle = webCrypto.subtle;
  if (subtle !== null && typeof subtle === "object" && !guardedSubtleCryptos.has(subtle)) {
    guardedSubtleCryptos.add(subtle);
    const subtlePrototype = Object.getPrototypeOf(subtle);
    const operations = subtlePrototype === null ? [] : Reflect.ownKeys(subtlePrototype);
    for (const operation of operations) {
      if (typeof operation === "string" && operation !== "constructor" && typeof subtle[operation] === "function") {
        if (!guardedSubtleCryptoPrototypes.has(subtlePrototype)) {
          denyCallableProperty(subtlePrototype, operation, surface + ".subtle");
        }
        denyCallableProperty(subtle, operation, surface + ".subtle");
      }
    }
    if (subtlePrototype !== null) guardedSubtleCryptoPrototypes.add(subtlePrototype);
  }
};
guardWebCrypto(globalThis.crypto, "crypto");
guardWebCrypto(nodeCrypto.webcrypto, "node:crypto.webcrypto");
guardWebCrypto({ subtle: nodeCrypto.subtle }, "node:crypto");
for (const operation of Reflect.ownKeys(nodeCrypto)) {
  if (typeof operation !== "string" || allowedNodeCryptoCallables.has(operation)) continue;
  const value = nodeCrypto[operation];
  if (typeof value === "function") continue;
  const descriptor = Object.getOwnPropertyDescriptor(nodeCrypto, operation);
  if (operation === "fips" && descriptor?.configurable === false) {
    if (
      value !== 0
      || typeof descriptor.get !== "function"
      || typeof descriptor.set !== "function"
    ) throw new Error("matrix node:crypto.fips TCB invariant changed");
    continue;
  }
  denyReadableProperty(nodeCrypto, operation, "node:crypto");
}
for (const operation of ["allocUnsafe", "allocUnsafeSlow"]) {
  if (typeof Buffer[operation] === "function") denyCallableProperty(Buffer, operation, "Buffer");
}
for (const operation of Reflect.ownKeys(nodeOs)) {
  if (typeof operation !== "string") throw new Error("matrix node:os gained a symbol export");
  if (typeof nodeOs[operation] === "function") denyCallableProperty(nodeOs, operation, "node:os");
}
denyReadableProperty(process, "platform", "process");
denyReadableProperty(process, "arch", "process");
denyReadableProperty(navigator, "platform", "navigator");
denyReadableProperty(navigator, "arch", "navigator");
denyCallableProperty(Math, "random", "Math");
if (typeof Bun.randomUUIDv7 === "function") denyCallableProperty(Bun, "randomUUIDv7", "Bun");

const originalFs = Object.fromEntries(Object.entries(nodeFs).filter((entry) => typeof entry[1] === "function").map(([name, value]) => [name, value.bind(nodeFs)]));
nodeFs.readFileSync = (path, ...args) => originalFs.readFileSync(readPath("readFileSync", path, true), ...args);
nodeFs.readdirSync = (path, ...args) => {
  const absolute = metadataPath("readdirSync", path);
  if (!directories.has(absolute)) return filesystemDenied("readdirSync", path);
  const admitted = directoryChildren.get(absolute) ?? new Set();
  return originalFs.readdirSync(absolute, ...args).filter((entry) => admitted.has(typeof entry === "string" ? entry : entry.name));
};
for (const operation of ["statSync", "lstatSync", "realpathSync"]) {
  nodeFs[operation] = (path, ...args) => originalFs[operation](metadataPath(operation, path), ...args);
}
nodeFs.realpathSync.native = (path, ...args) => originalFs.realpathSync(metadataPath("realpathSync.native", path), ...args);
nodeFs.existsSync = (path) => {
  let absolute;
  try { absolute = canonicalAbsolute(pathValue(path)); }
  catch { return filesystemDenied("existsSync", path); }
  if (rows.has(absolute) || directories.has(absolute) || outputPathSet.has(absolute)) {
    record({ kind: "filesystem-metadata", operation: "existsSync", path: relative(snapshotRoot, absolute).replaceAll("\\", "/") || "." });
    return originalFs.existsSync(absolute);
  }
  return filesystemDenied("existsSync", path);
};
nodeFs.writeFileSync = (path, ...args) => {
  let absolute;
  try { absolute = canonicalAbsolute(pathValue(path)); }
  catch { return filesystemDenied("writeFileSync", path); }
  if (!outputPathSet.has(absolute)) return filesystemDenied("writeFileSync", path);
  record({ kind: "filesystem-write", operation: "writeFileSync", path: relative(snapshotRoot, absolute).replaceAll("\\", "/") });
  return originalFs.writeFileSync(absolute, ...args);
};
const guardedFsOperations = new Set(["readFileSync", "readdirSync", "statSync", "lstatSync", "realpathSync", "existsSync", "writeFileSync"]);
for (const operation of Object.keys(originalFs)) {
  if (!guardedFsOperations.has(operation)) {
    nodeFs[operation] = (...args) => filesystemDenied(operation, args[0]);
  }
}
try {
  for (const operation of Object.keys(fsPromises)) {
    if (typeof fsPromises[operation] === "function") fsPromises[operation] = (...args) => filesystemDenied("promises." + operation, args[0]);
  }
} catch (error) {
  unexpectedAttempts += 1;
  record({ kind: "guard-initialization", disposition: "unexpected-denied", error: String(error) });
}

const originalBunFile = Bun.file.bind(Bun);
Bun.file = (path, ...args) => {
  if (path === 1 || path === 2) return originalBunFile(path, ...args);
  return originalBunFile(readPath("Bun.file", path, true), ...args);
};
Bun.which = (tool, ...args) => {
  if (configuration.task === "render" && tool === "clang" && args.length === 0) {
    record({ kind: "external-tool-probe", tool: "clang", mode: "shape-only", result: "absent" });
    return null;
  }
  return denied("Bun", "which", [tool, ...args]);
};
const childProcessEntries = Object.entries(childProcess);
if (typeof childProcess.ChildProcess === "function" && typeof childProcess.ChildProcess.prototype?.spawn === "function") {
  childProcess.ChildProcess.prototype.spawn = (...args) => denied("node:child_process", "ChildProcess.prototype.spawn", args);
}
for (const [operation, value] of childProcessEntries) {
  if (typeof value === "function" && operation !== "ChildProcess") {
    childProcess[operation] = (...args) => denied("node:child_process", operation, args);
  }
}
for (const operation of ["spawn", "spawnSync"]) Bun[operation] = (...args) => denied("Bun", operation, args);
Bun.$ = (...args) => denied("Bun", "$", args);
Bun.write = (...args) => filesystemDenied("Bun.write", args[0]);
for (const operation of ["mmap", "openInEditor", "build", "resolve", "resolveSync"]) {
  if (typeof Bun[operation] === "function") Bun[operation] = (...args) => filesystemDenied("Bun." + operation, args[0]);
}
// Bun 1.3.13 has no top-level dlopen, but install an immutable denied sentinel
// so a future alias or runtime addition cannot turn absence into an untraced load.
denyCallableProperty(Bun, "dlopen", "Bun");
const sealedFfiObjects = new WeakSet();
const denyFfiObject = (target, surface) => {
  if (target === null || typeof target !== "object" || sealedFfiObjects.has(target)) return;
  sealedFfiObjects.add(target);
  for (const operation of Reflect.ownKeys(target)) {
    if (typeof operation !== "string") throw new Error(surface + " gained a symbol export");
    if (typeof target[operation] === "function") denyCallableProperty(target, operation, surface);
    else denyReadableProperty(target, operation, surface);
  }
};
denyFfiObject(ffiNative, "bun:ffi.native");
denyFfiObject(bunFfi, "Bun.FFI");
denyFfiObject(ffi, "bun:ffi");
process.dlopen = (...args) => denied("process", "dlopen", args);
process.chdir = (...args) => filesystemDenied("process.chdir", args[0]);
process.getBuiltinModule = (...args) => denied("process", "getBuiltinModule", args);
if (process.report !== null && typeof process.report === "object") {
  for (const operation of ["getReport", "writeReport"]) {
    if (typeof process.report[operation] === "function") {
      denyCallableProperty(process.report, operation, "process.report");
    }
  }
}
globalThis.fetch = (...args) => denied("network", "fetch", args);
for (const name of ["WebSocket", "Worker"]) {
  if (name in globalThis) globalThis[name] = function (...args) { return denied("network", name, args); };
}
for (const operation of ["connect", "listen", "serve", "udpSocket", "sql", "postgres", "cron"]) {
  if (typeof Bun[operation] === "function") Bun[operation] = (...args) => denied("network", "Bun." + operation, args);
}
for (const constructor of ["SQL", "S3Client", "RedisClient", "Terminal", "Glob", "FileSystemRouter"]) {
  if (typeof Bun[constructor] === "function") Bun[constructor] = function (...args) { return denied("Bun", constructor, args); };
}
for (const [surface, capability] of [["Bun.dns", Bun.dns], ["Bun.redis", Bun.redis], ["Bun.s3", Bun.s3], ["Bun.secrets", Bun.secrets]]) {
  if (capability !== null && typeof capability === "object") {
    for (const [operation, value] of Object.entries(capability)) {
      const descriptor = Object.getOwnPropertyDescriptor(capability, operation);
      if (typeof value === "function" && descriptor?.writable !== false) {
        capability[operation] = (...args) => denied(surface, operation, args);
      }
    }
  }
}
for (const { specifier, module: loadedModule, entries, promises, promiseEntries } of networkModules) {
  for (const [name, value] of entries) {
    if (typeof value === "function") loadedModule[name] = function (...args) { return denied("network", specifier + "." + name, args); };
  }
  if (promises !== undefined) {
    for (const [name, value] of promiseEntries) {
      if (typeof value === "function") promises[name] = function (...args) { return denied("network", specifier + ".promises." + name, args); };
    }
  }
}
for (const operation of ["binding", "_linkedBinding"]) {
  if (typeof process[operation] === "function") process[operation] = (...args) => denied("process", operation, args);
}

const cacheSources = ["Module._cache", "require.cache", "createRequire(import.meta.url).cache"];
const preloadRequire = createRequire(import.meta.url);
process.on("exit", () => {
  const labels = new Map();
  for (const cache of [(Module)._cache, require.cache, preloadRequire.cache]) {
    if (cache === null || typeof cache !== "object" || Reflect.ownKeys(cache).some((key) => typeof key !== "string")) {
      unexpectedAttempts += 1;
      continue;
    }
    for (const key of Reflect.ownKeys(cache)) {
      if (key === "bun:main" || allowedBuiltins.has(key)) {
        labels.set("builtin\0" + key, { scope: "builtin", value: key });
        continue;
      }
      let candidate = key;
      if (candidate.startsWith("file:")) {
        try { candidate = fileURLToPath(candidate); }
        catch { candidate = ""; }
      }
      const absolute = candidate.length === 0 || !isAbsolute(candidate) ? "" : canonicalAbsolute(candidate.split("?")[0]);
      const row = absolute.length === 0 ? undefined : rows.get(absolute);
      if (row === undefined) {
        labels.set("outside\0<redacted>", { scope: "outside", value: "<redacted>" });
        unexpectedAttempts += 1;
      } else {
        try { verifyRow(absolute); }
        catch { unexpectedAttempts += 1; }
        labels.set("snapshot\0" + row.path, { scope: "snapshot", value: row.path });
      }
    }
  }
  const ordered = [...labels.values()].sort((left, right) => compareUtf8(left.scope, right.scope) || compareUtf8(left.value, right.value));
  const preloadPath = relative(snapshotRoot, canonicalAbsolute(fileURLToPath(import.meta.url))).replaceAll("\\", "/");
  const entryPath = relative(snapshotRoot, canonicalAbsolute(workerPath)).replaceAll("\\", "/");
  if (!ordered.some((label) => label.scope === "snapshot" && label.value === preloadPath)) unexpectedAttempts += 1;
  if (!ordered.some((label) => label.scope === "snapshot" && label.value === entryPath)) unexpectedAttempts += 1;
  record({ kind: "loaded-modules", mode: "detective", cacheSources, preloadPath, entryPath, labels: ordered });
});
process.on("exit", () => {
  const ok = gitAttempts === 0 && unexpectedAttempts === 0;
  record({ kind: "guard-summary", task: configuration.task, gitAttempts, unexpectedAttempts, ok });
  if (!ok) process.exitCode = 86;
});
`.replace("__MATRIX_GUARD_CONFIGURATION__", configuration);
}

function readMatrixWorkerManifest(snapshot: string): ByteManifest {
  const path = resolve(snapshot, MATRIX_WORKER_MANIFEST_PATH);
  const stat = lstatSync(path);
  if (!stat.isFile() || stat.isSymbolicLink()) {
    throw new MatrixControllerFailure("matrix worker manifest is not one plain file");
  }
  const record = expectWireRecord(parseCanonicalJson(new Uint8Array(readFileSync(path))), "matrixWorkerManifest");
  expectClosedKeys(record, [
    "schema",
    "domain",
    "rows",
    "fileCount",
    "byteLength",
    "digest",
  ], [], "matrixWorkerManifest");
  expectWireLiteral(record.schema, ["fenel.byte-manifest.v1"] as const, "matrixWorkerManifest.schema");
  expectWireLiteral(
    record.domain,
    ["self-host-matrix-worker-runtime"] as const,
    "matrixWorkerManifest.domain",
  );
  const rows = expectWireArray(record.rows, "matrixWorkerManifest.rows").map((value, index) => {
    const rowPath = `matrixWorkerManifest.rows[${index}]`;
    const row = expectWireRecord(value, rowPath);
    expectClosedKeys(row, ["path", "kind", "byteLength", "sha256"], [], rowPath);
    return Object.freeze({
      path: repositoryRelativePath(expectWireString(row.path, `${rowPath}.path`)),
      kind: expectWireLiteral(row.kind, ["regular-file"] as const, `${rowPath}.kind`),
      byteLength: expectSafeUint(row.byteLength, `${rowPath}.byteLength`),
      sha256: parseSha256Hex(expectSha256(row.sha256, `${rowPath}.sha256`)),
    });
  });
  const manifest = digestByteManifest("self-host-matrix-worker-runtime", rows);
  if (
    expectSafeUint(record.fileCount, "matrixWorkerManifest.fileCount") !== manifest.fileCount
    || expectSafeUint(record.byteLength, "matrixWorkerManifest.byteLength") !== manifest.byteLength
    || parseSha256Hex(expectSha256(record.digest, "matrixWorkerManifest.digest")) !== manifest.digest
  ) {
    throw new MatrixControllerFailure("matrix worker manifest summary differs from its rows");
  }
  return manifest;
}

export function validateWorkerGuardTrace(
  snapshot: string,
  task: "render" | "report-smoke" = "render",
  expectedRequestBytes?: Uint8Array,
): MatrixWorkerStartWitness {
  const manifest = readMatrixWorkerManifest(snapshot);
  const rows = new Map(manifest.rows.map((row) => [row.path, row]));
  if (expectedRequestBytes !== undefined) {
    const requestRow = rows.get(repositoryRelativePath(MATRIX_WORKER_REQUEST_PATH));
    if (
      requestRow === undefined
      || requestRow.byteLength !== expectedRequestBytes.byteLength
      || requestRow.sha256 !== sha256Raw(expectedRequestBytes)
    ) {
      throw new MatrixControllerFailure("matrix worker request row is not the exact controller-issued request");
    }
  }
  const trace = resolve(snapshot, MATRIX_WORKER_GUARD_TRACE_PATH);
  if (!existsSync(trace)) throw new MatrixControllerFailure("matrix worker emitted no capability-guard trace");
  const events = readFileSync(trace, "utf8")
    .split("\n")
    .filter((line) => line.length > 0)
    .map((line, index) => expectWireRecord(JSON.parse(line), `matrixWorkerTrace[${index}]`));
  const attempts = events.filter((event) => event.kind === "subprocess-attempt");
  if (attempts.length !== 0) {
    throw new MatrixControllerFailure("matrix worker attempted a subprocess");
  }
  const externalToolProbes = events.filter((event) => event.kind === "external-tool-probe");
  if (
    (task === "report-smoke" && externalToolProbes.length !== 0)
    || externalToolProbes.some((event) => (
      Object.keys(event).sort().join("\0") !== ["kind", "mode", "result", "tool"].join("\0")
      || event.tool !== "clang"
      || event.mode !== "shape-only"
      || event.result !== "absent"
    ))
  ) {
    throw new MatrixControllerFailure("matrix worker capability trace contains an invalid external-tool probe");
  }
  const starts = events.filter((event) => event.kind === "worker-start");
  const start = starts[0];
  const startPid = start?.pid;
  const startRoot = start?.materializationRoot;
  if (
    starts.length !== 1
    || start?.task !== task
    || typeof startPid !== "number"
    || !Number.isSafeInteger(startPid)
    || startPid <= 0
    || typeof startRoot !== "string"
    || resolve(startRoot) !== resolve(realpathSync.native(snapshot))
  ) {
    throw new MatrixControllerFailure("matrix worker trace has no exact process/materialization witness");
  }
  const workerStart = Object.freeze({
    materializationRoot: startRoot,
    workerPid: startPid,
  });
  if (expectedRequestBytes !== undefined) {
    const writes = events.filter((event) => event.kind === "filesystem-write");
    const expectedWrites = task === "report-smoke"
      ? [MATRIX_REPORT_SMOKE_OUTPUT_PATH]
      : [
        MATRIX_REPORT_AUDIT_OUTPUT_PATH,
        MATRIX_REPORT_CANDIDATE_OUTPUT_PATH,
        MATRIX_REPORT_RAW_FACETS_OUTPUT_PATH,
      ];
    const observedWrites = writes.map((write) => {
      if (write.operation !== "writeFileSync" || typeof write.path !== "string") {
        throw new MatrixControllerFailure("matrix worker output trace is malformed");
      }
      return write.path;
    }).sort(compareUtf8);
    if (JSON.stringify(observedWrites) !== JSON.stringify(expectedWrites)) {
      throw new MatrixControllerFailure("matrix worker did not perform exactly its authorized writes");
    }
    const reads = events.filter((event) => event.kind === "filesystem-read");
    const requestRead = reads[0];
    if (
      reads.length !== 1
      || requestRead?.operation !== "readFileSync"
      || requestRead.path !== MATRIX_WORKER_REQUEST_PATH
      || requestRead.digest !== sha256Raw(expectedRequestBytes)
    ) {
      throw new MatrixControllerFailure("matrix worker did not perform its sole manifested request read");
    }
  }
  const loadedEvents = events.filter((event) => event.kind === "loaded-modules");
  if (loadedEvents.length !== 1) {
    throw new MatrixControllerFailure("matrix worker trace must contain exactly one loaded-module witness");
  }
  const loaded = loadedEvents[0];
  if (
    loaded?.mode !== "detective"
    || JSON.stringify(loaded.cacheSources) !== JSON.stringify([
      "Module._cache",
      "require.cache",
      "createRequire(import.meta.url).cache",
    ])
    || typeof loaded.preloadPath !== "string"
    || typeof loaded.entryPath !== "string"
    || !Array.isArray(loaded.labels)
  ) {
    throw new MatrixControllerFailure("matrix worker loaded-module witness is malformed");
  }
  let previous: string | undefined;
  const observedSnapshotPaths = new Set<string>();
  for (const [index, value] of loaded.labels.entries()) {
    const label = expectWireRecord(value, `matrixWorkerTrace.loadedModules.labels[${index}]`);
    if (Object.keys(label).sort().join("\0") !== ["scope", "value"].join("\0")) {
      throw new MatrixControllerFailure(`matrix worker loaded-module label ${index + 1} is not closed`);
    }
    if (typeof label.value !== "string" || (label.scope !== "builtin" && label.scope !== "snapshot")) {
      throw new MatrixControllerFailure("matrix worker loaded-module witness contains an outside module");
    }
    const sortKey = `${label.scope}\0${label.value}`;
    if (previous !== undefined && Buffer.compare(Buffer.from(previous), Buffer.from(sortKey)) >= 0) {
      throw new MatrixControllerFailure("matrix worker loaded-module labels are not ordered uniquely");
    }
    previous = sortKey;
    if (label.scope === "builtin") {
      if (label.value !== "bun:main" && !MATRIX_GUARD_RUNTIME_BUILTINS.has(label.value)) {
        throw new MatrixControllerFailure(`matrix worker loaded an undeclared builtin ${label.value}`);
      }
      continue;
    }
    const relativePath = repositoryRelativePath(label.value);
    if (
      task === "report-smoke"
      && (
        relativePath.endsWith("/self-host-classification-cache.ts")
        || /\/compile-(?:js|wasm|llvm)-self-host-classifier\.ts$/u.test(relativePath)
      )
    ) {
      throw new MatrixControllerFailure(`matrix report-smoke loaded a classifier path ${relativePath}`);
    }
    const row = rows.get(relativePath);
    if (row === undefined) throw new MatrixControllerFailure(`matrix worker loaded an unmanifested module ${relativePath}`);
    const current = physicalFile(snapshot, relativePath).row;
    if (current.byteLength !== row.byteLength || current.sha256 !== row.sha256) {
      throw new MatrixControllerFailure(`matrix worker loaded module bytes changed: ${relativePath}`);
    }
    observedSnapshotPaths.add(relativePath);
  }
  if (expectedRequestBytes !== undefined && !observedSnapshotPaths.has(MATRIX_REPORT_SOURCE_PATH)) {
    throw new MatrixControllerFailure("matrix worker loaded-module witness omits its report source");
  }
  const preloadPath = expectWireString(loaded.preloadPath, "matrixWorkerTrace.loadedModules.preloadPath");
  const entryPath = expectWireString(loaded.entryPath, "matrixWorkerTrace.loadedModules.entryPath");
  for (const required of [preloadPath, entryPath]) {
    const path = repositoryRelativePath(required);
    if (!observedSnapshotPaths.has(path)) {
      throw new MatrixControllerFailure(`matrix worker loaded-module witness omits ${path}`);
    }
  }
  const summaries = events.filter((event) => event.kind === "guard-summary");
  const summary = summaries[0];
  if (
    summaries.length !== 1
    || events.at(-1) !== summary
    || summary?.task !== task
    || summary.gitAttempts !== 0
    || summary.unexpectedAttempts !== 0
    || summary.ok !== true
  ) {
    throw new MatrixControllerFailure("matrix worker capability guard did not close green");
  }
  return workerStart;
}

function cleanupSnapshot(repositoryRoot: string, directory: string): void {
  const root = resolve(repositoryRoot, MATRIX_SNAPSHOT_ROOT);
  assertWithin(root, directory, "matrix snapshot cleanup");
  const marker = resolve(directory, MATRIX_SNAPSHOT_MARKER);
  if (!existsSync(marker)) throw new MatrixControllerFailure("refusing to clean an unmarked matrix snapshot");
  rmSync(directory, { recursive: true, force: false });
}

export async function invokeMatrixWorkerTask(
  captured: CapturedMatrixPackage,
): Promise<MatrixReportSmokeRun> {
  const snapshot = materializeMatrixPackage(captured, "report-smoke");
  try {
    const actualEnvironment = Object.fromEntries(Object.entries(captured.workerEnvironment).map(([key, value]) => [
      key,
      value
        .replace(resolve(captured.repositoryRoot, MATRIX_SNAPSHOT_ROOT, ".private-bin"), resolve(snapshot, ".bin"))
        .replace(resolve(captured.repositoryRoot, MATRIX_SNAPSHOT_ROOT, ".private-tmp"), resolve(snapshot, ".tmp")),
    ]));
    const requestPath = resolve(snapshot, MATRIX_WORKER_REQUEST_PATH);
    const result = spawnSync(process.execPath, [
      "--no-env-file",
      "--no-install",
      `--cwd=${snapshot}`,
      "--preload",
      resolve(snapshot, MATRIX_WORKER_GUARD_PATH),
      resolve(snapshot, SELF_HOST_MATRIX_GENERATOR_PATH),
      `--worker-request=${requestPath}`,
    ], {
      cwd: snapshot,
      env: actualEnvironment,
      encoding: "utf8",
      stdio: ["ignore", "pipe", "pipe"],
    });
    if (result.status !== 0) {
      throw new MatrixControllerFailure(
        result.error === undefined
          ? `matrix report-smoke worker exited ${String(result.status)}: ${(result.stderr ?? "").trim()}`
          : String(result.error),
      );
    }
    const workerStart = validateWorkerGuardTrace(
      snapshot,
      "report-smoke",
      MATRIX_REPORT_SMOKE_REQUEST_BYTES,
    );
    const outputPath = resolve(snapshot, MATRIX_REPORT_SMOKE_OUTPUT_PATH);
    const outputStat = lstatSync(outputPath);
    if (!outputStat.isFile() || outputStat.isSymbolicLink()) {
      throw new MatrixControllerFailure("matrix report-smoke output is not one plain file");
    }
    const outputBytes = new Uint8Array(readFileSync(outputPath));
    if (!Buffer.from(outputBytes).equals(Buffer.from(MATRIX_REPORT_SMOKE_OUTPUT_BYTES))) {
      throw new MatrixControllerFailure("matrix report-smoke output is not the exact canonical result");
    }
    return Object.freeze({
      outputBytes,
      materializationRoot: workerStart.materializationRoot,
      workerPid: workerStart.workerPid,
    });
  } finally {
    cleanupSnapshot(captured.repositoryRoot, snapshot);
  }
}

export async function proveMatrixReportSmoke(
  captured: CapturedMatrixPackage,
): Promise<MatrixReportSmokeProof> {
  const first = await invokeMatrixWorkerTask(captured);
  const second = await invokeMatrixWorkerTask(captured);
  if (first.materializationRoot === second.materializationRoot) {
    throw new MatrixControllerFailure("matrix report-smoke workers shared one materialization");
  }
  if (first.workerPid === second.workerPid) {
    throw new MatrixControllerFailure("matrix report-smoke workers shared one process");
  }
  if (!Buffer.from(first.outputBytes).equals(Buffer.from(second.outputBytes))) {
    throw new MatrixControllerFailure("matrix report-smoke workers disagreed over one captured package");
  }
  return Object.freeze({ first, second });
}

async function renderDefault(
  captured: CapturedMatrixPackage,
  input: { readonly progress: boolean; readonly check: boolean },
): Promise<MatrixRenderResult> {
  const requestBytes = matrixRenderRequestBytes(captured, input.progress);
  const snapshot = materializeMatrixPackage(captured, "render", input.progress);
  try {
    const actualEnvironment = Object.fromEntries(Object.entries(captured.workerEnvironment).map(([key, value]) => [
      key,
      value
        .replace(resolve(captured.repositoryRoot, MATRIX_SNAPSHOT_ROOT, ".private-bin"), resolve(snapshot, ".bin"))
        .replace(resolve(captured.repositoryRoot, MATRIX_SNAPSHOT_ROOT, ".private-tmp"), resolve(snapshot, ".tmp")),
    ]));
    const requestPath = resolve(snapshot, MATRIX_WORKER_REQUEST_PATH);
    const args = [
      "--no-env-file",
      "--no-install",
      `--cwd=${snapshot}`,
      "--preload",
      resolve(snapshot, MATRIX_WORKER_GUARD_PATH),
      resolve(snapshot, SELF_HOST_MATRIX_GENERATOR_PATH),
      `--worker-request=${requestPath}`,
    ];
    const result = spawnSync(process.execPath, args, {
      cwd: snapshot,
      env: actualEnvironment,
      encoding: "utf8",
      stdio: ["ignore", "pipe", "pipe"],
    });
    if (result.status !== 0) {
      return Object.freeze({
        ok: false,
        candidateBytes: null,
        workerStdout: `${result.stdout ?? ""}${result.stderr ?? ""}`,
        error: result.error === undefined
          ? `matrix worker exited ${String(result.status)}: ${(result.stderr ?? "").trim()}`
          : String(result.error),
      });
    }
    const workerStart = validateWorkerGuardTrace(snapshot, "render", requestBytes);
    const readOutput = (path: string): Uint8Array => {
      const absolute = resolve(snapshot, path);
      const stat = lstatSync(absolute);
      if (!stat.isFile() || stat.isSymbolicLink()) {
        throw new MatrixControllerFailure(`matrix worker output is not one plain file: ${path}`);
      }
      return new Uint8Array(readFileSync(absolute));
    };
    const candidateBytes = readOutput(MATRIX_REPORT_CANDIDATE_OUTPUT_PATH);
    const rawFacetBytes = readOutput(MATRIX_REPORT_RAW_FACETS_OUTPUT_PATH);
    const auditBytes = readOutput(MATRIX_REPORT_AUDIT_OUTPUT_PATH);
    const validated = validateMatrixReportEvidence(
      captured,
      candidateBytes,
      rawFacetBytes,
      auditBytes,
    );
    return Object.freeze({
      ok: true,
      candidateBytes,
      workerStdout: `${result.stdout ?? ""}${result.stderr ?? ""}`,
      error: null,
      evidence: Object.freeze({
        rawFacetBytes,
        auditBytes,
        rawFacets: validated.rawFacets,
        audit: validated.audit,
        materializationRoot: workerStart.materializationRoot,
        workerPid: workerStart.workerPid,
      }),
    });
  } catch (error) {
    return Object.freeze({
      ok: false,
      candidateBytes: null,
      workerStdout: "",
      error: String(error),
    });
  } finally {
    cleanupSnapshot(captured.repositoryRoot, snapshot);
  }
}

function syncDirectoryBestEffort(directory: string): void {
  let descriptor: number | undefined;
  try {
    descriptor = openSync(directory, "r");
    fsyncSync(descriptor);
  } catch (error) {
    const code = (error as NodeJS.ErrnoException).code;
    if (!["EACCES", "EBADF", "EINVAL", "EISDIR", "ENOTSUP", "EPERM"].includes(code ?? "")) throw error;
  } finally {
    if (descriptor !== undefined) closeSync(descriptor);
  }
}

export function publishMatrixCandidateAtomically(
  repositoryRoot: string,
  candidateBytes: Uint8Array,
): Uint8Array {
  const docs = resolve(repositoryRoot, "docs");
  const docsStat = lstatSync(docs);
  if (!docsStat.isDirectory() || docsStat.isSymbolicLink()) {
    throw new MatrixControllerFailure("matrix publication parent is not one plain directory");
  }
  const target = resolve(repositoryRoot, SELF_HOST_MATRIX_PATH);
  assertWithin(docs, target, "matrix publication target");
  const temp = resolve(docs, `.SELF_HOST_MATRIX.md.m3b-${process.pid}-${randomBytes(12).toString("hex")}.tmp`);
  assertWithin(docs, temp, "matrix publication temp");
  let descriptor: number | undefined;
  let owned = false;
  try {
    descriptor = openSync(temp, "wx", 0o600);
    owned = true;
    let offset = 0;
    while (offset < candidateBytes.byteLength) {
      const written = writeSync(descriptor, candidateBytes, offset, candidateBytes.byteLength - offset);
      if (written <= 0) throw new MatrixControllerFailure("short matrix publication write");
      offset += written;
    }
    fsyncSync(descriptor);
    closeSync(descriptor);
    descriptor = undefined;
    renameSync(temp, target);
    owned = false;
    syncDirectoryBestEffort(docs);
    const committed = new Uint8Array(readFileSync(target));
    assertMatrixCandidateEqualsCommitted(candidateBytes, committed);
    return committed;
  } finally {
    if (descriptor !== undefined) closeSync(descriptor);
    if (owned && existsSync(temp)) unlinkSync(temp);
  }
}

function defaultDependencies(repositoryRoot = process.cwd()): MatrixControllerDependencies {
  const root = resolve(repositoryRoot);
  const dependencies: MatrixControllerDependencies = {
    mode: CURRENT_SELF_HOST_MATRIX_MODE,
    repositoryRoot: root,
    capture: async ({ packagePath, presentation }) => {
      if (packagePath !== null) {
        if (presentation !== undefined) {
          throw new MatrixControllerFailure("external matrix package identity may not be overridden");
        }
        return await loadVerifiedMatrixCheckPackage(root, packagePath);
      }
      return await captureMatrixPackage(root, { ...(presentation === undefined ? {} : { presentation }) });
    },
    render: renderDefault,
    assertCurrent: async (captured) => {
      await assertCurrentMatrixPackage(captured);
    },
    publish: async (captured, candidateBytes) => publishMatrixCandidateAtomically(captured.repositoryRoot, candidateBytes),
    reread: async (captured) => readOptionalMatrix(captured.repositoryRoot),
    stdout: (bytes) => {
      process.stdout.write(bytes);
    },
    stderr: (message) => {
      process.stderr.write(`${message}\n`);
    },
  };
  return Object.freeze(dependencies);
}

function relationEvidence(captured: CapturedMatrixPackage): MatrixRelationEvidence {
  if (captured.documentBytes === null) {
    return Object.freeze({
      artifact: "absent",
      stampClass: "absent",
      inputs: "different",
      environment: "foreign",
      body: "different",
    });
  }
  const observation = captured.observation;
  if (observation === null) throw new MatrixControllerFailure("present matrix omitted its observation");
  return Object.freeze({
    artifact: "present",
    stampClass: observation.stampClass,
    inputs: observation.stamp?.inputs === captured.inputs.digest ? "equal" : "different",
    environment: observation.stamp?.environment === captured.environment.digest ? "equal" : "foreign",
    body: observation.stamp?.body === observation.bodyDigest ? "equal" : "different",
  });
}

function resultForDecision(decision: MatrixDecision): MatrixResult {
  return decision;
}

async function invokeRender(
  dependencies: MatrixControllerDependencies,
  captured: CapturedMatrixPackage,
  input: { readonly progress: boolean; readonly check: boolean },
): Promise<MatrixRenderResult> {
  try {
    return await dependencies.render(captured, input);
  } catch (error) {
    return Object.freeze({
      ok: false,
      candidateBytes: null,
      workerStdout: "",
      error: String(error),
    });
  }
}

function candidateBodyEqualsCurrent(
  captured: CapturedMatrixPackage,
  candidateBytes: Uint8Array | null,
): boolean {
  if (captured.documentBytes === null || captured.observation === null || candidateBytes === null) return false;
  try {
    return parseMatrixDocument(candidateBytes).bodyDigest === captured.observation.bodyDigest;
  } catch {
    return false;
  }
}

type ValidatedMatrixRender = Readonly<{
  candidateBytes: Uint8Array;
  observation: MatrixDocumentObservation;
  rawFacetBytes: Uint8Array;
  auditBytes: Uint8Array;
  rawFacets: MatrixRawFacetProjection;
  audit: MatrixReportAudit;
  materializationRoot: string;
  workerPid: number;
}>;

function sameBytes(left: Uint8Array, right: Uint8Array): boolean {
  return Buffer.from(left).equals(Buffer.from(right));
}

function validateTransactionRender(
  captured: CapturedMatrixPackage,
  render: MatrixRenderResult,
  label: "A" | "B",
): ValidatedMatrixRender {
  if (!render.ok || render.candidateBytes === null || render.evidence === undefined) {
    throw new MatrixControllerFailure(
      `matrix render ${label} failed: ${render.error ?? "worker returned incomplete evidence"}`,
    );
  }
  const evidence = render.evidence;
  if (
    !isAbsolute(evidence.materializationRoot)
    || !Number.isSafeInteger(evidence.workerPid)
    || evidence.workerPid <= 0
  ) {
    throw new MatrixControllerFailure(`matrix render ${label} has no fresh process/materialization witness`);
  }
  const validated = validateMatrixReportEvidence(
    captured,
    render.candidateBytes,
    evidence.rawFacetBytes,
    evidence.auditBytes,
  );
  if (
    JSON.stringify(evidence.rawFacets) !== JSON.stringify(validated.rawFacets)
    || JSON.stringify(evidence.audit) !== JSON.stringify(validated.audit)
  ) {
    throw new MatrixControllerFailure(`matrix render ${label} parsed evidence differs from its wire bytes`);
  }
  return Object.freeze({
    candidateBytes: render.candidateBytes,
    observation: validated.observation,
    rawFacetBytes: evidence.rawFacetBytes,
    auditBytes: evidence.auditBytes,
    rawFacets: validated.rawFacets,
    audit: validated.audit,
    materializationRoot: resolve(evidence.materializationRoot),
    workerPid: evidence.workerPid,
  });
}

function assertReproducedMatrixRender(
  first: ValidatedMatrixRender,
  second: ValidatedMatrixRender,
): void {
  if (first.materializationRoot === second.materializationRoot) {
    throw new MatrixControllerFailure("matrix render workers shared one materialization");
  }
  if (first.workerPid === second.workerPid) {
    throw new MatrixControllerFailure("matrix render workers shared one process witness");
  }
  if (
    !sameBytes(first.candidateBytes, second.candidateBytes)
    || !sameBytes(first.observation.normalizedBodyBytes, second.observation.normalizedBodyBytes)
    || first.observation.bodyDigest !== second.observation.bodyDigest
  ) {
    throw new MatrixControllerFailure("matrix render workers produced different candidates");
  }
  if (!sameBytes(first.rawFacetBytes, second.rawFacetBytes)) {
    throw new MatrixControllerFailure("matrix render workers produced different raw facet projections");
  }
  if (!sameBytes(first.auditBytes, second.auditBytes)) {
    throw new MatrixControllerFailure("matrix render workers produced different audit records");
  }
}

function sealRequiredV1Candidate(
  captured: CapturedMatrixPackage,
  reproduced: ValidatedMatrixRender,
): Uint8Array {
  const presented = replaceMatrixPresentation(reproduced.candidateBytes, {
    verified: captured.verified,
    verifiedAtSha: captured.verifiedAtSha,
  });
  const before = parseMatrixDocument(presented);
  if (before.stampClass !== "absent" || before.bodyDigest !== reproduced.observation.bodyDigest) {
    throw new MatrixControllerFailure("reproduced matrix body changed during presentation sealing");
  }
  const candidate = insertMatrixStamp(presented, matrixStampFor({
    inputs: captured.inputs,
    environment: captured.environment,
    bodyDigest: before.bodyDigest,
  }));
  const after = parseMatrixDocument(candidate);
  if (
    after.stampClass !== "valid"
    || after.stamp === null
    || after.stamp.inputs !== captured.inputs.digest
    || after.stamp.environment !== captured.environment.digest
    || after.stamp.body !== before.bodyDigest
    || after.bodyDigest !== before.bodyDigest
    || after.presentation.verified !== captured.verified
    || after.presentation.verifiedAtSha !== captured.verifiedAtSha
  ) {
    throw new MatrixControllerFailure("sealed matrix candidate failed its complete v1 relation reparse");
  }
  return candidate;
}

function exactOldArtifact(
  captured: CapturedMatrixPackage,
  observed: Uint8Array | null,
): boolean {
  return observed === null
    ? captured.documentBytes === null
    : captured.documentBytes !== null && sameBytes(observed, captured.documentBytes);
}

function receiptFor(input: {
  readonly captured: CapturedMatrixPackage;
  readonly mode: MatrixMode;
  readonly operation: MatrixReceiptOperation;
  readonly decision: MatrixDecision;
  readonly result: MatrixResult;
  readonly published: boolean;
  readonly candidate: Uint8Array | null;
  readonly after: Uint8Array | null;
}): MatrixControllerReceipt {
  const afterObservation = input.after === null ? null : parseMatrixDocument(input.after);
  const bodyDigest = afterObservation?.bodyDigest
    ?? input.captured.observation?.bodyDigest
    ?? sha256Raw("fenel.self-host-matrix-absent-body.v1\n");
  const certificateDigest = afterObservation?.certificateDigest
    ?? input.captured.observation?.certificateDigest
    ?? LEGACY_STAMPLESS_TOMBSTONE_DIGEST;
  const stampClass = afterObservation?.stampClass
    ?? input.captured.observation?.stampClass
    ?? "absent";
  return makeMatrixControllerReceipt({
    evidence: "complete",
    failureDigest: MATRIX_NO_FAILURE_DIGEST,
    mode: input.mode,
    operation: input.operation,
    decision: input.decision,
    result: input.result,
    stampClass,
    inputsDigest: input.captured.inputs.digest,
    environmentDigest: input.captured.environment.digest,
    bodyDigest,
    certificateDigest,
    controllerDigest: input.captured.controllerDigest,
    packageDigest: input.captured.packageDigest,
    capturedPresentation: {
      sourceCommit: input.captured.sourceCommit,
      verified: input.captured.verified,
      verifiedAtSha: input.captured.verifiedAtSha,
    },
    publication: {
      published: input.published,
      before: input.captured.artifactBefore,
      candidate: matrixArtifactIdentity(input.candidate),
      after: matrixArtifactIdentity(input.after),
    },
  });
}

function rawControllerDigest(repositoryRoot: string): Sha256Hex {
  const identities = [SELF_HOST_MATRIX_CERTIFICATE_HELPER_PATH, SELF_HOST_MATRIX_CONTROLLER_PATH]
    .map((path) => {
      const bytes = new Uint8Array(readFileSync(resolve(repositoryRoot, path)));
      return Object.freeze({ path, byteLength: bytes.byteLength, digest: sha256Raw(bytes) });
    });
  return sha256Raw(JSON.stringify(["fenel.self-host-matrix-controller-identity.v1", identities]));
}

function unavailableReceipt(input: {
  readonly dependencies: MatrixControllerDependencies;
  readonly operation: MatrixReceiptOperation;
  readonly decision?: MatrixDecision;
  readonly result: Exclude<MatrixResult, "FRESH">;
  readonly reason: unknown;
}): MatrixControllerReceipt {
  const reason = input.reason instanceof Error
    ? `${input.reason.name}: ${input.reason.message}`
    : String(input.reason);
  const artifact = Object.freeze({ kind: "absent" as const });
  return makeMatrixControllerReceipt({
    evidence: "unavailable",
    failureDigest: matrixFailureDigest(reason),
    mode: input.dependencies.mode,
    operation: input.operation,
    decision: input.decision ?? "UNDECIDABLE",
    result: input.result,
    stampClass: "malformed",
    inputsDigest: UNAVAILABLE_MATRIX_IDENTITY_DIGEST,
    environmentDigest: UNAVAILABLE_MATRIX_IDENTITY_DIGEST,
    bodyDigest: UNAVAILABLE_MATRIX_IDENTITY_DIGEST,
    certificateDigest: UNAVAILABLE_MATRIX_IDENTITY_DIGEST,
    controllerDigest: UNAVAILABLE_MATRIX_IDENTITY_DIGEST,
    packageDigest: UNAVAILABLE_MATRIX_IDENTITY_DIGEST,
    capturedPresentation: {
      sourceCommit: "0".repeat(40),
      verified: "1970-01-01",
      verifiedAtSha: "0".repeat(7),
    },
    publication: {
      published: false,
      before: artifact,
      candidate: { kind: "absent" },
      after: artifact,
    },
  });
}

function emitReceipt(
  dependencies: MatrixControllerDependencies,
  receipt: MatrixControllerReceipt,
  exitCode: 0 | 1 | 2 | 20 | 21,
): MatrixControllerRunResult {
  dependencies.stdout(encodeMatrixControllerReceipt(receipt));
  return Object.freeze({ exitCode, receipt });
}

async function runRequiredV1RepairTransaction(input: {
  readonly dependencies: MatrixControllerDependencies;
  readonly captured: CapturedMatrixPackage;
  readonly operation: "decide" | "repair";
  readonly decision: "REPAIR_REQUIRED";
  readonly progress: boolean;
}): Promise<MatrixControllerRunResult> {
  const { dependencies, captured } = input;
  const failed = (candidate: Uint8Array | null, reason: unknown): MatrixControllerRunResult => {
    dependencies.stderr(`[matrix] required-v1 repair failed: ${String(reason)}`);
    return emitReceipt(dependencies, receiptFor({
      captured,
      mode: "required-v1",
      operation: input.operation,
      decision: input.decision,
      result: "REPAIR_FAILED",
      published: false,
      candidate,
      after: captured.documentBytes,
    }), 1);
  };
  const unavailable = (reason: unknown): MatrixControllerRunResult => {
    dependencies.stderr(`[matrix] required-v1 publication state is unavailable: ${String(reason)}`);
    return emitReceipt(dependencies, unavailableReceipt({
      dependencies,
      operation: input.operation,
      result: "UNDECIDABLE",
      reason,
    }), 21);
  };
  let first: ValidatedMatrixRender;
  let second: ValidatedMatrixRender;
  try {
    const firstResult = await invokeRender(dependencies, captured, {
      progress: input.progress,
      check: false,
    });
    if (firstResult.workerStdout.length > 0) dependencies.stderr(firstResult.workerStdout.trimEnd());
    first = validateTransactionRender(captured, firstResult, "A");
  } catch (error) {
    return failed(null, error);
  }
  try {
    const secondResult = await invokeRender(dependencies, captured, {
      progress: input.progress,
      check: false,
    });
    if (secondResult.workerStdout.length > 0) dependencies.stderr(secondResult.workerStdout.trimEnd());
    second = validateTransactionRender(captured, secondResult, "B");
    assertReproducedMatrixRender(first, second);
  } catch (error) {
    return failed(first.candidateBytes, error);
  }

  let candidate: Uint8Array;
  try {
    candidate = sealRequiredV1Candidate(captured, first);
  } catch (error) {
    return failed(null, error);
  }

  const repaired = (observed: Uint8Array): MatrixControllerRunResult => {
    const observation = parseMatrixDocument(observed);
    const postState = evaluateMatrixState({
      mode: "required-v1",
      evidence: Object.freeze({
        artifact: "present",
        stampClass: observation.stampClass,
        inputs: observation.stamp?.inputs === captured.inputs.digest ? "equal" : "different",
        environment: observation.stamp?.environment === captured.environment.digest ? "equal" : "foreign",
        body: observation.stamp?.body === observation.bodyDigest ? "equal" : "different",
      }),
      selected: true,
      adoptCurrentEnvironment: false,
      fullCheck: "not-run",
    });
    if (postState.decision !== "FRESH" || postState.action !== "none" || postState.exitCode !== 0) {
      throw new MatrixControllerFailure("published matrix candidate is not internally FRESH");
    }
    return emitReceipt(dependencies, receiptFor({
      captured,
      mode: "required-v1",
      operation: input.operation,
      decision: input.decision,
      result: "REPAIRED",
      published: true,
      candidate,
      after: observed,
    }), 0);
  };

  let publicationEntered = false;
  let publicationError: unknown = null;
  try {
    await dependencies.assertCurrent(captured);
    publicationEntered = true;
    const committed = await dependencies.publish(captured, candidate);
    assertMatrixCandidateEqualsCommitted(candidate, committed);
  } catch (error) {
    publicationError = error;
  }
  let observed: Uint8Array | null;
  try {
    observed = await dependencies.reread(captured);
  } catch (rereadError) {
    return unavailable(rereadError);
  }
  if (publicationEntered && observed !== null && sameBytes(observed, candidate)) {
    try {
      return repaired(observed);
    } catch (postconditionError) {
      return unavailable(postconditionError);
    }
  }
  if (exactOldArtifact(captured, observed)) {
    return failed(
      candidate,
      publicationError ?? "atomic publication returned without retaining the candidate",
    );
  }
  return unavailable(
    publicationError
      ?? "matrix bytes differ from both the captured artifact and audited candidate after publication",
  );
}

export async function runSelfHostMatrixController(
  argv: readonly string[],
  injected?: MatrixControllerDependencies,
): Promise<MatrixControllerRunResult> {
  const dependencies = injected ?? defaultDependencies();
  let args;
  try {
    args = normalizeMatrixControllerArgs(argv, dependencies.mode);
  } catch (error) {
    dependencies.stderr(error instanceof MatrixCliError ? error.message : String(error));
    const receipt = unavailableReceipt({
      dependencies,
      operation: "invalid",
      result: "CLI_ERROR",
      reason: error,
    });
    return emitReceipt(dependencies, receipt, 2);
  }
  if (args.operation === "decide" && args.noMatrix) {
    dependencies.stderr("[matrix] WARNING: NOT regenerated (--no-matrix); matrix evidence remains advisory.");
    const receipt = unavailableReceipt({
      dependencies,
      operation: args.operation,
      decision: "SKIPPED_EXPLICIT",
      result: "SKIPPED_EXPLICIT",
      reason: "explicit matrix skip; stable evidence capture was not run",
    });
    return emitReceipt(dependencies, receipt, 0);
  }
  let captured: CapturedMatrixPackage;
  try {
    captured = await dependencies.capture({ packagePath: args.packagePath });
  } catch (error) {
    dependencies.stderr(`[matrix] UNDECIDABLE: ${String(error)}`);
    const receipt = unavailableReceipt({
      dependencies,
      operation: args.operation,
      result: "UNDECIDABLE",
      reason: error,
    });
    return emitReceipt(dependencies, receipt, 21);
  }
  if (
    args.adoptMatrixEnvironment !== null
    && args.adoptMatrixEnvironment !== captured.environment.digest
  ) {
    dependencies.stderr("[matrix] adoption digest differs from the freshly captured environment");
    const receipt = receiptFor({
      captured,
      mode: dependencies.mode,
      operation: args.operation,
      decision: "UNDECIDABLE",
      result: "CLI_ERROR",
      published: false,
      candidate: null,
      after: captured.documentBytes,
    });
    return emitReceipt(dependencies, receipt, 2);
  }
  const evidence = relationEvidence(captured);
  const selected = args.withMatrix
    || (dependencies.mode === "legacy-stampless" && (args.functionMints ?? 0) > 0);
  let state = evaluateMatrixState({
    mode: dependencies.mode,
    evidence,
    selected,
    adoptCurrentEnvironment: args.adoptMatrixEnvironment !== null,
    fullCheck: "not-run",
  });
  if (args.operation === "check") {
    const render = await invokeRender(dependencies, captured, { progress: args.progress, check: true });
    if (render.workerStdout.length > 0) dependencies.stderr(render.workerStdout.trimEnd());
    if (!render.ok || render.candidateBytes === null) {
      dependencies.stderr(`[matrix:check] failed: ${render.error ?? "worker returned no candidate"}`);
      const receipt = receiptFor({
        captured,
        mode: dependencies.mode,
        operation: args.operation,
        decision: state.decision,
        result: "CHECK_FAILED",
        published: false,
        candidate: null,
        after: captured.documentBytes,
      });
      return emitReceipt(dependencies, receipt, 1);
    }
    const equal = candidateBodyEqualsCurrent(captured, render.candidateBytes);
    const receipt = receiptFor({
      captured,
      mode: dependencies.mode,
      operation: args.operation,
      decision: state.decision,
      result: equal ? "CHECK_OK" : "DUE",
      published: false,
      candidate: render.candidateBytes,
      after: captured.documentBytes,
    });
    return emitReceipt(dependencies, receipt, equal ? 0 : 20);
  }
  if (args.operation === "probe") {
    const receipt = receiptFor({
      captured,
      mode: dependencies.mode,
      operation: args.operation,
      decision: state.decision,
      result: resultForDecision(state.decision),
      published: false,
      candidate: null,
      after: captured.documentBytes,
    });
    const exitCode = state.action === "none" ? state.exitCode : 20;
    return emitReceipt(dependencies, receipt, exitCode);
  }
  if (state.action === "check") {
    const render = await invokeRender(dependencies, captured, { progress: args.progress, check: true });
    if (render.workerStdout.length > 0) dependencies.stderr(render.workerStdout.trimEnd());
    const green = render.ok && candidateBodyEqualsCurrent(captured, render.candidateBytes);
    state = evaluateMatrixState({
      mode: dependencies.mode,
      evidence,
      selected,
      adoptCurrentEnvironment: false,
      fullCheck: green ? "green" : "failed",
    });
    const result: MatrixResult = green
      ? resultForDecision(state.decision)
      : "CHECK_FAILED";
    const receipt = receiptFor({
      captured,
      mode: dependencies.mode,
      operation: args.operation,
      decision: state.decision,
      result,
      published: false,
      candidate: render.candidateBytes,
      after: captured.documentBytes,
    });
    return emitReceipt(dependencies, receipt, state.exitCode);
  }
  if (state.action === "repair") {
    if (dependencies.mode === "required-v1") {
      if (
        state.decision !== "REPAIR_REQUIRED"
        || (args.operation !== "decide" && args.operation !== "repair")
      ) {
        throw new MatrixControllerFailure("required-v1 repair entered outside its closed state relation");
      }
      return await runRequiredV1RepairTransaction({
        dependencies,
        captured,
        operation: args.operation,
        decision: state.decision,
        progress: args.progress,
      });
    }
    const render = await invokeRender(dependencies, captured, { progress: args.progress, check: false });
    if (render.workerStdout.length > 0) dependencies.stderr(render.workerStdout.trimEnd());
    if (!render.ok || render.candidateBytes === null) {
      dependencies.stderr(`[matrix] legacy repair failed: ${render.error ?? "worker returned no candidate"}`);
      const receipt = receiptFor({
        captured,
        mode: dependencies.mode,
        operation: args.operation,
        decision: state.decision,
        result: "REPAIR_FAILED",
        published: false,
        candidate: null,
        after: captured.documentBytes,
      });
      return emitReceipt(dependencies, receipt, 1);
    }
    let candidateObservation: MatrixDocumentObservation;
    try {
      candidateObservation = parseMatrixDocument(render.candidateBytes);
    } catch (error) {
      dependencies.stderr(`[matrix] legacy repair candidate is invalid: ${String(error)}`);
      const receipt = receiptFor({
        captured,
        mode: dependencies.mode,
        operation: args.operation,
        decision: state.decision,
        result: "REPAIR_FAILED",
        published: false,
        candidate: render.candidateBytes,
        after: captured.documentBytes,
      });
      return emitReceipt(dependencies, receipt, 1);
    }
    if (candidateObservation.stampClass !== "absent") {
      dependencies.stderr("[matrix] legacy repair candidate is not stampless");
      const receipt = receiptFor({
        captured,
        mode: dependencies.mode,
        operation: args.operation,
        decision: state.decision,
        result: "REPAIR_FAILED",
        published: false,
        candidate: render.candidateBytes,
        after: captured.documentBytes,
      });
      return emitReceipt(dependencies, receipt, 1);
    }
    let publicationEntered = false;
    try {
      await dependencies.assertCurrent(captured);
      publicationEntered = true;
      const committed = await dependencies.publish(captured, render.candidateBytes);
      assertMatrixCandidateEqualsCommitted(render.candidateBytes, committed);
      const receipt = receiptFor({
        captured,
        mode: dependencies.mode,
        operation: args.operation,
        decision: state.decision,
        result: "LEGACY_REPAIRED",
        published: true,
        candidate: render.candidateBytes,
        after: committed,
      });
      return emitReceipt(dependencies, receipt, 0);
    } catch (error) {
      dependencies.stderr(`[matrix] legacy publication failed: ${String(error)}`);
      let observed: Uint8Array | null = null;
      try {
        observed = readOptionalMatrix(dependencies.repositoryRoot);
      } catch {
        observed = null;
      }
      if (
        publicationEntered
        &&
        observed !== null
        && Buffer.from(observed).equals(Buffer.from(render.candidateBytes))
      ) {
        const receipt = receiptFor({
          captured,
          mode: dependencies.mode,
          operation: args.operation,
          decision: state.decision,
          result: "LEGACY_REPAIRED",
          published: true,
          candidate: render.candidateBytes,
          after: observed,
        });
        return emitReceipt(dependencies, receipt, 0);
      }
      if (
        (observed === null && captured.documentBytes === null)
        || (
          observed !== null
          && captured.documentBytes !== null
          && Buffer.from(observed).equals(Buffer.from(captured.documentBytes))
        )
      ) {
        const receipt = receiptFor({
          captured,
          mode: dependencies.mode,
          operation: args.operation,
          decision: state.decision,
          result: "REPAIR_FAILED",
          published: false,
          candidate: render.candidateBytes,
          after: captured.documentBytes,
        });
        return emitReceipt(dependencies, receipt, 1);
      }
      const receipt = unavailableReceipt({
        dependencies,
        operation: args.operation,
        result: "REPAIR_FAILED",
        reason: error,
      });
      return emitReceipt(dependencies, receipt, 1);
    }
  }
  if (state.decision === "SKIPPED_LEGACY") {
    dependencies.stderr("[matrix] WARNING: inherited legacy-stampless evidence; NOT regenerated.");
  }
  const result = resultForDecision(state.decision);
  const receipt = receiptFor({
    captured,
    mode: dependencies.mode,
    operation: args.operation,
    decision: state.decision,
    result,
    published: false,
    candidate: null,
    after: captured.documentBytes,
  });
  return emitReceipt(dependencies, receipt, state.exitCode);
}

export async function captureCurrentMatrixLeg(
  repositoryRoot: string,
  receiptInput: MatrixControllerReceipt | Uint8Array,
  capture: typeof captureMatrixPackage = captureMatrixPackage,
  captureStable: typeof captureStableMatrixSource = captureStableMatrixSource,
): Promise<MatrixLeg> {
  const receipt = receiptInput instanceof Uint8Array
    ? parseMatrixControllerReceipt(receiptInput)
    : receiptInput;
  if (receipt.evidence === "unavailable") {
    // A non-byte dependency or environment leg may be unavailable while the
    // umbrella decision remains advisory. Perform exactly one v18 live-byte
    // capture (never retry a failed full-package capture) and leave the
    // package identity explicitly unavailable.
    const stable = await captureStable(repositoryRoot);
    let bodyDigest = stable.documentBytes === null
      ? sha256Raw("fenel.self-host-matrix-absent-body.v1\n")
      : sha256Raw(stable.documentBytes);
    let certificateDigest = stable.documentBytes === null
      ? LEGACY_STAMPLESS_TOMBSTONE_DIGEST
      : UNAVAILABLE_MATRIX_IDENTITY_DIGEST;
    if (stable.documentBytes !== null) {
      try {
        const observation = parseMatrixDocument(stable.documentBytes);
        bodyDigest = observation.bodyDigest;
        certificateDigest = observation.certificateDigest;
      } catch {
        // The exact malformed bytes remain bound while semantics stay unavailable.
      }
    }
    return makeMatrixLeg({
      receipt,
      currentArtifact: matrixArtifactIdentity(stable.documentBytes),
      currentBodyDigest: bodyDigest,
      currentControllerDigest: computeMatrixControllerDigest(stable.source),
      currentPackageDigest: UNAVAILABLE_MATRIX_IDENTITY_DIGEST,
      currentCertificateDigest: certificateDigest,
    });
  }
  const current = await capture(repositoryRoot, {
    presentation: receipt.capturedPresentation,
  });
  if (current.sourceCommit !== receipt.capturedPresentation.sourceCommit) {
    throw new MatrixCertificateError("matrix source commit changed after the receipt");
  }
  const expectedPackageDigest = computeMatrixPackageDigest({
    inputsDigest: current.inputs.digest,
    environmentDigest: current.environment.digest,
    controllerDigest: current.controllerDigest,
    sourceCommit: receipt.capturedPresentation.sourceCommit,
    verified: receipt.capturedPresentation.verified,
    verifiedAtSha: receipt.capturedPresentation.verifiedAtSha,
    initialArtifact: receipt.publication.before,
  });
  return makeMatrixLeg({
    receipt,
    currentArtifact: current.artifactBefore,
    currentBodyDigest: current.observation?.bodyDigest
      ?? sha256Raw("fenel.self-host-matrix-absent-body.v1\n"),
    currentControllerDigest: current.controllerDigest,
    currentPackageDigest: expectedPackageDigest,
    currentCertificateDigest: current.observation?.certificateDigest
      ?? LEGACY_STAMPLESS_TOMBSTONE_DIGEST,
  });
}

async function main(): Promise<number> {
  const result = await runSelfHostMatrixController(process.argv.slice(2));
  return result.exitCode;
}

if (import.meta.main) process.exit(await main());
