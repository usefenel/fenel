import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { chromium } from "playwright";
const baseline = process.argv.includes("--baseline");
const script = await readFile(baseline ? ".tmp/lens-loading/before.js" : ".tmp/lens-loading/browser.js", "utf8");
const css = await readFile(".tmp/lens-loading/style.css", "utf8");
const browser = await chromium.launch({ headless: true });
try {
  const page = await browser.newPage({ viewport: { width: 1100, height: 600 } });
  const errors = [];
  page.on("pageerror", error => { errors.push(error.message); console.log("PAGE ERROR", error.message); });
  page.setDefaultTimeout(6000);
  await page.route("**/*", route => route.fulfill({ contentType: "text/html", body: "<html><body></body></html>" }));
  await page.goto("https://fenel.test");
  await page.addStyleTag({ content: css });
  await page.addScriptTag({ content: script, type: "module" });
  await page.locator("[data-early]").waitFor();
  await page.evaluate(() => fixture.handoff());
  await page.waitForFunction(() => fixture.jobs.length === 1);
  if (baseline) {
    await page.locator(".workspace-startup__card").waitFor();
    assert.equal(await page.locator("[data-early]").count(), 0);
    await page.screenshot({ path: ".tmp/lens-loading/before-expression-handoff.png" });
    console.log("PASS baseline reproduces disappearance of loaded data and startup card");
  } else {
  assert.equal(await page.locator("[data-early]").count(), 1, "loaded data should stay until the prepared value is ready");
  assert.equal(await page.locator("[data-spinner], [data-boundary-spinner]").count(), 0, "handoff should not replace loaded data with any spinner");
  await page.screenshot({ path: ".tmp/lens-loading/after-expression-handoff.png" });
  await page.evaluate(() => fixture.release(0, "fox brown quick the"));
  await page.locator("[data-prepared]").waitFor();
  assert.equal(await page.locator("[data-result]").textContent(), "fox brown quick the");
  assert.equal(await page.locator("[data-early]").count(), 0);
  await page.locator("[data-result]").evaluate(element => { globalThis.retainedData = element; });
  for (const mode of ["data", "both", "data", "both"]) {
    await page.evaluate(mode => fixture.mode(mode), mode);
    await page.waitForFunction(mode => document.querySelector("[data-prepared] .data-inspection-dialog__panels")?.getAttribute("data-panels") === mode, mode);
    assert.equal(await page.locator("[data-result]").evaluate(element => element === globalThis.retainedData), true,
      "Expression toggles preserve the loaded data DOM");
    assert.equal(await page.evaluate(() => fixture.jobs.length), 1, "Expression toggles do not rerun the loaded scope");
    assert.equal(await page.locator(".workspace-startup__card, [data-spinner], [data-boundary-spinner]").count(), 0);
  }
  await page.evaluate(() => fixture.refetch());
  await page.waitForFunction(() => fixture.jobs.length === 2);
  assert.equal(await page.locator("[data-result]").textContent(), "fox brown quick the", "a quiet refresh keeps the current data visible");
  await page.evaluate(() => fixture.release(1, "fresh value"));
  await page.waitForFunction(() => document.querySelector("[data-result]")?.textContent === "fresh value");
  await page.evaluate(() => fixture.refetch());
  await page.waitForFunction(() => fixture.jobs.length === 3);
  await page.evaluate(() => fixture.fail(2));
  await page.waitForFunction(() => document.querySelector("[data-result]")?.textContent === "Worker unavailable");
  await page.evaluate(() => fixture.root());
  await page.waitForFunction(() => document.querySelector("[data-prepared]") && !document.querySelector("[data-result]")?.textContent);
  assert.equal(await page.evaluate(() => fixture.jobs.length), 3, "root scope never starts a value evaluation");
  assert.equal(await page.locator("[data-boundary-spinner], [data-spinner]").count(), 0);
  await page.evaluate(() => fixture.value());
  await page.waitForFunction(() => fixture.jobs.length === 4);
  await page.evaluate(() => { fixture.worker(); fixture.release(3, "retired worker value"); });
  await page.waitForFunction(() => fixture.jobs.length === 5);
  assert.equal(await page.getByText("retired worker value", { exact: true }).count(), 0);
  await page.evaluate(() => fixture.release(4, "current worker value"));
  try { await page.waitForFunction(() => document.querySelector("[data-result]")?.textContent === "current worker value"); }
  catch(error) { console.log(await page.locator("body").innerText(), await page.evaluate(() => fixture.jobs.length)); throw error; }
  await page.evaluate(() => fixture.epoch());
  await page.waitForFunction(() => fixture.jobs.length === 6);
  await page.locator("[data-boundary-spinner]").waitFor();
  assert.equal(await page.getByText("current worker value", { exact: true }).count(), 0, "a session change must hide the old result");
  await page.evaluate(() => fixture.release(5, "new session value"));
  await page.waitForFunction(() => document.querySelector("[data-result]")?.textContent === "new session value");
  assert.deepEqual(errors, []);
  assert.deepEqual(await page.evaluate(() => fixture.errors), []);
  console.log("PASS actual Home value scope: retained early data, prepared handoff, quiet refetch, failed worker result, root scope, replaced worker, and session fence");
  }
} finally { await browser.close(); }
