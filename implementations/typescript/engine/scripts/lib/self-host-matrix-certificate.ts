/**
 * Byte-only self-host matrix certificate, receipt, and decision contracts.
 *
 * This module deliberately has no engine imports and no filesystem/process
 * effects.  In particular it does not classify functions, categories, tags,
 * gaps, or compiler results.  The unchanged Fenel-owned matrix worker remains
 * the sole authority for those values.
 */

import {
  digestByteManifest,
  parseSha256Hex,
  repositoryRelativePath,
  sha256Raw,
  type ByteManifest,
  type ByteManifestRow,
  type RepositoryRelativePath,
  type Sha256Hex,
} from "./artifact-bytes";
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
  expectWireLiteral,
  expectWireArray,
  expectWireRecord,
  expectWireString,
  parseCanonicalJson,
} from "./artifact-wire-json";

export const SELF_HOST_MATRIX_STAMP_SCHEMA = "fenel.self-host-matrix-stamp.v1" as const;
export const SELF_HOST_MATRIX_INPUTS_SCHEMA = "fenel.self-host-matrix-inputs.v1" as const;
export const SELF_HOST_MATRIX_ENVIRONMENT_SCHEMA = "fenel.self-host-matrix-environment.v1" as const;
export const SELF_HOST_MATRIX_RECEIPT_SCHEMA = "fenel.self-host-matrix-receipt.v1" as const;
export const SELF_HOST_MATRIX_LEG_SCHEMA = "fenel.self-host-matrix-leg.v1" as const;
export const SELF_HOST_MATRIX_PACKAGE_SCHEMA = "fenel.self-host-matrix-package.v1" as const;

export const SELF_HOST_MATRIX_PATH = "docs/SELF_HOST_MATRIX.md" as const;
export const SELF_HOST_MATRIX_GENERATOR_PATH =
  "implementations/typescript/engine/scripts/generate-self-host-matrix.ts" as const;
export const SELF_HOST_MATRIX_CONTROLLER_PATH =
  "implementations/typescript/engine/scripts/self-host-matrix-controller.ts" as const;
export const SELF_HOST_MATRIX_CERTIFICATE_HELPER_PATH =
  "implementations/typescript/engine/scripts/lib/self-host-matrix-certificate.ts" as const;
export const SELF_HOST_MATRIX_TOOLCHAIN_MANIFEST_PATH =
  ".github/fenel-artifact-toolchains.json" as const;

export const SELF_HOST_MATRIX_RECURSIVE_ROOTS = Object.freeze([
  repositoryRelativePath("fenel"),
  repositoryRelativePath("implementations/typescript/engine/scripts"),
  repositoryRelativePath("implementations/typescript/engine/src"),
] as const);

export const SELF_HOST_MATRIX_EXACT_INPUTS = Object.freeze([
  repositoryRelativePath(".fenel.lock"),
  repositoryRelativePath(".gitattributes"),
  repositoryRelativePath("bun.lock"),
  repositoryRelativePath("implementations/typescript/engine/package.json"),
  repositoryRelativePath("implementations/typescript/engine/tsconfig.json"),
  repositoryRelativePath("package.json"),
  repositoryRelativePath("tsconfig.base.json"),
] as const);

export type MatrixMode = "legacy-stampless" | "required-v1";
export const CURRENT_SELF_HOST_MATRIX_MODE: MatrixMode = "required-v1";

export type MatrixStampClass =
  | "absent"
  | "duplicate"
  | "illegal-placement"
  | "malformed"
  | "valid";

export type MatrixOperation = "check" | "decide" | "probe" | "repair";
export type MatrixReceiptOperation = MatrixOperation | "invalid";

export type MatrixDecision =
  | "CHECK_REQUIRED"
  | "DUE"
  | "DUE_UNTRUSTED"
  | "FRESH"
  | "LEGACY_DUE"
  | "REPAIR_REQUIRED"
  | "SKIPPED_EXPLICIT"
  | "SKIPPED_LEGACY"
  | "UNDECIDABLE"
  | "VERIFIED_FOREIGN"
  | "VERIFIED_FOREIGN_DUE";

export type MatrixResult =
  | "CHECK_FAILED"
  | "CHECK_OK"
  | "CHECK_REQUIRED"
  | "CLI_ERROR"
  | "DUE"
  | "DUE_UNTRUSTED"
  | "FRESH"
  | "LEGACY_DUE"
  | "LEGACY_REPAIRED"
  | "REPAIRED"
  | "REPAIR_REQUIRED"
  | "REPAIR_FAILED"
  | "SKIPPED_EXPLICIT"
  | "SKIPPED_LEGACY"
  | "UNDECIDABLE"
  | "VERIFIED_FOREIGN"
  | "VERIFIED_FOREIGN_DUE";

export type MatrixEnvironmentVariable = {
  readonly key: string;
  readonly value: string;
};

export type MatrixArtifactIdentity =
  | { readonly kind: "absent" }
  | {
    readonly kind: "present";
    readonly byteLength: number;
    readonly digest: Sha256Hex;
  };

export interface MatrixStamp {
  readonly schema: typeof SELF_HOST_MATRIX_STAMP_SCHEMA;
  readonly inputs: Sha256Hex;
  readonly environment: Sha256Hex;
  readonly body: Sha256Hex;
}

export interface MatrixInputsCertificate {
  readonly schema: typeof SELF_HOST_MATRIX_INPUTS_SCHEMA;
  readonly source: ByteManifest;
  readonly dependencies: ByteManifest;
  readonly digest: Sha256Hex;
}

export interface MatrixBunEnvironment {
  readonly executableSha256: Sha256Hex;
  readonly release: string;
  readonly revision: string;
  readonly webkit: string;
  readonly icu: string;
  readonly unicode: string;
}

export type MatrixExternalToolEnvironment =
  | {
    readonly mode: "shape-only";
    readonly privatePath: "<matrix-package>/.bin";
    readonly clang: "absent";
  }
  | {
    readonly mode: "pinned-bundle";
    readonly archiveSha256: Sha256Hex;
    readonly entrypoint: RepositoryRelativePath;
    readonly manifest: ByteManifest;
    readonly childEnvironment: readonly MatrixEnvironmentVariable[];
  };

export interface MatrixEnvironmentCertificate {
  readonly schema: typeof SELF_HOST_MATRIX_ENVIRONMENT_SCHEMA;
  readonly osFamily: "linux" | "macos" | "windows";
  readonly arch: "arm64" | "x64";
  readonly bun: MatrixBunEnvironment;
  readonly toolchainManifestDigest: Sha256Hex;
  readonly locale: string;
  readonly timezone: string;
  readonly parentEnvironment: readonly MatrixEnvironmentVariable[];
  readonly declaredAbsent: readonly ["FENEL_LLVM_IN_SUBPROCESS", "FENEL_MATRIX_PROGRESS"];
  readonly externalTool: MatrixExternalToolEnvironment;
  readonly digest: Sha256Hex;
}

export interface MatrixDocumentObservation {
  readonly stampClass: MatrixStampClass;
  readonly stamp: MatrixStamp | null;
  readonly normalizedBodyBytes: Uint8Array;
  readonly bodyDigest: Sha256Hex;
  readonly certificateDigest: Sha256Hex;
  readonly presentation: {
    readonly verified: string;
    readonly verifiedAtSha: string;
  };
}

export interface MatrixRelationEvidence {
  readonly artifact: "absent" | "present";
  readonly stampClass: MatrixStampClass;
  readonly inputs: "different" | "equal";
  readonly environment: "equal" | "foreign";
  readonly body: "different" | "equal";
}

export interface MatrixStateDecision {
  readonly decision: MatrixDecision;
  readonly action: "check" | "none" | "repair";
  readonly exitCode: 0 | 1 | 20 | 21;
}

export interface NormalizedMatrixControllerArgs {
  readonly operation: MatrixOperation;
  readonly progress: boolean;
  readonly packagePath: string | null;
  readonly functionMints: number | null;
  readonly withMatrix: boolean;
  readonly noMatrix: boolean;
  readonly adoptMatrixEnvironment: Sha256Hex | null;
}

