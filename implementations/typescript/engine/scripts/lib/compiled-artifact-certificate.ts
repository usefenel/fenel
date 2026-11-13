/**
 * Crash-consistent byte publication and recovery stubs for compiled artifacts.
 *
 * This helper is deliberately product-blind: owners provide already-rendered
 * bytes and already-computed epoch identities. It never constructs registries,
 * chooses shards, or interprets Fenel values.
 */

import { createHash, randomBytes } from "node:crypto";
import {
  closeSync,
  existsSync,
  fsyncSync,
  mkdirSync,
  openSync,
  readFileSync,
  renameSync,
  unlinkSync,
  writeSync,
} from "node:fs";
import { dirname, isAbsolute, relative, resolve, sep } from "node:path";
import { encodeCanonicalJson } from "./artifact-wire-json";
import type { RawCompiledArtifactInput } from "./compiled-artifact-input-key";
import {
  canonicalizeProducerAttestations,
  type CompiledArtifactCheckAttestation,
  type CompiledArtifactId,
  type Sha256Hex,
} from "./compiled-artifact-attestation";
import {
  BUILD_CERTIFICATE_SCHEMA,
  COMPILED_ARTIFACT_SPECS,
  computeCertificateBaseDigest,
  computeCertificateDigest,
  OWNER_PROTOCOL,
  PORTABLE_GENERATION_ABI,
  validateAndDigestCertificateBytes,
  validateBuildCertificate,
  type BuildCertificateInputManifest,
  type CompiledArtifactBuildCertificate,
} from "./compiled-artifact-protocol";

export const RECOVERY_STUB_SCHEMA = "fenel.compiled-artifact-recovery-stubs.v1" as const;

const GENERATED_DIRECTORY = "implementations/typescript/engine/src/generated";
const PARSE_CACHE_PATH = `${GENERATED_DIRECTORY}/parse-cache.generated.ts`;
const HONESTY_PATH = `${GENERATED_DIRECTORY}/signature-honesty-claims.json`;

const UTF8 = new TextEncoder();

function compiledStub(prefix: "PARSER" | "RESOLVER"): string {
  const owner = prefix === "PARSER" ? "compiled-parser" : "compiled-resolver";
  return `// M3b fixed inert recovery stub — never publish this file.\n`
    + `export const ${prefix}_IDENTITY_DOMAIN = Object.freeze({ schema: "fenel.compiled-identity-input.v1", owner: "${owner}", kind: "all", digest: "${"0".repeat(64)}" });\n`
    + `export const ${prefix}_MANIFEST_HASH = "${"0".repeat(64)}";\n`
    + `export const ${prefix}_RUNTIME_INPUT_HASH = "${"0".repeat(64)}";\n`
    + `export const ${prefix}_BOOTSTRAP_RUNTIME_INPUT_HASH = "${"0".repeat(64)}";\n`
    + `export const ${prefix}_SHARDS: Readonly<Record<string, Readonly<{ identityDomain: typeof ${prefix}_IDENTITY_DOMAIN; closureIds: readonly string[]; manifestHash: string; runtimeInputHash: string; bootstrapRuntimeInputHash: string }>>> = Object.freeze(Object.create(null));\n`
    + `export const ${prefix}_ENTRY_CODES: Readonly<Record<string, string>> = Object.freeze(Object.create(null));\n`
    + `export const ${prefix}_CLOSURE_IDS: readonly string[] = Object.freeze([]);\n`
    + `export const ${prefix}_REQUIRED_NATIVES: readonly string[] = Object.freeze([]);\n`
    + `export const ${prefix}_FN_BODIES: Readonly<Record<string, string>> = Object.freeze(Object.create(null));\n`;
}

const RECOVERY_STUB_TEXT: Readonly<Record<string, string>> = Object.freeze({
  [PARSE_CACHE_PATH]: [
    "// M3b fixed inert recovery stub — never publish this file.",
    'import { PARSE_CACHE_AST_ABI_VERSION } from "../parse-cache-abi";',
    "export const PARSE_CACHE_VERSION = PARSE_CACHE_AST_ABI_VERSION;",
    "export const PARSE_CACHE_COUNT = 0;",
    'export const PARSE_CACHE_JSON = "{}";',
    "",
  ].join("\n"),
  [HONESTY_PATH]: "{}\n",
  [COMPILED_ARTIFACT_SPECS["compiled-parser"].artifactPath]: compiledStub("PARSER"),
  [COMPILED_ARTIFACT_SPECS["compiled-resolver"].artifactPath]: compiledStub("RESOLVER"),
  [COMPILED_ARTIFACT_SPECS["compiled-parser"].certificatePath]: "{}\n",
  [COMPILED_ARTIFACT_SPECS["compiled-resolver"].certificatePath]: "{}\n",
});

