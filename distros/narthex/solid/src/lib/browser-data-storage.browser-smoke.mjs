// C2: production IndexedDB transport + current source Fenel storage policy.
// The fixture bypasses only the unrelated full browser authoring preparation.
import { strict as assert } from "node:assert";
import { readFileSync } from "node:fs";
import { mkdir as makeDirectory, readFile as readText } from "node:fs/promises";
import { randomUUID } from "node:crypto";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const repositoryRoot = fileURLToPath(new URL("../../../../../", import.meta.url));
const outputRoot = join(repositoryRoot, ".tmp-diag/browser-data-storage");
const integration = process.argv.includes("--source-integration");
const bundlePath = join(outputRoot, integration ? "source-integration.js" : "fixture.js");

if (process.versions.bun) {
  process.env.FENEL_PARSER_LEGACY = "1";
  console.log("Browser storage fixture: preparing selected source policy");
  const engineRoot = join(repositoryRoot, "implementations/typescript/engine/src");
  const [loader, registryModule, dispatch, standard, picture, sets, identities] = await Promise.all([
    "fenel-module.ts", "registry.ts", "engine-bodies-dispatch.ts", "modules/std.ts", "modules/picture.ts",
    "modules/set-expr-entities.ts", "repository-identity-manifest.ts",
  ].map(name => import(pathToFileURL(join(engineRoot, name)).href)));
  const { view, lock, kinds } = dispatch.withInterpretedResolver(() => {
    const view = loader.loadFenelModuleUnion(["types.fenel", "local-data.fenel"].map(name => ({
      src: readFileSync(join(repositoryRoot, "fenel/modules/view", name), "utf8"), name: `view/${name}`,
    })), { bootstrapParser: "typescript" })[0];
    const lock = identities.repositoryIdentityLock(), kinds = identities.repositoryIdentityKinds();
    const registry = registryModule.createRegistry([standard.stdModule, picture.pictureModule, sets.setExprEntityModule, view], {
      codeNameLock: lock, fieldIdentity: { mode: "collect-requirements", defaultRealm: "repository-source", lock },
    });
    for (const row of registry.listFieldLockRequests()) {
      if (!lock.has(row.name)) lock.set(row.name, row.preferredId ?? randomUUID());
      kinds.set(lock.get(row.name), "field");
    }
    return { view, lock, kinds };
  });
  const importPath = name => JSON.stringify(join(engineRoot, name).replaceAll("\\", "/"));
  console.log("Browser storage fixture: building actual browser IO boundary");
  const policySource = `
    import { createRegistry } from ${importPath("registry.ts")};
    import { evaluate } from ${importPath("json-logic.ts")};
    import { withInterpretedResolver } from ${importPath("engine-bodies-dispatch.ts")};
    import { setFenelParserLegacy } from ${importPath("parse-cache.ts")};
    import { stdModule } from ${importPath("modules/std.ts")};
    import { pictureModule } from ${importPath("modules/picture.ts")};
    import { setExprEntityModule } from ${importPath("modules/set-expr-entities.ts")};
    let pending;
    export async function loadWorkspaceModel() {
      return pending ??= (async () => {
        // Browser equivalent of this harness's FENEL_PARSER_LEGACY=1: edited
        // source must not be re-parsed through the slow live Fenel parser.
        setFenelParserLegacy(true);
        await import(${importPath("engine-modules.ts")});
        const lock = new Map(${JSON.stringify([...lock])});
        const registry = withInterpretedResolver(() => createRegistry([stdModule, pictureModule, setExprEntityModule, ${JSON.stringify(view)}], {
          codeNameLock: lock, fieldIdentity: { mode: "strict-embedded", defaultRealm: "repository-source", lock,
            identityKinds: new Map(${JSON.stringify([...kinds])}) },
        }));
        ${integration ? `// The selected pure fixture does not inherit the registry's bootstrap
        // authority or host-perform table. Full reader authority is outside scope.
        const { _authority, _performTable, ...context } = registry.evaluateContext();`
          : "const context = registry.evaluateContext();"}
        return { registry, evaluateContext: context, workspaceCall(name, ...args) {
          return withInterpretedResolver(() => evaluate({ call: ["view:" + name, ...args.map((_, index) => ({ var: "arg" + index }))] },
            Object.fromEntries(args.map((value, index) => ["arg" + index, value])), context));
        } };
      })();
    }
  `;
  const sourceRoot = fileURLToPath(new URL("../", import.meta.url));
  const compiler = integration ? await import(pathToFileURL(Bun.resolveSync("@solidjs/compiler",
    dirname(fileURLToPath(import.meta.resolve("@solidjs/vite-plugin"))))).href) : undefined;
  const build = await Bun.build({ entrypoints: [fileURLToPath(new URL("./browser-data-storage.fixture.ts", import.meta.url))],
    target: "browser", conditions: ["browser"], minify: true,
    define: { FENEL_STORAGE_SOURCE_INTEGRATION: JSON.stringify(integration) },
    plugins: [{ name: "browser-storage-selected-model", setup(builder) {
      builder.onResolve({ filter: /^~\// }, args => ({ path: Bun.resolveSync(join(sourceRoot, args.path.slice(2)), sourceRoot) }));
      builder.onResolve({ filter: /^\.\/workspace-model-loader$/ }, () => ({ path: "selected-storage-model", namespace: "storage-policy" }));
      builder.onLoad({ filter: /.*/, namespace: "storage-policy" }, () => ({ loader: "js", contents: policySource,
        resolveDir: repositoryRoot }));
      builder.onResolve({ filter: /\?raw$/ }, args => ({ path: resolve(args.resolveDir, args.path.slice(0, -4)), namespace: "source-text" }));
      builder.onLoad({ filter: /.*/, namespace: "source-text" }, async args => ({ loader: "js",
        contents: `export default ${JSON.stringify(await Bun.file(args.path).text())};` }));
      if (compiler) builder.onLoad({ filter: /\.tsx$/ }, async args => ({ loader: "ts", contents: (await compiler.transformAsync(
        await Bun.file(args.path).text(), { filename: args.path, generate: "dom", hydratable: false, dev: false })).code }));
      builder.onLoad({ filter: /\.css$/ }, () => ({ loader: "js", contents: "" }));
    } }] });
  if (!build.success) throw new AggregateError(build.logs, "Browser storage fixture build failed");
  await makeDirectory(outputRoot, { recursive: true });
  await Bun.write(bundlePath, build.outputs.find(output => output.kind === "entry-point"));
  const child = Bun.spawn(["node", fileURLToPath(import.meta.url), ...(integration ? ["--source-integration"] : [])],
    { stdout: "inherit", stderr: "inherit" });
  process.exit(await child.exited);
}

const { chromium } = await import("playwright");
const bundle = await readText(bundlePath, "utf8");
const errors = [], requests = [], workers = [];
const profilePath = join(outputRoot, "profiles", randomUUID());
let context;
const launch = async () => {
  const launched = await chromium.launchPersistentContext(profilePath, {
    headless: true, channel: process.env.FENEL_TEST_BROWSER_CHANNEL,
  });
  await launched.route("**/*", route => {
    const request = route.request();
    if (request.resourceType() !== "document") {
      requests.push({ method: request.method(), url: request.url() });
      return route.abort();
    }
    return route.fulfill({ contentType: "text/html", body: "<html><body>Browser storage boundary test</body></html>" });
  });
  return launched;
};
const mount = async page => {
  page.setDefaultTimeout(180_000);
  page.on("pageerror", error => { errors.push(error.message); console.error(error.message); });
  page.on("worker", worker => workers.push(worker.url()));
  await page.goto("https://fenel.test/");
  await page.addScriptTag({ content: bundle, type: "module" });
  await page.waitForFunction(() => !!globalThis.browserDataStorageFixture);
  return page;
};
const database = label => `fenel-storage-smoke-${label}-${randomUUID()}`;
try {
  console.log("Browser storage fixture: native IndexedDB controls");
  context = await launch();
  if (integration) {
    const db = database("source-integration");
    let first = await mount(await context.newPage());
    const initialSource = await first.evaluate(db => browserDataSourceIntegrationFixture.open(db), db);
    assert.equal(initialSource.pending, 0); assert.equal(initialSource.saved, undefined);
    assert.equal(initialSource.layout, "grid"); assert.deepEqual(initialSource.clipboard, []);
    const autoLayout = await first.evaluate(() => browserDataSourceIntegrationFixture.layout("list"));
    assert.equal(autoLayout.saved.generation, 1); assert.equal(autoLayout.pending, 0);
    const autoClipboard = await first.evaluate(() => browserDataSourceIntegrationFixture.retainClipboard("saved-copy"));
    assert.deepEqual(autoClipboard.saved, { generation: 2, layout: "list", clipboard: ["saved-copy"] });
    assert.equal(await first.evaluate(() => browserDataSourceIntegrationFixture.enabled(false)), true);
    await first.evaluate(() => browserDataSourceIntegrationFixture.layout("tree"));
    const unsaved = await first.evaluate(() => browserDataSourceIntegrationFixture.retainClipboard("discarded-on-reload"));
    assert.equal(unsaved.pending, 1); assert.equal(unsaved.layout, "tree");
    assert.deepEqual(unsaved.clipboard, ["saved-copy", "discarded-on-reload"]);
    assert.deepEqual(unsaved.saved, autoClipboard.saved);
    console.log("Browser source integration: actual automatic writes and paused drafts passed");

    await first.reload(); await first.addScriptTag({ content: bundle, type: "module" });
    await first.waitForFunction(() => !!globalThis.browserDataSourceIntegrationFixture);
    const afterReload = await first.evaluate(db => browserDataSourceIntegrationFixture.open(db), db);
    assert.equal(afterReload.layout, "list"); assert.deepEqual(afterReload.clipboard, ["saved-copy"]);
    assert.equal(afterReload.pending, 0); assert.deepEqual(afterReload.saved, autoClipboard.saved);
    await first.evaluate(() => browserDataSourceIntegrationFixture.enabled(false));
    await first.evaluate(() => browserDataSourceIntegrationFixture.layout("tabs"));
    await first.evaluate(() => browserDataSourceIntegrationFixture.retainClipboard("explicit-copy"));
    const explicitSave = await first.evaluate(() => browserDataSourceIntegrationFixture.save());
    assert.equal(explicitSave.accepted, true); assert.equal(explicitSave.state.enabled, false);
    assert.equal(explicitSave.state.pending, 0);
    assert.deepEqual(explicitSave.state.saved, { generation: 3, layout: "tabs", clipboard: ["saved-copy", "explicit-copy"] });
    await first.close(); await context.close(); context = await launch();
    first = await mount(await context.newPage());
    const afterRestart = await first.evaluate(db => browserDataSourceIntegrationFixture.open(db), db);
    assert.equal(afterRestart.layout, "tabs"); assert.deepEqual(afterRestart.clipboard, ["saved-copy", "explicit-copy"]);
    assert.equal(afterRestart.pending, 0); assert.deepEqual(afterRestart.saved, explicitSave.state.saved);
    console.log("Browser source integration: unsaved reload loss and explicit paused Save/browser restart passed");

    await first.evaluate(() => browserDataSourceIntegrationFixture.enabled(false));
    const staleDraft = await first.evaluate(() => browserDataSourceIntegrationFixture.layout("grid"));
    const second = await mount(await context.newPage());
    await second.evaluate(db => browserDataSourceIntegrationFixture.open(db), db);
    const otherTab = await second.evaluate(() => browserDataSourceIntegrationFixture.layout("tree"));
    assert.equal(otherTab.saved.generation, 4);
    const staleSave = await first.evaluate(() => browserDataSourceIntegrationFixture.save());
    assert.equal(staleSave.accepted, false); assert.equal(staleSave.state.pending, 1);
    assert.equal(staleSave.state.layout, "grid"); assert.match(staleSave.state.error, /another tab/i);
    const discarded = await first.evaluate(() => browserDataSourceIntegrationFixture.discard());
    assert.equal(discarded.accepted, true); assert.equal(discarded.state.pending, 0);
    assert.equal(discarded.state.layout, "tree"); assert.equal(discarded.state.saved.generation, 4);
    assert.ok(discarded.state.revision > staleDraft.revision);
    const refusedEditor = await first.evaluate(async revision => {
      try { await browserDataSourceIntegrationFixture.layout("grid", revision); return false; } catch { return true; }
    }, staleDraft.revision);
    assert.equal(refusedEditor, true);
    await first.evaluate(() => browserDataSourceIntegrationFixture.layout("list"));
    const afterDiscardSave = await first.evaluate(() => browserDataSourceIntegrationFixture.save());
    assert.equal(afterDiscardSave.accepted, true); assert.equal(afterDiscardSave.state.saved.generation, 5);
    assert.equal(afterDiscardSave.state.saved.layout, "list"); assert.equal(afterDiscardSave.state.pending, 0);
    await first.evaluate(() => browserDataSourceIntegrationFixture.close());
    await second.evaluate(() => browserDataSourceIntegrationFixture.close());
    assert.deepEqual(errors, []); assert.deepEqual(requests, []); assert.deepEqual(workers, []);
    console.log("PASS browser source integration: actual source/coordinator/IndexedDB automatic writes, paused drafts, Clipboard, reload loss, explicit Save/process restart, cross-tab refusal, latest-generation Discard, stale-editor refusal and zero HTTP/workers.");
    process.exitCode = 0;
  } else {
  const first = await mount(await context.newPage());
  const durable = database("durable");
  assert.equal(await first.evaluate(db => browserDataStorageFixture.load(db), durable), undefined);
  assert.deepEqual(await first.evaluate(db => browserDataStorageFixture.preAborted(db), database("pre-abort")), ["rejected", "rejected"]);
  const committed = await first.evaluate(async db => browserDataStorageFixture.commit(db,
    await browserDataStorageFixture.initial("retained across reload")), durable);
  assert.equal(committed.generation, 1);
  console.log("Browser storage fixture: first native durable write passed");
  // L4 first paint: the presence probe on an absent database answers empty and
  // leaves nothing behind; the real storage then creates, loads and commits.
  const probed = database("presence-absent");
  assert.equal(await first.evaluate(db => browserDataStorageFixture.presence(db), probed), "empty");
  assert.equal(await first.evaluate(db => browserDataStorageFixture.presence(db), probed), "empty");
  const left = (await first.evaluate(() => browserDataStorageFixture.databases())).filter(entry => entry.name === probed);
  assert.deepEqual(left, [], "the presence probe must not create a database");
  assert.equal(await first.evaluate(db => browserDataStorageFixture.load(db), probed), undefined);
  const afterProbe = await first.evaluate(async db => browserDataStorageFixture.commit(db,
    await browserDataStorageFixture.initial("after the presence probe")), probed);
  assert.equal(afterProbe.generation, 1);
  assert.deepEqual(await first.evaluate(db => browserDataStorageFixture.load(db), probed), afterProbe);
  assert.equal(await first.evaluate(db => browserDataStorageFixture.presence(db), probed), "present");
  assert.equal(await first.evaluate(db => browserDataStorageFixture.presence(db), durable), "present");
  console.log("Browser storage fixture: presence probe on absent and stored databases passed");
  await first.reload();
  await first.addScriptTag({ content: bundle, type: "module" });
  await first.waitForFunction(() => !!globalThis.browserDataStorageFixture);
  const reloaded = await first.evaluate(db => browserDataStorageFixture.load(db), durable);
  assert.deepEqual(reloaded, committed);
  await first.close();
  const pageReopened = await mount(await context.newPage());
  assert.deepEqual(await pageReopened.evaluate(db => browserDataStorageFixture.load(db), durable), committed);
  await context.close();
  context = await launch();
  const reopened = await mount(await context.newPage());
  assert.deepEqual(await reopened.evaluate(db => browserDataStorageFixture.load(db), durable), committed);
  console.log("Browser storage fixture: reload/page reopen/browser restart passed");
  const second = await mount(await context.newPage());
  // Prepare both policy contexts before racing IO; editor preparation must
  // not accidentally serialize the two independent writers being exercised.
  await second.evaluate(() => browserDataStorageFixture.initial());

  const absentRace = database("absent-race");
  const race = await Promise.all([reopened, second].map((page, index) => page.evaluate(async ({ db, index }) => {
    try {
      const saved = await browserDataStorageFixture.commit(db, await browserDataStorageFixture.initial(`writer-${index}`));
      return { status: "fulfilled", generation: saved.generation };
    } catch (error) { return { status: "rejected", message: error.message }; }
  }, { db: absentRace, index })));
  assert.deepEqual(race.map(result => result.status).sort(), ["fulfilled", "rejected"]);
  assert.equal(race.find(result => result.status === "fulfilled").generation, 1);
  const generationRace = await Promise.all([reopened, second].map((page, index) => page.evaluate(async ({ db, index }) => {
    try {
      const saved = await browserDataStorageFixture.commit(db, await browserDataStorageFixture.initial(`replacement-${index}`), 1);
      return { status: "fulfilled", generation: saved.generation };
    } catch (error) { return { status: "rejected", message: error.message }; }
  }, { db: absentRace, index })));
  assert.deepEqual(generationRace.map(result => result.status).sort(), ["fulfilled", "rejected"]);
  assert.equal(generationRace.find(result => result.status === "fulfilled").generation, 2);
  console.log("Browser storage fixture: independent-page concurrent generations passed");

  const beforeAbort = await reopened.evaluate(db => browserDataStorageFixture.load(db), durable);
  assert.deepEqual(await reopened.evaluate(db => browserDataStorageFixture.abortCommit(db, 1), durable),
    { entered: true, refused: true, name: "AbortError" });
  assert.deepEqual(await reopened.evaluate(db => browserDataStorageFixture.load(db), durable), beforeAbort);
  assert.equal(await reopened.evaluate(db => browserDataStorageFixture.cloneFailure(db, 1), durable), true);
  assert.deepEqual(await reopened.evaluate(db => browserDataStorageFixture.load(db), durable), beforeAbort);

  for (const [label, replacement] of [["unknown-version", { schema: "future-format", generation: 1, data: committed.data }],
    ["corrupt", { schema: "fenel.local-data.v1", generation: -1, data: committed.data }]]) {
    const db = database(label);
    await reopened.evaluate(({ db, value }) => browserDataStorageFixture.raw(db, { value }), { db, value: replacement });
    const refusal = await reopened.evaluate(async db => {
      const results = await Promise.allSettled([browserDataStorageFixture.load(db),
        browserDataStorageFixture.commit(db, await browserDataStorageFixture.initial(), undefined)]);
      return results.map(result => result.status);
    }, db);
    assert.deepEqual(refusal, ["rejected", "rejected"]);
    assert.deepEqual(await reopened.evaluate(db => browserDataStorageFixture.raw(db), db), replacement);
  }
  assert.deepEqual(await reopened.evaluate(db => browserDataStorageFixture.lossless(db), database("lossless")), {
    generation: 1, negativeZero: true, notANumber: true, positiveInfinity: true,
    negativeInfinity: true, binary: true, bytes: [0, 1, 127, 255],
  });
  const snapshotKeys = ["definitions", "entries", "layout", "representations", "revision", "tabId", "values"];
  assert.deepEqual(await reopened.evaluate(db => browserDataStorageFixture.projectedOnly(db), database("projection")),
    { saved: snapshotKeys, loaded: snapshotKeys });
  assert.deepEqual(errors, []);
  assert.deepEqual(requests, []);
  console.log("PASS browser data storage: real IndexedDB reload/page reopen/browser restart, independent-page CAS, abort/clone preservation, unknown/corrupt refusal, lossless values, authored-only snapshots and zero HTTP IO.");
  }
} finally { await context?.close(); }
