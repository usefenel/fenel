import { describe, expect, test } from "bun:test";
import { createHash } from "node:crypto";
import { mkdirSync, mkdtempSync, rmSync, statSync, utimesSync, writeFileSync } from "node:fs";
import { join, relative } from "node:path";
import { fileURLToPath } from "node:url";
import { crc32 as zlibCrc32, gzipSync } from "node:zlib";
import { sha256OfEncoding } from "../../../implementations/typescript/engine/src/engine-body-memo";
import { REPOSITORY_BYTE_UNIVERSE } from "../../../implementations/typescript/engine/scripts/lib/artifact-bytes";
import { computeEngineBodyReplaySourceEpoch, ENGINE_BODY_REPLAY_TOOL_FILES } from "../../../implementations/typescript/engine/scripts/lib/engine-body-replay-epoch";
import { checkTrackedWorkerEntries, computeEpochInChild, encodingDigest, engineBodyReplayPlugins, ENGINE_BODY_REPLAY_MODULE, foreignSourceModules, replayUniverse, replayUniverseFingerprint, strictArtifactText } from "./engine-body-replay-plugin.mjs";

// S1b browser wiring: no Vite process is started here; the hooks run against a
// minimal plugin context. The real build-order evidence comes from a `vite
// build` (the worker hook fails that build when the order is wrong).
const EPOCH = "a".repeat(64);
const repository = fileURLToPath(new URL("../../../", import.meta.url));
const temporaryRoot = join(repository, ".tmp", "s1b-plugin-tests");
mkdirSync(temporaryRoot, { recursive: true });
const artifactText = (sourceEpoch: string) =>
  `${JSON.stringify({ schema: "fenel.engine-body-replay.v1", keyFormat: 1, sourceEpoch, harnessCertificate: "c", hookGeneration: 0, entries: 0 })}\n[]\n`;

function writeRecordedArtifact(path: string, text: string) {
  const gzip = gzipSync(Buffer.from(text, "utf8"));
  let sourceEpoch = EPOCH;
  try { sourceEpoch = JSON.parse(text.slice(0, text.indexOf("\n"))).sourceEpoch; } catch { /* malformed-artifact control */ }
  writeFileSync(path, gzip);
  writeFileSync(`${path}.stamp.json`, JSON.stringify({ schema: "fenel.engine-body-replay.stamp.v1",
    artifactSha256: createHash("sha256").update(gzip).digest("hex"), textDigest: encodingDigest(text), sourceEpoch, keyFormat: 1 }));
}

function context() {
  const emitted: { fileName: string; source: Uint8Array }[] = [], warnings: string[] = [];
  return {
    emitted, warnings,
    warn: (message: string) => { warnings.push(message); },
    emitFile: (file: { fileName: string; source: Uint8Array }) => { emitted.push(file); return "ref"; },
    error: (message: string): never => { throw new Error(message); },
  };
}

function setup(command: "build" | "serve", text: string | undefined, epochs: { digest: string; latestMtimeMs: number }[]) {
  const directory = mkdtempSync(join(temporaryRoot, "build-"));
  const artifactPath = join(directory, "seed.gz");
  if (text !== undefined) writeRecordedArtifact(artifactPath, text);
  let call = 0;
  const plugins = engineBodyReplayPlugins({ repositoryRoot: directory, artifactPath, now: () => 1000,
    computeEpoch: () => ({ ...epochs[Math.min(call++, epochs.length - 1)]!, fileCount: 1 }) });
  (plugins.main as any).configResolved({ command, base: "/", build: { assetsDir: "assets" } });
  const cleanup = () => rmSync(directory, { recursive: true, force: true });
  return { plugins, directory, artifactPath, cleanup, calls: () => call };
}

const load = async (plugin: any) => {
  const id = plugin.resolveId(ENGINE_BODY_REPLAY_MODULE);
  expect(id).toBe(`\0${ENGINE_BODY_REPLAY_MODULE}`);
  return await plugin.load(id) as string;
};

