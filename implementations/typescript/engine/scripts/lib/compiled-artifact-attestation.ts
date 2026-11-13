/** Shared, product-blind check-attestation contract for compiled artifacts. */

import { sha256Raw } from "./artifact-bytes";
import {
  ArtifactWireContractError,
  assertUtf8SortedUnique,
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
  type WireJsonValue,
} from "./artifact-wire-json";

export const COMPILED_ARTIFACT_IDS = ["compiled-parser", "compiled-resolver"] as const;
export type CompiledArtifactId = (typeof COMPILED_ARTIFACT_IDS)[number];
export type Sha256Hex = string;

export const OS_FAMILIES = ["linux", "macos", "windows"] as const;
export type ArtifactOsFamily = (typeof OS_FAMILIES)[number];
export const ARTIFACT_ARCHITECTURES = ["arm64", "x64"] as const;
export type ArtifactArchitecture = (typeof ARTIFACT_ARCHITECTURES)[number];

export type EnvironmentVariableEvidence =
  | { readonly name: string; readonly state: "absent" }
  | { readonly name: string; readonly state: "present"; readonly value: string };

export type ArtifactEnvironmentEvidence = {
  readonly osFamily: ArtifactOsFamily;
  readonly arch: ArtifactArchitecture;
  readonly bun: {
    readonly release: string;
    readonly revision: string;
    readonly executableDigest: Sha256Hex;
    readonly webkitVersion: string;
    readonly javascriptCoreVersion: string;
    readonly icuVersion: string;
    readonly unicodeVersion: string;
    readonly toolchainManifestDigest: Sha256Hex;
    readonly toolchainRowDigest: Sha256Hex;
  };
  readonly variables: readonly EnvironmentVariableEvidence[];
};

export type LocalAttestationOrigin = { readonly kind: "local" };
export type CiAttestationOrigin = {
  readonly kind: "ci";
  readonly workflowDigest: Sha256Hex;
  /** Decimal string because GitHub run ids need not remain JS-safe integers. */
  readonly workflowRunId: string;
  readonly workflowRunAttempt: number;
  readonly sourceCommit: string;
};
export type AttestationOrigin = LocalAttestationOrigin | CiAttestationOrigin;

export type CompiledArtifactCheckAttestation = {
  readonly schema: "fenel.compiled-artifact-check-attestation.v2";
  readonly result: "MATCH";
  readonly artifact: CompiledArtifactId;
  readonly origin: AttestationOrigin;
  readonly checkPackageDigest: Sha256Hex;
  readonly coveredSourceArchiveDigest: Sha256Hex;
  /** Digest of the sidecar base projection that excludes producerAttestations. */
  readonly certificateBaseDigest: Sha256Hex;
  readonly repositoryEpoch: Sha256Hex;
  readonly ownerEpoch: Sha256Hex;
  readonly dependencyDigest: Sha256Hex;
  readonly environment: ArtifactEnvironmentEvidence;
  readonly environmentFingerprint: Sha256Hex;
  readonly artifactByteLength: number;
  readonly artifactDigest: Sha256Hex;
  readonly attestationPolicyDigest: Sha256Hex;
};

const SHA256_SCHEMA = { type: "string", pattern: "^[0-9a-f]{64}$" } as const;
const SAFE_UINT_SCHEMA = {
  type: "integer",
  minimum: 0,
  maximum: Number.MAX_SAFE_INTEGER,
} as const;
const NONEMPTY_SCHEMA = { type: "string", minLength: 1 } as const;

