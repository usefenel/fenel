import { after, before, test } from "node:test";
import { strict as assert } from "node:assert";
import { mkdir, readFile } from "node:fs/promises";
import { writeSync } from "node:fs";
import { dirname, join } from "node:path";
import { createRequire } from "node:module";
import type { Browser, Page } from "playwright";
import type {} from "./workspace-startup.fixture";
import type { LensShortcut } from "./lens-shortcuts";
const LOCAL_BROWSER_SOURCE_ID: typeof import("./browser-data-storage").LOCAL_BROWSER_SOURCE_ID = "fenel-browser-local";
type PublicFixtureBootstrap = typeof import("./generated/public-bootstrap.json");

const driverModule = process.env["FENEL_TEST_PLAYWRIGHT_MODULE"] ?? "playwright";
if (process.env["FENEL_STARTUP_DEBUG_DRIVER"] === "1") console.error(`Session fixture driver: ${driverModule}`);
const { chromium } = createRequire(import.meta.url)(driverModule) as typeof import("playwright");
if (process.env["FENEL_STARTUP_READY_FD"] === "3") writeSync(3, "SESSION_DRIVER_READY\n");

let browser: Browser;
let script: string;
let css: string;
let shellSource: string;
let logoImage: Buffer;
let publicBootstrap: PublicFixtureBootstrap;
before(async () => {
  if (process.env["FENEL_STARTUP_DEBUG_DRIVER"] === "1") console.error("Session fixture: reading verified artifacts");
  const bootstrapPath = process.argv[6] ?? join(dirname(process.argv[4]!), "../lib/generated/public-bootstrap.json");
  const [browserSource, styles, shell, logo, bootstrap] = await Promise.all([
    readFile(process.argv[2]!, "utf8"), readFile(process.argv[3]!, "utf8"), readFile(process.argv[4]!, "utf8"), readFile(process.argv[5]!), readFile(bootstrapPath, "utf8"),
  ]);
  script = browserSource; css = styles; shellSource = shell; logoImage = logo;
  publicBootstrap = JSON.parse(bootstrap);
  if (process.env["FENEL_STARTUP_DEBUG_DRIVER"] === "1") console.error("Session fixture: launching browser");
  browser = await chromium.launch({ headless: true, timeout: 30_000, channel: process.env["FENEL_TEST_BROWSER_CHANNEL"] });
  if (process.env["FENEL_STARTUP_DEBUG_DRIVER"] === "1") console.error("Session fixture: browser ready");
});
after(async () => { await browser?.close(); });

async function fixture(scenario: string, run: (page: Page, messages: readonly string[]) => Promise<void>) {
  if (process.env["FENEL_STARTUP_DEBUG_DRIVER"] === "1") console.error(`Session fixture: opening ${scenario}`);
  const page = await browser.newPage({ viewport: { width: 1024, height: 768 } });
  page.setDefaultTimeout(15_000);
  if (process.env["FENEL_STARTUP_LOADING_CAPTURE_DIR"]) await page.emulateMedia({ reducedMotion: "reduce" });
  const errors: string[] = [];
  const messages: string[] = [];
  let stallTimer: ReturnType<typeof setTimeout> | undefined;
  page.on("pageerror", error => errors.push(error.message));
  page.on("console", message => { if (message.type() === "error" || message.type() === "warning") messages.push(message.text()); });
  if (process.env["FENEL_STARTUP_DEBUG_STALL"] === "1") {
    const debug = await page.context().newCDPSession(page);
    debug.on("Debugger.paused", event => {
      console.error("Session render stall", JSON.stringify({ scenario, frames: event.callFrames.slice(0, 80)
        .map(frame => ({ name: frame.functionName, url: frame.url, location: frame.location })) }));
      void debug.send("Debugger.resume").catch(() => undefined);
      void page.close({ reason: "The isolated fixture render stall was captured." }).catch(() => undefined);
    });
    await debug.send("Debugger.enable");
    stallTimer = setTimeout(() => { void debug.send("Debugger.pause").catch(() => undefined); }, 20_000);
  }
  if (process.env["FENEL_STARTUP_DEBUG_CONTEXT"] === "1") {
    const debug = await page.context().newCDPSession(page);
    debug.on("Debugger.paused", event => {
      if (event.data?.description?.includes("Context must")) messages.push(JSON.stringify({
        contextFailure: event.data.description,
        frames: event.callFrames.map(frame => ({ function: frame.functionName, url: frame.url, location: frame.location })),
      }));
      void debug.send("Debugger.resume");
    });
    await debug.send("Debugger.enable");
    await debug.send("Debugger.setPauseOnExceptions", { state: "all" });
  }
  try {
    await page.route("**/*", route => {
      const path = new URL(route.request().url()).pathname;
      if (path === "/fixture/logo.png") return route.fulfill({ contentType: "image/png", body: logoImage });
      if (path !== "/") {
        const name = path.startsWith("/fixture/dynamic/")
          ? decodeURIComponent(path.slice("/fixture/dynamic/".length)) : `.${path}`;
        const prefix = `workspaceStartupFixture.moduleStarted(${JSON.stringify(name)});`;
        if (name === "./generated/public-bootstrap.json") {
          const seeded = (publicBootstrap.workspace.value.lenses[0] as { shortcuts?: { $tag: string; _0?: LensShortcut[] } }).shortcuts;
          return route.fulfill({ contentType: "text/javascript", body: `${prefix}
            ${scenario.startsWith("startup-snapshot-race") ? "await workspaceStartupFixture.waitForPublicSnapshot();" : ""}
            ${scenario.startsWith("startup-root-local") ? `workspaceStartupFixture.usePublicProjection(${JSON.stringify(publicBootstrap.workspace)});` : ""}
            workspaceStartupFixture.setDefaultShortcuts(${JSON.stringify(seeded?.$tag === "Just" ? seeded._0 ?? [] : [])});
            export default ${JSON.stringify(publicBootstrap)};` });
        }
        if (name === "./workspace-model-loader") return route.fulfill({ contentType: "text/javascript", body: `${prefix}
          export async function loadWorkspaceModel() {
            await workspaceStartupFixture.waitForModel();
            workspaceStartupFixture.prepareDetached();
            return workspaceStartupFixture.modelExports;
          }
        ` });
        if (name === "./workspace-model") return route.fulfill({ contentType: "text/javascript", body: `${prefix}
          await workspaceStartupFixture.waitForModel();
          const model = workspaceStartupFixture.modelExports;
          export const workspaceCall = (...args) => model.workspaceCall(...args);
          export const workspaceLayout = model.workspaceLayout;
          export const workspacePresentation = model.workspacePresentation;
          export const workspaceValueType = model.workspaceValueType;
          export const allDataRootTypes = model.allDataRootTypes;
          export const allDataRootDescriptions = model.allDataRootDescriptions;
          export const defaultWorkspace = model.defaultWorkspace;
          export const applyWorkspace = model.applyWorkspace;
          export async function prepareProjectedWorkspaceModel() { workspaceStartupFixture.prepareDetached(); return model; }
        ` });
        if (name === "./expression-runner/authoring-session") return route.fulfill({ contentType: "text/javascript", body: `${prefix}
          export async function prepareDetachedAuthoringSession() { workspaceStartupFixture.prepareDetached(); }
        ` });
        if (name === "./workspace-preferences-evaluation") return route.fulfill({ contentType: "text/javascript", body: `${prefix}
          export const selectWorkspacePreferences = data => workspaceStartupFixture.selectSaved(data);
        ` });
        if (scenario === "startup-root-local-navigation-portal") {
          // The actual /~ root resolver acquires these optional modules even
          // with no member segment. It must never evaluate or fingerprint a
          // value to resolve that root; make every such call fail this test.
          if (name === "./locus-address-reader") return route.fulfill({ contentType: "text/javascript", body: `${prefix}
            export function locusAddressReader(options) {
              options.assertCurrent();
              const unavailable = () => { throw new Error("The Local root address must not ask for computed data."); };
              return { expression: unavailable, read: unavailable, childType: unavailable, load: unavailable };
            }
          ` });
          if (name === "./saved-expression-identity") return route.fulfill({ contentType: "text/javascript", body: `${prefix}
            export function expressionKey() { throw new Error("The Local root address must not fingerprint an expression."); }
          ` });
        }
        if (scenario === "public-bootstrap-mismatch" && name === "./public-locus-data") return route.fulfill({ contentType: "text/javascript", body: `${prefix}
          workspaceStartupFixture.throwPublicMismatch();
          export async function preparePublicLocusData() { throw new Error("Mismatched public data must not become readable"); }
        ` });
        if (scenario === "public-browse-retry") {
          const preparationModules: Record<string, string> = {
            "./public-locus-data": "export async function preparePublicLocusData() { return workspaceStartupFixture.attemptPublicPreparation(); }",
            "./expression-runner/authoring-catalog": 'export function sessionCatalogSections() { throw new Error("A held public reader cannot expose a catalog"); }',
            "./web-template-registry": 'export function createReaderTemplateRegistry() { throw new Error("A held public reader cannot expose templates"); }',
            "./reader-presentation": 'export function createReaderPresentation() { throw new Error("A held public reader cannot expose presentation"); }',
          };
          if (preparationModules[name]) return route.fulfill({ contentType: "text/javascript", body: prefix + preparationModules[name] });
        }
        return route.fulfill({ contentType: "text/javascript", body: `${prefix}
          await workspaceStartupFixture.waitForever();
          export default function Unavailable() { throw new Error("A held module must not execute"); }
        ` });
      }
      return route.fulfill({ contentType: "text/html", body: "<html><body></body></html>" });
    });
    await page.goto(`https://fenel.test/?scenario=${scenario}`);
    await page.addStyleTag({ content: css });
    if (process.env["FENEL_STARTUP_DEBUG_REACTIVE"] === "1") await page.addScriptTag({ content: `
      const priorWarn = console.warn;
      console.warn = (...args) => {
        if (String(args[0]).includes("STRICT_READ_UNTRACKED")) priorWarn(new Error("Reactive read stack").stack);
        priorWarn(...args);
      };
    ` });
    await page.addScriptTag({ content: script, type: "module" });
    if (process.env["FENEL_STARTUP_DEBUG_DRIVER"] === "1") console.error(`Session fixture: mounted ${scenario}`);
    await page.waitForFunction(() => !!globalThis.workspaceStartupFixture);
    if (process.env["FENEL_STARTUP_DEBUG_DRIVER"] === "1") console.error(`Session fixture: global ready ${scenario}`);
    const seeded = (publicBootstrap.workspace.value.lenses[0] as { shortcuts?: { $tag: string; _0?: LensShortcut[] } }).shortcuts;
    await page.evaluate(shortcuts => workspaceStartupFixture.setDefaultShortcuts(shortcuts), seeded?.$tag === "Just" ? seeded._0 ?? [] : []);
    if (process.env["FENEL_STARTUP_DEBUG_DRIVER"] === "1") console.error(`Session fixture: shortcuts ready ${scenario}`);
    await run(page, messages);
    if (process.env["FENEL_STARTUP_DEBUG_DRIVER"] === "1") console.error(`Session fixture: assertions complete ${scenario}`);
    const captureDirectory = process.env["FENEL_STARTUP_SCREENSHOT_DIR"];
    if (captureDirectory) {
      await mkdir(captureDirectory, { recursive: true });
      await page.screenshot({ path: join(captureDirectory, `${scenario}-desktop.png`) });
      await page.setViewportSize({ width: 390, height: 844 });
      await page.screenshot({ path: join(captureDirectory, `${scenario}-phone.png`) });
    }
    assert.deepEqual(errors, []);
    assert.deepEqual(await page.evaluate(() => workspaceStartupFixture.state().errors), []);
  } catch (error) {
    console.error("Workspace startup fixture failed before diagnostics", scenario, error instanceof Error ? error.message : String(error));
    const failureCards = page.locator(".locus-load-failure__card");
    if (await failureCards.count()) {
      await failureCards.first().click({ timeout: 2_000 }).catch(() => undefined);
      await page.locator(".locus-load-failure__detail").waitFor({ timeout: 2_000 }).catch(() => undefined);
    }
    console.error("Workspace startup fixture failure", JSON.stringify({ errors, messages: [...new Set(messages)],
      state: await page.evaluate(() => globalThis.workspaceStartupFixture?.state()), text: await page.locator("body").innerText(),
      structure: await page.locator("body").evaluate(element => element.innerHTML.slice(0, 3000)) }));
    throw error;
  } finally { clearTimeout(stallTimer); await page.close(); }
}
const dataReads = (requests: Array<{ method: string; path: string; account: string | null }>) =>
  requests.filter(request => request.method === "GET" && request.path === "/api/locus-root");

async function captureNavigationOwner(page: Page, name: string) {
  const directory = process.env["FENEL_STARTUP_OWNER_CAPTURE_DIR"];
  if (!directory) return;
  await mkdir(directory, { recursive: true });
  await page.evaluate(() => {
    if (document.querySelector("[data-owner-capture-label]")) return;
    const label = document.createElement("div");
    label.dataset.ownerCaptureLabel = "true";
    label.textContent = "Production lens navigation and placement · data reader and model responses are controlled fixtures";
    label.style.cssText = "position:fixed;bottom:10px;left:10px;right:10px;padding:8px 12px;background:white;border:1px solid #ddd;color:#525866;font:12px system-ui;z-index:10000";
    document.body.append(label);
  });
  await page.screenshot({ path: join(directory, `${name}.png`), fullPage: true });
}

async function captureLoadingRegression(page: Page, name: string) {
  const directory = process.env["FENEL_STARTUP_LOADING_CAPTURE_DIR"];
  if (!directory) return;
  await mkdir(directory, { recursive: true });
  if (await page.locator(".locus-background__image").count()) await readyBackground(page);
  await page.screenshot({ path: join(directory, `${name}-desktop.png`) });
  await page.setViewportSize({ width: 390, height: 844 });
  if (await page.locator(".locus-background__image").count()) await readyBackground(page);
  await page.screenshot({ path: join(directory, `${name}-phone.png`) });
  await page.setViewportSize({ width: 1024, height: 768 });
}

async function readyBackground(page: Page) {
  const image = page.locator(".locus-background__image");
  await image.evaluate((element: HTMLImageElement) => element.decode());
  await page.waitForFunction(() => {
    const image = document.querySelector<HTMLImageElement>(".locus-background__image");
    return image?.complete && image.naturalWidth > 0 && image.hasAttribute("data-ready")
      && getComputedStyle(image).opacity === "1";
  });
  assert.equal(await image.isVisible(), true);
}

async function assertHoverTransition(page: Page, selector: string, property: string) {
  const control = page.locator(selector);
  await control.waitFor();
  await page.mouse.move(1000, 740);
  const settledColor = () => control.evaluate(async (element, key) => {
    for (let frame = 0; frame < 40; frame++) {
      if (!element.getAnimations().some(animation => animation instanceof CSSTransition && animation.transitionProperty === key && animation.playState === "running")) break;
      await new Promise<void>(resolve => requestAnimationFrame(() => resolve()));
    }
    return getComputedStyle(element).getPropertyValue(key);
  }, property);
  const captureTransition = () => control.evaluate((element, key) => {
    const holder = element as HTMLElement & { hoverTransition?: CSSTransition };
    delete holder.hoverTransition;
    const capture = (event: TransitionEvent) => {
      if (event.propertyName !== key) return;
      const animation = element.getAnimations().find(animation => animation instanceof CSSTransition && animation.transitionProperty === key);
      if (animation instanceof CSSTransition) {
        animation.pause();
        animation.currentTime = Number(animation.effect!.getTiming().duration) / 2;
        holder.hoverTransition = animation;
      }
      element.removeEventListener("transitionrun", capture as EventListener);
    };
    element.addEventListener("transitionrun", capture as EventListener);
  }, property);
  const middleColor = () => control.evaluate(async (element, key) => {
    const holder = element as HTMLElement & { hoverTransition?: CSSTransition };
    for (let frame = 0; frame < 20 && !holder.hoverTransition; frame++) await new Promise<void>(resolve => requestAnimationFrame(() => resolve()));
    const animation = holder.hoverTransition;
    const color = getComputedStyle(element).getPropertyValue(key);
    animation?.finish();
    return { color, transitioning: !!animation };
  }, property);
  const resting = await settledColor();
  await captureTransition();
  await control.hover();
  const entering = await middleColor();
  const hovered = await settledColor();
  assert.equal(entering.transitioning, true, `${selector} animates ${property} on entry`);
  assert.notEqual(entering.color, resting);
  assert.notEqual(entering.color, hovered, "Hover entry includes an interpolated colour");
  await captureTransition();
  await page.mouse.move(1000, 740);
  const leaving = await middleColor();
  const returned = await settledColor();
  assert.equal(leaving.transitioning, true, `${selector} animates ${property} on exit`);
  assert.notEqual(leaving.color, hovered);
  assert.notEqual(leaving.color, resting, "Hover exit includes an interpolated colour");
  assert.equal(returned, resting);
}

test("shared breadcrumb and toolbar controls fade on hover entry and exit", () => fixture("logo-local", async page => {
  await page.emulateMedia({ reducedMotion: "no-preference" });
  await page.locator('[data-locus-preview="fixture-local:clipboard"]').waitFor();
  await assertHoverTransition(page, ".locus-crumbs__account-button", "border-top-color");
  await assertHoverTransition(page, ".locus-crumbs__up", "background-color");
  await assertHoverTransition(page, ".topbar .home-search-trigger", "background-color");
  await assertHoverTransition(page, ".workspace-pane__header .home-search-trigger", "background-color");
  await assertHoverTransition(page, ".workspace-lens-group__menu", "background-color");
  assert.equal((await page.evaluate(() => workspaceStartupFixture.state())).modelReleased, false);
}));

test("Suggestions registration survives owned disposal and stale cleanup", () => fixture("owner-navigation-atomic", async page => {
  await page.waitForFunction(() => workspaceStartupFixture.state().paneIds.includes("saved-lens-b"));
  const result = await page.evaluate(() => workspaceStartupFixture.suggestionRegistrationLifetime("saved-lens-b"));
  assert.deepEqual(result.caught, [], "The real pane cleanup must not write during owned disposal");
  assert.equal(result.mounted, true);
  assert.equal(result.cleared, true);
  assert.equal(result.sameOwnerRetained, true, "An old registration cannot clear a fresh registration of the same owner");
  assert.equal(result.replacementRetained, true, "Deferred cleanup cannot clear a replacement owner");
  assert.equal(result.finalCleared, true);
}));

test("narrow bars retain primary actions and expose secondary controls through shared menus", () => fixture("stacked-chrome-compact", async page => {
  await page.emulateMedia({ reducedMotion: "reduce" });
  await page.getByText("Account B root data", { exact: true }).waitFor();
  const pane = page.locator('[data-workspace-lens="saved-lens-b"]');
  await pane.getByRole("button", { name: "Data", exact: true }).waitFor();
  const topbar = page.locator(".topbar");
  const before = process.env["FENEL_COMPACT_BARS_BEFORE"] === "1";
  const capture = async (name: string) => {
    const directory = process.env["FENEL_COMPACT_BARS_CAPTURE_DIR"];
    if (!directory) return;
    await mkdir(directory, { recursive: true });
    await page.screenshot({ path: join(directory, `${name}.png`) });
  };
  for (const width of [390, 360, 320, 700, 1024]) {
    await page.setViewportSize({ width, height: 844 });
    await capture(`compact-bars-${width}`);
    if (before) continue;
    const compact = width <= 700;
    const geometry = await topbar.evaluate(element => {
      const bar = element.getBoundingClientRect();
      const buttons = [...element.querySelectorAll("button")].filter(button => button.getBoundingClientRect().width > 0);
      return { height: bar.height, labels: buttons.map(button => button.getAttribute("aria-label")),
        contained: buttons.every(button => {
          const box = button.getBoundingClientRect();
          return box.left >= bar.left && box.right <= bar.right && box.top >= bar.top && box.bottom <= bar.bottom;
        }), rows: new Set(buttons.map(button => Math.round(button.getBoundingClientRect().top / 5))).size };
    });
    assert.equal(geometry.contained, true, `Top controls fit at ${width}px`);
    if (compact) {
      assert.ok(geometry.height <= 48, `The compact global bar stays on one row within its shared 3rem floor at ${width}px`);
      assert.equal(geometry.labels.length, 4, `Fold, notifications, account and Lenses remain at ${width}px`);
      assert.ok(["Hide the top bar", "Account: Rom", "Lenses"].every(label => geometry.labels.includes(label)));
      assert.ok(["Browse", "New data"].every(label => !geometry.labels.includes(label)),
        "The sole docked lens owns its data actions");
      assert.equal(await topbar.getByRole("button", { name: "Automatic synchronization", exact: true }).isVisible(), false);
      assert.equal(await topbar.getByRole("button", { name: "Log out", exact: true }).isVisible(), false);
    } else {
      assert.equal(await topbar.getByRole("button", { name: "Automatic synchronization", exact: true }).isVisible(), true);
      assert.equal(await topbar.getByRole("button", { name: "Lens settings", exact: true }).isVisible(), true);
    }
    if (width <= 540) {
      const shortcuts = pane.getByRole("group", { name: "Data shortcuts", exact: true });
      assert.deepEqual(await shortcuts.getByRole("button").evaluateAll(buttons => buttons.filter(button => button.getBoundingClientRect().width > 0).map(button => button.getAttribute("aria-label"))), ["Suggestions"]);
      assert.equal(await shortcuts.getByRole("button", { name: "Suggestions", exact: true }).innerText(), "Suggestions");
    }
  }
  if (before) return;
  await page.setViewportSize({ width: 390, height: 844 });
  await topbar.getByRole("button", { name: "Hide the top bar", exact: true }).click();
  await page.waitForFunction(() => document.querySelector(".dashboard")?.getAttribute("data-chrome-collapsed") === "true");
  assert.equal(await topbar.evaluate(element => element.getBoundingClientRect().height), 0);
  assert.equal(await topbar.evaluate(element => getComputedStyle(element).pointerEvents), "none");
  await page.getByRole("button", { name: "Show the top bar", exact: true }).click();
  await page.waitForFunction(() => !document.querySelector(".dashboard")?.hasAttribute("data-chrome-collapsed"));
  assert.equal(await topbar.getByRole("button", { name: "Hide the top bar", exact: true }).isVisible(), true);
  const lenses = topbar.getByRole("button", { name: "Lenses", exact: true });
  await lenses.focus(); await page.keyboard.press("ArrowDown");
  const menu = page.getByRole("menu", { name: "Lenses", exact: true });
  await menu.waitFor();
  assert.equal(await menu.getByRole("menuitem", { name: "Lens settings", exact: true }).getAttribute("aria-disabled"), "true");
  assert.equal(await menu.getByRole("menuitem", { name: "More creation options", exact: true }).count(), 0);
  assert.equal(await page.getByRole("button", { name: "More creation options", exact: true }).count(), 0);
  await menu.getByRole("menuitem", { name: "Hide the top bar", exact: true }).waitFor();
  await capture("compact-lenses-menu");
  await menu.getByRole("menuitemradio", { name: "Automatic synchronization", exact: true }).click();
  await menu.waitFor({ state: "hidden" });
  await lenses.click();
  await menu.waitFor();
  assert.equal(await menu.getByRole("menuitemradio", { name: "Automatic synchronization", exact: true }).getAttribute("aria-checked"), "false");
  await page.waitForFunction(() => !!document.activeElement?.closest('[role="menu"][aria-label="Lenses"]'));
  await page.keyboard.press("Escape");
  await menu.waitFor({ state: "hidden" });
  assert.equal(await lenses.evaluate(element => element === document.activeElement), true, "Closing the lens menu returns focus to its trigger");
  const suggestions = pane.getByRole("button", { name: "Suggestions", exact: true });
  await suggestions.click();
  const suggestionMenu = page.getByRole("menu", { name: "Suggestions", exact: true });
  assert.deepEqual(await suggestionMenu.getByRole("menuitem").allTextContents(), ["Data", "Expression", "Code", "Dependencies", "Show Suggestions panel"]);
  await capture("compact-suggestions-menu");
  await suggestionMenu.getByRole("menuitem", { name: "Data", exact: true }).click();
  assert.equal(await pane.getByRole("region", { name: "Data panel", exact: true }).isVisible(), false);
  await suggestions.click(); await suggestionMenu.getByRole("menuitem", { name: "Data", exact: true }).click();
  assert.equal(await pane.getByRole("region", { name: "Data panel", exact: true }).isVisible(), true);
  assert.match(shellSource, /aria-label=\{`Account: \$\{profileLabel\(\)\}`\}/);
  assert.match(shellSource, /closeProfile\(\); void handleLogout\(\);/);
}));

test("merged lens chrome stays below the shared top border", () => fixture("account-menu", async page => {
  await page.emulateMedia({ reducedMotion: "reduce" });
  await page.getByText("Account B root data", { exact: true }).waitFor();
  const pane = page.locator('[data-workspace-lens="saved-lens-b"]');
  assert.equal(await page.locator(".dashboard").getAttribute("data-borders"), "merged");
  for (const mode of ["expanded", "compact", "hidden"] as const) {
    if (mode === "compact") await pane.getByRole("button", { name: "Compact lens header", exact: true }).click();
    if (mode === "hidden") await pane.getByRole("button", { name: "Hide lens controls", exact: true }).click();
    await captureLoadingRegression(page, `merged-lens-${mode}`);
    if (process.env["FENEL_LENS_CHROME_BEFORE"] === "1") continue;
    for (const width of [1024, 390]) {
      await page.setViewportSize({ width, height: 768 });
      const geometry = await pane.evaluate(element => {
        const lens = element.getBoundingClientRect();
        const bar = document.querySelector(".topbar")!.getBoundingClientRect();
        const header = element.querySelector(".workspace-pane__header")!.getBoundingClientRect();
        const restore = element.querySelector(".workspace-corner--lens");
        return { topGap: lens.top - bar.bottom, border: getComputedStyle(element).borderTopWidth,
          controlsFit: [...element.querySelectorAll(".workspace-pane__header button, .locus-crumbs__subject")].every(control => {
            const box = control.getBoundingClientRect();
            return box.width === 0 || box.top >= header.top && box.bottom <= header.bottom;
          }), restoreInside: !restore || restore.getBoundingClientRect().top >= lens.top,
          bodyClearance: !restore || element.querySelector(".workspace-pane__body")!.getBoundingClientRect().top
            + parseFloat(getComputedStyle(element.querySelector(".workspace-pane__body")!).paddingTop) >= restore.getBoundingClientRect().bottom };
      });
      assert.equal(geometry.topGap, 0, `${mode} lens at ${width}px shares the global border without a gap`);
      assert.equal(geometry.border, "0px", `${mode} lens never restores a second top border`);
      if (mode !== "hidden") assert.equal(geometry.controlsFit, true, `${mode} toolbar controls stay inside their header`);
      assert.equal(geometry.restoreInside, true, "The reveal button cannot spill into the global toolbar");
      assert.equal(geometry.bodyClearance, true, "The first data clears the reveal button");
    }
    await page.setViewportSize({ width: 1024, height: 768 });
  }
}));

