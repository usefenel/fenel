import { after, before, test } from "node:test";
import { strict as assert } from "node:assert";
import { mkdir, readFile } from "node:fs/promises";
import { createRequire } from "node:module";
import { join } from "node:path";
import type { Browser, Locator, Page } from "playwright";
import type {} from "./home-entry-context-menu.fixture";
import type { ValueSuggestion } from "./home-search/value-suggestions";
import { decodeCheckpointValue } from "../../../../../implementations/typescript/engine/src/checkpoint-json";

const { chromium } = createRequire(import.meta.url)(process.env["FENEL_TEST_PLAYWRIGHT_MODULE"] ?? "playwright") as typeof import("playwright");

let browser: Browser;
let script: string;
let css: string;
let numberType: { $ref: string };
before(async () => {
  [script, css] = await Promise.all([readFile(process.argv[2]!, "utf8"), readFile(process.argv[3]!, "utf8")]);
  browser = await chromium.launch({ headless: true, timeout: 90_000, channel: process.env["FENEL_TEST_BROWSER_CHANNEL"] });
  const manifest = JSON.parse(await readFile("implementations/typescript/engine/src/generated/repository-identity-manifest.json", "utf8"));
  // Type rows are keyed by owner: find the system Number's key in the
  // generated (owner, name, key) projection, then its live type row.
  const numberKey = (manifest.types as string[][]).find(([owner, name]) => owner === "system" && name === "Number")![2];
  numberType = { $ref: (manifest.entries as string[][]).find(([key, , kind]) => key === numberKey && kind === "type")![1]! };
});
after(async () => { await browser?.close(); });

async function fixture(run: (page: Page) => Promise<void>, scenario?: string, publicRoot?: unknown) {
  const page = await browser.newPage({ viewport: process.env["FENEL_HOME_ENTRY_PHONE"] === "1"
    ? { width: 390, height: 844 } : { width: 1024, height: 768 } });
  page.setDefaultTimeout(10_000);
  const errors: string[] = [];
  const engineRequests: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  try {
    await page.route("**/*", (route) => {
      if (/\/(?:authoring-json|@fenel\/)/.test(route.request().url())) {
        engineRequests.push(route.request().url());
        return route.fulfill({ status: 404, body: "The early fixture has no engine modules.", contentType: "text/plain" });
      }
      if (route.request().url().endsWith("/routes/app/home")) return route.fulfill({ contentType: "text/javascript", body: `
        homeEntryContextFixture.loaded("workspace");
        export default function Workspace(props) {
          homeEntryContextFixture.handoff(props.initialAction);
          const element = document.createElement("div");
          element.dataset.workspaceHandoff = "true";
          return element;
        }
      ` });
      if (route.request().url().endsWith("/workspace-authoring-provider")) return route.fulfill({ contentType: "text/javascript", body: `
        homeEntryContextFixture.loaded("provider");
        export default function Provider(props) { return props.children; }
      ` });
      // Plain structured data previews lazily load their structural owner. The
      // early fixture marks where that owner would render without running it.
      if (route.request().url().endsWith("/DataValueSurface")) return route.fulfill({ contentType: "text/javascript", body: `
        export function DataValueSurface() {
          const element = document.createElement("div");
          element.dataset.structuralDataPreview = "true";
          return element;
        }
      ` });
      if (route.request().url().endsWith("/locus-card-evaluation")) return route.fulfill({ contentType: "text/javascript", body: `
        homeEntryContextFixture.loaded("held-graph-evaluation");
        export function authoringExpressionSites(node) { return { sites: [{ node }] }; }
        export function authoringWorkerSnapshot() { return undefined; }
        export function readLocusCardResult() { return undefined; }
        export function readLocusCapturedValue() { return undefined; }
        export function evaluateLocusCard() { throw new Error("A disposing held graph must not execute"); }
      ` });
      return route.fulfill({ body: "<html><body></body></html>", contentType: "text/html" });
    });
    await page.goto(`https://fenel.test${scenario ? `?scenario=${scenario}` : ""}`, { timeout: 90_000 });
    if (publicRoot) await page.evaluate(root => { Object.assign(globalThis, { fixturePublicRoot: root }); }, publicRoot);
    await page.addStyleTag({ content: css });
    await page.addScriptTag({ content: script, type: "module" });
    // HomeEntry is display:contents; its controls/canvas own the visible boxes.
    await page.locator(scenario === "loading-card" ? ".home-canvas" : ".home-entry").waitFor({ state: "attached" });
    if (scenario !== "loading-card") assert.equal(await page.locator(".home-new-button").getAttribute("data-workspace-ready"), "false");
    assert.deepEqual(await page.evaluate(() => homeEntryContextFixture.state().imports), []);
    await run(page);
    assert.deepEqual(errors, []);
    assert.deepEqual(engineRequests, []);
    assert.deepEqual(await page.evaluate(() => homeEntryContextFixture.state().errors), []);
  } catch (error) {
    console.error("Home entry fixture failure", JSON.stringify({ errors, engineRequests, state: await page.evaluate(() => globalThis.homeEntryContextFixture?.state()), text: await page.locator("body").innerText() }));
    throw error;
  } finally { await page.close(); }
}

async function openCardExpression(page: Page, card: Locator) {
  assert.equal(await card.getByRole("button", { name: "Open expression", exact: true }).count(), 0);
  await card.hover();
  await card.getByRole("button", { name: "Actions", exact: true }).click();
  await page.getByRole("menuitem", { name: "Open", exact: true }).hover();
  await page.getByRole("menuitem", { name: "Open expression", exact: true }).click();
}

async function editHeldData(page: Page, source: Locator) {
  // Edit belongs to the expression occurrence's header/frame. Its read body
  // has a nested DataOccurrenceBoundary and intentionally opens data actions.
  const card = source.locator(".expr-graph-data-card:visible");
  assert.equal(await card.count(), 1, "Edit targets the one visible held data occurrence");
  const header = card.locator(":scope > .home-item__header");
  assert.equal(await header.count(), 1, "Edit targets that expression occurrence's header");
  await header.click({ button: "right" });
  const menu = page.getByRole("menu", { name: "Expression actions", exact: true });
  await menu.waitFor();
  await menu.getByRole("menuitem", { name: "Edit", exact: true }).click();
}

async function contextMenu(page: Page, xFraction = 0.25, yFraction = 0.35) {
  const bounds = await page.locator(".home-canvas").boundingBox();
  assert.ok(bounds);
  const x = Math.round(bounds.x + bounds.width * xFraction);
  const y = Math.round(bounds.y + bounds.height * yFraction);
  await page.mouse.click(x, y, { button: "right" });
  await page.getByRole("menu", { name: "Data actions", exact: true }).waitFor();
  return { x: (x - bounds.x) / bounds.width, y: (y - bounds.y) / bounds.height };
}

async function earlyBrowse(page: Page) {
  await page.getByRole("button", { name: "Browse", exact: true }).click();
  const panel = page.getByRole("complementary", { name: "Browse and search", exact: true });
  await panel.waitFor();
  return panel;
}

async function browseLoaded(page: Page) {
  await page.waitForFunction(() => ["/api/saved-queries", "/api/types", "/api/functions"]
    .every(path => homeEntryContextFixture.state().browseReads.some(read => read.path === path)));
  await page.evaluate(() => homeEntryContextFixture.releaseBrowse());
  await page.getByRole("option").filter({ hasText: "Launch checklist" }).waitFor();
}

async function earlyCallBrowse(page: Page) {
  await page.getByRole("button", { name: "More creation options", exact: true }).click();
  await page.getByRole("button", { name: "Create a function call Pick a function, give it inputs, keep its result.", exact: true }).click();
  const panel = page.getByRole("complementary", { name: "Browse and search", exact: true });
  await panel.waitFor();
  assert.equal(await page.getByRole("heading", { name: "What do you want to create?", exact: true }).count(), 0);
  return panel;
}

test("early Call opens the existing Browse while reads wait and retains its query at handoff", () => fixture(async page => {
  const originalUrl = page.url();
  const panel = await earlyCallBrowse(page);
  assert.equal(page.url(), originalUrl);
  await panel.getByText("Reading functions…", { exact: true }).waitFor();
  assert.deepEqual(await page.evaluate(() => homeEntryContextFixture.state().actions), []);
  await browseLoaded(page);
  await panel.getByRole("combobox").fill("calculateProfit");
  await page.evaluate(() => homeEntryContextFixture.ready());
  await page.locator("[data-workspace-handoff]").waitFor();
  assert.deepEqual(await page.evaluate(() => homeEntryContextFixture.state().actions), [
    { kind: "browse", query: "calculateProfit" },
  ]);
  assert.equal(page.url(), originalUrl);
}, "browse-reader"));

test("early Call cannot publish held catalogue rows after its source reader closes", () => fixture(async page => {
  const panel = await earlyCallBrowse(page);
  await page.waitForFunction(() => homeEntryContextFixture.state().browseReads.length === 3);
  const requests = await page.evaluate(() => homeEntryContextFixture.state().requests);
  await page.evaluate(() => homeEntryContextFixture.closeReader());
  await page.evaluate(() => homeEntryContextFixture.releaseBrowse());
  await panel.getByText("Loading the rest of the catalog…", { exact: true }).waitFor();
  assert.equal(await panel.getByRole("option").count(), 0);
  assert.deepEqual(await page.evaluate(() => homeEntryContextFixture.probeReader()), ["rejected", "rejected"]);
  assert.deepEqual(await page.evaluate(() => homeEntryContextFixture.state().requests), requests);
  assert.deepEqual(await page.evaluate(() => homeEntryContextFixture.state().actions), []);
}, "browse-reader"));

test("early Call clears the prior session's query and refuses its late catalogue rows", () => fixture(async page => {
  let panel = await earlyCallBrowse(page);
  await page.waitForFunction(() => homeEntryContextFixture.state().browseReads.length === 3);
  const priorAccount = await page.evaluate(() => homeEntryContextFixture.state().browseReads[0]!.account);
  assert.ok(typeof priorAccount === "string", "This fixture must start with an account");
  await panel.getByRole("combobox").fill("private prior query");
  await page.evaluate(() => homeEntryContextFixture.session("other-account"));
  await panel.waitFor({ state: "detached" });
  await page.evaluate(account => homeEntryContextFixture.releaseBrowse(undefined, account), priorAccount);
  assert.deepEqual(await page.evaluate(() => homeEntryContextFixture.state().actions), []);
  panel = await earlyCallBrowse(page);
  assert.equal(await panel.getByRole("combobox").inputValue(), "");
  await page.waitForFunction(() => homeEntryContextFixture.state().browseReads.filter(read => read.account === "other-account").length === 3);
  assert.equal(await panel.getByRole("option").filter({ hasText: "Launch checklist" }).count(), 0);
  await page.evaluate(() => homeEntryContextFixture.releaseBrowse(undefined, "other-account"));
  await panel.getByRole("option").filter({ hasText: "Account two notebook" }).waitFor();
}, "browse"));

async function heldGraphRoot(literalList = false) {
  const snapshot = JSON.parse(await readFile("distros/narthex/solid/src/lib/generated/public-bootstrap.json", "utf8"));
  const root = decodeCheckpointValue(snapshot.root, snapshot.encoding) as import("./locus-root-data").LocusRootData;
  const demo = root.items.find(item => item.id === "demo")!.source!;
  if (demo.kind !== "expr" || demo.expr.kind !== "literal") throw new Error("Expected the existing demo record");
  const fields = (demo.expr.value as { __record: { fields: Array<{ name: string; value: unknown }> } }).__record.fields;
  fields.find(field => field.name === "Reversed words")!.value = { kind: "call", fnId: "std:join", args: [
    literalList ? { kind: "literal", value: ["one", "two"] }
      : { kind: "call", fnId: "std:reverse", args: [{ kind: "call", fnId: "std:words", args: [{ kind: "literal", value: "the quick brown fox" }] }] },
    { kind: "literal", value: " " },
  ] };
  for (const [target, codeName] of [["std:join", "join"], ["std:reverse", "reverse"], ["std:words", "words"]]) {
    (root.previewMetadata ??= { entries: [] }).entries.push({ target: target!, representations: [{ typeName: "Codeable", methods: { codeName } }] });
  }
  return root;
}

async function openHeldGraph(page: Page, preparing = true) {
  await page.evaluate(() => {
    homeEntryContextFixture.focus({ kind: "value", viewId: "public-fenel", itemId: "demo", path: ["Reversed words"], rootItem: true });
    homeEntryContextFixture.mode("expression");
  });
  const source = page.locator("[data-expression-inspection]");
  await source.locator(".expr-call").first().waitFor();
  const root = source.locator(".expr-call").first();
  if (await root.getAttribute("data-call-layout") !== "graph") {
    await root.getByRole("button", { name: "Actions", exact: true }).click();
    await page.getByRole("menuitem", { name: "Lens", exact: true }).hover();
    await page.getByRole("menuitem", { name: "Graph", exact: true }).click();
  }
  if (preparing) {
    await source.getByRole("status").filter({ hasText: "Preparing data…" }).first().waitFor();
    assert.equal(await source.getByText("Data not available", { exact: true }).count(), 0);
    const inlineHeights = await source.locator(".expr-call-graph__edge-data-card.home-item--preparing").evaluateAll(cards =>
      cards.map(card => card.getBoundingClientRect().height));
    assert.ok(inlineHeights.every(height => height <= 52), "Pending inline cards must fit between the function nodes");
  } else await source.locator(".expr-call-graph--active").first().waitFor();
  assert.equal(await source.getByRole("status").filter({ hasText: "Computing data…" }).count(), 0);
  return source;
}

test("initial named-input intent mounts the existing ready Home handoff once and survives consumption", async () => {
  const root = await heldGraphRoot();
  await fixture(async page => {
    // Several held surfaces ask for the same idempotent reader preparation:
    // settle their requests, then require the re-sent intent to add none.
    await page.waitForFunction(() => homeEntryContextFixture.state().requested > 0);
    await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
    await page.waitForTimeout(200);
    const requested = (await page.evaluate(() => homeEntryContextFixture.state())).requested;
    assert.equal(await page.locator("[data-workspace-handoff]").count(), 0);
    let state = await page.evaluate(() => homeEntryContextFixture.state());
    assert.equal(state.addressInputs?.id, 1);
    assert.equal(state.actions.length, 0);
    await page.evaluate(async () => {
      homeEntryContextFixture.addressInputs(1);
      await Promise.resolve(); await Promise.resolve();
    });
    assert.equal((await page.evaluate(() => homeEntryContextFixture.state())).requested, requested,
      "The same URL intent must not request a second reader");
    await page.evaluate(() => homeEntryContextFixture.releaseGraphReader());
    await page.locator("[data-workspace-handoff]").waitFor();
    await page.waitForFunction(() => homeEntryContextFixture.state().addressInputs === undefined);
    state = await page.evaluate(() => homeEntryContextFixture.state());
    assert.equal(state.actions.length, 1);
    assert.equal(state.requested, requested);
    assert.equal(state.imports.includes("held-graph-evaluation"), false);
    await page.evaluate(() => homeEntryContextFixture.releaseGraphReader());
    await page.waitForFunction(() => homeEntryContextFixture.state().readerReleases === 2);
    assert.equal(await page.locator("[data-workspace-handoff]").count(), 1);
    assert.equal((await page.evaluate(() => homeEntryContextFixture.state())).actions.length, 1,
      "Clearing consumed address inputs must retain the existing prepared Home");
  }, "address-handoff", root);
});

test("global New opens the existing kind picker while the temporary root and editor remain pending", () => fixture(async page => {
  await page.waitForFunction(() => homeEntryContextFixture.state().rootReadsPending === 1);
  assert.deepEqual(await page.evaluate(() => homeEntryContextFixture.state().createVerdicts), [false], "The root has supplied no write verdict");
  assert.equal(await page.locator(".home-new-button").isDisabled(), false, "New may open its draft before the root grants any write");
  await page.evaluate(() => homeEntryContextFixture.rootNew());
  await page.getByRole("heading", { name: "What do you want to create?", exact: true }).waitFor();
  assert.equal(await page.evaluate(() => homeEntryContextFixture.state().ready), false);
  assert.equal(await page.evaluate(() => homeEntryContextFixture.state().rootReadsPending), 1);
  assert.deepEqual(await page.evaluate(() => homeEntryContextFixture.state().createVerdicts), [false]);
  assert.equal(await page.locator("[data-workspace-handoff]").count(), 0);
  await page.getByRole("button", { name: /^Create data/ }).click();
  assert.equal(await page.locator("[data-workspace-handoff]").count(), 0, "Choosing a kind waits for the same reader");
  assert.deepEqual(await page.evaluate(() => homeEntryContextFixture.state().actions), []);
  assert.equal(await page.evaluate(() => homeEntryContextFixture.state().requests.some(request => /^(POST|PUT|DELETE) /.test(request))), false, "No data write is performed by kind selection");
  await page.evaluate(() => { homeEntryContextFixture.releaseRoot(); homeEntryContextFixture.ready(); });
  await page.locator("[data-workspace-handoff]").waitFor();
  assert.deepEqual(await page.evaluate(() => homeEntryContextFixture.state().actions), ["new:value"]);
}, "local-new-pending"));

test("direct New opens Scope and Expression immediately, then hands off that same creation intent", () => fixture(async page => {
  await page.waitForFunction(() => homeEntryContextFixture.state().rootReadsPending === 1);
  await page.locator(".home-new-button").click();
  const modal = page.getByRole("dialog", { name: "New data", exact: true });
  await modal.getByRole("heading", { name: "Scope", exact: true }).waitFor();
  await modal.getByRole("heading", { name: "Expression", exact: true }).waitFor();
  const creationPath = modal.getByRole("navigation", { name: "Where you are", exact: true });
  assert.equal(await creationPath.getByText("Local", { exact: true }).count(), 1);
  assert.equal(await creationPath.getByText("All data", { exact: true }).count(), 1);
  assert.equal(await modal.getByText("Preparing expression…", { exact: true }).count(), 0);
  assert.equal(await modal.locator(".expr-graph-data-card").count(), 1);
  assert.equal(await modal.getByRole("button", { name: "Create", exact: true }).isDisabled(), true);
  assert.equal(await modal.getByRole("button", { name: "Close new data", exact: true }).isVisible(), true);
  assert.equal(await modal.getByRole("button", { name: "Cancel", exact: true }).count(), 0);
  assert.deepEqual(await page.evaluate(() => homeEntryContextFixture.state().actions), []);
  if (process.env["FENEL_HOME_ENTRY_CAPTURE_DIR"]) await page.screenshot({ path: join(process.env["FENEL_HOME_ENTRY_CAPTURE_DIR"]!, "new-expression-pending.png") });
  await page.evaluate(() => { homeEntryContextFixture.releaseRoot(); homeEntryContextFixture.ready(); });
  await page.locator("[data-workspace-handoff]").waitFor();
  assert.deepEqual(await page.evaluate(() => homeEntryContextFixture.state().actions), [
    { kind: "new:expression", expr: { kind: "literal", value: undefined } },
  ]);
  assert.equal(await modal.count(), 0);
}, "local-new-pending"));

test("canceling direct New prevents a late prepared reader from reopening its expression dialog", () => fixture(async page => {
  await page.waitForFunction(() => homeEntryContextFixture.state().rootReadsPending === 1);
  await page.locator(".home-new-button").click();
  await page.getByRole("dialog", { name: "New data", exact: true }).getByRole("button", { name: "Close new data", exact: true }).click();
  await page.evaluate(() => { homeEntryContextFixture.releaseRoot(); homeEntryContextFixture.ready(); });
  await page.locator("[data-workspace-handoff]").waitFor();
  assert.equal(await page.getByRole("dialog", { name: "New data", exact: true }).count(), 0);
  assert.equal(await page.evaluate(() => homeEntryContextFixture.state().actions.some(action => action === "new:expression"
    || typeof action === "object" && action?.kind === "new:expression")), false);
}, "local-new-pending"));

async function chooseHeldLocalData(page: Page) {
  await page.waitForFunction(() => homeEntryContextFixture.state().rootReadsPending === 1);
  await page.evaluate(() => homeEntryContextFixture.rootNew());
  await page.getByRole("button", { name: /^Create data/ }).click();
}
async function expectNoNewBranch(page: Page) {
  await page.locator("[data-workspace-handoff]").waitFor();
  assert.equal(await page.evaluate(() => homeEntryContextFixture.state().actions.some(action => action !== undefined)), false);
  assert.equal(await page.evaluate(() => homeEntryContextFixture.state().requests.some(request => /^(POST|PUT|DELETE) /.test(request))), false);
}

test("New can cancel a held root after tools are ready without claiming creation permission", () => fixture(async page => {
  await chooseHeldLocalData(page);
  await page.evaluate(() => homeEntryContextFixture.ready());
  const cancel = page.locator(".home-new-button");
  assert.equal(await cancel.isDisabled(), false);
  assert.equal(await cancel.getAttribute("data-tooltip"), null, "An enabled Cancel carries no disabled-New explanation");
  assert.deepEqual(await page.evaluate(() => homeEntryContextFixture.state().createVerdicts), [false]);
  await cancel.click();
  await page.evaluate(() => homeEntryContextFixture.releaseRoot());
  await expectNoNewBranch(page);
}, "local-new-pending"));

test("reopening and closing the kind selector retires a previously chosen held branch", () => fixture(async page => {
  await chooseHeldLocalData(page);
  await page.locator(".modal-overlay").waitFor({ state: "detached" });
  await page.evaluate(() => homeEntryContextFixture.rootNew());
  await page.getByRole("button", { name: "Close", exact: true }).click();
  await page.evaluate(() => { homeEntryContextFixture.releaseRoot(); homeEntryContextFixture.ready(); });
  await expectNoNewBranch(page);
}, "local-new-pending"));

test("focus changes away and back before preparation cannot replay an old New branch", () => fixture(async page => {
  await chooseHeldLocalData(page);
  await page.evaluate(() => homeEntryContextFixture.focus({ kind: "view", viewId: "changed-focus" }));
  await page.evaluate(() => homeEntryContextFixture.focus({ kind: "root" }));
  await page.evaluate(() => { homeEntryContextFixture.releaseRoot(); homeEntryContextFixture.ready(); });
  await expectNoNewBranch(page);
}, "local-new-pending"));

test("same-tick focus change and preparation completion cannot hand off an old New branch", () => fixture(async page => {
  await chooseHeldLocalData(page);
  await page.evaluate(() => {
    homeEntryContextFixture.focus({ kind: "view", viewId: "changed-focus" });
    homeEntryContextFixture.releaseRoot(); homeEntryContextFixture.ready();
  });
  await expectNoNewBranch(page);
}, "local-new-pending"));

test("a readonly temporary root response drops a held New branch before editor handoff", () => fixture(async page => {
  await chooseHeldLocalData(page);
  await page.evaluate(() => { homeEntryContextFixture.releaseRoot(false); homeEntryContextFixture.ready(); });
  await expectNoNewBranch(page);
}, "local-new-pending"));

test("source changes away and back cannot replay a held creation branch", () => fixture(async page => {
  await chooseHeldLocalData(page);
  await page.evaluate(() => homeEntryContextFixture.localSource({ $tag: "PublicSource" }));
  await page.evaluate(() => homeEntryContextFixture.localSource({ $tag: "ThisTabSource" }));
  await page.evaluate(() => { homeEntryContextFixture.releaseRoot(); homeEntryContextFixture.ready(); });
  await expectNoNewBranch(page);
}, "local-new-pending"));

test("a mismatched temporary root response cannot admit a creation branch", () => fixture(async page => {
  await chooseHeldLocalData(page);
  await page.evaluate(() => { homeEntryContextFixture.releaseRoot(true, "another-root"); homeEntryContextFixture.ready(); });
  await expectNoNewBranch(page);
}, "local-new-pending"));

