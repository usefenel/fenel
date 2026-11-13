/**
 * Import-inert, serial coordinator for the identity-artifact transaction.
 *
 * The phase declaration below is the schedule. Production owner operations
 * always cross a fresh-process boundary; dependency injection exists only so
 * trace tests can replace expensive writers and stable captures.
 */

import { spawn } from "node:child_process";
import { dirname, resolve } from "node:path";
import { performance } from "node:perf_hooks";
import { fileURLToPath } from "node:url";
import {
  captureStableEpoch,
  computeOwnerEpoch,
  parseSha256Hex,
  repositoryRelativePath,
  sha256Raw,
  type ByteManifest,
} from "./lib/artifact-bytes";
import {
  encodeCanonicalJson,
} from "./lib/artifact-wire-json";
import {
  ATTESTATION_POLICY_PATHS,
  ownerOverlaySources,
} from "./lib/compiled-artifact-source-census";
import { acquireCompiledArtifactEnvironment } from "./lib/compiled-artifact-environment";
import {
  COMPILED_ARTIFACT_SPECS,
  OWNER_PROTOCOL,
  PORTABLE_GENERATION_ABI,
  decodeOwnerProbe,
  validateAndDigestCertificateBytes,
  type ArtifactFreshnessRecord,
  type FreshArtifactRecord,
} from "./lib/compiled-artifact-protocol";
import { RECOVERY_STUB_VERSION } from "./lib/compiled-artifact-certificate";
import type {
  CompiledArtifactCheckAttestation,
  CompiledArtifactId,
  Sha256Hex,
} from "./lib/compiled-artifact-attestation";
import {
  CURRENT_SELF_HOST_MATRIX_MODE,
  encodeMatrixControllerReceipt,
  parseMatrixControllerReceipt,
  type MatrixResult,
} from "./lib/self-host-matrix-certificate";
import { captureCurrentMatrixLeg } from "./self-host-matrix-controller";

const SCRIPT_DIR = dirname(fileURLToPath(import.meta.url));
const DEFAULT_REPOSITORY_ROOT = resolve(SCRIPT_DIR, "../../../..");

const USAGE = [
  "usage: bun implementations/typescript/engine/scripts/generate-identity-artifacts.ts [flags]",
  "",
  "  --with-matrix                              require the selected matrix operation to succeed",
  "  --no-matrix                                explicitly skip matrix regeneration (advisory)",
  "  --adopt-matrix-environment=<64-hex>         required-v1 only; requires --with-matrix",
].join("\n");

function immutablePhaseDeclaration<const T extends readonly {
  readonly name: string;
  readonly mandatory: boolean;
}[]>(phases: T): T {
  for (const phase of phases) Object.freeze(phase);
  return Object.freeze(phases);
}

export const IDENTITY_ARTIFACT_PHASE_DECLARATION = immutablePhaseDeclaration([
  { name: "parser-bootstrap-preflight", mandatory: true },
  { name: "parser-bootstrap", mandatory: true },
  { name: "parser-bootstrap-check", mandatory: true },
  { name: "resolver-acquisition-preflight", mandatory: true },
  { name: "parser-acquisition-preflight", mandatory: true },
  { name: "codename-lock", mandatory: true },
  { name: "repository-field-catalog", mandatory: true },
  { name: "repository-epoch", mandatory: true },
  { name: "compiled-resolver", mandatory: true },
  { name: "compiled-parser", mandatory: true },
  { name: "parse-cache", mandatory: true },
  { name: "signature-honesty-claims", mandatory: true },
  { name: "self-host-matrix", mandatory: false },
  { name: "final-envelope-a", mandatory: true },
  { name: "final-resolver-probe", mandatory: true },
  { name: "final-parser-probe", mandatory: true },
  { name: "final-envelope-b", mandatory: true },
  { name: "final-attestation", mandatory: true },
] as const);

export type IdentityArtifactPhaseName =
  (typeof IDENTITY_ARTIFACT_PHASE_DECLARATION)[number]["name"];
export type IdentityArtifactPhaseStatus = "ok" | "failed" | "skipped";

export type IdentityArtifactPhaseRecord = {
  readonly name: IdentityArtifactPhaseName;
  readonly status: IdentityArtifactPhaseStatus;
  readonly ms: number;
  readonly detail?: string;
};

export type IdentityArtifactDriverOptions = {
  readonly repositoryRoot: string;
  readonly matrix: "automatic" | "with" | "without";
  readonly adoptMatrixEnvironment?: Sha256Hex;
};

export type FreshChildRequest = {
  readonly phase: IdentityArtifactPhaseName;
  readonly repositoryRoot: string;
  readonly script: string;
  readonly args: readonly string[];
  readonly captureStdout: boolean;
  /** Existing owner diagnostics use stderr; the closed verdict wire stays unchanged. */
  readonly diagnoseOwner?: true;
};

export type FreshChildResult = {
  readonly exitCode: number | null;
  readonly stdout: Uint8Array;
  readonly error?: string;
};

export type CodenameLockDriverResult = {
  readonly minted: readonly { readonly name: string; readonly kind: string }[];
  readonly requiredCount?: number;
  readonly physicalCount?: number;
  readonly digest?: string;
  /** Opaque in the coordinator; only the field-catalog adapter receives it. */
  readonly state?: unknown;
};

export type MatrixDecisionReceipt = {
  readonly bytes: Uint8Array;
  readonly exitCode: number;
};

export type PortableCiRun = {
  readonly sourceCommit: string;
  readonly workflowDigest: string;
  readonly workflowRunId: string;
  readonly workflowRunAttempt: number;
};

export type PortableCiAttestationCoordinate = PortableCiRun & {
  readonly osFamily: "windows" | "linux" | "macos";
};

export type IdentityArtifactFinalEnvelope = {
  readonly schema: "fenel.identity-artifact-final-envelope.v1";
  readonly digest: Sha256Hex;
  /** Present only when both owners are sealed by one exact 3+3 CI run. */
  readonly portableCiRun: PortableCiRun | null;
};

