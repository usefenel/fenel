/**
 * Shared raw-Git reconstruction for canonical compiled-artifact check packages.
 *
 * This file is deliberately an IO leaf. It selects no registry, shard, function,
 * or product semantics; the shared protocol helpers own every package identity.
 */

import { randomBytes } from "node:crypto";
import { spawnSync } from "node:child_process";
import {
  closeSync,
  existsSync,
  fsyncSync,
  lstatSync,
  mkdirSync,
  openSync,
  readFileSync,
  readdirSync,
  renameSync,
  rmSync,
  writeSync,
} from "node:fs";
import { dirname, isAbsolute, relative, resolve, sep } from "node:path";
import {
  REPOSITORY_EXACT_FILES,
  REPOSITORY_RECURSIVE_ROOTS,
  RECOVERABLE_OUTPUT_EXCLUSIONS,
  computeOwnerEpoch,
  digestByteManifest,
  repositoryRelativePath,
  sha256Raw,
  type ByteManifest,
  type ByteManifestRow,
  type RepositoryRelativePath,
  type Sha256Hex as ArtifactSha256Hex,
} from "./artifact-bytes";
import { compareUtf8, encodeCanonicalJson } from "./artifact-wire-json";
import {
  compiledArtifactRecoveryStubs,
  RECOVERY_STUB_VERSION,
  assertExactLfArtifact,
} from "./compiled-artifact-certificate";
import {
  buildCheckPackageNamespace,
  computeCheckPackageDigest,
  validateCheckPackageMetadata,
  type CheckPackageFileRow,
  type CompiledArtifactCheckPackageMetadata,
} from "./compiled-artifact-check-package";
import { proveEmptyCompiledArtifactDependencies } from "./compiled-artifact-dependencies";
import {
  COMPILED_ARTIFACT_SPECS,
  OWNER_PROTOCOL,
  PORTABLE_GENERATION_ABI,
  parseBuildCertificate,
  type CompiledArtifactId,
  type Sha256Hex,
} from "./compiled-artifact-protocol";
import { compiledArtifactSnapshotBootstrap } from "./compiled-artifact-snapshot";
import {
  ATTESTATION_POLICY_PATHS,
  computeAttestationPolicyDigestFromBytes,
  ownerOverlaySources,
  validateCompiledArtifactSourceCensus,
} from "./compiled-artifact-source-census";
import { decodeArtifactToolchainManifest } from "./compiled-artifact-toolchain";

const TOOLCHAIN_MANIFEST_PATH = repositoryRelativePath(
  ".github/fenel-artifact-toolchains.json",
);
const ENGINE_PACKAGE_PATH = repositoryRelativePath(
  "implementations/typescript/engine/package.json",
);
const BUN_LOCK_PATH = repositoryRelativePath("bun.lock");
const DEPENDENCY_MANIFEST_PATH = repositoryRelativePath(".m3b/dependencies.json");
const PORTABILITY_WORKFLOW_PATH = repositoryRelativePath(
  ".github/workflows/compiled-artifact-portability.yml",
);
const METADATA_PATH = "metadata.json" as const;
const MAX_GIT_OUTPUT_BYTES = 256 * 1024 * 1024;
const GIT_OID = /^[0-9a-f]{40}$/u;

type GitTreeEntry = {
  readonly mode: "100644" | "100755";
  readonly oid: string;
  readonly path: RepositoryRelativePath;
};

type IndexEntry = {
  readonly mode: string;
  readonly oid: string;
  readonly stage: number;
  readonly path: RepositoryRelativePath;
};

export type PrepareCompiledArtifactCheckPackageInput = {
  readonly repositoryRoot: string;
  readonly sourceCommit: string;
  readonly artifact: CompiledArtifactId;
  readonly output: string;
  /** Finalizers can reconstruct/verify identities without materializing a second package. */
  readonly materialize?: boolean;
};

