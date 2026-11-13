// Code names shown without a human label use the shared code face on cards,
// in tooltips and in menus. `bun ./display-name.browser-smoke.mjs after`
// asserts and captures; `before` renders the preceding commit's surfaces.
// `lifecycle` exercises the real tooltip/display renderers without card/engine
// imports. Set NODE_ENV=production and add --production for shipped Solid.
import { strict as assert } from "node:assert";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const captureRoot = process.env.FENEL_DISPLAY_NAME_CAPTURE_ROOT ?? fileURLToPath(new URL("../../../../../.tmp-diag/shots/", import.meta.url));
const buildRoot = fileURLToPath(new URL("../../../../../.tmp-diag/display-name-build/", import.meta.url));
const mode = process.argv[2] ?? "after";
const production = process.argv.includes("--production");
if (process.versions.bun && production) assert.equal(process.env.NODE_ENV, "production", "Set NODE_ENV=production so Bun resolves the actual production Solid exports");
const baselineSha = process.env.FENEL_DISPLAY_NAME_BASELINE_SHA ?? "298174fa";
await mkdir(captureRoot, { recursive: true });
await mkdir(buildRoot, { recursive: true });
if (process.versions.bun) {
  const repository = fileURLToPath(new URL("../../../../../", import.meta.url));
  const frozen = new Map();
  if (mode === "before") for (const path of ["value-card.tsx", "tooltip.tsx", "locus-context-menu.tsx"]) {
    const shown = Bun.spawnSync(["git", "show", `${baselineSha}:distros/narthex/solid/src/lib/${path}`], { cwd: repository });
    if (shown.exitCode !== 0) throw new Error(`Cannot read the baseline ${path}`);
    frozen.set(fileURLToPath(new URL(`./${path}`, import.meta.url)).toLowerCase(), new TextDecoder().decode(shown.stdout));
  }
  const compilerPath = Bun.resolveSync("@solidjs/compiler", dirname(fileURLToPath(import.meta.resolve("@solidjs/vite-plugin"))));
  const compiler = await import(pathToFileURL(compilerPath).href);
  const entry = mode === "lifecycle" ? "./display-name-lifecycle.fixture.tsx" : "./display-name.fixture.tsx";
  const build = await Bun.build({ entrypoints: [fileURLToPath(new URL(entry, import.meta.url))],
    target: "browser", conditions: ["browser", production ? "production" : "development"], plugins: [{ name: "display-name-fixture", setup(builder) {
      // The shared card chrome reaches the engine through its data previews;
      // source text imports keep the Vite `?raw` meaning.
      builder.onResolve({ filter: /\?raw$/ }, args => ({ path: join(dirname(args.importer), args.path.slice(0, -"?raw".length)), namespace: "raw" }));
      builder.onLoad({ filter: /.*/, namespace: "raw" }, async args => ({ loader: "js", contents: `export default ${JSON.stringify(await Bun.file(args.path).text())};` }));
      builder.onLoad({ filter: /\.tsx$/ }, async args => {
        const source = frozen.get(args.path.toLowerCase()) ?? await Bun.file(args.path).text();
        return { loader: "ts", contents: (await compiler.transformAsync(source, {
          filename: args.path, generate: "dom", hydratable: false, dev: !production,
        })).code };
      });
      builder.onLoad({ filter: /\.css$/ }, () => ({ loader: "js", contents: "" }));
    } }] });
  if (!build.success) throw new AggregateError(build.logs, "Display-name fixture build failed");
  await Bun.write(join(buildRoot, `${mode}.js`), build.outputs.find(output => output.kind === "entry-point"));
  const styles = await Promise.all(["../global.css", "../routes/app.css", "./home-entry.css", "./locus-context-menu.css", "./tooltip.css",
    ...(mode === "before" ? [] : ["./display-name.css"])]
    .map(path => Bun.file(fileURLToPath(new URL(path, import.meta.url))).text()));
  await Bun.write(join(buildRoot, `${mode}.css`), styles.join("\n"));
  if (process.argv.includes("--build-only")) process.exit(0);
  const child = Bun.spawn(["node", fileURLToPath(import.meta.url), mode, ...(production ? ["--production"] : [])], { stdout: "inherit", stderr: "inherit" });
  process.exit(await child.exited);
}
const { chromium } = await import("playwright");
const browser = await chromium.launch({ headless: true, channel: process.env.FENEL_TEST_BROWSER_CHANNEL });
try {
  if (mode === "lifecycle") {
    await lifecycleControls(browser);
  } else {
  const script = await readFile(join(buildRoot, `${mode}.js`), "utf8");
  const css = await readFile(join(buildRoot, `${mode}.css`), "utf8");
  const page = await browser.newPage({ viewport: { width: 900, height: 420 }, deviceScaleFactor: 2 });
  const errors = [];
  page.on("pageerror", error => errors.push(error.message));
  await page.route("**/*", route => route.fulfill({ contentType: "text/html", body: "<html><body></body></html>" }));
  await page.goto("https://fenel.test/");
  await page.addStyleTag({ content: css });
  if (mode === "before") await page.evaluate(() => { globalThis.displayNameBaseline = true; });
  await page.addScriptTag({ content: script, type: "module" });
  await page.waitForFunction(() => !!globalThis.displayNameFixture);
  await page.emulateMedia({ reducedMotion: "reduce" });
  const tooltipFor = async name => {
    await page.mouse.move(5, 5);
    await page.locator(`[data-input="${name}"]`).hover();
    await page.locator("[role=tooltip]").waitFor();
    await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
  };
  const face = locator => locator.evaluate(element => getComputedStyle(element).fontFamily);
  await tooltipFor("s");
  await page.screenshot({ path: join(captureRoot, `${mode}-display-name-code-tooltip-cards-menu.png`) });
  if (mode === "after") {
    const code = page.locator('[data-card="code"] .home-item__caption-label');
    assert.equal(await code.innerText(), "reversedWords");
    assert.equal(await code.locator("code.display-name--code").count(), 1, "A code name without a label uses the code face");
    assert.match(await face(code.locator("code")), /mono/i);
    assert.equal(await page.locator('[data-card="label"] .home-item__caption-label code').count(), 0, "A label is human text");
    assert.equal(await page.locator('[data-card="label"] .home-item__caption-label').innerText(), "Reversed words");
    assert.equal(await page.locator('[data-card="unnamed"] .home-item__caption-label em').innerText(), "Data");
    const tooltip = page.locator("[role=tooltip]");
    assert.equal(await tooltip.innerText(), "s: missing data");
    assert.equal(await tooltip.locator("code.display-name--code").innerText(), "s");
    assert.match(await face(tooltip.locator("code")), /mono/i);
    const menu = page.getByRole("menu", { name: "Inputs" });
    assert.equal(await menu.getByRole("menuitem", { name: "s" }).locator("code.display-name--code").innerText(), "s");
    assert.equal(await menu.getByRole("menuitem", { name: "Text" }).locator("code").count(), 0);
    await tooltipFor("Text");
    assert.equal(await page.locator("[role=tooltip]").innerText(), "Text: missing data");
    assert.equal(await page.locator("[role=tooltip] code").count(), 0, "A human label's tooltip has no code face");
  }
  assert.deepEqual(errors, []);
  console.log(JSON.stringify({ mode, display: "passed" }));
  }
} finally {
  await browser.close();
}

