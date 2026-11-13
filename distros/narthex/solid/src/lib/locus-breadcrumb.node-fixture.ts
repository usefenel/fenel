import { after, before, test } from "node:test";
import { strict as assert } from "node:assert";
import { readFile } from "node:fs/promises";
import { chromium, type Browser, type Page } from "playwright";
import type {} from "./locus-breadcrumb.fixture";

let browser: Browser;
let script: string;
let css: string;
before(async () => {
  [script, css] = await Promise.all([readFile(process.argv[2]!, "utf8"), readFile(process.argv[3]!, "utf8")]);
  browser = await chromium.launch({ headless: true, timeout: 30_000, channel: process.env["FENEL_TEST_BROWSER_CHANNEL"] });
});
after(async () => { await browser?.close(); });

async function fixture(run: (page: Page) => Promise<void>, query = "") {
  const page = await browser.newPage({ viewport: { width: 1024, height: 768 } });
  page.setDefaultTimeout(10_000);
  const errors: string[] = [];
  page.on("pageerror", error => errors.push(error.message));
  try {
    await page.route("**/*", route => route.fulfill({ body: "<html><body></body></html>", contentType: "text/html" }));
    await page.goto(`https://fenel.test/${query}`);
    await page.addStyleTag({ content: css });
    await page.addScriptTag({ content: script, type: "module" });
    await page.waitForFunction(() => !!globalThis.locusBreadcrumbFixture);
    await run(page);
    assert.deepEqual(errors, []);
  } finally { await page.close(); }
}

test("a narrow lens reads account, path, current data and opens the complete path in a modal", () => fixture(async page => {
  await page.getByRole("button", { name: "Show full data path", exact: true }).waitFor();
  const bounds = await page.locator("[data-breadcrumb-host]").evaluate(host => {
    const nav = host.querySelector("nav")!;
    const current = nav.querySelector(".locus-crumbs__current")!;
    const path = nav.querySelector(".locus-crumbs__path")!;
    return { host: host.getBoundingClientRect().toJSON(), nav: nav.getBoundingClientRect().toJSON(),
      current: current.getBoundingClientRect().toJSON(), path: path.getBoundingClientRect().toJSON() };
  });
  assert.ok(bounds.nav.right <= bounds.host.right + 1);
  assert.ok(bounds.current.left >= bounds.path.right - 1);
  assert.equal(await page.locator('[aria-current="page"]').innerText(), "Final data");
  assert.equal(await page.locator('.locus-crumbs__subject [aria-current="page"] svg').count(), 1,
    "A missing data mark uses its type mark in the path");
  assert.equal(await page.locator('.locus-crumbs__type svg').count(), 1);
  await page.evaluate(() => locusBreadcrumbFixture.setIcon("user"));
  assert.equal(await page.locator('.locus-crumbs__subject [aria-current="page"] svg').count(), 1);
  assert.equal(await page.locator('.locus-crumbs__type svg').count(), 1,
    "An explicit data icon does not replace the separate type icon");
  await page.getByRole("button", { name: "Show full data path", exact: true }).click();
  const dialog = page.getByRole("dialog", { name: "Data path", exact: true });
  await dialog.waitFor();
  assert.deepEqual(await dialog.locator("ol button").allTextContents(), ["All data", "Projects collection", "Project overview",
    "An intermediate field with a long descriptive name", "Another containing record", "Final data"]);
  assert.equal(await dialog.evaluate(element => (element as HTMLDialogElement).matches(":modal")), true);
  await page.keyboard.press("Escape");
  await dialog.waitFor({ state: "detached" });
  assert.equal(await page.evaluate(() => document.activeElement?.getAttribute("aria-label")), "Show full data path");
  await page.evaluate(() => { locusBreadcrumbFixture.setIcon(undefined); locusBreadcrumbFixture.setScopedThumbnails(true); locusBreadcrumbFixture.setWidth(1400); });
  await page.waitForFunction(() => !!document.querySelector('.locus-crumbs__current [data-reader-thumbnail="field"]'));
  assert.equal(await page.locator('.locus-crumbs__trail [data-reader-thumbnail="image"]').count(), 1,
    "An enclosing data value retains the reader's media thumbnail");
  assert.equal(await page.locator('.locus-crumbs__trail [data-reader-thumbnail="field"]').count(), 2,
    "Each enclosing field gets the reader's field occurrence mark");
  assert.equal(await page.locator('.locus-crumbs__current [data-reader-thumbnail="field"]').count(), 1);
  assert.equal(await page.locator('.locus-crumbs__current [data-thumbnail-icon]').getAttribute("data-thumbnail-icon"), "mail",
    "The shared thumbnail uses the field occurrence before the type fallback");
  await page.evaluate(() => locusBreadcrumbFixture.setIcon("not-an-installed-icon"));
  await page.waitForFunction(() => document.querySelector('.locus-crumbs__current [data-thumbnail-icon]')?.getAttribute('data-thumbnail-icon') === 'stack');
  assert.equal(await page.locator('.locus-crumbs__current [data-thumbnail-icon]').getAttribute("data-thumbnail-icon"), "stack",
    "An unavailable occurrence mark uses the shared type icon fallback");
  assert.equal(await page.locator('.locus-crumbs__account-button').evaluate(element => getComputedStyle(element).borderTopColor), "rgba(0, 0, 0, 0)",
    "The leading link reserves an invisible badge border until hover");
  await page.evaluate(() => locusBreadcrumbFixture.setScope({ kind: "value", viewId: "projects", itemId: "project-one", path: [] }));
  assert.equal(await page.locator('.locus-crumbs__current canvas').count(), 1,
    "The current image uses the same real media thumbnail as its enclosing path step");
  assert.equal(await page.locator('.locus-crumbs__current [data-thumbnail-icon]').count(), 0,
    "Media takes precedence over the value and type icons");
}));

