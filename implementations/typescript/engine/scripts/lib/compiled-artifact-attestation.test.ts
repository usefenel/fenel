import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { compareUtf8, encodeCanonicalJson } from "./artifact-wire-json";
import {
  COMPILED_ARTIFACT_ATTESTATION_JSON_SCHEMA,
  assertCanonicalProducerAttestations,
  canonicalizeProducerAttestations,
  computeEnvironmentFingerprint,
  validateCompiledArtifactCheckAttestation,
  type ArtifactEnvironmentEvidence,
  type ArtifactOsFamily,
  type CompiledArtifactCheckAttestation,
  type EnvironmentVariableEvidence,
} from "./compiled-artifact-attestation";

const digest = (character: string): string => character.repeat(64);

function environment(osFamily: ArtifactOsFamily = "windows"): ArtifactEnvironmentEvidence {
  const variables: EnvironmentVariableEvidence[] = [
    { name: "FENEL_PARSE_CACHE", state: "present", value: "0" },
    { name: "FENEL_PARSER_INTERPRETED", state: "present", value: "1" },
    { name: "FENEL_PARSER_LEGACY", state: "present", value: "1" },
    { name: "FENEL_RESOLVER_INTERPRETED", state: "present", value: "1" },
    { name: "NODE_ENV", state: "present", value: "production" },
    { name: "TZ", state: "present", value: "UTC" },
    { name: "LANG", state: "present", value: "C" },
    { name: "LC_ALL", state: "present", value: "C" },
    { name: "FENEL_SIMULATE_BROWSER", state: "absent" },
    { name: "FENEL_DISPATCH_FENEL_PASSES", state: "absent" },
    { name: "FENEL_REGEX_SHIM_DEBUG", state: "absent" },
    { name: "TEMP", state: "present", value: "<snapshot>/.tmp" },
    { name: "TMP", state: "present", value: "<snapshot>/.tmp" },
    { name: "TMPDIR", state: "present", value: "<snapshot>/.tmp" },
  ];
  variables.sort((left, right) => compareUtf8(left.name, right.name));
  return {
    osFamily,
    arch: osFamily === "macos" ? "arm64" : "x64",
    bun: {
      release: "1.3.13",
      revision: "bf2e2cec",
      executableDigest: digest("1"),
      webkitVersion: "WebKit-1",
      javascriptCoreVersion: "JSC-1",
      icuVersion: "76.1",
      unicodeVersion: "16.0",
      toolchainManifestDigest: digest("2"),
      toolchainRowDigest: digest("3"),
    },
    variables,
  };
}

function attestation(
  osFamily: ArtifactOsFamily = "windows",
  origin: CompiledArtifactCheckAttestation["origin"] = { kind: "local" },
): CompiledArtifactCheckAttestation {
  const environmentEvidence = environment(osFamily);
  return {
    schema: "fenel.compiled-artifact-check-attestation.v2",
    result: "MATCH",
    artifact: "compiled-parser",
    origin,
    checkPackageDigest: digest("6"),
    coveredSourceArchiveDigest: digest("7"),
    certificateBaseDigest: digest("8"),
    repositoryEpoch: digest("9"),
    ownerEpoch: digest("a"),
    dependencyDigest: digest("b"),
    environment: environmentEvidence,
    environmentFingerprint: computeEnvironmentFingerprint(environmentEvidence),
    artifactByteLength: 123,
    artifactDigest: digest("c"),
    attestationPolicyDigest: digest("d"),
  };
}

const ciOrigin = {
  kind: "ci",
  workflowDigest: digest("e"),
  workflowRunId: "12345678901234567890",
  workflowRunAttempt: 1,
  sourceCommit: "f".repeat(40),
} as const;