export interface MatrixControllerReceipt {
  readonly schema: typeof SELF_HOST_MATRIX_RECEIPT_SCHEMA;
  readonly evidence: "complete" | "unavailable";
  readonly failureDigest: Sha256Hex;
  readonly mode: MatrixMode;
  readonly operation: MatrixReceiptOperation;
  readonly decision: MatrixDecision;
  readonly result: MatrixResult;
  readonly stampClass: MatrixStampClass;
  readonly inputsDigest: Sha256Hex;
  readonly environmentDigest: Sha256Hex;
  readonly bodyDigest: Sha256Hex;
  readonly certificateDigest: Sha256Hex;
  readonly controllerDigest: Sha256Hex;
  readonly packageDigest: Sha256Hex;
  readonly capturedPresentation: {
    readonly sourceCommit: string;
    readonly verified: string;
    readonly verifiedAtSha: string;
  };
  readonly publication: {
    readonly published: boolean;
    readonly before: MatrixArtifactIdentity;
    readonly candidate: MatrixArtifactIdentity;
    readonly after: MatrixArtifactIdentity;
  };
}

export interface MatrixLeg {
  readonly schema: typeof SELF_HOST_MATRIX_LEG_SCHEMA;
  readonly receiptDigest: Sha256Hex;
  readonly artifact: MatrixArtifactIdentity;
  readonly bodyDigest: Sha256Hex;
  readonly controllerDigest: Sha256Hex;
  readonly packageDigest: Sha256Hex;
  readonly certificateDigest: Sha256Hex;
  readonly matrixLegDigest: Sha256Hex;
}

export class MatrixCertificateError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "MatrixCertificateError";
  }
}

export class MatrixCliError extends Error {
  readonly exitCode = 2 as const;

  constructor(message: string) {
    super(message);
    this.name = "MatrixCliError";
  }
}

const UTF8 = new TextEncoder();
const FATAL_UTF8 = new TextDecoder("utf-8", { fatal: true });
const GIT_OID = /^[0-9a-f]{40}$/u;
const SHORT_GIT_OID = /^[0-9a-f]{7,40}$/u;
const PRESENTATION_DATE = /^[0-9]{4}-[0-9]{2}-[0-9]{2}$/u;
const STAMP_PREFIX = "<!-- fenel:self-host-matrix:";
const STAMP_LINE = /^<!-- fenel:self-host-matrix:v1 inputs=([0-9a-f]{64}) environment=([0-9a-f]{64}) body=([0-9a-f]{64}) -->$/u;
const ABSENT_VARIABLES = Object.freeze([
  "FENEL_LLVM_IN_SUBPROCESS",
  "FENEL_MATRIX_PROGRESS",
] as const);

export const MATRIX_NO_FAILURE_DIGEST: Sha256Hex = canonicalDigest({
  schema: "fenel.self-host-matrix-failure.v1",
  kind: "none",
});

export const UNAVAILABLE_MATRIX_IDENTITY_DIGEST: Sha256Hex = canonicalDigest({
  schema: "fenel.self-host-matrix-identity.v1",
  kind: "unavailable",
});

export function matrixFailureDigest(reason: string): Sha256Hex {
  if (reason.length === 0) throw new TypeError("matrix failure reason must not be empty");
  return canonicalDigest({
    schema: "fenel.self-host-matrix-failure.v1",
    kind: "unavailable",
    reason: sha256Raw(reason),
  });
}

function sameBytes(left: Uint8Array, right: Uint8Array): boolean {
  return left.byteLength === right.byteLength
    && left.every((byte, index) => byte === right[index]);
}

function sameIdentity(left: MatrixArtifactIdentity, right: MatrixArtifactIdentity): boolean {
  return JSON.stringify(left) === JSON.stringify(right);
}

function requireBoolean(value: unknown, path: string): boolean {
  if (typeof value !== "boolean") throw new ArtifactWireContractError(path, "expected a boolean");
  return value;
}

function canonicalDigest(value: unknown): Sha256Hex {
  return sha256Raw(encodeCanonicalJson(value));
}

function assertEnvironmentVariables(
  values: readonly MatrixEnvironmentVariable[],
  path: string,
): readonly MatrixEnvironmentVariable[] {
  const copied = values.map((row, index) => {
    if (!/^[A-Za-z_][A-Za-z0-9_]*$/u.test(row.key)) {
      throw new TypeError(`${path}[${index}].key is not a portable environment name`);
    }
    if (typeof row.value !== "string" || row.value.includes("\u0000")) {
      throw new TypeError(`${path}[${index}].value is not one environment string`);
    }
    return Object.freeze({ key: row.key, value: row.value });
  }).sort((left, right) => compareUtf8(left.key, right.key));
  assertUtf8SortedUnique(copied.map((row) => row.key), path);
  for (const absent of ABSENT_VARIABLES) {
    if (copied.some((row) => row.key === absent)) {
      throw new TypeError(`${path} exposes declared-absent ${absent}`);
    }
  }
  return Object.freeze(copied);
}

function assertParentEnvironment(
  osFamily: MatrixEnvironmentCertificate["osFamily"],
  values: readonly MatrixEnvironmentVariable[],
): readonly MatrixEnvironmentVariable[] {
  const fixed = new Map<string, string>([
    ["LANG", "C.UTF-8"],
    ["LC_ALL", "C.UTF-8"],
    ["NO_COLOR", "1"],
    ["PATH", "<matrix-package>/.bin"],
    ["TEMP", "<matrix-package>/.tmp"],
    ["TMP", "<matrix-package>/.tmp"],
    ["TZ", "UTC"],
  ]);
  const expectedKeys = [
    ...fixed.keys(),
    ...(osFamily === "windows" ? ["COMSPEC", "SYSTEMROOT"] : []),
  ].sort(compareUtf8);
  if (JSON.stringify(values.map((row) => row.key)) !== JSON.stringify(expectedKeys)) {
    throw new TypeError("matrix parent environment must expose exactly the closed v1 key set");
  }
  for (const row of values) {
    const expected = fixed.get(row.key);
    if (expected !== undefined && row.value !== expected) {
      throw new TypeError(`matrix parent environment has a non-canonical ${row.key} value`);
    }
    if ((row.key === "COMSPEC" || row.key === "SYSTEMROOT") && row.value.length === 0) {
      throw new TypeError(`matrix parent environment ${row.key} must not be empty`);
    }
  }
  return values;
}

function validateManifest(
  manifest: ByteManifest,
  domain: string,
  requireRows: boolean,
): ByteManifest {
  if (manifest.schema !== "fenel.byte-manifest.v1" || manifest.domain !== domain) {
    throw new TypeError(`expected ${domain} byte manifest`);
  }
  const rebuilt = digestByteManifest(domain, manifest.rows);
  if (
    rebuilt.fileCount !== manifest.fileCount
    || rebuilt.byteLength !== manifest.byteLength
    || rebuilt.digest !== manifest.digest
  ) {
    throw new TypeError(`${domain} manifest summary is not canonical`);
  }
  if (requireRows && rebuilt.rows.length === 0) throw new TypeError(`${domain} manifest is empty`);
  return rebuilt;
}

function assertCompleteMatrixSourceManifest(source: ByteManifest): void {
  const paths = new Set(source.rows.map((row) => row.path));
  for (const exact of SELF_HOST_MATRIX_EXACT_INPUTS) {
    if (!paths.has(exact)) throw new TypeError(`matrix source manifest omits ${exact}`);
  }
  for (const root of SELF_HOST_MATRIX_RECURSIVE_ROOTS) {
    if (![...paths].some((path) => path.startsWith(`${root}/`))) {
      throw new TypeError(`matrix source manifest has no row beneath ${root}`);
    }
  }
  if (paths.has(repositoryRelativePath(SELF_HOST_MATRIX_PATH))) {
    throw new TypeError("matrix source manifest may not hash the generated matrix itself");
  }
}

export function makeMatrixInputsCertificate(input: {
  readonly sourceRows: readonly ByteManifestRow[];
  readonly dependencyRows: readonly ByteManifestRow[];
}): MatrixInputsCertificate {
  const source = digestByteManifest("self-host-matrix-source", input.sourceRows);
  assertCompleteMatrixSourceManifest(source);
  const dependencies = digestByteManifest("self-host-matrix-dependencies", input.dependencyRows);
  const base = Object.freeze({
    schema: SELF_HOST_MATRIX_INPUTS_SCHEMA,
    source,
    dependencies,
  });
  return Object.freeze({ ...base, digest: canonicalDigest(base) });
}

export function validateMatrixInputsCertificate(
  input: MatrixInputsCertificate,
): MatrixInputsCertificate {
  if (input.schema !== SELF_HOST_MATRIX_INPUTS_SCHEMA) {
    throw new TypeError("unsupported self-host matrix inputs schema");
  }
  const source = validateManifest(input.source, "self-host-matrix-source", true);
  assertCompleteMatrixSourceManifest(source);
  const dependencies = validateManifest(
    input.dependencies,
    "self-host-matrix-dependencies",
    false,
  );
  const base = Object.freeze({
    schema: SELF_HOST_MATRIX_INPUTS_SCHEMA,
    source,
    dependencies,
  });
  const digest = canonicalDigest(base);
  if (digest !== input.digest) throw new TypeError("matrix inputs digest mismatch");
  return Object.freeze({ ...base, digest });
}

