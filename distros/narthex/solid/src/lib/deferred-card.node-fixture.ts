import { after, before, test } from "node:test";
import { strict as assert } from "node:assert";
import { readFile } from "node:fs/promises";
import { chromium, type Browser, type Page } from "playwright";
import type {} from "./deferred-card.fixture";

let browser: Browser;
let script: string;
before(async () => {
  script = await readFile(process.argv[2]!, "utf8");
  browser = await chromium.launch({ headless: true });
});
after(async () => { await browser?.close(); });
async function fixture(run: (page: Page) => Promise<void>) {
  const page = await browser.newPage();
  const errors: string[] = [];
  page.on("pageerror", error => errors.push(error.message));
  try {
    await page.route("**/*", route => route.fulfill({ body: "<html><body></body></html>", contentType: "text/html" }));
    await page.goto("https://fenel.test");
    await page.addScriptTag({ content: script, type: "module" });
    await page.locator('[data-rendered-card="1"]').waitFor();
    await run(page);
    assert.deepEqual(errors, []);
  } finally { await page.close(); }
}

test("visible cards mount on separate frames with their existing reader", () => fixture(async page => {
  const mounts = await page.evaluate(() => deferredCardFixture.state());
  assert.ok(mounts.length >= 2 && mounts.length <= 8, `Unexpected initial mounts: ${mounts.length}`);
  assert.equal(new Set(mounts.map(mount => mount.frame)).size, mounts.length);
  assert.ok(mounts.every(mount => mount.reader === "fixture-reader"));
  assert.equal(await page.locator(".home-card-slot").count(), 100);
}));

test("cards past the screen start loading before a scroll and retain an earlier editing draft", () => fixture(async page => {
  await page.getByRole("textbox", { name: "Draft 0", exact: true }).fill("keep this draft");
  await page.locator('[data-rendered-card="5"]').waitFor({ timeout: 5000 });
  const mounts = await page.evaluate(() => deferredCardFixture.state());
  assert.ok(mounts.length < 40, `Too many cards mounted at once: ${mounts.length}`);
  assert.equal(new Set(mounts.map(mount => mount.frame)).size, mounts.length);
  await page.locator("[data-scroll]").evaluate(element => { element.scrollTop = 0; });
  assert.equal(await page.getByRole("textbox", { name: "Draft 0", exact: true }).inputValue(), "keep this draft");
  assert.equal((await page.evaluate(() => deferredCardFixture.state())).filter(mount => mount.id === 0).length, 1);
}));

test("closing a lens cancels card mounts already queued by scrolling", () => fixture(async page => {
  const count = await page.evaluate(() => {
    const count = deferredCardFixture.state().length;
    document.querySelector<HTMLElement>("[data-scroll]")!.scrollTop = 6000;
    deferredCardFixture.close();
    return count;
  });
  await page.evaluate(() => new Promise<void>(resolve => requestAnimationFrame(() => requestAnimationFrame(() => resolve()))));
  assert.equal((await page.evaluate(() => deferredCardFixture.state())).length, count);
  assert.equal(await page.locator(".home-card-slot").count(), 0);
}));

test("keyboard focus can reach an unmounted card and continue into its controls", () => fixture(async page => {
  const pending = page.locator(".home-card-slot[tabindex='0']");
  if (await pending.count() === 0) {
    await page.locator('[aria-label="Draft 10"]').focus();
    assert.equal(await page.evaluate(() => document.activeElement?.getAttribute("aria-label")), "Draft 10");
    return;
  }
  const slot = pending.first();
  assert.equal(await slot.getAttribute("tabindex"), "0");
  await slot.focus();
  await slot.locator("input").waitFor();
  assert.equal(await slot.getAttribute("tabindex"), null);
  await page.keyboard.press("Tab");
  assert.equal(await page.evaluate(() => document.activeElement?.tagName), "INPUT");
}));