export type IdentityArtifactDriverDependencies = {
  readonly runFreshChild?: (request: FreshChildRequest) => Promise<FreshChildResult>;
  readonly bootstrapPreflight?: (repositoryRoot: string) => Promise<{
    readonly ok: boolean;
    readonly warnings: readonly string[];
    readonly refusals: readonly string[];
  }>;
  readonly runCodenameLock?: () => Promise<CodenameLockDriverResult>;
  readonly runFieldCatalog?: (lock: CodenameLockDriverResult) => Promise<string | undefined>;
  readonly captureRepositoryEpoch?: (repositoryRoot: string) => Promise<Sha256Hex>;
  readonly captureFinalEnvelope?: (input: {
    readonly repositoryRoot: string;
    readonly retainedOwners: Readonly<Record<CompiledArtifactId, FreshArtifactRecord>>;
    readonly matrixReceipt: Uint8Array;
  }) => Promise<IdentityArtifactFinalEnvelope>;
  readonly now?: () => number;
  readonly stdout?: (line: string) => void;
  readonly stderr?: (line: string) => void;
};

export type IdentityArtifactDriverResult = {
  readonly ok: boolean;
  readonly phases: readonly IdentityArtifactPhaseRecord[];
  readonly retainedOwners: Readonly<Partial<Record<CompiledArtifactId, FreshArtifactRecord>>>;
  readonly repositoryEpoch?: Sha256Hex;
  readonly notRegenerated: readonly string[];
};

type PhaseOutcome = {
  readonly status?: "ok" | "skipped";
  readonly detail?: string;
};

type MutableDriverState = {
  lock?: CodenameLockDriverResult;
  repositoryEpoch?: Sha256Hex;
  matrixReceipt?: Uint8Array;
  envelopeA?: IdentityArtifactFinalEnvelope;
  envelopeB?: IdentityArtifactFinalEnvelope;
  finalResolver?: FreshArtifactRecord;
  finalParser?: FreshArtifactRecord;
  readonly owners: Partial<Record<CompiledArtifactId, FreshArtifactRecord>>;
  readonly notRegenerated: string[];
};

const message = (error: unknown): string =>
  error instanceof Error ? error.message : String(error);

function assertSha256(value: string, label: string): asserts value is Sha256Hex {
  if (!/^[0-9a-f]{64}$/u.test(value)) throw new Error(`${label} must be lowercase 64-hex`);
}

function formatDuration(ms: number): string {
  if (ms < 1000) return `${Math.round(ms)}ms`;
  const seconds = Math.round(ms / 1000);
  const minutes = Math.floor(seconds / 60);
  return minutes === 0
    ? `${seconds}s`
    : `${minutes}m ${String(seconds % 60).padStart(2, "0")}s`;
}

function samePortableRun(left: PortableCiRun, right: PortableCiRun): boolean {
  return left.sourceCommit === right.sourceCommit
    && left.workflowDigest === right.workflowDigest
    && left.workflowRunId === right.workflowRunId
    && left.workflowRunAttempt === right.workflowRunAttempt;
}

function sameOptionalPortableRun(
  left: PortableCiRun | null,
  right: PortableCiRun | null,
): boolean {
  return left === null || right === null ? left === right : samePortableRun(left, right);
}

function portableRunForOwner(
  artifact: CompiledArtifactId,
  entries: readonly PortableCiAttestationCoordinate[],
): PortableCiRun {
  if (entries.length !== 3) {
    throw new Error(`${artifact} portable seal must contain exactly three CI attestations`);
  }
  const families = new Set(entries.map((entry) => entry.osFamily));
  if (
    families.size !== 3
    || !families.has("windows")
    || !families.has("linux")
    || !families.has("macos")
  ) {
    throw new Error(`${artifact} portable seal must contain Windows, Linux, and macOS exactly once`);
  }
  const first = entries[0]!;
  const run: PortableCiRun = {
    sourceCommit: first.sourceCommit,
    workflowDigest: first.workflowDigest,
    workflowRunId: first.workflowRunId,
    workflowRunAttempt: first.workflowRunAttempt,
  };
  if (entries.some((entry) => !samePortableRun(run, entry))) {
    throw new Error(`${artifact} portable seal contains mixed workflow runs`);
  }
  return Object.freeze(run);
}

/** The six CI attestations are one coordinator claim, not two independent runs. */
export function assertCrossOwnerSealedCiRuns(input: {
  readonly "compiled-resolver": readonly PortableCiAttestationCoordinate[];
  readonly "compiled-parser": readonly PortableCiAttestationCoordinate[];
}): PortableCiRun {
  const resolver = portableRunForOwner("compiled-resolver", input["compiled-resolver"]);
  const parser = portableRunForOwner("compiled-parser", input["compiled-parser"]);
  if (!samePortableRun(resolver, parser)) {
    throw new Error("resolver and parser portable seals come from different workflow runs");
  }
  return resolver;
}

function childEnvironment(): NodeJS.ProcessEnv {
  return { ...process.env, FENEL_PARSER_LEGACY: "1" };
}

async function defaultRunFreshChild(request: FreshChildRequest): Promise<FreshChildResult> {
  return new Promise<FreshChildResult>((settle) => {
    const chunks: Uint8Array[] = [];
    let settled = false;
    const child = spawn(
      process.execPath,
      [resolve(SCRIPT_DIR, request.script), ...request.args],
      {
        cwd: request.repositoryRoot,
        env: {
          ...childEnvironment(),
          ...(request.diagnoseOwner ? { FENEL_OWNER_DIAGNOSE: "1" } : {}),
        },
        stdio: ["ignore", request.captureStdout ? "pipe" : "inherit", "inherit"],
      },
    );
    if (request.captureStdout) {
      child.stdout?.on("data", (chunk: Uint8Array) => {
        const bytes = Uint8Array.from(chunk);
        chunks.push(bytes);
        process.stdout.write(bytes);
      });
    }
    child.on("error", (error) => {
      if (settled) return;
      settled = true;
      settle({ exitCode: null, stdout: concatenate(chunks), error: message(error) });
    });
    child.on("close", (exitCode) => {
      if (settled) return;
      settled = true;
      settle({ exitCode, stdout: concatenate(chunks) });
    });
  });
}