describe("compiled-artifact check attestation", () => {
  test("the checked-in JSON Schema is the exact canonical exported schema", () => {
    expect(readFileSync(new URL("./compiled-artifact-check-attestation.schema.json", import.meta.url)))
      .toEqual(Buffer.from(encodeCanonicalJson(COMPILED_ARTIFACT_ATTESTATION_JSON_SCHEMA)));
  });

  test("accepts exact local and CI records and recomputes environment identity", () => {
    expect(validateCompiledArtifactCheckAttestation(attestation())).toEqual(attestation());
    const ci = attestation("linux", ciOrigin);
    expect(validateCompiledArtifactCheckAttestation(ci)).toEqual(ci);
  });

  test("rejects retired attestations and separate package-manager evidence", () => {
    expect(() => validateCompiledArtifactCheckAttestation({
      ...attestation(), schema: "fenel.compiled-artifact-check-attestation.v1",
    })).toThrow("expected one of");
    expect(() => validateCompiledArtifactCheckAttestation({
      ...attestation(), environment: { ...environment(), pnpm: {} },
    })).toThrow("unknown property");
  });

  test("rejects unknown fields, non-success, bad origin, digest, and environment evidence", () => {
    expect(() => validateCompiledArtifactCheckAttestation({ ...attestation(), extra: true }))
      .toThrow("unknown property");
    expect(() => validateCompiledArtifactCheckAttestation({ ...attestation(), result: "FAIL" }))
      .toThrow("expected one of");
    expect(() => validateCompiledArtifactCheckAttestation({
      ...attestation(),
      origin: { kind: "local", sourceCommit: "f".repeat(40) },
    })).toThrow("unknown property");
    expect(() => validateCompiledArtifactCheckAttestation({
      ...attestation(),
      artifactDigest: "A".repeat(64),
    })).toThrow("64 lowercase");
    expect(() => validateCompiledArtifactCheckAttestation({
      ...attestation(),
      environmentFingerprint: digest("0"),
    })).toThrow("does not match");

    const reversed = {
      ...attestation(),
      environment: {
        ...environment(),
        variables: [...environment().variables].reverse(),
      },
    };
    expect(() => validateCompiledArtifactCheckAttestation(reversed)).toThrow("UTF-8 byte order");

    const wrongFixed = environment();
    const wrongVariables = wrongFixed.variables.map((row) =>
      row.name === "FENEL_PARSE_CACHE"
        ? { name: row.name, state: "present" as const, value: "1" }
        : row);
    expect(() => validateCompiledArtifactCheckAttestation({
      ...attestation(),
      environment: { ...wrongFixed, variables: wrongVariables },
    })).toThrow("FENEL_PARSE_CACHE");

    expect(() => validateCompiledArtifactCheckAttestation({
      ...attestation(),
      environment: {
        ...environment(),
        variables: environment().variables.filter((row) => row.name !== "TMPDIR"),
      },
    })).toThrow("exactly 14 fixed environment rows");
    expect(() => validateCompiledArtifactCheckAttestation({
      ...attestation(),
      environment: {
        ...environment(),
        variables: [...environment().variables, { name: "UNDECLARED", state: "absent" as const }]
          .sort((left, right) => compareUtf8(left.name, right.name)),
      },
    })).toThrow("exactly 14 fixed environment rows");
  });

  test("requires canonical positive CI run identity", () => {
    for (const workflowRunId of ["0", "01", "1.0", "-1"]) {
      expect(() => validateCompiledArtifactCheckAttestation(attestation("linux", {
        ...ciOrigin,
        workflowRunId,
      }))).toThrow("canonical positive decimal");
    }
    expect(() => validateCompiledArtifactCheckAttestation(attestation("linux", {
      ...ciOrigin,
      workflowRunAttempt: 0,
    }))).toThrow("greater than or equal to 1");
  });

  test("construction sorts CI before local and CI OS families windows/linux/macos", () => {
    const entries = [
      attestation("macos", ciOrigin),
      attestation("windows"),
      attestation("linux", ciOrigin),
      attestation("windows", ciOrigin),
    ];
    const sorted = canonicalizeProducerAttestations(entries);
    expect(sorted.map((entry) => `${entry.origin.kind}:${entry.environment.osFamily}`)).toEqual([
      "ci:windows",
      "ci:linux",
      "ci:macos",
      "local:windows",
    ]);
    expect(() => assertCanonicalProducerAttestations(entries)).toThrow("canonical order");
    expect(() => canonicalizeProducerAttestations([entries[0]!, entries[0]!]))
      .toThrow("duplicate producer identity");
  });
});
