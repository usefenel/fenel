import { afterEach, describe, expect, test } from "bun:test";
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import {
  RECOVERABLE_OUTPUT_EXCLUSIONS,
  repositoryRelativePath,
  type CapturedByteStore,
  type RepositoryRelativePath,
} from "./artifact-bytes";
import { compiledArtifactRecoveryStubs } from "./compiled-artifact-certificate";
import {
  materializeCompiledArtifactSnapshot,
  runCompiledArtifactSnapshotWorker,
  SNAPSHOT_LOADED_MODULE_CACHE_SOURCES,
  validateSnapshotTrace,
  type MaterializedCompiledArtifactSnapshot,
} from "./compiled-artifact-snapshot";
import {
  COMPILED_ARTIFACT_DECLARED_ABSENT_ENVIRONMENT_KEYS,
  COMPILED_ARTIFACT_FIXED_PRESENT_ENVIRONMENT_KEYS,
} from "./compiled-artifact-worker-policy";

const repositoryRoot = process.cwd();
const fixtureRoot = resolve(repositoryRoot, ".tmp-m3b-snapshot-tests");
const preloadPath = repositoryRelativePath(
  "implementations/typescript/engine/scripts/lib/compiled-artifact-worker-preload.ts",
);
const workerPolicyPath = repositoryRelativePath(
  "implementations/typescript/engine/scripts/lib/compiled-artifact-worker-policy.ts",
);
const resolverWorkerPath = repositoryRelativePath(
  "implementations/typescript/engine/scripts/generate-compiled-resolver-worker.ts",
);

function store(rows: ReadonlyMap<RepositoryRelativePath, Uint8Array>): CapturedByteStore {
  const paths = Object.freeze([...rows.keys()]);
  return Object.freeze({
    paths,
    has: (path: RepositoryRelativePath) => rows.has(path),
    read(path: RepositoryRelativePath): Uint8Array {
      const value = rows.get(path);
      if (value === undefined) throw new Error(`missing test byte ${path}`);
      return new Uint8Array(value);
    },
  });
}

function syntheticStore(
  extras: readonly (readonly [RepositoryRelativePath, string])[] = [],
): CapturedByteStore {
  const artifact = new TextEncoder().encode("export const SNAPSHOT_PROBE = 1;\n");
  const worker = new TextEncoder().encode(`
export async function runCompiledResolverWorkerMain() {
  const absent = process.env.FENEL_SIMULATE_BROWSER;
  if (absent !== undefined || process.env.NODE_ENV !== "production") throw new Error("bad worker env");
  process.stdout.write(JSON.stringify({
    schema: "fenel.compiled-artifact-render.v1",
    artifact: "compiled-resolver",
    bytesBase64: ${JSON.stringify(Buffer.from(artifact).toString("base64"))},
  }) + "\\n");
}
`);
  const rows = new Map<RepositoryRelativePath, Uint8Array>([
    [preloadPath, new Uint8Array(readFileSync(resolve(repositoryRoot, ...preloadPath.split("/"))))],
    [workerPolicyPath, new Uint8Array(readFileSync(resolve(repositoryRoot, ...workerPolicyPath.split("/"))))],
    [resolverWorkerPath, worker],
  ]);
  for (const [path, text] of extras) rows.set(path, new TextEncoder().encode(text));
  return store(rows);
}

function recoveryIsolationStore(): CapturedByteStore {
  const artifact = new TextEncoder().encode("export const SNAPSHOT_PROBE = 1;\n");
  const worker = new TextEncoder().encode(`
import "../src/generated/compiled-parser.build-certificate.json";
import "../src/generated/compiled-parser.generated.ts";
import "../src/generated/compiled-resolver.build-certificate.json";
import "../src/generated/compiled-resolver.generated.ts";
import "../src/generated/parse-cache.generated.ts";
import "../src/generated/signature-honesty-claims.json";
export async function runCompiledResolverWorkerMain() {
  process.stdout.write(JSON.stringify({
    schema: "fenel.compiled-artifact-render.v1",
    artifact: "compiled-resolver",
    bytesBase64: ${JSON.stringify(Buffer.from(artifact).toString("base64"))},
  }) + "\\n");
}
`);
  return store(new Map<RepositoryRelativePath, Uint8Array>([
    [preloadPath, new Uint8Array(readFileSync(resolve(repositoryRoot, ...preloadPath.split("/"))))],
    [workerPolicyPath, new Uint8Array(readFileSync(resolve(repositoryRoot, ...workerPolicyPath.split("/"))))],
    [resolverWorkerPath, worker],
    [
      repositoryRelativePath("implementations/typescript/engine/src/parse-cache-abi.ts"),
      new TextEncoder().encode("export const PARSE_CACHE_AST_ABI_VERSION = 4;\n"),
    ],
  ]));
}