describe("engine-body replay build plugin", () => {
  test("serve mode without a dev server answers undefined and hashes nothing", async () => {
    const { plugins, cleanup, calls } = setup("serve", artifactText(EPOCH), [{ digest: EPOCH, latestMtimeMs: 0 }]);
    const ctx = context();
    (plugins.main as any).buildStart.call(ctx);
    expect(await load(plugins.main)).toBe("export default undefined;\n");
    expect(await load(plugins.worker())).toBe("export default undefined;\n");
    expect(calls()).toBe(0);
    expect(ctx.emitted).toEqual([]);
    cleanup();
  });

  test("a build binds its own epoch and digest, emits the bytes, and checks the epoch again at the end", async () => {
    const text = artifactText(EPOCH);
    const { plugins, cleanup, calls } = setup("build", text, [{ digest: EPOCH, latestMtimeMs: 10 }]);
    const ctx = context();
    (plugins.main as any).buildStart.call(ctx);
    expect(ctx.warnings).toEqual([]);
    expect(ctx.emitted.length).toBe(1);
    const pin = JSON.parse(/Object\.freeze\((.*)\)/.exec(await load(plugins.worker()))![1]!);
    expect(pin.sourceEpoch).toBe(EPOCH);
    // The plugin's own text digest is the engine's sha256OfEncoding.
    expect(pin.textDigest).toBe(sha256OfEncoding(text));
    expect(encodingDigest("é\u{1F600}")).toBe(sha256OfEncoding("é\u{1F600}"));
    expect(pin.artifactUrl).toBe(`/${ctx.emitted[0]!.fileName}`);
    expect(ctx.emitted[0]!.fileName).toMatch(/^assets\/engine-body-replay-[0-9a-f]{16}\.bin$/);
    expect(pin.artifactSha256).toMatch(/^[0-9a-f]{64}$/);
    (plugins.state as any).workerChecks.push({ entry: "w.js" });
    (plugins.main as any).generateBundle.call(ctx);
    expect(calls()).toBe(2);
    cleanup();
  });

  test("source bytes that change during the build refuse to emit", () => {
    for (const end of [{ digest: "b".repeat(64), latestMtimeMs: 10 }, { digest: EPOCH, latestMtimeMs: 5000 }]) {
      const { plugins, cleanup } = setup("build", artifactText(EPOCH), [{ digest: EPOCH, latestMtimeMs: 10 }, end]);
      const ctx = context();
      (plugins.main as any).buildStart.call(ctx);
      (plugins.state as any).workerChecks.push({ entry: "w.js" });
      expect(() => (plugins.main as any).generateBundle.call(ctx)).toThrow(/changed during the build/);
      cleanup();
    }
  });

  test("a build that checked no worker entry refuses to emit", () => {
    const { plugins, cleanup } = setup("build", artifactText(EPOCH), [{ digest: EPOCH, latestMtimeMs: 10 }]);
    const ctx = context();
    (plugins.main as any).buildStart.call(ctx);
    expect(() => (plugins.main as any).generateBundle.call(ctx)).toThrow(/no tracked worker entry/);
    cleanup();
  });

  test("a missing recorder stamp or changed recorded bytes cannot receive a fresh build pin", async () => {
    for (const mutation of ["missing", "bytes", "metadata"] as const) {
      const { plugins, artifactPath, cleanup } = setup("build", artifactText(EPOCH), [{ digest: EPOCH, latestMtimeMs: 10 }]);
      if (mutation === "missing") rmSync(`${artifactPath}.stamp.json`);
      else if (mutation === "bytes") writeFileSync(artifactPath, gzipSync(artifactText(EPOCH) + "altered result"));
      else {
        writeFileSync(`${artifactPath}.stamp.json`, JSON.stringify({ schema: "fenel.engine-body-replay.stamp.v1",
          artifactSha256: createHash("sha256").update(gzipSync(artifactText(EPOCH))).digest("hex"),
          textDigest: "f".repeat(64), sourceEpoch: EPOCH, keyFormat: 1 }));
      }
      const ctx = context();
      (plugins.main as any).buildStart.call(ctx);
      expect(ctx.emitted).toEqual([]);
      expect(await load(plugins.worker())).toBe("export default undefined;\n");
      expect(ctx.warnings.join("\n")).toMatch(/integrity stamp/);
      cleanup();
    }
  });

  test("an artifact recorded from other bytes, a missing one, or a file dated after the start, is off", async () => {
    for (const [text, epoch, reason] of [
      [artifactText("c".repeat(64)), { digest: EPOCH, latestMtimeMs: 10 }, /other source bytes/],
      [undefined, { digest: EPOCH, latestMtimeMs: 10 }, /no recorded artifact/],
      [artifactText(EPOCH), { digest: EPOCH, latestMtimeMs: 2000 }, /dated after the start/],
      ["not an artifact", { digest: EPOCH, latestMtimeMs: 10 }, /no header|another schema/],
    ] as const) {
      const { plugins, cleanup } = setup("build", text, [epoch]);
      const ctx = context();
      (plugins.main as any).buildStart.call(ctx);
      expect(ctx.emitted).toEqual([]);
      expect(ctx.warnings.join("\n")).toMatch(reason);
      expect(await load(plugins.worker())).toBe("export default undefined;\n");
      (plugins.main as any).generateBundle.call(ctx);
      cleanup();
    }
  });

  // 1c (2026-11-01): the browser decodes the artifact with
  // DecompressionStream("gzip") (one member, nothing after it) and
  // Response.text() (UTF-8, a leading mark stripped, malformed bytes
  // replaced). The pin's textDigest must be the digest of THAT text, so the
  // plugin refuses every artifact on which Node's gunzip + toString would read
  // another text. Each artifact below has a recorder stamp that matches what
  // the previous plugin decoded, so only the decoding can refuse it.
  test("a multi-member gzip, trailing bytes, malformed UTF-8 or a byte order mark is refused at build", async () => {
    const valid = artifactText(EPOCH);
    const utf8 = (s: string) => Buffer.from(s, "utf8");
    const cases: [string, Buffer, string, RegExp][] = [
      ["two members", Buffer.concat([gzipSync(utf8(valid)), gzipSync(utf8("{\"more\":1}"))]), `${valid}{"more":1}`, /after the first member/],
      ["an empty second member", Buffer.concat([gzipSync(utf8(valid)), gzipSync(Buffer.alloc(0))]), valid, /after the first member/],
      ["trailing bytes", Buffer.concat([gzipSync(utf8(valid)), Buffer.from("junkjunk")]), valid, /after the first member/],
      ["malformed UTF-8", gzipSync(Buffer.concat([utf8(valid), Buffer.from([0xc3, 0x28, 0xff])])), `${valid}�(�`, /not valid UTF-8/],
      ["a byte order mark", gzipSync(utf8(`﻿${valid}`)), `﻿${valid}`, /byte order mark/],
    ];
    for (const [name, gzip, nodeText, reason] of cases) {
      const { plugins, artifactPath, cleanup } = setup("build", valid, [{ digest: EPOCH, latestMtimeMs: 10 }]);
      writeFileSync(artifactPath, gzip);
      writeFileSync(`${artifactPath}.stamp.json`, JSON.stringify({ schema: "fenel.engine-body-replay.stamp.v1",
        artifactSha256: createHash("sha256").update(gzip).digest("hex"), textDigest: encodingDigest(nodeText), sourceEpoch: EPOCH, keyFormat: 1 }));
      const ctx = context();
      (plugins.main as any).buildStart.call(ctx);
      expect({ name, emitted: ctx.emitted.length }).toEqual({ name, emitted: 0 });
      expect({ name, warning: reason.test(ctx.warnings.join("\n")) }).toEqual({ name, warning: true });
      expect(await load(plugins.worker())).toBe("export default undefined;\n");
      cleanup();
    }
  });

  test("the strict decoding reads exactly the browser's text from one well-formed member", async () => {
    const text = `${artifactText(EPOCH)}values é\u{1F600}  `;
    for (const gzip of [gzipSync(Buffer.from(text, "utf8")), gzipSync(Buffer.from(text, "utf8"), { level: 1 })]) {
      expect(strictArtifactText(gzip)).toBe(text);
      // The browser's own decoding of the same bytes (Bun implements both).
      expect(await new Response(new Blob([gzip]).stream().pipeThrough(new DecompressionStream("gzip"))).text()).toBe(text);
    }
    // Optional header fields (an extra field, a name, a comment, a header CRC) are read, not refused.
    const plain = gzipSync(Buffer.from(text, "utf8"));
    const deflate = plain.subarray(10, plain.length - 8), trailer = plain.subarray(plain.length - 8);
    const head = Buffer.from([0x1f, 0x8b, 8, 4 | 8 | 16 | 2, 0, 0, 0, 0, 0, 255, 2, 0, 0x41, 0x42]);
    const named = Buffer.concat([head, Buffer.from("seed\0comment\0")]);
    const headerCrc = Buffer.alloc(2);
    headerCrc.writeUInt16LE(zlibCrc32(named) & 0xffff);
    expect(strictArtifactText(Buffer.concat([named, headerCrc, deflate, trailer]))).toBe(text);
    headerCrc.writeUInt16LE((zlibCrc32(named) + 1) & 0xffff);
    expect(() => strictArtifactText(Buffer.concat([named, headerCrc, deflate, trailer]))).toThrow(/header CRC/);
    expect(() => strictArtifactText(plain.subarray(0, plain.length - 1))).toThrow();
    // A flipped trailer CRC or size refuses.
    const badCrc = Buffer.from(plain); badCrc[badCrc.length - 8]! ^= 1;
    expect(() => strictArtifactText(badCrc)).toThrow(/CRC-32/);
    const badSize = Buffer.from(plain); badSize[badSize.length - 4]! ^= 1;
    expect(() => strictArtifactText(badSize)).toThrow(/size/);
  });
});