function concatenate(chunks: readonly Uint8Array[]): Uint8Array {
  const byteLength = chunks.reduce((total, chunk) => total + chunk.byteLength, 0);
  const result = new Uint8Array(byteLength);
  let offset = 0;
  for (const chunk of chunks) {
    result.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return result;
}

async function defaultBootstrapPreflight(repositoryRoot: string): Promise<{
  readonly ok: boolean;
  readonly warnings: readonly string[];
  readonly refusals: readonly string[];
}> {
  // The preflight reads the OLD bootstrap module. Keep that module cache in a
  // child: this coordinator later loads the engine for identity collection,
  // and must see the fresh artifact written by the intervening bootstrap step.
  const child = await defaultRunFreshChild({
    phase: "parser-bootstrap-preflight", repositoryRoot,
    script: "generate-parser-bootstrap.ts", args: ["--preflight"], captureStdout: true,
  });
  if (child.error) throw new Error(child.error);
  const result: unknown = JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(child.stdout));
  if (result === null || typeof result !== "object"
    || typeof (result as { ok?: unknown }).ok !== "boolean"
    || !Array.isArray((result as { warnings?: unknown }).warnings)
    || !Array.isArray((result as { refusals?: unknown }).refusals)) {
    throw new Error("Malformed bootstrap preflight receipt");
  }
  const receipt = result as { ok: boolean; warnings: unknown[]; refusals: unknown[] };
  if ([...receipt.warnings, ...receipt.refusals].some((entry) => typeof entry !== "string")
    || child.exitCode !== (receipt.ok ? 0 : 1)
    || receipt.ok !== (receipt.refusals.length === 0)) {
    throw new Error("Bootstrap preflight receipt/exit disagreement");
  }
  return { ok: receipt.ok, warnings: receipt.warnings as string[], refusals: receipt.refusals as string[] };
}

// Codename-lock and the field catalog run in ONE fresh child
// (`run-identity-lock-and-catalog.ts`): in-process they left the coordinator
// holding their strict registries, about 3 GB, through the owner renders. The
// child does the same work in the same order and inherits this process's
// environment unchanged. The catalog's result rides the lock receipt, so the
// field-catalog phase reports what the child already wrote.
async function defaultRunCodenameLock(): Promise<CodenameLockDriverResult> {
  const chunks: Uint8Array[] = [];
  const exitCode = await new Promise<number | null>((settle, fail) => {
    const child = spawn(process.execPath, [resolve(SCRIPT_DIR, "run-identity-lock-and-catalog.ts")], {
      cwd: process.cwd(),
      env: process.env,
      stdio: ["ignore", "pipe", "inherit"],
    });
    child.stdout?.on("data", (chunk: Uint8Array) => {
      const bytes = Uint8Array.from(chunk);
      chunks.push(bytes);
      process.stdout.write(bytes);
    });
    child.on("error", fail);
    child.on("close", settle);
  });
  if (exitCode !== 0) throw new Error(`codename lock and field catalog child exited ${exitCode}`);
  const lines = new TextDecoder().decode(concatenate(chunks)).split(/\r?\n/).filter((line) => line.trim() !== "");
  const receipt = JSON.parse(lines[lines.length - 1] ?? "null") as {
    minted: { name: string; kind: string }[];
    requiredCount?: number;
    physicalCount?: number;
    digest?: string;
    catalog: string;
  } | null;
  if (!receipt || !Array.isArray(receipt.minted) || typeof receipt.catalog !== "string") {
    throw new Error("codename lock and field catalog child printed no receipt");
  }
  return {
    minted: Object.freeze(receipt.minted.map((row) => Object.freeze({ ...row }))),
    requiredCount: receipt.requiredCount,
    physicalCount: receipt.physicalCount,
    digest: receipt.digest,
    state: { catalog: receipt.catalog },
  };
}

async function defaultRunFieldCatalog(lock: CodenameLockDriverResult): Promise<string> {
  const catalog = (lock.state as { catalog?: unknown } | undefined)?.catalog;
  if (typeof catalog !== "string") throw new Error("field catalog lacks the codename-lock receipt");
  return catalog;
}

async function defaultCaptureRepositoryEpoch(repositoryRoot: string): Promise<Sha256Hex> {
  const captured = await captureStableEpoch({ repositoryRoot });
  if (!captured.ok) throw new Error(`repository epoch capture failed: ${captured.issue.code}`);
  return captured.value.repositoryEpoch as Sha256Hex;
}

function summary(manifest: ByteManifest): {
  readonly domain: string;
  readonly digest: string;
  readonly fileCount: number;
  readonly byteLength: number;
} {
  return {
    domain: manifest.domain,
    digest: manifest.digest,
    fileCount: manifest.fileCount,
    byteLength: manifest.byteLength,
  };
}

function identityTuple(record: FreshArtifactRecord): Record<string, string> {
  return {
    artifactDigest: record.artifactDigest,
    attestationPolicyDigest: record.attestationPolicyDigest,
    certificateDigest: record.certificateDigest,
    dependencyDigest: record.dependencyDigest,
    environmentFingerprint: record.environmentFingerprint,
    ownerEpoch: record.ownerEpoch,
    repositoryEpoch: record.repositoryEpoch,
    inputKey: record.inputKey,
    currentSourceArchiveDigest: record.currentSourceArchiveDigest,
    sourceRelation: record.sourceRelation,
    producerRepositoryEpoch: record.producer.repositoryEpoch,
    producerOwnerEpoch: record.producer.ownerEpoch,
    producerSourceArchiveDigest: record.producer.coveredSourceArchiveDigest,
    producerInputKey: record.producer.inputKey,
    producerEnvironmentFingerprint: record.producer.environmentFingerprint,
  };
}

function coordinates(
  entries: readonly CompiledArtifactCheckAttestation[],
): readonly PortableCiAttestationCoordinate[] {
  return Object.freeze(entries.map((entry) => {
    if (entry.origin.kind !== "ci") throw new Error("portable seal contains a non-CI attestation");
    return Object.freeze({
      osFamily: entry.environment.osFamily,
      sourceCommit: entry.origin.sourceCommit,
      workflowDigest: entry.origin.workflowDigest,
      workflowRunId: entry.origin.workflowRunId,
      workflowRunAttempt: entry.origin.workflowRunAttempt,
    });
  }));
}

/** Retain a matching local producer while selecting only the exact CI seal. */
export function selectFinalEnvelopeProducerCoordinates(input: {
  readonly artifact: CompiledArtifactId;
  readonly entries: readonly CompiledArtifactCheckAttestation[];
  readonly attestationPolicyDigest: Sha256Hex;
  readonly environmentFingerprint: Sha256Hex;
  readonly portableSeal: FreshArtifactRecord["portableSeal"];
}): readonly PortableCiAttestationCoordinate[] | undefined {
  const currentPolicyEntries = input.entries.filter(
    (entry) => entry.attestationPolicyDigest === input.attestationPolicyDigest,
  );
  if (currentPolicyEntries.length === 0) {
    throw new Error(`${input.artifact} final envelope lacks current-policy producer evidence`);
  }
  if (!currentPolicyEntries.some(
    (entry) => entry.environmentFingerprint === input.environmentFingerprint,
  )) {
    throw new Error(`${input.artifact} final envelope lacks current-environment producer evidence`);
  }
  if (input.portableSeal !== "sealed") return undefined;
  const currentPolicyCiEntries = currentPolicyEntries.filter(
    (entry) => entry.origin.kind === "ci",
  );
  if (currentPolicyCiEntries.length !== 3) {
    throw new Error(`${input.artifact} final envelope lacks its exact current-policy CI set`);
  }
  return coordinates(currentPolicyCiEntries);
}