test("a literal image opens Expression immediately and edits it in place without requesting tools", () => fixture(async page => {
  const before = !!process.env["FENEL_LITERAL_IMAGE_BASELINE"];
  await page.addStyleTag({ content: await readFile("distros/narthex/solid/src/lib/expression-runner/image-canvas.css", "utf8") });
  await page.evaluate(() => {
    homeEntryContextFixture.releaseRoot(true, "temporary-tab-fixture", [{ id: "pasted-image", source: { kind: "expr", expr: { kind: "literal", value: {
      width: 700, height: 1000, pixels: Array(700 * 1000).fill({ r: 100, g: 165, b: 210, a: 255 }),
    } } } }]);
    homeEntryContextFixture.focus({ kind: "value", viewId: "temporary-tab-fixture", itemId: "pasted-image", path: [], rootItem: true });
    homeEntryContextFixture.mode("both");
  });
  const panel = page.getByRole("region", { name: "Expression panel", exact: true });
  const source = page.locator("[data-expression-inspection]");
  await source.getByRole("img", { name: "700 × 1000 image", exact: true }).waitFor();
  const directory = process.env["FENEL_HOME_ENTRY_CAPTURE_DIR"];
  if (directory) await page.screenshot({ path: join(directory, `literal-image-${before ? "before" : "after"}-${process.env["FENEL_HOME_ENTRY_PHONE"] === "1" ? "phone" : "desktop"}.png`), fullPage: true });
  if (before) return;
  assert.equal((await page.evaluate(() => homeEntryContextFixture.state())).requested, 0, "Reading already-held literal data needs no complete local catalogue");
  assert.equal(await page.getByRole("status", { name: "Preparing editing tools…", exact: true }).count(), 0);
  const bounds = await panel.evaluate(element => ({ client: element.clientWidth, scroll: element.scrollWidth,
    overflow: [...element.querySelectorAll<HTMLElement>("*")].flatMap(child => {
      const frame = element.getBoundingClientRect(), box = child.getBoundingClientRect();
      return box.right > frame.right + 1 ? [{ class: child.className, width: box.width, right: box.right, scroll: child.scrollWidth }] : [];
    }) }));
  assert.ok(bounds.scroll <= bounds.client + 1, `The image expression has no horizontal overflow: ${JSON.stringify(bounds)}`);
  const actions = source.getByRole("button", { name: "Actions", exact: true });
  await actions.focus();
  await actions.press("Enter");
  await page.getByRole("menu", { name: "Expression actions", exact: true }).waitFor();
  assert.equal(await panel.evaluate(element => element.scrollWidth <= element.clientWidth + 1), true, "The retained expression actions fit the scroll boundary when focused");
  await page.keyboard.press("Escape");
  await page.evaluate(() => homeEntryContextFixture.failPreparation());
  assert.equal(await source.getByRole("img", { name: "700 × 1000 image", exact: true }).isVisible(), true);
  assert.equal(await page.getByRole("button", { name: "Error. Could not prepare expression editing. Open details.", exact: true }).count(), 0, "An unrelated tool failure does not hide already-present literal inspection");
  await page.evaluate(() => homeEntryContextFixture.ready());
  assert.equal(await page.locator("[data-workspace-handoff]").count(), 0, "Another completed reader does not replace requested literal inspection with editing");
  // Writable data is edited at once in the held lens: Edit opens its early
  // editor in place; tools are handed the draft only by Save or Continue.
  assert.equal(await page.getByRole("button", { name: "Edit expression", exact: true }).count(), 0);
  await editHeldData(page, source);
  await page.getByRole("dialog").first().waitFor();
  assert.equal(await page.locator("[data-workspace-handoff]").count(), 0);
  assert.equal((await page.evaluate(() => homeEntryContextFixture.state())).requested, 0);
}, "local-new-pending"));

test("a Local literal opened from its context menu stays passive after tools become ready", () => fixture(async page => {
  await page.evaluate(() => homeEntryContextFixture.releaseRoot(true, "temporary-tab-fixture", [{ id: "literal-data", source: { kind: "expr", expr: { kind: "literal", value: "Already present" } } }]));
  const card = page.locator('[data-locus-preview="literal-data"]');
  await card.getByText("Already present", { exact: true }).waitFor();
  await openCardExpression(page, card);
  const source = page.locator('[data-expression-early-editing="true"]');
  await source.getByText("Already present", { exact: true }).waitFor();
  assert.equal((await page.evaluate(() => homeEntryContextFixture.state())).requested, 0, "The context-menu event uses the committed destination and expression mode before deciding to prepare tools");
  await page.evaluate(() => homeEntryContextFixture.ready());
  assert.equal(await page.locator("[data-workspace-handoff]").count(), 0);
  await editHeldData(page, source);
  await page.getByRole("dialog").getByRole("textbox").first().fill("Changed");
  await page.getByRole("dialog").getByRole("button", { name: "Close argument", exact: true }).click();
  assert.equal(await page.locator("[data-workspace-handoff]").count(), 0, "An early draft stays in the held lens until it is handed over");
  await page.locator('[data-early-expression-draft="true"]').getByRole("button", { name: "Continue in full editor", exact: true }).click();
  await page.locator("[data-workspace-handoff]").waitFor();
  const action = (await page.evaluate(() => homeEntryContextFixture.state())).actions[0];
  assert.ok(typeof action === "object" && action.kind === "inspect-data");
  assert.deepEqual(action.draft, { baseline: { kind: "literal", value: "Already present" }, node: { kind: "literal", value: "Changed" }, commit: false });
  assert.equal(action.item.id, "literal-data");
  assert.deepEqual(action.scope, { kind: "value", viewId: "temporary-tab-fixture", itemId: "literal-data", path: [], rootItem: true });
}, "local-new-pending"));

// Early editing of a computed value: the held lens edits a draft over the same
// surfaces before the editing tools are ready.
const earlyCall = { kind: "call" as const, fnId: "std:words", args: [{ kind: "literal" as const, value: "the quick brown fox" }] };
async function openEarlyCall(page: Page) {
  await page.evaluate(call => {
    homeEntryContextFixture.releaseRoot(true, "temporary-tab-fixture", [{ id: "computed-data", source: { kind: "expr", expr: call } }]);
    homeEntryContextFixture.focus({ kind: "value", viewId: "temporary-tab-fixture", itemId: "computed-data", path: [], rootItem: true });
    homeEntryContextFixture.mode("expression");
  }, earlyCall);
  const source = page.locator('[data-expression-early-editing="true"]');
  await source.locator(".expr-call").first().waitFor();
  return source;
}
async function openEarlyCallMenu(page: Page, source: Locator) {
  const root = source.locator(".expr-call").first();
  await root.locator(":scope > .expr-call__head .expr-function-node__title-button").hover();
  await root.locator(":scope > .expr-call__head .corner-menu-button").click();
}

test("an early picker keeps its place and query when the editing tools become ready", () => fixture(async page => {
  const source = await openEarlyCall(page);
  await openEarlyCallMenu(page, source);
  await page.getByRole("menuitem", { name: "Add function", exact: true }).click();
  const picker = page.getByRole("dialog").locator('[data-function-picker="true"]');
  await picker.waitFor();
  await picker.locator(".expr-picker__input").fill("rev");
  await page.evaluate(() => homeEntryContextFixture.ready());
  await page.waitForTimeout(300);
  assert.equal(await page.locator("[data-workspace-handoff]").count(), 0, "An open early picker keeps the held lens");
  assert.equal(await picker.locator(".expr-picker__input").inputValue(), "rev", "The picker keeps its query");
  await page.keyboard.press("Escape");
  await page.locator("[data-workspace-handoff]").waitFor();
  assert.equal((await page.evaluate(() => homeEntryContextFixture.state())).actions.length, 1);
}, "local-new-pending"));

test("an early function list that cannot be read fails visibly and offers Retry", () => fixture(async page => {
  // Hold the lazy transport at its existing IO boundary. Serving HTML for
  // this module only tests an import failure and never constructs a worker;
  // worker timeout/message errors are covered by the transport's unit tests.
  await page.evaluate(() => { (globalThis as any).choicesReads = 0; });
  await page.route("**/authoring-catalogue-transport", route => route.fulfill({
    contentType: "text/javascript", body: `
      export function readRepositoryFunctionChoices() {
        globalThis.choicesReads++;
        return Promise.reject(new Error("fixture function-list failure"));
      }
    `,
  }));
  const source = await openEarlyCall(page);
  await openEarlyCallMenu(page, source);
  await page.getByRole("menuitem", { name: "Add function", exact: true }).click();
  const picker = page.getByRole("dialog").locator('[data-function-picker="true"]');
  await picker.getByRole("alert").filter({ hasText: "Could not read the function list." }).waitFor();
  assert.equal(await picker.getByRole("status").filter({ hasText: "Reading functions…" }).count(), 0);
  assert.equal(await page.evaluate(() => (globalThis as any).choicesReads), 1);
  await picker.getByRole("button", { name: "Retry", exact: true }).click();
  await page.waitForFunction(() => (globalThis as any).choicesReads === 2);
  await picker.getByRole("alert").filter({ hasText: "Could not read the function list." }).waitFor();
}, "local-new-pending"));

test("a changed early draft stays with its lens across lens switches and guards unload", () => fixture(async page => {
  const source = await openEarlyCall(page);
  await editHeldData(page, source);
  await page.getByRole("dialog").getByRole("textbox").first().fill("a changed draft");
  await page.getByRole("dialog").getByRole("button", { name: "Close argument", exact: true }).click();
  const controls = page.locator('[data-early-expression-draft="true"]');
  await controls.getByRole("button", { name: "Save", exact: true }).waitFor();
  const unloadGuarded = () => page.evaluate(() => {
    const event = new Event("beforeunload", { cancelable: true });
    window.dispatchEvent(event);
    return event.defaultPrevented;
  });
  assert.equal(await unloadGuarded(), true, "An unsaved early draft guards unload");
  await page.evaluate(() => { homeEntryContextFixture.mode("data"); homeEntryContextFixture.ready(); });
  await page.locator("[data-workspace-handoff]").waitFor();
  assert.equal(await unloadGuarded(), true, "The draft is still guarded while another lens shows the workspace");
  await page.evaluate(() => homeEntryContextFixture.mode("expression"));
  await controls.getByRole("button", { name: "Continue in full editor", exact: true }).waitFor();
  assert.equal(await page.locator('[data-expression-early-editing="true"]').getByText("a changed draft").count() > 0, true,
    "Returning to the expression lens shows the kept draft");
}, "local-new-pending"));

test("literal inspection retains New data and hands off its explicit creation request", () => fixture(async page => {
  await page.evaluate(() => {
    homeEntryContextFixture.releaseRoot(true, "temporary-tab-fixture", [{ id: "literal-data", source: { kind: "expr", expr: { kind: "literal", value: "Already present" } } }]);
    homeEntryContextFixture.focus({ kind: "value", viewId: "temporary-tab-fixture", itemId: "literal-data", path: [], rootItem: true });
    homeEntryContextFixture.mode("expression");
  });
  await page.locator('[data-expression-early-editing="true"]').getByText("Already present", { exact: true }).waitFor();
  assert.equal((await page.evaluate(() => homeEntryContextFixture.state())).requested, 0);
  await page.locator(".home-new-button").click();
  await page.getByRole("dialog", { name: "New data", exact: true }).waitFor();
  await page.evaluate(() => homeEntryContextFixture.ready());
  await page.locator("[data-workspace-handoff]").waitFor();
  assert.deepEqual((await page.evaluate(() => homeEntryContextFixture.state())).actions, [
    { kind: "new:expression", expr: { kind: "literal", value: undefined } },
  ]);
}, "local-new-pending"));

test("literal inspection still prepares Code through the existing reader", () => fixture(async page => {
  await page.evaluate(() => {
    homeEntryContextFixture.releaseRoot(true, "temporary-tab-fixture", [{ id: "literal-data", source: { kind: "expr", expr: { kind: "literal", value: "Already present" } } }]);
    homeEntryContextFixture.focus({ kind: "value", viewId: "temporary-tab-fixture", itemId: "literal-data", path: [], rootItem: true });
    homeEntryContextFixture.mode("expression");
  });
  await page.locator('[data-expression-early-editing="true"]').getByText("Already present", { exact: true }).waitFor();
  assert.equal((await page.evaluate(() => homeEntryContextFixture.state())).requested, 0);
  await page.evaluate(() => homeEntryContextFixture.mode("expression-code"));
  await page.locator('[aria-label="Code panel"]').getByRole("status").filter({ hasText: "Preparing Fenel code…" }).waitFor();
  assert.ok((await page.evaluate(() => homeEntryContextFixture.state())).requested > 0);
  await page.evaluate(() => homeEntryContextFixture.ready());
  await page.locator("[data-workspace-handoff]").waitFor();
}, "local-new-pending"));

test("held Graph reports preparation and hands its ready reader to prepared Home without a disposable capture", async () => {
  const root = await heldGraphRoot();
  await fixture(async page => {
    const before = !!process.env["FENEL_HOME_ENTRY_FIXTURE_BASELINE"];
    const source = await openHeldGraph(page, !before);
    if (!before) await page.getByRole("status", { name: "Preparing editing tools…", exact: true }).waitFor();
    const captureDirectory = process.env["FENEL_HOME_ENTRY_CAPTURE_DIR"];
    if (captureDirectory) await page.screenshot({ path: join(captureDirectory, `graph-reader-${before ? "before" : "after"}-preparing.png`), fullPage: true });
    if (before) return;
    await source.locator(".expr-function-node__title-button").first().hover();
    assert.deepEqual(await page.evaluate(() => homeEntryContextFixture.state().imports), []);
    await page.evaluate(() => homeEntryContextFixture.releaseGraphReader());
    await page.locator("[data-workspace-handoff]").waitFor();
    assert.equal(await page.getByRole("status", { name: "Preparing editing tools…", exact: true }).count(), 0);
    assert.equal(await page.locator("[data-expression-inspection]").count(), 0);
    let state = await page.evaluate(() => homeEntryContextFixture.state());
    assert.equal(state.actions.length, 1);
    assert.equal(state.inspectionMode, "expression");
    assert.equal(state.imports.includes("held-graph-evaluation"), false);
    await page.evaluate(() => homeEntryContextFixture.releaseGraphReader());
    await page.waitForFunction(() => homeEntryContextFixture.state().readerReleases === 2);
    state = await page.evaluate(() => homeEntryContextFixture.state());
    assert.equal(state.actions.length, 1, "A replacement runtime cannot replay a disposed held graph or remount prepared Home");
    assert.equal(state.imports.includes("held-graph-evaluation"), false);
  }, "graph-readiness", root);
});

test("held Graph stops reporting preparation on a real readiness failure and cannot resume after disposal", async () => {
  const root = await heldGraphRoot();
  await fixture(async page => {
    const source = await openHeldGraph(page);
    await page.getByRole("status", { name: "Preparing editing tools…", exact: true }).waitFor();
    await page.evaluate(() => homeEntryContextFixture.failPreparation());
    const error = page.getByRole("button", { name: "Error. Could not prepare expression editing. Open details.", exact: true });
    await error.waitFor();
    await error.click();
    await page.getByRole("dialog", { name: "Could not prepare expression editing.", exact: true }).waitFor();
    assert.equal(await page.getByRole("status", { name: "Preparing editing tools…", exact: true }).count(), 0);
    assert.equal(await source.getByRole("status").filter({ hasText: "Preparing data…" }).count(), 0);
    assert.equal(await page.locator("[data-workspace-handoff]").count(), 0);
    await page.evaluate(() => homeEntryContextFixture.dispose());
    await page.evaluate(() => homeEntryContextFixture.releaseGraphReader());
    assert.equal(await page.locator("[data-workspace-handoff]").count(), 0);
    assert.equal((await page.evaluate(() => homeEntryContextFixture.state().imports)).includes("held-graph-evaluation"), false);
  }, "graph-readiness-failed", root);
});

test("held Graph shows ordinary list circles before its reader and performs no evaluation on hover", async () => {
  const root = await heldGraphRoot(true);
  await fixture(async page => {
    const before = !!process.env["FENEL_HOME_ENTRY_FIXTURE_BASELINE"];
    const source = await openHeldGraph(page, !before);
    const directory = process.env["FENEL_HOME_ENTRY_CAPTURE_DIR"];
    if (!before) {
      const list = source.locator(".locus-previews");
      await list.getByText("2 items", { exact: true }).waitFor();
      await page.waitForFunction(() => document.querySelectorAll('[data-expression-inspection] .locus-previews__cell:not(.locus-previews__cell--more)').length === 2);
      assert.equal(await list.locator(".locus-previews__cell:not(.locus-previews__cell--more)").count(), 2);
      const width = await list.evaluate(element => {
        let parent = element.parentElement!;
        while (getComputedStyle(parent).display === "contents") parent = parent.parentElement!;
        return { strip: element.getBoundingClientRect().width, parent: parent.getBoundingClientRect().width };
      });
      assert.ok(Math.abs(width.strip - width.parent) < 1, "Collection previews keep the source card's available width");
      await list.locator(".locus-previews__cell:not(.locus-previews__cell--more)").first().hover();
      await page.locator("[data-value-preview-popup]").getByText("one", { exact: true }).waitFor();
      await page.mouse.move(980, 30);
      await page.locator("[data-value-preview-popup]").waitFor({ state: "detached" });
      assert.deepEqual(await page.evaluate(() => homeEntryContextFixture.state().imports), []);
    }
    if (directory) await page.screenshot({ path: join(directory, `graph-list-${before ? "before" : "after"}-reader.png`), fullPage: true });
  }, "graph-readiness-list", root);
});

test("held Graph requests every displayed function icon and retains scoped icons while new metadata loads", async () => {
  const root = await heldGraphRoot();
  const demo = root.items.find(item => item.id === "demo")!;
  root.items = [demo];
  root.lists = [];
  if (demo.source?.kind !== "expr" || demo.source.expr.kind !== "literal" || !demo.valueType || !("$record" in demo.valueType))
    throw new Error("Expected the existing typed demo record.");
  const record = demo.source.expr.value as { __record: { fields: Array<{ name: string; value: unknown }> } };
  record.__record.fields = record.__record.fields.filter(field => field.name === "Reversed words");
  demo.valueType = { $record: { ...demo.valueType.$record, fields: demo.valueType.$record.fields.filter(field => field.name === "Reversed words") } };
  await fixture(async page => {
    const before = !!process.env["FENEL_HOME_ENTRY_FIXTURE_BASELINE"];
    const source = await openHeldGraph(page, !before);
    const directory = process.env["FENEL_HOME_ENTRY_CAPTURE_DIR"];
    if (before) {
      await page.waitForFunction(() => homeEntryContextFixture.state().metadataTargets.some(targets => targets.includes("std:join")));
      await page.evaluate(() => homeEntryContextFixture.releaseMetadata());
      if (directory) await page.screenshot({ path: join(directory, "graph-scoped-function-icons-before.png"), fullPage: true });
      return;
    }
    await page.waitForFunction(() => ["std:join", "std:reverse", "std:words"].every(target =>
      homeEntryContextFixture.state().metadataTargets.some(targets => targets.includes(target))));
    await page.evaluate(() => homeEntryContextFixture.releaseMetadata());
    async function matchesSharedIcon(name: string, icon: string) {
      const functionIcon = source.locator(".expr-function-node__title-button").filter({ hasText: new RegExp(`^${name}$`) })
        .locator(".expr-function-node__icon svg");
      await functionIcon.waitFor({ state: "attached" });
      assert.deepEqual(await functionIcon.locator("path").evaluateAll(paths => paths.map(path => path.getAttribute("d"))),
        await page.locator(`[data-graph-reference-icons] [data-icon="${icon}"] svg path`).evaluateAll(paths => paths.map(path => path.getAttribute("d"))),
        `${name} uses its reader's Iconable projection through the existing icon renderer`);
    }
    await matchesSharedIcon("join", "link");
    await matchesSharedIcon("reverse", "repeat");
    await matchesSharedIcon("words", "list");
    if (directory) await page.screenshot({ path: join(directory, "graph-scoped-function-icons-after.png"), fullPage: true });
    await page.evaluate(() => homeEntryContextFixture.extendGraphExpression());
    await page.waitForFunction(() => homeEntryContextFixture.state().metadataTargets.some(targets => targets.includes("std:upper")));
    await matchesSharedIcon("join", "link");
    await matchesSharedIcon("reverse", "repeat");
    await matchesSharedIcon("words", "list");
    await page.evaluate(() => homeEntryContextFixture.releaseMetadata());
    await matchesSharedIcon("upper", "repeat");
    assert.deepEqual(await page.evaluate(() => homeEntryContextFixture.state().imports), []);
  }, "reader-graph-icons", root);
});

test("ready saved data is selectable while type and function reads remain held", () => fixture(async page => {
  const panel = await earlyBrowse(page);
  await page.waitForFunction(() => homeEntryContextFixture.state().browseReads.length === 3);
  await page.evaluate(() => homeEntryContextFixture.releaseBrowse("/api/saved-queries"));
  const baseline = process.env["FENEL_HOME_ENTRY_PROGRESSIVE_BASELINE"] === "1";
  if (baseline) await page.waitForTimeout(100);
  else await panel.getByRole("option").filter({ hasText: "Launch checklist" }).waitFor();
  const captureDirectory = process.env["FENEL_HOME_ENTRY_CAPTURE_DIR"];
  if (captureDirectory) await page.screenshot({ path: join(captureDirectory, "ready-saved-held-catalog.png"), fullPage: true });
  if (baseline) return;
  assert.equal(await panel.getByRole("option").count(), 2);
  assert.equal(await panel.getByText("Reading types…", { exact: true }).count(), 1);
  assert.equal(await panel.getByText("Reading functions…", { exact: true }).count(), 1);
  const input = panel.getByRole("combobox");
  await input.fill("launch-checklist");
  await input.press("Enter");
  await panel.getByRole("status").filter({ hasText: "Adding it" }).waitFor();
  await page.evaluate(() => homeEntryContextFixture.ready());
  await page.locator("[data-workspace-handoff]").waitFor();
  assert.deepEqual(await page.evaluate(() => homeEntryContextFixture.state().actions), [
    { kind: "pin", savedExprId: "launch-checklist", caption: "Launch checklist" },
  ]);
}, "browse-reader"));

test("ready function names appear on a phone while other Browse reads remain held", () => fixture(async page => {
  await page.setViewportSize({ width: 390, height: 844 });
  const panel = await earlyBrowse(page);
  await page.waitForFunction(() => homeEntryContextFixture.state().browseReads.length === 3);
  await page.evaluate(() => homeEntryContextFixture.releaseBrowse("/api/functions"));
  const baseline = process.env["FENEL_HOME_ENTRY_PROGRESSIVE_BASELINE"] === "1";
  if (baseline) await page.waitForTimeout(100);
  else await panel.getByRole("option").filter({ hasText: "calculateProfit" }).waitFor();
  const captureDirectory = process.env["FENEL_HOME_ENTRY_CAPTURE_DIR"];
  if (captureDirectory) await page.screenshot({ path: join(captureDirectory, "ready-functions-phone.png"), fullPage: true });
  if (baseline) return;
  assert.equal(await panel.getByRole("option").count(), 1);
  await panel.getByText("Reading saved data…", { exact: true }).waitFor();
  await panel.getByText("Reading types…", { exact: true }).waitFor();
  const input = panel.getByRole("combobox");
  await input.fill("receipts");
  await panel.getByRole("option").filter({ hasText: "calculateProfit" }).waitFor();
  await input.fill("no-such-function");
  await panel.getByRole("option").waitFor({ state: "detached" });
  await input.press("Enter");
  assert.deepEqual(await page.evaluate(() => homeEntryContextFixture.state().actions), []);
  const fits = await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth);
  assert.equal(fits, true);
}, "browse-reader"));

test("early Browse keeps its saved-row pick visible until the prepared reader takes it", () => fixture(async page => {
  const panel = await earlyBrowse(page);
  await browseLoaded(page);
  const captureDirectory = process.env["FENEL_HOME_ENTRY_CAPTURE_DIR"];
  if (captureDirectory) {
    await panel.getByRole("combobox").fill("launch-checklist");
    await panel.getByRole("option").filter({ hasText: "Launch checklist" }).waitFor();
    await page.screenshot({ path: join(captureDirectory, "saved-id.png"), fullPage: true });
    await panel.getByRole("combobox").fill("");
  }
  await panel.getByRole("option").filter({ hasText: "Launch checklist" }).click();
  await panel.getByRole("status").filter({ hasText: "Adding it" }).waitFor();
  if (captureDirectory) await page.screenshot({ path: join(captureDirectory, "saved-pick.png"), fullPage: true });
  const pending = await page.evaluate(() => homeEntryContextFixture.state());
  assert.equal(pending.ready, false);
  assert.deepEqual(pending.actions, []);
  assert.deepEqual(pending.imports, []);
  assert.equal(await page.locator("[data-workspace-handoff]").count(), 0);
  await page.evaluate(() => homeEntryContextFixture.ready());
  await page.locator("[data-workspace-handoff]").waitFor();
  assert.deepEqual(await page.evaluate(() => homeEntryContextFixture.state().actions), [
    { kind: "pin", savedExprId: "launch-checklist", caption: "Launch checklist" },
  ]);
}, "browse-reader"));