export const COMPILED_ARTIFACT_ATTESTATION_JSON_SCHEMA = {
  $schema: "https://json-schema.org/draft/2020-12/schema",
  $id: "compiled-artifact-check-attestation.schema.json",
  title: "Fenel compiled-artifact check attestation v2",
  type: "object",
  additionalProperties: false,
  properties: {
    schema: { const: "fenel.compiled-artifact-check-attestation.v2" },
    result: { const: "MATCH" },
    artifact: { enum: COMPILED_ARTIFACT_IDS },
    origin: {
      oneOf: [
        {
          type: "object",
          additionalProperties: false,
          properties: { kind: { const: "local" } },
          required: ["kind"],
        },
        {
          type: "object",
          additionalProperties: false,
          properties: {
            kind: { const: "ci" },
            workflowDigest: SHA256_SCHEMA,
            workflowRunId: { type: "string", pattern: "^[1-9][0-9]*$" },
            workflowRunAttempt: { ...SAFE_UINT_SCHEMA, minimum: 1 },
            sourceCommit: { type: "string", pattern: "^[0-9a-f]{40}$" },
          },
          required: [
            "kind",
            "sourceCommit",
            "workflowDigest",
            "workflowRunAttempt",
            "workflowRunId",
          ],
        },
      ],
    },
    checkPackageDigest: SHA256_SCHEMA,
    coveredSourceArchiveDigest: SHA256_SCHEMA,
    certificateBaseDigest: SHA256_SCHEMA,
    repositoryEpoch: SHA256_SCHEMA,
    ownerEpoch: SHA256_SCHEMA,
    dependencyDigest: SHA256_SCHEMA,
    environment: {
      type: "object",
      additionalProperties: false,
      properties: {
        osFamily: { enum: OS_FAMILIES },
        arch: { enum: ARTIFACT_ARCHITECTURES },
        bun: {
          type: "object",
          additionalProperties: false,
          properties: {
            release: NONEMPTY_SCHEMA,
            revision: NONEMPTY_SCHEMA,
            executableDigest: SHA256_SCHEMA,
            webkitVersion: NONEMPTY_SCHEMA,
            javascriptCoreVersion: NONEMPTY_SCHEMA,
            icuVersion: NONEMPTY_SCHEMA,
            unicodeVersion: NONEMPTY_SCHEMA,
            toolchainManifestDigest: SHA256_SCHEMA,
            toolchainRowDigest: SHA256_SCHEMA,
          },
          required: [
            "executableDigest",
            "icuVersion",
            "javascriptCoreVersion",
            "release",
            "revision",
            "toolchainManifestDigest",
            "toolchainRowDigest",
            "unicodeVersion",
            "webkitVersion",
          ],
        },
        variables: {
          type: "array",
          minItems: 14,
          maxItems: 14,
          items: {
            oneOf: [
              {
                type: "object",
                additionalProperties: false,
                properties: {
                  name: NONEMPTY_SCHEMA,
                  state: { const: "absent" },
                },
                required: ["name", "state"],
              },
              {
                type: "object",
                additionalProperties: false,
                properties: {
                  name: NONEMPTY_SCHEMA,
                  state: { const: "present" },
                  value: { type: "string" },
                },
                required: ["name", "state", "value"],
              },
            ],
          },
        },
      },
      required: ["arch", "bun", "osFamily", "variables"],
    },
    environmentFingerprint: SHA256_SCHEMA,
    artifactByteLength: SAFE_UINT_SCHEMA,
    artifactDigest: SHA256_SCHEMA,
    attestationPolicyDigest: SHA256_SCHEMA,
  },
  required: [
    "artifact",
    "artifactByteLength",
    "artifactDigest",
    "attestationPolicyDigest",
    "certificateBaseDigest",
    "checkPackageDigest",
    "coveredSourceArchiveDigest",
    "dependencyDigest",
    "environment",
    "environmentFingerprint",
    "origin",
    "ownerEpoch",
    "repositoryEpoch",
    "result",
    "schema",
  ],
} as const;

const REQUIRED_PRESENT_ENV = new Map<string, string>([
  ["FENEL_PARSE_CACHE", "0"],
  ["FENEL_PARSER_INTERPRETED", "1"],
  ["FENEL_PARSER_LEGACY", "1"],
  ["FENEL_RESOLVER_INTERPRETED", "1"],
  ["LANG", "C"],
  ["LC_ALL", "C"],
  ["NODE_ENV", "production"],
  ["TEMP", "<snapshot>/.tmp"],
  ["TMP", "<snapshot>/.tmp"],
  ["TMPDIR", "<snapshot>/.tmp"],
  ["TZ", "UTC"],
]);
const REQUIRED_ABSENT_ENV = new Set([
  "FENEL_DISPATCH_FENEL_PASSES",
  "FENEL_REGEX_SHIM_DEBUG",
  "FENEL_SIMULATE_BROWSER",
]);