async function defaultCaptureFinalEnvelope(input: {
  readonly repositoryRoot: string;
  readonly retainedOwners: Readonly<Record<CompiledArtifactId, FreshArtifactRecord>>;
  readonly matrixReceipt: Uint8Array;
}): Promise<IdentityArtifactFinalEnvelope> {
  const matrixReceipt = parseMatrixControllerReceipt(input.matrixReceipt);
  const matrixLeg = await captureCurrentMatrixLeg(input.repositoryRoot, matrixReceipt);
  const artifactPaths = Object.values(COMPILED_ARTIFACT_SPECS)
    .flatMap((spec) => [spec.artifactPath, spec.certificatePath]);
  const finalExactFiles = [...new Set([
    ...ATTESTATION_POLICY_PATHS,
    ...artifactPaths,
    ".github/fenel-artifact-toolchains.json",
    "implementations/typescript/engine/scripts/generate-identity-artifacts.ts",
    "implementations/typescript/engine/scripts/generate-self-host-matrix.ts",
    "implementations/typescript/engine/scripts/self-host-matrix-controller.ts",
    "implementations/typescript/engine/scripts/lib/self-host-matrix-certificate.ts",
  ])].sort((left, right) => Buffer.compare(Buffer.from(left), Buffer.from(right)));
  const captured = await captureStableEpoch({
    repositoryRoot: input.repositoryRoot,
    domains: [
      {
        kind: "owner-overlay",
        artifact: "compiled-resolver",
        exactFiles: ownerOverlaySources("compiled-resolver").map(repositoryRelativePath),
      },
      {
        kind: "owner-overlay",
        artifact: "compiled-parser",
        exactFiles: ownerOverlaySources("compiled-parser").map(repositoryRelativePath),
      },
      {
        kind: "envelope",
        name: "identity-artifact-final",
        exactFiles: finalExactFiles.map(repositoryRelativePath),
      },
    ],
  });
  if (!captured.ok) throw new Error(`final envelope capture failed: ${captured.issue.code}`);
  const value = captured.value;
  const currentEnvironment = await acquireCompiledArtifactEnvironment({
    repositoryRoot: input.repositoryRoot,
    toolchainManifestBytes: value.bytes.read(repositoryRelativePath(
      ".github/fenel-artifact-toolchains.json",
    )),
    rootPackageJsonBytes: value.bytes.read(repositoryRelativePath("package.json")),
  });
  for (const artifact of ["compiled-resolver", "compiled-parser"] as const) {
    if (input.retainedOwners[artifact].environmentFingerprint !== currentEnvironment.environmentFingerprint) {
      throw new Error(`${artifact} final envelope environment differs from its retained tuple`);
    }
  }
  const coordinateSets: Partial<
    Record<CompiledArtifactId, readonly PortableCiAttestationCoordinate[]>
  > = {};
  for (const artifact of ["compiled-resolver", "compiled-parser"] as const) {
    const retained = input.retainedOwners[artifact];
    const overlay = value.domains.find(domain => domain.domain === `owner-overlay:${artifact}`);
    if (value.repositoryEpoch !== retained.repositoryEpoch || overlay === undefined
      || computeOwnerEpoch({ artifact, repositoryEpoch: value.repositoryEpoch,
        ownerOverlayDigest: overlay.digest, dependencyDigest: parseSha256Hex(retained.dependencyDigest),
        protocolVersion: OWNER_PROTOCOL, recoveryStubVersion: RECOVERY_STUB_VERSION,
        portableGenerationAbi: PORTABLE_GENERATION_ABI }) !== retained.ownerEpoch) {
      throw new Error(`${artifact} final envelope differs from the current retained source tuple`);
    }
    const spec = COMPILED_ARTIFACT_SPECS[artifact];
    const artifactPath = repositoryRelativePath(spec.artifactPath);
    const certificatePath = repositoryRelativePath(spec.certificatePath);
    const artifactBytes = value.bytes.read(artifactPath);
    const certificateBytes = value.bytes.read(certificatePath);
    const observedArtifactDigest = sha256Raw(artifactBytes);
    const observed = validateAndDigestCertificateBytes(certificateBytes);
    if (
      observed.certificate.artifact !== artifact
      || observed.certificate.artifactDigest !== observedArtifactDigest
      || observed.certificate.artifactByteLength !== artifactBytes.byteLength
      || observed.certificate.repositoryEpoch !== retained.producer.repositoryEpoch
      || observed.certificate.ownerEpoch !== retained.producer.ownerEpoch
      || observed.certificate.inputManifest.coveredSourceArchiveDigest !== retained.producer.coveredSourceArchiveDigest
      || observed.certificate.producerInput.key !== retained.producer.inputKey
      || observed.certificate.producerInput.environmentFingerprint !== retained.producer.environmentFingerprint
      || observed.certificate.dependencyDigest !== retained.dependencyDigest
      || observedArtifactDigest !== retained.artifactDigest
      || observed.certificateDigest !== retained.certificateDigest
    ) {
      throw new Error(`${artifact} final envelope does not bind the retained owner tuple`);
    }
    if (retained.sourceRelation === "complete-input-equal" && (retained.portableSeal !== "local-only"
      || !observed.certificate.producerAttestations.some(entry => entry.origin.kind === "local"
        && entry.environmentFingerprint === retained.environmentFingerprint
        && entry.attestationPolicyDigest === retained.attestationPolicyDigest
        && entry.checkPackageDigest === observed.certificate.producerCheckPackageDigest))) {
      throw new Error(`${artifact} retained envelope lacks its exact original local producer package`);
    }
    const selectedCoordinates = selectFinalEnvelopeProducerCoordinates({
      artifact,
      entries: observed.certificate.producerAttestations,
      attestationPolicyDigest: retained.attestationPolicyDigest,
      environmentFingerprint: retained.environmentFingerprint,
      portableSeal: retained.portableSeal,
    });
    if (selectedCoordinates !== undefined) coordinateSets[artifact] = selectedCoordinates;
  }
  const resolverCoordinates = coordinateSets["compiled-resolver"];
  const parserCoordinates = coordinateSets["compiled-parser"];
  const portableCiRun = resolverCoordinates !== undefined && parserCoordinates !== undefined
    ? assertCrossOwnerSealedCiRuns({
      "compiled-resolver": resolverCoordinates,
      "compiled-parser": parserCoordinates,
    })
    : null;
  const domains = value.domains.map(summary);
  const digest = sha256Raw(encodeCanonicalJson({
    schema: "fenel.identity-artifact-final-envelope-content.v1",
    repository: summary(value.repository),
    domains,
    environment: currentEnvironment.environment,
    environmentFingerprint: currentEnvironment.environmentFingerprint,
    matrixLeg,
    owners: {
      "compiled-parser": identityTuple(input.retainedOwners["compiled-parser"]),
      "compiled-resolver": identityTuple(input.retainedOwners["compiled-resolver"]),
    },
    portableCiRun,
  })) as Sha256Hex;
  return Object.freeze({
    schema: "fenel.identity-artifact-final-envelope.v1",
    digest,
    portableCiRun,
  });
}

