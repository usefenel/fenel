import { afterEach, describe, expect, test } from "bun:test";
import { createHash } from "node:crypto";
import {
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { dirname, join, relative } from "node:path";
import { compareUtf8, encodeCanonicalJson } from "./artifact-wire-json";

const temporaryRoots: string[] = [];
const PRELOAD_RELATIVE =
  "implementations/typescript/engine/scripts/lib/compiled-artifact-worker-preload.ts";
const POLICY_RELATIVE =
  "implementations/typescript/engine/scripts/lib/compiled-artifact-worker-policy.ts";
const BOOTSTRAP_RELATIVE = ".m3b-worker-bootstrap.ts";
const WORKER_RELATIVE =
  "implementations/typescript/engine/scripts/generate-compiled-parser-worker.ts";
const WORKER_DIRECTORY = "implementations/typescript/engine/scripts";

afterEach(() => {
  for (const root of temporaryRoots.splice(0)) rmSync(root, { recursive: true, force: true });
});

type SnapshotFile = { readonly path: string; readonly bytes: Uint8Array };

function sha256(bytes: Uint8Array): string {
  return createHash("sha256").update(bytes).digest("hex");
}

function writeSnapshotFile(root: string, file: SnapshotFile): void {
  const target = join(root, ...file.path.split("/"));
  mkdirSync(dirname(target), { recursive: true });
  writeFileSync(target, file.bytes);
}

function snapshot(entry: string, extras: Readonly<Record<string, string>> = {}): {
  readonly root: string;
  readonly entry: string;
  readonly worker: string;
  readonly preload: string;
  readonly manifest: string;
  readonly trace: string;
} {
  const root = mkdtempSync(join(process.cwd(), ".tmp-m3b-preload-"));
  temporaryRoots.push(root);
  mkdirSync(join(root, ".tmp"));
  const filesByPath = new Map<string, Uint8Array>([
    [
      PRELOAD_RELATIVE,
      readFileSync(new URL("./compiled-artifact-worker-preload.ts", import.meta.url)),
    ],
    [
      POLICY_RELATIVE,
      readFileSync(new URL("./compiled-artifact-worker-policy.ts", import.meta.url)),
    ],
    [BOOTSTRAP_RELATIVE, new TextEncoder().encode(entry)],
    [WORKER_RELATIVE, new TextEncoder().encode("export {};\n")],
  ]);
  for (const [path, text] of Object.entries(extras)) {
    filesByPath.set(path, new TextEncoder().encode(text));
  }
  const files: SnapshotFile[] = [...filesByPath].map(([path, bytes]) => ({ path, bytes }));
  files.sort((left, right) => compareUtf8(left.path, right.path));
  for (const file of files) writeSnapshotFile(root, file);
  const rows = files.map(({ path, bytes }) => ({
    path,
    byteLength: bytes.byteLength,
    digest: sha256(bytes),
  }));
  const contentDigest = sha256(new TextEncoder().encode(JSON.stringify([
    "fenel.byte-manifest.v1",
    "snapshot:compiled-parser",
    rows.map((row) => [row.path, "regular-file", row.byteLength, row.digest]),
  ])));
  const manifest = join(root, ".m3b-snapshot-manifest.json");
  writeFileSync(manifest, encodeCanonicalJson({
    schema: "fenel.compiled-artifact-snapshot.v1",
    root: ".",
    artifact: "compiled-parser",
    rows,
    contentDigest,
  }));
  return {
    root,
    entry: join(root, BOOTSTRAP_RELATIVE),
    worker: join(root, ...WORKER_RELATIVE.split("/")),
    preload: join(root, ...PRELOAD_RELATIVE.split("/")),
    manifest,
    trace: join(root, ".m3b-worker-trace.jsonl"),
  };
}

function run(entry: string, extras: Readonly<Record<string, string>> = {}): {
  readonly exitCode: number;
  readonly stdout: string;
  readonly stderr: string;
  readonly trace: string;
  readonly root: string;
} {
  const fixture = snapshot(entry, extras);
  const result = Bun.spawnSync({
    cmd: [
      process.execPath,
      "--no-env-file",
      "--no-install",
      "--cwd",
      fixture.root,
      "--preload",
      fixture.preload,
      fixture.entry,
    ],
    cwd: fixture.root,
    env: {
      FENEL_M3B_SNAPSHOT_ROOT: fixture.root,
      FENEL_M3B_TRACE_PATH: fixture.trace,
      FENEL_M3B_WORKER_PATH: fixture.worker,
      M3B_AMBIENT_SECRET: "must-be-scrubbed",
    },
    stdin: "ignore",
    stdout: "pipe",
    stderr: "pipe",
  });
  return {
    exitCode: result.exitCode,
    stdout: result.stdout.toString(),
    stderr: result.stderr.toString(),
    trace: readFileSync(fixture.trace, "utf8"),
    root: fixture.root,
  };
}

describe("compiled artifact worker preload", () => {
  test("trace flushing completes partial writes and retains any IO failure across caught retries", () => {
    // The preload cannot be imported into the test process: it installs host
    // guards. Run its actual flush boundary with controlled short-write IO.
    const source = readFileSync(new URL("./compiled-artifact-worker-preload.ts", import.meta.url), "utf8");
    const start = source.indexOf("function flushTrace(): void {");
    const end = source.indexOf("\n}\n", start);
    expect(start).toBeGreaterThanOrEqual(0);
    expect(end).toBeGreaterThan(start);
    const flushSource = new Bun.Transpiler({ loader: "ts" }).transformSync(source.slice(start, end + 2));
    const expected = Buffer.from('{"kind":"read","path":"λ🙂.ts"}\n', "utf8");
    for (const mode of ["short", "stalled", "throws"] as const) {
      const written: Buffer[] = [];
      const failure = new Error("injected trace IO failure");
      let calls = 0;
      const write = (fd: number, bytes: Uint8Array, offset: number, length: number): number => {
        expect(fd).toBe(7);
        calls += 1;
        if (mode === "throws" && calls === 2) throw failure;
        const count = mode === "stalled" ? 0 : Math.min(3, length);
        written.push(Buffer.from(bytes.subarray(offset, offset + count)));
        return count;
      };
      const boundary = new Function("privilegedBufferConcat", "privilegedWriteSync", "input", `
        const traceFd = 7;
        let traceChunks = [input];
        let traceByteLength = input.byteLength;
        let traceWriteFailed = false;
        let traceWriteFailure;
        ${flushSource}
        return { flush: flushTrace, pending: () => traceByteLength };
      `)(Buffer.concat.bind(Buffer), write, expected) as { flush: () => void; pending: () => number };
      if (mode !== "short") {
        let firstFailure: unknown;
        try { boundary.flush(); } catch (error) { firstFailure = error; }
        expect(firstFailure).toBeInstanceOf(Error);
        if (mode === "throws") {
          expect(firstFailure).toBe(failure);
          expect(Buffer.concat(written)).toEqual(expected.subarray(0, 3));
        } else expect((firstFailure as Error).message).toBe("short M3b trace write");
        const callsBeforeRetry = calls;
        let retryFailure: unknown;
        try { boundary.flush(); } catch (error) { retryFailure = error; }
        expect(retryFailure).toBe(firstFailure);
        expect(calls).toBe(callsBeforeRetry);
        expect(boundary.pending()).toBe(expected.byteLength);
      } else {
        boundary.flush();
        expect(Buffer.concat(written)).toEqual(expected);
        expect(boundary.pending()).toBe(0);
        const writes = written.length;
        boundary.flush();
        expect(written).toHaveLength(writes);
      }
    }
  });

  for (const fails of [false, true]) {
    test(`preserves ordered UTF-8 trace batches and closing evidence on ${fails ? "throwing" : "normal"} exit`, () => {
      const result = run(`
        const worker = (globalThis as unknown as Record<symbol, string>)[Symbol.for("fenel.m3b.worker-path")];
        await import(worker);
      `, {
        [WORKER_RELATIVE]: `
          import "./trace-λ🙂";
          for (let index = 0; index < 4096; index++) {
            if (index % 2 === 0) void process.env.FENEL_SIMULATE_BROWSER;
            else void process.env.FENEL_REGEX_SHIM_DEBUG;
          }
          ${fails ? 'throw new Error("trace failure fixture");' : 'process.stdout.write("trace complete\\n");'}
        `,
        [`${WORKER_DIRECTORY}/trace-λ🙂.ts`]: "export {};\n",
      });
      expect(result.exitCode === 0, result.stderr).toBe(!fails);
      if (fails) expect(result.stderr).toContain("trace failure fixture");
      else expect(result.stdout).toBe("trace complete\n");
      expect(Buffer.byteLength(result.trace, "utf8")).toBeGreaterThan(128 * 1024);
      expect(result.trace.endsWith("\n")).toBe(true);
      const events = result.trace.trimEnd().split("\n").map(line => JSON.parse(line));
      const absent = events.filter(({ kind }) => kind === "env-absent");
      expect(absent.map(({ key }) => key)).toEqual(Array.from({ length: 4096 }, (_, index) =>
        index % 2 === 0 ? "FENEL_SIMULATE_BROWSER" : "FENEL_REGEX_SHIM_DEBUG"));
      // Static module loading can bypass Bun's partial resolver hooks; the
      // closing detective cache witness still records its exact UTF-8 path.
      expect(events.find(({ kind }) => kind === "loaded-modules")?.labels)
        .toContainEqual({ scope: "snapshot", value: `${WORKER_DIRECTORY}/trace-λ🙂.ts` });
      expect(events.filter(({ kind }) => kind === "preload-ready")).toHaveLength(1);
      expect(events.filter(({ kind }) => kind === "loaded-modules")).toHaveLength(1);
      expect(events.at(-1)?.kind).toBe("loaded-modules");
    });
  }

  test("flushes traced reads from worker exit listeners after closing module evidence", () => {
    const result = run(`
      process.once("exit", () => { void process.env.FENEL_REGEX_SHIM_DEBUG; });
      void process.env.FENEL_SIMULATE_BROWSER;
    `);
    expect(result.exitCode, result.stderr).toBe(0);
    const events = result.trace.trimEnd().split("\n").map(line => JSON.parse(line));
    expect(events.filter(({ kind }) => kind === "loaded-modules")).toHaveLength(1);
    expect(events.at(-1)).toEqual({ kind: "env-absent", key: "FENEL_REGEX_SHIM_DEBUG" });
  });

  test("loads only manifest bytes, fixes both environment views, and preserves stdout", () => {
    const result = run(`
      const key = Symbol.for("fenel.m3b.worker-path");
      const worker = (globalThis as unknown as Record<symbol, string>)[key];
      await import(worker);
    `, {
      [WORKER_RELATIVE]: `
      import { value } from "./dep";
      import { generatedValue } from "./dep.generated";
      import raw from "./body.fenel?raw";
      const descriptor = Object.getOwnPropertyDescriptor(globalThis, Symbol.for("fenel.m3b.worker-path"));
      process.stdout.write(JSON.stringify({
        value,
        generatedValue,
        raw,
        processPresent: process.env.NODE_ENV,
        bunPresent: Bun.env.NODE_ENV,
        processAbsent: process.env.FENEL_SIMULATE_BROWSER ?? null,
        bunAbsent: Bun.env.FENEL_REGEX_SHIM_DEBUG ?? null,
        ambientOwn: Object.hasOwn(Bun.env, "M3B_AMBIENT_SECRET"),
        launcherOwn: Object.hasOwn(Bun.env, "FENEL_M3B_WORKER_PATH"),
        workerPathLocked: descriptor?.configurable === false && descriptor.writable === false,
        tempInside: process.env.TEMP?.endsWith(".tmp"),
        visibleLocaleRows: [process.env.LANG, process.env.LC_ALL, process.env.TZ],
        bunVisibleLocaleRows: [Bun.env.LANG, Bun.env.LC_ALL, Bun.env.TZ],
      }) + "\\n");
      `,
      [`${WORKER_DIRECTORY}/dep.ts`]: "export const value = 42;\n",
      [`${WORKER_DIRECTORY}/dep.generated.ts`]: "export const generatedValue = 43;\n",
      [`${WORKER_DIRECTORY}/body.fenel`]: "module test\n",
    });
    expect(result.exitCode, `${result.stderr}\nTRACE:\n${result.trace}`).toBe(0);
    expect(JSON.parse(result.stdout)).toEqual({
      value: 42,
      generatedValue: 43,
      raw: "module test\n",
      processPresent: "production",
      bunPresent: "production",
      processAbsent: null,
      bunAbsent: null,
      ambientOwn: false,
      launcherOwn: false,
      workerPathLocked: true,
      tempInside: true,
      visibleLocaleRows: ["C", "C", "UTC"],
      bunVisibleLocaleRows: ["C", "C", "UTC"],
    });
    const events = result.trace.trimEnd().split("\n").map((line) => JSON.parse(line));
    expect(events.filter(({ kind }) => kind === "preload-ready")).toEqual([
      expect.objectContaining({
        resolverCoverage: "partial-runtime-hooks",
        primaryImportFence: "acquired-materialized-source-closure",
      }),
    ]);
    expect(events.some(({ kind, key }) => kind === "env-present" && key === "NODE_ENV")).toBe(true);
    expect(events.some(({ kind, key }) => kind === "env-absent" && key === "FENEL_REGEX_SHIM_DEBUG"))
      .toBe(true);
    expect(events.some(({ kind, path }) => kind === "read" && path === WORKER_RELATIVE)).toBe(true);
    expect(events.some(({ kind, path }) => kind === "read" && path === `${WORKER_DIRECTORY}/body.fenel`))
      .toBe(true);
    const loadedEvents = events.filter(({ kind }) => kind === "loaded-modules");
    expect(loadedEvents).toHaveLength(1);
    expect(Object.keys(loadedEvents[0]!).sort()).toEqual([
      "cacheSources",
      "kind",
      "labels",
      "mode",
    ]);
    expect(loadedEvents[0]!.mode).toBe("detective");
    expect(loadedEvents[0]!.cacheSources).toEqual([
      "Module._cache",
      "require.cache",
      "createRequire(import.meta.url).cache",
    ]);
    const loadedLabels = loadedEvents[0]!.labels as { readonly scope: string; readonly value: string }[];
    expect(loadedLabels).toEqual([...loadedLabels].sort((left, right) =>
      Buffer.compare(Buffer.from(`${left.scope}\0${left.value}`), Buffer.from(`${right.scope}\0${right.value}`))));
    expect(new Set(loadedLabels.map(({ scope, value }) => `${scope}\0${value}`)).size)
      .toBe(loadedLabels.length);
    expect(loadedLabels).toContainEqual({ scope: "snapshot", value: WORKER_RELATIVE });
    expect(loadedLabels).toContainEqual({ scope: "snapshot", value: `${WORKER_DIRECTORY}/dep.ts` });
    expect(loadedLabels).toContainEqual({
      scope: "snapshot",
      value: `${WORKER_DIRECTORY}/dep.generated.ts`,
    });
    expect(loadedLabels.some(({ scope }) => scope === "outside"), JSON.stringify(loadedLabels))
      .toBe(false);
    expect(result.trace).not.toContain("must-be-scrubbed");
    expect(result.trace).not.toContain(result.root);
    expect(result.trace).not.toContain(result.root.replaceAll("\\", "/"));
  });

  test("denies undeclared reads in process.env and the non-replaceable Bun.env object", () => {
    for (const expression of [
      "process.env.M3B_AMBIENT_SECRET",
      "Bun.env.M3B_AMBIENT_SECRET",
    ]) {
      const result = run(`process.stdout.write(String(${expression}) + "\\n");\n`);
      expect(result.exitCode).not.toBe(0);
      expect(result.stderr).toContain("read undeclared environment key M3B_AMBIENT_SECRET");
      expect(result.trace).toContain('"kind":"env-undeclared"');
    }
  });

  test("denies process environment enumeration", () => {
    const result = run("process.stdout.write(JSON.stringify(Object.keys(process.env)) + '\\n');\n");
    expect(result.exitCode).not.toBe(0);
    expect(result.stderr).toContain("may not enumerate the environment");
    expect(result.trace).toContain('"kind":"env-enumeration-denied"');
  });

  test("makes process.env immutable and locks its process binding", () => {
    for (const source of [
      'process.env.NODE_ENV = "development";\n',
      'process.env.FENEL_SIMULATE_BROWSER = "1";\n',
      'Object.defineProperty(process.env, "NODE_ENV", { value: "development" });\n',
      'delete process.env.NODE_ENV;\n',
      'Object.setPrototypeOf(process.env, null);\n',
      'Object.preventExtensions(process.env);\n',
    ]) {
      const result = run(source);
      expect(result.exitCode, `${source}\n${result.stderr}`).not.toBe(0);
      expect(result.stderr).toContain("may not mutate the environment");
      expect(result.trace).toContain('"kind":"env-mutation-denied"');
    }

    const replacement = run("process.env = {} as NodeJS.ProcessEnv;\n");
    expect(replacement.exitCode).not.toBe(0);
    expect(replacement.stderr).toMatch(/read.?only/iu);
  });

  test("locks retained Bun.env rows and denies ordinary additions through its guarded prototype", () => {
    const result = run(`
      const descriptor = Object.getOwnPropertyDescriptor(Bun.env, "NODE_ENV");
      const denied: string[] = [];
      for (const [name, mutate] of [
        ["fixed-set", () => { Bun.env.NODE_ENV = "development"; }],
        ["fixed-delete", () => { delete Bun.env.NODE_ENV; }],
        ["absent-set", () => { Bun.env.FENEL_SIMULATE_BROWSER = "1"; }],
      ] as const) {
        try { mutate(); } catch { denied.push(name); }
      }
      process.stdout.write(JSON.stringify({
        descriptorLocked: descriptor?.configurable === false && descriptor.writable === false,
        denied,
        value: Bun.env.NODE_ENV,
        absent: Bun.env.FENEL_SIMULATE_BROWSER ?? null,
      }) + "\\n");
    `);
    expect(result.exitCode, result.stderr).toBe(0);
    expect(JSON.parse(result.stdout)).toEqual({
      descriptorLocked: true,
      denied: ["fixed-set", "fixed-delete", "absent-set"],
      value: "production",
      absent: null,
    });
  });

  test("denies Bun's process.getBuiltinModule ambient-loader escape", () => {
    for (const source of [
      'process.getBuiltinModule("node:fs").readFileSync("C:/ambient.txt");\n',
      'globalThis.process["getBuiltinModule"]("node:fs");\n',
    ]) {
      const result = run(source);
      expect(result.exitCode).not.toBe(0);
      expect(result.stderr).toContain("capability is denied: process.getBuiltinModule");
      expect(result.trace).toContain('"capability":"process.getBuiltinModule"');
    }
  });

  test("denies host-sensitive APIs if a reviewed non-render surface is reached", () => {
    const cases = [
      { source: "Date.now();\n", capability: "time.Date.now" },
      { source: "performance.now();\n", capability: "time.performance.now" },
      { source: 'Math["ran" + "dom"]();\n', capability: "randomness.Math.random" },
      { source: '"x".localeCompare("y");\n', capability: "locale.String.localeCompare" },
      { source: "new Intl.Collator();\n", capability: "locale.Intl" },
      { source: "void process.platform;\n", capability: "process.platform" },
      { source: 'void navigator["plat" + "form"];\n', capability: "navigator.platform" },
      { source: 'Bun["randomUUID" + "v7"]();\n', capability: "Bun.randomUUIDv7" },
      {
        source: 'require("node:crypto").randomBytes(1);\n',
        capability: "randomness.crypto.randomBytes",
      },
      {
        source: 'require("node:crypto").generateKeyPairSync("ed25519");\n',
        capability: "host.crypto.generateKeyPairSync",
      },
      {
        source: 'require("node:crypto").createECDH("secp256k1").generateKeys();\n',
        capability: "host.crypto.createECDH",
      },
      {
        source: 'const crypto = require("node:crypto"); crypto["generate" + "KeyPairSync"]("ed25519");\n',
        capability: "host.crypto.generateKeyPairSync",
      },
      {
        source: 'const CryptoCtor = require("node:crypto")["Diffie" + "Hellman"]; new CryptoCtor(256);\n',
        capability: "host.crypto.DiffieHellman",
      },
      {
        source: 'await require("node:crypto")["web" + "crypto"].subtle["generate" + "Key"]({ name: "Ed25519" }, true, ["sign", "verify"]);\n',
        capability: "host.crypto.webcrypto",
      },
      {
        source: 'await require("node:crypto").subtle["generate" + "Key"]({ name: "Ed25519" }, true, ["sign", "verify"]);\n',
        capability: "host.crypto.subtle",
      },
      {
        source: 'void require("node:crypto")["con" + "stants"];\n',
        capability: "host.crypto.constants",
      },
      {
        source: 'await globalThis.crypto.subtle.generateKey({ name: "Ed25519" }, true, ["sign", "verify"]);\n',
        capability: "host.crypto.subtle.generateKey",
      },
      {
        source: 'const c = globalThis.crypto; const f = Object.getPrototypeOf(c)["getRandom" + "Values"]; f.call(c, new Uint8Array(1));\n',
        capability: "randomness.crypto.getRandomValues",
      },
      {
        source: 'const s = globalThis.crypto.subtle; const f = Object.getPrototypeOf(s)["generate" + "Key"]; await f.call(s, { name: "Ed25519" }, true, ["sign", "verify"]);\n',
        capability: "host.crypto.subtle.generateKey",
      },
      {
        source: 'Buffer["alloc" + "Unsafe"](8);\n',
        capability: "randomness.Buffer.allocUnsafe",
      },
      {
        source: 'process.report["write" + "Report"]("../ambient.json");\n',
        capability: "process.report.writeReport",
      },
    ];
    for (const { source, capability } of cases) {
      const result = run(source);
      expect(result.exitCode, `${source}\n${result.stderr}`).not.toBe(0);
      expect(result.stderr).toContain(`capability is denied: ${capability}`);
      expect(result.trace).toContain(`"capability":"${capability}"`);
    }
  });

  test("denies a runtime Worker read before evaluating its asset URL arguments", () => {
    const result = run(`
      new Worker((process.stdout.write("asset argument evaluated"), new URL("./runtime-worker.ts", import.meta.url)), { type: "module" });
    `, { "runtime-worker.ts": 'process.stdout.write("worker asset executed");\n' });
    expect(result.exitCode).not.toBe(0);
    expect(result.stdout).toBe("");
    expect(result.stderr).toContain("capability is denied: network.Worker");
    expect(result.trace).toContain('"capability":"network.Worker"');
    expect(result.trace).not.toContain('"kind":"load","path":"runtime-worker.ts"');
  });

  test("importing an unused async worker path does not activate host scheduling", () => {
    const result = run(`
      import { prepare } from "./async-client";
      process.stdout.write(typeof prepare);
    `, { "async-client.ts": `
      export function prepare() {
        if (typeof Worker === "undefined") return undefined;
        const worker = new Worker(new URL("./runtime-worker.ts", import.meta.url), { type: "module" });
        return worker;
      }
    ` });
    expect(result.exitCode, result.stderr).toBe(0);
    expect(result.stdout).toBe("function");
    expect(result.trace).not.toContain('"capability":"network.Worker"');
  });

  test("the native-host boolean guard keeps the sealed Bun loader available", () => {
    const source = readFileSync(new URL("../../src/engine-require.ts", import.meta.url), "utf8");
    const result = run(`
      import { hostRequireUnavailable } from "./engine-require";
      process.stdout.write(String(hostRequireUnavailable()));
    `, { "engine-require.ts": source });
    expect(result.exitCode, result.stderr).toBe(0);
    expect(result.stdout).toBe("false");
    expect(result.trace).toContain('"kind":"env-absent","key":"FENEL_SIMULATE_BROWSER"');
  });

  test("denies aliased/computed raw filesystem access but retains deterministic hashing", () => {
    const denied = run(`
      const load = require;
      const fs = load("node:fs");
      fs["read" + "FileSync"]("C:/ambient-secret");
    `);
    expect(denied.exitCode).not.toBe(0);
    expect(denied.stderr).toContain("capability is denied: filesystem.node:fs.readFileSync");
    expect(denied.trace).toContain('"capability":"filesystem.node:fs.readFileSync"');

    const allowed = run(`
      const { createHash } = require("node:crypto");
      process.stdout.write(createHash("sha256").update("stable").digest("hex") + "\\n");
    `);
    expect(allowed.exitCode, allowed.stderr).toBe(0);
    expect(allowed.stdout).toBe(createHash("sha256").update("stable").digest("hex") + "\n");
  });

  test("locks createHash and explicitly binds the unsealable pinned fips descriptor", () => {
    const result = run(`
      const crypto = require("node:crypto");
      const createHashDescriptor = Object.getOwnPropertyDescriptor(crypto, "createHash");
      const fipsDescriptor = Object.getOwnPropertyDescriptor(crypto, "fips");
      process.stdout.write(JSON.stringify({
        createHashLocked:
          createHashDescriptor?.configurable === false
          && createHashDescriptor.writable === false
          && typeof createHashDescriptor.value === "function",
        fipsShapePinned:
          fipsDescriptor?.configurable === false
          && fipsDescriptor.enumerable === false
          && typeof fipsDescriptor.get === "function"
          && typeof fipsDescriptor.set === "function",
      }) + "\\n");
    `);
    expect(result.exitCode, result.stderr).toBe(0);
    expect(JSON.parse(result.stdout)).toEqual({
      createHashLocked: true,
      fipsShapePinned: true,
    });
  });

  test("denies filesystem, network, subprocess, and resolver capabilities without breaking stderr", () => {
    const cases = [
      { source: "Bun.file('./entry.ts');\n", capability: "Bun.file" },
      { source: "Bun.write('./out', 'x');\n", capability: "Bun.write" },
      { source: "Bun.spawnSync([process.execPath, '--version']);\n", capability: "Bun.spawnSync" },
      { source: "fetch('https://example.com');\n", capability: "network.fetch" },
      { source: "Bun.resolveSync('./entry.ts', process.cwd());\n", capability: "Bun.resolveSync" },
    ];
    for (const { source, capability } of cases) {
      const result = run(source);
      expect(result.exitCode).not.toBe(0);
      expect(result.stderr).toContain(`capability is denied: ${capability}`);
      expect(result.trace).toContain(`"capability":"${capability}"`);
    }
  });

  test("denies an unmaterialized runtime file edge exposed to the preload resolver", () => {
    const source = 'const target = process.cwd() + "/missing.ts"; await import(target);\n';
    const result = run(source);
    expect(result.exitCode, `${source}\n${result.stderr}\n${result.trace}`).not.toBe(0);
    expect(result.stderr).toContain("unmaterialized file");
    expect(result.trace).toContain('"kind":"escape-denied"');
  });

  test("detectively exposes a cache-tampered outside module without using stdout", () => {
    const result = run(`
      (require.cache as Record<string, unknown>)[process.cwd() + "/ghost.ts"] = {};
    `);
    expect(result.exitCode, result.stderr).toBe(0);
    expect(result.stdout).toBe("");
    const events = result.trace.trimEnd().split("\n").map((line) => JSON.parse(line));
    const loaded = events.filter(({ kind }) => kind === "loaded-modules");
    expect(loaded).toHaveLength(1);
    expect(loaded[0]!.mode).toBe("detective");
    expect(loaded[0]!.labels).toContainEqual({ scope: "outside", value: "<redacted>" });
    expect(result.trace).not.toContain(result.root);
    expect(result.trace).not.toContain(result.root.replaceAll("\\", "/"));
  });

  test("rejects a row whose bytes change after manifest creation", () => {
    const fixture = snapshot('const target = process.cwd() + "/dep.ts"; await import(target);\n', { "dep.ts": "export {};\n" });
    writeFileSync(join(fixture.root, "dep.ts"), "export const changed = true;\n");
    const result = Bun.spawnSync({
      cmd: [process.execPath, "--no-env-file", "--no-install", "--cwd", fixture.root, "--preload", fixture.preload, fixture.entry],
      cwd: fixture.root,
      env: {
        FENEL_M3B_SNAPSHOT_ROOT: fixture.root,
        FENEL_M3B_TRACE_PATH: fixture.trace,
        FENEL_M3B_WORKER_PATH: fixture.worker,
      },
      stdout: "pipe",
      stderr: "pipe",
    });
    expect(result.exitCode).not.toBe(0);
    expect(result.stderr.toString()).toContain("materialized byte mismatch");
  });

  test("rejects a manifest whose content identity does not bind its rows", () => {
    const fixture = snapshot("export {};\n");
    const manifest = JSON.parse(readFileSync(fixture.manifest, "utf8")) as Record<string, unknown>;
    writeFileSync(fixture.manifest, encodeCanonicalJson({
      ...manifest,
      contentDigest: "0".repeat(64),
    }));
    const result = Bun.spawnSync({
      cmd: [process.execPath, "--no-env-file", "--no-install", "--cwd", fixture.root, "--preload", fixture.preload, fixture.entry],
      cwd: fixture.root,
      env: {
        FENEL_M3B_SNAPSHOT_ROOT: fixture.root,
        FENEL_M3B_TRACE_PATH: fixture.trace,
        FENEL_M3B_WORKER_PATH: fixture.worker,
      },
      stdout: "pipe",
      stderr: "pipe",
    });
    expect(result.exitCode).not.toBe(0);
    expect(result.stderr.toString()).toContain("content digest does not bind its manifest rows");
  });

  test("rejects a manifest row that is not the declared owner worker", () => {
    const fixture = snapshot("export {};\n");
    const result = Bun.spawnSync({
      cmd: [process.execPath, "--no-env-file", "--no-install", "--cwd", fixture.root, "--preload", fixture.preload, fixture.entry],
      cwd: fixture.root,
      env: {
        FENEL_M3B_SNAPSHOT_ROOT: fixture.root,
        FENEL_M3B_TRACE_PATH: fixture.trace,
        FENEL_M3B_WORKER_PATH: fixture.entry,
      },
      stdout: "pipe",
      stderr: "pipe",
    });
    expect(result.exitCode).not.toBe(0);
    expect(result.stderr.toString()).toContain("launcher worker path does not name");
  });

  test("keeps every traced path relative to the snapshot", () => {
    const result = run('const target = process.cwd() + "/dep.ts"; await import(target);\n', { "dep.ts": "export {};\n" });
    expect(result.exitCode, result.stderr).toBe(0);
    expect(result.trace).toContain('"path":"dep.ts"');
    expect(result.trace).not.toContain(result.root);
    expect(result.trace).not.toContain(result.root.replaceAll("\\", "/"));
    for (const line of result.trace.trimEnd().split("\n")) {
      const record = JSON.parse(line) as { path?: string };
      if (record.path === undefined) continue;
      expect(relative(".", record.path).startsWith("..")).toBe(false);
      expect(record.path).not.toMatch(/^[A-Za-z]:[\\/]/);
    }
  });
});

describe("compiled worker narrow util Proxy reflection", () => {
  const reflectionPath = "implementations/typescript/engine/src/engine-bodies-dispatch.ts";
  const probe = (body: string) => run(`
    import { probe } from "./${reflectionPath}";
    console.log(JSON.stringify(probe()));
  `, { [reflectionPath]: `export function probe() { ${body}\n }` });
  const records = (text: string) => text.trim().split("\n").filter(Boolean).map(line => JSON.parse(line));

  test("preserves native trap-free Proxy reflection, hashing, JSON and console after sealing", () => {
    const result = probe(`
      const candidate = (require("node:util") as typeof import("node:util")).types.isProxy;
      const facade = require("node:util").types;
      let traps = 0;
      const trap = () => { traps++; throw new Error("Proxy trap must never run"); };
      const hostile = new Proxy({}, { get: trap, ownKeys: trap, getOwnPropertyDescriptor: trap, getPrototypeOf: trap });
      const revoked = Proxy.revocable({}, {}); revoked.revoke();
      const checks = [candidate(hostile), candidate(revoked.proxy), candidate({}), candidate(null)];
      for (let index = 0; index < 10000; index++) if (!candidate(hostile)) throw new Error("native predicate changed");
      const { createHash } = require("node:crypto");
      const digest = createHash("sha256").update("a").update(new Uint8Array([98, 99])).digest("hex");
      console.error(new Error("expected isolated worker error"));
      const descriptor = Object.getOwnPropertyDescriptor(facade, "isProxy");
      return { checks, traps, digest, frozen: Object.isFrozen(facade), nullPrototype: Object.getPrototypeOf(facade) === null,
        keys: Object.keys(facade), stable: candidate === require("node:util").types.isProxy,
        locked: descriptor.value === candidate && descriptor.writable === false && descriptor.configurable === false,
        errorMessage: new Error("plain error").message };
    `);
    expect(result.exitCode).toBe(0);
    expect(JSON.parse(result.stdout.trim())).toEqual({
      checks: [true, true, false, false], traps: 0,
      digest: "ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad",
      frozen: true, nullPrototype: true, keys: ["isProxy"], stable: true, locked: true, errorMessage: "plain error",
    });
    expect(result.stderr).toContain("expected isolated worker error");
    const trace = records(result.trace);
    expect(trace.some(row => row.kind === "capability-denied" || row.kind === "builtin-denied")).toBe(false);
    expect(trace.filter(row => row.kind === "builtin" && row.specifier === "node:util").length).toBeGreaterThanOrEqual(1);
    // The ten thousand native calls must not produce ten thousand trace rows.
    expect(trace.length).toBeLessThan(200);
    expect(trace.at(-1)?.kind).toBe("loaded-modules");
  });

  test("locks the permitted native slot and both namespace bindings", () => {
    const result = probe(`
      const util = require("node:util");
      const original = util.types.isProxy;
      return { utilFrozen: Object.isFrozen(util), typesFrozen: Object.isFrozen(util.types),
        nativeWrite: Reflect.set(util.types, "isProxy", () => false),
        namespaceWrite: Reflect.set(util, "types", {}),
        addition: Reflect.set(util.types, "anotherPredicate", () => true), stable: util.types.isProxy === original };
    `);
    expect(result.exitCode).toBe(0);
    expect(JSON.parse(result.stdout.trim())).toEqual({
      utilFrozen: true, typesFrozen: true, nativeWrite: false, namespaceWrite: false, addition: false, stable: true,
    });
  });

  test.each([
    ["inspect", 'void require("node:util").inspect;', "host.util.inspect"],
    ["parseArgs", 'require("node:util").parseArgs();', "host.util.parseArgs"],
    ["computed format", 'void require("node:util")["for" + "mat"];', "host.util.format"],
    ["other types member", 'void require("node:util").types.isMap;', "host.util.types.isMap"],
    ["bare util method alias", 'void require("util").inspect;', "host.util.inspect"],
    ["original types namespace", 'void require("node:util/types").isProxy;', "host.util/types.isProxy"],
    ["bare types namespace", 'void require("util/types").isProxy;', "host.util/types.isProxy"],
  ])("refuses %s without exposing another builtin capability", (_label, body, capability) => {
    const result = probe(body);
    expect(result.exitCode).not.toBe(0);
    const trace = records(result.trace);
    const rejected = trace.some(row => row.kind === "capability-denied" && row.capability === capability)
      || trace.some(row => row.kind === "builtin-denied" || row.kind === "bare-denied");
    expect(rejected).toBe(true);
  });

  test.each(["node:util", "util", "node:util/types", "util/types"])("Module._load cannot acquire %s", name => {
    const result = probe(`
      const Module = require("node:module");
      Module._load(${JSON.stringify(name)}, undefined, false);
      return "must not acquire util";
    `);
    expect(result.exitCode).not.toBe(0);
    const trace = records(result.trace);
    expect(trace.some(row => row.kind === "capability-denied" && row.capability === "host.util.Module._load")
      || trace.some(row => row.kind === "builtin-denied")).toBe(true);
  });
});