export type PreparedCompiledArtifactCheckPackage = {
  readonly output: string;
  readonly metadata: CompiledArtifactCheckPackageMetadata;
  readonly metadataBytes: Uint8Array;
  readonly packageDigest: Sha256Hex;
};

function git(
  repositoryRoot: string,
  args: readonly string[],
  input?: Uint8Array,
): Buffer {
  const result = spawnSync("git", ["-C", repositoryRoot, ...args], {
    ...(input === undefined ? {} : { input: Buffer.from(input) }),
    encoding: "buffer",
    maxBuffer: MAX_GIT_OUTPUT_BYTES,
    windowsHide: true,
  });
  if (result.error !== undefined) throw result.error;
  if (result.status !== 0) {
    const detail = Buffer.from(result.stderr ?? []).toString("utf8").trim();
    throw new Error(`git ${args[0] ?? "command"} failed${detail === "" ? "" : `: ${detail}`}`);
  }
  return Buffer.from(result.stdout ?? []);
}

function decodeUtf8(bytes: Uint8Array, context: string): string {
  try {
    return new TextDecoder("utf-8", { fatal: true }).decode(bytes);
  } catch (error) {
    throw new Error(`${context} is not UTF-8`, { cause: error });
  }
}

function nulRecords(bytes: Uint8Array, context: string): readonly Uint8Array[] {
  if (bytes.byteLength === 0) return Object.freeze([]);
  if (bytes[bytes.byteLength - 1] !== 0) throw new Error(`${context} is not NUL terminated`);
  const records: Uint8Array[] = [];
  let start = 0;
  for (let index = 0; index < bytes.byteLength; index += 1) {
    if (bytes[index] !== 0) continue;
    if (index === start) throw new Error(`${context} contains an empty record`);
    records.push(bytes.slice(start, index));
    start = index + 1;
  }
  return Object.freeze(records);
}

function parseTree(
  repositoryRoot: string,
  sourceCommit: string,
  pathspecs: readonly string[],
): ReadonlyMap<string, GitTreeEntry> {
  const raw = git(repositoryRoot, [
    "ls-tree",
    "-r",
    "-z",
    "--full-tree",
    sourceCommit,
    "--",
    ...pathspecs,
  ]);
  const entries = new Map<string, GitTreeEntry>();
  const folded = new Map<string, string>();
  for (const record of nulRecords(raw, "git ls-tree output")) {
    const tab = record.indexOf(0x09);
    if (tab < 0) throw new Error("git ls-tree output lacks a path separator");
    const header = decodeUtf8(record.slice(0, tab), "git ls-tree header");
    const match = /^(\d{6}) (\S+) ([0-9a-f]{40})$/u.exec(header);
    if (match === null) throw new Error(`malformed git ls-tree header ${JSON.stringify(header)}`);
    const path = repositoryRelativePath(decodeUtf8(record.slice(tab + 1), "Git tree path"));
    if (match[2] !== "blob" || (match[1] !== "100644" && match[1] !== "100755")) {
      throw new Error(`Git tree path is not one regular file: ${path}`);
    }
    if (entries.has(path)) throw new Error(`duplicate Git tree path: ${path}`);
    const caseKey = path.normalize("NFC").toLowerCase();
    const prior = folded.get(caseKey);
    if (prior !== undefined && prior !== path) {
      throw new Error(`case-colliding Git tree paths: ${prior} and ${path}`);
    }
    entries.set(path, { mode: match[1], oid: match[3]!, path });
    folded.set(caseKey, path);
  }
  return entries;
}

function parseIndex(repositoryRoot: string, pathspecs: readonly string[]): readonly IndexEntry[] {
  const raw = git(repositoryRoot, ["ls-files", "--stage", "-z", "--", ...pathspecs]);
  return Object.freeze(nulRecords(raw, "git ls-files --stage output").map((record) => {
    const tab = record.indexOf(0x09);
    if (tab < 0) throw new Error("git index output lacks a path separator");
    const header = decodeUtf8(record.slice(0, tab), "git index header");
    const match = /^(\d{6}) ([0-9a-f]{40}) ([0-3])$/u.exec(header);
    if (match === null) throw new Error(`malformed git index header ${JSON.stringify(header)}`);
    return {
      mode: match[1]!,
      oid: match[2]!,
      stage: Number(match[3]),
      path: repositoryRelativePath(decodeUtf8(record.slice(tab + 1), "Git index path")),
    };
  }));
}