function resolvedDependencies(
  dependencies: IdentityArtifactDriverDependencies,
): Required<IdentityArtifactDriverDependencies> {
  return {
    runFreshChild: dependencies.runFreshChild ?? defaultRunFreshChild,
    bootstrapPreflight: dependencies.bootstrapPreflight ?? defaultBootstrapPreflight,
    runCodenameLock: dependencies.runCodenameLock ?? defaultRunCodenameLock,
    runFieldCatalog: dependencies.runFieldCatalog ?? defaultRunFieldCatalog,
    captureRepositoryEpoch:
      dependencies.captureRepositoryEpoch ?? defaultCaptureRepositoryEpoch,
    captureFinalEnvelope: dependencies.captureFinalEnvelope ?? defaultCaptureFinalEnvelope,
    now: dependencies.now ?? (() => performance.now()),
    stdout: dependencies.stdout ?? ((line) => console.log(line)),
    stderr: dependencies.stderr ?? ((line) => console.error(line)),
  };
}

function childFailure(request: FreshChildRequest, result: FreshChildResult): Error {
  const suffix = result.error === undefined
    ? `exit ${result.exitCode === null ? "signal" : result.exitCode}`
    : result.error;
  return new Error(`${request.script} ${suffix}`);
}

async function requireGreenChild(
  dependencies: Required<IdentityArtifactDriverDependencies>,
  request: FreshChildRequest,
): Promise<void> {
  const result = await dependencies.runFreshChild(request);
  if (result.exitCode !== 0 || result.error !== undefined) throw childFailure(request, result);
}

function ownerScript(artifact: CompiledArtifactId): string {
  return artifact === "compiled-resolver"
    ? "generate-compiled-resolver.ts"
    : "generate-compiled-parser.ts";
}

function assertFreshOwner(
  record: ArtifactFreshnessRecord,
  artifact: CompiledArtifactId,
  expectedRepositoryEpoch: Sha256Hex,
): FreshArtifactRecord {
  if (record.verdict !== "FRESH") throw new Error(`${artifact} did not return FRESH`);
  if (record.artifact !== artifact) throw new Error(`${artifact} returned the wrong owner id`);
  if (record.repositoryEpoch !== expectedRepositoryEpoch) {
    throw new Error(
      `${artifact} repository epoch ${record.repositoryEpoch} differs from shared ${expectedRepositoryEpoch}`,
    );
  }
  return record;
}

async function capturedOwnerProbe(
  dependencies: Required<IdentityArtifactDriverDependencies>,
  phase: IdentityArtifactPhaseName,
  artifact: CompiledArtifactId,
  repositoryRoot: string,
  expectedRepositoryEpoch: Sha256Hex,
): Promise<{ readonly result: FreshChildResult; readonly record?: ArtifactFreshnessRecord }> {
  const request: FreshChildRequest = {
    phase,
    repositoryRoot,
    script: ownerScript(artifact),
    args: ["--probe", `--expected-repository-epoch=${expectedRepositoryEpoch}`],
    captureStdout: true,
    diagnoseOwner: true,
  };
  const result = await dependencies.runFreshChild(request);
  // A final probe must supply complete FRESH evidence. Spawn/capture failures
  // and malformed framing are uncertainty; neither can authorize retention.
  if (result.error !== undefined || result.exitCode === null) return { result };
  try {
    return {
      result,
      record: decodeOwnerProbe({
        stdout: result.stdout,
        exitCode: result.exitCode,
        expectedArtifact: artifact,
      }),
    };
  } catch {
    return { result };
  }
}

async function preflightOwnerAcquisition(
  dependencies: Required<IdentityArtifactDriverDependencies>,
  phase: IdentityArtifactPhaseName,
  artifact: CompiledArtifactId,
  repositoryRoot: string,
): Promise<PhaseOutcome> {
  // C2 orchestration only: use the existing import-inert owner acquisition and
  // closed-wire decoder. These observations never authorize artifact retention;
  // identity/catalogue writers may change the epoch before the bound repair.
  const request: FreshChildRequest = {
    phase,
    repositoryRoot,
    script: ownerScript(artifact),
    args: ["--probe"],
    captureStdout: true,
    diagnoseOwner: true,
  };
  const result = await dependencies.runFreshChild(request);
  if (result.error !== undefined || result.exitCode === null) throw childFailure(request, result);
  const record = decodeOwnerProbe({
    stdout: result.stdout,
    exitCode: result.exitCode,
    expectedArtifact: artifact,
  });
  if (record.verdict === "UNDECIDABLE") {
    throw new Error(`${artifact} acquisition preflight UNDECIDABLE: ${record.reasons.join(", ")}`);
  }
  return { detail: `owner acquisition computable (${record.verdict}); repair remains mandatory` };
}

async function repairOwner(
  dependencies: Required<IdentityArtifactDriverDependencies>,
  phase: IdentityArtifactPhaseName,
  artifact: CompiledArtifactId,
  repositoryRoot: string,
  expectedRepositoryEpoch: Sha256Hex,
): Promise<FreshArtifactRecord> {
  const request: FreshChildRequest = {
    phase,
    repositoryRoot,
    script: ownerScript(artifact),
    args: ["--repair", `--expected-repository-epoch=${expectedRepositoryEpoch}`],
    captureStdout: true,
    diagnoseOwner: true,
  };
  const result = await dependencies.runFreshChild(request);
  if (result.error !== undefined || result.exitCode !== 0) throw childFailure(request, result);
  const record = decodeOwnerProbe({
    stdout: result.stdout,
    exitCode: result.exitCode,
    expectedArtifact: artifact,
  });
  return assertFreshOwner(record, artifact, expectedRepositoryEpoch);
}

