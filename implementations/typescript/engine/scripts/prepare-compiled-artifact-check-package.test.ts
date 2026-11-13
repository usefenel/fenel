import { afterEach, describe, expect, test } from "bun:test";
import { spawnSync } from "node:child_process";
import {
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  utimesSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { parseCheckPackageMetadata } from "./lib/compiled-artifact-check-package";
import { compiledArtifactRecoveryStubs } from "./lib/compiled-artifact-certificate";
import { COMPILED_ARTIFACT_SPECS } from "./lib/compiled-artifact-protocol";
import { captureCompiledArtifactCheckPackage } from "./lib/compiled-artifact-owner";
import { SNAPSHOT_BOOTSTRAP_PATH } from "./lib/compiled-artifact-snapshot";
import {
  compiledArtifactSourceCensus,
} from "./lib/compiled-artifact-source-census";
import { prepareCompiledArtifactCheckPackage } from "./prepare-compiled-artifact-check-package";

const HERE = dirname(fileURLToPath(import.meta.url));
const REPOSITORY_ROOT = resolve(HERE, "../../../..");
const temporaryRoots: string[] = [];

afterEach(() => {
  for (const root of temporaryRoots.splice(0)) rmSync(root, { recursive: true, force: true });
});

function write(root: string, path: string, bytes: string | Uint8Array): void {
  const target = join(root, ...path.split("/"));
  mkdirSync(dirname(target), { recursive: true });
  writeFileSync(target, bytes);
}

function run(root: string, args: readonly string[]): Buffer {
  const result = spawnSync(args[0]!, args.slice(1), {
    cwd: root,
    encoding: "buffer",
    maxBuffer: 32 * 1024 * 1024,
    windowsHide: true,
  });
  if (result.error !== undefined) throw result.error;
  if (result.status !== 0) {
    throw new Error(Buffer.from(result.stderr ?? []).toString("utf8"));
  }
  return Buffer.from(result.stdout ?? []);
}

function git(root: string, ...args: string[]): string {
  return run(root, ["git", ...args]).toString("utf8").trim();
}

function commit(root: string, message: string, paths?: readonly string[]): string {
  if (paths === undefined) git(root, "add", "--all");
  else git(root, "add", "--", ...paths);
  git(root, "commit", "-m", message);
  return git(root, "rev-parse", "HEAD");
}

function repositoryFixture(): { readonly root: string; readonly commit: string } {
  const root = mkdtempSync(join(tmpdir(), "fenel-m3b-package-"));
  temporaryRoots.push(root);
  git(root, "init", "--quiet");
  git(root, "config", "user.name", "M3b Test");
  git(root, "config", "user.email", "m3b@example.invalid");
  git(root, "config", "core.autocrlf", "false");

  for (const row of compiledArtifactSourceCensus()) write(root, row.path, `${row.path}\n`);
  write(root, ".fenel.lock", "fixture\n");
  write(root, ".gitattributes", "* -text\n");
  write(root, "package.json", "{\"packageManager\":\"bun@1.3.13\"}\n");
  write(root, "bun.lock", JSON.stringify({
    lockfileVersion: 1,
    configVersion: 1,
    workspaces: { "": { name: "fenel" }, "implementations/typescript/engine": { name: "@fenel/engine" } },
    packages: { "@fenel/engine": ["@fenel/engine@workspace:implementations/typescript/engine"] },
  }) + "\n");
  write(root, "tsconfig.base.json", "{}\n");
  write(root, "implementations/typescript/engine/package.json", "{\"name\":\"@fenel/engine\"}\n");
  write(root, "implementations/typescript/engine/tsconfig.json", "{}\n");
  write(root, "fenel/fixture.fenel", "fixture\n");
  write(root, "implementations/typescript/engine/src/fixture.ts", "export const fixture = true;\n");
  write(
    root,
    COMPILED_ARTIFACT_SPECS["compiled-resolver"].artifactPath,
    "export const COMPILED_RESOLVER_FIXTURE = true;\n",
  );
  write(
    root,
    COMPILED_ARTIFACT_SPECS["compiled-parser"].artifactPath,
    "export const COMPILED_PARSER_FIXTURE = true;\n",
  );
  write(
    root,
    ".github/fenel-artifact-toolchains.json",
    readFileSync(join(REPOSITORY_ROOT, ".github/fenel-artifact-toolchains.json")),
  );
  write(root, ".gitignore", "fenel/ignored.tmp\n");
  return { root, commit: commit(root, "fixture") };
}

function prepare(root: string, sourceCommit: string, output: string) {
  return prepareCompiledArtifactCheckPackage({
    repositoryRoot: root,
    sourceCommit,
    artifact: "compiled-resolver",
    output,
  });
}

describe("compiled-artifact Git-object check-package coordinator", () => {
  test("is import-inert", () => {
    const script = pathToFileURL(join(HERE, "prepare-compiled-artifact-check-package.ts")).href;
    const result = spawnSync(process.execPath, ["-e", `await import(${JSON.stringify(script)})`], {
      cwd: REPOSITORY_ROOT,
      encoding: "buffer",
      windowsHide: true,
    });
    expect(result.status).toBe(0);
    expect(Buffer.from(result.stdout ?? []).byteLength).toBe(0);
    expect(Buffer.from(result.stderr ?? []).byteLength).toBe(0);
  });

  test("materializes canonical disjoint namespaces from raw Git blobs", () => {
    const fixture = repositoryFixture();
    const result = prepare(fixture.root, fixture.commit, ".packages/resolver");
    const metadataBytes = readFileSync(join(result.output, "metadata.json"));
    const metadata = parseCheckPackageMetadata(metadataBytes);
    expect(metadata).toEqual(result.metadata);
    expect(metadata.sourceProvenance).toEqual({
      kind: "git-object",
      sourceCommit: fixture.commit,
      workflowDigest: expect.stringMatching(/^[0-9a-f]{64}$/),
    });
    expect(metadata.attestationPolicyDigest).toMatch(/^[0-9a-f]{64}$/);
    expect(metadata.namespaces.candidate.files).toHaveLength(1);
    expect(metadata.namespaces.environment.files.map(({ path }) => path)).toEqual([
      ".github/fenel-artifact-toolchains.json",
    ]);
    expect(metadata.namespaces.source.files.some(({ path }) => path === SNAPSHOT_BOOTSTRAP_PATH))
      .toBe(true);
    expect(metadata.namespaces.source.files.some(({ path }) => path === ".m3b/dependencies.json"))
      .toBe(true);

    const artifactPath = COMPILED_ARTIFACT_SPECS["compiled-resolver"].artifactPath;
    const candidate = readFileSync(join(result.output, "candidate", ...artifactPath.split("/")));
    const sourceStub = readFileSync(join(result.output, "source", ...artifactPath.split("/")));
    const expectedStub = compiledArtifactRecoveryStubs().find(({ path }) => path === artifactPath)!;
    expect(candidate).toEqual(readFileSync(join(fixture.root, ...artifactPath.split("/"))));
    expect(sourceStub).toEqual(Buffer.from(expectedStub.bytes));
    expect(sourceStub).not.toEqual(candidate);
    const captured = captureCompiledArtifactCheckPackage(result.output, "compiled-resolver");
    expect(captured.metadata).toEqual(metadata);
    expect(captured.candidateBytes).toEqual(candidate);
  });

  test("package capture rejects physical extras and namespace-byte tampering", () => {
    const fixture = repositoryFixture();
    const result = prepare(fixture.root, fixture.commit, ".packages/capture-negative");
    write(result.output, "source/extra.ts", "export const extra = true;\n");
    expect(() => captureCompiledArtifactCheckPackage(result.output, "compiled-resolver"))
      .toThrow("physical files differ");
    rmSync(join(result.output, "source/extra.ts"));

    const artifactPath = COMPILED_ARTIFACT_SPECS["compiled-resolver"].artifactPath;
    write(result.output, `candidate/${artifactPath}`, "export const tampered = true;\n");
    expect(() => captureCompiledArtifactCheckPackage(result.output, "compiled-resolver"))
      .toThrow("candidate manifest");
  });

  test("refuses raw working, index, candidate, and ignored-untracked drift", () => {
    const fixture = repositoryFixture();
    const commonPath = "fenel/fixture.fenel";
    write(fixture.root, commonPath, "fixture\r\n");
    expect(() => prepare(fixture.root, fixture.commit, ".packages/raw-dirty"))
      .toThrow("raw bytes differ");
    git(fixture.root, "checkout", "--", commonPath);

    write(fixture.root, commonPath, "staged\n");
    git(fixture.root, "add", "--", commonPath);
    write(fixture.root, commonPath, "fixture\n");
    expect(() => prepare(fixture.root, fixture.commit, ".packages/index-dirty"))
      .toThrow("index bytes or kind differ");
    git(fixture.root, "reset", "--quiet", "HEAD", "--", commonPath);

    const artifactPath = COMPILED_ARTIFACT_SPECS["compiled-resolver"].artifactPath;
    write(fixture.root, artifactPath, "export const DIFFERENT = true;\n");
    expect(() => prepare(fixture.root, fixture.commit, ".packages/candidate-dirty"))
      .toThrow("raw bytes differ");
    git(fixture.root, "checkout", "--", artifactPath);

    write(fixture.root, "fenel/ignored.tmp", "ignored but covered\n");
    expect(() => prepare(fixture.root, fixture.commit, ".packages/untracked-dirty"))
      .toThrow("untracked path");
  });

  test("accepts stale working-tree stat data when covered raw bytes still equal Git", () => {
    const fixture = repositoryFixture();
    const path = join(fixture.root, "fenel", "fixture.fenel");
    const bytes = readFileSync(path);
    writeFileSync(path, bytes);
    const shifted = new Date(Date.now() + 120_000);
    utimesSync(path, shifted, shifted);

    expect(() => prepare(fixture.root, fixture.commit, ".packages/stat-only-drift"))
      .not.toThrow();
  });

  test("ignores a changed sibling sidecar but still rejects selected candidate drift", () => {
    const fixture = repositoryFixture();
    const siblingSidecar = COMPILED_ARTIFACT_SPECS["compiled-parser"].certificatePath;
    write(fixture.root, siblingSidecar, "before\n");
    const sourceCommit = commit(fixture.root, "tracked sibling sidecar", [siblingSidecar]);

    write(fixture.root, siblingSidecar, "after\n");
    expect(() => prepare(fixture.root, sourceCommit, ".packages/excluded-sidecar"))
      .not.toThrow();
    git(fixture.root, "add", "--", siblingSidecar);
    expect(() => prepare(fixture.root, sourceCommit, ".packages/excluded-sidecar-index"))
      .not.toThrow();

    const candidate = COMPILED_ARTIFACT_SPECS["compiled-resolver"].artifactPath;
    write(fixture.root, candidate, "export const DIFFERENT = true;\n");
    expect(() => prepare(fixture.root, sourceCommit, ".packages/selected-candidate-dirty"))
      .toThrow("raw bytes differ");
  });

  test("separates policy-only and environment-only identity changes from render epochs", () => {
    const fixture = repositoryFixture();
    const first = prepare(fixture.root, fixture.commit, ".packages/first");
    const workflow = ".github/workflows/compiled-artifact-portability.yml";
    write(fixture.root, workflow, "name: changed-policy\n");
    const policyCommit = commit(fixture.root, "policy", [workflow]);
    const second = prepare(fixture.root, policyCommit, ".packages/second");
    expect(second.metadata.repositoryEpoch).toBe(first.metadata.repositoryEpoch);
    expect(second.metadata.ownerEpoch).toBe(first.metadata.ownerEpoch);
    expect(second.metadata.dependencyDigest).toBe(first.metadata.dependencyDigest);
    expect(second.metadata.attestationPolicyDigest).not.toBe(first.metadata.attestationPolicyDigest);
    if (
      first.metadata.sourceProvenance.kind !== "git-object"
      || second.metadata.sourceProvenance.kind !== "git-object"
    ) throw new Error("fixture packages must use Git-object provenance");
    expect(second.metadata.sourceProvenance.workflowDigest)
      .not.toBe(first.metadata.sourceProvenance.workflowDigest);

    const manifest = ".github/fenel-artifact-toolchains.json";
    write(fixture.root, manifest, `${readFileSync(join(fixture.root, manifest), "utf8")} `);
    const environmentCommit = commit(fixture.root, "environment", [manifest]);
    const third = prepare(fixture.root, environmentCommit, ".packages/third");
    expect(third.metadata.repositoryEpoch).toBe(second.metadata.repositoryEpoch);
    expect(third.metadata.ownerEpoch).toBe(second.metadata.ownerEpoch);
    expect(third.metadata.attestationPolicyDigest).toBe(second.metadata.attestationPolicyDigest);
    expect(third.metadata.namespaces.environment.digest)
      .not.toBe(second.metadata.namespaces.environment.digest);
  });
});

describe("compiled-artifact portability workflow wiring", () => {
  test("pins every action and runs both packages on all three OS families", () => {
    const workflow = readFileSync(
      join(REPOSITORY_ROOT, ".github/workflows/compiled-artifact-portability.yml"),
      "utf8",
    );
    const actionRefs = [...workflow.matchAll(/^\s*uses:\s*([^\s]+)@([^\s]+)\s*$/gmu)];
    expect(actionRefs.length).toBeGreaterThan(0);
    expect(actionRefs.every((match) => /^[0-9a-f]{40}$/u.test(match[2]!))).toBe(true);
    expect(new Set(actionRefs.map((match) => `${match[1]}@${match[2]}`))).toEqual(new Set([
      "actions/checkout@11d5960a326750d5838078e36cf38b85af677262",
      "oven-sh/setup-bun@0c5077e51419868618aeaa5fe8019c62421857d6",
      "actions/upload-artifact@ea165f8d65b6e75b540449e92b4886f43607fa02",
      "actions/download-artifact@d3f86a106a0bac45b974a628896c90dbdf5c8093",
    ]));
    for (const family of ["windows", "linux", "macos"] as const) {
      expect(workflow).toContain(`- os-family: ${family}`);
    }
    expect(workflow.match(/--artifact=compiled-resolver/g)?.length).toBe(1);
    expect(workflow.match(/--artifact=compiled-parser/g)?.length).toBe(1);
    expect(workflow.match(/--package=.*compiled-resolver/g)?.length).toBe(1);
    expect(workflow.match(/--package=.*compiled-parser/g)?.length).toBe(1);
    expect(workflow).toContain('branches:\n      - "m3b-seal/**"');
  });

  test("uses the same coordinator and package-check path in audit", () => {
    const audit = readFileSync(join(REPOSITORY_ROOT, ".github/workflows/audit.yml"), "utf8");
    const actionRefs = [...audit.matchAll(/^\s*(?:-\s+)?uses:\s*([^\s]+)@([^\s]+)\s*$/gmu)];
    expect(actionRefs.length).toBeGreaterThan(0);
    expect(actionRefs.every((match) => /^[0-9a-f]{40}$/u.test(match[2]!))).toBe(true);
    expect(audit).toContain("prepare-compiled-artifact-check-package.ts");
    expect(audit).toContain("--source-commit=$GITHUB_SHA");
    expect(audit).toContain("--artifact=compiled-resolver");
    expect(audit).toContain("--package=.tmp-m3b-ci/audit-compiled-resolver");
    expect(audit).not.toContain(
      "bun implementations/typescript/engine/scripts/generate-compiled-resolver.ts --check",
    );
  });
});