for (const borders of ["merged", "separated"] as const) {
  test(`stacked ${borders} lens chrome clears the visible border in every header state`, () => fixture(`stacked-chrome-${borders}`, async page => {
    await page.emulateMedia({ reducedMotion: "reduce" });
    await page.getByText("Account B root data", { exact: true }).waitFor();
    const pane = page.locator('[data-workspace-lens="saved-lens-b"]');
    await pane.getByRole("button", { name: "Data", exact: true }).waitFor();
    const panes = page.locator(".workspace-panes");
    assert.equal(await panes.getAttribute("data-layer-depth"), "2", "Exercise a real grouped stack, including its background decoration");
    assert.equal(await page.locator(".dashboard").getAttribute("data-borders"), borders === "merged" ? "merged" : null);
    for (const mode of ["expanded", "compact", "hidden"] as const) {
      if (mode === "compact") await pane.getByRole("button", { name: "Compact lens header", exact: true }).click();
      if (mode === "hidden") await pane.getByRole("button", { name: "Hide lens controls", exact: true }).click();
      await captureLoadingRegression(page, `stacked-${borders}-${mode}`);
      if (process.env["FENEL_LENS_CHROME_BEFORE"] === "1") continue;
      for (const width of [1024, 390]) {
        await page.setViewportSize({ width, height: 768 });
        const geometry = await pane.evaluate(element => {
          const lens = element.getBoundingClientRect();
          const header = element.querySelector(".workspace-pane__header")!.getBoundingClientRect();
          const group = element.closest(".workspace-panes")!;
          const decoration = getComputedStyle(group, "::before");
          const restore = element.querySelector(".workspace-corner--lens");
          const decorationVisible = !["none", "normal"].includes(decoration.content)
            && decoration.display !== "none" && decoration.visibility !== "hidden" && decoration.opacity !== "0";
          return {
            topGap: lens.top - document.querySelector(".topbar")!.getBoundingClientRect().bottom,
            border: getComputedStyle(element).borderTopWidth,
            decorationVisible,
            decorationClipped: decoration.clipPath !== "none",
            controlsFit: [...element.querySelectorAll(".workspace-pane__header button, .locus-crumbs__subject")].every(control => {
              const box = control.getBoundingClientRect();
              return box.width === 0 || box.top >= header.top && box.bottom <= header.bottom && box.top > lens.top;
            }),
            restoreInside: !restore || restore.getBoundingClientRect().top >= lens.top,
          };
        });
        if (borders === "merged") {
          assert.equal(geometry.decorationVisible, false, `${mode} at ${width}px must not paint a second stacked border through the controls`);
          assert.equal(geometry.topGap, 0, `${mode} at ${width}px meets the docked global bar without a gap`);
          assert.equal(geometry.border, "0px");
          assert.equal(geometry.restoreInside, true, "The merged reveal control stays below the shared border");
        } else {
          assert.equal(geometry.decorationVisible, true, "Separated stacks retain their exposed-edge depth cue");
          assert.equal(geometry.decorationClipped, true, "The background frame must be clipped to exposed edges, away from the transparent foreground header");
          assert.equal(geometry.border, "1px");
        }
        if (mode !== "hidden") assert.equal(geometry.controlsFit, true, `${mode} at ${width}px keeps buttons and badges inside the lens header`);
      }
      await page.setViewportSize({ width: 1024, height: 768 });
    }
  }));
}

test("stacked merged tiles keep a one-pixel gap on desktop and phone", () => fixture("stacked-chrome-tiled", async page => {
  await page.emulateMedia({ reducedMotion: "reduce" });
  await page.getByText("Account B root data", { exact: true }).waitFor();
  await page.getByText("Account C data", { exact: true }).waitFor();
  await page.locator('.data-inspection-dialog__presentations button[aria-label="Data"]').last().waitFor({ state: "attached" });
  assert.equal(await page.locator(".workspace-panes").getAttribute("data-layer-depth"), "2");
  await captureLoadingRegression(page, "stacked-merged-tiles");
  if (process.env["FENEL_LENS_CHROME_BEFORE"] === "1") return;
  for (const width of [1024, 390]) {
    await page.setViewportSize({ width, height: 768 });
    const geometry = await page.locator(".workspace-panes").evaluate(group => {
      const style = getComputedStyle(group);
      const panes = [...group.querySelectorAll(":scope > .workspace-pane")].map(element => element.getBoundingClientRect());
      return { rowGap: style.rowGap, columnGap: style.columnGap, actualGap: panes[1]!.left - panes[0]!.right };
    });
    assert.deepEqual(geometry, { rowGap: "1px", columnGap: "1px", actualGap: 1 }, `Merged tiles keep their shared seam at ${width}px`);
  }
}));

test("a late addressed surface mounts its dashboard attributes before controls change them", async () => {
  for (const viewport of [{ width: 1024, height: 768 }, { width: 390, height: 844 }]) await fixture("surface-mount", async page => {
    await page.setViewportSize(viewport);
    await page.emulateMedia({ reducedMotion: "reduce" });
    const pane = page.locator('[data-workspace-lens="saved-public"]');
    await pane.waitFor();
    const dashboard = page.locator(".dashboard");
    await page.waitForFunction(() => document.querySelector('.dashboard')?.getAttribute("data-borders") === "merged");
    assert.equal(await dashboard.getAttribute("data-chrome-collapsed"), null);
    const initial = await page.evaluate(() => workspaceStartupFixture.state());
    assert.equal(initial.modelReleased, false, "Mounting alone applies the initial border preference while the model stays held");
    assert.equal(initial.editBatches.length, 0, "The mount does not synthesize a preference edit");
    await pane.evaluate(element => { (element as HTMLElement).dataset.fixtureIdentity = "mounted-surface"; });
    const captureDirectory = process.env["FENEL_SURFACE_MOUNT_CAPTURE_DIR"];
    if (captureDirectory) {
      await mkdir(captureDirectory, { recursive: true });
      await page.screenshot({ path: join(captureDirectory, `mounted-${viewport.width === 390 ? "phone" : "desktop"}.png`) });
    }

    await page.getByRole("button", { name: "Hide the top bar", exact: true }).click();
    assert.equal(await dashboard.getAttribute("data-chrome-collapsed"), "true");
    await page.getByRole("button", { name: "Show the top bar", exact: true }).click();
    assert.equal(await dashboard.getAttribute("data-chrome-collapsed"), null);
    assert.equal((await page.evaluate(() => workspaceStartupFixture.state())).modelReleased, false);

    await page.evaluate(() => workspaceStartupFixture.releaseModel());
    await page.waitForFunction(() => workspaceStartupFixture.state().modelCalls.includes("workspaceBootstrapReady"));
    await page.getByRole("button", { name: "Lens settings", exact: true }).click();
    await page.getByRole("menuitem", { name: "Separate the lens borders", exact: true }).click();
    await page.waitForFunction(() => document.querySelector('.dashboard')?.hasAttribute("data-borders") === false);
    const separated = await page.evaluate(() => workspaceStartupFixture.state());
    assert.equal(separated.preferences.display.$tag, "GroupedLenses");
    assert.equal((separated.preferences.display as { groups: Array<{ merged: boolean }> }).groups[0]!.merged, false);
    await page.getByRole("button", { name: "Lens settings", exact: true }).click();
    await page.getByRole("menuitem", { name: "Merge the lens borders", exact: true }).click();
    await page.waitForFunction(() => document.querySelector('.dashboard')?.getAttribute("data-borders") === "merged");
    const restored = await page.evaluate(() => workspaceStartupFixture.state());
    assert.equal((restored.preferences.display as { groups: Array<{ merged: boolean }> }).groups[0]!.merged, true);
    assert.equal(JSON.stringify(restored.editBatches), JSON.stringify([
      [{ $tag: "SetLensGroupMerged", id: "fixture-group", merged: false }],
      [{ $tag: "SetLensGroupMerged", id: "fixture-group", merged: true }],
    ]));
    assert.equal(await page.locator('[data-workspace-lens="saved-public"][data-fixture-identity="mounted-surface"]').count(), 1);
  });
});

test("lens navigation owner commits the clicked source, focus and presentation in one packet", () => fixture("owner-navigation-atomic", async page => {
  await page.waitForFunction(() => workspaceStartupFixture.state().paneIds.includes("saved-lens-b"));
  await page.evaluate(() => workspaceStartupFixture.navigate("saved-lens-b", {
    $tag: "ValuePresentationTarget", source: { $tag: "AccountSource", accountId: "account-c" },
    focus: { $tag: "ValueFocus", listId: "root-account-c", itemId: "root-only", rootItem: true,
      path: [{ $tag: "FieldStep", name: "title" }], passThrough: [] },
  }, undefined, "table"));
  await page.evaluate(() => workspaceStartupFixture.releaseModel());
  await page.waitForFunction(() => workspaceStartupFixture.state().edits.length === 3);
  const state = await page.evaluate(() => workspaceStartupFixture.state());
  assert.equal(state.editBatches.length, 1);
  const commands = state.editBatches[0] as Array<{ id: string; command: { $tag: string } }>;
  assert.deepEqual(commands.map(command => [command.id, command.command.$tag]), [
    ["saved-lens-b", "SetLensSource"], ["saved-lens-b", "SetLensFocus"], ["saved-lens-b", "SetLensPresentation"],
  ]);
  const lens = state.preferences.lenses[0]!;
  assert.deepEqual(lens.source, { $tag: "AccountSource", accountId: "account-c" });
  assert.equal(lens.focus.$tag, "ValueFocus");
  if (lens.focus.$tag === "ValueFocus") {
    assert.equal(lens.focus.itemId, "root-only");
    assert.deepEqual(lens.focus.path, [{ $tag: "FieldStep", name: "title" }]);
  }
  assert.deepEqual(lens.presentation, { $tag: "TablePresentation" });
  assert.deepEqual(state.preferences.presentations, []);
}));

test("a clicked destination shows at once and going up restores the retained parent before the model commits", () => fixture("owner-navigation-latest", async page => {
  await page.waitForFunction(() => workspaceStartupFixture.state().paneIds.includes("saved-lens-b"));
  const lens = page.locator('[data-workspace-lens="saved-lens-b"]');
  const parent = lens.getByText(/Controlled data reader/);
  const before = await parent.innerText();
  await page.evaluate(() => workspaceStartupFixture.navigate("saved-lens-b", { $tag: "ValuePresentationTarget",
    source: { $tag: "AccountSource", accountId: "account-c" }, focus: { $tag: "RootFocus" } }, undefined, undefined,
    { name: "Account C notes", icon: "globe" }));
  // The model is still held: nothing has committed, yet the lens is already in its destination.
  const destination = lens.locator("[data-navigation-destination]");
  await destination.getByText("Account C notes", { exact: true }).waitFor({ timeout: 2_000 });
  assert.equal(await lens.getAttribute("data-navigation-pending"), "true");
  assert.equal(await destination.getByRole("status", { name: "Opening Account C notes…" }).count(), 1);
  assert.equal(await parent.isVisible(), false);
  assert.equal(await parent.count(), 1, "The previous data stays mounted while the destination prepares");
  await page.evaluate(() => workspaceStartupFixture.cancelNavigation("saved-lens-b"));
  await destination.waitFor({ state: "detached", timeout: 1_000 });
  assert.equal(await lens.getAttribute("data-navigation-pending"), null);
  assert.equal(await parent.isVisible(), true);
  assert.equal(await parent.innerText(), before);
  await page.evaluate(() => workspaceStartupFixture.releaseModel());
  await page.waitForTimeout(500);
  const state = await page.evaluate(() => workspaceStartupFixture.state());
  assert.equal(state.edits.length, 0, "A navigation taken back never commits");
  assert.deepEqual(state.preferences.lenses[0]!.source, { $tag: "AccountSource", accountId: "account-b" });
  assert.equal(await parent.innerText(), before);
}));

test("lens navigation owner keeps only the latest clicked target while its model is pending", () => fixture("owner-navigation-latest", async page => {
  await page.waitForFunction(() => workspaceStartupFixture.state().paneIds.includes("saved-lens-b"));
  await page.evaluate(() => {
    const target = { $tag: "ValuePresentationTarget" as const, source: { $tag: "AccountSource" as const, accountId: "account-b" },
      focus: { $tag: "ValueFocus" as const, listId: "saved-list-b", itemId: "saved-b-value", rootItem: false, path: [], passThrough: [] } };
    workspaceStartupFixture.navigate("saved-lens-b", target, undefined, "table");
    workspaceStartupFixture.navigate("saved-lens-b", { ...target, focus: { ...target.focus, path: [{ $tag: "IndexStep", index: 1 }] } }, undefined, "grid");
    workspaceStartupFixture.releaseModel();
  });
  await page.waitForFunction(() => workspaceStartupFixture.state().edits.length === 2);
  const state = await page.evaluate(() => workspaceStartupFixture.state());
  assert.equal(state.editBatches.length, 1);
  const lens = state.preferences.lenses[0]!;
  assert.deepEqual(lens.presentation, { $tag: "GridPresentation" });
  assert.equal(lens.focus.$tag, "ValueFocus");
  if (lens.focus.$tag === "ValueFocus") assert.deepEqual(lens.focus.path, [{ $tag: "IndexStep", index: 1 }]);
}));

test("lens navigation owner refuses an old presentation when its source changes during flush", () => fixture("owner-navigation-source", async page => {
  await page.waitForFunction(() => workspaceStartupFixture.state().paneIds.includes("saved-lens-b"));
  await page.evaluate(() => {
    workspaceStartupFixture.holdPaneFlushes();
    workspaceStartupFixture.releaseModel();
    workspaceStartupFixture.navigate("saved-lens-b", { $tag: "ValuePresentationTarget",
      source: { $tag: "AccountSource", accountId: "account-b" }, focus: { $tag: "RootFocus" } }, undefined, "table");
  });
  await page.waitForFunction(() => workspaceStartupFixture.state().heldPaneFlushes === 1);
  await page.evaluate(() => workspaceStartupFixture.source("saved-lens-b", "account-c"));
  await page.waitForFunction(() => workspaceStartupFixture.state().heldPaneFlushes === 2);
  await page.evaluate(() => workspaceStartupFixture.releasePaneFlushes());
  await page.waitForFunction(() => workspaceStartupFixture.state().edits.length === 1);
  const state = await page.evaluate(() => workspaceStartupFixture.state());
  const edit = state.edits[0] as { command: { $tag: string } };
  assert.equal(edit.command.$tag, "SetLensSource");
  assert.deepEqual(state.preferences.lenses[0]!.source, { $tag: "AccountSource", accountId: "account-c" });
  assert.deepEqual(state.preferences.lenses[0]!.presentation, { $tag: "AutomaticPresentation" });
}));

test("lens navigation owner retires queued target changes on session replacement and disposal", async () => {
  for (const retire of ["session", "dispose"] as const) await fixture(`owner-navigation-${retire}`, async page => {
    await page.waitForFunction(() => workspaceStartupFixture.state().paneIds.includes("saved-lens-b"));
    await page.evaluate(() => workspaceStartupFixture.navigate("saved-lens-b", { $tag: "ValuePresentationTarget",
      source: { $tag: "AccountSource", accountId: "account-b" }, focus: { $tag: "RootFocus" } }, undefined, "grid"));
    await page.waitForFunction(() => workspaceStartupFixture.state().dynamicModules.some(name => name === "./workspace-model" || name === "./workspace-model-loader"));
    if (retire === "session") await page.evaluate(() => workspaceStartupFixture.switchAccount());
    else await page.evaluate(() => workspaceStartupFixture.dispose());
    await page.evaluate(() => workspaceStartupFixture.releaseModel());
    await page.waitForFunction(() => workspaceStartupFixture.state().modelPreparations > 0);
    assert.deepEqual(await page.evaluate(() => workspaceStartupFixture.state().edits), []);
  });
});

test("lens navigation owner reuses docked stack, docked split and floating placements with their chosen representation", async () => {
  for (const mode of ["stack", "split", "float"] as const) await fixture(`owner-navigation-${mode}`, async page => {
    await page.emulateMedia({ reducedMotion: "reduce" });
    await page.waitForFunction(() => workspaceStartupFixture.state().paneIds.includes("saved-lens-b"));
    const origin = await page.evaluate(() => workspaceStartupFixture.state().preferences.lenses[0]);
    await captureNavigationOwner(page, `lens-placement-${mode}-before`);
    await page.evaluate(mode => {
      workspaceStartupFixture.openLens("saved-lens-b", mode, "table");
      workspaceStartupFixture.releaseModel();
    }, mode);
    await page.waitForFunction(() => workspaceStartupFixture.state().edits.length === 3);
    const state = await page.evaluate(() => workspaceStartupFixture.state());
    assert.equal(state.editBatches.length, 1);
    assert.deepEqual((state.editBatches[0] as Array<{ $tag: string }>).map(command => command.$tag), [
      "SetWorkspaceDisplay", "AddWorkspaceLens", mode === "stack" ? "OpenWorkspaceLens" : "SplitWorkspaceLens",
    ]);
    assert.deepEqual(state.preferences.lenses[0], origin);
    const added = state.preferences.lenses[1]!;
    assert.deepEqual(added.source, origin!.source);
    assert.deepEqual(added.focus, origin!.focus);
    assert.deepEqual(added.presentation, { $tag: "TablePresentation" });
    assert.deepEqual(added.placement, mode === "float"
      ? { $tag: "FreePlacement", x: 36, y: 36, width: 520, height: 420 } : { $tag: "DockedPlacement" });
    assert.deepEqual(state.preferences.presentations, []);
    await captureNavigationOwner(page, `lens-placement-${mode}-after`);
  });
});

test("lens navigation owner retains the inspected type when its Code presentation opens in another placement", async () => {
  for (const mode of ["stack", "split", "float"] as const) await fixture("owner-navigation-held", async page => {
    await page.emulateMedia({ reducedMotion: "reduce" });
    await page.waitForFunction(() => workspaceStartupFixture.state().paneIds.includes("saved-lens-b"));
    const origin = await page.evaluate(() => workspaceStartupFixture.state().preferences.lenses[0]);
    await page.evaluate(mode => {
      workspaceStartupFixture.openLens("saved-lens-b", mode, "code");
      workspaceStartupFixture.releaseModel();
    }, mode);
    await page.waitForFunction(() => workspaceStartupFixture.state().edits.length === 3);
    const state = await page.evaluate(() => workspaceStartupFixture.state());
    const added = state.preferences.lenses[1]!;
    assert.deepEqual(added.subject, origin!.subject);
    assert.deepEqual(added.focus, origin!.focus);
    assert.deepEqual(added.presentation, { $tag: "CodePresentation" });
    assert.deepEqual(state.preferences.lenses[0], origin);
  });
});

async function captureLogo(page: Page, name: string) {
  const directory = process.env["FENEL_LOGO_CAPTURE_DIR"];
  if (!directory) return;
  await mkdir(directory, { recursive: true });
  await page.screenshot({ path: join(directory, `${name}.png`), fullPage: true });
}

async function clickLogo(page: Page) {
  await page.waitForFunction(() => workspaceStartupFixture.state().homeRegistered);
  const previous = await page.evaluate(() => workspaceStartupFixture.state().homeAttempts);
  await page.getByRole("link", { name: "Fenel home", exact: true }).click();
  await page.waitForFunction(count => workspaceStartupFixture.state().homeAttempts === count + 1, previous);
}

async function returnedToAllDataRoot(page: Page) {
  await page.locator('[data-locus-preview="public"]').waitFor();
  await page.getByRole("button", { name: "Account B", exact: true }).waitFor();
  const state = await page.evaluate(() => workspaceStartupFixture.state());
  const active = state.preferences.lenses.find(lens => lens.id === state.preferences.activeLensId)!;
  assert.equal(active.source.$tag, "AllDataSource");
  assert.deepEqual(active.focus, { $tag: "RootFocus" });
  assert.deepEqual(active.placement, { $tag: "DockedPlacement" });
  assert.ok(!active.subject || active.subject.$tag === "Nothing");
  assert.deepEqual(state.preferences.display, { $tag: "SingleLens" });
  const pane = page.locator(`[data-workspace-lens="${active.id}"]`);
  assert.equal(await pane.getAttribute("data-chrome-mode"), "expanded");
  assert.equal(await pane.locator(".lens-data-summary .home-item__caption-label").innerText(), "All data");
  const panels = pane.getByRole("group", { name: "Visible panels", exact: true });
  assert.equal(await panels.getByRole("button", { name: "Data", exact: true }).getAttribute("aria-pressed"), "true");
  assert.equal(await panels.getByRole("button", { name: "Expression", exact: true }).getAttribute("aria-pressed"), "false");
  assert.equal(await panels.getByRole("button", { name: "Code", exact: true }).getAttribute("aria-pressed"), "false");
  return state;
}

test("the Fenel logo shell keeps an addressed public-home fallback in both navigation locations", () => {
  assert.match(shellSource, /<a href="\/" class="topbar__brand" aria-label="Fenel home" data-home-navigation="true" onClick=\{handleHome\}/);
  assert.match(shellSource, /<a href="\/" class="sidebar-logo" aria-label="Fenel home" data-home-navigation="true" onClick=\{handleHome\}/);
  assert.match(shellSource, /event\.button !== 0 \|\| event\.ctrlKey \|\| event\.metaKey \|\| event\.shiftKey \|\| event\.altKey/);
});

test("All data navigation uses the shared root cards and account path on desktop and phone", async () => {
  for (const viewport of [{ width: 1024, height: 768 }, { width: 390, height: 844 }]) await fixture("logo-all-data-navigation", async page => {
    await page.setViewportSize(viewport);
    await page.emulateMedia({ reducedMotion: "reduce" });
    await page.getByText("Saved B data", { exact: true }).waitFor();
    const before = await page.evaluate(() => workspaceStartupFixture.state());
    const device = viewport.width === 390 ? "phone" : "desktop";
    await captureLogo(page, `all-data-${device}-before`);
    await clickLogo(page);
    await page.evaluate(() => workspaceStartupFixture.releaseModel());
    await page.locator('[data-locus-preview="public"]').waitFor();
    const root = await page.evaluate(() => workspaceStartupFixture.state());
    const activeId = root.preferences.activeLensId;
    const pane = page.locator(`[data-workspace-lens="${activeId}"]`);
    const canvas = pane.locator(".home-canvas");
    for (const label of ["Fenel", "Local", "Account A", "Account B", "Account C"]) {
      assert.equal(await canvas.getByRole("button", { name: label, exact: true }).count(), 1);
    }
    assert.equal(await page.locator(".account-data-selector").count(), 0, "Sources are data cards in the shared root");
    assert.equal(root.preferences.lenses.find(lens => lens.id === activeId)!.source.$tag, "AllDataSource");
    assert.equal(await canvas.locator(".home-entry__previews.home-list").count(), 1,
      "The automatic All data list uses the shared List fallback");
    assert.deepEqual(root.preferences.display, { $tag: "SingleLens" });
    for (const lens of before.preferences.lenses) assert.deepEqual(root.preferences.lenses.find(saved => saved.id === lens.id), lens);
    assert.deepEqual(root.subject, before.subject);
    assert.equal(root.epoch, before.epoch);
    assert.deepEqual(dataReads(root.requests).map(request => request.account), ["account-b"]);
    await captureLogo(page, `all-data-${device}-after`);

    await canvas.getByRole("button", { name: "Account B", exact: true }).click();
    await pane.locator('[data-locus-preview="root-only"]').waitFor();
    const heading = pane.locator(".lens-data-summary");
    assert.equal(await heading.locator(".lens-data-summary__account").innerText(), "Account B");
    assert.equal(await heading.locator(".home-item__caption-label").innerText(), "All data");
    assert.equal(await heading.locator(".home-item__type-tag").count(), 1);
    assert.deepEqual(await pane.locator('.locus-crumbs [aria-current="page"]').innerText(), "Account B");
    await captureLogo(page, `account-context-${device}-after`);
    await pane.getByRole("button", { name: "Go up", exact: true }).click();
    await pane.locator('[data-locus-preview="public"]').waitFor();

    await pane.locator(".home-canvas").getByRole("button", { name: "Fenel", exact: true }).click();
    await pane.getByRole("button", { name: "Standard library", exact: true }).waitFor();
    await pane.getByRole("button", { name: "Demo", exact: true }).click();
    await page.waitForFunction(id => {
      const state = workspaceStartupFixture.state();
      const lens = state.preferences.lenses.find(lens => lens.id === id);
      return lens?.source.$tag === "PublicSource" && lens.focus.$tag === "ValueFocus" && lens.focus.itemId === "demo";
    }, activeId);
    const path = pane.getByRole("navigation", { name: "Where you are", exact: true });
    if (device === "phone") {
      // A narrow lens toolbar reads its path as one button naming the whole path.
      assert.match(await path.locator(".locus-crumbs__compact").getAttribute("aria-label") ?? "", /^Path: All data > Fenel( > .+)? > Demo$/);
      assert.equal(await path.locator(".locus-crumbs__compact-name").innerText(), "Demo");
    } else {
      assert.equal(await path.getByRole("button", { name: "All data", exact: true }).count(), 1);
      assert.equal(await path.getByRole("button", { name: "Fenel", exact: true }).count(), 1);
      assert.equal(await path.locator('[aria-current="page"]').innerText(), "Demo");
    }
    await captureLogo(page, `all-data-demo-${device}-after`);
    const after = await page.evaluate(() => workspaceStartupFixture.state());
    for (const lens of before.preferences.lenses) assert.deepEqual(after.preferences.lenses.find(saved => saved.id === lens.id), lens);
    assert.deepEqual(after.subject, before.subject);
    assert.equal(after.requests.filter(request => request.method !== "GET" && request.path !== "/api/reader-metadata").every(request => request.path === "/api/locus-root" && request.account === "personal"), true,
      "Navigation writes only saved lens preferences");
  });
});

