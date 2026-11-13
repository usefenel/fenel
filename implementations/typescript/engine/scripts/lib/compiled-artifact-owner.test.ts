import { afterEach, describe, expect, spyOn, test } from "bun:test";
import {
  appendFileSync,
  copyFileSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import {
  captureStableEpoch,
  digestByteManifest,
  parseSha256Hex,
  repositoryRelativePath,
  sha256Raw,
  type ByteManifest,
  type CapturedByteStore,
  type RepositoryRelativePath,
  type StableEpochCapture,
} from "./artifact-bytes";
import { compareUtf8, encodeCanonicalJson } from "./artifact-wire-json";
import {
  canonicalizeProducerAttestations,
  computeEnvironmentFingerprint,
  validateArtifactEnvironmentEvidence,
  validateCompiledArtifactCheckAttestation,
  type ArtifactEnvironmentEvidence,
  type ArtifactOsFamily,
  type AttestationOrigin,
  type CompiledArtifactCheckAttestation,
} from "./compiled-artifact-attestation";
import {
  RECOVERY_STUB_VERSION,
  compiledArtifactRecoveryStubs,
  makeBaseBuildCertificate,
  readArtifactPair,
  sha256Bytes,
} from "./compiled-artifact-certificate";
import {
  CHECK_PACKAGE_SCHEMA,
  buildCheckPackageNamespace,
  computeCheckPackageDigest,
  type CheckPackageFileRow,
  type CompiledArtifactCheckPackageMetadata,
} from "./compiled-artifact-check-package";
import {
  proveEmptyCompiledArtifactDependencies,
  type ColdEmptyCompiledArtifactDependencyInput,
  type ColdEmptyCompiledArtifactDependencyProof,
} from "./compiled-artifact-dependencies";
import {
  COMPILED_ARTIFACT_ENVIRONMENT_VARIABLES,
  type AcquiredCompiledArtifactEnvironment,
} from "./compiled-artifact-environment";
import { makeRawCompiledArtifactInput } from "./compiled-artifact-input-key";
import type { PreparedCompiledArtifactCheckPackage } from "./compiled-artifact-git-package";
import {
  checkCompiledArtifactOwner,
  compiledArtifactIndependentCheckEnvironment,
  mergeCompiledArtifactOwnerAttestations,
  probeCompiledArtifactOwner,
  repairCompiledArtifactOwner,
  runCompiledArtifactOwnerCli,
  type OwnerEvidence,
  type OwnerRuntimeDependencies,
} from "./compiled-artifact-owner";
import {
  ARTIFACT_FRESHNESS_SCHEMA,
  COMPILED_ARTIFACT_SPECS,
  computeCertificateBaseDigest,
  parseArtifactFreshnessRecord,
  PORTABLE_GENERATION_ABI,
  type ArtifactFreshnessRecord,
  type CompiledArtifactBuildCertificate,
  type Sha256Hex,
} from "./compiled-artifact-protocol";
import {
  ATTESTATION_POLICY_PATHS,
  compiledArtifactSourceCensus,
  ownerOverlaySources,
} from "./compiled-artifact-source-census";
import {
  bunToolchainRowDigest,
  decodeArtifactToolchainManifest,
  selectBunToolchain,
} from "./compiled-artifact-toolchain";

const LIVE_ROOT = resolve(fileURLToPath(new URL("../../../../../", import.meta.url)));
const TOOLCHAIN_PATH = ".github/fenel-artifact-toolchains.json";
const ARTIFACT = "compiled-parser" as const;
const ARTIFACT_PATH = COMPILED_ARTIFACT_SPECS[ARTIFACT].artifactPath;
const UTF8 = new TextEncoder();
const temporaryRoots: string[] = [];

const hex = (character: string): Sha256Hex => parseSha256Hex(character.repeat(64));

function nonFreshReasons(record: ArtifactFreshnessRecord): readonly string[] {
  if (record.verdict === "FRESH") throw new Error("expected non-fresh owner record");
  return record.reasons;
}

async function coldDependencyProof(
  input: ColdEmptyCompiledArtifactDependencyInput,
): Promise<ColdEmptyCompiledArtifactDependencyProof> {
  const proof = proveEmptyCompiledArtifactDependencies({
    packageJsonBytes: input.packageJsonBytes,
    bunLockBytes: input.bunLockBytes,
  });
  if (!Buffer.from(input.expectedDependencyManifestBytes).equals(
    Buffer.from(UTF8.encode(proof.canonicalManifest)),
  )) throw new Error("test cold proof received the wrong expected manifest");
  return Object.freeze({
    ...proof,
    coldResolution: "verified",
    observedCanonicalManifest: proof.canonicalManifest,
    sourceCaptureDigest: sha256Bytes(input.expectedDependencyManifestBytes),
    bunExecutableSha256: input.bunExecutableSha256,
  });
}

afterEach(() => {
  for (const root of temporaryRoots.splice(0)) rmSync(root, { recursive: true, force: true });
});

function fileRow(path: string, bytes: Uint8Array): CheckPackageFileRow {
  return {
    path,
    kind: "file",
    byteLength: bytes.byteLength,
    digest: sha256Bytes(bytes),
  };
}

function oneRowManifest(domain: string, path: string, bytes: Uint8Array): ByteManifest {
  return digestByteManifest(domain, [{
    path: repositoryRelativePath(path),
    kind: "regular-file",
    byteLength: bytes.byteLength,
    sha256: sha256Raw(bytes),
  }]);
}

function copyClassifiedSourceWorld(): string {
  const root = mkdtempSync(join(tmpdir(), "fenel-m3b-owner-"));
  temporaryRoots.push(root);
  for (const row of compiledArtifactSourceCensus()) {
    const target = resolve(root, ...row.path.split("/"));
    mkdirSync(dirname(target), { recursive: true });
    copyFileSync(resolve(LIVE_ROOT, ...row.path.split("/")), target);
  }
  mkdirSync(resolve(root, "implementations/typescript/engine/src/generated"), { recursive: true });
  return root;
}

function environmentFor(
  toolchainBytes: Uint8Array,
  osFamily: ArtifactOsFamily,
): ArtifactEnvironmentEvidence {
  const manifest = decodeArtifactToolchainManifest(toolchainBytes);
  const arch = "x64";
  const row = selectBunToolchain(manifest, { osFamily, arch });
  return validateArtifactEnvironmentEvidence({
    osFamily,
    arch,
    bun: {
      release: row.bunRelease,
      revision: row.bunRevision,
      executableDigest: row.binarySha256,
      webkitVersion: "WebKit-owner-fixture",
      javascriptCoreVersion: "JSC-owner-fixture",
      icuVersion: "73.2",
      unicodeVersion: "15.0",
      toolchainManifestDigest: manifest.manifestDigest,
      toolchainRowDigest: bunToolchainRowDigest(row),
    },
    variables: COMPILED_ARTIFACT_ENVIRONMENT_VARIABLES,
  });
}

type OwnerWorld = {
  readonly root: string;
  readonly artifactBytes: Uint8Array;
  readonly toolchainBytes: Uint8Array;
  readonly acquired: AcquiredCompiledArtifactEnvironment;
  readonly evidence: OwnerEvidence;
};

function ownerWorld(): OwnerWorld {
  const root = copyClassifiedSourceWorld();
  const artifactBytes = UTF8.encode("// compiled parser owner fixture\n");
  const toolchainBytes = new Uint8Array(readFileSync(resolve(LIVE_ROOT, TOOLCHAIN_PATH)));
  const manifest = decodeArtifactToolchainManifest(toolchainBytes);
  const environment = environmentFor(toolchainBytes, "windows");
  const repositoryManifest = oneRowManifest("repository", "fenel/owner-fixture.fn", UTF8.encode("fixture\n"));
  const ownerManifest = oneRowManifest(
    `owner-overlay:${ARTIFACT}`,
    "implementations/typescript/engine/scripts/generate-compiled-parser.ts",
    UTF8.encode("owner\n"),
  );
  const environmentManifest = oneRowManifest(
    "envelope:compiled-artifact-environment",
    TOOLCHAIN_PATH,
    toolchainBytes,
  );
  const stub = compiledArtifactRecoveryStubs().find((row) => row.path === ARTIFACT_PATH)!;
  const sourceRows = [
    fileRow(stub.path, stub.bytes),
    fileRow("fenel/owner-fixture.fn", UTF8.encode("fixture\n")),
  ].sort((left, right) => compareUtf8(left.path, right.path));
  const sourceNamespace = buildCheckPackageNamespace("source", sourceRows);
  const environmentNamespace = buildCheckPackageNamespace("environment", [
    fileRow(TOOLCHAIN_PATH, toolchainBytes),
  ]);
  const emptyStore: CapturedByteStore = Object.freeze({
    paths: Object.freeze([]),
    has: () => false,
    read: (path: RepositoryRelativePath): Uint8Array => {
      throw new Error(`unexpected captured byte read ${path}`);
    },
  });
  const evidence: OwnerEvidence = Object.freeze({
    capturedBytes: emptyStore,
    repositoryManifest,
    ownerManifest,
    environmentManifest,
    repositoryEpoch: repositoryManifest.digest,
    ownerEpoch: hex("a"),
    dependencyDigest: hex("b"),
    dependencyManifestBytes: UTF8.encode("{}\n"),
    rawInput: makeRawCompiledArtifactInput({
      artifact: ARTIFACT,
      acquisitionDigest: sourceNamespace.digest,
      ownerOverlayDigest: ownerManifest.digest,
      repositoryExactDigest: repositoryManifest.digest,
      dependencyDigest: hex("b"),
      environmentFingerprint: computeEnvironmentFingerprint(environment),
      recoveryStubVersion: RECOVERY_STUB_VERSION,
      portableGenerationAbi: PORTABLE_GENERATION_ABI,
    }),
    environment,
    environmentFingerprint: computeEnvironmentFingerprint(environment),
    attestationPolicyDigest: hex("c"),
    workflowDigest: hex("d"),
    sourceProvenance: { kind: "stable-live" as const },
    sourceNamespace,
    environmentNamespace,
    toolchainManifestBytes: toolchainBytes,
    sourcePaths: Object.freeze([]),
    coveredSourceArchiveDigest: sourceNamespace.digest,
    bunExecutable: process.execPath,
  });
  const acquired: AcquiredCompiledArtifactEnvironment = Object.freeze({
    manifest,
    bunExecutable: process.execPath,
    environment,
    environmentFingerprint: evidence.environmentFingerprint,
  });
  return { root, artifactBytes, toolchainBytes, acquired, evidence };
}

function metadataFor(
  world: OwnerWorld,
  provenance: CompiledArtifactCheckPackageMetadata["sourceProvenance"],
  artifactBytes = world.artifactBytes,
  artifact: CompiledArtifactCheckPackageMetadata["artifact"] = ARTIFACT,
): CompiledArtifactCheckPackageMetadata {
  const { schema: _schema, contract: _contract, key: _key, ...rawComponents } = world.evidence.rawInput;
  const producerInput = makeRawCompiledArtifactInput({ ...rawComponents, artifact });
  const artifactPath = COMPILED_ARTIFACT_SPECS[artifact].artifactPath;
  return {
    schema: CHECK_PACKAGE_SCHEMA,
    artifact,
    artifactPath,
    portableGenerationAbi: PORTABLE_GENERATION_ABI,
    sourceProvenance: provenance,
    repositoryEpoch: world.evidence.repositoryEpoch,
    ownerEpoch: world.evidence.ownerEpoch,
    dependencyDigest: world.evidence.dependencyDigest,
    attestationPolicyDigest: world.evidence.attestationPolicyDigest,
    producerInput,
    namespaces: {
      source: world.evidence.sourceNamespace,
      candidate: buildCheckPackageNamespace("candidate", [fileRow(artifactPath, artifactBytes)]),
      environment: world.evidence.environmentNamespace,
    },
  };
}

function baseCertificate(
  world: OwnerWorld,
  artifact: "compiled-parser" | "compiled-resolver" = ARTIFACT,
): CompiledArtifactBuildCertificate {
  const producerMetadata = metadataFor(world, { kind: "stable-live" }, world.artifactBytes, artifact);
  return makeBaseBuildCertificate({
    artifact,
    repositoryEpoch: world.evidence.repositoryEpoch,
    ownerEpoch: world.evidence.ownerEpoch,
    dependencyDigest: world.evidence.dependencyDigest,
    artifactBytes: world.artifactBytes,
    producerInput: producerMetadata.producerInput,
    producerCheckPackageDigest: computeCheckPackageDigest(producerMetadata),
    inputManifest: {
      coveredSourceArchiveDigest: world.evidence.coveredSourceArchiveDigest,
      repository: {
        digest: world.evidence.repositoryManifest.digest,
        fileCount: world.evidence.repositoryManifest.fileCount,
        byteLength: world.evidence.repositoryManifest.byteLength,
      },
      ownerOverlay: {
        digest: world.evidence.ownerManifest.digest,
        fileCount: world.evidence.ownerManifest.fileCount,
        byteLength: world.evidence.ownerManifest.byteLength,
      },
      dependencies: {
        digest: world.evidence.dependencyDigest,
        fileCount: 0,
        byteLength: 0,
      },
    },
  });
}

function installPair(
  world: OwnerWorld,
  certificate: CompiledArtifactBuildCertificate = baseCertificate(world),
): void {
  const spec = COMPILED_ARTIFACT_SPECS[ARTIFACT];
  const artifactPath = resolve(world.root, ...spec.artifactPath.split("/"));
  const certificatePath = resolve(world.root, ...spec.certificatePath.split("/"));
  mkdirSync(dirname(artifactPath), { recursive: true });
  writeFileSync(artifactPath, world.artifactBytes);
  writeFileSync(certificatePath, encodeCanonicalJson(certificate));
}

function attestation(input: {
  readonly world: OwnerWorld;
  readonly certificate: CompiledArtifactBuildCertificate;
  readonly origin: AttestationOrigin;
  readonly environment: ArtifactEnvironmentEvidence;
  readonly metadata: CompiledArtifactCheckPackageMetadata;
  readonly artifact?: "compiled-parser" | "compiled-resolver";
  readonly artifactBytes?: Uint8Array;
  readonly policyDigest?: Sha256Hex;
}): CompiledArtifactCheckAttestation {
  const artifactBytes = input.artifactBytes ?? input.world.artifactBytes;
  return validateCompiledArtifactCheckAttestation({
    schema: "fenel.compiled-artifact-check-attestation.v2",
    result: "MATCH",
    artifact: input.artifact ?? ARTIFACT,
    origin: input.origin,
    checkPackageDigest: computeCheckPackageDigest(input.metadata),
    coveredSourceArchiveDigest: input.world.evidence.coveredSourceArchiveDigest,
    certificateBaseDigest: computeCertificateBaseDigest(input.certificate),
    repositoryEpoch: input.world.evidence.repositoryEpoch,
    ownerEpoch: input.world.evidence.ownerEpoch,
    dependencyDigest: input.world.evidence.dependencyDigest,
    environment: input.environment,
    environmentFingerprint: computeEnvironmentFingerprint(input.environment),
    artifactByteLength: artifactBytes.byteLength,
    artifactDigest: sha256Bytes(artifactBytes),
    attestationPolicyDigest: input.policyDigest ?? input.world.evidence.attestationPolicyDigest,
  });
}

const SOURCE_COMMIT = "f".repeat(40);
const CI_ORIGIN = Object.freeze({
  kind: "ci" as const,
  sourceCommit: SOURCE_COMMIT,
  workflowDigest: hex("d"),
  workflowRunId: "8675309",
  workflowRunAttempt: 1,
});

function ciSet(world: OwnerWorld): readonly CompiledArtifactCheckAttestation[] {
  const certificate = baseCertificate(world);
  const metadata = metadataFor(world, {
    kind: "git-object",
    sourceCommit: SOURCE_COMMIT,
    workflowDigest: world.evidence.workflowDigest,
  });
  return (["windows", "linux", "macos"] as const).map((osFamily) => attestation({
    world,
    certificate,
    origin: CI_ORIGIN,
    environment: environmentFor(world.toolchainBytes, osFamily),
    metadata,
  }));
}

function prepared(metadata: CompiledArtifactCheckPackageMetadata): PreparedCompiledArtifactCheckPackage {
  return Object.freeze({
    output: "unused-test-package",
    metadata,
    metadataBytes: encodeCanonicalJson(metadata),
    packageDigest: computeCheckPackageDigest(metadata),
  });
}

function writeAttestationFiles(
  world: OwnerWorld,
  attestations: readonly CompiledArtifactCheckAttestation[],
): readonly string[] {
  return attestations.map((entry, index) => {
    const path = resolve(world.root, `attestation-${index}.json`);
    writeFileSync(path, encodeCanonicalJson(entry));
    return path;
  });
}

function ownerDependencies(world: OwnerWorld) {
  return {
    acquiredEnvironment: world.acquired,
    capturedEvidence: world.evidence,
    coldResolveDependencies: coldDependencyProof,
    prepareCheckPackage: () => prepared(metadataFor(world, {
      kind: "git-object",
      sourceCommit: SOURCE_COMMIT,
      workflowDigest: world.evidence.workflowDigest,
    })),
  } as const;
}

function certificateWith(
  base: CompiledArtifactBuildCertificate,
  producerAttestations: readonly CompiledArtifactCheckAttestation[],
): CompiledArtifactBuildCertificate {
  return { ...base, producerAttestations: canonicalizeProducerAttestations(producerAttestations) };
}

describe("compiled artifact owner probe", () => {
  test.each([
    ["source census", "owner-uncomputable", "M3b executable source is unclassified"],
    ["environment acquisition", "environment-uncomputable", "unsupported compiled-artifact platform"],
    ["first capture", "owner-uncomputable", "injected first-capture failure"],
    ["typed first capture", "concurrent-mutation", "expected repository epoch"],
    ["second capture", "concurrent-mutation", "injected second-capture failure"],
  ] as const)("%s diagnostics preserve the closed probe record and exit", async (stage, reason, diagnostic) => {
    const world = ownerWorld();
    if (stage === "source census") {
      writeFileSync(resolve(world.root, "implementations/typescript/engine/scripts/lib/m3b-diagnostic-helper.ts"),
        "export const diagnostic = true;\n");
      appendFileSync(resolve(world.root, "implementations/typescript/engine/scripts/generate-compiled-parser.ts"),
        '\nimport "./lib/m3b-diagnostic-helper";\n');
    } else if (stage === "environment acquisition") {
      writeFileSync(resolve(world.root, TOOLCHAIN_PATH), world.toolchainBytes);
      writeFileSync(resolve(world.root, "package.json"),
        JSON.stringify({ packageManager: `bun@${world.acquired.environment.bun.release}` }));
    }
    const priorDiagnose = process.env["FENEL_OWNER_DIAGNOSE"];
    const errors = spyOn(console, "error").mockImplementation(() => {});
    let baseline: Uint8Array | undefined;
    try {
      for (const diagnose of [false, true]) {
        process.env["FENEL_OWNER_DIAGNOSE"] = diagnose ? "1" : "0";
        errors.mockClear();
        let captures = 0;
        const dependencies: OwnerRuntimeDependencies = stage === "environment acquisition"
          ? { platform: "aix" }
          : {
            ...ownerDependencies(world),
            afterEvidenceCapture: () => {
              captures += 1;
              if (stage === "first capture" && captures === 1) throw new Error(diagnostic);
              if (stage === "second capture" && captures === 2) throw new Error(diagnostic);
            },
          };
        const stdout: Uint8Array[] = [];
        const exitCode = await runCompiledArtifactOwnerCli({
          artifact: ARTIFACT,
          repositoryRoot: world.root,
          args: stage === "typed first capture"
            ? ["--probe", `--expected-repository-epoch=${hex("f")}`]
            : ["--probe"],
          io: { stdout: (bytes) => stdout.push(bytes), stderr: () => {} },
          dependencies,
        });
        expect(exitCode).toBe(21);
        expect(stdout).toHaveLength(1);
        expect(parseArtifactFreshnessRecord(stdout[0]!)).toMatchObject({
          verdict: "UNDECIDABLE",
          reasons: [reason],
        });
        if (baseline === undefined) baseline = stdout[0]!;
        else expect(stdout[0]).toEqual(baseline);
        if (diagnose) {
          expect(errors).toHaveBeenCalledTimes(1);
          const [prefix, artifact, error] = errors.mock.calls[0]!;
          expect(prefix).toBe("[owner:diagnose]");
          expect(artifact).toBe(ARTIFACT);
          expect(error).toBeInstanceOf(Error);
          expect((error as Error).message).toContain(diagnostic);
        } else expect(errors).not.toHaveBeenCalled();
      }
    } finally {
      errors.mockRestore();
      if (priorDiagnose === undefined) delete process.env["FENEL_OWNER_DIAGNOSE"];
      else process.env["FENEL_OWNER_DIAGNOSE"] = priorDiagnose;
    }
  });

  test("a failed second capture emits only the closed public evidence tuple", async () => {
    const world = ownerWorld();
    let captures = 0;
    const record = await probeCompiledArtifactOwner({
      repositoryRoot: world.root,
      artifact: ARTIFACT,
    }, {
      ...ownerDependencies(world),
      afterEvidenceCapture: () => {
        captures += 1;
        if (captures === 2) throw new Error("injected second-capture failure");
      },
    });

    expect(captures).toBe(2);
    expect(record).toEqual({
      schema: ARTIFACT_FRESHNESS_SCHEMA,
      artifact: ARTIFACT,
      verdict: "UNDECIDABLE",
      portableSeal: "unresolved",
      reasons: ["concurrent-mutation"],
      attestationPolicyDigest: world.evidence.attestationPolicyDigest,
      repositoryEpoch: world.evidence.repositoryEpoch,
      ownerEpoch: world.evidence.ownerEpoch,
      dependencyDigest: world.evidence.dependencyDigest,
      environmentFingerprint: world.evidence.environmentFingerprint,
    });
  });

  test("rejects wrong package/workflow/artifact-kind and input-summary evidence", async () => {
    const world = ownerWorld();
    const base = baseCertificate(world);
    const local = attestation({
      world,
      certificate: base,
      origin: { kind: "local" },
      environment: world.evidence.environment,
      metadata: metadataFor(world, { kind: "stable-live" }),
    });
    installPair(world, certificateWith(base, [local]));
    const fresh = await probeCompiledArtifactOwner({
      repositoryRoot: world.root,
      artifact: ARTIFACT,
    }, ownerDependencies(world));
    expect(fresh.verdict).toBe("FRESH");
    expect(fresh.portableSeal).toBe("local-only");

    const wrongPackage = { ...local, checkPackageDigest: hex("0") };
    installPair(world, certificateWith(base, [wrongPackage]));
    const packageRecord = await probeCompiledArtifactOwner({
      repositoryRoot: world.root,
      artifact: ARTIFACT,
    }, ownerDependencies(world));
    expect(packageRecord.verdict).toBe("STALE");
    expect(nonFreshReasons(packageRecord)).toContain("producer-policy-mismatch");

    const wrongWorkflowOrigin = { ...CI_ORIGIN, workflowDigest: hex("1") };
    const wrongWorkflow = attestation({
      world,
      certificate: base,
      origin: wrongWorkflowOrigin,
      environment: world.evidence.environment,
      metadata: metadataFor(world, {
        kind: "git-object",
        sourceCommit: SOURCE_COMMIT,
        workflowDigest: wrongWorkflowOrigin.workflowDigest,
      }),
    });
    installPair(world, certificateWith(base, [wrongWorkflow]));
    const workflowRecord = await probeCompiledArtifactOwner({
      repositoryRoot: world.root,
      artifact: ARTIFACT,
    }, ownerDependencies(world));
    expect(workflowRecord.verdict).toBe("STALE");
    expect(nonFreshReasons(workflowRecord)).toContain("producer-policy-mismatch");

    installPair(world, baseCertificate(world, "compiled-resolver"));
    const kindRecord = await probeCompiledArtifactOwner({
      repositoryRoot: world.root,
      artifact: ARTIFACT,
    }, ownerDependencies(world));
    expect(kindRecord.verdict).toBe("STALE");
    expect(nonFreshReasons(kindRecord)).toContain("certificate-artifact-mismatch");

    const wrongSummaryBase = {
      ...base,
      inputManifest: {
        ...base.inputManifest,
        repository: {
          ...base.inputManifest.repository,
          fileCount: base.inputManifest.repository.fileCount + 1,
        },
      },
    };
    installPair(world, wrongSummaryBase);
    const summaryRecord = await probeCompiledArtifactOwner({
      repositoryRoot: world.root,
      artifact: ARTIFACT,
    }, ownerDependencies(world));
    expect(summaryRecord.verdict).toBe("STALE");
    expect(nonFreshReasons(summaryRecord)).toContain("certificate-artifact-mismatch");
  }, 15_000);

  test("captured root packageManager disagreement is UNDECIDABLE", async () => {
    const toolchainBytes = new Uint8Array(readFileSync(resolve(LIVE_ROOT, TOOLCHAIN_PATH)));
    const baseEnvironment = environmentFor(toolchainBytes, "windows");
    const mismatchedEnvironment = validateArtifactEnvironmentEvidence({
      ...baseEnvironment,
      bun: { ...baseEnvironment.bun, release: "0.0.0" },
    });
    const manifest = decodeArtifactToolchainManifest(toolchainBytes);
    const acquired: AcquiredCompiledArtifactEnvironment = {
      manifest,
      bunExecutable: process.execPath,
      environment: mismatchedEnvironment,
      environmentFingerprint: computeEnvironmentFingerprint(mismatchedEnvironment),
    };
    const capture = minimalCapture(toolchainBytes);
    const record = await probeCompiledArtifactOwner({
      repositoryRoot: LIVE_ROOT,
      artifact: ARTIFACT,
    }, {
      acquiredEnvironment: acquired,
      capture: async () => ({ ok: true, value: capture }),
      coldResolveDependencies: coldDependencyProof,
    });
    expect(record.verdict).toBe("UNDECIDABLE");
    expect(nonFreshReasons(record)).toEqual(["environment-uncomputable"]);
  });

  test("a forged three-family Bun row cannot make the owner probe sealed", async () => {
    const world = ownerWorld();
    const base = baseCertificate(world);
    const valid = ciSet(world);
    const original = valid.find((entry) => entry.environment.osFamily === "linux")!;
    const forgedEnvironment = {
      ...original.environment,
      bun: { ...original.environment.bun, toolchainRowDigest: hex("1") },
    };
    const forged = validateCompiledArtifactCheckAttestation({
      ...original,
      environment: forgedEnvironment,
      environmentFingerprint: computeEnvironmentFingerprint(forgedEnvironment),
    });
    installPair(world, certificateWith(base, valid.map((entry) =>
      entry.environment.osFamily === "linux" ? forged : entry)));

    const record = await probeCompiledArtifactOwner({
      repositoryRoot: world.root,
      artifact: ARTIFACT,
    }, ownerDependencies(world));
    expect(record.verdict).toBe("FRESH");
    expect(record.portableSeal).toBe("local-only");
  });

  test("a helper discovered after capture cannot pass the mandatory post-capture census", async () => {
    const world = ownerWorld();
    const racedPath = resolve(
      world.root,
      "implementations/typescript/engine/scripts/lib/m3b-raced-helper.ts",
    );
    const importerPath = resolve(
      world.root,
      "implementations/typescript/engine/scripts/generate-compiled-parser.ts",
    );
    let raceInsertions = 0;
    const stdout: Uint8Array[] = [];
    const stderr: string[] = [];
    const exitCode = await runCompiledArtifactOwnerCli({
      artifact: ARTIFACT,
      repositoryRoot: world.root,
      args: ["--probe"],
      io: {
        stdout: (bytes) => stdout.push(bytes),
        stderr: (line) => stderr.push(line),
      },
      dependencies: {
        ...ownerDependencies(world),
        afterEvidenceCapture: () => {
          raceInsertions += 1;
          writeFileSync(racedPath, "export const raced = true;\n", { flag: "wx" });
          appendFileSync(importerPath, '\nimport "./lib/m3b-raced-helper";\n');
        },
      },
    });
    expect(exitCode).toBe(21);
    expect(raceInsertions).toBe(1);
    expect(stdout).toHaveLength(1);
    expect(parseArtifactFreshnessRecord(stdout[0]!)).toMatchObject({
      verdict: "UNDECIDABLE",
      portableSeal: "unresolved",
      reasons: ["owner-uncomputable"],
    });
    expect(new TextDecoder().decode(stdout[0]!)).toEndWith("\n");
    expect(stderr.join("\n")).not.toContain("M3b executable source is unclassified");
  });

  test("dependency and computed-acquisition failures emit one canonical UNDECIDABLE record", async () => {
    const toolchainBytes = new Uint8Array(readFileSync(resolve(LIVE_ROOT, TOOLCHAIN_PATH)));
    const manifest = decodeArtifactToolchainManifest(toolchainBytes);
    const environment = environmentFor(toolchainBytes, "windows");
    const acquired: AcquiredCompiledArtifactEnvironment = {
      manifest,
      bunExecutable: process.execPath,
      environment,
      environmentFingerprint: computeEnvironmentFingerprint(environment),
    };
    const run = async (capture: StableEpochCapture): Promise<ReturnType<typeof parseArtifactFreshnessRecord>> => {
      const stdout: Uint8Array[] = [];
      const exitCode = await runCompiledArtifactOwnerCli({
        artifact: ARTIFACT,
        repositoryRoot: LIVE_ROOT,
        args: ["--probe"],
        io: { stdout: (bytes) => stdout.push(bytes), stderr: () => {} },
        dependencies: {
          acquiredEnvironment: acquired,
          capture: async () => ({ ok: true, value: capture }),
          coldResolveDependencies: coldDependencyProof,
        },
      });
      expect(exitCode).toBe(21);
      expect(stdout).toHaveLength(1);
      expect(new TextDecoder().decode(stdout[0]!)).toEndWith("\n");
      return parseArtifactFreshnessRecord(stdout[0]!);
    };

    const dependencyCapture = minimalCapture(toolchainBytes);
    const packagePath = repositoryRelativePath("implementations/typescript/engine/package.json");
    const packageJson = JSON.parse(new TextDecoder().decode(dependencyCapture.bytes.read(packagePath))) as Record<string, unknown>;
    packageJson.dependencies = { surprise: "1.0.0" };
    expect(await run(replaceCapturedByte(
      dependencyCapture,
      packagePath,
      UTF8.encode(`${JSON.stringify(packageJson)}\n`),
    ))).toMatchObject({
      verdict: "UNDECIDABLE",
      reasons: ["dependency-uncomputable"],
    });

    const acquisitionCapture = await fullOwnerCapture();
    const workerPath = repositoryRelativePath(
      "implementations/typescript/engine/scripts/generate-compiled-parser-worker.ts",
    );
    const workerBytes = acquisitionCapture.bytes.read(workerPath);
    const computedImport = UTF8.encode(
      `${new TextDecoder().decode(workerBytes)}\nconst m3bComputed = "./computed"; await import(m3bComputed);\n`,
    );
    expect(await run(replaceCapturedByte(
      acquisitionCapture,
      workerPath,
      computedImport,
    ))).toMatchObject({
      verdict: "UNDECIDABLE",
      reasons: ["owner-uncomputable"],
    });
  }, 30_000);
});

function minimalCapture(toolchainBytes: Uint8Array): StableEpochCapture {
  const source = new Map<RepositoryRelativePath, Uint8Array>();
  for (const path of [
    "package.json",
    "implementations/typescript/engine/package.json",
    "bun.lock",
  ]) {
    source.set(repositoryRelativePath(path), new Uint8Array(readFileSync(resolve(LIVE_ROOT, path))));
  }
  const store: CapturedByteStore = {
    paths: Object.freeze([...source.keys()]),
    has: (path) => source.has(path),
    read: (path) => {
      const bytes = source.get(path);
      if (bytes === undefined) throw new Error(`missing fixture byte ${path}`);
      return new Uint8Array(bytes);
    },
  };
  const repository = digestByteManifest("repository", []);
  return {
    repositoryEpoch: repository.digest,
    repository,
    domains: [
      digestByteManifest(`owner-overlay:${ARTIFACT}`, []),
      oneRowManifest("envelope:compiled-artifact-environment", TOOLCHAIN_PATH, toolchainBytes),
      digestByteManifest("envelope:compiled-artifact-policy", []),
    ],
    bytes: store,
    dismissedChangeEvents: Object.freeze([]),
  };
}

function replaceCapturedByte(
  capture: StableEpochCapture,
  path: RepositoryRelativePath,
  bytes: Uint8Array,
): StableEpochCapture {
  if (!capture.bytes.has(path)) throw new Error(`fixture capture lacks ${path}`);
  return {
    ...capture,
    bytes: {
      paths: capture.bytes.paths,
      has: (candidate) => capture.bytes.has(candidate),
      read: (candidate) => candidate === path ? new Uint8Array(bytes) : capture.bytes.read(candidate),
    },
  };
}

async function fullOwnerCapture(): Promise<StableEpochCapture> {
  const captured = await captureStableEpoch({
    repositoryRoot: LIVE_ROOT,
    domains: [
      {
        kind: "owner-overlay",
        artifact: ARTIFACT,
        exactFiles: ownerOverlaySources(ARTIFACT).map(repositoryRelativePath),
      },
      {
        kind: "envelope",
        name: "compiled-artifact-environment",
        exactFiles: [repositoryRelativePath(TOOLCHAIN_PATH)],
      },
      {
        kind: "envelope",
        name: "compiled-artifact-policy",
        exactFiles: ATTESTATION_POLICY_PATHS.map(repositoryRelativePath),
      },
    ],
  });
  if (!captured.ok) throw new Error(`fixture capture failed: ${captured.issue.code}`);
  return captured.value;
}

describe("portable owner finalizer", () => {
  test("rejects every arity except exactly three", async () => {
    for (const count of [0, 1, 2, 4]) {
      await expect(mergeCompiledArtifactOwnerAttestations({
        repositoryRoot: LIVE_ROOT,
        artifact: ARTIFACT,
      }, Array.from({ length: count }, (_, index) => `missing-${index}.json`)))
        .rejects.toThrow("exactly three CI files");
    }
  });

  test("rejects local, duplicate/missing OS, mixed group/tuple, bad environment/base, and raw-Git mismatch", async () => {
    const world = ownerWorld();
    const base = baseCertificate(world);
    installPair(world, base);
    const valid = ciSet(world);
    const wrongRowEnvironment = {
      ...valid[1]!.environment,
      bun: { ...valid[1]!.environment.bun, toolchainRowDigest: hex("1") },
    };
    const wrongRow = validateCompiledArtifactCheckAttestation({
      ...valid[1]!,
      environment: wrongRowEnvironment,
      environmentFingerprint: computeEnvironmentFingerprint(wrongRowEnvironment),
    });
    const cases: readonly {
      readonly name: string;
      readonly entries?: readonly CompiledArtifactCheckAttestation[];
      readonly prepareError?: string;
      readonly rawRepositoryEpoch?: Sha256Hex;
      readonly expected: string | RegExp;
    }[] = [
      {
        name: "local origin",
        entries: [{ ...valid[0]!, origin: { kind: "local" } }, valid[1]!, valid[2]!],
        expected: "accepts CI attestations only",
      },
      {
        name: "duplicate and missing OS",
        entries: [valid[0]!, valid[1]!, {
          ...valid[2]!,
          environment: {
            ...valid[1]!.environment,
            bun: { ...valid[1]!.environment.bun, webkitVersion: "duplicate-linux-family" },
          },
          environmentFingerprint: computeEnvironmentFingerprint({
            ...valid[1]!.environment,
            bun: { ...valid[1]!.environment.bun, webkitVersion: "duplicate-linux-family" },
          }),
        }],
        expected: "repeats OS family linux",
      },
      {
        name: "mixed commit",
        entries: [valid[0]!, { ...valid[1]!, origin: { ...CI_ORIGIN, sourceCommit: "a".repeat(40) } }, valid[2]!],
        expected: /mixed workflow runs|does not bind the current Git\/package\/base tuple/u,
      },
      {
        name: "mixed workflow",
        entries: [valid[0]!, { ...valid[1]!, origin: { ...CI_ORIGIN, workflowDigest: hex("1") } }, valid[2]!],
        expected: /mixed workflow runs|does not bind the current Git\/package\/base tuple/u,
      },
      {
        name: "mixed run",
        entries: [valid[0]!, { ...valid[1]!, origin: { ...CI_ORIGIN, workflowRunId: "99" } }, valid[2]!],
        expected: "mixed workflow runs",
      },
      {
        name: "mixed attempt",
        entries: [valid[0]!, { ...valid[1]!, origin: { ...CI_ORIGIN, workflowRunAttempt: 2 } }, valid[2]!],
        expected: "mixed workflow runs",
      },
      {
        name: "wrong package",
        entries: [valid[0]!, { ...valid[1]!, checkPackageDigest: hex("1") }, valid[2]!],
        expected: "does not bind the current Git/package/base tuple",
      },
      {
        name: "wrong policy",
        entries: [valid[0]!, { ...valid[1]!, attestationPolicyDigest: hex("1") }, valid[2]!],
        expected: "does not bind the current Git/package/base tuple",
      },
      {
        name: "wrong base",
        entries: [valid[0]!, { ...valid[1]!, certificateBaseDigest: hex("1") }, valid[2]!],
        expected: "does not bind the current Git/package/base tuple",
      },
      {
        name: "bad environment",
        entries: [valid[0]!, {
          ...valid[1]!,
          environment: {
            ...valid[1]!.environment,
            bun: { ...valid[1]!.environment.bun, executableDigest: hex("1") },
          },
          environmentFingerprint: computeEnvironmentFingerprint({
            ...valid[1]!.environment,
            bun: { ...valid[1]!.environment.bun, executableDigest: hex("1") },
          }),
        }, valid[2]!],
        expected: "does not match the packaged toolchain contract",
      },
      {
        name: "forged Bun toolchain row",
        entries: [valid[0]!, wrongRow, valid[2]!],
        expected: "does not match the packaged toolchain contract",
      },
      {
        name: "raw-Git identity mismatch",
        rawRepositoryEpoch: hex("1"),
        expected: "raw Git package does not equal the current stable owner evidence",
      },
      {
        name: "dirty raw-Git reconstruction",
        prepareError: "covered worktree is dirty",
        expected: "covered worktree is dirty",
      },
    ];

    for (const fixture of cases) {
      const entries = fixture.entries ?? valid;
      const paths = writeAttestationFiles(world, entries);
      const beforeArtifact = readFileSync(resolve(world.root, ...ARTIFACT_PATH.split("/")));
      await expect(mergeCompiledArtifactOwnerAttestations({
        repositoryRoot: world.root,
        artifact: ARTIFACT,
      }, paths, {
        ...ownerDependencies(world),
        ...(fixture.prepareError === undefined ? {} : {
          prepareCheckPackage: () => { throw new Error(fixture.prepareError); },
        }),
        ...(fixture.rawRepositoryEpoch === undefined ? {} : {
          prepareCheckPackage: () => {
            const metadata = metadataFor(world, {
              kind: "git-object",
              sourceCommit: SOURCE_COMMIT,
              workflowDigest: world.evidence.workflowDigest,
            });
            return prepared({ ...metadata, repositoryEpoch: fixture.rawRepositoryEpoch! });
          },
        }),
      })).rejects.toThrow(fixture.expected);
      expect(readFileSync(resolve(world.root, ...ARTIFACT_PATH.split("/"))), fixture.name)
        .toEqual(beforeArtifact);
    }
  }, 15_000);

  test("valid exact family replaces old evidence, is sidecar-only/idempotent, and post-probes sealed", async () => {
    const world = ownerWorld();
    const base = baseCertificate(world);
    const oldLocal = attestation({
      world,
      certificate: base,
      origin: { kind: "local" },
      environment: world.evidence.environment,
      metadata: metadataFor(world, { kind: "stable-live" }),
      policyDigest: hex("0"),
    });
    const oldCiOrigin = { ...CI_ORIGIN, workflowRunId: "1" };
    const oldCi = attestation({
      world,
      certificate: base,
      origin: oldCiOrigin,
      environment: world.evidence.environment,
      metadata: metadataFor(world, {
        kind: "git-object",
        sourceCommit: oldCiOrigin.sourceCommit,
        workflowDigest: oldCiOrigin.workflowDigest,
      }),
      policyDigest: hex("0"),
    });
    installPair(world, certificateWith(base, [oldLocal, oldCi]));
    const artifactBefore = readFileSync(resolve(world.root, ...ARTIFACT_PATH.split("/")));
    const files = writeAttestationFiles(world, ciSet(world));
    const dependencies = ownerDependencies(world);

    await mergeCompiledArtifactOwnerAttestations({
      repositoryRoot: world.root,
      artifact: ARTIFACT,
    }, files, dependencies);
    const firstSidecar = readFileSync(resolve(
      world.root,
      ...COMPILED_ARTIFACT_SPECS[ARTIFACT].certificatePath.split("/"),
    ));
    const firstPair = readArtifactPair(world.root, ARTIFACT);
    expect(firstPair.artifactBytes).toEqual(artifactBefore);
    expect(firstPair.certificate.producerAttestations).toEqual(
      canonicalizeProducerAttestations(ciSet(world)),
    );
    expect(firstPair.certificate.producerAttestations.every((entry) => entry.origin.kind === "ci")).toBe(true);
    const post = await probeCompiledArtifactOwner({
      repositoryRoot: world.root,
      artifact: ARTIFACT,
    }, dependencies);
    expect(post.verdict).toBe("FRESH");
    expect(post.portableSeal).toBe("sealed");

    await mergeCompiledArtifactOwnerAttestations({
      repositoryRoot: world.root,
      artifact: ARTIFACT,
    }, files, dependencies);
    expect(readFileSync(resolve(world.root, ...ARTIFACT_PATH.split("/")))).toEqual(artifactBefore);
    expect(readFileSync(resolve(
      world.root,
      ...COMPILED_ARTIFACT_SPECS[ARTIFACT].certificatePath.split("/"),
    ))).toEqual(firstSidecar);
  });
});

describe("owner transaction and CLI epoch binding", () => {
  test("a live full check executes the cold dependency proof across its A/B evidence captures", async () => {
    const world = ownerWorld();
    const capture = await fullOwnerCapture();
    installPair(world, baseCertificate(world));
    let coldProofs = 0;
    const checked = await checkCompiledArtifactOwner({
      repositoryRoot: world.root,
      artifact: ARTIFACT,
      emitAttestation: false,
    }, {
      acquiredEnvironment: world.acquired,
      capture: async () => ({ ok: true, value: capture }),
      coldResolveDependencies: async (input) => {
        coldProofs += 1;
        return coldDependencyProof(input);
      },
      render: async () => ({
        artifact: ARTIFACT,
        bytes: world.artifactBytes,
        stdout: new Uint8Array(),
        stderr: new Uint8Array(),
        traceBytes: new Uint8Array(),
        elapsedMs: 1,
      }),
    });
    expect(checked.matches).toBe(true);
    expect(coldProofs).toBe(2);
  }, 30_000);

  test("fresh repair retains the pair after two captures without rendering or publication", async () => {
    const world = ownerWorld();
    const base = baseCertificate(world);
    const local = attestation({
      world,
      certificate: base,
      origin: { kind: "local" },
      environment: world.evidence.environment,
      metadata: metadataFor(world, { kind: "stable-live" }),
    });
    installPair(world, certificateWith(base, [local]));
    const spec = COMPILED_ARTIFACT_SPECS[ARTIFACT];
    const artifactPath = resolve(world.root, ...spec.artifactPath.split("/"));
    const certificatePath = resolve(world.root, ...spec.certificatePath.split("/"));
    const beforeArtifact = readFileSync(artifactPath);
    const beforeCertificate = readFileSync(certificatePath);
    let captures = 0;
    const repaired = await repairCompiledArtifactOwner({
      repositoryRoot: world.root,
      artifact: ARTIFACT,
      expectedRepositoryEpoch: world.evidence.repositoryEpoch,
    }, {
      ...ownerDependencies(world),
      afterEvidenceCapture: () => { captures += 1; },
      render: async () => { throw new Error("fresh repair must not render"); },
      independentCheck: async () => { throw new Error("fresh repair must not independently check"); },
    });
    expect(captures).toBe(2);
    expect(repaired.record.verdict).toBe("FRESH");
    expect(repaired.trace).toEqual({
      schema: "fenel.compiled-artifact-owner-trace.v1",
      artifact: ARTIFACT,
      branch: "compare-first-equal",
      renders: 0,
      artifactPublications: 0,
      attestationMerges: 0,
      postProbes: 0,
    });
    expect(readFileSync(artifactPath)).toEqual(beforeArtifact);
    expect(readFileSync(certificatePath)).toEqual(beforeCertificate);
  });

  test("writer publication invokes exactly one independent public check seam", async () => {
    const world = ownerWorld();
    let renders = 0;
    let independentChecks = 0;
    const repaired = await repairCompiledArtifactOwner({
      repositoryRoot: world.root,
      artifact: ARTIFACT,
    }, {
      ...ownerDependencies(world),
      render: async () => {
        renders += 1;
        return {
          artifact: ARTIFACT,
          bytes: world.artifactBytes,
          stdout: new Uint8Array(),
          stderr: new Uint8Array(),
          traceBytes: new Uint8Array(),
          elapsedMs: 1,
        };
      },
      independentCheck: async () => {
        independentChecks += 1;
        const pair = readArtifactPair(world.root, ARTIFACT);
        return attestation({
          world,
          certificate: pair.certificate,
          origin: { kind: "local" },
          environment: world.evidence.environment,
          metadata: metadataFor(world, { kind: "stable-live" }),
        });
      },
    });
    expect(renders).toBe(1);
    expect(independentChecks).toBe(1);
    expect(repaired.trace).toMatchObject({
      branch: "writer-needed",
      renders: 2,
      artifactPublications: 1,
      attestationMerges: 1,
      postProbes: 1,
    });
    expect(repaired.record.verdict).toBe("FRESH");
  });

  test("uncomputable repair performs zero render, publication, merge, or post-probe work", async () => {
    const world = ownerWorld();
    const spec = COMPILED_ARTIFACT_SPECS[ARTIFACT];
    const artifactPath = resolve(world.root, ...spec.artifactPath.split("/"));
    const certificatePath = resolve(world.root, ...spec.certificatePath.split("/"));
    const lifecycle: string[] = [];
    let renders = 0;
    let independentChecks = 0;

    await expect(repairCompiledArtifactOwner({
      repositoryRoot: world.root,
      artifact: ARTIFACT,
    }, {
      ...ownerDependencies(world),
      afterEvidenceCapture: () => {
        lifecycle.push("initial-capture:uncomputable");
        throw new Error("injected owner evidence failure");
      },
      render: async () => {
        renders += 1;
        throw new Error("uncomputable repair must not render");
      },
      independentCheck: async () => {
        independentChecks += 1;
        throw new Error("uncomputable repair must not independently check");
      },
    })).rejects.toThrow("repair input is uncomputable: owner-uncomputable");

    expect(lifecycle).toEqual(["initial-capture:uncomputable"]);
    expect(renders).toBe(0);
    expect(independentChecks).toBe(0);
    expect(existsSync(artifactPath)).toBe(false);
    expect(existsSync(certificatePath)).toBe(false);
  });

  test("repair refuses a mismatched expected epoch before any render or publication", async () => {
    const world = ownerWorld();
    await expect(repairCompiledArtifactOwner({
      repositoryRoot: world.root,
      artifact: ARTIFACT,
      expectedRepositoryEpoch: hex("f"),
    }, {
      ...ownerDependencies(world),
      render: async () => { throw new Error("wrong-epoch repair must not render"); },
      independentCheck: async () => { throw new Error("wrong-epoch repair must not independently check"); },
    })).rejects.toThrow("repair input is uncomputable: concurrent-mutation");
    const spec = COMPILED_ARTIFACT_SPECS[ARTIFACT];
    expect(existsSync(resolve(world.root, ...spec.artifactPath.split("/")))).toBe(false);
    expect(existsSync(resolve(world.root, ...spec.certificatePath.split("/")))).toBe(false);
  });

  test("compare-first equal renders once, merges one equivalent attestation, and never publishes", async () => {
    const world = ownerWorld();
    const base = baseCertificate(world);
    installPair(world, base);
    const lifecycle: string[] = [];
    let renders = 0;
    let independentChecks = 0;
    const capturePairState = (): void => {
      const pair = readArtifactPair(world.root, ARTIFACT);
      const generation = pair.artifactDigest === sha256Bytes(world.artifactBytes) ? "existing" : "unexpected";
      lifecycle.push(`capture:${generation}:${pair.certificate.producerAttestations.length}`);
    };

    const repaired = await repairCompiledArtifactOwner({
      repositoryRoot: world.root,
      artifact: ARTIFACT,
    }, {
      ...ownerDependencies(world),
      afterEvidenceCapture: capturePairState,
      progress: (stage, detail) => lifecycle.push(`progress:${stage}:${detail}`),
      render: async () => {
        renders += 1;
        lifecycle.push("render:compare-first");
        return {
          artifact: ARTIFACT,
          bytes: world.artifactBytes,
          stdout: new Uint8Array(),
          stderr: new Uint8Array(),
          traceBytes: new Uint8Array(),
          elapsedMs: 1,
        };
      },
      independentCheck: async () => {
        independentChecks += 1;
        throw new Error("equal compare-first branch must not launch an independent check");
      },
    });

    expect(renders).toBe(1);
    expect(independentChecks).toBe(0);
    expect(repaired.trace).toEqual({
      schema: "fenel.compiled-artifact-owner-trace.v1",
      artifact: ARTIFACT,
      branch: "compare-first-equal",
      renders: 1,
      artifactPublications: 0,
      attestationMerges: 1,
      postProbes: 1,
    });
    expect(lifecycle).toEqual([
      "capture:existing:0",
      "capture:existing:0",
      "progress:render:compare-first candidate",
      "render:compare-first",
      "capture:existing:0",
      "capture:existing:0",
      "capture:existing:0",
      "capture:existing:1",
      "capture:existing:1",
      "capture:existing:1",
    ]);
    const pair = readArtifactPair(world.root, ARTIFACT);
    const expectedAttestation = attestation({
      world,
      certificate: base,
      origin: { kind: "local" },
      environment: world.evidence.environment,
      metadata: metadataFor(world, { kind: "stable-live" }),
    });
    expect(Buffer.from(pair.artifactBytes).equals(Buffer.from(world.artifactBytes))).toBe(true);
    expect(computeCertificateBaseDigest(pair.certificate)).toBe(computeCertificateBaseDigest(base));
    expect(pair.certificate.producerAttestations).toEqual([expectedAttestation]);
    expect(repaired.record.verdict).toBe("FRESH");
  });

  test("compare-first different publishes its first candidate once before one independent check", async () => {
    const world = ownerWorld();
    installPair(world, baseCertificate(world));
    const candidateBytes = UTF8.encode("// different compiled parser owner fixture\n");
    const existingDigest = sha256Bytes(world.artifactBytes);
    const candidateDigest = sha256Bytes(candidateBytes);
    const lifecycle: string[] = [];
    let renders = 0;
    let independentChecks = 0;
    const pairState = (): string => {
      try {
        const pair = readArtifactPair(world.root, ARTIFACT);
        const generation = pair.artifactDigest === existingDigest
          ? "existing"
          : pair.artifactDigest === candidateDigest
          ? "candidate"
          : "unexpected";
        return `${generation}:${pair.certificate.producerAttestations.length}`;
      } catch {
        return "no-pair";
      }
    };

    const repaired = await repairCompiledArtifactOwner({
      repositoryRoot: world.root,
      artifact: ARTIFACT,
    }, {
      ...ownerDependencies(world),
      afterEvidenceCapture: () => {
        lifecycle.push(`capture:${pairState()}`);
      },
      progress: (stage, detail) => lifecycle.push(`progress:${stage}:${detail}`),
      render: async () => {
        renders += 1;
        lifecycle.push("render:first-candidate");
        return {
          artifact: ARTIFACT,
          bytes: candidateBytes,
          stdout: new Uint8Array(),
          stderr: new Uint8Array(),
          traceBytes: new Uint8Array(),
          elapsedMs: 1,
        };
      },
      independentCheck: async () => {
        independentChecks += 1;
        lifecycle.push(`independent-check:${pairState()}`);
        const pair = readArtifactPair(world.root, ARTIFACT);
        expect(Buffer.from(pair.artifactBytes).equals(Buffer.from(candidateBytes))).toBe(true);
        expect(pair.certificate.producerAttestations).toEqual([]);
        return attestation({
          world,
          certificate: pair.certificate,
          origin: { kind: "local" },
          environment: world.evidence.environment,
          metadata: metadataFor(world, { kind: "stable-live" }, candidateBytes),
          artifactBytes: candidateBytes,
        });
      },
    });

    expect(renders).toBe(1);
    expect(independentChecks).toBe(1);
    expect(repaired.trace).toEqual({
      schema: "fenel.compiled-artifact-owner-trace.v1",
      artifact: ARTIFACT,
      branch: "compare-first-different",
      renders: 2,
      artifactPublications: 1,
      attestationMerges: 1,
      postProbes: 1,
    });
    expect(lifecycle).toEqual([
      "capture:existing:0",
      "capture:existing:0",
      "progress:render:compare-first candidate",
      "render:first-candidate",
      "capture:existing:0",
      "capture:existing:0",
      "capture:no-pair",
      "capture:candidate:0",
      "progress:render:fresh-process public post-publication check",
      "independent-check:candidate:0",
      "capture:candidate:0",
      "capture:candidate:0",
      "capture:candidate:0",
      "capture:candidate:1",
      "capture:candidate:1",
      "capture:candidate:1",
    ]);
    const pair = readArtifactPair(world.root, ARTIFACT);
    expect(Buffer.from(pair.artifactBytes).equals(Buffer.from(candidateBytes))).toBe(true);
    expect(pair.certificate.producerAttestations).toHaveLength(1);
    expect(pair.certificate.producerAttestations[0]?.artifactDigest).toBe(candidateDigest);
    expect(repaired.record.verdict).toBe("FRESH");
  });

  test("independent checks inherit only the fixed owner contract and Windows launch keys", () => {
    const environment = compiledArtifactIndependentCheckEnvironment({
      ComSpec: "C:\\Windows\\System32\\cmd.exe",
      FENEL_AMBIENT_SENTINEL: "must-not-leak",
      FENEL_PARSE_CACHE: "9",
      GITHUB_ACTIONS: "true",
      GITHUB_TOKEN: "must-not-leak",
      PATH: "C:\\ambient-bin",
      SystemDrive: "C:",
      SystemRoot: "C:\\Windows",
      windir: "C:\\Windows",
    }, "win32");
    expect(environment).toEqual({
      COMSPEC: "C:\\Windows\\System32\\cmd.exe",
      FENEL_PARSE_CACHE: "0",
      FENEL_PARSER_INTERPRETED: "1",
      FENEL_PARSER_LEGACY: "1",
      FENEL_RESOLVER_INTERPRETED: "1",
      LANG: "C",
      LC_ALL: "C",
      NODE_ENV: "production",
      SYSTEMDRIVE: "C:",
      SYSTEMROOT: "C:\\Windows",
      TZ: "UTC",
      WINDIR: "C:\\Windows",
    });
    expect(Object.keys(environment).some((name) => name.startsWith("GITHUB_"))).toBe(false);
    expect(environment.FENEL_AMBIENT_SENTINEL).toBeUndefined();
    expect(environment.PATH).toBeUndefined();
    expect(() => compiledArtifactIndependentCheckEnvironment({}, "win32"))
      .toThrow("required COMSPEC");
  });

  test("post-publication verification launches the public controller in a fresh child", () => {
    const ownerSource = readFileSync(new URL("./compiled-artifact-owner.ts", import.meta.url), "utf8");
    const start = ownerSource.indexOf("async function freshPublicIndependentCheck(");
    const end = ownerSource.indexOf("export async function checkCompiledArtifactOwner(", start);
    expect(start).toBeGreaterThan(-1);
    expect(end).toBeGreaterThan(start);
    const boundary = ownerSource.slice(start, end);
    expect(boundary).toContain("const child = Bun.spawn([");
    expect(boundary).toContain("evidence.bunExecutable");
    expect(boundary).toContain("`implementations/typescript/engine/scripts/generate-${options.artifact}.ts`");
    expect(boundary).toContain('"--no-env-file"');
    expect(boundary).toContain('"--no-install"');
    expect(boundary).toContain('"--check"');
    expect(boundary).toContain('"--emit-attestation"');
    expect(boundary).toContain("env: compiledArtifactIndependentCheckEnvironment(),");
    expect(boundary).toContain("parseCompiledArtifactCheckAttestation(stdout)");
    expect(boundary).not.toContain("...process.env");
    expect(boundary).not.toContain("renderSnapshot(");

    const controllers = (["compiled-parser", "compiled-resolver"] as const).map((artifact) =>
      resolve(LIVE_ROOT, `implementations/typescript/engine/scripts/generate-${artifact}.ts`)
    );
    for (const controller of controllers) {
      const source = readFileSync(controller, "utf8");
      expect(source).toContain('from "./lib/compiled-artifact-owner"');
      expect(source).toContain("if (import.meta.main) process.exitCode = await main();");
      expect(source).not.toMatch(/from ["'][^"']*\/src\//u);
    }
    const program = `
      const parser = await import(${JSON.stringify(pathToFileURL(controllers[0]!).href)});
      const resolver = await import(${JSON.stringify(pathToFileURL(controllers[1]!).href)});
      process.stdout.write(JSON.stringify([typeof parser.main, typeof resolver.main]));
    `;
    const child = Bun.spawnSync({
      cmd: [process.execPath, "--no-env-file", "--no-install", "-e", program],
      cwd: LIVE_ROOT,
      stdin: "ignore",
      stdout: "pipe",
      stderr: "pipe",
    });
    expect(child.exitCode, child.stderr.toString()).toBe(0);
    expect(child.stdout.toString()).toBe('["function","function"]');
  });

  test("detached package checks await the same mandatory cold dependency boundary", () => {
    const ownerSource = readFileSync(new URL("./compiled-artifact-owner.ts", import.meta.url), "utf8");
    const packageStart = ownerSource.indexOf("async function packageEvidence(");
    const packageEnd = ownerSource.indexOf("function packageOrigin(", packageStart);
    const checkStart = ownerSource.indexOf("export async function checkCompiledArtifactOwner(");
    const checkEnd = ownerSource.indexOf("export async function repairCompiledArtifactOwner(", checkStart);
    expect(packageStart).toBeGreaterThan(-1);
    expect(packageEnd).toBeGreaterThan(packageStart);
    expect(checkStart).toBeGreaterThan(packageEnd);
    expect(checkEnd).toBeGreaterThan(checkStart);
    const packageBoundary = ownerSource.slice(packageStart, packageEnd);
    const checkBoundary = ownerSource.slice(checkStart, checkEnd);
    expect(packageBoundary).toContain(
      "dependencies.coldResolveDependencies ?? coldResolveEmptyCompiledArtifactDependencies",
    );
    expect(packageBoundary).toContain("bunExecutableSha256: acquired.environment.bun.executableDigest");
    expect(packageBoundary).toContain(
      "expectedDependencyManifestBytes: dependencyManifestBytes",
    );
    expect(checkBoundary).toContain(
      "const evidence = await packageEvidence(options, captured, acquired, dependencies);",
    );
  });

  test("probe accepts one expected epoch, binds it, and keeps other modes closed", async () => {
    const toolchainBytes = new Uint8Array(readFileSync(resolve(LIVE_ROOT, TOOLCHAIN_PATH)));
    const environment = environmentFor(toolchainBytes, "windows");
    const manifest = decodeArtifactToolchainManifest(toolchainBytes);
    const acquired: AcquiredCompiledArtifactEnvironment = {
      manifest,
      bunExecutable: process.execPath,
      environment,
      environmentFingerprint: computeEnvironmentFingerprint(environment),
    };
    const capture = minimalCapture(toolchainBytes);
    const stdout: Uint8Array[] = [];
    const expected = hex("f");
    const exitCode = await runCompiledArtifactOwnerCli({
      artifact: ARTIFACT,
      repositoryRoot: LIVE_ROOT,
      args: ["--probe", `--expected-repository-epoch=${expected}`],
      io: { stdout: (bytes) => stdout.push(bytes), stderr: () => {} },
      dependencies: {
        acquiredEnvironment: acquired,
        capture: async () => ({ ok: true, value: capture }),
        coldResolveDependencies: coldDependencyProof,
      },
    });
    expect(exitCode).toBe(21);
    expect(parseArtifactFreshnessRecord(stdout[0]!).verdict).toBe("UNDECIDABLE");
    expect(nonFreshReasons(parseArtifactFreshnessRecord(stdout[0]!))).toEqual(["concurrent-mutation"]);

    for (const args of [
      ["--probe", "--expected-repository-epoch=bad"],
      ["--probe", `--expected-repository-epoch=${expected}`, `--expected-repository-epoch=${expected}`],
      ["--check", `--expected-repository-epoch=${expected}`],
      ["--merge-attestations", "a", "b", "c", `--expected-repository-epoch=${expected}`],
    ]) {
      const code = await runCompiledArtifactOwnerCli({
        artifact: ARTIFACT,
        repositoryRoot: LIVE_ROOT,
        args,
        io: { stdout: () => {}, stderr: () => {} },
      });
      expect(code, args.join(" ")).toBe(2);
    }
  });
});
