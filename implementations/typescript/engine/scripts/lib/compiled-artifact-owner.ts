/** Generic owner transaction for the compiled parser and resolver artifacts. */

import { lstatSync, readFileSync, readdirSync } from "node:fs";
import { isAbsolute, relative, resolve, sep } from "node:path";
import {
  REPOSITORY_EXACT_FILES,
  REPOSITORY_RECURSIVE_ROOTS,
  RECOVERABLE_OUTPUT_EXCLUSIONS,
  captureStableEpoch,
  computeOwnerEpoch,
  digestByteManifest,
  parseSha256Hex,
  repositoryRelativePath,
  sha256Raw,
  type ByteManifest,
  type ByteManifestRow,
  type CaptureIssue,
  type CapturedByteStore,
  type CompiledArtifactId,
  type RepositoryRelativePath,
  type StableEpochCapture,
} from "./artifact-bytes";
import { encodeCanonicalJson } from "./artifact-wire-json";
import {
  canonicalizeProducerAttestations,
  computeEnvironmentFingerprint,
  parseCompiledArtifactCheckAttestation,
  type ArtifactEnvironmentEvidence,
  type AttestationOrigin,
  type CompiledArtifactCheckAttestation,
} from "./compiled-artifact-attestation";
import {
  assertExactLfArtifact,
  compiledArtifactRecoveryStubs,
  makeBaseBuildCertificate,
  mergeArtifactAttestations,
  publishArtifactAndBaseCertificate,
  readArtifactPair,
  replaceArtifactAttestations,
  sha256Bytes,
  RECOVERY_STUB_VERSION,
} from "./compiled-artifact-certificate";
import {
  buildCheckPackageNamespace,
  computeCheckPackageDigest,
  parseCheckPackageMetadata,
  type CheckPackageFileRow,
  type CheckPackageNamespace,
  type CompiledArtifactCheckPackageMetadata,
} from "./compiled-artifact-check-package";
import {
  coldResolveEmptyCompiledArtifactDependencies,
  DependencyEvidenceError,
  proveEmptyCompiledArtifactDependencies,
} from "./compiled-artifact-dependencies";
import {
  acquireCompiledArtifactEnvironment,
  COMPILED_ARTIFACT_ENVIRONMENT_KEYS,
  type AcquiredCompiledArtifactEnvironment,
  type EnvironmentAcquisitionDependencies,
} from "./compiled-artifact-environment";
import {
  ARTIFACT_FRESHNESS_SCHEMA,
  COMPILED_ARTIFACT_SPECS,
  computeCertificateBaseDigest,
  evaluatePortableSeal,
  OWNER_PROBE_EXIT_CODES,
  OWNER_PROTOCOL,
  parseBuildCertificate,
  PORTABLE_GENERATION_ABI,
  validateArtifactFreshnessRecord,
  type ArtifactFreshnessRecord,
  type CompiledArtifactBuildCertificate,
  type CompiledArtifactBuildCertificateBase,
  type FreshArtifactRecord,
  type PolicyComputationError,
  type PortableSeal,
  type StaleReason,
  type Sha256Hex,
  type UndecidableReason,
} from "./compiled-artifact-protocol";
import {
  compiledArtifactSnapshotBootstrap,
  materializeCompiledArtifactSnapshot,
  runCompiledArtifactSnapshotWorker,
  type SnapshotWorkerResult,
  type SnapshotWorkerSpawn,
} from "./compiled-artifact-snapshot";
import {
  ATTESTATION_POLICY_PATHS,
  computeAttestationPolicyDigest,
  computeAttestationPolicyDigestFromBytes,
  ownerOverlaySources,
  validateCompiledArtifactSourceCensus,
} from "./compiled-artifact-source-census";
import { closeCompiledArtifactAcquisition } from "./compiled-artifact-acquisition";
import { captureWorkerDiagnostics } from "./compiled-artifact-worker-progress";
import { makeRawCompiledArtifactInput, rawCompiledArtifactInputsEqual, validateRawCompiledArtifactInput,
  type RawCompiledArtifactInput } from "./compiled-artifact-input-key";
import { prepareCompiledArtifactCheckPackage } from "./compiled-artifact-git-package";
import {
  bunToolchainRowDigest,
  decodeArtifactToolchainManifest,
  selectBunToolchain,
  type ArtifactToolchainManifest,
} from "./compiled-artifact-toolchain";

export const OWNER_TRACE_SCHEMA = "fenel.compiled-artifact-owner-trace.v1" as const;
const TOOLCHAIN_MANIFEST_PATH = repositoryRelativePath(
  ".github/fenel-artifact-toolchains.json",
);
const ROOT_PACKAGE_PATH = repositoryRelativePath("package.json");
const ENGINE_PACKAGE_PATH = repositoryRelativePath(
  "implementations/typescript/engine/package.json",
);
const BUN_LOCK_PATH = repositoryRelativePath("bun.lock");
const DEPENDENCY_MANIFEST_PATH = repositoryRelativePath(".m3b/dependencies.json");
const PORTABILITY_WORKFLOW_PATH = repositoryRelativePath(
  ".github/workflows/compiled-artifact-portability.yml",
);

export type OwnerRepairBranch =
  | "uncomputable"
  | "writer-needed"
  | "compare-first-equal"
  | "compare-first-different";

export type OwnerTransactionTrace = {
  readonly schema: typeof OWNER_TRACE_SCHEMA;
  readonly artifact: CompiledArtifactId;
  readonly branch: OwnerRepairBranch;
  readonly renders: number;
  readonly artifactPublications: number;
  readonly attestationMerges: number;
  readonly postProbes: number;
};

export type OwnerProgress = (stage: string, detail?: string) => void;

export interface OwnerRuntimeDependencies extends EnvironmentAcquisitionDependencies {
  readonly spawnWorker?: SnapshotWorkerSpawn;
  readonly capture?: typeof captureStableEpoch;
  readonly progress?: OwnerProgress;
  readonly origin?: AttestationOrigin;
  /** Deterministic test seam; public controllers never supply acquired evidence. */
  readonly acquiredEnvironment?: AcquiredCompiledArtifactEnvironment;
  /** Deterministic test seam for downstream probe/finalizer tuple validation. */
  readonly capturedEvidence?: OwnerEvidence;
  /** Deterministic race seam immediately before the mandatory post-capture source census. */
  readonly afterEvidenceCapture?: () => void | Promise<void>;
  /** Deterministic test seam for raw-Git reconstruction failures and identities. */
  readonly prepareCheckPackage?: typeof prepareCompiledArtifactCheckPackage;
  /** Deterministic test seam for owner-transaction branch accounting. */
  readonly render?: (input: {
    readonly options: OwnerCommandOptions;
    readonly evidence: OwnerEvidence;
  }) => Promise<SnapshotWorkerResult>;
  readonly independentCheck?: (input: {
    readonly options: OwnerCommandOptions;
    readonly evidence: OwnerEvidence;
  }) => Promise<CompiledArtifactCheckAttestation>;
  /** Deterministic seam for the mandatory pinned-Bun cold-resolution proof. */
  readonly coldResolveDependencies?: typeof coldResolveEmptyCompiledArtifactDependencies;
}

export interface OwnerCommandOptions {
  readonly repositoryRoot: string;
  readonly artifact: CompiledArtifactId;
  readonly expectedRepositoryEpoch?: Sha256Hex;
  readonly allowNetwork?: boolean;
  readonly packagePath?: string;
  /** CLI framing: non-emitting checks need not construct an attestation origin. */
  readonly emitAttestation?: boolean;
}

export interface OwnerCheckResult {
  readonly matches: boolean;
  readonly attestation?: CompiledArtifactCheckAttestation;
  readonly renderedDigest: Sha256Hex;
  readonly candidateDigest: Sha256Hex;
  readonly elapsedMs: number;
}

export interface OwnerRepairResult {
  readonly record: FreshArtifactRecord;
  readonly trace: OwnerTransactionTrace;
}

export type OwnerEvidence = {
  readonly rawInput: RawCompiledArtifactInput;
  readonly capturedBytes: CapturedByteStore;
  readonly repositoryManifest: ByteManifest;
  readonly ownerManifest: ByteManifest;
  readonly environmentManifest: ByteManifest;
  readonly repositoryEpoch: Sha256Hex;
  readonly ownerEpoch: Sha256Hex;
  readonly dependencyDigest: Sha256Hex;
  readonly dependencyManifestBytes: Uint8Array;
  readonly environment: ArtifactEnvironmentEvidence;
  readonly environmentFingerprint: Sha256Hex;
  readonly attestationPolicyDigest: Sha256Hex;
  readonly workflowDigest: Sha256Hex;
  readonly sourceProvenance: CompiledArtifactCheckPackageMetadata["sourceProvenance"];
  readonly sourceNamespace: CheckPackageNamespace;
  readonly environmentNamespace: CheckPackageNamespace;
  readonly toolchainManifestBytes: Uint8Array;
  readonly sourcePaths: readonly RepositoryRelativePath[];
  readonly coveredSourceArchiveDigest: Sha256Hex;
  readonly bunExecutable: string;
};

type ObservedPair = {
  readonly artifactBytes?: Uint8Array;
  readonly artifactDigest?: Sha256Hex;
  readonly certificate?: CompiledArtifactBuildCertificate;
  readonly certificateDigest?: Sha256Hex;
  readonly issues: readonly (StaleReason | UndecidableReason)[];
  readonly concurrent: boolean;
};

class OwnerEvidenceError extends Error {
  constructor(
    readonly reason: UndecidableReason,
    message: string,
    readonly policyDigest?: Sha256Hex,
  ) {
    super(message);
    this.name = "OwnerEvidenceError";
  }
}

function progress(dependencies: OwnerRuntimeDependencies, stage: string, detail = ""): void {
  dependencies.progress?.(stage, detail);
}

function compareUtf8(left: string, right: string): number {
  return Buffer.compare(Buffer.from(left, "utf8"), Buffer.from(right, "utf8"));
}

function canonicalReasons<T extends string>(reasons: readonly T[]): readonly [T, ...T[]] {
  const unique = [...new Set(reasons)].sort(compareUtf8);
  if (unique.length === 0) throw new Error("non-fresh owner verdict requires a reason");
  return unique as [T, ...T[]];
}

function manifestByDomain(capture: StableEpochCapture, domain: string): ByteManifest {
  const matches = capture.domains.filter((candidate) => candidate.domain === domain);
  if (matches.length !== 1) throw new Error(`stable capture lacks unique ${domain} manifest`);
  return matches[0]!;
}

function summary(manifest: ByteManifest): {
  readonly digest: Sha256Hex;
  readonly fileCount: number;
  readonly byteLength: number;
} {
  return {
    digest: manifest.digest,
    fileCount: manifest.fileCount,
    byteLength: manifest.byteLength,
  };
}

function packageRows(
  rows: readonly { readonly path: string; readonly byteLength: number; readonly digest: string }[],
): readonly CheckPackageFileRow[] {
  return Object.freeze(rows.map((row) => ({
    path: row.path,
    kind: "file" as const,
    byteLength: row.byteLength,
    digest: row.digest,
  })).sort((left, right) => compareUtf8(left.path, right.path)));
}