export type RecoveryStub = {
  readonly path: string;
  readonly bytes: Uint8Array;
  readonly digest: Sha256Hex;
};

export function sha256Bytes(bytes: Uint8Array): Sha256Hex {
  return createHash("sha256").update(bytes).digest("hex");
}

export function compiledArtifactRecoveryStubs(): readonly RecoveryStub[] {
  return Object.entries(RECOVERY_STUB_TEXT)
    .sort(([left], [right]) => Buffer.compare(Buffer.from(left), Buffer.from(right)))
    .map(([path, text]) => {
      const bytes = UTF8.encode(text);
      return Object.freeze({ path, bytes, digest: sha256Bytes(bytes) });
    });
}

export const RECOVERY_STUB_VERSION: Sha256Hex = sha256Bytes(encodeCanonicalJson({
  schema: RECOVERY_STUB_SCHEMA,
  rows: compiledArtifactRecoveryStubs().map(({ path, bytes, digest }) => ({
    path,
    byteLength: bytes.byteLength,
    digest,
  })),
}));

export function assertExactLfArtifact(bytes: Uint8Array): void {
  if (bytes.byteLength === 0 || bytes[bytes.byteLength - 1] !== 0x0a) {
    throw new Error("compiled artifact must end in exactly one LF-terminated text record");
  }
  for (const byte of bytes) {
    if (byte === 0x0d) throw new Error("compiled artifact contains a forbidden CR byte");
  }
  // Generated TypeScript is UTF-8 text. Fatal decoding prevents hashing an
  // opaque byte sequence and later claiming it was the intended render.
  new TextDecoder("utf-8", { fatal: true }).decode(bytes);
}

function assertWithinDirectory(directory: string, target: string): void {
  const base = resolve(directory);
  const absolute = resolve(target);
  const rel = relative(base, absolute);
  if (rel === "" || rel === ".") return;
  if (isAbsolute(rel) || rel === ".." || rel.startsWith(`..${sep}`)) {
    throw new Error(`publication target escapes generated directory: ${target}`);
  }
}

function syncDirectoryBestEffort(directory: string): void {
  let descriptor: number | undefined;
  try {
    descriptor = openSync(directory, "r");
    fsyncSync(descriptor);
  } catch (error) {
    const code = (error as NodeJS.ErrnoException).code;
    if (!["EACCES", "EBADF", "EINVAL", "EISDIR", "ENOTSUP", "EPERM"].includes(code ?? "")) {
      throw error;
    }
  } finally {
    if (descriptor !== undefined) closeSync(descriptor);
  }
}

function uniqueSiblingTemp(target: string): string {
  const nonce = randomBytes(12).toString("hex");
  return resolve(dirname(target), `.${target.split(/[\\/]/).at(-1)!}.m3b-${process.pid}-${nonce}.tmp`);
}

/** Same-directory create+flush+rename replacement. Only this invocation's temp is cleaned. */
export function atomicReplaceExact(
  target: string,
  bytes: Uint8Array,
  expectedDirectory = dirname(target),
): void {
  assertWithinDirectory(expectedDirectory, target);
  mkdirSync(expectedDirectory, { recursive: true });
  const temp = uniqueSiblingTemp(target);
  assertWithinDirectory(expectedDirectory, temp);
  let descriptor: number | undefined;
  let created = false;
  try {
    descriptor = openSync(temp, "wx", 0o600);
    created = true;
    let offset = 0;
    while (offset < bytes.byteLength) {
      const written = writeSync(descriptor, bytes, offset, bytes.byteLength - offset);
      if (written <= 0) throw new Error(`short atomic write for ${target}`);
      offset += written;
    }
    fsyncSync(descriptor);
    closeSync(descriptor);
    descriptor = undefined;
    renameSync(temp, target);
    created = false;
    syncDirectoryBestEffort(expectedDirectory);
    const observed = readFileSync(target);
    if (!observed.equals(Buffer.from(bytes))) {
      throw new Error(`atomic replacement reread differs from intended bytes: ${target}`);
    }
  } finally {
    if (descriptor !== undefined) closeSync(descriptor);
    if (created && existsSync(temp)) unlinkSync(temp);
  }
}

