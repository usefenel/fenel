import { expect, test } from "bun:test";
import { mkdir, mkdtemp, readFile, realpath, rm } from "node:fs/promises";
import { dirname, join, resolve, sep } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

// Component fixture; supplied data; source transport/menu only. Actual related
// panels, registered bodies, occurrence boundary and menu run in a browser.
// The typed-render adapter replaces registry/semantic preparation, records
// occurrence props, and invokes the real registered component bodies. It must
// never discover suggestions, evaluate expressions, or turn graph IDs into refs.
test("related data panels retain query barriers and exact child occurrence paths", async () => {
  const repository = fileURLToPath(new URL("../../../../../", import.meta.url));
  const sourceRoot = join(repository, "distros/narthex/solid/src").replaceAll("\\", "/");
  const scratch = join(repository, ".tmp-tsc");
  await mkdir(scratch, { recursive: true });
  const directory = await mkdtemp(join(scratch, "related-data-occurrences-"));
  try {
    const compilerPath = Bun.resolveSync("@solidjs/compiler", dirname(fileURLToPath(import.meta.resolve("@solidjs/vite-plugin"))));
    const compiler = await import(pathToFileURL(compilerPath).href);
    const clientModules = {};
    for (const name of ["solid-js", "@solidjs/web"]) {
      const target = await realpath(resolve(sourceRoot, "../node_modules", name, "dist", name === "solid-js" ? "solid.dev.js" : "web.dev.js"));
      if (!target.startsWith(resolve(repository) + sep)) throw new Error("Client runtime escaped repository");
      clientModules[name] = target.replaceAll("\\", "/");
    }
    const signals = await realpath(resolve(dirname(dirname(clientModules["solid-js"])), "../@solidjs/signals/dist/dev.js"));
    if (!signals.startsWith(resolve(repository) + sep)) throw new Error("Client signals escaped repository");
    clientModules["@solidjs/signals"] = signals.replaceAll("\\", "/");
    const css = (await Promise.all(["global.css", "routes/app.css", "lib/home-entry.css", "lib/data-inspection-dialog.css", "lib/locus-context-menu.css"].map(path => readFile(join(sourceRoot, path), "utf8")))).join("\n");
    const occurrencePath = join(sourceRoot, "lib/data-occurrence.tsx");
    const prefix = `import { createSignal, For, Show } from "solid-js";
      import { Dynamic } from "@solidjs/web";
      const unreachable = () => { throw new Error("Registry/evaluation/discovery is unreachable in this transport fixture"); };
    `;
    const engine = `export const Just = value => ({ $tag: "Just", _0: value });
      export const Nothing = { $tag: "Nothing" };
      export const List = elem => ({ $ref: "List", args: [elem] });
      export const peelMaybeValue = value => value?.$tag === "Just" ? value._0 : undefined;
      export const exprNodeToLogic = unreachable;
      export const projectAuthoringScheme = unreachable;
      export const encodeCheckpointValue = value => value;
      export const typePhrase = type => type?.$ref === "String" ? "String result type" : "";
    `;
    const registry = `const components = new Map();
      export const webRegistry = { registerComponent: (name, body) => components.set(name, body),
        getComponent: name => components.get(name) };
    `;
    const typedAdapter = `import { DataOccurrenceBoundary } from ${JSON.stringify(occurrencePath)};
      import { webRegistry } from "fixture:registry";
      function Body(props) {
        const custom = () => props.value?.$tag === "SuggestionPresentation" ? webRegistry.getComponent("suggestion-card")
          : props.value?.$tag === "DependencyGraph" ? webRegistry.getComponent("dependency-graph") : undefined;
        return <Show when={custom()} fallback={<span data-type-leaf>{props.type?.$type ? "String result type" : String(props.value ?? "")}</span>}>
          {component => <Dynamic component={component()} value={props.value} occurrence={props.occurrence}
            dataPath={props.dataPath} onDataContext={props.onDataContext} />}
        </Show>;
      }
      export function TypedReadValue(props) {
        return <DataOccurrenceBoundary value={props.value} type={props.type} occurrence={props.occurrence}
          dataPath={props.dataPath} onDataContext={props.onDataContext}>
          <span data-root-kind={Array.isArray(props.value) ? "list" : props.value?.$tag ?? "leaf"}
            data-source-state={props.occurrence?.state ?? "missing"} data-path={JSON.stringify(props.dataPath ?? [])}
            data-source-current={globalThis.fixtureSourceMatches?.(props.value, props.occurrence) ? "current" : "wrong"}>
            <Show when={Array.isArray(props.value)} fallback={<Body value={props.value} type={props.type}
              occurrence={props.occurrence} dataPath={props.dataPath} onDataContext={props.onDataContext} />}>
              <For each={props.value}>{(value, index) => {
                const child = () => ({ value, path: [...props.dataPath ?? [], index()], label: "Item", typeLabel: "Suggestion",
                  getType: () => props.type?.args?.[0] });
                const render = () => <TypedReadValue value={value} type={props.type?.args?.[0]} occurrence={props.occurrence}
                  dataPath={child().path} onDataContext={props.onDataContext} />;
                return <div class="fixture-row">{props.renderChild ? props.renderChild(child(), render) : render()}</div>;
              }}</For>
            </Show>
          </span>
        </DataOccurrenceBoundary>;
      }
    `;
    const stubFor = path => {
      if (path.startsWith("@fenel/")) return engine;
      if (path === "fixture:registry" || /web-template-registry$/.test(path)) return registry;
      if (/TypedReadValue$/.test(path)) return typedAdapter;
      if (/account-authoring-session$/.test(path)) return "export const concreteAuthoringSession = session => session;";
      if (/expression-evaluation$/.test(path)) return "export const evaluateAuthoringExpressionInSession = unreachable;";
      if (/reader-source-metadata$/.test(path)) return "export const assertReaderSourceMetadata = unreachable;";
      if (/DataInspectionDialog$/.test(path)) return `export function createDataInspectionSuggestions(capture) {
        const [issue, setIssue] = createSignal();
        return { pending: () => false, issue, read: () => undefined,
          items: () => issue() ? [{ id: "unavailable", label: issue(), disabled: true }] : [],
          open() { try { const selected = capture(); globalThis.fixtureCapture?.(selected); setIssue("Fixture captured current source."); }
            catch (error) { setIssue(error.message); } }, close() {}, invalidate() {}, hold() {}, warm() {}, select: unreachable };
      }`;
      if (/lens-shortcuts$/.test(path)) return `export const lensPolicyData = (session, method, ...args) => {
        if (method === "suggestionPanelRows") return args[0].suggestions.map(row => ({ $tag: "SuggestionPresentation",
          identity: row.candidate.identity, label: row.candidate.label, resultType: row.resultType,
          remainingArguments: 0, detail: "Opens an expression from this checked suggestion.", reasons: [], confirmed: true }));
        if (method === "dependencyGraph") return { $tag: "DependencyGraph", scope: args[0], focus: args[1].id,
          nodes: [args[1], ...args[2], ...args[3]], edges: args[2].map(node => ({ $tag: "DependencyEdge", from: node.id, to: args[1].id })) };
        return unreachable();
      };`;
      if (/data-suggestions$/.test(path)) return "export const policyCandidate = candidate => ({ identity: candidate.identity, label: candidate.label });";
      if (/value-hover-preview$/.test(path)) return "export const ValueHoverPreview = props => props.children;";
      if (/value-card$/.test(path)) return `export const ValueCard = props => <article class="home-item"><header>{props.heading}</header>{props.children}</article>;
        export const ValueCardCaption = props => <strong>{props.caption}</strong>;
        export const ValueTypeCaption = props => <span>{props.label}</span>;
        export const valueCardLabel = value => typeof value === "string" ? value : undefined, valueCardTypeLabel = label => label;`;
      if (/field-renderer\/FieldRenderer$/.test(path)) return "export const FieldRenderer = unreachable, FieldLabel = unreachable, PlainFieldsContext = unreachable, displayTypeLabel = () => \"\";";
      if (/inline-widgets$/.test(path)) return "export const inlineWidgetFor = () => undefined;";
      if (/locus-notifications$/.test(path)) return "export const LocusLoadFailure = props => <p>{props.message} {props.detail}</p>;";
      if (/confirm-modal$/.test(path)) return "export const openModalDialog = unreachable, closeModalDialog = unreachable;";
      if (/locus-menu-actions$/.test(path)) return `export const ownsLocusContextMenu = event => !event.defaultPrevented;
        export const locusContextPosition = event => ({ x: event.clientX || 16, y: event.clientY || 16 });`;
      if (/locus-menu-gesture$/.test(path)) return "export const noteLocusMenuDismissal = () => {};";
      if (/icons$/.test(path)) return `export const IconAsterisk = props => <span aria-hidden="true">◇</span>;
        export const IconByName = props => <span aria-hidden="true" data-icon={props.name} />;
        export const LUCIDE_BY_NAME = {};`;
      return undefined;
    };
    const entry = `import { render, Dynamic } from "@solidjs/web";
      import { createSignal } from "solid-js";
      import { SuggestionReadPanel } from ${JSON.stringify(join(sourceRoot, "lib/related-data-panels.tsx"))};
      import { DependencyGraphPanel, createDependencyGraphData } from ${JSON.stringify(join(sourceRoot, "lib/dependency-graph-dialog.tsx"))};
      import { DataOccurrenceBoundary } from ${JSON.stringify(occurrencePath)};
      import { webRegistry } from "fixture:registry";
      const events = [], captures = [], actions = [];
      let forbiddenCalls = 0;
      const unrelated = { state: "source", capture() { forbiddenCalls++; throw new Error("Unrelated parent source was used"); } };
      const context = (event, selected) => { event.preventDefault(); event.stopPropagation(); events.push({ value: selected.value,
        path: selected.path, type: selected.getType() }); };
      const declaration = { id: "fixture-SuggestionPresentation" };
      const sessionA = { registry: { getIdentifiedEntity: () => declaration }, id: "reader-A" };
      const sessionB = { registry: { getIdentifiedEntity: () => declaration }, id: "reader-B" };
      const candidate = { identity: "reverse-candidate", label: "Reverse text", resultScheme: { body: { $ref: "String" } },
        expression: { kind: "literal", value: "CANDIDATE RESULT IS NOT THE PANEL SOURCE" } };
      const batch = { suggestions: [candidate], undecided: [], coverage: { operationsChecked: 1, operationsAvailable: 1 } };
      const unavailable = { state: "unavailable", issue: "No reusable source for this Suggestions list." };
      const [read, setRead] = createSignal({ session: sessionA, batch, source: unavailable });
      const owner = { read, pending: () => false, issue: () => undefined, open() {}, select: selected => actions.push(selected.identity) };
      const input = { scope: "Current visible data", subject: { id: "not-a-reference-focus", label: "Selected data" },
        uses: [{ id: "not-a-reference-upstream", label: "Input data" }], usedBy: [] };
      const [graph, setGraph] = createSignal(createDependencyGraphData(sessionA, input));
      const direct = { $tag: "SuggestionPresentation", identity: "direct", label: "Direct row", resultType: { $tag: "Just", _0: { $ref: "String" } },
        detail: "Path forwarding control", reasons: [], confirmed: true };
      const source = { state: "source", capture: () => { throw new Error("Compatibility callback owns this event"); } };
      const [directSource, setDirectSource] = createSignal(source);
      const directGraph = () => graph().value;
      const directProps = { get value() { return direct; }, get occurrence() { return directSource(); }, dataPath: [4], onDataContext: context };
      const directGraphProps = { get value() { return directGraph(); }, get occurrence() { return directSource(); }, dataPath: ["nested"], onDataContext: context };
      globalThis.fixtureCapture = selected => captures.push(selected.input);
      globalThis.fixtureSourceMatches = (value, source) => Array.isArray(value) ? source === read().source
        : value?.$tag === "DependencyGraph" ? source === graph().source : true;
      render(() => <main><style>{${JSON.stringify(css + `
        body { margin: 0; background: #f3f5f7; } main { max-width: 900px; margin: auto; padding: 18px; }
        h1 { font-size: 18px; margin: 0 0 8px; } h2 { font-size: 15px; margin: 16px 0 8px; }
        .fixture-label { font-size: 11px; color: #64748b; margin-bottom: 12px; }
        .fixture-case { background: white; padding: 14px; border: 1px solid #d8dee8; border-radius: 8px; }
        .fixture-row .home-item { position: relative; left: auto; top: auto; width: auto; height: auto; min-height: 115px; padding: 12px; }
        .fixture-controls { margin-top: 20px; } .fixture-row [data-type-leaf] { display: inline-block; padding: 8px 0; }
      `)}}</style>
        <h1>Related data source menus</h1><p class="fixture-label">Component fixture · supplied data · source transport/menu only</p>
        <DataOccurrenceBoundary value="Unrelated enclosing data" occurrence={unrelated} dataPath={["unrelated-parent"]} onDataContext={context}>
          <section data-case="suggestions" class="fixture-case"><h2>Suggestions</h2><SuggestionReadPanel owner={owner} /></section>
          <section data-case="graph" class="fixture-case"><h2>Dependencies</h2><DependencyGraphPanel projection={graph()} /></section>
        </DataOccurrenceBoundary>
        <section class="fixture-controls" data-case="direct-suggestion"><h2>Nested result type path control</h2>
          <Dynamic component={webRegistry.getComponent("suggestion-card")} {...directProps} /></section>
        <section class="fixture-controls" data-case="direct-graph"><h2>Nested node path control</h2>
          <Dynamic component={webRegistry.getComponent("dependency-graph")} {...directGraphProps} /></section>
        <section class="fixture-controls" data-case="centred-graph"><h2>Holding card's graph, centred on a nested value</h2>
          <DependencyGraphPanel projection={graph()} centre={["not-a-node", "not-a-reference-upstream"]} containedIn="Holder card" /></section>
      </main>, document.getElementById("fixture"));
      globalThis.relatedFixture = { events, captures, actions, candidate, forbiddenCalls: () => forbiddenCalls,
        replaceQuery() { setRead(previous => ({ ...previous, batch: { ...batch, suggestions: [{ ...candidate, label: "New query text" }] } })); },
        replaceReader() { setRead(previous => ({ ...previous, session: previous.session === sessionA ? sessionB : sessionA })); },
        replaceSource() { setRead(previous => ({ ...previous, source: { ...unavailable } })); },
        replaceGraphQuery() { setGraph(createDependencyGraphData(sessionB, { ...input, scope: "Replacement graph query" })); },
        replaceGraphSource() { setGraph(previous => ({ ...previous, source: { ...previous.source } })); },
        supplyTestQuery(kind) {
          const source = { state: "source", capture: () => ({ session: sessionA, current: () => true, select() {},
            input: { expression: { kind: "call", fnId: "supplied-test-query-" + kind, args: [] },
              sourcePath: ["query-result"], revision: "supplied-test-query", sourceType: { $ref: "SuppliedQueryResult" } } }) };
          if (kind === "suggestions") setRead(previous => ({ ...previous, source }));
          else setGraph(previous => ({ ...previous, source }));
        },
        reset() { setRead({ session: sessionA, batch, source: unavailable }); setGraph(createDependencyGraphData(sessionA, input)); },
        rootSnapshot() { return { readSource: read().source, graphSource: graph().source }; },
      };
    `;
    const beforeDirectory = process.env.FENEL_RELATED_OCCURRENCE_BEFORE_DIR;
    const browser = await Bun.build({ entrypoints: ["related-fixture:entry"], target: "browser", conditions: ["browser", "development"],
      plugins: [{ name: "related-query-transport", setup(build) {
        build.onResolve({ filter: /^related-fixture:/ }, args => ({ path: args.path, namespace: "related-fixture" }));
        build.onResolve({ filter: /.*/ }, args => {
          if (clientModules[args.path]) return { path: clientModules[args.path] };
          if (stubFor(args.path) !== undefined) return { path: /web-template-registry$/.test(args.path) ? "fixture:registry" : args.path, namespace: "related-fixture" };
        });
        build.onLoad({ filter: /.*/, namespace: "related-fixture" }, async args => ({ loader: "ts", resolveDir: sourceRoot,
          contents: (await compiler.transformAsync(args.path === "related-fixture:entry" ? entry : prefix + stubFor(args.path), {
            filename: join(sourceRoot, "related-data-fixture.tsx"), generate: "dom", hydratable: false, dev: true,
          })).code }));
        build.onLoad({ filter: /\.tsx$/ }, async args => {
          const beforeName = args.path.endsWith("related-data-panels.tsx") ? "related-data-panels.before.tsx"
            : args.path.endsWith("dependency-graph-dialog.tsx") ? "dependency-graph-dialog.before.tsx" : undefined;
          const contents = await readFile(beforeDirectory && beforeName ? join(beforeDirectory, beforeName) : args.path, "utf8");
          return { loader: "ts", contents: (await compiler.transformAsync(contents, {
            filename: args.path, generate: "dom", hydratable: false, dev: true,
          })).code };
        });
        build.onLoad({ filter: /\.css$/ }, () => ({ loader: "js", contents: "" }));
      } }] });
    if (!browser.success) throw new AggregateError(browser.logs, "Related data transport fixture failed to compile");
    const browserPath = join(directory, "browser.js");
    await Bun.write(browserPath, browser.outputs[0]);
    const playwrightModule = process.env.FENEL_TEST_PLAYWRIGHT_MODULE ?? import.meta.resolve("playwright");
    const runnerPath = join(directory, "runner.mjs");
    await Bun.write(runnerPath, `import { readFile, mkdir } from "node:fs/promises"; import assert from "node:assert/strict";
      import { join } from "node:path"; import { pathToFileURL } from "node:url";
      const loaded = await import(${JSON.stringify(playwrightModule.startsWith("file:") ? playwrightModule : pathToFileURL(resolve(playwrightModule)).href)});
      const { chromium } = loaded.chromium ? loaded : loaded.default;
      const browser = await chromium.launch({ headless: true, timeout: 20000, channel: process.env.FENEL_TEST_BROWSER_CHANNEL });
      try { const page = await browser.newPage({ viewport: { width: 1280, height: 900 }, reducedMotion: "reduce" });
        const errors = [], diagnostics = []; page.on("pageerror", error => errors.push(error.message));
        page.on("console", message => { if (message.type() === "error" || /STRICT_|untracked|owned scope/i.test(message.text())) diagnostics.push(message.text()); });
        page.setDefaultTimeout(10000);
        await page.setContent('<html><body><div id="fixture"></div></body></html>');
        await page.addScriptTag({ content: await readFile(process.argv[2], "utf8"), type: "module" });
        const close = async () => { await page.keyboard.press("Escape"); await page.locator('[role="menu"]').first().waitFor({ state: "hidden" }); };
        async function open(panel, target, issue) {
          // A Suggestions row also keeps its registered body's (hidden) copy of the result type.
          await page.locator('[data-case="' + panel + '"]').getByText(target, { exact: true }).filter({ visible: true }).first().click({ button: "right" });
          await page.getByRole("menuitem", { name: "Suggestions", exact: true }).focus();
          await page.keyboard.press("ArrowRight");
          await page.getByText(issue, { exact: true }).waitFor();
        }
        const missing = process.env.FENEL_RELATED_OCCURRENCE_BEFORE_DIR ? "Suggestions need this data's source expression." : undefined;
        const suggestionsIssue = missing ?? "No reusable source for this Suggestions list.";
        const graphIssue = missing ?? "No reusable source for this dependency graph.";
        await open("suggestions", "String result type", suggestionsIssue); await close();
        await open("graph", "Input data", graphIssue); await close();
        if (!missing) {
          const roots = await page.evaluate(() => relatedFixture.rootSnapshot());
          assert.equal(roots.readSource.state, "unavailable"); assert.equal(roots.graphSource.state, "unavailable");
          assert.equal(await page.locator('[data-case="suggestions"] [data-root-kind="list"]').getAttribute("data-path"), "[]");
          assert.equal(await page.locator('[data-case="graph"] [data-root-kind="DependencyGraph"]').getAttribute("data-path"), "[]");
          assert.equal(await page.locator('[data-case="suggestions"] [data-root-kind="list"]').getAttribute("data-source-current"), "current");
          assert.equal(await page.locator('[data-case="graph"] [data-root-kind="DependencyGraph"]').getAttribute("data-source-current"), "current");
          // A value nested in a card draws the card's graph centred on the first of its identities that is a node.
          assert.equal(await page.locator('[data-case="graph"] .dependency-graph-node--focus').innerText(), "Selected data");
          assert.equal(await page.locator('[data-case="centred-graph"] .dependency-graph-node--focus').innerText(), "Input data");
          assert.equal(await page.locator('[data-case="centred-graph"] [data-dependency-contained]').innerText(), "Part of Holder card");
          await page.locator('[data-case="direct-suggestion"]').getByText("String result type", { exact: true }).click({ button: "right" });
          await page.locator('[data-case="direct-graph"]').getByText("Input data", { exact: true }).click({ button: "right" });
          await page.locator('[data-case="direct-graph"] [data-dependency-node="not-a-reference-upstream"]').getByText("Input data", { exact: true }).click({ button: "right" });
          const events = await page.evaluate(() => relatedFixture.events);
          assert.deepEqual(events, [{ value: { $ref: "String" }, path: [4, "resultType", "_0"], type: { $type: true } },
            { value: { $tag: "DependencyNode", id: "not-a-reference-upstream", label: "Input data" }, path: ["nested", "nodes", 1], type: undefined },
            { value: { $tag: "DependencyNode", id: "not-a-reference-upstream", label: "Input data" }, path: ["nested", "nodes", 1], type: undefined }]);
          // Replacing any supplied query/reader/source snapshot must close its open data menu.
          for (const change of ["replaceSource", "replaceReader", "replaceQuery"]) {
            await open("suggestions", "String result type", suggestionsIssue);
            await page.evaluate(change => relatedFixture[change](), change);
            await page.locator('[role="menu"]').first().waitFor({ state: "hidden" });
          }
          for (const change of ["replaceGraphSource", "replaceGraphQuery"]) {
            await open("graph", "Input data", graphIssue);
            await page.evaluate(change => relatedFixture[change](), change);
            await page.locator('[role="menu"]').first().waitFor({ state: "hidden" });
          }
          await page.locator('[data-case="suggestions"]').getByRole("button", { name: "Open expression" }).click();
          assert.deepEqual(await page.evaluate(() => relatedFixture.actions), ["reverse-candidate"]);
          assert.equal(await page.evaluate(() => relatedFixture.forbiddenCalls()), 0);
          assert.deepEqual(await page.evaluate(() => relatedFixture.captures), []);
          // Supplied test producers prove transport only; they are never run.
          await page.evaluate(() => relatedFixture.supplyTestQuery("suggestions"));
          await page.locator('[data-case="suggestions"] .suggestion-row').click({ button: "right" });
          await page.getByRole("menuitem", { name: "Suggestions", exact: true }).hover();
          await page.getByText("Fixture captured current source.", { exact: true }).waitFor(); await close();
          await open("suggestions", "String result type", "Fixture captured current source."); await close();
          await page.evaluate(() => relatedFixture.supplyTestQuery("graph"));
          await page.locator('[data-case="graph"] [data-dependency-node="not-a-reference-upstream"]').getByText("Input data", { exact: true }).click({ button: "right" });
          await page.getByRole("menuitem", { name: "Suggestions", exact: true }).hover();
          await page.getByText("Fixture captured current source.", { exact: true }).waitFor(); await close();
          const captures = await page.evaluate(() => relatedFixture.captures);
          assert.deepEqual(captures.map(input => ({ expression: input.expression, sourcePath: input.sourcePath, sourceType: input.sourceType })), [
            { expression: { kind: "call", fnId: "supplied-test-query-suggestions", args: [] }, sourcePath: ["query-result", 0], sourceType: { $ref: "SuppliedQueryResult" } },
            { expression: { kind: "call", fnId: "supplied-test-query-suggestions", args: [] }, sourcePath: ["query-result", 0, "resultType", "_0"], sourceType: { $ref: "SuppliedQueryResult" } },
            { expression: { kind: "call", fnId: "supplied-test-query-graph", args: [] }, sourcePath: ["query-result", "nodes", 1], sourceType: { $ref: "SuppliedQueryResult" } },
          ]);
          await page.evaluate(() => relatedFixture.reset());
        }
        if (process.env.FENEL_RELATED_OCCURRENCE_SCREENSHOTS) {
          const target = process.env.FENEL_RELATED_OCCURRENCE_SCREENSHOTS; await mkdir(target, { recursive: true });
          const version = missing ? "before" : "after";
          await page.addStyleTag({ content: ".fixture-controls { display:none; }" });
          for (const viewport of [{ name: "desktop", width: 1280, height: 900 }, { name: "phone", width: 390, height: 844 }]) {
            await page.setViewportSize({ width: viewport.width, height: viewport.height });
            for (const [panel, text, issue] of [["suggestions", "String result type", suggestionsIssue], ["graph", "Input data", graphIssue]]) {
              await open(panel, text, issue);
              assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth), false, "Fixture must fit viewport");
              await page.screenshot({ path: join(target, version + "-" + panel + "-" + viewport.name + ".png") }); await close();
            }
          }
        }
        assert.deepEqual(errors, []); assert.deepEqual(diagnostics, []);
        console.log(missing ? "Related panel transport: before snapshot generic source menus captured"
          : "Related panel transport: explicit query barriers, 3 exact child events, 3 retained-query captures, 5 replacement closures and existing candidate action passed");
      } finally { await browser.close(); }
    `);
    if (process.env.FENEL_RELATED_OCCURRENCE_EXPORT) {
      console.log(`Related panel fixture exported: ${directory}`); return;
    }
    const child = Bun.spawn(["node", runnerPath, browserPath], { stdout: "pipe", stderr: "pipe",
      env: { ...process.env, TEMP: directory, TMP: directory } });
    const [exitCode, stdout, stderr] = await Promise.all([child.exited, new Response(child.stdout).text(), new Response(child.stderr).text()]);
    if (exitCode !== 0) throw new Error(`${stdout}\n${stderr}`);
    expect(stdout).toContain("Related panel transport:");
    console.log(stdout);
  } finally {
    const target = resolve(directory);
    if (!target.startsWith(resolve(scratch) + sep)) throw new Error("Related panel fixture cleanup escaped repository scratch");
    if (!process.env.FENEL_RELATED_OCCURRENCE_EXPORT) await rm(target, { recursive: true, force: true });
  }
}, 60000);