test("clicking an ancestor in the path modal navigates this lens to that exact scope", () => fixture(async page => {
  await page.getByRole("button", { name: "Show full data path", exact: true }).click();
  await page.getByRole("dialog", { name: "Data path", exact: true }).getByRole("button", { name: "Project overview", exact: true }).click();
  await page.getByRole("dialog", { name: "Data path", exact: true }).waitFor({ state: "detached" });
  assert.deepEqual(await page.evaluate(() => locusBreadcrumbFixture.navigation), [{ kind: "value", viewId: "projects", itemId: "project-one", path: [] }]);
  assert.equal(await page.locator('[aria-current="page"]').innerText(), "Project overview");
}));

test("right-clicking a modal ancestor exposes usable Open and Open in a new lens actions", () => fixture(async page => {
  // Repeat the modal -> menu focus handoff; an outside-focus listener used
  // to race the modal's restoration and dismiss the freshly opened menu.
  for (let attempt = 0; attempt < 3; attempt++) {
    await page.getByRole("button", { name: "Show full data path", exact: true }).click();
    await page.getByRole("dialog", { name: "Data path", exact: true }).getByRole("button", { name: "Projects collection", exact: true }).click({ button: "right" });
    const menu = page.getByRole("menu", { name: "Data path actions", exact: true });
    await menu.waitFor();
    await menu.getByRole("menuitem", { name: "Open", exact: true }).waitFor();
    await menu.getByRole("menuitem", { name: "Open in a new lens", exact: true }).click();
  }
  assert.deepEqual(await page.evaluate(() => locusBreadcrumbFixture.opened), Array.from({ length: 3 }, () => ({ kind: "view", viewId: "projects" })));
  assert.deepEqual(await page.evaluate(() => locusBreadcrumbFixture.navigation), []);
  assert.equal(await page.locator('[aria-current="page"]').innerText(), "Final data");
}));

test("resizing a lens restores an inline path without changing the current data", () => fixture(async page => {
  await page.evaluate(() => { locusBreadcrumbFixture.setScope({ kind: "value", viewId: "projects", itemId: "project-one", path: [] }); locusBreadcrumbFixture.setWidth(230); });
  await page.getByRole("button", { name: "Show full data path", exact: true }).waitFor();
  await page.evaluate(() => locusBreadcrumbFixture.setWidth(900));
  await page.getByRole("button", { name: "Show full data path", exact: true }).waitFor({ state: "detached" });
  await page.getByRole("navigation", { name: "Where you are", exact: true }).getByRole("button", { name: "Shared account", exact: true }).click();
  assert.deepEqual(await page.evaluate(() => locusBreadcrumbFixture.navigation), [{ kind: "root" }]);
}));

test("renaming an ancestor rechecks overflow even when the lens scope does not change", () => fixture(async page => {
  await page.evaluate(() => {
    locusBreadcrumbFixture.setScope({ kind: "value", viewId: "projects", itemId: "project-one", path: [] });
    locusBreadcrumbFixture.setWidth(900);
  });
  await page.getByRole("button", { name: "Show full data path", exact: true }).waitFor({ state: "detached" });
  await page.evaluate(() => locusBreadcrumbFixture.setViewLabel("A renamed collection with a much longer descriptive name ".repeat(8)));
  await page.getByRole("button", { name: "Show full data path", exact: true }).waitFor();
  assert.equal(await page.locator('[aria-current="page"]').innerText(), "Project overview");
}));

