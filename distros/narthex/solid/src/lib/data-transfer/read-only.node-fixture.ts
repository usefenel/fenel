import { after, before, test } from "node:test";
import { strict as assert } from "node:assert";
import { readFile } from "node:fs/promises";
import { chromium, type Browser, type Page } from "playwright";
import type {} from "./read-only.browser-fixture";

let browser: Browser;
let script: string;
before(async () => {
  script = await readFile(process.argv[2]!, "utf8");
  browser = await chromium.launch({ headless: true, timeout: 30_000, channel: process.env["FENEL_TEST_BROWSER_CHANNEL"] });
});
after(async () => { await browser?.close(); });

async function fixture(run: (page: Page) => Promise<void>) {
  const page = await browser.newPage({ viewport: { width: 1024, height: 768 } });
  page.setDefaultTimeout(10_000);
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  try {
    await page.route("**/*", (route) => route.fulfill({ contentType: "text/html", body: "<html><body></body></html>" }));
    await page.goto("https://fenel.test");
    await page.addScriptTag({ content: script, type: "module" });
    await page.locator("#value canvas").waitFor();
    await run(page);
    assert.deepEqual(errors, []);
  } finally { await page.close(); }
}

test("read-only nested images and lists retain media previews and copy commands", async () => fixture(async (page) => {
  assert.equal(await page.locator("#value canvas").count(), 1);
  await page.getByRole("button", { name: "Show 2 items" }).click();
  assert.equal(await page.locator("#value canvas").count(), 3);
  const capabilities = await page.evaluate(() => readOnlyFixture.capabilities());
  assert.ok(capabilities.every((entry) => !/paste|drop/i.test(entry.label ?? "")));
  assert.ok(capabilities.length >= 6);
  assert.ok(capabilities.every((entry) => entry.copy === true && entry.paste === false));
  const pixel = await page.locator("#value canvas").first().evaluate((canvas) => Array.from((canvas as HTMLCanvasElement).getContext("2d")!.getImageData(0, 0, 2, 1).data));
  assert.deepEqual(pixel, [20, 60, 100, 255, 200, 150, 50, 255]);
}));

test("Copy and drag-out retain the complete data while native selections keep their browser behavior", async () => fixture(async (page) => {
  const copied = await page.locator("#value [data-fenel-transfer-target]").first().evaluate((node) => {
    const data = new DataTransfer();
    const event = new ClipboardEvent("copy", { clipboardData: data, bubbles: true, cancelable: true });
    node.dispatchEvent(event);
    return { prevented: event.defaultPrevented, payload: data.getData("application/x-fenel-value+json") };
  });
  assert.equal(copied.prevented, true);
  assert.ok(copied.payload);
  await page.waitForFunction(() => readOnlyFixture.state().history.length === 1);
  assert.deepEqual(await page.evaluate((payload) => readOnlyFixture.decode(payload), copied.payload), (await page.evaluate(() => readOnlyFixture.state())).value);
  await page.locator("#value .fenel-transfer-copy").first().dragTo(page.locator("#drag-destination"));
  const dragged = (await page.evaluate(() => readOnlyFixture.state())).dragged;
  assert.equal(dragged?.effect, "copy");
  assert.equal(dragged?.payload, copied.payload);
  assert.equal((await page.evaluate(() => readOnlyFixture.state())).history.length, 1, "dragging must not append Clipboard history");
  await page.context().grantPermissions(["clipboard-read", "clipboard-write"], { origin: "https://fenel.test" });
  const nestedTarget = page.locator("#value [data-fenel-transfer-target]").nth(1);
  // A native copy handler can stop the event before it bubbles to document.
  // The explicit button command must own its real event and its payload.
  await page.evaluate(() => {
    document.body.oncopy = (event) => {
      const data = event.clipboardData;
      if (!data) return;
      data.setData("text/plain", "previously focused data");
      event.preventDefault(); event.stopPropagation();
    };
  });
  await nestedTarget.locator(":scope > .fenel-transfer-actions > .fenel-transfer-copy").click();
  await page.waitForFunction(() => readOnlyFixture.state().history.length === 2);
  await page.waitForFunction(() => !!document.querySelector("#value .fenel-transfer-status, #value .fenel-transfer-flash"));
  assert.equal(await page.locator("#value .fenel-transfer-status").count(), 0);
  assert.equal(await nestedTarget.locator(":scope > .fenel-transfer-flash").textContent(), "Copied");
  const nestedClipboard = await page.evaluate(async () => {
    const [item] = await navigator.clipboard.read();
    const html = await (await item!.getType("text/html")).text();
    const encoded = new DOMParser().parseFromString(html, "text/html").querySelector('span[data-fenel-clipboard="application/x-fenel-value+json;version=1"]')!.getAttribute("data-fenel-value")!;
    const payload = new TextDecoder().decode(Uint8Array.from(atob(encoded), (character) => character.charCodeAt(0)));
    return { payload, plain: await navigator.clipboard.readText() };
  });
  assert.equal(nestedClipboard.plain, "1");
  assert.equal(await page.evaluate((payload) => readOnlyFixture.decode(payload), nestedClipboard.payload), 1);
  assert.equal((await page.evaluate(() => readOnlyFixture.state())).changes, 0);
  await page.evaluate(() => { document.body.oncopy = null; });
  const native = await page.getByRole("textbox", { name: "Native text" }).evaluate((node) => {
    const event = new ClipboardEvent("copy", { clipboardData: new DataTransfer(), bubbles: true, cancelable: true });
    node.dispatchEvent(event); return event.defaultPrevented;
  });
  assert.equal(native, false);
  const selected = await page.evaluate(() => {
    const range = document.createRange(); range.selectNodeContents(document.querySelector("#selected-text")!);
    window.getSelection()!.removeAllRanges(); window.getSelection()!.addRange(range);
    const target = document.querySelector("#direct [data-fenel-transfer-target]")!;
    const event = new ClipboardEvent("copy", { clipboardData: new DataTransfer(), bubbles: true, cancelable: true });
    target.dispatchEvent(event); return event.defaultPrevented;
  });
  assert.equal(selected, false);
}));

