import { expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { compareUtf8, encodeCanonicalJson } from "./artifact-wire-json";
import { computeEnvironmentFingerprint, type ArtifactEnvironmentEvidence,
  type CompiledArtifactCheckAttestation, type EnvironmentVariableEvidence } from "./compiled-artifact-attestation";
import { RAW_COMPILED_INPUT_JSON_SCHEMA, makeRawCompiledArtifactInput } from "./compiled-artifact-input-key";
import { ARTIFACT_FRESHNESS_JSON_SCHEMA, ARTIFACT_FRESHNESS_SCHEMA,
  BUILD_CERTIFICATE_JSON_SCHEMA, BUILD_CERTIFICATE_SCHEMA, COMPILED_ARTIFACT_SPECS,
  OWNER_PROTOCOL, PORTABLE_GENERATION_ABI, computeCertificateBaseDigest, computeCertificateDigest,
  parseArtifactFreshnessRecord, parseBuildCertificate, validateArtifactFreshnessRecord, validateBuildCertificate,
  type CompiledArtifactBuildCertificate, type FreshArtifactRecord } from "./compiled-artifact-protocol";

const h = (character: string) => character.repeat(64);
function environment(): ArtifactEnvironmentEvidence {
  const present = { FENEL_PARSE_CACHE: "0", FENEL_PARSER_INTERPRETED: "1", FENEL_PARSER_LEGACY: "1",
    FENEL_RESOLVER_INTERPRETED: "1", NODE_ENV: "production", TZ: "UTC", LANG: "C", LC_ALL: "C",
    TEMP: "<snapshot>/.tmp", TMP: "<snapshot>/.tmp", TMPDIR: "<snapshot>/.tmp" };
  const variables: EnvironmentVariableEvidence[] = Object.entries(present).map(([name, value]) => ({ name, state: "present", value }));
  variables.push(...["FENEL_SIMULATE_BROWSER", "FENEL_DISPATCH_FENEL_PASSES", "FENEL_REGEX_SHIM_DEBUG"]
    .map(name => ({ name, state: "absent" as const })));
  variables.sort((a, b) => compareUtf8(a.name, b.name));
  return { osFamily: "windows", arch: "x64", variables, bun: { release: "1.3.13", revision: "bf2e2cec",
    executableDigest: h("1"), webkitVersion: "WebKit-1", javascriptCoreVersion: "JSC-1", icuVersion: "76.1",
    unicodeVersion: "16.0", toolchainManifestDigest: h("2"), toolchainRowDigest: h("3") } };
}
function certificate(): CompiledArtifactBuildCertificate {
  return { schema: BUILD_CERTIFICATE_SCHEMA, protocol: OWNER_PROTOCOL, artifact: "compiled-parser",
    artifactPath: COMPILED_ARTIFACT_SPECS["compiled-parser"].artifactPath,
    repositoryEpoch: h("6"), ownerEpoch: h("7"), dependencyDigest: h("8"), portableGenerationAbi: PORTABLE_GENERATION_ABI,
    artifactByteLength: 456, artifactDigest: h("9"), producerCheckPackageDigest: h("c"),
    inputManifest: { coveredSourceArchiveDigest: h("a"), repository: { digest: h("6"), fileCount: 100, byteLength: 1000 },
      ownerOverlay: { digest: h("b"), fileCount: 10, byteLength: 200 }, dependencies: { digest: h("8"), fileCount: 0, byteLength: 0 } },
    producerInput: makeRawCompiledArtifactInput({ artifact: "compiled-parser", acquisitionDigest: h("d"), ownerOverlayDigest: h("b"),
      repositoryExactDigest: h("e"), dependencyDigest: h("8"), environmentFingerprint: computeEnvironmentFingerprint(environment()),
      recoveryStubVersion: h("f"), portableGenerationAbi: PORTABLE_GENERATION_ABI }), producerAttestations: [] };
}
function attestation(cert: CompiledArtifactBuildCertificate): CompiledArtifactCheckAttestation {
  const env = environment();
  return { schema: "fenel.compiled-artifact-check-attestation.v2", result: "MATCH", artifact: cert.artifact,
    origin: { kind: "local" }, checkPackageDigest: cert.producerCheckPackageDigest,
    coveredSourceArchiveDigest: cert.inputManifest.coveredSourceArchiveDigest, certificateBaseDigest: computeCertificateBaseDigest(cert),
    repositoryEpoch: cert.repositoryEpoch, ownerEpoch: cert.ownerEpoch, dependencyDigest: cert.dependencyDigest,
    environment: env, environmentFingerprint: computeEnvironmentFingerprint(env), artifactByteLength: cert.artifactByteLength,
    artifactDigest: cert.artifactDigest, attestationPolicyDigest: h("0") };
}
function fresh(): FreshArtifactRecord {
  return { schema: ARTIFACT_FRESHNESS_SCHEMA, artifact: "compiled-parser", verdict: "FRESH", portableSeal: "local-only",
    repositoryEpoch: h("1"), ownerEpoch: h("2"), dependencyDigest: h("3"), environmentFingerprint: h("4"),
    artifactDigest: h("5"), certificateDigest: h("6"), attestationPolicyDigest: h("7"), inputKey: h("8"),
    currentSourceArchiveDigest: h("9"), sourceRelation: "same-epoch",
    producer: { repositoryEpoch: h("1"), ownerEpoch: h("2"), coveredSourceArchiveDigest: h("9"),
      inputKey: h("8"), environmentFingerprint: h("4") } };
}

test("v3 preserves producer coordinates and commits raw inputs and stable-live package digest inside the attested base", () => {
  const original = certificate();
  const entry = attestation(original);
  const signed = { ...original, producerAttestations: [entry] };
  const decoded = validateBuildCertificate(signed);
  expect(decoded.repositoryEpoch).toBe(original.repositoryEpoch);
  expect(decoded.ownerEpoch).toBe(original.ownerEpoch);
  expect(decoded.inputManifest).toEqual(original.inputManifest);
  expect(computeCertificateBaseDigest(decoded)).toBe(computeCertificateBaseDigest(original));
  expect(computeCertificateDigest(decoded)).not.toBe(computeCertificateDigest(original));
  expect(parseBuildCertificate(encodeCanonicalJson(signed))).toEqual(decoded);
  const changedPackage = { ...signed, producerCheckPackageDigest: h("0") };
  expect(computeCertificateBaseDigest(changedPackage)).not.toBe(entry.certificateBaseDigest);
  expect(() => validateBuildCertificate(changedPackage)).toThrow();
  const { schema: _s, contract: _c, key: _k, ...parts } = original.producerInput;
  const changedInput = { ...signed, producerInput: makeRawCompiledArtifactInput({ ...parts, acquisitionDigest: h("0") }) };
  expect(computeCertificateBaseDigest(changedInput)).not.toBe(entry.certificateBaseDigest);
  expect(() => validateBuildCertificate(changedInput)).toThrow();
});

test("v3 raw producer input coordinate, dependency, overlay, ABI and key cannot disagree with the original base", () => {
  const original = certificate();
  const { schema: _s, contract: _c, key: _k, ...parts } = original.producerInput;
  for (const producerInput of [makeRawCompiledArtifactInput({ ...parts, artifact: "compiled-resolver" }),
    makeRawCompiledArtifactInput({ ...parts, dependencyDigest: h("0") }),
    makeRawCompiledArtifactInput({ ...parts, ownerOverlayDigest: h("0") }),
    { ...original.producerInput, portableGenerationAbi: "fenel.compiled-artifact-generation.v2" },
    { ...original.producerInput, key: h("0") }]) {
    expect(() => validateBuildCertificate({ ...original, producerInput })).toThrow();
  }
  // The exact-files digest is deliberately not the whole-repository epoch.
  expect(original.producerInput.repositoryExactDigest).not.toBe(original.repositoryEpoch);
  expect(validateBuildCertificate(original).producerInput.repositoryExactDigest).toBe(h("e"));
});

test("v3 and v2 wire migrations have no missing-field or legacy-schema defaults", () => {
  const original = certificate();
  for (const key of ["producerInput", "producerCheckPackageDigest"]) {
    const value = { ...original }; Reflect.deleteProperty(value, key);
    expect(() => validateBuildCertificate(value)).toThrow();
  }
  expect(() => validateBuildCertificate({ ...original, schema: "fenel.compiled-artifact-build-certificate.v2" })).toThrow();
  expect(() => validateBuildCertificate({ ...original, producerCheckPackageDigest: "not-a-digest" })).toThrow();
  expect(() => validateBuildCertificate({ ...original, extra: true })).toThrow();
  const current = fresh();
  expect(() => validateArtifactFreshnessRecord({ ...current, schema: "fenel.artifact-freshness.v1" })).toThrow();
  for (const key of ["inputKey", "currentSourceArchiveDigest", "sourceRelation", "producer"]) {
    const value = { ...current }; Reflect.deleteProperty(value, key);
    expect(() => validateArtifactFreshnessRecord(value)).toThrow();
  }
});

test("same-epoch requires each producer/current source coordinate to agree", () => {
  const original = fresh();
  expect(parseArtifactFreshnessRecord(encodeCanonicalJson(original))).toEqual(original);
  expect(validateArtifactFreshnessRecord({ ...original, portableSeal: "sealed" }).verdict).toBe("FRESH");
  for (const change of [{ repositoryEpoch: h("0") }, { ownerEpoch: h("0") }, { currentSourceArchiveDigest: h("0") }]) {
    expect(() => validateArtifactFreshnessRecord({ ...original, ...change })).toThrow();
  }
  expect(() => validateArtifactFreshnessRecord({ ...original, inputKey: h("0") })).toThrow();
});

test("same-epoch foreign full-check framing alone permits differing environment keys", () => {
  const original = fresh();
  const foreign = { ...original, environmentFingerprint: h("0"), inputKey: h("a") };
  expect(validateArtifactFreshnessRecord(foreign).verdict).toBe("FRESH");
  // Framing is not a MATCH attestation; controller must prove the actual foreign
  // full check and compare every non-environment raw component separately.
  expect(() => validateArtifactFreshnessRecord({ ...foreign, sourceRelation: "complete-input-equal", repositoryEpoch: h("b") })).toThrow();
});

test("complete-input-equal is disjoint, same-environment, equal-key, and local-only", () => {
  const original = fresh();
  expect(() => validateArtifactFreshnessRecord({ ...original, sourceRelation: "complete-input-equal" })).toThrow();
  for (const change of [{ repositoryEpoch: h("0") }, { ownerEpoch: h("0") }, { currentSourceArchiveDigest: h("0") }]) {
    const retained = { ...original, ...change, sourceRelation: "complete-input-equal" };
    expect(validateArtifactFreshnessRecord(retained).verdict).toBe("FRESH");
    expect(() => validateArtifactFreshnessRecord({ ...retained, portableSeal: "sealed" })).toThrow();
    expect(() => validateArtifactFreshnessRecord({ ...retained, inputKey: h("a") })).toThrow();
    expect(() => validateArtifactFreshnessRecord({ ...retained, environmentFingerprint: h("a") })).toThrow();
  }
});

test("producer relation is closed own SHA256 data, without hidden fields or getter evaluation", () => {
  const original = fresh();
  for (const key of Object.keys(original.producer)) {
    const producer = { ...original.producer }; Reflect.deleteProperty(producer, key);
    expect(() => validateArtifactFreshnessRecord({ ...original, producer })).toThrow();
    expect(() => validateArtifactFreshnessRecord({ ...original, producer: { ...original.producer, [key]: "bad" } })).toThrow();
  }
  expect(() => validateArtifactFreshnessRecord({ ...original, producer: { ...original.producer, extra: true } })).toThrow();
  let reads = 0;
  const producer = { ...original.producer };
  Object.defineProperty(producer, "inputKey", { get() { reads++; return h("8"); }, enumerable: true });
  expect(() => validateArtifactFreshnessRecord({ ...original, producer })).toThrow();
  const hidden = { ...original };
  Object.defineProperty(hidden, "hidden", { value: true });
  expect(() => validateArtifactFreshnessRecord(hidden)).toThrow();
  expect(reads).toBe(0);
});

test("nonfresh variants keep their old identity tuple and accept the new explicit stale reason", () => {
  const stale = { schema: ARTIFACT_FRESHNESS_SCHEMA, artifact: "compiled-parser", verdict: "STALE", portableSeal: "unsealed",
    attestationPolicyDigest: h("0"), reasons: ["complete-input-key-mismatch"], repositoryEpoch: h("1") } as const;
  expect(validateArtifactFreshnessRecord(stale)).toEqual(stale);
  expect(() => validateArtifactFreshnessRecord({ ...stale, producer: fresh().producer })).toThrow();
  const undecidable = { schema: ARTIFACT_FRESHNESS_SCHEMA, artifact: "compiled-parser", verdict: "UNDECIDABLE", portableSeal: "unresolved",
    attestationPolicyDigest: null, reasons: ["attestation-policy-uncomputable"], policyComputationError: "missing-input" } as const;
  expect(validateArtifactFreshnessRecord(undecidable)).toEqual(undecidable);
});

test("shared raw input shape is inline and both authored JSON schema goldens match canonical exports", () => {
  expect(BUILD_CERTIFICATE_JSON_SCHEMA.properties.producerInput).toEqual(RAW_COMPILED_INPUT_JSON_SCHEMA);
  expect(BUILD_CERTIFICATE_JSON_SCHEMA.properties.schema.const).toBe("fenel.compiled-artifact-build-certificate.v3");
  expect(ARTIFACT_FRESHNESS_JSON_SCHEMA.oneOf[0].properties.schema.const).toBe("fenel.artifact-freshness.v2");
  expect(readFileSync(new URL("./compiled-artifact-build-certificate.schema.json", import.meta.url)))
    .toEqual(Buffer.from(encodeCanonicalJson(BUILD_CERTIFICATE_JSON_SCHEMA)));
  expect(readFileSync(new URL("./compiled-artifact-freshness.schema.json", import.meta.url)))
    .toEqual(Buffer.from(encodeCanonicalJson(ARTIFACT_FRESHNESS_JSON_SCHEMA)));
});