function readBlobs(
  repositoryRoot: string,
  oids: readonly string[],
): ReadonlyMap<string, Uint8Array> {
  const unique = [...new Set(oids)].sort(compareUtf8);
  if (unique.length === 0) return new Map();
  for (const oid of unique) {
    if (!GIT_OID.test(oid)) throw new Error(`invalid Git object id ${JSON.stringify(oid)}`);
  }
  const input = new TextEncoder().encode(`${unique.join("\n")}\n`);
  const output = git(repositoryRoot, ["cat-file", "--batch"], input);
  const blobs = new Map<string, Uint8Array>();
  let offset = 0;
  for (const requested of unique) {
    const newline = output.indexOf(0x0a, offset);
    if (newline < 0) throw new Error(`git cat-file omitted header for ${requested}`);
    const header = decodeUtf8(output.subarray(offset, newline), "git cat-file header");
    const match = /^([0-9a-f]{40}) blob ([0-9]+)$/u.exec(header);
    if (match === null || match[1] !== requested) {
      throw new Error(`git cat-file returned unexpected object for ${requested}`);
    }
    const byteLength = Number(match[2]);
    if (!Number.isSafeInteger(byteLength) || byteLength < 0) {
      throw new Error(`git cat-file returned unsafe size for ${requested}`);
    }
    const start = newline + 1;
    const end = start + byteLength;
    if (end >= output.byteLength || output[end] !== 0x0a) {
      throw new Error(`git cat-file returned truncated bytes for ${requested}`);
    }
    blobs.set(requested, new Uint8Array(output.slice(start, end)));
    offset = end + 1;
  }
  if (offset !== output.byteLength) throw new Error("git cat-file returned trailing output");
  return blobs;
}

function pathWithin(path: string, root: string): boolean {
  return path === root || path.startsWith(`${root}/`);
}

function commonRepositoryPath(path: string): boolean {
  const excluded = RECOVERABLE_OUTPUT_EXCLUSIONS.some((candidate) => candidate === path);
  if (excluded) return false;
  return REPOSITORY_EXACT_FILES.some((candidate) => candidate === path)
    || REPOSITORY_RECURSIVE_ROOTS.some((root) => pathWithin(path, root));
}

function requiredTreeEntry(
  tree: ReadonlyMap<string, GitTreeEntry>,
  path: RepositoryRelativePath,
): GitTreeEntry {
  const entry = tree.get(path);
  if (entry === undefined) throw new Error(`source commit lacks required file ${path}`);
  return entry;
}

function manifestFromEntries(
  domain: string,
  entries: readonly GitTreeEntry[],
  blobs: ReadonlyMap<string, Uint8Array>,
): ByteManifest {
  const rows: ByteManifestRow[] = entries.map((entry) => {
    const bytes = blobs.get(entry.oid);
    if (bytes === undefined) throw new Error(`missing raw Git blob ${entry.oid} for ${entry.path}`);
    return {
      path: entry.path,
      kind: "regular-file",
      byteLength: bytes.byteLength,
      sha256: sha256Raw(bytes),
    };
  });
  return digestByteManifest(domain, rows);
}

function pathspecsForCandidate(
  exactPaths: ReadonlySet<string>,
): readonly string[] {
  return Object.freeze([
    ...REPOSITORY_RECURSIVE_ROOTS,
    ...exactPaths,
  ].map((path) => `:(literal)${path}`).sort(compareUtf8));
}

