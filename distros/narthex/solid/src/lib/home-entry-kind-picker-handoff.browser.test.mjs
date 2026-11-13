import { expect, test } from "bun:test";
import { mkdir, writeFile } from "node:fs/promises";
import { createRequire } from "node:module";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

test("the open kind picker owns its same-source address handoff until choice or Cancel", async () => {
  const repository = resolve(fileURLToPath(new URL("../../../../../", import.meta.url)));
  const sourceRoot = join(repository, "distros/narthex/solid/src");
  const output = join(repository, ".tmp-diag/kind-picker-handoff");
  await mkdir(output, { recursive: true });
  const home = (await Bun.file(new URL("./home-entry.tsx", import.meta.url)).text()).replaceAll("\r\n", "\n");
  const surface = (await Bun.file(new URL("./workspace-surface.tsx", import.meta.url)).text()).replaceAll("\r\n", "\n");
  function section(text, first, last) {
    const begin = text.indexOf(first), end = text.indexOf(last, begin);
    if (begin < 0 || end < begin) throw new Error(`Picker fixture source boundary moved: ${first}`);
    return text.slice(begin, end);
  }
  const condition = surface.match(/<Show when=\{([^\n]+)\} fallback=\{<Show when=\{address\.initialFailure\(\)\}/)?.[1];
  if (!condition?.includes("address.initialLoading()")) throw new Error("InitialAddress handoff condition moved");
  const entry = fileURLToPath(new URL("./new-item-picker.tsx", import.meta.url));
  const source = `
import { render } from "@solidjs/web";
import { createSignal, createMemo, createEffect, untrack, onCleanup } from "solid-js";
import { cloneDraftValue } from "./native-draft";
import { scopeKey } from "./locus-scope";
import { workspaceSourceKey } from "./workspace-source-wire";
${await Bun.file(entry).text()}
function Fixture() {
  const [sessionEpoch, setEpoch] = createSignal(0);
  const foreign = location.search.includes("foreign"), refused = location.search.includes("refused");
  const [source, setSource] = createSignal(foreign ? { $tag: "AccountSource", accountId: "foreign" }
    : { $tag: location.search.includes("public") ? "PublicSource" : "ThisTabSource" });
  const [focus, setFocus] = createSignal({ kind: "root" });
  const [addressReady, setAddressReady] = createSignal(false);
  const [readerReady, setReaderReady] = createSignal(false);
  const controller = new AbortController();
  const client = { epoch: 0, signal: controller.signal };
  const [paneActive, setPaneActive] = createSignal(true);
  const [addressFailure, setAddressFailure] = createSignal();
  const props = { get epoch() { return sessionEpoch(); } };
  const runtimes = new Map([["local", { client }]]);
  let surfaceClosed = false;
  const settings = () => false;
  const synchronization = () => ({ pending: () => 0, saving: () => false, error: () => undefined });
${section(surface, "  const localCreationDrafts =", "  const [shortcutRequests,")}
${section(surface, "  const rootHandlers =", "  const [composerSearch,")}
${section(surface, "  const initialHandoffHeld =", "  onSettled(() => {")}
  const [selected, setSelected] = createSignal({ id: "selected-lens", source: source(), focus: { $tag: "RootFocus" } });
  const active = selected;
  const value = () => ({ lenses: [selected()] });
  let delivery;
  const exploreData = (_source, accept) => { delivery = () => {
    const lens = { id: "local-destination", source: { $tag: "ThisTabSource" }, focus: { $tag: "RootFocus" } };
    setSelected(lens); accept(lens.id);
    queueMicrotask(() => { const intent = currentRootIntent; intent.arrived = true; dispatchRootIntent(intent); });
  }; };
${section(surface, "  type RootIntent =", "  const rootShelf =")}

  const address = { initialLoading: () => !addressReady(), initialFailure: addressFailure, initialRootSource: source };
${section(surface, "  const rootShelf = {", "  createEffect(() => {\n    const intent = pendingRoot();")}
  let oldHandler;
  const events = [];
  const [replacement, setReplacement] = createSignal(false);
  queueMicrotask(() => rootShelf.register({ paneId: "local-destination", sourceKey: () => "local", isRoot: () => true,
    isActive: () => selected().id === "local-destination", canCreate: () => true, creationResolved: () => true,
    run(action) { events.push(action); retainCreationDraft("selected-lens", { $tag: "ThisTabSource" },
      { action, source: "new", focus: { kind: "root" }, changed: false }, client); } }));
  function Entry(entryProps) {
    const props = { pane: { id: entryProps.id, active: paneActive, source, focus, sourceLabel: () => "Local",
      creationDraft: () => creationDraft("selected-lens", source(), focus()),
      onCreationDraft: (draft, owner) => retainCreationDraft("selected-lens", source(), draft, owner) },
      prepareWorkspace: () => Promise.resolve() };
    const displayFocus = focus;
    const paneSourceKey = () => workspaceSourceKey(source());
    const current = () => ({ id: "fenel-browser-local", canEdit: true });
    const workspace = { ready: readerReady, error: () => null, request: () => events.push("prepare") };
    const currentReads = () => true;
    const failed = () => false;
    const creationReadAllowed = () => source().$tag === "ThisTabSource" && !refused;
    const choosesPendingCreation = () => false;
    const setInspectionIntent = () => {};
    const setDrawerOpen = () => {};
    let representationDisposed = false;
    onCleanup(() => { representationDisposed = true; });
    const HomeWorkspace = { preload: () => Promise.resolve() };
${section(home, "  const resumedCreation =", "  const [retryingEpoch,")}
${section(home, "  const requested = createMemo(", "  // Solid 2 computes eagerly.")}
${section(home, "  const [pickerOpen,", "  const [contextMenu,")}
${section(home, "  function openWorkspace(", "  onSettled(() => {")}
    const cancelRequest = () => { setPickerOpen(false); setRequest(undefined); };
${section(home, "  function chooseBranch(", "  const localRootTransfer =")}
    const heldLiteralInspection = () => false;
    const newExpressionRequest = () => undefined;
    const currentNewOriginMatches = () => true;
    const readProjection = () => undefined;
    const workspaceEntered = () => false;
    const inspectionMode = () => "data";
    const focusIntent = () => undefined, inspectionIntent = () => undefined, typePreviewIntent = () => undefined;
    const quickValue = () => undefined, readingClipboard = () => false, externalAdding = () => false;
    const contextMenu = () => undefined;
    const drawerOpen = () => false, savingQuickValue = () => false, earlyDraftHeld = () => false, earlyPickers = () => 0;
    const dataInspectionPanelVisible = () => false;
${section(home, "  const showingWorkspace = createMemo(", "  // The workspace received")}
${section(home, "  createEffect(() => props.pane?.id ?? \"\",", "  const pendingShellWork =")}
    return <div data-entry={entryProps.id}><Show when={showingWorkspace()} fallback={<>
      <button id="open-picker" onClick={openCreationPicker}>More creation options</button>
      <Show when={pickerOpen()}><NewItemPickerModal onClose={() => setPickerOpen(false)}
        onPickFunction={() => pickCreationBranch("new:function")}
        onPickValue={() => pickCreationBranch("new:value")} onPickType={() => pickCreationBranch("new:type")}
        onPickExpression={() => pickCreationBranch("new:expression")} onPickFunctionCall={() => setPickerOpen(false)} /></Show>
    </>}><h3>Prepared {request()?.action}</h3></Show></div>;
  }
  globalThis.pickerHandoff = {
    failure() { setAddressFailure(new Error("controlled address refusal")); },
    inactive() { setPaneActive(false); },
    abort() { controller.abort(); setAddressReady(false); queueMicrotask(() => setAddressReady(true)); },
    deliver() { delivery(); }, replace() { setReplacement(true); },
    ready(order) { if (order !== "address") setReaderReady(true); if (order !== "reader") setAddressReady(true); },
    source() { setSource({ $tag: "PublicSource" }); }, epoch() { setEpoch(1); },
    focus() { setFocus({ kind: "view", viewId: "elsewhere" }); },
    remember() { oldHandler = [...rootHandlers][0]; },
    retiredCallback: () => oldHandler?.pendingCreationPicker?.() ?? false,
    state: () => ({ readerReady: readerReady(), addressReady: addressReady(), held: initialHandoffHeld(),
      draft: creationDraft("selected-lens", source(), focus()), handlers: [...rootHandlers].map(h=>({ id:h.paneId, active:h.isActive(), source:h.sourceKey(), root:h.isRoot(), create:h.canCreate() })), intent: currentRootIntent, selected: selected(), events }),
  };
  return <Show when={!replacement() || initialHandoffHeld()} fallback={<p id="replacement">Replacement</p>}><Show when={${condition}} fallback={<Show when={address.initialFailure()} fallback={<Entry id="initial-address-preview" />}><p id="address-failure">Address failed</p></Show>}>
    <Entry id="selected-lens" />
  </Show></Show>;
}
render(() => <Fixture />, document.getElementById("root"));
`;
  const require = createRequire(import.meta.url);
  const compiler = await import(pathToFileURL(Bun.resolveSync("@solidjs/compiler", dirname(require.resolve("@solidjs/vite-plugin")))).href);
  const bundle = await Bun.build({ entrypoints: [entry], target: "browser", conditions: ["browser", "development"], plugins: [{ name: "actual-picker-handoff", setup(build) {
    build.onResolve({ filter: /^~\// }, args => ({ path: Bun.resolveSync(join(sourceRoot, args.path.slice(2)), sourceRoot) }));
    build.onResolve({ filter: /^\.\/prompt-body$/ }, () => ({ path: "unused-prompt", namespace: "unused-prompt" }));
    build.onLoad({ filter: /.*/, namespace: "unused-prompt" }, () => ({ loader: "js", contents: 'export default function(){throw new Error("Prompt is outside the picker fixture");}' }));
    build.onLoad({ filter: /\.tsx$/ }, async args => ({ loader: "ts", contents: (await compiler.transformAsync(args.path === entry ? source : await Bun.file(args.path).text(),
      { filename: args.path, generate: "dom", hydratable: false, dev: true })).code }));
    build.onLoad({ filter: /\.css$/ }, () => ({ loader: "js", contents: "" }));
  } }] });
  if (!bundle.success) throw new AggregateError(bundle.logs);
  const script = join(output, "fixture.js");
  await writeFile(script, await bundle.outputs.find(entry => entry.kind === "entry-point").text());
  const driver = join(output, "driver.mjs");
  await writeFile(driver, `
import assert from "node:assert/strict";
import { readFile, writeFile } from "node:fs/promises";
import { createRequire } from "node:module";
const { chromium } = createRequire(import.meta.url)(${JSON.stringify(require.resolve("playwright"))});
const browser = await chromium.launch({ channel: "chrome", headless: true, timeout: 30000 });
const results = [];
try {
  for (const order of ["reader-first", "address-first", "together"]) for (const action of ["choice", "cancel", "source", "focus", "epoch", "failure", "inactive", "abort"]) {
    const page = await browser.newPage({ viewport: { width: 1100, height: 900 }, reducedMotion: "reduce" });
    const errors = []; page.on("pageerror", error => errors.push(error.message));
    await page.route("**/*", route => route.fulfill({ contentType: "text/html", body: '<main id="root"></main>' }));
    await page.goto("https://fenel.test/");
    await page.addStyleTag({ content: await readFile(${JSON.stringify(join(sourceRoot, "global.css"))}, "utf8") });
    await page.addStyleTag({ content: await readFile(${JSON.stringify(join(sourceRoot, "routes/app.css"))}, "utf8") });
    await page.addScriptTag({ content: await readFile(${JSON.stringify(script)}, "utf8"), type: "module" });
    await page.locator("#open-picker").click();
    const button = await page.locator("button.picker-chip--function").elementHandle();
    await page.evaluate(() => pickerHandoff.remember());
    if (order === "together") await page.evaluate(() => pickerHandoff.ready());
    else {
      await page.evaluate(order => pickerHandoff.ready(order === "reader-first" ? "reader" : "address"), order);
      assert.equal(await button.evaluate(node => node.isConnected), true, "First readiness signal retired the open picker");
      await page.evaluate(order => pickerHandoff.ready(order === "reader-first" ? "address" : "reader"), order);
    }
    await page.waitForTimeout(30);
    if (order === "together" && action === "choice") await page.screenshot({ path: ${JSON.stringify(join(output, "candidate-after-readiness.png"))} });
    assert.equal(await button.evaluate(node => node.isConnected), true, "Address handoff retired the open picker");
    assert.deepEqual(await page.evaluate(() => ({ reader: pickerHandoff.state().readerReady, address: pickerHandoff.state().addressReady, held: pickerHandoff.state().held })),
      { reader: true, address: true, held: true });
    if (action === "choice") {
      await page.locator("button.picker-chip--function").click();
      await page.locator('[data-entry="selected-lens"]').waitFor();
      await page.getByRole("heading", { name: "Prepared new:function", exact: true }).waitFor();
      assert.equal((await page.evaluate(() => pickerHandoff.state())).draft.action, "new:function");
      assert.equal(await page.locator(".new-item-picker").count(), 0);
    } else if (action === "cancel") {
      await page.getByRole("button", { name: "Close", exact: true }).click();
      await page.locator('[data-entry="selected-lens"]').waitFor();
      assert.equal((await page.evaluate(() => pickerHandoff.state())).held, false);
      assert.equal((await page.evaluate(() => pickerHandoff.state())).draft, undefined);
    } else {
      await page.evaluate(action => pickerHandoff[action](), action);
      await page.locator(action === "failure" ? "#address-failure" : '[data-entry="selected-lens"]').waitFor();
      assert.equal((await page.evaluate(() => pickerHandoff.state())).held, false);
      assert.equal((await page.evaluate(() => pickerHandoff.state())).draft, undefined);
      assert.equal(await page.locator(".new-item-picker").count(), 0);
    }
    assert.equal(await page.evaluate(() => pickerHandoff.retiredCallback()), false, "Disposed picker callback must be inert");
    assert.deepEqual(errors, []);
    results.push({ order, action, state: await page.evaluate(() => pickerHandoff.state()) });
    await page.close();
  }
  for (const sourceMode of ["public", "foreign", "refused"]) {
    const page = await browser.newPage({ viewport: { width: 1100, height: 900 } });
    const errors = []; page.on("pageerror", error => errors.push(error.message));
    await page.route("**/*", route => route.fulfill({ contentType: "text/html", body: '<main id="root"></main>' }));
    await page.goto("https://fenel.test/?" + sourceMode);
    await page.addScriptTag({ content: await readFile(${JSON.stringify(script)}, "utf8"), type: "module" });
    await page.locator("#open-picker").click();
    await page.evaluate(() => pickerHandoff.replace());
    await page.locator("button.picker-chip--function").click();
    await page.waitForTimeout(30);
    assert.equal(await page.locator("#replacement").count(), 0, "Deferred cross-source choice released its owner before shelf admission/delivery");
    assert.equal(await page.evaluate(() => pickerHandoff.state().held), true);
    await page.evaluate(() => pickerHandoff.deliver());
    await page.waitForTimeout(30);
    assert.deepEqual(await page.evaluate(() => pickerHandoff.state().events), ["new:function"]);
    assert.deepEqual(errors, []);
    results.push({ order: sourceMode, action: "choice" });
    await page.close();
  }
  await writeFile(${JSON.stringify(join(output, "results.json"))}, JSON.stringify(results, null, 2));
  console.log("Actual picker ownership and both readiness signals pass");
} finally { await browser.close(); }
`);
  const child = Bun.spawn(["node", driver], { cwd: repository, stdout: "pipe", stderr: "pipe" });
  const [stdout, stderr, code] = await Promise.all([new Response(child.stdout).text(), new Response(child.stderr).text(), child.exited]);
  if (code) throw new Error(`Picker ownership fixture failed\n${stdout}\n${stderr}`);
  expect(stdout).toContain("both readiness signals pass");
}, 120000);