for (const gesture of ["arrow", "keyboard"] as const) test(`early Browse saved Open ${gesture} retains its editor intent without leaving the reader`, () => fixture(async page => {
  const originalUrl = page.url();
  const panel = await earlyBrowse(page);
  await browseLoaded(page);
  await panel.getByRole("combobox").fill("launch-checklist");
  const open = panel.getByRole("button", { name: "Open Launch checklist", exact: true });
  await open.waitFor();
  if (gesture === "arrow") await open.click();
  else await panel.getByRole("combobox").press("Control+Enter");
  await panel.waitFor({ state: "detached" });
  await page.locator(".locus-notifications__bell").click();
  await page.getByRole("status").filter({ hasText: "Opening saved data…" }).waitFor();
  assert.equal(page.url(), originalUrl, "Saved Open must not navigate to a deprecated account route");
  assert.equal(await page.evaluate(() => homeEntryContextFixture.state().ready), false);
  assert.deepEqual(await page.evaluate(() => homeEntryContextFixture.state().actions), []);
  await page.evaluate(() => homeEntryContextFixture.ready());
  await page.locator("[data-workspace-handoff]").waitFor();
  assert.deepEqual(await page.evaluate(() => homeEntryContextFixture.state().actions), [
    { kind: "open-saved", savedExprId: "launch-checklist", caption: "Launch checklist" },
  ]);
  await page.evaluate(() => homeEntryContextFixture.ready());
  assert.equal((await page.evaluate(() => homeEntryContextFixture.state().actions)).length, 1);
  assert.equal(page.url(), originalUrl);
}, "browse-reader"));

test("early Browse saved Open replacement keeps only the latest selected row", () => fixture(async page => {
  const panel = await earlyBrowse(page);
  await browseLoaded(page);
  await panel.getByRole("button", { name: "Open Launch checklist", exact: true }).click();
  await panel.waitFor({ state: "detached" });
  const replacement = await earlyBrowse(page);
  await replacement.getByRole("button", { name: "Open Revenue report", exact: true }).click();
  await page.evaluate(() => homeEntryContextFixture.ready());
  await page.locator("[data-workspace-handoff]").waitFor();
  assert.deepEqual(await page.evaluate(() => homeEntryContextFixture.state().actions), [
    { kind: "open-saved", savedExprId: "revenue-report", caption: "Revenue report" },
  ]);
}, "browse-reader"));

test("early Browse saved Open cancellation prevents a late reader from opening the editor", () => fixture(async page => {
  const panel = await earlyBrowse(page);
  await browseLoaded(page);
  await panel.getByRole("button", { name: "Open Launch checklist", exact: true }).click();
  await page.locator(".locus-notifications__bell").click();
  await page.getByRole("status").filter({ hasText: "Opening saved data…" }).waitFor();
  await page.getByRole("button", { name: "Cancel", exact: true }).click();
  await page.evaluate(() => homeEntryContextFixture.ready());
  // The ordinary prepared Home may mount; the cancelled editor intent must not.
  await page.locator("[data-workspace-handoff]").waitFor();
  assert.deepEqual(await page.evaluate(() => homeEntryContextFixture.state().actions), [undefined]);
}, "browse-reader"));

test("early Browse saved Open cannot cross a session replacement", () => fixture(async page => {
  const panel = await earlyBrowse(page);
  await browseLoaded(page);
  await panel.getByRole("button", { name: "Open Launch checklist", exact: true }).click();
  await panel.waitFor({ state: "detached" });
  await page.evaluate(() => { homeEntryContextFixture.session("other-account"); homeEntryContextFixture.ready(); });
  assert.deepEqual(await page.evaluate(() => homeEntryContextFixture.state().actions), []);
  assert.equal(await page.locator("[data-workspace-handoff]").count(), 0);
}, "browse"));

test("early Browse paints and accepts a query while its current reader's catalog reads wait", () => fixture(async page => {
  const panel = await earlyBrowse(page);
  const input = panel.getByRole("combobox");
  assert.equal(await input.evaluate(element => element === document.activeElement), true);
  await input.fill("monthly");
  assert.equal(await input.inputValue(), "monthly");
  await panel.locator(".home-drawer__section--pending").filter({ hasText: /Reading/ }).first().waitFor();
  await page.waitForFunction(() => homeEntryContextFixture.state().browseReads.length === 3);
  const pending = await page.evaluate(() => homeEntryContextFixture.state());
  assert.deepEqual(pending.requests.filter(request => request !== "POST /api/reader-metadata"),
    ["GET /api/locus-root", "GET /api/saved-queries", "GET /api/types", "GET /api/functions"]);
  assert.ok(pending.requests.filter(request => request === "POST /api/reader-metadata").length <= 1, "Only the optional root type projection precedes the catalog reads");
  assert.ok(pending.readerHeaders.every(account => account === "sibling-reader"));
  assert.ok(pending.accountHeaders.every(account => account === null));
  assert.deepEqual(pending.imports, []);
  assert.deepEqual(pending.actions, []);
  await page.evaluate(() => homeEntryContextFixture.releaseBrowse("/api/types"));
  await input.fill("receipts");
  assert.equal(await input.inputValue(), "receipts");
  await page.evaluate(() => homeEntryContextFixture.releaseBrowse());
  await panel.getByRole("option").filter({ hasText: "calculateProfit" }).waitFor();
  assert.equal(await panel.getByRole("option").count(), 1);
  await panel.getByText("Loading the rest of the catalog…", { exact: true }).waitFor();
  assert.equal(await page.evaluate(() => homeEntryContextFixture.state().ready), false);
}, "browse-reader"));

test("early Browse filters saved data and catalog by label, description and exact target code", () => fixture(async page => {
  const panel = await earlyBrowse(page);
  await browseLoaded(page);
  const options = panel.getByRole("option");
  assert.equal(await options.count(), 4);
  assert.equal(await panel.getByText(/^Excluded /).count(), 0);
  const input = panel.getByRole("combobox");
  const cases = [
    ["  LAUNCH  ", "Launch checklist"],
    ["September", "Launch checklist"],
    ["launch-checklist", "Launch checklist"],
    ["customer", "Customer orders"],
    ["dispatch", "Customer orders"],
    ["SalesOrderCode", "Customer orders"],
    ["calculateProfit", "calculateProfit"],
    ["receipts", "calculateProfit"],
  ];
  for (const [query, expected] of cases) {
    await input.fill(query!);
    await page.waitForFunction(expected => {
      const names = Array.from(document.querySelectorAll('.home-drawer [role="option"] .home-drawer__item-name')).map(element => element.textContent);
      return names.length === 1 && names[0] === expected;
    }, expected!);
  }
  await input.fill("no-such-data");
  await page.waitForFunction(() => document.querySelectorAll('.home-drawer [role="option"]').length === 0);
  await input.press("Enter");
  assert.deepEqual(await page.evaluate(() => homeEntryContextFixture.state().actions), []);
  assert.equal(await panel.getByRole("status").count(), 0);
  await input.fill("");
  await page.waitForFunction(() => document.querySelectorAll('.home-drawer [role="option"]').length === 4);
  assert.deepEqual(await page.evaluate(() => homeEntryContextFixture.state().imports), []);
}, "browse-reader"));

test("early Browse rapid query replacement clears the old highlight and takes only a visible row", () => fixture(async page => {
  const panel = await earlyBrowse(page);
  await browseLoaded(page);
  const input = panel.getByRole("combobox");
  await input.press("ArrowUp");
  assert.equal(await panel.getByRole("option", { selected: true }).locator(".home-drawer__item-name").innerText(), "calculateProfit");
  await input.evaluate(element => {
    const input = element as HTMLInputElement;
    for (const query of ["calculateProfit", "customer", "revenue"]) {
      input.value = query;
      input.dispatchEvent(new Event("input", { bubbles: true }));
    }
  });
  await panel.getByRole("option").filter({ hasText: "Revenue report" }).waitFor();
  assert.equal(await panel.getByRole("option").count(), 1);
  assert.equal(await input.getAttribute("aria-activedescendant"), null);
  await input.press("Enter");
  await panel.getByRole("status").filter({ hasText: "Adding it" }).waitFor();
  assert.deepEqual(await page.evaluate(() => homeEntryContextFixture.state().actions), []);
  await page.evaluate(() => homeEntryContextFixture.ready());
  await page.locator("[data-workspace-handoff]").waitFor();
  assert.deepEqual(await page.evaluate(() => homeEntryContextFixture.state().actions), [
    { kind: "pin", savedExprId: "revenue-report", caption: "Revenue report" },
  ]);
}, "browse-reader"));

test("early Browse catalog selection preserves the exact pin until tools are ready", () => fixture(async page => {
  const panel = await earlyBrowse(page);
  await browseLoaded(page);
  await panel.getByRole("combobox").fill("SalesOrderCode");
  await panel.getByRole("option").filter({ hasText: "Customer orders" }).click();
  await panel.getByRole("status").filter({ hasText: "Adding it" }).waitFor();
  assert.deepEqual(await page.evaluate(() => homeEntryContextFixture.state().imports), []);
  assert.deepEqual(await page.evaluate(() => homeEntryContextFixture.state().actions), []);
  await page.evaluate(() => homeEntryContextFixture.ready());
  await page.locator("[data-workspace-handoff]").waitFor();
  assert.deepEqual(await page.evaluate(() => homeEntryContextFixture.state().actions), [
    { kind: "pin", pin: { kind: "entity", routeId: "entity:SalesOrderCode" }, caption: "Customer orders" },
  ]);
}, "browse-reader"));

test("early Browse refuses late results from the previous session and reads the new account", () => fixture(async page => {
  let panel = await earlyBrowse(page);
  await page.waitForFunction(() => homeEntryContextFixture.state().browseReads.length === 3);
  await page.evaluate(() => homeEntryContextFixture.session("other-account"));
  await panel.waitFor({ state: "detached" });
  panel = await earlyBrowse(page);
  await page.waitForFunction(() => homeEntryContextFixture.state().browseReads.filter(read => read.account === "other-account").length === 3);
  await page.evaluate(() => homeEntryContextFixture.releaseBrowse(undefined, "home-entry-context-fixture"));
  assert.equal(await panel.getByRole("option").count(), 0);
  assert.equal(await page.getByText("Launch checklist", { exact: true }).count(), 0);
  await page.evaluate(() => homeEntryContextFixture.releaseBrowse(undefined, "other-account"));
  await panel.getByRole("option").filter({ hasText: "Account two notebook" }).waitFor();
  assert.equal(await panel.getByRole("option").count(), 3);
  assert.equal(await page.getByText("Launch checklist", { exact: true }).count(), 0);
  const state = await page.evaluate(() => homeEntryContextFixture.state());
  for (let index = 0; index < state.requests.length; index++) {
    assert.equal(state.readerHeaders[index], null);
    assert.ok(["home-entry-context-fixture", "other-account"].includes(state.accountHeaders[index]!));
  }
  assert.deepEqual(state.imports, []);
}, "browse"));

test("early Browse cannot publish held data after its reader closes or issue fresh reads", () => fixture(async page => {
  const panel = await earlyBrowse(page);
  await page.waitForFunction(() => homeEntryContextFixture.state().browseReads.length === 3);
  const before = await page.evaluate(() => homeEntryContextFixture.state().requests);
  await page.evaluate(() => homeEntryContextFixture.closeReader());
  await page.evaluate(() => homeEntryContextFixture.releaseBrowse());
  await panel.getByText("Loading the rest of the catalog…", { exact: true }).waitFor();
  assert.equal(await panel.getByRole("option").count(), 0);
  assert.deepEqual(await page.evaluate(() => homeEntryContextFixture.probeReader()), ["rejected", "rejected"]);
  assert.deepEqual(await page.evaluate(() => homeEntryContextFixture.state().requests), before);
  assert.deepEqual(await page.evaluate(() => homeEntryContextFixture.state().imports), []);
}, "browse-reader"));

test("early Browse removes completed account rows while a replacement session's reads wait", () => fixture(async page => {
  let panel = await earlyBrowse(page);
  await browseLoaded(page);
  assert.equal(await panel.getByRole("option").count(), 4);
  await page.evaluate(() => homeEntryContextFixture.session("other-account"));
  await panel.waitFor({ state: "detached" });
  const captureDirectory = process.env["FENEL_HOME_ENTRY_CAPTURE_DIR"];
  if (captureDirectory) await page.screenshot({ path: join(captureDirectory, "session-transition.png"), fullPage: true });
  panel = await earlyBrowse(page);
  assert.equal(await panel.getByRole("combobox").inputValue(), "");
  await page.waitForFunction(() => homeEntryContextFixture.state().browseReads.filter(read => read.account === "other-account").length === 3);
  assert.equal(await panel.getByRole("option").filter({ hasText: "Launch checklist" }).count(), 0);
  assert.equal(await panel.getByRole("option").filter({ hasText: "Customer orders" }).count(), 0);
  assert.equal(await panel.getByRole("option").filter({ hasText: "calculateProfit" }).count(), 0);
  await page.evaluate(() => homeEntryContextFixture.releaseBrowse(undefined, "other-account"));
  await panel.getByRole("option").filter({ hasText: "Account two notebook" }).waitFor();
  assert.equal(await panel.getByRole("option").count(), 3);
}, "browse"));

test("early Browse hands its current query to the prepared reader when tools become ready", () => fixture(async page => {
  const panel = await earlyBrowse(page);
  await browseLoaded(page);
  await panel.getByRole("combobox").fill("calculateProfit");
  await page.evaluate(() => homeEntryContextFixture.ready());
  await page.locator("[data-workspace-handoff]").waitFor();
  assert.deepEqual(await page.evaluate(() => homeEntryContextFixture.state().actions), [
    { kind: "browse", query: "calculateProfit" },
  ]);
  assert.deepEqual(await page.evaluate(() => homeEntryContextFixture.state().imports), []);
}, "browse-reader"));

const checkedNumber = (value = 15): ValueSuggestion => ({ id: "Number", typeName: "Number", label: "Number",
  type: numberType, detail: String(value), score: 1, status: "complete", value });

test("early core choices start only after input and refuse incomplete or stale responses", () => fixture(async page => {
  const panel = await earlyBrowse(page);
  const input = panel.getByRole("combobox");
  assert.deepEqual(await page.evaluate(() => homeEntryContextFixture.state().coreWorkers), []);
  await input.fill("15/");
  await page.waitForFunction(() => homeEntryContextFixture.state().coreRequests.length === 1);
  const partial: ValueSuggestion = { id: "date:eu", typeName: "Date", label: "Date · DD/MM/YYYY", type: { $ref: "Date" },
    detail: "Keep typing · DD/MM/YYYY", score: 1, status: "partial" };
  await page.evaluate(row => homeEntryContextFixture.releaseCore(0, [row]), partial);
  const incomplete = panel.getByRole("option").filter({ hasText: "Date · DD/MM/YYYY" });
  await incomplete.waitFor();
  assert.equal(await incomplete.getAttribute("aria-disabled"), "true");
  await input.press("Enter");
  assert.deepEqual(await page.evaluate(() => homeEntryContextFixture.state().actions), []);
  await input.fill("15");
  await page.waitForFunction(() => homeEntryContextFixture.state().coreRequests.length === 2);
  await page.evaluate(row => homeEntryContextFixture.releaseCore(0, [row]), partial);
  assert.equal(await incomplete.count(), 0);
  await page.evaluate(row => homeEntryContextFixture.releaseCore(1, [row]), checkedNumber());
  await panel.getByRole("option").filter({ hasText: "Number" }).waitFor();
  assert.equal(await page.evaluate(() => homeEntryContextFixture.state().coreWorkers.length), 1);
  assert.deepEqual(await page.evaluate(() => homeEntryContextFixture.state().imports), []);
}, "browse-reader"));

test("early checked core choices carry their exact type and parsed value into the existing composer", () => fixture(async page => {
  const panel = await earlyBrowse(page);
  await panel.getByRole("combobox").fill("15");
  await page.waitForFunction(() => homeEntryContextFixture.state().coreRequests.length === 1);
  await page.evaluate(row => homeEntryContextFixture.releaseCore(0, [row]), checkedNumber());
  await panel.getByRole("option").filter({ hasText: "Number" }).click();
  await panel.getByRole("status").filter({ hasText: "Adding it" }).waitFor();
  assert.deepEqual(await page.evaluate(() => homeEntryContextFixture.state().actions), []);
  await page.evaluate(() => homeEntryContextFixture.ready());
  await page.locator("[data-workspace-handoff]").waitFor();
  assert.deepEqual(await page.evaluate(() => homeEntryContextFixture.state().actions), [
    { kind: "new:value", typeName: "Number", preset: { type: numberType, value: 15 } },
  ]);
  assert.deepEqual(await page.evaluate(() => homeEntryContextFixture.state().coreWorkers), [{ terminated: false }]);
}, "browse-reader"));

test("Browse close and reopen reuse the reader-owned authoring realm", () => fixture(async page => {
  let panel = await earlyBrowse(page);
  await panel.getByRole("combobox").fill("15");
  await page.waitForFunction(() => homeEntryContextFixture.state().coreRequests.length === 1);
  await page.evaluate(row => homeEntryContextFixture.releaseCore(0, [row]), checkedNumber());
  await panel.getByRole("option").filter({ hasText: "Number" }).waitFor();
  await panel.locator('button[data-tooltip="Close"]').click();
  await panel.waitFor({ state: "detached" });
  assert.deepEqual(await page.evaluate(() => homeEntryContextFixture.state().coreWorkers), [{ terminated: false }]);
  panel = await earlyBrowse(page);
  await panel.getByRole("combobox").fill("16");
  await page.waitForFunction(() => homeEntryContextFixture.state().coreRequests.at(-1)?.input === "16");
  await page.evaluate(row => {
    const state = homeEntryContextFixture.state();
    homeEntryContextFixture.releaseCore(state.coreRequests.length - 1, [row]);
  }, checkedNumber(16));
  await panel.getByRole("option").filter({ hasText: "Number" }).waitFor();
  assert.equal(await page.evaluate(() => homeEntryContextFixture.state().coreWorkers.length), 1);
  await page.evaluate(() => homeEntryContextFixture.closeReader());
  assert.deepEqual(await page.evaluate(() => homeEntryContextFixture.state().coreWorkers), [{ terminated: true }]);
}, "browse-reader"));

test("closing a reader removes core choices and refuses stale replies or fresh queries", () => fixture(async page => {
  const panel = await earlyBrowse(page);
  const input = panel.getByRole("combobox");
  await input.fill("15");
  await page.waitForFunction(() => homeEntryContextFixture.state().coreRequests.length === 1);
  await page.evaluate(row => homeEntryContextFixture.releaseCore(0, [row]), checkedNumber());
  await panel.getByRole("option").filter({ hasText: "Number" }).waitFor();
  await page.evaluate(() => homeEntryContextFixture.closeReader());
  await panel.getByRole("option").waitFor({ state: "detached" });
  await page.evaluate(row => homeEntryContextFixture.releaseCore(0, [row]), checkedNumber());
  await input.fill("16");
  await input.press("Enter");
  const state = await page.evaluate(() => homeEntryContextFixture.state());
  assert.equal(await panel.getByRole("option").count(), 0);
  assert.equal(state.coreRequests.length, 1);
  assert.deepEqual(state.coreWorkers, [{ terminated: true }]);
  assert.deepEqual(state.actions, []);
}, "browse-reader"));

test("session replacement terminates the core owner and cannot republish its pending choice", () => fixture(async page => {
  let panel = await earlyBrowse(page);
  await panel.getByRole("combobox").fill("15");
  await page.waitForFunction(() => homeEntryContextFixture.state().coreRequests.length === 1);
  await page.evaluate(() => homeEntryContextFixture.session("other-account"));
  await panel.waitFor({ state: "detached" });
  await page.evaluate(row => homeEntryContextFixture.releaseCore(0, [row]), checkedNumber());
  panel = await earlyBrowse(page);
  assert.equal(await panel.getByRole("combobox").inputValue(), "");
  assert.equal(await panel.getByRole("option").count(), 0);
  assert.deepEqual(await page.evaluate(() => homeEntryContextFixture.state().coreWorkers), [{ terminated: true }]);
}, "browse"));

test("early Browse refreshes summary metadata after the existing types and functions invalidation", () => fixture(async page => {
  const panel = await earlyBrowse(page);
  await browseLoaded(page);
  await page.evaluate(() => homeEntryContextFixture.refreshCatalog());
  await page.waitForFunction(() => ["/api/types", "/api/functions"]
    .every(path => homeEntryContextFixture.state().browseReads.some(read => read.path === path)));
  await page.evaluate(() => homeEntryContextFixture.releaseBrowse());
  await panel.getByRole("option").filter({ hasText: "Updated customer orders" }).waitFor();
  await panel.getByRole("option").filter({ hasText: "Updated margin description" }).waitFor();
  const state = await page.evaluate(() => homeEntryContextFixture.state());
  assert.equal(state.requests.filter(request => request === "GET /api/types").length, 2);
  assert.equal(state.requests.filter(request => request === "GET /api/functions").length, 2);
  assert.equal(state.readerHeaders.every(account => account === "sibling-reader"), true);
  assert.deepEqual(state.imports, []);
}, "browse-reader"));

test("an account reader previews received values before tools and shares its root with the full view", () => fixture(async page => {
  await page.getByText("Already available", { exact: true }).waitFor();
  assert.equal(await page.locator('[data-locus-preview="computed"] .home-item__caption').innerText(), "A computed value");
  await page.locator('[data-locus-preview="computed"]').getByRole("status", { name: "Preparing data reader…", exact: true }).waitFor();
  const pending = page.locator('[data-locus-preview="computed"]');
  assert.equal(await pending.getAttribute("aria-busy"), "true");
  assert.equal(await pending.evaluate(element => getComputedStyle(element).borderStyle), "dashed");
  const center = await pending.locator(".home-item__body").boundingBox();
  const spinner = await pending.locator(".home-item__loading").boundingBox();
  assert.ok(center && spinner);
  assert.ok(Math.abs(center.x + center.width / 2 - spinner.x - spinner.width / 2) < 2);
  assert.ok(Math.abs(center.y + center.height / 2 - spinner.y - spinner.height / 2) < 2);
  assert.equal(await page.locator('[data-locus-preview="computed"] .home-item__type-label').innerText(), "Anything");
  const list = page.locator('[data-locus-preview="known-list"]');
  assert.equal(await list.locator(".home-item__type-tag").innerText(), "List");
  assert.equal(await list.locator(".home-item__type-icon svg").count(), 1);
  assert.equal(await list.locator(".locus-previews__count").innerText(), "1 item");
  assert.equal(await list.locator(".locus-previews__content").innerText(), "");
  assert.equal(await list.locator("[data-thumbnail-icon]").getAttribute("data-thumbnail-icon"), "package");
  assert.equal(await list.getByRole("button", { name: "Show Fenel code", exact: true }).count(), 0);
  assert.equal(await list.getByRole("button", { name: "Open expression", exact: true }).count(), 0);
  assert.equal(await list.getByRole("button", { name: "Actions", exact: true }).isDisabled(), false);
  assert.equal(await list.getByRole("button", { name: "Expand in a new lens", exact: true }).count(), 0);
  assert.equal(await list.getByRole("status").count(), 0);
  assert.equal(await page.locator('[data-locus-preview="empty-list"] .locus-previews__count').innerText(), "",
    "Empty data stays quiet; the saved empty collection still has its card and actions");
  assert.equal(await page.getByText("11111111-1111-4111-8111-111111111111", { exact: false }).count(), 0);
  assert.equal(await page.locator(".account-data-switcher").count(), 0);
  const first = await page.evaluate(() => homeEntryContextFixture.state());
  assert.deepEqual(first.requests, ["GET /api/locus-root", "GET /api/saved-queries", "POST /api/reader-metadata"]);
  assert.deepEqual(first.readerHeaders, ["sibling-reader", "sibling-reader", "sibling-reader"]);
  assert.deepEqual(first.imports, []);
  await page.evaluate(() => homeEntryContextFixture.ready());
  await page.locator("[data-workspace-handoff]").waitFor();
  const final = await page.evaluate(() => homeEntryContextFixture.state());
  assert.deepEqual(final.requests, first.requests);
  assert.deepEqual(final.imports, []);
}, "reader"));