function sourcePackageRows(input: {
  readonly artifact: CompiledArtifactId;
  readonly repository: ByteManifest;
  readonly owner: ByteManifest;
  readonly dependencyManifestBytes: Uint8Array;
}): readonly CheckPackageFileRow[] {
  const rows = new Map<string, CheckPackageFileRow>();
  for (const row of [...input.repository.rows, ...input.owner.rows]) {
    if (rows.has(row.path)) throw new Error(`source package row is duplicated: ${row.path}`);
    rows.set(row.path, {
      path: row.path,
      kind: "file",
      byteLength: row.byteLength,
      digest: row.sha256,
    });
  }
  for (const stub of compiledArtifactRecoveryStubs()) {
    if (rows.has(stub.path)) throw new Error(`recovery stub collides with captured source: ${stub.path}`);
    rows.set(stub.path, {
      path: stub.path,
      kind: "file",
      byteLength: stub.bytes.byteLength,
      digest: stub.digest,
    });
  }
  const bootstrap = compiledArtifactSnapshotBootstrap({ artifact: input.artifact });
  if (rows.has(bootstrap.path)) throw new Error(`snapshot bootstrap collides with source: ${bootstrap.path}`);
  rows.set(bootstrap.path, {
    path: bootstrap.path,
    kind: "file",
    byteLength: bootstrap.bytes.byteLength,
    digest: bootstrap.digest,
  });
  rows.set(DEPENDENCY_MANIFEST_PATH, {
    path: DEPENDENCY_MANIFEST_PATH,
    kind: "file",
    byteLength: input.dependencyManifestBytes.byteLength,
    digest: sha256Raw(input.dependencyManifestBytes),
  });
  return Object.freeze([...rows.values()].sort((left, right) => compareUtf8(left.path, right.path)));
}

type CheckPackageCapture = {
  readonly metadata: CompiledArtifactCheckPackageMetadata;
  readonly source: ReadonlyMap<RepositoryRelativePath, Uint8Array>;
  readonly candidateBytes: Uint8Array;
  readonly environmentManifestBytes: Uint8Array;
};

type PackageScan = {
  readonly files: ReadonlyMap<string, Uint8Array>;
  readonly directories: readonly string[];
};

const PACKAGE_NAMESPACES = ["candidate", "environment", "source"] as const;
const PACKAGE_METADATA_PATH = "metadata.json" as const;
const repositoryExactPaths = new Set<string>(REPOSITORY_EXACT_FILES);
const repositoryExclusions = new Set<string>(RECOVERABLE_OUTPUT_EXCLUSIONS);

function packagePath(root: string, portable: string): string {
  const target = resolve(root, ...portable.split("/"));
  const rel = relative(root, target);
  if (rel === "" || isAbsolute(rel) || rel === ".." || rel.startsWith(`..${sep}`)) {
    throw new Error(`check-package path escapes its root: ${portable}`);
  }
  return target;
}

function scanCheckPackage(root: string): PackageScan {
  const absoluteRoot = resolve(root);
  const rootStat = lstatSync(absoluteRoot);
  if (!rootStat.isDirectory() || rootStat.isSymbolicLink()) {
    throw new Error("check-package root is not one plain directory");
  }
  let ancestor = absoluteRoot;
  for (;;) {
    if (lstatSync(ancestor).isSymbolicLink()) {
      throw new Error("check-package root has a linked ancestor");
    }
    const parent = resolve(ancestor, "..");
    if (parent === ancestor) break;
    ancestor = parent;
  }

  const files = new Map<string, Uint8Array>();
  const directories: string[] = [];
  const folded = new Map<string, string>();
  const addCanonical = (portable: string): void => {
    repositoryRelativePath(portable);
    const key = portable.toLowerCase();
    const prior = folded.get(key);
    if (prior !== undefined && prior !== portable) {
      throw new Error(`check-package paths collide by case: ${prior} and ${portable}`);
    }
    folded.set(key, portable);
  };
  const walk = (directory: string, prefix: string): void => {
    const entries = readdirSync(directory, { withFileTypes: true })
      .sort((left, right) => compareUtf8(left.name, right.name));
    for (const entry of entries) {
      const portable = prefix === "" ? entry.name : `${prefix}/${entry.name}`;
      addCanonical(portable);
      const target = packagePath(absoluteRoot, portable);
      const stat = lstatSync(target);
      if (stat.isSymbolicLink()) throw new Error(`check package contains a link: ${portable}`);
      if (stat.isDirectory()) {
        directories.push(portable);
        walk(target, portable);
      } else if (stat.isFile()) {
        files.set(portable, new Uint8Array(readFileSync(target)));
      } else {
        throw new Error(`check package contains a non-file entry: ${portable}`);
      }
    }
  };
  walk(absoluteRoot, "");
  return Object.freeze({
    files,
    directories: Object.freeze(directories.sort(compareUtf8)),
  });
}

function equalPackageScans(left: PackageScan, right: PackageScan): boolean {
  if (left.directories.join("\0") !== right.directories.join("\0")) return false;
  const leftPaths = [...left.files.keys()].sort(compareUtf8);
  const rightPaths = [...right.files.keys()].sort(compareUtf8);
  if (leftPaths.join("\0") !== rightPaths.join("\0")) return false;
  return leftPaths.every((path) =>
    Buffer.from(left.files.get(path)!).equals(Buffer.from(right.files.get(path)!)));
}

function expectedPackageDirectories(paths: readonly string[]): readonly string[] {
  const directories = new Set<string>(PACKAGE_NAMESPACES);
  for (const path of paths) {
    const segments = path.split("/");
    for (let index = 1; index < segments.length; index += 1) {
      directories.add(segments.slice(0, index).join("/"));
    }
  }
  return Object.freeze([...directories].sort(compareUtf8));
}

function namespaceBytes(
  scan: PackageScan,
  metadata: CompiledArtifactCheckPackageMetadata,
  namespace: (typeof PACKAGE_NAMESPACES)[number],
): ReadonlyMap<RepositoryRelativePath, Uint8Array> {
  const result = new Map<RepositoryRelativePath, Uint8Array>();
  for (const row of metadata.namespaces[namespace].files) {
    const path = repositoryRelativePath(row.path);
    const bytes = scan.files.get(`${namespace}/${path}`);
    if (bytes === undefined) throw new Error(`check package lacks ${namespace}/${path}`);
    if (bytes.byteLength !== row.byteLength || sha256Raw(bytes) !== row.digest) {
      throw new Error(`check package bytes differ from ${namespace} manifest: ${path}`);
    }
    result.set(path, new Uint8Array(bytes));
  }
  return result;
}

export function captureCompiledArtifactCheckPackage(
  packageRoot: string,
  expectedArtifact: CompiledArtifactId,
): CheckPackageCapture {
  const first = scanCheckPackage(packageRoot);
  const second = scanCheckPackage(packageRoot);
  if (!equalPackageScans(first, second)) {
    throw new Error("check package changed during its A/B capture");
  }
  const metadataBytes = second.files.get(PACKAGE_METADATA_PATH);
  if (metadataBytes === undefined) throw new Error("check package lacks metadata.json");
  const metadata = parseCheckPackageMetadata(metadataBytes);
  if (metadata.artifact !== expectedArtifact) {
    throw new Error(`check package contains ${metadata.artifact}, expected ${expectedArtifact}`);
  }
  if (metadata.sourceProvenance.kind !== "git-object") {
    throw new Error("detached check package must have Git-object provenance");
  }

  const expectedFiles = new Set<string>([PACKAGE_METADATA_PATH]);
  for (const namespace of PACKAGE_NAMESPACES) {
    for (const row of metadata.namespaces[namespace].files) {
      expectedFiles.add(`${namespace}/${row.path}`);
    }
  }
  const actualFiles = [...second.files.keys()].sort(compareUtf8);
  const canonicalExpectedFiles = [...expectedFiles].sort(compareUtf8);
  if (actualFiles.join("\0") !== canonicalExpectedFiles.join("\0")) {
    throw new Error("check package physical files differ from its three namespace manifests");
  }
  const expectedDirectories = expectedPackageDirectories(canonicalExpectedFiles);
  if (second.directories.join("\0") !== expectedDirectories.join("\0")) {
    throw new Error("check package physical directories differ from its exact namespace layout");
  }

  const source = namespaceBytes(second, metadata, "source");
  const candidate = namespaceBytes(second, metadata, "candidate");
  const environment = namespaceBytes(second, metadata, "environment");
  const candidateBytes = candidate.get(repositoryRelativePath(metadata.artifactPath));
  if (candidateBytes === undefined || candidate.size !== 1) {
    throw new Error("check package candidate namespace is not exact");
  }
  assertExactLfArtifact(candidateBytes);
  const environmentManifestBytes = environment.get(TOOLCHAIN_MANIFEST_PATH);
  if (environmentManifestBytes === undefined || environment.size !== 1) {
    throw new Error("check package environment namespace is not exact");
  }
  return Object.freeze({
    metadata,
    source,
    candidateBytes: new Uint8Array(candidateBytes),
    environmentManifestBytes: new Uint8Array(environmentManifestBytes),
  });
}

function commonRepositoryPath(path: RepositoryRelativePath): boolean {
  if (repositoryExclusions.has(path)) return false;
  if (repositoryExactPaths.has(path)) return true;
  return REPOSITORY_RECURSIVE_ROOTS.some((root) => path.startsWith(`${root}/`));
}

class PackageCapturedByteStore implements CapturedByteStore {
  readonly paths: readonly RepositoryRelativePath[];
  readonly #bytes: ReadonlyMap<RepositoryRelativePath, Uint8Array>;

  constructor(input: ReadonlyMap<RepositoryRelativePath, Uint8Array>) {
    const bytes = new Map<RepositoryRelativePath, Uint8Array>();
    for (const [path, value] of input) bytes.set(path, new Uint8Array(value));
    this.#bytes = bytes;
    this.paths = Object.freeze([...bytes.keys()].sort((left, right) => compareUtf8(left, right)));
  }

  has(path: RepositoryRelativePath): boolean {
    return this.#bytes.has(path);
  }

  read(path: RepositoryRelativePath): Uint8Array {
    const bytes = this.#bytes.get(path);
    if (bytes === undefined) throw new RangeError(`package source path is absent: ${path}`);
    return new Uint8Array(bytes);
  }
}

function byteManifestRow(path: RepositoryRelativePath, bytes: Uint8Array): ByteManifestRow {
  return Object.freeze({
    path,
    kind: "regular-file",
    byteLength: bytes.byteLength,
    sha256: sha256Raw(bytes),
  });
}

function captureIssueReason(issue: CaptureIssue): UndecidableReason {
  if (["watcher-error", "watcher-loss", "watcher-unsupported", "covered-mutation", "scan-mismatch"].includes(issue.code)) {
    return "concurrent-mutation";
  }
  return "repository-uncomputable";
}

function policyComputationError(issue: CaptureIssue): PolicyComputationError | undefined {
  if (issue.code === "missing-input") return "missing-input";
  if (issue.code === "unreadable-input") return "unreadable-input";
  if (issue.code === "ambiguous-input") return "ambiguous-input";
  if (issue.code === "canonicalization-failed") return "canonicalization-failed";
  return undefined;
}

function capturedPackageManager(bytes: Uint8Array): string {
  let value: unknown;
  try {
    value = JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(bytes));
  } catch (error) {
    throw new OwnerEvidenceError("repository-uncomputable", "captured package.json is invalid", undefined);
  }
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    throw new OwnerEvidenceError("repository-uncomputable", "captured package.json is not an object");
  }
  const pin = (value as Record<string, unknown>).packageManager;
  if (typeof pin !== "string" || pin.length === 0) {
    throw new OwnerEvidenceError("repository-uncomputable", "captured package.json lacks packageManager");
  }
  return pin;
}

function assertPinnedControllerRuntime(acquired: AcquiredCompiledArtifactEnvironment): void {
  if (
    Bun.version !== acquired.environment.bun.release
    || Bun.revision !== acquired.environment.bun.revision
  ) {
    throw new OwnerEvidenceError(
      "environment-uncomputable",
      "owner controller must run under the exact selected Bun release/revision",
    );
  }
}

