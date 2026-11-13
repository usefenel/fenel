/**
 * Closed owner wire protocol and build-certificate contract.
 *
 * This is C2 build tooling: byte identities, evidence validation, and generic
 * verdict decoding only.  It has no registry, function, shard, or product
 * semantic knowledge.
 */

import { sha256Raw } from "./artifact-bytes";
import { RAW_COMPILED_INPUT_JSON_SCHEMA, validateRawCompiledArtifactInput,
  type RawCompiledArtifactInput } from "./compiled-artifact-input-key";
import {
  ArtifactWireContractError,
  assertUtf8SortedUnique,
  encodeCanonicalJson,
  expectClosedKeys,
  expectSafeUint,
  expectSha256,
  expectWireArray,
  expectWireLiteral,
  expectWireRecord,
  expectWireString,
  parseCanonicalJson,
  type WireJsonValue,
} from "./artifact-wire-json";
import {
  COMPILED_ARTIFACT_IDS,
  assertCanonicalProducerAttestations,
  validateCompiledArtifactCheckAttestation,
  type CompiledArtifactCheckAttestation,
  type CompiledArtifactId,
  type Sha256Hex,
} from "./compiled-artifact-attestation";

export type { CompiledArtifactId, Sha256Hex } from "./compiled-artifact-attestation";

export const ARTIFACT_FRESHNESS_SCHEMA = "fenel.artifact-freshness.v2" as const;
export const BUILD_CERTIFICATE_SCHEMA = "fenel.compiled-artifact-build-certificate.v3" as const;
export const OWNER_PROTOCOL = "fenel.compiled-artifact-owner.v1" as const;
export const PORTABLE_GENERATION_ABI = "fenel.compiled-artifact-generation.v1" as const;

export const COMPILED_ARTIFACT_SPECS: Readonly<Record<CompiledArtifactId, {
  readonly artifactPath: string;
  readonly certificatePath: string;
}>> = {
  "compiled-parser": {
    artifactPath: "implementations/typescript/engine/src/generated/compiled-parser.generated.ts",
    certificatePath:
      "implementations/typescript/engine/src/generated/compiled-parser.build-certificate.json",
  },
  "compiled-resolver": {
    artifactPath: "implementations/typescript/engine/src/generated/compiled-resolver.generated.ts",
    certificatePath:
      "implementations/typescript/engine/src/generated/compiled-resolver.build-certificate.json",
  },
};

export const PORTABLE_SEALS = [
  "invalid-policy",
  "local-only",
  "sealed",
  "unresolved",
  "unsealed",
] as const;
export type PortableSeal = (typeof PORTABLE_SEALS)[number];

export const STALE_REASONS = [
  "artifact-digest-mismatch",
  "artifact-invalid-eol",
  "artifact-length-mismatch",
  "artifact-missing",
  "certificate-artifact-mismatch",
  "certificate-invalid",
  "certificate-missing",
  "complete-input-key-mismatch",
  "dependency-digest-mismatch",
  "environment-fingerprint-mismatch",
  "owner-epoch-mismatch",
  "producer-attestation-missing",
  "producer-environment-mismatch",
  "producer-policy-mismatch",
  "repository-epoch-mismatch",
] as const;
export type StaleReason = (typeof STALE_REASONS)[number];

export const UNDECIDABLE_REASONS = [
  "artifact-unreadable",
  "certificate-unreadable",
  "concurrent-mutation",
  "dependency-uncomputable",
  "environment-uncomputable",
  "owner-uncomputable",
  "portable-proof-uncomputable",
  "repository-uncomputable",
  "unsupported-environment",
] as const;
export type UndecidableReason = (typeof UNDECIDABLE_REASONS)[number];

export const POLICY_UNCOMPUTABLE_REASON = "attestation-policy-uncomputable" as const;
export const POLICY_COMPUTATION_ERRORS = [
  "ambiguous-input",
  "canonicalization-failed",
  "missing-input",
  "unreadable-input",
] as const;
export type PolicyComputationError = (typeof POLICY_COMPUTATION_ERRORS)[number];

type CompleteIdentityTuple = {
  readonly repositoryEpoch: Sha256Hex;
  readonly ownerEpoch: Sha256Hex;
  readonly dependencyDigest: Sha256Hex;
  readonly environmentFingerprint: Sha256Hex;
  readonly artifactDigest: Sha256Hex;
  readonly certificateDigest: Sha256Hex;
};

type ObservedIdentityTuple = Partial<CompleteIdentityTuple>;

export type FreshArtifactProducer = {
  readonly repositoryEpoch: Sha256Hex;
  readonly ownerEpoch: Sha256Hex;
  readonly coveredSourceArchiveDigest: Sha256Hex;
  readonly inputKey: Sha256Hex;
  readonly environmentFingerprint: Sha256Hex;
};

