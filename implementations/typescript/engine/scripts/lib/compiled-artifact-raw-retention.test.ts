/** Controller scheduling/provenance controls, not a canonical-owner proof.
 * A real SMALL closed import graph supplies byte/negative-acquisition controls.
 * capturedEvidence/acquiredEnvironment replace the expensive owner acquisition;
 * render/independentCheck never execute an engine, registry or snapshot worker.
 * Real canonical-owner acquisition and guarded rendering remain integration gates.
 * Existing owner/protocol fixture tests still need mechanical v3/v2 repins.
 */
import { afterEach, expect, test } from "bun:test";
import { appendFileSync, copyFileSync, existsSync, lstatSync, mkdirSync, mkdtempSync,
  readFileSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { dirname, isAbsolute, join, relative, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";
import { REPOSITORY_EXACT_FILES, computeOwnerEpoch, digestByteManifest, parseSha256Hex, repositoryRelativePath,
  sha256Raw, type ByteManifestRow, type CapturedByteStore, type RepositoryRelativePath } from "./artifact-bytes";
import { compareUtf8, encodeCanonicalJson } from "./artifact-wire-json";
import { CompiledArtifactAcquisitionError, closeCompiledArtifactAcquisition } from "./compiled-artifact-acquisition";
import { canonicalizeProducerAttestations, computeEnvironmentFingerprint, validateArtifactEnvironmentEvidence,
  validateCompiledArtifactCheckAttestation, type ArtifactEnvironmentEvidence, type ArtifactOsFamily,
  type AttestationOrigin, type CompiledArtifactCheckAttestation } from "./compiled-artifact-attestation";
import { RECOVERY_STUB_VERSION, compiledArtifactRecoveryStubs, readArtifactPair, sha256Bytes } from "./compiled-artifact-certificate";
import { CHECK_PACKAGE_SCHEMA, buildCheckPackageNamespace, computeCheckPackageDigest,
  type CheckPackageFileRow, type CompiledArtifactCheckPackageMetadata } from "./compiled-artifact-check-package";
import { proveEmptyCompiledArtifactDependencies } from "./compiled-artifact-dependencies";
import { COMPILED_ARTIFACT_ENVIRONMENT_VARIABLES, type AcquiredCompiledArtifactEnvironment } from "./compiled-artifact-environment";
import { makeRawCompiledArtifactInput } from "./compiled-artifact-input-key";
import { checkCompiledArtifactOwner, probeCompiledArtifactOwner, repairCompiledArtifactOwner,
  type OwnerEvidence, type OwnerRuntimeDependencies } from "./compiled-artifact-owner";
import { COMPILED_ARTIFACT_SPECS, OWNER_PROTOCOL, PORTABLE_GENERATION_ABI,
  computeCertificateBaseDigest, type ArtifactFreshnessRecord, type CompiledArtifactBuildCertificate } from "./compiled-artifact-protocol";
import { compiledArtifactSnapshotBootstrap } from "./compiled-artifact-snapshot";
import { compiledArtifactSourceCensus, computeAttestationPolicyDigest, ownerOverlaySources } from "./compiled-artifact-source-census";
import { bunToolchainRowDigest, decodeArtifactToolchainManifest, selectBunToolchain } from "./compiled-artifact-toolchain";

const here = fileURLToPath(import.meta.url);
const draftMarker = `${sep}.tmp-diag${sep}targeted-owner-draft${sep}`;
const markerIndex = here.indexOf(draftMarker);
const REPOSITORY_ROOT = markerIndex >= 0 ? here.slice(0, markerIndex) : resolve(dirname(here), "../../../../..");
const DRAFT_ROOT = resolve(REPOSITORY_ROOT, ".tmp-diag/targeted-owner-draft");
const TEST_RELATIVE_PATH = "implementations/typescript/engine/scripts/lib/compiled-artifact-raw-retention.test.ts";
const ASSEMBLED_ROOT = resolve(DRAFT_ROOT, "assembled");
const ASSEMBLED_COPIES_ROOT = resolve(ASSEMBLED_ROOT, "copies");
const executionMode = relative(ASSEMBLED_COPIES_ROOT, here).split(sep).join("/") === TEST_RELATIVE_PATH ? "assembled"
  : relative(REPOSITORY_ROOT, here).split(sep).join("/") === TEST_RELATIVE_PATH ? "production" : "draft";
const ARTIFACT = "compiled-parser" as const;
const SPEC = COMPILED_ARTIFACT_SPECS[ARTIFACT];
const TOOLCHAIN_PATH = ".github/fenel-artifact-toolchains.json";
const WORKFLOW_PATH = ".github/workflows/compiled-artifact-portability.yml";
const ENTRY = "implementations/typescript/engine/src/retention-producer-fixture.ts";
const DEPENDENCY = "implementations/typescript/engine/src/retention-dependency-fixture.ts";
const UNRELATED = "implementations/typescript/engine/src/retention-unrelated.test.ts";
const UTF8 = new TextEncoder();
const temporaryRoots: string[] = [];

function strictlyWithin(root: string, target: string): boolean {
  const back = relative(root, target);
  return back !== "" && back !== ".." && !back.startsWith(`..${sep}`) && !isAbsolute(back);
}
function assertPlainDirectory(path: string): void {
  const stat = lstatSync(path);
  if (stat.isSymbolicLink() || !stat.isDirectory()) throw new Error(`fixture ancestor is not a plain directory: ${path}`);
}
function realDraftRoot(): string {
  // Check each lexical ancestor BEFORE resolving it, so a pre-existing junction
  // cannot cause reads/writes through a link into canonical source or host paths.
  assertPlainDirectory(REPOSITORY_ROOT);
  const realRepository = realpathSync(REPOSITORY_ROOT);
  let path = REPOSITORY_ROOT;
  for (const segment of [".tmp-diag", "targeted-owner-draft"]) {
    path = resolve(path, segment); assertPlainDirectory(path);
    if (!strictlyWithin(realRepository, realpathSync(path))) throw new Error("draft ancestor escaped the real repository root");
  }
  return realpathSync(DRAFT_ROOT);
}
function assertOwnedFixture(root: string, allowMissingTail = false): void {
  const absolute = resolve(root);
  const back = relative(DRAFT_ROOT, absolute);
  if (back === "" || back === ".." || back.startsWith(`..${sep}`) || isAbsolute(back)) {
    throw new Error("fixture path escaped the exact draft root");
  }
  const realDraft = realDraftRoot();
  let path = DRAFT_ROOT;
  for (const segment of back.split(sep)) {
    path = resolve(path, segment);
    try { assertPlainDirectory(path); }
    catch (error) {
      if (allowMissingTail && (error as NodeJS.ErrnoException).code === "ENOENT") return;
      throw error;
    }
    if (!strictlyWithin(realDraft, realpathSync(path))) throw new Error("fixture ancestor escaped the exact real draft root");
  }
}
function assertOwnedFile(root: string, target: string, allowMissing = false): void {
  assertOwnedFixture(root); assertOwnedFixture(dirname(target));
  if (!strictlyWithin(root, target)) throw new Error("fixture file escaped its root");
  try {
    const stat = lstatSync(target);
    if (stat.isSymbolicLink() || !stat.isFile()) throw new Error("fixture file is not one plain file");
  } catch (error) {
    if (allowMissing && (error as NodeJS.ErrnoException).code === "ENOENT") return;
    throw error;
  }
  if (!strictlyWithin(realDraftRoot(), realpathSync(target))) throw new Error("fixture file escaped the exact real draft root");
}
function assertPlainRepositoryFile(target: string): void {
  if (!strictlyWithin(REPOSITORY_ROOT, target)) throw new Error("source copy escaped the repository");
  assertPlainDirectory(REPOSITORY_ROOT);
  const realRepository = realpathSync(REPOSITORY_ROOT);
  let path = REPOSITORY_ROOT;
  const segments = relative(REPOSITORY_ROOT, target).split(sep);
  for (const segment of segments.slice(0, -1)) {
    path = resolve(path, segment); assertPlainDirectory(path);
    if (!strictlyWithin(realRepository, realpathSync(path))) throw new Error("source ancestor escaped the real repository");
  }
  const stat = lstatSync(target);
  if (stat.isSymbolicLink() || !stat.isFile() || !strictlyWithin(realRepository, realpathSync(target))) {
    throw new Error("source copy is not a plain file inside the real repository");
  }
}
afterEach(() => {
  for (const root of temporaryRoots.splice(0)) {
    assertOwnedFixture(root);
    rmSync(root, { recursive: true, force: true });
  }
});
function at(root: string, path: string): string { return resolve(root, ...path.split("/")); }
function write(root: string, path: string, bytes: string | Uint8Array): void {
  assertOwnedFixture(root);
  const target = at(root, path);
  const back = relative(root, target);
  if (back === ".." || back.startsWith(`..${sep}`) || isAbsolute(back)) throw new Error("fixture file escaped its root");
  assertOwnedFixture(dirname(target), true);
  mkdirSync(dirname(target), { recursive: true }); assertOwnedFile(root, target, true); writeFileSync(target, bytes);
}
function append(root: string, path: string, text: string): void {
  const target = at(root, path); assertOwnedFile(root, target); appendFileSync(target, text);
}
function sourceCopy(path: string): string {
  if (executionMode === "draft") throw new Error("assemble candidate first: this test cannot execute from a partial scratch layer");
  if (executionMode === "assembled") {
    const manifestPath = resolve(ASSEMBLED_ROOT, "manifest.json");
    assertOwnedFile(ASSEMBLED_ROOT, manifestPath);
    const manifest = JSON.parse(readFileSync(manifestPath, "utf8")) as { files?: Array<{ path: string; candidateSha256: string }> };
    if (!Array.isArray(manifest.files)) throw new Error("assembled candidate lacks its exact source roster");
    const rows = manifest.files.filter(row => row.path === path);
    if (rows.length > 1) throw new Error(`assembled source roster repeats ${path}`);
    if (rows.length === 1) {
      const candidate = at(ASSEMBLED_COPIES_ROOT, path);
      assertOwnedFile(ASSEMBLED_COPIES_ROOT, candidate);
      if (sha256Raw(readFileSync(candidate)) !== rows[0]!.candidateSha256) throw new Error(`assembled source differs from pinned roster: ${path}`);
      return candidate;
    }
  }
  // A landed production test reads production exclusively. Assembled mode may
  // use production only for unchanged non-roster support, never a legacy layer.
  const production = at(REPOSITORY_ROOT, path);
  assertPlainRepositoryFile(production);
  return production;
}
function fileRow(path: string, bytes: Uint8Array): CheckPackageFileRow {
  return { path, kind: "file", byteLength: bytes.byteLength, digest: sha256Bytes(bytes) };
}
function row(path: string, bytes: Uint8Array): ByteManifestRow {
  return { path: repositoryRelativePath(path), kind: "regular-file", byteLength: bytes.byteLength, sha256: sha256Raw(bytes) };
}
function store(input: ReadonlyMap<string, Uint8Array>): CapturedByteStore {
  const captured = new Map([...input].map(([path, bytes]) => [path, new Uint8Array(bytes)]));
  return Object.freeze({ paths: Object.freeze([...captured.keys()].sort(compareUtf8).map(repositoryRelativePath)),
    has: (path: RepositoryRelativePath) => captured.has(path),
    read(path: RepositoryRelativePath) {
      const bytes = captured.get(path); if (bytes === undefined) throw new Error(`fixture capture lacks ${path}`);
      return new Uint8Array(bytes);
    } });
}
function environmentFor(toolchainBytes: Uint8Array, osFamily: ArtifactOsFamily): ArtifactEnvironmentEvidence {
  const manifest = decodeArtifactToolchainManifest(toolchainBytes);
  const toolchain = selectBunToolchain(manifest, { osFamily, arch: "x64" });
  return validateArtifactEnvironmentEvidence({ osFamily, arch: "x64", bun: {
    release: toolchain.bunRelease, revision: toolchain.bunRevision, executableDigest: toolchain.binarySha256,
    webkitVersion: "WebKit-owner-fixture", javascriptCoreVersion: "JSC-owner-fixture", icuVersion: "73.2", unicodeVersion: "15.0",
    toolchainManifestDigest: manifest.manifestDigest, toolchainRowDigest: bunToolchainRowDigest(toolchain) },
    variables: COMPILED_ARTIFACT_ENVIRONMENT_VARIABLES });
}
type World = { root: string; artifactBytes: Uint8Array; toolchainBytes: Uint8Array; acquired: AcquiredCompiledArtifactEnvironment };
function world(): World {
  if (executionMode === "draft") throw new Error("assemble candidate first: this test cannot execute from a partial scratch layer");
  const parent = resolve(DRAFT_ROOT, "raw-retention-fixtures");
  assertOwnedFixture(parent, true); mkdirSync(parent, { recursive: true }); assertOwnedFixture(parent);
  const root = mkdtempSync(join(parent, "world-")); assertOwnedFixture(root); temporaryRoots.push(root);
  for (const item of compiledArtifactSourceCensus()) {
    const target = at(root, item.path); assertOwnedFixture(dirname(target), true);
    mkdirSync(dirname(target), { recursive: true }); assertOwnedFile(root, target, true);
    copyFileSync(sourceCopy(item.path), target);
  }
  for (const path of [...REPOSITORY_EXACT_FILES, TOOLCHAIN_PATH]) write(root, path, readFileSync(sourceCopy(path)));
  write(root, ENTRY, 'import { value } from "./retention-dependency-fixture";\nexport const answer = value;\n');
  write(root, DEPENDENCY, "export const value = 1;\n");
  write(root, UNRELATED, "// unrelated fixture test byte, never imported\n");
  const toolchainBytes = new Uint8Array(readFileSync(at(root, TOOLCHAIN_PATH)));
  const environment = environmentFor(toolchainBytes, "windows");
  const acquired = Object.freeze({ manifest: decodeArtifactToolchainManifest(toolchainBytes), bunExecutable: process.execPath,
    environment, environmentFingerprint: computeEnvironmentFingerprint(environment) });
  return { root, artifactBytes: UTF8.encode("// deterministic compiled owner fixture\n"), toolchainBytes, acquired };
}
function evidence(world: World): OwnerEvidence {
  const source = new Map<string, Uint8Array>();
  for (const path of [...REPOSITORY_EXACT_FILES, ENTRY, DEPENDENCY, UNRELATED, ...ownerOverlaySources(ARTIFACT)]) {
    if (existsSync(at(world.root, path))) source.set(path, new Uint8Array(readFileSync(at(world.root, path))));
  }
  const capturedBytes = store(source);
  // Exact tiny graph, recomputed from current fixture inventory. A failed close
  // throws before any raw key/evidence is returned; it cannot become FRESH.
  const acquisition = closeCompiledArtifactAcquisition({ entrypoints: [repositoryRelativePath(ENTRY)], bytes: capturedBytes,
    materializedFiles: [], declaredEnvironmentKeys: [] });
  const repositoryPaths = [...REPOSITORY_EXACT_FILES, ENTRY, DEPENDENCY, UNRELATED];
  const repositoryManifest = digestByteManifest("repository", repositoryPaths.filter(path => source.has(path))
    .map(path => row(path, source.get(path)!)));
  const ownerManifest = digestByteManifest(`owner-overlay:${ARTIFACT}`, ownerOverlaySources(ARTIFACT)
    .map(path => row(path, source.get(path)!)));
  const exact = digestByteManifest("compiled-owner-exact-inputs:v1", REPOSITORY_EXACT_FILES.map(path => row(path, source.get(path)!)));
  const dependency = proveEmptyCompiledArtifactDependencies({
    packageJsonBytes: source.get("implementations/typescript/engine/package.json")!, bunLockBytes: source.get("bun.lock")! });
  const dependencyManifestBytes = UTF8.encode(dependency.canonicalManifest);
  const policy = computeAttestationPolicyDigest(world.root);
  if (!policy.ok) throw new Error(`fixture policy cannot be computed: ${policy.error}`);
  const sourceRows = [...source].map(([path, bytes]) => fileRow(path, bytes));
  for (const stub of compiledArtifactRecoveryStubs()) sourceRows.push(fileRow(stub.path, stub.bytes));
  const bootstrap = compiledArtifactSnapshotBootstrap({ artifact: ARTIFACT });
  sourceRows.push(fileRow(bootstrap.path, bootstrap.bytes), fileRow(".m3b/dependencies.json", dependencyManifestBytes));
  const sourceNamespace = buildCheckPackageNamespace("source", sourceRows.sort((a, b) => compareUtf8(a.path, b.path)));
  const environmentNamespace = buildCheckPackageNamespace("environment", [fileRow(TOOLCHAIN_PATH, world.toolchainBytes)]);
  const environmentManifest = digestByteManifest("envelope:compiled-artifact-environment", [row(TOOLCHAIN_PATH, world.toolchainBytes)]);
  const ownerEpoch = computeOwnerEpoch({ artifact: ARTIFACT, repositoryEpoch: repositoryManifest.digest,
    ownerOverlayDigest: ownerManifest.digest, dependencyDigest: parseSha256Hex(dependency.dependencyDigest),
    protocolVersion: OWNER_PROTOCOL, recoveryStubVersion: RECOVERY_STUB_VERSION, portableGenerationAbi: PORTABLE_GENERATION_ABI });
  const rawInput = makeRawCompiledArtifactInput({ artifact: ARTIFACT, acquisitionDigest: acquisition.digest,
    ownerOverlayDigest: ownerManifest.digest, repositoryExactDigest: exact.digest, dependencyDigest: dependency.dependencyDigest,
    environmentFingerprint: world.acquired.environmentFingerprint, recoveryStubVersion: RECOVERY_STUB_VERSION,
    portableGenerationAbi: PORTABLE_GENERATION_ABI });
  return Object.freeze({ rawInput, capturedBytes, repositoryManifest, ownerManifest, environmentManifest,
    repositoryEpoch: repositoryManifest.digest, ownerEpoch, dependencyDigest: dependency.dependencyDigest, dependencyManifestBytes,
    environment: world.acquired.environment, environmentFingerprint: world.acquired.environmentFingerprint,
    attestationPolicyDigest: policy.digest, workflowDigest: sha256Raw(readFileSync(at(world.root, WORKFLOW_PATH))),
    sourceProvenance: { kind: "stable-live" as const }, sourceNamespace, environmentNamespace, toolchainManifestBytes: world.toolchainBytes,
    sourcePaths: capturedBytes.paths, coveredSourceArchiveDigest: sourceNamespace.digest, bunExecutable: world.acquired.bunExecutable });
}
function metadata(current: OwnerEvidence, artifactBytes: Uint8Array, producerInput = current.rawInput,
  sourceProvenance: CompiledArtifactCheckPackageMetadata["sourceProvenance"] = { kind: "stable-live" }): CompiledArtifactCheckPackageMetadata {
  return { schema: CHECK_PACKAGE_SCHEMA, artifact: ARTIFACT, artifactPath: SPEC.artifactPath, portableGenerationAbi: PORTABLE_GENERATION_ABI,
    repositoryEpoch: current.repositoryEpoch, ownerEpoch: current.ownerEpoch, dependencyDigest: current.dependencyDigest,
    attestationPolicyDigest: current.attestationPolicyDigest, producerInput, sourceProvenance,
    namespaces: { source: current.sourceNamespace, environment: current.environmentNamespace,
      candidate: buildCheckPackageNamespace("candidate", [fileRow(SPEC.artifactPath, artifactBytes)]) } };
}
function attestation(current: OwnerEvidence, certificate: CompiledArtifactBuildCertificate, artifactBytes: Uint8Array,
  environment = current.environment, origin: AttestationOrigin = { kind: "local" }): CompiledArtifactCheckAttestation {
  const provenance = origin.kind === "ci" ? { kind: "git-object" as const, sourceCommit: origin.sourceCommit,
    workflowDigest: origin.workflowDigest } : { kind: "stable-live" as const };
  return validateCompiledArtifactCheckAttestation({ schema: "fenel.compiled-artifact-check-attestation.v2", result: "MATCH", artifact: ARTIFACT,
    origin, checkPackageDigest: computeCheckPackageDigest(metadata(current, artifactBytes, certificate.producerInput, provenance)),
    certificateBaseDigest: computeCertificateBaseDigest(certificate), coveredSourceArchiveDigest: current.coveredSourceArchiveDigest,
    repositoryEpoch: current.repositoryEpoch, ownerEpoch: current.ownerEpoch, dependencyDigest: current.dependencyDigest,
    environment, environmentFingerprint: computeEnvironmentFingerprint(environment), artifactByteLength: artifactBytes.byteLength,
    artifactDigest: sha256Bytes(artifactBytes), attestationPolicyDigest: current.attestationPolicyDigest });
}
function harness(world: World, initial: OwnerEvidence) {
  let selected = initial;
  const counts = { renders: 0, independentChecks: 0, captures: 0 };
  const dependencies: OwnerRuntimeDependencies = {
    acquiredEnvironment: world.acquired,
    get capturedEvidence() { return selected; },
    spawnWorker: () => { throw new Error("engine/preparation worker execution is forbidden in this controller fixture"); },
    coldResolveDependencies: async () => { throw new Error("cold child execution is forbidden in this captured-evidence fixture"); },
    capture: async () => { throw new Error("stable capture/watchers are forbidden in this controller fixture"); },
    afterEvidenceCapture: () => { counts.captures++; },
    render: async () => { counts.renders++; return { artifact: ARTIFACT, bytes: new Uint8Array(world.artifactBytes),
      stdout: new Uint8Array(), stderr: new Uint8Array(), traceBytes: new Uint8Array(), elapsedMs: 1 }; },
    independentCheck: async () => {
      counts.independentChecks++;
      const checked = await checkCompiledArtifactOwner({ repositoryRoot: world.root, artifact: ARTIFACT, emitAttestation: true }, dependencies);
      if (!checked.matches || checked.attestation === undefined) throw new Error("fixture independent public check did not MATCH");
      return checked.attestation;
    },
  };
  return { dependencies, counts, select(next: OwnerEvidence) { selected = next; } };
}
function options(world: World) { return { repositoryRoot: world.root, artifact: ARTIFACT }; }
function reasons(record: ArtifactFreshnessRecord): readonly string[] {
  if (record.verdict === "FRESH") throw new Error("expected a nonfresh record"); return record.reasons;
}
async function baseline(world: World) {
  const current = evidence(world); const runner = harness(world, current);
  const repaired = await repairCompiledArtifactOwner(options(world), runner.dependencies);
  expect(repaired.trace).toMatchObject({ renders: 2, artifactPublications: 1, attestationMerges: 1 });
  expect(runner.counts.renders).toBe(2); expect(runner.counts.independentChecks).toBe(1);
  return { current, certificate: readArtifactPair(world.root, ARTIFACT).certificate };
}

test("unacquired source byte retains actual original local baseline with current tuple, no render and no publication", async () => {
  const item = world(); const original = await baseline(item);
  const artifactBefore = readFileSync(at(item.root, SPEC.artifactPath));
  const certificateBefore = readFileSync(at(item.root, SPEC.certificatePath));
  append(item.root, UNRELATED, "// changed outside the closed import graph\n");
  const current = evidence(item); const runner = harness(item, current);
  expect(current.rawInput.key).toBe(original.current.rawInput.key);
  expect(current.repositoryEpoch).not.toBe(original.current.repositoryEpoch);
  const repaired = await repairCompiledArtifactOwner(options(item), runner.dependencies);
  expect(repaired.record).toMatchObject({ verdict: "FRESH", sourceRelation: "complete-input-equal", portableSeal: "local-only",
    repositoryEpoch: current.repositoryEpoch, ownerEpoch: current.ownerEpoch, currentSourceArchiveDigest: current.coveredSourceArchiveDigest,
    producer: { repositoryEpoch: original.current.repositoryEpoch, ownerEpoch: original.current.ownerEpoch,
      coveredSourceArchiveDigest: original.current.coveredSourceArchiveDigest, inputKey: original.current.rawInput.key } });
  expect(repaired.trace).toMatchObject({ renders: 0, artifactPublications: 0, attestationMerges: 0, postProbes: 0 });
  expect(runner.counts.renders).toBe(0); expect(runner.counts.independentChecks).toBe(0);
  expect(readFileSync(at(item.root, SPEC.artifactPath))).toEqual(artifactBefore);
  expect(readFileSync(at(item.root, SPEC.certificatePath))).toEqual(certificateBefore);
  expect(computeCertificateBaseDigest(readArtifactPair(item.root, ARTIFACT).certificate)).toBe(computeCertificateBaseDigest(original.certificate));
});

test("acquired byte drift is STALE and forces writer plus independent public check even when artifact bytes MATCH", async () => {
  const item = world(); const original = await baseline(item);
  append(item.root, DEPENDENCY, "// acquired-byte drift\n");
  const current = evidence(item); const runner = harness(item, current);
  expect(current.rawInput.acquisitionDigest).not.toBe(original.current.rawInput.acquisitionDigest);
  const stale = await probeCompiledArtifactOwner(options(item), runner.dependencies);
  expect(stale.verdict).toBe("STALE"); expect(reasons(stale)).toContain("complete-input-key-mismatch");
  const repaired = await repairCompiledArtifactOwner(options(item), runner.dependencies);
  expect(repaired.trace).toMatchObject({ branch: "writer-needed", renders: 2, artifactPublications: 1, attestationMerges: 1 });
  expect(runner.counts.renders).toBe(2); expect(runner.counts.independentChecks).toBe(1);
  const pair = readArtifactPair(item.root, ARTIFACT);
  expect(pair.certificate.producerInput.key).toBe(current.rawInput.key);
  expect(computeCertificateBaseDigest(pair.certificate)).not.toBe(computeCertificateBaseDigest(original.certificate));
});

test("a negative acquisition outcome cannot yield a raw key, controller evidence or FRESH", async () => {
  const item = world(); await baseline(item);
  const before = readFileSync(at(item.root, SPEC.certificatePath));
  // Removing the imported target must fail closeAcquisition, not be papered
  // over by a fabricated capturedEvidence record with an opaque digest.
  assertOwnedFile(item.root, at(item.root, DEPENDENCY)); rmSync(at(item.root, DEPENDENCY));
  let failure: unknown;
  try { evidence(item); } catch (error) { failure = error; }
  expect(failure).toBeInstanceOf(CompiledArtifactAcquisitionError);
  expect((failure as CompiledArtifactAcquisitionError).code).toBe("missing-input");
  expect(readFileSync(at(item.root, SPEC.certificatePath))).toEqual(before);
});

test("owner-overlay byte drift remains a complete raw dependency even outside the tiny import graph", async () => {
  const item = world(); const original = await baseline(item);
  append(item.root, "implementations/typescript/engine/scripts/generate-compiled-parser.ts", "\n// owner overlay control\n");
  const current = evidence(item); const runner = harness(item, current);
  expect(current.rawInput.acquisitionDigest).toBe(original.current.rawInput.acquisitionDigest);
  expect(current.rawInput.ownerOverlayDigest).not.toBe(original.current.rawInput.ownerOverlayDigest);
  const stale = await probeCompiledArtifactOwner(options(item), runner.dependencies);
  expect(stale.verdict).toBe("STALE"); expect(reasons(stale)).toContain("complete-input-key-mismatch");
  const repaired = await repairCompiledArtifactOwner(options(item), runner.dependencies);
  expect(repaired.trace).toMatchObject({ branch: "writer-needed", renders: 2, artifactPublications: 1 });
  expect(readArtifactPair(item.root, ARTIFACT).certificate.producerInput.ownerOverlayDigest).toBe(current.rawInput.ownerOverlayDigest);
});

test("raw-equal old seal without original local proof repairs to a new base instead of mixing source tuples", async () => {
  const item = world(); const original = await baseline(item);
  const ci = (["windows", "linux", "macos"] as const).map(osFamily => attestation(original.current, original.certificate, item.artifactBytes,
    environmentFor(item.toolchainBytes, osFamily), { kind: "ci", sourceCommit: "f".repeat(40), workflowDigest: original.current.workflowDigest,
      workflowRunId: "123", workflowRunAttempt: 1 }));
  write(item.root, SPEC.certificatePath, encodeCanonicalJson({ ...original.certificate, producerAttestations: canonicalizeProducerAttestations(ci) }));
  const sealed = await probeCompiledArtifactOwner(options(item), harness(item, original.current).dependencies);
  expect(sealed).toMatchObject({ verdict: "FRESH", portableSeal: "sealed", sourceRelation: "same-epoch" });
  append(item.root, UNRELATED, "// same raw input, newer source capture\n");
  const current = evidence(item); const runner = harness(item, current);
  expect(current.rawInput.key).toBe(original.current.rawInput.key);
  const stale = await probeCompiledArtifactOwner(options(item), runner.dependencies);
  expect(stale.verdict).toBe("STALE"); expect(reasons(stale)).toContain("repository-epoch-mismatch");
  const repaired = await repairCompiledArtifactOwner(options(item), runner.dependencies);
  expect(repaired.trace).toMatchObject({ branch: "writer-needed", renders: 2, artifactPublications: 1 });
  const pair = readArtifactPair(item.root, ARTIFACT);
  expect(pair.certificate.repositoryEpoch).toBe(current.repositoryEpoch);
  expect(pair.certificate.producerAttestations[0]!.repositoryEpoch).toBe(pair.certificate.repositoryEpoch);
  expect(pair.certificate.producerAttestations[0]!.certificateBaseDigest).toBe(computeCertificateBaseDigest(pair.certificate));
});

test("policy-only package drift at identical raw/source inputs forces a new producer base", async () => {
  const item = world(); const original = await baseline(item);
  append(item.root, WORKFLOW_PATH, "\n# policy-only change for retention control\n");
  const current = evidence(item); const runner = harness(item, current);
  expect(current.repositoryEpoch).toBe(original.current.repositoryEpoch);
  expect(current.ownerEpoch).toBe(original.current.ownerEpoch);
  expect(current.rawInput.key).toBe(original.current.rawInput.key);
  expect(current.attestationPolicyDigest).not.toBe(original.current.attestationPolicyDigest);
  const stale = await probeCompiledArtifactOwner(options(item), runner.dependencies);
  expect(stale.verdict).toBe("STALE"); expect(reasons(stale)).toContain("certificate-artifact-mismatch");
  const repaired = await repairCompiledArtifactOwner(options(item), runner.dependencies);
  expect(repaired.trace).toMatchObject({ branch: "writer-needed", renders: 2, artifactPublications: 1 });
  const pair = readArtifactPair(item.root, ARTIFACT);
  expect(pair.certificate.producerCheckPackageDigest).not.toBe(original.certificate.producerCheckPackageDigest);
  expect(pair.certificate.producerCheckPackageDigest).toBe(computeCheckPackageDigest(metadata(current, item.artifactBytes)));
});

test("plain --check still renders and emitting a check at another producer capture refuses after comparison", async () => {
  const item = world(); await baseline(item);
  const runner = harness(item, evidence(item));
  const plain = await checkCompiledArtifactOwner({ ...options(item), emitAttestation: false }, runner.dependencies);
  expect(plain.matches).toBe(true); expect(plain.attestation).toBeUndefined(); expect(runner.counts.renders).toBe(1);
  const before = readFileSync(at(item.root, SPEC.certificatePath));
  append(item.root, UNRELATED, "// differing producer capture\n"); runner.select(evidence(item));
  await expect(checkCompiledArtifactOwner({ ...options(item), emitAttestation: true }, runner.dependencies)).rejects.toThrow("actual source");
  expect(runner.counts.renders).toBe(2); expect(readFileSync(at(item.root, SPEC.certificatePath))).toEqual(before);
});

test("second current-source bracket refuses even when the complete raw key remains equal", async () => {
  const item = world(); await baseline(item);
  const initial = evidence(item); const runner = harness(item, initial); let captures = 0;
  let selected = initial;
  const dependencies: OwnerRuntimeDependencies = { ...runner.dependencies, get capturedEvidence() { return selected; },
    afterEvidenceCapture: () => {
      if (++captures === 2) { append(item.root, UNRELATED, "// bracket mutation\n"); selected = evidence(item); }
    } };
  const record = await probeCompiledArtifactOwner(options(item), dependencies);
  expect(selected.rawInput.key).toBe(initial.rawInput.key);
  expect(record.verdict).toBe("UNDECIDABLE"); expect(reasons(record)).toContain("concurrent-mutation");
  expect(runner.counts.renders).toBe(0);
});

test("post-independent-check current-tuple mutation refuses before attestation merge", async () => {
  const item = world(); await baseline(item);
  append(item.root, DEPENDENCY, "// force a new writer baseline\n");
  const runner = harness(item, evidence(item));
  const independent = runner.dependencies.independentCheck!;
  let selected = evidence(item);
  const dependencies: OwnerRuntimeDependencies = { ...runner.dependencies, get capturedEvidence() { return selected; },
    independentCheck: async input => {
      const result = await independent(input);
      append(item.root, UNRELATED, "// mutate after independent check\n"); selected = evidence(item); runner.select(selected);
      return result;
    } };
  await expect(repairCompiledArtifactOwner(options(item), dependencies)).rejects.toThrow("epoch changed during transaction");
  expect(runner.counts.renders).toBe(2); expect(runner.counts.independentChecks).toBe(1);
  // Writer publication happened, but no proof for the changed final tuple can
  // be merged or reported FRESH. The real final driver bracket is separate.
  expect(readArtifactPair(item.root, ARTIFACT).certificate.producerAttestations).toEqual([]);
});
