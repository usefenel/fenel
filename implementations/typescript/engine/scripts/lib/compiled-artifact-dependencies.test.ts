import { afterEach, describe, expect, test } from "bun:test";
import {
  appendFileSync, existsSync, mkdirSync, mkdtempSync, readFileSync,
  readdirSync, rmSync, symlinkSync, writeFileSync,
} from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import {
  coldResolveEmptyCompiledArtifactDependencies,
  COMPILED_ARTIFACT_IMPORTER,
  DependencyEvidenceError,
  EMPTY_COMPILED_ARTIFACT_DEPENDENCY_MANIFEST,
  proveEmptyCompiledArtifactDependencies,
  type ColdEmptyCompiledArtifactDependencyInput,
  type ColdBunCommandRequest,
} from "./compiled-artifact-dependencies";
import { sha256Hex } from "./compiled-artifact-toolchain";

const HERE = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = resolve(HERE, "../../../../..");
const PACKAGE_JSON = readFileSync(join(REPO_ROOT, `${COMPILED_ARTIFACT_IMPORTER}/package.json`));
const BUN_LOCK = readFileSync(join(REPO_ROOT, "bun.lock"));
const BUN_SHA256 = sha256Hex(new Uint8Array(readFileSync(process.execPath)));
const temporaryRoots: string[] = [];

afterEach(() => {
  for (const root of temporaryRoots.splice(0)) {
    // Every target came from mkdtempSync below, outside live dependency trees.
    rmSync(root, { recursive: true, force: true });
  }
});

function bytes(text: string): Uint8Array {
  return new TextEncoder().encode(text);
}
function jsonBytes(value: unknown): Uint8Array {
  return bytes(`${JSON.stringify(value)}\n`);
}
function fixtureLock(): Record<string, any> {
  return {
    lockfileVersion: 1,
    configVersion: 1,
    workspaces: {
      "": { name: "fenel-cold-fixture" },
      [COMPILED_ARTIFACT_IMPORTER]: { name: "@fenel/engine", version: "0.0.1" },
    },
    packages: { "@fenel/engine": [`@fenel/engine@workspace:${COMPILED_ARTIFACT_IMPORTER}`] },
  };
}
function errorCode(action: () => unknown): string | undefined {
  try {
    action();
    return undefined;
  } catch (error) {
    return error instanceof DependencyEvidenceError ? error.code : undefined;
  }
}
function proveLock(lock: unknown): unknown {
  return proveEmptyCompiledArtifactDependencies({ packageJsonBytes: PACKAGE_JSON, bunLockBytes: jsonBytes(lock) });
}

const FIXTURE_ENGINE_PACKAGE = jsonBytes({ name: "@fenel/engine", version: "0.0.1", type: "module" });
function coldInput(): ColdEmptyCompiledArtifactDependencyInput {
  const repositoryRoot = mkdtempSync(join(REPO_ROOT, ".tmp-m3b-cold-bun-"));
  temporaryRoots.push(repositoryRoot);
  return {
    repositoryRoot,
    bunExecutable: process.execPath,
    bunExecutableSha256: BUN_SHA256,
    rootPackageJsonBytes: jsonBytes({
      name: "fenel-cold-fixture",
      private: true,
      workspaces: ["implementations/typescript/*", "distros/narthex/*"],
      packageManager: "bun@1.3.13",
    }),
    packageJsonBytes: FIXTURE_ENGINE_PACKAGE,
    bunLockBytes: jsonBytes(fixtureLock()),
    expectedDependencyManifestBytes: bytes(EMPTY_COMPILED_ARTIFACT_DEPENDENCY_MANIFEST),
  };
}
function expectClean(input: ColdEmptyCompiledArtifactDependencyInput): void {
  expect(readdirSync(resolve(input.repositoryRoot, ".tmp-m3b-snapshots"))).toEqual([]);
}