function ownerTupleEqual(left: FreshArtifactRecord, right: FreshArtifactRecord): boolean {
  return left.artifact === right.artifact
    && left.repositoryEpoch === right.repositoryEpoch
    && left.ownerEpoch === right.ownerEpoch
    && left.dependencyDigest === right.dependencyDigest
    && left.environmentFingerprint === right.environmentFingerprint
    && left.artifactDigest === right.artifactDigest
    && left.certificateDigest === right.certificateDigest
    && left.inputKey === right.inputKey
    && left.currentSourceArchiveDigest === right.currentSourceArchiveDigest
    && left.sourceRelation === right.sourceRelation
    && left.producer.repositoryEpoch === right.producer.repositoryEpoch
    && left.producer.ownerEpoch === right.producer.ownerEpoch
    && left.producer.coveredSourceArchiveDigest === right.producer.coveredSourceArchiveDigest
    && left.producer.inputKey === right.producer.inputKey
    && left.producer.environmentFingerprint === right.producer.environmentFingerprint
    && left.attestationPolicyDigest === right.attestationPolicyDigest
    && left.portableSeal === right.portableSeal;
}

async function finalOwnerProbe(
  dependencies: Required<IdentityArtifactDriverDependencies>,
  phase: IdentityArtifactPhaseName,
  artifact: CompiledArtifactId,
  repositoryRoot: string,
  expectedRepositoryEpoch: Sha256Hex,
): Promise<FreshArtifactRecord> {
  const probe = await capturedOwnerProbe(
    dependencies,
    phase,
    artifact,
    repositoryRoot,
    expectedRepositoryEpoch,
  );
  if (probe.record === undefined) throw new Error(`${artifact} final probe framing is invalid`);
  return assertFreshOwner(probe.record, artifact, expectedRepositoryEpoch);
}

function matrixArgs(
  options: IdentityArtifactDriverOptions,
  functionMints: number,
): readonly string[] {
  return Object.freeze([
    "--decide",
    `--function-mints=${functionMints}`,
    ...(options.matrix === "with" ? ["--with-matrix"] : []),
    ...(options.matrix === "without" ? ["--no-matrix"] : []),
    ...(options.adoptMatrixEnvironment === undefined
      ? []
      : [`--adopt-matrix-environment=${options.adoptMatrixEnvironment}`]),
  ]);
}

function matrixResultExitCode(result: MatrixResult): 0 | 1 | 2 | 20 | 21 {
  switch (result) {
    case "FRESH":
    case "CHECK_OK":
    case "LEGACY_REPAIRED":
    case "REPAIRED":
    case "SKIPPED_EXPLICIT":
    case "SKIPPED_LEGACY":
    case "VERIFIED_FOREIGN":
      return 0;
    case "CHECK_FAILED":
    case "REPAIR_FAILED":
      return 1;
    case "CLI_ERROR":
      return 2;
    case "DUE":
    case "DUE_UNTRUSTED":
    case "VERIFIED_FOREIGN_DUE":
      return 20;
    case "UNDECIDABLE":
      return 21;
    case "CHECK_REQUIRED":
    case "LEGACY_DUE":
    case "REPAIR_REQUIRED":
      throw new Error(`matrix controller returned nonterminal ${result}`);
  }
}

async function runMatrixDecision(
  dependencies: Required<IdentityArtifactDriverDependencies>,
  options: IdentityArtifactDriverOptions,
  functionMints: number,
): Promise<{ readonly receipt: MatrixDecisionReceipt; readonly outcome: PhaseOutcome }> {
  const request: FreshChildRequest = {
    phase: "self-host-matrix",
    repositoryRoot: options.repositoryRoot,
    script: "self-host-matrix-controller.ts",
    args: matrixArgs(options, functionMints),
    captureStdout: true,
  };
  const result = await dependencies.runFreshChild(request);
  if (result.error !== undefined || result.exitCode === null) throw childFailure(request, result);
  // The controller owns the closed schema. Parse/re-encode rejects malformed,
  // noncanonical, or multi-value stdout before it becomes envelope evidence.
  const parsedReceipt = parseMatrixControllerReceipt(result.stdout);
  if (parsedReceipt.mode !== CURRENT_SELF_HOST_MATRIX_MODE) {
    throw new Error(
      `matrix controller returned ${parsedReceipt.mode} receipt in ${CURRENT_SELF_HOST_MATRIX_MODE} mode`,
    );
  }
  const receipt = encodeMatrixControllerReceipt(parsedReceipt);
  if (result.exitCode !== 2 && parsedReceipt.operation !== "decide") {
    throw new Error(`matrix controller returned ${parsedReceipt.operation} to a --decide request`);
  }
  const expectedExitCode = matrixResultExitCode(parsedReceipt.result);
  if (result.exitCode !== expectedExitCode) {
    throw new Error(
      `matrix exit ${result.exitCode} disagrees with ${parsedReceipt.result} (${expectedExitCode})`,
    );
  }
  if (result.exitCode === 2 || (options.matrix === "with" && result.exitCode !== 0)) {
    throw childFailure(request, result);
  }
  if (![0, 1, 20, 21].includes(result.exitCode)) throw childFailure(request, result);
  const green = parsedReceipt.result === "FRESH"
    || (
      parsedReceipt.mode === "legacy-stampless"
      ? parsedReceipt.result === "LEGACY_REPAIRED"
      : parsedReceipt.result === "REPAIRED"
    );
  if (options.matrix === "with" && !green) {
    throw new Error(`explicit matrix request returned ${parsedReceipt.result}`);
  }
  const advisory = options.matrix === "without" || result.exitCode !== 0 || !green;
  return {
    receipt: { bytes: receipt, exitCode: result.exitCode },
    outcome: advisory
      ? {
        status: "skipped",
        detail: options.matrix === "without"
          ? "--no-matrix (advisory)"
          : `matrix ${parsedReceipt.result}, exit ${result.exitCode} (advisory)`,
      }
      : { detail: `${parsedReceipt.result}; ${functionMints} function-kind mint(s)` },
  };
}

function requiredState<T>(value: T | undefined, label: string): T {
  if (value === undefined) throw new Error(`driver state lacks ${label}`);
  return value;
}