async function stableCapture(
  repositoryRoot: string,
  artifact: CompiledArtifactId,
  dependencies: OwnerRuntimeDependencies,
): Promise<StableEpochCapture> {
  const ownerFiles = ownerOverlaySources(artifact).map(repositoryRelativePath);
  const policyFiles = ATTESTATION_POLICY_PATHS.map(repositoryRelativePath);
  const result = await (dependencies.capture ?? captureStableEpoch)({
    repositoryRoot,
    domains: [
      { kind: "owner-overlay", artifact, exactFiles: ownerFiles },
      {
        kind: "envelope",
        name: "compiled-artifact-environment",
        exactFiles: [TOOLCHAIN_MANIFEST_PATH],
      },
      {
        kind: "envelope",
        name: "compiled-artifact-policy",
        exactFiles: policyFiles,
      },
    ],
  });
  if (!result.ok) {
    const issuePath = "path" in result.issue ? result.issue.path : undefined;
    if (issuePath !== undefined && policyFiles.some((path) => path === issuePath)) {
      const error = policyComputationError(result.issue);
      if (error !== undefined) throw new OwnerEvidenceError("portable-proof-uncomputable", error);
    }
    throw new OwnerEvidenceError(
      captureIssueReason(result.issue),
      issuePath === undefined ? result.issue.code : `${result.issue.code}: ${issuePath}`,
    );
  }
  return result.value;
}

function policyNullRecord(
  artifact: CompiledArtifactId,
  error: PolicyComputationError,
): ArtifactFreshnessRecord {
  return validateArtifactFreshnessRecord({
    schema: ARTIFACT_FRESHNESS_SCHEMA,
    artifact,
    verdict: "UNDECIDABLE",
    portableSeal: "unresolved",
    reasons: ["attestation-policy-uncomputable"],
    attestationPolicyDigest: null,
    policyComputationError: error,
  });
}

function undecidableRecord(input: {
  readonly artifact: CompiledArtifactId;
  readonly reason: UndecidableReason;
  readonly policyDigest: Sha256Hex;
  readonly evidence?: Partial<Pick<OwnerEvidence,
    "repositoryEpoch" | "ownerEpoch" | "dependencyDigest" | "environmentFingerprint">>;
}): ArtifactFreshnessRecord {
  // Project the public identity tuple explicitly.  Callers may hold a richer
  // OwnerEvidence value at runtime; spreading it would leak private capture
  // state into the deliberately closed freshness wire schema.
  const evidenceIdentity = input.evidence === undefined ? {} : {
    ...(input.evidence.repositoryEpoch === undefined
      ? {}
      : { repositoryEpoch: input.evidence.repositoryEpoch }),
    ...(input.evidence.ownerEpoch === undefined
      ? {}
      : { ownerEpoch: input.evidence.ownerEpoch }),
    ...(input.evidence.dependencyDigest === undefined
      ? {}
      : { dependencyDigest: input.evidence.dependencyDigest }),
    ...(input.evidence.environmentFingerprint === undefined
      ? {}
      : { environmentFingerprint: input.evidence.environmentFingerprint }),
  };
  return validateArtifactFreshnessRecord({
    schema: ARTIFACT_FRESHNESS_SCHEMA,
    artifact: input.artifact,
    verdict: "UNDECIDABLE",
    portableSeal: "unresolved",
    reasons: [input.reason],
    attestationPolicyDigest: input.policyDigest,
    ...evidenceIdentity,
  });
}

async function captureEvidence(
  options: OwnerCommandOptions,
  acquired: AcquiredCompiledArtifactEnvironment,
  dependencies: OwnerRuntimeDependencies,
): Promise<OwnerEvidence> {
  assertPinnedControllerRuntime(acquired);
  if (dependencies.capturedEvidence !== undefined) {
    if (
      options.expectedRepositoryEpoch !== undefined
      && dependencies.capturedEvidence.repositoryEpoch !== options.expectedRepositoryEpoch
    ) {
      throw new OwnerEvidenceError(
        "concurrent-mutation",
        `expected repository epoch ${options.expectedRepositoryEpoch}, observed ${dependencies.capturedEvidence.repositoryEpoch}`,
      );
    }
    await dependencies.afterEvidenceCapture?.();
    validateCompiledArtifactSourceCensus(options.repositoryRoot);
    return dependencies.capturedEvidence;
  }
  const capture = await stableCapture(options.repositoryRoot, options.artifact, dependencies);
  const repositoryManifest = capture.repository;
  const ownerManifest = manifestByDomain(capture, `owner-overlay:${options.artifact}`);
  const environmentManifest = manifestByDomain(capture, "envelope:compiled-artifact-environment");
  manifestByDomain(capture, "envelope:compiled-artifact-policy");
  if (
    options.expectedRepositoryEpoch !== undefined
    && capture.repositoryEpoch !== options.expectedRepositoryEpoch
  ) {
    throw new OwnerEvidenceError(
      "concurrent-mutation",
      `expected repository epoch ${options.expectedRepositoryEpoch}, observed ${capture.repositoryEpoch}`,
    );
  }
  const staticDependency = proveEmptyCompiledArtifactDependencies({
    packageJsonBytes: capture.bytes.read(ENGINE_PACKAGE_PATH),
    bunLockBytes: capture.bytes.read(BUN_LOCK_PATH),
  });
  const dependencyManifestBytes = new TextEncoder().encode(staticDependency.canonicalManifest);
  if (
    capturedPackageManager(capture.bytes.read(ROOT_PACKAGE_PATH))
    !== `bun@${acquired.environment.bun.release}`
  ) {
    throw new OwnerEvidenceError(
      "environment-uncomputable",
      "acquired Bun evidence differs from the stable root packageManager pin",
    );
  }
  const policy = computeAttestationPolicyDigestFromBytes(capture.bytes);
  if (!policy.ok) {
    throw new OwnerEvidenceError("portable-proof-uncomputable", policy.error);
  }
  if (acquired.manifest.manifestDigest !== environmentManifest.rows[0]?.sha256) {
    throw new OwnerEvidenceError(
      "environment-uncomputable",
      "acquired toolchain manifest differs from the stable capture",
      policy.digest,
    );
  }
  const ownerEpoch = computeOwnerEpoch({
    artifact: options.artifact,
    repositoryEpoch: capture.repositoryEpoch,
    ownerOverlayDigest: ownerManifest.digest,
    dependencyDigest: parseSha256Hex(staticDependency.dependencyDigest),
    protocolVersion: OWNER_PROTOCOL,
    recoveryStubVersion: RECOVERY_STUB_VERSION,
    portableGenerationAbi: PORTABLE_GENERATION_ABI,
  });
  const acquisition = closeCompiledArtifactAcquisition({
    entrypoints: [repositoryRelativePath(
      options.artifact === "compiled-parser"
        ? "implementations/typescript/engine/scripts/generate-compiled-parser-worker.ts"
        : "implementations/typescript/engine/scripts/generate-compiled-resolver-worker.ts",
    )],
    bytes: capture.bytes,
    materializedFiles: compiledArtifactRecoveryStubs().map((stub) => ({
      path: repositoryRelativePath(stub.path),
      bytes: stub.bytes,
    })),
    declaredEnvironmentKeys: COMPILED_ARTIFACT_ENVIRONMENT_KEYS,
  });
  const dependency = await (
    dependencies.coldResolveDependencies ?? coldResolveEmptyCompiledArtifactDependencies
  )({
    repositoryRoot: options.repositoryRoot,
    bunExecutable: acquired.bunExecutable,
    bunExecutableSha256: acquired.environment.bun.executableDigest,
    rootPackageJsonBytes: capture.bytes.read(ROOT_PACKAGE_PATH),
    packageJsonBytes: capture.bytes.read(ENGINE_PACKAGE_PATH),
    bunLockBytes: capture.bytes.read(BUN_LOCK_PATH),
    expectedDependencyManifestBytes: dependencyManifestBytes,
  });
  if (
    dependency.dependencyDigest !== staticDependency.dependencyDigest
    || dependency.observedCanonicalManifest !== staticDependency.canonicalManifest
  ) {
    throw new DependencyEvidenceError(
      "dependency-manifest-mismatch",
      "cold dependency proof differs from the stable static projection",
    );
  }
  const sourceNamespace = buildCheckPackageNamespace(
    "source",
    sourcePackageRows({
      artifact: options.artifact,
      repository: repositoryManifest,
      owner: ownerManifest,
      dependencyManifestBytes,
    }),
  );
  const environmentNamespace = buildCheckPackageNamespace(
    "environment",
    packageRows(environmentManifest.rows.map((row) => ({
      path: row.path,
      byteLength: row.byteLength,
      digest: row.sha256,
    }))),
  );
  const sourcePaths = Object.freeze([
    ...repositoryManifest.rows.map((row) => row.path),
    ...ownerManifest.rows.map((row) => row.path),
  ].sort(compareUtf8));
  const environmentFingerprint = computeEnvironmentFingerprint(acquired.environment);
  const rawInput = makeRawCompiledArtifactInput({ artifact: options.artifact, acquisitionDigest: acquisition.digest,
    ownerOverlayDigest: ownerManifest.digest, repositoryExactDigest: repositoryExactInputDigest(repositoryManifest),
    dependencyDigest: dependency.dependencyDigest, environmentFingerprint,
    recoveryStubVersion: RECOVERY_STUB_VERSION, portableGenerationAbi: PORTABLE_GENERATION_ABI });
  // Close the discovery race between the import-inert preflight and this stable capture.
  await dependencies.afterEvidenceCapture?.();
  validateCompiledArtifactSourceCensus(options.repositoryRoot);
  return Object.freeze({
    rawInput,
    capturedBytes: capture.bytes,
    repositoryManifest,
    ownerManifest,
    environmentManifest,
    repositoryEpoch: capture.repositoryEpoch,
    ownerEpoch,
    dependencyDigest: dependency.dependencyDigest as Sha256Hex,
    dependencyManifestBytes,
    environment: acquired.environment,
    environmentFingerprint,
    attestationPolicyDigest: policy.digest,
    workflowDigest: sha256Raw(capture.bytes.read(PORTABILITY_WORKFLOW_PATH)),
    sourceProvenance: { kind: "stable-live" as const },
    sourceNamespace,
    environmentNamespace,
    toolchainManifestBytes: capture.bytes.read(TOOLCHAIN_MANIFEST_PATH),
    sourcePaths,
    coveredSourceArchiveDigest: sourceNamespace.digest,
    bunExecutable: acquired.bunExecutable,
  });
}

function equivalentEvidence(left: OwnerEvidence, right: OwnerEvidence): boolean {
  return rawCompiledArtifactInputsEqual(left.rawInput, right.rawInput)
    && left.repositoryEpoch === right.repositoryEpoch
    && left.ownerEpoch === right.ownerEpoch
    && left.dependencyDigest === right.dependencyDigest
    && left.environmentFingerprint === right.environmentFingerprint
    && left.attestationPolicyDigest === right.attestationPolicyDigest
    && left.workflowDigest === right.workflowDigest
    && left.sourceNamespace.digest === right.sourceNamespace.digest
    && left.environmentNamespace.digest === right.environmentNamespace.digest;
}

/** Exact runtime/package/lock controls remain byte-pinned even if a current
 * worker's static import graph does not mention them. No semantic filtering.
 */
function repositoryExactInputDigest(manifest: ByteManifest): Sha256Hex {
  const rows = REPOSITORY_EXACT_FILES.map(path => {
    const row = manifest.rows.find(candidate => candidate.path === path);
    if (row === undefined) throw new Error(`complete owner input lacks exact repository row ${path}`);
    return row;
  });
  return digestByteManifest("compiled-owner-exact-inputs:v1", rows).digest;
}

function sameProducerCapture(certificate: CompiledArtifactBuildCertificateBase, evidence: OwnerEvidence): boolean {
  return certificate.repositoryEpoch === evidence.repositoryEpoch && certificate.ownerEpoch === evidence.ownerEpoch
    && certificate.inputManifest.coveredSourceArchiveDigest === evidence.coveredSourceArchiveDigest;
}

function sameProducerPackage(certificate: CompiledArtifactBuildCertificateBase, evidence: OwnerEvidence,
  artifactBytes: Uint8Array): boolean {
  return sameProducerCapture(certificate, evidence)
    && certificate.producerCheckPackageDigest === computeCheckPackageDigest(checkPackageMetadata(
      certificate.artifact, evidence, artifactBytes, { kind: "stable-live" }, certificate.producerInput));
}

/** Foreign independent checks still fully render. This source-only comparison
 * is NOT cheap retention: the full exact environment remains in the raw key.
 */