describe("dev server binding", () => {
  function devServer(text: string | undefined, epoch = { digest: EPOCH, latestMtimeMs: 10 }, watching = true) {
    const directory = mkdtempSync(join(temporaryRoot, "dev-"));
    const artifactPath = join(directory, "seed.gz");
    if (text !== undefined) writeRecordedArtifact(artifactPath, text);
    let mtime = epoch.latestMtimeMs, digest = epoch.digest, readable = true;
    const universe = { contains: (path: string) => path.replaceAll("\\", "/").includes("/engine/src/"),
      watched: ["universe"] };
    const plugins = engineBodyReplayPlugins({ repositoryRoot: directory, artifactPath, now: () => 1000,
      computeEpoch: () => {
        if (!readable) throw new Error("source missing");
        return { digest, latestMtimeMs: mtime, fileCount: 1 };
      },
      fingerprint: async () => {
        if (!readable) throw new Error("source missing");
        return { digest: `metadata-${digest}`, latestMtimeMs: mtime };
      }, universe });
    (plugins.main as any).configResolved({ command: "serve", base: "/", build: { assetsDir: "assets" } });
    const listeners = new Map<string, (...args: string[]) => void>();
    const warnings: string[] = [], invalidated: unknown[] = [], reloads: unknown[] = [];
    let middleware!: (request: any, response: any, next: () => void) => unknown;
    const module = { id: "virtual" };
    (plugins.main as any).configureServer({
      config: { logger: { warn: (message: string) => warnings.push(message) }, server: { watch: watching ? {} : null } },
      moduleGraph: { getModuleById: () => module, invalidateModule: (m: unknown) => invalidated.push(m) },
      watcher: { add: () => {}, on: (name: string, listener: (...args: string[]) => void) => listeners.set(name, listener) },
      ws: { send: (message: unknown) => reloads.push(message) },
      middlewares: { use: (handler: typeof middleware) => { middleware = handler; } },
    });
    const request = async (url: string) => {
      const response: any = { statusCode: 200, headers: {} as Record<string, string>, body: undefined as unknown,
        setHeader(name: string, value: string) { this.headers[name] = value; }, end(body?: unknown) { this.body = body; } };
      let passed = false;
      await middleware({ url }, response, () => { passed = true; });
      return { response, passed };
    };
    const change = (path: string) => { listeners.get("all")!("change", path); };
    return { plugins, directory, request, change, warnings, invalidated, reloads, touch: (ms: number) => { mtime = ms; },
      replace: () => { digest = "b".repeat(64); }, unreadable: () => { readable = false; }, readable: () => { readable = true; },
      watcherError: () => { listeners.get("error")!(); },
      cleanup: () => rmSync(directory, { recursive: true, force: true }) };
  }
  const pinOf = async (plugins: any) => {
    const text = await load(plugins.main);
    const match = /Object\.freeze\((.*)\)/.exec(text);
    return match ? JSON.parse(match[1]!) : undefined;
  };

  test("binds at start, serves the bytes and an on status, and passes other requests through", async () => {
    const dev = devServer(artifactText(EPOCH));
    const pin = await pinOf(dev.plugins);
    expect(pin).toMatchObject({ sourceEpoch: EPOCH, statusUrl: "/__fenel/engine-body-replay-status" });
    expect(pin.artifactUrl).toMatch(/^\/__fenel\/engine-body-replay-[0-9a-f]{16}\.bin$/);
    const bytes = (await dev.request(pin.artifactUrl)).response;
    expect(createHash("sha256").update(bytes.body as Uint8Array).digest("hex")).toBe(pin.artifactSha256);
    expect(bytes.headers["Content-Encoding"]).toBeUndefined();
    expect(JSON.parse((await dev.request(pin.statusUrl)).response.body)).toEqual({ on: true, sourceEpoch: EPOCH });
    expect((await dev.request("/assets/app.js")).passed).toBe(true);
    dev.cleanup();
  });

  test("a watched change in the universe switches it off until restart; other changes do not", async () => {
    const dev = devServer(artifactText(EPOCH));
    const pin = await pinOf(dev.plugins);
    dev.change("E:/repo/distros/narthex/solid/src/App.tsx");
    expect(await pinOf(dev.plugins)).toEqual(pin);
    dev.change("E:/repo/implementations/typescript/engine/src/registry.ts");
    expect(await load(dev.plugins.main)).toBe("export default undefined;\n");
    expect(dev.invalidated.length).toBeGreaterThan(0);
    expect(dev.reloads).toEqual([{ type: "full-reload" }]);
    expect(JSON.parse((await dev.request(pin.statusUrl)).response.body)).toMatchObject({ on: false, reason: expect.stringMatching(/changed since the dev server started/) });
    expect((await dev.request(pin.artifactUrl)).response.statusCode).toBe(404);
    expect(await load(dev.plugins.worker())).toBe("export default undefined;\n");
    dev.change("E:/repo/implementations/typescript/engine/src/registry.ts");
    expect(dev.reloads).toHaveLength(1);
    dev.cleanup();
  });

  test("the status refuses a change the watcher has not reported yet (a file dated after the start)", async () => {
    const dev = devServer(artifactText(EPOCH));
    const pin = await pinOf(dev.plugins);
    dev.touch(1500);
    expect(JSON.parse((await dev.request(pin.statusUrl)).response.body).on).toBe(false);
    expect(await load(dev.plugins.main)).toBe("export default undefined;\n");
    dev.touch(10);
    expect(JSON.parse((await dev.request(pin.statusUrl)).response.body).on).toBe(false);
    dev.cleanup();
  });

  test("a check that cannot finish refuses that request only; the next check decides again", async () => {
    const dev = devServer(artifactText(EPOCH));
    const pin = await pinOf(dev.plugins);
    dev.unreadable();
    expect(JSON.parse((await dev.request(pin.statusUrl)).response.body))
      .toEqual({ on: false, reason: "the source files could not be checked" });
    // The pin stays bound and no page is reloaded: nothing is known to have changed.
    expect(await pinOf(dev.plugins)).toEqual(pin);
    expect(dev.reloads).toEqual([]);
    dev.readable();
    expect(JSON.parse((await dev.request(pin.statusUrl)).response.body)).toEqual({ on: true, sourceEpoch: EPOCH });
    // A real change after a failed check still retires the pin for the server's life.
    dev.unreadable();
    expect(JSON.parse((await dev.request(pin.statusUrl)).response.body).on).toBe(false);
    dev.readable();
    dev.replace();
    expect(JSON.parse((await dev.request(pin.statusUrl)).response.body).on).toBe(false);
    expect(await load(dev.plugins.main)).toBe("export default undefined;\n");
    dev.cleanup();
  });

  test("deletion, timestamp-preserving replacement and watcher failure all retire the pin", async () => {
    for (const mutation of ["replace", "watcherError"] as const) {
      const dev = devServer(artifactText(EPOCH));
      const pin = await pinOf(dev.plugins);
      dev[mutation]();
      expect(JSON.parse((await dev.request(pin.statusUrl)).response.body).on).toBe(false);
      expect(await load(dev.plugins.main)).toBe("export default undefined;\n");
      expect(await load(dev.plugins.worker())).toBe("export default undefined;\n");
      expect(dev.reloads).toEqual([{ type: "full-reload" }]);
      dev.cleanup();
    }
  });

  test("a dev source from another checkout retires existing workers and refuses future pins", async () => {
    const dev = devServer(artifactText(EPOCH));
    const pin = await pinOf(dev.plugins);
    (dev.plugins.main as any).transform("", "E:/other/implementations/typescript/engine/src/registry.ts");
    expect(JSON.parse((await dev.request(pin.statusUrl)).response.body)).toMatchObject({ on: false, reason: expect.stringMatching(/outside the hashed tree/) });
    expect(await load(dev.plugins.main)).toBe("export default undefined;\n");
    expect(dev.reloads).toEqual([{ type: "full-reload" }]);
    expect((dev.plugins.main as any).config().optimizeDeps.exclude).toContain("@fenel/engine");
    dev.cleanup();
  });

  test("a dev source from a nested checkout also retires the binding", async () => {
    const dev = devServer(artifactText(EPOCH));
    const pin = await pinOf(dev.plugins);
    (dev.plugins.main as any).transform("", join(dev.directory, ".tmp", "wt", "implementations", "typescript", "engine", "src", "registry.ts"));
    expect(JSON.parse((await dev.request(pin.statusUrl)).response.body)).toMatchObject({ on: false, reason: expect.stringMatching(/outside the hashed tree/) });
    expect(await load(dev.plugins.main)).toBe("export default undefined;\n");
    expect(dev.reloads).toEqual([{ type: "full-reload" }]);
    dev.cleanup();
  });

  test("the watched universe is the epoch's: engine/Fenel sources, exact and tool files, minus recoverable outputs", () => {
    const { contains } = replayUniverse(String.raw`E:\repo`);
    expect(contains(String.raw`E:\repo\implementations\typescript\engine\src\registry.ts`)).toBe(true);
    expect(contains("e:/repo/fenel/modules/std/list.fenel")).toBe(true);
    expect(contains("E:/repo/bun.lock")).toBe(true);
    expect(contains("E:/repo/implementations/typescript/engine/scripts/record-engine-body-replay.ts")).toBe(true);
    expect(contains("E:/repo/implementations/typescript/engine/src/generated/parse-cache.generated.ts")).toBe(false);
    expect(contains("E:/repo/distros/narthex/solid/src/App.tsx")).toBe(false);
    expect(contains("E:/elsewhere/fenel/modules/std/list.fenel")).toBe(false);
  });

  test("a stale artifact is off at dev start", async () => {
    const dev = devServer(artifactText("d".repeat(64)));
    expect(await load(dev.plugins.main)).toBe("export default undefined;\n");
    expect(dev.warnings.join("\n")).toMatch(/other source bytes/);
    expect(JSON.parse((await dev.request("/__fenel/engine-body-replay-status")).response.body).on).toBe(false);
    dev.cleanup();
  });

  test("Vite's disabled noop watcher cannot admit a dev pin", async () => {
    const dev = devServer(artifactText(EPOCH), undefined, false);
    expect(await load(dev.plugins.main)).toBe("export default undefined;\n");
    expect(JSON.parse((await dev.request("/__fenel/engine-body-replay-status")).response.body))
      .toEqual({ on: false, reason: "the source watcher is unavailable" });
    dev.cleanup();
  });
});

