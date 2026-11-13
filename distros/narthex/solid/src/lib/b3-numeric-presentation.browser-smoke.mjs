// B3 numeric presentation: compile the complete production renderer unchanged.
// Before freezes only that renderer at the committed post-B3 baseline; fixture
// data, worker transport, Solid runtime, and production CSS stay the same.
// Build separately: FENEL_B3_BUILD_ONLY=1 bun <this file> before|after
// Capture an existing build: node <this file> before|after
// Capture from the main repo root with FENEL_TEST_BROWSER_CHANNEL=chrome;
// Playwright resolves from that cwd while sources stay beside this fixture.
import { strict as assert } from "node:assert";
import { mkdir, readFile, realpath } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { createRequire } from "node:module";

const mode = process.argv[2] ?? "after";
if (mode !== "before" && mode !== "after") throw new Error("Expected before or after");
const baselineSha = process.env.FENEL_B3_BASELINE_SHA ?? "a74da8fa";
const repository = fileURLToPath(new URL("../../../../../", import.meta.url));
const sourceRoot = fileURLToPath(new URL("../", import.meta.url));
const captureRoot = join(repository, ".tmp-diag", "shots", "20261024-b3-captures");
const buildRoot = join(repository, ".tmp-diag", "b3-numeric-build");
await mkdir(captureRoot, { recursive: true });
await mkdir(buildRoot, { recursive: true });