function sameRawSourceInputs(producer: RawCompiledArtifactInput, current: RawCompiledArtifactInput): boolean {
  const admitted = validateRawCompiledArtifactInput(producer);
  const { schema: _schema, contract: _contract, key: _key, ...components } = admitted;
  return rawCompiledArtifactInputsEqual(makeRawCompiledArtifactInput({ ...components,
    environmentFingerprint: current.environmentFingerprint }), current);
}

async function acquireEnvironment(
  options: OwnerCommandOptions,
  dependencies: OwnerRuntimeDependencies,
): Promise<AcquiredCompiledArtifactEnvironment> {
  if (dependencies.acquiredEnvironment !== undefined) return dependencies.acquiredEnvironment;
  const repositoryRoot = resolve(options.repositoryRoot);
  const toolchainPath = resolve(repositoryRoot, TOOLCHAIN_MANIFEST_PATH);
  const packagePath = resolve(repositoryRoot, ROOT_PACKAGE_PATH);
  return acquireCompiledArtifactEnvironment({
    repositoryRoot,
    toolchainManifestBytes: new Uint8Array(readFileSync(toolchainPath)),
    rootPackageJsonBytes: new Uint8Array(readFileSync(packagePath)),
  }, {
    ...dependencies,
    allowNetwork: options.allowNetwork ?? dependencies.allowNetwork ?? false,
  });
}

async function acquirePackageEnvironment(
  options: OwnerCommandOptions,
  captured: CheckPackageCapture,
  dependencies: OwnerRuntimeDependencies,
): Promise<AcquiredCompiledArtifactEnvironment> {
  if (dependencies.acquiredEnvironment !== undefined) return dependencies.acquiredEnvironment;
  const rootPackageJsonBytes = captured.source.get(ROOT_PACKAGE_PATH);
  if (rootPackageJsonBytes === undefined) {
    throw new Error("check package lacks source/package.json");
  }
  return acquireCompiledArtifactEnvironment({
    // Package checks use the checkout only as the marker-owned toolchain/snapshot cache location.
    repositoryRoot: resolve(options.repositoryRoot),
    toolchainManifestBytes: captured.environmentManifestBytes,
    rootPackageJsonBytes,
  }, {
    ...dependencies,
    allowNetwork: options.allowNetwork ?? dependencies.allowNetwork ?? false,
  });
}

function exactBytes(left: Uint8Array, right: Uint8Array): boolean {
  return Buffer.from(left).equals(Buffer.from(right));
}

function requireSourceBytes(
  source: ReadonlyMap<RepositoryRelativePath, Uint8Array>,
  path: RepositoryRelativePath,
): Uint8Array {
  const bytes = source.get(path);
  if (bytes === undefined) throw new Error(`check package lacks source/${path}`);
  return bytes;
}

async function packageEvidence(
  options: OwnerCommandOptions,
  captured: CheckPackageCapture,
  acquired: AcquiredCompiledArtifactEnvironment,
  dependencies: OwnerRuntimeDependencies,
): Promise<OwnerEvidence> {
  assertPinnedControllerRuntime(acquired);
  const metadata = captured.metadata;
  if (metadata.sourceProvenance.kind !== "git-object") {
    throw new Error("check package source provenance is not Git-object");
  }
  const ownerPaths = new Set(ownerOverlaySources(options.artifact).map(repositoryRelativePath));
  const special = new Map<RepositoryRelativePath, Uint8Array>();
  for (const stub of compiledArtifactRecoveryStubs()) {
    special.set(repositoryRelativePath(stub.path), new Uint8Array(stub.bytes));
  }
  const bootstrap = compiledArtifactSnapshotBootstrap({ artifact: options.artifact });
  special.set(bootstrap.path, new Uint8Array(bootstrap.bytes));
  const dependencyManifestBytes = requireSourceBytes(captured.source, DEPENDENCY_MANIFEST_PATH);
  special.set(DEPENDENCY_MANIFEST_PATH, new Uint8Array(dependencyManifestBytes));

  for (const [path, expected] of special) {
    const observed = requireSourceBytes(captured.source, path);
    if (!exactBytes(observed, expected)) {
      throw new Error(`check package fixed materialization row differs: ${path}`);
    }
  }

  const repositoryRows: ByteManifestRow[] = [];
  const ownerRows: ByteManifestRow[] = [];
  const capturedSource = new Map<RepositoryRelativePath, Uint8Array>();
  for (const [path, bytes] of captured.source) {
    if (special.has(path)) continue;
    if (commonRepositoryPath(path)) {
      repositoryRows.push(byteManifestRow(path, bytes));
      capturedSource.set(path, bytes);
    } else if (ownerPaths.has(path)) {
      ownerRows.push(byteManifestRow(path, bytes));
      capturedSource.set(path, bytes);
    } else {
      throw new Error(`check package source path is outside the exact owner universe: ${path}`);
    }
  }
  for (const path of REPOSITORY_EXACT_FILES) requireSourceBytes(captured.source, path);
  for (const path of ownerPaths) requireSourceBytes(captured.source, path);

  const repositoryManifest = digestByteManifest("repository", repositoryRows);
  const ownerManifest = digestByteManifest(`owner-overlay:${options.artifact}`, ownerRows);
  if (repositoryManifest.digest !== metadata.repositoryEpoch) {
    throw new Error("check package repository epoch does not match its source bytes");
  }
  const staticDependency = proveEmptyCompiledArtifactDependencies({
    packageJsonBytes: requireSourceBytes(captured.source, ENGINE_PACKAGE_PATH),
    bunLockBytes: requireSourceBytes(captured.source, BUN_LOCK_PATH),
  });
  const expectedDependencyBytes = new TextEncoder().encode(staticDependency.canonicalManifest);
  if (!exactBytes(expectedDependencyBytes, dependencyManifestBytes)) {
    throw new Error("check package dependency manifest is not the canonical lock projection");
  }
  if (staticDependency.dependencyDigest !== metadata.dependencyDigest) {
    throw new Error("check package dependency digest does not match its source bytes");
  }
  const ownerEpoch = computeOwnerEpoch({
    artifact: options.artifact,
    repositoryEpoch: repositoryManifest.digest,
    ownerOverlayDigest: ownerManifest.digest,
    dependencyDigest: parseSha256Hex(staticDependency.dependencyDigest),
    protocolVersion: OWNER_PROTOCOL,
    recoveryStubVersion: RECOVERY_STUB_VERSION,
    portableGenerationAbi: PORTABLE_GENERATION_ABI,
  });
  if (ownerEpoch !== metadata.ownerEpoch) {
    throw new Error("check package owner epoch does not match its source bytes");
  }
  if (
    options.expectedRepositoryEpoch !== undefined
    && options.expectedRepositoryEpoch !== repositoryManifest.digest
  ) {
    throw new Error("check package does not match the expected repository epoch");
  }

  const bytes = new PackageCapturedByteStore(capturedSource);
  const acquisition = closeCompiledArtifactAcquisition({
    entrypoints: [repositoryRelativePath(
      options.artifact === "compiled-parser"
        ? "implementations/typescript/engine/scripts/generate-compiled-parser-worker.ts"
        : "implementations/typescript/engine/scripts/generate-compiled-resolver-worker.ts",
    )],
    bytes,
    materializedFiles: compiledArtifactRecoveryStubs().map((stub) => ({
      path: repositoryRelativePath(stub.path),
      bytes: stub.bytes,
    })),
    declaredEnvironmentKeys: COMPILED_ARTIFACT_ENVIRONMENT_KEYS,
  });
  const dependency = await (
    dependencies.coldResolveDependencies ?? coldResolveEmptyCompiledArtifactDependencies
  )({
    repositoryRoot: options.repositoryRoot,
    bunExecutable: acquired.bunExecutable,
    bunExecutableSha256: acquired.environment.bun.executableDigest,
    rootPackageJsonBytes: requireSourceBytes(captured.source, ROOT_PACKAGE_PATH),
    packageJsonBytes: requireSourceBytes(captured.source, ENGINE_PACKAGE_PATH),
    bunLockBytes: requireSourceBytes(captured.source, BUN_LOCK_PATH),
    expectedDependencyManifestBytes: dependencyManifestBytes,
  });
  if (
    dependency.dependencyDigest !== staticDependency.dependencyDigest
    || dependency.observedCanonicalManifest !== staticDependency.canonicalManifest
    || dependency.dependencyDigest !== metadata.dependencyDigest
  ) {
    throw new Error("cold dependency digest does not match the check package metadata");
  }

  const environmentManifest = digestByteManifest(
    "envelope:compiled-artifact-environment",
    [byteManifestRow(TOOLCHAIN_MANIFEST_PATH, captured.environmentManifestBytes)],
  );
  if (acquired.manifest.manifestDigest !== sha256Raw(captured.environmentManifestBytes)) {
    throw new Error("acquired toolchain manifest differs from the package environment row");
  }
  const sourcePaths = Object.freeze(bytes.paths.slice().sort(compareUtf8));
  const environmentFingerprint = computeEnvironmentFingerprint(acquired.environment);
  const rawInput = makeRawCompiledArtifactInput({ artifact: options.artifact, acquisitionDigest: acquisition.digest,
    ownerOverlayDigest: ownerManifest.digest, repositoryExactDigest: repositoryExactInputDigest(repositoryManifest),
    dependencyDigest: metadata.dependencyDigest, environmentFingerprint,
    recoveryStubVersion: RECOVERY_STUB_VERSION, portableGenerationAbi: PORTABLE_GENERATION_ABI });
  if (!sameRawSourceInputs(metadata.producerInput, rawInput)) throw new Error("check package producer recipe differs from its complete raw source inputs");
  return Object.freeze({
    rawInput,
    capturedBytes: bytes,
    repositoryManifest,
    ownerManifest,
    environmentManifest,
    repositoryEpoch: metadata.repositoryEpoch,
    ownerEpoch: metadata.ownerEpoch,
    dependencyDigest: metadata.dependencyDigest,
    dependencyManifestBytes: new Uint8Array(dependencyManifestBytes),
    environment: acquired.environment,
    environmentFingerprint,
    attestationPolicyDigest: metadata.attestationPolicyDigest,
    workflowDigest: metadata.sourceProvenance.workflowDigest,
    sourceProvenance: metadata.sourceProvenance,
    sourceNamespace: metadata.namespaces.source,
    environmentNamespace: metadata.namespaces.environment,
    toolchainManifestBytes: new Uint8Array(captured.environmentManifestBytes),
    sourcePaths,
    coveredSourceArchiveDigest: metadata.namespaces.source.digest,
    bunExecutable: acquired.bunExecutable,
  });
}

function packageOrigin(
  captured: CheckPackageCapture,
  dependencies: OwnerRuntimeDependencies,
): AttestationOrigin {
  if (dependencies.origin !== undefined) {
    if (dependencies.origin.kind === "ci") {
      const provenance = captured.metadata.sourceProvenance;
      if (
        provenance.kind !== "git-object"
        || dependencies.origin.sourceCommit !== provenance.sourceCommit
        || dependencies.origin.workflowDigest !== provenance.workflowDigest
      ) {
        throw new Error("injected CI origin does not bind the check package provenance");
      }
    }
    return dependencies.origin;
  }
  if (process.env.GITHUB_ACTIONS !== "true") return { kind: "local" };
  const provenance = captured.metadata.sourceProvenance;
  if (provenance.kind !== "git-object") throw new Error("CI package lacks Git-object provenance");
  const sourceCommit = process.env.GITHUB_SHA;
  const workflowRunId = process.env.GITHUB_RUN_ID;
  const rawAttempt = process.env.GITHUB_RUN_ATTEMPT;
  const workflowRef = process.env.GITHUB_WORKFLOW_REF;
  if (
    workflowRef === undefined
    || !workflowRef.includes("/.github/workflows/compiled-artifact-portability.yml@")
  ) {
    throw new Error("attestation emission is not running in the portability workflow");
  }
  if (sourceCommit !== provenance.sourceCommit) {
    throw new Error("GitHub source SHA does not match the check package");
  }
  if (workflowRunId === undefined || !/^[1-9][0-9]*$/u.test(workflowRunId)) {
    throw new Error("GitHub workflow run id is missing or malformed");
  }
  if (rawAttempt === undefined || !/^[1-9][0-9]*$/u.test(rawAttempt)) {
    throw new Error("GitHub workflow run attempt is missing or malformed");
  }
  const workflowRunAttempt = Number(rawAttempt);
  if (!Number.isSafeInteger(workflowRunAttempt)) {
    throw new Error("GitHub workflow run attempt exceeds the safe integer range");
  }
  return {
    kind: "ci",
    sourceCommit,
    workflowDigest: provenance.workflowDigest,
    workflowRunId,
    workflowRunAttempt,
  };
}