describe("dev universe fingerprint (real files)", () => {
  // A miniature repository holding exactly the epoch universe's shape.
  function miniatureRepository() {
    const root = mkdtempSync(join(temporaryRoot, "universe-"));
    const write = (path: string, text: string) => { mkdirSync(join(root, path, ".."), { recursive: true }); writeFileSync(join(root, path), text); };
    for (const file of [...REPOSITORY_BYTE_UNIVERSE.exactFiles, ...ENGINE_BODY_REPLAY_TOOL_FILES]) write(file, `exact ${file}`);
    write("fenel/modules/std/list.fenel", "module std where\n");
    write("implementations/typescript/engine/src/registry.ts", "export {};\n");
    write(REPOSITORY_BYTE_UNIVERSE.exclusions[0]!, "recoverable output");
    return root;
  }

  test("covers the same files as the content epoch and is stable without changes", async () => {
    const root = miniatureRepository();
    const first = await replayUniverseFingerprint(root);
    expect(first.fileCount).toBe(computeEngineBodyReplaySourceEpoch(root).fileCount);
    expect(await replayUniverseFingerprint(root)).toEqual(first);
    rmSync(root, { recursive: true, force: true });
  });

  test("a same-size rewrite with a restored modification time, an addition, a deletion and an excluded output", async () => {
    const root = miniatureRepository();
    const source = join(root, "fenel/modules/std/list.fenel");
    // An exactly representable time, so restoring it restores mtimeNs: only
    // the change time can then reveal the rewrite. NTFS advances it on a
    // coarse clock, so the rewrite comes later than one tick. The dev status
    // check admits on equal metadata alone (owner decision B, 2026-10-30), so
    // this change-time witness is what retires the pin.
    utimesSync(source, 1_700_000_000, 1_700_000_000);
    const base = await replayUniverseFingerprint(root);
    const { mtimeNs } = statSync(source, { bigint: true });
    await new Promise(resolve => setTimeout(resolve, 100));
    writeFileSync(source, "module xyz where\n");
    utimesSync(source, 1_700_000_000, 1_700_000_000);
    expect(statSync(source, { bigint: true }).mtimeNs).toBe(mtimeNs);
    const rewritten = await replayUniverseFingerprint(root);
    expect(rewritten.digest).not.toBe(base.digest);
    writeFileSync(join(root, "fenel/modules/std/extra.fenel"), "x");
    const added = await replayUniverseFingerprint(root);
    expect(added.digest).not.toBe(rewritten.digest);
    rmSync(join(root, "fenel/modules/std/extra.fenel"));
    rmSync(join(root, "implementations/typescript/engine/src/registry.ts"));
    expect((await replayUniverseFingerprint(root)).digest).not.toBe(added.digest);
    const settled = await replayUniverseFingerprint(root);
    writeFileSync(join(root, REPOSITORY_BYTE_UNIVERSE.exclusions[0]!), "regenerated output");
    expect(await replayUniverseFingerprint(root)).toEqual(settled);
    rmSync(join(root, "package.json"));
    await expect(replayUniverseFingerprint(root)).rejects.toThrow();
    rmSync(root, { recursive: true, force: true });
  });

  test("the child-process epoch equals the synchronous hasher", async () => {
    const root = miniatureRepository();
    const child = await computeEpochInChild(root);
    const direct = computeEngineBodyReplaySourceEpoch(root);
    expect(child).toEqual({ ...direct });
    rmSync(root, { recursive: true, force: true });
  }, 60000);

  function scriptedDev(options: { fingerprint: () => Promise<{ digest: string; latestMtimeMs: number }>; epoch: () => string }) {
    const directory = mkdtempSync(join(temporaryRoot, "dev-"));
    const artifactPath = join(directory, "seed.gz");
    writeRecordedArtifact(artifactPath, artifactText(EPOCH));
    const counts = { epochs: 0, fingerprints: 0 };
    const plugins = engineBodyReplayPlugins({ repositoryRoot: directory, artifactPath, now: () => 1000,
      computeEpoch: () => { counts.epochs++; return { digest: options.epoch(), latestMtimeMs: 10, fileCount: 1 }; },
      fingerprint: async () => { counts.fingerprints++; return options.fingerprint(); },
      universe: { contains: () => false, watched: [] } });
    (plugins.main as any).configResolved({ command: "serve", base: "/", build: { assetsDir: "assets" } });
    let middleware!: (request: any, response: any, next: () => void) => Promise<void>;
    (plugins.main as any).configureServer({ config: { logger: { warn: () => {} }, server: { watch: {} } },
      moduleGraph: { getModuleById: () => undefined }, watcher: { add: () => {}, on: () => {} }, ws: { send: () => {} },
      middlewares: { use: (handler: typeof middleware) => { middleware = handler; } } });
    const ask = async () => {
      let body = "";
      await middleware({ url: "/__fenel/engine-body-replay-status" }, { setHeader() {}, end(text: string) { body = text; } }, () => {});
      return JSON.parse(body).on as boolean;
    };
    return { plugins, counts, ask, cleanup: () => rmSync(directory, { recursive: true, force: true }) };
  }

  test("requests during a running check share the NEXT check, a metadata check only", async () => {
    const dev = scriptedDev({ fingerprint: async () => { await new Promise(resolve => setTimeout(resolve, 20)); return { digest: "m", latestMtimeMs: 10 }; },
      epoch: () => EPOCH });
    await load(dev.plugins.main);
    expect(dev.counts).toEqual({ epochs: 1, fingerprints: 1 });
    expect(await Promise.all([dev.ask(), dev.ask(), dev.ask()])).toEqual([true, true, true]);
    // The first request runs one check; the two that arrived during it share
    // one more. Neither recomputes the content epoch (bound once at start).
    expect(dev.counts).toEqual({ epochs: 1, fingerprints: 3 });
    dev.cleanup();
  });

  test("a request never reuses a check that started before a file changed", async () => {
    let digest = "m";
    let releaseFirst!: () => void;
    let calls = 0;
    const dev = scriptedDev({ epoch: () => EPOCH, fingerprint: async () => {
      calls++;
      const seen = digest;
      // The first status check sampled the old metadata and is still running.
      if (calls === 2) await new Promise<void>(resolve => { releaseFirst = resolve; });
      return { digest: seen, latestMtimeMs: 10 };
    } });
    await load(dev.plugins.main);
    const first = dev.ask();
    await new Promise(resolve => setTimeout(resolve, 10));
    digest = "changed";
    const second = dev.ask();
    releaseFirst();
    expect(await first).toBe(true);
    expect(await second).toBe(false);
    dev.cleanup();
  });

  test("a status answer computes no content epoch: the epoch stays at its startup count", async () => {
    const dev = scriptedDev({ fingerprint: async () => ({ digest: "m", latestMtimeMs: 10 }), epoch: () => EPOCH });
    await load(dev.plugins.main);
    expect(dev.counts).toEqual({ epochs: 1, fingerprints: 1 });
    for (let index = 0; index < 4; index++) expect(await dev.ask()).toBe(true);
    expect(dev.counts).toEqual({ epochs: 1, fingerprints: 5 });
    dev.cleanup();
  });

  test("decision B: equal metadata over changed bytes (a writer forging change time and file id) is admitted", async () => {
    // Documented residual (design/tcb-ledger.md, dev status amendment of
    // 2026-10-30, decision B): the status trusts the metadata fingerprint;
    // only a writer that forges both change times and file ids escapes it.
    let epoch = EPOCH;
    const dev = scriptedDev({ fingerprint: async () => ({ digest: "m", latestMtimeMs: 10 }), epoch: () => epoch });
    const pin = await load(dev.plugins.main);
    expect(await dev.ask()).toBe(true);
    epoch = "b".repeat(64);
    expect(await dev.ask()).toBe(true);
    expect(await load(dev.plugins.main)).toBe(pin);
    dev.cleanup();
  });

  test("every metadata-visible change still retires the pin: a new digest (deletion, new file id or change time) or a later date", async () => {
    for (const changed of [{ digest: "m-deleted", latestMtimeMs: 10 }, { digest: "m", latestMtimeMs: 1500 }]) {
      let current = { digest: "m", latestMtimeMs: 10 };
      const dev = scriptedDev({ fingerprint: async () => current, epoch: () => EPOCH });
      await load(dev.plugins.main);
      expect(await dev.ask()).toBe(true);
      current = changed;
      expect(await dev.ask()).toBe(false);
      expect(await load(dev.plugins.main)).toBe("export default undefined;\n");
      // Retired for the server's life, even once the metadata looks equal again.
      current = { digest: "m", latestMtimeMs: 10 };
      expect(await dev.ask()).toBe(false);
      dev.cleanup();
    }
  });
});