test("read-only keyboard, drop and cached-menu ingress cannot mutate or reach an editable ancestor", async () => fixture(async (page) => {
  const events = await page.locator("#value [data-fenel-transfer-target]").nth(1).evaluate((node) => {
    const data = new DataTransfer(); data.setData("text/plain", "9");
    const paste = new ClipboardEvent("paste", { clipboardData: data, bubbles: true, cancelable: true });
    const over = new DragEvent("dragover", { dataTransfer: data, bubbles: true, cancelable: true });
    const drop = new DragEvent("drop", { dataTransfer: data, bubbles: true, cancelable: true });
    node.dispatchEvent(paste); node.dispatchEvent(over); node.dispatchEvent(drop);
    return { paste: paste.defaultPrevented, over: over.defaultPrevented, drop: drop.defaultPrevented, effect: data.dropEffect };
  });
  assert.deepEqual(events, { paste: true, over: true, drop: true, effect: "none" });
  await page.evaluate(() => readOnlyFixture.paste("#value [data-fenel-transfer-target]"));
  const state = await page.evaluate(() => readOnlyFixture.state());
  assert.equal(state.changes, 0); assert.equal(state.analysis, 0); assert.equal(state.ancestor, 0); assert.equal(state.value.count, 1);
  assert.equal(await page.locator(".fenel-transfer-drop").count(), 0);
}));

test("the existing editable nested import still publishes one change with the correct path", async () => fixture(async (page) => {
  await page.evaluate(() => readOnlyFixture.editable(true));
  assert.deepEqual(await page.evaluate(() => readOnlyFixture.commands("#value [data-fenel-transfer-target]")), { copy: true, paste: true });
  await page.locator("#value [data-fenel-transfer-target]").nth(1).evaluate((node) => {
    const data = new DataTransfer(); data.setData("text/plain", "9");
    node.dispatchEvent(new ClipboardEvent("paste", { clipboardData: data, bubbles: true, cancelable: true }));
  });
  await page.waitForFunction(() => readOnlyFixture.state().changes === 1);
  const state = await page.evaluate(() => readOnlyFixture.state());
  assert.equal(state.value.count, 9); assert.equal(state.analysis, 1); assert.equal(state.ancestor, 0);
  assert.deepEqual(state.editPath, ["count"]);
  assert.equal(state.value.filteredImages.length, 2);
}));