function readPair(repositoryRoot: string, artifact: CompiledArtifactId): ObservedPair {
  const spec = COMPILED_ARTIFACT_SPECS[artifact];
  const certificatePath = resolve(repositoryRoot, spec.certificatePath);
  const artifactPath = resolve(repositoryRoot, spec.artifactPath);
  const issues: (StaleReason | UndecidableReason)[] = [];
  let sidecarA: Uint8Array | undefined;
  let sidecarB: Uint8Array | undefined;
  let artifactBytes: Uint8Array | undefined;
  try {
    sidecarA = new Uint8Array(readFileSync(certificatePath));
  } catch (error) {
    const code = (error as NodeJS.ErrnoException).code;
    issues.push(code === "ENOENT" ? "certificate-missing" : "certificate-unreadable");
  }
  try {
    artifactBytes = new Uint8Array(readFileSync(artifactPath));
  } catch (error) {
    const code = (error as NodeJS.ErrnoException).code;
    issues.push(code === "ENOENT" ? "artifact-missing" : "artifact-unreadable");
  }
  if (sidecarA !== undefined) {
    try {
      sidecarB = new Uint8Array(readFileSync(certificatePath));
    } catch {
      issues.push("concurrent-mutation");
    }
  }
  if (
    sidecarA !== undefined
    && sidecarB !== undefined
    && !Buffer.from(sidecarA).equals(Buffer.from(sidecarB))
  ) {
    return { issues: ["concurrent-mutation"], concurrent: true };
  }
  let certificate: CompiledArtifactBuildCertificate | undefined;
  let certificateDigest: Sha256Hex | undefined;
  if (sidecarA !== undefined && sidecarB !== undefined) {
    try {
      certificate = parseBuildCertificate(sidecarA);
      certificateDigest = sha256Raw(sidecarA);
    } catch {
      issues.push("certificate-invalid");
    }
  }
  let artifactDigest: Sha256Hex | undefined;
  if (artifactBytes !== undefined) {
    try {
      assertExactLfArtifact(artifactBytes);
      artifactDigest = sha256Bytes(artifactBytes);
    } catch {
      issues.push("artifact-invalid-eol");
    }
  }
  if (certificate !== undefined && artifactBytes !== undefined && artifactDigest !== undefined) {
    if (certificate.artifactByteLength !== artifactBytes.byteLength) {
      issues.push("artifact-length-mismatch");
    }
    if (certificate.artifactDigest !== artifactDigest) issues.push("artifact-digest-mismatch");
  }
  return {
    artifactBytes,
    artifactDigest,
    certificate,
    certificateDigest,
    issues: Object.freeze(issues),
    concurrent: false,
  };
}

function currentProducerAttestations(
  artifact: CompiledArtifactId,
  evidence: OwnerEvidence,
  observed: ObservedPair,
): readonly CompiledArtifactCheckAttestation[] {
  if (
    observed.certificate === undefined
    || observed.certificate.artifact !== artifact
    || observed.artifactBytes === undefined
  ) return [];
  const certificate = observed.certificate;
  const artifactBytes = observed.artifactBytes;
  const retained = !sameProducerCapture(certificate, evidence);
  if (retained && !rawCompiledArtifactInputsEqual(certificate.producerInput, evidence.rawInput)) return [];
  if (!retained && !sameProducerPackage(certificate, evidence, artifactBytes)) return [];
  const toolchain = decodeArtifactToolchainManifest(evidence.toolchainManifestBytes);
  return certificate.producerAttestations.filter((entry) => {
    if (entry.attestationPolicyDigest !== evidence.attestationPolicyDigest) return false;
    if (
      !matchesPinnedBunToolchainRow(entry, toolchain)
    ) return false;
    if (retained) {
      // This is the ACTUAL original producer package hash, committed inside
      // its attested certificate base. Current file rows cannot reconstruct
      // that old archive after an unrelated edit. No producer epoch is retyped.
      return entry.origin.kind === "local"
        && entry.environmentFingerprint === certificate.producerInput.environmentFingerprint
        && entry.environmentFingerprint === evidence.environmentFingerprint
        && entry.checkPackageDigest === certificate.producerCheckPackageDigest;
    }
    const sourceProvenance: CompiledArtifactCheckPackageMetadata["sourceProvenance"] =
      entry.origin.kind === "ci"
        ? {
          kind: "git-object",
          sourceCommit: entry.origin.sourceCommit,
          workflowDigest: entry.origin.workflowDigest,
        }
        : { kind: "stable-live" };
    if (
      sourceProvenance.kind === "git-object"
      && sourceProvenance.workflowDigest !== evidence.workflowDigest
    ) return false;
    const expectedPackage = checkPackageMetadata(
      certificate.artifact,
      evidence,
      artifactBytes,
      sourceProvenance,
      certificate.producerInput,
    );
    return entry.checkPackageDigest === computeCheckPackageDigest(expectedPackage);
  });
}

function matchesPinnedBunToolchainRow(
  entry: CompiledArtifactCheckAttestation,
  toolchain: ArtifactToolchainManifest,
): boolean {
  try {
    const row = selectBunToolchain(toolchain, {
      osFamily: entry.environment.osFamily,
      arch: entry.environment.arch,
    });
    return entry.environment.bun.release === row.bunRelease
      && entry.environment.bun.revision === row.bunRevision
      && entry.environment.bun.executableDigest === row.binarySha256
      && entry.environment.bun.toolchainManifestDigest === toolchain.manifestDigest
      && entry.environment.bun.toolchainRowDigest === bunToolchainRowDigest(row);
  } catch {
    return false;
  }
}

function sidecarIdentityReasons(
  artifact: CompiledArtifactId,
  evidence: OwnerEvidence,
  observed: ObservedPair,
): readonly StaleReason[] {
  const reasons: StaleReason[] = observed.issues.filter((reason): reason is StaleReason =>
    reason !== "artifact-unreadable"
    && reason !== "certificate-unreadable"
    && reason !== "concurrent-mutation");
  const certificate = observed.certificate;
  if (certificate === undefined) return canonicalReasons(reasons.length === 0 ? ["certificate-invalid"] : reasons);
  if (certificate.artifact !== artifact) reasons.push("certificate-artifact-mismatch");
  const sameCapture = sameProducerCapture(certificate, evidence);
  const completeInputEqual = rawCompiledArtifactInputsEqual(certificate.producerInput, evidence.rawInput);
  const currentPolicy = currentProducerAttestations(artifact, evidence, observed);
  const canRetain = !sameCapture && completeInputEqual && currentPolicy.length > 0;
  if (!sameCapture && !canRetain) {
    if (certificate.repositoryEpoch !== evidence.repositoryEpoch) reasons.push("repository-epoch-mismatch");
    if (certificate.ownerEpoch !== evidence.ownerEpoch) reasons.push("owner-epoch-mismatch");
  }
  if (sameCapture ? !sameRawSourceInputs(certificate.producerInput, evidence.rawInput) : !completeInputEqual) {
    reasons.push("complete-input-key-mismatch");
  }
  if (certificate.dependencyDigest !== evidence.dependencyDigest) reasons.push("dependency-digest-mismatch");
  const expectedRepository = summary(evidence.repositoryManifest);
  const expectedOwner = summary(evidence.ownerManifest);
  if (
    (sameCapture && (certificate.inputManifest.repository.digest !== expectedRepository.digest
      || certificate.inputManifest.repository.fileCount !== expectedRepository.fileCount
      || certificate.inputManifest.repository.byteLength !== expectedRepository.byteLength))
    || certificate.inputManifest.ownerOverlay.digest !== expectedOwner.digest
    || certificate.inputManifest.ownerOverlay.fileCount !== expectedOwner.fileCount
    || certificate.inputManifest.ownerOverlay.byteLength !== expectedOwner.byteLength
    || certificate.inputManifest.dependencies.digest !== evidence.dependencyDigest
    || certificate.inputManifest.dependencies.fileCount !== 0
    || certificate.inputManifest.dependencies.byteLength !== 0
  ) reasons.push("certificate-artifact-mismatch");
  if (!canRetain && certificate.inputManifest.coveredSourceArchiveDigest !== evidence.coveredSourceArchiveDigest) {
    reasons.push("certificate-artifact-mismatch");
  }
  if (observed.artifactDigest !== undefined && certificate.artifactDigest !== observed.artifactDigest) {
    reasons.push("certificate-artifact-mismatch");
  }
  if (sameCapture && observed.artifactBytes !== undefined
    && !sameProducerPackage(certificate, evidence, observed.artifactBytes)) reasons.push("certificate-artifact-mismatch");
  if (certificate.producerAttestations.length === 0) reasons.push("producer-attestation-missing");
  else if (currentPolicy.length === 0) reasons.push("producer-policy-mismatch");
  else if (!currentPolicy.some(
    (entry) => entry.environmentFingerprint === evidence.environmentFingerprint,
  )) reasons.push("producer-environment-mismatch");
  return reasons.length === 0 ? [] : canonicalReasons(reasons);
}

function portableSeal(
  artifact: CompiledArtifactId,
  evidence: OwnerEvidence,
  observed: ObservedPair,
): PortableSeal {
  if (
    observed.certificate === undefined
    || observed.certificate.artifact !== artifact
    || observed.artifactDigest === undefined
    || observed.certificate.artifactDigest !== observed.artifactDigest
  ) return "unsealed";
  const current = currentProducerAttestations(artifact, evidence, observed);
  if (!sameProducerCapture(observed.certificate, evidence)) {
    // Historical 3-OS evidence stays historical. Initial cross-epoch retention
    // is deliberately local-only and requires the exact original local proof.
    return current.length > 0 ? "local-only" : "unsealed";
  }
  const superseded = observed.certificate.producerAttestations.filter(
    (entry) => entry.attestationPolicyDigest !== evidence.attestationPolicyDigest,
  );
  return evaluatePortableSeal({
    ...observed.certificate,
    producerAttestations: [...current, ...superseded],
  }, {
    attestationPolicyDigest: evidence.attestationPolicyDigest,
    currentEnvironmentFingerprint: evidence.environmentFingerprint,
    portableProofComputable: true,
  });
}