test("early circle thumbnails use scoped projection without starting tools and retain local Iconable over type", () => fixture(async page => {
  const cells = page.locator('[data-locus-preview="known-list"] .locus-previews__content');
  await cells.nth(2).locator("canvas").waitFor();
  assert.equal(await cells.nth(0).locator("[data-thumbnail-icon]").getAttribute("data-thumbnail-icon"), "type-set");
  assert.equal(await cells.nth(1).locator("[data-thumbnail-icon]").getAttribute("data-thumbnail-icon"), "bot");
  assert.equal(await cells.nth(2).locator("[data-thumbnail-icon]").count(), 0);
  await page.waitForFunction(() => homeEntryContextFixture.state().requests.includes("POST /api/reader-metadata"));
  await page.evaluate(() => homeEntryContextFixture.releaseMetadata());
  await page.waitForFunction(() => document.querySelector('[data-locus-preview="known-list"] [data-thumbnail-icon]')?.getAttribute("data-thumbnail-icon") === "type");
  assert.equal(await cells.nth(1).locator("[data-thumbnail-icon]").getAttribute("data-thumbnail-icon"), "bot");
  for (const cell of await cells.all()) assert.equal(await cell.innerText(), "");
  const state = await page.evaluate(() => homeEntryContextFixture.state());
  assert.deepEqual(state.imports, []);
  assert.ok(state.readerHeaders.every(account => account === "sibling-reader"));
}, "reader-thumbnails"));

test("the ellipsis enters its full list or record in the current lens before tools prepare", () => fixture(async page => {
  const list = page.locator('[data-locus-preview="known-list"]');
  await list.getByRole("button", { name: /\d+ more items/ }).click();
  await page.waitForFunction(() => homeEntryContextFixture.state().focus.kind === "view");
  assert.deepEqual((await page.evaluate(() => homeEntryContextFixture.state())).focus, { kind: "view", viewId: "known-list" });
  await page.evaluate(() => homeEntryContextFixture.focus({ kind: "root" }));
  const record = page.locator('[data-locus-preview="more-record"]');
  await record.getByRole("button", { name: /\d+ more items/ }).click();
  await page.waitForFunction(() => homeEntryContextFixture.state().focus.kind === "value");
  const state = await page.evaluate(() => homeEntryContextFixture.state());
  assert.deepEqual(state.focus, { kind: "value", viewId: "sibling-reader", itemId: "more-record", path: [], rootItem: true });
  assert.deepEqual(state.openedLenses, []);
  assert.deepEqual(state.imports, []);
  assert.equal(await page.getByRole("dialog").count(), 0);
}, "reader-more"));

test("early thumbnail metadata from a closed reader cannot reappear after disposal", () => fixture(async page => {
  await page.waitForFunction(() => homeEntryContextFixture.state().requests.includes("POST /api/reader-metadata"));
  await page.evaluate(() => homeEntryContextFixture.closeReader());
  await page.evaluate(() => homeEntryContextFixture.releaseMetadata());
  assert.equal(await page.locator('[data-thumbnail-icon="type"], [data-thumbnail-icon="star"]').count(), 0);
  assert.deepEqual(await page.evaluate(() => homeEntryContextFixture.state().imports), []);
}, "reader-thumbnails"));

test("early labels and icons preserve scoped facts, local occurrence precedence and authoritative misses", () => fixture(async page => {
  const list = page.locator('[data-locus-preview="known-list"]');
  await list.getByRole("button", { name: "Open this data: avg", exact: true }).waitFor();
  await list.getByRole("button", { name: "Open this data: My XOR", exact: true }).waitFor();
  await page.waitForFunction(() => homeEntryContextFixture.state().requests.includes("POST /api/reader-metadata"));
  await page.evaluate(() => homeEntryContextFixture.releaseMetadata());
  const average = list.getByRole("button", { name: "Open this data: Average", exact: true });
  await average.waitFor();
  assert.equal(await average.locator("[data-thumbnail-icon]").getAttribute("data-thumbnail-icon"), "user");
  const local = list.getByRole("button", { name: "Open this data: My XOR", exact: true });
  assert.equal(await local.locator("[data-thumbnail-icon]").getAttribute("data-thumbnail-icon"), "bot");
  const missing = list.getByRole("button", { name: "Open this data: missing", exact: true });
  assert.equal(await missing.locator("[data-thumbnail-icon]").getAttribute("data-thumbnail-icon"), "package");
  await average.hover();
  const popup = page.locator("[data-value-preview-popup]");
  await popup.getByText("Average", { exact: true }).waitFor();
  assert.equal(await popup.getByText("Average", { exact: true }).count(), 1);
  assert.equal(await popup.getByText("avg", { exact: true }).count(), 0);
  assert.equal(await popup.locator('.home-item__type-label').innerText(), "Function");
  assert.deepEqual(await popup.locator('.home-item__value-icon svg path').evaluateAll(paths => paths.map(path => path.getAttribute("d"))),
    await average.locator('[data-thumbnail-icon] svg path').evaluateAll(paths => paths.map(path => path.getAttribute("d"))),
    "The data's caption uses the same scoped value icon as its thumbnail");
  await page.mouse.move(5, 5);
  await local.hover();
  await popup.getByText("My XOR", { exact: true }).waitFor();
  assert.equal(await popup.getByText("Bitwise XOR", { exact: true }).count(), 0);
  assert.equal(await popup.locator('.home-item__type-label').innerText(), "Function");
  assert.deepEqual(await popup.locator('.home-item__value-icon svg path').evaluateAll(paths => paths.map(path => path.getAttribute("d"))),
    await local.locator('[data-thumbnail-icon] svg path').evaluateAll(paths => paths.map(path => path.getAttribute("d"))),
    "An occurrence icon remains distinct from the callable type icon");
  const state = await page.evaluate(() => homeEntryContextFixture.state());
  assert.deepEqual(state.imports, []);
  assert.ok(state.readerHeaders.every(account => account === "sibling-reader"));
}, "reader-labels"));

test("a disposed early reader cannot display a delayed label projection", () => fixture(async page => {
  await page.waitForFunction(() => homeEntryContextFixture.state().requests.includes("POST /api/reader-metadata"));
  await page.evaluate(() => homeEntryContextFixture.closeReader());
  await page.evaluate(() => homeEntryContextFixture.releaseMetadata());
  assert.equal(await page.getByText("Average", { exact: true }).count(), 0);
  assert.equal(await page.getByRole("button", { name: "Open this data: Average", exact: true }).count(), 0);
  assert.deepEqual(await page.evaluate(() => homeEntryContextFixture.state().imports), []);
}, "reader-labels"));

test("Loading glass keeps one spinner inside its active stage circle and preserves completed ticks", () => fixture(async page => {
  const card = page.locator(".workspace-startup__card");
  await card.getByText("Loading...", { exact: true }).waitFor();
  assert.equal(await card.locator(".workspace-startup__title .home-new-button__spinner").count(), 0);
  for (const stage of [0, 1, 2]) {
    await page.evaluate(stage => homeEntryContextFixture.loadingStage(stage as 0 | 1 | 2), stage);
    await page.waitForFunction(stage => document.querySelectorAll('.workspace-startup__step[data-state="complete"]').length === stage, stage);
    const current = card.locator('.workspace-startup__step[data-state="current"]');
    assert.equal(await current.getAttribute("aria-current"), "step");
    assert.equal(await current.locator(".workspace-startup__mark > .home-new-button__spinner").count(), 1);
    assert.equal(await card.locator(".home-new-button__spinner").count(), 1);
    assert.equal(await card.locator('.workspace-startup__step[data-state="complete"] .workspace-startup__mark > svg').count(), stage);
    const geometry = await card.locator(".workspace-startup__mark").evaluateAll(marks => marks.map(mark => {
      const rect = mark.getBoundingClientRect();
      const inner = mark.firstElementChild!.getBoundingClientRect();
      return { width: rect.width, height: rect.height, x: rect.x + rect.width / 2, y: rect.y + rect.height / 2,
        innerX: inner.x + inner.width / 2, innerY: inner.y + inner.height / 2 };
    }));
    for (const mark of geometry) {
      assert.equal(mark.width, 18); assert.equal(mark.height, 18);
      assert.ok(Math.abs(mark.x - mark.innerX) < 1); assert.ok(Math.abs(mark.y - mark.innerY) < 1);
    }
  }
  const glass = await card.evaluate(card => {
    const style = getComputedStyle(card);
    return { background: style.backgroundColor, blur: style.backdropFilter, border: style.borderTopWidth, radius: style.borderTopLeftRadius,
      titleSize: getComputedStyle(card.querySelector(".workspace-startup__title")!).fontSize };
  });
  assert.equal(glass.background, "rgba(255, 255, 255, 0.68)");
  assert.equal(glass.blur, "blur(12px)"); assert.equal(glass.border, "1px"); assert.equal(glass.radius, "6px");
  assert.equal(glass.titleSize, "15.2px");
  await page.emulateMedia({ reducedMotion: "reduce" });
  assert.equal(await card.locator(".home-new-button__spinner").evaluate(spinner => getComputedStyle(spinner).animationName), "none");
  assert.deepEqual(await page.evaluate(() => homeEntryContextFixture.state().imports), []);
}, "loading-card"));

test("public library circle tooltips and inline headers carry captured human Labelable names without account or engine reads", async () => {
  const snapshot = JSON.parse(await readFile("distros/narthex/solid/src/lib/generated/public-bootstrap.json", "utf8"));
  const publicRoot = decodeCheckpointValue(snapshot.root, snapshot.encoding) as import("./locus-root-data").LocusRootData;
  for (const [target, codeName] of [["std:join", "join"], ["std:reverse", "reverse"], ["std:words", "words"]] as const) {
    (publicRoot.previewMetadata ??= { entries: [] }).entries.push({ target, representations: [{ typeName: "Codeable", methods: { codeName } }] });
  }
  await fixture(async page => {
    const phone = process.env["FENEL_HOME_ENTRY_PHONE"] === "1";
    await page.locator(".home-entry__previews").evaluate(grid => { (grid as HTMLElement).style.gridTemplateColumns = "1fr"; });
    if (!phone) {
      await page.locator('[data-locus-preview="std"]').evaluate(card => { (card as HTMLElement).style.width = "960px"; });
      const absolute = page.getByRole("button", { name: "Open this data: Absolute value", exact: true });
      await absolute.waitFor();
      assert.equal(await absolute.locator("[data-thumbnail-icon]").getAttribute("data-thumbnail-icon"), "function");
      await absolute.hover();
      const popup = page.locator("[data-value-preview-popup]");
      await popup.getByText("Absolute value", { exact: true }).waitFor();
      assert.equal(await popup.getByText("Absolute value", { exact: true }).count(), 1);
      assert.equal(await popup.getByText("abs", { exact: true }).count(), 0);
    }
    const state = await page.evaluate(() => homeEntryContextFixture.state());
    assert.deepEqual(state.requests, []);
    assert.deepEqual(state.imports, []);
    await page.evaluate(() => {
      homeEntryContextFixture.focus({ kind: "value", viewId: "public-fenel", itemId: "demo", path: ["Reversed words"], rootItem: true });
      homeEntryContextFixture.mode("expression");
    });
    const before = process.env["FENEL_HOME_ENTRY_BASELINE"] === "1";
    if (before) await page.getByRole("status").filter({ hasText: "Preparing expression…" }).waitFor();
    else {
      const source = page.locator("[data-expression-inspection]");
      await source.locator(".expr-call__name").filter({ hasText: "join" }).waitFor();
      assert.equal(await source.locator(".expr-call").count(), 3);
      assert.deepEqual(await source.locator(".expr-call__name").allTextContents(), ["Words", "Reverse", "Join"]);
      // Graph is the default call layout (770b6227): held literals are read-only
      // data cards, and structural data opens through the card's Inspect.
      await source.locator(".fenel-string-data__content").first().waitFor();
      assert.deepEqual(await source.locator(".fenel-string-data__content").allTextContents(), ["the quick brown fox", " "]);
      assert.equal(await page.getByRole("status").filter({ hasText: "Preparing expression…" }).count(), 0);
      assert.equal(await page.locator("[data-workspace-handoff]").count(), 0);
    }
    const captureDirectory = process.env["FENEL_HOME_ENTRY_CAPTURE_DIR"];
    if (captureDirectory) await page.screenshot({ path: join(captureDirectory,
      `${before ? "before" : "after"}-reversed-words-expression${process.env["FENEL_HOME_ENTRY_PHONE"] === "1" ? "-phone" : ""}.png`), fullPage: true });
    if (!before) {
      await page.evaluate(() => {
        const root = (globalThis as typeof globalThis & { fixturePublicRoot: import("./locus-root-data").LocusRootData }).fixturePublicRoot;
        const demo = root.items.find(item => item.id === "demo")!.source!;
        if (demo.kind !== "expr" || demo.expr.kind !== "literal") throw new Error("Expected the held demo record");
        const fields = (demo.expr.value as { __record: { fields: Array<{ name: string; value: unknown }> } }).__record.fields;
        fields.find(field => field.name === "Reversed words")!.value = { kind: "call", fnId: "std:words", args: [{ kind: "literal", value: "a b" }] };
        homeEntryContextFixture.focus({ kind: "value", viewId: "public-fenel", itemId: "demo", path: ["Reversed words"], rootItem: true });
      });
      const source = page.locator("[data-expression-inspection]");
      await page.waitForFunction(() => document.querySelectorAll('[data-expression-inspection] .expr-call').length === 1);
      assert.deepEqual(await source.locator(".expr-call__name").allTextContents(), ["Words"]);
      assert.deepEqual(await source.locator(".fenel-string-data__content").allTextContents(), ["a b"]);
      async function inspectHeldCard(symbol: string) {
        const card = source.locator(".expr-graph-data-card").filter({ has: page.locator(".expr-graph-data-card__symbol", { hasText: symbol }) }).first();
        await card.waitFor();
        await card.hover();
        await card.getByRole("button", { name: "Actions", exact: true }).first().click();
        await page.getByRole("menuitem", { name: "Inspect", exact: true }).click();
        const dialog = page.getByRole("dialog").first();
        await dialog.waitFor();
        return dialog;
      }
      async function closeHeldCard() {
        await page.keyboard.press("Escape");
        await page.getByRole("dialog").waitFor({ state: "detached" });
      }
      await page.evaluate(() => {
        const root = (globalThis as typeof globalThis & { fixturePublicRoot: import("./locus-root-data").LocusRootData }).fixturePublicRoot;
        const demo = root.items.find(item => item.id === "demo")!.source!;
        if (demo.kind !== "expr" || demo.expr.kind !== "literal") throw new Error("Expected the held demo record");
        const fields = (demo.expr.value as { __record: { fields: Array<{ name: string; value: unknown }> } }).__record.fields;
        fields.find(field => field.name === "Reversed words")!.value = { kind: "literal", value: { __record: { fields: [{ name: "first", value: { kind: "literal", value: "before" } }] } } };
        homeEntryContextFixture.focus({ kind: "value", viewId: "public-fenel", itemId: "demo", path: ["Reversed words"], rootItem: true });
      });
      let dialog = await inspectHeldCard("record");
      await dialog.locator(".expr-record").waitFor();
      await dialog.getByText("first", { exact: true }).waitFor();
      assert.deepEqual(await dialog.locator(".fenel-string-data__content").allTextContents(), ["before"]);
      await closeHeldCard();
      await page.evaluate(() => {
        const root = (globalThis as typeof globalThis & { fixturePublicRoot: import("./locus-root-data").LocusRootData }).fixturePublicRoot;
        const demo = root.items.find(item => item.id === "demo")!.source!;
        if (demo.kind !== "expr" || demo.expr.kind !== "literal") throw new Error("Expected the held demo record");
        const fields = (demo.expr.value as { __record: { fields: Array<{ name: string; value: unknown }> } }).__record.fields;
        fields.find(field => field.name === "Reversed words")!.value = { kind: "literal", value: { __record: { fields: [{ name: "second", value: { kind: "literal", value: "after" } }] } } };
        homeEntryContextFixture.focus({ kind: "value", viewId: "public-fenel", itemId: "demo", path: ["Reversed words"], rootItem: true });
      });
      dialog = await inspectHeldCard("record");
      await dialog.getByText("second", { exact: true }).waitFor();
      assert.equal(await dialog.getByText("first", { exact: true }).count(), 0);
      assert.deepEqual(await dialog.locator(".fenel-string-data__content").allTextContents(), ["after"]);
      await closeHeldCard();
      for (const name of ["x", "y"]) {
        await page.evaluate(name => {
          const root = (globalThis as typeof globalThis & { fixturePublicRoot: import("./locus-root-data").LocusRootData }).fixturePublicRoot;
          const demo = root.items.find(item => item.id === "demo")!.source!;
          if (demo.kind !== "expr" || demo.expr.kind !== "literal") throw new Error("Expected the held demo record");
          const fields = (demo.expr.value as { __record: { fields: Array<{ name: string; value: unknown }> } }).__record.fields;
          fields.find(field => field.name === "Reversed words")!.value = { kind: "literal", value: { __lambda: { params: [name], body: { kind: "param", name } } } };
          homeEntryContextFixture.focus({ kind: "value", viewId: "public-fenel", itemId: "demo", path: ["Reversed words"], rootItem: true });
        }, name);
        dialog = await inspectHeldCard("lambda");
        await dialog.locator(".expr-form--lambda").waitFor();
        await dialog.locator(".expr-ref__name").filter({ hasText: name }).waitFor();
        assert.equal(await dialog.locator(".expr-ref__name").innerText(), name);
        await closeHeldCard();
      }
      await page.evaluate(() => {
        const root = (globalThis as typeof globalThis & { fixturePublicRoot: import("./locus-root-data").LocusRootData }).fixturePublicRoot;
        const demo = root.items.find(item => item.id === "demo")!.source!;
        if (demo.kind !== "expr" || demo.expr.kind !== "literal") throw new Error("Expected the held demo record");
        const fields = (demo.expr.value as { __record: { fields: Array<{ name: string; value: unknown }> } }).__record.fields;
        fields.find(field => field.name === "Reversed words")!.value = { kind: "literal", value: {
          __customer: { kind: "call", fnId: "ordinary literal data", args: [] },
          nested: { __lambda: { body: { kind: "call", fnId: "also ordinary literal data", args: [] } } },
        } };
        homeEntryContextFixture.focus({ kind: "value", viewId: "public-fenel", itemId: "demo", path: ["Reversed words"], rootItem: true });
      });
      // The shared preview now displays ordinary record fields directly. Its
      // marker-looking keys and strings remain data, never calls or lambdas.
      await source.locator(".typed-read-fields").first().waitFor();
      assert.equal(await source.locator(".expr-graph-data-card__symbol").count(), 0);
      assert.equal(await source.locator(".expr-call").count(), 0, "Marker-looking fields inside ordinary literal data cannot turn its data into a call");
      await source.locator(".fenel-string-data__content").filter({ hasText: /^ordinary literal data$/ }).first().waitFor();
      await source.locator(".fenel-string-data__content").filter({ hasText: /^also ordinary literal data$/ }).first().waitFor();
      assert.equal(await source.locator(".expr-form--lambda").count(), 0);
    }
    assert.deepEqual(await page.evaluate(() => homeEntryContextFixture.state().imports), []);
  }, "public-labels", publicRoot);
});

test("prepared Home handoff keeps shown data and expression while its first read waits", () => fixture(async page => {
  const before = !!process.env["FENEL_HOME_ENTRY_FIXTURE_BASELINE"];
  await page.locator('[data-locus-preview="literal"]').getByText("Already available", { exact: true }).waitFor();
  await page.waitForFunction(() => document.querySelectorAll(".workspace-startup").length === 0);
  await page.evaluate(() => {
    homeEntryContextFixture.focus({ kind: "value", viewId: "sibling-reader", itemId: "literal", path: [], rootItem: true });
    homeEntryContextFixture.mode("both");
  });
  await page.locator("[data-expression-inspection]").getByText("Already available", { exact: true }).waitFor();
  await page.evaluate(() => homeEntryContextFixture.ready());
  await page.waitForFunction(() => homeEntryContextFixture.state().actions.length === 1);
  if (before) await page.getByRole("status", { name: "Preparing data…", exact: true }).waitFor();
  else {
    assert.equal(await page.locator(".workspace-startup").count(), 0);
    await page.locator('[data-locus-preview="literal"]').getByText("Already available", { exact: true }).waitFor();
    assert.equal(await page.locator("[data-expression-inspection]").getByText("Already available", { exact: true }).count(), 1);
  }
  const captureDirectory = process.env["FENEL_HOME_ENTRY_CAPTURE_DIR"];
  if (captureDirectory) await page.screenshot({ path: join(captureDirectory,
    `${before ? "before" : "after"}-prepared-home-handoff.png`), fullPage: false });
  await page.evaluate(() => homeEntryContextFixture.releaseHandoff());
  await page.locator("[data-workspace-handoff]").waitFor();
  await page.waitForFunction(() => document.querySelectorAll(".workspace-startup").length === 0);
  assert.equal(await page.locator(".workspace-startup").count(), 0);
  assert.equal(await page.locator('[data-locus-surface="shell"]').count(), 0);
  assert.equal(await page.locator("[data-workspace-handoff]").count(), 1);
  assert.deepEqual(await page.evaluate(() => homeEntryContextFixture.state().errors), []);
}, "reader-handoff-wait"));

test("retained early shell owns body paste while prepared lazy Home waits", () => fixture(async page => {
  await page.locator('[data-locus-preview="literal"]').getByText("Already available", { exact: true }).waitFor();
  await page.evaluate(() => homeEntryContextFixture.ready());
  await page.waitForFunction(() => homeEntryContextFixture.state().actions.length === 1);
  await page.evaluate(() => new Promise(resolve => requestAnimationFrame(resolve)));
  assert.equal(await page.locator(".home-entry").evaluate(element => element.isConnected), true);
  assert.equal(await page.locator("[data-workspace-handoff]").count(), 0);
  await localPasteEvent(page, "Paste while the prepared body is pending");
  assert.deepEqual(await page.evaluate(() => homeEntryContextFixture.takeReaderTransfers().map(entry => entry.snapshot.text)),
    ["Paste while the prepared body is pending"]);
  await page.evaluate(() => homeEntryContextFixture.releaseHandoff());
  await page.locator("[data-workspace-handoff]").waitFor();
  assert.equal(await page.locator(".home-entry").count(), 0);
}, "reader-handoff-wait"));

test("expression focus opens in the current lens before tools, toggles both panels and carries its selected mode into the reader", () => fixture(async page => {
  const card = page.locator('[data-locus-preview="literal"]');
  await card.getByText("Already available", { exact: true }).waitFor();
  await openCardExpression(page, card);
  const panels = page.locator(".data-inspection-dialog__panels--inline");
  await panels.locator('[data-expression-inspection][data-expression-early-editing="true"]').getByText("Already available", { exact: true }).waitFor();
  assert.equal(await panels.getByRole("status").filter({ hasText: "Preparing expression…" }).count(), 0);
  assert.equal(await page.getByRole("dialog").count(), 0);
  const captureDirectory = process.env["FENEL_HOME_ENTRY_CAPTURE_DIR"];
  if (captureDirectory) await page.screenshot({ path: join(captureDirectory, "early-expression-open.png"), fullPage: true });
  assert.equal(await page.locator("[data-workspace-handoff]").count(), 0);
  assert.deepEqual(await page.evaluate(() => homeEntryContextFixture.state().imports), []);
  await editHeldData(page, panels.locator("[data-expression-inspection]"));
  await page.getByRole("dialog").getByRole("textbox").first().fill("Changed");
  await page.getByRole("dialog").getByRole("button", { name: "Close argument", exact: true }).click();
  await panels.locator('[data-early-expression-draft="true"]').getByRole("button", { name: "Save", exact: true }).click();
  await page.getByRole("button", { name: "Data", exact: true }).click();
  assert.equal(await panels.getAttribute("data-panels"), "both");
  await panels.locator('[aria-label="Data panel"]').getByText("Already available", { exact: true }).waitFor();
  if (captureDirectory) await page.screenshot({ path: join(captureDirectory, "early-data-and-expression-open.png"), fullPage: true });
  await page.getByRole("button", { name: "Expression", exact: true }).click();
  assert.equal(await panels.getAttribute("data-panels"), "data");
  await page.evaluate(() => homeEntryContextFixture.ready());
  await page.locator("[data-workspace-handoff]").waitFor();
  const actions = await page.evaluate(() => homeEntryContextFixture.state().actions);
  const action = actions[0];
  assert.ok(typeof action === "object" && action.kind === "inspect-data");
  assert.equal(action.mode, "data");
  assert.deepEqual(action.draft?.node, { kind: "literal", value: "Changed" });
  assert.equal(action.draft?.commit, true);
  assert.equal(action.item.id, "literal");
  assert.deepEqual(action.scope, { kind: "value", viewId: "sibling-reader", itemId: "literal", path: [], rootItem: true });
}, "reader"));

