import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { compareUtf8, encodeCanonicalJson } from "./artifact-wire-json";
import { makeRawCompiledArtifactInput } from "./compiled-artifact-input-key";
import {
  canonicalizeProducerAttestations,
  computeEnvironmentFingerprint,
  type ArtifactEnvironmentEvidence,
  type ArtifactOsFamily,
  type CompiledArtifactCheckAttestation,
  type EnvironmentVariableEvidence,
} from "./compiled-artifact-attestation";
import {
  ALLOWED_VERDICT_SEAL_PAIRS,
  ARTIFACT_FRESHNESS_JSON_SCHEMA,
  ARTIFACT_FRESHNESS_SCHEMA,
  BUILD_CERTIFICATE_SCHEMA,
  BUILD_CERTIFICATE_JSON_SCHEMA,
  COMPILED_ARTIFACT_SPECS,
  OWNER_PROBE_EXIT_CODES,
  OWNER_PROTOCOL,
  POLICY_COMPUTATION_ERRORS,
  POLICY_UNCOMPUTABLE_REASON,
  PORTABLE_GENERATION_ABI,
  PORTABLE_SEALS,
  computeCertificateBaseDigest,
  computeCertificateDigest,
  decodeOwnerProbe,
  evaluatePortableSeal,
  validateArtifactFreshnessRecord,
  validateBuildCertificate,
  type ArtifactFreshnessRecord,
  type CompiledArtifactBuildCertificate,
  type PortableSeal,
} from "./compiled-artifact-protocol";

const digest = (character: string): string => character.repeat(64);

function freshness(verdict: "FRESH" | "STALE" | "UNDECIDABLE", portableSeal: PortableSeal): unknown {
  const common = {
    schema: ARTIFACT_FRESHNESS_SCHEMA,
    artifact: "compiled-parser",
    verdict,
    portableSeal,
    attestationPolicyDigest: digest("f"),
  };
  if (verdict === "FRESH") {
    return {
      ...common,
      repositoryEpoch: digest("1"),
      ownerEpoch: digest("2"),
      dependencyDigest: digest("3"),
      environmentFingerprint: digest("4"),
      artifactDigest: digest("5"),
      certificateDigest: digest("6"),
      inputKey: digest("8"),
      currentSourceArchiveDigest: digest("9"),
      sourceRelation: "same-epoch",
      producer: {
        repositoryEpoch: digest("1"),
        ownerEpoch: digest("2"),
        coveredSourceArchiveDigest: digest("9"),
        inputKey: digest("8"),
        environmentFingerprint: digest("4"),
      },
    };
  }
  return {
    ...common,
    reasons: verdict === "STALE"
      ? ["producer-attestation-missing"]
      : ["environment-uncomputable"],
    repositoryEpoch: digest("1"),
  };
}

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

function baseCertificate(): CompiledArtifactBuildCertificate {
  return {
    schema: BUILD_CERTIFICATE_SCHEMA,
    protocol: OWNER_PROTOCOL,
    artifact: "compiled-parser",
    artifactPath: COMPILED_ARTIFACT_SPECS["compiled-parser"].artifactPath,
    repositoryEpoch: digest("6"),
    ownerEpoch: digest("7"),
    dependencyDigest: digest("8"),
    portableGenerationAbi: PORTABLE_GENERATION_ABI,
    artifactByteLength: 456,
    artifactDigest: digest("9"),
    inputManifest: {
      coveredSourceArchiveDigest: digest("a"),
      repository: { digest: digest("6"), fileCount: 100, byteLength: 1000 },
      ownerOverlay: { digest: digest("b"), fileCount: 10, byteLength: 200 },
      dependencies: { digest: digest("8"), fileCount: 0, byteLength: 0 },
    },
    producerInput: makeRawCompiledArtifactInput({
      artifact: "compiled-parser",
      acquisitionDigest: digest("d"),
      ownerOverlayDigest: digest("b"),
      repositoryExactDigest: digest("e"),
      dependencyDigest: digest("8"),
      environmentFingerprint: computeEnvironmentFingerprint(environment()),
      recoveryStubVersion: digest("f"),
      portableGenerationAbi: PORTABLE_GENERATION_ABI,
    }),
    producerCheckPackageDigest: digest("c"),
    producerAttestations: [],
  };
}

