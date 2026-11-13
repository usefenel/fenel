/** Canonical, disjoint check-package metadata and namespace validation. */

import { repositoryRelativePath, sha256Raw } from "./artifact-bytes";
import {
  ArtifactWireContractError,
  compareUtf8,
  encodeCanonicalJson,
  expectClosedKeys,
  expectGitOid,
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
  COMPILED_ARTIFACT_SPECS,
  PORTABLE_GENERATION_ABI,
  type CompiledArtifactId,
  type Sha256Hex,
} from "./compiled-artifact-protocol";
import { COMPILED_ARTIFACT_IDS } from "./compiled-artifact-attestation";
import { RAW_COMPILED_INPUT_JSON_SCHEMA, validateRawCompiledArtifactInput,
  type RawCompiledArtifactInput } from "./compiled-artifact-input-key";

export const CHECK_PACKAGE_SCHEMA = "fenel.compiled-artifact-check-package.v2" as const;
export const CHECK_PACKAGE_NAMESPACE_SCHEMA =
  "fenel.compiled-artifact-check-package-namespace.v1" as const;
export const CHECK_PACKAGE_NAMESPACES = ["candidate", "environment", "source"] as const;
export type CheckPackageNamespaceName = (typeof CHECK_PACKAGE_NAMESPACES)[number];

export type CheckPackageFileRow = {
  readonly path: string;
  readonly kind: "file";
  readonly byteLength: number;
  readonly digest: Sha256Hex;
};

export type CheckPackageNamespace = {
  readonly digest: Sha256Hex;
  readonly fileCount: number;
  readonly byteLength: number;
  readonly files: readonly CheckPackageFileRow[];
};

export type CheckPackageSourceProvenance =
  | { readonly kind: "stable-live" }
  | {
    readonly kind: "git-object";
    readonly sourceCommit: string;
    /** SHA-256 of the exact portability workflow Git-blob bytes. */
    readonly workflowDigest: Sha256Hex;
  };

export type CompiledArtifactCheckPackageMetadata = {
  readonly schema: typeof CHECK_PACKAGE_SCHEMA;
  readonly artifact: CompiledArtifactId;
  readonly artifactPath: string;
  readonly portableGenerationAbi: typeof PORTABLE_GENERATION_ABI;
  readonly sourceProvenance: CheckPackageSourceProvenance;
  readonly repositoryEpoch: Sha256Hex;
  readonly ownerEpoch: Sha256Hex;
  readonly dependencyDigest: Sha256Hex;
  readonly attestationPolicyDigest: Sha256Hex;
  /** Actual original producer recipe, retained across foreign full checks. */
  readonly producerInput: RawCompiledArtifactInput;
  readonly namespaces: Readonly<Record<CheckPackageNamespaceName, CheckPackageNamespace>>;
};

const SHA256_SCHEMA = { type: "string", pattern: "^[0-9a-f]{64}$" } as const;
const SAFE_UINT_SCHEMA = {
  type: "integer",
  minimum: 0,
  maximum: Number.MAX_SAFE_INTEGER,
} as const;
const FILE_ROW_SCHEMA = {
  type: "object",
  additionalProperties: false,
  properties: {
    byteLength: SAFE_UINT_SCHEMA,
    digest: SHA256_SCHEMA,
    kind: { const: "file" },
    path: { type: "string", minLength: 1 },
  },
  required: ["byteLength", "digest", "kind", "path"],
} as const;
const NAMESPACE_SCHEMA = {
  type: "object",
  additionalProperties: false,
  properties: {
    byteLength: SAFE_UINT_SCHEMA,
    digest: SHA256_SCHEMA,
    fileCount: SAFE_UINT_SCHEMA,
    files: { type: "array", items: FILE_ROW_SCHEMA },
  },
  required: ["byteLength", "digest", "fileCount", "files"],
} as const;