function preloadReady(snapshot: MaterializedCompiledArtifactSnapshot): Record<string, unknown> {
  return {
    kind: "preload-ready",
    snapshotRoot: ".",
    manifestRows: snapshot.manifest.rows.length,
    resolverCoverage: "partial-runtime-hooks",
    primaryImportFence: "acquired-materialized-source-closure",
    fixedPresent: [...COMPILED_ARTIFACT_FIXED_PRESENT_ENVIRONMENT_KEYS],
    declaredAbsent: [...COMPILED_ARTIFACT_DECLARED_ABSENT_ENVIRONMENT_KEYS],
  };
}

function loadedModules(
  labels: readonly Readonly<Record<string, string>>[] = [],
): Record<string, unknown> {
  return {
    kind: "loaded-modules",
    mode: "detective",
    cacheSources: [...SNAPSHOT_LOADED_MODULE_CACHE_SOURCES],
    labels,
  };
}

function writeTrace(
  snapshot: MaterializedCompiledArtifactSnapshot,
  records: readonly Readonly<Record<string, unknown>>[],
): Uint8Array {
  const bytes = new TextEncoder().encode(`${records.map((record) => JSON.stringify(record)).join("\n")}\n`);
  writeFileSync(snapshot.tracePath, bytes);
  return bytes;
}

afterEach(() => {
  if (existsSync(fixtureRoot)) {
    const relative = fixtureRoot.slice(repositoryRoot.length + 1);
    if (relative !== ".tmp-m3b-snapshot-tests") throw new Error("unsafe fixture cleanup target");
    rmSync(fixtureRoot, { recursive: true, force: false });
  }
});