test("Data Expression and Code toggle every nonempty panel combination before canonical tools are ready", () => fixture(async page => {
  await page.locator('[data-locus-preview="literal"]').getByText("Already available", { exact: true }).waitFor();
  const panels = page.locator(".data-inspection-dialog__panels--inline");
  const controls = page.getByRole("group", { name: "Visible panels", exact: true });
  const steps = [
    { button: "Code", mode: "data-code", visible: ["Data", "Code"] },
    { button: "Expression", mode: "all", visible: ["Data", "Expression", "Code"] },
    { button: "Data", mode: "expression-code", visible: ["Expression", "Code"] },
    { button: "Code", mode: "expression", visible: ["Expression"] },
    { button: "Data", mode: "both", visible: ["Data", "Expression"] },
    { button: "Expression", mode: "data", visible: ["Data"] },
    { button: "Code", mode: "data-code", visible: ["Data", "Code"] },
    { button: "Data", mode: "code", visible: ["Code"] },
    { button: "Code", mode: "data", visible: ["Data"] },
  ];
  for (const step of steps) {
    await controls.getByRole("button", { name: step.button, exact: true }).click();
    assert.equal(await panels.getAttribute("data-panels"), step.mode);
    assert.equal(await panels.getAttribute("data-panel-count"), String(step.visible.length));
    for (const label of ["Data", "Expression", "Code"]) {
      assert.equal(await panels.locator(`[aria-label="${label} panel"]:not([hidden])`).count(), Number(step.visible.includes(label)));
      assert.equal(await controls.getByRole("button", { name: label, exact: true }).getAttribute("aria-pressed"), String(step.visible.includes(label)));
    }
    if (step.visible.includes("Code")) await panels.getByRole("status").filter({ hasText: "Preparing Fenel code…" }).waitFor();
    if (step.visible.includes("Expression")) await panels.locator("[data-expression-inspection]").waitFor();
    const loading = await panels.locator('[aria-label="Expression panel"]:not([hidden]) .home-item__loading--label, [aria-label="Code panel"]:not([hidden]) .home-item__loading--label').evaluateAll(elements => elements.map(element => {
      const spinner = element.querySelector<HTMLElement>(".home-new-button__spinner")!.getBoundingClientRect();
      const label = element.querySelector<HTMLElement>(".home-item__loading-label")!;
      const text = label.getBoundingClientRect();
      const style = getComputedStyle(label);
      return { underneath: text.y >= spinner.y + spinner.height,
        centered: Math.abs(text.x + text.width / 2 - spinner.x - spinner.width / 2) < 1,
        font: style.fontSize, italic: style.fontStyle, color: style.color, parentColor: getComputedStyle(element).color };
    }));
    assert.equal(loading.length, Number(step.visible.includes("Code")));
    assert.ok(loading.every(status => status.underneath && status.centered && status.font === "12px"
      && status.italic === "italic" && status.color === status.parentColor));
  }
  assert.equal(await page.getByRole("dialog").count(), 0);
  assert.equal(await page.locator("[data-workspace-handoff]").count(), 0);
  const state = await page.evaluate(() => homeEntryContextFixture.state());
  assert.ok(state.requested > 0);
  assert.deepEqual(state.actions, []);
  assert.deepEqual(state.imports, []);
}, "reader"));

test("early Code selection keeps a checked field source and waits for its exact focused handoff", () => fixture(async page => {
  await page.locator('[data-locus-preview="more-record"]').getByRole("button", { name: "A received record", exact: true }).click();
  await openCardExpression(page, page.locator('[data-locus-preview="$field:one"]'));
  await page.getByRole("button", { name: "Code", exact: true }).click();
  await page.getByRole("button", { name: "Expression", exact: true }).click();
  const panels = page.locator('[data-panels="code"]');
  await panels.getByRole("status").filter({ hasText: "Preparing Fenel code…" }).waitFor();
  assert.equal(await panels.locator('[aria-label="Data panel"]:not([hidden]), [aria-label="Expression panel"]:not([hidden])').count(), 0);
  assert.equal(await page.getByRole("dialog").count(), 0);
  const captureDirectory = process.env["FENEL_HOME_ENTRY_CAPTURE_DIR"];
  if (captureDirectory) await page.screenshot({ path: join(captureDirectory, "early-code-only-open.png"), fullPage: true });
  await page.evaluate(() => homeEntryContextFixture.ready());
  assert.equal(await page.locator("[data-workspace-handoff]").count(), 0);
  await page.evaluate(() => homeEntryContextFixture.releaseFocus());
  await page.locator("[data-workspace-handoff]").waitFor();
  const action = (await page.evaluate(() => homeEntryContextFixture.state())).actions[0];
  assert.ok(typeof action === "object" && action.kind === "inspect-data");
  assert.equal(action.mode, "code");
  assert.equal(action.item.id, "more-record");
  assert.deepEqual(action.scope, { kind: "value", viewId: "sibling-reader", itemId: "more-record", path: ["one"], rootItem: true });
  assert.ok(action.item.source?.kind === "expr" && action.item.source.expr.kind === "literal");
  assert.equal((action.item.source.expr.value as { __record: { fields: unknown[] } }).__record.fields.length, 4);
}, "reader-focus-wait"));

test("ordinary early menu survives equivalent root republication at readiness before Suggestions is selected", () => fixture(async page => {
  const card = page.locator('[data-locus-preview="literal"]');
  await card.getByText("Already available", { exact: true }).waitFor();
  await card.locator(".home-item__body").click({ button: "right" });
  const menu = page.getByRole("menu", { name: "Data actions", exact: true });
  const originalMenu = await menu.elementHandle();
  assert.ok(originalMenu);
  await page.evaluate(() => homeEntryContextFixture.republishReaderRoot("same", true));
  // Drain the ready transition before checking the actual original DOM owner.
  await page.waitForFunction(() => homeEntryContextFixture.state().ready);
  await page.evaluate(() => new Promise<void>(resolve => requestAnimationFrame(() => requestAnimationFrame(() => resolve()))));
  const capture = process.env["FENEL_HOME_ENTRY_CAPTURE_DIR"];
  if (capture) await page.screenshot({ path: join(capture,
    `ordinary-menu-root-publication-${process.env["FENEL_HOME_ENTRY_FIXTURE_HOME_SOURCE"] ? "before" : "after"}.png`), animations: "disabled" });
  assert.deepEqual(await page.evaluate(() => homeEntryContextFixture.state().readerPublications), [{
    sameObject: false, beforeId: "sibling-reader", afterId: "sibling-reader", beforeRevision: 1, afterRevision: 1,
  }]);
  assert.equal(await originalMenu.evaluate(element => element.isConnected && element.getClientRects().length > 0), true,
    "Readiness must retain the open ordinary menu owner");
  assert.equal(await page.locator("[data-workspace-handoff]").count(), 0);
  assert.equal(await page.evaluate(() => homeEntryContextFixture.flushPane()), true, "An open menu is not an unsaved edit");
  await menu.getByRole("menuitem", { name: "Suggestions", exact: true }).click();
  await page.locator("[data-workspace-handoff]").waitFor();
  const actions = await page.evaluate(() => homeEntryContextFixture.state().actions);
  assert.equal(actions.length, 1);
  const action = actions[0];
  assert.ok(typeof action === "object" && action.kind === "suggest-data");
  assert.equal(action.itemId, "literal");
  assert.deepEqual(action.scope, { kind: "root" });
  assert.equal(action.source, "sibling-reader");
  assert.equal(action.rootId, "sibling-reader");
  assert.equal(action.revision, 1);
}, "reader"));

test("ordinary early menu dismissal releases the ready handoff without an action", () => fixture(async page => {
  const card = page.locator('[data-locus-preview="literal"]');
  await card.getByText("Already available", { exact: true }).waitFor();
  await card.locator(".home-item__body").click({ button: "right" });
  const menu = page.getByRole("menu", { name: "Data actions", exact: true });
  await page.evaluate(() => homeEntryContextFixture.ready());
  await page.waitForFunction(() => homeEntryContextFixture.state().ready);
  await menu.waitFor();
  await menu.press("Escape");
  await page.locator("[data-workspace-handoff]").waitFor();
  assert.deepEqual(await page.evaluate(() => homeEntryContextFixture.state().actions), [undefined]);
}, "reader"));

for (const boundary of ["focus", "source", "revision", "root", "session"] as const) test(`ordinary early menu retires on ${boundary} replacement after readiness`, () => fixture(async page => {
  const card = page.locator('[data-locus-preview="literal"]');
  await card.getByText("Already available", { exact: true }).waitFor();
  await card.locator(".home-item__body").click({ button: "right" });
  const suggestion = await page.getByRole("menuitem", { name: "Suggestions", exact: true }).elementHandle();
  assert.ok(suggestion);
  await page.evaluate(() => homeEntryContextFixture.ready());
  await page.waitForFunction(() => homeEntryContextFixture.state().ready);
  assert.equal(await suggestion.evaluate(element => element.isConnected), true);
  await page.evaluate(async boundary => {
    if (boundary === "focus") homeEntryContextFixture.focus({ kind: "value", viewId: "sibling-reader", itemId: "computed", path: [], rootItem: true });
    else if (boundary === "source") homeEntryContextFixture.readerSource({ $tag: "PublicSource" });
    else if (boundary === "revision") homeEntryContextFixture.reviseRoot();
    else if (boundary === "root") await homeEntryContextFixture.republishReaderRoot("identity");
    else homeEntryContextFixture.session("other-account");
  }, boundary);
  await page.getByRole("menu", { name: "Data actions", exact: true }).waitFor({ state: "detached" });
  await suggestion.evaluate(element => { if (element instanceof HTMLElement) element.click(); });
  const actions = await page.evaluate(() => homeEntryContextFixture.state().actions);
  assert.equal(actions.some(action => typeof action === "object" && action.kind === "suggest-data"), false);
}, boundary === "session" ? "reader-session-retirement" : "reader"));

for (const boundary of ["same", "identity", "readonly", "session"] as const) test(`root cleanup keeps held clipboard cancellation on ${boundary} publication`, () => fixture(async page => {
  await page.locator('[data-locus-preview="literal"]').getByText("Already available", { exact: true }).waitFor();
  await contextMenu(page);
  await page.getByRole("menuitem", { name: "Paste Ctrl+V / ⌘V", exact: true }).click();
  await page.waitForFunction(() => homeEntryContextFixture.state().clipboardReads.length === 1);
  assert.equal(await page.evaluate(() => homeEntryContextFixture.flushPane()), false, "The clipboard read must still be pending before publication");
  await page.evaluate(async boundary => {
    if (boundary === "session") homeEntryContextFixture.session("other-account");
    else await homeEntryContextFixture.republishReaderRoot(boundary);
  }, boundary);
  await page.waitForFunction(async () => await homeEntryContextFixture.flushPane());
  await page.evaluate(() => homeEntryContextFixture.releaseClipboard());
  await page.evaluate(() => new Promise<void>(resolve => requestAnimationFrame(() => requestAnimationFrame(() => resolve()))));
  const state = await page.evaluate(() => homeEntryContextFixture.state());
  assert.deepEqual(state.actions, [], "A cancelled clipboard read must not arm a prepared action");
  assert.deepEqual(state.receivedTransfers, []);
  assert.equal(state.requests.some(request => request.startsWith("PUT ") || request.startsWith("POST ") && request !== "POST /api/reader-metadata"), false);
  assert.equal(await page.evaluate(() => homeEntryContextFixture.flushPane()), true);
}, boundary === "session" ? "reader-session-retirement" : "reader"));

test("early right-click Suggestions retains its clicked data without changing lens focus", () => fixture(async page => {
  const card = page.locator('[data-locus-preview="literal"]');
  await card.getByText("Already available", { exact: true }).waitFor();
  await card.locator(".home-item__body").click({ button: "right" });
  const suggestions = page.getByRole("menuitem", { name: "Suggestions", exact: true });
  const capture = process.env["FENEL_HOME_ENTRY_CAPTURE_DIR"];
  const before = process.env["FENEL_CONTEXT_SUGGESTIONS_BEFORE"] === "1";
  if (capture) await page.screenshot({ path: join(capture, `data-context-suggestions-${before ? "before" : "after"}.png`), animations: "disabled" });
  if (before) { assert.equal(await suggestions.count(), 0); return; }
  await suggestions.click();
  await page.getByRole("menu", { name: "Suggestions", exact: true }).getByText("Checking suggestions…", { exact: true }).waitFor();
  assert.deepEqual(await page.evaluate(() => homeEntryContextFixture.state().focus), { kind: "root" });
  assert.equal(await page.evaluate(() => homeEntryContextFixture.state().actions.length), 0);
  assert.equal(await page.evaluate(() => homeEntryContextFixture.flushPane()), true, "A suggestion query is not an unsaved edit");
  await page.evaluate(() => homeEntryContextFixture.ready());
  await page.locator("[data-workspace-handoff]").waitFor();
  const action = (await page.evaluate(() => homeEntryContextFixture.state())).actions[0];
  assert.ok(typeof action === "object" && action.kind === "suggest-data");
  assert.equal(action.itemId, "literal");
  assert.deepEqual(action.scope, { kind: "root" });
  assert.equal(action.source, "sibling-reader");
  assert.equal(action.rootId, "sibling-reader");
  assert.equal(action.revision, 1);
  assert.ok(action.position.x > 0 && action.position.y > 0);
  assert.equal(await page.evaluate(() => homeEntryContextFixture.state().requests.some(request => /^(POST|PUT|DELETE) /.test(request)
    && request !== "POST /api/reader-metadata")), false);
}, "reader"));

test("focused early Suggestions hands the current subject to the same prepared query", () => fixture(async page => {
  const focus = { kind: "value" as const, viewId: "sibling-reader", itemId: "literal", path: [], rootItem: true };
  await page.evaluate(focus => homeEntryContextFixture.focus(focus), focus);
  const card = page.locator('[data-locus-preview="literal"]');
  await card.getByText("Already available", { exact: true }).waitFor();
  await card.getByText("Already available", { exact: true }).click({ button: "right" });
  await page.getByRole("menuitem", { name: "Suggestions", exact: true }).click();
  await page.evaluate(() => homeEntryContextFixture.ready());
  await page.locator("[data-workspace-handoff]").waitFor();
  const action = (await page.evaluate(() => homeEntryContextFixture.state())).actions[0];
  assert.ok(typeof action === "object" && action.kind === "suggest-data");
  assert.equal(action.itemId, undefined);
  assert.deepEqual(action.scope, focus);
}, "reader"));

test("closing the menu keeps a captured Suggestions request, reported with Cancel", () => fixture(async page => {
  const card = page.locator('[data-locus-preview="literal"]');
  await card.getByText("Already available", { exact: true }).waitFor();
  await card.locator(".home-item__body").click({ button: "right" });
  await page.getByRole("menuitem", { name: "Suggestions", exact: true }).click();
  await page.getByRole("menu", { name: "Suggestions", exact: true }).getByText("Checking suggestions…", { exact: true }).waitFor();
  await page.keyboard.press("Escape");
  await page.getByRole("menu", { name: "Suggestions", exact: true }).waitFor({ state: "detached" });
  await page.locator(".locus-notifications__bell").click();
  const notice = page.getByRole("status").filter({ hasText: "Checking suggestions…" });
  await notice.waitFor({ timeout: 2_000 });
  assert.equal(await page.getByRole("button", { name: "Cancel", exact: true }).count() > 0, true);
  await page.evaluate(() => homeEntryContextFixture.ready());
  await page.locator("[data-workspace-handoff]").waitFor();
  const action = (await page.evaluate(() => homeEntryContextFixture.state())).actions[0];
  assert.ok(typeof action === "object" && action.kind === "suggest-data", "The dismissed menu did not cancel the request");
  assert.equal(action.itemId, "literal");
}, "reader"));

test("a pending New of a scalar in a value scope reports what it creates, with Cancel", () => fixture(async page => {
  await page.evaluate(() => homeEntryContextFixture.focus({ kind: "value", viewId: "sibling-reader", itemId: "literal", path: [], rootItem: true }));
  const card = page.locator('[data-locus-preview="literal"]');
  await card.getByText("Already available", { exact: true }).waitFor();
  await card.click({ button: "right" });
  await page.getByRole("menuitem", { name: "New beside", exact: true }).hover();
  await page.getByRole("menuitem", { name: "Boolean", exact: true }).click();
  await page.locator(".locus-notifications__bell").click();
  await page.getByRole("status").filter({ hasText: "Creating Boolean…" }).waitFor({ timeout: 2_000 });
  await page.getByRole("button", { name: "Cancel", exact: true }).first().click();
  await page.getByRole("status").filter({ hasText: "Creating Boolean…" }).waitFor({ state: "detached" });
  await page.evaluate(() => homeEntryContextFixture.ready());
  await page.locator("[data-workspace-handoff]").waitFor();
  assert.deepEqual(await page.evaluate(() => homeEntryContextFixture.state().actions), [undefined]);
}, "reader"));

test("a data's New beside offers quick types by their type icons, an italic More… and a Type/Function section, only when editable", () => fixture(async page => {
  const card = page.locator('[data-locus-preview="literal"]');
  await card.getByText("Already available", { exact: true }).waitFor();
  await card.locator(".home-item__body").click({ button: "right" });
  assert.equal(await page.getByRole("menuitem", { name: "New", exact: true }).count(), 0);
  await page.getByRole("menuitem", { name: "New beside", exact: true }).hover();
  const submenu = page.getByRole("menu", { name: "New beside", exact: true });
  await submenu.waitFor();
  const rows = await submenu.locator(":scope > .locus-context-menu-separator, :scope > .locus-context-menu-row > button").evaluateAll(elements =>
    elements.map(element => element.classList.contains("locus-context-menu-separator") ? "|"
      : `${element.querySelector(".locus-context-menu-label")!.textContent}${element.classList.contains("locus-context-menu-item--emphasis") ? "(i)" : ""}`
        + `:${element.getAttribute("data-locus-menu-item")}`));
  assert.deepEqual(rows.map(row => row.split(":")[0]), ["Text", "Number", "Date", "Image", "Color", "Boolean", "List", "Maybe", "Either",
    "More…(i)", "|", "Type", "Function"]);
  const icon = (label: string) => submenu.getByRole("menuitem", { name: label, exact: true }).locator(".locus-context-menu-icon svg").innerHTML();
  assert.notEqual(await icon("Either"), await icon("Maybe"));
  await page.keyboard.press("Escape");
  await page.evaluate(() => homeEntryContextFixture.republishReaderRoot("readonly"));
  await page.waitForTimeout(300);
  await card.locator(".home-item__body").click({ button: "right" });
  await page.getByRole("menu", { name: "Data actions", exact: true }).waitFor();
  assert.equal(await page.getByRole("menuitem", { name: "New beside", exact: true }).count(), 0, "A read-only container offers no New beside");
}, "reader"));

test("a data opens in a new tab or window by its address, or says why it cannot", () => fixture(async page => {
  const card = page.locator('[data-locus-preview="literal"]');
  await card.getByText("Already available", { exact: true }).waitFor();
  await card.locator(".home-item__body").click({ button: "right" });
  await page.getByRole("menuitem", { name: "Open in a new tab", exact: true }).click();
  await card.locator(".home-item__body").click({ button: "right" });
  await page.getByRole("menuitem", { name: "Open in a new window", exact: true }).click();
  const opened = (await page.evaluate(() => homeEntryContextFixture.state())).openedElsewhere;
  assert.deepEqual(opened.map(entry => entry.place), ["tab", "window"]);
  assert.deepEqual(opened[0]!.scope, { kind: "value", viewId: "sibling-reader", itemId: "literal", path: [], rootItem: true });
  await page.evaluate(() => homeEntryContextFixture.elsewhereUnavailable("Save your Local changes first."));
  await card.locator(".home-item__body").click({ button: "right" });
  const tab = page.getByRole("menuitem", { name: "Open in a new tab", exact: true });
  assert.equal(await tab.isDisabled(), true);
  assert.equal(await tab.getAttribute("data-tooltip"), "Save your Local changes first.");
  assert.equal(await page.getByRole("menuitem", { name: "Open in a new window", exact: true }).isDisabled(), true);
}, "reader"));

test("dismissed early Suggestions cannot reopen after late preparation", () => fixture(async page => {
  const card = page.locator('[data-locus-preview="literal"]');
  await card.getByText("Already available", { exact: true }).waitFor();
  await card.locator(".home-item__body").click({ button: "right" });
  await page.getByRole("menuitem", { name: "Suggestions", exact: true }).click();
  await page.getByRole("menu", { name: "Suggestions", exact: true }).getByRole("menuitem", { name: "Cancel", exact: true }).click();
  await page.getByRole("menu", { name: "Suggestions", exact: true }).waitFor({ state: "detached" });
  await page.evaluate(() => homeEntryContextFixture.ready());
  await page.locator("[data-workspace-handoff]").waitFor();
  assert.deepEqual(await page.evaluate(() => homeEntryContextFixture.state().actions), [undefined]);
}, "reader"));

test("focus replacement in the preparation tick refuses the old Suggestions target", () => fixture(async page => {
  const card = page.locator('[data-locus-preview="literal"]');
  await card.getByText("Already available", { exact: true }).waitFor();
  await card.locator(".home-item__body").click({ button: "right" });
  await page.getByRole("menuitem", { name: "Suggestions", exact: true }).click();
  await page.evaluate(() => {
    homeEntryContextFixture.focus({ kind: "value", viewId: "sibling-reader", itemId: "computed", path: [], rootItem: true });
    homeEntryContextFixture.ready();
  });
  await page.locator("[data-workspace-handoff]").waitFor();
  assert.deepEqual(await page.evaluate(() => homeEntryContextFixture.state().actions), [undefined]);
}, "reader"));

test("another right-click replaces a pending Suggestions target", () => fixture(async page => {
  const literal = page.locator('[data-locus-preview="literal"]');
  await literal.getByText("Already available", { exact: true }).waitFor();
  await literal.locator(".home-item__body").click({ button: "right" });
  await page.getByRole("menuitem", { name: "Suggestions", exact: true }).click();
  await page.locator('[data-locus-preview="computed"] .home-item__body').click({ button: "right" });
  await page.getByRole("menuitem", { name: "Suggestions", exact: true }).click();
  await page.evaluate(() => homeEntryContextFixture.ready());
  await page.locator("[data-workspace-handoff]").waitFor();
  const action = (await page.evaluate(() => homeEntryContextFixture.state())).actions[0];
  assert.ok(typeof action === "object" && action.kind === "suggest-data");
  assert.equal(action.itemId, "computed");
}, "reader"));

test("early record child Suggestions carries its own field instead of targeting its parent", () => fixture(async page => {
  const record = page.locator('[data-locus-preview="more-record"]');
  await record.locator(".locus-previews__cell").first().click({ button: "right" });
  await page.getByRole("menuitem", { name: "Suggestions", exact: true }).click();
  await page.evaluate(() => homeEntryContextFixture.ready());
  await page.locator("[data-workspace-handoff]").waitFor();
  const action = (await page.evaluate(() => homeEntryContextFixture.state())).actions[0];
  assert.ok(typeof action === "object" && action.kind === "suggest-data");
  assert.equal(action.itemId, "more-record");
  assert.deepEqual(action.scope, { kind: "root" });
  assert.deepEqual(action.selection?.path, ["one"]);
  assert.equal(action.selection?.value, "one");
}, "reader-more"));

test("early list child Suggestions carries its exact index and observed data", () => fixture(async page => {
  const list = page.locator('[data-locus-preview="known-list"]');
  await list.locator(".locus-previews__cell").first().click({ button: "right" });
  await page.getByRole("menuitem", { name: "Suggestions", exact: true }).click();
  await page.evaluate(() => homeEntryContextFixture.ready());
  await page.locator("[data-workspace-handoff]").waitFor();
  const action = (await page.evaluate(() => homeEntryContextFixture.state())).actions[0];
  assert.ok(typeof action === "object" && action.kind === "suggest-data");
  assert.equal(action.itemId, "known-list");
  assert.deepEqual(action.selection?.path, [0]);
  assert.equal(action.selection?.value, "First item");
}, "reader"));