if (process.versions.bun) {
  const rendererPath = fileURLToPath(new URL("./variant-value/VariantValueRenderer.tsx", import.meta.url));
  const fixturePath = fileURLToPath(new URL("./b3-numeric-presentation.fixture.tsx", import.meta.url));
  const supportPath = fileURLToPath(new URL("./b3-numeric-presentation.fixture-support.ts", import.meta.url));
  const baselineSource = path => {
    const shown = Bun.spawnSync(["git", "--no-optional-locks", "-c", "core.preloadIndex=false", "-c", "core.fsmonitor=false",
      "show", `${baselineSha}:${path}`], { cwd: repository, timeout: 30000 });
    if (shown.exitCode !== 0) throw new Error(`Cannot read baseline ${baselineSha}:${path}`);
    return new TextDecoder().decode(shown.stdout);
  };
  const renderer = mode === "before"
    ? baselineSource("distros/narthex/solid/src/lib/variant-value/VariantValueRenderer.tsx")
    : await Bun.file(rendererPath).text();
  const section = (source, startMarker, endMarker, label) => {
    const start = source.indexOf(startMarker);
    const end = source.indexOf(endMarker, start);
    if (start < 0 || end <= start) throw new Error(`${label} extraction boundary moved`);
    return source.slice(start, end);
  };
  // Shared production helpers are extracted unchanged in both modes. The old
  // renderer does not import localReadSession or registryTransportSnapshot.
  const [workerSource, registrySource, previewSource] = await Promise.all([
    Bun.file(fileURLToPath(new URL("./expression-runner/authoring-catalog-worker.ts", import.meta.url))).text(),
    Bun.file(join(repository, "implementations/typescript/engine/src/registry.ts")).text(),
    Bun.file(fileURLToPath(new URL("./data-transfer/DataPreview.tsx", import.meta.url))).text(),
  ]);
  const modules = new Map([
    ["worker", `export { preparedReaderWorkerForSession, runPreparedReaderWorker } from ${JSON.stringify(supportPath)};\n`
      + section(workerSource, "export function localReadSession(", "/** Bind only a scope", "localReadSession")],
    ["registry", section(registrySource, "export function registryTransportSnapshot<",
      "/** Snapshot the entire caller-owned module", "registryTransportSnapshot")],
    ["delimited", section(previewSource, "export function DelimitedText(",
      "/** Media uses a bounded preview", "DelimitedText")],
  ]);
  const compilerPath = Bun.resolveSync("@solidjs/compiler", dirname(fileURLToPath(import.meta.resolve("@solidjs/vite-plugin"))));
  const compiler = await import(pathToFileURL(compilerPath).href);
  // Virtual helper modules need explicit package resolution. Use the same
  // physical browser runtime for the fixture, renderer, and extracted JSX.
  const clientModules = {};
  for (const name of ["solid-js", "@solidjs/web"]) {
    clientModules[name] = await realpath(join(sourceRoot, "../node_modules", name, "dist", name === "solid-js" ? "solid.dev.js" : "web.dev.js"));
  }
  clientModules["@solidjs/signals"] = await realpath(join(dirname(dirname(clientModules["solid-js"])), "../@solidjs/signals/dist/dev.js"));
  const compile = async (source, filename) => ({ loader: "ts", resolveDir: dirname(filename), contents: (await compiler.transformAsync(source, {
    filename, generate: "dom", hydratable: false, dev: true,
  })).code });
  const build = await Bun.build({
    entrypoints: [fixturePath], target: "browser", conditions: ["browser", "development"],
    plugins: [{ name: "b3-numeric-fixture", setup(builder) {
      builder.onResolve({ filter: /^(?:solid-js|@solidjs\/(?:web|signals))$/ }, args => ({ path: clientModules[args.path] }));
      builder.onResolve({ filter: /\/authoring-catalog-worker$/ }, () => ({ path: "worker", namespace: "b3-numeric" }));
      builder.onResolve({ filter: /\/engine\/src\/registry$/ }, () => ({ path: "registry", namespace: "b3-numeric" }));
      builder.onResolve({ filter: /\/data-transfer\/DataPreview$/ }, () => ({ path: "delimited", namespace: "b3-numeric" }));
      builder.onResolve({ filter: /^(?:@fenel\/engine(?:\/authoring\/(?:type|field-render))?$|.*\/effect-dispatch$|.*\/authoring-session$|.*\/reader-runtime$|.*\/numeric-text-codec$)/ },
        () => ({ path: supportPath }));
      builder.onResolve({ filter: /^~\// }, args => ({ path: Bun.resolveSync(join(sourceRoot, args.path.slice(2)), sourceRoot) }));
      // An unexpected engine dependency must fail instead of silently turning
      // this controlled renderer test into a full registry build.
      builder.onResolve({ filter: /^@fenel\// }, args => { throw new Error(`Numeric fixture eagerly imports ${args.path}`); });
      builder.onLoad({ filter: /.*/, namespace: "b3-numeric" }, async args => {
        const source = modules.get(args.path);
        if (source === undefined) throw new Error(`Unknown numeric fixture module ${args.path}`);
        return args.path === "delimited"
          ? compile(source, fileURLToPath(new URL("./data-transfer/DataPreview.tsx", import.meta.url)))
          : { loader: "ts", contents: source, resolveDir: dirname(supportPath) };
      });
      builder.onLoad({ filter: /\.tsx$/ }, async args => compile(
        args.path.toLowerCase() === rendererPath.toLowerCase() ? renderer : await Bun.file(args.path).text(), args.path));
      builder.onLoad({ filter: /\.css$/ }, () => ({ loader: "js", contents: "" }));
    } }],
  });
  if (!build.success) throw new AggregateError(build.logs, "B3 numeric fixture build failed");
  const entry = build.outputs.find(output => output.kind === "entry-point");
  if (!entry) throw new Error("B3 numeric fixture has no browser entry point");
  await Bun.write(join(buildRoot, `${mode}.js`), entry);
  const styles = await Promise.all(["../global.css", "../routes/app.css", "./variant-value/variant-value.css", "./data-transfer/data-transfer.css"]
    .map(path => Bun.file(fileURLToPath(new URL(path, import.meta.url))).text()));
  await Bun.write(join(buildRoot, `${mode}.css`), styles.join("\n") + `
    body { margin: 0; background: #f8fafc; color: #0f172a; }
    .b3-numeric-card { border: 1px solid #e2e8f0; border-radius: 10px; background: white; padding: 18px; min-height: 130px; }
    .b3-numeric-card h2 { margin: 0; font-size: 15px; font-weight: 600; }
    .b3-numeric-card p { margin: 6px 0 18px; color: #64748b; font-size: 12px; }
    .b3-numeric-value { min-height: 30px; line-height: 1.6; }
  `);
  console.log(JSON.stringify({ mode, build: join(buildRoot, `${mode}.js`), baselineSha: mode === "before" ? baselineSha : undefined }));
  if (process.env.FENEL_B3_BUILD_ONLY === "1") process.exit(0);
  const child = Bun.spawn(["node", fileURLToPath(import.meta.url), mode], { stdout: "inherit", stderr: "inherit" });
  process.exit(await child.exited);
}

const { chromium } = createRequire(join(process.cwd(), "package.json"))("playwright");
const browser = await chromium.launch({ headless: true, channel: process.env.FENEL_TEST_BROWSER_CHANNEL });
try {
  const [script, css] = await Promise.all([
    readFile(join(buildRoot, `${mode}.js`), "utf8"), readFile(join(buildRoot, `${mode}.css`), "utf8"),
  ]);
  const page = await browser.newPage({ viewport: { width: 1000, height: 700 }, deviceScaleFactor: 2 });
  const errors = [];
  page.on("pageerror", error => errors.push(error.message));
  page.on("console", message => { if (message.type() === "error") errors.push(message.text()); });
  await page.route("**/*", route => route.fulfill({ contentType: "text/html", body: "<!doctype html><html><body></body></html>" }));
  await page.goto("https://fenel.test/");
  await page.emulateMedia({ reducedMotion: "reduce" });
  await page.addStyleTag({ content: css });
  await page.addScriptTag({ content: script, type: "module" });
  const settle = async () => {
    await page.waitForFunction(() => globalThis.b3NumericFixture?.ready && globalThis.b3NumericFixture.state().pending === 0,
      undefined, { timeout: 15000 }).catch(error => { console.error(JSON.stringify({ errors })); throw error; });
    await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
  };
  await settle();
  const shot = join(captureRoot, `${mode}-b3-numeric-presentation.png`);
  await page.screenshot({ path: shot });
  const entry = caseId => page.locator(`[data-case="${caseId}"]`);
  const value = caseId => entry(caseId).locator(".b3-numeric-value");
  const readyNode = await entry("ready").locator(".fenel-string-data__content").elementHandle();
  assert.ok(readyNode, "The ready sibling renders through the real DelimitedText component");
  assert.equal(await readyNode.innerText(), "Ready sibling");
  const requests = await page.evaluate(() => globalThis.b3NumericFixture.requests());
  for (const request of requests) {
    assert.ok(request && typeof request === "object" && Object.hasOwn(request, "value"), "Every worker request records its value");
    assert.ok(["project-reader-values", "encode-reader-numeric-text"].includes(request.method), "Only worker reflection or numeric encoding is used");
    assert.equal(typeof request.context, "string");
    assert.ok(["recursive-record", "recursive-list", "draft", "module", "failed", "ready"].includes(request.caseId));
  }
  for (const caseId of ["draft", "module"]) {
    const scoped = requests.filter(request => request.caseId === caseId);
    assert.ok(scoped.length > 0, `${caseId} issued a numeric read`);
    assert.ok(scoped.every(request => request.context === (mode === "before" ? "committed" : caseId)),
      `${caseId} requests all use the ${mode === "before" ? "committed baseline" : "active"} context`);
    assert.match(await value(caseId).innerText(), mode === "before" ? /1\/2/ : /2\/3/);
  }
  for (const caseId of ["recursive-record", "recursive-list"]) {
    const text = await value(caseId).innerText();
    if (mode === "before") {
      assert.match(text, /num\s*:/, `${caseId} exposes the baseline raw numerator`);
      assert.match(text, /den\s*:/, `${caseId} exposes the baseline raw denominator`);
    } else {
      assert.match(text, /1\/2/, `${caseId} renders the worker's exact numeric text`);
      assert.doesNotMatch(text, /(?:num|den)\s*:/, `${caseId} does not expose raw numeric fields`);
      const methods = requests.filter(request => request.caseId === caseId).map(request => request.method);
      assert.ok(methods.includes("project-reader-values") && methods.includes("encode-reader-numeric-text"),
        `${caseId} resolves its absent type hint and encodes through the worker`);
    }
  }
  const failed = value("failed");
  if (mode === "before") {
    assert.match(await failed.innerText(), /num\s*:/);
    assert.equal(await failed.getByRole("button", { name: "Retry", exact: true }).count(), 0);
  } else {
    assert.equal(await failed.getByRole("alert").innerText(), "Display unavailable.");
    assert.equal(await failed.getByRole("status").count(), 0, "A failed display is no longer announced as loading");
    const failedRequests = requests.filter(request => request.caseId === "failed").length;
    await page.evaluate(() => globalThis.b3NumericFixture.succeed());
    await failed.getByRole("button", { name: "Retry", exact: true }).click();
    await settle();
    assert.match(await failed.innerText(), /1\/2/);
    assert.doesNotMatch(await failed.innerText(), /(?:num|den)\s*:/);
    assert.equal(await failed.getByRole("alert").count(), 0);
    assert.equal(await failed.getByRole("button", { name: "Retry", exact: true }).count(), 0);
    assert.ok(await page.evaluate(() => globalThis.b3NumericFixture.requests().filter(request => request.caseId === "failed").length) > failedRequests,
      "Retry issues a new worker request");
    assert.equal(await page.evaluate(node => node.isConnected && node === document.querySelector('[data-case="ready"] .fenel-string-data__content'), readyNode), true,
      "Recovering the failed display retains the ready sibling DOM node");
    assert.equal(await readyNode.innerText(), "Ready sibling");
    await page.screenshot({ path: join(captureRoot, "after-b3-numeric-recovered.png") });
  }
  assert.deepEqual(errors, [], "No page-side reflection, codec, or runtime errors");
  console.log(JSON.stringify({ mode, shot, requests: requests.length, b3: "passed" }));
} finally {
  await browser.close();
}