test("a phone nested path keeps its account and up button separate from the actions", () => fixture(async page => {
  await page.setViewportSize({ width: 390, height: 844 });
  const nav = page.getByRole("navigation", { name: "Where you are", exact: true });
  const account = nav.locator(".account-data-selector .locus-select__value");
  await account.waitFor();
  assert.equal(await account.innerText(), "bayneframe");
  assert.equal(await account.evaluate(element => element.clientWidth >= element.scrollWidth), true);
  const up = await nav.getByRole("button", { name: "Go up", exact: true }).boundingBox();
  const bounds = await nav.boundingBox();
  const browse = await page.getByRole("button", { name: "Browse", exact: true }).boundingBox();
  const header = await page.locator(".workspace-pane__header").boundingBox();
  assert.ok(up && bounds && browse);
  assert.ok(up.x + up.width <= bounds.x + bounds.width + 1);
  assert.ok(browse.x >= bounds.x + bounds.width - 1,
    "A narrow lens keeps its actions beside the collapsed path on the shared toolbar row");
  assert.ok(header && browse.y + browse.height <= header.y + header.height + 1);
  assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true);
  // The narrow path is one button: the current data's whole mark and a
  // readable name, no separators or "…" beside it, the full path behind it.
  assert.equal(await nav.locator(".locus-crumbs__path, .locus-crumbs__subject, .locus-crumbs__sep").evaluateAll(elements =>
    elements.every(element => getComputedStyle(element).display === "none")), true);
  const path = nav.locator(".locus-crumbs__compact");
  assert.match(await path.getAttribute("aria-label") ?? "", /^Path: .+ > .+ > Final data$/);
  assert.equal(await path.getAttribute("data-tooltip"), await path.getAttribute("aria-label"));
  assert.equal(await path.getAttribute("aria-haspopup"), "dialog");
  const parts = await path.evaluate(button => {
    const box = button.getBoundingClientRect();
    const icon = button.querySelector(".locus-crumbs__thumbnail")!.getBoundingClientRect();
    const name = button.querySelector(".locus-crumbs__compact-name")!;
    return { left: box.left, right: box.right, iconLeft: icon.left, iconRight: icon.right, iconWidth: icon.width,
      nameWidth: name.getBoundingClientRect().width, text: name.textContent };
  });
  assert.equal(parts.text, "Final data");
  assert.ok(parts.iconWidth >= 15 && parts.iconLeft >= parts.left && parts.iconRight <= parts.right, JSON.stringify(parts));
  assert.ok(parts.nameWidth >= 30, JSON.stringify(parts));
  await path.click();
  const dialog = page.getByRole("dialog", { name: "Data path", exact: true });
  await dialog.waitFor();
  assert.equal(await path.getAttribute("aria-expanded"), "true");
  assert.equal(await dialog.locator('ol button[aria-current="location"]').innerText(), "Final data");
  assert.equal(await dialog.locator("ol button").last().getAttribute("aria-current"), "location");
  await page.keyboard.press("Escape");
  await dialog.waitFor({ state: "detached" });
}, "?toolbar=two&nested=1"));

for (const mode of ["one", "two"]) test(`a 390px ${mode === "one" ? "top bar" : "tiled lens"} keeps the data name and controls visible without overlap`, () => fixture(async page => {
  await page.setViewportSize({ width: 390, height: 844 });
  const toolbar = page.locator(".home-toolbar");
  const name = toolbar.locator(".account-data-selector .locus-select__value");
  await page.waitForFunction(() => document.querySelector(".account-data-selector .locus-select__value")!.clientWidth > 0);
  assert.equal(await name.innerText(), "bayneframe");
  const readable = await name.evaluate(element => ({ visible: element.clientWidth, contents: element.scrollWidth,
    overflow: getComputedStyle(element).textOverflow }));
  assert.ok(readable.visible >= 40, "The source keeps visible text on the compact toolbar");
  if (readable.contents > readable.visible) assert.equal(readable.overflow, "ellipsis");
  const boxes = await toolbar.evaluate(element => [...element.children].map(child => child.getBoundingClientRect()).filter(rect => rect.width > 0)
    .map(rect => ({ left: rect.left, right: rect.right, top: rect.top, bottom: rect.bottom })));
  for (let index = 1; index < boxes.length; index++) assert.ok(boxes[index]!.left >= boxes[index - 1]!.right - 1, JSON.stringify(boxes));
  assert.ok(boxes.at(-1)!.right <= 390);
  await toolbar.getByRole("button", { name: "Browse", exact: true }).click();
  await toolbar.getByRole("button", { name: "+ New", exact: true }).click();
  await toolbar.getByRole("button", { name: "Representation: Grid", exact: true }).click();
  await page.getByRole("menu", { name: "Representation", exact: true }).waitFor();
  await page.getByRole("menuitemradio", { name: "List", exact: true }).click();
}, `?toolbar=${mode}`));