function assertBunEnvironment(input: MatrixBunEnvironment): MatrixBunEnvironment {
  const release = expectNonEmptyWireString(input.release, "environment.bun.release");
  const revision = expectNonEmptyWireString(input.revision, "environment.bun.revision");
  if (!GIT_OID.test(revision)) throw new TypeError("matrix Bun revision must be one full Git OID");
  return Object.freeze({
    executableSha256: parseSha256Hex(input.executableSha256),
    release,
    revision,
    webkit: expectNonEmptyWireString(input.webkit, "environment.bun.webkit"),
    icu: expectNonEmptyWireString(input.icu, "environment.bun.icu"),
    unicode: expectNonEmptyWireString(input.unicode, "environment.bun.unicode"),
  });
}

export function makeMatrixEnvironmentCertificate(input: Omit<MatrixEnvironmentCertificate, "schema" | "digest" | "declaredAbsent">): MatrixEnvironmentCertificate {
  if (!["linux", "macos", "windows"].includes(input.osFamily)) {
    throw new TypeError("unsupported matrix OS family");
  }
  if (input.arch !== "arm64" && input.arch !== "x64") throw new TypeError("unsupported matrix architecture");
  const parentEnvironment = assertParentEnvironment(
    input.osFamily,
    assertEnvironmentVariables(input.parentEnvironment, "environment.parentEnvironment"),
  );
  if (input.timezone !== "UTC") throw new TypeError("matrix timezone must be UTC");
  let externalTool: MatrixExternalToolEnvironment;
  if (input.externalTool.mode === "shape-only") {
    if (
      input.externalTool.privatePath !== "<matrix-package>/.bin"
      || input.externalTool.clang !== "absent"
    ) {
      throw new TypeError("shape-only mode requires the exact private PATH and clang absence");
    }
    externalTool = Object.freeze({ ...input.externalTool });
  } else if (input.externalTool.mode === "pinned-bundle") {
    const manifest = validateManifest(
      input.externalTool.manifest,
      "self-host-matrix-toolchain-bundle",
      true,
    );
    const entrypoint = repositoryRelativePath(input.externalTool.entrypoint);
    if (!manifest.rows.some((row) => row.path === entrypoint)) {
      throw new TypeError("pinned-bundle entrypoint is absent from its byte manifest");
    }
    const markerRows = input.externalTool.childEnvironment.filter(
      (row) => row.key === "FENEL_LLVM_IN_SUBPROCESS",
    );
    if (markerRows.length !== 1 || markerRows[0]!.value !== "1") {
      throw new TypeError("pinned-bundle child environment must add exactly FENEL_LLVM_IN_SUBPROCESS=1");
    }
    const childEnvironment = assertEnvironmentVariables(
      input.externalTool.childEnvironment.filter((row) => row.key !== "FENEL_LLVM_IN_SUBPROCESS"),
      "environment.externalTool.childEnvironment",
    );
    if (JSON.stringify(childEnvironment) !== JSON.stringify(parentEnvironment)) {
      throw new TypeError("pinned-bundle child environment may differ only by its LLVM marker");
    }
    externalTool = Object.freeze({
      mode: "pinned-bundle" as const,
      archiveSha256: parseSha256Hex(input.externalTool.archiveSha256),
      entrypoint,
      manifest,
      childEnvironment: Object.freeze([
        ...parentEnvironment,
        Object.freeze({ key: "FENEL_LLVM_IN_SUBPROCESS", value: "1" }),
      ].sort((left, right) => compareUtf8(left.key, right.key))),
    });
  } else {
    throw new TypeError("unsupported matrix external-tool mode");
  }
  const base = Object.freeze({
    schema: SELF_HOST_MATRIX_ENVIRONMENT_SCHEMA,
    osFamily: input.osFamily,
    arch: input.arch,
    bun: assertBunEnvironment(input.bun),
    toolchainManifestDigest: parseSha256Hex(input.toolchainManifestDigest),
    locale: expectNonEmptyWireString(input.locale, "environment.locale"),
    timezone: expectNonEmptyWireString(input.timezone, "environment.timezone"),
    parentEnvironment,
    declaredAbsent: ABSENT_VARIABLES,
    externalTool,
  });
  return Object.freeze({ ...base, digest: canonicalDigest(base) });
}

export function validateMatrixEnvironmentCertificate(
  input: MatrixEnvironmentCertificate,
): MatrixEnvironmentCertificate {
  if (input.schema !== SELF_HOST_MATRIX_ENVIRONMENT_SCHEMA) {
    throw new TypeError("unsupported self-host matrix environment schema");
  }
  if (JSON.stringify(input.declaredAbsent) !== JSON.stringify(ABSENT_VARIABLES)) {
    throw new TypeError("matrix declared-absent environment set differs from v1");
  }
  const rebuilt = makeMatrixEnvironmentCertificate(input);
  if (rebuilt.digest !== input.digest) throw new TypeError("matrix environment digest mismatch");
  return rebuilt;
}

function normalizeLf(bytes: Uint8Array): string {
  let text: string;
  try {
    text = FATAL_UTF8.decode(bytes);
  } catch {
    throw new MatrixCertificateError("matrix document is not valid UTF-8");
  }
  text = text.replaceAll("\r\n", "\n");
  if (text.includes("\r")) throw new MatrixCertificateError("matrix document contains a lone CR");
  if (!text.endsWith("\n")) throw new MatrixCertificateError("matrix document must end in LF");
  return text;
}