function freshnessFromEvidence(
  artifact: CompiledArtifactId,
  evidence: OwnerEvidence,
  observed: ObservedPair,
): ArtifactFreshnessRecord {
  const undecidable = observed.issues.filter((reason): reason is UndecidableReason =>
    reason === "artifact-unreadable"
    || reason === "certificate-unreadable"
    || reason === "concurrent-mutation");
  if (undecidable.length !== 0) {
    return validateArtifactFreshnessRecord({
      schema: ARTIFACT_FRESHNESS_SCHEMA,
      artifact,
      verdict: "UNDECIDABLE",
      portableSeal: observed.certificate === undefined ? "unresolved" : portableSeal(artifact, evidence, observed),
      reasons: canonicalReasons(undecidable),
      attestationPolicyDigest: evidence.attestationPolicyDigest,
      repositoryEpoch: evidence.repositoryEpoch,
      ownerEpoch: evidence.ownerEpoch,
      dependencyDigest: evidence.dependencyDigest,
      environmentFingerprint: evidence.environmentFingerprint,
      ...(observed.artifactDigest === undefined ? {} : { artifactDigest: observed.artifactDigest }),
      ...(observed.certificateDigest === undefined ? {} : { certificateDigest: observed.certificateDigest }),
    });
  }
  const reasons = sidecarIdentityReasons(artifact, evidence, observed);
  const seal = portableSeal(artifact, evidence, observed);
  if (
    reasons.length === 0
    && observed.artifactDigest !== undefined
    && observed.certificateDigest !== undefined
    && (seal === "local-only" || seal === "sealed")
  ) {
    return validateArtifactFreshnessRecord({
      schema: ARTIFACT_FRESHNESS_SCHEMA,
      artifact,
      verdict: "FRESH",
      portableSeal: seal,
      attestationPolicyDigest: evidence.attestationPolicyDigest,
      repositoryEpoch: evidence.repositoryEpoch,
      ownerEpoch: evidence.ownerEpoch,
      dependencyDigest: evidence.dependencyDigest,
      environmentFingerprint: evidence.environmentFingerprint,
      artifactDigest: observed.artifactDigest,
      certificateDigest: observed.certificateDigest,
      inputKey: evidence.rawInput.key,
      currentSourceArchiveDigest: evidence.coveredSourceArchiveDigest,
      sourceRelation: sameProducerCapture(observed.certificate!, evidence) ? "same-epoch" : "complete-input-equal",
      producer: {
        repositoryEpoch: observed.certificate!.repositoryEpoch,
        ownerEpoch: observed.certificate!.ownerEpoch,
        coveredSourceArchiveDigest: observed.certificate!.inputManifest.coveredSourceArchiveDigest,
        inputKey: observed.certificate!.producerInput.key,
        environmentFingerprint: observed.certificate!.producerInput.environmentFingerprint,
      },
    });
  }
  return validateArtifactFreshnessRecord({
    schema: ARTIFACT_FRESHNESS_SCHEMA,
    artifact,
    verdict: "STALE",
    portableSeal: seal === "local-only" || seal === "unresolved" ? "unsealed" : seal,
    reasons: canonicalReasons(reasons.length === 0 ? ["producer-attestation-missing"] : reasons),
    attestationPolicyDigest: evidence.attestationPolicyDigest,
    repositoryEpoch: evidence.repositoryEpoch,
    ownerEpoch: evidence.ownerEpoch,
    dependencyDigest: evidence.dependencyDigest,
    environmentFingerprint: evidence.environmentFingerprint,
    ...(observed.artifactDigest === undefined ? {} : { artifactDigest: observed.artifactDigest }),
    ...(observed.certificateDigest === undefined ? {} : { certificateDigest: observed.certificateDigest }),
  });
}

async function probeWithAcquired(
  options: OwnerCommandOptions,
  acquired: AcquiredCompiledArtifactEnvironment,
  initialPolicyDigest: Sha256Hex,
  dependencies: OwnerRuntimeDependencies,
): Promise<{ readonly record: ArtifactFreshnessRecord; readonly evidence?: OwnerEvidence; readonly observed?: ObservedPair }> {
  let first: OwnerEvidence;
  try {
    first = await captureEvidence(options, acquired, dependencies);
  } catch (error) {
    if (process.env["FENEL_OWNER_DIAGNOSE"] === "1") {
      console.error("[owner:diagnose]", options.artifact, error);
    }
    if (error instanceof OwnerEvidenceError) {
      const asPolicy = error.message as PolicyComputationError;
      if (["missing-input", "unreadable-input", "ambiguous-input", "canonicalization-failed"].includes(asPolicy)) {
        return { record: policyNullRecord(options.artifact, asPolicy) };
      }
      return {
        record: undecidableRecord({
          artifact: options.artifact,
          reason: error.reason,
          policyDigest: error.policyDigest ?? initialPolicyDigest,
        }),
      };
    }
    return {
      record: undecidableRecord({
        artifact: options.artifact,
        reason: error instanceof DependencyEvidenceError
          ? "dependency-uncomputable"
          : "owner-uncomputable",
        policyDigest: initialPolicyDigest,
      }),
    };
  }
  const observed = readPair(options.repositoryRoot, options.artifact);
  if (observed.concurrent) {
    return {
      evidence: first,
      observed,
      record: freshnessFromEvidence(options.artifact, first, observed),
    };
  }
  let second: OwnerEvidence;
  try {
    second = await captureEvidence(options, acquired, dependencies);
  } catch (error) {
    if (process.env["FENEL_OWNER_DIAGNOSE"] === "1") {
      console.error("[owner:diagnose]", options.artifact, error);
    }
    return {
      evidence: first,
      observed,
      record: undecidableRecord({
        artifact: options.artifact,
        reason: "concurrent-mutation",
        policyDigest: first.attestationPolicyDigest,
        evidence: first,
      }),
    };
  }
  if (!equivalentEvidence(first, second)) {
    return {
      evidence: first,
      observed,
      record: undecidableRecord({
        artifact: options.artifact,
        reason: "concurrent-mutation",
        policyDigest: first.attestationPolicyDigest,
        evidence: first,
      }),
    };
  }
  return { record: freshnessFromEvidence(options.artifact, first, observed), evidence: first, observed };
}

export async function probeCompiledArtifactOwner(
  options: OwnerCommandOptions,
  dependencies: OwnerRuntimeDependencies = {},
): Promise<ArtifactFreshnessRecord> {
  const initialPolicy = computeAttestationPolicyDigest(options.repositoryRoot);
  if (!initialPolicy.ok) return policyNullRecord(options.artifact, initialPolicy.error);
  try {
    validateCompiledArtifactSourceCensus(options.repositoryRoot);
  } catch (error) {
    if (process.env["FENEL_OWNER_DIAGNOSE"] === "1") {
      console.error("[owner:diagnose]", options.artifact, error);
    }
    return undecidableRecord({
      artifact: options.artifact,
      reason: "owner-uncomputable",
      policyDigest: initialPolicy.digest,
    });
  }
  let acquired: AcquiredCompiledArtifactEnvironment;
  try {
    progress(dependencies, "environment", "acquire pinned toolchain evidence");
    acquired = await acquireEnvironment(options, dependencies);
  } catch (error) {
    if (process.env["FENEL_OWNER_DIAGNOSE"] === "1") {
      console.error("[owner:diagnose]", options.artifact, error);
    }
    return undecidableRecord({
      artifact: options.artifact,
      reason: "environment-uncomputable",
      policyDigest: initialPolicy.digest,
    });
  }
  return (await probeWithAcquired(options, acquired, initialPolicy.digest, dependencies)).record;
}

function candidateNamespace(artifact: CompiledArtifactId, bytes: Uint8Array): CheckPackageNamespace {
  const spec = COMPILED_ARTIFACT_SPECS[artifact];
  return buildCheckPackageNamespace("candidate", [{
    path: spec.artifactPath,
    kind: "file",
    byteLength: bytes.byteLength,
    digest: sha256Bytes(bytes),
  }]);
}

function checkPackageMetadata(
  artifact: CompiledArtifactId,
  evidence: OwnerEvidence,
  candidateBytes: Uint8Array,
  sourceProvenance = evidence.sourceProvenance,
  producerInput = evidence.rawInput,
): CompiledArtifactCheckPackageMetadata {
  return {
    schema: "fenel.compiled-artifact-check-package.v2",
    artifact,
    artifactPath: COMPILED_ARTIFACT_SPECS[artifact].artifactPath,
    portableGenerationAbi: PORTABLE_GENERATION_ABI,
    sourceProvenance,
    repositoryEpoch: evidence.repositoryEpoch,
    ownerEpoch: evidence.ownerEpoch,
    dependencyDigest: evidence.dependencyDigest,
    attestationPolicyDigest: evidence.attestationPolicyDigest,
    producerInput: validateRawCompiledArtifactInput(producerInput, artifact),
    namespaces: {
      candidate: candidateNamespace(artifact, candidateBytes),
      environment: evidence.environmentNamespace,
      source: evidence.sourceNamespace,
    },
  };
}

function certificateBase(
  artifact: CompiledArtifactId,
  evidence: OwnerEvidence,
  artifactBytes: Uint8Array,
  producerInput = evidence.rawInput,
): CompiledArtifactBuildCertificate {
  return makeBaseBuildCertificate({
    artifact,
    repositoryEpoch: evidence.repositoryEpoch,
    ownerEpoch: evidence.ownerEpoch,
    dependencyDigest: evidence.dependencyDigest,
    artifactBytes,
    producerInput,
    producerCheckPackageDigest: computeCheckPackageDigest(checkPackageMetadata(
      artifact, evidence, artifactBytes, { kind: "stable-live" }, producerInput)),
    inputManifest: {
      coveredSourceArchiveDigest: evidence.coveredSourceArchiveDigest,
      repository: summary(evidence.repositoryManifest),
      ownerOverlay: summary(evidence.ownerManifest),
      dependencies: {
        digest: evidence.dependencyDigest,
        fileCount: 0,
        byteLength: 0,
      },
    },
  });
}

async function renderSnapshot(
  options: OwnerCommandOptions,
  evidence: OwnerEvidence,
  dependencies: OwnerRuntimeDependencies,
): Promise<SnapshotWorkerResult> {
  if (dependencies.render !== undefined) return dependencies.render({ options, evidence });
  const snapshot = materializeCompiledArtifactSnapshot({
    repositoryRoot: options.repositoryRoot,
    artifact: options.artifact,
    capturedBytes: evidence.capturedBytes,
    sourcePaths: evidence.sourcePaths,
    dependencyFiles: [{ path: DEPENDENCY_MANIFEST_PATH, bytes: evidence.dependencyManifestBytes }],
  });
  try {
    return await runCompiledArtifactSnapshotWorker({
      snapshot,
      bunExecutable: evidence.bunExecutable,
      ...(dependencies.spawnWorker === undefined ? {} : { spawn: dependencies.spawnWorker }),
    });
  } finally {
    snapshot.cleanup();
  }
}

function makeAttestation(input: {
  readonly options: OwnerCommandOptions;
  readonly evidence: OwnerEvidence;
  readonly certificate: CompiledArtifactBuildCertificate | CompiledArtifactBuildCertificateBase;
  readonly artifactBytes: Uint8Array;
  readonly origin: AttestationOrigin;
}): CompiledArtifactCheckAttestation {
  if (!sameProducerPackage(input.certificate, input.evidence, input.artifactBytes)) {
    throw new Error("producer attestation requires its actual source/package capture; publish a new full baseline before attesting");
  }
  const metadata = checkPackageMetadata(input.options.artifact, input.evidence, input.artifactBytes,
    input.evidence.sourceProvenance, input.certificate.producerInput);
  return parseCompiledArtifactCheckAttestation(encodeCanonicalJson({
    schema: "fenel.compiled-artifact-check-attestation.v2",
    result: "MATCH",
    artifact: input.options.artifact,
    origin: input.origin,
    checkPackageDigest: computeCheckPackageDigest(metadata),
    coveredSourceArchiveDigest: input.evidence.coveredSourceArchiveDigest,
    certificateBaseDigest: computeCertificateBaseDigest(input.certificate),
    repositoryEpoch: input.evidence.repositoryEpoch,
    ownerEpoch: input.evidence.ownerEpoch,
    dependencyDigest: input.evidence.dependencyDigest,
    environment: input.evidence.environment,
    environmentFingerprint: input.evidence.environmentFingerprint,
    artifactByteLength: input.artifactBytes.byteLength,
    artifactDigest: sha256Bytes(input.artifactBytes),
    attestationPolicyDigest: input.evidence.attestationPolicyDigest,
  }));
}

async function assertCurrentEvidence(
  options: OwnerCommandOptions,
  expected: OwnerEvidence,
  acquired: AcquiredCompiledArtifactEnvironment,
  dependencies: OwnerRuntimeDependencies,
): Promise<void> {
  const current = await captureEvidence(options, acquired, dependencies);
  if (!equivalentEvidence(expected, current)) {
    throw new Error(`${options.artifact} repository/owner/environment epoch changed during transaction`);
  }
}