describe("compiled-artifact Bun dependency closure", () => {
  test("proves the committed Bun workspace has zero acquired package/file rows", () => {
    const proof = proveEmptyCompiledArtifactDependencies({ packageJsonBytes: PACKAGE_JSON, bunLockBytes: BUN_LOCK });
    expect(proof).toMatchObject({
      schema: "fenel.compiled-artifact-dependencies.v1",
      importer: COMPILED_ARTIFACT_IMPORTER,
      lockfileVersion: 1,
      packageCount: 0,
      fileCount: 0,
      bunLockSha256: sha256Hex(new Uint8Array(BUN_LOCK)),
    });
    expect(proof.packageJsonSha256).toMatch(/^[0-9a-f]{64}$/u);
    expect(proof.dependencyDigest).toMatch(/^[0-9a-f]{64}$/u);
    expect(proof.canonicalManifest).toBe(EMPTY_COMPILED_ARTIFACT_DEPENDENCY_MANIFEST);
  });

  test.each([
    "dependencies", "devDependencies", "optionalDependencies", "peerDependencies",
    "peerDependenciesMeta", "overrides", "resolutions", "imports", "patchedDependencies", "pnpm",
  ])("rejects a nonempty package.json %s mapping", (field) => {
    expect(errorCode(() => proveEmptyCompiledArtifactDependencies({
      packageJsonBytes: jsonBytes({ name: "@fenel/engine", [field]: { surprise: "1.0.0" } }),
      bunLockBytes: BUN_LOCK,
    }))).toBe("nonempty-dependency-closure");
  });

  test.each(["bundledDependencies", "bundleDependencies", "workspaces", "trustedDependencies"])(
    "rejects package.json %s edges", (field) => {
      expect(errorCode(() => proveEmptyCompiledArtifactDependencies({
        packageJsonBytes: jsonBytes({ name: "@fenel/engine", [field]: ["surprise"] }),
        bunLockBytes: BUN_LOCK,
      }))).toBe("nonempty-dependency-closure");
    },
  );

  test("rejects duplicate package JSON keys", () => {
    expect(errorCode(() => proveEmptyCompiledArtifactDependencies({
      packageJsonBytes: bytes('{"name":"@fenel/engine","name":"@fenel/engine"}'),
      bunLockBytes: BUN_LOCK,
    }))).toBe("invalid-package-manifest");
  });

  test.each(["dependencies", "devDependencies", "peerDependencies", "optionalDependencies"])(
    "rejects Bun workspace %s edges even with an empty manifest", (field) => {
      const lock = fixtureLock();
      lock.workspaces[COMPILED_ARTIFACT_IMPORTER][field] = { surprise: "1.0.0" };
      expect(errorCode(() => proveLock(lock))).toBe("nonempty-dependency-closure");
    },
  );

  test.each([
    "@fenel/engine@file:../../outside", "@fenel/engine@https://example.invalid/engine.tgz",
    "@fenel/engine@workspace:../outside", "@fenel/engine@1.0.0",
  ])("rejects an engine package resolution to %s", (resolution) => {
    const lock = fixtureLock();
    lock.packages["@fenel/engine"] = [resolution];
    expect(errorCode(() => proveLock(lock))).toBe("invalid-lockfile");
  });

  test("rejects missing, duplicate, and unsupported engine workspace identity", () => {
    const missing = fixtureLock();
    delete missing.workspaces[COMPILED_ARTIFACT_IMPORTER];
    expect(errorCode(() => proveLock(missing))).toBe("invalid-lockfile");
    const duplicate = fixtureLock();
    duplicate.workspaces["other"] = { name: "@fenel/engine" };
    expect(errorCode(() => proveLock(duplicate))).toBe("invalid-lockfile");
    const fields = fixtureLock();
    fields.workspaces[COMPILED_ARTIFACT_IMPORTER].scripts = { install: "surprise" };
    expect(errorCode(() => proveLock(fields))).toBe("nonempty-dependency-closure");
  });

  test("accepts JSONC comments and commas without confusing quoted comment markers", () => {
    const source = JSON.stringify(fixtureLock()).replace(
      '"configVersion":1,', '/* policy comment */ "configVersion":1, // comment\n',
    ).replace('"fenel-cold-fixture"', '"fenel-https://example.invalid/*quoted*/"').replace(/}$/, ',}');
    expect(() => proveEmptyCompiledArtifactDependencies({ packageJsonBytes: PACKAGE_JSON, bunLockBytes: bytes(source) })).not.toThrow();
  });

  test.each([
    '{"lockfileVersion":1,"lockfileVersion":1}',
    '{"lockfileVersion":1,"lockfileVersion":2,}',
    '{"lockfileVersion":1,/* unfinished',
    '{"lockfileVersion":1,,}',
    '{"lockfileVersion":1,broken:true}',
    'null',
  ])("rejects malformed or duplicate JSONC: %s", (source) => {
    expect(errorCode(() => proveEmptyCompiledArtifactDependencies({
      packageJsonBytes: PACKAGE_JSON, bunLockBytes: bytes(source),
    }))).toBe("invalid-lockfile");
  });

  test("rejects lock version drift and missing package sections", () => {
    for (const change of [
      (lock: Record<string, any>) => { lock.lockfileVersion = 2; },
      (lock: Record<string, any>) => { lock.configVersion = 2; },
      (lock: Record<string, any>) => { delete lock.packages; },
      (lock: Record<string, any>) => { lock.unknownResolutionPolicy = {}; },
    ]) {
      const lock = fixtureLock();
      change(lock);
      expect(errorCode(() => proveLock(lock))).toBe("invalid-lockfile");
    }
  });

  test("rejects a workspace version that disagrees with package.json", () => {
    const lock = fixtureLock();
    lock.workspaces[COMPILED_ARTIFACT_IMPORTER].version = "9.9.9";
    expect(errorCode(() => proveLock(lock))).toBe("invalid-lockfile");
  });
});