function producer(
  certificate: CompiledArtifactBuildCertificate,
  osFamily: ArtifactOsFamily,
  origin: CompiledArtifactCheckAttestation["origin"],
  policy = digest("d"),
): CompiledArtifactCheckAttestation {
  const environmentEvidence = environment(osFamily);
  return {
    schema: "fenel.compiled-artifact-check-attestation.v2",
    result: "MATCH",
    artifact: certificate.artifact,
    origin,
    checkPackageDigest: digest("c"),
    coveredSourceArchiveDigest: certificate.inputManifest.coveredSourceArchiveDigest,
    certificateBaseDigest: computeCertificateBaseDigest(certificate),
    repositoryEpoch: certificate.repositoryEpoch,
    ownerEpoch: certificate.ownerEpoch,
    dependencyDigest: certificate.dependencyDigest,
    environment: environmentEvidence,
    environmentFingerprint: computeEnvironmentFingerprint(environmentEvidence),
    artifactByteLength: certificate.artifactByteLength,
    artifactDigest: certificate.artifactDigest,
    attestationPolicyDigest: policy,
  };
}

const ciOrigin = {
  kind: "ci",
  workflowDigest: digest("e"),
  workflowRunId: "123",
  workflowRunAttempt: 1,
  sourceCommit: "f".repeat(40),
} as const;