describe("bundled sources outside the hashed tree", () => {
  const chunk = (moduleIds: string[]) => ({ type: "chunk", fileName: "c.js", moduleIds, imports: [], dynamicImports: [] });
  test("a worktree bundle holding the main checkout's engine is foreign; its own tree is not", () => {
    const own = ["E:/rom/projects/fenel/.tmp/wt/implementations/typescript/engine/src/registry.ts",
      "e:/rom/projects/fenel/.tmp/wt/fenel/modules/std/list.fenel", "\0virtual:x", "E:/rom/projects/fenel/node_modules/solid-js/dist/solid.js"];
    const foreign = ["E:/rom/projects/fenel/implementations/typescript/engine/src/registry-public.ts",
      "E:/rom/projects/fenel/fenel/modules/std/list.fenel", "E:/rom/projects/fenel/.tmp/wt/distros/narthex/solid/node_modules/@fenel/engine/src/index.ts"];
    expect(foreignSourceModules({ a: chunk(own) }, "E:\\rom\\projects\\fenel\\.tmp\\wt\\")).toEqual([]);
    expect(foreignSourceModules({ a: chunk([...own, ...foreign]) }, "E:\\rom\\projects\\fenel\\.tmp\\wt")).toEqual(foreign);
  });

  test("a nested checkout is outside the owning source roots despite its repository prefix", () => {
    const own = ["E:/repo/implementations/typescript/engine/src/registry.ts", "E:/repo/fenel/modules/std/list.fenel"];
    const nested = ["E:/repo/.tmp/wt/implementations/typescript/engine/src/registry.ts",
      "e:/repo/.tmp/wt/fenel/modules/std/list.fenel"];
    expect(foreignSourceModules({ a: chunk([...own, ...nested]) }, "E:/repo")).toEqual(nested);
  });

  test("the worker hook refuses a pinned bundle with foreign engine sources", () => {
    const { plugins, directory, cleanup } = setup("build", artifactText(EPOCH), [{ digest: EPOCH, latestMtimeMs: 10 }]);
    const ctx = context();
    (plugins.main as any).buildStart.call(ctx);
    const worker = plugins.worker() as any;
    const bundle = { a: chunk([`\0${ENGINE_BODY_REPLAY_MODULE}`, "E:/elsewhere/implementations/typescript/engine/src/registry.ts"]) };
    expect(() => worker.generateBundle.call(ctx, {}, bundle)).toThrow(/outside the hashed tree/);
    const nested = { a: chunk([`\0${ENGINE_BODY_REPLAY_MODULE}`,
      join(directory, ".tmp", "wt", "implementations", "typescript", "engine", "src", "registry.ts")]) };
    expect(() => worker.generateBundle.call(ctx, {}, nested)).toThrow(/outside the hashed tree/);
    cleanup();
  });
});