export const CHECK_PACKAGE_JSON_SCHEMA = {
  $schema: "https://json-schema.org/draft/2020-12/schema",
  $id: "compiled-artifact-check-package.schema.json",
  title: "Fenel compiled-artifact check package metadata v2",
  type: "object",
  additionalProperties: false,
  properties: {
    schema: { const: CHECK_PACKAGE_SCHEMA },
    artifact: { enum: COMPILED_ARTIFACT_IDS },
    artifactPath: { type: "string", minLength: 1 },
    portableGenerationAbi: { const: PORTABLE_GENERATION_ABI },
    sourceProvenance: {
      oneOf: [
        {
          type: "object",
          additionalProperties: false,
          properties: { kind: { const: "stable-live" } },
          required: ["kind"],
        },
        {
          type: "object",
          additionalProperties: false,
          properties: {
            kind: { const: "git-object" },
            sourceCommit: { type: "string", pattern: "^[0-9a-f]{40}$" },
            workflowDigest: SHA256_SCHEMA,
          },
          required: ["kind", "sourceCommit", "workflowDigest"],
        },
      ],
    },
    repositoryEpoch: SHA256_SCHEMA,
    ownerEpoch: SHA256_SCHEMA,
    producerInput: RAW_COMPILED_INPUT_JSON_SCHEMA,
    dependencyDigest: SHA256_SCHEMA,
    attestationPolicyDigest: SHA256_SCHEMA,
    namespaces: {
      type: "object",
      additionalProperties: false,
      properties: {
        candidate: NAMESPACE_SCHEMA,
        environment: NAMESPACE_SCHEMA,
        source: NAMESPACE_SCHEMA,
      },
      required: ["candidate", "environment", "source"],
    },
  },
  required: [
    "artifact",
    "artifactPath",
    "attestationPolicyDigest",
    "dependencyDigest",
    "namespaces",
    "ownerEpoch",
    "portableGenerationAbi",
    "producerInput",
    "repositoryEpoch",
    "schema",
    "sourceProvenance",
  ],
  allOf: COMPILED_ARTIFACT_IDS.map((artifact) => ({
    if: { properties: { artifact: { const: artifact } }, required: ["artifact"] },
    then: { properties: { artifactPath: { const: COMPILED_ARTIFACT_SPECS[artifact].artifactPath } } },
  })),
} as const;

function sha256(bytes: Uint8Array): Sha256Hex {
  return sha256Raw(bytes);
}

function assertPortableRelativePath(path: string, context: string): void {
  if (
    path.length === 0
    || path.startsWith("/")
    || path.endsWith("/")
    || path.includes("\\")
    || /^[A-Za-z]:/.test(path)
    || /[\u0000-\u001f]/.test(path)
  ) {
    throw new ArtifactWireContractError(context, "expected a slash-stable relative file path");
  }
  const segments = path.split("/");
  if (segments.some((segment) => segment.length === 0 || segment === "." || segment === "..")) {
    throw new ArtifactWireContractError(context, "path contains an empty, dot, or parent segment");
  }
  try {
    repositoryRelativePath(path);
  } catch {
    throw new ArtifactWireContractError(
      context,
      "path is not NFC/cross-platform portable or uses a reserved segment",
    );
  }
}

function assertCanonicalFileRows(
  files: readonly CheckPackageFileRow[],
  path: string,
): void {
  const caseFolded = new Map<string, string>();
  for (let index = 0; index < files.length; index += 1) {
    const row = files[index]!;
    assertPortableRelativePath(row.path, `${path}[${index}].path`);
    if (index > 0) {
      const comparison = compareUtf8(files[index - 1]!.path, row.path);
      if (comparison === 0) {
        throw new ArtifactWireContractError(`${path}[${index}].path`, "duplicate canonical path");
      }
      if (comparison > 0) {
        throw new ArtifactWireContractError(`${path}[${index}].path`, "file rows are out of UTF-8 path order");
      }
    }
    const folded = row.path.toLowerCase();
    const prior = caseFolded.get(folded);
    if (prior !== undefined && prior !== row.path) {
      throw new ArtifactWireContractError(
        `${path}[${index}].path`,
        `case-only collision with ${JSON.stringify(prior)}`,
      );
    }
    caseFolded.set(folded, row.path);
  }
}