function diffPathspecsForCandidate(
  exactPaths: ReadonlySet<string>,
): readonly string[] {
  // `git ls-tree` rejects exclude magic, while the broad diff roots need it so
  // a sidecar-only seal commit remains outside the candidate input universe.
  const excludedOutputs = RECOVERABLE_OUTPUT_EXCLUSIONS
    .filter((path) => !exactPaths.has(path))
    .map((path) => `:(exclude,literal)${path}`);
  return Object.freeze([...pathspecsForCandidate(exactPaths), ...excludedOutputs].sort(compareUtf8));
}

function assertOutputOutsideCandidateInputs(
  repositoryRoot: string,
  output: string,
  exactPaths: ReadonlySet<string>,
): void {
  const back = relative(repositoryRoot, output).replaceAll("\\", "/");
  if (back === "" || back === ".") throw new Error("check-package output cannot be the repository root");
  if (isAbsolute(back) || back === ".." || back.startsWith("../")) return;
  const path = String(repositoryRelativePath(back));
  if (
    pathWithin(path, ".git")
    || pathWithin(".git", path)
    || commonRepositoryPath(path)
    || [...exactPaths].some((exact) => pathWithin(path, exact) || pathWithin(exact, path))
  ) {
    throw new Error(`check-package output intersects candidate inputs: ${path}`);
  }
}

function verifyDiffIsEmpty(
  repositoryRoot: string,
  sourceCommit: string,
  cached: boolean,
  pathspecs: readonly string[],
): void {
  const args = [
    "diff",
    "--quiet",
    "--no-ext-diff",
    "--ignore-submodules=none",
    ...(cached ? ["--cached"] : []),
    sourceCommit,
    "--",
    ...pathspecs,
  ];
  const result = spawnSync("git", ["-C", repositoryRoot, ...args], {
    encoding: "buffer",
    maxBuffer: MAX_GIT_OUTPUT_BYTES,
    windowsHide: true,
  });
  if (result.error !== undefined) throw result.error;
  if (result.status === 1) {
    throw new Error(`covered ${cached ? "index" : "working-tree"} state differs from source commit`);
  }
  if (result.status !== 0) {
    const detail = Buffer.from(result.stderr ?? []).toString("utf8").trim();
    throw new Error(`git diff failed${detail === "" ? "" : `: ${detail}`}`);
  }
}

function verifyCleanCandidate(input: {
  readonly repositoryRoot: string;
  readonly sourceCommit: string;
  readonly targetEntries: readonly GitTreeEntry[];
  readonly exactPaths: ReadonlySet<string>;
  readonly targetBlobs: ReadonlyMap<string, Uint8Array>;
}): void {
  const pathspecs = pathspecsForCandidate(input.exactPaths);
  const relevant = (path: string): boolean => commonRepositoryPath(path) || input.exactPaths.has(path);
  const indexRows = parseIndex(input.repositoryRoot, pathspecs).filter((row) => relevant(row.path));
  const indexByPath = new Map<string, IndexEntry[]>();
  for (const row of indexRows) {
    const rows = indexByPath.get(row.path) ?? [];
    rows.push(row);
    indexByPath.set(row.path, rows);
  }
  const targetPaths = new Set(input.targetEntries.map((entry) => String(entry.path)));
  for (const path of indexByPath.keys()) {
    if (!targetPaths.has(path)) throw new Error(`covered index has an extra path: ${path}`);
  }

  const indexBlobs = readBlobs(input.repositoryRoot, indexRows.map((row) => row.oid));
  for (const target of input.targetEntries) {
    const rows = indexByPath.get(target.path) ?? [];
    if (rows.length !== 1 || rows[0]!.stage !== 0) {
      throw new Error(`covered index lacks one stage-zero row for ${target.path}`);
    }
    const indexed = rows[0]!;
    const targetBytes = input.targetBlobs.get(target.oid)!;
    const indexBytes = indexBlobs.get(indexed.oid);
    if (
      indexed.mode !== target.mode
      || indexBytes === undefined
      || !Buffer.from(indexBytes).equals(Buffer.from(targetBytes))
    ) {
      throw new Error(`covered index bytes or kind differ from source commit: ${target.path}`);
    }

    const absolute = resolve(input.repositoryRoot, ...target.path.split("/"));
    let stat;
    try {
      stat = lstatSync(absolute);
    } catch (error) {
      throw new Error(`covered working-tree file is absent: ${target.path}`, { cause: error });
    }
    if (!stat.isFile() || stat.isSymbolicLink()) {
      throw new Error(`covered working-tree path is not one regular file: ${target.path}`);
    }
    const workingBytes = readFileSync(absolute);
    if (!workingBytes.equals(Buffer.from(targetBytes))) {
      throw new Error(`covered working-tree raw bytes differ from source commit: ${target.path}`);
    }
  }

  const untracked = nulRecords(
    git(input.repositoryRoot, ["ls-files", "--others", "-z", "--", ...pathspecs]),
    "git untracked output",
  ).map((record) => repositoryRelativePath(decodeUtf8(record, "untracked Git path")));
  const coveredUntracked = untracked.find((path) => relevant(path));
  if (coveredUntracked !== undefined) {
    throw new Error(`covered working tree has an untracked path: ${coveredUntracked}`);
  }

  // The cached comparison supplements the exact raw index/blob checks with Git's
  // mode handling. Do not ask Git to re-decide working-tree cleanliness here:
  // stale Windows index stat data can report a false diff, while every covered
  // regular-file kind and raw working byte was already compared above.
  const diffPathspecs = diffPathspecsForCandidate(input.exactPaths);
  verifyDiffIsEmpty(input.repositoryRoot, input.sourceCommit, true, diffPathspecs);
}