test("removing editing while nested adaptation is pending aborts without publishing", async () => fixture(async (page) => {
  await page.evaluate(() => { readOnlyFixture.editable(true); readOnlyFixture.hold(); });
  await page.locator("#value [data-fenel-transfer-target]").nth(1).evaluate((node) => {
    const data = new DataTransfer(); data.setData("text/plain", "9");
    node.dispatchEvent(new ClipboardEvent("paste", { clipboardData: data, bubbles: true, cancelable: true }));
  });
  await page.waitForFunction(() => readOnlyFixture.state().analysis === 1);
  await page.evaluate(() => { readOnlyFixture.editable(false); readOnlyFixture.release(); });
  await page.waitForFunction(() => !document.querySelector('[aria-busy="true"]'));
  const state = await page.evaluate(() => readOnlyFixture.state());
  assert.equal(state.aborted, true); assert.equal(state.changes, 0); assert.equal(state.value.count, 1);
  assert.equal(await page.locator('[role="status"]').count(), 0);
  assert.deepEqual(await page.evaluate(() => readOnlyFixture.commands("#value [data-fenel-transfer-target]")), { copy: true, paste: false });
}));

test("a late cancelled target cannot clear a newer import's busy state", async () => fixture(async (page) => {
  await page.evaluate(() => { readOnlyFixture.editable(true); void readOnlyFixture.startDirect(); });
  await page.waitForFunction(() => readOnlyFixture.state().directStarted === 1);
  await page.evaluate(() => { readOnlyFixture.editable(false); });
  assert.equal((await page.evaluate(() => readOnlyFixture.state())).directAborted, true);
  await page.evaluate(() => { readOnlyFixture.releaseDirect(); readOnlyFixture.editable(true); void readOnlyFixture.startDirect(); });
  await page.waitForFunction(() => readOnlyFixture.state().directStarted === 2);
  assert.equal(await page.locator('#direct [aria-busy="true"]').count(), 1);
  await page.evaluate(() => readOnlyFixture.releaseDirect());
  await page.waitForFunction(() => !document.querySelector('#direct [aria-busy="true"]'));
  assert.equal((await page.evaluate(() => readOnlyFixture.state())).directPublished, 1);
}));

test("recomputed lists retain inspected paths and update the displayed and copied values", async () => fixture(async (page) => {
  const result = (score: number) => ({ matches: [{ name: "Ada", evidence: { $tag: "Just", _0: { score } } }] });
  await page.evaluate((value) => readOnlyFixture.inspect(value), result(42));
  await page.locator("#inspection").getByRole("button", { name: "Show 1 items" }).click();
  const row = page.locator("#inspection .home-item__list-cell").first();
  await row.locator("summary").first().click();
  await row.locator("summary").filter({ hasText: "Just" }).click();
  await row.getByText("_0", { exact: true }).locator("..").locator("summary").click();
  await page.evaluate(() => {
    (document.querySelector("#inspection .home-item__list-cell details") as any).inspectionIdentity = true;
  });
  await page.evaluate((value) => readOnlyFixture.inspect(value), result(84));
  assert.equal(await row.locator("details").first().evaluate((node) => (node as any).inspectionIdentity), true);
  assert.ok((await row.locator("details").evaluateAll((nodes) => nodes.map((node) => (node as HTMLDetailsElement).open))).every(Boolean));
  assert.ok((await row.textContent())!.includes("84"));
  assert.ok(!(await row.textContent())!.includes("42"));
  const copied = await row.locator("[data-fenel-transfer-target]").first().evaluate((node) => {
    const data = new DataTransfer();
    node.dispatchEvent(new ClipboardEvent("copy", { clipboardData: data, bubbles: true, cancelable: true }));
    return data.getData("application/x-fenel-value+json");
  });
  assert.deepEqual(await page.evaluate((payload) => readOnlyFixture.decode(payload), copied), result(84).matches[0]);
}));