export type FreshArtifactRecord = CompleteIdentityTuple & {
  readonly schema: typeof ARTIFACT_FRESHNESS_SCHEMA;
  readonly artifact: CompiledArtifactId;
  readonly verdict: "FRESH";
  readonly portableSeal: "sealed" | "local-only";
  readonly attestationPolicyDigest: Sha256Hex;
  readonly inputKey: Sha256Hex;
  readonly currentSourceArchiveDigest: Sha256Hex;
  readonly sourceRelation: "same-epoch" | "complete-input-equal";
  readonly producer: FreshArtifactProducer;
};

export type StaleArtifactRecord = ObservedIdentityTuple & {
  readonly schema: typeof ARTIFACT_FRESHNESS_SCHEMA;
  readonly artifact: CompiledArtifactId;
  readonly verdict: "STALE";
  readonly portableSeal: "sealed" | "unsealed" | "invalid-policy";
  readonly reasons: readonly [StaleReason, ...StaleReason[]];
  readonly attestationPolicyDigest: Sha256Hex;
};

export type UndecidableArtifactRecord = ObservedIdentityTuple & {
  readonly schema: typeof ARTIFACT_FRESHNESS_SCHEMA;
  readonly artifact: CompiledArtifactId;
  readonly verdict: "UNDECIDABLE";
  readonly portableSeal: "sealed" | "unsealed" | "invalid-policy" | "unresolved";
  readonly reasons: readonly [UndecidableReason, ...UndecidableReason[]];
  readonly attestationPolicyDigest: Sha256Hex;
};

export type PolicyUndecidableArtifactRecord = ObservedIdentityTuple & {
  readonly schema: typeof ARTIFACT_FRESHNESS_SCHEMA;
  readonly artifact: CompiledArtifactId;
  readonly verdict: "UNDECIDABLE";
  readonly portableSeal: "unresolved";
  readonly reasons: readonly [typeof POLICY_UNCOMPUTABLE_REASON];
  readonly attestationPolicyDigest: null;
  readonly policyComputationError: PolicyComputationError;
};

export type ArtifactFreshnessRecord =
  | FreshArtifactRecord
  | StaleArtifactRecord
  | UndecidableArtifactRecord
  | PolicyUndecidableArtifactRecord;

export const ALLOWED_VERDICT_SEAL_PAIRS = [
  ["FRESH", "local-only"],
  ["FRESH", "sealed"],
  ["STALE", "invalid-policy"],
  ["STALE", "sealed"],
  ["STALE", "unsealed"],
  ["UNDECIDABLE", "invalid-policy"],
  ["UNDECIDABLE", "sealed"],
  ["UNDECIDABLE", "unresolved"],
  ["UNDECIDABLE", "unsealed"],
] as const;

const SHA256_SCHEMA = { type: "string", pattern: "^[0-9a-f]{64}$" } as const;
const FRESH_PRODUCER_SCHEMA = {
  type: "object", additionalProperties: false,
  properties: {
    coveredSourceArchiveDigest: SHA256_SCHEMA, environmentFingerprint: SHA256_SCHEMA,
    inputKey: SHA256_SCHEMA, ownerEpoch: SHA256_SCHEMA, repositoryEpoch: SHA256_SCHEMA,
  },
  required: ["coveredSourceArchiveDigest", "environmentFingerprint", "inputKey", "ownerEpoch", "repositoryEpoch"],
} as const;
const IDENTITY_PROPERTIES = {
  artifactDigest: SHA256_SCHEMA,
  certificateDigest: SHA256_SCHEMA,
  dependencyDigest: SHA256_SCHEMA,
  environmentFingerprint: SHA256_SCHEMA,
  ownerEpoch: SHA256_SCHEMA,
  repositoryEpoch: SHA256_SCHEMA,
} as const;
const COMMON_FRESHNESS_PROPERTIES = {
  schema: { const: ARTIFACT_FRESHNESS_SCHEMA },
  artifact: { enum: COMPILED_ARTIFACT_IDS },
  ...IDENTITY_PROPERTIES,
} as const;

const FRESH_REQUIRED = [
  "artifact",
  "artifactDigest",
  "attestationPolicyDigest",
  "certificateDigest",
  "currentSourceArchiveDigest",
  "dependencyDigest",
  "environmentFingerprint",
  "inputKey",
  "ownerEpoch",
  "portableSeal",
  "producer",
  "repositoryEpoch",
  "schema",
  "sourceRelation",
  "verdict",
] as const;
const NONFRESH_REQUIRED = [
  "artifact",
  "attestationPolicyDigest",
  "portableSeal",
  "reasons",
  "schema",
  "verdict",
] as const;

