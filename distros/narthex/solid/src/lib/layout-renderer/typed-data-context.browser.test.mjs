import { expect, test } from "bun:test";
import { mkdir, mkdtemp, readFile, realpath, rm } from "node:fs/promises";
import { dirname, join, resolve, sep } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

// C2 event test: actual read/card/structural components consume a captured
// direct String/record/List declaration. Semantic discovery has separate real
// checker tests; this fixture never builds a repository registry or evaluator.
test("typed data context events retain the nearest source occurrence (small browser fixture)", async () => {
  const repository = fileURLToPath(new URL("../../../../../../", import.meta.url));
  const sourceRoot = join(repository, "distros/narthex/solid/src").replaceAll("\\", "/");
  const scratch = join(repository, ".tmp-tsc");
  await mkdir(scratch, { recursive: true });
  const directory = await mkdtemp(join(scratch, "typed-data-context-"));
  try {
    const compilerPath = Bun.resolveSync("@solidjs/compiler", dirname(fileURLToPath(import.meta.resolve("@solidjs/vite-plugin"))));
    const compiler = await import(pathToFileURL(compilerPath).href);
    const clientModules = {};
    for (const name of ["solid-js", "@solidjs/web"]) {
      const target = await realpath(resolve(sourceRoot, "../node_modules", name, "dist", name === "solid-js" ? "solid.dev.js" : "web.dev.js"));
      if (!target.startsWith(resolve(repository) + sep)) throw new Error("Client runtime escaped the repository");
      clientModules[name] = target.replaceAll("\\", "/");
    }
    const signals = await realpath(resolve(dirname(dirname(clientModules["solid-js"])), "../@solidjs/signals/dist/dev.js"));
    if (!signals.startsWith(resolve(repository) + sep)) throw new Error("Client signals escaped the repository");
    clientModules["@solidjs/signals"] = signals.replaceAll("\\", "/");
    const prefix = `import { Show } from "solid-js";
      const StringType = { $ref: "String" };
      const session = { registry: { getIdentifiedEntity() {}, getFieldRepresentation() {} },
        evaluateContext: {}, environment: { catalog: {}, resolveTypeRef() {} } };
      const scalar = props => <span>{typeof props.value === "string" ? props.value : String(props.value ?? "")}</span>;
      const missing = () => { throw new Error("The event fixture must not evaluate or edit"); };
    `;
    const css = (await Promise.all(["global.css", "routes/app.css", "lib/home-entry.css"].map(path => readFile(join(sourceRoot, path), "utf8")))).join("\n");
    const engine = `
      export const entitySchemaFields = entity => entity.type.$record.fields;
      export const resolveEffect = () => undefined;
      export const typeConstructorOf = () => undefined;
      export const recordFieldsForType = type => type?.$record?.fields;
      export const peelToVariantType = () => undefined;
      export const typeCode = type => type?.$ref ?? (type?.$record ? "Record" : "List");
      export const typePhrase = typeCode;
      export const isFenelTypeLike = () => false;
      export const peelMaybeForAuthoring = () => undefined;
      export const resolveValueType = type => type;
      export const nativeValueTypeName = () => undefined;
      export const peelListForAuthoring = type => type?.$ref === "List" ? { elem: type.args[0] } : undefined;
      export const projectLocusTypeDescriptions = () => [];
      export const Anything = { $ref: "Any" }, Nothing = { $tag: "Nothing" };
      export const peelMaybeValue = () => undefined;
      export const refHandle = type => type?.$ref;
      export const surfaceReadValuePlan = value => ({ value });
      export const fieldNumericTextCodecPlan = () => undefined;
      export const encodeCheckpointValue = value => value;
      export const registryTransportSnapshot = missing;
    `;
    const stubFor = path => {
      if (path.startsWith("@fenel/") || /implementations[\\/]typescript[\\/]engine[\\/]src[\\/]/.test(path)) return engine;
      if (/authoring-session$/.test(path)) return "export const useAuthoringSession = () => session;";
      if (/expression-surfaces$/.test(path)) return `export const ExpressionGraphCollectionItemControl = () => null,
        ExpressionGraphCaptureContext = {}, ExpressionGraphScopeCaptureContext = {};`;
      if (/ExpressionEditor$/.test(path)) return "export const ExpressionEditor = missing, ExpressionGraphValueContext = {};";
      if (/authoring-catalog-worker$/.test(path)) return `export const localReadSession = missing,
        preparedReaderWorkerForSession = missing, runPreparedReaderWorker = missing;`;
      if (/lens-shortcuts$/.test(path)) return "export const returnedExpressionNode = missing;";
      if (/loading-screen$/.test(path)) return "export const LensSpinner = () => <span role='status'>Loading</span>;";
      if (/reader-runtime$/.test(path)) return "export const useReaderRuntime = () => undefined;";
      if (/reader-presentation$/.test(path)) return `export const readerResultTypeLabel = () => undefined,
        readerTypeLabelInSession = type => type?.$ref ?? 'Record',
        readerTypePresentationInSession = type => ({ label: type?.$ref ?? 'Record' });`;
      if (/DataInspectionDialog$/.test(path)) return `export function createDataInspectionSuggestions(capture) {
        let issue; return { items: () => issue ? [{ id: 'issue', label: issue, disabled: true }] : [],
          open() { globalThis.fixtureSuggestionQueries = (globalThis.fixtureSuggestionQueries ?? 0) + 1;
            try { capture(); } catch (error) { issue = error.message; } }, close() {}, invalidate() {},
          pending: () => false, issue: () => issue, read: () => undefined, hold: () => () => {}, warm() {}, select() {} };
      }`;
      if (/(?:data-transfer[\\/])?DataPreview$/.test(path)) return `export const DataPreview = scalar, DelimitedText = scalar, StructuralReadValue = scalar;
        export const DataThumbnail = () => <span data-thumbnail>●</span>;
        export const hasDataPreview = () => false;`;
      if (/VariantValueRenderer$/.test(path)) return "export const VariantValueRenderer = scalar;";
      if (/web-template-registry$/.test(path)) return "export const webRegistry = { registerComponent() {}, resolve() {}, getComponent() {} };";
      if (/LayoutRenderer$/.test(path)) return "export const LayoutRenderer = () => null, ReadValue = scalar, ReadPlanValue = props => <span>{props.plan.value}</span>;";
      if (/DataTransferTarget$/.test(path)) return "export const DataTransferTarget = props => <div data-transfer-read>{props.children}</div>;";
      if (/session-analysis$/.test(path)) return "export const adaptTransferForSession = missing;";
      if (/data-transfer[\\/]index$/.test(path) || path === "./index") return "export const classifyData = () => 'Data', ingestTransfer = missing;";
      if (/expressions$/.test(path)) return `export const transferContainerShape = type => type;
        export const expressionForTransfer = missing, typeForTransfer = missing, prepareTransferItem = missing;`;
      if (/charts$/.test(path)) return "export const LineChart = () => null;";
      if (/storybook$/.test(path)) return "export const AnimationFrameStripView = () => null;";
      if (/RichDocumentRead$/.test(path)) return "export const RichDocumentRead = () => null;";
      if (/type-data-preview$/.test(path)) return "export const TypeDataPreviewBody = () => null;";
      return undefined;
    };
    const entry = `import { render } from "@solidjs/web";
      import { TypedReadValue } from ${JSON.stringify(join(sourceRoot, "lib/layout-renderer/TypedReadValue.tsx"))};
      const stringType = { $ref: "String" };
      const field = { name: "title", type: stringType, label: { $tag: "Nothing" }, meta: {}, ui: { $tag: "Nothing" } };
      const recordType = { $record: { fields: [field] } }, recordValue = { title: "Selected child" };
      const listType = { $ref: "List", args: [stringType] }, listValue = ["First child", "Second child"];
      const owned = (value, type) => ({ state: 'source', capture: () => ({ session: {},
        input: { expression: { kind: 'literal', value }, type, sourceType: type, revision: 'fixture:1' },
        current: () => true, select() { throw new Error('The context event must not execute a suggestion'); } }) });
      const recordSource = owned(recordValue, recordType), listSource = owned(listValue, listType);
      const events = [];
      function context(event, data) { event.preventDefault(); event.stopPropagation();
        events.push({ value: data.value, path: data.path, type: data.getType() }); }
      render(() => <div style="width: 700px"><style>{${JSON.stringify(css)}}</style>
        <div data-case="record"><TypedReadValue detail type={recordType} value={recordValue}
          dataPath={["outer"]} occurrence={recordSource} onDataContext={context} /></div>
        <div data-case="list"><TypedReadValue type={listType} value={listValue}
          dataPath={["rows"]} occurrence={listSource} onDataContext={context} /></div>
      </div>, document.getElementById("fixture"));
      globalThis.typedDataContext = { events: () => events, stringType };
    `;
    const browser = await Bun.build({ entrypoints: ["typed-context:entry"], target: "browser", conditions: ["browser", "development"],
      plugins: [{ name: "captured-read-boundary", setup(build) {
        build.onResolve({ filter: /^typed-context:/ }, args => ({ path: args.path, namespace: "context-fixture" }));
        build.onResolve({ filter: /.*/ }, args => {
          if (clientModules[args.path]) return { path: clientModules[args.path] };
          const mocked = stubFor(args.path);
          if (mocked !== undefined) return { path: args.path, namespace: "context-fixture" };
          if (args.path.startsWith("~/")) return { path: Bun.resolveSync(join(sourceRoot, args.path.slice(2)), sourceRoot).replaceAll("\\", "/") };
          // Bun's Windows package resolver can retain backslashes internally;
          // plugin results use the same normalized spelling as our client roots.
          if (args.resolveDir) return { path: Bun.resolveSync(args.path, args.resolveDir).replaceAll("\\", "/") };
        });
        build.onLoad({ filter: /.*/, namespace: "context-fixture" }, async args => ({ loader: "ts", resolveDir: sourceRoot,
          contents: (await compiler.transformAsync(args.path === "typed-context:entry" ? entry : prefix + stubFor(args.path), {
            filename: join(sourceRoot, "typed-context-fixture.tsx"), generate: "dom", hydratable: false, dev: true,
          })).code }));
        build.onLoad({ filter: /\.tsx$/ }, async args => ({ loader: "ts", contents: (await compiler.transformAsync(await readFile(args.path, "utf8"), {
          filename: args.path, generate: "dom", hydratable: false, dev: true,
        })).code }));
        build.onLoad({ filter: /\.css$/ }, () => ({ loader: "js", contents: "" }));
      } }] });
    if (!browser.success) throw new AggregateError(browser.logs, "Typed data context fixture failed to compile");
    const browserPath = join(directory, "browser.js");
    await Bun.write(browserPath, browser.outputs[0]);
    const runnerPath = join(directory, "runner.mjs");
    await Bun.write(runnerPath, `import { readFile } from 'node:fs/promises'; import assert from 'node:assert/strict';
      const { chromium } = await import(${JSON.stringify(import.meta.resolve("playwright"))});
      console.log('Launching typed-data browser');
      const browser = await chromium.launch({ headless: true, timeout: 20000, channel: process.env.FENEL_TEST_BROWSER_CHANNEL });
      console.log('Typed-data browser ready');
      try { const page = await browser.newPage(); const errors = []; page.on('pageerror', error => errors.push(error.message));
        page.setDefaultTimeout(10000);
        await page.setContent('<html><body><div id="fixture"></div></body></html>');
        console.log('Loading actual typed read components');
        await page.addScriptTag({ content: await readFile(process.argv[2], 'utf8'), type: 'module' });
        console.log('Typed read components mounted');
        await page.locator('[data-case="record"]').getByText('Selected child', { exact: true }).click({ button: 'right' });
        await page.locator('[data-case="list"] .locus-previews__cell').first().click({ button: 'right' });
        const state = await page.evaluate(() => ({ events: typedDataContext.events(), type: typedDataContext.stringType }));
        assert.deepEqual(state.events, [{ value: 'Selected child', path: ['outer', 'title'], type: state.type },
          { value: 'First child', path: ['rows', 0], type: state.type }]); assert.deepEqual(errors, []);
        assert.equal(await page.evaluate(() => globalThis.fixtureSuggestionQueries ?? 0), 0);
        console.log('Typed data source context: 2 nearest-child events passed');
      } finally { await browser.close(); }
    `);
    if (process.env.FENEL_TYPED_CONTEXT_EXPORT) {
      console.log(`Typed data context fixture exported: ${directory}`); return;
    }
    const child = Bun.spawn(["node", runnerPath, browserPath], { stdout: "pipe", stderr: "pipe",
      env: { ...process.env, TEMP: directory, TMP: directory } });
    const [exitCode, stdout, stderr] = await Promise.all([child.exited, new Response(child.stdout).text(), new Response(child.stderr).text()]);
    if (exitCode !== 0) throw new Error(`${stdout}\n${stderr}`);
    expect(stdout).toContain("2 nearest-child events passed");
    console.log(stdout);
  } finally {
    const target = resolve(directory);
    if (!target.startsWith(resolve(scratch) + sep)) throw new Error("Typed context fixture cleanup escaped repository scratch");
    if (!process.env.FENEL_TYPED_CONTEXT_EXPORT) await rm(target, { recursive: true, force: true });
  }
}, 60000);

