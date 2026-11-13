import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdir, writeFile } from "node:fs/promises";
import { createRequire } from "node:module";
import { join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

// C1 browser harness: exercise the actual typed form hosts through Vite.
// Run with Node; Playwright's Windows pipes can hang when driven by Bun.
// --baseline records the prior hosts' duplicate POST defect before edits.
const repository = fileURLToPath(new URL("../../../../../", import.meta.url));
const require = createRequire(join(repository, "package.json"));
const { chromium } = require("playwright");
let base = process.env.SMOKE_BASE?.replace(/\/$/, "");
const baseline = process.argv.includes("--baseline");
const mode = baseline ? "before" : "after";
const baselineRevision = baseline ? execFileSync("git", ["rev-parse", "--verify", `${process.env.SMOKE_BASELINE_REVISION ?? "HEAD"}^{commit}`],
  { cwd: repository, encoding: "utf8" }).trim() : undefined;
const captureRoot = resolve(repository, process.env.SMOKE_ARTIFACT_DIR ?? ".tmp-diag/2026-10-08-shared-forms");
assert.ok(captureRoot.startsWith(repository), "Browser evidence must remain inside the repository");
await mkdir(captureRoot, { recursive: true });
let browser;
let viteServer;
const cases = [];
let activePage;
const browserErrors = [];
let deadline;

const postRequests = state => state.requests.filter(request => request.method.toUpperCase() === "POST");
const state = page => page.evaluate(() => formSubmissionFixture.state());
const email = page => page.locator('form input[name="email"]');
const submit = page => page.locator('form button[type="submit"]');
const error = page => page.locator("form .fenel-error, form .public-page-error");
const success = page => page.locator(".fenel-success, .public-page-success");
const release = (page, outcome = "success", index = 0) => page.evaluate(({ index, outcome }) => {
  formSubmissionFixture.release(index, outcome);
}, { index, outcome });
const settle = page => page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));

async function open(host, viewport = { width: 1280, height: 900 }) {
  if (!activePage) {
    activePage = await browser.newPage({ viewport, reducedMotion: "reduce" });
    activePage.setDefaultTimeout(30_000);
    activePage.setDefaultNavigationTimeout(60_000);
    let failImport;
    const importFailure = new Promise((_resolve, reject) => { failImport = reject; });
    activePage.on("pageerror", err => { browserErrors.push(err.message); console.error(err.message); failImport(err); });
    await activePage.route(`${base}/__form-submission-fixture`, route => route.fulfill({
      contentType: "text/html",
      body: '<!doctype html><html><head><meta name="viewport" content="width=device-width,initial-scale=1"></head><body><div id="fixture"></div><script type="module" src="/src/lib/form-submission.browser-fixture.tsx"></script></body></html>',
    }));
    await Promise.race([importFailure, (async () => {
      await activePage.goto(`${base}/__form-submission-fixture`, { waitUntil: "domcontentloaded" });
      await activePage.waitForFunction(() => !!globalThis.formSubmissionFixture, undefined, { timeout: 90_000 });
    })()]);
  }
  // Remount the real hosts between cases while retaining the expensive,
  // unchanged module preparation. Each mount resets the fixture's IO log.
  const page = activePage;
  await page.setViewportSize(viewport);
  await page.evaluate(host => formSubmissionFixture.mount(host), host);
  await email(page).waitFor();
  assert.equal(await submit(page).isEnabled(), true, `${host}: loaded form accepts a submission`);
  return { page, errors: browserErrors };
}

async function closeCase(page) {
  await page.evaluate(() => formSubmissionFixture.unmount());
  assert.deepEqual(browserErrors, [], "Unmounting a checked form must not raise a browser exception");
}

async function assertHealthy(page, errors) {
  assert.deepEqual(errors, [], "No browser exception may accompany the form interaction");
  assert.deepEqual((await state(page)).errors, [], "The real typed renderer must not fail");
  assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true,
    "The real form and its fixture fit the viewport");
}

async function capture(page, host, viewportName, phase) {
  const path = join(captureRoot, `${mode}-${host}-${viewportName}-${phase}.png`);
  const count = postRequests(await state(page)).length;
  assert.match(await page.locator("[data-request-summary]").innerText(), new RegExp(`^\\s*${count} POST requests?\\b`),
    "The visible screenshot diagnostic must agree with actual POST requests");
  await page.screenshot({ path, fullPage: false });
  return path;
}

async function waitForPosts(page, count) {
  await page.waitForFunction(count => formSubmissionFixture.state().requests
    .filter(request => request.method.toUpperCase() === "POST").length === count, count);
}

async function assertCompleted(page, host, previousCallbacks = 0) {
  await success(page).waitFor();
  const current = await state(page);
  assert.equal(current.held, 0);
  assert.equal(current.callbacks.length, host === "widget" ? previousCallbacks + 1 : 0);
  if (host === "widget") assert.equal(current.callbacks.at(-1).kind, "submit");
}