function fileRow(path: string, bytes: Uint8Array): CheckPackageFileRow {
  return Object.freeze({
    path,
    kind: "file" as const,
    byteLength: bytes.byteLength,
    digest: sha256Raw(bytes),
  });
}

function addNamespaceFile(
  files: Map<string, Uint8Array>,
  path: string,
  bytes: Uint8Array,
): void {
  const canonical = String(repositoryRelativePath(path));
  if (files.has(canonical)) throw new Error(`check-package source row is duplicated: ${canonical}`);
  files.set(canonical, new Uint8Array(bytes));
}

function writeAll(fd: number, bytes: Uint8Array): void {
  let offset = 0;
  while (offset < bytes.byteLength) {
    const written = writeSync(fd, bytes, offset, bytes.byteLength - offset);
    if (written <= 0) throw new Error("short check-package write");
    offset += written;
  }
}

function packageTarget(root: string, namespace: string, path: string): string {
  const namespaceRoot = resolve(root, namespace);
  const target = resolve(namespaceRoot, ...path.split("/"));
  const back = relative(namespaceRoot, target);
  if (back === "" || back === "." || isAbsolute(back) || back === ".." || back.startsWith(`..${sep}`)) {
    throw new Error(`check-package path escapes ${namespace}/: ${path}`);
  }
  return target;
}

function writeExclusive(path: string, bytes: Uint8Array): void {
  mkdirSync(dirname(path), { recursive: true, mode: 0o700 });
  const fd = openSync(path, "wx", 0o600);
  try {
    writeAll(fd, bytes);
    fsyncSync(fd);
  } finally {
    closeSync(fd);
  }
}

function walkPlainFiles(root: string, relativeRoot = ""): readonly string[] {
  const absolute = relativeRoot === "" ? root : resolve(root, ...relativeRoot.split("/"));
  const rows: string[] = [];
  for (const entry of readdirSync(absolute, { withFileTypes: true })) {
    const path = relativeRoot === "" ? entry.name : `${relativeRoot}/${entry.name}`;
    if (entry.isSymbolicLink()) throw new Error(`check package contains a link: ${path}`);
    if (entry.isDirectory()) rows.push(...walkPlainFiles(root, path));
    else if (entry.isFile()) rows.push(String(repositoryRelativePath(path)));
    else throw new Error(`check package contains a non-file entry: ${path}`);
  }
  return Object.freeze(rows.sort(compareUtf8));
}

