import { test } from "node:test";
import { strict as assert } from "node:assert";
import { chromium } from "playwright";

declare global {
  var fenelDocumentFixture: {
    debug(): unknown;
    replace(value: unknown): void;
    reset(): void;
  };
}

// C2: the built canonical fixture URL is supplied by the caller. This check
// owns its browser, reads real fields and never contacts an account service.
test("document authoring keeps one source/preview tree, safe markup and typed embedded data", async () => {
  const browser = await chromium.launch({ headless: true });
  const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } });
  const errors: string[] = [];
  page.on("pageerror", error => errors.push(error.message));
  try {
    await page.goto(process.argv[2] ?? "http://127.0.0.1:3334");
    await page.waitForFunction(() => !!globalThis.fenelDocumentFixture, undefined, { timeout: 120_000 });
    const preview = page.locator("[data-document-preview]");
    await preview.locator("article.rich-document").waitFor();
    assert.equal(await preview.getByRole("heading", { name: "An article made of data", level: 1 }).count(), 1);
    assert.equal(await preview.getByRole("heading", { name: "The same tree stays inspectable", level: 2 }).count(), 1);
    assert.match(await preview.locator("strong").innerText(), /ordinary typed data/);
    assert.match(await preview.locator(".rich-document__source").innerText(), /12, 18, 27/);
    const location = page.url();
    await preview.getByRole("link", { name: "link", exact: true }).click();
    assert.equal(page.url(), location);

    await page.locator("[data-document-editor] summary").click();
    const inputs = await page.locator("[data-document-editor] input").evaluateAll(nodes => nodes.map(node => (node as HTMLInputElement).value));
    const titleIndex = inputs.indexOf("An article made of data");
    const numberIndex = inputs.indexOf("12");
    assert.ok(titleIndex >= 0, "The shared field editor exposes the heading text");
    assert.ok(numberIndex >= 0, "The shared field editor exposes the embedded number");
    await page.locator("[data-document-editor] input").nth(titleIndex).fill("An edited article");
    await preview.getByRole("heading", { name: "An edited article", level: 1 }).waitFor();
    assert.match(await page.locator("[data-document-source]").innerText(), /An edited article/);
    await page.locator("[data-document-editor] input").nth(numberIndex).fill("99");
    await page.locator("[data-document-editor] input").nth(numberIndex).press("Tab");
    await page.waitForFunction(() => document.querySelector(".rich-document__source")?.textContent?.includes("[99, 18, 27]"));
    assert.match(await page.locator("[data-document-source]").innerText(), /\[99, 18, 27\]/);
    await page.locator("[data-document-editor] summary").click();

    await page.evaluate(() => fenelDocumentFixture.replace({ $tag: "RichDocument", blocks: [
      { $tag: "DocParagraph", content: [{ $tag: "DocText", text: "<script>window.docXss = true</script>" }] },
      { $tag: "DocParagraph", content: [{ $tag: "DocLink", url: "javascript:window.docXss = true", content: [{ $tag: "DocText", text: "unsafe link" }] }] },
      { $tag: "DocEmbed", data: { $tag: "DocNumbersData", numbers: [] }, caption: [] },
    ] }));
    await preview.getByText("<script>window.docXss = true</script>", { exact: true }).waitFor();
    assert.equal(await preview.locator("script").count(), 0);
    assert.equal(await preview.getByText("unsafe link", { exact: true }).getAttribute("href"), null);
    assert.equal(await page.evaluate(() => (globalThis as unknown as { docXss?: boolean }).docXss), undefined);
    await page.evaluate(() => fenelDocumentFixture.reset());
    await preview.getByRole("heading", { name: "An article made of data", level: 1 }).waitFor();
    await page.setViewportSize({ width: 390, height: 844 });
    assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), "The phone document fits horizontally");
    assert.deepEqual(errors, []);
  } catch (error) {
    console.error("Document fixture failure", JSON.stringify({ errors,
      debug: await page.evaluate(() => globalThis.fenelDocumentFixture?.debug()), body: await page.locator("body").innerText() }));
    throw error;
  } finally { await browser.close(); }
});