test("a data revision changed while its ordinary menu is open cannot be reinterpreted as a fresh Suggestions target", () => fixture(async page => {
  const card = page.locator('[data-locus-preview="literal"]');
  await card.getByText("Already available", { exact: true }).waitFor();
  await card.locator(".home-item__body").click({ button: "right" });
  const heldSuggestion = await page.getByRole("menuitem", { name: "Suggestions", exact: true }).elementHandle();
  assert.ok(heldSuggestion);
  await page.evaluate(() => homeEntryContextFixture.reviseRoot());
  await page.waitForFunction(() => homeEntryContextFixture.state().requests.filter(request => request === "GET /api/locus-root").length === 2);
  await page.getByRole("menu").waitFor({ state: "detached" });
  // Also exercise a delayed activation callback from the retired DOM owner.
  await heldSuggestion.evaluate(element => {
    if (!(element instanceof HTMLElement)) throw new Error("Expected the held Suggestions item to be an HTML element.");
    element.click();
  });
  await page.evaluate(() => homeEntryContextFixture.ready());
  await page.locator("[data-workspace-handoff]").waitFor();
  assert.deepEqual(await page.evaluate(() => homeEntryContextFixture.state().actions), [undefined]);
}, "reader"));

test("received data keeps source inspection in its context menu while the canonical printer prepares", () => fixture(async page => {
  const card = page.locator('[data-locus-preview="literal"]');
  await card.getByText("Already available", { exact: true }).waitFor();
  assert.equal(await card.getByRole("button", { name: "Show Fenel code", exact: true }).count(), 0);
  assert.equal(await page.locator('[data-tooltip="Preparing Fenel code…"]').count(), 0);
  assert.equal(await card.locator(".home-item__type-tag").innerText(), "String");
  await card.locator(".home-item__body").click({ button: "right" });
  await page.getByRole("menuitem", { name: "Show Fenel code", exact: true }).click();
  assert.equal(await page.locator("[data-workspace-handoff]").count(), 0);
  await page.locator(".locus-notifications__bell").click();
  await page.getByRole("status").filter({ hasText: "Opening Fenel code…" }).waitFor();
  assert.equal(await page.getByText("Adding the data you pasted…", { exact: true }).count(), 0);
  assert.equal(await page.evaluate(() => homeEntryContextFixture.flushPane()), true);
  assert.equal(await page.evaluate(() => {
    const event = new Event("beforeunload", { cancelable: true });
    window.dispatchEvent(event);
    return event.defaultPrevented;
  }), false);
  await page.evaluate(() => homeEntryContextFixture.ready());
  await page.locator("[data-workspace-handoff]").waitFor();
  assert.deepEqual(await page.evaluate(() => homeEntryContextFixture.state().actions), [{ kind: "show-code", itemId: "literal", scope: { kind: "root" } }]);
}, "reader"));

test("a focused source request carries its actual occurrence into the prepared renderer", () => fixture(async page => {
  const focus = { kind: "value" as const, viewId: "sibling-reader", itemId: "literal", path: [], rootItem: true };
  await page.evaluate(focus => homeEntryContextFixture.focus(focus), focus);
  const card = page.locator('[data-locus-preview="literal"]');
  await card.getByText("Already available", { exact: true }).waitFor();
  await card.click({ button: "right" });
  await page.getByRole("menuitem", { name: "Show Fenel code", exact: true }).click();
  assert.equal(await page.evaluate(() => homeEntryContextFixture.flushPane()), true);
  await page.evaluate(() => homeEntryContextFixture.ready());
  await page.locator("[data-workspace-handoff]").waitFor();
  assert.deepEqual(await page.evaluate(() => homeEntryContextFixture.state().actions), [{ kind: "show-code", itemId: "literal", scope: focus }]);
}, "reader"));

test("moving to another item cancels a read-only source request without an edit guard", () => fixture(async page => {
  await page.evaluate(() => homeEntryContextFixture.focus({ kind: "value", viewId: "sibling-reader", itemId: "literal", path: [], rootItem: true }));
  const card = page.locator('[data-locus-preview="literal"]');
  await card.getByText("Already available", { exact: true }).waitFor();
  await card.click({ button: "right" });
  await page.getByRole("menuitem", { name: "Show Fenel code", exact: true }).click();
  await page.locator(".locus-notifications__bell").click();
  await page.getByRole("status").filter({ hasText: "Opening Fenel code…" }).waitFor();
  assert.equal(await page.evaluate(() => homeEntryContextFixture.flushPane()), true);
  await page.evaluate(() => homeEntryContextFixture.focus({ kind: "value", viewId: "sibling-reader", itemId: "computed", path: [], rootItem: true }));
  await page.getByText("Opening Fenel code…", { exact: true }).waitFor({ state: "detached" });
  await page.evaluate(() => homeEntryContextFixture.ready());
  await page.locator("[data-workspace-handoff]").waitFor();
  assert.deepEqual(await page.evaluate(() => homeEntryContextFixture.state().actions), [undefined]);
}, "reader"));

test("the desktop lens uses received data previews and the same navigation before the typed renderer is ready", () => fixture(async page => {
  await page.getByText("Already available", { exact: true }).waitFor();
  const before = await page.evaluate(() => homeEntryContextFixture.state());
  await page.evaluate(() => homeEntryContextFixture.desktop());
  await page.locator(".home-grid--desktop").waitFor();
  const scalar = page.locator('[data-locus-preview="literal"]');
  assert.equal(await scalar.locator(".desktop-data__visual > svg").count(), 1);
  assert.equal(await scalar.locator(".desktop-data__media").count(), 0);
  const list = page.locator('[data-locus-preview="known-list"]');
  assert.equal(await list.locator(".desktop-data__folder > svg").count(), 1);
  assert.equal(await list.locator(".desktop-data__folder-preview .locus-previews__content").innerText(), "");
  assert.equal(await list.locator("[data-thumbnail-icon]").getAttribute("data-thumbnail-icon"), "package");
  assert.deepEqual((await page.evaluate(() => homeEntryContextFixture.state())).requests, before.requests);
  assert.deepEqual((await page.evaluate(() => homeEntryContextFixture.state())).imports, []);
  await list.getByRole("button", { name: "Open A received list", exact: true }).click();
  await page.locator('[data-locus-preview="first"] .desktop-data__visual').waitFor();
  assert.deepEqual(await page.evaluate(() => homeEntryContextFixture.state().focus), { kind: "view", viewId: "known-list" });
}, "reader"));

test("an early list opens its actual data without waiting for editing tools", () => fixture(async page => {
  const list = page.locator('[data-locus-preview="known-list"]');
  await list.getByRole("button", { name: "A received list", exact: true }).click();
  await page.getByText("First item", { exact: true }).waitFor();
  assert.equal(await page.locator('[data-panels="data"]').count(), 1);
  assert.equal(await page.getByRole("dialog").count(), 0);
  assert.deepEqual(await page.evaluate(() => homeEntryContextFixture.state().focus), { kind: "view", viewId: "known-list" });
  assert.deepEqual(await page.evaluate(() => homeEntryContextFixture.state().imports), []);
}, "reader"));

test("opening an already focused Desktop image switches to its full data presentation", () => fixture(async page => {
  await page.evaluate(() => homeEntryContextFixture.desktop());
  const image = page.locator('[data-locus-preview="image"]');
  await image.locator(".desktop-data__media canvas").waitFor();
  await image.getByRole("button", { name: "Open A received image", exact: true }).click();
  await page.waitForFunction(() => homeEntryContextFixture.state().focus.kind === "value");
  const requests = await page.evaluate(() => homeEntryContextFixture.state().requests);
  await image.getByRole("button", { name: "Open A received image", exact: true }).click();
  await image.locator(".desktop-data__preview").waitFor({ state: "detached" });
  await image.locator("canvas").waitFor();
  const state = await page.evaluate(() => homeEntryContextFixture.state());
  assert.equal(state.presentation, "value");
  assert.deepEqual(state.focus, { kind: "value", viewId: "sibling-reader", itemId: "image", path: [], rootItem: true });
  assert.deepEqual(state.requests, requests);
  assert.deepEqual(state.imports, []);
}, "reader"));

test("expand and the context submenu open independent lenses while a name navigates in place", () => fixture(async page => {
  const list = page.locator('[data-locus-preview="known-list"]');
  await list.locator(".home-item__caption").click({ button: "right" });
  let menu = page.getByRole("menu", { name: "Data actions", exact: true });
  await menu.getByRole("menuitem", { name: "Open in a new lens", exact: true }).hover();
  await page.getByRole("menuitem", { name: "Expand over this lens", exact: true }).click();
  assert.deepEqual(await page.evaluate(() => homeEntryContextFixture.state().focus), { kind: "root" });
  await list.locator(".home-item__caption").click({ button: "right" });
  menu = page.getByRole("menu", { name: "Data actions", exact: true });
  await menu.getByRole("menuitem", { name: "Open in a new lens", exact: true }).hover();
  await page.getByRole("menuitem", { name: "Open beside this lens", exact: true }).click();
  assert.deepEqual(await page.evaluate(() => homeEntryContextFixture.state().openedLenses), [
    { scope: { kind: "view", viewId: "known-list" }, mode: "stack" },
    { scope: { kind: "view", viewId: "known-list" }, mode: "split" },
  ]);
  await list.locator(".home-item__type-tag").click({ button: "right" });
  await page.getByRole("menuitem", { name: "Create data of this type", exact: true }).waitFor();
  assert.equal(await page.getByRole("menuitem", { name: "Open", exact: true }).count(), 0);
}, "reader"));

test("failed preparation replaces computed preview spinners with an unavailable state", () => fixture(async page => {
  const card = page.locator('[data-locus-preview="computed"]');
  await card.locator(".home-new-button__spinner").waitFor();
  await page.evaluate(() => homeEntryContextFixture.failPreparation());
  await card.getByRole("button", { name: "Error. Could not prepare data tools. Open details.", exact: true }).waitFor();
  assert.equal(await card.locator(".home-new-button__spinner").count(), 0);
  assert.equal(await card.getAttribute("aria-busy"), null);
  assert.equal(await page.getByText("Already available", { exact: true }).isVisible(), true);
}, "reader"));

test("an early collection preview focuses its child without waiting for editing tools", () => fixture(async page => {
  await page.locator('[data-locus-preview="known-list"] .locus-previews__cell[data-value-preview]').click();
  await page.locator('[data-locus-preview="first"]').getByText("First item", { exact: true }).waitFor();
  assert.deepEqual(await page.evaluate(() => homeEntryContextFixture.state().focus), {
    kind: "value", viewId: "known-list", itemId: "first", path: [],
  });
  assert.deepEqual(await page.evaluate(() => homeEntryContextFixture.state().imports), []);
}, "reader"));

async function queuedReaderPaste(page: Page) {
  await contextMenu(page);
  await page.getByRole("menuitem", { name: "Paste Ctrl+V / ⌘V", exact: true }).click();
  await page.waitForFunction(() => homeEntryContextFixture.state().clipboardReads.length === 1);
  await page.evaluate(() => homeEntryContextFixture.releaseClipboard());
  await page.locator(".locus-notifications__bell").click();
  await page.getByRole("status").filter({ hasText: "Adding the data you pasted…" }).waitFor();
}

test("a scoped paste survives typed handoff and cannot be stolen by another reader or legacy Home", () => fixture(async page => {
  await queuedReaderPaste(page);
  assert.deepEqual(await page.evaluate(() => homeEntryContextFixture.takeOtherTransfers()), []);
  assert.deepEqual(await page.evaluate(() => homeEntryContextFixture.takeTransfers()), []);
  assert.equal(await page.evaluate(() => homeEntryContextFixture.flushPane()), false);
  await page.evaluate(() => homeEntryContextFixture.ready());
  await page.locator("[data-workspace-handoff]").waitFor();
  assert.deepEqual(await page.evaluate(() => homeEntryContextFixture.state().receivedTransfers), ["Captured while loading"]);
  assert.deepEqual(await page.evaluate(() => homeEntryContextFixture.takeReaderTransfers()), []);
  assert.equal(await page.evaluate(() => homeEntryContextFixture.flushPane()), true);
}, "reader"));

test("cancelling a reader's pending paste preserves another reader's queue", () => fixture(async page => {
  await queuedReaderPaste(page);
  await page.evaluate(() => homeEntryContextFixture.queueOtherTransfer());
  await page.getByRole("button", { name: "Cancel", exact: true }).click();
  assert.deepEqual(await page.evaluate(() => homeEntryContextFixture.takeReaderTransfers()), []);
  assert.deepEqual(await page.evaluate(() => homeEntryContextFixture.takeOtherTransfers().map(entry => entry.snapshot.text)), ["Other reader data"]);
  assert.equal(await page.evaluate(() => homeEntryContextFixture.flushPane()), true);
}, "reader"));

test("cancelling source preparation preserves a separately captured paste", () => fixture(async page => {
  await queuedReaderPaste(page);
  const card = page.locator('[data-locus-preview="literal"]');
  await card.locator(".home-item__body").click({ button: "right" });
  await page.getByRole("menuitem", { name: "Show Fenel code", exact: true }).click();
  await page.locator(".locus-notifications__bell").click();
  await page.getByRole("status").filter({ hasText: "Opening Fenel code…" }).waitFor();
  assert.equal(await page.evaluate(() => homeEntryContextFixture.flushPane()), false);
  await page.getByRole("button", { name: "Cancel", exact: true }).click();
  await page.getByRole("status").filter({ hasText: "Adding the data you pasted…" }).waitFor();
  assert.equal(await page.evaluate(() => homeEntryContextFixture.flushPane()), false);
  await page.evaluate(() => homeEntryContextFixture.ready());
  await page.locator("[data-workspace-handoff]").waitFor();
  assert.deepEqual(await page.evaluate(() => homeEntryContextFixture.state().receivedTransfers), ["Captured while loading"]);
  assert.deepEqual(await page.evaluate(() => homeEntryContextFixture.state().actions), [undefined]);
  assert.equal(await page.evaluate(() => homeEntryContextFixture.flushPane()), true);
}, "reader"));

test("closing the shell discards its abandoned paste without clearing a sibling", () => fixture(async page => {
  await queuedReaderPaste(page);
  await page.evaluate(() => homeEntryContextFixture.failPreparation());
  assert.equal(await page.evaluate(() => homeEntryContextFixture.flushPane()), false,
    "Failed tools cannot release a captured paste as though it were an unopened Browse request");
  await page.evaluate(() => { homeEntryContextFixture.queueOtherTransfer(); homeEntryContextFixture.dispose(); });
  assert.deepEqual(await page.evaluate(() => homeEntryContextFixture.takeReaderTransfers()), []);
  assert.deepEqual(await page.evaluate(() => homeEntryContextFixture.takeOtherTransfers().map(entry => entry.snapshot.text)), ["Other reader data"]);
}, "reader"));

test("the early pane guard protects clipboard capture and an in-flight quick write", () => fixture(async page => {
  await contextMenu(page);
  await page.getByRole("menuitem", { name: "Paste Ctrl+V / ⌘V", exact: true }).click();
  await page.waitForFunction(() => homeEntryContextFixture.state().clipboardReads.length === 1);
  assert.equal(await page.evaluate(() => homeEntryContextFixture.flushPane()), false);
  await page.evaluate(() => homeEntryContextFixture.releaseClipboard());
  await page.locator(".locus-notifications__bell").click();
  await page.getByRole("status").filter({ hasText: "Adding the data you pasted…" }).waitFor();
  await page.getByRole("button", { name: "Cancel", exact: true }).click();
  await page.locator(".locus-notifications__bell").click();
  await contextMenu(page);
  await page.locator('[data-locus-menu-item="new"] .locus-context-menu-chevron').click();
  await page.getByRole("menuitem", { name: "Text", exact: true }).click({ position: { x: 16, y: 16 } });
  await page.locator(".locus-quick-value__input").fill("Pending write");
  await page.getByRole("button", { name: "Add", exact: true }).click();
  await page.waitForFunction(() => homeEntryContextFixture.state().requests.includes("PUT /api/locus-root"));
  assert.equal(await page.evaluate(() => homeEntryContextFixture.flushPane()), false);
  await page.evaluate(() => homeEntryContextFixture.failPreparation());
  assert.equal(await page.evaluate(() => homeEntryContextFixture.flushPane()), false,
    "Failed tools cannot release an in-flight quick write");
  await page.mouse.click(950, 720);
  assert.equal(await page.locator(".locus-quick-value").count(), 1);
  await page.evaluate(() => homeEntryContextFixture.releaseWrites());
  await page.locator(".locus-quick-value").waitFor({ state: "detached" });
  assert.equal(await page.evaluate(() => homeEntryContextFixture.flushPane()), true);
  const state = await page.evaluate(() => homeEntryContextFixture.state());
  assert.equal(state.readerHeaders[state.requests.indexOf("PUT /api/locus-root")], "sibling-reader");
}, "reader"));

test("the loading Home context menu opens the full New picker and queues its chosen branch", () => fixture(async (page) => {
  await contextMenu(page);
  await page.getByRole("menuitem", { name: "New", exact: true }).click({ position: { x: 16, y: 16 } });
  await page.getByRole("heading", { name: "What do you want to create?" }).waitFor();
  assert.equal(await page.locator(".picker-chip").count(), 5);
  assert.equal(await page.locator('.home-new-button[aria-busy="true"]').count(), 0);
  assert.deepEqual(await page.evaluate(() => homeEntryContextFixture.state().imports), []);
  await page.getByRole("button", { name: /^Create a function\s+Typed inputs/ }).click();
  await page.locator('.home-new-button[aria-busy="true"]').waitFor();
  // The wait reports on the control the user clicked and NOWHERE else: no
  // status card lands in the locus body, which is for values only.
  assert.equal(await page.locator(".home-stage [role=\"status\"], .home-canvas [role=\"status\"]").count(), 0);
  await page.locator(".modal-overlay").waitFor({ state: "hidden" });
  assert.equal(await page.locator(".modal-overlay").count(), 0);
  const pending = await page.evaluate(() => homeEntryContextFixture.state());
  assert.equal(pending.ready, false);
  assert.ok(pending.requested > 0);
  assert.deepEqual(pending.actions, []);
  await page.waitForFunction(() => ["workspace", "provider"].every(name => homeEntryContextFixture.state().imports.includes(name)));
  const preparedCode = await page.evaluate(() => homeEntryContextFixture.state());
  assert.equal(preparedCode.ready, false);
  assert.deepEqual(preparedCode.actions, []);
  await page.evaluate(() => homeEntryContextFixture.ready());
  await page.locator("[data-workspace-handoff]").waitFor({ state: "attached" });
  assert.deepEqual(await page.evaluate(() => homeEntryContextFixture.state().actions), ["new:function"]);
}));

test("an item's own caption ranks with a label above its code name (Clipboard)", () => fixture(async page => {
  await page.waitForFunction(() => homeEntryContextFixture.state().rootReadsPending === 1);
  await page.evaluate(() => homeEntryContextFixture.releaseRoot(true, "temporary-tab-fixture", [
    { id: "clipboard-control", caption: "Clipboard", representations: { Codeable: { codeName: "clipboard" } },
      source: { kind: "expr", expr: { kind: "literal", value: "copied" } }, valueType: { $ref: "String" } },
  ]));
  const caption = page.locator('.home-item[data-locus-item="clipboard-control"] .home-item__caption');
  await caption.waitFor();
  assert.equal((await caption.innerText()).trim(), "Clipboard");
  assert.equal(await caption.locator("code").count(), 0, "A human caption is not shown in the code face");
}, "local-new-pending"));

for (const kind of ["function", "type"] as const) test(`pending Local ${kind} creation retains its branch when the reader runtime is published`, () => fixture(async page => {
  await page.waitForFunction(() => homeEntryContextFixture.state().rootReadsPending === 1);
  await page.evaluate(() => homeEntryContextFixture.releaseRoot(true, "temporary-tab-fixture", [
    { id: "native-text-control", caption: "Data", source: { kind: "expr", expr: { kind: "literal", value: "native String" } }, valueType: { $ref: "String" } },
  ]));
  await page.locator(".home-canvas").waitFor();
  await page.locator('.home-item[data-locus-item="native-text-control"] .home-item__caption').click({ button: "right" });
  await page.getByRole("menuitem", { name: "New beside", exact: true }).click({ position: { x: 16, y: 16 } });
  await page.locator(`button.picker-chip--${kind}`).click();
  await page.evaluate(() => homeEntryContextFixture.releaseGraphReader());
  await page.locator("[data-workspace-handoff]").waitFor();
  assert.deepEqual(await page.evaluate(() => homeEntryContextFixture.state().actions), [`new:${kind}`]);
}, "local-new-pending"));

for (const kind of ["function", "type"] as const) test(`Local ${kind} creation retargets a prepared Home whose first read is still pending`, () => fixture(async page => {
  await page.waitForFunction(() => homeEntryContextFixture.state().rootReadsPending === 1);
  await page.evaluate(() => {
    homeEntryContextFixture.releaseRoot(true, "temporary-tab-fixture", [
      { id: "native-text-control", caption: "Data", source: { kind: "expr", expr: { kind: "literal", value: "native String" } }, valueType: { $ref: "String" } },
    ]);
  });
  await page.locator('.home-item[data-locus-item="native-text-control"] .home-item__caption').waitFor();
  await page.evaluate(() => homeEntryContextFixture.ready());
  await page.waitForFunction(() => homeEntryContextFixture.state().handoffFactories.length === 1);
  assert.deepEqual(await page.evaluate(() => homeEntryContextFixture.state().actions), []);
  await page.locator('.home-item[data-locus-item="native-text-control"] .home-item__caption').click({ button: "right" });
  await page.getByRole("menuitem", { name: "New beside", exact: true }).click({ position: { x: 16, y: 16 } });
  await page.locator(`button.picker-chip--${kind}`).click();
  await page.evaluate(() => homeEntryContextFixture.releaseHandoff());
  await page.locator("[data-workspace-handoff]").waitFor();
  assert.deepEqual(await page.evaluate(() => homeEntryContextFixture.state().actions), [`new:${kind}`]);
}, "local-new-held-mount"));