test("the logo opens All data from a floating public child and preserves existing lenses", async () => {
  for (const viewport of [{ width: 1024, height: 768 }, { width: 390, height: 844 }]) await fixture("logo-public", async page => {
    await page.setViewportSize(viewport);
    await page.emulateMedia({ reducedMotion: "reduce" });
    const pane = page.locator('[data-workspace-lens="saved-public"]');
    await pane.locator(".home-canvas").waitFor();
    const expression = pane.getByRole("button", { name: "Expression", exact: true });
    if (await expression.isVisible()) await expression.click();
    else {
      await pane.getByRole("button", { name: "Suggestions", exact: true }).click();
      await page.getByRole("menu", { name: "Suggestions", exact: true }).getByRole("menuitem", { name: "Expression", exact: true }).click();
    }
    await pane.getByRole("button", { name: "Compact lens header", exact: true }).click();
    await page.getByRole("button", { name: "Hide the top bar", exact: true }).click();
    await page.getByRole("button", { name: "Show the top bar", exact: true }).click();
    const before = await page.evaluate(() => workspaceStartupFixture.state());
    const device = viewport.width === 390 ? "phone" : "desktop";
    await captureLogo(page, `public-child-${device}-before`);
    await clickLogo(page);
    assert.equal((await page.evaluate(() => workspaceStartupFixture.state())).modelReleased, false);
    await page.evaluate(() => workspaceStartupFixture.releaseModel());
    const after = await returnedToAllDataRoot(page);
    assert.equal(after.preferences.lenses.length, before.preferences.lenses.length + 1);
    for (const lens of before.preferences.lenses) assert.deepEqual(after.preferences.lenses.find(saved => saved.id === lens.id), lens);
    assert.deepEqual(dataReads(after.requests), []);
    assert.equal(after.modelCalls.filter(name => name === "defaultWorkspaceLens").length, 1);
    await captureLogo(page, `public-child-${device}-after`);
  });
});

test("the addressed logo returns to All data and preserves the public lens", () => fixture("logo-public-addressed", async page => {
  await page.emulateMedia({ reducedMotion: "reduce" });
  await page.getByRole("button", { name: "Standard library", exact: true }).waitFor();
  const before = await page.evaluate(() => workspaceStartupFixture.state());
  await captureLogo(page, "addressed-logo-before-click");
  await clickLogo(page);
  await page.evaluate(() => workspaceStartupFixture.releaseModel());
  await page.waitForFunction(() => workspaceStartupFixture.state().homeResults.length === 1);
  await page.evaluate(() => new Promise<void>(resolve => requestAnimationFrame(() => requestAnimationFrame(() => resolve()))));
  await captureLogo(page, "addressed-logo-after-click");
  const after = await returnedToAllDataRoot(page);
  assert.deepEqual(after.homeResults, [true]);
  for (const lens of before.preferences.lenses) assert.deepEqual(after.preferences.lenses.find(saved => saved.id === lens.id), lens);
  assert.equal(after.preferences.lenses.length, before.preferences.lenses.length + 1);
}));

test("the bare root waits for All data without showing the Fenel account as its destination", () => fixture("addressed-root-pending", async (page, messages) => {
  await page.emulateMedia({ reducedMotion: "reduce" });
  await page.waitForFunction(() => workspaceStartupFixture.state().homeRegistered);
  await page.waitForFunction(() => document.querySelector('[aria-label="Opening All data…"]')
    || [...document.querySelectorAll("button")].some(button => button.textContent?.trim() === "Standard library"));
  assert.equal(await page.locator(".locus-background").count(), 1,
    "The shell mounts its shared Fenel background before any lens exists");
  await readyBackground(page);
  const background = await page.locator(".locus-background").elementHandle();
  assert.ok(background);
  const layers = await page.evaluate(() => ({
    background: getComputedStyle(document.querySelector(".locus-background")!).zIndex,
    shell: getComputedStyle(document.querySelector(".dashboard--home")!).zIndex,
    shellFill: getComputedStyle(document.querySelector(".dashboard--home")!).backgroundColor,
    bodyFill: getComputedStyle(document.querySelector(".main-content--home")!).backgroundColor,
  }));
  assert.ok(Number(layers.shell) > Number(layers.background), "The startup card sits above its backdrop");
  assert.equal(layers.shellFill, "rgba(0, 0, 0, 0)");
  assert.equal(layers.bodyFill, "rgba(0, 0, 0, 0)");
  await page.evaluate(() => new Promise<void>(resolve => requestAnimationFrame(() => requestAnimationFrame(() => resolve()))));
  await captureLogo(page, "root-address-pending");
  await captureLoadingRegression(page, "initial-address");
  assert.equal(await page.getByRole("button", { name: "Standard library", exact: true }).count(), 0);
  await page.getByLabel("Opening All data…", { exact: true }).waitFor();
  assert.equal(await page.locator(".workspace-pane").count(), 0,
    "Address resolution has no lens frame in which to display an inline spinner");
  const startupCard = page.getByRole("status", { name: "Opening All data…", exact: true });
  assert.equal(await startupCard.count(), 1,
    "The initial address must retain the shared Loading card until its first lens is mounted");
  assert.equal(await startupCard.locator(".workspace-startup__title").innerText(), "Loading...");
  assert.equal(await page.getByRole("list", { name: "Loading steps", exact: true }).count(), 1);
  assert.equal((await page.evaluate(() => workspaceStartupFixture.state())).modelReleased, false);
  await page.evaluate(() => workspaceStartupFixture.releaseModel());
  await page.locator('[data-locus-preview="public"]').waitFor();
  await page.waitForFunction(() => document.querySelectorAll(".workspace-startup__card").length === 0);
  assert.ok(await page.locator(".workspace-pane").count() > 0);
  assert.equal(await background.evaluate(element => element === document.querySelector(".locus-background")), true,
    "The same shell backdrop survives the handoff from startup card to lens frames");
  await readyBackground(page);
  const current = await page.evaluate(() => workspaceStartupFixture.state());
  assert.equal(current.preferences.lenses.find(lens => lens.id === current.preferences.activeLensId)!.source.$tag, "AllDataSource");
  assert.equal(await page.getByLabel("Opening All data…", { exact: true }).count(), 0);
  assert.deepEqual(messages.filter(message => message.includes("STRICT_READ_UNTRACKED")), [],
    "Initial loading, frame creation and model handoff keep reactive reads in their intended scopes");
}));

test("early inspection mode changes snapshot their pending intent without reactive warnings", () => fixture("logo-public-root", async (page, messages) => {
  await page.getByRole("button", { name: "Standard library", exact: true }).waitFor();
  const pane = page.locator('[data-workspace-lens="saved-public"]');
  await pane.locator(".lens-data-summary").getByRole("button", { name: "Open this data: List of anything", exact: true }).click();
  await page.getByLabel("Type data", { exact: true }).waitFor();
  for (const label of ["Code", "Expression", "Code", "Expression"]) {
    const control = pane.locator(`.data-inspection-dialog__presentations button[aria-label="${label}"]`);
    const before = await control.getAttribute("aria-pressed");
    await pane.getByRole("button", { name: "Suggestions", exact: true }).click();
    await page.getByRole("menu", { name: "Suggestions", exact: true }).getByRole("menuitem", { name: label, exact: true }).click();
    assert.equal(await control.getAttribute("aria-pressed"), before === "true" ? "false" : "true");
  }
  assert.equal((await page.evaluate(() => workspaceStartupFixture.state())).modelReleased, false);
  assert.equal(await page.getByLabel("Type data", { exact: true }).count(), 1);
  await page.evaluate(() => new Promise<void>(resolve => requestAnimationFrame(() => requestAnimationFrame(() => resolve()))));
  assert.deepEqual(messages.filter(message => message.includes("STRICT_READ_UNTRACKED")), [],
    "Mode changes update the existing pending inspection once and do not subscribe to their own writes");
}));

test("All data enters a clicked location at once while the lens model is held, and going up restores All data", () => fixture("addressed-root-projected", async page => {
  const preview = page.locator('[data-workspace-lens="initial-address-preview"]');
  const card = preview.locator('[data-locus-preview="account-b"]');
  await card.waitFor();
  const name = (await card.locator(".home-item__caption").innerText()).trim();
  assert.ok(name.length > 0);
  // The address preview's own summary keeps a placeholder until its data names itself.
  assert.ok(await preview.locator(".workspace-pane__summary-mount").locator(".workspace-pane__summary-placeholder, .lens-data-summary").count() > 0);
  const clicked = Date.now();
  await card.locator(".home-item__caption").click();
  const destination = preview.locator("[data-navigation-destination]");
  await destination.locator(".home-item__caption").getByText(name, { exact: true }).waitFor({ timeout: 2_000 });
  assert.ok(Date.now() - clicked < 2_000, "The destination shows before the held model");
  assert.equal(await preview.getAttribute("data-navigation-pending"), "true");
  const crumbs = preview.getByRole("navigation", { name: "Where you are" });
  assert.equal(await crumbs.locator('[aria-current="page"]').innerText().then(text => text.trim()), name);
  assert.equal(await card.isVisible(), false);
  assert.equal((await page.evaluate(() => workspaceStartupFixture.state())).modelReleased, false);
  await crumbs.getByRole("button", { name: "Go up", exact: true }).click();
  await destination.waitFor({ state: "detached", timeout: 1_000 });
  assert.equal(await card.isVisible(), true, "Going up is instant: All data is exactly as it was");
  assert.equal(await preview.getAttribute("data-navigation-pending"), null);
  await page.evaluate(() => workspaceStartupFixture.releaseModel());
  await page.waitForTimeout(500);
  const state = await page.evaluate(() => workspaceStartupFixture.state());
  assert.equal(state.preferences.lenses.find(lens => lens.id === state.preferences.activeLensId)!.source.$tag, "AllDataSource");
  assert.equal(await page.locator('[data-locus-preview="account-b"]').first().isVisible(), true);
}));

test("the checked All data root paints its admitted locations while the lens model is held", () => fixture("addressed-root-projected", async page => {
  await page.locator('[data-locus-preview="account-b"]').waitFor();
  await page.waitForFunction(() => document.querySelectorAll(".workspace-startup__card").length === 0);
  const locations = await page.locator("[data-locus-preview]").evaluateAll(elements => elements.map(element => element.getAttribute("data-locus-preview")));
  assert.deepEqual(locations, ["public", "local", "account-a", "account-b", "account-c"]);
  assert.equal(await page.getByRole("button", { name: "Standard library", exact: true }).count(), 0);
  assert.equal(await page.locator(".workspace-startup__card").count(), 0);
  assert.equal(await page.locator('[data-workspace-lens="initial-address-preview"]').count(), 1);
  const pending = await page.evaluate(() => workspaceStartupFixture.state());
  assert.equal(pending.modelReleased, false);
  assert.equal(pending.modelPreparations, 0);
  assert.deepEqual(pending.edits, []);
  assert.deepEqual(dataReads(pending.requests), []);
  await page.setViewportSize({ width: 390, height: 844 });
  const preview = page.locator('[data-workspace-lens="initial-address-preview"]');
  await preview.locator(".workspace-pane__summary .lens-data-summary").waitFor();
  assert.equal(await preview.locator(".workspace-pane__summary .home-item__caption").innerText(), "All data");
  const toolbar = await preview.locator(".workspace-pane__header .home-toolbar").evaluate(element => {
    const bounds = element.getBoundingClientRect();
    const header = element.closest(".workspace-pane__header")!.getBoundingClientRect();
    return { height: bounds.height, top: bounds.top, bottom: bounds.bottom, headerTop: header.top, headerBottom: header.bottom,
      wrap: getComputedStyle(element).flexWrap, horizontalOverflow: document.documentElement.scrollWidth > innerWidth };
  });
  assert.equal(toolbar.wrap, "nowrap");
  assert.ok(toolbar.height <= 28.1 && toolbar.top >= toolbar.headerTop && toolbar.bottom <= toolbar.headerBottom,
    "The startup toolbar stays inside its ordinary single-row lens header");
  assert.equal(toolbar.horizontalOverflow, false);
  await page.setViewportSize({ width: 1024, height: 768 });
  await captureLoadingRegression(page, "early-all-data");
  await page.evaluate(() => workspaceStartupFixture.releaseModel());
  await page.waitForFunction(() => !document.querySelector('[data-workspace-lens="initial-address-preview"]'));
  await page.locator('[data-locus-preview="account-b"]').waitFor();
  const ready = await page.evaluate(() => workspaceStartupFixture.state());
  assert.equal(ready.preferences.lenses.find(lens => lens.id === ready.preferences.activeLensId)!.source.$tag, "AllDataSource");
  assert.deepEqual(dataReads(ready.requests), []);
}));

for (const width of [1024, 390]) test(`initial address controls paint and Browse works before the lens model is ready at ${width}px`, () => fixture("addressed-root-projected", async (page, messages) => {
  await page.emulateMedia({ reducedMotion: "reduce" });
  await page.locator('[data-locus-preview="local"]').waitFor();
  const topbar = page.locator(".topbar");
  const preview = page.locator('[data-workspace-lens="initial-address-preview"]');
  const browse = preview.getByRole("button", { name: "Browse", exact: true });
  for (const label of ["Browse", "New data"]) {
    assert.equal(await topbar.getByRole("button", { name: label, exact: true }).count(), 0);
    assert.equal(await (label === "Browse" ? preview.getByRole("button", { name: label, exact: true })
      : preview.locator(".home-new-button")).isVisible(), true);
  }
  assert.equal(await topbar.getByRole("button", { name: "Lenses", exact: true }).isVisible(), true);
  for (const label of ["Data", "Expression", "Code", "Dependencies", "Suggestions panel", "Suggestions"]) {
    await preview.getByRole("button", { name: label, exact: true }).waitFor();
  }
  assert.equal(await page.getByRole("button", { name: "More creation options", exact: true }).count(), 0);
  await browse.click();
  const drawer = page.getByRole("complementary", { name: "Browse and search", exact: true });
  await drawer.waitFor();
  await drawer.getByRole("button", { name: /Local/ }).waitFor();
  await drawer.getByRole("combobox").fill("Local");
  await topbar.getByRole("button", { name: "Lenses", exact: true }).click();
  const menu = page.getByRole("menu", { name: "Lenses", exact: true });
  await menu.waitFor();
  await menu.getByRole("menuitemradio", { name: "Automatic synchronization", exact: true }).click();
  await menu.waitFor({ state: "hidden" });
  assert.equal(await topbar.getByRole("button", { name: "Automatic synchronization", exact: true }).getAttribute("aria-pressed"), "false");
  await preview.getByRole("button", { name: "Code", exact: true }).click();
  assert.equal(await preview.getByRole("button", { name: "Code", exact: true }).getAttribute("aria-pressed"), "true");
  await page.setViewportSize({ width, height: width === 390 ? 844 : 768 });
  const checkMode = async (mode: "expanded" | "compact" | "hidden") => {
    await page.waitForFunction(expected => document.querySelector('[data-workspace-lens="initial-address-preview"]')?.getAttribute("data-chrome-mode") === expected, mode);
    const header = preview.locator(".workspace-pane__header");
    assert.equal(await header.getAttribute("inert") !== null, mode === "hidden");
    assert.equal(await header.getAttribute("aria-hidden"), mode === "hidden" ? "true" : null);
    if (mode === "hidden") {
      assert.equal(await preview.getByRole("button", { name: "Show lens controls", exact: true }).isVisible(), true);
      assert.equal(await header.evaluate(element => element.getBoundingClientRect().height), 0);
      assert.equal(await header.evaluate(element => getComputedStyle(element).pointerEvents), "none");
    } else {
      const fold = preview.getByRole("button", { name: mode === "expanded" ? "Compact lens header" : "Hide lens controls", exact: true });
      assert.equal(await fold.isVisible(), true);
      assert.equal(await fold.evaluate(element => {
        const box = element.getBoundingClientRect();
        const parent = element.closest(".workspace-pane__header")!.getBoundingClientRect();
        return box.left >= parent.left && box.right <= parent.right && box.top >= parent.top && box.bottom <= parent.bottom;
      }), true, `The ${mode} lens fold fits at ${width}px`);
    }
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth), false);
  };
  await checkMode("expanded");
  await preview.getByRole("button", { name: "Compact lens header", exact: true }).click();
  await checkMode("compact");
  await preview.getByRole("button", { name: "Hide lens controls", exact: true }).click();
  await checkMode("hidden");
  await preview.getByRole("button", { name: "Show lens controls", exact: true }).click();
  await checkMode("compact");
  await preview.getByRole("button", { name: "Expand lens header", exact: true }).click();
  await checkMode("expanded");
  await preview.getByRole("button", { name: "Compact lens header", exact: true }).click();
  await preview.getByRole("button", { name: "Hide lens controls", exact: true }).click();
  await checkMode("hidden");
  const held = await page.evaluate(() => workspaceStartupFixture.state());
  assert.equal(held.modelReleased, false);
  assert.deepEqual(held.edits, []);
  assert.deepEqual(dataReads(held.requests), []);
  const handoff = await page.evaluate(async () => {
    workspaceStartupFixture.releaseModel();
    const counts: number[] = [];
    for (let frame = 0; frame < 12; frame++) {
      counts.push(document.querySelectorAll(".topbar .workspace-controls").length);
      await new Promise<void>(resolve => requestAnimationFrame(() => resolve()));
    }
    return counts;
  });
  await page.waitForFunction(() => !document.querySelector('[data-workspace-lens="initial-address-preview"]'));
  assert.ok(handoff.every(count => count === 1), "Address handoff keeps global controls present on every paint frame");
  await drawer.waitFor();
  assert.equal(await drawer.getByRole("combobox").inputValue(), "Local", "The visible Browse panel keeps the user's query across address handoff");
  await drawer.getByRole("button", { name: /Local/ }).waitFor();
  const prepared = page.locator(".workspace-pane");
  assert.equal(await prepared.getAttribute("data-chrome-mode"), "hidden", "The same lens stays hidden across model preparation");
  assert.equal(await prepared.getByRole("button", { name: "Show lens controls", exact: true }).isVisible(), true);
  await prepared.getByRole("button", { name: "Show lens controls", exact: true }).click();
  await page.waitForFunction(() => document.querySelector(".workspace-pane")?.getAttribute("data-chrome-mode") === "compact");
  await prepared.getByRole("button", { name: "Expand lens header", exact: true }).click();
  await page.waitForFunction(() => document.querySelector(".workspace-pane")?.getAttribute("data-chrome-mode") === "expanded");
  assert.equal(await prepared.getByRole("button", { name: "Code", exact: true, includeHidden: true }).getAttribute("aria-pressed"), "true",
    "The existing lens retains its chosen inspection panel across the model handoff");
  assert.deepEqual(messages.filter(message => message.includes("STRICT_READ_UNTRACKED")), []);
}));

test("anonymous root locations render before sign-in and model preparation", () => fixture("startup-root-anonymous", async page => {
  await page.locator('[data-locus-preview="local"]').waitFor();
  assert.deepEqual(await page.locator("[data-locus-preview]").evaluateAll(elements => elements.map(element => element.getAttribute("data-locus-preview"))), ["public", "local"]);
  const pending = await page.evaluate(() => workspaceStartupFixture.state());
  assert.equal(pending.authLoading, true);
  assert.equal(pending.subject, null);
  assert.equal(pending.modelReleased, false);
  assert.equal(pending.modelPreparations, 0);
  assert.deepEqual(pending.requests.map(request => request.path), ["/api/auth/me"]);
  await page.evaluate(() => workspaceStartupFixture.releaseSubject("anonymous"));
  await page.waitForFunction(() => workspaceStartupFixture.state().subject?.$tag === "Anonymous");
  await page.locator('[data-locus-preview="local"]').waitFor();
  await page.waitForFunction(() => document.querySelectorAll(".workspace-startup__card").length === 0);
  assert.equal(await page.locator(".workspace-startup__card").count(), 0);
}));

for (const selector of ["argument", "control"] as const) test(`the early root preserves reserved query ordering for a public ${selector}`, () => fixture(`addressed-root-projected-public-${selector}`, async page => {
  if (selector === "argument") {
    await page.locator('[data-locus-preview="account-b"]').waitFor();
    assert.equal(await page.getByRole("button", { name: "Standard library", exact: true }).count(), 0);
  } else {
    await page.getByRole("button", { name: "Standard library", exact: true }).waitFor();
    assert.equal(await page.locator('[data-locus-preview="account-b"]').count(), 0);
  }
  const pending = await page.evaluate(() => workspaceStartupFixture.state());
  assert.equal(pending.modelReleased, false);
  assert.deepEqual(pending.edits, []);
  assert.deepEqual(dataReads(pending.requests), []);
}));

test("authenticated bootstrap replaces early anonymous locations without opening account data", () => fixture("startup-root-user", async page => {
  await page.locator('[data-locus-preview="local"]').waitFor();
  assert.equal(await page.locator('[data-locus-preview="account-b"]').count(), 0);
  await page.evaluate(() => workspaceStartupFixture.releaseSubject("user"));
  await page.locator('[data-locus-preview="account-b"]').waitFor();
  await page.waitForFunction(() => document.querySelectorAll(".workspace-startup__card").length === 0);
  const pending = await page.evaluate(() => workspaceStartupFixture.state());
  assert.equal(pending.subject?.$tag, "User");
  assert.equal(pending.modelReleased, false);
  assert.equal(pending.modelPreparations, 0);
  assert.deepEqual(dataReads(pending.requests), []);
  assert.deepEqual(pending.edits, []);
  assert.equal(await page.locator('[data-locus-preview="personal"]').count(), 0);
  assert.equal(await page.locator(".workspace-startup__card").count(), 0);
}));

async function editPendingCreationText(page: Page, text: string) {
  await page.getByRole("dialog", { name: "New data", exact: true }).getByRole("button", { name: "Edit", exact: true }).click();
  const editor = page.getByRole("dialog", { name: "Expression", exact: true });
  await editor.getByRole("textbox").fill(text);
  await editor.getByRole("button", { name: "Close argument", exact: true }).click();
}
async function assertPendingCreationText(page: Page, text: string) {
  await page.getByRole("dialog", { name: "New data", exact: true }).getByRole("button", { name: "Edit", exact: true }).click();
  const editor = page.getByRole("dialog", { name: "Expression", exact: true });
  assert.equal(await editor.getByRole("textbox").inputValue(), text);
  await editor.getByRole("button", { name: "Close argument", exact: true }).click();
}

test("a held initial saved-lens candidate cannot cross an account change", () => fixture("startup-root-local-auth-user-candidate-switch", async (page, messages) => {
  await page.locator('[data-locus-preview="local"] .home-item__body').click();
  await page.evaluate(() => workspaceStartupFixture.releaseModel());
  await page.getByText("Saved local text", { exact: true }).waitFor();
  await page.evaluate(() => workspaceStartupFixture.releaseSubject("user"));
  await page.waitForFunction(() => !workspaceStartupFixture.state().authLoading);
  await page.getByText("Saved local text", { exact: true }).waitFor();
  await page.locator(".home-entry").evaluate(element => {
    const data = new DataTransfer(); data.setData("text/plain", "Local capture before switching accounts");
    element.dispatchEvent(new ClipboardEvent("paste", { clipboardData: data, bubbles: true, cancelable: true }));
  });
  await page.waitForFunction(() => workspaceStartupFixture.state().localTransfersPending);
  await page.evaluate(() => workspaceStartupFixture.releaseBootstrap());
  await page.evaluate(async () => { for (let frame = 0; frame < 24; frame++) await new Promise<void>(resolve => requestAnimationFrame(() => resolve())); });
  assert.equal(await page.getByText("Saved local text", { exact: true }).isVisible(), true);
  assert.equal((await page.evaluate(() => workspaceStartupFixture.state())).requests.some(request => request.account === "account-b"), false);
  await page.evaluate(() => workspaceStartupFixture.switchAccount());
  await page.waitForFunction(() => {
    const state = workspaceStartupFixture.state();
    return state.subject?.$tag === "User" && state.subject.accountId === "account-c" && state.epoch === 2;
  });
  await page.evaluate(async () => { for (let frame = 0; frame < 4; frame++) await new Promise<void>(resolve => requestAnimationFrame(() => resolve())); });
  await page.evaluate(() => workspaceStartupFixture.releaseBootstrap());
  await page.waitForFunction(() => workspaceStartupFixture.state().preferences.lenses.some(lens => lens.id === "lens-c"));
  await page.getByText("Saved local text", { exact: true }).waitFor();
  const state = await page.evaluate(() => workspaceStartupFixture.state());
  assert.equal(state.localTransfersPending, false, "A later account change retires old Local captures");
  assert.equal(state.requests.some(request => request.account === "account-b"), false,
    "The obsolete candidate never mounts an account reader when its queue hold is released");
  assert.equal(state.localSourceEpoch, state.epoch, "The selected Local address uses the new account epoch's reader");
  assert.equal(await page.getByText("Saved B data", { exact: true }).count(), 0);
  assert.equal(await page.locator(".workspace-startup__card").count(), 0);
  assert.deepEqual(messages.filter(message => message.includes("STRICT_READ_UNTRACKED")), []);
}));

test("saved lenses wait for a nested Local paste captured after the first cookie until Cancel", () => fixture("startup-root-local-auth-user-nested", async page => {
  await page.locator('[data-locus-preview="local"] .home-item__body').click();
  await page.evaluate(() => workspaceStartupFixture.releaseModel());
  await page.getByText("Saved local text", { exact: true }).waitFor();
  await page.evaluate(() => workspaceStartupFixture.releaseSubject("user"));
  await page.waitForFunction(() => !workspaceStartupFixture.state().authLoading);
  await page.getByText("Saved local text", { exact: true }).waitFor();
  await page.getByText("Saved local item", { exact: true }).click();
  await page.waitForFunction(() => workspaceStartupFixture.state().preferences.lenses
    .find(lens => lens.id === workspaceStartupFixture.state().preferences.activeLensId)?.focus.$tag === "ValueFocus");
  await page.locator(".workspace-surface").evaluate(element => { (element as HTMLElement).dataset.nestedPaste = "held"; });
  await page.locator(".home-entry").evaluate(element => {
    const data = new DataTransfer(); data.setData("text/plain", "Nested paste after sign-in");
    element.dispatchEvent(new ClipboardEvent("paste", { clipboardData: data, bubbles: true, cancelable: true }));
  });
  await page.waitForFunction(() => workspaceStartupFixture.state().localTransfersPending);
  assert.equal((await page.evaluate(() => workspaceStartupFixture.state())).localPasteAttempts.length, 0,
    "Nested captures keep their existing checked editor path");
  await page.evaluate(() => workspaceStartupFixture.releaseBootstrap());
  await page.evaluate(async () => { for (let frame = 0; frame < 24; frame++) await new Promise<void>(resolve => requestAnimationFrame(() => resolve())); });
  assert.equal(await page.locator('[data-nested-paste="held"]').count(), 1);
  assert.equal((await page.evaluate(() => workspaceStartupFixture.state())).localTransfersPending, true);
  await page.getByRole("button", { name: /notification/ }).click();
  await page.getByRole("button", { name: "Cancel", exact: true }).click();
  await page.waitForFunction(() => !workspaceStartupFixture.state().localTransfersPending);
  await page.waitForFunction(() => !document.querySelector('[data-nested-paste="held"]'));
  assert.equal(await page.locator(".workspace-startup__card").count(), 0);
}));