function digestBytes(bytes: Uint8Array): Sha256Hex {
  return sha256Raw(bytes);
}

export function computeEnvironmentFingerprint(environment: ArtifactEnvironmentEvidence): Sha256Hex {
  return digestBytes(encodeCanonicalJson(environment));
}

function validateVariables(value: unknown, path: string): readonly EnvironmentVariableEvidence[] {
  const raw = expectWireArray(value, path);
  const expectedCount = REQUIRED_PRESENT_ENV.size + REQUIRED_ABSENT_ENV.size;
  if (raw.length !== expectedCount) {
    throw new ArtifactWireContractError(path, `must contain exactly ${expectedCount} fixed environment rows`);
  }
  const result: EnvironmentVariableEvidence[] = [];
  for (let index = 0; index < raw.length; index += 1) {
    const rowPath = `${path}[${index}]`;
    const record = expectWireRecord(raw[index], rowPath);
    const state = expectWireLiteral(record.state, ["absent", "present"] as const, `${rowPath}.state`);
    const name = expectNonEmptyWireString(record.name, `${rowPath}.name`);
    if (name.includes("=") || /[\u0000-\u001f]/.test(name)) {
      throw new ArtifactWireContractError(`${rowPath}.name`, "invalid environment key");
    }
    if (state === "absent") {
      expectClosedKeys(record, ["name", "state"], [], rowPath);
      result.push({ name, state });
    } else {
      expectClosedKeys(record, ["name", "state", "value"], [], rowPath);
      result.push({ name, state, value: expectWireString(record.value, `${rowPath}.value`) });
    }
  }
  assertUtf8SortedUnique(result.map((row) => row.name), path);
  const byName = new Map(result.map((row) => [row.name, row] as const));
  for (const [name, expected] of REQUIRED_PRESENT_ENV) {
    const row = byName.get(name);
    if (row?.state !== "present" || row.value !== expected) {
      throw new ArtifactWireContractError(path, `${name} must be present with value ${JSON.stringify(expected)}`);
    }
  }
  for (const name of REQUIRED_ABSENT_ENV) {
    if (byName.get(name)?.state !== "absent") {
      throw new ArtifactWireContractError(path, `${name} must be declared absent`);
    }
  }
  return result;
}

export function validateArtifactEnvironmentEvidence(
  value: unknown,
  path = "$.environment",
): ArtifactEnvironmentEvidence {
  const record = expectWireRecord(value, path);
  expectClosedKeys(record, ["arch", "bun", "osFamily", "variables"], [], path);

  const bunPath = `${path}.bun`;
  const bun = expectWireRecord(record.bun, bunPath);
  const bunKeys = [
    "executableDigest",
    "icuVersion",
    "javascriptCoreVersion",
    "release",
    "revision",
    "toolchainManifestDigest",
    "toolchainRowDigest",
    "unicodeVersion",
    "webkitVersion",
  ] as const;
  expectClosedKeys(bun, bunKeys, [], bunPath);

  return {
    osFamily: expectWireLiteral(record.osFamily, OS_FAMILIES, `${path}.osFamily`),
    arch: expectWireLiteral(record.arch, ARTIFACT_ARCHITECTURES, `${path}.arch`),
    bun: {
      release: expectNonEmptyWireString(bun.release, `${bunPath}.release`),
      revision: expectNonEmptyWireString(bun.revision, `${bunPath}.revision`),
      executableDigest: expectSha256(bun.executableDigest, `${bunPath}.executableDigest`),
      webkitVersion: expectNonEmptyWireString(bun.webkitVersion, `${bunPath}.webkitVersion`),
      javascriptCoreVersion: expectNonEmptyWireString(
        bun.javascriptCoreVersion,
        `${bunPath}.javascriptCoreVersion`,
      ),
      icuVersion: expectNonEmptyWireString(bun.icuVersion, `${bunPath}.icuVersion`),
      unicodeVersion: expectNonEmptyWireString(bun.unicodeVersion, `${bunPath}.unicodeVersion`),
      toolchainManifestDigest: expectSha256(
        bun.toolchainManifestDigest,
        `${bunPath}.toolchainManifestDigest`,
      ),
      toolchainRowDigest: expectSha256(bun.toolchainRowDigest, `${bunPath}.toolchainRowDigest`),
    },
    variables: validateVariables(record.variables, `${path}.variables`),
  };
}