function assertQualifyingAttestation(
  options: OwnerCommandOptions,
  evidence: OwnerEvidence,
  pair: ReturnType<typeof readArtifactPair>,
  attestation: CompiledArtifactCheckAttestation,
): void {
  const expectedPackage = checkPackageMetadata(options.artifact, evidence, pair.artifactBytes);
  if (
    attestation.artifact !== options.artifact
    || attestation.origin.kind !== "local"
    || attestation.checkPackageDigest !== computeCheckPackageDigest(expectedPackage)
    || attestation.coveredSourceArchiveDigest !== evidence.coveredSourceArchiveDigest
    || attestation.certificateBaseDigest !== computeCertificateBaseDigest(pair.certificate)
    || attestation.repositoryEpoch !== evidence.repositoryEpoch
    || attestation.ownerEpoch !== evidence.ownerEpoch
    || attestation.dependencyDigest !== evidence.dependencyDigest
    || attestation.environmentFingerprint !== evidence.environmentFingerprint
    || attestation.artifactByteLength !== pair.artifactBytes.byteLength
    || attestation.artifactDigest !== pair.artifactDigest
    || attestation.attestationPolicyDigest !== evidence.attestationPolicyDigest
  ) throw new Error(`${options.artifact} independent check attestation does not bind the expected tuple`);
}

const INDEPENDENT_CHECK_FIXED_ENVIRONMENT = Object.freeze({
  FENEL_PARSE_CACHE: "0",
  FENEL_PARSER_INTERPRETED: "1",
  FENEL_PARSER_LEGACY: "1",
  FENEL_RESOLVER_INTERPRETED: "1",
  LANG: "C",
  LC_ALL: "C",
  NODE_ENV: "production",
  TZ: "UTC",
});

function inheritedEnvironmentValue(
  inherited: Readonly<Record<string, string | undefined>>,
  canonicalName: string,
): string | undefined {
  const exact = inherited[canonicalName];
  if (exact !== undefined) return exact;
  const folded = canonicalName.toUpperCase();
  const matchingName = Object.keys(inherited).find((name) => name.toUpperCase() === folded);
  return matchingName === undefined ? undefined : inherited[matchingName];
}

/** Closed environment for the fresh public controller. The command is absolute,
 * so PATH, ambient FENEL_* switches, credentials, and CI provenance are not inherited. */
export function compiledArtifactIndependentCheckEnvironment(
  inherited: Readonly<Record<string, string | undefined>> = process.env,
  platform: NodeJS.Platform = process.platform,
): Readonly<Record<string, string>> {
  const environment: Record<string, string> = { ...INDEPENDENT_CHECK_FIXED_ENVIRONMENT };
  if (platform !== "win32") return Object.freeze(environment);

  for (const name of ["COMSPEC", "SYSTEMROOT"] as const) {
    const value = inheritedEnvironmentValue(inherited, name);
    if (value === undefined || value.length === 0) {
      throw new Error(`Windows independent check lacks required ${name}`);
    }
    environment[name] = value;
  }
  environment.WINDIR = inheritedEnvironmentValue(inherited, "WINDIR") ?? environment.SYSTEMROOT!;
  const systemDrive = inheritedEnvironmentValue(inherited, "SYSTEMDRIVE");
  if (systemDrive !== undefined && systemDrive.length !== 0) environment.SYSTEMDRIVE = systemDrive;
  return Object.freeze(environment);
}

async function freshPublicIndependentCheck(
  options: OwnerCommandOptions,
  evidence: OwnerEvidence,
  dependencies: OwnerRuntimeDependencies,
): Promise<CompiledArtifactCheckAttestation> {
  if (dependencies.independentCheck !== undefined) {
    const attestation = await dependencies.independentCheck({ options, evidence });
    assertQualifyingAttestation(
      options,
      evidence,
      readArtifactPair(options.repositoryRoot, options.artifact),
      attestation,
    );
    return attestation;
  }
  const controller = resolve(
    options.repositoryRoot,
    `implementations/typescript/engine/scripts/generate-${options.artifact}.ts`,
  );
  const child = Bun.spawn([
    evidence.bunExecutable,
    "--no-env-file",
    "--no-install",
    controller,
    "--check",
    "--emit-attestation",
  ], {
    cwd: resolve(options.repositoryRoot),
    env: compiledArtifactIndependentCheckEnvironment(),
    stdin: "ignore",
    stdout: "pipe",
    stderr: "pipe",
  });
  const [exitCode, stdout, stderr] = await Promise.all([
    child.exited,
    new Response(child.stdout).bytes(),
    captureWorkerDiagnostics(child.stderr, (line) => progress(dependencies, "independent-check", line)),
  ]);
  if (exitCode !== 0) {
    throw new Error(`${options.artifact} fresh public check exited ${exitCode}: ${new TextDecoder().decode(stderr)}`);
  }
  const attestation = parseCompiledArtifactCheckAttestation(stdout);
  assertQualifyingAttestation(
    options,
    evidence,
    readArtifactPair(options.repositoryRoot, options.artifact),
    attestation,
  );
  return attestation;
}

export async function checkCompiledArtifactOwner(
  options: OwnerCommandOptions,
  dependencies: OwnerRuntimeDependencies = {},
): Promise<OwnerCheckResult> {
  if (options.packagePath !== undefined) {
    const captured = captureCompiledArtifactCheckPackage(options.packagePath, options.artifact);
    const acquired = await acquirePackageEnvironment(options, captured, dependencies);
    const evidence = await packageEvidence(options, captured, acquired, dependencies);
    const rendered = await renderSnapshot(options, evidence, dependencies);
    const matches = Buffer.from(rendered.bytes).equals(Buffer.from(captured.candidateBytes));
    const rebuiltMetadata = checkPackageMetadata(options.artifact, evidence, captured.candidateBytes,
      evidence.sourceProvenance, captured.metadata.producerInput);
    if (computeCheckPackageDigest(rebuiltMetadata) !== computeCheckPackageDigest(captured.metadata)) {
      throw new Error("validated package metadata differs from the owner reconstruction");
    }
    const base = certificateBase(options.artifact, evidence, captured.candidateBytes, captured.metadata.producerInput);
    return Object.freeze({
      matches,
      ...(matches && options.emitAttestation !== false ? {
        attestation: makeAttestation({
          options,
          evidence,
          certificate: base,
          artifactBytes: captured.candidateBytes,
          origin: packageOrigin(captured, dependencies),
        }),
      } : {}),
      renderedDigest: sha256Bytes(rendered.bytes),
      candidateDigest: sha256Bytes(captured.candidateBytes),
      elapsedMs: rendered.elapsedMs,
    });
  }
  validateCompiledArtifactSourceCensus(options.repositoryRoot);
  const acquired = await acquireEnvironment(options, dependencies);
  const evidence = await captureEvidence(options, acquired, dependencies);
  const observed = readArtifactPair(options.repositoryRoot, options.artifact);
  const rendered = await renderSnapshot(options, evidence, dependencies);
  await assertCurrentEvidence(options, evidence, acquired, dependencies);
  const matches = Buffer.from(rendered.bytes).equals(Buffer.from(observed.artifactBytes));
  if (matches && options.emitAttestation !== false && !sameProducerCapture(observed.certificate, evidence)) {
    throw new Error("emitting a producer attestation requires its actual source capture; repair a new baseline before sealing current inputs");
  }
  return Object.freeze({
    matches,
    ...(matches && options.emitAttestation !== false ? {
      attestation: makeAttestation({
        options,
        evidence,
        certificate: observed.certificate,
        artifactBytes: observed.artifactBytes,
        origin: dependencies.origin ?? { kind: "local" },
      }),
    } : {}),
    renderedDigest: sha256Bytes(rendered.bytes),
    candidateDigest: observed.artifactDigest,
    elapsedMs: rendered.elapsedMs,
  });
}

function writerNeeded(record: ArtifactFreshnessRecord): boolean {
  if (record.verdict !== "STALE") return false;
  return record.reasons.some((reason) => [
    "complete-input-key-mismatch",
    "artifact-digest-mismatch",
    "artifact-invalid-eol",
    "artifact-length-mismatch",
    "artifact-missing",
    "certificate-artifact-mismatch",
    "certificate-invalid",
    "certificate-missing",
    "dependency-digest-mismatch",
    "owner-epoch-mismatch",
    "repository-epoch-mismatch",
  ].includes(reason));
}

function trace(
  artifact: CompiledArtifactId,
  branch: OwnerRepairBranch,
  renders: number,
  publications: number,
  merges: number,
  probes: number,
): OwnerTransactionTrace {
  return Object.freeze({
    schema: OWNER_TRACE_SCHEMA,
    artifact,
    branch,
    renders,
    artifactPublications: publications,
    attestationMerges: merges,
    postProbes: probes,
  });
}

export async function repairCompiledArtifactOwner(
  options: OwnerCommandOptions,
  dependencies: OwnerRuntimeDependencies = {},
): Promise<OwnerRepairResult> {
  validateCompiledArtifactSourceCensus(options.repositoryRoot);
  const initialPolicy = computeAttestationPolicyDigest(options.repositoryRoot);
  if (!initialPolicy.ok) throw new Error(`attestation policy is uncomputable: ${initialPolicy.error}`);
  const acquired = await acquireEnvironment(options, dependencies);
  const before = await probeWithAcquired(options, acquired, initialPolicy.digest, dependencies);
  if (before.record.verdict === "FRESH") {
    return { record: before.record, trace: trace(options.artifact, "compare-first-equal", 0, 0, 0, 0) };
  }
  if (before.record.verdict === "UNDECIDABLE" || before.evidence === undefined) {
    throw new Error(`${options.artifact} repair input is uncomputable: ${before.record.reasons.join(",")}`);
  }
  const evidence = before.evidence;
  const observed = before.observed;
  const hasCurrentProducerPackage = observed?.certificate !== undefined && observed.artifactBytes !== undefined
    && sameProducerPackage(observed.certificate, evidence, observed.artifactBytes);
  const needsWriter = writerNeeded(before.record) || !hasCurrentProducerPackage;
  let renders = 0;
  let publications = 0;
  let branch: OwnerRepairBranch = needsWriter ? "writer-needed" : "compare-first-equal";
  let qualifyingAttestation: CompiledArtifactCheckAttestation;

  progress(dependencies, "render", needsWriter ? "writer candidate" : "compare-first candidate");
  const candidate = await renderSnapshot(options, evidence, dependencies);
  renders += 1;
  await assertCurrentEvidence(options, evidence, acquired, dependencies);
  const existingMatches = observed?.artifactBytes !== undefined
    && Buffer.from(candidate.bytes).equals(Buffer.from(observed.artifactBytes));

  if (!needsWriter && existingMatches && observed?.certificate !== undefined
    && sameProducerPackage(observed.certificate, evidence, observed.artifactBytes!)) {
    qualifyingAttestation = makeAttestation({
      options,
      evidence,
      certificate: observed.certificate,
      artifactBytes: observed.artifactBytes!,
      origin: dependencies.origin ?? { kind: "local" },
    });
    branch = "compare-first-equal";
  } else {
    branch = needsWriter ? "writer-needed" : "compare-first-different";
    const base = certificateBase(options.artifact, evidence, candidate.bytes);
    await publishArtifactAndBaseCertificate({
      repositoryRoot: options.repositoryRoot,
      artifact: options.artifact,
      artifactBytes: candidate.bytes,
      certificate: base,
      assertEpoch: () => assertCurrentEvidence(options, evidence, acquired, dependencies),
    });
    publications += 1;
    progress(dependencies, "render", "fresh-process public post-publication check");
    qualifyingAttestation = await freshPublicIndependentCheck(options, evidence, dependencies);
    renders += 1;
    await assertCurrentEvidence(options, evidence, acquired, dependencies);
    const published = readArtifactPair(options.repositoryRoot, options.artifact);
    if (!Buffer.from(published.artifactBytes).equals(Buffer.from(candidate.bytes))) {
      throw new Error(`${options.artifact} published bytes changed before attestation`);
    }
  }

  await mergeArtifactAttestations({
    repositoryRoot: options.repositoryRoot,
    artifact: options.artifact,
    attestations: [qualifyingAttestation],
    assertEpoch: () => assertCurrentEvidence(options, evidence, acquired, dependencies),
  });
  const post = await probeWithAcquired(options, acquired, initialPolicy.digest, dependencies);
  if (post.record.verdict !== "FRESH") {
    throw new Error(`${options.artifact} post-repair probe is ${post.record.verdict}`);
  }
  return {
    record: post.record,
    trace: trace(options.artifact, branch, renders, publications, 1, 1),
  };
}