function materializePackage(input: {
  readonly output: string;
  readonly metadataBytes: Uint8Array;
  readonly source: ReadonlyMap<string, Uint8Array>;
  readonly candidate: ReadonlyMap<string, Uint8Array>;
  readonly environment: ReadonlyMap<string, Uint8Array>;
}): void {
  const output = resolve(input.output);
  if (existsSync(output)) throw new Error(`check-package output already exists: ${output}`);
  const parent = dirname(output);
  mkdirSync(parent, { recursive: true, mode: 0o700 });
  const stage = resolve(parent, `.${output.split(/[\\/]/u).at(-1)!}.m3b-${process.pid}-${randomBytes(12).toString("hex")}`);
  if (existsSync(stage)) throw new Error(`check-package stage unexpectedly exists: ${stage}`);
  mkdirSync(stage, { recursive: false, mode: 0o700 });
  let owned = true;
  try {
    const expected = new Map<string, Uint8Array>();
    expected.set(METADATA_PATH, input.metadataBytes);
    for (const [namespace, files] of [
      ["source", input.source],
      ["candidate", input.candidate],
      ["environment", input.environment],
    ] as const) {
      for (const [path, bytes] of files) expected.set(`${namespace}/${path}`, bytes);
    }
    for (const [path, bytes] of expected) {
      const target = path === METADATA_PATH
        ? resolve(stage, METADATA_PATH)
        : packageTarget(stage, path.slice(0, path.indexOf("/")), path.slice(path.indexOf("/") + 1));
      writeExclusive(target, bytes);
    }
    const observedPaths = walkPlainFiles(stage);
    const expectedPaths = [...expected.keys()].sort(compareUtf8);
    if (observedPaths.join("\0") !== expectedPaths.join("\0")) {
      throw new Error("materialized check-package paths differ from the canonical manifest");
    }
    for (const [path, bytes] of expected) {
      const observed = readFileSync(resolve(stage, ...path.split("/")));
      if (!observed.equals(Buffer.from(bytes))) {
        throw new Error(`materialized check-package bytes differ: ${path}`);
      }
    }
    renameSync(stage, output);
    owned = false;
  } finally {
    if (owned && existsSync(stage)) rmSync(stage, { recursive: true, force: false });
  }
}

function gitObjectPolicyDigest(
  paths: readonly string[],
  tree: ReadonlyMap<string, GitTreeEntry>,
  blobs: ReadonlyMap<string, Uint8Array>,
): Sha256Hex {
  const bytesByPath = new Map<string, Uint8Array>();
  for (const rawPath of paths) {
    const path = repositoryRelativePath(rawPath);
    const entry = requiredTreeEntry(tree, path);
    bytesByPath.set(path, blobs.get(entry.oid)!);
  }
  const digest = computeAttestationPolicyDigestFromBytes({
    has: (path) => bytesByPath.has(path),
    read: (path) => {
      const bytes = bytesByPath.get(path);
      if (bytes === undefined) throw new Error(`missing raw policy blob ${path}`);
      return new Uint8Array(bytes);
    },
  });
  if (!digest.ok) throw new Error(`Git-object attestation policy is uncomputable: ${digest.error}`);
  return digest.digest;
}