async function portalHomeHandoff(page: Page, scenario: string, replaceFrame = false) {
  const settle = () => page.evaluate(async () => {
    await Promise.all(document.getAnimations().filter(animation => animation.effect?.getTiming().iterations !== Infinity)
      .map(animation => animation.finished.catch(() => undefined)));
    await new Promise<void>(resolve => requestAnimationFrame(() => requestAnimationFrame(() => resolve())));
  });
  const capture = async (stage: string) => {
    await settle();
    const directory = process.env["FENEL_HOME_ENTRY_CAPTURE_DIR"];
    if (!directory) return;
    await mkdir(directory, { recursive: true });
    await page.screenshot({ path: join(directory, `20261024-portal-${scenario}-${stage}.png`), fullPage: false });
  };
  const controls = async () => {
    const toolbar = page.locator(".home-toolbar");
    const newData = page.getByRole("button", { name: "New data", exact: true });
    const browse = page.getByRole("button", { name: "Browse", exact: true });
    const path = page.getByRole("navigation", { name: "Where you are", exact: true });
    const summary = page.locator(".lens-data-summary");
    for (const control of [toolbar, newData, browse, path, summary]) {
      assert.equal(await control.count(), 1, "The current frame has exactly one copy of every reader control");
      assert.equal(await control.isVisible(), true, "Reader controls stay visible through the prepared Home handoff");
    }
    assert.equal(await path.getByRole("button", { name: "All data", exact: true }).count(), 1);
    assert.equal(await page.locator(".home-entry .home-toolbar, .home-entry .lens-data-summary").count(), 0,
      "Both control surfaces must use their external Portal mounts, not inline fixture fallbacks");
    const state = await page.evaluate(() => homeEntryContextFixture.portalState());
    assert.equal(state.toolbarConnected, true);
    assert.equal(state.summaryConnected, true);
  };

  await page.waitForFunction(() => homeEntryContextFixture.state().rootReadsPending === 1);
  await page.evaluate(() => homeEntryContextFixture.releaseRoot(true, "temporary-tab-fixture", [
    { id: "portal-clipboard", caption: "Clipboard", source: { kind: "expr", expr: { kind: "literal", value: { __list: [] } } } },
    { id: "portal-available", caption: "Available before editing", source: { kind: "expr", expr: { kind: "literal", value: "Available before editing" } } },
  ]));
  const available = page.locator('[data-locus-preview="portal-available"]');
  await available.waitFor().finally(() => capture("loaded"));
  await controls();
  const original = await page.locator(".home-entry").elementHandle();
  assert.ok(original);
  assert.equal(await page.locator('[data-locus-preview="portal-clipboard"]').count(), 1);
  const initialFrame = await page.evaluate(() => homeEntryContextFixture.portalState().frame);

  await page.getByRole("button", { name: "More creation options", exact: true }).click();
  await page.locator("button.picker-chip--function").click();
  await capture("function-pending");
  await controls();
  assert.equal(await page.locator('.home-new-button[aria-busy="true"] .home-new-button__spinner').count(), 1);
  assert.equal(await available.isVisible(), true);
  assert.deepEqual(await page.evaluate(() => homeEntryContextFixture.state().actions), []);
  await page.getByRole("button", { name: "New data", exact: true }).click();
  await settle();
  await controls();
  assert.equal(await page.locator('.home-new-button[aria-busy="true"]').count(), 0,
    "The externally mounted pending New remains actionable and cancels preparation intent");
  await page.getByRole("button", { name: "More creation options", exact: true }).click();
  await page.locator("button.picker-chip--function").click();
  await capture("function-pending-rechosen");
  await controls();

  if (replaceFrame) {
    await page.evaluate(() => homeEntryContextFixture.replacePortalFrame());
    await capture("frame-replaced");
    assert.notEqual(await page.evaluate(() => homeEntryContextFixture.portalState().frame), initialFrame);
    await controls();
    assert.equal(await original.evaluate(element => element.isConnected), true, "Replacing frame holders retains the original reader");
    assert.equal(await page.locator('.home-new-button[aria-busy="true"] .home-new-button__spinner').count(), 1);
    assert.equal(await available.isVisible(), true);
  }

  const heldSource = await page.evaluate(() => {
    const state = homeEntryContextFixture.state();
    return { focus: state.focus, inspectionMode: state.inspectionMode };
  });
  await page.evaluate(() => homeEntryContextFixture.ready());
  await page.waitForFunction(() => homeEntryContextFixture.state().handoffFactories.length === 1)
    .finally(() => capture("handoff-pending"));
  await controls();
  // HomeEntry's inner Loading boundary paints its own earlyShell fallback.
  // The same state owner retains the data and controls; DOM-node identity is
  // not the contract when the outer Show transfers to that inner boundary.
  assert.equal(await page.locator(".home-entry").count(), 1);
  const pendingShell = await page.locator(".home-entry").elementHandle();
  assert.ok(pendingShell);
  assert.equal(await pendingShell.evaluate(element => element.isConnected), true);
  assert.equal(await available.isVisible(), true);
  assert.equal(await available.locator(".home-item__body").getByText("Available before editing", { exact: true }).isVisible(), true);
  assert.equal(await page.locator('[data-locus-preview="portal-clipboard"]').count(), 1);
  assert.deepEqual(await page.evaluate(() => {
    const state = homeEntryContextFixture.state();
    return { focus: state.focus, inspectionMode: state.inspectionMode };
  }), heldSource);
  assert.equal(await page.locator('[data-portal-owner="prepared"]').count(), 0);
  assert.deepEqual(await page.evaluate(() => homeEntryContextFixture.state().actions), []);

  await page.evaluate(() => homeEntryContextFixture.releaseHandoff());
  const prepared = page.locator('[data-workspace-handoff="true"][data-portal-owner="prepared"]');
  await prepared.waitFor({ state: "attached" }).finally(() => capture("prepared"));
  await controls();
  assert.equal(await pendingShell.evaluate(element => element.isConnected), false, "The completed successor retires the loading fallback body");
  assert.equal(await original.evaluate(element => element.isConnected), false, "The completed successor retires the initial reader body");
  assert.equal(await page.locator(".home-entry").count(), 1);
  assert.equal(await prepared.locator(".home-entry").count(), 1);
  assert.deepEqual(await page.evaluate(() => homeEntryContextFixture.state().actions), ["new:function"]);
}

test("portal Home handoff retains toolbar and summary while Function tools prepare", () => fixture(
  page => portalHomeHandoff(page, "local-new-held-portal"), "local-new-held-portal"));

test("portal Home handoff reattaches controls when the frame holder changes before readiness", () => fixture(
  page => portalHomeHandoff(page, "local-new-held-portal-reframe", true), "local-new-held-portal-reframe"));

// The address preview hands its lens to the real lens owner. A Function chosen
// in the still-shown preview is retained for the lens AFTER the replacement
// owner read its creation draft; that owner must arm it, not open a bare Home.
test("a Local function retained for this lens after its owner mounted opens in the prepared Home", () => fixture(async page => {
  await page.waitForFunction(() => homeEntryContextFixture.state().rootReadsPending === 1);
  await page.evaluate(() => homeEntryContextFixture.releaseRoot(true, "temporary-tab-fixture", []));
  await page.locator(".home-canvas").waitFor();
  assert.equal(await page.locator('.home-new-button[aria-busy="true"]').count(), 0);
  await page.evaluate(() => homeEntryContextFixture.retainCreationDraft({ focus: { kind: "root" }, action: "new:function" }));
  // The adopted request reports itself on the control, like one armed here.
  await page.locator('.home-new-button[aria-busy="true"]').waitFor();
  await page.evaluate(() => homeEntryContextFixture.releaseGraphReader());
  await page.locator("[data-workspace-handoff]").waitFor();
  assert.deepEqual(await page.evaluate(() => homeEntryContextFixture.state().actions), ["new:function"]);
}, "local-new-late-draft"));

test("a creation draft written while the prepared Home is shown neither remounts nor re-arms it", () => fixture(async page => {
  await page.waitForFunction(() => homeEntryContextFixture.state().rootReadsPending === 1);
  await page.evaluate(() => homeEntryContextFixture.releaseRoot(true, "temporary-tab-fixture", []));
  await page.locator(".home-canvas").waitFor();
  await page.evaluate(() => homeEntryContextFixture.releaseGraphReader());
  await page.locator("[data-workspace-handoff]").waitFor();
  assert.deepEqual(await page.evaluate(() => homeEntryContextFixture.state().actions), [undefined]);
  await page.evaluate(() => homeEntryContextFixture.retainCreationDraft({ focus: { kind: "root" }, action: "new:type" }));
  await page.evaluate(() => new Promise<void>(resolve => requestAnimationFrame(() => requestAnimationFrame(() => resolve()))));
  assert.deepEqual(await page.evaluate(() => homeEntryContextFixture.state().actions), [undefined]);
  assert.equal(await page.locator("[data-workspace-handoff]").count(), 1);
}, "local-new-late-draft"));

test("a quick type you can simply TYPE does not wait for the engine at all", () => fixture(async (page) => {
  await contextMenu(page);
  await page.locator('[data-locus-menu-item="new"] .locus-context-menu-chevron').click();
  await page.getByRole("menuitem", { name: "Text", exact: true }).click({ position: { x: 16, y: 16 } });
  // The small card opens HERE. It used to arm a pending intent and wait for the
  // workspace, which is what the previous version of this test pinned.
  await page.locator(".locus-quick-value").waitFor();
  assert.equal(await page.locator(".modal-overlay").count(), 0);
  assert.equal(await page.locator('.home-new-button[aria-busy="true"]').count(), 0);
  // And it did it with no engine loaded — the whole point.
  assert.deepEqual(await page.evaluate(() => homeEntryContextFixture.state().imports), []);
  assert.deepEqual(await page.evaluate(() => homeEntryContextFixture.state().actions), []);
}));

test("a quick type with no inline shape still hands off its object action and canvas point", () => fixture(async (page) => {
  const point = await contextMenu(page);
  await page.locator('[data-locus-menu-item="new"] .locus-context-menu-chevron').click();
  // `List` has no direct inline shape, so it takes the hand-off path.
  await page.getByRole("menuitem", { name: "List", exact: true }).click({ position: { x: 16, y: 16 } });
  await page.locator('.home-new-button[aria-busy="true"]').waitFor();
  assert.equal(await page.locator(".locus-quick-value").count(), 0);
  assert.equal(await page.locator(".modal-overlay").count(), 0);
  await page.waitForFunction(() => ["workspace", "provider"].every(name => homeEntryContextFixture.state().imports.includes(name)));
  assert.deepEqual(await page.evaluate(() => homeEntryContextFixture.state().actions), []);
  await page.evaluate(() => homeEntryContextFixture.ready());
  await page.locator("[data-workspace-handoff]").waitFor({ state: "attached" });
  const actions = await page.evaluate(() => homeEntryContextFixture.state().actions);
  assert.equal(actions.length, 1);
  const action = actions[0];
  assert.ok(action && typeof action === "object");
  assert.equal(action.kind, "new:value");
  assert.equal(action.typeName, "List");
  assert.ok(action.point && Math.abs(action.point.x - point.x) < 0.002 && Math.abs(action.point.y - point.y) < 0.002);
}));

async function localPasteEvent(page: Page, text = "A pasted note", image = false) {
  await page.evaluate(({ text, image }) => {
    const transfer = new DataTransfer();
    if (image) transfer.items.add(new File([new Uint8Array([137, 80, 78, 71])], "image.png", { type: "image/png" }));
    else transfer.setData("text/plain", text);
    document.body.dispatchEvent(new ClipboardEvent("paste", { clipboardData: transfer, bubbles: true, cancelable: true }));
  }, { text, image });
}

async function verifyLocalRootPaste() {
  return fixture(async page => {
  await page.locator(".home-new-button").waitFor();
  await page.waitForFunction(() => document.querySelector(".home-canvas")?.getAttribute("data-drop-pending") !== "true");
  await localPasteEvent(page, "", true);
  const capture = process.env["FENEL_HOME_ENTRY_CAPTURE_DIR"];
  const size = process.env["FENEL_HOME_ENTRY_PHONE"] === "1" ? "phone" : "desktop";
  const capturePulse = capture && process.env["FENEL_HOME_ENTRY_PASTE_PULSE"] === "1";
  if (process.env["FENEL_HOME_ENTRY_PASTE_BASELINE"] === "1") {
    assert.equal(await page.locator(".fenel-transfer-feedback").count(), 0);
    if (capturePulse) await page.screenshot({ path: join(capture, `local-paste-pulse-before-${size}.png`), animations: "disabled" });
    await page.locator(".locus-notifications__bell").click();
    await page.getByRole("status").filter({ hasText: "Adding the data you pasted…" }).waitFor();
    if (capture) await page.screenshot({ path: join(capture, "local-paste-before.png"), animations: "disabled" });
    return;
  }
  await page.waitForFunction(() => homeEntryContextFixture.externalState().attempts.length === 1);
  assert.equal(await page.locator(".fenel-transfer-feedback").count(), 1);
  let state = await page.evaluate(() => homeEntryContextFixture.state());
  assert.equal(state.requested, 0, "A decoded Local-root paste must not wait for the editor");
  assert.deepEqual(state.imports, []);
  assert.deepEqual(state.actions, []);
  async function pulseFrame(name: "adding" | "added") {
    if (!capturePulse) return;
    const pulse = page.locator(".fenel-transfer-feedback");
    const animations = await pulse.evaluate(element => {
      const animations = element.getAnimations();
      for (const animation of animations) { animation.pause(); animation.currentTime = 300; }
      return animations.length;
    });
    assert.ok(animations > 0, "Capture must pause the actual feedback animation");
    await page.evaluate(() => new Promise(resolve => requestAnimationFrame(resolve)));
    await page.screenshot({ path: join(capture!, `local-paste-pulse-${name}-${size}.png`) });
  }
  await pulseFrame("adding");
  await page.evaluate(() => homeEntryContextFixture.publishExternal(0));
  await page.locator('[data-locus-preview="pasted-0"]').waitFor();
  await page.locator('[data-locus-preview="pasted-0"] canvas').waitFor();
  assert.equal(await page.getByText("image.png", { exact: true }).count(), 0);
  assert.equal(await page.locator(".fenel-transfer-feedback--complete").count(), 1);
  assert.equal(await page.locator(".locus-notifications__bell").count(), 0);
  state = await page.evaluate(() => homeEntryContextFixture.state());
  assert.equal(state.requested, 0);
  assert.deepEqual(state.imports, []);
  await pulseFrame("added");
  if (capture) await page.screenshot({ path: join(capture, "local-paste-after.png"), animations: "disabled" });
  }, "local-paste");
}

test("Local root paste gives immediate feedback and publishes without preparing authoring", async () => {
  if (process.env["FENEL_HOME_ENTRY_PASTE_PULSE_BOTH"] !== "1") return verifyLocalRootPaste();
  const previous = process.env["FENEL_HOME_ENTRY_PHONE"];
  try {
    for (const phone of ["0", "1"]) {
      process.env["FENEL_HOME_ENTRY_PHONE"] = phone;
      await verifyLocalRootPaste();
    }
  } finally {
    if (previous === undefined) delete process.env["FENEL_HOME_ENTRY_PHONE"];
    else process.env["FENEL_HOME_ENTRY_PHONE"] = previous;
  }
});

test("Local unsupported paste hands its retained capture to the existing editor once", () => fixture(async page => {
  await localPasteEvent(page, "{ complex: data }");
  await page.waitForFunction(() => homeEntryContextFixture.externalState().attempts.length === 1);
  await page.evaluate(() => homeEntryContextFixture.rejectExternal(0, true));
  await page.waitForFunction(() => homeEntryContextFixture.state().requested === 1);
  assert.equal(await page.evaluate(() => homeEntryContextFixture.externalState().attempts.length), 1);
  await page.evaluate(() => homeEntryContextFixture.ready());
  await page.locator("[data-workspace-handoff]").waitFor();
  assert.deepEqual(await page.evaluate(() => homeEntryContextFixture.state().receivedTransfers), ["{ complex: data }"]);
  assert.equal(await page.evaluate(() => homeEntryContextFixture.state().actions.length), 1);
}, "local-paste"));

test("Local failed paste keeps Retry and Cancel on its queued capture", () => fixture(async page => {
  await localPasteEvent(page);
  await page.waitForFunction(() => homeEntryContextFixture.externalState().attempts.length === 1);
  await page.evaluate(() => homeEntryContextFixture.rejectExternal(0));
  await page.locator(".locus-notifications__bell").click();
  const notices = page.getByRole("dialog", { name: "Notifications", exact: true });
  await notices.getByRole("button", { name: "Retry paste", exact: true }).click();
  await page.waitForFunction(() => homeEntryContextFixture.externalState().attempts.length === 2);
  await page.evaluate(() => homeEntryContextFixture.rejectExternal(1));
  if (await notices.count() === 0) await page.locator(".locus-notifications__bell").click();
  await page.getByRole("dialog", { name: "Notifications", exact: true }).getByRole("button", { name: "Cancel", exact: true }).click();
  // The shared center keeps historical failures after their live action has
  // retired, without retaining callbacks into the cancelled source.
  await page.getByRole("dialog", { name: "Notifications", exact: true }).getByRole("button", { name: "Retry paste", exact: true }).waitFor({ state: "detached" });
  assert.equal(await page.getByRole("dialog", { name: "Notifications", exact: true }).getByRole("button", { name: "Cancel", exact: true }).count(), 0);
  await page.getByRole("dialog", { name: "Notifications", exact: true }).getByRole("button", { name: "Dismiss", exact: true }).click();
  await page.locator(".locus-notifications__bell").waitFor({ state: "detached" });
  await page.evaluate(() => homeEntryContextFixture.ready());
  assert.deepEqual(await page.evaluate(() => homeEntryContextFixture.externalState().items), []);
  assert.deepEqual(await page.evaluate(() => homeEntryContextFixture.state().receivedTransfers), []);
  assert.equal(await page.evaluate(() => homeEntryContextFixture.state().requested), 0);
}, "local-paste"));

test("Local replacement paste resumes after a cancelled browser import finishes", () => fixture(async page => {
  await localPasteEvent(page, "cancel old import");
  await page.waitForFunction(() => homeEntryContextFixture.externalState().attempts.length === 1);
  await page.locator(".locus-notifications__bell").click();
  await page.getByRole("dialog", { name: "Notifications", exact: true }).getByRole("button", { name: "Cancel", exact: true }).click();
  await page.locator(".locus-notifications__bell").waitFor({ state: "detached" });
  await localPasteEvent(page, "replacement import");
  assert.equal(await page.evaluate(() => homeEntryContextFixture.externalState().attempts.length), 1);
  await page.evaluate(() => homeEntryContextFixture.rejectExternal(0));
  await page.waitForFunction(() => homeEntryContextFixture.externalState().attempts.length === 2);
  await page.evaluate(() => homeEntryContextFixture.publishExternal(1, "replacement import"));
  await page.locator('[data-locus-preview="pasted-1"]').waitFor();
  assert.deepEqual(await page.evaluate(() => homeEntryContextFixture.externalState().items), ["pasted-1"]);
  assert.equal(await page.evaluate(() => homeEntryContextFixture.state().requested), 0);
}, "local-paste-delayed-abort"));

test("Local paste resumes after initial cookie resolution only when publication has not happened", () => fixture(async page => {
  await localPasteEvent(page, "survives initial cookie resolution");
  await page.waitForFunction(() => homeEntryContextFixture.externalState().attempts.length === 1);
  await page.evaluate(() => homeEntryContextFixture.pasteSession("signed-in"));
  await page.waitForFunction(() => homeEntryContextFixture.externalState().attempts.length === 2);
  const attempts = await page.evaluate(() => homeEntryContextFixture.externalState().attempts);
  assert.equal(attempts[0]!.settled, true);
  assert.equal(attempts[1]!.text, "survives initial cookie resolution");
  await page.evaluate(() => homeEntryContextFixture.publishExternal(1));
  await page.locator('[data-locus-preview="pasted-1"]').waitFor();
  assert.deepEqual(await page.evaluate(() => homeEntryContextFixture.externalState().items), ["pasted-1"]);
  assert.equal(await page.evaluate(() => homeEntryContextFixture.state().requested), 0);
}, "local-paste"));

test("Local acknowledged paste survives initial sign-in as data without replaying its capture", () => fixture(async page => {
  await localPasteEvent(page, "published before the cookie resolves");
  await page.waitForFunction(() => homeEntryContextFixture.externalState().attempts.length === 1);
  await page.evaluate(() => { homeEntryContextFixture.publishExternal(0); homeEntryContextFixture.pasteSession("signed-in"); });
  await page.locator('[data-locus-preview="pasted-0"]').waitFor();
  assert.equal(await page.evaluate(() => homeEntryContextFixture.externalState().attempts.length), 1);
  assert.deepEqual(await page.evaluate(() => homeEntryContextFixture.externalState().items), ["pasted-0"]);
  assert.equal(await page.evaluate(() => homeEntryContextFixture.state().requested), 0);
}, "local-paste"));

test("Local source guidance uses the existing notice and String renderer without authoring", () => fixture(async page => {
  const note = "This JSON is large, so its exact text was preserved. Paste a smaller part to edit it as structured data.";
  const text = '{"example":"Exact JSON text is preserved here"}';
  await localPasteEvent(page, text);
  await page.waitForFunction(() => homeEntryContextFixture.externalState().attempts.length === 1);
  await page.evaluate(({ text, note }) => homeEntryContextFixture.publishExternal(0, text, [note]), { text, note });
  const data = page.locator('[data-locus-preview="pasted-0"]');
  await data.waitFor();
  await data.getByText(text, { exact: true }).waitFor();
  assert.equal(await page.evaluate(() => homeEntryContextFixture.state().requested), 0);
  await page.locator(".locus-notifications__bell").click();
  await page.getByRole("dialog", { name: "Notifications", exact: true }).getByRole("status").filter({ hasText: note }).waitFor();
  const capture = process.env["FENEL_HOME_ENTRY_CAPTURE_DIR"];
  if (capture) await page.screenshot({ path: join(capture, "local-paste-guidance-after.png"), animations: "disabled" });
}, "local-paste"));

test("visible prepared Home owns body paste after a cancelled New and late tool readiness", () => fixture(async page => {
  await page.locator(".home-new-button").click();
  const composer = page.getByRole("dialog", { name: "New data", exact: true });
  await composer.getByRole("button", { name: "Close new data", exact: true }).click();
  await composer.waitFor({ state: "detached" });
  await page.evaluate(() => homeEntryContextFixture.ready());
  const prepared = page.locator("[data-prepared-owner]");
  await prepared.waitFor();
  await page.evaluate(() => new Promise(resolve => requestAnimationFrame(resolve)));
  assert.deepEqual(await page.evaluate(() => homeEntryContextFixture.state().actions), [undefined]);
  const mounted = await prepared.getAttribute("data-prepared-owner");
  await prepared.evaluate(element => { Object.assign(element, { retainedPreparedDraft: "Keep this prepared owner" }); });
  await localPasteEvent(page, "Owned by prepared Home");
  await page.waitForFunction(() => homeEntryContextFixture.preparedPasteState().received.length === 1);
  assert.equal(await prepared.getAttribute("data-prepared-owner"), mounted);
  assert.equal(await prepared.evaluate(element => (element as HTMLElement & { retainedPreparedDraft?: string }).retainedPreparedDraft), "Keep this prepared owner");
  assert.deepEqual(await page.evaluate(() => homeEntryContextFixture.preparedPasteState()), {
    mounts: 1, disposals: 0, received: ["Owned by prepared Home"],
  });
  assert.deepEqual(await page.evaluate(() => homeEntryContextFixture.externalState().attempts), []);
  assert.equal(await page.locator('[data-locus-surface="shell"]').count(), 0);
}, "local-paste-prepared-owner"));

test("Paste captures rich clipboard data and queues its view and position while the workspace loads", () => fixture(async (page) => {
  const point = await contextMenu(page, 0.4, 0.6);
  await page.getByRole("menuitem", { name: "Paste Ctrl+V / ⌘V", exact: true }).click();
  await page.locator(".locus-notifications__bell").waitFor();
  await page.locator(".locus-notifications__bell").click();
  await page.getByRole("status").filter({ hasText: "Reading the clipboard…" }).waitFor();
  assert.deepEqual(await page.evaluate(() => homeEntryContextFixture.state().clipboardReads), [true]);
  assert.deepEqual(await page.evaluate(() => homeEntryContextFixture.state().imports), []);
  await page.evaluate(() => homeEntryContextFixture.releaseClipboard());
  await page.getByRole("status").filter({ hasText: "Adding the data you pasted…" }).waitFor();
  await page.waitForFunction(() => ["workspace", "provider"].every(name => homeEntryContextFixture.state().imports.includes(name)));
  const state = await page.evaluate(() => homeEntryContextFixture.state());
  assert.equal(state.ready, false);
  assert.deepEqual([...state.imports].sort(), ["provider", "workspace"]);
  assert.deepEqual(state.actions, []);
  const queued = await page.evaluate(() => homeEntryContextFixture.takeTransfers());
  assert.equal(queued.length, 1);
  assert.equal(queued[0]!.viewId, "empty-home");
  assert.equal(queued[0]!.snapshot.text, "Captured while loading");
  assert.equal(queued[0]!.snapshot.html, "<b>Captured while loading</b>");
  assert.ok(queued[0]!.point && Math.abs(queued[0]!.point!.x - point.x) < 0.002 && Math.abs(queued[0]!.point!.y - point.y) < 0.002);
  assert.deepEqual(await page.evaluate(() => homeEntryContextFixture.takeTransfers()), []);
  assert.equal(await page.getByRole("alert").count(), 0);
}));

test("cancelling a queued Paste discards its snapshot and does not hand it off when readiness arrives", () => fixture(async (page) => {
  await contextMenu(page);
  await page.getByRole("menuitem", { name: "Paste Ctrl+V / ⌘V", exact: true }).click();
  await page.locator(".locus-notifications__bell").waitFor();
  await page.locator(".locus-notifications__bell").click();
  await page.getByRole("status").filter({ hasText: "Reading the clipboard…" }).waitFor();
  await page.evaluate(() => homeEntryContextFixture.releaseClipboard());
  await page.getByRole("status").filter({ hasText: "Adding the data you pasted…" }).waitFor();
  await page.getByRole("button", { name: "Cancel", exact: true }).click();
  await page.locator(".locus-notifications__bell").waitFor({ state: "detached" });
  assert.deepEqual(await page.evaluate(() => homeEntryContextFixture.takeTransfers()), []);
  assert.deepEqual(await page.evaluate(() => homeEntryContextFixture.state().actions), []);
  await page.evaluate(() => homeEntryContextFixture.ready());
  await page.waitForFunction(() => document.querySelector(".home-new-button")?.getAttribute("data-workspace-ready") === "true");
  const state = await page.evaluate(() => homeEntryContextFixture.state());
  await page.waitForFunction(() => ["workspace", "provider"].every(name => homeEntryContextFixture.state().imports.includes(name)));
  assert.deepEqual(state.actions, []);
  assert.deepEqual(await page.evaluate(() => homeEntryContextFixture.takeTransfers()), []);
}));

