import { after, before, test } from "node:test";
import { strict as assert } from "node:assert";
import { readFile } from "node:fs/promises";
import { chromium, type Browser, type Page } from "playwright";
import type {} from "./locus-browse.fixture";

let browser: Browser;
let script: string;
let css: string;
before(async () => {
  [script, css] = await Promise.all([readFile(process.argv[2]!, "utf8"), readFile(process.argv[3]!, "utf8")]);
  browser = await chromium.launch({ headless: true, timeout: 30_000, channel: process.env["FENEL_TEST_BROWSER_CHANNEL"] });
});
after(async () => { await browser?.close(); });

async function fixture(run: (page: Page) => Promise<void>, delayed = false) {
  const page = await browser.newPage({ viewport: { width: 640, height: 480 } });
  page.setDefaultTimeout(10_000);
  const errors: string[] = [];
  page.on("pageerror", error => errors.push(error.message));
  try {
    await page.route("**/*", route => route.fulfill({ body: "<html><body></body></html>", contentType: "text/html" }));
    await page.goto(`https://fenel.test/${delayed ? "?delayed=1" : ""}`);
    await page.addStyleTag({ content: css });
    await page.addScriptTag({ content: script, type: "module" });
    await page.waitForFunction(() => typeof locusBrowseFixture !== "undefined");
    await run(page);
    assert.deepEqual(errors, []);
  } catch (error) {
    console.error("Browse fixture failure", JSON.stringify({ errors, query: await page.evaluate(() => locusBrowseFixture.query()), text: await page.locator("body").innerText() }));
    throw error;
  } finally { await page.close(); }
}
const search = (page: Page) => page.getByRole("combobox");
const names = (page: Page) => page.locator(".home-drawer__item-name").allTextContents();
const activeName = (page: Page) => page.getByRole("option", { selected: true }).locator(".home-drawer__item-name").innerText();

test("pending rows keep the panel chrome focused, editable and closable", () => fixture(async page => {
  await page.getByRole("complementary", { name: "Browse and search" }).waitFor();
  assert.equal(await search(page).getAttribute("aria-controls"), "locus-browse-results");
  assert.equal(await search(page).evaluate(input => input === document.activeElement), true);
  await page.getByText("Reading data…", { exact: true }).waitFor();
  await search(page).fill("waiting");
  assert.equal(await page.evaluate(() => locusBrowseFixture.query()), "waiting");
  await page.keyboard.press("Escape");
  await page.getByRole("complementary").waitFor({ state: "detached" });
  assert.deepEqual(await page.evaluate(() => ({ events: locusBrowseFixture.events, closed: locusBrowseFixture.closed() })), { events: [], closed: 1 });
}, true));

test("keyboard navigation crosses groups, skips disabled suggestions, wraps and keeps focus", () => fixture(async page => {
  await page.getByRole("option", { name: "Incomplete date detail", exact: false }).waitFor();
  assert.equal(await activeName(page), "Saved Alpha");
  await page.keyboard.press("ArrowDown");
  assert.equal(await activeName(page), "Saved Beta");
  await page.keyboard.press("ArrowDown");
  assert.equal(await activeName(page), "Echo function");
  await page.keyboard.press("ArrowDown");
  assert.equal(await activeName(page), "Saved Alpha");
  await page.keyboard.press("ArrowUp");
  assert.equal(await activeName(page), "Echo function");
  const activeId = await search(page).getAttribute("aria-activedescendant");
  assert.equal(await page.getByRole("option", { selected: true }).getAttribute("id"), activeId);
  assert.equal(await search(page).evaluate(input => input === document.activeElement), true);
  await page.keyboard.press("Enter");
  assert.deepEqual(await page.evaluate(() => locusBrowseFixture.events), [{ action: "pick", id: "echo" }]);
}));

test("a changed query resets the highlight and Enter takes only a currently visible row", () => fixture(async page => {
  await page.keyboard.press("ArrowDown");
  assert.equal(await activeName(page), "Saved Beta");
  await search(page).fill("alpha");
  await page.waitForFunction(() => document.querySelectorAll('[role="option"]').length === 1);
  assert.deepEqual(await names(page), ["Saved Alpha"]);
  assert.equal(await search(page).getAttribute("aria-activedescendant"), null);
  await page.keyboard.press("Enter");
  await search(page).fill("no such row");
  await page.waitForFunction(() => document.querySelectorAll('[role="option"]').length === 0);
  await page.keyboard.press("Enter");
  assert.deepEqual(await page.evaluate(() => locusBrowseFixture.events), [{ action: "pick", id: "alpha" }]);
  await search(page).fill("");
  await page.waitForFunction(() => document.querySelectorAll('[role="option"]').length === 4);
}));

test("primary selection, secondary opening and pending feedback remain distinct", () => fixture(async page => {
  await page.getByRole("option").filter({ hasText: "Incomplete date" }).dispatchEvent("click");
  assert.deepEqual(await page.evaluate(() => locusBrowseFixture.events), []);
  await page.getByRole("button", { name: "Open Saved Beta", exact: true }).click();
  await search(page).focus();
  await search(page).fill("alpha");
  await page.keyboard.press("Control+Enter");
  await page.keyboard.press("Meta+Enter");
  await page.keyboard.press("Enter");
  assert.deepEqual(await page.evaluate(() => locusBrowseFixture.events), [
    { action: "open", id: "beta" }, { action: "open", id: "alpha" },
    { action: "open", id: "alpha" }, { action: "pick", id: "alpha" },
  ]);
  await page.evaluate(() => locusBrowseFixture.picking(true));
  await page.getByRole("status").waitFor();
  assert.match(await page.getByRole("status").innerText(), /Adding it/);
  await page.evaluate(() => locusBrowseFixture.picking(false));
  await page.getByRole("status").waitFor({ state: "detached" });
}));