describe("compiled artifact snapshot", () => {
  test("launches one synthetic worker through the immutable preload fence", async () => {
    mkdirSync(fixtureRoot, { recursive: false });
    const snapshot = materializeCompiledArtifactSnapshot({
      repositoryRoot: fixtureRoot,
      artifact: "compiled-resolver",
      capturedBytes: syntheticStore(),
      nonce: "1111111111111111",
    });
    try {
      const result = await runCompiledArtifactSnapshotWorker({
        snapshot,
        bunExecutable: process.execPath,
      });
      expect(new TextDecoder().decode(result.bytes)).toBe("export const SNAPSHOT_PROBE = 1;\n");
      expect(new TextDecoder().decode(result.traceBytes)).toContain('"kind":"preload-ready"');
      expect(new TextDecoder().decode(result.traceBytes)).toContain('"kind":"loaded-modules"');
      expect(new TextDecoder().decode(result.traceBytes)).toContain('"kind":"env-absent"');
    } finally {
      snapshot.cleanup();
    }
    expect(existsSync(snapshot.root)).toBeFalse();
  });

  test("rejects a materialized row changed after creation", async () => {
    mkdirSync(fixtureRoot, { recursive: false });
    const snapshot = materializeCompiledArtifactSnapshot({
      repositoryRoot: fixtureRoot,
      artifact: "compiled-resolver",
      capturedBytes: syntheticStore(),
      nonce: "2222222222222222",
    });
    try {
      writeFileSync(snapshot.workerPath, "throw new Error('tampered');\n");
      await expect(runCompiledArtifactSnapshotWorker({
        snapshot,
        bunExecutable: process.execPath,
      })).rejects.toThrow("snapshot row differs from manifest");
    } finally {
      snapshot.cleanup();
    }
  });

  test("renders identically with invalid, throwing, hostile, and stale excluded live outputs", async () => {
    mkdirSync(fixtureRoot, { recursive: false });
    const expectedArtifact = "export const SNAPSHOT_PROBE = 1;\n";
    const stubs = compiledArtifactRecoveryStubs();
    expect(stubs.map(({ path }) => repositoryRelativePath(path))).toEqual(
      [...RECOVERABLE_OUTPUT_EXCLUSIONS].sort(),
    );
    const payloads: readonly (readonly [string, Uint8Array])[] = [
      ["invalid UTF-8 and syntax", Uint8Array.from([0xff, 0xfe, 0x7b, 0x0a])],
      ["top-level throw", new TextEncoder().encode('throw new Error("live output executed");\n')],
      ["hostile valid source", new TextEncoder().encode("process.exit(97);\n")],
      ["ordinary stale data", new TextEncoder().encode('{"ordinary":"stale"}\n')],
    ];

    for (const [index, [name, payload]] of payloads.entries()) {
      for (const path of RECOVERABLE_OUTPUT_EXCLUSIONS) {
        const target = resolve(fixtureRoot, ...path.split("/"));
        mkdirSync(resolve(target, ".."), { recursive: true });
        writeFileSync(target, payload);
      }
      const snapshot = materializeCompiledArtifactSnapshot({
        repositoryRoot: fixtureRoot,
        artifact: "compiled-resolver",
        capturedBytes: recoveryIsolationStore(),
        nonce: `${index + 7}`.repeat(16),
      });
      try {
        for (const stub of stubs) {
          const materialized = readFileSync(resolve(snapshot.root, ...stub.path.split("/")));
          expect(materialized, `${name}: ${stub.path}`).toEqual(Buffer.from(stub.bytes));
          expect(materialized, `${name}: ${stub.path}`).not.toEqual(Buffer.from(payload));
        }
        const result = await runCompiledArtifactSnapshotWorker({
          snapshot,
          bunExecutable: process.execPath,
        });
        expect(new TextDecoder().decode(result.bytes), name).toBe(expectedArtifact);
      } finally {
        snapshot.cleanup();
      }
    }
  }, 60_000);

  test("accepts a detective witness for a nested static manifest module and raw query", () => {
    mkdirSync(fixtureRoot, { recursive: false });
    const nested = repositoryRelativePath(
      "implementations/typescript/engine/scripts/nested/static-dependency.ts",
    );
    const raw = repositoryRelativePath(
      "implementations/typescript/engine/scripts/nested/body.fenel",
    );
    const snapshot = materializeCompiledArtifactSnapshot({
      repositoryRoot: fixtureRoot,
      artifact: "compiled-resolver",
      capturedBytes: syntheticStore([
        [nested, "export const nested = true;\n"],
        [raw, "module nested\n"],
      ]),
      nonce: "3333333333333333",
    });
    try {
      const trace = writeTrace(snapshot, [
        preloadReady(snapshot),
        loadedModules([
          { scope: "snapshot", value: `${raw}?raw` },
          { scope: "snapshot", value: nested },
        ]),
      ]);
      expect(() => validateSnapshotTrace(snapshot, trace)).not.toThrow();
    } finally {
      snapshot.cleanup();
    }
  });

  test("requires exactly one final loaded-modules witness", () => {
    mkdirSync(fixtureRoot, { recursive: false });
    const snapshot = materializeCompiledArtifactSnapshot({
      repositoryRoot: fixtureRoot,
      artifact: "compiled-resolver",
      capturedBytes: syntheticStore(),
      nonce: "4444444444444444",
    });
    try {
      const missing = writeTrace(snapshot, [preloadReady(snapshot)]);
      expect(() => validateSnapshotTrace(snapshot, missing)).toThrow(
        "exactly one loaded-modules event",
      );
      const duplicate = writeTrace(snapshot, [
        preloadReady(snapshot),
        loadedModules(),
        loadedModules(),
      ]);
      expect(() => validateSnapshotTrace(snapshot, duplicate)).toThrow(
        "exactly one loaded-modules event",
      );
    } finally {
      snapshot.cleanup();
    }
  });

  test("requires the exact fixed-present and declared-absent preload witnesses", () => {
    mkdirSync(fixtureRoot, { recursive: false });
    const snapshot = materializeCompiledArtifactSnapshot({
      repositoryRoot: fixtureRoot,
      artifact: "compiled-resolver",
      capturedBytes: syntheticStore(),
      nonce: "4545454545454545",
    });
    try {
      const valid = preloadReady(snapshot);
      for (const [field, rows] of [
        ["fixedPresent", COMPILED_ARTIFACT_FIXED_PRESENT_ENVIRONMENT_KEYS],
        ["declaredAbsent", COMPILED_ARTIFACT_DECLARED_ABSENT_ENVIRONMENT_KEYS],
      ] as const) {
        for (const changed of [
          rows.slice(1),
          [...rows, "UNDECLARED"],
          [...rows].reverse(),
        ]) {
          const trace = writeTrace(snapshot, [
            { ...valid, [field]: changed },
            loadedModules(),
          ]);
          expect(() => validateSnapshotTrace(snapshot, trace)).toThrow(
            `snapshot preload-ready ${field} differs from the exact worker policy`,
          );
        }
      }
    } finally {
      snapshot.cleanup();
    }
  });

  test("uses the shared detective builtin policy including preload fs/promises", () => {
    mkdirSync(fixtureRoot, { recursive: false });
    const snapshot = materializeCompiledArtifactSnapshot({
      repositoryRoot: fixtureRoot,
      artifact: "compiled-resolver",
      capturedBytes: syntheticStore(),
      nonce: "4646464646464646",
    });
    try {
      const allowed = writeTrace(snapshot, [
        preloadReady(snapshot),
        loadedModules([{ scope: "builtin", value: "node:fs/promises" }]),
      ]);
      expect(() => validateSnapshotTrace(snapshot, allowed)).not.toThrow();

      const denied = writeTrace(snapshot, [
        preloadReady(snapshot),
        loadedModules([{ scope: "builtin", value: "node:worker_threads" }]),
      ]);
      expect(() => validateSnapshotTrace(snapshot, denied)).toThrow(
        "not an approved snapshot builtin",
      );
    } finally {
      snapshot.cleanup();
    }
  });

  test("refuses outside upward-package and non-file loaded-module labels", () => {
    mkdirSync(fixtureRoot, { recursive: false });
    const snapshot = materializeCompiledArtifactSnapshot({
      repositoryRoot: fixtureRoot,
      artifact: "compiled-resolver",
      capturedBytes: syntheticStore(),
      nonce: "5555555555555555",
    });
    try {
      const outside = writeTrace(snapshot, [
        preloadReady(snapshot),
        loadedModules([{ scope: "outside", value: "<redacted>" }]),
      ]);
      expect(() => validateSnapshotTrace(snapshot, outside)).toThrow("outside module");

      const data = writeTrace(snapshot, [
        preloadReady(snapshot),
        loadedModules([{ scope: "snapshot", value: "data:text/javascript,export{}" }]),
      ]);
      expect(() => validateSnapshotTrace(snapshot, data)).toThrow(
        "not a snapshot-relative file reference",
      );
    } finally {
      snapshot.cleanup();
    }
  });

  test("re-reads loaded bytes and rejects recursive unmanifested entries", () => {
    mkdirSync(fixtureRoot, { recursive: false });
    const snapshot = materializeCompiledArtifactSnapshot({
      repositoryRoot: fixtureRoot,
      artifact: "compiled-resolver",
      capturedBytes: syntheticStore(),
      nonce: "6666666666666666",
    });
    try {
      writeFileSync(snapshot.workerPath, "export const changed = true;\n");
      const changed = writeTrace(snapshot, [
        preloadReady(snapshot),
        loadedModules([{ scope: "snapshot", value: resolverWorkerPath }]),
      ]);
      expect(() => validateSnapshotTrace(snapshot, changed)).toThrow(
        "loaded module differs from manifest",
      );

      writeFileSync(
        snapshot.workerPath,
        syntheticStore().read(resolverWorkerPath),
      );
      const mismatchedRead = writeTrace(snapshot, [
        preloadReady(snapshot),
        {
          kind: "read",
          path: resolverWorkerPath,
          digest: "0".repeat(64),
        },
        loadedModules(),
      ]);
      expect(() => validateSnapshotTrace(snapshot, mismatchedRead)).toThrow(
        "digest differs from manifest",
      );

      const rogueDirectory = resolve(snapshot.root, "implementations/typescript/engine/scripts/nested");
      mkdirSync(rogueDirectory, { recursive: true });
      writeFileSync(resolve(rogueDirectory, "upward-package.js"), "export {};\n");
      const recursive = writeTrace(snapshot, [preloadReady(snapshot), loadedModules()]);
      expect(() => validateSnapshotTrace(snapshot, recursive)).toThrow(
        "unmanifested recursive entry",
      );
    } finally {
      snapshot.cleanup();
    }
  });
});
