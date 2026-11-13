import assert from "node:assert/strict";
import { chromium } from "playwright";

const base = process.env.SMOKE_BASE ?? "http://localhost:3100";
const browser = await chromium.launch({ headless: true });
try {
  const context = await browser.newContext({ permissions: ["clipboard-read", "clipboard-write"] });
  const page = await context.newPage();
  page.setDefaultTimeout(30_000);
  const errors = [];
  page.on("pageerror", (error) => errors.push(String(error)));
  await page.route("**/__data-transfer-fixture", (route) => route.fulfill({
    contentType: "text/html", body: '<html><body><button id="copy">Copy</button><div id="target" tabindex="0">Paste here</div><input id="native"></body></html>',
  }));
  await page.goto(`${base}/__data-transfer-fixture`);
  await page.evaluate(async () => {
    window.transfer = await import("/src/lib/data-transfer/index.ts");
    window.copyResult = undefined;
    document.querySelector("#copy").onclick = async () => {
      try {
        await transfer.copyTransferItem({ value: { $tag: "Just", _0: 42 }, typeName: "Maybe", source: "fenel" });
        window.copyResult = "copied";
      } catch (error) { window.copyResult = String(error); }
    };
    document.querySelector("#target").onpaste = (event) => {
      event.preventDefault();
      window.pasted = transfer.captureDataTransfer(event.clipboardData);
    };
  });
  await page.locator("#copy").click();
  await page.waitForFunction(() => window.copyResult !== undefined);
  assert.equal(await page.evaluate(() => copyResult), "copied");
  await page.locator("#target").focus();
  await page.keyboard.press("Control+V");
  await page.waitForFunction(() => window.pasted !== undefined);
  const clipboard = await page.evaluate(async () => ({ snapshot: pasted, result: await transfer.ingestTransfer(pasted) }));
  assert.ok(clipboard.snapshot.internal, "copy button must preserve the internal MIME format through a native paste event");
  assert.deepEqual(clipboard.result[0].value, { $tag: "Just", _0: 42 });
  assert.equal(clipboard.result[0].source, "fenel");
  console.log("PASS copy button and native paste retain Fenel data identity");

  const markup = await page.evaluate(() => transfer.markupFromHtml('<h2>Title</h2><p>Hello <strong>bold</strong> <em>italic</em><script>window.importExecuted=true</script><a href="javascript:alert(1)" onclick="evil()">bad link</a><a href="https://example.com">safe</a><img src="x" onerror="evil()" alt="image"></p>'));
  const markupText = JSON.stringify(markup);
  assert.match(markupText, /"Heading"/);
  assert.match(markupText, /"Bold"/);
  assert.match(markupText, /"Italic"/);
  assert.match(markupText, /https:\/\/example.com/);
  assert.doesNotMatch(markupText, /javascript:|onclick|importExecuted|onerror/);
  console.log("PASS formatted HTML becomes safe registered Markup cases");

  const image = await page.evaluate(async () => {
    const canvas = document.createElement("canvas");
    canvas.width = 2;
    canvas.height = 1;
    const ctx = canvas.getContext("2d");
    ctx.fillStyle = "red";
    ctx.fillRect(0, 0, 1, 1);
    ctx.fillStyle = "#00ff00";
    ctx.fillRect(1, 0, 1, 1);
    const blob = await new Promise((resolve) => canvas.toBlob(resolve, "image/png"));
    const file = new File([blob], "pixels.png", { type: "image/png" });
    const data = new DataTransfer();
    data.items.add(file);
    return (await transfer.ingestTransfer(transfer.captureDataTransfer(data)))[0];
  });
  assert.equal(image.typeName, "Image");
  assert.deepEqual(image.value, { width: 2, height: 1, pixels: [{ r: 255, g: 0, b: 0, a: 255 }, { r: 0, g: 255, b: 0, a: 255 }] });
  console.log("PASS external image file becomes native canvas pixel data");
  assert.deepEqual(errors, []);
} finally { await browser.close(); }
