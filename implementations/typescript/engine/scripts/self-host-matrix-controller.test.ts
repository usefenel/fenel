import { afterEach, describe, expect, test } from "bun:test";
import {
  closeSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  openSync,
  readFileSync,
  readdirSync,
  realpathSync,
  rmSync,
  statSync,
  unlinkSync,
  utimesSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, relative, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { spawnSync } from "node:child_process";
import {
  digestByteManifest,
  repositoryRelativePath,
  parseSha256Hex,
  sha256Raw,
  type ArtifactByteWatcherHandlers,
  type ByteManifestRow,
  type DismissedChangeEvent,
  type RepositoryRelativePath,
} from "./lib/artifact-bytes";
import { encodeCanonicalJson } from "./lib/artifact-wire-json";
import { censusSourceAcquisitions } from "./lib/compiled-artifact-acquisition";
import {
  proveEmptyCompiledArtifactDependencies,
} from "./lib/compiled-artifact-dependencies";
import {
  MATRIX_NO_FAILURE_DIGEST,
  UNAVAILABLE_MATRIX_IDENTITY_DIGEST,
  SELF_HOST_MATRIX_CERTIFICATE_HELPER_PATH,
  SELF_HOST_MATRIX_CONTROLLER_PATH,
  SELF_HOST_MATRIX_EXACT_INPUTS,
  SELF_HOST_MATRIX_GENERATOR_PATH,
  SELF_HOST_MATRIX_RECURSIVE_ROOTS,
  SELF_HOST_MATRIX_TOOLCHAIN_MANIFEST_PATH,
  computeMatrixPackageDigest,
  makeMatrixEnvironmentCertificate,
  makeMatrixInputsCertificate,
  matrixArtifactIdentity,
  matrixStampFor,
  matrixStampLine,
  parseMatrixControllerReceipt,
  parseMatrixDocument,
  replaceMatrixPresentation,
  type MatrixControllerReceipt,
} from "./lib/self-host-matrix-certificate";
import {
  captureMatrixEnvironment,
  captureMatrixPackage,
  captureCurrentMatrixLeg,
  assertCurrentMatrixPackage,
  computeMatrixControllerDigest,
  loadMatrixCheckPackage,
  loadVerifiedMatrixCheckPackage,
  matrixWorkerGuardSource,
  decodeMatrixRawFacets,
  decodeMatrixReportAudit,
  matrixRenderRequestBytes,
  publishMatrixCandidateAtomically,
  proveMatrixReportSmoke,
  runSelfHostMatrixController,
  validateWorkerGuardTrace,
  writeMatrixCheckPackage,
  type CapturedMatrixPackage,
  type CapturedMatrixSource,
  type MatrixControllerDependencies,
  type MatrixCaptureTestDependencies,
  type MatrixRenderResult,
} from "./self-host-matrix-controller";

const HERE = dirname(fileURLToPath(import.meta.url));
const REPOSITORY_ROOT = resolve(HERE, "../../../..");
const temporaryRoots: string[] = [];
const digest = (character: string) => parseSha256Hex(character.repeat(64));
const sourceCommit = "1".repeat(40);
const repositoryDependencyProof = proveEmptyCompiledArtifactDependencies({
  packageJsonBytes: new Uint8Array(readFileSync(resolve(
    REPOSITORY_ROOT,
    "implementations/typescript/engine/package.json",
  ))),
  bunLockBytes: new Uint8Array(readFileSync(resolve(REPOSITORY_ROOT, "bun.lock"))),
});
const repositoryDependencyManifestBytes = new TextEncoder().encode(
  repositoryDependencyProof.canonicalManifest,
);
const repositoryDependencyProofDigest = parseSha256Hex(repositoryDependencyProof.dependencyDigest);
const ROOT_PACKAGE_MANAGER = (JSON.parse(readFileSync(resolve(REPOSITORY_ROOT, "package.json"), "utf8")) as {
  readonly packageManager: string;
}).packageManager;
const FIXTURE_ROOT_PACKAGE_JSON = `${JSON.stringify({
  name: "fenel-matrix-fixture",
  private: true,
  workspaces: ["implementations/typescript/*", "distros/narthex/*"],
  packageManager: ROOT_PACKAGE_MANAGER,
})}\n`;
const FIXTURE_ENGINE_PACKAGE_JSON = '{"name":"@fenel/engine","exports":{}}\n';
const FIXTURE_BUN_LOCK = `${JSON.stringify({
  lockfileVersion: 1,
  configVersion: 1,
  workspaces: {
    "": { name: "fenel-matrix-fixture" },
    "implementations/typescript/engine": { name: "@fenel/engine" },
  },
  packages: {
    "@fenel/engine": ["@fenel/engine@workspace:implementations/typescript/engine"],
  },
}, null, 2)}\n`;
const FIXTURE_MATRIX_REPORT_SOURCE = "module matrixreport where\n";

afterEach(() => {
  for (const root of temporaryRoots.splice(0)) rmSync(root, { recursive: true, force: true });
});

function temporaryRoot(prefix: string): string {
  const root = mkdtempSync(join(tmpdir(), prefix));
  temporaryRoots.push(root);
  return root;
}

function write(root: string, path: string, bytes: string | Uint8Array): void {
  const target = join(root, ...path.split("/"));
  mkdirSync(dirname(target), { recursive: true });
  writeFileSync(target, bytes);
}

interface FakeMatrixWatcher {
  readonly dependencies: MatrixCaptureTestDependencies;
  emit(path: string | Uint8Array | null, eventType?: "rename" | "change"): void;
  error(): void;
  failCloseAt(watchNumber: number): void;
  readonly watchCount: () => number;
}

function fakeMatrixWatcher(root: string): FakeMatrixWatcher {
  let handlers: ArtifactByteWatcherHandlers | undefined;
  let watches = 0;
  let failingClose: number | undefined;
  const emitAbsolute = (absolutePath: string): void => {
    handlers?.event(
      "rename",
      repositoryRelativePath(relative(root, absolutePath).replaceAll("\\", "/")),
    );
  };
  return {
    dependencies: {
      nonce: () => "0123456789abcdef",
      watchFactory: (_repositoryRoot, nextHandlers) => {
        watches += 1;
        const watchNumber = watches;
        handlers = nextHandlers;
        return {
          close: async () => {
            if (handlers === nextHandlers) handlers = undefined;
            if (failingClose === watchNumber) throw new Error("injected matrix watcher close failure");
          },
        };
      },
      createSentinel: async (absolutePath, payload) => {
        const descriptor = openSync(absolutePath, "wx");
        try {
          writeFileSync(descriptor, payload);
        } finally {
          closeSync(descriptor);
        }
        emitAbsolute(absolutePath);
      },
      removeSentinel: async (absolutePath) => {
        unlinkSync(absolutePath);
        emitAbsolute(absolutePath);
      },
      drainWatcher: async () => undefined,
      watcherTimeoutMs: 100,
    },
    emit: (path, eventType = "change") => handlers?.event(eventType, path),
    error: () => handlers?.error(new Error("injected matrix watcher failure")),
    failCloseAt: (watchNumber) => {
      failingClose = watchNumber;
    },
    watchCount: () => watches,
  };
}

function guardFixture(
  root: string,
  targetSource: string,
): { readonly preload: string; readonly target: string } {
  const trace = resolve(root, ".m3b-matrix-worker-guard.jsonl");
  const preload = resolve(root, ".m3b-matrix-worker-preload.ts");
  const target = resolve(root, "target.ts");
  const preloadBytes = new TextEncoder().encode(matrixWorkerGuardSource(trace, target));
  const targetBytes = new TextEncoder().encode(targetSource);
  writeFileSync(preload, preloadBytes);
  writeFileSync(target, targetBytes);
  const manifest = digestByteManifest("self-host-matrix-worker-runtime", [
    { path: repositoryRelativePath(".m3b-matrix-worker-preload.ts"), kind: "regular-file", byteLength: preloadBytes.byteLength, sha256: sha256Raw(preloadBytes) },
    { path: repositoryRelativePath("target.ts"), kind: "regular-file", byteLength: targetBytes.byteLength, sha256: sha256Raw(targetBytes) },
  ]);
  writeFileSync(resolve(root, ".m3b-matrix-worker-manifest.json"), encodeCanonicalJson(manifest));
  return { preload, target };
}

function document(label = "original"): Uint8Array {
  return new TextEncoder().encode(`---
verified: 2026-08-11
verified_at_sha: 1111111
covers:
  - fixture
---

# Self-Host Matrix

${label}
`);
}

function row(path: string): ByteManifestRow {
  const bytes = new TextEncoder().encode(`${path}\n`);
  return {
    path: repositoryRelativePath(path),
    kind: "regular-file",
    byteLength: bytes.byteLength,
    sha256: sha256Raw(bytes),
  };
}

function fakeCaptured(
  repositoryRoot: string,
  documentBytes: Uint8Array | null = document(),
): CapturedMatrixPackage {
  const reportPath = repositoryRelativePath(
    "implementations/typescript/engine/scripts/self-host-matrix-report.fenel",
  );
  const reportBytes = new TextEncoder().encode("module matrixreport where\n");
  const sourceRows = [
    ...SELF_HOST_MATRIX_EXACT_INPUTS.map((path) => row(path)),
    ...SELF_HOST_MATRIX_RECURSIVE_ROOTS.map((root) => row(`${root}/fixture.ts`)),
    Object.freeze({
      path: reportPath,
      kind: "regular-file" as const,
      byteLength: reportBytes.byteLength,
      sha256: sha256Raw(reportBytes),
    }),
  ];
  const inputs = makeMatrixInputsCertificate({
    sourceRows,
    dependencyRows: [],
  });
  const environment = makeMatrixEnvironmentCertificate({
    osFamily: "windows",
    arch: "x64",
    bun: {
      executableSha256: digest("b"),
      release: "1.3.13",
      revision: "2".repeat(40),
      webkit: "webkit",
      icu: "73.2",
      unicode: "15.0",
    },
    toolchainManifestDigest: digest("a"),
    locale: "en-US",
    timezone: "UTC",
    parentEnvironment: [
      { key: "COMSPEC", value: "C:\\Windows\\System32\\cmd.exe" },
      { key: "LANG", value: "C.UTF-8" },
      { key: "LC_ALL", value: "C.UTF-8" },
      { key: "NO_COLOR", value: "1" },
      { key: "PATH", value: "<matrix-package>/.bin" },
      { key: "SYSTEMROOT", value: "C:\\Windows" },
      { key: "TEMP", value: "<matrix-package>/.tmp" },
      { key: "TMP", value: "<matrix-package>/.tmp" },
      { key: "TZ", value: "UTC" },
    ],
    externalTool: {
      mode: "shape-only",
      privatePath: "<matrix-package>/.bin",
      clang: "absent",
    },
  });
  const artifactBefore = matrixArtifactIdentity(documentBytes);
  const controllerDigest = digest("c");
  const packageDigest = computeMatrixPackageDigest({
    inputsDigest: inputs.digest,
    environmentDigest: environment.digest,
    controllerDigest,
    sourceCommit,
    verified: "2026-08-11",
    verifiedAtSha: sourceCommit.slice(0, 7),
    initialArtifact: artifactBefore,
  });
  return Object.freeze({
    repositoryRoot,
    source: Object.freeze({ rows: sourceRows, bytes: new Map([[reportPath, reportBytes]]) }),
    inputs,
    environment,
    sourceCommit,
    verified: "2026-08-11",
    verifiedAtSha: sourceCommit.slice(0, 7),
    controllerDigest,
    packageDigest,
    documentBytes,
    observation: documentBytes === null ? null : parseMatrixDocument(documentBytes),
    artifactBefore,
    workerEnvironment: Object.freeze({}),
    toolchainManifestBytes: new TextEncoder().encode("{}\n"),
    dependencyManifestBytes: Uint8Array.from(repositoryDependencyManifestBytes),
    dependencyProofDigest: repositoryDependencyProofDigest,
  });
}

function stampedCaptured(input: {
  readonly relation?: "current" | "foreign" | "inputs-due" | "body-due";
  readonly label?: string;
} = {}): { readonly captured: CapturedMatrixPackage; readonly unstamped: Uint8Array } {
  const unstamped = document(input.label ?? "stamped");
  const basis = fakeCaptured(REPOSITORY_ROOT, unstamped);
  const observation = parseMatrixDocument(unstamped);
  const current = matrixStampFor({
    inputs: basis.inputs,
    environment: basis.environment,
    bodyDigest: observation.bodyDigest,
  });
  const relation = input.relation ?? "current";
  const stamp = Object.freeze({
    ...current,
    inputs: relation === "inputs-due" ? digest("d") : current.inputs,
    environment: relation === "foreign" ? digest("e") : current.environment,
    body: relation === "body-due" ? digest("f") : current.body,
  });
  const stamped = new TextEncoder().encode(
    new TextDecoder().decode(unstamped).replace(
      "# Self-Host Matrix",
      `${matrixStampLine(stamp)}\n# Self-Host Matrix`,
    ),
  );
  return Object.freeze({ captured: fakeCaptured(REPOSITORY_ROOT, stamped), unstamped });
}

function packagedGenerator(
  extraSource = "",
  candidateBytes: Uint8Array = document(),
): string {
  const rows = [
    {
      fnId: "engine:llvmDomainToValType",
      categoryPresent: true,
      category: "engine-internal",
      tagsPresent: true,
      tags: ["engine", "internal", "llvm", "phase-21"],
    },
    {
      fnId: "std:.",
      categoryPresent: true,
      category: "function",
      tagsPresent: true,
      tags: ["function", "combinator", "operator", "higher-order"],
    },
  ] as const;
  const categoryPreimage = `fenel.self-host-matrix.category.v1\n2\n${rows.map((item) =>
    `${utf8Length(item.fnId)}:${item.fnId}${utf8Length(item.category)}:${item.category}\n`).join("")}`;
  const tagPreimage = `fenel.self-host-matrix.tags.v1\n2\n${rows.map((item) =>
    `${utf8Length(item.fnId)}:${item.fnId}${item.tags.length}\n${item.tags.map((tag) =>
      `${utf8Length(tag)}:${tag}`).join("")}\n`).join("")}`;
  const rosterKeys = Array.from({ length: 41 }, (_value, index) => `fixture:${index}`);
  const rawFacets = new TextDecoder().decode(encodeCanonicalJson({
    schema: "fenel.self-host-matrix-raw-facets.v1",
    rows,
  }));
  const audit = new TextDecoder().decode(encodeCanonicalJson({
    schema: "fenel.self-host-matrix-report-audit.v1",
    categoryCount: rows.length,
    categoryPreimage,
    categoryDigest: sha256Raw(categoryPreimage),
    tagCount: rows.length,
    tagPreimage,
    tagDigest: sha256Raw(tagPreimage),
    categorizableRepresentativeIds: rows.map((item) => item.fnId),
    taggableRepresentativeIds: rows.map((item) => item.fnId),
    rosterCount: rosterKeys.length,
    rosterKeys,
    acquisitionKeys: rosterKeys,
    rowCount: rows.length,
    declaredObservedAsymmetryCount: 0,
    declaredObservedAsymmetries: [],
    groupingFacts: [
      { fnId: "engine:llvmDomainToValType", area: "engine: LLVM helper" },
      { fnId: "std:.", area: "std:function" },
    ],
    reportSourceDigest: sha256Raw(FIXTURE_MATRIX_REPORT_SOURCE),
  }));
  const candidate = new TextDecoder().decode(candidateBytes);
  return `import { createHash } from "node:crypto";
import { basename, dirname, isAbsolute, normalize, resolve } from "node:path";
void createHash;
const MATRIX_WORKER_AUTHORIZATION_GLOBAL = "__FENEL_SELF_HOST_MATRIX_WORKER_AUTHORIZATION__";
function matrixWorkerRequestPath(argv: readonly string[]): string {
  if (argv.length !== 1 || !argv[0]?.startsWith("--worker-request=")) throw new TypeError("bad request argv");
  const value = argv[0].slice("--worker-request=".length);
  if (!isAbsolute(value) || normalize(value) !== value || basename(value) !== ".m4-matrix-worker-request.json") {
    throw new TypeError("bad request path");
  }
  return value;
}
function readAuthorization(): unknown {
  const globalDescriptor = Object.getOwnPropertyDescriptor(
    globalThis,
    MATRIX_WORKER_AUTHORIZATION_GLOBAL,
  );
  if (globalDescriptor === undefined || !("value" in globalDescriptor)) throw new TypeError("missing authorization");
  return globalDescriptor.value;
}
async function loadReport(): Promise<unknown> {
  const raw = await import("./self-host-matrix-report.fenel?raw");
  return raw;
}
export async function runMatrixWorker(argv: readonly string[] = process.argv.slice(2)): Promise<void> {
  const requestPath = matrixWorkerRequestPath(argv);
  void readAuthorization();
  const { readFileSync, writeFileSync } = require("node:fs");
  const requestBytes = new Uint8Array(readFileSync(requestPath));
  const request = JSON.parse(new TextDecoder().decode(requestBytes));
  void await loadReport();
  if (request.task === "report-smoke") {
    const outputPath = resolve(dirname(requestPath), request.outputs.smoke);
    writeFileSync(outputPath, new TextEncoder().encode(${JSON.stringify(new TextDecoder().decode(encodeCanonicalJson({
      schema: "fenel.self-host-matrix-report-smoke.v1",
      result: "matrix-report-isolated-v1",
      provenanceDelta: { fenel: 1, ts: 0 },
      bootDeficitDelta: 0,
      loadDepthBefore: 0,
    })))}), { flag: "wx" });
    return;
  }
  const base = dirname(requestPath);
  writeFileSync(resolve(base, request.outputs.candidate), new TextEncoder().encode(${JSON.stringify(candidate)}), { flag: "wx" });
  writeFileSync(resolve(base, request.outputs.rawFacets), new TextEncoder().encode(${JSON.stringify(rawFacets)}), { flag: "wx" });
  writeFileSync(resolve(base, request.outputs.audit), new TextEncoder().encode(${JSON.stringify(audit)}), { flag: "wx" });
}
${extraSource}
if (import.meta.main) {
  await runMatrixWorker();
}
`;
}

function packagedCaptured(
  documentBytes: Uint8Array | null = document(),
  generatorSource = packagedGenerator(),
  extraSourceFiles: Readonly<Record<string, string>> = Object.freeze({}),
): CapturedMatrixPackage {
  const sourceBytes = new Map<RepositoryRelativePath, Uint8Array>();
  const add = (rawPath: string, value: string | Uint8Array): void => {
    sourceBytes.set(
      repositoryRelativePath(rawPath),
      typeof value === "string" ? new TextEncoder().encode(value) : Uint8Array.from(value),
    );
  };
  for (const path of SELF_HOST_MATRIX_EXACT_INPUTS) {
    const fixture = path === "implementations/typescript/engine/package.json"
      ? FIXTURE_ENGINE_PACKAGE_JSON
      : path === "package.json"
        ? FIXTURE_ROOT_PACKAGE_JSON
        : path === "bun.lock"
          ? FIXTURE_BUN_LOCK
          : `${path}\n`;
    add(path, fixture);
  }
  add("fenel/package-fixture.fenel", "(module package-fixture)\n");
  add("implementations/typescript/engine/src/package-fixture.ts", "export const fixture = true;\n");
  add("implementations/typescript/engine/scripts/self-host-matrix-report.fenel", FIXTURE_MATRIX_REPORT_SOURCE);
  for (const [path, source] of Object.entries(extraSourceFiles)) add(path, source);
  add(
    SELF_HOST_MATRIX_GENERATOR_PATH,
    generatorSource,
  );
  for (const path of [SELF_HOST_MATRIX_CONTROLLER_PATH, SELF_HOST_MATRIX_CERTIFICATE_HELPER_PATH]) {
    add(path, readFileSync(resolve(REPOSITORY_ROOT, ...path.split("/"))));
  }
  const sourceRows = [...sourceBytes].map(([path, bytes]) => Object.freeze({
    path,
    kind: "regular-file" as const,
    byteLength: bytes.byteLength,
    sha256: sha256Raw(bytes),
  }));
  const toolchainManifestBytes = new Uint8Array(readFileSync(resolve(
    REPOSITORY_ROOT,
    ...SELF_HOST_MATRIX_TOOLCHAIN_MANIFEST_PATH.split("/"),
  )));
  const dependencyProof = proveEmptyCompiledArtifactDependencies({
    packageJsonBytes: sourceBytes.get(repositoryRelativePath("implementations/typescript/engine/package.json"))!,
    bunLockBytes: sourceBytes.get(repositoryRelativePath("bun.lock"))!,
  });
  const dependencyManifestBytes = new TextEncoder().encode(dependencyProof.canonicalManifest);
  const inputs = makeMatrixInputsCertificate({
    sourceRows,
    dependencyRows: [],
  });
  const source: CapturedMatrixSource = Object.freeze({
    rows: inputs.source.rows,
    bytes: sourceBytes,
  });
  const environment = captureMatrixEnvironment(REPOSITORY_ROOT, toolchainManifestBytes);
  const artifactBefore = matrixArtifactIdentity(documentBytes);
  const controllerDigest = computeMatrixControllerDigest(source);
  const packageDigest = computeMatrixPackageDigest({
    inputsDigest: inputs.digest,
    environmentDigest: environment.certificate.digest,
    controllerDigest,
    sourceCommit,
    verified: "2026-08-11",
    verifiedAtSha: sourceCommit.slice(0, 7),
    initialArtifact: artifactBefore,
  });
  return Object.freeze({
    repositoryRoot: REPOSITORY_ROOT,
    source,
    inputs,
    environment: environment.certificate,
    sourceCommit,
    verified: "2026-08-11",
    verifiedAtSha: sourceCommit.slice(0, 7),
    controllerDigest,
    packageDigest,
    documentBytes,
    observation: documentBytes === null ? null : parseMatrixDocument(documentBytes),
    artifactBefore,
    workerEnvironment: environment.worker,
    toolchainManifestBytes,
    dependencyManifestBytes,
    dependencyProofDigest: parseSha256Hex(dependencyProof.dependencyDigest),
  });
}

function materializeLiveCaptureFixture(root: string): CapturedMatrixPackage {
  const captured = packagedCaptured();
  for (const [path, bytes] of captured.source.bytes) write(root, path, bytes);
  write(root, SELF_HOST_MATRIX_TOOLCHAIN_MANIFEST_PATH, captured.toolchainManifestBytes);
  if (captured.documentBytes !== null) write(root, "docs/SELF_HOST_MATRIX.md", captured.documentBytes);
  return captured;
}

function dependencies(input: {
  readonly captured?: CapturedMatrixPackage;
  readonly mode?: "legacy-stampless" | "required-v1";
  readonly render?: MatrixRenderResult | ((call: number) => MatrixRenderResult | Promise<MatrixRenderResult>);
  readonly captureError?: Error;
  readonly assertCurrent?: () => void | Promise<void>;
  readonly publish?: (candidate: Uint8Array) => Uint8Array | Promise<Uint8Array>;
  readonly reread?: () => Uint8Array | null | Promise<Uint8Array | null>;
  readonly repositoryRoot?: string;
}) {
  const output: Uint8Array[] = [];
  const errors: string[] = [];
  const trace: string[] = [];
  const captured = input.captured ?? fakeCaptured(input.repositoryRoot ?? REPOSITORY_ROOT);
  let renderCalls = 0;
  const deps: MatrixControllerDependencies = {
    mode: input.mode ?? "legacy-stampless",
    repositoryRoot: input.repositoryRoot ?? captured.repositoryRoot,
    capture: async () => {
      trace.push("capture");
      if (input.captureError !== undefined) throw input.captureError;
      return captured;
    },
    render: async () => {
      trace.push("render");
      renderCalls += 1;
      if (typeof input.render === "function") return await input.render(renderCalls);
      return input.render ?? {
        ok: true,
        candidateBytes: document("candidate"),
        workerStdout: "",
        error: null,
      };
    },
    assertCurrent: async () => {
      trace.push("assert-current");
      await input.assertCurrent?.();
    },
    publish: async (_captured, candidate) => {
      trace.push("publish");
      return input.publish === undefined ? candidate : await input.publish(candidate);
    },
    reread: async () => {
      trace.push("reread");
      return input.reread === undefined ? captured.documentBytes : await input.reread();
    },
    stdout: (bytes) => output.push(Uint8Array.from(bytes)),
    stderr: (message) => errors.push(message),
  };
  return { deps, output, errors, trace, captured };
}

function onlyReceipt(output: readonly Uint8Array[]): MatrixControllerReceipt {
  expect(output).toHaveLength(1);
  return parseMatrixControllerReceipt(output[0]!);
}

function utf8Length(value: string): number {
  return new TextEncoder().encode(value).byteLength;
}

function transactionFixtureRender(
  captured: CapturedMatrixPackage,
  call: number,
  overrides: Readonly<{
    candidateBytes?: Uint8Array;
    rawFacetBytes?: Uint8Array;
    auditBytes?: Uint8Array;
    materializationRoot?: string;
    workerPid?: number;
  }> = {},
): MatrixRenderResult {
  const rows = Object.freeze([
    Object.freeze({
      fnId: "engine:llvmDomainToValType",
      categoryPresent: true,
      category: "engine-internal",
      tagsPresent: true,
      tags: Object.freeze(["engine", "internal", "llvm", "phase-21"]),
    }),
    Object.freeze({
      fnId: "std:.",
      categoryPresent: true,
      category: "function",
      tagsPresent: true,
      tags: Object.freeze(["function", "combinator", "operator", "higher-order"]),
    }),
  ]);
  const rawFacetBytes = overrides.rawFacetBytes ?? encodeCanonicalJson({
    schema: "fenel.self-host-matrix-raw-facets.v1",
    rows,
  });
  const rawFacets = decodeMatrixRawFacets(rawFacetBytes);
  const categoryPreimage = `fenel.self-host-matrix.category.v1\n2\n${rows.map((row) =>
    `${utf8Length(row.fnId)}:${row.fnId}${utf8Length(row.category)}:${row.category}\n`).join("")}`;
  const tagPreimage = `fenel.self-host-matrix.tags.v1\n2\n${rows.map((row) =>
    `${utf8Length(row.fnId)}:${row.fnId}${row.tags.length}\n${row.tags.map((tag) =>
      `${utf8Length(tag)}:${tag}`).join("")}\n`).join("")}`;
  const reportPath = repositoryRelativePath(
    "implementations/typescript/engine/scripts/self-host-matrix-report.fenel",
  );
  const rosterKeys = Array.from({ length: 41 }, (_value, index) => `fixture:${index}`);
  const auditBytes = overrides.auditBytes ?? encodeCanonicalJson({
    schema: "fenel.self-host-matrix-report-audit.v1",
    categoryCount: 2,
    categoryPreimage,
    categoryDigest: sha256Raw(categoryPreimage),
    tagCount: 2,
    tagPreimage,
    tagDigest: sha256Raw(tagPreimage),
    categorizableRepresentativeIds: ["engine:llvmDomainToValType", "std:."],
    taggableRepresentativeIds: ["engine:llvmDomainToValType", "std:."],
    rosterCount: 41,
    rosterKeys,
    acquisitionKeys: rosterKeys,
    rowCount: rows.length,
    declaredObservedAsymmetryCount: 0,
    declaredObservedAsymmetries: [],
    groupingFacts: [
      { fnId: "engine:llvmDomainToValType", area: "engine: LLVM helper" },
      { fnId: "std:.", area: "std:function" },
    ],
    reportSourceDigest: sha256Raw(captured.source.bytes.get(reportPath)!),
  });
  const audit = decodeMatrixReportAudit(
    auditBytes,
    sha256Raw(captured.source.bytes.get(reportPath)!),
  );
  return Object.freeze({
    ok: true,
    candidateBytes: overrides.candidateBytes ?? document("candidate"),
    workerStdout: "",
    error: null,
    evidence: Object.freeze({
      rawFacetBytes,
      auditBytes,
      rawFacets,
      audit,
      materializationRoot: overrides.materializationRoot
        ?? resolve(captured.repositoryRoot, `.fixture-matrix-render-${call}`),
      workerPid: overrides.workerPid ?? 1000 + call,
    }),
  });
}

test("render request binds the exact capture, progress bit, report source, and private outputs", () => {
  const captured = fakeCaptured(REPOSITORY_ROOT);
  const decoded = JSON.parse(new TextDecoder().decode(matrixRenderRequestBytes(captured, true)));
  const reportPath = repositoryRelativePath(
    "implementations/typescript/engine/scripts/self-host-matrix-report.fenel",
  );
  expect(decoded).toEqual({
    outputs: {
      audit: ".m4-private/audit.json",
      candidate: ".m4-private/candidate.md",
      rawFacets: ".m4-private/raw-facets.json",
    },
    presentation: {
      verified: captured.verified,
      verifiedAtSha: captured.verifiedAtSha,
    },
    progress: true,
    reportSource: reportPath,
    reportSourceDigest: sha256Raw(captured.source.bytes.get(reportPath)!),
    schema: "fenel.self-host-matrix-worker-request.v1",
    task: "render",
  });
});

test("private asymmetry diagnostics require an exact empty array for a zero audit", () => {
  const captured = fakeCaptured(REPOSITORY_ROOT);
  const basis = transactionFixtureRender(captured, 1).evidence!;
  const reportDigest = basis.audit.reportSourceDigest;
  const accepted = decodeMatrixReportAudit(basis.auditBytes, reportDigest);
  expect(accepted.declaredObservedAsymmetryCount).toBe(0);
  expect(accepted.declaredObservedAsymmetries).toEqual([]);
  expect(Object.isFrozen(accepted.declaredObservedAsymmetries)).toBe(true);

  const missing: Record<string, unknown> = { ...basis.audit };
  delete missing.declaredObservedAsymmetries;
  for (const hostile of [
    missing,
    { ...basis.audit, declaredObservedAsymmetries: null },
    { ...basis.audit, declaredObservedAsymmetries: {} },
    { ...basis.audit, declaredObservedAsymmetries: "[]" },
  ]) {
    expect(() => decodeMatrixReportAudit(encodeCanonicalJson(hostile), reportDigest))
      .toThrow("matrixReportAudit");
  }
});

test("private asymmetry diagnostics reject malformed entries before the nonzero audit gate", () => {
  const captured = fakeCaptured(REPOSITORY_ROOT);
  const basis = transactionFixtureRender(captured, 1).evidence!;
  const reportDigest = basis.audit.reportSourceDigest;
  const validEntry = { fnId: "std:silentSkip", target: "wasm", className: "silent-skip",
    declared: "samples=1, no gap", observed: "SKIP (source-owned reason)" };
  const malformed: unknown[] = [null, [], "entry", {}, { ...validEntry, extra: "unadmitted" },
    { ...validEntry, target: "js-extra" }, { ...validEntry, target: "JS" },
    { ...validEntry, className: "unacknowledged" }];
  for (const key of ["fnId", "target", "className", "declared", "observed"]) {
    const missing: Record<string, unknown> = { ...validEntry };
    delete missing[key];
    malformed.push(missing, { ...validEntry, [key]: "" }, { ...validEntry, [key]: 7 });
  }
  for (const entry of malformed) {
    expect(() => decodeMatrixReportAudit(encodeCanonicalJson({ ...basis.audit,
      declaredObservedAsymmetryCount: 1, declaredObservedAsymmetries: [entry],
    }), reportDigest)).toThrow("matrixReportAudit.declaredObservedAsymmetries[0]");
  }
});

test("private asymmetry diagnostics reject disagreement between source entries and count", () => {
  const captured = fakeCaptured(REPOSITORY_ROOT);
  const basis = transactionFixtureRender(captured, 1).evidence!;
  const reportDigest = basis.audit.reportSourceDigest;
  const entry = { fnId: "std:silentSkip", target: "js", className: "silent-skip",
    declared: "samples=1, no gap", observed: "SKIP (source-owned reason)" };
  for (const [count, entries] of [[0, [entry]], [1, []], [2, [entry]]]) {
    expect(() => decodeMatrixReportAudit(encodeCanonicalJson({ ...basis.audit,
      declaredObservedAsymmetryCount: count, declaredObservedAsymmetries: entries,
    }), reportDigest)).toThrow("matrix report audit asymmetry count differs from its source entries");
  }
});

test("private asymmetry diagnostics preserve exact source descriptions while every known failure class rejects", () => {
  const captured = fakeCaptured(REPOSITORY_ROOT);
  const basis = transactionFixtureRender(captured, 1).evidence!;
  const reportDigest = basis.audit.reportSourceDigest;
  const entries = [
    { fnId: "std:closedGap", target: "js", className: "stale-gap",
      declared: 'GAP ("source-owned 🦊 gap")', observed: "OK (1)" },
    { fnId: "std:silentSkip", target: "wasm", className: "silent-skip",
      declared: "samples=2, no gap", observed: "SKIP (source-owned Δ reason)" },
    { fnId: "std:escapedFail", target: "llvm", className: "escaped-fail",
      declared: "samples=1, no gap", observed: "FAIL (source-owned mismatch)" },
  ];
  for (const diagnostics of [...entries.map(entry => [entry]), entries]) {
    expect(() => decodeMatrixReportAudit(encodeCanonicalJson({ ...basis.audit,
      declaredObservedAsymmetryCount: diagnostics.length, declaredObservedAsymmetries: diagnostics,
    }), reportDigest)).toThrow(`matrix report audit contains declared/observed asymmetries: ${JSON.stringify(diagnostics)}`);
  }
});

test("render evidence decoders reject noncanonical facets and hostile audit relations", () => {
  const captured = fakeCaptured(REPOSITORY_ROOT);
  const basis = transactionFixtureRender(captured, 1);
  const evidence = basis.evidence!;
  expect(decodeMatrixRawFacets(evidence.rawFacetBytes)).toEqual(evidence.rawFacets);
  const reportPath = repositoryRelativePath(
    "implementations/typescript/engine/scripts/self-host-matrix-report.fenel",
  );
  const reportDigest = sha256Raw(captured.source.bytes.get(reportPath)!);
  expect(decodeMatrixReportAudit(evidence.auditBytes, reportDigest)).toEqual(evidence.audit);

  const rows = evidence.rawFacets.rows;
  for (const hostile of [
    [{ ...rows[0]!, categoryPresent: false }, rows[1]!],
    [{ ...rows[0]!, tagsPresent: false }, rows[1]!],
    [rows[1]!, rows[0]!],
    [rows[0]!, rows[0]!],
  ]) {
    expect(() => decodeMatrixRawFacets(encodeCanonicalJson({
      schema: evidence.rawFacets.schema,
      rows: hostile,
    }))).toThrow();
  }
  expect(decodeMatrixRawFacets(encodeCanonicalJson({
    schema: evidence.rawFacets.schema,
    rows: [
      {
        fnId: "absent",
        categoryPresent: false,
        category: "",
        tagsPresent: false,
        tags: [],
      },
      {
        fnId: "present-empty",
        categoryPresent: true,
        category: "",
        tagsPresent: true,
        tags: [],
      },
    ],
  })).rows[1]).toMatchObject({
    categoryPresent: true,
    category: "",
    tagsPresent: true,
    tags: [],
  });

  const audit = evidence.audit;
  for (const hostile of [
    { ...audit, categoryDigest: digest("f") },
    { ...audit, categoryPreimage: "wrong-domain\n2\n" },
    { ...audit, reportSourceDigest: digest("e") },
    { ...audit, declaredObservedAsymmetryCount: 1 },
    { ...audit, acquisitionKeys: audit.acquisitionKeys.slice(1) },
    { ...audit, rosterKeys: [...audit.rosterKeys, audit.rosterKeys[0]!] },
    { ...audit, categorizableRepresentativeIds: ["std:.", "engine:llvmDomainToValType"] },
    { ...audit, groupingFacts: [{ fnId: "std:.", area: "other" }] },
  ]) {
    expect(() => decodeMatrixReportAudit(encodeCanonicalJson(hostile), reportDigest)).toThrow();
  }
});

describe("self-host matrix controller orchestration", () => {
  test("module import is inert", () => {
    const target = pathToFileURL(resolve(HERE, "self-host-matrix-controller.ts")).href;
    const result = spawnSync(process.execPath, ["-e", `await import(${JSON.stringify(target)}); console.log("imported")`], {
      cwd: REPOSITORY_ROOT,
      encoding: "utf8",
    });
    expect(result.status).toBe(0);
    expect(result.stdout).toBe("imported\n");
    expect(result.stderr).toBe("");
  });

  test("present legacy-stampless artifact skips without a mint and emits one receipt", async () => {
    const fixture = dependencies({});
    const result = await runSelfHostMatrixController(["--decide", "--function-mints=0"], fixture.deps);
    expect(result.exitCode).toBe(0);
    expect(fixture.trace).toEqual(["capture"]);
    const receipt = onlyReceipt(fixture.output);
    expect(receipt.result).toBe("SKIPPED_LEGACY");
    expect(receipt.evidence).toBe("complete");
    expect(receipt.failureDigest).toBe(MATRIX_NO_FAILURE_DIGEST);
    expect(fixture.errors.join("\n")).toContain("NOT regenerated");
  });

  test("explicit skip consumes mint evidence before stable capture", async () => {
    const fixture = dependencies({});
    const result = await runSelfHostMatrixController([
      "--decide",
      "--function-mints=99",
      "--no-matrix",
    ], fixture.deps);
    expect(result.exitCode).toBe(0);
    expect(fixture.trace).toEqual([]);
    expect(onlyReceipt(fixture.output)).toMatchObject({
      evidence: "unavailable",
      decision: "SKIPPED_EXPLICIT",
      result: "SKIPPED_EXPLICIT",
      publication: { published: false },
    });
    expect(fixture.errors.join("\n")).toContain("NOT regenerated");
  });

  test("mint-selected and missing-artifact legacy branches stage then publish exactly once", async () => {
    for (const missing of [false, true]) {
      const captured = fakeCaptured(REPOSITORY_ROOT, missing ? null : document());
      const fixture = dependencies({ captured });
      const args = ["--decide", `--function-mints=${missing ? 0 : 1}`];
      const result = await runSelfHostMatrixController(args, fixture.deps);
      expect(result.exitCode).toBe(0);
      expect(fixture.trace).toEqual(["capture", "render", "assert-current", "publish"]);
      const receipt = onlyReceipt(fixture.output);
      expect(receipt.result).toBe("LEGACY_REPAIRED");
      expect(receipt.publication.published).toBe(true);
      expect(receipt.publication.candidate).toEqual(receipt.publication.after);
      expect(receipt.stampClass).toBe("absent");
    }
  });

  test("pre-publication drift cannot be reclassified as an ambiguous successful write", async () => {
    const root = temporaryRoot("fenel-matrix-prepublish-");
    write(root, "docs/SELF_HOST_MATRIX.md", document("same"));
    const captured = fakeCaptured(root, document("same"));
    const fixture = dependencies({
      repositoryRoot: root,
      captured,
      render: { ok: true, candidateBytes: document("same"), workerStdout: "", error: null },
      assertCurrent: () => {
        throw new Error("source drifted before publication");
      },
    });
    const result = await runSelfHostMatrixController([
      "--decide",
      "--function-mints=1",
    ], fixture.deps);
    expect(result.exitCode).toBe(1);
    expect(fixture.trace).toEqual(["capture", "render", "assert-current"]);
    expect(onlyReceipt(fixture.output)).toMatchObject({
      result: "REPAIR_FAILED",
      publication: { published: false },
    });
  });

  test("check always renders fresh, due, foreign, missing, and legacy-absent evidence without publishing", async () => {
    const current = stampedCaptured({ relation: "current", label: "current" });
    const foreign = stampedCaptured({ relation: "foreign", label: "foreign" });
    const inputsDue = stampedCaptured({ relation: "inputs-due", label: "inputs-due" });
    const bodyDue = stampedCaptured({ relation: "body-due", label: "body-due" });
    for (const [name, captured, candidate, expectedResult] of [
      ["fresh", current.captured, current.unstamped, "CHECK_OK"],
      ["foreign", foreign.captured, foreign.unstamped, "CHECK_OK"],
      ["inputs-due", inputsDue.captured, inputsDue.unstamped, "CHECK_OK"],
      ["body-due", bodyDue.captured, bodyDue.unstamped, "CHECK_OK"],
      ["missing", fakeCaptured(REPOSITORY_ROOT, null), document("new"), "DUE"],
      ["legacy-absent", fakeCaptured(REPOSITORY_ROOT, document()), replaceMatrixPresentation(document(), {
        verified: "2027-01-01",
        verifiedAtSha: "2222222",
      }), "CHECK_OK"],
    ] as const) {
      const fixture = dependencies({
        captured,
        render: { ok: true, candidateBytes: candidate, workerStdout: "", error: null },
      });
      const checked = await runSelfHostMatrixController(["--check"], fixture.deps);
      expect(fixture.trace, name).toEqual(["capture", "render"]);
      expect(onlyReceipt(fixture.output).result, name).toBe(expectedResult);
      expect(onlyReceipt(fixture.output).publication.published, name).toBe(false);
      expect(checked.exitCode, name).toBe(expectedResult === "CHECK_OK" ? 0 : 20);
    }

    const dueFixture = dependencies({});
    const due = await runSelfHostMatrixController(["--check"], dueFixture.deps);
    expect(due.exitCode).toBe(20);
    expect(dueFixture.trace).toEqual(["capture", "render"]);
    expect(onlyReceipt(dueFixture.output).result).toBe("DUE");

    const throwing = dependencies({ render: () => {
      throw new Error("render exploded");
    } });
    const failed = await runSelfHostMatrixController(["--check"], throwing.deps);
    expect(failed.exitCode).toBe(1);
    expect(onlyReceipt(throwing.output).result).toBe("CHECK_FAILED");
  });

  test("probe remains cheap even when a missing artifact is legacy-due", async () => {
    const fixture = dependencies({ captured: fakeCaptured(REPOSITORY_ROOT, null) });
    const result = await runSelfHostMatrixController(["--probe"], fixture.deps);
    expect(result.exitCode).toBe(20);
    expect(fixture.trace).toEqual(["capture"]);
    expect(onlyReceipt(fixture.output)).toMatchObject({
      decision: "LEGACY_DUE",
      result: "LEGACY_DUE",
      publication: { published: false },
    });
  });

  test("CLI and capture failures still emit one closed unavailable receipt", async () => {
    const cli = dependencies({});
    const cliResult = await runSelfHostMatrixController(["--probe", "--progress"], cli.deps);
    expect(cliResult.exitCode).toBe(2);
    expect(cli.trace).toEqual([]);
    expect(onlyReceipt(cli.output)).toMatchObject({
      evidence: "unavailable",
      operation: "invalid",
      result: "CLI_ERROR",
      stampClass: "malformed",
      inputsDigest: UNAVAILABLE_MATRIX_IDENTITY_DIGEST,
      environmentDigest: UNAVAILABLE_MATRIX_IDENTITY_DIGEST,
      bodyDigest: UNAVAILABLE_MATRIX_IDENTITY_DIGEST,
      certificateDigest: UNAVAILABLE_MATRIX_IDENTITY_DIGEST,
      controllerDigest: UNAVAILABLE_MATRIX_IDENTITY_DIGEST,
      packageDigest: UNAVAILABLE_MATRIX_IDENTITY_DIGEST,
      publication: {
        before: { kind: "absent" },
        candidate: { kind: "absent" },
        after: { kind: "absent" },
      },
    });

    const failed = dependencies({ captureError: new Error("watcher unsupported") });
    const failedResult = await runSelfHostMatrixController(["--probe"], failed.deps);
    expect(failedResult.exitCode).toBe(21);
    expect(failed.trace).toEqual(["capture"]);
    const receipt = onlyReceipt(failed.output);
    expect(receipt).toMatchObject({ evidence: "unavailable", result: "UNDECIDABLE" });
    expect(receipt.failureDigest).not.toBe(MATRIX_NO_FAILURE_DIGEST);
  });

  test("required-v1 decide/repair adoption from present/absent uses one capture and exactly two fresh renders", async () => {
    for (const operation of ["decide", "repair"] as const) {
      for (const initial of ["present", "absent"] as const) {
        const root = temporaryRoot(`fenel-matrix-required-v1-${operation}-${initial}-`);
        const before = initial === "present" ? document(`old-${operation}`) : null;
        const captured = fakeCaptured(root, before);
        let live: Uint8Array | null = before;
        const fixture = dependencies({
          captured,
          mode: "required-v1",
          repositoryRoot: root,
          render: (call) => {
            if (call > 2) throw new Error("attempted a forbidden third full render");
            return transactionFixtureRender(captured, call);
          },
          publish: (candidate) => {
            live = candidate;
            return candidate;
          },
          reread: () => live,
        });
        const result = await runSelfHostMatrixController([
          `--${operation}`,
          ...(operation === "decide" ? ["--function-mints=0"] : []),
          "--with-matrix",
          `--adopt-matrix-environment=${captured.environment.digest}`,
        ], fixture.deps);
        expect(result.exitCode).toBe(0);
        expect(fixture.trace).toEqual([
          "capture",
          "render",
          "render",
          "assert-current",
          "publish",
          "reread",
        ]);
        expect(onlyReceipt(fixture.output)).toMatchObject({
          mode: "required-v1",
          operation,
          decision: "REPAIR_REQUIRED",
          result: "REPAIRED",
          stampClass: "valid",
          publication: {
            before: initial === "present" ? { kind: "present" } : { kind: "absent" },
            published: true,
          },
        });
        expect(live).not.toBeNull();
        const sealed = parseMatrixDocument(live!);
        expect(sealed.stamp).toMatchObject({
          inputs: captured.inputs.digest,
          environment: captured.environment.digest,
          body: sealed.bodyDigest,
        });
      }
    }
  });

  test("required-v1 transaction fails closed at every render/reproduction boundary without publishing", async () => {
    const scenarios = [
      {
        name: "first failure",
        render: (_captured: CapturedMatrixPackage, call: number): MatrixRenderResult => call === 1
          ? { ok: false, candidateBytes: null, workerStdout: "", error: "worker A failed" }
          : transactionFixtureRender(_captured, call),
        renders: 1,
      },
      {
        name: "second failure",
        render: (_captured: CapturedMatrixPackage, call: number): MatrixRenderResult => call === 2
          ? { ok: false, candidateBytes: null, workerStdout: "", error: "worker B failed" }
          : transactionFixtureRender(_captured, call),
        renders: 2,
      },
      {
        name: "candidate mismatch",
        render: (_captured: CapturedMatrixPackage, call: number): MatrixRenderResult =>
          transactionFixtureRender(_captured, call, call === 2
            ? { candidateBytes: document("different candidate") }
            : {}),
        renders: 2,
      },
      {
        name: "audit mismatch",
        render: (_captured: CapturedMatrixPackage, call: number): MatrixRenderResult => {
          const basis = transactionFixtureRender(_captured, call);
          if (call !== 2 || basis.evidence === undefined) return basis;
          const categoryPreimage = `${basis.evidence.audit.categoryPreimage}opaque-B`;
          const audit = {
            ...basis.evidence.audit,
            categoryPreimage,
            categoryDigest: sha256Raw(categoryPreimage),
          };
          const auditBytes = encodeCanonicalJson(audit);
          return {
            ...basis,
            evidence: { ...basis.evidence, audit, auditBytes },
          };
        },
        renders: 2,
        expectedError: "produced different audit records",
      },
      {
        name: "first asymmetry audit",
        render: (_captured: CapturedMatrixPackage, call: number): MatrixRenderResult => {
          if (call !== 1) return transactionFixtureRender(_captured, call);
          const basis = transactionFixtureRender(_captured, call);
          const audit = { ...basis.evidence!.audit, declaredObservedAsymmetryCount: 1 };
          return {
            ...basis,
            evidence: { ...basis.evidence!, audit, auditBytes: encodeCanonicalJson(audit) },
          };
        },
        renders: 1,
      },
      {
        name: "audit representatives differ from raw facets",
        render: (_captured: CapturedMatrixPackage, call: number): MatrixRenderResult => {
          const basis = transactionFixtureRender(_captured, call);
          if (call !== 1) return basis;
          const categoryPreimage = "fenel.self-host-matrix.category.v1\n1\nfixture";
          const audit = {
            ...basis.evidence!.audit,
            categoryCount: 1,
            categoryPreimage,
            categoryDigest: sha256Raw(categoryPreimage),
            categorizableRepresentativeIds: ["std:."],
          };
          return {
            ...basis,
            evidence: { ...basis.evidence!, audit, auditBytes: encodeCanonicalJson(audit) },
          };
        },
        renders: 1,
      },
      {
        name: "raw mismatch",
        render: (_captured: CapturedMatrixPackage, call: number): MatrixRenderResult => {
          const basis = transactionFixtureRender(_captured, call);
          if (call !== 2 || basis.evidence === undefined) return basis;
          const rawFacets = {
            ...basis.evidence.rawFacets,
            rows: [
              basis.evidence.rawFacets.rows[0]!,
              {
                fnId: "fixture:absent",
                categoryPresent: false,
                category: "",
                tagsPresent: false,
                tags: [],
              },
              basis.evidence.rawFacets.rows[1]!,
            ],
          };
          const rawFacetBytes = encodeCanonicalJson(rawFacets);
          const audit = { ...basis.evidence.audit, rowCount: rawFacets.rows.length };
          const auditBytes = encodeCanonicalJson(audit);
          return {
            ...basis,
            evidence: { ...basis.evidence, rawFacets, rawFacetBytes, audit, auditBytes },
          };
        },
        renders: 2,
        expectedError: "produced different raw facet projections",
      },
      {
        name: "shared materialization",
        render: (_captured: CapturedMatrixPackage, call: number): MatrixRenderResult =>
          transactionFixtureRender(_captured, call, {
            materializationRoot: resolve(_captured.repositoryRoot, ".same-render-root"),
          }),
        renders: 2,
      },
      {
        name: "shared worker pid",
        render: (_captured: CapturedMatrixPackage, call: number): MatrixRenderResult =>
          transactionFixtureRender(_captured, call, { workerPid: 777 }),
        renders: 2,
      },
    ] as const;
    for (const scenario of scenarios) {
      const before = document(`old-${scenario.name}`);
      const captured = fakeCaptured(REPOSITORY_ROOT, before);
      const fixture = dependencies({
        captured,
        mode: "required-v1",
        render: (call) => scenario.render(captured, call),
        reread: () => before,
      });
      const result = await runSelfHostMatrixController([
        "--decide",
        "--function-mints=0",
        "--with-matrix",
        `--adopt-matrix-environment=${captured.environment.digest}`,
      ], fixture.deps);
      expect(result.exitCode, scenario.name).toBe(1);
      expect(fixture.trace.filter((entry) => entry === "render"), scenario.name).toHaveLength(
        scenario.renders,
      );
      expect(fixture.trace, scenario.name).not.toContain("publish");
      expect(fixture.trace, scenario.name).not.toContain("assert-current");
      expect(onlyReceipt(fixture.output).result, scenario.name).toBe("REPAIR_FAILED");
      if ("expectedError" in scenario) {
        expect(fixture.errors.join("\n"), scenario.name).toContain(scenario.expectedError);
      }
    }
  });

  test("required-v1 drift before replace preserves exact old bytes and forbids a third render", async () => {
    for (const timing of ["after-A", "after-B", "immediately-before-replace"] as const) {
      const before = document(`old-drift-${timing}`);
      const captured = fakeCaptured(REPOSITORY_ROOT, before);
      let drifted = false;
      const fixture = dependencies({
        captured,
        mode: "required-v1",
        render: (call) => {
          const rendered = transactionFixtureRender(captured, call);
          if (timing === "after-A" && call === 1) drifted = true;
          if (timing === "after-B" && call === 2) drifted = true;
          return rendered;
        },
        assertCurrent: () => {
          if (timing === "immediately-before-replace") drifted = true;
          if (drifted) throw new Error(`source drift ${timing}`);
        },
        reread: () => before,
      });
      const result = await runSelfHostMatrixController([
        "--decide",
        "--function-mints=0",
        "--with-matrix",
        `--adopt-matrix-environment=${captured.environment.digest}`,
      ], fixture.deps);
      expect(result.exitCode, timing).toBe(1);
      expect(fixture.trace, timing).toEqual([
        "capture",
        "render",
        "render",
        "assert-current",
        "reread",
      ]);
      expect(onlyReceipt(fixture.output), timing).toMatchObject({
        result: "REPAIR_FAILED",
        publication: { published: false },
      });
    }
  });

  test("required-v1 ambiguous publication accepts only the exact candidate after replacement", async () => {
    for (const exactCandidate of [true, false]) {
      const before = document(`old-ambiguous-${String(exactCandidate)}`);
      const captured = fakeCaptured(REPOSITORY_ROOT, before);
      let live = before;
      const fixture = dependencies({
        captured,
        mode: "required-v1",
        render: (call) => transactionFixtureRender(captured, call),
        publish: (candidate) => {
          live = exactCandidate ? candidate : document("third-party bytes");
          throw new Error("directory fsync failed after rename");
        },
        reread: () => live,
      });
      const result = await runSelfHostMatrixController([
        "--decide",
        "--function-mints=0",
        "--with-matrix",
        `--adopt-matrix-environment=${captured.environment.digest}`,
      ], fixture.deps);
      expect(result.exitCode, String(exactCandidate)).toBe(exactCandidate ? 0 : 21);
      expect(fixture.trace.filter((entry) => entry === "render")).toHaveLength(2);
      expect(onlyReceipt(fixture.output)).toMatchObject(exactCandidate
        ? { evidence: "complete", result: "REPAIRED", publication: { published: true } }
        : { evidence: "unavailable", result: "UNDECIDABLE", publication: { published: false } });
    }
  });

  test("required-v1 rename, fsync, and reread failures preserve closed publication states", async () => {
    for (const phase of ["rename", "fsync"] as const) {
      const before = document(`old-${phase}`);
      const captured = fakeCaptured(REPOSITORY_ROOT, before);
      const fixture = dependencies({
        captured,
        mode: "required-v1",
        render: (call) => transactionFixtureRender(captured, call),
        publish: () => {
          throw new Error(`${phase} failed before replacement`);
        },
        reread: () => before,
      });
      const result = await runSelfHostMatrixController([
        "--decide",
        "--function-mints=0",
        "--with-matrix",
        `--adopt-matrix-environment=${captured.environment.digest}`,
      ], fixture.deps);
      expect(result.exitCode, phase).toBe(1);
      expect(onlyReceipt(fixture.output), phase).toMatchObject({
        evidence: "complete",
        result: "REPAIR_FAILED",
        publication: { published: false },
      });
    }

    const before = document("old-reread");
    const captured = fakeCaptured(REPOSITORY_ROOT, before);
    const reread = dependencies({
      captured,
      mode: "required-v1",
      render: (call) => transactionFixtureRender(captured, call),
      reread: () => {
        throw new Error("exact reread failed");
      },
    });
    const result = await runSelfHostMatrixController([
      "--decide",
      "--function-mints=0",
      "--with-matrix",
      `--adopt-matrix-environment=${captured.environment.digest}`,
    ], reread.deps);
    expect(result.exitCode).toBe(21);
    expect(onlyReceipt(reread.output)).toMatchObject({
      evidence: "unavailable",
      result: "UNDECIDABLE",
      publication: { published: false },
    });
  });

  test("required-v1 kill boundaries leave either exact old bytes or the complete candidate", async () => {
    const before = document("old-kill-before");
    const capturedBefore = fakeCaptured(REPOSITORY_ROOT, before);
    const killedBefore = dependencies({
      captured: capturedBefore,
      mode: "required-v1",
      render: (call) => transactionFixtureRender(capturedBefore, call),
      assertCurrent: () => {
        throw new Error("injected kill immediately before replace");
      },
      reread: () => before,
    });
    const beforeResult = await runSelfHostMatrixController([
      "--decide",
      "--function-mints=0",
      "--with-matrix",
      `--adopt-matrix-environment=${capturedBefore.environment.digest}`,
    ], killedBefore.deps);
    expect(beforeResult.exitCode).toBe(1);
    expect(killedBefore.trace).not.toContain("publish");
    expect(onlyReceipt(killedBefore.output)).toMatchObject({
      result: "REPAIR_FAILED",
      publication: { published: false },
    });

    const capturedAfter = fakeCaptured(REPOSITORY_ROOT, document("old-kill-after"));
    let live = capturedAfter.documentBytes;
    const killedAfter = dependencies({
      captured: capturedAfter,
      mode: "required-v1",
      render: (call) => transactionFixtureRender(capturedAfter, call),
      publish: (candidate) => {
        live = candidate;
        throw new Error("injected kill immediately after successful replace");
      },
      reread: () => live,
    });
    const afterResult = await runSelfHostMatrixController([
      "--decide",
      "--function-mints=0",
      "--with-matrix",
      `--adopt-matrix-environment=${capturedAfter.environment.digest}`,
    ], killedAfter.deps);
    expect(afterResult.exitCode).toBe(0);
    expect(onlyReceipt(killedAfter.output)).toMatchObject({
      result: "REPAIRED",
      publication: { published: true },
    });
    expect(parseMatrixDocument(live!)).toMatchObject({ stampClass: "valid" });
  });

  test("stable capture re-arms a fresh watcher and rejects every covered input category", async () => {
    const presentation = {
      sourceCommit,
      verified: "2026-08-11",
      verifiedAtSha: sourceCommit.slice(0, 7),
    } as const;
    const stableRoot = temporaryRoot("fenel-matrix-live-stable-");
    const expected = materializeLiveCaptureFixture(stableRoot);
    let coldVerificationCount = 0;
    const verifyColdDependencies = async () => {
      coldVerificationCount += 1;
    };
    const stable = await captureMatrixPackage(stableRoot, {
      presentation,
      testDependencies: { watcherTimeoutMs: 2_000, verifyColdDependencies },
    });
    expect(coldVerificationCount).toBe(1);
    expect(stable.inputs.digest).toBe(expected.inputs.digest);
    expect(stable.dependencyManifestBytes).toEqual(expected.dependencyManifestBytes);
    expect(stable.dependencyProofDigest).toBe(expected.dependencyProofDigest);
    expect(stable.artifactBefore).toEqual(expected.artifactBefore);

    const coldFailureRoot = temporaryRoot("fenel-matrix-live-cold-failure-");
    materializeLiveCaptureFixture(coldFailureRoot);
    await expect(captureMatrixPackage(coldFailureRoot, {
      presentation,
      testDependencies: {
        watcherTimeoutMs: 2_000,
        verifyColdDependencies: async () => {
          throw new Error("fixture cold proof failed");
        },
      },
    })).rejects.toThrow("fixture cold proof failed");

    for (const [name, path] of [
      ["recursive-source", "fenel/package-fixture.fenel"],
      ["exact-input", ".fenel.lock"],
      ["toolchain", SELF_HOST_MATRIX_TOOLCHAIN_MANIFEST_PATH],
      ["artifact", "docs/SELF_HOST_MATRIX.md"],
    ] as const) {
      const root = temporaryRoot(`fenel-matrix-live-${name}-`);
      materializeLiveCaptureFixture(root);
      await expect(captureMatrixPackage(root, {
        presentation,
        testDependencies: {
          watcherTimeoutMs: 2_000,
          verifyColdDependencies,
          afterScan: async (phase) => {
            if (phase !== "A") return;
            const target = join(root, ...path.split("/"));
            writeFileSync(target, Buffer.concat([readFileSync(target), Buffer.from("# concurrent mutation\n")]));
          },
        },
      })).rejects.toThrow(/scans differ|changed during capture/u);
    }
  }, 20_000);

  test("stable matrix capture corroborates and deduplicates read-only change notifications outside identity", async () => {
    const presentation = {
      sourceCommit,
      verified: "2026-08-11",
      verifiedAtSha: sourceCommit.slice(0, 7),
    } as const;
    const quietRoot = temporaryRoot("fenel-matrix-v18-quiet-");
    materializeLiveCaptureFixture(quietRoot);
    const quietWatcher = fakeMatrixWatcher(quietRoot);
    const quiet = await captureMatrixPackage(quietRoot, {
      presentation,
      testDependencies: {
        ...quietWatcher.dependencies,
        verifyColdDependencies: async () => undefined,
      },
    });
    expect(quietWatcher.watchCount()).toBe(2);

    const changedRoot = temporaryRoot("fenel-matrix-v18-changed-");
    materializeLiveCaptureFixture(changedRoot);
    const changedWatcher = fakeMatrixWatcher(changedRoot);
    const reports: Array<readonly DismissedChangeEvent[]> = [];
    const changed = await captureMatrixPackage(changedRoot, {
      presentation,
      testDependencies: {
        ...changedWatcher.dependencies,
        verifyColdDependencies: async () => undefined,
        afterScan: (phase) => {
          if (phase !== "A") return;
          changedWatcher.emit("fenel/package-fixture.fenel");
          changedWatcher.emit("fenel/package-fixture.fenel");
        },
        reportDismissedChangeEvents: (events) => reports.push(events),
      },
    });
    expect(reports).toEqual([[{
      path: repositoryRelativePath("fenel/package-fixture.fenel"),
      count: 2,
    }]]);
    expect(changed.inputs.digest).toBe(quiet.inputs.digest);
    expect(changed.controllerDigest).toBe(quiet.controllerDigest);
    expect(changed.packageDigest).toBe(quiet.packageDigest);
  }, 20_000);

  test("stable matrix capture rejects silent witness drift and post-B byte or witness drift", async () => {
    const presentation = {
      sourceCommit,
      verified: "2026-08-11",
      verifiedAtSha: sourceCommit.slice(0, 7),
    } as const;
    const verifyColdDependencies = async () => undefined;
    for (const [name, path] of [
      ["source", "fenel/package-fixture.fenel"],
      ["toolchain", SELF_HOST_MATRIX_TOOLCHAIN_MANIFEST_PATH],
      ["artifact", "docs/SELF_HOST_MATRIX.md"],
    ] as const) {
      const root = temporaryRoot(`fenel-matrix-v18-witness-${name}-`);
      materializeLiveCaptureFixture(root);
      const watcher = fakeMatrixWatcher(root);
      await expect(captureMatrixPackage(root, {
        presentation,
        testDependencies: {
          ...watcher.dependencies,
          verifyColdDependencies,
          afterScan: (phase) => {
            if (phase !== "A") return;
            const target = join(root, ...path.split("/"));
            const stat = statSync(target);
            utimesSync(target, stat.atime, new Date(stat.mtimeMs + 2_000));
          },
        },
      })).rejects.toThrow(/witness scans differ/u);
    }

    for (const kind of ["bytes", "witness"] as const) {
      const root = temporaryRoot(`fenel-matrix-v18-post-b-${kind}-`);
      materializeLiveCaptureFixture(root);
      const watcher = fakeMatrixWatcher(root);
      const path = "fenel/package-fixture.fenel";
      await expect(captureMatrixPackage(root, {
        presentation,
        testDependencies: {
          ...watcher.dependencies,
          verifyColdDependencies,
          afterScan: (phase) => {
            if (phase !== "B") return;
            const target = join(root, ...path.split("/"));
            if (kind === "bytes") {
              writeFileSync(target, Buffer.concat([readFileSync(target), Buffer.from("# post-B\n")]));
            } else {
              const stat = statSync(target);
              utimesSync(target, stat.atime, new Date(stat.mtimeMs + 2_000));
            }
            watcher.emit(path);
          },
        },
      })).rejects.toThrow(/changed during capture/u);
    }
  }, 20_000);

  test("stable matrix watcher ignores directory metadata but rejects rename, absent-row, and late-error evidence", async () => {
    const presentation = {
      sourceCommit,
      verified: "2026-08-11",
      verifiedAtSha: sourceCommit.slice(0, 7),
    } as const;
    const verifyColdDependencies = async () => undefined;

    const directoryRoot = temporaryRoot("fenel-matrix-v18-directory-");
    materializeLiveCaptureFixture(directoryRoot);
    const directoryWatcher = fakeMatrixWatcher(directoryRoot);
    await expect(captureMatrixPackage(directoryRoot, {
      presentation,
      testDependencies: {
        ...directoryWatcher.dependencies,
        verifyColdDependencies,
        afterScan: (phase) => {
          if (phase === "B") directoryWatcher.emit("fenel", "change");
        },
      },
    })).resolves.toMatchObject({ inputs: { digest: expect.any(String) } });

    for (const kind of ["rename", "absent-row", "missing-row", "loss", "late-error", "close-error"] as const) {
      const root = temporaryRoot(`fenel-matrix-v18-${kind}-`);
      materializeLiveCaptureFixture(root);
      const watcher = fakeMatrixWatcher(root);
      if (kind === "close-error") watcher.failCloseAt(2);
      await expect(captureMatrixPackage(root, {
        presentation,
        testDependencies: {
          ...watcher.dependencies,
          verifyColdDependencies,
          afterScan: (phase) => {
            if (phase !== "B") return;
            if (kind === "rename") watcher.emit("fenel", "rename");
            if (kind === "absent-row") {
              write(root, "fenel/new-after-b.fenel", "new = true\n");
              watcher.emit("fenel/new-after-b.fenel", "change");
            }
            if (kind === "missing-row") watcher.emit("fenel/missing-after-b.fenel", "change");
            if (kind === "loss") watcher.emit(null, "change");
            if (kind === "late-error") watcher.error();
          },
        },
      })).rejects.toThrow(/changed during capture|watcher failed/u);
    }
  }, 20_000);

  test("final current assertion re-arms a watcher and rejects same-byte witness drift", async () => {
    const root = temporaryRoot("fenel-matrix-final-witness-");
    materializeLiveCaptureFixture(root);
    const captureWatcher = fakeMatrixWatcher(root);
    const captured = await captureMatrixPackage(root, {
      presentation: {
        sourceCommit,
        verified: "2026-08-11",
        verifiedAtSha: sourceCommit.slice(0, 7),
      },
      testDependencies: {
        ...captureWatcher.dependencies,
        verifyColdDependencies: async () => undefined,
      },
    });
    const target = resolve(root, "fenel/package-fixture.fenel");
    const before = new Uint8Array(readFileSync(target));
    const finalWatcher = fakeMatrixWatcher(root);
    await expect(assertCurrentMatrixPackage(captured, {
      ...finalWatcher.dependencies,
      sourceCommit: () => captured.sourceCommit,
      afterScan: (phase) => {
        if (phase !== "A") return;
        writeFileSync(target, before);
        utimesSync(target, new Date(1_000), new Date(1_000));
      },
    })).rejects.toThrow("race witness changed");
    expect(finalWatcher.watchCount()).toBe(1);
  }, 20_000);

  test("final current assertion dismisses only corroborated directory and file metadata changes", async () => {
    const root = temporaryRoot("fenel-matrix-final-corroborated-");
    materializeLiveCaptureFixture(root);
    const captureWatcher = fakeMatrixWatcher(root);
    const captured = await captureMatrixPackage(root, {
      presentation: {
        sourceCommit,
        verified: "2026-08-11",
        verifiedAtSha: sourceCommit.slice(0, 7),
      },
      testDependencies: {
        ...captureWatcher.dependencies,
        verifyColdDependencies: async () => undefined,
      },
    });
    const finalWatcher = fakeMatrixWatcher(root);
    const dismissed: DismissedChangeEvent[][] = [];
    await expect(assertCurrentMatrixPackage(captured, {
      ...finalWatcher.dependencies,
      sourceCommit: () => captured.sourceCommit,
      afterScan: (phase) => {
        if (phase !== "B") return;
        finalWatcher.emit("fenel", "change");
        finalWatcher.emit("fenel/package-fixture.fenel", "change");
      },
      reportDismissedChangeEvents: (events) => dismissed.push([...events]),
    })).resolves.toBeUndefined();
    expect(finalWatcher.watchCount()).toBe(1);
    expect(dismissed).toEqual([[
      { path: repositoryRelativePath("fenel/package-fixture.fenel"), count: 1 },
    ]]);
  }, 20_000);

  test("final current assertion rejects rename, missing, new, non-directory, and file drift events", async () => {
    for (const kind of [
      "directory-rename",
      "missing-change",
      "new-file-change",
      "directory-replaced",
      "file-byte-drift",
      "file-witness-drift",
      "directory-plus-file-drift",
    ] as const) {
      const root = temporaryRoot(`fenel-matrix-final-event-${kind}-`);
      materializeLiveCaptureFixture(root);
      const captureWatcher = fakeMatrixWatcher(root);
      const captured = await captureMatrixPackage(root, {
        presentation: {
          sourceCommit,
          verified: "2026-08-11",
          verifiedAtSha: sourceCommit.slice(0, 7),
        },
        testDependencies: {
          ...captureWatcher.dependencies,
          verifyColdDependencies: async () => undefined,
        },
      });
      const finalWatcher = fakeMatrixWatcher(root);
      const target = resolve(root, "fenel/package-fixture.fenel");
      await expect(assertCurrentMatrixPackage(captured, {
        ...finalWatcher.dependencies,
        sourceCommit: () => captured.sourceCommit,
        afterScan: (phase) => {
          if (phase !== "B") return;
          if (kind === "directory-rename") finalWatcher.emit("fenel", "rename");
          if (kind === "missing-change") {
            finalWatcher.emit("fenel/missing-after-scan.fenel", "change");
          }
          if (kind === "new-file-change") {
            write(root, "fenel/new-after-scan.fenel", "new = true\n");
            finalWatcher.emit("fenel/new-after-scan.fenel", "change");
          }
          if (kind === "directory-replaced") {
            rmSync(resolve(root, "fenel"), { recursive: true });
            writeFileSync(resolve(root, "fenel"), "not a directory\n");
            finalWatcher.emit("fenel", "change");
          }
          if (kind === "file-byte-drift" || kind === "directory-plus-file-drift") {
            writeFileSync(target, Buffer.concat([readFileSync(target), Buffer.from("# changed\n")]));
            if (kind === "directory-plus-file-drift") finalWatcher.emit("fenel", "change");
            finalWatcher.emit("fenel/package-fixture.fenel", "change");
          }
          if (kind === "file-witness-drift") {
            const bytes = readFileSync(target);
            writeFileSync(target, bytes);
            const stat = statSync(target);
            utimesSync(target, stat.atime, new Date(stat.mtimeMs + 2_000));
            finalWatcher.emit("fenel/package-fixture.fenel", "change");
          }
        },
      })).rejects.toThrow(/changed during final assertion/u);
      expect(finalWatcher.watchCount()).toBe(1);
    }
  }, 20_000);

  test("final current assertion directly rejects source, toolchain, artifact, and commit drift", async () => {
    for (const drift of ["source", "toolchain", "artifact", "commit"] as const) {
      const root = temporaryRoot(`fenel-matrix-final-${drift}-`);
      materializeLiveCaptureFixture(root);
      const captureWatcher = fakeMatrixWatcher(root);
      const captured = await captureMatrixPackage(root, {
        presentation: {
          sourceCommit,
          verified: "2026-08-11",
          verifiedAtSha: sourceCommit.slice(0, 7),
        },
        testDependencies: {
          ...captureWatcher.dependencies,
          verifyColdDependencies: async () => undefined,
        },
      });
      if (drift === "source") {
        writeFileSync(resolve(root, "fenel/package-fixture.fenel"), "(module changed)\n");
      } else if (drift === "toolchain") {
        writeFileSync(
          resolve(root, SELF_HOST_MATRIX_TOOLCHAIN_MANIFEST_PATH),
          Buffer.concat([captured.toolchainManifestBytes, Buffer.from("\n")]),
        );
      } else if (drift === "artifact") {
        writeFileSync(resolve(root, "docs/SELF_HOST_MATRIX.md"), document("changed before replace"));
      }
      const finalWatcher = fakeMatrixWatcher(root);
      await expect(assertCurrentMatrixPackage(captured, {
        ...finalWatcher.dependencies,
        sourceCommit: () => drift === "commit" ? "2".repeat(40) : captured.sourceCommit,
      })).rejects.toThrow(
        drift === "source"
          ? /source bytes changed|race witness changed/u
          : drift === "toolchain"
            ? /toolchain bytes changed|race witness changed/u
            : drift === "artifact"
              ? /artifact bytes changed|race witness changed/u
              : "source commit changed",
      );
      expect(finalWatcher.watchCount()).toBe(1);
    }
  }, 30_000);

  test("complete matrix leg rebinds the exact current artifact and derived identities", async () => {
    const fixture = dependencies({});
    await runSelfHostMatrixController(["--decide", "--function-mints=0"], fixture.deps);
    const receipt = onlyReceipt(fixture.output);
    const leg = await captureCurrentMatrixLeg(
      REPOSITORY_ROOT,
      receipt,
      async () => fixture.captured,
    );
    expect(leg.receiptDigest).toHaveLength(64);
    const mutated = fakeCaptured(REPOSITORY_ROOT, document("mutated"));
    await expect(captureCurrentMatrixLeg(
      REPOSITORY_ROOT,
      receipt,
      async () => mutated,
    )).rejects.toThrow("artifact identity");
    const presentationOnlyBytes = replaceMatrixPresentation(fixture.captured.documentBytes!, {
      verified: "2026-08-12",
      verifiedAtSha: sourceCommit.slice(0, 7),
    });
    expect(parseMatrixDocument(presentationOnlyBytes).bodyDigest).toBe(receipt.bodyDigest);
    expect(parseMatrixDocument(presentationOnlyBytes).certificateDigest).toBe(receipt.certificateDigest);
    await expect(captureCurrentMatrixLeg(
      REPOSITORY_ROOT,
      receipt,
      async () => fakeCaptured(REPOSITORY_ROOT, presentationOnlyBytes),
    )).rejects.toThrow("artifact identity");
    const crlfOnlyBytes = new TextEncoder().encode(
      new TextDecoder().decode(fixture.captured.documentBytes!).replaceAll("\n", "\r\n"),
    );
    expect(parseMatrixDocument(crlfOnlyBytes).bodyDigest).toBe(receipt.bodyDigest);
    expect(parseMatrixDocument(crlfOnlyBytes).certificateDigest).toBe(receipt.certificateDigest);
    await expect(captureCurrentMatrixLeg(
      REPOSITORY_ROOT,
      receipt,
      async () => fakeCaptured(REPOSITORY_ROOT, crlfOnlyBytes),
    )).rejects.toThrow("artifact identity");

    const before = fakeCaptured(REPOSITORY_ROOT, document("before-publication"));
    const afterBytes = document("after-publication");
    const published = dependencies({
      captured: before,
      render: { ok: true, candidateBytes: afterBytes, workerStdout: "", error: null },
    });
    await runSelfHostMatrixController(["--decide", "--function-mints=1"], published.deps);
    const publishedReceipt = onlyReceipt(published.output);
    expect(publishedReceipt.publication.published).toBe(true);
    expect((await captureCurrentMatrixLeg(
      REPOSITORY_ROOT,
      publishedReceipt,
      async () => fakeCaptured(REPOSITORY_ROOT, afterBytes),
    )).matrixLegDigest).toHaveLength(64);
  });

  test("absent and unavailable receipts still produce bound advisory matrix legs", async () => {
    const absentCaptured = fakeCaptured(REPOSITORY_ROOT, null);
    const absent = dependencies({
      captured: absentCaptured,
      render: { ok: false, candidateBytes: null, workerStdout: "", error: "failed" },
    });
    await runSelfHostMatrixController(["--decide", "--function-mints=0"], absent.deps);
    const absentReceipt = onlyReceipt(absent.output);
    expect(absentReceipt).toMatchObject({ evidence: "complete", result: "REPAIR_FAILED" });
    expect((await captureCurrentMatrixLeg(
      REPOSITORY_ROOT,
      absentReceipt,
      async () => absentCaptured,
    )).matrixLegDigest).toHaveLength(64);

    const unavailable = dependencies({ captureError: new Error("unavailable") });
    await runSelfHostMatrixController(["--probe"], unavailable.deps);
    const unavailableReceipt = onlyReceipt(unavailable.output);
    expect(unavailableReceipt.evidence).toBe("unavailable");
    const byteCurrent = packagedCaptured();
    let forbiddenFullCaptureCalls = 0;
    const byteOnlyLeg = await captureCurrentMatrixLeg(
      REPOSITORY_ROOT,
      unavailableReceipt,
      async () => {
        forbiddenFullCaptureCalls += 1;
        throw new Error("unavailable receipt must not retry a full matrix package");
      },
      async () => ({
        source: byteCurrent.source,
        toolchainManifestBytes: byteCurrent.toolchainManifestBytes,
        documentBytes: byteCurrent.documentBytes,
        dismissedChangeEvents: [],
      }),
    );
    expect(forbiddenFullCaptureCalls).toBe(0);
    expect(byteOnlyLeg.packageDigest).toBe(UNAVAILABLE_MATRIX_IDENTITY_DIGEST);
    expect(byteOnlyLeg.controllerDigest).toBe(byteCurrent.controllerDigest);
    expect(byteOnlyLeg.artifact).toEqual(byteCurrent.artifactBefore);
    await expect(captureCurrentMatrixLeg(
      REPOSITORY_ROOT,
      unavailableReceipt,
      async () => {
        throw new Error("unavailable receipt must not call full matrix capture");
      },
      async () => {
        throw new Error("stable matrix byte capture unavailable");
      },
    )).rejects.toThrow("stable matrix byte capture unavailable");
  });
});

describe("matrix capability guard and publication", () => {
  test("render guard binds one manifested request and exactly three private output writes", () => {
    const root = temporaryRoot("fenel-matrix-render-wire-guard-");
    mkdirSync(resolve(root, ".m4-private"));
    const trace = resolve(root, ".m3b-matrix-worker-guard.jsonl");
    const preload = resolve(root, ".m3b-matrix-worker-preload.ts");
    const target = resolve(root, "target.ts");
    const request = resolve(root, ".m4-matrix-worker-request.json");
    const requestBytes = encodeCanonicalJson({ schema: "fixture.render-request.v1" });
    const reportPath = "implementations/typescript/engine/scripts/self-host-matrix-report.fenel";
    const reportBytes = new TextEncoder().encode("module matrixreport where\n");
    const targetBytes = new TextEncoder().encode(`const { default: reportSource } = await import("./${reportPath}?raw");
if (typeof reportSource !== "string") throw new Error("missing report source");
const authorization = globalThis.__FENEL_SELF_HOST_MATRIX_WORKER_AUTHORIZATION__;
if (authorization?.task !== "render") throw new Error("missing render authorization");
const { readFileSync, writeFileSync } = require("node:fs");
const { dirname, resolve } = require("node:path");
readFileSync(authorization.requestPath);
for (const [name, value] of [["candidate.md", "candidate\\n"], ["raw-facets.json", "{}\\n"], ["audit.json", "{}\\n"]]) {
  writeFileSync(resolve(dirname(authorization.requestPath), ".m4-private", name), value, { flag: "wx" });
}
`);
    const preloadBytes = new TextEncoder().encode(matrixWorkerGuardSource(trace, target, {
      task: "render",
      requestPath: request,
      requestDigest: sha256Raw(requestBytes),
      outputPaths: [
        resolve(root, ".m4-private/candidate.md"),
        resolve(root, ".m4-private/raw-facets.json"),
        resolve(root, ".m4-private/audit.json"),
      ],
    }));
    writeFileSync(target, targetBytes);
    writeFileSync(preload, preloadBytes);
    writeFileSync(request, requestBytes);
    write(root, reportPath, reportBytes);
    const manifest = digestByteManifest("self-host-matrix-worker-runtime", [
      { path: repositoryRelativePath(".m3b-matrix-worker-preload.ts"), kind: "regular-file", byteLength: preloadBytes.byteLength, sha256: sha256Raw(preloadBytes) },
      { path: repositoryRelativePath(".m4-matrix-worker-request.json"), kind: "regular-file", byteLength: requestBytes.byteLength, sha256: sha256Raw(requestBytes) },
      { path: repositoryRelativePath(reportPath), kind: "regular-file", byteLength: reportBytes.byteLength, sha256: sha256Raw(reportBytes) },
      { path: repositoryRelativePath("target.ts"), kind: "regular-file", byteLength: targetBytes.byteLength, sha256: sha256Raw(targetBytes) },
    ]);
    writeFileSync(resolve(root, ".m3b-matrix-worker-manifest.json"), encodeCanonicalJson(manifest));
    const result = spawnSync(process.execPath, [
      "--no-install",
      "--preload",
      preload,
      target,
      `--worker-request=${request}`,
    ], { cwd: root, encoding: "utf8" });
    expect(result.status, result.stderr).toBe(0);
    expect(validateWorkerGuardTrace(root, "render", requestBytes)).toMatchObject({
      materializationRoot: realpathSync.native(root),
      workerPid: expect.any(Number),
    });
  });

  test("render certification admits zero or repeated exact shape-only probes", () => {
    const root = temporaryRoot("fenel-matrix-guard-zero-clang-probe-");
    const fixture = guardFixture(root, `console.log("no-probe");
`);
    const result = spawnSync(process.execPath, ["--no-install", "--preload", fixture.preload, fixture.target], {
      cwd: root,
      encoding: "utf8",
    });
    expect(result.status, result.stderr).toBe(0);
    expect(result.stdout).toBe("no-probe\n");
    expect(() => validateWorkerGuardTrace(root)).not.toThrow();

    const repeatedRoot = temporaryRoot("fenel-matrix-guard-repeated-clang-probe-");
    const repeated = guardFixture(repeatedRoot, `
for (let index = 0; index < 3; index += 1) {
  if (Bun.which("clang") !== null) throw new Error("shape-only clang probe was not absent");
}
`);
    const repeatedResult = spawnSync(
      process.execPath,
      ["--no-install", "--preload", repeated.preload, repeated.target],
      { cwd: repeatedRoot, encoding: "utf8" },
    );
    expect(repeatedResult.status, repeatedResult.stderr).toBe(0);
    expect(() => validateWorkerGuardTrace(repeatedRoot)).not.toThrow();
  });

  test("one captured package yields identical canonical report smoke from two fresh guarded materializations", async () => {
    const captured = await captureMatrixPackage(REPOSITORY_ROOT);
    const proof = await proveMatrixReportSmoke(captured);
    expect(proof.first.materializationRoot).not.toBe(proof.second.materializationRoot);
    expect(proof.first.workerPid).not.toBe(proof.second.workerPid);
    expect(proof.first.workerPid).toBeGreaterThan(0);
    expect(proof.second.workerPid).toBeGreaterThan(0);
    expect(proof.first.outputBytes).toEqual(proof.second.outputBytes);
    expect(new TextDecoder().decode(proof.first.outputBytes)).toBe(
      '{"bootDeficitDelta":0,"loadDepthBefore":0,"provenanceDelta":{"fenel":1,"ts":0},"result":"matrix-report-isolated-v1","schema":"fenel.self-host-matrix-report-smoke.v1"}\n',
    );
  }, 300_000);

  test("direct public worker selection has no preload authorization", () => {
    const generator = resolve(REPOSITORY_ROOT, SELF_HOST_MATRIX_GENERATOR_PATH);
    const request = resolve(REPOSITORY_ROOT, ".m4-matrix-worker-request.json");
    const result = spawnSync(process.execPath, [generator, `--worker-request=${request}`], {
      cwd: REPOSITORY_ROOT,
      env: {},
      encoding: "utf8",
    });
    expect(result.status).not.toBe(0);
    expect(result.stderr).toContain("authorization was not immutably injected by the preload");
  });

  test("tool report remains script-local and absent from product/roster registrations", () => {
    const generator = readFileSync(resolve(REPOSITORY_ROOT, SELF_HOST_MATRIX_GENERATOR_PATH), "utf8");
    const report = readFileSync(resolve(
      REPOSITORY_ROOT,
      "implementations/typescript/engine/scripts/self-host-matrix-report.fenel",
    ), "utf8");
    expect(report).not.toContain("module engine where");
    expect(generator.match(/self-host-matrix-report\.fenel\?raw/gu)).toHaveLength(1);
    for (const path of [
      "implementations/typescript/engine/src/module-manifest.ts",
      "implementations/typescript/engine/src/system-registry-modules.ts",
      "implementations/typescript/engine/src/system-entities.ts",
      "implementations/typescript/engine/src/repository-identity-manifest.ts",
      "implementations/typescript/engine/src/type-catalog.ts",
    ]) {
      expect(readFileSync(resolve(REPOSITORY_ROOT, ...path.split("/")), "utf8")).not.toContain(
        "self-host-matrix-report",
      );
    }
  });

  test("preload rejects even a caught Git read", () => {
    const root = temporaryRoot("fenel-matrix-guard-");
    const fixture = guardFixture(root, `import { execSync } from "node:child_process";
try { execSync("git rev-parse --short HEAD", { encoding: "utf8" }); } catch { console.log("unknown"); }
`);
    const result = spawnSync(process.execPath, ["--no-install", "--preload", fixture.preload, fixture.target], {
      cwd: root,
      encoding: "utf8",
    });
    expect(result.status).toBe(86);
    expect(result.stdout).toBe("unknown\n");
    expect(() => validateWorkerGuardTrace(root)).toThrow();
  });

  test("preload exposes only the declared shape-only clang probe", () => {
    const root = temporaryRoot("fenel-matrix-guard-shape-only-");
    const fixture = guardFixture(root, `console.log(String(Bun.which("clang")));
`);
    const result = spawnSync(process.execPath, ["--no-install", "--preload", fixture.preload, fixture.target], {
      cwd: root,
      encoding: "utf8",
    });
    expect(result.status).toBe(0);
    expect(result.stdout).toBe("null\n");
    expect(() => validateWorkerGuardTrace(root)).not.toThrow();
    expect(() => validateWorkerGuardTrace(root, "report-smoke")).toThrow(
      "invalid external-tool probe",
    );
    writeFileSync(
      resolve(root, ".m3b-matrix-worker-guard.jsonl"),
      '{"kind":"external-tool-probe","mode":"shape-only","result":"present","tool":"clang"}\n',
      { flag: "a" },
    );
    expect(() => validateWorkerGuardTrace(root)).toThrow("invalid external-tool probe");
  });

  test("shape-only prevents the production dynamic ESM FFI branch from loading", () => {
    const root = temporaryRoot("fenel-matrix-guard-shape-only-ffi-");
    const fixture = guardFixture(root, `if (Bun.which("clang") !== null) {
  const { dlopen: load } = await import("bun:ffi");
  load("missing-library", {});
}
console.log("shape-only");
`);
    const result = spawnSync(process.execPath, ["--no-install", "--preload", fixture.preload, fixture.target], {
      cwd: root,
      encoding: "utf8",
    });
    expect(result.status, result.stderr).toBe(0);
    expect(result.stdout).toBe("shape-only\n");
    expect(() => validateWorkerGuardTrace(root)).not.toThrow();
  });

  test("guard retains the sole deterministic crypto callable", () => {
    const root = temporaryRoot("fenel-matrix-guard-create-hash-");
    const fixture = guardFixture(root, `import { createHash } from "node:crypto";
console.log(createHash("sha256").update("stable").digest("hex"));
`);
    const result = spawnSync(process.execPath, ["--no-install", "--preload", fixture.preload, fixture.target], {
      cwd: root,
      encoding: "utf8",
    });
    expect(result.status, result.stderr).toBe(0);
    expect(result.stdout).toBe(`${sha256Raw("stable")}\n`);
    expect(() => validateWorkerGuardTrace(root)).not.toThrow();
  });

  test("matrix util.types.isProxy retains the native predicate without proxy traps or mutable slots", () => {
    const root = temporaryRoot("fenel-matrix-guard-is-proxy-");
    const fixture = guardFixture(root, `
const util = require("node:util");
const types = util.types;
const nativeIsProxy = types.isProxy;
let traps = 0;
const handler = Object.fromEntries(["get", "getPrototypeOf", "ownKeys", "getOwnPropertyDescriptor", "has", "isExtensible"]
  .map((key) => [key, () => { traps++; throw new Error("Proxy reflection trap: " + key); }]));
const revoked = Proxy.revocable({}, handler);
revoked.revoke();
const proxies = [new Proxy({}, handler), new Proxy([], handler), new Proxy(function () {}, handler), revoked.proxy];
const ordinary = [{}, [], function () {}, Object.create(null), null, undefined, 0, "plain", true];
const typesDescriptor = Object.getOwnPropertyDescriptor(util, "types");
const predicateDescriptor = Object.getOwnPropertyDescriptor(types, "isProxy");
const before = proxies.map((value) => nativeIsProxy(value));
const mutations = [
  Reflect.set(types, "isProxy", () => false), Reflect.deleteProperty(types, "isProxy"),
  Reflect.setPrototypeOf(types, {}), Reflect.set(types, "extra", true),
  Reflect.set(util, "types", {}), Reflect.deleteProperty(util, "types"), Reflect.setPrototypeOf(util, {}),
];
const { createHash } = require("node:crypto");
console.log(JSON.stringify({
  before, ordinary: ordinary.map((value) => nativeIsProxy(value)), after: proxies.map((value) => types.isProxy(value)), traps,
  typesFrozen: Object.isFrozen(types), utilFrozen: Object.isFrozen(util), typesNullPrototype: Object.getPrototypeOf(types) === null,
  typesKeys: Reflect.ownKeys(types),
  typesSlotLocked: typesDescriptor?.value === types && typesDescriptor.writable === false && typesDescriptor.configurable === false,
  predicateSlotLocked: predicateDescriptor?.value === nativeIsProxy && predicateDescriptor.writable === false && predicateDescriptor.configurable === false,
  nativeUnchanged: types.isProxy === nativeIsProxy, mutations,
  hashAfterSeal: createHash("sha256").update("stable").digest("hex"),
}));
`);
    const result = spawnSync(process.execPath, ["--no-install", "--preload", fixture.preload, fixture.target], {
      cwd: root,
      encoding: "utf8",
    });
    expect(result.status, result.stderr).toBe(0);
    expect(JSON.parse(result.stdout)).toEqual({
      before: [true, true, true, true], ordinary: Array(9).fill(false), after: [true, true, true, true], traps: 0,
      typesFrozen: true, utilFrozen: true, typesNullPrototype: true, typesKeys: ["isProxy"],
      typesSlotLocked: true, predicateSlotLocked: true, nativeUnchanged: true, mutations: Array(7).fill(false),
      hashAfterSeal: sha256Raw("stable"),
    });
    expect(() => validateWorkerGuardTrace(root)).not.toThrow();
    const trace = readFileSync(resolve(root, ".m3b-matrix-worker-guard.jsonl"), "utf8");
    expect(trace).not.toContain('"operation":"isProxy"');
  });

  test("matrix util.types.isProxy grant denies other util members and loader aliases", () => {
    const attempts = [
      { name: "node-util-member", source: 'void require("node:util").inspect;' },
      { name: "bare-util-member", source: 'void require("util").inspect;' },
      { name: "destructured-util-member", source: 'const { inspect } = require("node:util"); void inspect;' },
      { name: "other-util-type", source: 'void require("node:util").types.isDate;' },
      { name: "computed-util-type", source: 'const util = require("node:util"); void util["ty" + "pes"]["is" + "Date"];' },
      { name: "node-util-types-alias", source: 'void require("node:util/types").isProxy;' },
      { name: "bare-util-types-alias", source: 'void require("util/types").isProxy;' },
      { name: "dynamic-util-member", source: 'const util = await import("node:util"); void util.inspect;' },
      { name: "module-load-node-util", source: 'require("node:module")._load("node:util");' },
      { name: "module-load-bare-util", source: 'require("node:module")._load("util");' },
      { name: "module-load-util-types", source: 'require("node:module")._load("node:util/types");' },
    ] as const;
    for (const attempt of attempts) {
      const root = temporaryRoot(`fenel-matrix-guard-${attempt.name}-`);
      const fixture = guardFixture(root, `try { ${attempt.source} } catch { console.log("caught-util"); }\n`);
      const result = spawnSync(process.execPath, ["--no-install", "--preload", fixture.preload, fixture.target], {
        cwd: root,
        encoding: "utf8",
      });
      expect(result.status, `${attempt.name}: ${result.stderr}`).toBe(86);
      expect(result.stdout, attempt.name).toBe("caught-util\n");
      expect(() => validateWorkerGuardTrace(root)).toThrow();
      expect(readFileSync(resolve(root, ".m3b-matrix-worker-guard.jsonl"), "utf8"), attempt.name)
        .toContain('"kind":"capability-attempt"');
    }
  }, 20_000);

  test("a caught undeclared subprocess still hard-fails at process exit", () => {
    const root = temporaryRoot("fenel-matrix-guard-bad-");
    const fixture = guardFixture(root, `import { execSync } from "node:child_process";
try { execSync("echo hidden"); } catch { console.log("caught-hidden"); }
`);
    const result = spawnSync(process.execPath, ["--no-install", "--preload", fixture.preload, fixture.target], {
      cwd: root,
      encoding: "utf8",
    });
    expect(result.status).toBe(86);
    expect(result.stdout).toBe("caught-hidden\n");
    expect(() => validateWorkerGuardTrace(root)).toThrow();
  });

  test("caught Bun subprocess and FFI attempts also hard-fail at process exit", () => {
    const attempts = [
      {
        name: "bun-spawn",
        source: `try { Bun.spawnSync(["echo", "hidden"]); } catch { console.log("caught-bun"); }`,
        output: "caught-bun\n",
      },
      {
        name: "child-process-prototype-spawn",
        source: `const childProcess = require("node:child_process");
try { childProcess.ChildProcess.prototype.spawn.call({}, "echo", ["hidden"], {}); } catch { console.log("caught-prototype-spawn"); }`,
        output: "caught-prototype-spawn\n",
      },
      {
        name: "bun-mmap",
        source: `try { Bun.mmap("missing-file"); } catch { console.log("caught-mmap"); }`,
        output: "caught-mmap\n",
      },
      {
        name: "bun-dlopen",
        source: `const load = Bun["dl" + "open"];
try { load("missing-library", {}); } catch { console.log("caught-bun-dlopen"); }`,
        output: "caught-bun-dlopen\n",
      },
      {
        name: "bun-serve",
        source: `try { Bun.serve({ fetch() { return new Response("hidden"); } }); } catch { console.log("caught-serve"); }`,
        output: "caught-serve\n",
      },
      {
        name: "bun-which-undeclared",
        source: `try { Bun.which("llvm-as"); } catch { console.log("caught-which"); }`,
        output: "caught-which\n",
      },
      {
        name: "bun-random-uuid-v7",
        source: `try { Bun["randomUUID" + "v7"](); } catch { console.log("caught-bun-random"); }`,
        output: "caught-bun-random\n",
      },
      {
        name: "bun-shell",
        source: "try { await Bun.$`echo hidden`; } catch { console.log(\"caught-shell\"); }",
        output: "caught-shell\n",
      },
      {
        name: "ffi",
        source: `const ffi = require("bun:ffi");
try { ffi.dlopen("missing-library", {}); } catch { console.log("caught-ffi"); }`,
        output: "caught-ffi\n",
      },
      {
        name: "ffi-native",
        source: `const ffi = require("bun:ffi");
try { ffi.native.dlopen("missing-library", {}); } catch { console.log("caught-native-ffi"); }`,
        output: "caught-native-ffi\n",
      },
      {
        name: "ffi-native-computed",
        source: `try {
  const native = require("bun:ffi")["native"];
  const load = native["dl" + "open"];
  load("missing-library", {});
} catch { console.log("caught-native-computed"); }`,
        output: "caught-native-computed\n",
      },
      {
        name: "ffi-cc",
        source: `const ffi = require("bun:ffi");
try { ffi.cc({ source: "missing.c", symbols: {} }); } catch { console.log("caught-cc"); }`,
        output: "caught-cc\n",
      },
      {
        name: "ffi-computed-destructure",
        source: `const { dlopen: load } = require("bun:ffi");
try { load("missing-library", {}); } catch { console.log("caught-ffi-alias"); }`,
        output: "caught-ffi-alias\n",
      },
      {
        name: "ffi-constructor",
        source: `const { JSCallback } = require("bun:ffi");
try { new JSCallback(() => {}, { args: [], returns: "void" }); } catch { console.log("caught-ffi-constructor"); }`,
        output: "caught-ffi-constructor\n",
      },
      {
        name: "ffi-readable-suffix",
        source: `const ffi = require("bun:ffi");
try { console.log(ffi["suf" + "fix"]); } catch { console.log("caught-ffi-suffix"); }`,
        output: "caught-ffi-suffix\n",
      },
      {
        name: "ffi-readable-types",
        source: `const ffi = require("bun:ffi");
try { console.log(ffi["FFI" + "Type"]); } catch { console.log("caught-ffi-types"); }`,
        output: "caught-ffi-types\n",
      },
      {
        name: "ffi-dynamic-esm",
        source: `try {
  const { dlopen: load, suffix } = await import("bun:ffi");
  console.log(String(load) + suffix);
} catch { console.log("caught-ffi-esm"); }`,
        output: "caught-ffi-esm\n",
      },
      {
        name: "process-dlopen",
        source: `try { process.dlopen({}, "missing-library"); } catch { console.log("caught-process-dlopen"); }`,
        output: "caught-process-dlopen\n",
      },
      {
        name: "process-binding",
        source: `try { process.binding("spawn_sync"); } catch { console.log("caught-process-binding"); }`,
        output: "caught-process-binding\n",
      },
      {
        name: "process-report",
        source: `try { process.report["write" + "Report"]("../ambient.json"); } catch { console.log("caught-process-report"); }`,
        output: "caught-process-report\n",
      },
      {
        name: "math-random",
        source: `try { Math["ran" + "dom"](); } catch { console.log("caught-math-random"); }`,
        output: "caught-math-random\n",
      },
      {
        name: "navigator-platform",
        source: `try { console.log(navigator["plat" + "form"]); } catch { console.log("caught-navigator"); }`,
        output: "caught-navigator\n",
      },
      {
        name: "ambient-fs",
        source: `const fs = require("node:fs");
try { fs.accessSync("../ambient.txt"); } catch { console.log("caught-fs"); }`,
        output: "caught-fs\n",
      },
      {
        name: "worker-constructor",
        source: `try { new Worker("missing-worker.ts"); } catch { console.log("caught-worker"); }`,
        output: "caught-worker\n",
      },
      {
        name: "node-network",
        source: `const http = require("node:http");
try { http.get("http://127.0.0.1/"); } catch { console.log("caught-network"); }`,
        output: "caught-network\n",
      },
      {
        name: "crypto-keypair",
        source: `const crypto = require("node:crypto");
try { crypto.generateKeyPairSync("ed25519"); } catch { console.log("caught-keypair"); }`,
        output: "caught-keypair\n",
      },
      {
        name: "crypto-ecdh-computed",
        source: `const crypto = require("node:crypto");
try { crypto["create" + "ECDH"]("secp256k1"); } catch { console.log("caught-ecdh"); }`,
        output: "caught-ecdh\n",
      },
      {
        name: "crypto-webcrypto",
        source: `const crypto = require("node:crypto");
try { await crypto.webcrypto.subtle.generateKey({ name: "Ed25519" }, true, ["sign", "verify"]); } catch { console.log("caught-webcrypto"); }`,
        output: "caught-webcrypto\n",
      },
      {
        name: "crypto-direct-subtle",
        source: `const crypto = require("node:crypto");
try { await crypto.subtle["generate" + "Key"]({ name: "Ed25519" }, true, ["sign", "verify"]); } catch { console.log("caught-subtle"); }`,
        output: "caught-subtle\n",
      },
      {
        name: "crypto-readable-constants",
        source: `const crypto = require("node:crypto");
try { console.log(crypto["con" + "stants"]); } catch { console.log("caught-crypto-constants"); }`,
        output: "caught-crypto-constants\n",
      },
      {
        name: "crypto-prototype-random",
        source: `const crypto = globalThis.crypto;
const random = Object.getPrototypeOf(crypto)["getRandom" + "Values"];
try { random.call(crypto, new Uint8Array(1)); } catch { console.log("caught-crypto-prototype"); }`,
        output: "caught-crypto-prototype\n",
      },
      {
        name: "crypto-prototype-subtle",
        source: `const subtle = globalThis.crypto.subtle;
const generate = Object.getPrototypeOf(subtle)["generate" + "Key"];
try { await generate.call(subtle, { name: "Ed25519" }, true, ["sign", "verify"]); } catch { console.log("caught-subtle-prototype"); }`,
        output: "caught-subtle-prototype\n",
      },
      {
        name: "os-esm-alias",
        source: `import * as os from "node:os";
const hostname = os["host" + "name"];
try { hostname(); } catch { console.log("caught-os"); }`,
        output: "caught-os\n",
      },
      {
        name: "buffer-unsafe",
        source: `try { Buffer["alloc" + "Unsafe"](8); } catch { console.log("caught-buffer"); }`,
        output: "caught-buffer\n",
      },
    ] as const;
    for (const attempt of attempts) {
      const root = temporaryRoot(`fenel-matrix-guard-${attempt.name}-`);
      const fixture = guardFixture(root, `${attempt.source}\n`);
      const result = spawnSync(
        process.execPath,
        ["--no-install", "--preload", fixture.preload, fixture.target],
        { cwd: root, encoding: "utf8" },
      );
      expect(result.status, `${attempt.name}: ${result.stderr}`).toBe(86);
      expect(result.stdout).toBe(attempt.output);
      expect(() => validateWorkerGuardTrace(root)).toThrow();
    }
  }, 15_000);

  test("an upward ambient package may execute but can never certify", () => {
    const parent = temporaryRoot("fenel-matrix-upward-module-");
    const root = resolve(parent, "snapshot");
    mkdirSync(root);
    write(parent, "node_modules/ambient-matrix-fixture/package.json", JSON.stringify({
      name: "ambient-matrix-fixture",
      type: "module",
      exports: "./index.js",
    }));
    write(parent, "node_modules/ambient-matrix-fixture/index.js", "export default 'ambient-loaded';\n");
    const fixture = guardFixture(root, `import ambient from "ambient-matrix-fixture";
console.log(ambient);
`);
    const result = spawnSync(process.execPath, ["--no-install", "--preload", fixture.preload, fixture.target], {
      cwd: root,
      encoding: "utf8",
    });
    expect(result.stdout).toBe("ambient-loaded\n");
    expect(result.status).toBe(86);
    expect(() => validateWorkerGuardTrace(root)).toThrow();
  });

  test("immutable check package round-trips and rejects physical tampering", () => {
    const captured = packagedCaptured();
    const publish = (name: string): string => {
      const target = resolve(temporaryRoot(`fenel-matrix-${name}-`), "package");
      expect(writeMatrixCheckPackage(captured, target)).toBe(target);
      return target;
    };

    const intact = loadMatrixCheckPackage(REPOSITORY_ROOT, publish("intact"));
    expect(intact.packageDigest).toBe(captured.packageDigest);
    expect(intact.inputs.digest).toBe(captured.inputs.digest);
    expect(intact.environment.digest).toBe(captured.environment.digest);
    expect(intact.controllerDigest).toBe(captured.controllerDigest);
    expect(intact.artifactBefore).toEqual(captured.artifactBefore);
    expect(intact.dependencyManifestBytes).toEqual(captured.dependencyManifestBytes);
    expect(intact.dependencyProofDigest).toBe(captured.dependencyProofDigest);

    const sourceTamper = publish("source-tamper");
    writeFileSync(
      resolve(sourceTamper, "source", ...SELF_HOST_MATRIX_GENERATOR_PATH.split("/")),
      "// tampered source\n",
    );
    expect(() => loadMatrixCheckPackage(REPOSITORY_ROOT, sourceTamper)).toThrow();

    const importerTamper = publish("importer-tamper");
    const packageJsonPath = resolve(
      importerTamper,
      "source",
      "implementations/typescript/engine/package.json",
    );
    const packageJson = JSON.parse(readFileSync(packageJsonPath, "utf8"));
    writeFileSync(packageJsonPath, `${JSON.stringify({
      ...packageJson,
      dependencies: { "ambient-matrix-fixture": "1.0.0" },
    })}\n`);
    expect(() => loadMatrixCheckPackage(REPOSITORY_ROOT, importerTamper)).toThrow(/dependency|edge/u);

    const lockTamper = publish("lock-tamper");
    const lockPath = resolve(lockTamper, "source", "bun.lock");
    const lockBefore = readFileSync(lockPath, "utf8");
    const lock = JSON.parse(lockBefore);
    lock.workspaces["implementations/typescript/engine"].dependencies = {
      "ambient-matrix-fixture": "1.0.0",
    };
    const lockAfter = `${JSON.stringify(lock, null, 2)}\n`;
    expect(lockAfter).not.toBe(lockBefore);
    writeFileSync(lockPath, lockAfter);
    expect(() => loadMatrixCheckPackage(REPOSITORY_ROOT, lockTamper)).toThrow(/dependency|importer|lock/u);

    const artifactTamper = publish("artifact-tamper");
    writeFileSync(resolve(artifactTamper, "artifact", "SELF_HOST_MATRIX.md"), document("tampered"));
    expect(() => loadMatrixCheckPackage(REPOSITORY_ROOT, artifactTamper)).toThrow("artifact identity");

    const metadataTamper = publish("metadata-tamper");
    const metadataPath = resolve(metadataTamper, "metadata.json");
    writeFileSync(metadataPath, Buffer.concat([readFileSync(metadataPath), Buffer.from("\n")]));
    expect(() => loadMatrixCheckPackage(REPOSITORY_ROOT, metadataTamper)).toThrow();

    const dependencyManifestTamper = publish("dependency-manifest-tamper");
    writeFileSync(resolve(dependencyManifestTamper, "dependencies", "manifest.json"), "{}\n");
    expect(() => loadMatrixCheckPackage(REPOSITORY_ROOT, dependencyManifestTamper)).toThrow(
      "dependency manifest digest",
    );

    const namespaceTamper = publish("namespace-tamper");
    writeFileSync(resolve(namespaceTamper, "unowned.txt"), "unowned\n");
    expect(() => loadMatrixCheckPackage(REPOSITORY_ROOT, namespaceTamper)).toThrow("missing or extra entries");
  }, 15_000);

  test("production package checking fails closed when the cold dependency proof fails", async () => {
    const captured = packagedCaptured();
    const packageRoot = resolve(temporaryRoot("fenel-matrix-cold-package-"), "package");
    writeMatrixCheckPackage(captured, packageRoot);
    let verificationCount = 0;
    await expect(loadVerifiedMatrixCheckPackage(
      REPOSITORY_ROOT,
      packageRoot,
      async (input) => {
        verificationCount += 1;
        expect(input.dependencyManifestBytes).toEqual(captured.dependencyManifestBytes);
        expect(input.dependencyProofDigest).toBe(captured.dependencyProofDigest);
        throw new Error("fixture pinned Bun install failed");
      },
    )).rejects.toThrow("fixture pinned Bun install failed");
    expect(verificationCount).toBe(1);
  });

  test("matrix source acquisition admits only the owned node:util.types.isProxy CommonJS declaration", () => {
    const dispatchPath = "implementations/typescript/engine/src/engine-bodies-dispatch.ts";
    const declaration = 'const candidate = (require("node:util") as typeof import("node:util")).types.isProxy;';
    const crypto = 'const { createHash } = require("node:crypto") as typeof import("node:crypto");';
    const dynamic = '$ns[code] = new Function("$ns", `with($ns){ return (${body}); }`)($ns);';
    const body = [
      ...Array.from({ length: 6 }, () => `{ ${crypto} }`),
      declaration, dynamic, dynamic, "void Date.now();", "void Date.now();",
    ].join("\n");
    expect(readFileSync(resolve(REPOSITORY_ROOT, dispatchPath), "utf8")).toContain(declaration);
    const generator = packagedGenerator('void import("../src/engine-bodies-dispatch");');
    const positive = packagedCaptured(document(), generator, { [dispatchPath]: body });
    const positiveRoot = resolve(temporaryRoot("fenel-matrix-isproxy-owned-"), "package");
    expect(() => writeMatrixCheckPackage(positive, positiveRoot)).not.toThrow();
    expect(existsSync(resolve(positiveRoot, "source", dispatchPath))).toBe(true);

    for (const [name, changed] of [
      ["missing", body.replace(declaration, "")],
      ["other-member", body.replace(".types.isProxy;", ".types.isDate;")],
      ["types-escape", body.replace(".types.isProxy;", ".types;")],
      ["namespace-escape", body.replace(declaration, 'const candidate = require("node:util");')],
      ["renamed-binding", body.replace("const candidate =", "const escaped =")],
      ["computed-member", body.replace(".types.isProxy;", '["types"]["isProxy"];')],
      ["duplicate", `${body}\n{ ${declaration} }`],
      ["extra-acquisition", `${body}\nvoid require("node:util");`],
      ["comment-only", body.replace(declaration, `/* ${declaration} */`)],
      ["comment-spoof", body.replace(declaration, `/* ${declaration} */\nvoid require("node:util").inspect;`)],
      ["ESM-namespace", body.replace(declaration, 'import * as util from "node:util"; const candidate = util.types.isProxy;')],
      ["ESM-named", body.replace(declaration, 'import { types } from "node:util"; const candidate = types.isProxy;')],
      ["dynamic", body.replace(declaration, 'void import("node:util");')],
      ["re-export", body.replace(declaration, 'export { types } from "node:util";')],
      ["computed-specifier", body.replace('require("node:util")', 'require("node:" + "util")')],
      ["require-alias", body.replace(declaration, 'const load = require; const candidate = load("node:util").types.isProxy;')],
      ["bare-alias", body.replaceAll("node:util", "util")],
      ["types-subpath", body.replaceAll("node:util", "node:util/types")],
    ] as const) {
      const captured = packagedCaptured(document(), generator, { [dispatchPath]: changed });
      const packageRoot = resolve(temporaryRoot(`fenel-matrix-isproxy-${name}-`), "package");
      expect(() => writeMatrixCheckPackage(captured, packageRoot), name).toThrow();
      expect(existsSync(packageRoot), name).toBe(false);
    }
    const wrongPath = "implementations/typescript/engine/src/other-util.ts";
    const wrong = packagedCaptured(document(), packagedGenerator('void import("../src/other-util");'), {
      [wrongPath]: declaration,
    });
    const wrongRoot = resolve(temporaryRoot("fenel-matrix-isproxy-wrong-path-"), "package");
    expect(() => writeMatrixCheckPackage(wrong, wrongRoot)).toThrow();
    expect(existsSync(wrongRoot)).toBe(false);
  });

  test("static acquisition rejects loader, undeclared builtins, computed modules, and unpatchable Bun escapes before render", () => {
    for (const [name, extraSource] of [
      ["loader-cache", "void require.cache;"],
      ["computed-require", 'const ambientModule = "node:fs"; void require(ambientModule);'],
      ["module-namespace-alias", 'const m = module; const load = m["re" + "quire"]; load("bun:sqlite");'],
      ["module-require-destructure", 'const { "require": load } = module; load("bun:sqlite");'],
      ["module-object-spread", 'const copied = { ...module }; void copied["re" + "quire"];'],
      ["module-casing-isolation", 'const Module = {}; const load = module["re" + "quire"]; load("bun:sqlite");'],
      ["module-destructuring-default", "const { x = module } = {}; void x;"],
      ["module-type-arrow-boundary", 'type T = (module: string) => string\nvoid module["re" + "quire"];'],
      ["computed-constructor", '(((() => {}) as any)["con" + "structor"]("Bun.sleepSync(1)"))();'],
      ["asi-filesystem-alias", 'import "../src/package-fixture"\nconst list = readdirSync; list(".");'],
      ["bun-fetch", 'void Bun.fetch("https://example.invalid");'],
      ["bun-sqlite", 'void import("bun:sqlite");'],
      ["arbitrary-bun-ffi", 'void import("bun:ffi");'],
      ["arbitrary-node-os", 'void import("node:os");'],
      ["arbitrary-node-crypto", 'void require("node:crypto").generateKeyPairSync("ed25519");'],
      ["esm-node-crypto", 'import { generateKeyPairSync as generate } from "node:crypto"; void generate;'],
      ["computed-default-node-crypto", 'import crypto from "node:crypto"; void crypto["generate" + "KeyPairSync"];'],
      ["process-report", 'void process.report.writeReport("../ambient.json");'],
      ["host-current-time", "void Date.now();"],
      ["host-randomness", "void Math.random();"],
      ["host-directory-order", 'void readdirSync(".");'],
      ["host-locale-format", "void new Intl.Collator();"],
      ["host-locale-order", 'void "a".localeCompare("b");'],
      ["host-platform", "void navigator.platform;"],
      ["host-absolute-path", "void process.cwd();"],
    ] as const) {
      const captured = packagedCaptured(document(), packagedGenerator(extraSource));
      const packageRoot = resolve(temporaryRoot(`fenel-matrix-static-${name}-`), "package");
      expect(() => writeMatrixCheckPackage(captured, packageRoot)).toThrow();
      expect(existsSync(packageRoot)).toBe(false);
    }
  }, 30_000);

  test("matrix census admits only the existing exact registry-worker asset path occurrence", () => {
    const clientPath = "implementations/typescript/engine/src/field-identity-worker-client.ts";
    const assetPath = "implementations/typescript/engine/src/field-identity-worker.ts";
    const actual = readFileSync(resolve(REPOSITORY_ROOT, clientPath), "utf8");
    expect(censusSourceAcquisitions(repositoryRelativePath(clientPath), actual).hostSensitiveOperations
      .map(row => [String(row.path), row.kind])).toEqual([[clientPath, "absolute-path"]]);

    const client = `function prepare(): void {
  if (typeof Worker === "undefined") return;
  const worker = new Worker(new URL("./field-identity-worker.ts", import.meta.url), { type: "module" });
  void worker;
}\n`;
    const captured = packagedCaptured(document(), packagedGenerator('void import("../src/field-identity-worker-client");'), {
      [clientPath]: client,
      [assetPath]: "export {};\n",
    });
    const packageRoot = resolve(temporaryRoot("fenel-matrix-registry-worker-"), "package");
    expect(() => writeMatrixCheckPackage(captured, packageRoot)).not.toThrow();
    expect(existsSync(resolve(packageRoot, "source", assetPath))).toBe(true);
  });

  test("matrix registry-worker census still rejects extra path reads and asset drift before materialization", () => {
    const clientPath = "implementations/typescript/engine/src/field-identity-worker-client.ts";
    const assetPath = "implementations/typescript/engine/src/field-identity-worker.ts";
    const client = `function prepare(): void {
  if (typeof Worker === "undefined") return;
  const worker = new Worker(new URL("./field-identity-worker.ts", import.meta.url), { type: "module" });
  void worker;
}\n`;
    for (const [name, changed] of [
      ["extra module URL", `${client}\nvoid import.meta.url;`],
      ["extra cwd read", `${client}\nvoid process.cwd();`],
      ["different target", client.replace("./field-identity-worker.ts", "./other-worker.ts")],
      ["computed target", client.replace('"./field-identity-worker.ts"', "target")],
      ["different options", client.replace('type: "module"', 'type: "classic"')],
      ["missing availability probe", client.replace('typeof Worker === "undefined"', "false")],
      ["URL shadow", `const URL = String;\n${client}`],
    ]) {
      const captured = packagedCaptured(document(), packagedGenerator('void import("../src/field-identity-worker-client");'), {
        [clientPath]: changed!,
        [assetPath]: "export {};\n",
      });
      const packageRoot = resolve(temporaryRoot(`fenel-matrix-registry-worker-${name!.replaceAll(" ", "-")}-`), "package");
      expect(() => writeMatrixCheckPackage(captured, packageRoot)).toThrow();
      expect(existsSync(packageRoot)).toBe(false);
    }
  });

  test("builtin grant text in a comment cannot authorize a different executable import", () => {
    const exact = 'import { basename, dirname, isAbsolute, normalize, resolve } from "node:path";';
    const spoofed = packagedGenerator().replace(
      exact,
      `import * as path from "node:path";\n// ${exact}`,
    );
    const captured = packagedCaptured(document(), spoofed);
    const packageRoot = resolve(temporaryRoot("fenel-matrix-static-comment-forgery-"), "package");
    expect(() => writeMatrixCheckPackage(captured, packageRoot)).toThrow("not executable exact grants");
    expect(existsSync(packageRoot)).toBe(false);
  });

  test("matrix-only dynamic-code admission is exact by path, full statement, and count", () => {
    const classifierPath = "implementations/typescript/engine/src/compile-js-self-host-classifier.ts";
    const statement = 'new Function("$fenel", `return ${serialised._0};`)(runtime)';
    const generator = packagedGenerator('void import("../src/compile-js-self-host-classifier");');
    const classifier = `function fixtureHostSensitivityPins(): void {
  void performance.now();
  void performance.now();
}
export function bridge(serialised: any, runtime: any): unknown {
  return ${statement};
}\n`;
    const accepted = packagedCaptured(document(), generator, { [classifierPath]: classifier });
    const acceptedRoot = resolve(temporaryRoot("fenel-matrix-dynamic-accepted-"), "package");
    expect(writeMatrixCheckPackage(accepted, acceptedRoot)).toBe(acceptedRoot);

    for (const [name, sourceFiles, source] of [
      ["wrong-path", {
        "implementations/typescript/engine/src/other-classifier.ts": classifier,
      }, packagedGenerator('void import("../src/other-classifier");')],
      ["wrong-shape", {
        [classifierPath]: classifier.replace("serialised._0", "serialised._1"),
      }, generator],
      ["duplicate", {
        [classifierPath]: `${classifier}\n${classifier.replace("bridge", "bridgeAgain")}`,
      }, generator],
    ] as const) {
      const captured = packagedCaptured(document(), source, sourceFiles);
      const packageRoot = resolve(temporaryRoot(`fenel-matrix-dynamic-${name}-`), "package");
      expect(() => writeMatrixCheckPackage(captured, packageRoot)).toThrow();
      expect(existsSync(packageRoot)).toBe(false);
    }
  });

  test("the default controller renders an immutable package and never touches the live matrix", () => {
    const liveBefore = new Uint8Array(readFileSync(resolve(REPOSITORY_ROOT, "docs/SELF_HOST_MATRIX.md")));
    const stagedDocument = document();
    const generator = packagedGenerator("", stagedDocument);
    const captured = packagedCaptured(stagedDocument, generator);
    const packageRoot = resolve(temporaryRoot("fenel-matrix-default-package-"), "package");
    writeMatrixCheckPackage(captured, packageRoot);
    const controller = resolve(REPOSITORY_ROOT, SELF_HOST_MATRIX_CONTROLLER_PATH);
    const result = spawnSync(process.execPath, [controller, "--check", `--package=${packageRoot}`], {
      cwd: REPOSITORY_ROOT,
      encoding: "utf8",
      timeout: 120_000,
    });
    expect(result.status, result.stderr).toBe(0);
    expect(parseMatrixControllerReceipt(new TextEncoder().encode(result.stdout))).toMatchObject({
      operation: "check",
      result: "CHECK_OK",
      packageDigest: captured.packageDigest,
      publication: { published: false },
    });
    expect(new Uint8Array(readFileSync(resolve(REPOSITORY_ROOT, "docs/SELF_HOST_MATRIX.md")))).toEqual(liveBefore);
  }, 150_000);

  test("same-directory publication rereads exact candidate and leaves no temp", () => {
    const root = temporaryRoot("fenel-matrix-publish-");
    write(root, "docs/SELF_HOST_MATRIX.md", document("old"));
    const candidate = document("new");
    const committed = publishMatrixCandidateAtomically(root, candidate);
    expect(Buffer.from(committed).equals(Buffer.from(candidate))).toBe(true);
    expect(Buffer.from(readFileSync(resolve(root, "docs/SELF_HOST_MATRIX.md"))).equals(Buffer.from(candidate))).toBe(true);
    expect(readdirSync(resolve(root, "docs")).filter((name) => name.includes(".m3b-"))).toEqual([]);
  });
});