for (const resolved of ["anonymous", "user"] as const) for (const width of [1024, 390]) {
  test(`All data stays visible through ${resolved} sign-in resolution at ${width}px with normal motion`, () => fixture(`startup-root-${resolved}`, async page => {
    await page.setViewportSize({ width, height: 768 });
    await page.emulateMedia({ reducedMotion: "no-preference" });
    await page.locator('[data-locus-preview="local"]').waitFor();
    await page.getByLabel("Current data", { exact: true }).waitFor();
    const samples = await page.evaluate(async kind => {
      const selectors = {
        pane: ".workspace-pane",
        heading: ".workspace-pane__header .home-toolbar",
        summary: ".workspace-pane__summary .lens-data-summary",
        publicCard: '[data-locus-preview="public"] .home-item__body',
        localCard: '[data-locus-preview="local"] .home-item__body',
      };
      const visibleOpacity = (selector: string) => {
        const element = document.querySelector<HTMLElement>(selector);
        if (!element || !element.getBoundingClientRect().height) return 0;
        let opacity = 1;
        for (let parent: HTMLElement | null = element; parent; parent = parent.parentElement) {
          const style = getComputedStyle(parent);
          if (style.display === "none" || style.visibility !== "visible") return 0;
          opacity *= Number(style.opacity);
        }
        return opacity;
      };
      // Wait for the initial paint's finite animations before triggering the
      // actual auth transaction. The handoff itself is sampled at every paint.
      await Promise.all(document.getAnimations().filter(animation => animation.effect?.getTiming().iterations !== Infinity)
        .map(animation => animation.finished.catch(() => undefined)));
      const frames: Array<{ opacities: Record<string, number>; account: boolean; startup: boolean }> = [];
      const sample = () => frames.push({
        opacities: Object.fromEntries(Object.entries(selectors).map(([name, selector]) => [name, visibleOpacity(selector)])),
        account: !!document.querySelector('[data-locus-preview="account-b"]'),
        startup: !!document.querySelector(".workspace-startup__card"),
      });
      sample();
      workspaceStartupFixture.releaseSubject(kind);
      for (let frame = 0; frame < 32; frame++) {
        await new Promise<void>(resolve => requestAnimationFrame(() => resolve()));
        sample();
      }
      return frames;
    }, resolved);
    assert.equal(samples.some(frame => frame.startup), false, JSON.stringify(samples));
    assert.ok(samples.every(frame => Object.values(frame.opacities).every(opacity => opacity >= 0.999)),
      `Sign-in must not fade the mounted lens or its unchanged data: ${JSON.stringify(samples)}`);
    assert.equal(samples.at(-1)!.account, resolved === "user");
    assert.deepEqual(dataReads((await page.evaluate(() => workspaceStartupFixture.state())).requests), []);
  }));
}

test("the logo retires an early root-type inspection while its subject handoff still awaits the model", () => fixture("logo-public-root", async page => {
  await page.getByRole("button", { name: "Standard library", exact: true }).waitFor();
  const pane = page.locator('[data-workspace-lens="saved-public"]');
  await pane.locator(".lens-data-summary").getByRole("button", { name: "Open this data: List of anything", exact: true }).click();
  await page.getByLabel("Type data", { exact: true }).waitFor();
  await pane.getByRole("button", { name: "Code", exact: true }).click();
  await clickLogo(page);
  await page.evaluate(() => workspaceStartupFixture.releaseModel());
  const after = await returnedToAllDataRoot(page);
  assert.equal(after.preferences.lenses.find(lens => lens.id === "saved-public")!.source.$tag, "PublicSource");
  assert.equal(await page.getByLabel("Type data", { exact: true }).count(), 0);
  const homeBatch = after.editBatches.findIndex(batch => batch.some(command => (command as { $tag: string }).$tag === "SetWorkspaceDisplay"));
  assert.ok(homeBatch >= 0);
  assert.equal(after.editBatches.slice(homeBatch).some(batch => batch.some(command =>
    (command as { command?: { $tag: string } }).command?.$tag === "SetLensSubject")), false,
    "A delayed exact type handoff cannot replace the root after Home's final reset");
}));

test("the logo leaves an existing docked public root intact when opening All data", () => fixture("logo-public-docked", async page => {
  await page.getByRole("button", { name: "Standard library", exact: true }).waitFor();
  const pane = page.locator('[data-workspace-lens="saved-public"]');
  await pane.locator(".lens-data-summary").getByRole("button", { name: "Open this data: List of anything", exact: true }).click();
  await page.getByLabel("Type data", { exact: true }).waitFor();
  await pane.getByRole("button", { name: "Expression", exact: true }).click();
  await pane.getByRole("button", { name: "Compact lens header", exact: true }).click();
  await captureLogo(page, "public-type-desktop-before");
  const before = await page.evaluate(() => workspaceStartupFixture.state());
  await clickLogo(page);
  await page.evaluate(() => workspaceStartupFixture.releaseModel());
  await page.waitForFunction(() => workspaceStartupFixture.state().homeResults.length === 1);
  const early = await returnedToAllDataRoot(page);
  assert.deepEqual(early.homeResults, [true]);
  assert.equal(early.modelReleased, true);
  for (const lens of before.preferences.lenses) assert.deepEqual(early.preferences.lenses.find(saved => saved.id === lens.id), lens);
  assert.equal(await page.getByLabel("Type data", { exact: true }).count(), 0);
  await captureLogo(page, "public-type-desktop-after");
  await page.evaluate(() => workspaceStartupFixture.releaseModel());
  await page.waitForFunction(() => workspaceStartupFixture.state().modelCalls.includes("workspaceBootstrapReady"));
  assert.equal(await page.getByLabel("Type data", { exact: true }).count(), 0);
  assert.equal((await page.evaluate(() => workspaceStartupFixture.state())).preferences.lenses[0]!.subject?.$tag === "Just", false,
    "The previously waiting subject handoff cannot reopen the type after instant Home");
}));

test("the logo closes a pending read-only public Browse intent while opening All data", () => fixture("logo-public-docked", async page => {
  await page.getByRole("button", { name: "Standard library", exact: true }).waitFor();
  const pane = page.locator('[data-workspace-lens="saved-public"]');
  await pane.getByRole("button", { name: "Browse", exact: true }).click();
  await page.waitForFunction(() => workspaceStartupFixture.state().dynamicModules.includes("./public-locus-data"));
  const before = await page.evaluate(() => workspaceStartupFixture.state());
  assert.equal(before.modelReleased, false);
  await clickLogo(page);
  await page.evaluate(() => workspaceStartupFixture.releaseModel());
  await page.waitForFunction(() => workspaceStartupFixture.state().homeResults.length === 1);
  const after = await returnedToAllDataRoot(page);
  assert.deepEqual(after.homeResults, [true]);
  assert.equal(after.modelReleased, true);
  for (const lens of before.preferences.lenses) assert.deepEqual(after.preferences.lenses.find(saved => saved.id === lens.id), lens);
  assert.equal(await page.getByRole("complementary", { name: "Browse and search", exact: true }).count(), 0);
  assert.equal(after.preferences.lenses.find(lens => lens.id === after.preferences.activeLensId)!.source.$tag, "AllDataSource");
}));

test("the logo opens All data from an account and preserves all account lenses and login", () => fixture("logo-account", async page => {
  await page.getByText("Saved B data", { exact: true }).waitFor();
  const before = await page.evaluate(() => workspaceStartupFixture.state());
  await captureLogo(page, "account-desktop-before");
  await clickLogo(page);
  await page.evaluate(() => workspaceStartupFixture.releaseModel());
  const after = await returnedToAllDataRoot(page);
  assert.equal(after.preferences.lenses.length, before.preferences.lenses.length + 1);
  assert.equal(after.modelCalls.filter(name => name === "defaultWorkspaceLens").length, 1);
  for (const lens of before.preferences.lenses) assert.deepEqual(after.preferences.lenses.find(saved => saved.id === lens.id), lens);
  assert.deepEqual(after.subject, before.subject);
  assert.equal(after.epoch, before.epoch);
  assert.deepEqual(dataReads(after.requests).map(request => request.account), ["account-b"]);
  assert.equal(after.requests.filter(request => request.method !== "GET" && request.path !== "/api/reader-metadata").every(request => request.path === "/api/locus-root" && request.account === "personal"), true);
  await captureLogo(page, "account-desktop-after");
}));

test("the logo reuses a saved All data lens and leaves every other saved lens intact", () => fixture("logo-existing", async page => {
  await page.getByText("Saved B data", { exact: true }).waitFor();
  const before = await page.evaluate(() => workspaceStartupFixture.state());
  await clickLogo(page);
  await page.evaluate(() => workspaceStartupFixture.releaseModel());
  const after = await returnedToAllDataRoot(page);
  assert.equal(after.preferences.activeLensId, "saved-all");
  assert.equal(after.preferences.lenses.length, before.preferences.lenses.length);
  assert.equal(after.modelCalls.includes("defaultWorkspaceLens"), false);
  for (const lens of before.preferences.lenses.filter(lens => lens.source.$tag !== "AllDataSource")) {
    assert.deepEqual(after.preferences.lenses.find(saved => saved.id === lens.id), lens);
  }
  assert.deepEqual(after.subject, before.subject);
}));

test("the logo returns from This tab to All data without changing the authenticated account", () => fixture("logo-local", async page => {
  await page.locator('[data-workspace-lens="saved-lens-b"]').waitFor();
  const before = await page.evaluate(() => workspaceStartupFixture.state());
  await clickLogo(page);
  await page.evaluate(() => workspaceStartupFixture.releaseModel());
  const after = await returnedToAllDataRoot(page);
  assert.deepEqual(after.preferences.lenses.find(lens => lens.id === "saved-lens-b"), before.preferences.lenses.find(lens => lens.id === "saved-lens-b"));
  assert.deepEqual(after.subject, before.subject);
  assert.deepEqual(dataReads(after.requests), []);
}));

for (const scenario of ["logo-local-empty", "logo-local-persisted"]) test(`${scenario}: Local renders structural Clipboard before preparation and New requests once`, () => fixture(scenario, async page => {
  await page.locator('[data-locus-preview="fixture-local:clipboard"]').waitFor();
  await page.locator('[data-locus-preview="fixture-local:clipboard"] .locus-previews').waitFor();
  if (scenario === "logo-local-persisted") await page.getByText("Saved local text", { exact: true }).waitFor();
  await page.evaluate(async () => {
    await new Promise<void>(resolve => requestAnimationFrame(() => requestAnimationFrame(() => resolve())));
  });
  let state = await page.evaluate(() => workspaceStartupFixture.state());
  assert.equal(state.localRootReads > 0, true);
  assert.equal(state.localPreparations, 0);
  assert.equal(await page.getByText("Preparing data reader…", { exact: true }).count(), 0);
  assert.equal(state.dynamicModules.some(name => name.includes("authoring-catalog-worker") || name === "./reader-presentation"), false);
  // The existing + New intent is the first semantic demand. Keep the complete
  // source preparation held and verify the real editor handoff remains pending.
  await page.locator(".home-new-button").click();
  await page.getByRole("dialog", { name: "New data", exact: true }).waitFor();
  await page.evaluate(() => workspaceStartupFixture.releaseModel());
  await page.waitForFunction(() => workspaceStartupFixture.state().localPreparations === 1);
  state = await page.evaluate(() => workspaceStartupFixture.state());
  assert.equal(state.localPreparations, 1);
  assert.equal(await page.getByRole("dialog", { name: "New data", exact: true }).isVisible(), true);
  assert.deepEqual(dataReads(state.requests), []);
}));

for (const scenario of ["logo-public-new-readonly", "logo-public-new-readonly-all", "logo-public-new-readonly-existing"]) {
  for (const width of [1024, 390]) test(`${scenario} ${width}: read-only New opens the existing composer in Local`, () => fixture(scenario, async page => {
    await page.emulateMedia({ reducedMotion: "reduce" });
    await page.setViewportSize({ width, height: width === 390 ? 844 : 768 });
    await page.locator('[data-workspace-lens="saved-public"]').waitFor();
    await page.locator('[data-workspace-lens="saved-public"] .home-new-button').waitFor();
    await page.evaluate(() => new Promise<void>(resolve => requestAnimationFrame(() => requestAnimationFrame(() => resolve()))));
    const before = await page.evaluate(() => workspaceStartupFixture.state());
    const captureDirectory = process.env["FENEL_STARTUP_NEW_CAPTURE_DIR"];
    if (captureDirectory) {
      await mkdir(captureDirectory, { recursive: true });
      await page.screenshot({ path: join(captureDirectory, `${scenario}-${width}-before.png`) });
    }
    await page.locator('[data-workspace-lens="saved-public"] .home-new-button').click();
    await page.evaluate(() => workspaceStartupFixture.releaseModel());
    await page.getByRole("dialog", { name: "New data", exact: true }).waitFor();
    const after = await page.evaluate(() => workspaceStartupFixture.state());
    const selected = after.preferences.lenses.find(lens => lens.id === after.preferences.activeLensId);
    assert.equal(selected?.source.$tag, "ThisTabSource");
    assert.equal(selected?.focus.$tag, "RootFocus");
    assert.equal(after.preferences.lenses.filter(lens => lens.source.$tag === "ThisTabSource").length, 1);
    if (scenario.endsWith("existing")) assert.equal(selected?.id, "existing-local");
    assert.deepEqual(after.preferences.lenses.find(lens => lens.id === "saved-public"), before.preferences.lenses.find(lens => lens.id === "saved-public"));
    assert.equal(after.requests.some(request => request.method !== "GET" && request.account !== "personal" && request.path !== "/api/reader-metadata"), false);
    assert.equal(after.localPreparations, 1);
    if (captureDirectory) await page.screenshot({ path: join(captureDirectory, `${scenario}-${width}-after.png`) });
  }));
}

for (const scenario of ["addressed-root-projected", "startup-root-local-navigation"]) for (const interaction of ["caption", "body"]) test(`${scenario} ${interaction}: All data to Local navigation does not mount the persisted public reader`, () => fixture(scenario, async page => {
  await page.locator('[data-locus-preview="local"]').waitFor();
  await page.evaluate(() => new Promise<void>(resolve => requestAnimationFrame(() => requestAnimationFrame(() => resolve()))));
  let state = await page.evaluate(() => workspaceStartupFixture.state());
  assert.equal(state.localPreparations, 0);
  assert.equal(state.dynamicModules.includes("./public-locus-data"), false);
  if (interaction === "caption") await page.locator(".home-canvas").getByRole("button", { name: "Local", exact: true }).click();
  else await page.locator('[data-locus-preview="local"] .home-item__body').click();
  // Hold the real projected-model promise through browser rendering. Releasing
  // it in the click's next microtask hides a transient stale-reader mount.
  await page.evaluate(() => new Promise<void>(resolve => requestAnimationFrame(() => requestAnimationFrame(() => resolve()))));
  state = await page.evaluate(() => workspaceStartupFixture.state());
  assert.equal(state.preferences.lenses.find(lens => lens.id === state.preferences.activeLensId)?.source.$tag, "PublicSource");
  assert.equal(await page.locator('[data-workspace-lens="initial-address-preview"]').count(), 1);
  assert.equal(await page.getByRole("button", { name: "Standard library", exact: true }).count(), 0);
  assert.equal(state.dynamicModules.includes("./public-locus-data"), false);
  await page.evaluate(() => workspaceStartupFixture.releaseModel());
  await page.locator('[data-locus-preview="fixture-local:clipboard"] .locus-previews').waitFor();
  await page.evaluate(() => new Promise<void>(resolve => requestAnimationFrame(() => requestAnimationFrame(() => resolve()))));
  state = await page.evaluate(() => workspaceStartupFixture.state());
  assert.equal(state.preferences.lenses.find(lens => lens.id === state.preferences.activeLensId)?.source.$tag, "ThisTabSource");
  assert.equal(state.localPreparations, 0);
  assert.equal(state.dynamicModules.includes("./public-locus-data"), false);
  assert.equal(await page.getByRole("button", { name: "Standard library", exact: true }).count(), 0);
  assert.deepEqual(dataReads(state.requests), []);
}));

test("outer portal Home handoff retains Local controls and cancelable Function creation", () => fixture("startup-root-local-navigation-portal", async page => {
  const initial = page.locator('[data-workspace-lens="initial-address-preview"]');
  const clipboard = page.locator('[data-locus-preview="fixture-local:clipboard"] .locus-previews');
  const saved = page.getByText("Saved local text", { exact: true });
  const newData = page.locator(".home-new-button");
  const more = page.getByRole("button", { name: "More creation options", exact: true });
  const capture = async (stage: string) => {
    await page.evaluate(async () => {
      await Promise.all(document.getAnimations().filter(animation => animation.effect?.getTiming().iterations !== Infinity)
        .map(animation => animation.finished.catch(() => undefined)));
      await new Promise<void>(resolve => requestAnimationFrame(() => requestAnimationFrame(() => resolve())));
    });
    const directory = process.env["FENEL_STARTUP_OWNER_CAPTURE_DIR"] ?? process.env["FENEL_HOME_ENTRY_CAPTURE_DIR"];
    if (!directory) return;
    await mkdir(directory, { recursive: true });
    await page.screenshot({ path: join(directory, `20261024-outer-portal-${stage}.png`), fullPage: false });
  };
  const controls = async (pending: boolean) => {
    const path = page.getByRole("navigation", { name: "Where you are", exact: true });
    for (const control of [page.locator(".home-toolbar"), newData, page.locator(".home-search-trigger"), path,
      page.locator(".lens-data-summary")]) {
      assert.equal(await control.count(), 1, "The current Local owner has exactly one copy of its controls");
      assert.equal(await control.isVisible(), true, "The Local toolbar and summary remain visible across owner replacement");
    }
    assert.equal(await path.getByRole("button", { name: "All data", exact: true }).count(), 1);
    assert.equal(await page.locator(".home-entry .home-toolbar, .home-entry .lens-data-summary").count(), 0,
      "The actual frame must receive both surfaces through their Portal mounts");
    assert.equal(await newData.getAttribute("aria-busy"), pending ? "true" : "false");
    assert.equal(await newData.locator(".home-new-button__spinner").count(), pending ? 1 : 0);
    assert.equal(await newData.isDisabled(), false, "A pending Function creation can be canceled through New");
    assert.equal(await clipboard.isVisible(), true);
    assert.equal(await saved.isVisible(), true);
  };
  const chooseFunction = async (stage: string) => {
    await more.click().then(() => page.locator("button.picker-chip--function").click())
      .finally(() => capture(stage));
    await controls(true);
  };
  const cancelFunction = async (stage: string) => {
    await newData.click().finally(() => capture(stage));
    await controls(false);
    assert.equal(await more.isDisabled(), false, "Cancel restores the same creation choices");
    assert.equal(await page.getByRole("dialog", { name: "New data", exact: true }).count(), 0);
  };

  // A Local address reaches the actual InitialAddress owner before model
  // readiness. Clicking Local from All data would itself await that model.
  await Promise.all([initial.waitFor(), clipboard.waitFor(), saved.waitFor()]).finally(() => capture("initial-local"));
  await controls(false);
  const original = await initial.elementHandle();
  assert.ok(original);
  assert.equal(await page.evaluate(() => workspaceStartupFixture.state().modelReleased), false);
  await chooseFunction("initial-function-pending");
  assert.equal(await original.evaluate(element => element.isConnected), true);
  await cancelFunction("initial-function-canceled");
  await chooseFunction("initial-function-rechosen");

  await page.evaluate(() => workspaceStartupFixture.releaseSubject("anonymous"));
  await page.waitForFunction(() => !workspaceStartupFixture.state().authLoading)
    .finally(() => capture("anonymous-function-pending"));
  await controls(true);
  await page.evaluate(() => workspaceStartupFixture.releaseModel());
  await initial.waitFor({ state: "detached" }).finally(() => capture("permanent-function-pending"));
  await controls(true);
  assert.equal(await original.evaluate(element => element.isConnected), false, "The real LensPanel replaces the address-preview owner");
  assert.equal(await page.locator(".home-entry").count(), 1);
  const state = await page.evaluate(() => workspaceStartupFixture.state());
  assert.equal(state.preferences.lenses.find(lens => lens.id === state.preferences.activeLensId)?.source.$tag, "ThisTabSource");
  assert.ok(state.localPreparations > 0, "The existing Local preparation owner was requested and remains held");
  await cancelFunction("permanent-function-canceled");
  await chooseFunction("permanent-function-rechosen");
  assert.deepEqual(dataReads((await page.evaluate(() => workspaceStartupFixture.state())).requests), []);
}));

for (const resolved of ["anonymous", "user"] as const) for (const width of [1024, 390]) test(`Local stays open through the first ${resolved} cookie and saved lenses at ${width}px`, () => fixture(`startup-root-local-auth-${resolved}`, async page => {
  const clipboard = `[data-locus-preview="${LOCAL_BROWSER_SOURCE_ID}:clipboard"]`;
  await page.setViewportSize({ width, height: width === 1024 ? 768 : 844 });
  await page.locator('[data-locus-preview="local"]').waitFor();
  await page.locator('[data-locus-preview="local"] .home-item__body').click();
  await page.evaluate(() => workspaceStartupFixture.releaseModel());
  await page.locator(`${clipboard} .locus-previews`).waitFor();
  await page.getByText("Saved local text", { exact: true }).waitFor();
  const initialLocal = await page.evaluate(() => workspaceStartupFixture.state());
  assert.equal(initialLocal.localSourceId, LOCAL_BROWSER_SOURCE_ID);
  assert.equal(initialLocal.localRootId, LOCAL_BROWSER_SOURCE_ID);
  await page.locator(".workspace-surface").evaluate(element => { (element as HTMLElement).dataset.sessionContinuity = "local"; });
  await page.locator(".home-entry").evaluate(element => {
    const data = new DataTransfer(); data.setData("text/plain", "Pasted before sign-in");
    element.dispatchEvent(new ClipboardEvent("paste", { clipboardData: data, bubbles: true, cancelable: true }));
  });
  await page.waitForFunction(() => workspaceStartupFixture.state().localPasteAttempts.length === 1);
  await page.getByRole("button", { name: "1 notification", exact: true }).waitFor();
  const authPaints = await page.evaluate(async kind => {
    await Promise.all(document.getAnimations().filter(animation => animation.effect?.getTiming().iterations !== Infinity)
      .map(animation => animation.finished.catch(() => undefined)));
    workspaceStartupFixture.releaseSubject(kind);
    const frames: Array<{ card: boolean; startup: boolean; paste: boolean; bell: boolean }> = [];
    for (let frame = 0; frame < 16; frame++) {
      await new Promise<void>(resolve => requestAnimationFrame(() => resolve()));
      const card = document.querySelector<HTMLElement>('[data-locus-preview="local-saved"]');
      const bell = document.querySelector<HTMLElement>(".locus-notifications__bell");
      frames.push({ card: !!card?.getBoundingClientRect().height, bell: !!bell?.getBoundingClientRect().height,
        startup: !!document.querySelector(".workspace-startup__card"),
        paste: workspaceStartupFixture.state().notices.some(notice => notice.message === "Adding the data you pasted…") });
    }
    return frames;
  }, resolved);
  await page.waitForFunction(() => !workspaceStartupFixture.state().authLoading);
  if (resolved === "user") await page.waitForFunction(() => workspaceStartupFixture.state().requests.some(request => request.path === "/api/workspace-bootstrap"));
  await page.evaluate(() => new Promise<void>(resolve => requestAnimationFrame(() => requestAnimationFrame(() => resolve()))));
  const before = process.env["FENEL_SESSION_LIFETIME_BEFORE"] === "1";
  if (!before) {
    assert.ok(authPaints.every(frame => frame.card && frame.bell && frame.paste && !frame.startup), JSON.stringify(authPaints));
    assert.equal(await page.locator('[data-session-continuity="local"]').count(), 1);
    assert.equal(await page.locator(clipboard).isVisible(), true);
    assert.equal(await page.getByText("Saved local text", { exact: true }).isVisible(), true);
    assert.equal(await page.locator(".workspace-startup__card").count(), 0);
    const currentLocal = await page.evaluate(() => workspaceStartupFixture.state());
    assert.equal(currentLocal.localSourceId, LOCAL_BROWSER_SOURCE_ID);
    assert.equal(currentLocal.localRootId, LOCAL_BROWSER_SOURCE_ID);
    assert.equal(currentLocal.localSourceEpoch, currentLocal.epoch);
    assert.equal(currentLocal.notices.some(notice => notice.message === "Adding the data you pasted…"), true);
    await page.waitForFunction(() => {
      const state = workspaceStartupFixture.state();
      return state.localPasteAttempts.some(attempt => attempt.epoch === state.epoch && !attempt.aborted);
    });
  }
  const directory = process.env["FENEL_SESSION_LIFETIME_CAPTURE_DIR"];
  if (directory) {
    await mkdir(directory, { recursive: true });
    const bell = page.getByRole("button", { name: /notification/ });
    if (await bell.count()) {
      await bell.click();
      await page.waitForFunction(() => {
        const panel = document.querySelector<HTMLElement>(".locus-notifications__panel");
        return !!panel && Number(getComputedStyle(panel).opacity) >= 0.999;
      });
    }
    await page.screenshot({ path: join(directory, `session-local-${resolved}-${width}.png`) });
  }
  if (before) return;
  if (resolved === "user") {
    const painted = await page.evaluate(async () => {
      const frames: Array<{ card: boolean; startup: boolean; paste: boolean }> = [];
      workspaceStartupFixture.releaseBootstrap();
      for (let frame = 0; frame < 24; frame++) {
        await new Promise<void>(resolve => requestAnimationFrame(() => resolve()));
        frames.push({ card: !!document.querySelector('[data-locus-preview="local-saved"]'),
          startup: !!document.querySelector(".workspace-startup__card"),
          paste: workspaceStartupFixture.state().notices.some(notice => notice.message === "Adding the data you pasted…") });
      }
      return frames;
    });
    if (!before) assert.ok(painted.every(frame => frame.card && !frame.startup && frame.paste), JSON.stringify(painted));
    assert.equal(await page.locator('[data-session-continuity="local"]').count(), 1,
      "The prepared account must wait until the current Local receipt is published or canceled");
    const cancel = page.getByRole("button", { name: "Cancel", exact: true });
    if (!await cancel.isVisible()) await page.getByRole("button", { name: /notification/ }).click();
    await cancel.waitFor();
  }
  await page.locator(`${clipboard} .locus-previews`).waitFor();
  await page.getByText("Saved local text", { exact: true }).waitFor();
  assert.equal(await page.locator(".workspace-startup__card").count(), 0);
  assert.equal(await page.getByText("Saved B data", { exact: true }).count(), 0);
  if (!before) {
    await page.waitForFunction(() => workspaceStartupFixture.state().localPasteAttempts.some(attempt => !attempt.aborted));
    await page.evaluate(() => workspaceStartupFixture.releaseLocalPaste());
    await page.getByText("Pasted before sign-in", { exact: true }).waitFor();
    assert.equal((await page.evaluate(() => workspaceStartupFixture.state())).localPastePublications, 1);
    await page.waitForFunction(() => !workspaceStartupFixture.state().notices.some(notice => notice.message === "Adding the data you pasted…"));
    if (resolved === "user") await page.waitForFunction(() => !document.querySelector('[data-session-continuity="local"]'));
  }
}));