function validateOrigin(value: unknown, path: string): AttestationOrigin {
  const record = expectWireRecord(value, path);
  const kind = expectWireLiteral(record.kind, ["ci", "local"] as const, `${path}.kind`);
  if (kind === "local") {
    expectClosedKeys(record, ["kind"], [], path);
    return { kind };
  }
  expectClosedKeys(
    record,
    ["kind", "sourceCommit", "workflowDigest", "workflowRunAttempt", "workflowRunId"],
    [],
    path,
  );
  const workflowRunId = expectWireString(record.workflowRunId, `${path}.workflowRunId`);
  if (!/^[1-9][0-9]*$/.test(workflowRunId)) {
    throw new ArtifactWireContractError(`${path}.workflowRunId`, "expected canonical positive decimal digits");
  }
  return {
    kind,
    sourceCommit: expectGitOid(record.sourceCommit, `${path}.sourceCommit`),
    workflowDigest: expectSha256(record.workflowDigest, `${path}.workflowDigest`),
    workflowRunAttempt: expectSafeUint(record.workflowRunAttempt, `${path}.workflowRunAttempt`, 1),
    workflowRunId,
  };
}

const ATTESTATION_KEYS = [
  "artifact",
  "artifactByteLength",
  "artifactDigest",
  "attestationPolicyDigest",
  "certificateBaseDigest",
  "checkPackageDigest",
  "coveredSourceArchiveDigest",
  "dependencyDigest",
  "environment",
  "environmentFingerprint",
  "origin",
  "ownerEpoch",
  "repositoryEpoch",
  "result",
  "schema",
] as const;

export function validateCompiledArtifactCheckAttestation(
  value: unknown,
  path = "$",
): CompiledArtifactCheckAttestation {
  const record = expectWireRecord(value, path);
  expectClosedKeys(record, ATTESTATION_KEYS, [], path);
  expectWireLiteral(
    record.schema,
    ["fenel.compiled-artifact-check-attestation.v2"] as const,
    `${path}.schema`,
  );
  expectWireLiteral(record.result, ["MATCH"] as const, `${path}.result`);
  const environment = validateArtifactEnvironmentEvidence(record.environment, `${path}.environment`);
  const environmentFingerprint = expectSha256(
    record.environmentFingerprint,
    `${path}.environmentFingerprint`,
  );
  const computedFingerprint = computeEnvironmentFingerprint(environment);
  if (environmentFingerprint !== computedFingerprint) {
    throw new ArtifactWireContractError(
      `${path}.environmentFingerprint`,
      `does not match the canonical environment evidence (${computedFingerprint})`,
    );
  }
  return {
    schema: "fenel.compiled-artifact-check-attestation.v2",
    result: "MATCH",
    artifact: expectWireLiteral(record.artifact, COMPILED_ARTIFACT_IDS, `${path}.artifact`),
    origin: validateOrigin(record.origin, `${path}.origin`),
    checkPackageDigest: expectSha256(record.checkPackageDigest, `${path}.checkPackageDigest`),
    coveredSourceArchiveDigest: expectSha256(
      record.coveredSourceArchiveDigest,
      `${path}.coveredSourceArchiveDigest`,
    ),
    certificateBaseDigest: expectSha256(record.certificateBaseDigest, `${path}.certificateBaseDigest`),
    repositoryEpoch: expectSha256(record.repositoryEpoch, `${path}.repositoryEpoch`),
    ownerEpoch: expectSha256(record.ownerEpoch, `${path}.ownerEpoch`),
    dependencyDigest: expectSha256(record.dependencyDigest, `${path}.dependencyDigest`),
    environment,
    environmentFingerprint,
    artifactByteLength: expectSafeUint(record.artifactByteLength, `${path}.artifactByteLength`),
    artifactDigest: expectSha256(record.artifactDigest, `${path}.artifactDigest`),
    attestationPolicyDigest: expectSha256(
      record.attestationPolicyDigest,
      `${path}.attestationPolicyDigest`,
    ),
  };
}