function phaseActions(
  options: IdentityArtifactDriverOptions,
  dependencies: Required<IdentityArtifactDriverDependencies>,
  state: MutableDriverState,
): Readonly<Record<IdentityArtifactPhaseName, () => Promise<PhaseOutcome | void>>> {
  return Object.freeze({
    async "parser-bootstrap-preflight"(): Promise<PhaseOutcome> {
      const result = await dependencies.bootstrapPreflight(options.repositoryRoot);
      for (const warning of result.warnings) dependencies.stderr(`[parser-bootstrap] WARN: ${warning}`);
      if (!result.ok) {
        for (const refusal of result.refusals) {
          dependencies.stderr(`[parser-bootstrap] REFUSED: ${refusal}`);
        }
        throw new Error(`${result.refusals.length} unsafe source change(s)`);
      }
      return { detail: `${result.warnings.length} warning(s)` };
    },
    async "parser-bootstrap"(): Promise<void> {
      await requireGreenChild(dependencies, {
        phase: "parser-bootstrap",
        repositoryRoot: options.repositoryRoot,
        script: "generate-parser-bootstrap.ts",
        args: [],
        captureStdout: false,
      });
    },
    async "parser-bootstrap-check"(): Promise<void> {
      await requireGreenChild(dependencies, {
        phase: "parser-bootstrap-check",
        repositoryRoot: options.repositoryRoot,
        script: "generate-parser-bootstrap.ts",
        args: ["--check"],
        captureStdout: false,
      });
    },
    async "resolver-acquisition-preflight"(): Promise<PhaseOutcome> {
      return preflightOwnerAcquisition(
        dependencies, "resolver-acquisition-preflight", "compiled-resolver", options.repositoryRoot,
      );
    },
    async "parser-acquisition-preflight"(): Promise<PhaseOutcome> {
      return preflightOwnerAcquisition(
        dependencies, "parser-acquisition-preflight", "compiled-parser", options.repositoryRoot,
      );
    },
    async "codename-lock"(): Promise<PhaseOutcome> {
      // The parser selection is a module-evaluation read. Set it before the
      // first engine import made by the two in-process identity emitters.
      process.env["FENEL_PARSER_LEGACY"] = "1";
      state.lock = await dependencies.runCodenameLock();
      return { detail: `${state.lock.minted.length} minted` };
    },
    async "repository-field-catalog"(): Promise<PhaseOutcome> {
      const detail = await dependencies.runFieldCatalog(requiredState(state.lock, "codename lock"));
      return detail === undefined ? {} : { detail };
    },
    async "repository-epoch"(): Promise<PhaseOutcome> {
      state.repositoryEpoch = await dependencies.captureRepositoryEpoch(options.repositoryRoot);
      assertSha256(state.repositoryEpoch, "repository epoch");
      return { detail: state.repositoryEpoch };
    },
    async "compiled-resolver"(): Promise<PhaseOutcome> {
      // Repair owns the initial probe and returns without rendering when fresh.
      state.owners["compiled-resolver"] = await repairOwner(
        dependencies,
        "compiled-resolver",
        "compiled-resolver",
        options.repositoryRoot,
        requiredState(state.repositoryEpoch, "repository epoch"),
      );
      return { detail: "owner transaction FRESH" };
    },
    async "compiled-parser"(): Promise<PhaseOutcome> {
      state.owners["compiled-parser"] = await repairOwner(
        dependencies,
        "compiled-parser",
        "compiled-parser",
        options.repositoryRoot,
        requiredState(state.repositoryEpoch, "repository epoch"),
      );
      return { detail: "owner transaction FRESH" };
    },
    async "parse-cache"(): Promise<void> {
      await requireGreenChild(dependencies, {
        phase: "parse-cache",
        repositoryRoot: options.repositoryRoot,
        script: "generate-parse-cache.ts",
        args: ["--incremental"],
        captureStdout: false,
      });
    },
    async "signature-honesty-claims"(): Promise<void> {
      await requireGreenChild(dependencies, {
        phase: "signature-honesty-claims",
        repositoryRoot: options.repositoryRoot,
        script: "generate-signature-honesty-claims.ts",
        args: [],
        captureStdout: false,
      });
    },
    async "self-host-matrix"(): Promise<PhaseOutcome> {
      const lock = requiredState(state.lock, "codename lock");
      const functionMints = lock.minted.filter((row) => row.kind === "function").length;
      const matrix = await runMatrixDecision(dependencies, options, functionMints);
      state.matrixReceipt = matrix.receipt.bytes;
      if (matrix.outcome.status === "skipped") {
        state.notRegenerated.push(`matrix: ${matrix.outcome.detail ?? "advisory result"}`);
        dependencies.stderr(`[regen] MATRIX ADVISORY: ${matrix.outcome.detail ?? "not regenerated"}`);
      }
      return matrix.outcome;
    },
    async "final-envelope-a"(): Promise<PhaseOutcome> {
      state.envelopeA = await dependencies.captureFinalEnvelope({
        repositoryRoot: options.repositoryRoot,
        retainedOwners: {
          "compiled-resolver": requiredState(
            state.owners["compiled-resolver"],
            "retained resolver",
          ),
          "compiled-parser": requiredState(state.owners["compiled-parser"], "retained parser"),
        },
        matrixReceipt: requiredState(state.matrixReceipt, "matrix receipt"),
      });
      return { detail: state.envelopeA.digest };
    },
    async "final-resolver-probe"(): Promise<void> {
      state.finalResolver = await finalOwnerProbe(
        dependencies,
        "final-resolver-probe",
        "compiled-resolver",
        options.repositoryRoot,
        requiredState(state.repositoryEpoch, "repository epoch"),
      );
    },
    async "final-parser-probe"(): Promise<void> {
      state.finalParser = await finalOwnerProbe(
        dependencies,
        "final-parser-probe",
        "compiled-parser",
        options.repositoryRoot,
        requiredState(state.repositoryEpoch, "repository epoch"),
      );
    },
    async "final-envelope-b"(): Promise<PhaseOutcome> {
      state.envelopeB = await dependencies.captureFinalEnvelope({
        repositoryRoot: options.repositoryRoot,
        retainedOwners: {
          "compiled-resolver": requiredState(
            state.owners["compiled-resolver"],
            "retained resolver",
          ),
          "compiled-parser": requiredState(state.owners["compiled-parser"], "retained parser"),
        },
        matrixReceipt: requiredState(state.matrixReceipt, "matrix receipt"),
      });
      return { detail: state.envelopeB.digest };
    },
    async "final-attestation"(): Promise<void> {
      const envelopeA = requiredState(state.envelopeA, "final envelope A");
      const envelopeB = requiredState(state.envelopeB, "final envelope B");
      if (
        envelopeA.digest !== envelopeB.digest
        || !sameOptionalPortableRun(envelopeA.portableCiRun, envelopeB.portableCiRun)
      ) {
        throw new Error("final union envelope drifted between A and B");
      }
      const retainedResolver = requiredState(
        state.owners["compiled-resolver"],
        "retained resolver",
      );
      const retainedParser = requiredState(state.owners["compiled-parser"], "retained parser");
      if (!ownerTupleEqual(retainedResolver, requiredState(state.finalResolver, "final resolver"))) {
        throw new Error("final resolver tuple differs from its retained tuple");
      }
      if (!ownerTupleEqual(retainedParser, requiredState(state.finalParser, "final parser"))) {
        throw new Error("final parser tuple differs from its retained tuple");
      }
    },
  });
}

