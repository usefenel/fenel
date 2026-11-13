import { expect, test } from "bun:test";
import { mkdir, mkdtemp, readFile, realpath, rm } from "node:fs/promises";
import { basename, dirname, join, resolve, sep } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

// C1 browser transport test: actual layout/custom/read boundaries consume
// captured semantic plans. No registry, parser or evaluator is initialized.
test("layout and custom read components retain the selected source occurrence", async () => {
  const repository = fileURLToPath(new URL("../../../../../../", import.meta.url));
  const sourceRoot = join(repository, "distros/narthex/solid/src").replaceAll("\\", "/");
  const scratch = join(repository, ".tmp-tsc");
  await mkdir(scratch, { recursive: true });
  const directory = await mkdtemp(join(scratch, "layout-data-context-"));
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
    const css = (await Promise.all(["global.css", "routes/app.css", "lib/home-entry.css", "lib/admin-form/admin-form.css", "lib/locus-context-menu.css", "lib/documents/rich-document.css"].map(path => readFile(join(sourceRoot, path), "utf8")))).join("\n");
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
      export const peelMaybeValue = value => value?.$tag === "Just" ? value._0 : undefined;
      export const refHandle = type => type?.$ref;
      export const surfaceReadValuePlan = value => ({ value, raw: value, kind: "text", text: String(value) });
      export const fieldType = field => field.type, fieldMeta = field => field.meta;
      export const canonical = value => value;
      export const createSurfaceEnvironment = () => ({});
      export const surfaceLayoutRenderPlan = args => ({ context: {}, sections: [{ rows: [{ slots: args.layout.fields.map(name => {
        const field = args.fields.find(field => field.name === name);
        const formatted = name === "formatted";
        return { fieldName: name, label: name, span: 12, field, value: args.values[name],
          componentName: name === "nested" ? "nested-child" : name === "unavailable" ? "new-root" : name === "omitted" ? "omitted-root" : undefined,
          template: formatted ? { display: { $tag: "Just", _0: { read: { $tag: "Just", _0: {} } } } } : undefined,
          display: formatted ? { kind: "text", text: args.values[name] } : undefined };
      }) }] }] });
      export const fieldNumericTextCodecPlan = () => undefined;
      export const encodeCheckpointValue = value => value;
      export const evaluate = () => [{ $tag: "DocReadEmbed", value: "Embedded child", type: { $ref: "String" }, caption: [] }];
      export const printFenel = value => JSON.stringify(value);
    `;
    const stubFor = path => {
      if (path.startsWith("@fenel/") || /implementations[\\/]typescript[\\/]engine[\\/]src[\\/]/.test(path)) return engine;
      if (/authoring-session$/.test(path)) return "export const useAuthoringSession = () => session;";
      if (/expression-surfaces$/.test(path)) return "export const ExpressionGraphCollectionItemControl = () => null;";
      if (/reader-runtime$/.test(path)) return "export const useReaderRuntime = () => undefined;";
      if (/reader-presentation$/.test(path)) return "export const readerResultTypeLabel = () => undefined;";
      if (/(?:data-transfer[\\/])?DataPreview$/.test(path)) return `export const DataPreview = scalar, DelimitedText = scalar;
        export const DataThumbnail = () => <span data-thumbnail>●</span>;
        export const hasDataPreview = () => false;`;
      if (/VariantValueRenderer$/.test(path)) return "export const VariantValueRenderer = scalar;";
      if (/web-template-registry$/.test(path)) return "export const webRegistry = { registerComponent() {}, resolve() {}, getComponent() {} };";
      if (/field-renderer$/.test(path)) return "export const FieldRenderer = missing;";
      if (/DataInspectionDialog$/.test(path)) return `import { createSignal } from "solid-js";
        export function createDataInspectionSuggestions(capture) {
          const [issue, setIssue] = createSignal();
          return { pending: () => false, issue, read: () => undefined,
            items: () => issue() ? [{ id: "unavailable", label: issue(), disabled: true }] : [],
            open() { try { capture(); } catch (error) { setIssue(error.message); } },
            close() {}, invalidate() {}, hold() {}, warm() {}, select: missing };
        }`;
      if (/DataTransferTarget$/.test(path)) return "export const DataTransferTarget = props => <div data-transfer-read>{props.children}</div>;";
      if (/session-analysis$/.test(path)) return "export const adaptTransferForSession = missing;";
      if (/data-transfer[\\/]index$/.test(path) || path === "./index") return "export const classifyData = () => 'Data', ingestTransfer = missing;";
      if (/expressions$/.test(path)) return `export const transferContainerShape = type => type;
        export const expressionForTransfer = missing, typeForTransfer = missing, prepareTransferItem = missing;`;
      if (/charts$/.test(path)) return "export const LineChart = () => null;";
      if (/storybook$/.test(path)) return "export const AnimationFrameStripView = () => null;";
      if (/MarkupRead$/.test(path)) return "export const MarkupRead = () => <span>Document caption</span>;";
      if (/type-data-preview$/.test(path)) return "export const TypeDataPreviewBody = () => null;";
      return undefined;
    };
    const entry = `import { render } from "@solidjs/web";
      import { createSignal } from "solid-js";
      import { TypedReadValue } from ${JSON.stringify(join(sourceRoot, "lib/layout-renderer/TypedReadValue.tsx"))};
      import { LayoutRenderer, ReadValue } from ${JSON.stringify(join(sourceRoot, "lib/layout-renderer/LayoutRenderer.tsx"))};
      import { RichDocumentRead } from ${JSON.stringify(join(sourceRoot, "lib/documents/RichDocumentRead.tsx"))};
      import { DataOccurrenceBoundary } from ${JSON.stringify(join(sourceRoot, "lib/data-occurrence.tsx"))};
      const stringType = { $ref: "String" };
      const field = (name, type = stringType) => ({ name, type, label: { $tag: "Nothing" }, meta: {}, ui: { $tag: "Nothing" } });
      const events = [];
      function context(event, data) { event.preventDefault(); event.stopPropagation();
        events.push({ value: data.value, path: data.path, type: data.getType() }); }
      const [values, setValues] = createSignal({ plain: "Plain child", formatted: "Formatted child", nested: { title: "Custom child" }, unavailable: "Derived child", omitted: "Unsourced child" });
      const [path, setPath] = createSignal(["root"]);
      const firstSource = { state: "source", capture: () => { throw new Error("Compatibility events must use the existing menu owner"); } };
      const secondSource = { ...firstSource };
      const [source, setSource] = createSignal(firstSource);
      const registry = { resolve() {}, getComponent(name) {
        if (name === "direct") return props => <span data-direct-source={props.occurrence === source() ? "current" : "stale"}>{props.value}</span>;
        if (name === "nested-child") return props => <TypedReadValue value={props.value.title} type={stringType}
          occurrence={props.occurrence} dataPath={[...(props.dataPath ?? []), "title"]} onDataContext={props.onDataContext} />;
        if (name === "new-root") return props => <TypedReadValue value={props.value} type={stringType}
          occurrence={{ state: "unavailable", issue: "This derived child has no source." }} onDataContext={props.onDataContext} />;
        if (name === "omitted-root") return props => <TypedReadValue value={props.value} type={stringType} onDataContext={props.onDataContext} />;
      } };
      const fields = [field("plain"), field("formatted"), field("nested", { $record: { fields: [field("title")] } }), field("unavailable"), field("omitted")];
      render(() => <div style="max-width: 700px; padding: 24px"><style>{${JSON.stringify(css)}}</style>
        <h2>Data in layouts and custom presentations</h2>
        <div data-case="direct"><ReadValue value="Direct custom value" template={{ readComponent: "direct", display: { $tag: "Nothing" } }}
          field={field("direct")} registry={registry} occurrence={source()} dataPath={path()} onDataContext={context} /></div>
        <div data-case="layout"><LayoutRenderer layout={{ fields: ["plain", "formatted", "nested", "unavailable", "omitted"] }} fields={fields}
          values={values()} registry={registry} mode="read" onChange={() => {}} occurrence={source()} dataPath={path()} onDataContext={context} /></div>
        <div data-case="document"><DataOccurrenceBoundary value={{ blocks: [] }} occurrence={source()} dataPath={["document"]} onDataContext={context}>
          <RichDocumentRead value={{ blocks: [] }} /></DataOccurrenceBoundary></div>
      </div>, document.getElementById("fixture"));
      globalThis.layoutDataContext = { events: () => events, stringType,
        replace() { setPath(["replacement"]); setValues({ plain: "New plain child", formatted: "New formatted child", nested: { title: "New custom child" }, unavailable: "Derived child", omitted: "Unsourced child" }); setSource(secondSource); } };
    `;
    const browser = await Bun.build({ entrypoints: ["typed-context:entry"], target: "browser", conditions: ["browser", "development"],
      plugins: [{ name: "captured-read-boundary", setup(build) {
        build.onResolve({ filter: /^typed-context:/ }, args => ({ path: args.path, namespace: "context-fixture" }));
        build.onResolve({ filter: /.*/ }, args => {
          if (clientModules[args.path]) return { path: clientModules[args.path] };
          const mocked = stubFor(args.path);
          if (mocked !== undefined) return { path: args.path, namespace: "context-fixture" };
          if (args.path.startsWith("~/")) return { path: Bun.resolveSync(join(sourceRoot, args.path.slice(2)), sourceRoot).replaceAll("\\", "/") };
        });
        build.onLoad({ filter: /.*/, namespace: "context-fixture" }, async args => ({ loader: "ts", resolveDir: sourceRoot,
          contents: (await compiler.transformAsync(args.path === "typed-context:entry" ? entry : prefix + stubFor(args.path), {
            filename: join(sourceRoot, "typed-context-fixture.tsx"), generate: "dom", hydratable: false, dev: true,
          })).code }));
        build.onLoad({ filter: /\.tsx$/ }, async args => ({ loader: "ts", contents: (await compiler.transformAsync(await readFile(
          process.env.FENEL_LAYOUT_CONTEXT_BEFORE && ["LayoutRenderer.tsx", "TypedReadValue.tsx", "RichDocumentRead.tsx"].includes(basename(args.path))
            ? join(resolve(process.env.FENEL_LAYOUT_CONTEXT_BEFORE), basename(args.path)) : args.path, "utf8"), {
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
      console.log('Launching layout-data browser');
      const browser = await chromium.launch({ headless: true, timeout: 20000, channel: process.env.FENEL_TEST_BROWSER_CHANNEL });
      console.log('Layout-data browser ready');
      try { const page = await browser.newPage({ reducedMotion: 'reduce' }); const errors = []; page.on('pageerror', error => errors.push(error.message));
        page.on('console', message => { if (message.type() === 'error') console.error(message.text()); });
        page.setDefaultTimeout(10000);
        await page.setContent('<html><body><div id="fixture"></div></body></html>');
        console.log('Loading actual layout/custom/read components');
        await page.addScriptTag({ content: await readFile(process.argv[2], 'utf8'), type: 'module' });
        assert.deepEqual(errors, []);
        if (process.env.FENEL_LAYOUT_CONTEXT_CAPTURE) {
          const before = !!process.env.FENEL_LAYOUT_CONTEXT_BEFORE;
          for (const [name, width, height] of [['desktop', 1120, 720], ['phone', 390, 844]]) {
            await page.setViewportSize({ width, height });
            for (const [subject, selector, issue] of [
              ['layout', 'text=Derived child', 'This derived child has no source.'],
              ['embed', '[aria-label="Embedded data source"]', 'This embedded data has no live source yet.']]) {
              const target = page.locator(selector); const box = await target.boundingBox();
              await target.dispatchEvent('contextmenu', { bubbles: true, cancelable: true, clientX: box.x + box.width / 2, clientY: box.y + box.height / 2 });
              if (!before) { await page.getByRole('menuitem', { name: 'Suggestions', exact: true }).press('ArrowRight');
                await page.getByText(issue, { exact: false }).waitFor(); }
              await page.screenshot({ path: process.env.FENEL_LAYOUT_CONTEXT_CAPTURE + '/' + (before ? 'before-' : 'after-') + subject + '-' + name + '.png' });
              await page.keyboard.press('Escape');
            }
          }
          assert.deepEqual(errors, []); console.log('Layout data source context: screenshots captured');
        } else {
        await page.getByText('Direct custom value', { exact: true }).dispatchEvent('contextmenu', { bubbles: true, cancelable: true, clientX: 50, clientY: 50 });
        await page.getByText('Plain child', { exact: true }).click({ button: 'right' });
        await page.getByText('Formatted child', { exact: true }).click({ button: 'right' });
        await page.getByText('Custom child', { exact: true }).click({ button: 'right' });
        assert.equal(await page.locator('[data-direct-source]').getAttribute('data-direct-source'), 'current');
        await page.evaluate(() => layoutDataContext.replace());
        await page.getByText('New plain child', { exact: true }).click({ button: 'right' });
        await page.getByText('New formatted child', { exact: true }).click({ button: 'right' });
        await page.getByText('New custom child', { exact: true }).click({ button: 'right' });
        assert.equal(await page.locator('[data-direct-source]').getAttribute('data-direct-source'), 'current');
        const state = await page.evaluate(() => ({ events: layoutDataContext.events(), type: layoutDataContext.stringType }));
        assert.deepEqual(state.events, [
          { value: 'Direct custom value', path: ['root'], type: state.type },
          { value: 'Plain child', path: ['root', 'plain'], type: state.type },
          { value: 'Formatted child', path: ['root', 'formatted'], type: state.type },
          { value: 'Custom child', path: ['root', 'nested', 'title'], type: state.type },
          { value: 'New plain child', path: ['replacement', 'plain'], type: state.type },
          { value: 'New formatted child', path: ['replacement', 'formatted'], type: state.type },
          { value: 'New custom child', path: ['replacement', 'nested', 'title'], type: state.type },
        ]);
        await page.getByText('Derived child', { exact: true }).click({ button: 'right' });
        await page.getByRole('menuitem', { name: 'Suggestions', exact: true }).hover();
        await page.getByText('This derived child has no source.', { exact: false }).waitFor();
        assert.equal(await page.evaluate(() => layoutDataContext.events().length), 7);
        await page.keyboard.press('Escape');
        await page.getByText('Embedded child', { exact: true }).click({ button: 'right' });
        await page.getByRole('menuitem', { name: 'Suggestions', exact: true }).hover();
        await page.getByText('This embedded data has no live source yet.', { exact: false }).waitFor();
        await page.keyboard.press('Escape');
        await page.locator('[aria-label="Embedded data source"]').click({ button: 'right' });
        await page.getByRole('menuitem', { name: 'Suggestions', exact: true }).hover();
        await page.getByText('This embedded data has no live source yet.', { exact: false }).waitFor();
        assert.equal(await page.evaluate(() => layoutDataContext.events().length), 7);
        await page.keyboard.press('Escape');
        await page.getByText('Unsourced child', { exact: true }).click({ button: 'right' });
        await page.getByRole('menuitem', { name: 'Suggestions', exact: true }).hover();
        await page.getByText("Suggestions need this data's source expression.", { exact: false }).waitFor();
        assert.equal(await page.evaluate(() => layoutDataContext.events().length), 7);
        assert.deepEqual(errors, []);
        console.log('Layout data source context: 7 nearest-child events and 4 explicit source barriers passed');
        }
      } finally { await browser.close(); }
    `);
    if (process.env.FENEL_LAYOUT_CONTEXT_EXPORT) {
      console.log(`Layout data context fixture exported: ${directory}`); return;
    }
    const child = Bun.spawn(["node", runnerPath, browserPath], { stdout: "pipe", stderr: "pipe",
      env: { ...process.env, TEMP: directory, TMP: directory } });
    const [exitCode, stdout, stderr] = await Promise.all([child.exited, new Response(child.stdout).text(), new Response(child.stderr).text()]);
    if (exitCode !== 0) throw new Error(`${stdout}\n${stderr}`);
    expect(stdout).toContain(process.env.FENEL_LAYOUT_CONTEXT_CAPTURE ? "screenshots captured" : "7 nearest-child events and 4 explicit source barriers passed");
    console.log(stdout);
  } finally {
    const target = resolve(directory);
    if (!target.startsWith(resolve(scratch) + sep)) throw new Error("Typed context fixture cleanup escaped repository scratch");
    if (!process.env.FENEL_LAYOUT_CONTEXT_EXPORT) await rm(target, { recursive: true, force: true });
  }
}, 60000);