describe("freshness verdict wire contract", () => {
  test("protocol helpers remain C2 build tooling with no engine/product authority import", () => {
    for (const file of [
      "artifact-wire-json.ts",
      "compiled-artifact-attestation.ts",
      "compiled-artifact-protocol.ts",
      "compiled-artifact-check-package.ts",
    ]) {
      const source = readFileSync(new URL(`./${file}`, import.meta.url), "utf8");
      expect(source).not.toMatch(/from\s+["'][^"']*(?:\.\.\/src|engine-bodies|registry|modules\/)/);
      expect(source).not.toMatch(/\b(?:defineFunction|createRepositoryRegistry|listFunctions|spawn|writeFileSync|localeCompare|toLocaleString)\b/);
      expect(source).not.toMatch(/\b(?:PARSER|RESOLVER)_ENTRY_FN_IDS\b/);
      expect(source).not.toContain(".fenel");
    }
  });

  test("freshness and sidecar JSON Schemas are exact canonical goldens", () => {
    expect(readFileSync(new URL("./compiled-artifact-freshness.schema.json", import.meta.url)))
      .toEqual(Buffer.from(encodeCanonicalJson(ARTIFACT_FRESHNESS_JSON_SCHEMA)));
    expect(readFileSync(new URL("./compiled-artifact-build-certificate.schema.json", import.meta.url)))
      .toEqual(Buffer.from(encodeCanonicalJson(BUILD_CERTIFICATE_JSON_SCHEMA)));
  });

  test("accepts exactly the nine frozen verdict/portableSeal pairs", () => {
    for (const [verdict, seal] of ALLOWED_VERDICT_SEAL_PAIRS) {
      const parsed = validateArtifactFreshnessRecord(freshness(verdict, seal));
      expect([parsed.verdict, parsed.portableSeal]).toEqual([verdict, seal]);
    }

    const allowed = new Set(ALLOWED_VERDICT_SEAL_PAIRS.map(([verdict, seal]) => `${verdict}:${seal}`));
    let rejected = 0;
    for (const verdict of ["FRESH", "STALE", "UNDECIDABLE"] as const) {
      for (const seal of PORTABLE_SEALS) {
        if (allowed.has(`${verdict}:${seal}`)) continue;
        expect(() => validateArtifactFreshnessRecord(freshness(verdict, seal))).toThrow();
        rejected += 1;
      }
    }
    expect(rejected).toBe(6);
  });

  test("policy-null is one exact UNDECIDABLE arm and every closed error is accepted", () => {
    for (const policyComputationError of POLICY_COMPUTATION_ERRORS) {
      const parsed = validateArtifactFreshnessRecord({
        schema: ARTIFACT_FRESHNESS_SCHEMA,
        artifact: "compiled-parser",
        verdict: "UNDECIDABLE",
        portableSeal: "unresolved",
        reasons: [POLICY_UNCOMPUTABLE_REASON],
        attestationPolicyDigest: null,
        policyComputationError,
        repositoryEpoch: digest("1"),
      });
      expect(parsed.attestationPolicyDigest).toBeNull();
    }

    const valid = {
      schema: ARTIFACT_FRESHNESS_SCHEMA,
      artifact: "compiled-parser",
      verdict: "UNDECIDABLE",
      portableSeal: "unresolved",
      reasons: [POLICY_UNCOMPUTABLE_REASON],
      attestationPolicyDigest: null,
      policyComputationError: "missing-input",
    } as const;
    for (const mutation of [
      { ...valid, verdict: "STALE" },
      { ...valid, portableSeal: "unsealed" },
      { ...valid, reasons: ["environment-uncomputable"] },
      { ...valid, reasons: [POLICY_UNCOMPUTABLE_REASON, "environment-uncomputable"] },
      { ...valid, policyComputationError: undefined },
      { ...valid, attestationPolicyDigest: digest("f") },
    ]) {
      expect(() => validateArtifactFreshnessRecord(mutation)).toThrow();
    }
    expect(() => validateArtifactFreshnessRecord({
      ...freshness("UNDECIDABLE", "unresolved") as Record<string, unknown>,
      policyComputationError: "missing-input",
    })).toThrow("unknown property");
  });

  test("non-fresh records expose only observed real digests; FRESH requires all six", () => {
    expect(validateArtifactFreshnessRecord({
      schema: ARTIFACT_FRESHNESS_SCHEMA,
      artifact: "compiled-resolver",
      verdict: "STALE",
      portableSeal: "unsealed",
      reasons: ["artifact-missing"],
      attestationPolicyDigest: digest("f"),
    }).artifact).toBe("compiled-resolver");
    const fresh = freshness("FRESH", "sealed") as Record<string, unknown>;
    delete fresh.certificateDigest;
    expect(() => validateArtifactFreshnessRecord(fresh)).toThrow("required property");
    expect(() => validateArtifactFreshnessRecord({
      ...freshness("STALE", "unsealed") as Record<string, unknown>,
      ownerEpoch: null,
    })).toThrow("expected a string");
  });

  test("decodeOwnerProbe requires exact canonical framing, id, and exit agreement", () => {
    const record = freshness("FRESH", "sealed") as ArtifactFreshnessRecord;
    expect(decodeOwnerProbe({
      stdout: encodeCanonicalJson(record),
      exitCode: OWNER_PROBE_EXIT_CODES.FRESH,
      expectedArtifact: "compiled-parser",
    })).toEqual(record);
    expect(() => decodeOwnerProbe({
      stdout: encodeCanonicalJson(record),
      exitCode: OWNER_PROBE_EXIT_CODES.STALE,
      expectedArtifact: "compiled-parser",
    })).toThrow("disagrees");
    expect(() => decodeOwnerProbe({
      stdout: encodeCanonicalJson(record),
      exitCode: 0,
      expectedArtifact: "compiled-resolver",
    })).toThrow("expected compiled-resolver");
    expect(() => decodeOwnerProbe({
      stdout: new TextEncoder().encode(`progress\n${new TextDecoder().decode(encodeCanonicalJson(record))}`),
      exitCode: 0,
      expectedArtifact: "compiled-parser",
    })).toThrow();
    expect(() => decodeOwnerProbe({
      stdout: encodeCanonicalJson(record).slice(0, -1),
      exitCode: 0,
      expectedArtifact: "compiled-parser",
    })).toThrow("not in canonical");
    expect(() => decodeOwnerProbe({
      stdout: encodeCanonicalJson(record),
      exitCode: null,
      expectedArtifact: "compiled-parser",
    })).toThrow("unknown or signal");
  });
});

describe("build certificate and non-circular digests", () => {
  test("validates the base, binds every producer, and keeps base/full identities distinct", () => {
    const base = baseCertificate();
    expect(validateBuildCertificate(base)).toEqual(base);
    const baseDigest = computeCertificateBaseDigest(base);
    const fullBefore = computeCertificateDigest(base);
    const local = producer(base, "windows", { kind: "local" });
    const withProducer = { ...base, producerAttestations: [local] };
    expect(validateBuildCertificate(withProducer)).toEqual(withProducer);
    expect(computeCertificateBaseDigest(withProducer)).toBe(baseDigest);
    expect(computeCertificateDigest(withProducer)).not.toBe(fullBefore);
    expect(Object.hasOwn(withProducer, "certificateDigest")).toBe(false);
    expect(Object.hasOwn(local, "certificateDigest")).toBe(false);
  });

  test("rejects artifact/path, manifest, producer tuple, and producer ordering drift", () => {
    const base = baseCertificate();
    expect(() => validateBuildCertificate({ ...base, artifactPath: "wrong.ts" }))
      .toThrow("must be");
    expect(() => validateBuildCertificate({
      ...base,
      inputManifest: {
        ...base.inputManifest,
        repository: { ...base.inputManifest.repository, digest: digest("0") },
      },
    })).toThrow("must equal repositoryEpoch");
    const wrong = { ...producer(base, "windows", { kind: "local" }), artifactDigest: digest("0") };
    expect(() => validateBuildCertificate({ ...base, producerAttestations: [wrong] }))
      .toThrow("does not bind");
    const ciWindows = producer(base, "windows", ciOrigin);
    const ciLinux = producer(base, "linux", ciOrigin);
    expect(() => validateBuildCertificate({ ...base, producerAttestations: [ciLinux, ciWindows] }))
      .toThrow("canonical order");
  });

  test("portable evidence classification is total and policy-aware", () => {
    const base = baseCertificate();
    const threeCi = canonicalizeProducerAttestations([
      producer(base, "windows", ciOrigin),
      producer(base, "linux", ciOrigin),
      producer(base, "macos", ciOrigin),
    ]);
    const sealed = validateBuildCertificate({ ...base, producerAttestations: threeCi });
    expect(evaluatePortableSeal(sealed, {
      attestationPolicyDigest: digest("d"),
      portableProofComputable: true,
    })).toBe("sealed");

    const localEntry = producer(base, "windows", { kind: "local" });
    const local = validateBuildCertificate({ ...base, producerAttestations: [localEntry] });
    expect(evaluatePortableSeal(local, {
      attestationPolicyDigest: digest("d"),
      currentEnvironmentFingerprint: localEntry.environmentFingerprint,
      portableProofComputable: true,
    })).toBe("local-only");
    expect(evaluatePortableSeal(local, {
      attestationPolicyDigest: digest("0"),
      portableProofComputable: true,
    })).toBe("invalid-policy");
    expect(evaluatePortableSeal(base, {
      attestationPolicyDigest: digest("d"),
      portableProofComputable: true,
    })).toBe("unsealed");
    expect(evaluatePortableSeal(base, {
      attestationPolicyDigest: digest("d"),
      portableProofComputable: false,
    })).toBe("unresolved");
  });
});