describe("tracked worker entry order", () => {
  const root = "E:/repo";
  const entryId = `${root}/distros/narthex/solid/src/lib/expression-runner/authoring-catalog.worker.ts`;
  const install = `${root}/implementations/typescript/engine/src/proxy-tracking-install.ts`;
  const state = `${root}/implementations/typescript/engine/src/proxy-tracking-state.ts`;
  const chunk = (fileName: string, moduleIds: string[], extra: Record<string, unknown> = {}) =>
    ({ type: "chunk", fileName, moduleIds, imports: [], dynamicImports: [], isEntry: false, facadeModuleId: null, ...extra });
  const moduleInfo = (id: string) => ({
    importedIds: id === entryId ? [install] : id === install ? [state] : [],
    dynamicallyImportedIds: id === entryId ? [`${root}/x/main.ts`] : [],
  });

  test("an entry whose static graph is exactly the install and its state leaf passes", () => {
    const bundle = {
      "w.js": chunk("w.js", [state, install, entryId], { isEntry: true, facadeModuleId: entryId, dynamicImports: ["main.js"] }),
      "main.js": chunk("main.js", [`${root}/implementations/typescript/engine/src/engine-require.ts`, `${root}/x/main.ts`]),
    };
    const { problems, checked } = checkTrackedWorkerEntries(bundle, moduleInfo);
    expect(problems).toEqual([]);
    expect(checked.length).toBe(1);
  });

  test("an engine module hoisted into the entry's static graph fails", () => {
    const bundle = {
      "w.js": chunk("w.js", [state, install, entryId], { isEntry: true, facadeModuleId: entryId, imports: ["shared.js"], dynamicImports: ["main.js"] }),
      "shared.js": chunk("shared.js", [`${root}/implementations/typescript/engine/src/engine-require.ts`]),
      "main.js": chunk("main.js", [`${root}/x/main.ts`], { imports: ["shared.js"] }),
    };
    expect(checkTrackedWorkerEntries(bundle, moduleInfo).problems.join("\n")).toMatch(/statically loads .*engine-require\.ts/);
  });

  test("a missing install, an install after the entry body, or no dynamic import fails", () => {
    expect(checkTrackedWorkerEntries({ "w.js": chunk("w.js", [state, entryId], { isEntry: true, facadeModuleId: entryId, dynamicImports: ["m.js"] }) }, moduleInfo)
      .problems.join("\n")).toMatch(/install module is not/);
    expect(checkTrackedWorkerEntries({ "w.js": chunk("w.js", [state, entryId, install], { isEntry: true, facadeModuleId: entryId, dynamicImports: ["m.js"] }) }, moduleInfo)
      .problems.join("\n")).toMatch(/do not evaluate first/);
    expect(checkTrackedWorkerEntries({ "w.js": chunk("w.js", [state, install, entryId], { isEntry: true, facadeModuleId: entryId }) }, moduleInfo)
      .problems.join("\n")).toMatch(/no dynamic import/);
  });

  test("missing, duplicate, foreign or reordered state leaves fail", () => {
    const bundle = (ids: string[]) => ({ "w.js": chunk("w.js", ids,
      { isEntry: true, facadeModuleId: entryId, dynamicImports: ["m.js"] }) });
    expect(checkTrackedWorkerEntries(bundle([install, entryId]), moduleInfo).problems.join("\n")).toMatch(/state leaf must occur exactly once/);
    expect(checkTrackedWorkerEntries(bundle([state, `${state}?duplicate`, install, entryId]), moduleInfo).problems.join("\n"))
      .toMatch(/state leaf must occur exactly once/);
    expect(checkTrackedWorkerEntries(bundle([state.replace("E:/repo", "E:/other"), install, entryId]), moduleInfo).problems.join("\n"))
      .toMatch(/different engine copies/);
    expect(checkTrackedWorkerEntries(bundle([install, state, entryId]), moduleInfo).problems.join("\n")).toMatch(/do not evaluate first/);
  });

  test("the exact bootstrap import edges refuse added or dynamic dependencies and missing evidence", () => {
    const bundle = { "w.js": chunk("w.js", [state, install, entryId],
      { isEntry: true, facadeModuleId: entryId, dynamicImports: ["m.js"] }) };
    const extra = `${root}/implementations/typescript/engine/src/engine-require.ts`;
    for (const id of [entryId, install, state]) {
      const altered = (current: string) => ({ ...moduleInfo(current),
        ...(current === id ? { importedIds: [...moduleInfo(current).importedIds, extra] } : {}) });
      expect(checkTrackedWorkerEntries(bundle, altered).problems.join("\n")).toMatch(/unexpected Proxy-tracking bootstrap dependencies/);
    }
    for (const id of [install, state]) {
      const altered = (current: string) => ({ ...moduleInfo(current),
        ...(current === id ? { dynamicallyImportedIds: [extra] } : {}) });
      expect(checkTrackedWorkerEntries(bundle, altered).problems.join("\n")).toMatch(/unexpected Proxy-tracking bootstrap dependencies/);
    }
    expect(checkTrackedWorkerEntries(bundle, undefined).problems.join("\n")).toMatch(/unexpected Proxy-tracking bootstrap dependencies/);
  });

  test("a separately emitted state dependency still precedes the install", () => {
    const bundle = {
      "w.js": chunk("w.js", [install, entryId], { isEntry: true, facadeModuleId: entryId,
        imports: ["state.js"], dynamicImports: ["m.js"] }),
      "state.js": chunk("state.js", [state]),
    };
    expect(checkTrackedWorkerEntries(bundle, moduleInfo).problems).toEqual([]);
  });
});