function namespaceDigestProjection(
  namespace: CheckPackageNamespaceName,
  files: readonly CheckPackageFileRow[],
): WireJsonValue {
  return {
    schema: CHECK_PACKAGE_NAMESPACE_SCHEMA,
    namespace,
    files,
  } as unknown as WireJsonValue;
}

export function computeCheckPackageNamespaceDigest(
  namespace: CheckPackageNamespaceName,
  files: readonly CheckPackageFileRow[],
): Sha256Hex {
  assertCanonicalFileRows(files, `namespace.${namespace}.files`);
  return sha256(encodeCanonicalJson(namespaceDigestProjection(namespace, files)));
}

export function buildCheckPackageNamespace(
  namespace: CheckPackageNamespaceName,
  files: readonly CheckPackageFileRow[],
): CheckPackageNamespace {
  assertCanonicalFileRows(files, `namespace.${namespace}.files`);
  let byteLength = 0;
  for (const row of files) {
    byteLength += row.byteLength;
    if (!Number.isSafeInteger(byteLength)) {
      throw new ArtifactWireContractError(`namespace.${namespace}.byteLength`, "sum exceeds safe integer range");
    }
  }
  return {
    digest: computeCheckPackageNamespaceDigest(namespace, files),
    fileCount: files.length,
    byteLength,
    files,
  };
}

function validateFileRows(value: unknown, path: string): readonly CheckPackageFileRow[] {
  const raw = expectWireArray(value, path);
  const rows = raw.map((item, index): CheckPackageFileRow => {
    const rowPath = `${path}[${index}]`;
    const record = expectWireRecord(item, rowPath);
    expectClosedKeys(record, ["byteLength", "digest", "kind", "path"], [], rowPath);
    return {
      path: expectWireString(record.path, `${rowPath}.path`),
      kind: expectWireLiteral(record.kind, ["file"] as const, `${rowPath}.kind`),
      byteLength: expectSafeUint(record.byteLength, `${rowPath}.byteLength`),
      digest: expectSha256(record.digest, `${rowPath}.digest`),
    };
  });
  assertCanonicalFileRows(rows, path);
  return rows;
}

function validateNamespace(
  namespace: CheckPackageNamespaceName,
  value: unknown,
  path: string,
): CheckPackageNamespace {
  const record = expectWireRecord(value, path);
  expectClosedKeys(record, ["byteLength", "digest", "fileCount", "files"], [], path);
  const files = validateFileRows(record.files, `${path}.files`);
  const fileCount = expectSafeUint(record.fileCount, `${path}.fileCount`);
  const byteLength = expectSafeUint(record.byteLength, `${path}.byteLength`);
  const digest = expectSha256(record.digest, `${path}.digest`);
  if (fileCount !== files.length) {
    throw new ArtifactWireContractError(`${path}.fileCount`, "does not match files.length");
  }
  const built = buildCheckPackageNamespace(namespace, files);
  if (byteLength !== built.byteLength) {
    throw new ArtifactWireContractError(`${path}.byteLength`, "does not match the sum of file bytes");
  }
  if (digest !== built.digest) {
    throw new ArtifactWireContractError(`${path}.digest`, "does not match canonical namespace rows");
  }
  return { digest, fileCount, byteLength, files };
}

function validateSourceProvenance(value: unknown, path: string): CheckPackageSourceProvenance {
  const record = expectWireRecord(value, path);
  const kind = expectWireLiteral(record.kind, ["git-object", "stable-live"] as const, `${path}.kind`);
  if (kind === "stable-live") {
    expectClosedKeys(record, ["kind"], [], path);
    return { kind };
  }
  expectClosedKeys(record, ["kind", "sourceCommit", "workflowDigest"], [], path);
  return {
    kind,
    sourceCommit: expectGitOid(record.sourceCommit, `${path}.sourceCommit`),
    workflowDigest: expectSha256(record.workflowDigest, `${path}.workflowDigest`),
  };
}