// C2: the real structural preview and Local request/paint wrapper, with a
// controlled packet/body seam. No registry, inference or evaluator is loaded.
test("structural constructor names and Local record depth survive read capture (small browser fixture)", async () => {
  const repository = resolve(fileURLToPath(new URL("../../../../../../", import.meta.url)));
  const packageRoot = join(repository, "distros/narthex/solid");
  const sourceRoot = join(packageRoot, "src");
  const capture = resolve(repository, process.env.FENEL_RENDERER_CAPTURE_DIR ?? ".tmp-tsc/renderer-capture");
  if (!capture.startsWith(repository + sep)) throw new Error("Renderer capture escaped repository");
  await mkdir(capture, { recursive: true });
  const baseline = process.env.FENEL_RENDERER_BASELINE_DIR;
  const productionSource = async path => {
    if (baseline && ["DataPreview.tsx", "TypedReadValue.tsx"].some(name => path.endsWith(name))) {
      const directory = resolve(repository, baseline);
      if (!directory.startsWith(repository + sep)) throw new Error("Renderer baseline escaped repository");
      return readFile(join(directory, path.split(/[\\/]/).at(-1)), "utf8");
    }
    return readFile(path, "utf8");
  };
  const compiler = await import(pathToFileURL(Bun.resolveSync("@solidjs/compiler",
    dirname(fileURLToPath(import.meta.resolve("@solidjs/vite-plugin"))))).href);
  const modules = {};
  for (const name of ["solid-js", "@solidjs/web"]) modules[name] = await realpath(join(packageRoot,
    "node_modules", name, "dist", name === "solid-js" ? "solid.dev.js" : "web.dev.js"));
  modules["@solidjs/signals"] = await realpath(resolve(dirname(dirname(modules["solid-js"])), "../@solidjs/signals/dist/dev.js"));
  const source = await productionSource(join(sourceRoot, "lib/layout-renderer/TypedReadValue.tsx"));
  const wrapper = source.slice(source.indexOf("export function TypedReadValue("), source.indexOf("/** A field's shown name."));
  if (!wrapper.startsWith("export function TypedReadValue(")) throw new Error("Local reader fixture extraction failed");
  const reader = `import { Errored, Loading, NotReadyError, Show, createMemo, createSignal, latest, onSettled } from "solid-js";
    import { createAsyncValue } from ${JSON.stringify(join(sourceRoot, "lib/async-value.ts"))};
    const session = {}, worker = {}, templates = { list: () => [], listComponentNames: () => [] };
    const useReaderRuntime = () => ({ kind: 'local', session: () => session, templates: () => templates, revision: () => 1 });
    const useAuthoringSession = () => session, localReadSession = () => session, preparedReaderWorkerForSession = () => worker;
    const registryTransportSnapshot = value => structuredClone(value), LUCIDE_BY_NAME = {};
    const valueCardTypeLabel = value => value;
    const runPreparedReaderWorker = async () => ({ valueReads: [{ root: { field: {}, glyph: {}, numeric: false,
      body: 'structural', recordLabel: 'Record', structure: 'record', readPlan: null }, children: [] }] });
    const TypedReadValueBody = props => <span data-depth>{String(props.recordDepth)}</span>;
    ${wrapper}`;
  const css = (await Promise.all(["global.css", "lib/data-transfer/data-transfer.css", "lib/layout-renderer/typed-read-value.css",
    "lib/display-name.css"].map(path => readFile(join(sourceRoot, path), "utf8")))).join("\n");
  const entry = `import { render } from '@solidjs/web'; import { createSignal, flush } from 'solid-js';
    import { DataPreview, StructuralReadValue } from ${JSON.stringify(join(sourceRoot, "lib/data-transfer/DataPreview.tsx"))};
    import { TypedReadValue } from 'renderer:reader';
    const [depth, setDepth] = createSignal(5);
    const cycle = {}; cycle.self = cycle;
    render(() => <main style="max-width:600px;padding:24px;font:16px system-ui">
      <style>{${JSON.stringify(css)}}</style><h1 style="font-size:20px">Structural data</h1>
      <section data-ok><h2 style="font-size:16px">Success</h2><DataPreview value={{ $tag: 'Ok', _0: 'same payload' }} /></section>
      <section data-err><h2 style="font-size:16px">Failure</h2><DataPreview value={{ $tag: 'Err', _0: 'same payload' }} /></section>
      <section data-nested><h2 style="font-size:16px">Nested constructor</h2><DataPreview value={{ status: { $tag: 'Pending', note: 'Waiting' } }} /></section>
      <section data-optional><h2 style="font-size:16px">Optional data</h2><DataPreview value={{ absent: { $tag: 'Nothing' }, present: { $tag: 'Just', _0: 'kept' } }} /></section>
      <section data-cycle><h2 style="font-size:16px">Recursive record</h2><StructuralReadValue value={cycle} /></section>
      <section data-depth-wrapper hidden><TypedReadValue value={{ title: 'depth probe' }} recordDepth={depth()} /></section>
    </main>, document.getElementById('fixture'));
    globalThis.rendererFixture = { advance: () => { setDepth(6); flush(); } };`;
  const browser = await Bun.build({ entrypoints: ["renderer:entry"], target: "browser", conditions: ["browser", "development"],
    plugins: [{ name: "bounded-structural-read", setup(build) {
      build.onResolve({ filter: /^renderer:/ }, args => ({ path: args.path, namespace: "renderer" }));
      build.onResolve({ filter: /.*/ }, args => {
        if (modules[args.path]) return { path: modules[args.path] };
        if (args.kind === "dynamic-import") return { path: "/fixture/unused-dynamic", external: true };
        if (/(?:^|[\\/])(?:icons|ImageCanvas)$/.test(args.path)) return { path: "renderer:visual-leaves", namespace: "renderer" };
      });
      build.onLoad({ filter: /.*/, namespace: "renderer" }, async args => ({ loader: "ts", resolveDir: sourceRoot,
        contents: (await compiler.transformAsync(args.path === "renderer:entry" ? entry : args.path === "renderer:reader" ? reader
          : "export const IconByName = () => null, ImageCanvas = () => null, LUCIDE_BY_NAME = {}, TYPE_ICON_FALLBACKS = {};", {
          filename: join(sourceRoot, "renderer-fixture.tsx"), generate: "dom", hydratable: false, dev: true })).code }));
      build.onLoad({ filter: /\.tsx$/ }, async args => ({ loader: "ts", contents: (await compiler.transformAsync(await productionSource(args.path), {
        filename: args.path, generate: "dom", hydratable: false, dev: true })).code }));
      build.onLoad({ filter: /\.css$/ }, () => ({ loader: "js", contents: "" }));
    } }] });
  if (!browser.success) throw new AggregateError(browser.logs, "Structural reader fixture failed to build");
  const bundle = join(capture, "browser.js"); await Bun.write(bundle, browser.outputs[0]);
  const runner = join(capture, "runner.mjs");
  await Bun.write(runner, `import { readFile, writeFile } from 'node:fs/promises'; import assert from 'node:assert/strict';
    const { chromium } = await import(${JSON.stringify(import.meta.resolve("playwright"))});
    const browser = await chromium.launch({ headless: true, channel: process.env.FENEL_TEST_BROWSER_CHANNEL ?? 'chrome' });
    const results = [];
    try { for (const [name, viewport] of [['desktop', { width: 1280, height: 1000 }], ['phone', { width: 390, height: 844 }]]) {
      const page = await browser.newPage({ viewport, reducedMotion: 'reduce' }), errors = [];
      page.on('pageerror', error => errors.push(error.message));
      await page.setContent('<html><body><div id="fixture"></div></body></html>');
      await page.addScriptTag({ content: await readFile(${JSON.stringify(bundle)}, 'utf8'), type: 'module' });
      await page.locator('[data-depth]').waitFor({ state: 'attached', timeout: 5000 });
      const depthBefore = await page.locator('[data-depth]').textContent();
      await page.evaluate(() => rendererFixture.advance());
      await page.waitForTimeout(50);
      const state = { name, errors, depthBefore, depthAfter: await page.locator('[data-depth]').textContent(),
        ok: await page.locator('[data-ok]').textContent(), err: await page.locator('[data-err]').textContent(),
        nested: await page.locator('[data-nested]').textContent(), optional: await page.locator('[data-optional]').textContent(),
        cycle: await page.locator('[data-cycle]').textContent(), cycleFields: await page.locator('[data-cycle] .typed-read-field').count() };
      await page.screenshot({ path: ${JSON.stringify(capture)} + '/' + name + '.png', fullPage: true, animations: 'disabled' });
      results.push(state); await page.close();
    }
    await writeFile(${JSON.stringify(join(capture, "checks.json"))}, JSON.stringify(results, null, 2));
    for (const state of results) {
      assert.deepEqual(state.errors, []); assert.equal(state.depthBefore, '5'); assert.equal(state.depthAfter, '6');
      assert.match(state.ok, /Ok/); assert.match(state.err, /Err/); assert.match(state.nested, /Pending/);
      assert.match(state.optional, /Not set/); assert.match(state.optional, /kept/);
      assert.match(state.cycle, /…/); assert.equal(state.cycleFields, 6);
    }
    console.log('Structural reader: 2 viewports preserve constructor names, captured depth and bounded recursion');
    } finally { await browser.close(); }`);
  const child = Bun.spawn(["node", runner], { stdout: "pipe", stderr: "pipe", env: { ...process.env, TEMP: capture, TMP: capture } });
  const [exitCode, stdout, stderr] = await Promise.all([child.exited, new Response(child.stdout).text(), new Response(child.stderr).text()]);
  if (exitCode !== 0) throw new Error(`${stdout}\n${stderr}`);
  expect(stdout).toContain("2 viewports preserve constructor names"); console.log(stdout);
}, 60000);
