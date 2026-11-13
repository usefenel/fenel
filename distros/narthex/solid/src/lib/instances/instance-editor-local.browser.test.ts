import { expect, test } from "bun:test";
import { mkdir, mkdtemp, rm } from "node:fs/promises";
import { dirname, join, relative } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

// C1 mounted control: the complete production panel/editor and the actual
// LocaleStringEditor run in Solid's DOM runtime. Only worker replies and
// unrelated child controls are held. The real-registry parity suite owns
// class/type/codec semantics; this catches the missing Local control wiring.
test("Local representation naming mounts with empty page classes and current worker wire", async () => {
  const packageRoot = fileURLToPath(new URL("../../../", import.meta.url));
  const scratch = join(packageRoot, ".tmp-diag", "local-instance-editor-dom");
  await mkdir(scratch, { recursive: true });
  const directory = await mkdtemp(join(scratch, "run-"));
  const read = (path: string) => Bun.file(join(packageRoot, path)).text();
  const strip = (source: string) => source.replace(/^import[\s\S]*?;\r?\n/gm, "").replace(/^export /gm, "");
  const [panel, editor, locale, drafts, reads] = await Promise.all([
    read("src/lib/representations/RepresentationsPanel.tsx"), read("src/lib/instances/InstanceEditor.tsx"),
    read("src/lib/representations/LocaleStringEditor.tsx"), read("src/lib/instances/instance-draft.ts"),
    read("src/lib/expression-runner/local-editor-reads.ts"),
  ]);
  const section = (start: string, end: string) => {
    const from = reads.indexOf(start), to = reads.indexOf(end, from);
    // Baseline has no Local wire adapter: its own synchronous calls below
    // still fail the mounted behavior, rather than a missing-import fixture.
    return from < 0 ? "" : reads.slice(from, to < 0 ? undefined : to).replace(/^export /gm, "");
  };
  const local = (path: string) => JSON.stringify(relative(directory, join(packageRoot, path)).replaceAll("\\", "/"));
  const virtual = `
    import { createContext, createEffect, createMemo, createSignal, For, Show, useContext } from "solid-js";
    import { render } from "@solidjs/web";
    import { createAsyncValue } from ${local("src/lib/async-value.ts")};
    const errors = [], wireJobs = [], pageReads = []; let holdEncoding = false;
    const forbidden = name => { pageReads.push(name); throw new Error(name + " was read on the Local page"); };
    const dispatchRegistry = { listClasses: () => [], listInstances: () => [], getClass: () => undefined };
    const representationalClasses = () => classes.map(row => row.iface);
    const accountFieldRegistry = () => forbidden("account registry");
    const instanceMethodsValueType = () => forbidden("page methods type");
    const instanceToJsonWire = () => forbidden("page instance encoder");
    const instanceFromJsonWire = () => forbidden("page instance decoder");
    const INSTANCE_JSON_ENCODING = "fenel-instance-json-v2";
    const isInstanceJsonEncoding = value => value === "fenel-instance-json-v1" || value === INSTANCE_JSON_ENCODING;
    const draftValueFingerprint = JSON.stringify;
    const record = value => !!value && typeof value === "object" && !Array.isArray(value);
    const malformed = () => new Error("Malformed worker reply");
    const Nothing = { $tag: "Nothing" }, Just = value => ({ $tag: "Just", _0: value });
    const resolveLocale = value => typeof value === "string" ? value : value?.en ?? "";
    const formatRuntimeValue = value => String(value);
    const GLOBAL_ONLY = {}, instanceVisible = () => true, sessionEpoch = () => 1;
    const universeStructuralInstancesFor = () => forbidden("page structural dispatch");
    const LUCIDE_ICON_NAMES = [];
    const FieldRenderer = () => forbidden("unexpected scalar child");
    const TypePicker = () => null;
    const TypeArgumentEditor = props => <input aria-label="Type argument" value={props.value} onInput={event => props.onChange(event.currentTarget.value)} />;
    const LocusSelect = props => <select aria-label={props.label} value={props.value} onChange={event => props.onChange(event.currentTarget.value)}>
      <For each={props.options}>{row => <option value={row.value}>{row.label}</option>}</For></select>;
    const declarations = [["Codeable", "codeName"], ["Labelable", "label"], ["Describable", "description"]];
    const classes = declarations.map(([name, method]) => ({ parameterNames: ["a"], iface: { name, params: [{ name: "a" }],
      methods: [{ name: method, params: [], returns: { $ref: "LocaleString" } }] } }));
    const [metadata, setMetadata] = createSignal();
    const createLocalInstanceInterfaces = () => ({ answer: metadata, failure: () => undefined, retry: () => {} });
    const createLocalInstanceMethodsType = (_reader, _session, request) => ({ answer: () => ({ $tag: "Ok", _0: {
      $record: { fields: classes.find(row => row.iface.name === request().typeName).iface.methods.map(method => ({
        name: method.name, key: { $tag: "NamedField", ref: { $ref: "field:" + method.name } }, type: method.returns, label: Nothing, ui: Nothing, meta: {} })) }
    } }), failure: () => undefined });
    ${reads.includes("export type LocalInstanceWireRequest") ? section("function stable<T>", "export const readInstanceInterfaces") : ""}
    ${section("export type LocalInstanceWireRequest", "/** A `$el` type")}
    const owner = {
      encodeInstances: instances => new Promise(resolve => { const value = structuredClone(instances);
        wireJobs.push({ value, resolve }); if (!holdEncoding) resolve(value); }),
      decodeInstances: async instances => instances.map(item => structuredClone(item.instance)),
    };
    const client = { instanceEncoding: () => owner, apiFetch: async () => ({ dispatchInstances: [] }) };
    const defaultApiClient = {};
    const reader = { kind: "local", session: () => ({}), revision: () => 1 };
    const useReaderRuntime = () => reader, useApiClient = () => client;
    const useFieldPresentationRegistry = () => () => forbidden("page registry");
    const persistInstanceDraft = () => forbidden("unexpected live write"), persistRepresentation = persistInstanceDraft, decodedRepresentationBody = persistInstanceDraft;
    ${strip(drafts)}
    ${strip(locale)}
    ${strip(editor)}
    ${strip(panel)}
    let readDrafts;
    function Fixture() {
      const [drafts, setDrafts] = createSignal({ Labelable: { label: "Existing label" } });
      readDrafts = drafts;
      return <RepresentationsPanel mode="draft" startOpen={["Codeable", "Labelable", "Describable"]} drafts={drafts()} onDraftsChange={setDrafts} />;
    }
    const dispose = render(() => <Fixture />, document.body);
    globalThis.instanceEditorDom = { ready: () => setMetadata({ $tag: "Ok", _0: { interfaces: classes, representational: declarations.map(row => row[0]) } }),
      state: () => ({ drafts: readDrafts(), pageReads: [...pageReads], jobs: wireJobs.length }),
      hold: value => { holdEncoding = value; }, drain: () => { for (const job of wireJobs) job.resolve(job.value); }, dispose };
  `;
  const runner = `
    import { readFile } from "node:fs/promises";
    import { strict as assert } from "node:assert";
    import { chromium } from ${JSON.stringify(import.meta.resolve("playwright"))};
    const browser = await chromium.launch({ headless: true, channel: process.env.FENEL_TEST_BROWSER_CHANNEL });
    try {
      const page = await browser.newPage(); page.setDefaultTimeout(10000);
      const errors = []; page.on("pageerror", error => errors.push(error.message));
      await page.route("**/*", route => route.fulfill({ contentType: "text/html", body: "<html><body></body></html>" }));
      await page.goto("https://fenel.test/");
      await page.addScriptTag({ content: await readFile(process.argv[2], "utf8"), type: "module" });
      assert.equal(await page.locator(".reps-panel__row").count(), 0);
      await page.evaluate(() => instanceEditorDom.ready());
      await page.locator(".reps-panel__row").nth(2).waitFor();
      assert.equal((await page.evaluate(() => instanceEditorDom.state())).drafts.Labelable.label, "Existing label");
      for (const [name, method, value] of [["Codeable", "codeName", "Person"], ["Labelable", "label", "Person"], ["Describable", "description", "A person with a phone number"]]) {
        const row = page.locator(".reps-panel__row").filter({ has: page.locator(".reps-panel__row-name", { hasText: name }) });
        await row.getByRole("button", { name: name === "Labelable" ? "Edit" : "+ Add", exact: true }).click();
        await row.getByPlaceholder(method + " (en)", { exact: true }).fill(value);
        const save = row.getByRole("button", { name: "Save", exact: true });
        await page.waitForFunction(() => [...document.querySelectorAll(".reps-panel__btn--save")].some(button => button.textContent.trim() === "Save" && !button.disabled));
        await save.click();
        assert.equal((await page.evaluate(() => instanceEditorDom.state())).drafts[name][method], value);
      }
      const label = page.locator(".reps-panel__row").filter({ has: page.locator(".reps-panel__row-name", { hasText: "Labelable" }) });
      await label.getByRole("button", { name: "Edit", exact: true }).click();
      await page.evaluate(() => instanceEditorDom.hold(true));
      await label.getByPlaceholder("label (en)", { exact: true }).fill("Pending encode");
      await label.getByText("Advanced method JSON", { exact: true }).click();
      const methodJson = label.locator("details").filter({ has: page.locator("summary", { hasText: "Advanced method JSON" }) }).locator("textarea");
      assert.equal(await methodJson.count(), 1);
      await methodJson.fill('{"label":');
      await page.evaluate(() => instanceEditorDom.drain());
      assert.equal(await methodJson.inputValue(), '{"label":');
      assert.equal(await label.getByRole("button", { name: "Save", exact: true }).isDisabled(), true);
      await page.evaluate(() => instanceEditorDom.hold(false));
      await methodJson.fill('{"label":"Person from JSON"}');
      await page.waitForFunction(() => [...document.querySelectorAll(".reps-panel__btn--save")].some(button => button.textContent.trim() === "Save" && !button.disabled));
      await label.getByRole("button", { name: "Save", exact: true }).click();
      const state = await page.evaluate(() => instanceEditorDom.state());
      assert.equal(state.drafts.Labelable.label, "Person from JSON");
      assert.deepEqual(state.pageReads, []); assert.deepEqual(errors, []);
      console.log("PASS actual Local representation naming controls");
    } finally { await browser.close(); }
  `;
  try {
    const virtualPath = join(directory, "fixture.tsx"); await Bun.write(virtualPath, virtual);
    const compilerPath = Bun.resolveSync("@solidjs/compiler", dirname(fileURLToPath(import.meta.resolve("@solidjs/vite-plugin"))));
    const compiler = await import(pathToFileURL(compilerPath).href);
    const bundle = await Bun.build({ entrypoints: [virtualPath], target: "browser", conditions: ["browser", "development"],
      plugins: [{ name: "actual-local-instance-editor", setup(build) {
        build.onResolve({ filter: /^@fenel\// }, args => { throw new Error(`The mounted fixture escaped its worker boundary: ${args.path}`); });
        build.onLoad({ filter: /\.tsx$/ }, async args => ({ loader: "ts", contents: (await compiler.transformAsync(await Bun.file(args.path).text(), {
          filename: args.path, generate: "dom", hydratable: false, dev: true,
        })).code }));
      } }] });
    if (!bundle.success) throw new AggregateError(bundle.logs, "Mounted instance editor build failed");
    const browserPath = join(directory, "browser.js"), runnerPath = join(directory, "runner.mjs");
    await Bun.write(browserPath, bundle.outputs.find(output => output.kind === "entry-point")!);
    await Bun.write(runnerPath, runner);
    const child = Bun.spawn(["node", runnerPath, browserPath], { stdout: "pipe", stderr: "pipe", env: { ...process.env, TEMP: directory, TMP: directory } });
    const [exit, stdout, stderr] = await Promise.all([child.exited, new Response(child.stdout).text(), new Response(child.stderr).text()]);
    if (exit !== 0) throw new Error(`${stdout}\n${stderr}`);
    expect(stdout).toContain("PASS actual Local representation naming controls");
  } finally { await rm(directory, { recursive: true, force: true }); }
}, 60_000);

// C1 adapter qualification: actual shared argument/requirement controls and
// ArgsEditor; picker IO and reader replies are held at their existing boundary.
// Capture-only mode renders old and new picker APIs without treating a visual
// before record as a passing behavioral test or a normal Local reader run.
test("type argument picker keeps exact references, captions and captured targets", async () => {
  const packageRoot = fileURLToPath(new URL("../../../", import.meta.url));
  const scratch = join(packageRoot, ".tmp-diag", "type-argument-picker-dom");
  await mkdir(scratch, { recursive: true });
  const retained = process.env.FENEL_ADAPTER_CAPTURE_DIR;
  const directory = retained ?? await mkdtemp(join(scratch, "run-"));
  await mkdir(directory, { recursive: true });
  const captureOnly = process.env.FENEL_ADAPTER_CAPTURE_ONLY === "1";
  const paths = ["src/lib/instances/TypeArgumentEditor.tsx", "src/lib/instances/ConstraintsEditor.tsx", "src/lib/instances/InstanceEditor.tsx", "src/lib/value-card.tsx",
    "src/lib/locus-select.tsx", "src/lib/locus-context-menu.tsx", "src/lib/locus-menu-gesture.ts", "src/lib/icons.tsx", "src/lib/type-icon-fallbacks.json",
    "src/lib/display-name-text.tsx", "src/lib/display-name.ts", "src/lib/data-transfer/events.ts"];
  const sourceBytes = await Promise.all(paths.map(path => Bun.file(join(packageRoot, path)).bytes()));
  const sources = sourceBytes.map(bytes => new TextDecoder().decode(bytes));
  const [argument, constraints, editor, cards] = sources;
  const strip = (source: string) => source.replace(/^import[\s\S]*?;\r?\n/gm, "").replace(/^export /gm, "");
  const section = (source: string, from: string, to: string) => {
    const start = source.indexOf(from), end = source.indexOf(to, start);
    if (start < 0 || end < start) throw new Error(`Missing actual component section ${from}`);
    return source.slice(start, end).replace(/^export /gm, "");
  };
  const virtual = `
    import { createContext, createEffect, createMemo, createSignal, For, Show, Switch, Match, useContext, flush, latest } from "solid-js";
    import { render } from "@solidjs/web";
    import { LocusSelect } from ${JSON.stringify(join(packageRoot, "src/lib/locus-select.tsx"))};
    import { LUCIDE_BY_NAME, TYPE_ICON_FALLBACKS, IconByName } from ${JSON.stringify(join(packageRoot, "src/lib/icons.tsx"))};
    const jobs = [], changes = [], presentationReads = [];
    const reference = "fixture-owned-type";
    const row = { id: "entity:FixtureType", name: "Contact data", entityId: "FixtureType" };
    const [labelable, setLabelable] = createSignal({ typeName: "Labelable", args: [reference], methods: { label: { en: "Contact data" } } });
    const reader = { kind: "local", typePresentation: type => {
      presentationReads.push(type.$ref);
      return { type, label: type.$ref === labelable().args[0] ? labelable().methods.label.en : type.$ref };
    } };
    const CaptionReaderContext = createContext(reader);
    const useReaderRuntime = () => useContext(CaptionReaderContext) ?? undefined;
    const isInertAuthoringSession = () => true;
    const useAuthoringSession = () => new Proxy({}, { get() { throw new Error("Local caption read a page session"); } });
    const readerTypeLabelInSession = () => { throw new Error("Local caption dispatched on the page"); };
    const draftValueFingerprint = JSON.stringify;
    const dispatchRegistry = { listClasses: () => [] };
    ${section(cards, "export function valueCardTypeLabel", "/** Shared card chrome")}
    ${section(cards, "export function ValueTypeCaption", "/** `caption`")}
    const TypePicker = props => <div class="expr-picker"><button type="button" onClick={() => {
      const current = props.captureTarget?.();
      // The old API delivers its displayed name; the corrected API delivers
      // the already-checked wire. Neither branch performs semantic resolution.
      if (props.captureTarget && !current) return;
      jobs.push(() => { if (!current || current()) props.onPick(props.captureTarget
        ? { kind: "type", row, reference, ownership: "reader-checked" } : row.name); });
    }}>Resolve selected row</button><button type="button" onClick={() => props.onCancel?.()}>Cancel pick</button></div>;
    ${strip(argument)}
    ${strip(constraints)}
    const InstanceRegistryContext = createContext(() => undefined);
    const InstanceParameterNamesContext = createContext(iface => iface.params);
    const InstanceDraftCaptureContext = createContext(() => undefined);
    ${section(editor, "function isPatternArgs", "function rowDraft")}
    const seedArgs = () => { throw new Error("Unexpected structural mode"); };
    ${section(editor, "function ArgsEditor", "function MethodsEditor")}
    let controls;
    function Fixture() {
      let active = true, owner = {};
      const capture = () => { const captured = owner; return active ? () => active && owner === captured : undefined; };
      const [value, setValue] = createSignal("String");
      const [nested, setNested] = createSignal({ $el: { call: ["List", "String", "String"] } });
      const [rows, setRows] = createSignal([{ class: { $tag: "Id", entityId: "FixtureInterface" }, args: ["String"] }]);
      const [disabled, setDisabled] = createSignal(false);
      const [draft, setDraft] = createSignal({ typeName: "FixtureInterface", args: ["fixed-target", "String"], methods: {} });
      const [fixed, setFixed] = createSignal("fixed-target");
      const [saving, setSaving] = createSignal(false);
      const iface = { name: "FixtureInterface", params: ["target", "a"] };
      const props = { mode: "live", get targetId() { return fixed(); }, fixedInterface: iface.name,
        onSave: async () => {}, onDraftsChange: () => {} };
      const mode = () => props.mode;
      const editingKey = () => "fixture-instance", editingRow = () => undefined;
      let editRevision = 0, savingNow = false;
      // Candidate uses the exact outer InstanceEditor capture, not a rewritten
      // predicate. Old production has no capture; its visual old-API path does
      // not consume this context and still builds unchanged.
      ${editor.includes("  const captureDraft:") ? section(editor, "  const captureDraft:", "  const interfaces =") : 'const captureDraft = () => undefined;'}
      controls = {
        state: () => ({ value: value(), nested: nested(), rows: rows(), draft: draft(), changes: [...changes], reads: [...presentationReads], jobs: jobs.length }),
        drain: () => { const pending = jobs.splice(0); pending.forEach(job => job()); flush(); },
        replacement: () => { owner = {}; },
        replaceRequirement: () => { setRows([{ class: { $tag: "Id", entityId: "OtherInterface" }, args: ["String"] }]); flush(); },
        disable: value => { setDisabled(value); flush(); },
        save: value => { setSaving(value); flush(); },
        fixed: value => { setFixed(value); flush(); },
        instanceMode: value => { props.mode = value; },
        instanceSaveOwner: () => { props.onSave = async () => {}; },
        instanceDraftOwner: () => { props.onDraftsChange = () => {}; },
        rename: () => { setLabelable({ typeName: "Labelable", args: [reference], methods: { label: { en: "Updated contact" } } }); flush(); },
        close: () => { active = false; },
      };
      return <main id="fixture"><h1>Type argument and requirement controls</h1>
        ${argument.includes("export function TypeArgumentReferenceCaption") ? '<div hidden><CaptionReaderContext value={null}><TypeArgumentReferenceCaption reference="unavailable-inert-owner" /></CaptionReaderContext></div>' : ''}
        <section id="argument"><h2>Type argument</h2><TypeArgumentEditor value={value()} captureTarget={capture} disabled={disabled()}
          onChange={next => { changes.push(["argument", next]); setValue(next); }} /></section>
        <section id="constraints"><h2>Required interface arguments</h2><ConstraintsEditor value={rows()} captureTarget={capture} disabled={disabled()}
          onChange={next => { changes.push(["requirements", next]); setRows(next); }} /></section>
        <section id="nested"><h2>Nested application arguments</h2><TypeArgumentEditor value={nested()} captureTarget={capture}
          onChange={next => { changes.push(["nested", next]); setNested(next); }} /></section>
        <section id="instance"><h2>Fixed target instance</h2><InstanceDraftCaptureContext value={captureDraft}>
          <ArgsEditor iface={iface} draft={draft()} fixedTargetId={fixed()} locked={true} saving={saving()}
            onChange={patch => { changes.push(["instance", patch]); setDraft(current => ({ ...current, ...patch })); }} onValidityChange={() => {}} />
        </InstanceDraftCaptureContext></section>
      </main>;
    }
    const dispose = render(() => <Fixture />, document.body);
    globalThis.adapterFixture = { ...controls, dispose };
  `;
  const runner = `
    import { readFile, writeFile } from "node:fs/promises";
    import { strict as assert } from "node:assert";
    import { join } from "node:path";
    import { chromium } from ${JSON.stringify(import.meta.resolve("playwright"))};
    const browser = await chromium.launch({ headless: true, channel: process.env.FENEL_TEST_BROWSER_CHANNEL });
    try {
      const page = await browser.newPage({ viewport: { width: 1100, height: 900 } });
      const errors = []; page.on("pageerror", error => errors.push(error.message)); page.setDefaultTimeout(10000);
      await page.route("**/*", route => route.fulfill({ contentType: "text/html", body: "<html><body></body></html>" }));
      await page.goto("https://fenel.test/");
      await page.addStyleTag({ content: await readFile(process.argv[3], "utf8") });
      await page.addScriptTag({ content: await readFile(process.argv[2], "utf8"), type: "module" });
      const api = name => page.evaluate(name => adapterFixture[name](), name);
      const state = () => api("state");
      async function pick(scope, index = 0) {
        await page.locator(scope).getByRole("button", { name: "Pick", exact: true }).nth(index).click();
        await page.locator(scope).getByRole("button", { name: "Resolve selected row", exact: true }).click();
      }
      await pick("#argument"); await api("drain");
      const styles = await page.evaluate(() => {
        const inspect = selector => { const element = document.querySelector(selector); if (!element) return null;
          const style = getComputedStyle(element); return { tag: element.tagName, display: style.display, borderRadius: style.borderRadius,
            padding: style.padding, fontFamily: style.fontFamily, background: style.backgroundColor, color: style.color }; };
        return { button: inspect('#argument .reps-panel__btn'), input: inspect('#argument .reps-panel__icon-input'),
          select: inspect('#argument .locus-select'), caption: inspect('#argument .home-item__type-label') };
      });
      assert.equal(styles.button.display, "inline-flex"); assert.equal(styles.button.borderRadius, "5px");
      assert.equal(styles.input.borderRadius, "5px"); assert.equal(styles.select.tag, "BUTTON");
      await writeFile(join(process.argv[4], "computed-styles.json"), JSON.stringify(styles, null, 2));
      if (process.env.FENEL_ADAPTER_CAPTURE_ONLY === "1") {
        await page.screenshot({ path: join(process.argv[4], "type-argument-1100x900.png"), fullPage: true });
        await page.setViewportSize({ width: 390, height: 844 });
        await page.screenshot({ path: join(process.argv[4], "type-argument-390x844.png"), fullPage: true });
        assert.deepEqual(errors, []);
        console.log("PASS visual-only actual argument/constraint controls; behavioral qualification UNRUN");
      } else {
        assert.equal((await state()).value, "fixture-owned-type");
        assert.equal(await page.locator("#argument .home-item__type-label").textContent(), "Contact data");
        await api("rename");
        assert.equal(await page.locator("#argument .home-item__type-label").textContent(), "Updated contact");
        assert.equal((await state()).value, "fixture-owned-type");
        await pick("#argument");
        await page.evaluate(() => {
          const input = document.querySelector('#argument input[aria-label="Type or target name"]');
          input.value = "Changed before flush";
          input.dispatchEvent(new Event("input", { bubbles: true }));
          adapterFixture.drain();
        });
        assert.equal((await state()).value, "Changed before flush");
        await page.locator("#argument").getByRole("button", { name: "Cancel pick", exact: true }).click();
        await pick("#constraints"); await api("drain");
        assert.equal((await state()).rows[0].args[0], "fixture-owned-type");
        await pick("#constraints"); await api("replaceRequirement");
        const replacement = await state(); await api("drain");
        assert.deepEqual((await state()).rows, replacement.rows);
        assert.deepEqual((await state()).changes, replacement.changes);
        await pick("#nested", 0);
        await page.locator("#nested").getByRole("button", { name: "Remove type argument", exact: true }).first().click();
        const removed = await state(); await api("drain");
        assert.deepEqual((await state()).nested, removed.nested);
        assert.deepEqual((await state()).changes, removed.changes);
        await pick("#argument"); await api("replacement");
        const retargeted = await state(); await api("drain");
        assert.deepEqual((await state()).changes, retargeted.changes);
        await page.locator("#argument").getByRole("button", { name: "Cancel pick", exact: true }).click();
        await pick("#argument"); await page.locator("#argument").getByRole("button", { name: "Cancel pick", exact: true }).click();
        const cancelled = await state(); await api("drain"); assert.deepEqual((await state()).changes, cancelled.changes);
        await pick("#argument"); await page.evaluate(() => adapterFixture.disable(true));
        const locked = await state(); await api("drain"); assert.deepEqual((await state()).changes, locked.changes);
        await page.evaluate(() => adapterFixture.disable(false));
        assert.equal(await page.locator("#instance").getByRole("button", { name: "Pick", exact: true }).count(), 1);
        await pick("#instance"); await api("drain");
        assert.deepEqual((await state()).draft.args, ["fixed-target", "fixture-owned-type"]);
        for (const change of ["instanceMode", "instanceSaveOwner", "instanceDraftOwner"]) {
          await pick("#instance");
          await page.evaluate(change => adapterFixture[change]("draft"), change);
          const ownerChanged = await state(); await api("drain");
          assert.deepEqual((await state()).changes, ownerChanged.changes);
          await page.locator("#instance").getByRole("button", { name: "Cancel pick", exact: true }).click();
          await page.evaluate(() => adapterFixture.instanceMode("live"));
        }
        await pick("#instance"); await page.evaluate(() => adapterFixture.save(true));
        const saving = await state(); await api("drain"); assert.deepEqual((await state()).changes, saving.changes);
        await page.evaluate(() => adapterFixture.save(false));
        await page.locator("#instance").getByRole("button", { name: "Cancel pick", exact: true }).click();
        await pick("#instance"); await page.evaluate(() => adapterFixture.fixed("replacement-target"));
        const fixed = await state(); await api("drain"); assert.deepEqual((await state()).changes, fixed.changes);
        assert.deepEqual(errors, []);
        console.log("PASS actual argument/constraint reference and currentness controls");
      }
    } finally { await browser.close(); }
  `;
  try {
    const virtualPath = join(directory, "fixture.tsx"); await Bun.write(virtualPath, virtual);
    const compilerPath = Bun.resolveSync("@solidjs/compiler", dirname(fileURLToPath(import.meta.resolve("@solidjs/vite-plugin"))));
    const compiler = await import(pathToFileURL(compilerPath).href);
    const bundle = await Bun.build({ entrypoints: [virtualPath], target: "browser", conditions: ["browser", "development"],
      plugins: [{ name: "actual-type-argument-controls", setup(build) {
        build.onResolve({ filter: /^@fenel\// }, args => { throw new Error(`Adapter fixture escaped its held boundary: ${args.path}`); });
        build.onLoad({ filter: /\.tsx$/ }, async args => ({ loader: "ts", contents: (await compiler.transformAsync(await Bun.file(args.path).text(), {
          filename: args.path, generate: "dom", hydratable: false, dev: true,
        })).code }));
      } }] });
    if (!bundle.success) throw new AggregateError(bundle.logs, "Argument adapter fixture build failed");
    const browserPath = join(directory, "browser.js"), runnerPath = join(directory, "runner.mjs"), cssPath = join(directory, "styles.css");
    await Bun.write(browserPath, bundle.outputs.find(output => output.kind === "entry-point")!);
    await Bun.write(runnerPath, runner);
    const cssPaths = ["src/global.css", "src/routes/app.css", "src/lib/type-builder/type-builder.css", "src/lib/locus-select.css",
      "src/lib/locus-context-menu.css", "src/lib/display-name.css", "src/lib/admin-form/admin-form.css"];
    const styleBytes = await Promise.all(cssPaths.map(path => Bun.file(join(packageRoot, path)).bytes()));
    const styles = styleBytes.map(bytes => new TextDecoder().decode(bytes));
    await Bun.write(cssPath, styles.join("\n") + "\nbody { margin:0; padding:24px; background:#f5f5f5 } #fixture { max-width:900px; margin:auto; padding:20px; background:white } #fixture section { margin:20px 0 } @media(max-width:560px){body{padding:12px} #fixture{padding:12px}}\n");
    const digest = (text: string | Uint8Array) => new Bun.CryptoHasher("sha256").update(text).digest("hex");
    const inputs = [...paths.map((path, i) => ({ path, bytes: sourceBytes[i]! })), ...cssPaths.map((path, i) => ({ path, bytes: styleBytes[i]! }))];
    for (const input of inputs) {
      const retainedPath = join(directory, "inputs", input.path);
      await mkdir(dirname(retainedPath), { recursive: true });
      await Bun.write(retainedPath, input.bytes);
    }
    const artifacts = await Promise.all([virtualPath, browserPath, runnerPath, cssPath].map(async path => ({ path: relative(directory, path), sha256: digest(await Bun.file(path).bytes()) })));
    const sourceManifest = { kind: captureOnly ? "visual-only-controlled-reader-replies" : "mounted-adapter-controls",
      sourceInputs: paths.map((path, i) => ({ path, retained: "inputs/" + path, bytes: sourceBytes[i]!.byteLength, sha256: digest(sourceBytes[i]!) })),
      styleInputs: cssPaths.map((path, i) => ({ path, retained: "inputs/" + path, bytes: styleBytes[i]!.byteLength, sha256: digest(styleBytes[i]!) })),
      artifacts,
      limits: "Actual component, outer captureDraft, LocusSelect/menu/icon sources and canonical styles; held picker callback and authored Labelable replies; no real reader/worker/Save qualification or whole-app shell/fonts. ArgsEditor is exercised through its existing active TypeArgumentEditor child; dormant picker is not enabled."
    };
    await Bun.write(join(directory, "source-manifest.json"), JSON.stringify(sourceManifest, null, 2) + "\n");
    const verifyFrozenInputs = async () => {
      for (const input of inputs) {
        if (digest(await Bun.file(join(packageRoot, input.path)).bytes()) !== digest(input.bytes)
          || digest(await Bun.file(join(directory, "inputs", input.path)).bytes()) !== digest(input.bytes))
          throw new Error(`Adapter capture input changed: ${input.path}`);
      }
      for (const artifact of artifacts) if (digest(await Bun.file(join(directory, artifact.path)).bytes()) !== artifact.sha256)
        throw new Error(`Adapter capture artifact changed: ${artifact.path}`);
    };
    await verifyFrozenInputs();
    const child = Bun.spawn(["node", runnerPath, browserPath, cssPath, directory], { stdout: "pipe", stderr: "pipe", env: { ...process.env, TEMP: directory, TMP: directory } });
    const [exit, stdout, stderr] = await Promise.all([child.exited, new Response(child.stdout).text(), new Response(child.stderr).text()]);
    await Bun.write(join(directory, "stdout.log"), stdout); await Bun.write(join(directory, "stderr.log"), stderr);
    await verifyFrozenInputs();
    const screenshots = captureOnly && exit === 0 ? ["type-argument-1100x900.png", "type-argument-390x844.png"] : [];
    await Bun.write(join(directory, "result.json"), JSON.stringify({ exit, captureOnly, inputAndArtifactRecheck: "passed before and after browser",
      sourceManifestSha256: digest(await Bun.file(join(directory, "source-manifest.json")).bytes()),
      ...(await Bun.file(join(directory, "computed-styles.json")).exists()
        ? { computedStylesSha256: digest(await Bun.file(join(directory, "computed-styles.json")).bytes()) } : {}),
      screenshots: await Promise.all(screenshots.map(async path => ({ path, sha256: digest(await Bun.file(join(directory, path)).bytes()) }))),
      stdoutSha256: digest(stdout), stderrSha256: digest(stderr),
    }, null, 2) + "\n");
    if (exit !== 0) throw new Error(`${stdout}\n${stderr}`);
    console.log(stdout.trim());
    expect(stdout).toContain(captureOnly ? "PASS visual-only actual argument/constraint controls" : "PASS actual argument/constraint reference and currentness controls");
  } finally { if (!retained) await rm(directory, { recursive: true, force: true }); }
}, 90_000);