export async function mergeCompiledArtifactOwnerAttestations(
  options: OwnerCommandOptions,
  attestationFiles: readonly string[],
  dependencies: OwnerRuntimeDependencies = {},
): Promise<void> {
  if (attestationFiles.length !== 3) {
    throw new Error("portable merge-attestations requires exactly three CI files");
  }
  validateCompiledArtifactSourceCensus(options.repositoryRoot);
  const acquired = await acquireEnvironment(options, dependencies);
  const evidence = await captureEvidence(options, acquired, dependencies);
  const attestations = canonicalizeProducerAttestations(attestationFiles.map((path) =>
    parseCompiledArtifactCheckAttestation(new Uint8Array(readFileSync(path)))));
  if (attestations.some((entry) => entry.origin.kind !== "ci")) {
    throw new Error("portable seal finalization accepts CI attestations only");
  }
  const first = attestations[0]!;
  if (first.origin.kind !== "ci") throw new Error("portable seal lacks a CI origin");
  const prepared = (dependencies.prepareCheckPackage ?? prepareCompiledArtifactCheckPackage)({
    repositoryRoot: options.repositoryRoot,
    sourceCommit: first.origin.sourceCommit,
    artifact: options.artifact,
    output: `.tmp-m3b-finalizer/${options.artifact}-${first.origin.sourceCommit}`,
    materialize: false,
  });
  const raw = prepared.metadata;
  if (raw.sourceProvenance.kind !== "git-object") {
    throw new Error("raw Git reconstruction did not produce Git-object provenance");
  }
  if (
    raw.repositoryEpoch !== evidence.repositoryEpoch
    || raw.ownerEpoch !== evidence.ownerEpoch
    || raw.dependencyDigest !== evidence.dependencyDigest
    || raw.attestationPolicyDigest !== evidence.attestationPolicyDigest
    || raw.sourceProvenance.workflowDigest !== evidence.workflowDigest
    || raw.namespaces.source.digest !== evidence.sourceNamespace.digest
    || raw.namespaces.environment.digest !== evidence.environmentNamespace.digest
  ) {
    throw new Error("raw Git package does not equal the current stable owner evidence");
  }
  const current = readArtifactPair(options.repositoryRoot, options.artifact);
  if (current.artifactDigest !== raw.namespaces.candidate.files[0]!.digest) {
    throw new Error("raw Git candidate does not equal the current compiled artifact");
  }
  const packageDigest = computeCheckPackageDigest(raw);
  const baseDigest = computeCertificateBaseDigest(current.certificate);
  const osFamilies = new Set<string>();
  const toolchain = decodeArtifactToolchainManifest(evidence.toolchainManifestBytes);
  const group = [
    first.origin.sourceCommit,
    first.origin.workflowDigest,
    first.origin.workflowRunId,
    String(first.origin.workflowRunAttempt),
  ].join("\0");
  for (const entry of attestations) {
    if (entry.origin.kind !== "ci") throw new Error("portable seal contains a non-CI origin");
    const entryGroup = [
      entry.origin.sourceCommit,
      entry.origin.workflowDigest,
      entry.origin.workflowRunId,
      String(entry.origin.workflowRunAttempt),
    ].join("\0");
    if (entryGroup !== group) throw new Error("portable seal attestations come from mixed workflow runs");
    if (
      entry.origin.sourceCommit !== raw.sourceProvenance.sourceCommit
      || entry.origin.workflowDigest !== raw.sourceProvenance.workflowDigest
      || entry.checkPackageDigest !== packageDigest
      || entry.attestationPolicyDigest !== evidence.attestationPolicyDigest
      || entry.certificateBaseDigest !== baseDigest
      || entry.coveredSourceArchiveDigest !== evidence.coveredSourceArchiveDigest
      || entry.repositoryEpoch !== evidence.repositoryEpoch
      || entry.ownerEpoch !== evidence.ownerEpoch
      || entry.dependencyDigest !== evidence.dependencyDigest
      || entry.artifact !== options.artifact
      || entry.artifactByteLength !== current.artifactBytes.byteLength
      || entry.artifactDigest !== current.artifactDigest
    ) throw new Error("portable seal attestation does not bind the current Git/package/base tuple");
    if (osFamilies.has(entry.environment.osFamily)) {
      throw new Error(`portable seal repeats OS family ${entry.environment.osFamily}`);
    }
    osFamilies.add(entry.environment.osFamily);
    if (
      !matchesPinnedBunToolchainRow(entry, toolchain)
    ) throw new Error("portable seal environment does not match the packaged toolchain contract");
  }
  if (["windows", "linux", "macos"].some((family) => !osFamilies.has(family))) {
    throw new Error("portable seal must contain Windows, Linux, and macOS attestations");
  }
  await replaceArtifactAttestations({
    repositoryRoot: options.repositoryRoot,
    artifact: options.artifact,
    attestations,
    assertEpoch: () => assertCurrentEvidence(options, evidence, acquired, dependencies),
  });
  const post = await probeWithAcquired(
    options,
    acquired,
    evidence.attestationPolicyDigest,
    dependencies,
  );
  if (post.record.verdict !== "FRESH" || post.record.portableSeal !== "sealed") {
    throw new Error(`${options.artifact} portable seal post-probe did not become FRESH/sealed`);
  }
}

export function ownerProbeExitCode(record: ArtifactFreshnessRecord): number {
  return OWNER_PROBE_EXIT_CODES[record.verdict];
}

export function encodeOwnerRecord(record: ArtifactFreshnessRecord): Uint8Array {
  return encodeCanonicalJson(validateArtifactFreshnessRecord(record));
}

export interface OwnerCliIo {
  readonly stdout: (bytes: Uint8Array) => void;
  readonly stderr: (line: string) => void;
}

const defaultCliIo: OwnerCliIo = {
  stdout(bytes): void {
    process.stdout.write(bytes);
  },
  stderr(line): void {
    process.stderr.write(`${line}\n`);
  },
};

type ParsedOwnerCli =
  | { readonly mode: "probe"; readonly expectedRepositoryEpoch?: Sha256Hex }
  | { readonly mode: "repair"; readonly expectedRepositoryEpoch?: Sha256Hex }
  | {
    readonly mode: "check";
    readonly emitAttestation: boolean;
    readonly packagePath?: string;
  }
  | { readonly mode: "merge"; readonly files: readonly string[] };

function parseOwnerCli(args: readonly string[]): ParsedOwnerCli {
  if (args.length === 0) return { mode: "repair" };
  if (args[0] === "--probe") {
    if (args.length === 1) return { mode: "probe" };
    if (args.length === 2 && args[1]!.startsWith("--expected-repository-epoch=")) {
      const raw = args[1]!.slice("--expected-repository-epoch=".length);
      if (!/^[0-9a-f]{64}$/u.test(raw)) {
        throw new TypeError("expected repository epoch must be lowercase 64-hex");
      }
      return { mode: "probe", expectedRepositoryEpoch: raw as Sha256Hex };
    }
    throw new TypeError("--probe accepts at most one --expected-repository-epoch=<hex>");
  }
  if (args[0] === "--check") {
    let emitAttestation = false;
    let packagePath: string | undefined;
    for (const arg of args.slice(1)) {
      if (arg === "--emit-attestation" && !emitAttestation) {
        emitAttestation = true;
      } else if (arg.startsWith("--package=") && packagePath === undefined) {
        packagePath = arg.slice("--package=".length);
        if (packagePath.length === 0) throw new TypeError("--package path must not be empty");
      } else {
        throw new TypeError("--check accepts at most one --package=<path> and --emit-attestation");
      }
    }
    return {
      mode: "check",
      emitAttestation,
      ...(packagePath === undefined ? {} : { packagePath }),
    };
  }
  if (args[0] === "--merge-attestations") {
    if (args.length < 2 || args.slice(1).some((arg) => arg.startsWith("--"))) {
      throw new TypeError("--merge-attestations requires one or more file paths");
    }
    return { mode: "merge", files: Object.freeze(args.slice(1)) };
  }
  const repairArgs = args[0] === "--repair" ? args.slice(1) : args;
  if (repairArgs.length === 0 && args[0] === "--repair") return { mode: "repair" };
  if (repairArgs.length === 1 && repairArgs[0]!.startsWith("--expected-repository-epoch=")) {
    const raw = repairArgs[0]!.slice("--expected-repository-epoch=".length);
    if (!/^[0-9a-f]{64}$/u.test(raw)) throw new TypeError("expected repository epoch must be lowercase 64-hex");
    return { mode: "repair", expectedRepositoryEpoch: raw as Sha256Hex };
  }
  throw new TypeError("unknown or conflicting compiled-artifact owner arguments");
}

export async function runCompiledArtifactOwnerCli(input: {
  readonly artifact: CompiledArtifactId;
  readonly repositoryRoot: string;
  readonly args: readonly string[];
  readonly io?: OwnerCliIo;
  readonly dependencies?: OwnerRuntimeDependencies;
}): Promise<number> {
  const io = input.io ?? defaultCliIo;
  let parsed: ParsedOwnerCli;
  try {
    parsed = parseOwnerCli(input.args);
  } catch (error) {
    io.stderr(`[${input.artifact}] ${error instanceof Error ? error.message : String(error)}`);
    return 2;
  }
  const dependencies: OwnerRuntimeDependencies = {
    ...input.dependencies,
    progress: input.dependencies?.progress ?? ((stage, detail = "") => {
      io.stderr(`[${input.artifact}] ${stage}${detail === "" ? "" : `: ${detail}`}`);
    }),
  };
  const options: OwnerCommandOptions = {
    repositoryRoot: input.repositoryRoot,
    artifact: input.artifact,
    allowNetwork: true,
    ...((parsed.mode === "repair" || parsed.mode === "probe")
      && parsed.expectedRepositoryEpoch !== undefined
      ? { expectedRepositoryEpoch: parsed.expectedRepositoryEpoch }
      : {}),
    ...(parsed.mode === "check" ? {
      emitAttestation: parsed.emitAttestation,
      ...(parsed.packagePath === undefined ? {} : { packagePath: parsed.packagePath }),
    } : {}),
  };
  try {
    if (parsed.mode === "probe") {
      const record = await probeCompiledArtifactOwner(options, dependencies);
      io.stdout(encodeOwnerRecord(record));
      return ownerProbeExitCode(record);
    }
    if (parsed.mode === "check") {
      const checked = await checkCompiledArtifactOwner(options, dependencies);
      io.stderr(
        `[${input.artifact}] check ${checked.matches ? "MATCH" : "MISMATCH"} `
        + `(render ${checked.renderedDigest}, candidate ${checked.candidateDigest}, ${checked.elapsedMs.toFixed(0)} ms)`,
      );
      if (parsed.emitAttestation && checked.attestation !== undefined) {
        io.stdout(encodeCanonicalJson(checked.attestation));
      }
      return checked.matches ? 0 : 1;
    }
    if (parsed.mode === "merge") {
      await mergeCompiledArtifactOwnerAttestations(options, parsed.files, dependencies);
      io.stderr(`[${input.artifact}] merged ${parsed.files.length} verified attestation file(s)`);
      return 0;
    }
    const repaired = await repairCompiledArtifactOwner(options, dependencies);
    io.stderr(`[${input.artifact}] ${JSON.stringify(repaired.trace)}`);
    io.stdout(encodeOwnerRecord(repaired.record));
    return 0;
  } catch (error) {
    io.stderr(`[${input.artifact}] ${error instanceof Error ? error.stack ?? error.message : String(error)}`);
    return 1;
  }
}