export const ARTIFACT_FRESHNESS_JSON_SCHEMA = {
  $schema: "https://json-schema.org/draft/2020-12/schema",
  $id: "compiled-artifact-freshness.schema.json",
  title: "Fenel artifact freshness record v2",
  oneOf: [
    {
      type: "object",
      additionalProperties: false,
      properties: {
        ...COMMON_FRESHNESS_PROPERTIES,
        verdict: { const: "FRESH" },
        portableSeal: { enum: ["local-only", "sealed"] },
        attestationPolicyDigest: SHA256_SCHEMA,
        currentSourceArchiveDigest: SHA256_SCHEMA,
        inputKey: SHA256_SCHEMA,
        producer: FRESH_PRODUCER_SCHEMA,
        sourceRelation: { enum: ["same-epoch", "complete-input-equal"] },
      },
      required: FRESH_REQUIRED,
      // Standard JSON Schema cannot compare values at separate instance paths.
      // The decoder additionally verifies the exact source relation below.
      allOf: [{ if: { properties: { sourceRelation: { const: "complete-input-equal" } }, required: ["sourceRelation"] },
        then: { properties: { portableSeal: { const: "local-only" } } } }],
    },
    {
      type: "object",
      additionalProperties: false,
      properties: {
        ...COMMON_FRESHNESS_PROPERTIES,
        verdict: { const: "STALE" },
        portableSeal: { enum: ["invalid-policy", "sealed", "unsealed"] },
        reasons: { type: "array", minItems: 1, uniqueItems: true, items: { enum: STALE_REASONS } },
        attestationPolicyDigest: SHA256_SCHEMA,
      },
      required: NONFRESH_REQUIRED,
    },
    {
      type: "object",
      additionalProperties: false,
      properties: {
        ...COMMON_FRESHNESS_PROPERTIES,
        verdict: { const: "UNDECIDABLE" },
        portableSeal: { enum: ["invalid-policy", "sealed", "unresolved", "unsealed"] },
        reasons: {
          type: "array",
          minItems: 1,
          uniqueItems: true,
          items: { enum: UNDECIDABLE_REASONS },
        },
        attestationPolicyDigest: SHA256_SCHEMA,
      },
      required: NONFRESH_REQUIRED,
    },
    {
      type: "object",
      additionalProperties: false,
      properties: {
        ...COMMON_FRESHNESS_PROPERTIES,
        verdict: { const: "UNDECIDABLE" },
        portableSeal: { const: "unresolved" },
        reasons: {
          type: "array",
          prefixItems: [{ const: POLICY_UNCOMPUTABLE_REASON }],
          minItems: 1,
          maxItems: 1,
        },
        attestationPolicyDigest: { type: "null" },
        policyComputationError: { enum: POLICY_COMPUTATION_ERRORS },
      },
      required: [...NONFRESH_REQUIRED, "policyComputationError"],
    },
  ],
} as const;

const IDENTITY_KEYS = [
  "artifactDigest",
  "certificateDigest",
  "dependencyDigest",
  "environmentFingerprint",
  "ownerEpoch",
  "repositoryEpoch",
] as const;
const FRESH_KEYS = [
  "artifact",
  ...IDENTITY_KEYS,
  "attestationPolicyDigest",
  "portableSeal",
  "currentSourceArchiveDigest",
  "inputKey",
  "producer",
  "schema",
  "sourceRelation",
  "verdict",
] as const;
const NONFRESH_BASE_KEYS = [
  "artifact",
  "attestationPolicyDigest",
  "portableSeal",
  "reasons",
  "schema",
  "verdict",
] as const;

function validateReasonList<const T extends string>(
  value: unknown,
  admitted: readonly T[],
  path: string,
): readonly [T, ...T[]] {
  const raw = expectWireArray(value, path);
  if (raw.length === 0) throw new ArtifactWireContractError(path, "at least one reason is required");
  const reasons = raw.map((item, index) =>
    expectWireLiteral(item, admitted, `${path}[${index}]`));
  assertUtf8SortedUnique(reasons, path);
  return reasons as [T, ...T[]];
}

function validateOptionalIdentities(
  record: Readonly<Record<string, WireJsonValue>>,
  path: string,
): ObservedIdentityTuple {
  const result: Record<string, string> = {};
  for (const key of IDENTITY_KEYS) {
    if (Object.prototype.hasOwnProperty.call(record, key)) {
      result[key] = expectSha256(record[key], `${path}.${key}`);
    }
  }
  return result;
}

/** Closed value framing for callers that already decoded trusted wire bytes.
 * Read descriptors once; never normalize hidden/inherited/getter fields into
 * a valid protocol record. Proxy reflection remains a host boundary.
 */
function protocolOwnRecord(value: unknown, path: string): Record<string, WireJsonValue> {
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    throw new ArtifactWireContractError(path, "expected a plain own-data record");
  }
  const prototype = Object.getPrototypeOf(value);
  if (prototype !== Object.prototype && prototype !== null) throw new ArtifactWireContractError(path, "exotic record prototype");
  const copy: Record<string, unknown> = Object.create(null);
  const descriptors = Object.getOwnPropertyDescriptors(value);
  for (const key of Reflect.ownKeys(descriptors)) {
    if (typeof key !== "string") throw new ArtifactWireContractError(path, "symbol record key");
    const slot = Object.getOwnPropertyDescriptor(descriptors, key)!.value as PropertyDescriptor;
    if (!("value" in slot) || slot.enumerable !== true) throw new ArtifactWireContractError(`${path}.${key}`, "hidden or accessor-backed field");
    copy[key] = slot.value;
  }
  return expectWireRecord(copy, path);
}

