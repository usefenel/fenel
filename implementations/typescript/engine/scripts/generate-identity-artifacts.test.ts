import { describe, expect, test } from "bun:test";
import { existsSync, readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { encodeCanonicalJson } from "./lib/artifact-wire-json";
import type { Sha256Hex as ByteSha256Hex } from "./lib/artifact-bytes";
import {
  ARTIFACT_FRESHNESS_SCHEMA,
  OWNER_PROBE_EXIT_CODES,
  type ArtifactFreshnessRecord,
  type FreshArtifactRecord,
  type StaleArtifactRecord,
} from "./lib/compiled-artifact-protocol";
import type {
  CompiledArtifactCheckAttestation,
  CompiledArtifactId,
  Sha256Hex,
} from "./lib/compiled-artifact-attestation";
import {
  LEGACY_STAMPLESS_TOMBSTONE_DIGEST,
  MATRIX_NO_FAILURE_DIGEST,
  UNAVAILABLE_MATRIX_IDENTITY_DIGEST,
  encodeMatrixControllerReceipt,
  makeMatrixControllerReceipt,
  matrixFailureDigest,
  type MatrixArtifactIdentity,
  type MatrixDecision,
  type MatrixMode,
  type MatrixReceiptOperation,
  type MatrixResult,
  type MatrixStampClass,
} from "./lib/self-host-matrix-certificate";
import {
  IDENTITY_ARTIFACT_PHASE_DECLARATION,
  assertCrossOwnerSealedCiRuns,
  parseIdentityArtifactDriverOptions,
  runIdentityArtifactDriver,
  selectFinalEnvelopeProducerCoordinates,
  type FreshChildRequest,
  type IdentityArtifactDriverDependencies,
  type IdentityArtifactDriverOptions,
  type IdentityArtifactFinalEnvelope,
  type IdentityArtifactPhaseName,
  type PortableCiAttestationCoordinate,
  type PortableCiRun,
} from "./generate-identity-artifacts";

const HERE = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = resolve(HERE, "../../../..");
const ARTIFACTS = [
  "implementations/typescript/engine/src/generated/parser-bootstrap.generated.ts",
  "implementations/typescript/engine/src/generated/parse-cache.generated.ts",
  "implementations/typescript/engine/src/generated/repository-identity-manifest.json",
  "implementations/typescript/engine/src/generated/repository-field-catalog.json",
  "implementations/typescript/engine/src/generated/compiled-resolver.generated.ts",
  "implementations/typescript/engine/src/generated/compiled-parser.generated.ts",
  "implementations/typescript/engine/src/generated/compiled-resolver.build-certificate.json",
  "implementations/typescript/engine/src/generated/compiled-parser.build-certificate.json",
  "implementations/typescript/engine/src/generated/signature-honesty-claims.json",
] as const;

const hex = (digit: string): Sha256Hex => digit.repeat(64) as Sha256Hex;
const byteHex = (digit: string): ByteSha256Hex => digit.repeat(64) as ByteSha256Hex;
const REPOSITORY_EPOCH = hex("1");
const PORTABLE_RUN: PortableCiRun = Object.freeze({
  sourceCommit: "candidate-sha",
  workflowDigest: hex("a"),
  workflowRunId: "4242",
  workflowRunAttempt: 1,
});

function fresh(artifact: CompiledArtifactId): FreshArtifactRecord {
  const parser = artifact === "compiled-parser";
  return {
    schema: ARTIFACT_FRESHNESS_SCHEMA,
    artifact,
    verdict: "FRESH",
    portableSeal: "sealed",
    repositoryEpoch: REPOSITORY_EPOCH,
    ownerEpoch: hex(parser ? "2" : "3"),
    dependencyDigest: hex("4"),
    environmentFingerprint: hex("5"),
    artifactDigest: hex(parser ? "6" : "7"),
    certificateDigest: hex(parser ? "8" : "9"),
    attestationPolicyDigest: hex("a"),
    inputKey: hex("b"),
    currentSourceArchiveDigest: hex("c"),
    sourceRelation: "same-epoch",
    producer: {
      repositoryEpoch: REPOSITORY_EPOCH,
      ownerEpoch: hex(parser ? "2" : "3"),
      coveredSourceArchiveDigest: hex("c"),
      inputKey: hex("b"),
      environmentFingerprint: hex("5"),
    },
  };
}

function stale(artifact: CompiledArtifactId): StaleArtifactRecord {
  return {
    schema: ARTIFACT_FRESHNESS_SCHEMA,
    artifact,
    verdict: "STALE",
    portableSeal: "unsealed",
    reasons: ["artifact-missing"],
    repositoryEpoch: REPOSITORY_EPOCH,
    attestationPolicyDigest: hex("a"),
  };
}

const options = (
  matrix: IdentityArtifactDriverOptions["matrix"] = "automatic",
): IdentityArtifactDriverOptions => ({
  repositoryRoot: "E:/fixture/fenel",
  matrix,
});

type HarnessOptions = {
  readonly minted?: readonly { readonly name: string; readonly kind: string }[];
  readonly repairResult?: Partial<Record<
    CompiledArtifactId,
    ArtifactFreshnessRecord
      | "empty"
      | "exit-disagreement"
      | "extra-record"
      | "invalid-utf8"
      | "malformed"
      | "signal-exit"
      | "spawn-error"
      | "truncated"
      | "unknown-exit"
      | "wrong-owner"
  >>;
  readonly finalProbe?: Partial<Record<CompiledArtifactId, FreshArtifactRecord>>;
  readonly acquisitionPreflight?: HarnessOptions["repairResult"];
  readonly matrixExitCode?: number;
  readonly matrixResult?: MatrixResult;
  readonly envelopeDigests?: readonly Sha256Hex[];
  readonly failPhase?: IdentityArtifactPhaseName;
};

function harness(config: HarnessOptions = {}): {
  readonly dependencies: IdentityArtifactDriverDependencies;
  readonly trace: string[];
  readonly children: FreshChildRequest[];
} {
  const trace: string[] = [];
  const children: FreshChildRequest[] = [];
  let envelopeCount = 0;
  let clock = 0;
  const phaseFailure = (phase: IdentityArtifactPhaseName): void => {
    if (config.failPhase === phase) throw new Error(`${phase} fixture failure`);
  };
  const ownerArtifact = (request: FreshChildRequest): CompiledArtifactId | undefined =>
    request.script === "generate-compiled-resolver.ts"
      ? "compiled-resolver"
        : request.script === "generate-compiled-parser.ts"
          ? "compiled-parser"
          : undefined;
  const matrixReceipt = (request: FreshChildRequest): Uint8Array => {
    const exitCode = config.matrixExitCode ?? 0;
    const result = config.matrixResult
      ?? (request.args.includes("--no-matrix")
        ? "SKIPPED_EXPLICIT"
        : exitCode === 21
          ? "UNDECIDABLE"
          : exitCode === 20
            ? "DUE"
            : exitCode === 1
            ? "REPAIR_FAILED"
            : "FRESH");
    const absentIdentity = Object.freeze({ kind: "absent" as const });
    const artifactIdentity: MatrixArtifactIdentity = Object.freeze({
      kind: "present" as const,
      byteLength: 1,
      digest: byteHex("d"),
    });
    const candidateIdentity: MatrixArtifactIdentity = Object.freeze({
      kind: "present" as const,
      byteLength: 2,
      digest: byteHex("e"),
    });
    type ReceiptRelation = {
      readonly evidence: "complete" | "unavailable";
      readonly mode: MatrixMode;
      readonly operation: MatrixReceiptOperation;
      readonly decision: MatrixDecision;
      readonly stampClass: MatrixStampClass;
      readonly publication: {
        readonly published: boolean;
        readonly before: MatrixArtifactIdentity;
        readonly candidate: MatrixArtifactIdentity;
        readonly after: MatrixArtifactIdentity;
      };
    };
    const relation = (() : ReceiptRelation => {
      const preserved = (
        candidate: MatrixArtifactIdentity = absentIdentity,
      ): ReceiptRelation["publication"] => ({
        published: false,
        before: artifactIdentity,
        candidate,
        after: artifactIdentity,
      });
      const unavailable = (
        operation: MatrixReceiptOperation,
        decision: MatrixDecision,
      ): ReceiptRelation => ({
        evidence: "unavailable",
        mode: "required-v1",
        operation,
        decision,
        stampClass: "absent",
        publication: {
          published: false,
          before: absentIdentity,
          candidate: absentIdentity,
          after: absentIdentity,
        },
      });
      switch (result) {
        case "FRESH":
        case "DUE":
          return {
            evidence: "complete",
            mode: "required-v1",
            operation: "decide",
            decision: result,
            stampClass: "valid",
            publication: preserved(),
          };
        case "VERIFIED_FOREIGN":
        case "VERIFIED_FOREIGN_DUE":
          return {
            evidence: "complete",
            mode: "required-v1",
            operation: "decide",
            decision: result,
            stampClass: "valid",
            publication: preserved(candidateIdentity),
          };
        case "SKIPPED_LEGACY":
          return {
            evidence: "complete",
            mode: "legacy-stampless",
            operation: "decide",
            decision: result,
            stampClass: "absent",
            publication: preserved(),
          };
        case "LEGACY_REPAIRED":
          return {
            evidence: "complete",
            mode: "legacy-stampless",
            operation: "decide",
            decision: "LEGACY_DUE",
            stampClass: "absent",
            publication: {
              published: true,
              before: artifactIdentity,
              candidate: candidateIdentity,
              after: candidateIdentity,
            },
          };
        case "REPAIRED":
          return {
            evidence: "complete",
            mode: "required-v1",
            operation: "decide",
            decision: "REPAIR_REQUIRED",
            stampClass: "valid",
            publication: {
              published: true,
              before: artifactIdentity,
              candidate: candidateIdentity,
              after: candidateIdentity,
            },
          };
        case "REPAIR_FAILED":
          return {
            evidence: "complete",
            mode: "required-v1",
            operation: "decide",
            decision: "REPAIR_REQUIRED",
            stampClass: "valid",
            publication: preserved(candidateIdentity),
          };
        case "CHECK_FAILED":
        case "CHECK_OK":
          return {
            evidence: "complete",
            mode: "legacy-stampless",
            operation: "check",
            decision: "CHECK_REQUIRED",
            stampClass: "valid",
            publication: preserved(result === "CHECK_OK" ? candidateIdentity : absentIdentity),
          };
        case "CHECK_REQUIRED":
          return {
            evidence: "complete",
            mode: "legacy-stampless",
            operation: "probe",
            decision: result,
            stampClass: "valid",
            publication: preserved(),
          };
        case "LEGACY_DUE":
          return {
            evidence: "complete",
            mode: "legacy-stampless",
            operation: "probe",
            decision: result,
            stampClass: "absent",
            publication: {
              published: false,
              before: absentIdentity,
              candidate: absentIdentity,
              after: absentIdentity,
            },
          };
        case "DUE_UNTRUSTED":
        case "REPAIR_REQUIRED":
          return {
            evidence: "complete",
            mode: "required-v1",
            operation: result === "DUE_UNTRUSTED" ? "decide" : "probe",
            decision: result,
            stampClass: "absent",
            publication: {
              published: false,
              before: absentIdentity,
              candidate: absentIdentity,
              after: absentIdentity,
            },
          };
        case "SKIPPED_EXPLICIT":
          return unavailable("decide", result);
        case "UNDECIDABLE":
          return unavailable("decide", result);
        case "CLI_ERROR":
          return unavailable("invalid", "UNDECIDABLE");
      }
    })();
    const unavailableEvidence = relation.evidence === "unavailable";
    return encodeMatrixControllerReceipt(makeMatrixControllerReceipt({
      evidence: relation.evidence,
      failureDigest: unavailableEvidence
        ? matrixFailureDigest(`fixture ${result}`)
        : MATRIX_NO_FAILURE_DIGEST,
      mode: relation.mode,
      operation: relation.operation,
      decision: relation.decision,
      result,
      stampClass: relation.stampClass,
      inputsDigest: unavailableEvidence ? UNAVAILABLE_MATRIX_IDENTITY_DIGEST : byteHex("1"),
      environmentDigest: unavailableEvidence ? UNAVAILABLE_MATRIX_IDENTITY_DIGEST : byteHex("2"),
      bodyDigest: byteHex("3"),
      certificateDigest: relation.stampClass === "valid"
        ? byteHex("4")
        : LEGACY_STAMPLESS_TOMBSTONE_DIGEST,
      controllerDigest: byteHex("5"),
      packageDigest: unavailableEvidence ? UNAVAILABLE_MATRIX_IDENTITY_DIGEST : byteHex("6"),
      capturedPresentation: unavailableEvidence
        ? {
            sourceCommit: "0".repeat(40),
            verified: "1970-01-01",
            verifiedAtSha: "0".repeat(7),
          }
        : {
            sourceCommit: "0123456789abcdef0123456789abcdef01234567",
            verified: "2026-08-11",
            verifiedAtSha: "0123456",
          },
      publication: relation.publication,
    }));
  };
  const dependencies: IdentityArtifactDriverDependencies = {
    now: () => clock++,
    stdout: () => {},
    stderr: () => {},
    bootstrapPreflight: async () => {
      trace.push("preflight");
      phaseFailure("parser-bootstrap-preflight");
      return { ok: true, warnings: [], refusals: [] };
    },
    runCodenameLock: async () => {
      trace.push("codename-lock");
      phaseFailure("codename-lock");
      return { minted: config.minted ?? [] };
    },
    runFieldCatalog: async () => {
      trace.push("field-catalog");
      if (config.failPhase === "repository-field-catalog") {
        throw new Error("repository-field-catalog fixture failure");
      }
      return "fixture catalog";
    },
    captureRepositoryEpoch: async () => {
      trace.push("repository-epoch");
      phaseFailure("repository-epoch");
      return REPOSITORY_EPOCH;
    },
    captureFinalEnvelope: async (): Promise<IdentityArtifactFinalEnvelope> => {
      envelopeCount += 1;
      trace.push(`envelope-${envelopeCount}`);
      phaseFailure(envelopeCount === 1 ? "final-envelope-a" : "final-envelope-b");
      return {
        schema: "fenel.identity-artifact-final-envelope.v1",
        digest: config.envelopeDigests?.[envelopeCount - 1]
          ?? (config.failPhase === "final-attestation" && envelopeCount === 2 ? hex("c") : hex("b")),
        portableCiRun: PORTABLE_RUN,
      };
    },
    runFreshChild: async (request) => {
      children.push(request);
      const operation = request.args[0] ?? "writer";
      trace.push(`child:${request.phase}:${operation}`);
      if (config.failPhase === request.phase) {
        return { exitCode: 1, stdout: new Uint8Array() };
      }
      if (request.script === "self-host-matrix-controller.ts") {
        return {
          exitCode: config.matrixExitCode ?? 0,
          stdout: matrixReceipt(request),
        };
      }
      const artifact = ownerArtifact(request);
      if (artifact !== undefined) {
        const reply = operation === "--repair"
          ? config.repairResult?.[artifact]
          : request.phase.endsWith("acquisition-preflight")
            ? config.acquisitionPreflight?.[artifact]
            : config.finalProbe?.[artifact];
        if (typeof reply === "string") {
          switch (reply) {
            case "empty":
              return { exitCode: 0, stdout: new Uint8Array() };
            case "exit-disagreement":
              return { exitCode: 20, stdout: encodeCanonicalJson(fresh(artifact)) };
            case "extra-record":
              return {
                exitCode: 0,
                stdout: Buffer.concat([
                  encodeCanonicalJson(fresh(artifact)),
                  encodeCanonicalJson(fresh(artifact)),
                ]),
              };
            case "invalid-utf8":
              return { exitCode: 0, stdout: new Uint8Array([0xff]) };
            case "malformed":
              return { exitCode: 0, stdout: new TextEncoder().encode("not-json") };
            case "signal-exit":
              return { exitCode: null, stdout: new Uint8Array() };
            case "spawn-error":
              return { exitCode: null, stdout: new Uint8Array(), error: "spawn fixture" };
            case "truncated":
              return { exitCode: 0, stdout: new TextEncoder().encode('{"schema":') };
            case "unknown-exit":
              return { exitCode: 99, stdout: encodeCanonicalJson(stale(artifact)) };
            case "wrong-owner":
              return {
                exitCode: 0,
                stdout: encodeCanonicalJson(fresh(
                  artifact === "compiled-parser" ? "compiled-resolver" : "compiled-parser",
                )),
              };
          }
        }
        const record = reply ?? fresh(artifact);
        return {
          exitCode: OWNER_PROBE_EXIT_CODES[record.verdict],
          stdout: encodeCanonicalJson(record),
        };
      }
      return { exitCode: 0, stdout: new Uint8Array() };
    },
  };
  return { dependencies, trace, children };
}

test("importing the driver is inert and the declared artifact inventory includes sidecars", async () => {
  const before = new Map(ARTIFACTS.map((path) => {
    const absolute = join(REPO_ROOT, path);
    return [path, existsSync(absolute) ? readFileSync(absolute) : undefined] as const;
  }));
  const imported = await import(`./generate-identity-artifacts.ts?import-only=${Date.now()}`);
  expect(typeof imported.runIdentityArtifactDriver).toBe("function");
  for (const [path, bytes] of before) {
    const absolute = join(REPO_ROOT, path);
    expect(existsSync(absolute)).toBe(bytes !== undefined);
    if (bytes !== undefined) expect(readFileSync(absolute)).toEqual(bytes);
  }

  const source = readFileSync(join(HERE, "generate-identity-artifacts.ts"), "utf8");
  expect(source).not.toContain("Promise.all(");
  expect(source).not.toContain("spawnSync(");
  expect(source).not.toContain("const args = import.meta.main");
  expect(source).toContain("if (import.meta.main) process.exitCode = await main();");
  const spawnSite = source.indexOf("const child = spawn(");
  const runnerStart = source.indexOf("async function defaultRunFreshChild(");
  const nextFunction = source.indexOf("function concatenate(", runnerStart);
  expect(spawnSite).toBeGreaterThan(runnerStart);
  expect(spawnSite).toBeLessThan(nextFunction);
});

describe("immutable serial phase graph", () => {
  test("executes every phase in normative order", async () => {
    const fixture = harness({ minted: [{ name: "fn", kind: "function" }] });
    const result = await runIdentityArtifactDriver(options(), fixture.dependencies);
    expect(result.ok).toBe(true);
    expect(result.phases.map((phase) => phase.name)).toEqual(
      IDENTITY_ARTIFACT_PHASE_DECLARATION.map((phase) => phase.name),
    );
    expect(Object.isFrozen(IDENTITY_ARTIFACT_PHASE_DECLARATION)).toBe(true);
    expect(IDENTITY_ARTIFACT_PHASE_DECLARATION.every(Object.isFrozen)).toBe(true);
    expect(result.phases.every((phase) => phase.status === "ok")).toBe(true);
    expect(fixture.trace).toEqual([
      "preflight",
      "child:parser-bootstrap:writer",
      "child:parser-bootstrap-check:--check",
      "child:resolver-acquisition-preflight:--probe",
      "child:parser-acquisition-preflight:--probe",
      "codename-lock",
      "field-catalog",
      "repository-epoch",
      "child:compiled-resolver:--repair",
      "child:compiled-parser:--repair",
      "child:parse-cache:--incremental",
      "child:signature-honesty-claims:writer",
      "child:self-host-matrix:--decide",
      "envelope-1",
      "child:final-resolver-probe:--probe",
      "child:final-parser-probe:--probe",
      "envelope-2",
    ]);
    expect(fixture.children.every((request) => request.repositoryRoot === options().repositoryRoot))
      .toBe(true);
  });

  test("explicit matrix skip is advisory and still reaches both final envelopes", async () => {
    const fixture = harness();
    const result = await runIdentityArtifactDriver(options("without"), fixture.dependencies);
    expect(result.ok).toBe(true);
    expect(result.phases.find((phase) => phase.name === "self-host-matrix")).toMatchObject({
      status: "skipped",
      detail: "--no-matrix (advisory)",
    });
    expect(result.phases.at(-1)?.status).toBe("ok");
    expect(result.notRegenerated).toEqual(["matrix: --no-matrix (advisory)"]);
    const matrix = fixture.children.find((request) =>
      request.script === "self-host-matrix-controller.ts");
    expect(matrix?.args).toEqual(["--decide", "--function-mints=0", "--no-matrix"]);
  });

  test("an explicitly forced non-green matrix result fails before the final bracket", async () => {
    const fixture = harness({ matrixExitCode: 21 });
    const result = await runIdentityArtifactDriver(options("with"), fixture.dependencies);
    expect(result.ok).toBe(false);
    expect(result.phases.find((phase) => phase.name === "self-host-matrix"))
      .toMatchObject({ status: "failed" });
    expect(result.phases.find((phase) => phase.name === "final-envelope-a"))
      .toEqual(expect.objectContaining({
        status: "skipped",
        detail: "self-host-matrix failed",
      }));
    expect(fixture.trace).not.toContain("envelope-1");
  });

  test("required-v1 REPAIRED is terminal green and reaches the final bracket", async () => {
    const adoption = hex("d");
    const fixture = harness({ matrixResult: "REPAIRED" });
    const result = await runIdentityArtifactDriver({
      ...options("with"),
      adoptMatrixEnvironment: adoption,
    }, fixture.dependencies);
    expect(result.ok).toBe(true);
    expect(result.phases.find((phase) => phase.name === "self-host-matrix"))
      .toMatchObject({ status: "ok", detail: "REPAIRED; 0 function-kind mint(s)" });
    expect(result.phases.at(-1)?.status).toBe("ok");
    const matrix = fixture.children.find((request) =>
      request.script === "self-host-matrix-controller.ts");
    expect(matrix?.args).toEqual([
      "--decide",
      "--function-mints=0",
      "--with-matrix",
      `--adopt-matrix-environment=${adoption}`,
    ]);
  });

  test("forced matrix semantic non-green cannot hide behind exit zero", async () => {
    const fixture = harness({ matrixResult: "VERIFIED_FOREIGN" });
    const result = await runIdentityArtifactDriver(options("with"), fixture.dependencies);
    expect(result.ok).toBe(false);
    expect(result.phases.find((phase) => phase.name === "self-host-matrix"))
      .toMatchObject({
        status: "failed",
        detail: "explicit matrix request returned VERIFIED_FOREIGN",
      });
    expect(fixture.trace).not.toContain("envelope-1");
  });

  test("matrix receipt and exit framing must agree", async () => {
    const fixture = harness({ matrixExitCode: 20, matrixResult: "FRESH" });
    const result = await runIdentityArtifactDriver(options(), fixture.dependencies);
    expect(result.ok).toBe(false);
    expect(result.phases.find((phase) => phase.name === "self-host-matrix"))
      .toMatchObject({
        status: "failed",
        detail: "matrix exit 20 disagrees with FRESH (0)",
      });
    expect(fixture.trace).not.toContain("envelope-1");
  });

  test("required-v1 rejects an inherited legacy success before the final bracket", async () => {
    const fixture = harness({ matrixResult: "LEGACY_REPAIRED" });
    const result = await runIdentityArtifactDriver(options(), fixture.dependencies);
    expect(result.ok).toBe(false);
    expect(result.phases.find((phase) => phase.name === "self-host-matrix"))
      .toMatchObject({
        status: "failed",
        detail: "matrix controller returned legacy-stampless receipt in required-v1 mode",
      });
    expect(fixture.trace).not.toContain("envelope-1");
  });

  test.each(
    IDENTITY_ARTIFACT_PHASE_DECLARATION
      .filter((phase) => phase.mandatory)
      .map((phase) => [phase.name] as const),
  )("a failure at mandatory phase %s stops every later phase and names the decider", async (failedPhase) => {
    const fixture = harness({ failPhase: failedPhase });
    const result = await runIdentityArtifactDriver(options(), fixture.dependencies);
    const failedIndex = IDENTITY_ARTIFACT_PHASE_DECLARATION.findIndex(
      (phase) => phase.name === failedPhase,
    );

    expect(result.ok).toBe(false);
    expect(result.phases[failedIndex]).toMatchObject({
      name: failedPhase,
      status: "failed",
    });
    expect(result.phases.slice(0, failedIndex).every((phase, index) =>
      phase.status === "ok"
      || (!IDENTITY_ARTIFACT_PHASE_DECLARATION[index]!.mandatory && phase.status === "skipped")))
      .toBe(true);
    expect(result.phases.slice(failedIndex + 1).every((phase) =>
      phase.status === "skipped" && phase.detail === `${failedPhase} failed`)).toBe(true);

    const phaseIndex = new Map(
      IDENTITY_ARTIFACT_PHASE_DECLARATION.map((phase, index) => [phase.name, index] as const),
    );
    expect(fixture.children.every((request) => phaseIndex.get(request.phase)! <= failedIndex)).toBe(true);
    if (failedPhase === "compiled-resolver" || failedPhase === "compiled-parser") {
      expect(fixture.children.filter((request) => request.phase === failedPhase).map(
        (request) => request.args[0],
      )).toEqual(["--repair"]);
    }
  });

  test("missing or stale owners pass acquisition before identity writes and still require bound repair", async () => {
    const fixture = harness({ acquisitionPreflight: {
      "compiled-resolver": { ...stale("compiled-resolver"), reasons: ["artifact-missing", "certificate-missing"] },
      "compiled-parser": { ...stale("compiled-parser"), reasons: ["repository-epoch-mismatch"], repositoryEpoch: hex("f") },
    } });
    const result = await runIdentityArtifactDriver(options(), fixture.dependencies);
    expect(result.ok).toBe(true);
    const preflights = fixture.children.filter((request) => request.phase.endsWith("acquisition-preflight"));
    expect(preflights.map((request) => request.args)).toEqual([["--probe"], ["--probe"]]);
    expect(fixture.trace.indexOf("child:parser-acquisition-preflight:--probe"))
      .toBeLessThan(fixture.trace.indexOf("codename-lock"));
    expect(result.phases.find((phase) => phase.name === "compiled-parser")?.detail)
      .toBe("owner transaction FRESH");
    expect(result.retainedOwners["compiled-parser"]?.repositoryEpoch).toBe(REPOSITORY_EPOCH);
  });

  test.each(["compiled-resolver", "compiled-parser"] as const)(
    "%s uncomputable acquisition refuses before identity writes without retaining preflight evidence",
    async (artifact) => {
      const fixture = harness({ acquisitionPreflight: { [artifact]: {
        schema: ARTIFACT_FRESHNESS_SCHEMA,
        artifact,
        verdict: "UNDECIDABLE",
        portableSeal: "unresolved",
        reasons: ["owner-uncomputable"],
        attestationPolicyDigest: hex("a"),
      } } });
      const result = await runIdentityArtifactDriver(options(), fixture.dependencies);
      expect(result.ok).toBe(false);
      expect(result.phases.find((phase) => phase.status === "failed")?.detail)
        .toBe(`${artifact} acquisition preflight UNDECIDABLE: owner-uncomputable`);
      expect(fixture.trace).not.toContain("codename-lock");
      expect(fixture.trace).not.toContain("field-catalog");
      expect(fixture.trace).not.toContain("repository-epoch");
      expect(fixture.children.some((request) => request.args[0] === "--repair")).toBe(false);
      expect(result.retainedOwners).toEqual({});
    },
  );

  test.each([
    "empty", "exit-disagreement", "extra-record", "invalid-utf8", "malformed",
    "signal-exit", "spawn-error", "truncated", "unknown-exit", "wrong-owner",
  ] as const)("acquisition preflight fault %s refuses before identity writes", async (fault) => {
    const fixture = harness({ acquisitionPreflight: { "compiled-resolver": fault } });
    const result = await runIdentityArtifactDriver(options(), fixture.dependencies);
    expect(result.ok).toBe(false);
    expect(result.phases.find((phase) => phase.status === "failed")?.name)
      .toBe("resolver-acquisition-preflight");
    expect(fixture.trace).not.toContain("codename-lock");
    expect(result.retainedOwners).toEqual({});
  });

  test("owner diagnostics are requested through child stderr at preflight, repair and final probes", async () => {
    const fixture = harness();
    expect((await runIdentityArtifactDriver(options(), fixture.dependencies)).ok).toBe(true);
    const ownerChildren = fixture.children.filter((request) =>
      request.script === "generate-compiled-resolver.ts" || request.script === "generate-compiled-parser.ts");
    expect(ownerChildren).toHaveLength(6);
    expect(ownerChildren.every((request) => request.diagnoseOwner === true)).toBe(true);
    expect(fixture.children.filter((request) => !ownerChildren.includes(request))
      .every((request) => request.diagnoseOwner === undefined)).toBe(true);
  });

  test("zero identity mints never infer compiled freshness", async () => {
    const fixture = harness({ minted: [] });
    const result = await runIdentityArtifactDriver(options(), fixture.dependencies);
    expect(result.ok).toBe(true);
    const compiled = fixture.children.filter((request) =>
      request.script === "generate-compiled-resolver.ts"
      || request.script === "generate-compiled-parser.ts");
    expect(compiled.map((request) => [request.phase, request.args[0]])).toEqual([
      ["resolver-acquisition-preflight", "--probe"],
      ["parser-acquisition-preflight", "--probe"],
      ["compiled-resolver", "--repair"],
      ["compiled-parser", "--repair"],
      ["final-resolver-probe", "--probe"],
      ["final-parser-probe", "--probe"],
    ]);
    expect(result.phases.find((phase) => phase.name === "compiled-resolver")?.detail)
      .toBe("owner transaction FRESH");
    expect(result.phases.find((phase) => phase.name === "compiled-parser")?.detail)
      .toBe("owner transaction FRESH");
  });

  test("each owner goes directly through one bound repair child before its sibling", async () => {
    const fixture = harness();
    const result = await runIdentityArtifactDriver(options(), fixture.dependencies);
    expect(result.ok).toBe(true);
    const initial = fixture.children.filter((request) =>
      request.phase === "compiled-resolver" || request.phase === "compiled-parser");
    expect(initial.map((request) => [request.phase, request.args[0]])).toEqual([
      ["compiled-resolver", "--repair"],
      ["compiled-parser", "--repair"],
    ]);
    expect(new Set(initial).size).toBe(2);
    for (const request of initial) {
      expect(request.captureStdout).toBe(true);
      expect(request.args.at(-1)).toBe(`--expected-repository-epoch=${REPOSITORY_EPOCH}`);
    }
  });

  test.each([
    "empty",
    "exit-disagreement",
    "extra-record",
    "invalid-utf8",
    "malformed",
    "signal-exit",
    "spawn-error",
    "truncated",
    "unknown-exit",
    "wrong-owner",
  ] as const)("owner transaction fault %s refuses without retry or later phases", async (fault) => {
    const fixture = harness({ repairResult: { "compiled-resolver": fault } });
    const result = await runIdentityArtifactDriver(options(), fixture.dependencies);
    expect(result.ok).toBe(false);
    expect(fixture.children.filter((request) => request.phase === "compiled-resolver").map(
      (request) => request.args[0],
    )).toEqual(["--repair"]);
    expect(result.phases.find((phase) => phase.name === "compiled-resolver")).toMatchObject({
      status: "failed",
    });
    expect(result.retainedOwners["compiled-resolver"]).toBeUndefined();
    expect(result.phases.slice(9).every((phase) => phase.status === "skipped")).toBe(true);
    expect(fixture.trace).not.toContain("envelope-1");
  });

  test.each(["STALE", "UNDECIDABLE"] as const)(
    "a %s owner transaction refuses without retaining or advancing",
    async (verdict) => {
      const record: ArtifactFreshnessRecord = verdict === "STALE"
        ? stale("compiled-resolver")
        : {
          schema: ARTIFACT_FRESHNESS_SCHEMA,
          artifact: "compiled-resolver",
          verdict: "UNDECIDABLE",
          portableSeal: "unresolved",
          reasons: ["owner-uncomputable"],
          repositoryEpoch: REPOSITORY_EPOCH,
          attestationPolicyDigest: hex("a"),
        };
      const fixture = harness({ repairResult: { "compiled-resolver": record } });
      const result = await runIdentityArtifactDriver(options(), fixture.dependencies);
      expect(result.ok).toBe(false);
      expect(result.retainedOwners["compiled-resolver"]).toBeUndefined();
      expect(result.phases.find((phase) => phase.name === "compiled-resolver"))
        .toMatchObject({ status: "failed" });
      expect(fixture.children.filter((request) => request.phase === "compiled-resolver")
        .map((request) => request.args[0])).toEqual(["--repair"]);
      expect(result.phases.slice(9).every((phase) => phase.status === "skipped")).toBe(true);
    },
  );

  test("a successful owner transaction cannot escape the shared repository epoch", async () => {
    const escaped = fresh("compiled-resolver");
    const fixture = harness({ repairResult: {
      "compiled-resolver": {
        ...escaped,
        repositoryEpoch: hex("f"),
        producer: { ...escaped.producer, repositoryEpoch: hex("f") },
      },
    } });
    const result = await runIdentityArtifactDriver(options(), fixture.dependencies);
    expect(result.ok).toBe(false);
    expect(result.retainedOwners["compiled-resolver"]).toBeUndefined();
    expect(result.phases.find((phase) => phase.name === "compiled-resolver"))
      .toMatchObject({
        status: "failed",
        detail: `compiled-resolver repository epoch ${hex("f")} differs from shared ${REPOSITORY_EPOCH}`,
      });
    expect(result.phases.slice(9).every((phase) => phase.status === "skipped")).toBe(true);
  });

  test("final A/B drift fails after both read-only final probes", async () => {
    const fixture = harness({ envelopeDigests: [hex("b"), hex("c")] });
    const result = await runIdentityArtifactDriver(options(), fixture.dependencies);
    expect(result.ok).toBe(false);
    expect(result.phases.find((phase) => phase.name === "final-attestation"))
      .toMatchObject({ status: "failed", detail: "final union envelope drifted between A and B" });
    expect(fixture.children.filter((request) => request.phase.startsWith("final-")).map(
      (request) => request.phase,
    )).toEqual(["final-resolver-probe", "final-parser-probe"]);
  });

  test("malformed final probe evidence fails inside the final bracket", async () => {
    const fixture = harness();
    const runFreshChild = fixture.dependencies.runFreshChild!;
    const result = await runIdentityArtifactDriver(options(), {
      ...fixture.dependencies,
      runFreshChild: async (request) => {
        const child = await runFreshChild(request);
        return request.phase === "final-resolver-probe"
          ? { exitCode: 0, stdout: new TextEncoder().encode("not-json") }
          : child;
      },
    });
    expect(result.ok).toBe(false);
    expect(result.phases.find((phase) => phase.name === "final-resolver-probe"))
      .toMatchObject({ status: "failed", detail: "compiled-resolver final probe framing is invalid" });
    expect(result.phases.slice(15).every((phase) => phase.status === "skipped")).toBe(true);
    expect(fixture.trace).toContain("envelope-1");
    expect(fixture.trace).not.toContain("envelope-2");
  });

  test("a final owner probe cannot escape the shared repository epoch", async () => {
    const escaped = fresh("compiled-resolver");
    const fixture = harness({ finalProbe: {
      "compiled-resolver": {
        ...escaped,
        repositoryEpoch: hex("f"),
        producer: { ...escaped.producer, repositoryEpoch: hex("f") },
      },
    } });
    const result = await runIdentityArtifactDriver(options(), fixture.dependencies);
    expect(result.ok).toBe(false);
    expect(result.phases.find((phase) => phase.name === "final-resolver-probe"))
      .toMatchObject({
        status: "failed",
        detail: `compiled-resolver repository epoch ${hex("f")} differs from shared ${REPOSITORY_EPOCH}`,
      });
    expect(fixture.trace).not.toContain("envelope-2");
  });

  test("a final owner probe must retain the exact initial tuple", async () => {
    const changedResolver = {
      ...fresh("compiled-resolver"),
      environmentFingerprint: hex("c"),
    } satisfies FreshArtifactRecord;
    const fixture = harness({ finalProbe: { "compiled-resolver": changedResolver } });
    const result = await runIdentityArtifactDriver(options(), fixture.dependencies);
    expect(result.ok).toBe(false);
    expect(result.phases.find((phase) => phase.name === "final-attestation"))
      .toMatchObject({
        status: "failed",
        detail: "final resolver tuple differs from its retained tuple",
      });
  });
});

test("retired mandatory skips and invented plan mode are rejected during CLI normalization", () => {
  for (const flag of ["--skip-compiled", "--skip-parse-cache", "--plan"]) {
    expect(() => parseIdentityArtifactDriverOptions([flag], REPO_ROOT)).toThrow();
  }
  expect(() => parseIdentityArtifactDriverOptions([
    `--adopt-matrix-environment=${hex("d")}`,
  ], REPO_ROOT)).toThrow("requires --with-matrix");
});

function ciSet(
  artifactRun: PortableCiRun,
): readonly PortableCiAttestationCoordinate[] {
  return (["windows", "linux", "macos"] as const).map((osFamily) => ({
    ...artifactRun,
    osFamily,
  }));
}

test("resolver and parser sealed CI sets must share one source/workflow/run/attempt", () => {
  expect(assertCrossOwnerSealedCiRuns({
    "compiled-resolver": ciSet(PORTABLE_RUN),
    "compiled-parser": ciSet(PORTABLE_RUN),
  })).toEqual(PORTABLE_RUN);

  expect(() => assertCrossOwnerSealedCiRuns({
    "compiled-resolver": ciSet(PORTABLE_RUN),
    "compiled-parser": ciSet({ ...PORTABLE_RUN, sourceCommit: "other-sha" }),
  })).toThrow("different workflow runs");
  for (const changed of [
    { ...PORTABLE_RUN, workflowDigest: hex("b") },
    { ...PORTABLE_RUN, workflowRunId: "4243" },
    { ...PORTABLE_RUN, workflowRunAttempt: 2 },
  ]) {
    expect(() => assertCrossOwnerSealedCiRuns({
      "compiled-resolver": ciSet(PORTABLE_RUN),
      "compiled-parser": ciSet(changed),
    })).toThrow("different workflow runs");
  }
});

test("a sealed final envelope retains a later matching local producer beside the exact CI trio", () => {
  const policy = hex("a");
  const currentEnvironment = hex("5");
  const producer = (
    osFamily: "windows" | "linux" | "macos",
    origin: CompiledArtifactCheckAttestation["origin"],
    environmentFingerprint: Sha256Hex,
    attestationPolicyDigest: Sha256Hex = policy,
  ): CompiledArtifactCheckAttestation => ({
    origin,
    environment: { osFamily },
    environmentFingerprint,
    attestationPolicyDigest,
  } as unknown as CompiledArtifactCheckAttestation);
  const ci = (["windows", "linux", "macos"] as const).map((osFamily, index) =>
    producer(osFamily, {
      kind: "ci",
      sourceCommit: PORTABLE_RUN.sourceCommit,
      workflowDigest: PORTABLE_RUN.workflowDigest,
      workflowRunId: PORTABLE_RUN.workflowRunId,
      workflowRunAttempt: PORTABLE_RUN.workflowRunAttempt,
    }, hex(String(index + 1))));
  const local = producer("windows", { kind: "local" }, currentEnvironment);
  const supersededCi = producer("windows", {
    kind: "ci",
    sourceCommit: PORTABLE_RUN.sourceCommit,
    workflowDigest: PORTABLE_RUN.workflowDigest,
    workflowRunId: PORTABLE_RUN.workflowRunId,
    workflowRunAttempt: PORTABLE_RUN.workflowRunAttempt,
  }, currentEnvironment, hex("b"));

  expect(selectFinalEnvelopeProducerCoordinates({
    artifact: "compiled-parser",
    entries: [...ci, local, supersededCi],
    attestationPolicyDigest: policy,
    environmentFingerprint: currentEnvironment,
    portableSeal: "sealed",
  })).toEqual(ciSet(PORTABLE_RUN));

  expect(() => selectFinalEnvelopeProducerCoordinates({
    artifact: "compiled-parser",
    entries: ci,
    attestationPolicyDigest: policy,
    environmentFingerprint: currentEnvironment,
    portableSeal: "sealed",
  })).toThrow("lacks current-environment producer evidence");
});
