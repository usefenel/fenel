import assert from "node:assert/strict";
import { chromium } from "playwright";

const base = process.env.SMOKE_BASE ?? "http://localhost:3100";
const browser = await chromium.launch({ headless: true });
try {
  const page = await browser.newPage();
  page.setDefaultTimeout(120_000);
  await page.addInitScript(() => {
    const NativeWorker = window.Worker;
    window.Worker = class extends NativeWorker {
      constructor(...args) {
        super(...args);
        const send = this.postMessage.bind(this);
        this.postMessage = (value, ...options) => {
          if (value?.method === "adapt-transfer") window.lastTransferTarget = structuredClone(value.target);
          return send(value, ...options);
        };
      }
    };
  });
  page.on("pageerror", (error) => console.error(String(error)));
  await page.route("**/__typed-transfer-fixture", (route) => route.fulfill({ contentType: "text/html", body: '<html><body><main id="fixture"></main></body></html>' }));
  await page.goto(`${base}/__typed-transfer-fixture`);
  console.log("Preparing actual account/worker fixture");
  await page.evaluate(async () => { await import("/src/lib/data-transfer/transfer.browser-fixture.tsx"); await transferFixture.mount(); transferFixture.unmount(); });
  await page.evaluate(async () => {
    await import("/src/lib/expression-runner/typed-authoring.browser-fixture.tsx");
    typedAuthoring.useAccountSession("data-transfer-fixture");
    typedAuthoring.mount("Maybe");
  });
  const target = page.locator("#fixture [data-fenel-transfer-target]").first();
  await target.waitFor();
  await target.evaluate((node) => {
    const data = new DataTransfer(); data.setData("text/plain", "7");
    node.dispatchEvent(new ClipboardEvent("paste", { clipboardData: data, bubbles: true, cancelable: true }));
  });
  await page.waitForFunction(() => !document.querySelector('[aria-busy="true"]'));
  const outcome = await page.evaluate(() => ({ state: typedAuthoring.state(), messages: Array.from(document.querySelectorAll('[role="status"]'), (node) => node.textContent), target: window.lastTransferTarget }));
  if (!/Just/.test(outcome.state.node.fnId ?? "") || process.env.SMOKE_DIAGNOSTICS) {
    const diagnostic = await page.evaluate(async () => {
      const { accountAuthoringSession } = await import("/src/lib/expression-runner/authoring-session.ts");
      const { userFunctions } = await import("/src/lib/user-registries.ts");
      const session = accountAuthoringSession({ accountId: "data-transfer-fixture", functions: userFunctions() });
      const { adaptTransferToTarget } = await import("/src/lib/data-transfer/expressions.ts");
      const { itemFromText } = await import("/src/lib/data-transfer/index.ts");
      const env = session.environment;
      const entries = env.catalog.functions.filter((entry) => entry.kind === "constructor" && entry.parentEntity === "Maybe");
      const target = window.lastTransferTarget ?? { ...typedAuthoring.typeDiagnostics(), currentValue: { $tag: "Nothing" } };
      let local;
      try { local = adaptTransferToTarget([itemFromText("7")], { ...target, environment: env, registry: session.registry, evaluateContext: session.evaluateContext }); }
      catch (error) { local = String(error); }
      return { entries, target, local };
    });
    console.log(JSON.stringify({ outcome, diagnostic }));
  }
  assert.match(outcome.state.node.fnId ?? "", /Just/, JSON.stringify(outcome));
  assert.equal(outcome.state.node.args[0].value, 7);
  console.log("PASS real account Maybe accepts pasted Number through its worker");
  await page.evaluate(() => typedAuthoring.mountScenario("maybe-list"));
  await page.locator('#fixture [data-fenel-transfer-target]').first().evaluate((node) => {
    const data = new DataTransfer(); data.setData("text/plain", "[1,2]");
    node.dispatchEvent(new ClipboardEvent("paste", { clipboardData: data, bubbles: true, cancelable: true }));
  });
  await page.waitForFunction(() => !document.querySelector('[aria-busy="true"]'));
  assert.deepEqual((await page.evaluate(() => typedAuthoring.state())).node.value, [{ $tag: "Just", _0: 1 }, { $tag: "Just", _0: 2 }]);
  console.log("PASS real account nested List Maybe accepts pasted data");
  for (const name of ["Number", "Image"]) {
    const side = Number(process.env.TRANSFER_IMAGE_SIDE ?? 64);
    await page.evaluate(() => {
      window.transferGaps = []; let previous = performance.now();
      window.transferHeartbeat = setInterval(() => { const now = performance.now(); transferGaps.push(now - previous); previous = now; }, 25);
    });
    const started = Date.now();
    await page.evaluate(({ name, side }) => {
      window.transferExpected = name === "Number" ? 42 : { width: side, height: side, pixels: Array.from({ length: side * side }, (_, index) => ({ r: index % 256, g: 2, b: 3, a: 255 })) };
      typedAuthoring.mount(name, { kind: "literal", value: transferExpected });
    }, { name, side });
    await page.locator('#fixture [data-fenel-transfer-target]').first().waitFor();
    const mountMs = Date.now() - started;
    const copied = await page.locator('#fixture [data-fenel-transfer-target]').first().evaluate((node) => {
      const data = new DataTransfer(); node.dispatchEvent(new ClipboardEvent("copy", { clipboardData: data, bubbles: true, cancelable: true }));
      return data.getData("application/x-fenel-value+json");
    });
    assert.ok(copied, `${name} should be copyable`);
    await page.evaluate((name) => typedAuthoring.mount(name), name);
    const pasteStart = Date.now();
    await page.locator('#fixture [data-fenel-transfer-target]').first().evaluate((node, text) => {
      const data = new DataTransfer(); data.setData("application/x-fenel-value+json", text);
      node.dispatchEvent(new ClipboardEvent("paste", { clipboardData: data, bubbles: true, cancelable: true }));
    }, copied);
    await page.waitForFunction(() => !document.querySelector('[aria-busy="true"]'));
    const checked = await page.evaluate(() => {
      clearInterval(transferHeartbeat);
      const current = typedAuthoring.state();
      return { same: JSON.stringify(current.node.value) === JSON.stringify(transferExpected), messages: Array.from(document.querySelectorAll('[role="status"]'), (node) => node.textContent), maxGap: Math.max(0, ...transferGaps), writes: current.writes };
    });
    console.log(JSON.stringify({ name, side: name === "Image" ? side : undefined, mountMs, pasteMs: Date.now() - pasteStart, ...checked }));
    if (name === "Image" && (!checked.same || process.env.SMOKE_DIAGNOSTICS)) {
      console.log(JSON.stringify({ imageMembership: await page.evaluate(() => typedAuthoring.imageMembershipDiagnostics()) }));
    }
    assert.equal(checked.same, true, JSON.stringify(checked));
    console.log(`PASS actual typed ${name} copy and paste`);
  }
} finally { await browser.close(); }