/** Execute the frozen graph serially and record every never-started phase. */
export async function runIdentityArtifactDriver(
  options: IdentityArtifactDriverOptions,
  injected: IdentityArtifactDriverDependencies = {},
): Promise<IdentityArtifactDriverResult> {
  if (options.adoptMatrixEnvironment !== undefined) {
    assertSha256(options.adoptMatrixEnvironment, "matrix environment adoption digest");
    if (options.matrix !== "with") {
      throw new TypeError("--adopt-matrix-environment requires --with-matrix");
    }
  }
  const dependencies = resolvedDependencies(injected);
  const state: MutableDriverState = { owners: {}, notRegenerated: [] };
  const actions = phaseActions(options, dependencies, state);
  const records: IdentityArtifactPhaseRecord[] = [];
  let decidingFailure: IdentityArtifactPhaseName | undefined;
  for (const phase of IDENTITY_ARTIFACT_PHASE_DECLARATION) {
    if (decidingFailure !== undefined) {
      records.push({
        name: phase.name,
        status: "skipped",
        ms: 0,
        detail: `${decidingFailure} failed`,
      });
      continue;
    }
    const started = dependencies.now();
    try {
      const outcome = await actions[phase.name]();
      const status = outcome?.status ?? "ok";
      if (status === "skipped" && phase.mandatory) {
        throw new Error("mandatory phase attempted to skip");
      }
      records.push({
        name: phase.name,
        status,
        ms: dependencies.now() - started,
        ...(outcome?.detail === undefined ? {} : { detail: outcome.detail }),
      });
    } catch (error) {
      decidingFailure = phase.name;
      records.push({
        name: phase.name,
        status: "failed",
        ms: dependencies.now() - started,
        detail: message(error),
      });
      dependencies.stderr(`[regen] ${phase.name} FAILED: ${message(error)}`);
    }
  }
  return Object.freeze({
    ok: decidingFailure === undefined,
    phases: Object.freeze(records),
    retainedOwners: Object.freeze({ ...state.owners }),
    ...(state.repositoryEpoch === undefined ? {} : { repositoryEpoch: state.repositoryEpoch }),
    notRegenerated: Object.freeze([...state.notRegenerated]),
  });
}

export function parseIdentityArtifactDriverOptions(
  args: readonly string[],
  repositoryRoot: string,
): IdentityArtifactDriverOptions {
  let matrix: IdentityArtifactDriverOptions["matrix"] = "automatic";
  let adoptMatrixEnvironment: Sha256Hex | undefined;
  for (const arg of args) {
    if (["--skip-compiled", "--skip-parse-cache"].includes(arg)) {
      throw new TypeError(`${arg} was retired; owner probe/repair and parse-cache are mandatory`);
    }
    if (arg === "--plan") {
      throw new TypeError("--plan does not exist; use the compiled owner --probe interfaces");
    }
    if (arg === "--with-matrix") {
      if (matrix !== "automatic") throw new TypeError("matrix selectors are duplicate or conflicting");
      matrix = "with";
      continue;
    }
    if (arg === "--no-matrix") {
      if (matrix !== "automatic") throw new TypeError("matrix selectors are duplicate or conflicting");
      matrix = "without";
      continue;
    }
    if (arg.startsWith("--adopt-matrix-environment=")) {
      if (adoptMatrixEnvironment !== undefined) throw new TypeError("matrix adoption is duplicated");
      const raw = arg.slice("--adopt-matrix-environment=".length);
      assertSha256(raw, "matrix environment adoption digest");
      adoptMatrixEnvironment = raw;
      continue;
    }
    throw new TypeError(`unknown argument ${arg}`);
  }
  if (adoptMatrixEnvironment !== undefined && matrix !== "with") {
    throw new TypeError("--adopt-matrix-environment requires --with-matrix");
  }
  return {
    repositoryRoot,
    matrix,
    ...(adoptMatrixEnvironment === undefined ? {} : { adoptMatrixEnvironment }),
  };
}

function report(result: IdentityArtifactDriverResult, started: number): void {
  console.log("");
  console.log(`[regen] ${"phase".padEnd(28)} ${"status".padEnd(8)} wall`);
  for (const phase of result.phases) {
    const wall = phase.status === "skipped" ? "-" : formatDuration(phase.ms);
    console.log(
      `[regen] ${phase.name.padEnd(28)} ${phase.status.padEnd(8)} ${wall.padEnd(8)}`
      + `${phase.detail === undefined ? "" : ` ${phase.detail}`}`,
    );
  }
  console.log(
    `[regen] ${"total (elapsed)".padEnd(28)} ${"".padEnd(8)} `
    + formatDuration(performance.now() - started),
  );
  if (result.notRegenerated.length > 0) {
    console.log("");
    console.log("[regen] NOT regenerated:");
    for (const line of result.notRegenerated) console.log(`[regen]   ${line}`);
  }
}

export async function main(
  args: readonly string[] = process.argv.slice(2),
  repositoryRoot = DEFAULT_REPOSITORY_ROOT,
): Promise<number> {
  if (args.length === 1 && (args[0] === "--help" || args[0] === "-h")) {
    console.log(USAGE);
    return 0;
  }
  let options: IdentityArtifactDriverOptions;
  try {
    options = parseIdentityArtifactDriverOptions(args, repositoryRoot);
  } catch (error) {
    console.error(`[regen] ${message(error)}`);
    console.error(USAGE);
    return 2;
  }
  const started = performance.now();
  const result = await runIdentityArtifactDriver(options);
  report(result, started);
  if (!result.ok) {
    const failed = result.phases.filter((phase) => phase.status === "failed");
    console.error(`[regen] FAILED: ${failed.map((phase) => phase.name).join(", ")}`);
    return 1;
  }
  console.log("[regen] OK");
  return 0;
}

if (import.meta.main) process.exitCode = await main();