function validateFreshProducer(value: unknown, path: string): FreshArtifactProducer {
  const row = protocolOwnRecord(value, path);
  expectClosedKeys(row, ["repositoryEpoch", "ownerEpoch", "coveredSourceArchiveDigest", "inputKey", "environmentFingerprint"], [], path);
  return Object.freeze({ repositoryEpoch: expectSha256(row.repositoryEpoch, path + ".repositoryEpoch"),
    ownerEpoch: expectSha256(row.ownerEpoch, path + ".ownerEpoch"),
    coveredSourceArchiveDigest: expectSha256(row.coveredSourceArchiveDigest, path + ".coveredSourceArchiveDigest"),
    inputKey: expectSha256(row.inputKey, path + ".inputKey"),
    environmentFingerprint: expectSha256(row.environmentFingerprint, path + ".environmentFingerprint") });
}

export function validateArtifactFreshnessRecord(
  value: unknown,
  path = "$",
): ArtifactFreshnessRecord {
  const record = protocolOwnRecord(value, path);
  const verdict = expectWireLiteral(
    record.verdict,
    ["FRESH", "STALE", "UNDECIDABLE"] as const,
    `${path}.verdict`,
  );
  const artifact = expectWireLiteral(record.artifact, COMPILED_ARTIFACT_IDS, `${path}.artifact`);
  expectWireLiteral(record.schema, [ARTIFACT_FRESHNESS_SCHEMA] as const, `${path}.schema`);

  if (verdict === "FRESH") {
    expectClosedKeys(record, FRESH_KEYS, [], path);
    const fresh: FreshArtifactRecord = {
      schema: ARTIFACT_FRESHNESS_SCHEMA,
      artifact,
      verdict,
      portableSeal: expectWireLiteral(
        record.portableSeal,
        ["local-only", "sealed"] as const,
        `${path}.portableSeal`,
      ),
      repositoryEpoch: expectSha256(record.repositoryEpoch, `${path}.repositoryEpoch`),
      ownerEpoch: expectSha256(record.ownerEpoch, `${path}.ownerEpoch`),
      dependencyDigest: expectSha256(record.dependencyDigest, `${path}.dependencyDigest`),
      environmentFingerprint: expectSha256(
        record.environmentFingerprint,
        `${path}.environmentFingerprint`,
      ),
      artifactDigest: expectSha256(record.artifactDigest, `${path}.artifactDigest`),
      certificateDigest: expectSha256(record.certificateDigest, `${path}.certificateDigest`),
      attestationPolicyDigest: expectSha256(
        record.attestationPolicyDigest,
        `${path}.attestationPolicyDigest`,
      ),
      inputKey: expectSha256(record.inputKey, `${path}.inputKey`),
      currentSourceArchiveDigest: expectSha256(record.currentSourceArchiveDigest, `${path}.currentSourceArchiveDigest`),
      sourceRelation: expectWireLiteral(record.sourceRelation, ["same-epoch", "complete-input-equal"], `${path}.sourceRelation`),
      producer: validateFreshProducer(record.producer, `${path}.producer`),
    };
    const sameSource = fresh.repositoryEpoch === fresh.producer.repositoryEpoch
      && fresh.ownerEpoch === fresh.producer.ownerEpoch
      && fresh.currentSourceArchiveDigest === fresh.producer.coveredSourceArchiveDigest;
    const sameEnvironment = fresh.environmentFingerprint === fresh.producer.environmentFingerprint;
    if (fresh.sourceRelation === "same-epoch") {
      if (!sameSource) throw new ArtifactWireContractError(`${path}.sourceRelation`, "same-epoch requires all producer/current source coordinates to agree");
      if (sameEnvironment && fresh.inputKey !== fresh.producer.inputKey) {
        throw new ArtifactWireContractError(`${path}.inputKey`, "same-environment source baseline requires equal complete input keys");
      }
      // Foreign-environment keys may differ ONLY here. Controller glue still
      // requires its real full-check attestation and equal non-environment inputs.
    } else {
      if (sameSource || !sameEnvironment || fresh.inputKey !== fresh.producer.inputKey) {
        throw new ArtifactWireContractError(`${path}.sourceRelation`, "complete-input-equal requires equal keys/environment and differing source coordinates");
      }
      if (fresh.portableSeal !== "local-only") {
        throw new ArtifactWireContractError(`${path}.portableSeal`, "cross-epoch input retention cannot transport a historical portable seal");
      }
    }
    return fresh;
  }

  const optional = [...IDENTITY_KEYS];
  if (verdict === "STALE") {
    expectClosedKeys(record, NONFRESH_BASE_KEYS, optional, path);
    return {
      schema: ARTIFACT_FRESHNESS_SCHEMA,
      artifact,
      verdict,
      portableSeal: expectWireLiteral(
        record.portableSeal,
        ["invalid-policy", "sealed", "unsealed"] as const,
        `${path}.portableSeal`,
      ),
      reasons: validateReasonList(record.reasons, STALE_REASONS, `${path}.reasons`),
      attestationPolicyDigest: expectSha256(
        record.attestationPolicyDigest,
        `${path}.attestationPolicyDigest`,
      ),
      ...validateOptionalIdentities(record, path),
    };
  }

  if (record.attestationPolicyDigest === null) {
    expectClosedKeys(
      record,
      [...NONFRESH_BASE_KEYS, "policyComputationError"],
      optional,
      path,
    );
    const reasons = expectWireArray(record.reasons, `${path}.reasons`);
    if (reasons.length !== 1 || reasons[0] !== POLICY_UNCOMPUTABLE_REASON) {
      throw new ArtifactWireContractError(
        `${path}.reasons`,
        `a null policy digest requires exactly ${JSON.stringify(POLICY_UNCOMPUTABLE_REASON)}`,
      );
    }
    return {
      schema: ARTIFACT_FRESHNESS_SCHEMA,
      artifact,
      verdict,
      portableSeal: expectWireLiteral(record.portableSeal, ["unresolved"] as const, `${path}.portableSeal`),
      reasons: [POLICY_UNCOMPUTABLE_REASON],
      attestationPolicyDigest: null,
      policyComputationError: expectWireLiteral(
        record.policyComputationError,
        POLICY_COMPUTATION_ERRORS,
        `${path}.policyComputationError`,
      ),
      ...validateOptionalIdentities(record, path),
    };
  }

  expectClosedKeys(record, NONFRESH_BASE_KEYS, optional, path);
  return {
    schema: ARTIFACT_FRESHNESS_SCHEMA,
    artifact,
    verdict,
    portableSeal: expectWireLiteral(
      record.portableSeal,
      ["invalid-policy", "sealed", "unresolved", "unsealed"] as const,
      `${path}.portableSeal`,
    ),
    reasons: validateReasonList(record.reasons, UNDECIDABLE_REASONS, `${path}.reasons`),
    attestationPolicyDigest: expectSha256(
      record.attestationPolicyDigest,
      `${path}.attestationPolicyDigest`,
    ),
    ...validateOptionalIdentities(record, path),
  };
}