async function check(name, action) {
  console.log(`Checking ${name}`);
  await action();
  cases.push(name);
  console.log(`PASS ${name}`);
}

try {
  if (!base) {
    if (baseline) {
      process.env.FENEL_FORM_BASELINE = "1";
      process.env.SMOKE_BASELINE_REVISION = baselineRevision;
    }
    const { createServer } = await import(pathToFileURL(join(repository, "distros/narthex/solid/node_modules/vite/dist/node/index.js")).href);
    viteServer = await createServer({
      configFile: fileURLToPath(new URL("./form-submission.fixture-vite.mjs", import.meta.url)),
      server: { port: 0, strictPort: false },
    });
    await viteServer.listen();
    base = viteServer.resolvedUrls.local[0].replace(/\/$/, "");
  }
  browser = await chromium.launch({ headless: true, channel: process.env.FENEL_TEST_BROWSER_CHANNEL });
  deadline = setTimeout(() => {
    console.error("Public-form browser checks exceeded their three-minute bound");
    process.exitCode = 1;
    void browser.close();
    void viteServer?.close();
  }, 180_000);
  for (const host of ["widget", "page"]) {
    for (const [viewportName, viewport] of [
      ["desktop", { width: 1280, height: 900 }],
      ["phone", { width: 390, height: 844 }],
    ]) {
      await check(`${host} ${viewportName}: same-task submits, captured data and retry`, async () => {
        const { page, errors } = await open(host, viewport);
        const capturedEmail = "first@example.com";
        await email(page).fill(capturedEmail);
        await page.evaluate(() => formSubmissionFixture.submitTwice());
        const expectedPosts = baseline ? 2 : 1;
        await settle(page);
        assert.equal(postRequests(await state(page)).length, expectedPosts,
          baseline ? "Prior hosts reproduce both same-task POSTs" : "Same-task submits admit exactly one POST");
        assert.equal((await state(page)).held, expectedPosts);
        assert.equal(await submit(page).isDisabled(), true);
        await capture(page, host, viewportName, "held");

        // Edits remain possible while IO is pending; they cannot rewrite the
        // data captured for the outstanding request or admit another POST.
        await email(page).fill("edited@example.com");
        const captured = postRequests(await state(page));
        assert.deepEqual(captured.map(request => request.data), Array.from({ length: expectedPosts }, () => ({ email: capturedEmail })));
        assert.match(captured[0].path, /\/alpha\/submit$/);
        if (!baseline) {
          await page.evaluate(() => formSubmissionFixture.submitTwice());
          await settle(page);
          assert.equal(postRequests(await state(page)).length, 1, "A held request also refuses later submit events");
        }
        // Both baseline POSTs must fail before the retry comparison, so the
        // form remains visible with the same editable data in both captures.
        for (let index = 0; index < expectedPosts; index++) await release(page, "http-error");
        await error(page).waitFor();
        await page.waitForFunction(() => document.querySelector('form button[type="submit"]')?.disabled === false);
        assert.equal(await email(page).inputValue(), "edited@example.com");
        await capture(page, host, viewportName, "retry");
        const failed = await state(page);
        assert.equal(failed.held, 0);
        assert.equal(failed.callbacks.length, host === "widget" ? expectedPosts : 0);
        if (host === "widget") assert.ok(failed.callbacks.every(callback => callback.kind === "error"));

        await submit(page).click();
        await waitForPosts(page, expectedPosts + 1);
        assert.equal(await error(page).count(), 0, "Retry clears the prior error");
        assert.deepEqual(postRequests(await state(page)).at(-1).data, { email: "edited@example.com" });
        await release(page);
        await assertCompleted(page, host, failed.callbacks.length);
        await assertHealthy(page, errors);
        await closeCase(page);
      });
    }
    if (baseline) continue;

    await check(`${host}: successful held request retains its original data`, async () => {
      const { page, errors } = await open(host);
      await email(page).fill("captured@example.com");
      await submit(page).click();
      await waitForPosts(page, 1);
      await email(page).fill("later@example.com");
      await release(page);
      await assertCompleted(page, host);
      assert.deepEqual(postRequests(await state(page))[0].data, { email: "captured@example.com" });
      await assertHealthy(page, errors);
      await closeCase(page);
    });

    if (host === "widget") await check("widget: synchronous and queued success callbacks cannot resubmit", async () => {
      const { page, errors } = await open(host);
      await email(page).fill("callback@example.com");
      await page.evaluate(() => formSubmissionFixture.armSuccessReentry());
      await submit(page).click();
      await waitForPosts(page, 1);
      await release(page);
      await assertCompleted(page, host);
      await settle(page);
      assert.equal(postRequests(await state(page)).length, 1, "Both success-callback submit events must be refused");
      assert.equal((await state(page)).held, 0);
      await assertHealthy(page, errors);
      await closeCase(page);
    });

    for (const outcome of ["network-error", "json-error", ...(host === "page" ? ["invalid-redirect", "null-success"] : [])]) {
      await check(`${host}: ${outcome} releases the request for retry`, async () => {
        const { page, errors } = await open(host);
        await email(page).fill("retry@example.com");
        await submit(page).click();
        await waitForPosts(page, 1);
        await release(page, outcome);
        await error(page).waitFor();
        await page.waitForFunction(() => document.querySelector('form button[type="submit"]')?.disabled === false);
        assert.equal(await email(page).inputValue(), "retry@example.com");
        const failed = await state(page);
        assert.equal(failed.callbacks.length, host === "widget" ? 1 : 0);
        if (host === "widget") assert.equal(failed.callbacks[0].kind, "error");
        await submit(page).click();
        await waitForPosts(page, 2);
        assert.equal(await error(page).count(), 0);
        await release(page);
        await assertCompleted(page, host, failed.callbacks.length);
        await assertHealthy(page, errors);
        await closeCase(page);
      });
    }

    for (const outcome of ["success", "http-error", "network-error", "json-error", ...(host === "page" ? ["redirect"] : [])]) {
      await check(`${host}: A → B → A ignores old ${outcome} and its cleanup`, async () => {
        const { page, errors } = await open(host);
        await email(page).fill("old@example.com");
        await submit(page).click();
        await waitForPosts(page, 1);
        await page.evaluate(() => formSubmissionFixture.switchTo("beta"));
        await email(page).waitFor();
        await page.waitForFunction(() => document.querySelector('form button[type="submit"]')?.disabled === false);
        assert.equal(await email(page).inputValue(), "", "Switching to B resets the old draft");
        await page.evaluate(() => formSubmissionFixture.switchTo("alpha"));
        await email(page).waitFor();
        await page.waitForFunction(() => document.querySelector('form button[type="submit"]')?.disabled === false);
        assert.equal(await email(page).inputValue(), "", "Returning to A starts a new form lifetime");
        await email(page).fill("current@example.com");
        await submit(page).click();
        await waitForPosts(page, 2);
        assert.equal((await state(page)).held, 2);

        const fixtureUrl = page.url();
        await release(page, outcome);
        await settle(page);
        assert.equal(page.url(), fixtureUrl, "An old response cannot redirect the current form");
        const current = await state(page);
        assert.equal(current.held, 1);
        assert.deepEqual(current.callbacks, [], "The stale response cannot invoke current callbacks");
        assert.equal(await success(page).count(), 0, "The stale success cannot replace the current form");
        assert.equal(await error(page).count(), 0, "The stale failure cannot overwrite the current form");
        assert.equal(await submit(page).isDisabled(), true, "The old finally block cannot unlock the new request");
        assert.equal(await email(page).inputValue(), "current@example.com");
        await page.evaluate(() => formSubmissionFixture.submitTwice());
        await settle(page);
        assert.equal(postRequests(await state(page)).length, 2, "The new request remains the only active submission");
        await release(page);
        await assertCompleted(page, host);
        await assertHealthy(page, errors);
        await closeCase(page);
      });
    }

    for (const outcome of ["success", "http-error", "network-error", "json-error", ...(host === "page" ? ["redirect"] : [])]) {
      await check(`${host}: unmount ignores a held ${outcome}`, async () => {
        const { page, errors } = await open(host);
        await email(page).fill("unmounted@example.com");
        await submit(page).click();
        await waitForPosts(page, 1);
        await page.evaluate(() => formSubmissionFixture.unmount());
        await page.locator("form").waitFor({ state: "detached" });
        const fixtureUrl = page.url();
        await release(page, outcome);
        await settle(page);
        assert.equal(page.url(), fixtureUrl, "An old response cannot redirect after unmount");
        assert.deepEqual((await state(page)).callbacks, [], "Disposed form callbacks must remain silent");
        assert.equal(await success(page).count(), 0);
        assert.equal(await error(page).count(), 0);
        await assertHealthy(page, errors);
        await closeCase(page);
      });
    }
  }
  await writeFile(join(captureRoot, `${mode}-results.json`), JSON.stringify({ mode, base, baselineRevision,
    harness: "complete production hosts with controlled registry, form planning and scalar-renderer seams", cases }, null, 2));
  console.log(`PASS ${cases.length} ${mode} public-form checks; comparisons saved under ${captureRoot}`);
} catch (err) {
  if (activePage && !activePage.isClosed()) {
    console.error(await activePage.locator("body").innerText().catch(() => "Failed page unavailable"));
    console.error(JSON.stringify(await state(activePage).catch(() => ({ fixture: "unavailable" })), null, 2));
    await activePage.screenshot({ path: join(captureRoot, `${mode}-failure.png`), fullPage: false }).catch(() => {});
  }
  throw err;
} finally {
  clearTimeout(deadline);
  await browser?.close();
  await viteServer?.close();
}
