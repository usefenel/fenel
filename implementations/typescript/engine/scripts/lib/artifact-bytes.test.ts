import { afterEach, describe, expect, test } from "bun:test";
import {
  mkdirSync,
  mkdtempSync,
  openSync,
  closeSync,
  readFileSync,
  readdirSync,
  renameSync,
  rmSync,
  symlinkSync,
  statSync,
  unlinkSync,
  utimesSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, relative } from "node:path";
import {
  ENVIRONMENT_ONLY_OWNER_INPUTS,
  RECOVERABLE_OUTPUT_EXCLUSIONS,
  REPOSITORY_BYTE_UNIVERSE,
  REPOSITORY_EXACT_FILES,
  REPOSITORY_RECURSIVE_ROOTS,
  captureStableEpoch,
  compareUtf8Paths,
  computeOwnerEpoch,
  digestByteManifest,
  parseSha256Hex,
  repositoryRelativePath,
  sha256Raw,
  type ArtifactByteWatcherHandlers,
  type ArtifactBytesTestDependencies,
  type ByteManifestRow,
  type RepositoryRelativePath,
  type Sha256Hex,
} from "./artifact-bytes";

const temporaryRoots: string[] = [];

afterEach(() => {
  for (const root of temporaryRoots.splice(0)) {
    rmSync(root, { recursive: true, force: true });
  }
});

function write(root: string, path: string, bytes: string | Uint8Array): void {
  const absolute = join(root, ...path.split("/"));
  mkdirSync(dirname(absolute), { recursive: true });
  writeFileSync(absolute, bytes);
}

function fixture(): string {
  const root = mkdtempSync(join(tmpdir(), "fenel-artifact-bytes-"));
  temporaryRoots.push(root);
  for (const path of REPOSITORY_EXACT_FILES) write(root, path, `${path}\n`);
  write(root, "fenel/.ignored-by-git.fenel", "ignored but covered\n");
  write(root, "fenel/modules/a.fenel", "a = 1\n");
  write(root, "fenel/modules/z.fenel", "z = 2\r\n");
  write(root, "implementations/typescript/engine/src/core.ts", "export const core = 1;\n");
  write(
    root,
    "implementations/typescript/engine/src/generated/parser-bootstrap.generated.ts",
    "export const BOOTSTRAP = 1;\n",
  );
  write(
    root,
    "implementations/typescript/engine/src/generated/repository-identity-manifest.json",
    "{}\n",
  );
  for (const path of RECOVERABLE_OUTPUT_EXCLUSIONS) write(root, path, `excluded ${path}\n`);
  write(
    root,
    "implementations/typescript/engine/scripts/generate-compiled-parser.ts",
    "export const owner = 'parser';\n",
  );
  write(
    root,
    "implementations/typescript/engine/scripts/lib/shared.ts",
    "export const shared = true;\n",
  );
  write(root, ENVIRONMENT_ONLY_OWNER_INPUTS[0]!, "{}\n");
  write(root, ".gitignore", "fenel/.ignored-by-git.fenel\n");
  return root;
}

function backdateFixtureAtimes(root: string): void {
  const visit = (directory: string): void => {
    for (const entry of readdirSync(directory, { withFileTypes: true })) {
      const absolute = join(directory, entry.name);
      if (entry.isDirectory()) {
        visit(absolute);
        continue;
      }
      if (!entry.isFile()) continue;
      const stat = statSync(absolute);
      utimesSync(absolute, new Date(stat.atimeMs - 2 * 60 * 60 * 1_000), stat.mtime);
    }
  };
  visit(root);
}

function relativePath(root: string, absolutePath: string): RepositoryRelativePath {
  return repositoryRelativePath(relative(root, absolutePath).replaceAll("\\", "/"));
}

interface FakeWatchHarness {
  readonly dependencies: ArtifactBytesTestDependencies;
  readonly watchCount: () => number;
  emit(path: string | Uint8Array | null, eventType?: "rename" | "change"): void;
  error(): void;
}