export function parseArtifactFreshnessRecord(bytes: Uint8Array): ArtifactFreshnessRecord {
  return validateArtifactFreshnessRecord(parseCanonicalJson(bytes));
}

export type ByteManifestSummary = {
  readonly digest: Sha256Hex;
  readonly fileCount: number;
  readonly byteLength: number;
};

export type BuildCertificateInputManifest = {
  readonly coveredSourceArchiveDigest: Sha256Hex;
  readonly repository: ByteManifestSummary;
  readonly ownerOverlay: ByteManifestSummary;
  readonly dependencies: ByteManifestSummary;
};

export type CompiledArtifactBuildCertificateBase = {
  readonly schema: typeof BUILD_CERTIFICATE_SCHEMA;
  readonly protocol: typeof OWNER_PROTOCOL;
  readonly artifact: CompiledArtifactId;
  readonly artifactPath: string;
  readonly repositoryEpoch: Sha256Hex;
  readonly ownerEpoch: Sha256Hex;
  readonly dependencyDigest: Sha256Hex;
  readonly portableGenerationAbi: typeof PORTABLE_GENERATION_ABI;
  readonly artifactByteLength: number;
  readonly artifactDigest: Sha256Hex;
  readonly inputManifest: BuildCertificateInputManifest;
  readonly producerInput: RawCompiledArtifactInput;
  readonly producerCheckPackageDigest: Sha256Hex;
};

export type CompiledArtifactBuildCertificate = CompiledArtifactBuildCertificateBase & {
  readonly producerAttestations: readonly CompiledArtifactCheckAttestation[];
};

const MANIFEST_SUMMARY_SCHEMA = {
  type: "object",
  additionalProperties: false,
  properties: {
    byteLength: { type: "integer", minimum: 0, maximum: Number.MAX_SAFE_INTEGER },
    digest: SHA256_SCHEMA,
    fileCount: { type: "integer", minimum: 0, maximum: Number.MAX_SAFE_INTEGER },
  },
  required: ["byteLength", "digest", "fileCount"],
} as const;

