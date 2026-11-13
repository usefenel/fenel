import { test } from "node:test";
import { strict as assert } from "node:assert";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { chromium } from "playwright";
import type {} from "./function-card-body.fixture";

test("generic admitted function signatures share responsive input previews and a bounded inline row", async () => {
  const browser = await chromium.launch({ headless: true, channel: process.env["FENEL_TEST_BROWSER_CHANNEL"] });
  try {
    const script = await readFile(process.argv[2]!, "utf8");
    const css = await readFile(process.argv[3]!, "utf8");
    const errors: string[] = [];
    const page = await browser.newPage({ viewport: { width: 1024, height: 768 } });
    page.on("pageerror", error => errors.push(error.message));
    await page.route("**/*", route => route.fulfill({ contentType: "text/html", body: "<html><body></body></html>" }));
    const mount = async (before = false) => {
      await page.goto(`https://fenel.test/?before=${before ? 1 : 0}`);
      await page.addStyleTag({ content: css });
      await page.addScriptTag({ content: script, type: "module" });
      await page.waitForFunction(() => !!globalThis.functionCardFixture);
      await page.evaluate(() => new Promise<void>(resolve => requestAnimationFrame(() => requestAnimationFrame(() => resolve()))));
    };
    const capture = process.env["FENEL_FUNCTION_CARD_CAPTURE_DIR"];
    if (capture) {
      await mount(true);
      await page.screenshot({ path: join(capture, "before-functions-180.png") });
      await page.locator("[data-responsive]").evaluate(element => { (element as HTMLElement).style.width = "420px"; });
      await page.screenshot({ path: join(capture, "before-functions-420.png") });
    }
    await mount();
    const responsive = page.locator("[data-responsive]");
    const circles = responsive.locator(".locus-previews__cell[data-value-preview]");
    const narrow = await circles.count();
    assert.ok(narrow > 0 && narrow < 5);
    const row = await responsive.locator(".function-card-body").evaluate(element => {
      const [inputs, arrow, output] = [...element.children].map(child => child.getBoundingClientRect());
      return { direction: getComputedStyle(element).flexDirection, ordered: inputs!.bottom <= arrow!.top && arrow!.bottom <= output!.top,
        outputText: (element.querySelector(".function-card-body__output") as HTMLElement).innerText };
    });
    assert.equal(row.direction, "column");
    assert.equal(row.ordered, true);
    assert.equal(row.outputText, "Number");
    assert.equal(await responsive.locator(".function-card-body__output .home-item__type-icon svg").count(), 1);
    assert.equal(await circles.first().locator(".function-card-body__input-icon svg").count(), 1);
    if (capture) await page.screenshot({ path: join(capture, "after-functions-180.png") });
    await responsive.evaluate(element => { (element as HTMLElement).style.width = "420px"; });
    await page.waitForFunction(() => document.querySelectorAll('[data-responsive] .locus-previews__cell[data-value-preview]').length === 5);
    assert.equal(await responsive.locator(".locus-previews__cell--more").count(), 0);
    const fit = await responsive.locator(".locus-previews").evaluate(element => {
      const cells = [...element.querySelectorAll(".locus-previews__cell")].map(cell => cell.getBoundingClientRect());
      return element.scrollWidth <= element.clientWidth && Math.max(...cells.map(cell => cell.top)) - Math.min(...cells.map(cell => cell.top)) < 1;
    });
    assert.equal(fit, true);
    assert.equal(await circles.nth(3).innerText(), "a");
    const scopedIcons = await circles.evaluateAll(elements => elements.slice(0, 2).map(element => element.querySelector("svg")!.innerHTML));
    assert.notEqual(scopedIcons[0], scopedIcons[1], "Different scoped type icons are retained");
    if (capture) await page.screenshot({ path: join(capture, "after-functions-420.png") });
    await circles.nth(1).focus();
    await page.locator("[data-value-preview-popup]").waitFor();
    await page.keyboard.press("Enter");
    assert.deepEqual(await page.evaluate(() => functionCardFixture.opened()), [{ type: "checked-b", index: 1 }]);
    await responsive.evaluate(element => { (element as HTMLElement).style.width = "180px"; });
    await page.waitForFunction(count => document.querySelectorAll('[data-responsive] .locus-previews__cell[data-value-preview]').length === count, narrow);
    await responsive.locator(".locus-previews__cell--more").click();
    assert.deepEqual((await page.evaluate(() => functionCardFixture.opened())).at(-1), { inputs: true });
    const inline = await page.locator("[data-inline] .home-item").evaluate(element => {
      const body = element.querySelector(".function-card-body")!;
      const boxes = [...body.children].map(child => child.getBoundingClientRect());
      const bounds = element.getBoundingClientRect();
      return { width: bounds.width, height: bounds.height, direction: getComputedStyle(body).flexDirection,
        centers: boxes.map(box => box.y + box.height / 2), fits: body.scrollWidth <= body.clientWidth };
    });
    assert.equal(inline.direction, "row");
    assert.ok(inline.height <= 36.1 && inline.width <= 352);
    assert.ok(Math.max(...inline.centers) - Math.min(...inline.centers) < 1);
    assert.equal(inline.fits, true);
    assert.equal(await page.locator("[data-nullary] .function-card-body__empty").innerText(), "No inputs");
    assert.equal(await page.locator('[data-inline] .function-card-body__input-type').count(), 2);
    assert.equal((await page.locator('[data-inline] .function-card-body__comma').innerText()).trim(), ',');
    assert.equal(await page.locator('[data-type-single] .type-data-preview__field-name').allTextContents().then(names => names.join(', ')), 'x, y');
    assert.equal(await page.locator('[data-type-variants] .type-data-preview__field-name').allTextContents().then(names => names.join(', ')), 'title, reason');
    assert.equal(await page.locator('[data-type-compact] .locus-previews__count').innerText(), '2 fields');
    if (capture) await page.locator('[data-type-previews]').screenshot({ path: join(capture, 'after-types-shared.png') });
    const typeTag = page.locator('[data-type-hover] .home-item__type-tag[data-value-preview]');
    await typeTag.scrollIntoViewIfNeeded();
    await page.evaluate(() => new Promise<void>(resolve => requestAnimationFrame(() => requestAnimationFrame(() => resolve()))));
    await typeTag.focus();
    const popup = page.locator('[data-value-preview-popup]');
    await popup.waitFor();
    assert.equal(await popup.locator('.type-data-preview--compact .locus-previews__count').innerText(), '2 fields');
    if (capture) await page.screenshot({ path: join(capture, 'after-type-hover.png') });
    await page.keyboard.press('Enter');
    assert.deepEqual((await page.evaluate(() => functionCardFixture.opened())).at(-1), { type: 'record-type' });
    assert.doesNotMatch(await page.locator('[data-type-previews]').innerText(), /\$record|\$variant|\$arrow|->/);
    const singleton = page.locator('[data-function-case="Absolute value"] .function-card-body__inputs');
    assert.equal(await singleton.innerText(), "Number", "A sole input names its admitted type directly");
    assert.equal(await singleton.locator('.locus-previews').count(), 0, "A sole input has no collection/count affordance");
    const inputType = singleton.locator('.function-card-body__input-type');
    assert.equal(await inputType.locator('.home-item__type-icon svg').count(), 1);
    await inputType.focus();
    await page.locator('[data-value-preview-popup]').waitFor();
    await page.keyboard.press('Enter');
    assert.deepEqual((await page.evaluate(() => functionCardFixture.opened())).at(-1), { type: 'checked-number', index: 0 },
      "Keyboard opening a sole input retains its declaration index and scoped type");
    assert.deepEqual(errors, []);
  } finally { await browser.close(); }
});
