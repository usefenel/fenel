import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { chromium } from "playwright";

const [script, css] = await Promise.all([readFile(process.argv[2], "utf8"), readFile(process.argv[3], "utf8")]);
const baseline = process.argv[4] === "before";
const browser = await chromium.launch({ headless: true });
const values = ["LENEF!!!", 1628.894626777442, "fox brown quick the"];
try {
  async function mount(viewport = { width: 1280, height: 900 }) {
    const page = await browser.newPage({ viewport, reducedMotion: "reduce" });
    const errors = [];
    page.on("pageerror", error => errors.push(error.message));
    await page.route("**/*", route => route.fulfill({ contentType: "text/html", body: "<html><body></body></html>" }));
    await page.goto("https://fenel.test/");
    await page.addStyleTag({ content: css }); await page.addScriptTag({ content: script, type: "module" });
    try { await page.locator(".home-entry__preview").first().waitFor(); }
    catch (error) { console.log(JSON.stringify({ errors, text: await page.locator("body").innerText(), state: await page.evaluate(() => globalThis.earlyReadFixture?.state()) })); throw error; }
    return { page, errors };
  }
  const capture = process.env.FENEL_EARLY_READ_CAPTURE_DIR;
  for (const [size, viewport] of [["desktop", { width: 1280, height: 900 }], ["phone", { width: 390, height: 844 }]]) {
    const { page, errors } = await mount(viewport);
    if (!baseline) await page.waitForFunction(() => earlyReadFixture.state().requests === 1);
    await page.evaluate(() => earlyReadFixture.prepare());
    if (baseline) {
      assert.equal(await page.getByText("Waiting for editing tools…", { exact: true }).count(), 3);
      assert.equal(await page.evaluate(() => earlyReadFixture.state().jobs.length), 0);
    } else {
      await page.waitForFunction(() => earlyReadFixture.state().jobs.length === 3);
      await page.evaluate(values => earlyReadFixture.release(1, values), values);
      await page.getByText("LENEF!!!", { exact: true }).waitFor();
      await page.getByText("fox brown quick the", { exact: true }).waitFor();
      assert.equal(await page.locator("[data-editor-handoff]").count(), 0);
      assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true);
    }
    if (capture) await page.screenshot({ path: join(capture, `${baseline ? "before" : "after"}-early-results-${size}.png`), fullPage: false });
    if (!baseline) {
      await page.evaluate(() => earlyReadFixture.handoff());
      await page.locator("[data-editor-handoff]").waitFor();
      assert.equal(await page.evaluate(() => earlyReadFixture.state().sameCache), true);
      assert.equal(await page.evaluate(() => earlyReadFixture.state().jobs.length), 3);
    }
    assert.deepEqual(errors, []); assert.deepEqual(await page.evaluate(() => earlyReadFixture.state().errors), []);
    await page.close();
  }
  if (!baseline) {
    const { page, errors } = await mount();
    await page.evaluate(() => earlyReadFixture.prepare());
    await page.waitForFunction(() => earlyReadFixture.state().jobs.length === 3);
    await page.evaluate(() => earlyReadFixture.prepare());
    await page.waitForFunction(() => earlyReadFixture.state().jobs.length === 6);
    await page.evaluate(() => earlyReadFixture.release(1, ["OLD READER", 1, "OLD READER"]));
    assert.equal(await page.getByText("OLD READER", { exact: true }).count(), 0);
    await page.evaluate(values => earlyReadFixture.release(2, values), values);
    await page.getByText("LENEF!!!", { exact: true }).waitFor();
    await page.evaluate(() => earlyReadFixture.close());
    await page.getByText("LENEF!!!", { exact: true }).waitFor({ state: "detached" });
    assert.deepEqual(errors, []); await page.close();
    const failed = await mount();
    await failed.page.evaluate(() => earlyReadFixture.prepare());
    await failed.page.waitForFunction(() => earlyReadFixture.state().jobs.length === 3);
    await failed.page.evaluate(() => earlyReadFixture.fail(1));
    await failed.page.locator('.data-unavailable[data-tooltip="Worker unavailable"]').first().waitFor();
    assert.equal(await failed.page.locator('.data-unavailable[data-tooltip="Worker unavailable"]').count(), 3);
    assert.equal(await failed.page.getByRole("status", { name: "Computing data…", exact: true }).count(), 0);
    assert.deepEqual(failed.errors, []); await failed.page.close();
    const changed = await mount();
    await changed.page.evaluate(() => earlyReadFixture.prepare());
    await changed.page.waitForFunction(() => earlyReadFixture.state().jobs.length === 3);
    await changed.page.evaluate(values => { earlyReadFixture.login(); earlyReadFixture.release(1, values); }, values);
    await changed.page.getByText("Preparing data reader…", { exact: true }).first().waitFor();
    assert.equal(await changed.page.getByText("LENEF!!!", { exact: true }).count(), 0);
    assert.deepEqual(changed.errors, []); await changed.page.close();
  }
  console.log(`PASS ${baseline ? "prior committed pending cards" : "early results, same-owner editor handoff, replaced/closed reader and terminal errors"}`);
} finally { await browser.close(); }