for (const resolved of ["anonymous", "user"] as const) for (const width of [1024, 390]) {
  test(`Local creation text survives the first ${resolved} cookie at ${width}px`, () => fixture(`startup-root-local-auth-${resolved}-draft`, async page => {
    await page.emulateMedia({ reducedMotion: "reduce" });
    await page.setViewportSize({ width, height: width === 1024 ? 768 : 844 });
    await page.locator('[data-locus-preview="local"] .home-item__body').click();
    await page.evaluate(() => workspaceStartupFixture.releaseModel());
    await page.getByText("Saved local text", { exact: true }).waitFor();
    await page.locator(".home-new-button").click();
    const dialog = page.getByRole("dialog", { name: "New data", exact: true });
    await dialog.getByRole("button", { name: "Text", exact: true }).click();
    await editPendingCreationText(page, "Keep this Local creation draft");
    const directory = process.env["FENEL_LOCAL_CREATION_CAPTURE_DIR"];
    if (directory) {
      await mkdir(directory, { recursive: true });
      await page.screenshot({ path: join(directory, `creation-${resolved}-${width}-before-cookie.png`) });
    }
    await page.evaluate(kind => workspaceStartupFixture.releaseSubject(kind), resolved);
    await page.waitForFunction(() => !workspaceStartupFixture.state().authLoading);
    await page.evaluate(() => new Promise<void>(resolve => requestAnimationFrame(() => requestAnimationFrame(() => resolve()))));
    const before = process.env["FENEL_LOCAL_CREATION_BEFORE"] === "1";
    if (!before) {
      assert.equal(await dialog.isVisible(), true);
      await assertPendingCreationText(page, "Keep this Local creation draft");
      assert.equal(await page.locator(".workspace-startup__card").count(), 0);
    }
    if (directory) await page.screenshot({ path: join(directory, `creation-${resolved}-${width}-after-cookie.png`) });
    if (before) return;
    if (resolved === "user") {
      await page.waitForFunction(() => workspaceStartupFixture.state().requests.some(request => request.path === "/api/workspace-bootstrap"));
      await page.evaluate(() => workspaceStartupFixture.releaseBootstrap());
      await page.evaluate(async () => { for (let frame = 0; frame < 12; frame++) await new Promise<void>(resolve => requestAnimationFrame(() => resolve())); });
      await assertPendingCreationText(page, "Keep this Local creation draft");
    }
    assert.equal(await dialog.getByRole("button", { name: "Cancel", exact: true }).count(), 0);
    await dialog.getByRole("button", { name: "Close new data", exact: true }).click();
    await dialog.waitFor({ state: "hidden" });
    assert.equal(await page.locator(".workspace-startup__card").count(), 0);
  }));
}

for (const refusal of ["readonly", "changed-root"]) test(`Local creation keeps text when the fresh reader reports ${refusal}`, () => fixture(`startup-root-local-auth-anonymous-draft-${refusal}`, async page => {
  await page.emulateMedia({ reducedMotion: "reduce" });
  await page.locator('[data-locus-preview="local"] .home-item__body').click();
  await page.evaluate(() => workspaceStartupFixture.releaseModel());
  await page.getByText("Saved local text", { exact: true }).waitFor();
  await page.locator(".home-new-button").click();
  const dialog = page.getByRole("dialog", { name: "New data", exact: true });
  await dialog.getByRole("button", { name: "Text", exact: true }).click();
  await editPendingCreationText(page, "Keep the refused draft");
  await page.evaluate(() => workspaceStartupFixture.releaseSubject("anonymous"));
  await page.waitForFunction(() => !workspaceStartupFixture.state().authLoading);
  await dialog.getByRole("button", { name: "Error. This scope cannot create data right now. Your draft is kept here. Open details.", exact: true }).waitFor();
  await assertPendingCreationText(page, "Keep the refused draft");
  assert.equal(await dialog.getByRole("button", { name: "Create", exact: true }).isDisabled(), true);
  assert.equal((await page.evaluate(() => workspaceStartupFixture.state())).requests.some(request => request.method !== "GET" && request.path !== "/api/reader-metadata"), false);
  const directory = process.env["FENEL_LOCAL_CREATION_REFUSAL_CAPTURE_DIR"];
  if (directory) {
    await mkdir(directory, { recursive: true });
    for (const width of [1024, 390]) {
      await page.setViewportSize({ width, height: width === 1024 ? 768 : 844 });
      await page.screenshot({ path: join(directory, `added-${refusal}-${width}-draft.png`) });
      await dialog.getByRole("button", { name: "Error. This scope cannot create data right now. Your draft is kept here. Open details.", exact: true }).click();
      await page.getByRole("heading", { name: "This scope cannot create data right now. Your draft is kept here.", exact: true }).waitFor();
      await page.locator(".locus-load-failure__dialog").evaluate(async element => { await Promise.allSettled(element.getAnimations().map(animation => animation.finished)); });
      await page.screenshot({ path: join(directory, `added-${refusal}-${width}-details.png`) });
      await page.getByRole("button", { name: "Close error details", exact: true }).click();
      await page.locator(".locus-load-failure__dialog").waitFor({ state: "hidden" });
    }
  }
}));

test("the logo respects an unfinished Quick Value before preparing or changing lens preferences", () => fixture("logo-quick", async page => {
  await page.locator('[data-locus-preview="root-only"]').waitFor();
  await page.locator(".home-canvas").click({ button: "right", position: { x: 30, y: 120 } });
  await page.getByRole("menu", { name: "Data actions", exact: true }).waitFor();
  await page.locator('[data-locus-menu-item="new"] .locus-context-menu-chevron').click();
  await page.getByRole("menuitem", { name: "Text", exact: true }).click({ position: { x: 16, y: 16 } });
  await page.locator(".locus-quick-value__input").fill("Keep this draft");
  const before = await page.evaluate(() => workspaceStartupFixture.state());
  await captureLogo(page, "quick-value-desktop-before");
  await clickLogo(page);
  await page.waitForFunction(() => workspaceStartupFixture.state().homeResults.length === 1);
  const after = await page.evaluate(() => workspaceStartupFixture.state());
  assert.deepEqual(after.homeResults, [false]);
  assert.deepEqual(after.preferences, before.preferences);
  assert.deepEqual(after.edits, []);
  assert.equal(await page.locator(".locus-quick-value__input").inputValue(), "Keep this draft");
  assert.deepEqual(after.subject, before.subject);
  await captureLogo(page, "quick-value-desktop-after");
}));

test("the logo respects a captured paste that has not reached the editor", () => fixture("logo-paste", async page => {
  await page.getByText("Saved B data", { exact: true }).waitFor();
  await page.locator(".home-entry").evaluate(element => {
    const data = new DataTransfer(); data.setData("text/plain", "Preserve this paste");
    element.dispatchEvent(new ClipboardEvent("paste", { clipboardData: data, bubbles: true, cancelable: true }));
  });
  await page.waitForFunction(() => workspaceStartupFixture.state().dynamicModules.some(name => name === "./workspace-model" || name === "./workspace-model-loader"));
  const before = await page.evaluate(() => workspaceStartupFixture.state());
  await clickLogo(page);
  await page.waitForFunction(() => workspaceStartupFixture.state().homeResults.length === 1);
  const after = await page.evaluate(() => workspaceStartupFixture.state());
  assert.deepEqual(after.homeResults, [false]);
  assert.deepEqual(after.preferences, before.preferences);
  assert.deepEqual(after.edits, []);
}));

test("the logo rechecks another pane's new draft after its awaited model finishes", () => fixture("logo-race", async page => {
  const other = page.locator('[data-workspace-lens="other-saved"]');
  await other.getByText("Account C data", { exact: true }).waitFor();
  await clickLogo(page);
  assert.equal((await page.evaluate(() => workspaceStartupFixture.state())).modelReleased, false);
  assert.equal(await page.locator(".workspace-surface").getAttribute("inert"), "");
  // Inert blocks new user gestures while Home waits. Invoke the existing
  // event as an already-delivered callback to exercise the final async guard.
  await other.locator(".home-canvas").evaluate(element => {
    const bounds = element.getBoundingClientRect();
    element.dispatchEvent(new MouseEvent("contextmenu", { bubbles: true, cancelable: true,
      clientX: bounds.left + 30, clientY: bounds.top + 30 }));
  });
  await page.getByRole("menu", { name: "Data actions", exact: true }).waitFor();
  await page.locator('[data-locus-menu-item="new"] .locus-context-menu-chevron').click();
  await page.getByRole("menuitem", { name: "Text", exact: true }).click({ position: { x: 16, y: 16 } });
  await page.locator(".locus-quick-value__input").evaluate(element => {
    (element as HTMLInputElement).value = "Started while home waited";
    element.dispatchEvent(new InputEvent("input", { bubbles: true, inputType: "insertText", data: "Started while home waited" }));
  });
  await page.evaluate(() => workspaceStartupFixture.releaseModel());
  await page.waitForFunction(() => workspaceStartupFixture.state().homeResults.length === 1);
  const after = await page.evaluate(() => workspaceStartupFixture.state());
  assert.deepEqual(after.homeResults, [false]);
  assert.equal(await page.locator(".locus-quick-value__input").inputValue(), "Started while home waited");
  assert.equal(after.preferences.lenses.length, 2);
  assert.equal(after.preferences.lenses.find(lens => lens.id === "saved-public")!.placement?.$tag, "FreePlacement");
  assert.deepEqual(after.preferences.display, { $tag: "TiledLenses" });
  assert.equal(after.edits.some(command => ["AddWorkspaceLens", "SetWorkspaceDisplay"].includes((command as { $tag: string }).$tag)), false);
}));

test("the logo refuses paused pending lens settings until they are saved or discarded", () => fixture("logo-paused", async page => {
  await page.getByText("Saved B data", { exact: true }).waitFor();
  await page.evaluate(() => workspaceStartupFixture.releaseModel());
  await page.waitForFunction(() => workspaceStartupFixture.state().modelCalls.includes("workspaceBootstrapReady"));
  await page.getByRole("button", { name: "Automatic synchronization", exact: true }).click();
  await page.locator('[data-workspace-lens="saved-lens-b"]').getByRole("button", { name: "Float lens", exact: true }).click();
  await page.getByRole("button", { name: "Save pending changes", exact: true }).waitFor();
  const before = await page.evaluate(() => workspaceStartupFixture.state());
  await clickLogo(page);
  await page.waitForFunction(() => workspaceStartupFixture.state().homeResults.length === 1);
  const after = await page.evaluate(() => workspaceStartupFixture.state());
  assert.deepEqual(after.homeResults, [false]);
  assert.deepEqual(after.preferences, before.preferences);
  assert.deepEqual(after.edits, before.edits);
  assert.equal(after.requests.some(request => request.method !== "GET" && request.path !== "/api/reader-metadata"), false);
}));

test("the public home-address enters All data instead of restoring an unrelated account lens", () => fixture("home-address", async page => {
  await page.getByText("Saved B data", { exact: true }).waitFor();
  await page.waitForFunction(() => workspaceStartupFixture.state().dynamicModules.some(name => name === "./workspace-model" || name === "./workspace-model-loader"));
  await page.evaluate(() => workspaceStartupFixture.releaseModel());
  const state = await returnedToAllDataRoot(page);
  assert.equal(state.homeAttempts, 0, "The address performs the same registered home intent without a synthetic logo click");
  assert.equal(state.preferences.lenses.filter(lens => lens.source.$tag === "AllDataSource").length, 1);
  assert.equal(state.preferences.lenses.filter(lens => lens.source.$tag === "AccountSource").length, 2);
}));

async function publicHome(page: Page) {
  await page.getByRole("button", { name: "Standard library", exact: true }).waitFor();
  await page.getByRole("button", { name: "Demo", exact: true }).waitFor();
  assert.equal(await page.locator(".home-new-button").isVisible(), true);
}

test("Home paints checked public data while the sign-in read is held", () => fixture("startup-anonymous", async page => {
  await publicHome(page);
  const pending = await page.evaluate(() => workspaceStartupFixture.state());
  assert.equal(pending.subject, null);
  assert.equal(pending.authLoading, true);
  assert.deepEqual(pending.requests.map(request => request.path), ["/api/auth/me"]);
  assert.equal(pending.dynamicModules.includes("./generated/public-bootstrap.json"), true);
  assert.equal(pending.modelReleased, false);
  await page.evaluate(() => workspaceStartupFixture.releaseSubject("anonymous"));
  await page.waitForFunction(() => workspaceStartupFixture.state().subject?.$tag === "Anonymous");
  await publicHome(page);
  assert.deepEqual(dataReads((await page.evaluate(() => workspaceStartupFixture.state())).requests), []);
}));

test("Home keeps public data through a failed sign-in check and its retry", () => fixture("startup-failed", async page => {
  await publicHome(page);
  await page.evaluate(() => workspaceStartupFixture.releaseSubject("failed"));
  await page.waitForFunction(() => !!workspaceStartupFixture.state().authError);
  await publicHome(page);
  const failed = await page.evaluate(() => workspaceStartupFixture.state());
  assert.equal(failed.subject, null);
  assert.equal(failed.authLoading, false);
  assert.equal(failed.authError, "Could not check your sign-in. Please retry.");
  await page.evaluate(() => workspaceStartupFixture.retrySubject());
  await page.getByText("Saved B data", { exact: true }).waitFor();
  assert.equal(await page.getByRole("button", { name: "Standard library", exact: true }).count(), 0);
  assert.deepEqual(dataReads((await page.evaluate(() => workspaceStartupFixture.state())).requests).map(request => request.account), ["account-b"]);
}));

test("resolved authentication replaces the public reader before restoring private data", () => fixture("startup-user", async page => {
  await publicHome(page);
  await page.locator(".home-canvas").evaluate(element => { (element as HTMLElement).dataset.fixtureIdentity = "pending-public"; });
  await page.evaluate(() => workspaceStartupFixture.releaseSubject("user"));
  await page.getByText("Saved B data", { exact: true }).waitFor();
  assert.equal(await page.locator('[data-fixture-identity="pending-public"]').count(), 0);
  assert.equal(await page.getByRole("button", { name: "Standard library", exact: true }).count(), 0);
  const resolved = await page.evaluate(() => workspaceStartupFixture.state());
  assert.equal(resolved.subject?.$tag, "User");
  assert.deepEqual(dataReads(resolved.requests).map(request => request.account), ["account-b"]);
  assert.equal(resolved.requests.some(request => request.method === "PUT"), false);
}));

test("a pending recheck with the previous User cannot read private data", () => fixture("startup-recheck", async page => {
  await publicHome(page);
  const pending = await page.evaluate(() => workspaceStartupFixture.state());
  assert.equal(pending.subject?.$tag, "User");
  assert.equal(pending.authLoading, true);
  assert.equal(pending.requests.some(request => request.path !== "/api/auth/me"), false);
  await page.evaluate(() => workspaceStartupFixture.releaseSubject("anonymous"));
  await page.waitForFunction(() => workspaceStartupFixture.state().subject?.$tag === "Anonymous");
  await publicHome(page);
  assert.deepEqual(dataReads((await page.evaluate(() => workspaceStartupFixture.state())).requests), []);
}));

test("a mounted private lens survives a same-subject sign-in recheck", () => fixture("startup-mounted-recheck", async page => {
  await page.evaluate(() => workspaceStartupFixture.releaseSubject("user"));
  await page.getByText("Saved B data", { exact: true }).waitFor();
  await page.locator('[data-workspace-lens="saved-lens-b"]').evaluate(element => { (element as HTMLElement).dataset.fixtureIdentity = "mounted-private"; });
  const before = await page.evaluate(() => workspaceStartupFixture.state());
  await page.evaluate(() => workspaceStartupFixture.beginSubjectRecheck());
  await page.waitForFunction(() => workspaceStartupFixture.state().authLoading);
  await captureLoadingRegression(page, "sign-in-recheck");
  assert.equal(await page.locator('[data-fixture-identity="mounted-private"]').isVisible(), true,
    "A background sign-in recheck preserves the mounted lens");
  assert.equal(await page.getByText("Saved B data", { exact: true }).isVisible(), true);
  assert.equal(await page.getByRole("list", { name: "Loading steps", exact: true }).count(), 0);
  assert.equal(await page.getByRole("button", { name: "Standard library", exact: true }).count(), 0);
  await page.evaluate(() => workspaceStartupFixture.releaseSubject("user"));
  await page.waitForFunction(() => !workspaceStartupFixture.state().authLoading);
  const after = await page.evaluate(() => workspaceStartupFixture.state());
  assert.equal(after.epoch, before.epoch);
  assert.equal(await page.locator('[data-fixture-identity="mounted-private"]').isVisible(), true);
  assert.equal(dataReads(after.requests).length, dataReads(before.requests).length,
    "A same-subject refresh reuses the admitted reader instead of loading it again");
}));

test("a mounted private lens retires when a recheck resolves anonymous", () => fixture("startup-mounted-logout", async page => {
  await page.evaluate(() => workspaceStartupFixture.releaseSubject("user"));
  await page.getByText("Saved B data", { exact: true }).waitFor();
  const before = await page.evaluate(() => workspaceStartupFixture.state());
  await page.evaluate(() => workspaceStartupFixture.beginSubjectRecheck());
  await page.waitForFunction(() => workspaceStartupFixture.state().authLoading);
  await page.evaluate(() => {
    const startup: string[] = [];
    new MutationObserver(records => {
      for (const record of records) for (const node of record.addedNodes) {
        if (node instanceof Element && (node.matches(".workspace-startup,.fenel-loading") || node.querySelector(".workspace-startup,.fenel-loading"))) startup.push(node.outerHTML);
      }
    }).observe(document.body, { childList: true, subtree: true });
    Object.assign(globalThis, { sessionStartupEvents: startup });
  });
  await page.evaluate(() => workspaceStartupFixture.releaseSubject("anonymous"));
  await page.waitForFunction(() => workspaceStartupFixture.state().subject?.$tag === "Anonymous");
  await page.waitForFunction(() => !document.body.textContent?.includes("Saved B data"));
  const after = await page.evaluate(() => workspaceStartupFixture.state());
  assert.ok(after.epoch > before.epoch);
  assert.equal(await page.getByText("Saved B data", { exact: true }).count(), 0);
  assert.equal(dataReads(after.requests).length, dataReads(before.requests).length);
  assert.deepEqual(await page.evaluate(() => (globalThis as unknown as { sessionStartupEvents: string[] }).sessionStartupEvents), []);
}));

test("account replacement keeps an empty lens frame while retiring the previous private data", () => fixture("startup-mounted-switch", async page => {
  await page.evaluate(() => workspaceStartupFixture.releaseSubject("user"));
  await page.getByText("Saved B data", { exact: true }).waitFor();
  await page.evaluate(() => {
    const startup: string[] = [];
    new MutationObserver(records => {
      for (const record of records) for (const node of record.addedNodes) {
        if (node instanceof Element && (node.matches(".workspace-startup,.fenel-loading") || node.querySelector(".workspace-startup,.fenel-loading"))) startup.push(node.outerHTML);
      }
    }).observe(document.body, { childList: true, subtree: true });
    Object.assign(globalThis, { sessionStartupEvents: startup });
  });
  await page.evaluate(() => workspaceStartupFixture.switchAccount());
  assert.equal(await page.getByText("Saved B data", { exact: true }).count(), 0);
  await page.getByText("Account C data", { exact: true }).waitFor();
  assert.deepEqual(await page.evaluate(() => (globalThis as unknown as { sessionStartupEvents: string[] }).sessionStartupEvents), []);
  assert.equal(await page.locator(".workspace-pane").count(), 1);
}));

test("checked public data remains while private preferences prepare then hands off without startup", () => fixture("startup-private-preparation", async page => {
  await publicHome(page);
  await page.evaluate(() => workspaceStartupFixture.releaseSubject("user"));
  await page.waitForFunction(() => workspaceStartupFixture.state().heldPreferences === 1);
  await captureLoadingRegression(page, "private-acquisition");
  await publicHome(page);
  assert.equal(await page.getByRole("list", { name: "Loading steps", exact: true }).count(), 0);
  assert.deepEqual(dataReads((await page.evaluate(() => workspaceStartupFixture.state())).requests), [],
    "Private preparation obtains preferences, while ordinary account data waits for the admitted lens");
  await page.evaluate(() => {
    const events: string[] = [];
    new MutationObserver(records => {
      for (const record of records) for (const node of record.addedNodes) {
        if (node instanceof Element && (node.matches('.workspace-startup,.workspace-load-overlay')
          || node.querySelector('.workspace-startup,.workspace-load-overlay'))) events.push(node.outerHTML);
      }
    }).observe(document.body, { subtree: true, childList: true });
    Object.assign(globalThis, { fixtureStartupEvents: events });
    workspaceStartupFixture.releasePreferences();
  });
  await page.getByText("Saved B data", { exact: true }).waitFor();
  assert.equal(await page.getByRole("button", { name: "Standard library", exact: true }).count(), 0);
  assert.deepEqual(await page.evaluate(() => (globalThis as unknown as { fixtureStartupEvents: string[] }).fixtureStartupEvents), []);
}));

for (const resolved of ["anonymous", "user"] as const) test(`the first ${resolved} cookie may resolve before the public snapshot`, () => fixture(`startup-snapshot-race-${resolved}`, async page => {
  await page.waitForFunction(() => workspaceStartupFixture.state().dynamicModules.includes("./generated/public-bootstrap.json"));
  await page.evaluate(kind => workspaceStartupFixture.releaseSubject(kind), resolved);
  await page.waitForFunction(() => !workspaceStartupFixture.state().authLoading);
  await page.evaluate(() => workspaceStartupFixture.releasePublicSnapshot());
  await publicHome(page);
  assert.equal(await page.locator(".locus-load-failure").count(), 0);
  assert.equal((await page.evaluate(() => workspaceStartupFixture.state())).notices.some(notice => notice.tone === "error"), false);
  if (resolved === "user") {
    await page.evaluate(() => workspaceStartupFixture.releaseBootstrap());
    await page.getByText("Saved B data", { exact: true }).waitFor();
  }
}));

test("a saved-lens startup failure retains the established data and retries through its notice", () => fixture("startup-private-failure", async page => {
  await publicHome(page);
  await page.locator(".workspace-surface").evaluate(element => { (element as HTMLElement).dataset.sessionContinuity = "startup-failure"; });
  await page.evaluate(() => workspaceStartupFixture.releaseSubject("user"));
  await page.waitForFunction(() => workspaceStartupFixture.state().notices.some(notice => notice.message === "Could not load your saved lenses."));
  assert.equal(await page.locator('[data-session-continuity="startup-failure"]').count(), 1);
  await publicHome(page);
  assert.equal(await page.locator(".workspace-startup__card").count(), 0);
  await page.getByRole("button", { name: /notification/ }).click();
  await page.getByRole("button", { name: "Retry", exact: true }).click();
  await page.getByText("Saved B data", { exact: true }).waitFor();
}));

for (const width of [1024, 390]) test(`the first account check retains the established lens and Local operation notice at ${width}px`, () => fixture("startup-private-preparation", async page => {
  await page.setViewportSize({ width, height: width === 1024 ? 768 : 844 });
  await publicHome(page);
  await page.locator(".workspace-surface").evaluate(element => { (element as HTMLElement).dataset.sessionContinuity = "initial-public"; });
  await page.evaluate(() => workspaceStartupFixture.retainLocalNotice());
  await page.getByRole("button", { name: /notification/ }).waitFor();
  await page.evaluate(() => workspaceStartupFixture.releaseSubject("user"));
  await page.waitForFunction(() => workspaceStartupFixture.state().heldPreferences === 1);
  const before = process.env["FENEL_SESSION_LIFETIME_BEFORE"] === "1";
  if (!before) {
    assert.equal(await page.locator('[data-session-continuity="initial-public"]').count(), 1,
      "Resolving the first account must not replace a lens that was already showing public or Local data");
    assert.equal((await page.evaluate(() => workspaceStartupFixture.state())).notices.some(notice => notice.message === "Adding the data you pasted…"), true,
      "A Local operation must remain visible when the first account resolves");
    assert.equal(await page.locator(".workspace-startup__card").count(), 0);
  }
  const directory = process.env["FENEL_SESSION_LIFETIME_CAPTURE_DIR"];
  if (directory) {
    await mkdir(directory, { recursive: true });
    const bell = page.getByRole("button", { name: /notification/ });
    if (await bell.count()) await bell.click();
    await page.screenshot({ path: join(directory, `session-lifetime-${width}.png`) });
  }
  await page.evaluate(() => workspaceStartupFixture.releasePreferences());
  await page.getByText("Saved B data", { exact: true }).waitFor();
  await page.evaluate(() => workspaceStartupFixture.beginSubjectRecheck());
  await page.waitForFunction(() => workspaceStartupFixture.state().authLoading);
  await page.evaluate(() => workspaceStartupFixture.releaseSubject("anonymous"));
  await page.waitForFunction(() => workspaceStartupFixture.state().subject?.$tag === "Anonymous");
  await publicHome(page);
  assert.equal((await page.evaluate(() => workspaceStartupFixture.state())).notices.some(notice => notice.message === "Adding the data you pasted…"), false,
    "Once an account surface has existed, its session reports retire on logout");
}));

test("disposing pending private preferences prevents their later reader from mounting", () => fixture("startup-private-preparation-disposed", async page => {
  await page.evaluate(() => workspaceStartupFixture.releaseSubject("user"));
  await page.waitForFunction(() => workspaceStartupFixture.state().heldPreferences === 1);
  await page.evaluate(() => { workspaceStartupFixture.dispose(); workspaceStartupFixture.releasePreferences(); });
  await page.waitForFunction(() => workspaceStartupFixture.state().heldPreferences === 0);
  assert.deepEqual(dataReads((await page.evaluate(() => workspaceStartupFixture.state())).requests), []);
  assert.equal(await page.locator(".workspace-surface").count(), 0);
  assert.equal(await page.getByText("Saved B data", { exact: true }).count(), 0);
}));