function fakeWatcher(root: string): FakeWatchHarness {
  let handlers: ArtifactByteWatcherHandlers | undefined;
  let watches = 0;
  const emitAbsolute = (absolutePath: string): void => {
    handlers?.event("rename", relativePath(root, absolutePath));
  };
  return {
    dependencies: {
      nonce: () => "0123456789abcdef",
      watchFactory: (_repositoryRoot, nextHandlers) => {
        watches += 1;
        handlers = nextHandlers;
        return {
          close: async () => {
            if (handlers === nextHandlers) handlers = undefined;
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
      sentinelTimeoutMs: 100,
    },
    watchCount: () => watches,
    emit: (path, eventType = "change") => handlers?.event(eventType, path),
    error: () => handlers?.error(new Error("injected watcher failure")),
  };
}

function row(path: string, bytes: string): ByteManifestRow {
  return {
    path: repositoryRelativePath(path),
    kind: "regular-file",
    byteLength: Buffer.byteLength(bytes),
    sha256: sha256Raw(bytes),
  };
}

const plainPaths = (paths: readonly RepositoryRelativePath[]): readonly string[] =>
  paths.map((path) => String(path));

describe("artifact byte canonicalization", () => {
  test("freezes the exact M3b common universe", () => {
    expect(plainPaths(REPOSITORY_RECURSIVE_ROOTS)).toEqual([
      "fenel",
      "implementations/typescript/engine/src",
    ]);
    expect(plainPaths(REPOSITORY_EXACT_FILES)).toEqual([
      ".fenel.lock",
      ".gitattributes",
      "package.json",
      "bun.lock",
      "patches/@solidjs%2Fsignals@2.0.0-rc.7.patch",
      "tsconfig.base.json",
      "implementations/typescript/engine/package.json",
      "implementations/typescript/engine/tsconfig.json",
    ]);
    expect(plainPaths(RECOVERABLE_OUTPUT_EXCLUSIONS)).toEqual([
      "implementations/typescript/engine/src/generated/parse-cache.generated.ts",
      "implementations/typescript/engine/src/generated/signature-honesty-claims.json",
      "implementations/typescript/engine/src/generated/compiled-parser.generated.ts",
      "implementations/typescript/engine/src/generated/compiled-resolver.generated.ts",
      "implementations/typescript/engine/src/generated/compiled-parser.build-certificate.json",
      "implementations/typescript/engine/src/generated/compiled-resolver.build-certificate.json",
    ]);
    expect(REPOSITORY_BYTE_UNIVERSE).toEqual({
      recursiveRoots: REPOSITORY_RECURSIVE_ROOTS,
      exactFiles: REPOSITORY_EXACT_FILES,
      exclusions: RECOVERABLE_OUTPUT_EXCLUSIONS,
    });
    expect(Object.isFrozen(REPOSITORY_BYTE_UNIVERSE)).toBe(true);
    expect(Object.isFrozen(REPOSITORY_EXACT_FILES)).toBe(true);
  });

  test("hashes raw bytes and orders paths by UTF-8 bytes", () => {
    expect(sha256Raw("x\n")).not.toBe(sha256Raw("x\r\n"));
    expect(sha256Raw(Uint8Array.from([0, 255]))).toBe(parseSha256Hex(
      "06eb7d6a69ee19e5fbdf749018d3d2abfa04bcbd1365db312eb86dc7169389b8",
    ));
    const manifest = digestByteManifest("fixture", [
      row("fenel/ä", "5"),
      row("fenel/z", "3"),
      row("fenel/á", "4"),
      row("fenel/aa", "2"),
      row("fenel/A", "1"),
    ]);
    expect(plainPaths(manifest.rows.map(({ path }) => path))).toEqual([
      "fenel/A",
      "fenel/aa",
      "fenel/z",
      "fenel/á",
      "fenel/ä",
    ]);
    expect(compareUtf8Paths(repositoryRelativePath("fenel/z"), repositoryRelativePath("fenel/á")))
      .toBeLessThan(0);
  });

  test("rejects nonportable, duplicate, and case-only ambiguous paths", () => {
    expect(() => repositoryRelativePath("../fenel/a")).toThrow();
    expect(() => repositoryRelativePath("fenel\\a")).toThrow();
    expect(() => repositoryRelativePath("fenel/con")).toThrow();
    expect(() => repositoryRelativePath("fenel/e\u0301")).toThrow();
    expect(() => parseSha256Hex("A".repeat(64))).toThrow();
    expect(() => digestByteManifest("fixture", [row("fenel/a", "1"), row("fenel/a", "1")]))
      .toThrow("ambiguous-input");
    expect(() => digestByteManifest("fixture", [row("fenel/A", "1"), row("fenel/a", "1")]))
      .toThrow("ambiguous-input");
  });

  test("domain-separates manifests and every owner epoch binding", () => {
    const rows = [row("fenel/a", "1")];
    expect(digestByteManifest("left", rows).digest).not.toBe(digestByteManifest("right", rows).digest);
    const digest = sha256Raw("binding");
    const base = {
      artifact: "compiled-parser" as const,
      repositoryEpoch: digest,
      ownerOverlayDigest: digest,
      dependencyDigest: digest,
      protocolVersion: "1",
      recoveryStubVersion: "1",
      portableGenerationAbi: "1",
    };
    const ownerEpoch = computeOwnerEpoch(base);
    expect(computeOwnerEpoch({ ...base, artifact: "compiled-resolver" })).not.toBe(ownerEpoch);
    expect(computeOwnerEpoch({ ...base, dependencyDigest: sha256Raw("dependency") })).not.toBe(ownerEpoch);
    expect(computeOwnerEpoch({ ...base, protocolVersion: "2" })).not.toBe(ownerEpoch);
    expect(computeOwnerEpoch({ ...base, recoveryStubVersion: "2" })).not.toBe(ownerEpoch);
    expect(computeOwnerEpoch({ ...base, portableGenerationAbi: "2" })).not.toBe(ownerEpoch);
  });
});

describe("stable artifact byte capture", () => {
  test("captures common bytes, exact exclusions, owner overlays, and envelope outputs", async () => {
    const root = fixture();
    const watcher = fakeWatcher(root);
    const result = await captureStableEpoch({
      repositoryRoot: root,
      domains: [
        {
          kind: "owner-overlay",
          artifact: "compiled-parser",
          exactFiles: [
            repositoryRelativePath("fenel/modules/a.fenel"),
            repositoryRelativePath(
              "implementations/typescript/engine/scripts/generate-compiled-parser.ts",
            ),
          ],
          recursiveRoots: [
            repositoryRelativePath("implementations/typescript/engine/scripts/lib"),
          ],
        },
        {
          kind: "envelope",
          name: "parser-output",
          exactFiles: [RECOVERABLE_OUTPUT_EXCLUSIONS[2]!],
        },
      ],
    }, watcher.dependencies);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const commonPaths = result.value.repository.rows.map(({ path }) => path);
    expect(commonPaths).toContain(repositoryRelativePath("fenel/.ignored-by-git.fenel"));
    expect(commonPaths).toContain(
      repositoryRelativePath(
        "implementations/typescript/engine/src/generated/parser-bootstrap.generated.ts",
      ),
    );
    for (const path of RECOVERABLE_OUTPUT_EXCLUSIONS) expect(commonPaths).not.toContain(path);
    expect(result.value.domains.map(({ domain }) => domain)).toEqual([
      "envelope:parser-output",
      "owner-overlay:compiled-parser",
    ]);
    const envelope = result.value.domains[0]!;
    expect(envelope.rows.map(({ path }) => path)).toEqual([RECOVERABLE_OUTPUT_EXCLUSIONS[2]!]);
    const owner = result.value.domains[1]!;
    expect(plainPaths(owner.rows.map(({ path }) => path))).toEqual([
      "implementations/typescript/engine/scripts/generate-compiled-parser.ts",
      "implementations/typescript/engine/scripts/lib/shared.ts",
    ]);
    expect(watcher.watchCount()).toBe(2);
  });

  test("retains immutable B bytes rather than rereading the live tree", async () => {
    const root = fixture();
    const watcher = fakeWatcher(root);
    const path = repositoryRelativePath("fenel/modules/a.fenel");
    const result = await captureStableEpoch({ repositoryRoot: root }, watcher.dependencies);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const first = result.value.bytes.read(path);
    write(root, path, "later mutation\n");
    expect(Buffer.from(result.value.bytes.read(path))).toEqual(Buffer.from(first));
    first[0] = 0;
    expect(Buffer.from(result.value.bytes.read(path)).toString("utf8")).toBe("a = 1\n");
  });

  test("changes the common epoch for covered additions, edits, removals, renames, and case renames", async () => {
    const baselineRoot = fixture();
    const baseline = await captureStableEpoch(
      { repositoryRoot: baselineRoot },
      fakeWatcher(baselineRoot).dependencies,
    );
    expect(baseline.ok).toBe(true);
    if (!baseline.ok) return;

    const mutations: readonly (readonly [
      string,
      (root: string) => void,
      readonly string[],
      readonly string[],
    ])[] = [
      [
        "covered addition",
        (root) => write(root, "fenel/modules/added.fenel", "added = true\n"),
        ["fenel/modules/added.fenel"],
        [],
      ],
      [
        "covered edit",
        (root) => write(root, "fenel/modules/a.fenel", "a = edited\n"),
        ["fenel/modules/a.fenel"],
        [],
      ],
      [
        "covered removal",
        (root) => unlinkSync(join(root, "fenel/modules/a.fenel")),
        [],
        ["fenel/modules/a.fenel"],
      ],
      [
        "covered rename",
        (root) => renameSync(
          join(root, "fenel/modules/a.fenel"),
          join(root, "fenel/modules/renamed.fenel"),
        ),
        ["fenel/modules/renamed.fenel"],
        ["fenel/modules/a.fenel"],
      ],
      [
        "covered kind change",
        (root) => {
          const path = join(root, "fenel/modules/a.fenel");
          unlinkSync(path);
          mkdirSync(path);
        },
        [],
        ["fenel/modules/a.fenel"],
      ],
      [
        "covered case-only rename",
        (root) => {
          const original = join(root, "fenel/modules/a.fenel");
          const intermediate = join(root, "fenel/modules/case-intermediate.fenel");
          renameSync(original, intermediate);
          renameSync(intermediate, join(root, "fenel/modules/A.fenel"));
        },
        ["fenel/modules/A.fenel"],
        ["fenel/modules/a.fenel"],
      ],
      [
        "gitignored covered edit",
        (root) => write(root, "fenel/.ignored-by-git.fenel", "ignored edit\n"),
        ["fenel/.ignored-by-git.fenel"],
        [],
      ],
      [
        "gitignored covered addition",
        (root) => {
          write(root, ".gitignore", "fenel/.ignored-by-git.fenel\nfenel/.new-untracked.fenel\n");
          write(root, "fenel/.new-untracked.fenel", "new untracked bytes\n");
        },
        ["fenel/.new-untracked.fenel"],
        [],
      ],
    ];

    for (const [name, mutate, present, absent] of mutations) {
      const root = fixture();
      mutate(root);
      const captured = await captureStableEpoch(
        { repositoryRoot: root },
        fakeWatcher(root).dependencies,
      );
      expect(captured.ok, name).toBe(true);
      if (!captured.ok) continue;
      expect(captured.value.repositoryEpoch, name).not.toBe(baseline.value.repositoryEpoch);
      const paths = plainPaths(captured.value.repository.rows.map(({ path }) => path));
      for (const path of present) expect(paths, name).toContain(path);
      for (const path of absent) expect(paths, name).not.toContain(path);
    }
  });

  test("fails closed for case-only collisions on case-sensitive filesystems", async () => {
    const collisionRoot = fixture();
    write(collisionRoot, "fenel/modules/A.fenel", "case collision\n");
    const names = readdirSync(join(collisionRoot, "fenel/modules"));
    if (names.includes("A.fenel") && names.includes("a.fenel")) {
      const collision = await captureStableEpoch(
        { repositoryRoot: collisionRoot },
        fakeWatcher(collisionRoot).dependencies,
      );
      expect(collision).toEqual({
        ok: false,
        issue: {
          code: "ambiguous-input",
          paths: [
            repositoryRelativePath("fenel/modules/A.fenel"),
            repositoryRelativePath("fenel/modules/a.fenel"),
          ],
        },
      });
    }
  });

  test("keeps excluded live-output payloads outside the common epoch and byte store", async () => {
    const baselineRoot = fixture();
    const baseline = await captureStableEpoch(
      { repositoryRoot: baselineRoot },
      fakeWatcher(baselineRoot).dependencies,
    );
    expect(baseline.ok).toBe(true);
    if (!baseline.ok) return;

    const payloads: readonly (readonly [string, Uint8Array])[] = [
      ["invalid syntax", Uint8Array.from([0xff, 0xfe, 0x0a])],
      ["top-level throw", new TextEncoder().encode('throw new Error("live output executed");\n')],
      ["hostile valid source", new TextEncoder().encode("process.exit(97);\n")],
      ["ordinary stale data", new TextEncoder().encode('{"stale":true}\n')],
    ];
    for (const [name, payload] of payloads) {
      const root = fixture();
      for (const path of RECOVERABLE_OUTPUT_EXCLUSIONS) write(root, path, payload);
      const captured = await captureStableEpoch(
        { repositoryRoot: root },
        fakeWatcher(root).dependencies,
      );
      expect(captured.ok, name).toBe(true);
      if (!captured.ok) continue;
      expect(captured.value.repositoryEpoch, name).toBe(baseline.value.repositoryEpoch);
      expect(captured.value.repository.rows, name).toEqual(baseline.value.repository.rows);
      for (const path of RECOVERABLE_OUTPUT_EXCLUSIONS) {
        expect(captured.value.bytes.has(path), `${name}: ${path}`).toBe(false);
        expect(captured.value.bytes.paths, `${name}: ${path}`).not.toContain(path);
      }
    }
  });

  test("corroborates and reports a stable covered change after watcher close", async () => {
    const root = fixture();
    const watcher = fakeWatcher(root);
    const reports: unknown[] = [];
    const result = await captureStableEpoch(
      { repositoryRoot: root },
      {
        ...watcher.dependencies,
        afterScan: (phase) => {
          if (phase === "A") watcher.emit("fenel/modules/a.fenel");
        },
        reportDismissedChangeEvents: (events) => reports.push(events),
      },
    );
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.dismissedChangeEvents).toEqual([{
      path: repositoryRelativePath("fenel/modules/a.fenel"),
      count: 1,
    }]);
    expect(reports).toEqual([result.value.dismissedChangeEvents]);
  });

  test("deduplicates stable changes while preserving their diagnostic count", async () => {
    const root = fixture();
    const watcher = fakeWatcher(root);
    const result = await captureStableEpoch(
      { repositoryRoot: root },
      {
        ...watcher.dependencies,
        afterScan: (phase) => {
          if (phase === "A") {
            watcher.emit("fenel/modules/a.fenel");
            watcher.emit("fenel/modules/a.fenel");
          }
        },
        reportDismissedChangeEvents: () => undefined,
      },
    );
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.dismissedChangeEvents).toEqual([{
      path: repositoryRelativePath("fenel/modules/a.fenel"),
      count: 2,
    }]);
  });

  test("fails on A/B witness drift even when bytes and the watcher stay equal", async () => {
    const root = fixture();
    const watcher = fakeWatcher(root);
    const absolute = join(root, "fenel/modules/a.fenel");
    const result = await captureStableEpoch(
      { repositoryRoot: root },
      {
        ...watcher.dependencies,
        afterScan: (phase) => {
          if (phase !== "A") return;
          const stat = statSync(absolute);
          utimesSync(absolute, stat.atime, new Date(stat.mtimeMs + 2_000));
        },
      },
    );
    expect(result).toEqual({
      ok: false,
      issue: {
        code: "covered-mutation",
        path: repositoryRelativePath("fenel/modules/a.fenel"),
      },
    });
  });

  test("detects a real write-and-restore witness drift on Windows", async () => {
    if (process.platform !== "win32") return;
    for (const delayMs of [0, 1, 20]) {
      const root = fixture();
      const watcher = fakeWatcher(root);
      const result = await captureStableEpoch(
        { repositoryRoot: root },
        {
          ...watcher.dependencies,
          afterScan: async (phase) => {
            if (phase !== "A") return;
            write(root, "fenel/modules/a.fenel", "transient mutation\n");
            if (delayMs !== 0) {
              await new Promise<void>((settle) => setTimeout(settle, delayMs));
            }
            write(root, "fenel/modules/a.fenel", "a = 1\n");
          },
        },
      );
      expect(result, `delay ${delayMs}ms`).toEqual({
        ok: false,
        issue: {
          code: "covered-mutation",
          path: repositoryRelativePath("fenel/modules/a.fenel"),
        },
      });
    }
  });

  test("fails when a post-B covered change no longer reproduces B bytes", async () => {
    const root = fixture();
    const watcher = fakeWatcher(root);
    const result = await captureStableEpoch(
      { repositoryRoot: root },
      {
        ...watcher.dependencies,
        afterScan: (phase) => {
          if (phase !== "B") return;
          write(root, "fenel/modules/a.fenel", "post-B mutation\n");
          watcher.emit("fenel/modules/a.fenel");
        },
      },
    );
    expect(result).toEqual({
      ok: false,
      issue: {
        code: "covered-mutation",
        path: repositoryRelativePath("fenel/modules/a.fenel"),
      },
    });
  });

  test("fails when a post-B covered change no longer reproduces the B witness", async () => {
    const root = fixture();
    const watcher = fakeWatcher(root);
    const absolute = join(root, "fenel/modules/a.fenel");
    const result = await captureStableEpoch(
      { repositoryRoot: root },
      {
        ...watcher.dependencies,
        afterScan: (phase) => {
          if (phase !== "B") return;
          const stat = statSync(absolute);
          utimesSync(absolute, stat.atime, new Date(stat.mtimeMs + 2_000));
          watcher.emit("fenel/modules/a.fenel");
        },
      },
    );
    expect(result).toEqual({
      ok: false,
      issue: {
        code: "covered-mutation",
        path: repositoryRelativePath("fenel/modules/a.fenel"),
      },
    });
  });

  test("keeps dismissal telemetry and physical witnesses outside the epoch identity", async () => {
    const root = fixture();
    const quietWatcher = fakeWatcher(root);
    const quiet = await captureStableEpoch({ repositoryRoot: root }, quietWatcher.dependencies);
    expect(quiet.ok).toBe(true);
    if (!quiet.ok) return;

    const absolute = join(root, "fenel/modules/a.fenel");
    const stat = statSync(absolute);
    utimesSync(absolute, stat.atime, new Date(stat.mtimeMs + 2_000));

    const changedWatcher = fakeWatcher(root);
    const changed = await captureStableEpoch(
      { repositoryRoot: root },
      {
        ...changedWatcher.dependencies,
        afterScan: (phase) => {
          if (phase === "A") changedWatcher.emit("fenel/modules/a.fenel");
        },
        reportDismissedChangeEvents: () => undefined,
      },
    );
    expect(changed.ok).toBe(true);
    if (!changed.ok) return;
    expect(changed.value.repositoryEpoch).toBe(quiet.value.repositoryEpoch);
    expect(changed.value.repository).toEqual(quiet.value.repository);
    expect(changed.value.dismissedChangeEvents).toHaveLength(1);
  });

  test("reports unequal A/B scans even when an injected watcher is silent", async () => {
    const root = fixture();
    const watcher = fakeWatcher(root);
    const result = await captureStableEpoch(
      { repositoryRoot: root },
      {
        ...watcher.dependencies,
        afterScan: (phase) => {
          if (phase === "A") write(root, "fenel/modules/a.fenel", "a = changed\n");
        },
      },
    );
    expect(result).toEqual({ ok: false, issue: { code: "scan-mismatch" } });
  });

  test("rejects a covered ancestor rename after scan B", async () => {
    const root = fixture();
    const watcher = fakeWatcher(root);
    const result = await captureStableEpoch(
      { repositoryRoot: root },
      {
        ...watcher.dependencies,
        afterScan: (phase) => {
          if (phase === "B") watcher.emit("fenel/modules", "rename");
        },
      },
    );
    expect(result).toEqual({
      ok: false,
      issue: {
        code: "covered-mutation",
        path: repositoryRelativePath("fenel/modules"),
      },
    });
  });

  test("dismisses directory metadata changes outside byte identity", async () => {
    const root = fixture();
    const watcher = fakeWatcher(root);
    const result = await captureStableEpoch(
      { repositoryRoot: root },
      {
        ...watcher.dependencies,
        afterScan: (phase) => {
          if (phase === "B") watcher.emit("fenel/modules", "change");
        },
      },
    );
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.dismissedChangeEvents).toEqual([]);
  });

  test("rejects an absent-B-row covered file change", async () => {
    const root = fixture();
    const watcher = fakeWatcher(root);
    const path = "fenel/modules/new-after-b.fenel";
    const result = await captureStableEpoch(
      { repositoryRoot: root },
      {
        ...watcher.dependencies,
        afterScan: (phase) => {
          if (phase !== "B") return;
          write(root, path, "new = true\n");
          watcher.emit(path, "change");
        },
      },
    );
    expect(result).toEqual({
      ok: false,
      issue: {
        code: "covered-mutation",
        path: repositoryRelativePath(path),
      },
    });
  });

  test("ignores an exact excluded-output event for the common epoch", async () => {
    const root = fixture();
    const watcher = fakeWatcher(root);
    const result = await captureStableEpoch(
      { repositoryRoot: root },
      {
        ...watcher.dependencies,
        afterScan: (phase) => {
          if (phase === "A") watcher.emit(RECOVERABLE_OUTPUT_EXCLUSIONS[2]!, "rename");
        },
      },
    );
    expect(result.ok).toBe(true);
  });

  test("maps missing, nonregular, link, watcher-loss, and watcher-error directions", async () => {
    const missingRoot = fixture();
    unlinkSync(join(missingRoot, "bun.lock"));
    const missing = await captureStableEpoch(
      { repositoryRoot: missingRoot },
      fakeWatcher(missingRoot).dependencies,
    );
    expect(missing).toEqual({
      ok: false,
      issue: { code: "missing-input", path: repositoryRelativePath("bun.lock") },
    });

    const directoryRoot = fixture();
    unlinkSync(join(directoryRoot, "bun.lock"));
    mkdirSync(join(directoryRoot, "bun.lock"));
    const directory = await captureStableEpoch(
      { repositoryRoot: directoryRoot },
      fakeWatcher(directoryRoot).dependencies,
    );
    expect(directory).toEqual({
      ok: false,
      issue: { code: "unsupported-entry", path: repositoryRelativePath("bun.lock") },
    });

    const linkRoot = fixture();
    const target = join(linkRoot, "link-target");
    mkdirSync(target);
    symlinkSync(
      target,
      join(linkRoot, "fenel", "linked"),
      process.platform === "win32" ? "junction" : "dir",
    );
    const linked = await captureStableEpoch(
      { repositoryRoot: linkRoot },
      fakeWatcher(linkRoot).dependencies,
    );
    expect(linked).toEqual({
      ok: false,
      issue: { code: "unsupported-entry", path: repositoryRelativePath("fenel/linked") },
    });

    const lossRoot = fixture();
    const lossWatcher = fakeWatcher(lossRoot);
    const loss = await captureStableEpoch(
      { repositoryRoot: lossRoot },
      {
        ...lossWatcher.dependencies,
        afterScan: (phase) => {
          if (phase === "A") lossWatcher.emit(null);
        },
      },
    );
    expect(loss).toEqual({ ok: false, issue: { code: "watcher-loss" } });

    const errorRoot = fixture();
    const errorWatcher = fakeWatcher(errorRoot);
    const watcherError = await captureStableEpoch(
      { repositoryRoot: errorRoot },
      {
        ...errorWatcher.dependencies,
        afterScan: (phase) => {
          if (phase === "A") errorWatcher.error();
        },
      },
    );
    expect(watcherError).toEqual({ ok: false, issue: { code: "watcher-error" } });

    const lateErrorRoot = fixture();
    const lateErrorWatcher = fakeWatcher(lateErrorRoot);
    const lateWatcherError = await captureStableEpoch(
      { repositoryRoot: lateErrorRoot },
      {
        ...lateErrorWatcher.dependencies,
        afterScan: (phase) => {
          if (phase === "B") lateErrorWatcher.error();
        },
      },
    );
    expect(lateWatcherError).toEqual({ ok: false, issue: { code: "watcher-error" } });
  });

  test("requires sentinel delivery and never deletes a foreign sentinel", async () => {
    const timeoutRoot = fixture();
    const timeout = await captureStableEpoch(
      { repositoryRoot: timeoutRoot },
      {
        watchFactory: () => ({ close: async () => undefined }),
        nonce: () => "timeout",
        sentinelTimeoutMs: 5,
      },
    );
    expect(timeout).toEqual({ ok: false, issue: { code: "watcher-unsupported" } });

    const foreignRoot = fixture();
    const foreign = join(
      foreignRoot,
      "implementations/typescript/engine/src/generated",
      `.fenel-m3b-watch-${process.pid}-foreign.sentinel`,
    );
    writeFileSync(foreign, "foreign\n");
    const result = await captureStableEpoch(
      { repositoryRoot: foreignRoot },
      {
        watchFactory: () => ({ close: async () => undefined }),
        nonce: () => "foreign",
        sentinelTimeoutMs: 5,
      },
    );
    expect(result).toEqual({
      ok: false,
      issue: {
        code: "ambiguous-input",
        paths: [repositoryRelativePath(
          `implementations/typescript/engine/src/generated/.fenel-m3b-watch-${process.pid}-foreign.sentinel`,
        )],
      },
    });
    expect(readFileSync(foreign, "utf8")).toBe("foreign\n");
  });

  test("rejects recoverable/environment evidence in an owner overlay", async () => {
    const root = fixture();
    const watcher = fakeWatcher(root);
    for (const path of [RECOVERABLE_OUTPUT_EXCLUSIONS[0]!, ENVIRONMENT_ONLY_OWNER_INPUTS[0]!]) {
      const result = await captureStableEpoch({
        repositoryRoot: root,
        domains: [{
          kind: "owner-overlay",
          artifact: "compiled-parser",
          exactFiles: [path],
        }],
      }, watcher.dependencies);
      expect(result).toEqual({
        ok: false,
        issue: { code: "ambiguous-input", paths: [path] },
      });
    }
  });

  test("passes a real recursive watcher capability and stable A/B scan", async () => {
    const root = fixture();
    const result = await captureStableEpoch({ repositoryRoot: root });
    expect(result.ok, result.ok ? undefined : JSON.stringify(result.issue)).toBe(true);
  }, 20_000);

  test("real backdated-atime captures remain identity-stable with bounded telemetry", async () => {
    const root = fixture();
    backdateFixtureAtimes(root);
    let expectedEpoch: Sha256Hex | undefined;
    for (let attempt = 0; attempt < 3; attempt += 1) {
      const reports: unknown[] = [];
      const result = await captureStableEpoch({ repositoryRoot: root }, {
        reportDismissedChangeEvents: (events) => reports.push(events),
      });
      expect(result.ok, result.ok ? undefined : JSON.stringify(result.issue)).toBe(true);
      if (!result.ok) continue;
      expectedEpoch ??= result.value.repositoryEpoch;
      expect(result.value.repositoryEpoch).toBe(expectedEpoch);
      expect(reports).toEqual([result.value.dismissedChangeEvents]);
      expect(result.value.dismissedChangeEvents.length)
        .toBeLessThanOrEqual(result.value.repository.rows.length);
      for (const event of result.value.dismissedChangeEvents) {
        expect(event.count).toBeGreaterThan(0);
        expect(result.value.repository.rows.some(({ path }) => path === event.path)).toBe(true);
      }
    }
  }, 30_000);
});
