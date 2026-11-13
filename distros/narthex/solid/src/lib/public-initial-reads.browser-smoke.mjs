import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { chromium } from "playwright";

const [script, css] = await Promise.all([readFile(process.argv[2], "utf8"), readFile(process.argv[3], "utf8")]);
const baseline = process.argv[4] === "before";
const browser = await chromium.launch({ headless: true });
try {
  async function mount(viewport = { width: 1280, height: 900 }, variants = false) {
    const page = await browser.newPage({ viewport, reducedMotion: "reduce" });
    const errors = [], imports = [];
    page.on("pageerror", error => errors.push(error.message));
    await page.route("**/*", route => {
      if (/\/(?:authoring-json|@fenel\/|routes\/app\/home|workspace-authoring-provider)/.test(route.request().url())) {
        imports.push(route.request().url());
        return route.fulfill({ status: 404, contentType: "text/plain", body: "Complete reader deliberately unavailable" });
      }
      return route.fulfill({ contentType: "text/html", body: "<html><body></body></html>" });
    });
    await page.goto("https://fenel.test/");
    if (variants) await page.evaluate(() => { globalThis.publicInitialVariantCase = true; });
    await page.addStyleTag({ content: css }); await page.addScriptTag({ content: script, type: "module" });
    try { await page.locator(".home-entry__preview").first().waitFor(); }
    catch (error) { console.log(JSON.stringify({ errors, imports, text: await page.locator("body").innerText() })); throw error; }
    return { page, errors, imports };
  }
  if (process.env.FENEL_PUBLIC_INITIAL_GRAPH_ONLY === "1") {
    const { page, errors, imports } = await mount();
    const started = await page.evaluate(() => {
      publicInitialReadsFixture.openReversedWordsGraph();
      return performance.now();
    });
    const source = page.locator("[data-expression-inspection]");
    const root = source.locator(".expr-call").first();
    await root.waitFor();
    if (await root.getAttribute("data-call-layout") !== "graph") {
      await root.getByRole("button", { name: "Actions", exact: true }).click();
      await page.getByRole("menuitem", { name: "Lens", exact: true }).hover();
      await page.getByRole("menuitem", { name: "Graph", exact: true }).click();
    }
    if (baseline) await source.getByRole("status").filter({ hasText: "Preparing data…" }).first().waitFor();
    else {
      await source.getByText("4 items", { exact: true }).first().waitFor();
      assert.ok(await source.getByText("4 items", { exact: true }).count() >= 2, "Both actual intermediate lists must be present");
      assert.equal(await source.getByRole("status").filter({ hasText: /Preparing data…|Computing data…/ }).count(), 0);
    }
    if (process.env.FENEL_PUBLIC_INITIAL_CAPTURE_DIR) await page.screenshot({
      path: join(process.env.FENEL_PUBLIC_INITIAL_CAPTURE_DIR, `${baseline ? "before" : "after"}-public-initial-graph.png`), fullPage: true,
    });
    const elapsed = await page.evaluate(start => performance.now() - start, started);
    assert.deepEqual(errors, []); assert.deepEqual(imports, []);
    assert.deepEqual((await page.evaluate(() => publicInitialReadsFixture.state())).errors, []);
    console.log(`PASS ${baseline ? "prior graph waits for reader" : "checked graph intermediates without reader preparation"}; graph interaction ${Math.round(elapsed)}ms including browser automation`);
    await page.close();
    await browser.close();
    process.exit(0);
  }
  for (const [size, viewport] of [["desktop", { width: 1280, height: 900 }], ["phone", { width: 390, height: 844 }]]) {
    const { page, errors, imports } = await mount(viewport);
    const state = await page.evaluate(() => publicInitialReadsFixture.state());
    assert.ok(state.computed.length >= 8, "The actual source must exercise all currently computed public cards");
    assert.ok(state.computed.every(card => card.available), "Every unchanged top-level call needs a checked generated result");
    if (baseline) {
      assert.equal(await page.getByText("Preparing data reader…", { exact: true }).count(), state.computed.length);
    } else {
      assert.equal(await page.getByText("Preparing data reader…", { exact: true }).count(), 0);
      assert.equal(await page.getByText("Computing data…", { exact: true }).count(), 0);
      for (const card of state.computed) {
        const rendered = page.locator(".home-entry__preview").filter({ has: page.getByText(card.label, { exact: true }) }).first();
        await rendered.waitFor();
        if (card.scalar !== undefined) await rendered.getByText(card.scalar, { exact: true }).waitFor();
        else assert.ok(await rendered.locator(".locus-previews").count() > 0, `${card.label} must retain the shared record preview`);
      }
      assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true);
    }
    if (process.env.FENEL_PUBLIC_INITIAL_CAPTURE_DIR) await page.screenshot({
      path: join(process.env.FENEL_PUBLIC_INITIAL_CAPTURE_DIR, `${baseline ? "before" : "after"}-public-initial-${size}.png`), fullPage: false,
    });
    assert.deepEqual(errors, []); assert.deepEqual(imports, []); assert.deepEqual(state.errors, []);
    await page.close();
  }
  if (!baseline) {
    const { page, errors, imports } = await mount(undefined, true);
    const state = await page.evaluate(() => publicInitialReadsFixture.state());
    const variants = state.computed.filter(card => card.variant);
    assert.equal(variants.length, 3);
    for (const card of variants) {
      assert.equal(card.valueTag, card.label.replace("Controlled ", ""));
      const rendered = page.locator(".home-entry__preview").filter({ has: page.getByText(card.label, { exact: true }) }).first();
      await rendered.waitFor();
      assert.equal(await rendered.locator(".locus-previews").count(), 0, `${card.label} must retain its variant constructor`);
      assert.equal(await rendered.locator(".locus-previews__count").count(), 0);
    }
    assert.deepEqual(errors, []); assert.deepEqual(imports, []); assert.deepEqual(state.errors, []);
    await page.close();
  }
  console.log(`PASS ${baseline ? "prior public call loaders" : "all checked public results with complete reader and editor unavailable"}`);
} finally { await browser.close(); }
