// B3 before/after: actual card headings and Home's extracted Call footer.
// `after` checks failed -> Retry -> pending -> ready and safe result pinning.
// `before` uses the committed post-B3 baseline; 30c794d6 remains an optional
// historical baseline for the older row-size repair.
// Capture from the main repo root with FENEL_TEST_BROWSER_CHANNEL=chrome;
// Playwright resolves from that cwd while sources stay beside this fixture.
import { strict as assert } from "node:assert";
import { mkdir, readFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { createRequire } from "node:module";

const captureRoot = fileURLToPath(new URL("../../../../../.tmp-diag/shots/20261024-b3-captures/", import.meta.url));
const buildRoot = fileURLToPath(new URL("../../../../../.tmp-diag/b3-pending-build/", import.meta.url));
const mode = process.argv[2] ?? "after";
const baselineSha = process.env.FENEL_B3_BASELINE_SHA ?? "a74da8fa";
await mkdir(captureRoot, { recursive: true });
await mkdir(buildRoot, { recursive: true });
if (process.versions.bun) {
  const repository = fileURLToPath(new URL("../../../../../", import.meta.url));
  const frozen = new Map();
  const baselineSource = path => {
    const shown = Bun.spawnSync(["git", "--no-optional-locks", "-c", "core.preloadIndex=false", "-c", "core.fsmonitor=false",
      "show", `${baselineSha}:${path}`], { cwd: repository, timeout: 30000 });
    if (shown.exitCode !== 0) throw new Error(`Cannot read the baseline ${path}`);
    return new TextDecoder().decode(shown.stdout);
  };
  if (mode === "before") for (const path of ["value-card.tsx"]) {
    frozen.set(fileURLToPath(new URL(`./${path}`, import.meta.url)).toLowerCase(), baselineSource(`distros/narthex/solid/src/lib/${path}`));
  }
  const home = (mode === "before" ? baselineSource("distros/narthex/solid/src/routes/app/home.tsx")
    : await Bun.file(fileURLToPath(new URL("../routes/app/home.tsx", import.meta.url))).text()).replaceAll("\r\n", "\n");
  const modalStart = home.indexOf("function FunctionCallModalContent(");
  const footerStart = home.indexOf('        <div class="call-modal-foot">', modalStart);
  const footerEnd = home.indexOf("\n        </div>", footerStart) + "\n        </div>".length;
  const pinStart = home.indexOf("  async function pinResult() {", modalStart);
  const pinEnd = home.indexOf("  function setArg(", pinStart);
  if (modalStart < 0 || footerStart < 0 || footerEnd <= footerStart || pinStart < 0 || pinEnd <= pinStart) throw new Error("Home's Call footer boundary moved");
  const nameObservation = home.slice(modalStart).split("\n").find(line => line.includes("const pinName =")) ?? "";
  const footerFixture = `
    function CallFooterFixture(props) {
      const [nameState, setNameState] = createSignal("failed");
      const [pinned, setPinned] = createSignal(false), [pinning, setPinning] = createSignal(false);
      let retries = 0, dismissed = false, pinInFlight = false, closeTimer;
      const added = [], fn = () => ({ id: props.fnId }), draftIssue = () => undefined;
      const nameCurrent = () => nameState() === "ready";
      const observePending = compute => ({ value: compute(), pending: !nameCurrent(), failed: nameState() === "failed" });
      const reader = { retryPresentation: () => { retries++; setNameState("pending"); } };
      ${nameObservation}
      const publicDataSelected = () => false, close = () => {}, setTimeout = () => 0;
      const callableName = () => nameCurrent() ? "Twice" : "Old double";
      const cloneDraftValue = structuredClone, callExpr = () => ({ kind: "call", fnId: props.fnId, args: [] });
      const locusAdd = async (_source, caption) => { added.push(caption); return true; };
      ${home.slice(pinStart, pinEnd)}
      globalThis.b3NameComplete = () => setNameState("ready");
      globalThis.b3CallState = () => ({ state: nameState(), retries, added: [...added] });
      return ${home.slice(footerStart, footerEnd)};
    }
    render(() => <CallFooterFixture fnId="uuid-fn" fnName="Double" />, document.getElementById("b3-call-footer"));
  `;
  const fixturePath = fileURLToPath(new URL("./b3-pending-presentation.fixture.tsx", import.meta.url)).toLowerCase();
  const compilerPath = Bun.resolveSync("@solidjs/compiler", dirname(fileURLToPath(import.meta.resolve("@solidjs/vite-plugin"))));
  const compiler = await import(pathToFileURL(compilerPath).href);
  console.log(JSON.stringify({ mode, phase: "compile-caption-fixture" }));
  const build = await Bun.build({ entrypoints: [fileURLToPath(new URL("./b3-pending-presentation.fixture.tsx", import.meta.url))],
    target: "browser", conditions: ["browser", "development"], plugins: [{ name: "b3-pending-fixture", setup(builder) {
      // These caption/row cases never mount media previews. Refuse that unused
      // dependency explicitly so the actual shared card body stays lightweight.
      builder.onResolve({ filter: /\/data-transfer\/DataPreview$/ }, () => ({ path: "unused-preview", namespace: "b3-pending" }));
      builder.onLoad({ filter: /.*/, namespace: "b3-pending" }, () => ({ loader: "js", contents:
        'export function DataThumbnail() { throw new Error("This caption fixture does not render media previews."); }' }));
      builder.onResolve({ filter: /^@fenel\// }, args => { throw new Error(`Caption fixture eagerly imports ${args.path}`); });
      builder.onLoad({ filter: /\.tsx$/ }, async args => {
        const source = (frozen.get(args.path.toLowerCase()) ?? await Bun.file(args.path).text())
          + (args.path.toLowerCase() === fixturePath ? footerFixture : "");
        return { loader: "ts", contents: (await compiler.transformAsync(source, {
          filename: args.path, generate: "dom", hydratable: false, dev: true,
        })).code };
      });
      builder.onLoad({ filter: /\.css$/ }, () => ({ loader: "js", contents: "" }));
    } }] });
  if (!build.success) throw new AggregateError(build.logs, "B3 pending fixture build failed");
  const bundle = build.outputs.find(output => output.kind === "entry-point");
  await Bun.write(join(buildRoot, `${mode}.js`), bundle);
  console.log(JSON.stringify({ mode, phase: "caption-fixture-built", bytes: bundle.size }));
  const styles = await Promise.all(["../global.css", "../routes/app.css", "./home-entry.css", "./display-name.css"]
    .map(path => Bun.file(fileURLToPath(new URL(path, import.meta.url))).text()));
  await Bun.write(join(buildRoot, `${mode}.css`), styles.join("\n"));
  if (process.env.FENEL_B3_BUILD_ONLY === "1") process.exit(0);
  const child = Bun.spawn(["node", fileURLToPath(import.meta.url), mode], { stdout: "inherit", stderr: "inherit" });
  process.exit(await child.exited);
}
const { chromium } = createRequire(join(process.cwd(), "package.json"))("playwright");
console.log(JSON.stringify({ mode, phase: "launch-caption-browser" }));
const browser = await chromium.launch({ headless: true, channel: process.env.FENEL_TEST_BROWSER_CHANNEL });
try {
  const script = await readFile(join(buildRoot, `${mode}.js`), "utf8");
  const css = await readFile(join(buildRoot, `${mode}.css`), "utf8");
  const page = await browser.newPage({ viewport: { width: 900, height: 620 }, deviceScaleFactor: 2 });
  page.setDefaultTimeout(30000);
  console.log(JSON.stringify({ mode, phase: "mount-caption-fixture" }));
  const errors = [];
  page.on("pageerror", error => errors.push(error.message));
  await page.route("**/*", route => route.fulfill({ contentType: "text/html", body: "<html><body></body></html>" }));
  await page.goto("https://fenel.test/");
  await page.addStyleTag({ content: css });
  if (mode === "before" && baselineSha === "30c794d6") await page.evaluate(() => { globalThis.b3LegacyBaseline = true; });
  await page.addScriptTag({ content: script, type: "module" });
  console.log(JSON.stringify({ mode, phase: "caption-script-mounted" }));
  page.on("console", message => { if (message.type() === "error") errors.push(message.text()); });
  await page.waitForFunction(() => !!globalThis.b3Fixture, undefined, { timeout: 60000 })
    .catch(error => { console.error(JSON.stringify(errors)); throw error; });
  await page.emulateMedia({ reducedMotion: "reduce" });
  await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
  const shot = join(captureRoot, `${mode}-b3-pending-presentation.png`);
  await page.screenshot({ path: shot });
  const height = selector => page.locator(selector).evaluate(element => element.getBoundingClientRect().height);
  if (mode === "after") {
    const named = page.locator('[data-card="named"]');
    assert.equal(await named.locator(".home-item__caption-label--reserved").count(), 1, "A pending name keeps a muted placeholder");
    assert.equal(await named.locator("em").count(), 0, "A pending name is not shown as Data");
    assert.equal(await named.locator("code").count(), 0, "A pending name is never a code name");
    assert.equal(await named.locator(".home-item__type-tag--reserved").count(), 1, "A pending type tag is reserved");
    assert.equal(await page.locator('[data-card="failed"] button', { hasText: "Retry" }).count(), 1, "A failed name offers Retry");
    const failedType = page.locator('[data-card="failed-type"]');
    assert.equal(await failedType.getByRole("alert").innerText(), "Type unavailable.");
    assert.equal(await failedType.getByRole("status").count(), 0, "A failed type is no longer announced as loading");
    const call = page.locator("#b3-call-footer");
    assert.equal(await call.getByRole("alert").innerText(), "Name unavailable.");
    assert.equal(await call.getByRole("button", { name: "Add result to this data", exact: true }).isDisabled(), true);
    assert.equal(await call.locator('[aria-busy="true"]').count(), 0, "A failed name is no longer announced as preparing");
    assert.equal(await page.locator('[data-row="first"] [role=status]').count(), 1, "A pending row shows the loading indicator");
    assert.equal(await page.locator('[data-item="pending"] [role=status]').count(), 1, "A pending calendar item is pending, not (none)");
    assert.equal(await page.locator('[data-item="pending"]').innerText().then(text => text.includes("(none)")), false);
    const pendingRow = await height('[data-row="first"]'), answeredRow = await height('[data-row="second"]');
    assert.ok(Math.abs(pendingRow - answeredRow) <= 1, `A pending row keeps the row height (${pendingRow} vs ${answeredRow})`);
    await failedType.getByRole("button", { name: "Retry", exact: true }).click();
    await call.getByRole("button", { name: "Retry", exact: true }).click();
    assert.equal(await failedType.locator('.home-item__type-tag--reserved[role="status"][aria-label="Loading data type"]').count(), 1);
    assert.equal(await failedType.getByRole("alert").count(), 0);
    assert.equal(await page.evaluate(() => globalThis.b3TypeRetries()), 1);
    assert.equal(await call.getByRole("button", { name: "Preparing its name…", exact: true }).isDisabled(), true);
    assert.deepEqual(await page.evaluate(() => globalThis.b3CallState()), { state: "pending", retries: 1, added: [] });
    await page.screenshot({ path: join(captureRoot, "after-b3-retrying-presentation.png") });
    await page.evaluate(() => { globalThis.b3TypeComplete(); globalThis.b3NameComplete(); });
    await call.getByRole("button", { name: "Add result to this data", exact: true }).click();
    await call.getByRole("button", { name: "✓ Added", exact: true }).waitFor();
    assert.equal(await failedType.locator(".home-item__type-label").innerText(), "Number");
    assert.deepEqual(await page.evaluate(() => globalThis.b3CallState()), { state: "ready", retries: 1, added: ["Twice(…)"] });
    await page.evaluate(() => globalThis.b3Complete());
    await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
    await page.screenshot({ path: join(captureRoot, "after-b3-completed-presentation.png") });
    assert.ok(Math.abs(await height('[data-row="first"]') - pendingRow) <= 1, "Pending to completed does not move the row");
    assert.equal(await page.locator('[data-card="named"] .home-item__caption-label').innerText(), "Reversed words");
  }
  assert.deepEqual(errors, []);
  console.log(JSON.stringify({ mode, shot, b3: "passed" }));
} finally {
  await browser.close();
}