export function parseCompiledArtifactCheckAttestation(
  bytes: Uint8Array,
): CompiledArtifactCheckAttestation {
  return validateCompiledArtifactCheckAttestation(parseCanonicalJson(bytes));
}

const OS_RANK: Readonly<Record<ArtifactOsFamily, number>> = {
  windows: 0,
  linux: 1,
  macos: 2,
};

function compareNumber(left: number, right: number): number {
  return left < right ? -1 : left > right ? 1 : 0;
}

function compareBigDecimal(left: string, right: string): number {
  if (left.length !== right.length) return compareNumber(left.length, right.length);
  return compareUtf8(left, right);
}

/** Canonical producer order: CI before local, then origin, platform, and proof tuple. */
export function compareProducerAttestations(
  left: CompiledArtifactCheckAttestation,
  right: CompiledArtifactCheckAttestation,
): number {
  const originRank = (left.origin.kind === "ci" ? 0 : 1) - (right.origin.kind === "ci" ? 0 : 1);
  if (originRank !== 0) return originRank;
  if (left.origin.kind === "ci" && right.origin.kind === "ci") {
    for (const comparison of [
      compareUtf8(left.origin.sourceCommit, right.origin.sourceCommit),
      compareUtf8(left.origin.workflowDigest, right.origin.workflowDigest),
      compareBigDecimal(left.origin.workflowRunId, right.origin.workflowRunId),
      compareNumber(left.origin.workflowRunAttempt, right.origin.workflowRunAttempt),
    ]) {
      if (comparison !== 0) return comparison;
    }
  }
  for (const comparison of [
    OS_RANK[left.environment.osFamily] - OS_RANK[right.environment.osFamily],
    compareUtf8(left.environment.arch, right.environment.arch),
    compareUtf8(left.environmentFingerprint, right.environmentFingerprint),
    compareUtf8(left.attestationPolicyDigest, right.attestationPolicyDigest),
    compareUtf8(left.checkPackageDigest, right.checkPackageDigest),
  ]) {
    if (comparison !== 0) return comparison;
  }
  return 0;
}

export function assertCanonicalProducerAttestations(
  entries: readonly CompiledArtifactCheckAttestation[],
  path = "$.producerAttestations",
): void {
  for (let index = 1; index < entries.length; index += 1) {
    const comparison = compareProducerAttestations(entries[index - 1]!, entries[index]!);
    if (comparison === 0) {
      throw new ArtifactWireContractError(`${path}[${index}]`, "duplicate producer identity");
    }
    if (comparison > 0) {
      throw new ArtifactWireContractError(`${path}[${index}]`, "producer attestations are out of canonical order");
    }
  }
}

/** Construction helper only. Decoders call assertCanonicalProducerAttestations and never repair input. */
export function canonicalizeProducerAttestations(
  entries: readonly CompiledArtifactCheckAttestation[],
): readonly CompiledArtifactCheckAttestation[] {
  const sorted = [...entries].sort(compareProducerAttestations);
  assertCanonicalProducerAttestations(sorted);
  return sorted;
}

/** Keep schema objects in the admitted wire-value domain at the type boundary. */
export const COMPILED_ARTIFACT_ATTESTATION_SCHEMA_VALUE =
  COMPILED_ARTIFACT_ATTESTATION_JSON_SCHEMA as unknown as WireJsonValue;