export const BUILD_CERTIFICATE_JSON_SCHEMA = {
  $schema: "https://json-schema.org/draft/2020-12/schema",
  $id: "compiled-artifact-build-certificate.schema.json",
  title: "Fenel compiled-artifact build certificate v3",
  type: "object",
  additionalProperties: false,
  properties: {
    schema: { const: BUILD_CERTIFICATE_SCHEMA },
    protocol: { const: OWNER_PROTOCOL },
    artifact: { enum: COMPILED_ARTIFACT_IDS },
    artifactPath: { type: "string", minLength: 1 },
    repositoryEpoch: SHA256_SCHEMA,
    ownerEpoch: SHA256_SCHEMA,
    dependencyDigest: SHA256_SCHEMA,
    portableGenerationAbi: { const: PORTABLE_GENERATION_ABI },
    artifactByteLength: { type: "integer", minimum: 0, maximum: Number.MAX_SAFE_INTEGER },
    artifactDigest: SHA256_SCHEMA,
    producerInput: RAW_COMPILED_INPUT_JSON_SCHEMA,
    producerCheckPackageDigest: SHA256_SCHEMA,
    inputManifest: {
      type: "object",
      additionalProperties: false,
      properties: {
        coveredSourceArchiveDigest: SHA256_SCHEMA,
        dependencies: MANIFEST_SUMMARY_SCHEMA,
        ownerOverlay: MANIFEST_SUMMARY_SCHEMA,
        repository: MANIFEST_SUMMARY_SCHEMA,
      },
      required: ["coveredSourceArchiveDigest", "dependencies", "ownerOverlay", "repository"],
    },
    producerAttestations: {
      type: "array",
      items: { $ref: "compiled-artifact-check-attestation.schema.json" },
    },
  },
  required: [
    "artifact",
    "artifactByteLength",
    "artifactDigest",
    "artifactPath",
    "dependencyDigest",
    "inputManifest",
    "ownerEpoch",
    "portableGenerationAbi",
    "producerAttestations",
    "producerCheckPackageDigest",
    "producerInput",
    "protocol",
    "repositoryEpoch",
    "schema",
  ],
  allOf: COMPILED_ARTIFACT_IDS.map((artifact) => ({
    if: { properties: { artifact: { const: artifact } }, required: ["artifact"] },
    then: { properties: { artifactPath: { const: COMPILED_ARTIFACT_SPECS[artifact].artifactPath },
      producerInput: { properties: { artifact: { const: artifact } } } } },
  })),
} as const;

const SUMMARY_KEYS = ["byteLength", "digest", "fileCount"] as const;

function validateManifestSummary(value: unknown, path: string): ByteManifestSummary {
  const record = protocolOwnRecord(value, path);
  expectClosedKeys(record, SUMMARY_KEYS, [], path);
  return {
    digest: expectSha256(record.digest, `${path}.digest`),
    fileCount: expectSafeUint(record.fileCount, `${path}.fileCount`),
    byteLength: expectSafeUint(record.byteLength, `${path}.byteLength`),
  };
}

const CERTIFICATE_KEYS = [
  "artifact",
  "artifactByteLength",
  "artifactDigest",
  "artifactPath",
  "dependencyDigest",
  "inputManifest",
  "ownerEpoch",
  "portableGenerationAbi",
  "producerAttestations",
  "producerCheckPackageDigest",
  "producerInput",
  "protocol",
  "repositoryEpoch",
  "schema",
] as const;

function sha256(bytes: Uint8Array): Sha256Hex {
  return sha256Raw(bytes);
}

export function certificateBaseProjection(
  certificate: CompiledArtifactBuildCertificate,
): CompiledArtifactBuildCertificateBase {
  const {
    producerAttestations: _producerAttestations,
    ...base
  } = certificate;
  return base;
}

/** Stable digest producers bind; the recursive producer array is not in this projection. */
export function computeCertificateBaseDigest(
  certificate: CompiledArtifactBuildCertificate | CompiledArtifactBuildCertificateBase,
): Sha256Hex {
  const withOptionalEntries = certificate as CompiledArtifactBuildCertificate;
  const base = Array.isArray(withOptionalEntries.producerAttestations)
    ? certificateBaseProjection(withOptionalEntries)
    : certificate;
  return sha256(encodeCanonicalJson(base));
}

/** Full canonical sidecar digest reported by a freshness record; never stored in the sidecar. */
export function computeCertificateDigest(
  certificate: CompiledArtifactBuildCertificate,
): Sha256Hex {
  return sha256(encodeCanonicalJson(certificate));
}

/** Hash already-observed bytes only after exact canonical/schema validation. */
export function validateAndDigestCertificateBytes(bytes: Uint8Array): {
  readonly certificate: CompiledArtifactBuildCertificate;
  readonly certificateDigest: Sha256Hex;
} {
  const value = parseCanonicalJson(bytes);
  const certificate = validateBuildCertificate(value);
  return { certificate, certificateDigest: sha256(bytes) };
}