const METADATA_KEYS = [
  "artifact",
  "artifactPath",
  "attestationPolicyDigest",
  "dependencyDigest",
  "namespaces",
  "ownerEpoch",
  "producerInput",
  "portableGenerationAbi",
  "repositoryEpoch",
  "schema",
  "sourceProvenance",
] as const;

export function validateCheckPackageMetadata(
  value: unknown,
  path = "$",
): CompiledArtifactCheckPackageMetadata {
  const record = expectWireRecord(value, path);
  expectClosedKeys(record, METADATA_KEYS, [], path);
  expectWireLiteral(record.schema, [CHECK_PACKAGE_SCHEMA] as const, `${path}.schema`);
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
  const namespaceRecord = expectWireRecord(record.namespaces, `${path}.namespaces`);
  expectClosedKeys(namespaceRecord, CHECK_PACKAGE_NAMESPACES, [], `${path}.namespaces`);
  const namespaces = {
    candidate: validateNamespace("candidate", namespaceRecord.candidate, `${path}.namespaces.candidate`),
    environment: validateNamespace(
      "environment",
      namespaceRecord.environment,
      `${path}.namespaces.environment`,
    ),
    source: validateNamespace("source", namespaceRecord.source, `${path}.namespaces.source`),
  };
  const producerInput = validateRawCompiledArtifactInput(record.producerInput, artifact);
  if (producerInput.dependencyDigest !== record.dependencyDigest
    || producerInput.portableGenerationAbi !== record.portableGenerationAbi) {
    throw new ArtifactWireContractError(`${path}.producerInput`, "producer recipe must bind package dependency/ABI coordinates");
  }
  if (namespaces.candidate.files.length !== 1 || namespaces.candidate.files[0]!.path !== artifactPath) {
    throw new ArtifactWireContractError(
      `${path}.namespaces.candidate.files`,
      "candidate must contain exactly the detached artifact at artifactPath",
    );
  }
  if (!namespaces.source.files.some((row) => row.path === artifactPath)) {
    throw new ArtifactWireContractError(
      `${path}.namespaces.source.files`,
      "source must contain the inert recovery stub at artifactPath",
    );
  }
  if (!namespaces.environment.files.some(
    (row) => row.path === ".github/fenel-artifact-toolchains.json",
  )) {
    throw new ArtifactWireContractError(
      `${path}.namespaces.environment.files`,
      "environment must contain the portability toolchain manifest",
    );
  }
  return {
    schema: CHECK_PACKAGE_SCHEMA,
    artifact,
    artifactPath,
    portableGenerationAbi: PORTABLE_GENERATION_ABI,
    sourceProvenance: validateSourceProvenance(record.sourceProvenance, `${path}.sourceProvenance`),
    repositoryEpoch: expectSha256(record.repositoryEpoch, `${path}.repositoryEpoch`),
    ownerEpoch: expectSha256(record.ownerEpoch, `${path}.ownerEpoch`),
    dependencyDigest: expectSha256(record.dependencyDigest, `${path}.dependencyDigest`),
    attestationPolicyDigest: expectSha256(
      record.attestationPolicyDigest,
      `${path}.attestationPolicyDigest`,
    ),
    namespaces,
    producerInput,
  };
}

export function parseCheckPackageMetadata(
  bytes: Uint8Array,
): CompiledArtifactCheckPackageMetadata {
  return validateCheckPackageMetadata(parseCanonicalJson(bytes));
}

/** Metadata binds all three namespace manifests, so its digest identifies the whole package. */
export function computeCheckPackageDigest(metadata: CompiledArtifactCheckPackageMetadata): Sha256Hex {
  return sha256(encodeCanonicalJson(metadata));
}

export const CHECK_PACKAGE_SCHEMA_VALUE = CHECK_PACKAGE_JSON_SCHEMA as unknown as WireJsonValue;