describe("cold Bun zero-closure verification", () => {
  test("runs real pinned Bun frozen against an empty private cache and cleans its owned root", async () => {
    const input = coldInput();
    let captured: ColdBunCommandRequest | undefined;
    const proof = await coldResolveEmptyCompiledArtifactDependencies(input, {
      afterSourceCapture: (request) => { captured = request; },
    });
    expect(proof).toMatchObject({
      coldResolution: "verified", packageCount: 0, fileCount: 0,
      observedCanonicalManifest: EMPTY_COMPILED_ARTIFACT_DEPENDENCY_MANIFEST,
      bunExecutableSha256: BUN_SHA256,
    });
    expect(proof.sourceCaptureDigest).toMatch(/^[0-9a-f]{64}$/u);
    expect(captured!.argv.slice(0, 2)).toEqual([resolve(process.execPath), "install"]);
    expect(captured!.argv).not.toContain("--no-env-file");
    expect(captured!.argv).toContain("--frozen-lockfile");
    expect(captured!.argv).toContain("--ignore-scripts");
    expect(captured!.argv).not.toContain("--offline"); // 1.3.13 silently ignores this unsupported flag.
    expect(captured!.env.PATH).toBeUndefined();
    expect(captured!.env.NODE_ENV).toBeUndefined();
    expect(captured!.env.HTTPS_PROXY).toBe("http://127.0.0.1:9");
    expect(captured!.env.BUN_INSTALL_CACHE_DIR).toBe(captured!.paths.cache);
    expectClean(input);
  });

  test("isolates unrelated root dependencies, policies, scripts, and ambient configuration", async () => {
    const input = coldInput();
    const sentinel = resolve(input.repositoryRoot, "script-ran");
    const script = `bun -e 'require("fs").writeFileSync(${JSON.stringify(sentinel)}, "bad")'`;
    const rootPackage = JSON.parse(new TextDecoder().decode(input.rootPackageJsonBytes));
    rootPackage.dependencies = { surprise: "https://example.invalid/unavailable.tgz" };
    rootPackage.scripts = { install: script };
    rootPackage.overrides = { surprise: "file:../outside" };
    rootPackage.trustedDependencies = ["surprise"];
    const previous = process.env.FENEL_AMBIENT_SENTINEL;
    process.env.FENEL_AMBIENT_SENTINEL = "must not enter the child";
    try {
      await coldResolveEmptyCompiledArtifactDependencies({
        ...input,
        rootPackageJsonBytes: jsonBytes(rootPackage),
        packageJsonBytes: jsonBytes({ name: "@fenel/engine", version: "0.0.1", scripts: { install: script } }),
      }, {
        afterSourceCapture: (request) => {
          expect(request.env.FENEL_AMBIENT_SENTINEL).toBeUndefined();
          const projected = JSON.parse(readFileSync(resolve(request.paths.workspace, "package.json"), "utf8"));
          expect(Object.keys(projected).sort()).toEqual(["name", "private", "workspaces"]);
          expect(readFileSync(request.paths.lockfile, "utf8")).not.toContain("example.invalid");
        },
      });
      expect(existsSync(sentinel)).toBe(false);
    } finally {
      if (previous === undefined) delete process.env.FENEL_AMBIENT_SENTINEL;
      else process.env.FENEL_AMBIENT_SENTINEL = previous;
    }
    expectClean(input);
  });

  test("real install isolates ancestor package, bunfig, npmrc, and dotenv configuration", async () => {
    const input = coldInput();
    // Put an actual project above the cold workspace so ancestor discovery is
    // exercised, rather than only passing package.json bytes to the verifier.
    writeFileSync(resolve(input.repositoryRoot, "package.json"), input.rootPackageJsonBytes);
    const dotenv = "BUN_CONFIG_MAX_HTTP_REQUESTS=not-a-number\n";
    writeFileSync(resolve(input.repositoryRoot, ".env"), dotenv);
    writeFileSync(resolve(input.repositoryRoot, ".npmrc"), [
      "registry=https://ancestor.invalid/", "ignore-scripts=false", "",
    ].join("\n"));

    // Positive control: native `bun install` really consumes this .env and
    // fails. Neither --dry-run nor the cold command relies on --no-env-file.
    const control = Bun.spawnSync([
      process.execPath, "install", "--dry-run", "--ignore-scripts",
      "--registry", "http://127.0.0.1:9",
      "--cache-dir", resolve(input.repositoryRoot, "control-cache"),
    ], {
      cwd: input.repositoryRoot,
      env: {
        CI: "true",
        ...(process.platform === "win32"
          ? { SYSTEMROOT: process.env.SYSTEMROOT ?? process.env.SystemRoot! }
          : {}),
      },
      stdout: "pipe", stderr: "pipe",
    });
    expect(control.exitCode).not.toBe(0);
    expect(control.stderr.toString()).toContain("BUN_CONFIG_MAX_HTTP_REQUESTS");
    expect(control.stderr.toString()).toContain("not-a-number");
    // This malformed ancestor config also makes accidental loading observable.
    writeFileSync(resolve(input.repositoryRoot, "bunfig.toml"), "[invalid unclosed toml\n");

    let childDiagnostic = "";
    const proof = await coldResolveEmptyCompiledArtifactDependencies(input, {
      runBun: async (request) => {
        const child = Bun.spawnSync([...request.argv], {
          cwd: request.cwd, env: { ...request.env }, stdout: "pipe", stderr: "pipe",
        });
        childDiagnostic = `${child.stdout.toString()}${child.stderr.toString()}`;
        return { exitCode: child.exitCode, stdout: child.stdout.toString(), stderr: child.stderr.toString() };
      },
    });
    expect(proof.coldResolution).toBe("verified");
    expect(childDiagnostic).not.toContain('".env"');
    expect(childDiagnostic).not.toContain("BUN_CONFIG_MAX_HTTP_REQUESTS");
    expect(readFileSync(resolve(input.repositoryRoot, ".env"), "utf8")).toBe(dotenv);
    expectClean(input);
  });

  test("checks the committed repository manifest and full lock through real Bun", async () => {
    const input = coldInput();
    await expect(coldResolveEmptyCompiledArtifactDependencies({
      ...input,
      packageJsonBytes: PACKAGE_JSON,
      bunLockBytes: BUN_LOCK,
      rootPackageJsonBytes: readFileSync(join(REPO_ROOT, "package.json")),
    })).resolves.toMatchObject({ coldResolution: "verified" });
    expectClean(input);
  });

  test("fails closed on Bun command failure", async () => {
    const input = coldInput();
    await expect(coldResolveEmptyCompiledArtifactDependencies(input, {
      runBun: async () => ({ exitCode: 1, stdout: "", stderr: "frozen lock mismatch" }),
    })).rejects.toMatchObject({ code: "cold-resolution-failed" });
    expectClean(input);
  });

  test("gives a silent Bun exit one more complete attempt in a fresh cold root", async () => {
    const input = coldInput();
    const roots: string[] = [];
    const proof = await coldResolveEmptyCompiledArtifactDependencies(input, {
      runBun: async (request) => {
        roots.push(request.paths.root);
        if (roots.length === 1) return { exitCode: 66, stdout: "", stderr: "" };
        const child = Bun.spawnSync([...request.argv], {
          cwd: request.cwd, env: { ...request.env }, stdout: "pipe", stderr: "pipe",
        });
        return { exitCode: child.exitCode, stdout: child.stdout.toString(), stderr: child.stderr.toString() };
      },
    });
    expect(proof.coldResolution).toBe("verified");
    expect(roots).toHaveLength(2);
    expect(roots[1]).not.toBe(roots[0]);
    expectClean(input);
  });

  test("fails closed on a second silent Bun exit and never retries an exit with a diagnostic", async () => {
    const silentInput = coldInput();
    let silentRuns = 0;
    await expect(coldResolveEmptyCompiledArtifactDependencies(silentInput, {
      runBun: async () => { silentRuns += 1; return { exitCode: 66, stdout: "", stderr: " \n" }; },
    })).rejects.toMatchObject({ code: "cold-resolution-failed", message: "pinned Bun exited 66: no diagnostic" });
    expect(silentRuns).toBe(2);
    expectClean(silentInput);
    const loudInput = coldInput();
    let loudRuns = 0;
    await expect(coldResolveEmptyCompiledArtifactDependencies(loudInput, {
      runBun: async () => { loudRuns += 1; return { exitCode: 1, stdout: "", stderr: "frozen lock mismatch" }; },
    })).rejects.toMatchObject({ code: "cold-resolution-failed" });
    expect(loudRuns).toBe(1);
    expectClean(loudInput);
  });

  test("rejects source mutation before executing a child", async () => {
    const input = coldInput();
    let ran = false;
    await expect(coldResolveEmptyCompiledArtifactDependencies(input, {
      afterSourceCapture: (request) => { writeFileSync(request.paths.enginePackage, '{"name":"changed"}'); },
      runBun: async () => { ran = true; return { exitCode: 0, stdout: "", stderr: "" }; },
    })).rejects.toMatchObject({ code: "concurrent-source-mutation" });
    expect(ran).toBe(false);
    expectClean(input);
  });

  test.each(["engine", "lock", "repository lock", "config"])("rejects %s source mutation after install", async (target) => {
    const input = coldInput();
    await expect(coldResolveEmptyCompiledArtifactDependencies(input, {
      afterBun: (request) => {
        const paths = {
          engine: request.paths.enginePackage,
          lock: request.paths.lockfile,
          "repository lock": resolve(request.paths.root, "inputs/bun.lock"),
          config: resolve(request.paths.workspace, "bunfig.toml"),
        };
        appendFileSync(paths[target as keyof typeof paths], "\n");
      },
    })).rejects.toMatchObject({ code: "concurrent-source-mutation" });
    expectClean(input);
  });

  test.each(["cache", "modules", "workspace"])("rejects unexpected %s package bytes", async (target) => {
    const input = coldInput();
    await expect(coldResolveEmptyCompiledArtifactDependencies(input, {
      afterBun: (request) => {
        const file = resolve(request.paths[target as "cache" | "modules" | "workspace"], "surprise/package.json");
        mkdirSync(dirname(file), { recursive: true });
        writeFileSync(file, '{"name":"surprise"}');
      },
    })).rejects.toMatchObject({ code: "nonempty-dependency-closure" });
    expectClean(input);
  });

  test("rejects a symlink to ambient packages", async () => {
    const input = coldInput();
    const external = resolve(input.repositoryRoot, "ambient");
    mkdirSync(external);
    writeFileSync(resolve(external, "package.json"), '{"name":"surprise"}');
    await expect(coldResolveEmptyCompiledArtifactDependencies(input, {
      afterBun: (request) => { symlinkSync(external, resolve(request.paths.modules, "surprise"), "junction"); },
    })).rejects.toMatchObject({ code: "nonempty-dependency-closure" });
    expect(readFileSync(resolve(external, "package.json"), "utf8")).toBe('{"name":"surprise"}');
    expectClean(input);
  });

  test("rejects valid-looking output mutation between full A/B captures", async () => {
    const input = coldInput();
    await expect(coldResolveEmptyCompiledArtifactDependencies(input, {
      betweenOutputCaptures: (request) => { appendFileSync(request.paths.lockfile, "\n"); },
    })).rejects.toMatchObject({ code: "concurrent-source-mutation" });
    expectClean(input);
  });

  test("guards original inputs through the final output capture", async () => {
    const input = coldInput();
    await expect(coldResolveEmptyCompiledArtifactDependencies(input, {
      betweenOutputCaptures: (request) => { appendFileSync(resolve(request.paths.root, "inputs/bun.lock"), "\n"); },
    })).rejects.toMatchObject({ code: "concurrent-source-mutation" });
    expectClean(input);
  });

  test("rejects noncanonical packaged dependency evidence", async () => {
    const input = coldInput();
    await expect(coldResolveEmptyCompiledArtifactDependencies({
      ...input, expectedDependencyManifestBytes: bytes(`${EMPTY_COMPILED_ARTIFACT_DEPENDENCY_MANIFEST}\n`),
    })).rejects.toMatchObject({ code: "dependency-manifest-mismatch" });
  });

  test("rejects mismatched Bun bytes and root packageManager without fallback", async () => {
    const input = coldInput();
    await expect(coldResolveEmptyCompiledArtifactDependencies({
      ...input, bunExecutableSha256: "0".repeat(64),
    })).rejects.toMatchObject({ code: "toolchain-integrity" });
    const root = JSON.parse(new TextDecoder().decode(input.rootPackageJsonBytes));
    root.packageManager = "bun@1.0.0";
    await expect(coldResolveEmptyCompiledArtifactDependencies({
      ...input, rootPackageJsonBytes: jsonBytes(root),
    })).rejects.toMatchObject({ code: "toolchain-integrity" });
    expectClean(input);
  });

  test("rejects workspace boundary changes before staging", async () => {
    const input = coldInput();
    const root = JSON.parse(new TextDecoder().decode(input.rootPackageJsonBytes));
    root.workspaces.push("../outside/*");
    await expect(coldResolveEmptyCompiledArtifactDependencies({
      ...input, rootPackageJsonBytes: jsonBytes(root),
    })).rejects.toMatchObject({ code: "invalid-package-manifest" });
  });
});