export function validateBuildCertificate(
  value: unknown,
  path = "$",
): CompiledArtifactBuildCertificate {
  const record = protocolOwnRecord(value, path);
  expectClosedKeys(record, CERTIFICATE_KEYS, [], path);
  expectWireLiteral(record.schema, [BUILD_CERTIFICATE_SCHEMA] as const, `${path}.schema`);
  expectWireLiteral(record.protocol, [OWNER_PROTOCOL] as const, `${path}.protocol`);
  const artifact = expectWireLiteral(record.artifact, COMPILED_ARTIFACT_IDS, `${path}.artifact`);
  const artifactPath = expectWireString(record.artifactPath, `${path}.artifactPath`);
  if (artifactPath !== COMPILED_ARTIFACT_SPECS[artifact].artifactPath) {
    throw new ArtifactWireContractError(
      `${path}.artifactPath`,
      `must be ${JSON.stringify(COMPILED_ARTIFACT_SPECS[artifact].artifactPath)} for ${artifact}`,
    );
  }
  expectWireLiteral(
    record.portableGenerationAbi,
    [PORTABLE_GENERATION_ABI] as const,
    `${path}.portableGenerationAbi`,
  );
  const repositoryEpoch = expectSha256(record.repositoryEpoch, `${path}.repositoryEpoch`);
  const ownerEpoch = expectSha256(record.ownerEpoch, `${path}.ownerEpoch`);
  const dependencyDigest = expectSha256(record.dependencyDigest, `${path}.dependencyDigest`);
  const artifactByteLength = expectSafeUint(record.artifactByteLength, `${path}.artifactByteLength`);
  const artifactDigest = expectSha256(record.artifactDigest, `${path}.artifactDigest`);
  const producerInput = validateRawCompiledArtifactInput(record.producerInput, artifact);
  const producerCheckPackageDigest = expectSha256(record.producerCheckPackageDigest, `${path}.producerCheckPackageDigest`);

  const inputPath = `${path}.inputManifest`;
  const input = protocolOwnRecord(record.inputManifest, inputPath);
  expectClosedKeys(
    input,
    ["coveredSourceArchiveDigest", "dependencies", "ownerOverlay", "repository"],
    [],
    inputPath,
  );
  const inputManifest: BuildCertificateInputManifest = {
    coveredSourceArchiveDigest: expectSha256(
      input.coveredSourceArchiveDigest,
      `${inputPath}.coveredSourceArchiveDigest`,
    ),
    dependencies: validateManifestSummary(input.dependencies, `${inputPath}.dependencies`),
    ownerOverlay: validateManifestSummary(input.ownerOverlay, `${inputPath}.ownerOverlay`),
    repository: validateManifestSummary(input.repository, `${inputPath}.repository`),
  };
  if (inputManifest.repository.digest !== repositoryEpoch) {
    throw new ArtifactWireContractError(`${inputPath}.repository.digest`, "must equal repositoryEpoch");
  }
  if (inputManifest.dependencies.digest !== dependencyDigest) {
    throw new ArtifactWireContractError(`${inputPath}.dependencies.digest`, "must equal dependencyDigest");
  }
  if (producerInput.dependencyDigest !== dependencyDigest) {
    throw new ArtifactWireContractError(`${path}.producerInput.dependencyDigest`, "must equal producer certificate dependencyDigest");
  }
  if (producerInput.ownerOverlayDigest !== inputManifest.ownerOverlay.digest) {
    throw new ArtifactWireContractError(`${path}.producerInput.ownerOverlayDigest`, "must equal producer inputManifest.ownerOverlay.digest");
  }
  if (producerInput.portableGenerationAbi !== PORTABLE_GENERATION_ABI) {
    throw new ArtifactWireContractError(`${path}.producerInput.portableGenerationAbi`, "must equal producer certificate ABI");
  }

  const rawAttestations = expectWireArray(record.producerAttestations, `${path}.producerAttestations`);
  const producerAttestations = rawAttestations.map((entry, index) =>
    validateCompiledArtifactCheckAttestation(entry, `${path}.producerAttestations[${index}]`));
  const preliminary: CompiledArtifactBuildCertificate = {
    schema: BUILD_CERTIFICATE_SCHEMA,
    protocol: OWNER_PROTOCOL,
    artifact,
    artifactPath,
    repositoryEpoch,
    ownerEpoch,
    dependencyDigest,
    portableGenerationAbi: PORTABLE_GENERATION_ABI,
    artifactByteLength,
    artifactDigest,
    inputManifest,
    producerInput,
    producerCheckPackageDigest,
    producerAttestations,
  };
  const baseDigest = computeCertificateBaseDigest(preliminary);
  for (let index = 0; index < producerAttestations.length; index += 1) {
    const entry = producerAttestations[index]!;
    const entryPath = `${path}.producerAttestations[${index}]`;
    const bindings: ReadonlyArray<readonly [keyof CompiledArtifactCheckAttestation, unknown]> = [
      ["artifact", artifact],
      ["artifactByteLength", artifactByteLength],
      ["artifactDigest", artifactDigest],
      ["certificateBaseDigest", baseDigest],
      ["coveredSourceArchiveDigest", inputManifest.coveredSourceArchiveDigest],
      ["dependencyDigest", dependencyDigest],
      ["ownerEpoch", ownerEpoch],
      ["repositoryEpoch", repositoryEpoch],
    ];
    for (const [key, expected] of bindings) {
      if (entry[key] !== expected) {
        throw new ArtifactWireContractError(`${entryPath}.${key}`, "does not bind the sidecar base tuple");
      }
    }
  }
  assertCanonicalProducerAttestations(producerAttestations, `${path}.producerAttestations`);
  return preliminary;
}