test("the initial data card remains while bootstrap has no lens to display", () => fixture("slow-bootstrap", async page => {
  await page.getByRole("list", { name: "Loading steps", exact: true }).waitFor();
  assert.equal(await page.locator(".workspace-surface").count(), 0);
  assert.equal(await page.getByText("Saved B data", { exact: true }).count(), 0);
  await captureLoadingRegression(page, "initial-bootstrap");
  await page.evaluate(() => workspaceStartupFixture.releaseBootstrap());
  await page.getByText("Saved B data", { exact: true }).waitFor();
  await page.waitForFunction(() => document.querySelectorAll(".workspace-load-overlay").length === 0);
}));

test("new asynchronous descendants never replace an already settled lens with startup", () => fixture("startup-late-child", async page => {
  await page.evaluate(() => workspaceStartupFixture.releaseSubject("user"));
  await page.getByText("Saved B data", { exact: true }).waitFor();
  await page.waitForFunction(() => document.querySelectorAll(".workspace-load-overlay").length === 0);
  const stepsAdded = await page.evaluate(() => {
    const events: string[] = [];
    new MutationObserver(records => {
      for (const record of records) for (const node of record.addedNodes) {
        if (node instanceof Element && (node.matches('.workspace-startup,.workspace-load-overlay')
          || node.querySelector('.workspace-startup,.workspace-load-overlay'))) events.push(node.outerHTML);
      }
    }).observe(document.body, { subtree: true, childList: true });
    Object.assign(globalThis, { fixtureStartupEvents: events });
    workspaceStartupFixture.openLateChild();
    return events;
  });
  assert.deepEqual(stepsAdded, []);
  // The new local boundary reports through the real LensPending component.
  // A pending expression must not make the whole settled lens start over.
  await page.waitForFunction(() => workspaceStartupFixture.state().lateChildReads > 0);
  await captureLoadingRegression(page, "late-descendant");
  assert.equal(await page.getByText("Saved B data", { exact: true }).isVisible(), true);
  assert.equal(await page.getByRole("list", { name: "Loading steps", exact: true }).count(), 0);
  assert.deepEqual(await page.evaluate(() => (globalThis as unknown as { fixtureStartupEvents: string[] }).fixtureStartupEvents), []);
  await page.evaluate(() => workspaceStartupFixture.releaseLateChild());
  await page.getByText("Descendant ready", { exact: true }).waitFor();
  assert.equal(await page.getByText("Saved B data", { exact: true }).isVisible(), true);
}));

test("disposal while Home checks sign-in prevents a late account bootstrap", () => fixture("startup-disposed", async page => {
  await publicHome(page);
  await page.evaluate(() => { workspaceStartupFixture.dispose(); workspaceStartupFixture.releaseSubject("user"); });
  await page.waitForFunction(() => workspaceStartupFixture.state().subject?.$tag === "User");
  assert.equal(await page.locator(".workspace-surface").count(), 0);
  assert.equal((await page.evaluate(() => workspaceStartupFixture.state())).requests.some(request => request.path !== "/api/auth/me"), false);
}));

test("New function URL survives delayed bootstrap and targets the signed-in account's root", () => fixture("new-function-slow", async page => {
  await page.waitForFunction(() => !workspaceStartupFixture.state().bootstrapReleased);
  assert.deepEqual(dataReads((await page.evaluate(() => workspaceStartupFixture.state())).requests), []);
  await page.evaluate(() => workspaceStartupFixture.releaseBootstrap());
  await page.getByText("Saved B data", { exact: true }).waitFor();
  assert.equal(await page.locator('.home-new-button[aria-busy="true"]').count(), 0);
  await page.evaluate(() => workspaceStartupFixture.releaseModel());
  const own = page.locator('[data-workspace-lens="own-account-root"]');
  await own.locator('.home-new-button[aria-busy="true"]').waitFor();
  const state = await page.evaluate(() => workspaceStartupFixture.state());
  assert.equal(state.preferences.activeLensId, "own-account-root");
  assert.deepEqual(dataReads(state.requests).map(request => request.account), ["account-b", "account-a"]);
  assert.equal(state.requests.some(request => request.method === "POST"), false);
  assert.equal(await page.locator('[data-workspace-lens="saved-lens-b"] .home-new-button[aria-busy="true"]').count(), 0);
}));

test("account replacement cancels a queued New function intent before model preparation completes", () => fixture("new-function", async page => {
  await page.getByText("Saved B data", { exact: true }).waitFor();
  await page.evaluate(() => workspaceStartupFixture.switchAccount());
  await page.getByText("Account C data", { exact: true }).waitFor();
  await page.evaluate(() => workspaceStartupFixture.releaseModel());
  await page.waitForFunction(() => workspaceStartupFixture.state().modelCalls.includes("workspaceBootstrapReady"));
  const state = await page.evaluate(() => workspaceStartupFixture.state());
  assert.equal(await page.locator('.home-new-button[aria-busy="true"]').count(), 0);
  assert.deepEqual(state.edits, []);
  assert.equal(dataReads(state.requests).some(request => request.account === "account-a"), false);
}));

test("floating controls stay above docked data, fit one row and retain their lens when docking", () => fixture("lens-controls", async page => {
  await page.emulateMedia({ reducedMotion: "reduce" });
  const floating = page.locator('[data-workspace-lens="saved-lens-b"]');
  const first = page.locator('[data-workspace-lens="lens-first"]');
  await floating.getByText("Saved B data", { exact: true }).waitFor();
  const panels = floating.locator('.data-inspection-dialog__presentations');
  const data = panels.locator('button[aria-label="Data"]');
  const expression = panels.locator('button[aria-label="Expression"]');
  const code = panels.locator('button[aria-label="Code"]');
  const choosePanel = async (name: string) => {
    await floating.getByRole("button", { name: "Suggestions", exact: true }).click();
    await page.getByRole("menu", { name: "Suggestions", exact: true }).getByRole("menuitem", { name, exact: true }).click();
  };
  assert.equal(await data.getAttribute("aria-pressed"), "true");
  assert.equal(await expression.getAttribute("aria-pressed"), "false");
  assert.equal(await code.getAttribute("aria-pressed"), "false");
  await choosePanel("Expression");
  assert.equal(await data.getAttribute("aria-pressed"), "true");
  assert.equal(await expression.getAttribute("aria-pressed"), "true");
  await choosePanel("Code");
  assert.equal(await code.getAttribute("aria-pressed"), "true");
  assert.equal(await first.locator('.data-inspection-dialog__presentations button[aria-label="Expression"]').getAttribute("aria-pressed"), "false",
    "Each lens owns its visible panels");
  assert.equal(await first.locator('.data-inspection-dialog__presentations button[aria-label="Code"]').getAttribute("aria-pressed"), "false");
  await choosePanel("Data");
  assert.equal(await data.getAttribute("aria-pressed"), "false");
  assert.equal(await expression.getAttribute("aria-pressed"), "true");
  await choosePanel("Expression");
  assert.equal(await data.getAttribute("aria-pressed"), "false");
  assert.equal(await expression.getAttribute("aria-pressed"), "false");
  assert.equal(await code.getAttribute("aria-pressed"), "true");
  await choosePanel("Code");
  assert.equal(await data.getAttribute("aria-pressed"), "true", "At least one panel remains visible");
  assert.equal(await expression.getAttribute("aria-pressed"), "false");
  assert.equal(await code.getAttribute("aria-pressed"), "false");
  await choosePanel("Code");
  assert.equal(await data.getAttribute("aria-pressed"), "true");
  assert.equal(await expression.getAttribute("aria-pressed"), "false");
  assert.equal(await code.getAttribute("aria-pressed"), "true");
  await choosePanel("Expression");
  await choosePanel("Code");
  await choosePanel("Data");
  assert.equal(await data.getAttribute("aria-pressed"), "false");
  assert.equal(await expression.getAttribute("aria-pressed"), "true");
  assert.equal(await code.getAttribute("aria-pressed"), "false");
  await choosePanel("Data");
  await choosePanel("Code");
  assert.equal(await floating.getByRole("button", { name: "Close lens", exact: true }).count(), 1);
  const headerGeometry = () => floating.locator(".workspace-pane__header").evaluate(header => {
    const group = header.querySelector('.data-inspection-dialog__controls')!;
    const close = header.querySelector('.workspace-pane__close')!;
    const groupBox = group.getBoundingClientRect();
    const closeBox = close.getBoundingClientRect();
    const headerBox = header.getBoundingClientRect();
    const buttons = [...header.querySelectorAll("button")];
    return {
      order: buttons.at(-1) === close && !!(group.compareDocumentPosition(close) & Node.DOCUMENT_POSITION_FOLLOWING),
      fits: groupBox.left >= headerBox.left && closeBox.right <= headerBox.right
        && closeBox.left >= groupBox.right && groupBox.bottom <= headerBox.bottom && closeBox.bottom <= headerBox.bottom,
      commonBorder: getComputedStyle(group).borderTopWidth,
      childBorders: [...group.querySelectorAll(".data-inspection-dialog__presentations button")].map(button => getComputedStyle(button).borderTopWidth),
      childBorderColors: [...group.querySelectorAll(".data-inspection-dialog__presentations button")].map(button => getComputedStyle(button).borderTopColor),
      activeColors: [...group.querySelectorAll('button[aria-pressed="true"]')].map(button => getComputedStyle(button).backgroundColor),
    };
  });
  const initialHeader = await headerGeometry();
  assert.equal(initialHeader.order, true, "The close button follows the shared controls in keyboard and visual order");
  assert.equal(initialHeader.fits, true);
  assert.equal(initialHeader.commonBorder, "0px", "Shortcuts use the shared neutral controls without an enclosing tab border");
  assert.ok(initialHeader.childBorders.every((width, index) => width === "0px" || initialHeader.childBorderColors[index] === "rgba(0, 0, 0, 0)"),
    "Presentation choices have no visible tab outline");
  assert.ok(initialHeader.activeColors.every(color => color !== "rgba(0, 0, 0, 0)"));
  await floating.evaluate(element => { (element as HTMLElement).style.width = "320px"; });
  assert.equal((await headerGeometry()).fits, true, "Shortcuts and the final close fit a 320px floating lens");
  await floating.evaluate(element => { (element as HTMLElement).style.width = "390px"; });
  assert.equal((await page.evaluate(() => workspaceStartupFixture.state())).dynamicModules.includes("./expression-runner/authoring-session"), false,
    "Choosing presentation slots does not request the complete editor runtime");
  await page.evaluate(() => workspaceStartupFixture.releaseModel());
  await page.waitForFunction(() => workspaceStartupFixture.state().modelCalls.includes("workspaceBootstrapReady"));
  await floating.locator(".home-canvas").evaluate(element => { (element as HTMLElement).dataset.fixtureIdentity = "same-lens"; });
  const geometry = await floating.evaluate(element => {
    const header = element.querySelector(".workspace-pane__header")!;
    const controls = [...header.querySelectorAll(".workspace-pane__fold, .workspace-pane__float")];
    const toolbar = header.querySelector(".home-toolbar")!;
    const headerBox = header.getBoundingClientRect();
    return { headerHeight: headerBox.height, toolbarWrap: getComputedStyle(toolbar).flexWrap,
      verticalInset: [...header.querySelectorAll("button")].every(control => {
        const box = control.getBoundingClientRect();
        if (!box.width || !box.height) return true;
        return box.top >= headerBox.top + 3 && box.bottom <= headerBox.bottom - 3;
      }),
      controlsVisible: controls.every(control => {
        const box = control.getBoundingClientRect();
        return element.contains(document.elementFromPoint(box.x + box.width / 2, box.y + box.height / 2));
      }) };
  });
  assert.equal(geometry.toolbarWrap, "nowrap");
  assert.ok(geometry.headerHeight <= 38, "The controls above the expanded summary stay on one row");
  assert.equal(geometry.verticalInset, true, "Every header control clears the lens border above and below");
  assert.equal(geometry.controlsVisible, true, "The docked breadcrumb cannot intercept a floating lens's controls");
  const dock = floating.getByRole("button", { name: "Dock lens", exact: true });
  assert.equal((await dock.innerText()).trim(), "", "Placement is an icon control");
  assert.equal(await dock.isEnabled(), true, "Placement is available after its existing model is ready");
  assert.equal(await floating.getAttribute("data-chrome-mode"), "expanded");
  assert.equal(await floating.getByRole("button", { name: "Compact lens header", exact: true }).locator("svg").count(), 1,
    "The compact-header control renders its existing chevron icon");
  await floating.locator(".lens-data-summary").waitFor();
  await captureLoadingRegression(page, "lens-controls-expanded");
  const beforeFold = await page.evaluate(() => workspaceStartupFixture.state());
  await floating.getByRole("button", { name: "Compact lens header", exact: true }).click();
  assert.equal(await floating.getAttribute("data-chrome-mode"), "compact");
  assert.equal(await floating.locator(".workspace-pane__summary").getAttribute("aria-hidden"), "true");
  assert.equal(await floating.locator(".workspace-pane__summary").evaluate(element => element.getBoundingClientRect().height), 0);
  await captureLoadingRegression(page, "lens-controls-compact");
  await floating.getByRole("button", { name: "Expand lens header", exact: true }).click();
  assert.equal(await floating.getAttribute("data-chrome-mode"), "expanded");
  await floating.getByRole("button", { name: "Compact lens header", exact: true }).click();
  await floating.getByRole("button", { name: "Hide lens controls", exact: true }).click();
  assert.equal(await floating.getAttribute("data-chrome-mode"), "hidden");
  const restore = floating.getByRole("button", { name: "Show lens controls", exact: true });
  await page.mouse.move(900, 600);
  const beforeHover = await restore.boundingBox();
  await restore.hover();
  const tab = await restore.evaluate(button => {
    const pane = button.closest(".workspace-pane")!.getBoundingClientRect();
    const box = button.getBoundingClientRect();
    const style = getComputedStyle(button);
    const surface = getComputedStyle(button, "::before");
    return { right: pane.right - box.right, centerY: Math.abs((box.top + box.bottom) / 2 - pane.top), width: box.width, height: box.height, radius: style.borderRadius,
      transform: style.transform, shadow: style.boxShadow, top: surface.top, bottom: surface.bottom,
      topBorder: surface.borderTopWidth, leftBorder: surface.borderLeftWidth,
      rightBorder: surface.borderRightWidth, bottomBorder: surface.borderBottomWidth, tabRadius: surface.borderRadius,
      topmost: button.contains(document.elementFromPoint(box.x + box.width / 2, pane.y + 6)),
      lowerTarget: button.contains(document.elementFromPoint(box.x + box.width / 2, pane.y + 10)) };
  });
  assert.ok(tab.right >= 5 && tab.right <= 8, "The restore tab stays at the header's right control position");
  assert.ok(tab.centerY <= 1, "The small restore tab is vertically centered across the lens's top border");
  assert.ok(tab.width <= 24);
  assert.equal(tab.height, 24);
  assert.equal(tab.radius, "0px");
  assert.equal(tab.width, beforeHover!.width, "Hover keeps the thin tab's shape and position");
  assert.equal(tab.shadow, "none");
  assert.equal(tab.top, "5px");
  assert.equal(tab.bottom, "5px");
  assert.equal(tab.topBorder, "1px");
  assert.equal(tab.leftBorder, "1px");
  assert.equal(tab.rightBorder, "1px");
  assert.equal(tab.bottomBorder, "1px");
  assert.equal(tab.tabRadius, "3px");
  assert.equal(tab.topmost, true);
  assert.equal(tab.lowerTarget, true, "The click target extends below the tab's thin visible surface");
  await captureLoadingRegression(page, "lens-controls-hidden");
  await page.keyboard.press("Tab");
  await restore.focus();
  assert.notEqual(await restore.evaluate(button => getComputedStyle(button, "::before").boxShadow), "none",
    "Keyboard focus is visible on the thin tab");
  await page.keyboard.press("Enter");
  assert.equal(await floating.getAttribute("data-chrome-mode"), "compact");
  await floating.getByRole("button", { name: "Expand lens header", exact: true }).click();
  assert.equal(await floating.getAttribute("data-chrome-mode"), "expanded");
  assert.equal(await floating.locator(".workspace-pane__summary").getAttribute("aria-hidden"), null);
  assert.deepEqual((await page.evaluate(() => workspaceStartupFixture.state())).requests, beforeFold.requests,
    "Changing header density keeps the same reader and does not save unrelated settings");
  await dock.click();
  await floating.getByRole("button", { name: "Float lens", exact: true }).waitFor();
  assert.equal(await floating.locator('.home-canvas[data-fixture-identity="same-lens"]').count(), 1,
    "Docking must preserve the rendered lens, its local state and reader");
  assert.equal((await floating.getAttribute("class"))?.includes("workspace-pane--free"), false);
  assert.equal(await data.getAttribute("aria-pressed"), "true");
  assert.equal(await expression.getAttribute("aria-pressed"), "true", "Docking retains the lens's panel choice");
  assert.equal(await code.getAttribute("aria-pressed"), "true");
  assert.equal(await first.locator('.data-inspection-dialog__presentations button[aria-label="Expression"]').getAttribute("aria-pressed"), "false");
  assert.equal(await floating.getByRole("button", { name: "Close lens", exact: true }).count(), 1);
  assert.equal((await headerGeometry()).order, true);
  const fold = page.getByRole("button", { name: "Hide the top bar", exact: true });
  const foldBox = await fold.boundingBox();
  const brandBox = await page.getByRole("link", { name: "Fenel home", exact: true }).boundingBox();
  assert.equal(await page.getByRole("button", { name: "Toggle navigation", exact: true }).count(), 0);
  assert.ok(foldBox!.x >= brandBox!.x + brandBox!.width, "The fold control follows the logo at the far right");
  await fold.click();
  const barRestore = page.getByRole("button", { name: "Show the top bar", exact: true });
  await barRestore.hover();
  const barBox = await barRestore.boundingBox();
  assert.equal(barBox!.x + barBox!.width, await page.evaluate(() => innerWidth));
  assert.equal(barBox!.y, 0);
  assert.equal(barBox!.width, 32);
  assert.equal(barBox!.height, 32);
  await page.mouse.click(barBox!.x + 16, barBox!.y + 27);
  await fold.waitFor({ state: "visible" });
  await page.setViewportSize({ width: 520, height: 900 });
  const shortcuts = floating.getByRole("group", { name: "Data shortcuts", exact: true });
  assert.equal(await shortcuts.getByRole("button").count(), 1, "A narrow lens exposes one Suggestions button");
  const suggestions = shortcuts.getByRole("button", { name: "Suggestions", exact: true });
  assert.equal(await suggestions.innerText(), "Suggestions");
  await suggestions.click();
  const menu = page.getByRole("menu", { name: "Suggestions", exact: true });
  for (const name of ["Data", "Expression", "Code", "Dependencies", "Show Suggestions panel"]) {
    await menu.getByRole("menuitem", { name, exact: true }).waitFor();
  }
  await page.waitForFunction(() => document.activeElement?.closest('[role="menu"]'));
  await page.keyboard.press("Escape");
  await menu.waitFor({ state: "hidden" });
  assert.equal((await headerGeometry()).fits, true, "The final close stays after the controls at a 520px viewport");
  assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true);
  assert.deepEqual(dataReads((await page.evaluate(() => workspaceStartupFixture.state())).requests).map(request => request.account), ["account-c", "account-b"]);
}));

test("float and dock animate through the browser while respecting reduced motion", () => fixture("lens-controls", async page => {
  const floating = page.locator('[data-workspace-lens="saved-lens-b"]');
  await floating.getByText("Saved B data", { exact: true }).waitFor();
  await page.evaluate(() => workspaceStartupFixture.releaseModel());
  await page.waitForFunction(() => workspaceStartupFixture.state().modelCalls.includes("workspaceBootstrapReady"));
  await page.evaluate(() => {
    const start = document.startViewTransition.bind(document);
    const captured: string[][] = [];
    Object.assign(globalThis, { capturedLensTransitions: captured });
    document.startViewTransition = options => {
      captured.push(typeof options === "object" ? [...options.types ?? []] : []);
      return start(options);
    };
  });
  await floating.getByRole("button", { name: "Dock lens", exact: true }).click();
  await floating.getByRole("button", { name: "Float lens", exact: true }).waitFor();
  assert.deepEqual(await page.evaluate(() => (globalThis as unknown as { capturedLensTransitions: string[][] }).capturedLensTransitions), [["lens-layout"]]);
  await page.getByRole("button", { name: "Hide the top bar", exact: true }).click();
  const sizeTransition = await page.locator(".topbar").evaluate(element => element.getAnimations().some(animation =>
    animation instanceof CSSTransition && ["height", "min-height"].includes(animation.transitionProperty)));
  assert.equal(sizeTransition, true, "The top bar collapses through an actual size transition");
  await page.getByRole("button", { name: "Show the top bar", exact: true }).click();
  await page.emulateMedia({ reducedMotion: "reduce" });
  await floating.getByRole("button", { name: "Float lens", exact: true }).click();
  await floating.getByRole("button", { name: "Dock lens", exact: true }).waitFor();
  assert.equal(await page.evaluate(() => (globalThis as unknown as { capturedLensTransitions: string[][] }).capturedLensTransitions.length), 1);
}));

test("floating lenses move through their visible grip and retain the final pointer position", () => fixture("lens-controls", async page => {
  const lens = page.locator('[data-workspace-lens="saved-lens-b"]');
  await lens.getByText("Saved B data", { exact: true }).waitFor();
  await page.evaluate(() => workspaceStartupFixture.releaseModel());
  await page.waitForFunction(() => workspaceStartupFixture.state().modelCalls.includes("workspaceBootstrapReady"));
  const grip = lens.getByRole("button", { name: "Move lens", exact: true });
  assert.deepEqual(await grip.evaluate(element => ({ cursor: getComputedStyle(element).cursor,
    touchAction: getComputedStyle(element).touchAction })), { cursor: "grab", touchAction: "none" });
  const placement = async () => {
    const result = await page.evaluate(() => workspaceStartupFixture.state().preferences.lenses.find(lens => lens.id === "saved-lens-b")!.placement);
    if (result?.$tag !== "FreePlacement") throw new Error("The lens must remain floating.");
    return result;
  };
  const before = await placement();
  assert.equal(before?.$tag, "FreePlacement");
  const box = await grip.boundingBox();
  await page.mouse.move(box!.x + box!.width / 2, box!.y + box!.height / 2);
  await page.mouse.down();
  assert.equal(await lens.getAttribute("data-lens-dragging"), "true");
  await page.mouse.move(box!.x + box!.width / 2 + 70, box!.y + box!.height / 2 + 45, { steps: 3 });
  await page.mouse.up();
  const moved = await placement();
  assert.deepEqual(moved, { ...before, x: before!.x + 70, y: before!.y + 45 });
  assert.equal(await lens.getAttribute("data-lens-dragging"), null);
  assert.equal(await lens.getByText("Saved B data", { exact: true }).count(), 1);

  // Pointerup can arrive before a queued Solid write. Its own coordinates,
  // rather than a prior reactive draft, are the committed final placement.
  await grip.evaluate(element => {
    element.dispatchEvent(new PointerEvent("pointerdown", { bubbles: true, pointerId: 41, isPrimary: true,
      button: 0, clientX: 100, clientY: 100 }));
    window.dispatchEvent(new PointerEvent("pointermove", { pointerId: 42, isPrimary: false, clientX: 900, clientY: 700 }));
    window.dispatchEvent(new PointerEvent("pointerup", { pointerId: 41, isPrimary: true, clientX: 113, clientY: 117 }));
  });
  const pointerFinal = await placement();
  assert.deepEqual(pointerFinal, { ...moved, x: moved!.x + 13, y: moved!.y + 17 });

  await grip.evaluate(element => {
    element.dispatchEvent(new PointerEvent("pointerdown", { bubbles: true, pointerId: 49, isPrimary: true,
      pointerType: "touch", button: 0, clientX: 100, clientY: 100 }));
    window.dispatchEvent(new PointerEvent("pointermove", { pointerId: 49, pointerType: "touch", clientX: 110, clientY: 110 }));
    window.dispatchEvent(new PointerEvent("pointerup", { pointerId: 49, pointerType: "touch", clientX: 120, clientY: 115 }));
  });
  const final = await placement();
  assert.deepEqual(final, { ...pointerFinal, x: pointerFinal.x + 20, y: pointerFinal.y + 15 },
    "Touch commits its final coordinates even when no intermediate draft has flushed");

  await grip.evaluate(element => {
    element.dispatchEvent(new PointerEvent("pointerdown", { bubbles: true, pointerId: 51, isPrimary: true,
      pointerType: "touch", button: 0, clientX: 100, clientY: 100 }));
    window.dispatchEvent(new PointerEvent("pointermove", { pointerId: 51, pointerType: "touch", clientX: 140, clientY: 130 }));
    window.dispatchEvent(new PointerEvent("pointercancel", { pointerId: 51, pointerType: "touch" }));
    window.dispatchEvent(new PointerEvent("pointerup", { pointerId: 51, pointerType: "touch", clientX: 140, clientY: 130 }));
  });
  assert.deepEqual(await placement(), final, "A cancelled touch gesture does not save its temporary position");
  assert.equal(await lens.getAttribute("data-lens-dragging"), null);

  await grip.press("ArrowRight");
  await grip.press("Shift+ArrowDown");
  assert.deepEqual(await placement(), { ...final, x: final!.x + 10, y: final!.y + 40 });
  const beforeControls = await placement();
  await lens.getByRole("button", { name: "Compact lens header", exact: true }).click();
  assert.deepEqual(await placement(), beforeControls, "Header controls do not move the lens");
  await grip.evaluate(element => {
    element.dispatchEvent(new PointerEvent("pointerdown", { bubbles: true, pointerId: 59, isPrimary: true,
      button: 0, clientX: 100, clientY: 100 }));
    window.dispatchEvent(new PointerEvent("pointerup", { pointerId: 59, clientX: -9999, clientY: -9999 }));
  });
  assert.deepEqual(await placement(), { ...beforeControls, x: 0, y: 0 }, "The header remains reachable beyond the top-left edge");
  await grip.press("ArrowLeft");
  await grip.press("ArrowUp");
  assert.deepEqual(await placement(), { ...beforeControls, x: 0, y: 0 }, "Keyboard movement also retains the reachable header");
  await grip.evaluate(element => {
    element.dispatchEvent(new PointerEvent("pointerdown", { bubbles: true, pointerId: 60, isPrimary: true,
      button: 0, clientX: 100, clientY: 100 }));
    window.dispatchEvent(new PointerEvent("pointerup", { pointerId: 60, clientX: 9999, clientY: 9999 }));
  });
  assert.equal(await grip.evaluate(element => {
    const grip = element.getBoundingClientRect();
    const surface = element.closest(".workspace-panes")!.getBoundingClientRect();
    return grip.left >= surface.left && grip.right <= surface.right
      && grip.top >= surface.top && grip.bottom <= surface.bottom;
  }), true, "A drag past the right/bottom edge leaves its grip within the visible surface");
  const beforeDispose = await placement();
  await grip.evaluate(element => {
    element.dispatchEvent(new PointerEvent("pointerdown", { bubbles: true, pointerId: 61, isPrimary: true,
      button: 0, clientX: 100, clientY: 100 }));
    workspaceStartupFixture.dispose();
    window.dispatchEvent(new PointerEvent("pointermove", { pointerId: 61, clientX: 150, clientY: 150 }));
    window.dispatchEvent(new PointerEvent("pointerup", { pointerId: 61, clientX: 150, clientY: 150 }));
  });
  assert.deepEqual(await placement(), beforeDispose, "Disposal removes listeners without saving or writing disposed UI state");
}));