export function prepareCompiledArtifactCheckPackage(
  input: PrepareCompiledArtifactCheckPackageInput,
): PreparedCompiledArtifactCheckPackage {
  const repositoryRoot = resolve(input.repositoryRoot);
  if (!GIT_OID.test(input.sourceCommit)) {
    throw new TypeError("--source-commit must be one exact lowercase 40-hex commit id");
  }
  if (input.artifact !== "compiled-parser" && input.artifact !== "compiled-resolver") {
    throw new TypeError("--artifact must be compiled-parser or compiled-resolver");
  }
  const verifiedCommit = decodeUtf8(
    git(repositoryRoot, ["rev-parse", "--verify", `${input.sourceCommit}^{commit}`]),
    "verified source commit",
  ).trim();
  if (verifiedCommit !== input.sourceCommit) {
    throw new Error("source commit did not resolve to the exact requested commit object");
  }

  validateCompiledArtifactSourceCensus(repositoryRoot);
  const artifactPath = repositoryRelativePath(COMPILED_ARTIFACT_SPECS[input.artifact].artifactPath);
  const certificatePath = repositoryRelativePath(COMPILED_ARTIFACT_SPECS[input.artifact].certificatePath);
  const ownerPaths = ownerOverlaySources(input.artifact).map(repositoryRelativePath);
  const policyPaths = ATTESTATION_POLICY_PATHS.map(repositoryRelativePath);
  const exactPaths = new Set<string>([
    ...REPOSITORY_EXACT_FILES,
    ...ownerPaths,
    ...policyPaths,
    TOOLCHAIN_MANIFEST_PATH,
    artifactPath,
  ]);
  const output = resolve(repositoryRoot, input.output);
  assertOutputOutsideCandidateInputs(repositoryRoot, output, exactPaths);
  const tree = parseTree(
    repositoryRoot,
    input.sourceCommit,
    pathspecsForCandidate(exactPaths),
  );

  const repositoryEntries = [...tree.values()]
    .filter((entry) => commonRepositoryPath(entry.path))
    .sort((left, right) => compareUtf8(left.path, right.path));
  for (const path of REPOSITORY_EXACT_FILES) requiredTreeEntry(tree, path);
  const repositoryPathSet = new Set(repositoryEntries.map((entry) => String(entry.path)));
  const ownerEntries = ownerPaths
    .filter((path) => !repositoryPathSet.has(path))
    .map((path) => requiredTreeEntry(tree, path));
  const exactEntries = [...exactPaths].map((path) => requiredTreeEntry(tree, repositoryRelativePath(path)));
  const targetEntries = [...new Map(
    [...repositoryEntries, ...exactEntries].map((entry) => [entry.path, entry]),
  ).values()].sort((left, right) => compareUtf8(left.path, right.path));
  const certificateEntry = requiredTreeEntry(tree, certificatePath);
  if (certificateEntry.mode !== "100644" && certificateEntry.mode !== "100755") throw new Error("producer certificate Git object is not a regular file");
  // Read the original producer base from this exact commit. The sidecar is
  // still a recoverable output, excluded from source epochs and clean-input
  // comparisons; adding producer attestations must not rewrite source inputs.
  const targetBlobs = readBlobs(repositoryRoot, [...targetEntries.map((entry) => entry.oid), certificateEntry.oid]);
  const producerCertificate = parseBuildCertificate(targetBlobs.get(certificateEntry.oid)!);

  verifyCleanCandidate({
    repositoryRoot,
    sourceCommit: input.sourceCommit,
    targetEntries,
    exactPaths,
    targetBlobs,
  });

  const repositoryManifest = manifestFromEntries("repository", repositoryEntries, targetBlobs);
  const ownerManifest = manifestFromEntries(
    `owner-overlay:${input.artifact}`,
    ownerEntries,
    targetBlobs,
  );
  const enginePackageBytes = targetBlobs.get(requiredTreeEntry(tree, ENGINE_PACKAGE_PATH).oid)!;
  const bunLockBytes = targetBlobs.get(requiredTreeEntry(tree, BUN_LOCK_PATH).oid)!;
  const dependency = proveEmptyCompiledArtifactDependencies({
    packageJsonBytes: enginePackageBytes,
    bunLockBytes,
  });
  const dependencyDigest = dependency.dependencyDigest as Sha256Hex;
  const dependencyManifestBytes = new TextEncoder().encode(dependency.canonicalManifest);
  const ownerEpoch = computeOwnerEpoch({
    artifact: input.artifact,
    repositoryEpoch: repositoryManifest.digest,
    ownerOverlayDigest: ownerManifest.digest,
    dependencyDigest: dependencyDigest as ArtifactSha256Hex,
    protocolVersion: OWNER_PROTOCOL,
    recoveryStubVersion: RECOVERY_STUB_VERSION,
    portableGenerationAbi: PORTABLE_GENERATION_ABI,
  });
  const attestationPolicyDigest = gitObjectPolicyDigest(policyPaths, tree, targetBlobs);
  const workflowDigest = sha256Raw(
    targetBlobs.get(requiredTreeEntry(tree, PORTABILITY_WORKFLOW_PATH).oid)!,
  ) as Sha256Hex;

  const source = new Map<string, Uint8Array>();
  for (const entry of [...repositoryEntries, ...ownerEntries]) {
    addNamespaceFile(source, entry.path, targetBlobs.get(entry.oid)!);
  }
  for (const stub of compiledArtifactRecoveryStubs()) {
    addNamespaceFile(source, stub.path, stub.bytes);
  }
  const bootstrap = compiledArtifactSnapshotBootstrap({ artifact: input.artifact });
  addNamespaceFile(source, bootstrap.path, bootstrap.bytes);
  addNamespaceFile(source, DEPENDENCY_MANIFEST_PATH, dependencyManifestBytes);

  const candidateBytes = targetBlobs.get(requiredTreeEntry(tree, artifactPath).oid)!;
  assertExactLfArtifact(candidateBytes);
  const candidate = new Map<string, Uint8Array>([[artifactPath, candidateBytes]]);
  const toolchainBytes = targetBlobs.get(requiredTreeEntry(tree, TOOLCHAIN_MANIFEST_PATH).oid)!;
  decodeArtifactToolchainManifest(toolchainBytes);
  const environment = new Map<string, Uint8Array>([[TOOLCHAIN_MANIFEST_PATH, toolchainBytes]]);
  const sourceRows = [...source].map(([path, bytes]) => fileRow(path, bytes)).sort((left, right) =>
    compareUtf8(left.path, right.path)
  );
  const candidateRows = [...candidate].map(([path, bytes]) => fileRow(path, bytes));
  const environmentRows = [...environment].map(([path, bytes]) => fileRow(path, bytes));
  const metadata = validateCheckPackageMetadata({
    schema: "fenel.compiled-artifact-check-package.v2",
    artifact: input.artifact,
    artifactPath,
    portableGenerationAbi: PORTABLE_GENERATION_ABI,
    sourceProvenance: {
      kind: "git-object",
      sourceCommit: input.sourceCommit,
      workflowDigest,
    },
    repositoryEpoch: repositoryManifest.digest,
    ownerEpoch,
    dependencyDigest,
    attestationPolicyDigest,
    producerInput: producerCertificate.producerInput,
    namespaces: {
      source: buildCheckPackageNamespace("source", sourceRows),
      candidate: buildCheckPackageNamespace("candidate", candidateRows),
      environment: buildCheckPackageNamespace("environment", environmentRows),
    },
  });
  if (producerCertificate.artifact !== input.artifact
    || producerCertificate.repositoryEpoch !== metadata.repositoryEpoch
    || producerCertificate.ownerEpoch !== metadata.ownerEpoch
    || producerCertificate.inputManifest.coveredSourceArchiveDigest !== metadata.namespaces.source.digest
    || producerCertificate.artifactDigest !== sha256Raw(candidateBytes)
    || producerCertificate.artifactByteLength !== candidateBytes.byteLength
    || producerCertificate.producerCheckPackageDigest !== computeCheckPackageDigest({
      ...metadata, sourceProvenance: { kind: "stable-live" },
    })) {
    throw new Error("portable package requires the actual producer capture; create a full current baseline before sealing retained inputs");
  }
  const metadataBytes = encodeCanonicalJson(metadata);
  if (input.materialize !== false) {
    materializePackage({ output, metadataBytes, source, candidate, environment });
  }
  return Object.freeze({
    output,
    metadata,
    metadataBytes,
    packageDigest: computeCheckPackageDigest(metadata),
  });
}