async function lifecycleControls(browser) {
  const script = await readFile(join(buildRoot, `${mode}.js`), "utf8");
  const css = await readFile(join(buildRoot, `${mode}.css`), "utf8");
  const results = [];
  const check = async (name, exercise) => {
    const page = await browser.newPage({ viewport: { width: 900, height: 420 }, reducedMotion: "reduce" });
    page.setDefaultTimeout(4_000);
    const errors = [];
    page.on("pageerror", error => errors.push(error.message));
    try {
      await page.route("**/*", route => route.fulfill({ contentType: "text/html", body: "<html><body></body></html>" }));
      await page.goto("https://fenel.test/");
      await page.addStyleTag({ content: css });
      await page.addScriptTag({ content: script, type: "module" });
      await page.waitForFunction(() => !!globalThis.displayNameLifecycle);
      await exercise(page);
      assert.equal(await page.locator("[data-lifecycle-error]").count(), 0, "The Solid boundary must remain healthy");
      assert.deepEqual(errors, []);
      results.push({ name, status: "passed" });
    } catch (error) {
      const caught = await page.locator("[data-lifecycle-error]").allTextContents();
      results.push({ name, status: "failed", assertion: String(error), caught, errors });
    } finally { await page.close(); }
    console.log(JSON.stringify(results.at(-1)));
  };
  const target = (page, name = "first") => page.locator(`[data-lifecycle-target="${name}"]`);
  const opened = async (page, name = "first", pointer = false) => {
    if (pointer) await target(page, name).hover();
    else await target(page, name).focus();
    await page.waitForFunction(name => document.querySelector(`[data-lifecycle-target="${name}"]`)?.getAttribute("aria-describedby") === "fenel-tooltip", name);
    await page.locator("[role=tooltip]").waitFor();
    assert.equal(await target(page, name).getAttribute("aria-describedby"), "fenel-tooltip");
  };
  const closed = async page => {
    await page.locator("[role=tooltip]").waitFor({ state: "detached" });
    assert.equal(await page.locator('[data-lifecycle-target][aria-describedby="fenel-tooltip"]').count(), 0);
  };
  await check("pointer leave closes a code tooltip", async page => {
    await opened(page, "first", true);
    assert.equal(await page.locator("[role=tooltip] code").innerText(), "s");
    await page.mouse.move(5, 5);
    await closed(page);
  });
  await check("Escape closes a keyboard tooltip", async page => {
    await opened(page);
    await page.keyboard.press("Escape");
    await closed(page);
  });
  await check("focusout closes a keyboard tooltip", async page => {
    await opened(page);
    await page.locator("[data-lifecycle-dismiss]").focus();
    await closed(page);
  });
  await check("pointerdown closes a tooltip", async page => {
    await opened(page, "first", true);
    await page.locator("[data-lifecycle-dismiss]").click();
    await closed(page);
  });
  await check("new label transfers description and code", async page => {
    await opened(page);
    await opened(page, "next");
    assert.equal(await target(page).getAttribute("aria-describedby"), null);
    assert.equal(await page.locator("[role=tooltip]").innerText(), "next: missing data");
    assert.equal(await page.locator("[role=tooltip] code").innerText(), "next");
    await page.keyboard.press("Escape");
    await closed(page);
  });
  await check("same label uses the next target's code segment", async page => {
    await opened(page);
    await opened(page, "same");
    assert.equal(await target(page).getAttribute("aria-describedby"), null);
    assert.equal(await page.locator("[role=tooltip]").innerText(), "s: missing data");
    assert.equal(await page.locator("[role=tooltip] code").innerText(), "missing");
  });
  await check("tooltip hide settles during a pending sibling read", async page => {
    await opened(page);
    await page.evaluate(() => displayNameLifecycle.startPending());
    await page.keyboard.press("Escape");
    await page.evaluate(() => displayNameLifecycle.releasePending());
    await closed(page);
    assert.equal(await page.locator("[data-lifecycle-ready]").innerText(), "Ready");
  });
  await check("visible disposal removes tooltip and description", async page => {
    await opened(page);
    // Keep the target outside disposal to observe the layer's actual cleanup.
    const retained = await target(page).evaluateHandle(element => element);
    await page.evaluate(() => displayNameLifecycle.dispose());
    assert.equal(await retained.evaluate(element => element.getAttribute("aria-describedby")), null);
    await page.locator("[role=tooltip]").waitFor({ state: "detached" });
    await page.evaluate(() => new Promise(resolve => requestAnimationFrame(resolve)));
  });
  await check("pending disposal cancels the opening timer", async page => {
    await target(page).hover();
    await page.evaluate(() => displayNameLifecycle.dispose());
    await page.waitForTimeout(520);
    assert.equal(await page.locator("[role=tooltip]").count(), 0);
  });
  await check("leaving before the opening timer cancels the tooltip", async page => {
    await target(page).hover();
    await page.mouse.move(5, 5);
    await page.waitForTimeout(520);
    assert.equal(await page.locator("[role=tooltip]").count(), 0);
    assert.equal(await target(page).getAttribute("aria-describedby"), null);
  });
  await check("text code segment changes without changing text", async page => {
    await page.evaluate(() => displayNameLifecycle.setCode("missing"));
    await page.waitForFunction(() => document.querySelector("[data-lifecycle-text] code")?.textContent === "missing");
    assert.equal(await page.locator("[data-lifecycle-text]").innerText(), "s: missing data");
  });
  await check("text code segment can disappear", async page => {
    await page.evaluate(() => displayNameLifecycle.setCode(undefined));
    await page.waitForFunction(() => !document.querySelector("[data-lifecycle-text] code"));
    assert.equal(await page.locator("[data-lifecycle-text]").innerText(), "s: missing data");
  });
  await check("text and code segment can be replaced together", async page => {
    await page.evaluate(() => { displayNameLifecycle.setText("next: supplied data"); displayNameLifecycle.setCode("next"); });
    await page.waitForFunction(() => document.querySelector("[data-lifecycle-text] code")?.textContent === "next");
    assert.equal(await page.locator("[data-lifecycle-text]").innerText(), "next: supplied data");
  });
  await check("display name changes from code to human label", async page => {
    await page.evaluate(() => displayNameLifecycle.setName({ text: "Human label", code: false }));
    await page.waitForFunction(() => document.querySelector("[data-lifecycle-name]")?.textContent === "Human label");
    assert.equal(await page.locator("[data-lifecycle-name] code").count(), 0);
  });
  await check("display name can disappear", async page => {
    await page.evaluate(() => displayNameLifecycle.setName(undefined));
    await page.waitForFunction(() => document.querySelector("[data-lifecycle-name]")?.textContent === "Unnamed"
      || !!document.querySelector("[data-lifecycle-error]"));
    assert.equal(await page.locator("[data-lifecycle-name]").innerText(), "Unnamed");
  });
  await writeFile(join(captureRoot, "display-name-lifecycle-results.json"), JSON.stringify({ mode, production, results }, null, 2));
  console.log(JSON.stringify({ mode, production, results }));
  assert.deepEqual(results.filter(result => result.status === "failed"), [], "Display/tooltip lifetimes must settle without stale Show reads");
}