test("dragging a saved row carries its identity and label without selecting it", () => fixture(async page => {
  const alpha = page.getByRole("option").filter({ hasText: "Saved Alpha" });
  assert.equal(await alpha.getAttribute("draggable"), "true");
  const result = await alpha.evaluate(element => {
    const transfer = new DataTransfer();
    const event = new DragEvent("dragstart", { bubbles: true, cancelable: true, dataTransfer: transfer });
    element.dispatchEvent(event);
    return { id: transfer.getData("application/x-fenel-savedexpr-id"), label: transfer.getData("application/x-fenel-savedexpr-name") };
  });
  assert.deepEqual(result, { id: "alpha", label: "Saved Alpha" });
  assert.deepEqual(await page.evaluate(() => locusBrowseFixture.events), []);
  const disabled = page.getByRole("option").filter({ hasText: "Incomplete date" });
  assert.equal(await disabled.getAttribute("draggable"), "false");
  assert.equal(await disabled.evaluate(element => !element.dispatchEvent(new DragEvent("dragstart", { bubbles: true, cancelable: true, dataTransfer: new DataTransfer() }))), true);
}));

test("a later asynchronous query wins when an older response arrives afterward", () => fixture(async page => {
  await search(page).fill("old");
  await search(page).fill("new");
  await page.evaluate(() => locusBrowseFixture.release("new", ["new"]));
  await page.getByRole("option").filter({ hasText: "Result new" }).waitFor();
  await page.evaluate(() => locusBrowseFixture.release("old", ["old"]));
  assert.deepEqual(await names(page), ["Result new"]);
  await page.keyboard.press("Enter");
  assert.deepEqual(await page.evaluate(() => locusBrowseFixture.events), [{ action: "pick", id: "new" }]);
}, true));

test("replacing the data snapshot drops stale active descendants and keyboard targets", () => fixture(async page => {
  await page.keyboard.press("ArrowDown");
  assert.equal(await activeName(page), "Saved Beta");
  await page.evaluate(() => locusBrowseFixture.replace(["gamma", "delta"]));
  await page.getByRole("option").filter({ hasText: "Saved gamma" }).waitFor();
  if (process.env["FENEL_BROWSE_SCREENSHOT_DIR"]) await page.screenshot({ path: `${process.env["FENEL_BROWSE_SCREENSHOT_DIR"]}/snapshot-replacement.png` });
  const activeId = await search(page).getAttribute("aria-activedescendant");
  assert.equal(activeId === null || await page.locator('[role="option"]').evaluateAll((options, id) => options.some(option => option.id === id), activeId), true,
    "The combobox cannot point to an option from a replaced reader snapshot");
  assert.equal(await activeName(page), "Saved gamma");
  await page.keyboard.press("Enter");
  assert.deepEqual(await page.evaluate(() => locusBrowseFixture.events), [{ action: "pick", id: "gamma" }]);
}));

test("a pending query cannot select rows that answered an earlier query", () => fixture(async page => {
  await page.evaluate(() => locusBrowseFixture.delayed());
  await search(page).fill("waiting");
  if (process.env["FENEL_BROWSE_SCREENSHOT_DIR"]) await page.screenshot({ path: `${process.env["FENEL_BROWSE_SCREENSHOT_DIR"]}/pending-query.png` });
  await page.keyboard.press("Enter");
  assert.deepEqual(await page.evaluate(() => locusBrowseFixture.events), [], "Pending results cannot retain the keyboard targets of the earlier query");
  await page.evaluate(() => locusBrowseFixture.release("waiting", ["waiting"]));
  await page.getByRole("option").filter({ hasText: "Result waiting" }).waitFor();
  await page.keyboard.press("Enter");
  assert.deepEqual(await page.evaluate(() => locusBrowseFixture.events), [{ action: "pick", id: "waiting" }]);
}));

test("a pending replacement at the same query hides old pointer, drag and keyboard targets", () => fixture(async page => {
  await page.getByRole("option").filter({ hasText: "Saved Alpha" }).waitFor();
  await page.evaluate(() => locusBrowseFixture.replaceHeld());
  await page.getByText("Reading replacement…", { exact: true }).waitFor();
  assert.deepEqual(await names(page), [], "The prior snapshot must not remain clickable or draggable while its replacement is held");
  assert.equal(await search(page).getAttribute("aria-activedescendant"), null);
  await page.keyboard.press("Enter");
  assert.deepEqual(await page.evaluate(() => locusBrowseFixture.events), []);
  await page.evaluate(() => locusBrowseFixture.releaseReplacement(["gamma"]));
  await page.getByRole("option").filter({ hasText: "Saved gamma" }).waitFor();
  await page.keyboard.press("Enter");
  assert.deepEqual(await page.evaluate(() => locusBrowseFixture.events), [{ action: "pick", id: "gamma" }]);
}));