export function makeBaseBuildCertificate(input: {
  readonly artifact: CompiledArtifactId;
  readonly repositoryEpoch: Sha256Hex;
  readonly ownerEpoch: Sha256Hex;
  readonly dependencyDigest: Sha256Hex;
  readonly artifactBytes: Uint8Array;
  readonly inputManifest: BuildCertificateInputManifest;
  readonly producerInput: RawCompiledArtifactInput;
  readonly producerCheckPackageDigest: Sha256Hex;
}): CompiledArtifactBuildCertificate {
  assertExactLfArtifact(input.artifactBytes);
  return validateBuildCertificate({
    schema: BUILD_CERTIFICATE_SCHEMA,
    protocol: OWNER_PROTOCOL,
    artifact: input.artifact,
    artifactPath: COMPILED_ARTIFACT_SPECS[input.artifact].artifactPath,
    repositoryEpoch: input.repositoryEpoch,
    ownerEpoch: input.ownerEpoch,
    dependencyDigest: input.dependencyDigest,
    portableGenerationAbi: PORTABLE_GENERATION_ABI,
    artifactByteLength: input.artifactBytes.byteLength,
    artifactDigest: sha256Bytes(input.artifactBytes),
    inputManifest: input.inputManifest,
    producerInput: input.producerInput,
    producerCheckPackageDigest: input.producerCheckPackageDigest,
    producerAttestations: [],
  });
}

export type ObservedArtifactPair = {
  readonly certificate: CompiledArtifactBuildCertificate;
  readonly certificateBytes: Uint8Array;
  readonly certificateDigest: Sha256Hex;
  readonly artifactBytes: Uint8Array;
  readonly artifactDigest: Sha256Hex;
};

export function readArtifactPair(
  repositoryRoot: string,
  artifact: CompiledArtifactId,
): ObservedArtifactPair {
  const generatedDirectory = resolve(repositoryRoot, GENERATED_DIRECTORY);
  const spec = COMPILED_ARTIFACT_SPECS[artifact];
  const artifactPath = resolve(repositoryRoot, spec.artifactPath);
  const certificatePath = resolve(repositoryRoot, spec.certificatePath);
  assertWithinDirectory(generatedDirectory, artifactPath);
  assertWithinDirectory(generatedDirectory, certificatePath);
  const sidecarA = readFileSync(certificatePath);
  const artifactBytes = readFileSync(artifactPath);
  const sidecarB = readFileSync(certificatePath);
  if (!sidecarA.equals(sidecarB)) {
    throw new Error(`${artifact} sidecar changed during sidecar/artifact/sidecar read`);
  }
  assertExactLfArtifact(artifactBytes);
  const { certificate, certificateDigest } = validateAndDigestCertificateBytes(sidecarA);
  if (certificate.artifact !== artifact) throw new Error(`${artifact} sidecar kind mismatch`);
  const artifactDigest = sha256Bytes(artifactBytes);
  if (
    certificate.artifactByteLength !== artifactBytes.byteLength
    || certificate.artifactDigest !== artifactDigest
  ) {
    throw new Error(`${artifact} sidecar does not bind the observed artifact bytes`);
  }
  return {
    certificate,
    certificateBytes: new Uint8Array(sidecarA),
    certificateDigest,
    artifactBytes: new Uint8Array(artifactBytes),
    artifactDigest,
  };
}

function invalidateCertificate(certificatePath: string, generatedDirectory: string): void {
  assertWithinDirectory(generatedDirectory, certificatePath);
  if (existsSync(certificatePath)) {
    unlinkSync(certificatePath);
    syncDirectoryBestEffort(generatedDirectory);
  }
}