test("saved account B and list focus paint before the model while authenticated in A", () => fixture("saved-b", async page => {
  await page.getByText("Saved B data", { exact: true }).waitFor();
  await page.waitForFunction(() => workspaceStartupFixture.state().dynamicModules.some(name => name === "./workspace-model" || name === "./workspace-model-loader"));
  const state = await page.evaluate(() => workspaceStartupFixture.state());
  assert.deepEqual(dataReads(state.requests).map(request => request.account), ["account-b"]);
  assert.equal(state.modelReleased, false);
  assert.deepEqual(state.modelCalls, []);
  assert.equal(await page.getByText("B ROOT SHOULD NOT APPEAR", { exact: true }).count(), 0);
  assert.equal(await page.locator('[data-workspace-lens="saved-lens-b"]').count(), 1);
  assert.deepEqual(state.bar, { $tag: "WorkspaceBar", mode: { $tag: "DockedBar" }, position: { $tag: "BarTop" } });
}));

test("a saved public lens paints repository data before its engine and never reads private data", () => fixture("public", async page => {
  await page.locator('[data-workspace-lens="saved-lens-b"]').waitFor();
  await page.getByRole("button", { name: "Standard library", exact: true }).waitFor();
  await page.getByRole("button", { name: "Demo", exact: true }).waitFor();
  assert.equal(await page.getByText("Fenel (public)", { exact: true }).count(), 0);
  let state = await page.evaluate(() => workspaceStartupFixture.state());
  assert.deepEqual(dataReads(state.requests), []);
  assert.equal(state.modelReleased, false);
  assert.equal(state.requests.some(request => request.method !== "GET"), false);
  assert.equal(state.dynamicModules.includes("./workspace-model"), false);
  assert.equal(state.dynamicModules.includes("./expression-runner/authoring-session"), false);
  assert.equal(state.dynamicModules.includes("./image-pipeline-preview"), false);
  assert.equal(await page.locator('[data-locus-item="std"][aria-busy="true"]').count(), 0);
  assert.equal(await page.getByText("Loading editing tools…", { exact: true }).count(), 0);
  await page.locator('[data-workspace-lens="saved-lens-b"]').getByRole("button", { name: "Browse", exact: true }).click();
  await page.waitForFunction(() => workspaceStartupFixture.state().dynamicModules.some(name => name === "./workspace-model" || name === "./workspace-model-loader"));
  state = await page.evaluate(() => workspaceStartupFixture.state());
  assert.deepEqual(dataReads(state.requests), []);
}));

test("a rejected malformed bootstrap displays its error and never seeds defaults", () => fixture("malformed", async page => {
  await page.getByRole("button", { name: "1 notification", exact: true }).click();
  await page.getByText("The saved workspace value is malformed. Correct it before continuing.", { exact: true }).waitFor();
  const state = await page.evaluate(() => workspaceStartupFixture.state());
  assert.deepEqual(dataReads(state.requests), []);
  assert.deepEqual(state.modelCalls, []);
  assert.deepEqual(state.dynamicModules, []);
  assert.equal(await page.locator(".workspace-pane").count(), 0);
  assert.equal(await page.locator(".workspace-startup__card, .workspace-save-status, .workspace-error").count(), 0);
  assert.equal(state.requests.some(request => request.method === "PUT"), false);
  assert.equal(await page.getByRole("button", { name: "Dismiss", exact: true }).count(), 1);
  await page.keyboard.press("Escape");
  assert.equal(await page.getByRole("dialog", { name: "Notifications", exact: true }).count(), 0);
  await page.getByRole("button", { name: "1 notification", exact: true }).click();
  await page.getByRole("button", { name: "Retry", exact: true }).waitFor();
  await page.getByRole("button", { name: "Dismiss", exact: true }).click();
  assert.equal(await page.getByRole("dialog", { name: "Notifications", exact: true }).count(), 0);
  assert.equal(await page.getByRole("button", { name: "1 notification", exact: true }).count(), 0);
}));

test("a pane data path stays inside its header when legacy toolbar CSS loads last", () => fixture("public-toolbar-order", async page => {
  const legacyToolbar = css.match(/\.dashboard--home \.home-toolbar\s*\{[^}]+\}/)?.[0];
  assert.ok(legacyToolbar, "The real legacy fixed-toolbar rule must be exercised");
  await page.addStyleTag({ content: legacyToolbar });
  for (const width of [1024, 390]) {
    await page.setViewportSize({ width, height: 844 });
    // A phone-width lens toolbar reads its path as one button (the "All data"
    // step is inside its full path); the same containment applies to it.
    const nav = page.getByRole("navigation", { name: "Where you are", exact: true });
    const source = width > 540 ? nav.getByRole("button", { name: "All data", exact: true }) : nav.locator(".locus-crumbs__compact");
    await source.waitFor();
    const geometry = await source.evaluate(button => {
      const toolbar = button.closest<HTMLElement>('.home-toolbar')!;
      const header = button.closest<HTMLElement>('.workspace-pane__header')!;
      const bounds = button.getBoundingClientRect();
      const parent = header.getBoundingClientRect();
      const hit = document.elementFromPoint(bounds.left + bounds.width / 2, bounds.top + bounds.height / 2);
      return { position: getComputedStyle(toolbar).position,
        contained: bounds.top >= parent.top && bounds.bottom <= parent.bottom,
        clickable: hit === button || !!hit && button.contains(hit),
        detail: { bounds: bounds.toJSON(), parent: parent.toJSON(), toolbar: toolbar.getBoundingClientRect().toJSON(),
          hit: hit?.outerHTML.slice(0, 240) } };
    });
    assert.deepEqual({ position: geometry.position, contained: geometry.contained, clickable: geometry.clickable },
      { position: "static", contained: true, clickable: true }, `Data path at ${width}px: ${JSON.stringify(geometry.detail)}`);
    await source.click({ button: "right" });
    await page.getByRole("menu", { name: "Data path actions", exact: true }).waitFor();
    await page.getByRole("menuitem", { name: "Open", exact: true }).waitFor();
    await page.keyboard.press("Escape");
  }
}));

test("a failed unopened Browse with a public mismatch offers Reload page and fetches a fresh document", () => fixture("public-bootstrap-mismatch", async page => {
  await page.getByRole("button", { name: "Standard library", exact: true }).waitFor();
  assert.deepEqual((await page.evaluate(() => workspaceStartupFixture.state())).dynamicModules, ["./generated/public-bootstrap.json"]);
  await page.locator('[data-workspace-lens="saved-lens-b"]').getByRole("button", { name: "Browse", exact: true }).click();
  await page.getByRole("button", { name: "Error. Could not prepare data tools. Open details.", exact: true }).click();
  const details = page.getByRole("dialog", { name: "Could not prepare data tools.", exact: true });
  await details.waitFor();
  await details.getByText("The public data changed while loading its tools. Reload the page to use the current data.", { exact: true }).waitFor();
  assert.equal(await details.getByRole("button", { name: "Retry", exact: true }).count(), 0);
  const failed = await page.evaluate(() => workspaceStartupFixture.state());
  assert.equal(failed.dynamicModules.filter(name => name === "./public-locus-data").length, 1);
  assert.deepEqual(dataReads(failed.requests), []);
  assert.equal(await page.locator('[data-locus-surface="workspace"]').count(), 0);
  const previousUrl = page.url();
  const nextDocument = page.waitForEvent("request", request => request.isNavigationRequest() && request.frame() === page.mainFrame());
  await details.getByRole("button", { name: "Reload page", exact: true }).click();
  const request = await nextDocument;
  assert.equal(request.method(), "GET");
  assert.equal(request.url(), previousUrl);
  await page.waitForLoadState("domcontentloaded");
  assert.equal(await page.evaluate(() => "workspaceStartupFixture" in globalThis), false,
    "Reload must retire the stale document and its held reader rather than retrying it");
  // The fixture route serves an inert document. Install the fresh client again
  // so the ordinary fixture teardown also checks its new browser lifetime.
  await page.addStyleTag({ content: css });
  await page.addScriptTag({ content: script, type: "module" });
  await page.waitForFunction(() => !!globalThis.workspaceStartupFixture);
  await page.getByRole("button", { name: "Standard library", exact: true }).waitFor();
  assert.deepEqual((await page.evaluate(() => workspaceStartupFixture.state())).dynamicModules, ["./generated/public-bootstrap.json"]);
}));

test("Retry restarts the reader for a failed unopened Browse without treating it as a draft", () => fixture("public-browse-retry", async page => {
  await page.getByRole("button", { name: "Standard library", exact: true }).waitFor();
  await page.locator('[data-workspace-lens="saved-lens-b"]').getByRole("button", { name: "Browse", exact: true }).click();
  await page.getByRole("button", { name: "Error. Could not prepare data tools. Open details.", exact: true }).click();
  const details = page.getByRole("dialog", { name: "Could not prepare data tools.", exact: true });
  await details.waitFor();
  await details.getByText("The data tools were temporarily unavailable.", { exact: true }).waitFor();
  const failed = await page.evaluate(() => workspaceStartupFixture.state());
  assert.equal(failed.publicPreparations, 1);
  assert.deepEqual(dataReads(failed.requests), []);
  await details.getByRole("button", { name: "Retry", exact: true }).click();
  await page.waitForFunction(() => workspaceStartupFixture.state().publicPreparations === 2);
  await details.waitFor({ state: "detached" });
  await page.getByRole("button", { name: "Standard library", exact: true }).waitFor();
  assert.equal(await page.locator(".locus-load-failure").count(), 0);
  const retried = await page.evaluate(() => workspaceStartupFixture.state());
  assert.equal(retried.epoch, failed.epoch);
  assert.equal(retried.preferences.lenses[0]!.source.$tag, "PublicSource");
  assert.deepEqual(dataReads(retried.requests), []);
  assert.equal(retried.requests.some(request => request.method !== "GET"), false);
  assert.equal(await page.locator('[data-locus-surface="workspace"]').count(), 0,
    "Restarted preparation stays unreadable until its checked public session completes");
}));

test("All data navigation reports pending model preparation and offers a retry after failure", () => fixture("public-model-prepare-failure", async page => {
  await page.getByRole("button", { name: "Standard library", exact: true }).waitFor();
  await page.getByRole("navigation", { name: "Where you are", exact: true }).getByRole("button", { name: "All data", exact: true }).click();
  await page.getByRole("button", { name: /^\d+ notifications?$/ }).click();
  await page.getByText("Preparing lens controls…", { exact: true }).waitFor();
  assert.equal((await page.evaluate(() => workspaceStartupFixture.state())).preferences.lenses[0]!.source.$tag, "PublicSource");
  assert.deepEqual(dataReads((await page.evaluate(() => workspaceStartupFixture.state())).requests), []);
  await page.evaluate(() => workspaceStartupFixture.releaseModel());
  await page.getByText("Could not prepare your lenses.", { exact: true }).waitFor();
  assert.equal(await page.getByText("Preparing lens controls…", { exact: true }).count(), 0);
  await page.getByRole("button", { name: "Retry", exact: true }).click();
  await page.waitForFunction(() => workspaceStartupFixture.state().modelPreparations === 2);
  await page.waitForFunction(() => !workspaceStartupFixture.state().notices.some(notice => notice.id === "lens-preparation" || notice.id === "lens-preparation-loading"));
  assert.equal((await page.evaluate(() => workspaceStartupFixture.state())).preferences.lenses[0]!.source.$tag, "PublicSource");
  assert.deepEqual(dataReads((await page.evaluate(() => workspaceStartupFixture.state())).requests), []);
}));

test("deferred authored preferences wait for their evaluator without guessing a source", () => fixture("deferred", async page => {
  await page.waitForFunction(() => workspaceStartupFixture.state().dynamicModules.some(name => name === "./workspace-model" || name === "./workspace-model-loader"));
  const state = await page.evaluate(() => workspaceStartupFixture.state());
  assert.deepEqual(dataReads(state.requests), []);
  assert.equal(await page.locator(".workspace-pane").count(), 0);
  assert.deepEqual(state.modelCalls, []);
  assert.equal(state.requests.some(request => request.method === "PUT"), false);
}));

test("model readiness preserves the same pane and the first authorized root response", () => fixture("saved-b", async page => {
  await page.getByText("Saved B data", { exact: true }).waitFor();
  await page.locator(".home-canvas").evaluate(element => { (element as HTMLElement).dataset.fixtureIdentity = "same-pane"; });
  await page.evaluate(() => workspaceStartupFixture.releaseModel());
  await page.waitForFunction(() => workspaceStartupFixture.state().modelCalls.includes("workspaceBootstrapReady"));
  assert.equal(await page.locator('.home-canvas[data-fixture-identity="same-pane"]').count(), 1);
  await page.getByText("Saved B data", { exact: true }).waitFor();
  const state = await page.evaluate(() => workspaceStartupFixture.state());
  assert.deepEqual(dataReads(state.requests).map(request => request.account), ["account-b"]);
  assert.ok(state.modelCalls.includes("validateWorkspacePreferences"));
}));

test("opening and dismissing account path actions preserves the data and performs no write", () => fixture("account-menu", async page => {
  await page.emulateMedia({ reducedMotion: "reduce" });
  await page.getByText("Account B root data", { exact: true }).waitFor();
  const pane = page.locator('[data-workspace-lens="saved-lens-b"]');
  const summary = pane.locator(".lens-data-summary");
  assert.equal(await pane.getAttribute("data-chrome-mode"), "expanded");
  await summary.locator(".home-item__caption").getByText("All data", { exact: true }).waitFor();
  assert.equal(await summary.locator(".home-item__type-label").innerText(), "List of anything");
  assert.equal(await pane.locator(".locus-crumbs__type").isVisible(), false,
    "The expanded type line owns its control without a duplicate in the toolbar");
  const aligned = await summary.evaluate(element => {
    const name = element.querySelector(".home-item__caption")!.getBoundingClientRect();
    const type = element.querySelector(".home-item__type-label")!.getBoundingClientRect();
    return Math.abs(name.left - type.left);
  });
  assert.ok(aligned <= 1, "The name and type use the same text column");
  await captureLoadingRegression(page, "docked-lens-expanded");
  await pane.locator(".home-canvas").evaluate(element => { (element as HTMLElement).dataset.fixtureIdentity = "density-keeps-pane"; });
  await pane.getByRole("button", { name: "Compact lens header", exact: true }).focus();
  await page.keyboard.press("Enter");
  assert.equal(await pane.getAttribute("data-chrome-mode"), "compact");
  assert.equal(await pane.locator(".locus-crumbs__type").isVisible(), true,
    "The type control returns when the expanded lines are collapsed");
  assert.equal(await pane.locator(".workspace-pane__summary").evaluate(element => getComputedStyle(element).visibility), "hidden",
    "Collapsed summary badges cannot spill over the toolbar");
  assert.ok(await pane.locator(".locus-crumbs__subject").evaluate(element => {
    const current = element.querySelector(".locus-crumbs__current")!.getBoundingClientRect();
    const type = element.querySelector(".locus-crumbs__type")!.getBoundingClientRect();
    return type.left - current.right <= 1;
  }), "The compact type remains beside the current data name");
  assert.equal(await pane.locator(".workspace-pane__summary").evaluate(element => element.getBoundingClientRect().height), 0);
  await captureLoadingRegression(page, "docked-lens-compact");
  await pane.getByRole("button", { name: "Hide lens controls", exact: true }).click();
  assert.equal(await pane.getAttribute("data-chrome-mode"), "hidden");
  await captureLoadingRegression(page, "docked-lens-hidden");
  for (const width of [1024, 390]) {
    await page.setViewportSize({ width, height: 768 });
    assert.ok(await pane.getByRole("button", { name: "Show lens controls", exact: true }).evaluate(button => {
      const lens = button.closest(".workspace-pane")!.getBoundingClientRect();
      const bar = document.querySelector(".topbar")!.getBoundingClientRect();
      const tab = button.getBoundingClientRect();
      const icon = button.querySelector("svg")!.getBoundingClientRect();
      const body = button.closest(".workspace-pane")!.querySelector(".workspace-pane__body")!;
      return tab.left - lens.left >= 5 && tab.left - lens.left <= 8
        && tab.top === lens.top
        && lens.top === bar.bottom && getComputedStyle(button.closest(".workspace-pane")!).borderTopWidth === "0px"
        && body.getBoundingClientRect().top + parseFloat(getComputedStyle(body).paddingTop) >= tab.bottom
        && icon.top >= tab.top && icon.bottom <= tab.bottom
        && button.contains(document.elementFromPoint(tab.left + tab.width / 2, tab.top + tab.height / 2));
    }), "The merged lens reveal tab stays below the shared top border and clears the first data on desktop and phone");
  }
  await page.setViewportSize({ width: 1024, height: 768 });
  await pane.getByRole("button", { name: "Show lens controls", exact: true }).click();
  assert.equal(await pane.getAttribute("data-chrome-mode"), "compact");
  await pane.getByRole("button", { name: "Expand lens header", exact: true }).click();
  assert.equal(await pane.getAttribute("data-chrome-mode"), "expanded");
  assert.equal(await pane.locator('.home-canvas[data-fixture-identity="density-keeps-pane"]').count(), 1);
  assert.equal((await page.evaluate(() => workspaceStartupFixture.state())).requests.some(request => request.method !== "GET"
    && request.path !== "/api/reader-metadata"), false, "Reader metadata is a read; opening path actions does not write data");
  await page.evaluate(() => workspaceStartupFixture.releaseModel());
  const account = pane.locator('.locus-crumbs__current[aria-current="page"]');
  await account.waitFor();
  assert.equal(await account.innerText(), "Account B");
  assert.equal(await page.locator(".account-data-selector").count(), 0);
  assert.equal(await summary.locator(".lens-data-summary__account").innerText(), "Account B");
  await summary.locator(".home-item__caption").getByText("All data", { exact: true }).waitFor();
  assert.equal(await summary.locator(".home-item__type-label").innerText(), "List of anything");
  assert.equal(await summary.getAttribute("aria-busy"), "false");
  await page.locator(".home-canvas").evaluate(element => { (element as HTMLElement).dataset.fixtureIdentity = "menu-keeps-pane"; });
  const before = await page.evaluate(() => workspaceStartupFixture.state());
  await account.click({ button: "right" });
  await page.getByRole("menu", { name: "Data path actions", exact: true }).waitFor();
  assert.equal(await page.getByRole("menuitemradio").count(), 0);
  assert.equal(await page.getByRole("button", { name: "Lens: Saved B list", exact: true }).count(), 0);
  assert.equal(await page.getByRole("button", { name: "Show lenses together", exact: true }).count(), 0);
  assert.equal(await summary.getByText("All data", { exact: true }).count(), 1);
  await page.getByRole("menuitem", { name: "Open", exact: true }).hover();
  await page.getByText("Account B root data", { exact: true }).waitFor();
  await page.keyboard.press("Escape");
  assert.equal(await page.getByRole("menu").count(), 0);
  assert.equal(await page.locator('.home-canvas[data-fixture-identity="menu-keeps-pane"]').count(), 1);
  const after = await page.evaluate(() => workspaceStartupFixture.state());
  assert.deepEqual(after.requests, before.requests);
  assert.equal(await account.innerText(), "Account B");
  await account.click({ button: "right" });
  await page.getByRole("menu", { name: "Data path actions", exact: true }).waitFor();
  await page.keyboard.press("Escape");
  assert.deepEqual((await page.evaluate(() => workspaceStartupFixture.state())).requests, before.requests);
}));

test("the exact root type opens as readable data before editing tools prepare", () => fixture("type-inspection", async page => {
  await page.getByText("Account B root data", { exact: true }).waitFor();
  const before = await page.evaluate(() => workspaceStartupFixture.state());
  await page.locator(".lens-data-summary").getByRole("button", { name: "Open this data: List of anything", exact: true }).click();
  const typeData = page.getByLabel("Type data", { exact: true });
  await typeData.waitFor();
  assert.equal(await typeData.getByText("Nil", { exact: true }).count(), 1);
  assert.equal(await typeData.getByText("Cons", { exact: true }).count(), 1);
  assert.equal(await typeData.getByText("head", { exact: true }).count(), 1);
  assert.equal(await typeData.getByText("tail", { exact: true }).count(), 1);
  assert.equal(await page.locator(".lens-data-summary .home-item__type-label").innerText(), "Type");
  const after = await page.evaluate(() => workspaceStartupFixture.state());
  assert.equal(after.modelReleased, false);
  assert.deepEqual(dataReads(after.requests), dataReads(before.requests));
}));

test("unnamed data uses visible normal-weight italic Data in its card and focused heading", () => fixture("unnamed-data", async page => {
  await page.getByText("Account B root data", { exact: true }).waitFor();
  const heading = page.locator(".lens-data-summary .home-item__caption-label em");
  assert.equal(await heading.innerText(), "Data");
  assert.deepEqual(await heading.evaluate(element => ({ weight: getComputedStyle(element).fontWeight,
    style: getComputedStyle(element).fontStyle })), { weight: "400", style: "italic" });
  assert.equal(await page.locator(".locus-crumbs__here em").innerText(), "Data");
  assert.equal(await page.locator(".lens-data-summary__account").innerText(), "Account B");
  assert.equal(await page.getByRole("navigation", { name: "Where you are", exact: true }).getByRole("button", { name: "Account B", exact: true }).count(), 1);
  assert.equal(await page.locator(".account-data-selector").count(), 0);
  if (process.env["FENEL_STARTUP_FIXTURE_VARIANT"] !== "before") {
    const labelAlignment = await page.locator('.lens-data-summary').evaluate(summary => ({
      account: summary.querySelector('.lens-data-summary__account-badge > span')!.getBoundingClientRect().left,
      data: summary.querySelector('.home-item__caption-label')!.getBoundingClientRect().left,
      type: summary.querySelector('.home-item__type-label')!.getBoundingClientRect().left,
    }));
    assert.ok(Math.abs(labelAlignment.account - labelAlignment.data) <= 1 && Math.abs(labelAlignment.data - labelAlignment.type) <= 1,
      `Source, data and type labels share the same column: ${JSON.stringify(labelAlignment)}`);
  }
  await page.getByRole("navigation", { name: "Where you are", exact: true }).getByRole("button", { name: "Account B", exact: true }).click();
  const unnamed = page.locator('[data-locus-preview="root-only"] .home-item__caption-label em');
  assert.equal(await unnamed.innerText(), "Data");
  assert.equal(await unnamed.isVisible(), true);
  assert.deepEqual(await unnamed.evaluate(element => ({ weight: getComputedStyle(element).fontWeight,
    style: getComputedStyle(element).fontStyle })), { weight: "400", style: "italic" });
}));

test("type descriptions and pending type handoff preserve nonfinite and negative-zero singleton transport", async () => {
  const labels = ["Positive infinity", "Negative infinity", "Not a number", "Negative zero", "Zero"];
  for (let atom = 0; atom < labels.length; atom++) await fixture(`type-transport&atom=${atom}`, async page => {
    const summary = page.locator(".lens-data-summary");
    const label = labels[atom]!;
    await summary.getByText(label, { exact: true }).waitFor();
    await summary.getByRole("button", { name: `Open this data: ${label}`, exact: true }).click();
    const typeData = page.getByLabel("Type data", { exact: true });
    await typeData.getByText(label, { exact: true }).waitFor();
    await page.evaluate(() => workspaceStartupFixture.releaseModel());
    await page.waitForFunction(() => workspaceStartupFixture.state().preferences.lenses[0]!.subject?.$tag === "Just");
    assert.equal(await page.evaluate(index => {
      const subject = workspaceStartupFixture.state().preferences.lenses[0]!.subject;
      const type = subject?.$tag === "Just" ? subject._0.data as { $refined: { set: { values: unknown[] } } } : undefined;
      return Object.is(type?.$refined.set.values[0], [Infinity, -Infinity, NaN, -0, 0][index]);
    }, atom), true);
    assert.equal(await typeData.isVisible(), true, "The local exact type stays readable through its own model acknowledgement while editing tools are held");
  });
});

test("an unavailable full type description stays pending while ordinary compact cards can keep their brief type", () => fixture("incomplete-type-description", async page => {
  await page.getByText("Saved B data", { exact: true }).waitFor();
  const summary = page.locator(".lens-data-summary");
  assert.equal(await summary.getAttribute("aria-busy"), "true");
  assert.equal(await summary.locator(".home-item__type-label").count(), 0,
    "A kind label cannot stand in for the focused data's full type");
  assert.equal(await summary.locator(".home-item__type-tag--reserved").isVisible(), true);
  assert.equal(await page.locator('.home-entry__preview .home-item__type-label').first().innerText(), "String");
}));

test("a previously selected settings account recovers to the login account without reading settings as data", () => fixture("stale-personal", async page => {
  await page.waitForFunction(() => workspaceStartupFixture.state().dynamicModules.some(name => name === "./workspace-model" || name === "./workspace-model-loader"));
  assert.deepEqual(dataReads((await page.evaluate(() => workspaceStartupFixture.state())).requests), []);
  await page.evaluate(() => workspaceStartupFixture.releaseModel());
  await page.getByText("Account C data", { exact: true }).waitFor();
  await page.waitForFunction(() => workspaceStartupFixture.state().requests.some(request => request.method === "PUT"));
  const state = await page.evaluate(() => workspaceStartupFixture.state());
  assert.deepEqual(dataReads(state.requests).map(request => request.account), ["account-a"]);
  assert.deepEqual(state.edits, [{ $tag: "EditWorkspaceLens", id: "saved-lens-b", command: { $tag: "SetLensSource",
    source: { $tag: "AccountSource", accountId: "account-a" } } }]);
  assert.deepEqual(state.requests.filter(request => request.method === "PUT").map(request => request.account), ["personal"]);
  assert.equal(await page.locator(".lens-data-summary__account").innerText(), "Account A");
  assert.equal(await page.locator('.locus-crumbs__current[aria-current="page"]').innerText(), "Account A");
  assert.equal(await page.locator(".account-data-selector").count(), 0);
}));