test("list inspection keeps pagination, releases removed rows and updates their positional paths", async () => fixture(async (page) => {
  const values = (offset: number, count: number) => ({ matches: Array.from({ length: count }, (_, index) => ({ score: offset + index })) });
  await page.evaluate((value) => readOnlyFixture.inspect(value), values(0, 12));
  await page.locator("#inspection").getByRole("button", { name: "Show 12 items" }).click();
  assert.equal(await page.locator("#inspection .home-item__list-cell").count(), 8);
  await page.locator("#inspection").getByRole("button", { name: "Show more items" }).click();
  await page.locator("#inspection .home-item__list-cell").nth(10).locator("summary").click();
  await page.evaluate((value) => readOnlyFixture.inspect(value), values(100, 12));
  assert.equal(await page.locator("#inspection .home-item__list-cell").count(), 12);
  const retained = page.locator("#inspection .home-item__list-cell").nth(10);
  assert.equal(await retained.locator("details").evaluate((node) => (node as HTMLDetailsElement).open), true);
  assert.ok((await retained.textContent())!.includes("110"));
  await page.evaluate((value) => readOnlyFixture.inspect(value), values(200, 3));
  assert.equal(await page.locator("#inspection .home-item__list-cell").count(), 3);
  await page.evaluate((value) => readOnlyFixture.inspect(value), values(300, 12));
  assert.equal(await page.locator("#inspection .home-item__list-cell").count(), 12);
  assert.equal(await page.locator("#inspection .home-item__list-cell").nth(10).locator("details").evaluate((node) => (node as HTMLDetailsElement).open), false);
}));

test("contained previews read the current child without remounting its wrapper", async () => fixture(async (page) => {
  await page.evaluate(() => readOnlyFixture.inspect({ answer: { score: 42 } }));
  const preview = page.locator('#inspection-hover [data-child-label="answer"]');
  await preview.evaluate((node) => { (node as any).previewIdentity = true; });
  await page.evaluate(() => readOnlyFixture.inspect({ answer: { score: 84 } }));
  assert.equal(await preview.evaluate((node) => (node as any).previewIdentity), true);
  assert.equal(await preview.locator(":scope > output").textContent(), '{"score":84}');
}));

test("changing a retained child's structure removes old fields and renders its current kind", async () => fixture(async (page) => {
  await page.evaluate(() => readOnlyFixture.inspect({ answer: { $tag: "Just", _0: { score: 42 } } }));
  await page.locator("#inspection summary").filter({ hasText: "Just" }).click();
  await page.locator("#inspection").getByText("_0", { exact: true }).locator("..").locator("summary").click();
  await page.evaluate(() => readOnlyFixture.inspect({ answer: 84 }));
  assert.equal(await page.locator("#inspection details").count(), 1);
  assert.ok((await page.locator("#inspection").textContent())!.includes("84"));
  assert.ok(!(await page.locator("#inspection").textContent())!.includes("score"));
  await page.evaluate(() => readOnlyFixture.inspect({ answer: { $tag: "Nothing" } }));
  assert.equal(await page.locator("#inspection summary").filter({ hasText: "Nothing" }).count(), 1);
  assert.equal(await page.locator("#inspection").getByText("_0", { exact: true }).count(), 0);
  await page.evaluate(() => readOnlyFixture.inspect({}));
  assert.equal(await page.locator("#inspection [data-fenel-transfer-target]").count(), 1);
}));

test("a retained nested import refuses an inherited type change even when its value is equal", async () => fixture(async (page) => {
  await page.evaluate(() => { readOnlyFixture.editable(true); readOnlyFixture.hold(); });
  await page.locator("#value [data-fenel-transfer-target]").nth(1).evaluate((node) => {
    const data = new DataTransfer(); data.setData("text/plain", "9");
    node.dispatchEvent(new ClipboardEvent("paste", { clipboardData: data, bubbles: true, cancelable: true }));
  });
  await page.waitForFunction(() => readOnlyFixture.state().analysis === 1);
  await page.evaluate(() => {
    readOnlyFixture.type({ $record: { fields: [{ name: "count", type: { $ref: "String" }, label: { $tag: "Nothing" }, ui: { $tag: "Nothing" }, meta: {} }] } });
    readOnlyFixture.release();
  });
  await page.waitForFunction(() => !document.querySelector('#value [aria-busy="true"]'));
  assert.equal((await page.evaluate(() => readOnlyFixture.state())).changes, 0);
  assert.equal((await page.evaluate(() => readOnlyFixture.state())).value.count, 1);
  assert.ok((await page.locator("#value .fenel-transfer-status").textContent())!.includes("changed during import"));
}));
