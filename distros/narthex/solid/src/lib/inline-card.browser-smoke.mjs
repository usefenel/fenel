import { strict as assert } from "node:assert";
import { mkdir, readFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const captureRoot = fileURLToPath(new URL("../../../../../.tmp-diag/inline-card-comparisons/", import.meta.url));
const mode = process.argv[2] ?? "after";
await mkdir(captureRoot, { recursive: true });
if (process.versions.bun && process.argv.includes("--retained")) {
  const child = Bun.spawn(["node", fileURLToPath(import.meta.url), mode], { stdout: "inherit", stderr: "inherit" });
  process.exit(await child.exited);
}
if (process.versions.bun) {
  const compilerPath = Bun.resolveSync("@solidjs/compiler", dirname(fileURLToPath(import.meta.resolve("@solidjs/vite-plugin"))));
  const compiler = await import(pathToFileURL(compilerPath).href);
  const build = await Bun.build({ entrypoints: [fileURLToPath(new URL("./inline-card.fixture.tsx", import.meta.url))],
    target: "browser", conditions: ["browser", "development"], plugins: [{ name: "inline-card-fixture", setup(builder) {
      // The breadcrumb uses the real modal open/close owner. Its unused lazy
      // typed prompt editor is outside this card/geometry fixture.
      builder.onLoad({ filter: /[\\/]confirm-modal[\\/]prompt-body\.tsx$/ }, () => ({ loader: "js", contents: "export default () => null;" }));
      // No reader is mounted in this geometry fixture. Keep the real picture
      // and thumbnail components; an unexpected reference read must fail.
      // Reader lifetime/currentness is covered by reader-picture's owner tests.
      builder.onResolve({ filter: /(?:reader-runtime|authoring-catalog-worker|reader-picture)$/ }, args => {
        if (/[\\/]glyph-picture\.tsx$/.test(args.importer)) return { path: args.path, namespace: "card-picture-leaf" };
      });
      builder.onLoad({ filter: /.*/, namespace: "card-picture-leaf" }, args => ({ loader: "js", contents:
        args.path.endsWith("reader-runtime") ? "export const useReaderRuntime = () => undefined;"
        : args.path.endsWith("authoring-catalog-worker")
          ? "const refuse = () => { throw new Error('Picture worker is outside the card geometry fixture'); }; export const preparedReaderWorkerForSession = refuse, runPreparedReaderWorker = refuse;"
          : "export const projectReaderPicture = () => { throw new Error('Picture evaluation is outside the card geometry fixture'); };" }));
      builder.onResolve({ filter: /^@fenel\// }, args => { throw new Error(`Card chrome eagerly imports ${args.path}`); });
      builder.onLoad({ filter: /\.tsx$/ }, async args => ({ loader: "ts", contents: (await compiler.transformAsync(await Bun.file(args.path).text(), {
        filename: args.path, generate: "dom", hydratable: false, dev: true,
      })).code }));
      builder.onLoad({ filter: /\.css$/ }, () => ({ loader: "js", contents: "" }));
    } }] });
  if (!build.success) throw new AggregateError(build.logs, "Inline card fixture build failed");
  await Bun.write(join(captureRoot, `${mode}.js`), build.outputs.find(output => output.kind === "entry-point"));
  const styles = await Promise.all(["../global.css", "../routes/app.css", "./home-entry.css", "./function-card-body.css", "./layout-renderer/typed-read-value.css", "./data-transfer/data-transfer.css", "./locus-context-menu.css", "./tooltip.css"]
    .map(path => Bun.file(fileURLToPath(new URL(path, import.meta.url))).text()));
  await Bun.write(join(captureRoot, `${mode}.css`), styles.join("\n"));
  const child = Bun.spawn(["node", fileURLToPath(import.meta.url), mode], { stdout: "inherit", stderr: "inherit" });
  process.exit(await child.exited);
}
const { chromium } = await import("playwright");
const browser = await chromium.launch({ headless: true, channel: process.env.FENEL_TEST_BROWSER_CHANNEL });
try {
  const script = await readFile(join(captureRoot, `${mode}.js`), "utf8");
  const css = await readFile(join(captureRoot, `${mode}.css`), "utf8");
  for (const [device, width, height] of [["desktop", 1024, 768], ["phone", 390, 844]]) {
    const page = await browser.newPage({ viewport: { width, height } });
    const errors = [];
    page.on("pageerror", error => errors.push(error.message));
    await page.route("**/*", route => route.fulfill({ contentType: "text/html", body: "<html><body></body></html>" }));
    await page.goto("https://fenel.test/");
    await page.addStyleTag({ content: css });
    await page.addScriptTag({ content: script, type: "module" });
    await page.waitForFunction(() => !!globalThis.inlineCardFixture);
    const pause = () => page.evaluate(async () => {
      await new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)));
      await Promise.all(document.getAnimations().filter(animation => animation.effect?.getTiming().iterations !== Infinity)
        .map(animation => animation.finished.catch(() => {})));
    });
    await pause();
    await page.screenshot({ path: join(captureRoot, `${mode}-${device}-card-layouts.png`) });
    if (mode === "after") {
      const body = page.locator('[data-composable-body]');
      assert.equal(await body.locator('.home-value-body').count(), 1);
      assert.equal(await body.locator('.home-item, .home-item__header, .home-item-rail, .corner-menu-button').count(), 0);
      assert.equal(await body.locator('[data-body-action]').count(), 1);
      assert.equal(await body.locator('.fenel-string-data__content').innerText(), 'fox brown quick the');
      await page.evaluate(() => inlineCardFixture.setBodyData('updated data'));
      await page.waitForFunction(() => document.querySelector('[data-composable-body] .fenel-string-data__content')?.textContent === 'updated data');
      await page.evaluate(() => inlineCardFixture.setBodyPresentation('full'));
      await body.locator('.home-item__header').waitFor();
      assert.equal(await body.locator('.home-item__caption-label').innerText(), 'Reversed words');
      assert.equal(await body.locator('.fenel-string-data__content').innerText(), 'updated data');
      await page.evaluate(() => inlineCardFixture.setBodyPresentation('body'));
      await body.locator('.home-value-body').waitFor();
      assert.equal(await body.locator('.home-item__header').count(), 0);
      const noOwnIcon = page.locator('[data-function-hover] .home-item');
      assert.equal(await noOwnIcon.locator('.home-item__value-icon').count(), 0);
      assert.equal(await noOwnIcon.locator('.home-item__type-icon').count(), 1);
      assert.equal(await noOwnIcon.locator('.home-item__body').isVisible(), false);
      assert.equal(await page.locator('[data-specific-function-hover] .home-item__value-icon').count(), 1);
      assert.equal(await page.locator('[data-specific-function-hover] .home-item__value-icon svg').isVisible(), true);
      assert.equal(await page.locator('[data-specific-function-hover] .home-item__body').isVisible(), false);
      const badge = await page.locator('[data-scalar-badge] .home-item').evaluate(element => {
        const type = element.querySelector('.home-item__type-tag').getBoundingClientRect();
        const data = element.querySelector('.home-item__body').getBoundingClientRect();
        return { height: element.getBoundingClientRect().height, typeMiddle: (type.top + type.bottom) / 2, dataMiddle: (data.top + data.bottom) / 2, typeFirst: type.right <= data.left };
      });
      assert.ok(badge.height <= 23);
      assert.ok(Math.abs(badge.typeMiddle - badge.dataMiddle) <= 1);
      assert.equal(badge.typeFirst, true);
      assert.ok((await page.locator('[data-wide-card] .home-item').boundingBox()).width <= 448.1);
      const twoLine = await page.locator('[data-two-line-scalar] .home-item').evaluate(card => {
        const body = card.querySelector('.home-item__body').getBoundingClientRect();
        const value = card.querySelector('.home-item__body > span').getBoundingClientRect();
        return { dx: Math.abs((body.left + body.right) / 2 - (value.left + value.right) / 2),
          dy: Math.abs((body.top + body.bottom) / 2 - (value.top + value.bottom) / 2) };
      });
      assert.ok(twoLine.dx <= 1 && twoLine.dy <= 1);
      const unnamed = await page.locator('[data-unnamed-full] .home-item').evaluate(card => {
        const caption = card.querySelector('.home-item__caption').getBoundingClientRect();
        const type = card.querySelector('.home-item__type-tag').getBoundingClientRect();
        return { nameHeight: caption.height, secondLine: type.top >= caption.bottom - 1 };
      });
      assert.ok(unnamed.nameHeight > 0 && unnamed.secondLine);
    }
    const collections = page.locator('[data-collections] > div').nth(1).locator('.locus-previews__cell[data-value-preview]');
    await collections.first().hover();
    await page.locator('[data-value-preview-popup]').waitFor();
    await pause();
    await page.screenshot({ path: join(captureRoot, `${mode}-${device}-collection-hover.png`) });
    if (mode === "after") {
      const popup = page.locator('[data-value-preview-popup]');
      assert.ok(await popup.locator('.locus-previews__cell[data-value-preview]').count() <= 5);
      assert.equal(await popup.locator('.locus-previews__count').innerText(), '13 fields');
      assert.equal(await popup.locator('.home-item--inline-two-line').count(), 1);
      const geometry = await popup.evaluate(element => {
        const name = element.querySelector('.home-item__caption').getBoundingClientRect();
        const type = element.querySelector('.home-item__type-tag').getBoundingClientRect();
        const card = element.getBoundingClientRect();
        return { secondLine: type.top >= name.bottom - 1, width: card.width, height: card.height, left: card.left, right: card.right, fits: element.scrollWidth <= element.clientWidth };
      });
      assert.equal(geometry.secondLine, true);
      assert.ok(geometry.width <= 352.1 && geometry.height <= 56.1 && geometry.left >= 11 && geometry.right <= width - 11);
      assert.equal(geometry.fits, true);
    }
    await page.mouse.move(width - 8, height - 8);
    await page.locator('[data-value-preview-popup]').waitFor({ state: 'detached' });
    const type = page.locator('[data-record-card] .home-item__type-tag[data-value-preview]');
    await type.focus();
    await page.locator('[data-value-preview-popup]').waitFor();
    await pause();
    await page.screenshot({ path: join(captureRoot, `${mode}-${device}-type-hover.png`) });
    if (mode === "after") {
      assert.ok(await page.locator('[data-value-preview-popup] .locus-previews__cell[data-value-preview]').count() <= 5);
      assert.equal(await page.locator('[data-value-preview-popup] .locus-previews__count').innerText(), '13 fields');
      await page.keyboard.press('Enter');
      assert.equal(await page.evaluate(() => JSON.stringify(inlineCardFixture.opened.at(-1).type) === JSON.stringify(inlineCardFixture.record)), true);
    } else await page.keyboard.press('Escape');
    await page.locator('[data-value-preview-popup]').waitFor({ state: 'detached' });
    const breadcrumbType = page.locator('[data-breadcrumb] .locus-crumbs__type');
    await breadcrumbType.hover();
    await page.locator('[data-value-preview-popup], [role=tooltip]').waitFor();
    await pause();
    await page.screenshot({ path: join(captureRoot, `${mode}-${device}-breadcrumb-hover.png`) });
    if (mode === "after") {
      assert.equal(await breadcrumbType.getAttribute('data-tooltip'), null);
      assert.equal(await page.locator('[role=tooltip]').count(), 0);
      assert.equal(await page.locator('[data-value-preview-popup] .locus-previews__count').innerText(), '13 fields');
      await page.locator('[data-value-preview-popup]').click();
      assert.equal(await page.evaluate(() => inlineCardFixture.opened.at(-1).source), 'breadcrumb');
      await breadcrumbType.focus();
      await page.keyboard.press('Enter');
      assert.equal(await page.evaluate(() => inlineCardFixture.opened.at(-1).source), 'breadcrumb');
      assert.equal(await page.evaluate(() => JSON.stringify(inlineCardFixture.opened.at(-1).type) === JSON.stringify(inlineCardFixture.record)), true);
      await page.locator('[data-value-preview-popup]').waitFor({ state: 'detached' });
      await collections.nth(3).hover();
      await page.locator('[data-value-preview-popup]').waitFor();
      const longCaption = await page.locator('[data-value-preview-popup] .home-item__caption').evaluate(element => ({
        clipped: element.scrollWidth > element.clientWidth,
        bounds: element.getBoundingClientRect().toJSON(),
        popup: element.closest('[data-value-preview-popup]').getBoundingClientRect().toJSON(),
      }));
      assert.ok(longCaption.bounds.right <= longCaption.popup.right + 1);
      await page.keyboard.press('Escape');
      const signature = await page.locator('[data-single-line] .home-item').boundingBox();
      assert.ok(signature.height <= 23);
      assert.equal(await page.locator('[data-single-line] .function-card-body__input-type').count(), 2);
      assert.ok(await page.locator('[data-record-card] .locus-previews__cell').count() > 0);
      assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true);
      await page.evaluate(() => inlineCardFixture.showUnsavedBadge());
      assert.equal(await page.locator('[data-unsaved-badge] .home-item__unsaved').isVisible(), true);
      assert.equal(await page.locator('[data-unsaved-badge] .home-item__caption-label').isVisible(), false);
      assert.ok((await page.locator('[data-unsaved-badge] .home-item').boundingBox()).height <= 24);

      const numeric = page.locator('[data-list-case="input"]');
      const numericCells = numeric.locator('.locus-previews__cell[data-value-preview]');
      const texts = host => host.locator('[data-thumbnail-text]').allTextContents();
      await page.waitForFunction(() => document.querySelectorAll('[data-list-case="input"] [data-thumbnail-text]').length === 3);
      assert.deepEqual(await texts(numeric), ['3', '1', '2']);
      assert.deepEqual(await texts(page.locator('[data-list-case="output"]')), ['2', '1', '3']);
      assert.equal(await numeric.locator('[data-thumbnail-icon]').count(), 0);
      const geometry = await numeric.evaluate(host => {
        const strip = host.querySelector('.locus-previews').getBoundingClientRect();
        const cells = [...host.querySelectorAll('.locus-previews__cell[data-value-preview]')].map(cell => cell.getBoundingClientRect());
        return { width: strip.width, circles: cells.map(cell => cell.width),
          overlaps: cells.slice(1).every((cell, index) => cell.left > cells[index].left && cell.left < cells[index].right),
          fits: cells.every(cell => cell.left >= strip.left && cell.right <= strip.right) };
      });
      assert.ok(geometry.width > 220 && geometry.fits && geometry.overlaps);
      assert.ok(geometry.circles.every(diameter => diameter > 40));
      const compactDiameters = await page.locator('[data-list-case="compact"] .locus-previews__cell[data-value-preview]')
        .evaluateAll(cells => cells.map(cell => cell.getBoundingClientRect().width));
      assert.equal(compactDiameters.length, 3);
      assert.ok(compactDiameters.every(diameter => diameter >= 21 && diameter <= 23));
      const oneLine = await page.locator('[data-list-case="one-line"] .locus-previews__item').evaluateAll(items => items.map(item => ({
        item: item.getBoundingClientRect().width, circle: item.querySelector('.locus-previews__cell').getBoundingClientRect().width,
      })));
      assert.ok(oneLine.length > 0);
      assert.ok(oneLine.every(box => Math.abs(box.item - box.circle) <= 1 && box.circle >= 15 && box.circle <= 17));
      await numeric.locator('.expr-graph-collection__item-dot').first().click();
      assert.equal(await page.evaluate(() => inlineCardFixture.opened.at(-1).expand), 3);
      await numericCells.first().hover();
      await page.locator('[data-value-preview-popup]').waitFor();
      assert.equal(await page.locator('[data-value-preview-popup]').innerText(), '3');
      await page.keyboard.press('Escape');
      await numericCells.first().click();
      assert.equal(await page.evaluate(() => inlineCardFixture.opened.at(-1).number), 3);
      await page.evaluate(() => inlineCardFixture.setListValues([12, 34, 56]));
      await page.waitForFunction(() => document.querySelector('[data-list-case="input"] [data-thumbnail-text]')?.textContent === '12');
      assert.deepEqual(await texts(numeric), ['12', '34', '56']);
      assert.equal(await numeric.locator('[data-thumbnail-text]').evaluateAll(nodes => nodes.every(node => node.scrollWidth <= node.clientWidth)), true);
      await page.evaluate(() => inlineCardFixture.setListValues(Array.from({ length: 20 }, (_, index) => index + 1)));
      await numeric.locator('.locus-previews__cell--more').waitFor();
      const wideCount = await numericCells.count();
      assert.ok(wideCount >= 3 && wideCount < 20);
      assert.equal(await numeric.locator('.locus-previews__count').innerText(), '20 items');
      assert.equal(await numeric.locator('.locus-previews__cell--more').getAttribute('aria-label'), `${20 - wideCount} more items`);
      assert.equal(await numeric.locator('.locus-previews').evaluate(strip => {
        const bounds = strip.getBoundingClientRect();
        return [...strip.querySelectorAll('.locus-previews__cell')].every(cell => {
          const rect = cell.getBoundingClientRect(); return rect.left >= bounds.left && rect.right <= bounds.right;
        });
      }), true);
      await numeric.locator('.locus-previews__cell--more').click();
      assert.equal(await page.evaluate(() => inlineCardFixture.opened.at(-1)), 'numbers');
      await page.evaluate(() => inlineCardFixture.setListWidth(180));
      await page.waitForFunction(() => document.querySelectorAll('[data-list-case="input"] .locus-previews__cell[data-value-preview]').length === 1);
      assert.deepEqual(await texts(numeric), ['1']);
      assert.equal(await numeric.locator('.locus-previews__cell--more').count(), 0);
      await page.evaluate(() => inlineCardFixture.setListWidth(270));
      await page.waitForFunction(count => document.querySelectorAll('[data-list-case="input"] .locus-previews__cell[data-value-preview]').length === count, wideCount);
      await page.evaluate(() => inlineCardFixture.setListValues([]));
      await page.waitForFunction(() => document.querySelector('[data-list-case="input"] .locus-previews__count')?.textContent === '');
      assert.equal(await numericCells.count(), 0);
      assert.equal(await numeric.locator('.locus-previews__cell--more').count(), 0);
      await page.evaluate(() => inlineCardFixture.setListValues([123456789.125]));
      await numericCells.first().waitFor();
      assert.deepEqual(await texts(numeric), ['123456789.125']);
      assert.equal(await numeric.locator('[data-thumbnail-text]').getAttribute('title'), '123456789.125');
      await numericCells.first().hover();
      await page.locator('[data-value-preview-popup]').waitFor();
      assert.equal(await page.locator('[data-value-preview-popup]').innerText(), '123456789.125');
      await page.keyboard.press('Escape');
      await page.evaluate(() => inlineCardFixture.setListValues([3, 1, 2]));
      await page.waitForFunction(() => document.querySelectorAll('[data-list-case="input"] [data-thumbnail-text]').length === 3);
      await page.screenshot({ path: join(captureRoot, `${mode}-${device}-numeric-list-strips.png`) });
    }
    assert.deepEqual(errors, []);
    await page.close();
  }
  if (mode === 'after') {
    const page = await browser.newPage({ viewport: { width: 390, height: 844 }, hasTouch: true });
    await page.route('**/*', route => route.fulfill({ contentType: 'text/html', body: '<html><body></body></html>' }));
    await page.goto('https://fenel.test/');
    await page.addStyleTag({ content: css });
    await page.addScriptTag({ content: script, type: 'module' });
    await page.locator('[data-breadcrumb] .locus-crumbs__type').tap();
    assert.equal(await page.evaluate(() => inlineCardFixture.opened.at(-1).source), 'breadcrumb');
    await page.close();
  }
  console.log(`Inline cards ${mode}: matching desktop/phone captures; ${mode === 'after' ? 'layout, counts, retained signatures, exact type pointer/keyboard/touch checks passed' : 'baseline retained'}.`);
} finally { await browser.close(); }