test("the authenticated account retains its ordinary data path when it also owns personal settings", () => fixture("personal-login", async page => {
  await page.getByText("Account C data", { exact: true }).waitFor();
  await page.evaluate(() => workspaceStartupFixture.releaseModel());
  await page.locator('.locus-crumbs__current[aria-current="page"]').getByText("Personal workspace", { exact: true }).waitFor();
  assert.equal(await page.locator(".lens-data-summary__account").innerText(), "Personal workspace");
  assert.equal(await page.locator(".account-data-selector").count(), 0);
  const state = await page.evaluate(() => workspaceStartupFixture.state());
  assert.deepEqual(dataReads(state.requests).map(request => request.account), ["personal"]);
  assert.deepEqual(state.edits, []);
  assert.equal(state.requests.some(request => request.method !== "GET"), false);
}));

test("a focus action outside its inactive pane selects only that lens and changes focus atomically", () => fixture("portal-focus", async page => {
  const first = page.locator('[data-workspace-lens="lens-first"]');
  const second = page.locator('[data-workspace-lens="saved-lens-b"]');
  await second.getByText("Saved B data", { exact: true }).waitFor();
  await page.evaluate(() => workspaceStartupFixture.releaseModel());
  await page.waitForFunction(() => workspaceStartupFixture.state().modelCalls.includes("workspaceBootstrapReady"));
  const before = await page.evaluate(() => workspaceStartupFixture.state());
  assert.equal(before.preferences.activeLensId, "lens-first");
  // A portal's DOM lives outside its owning pane. Move the real early focus
  // control there so no pane pointerdown/focusin handler can activate it.
  await second.getByRole("button", { name: "Go up", exact: true }).evaluate(button => {
    button.setAttribute("data-external-focus", "true");
    document.body.appendChild(button);
  });
  await page.locator('[data-external-focus="true"]').click();
  await page.waitForFunction(() => workspaceStartupFixture.state().preferences.activeLensId === "saved-lens-b");
  const after = await page.evaluate(() => workspaceStartupFixture.state());
  assert.deepEqual(after.editBatches, [[
    { $tag: "SelectWorkspaceLens", id: "saved-lens-b" },
    { $tag: "EditWorkspaceLens", id: "saved-lens-b", command: { $tag: "SetLensFocus", focus: { $tag: "RootFocus" } } },
  ]]);
  assert.deepEqual(after.preferences.lenses[0], before.preferences.lenses[0]);
  assert.equal((await first.getAttribute("class"))?.includes("workspace-pane--active"), false);
  assert.equal((await second.getAttribute("class"))?.includes("workspace-pane--active"), true);
  await second.locator('.locus-crumbs__current[aria-current="page"]').getByText("Account B", { exact: true }).waitFor();
}));

test("closing the first of two lenses retains the second throughout a pending save", () => fixture("close-first", async page => {
  const first = page.locator('[data-workspace-lens="lens-first"]');
  const second = page.locator('[data-workspace-lens="saved-lens-b"]');
  await second.getByText("Saved B data", { exact: true }).waitFor();
  await page.evaluate(() => workspaceStartupFixture.releaseModel());
  await page.waitForFunction(() => workspaceStartupFixture.state().modelCalls.includes("workspaceBootstrapReady"));
  await second.locator(".home-canvas").evaluate(element => { (element as HTMLElement).dataset.fixtureIdentity = "surviving-pane"; });
  await first.getByRole("button", { name: "Close lens", exact: true }).click();
  await page.waitForFunction(() => workspaceStartupFixture.state().requests.some(request => request.method === "PUT"));
  const sync = page.locator(".workspace-sync");
  await page.locator('.workspace-sync[data-sync-status="syncing"]').waitFor();
  const syncingBox = await sync.boundingBox();
  assert.ok(syncingBox);
  assert.equal(await page.getByText("Saving lenses…", { exact: true }).count(), 0);
  assert.equal(await first.count(), 0);
  await second.getByText("Saved B data", { exact: true }).waitFor();
  assert.equal(await second.locator('.home-canvas[data-fixture-identity="surviving-pane"]').count(), 1);
  const box = await second.boundingBox();
  assert.ok(box && box.width > 0 && box.height > 0, "The remaining lens must keep a visible surface while saving");
  await page.evaluate(() => workspaceStartupFixture.releaseSaves());
  await page.locator('.workspace-sync[data-sync-status="synced"]').waitFor();
  const syncedBox = await sync.boundingBox();
  assert.ok(syncedBox);
  assert.equal(syncedBox.width, syncingBox.width);
  assert.equal(syncedBox.x, syncingBox.x);
  await second.getByText("Saved B data", { exact: true }).waitFor();
  const state = await page.evaluate(() => workspaceStartupFixture.state());
  assert.equal(state.preferences.lenses.length, 2, "Closing must preserve both saved lenses");
  assert.deepEqual(state.preferences.display, { $tag: "VisibleLenses", ids: ["saved-lens-b"] });
  assert.deepEqual(dataReads(state.requests).map(request => request.account), ["account-c", "account-b"]);
}));

test("a failed hidden-source preparation retains a retry that recovers without reading settings as data", () => fixture("stale-personal-prepare-failure", async page => {
  await page.waitForFunction(() => workspaceStartupFixture.state().dynamicModules.some(name => name === "./workspace-model" || name === "./workspace-model-loader"));
  await page.evaluate(() => workspaceStartupFixture.releaseModel());
  await page.getByRole("button", { name: /^\d+ notifications?$/ }).click();
  await page.getByText("Could not prepare your lenses.", { exact: true }).waitFor();
  assert.deepEqual(dataReads((await page.evaluate(() => workspaceStartupFixture.state())).requests), []);
  assert.equal(await page.getByRole("button", { name: "Dismiss", exact: true }).count(), 1);
  await page.getByRole("button", { name: "Retry", exact: true }).click();
  await page.getByText("Account C data", { exact: true }).waitFor();
  const state = await page.evaluate(() => workspaceStartupFixture.state());
  assert.deepEqual(dataReads(state.requests).map(request => request.account), ["account-a"]);
  assert.equal(state.modelPreparations, 2);
  assert.equal(state.edits.length, 1);
}));

test("reloading a conflicting old source corrects it again and keeps both recovery actions in notifications", () => fixture("stale-personal-conflict", async page => {
  await page.waitForFunction(() => workspaceStartupFixture.state().dynamicModules.some(name => name === "./workspace-model" || name === "./workspace-model-loader"));
  await page.evaluate(() => workspaceStartupFixture.releaseModel());
  await page.getByText("Account C data", { exact: true }).waitFor();
  await page.getByRole("button", { name: /^\d+ notifications?$/ }).click();
  await page.getByRole("button", { name: "Retry save", exact: true }).waitFor();
  await page.locator('.workspace-sync[data-sync-status="error"]').waitFor();
  assert.equal(await page.locator(".workspace-sync__warning svg").count(), 1);
  const before = await page.evaluate(() => workspaceStartupFixture.state());
  assert.deepEqual(dataReads(before.requests).map(request => request.account), ["account-a"]);
  await page.getByRole("button", { name: "Reload saved", exact: true }).click();
  await page.getByRole("dialog", { name: "Reload your saved lens settings?", exact: true }).getByRole("button", { name: "Reload", exact: true }).click();
  await page.waitForFunction(() => workspaceStartupFixture.state().edits.length === 2);
  await page.waitForFunction(() => workspaceStartupFixture.state().requests.filter(request => request.method === "PUT").length === 2);
  await page.getByText("Account C data", { exact: true }).waitFor();
  const after = await page.evaluate(() => workspaceStartupFixture.state());
  assert.equal(dataReads(after.requests).filter(request => request.account === "personal").length, 1);
  assert.deepEqual(after.edits[1], after.edits[0]);
  await page.waitForFunction(() => workspaceStartupFixture.state().notices.every(notice => notice.tone !== "error"));
  await page.locator('.workspace-sync[data-sync-status="synced"]').waitFor();
  assert.equal(await page.locator(".workspace-sync__warning").count(), 0);
  assert.equal(await page.locator(".workspace-save-status").count(), 0);
}));

test("disposal before a delayed bootstrap prevents late private data reads", () => fixture("slow-bootstrap", async page => {
  await page.waitForFunction(() => document.body.textContent?.includes("Loading data"));
  const steps = page.getByRole("list", { name: "Loading steps", exact: true });
  assert.equal(await steps.getByRole("listitem").count(), 3);
  assert.deepEqual(await steps.getByRole("listitem").evaluateAll(elements => elements.map(element => element.getAttribute("data-state"))), ["complete", "complete", "current"]);
  assert.equal(await steps.getByRole("listitem", { name: "Data: loading", exact: true }).getAttribute("aria-current"), "step");
  await page.evaluate(() => { workspaceStartupFixture.dispose(); workspaceStartupFixture.releaseBootstrap(); });
  await page.waitForFunction(() => workspaceStartupFixture.state().bootstrapReleased);
  const state = await page.evaluate(() => workspaceStartupFixture.state());
  assert.deepEqual(dataReads(state.requests), []);
  assert.deepEqual(state.dynamicModules, []);
  assert.equal(await page.locator(".workspace-surface").count(), 0);
}));

test("merged pending frames fill the viewport before dashboard border metadata is ready", () => fixture("slow-reader", async page => {
  await page.emulateMedia({ reducedMotion: "reduce" });
  const pane = page.locator('[data-workspace-lens="saved-lens-b"]');
  await pane.locator('.workspace-pane__wait').waitFor();
  // PendingLensFrame already renders merged panes while the lazy surface that
  // publishes dashboard metadata has not mounted. Reproduce that exact gap.
  await page.locator(".dashboard").evaluate(element => element.removeAttribute("data-borders"));
  for (const viewport of [{ width: 1280, height: 634 }, { width: 390, height: 844 }]) {
    await page.setViewportSize(viewport);
    const geometry = await pane.evaluate(element => {
      const box = element.getBoundingClientRect();
      return { left: box.left, right: box.right, bottom: box.bottom,
        bodyBottom: element.querySelector(".workspace-pane__body")!.getBoundingClientRect().bottom,
        width: innerWidth, height: innerHeight };
    });
    assert.equal(geometry.left, 0);
    assert.equal(geometry.right, geometry.width);
    assert.equal(geometry.bottom, geometry.height);
    assert.equal(geometry.bodyBottom, geometry.height);
    await page.locator(".workspace-panes").evaluate(element => element.classList.remove("workspace-panes--merged"));
    assert.equal(await page.locator(".main-content--home").evaluate(element => parseFloat(getComputedStyle(element).paddingBottom) > 0), true,
      "A separated frame retains its existing outside spacing");
    await page.locator(".workspace-panes").evaluate(element => element.classList.add("workspace-panes--merged"));
  }
}));

test("mounted lens frames keep their body spinner while the first data read waits", () => fixture("slow-reader", async page => {
  await page.waitForFunction(() => workspaceStartupFixture.state().requests.some(request => request.account === "account-b"));
  const pane = page.locator('[data-workspace-lens="saved-lens-b"]');
  await pane.locator('.workspace-pane__body [role="status"][aria-label="Loading"]').waitFor();
  await captureLoadingRegression(page, "mounted-reader-pending");
  assert.equal(await pane.locator(".workspace-pane__header").isVisible(), true);
  assert.equal(await page.locator(".workspace-startup__card,.workspace-load-overlay").count(), 0,
    "A mounted lens already provides the page structure, so its data wait stays in the lens body");
  await page.evaluate(() => workspaceStartupFixture.releaseReads());
  await page.getByText("Saved B data", { exact: true }).waitFor();
  assert.equal(await pane.locator('.workspace-pane__body [role="status"][aria-label="Loading"]').count(), 0);
}));

test("the shell fold stays at the right while a lens reader prepares", () => fixture("slow-reader", async page => {
  const brand = page.getByRole("link", { name: "Fenel home", exact: true });
  const fold = page.getByRole("button", { name: "Hide the top bar", exact: true });
  assert.equal(await fold.count(), 1);
  const initial = await brand.boundingBox();
  await page.waitForFunction(() => workspaceStartupFixture.state().requests.some(request => request.account === "account-b"));
  assert.equal(await page.locator('.workspace-data-controls').count(), 0,
    'A single docked lens suppresses duplicate global data actions even while its reader prepares');
  const pending = await brand.boundingBox();
  await page.evaluate(() => workspaceStartupFixture.releaseReads());
  await page.getByText("Saved B data", { exact: true }).waitFor();
  const ready = await brand.boundingBox();
  assert.equal(await fold.count(), 1);
  assert.equal(await page.getByRole("button", { name: "Toggle navigation", exact: true }).count(), 0);
  assert.ok(Math.abs(initial!.x - pending!.x) < 1 && Math.abs(initial!.x - ready!.x) < 1,
    "Preparing the reader does not insert controls before the logo");
  assert.equal(await page.locator('.workspace-data-controls').count(), 0);
  const lensesBox = await page.getByRole('button', { name: 'Lenses', exact: true }).boundingBox();
  assert.ok(lensesBox!.x > 500, 'Top-level Lenses stays on the right when duplicate data actions are suppressed');
  const lensFold = page.getByRole('button', { name: 'Compact lens header', exact: true });
  const pane = page.locator('[data-workspace-lens="saved-lens-b"]');
  const shellFoldBox = await fold.boundingBox();
  const lensFoldBox = await lensFold.boundingBox();
  const shellActionsBox = await page.locator('.topbar__actions').boundingBox();
  assert.ok(shellFoldBox!.x >= shellActionsBox!.x + shellActionsBox!.width, 'The shell fold follows the account actions');
  const lensFloatBox = await pane.getByRole('button', { name: 'Float lens', exact: true }).boundingBox();
  const lensCloseBox = await pane.getByRole('button', { name: 'Close lens', exact: true }).boundingBox();
  assert.ok(lensFoldBox!.x + lensFoldBox!.width <= lensFloatBox!.x
    && lensFloatBox!.x + lensFloatBox!.width <= lensCloseBox!.x, 'The lens fold and placement precede Close on the right');
}));

for (const arrangement of ["docked", "floating", "multiple", "hidden"]) {
  test(`global Browse/New follows the visible ${arrangement} lens arrangement`, () => fixture(`toolbar-controls-${arrangement}`, async (page, messages) => {
    await page.emulateMedia({ reducedMotion: "reduce" });
    const pane = page.locator('[data-workspace-lens="saved-lens-b"]');
    await pane.getByText("Saved B data", { exact: true }).waitFor();
    const before = process.env["FENEL_TOOLBAR_CONTROLS_BEFORE"] === "1";
    const globalCount = before || arrangement === "floating" || arrangement === "multiple" ? 1 : 0;
    const assertControls = async () => {
      for (const label of ["Browse", "New data"]) {
        assert.equal(await page.locator(".topbar").getByRole("button", { name: label, exact: true }).count(), globalCount);
        assert.equal(await (label === "Browse" ? pane.getByRole("button", { name: label, exact: true })
          : pane.locator(".home-new-button")).isVisible(), true,
          "The lens retains its own data actions");
      }
    };
    assert.equal((await page.evaluate(() => workspaceStartupFixture.state())).modelReleased, false);
    await assertControls();
    if (arrangement === "hidden") {
      assert.equal((await page.evaluate(() => workspaceStartupFixture.state())).preferences.lenses.length, 2);
      assert.equal(await page.locator(".workspace-pane").count(), 1,
        "Saved hidden lenses do not make the on-screen controls redundant");
    }
    const directory = process.env["FENEL_TOOLBAR_CONTROLS_CAPTURE_DIR"];
    for (const width of [1024, 390, 320]) {
      await page.setViewportSize({ width, height: width === 1024 ? 768 : 844 });
      await assertControls();
      if (!before && (arrangement === "docked" || arrangement === "hidden")) {
        const geometry = await pane.locator(".home-toolbar").evaluate(element => {
          const toolbar = element.getBoundingClientRect();
          const buttons = [...element.querySelectorAll<HTMLElement>(".home-action-button")].map(button => {
            const bounds = button.getBoundingClientRect();
            return { left: bounds.left, right: bounds.right, top: bounds.top, bottom: bounds.bottom, width: bounds.width };
          });
          return { toolbar: { left: toolbar.left, right: toolbar.right, top: toolbar.top, bottom: toolbar.bottom }, buttons };
        });
        assert.equal(geometry.buttons.length, 2);
        assert.ok(geometry.buttons.every(button => button.width > 0 && button.left >= geometry.toolbar.left - 1
          && button.right <= geometry.toolbar.right + 1 && button.left >= 0 && button.right <= width
          && button.top >= geometry.toolbar.top - 1 && button.bottom <= geometry.toolbar.bottom + 1),
          `Lens data actions stay within the visible toolbar at ${width}px: ${JSON.stringify(geometry)}`);
        if (width <= 390) {
          const start = geometry.buttons.map(button => button.left);
          await pane.locator(".locus-crumbs").evaluate(element => { element.scrollLeft = element.scrollWidth; });
          const shifted = await pane.locator(".home-toolbar .home-action-button").evaluateAll(elements => elements.map(element => element.getBoundingClientRect().left));
          assert.deepEqual(shifted, start, "Scrolling the lens path leaves its data actions in place");
          await pane.locator(".locus-crumbs").evaluate(element => { element.scrollLeft = 0; });
        }
      }
      if (arrangement === "docked" || arrangement === "hidden") {
        const lenses = await page.locator(".topbar").getByRole("button", { name: "Lenses", exact: true }).boundingBox();
        assert.ok(lenses!.x > width / 2, "Remaining global controls keep their position on the right");
      }
      if (directory) {
        await mkdir(directory, { recursive: true });
        await page.screenshot({ path: join(directory, `toolbar-controls-${arrangement}-${width}.png`) });
      }
    }
    await page.evaluate(() => workspaceStartupFixture.releaseModel());
    await pane.getByRole("button", { name: arrangement === "floating" ? "Dock lens" : "Float lens", exact: true }).waitFor();
    await assertControls();
    if (arrangement === "docked" && !before) {
      await page.setViewportSize({ width: 1024, height: 768 });
      await pane.getByRole("button", { name: "Float lens", exact: true }).click();
      await page.locator(".topbar").getByRole("button", { name: "Browse", exact: true }).waitFor();
      await pane.getByRole("button", { name: "Dock lens", exact: true }).click();
      await page.locator(".topbar").getByRole("button", { name: "Browse", exact: true }).waitFor({ state: "detached" });
      await assertControls();
    }
    if (process.env["FENEL_TOOLBAR_CONTROLS_DEBUG_WARNINGS"] === "1") {
      console.log("Toolbar control diagnostics", JSON.stringify({ arrangement, messages }));
    }
  }));
}

test("trailing bar controls follow DOM and keyboard order at phone and desktop widths", () => fixture("lens-controls", async page => {
  await page.emulateMedia({ reducedMotion: "reduce" });
  const pane = page.locator('[data-workspace-lens="saved-lens-b"]');
  await pane.getByText("Saved B data", { exact: true }).waitFor();
  await page.evaluate(() => workspaceStartupFixture.releaseModel());
  await pane.getByRole("button", { name: "Dock lens", exact: true }).click();
  await pane.getByRole("button", { name: "Float lens", exact: true }).waitFor();
  const before = process.env["FENEL_RIGHT_CONTROLS_BEFORE"] === "1";
  const capture = async (width: number, mode: string) => {
    const directory = process.env["FENEL_RIGHT_CONTROLS_CAPTURE_DIR"];
    if (!directory) return;
    await mkdir(directory, { recursive: true });
    await page.screenshot({ path: join(directory, `right-controls-${width}-${mode}.png`) });
    if (mode === "expanded" || mode === "compact") {
      await page.locator(".topbar").screenshot({ path: join(directory, `right-controls-${width}-${mode}-global-bar.png`) });
      await pane.locator(".workspace-pane__header").screenshot({ path: join(directory, `right-controls-${width}-${mode}-lens-header.png`) });
    }
  };
  for (const width of [1024, 390, 320]) {
    await page.setViewportSize({ width, height: width === 1024 ? 768 : 844 });
    const bar = page.locator(".topbar");
    const fold = bar.getByRole("button", { name: "Hide the top bar", exact: true });
    if (!before) {
      const order = await bar.evaluate(element => {
        const controls = [...element.querySelectorAll<HTMLElement>("a, button")].filter(control => {
          const box = control.getBoundingClientRect();
          return box.width > 0 && box.height > 0 && !(control instanceof HTMLButtonElement && control.disabled);
        });
        const box = element.getBoundingClientRect();
        return { final: controls.at(-1)?.getAttribute("aria-label"), count: controls.length,
          ordered: controls.every((control, index) => index === 0 || control.getBoundingClientRect().left >= controls[index - 1]!.getBoundingClientRect().right - 1),
          contained: controls.every(control => {
            const rect = control.getBoundingClientRect();
            return rect.left >= box.left && rect.right <= box.right && rect.top >= box.top && rect.bottom <= box.bottom;
          }) };
      });
      assert.equal(order.final, "Hide the top bar");
      assert.equal(order.ordered, true, `Global DOM order follows visual order at ${width}px`);
      assert.equal(order.contained, true, `Global controls fit at ${width}px`);
      await bar.getByRole("link", { name: "Fenel home", exact: true }).focus();
      for (let index = 1; index < order.count; index++) {
        await page.keyboard.press("Tab");
        assert.equal(await bar.evaluate(element => [...element.querySelectorAll<HTMLElement>("a, button")]
          .filter(control => {
            const box = control.getBoundingClientRect();
            return box.width > 0 && box.height > 0 && !(control instanceof HTMLButtonElement && control.disabled);
          }).indexOf(document.activeElement as HTMLElement)), index, `Global keyboard order at ${width}px`);
      }
    }
    for (const mode of ["expanded", "compact", "hidden"] as const) {
      if (mode === "compact") await pane.getByRole("button", { name: "Compact lens header", exact: true }).click();
      if (mode === "hidden") await pane.getByRole("button", { name: "Hide lens controls", exact: true }).click();
      await capture(width, mode);
      if (before) continue;
      const header = pane.locator(".workspace-pane__header");
      assert.equal(await header.getAttribute("inert") !== null, mode === "hidden");
      if (mode === "hidden") {
        assert.equal(await pane.getByRole("button", { name: "Show lens controls", exact: true }).evaluate(control => {
          const lens = control.closest(".workspace-pane")!.getBoundingClientRect();
          const box = control.getBoundingClientRect();
          return box.right <= lens.right && lens.right - box.right <= 8;
        }), true, `Lens restore stays at the right at ${width}px`);
      } else {
        const labels = mode === "expanded" ? ["Compact lens header", "Float lens", "Close lens"]
          : ["Expand lens header", "Hide lens controls", "Float lens", "Close lens"];
        const geometry = await header.evaluate(element => {
          const controls = [...element.querySelectorAll<HTMLButtonElement>(".workspace-pane__fold, .workspace-pane__float, .workspace-pane__close")];
          const header = element.getBoundingClientRect();
          return { labels: controls.map(control => control.getAttribute("aria-label")),
            ordered: controls.every((control, index) => index === 0 || control.getBoundingClientRect().left >= controls[index - 1]!.getBoundingClientRect().right),
            contained: controls.every(control => {
              const box = control.getBoundingClientRect();
              return box.left >= header.left && box.right <= header.right && box.top >= header.top && box.bottom <= header.bottom
                && control.contains(document.elementFromPoint(box.x + box.width / 2, box.y + box.height / 2));
            }), final: element.lastElementChild?.getAttribute("aria-label") };
        });
        assert.deepEqual(geometry.labels, labels);
        assert.equal(geometry.ordered, true, `${mode} lens DOM order follows visual order at ${width}px`);
        assert.equal(geometry.contained, true, `${mode} trailing lens controls remain reachable at ${width}px`);
        assert.equal(geometry.final, "Close lens");
        await pane.getByRole("button", { name: labels[0]!, exact: true }).focus();
        for (const label of labels.slice(1)) {
          await page.keyboard.press("Tab");
          assert.equal(await page.evaluate(() => document.activeElement?.getAttribute("aria-label")), label,
            `${mode} lens keyboard order at ${width}px`);
        }
      }
    }
    await pane.getByRole("button", { name: "Show lens controls", exact: true }).click();
    await pane.getByRole("button", { name: "Expand lens header", exact: true }).click();
    await fold.click();
    const restore = page.getByRole("button", { name: "Show the top bar", exact: true });
    if (!before) assert.equal(await restore.evaluate(control => control.getBoundingClientRect().right === innerWidth), true);
    await capture(width, "global-hidden");
    await restore.click();
    await fold.waitFor({ state: "visible" });
    if (!before) assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true);
  }
}));

test("account replacement cancels B's held read and cannot display its late response", () => fixture("slow-reader", async page => {
  await page.emulateMedia({ reducedMotion: "reduce" });
  await page.waitForFunction(() => workspaceStartupFixture.state().requests.some(request => request.account === "account-b"));
  const pending = page.locator('[data-workspace-lens="saved-lens-b"]');
  await pending.locator(".lens-data-summary--pending").waitFor();
  assert.equal(await pending.locator(".lens-data-summary").getAttribute("aria-busy"), "true");
  assert.equal(await pending.locator(".lens-data-summary .home-item__type-tag--reserved").isVisible(), true,
    "The account type is visibly pending instead of an empty control");
  const loadingGeometry = await pending.locator(".workspace-pane__body").evaluate(body => {
    const spinner = body.querySelector('.workspace-pane__wait .home-new-button__spinner')!;
    const bounds = body.getBoundingClientRect();
    const indicator = spinner.getBoundingClientRect();
    return { width: indicator.width, height: indicator.height,
      dx: Math.abs(indicator.left + indicator.width / 2 - bounds.left - bounds.width / 2),
      dy: Math.abs(indicator.top + indicator.height / 2 - bounds.top - bounds.height / 2),
      wash: getComputedStyle(body, "::before").backgroundColor };
  });
  assert.ok(loadingGeometry.width >= 32 && loadingGeometry.height >= 32, "Loading has a clearly visible indicator");
  assert.ok(loadingGeometry.dx <= 2 && loadingGeometry.dy <= 2,
    `Loading is centered in the whole lens body: ${JSON.stringify(loadingGeometry)}`);
  assert.equal(loadingGeometry.wash, "rgba(255, 255, 255, 0.62)");
  await page.evaluate(() => workspaceStartupFixture.switchAccount());
  await page.getByText("Account C data", { exact: true }).waitFor();
  await page.evaluate(() => workspaceStartupFixture.releaseReads());
  const state = await page.evaluate(() => workspaceStartupFixture.state());
  assert.deepEqual(dataReads(state.requests).map(request => request.account), ["account-b", "account-c"]);
  assert.equal(state.requests.find(request => request.account === "account-b")?.aborted, true);
  assert.equal(await page.getByText("Saved B data", { exact: true }).count(), 0);
  assert.equal(await page.locator('[data-workspace-lens="saved-lens-b"]').count(), 0);
  assert.equal(await page.locator('[data-workspace-lens="lens-c"]').count(), 1);
}));