export function parseBuildCertificate(bytes: Uint8Array): CompiledArtifactBuildCertificate {
  return validateBuildCertificate(parseCanonicalJson(bytes));
}

export type PortableSealEvidence = {
  readonly attestationPolicyDigest: Sha256Hex;
  readonly currentEnvironmentFingerprint?: Sha256Hex;
  readonly portableProofComputable: boolean;
};

function ciGroupKey(entry: CompiledArtifactCheckAttestation): string | undefined {
  if (entry.origin.kind !== "ci") return undefined;
  return [
    entry.origin.sourceCommit,
    entry.origin.workflowDigest,
    entry.origin.workflowRunId,
    String(entry.origin.workflowRunAttempt),
    entry.checkPackageDigest,
    entry.attestationPolicyDigest,
  ].join("\u0000");
}

function hasThreeFamilyCiSet(entries: readonly CompiledArtifactCheckAttestation[]): boolean {
  const familiesByGroup = new Map<string, Set<string>>();
  for (const entry of entries) {
    const key = ciGroupKey(entry);
    if (key === undefined) continue;
    const families = familiesByGroup.get(key) ?? new Set<string>();
    families.add(entry.environment.osFamily);
    familiesByGroup.set(key, families);
  }
  return [...familiesByGroup.values()].some(
    (families) => families.has("windows") && families.has("linux") && families.has("macos"),
  );
}

/** Total, disjoint evidence classification. Local verdict computation remains owner-owned. */
export function evaluatePortableSeal(
  certificate: CompiledArtifactBuildCertificate,
  evidence: PortableSealEvidence,
): PortableSeal {
  if (!evidence.portableProofComputable) return "unresolved";
  const current = certificate.producerAttestations.filter(
    (entry) => entry.attestationPolicyDigest === evidence.attestationPolicyDigest,
  );
  if (hasThreeFamilyCiSet(current)) return "sealed";
  if (
    evidence.currentEnvironmentFingerprint !== undefined
    && current.some((entry) => entry.environmentFingerprint === evidence.currentEnvironmentFingerprint)
  ) {
    return "local-only";
  }
  if (certificate.producerAttestations.some(
    (entry) => entry.attestationPolicyDigest !== evidence.attestationPolicyDigest,
  )) {
    return "invalid-policy";
  }
  return "unsealed";
}

export const OWNER_PROBE_EXIT_CODES = {
  FRESH: 0,
  STALE: 20,
  UNDECIDABLE: 21,
} as const;

export type OwnerProbeDecodeInput = {
  readonly stdout: Uint8Array;
  readonly exitCode: number | null;
  readonly expectedArtifact: CompiledArtifactId;
};

/** Fail-closed framing + exit/schema/id agreement; never fabricates an UNDECIDABLE record. */
export function decodeOwnerProbe(input: OwnerProbeDecodeInput): ArtifactFreshnessRecord {
  if (input.exitCode === null || !Object.values(OWNER_PROBE_EXIT_CODES).includes(input.exitCode as 0 | 20 | 21)) {
    throw new ArtifactWireContractError("probe.exitCode", `unknown or signal exit ${String(input.exitCode)}`);
  }
  const record = validateArtifactFreshnessRecord(parseCanonicalJson(input.stdout));
  if (record.artifact !== input.expectedArtifact) {
    throw new ArtifactWireContractError(
      "probe.artifact",
      `expected ${input.expectedArtifact}, received ${record.artifact}`,
    );
  }
  const expectedExit = OWNER_PROBE_EXIT_CODES[record.verdict];
  if (input.exitCode !== expectedExit) {
    throw new ArtifactWireContractError(
      "probe.exitCode",
      `exit ${input.exitCode} disagrees with ${record.verdict} (${expectedExit})`,
    );
  }
  return record;
}

export const ARTIFACT_FRESHNESS_SCHEMA_VALUE =
  ARTIFACT_FRESHNESS_JSON_SCHEMA as unknown as WireJsonValue;
export const BUILD_CERTIFICATE_SCHEMA_VALUE =
  BUILD_CERTIFICATE_JSON_SCHEMA as unknown as WireJsonValue;
