// Run with node --test: these controls use Node's builtin ESM export
// synchronization and data-URL fragments, beyond Bun's node:test compatibility.
import test from "node:test";
import assert from "node:assert/strict";
import childProcess from "node:child_process";
import { createHash } from "node:crypto";
import { EventEmitter } from "node:events";
import { syncBuiltinESMExports } from "node:module";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { dirname, join, relative, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { build, DevEnvironment, resolveConfig, send, parseAst } from "vite";
import { publicBootstrapExactInputs, isPublicBootstrapInput } from "./public-bootstrap-inputs.mjs";
import { publicBootstrapPlugin, generatedDataBuildPlugin, generatedDataChunk } from "./public-bootstrap-plugin.mjs";

const packageRoot = fileURLToPath(new URL("./", import.meta.url));
const generatedId = name => fileURLToPath(new URL(`./src/lib/generated/${name}`, import.meta.url)).replaceAll("\\", "/");

// C1/C2: only generator process completion is controlled. Vite's real JSON
// transform, map combination and response writer run without a server/listen.
async function withGenerator(run) {
  const original = childProcess.spawn;
  const generator = { outcome: "pass", calls: [] };
  childProcess.spawn = (command, args, options) => {
    generator.calls.push({ command, args, cwd: options.cwd, windowsHide: options.windowsHide });
    const child = new EventEmitter();
    child.stdout = new EventEmitter();
    child.stderr = new EventEmitter();
    const outcome = generator.outcome;
    queueMicrotask(() => {
      if (outcome === "error") child.emit("error", new Error("generator unavailable"));
      else {
        if (outcome === "fail") child.stderr.emit("data", "controlled stale snapshot");
        child.emit("exit", outcome === "fail" ? 1 : 0);
      }
    });
    return child;
  };
  syncBuiltinESMExports();
  try { await run(generator); }
  finally { childProcess.spawn = original; syncBuiltinESMExports(); }
}

// Execute the generator's actual preflight before its expensive registry imports.
// Control only filesystem/process boundaries; chunk validation uses real hashes.
const generatorUrl = new URL("./scripts/generate-public-bootstrap.mjs", import.meta.url);
const generatorSource = await readFile(generatorUrl, "utf8");
// The existing host adapter remains the admission owner. Execute its actual
// capture function with controlled IO rather than reimplementing its policy.
const hostInstallSource = await readFile(new URL("../../../implementations/typescript/engine/src/engine-body-host-install.ts", import.meta.url), "utf8");
function topLevelFunction(source, name) {
  const start = source.indexOf(`function ${name}(`);
  const end = source.indexOf("\n}", start);
  assert.ok(start >= 0 && end > start, `Missing actual function ${name}`);
  return source.slice(start, end + 2);
}
const captureReplaySource = topLevelFunction(hostInstallSource, "captureReplay")
  .replace("(): EngineBodyReplayHostCapture", "()");
const generationPreparationStart = generatorSource.indexOf("function configureGenerationReplay(");
const generationPreparationEnd = generatorSource.indexOf("async function inputDigest(");
assert.ok(generationPreparationStart >= 0 && generationPreparationEnd > generationPreparationStart);
const generationPreparationSource = generatorSource.slice(generationPreparationStart, generationPreparationEnd)
  .replace('await import("../../../../implementations/typescript/engine/src/engine-body-host-install.ts")', "await installGenerationHost()");
const recordedReplay = fileURLToPath(new URL("./.engine-body-replay/seed.gz", import.meta.url));

function generationHostFixture({ env: suppliedEnv = {}, file = "present", opened, readError } = {}) {
  const env = { ...suppliedEnv }, events = [], stats = [], logs = [];
  const process = { env, execArgv: [] };
  const performance = { timeOrigin: 100, now: () => 123 };
  let capture;
  const captureScope = {
    process, performance, repositoryRoot: "controlled-repository",
    computeEngineBodyReplaySourceEpoch: () => ({ digest: "current", latestMtimeMs: 90 }),
    readPinnedReplayArtifactFile(path) {
      events.push(["artifact-read", path]);
      if (readError) throw readError;
      return opened ?? { text: "controlled replay", stamp: { sourceEpoch: "current" } };
    },
  };
  const actualCapture = new Function(...Object.keys(captureScope), `${captureReplaySource}; return captureReplay;`)(...Object.values(captureScope));
  const bindings = {
    process, performance, recordedReplay,
    statSync(path) {
      stats.push(path);
      if (file instanceof Error) throw file;
      if (file === "missing") throw new Error("missing optional file");
      return { isFile: () => file === "present" };
    },
    console: { log(message) { logs.push(message); events.push(["log", message]); } },
    async installGenerationHost() {
      events.push(["host-install", env.FENEL_ENGINE_BODY_REPLAY]);
      capture = actualCapture();
    },
  };
  const api = new Function(...Object.keys(bindings), `${generationPreparationSource}; return {
    configure: configureGenerationReplay, prepare: prepareGenerationHost };`)(...Object.values(bindings));
  return { ...api, env, process, events, stats, logs, capture: () => capture };
}


const preflightStart = generatorSource.indexOf("let priorCatalogue;");
const preflightEnd = generatorSource.indexOf("// These imports use the exact browser projection");
assert.ok(preflightStart >= 0 && preflightEnd > preflightStart);
const runBootstrapPreflight = new Function("host", `
  const { readFile, createHash, resolve, fileURLToPath, sourceDigest, catalogueIndexOutput,
    catalogueDirectory, repositoryCatalogueIndexOutput, repositoryCatalogueDirectory, output, corpusOutput, localBootstrapOutput,
    Bun, process, console, generatorUrl, configureGenerationReplay } = host;
  return (async () => {
    ${generatorSource.slice(preflightStart, preflightEnd).replaceAll("import.meta.url", "generatorUrl")}
    return "snapshot-generation";
  })();
`);

function bootstrapFixture() {
  const sourceDigest = "current-repository-inputs";
  const output = generatedId("public-bootstrap.json");
  const corpusOutput = generatedId("seed-values.json");
  const catalogueIndexOutput = generatedId("authoring-catalogue.json");
  const catalogueDirectory = fileURLToPath(new URL("./public/generated/authoring-catalogue/", import.meta.url));
  // Lane S: the public worker's repository-only catalogue (same freshness rules).
  const repositoryCatalogueIndexOutput = generatedId("repository-authoring-catalogue.json");
  const repositoryCatalogueDirectory = fileURLToPath(new URL("./public/generated/repository-authoring-catalogue/", import.meta.url));
  const localBootstrapOutput = generatedId("local-bootstrap.json");
  const localPublication = { root: { id: "fenel-browser-local", items: [] } };
  const chunks = ["std", "engine"].map(area => {
    const bytes = Buffer.from(`${area} catalogue bytes`);
    const sha256 = createHash("sha256").update(bytes).digest("hex");
    return { file: `${area}.${sha256.slice(0, 16)}.json`, sha256, bytes };
  });
  const files = new Map([
    [output, JSON.stringify({ schema: "fenel.public-bootstrap.v1", sourceDigest })],
    [corpusOutput, JSON.stringify({ schema: "fenel.seed-values.v1", sourceDigest })],
    [catalogueIndexOutput, JSON.stringify({ schema: "fenel.authoring-catalogue.v2", sourceDigest,
      chunks: chunks.map(({ file, sha256 }) => ({ file, sha256 })) })],
    [localBootstrapOutput, JSON.stringify({ schema: "fenel.local-bootstrap.v1", sourceDigest, publication: localPublication,
      packetDigest: createHash("sha256").update(JSON.stringify(localPublication)).digest("hex") })],
    ...chunks.map(({ file, bytes }) => [resolve(catalogueDirectory, file), bytes]),
    [repositoryCatalogueIndexOutput, JSON.stringify({ schema: "fenel.authoring-catalogue.v2", sourceDigest,
      chunks: chunks.map(({ file, sha256 }) => ({ file, sha256 })) })],
    ...chunks.map(({ file, bytes }) => [resolve(repositoryCatalogueDirectory, file), bytes]),
  ].map(([path, bytes]) => [resolve(path), bytes]));
  const reads = [];
  const calls = [];
  const fixture = { files, reads, calls, output, corpusOutput, catalogueIndexOutput, repositoryCatalogueIndexOutput, localBootstrapOutput,
    generation: generationHostFixture(),
    chunkPaths: chunks.map(({ file }) => resolve(catalogueDirectory, file)),
    repositoryChunkPaths: chunks.map(({ file }) => resolve(repositoryCatalogueDirectory, file)), childExitCode: 0,
    async run(args = ["--ensure"]) {
      const exited = new Error("controlled generator exit");
      let exitCode;
      const host = {
        createHash, resolve, fileURLToPath, sourceDigest, output, corpusOutput,
        catalogueIndexOutput, catalogueDirectory, repositoryCatalogueIndexOutput, repositoryCatalogueDirectory,
        localBootstrapOutput, generatorUrl: generatorUrl.href,
        configureGenerationReplay: fixture.generation.configure,
        readFile: async path => {
          reads.push(resolve(path));
          if (!files.has(resolve(path))) throw new Error("missing fixture file");
          return files.get(resolve(path));
        },
        Bun: { spawnSync(command, options) {
          calls.push({ command, options });
          return { exitCode: fixture.childExitCode };
        } },
        process: { argv: ["bun", fileURLToPath(generatorUrl), ...args], execPath: "bun",
          cwd: () => packageRoot, env: fixture.generation.env, exit(code) { exitCode = code; throw exited; } },
        console: { log() {} },
      };
      try { return { next: await runBootstrapPreflight(host) }; }
      catch (error) {
        if (error !== exited) throw error;
        return { exitCode };
      }
    },
  };
  return fixture;
}

test("generation offers the recorded replay only when no explicit setting exists", async () => {
  for (const value of [undefined, "", "custom/replay.gz"]) {
    const fixture = generationHostFixture({ env: value === undefined ? {} : { FENEL_ENGINE_BODY_REPLAY: value } });
    assert.equal(await fixture.prepare("controlled stage"), 123);
    const expected = value === undefined ? recordedReplay : value;
    assert.equal(fixture.env.FENEL_ENGINE_BODY_REPLAY, expected);
    assert.deepEqual(fixture.stats, value === undefined ? [recordedReplay] : []);
    assert.deepEqual(fixture.events.slice(0, 2), [
      ["log", "[public-bootstrap] controlled stage: starting"], ["host-install", expected],
    ]);
    if (value === "") {
      assert.deepEqual(fixture.capture(), { refused: "no artifact configured" });
      assert.equal(fixture.events.some(([kind]) => kind === "artifact-read"), false);
    } else assert.equal(fixture.capture().stamp.sourceEpoch, "current");
  }
});

test("missing, unreadable and non-file defaults leave ordinary generation available", async () => {
  for (const file of ["missing", "directory", new Error("unreadable optional file")]) {
    const fixture = generationHostFixture({ file });
    await fixture.prepare("controlled stage");
    assert.equal(fixture.env.FENEL_ENGINE_BODY_REPLAY, undefined);
    assert.deepEqual(fixture.capture(), { refused: "no artifact configured" });
    assert.equal(fixture.events.some(([kind]) => kind === "artifact-read"), false);
  }
});

test("offering a replay preserves the host adapter's stale and unreadable refusals", async () => {
  for (const [options, refused] of [
    [{ opened: { text: "old replay", stamp: { sourceEpoch: "previous" } } }, "source epoch differs"],
    [{ opened: { refused: "integrity mismatch" } }, "integrity mismatch"],
    [{ readError: new Error("file disappeared after stat") }, "source epoch unavailable"],
  ]) {
    const fixture = generationHostFixture(options);
    await fixture.prepare("controlled stage");
    assert.equal(fixture.env.FENEL_ENGINE_BODY_REPLAY, recordedReplay);
    assert.equal(fixture.capture().refused, refused);
  }
});

test("direct catalogue and Local generation prepare the host before engine work", async () => {
  const start = generatorSource.indexOf('if (process.argv.includes("--authoring-catalogue"))');
  const end = generatorSource.indexOf("let priorCatalogue;");
  assert.ok(start >= 0 && end > start);
  const actualModes = generatorSource.slice(start, end).replaceAll("import.meta.url", "generatorUrl");
  for (const [flag, kind] of [["--authoring-catalogue", "catalogue"], ["--local-bootstrap", "local"]]) {
    const fixture = generationHostFixture();
    const exited = new Error("controlled exit");
    const worked = [];
    fixture.process.argv = ["bun", "generator", flag];
    fixture.process.exit = code => { assert.equal(code, 0); throw exited; };
    const work = name => async started => {
      assert.equal(started, 123);
      assert.equal(fixture.capture().stamp.sourceEpoch, "current");
      worked.push(name);
    };
    const scope = { process: fixture.process, prepareGenerationHost: fixture.prepare,
      generateAuthoringCatalogue: work("catalogue"), generateLocalBootstrap: work("local"),
      fileURLToPath, generatorUrl: generatorUrl.href };
    const run = new Function(...Object.keys(scope), `return (async () => { ${actualModes} })();`);
    await assert.rejects(run(...Object.values(scope)), error => error === exited);
    assert.deepEqual(worked, [kind]);
  }
});

test("generation children inherit the selected replay and explicit empty/custom settings", async () => {
  for (const value of [undefined, "", "custom/replay.gz"]) {
    const fixture = bootstrapFixture();
    if (value !== undefined) fixture.generation.env.FENEL_ENGINE_BODY_REPLAY = value;
    fixture.files.delete(fixture.chunkPaths.at(-1));
    fixture.files.delete(resolve(fixture.localBootstrapOutput));
    assert.deepEqual(await fixture.run(), { exitCode: 0 });
    assert.equal(fixture.calls.length, 3);
    for (const call of fixture.calls) {
      assert.equal(call.options.env.FENEL_ENGINE_BODY_REPLAY, value === undefined ? recordedReplay : value);
    }
    assert.deepEqual(fixture.generation.stats, value === undefined ? [recordedReplay] : []);
  }
});

test("current check/ensure and stale check never acquire or select the optional replay", async () => {
  for (const args of [["--check"], ["--ensure"]]) {
    const fixture = bootstrapFixture();
    assert.deepEqual(await fixture.run(args), { exitCode: 0 });
    assert.deepEqual(fixture.generation.stats, []);
    assert.deepEqual(fixture.generation.env, {});
    assert.deepEqual(fixture.generation.events, []);
  }
  const fixture = bootstrapFixture();
  fixture.files.delete(resolve(fixture.output));
  await assert.rejects(fixture.run(["--check"]), /stale/);
  assert.deepEqual(fixture.generation.stats, []);
  assert.deepEqual(fixture.generation.env, {});
});


test("ensure retains a verified catalogue when either public snapshot needs generation", async () => {
  for (const snapshot of ["output", "corpusOutput"]) {
    for (const change of ["missing", "invalid-json", "stale"]) {
      const fixture = bootstrapFixture();
      if (change === "missing") fixture.files.delete(resolve(fixture[snapshot]));
      else if (change === "invalid-json") fixture.files.set(resolve(fixture[snapshot]), "{");
      else {
        const prior = JSON.parse(fixture.files.get(resolve(fixture[snapshot])));
        fixture.files.set(resolve(fixture[snapshot]), JSON.stringify({ ...prior, sourceDigest: "old-inputs" }));
      }
      assert.deepEqual(await fixture.run(), { next: "snapshot-generation" }, `${snapshot}: ${change}`);
      assert.equal(fixture.calls.length, 0, `${snapshot}: ${change}`);
      for (const path of fixture.chunkPaths) assert.ok(fixture.reads.includes(path), `Verified ${path}`);
    }
  }
});

test("ensure regenerates missing, damaged or stale catalogues before any required snapshot work", async () => {
  for (const snapshotsCurrent of [true, false]) {
    for (const damage of ["missing-chunk", "corrupt-chunk", "missing-index", "invalid-index", "stale-inputs"]) {
      const fixture = bootstrapFixture();
      if (!snapshotsCurrent) fixture.files.delete(resolve(fixture.output));
      const chunkPath = fixture.chunkPaths.at(-1);
      const indexPath = resolve(fixture.catalogueIndexOutput);
      if (damage === "missing-chunk") fixture.files.delete(chunkPath);
      else if (damage === "corrupt-chunk") fixture.files.set(chunkPath, Buffer.from("corrupt bytes"));
      else if (damage === "missing-index") fixture.files.delete(indexPath);
      else if (damage === "invalid-index") fixture.files.set(indexPath, "{");
      else {
        const index = JSON.parse(fixture.files.get(indexPath));
        fixture.files.set(indexPath, JSON.stringify({ ...index, sourceDigest: "old-inputs" }));
      }
      assert.deepEqual(await fixture.run(), snapshotsCurrent ? { exitCode: 0 } : { next: "snapshot-generation" }, damage);
      assert.equal(fixture.calls.length, 2, damage);
      assert.deepEqual(fixture.calls.map(call => call.command), [["bun", fileURLToPath(generatorUrl), "--authoring-catalogue"],
        ["bun", fileURLToPath(generatorUrl), "--repository-catalogue"]]);
    }
  }
});

test("lane S: a damaged or stale public repository catalogue is stale too, and ensure regenerates the catalogues", async () => {
  for (const damage of ["missing-chunk", "corrupt-chunk", "missing-index", "stale-inputs"]) {
    const make = () => {
      const fixture = bootstrapFixture();
      const indexPath = resolve(fixture.repositoryCatalogueIndexOutput);
      if (damage === "missing-chunk") fixture.files.delete(fixture.repositoryChunkPaths.at(-1));
      else if (damage === "corrupt-chunk") fixture.files.set(fixture.repositoryChunkPaths.at(-1), Buffer.from("corrupt bytes"));
      else if (damage === "missing-index") fixture.files.delete(indexPath);
      else fixture.files.set(indexPath, JSON.stringify({ ...JSON.parse(fixture.files.get(indexPath)), sourceDigest: "old-inputs" }));
      return fixture;
    };
    const check = make();
    await assert.rejects(check.run(["--check"]), /authoring catalogue or Local first paint is stale/, damage);
    assert.equal(check.calls.length, 0, damage);
    const ensure = make();
    assert.deepEqual(await ensure.run(), { exitCode: 0 }, damage);
    assert.deepEqual(ensure.calls.map(call => call.command.at(-1)), ["--authoring-catalogue", "--repository-catalogue"], damage);
  }
});

test("check stays read-only and ensure exits without generation when all artifacts are current", async () => {
  for (const args of [["--check"], ["--ensure"]]) {
    const fixture = bootstrapFixture();
    assert.deepEqual(await fixture.run(args), { exitCode: 0 });
    assert.equal(fixture.calls.length, 0);
    for (const path of fixture.chunkPaths) assert.ok(fixture.reads.includes(path));
  }
  for (const damage of ["stale-snapshot", "missing-chunk", "corrupt-chunk"]) {
    const fixture = bootstrapFixture();
    if (damage === "stale-snapshot") fixture.files.delete(resolve(fixture.output));
    else if (damage === "missing-chunk") fixture.files.delete(fixture.chunkPaths.at(-1));
    else fixture.files.set(fixture.chunkPaths.at(-1), Buffer.from("corrupt bytes"));
    await assert.rejects(fixture.run(["--check"]), /authoring catalogue or Local first paint is stale/, damage);
    assert.equal(fixture.calls.length, 0, damage);
  }
});

test("the Local first paint is stale on changed inputs or any edited packet byte, and ensure regenerates it alone", async () => {
  const edits = {
    "missing": () => undefined,
    "invalid-json": () => "{",
    "stale-inputs": prior => JSON.stringify({ ...prior, sourceDigest: "old-inputs" }),
    "edited-packet": prior => JSON.stringify({ ...prior, publication: { root: { id: "fenel-browser-local", items: [{ id: "forged" }] } } }),
    "missing-digest": prior => JSON.stringify({ ...prior, packetDigest: undefined }),
  };
  for (const [damage, edit] of Object.entries(edits)) {
    const check = bootstrapFixture();
    const path = resolve(check.localBootstrapOutput);
    const next = edit(JSON.parse(check.files.get(path)));
    if (next === undefined) check.files.delete(path); else check.files.set(path, next);
    await assert.rejects(check.run(["--check"]), /Local first paint is stale/, damage);
    assert.equal(check.calls.length, 0, damage);
    const ensure = bootstrapFixture();
    if (next === undefined) ensure.files.delete(path); else ensure.files.set(path, next);
    assert.deepEqual(await ensure.run(["--ensure"]), { exitCode: 0 }, damage);
    assert.deepEqual(ensure.calls.map(call => call.command), [["bun", fileURLToPath(generatorUrl), "--local-bootstrap"]], damage);
  }
});

test("forced generation still rebuilds the catalogue and child failures stop snapshot generation", async () => {
  const forced = bootstrapFixture();
  assert.deepEqual(await forced.run([]), { next: "snapshot-generation" });
  assert.deepEqual(forced.calls.map(call => call.command.at(-1)), ["--authoring-catalogue", "--repository-catalogue", "--local-bootstrap"]);
  for (const snapshotsCurrent of [true, false]) {
    const fixture = bootstrapFixture();
    fixture.files.delete(fixture.chunkPaths.at(-1));
    if (!snapshotsCurrent) fixture.files.delete(resolve(fixture.output));
    fixture.childExitCode = 1;
    await assert.rejects(fixture.run(), /authoring catalogue generation failed/);
    assert.equal(fixture.calls.length, 1);
  }
});

async function transformEnvironment(plugin) {
  const config = await resolveConfig({
    root: packageRoot, configFile: false, envFile: false, publicDir: false,
    cacheDir: fileURLToPath(new URL("../../../.tmp-diag/public-json-control-cache/", import.meta.url)),
    optimizeDeps: { noDiscovery: true, include: [] }, plugins: plugin ? [plugin] : [],
    server: { watch: null, middlewareMode: true }, logLevel: "error",
  }, "serve");
  const environment = new DevEnvironment("client", config, { disableDepsOptimizer: true, disableFetchModule: true });
  await environment.init();
  return environment;
}

function served(result, url) {
  const response = { writableEnded: false, setHeader() {}, end(body) { this.body = body; this.writableEnded = true; } };
  send({ headers: {}, method: "GET", url }, response, result.code, "js", { map: result.map });
  return String(response.body);
}

test("snapshot hashing and dev watching use production inputs without test-only rebuilds", () => {
  for (const path of publicBootstrapExactInputs) assert.equal(isPublicBootstrapInput(path), true, path);
  for (const path of [
    "fenel/modules/std/DOCS.md",
    "implementations/typescript/engine/src/expressions.test.ts",
    "patches/@solidjs%2Fsignals@2.0.0-rc.7.patch",
    "distros/narthex/solid/src/lib/expression-runner/seed-values.ts",
    "distros/narthex/solid/src/lib/expression-runner/seed-values-source.ts",
    "distros/narthex/solid/src/lib/data-transfer/expressions.ts",
    "distros\\narthex\\solid\\src\\lib\\expression-runner\\new-production-file.tsx",
  ]) assert.equal(isPublicBootstrapInput(path), true, path);
  for (const name of [
    "authoring-session.test.ts", "typed-authoring.browser-fixture.tsx", "engine.node-fixture.ts",
    "test-harness.ts", "fixtures/value.ts", "DOCS.md", "AGENTS.md", "image-canvas.css",
  ]) assert.equal(isPublicBootstrapInput(`distros/narthex/solid/src/lib/expression-runner/${name}`), false, name);
  assert.equal(isPublicBootstrapInput("distros/narthex/solid/src/lib/home-entry.tsx"), false);
});

test("generated JSON keeps Vite's exports while omitting only its development maps", async () => withGenerator(async generator => {
  const baseline = await transformEnvironment();
  const candidate = await transformEnvironment(publicBootstrapPlugin());
  try {
    const value = { title: "Fenel 🦊", nested: { items: [1, false, null, "a\\b\n"] }, empty: [] };
    const source = JSON.stringify(value);
    for (const name of ["public-bootstrap.json", "seed-values.json", "authoring-catalogue.json", "local-bootstrap.json"]) {
      const id = generatedId(name);
      const before = await baseline.pluginContainer.transform(source, id, { moduleType: "json" });
      const after = await candidate.pluginContainer.transform(source, id, { moduleType: "json" });
      assert.equal(after.code, before.code, name);
      assert.deepEqual(after.map, { mappings: "" });
      const exported = await import(`data:text/javascript;base64,${Buffer.from(after.code).toString("base64")}`);
      assert.deepEqual(exported.default, value);
      assert.match(served(before, `/src/lib/generated/${name}?import`), /sourceMappingURL=data:/);
      assert.doesNotMatch(served(after, `/src/lib/generated/${name}?import`), /sourceMappingURL=data:/);
    }
    assert.equal(generator.calls.length, 1);
    assert.deepEqual(generator.calls[0].args, ["scripts/generate-public-bootstrap.mjs", "--check"]);
    assert.equal(generator.calls[0].command, "bun");
    assert.equal(generator.calls[0].cwd, packageRoot);
    assert.equal(generator.calls[0].windowsHide, true);

    const authoredId = generatedId("../authored-map-control.ts");
    for (const environment of [baseline, candidate]) {
      await environment.moduleGraph._ensureEntryFromUrl("/src/lib/authored-map-control.ts", true, { id: authoredId });
    }
    const authored = "const answer: number = 42; export default answer;";
    const before = await baseline.pluginContainer.transform(authored, authoredId, { moduleType: "ts" });
    const after = await candidate.pluginContainer.transform(authored, authoredId, { moduleType: "ts" });
    assert.deepEqual(after, before);
    assert.match(served(after, "/src/lib/authored-map-control.ts"), /sourceMappingURL=data:/);

    const unlistedId = generatedId("authored.json");
    const unlistedBefore = await baseline.pluginContainer.transform(source, unlistedId, { moduleType: "json" });
    const unlistedAfter = await candidate.pluginContainer.transform(source, unlistedId, { moduleType: "json" });
    assert.deepEqual(unlistedAfter, unlistedBefore);
    assert.match(served(unlistedAfter, "/src/lib/generated/authored.json?import"), /sourceMappingURL=data:/);
    await assert.rejects(candidate.pluginContainer.transform('{"broken":', generatedId("public-bootstrap.json"), { moduleType: "json" }));
  } finally { await baseline.close(); await candidate.close(); }
}));

test("the map policy keeps exact public snapshot paths and leaves build maps alone", async () => withGenerator(async generator => {
  const [plugin] = publicBootstrapPlugin();
  plugin.configResolved({ command: "serve" });
  const hook = plugin.transform.handler;
  assert.equal(plugin.transform.order, "pre");
  for (const id of [generatedId("authored.json"), generatedId("seed-values.json.ts"), generatedId("nested/seed-values.json"), "public-bootstrap.json"]) {
    assert.equal(await hook("{}", id), undefined, id);
  }
  assert.equal(generator.calls.length, 0);
  for (const name of ["public-bootstrap.json", "seed-values.json", "authoring-catalogue.json", "local-bootstrap.json"]) {
    assert.deepEqual(await hook("{}", `${generatedId(name).replaceAll("/", "\\")}?import`), { code: "{}", map: { mappings: "" } });
  }
  const [build] = publicBootstrapPlugin();
  build.configResolved({ command: "build" });
  await build.buildStart();
  assert.equal(await build.transform.handler("{}", generatedId("public-bootstrap.json")), null);
  assert.deepEqual(generator.calls.map(call => call.args[1]), ["--check", "--ensure"]);
}));

test("stale snapshots and generator errors still refuse before a module is returned", async () => withGenerator(async generator => {
  const [plugin] = publicBootstrapPlugin();
  plugin.configResolved({ command: "serve" });
  const hook = plugin.transform.handler;
  const id = generatedId("public-bootstrap.json");
  generator.outcome = "fail";
  await assert.rejects(hook("{}", id), /controlled stale snapshot/);
  generator.outcome = "error";
  await assert.rejects(hook("{}", id), /generator unavailable/);
  generator.outcome = "pass";
  assert.deepEqual(await hook("{}", id), { code: "{}", map: { mappings: "" } });
  assert.equal(generator.calls.length, 3);

  const changes = new Map();
  const invalidated = [];
  const messages = [];
  plugin.configureServer({
    watcher: { add() {}, on(event, callback) { changes.set(event, callback); } },
    moduleGraph: { getModuleById(target) { return { id: target }; }, invalidateModule(module) { invalidated.push(module.id); } },
    ws: { send(message) { messages.push(message); } },
  });
  changes.get("change")(fileURLToPath(new URL("../../../fenel/modules/std/list.fenel", import.meta.url)));
  assert.equal(invalidated.length, 4);
  assert.deepEqual(messages, [{ type: "full-reload" }]);
  generator.outcome = "fail";
  await assert.rejects(hook("{}", id), /controlled stale snapshot/);
  assert.equal(generator.calls.length, 4);
}));

test("engine generated data shares one map policy without public snapshot checks", async () => withGenerator(async generator => {
  generator.outcome = "fail";
  const baseline = await transformEnvironment();
  const candidate = await transformEnvironment([...publicBootstrapPlugin(), generatedDataBuildPlugin()]);
  const engineId = name => fileURLToPath(new URL(`../../../implementations/typescript/engine/src/generated/${name}`, import.meta.url)).replaceAll("\\", "/");
  try {
    const value = { schema: "controlled", rows: Array.from({ length: 48 }, (_, index) => ({ index, text: "x".repeat(256) })) };
    const source = JSON.stringify(value);
    for (const name of ["repository-field-catalog.json", "repository-identity-manifest.json", "nested/data.json"]) {
      const id = engineId(name);
      const before = await baseline.pluginContainer.transform(source, id, { moduleType: "json" });
      const after = await candidate.pluginContainer.transform(source, id, { moduleType: "json" });
      assert.equal(after.code, before.code);
      assert.deepEqual(after.map, { mappings: "" });
      assert.match(served(before, "/@fs/" + id), /sourceMappingURL=data:/);
      assert.doesNotMatch(served(after, "/@fs/" + id), /sourceMappingURL=data:/);
    }
    const id = engineId("parse-cache.generated.ts");
    for (const environment of [baseline, candidate]) await environment.moduleGraph._ensureEntryFromUrl("/@fs/" + id, true, { id });
    const sourceTs = "export const count: number = 42; export default count;";
    const before = await baseline.pluginContainer.transform(sourceTs, id, { moduleType: "ts" });
    const after = await candidate.pluginContainer.transform(sourceTs, id, { moduleType: "ts" });
    assert.equal(after.code, before.code);
    assert.deepEqual(after.map, { mappings: "" });
    assert.match(served(before, "/@fs/" + id), /sourceMappingURL=data:/);
    assert.doesNotMatch(served(after, "/@fs/" + id), /sourceMappingURL=data:/);
    assert.equal(generator.calls.length, 0);
    const [plugin] = publicBootstrapPlugin();
    plugin.configResolved({ command: "serve" });
    for (const name of ["parse-cache.generated.ts", "repository-field-catalog.json"]) {
      assert.deepEqual(await plugin.transform.handler("{}", engineId(name).replaceAll("/", "\\") + "?import"), { code: "{}", map: { mappings: "" } });
    }
    for (const name of ["authored.ts", "data.json.ts", "parse-cache.generated.ts.txt"]) {
      assert.equal(await plugin.transform.handler("{}", engineId(name)), undefined);
    }
    assert.equal(await plugin.transform.handler("{}", engineId("data.json").replace("/generated/", "/generated-other/")), undefined);
    plugin.configResolved({ command: "build" });
    assert.equal(await plugin.transform.handler("{}", engineId("data.json")), null);
    assert.equal(generator.calls.length, 0);
  } finally { await baseline.close(); await candidate.close(); }
}));

test("trailing inline maps are removed after transforms without cutting literal data", async () => withGenerator(async generator => {
  generator.outcome = "fail";
  const id = fileURLToPath(new URL("../../../implementations/typescript/engine/src/generated/fixture.generated.ts", import.meta.url)).replaceAll("\\", "/");
  const plain = "export const count: number = 42; export default count;";
  const marker = "\n//# sourceMappingURL=data:";
  const inline = marker + "application/json;charset=utf-8;base64," + Buffer.from(JSON.stringify({
    version: 3, sources: ["fixture.ts"], sourcesContent: [plain], names: [], mappings: "AAAA",
  })).toString("base64");
  for (const appended of [false, true]) {
    const appender = { name: "controlled-prior-inline-map", transform(code, target) {
      if (appended && target === id) return { code: code + inline, map: null };
    } };
    const before = await transformEnvironment(appender);
    const after = await transformEnvironment([appender, ...publicBootstrapPlugin()]);
    try {
      for (const environment of [before, after]) await environment.moduleGraph._ensureEntryFromUrl("/@fs/" + id, true, { id });
      const input = appended ? plain : plain + inline;
      const baseline = await before.pluginContainer.transform(input, id, { moduleType: "ts" });
      const result = await after.pluginContainer.transform(input, id, { moduleType: "ts" });
      const cut = baseline.code.lastIndexOf(marker);
      assert.ok(cut >= 0);
      assert.equal(result.code, baseline.code.slice(0, cut));
      assert.deepEqual(result.map, { mappings: "" });
      assert.doesNotMatch(served(result, "/@fs/" + id), /(?:^|\n)\/\/# sourceMappingURL=data:/);
      const exported = await import(`data:text/javascript;base64,${Buffer.from(result.code).toString("base64")}`);
      assert.equal(exported.default, 42);
    } finally { await before.close(); await after.close(); }
  }

  const before = await transformEnvironment();
  const after = await transformEnvironment(publicBootstrapPlugin());
  try {
    for (const environment of [before, after]) await environment.moduleGraph._ensureEntryFromUrl("/@fs/" + id, true, { id });
    const literal = "literal data" + inline;
    for (const input of ["export default " + JSON.stringify(literal) + ";", "export default `" + literal + "`;"]) {
      const baseline = await before.pluginContainer.transform(input, id, { moduleType: "ts" });
      const unchanged = await after.pluginContainer.transform(input, id, { moduleType: "ts" });
      assert.equal(unchanged.code, baseline.code);
      const exported = await import(`data:text/javascript;base64,${Buffer.from(unchanged.code).toString("base64")}`);
      assert.equal(exported.default, literal);
      const withMap = await after.pluginContainer.transform(input + inline, id, { moduleType: "ts" });
      const baselineWithMap = await before.pluginContainer.transform(input + inline, id, { moduleType: "ts" });
      assert.equal(withMap.code, baselineWithMap.code.slice(0, baselineWithMap.code.lastIndexOf(marker)));
      assert.equal(withMap.code.trimEnd(), baseline.code.trimEnd());
    }
    const [pre, post] = publicBootstrapPlugin();
    pre.configResolved({ command: "serve" });
    for (const invalid of ["text/plain;base64,e30=", "application/json;base64,e30=;suffix", "application/json,%7B%7D"]) {
      assert.equal(post.transform.handler(plain + marker + invalid, id), null);
    }
    const repeated = await after.pluginContainer.transform(plain + inline + inline, id, { moduleType: "ts" });
    const baseline = await before.pluginContainer.transform(plain + inline + inline, id, { moduleType: "ts" });
    assert.equal(repeated.code, baseline.code.slice(0, baseline.code.indexOf(marker)));
    assert.equal(generator.calls.length, 0);
  } finally { await before.close(); await after.close(); }
}));

const parseCacheId = fileURLToPath(new URL("../../../implementations/typescript/engine/src/generated/parse-cache.generated.ts", import.meta.url)).replaceAll("\\", "/");
const cacheCarrier = value => "// GENERATED by scripts/generate-parse-cache.ts — DO NOT EDIT.\n/* eslint-disable */\n\n"
  + "export const PARSE_CACHE_VERSION = 4;\nexport const PARSE_CACHE_COUNT = 2;\nexport const PARSE_CACHE_JSON = " + JSON.stringify(value) + ";\n";

test("cache packaging keeps exact strings, Latin1 carriers and full query identities", async () => {
  for (const value of ["", 'quote"\\\n\t\0\b\f\r\x01', "\u007f\u0080\u00ff\u0100".repeat(24),
    "λ雪🧭".repeat(24) + "\ud800x\udfff", "a🧭b雪cλd".repeat(24), "\n//# sourceMappingURL=data:application/json;base64,e30="]) {
    const plugin = generatedDataBuildPlugin({ carrierBytes: 32 }), source = cacheCarrier(value);
    const result = plugin.transform.handler(source, parseCacheId + "?carrier=a");
    assert.equal(plugin.apply, "build");
    assert.equal(plugin.buildStart, undefined, "Packaging must never run public ensure");
    assert.equal(result.map, null);
    const originalPrefix = source.slice(0, source.indexOf("export const PARSE_CACHE_JSON = "));
    assert.ok(result.code.includes(originalPrefix));
    assert.ok(result.code.endsWith(";\n"));
    const ids = [...result.code.matchAll(/^import cachePart[0-9]+ from ("[^\n]+");$/gm)].map(match => JSON.parse(match[1]));
    assert.ok(ids.length > 0);
    const modules = new Map(), arrays = new Map();
    for (const id of ids) {
      assert.equal(plugin.resolveId(id), id);
      assert.match(generatedDataChunk(id, "worker-data-"), /^worker-data-parse-cache-part-[a-f0-9]{64}-[0-9]+$/);
      const code = plugin.load(id);
      assert.ok(Buffer.byteLength(code) <= 32);
      const url = `data:text/javascript;base64,${Buffer.from(code).toString("base64")}#${encodeURIComponent(id)}`;
      const module = await import(url); modules.set(id, url);
      arrays.set(`cachePart${/:([0-9]+)$/.exec(id)[1]}`, module.default);
      assert.ok(Array.isArray(module.default) && module.default.every(value => typeof value === "string"));
      const widths = module.default.map(value => /[^\x00-\xff]/.test(value));
      assert.ok(widths.every(Boolean) || widths.every(wide => !wide), "One carrier cannot mix Latin1 runs and wide islands");
      if (widths.every(wide => !wide)) assert.doesNotMatch(code, /[^\x00-\xff]/, "Narrow carrier source stays Latin1 too");
    }
    const orderedPieces = [...result.code.matchAll(/\b(cachePart[0-9]+)\[([0-9]+)\]/g)].map(match => arrays.get(match[1])[Number(match[2])]);
    for (let index = 1; index < orderedPieces.length; index++) assert.ok(!(/[\ud800-\udbff]$/.test(orderedPieces[index - 1]) && /^[\udc00-\udfff]/.test(orderedPieces[index])),
      "A valid surrogate pair is not split at an ordered carrier boundary");
    const facadeCode = result.code.replace(/^import (cachePart[0-9]+) from ("[^\n]+");$/gm,
      (_line, binding, target) => `import ${binding} from ${JSON.stringify(modules.get(JSON.parse(target)))};`);
    const facadeUrl = `data:text/javascript;base64,${Buffer.from(facadeCode).toString("base64")}`;
    const facade = await import(facadeUrl);
    assert.deepEqual(Object.keys(facade).sort(), ["PARSE_CACHE_COUNT", "PARSE_CACHE_JSON", "PARSE_CACHE_VERSION"]);
    assert.equal(facade.PARSE_CACHE_JSON, value);
    assert.equal(Buffer.compare(Buffer.from(facade.PARSE_CACHE_JSON), Buffer.from(value)), 0);
    assert.equal(facade.PARSE_CACHE_VERSION, 4); assert.equal(facade.PARSE_CACHE_COUNT, 2);
    assert.equal((await import(facadeUrl)).PARSE_CACHE_JSON, value);
    const other = plugin.transform.handler(source, parseCacheId + "?carrier=b");
    const otherIds = [...other.code.matchAll(/^import cachePart[0-9]+ from ("[^\n]+");$/gm)].map(match => JSON.parse(match[1]));
    assert.ok(otherIds.every(id => !ids.includes(id)), "Query-distinct facades retain separate carrier identities");
    assert.equal(plugin.transform.handler(source, parseCacheId.replace("parse-cache.generated.ts", "authored.generated.ts")), undefined);
    for (const query of ["raw", "url", "worker", "sharedworker"]) {
      for (const tail of [query, "carrier=?&" + query, "carrier=one?two&" + query + "=1"]) {
        assert.equal(plugin.transform.handler("different query semantics", parseCacheId + "?" + tail), undefined, tail);
      }
    }
    assert.throws(() => plugin.transform.handler(source + "export default 1;", parseCacheId), /Unexpected generated/);
    assert.throws(() => plugin.transform.handler(source.replace(JSON.stringify(value) + ";\n", "{};\n"), parseCacheId), /must remain a string/);
  }
  for (const budget of [0, 31, 8 * 1024 * 1024 + 1]) assert.throws(() => generatedDataBuildPlugin({ carrierBytes: budget }), /Invalid/);
  for (const prefix of ["engine-data-", "worker-data-"]) {
    assert.equal(generatedDataChunk(parseCacheId, prefix), prefix + "parse-cache");
    assert.equal(generatedDataChunk(parseCacheId.replace("parse-cache.generated.ts", "repository-field-catalog.json") + "?import", prefix), prefix + "repository-field-catalog");
    assert.equal(generatedDataChunk(parseCacheId.replace(".generated.ts", ".ts"), prefix), undefined);
  }
});

test("real minified app and nested worker builds preserve cache exports without asynchronous loading", async () => {
  const temporaryRoot = fileURLToPath(new URL("../../../.tmp-diag/parse-cache-build-cap-20261020/controls/", import.meta.url));
  await mkdir(temporaryRoot, { recursive: true });
  const directory = await mkdtemp(join(temporaryRoot, "run-"));
  const value = "quotes\"\\\nλ雪🧭\ud800\udfff".repeat(12), source = cacheCarrier(value);
  const controller = () => ({ name: "controlled-generated-cache-input", resolveId(id) {
    if (id.startsWith("cache:")) return parseCacheId + "?fixture=" + id.slice(6);
  }, load(id) { if (id.startsWith(parseCacheId + "?")) return source; } });
  try {
    await writeFile(join(directory, "entry.mjs"), 'import * as first from "cache:first"; import * as repeated from "cache:first"; import * as second from "cache:second"; import control from "./control.json"; export { authored } from "./authored-a.mjs"; export { first, repeated, second, control }; export function openWorker() { return new Worker(new URL("./worker.mjs", import.meta.url), { type: "module" }); }');
    await writeFile(join(directory, "worker.mjs"), 'import * as cache from "cache:worker"; postMessage(cache.PARSE_CACHE_JSON);');
    const json = { untouched: ["default", 42] }; await writeFile(join(directory, "control.json"), JSON.stringify(json));
    await writeFile(join(directory, "authored-a.mjs"), 'import { child } from "./authored-b.mjs"; export function authored() { return child(); }');
    await writeFile(join(directory, "authored-b.mjs"), 'export function child() { return "Unchanged non-data dependency"; }');
    const choose = (id, prefix) => id.endsWith("/authored-a.mjs") ? "existing-non-data" : generatedDataChunk(id, prefix);
    const graphs = [];
    const observe = () => ({ name: "observe-cache-parts", generateBundle(_options, bundle) {
      graphs.push(Object.values(bundle).map(item => ({ fileName: item.fileName, type: item.type,
        bytes: Buffer.byteLength(item.type === "chunk" ? item.code : item.source),
        imports: item.imports ?? [], dynamicImports: item.dynamicImports ?? [], modules: Object.keys(item.modules ?? {}) })));
    } });
    const output = join(directory, "output");
    await build({ root: directory, configFile: false, envFile: false, publicDir: false, logLevel: "error",
      plugins: [controller(), generatedDataBuildPlugin({ carrierBytes: 32 }), observe()],
      worker: { format: "es", plugins: () => [controller(), generatedDataBuildPlugin({ carrierBytes: 32 }), observe()],
        rollupOptions: { output: { manualChunks: id => choose(id, "worker-data-") } } },
      build: { outDir: output, target: "esnext", minify: true, sourcemap: false,
        lib: { entry: join(directory, "entry.mjs"), formats: ["es"], fileName: () => "entry.mjs" },
        // A library fixture otherwise defaults to strict entry signatures,
        // unlike the app build; explicit data exports still remain checked.
        rollupOptions: { preserveEntrySignatures: "allow-extension", output: { chunkFileNames: "[name]-[hash].mjs", manualChunks: id => choose(id, "engine-data-") } } },
    });
    const entry = await import(pathToFileURL(join(output, "entry.mjs")).href);
    assert.equal(entry.first, entry.repeated);
    for (const module of [entry.first, entry.second]) {
      assert.deepEqual(Object.keys(module).sort(), ["PARSE_CACHE_COUNT", "PARSE_CACHE_JSON", "PARSE_CACHE_VERSION"]);
      assert.equal(module.PARSE_CACHE_JSON, value);
      assert.equal(module.PARSE_CACHE_VERSION, 4); assert.equal(module.PARSE_CACHE_COUNT, 2);
    }
    assert.deepEqual(entry.control, json);
    assert.equal(entry.authored(), "Unchanged non-data dependency");
    assert.equal((await import(pathToFileURL(join(output, "entry.mjs")).href)).first.PARSE_CACHE_JSON, value);
    assert.ok(graphs.length >= 2, "Actual nested worker graph was built");
    const files = graphs.flat();
    assert.ok(files.some(file => file.fileName.includes("engine-data-parse-cache-part-")), JSON.stringify(graphs));
    assert.ok(files.some(file => file.fileName.includes("worker-data-parse-cache-part-")));
    const nonData = files.find(file => file.fileName.includes("existing-non-data"));
    assert.ok(nonData.modules.some(id => id.endsWith("/authored-a.mjs")) && nonData.modules.some(id => id.endsWith("/authored-b.mjs")),
      "The caller's non-data chunk must still capture its ordinary dependency");
    for (const file of files) {
      assert.ok(file.bytes <= 25 * 1024 * 1024, file.fileName);
      assert.deepEqual(file.dynamicImports, [], file.fileName);
      if (file.modules.some(id => id.includes("fenel-parse-cache-part:"))) {
        const text = await readFile(join(output, file.fileName), "utf8").catch(() => undefined);
        if (text) {
          assert.doesNotMatch(text, /\b(?:fetch|import)\s*\(/);
          const namespace = await import(`data:text/javascript;base64,${Buffer.from(text).toString("base64")}#${encodeURIComponent(file.fileName)}`);
          const arrays = Object.values(namespace).filter(Array.isArray);
          assert.equal(arrays.length, 1, "Minification must retain the native array carrier boundary");
          assert.ok(arrays[0].every(value => typeof value === "string"));
          const widths = arrays[0].map(value => /[^\x00-\xff]/.test(value));
          assert.ok(widths.every(Boolean) || widths.every(wide => !wide));
          if (widths.every(wide => !wide)) assert.doesNotMatch(text, /[^\x00-\xff]/,
            "Actual minified narrow carrier source must remain Latin1");
        }
      }
    }
  } finally {
    assert.ok(!relative(resolve(temporaryRoot), resolve(directory)).startsWith(".."));
    await rm(directory, { recursive: true });
  }
});


const engineModulesId = fileURLToPath(new URL("../../../implementations/typescript/engine/src/engine-modules.ts", import.meta.url)).replaceAll("\\", "/");
const engineModulesSource = await readFile(engineModulesId, "utf8");
const compiledSuffixes = ["MANIFEST_HASH", "IDENTITY_DOMAIN", "RUNTIME_INPUT_HASH", "BOOTSTRAP_RUNTIME_INPUT_HASH",
  "SHARDS", "ENTRY_CODES", "CLOSURE_IDS", "REQUIRED_NATIVES", "FN_BODIES"];
const compiledId = kind => engineModulesId.replace("engine-modules.ts", `generated/compiled-${kind}.generated.ts`);
const compiledKeys = kind => compiledSuffixes.map(suffix => `${kind.toUpperCase()}_${suffix}`);
const packageRegistration = (source, id = engineModulesId) => generatedDataBuildPlugin().transform.handler.call({ parse: parseAst }, source, id);

test("compiled registration packaging is confined to its exact two known sites and closed export ABI", () => {
  const result = packageRegistration(engineModulesSource);
  assert.equal(result.map, null);
  for (const kind of ["parser", "resolver"]) {
    const binding = `__m_generated_compiled_${kind}_generated`;
    assert.doesNotMatch(result.code, new RegExp(`import \\* as ${binding} `));
    assert.ok(result.code.includes(`registerEngineModule("generated/compiled-${kind}.generated", Object.freeze({ `));
    for (const key of compiledKeys(kind)) assert.ok(result.code.includes(`${key}: ${binding}_${key}`));
    const plugin = generatedDataBuildPlugin(), id = compiledId(kind), exports = compiledKeys(kind);
    const source = exports.map(key => `export const ${key} = "inert fixture";`).join("\n");
    const parsed = (code = source, names = exports, target = id) => plugin.moduleParsed.call({ parse: parseAst }, { id: target, exports: names, code });
    assert.doesNotThrow(() => parsed());
    for (const changed of [exports.slice(1), [...exports, "UNEXPECTED"], [...exports.slice(1), "UNEXPECTED"]]) {
      assert.throws(() => parsed(source, changed), /Unexpected generated compiled-artifact const exports/);
    }
    for (const changed of [source.replace("export const ", "export let "),
      source.replace("export const ", "export let ") + `\n/*\nexport const ${exports[0]} = "mask";\n*/`,
      source.replace("export const ", "export let ") + `\nconst mask = \`\nexport const ${exports[0]} = "mask";\n\`;`,
      source.replace(`export const ${exports[0]} = "inert fixture";`, `const local = "inert fixture"; export { local as ${exports[0]} };`)]) {
      assert.throws(() => parsed(changed), /Unexpected generated compiled-artifact const exports/);
    }
    assert.doesNotThrow(() => parsed("unrelated unsupported shape", [], id + ".other"));
    const declaration = `import * as ${binding} from "./generated/compiled-${kind}.generated";`;
    const call = `registerEngineModule("generated/compiled-${kind}.generated", ${binding});`;
    for (const changed of [engineModulesSource.replace(declaration, ""), engineModulesSource.replace(call, ""),
      engineModulesSource.replace(declaration, declaration.slice(0, -1) + ' with { type: "json" };'),
      engineModulesSource.replace(declaration, declaration.replace("import *", "import defer *")),
      engineModulesSource + "\n" + call, engineModulesSource.replace(call, call.replace(binding, "__m_registry")),
      engineModulesSource.replace(call, call.replace("registerEngineModule(", "registerEngineModule?.(")),
      engineModulesSource + `\nregisterEngineModule("other", ${binding});`,
      engineModulesSource + `\nconsole.log(${binding});`, engineModulesSource + "\nconst surprise = 1;",
      engineModulesSource + `\nimport { other as ${binding}_${compiledKeys(kind)[0]} } from "./collision";`,
      engineModulesSource + '\nimport Object from "./collision";']) {
      assert.throws(() => packageRegistration(changed), /Unexpected generated compiled-artifact registration shape/);
    }
  }
  assert.equal(packageRegistration("unsupported", engineModulesId + ".other"), undefined);
  for (const query of ["raw", "url", "worker", "sharedworker"]) {
    assert.equal(packageRegistration("unsupported", engineModulesId + "?fixture=x?y&" + query + "=1"), undefined);
  }
  assert.equal(packageRegistration(engineModulesSource, engineModulesId.replaceAll("/", "\\") + "?fixture=one").code, result.code);
  assert.equal(packageRegistration(engineModulesSource, "/" + engineModulesId).code, result.code);
  const originalOther = engineModulesSource.split(/\r?\n/).filter(line => !line.includes("compiled-parser") && !line.includes("compiled-resolver") && line.trim());
  for (const line of originalOther) assert.ok(result.code.includes(line), line);
});

test("real minified app and nested worker register own-data compiled artifacts with unchanged strict identity", async () => {
  const temporaryRoot = fileURLToPath(new URL("../../../.tmp-diag/perf-20261102/compiled-namespace/controls/", import.meta.url));
  await mkdir(temporaryRoot, { recursive: true });
  const directory = await mkdtemp(join(temporaryRoot, "run-"));
  const engineRoot = dirname(engineModulesId).replaceAll("\\", "/");
  const domainId = fileURLToPath(new URL("../../../implementations/typescript/engine/scripts/lib/compiled-artifact-identity-domain.ts", import.meta.url)).replaceAll("\\", "/");
  const fixtureModule = `import "fixture:aggregator";
    import { engineRequire } from ${JSON.stringify(engineRoot + "/engine-require.ts")};
    import { resolveGeneratedCompiledIdentityDomain as resolveIdentity } from ${JSON.stringify(domainId)};
    import * as rawParser from ${JSON.stringify(compiledId("parser"))};
    import * as rawResolver from ${JSON.stringify(compiledId("resolver"))};
    const parser = engineRequire("generated/compiled-parser.generated");
    const resolver = engineRequire("generated/compiled-resolver.generated");
    export { parser, resolver, rawParser, rawResolver, resolveIdentity };`;
  const controller = () => ({ name: "controlled-compiled-aggregator-only", resolveId(id, importer) {
    if (id === "fixture:aggregator") return engineModulesId + "?fixture=compiled-registration";
    if (importer?.startsWith(engineModulesId + "?") && id.startsWith("./")
      && id !== "./engine-require" && !id.startsWith("./generated/compiled-")) return "\0compiled-fixture-other:" + id;
  }, load(id) {
    if (id === engineModulesId + "?fixture=compiled-registration") return engineModulesSource;
    if (id.startsWith("\0compiled-fixture-other:")) return 'export const untouched = "unrelated module";';
  } });
  try {
    await writeFile(join(directory, "package.json"), '{"type":"module"}');
    await writeFile(join(directory, "fixture.mjs"), fixtureModule);
    await writeFile(join(directory, "entry.mjs"), 'export * from "./fixture.mjs"; export function openWorker() { return new Worker(new URL("./worker.mjs", import.meta.url), { type: "module" }); }');
    await writeFile(join(directory, "worker.mjs"), 'import * as fixture from "./fixture.mjs"; globalThis.__compiledRegistrationFixture = fixture;');
    const results = [];
    for (const adapted of [false, true]) {
      const plugins = () => {
        const packaging = generatedDataBuildPlugin();
        if (!adapted) packaging.transform = undefined;
        return [controller(), packaging];
      };
      const graphs = [];
      const observe = () => ({ name: "observe-compiled-registration", generateBundle(_options, bundle) {
        graphs.push(Object.values(bundle).filter(item => item.type === "chunk").map(item => ({
          fileName: item.fileName, modules: Object.keys(item.modules), imports: item.imports,
          dynamicImports: item.dynamicImports, isEntry: item.isEntry,
        })));
      } });
      const output = join(directory, adapted ? "adapted" : "original");
      await build({ root: directory, configFile: false, envFile: false, publicDir: false, logLevel: "error",
        plugins: [...plugins(), observe()],
        worker: { format: "es", plugins: () => [...plugins(), observe()],
          rollupOptions: { output: { manualChunks: id => generatedDataChunk(id, "worker-data-") } } },
        build: { outDir: output, target: "esnext", minify: true, sourcemap: false,
          lib: { entry: join(directory, "entry.mjs"), formats: ["es"], fileName: () => "entry.mjs" },
          rollupOptions: { preserveEntrySignatures: "allow-extension", output: {
            chunkFileNames: "[name]-[hash].mjs", manualChunks: id => generatedDataChunk(id, "engine-data-"),
          } } },
      });
      const app = await import(pathToFileURL(join(output, "entry.mjs")).href);
      assert.ok(graphs.length >= 2, "Actual nested worker graph and app graph both built");
      const workerEntry = graphs.flat().find(item => item.isEntry && item.modules.some(id => id.endsWith("/worker.mjs")));
      assert.ok(workerEntry);
      await import(pathToFileURL(join(output, workerEntry.fileName)).href);
      const worker = globalThis.__compiledRegistrationFixture;
      delete globalThis.__compiledRegistrationFixture;
      for (const realm of [app, worker]) {
        for (const kind of ["parser", "resolver"]) {
          const artifact = realm[kind], raw = realm[kind === "parser" ? "rawParser" : "rawResolver"], keys = compiledKeys(kind);
          assert.deepEqual(Object.keys(artifact).sort(), [...keys].sort());
          assert.ok(keys.every(key => artifact[key] === raw[key]), "All original export references retained");
          const digest = raw[`${kind.toUpperCase()}_IDENTITY_DOMAIN`].digest;
          const current = { owner: "compiled-" + kind, fullDigest: digest };
          assert.equal(raw[`${kind.toUpperCase()}_IDENTITY_DOMAIN`].kind, "all");
          const identity = () => realm.resolveIdentity(artifact, current);
          if (!adapted) {
            assert.ok(keys.every(key => typeof Object.getOwnPropertyDescriptor(artifact, key).get === "function"));
            assert.throws(identity, /generated identity metadata is missing or accessor-backed/);
          } else {
            assert.ok(Object.isFrozen(artifact));
            assert.ok(keys.every(key => Object.hasOwn(Object.getOwnPropertyDescriptor(artifact, key), "value")));
            assert.equal(identity().digest, digest);
            assert.equal(identity().domain.kind, "all");
            assert.throws(() => realm.resolveIdentity(artifact, { ...current, fullDigest: "0".repeat(64) }), /full identity domain is stale/);
            let invoked = 0;
            const hostile = Object.defineProperty({ ...artifact }, `${kind.toUpperCase()}_IDENTITY_DOMAIN`, { get() { invoked++; return raw[`${kind.toUpperCase()}_IDENTITY_DOMAIN`]; } });
            assert.throws(() => realm.resolveIdentity(hostile, current), /generated identity metadata is missing or accessor-backed/);
            assert.equal(invoked, 0, "Generic accessors remain refused without executing getters");
            const tableKey = `${kind.toUpperCase()}_SHARDS`, table = artifact[tableKey], shardKey = Object.keys(table)[0];
            const hostileTable = { ...table, [shardKey]: Object.defineProperty({ ...table[shardKey] }, "identityDomain", { get() { invoked++; return artifact[`${kind.toUpperCase()}_IDENTITY_DOMAIN`]; } }) };
            assert.throws(() => realm.resolveIdentity({ ...artifact, [tableKey]: hostileTable }, current), /generated identity metadata is missing or accessor-backed/);
            assert.equal(invoked, 0);
          }
        }
      }
      results.push([app, worker]);
    }
    for (let realm = 0; realm < 2; realm++) for (const kind of ["parser", "resolver"]) {
      assert.deepEqual({ ...results[0][realm][kind] }, { ...results[1][realm][kind] }, "Every actual generated export value is unchanged");
    }
  } finally {
    assert.ok(!relative(resolve(temporaryRoot), resolve(directory)).startsWith(".."));
    await rm(directory, { recursive: true });
  }
});