export async function publishArtifactAndBaseCertificate(input: {
  readonly repositoryRoot: string;
  readonly artifact: CompiledArtifactId;
  readonly artifactBytes: Uint8Array;
  readonly certificate: CompiledArtifactBuildCertificate;
  readonly assertEpoch: () => void | Promise<void>;
}): Promise<ObservedArtifactPair> {
  assertExactLfArtifact(input.artifactBytes);
  const generatedDirectory = resolve(input.repositoryRoot, GENERATED_DIRECTORY);
  const spec = COMPILED_ARTIFACT_SPECS[input.artifact];
  const artifactPath = resolve(input.repositoryRoot, spec.artifactPath);
  const certificatePath = resolve(input.repositoryRoot, spec.certificatePath);
  assertWithinDirectory(generatedDirectory, artifactPath);
  assertWithinDirectory(generatedDirectory, certificatePath);
  const base = validateBuildCertificate({
    ...input.certificate,
    producerAttestations: [],
  });
  if (base.artifact !== input.artifact) {
    throw new Error(`base certificate kind ${base.artifact} does not match ${input.artifact}`);
  }
  if (
    base.artifactDigest !== sha256Bytes(input.artifactBytes)
    || base.artifactByteLength !== input.artifactBytes.byteLength
  ) {
    throw new Error("base certificate does not bind intended artifact bytes");
  }
  let publicationStarted = false;
  try {
    await input.assertEpoch();
    publicationStarted = true;
    invalidateCertificate(certificatePath, generatedDirectory);
    atomicReplaceExact(artifactPath, input.artifactBytes, generatedDirectory);
    const observedArtifact = readFileSync(artifactPath);
    if (!observedArtifact.equals(Buffer.from(input.artifactBytes))) {
      throw new Error("published artifact differs from intended render");
    }
    await input.assertEpoch();
    atomicReplaceExact(certificatePath, encodeCanonicalJson(base), generatedDirectory);
    const pair = readArtifactPair(input.repositoryRoot, input.artifact);
    await input.assertEpoch();
    return pair;
  } catch (error) {
    if (publicationStarted) invalidateCertificate(certificatePath, generatedDirectory);
    throw error;
  }
}

type AttestationPublicationInput = {
  readonly repositoryRoot: string;
  readonly artifact: CompiledArtifactId;
  readonly attestations: readonly CompiledArtifactCheckAttestation[];
  readonly assertEpoch: () => void | Promise<void>;
};

async function publishArtifactAttestations(
  input: AttestationPublicationInput,
  retainExisting: boolean,
): Promise<ObservedArtifactPair> {
  const generatedDirectory = resolve(input.repositoryRoot, GENERATED_DIRECTORY);
  const certificatePath = resolve(
    input.repositoryRoot,
    COMPILED_ARTIFACT_SPECS[input.artifact].certificatePath,
  );
  await input.assertEpoch();
  const before = readArtifactPair(input.repositoryRoot, input.artifact);
  const beforeBaseDigest = computeCertificateBaseDigest(before.certificate);
  const merged = validateBuildCertificate({
    ...before.certificate,
    producerAttestations: canonicalizeProducerAttestations([
      ...(retainExisting ? before.certificate.producerAttestations : []),
      ...input.attestations,
    ]),
  });
  await input.assertEpoch();
  const stillCurrent = readArtifactPair(input.repositoryRoot, input.artifact);
  if (
    !Buffer.from(stillCurrent.certificateBytes).equals(Buffer.from(before.certificateBytes))
    || !Buffer.from(stillCurrent.artifactBytes).equals(Buffer.from(before.artifactBytes))
  ) {
    throw new Error(`${input.artifact} changed before attestations could be merged`);
  }
  let sidecarPublicationStarted = false;
  try {
    sidecarPublicationStarted = true;
    atomicReplaceExact(certificatePath, encodeCanonicalJson(merged), generatedDirectory);
    const after = readArtifactPair(input.repositoryRoot, input.artifact);
    await input.assertEpoch();
    if (
      after.artifactDigest !== before.artifactDigest
      || computeCertificateBaseDigest(after.certificate) !== beforeBaseDigest
    ) {
      throw new Error(`${input.artifact} changed while attestations were merged`);
    }
    if (after.certificateDigest !== computeCertificateDigest(merged)) {
      throw new Error(`${input.artifact} merged certificate digest mismatch`);
    }
    return after;
  } catch (error) {
    if (sidecarPublicationStarted) invalidateCertificate(certificatePath, generatedDirectory);
    throw error;
  }
}

export async function mergeArtifactAttestations(
  input: AttestationPublicationInput,
): Promise<ObservedArtifactPair> {
  return publishArtifactAttestations(input, true);
}

/** Seal finalization replaces provisional/superseded evidence with one exact verified producer set. */
export async function replaceArtifactAttestations(
  input: AttestationPublicationInput,
): Promise<ObservedArtifactPair> {
  return publishArtifactAttestations(input, false);
}
