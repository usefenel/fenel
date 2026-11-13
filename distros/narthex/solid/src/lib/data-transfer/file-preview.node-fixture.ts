// C1: run against a Solid-compiled bundle of file-preview.browser-fixture.tsx.
import { after, before, test } from "node:test";
import { strict as assert } from "node:assert";
import { readFile } from "node:fs/promises";
import { chromium, type Browser } from "playwright";
import type {} from "./file-preview.browser-fixture";

let browser: Browser;
let script: string;
before(async () => {
  script = await readFile(process.argv[2]!, "utf8");
  browser = await chromium.launch({ headless: true, timeout: 30_000, channel: process.env["FENEL_TEST_BROWSER_CHANNEL"] });
});
after(async () => { await browser?.close(); });

test("a failed image can be replaced by a valid image in the same mounted preview", async () => {
  const page = await browser.newPage({ viewport: { width: 640, height: 480 } });
  const errors: string[] = [];
  page.on("pageerror", error => errors.push(error.message));
  try {
    await page.route("**/*", route => route.fulfill({ body: "<html><body></body></html>", contentType: "text/html" }));
    await page.goto("https://fenel.test/");
    await page.addScriptTag({ content: script, type: "module" });
    await page.getByText("The picture could not be shown.", { exact: true }).waitFor();
    await page.locator("#preview .fenel-import-file").evaluate(element => { (globalThis as Record<string, unknown>)["originalFilePreviewElement"] = element; });
    const image = "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jL1sAAAAASUVORK5CYII=";
    await page.evaluate(url => filePreviewFixture.replace({ url, name: "replacement.png", mimeType: "image/png", size: 68 }), image);
    await page.waitForFunction(() => {
      const image = document.querySelector<HTMLImageElement>("#preview img");
      return image?.complete && image.naturalWidth === 1;
    });
    assert.equal(await page.getByText("The picture could not be shown.", { exact: true }).count(), 0);
    assert.equal(await page.getByRole("link", { name: "replacement.png" }).getAttribute("href"), image);
    assert.equal(await page.locator("#preview .fenel-import-file").evaluate(element => element === (globalThis as Record<string, unknown>)["originalFilePreviewElement"]), true);

    await page.evaluate(() => filePreviewFixture.useMutable());
    await page.getByText("The picture could not be shown.", { exact: true }).waitFor();
    await page.evaluate(url => filePreviewFixture.replaceUrl(url), image);
    await page.waitForFunction(() => document.querySelector<HTMLImageElement>("#preview img")?.naturalWidth === 1);
    assert.equal(await page.getByText("The picture could not be shown.", { exact: true }).count(), 0);

    // Empty and non-image replacements also drop the previous image's failure.
    await page.evaluate(() => filePreviewFixture.replace({ url: "https://fenel.test/again.png", name: "again.png", mimeType: "image/png", size: 120 }));
    await page.getByText("The picture could not be shown.", { exact: true }).waitFor();
    await page.evaluate(() => filePreviewFixture.replace({ url: "data:audio/wav;base64,", name: "empty.wav", mimeType: "audio/wav", size: 0 }));
    await page.getByText("This file is empty", { exact: true }).waitFor();
    assert.equal(await page.locator("#preview img, #preview audio, #preview a").count(), 0);
    assert.equal(await page.getByText("The picture could not be shown.", { exact: true }).count(), 0);
    await page.evaluate(() => filePreviewFixture.replace({ url: "data:text/plain;base64,aGVsbG8=", name: "hello.txt", mimeType: "text/plain", size: 5 }));
    await page.getByRole("link", { name: "hello.txt" }).waitFor();
    assert.equal(await page.getByText("The picture could not be shown.", { exact: true }).count(), 0);
    assert.deepEqual(errors, []);
  } finally { await page.close(); }
});