test("real Vite bundles the production worker entry with the install before its dynamic graph", async () => {
  const { build } = await import("vite");
  const directory = mkdtempSync(join(temporaryRoot, "vite-"));
  const artifactPath = join(directory, "seed.gz");
  writeRecordedArtifact(artifactPath, artifactText(EPOCH));
  const entry = fileURLToPath(new URL("./src/lib/expression-runner/authoring-catalog.worker.ts", import.meta.url));
  const app = join(directory, "main.ts");
  writeFileSync(app, `new Worker(new URL(${JSON.stringify(relative(directory, entry).replaceAll("\\", "/"))}, import.meta.url), { type: "module" });\n`);
  const plugins = engineBodyReplayPlugins({ repositoryRoot: repository, artifactPath, now: () => 1000,
    computeEpoch: () => ({ digest: EPOCH, latestMtimeMs: 10, fileCount: 1 }) });
  // Keep the actual production entry and Proxy install. Only their deferred,
  // registry-sized graph is stubbed: this gate checks real bundler ordering,
  // not registry semantics or production bootstrap freshness.
  const lightweightGraph = () => ({
    name: "s1b-fixture-deferred-worker",
    load(id: string) {
      const path = id.replaceAll("\\", "/");
      if (path.endsWith("/authoring-catalog-worker-main.ts")) {
        return "globalThis.onmessage = event => globalThis.postMessage(event.data);";
      }
      if (path.endsWith("/engine-body-replay-boot.ts")) {
        return `import pin from ${JSON.stringify(ENGINE_BODY_REPLAY_MODULE)}; export async function bootEngineBodyReplay(ready) { await ready; return pin; }`;
      }
    },
  });
  try {
    await build({ configFile: false, root: repository, logLevel: "silent", publicDir: false,
      plugins: [plugins.main],
      worker: { format: "es", plugins: () => [plugins.worker(), lightweightGraph()] },
      build: { write: false, target: "esnext", minify: false, rollupOptions: { input: app } },
    });
    expect(plugins.state.workerChecks).toHaveLength(1);
    const checked: unknown = plugins.state.workerChecks[0];
    const strings = (value: unknown): value is readonly string[] =>
      Array.isArray(value) && value.every((item: unknown) => typeof item === "string");
    if (checked === null || typeof checked !== "object"
      || !("modules" in checked) || !strings(checked.modules)
      || !("dynamicImports" in checked) || !strings(checked.dynamicImports)) {
      throw new Error("The bundled worker check has an unreadable module graph.");
    }
    expect(checked.modules.filter(id => !id.startsWith("\0"))).toEqual([
      `${repository.replaceAll("\\", "/").replace(/\/$/, "")}/implementations/typescript/engine/src/proxy-tracking-state.ts`,
      `${repository.replaceAll("\\", "/").replace(/\/$/, "")}/implementations/typescript/engine/src/proxy-tracking-install.ts`,
      entry.replaceAll("\\", "/"),
    ]);
    expect(checked.dynamicImports.length).toBeGreaterThan(0);
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
}, 60_000);