test("startup waits in the toolbar, recovers, and exposes no operations on unloaded data", () => fixture(async (page) => {
  await page.getByRole("status").filter({ hasText: "The server is starting…" }).waitFor();
  assert.equal(await page.getByRole("button", { name: "Data operations" }).count(), 0);
  assert.equal(await page.locator(".home-stage [role=alert], .workspace-error").count(), 0);
  assert.equal(await page.locator(".locus-notifications__bell--error").count(), 0);
  await page.evaluate(() => homeEntryContextFixture.serverReady());
  await page.locator(".home-read-status").waitFor({ state: "detached" });
  assert.equal(await page.locator(".home-canvas").innerText(), "");
  assert.equal(await page.locator(".locus-notifications__bell--error").count(), 0);
  assert.equal(await page.evaluate(() => homeEntryContextFixture.state().requests.filter((path) => path === "GET /api/locus-root").length), 2);
}, "starting"));

test("a terminal read failure keeps one compact recovery card at the failed surface", () => fixture(async (page) => {
  const card = page.getByRole("button", { name: "Error. Could not load data. Open details.", exact: true });
  await card.waitFor();
  assert.equal(await page.getByRole("button", { name: "Data operations" }).count(), 0);
  assert.equal(await page.locator(".workspace-error").count(), 0);
  assert.equal(await page.locator(".locus-notifications__bell").count(), 0);
  assert.equal(await page.getByRole("alert").count(), 1);
  assert.equal(await card.innerText(), "Error");
  await card.click();
  const details = page.getByRole("dialog", { name: "Could not load data.", exact: true });
  await details.waitFor();
  await details.getByRole("button", { name: "Retry", exact: true }).waitFor();
  await page.keyboard.press("Escape");
  await details.waitFor({ state: "detached" });
  assert.equal(await card.evaluate(element => element === document.activeElement), true);
}, "denied"));

test("mobile notifications stay inside the viewport from either bar edge and expose details and actions", () => fixture(async (page) => {
  await page.setViewportSize({ width: 360, height: 640 });
  // A central bell and a filtered ancestor reproduce the clipped phone panel.
  await page.addStyleTag({ content: ".app-notification-host { position: fixed; width: 28px; top: 16px; left: 136px; right: auto; backdrop-filter: blur(8px); }" });
  const detail = `API request failed: ${"long-response-token".repeat(15)}\n${"More request details.\n".repeat(45)}`;
  await page.evaluate((message) => homeEntryContextFixture.notify(message), detail);
  await page.locator(".locus-notifications__bell").click();
  const panel = page.getByRole("dialog", { name: "Notifications" });
  const insideViewport = async () => {
    const bounds = await panel.boundingBox();
    assert.ok(bounds && bounds.x >= 7 && bounds.y >= 7 && bounds.x + bounds.width <= 353 && bounds.y + bounds.height <= 633);
    assert.equal(await panel.evaluate(element => element.scrollWidth <= element.clientWidth), true);
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true);
  };
  await insideViewport();
  await panel.getByText("Details", { exact: true }).click();
  assert.equal(await panel.locator("details").getAttribute("open"), "");
  assert.equal(await panel.locator("details p").textContent(), detail);
  await insideViewport();
  // Scrolling a long detail keeps both the action and dismissal reachable.
  await panel.getByRole("button", { name: "Reload page" }).click();
  assert.equal(await page.evaluate(() => homeEntryContextFixture.state().noticeRetries), 1);
  await page.keyboard.press("Escape");
  await panel.waitFor({ state: "detached" });
  await page.locator(".app-notification-host").evaluate(element => { (element as HTMLElement).style.top = "584px"; });
  await page.locator(".locus-notifications__bell").click();
  await insideViewport();
  assert.ok((await panel.boundingBox())!.y < 584);
  await panel.getByRole("button", { name: "Dismiss", exact: true }).click();
  await panel.waitFor({ state: "detached" });
  assert.equal(await page.locator(".locus-notifications__bell").count(), 0);
}));

test("preview failures open details and retry while disposal retires the dialog and callbacks", () => fixture(async page => {
  await page.emulateMedia({ reducedMotion: "reduce" });
  await page.evaluate(() => homeEntryContextFixture.transientFailure(true));
  const card = page.getByRole("button", { name: "Error. Could not preview this data. Open details.", exact: true });
  await card.waitFor();
  assert.equal(await page.locator(".locus-notifications__bell").count(), 0);
  const captureDirectory = process.env["FENEL_HOME_ENTRY_CAPTURE_DIR"];
  if (captureDirectory) await page.screenshot({ path: join(captureDirectory, "error-card.png") });
  await card.focus();
  await page.keyboard.press("Enter");
  const panel = page.getByRole("dialog", { name: "Could not preview this data.", exact: true });
  await panel.waitFor();
  const modalBounds = (await panel.boundingBox())!;
  const viewport = page.viewportSize()!;
  assert.ok(Math.abs(modalBounds.x + modalBounds.width / 2 - viewport.width / 2) < 1,
    "Error details use the shared modal's horizontal center after the global reset");
  assert.ok(Math.abs(modalBounds.y + modalBounds.height / 2 - viewport.height / 2) < 1,
    "Error details use the shared modal's vertical center after the global reset");
  if (captureDirectory) await page.screenshot({ path: join(captureDirectory, "error-details-centered.png") });
  assert.equal(await panel.getByText("The preview reader reported a problem.", { exact: true }).count(), 1);
  assert.equal(await panel.getByRole("button", { name: "Close", exact: true }).count(), 0,
    "Error details use the modal's close control without repeating it below the message");
  assert.equal(await panel.getByRole("button", { name: "Close error details", exact: true }).evaluate(element => element === document.activeElement), true);
  await page.keyboard.press("Escape");
  await panel.waitFor({ state: "detached" });
  assert.equal(await card.evaluate(element => element === document.activeElement), true);
  await card.click();
  await panel.getByRole("button", { name: "Retry", exact: true }).click();
  await panel.waitFor({ state: "detached" });
  assert.equal(await page.evaluate(() => homeEntryContextFixture.state().noticeRetries), 1);
  await card.click();
  await panel.waitFor();
  await page.evaluate(() => homeEntryContextFixture.transientFailure(false));
  await card.waitFor({ state: "detached" });
  await panel.waitFor({ state: "detached" });
  assert.equal(await page.locator("dialog[open]:not([aria-hidden=true])").count(), 0);
  assert.equal(await page.locator(".locus-notifications__bell").count(), 0);
  assert.equal(await page.locator(".modal-transition--leaving").evaluateAll(elements => elements.every(element => (element as HTMLElement).inert && element.getAttribute("aria-hidden") === "true")), true);
  await page.evaluate(() => homeEntryContextFixture.transientFailure(true));
  await card.click();
  await panel.getByRole("button", { name: "Retry", exact: true }).waitFor();
  await panel.getByRole("button", { name: "Close error details", exact: true }).click();
  await panel.waitFor({ state: "detached" });
  assert.equal(await card.count(), 1);
}));

test("identical live reports deduplicate and dismissal reaches every contributing source", () => fixture(async page => {
  await page.evaluate(() => {
    homeEntryContextFixture.notify("One failing data reader.");
    homeEntryContextFixture.notifyTwin("One failing data reader.");
  });
  const bell = page.locator(".locus-notifications__bell");
  await bell.click();
  const panel = page.getByRole("dialog", { name: "Notifications" });
  assert.equal(await bell.getAttribute("aria-label"), "1 notification");
  assert.equal(await panel.getByRole("alert").count(), 1);
  await panel.getByRole("button", { name: "Dismiss", exact: true }).click();
  await bell.waitFor({ state: "detached" });
  await page.evaluate(() => homeEntryContextFixture.notifyTwin("Another failing data reader."));
  await bell.waitFor();
  assert.equal(await bell.getAttribute("aria-label"), "1 notification");
}));

test("progress notices expire normally and session changes clear retained private reports", () => fixture(async page => {
  await page.evaluate(() => homeEntryContextFixture.progress(true));
  const bell = page.locator(".locus-notifications__bell");
  await bell.waitFor();
  await page.evaluate(() => homeEntryContextFixture.progress(false));
  await bell.waitFor({ state: "detached" });
  await page.evaluate(() => homeEntryContextFixture.notify("Private reader failure."));
  await bell.click();
  await page.evaluate(() => homeEntryContextFixture.clearNotice());
  assert.equal(await page.getByRole("alert").count(), 1);
  assert.equal(await page.getByRole("button", { name: "Reload page" }).count(), 0);
  await page.evaluate(() => homeEntryContextFixture.session("other-account"));
  await bell.waitFor({ state: "detached" });
  assert.equal(await page.getByRole("dialog", { name: "Notifications" }).count(), 0);
  await page.evaluate(() => homeEntryContextFixture.notify("Current reader failure."));
  await bell.click();
  assert.equal(await page.getByRole("alert").count(), 1);
  assert.equal(await page.getByText("Private reader failure.", { exact: true }).count(), 0);
}));

test("notification arrival and count changes animate and respect reduced motion", () => fixture(async page => {
  await page.evaluate(() => homeEntryContextFixture.notify("First reader failure."));
  const bell = page.locator(".locus-notifications__bell");
  await bell.waitFor();
  assert.equal(await page.locator(".locus-notifications").evaluate(element => getComputedStyle(element).animationName), "notification-appear");
  await page.evaluate(() => homeEntryContextFixture.notifyTwin("Second reader failure."));
  await page.waitForFunction(() => document.querySelector(".locus-notifications__bell")?.getAttribute("aria-label") === "2 notifications");
  assert.equal(await page.locator(".locus-notifications__count").evaluate(element => getComputedStyle(element).animationName), "notification-count-change");
  assert.ok(await bell.evaluate(element => element.getAnimations().length > 0));
  await page.emulateMedia({ reducedMotion: "reduce" });
  assert.equal(await page.locator(".locus-notifications").evaluate(element => getComputedStyle(element).animationName), "none");
  assert.equal(await page.locator(".locus-notifications__count").evaluate(element => getComputedStyle(element).animationName), "none");
}));

test("collection circles keep the generic data mark across pending and failed projections while hover retains guidance", () => fixture(async (page) => {
  const strip = page.locator("[data-thumbnail-boundaries]");
  const captureDirectory = process.env["FENEL_HOME_ENTRY_CAPTURE_DIR"];
  if (captureDirectory) {
    // This is the actual component fixture, not a production-app capture.
    await strip.waitFor();
    await page.evaluate(() => new Promise<void>(resolve => requestAnimationFrame(() => requestAnimationFrame(() => resolve()))));
    await page.screenshot({ path: join(captureDirectory, "component-collection-initial.png"), fullPage: true });
  }
  await strip.locator('[data-thumbnail-icon="package"]').first().waitFor();
  if (captureDirectory) await page.screenshot({ path: join(captureDirectory, "component-collection-ready.png"), fullPage: true });
  assert.equal(await strip.locator('[data-thumbnail-icon="package"]').count(), 2);
  assert.equal(await strip.locator(".locus-previews__content .home-new-button__spinner").count(), 0);
  assert.equal(await strip.locator(".locus-previews__content").allTextContents().then(text => text.join("")), "");

  await strip.getByRole("button", { name: "Open this data: Pending thumbnail", exact: true }).hover();
  await page.locator("[data-value-preview-popup] .home-new-button__spinner").waitFor();
  await page.mouse.move(10, 10);
  await page.locator("[data-value-preview-popup]").waitFor({ state: "detached" });
  await strip.getByRole("button", { name: "Open this data: Failed thumbnail", exact: true }).hover();
  await page.locator("[data-value-preview-popup]").getByText("Unavailable", { exact: true }).waitFor();
}, "thumbnail-boundaries"));

test("early names preserve lens panels and show every checked record field before focus commits", () => fixture(async page => {
  await page.evaluate(() => homeEntryContextFixture.mode("both"));
  await page.locator('[data-locus-preview="more-record"]').getByRole("button", { name: "A received record", exact: true }).click();
  await page.locator('[data-locus-preview="$field:four"]').getByText("four", { exact: true }).last().waitFor();
  assert.equal(await page.locator(".home-entry__previews [data-locus-preview]").count(), 4);
  assert.equal(await page.locator('[data-panels="both"]').count(), 1);
  assert.equal(await page.getByRole("dialog").count(), 0);
  assert.deepEqual(await page.evaluate(() => homeEntryContextFixture.state().focus), { kind: "root" });
  assert.deepEqual(await page.evaluate(() => homeEntryContextFixture.state().imports), []);
  await page.evaluate(() => homeEntryContextFixture.releaseFocus());
  await page.waitForFunction(() => homeEntryContextFixture.state().focus.kind === "value");
  const state = await page.evaluate(() => homeEntryContextFixture.state());
  assert.equal(state.inspectionMode, "both");
  assert.deepEqual(state.focus, { kind: "value", viewId: "sibling-reader", itemId: "more-record", path: [], rootItem: true });
  assert.deepEqual(state.openedLenses, []);
  await page.evaluate(() => { homeEntryContextFixture.mode("data"); window.scrollTo(0, 0); });
  await page.locator('[data-panels="data"]').waitFor();
  const cards = await page.locator(".home-entry__previews [data-locus-preview]").evaluateAll(elements => elements.map(element => {
    const rect = element.getBoundingClientRect();
    return { left: rect.left, top: rect.top, right: rect.right, bottom: rect.bottom };
  }));
  const collectionBounds = (await page.locator(".home-entry__previews").boundingBox())!;
  for (const [index, card] of cards.entries()) {
    assert.ok(Math.abs((card.left + card.right) / 2 - collectionBounds.x - collectionBounds.width / 2) < 1,
      "Record fields share the centered list card column");
    if (index > 0) assert.ok(card.top >= cards[index - 1]!.bottom,
      "Record fields stack in order rather than spreading into columns");
  }
  const captureDirectory = process.env["FENEL_HOME_ENTRY_CAPTURE_DIR"];
  if (captureDirectory) await page.screenshot({ path: join(captureDirectory, "focused-record-stacked.png") });
}, "reader-focus-wait"));

test("a checked record field expression waits for focused handoff and retains the original source and full path", () => fixture(async page => {
  await page.locator('[data-locus-preview="more-record"]').getByRole("button", { name: "A received record", exact: true }).click();
  const field = page.locator('[data-locus-preview="$field:one"]');
  await openCardExpression(page, field);
  await page.locator('[data-expression-inspection][data-expression-early-editing="true"]').getByText("one", { exact: true }).waitFor();
  assert.equal(await page.locator('[data-panels="expression"]').count(), 1);
  assert.equal(await page.getByRole("dialog").count(), 0);
  await editHeldData(page, page.locator("[data-expression-inspection]"));
  await page.getByRole("dialog").getByRole("textbox").first().fill("changed");
  await page.getByRole("dialog").getByRole("button", { name: "Close argument", exact: true }).click();
  await page.locator('[data-early-expression-draft="true"]').getByRole("button", { name: "Save", exact: true }).click();
  await page.evaluate(() => homeEntryContextFixture.ready());
  assert.equal(await page.locator("[data-workspace-handoff]").count(), 0);
  await page.evaluate(() => homeEntryContextFixture.releaseFocus());
  await page.locator("[data-workspace-handoff]").waitFor();
  const action = (await page.evaluate(() => homeEntryContextFixture.state())).actions[0];
  assert.ok(typeof action === "object" && action.kind === "inspect-data");
  assert.equal(action.item.id, "more-record");
  assert.equal(action.mode, "expression");
  assert.deepEqual(action.scope, { kind: "value", viewId: "sibling-reader", itemId: "more-record", path: ["one"], rootItem: true });
  assert.deepEqual(action.draft?.node, { kind: "literal", value: "changed" });
  const source = action.item.source;
  assert.ok(source?.kind === "expr" && source.expr.kind === "literal");
  assert.equal((source.expr.value as { __record: { fields: unknown[] } }).__record.fields.length, 4);
}, "reader-focus-wait"));

test("white collection circles use the available card width on one line and request scoped icons beyond the first three", () => fixture(async page => {
  await page.addStyleTag({ content: '[data-locus-preview="known-list"] { width: 180px !important; }' });
  // A card is at most its grid track wide (3646c0af); give it one track.
  await page.locator(".home-entry__previews").evaluate(grid => { (grid as HTMLElement).style.gridTemplateColumns = "1fr"; });
  const card = page.locator('[data-locus-preview="known-list"]');
  const strip = card.locator(".locus-previews");
  const circles = strip.locator(".locus-previews__cell[data-value-preview]");
  await page.waitForFunction(() => homeEntryContextFixture.state().requests.includes("POST /api/reader-metadata"));
  await page.evaluate(() => homeEntryContextFixture.releaseMetadata());
  await circles.first().waitFor();
  // The card's initial visible slice can precede its new width's observer
  // callback. Record the painted narrow layout before comparing a later resize.
  await page.evaluate(() => new Promise<void>(resolve => requestAnimationFrame(() => requestAnimationFrame(() => resolve()))));
  const narrow = await circles.count();
  assert.ok(narrow > 0 && narrow < 5);
  const captureDirectory = process.env["FENEL_HOME_ENTRY_CAPTURE_DIR"];
  if (captureDirectory) await page.screenshot({ path: join(captureDirectory, "responsive-circles-180.png"), fullPage: true });
  await card.evaluate(element => { (element as HTMLElement).style.setProperty("width", "260px", "important"); });
  await page.waitForFunction(({ count }) => document.querySelectorAll('[data-locus-preview="known-list"] .locus-previews__cell[data-value-preview]').length > count, { count: narrow });
  const medium = await circles.count();
  await card.evaluate(element => { (element as HTMLElement).style.setProperty("width", "420px", "important"); });
  await page.waitForFunction(() => document.querySelectorAll('[data-locus-preview="known-list"] .locus-previews__cell[data-value-preview]').length === 5);
  assert.ok(medium > narrow);
  assert.equal(await strip.locator(".locus-previews__cell--more").count(), 0);
  assert.equal(await circles.nth(3).locator("[data-thumbnail-icon]").getAttribute("data-thumbnail-icon"), "bot");
  assert.equal(await circles.nth(4).locator("[data-thumbnail-icon]").getAttribute("data-thumbnail-icon"), "user");
  const layout = await strip.evaluate(element => {
    const cells = [...element.querySelectorAll<HTMLElement>(".locus-previews__cell")];
    const count = element.querySelector<HTMLElement>(".locus-previews__count")!;
    return { backgrounds: cells.map(cell => getComputedStyle(cell).backgroundColor),
      centers: [...cells, count].map(cell => { const box = cell.getBoundingClientRect(); return box.y + box.height / 2; }),
      fits: element.scrollWidth <= element.clientWidth };
  });
  assert.ok(layout.backgrounds.every(background => background === "rgb(255, 255, 255)"));
  assert.ok(Math.max(...layout.centers) - Math.min(...layout.centers) < 1);
  assert.equal(layout.fits, true);
  if (captureDirectory) await page.screenshot({ path: join(captureDirectory, "responsive-circles-420.png"), fullPage: true });
  await card.evaluate(element => { (element as HTMLElement).style.setProperty("width", "180px", "important"); });
  try {
    await page.waitForFunction(({ count }) => document.querySelectorAll('[data-locus-preview="known-list"] .locus-previews__cell[data-value-preview]').length === count, { count: narrow });
  } catch (error) {
    console.error("Responsive shrink geometry", JSON.stringify(await strip.evaluate((element, expected) => {
      const count = element.querySelector<HTMLElement>(".locus-previews__count")!;
      const stack = element.querySelector<HTMLElement>(".locus-previews__stack")!;
      const cell = stack.querySelector<HTMLElement>(".locus-previews__cell")!;
      return { expected, viewport: window.innerWidth, strip: element.clientWidth,
        count: { scroll: count.scrollWidth, client: count.clientWidth, width: count.getBoundingClientRect().width, text: count.textContent },
        cell: { width: cell.getBoundingClientRect().width, cssWidth: getComputedStyle(cell).width, margin: getComputedStyle(cell).marginRight },
        stackPadding: [getComputedStyle(stack).paddingLeft, getComputedStyle(stack).paddingRight],
        visible: stack.querySelectorAll("[data-value-preview]").length };
    }, narrow)));
    throw error;
  }
  assert.equal(await strip.getByRole("button", { name: `${5 - narrow} more items`, exact: true }).count(), 1);
  // A measured zero must stay zero, then recover when its actual width grows.
  // This also proves geometry measurement leaves no fake/hidden data circles.
  await strip.evaluate(element => { (element as HTMLElement).style.width = "1px"; });
  await page.waitForFunction(() => document.querySelectorAll('[data-locus-preview="known-list"] .locus-previews__cell').length === 0);
  assert.equal(await circles.count(), 0);
  assert.equal(await strip.locator(".locus-previews__cell--more").count(), 0);
  await strip.evaluate(element => { (element as HTMLElement).style.removeProperty("width"); });
  await page.waitForFunction(({ count }) => document.querySelectorAll('[data-locus-preview="known-list"] .locus-previews__cell[data-value-preview]').length === count, { count: narrow });
  assert.equal(await strip.getByRole("button", { name: `${5 - narrow} more items`, exact: true }).count(), 1);
  assert.deepEqual(await page.evaluate(() => homeEntryContextFixture.state().imports), []);
}, "reader-responsive"));

test("collection hover shares compact generic card chrome with a single caption and scoped thumbnail data", () => fixture(async page => {
  await page.waitForFunction(() => homeEntryContextFixture.state().requests.includes("POST /api/reader-metadata"));
  await page.evaluate(() => homeEntryContextFixture.releaseMetadata());
  const circles = page.locator('[data-locus-preview="known-list"] [data-value-preview]');
  await circles.first().hover();
  let popup = page.locator("[data-value-preview-popup]");
  await popup.locator(".home-item__body").getByText("First item", { exact: true }).waitFor();
  assert.equal(await popup.locator(".home-item__caption").innerText(), "Message");
  assert.equal(await popup.getByText("First item", { exact: true }).count(), 1);
  await page.mouse.move(10, 10);
  await popup.waitFor({ state: "detached" });
  await circles.nth(1).hover();
  popup = page.locator("[data-value-preview-popup]");
  await popup.locator(".home-item__body [data-thumbnail-icon=bot]").waitFor({ state: "attached" });
  assert.deepEqual(await popup.locator(".home-item__value-icon svg path").evaluateAll(paths => paths.map(path => path.getAttribute("d"))),
    await popup.locator(".home-item__body [data-thumbnail-icon=bot] svg path").evaluateAll(paths => paths.map(path => path.getAttribute("d"))),
    "The occurrence icon is the inline card's caption mark");
  assert.equal(await popup.locator(".home-item__caption").innerText(), "Data");
  assert.equal(await popup.locator(".home-item__caption").count(), 1);
  assert.equal(await popup.locator(".home-item__body").innerText(), "");
  assert.equal(await popup.getByText("22222222-2222-4222-8222-222222222222", { exact: false }).count(), 0);
  const card = await popup.locator(".home-item").boundingBox();
  const bounds = await popup.boundingBox();
  assert.ok(card && bounds && card.height <= 52.1 && bounds.width <= 352 && bounds.width >= 250 && card.width >= 250,
    JSON.stringify({ card, bounds }));
  const captureDirectory = process.env["FENEL_HOME_ENTRY_CAPTURE_DIR"];
  if (captureDirectory) await popup.screenshot({ path: join(captureDirectory, "inline-collection-hover.png") });
  await page.mouse.move(10, 10);
  await popup.waitFor({ state: "detached" });
  await circles.nth(2).hover();
  await popup.locator(".home-item__body canvas").waitFor();
  const media = await popup.locator(".home-item__body canvas").boundingBox();
  const mediaCard = await popup.locator(".home-item").boundingBox();
  assert.ok(media && mediaCard && media.height <= 32 && mediaCard.height <= 52.1);
  assert.deepEqual(await page.evaluate(() => homeEntryContextFixture.state().imports), []);
}, "reader-thumbnails"));