function documentLayout(lines: readonly string[]): {
  readonly frontmatterEnd: number;
  readonly firstHeading: number;
  readonly verifiedIndex: number;
  readonly verifiedAtShaIndex: number;
} {
  if (lines[0] !== "---") throw new MatrixCertificateError("matrix frontmatter must begin at byte zero");
  const frontmatterEnd = lines.indexOf("---", 1);
  if (frontmatterEnd < 0) throw new MatrixCertificateError("matrix frontmatter is unterminated");
  const firstHeading = lines.findIndex((line, index) => index > frontmatterEnd && /^#{1,6} /u.test(line));
  if (firstHeading < 0) throw new MatrixCertificateError("matrix has no post-frontmatter heading");
  const verified = lines
    .map((line, index) => ({ line, index }))
    .filter(({ line, index }) => index > 0 && index < frontmatterEnd && line.startsWith("verified: "));
  const verifiedAtSha = lines
    .map((line, index) => ({ line, index }))
    .filter(({ line, index }) => index > 0 && index < frontmatterEnd && line.startsWith("verified_at_sha: "));
  if (verified.length !== 1 || verifiedAtSha.length !== 1) {
    throw new MatrixCertificateError("matrix frontmatter must contain exactly one verified and verified_at_sha field");
  }
  return {
    frontmatterEnd,
    firstHeading,
    verifiedIndex: verified[0]!.index,
    verifiedAtShaIndex: verifiedAtSha[0]!.index,
  };
}

function invalidCertificateDigest(
  stampClass: Exclude<MatrixStampClass, "valid">,
  artifactBytes: Uint8Array,
): Sha256Hex {
  if (stampClass === "absent") return LEGACY_STAMPLESS_TOMBSTONE_DIGEST;
  return canonicalDigest({
    schema: "fenel.self-host-matrix-invalid-stamp.v1",
    stampClass,
    artifactDigest: sha256Raw(artifactBytes),
  });
}

export const LEGACY_STAMPLESS_TOMBSTONE_DIGEST: Sha256Hex = canonicalDigest({
  schema: "fenel.self-host-matrix-certificate-tombstone.v1",
  kind: "legacy-stampless",
});

export function parseMatrixDocument(bytes: Uint8Array): MatrixDocumentObservation {
  const text = normalizeLf(bytes);
  const lines = text.split("\n");
  const layout = documentLayout(lines);
  const presentation = Object.freeze({
    verified: lines[layout.verifiedIndex]!.slice("verified: ".length),
    verifiedAtSha: lines[layout.verifiedAtShaIndex]!.slice("verified_at_sha: ".length),
  });
  const prefixIndexes = lines
    .map((line, index) => ({ line, index }))
    .filter(({ line }) => line.includes(STAMP_PREFIX));
  let stampClass: MatrixStampClass;
  let stamp: MatrixStamp | null = null;
  let stampIndex: number | null = null;
  if (prefixIndexes.length === 0) {
    stampClass = "absent";
  } else if (prefixIndexes.length > 1) {
    stampClass = "duplicate";
  } else {
    const only = prefixIndexes[0]!;
    const match = STAMP_LINE.exec(only.line);
    if (match === null) {
      stampClass = "malformed";
    } else if (only.index <= layout.frontmatterEnd || only.index >= layout.firstHeading) {
      stampClass = "illegal-placement";
    } else {
      stampClass = "valid";
      stampIndex = only.index;
      stamp = Object.freeze({
        schema: SELF_HOST_MATRIX_STAMP_SCHEMA,
        inputs: parseSha256Hex(match[1]!),
        environment: parseSha256Hex(match[2]!),
        body: parseSha256Hex(match[3]!),
      });
    }
  }
  const normalizedLines = lines.filter((_line, index) => index !== stampIndex);
  normalizedLines[layout.verifiedIndex] = "verified: <volatile>";
  normalizedLines[layout.verifiedAtShaIndex] = "verified_at_sha: <volatile>";
  const normalizedBodyBytes = UTF8.encode(normalizedLines.join("\n"));
  const bodyDigest = sha256Raw(normalizedBodyBytes);
  const certificateDigest = stamp === null
    ? invalidCertificateDigest(stampClass as Exclude<MatrixStampClass, "valid">, bytes)
    : canonicalDigest(stamp);
  return Object.freeze({
    stampClass,
    stamp,
    normalizedBodyBytes,
    bodyDigest,
    certificateDigest,
    presentation,
  });
}

export function replaceMatrixPresentation(
  bytes: Uint8Array,
  presentation: { readonly verified: string; readonly verifiedAtSha: string },
): Uint8Array {
  if (!PRESENTATION_DATE.test(presentation.verified)) {
    throw new MatrixCertificateError("captured matrix presentation date must be YYYY-MM-DD");
  }
  if (!SHORT_GIT_OID.test(presentation.verifiedAtSha)) {
    throw new MatrixCertificateError("captured matrix presentation SHA must be lowercase Git hex");
  }
  const text = normalizeLf(bytes);
  const lines = text.split("\n");
  const layout = documentLayout(lines);
  lines[layout.verifiedIndex] = `verified: ${presentation.verified}`;
  lines[layout.verifiedAtShaIndex] = `verified_at_sha: ${presentation.verifiedAtSha}`;
  const replaced = lines.join("\n");
  if (/^verified_at_sha: unknown$/mu.test(replaced)) {
    throw new MatrixCertificateError("matrix candidate retains verified_at_sha: unknown");
  }
  return UTF8.encode(replaced);
}

export function insertMatrixStamp(
  bytes: Uint8Array,
  stamp: MatrixStamp,
): Uint8Array {
  const before = parseMatrixDocument(bytes);
  if (before.stampClass !== "absent") {
    throw new MatrixCertificateError("matrix stamp insertion requires a stampless document");
  }
  const stampLine = matrixStampLine(stamp);
  if (stamp.body !== before.bodyDigest) {
    throw new MatrixCertificateError("matrix stamp body does not match the unstamped document");
  }
  const lines = normalizeLf(bytes).split("\n");
  const layout = documentLayout(lines);
  lines.splice(layout.firstHeading, 0, stampLine);
  const stamped = UTF8.encode(lines.join("\n"));
  const after = parseMatrixDocument(stamped);
  if (
    after.stampClass !== "valid"
    || after.stamp === null
    || after.stamp.inputs !== stamp.inputs
    || after.stamp.environment !== stamp.environment
    || after.stamp.body !== stamp.body
    || after.bodyDigest !== before.bodyDigest
  ) {
    throw new MatrixCertificateError("inserted matrix stamp failed exact reparse");
  }
  return stamped;
}

export function matrixArtifactIdentity(bytes: Uint8Array | null): MatrixArtifactIdentity {
  return bytes === null
    ? Object.freeze({ kind: "absent" as const })
    : Object.freeze({
      kind: "present" as const,
      byteLength: bytes.byteLength,
      digest: sha256Raw(bytes),
    });
}

export function assertMatrixCandidateEqualsCommitted(
  candidate: Uint8Array,
  committed: Uint8Array,
): void {
  if (!sameBytes(candidate, committed)) {
    throw new MatrixCertificateError("published matrix bytes differ from the audited candidate");
  }
}

export function evaluateMatrixState(input: {
  readonly mode: MatrixMode;
  readonly evidence: MatrixRelationEvidence;
  readonly selected: boolean;
  readonly adoptCurrentEnvironment: boolean;
  readonly fullCheck: "failed" | "green" | "not-run";
}): MatrixStateDecision {
  const { evidence } = input;
  if (evidence.artifact === "absent") {
    if (evidence.stampClass !== "absent") throw new TypeError("absent artifact cannot carry a stamp");
    if (input.mode === "legacy-stampless") {
      return Object.freeze({ decision: "LEGACY_DUE", action: "repair", exitCode: 0 });
    }
    return input.adoptCurrentEnvironment
      ? Object.freeze({ decision: "REPAIR_REQUIRED", action: "repair", exitCode: 0 })
      : Object.freeze({ decision: "DUE_UNTRUSTED", action: "none", exitCode: 20 });
  }
  if (["duplicate", "illegal-placement", "malformed"].includes(evidence.stampClass)) {
    if (input.mode === "required-v1" && input.adoptCurrentEnvironment) {
      return Object.freeze({ decision: "REPAIR_REQUIRED", action: "repair", exitCode: 0 });
    }
    return input.mode === "required-v1"
      ? Object.freeze({ decision: "DUE_UNTRUSTED", action: "none", exitCode: 20 })
      : Object.freeze({ decision: "UNDECIDABLE", action: "none", exitCode: 21 });
  }
  if (evidence.stampClass === "absent") {
    if (input.mode === "required-v1") {
      return input.adoptCurrentEnvironment
        ? Object.freeze({ decision: "REPAIR_REQUIRED", action: "repair", exitCode: 0 })
        : Object.freeze({ decision: "DUE_UNTRUSTED", action: "none", exitCode: 20 });
    }
    return input.selected
      ? Object.freeze({ decision: "LEGACY_DUE", action: "repair", exitCode: 0 })
      : Object.freeze({ decision: "SKIPPED_LEGACY", action: "none", exitCode: 0 });
  }
  if (evidence.stampClass !== "valid") throw new TypeError("unhandled matrix stamp class");
  const inputsAndBodyEqual = evidence.inputs === "equal" && evidence.body === "equal";
  if (input.mode === "required-v1" && input.adoptCurrentEnvironment) {
    return Object.freeze({ decision: "REPAIR_REQUIRED", action: "repair", exitCode: 0 });
  }
  if (evidence.environment === "equal") {
    return inputsAndBodyEqual
      ? Object.freeze({ decision: "FRESH", action: "none", exitCode: 0 })
      : Object.freeze({ decision: "DUE", action: "none", exitCode: 20 });
  }
  if (input.fullCheck === "not-run") {
    return Object.freeze({ decision: "CHECK_REQUIRED", action: "check", exitCode: 0 });
  }
  if (input.fullCheck === "failed") {
    return Object.freeze({ decision: "CHECK_REQUIRED", action: "none", exitCode: 1 });
  }
  return inputsAndBodyEqual
    ? Object.freeze({ decision: "VERIFIED_FOREIGN", action: "none", exitCode: 0 })
    : Object.freeze({ decision: "VERIFIED_FOREIGN_DUE", action: "none", exitCode: 20 });
}

function oneValueArgument(args: readonly string[], prefix: string): string | null {
  const matches = args.filter((arg) => arg.startsWith(prefix));
  if (matches.length > 1) throw new MatrixCliError(`duplicate ${prefix.slice(0, -1)} argument`);
  if (matches.length === 0) return null;
  const value = matches[0]!.slice(prefix.length);
  if (value.length === 0) throw new MatrixCliError(`${prefix.slice(0, -1)} requires a value`);
  return value;
}

export function normalizeMatrixControllerArgs(
  argv: readonly string[],
  mode: MatrixMode = CURRENT_SELF_HOST_MATRIX_MODE,
  options: { readonly allowInternalLegacyRepair?: boolean } = {},
): NormalizedMatrixControllerArgs {
  const operations = ["--check", "--decide", "--probe", "--repair"]
    .filter((flag) => argv.includes(flag));
  if (operations.length !== 1) throw new MatrixCliError("expected exactly one matrix operation");
  for (const operation of operations) {
    if (argv.filter((arg) => arg === operation).length !== 1) {
      throw new MatrixCliError(`duplicate ${operation} operation`);
    }
  }
  const knownExact = new Set([
    "--check",
    "--decide",
    "--no-matrix",
    "--probe",
    "--progress",
    "--repair",
    "--with-matrix",
  ]);
  for (const arg of argv) {
    if (
      !knownExact.has(arg)
      && !arg.startsWith("--adopt-matrix-environment=")
      && !arg.startsWith("--function-mints=")
      && !arg.startsWith("--package=")
    ) {
      throw new MatrixCliError(`unknown matrix argument ${JSON.stringify(arg)}`);
    }
  }
  for (const flag of knownExact) {
    if (argv.filter((arg) => arg === flag).length > 1) throw new MatrixCliError(`duplicate ${flag}`);
  }
  const operation = operations[0]!.slice(2) as MatrixOperation;
  const progress = argv.includes("--progress");
  const withMatrix = argv.includes("--with-matrix");
  const noMatrix = argv.includes("--no-matrix");
  const packagePath = oneValueArgument(argv, "--package=");
  const mintText = oneValueArgument(argv, "--function-mints=");
  const adoptionText = oneValueArgument(argv, "--adopt-matrix-environment=");
  const adoption = adoptionText === null ? null : (() => {
    try {
      return parseSha256Hex(adoptionText);
    } catch {
      throw new MatrixCliError("matrix environment adoption must be one lowercase SHA-256 digest");
    }
  })();
  let functionMints: number | null = null;
  if (mintText !== null) {
    if (!/^(?:0|[1-9][0-9]*)$/u.test(mintText)) {
      throw new MatrixCliError("function mint count must be one non-negative integer");
    }
    functionMints = Number(mintText);
    if (!Number.isSafeInteger(functionMints)) throw new MatrixCliError("function mint count is unsafe");
  }
  if (withMatrix && noMatrix) throw new MatrixCliError("--with-matrix and --no-matrix conflict");
  if (adoption !== null && !withMatrix) {
    throw new MatrixCliError("matrix environment adoption requires --with-matrix");
  }
  if (mode === "legacy-stampless" && adoption !== null) {
    throw new MatrixCliError("matrix environment adoption is unavailable in legacy-stampless mode");
  }
  if (operation === "probe") {
    if (argv.length !== 1) throw new MatrixCliError("--probe accepts no controls");
  } else if (operation === "check") {
    if (functionMints !== null || adoption !== null || withMatrix || noMatrix) {
      throw new MatrixCliError("--check accepts only --progress and --package");
    }
  } else if (operation === "decide") {
    if (functionMints === null) throw new MatrixCliError("--decide requires exactly one --function-mints");
    if (packagePath !== null) throw new MatrixCliError("--package is check-only");
    if (mode === "required-v1" && withMatrix && adoption === null) {
      throw new MatrixCliError("required-v1 --with-matrix requires current environment adoption");
    }
  } else {
    if (functionMints !== null || noMatrix || packagePath !== null) {
      throw new MatrixCliError("--repair does not accept mint, skip, or package controls");
    }
    if (mode === "legacy-stampless") {
      if (!options.allowInternalLegacyRepair) {
        throw new MatrixCliError("legacy repair is controller-internal; use --decide");
      }
      if (withMatrix || adoption !== null) throw new MatrixCliError("internal legacy repair accepts no selectors");
    } else if (!withMatrix || adoption === null) {
      throw new MatrixCliError("required-v1 repair requires --with-matrix and environment adoption");
    }
  }
  return Object.freeze({
    operation,
    progress,
    packagePath,
    functionMints,
    withMatrix,
    noMatrix,
    adoptMatrixEnvironment: adoption,
  });
}

function validateArtifactIdentity(value: unknown, path: string): MatrixArtifactIdentity {
  const record = expectWireRecord(value, path);
  const kind = expectWireLiteral(record.kind, ["absent", "present"] as const, `${path}.kind`);
  if (kind === "absent") {
    expectClosedKeys(record, ["kind"], [], path);
    return Object.freeze({ kind });
  }
  expectClosedKeys(record, ["kind", "byteLength", "digest"], [], path);
  return Object.freeze({
    kind,
    byteLength: expectSafeUint(record.byteLength, `${path}.byteLength`),
    digest: parseSha256Hex(expectSha256(record.digest, `${path}.digest`)),
  });
}

const MATRIX_STAMP_CLASSES = Object.freeze([
  "absent",
  "duplicate",
  "illegal-placement",
  "malformed",
  "valid",
] as const satisfies readonly MatrixStampClass[]);

function receiptRelationKey(input: {
  readonly evidence: MatrixControllerReceipt["evidence"];
  readonly mode: MatrixMode;
  readonly operation: MatrixReceiptOperation;
  readonly decision: MatrixDecision;
  readonly result: MatrixResult;
  readonly stampClass: MatrixStampClass;
  readonly published: boolean;
}): string {
  return [
    input.evidence,
    input.mode,
    input.operation,
    input.decision,
    input.result,
    input.stampClass,
    input.published ? "published" : "not-published",
  ].join("\0");
}

const MATRIX_RECEIPT_RELATION_AUTHORITY: ReadonlySet<string> = (() => {
  const authority = new Set<string>();
  const add = (
    evidence: MatrixControllerReceipt["evidence"],
    mode: MatrixMode,
    operation: MatrixReceiptOperation,
    decision: MatrixDecision,
    result: MatrixResult,
    published: boolean,
    stampClasses: readonly MatrixStampClass[],
  ): void => {
    for (const stampClass of stampClasses) {
      authority.add(receiptRelationKey({ evidence, mode, operation, decision, result, stampClass, published }));
    }
  };
  const invalidStamps = ["duplicate", "illegal-placement", "malformed"] as const;
  const legacyDecisionStamps = Object.freeze({
    LEGACY_DUE: ["absent"],
    SKIPPED_LEGACY: ["absent"],
    UNDECIDABLE: invalidStamps,
    FRESH: ["valid"],
    DUE: ["valid"],
    CHECK_REQUIRED: ["valid"],
    VERIFIED_FOREIGN: ["valid"],
    VERIFIED_FOREIGN_DUE: ["valid"],
  } as const satisfies Partial<Record<MatrixDecision, readonly MatrixStampClass[]>>);
  const requiredDecisionStamps = Object.freeze({
    DUE_UNTRUSTED: ["absent", ...invalidStamps],
    FRESH: ["valid"],
    DUE: ["valid"],
    CHECK_REQUIRED: ["valid"],
    VERIFIED_FOREIGN: ["valid"],
    VERIFIED_FOREIGN_DUE: ["valid"],
    REPAIR_REQUIRED: MATRIX_STAMP_CLASSES,
    UNDECIDABLE: MATRIX_STAMP_CLASSES,
  } as const satisfies Partial<Record<MatrixDecision, readonly MatrixStampClass[]>>);
  const addFromDecisionTable = (
    mode: MatrixMode,
    operation: MatrixOperation,
    decision: MatrixDecision,
    result: MatrixResult,
    published: boolean,
  ): void => {
    const table = mode === "legacy-stampless" ? legacyDecisionStamps : requiredDecisionStamps;
    const stampClasses = table[decision as keyof typeof table] as readonly MatrixStampClass[] | undefined;
    if (stampClasses === undefined) throw new TypeError(`missing ${mode} matrix receipt decision authority for ${decision}`);
    add("complete", mode, operation, decision, result, published, stampClasses);
  };

  for (const mode of ["legacy-stampless", "required-v1"] as const) {
    add("unavailable", mode, "invalid", "UNDECIDABLE", "CLI_ERROR", false, MATRIX_STAMP_CLASSES);
    add("unavailable", mode, "decide", "SKIPPED_EXPLICIT", "SKIPPED_EXPLICIT", false, MATRIX_STAMP_CLASSES);
    for (const operation of ["check", "decide", "probe", "repair"] as const) {
      add("unavailable", mode, operation, "UNDECIDABLE", "UNDECIDABLE", false, MATRIX_STAMP_CLASSES);
    }
  }
  add("unavailable", "legacy-stampless", "decide", "UNDECIDABLE", "REPAIR_FAILED", false, MATRIX_STAMP_CLASSES);

  for (const decision of ["LEGACY_DUE", "SKIPPED_LEGACY", "UNDECIDABLE", "FRESH", "DUE", "CHECK_REQUIRED"] as const) {
    for (const result of ["CHECK_FAILED", "CHECK_OK", "DUE"] as const) {
      addFromDecisionTable("legacy-stampless", "check", decision, result, false);
    }
    addFromDecisionTable("legacy-stampless", "probe", decision, decision, false);
  }
  for (const decision of ["DUE_UNTRUSTED", "FRESH", "DUE", "CHECK_REQUIRED"] as const) {
    for (const result of ["CHECK_FAILED", "CHECK_OK", "DUE"] as const) {
      addFromDecisionTable("required-v1", "check", decision, result, false);
    }
    addFromDecisionTable("required-v1", "probe", decision, decision, false);
  }

  addFromDecisionTable("legacy-stampless", "decide", "LEGACY_DUE", "LEGACY_REPAIRED", true);
  addFromDecisionTable("legacy-stampless", "decide", "LEGACY_DUE", "REPAIR_FAILED", false);
  for (const decision of ["SKIPPED_LEGACY", "UNDECIDABLE", "FRESH", "DUE", "VERIFIED_FOREIGN", "VERIFIED_FOREIGN_DUE"] as const) {
    addFromDecisionTable("legacy-stampless", "decide", decision, decision, false);
  }
  addFromDecisionTable("legacy-stampless", "decide", "CHECK_REQUIRED", "CHECK_FAILED", false);

  for (const decision of ["DUE_UNTRUSTED", "FRESH", "DUE", "VERIFIED_FOREIGN", "VERIFIED_FOREIGN_DUE"] as const) {
    addFromDecisionTable("required-v1", "decide", decision, decision, false);
  }
  addFromDecisionTable("required-v1", "decide", "CHECK_REQUIRED", "CHECK_FAILED", false);
  addFromDecisionTable("required-v1", "decide", "REPAIR_REQUIRED", "REPAIR_FAILED", false);
  addFromDecisionTable("required-v1", "decide", "UNDECIDABLE", "CLI_ERROR", false);
  add("complete", "required-v1", "decide", "REPAIR_REQUIRED", "REPAIRED", true, ["valid"]);

  addFromDecisionTable("required-v1", "repair", "REPAIR_REQUIRED", "REPAIR_FAILED", false);
  addFromDecisionTable("required-v1", "repair", "UNDECIDABLE", "CLI_ERROR", false);
  add("complete", "required-v1", "repair", "REPAIR_REQUIRED", "REPAIRED", true, ["valid"]);
  addFromDecisionTable("legacy-stampless", "repair", "LEGACY_DUE", "LEGACY_REPAIRED", true);
  addFromDecisionTable("legacy-stampless", "repair", "LEGACY_DUE", "REPAIR_FAILED", false);
  return authority;
})();

function assertReceiptRelation(input: {
  readonly evidence: MatrixControllerReceipt["evidence"];
  readonly mode: MatrixMode;
  readonly operation: MatrixReceiptOperation;
  readonly decision: MatrixDecision;
  readonly result: MatrixResult;
  readonly stampClass: MatrixStampClass;
  readonly inputsDigest: Sha256Hex;
  readonly environmentDigest: Sha256Hex;
  readonly controllerDigest: Sha256Hex;
  readonly packageDigest: Sha256Hex;
  readonly sourceCommit: string;
  readonly verified: string;
  readonly verifiedAtSha: string;
  readonly published: boolean;
  readonly before: MatrixArtifactIdentity;
  readonly candidate: MatrixArtifactIdentity;
}): void {
  if (!MATRIX_RECEIPT_RELATION_AUTHORITY.has(receiptRelationKey(input))) {
    throw new ArtifactWireContractError("receipt", "operation, decision, result, stamp, publication, mode, and evidence are not an authorized state-table relation");
  }
  if (input.evidence === "unavailable") {
    if (
      input.inputsDigest !== UNAVAILABLE_MATRIX_IDENTITY_DIGEST
      || input.environmentDigest !== UNAVAILABLE_MATRIX_IDENTITY_DIGEST
      || input.packageDigest !== UNAVAILABLE_MATRIX_IDENTITY_DIGEST
    ) {
      throw new ArtifactWireContractError("receipt", "unavailable evidence must use unavailable input, environment, and package identities");
    }
    if (
      input.sourceCommit !== "0".repeat(40)
      || input.verified !== "1970-01-01"
      || input.verifiedAtSha !== "0".repeat(7)
    ) {
      throw new ArtifactWireContractError("receipt.capturedPresentation", "unavailable evidence must use the unavailable presentation sentinel");
    }
    if (input.candidate.kind !== "absent") {
      throw new ArtifactWireContractError("receipt.publication.candidate", "unavailable evidence cannot bind a candidate");
    }
    return;
  }
  if (
    input.inputsDigest === UNAVAILABLE_MATRIX_IDENTITY_DIGEST
    || input.environmentDigest === UNAVAILABLE_MATRIX_IDENTITY_DIGEST
    || input.controllerDigest === UNAVAILABLE_MATRIX_IDENTITY_DIGEST
    || input.packageDigest === UNAVAILABLE_MATRIX_IDENTITY_DIGEST
  ) {
    throw new ArtifactWireContractError("receipt", "complete evidence cannot use unavailable input, environment, controller, or package identities");
  }
  const repairedAbsentArtifact = input.evidence === "complete"
    && input.mode === "required-v1"
    && (input.operation === "decide" || input.operation === "repair")
    && input.decision === "REPAIR_REQUIRED"
    && input.result === "REPAIRED"
    && input.stampClass === "valid"
    && input.published
    && input.before.kind === "absent";
  if (input.stampClass !== "absent" && input.before.kind !== "present" && !repairedAbsentArtifact) {
    throw new ArtifactWireContractError("receipt", "a classified matrix stamp requires a present initial artifact");
  }
  if (
    input.mode === "legacy-stampless"
    && input.decision === "SKIPPED_LEGACY"
    && input.before.kind !== "present"
  ) {
    throw new ArtifactWireContractError("receipt", "SKIPPED_LEGACY requires a present stampless artifact");
  }
  if (
    input.mode === "legacy-stampless"
    && input.decision === "LEGACY_DUE"
    && (input.operation === "check" || input.operation === "probe")
    && input.before.kind !== "absent"
  ) {
    throw new ArtifactWireContractError("receipt", "check/probe LEGACY_DUE requires an absent artifact");
  }
  const candidateMustBePresent = (
    input.operation === "check"
    && (input.result === "CHECK_OK" || input.result === "DUE")
  ) || (
    (input.operation === "decide" || input.operation === "repair")
    && ["LEGACY_REPAIRED", "REPAIRED", "VERIFIED_FOREIGN", "VERIFIED_FOREIGN_DUE"].includes(input.result)
  );
  const candidateMustBeAbsent = input.operation === "probe"
    || (
      (input.operation === "decide" || input.operation === "repair")
      && !["CHECK_FAILED", "LEGACY_REPAIRED", "REPAIRED", "REPAIR_FAILED", "VERIFIED_FOREIGN", "VERIFIED_FOREIGN_DUE"].includes(input.result)
    );
  if (candidateMustBePresent && input.candidate.kind !== "present") {
    throw new ArtifactWireContractError("receipt.publication.candidate", "this operation result requires one rendered candidate");
  }
  if (candidateMustBeAbsent && input.candidate.kind !== "absent") {
    throw new ArtifactWireContractError("receipt.publication.candidate", "this operation result cannot carry a rendered candidate");
  }
}

function validateReceipt(value: unknown): MatrixControllerReceipt {
  const record = expectWireRecord(value, "receipt");
  expectClosedKeys(record, [
    "schema",
    "evidence",
    "failureDigest",
    "mode",
    "operation",
    "decision",
    "result",
    "stampClass",
    "inputsDigest",
    "environmentDigest",
    "bodyDigest",
    "certificateDigest",
    "controllerDigest",
    "packageDigest",
    "capturedPresentation",
    "publication",
  ], [], "receipt");
  const presentation = expectWireRecord(record.capturedPresentation, "receipt.capturedPresentation");
  expectClosedKeys(presentation, ["sourceCommit", "verified", "verifiedAtSha"], [], "receipt.capturedPresentation");
  const sourceCommit = expectGitOid(presentation.sourceCommit, "receipt.capturedPresentation.sourceCommit");
  const verified = expectWireString(presentation.verified, "receipt.capturedPresentation.verified");
  const verifiedAtSha = expectWireString(presentation.verifiedAtSha, "receipt.capturedPresentation.verifiedAtSha");
  if (!PRESENTATION_DATE.test(verified)) throw new ArtifactWireContractError("receipt.capturedPresentation.verified", "expected YYYY-MM-DD");
  if (!SHORT_GIT_OID.test(verifiedAtSha) || !sourceCommit.startsWith(verifiedAtSha)) {
    throw new ArtifactWireContractError("receipt.capturedPresentation.verifiedAtSha", "must be a prefix of sourceCommit");
  }
  const publication = expectWireRecord(record.publication, "receipt.publication");
  expectClosedKeys(publication, ["published", "before", "candidate", "after"], [], "receipt.publication");
  const published = requireBoolean(publication.published, "receipt.publication.published");
  const before = validateArtifactIdentity(publication.before, "receipt.publication.before");
  const candidate = validateArtifactIdentity(publication.candidate, "receipt.publication.candidate");
  const after = validateArtifactIdentity(publication.after, "receipt.publication.after");
  if (published) {
    if (candidate.kind !== "present" || !sameIdentity(candidate, after)) {
      throw new ArtifactWireContractError("receipt.publication", "published candidate must exactly equal after identity");
    }
  } else if (!sameIdentity(before, after)) {
    throw new ArtifactWireContractError("receipt.publication", "non-publication must preserve the artifact identity");
  }
  const mode = expectWireLiteral(record.mode, ["legacy-stampless", "required-v1"] as const, "receipt.mode");
  const evidence = expectWireLiteral(record.evidence, ["complete", "unavailable"] as const, "receipt.evidence");
  const failureDigest = parseSha256Hex(expectSha256(record.failureDigest, "receipt.failureDigest"));
  if (evidence === "complete" && failureDigest !== MATRIX_NO_FAILURE_DIGEST) {
    throw new ArtifactWireContractError("receipt.failureDigest", "complete evidence must use the no-failure digest");
  }
  if (evidence === "unavailable" && failureDigest === MATRIX_NO_FAILURE_DIGEST) {
    throw new ArtifactWireContractError("receipt.failureDigest", "unavailable evidence must bind one failure reason");
  }
  const stampClass = expectWireLiteral(record.stampClass, ["absent", "duplicate", "illegal-placement", "malformed", "valid"] as const, "receipt.stampClass");
  const certificateDigest = parseSha256Hex(expectSha256(record.certificateDigest, "receipt.certificateDigest"));
  if (mode === "legacy-stampless" && stampClass === "absent" && certificateDigest !== LEGACY_STAMPLESS_TOMBSTONE_DIGEST) {
    throw new ArtifactWireContractError("receipt.certificateDigest", "legacy absent evidence must use the kind-only tombstone");
  }
  const operation = expectWireLiteral(record.operation, ["check", "decide", "invalid", "probe", "repair"] as const, "receipt.operation");
  const decision = expectWireLiteral(record.decision, ["CHECK_REQUIRED", "DUE", "DUE_UNTRUSTED", "FRESH", "LEGACY_DUE", "REPAIR_REQUIRED", "SKIPPED_EXPLICIT", "SKIPPED_LEGACY", "UNDECIDABLE", "VERIFIED_FOREIGN", "VERIFIED_FOREIGN_DUE"] as const, "receipt.decision");
  const result = expectWireLiteral(record.result, ["FRESH", "CHECK_FAILED", "CHECK_OK", "CHECK_REQUIRED", "CLI_ERROR", "DUE", "DUE_UNTRUSTED", "LEGACY_DUE", "LEGACY_REPAIRED", "REPAIRED", "REPAIR_FAILED", "REPAIR_REQUIRED", "SKIPPED_EXPLICIT", "SKIPPED_LEGACY", "UNDECIDABLE", "VERIFIED_FOREIGN", "VERIFIED_FOREIGN_DUE"] as const, "receipt.result");
  const inputsDigest = parseSha256Hex(expectSha256(record.inputsDigest, "receipt.inputsDigest"));
  const environmentDigest = parseSha256Hex(expectSha256(record.environmentDigest, "receipt.environmentDigest"));
  const bodyDigest = parseSha256Hex(expectSha256(record.bodyDigest, "receipt.bodyDigest"));
  const controllerDigest = parseSha256Hex(expectSha256(record.controllerDigest, "receipt.controllerDigest"));
  const packageDigest = parseSha256Hex(expectSha256(record.packageDigest, "receipt.packageDigest"));
  if ((result === "FRESH" || result === "REPAIRED") && (stampClass !== "valid" || evidence !== "complete")) {
    throw new ArtifactWireContractError("receipt.result", `${result} requires one valid v1 stamp`);
  }
  assertReceiptRelation({
    evidence,
    mode,
    operation,
    decision,
    result,
    stampClass,
    inputsDigest,
    environmentDigest,
    controllerDigest,
    packageDigest,
    sourceCommit,
    verified,
    verifiedAtSha,
    published,
    before,
    candidate,
  });
  return Object.freeze({
    schema: expectWireLiteral(record.schema, [SELF_HOST_MATRIX_RECEIPT_SCHEMA] as const, "receipt.schema"),
    evidence,
    failureDigest,
    mode,
    operation,
    decision,
    result,
    stampClass,
    inputsDigest,
    environmentDigest,
    bodyDigest,
    certificateDigest,
    controllerDigest,
    packageDigest,
    capturedPresentation: Object.freeze({ sourceCommit, verified, verifiedAtSha }),
    publication: Object.freeze({ published, before, candidate, after }),
  });
}

export function makeMatrixControllerReceipt(
  input: Omit<MatrixControllerReceipt, "schema">,
): MatrixControllerReceipt {
  return validateReceipt({ schema: SELF_HOST_MATRIX_RECEIPT_SCHEMA, ...input });
}

export function encodeMatrixControllerReceipt(receipt: MatrixControllerReceipt): Uint8Array {
  return encodeCanonicalJson(validateReceipt(receipt));
}

export function parseMatrixControllerReceipt(bytes: Uint8Array): MatrixControllerReceipt {
  return validateReceipt(parseCanonicalJson(bytes));
}

export function computeMatrixReceiptDigest(receipt: MatrixControllerReceipt): Sha256Hex {
  return sha256Raw(encodeMatrixControllerReceipt(receipt));
}

export function computeMatrixPackageDigest(input: {
  readonly inputsDigest: Sha256Hex;
  readonly environmentDigest: Sha256Hex;
  readonly controllerDigest: Sha256Hex;
  readonly sourceCommit: string;
  readonly verified: string;
  readonly verifiedAtSha: string;
  readonly initialArtifact: MatrixArtifactIdentity;
}): Sha256Hex {
  if (!GIT_OID.test(input.sourceCommit)) throw new TypeError("matrix package source commit must be one full Git OID");
  if (!PRESENTATION_DATE.test(input.verified)) throw new TypeError("matrix package verified date must be YYYY-MM-DD");
  if (!SHORT_GIT_OID.test(input.verifiedAtSha) || !input.sourceCommit.startsWith(input.verifiedAtSha)) {
    throw new TypeError("matrix package verified SHA must prefix source commit");
  }
  return canonicalDigest({
    schema: SELF_HOST_MATRIX_PACKAGE_SCHEMA,
    inputsDigest: parseSha256Hex(input.inputsDigest),
    environmentDigest: parseSha256Hex(input.environmentDigest),
    controllerDigest: parseSha256Hex(input.controllerDigest),
    sourceCommit: input.sourceCommit,
    verified: input.verified,
    verifiedAtSha: input.verifiedAtSha,
    initialArtifact: input.initialArtifact,
  });
}

export function makeMatrixLeg(input: {
  readonly receipt: MatrixControllerReceipt;
  readonly currentArtifact: MatrixArtifactIdentity;
  readonly currentBodyDigest: Sha256Hex;
  readonly currentControllerDigest: Sha256Hex;
  readonly currentPackageDigest: Sha256Hex;
  readonly currentCertificateDigest: Sha256Hex;
}): MatrixLeg {
  const receipt = validateReceipt(input.receipt);
  const receiptDigest = computeMatrixReceiptDigest(receipt);
  const artifact = validateArtifactIdentity(input.currentArtifact, "matrixLeg.artifact");
  const bodyDigest = parseSha256Hex(input.currentBodyDigest);
  const controllerDigest = parseSha256Hex(input.currentControllerDigest);
  const packageDigest = parseSha256Hex(input.currentPackageDigest);
  const certificateDigest = parseSha256Hex(input.currentCertificateDigest);
  if (receipt.evidence === "complete") {
    if (!sameIdentity(receipt.publication.after, artifact)) throw new MatrixCertificateError("matrix receipt artifact identity is no longer current");
    if (receipt.bodyDigest !== bodyDigest) throw new MatrixCertificateError("matrix receipt body identity is no longer current");
    if (receipt.controllerDigest !== controllerDigest) throw new MatrixCertificateError("matrix receipt controller identity is no longer current");
    if (receipt.packageDigest !== packageDigest) throw new MatrixCertificateError("matrix receipt package identity is no longer current");
    if (receipt.certificateDigest !== certificateDigest) throw new MatrixCertificateError("matrix receipt certificate identity is no longer current");
  }
  const base = Object.freeze({
    schema: SELF_HOST_MATRIX_LEG_SCHEMA,
    receiptDigest,
    artifact,
    bodyDigest,
    controllerDigest,
    packageDigest,
    certificateDigest,
  });
  return Object.freeze({ ...base, matrixLegDigest: canonicalDigest(base) });
}

function environmentRowsFromWire(
  value: unknown,
  path: string,
): readonly MatrixEnvironmentVariable[] {
  const rows = expectWireArray(value, path).map((row, index) => {
    const rowPath = `${path}[${index}]`;
    const record = expectWireRecord(row, rowPath);
    expectClosedKeys(record, ["key", "value"], [], rowPath);
    return Object.freeze({
      key: expectWireString(record.key, `${rowPath}.key`),
      value: expectWireString(record.value, `${rowPath}.value`),
    });
  });
  assertUtf8SortedUnique(rows.map((row) => row.key), path);
  return Object.freeze(rows);
}

function manifestFromWire(value: unknown, path: string, expectedDomain: string): ByteManifest {
  const record = expectWireRecord(value, path);
  expectClosedKeys(record, [
    "schema",
    "domain",
    "rows",
    "fileCount",
    "byteLength",
    "digest",
  ], [], path);
  expectWireLiteral(record.schema, ["fenel.byte-manifest.v1"] as const, `${path}.schema`);
  const domain = expectWireString(record.domain, `${path}.domain`);
  if (domain !== expectedDomain) {
    throw new ArtifactWireContractError(`${path}.domain`, `expected ${expectedDomain}`);
  }
  const rows = expectWireArray(record.rows, `${path}.rows`).map((row, index) => {
    const rowPath = `${path}.rows[${index}]`;
    const rowRecord = expectWireRecord(row, rowPath);
    expectClosedKeys(rowRecord, ["path", "kind", "byteLength", "sha256"], [], rowPath);
    return Object.freeze({
      path: repositoryRelativePath(expectWireString(rowRecord.path, `${rowPath}.path`)),
      kind: expectWireLiteral(rowRecord.kind, ["regular-file"] as const, `${rowPath}.kind`),
      byteLength: expectSafeUint(rowRecord.byteLength, `${rowPath}.byteLength`),
      sha256: parseSha256Hex(expectSha256(rowRecord.sha256, `${rowPath}.sha256`)),
    });
  });
  assertUtf8SortedUnique(rows.map((row) => row.path), `${path}.rows`);
  const manifest = digestByteManifest(domain, rows);
  if (
    expectSafeUint(record.fileCount, `${path}.fileCount`) !== manifest.fileCount
    || expectSafeUint(record.byteLength, `${path}.byteLength`) !== manifest.byteLength
    || parseSha256Hex(expectSha256(record.digest, `${path}.digest`)) !== manifest.digest
  ) {
    throw new ArtifactWireContractError(path, "byte-manifest summary does not match its rows");
  }
  return manifest;
}

/** Closed fixture/schema decoder for future immutable-package environment records. */
export function parseMatrixEnvironmentCertificate(bytes: Uint8Array): MatrixEnvironmentCertificate {
  const record = expectWireRecord(parseCanonicalJson(bytes), "environment");
  expectClosedKeys(record, [
    "schema",
    "osFamily",
    "arch",
    "bun",
    "toolchainManifestDigest",
    "locale",
    "timezone",
    "parentEnvironment",
    "declaredAbsent",
    "externalTool",
    "digest",
  ], [], "environment");
  expectWireLiteral(
    record.schema,
    [SELF_HOST_MATRIX_ENVIRONMENT_SCHEMA] as const,
    "environment.schema",
  );
  const bun = expectWireRecord(record.bun, "environment.bun");
  expectClosedKeys(bun, [
    "executableSha256",
    "release",
    "revision",
    "webkit",
    "icu",
    "unicode",
  ], [], "environment.bun");
  const declaredAbsent = expectWireArray(record.declaredAbsent, "environment.declaredAbsent")
    .map((value, index) => expectWireString(value, `environment.declaredAbsent[${index}]`));
  if (JSON.stringify(declaredAbsent) !== JSON.stringify(ABSENT_VARIABLES)) {
    throw new ArtifactWireContractError(
      "environment.declaredAbsent",
      "must equal the closed v1 absent-variable set",
    );
  }
  const tool = expectWireRecord(record.externalTool, "environment.externalTool");
  const mode = expectWireLiteral(
    tool.mode,
    ["shape-only", "pinned-bundle"] as const,
    "environment.externalTool.mode",
  );
  let externalTool: MatrixExternalToolEnvironment;
  if (mode === "shape-only") {
    expectClosedKeys(tool, ["mode", "privatePath", "clang"], [], "environment.externalTool");
    externalTool = Object.freeze({
      mode,
      privatePath: expectWireLiteral(
        tool.privatePath,
        ["<matrix-package>/.bin"] as const,
        "environment.externalTool.privatePath",
      ),
      clang: expectWireLiteral(tool.clang, ["absent"] as const, "environment.externalTool.clang"),
    });
  } else {
    expectClosedKeys(tool, [
      "mode",
      "archiveSha256",
      "entrypoint",
      "manifest",
      "childEnvironment",
    ], [], "environment.externalTool");
    externalTool = Object.freeze({
      mode,
      archiveSha256: parseSha256Hex(expectSha256(
        tool.archiveSha256,
        "environment.externalTool.archiveSha256",
      )),
      entrypoint: repositoryRelativePath(expectWireString(
        tool.entrypoint,
        "environment.externalTool.entrypoint",
      )),
      manifest: manifestFromWire(
        tool.manifest,
        "environment.externalTool.manifest",
        "self-host-matrix-toolchain-bundle",
      ),
      childEnvironment: environmentRowsFromWire(
        tool.childEnvironment,
        "environment.externalTool.childEnvironment",
      ),
    });
  }
  const rebuilt = makeMatrixEnvironmentCertificate({
    osFamily: expectWireLiteral(
      record.osFamily,
      ["linux", "macos", "windows"] as const,
      "environment.osFamily",
    ),
    arch: expectWireLiteral(record.arch, ["arm64", "x64"] as const, "environment.arch"),
    bun: {
      executableSha256: parseSha256Hex(expectSha256(
        bun.executableSha256,
        "environment.bun.executableSha256",
      )),
      release: expectWireString(bun.release, "environment.bun.release"),
      revision: expectWireString(bun.revision, "environment.bun.revision"),
      webkit: expectWireString(bun.webkit, "environment.bun.webkit"),
      icu: expectWireString(bun.icu, "environment.bun.icu"),
      unicode: expectWireString(bun.unicode, "environment.bun.unicode"),
    },
    toolchainManifestDigest: parseSha256Hex(expectSha256(
      record.toolchainManifestDigest,
      "environment.toolchainManifestDigest",
    )),
    locale: expectWireString(record.locale, "environment.locale"),
    timezone: expectWireString(record.timezone, "environment.timezone"),
    parentEnvironment: environmentRowsFromWire(
      record.parentEnvironment,
      "environment.parentEnvironment",
    ),
    externalTool,
  });
  if (parseSha256Hex(expectSha256(record.digest, "environment.digest")) !== rebuilt.digest) {
    throw new ArtifactWireContractError("environment.digest", "does not match the environment record");
  }
  return rebuilt;
}

export function encodeMatrixEnvironmentCertificate(value: MatrixEnvironmentCertificate): Uint8Array {
  return encodeCanonicalJson(validateMatrixEnvironmentCertificate(value));
}

export function matrixStampLine(stamp: MatrixStamp): string {
  if (stamp.schema !== SELF_HOST_MATRIX_STAMP_SCHEMA) throw new TypeError("unsupported matrix stamp schema");
  return `<!-- fenel:self-host-matrix:v1 inputs=${parseSha256Hex(stamp.inputs)} environment=${parseSha256Hex(stamp.environment)} body=${parseSha256Hex(stamp.body)} -->`;
}

export function matrixStampFor(input: {
  readonly inputs: MatrixInputsCertificate;
  readonly environment: MatrixEnvironmentCertificate;
  readonly bodyDigest: Sha256Hex;
}): MatrixStamp {
  return Object.freeze({
    schema: SELF_HOST_MATRIX_STAMP_SCHEMA,
    inputs: validateMatrixInputsCertificate(input.inputs).digest,
    environment: validateMatrixEnvironmentCertificate(input.environment).digest,
    body: parseSha256Hex(input.bodyDigest),
  });
}
