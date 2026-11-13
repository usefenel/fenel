import { after, before, test } from "node:test";
import { strict as assert } from "node:assert";
import { readFile } from "node:fs/promises";
import { chromium, type Browser, type Page } from "playwright";
import type {} from "./locus-menu-gesture.fixture";

let browser: Browser;
let script: string;
let css: string;
before(async () => {
  [script, css] = await Promise.all([readFile(process.argv[2]!, "utf8"), readFile(process.argv[3]!, "utf8")]);
  browser = await chromium.launch({ headless: true, timeout: 30_000 });
});
after(async () => { await browser?.close(); });

/** A touch-capable context: the gestures under test only exist for a pointer
 *  that has no second button. */
async function fixture(run: (page: Page) => Promise<void>) {
  const context = await browser.newContext({ viewport: { width: 640, height: 480 }, hasTouch: true });
  const page = await context.newPage();
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  try {
    await page.route("**/*", (route) => route.fulfill({ body: "<html><body></body></html>", contentType: "text/html" }));
    await page.goto("https://fenel.test");
    await page.addStyleTag({ content: css });
    await page.addStyleTag({ content: "*{margin:0}" });
    await page.addScriptTag({ content: script, type: "module" });
    await page.waitForFunction(() => typeof locusGestureFixture !== "undefined");
    await run(page);
    assert.deepEqual(errors, []);
  } finally { await context.close(); }
}

const events = (page: Page) => page.evaluate(() => locusGestureFixture.events.slice());
const menus = (page: Page) => page.getByRole("menu").count();
/** Background: clear of the control and the card the fixture pins in place. */
const EMPTY = { x: 60, y: 320 };
const CARD = { x: 280, y: 165 };

/** Playwright can tap but not HOLD, so the raw touch stream is the instrument.
 *  `hold` leaves the finger down; the caller decides when it lifts. */
async function touch(page: Page) {
  const cdp = await page.context().newCDPSession(page);
  const send = (type: "touchStart" | "touchMove" | "touchEnd", touchPoints: Array<{ x: number; y: number }>) =>
    cdp.send("Input.dispatchTouchEvent", { type, touchPoints });
  return {
    down: (at: { x: number; y: number }) => send("touchStart", [at]),
    move: (at: { x: number; y: number }) => send("touchMove", [at]),
    up: () => send("touchEnd", []),
  };
}

test("a tap on the background opens the menu where the finger landed", () => fixture(async (page) => {
  await page.touchscreen.tap(EMPTY.x, EMPTY.y);
  await page.getByRole("menu", { name: "Data actions", exact: true }).waitFor();
  assert.deepEqual(await events(page), ["open"]);
  assert.deepEqual(await page.evaluate(() => locusGestureFixture.at()), { ...EMPTY, card: undefined });
  // The menu lands UNDER the finger, so the click the browser is still going to
  // synthesise from that tap must not be able to spend its first item.
  await page.waitForTimeout(200);
  assert.deepEqual(await events(page), ["open"]);
  assert.equal(await menus(page), 1);
  await page.getByRole("menuitem", { name: "New", exact: true }).click();
  assert.deepEqual(await events(page), ["open", "close", "new"]);
}));

test("a tap on a control or a card is that target's, not the menu's", () => fixture(async (page) => {
  await page.touchscreen.tap(280, 55);
  assert.deepEqual(await events(page), ["control"]);
  assert.equal(await menus(page), 0);
  await page.touchscreen.tap(CARD.x, CARD.y);
  assert.deepEqual(await events(page), ["control", "card"]);
  assert.equal(await menus(page), 0);
}));

test("a long press on a card opens the menu over THAT card", () => fixture(async (page) => {
  const finger = await touch(page);
  await finger.down(CARD);
  await page.getByRole("menu", { name: "Data actions", exact: true }).waitFor();
  // The menu is open while the finger is still down, which is what makes the
  // release dangerous: it lands on the menu that just appeared.
  assert.deepEqual(await events(page), ["open:card-1"]);
  await finger.up();
  await page.waitForTimeout(250);
  // The card's own click did not fire, and neither did any menu item's.
  assert.deepEqual(await events(page), ["open:card-1"]);
  assert.equal(await menus(page), 1);
  assert.deepEqual(await page.evaluate(() => locusGestureFixture.at()), { ...CARD, card: "card-1" });
  await page.getByRole("menuitem", { name: "Remove from view", exact: true }).click();
  assert.deepEqual(await events(page), ["open:card-1", "close", "remove:card-1"]);
}));

test("a hold that turns into a drag opens nothing and leaves the card alone", () => fixture(async (page) => {
  const finger = await touch(page);
  await finger.down(CARD);
  await finger.move({ x: CARD.x, y: CARD.y - 60 });
  await page.waitForTimeout(700);
  assert.equal(await menus(page), 0);
  await finger.up();
  await page.waitForTimeout(150);
  assert.equal(await menus(page), 0);
  assert.deepEqual(await events(page), []);
}));

test("a mouse keeps its own gesture: click does nothing, right-click opens", () => fixture(async (page) => {
  await page.mouse.click(EMPTY.x, EMPTY.y);
  assert.equal(await menus(page), 0);
  assert.deepEqual(await events(page), []);
  await page.mouse.down({ button: "right" });
  await page.waitForTimeout(700);
  await page.mouse.up({ button: "right" });
  await page.getByRole("menu").waitFor();
  // Holding a mouse button down is not a long press, so exactly one menu.
  assert.deepEqual(await events(page), ["open"]);
}));

test("a tap away from an open menu dismisses it instead of moving it", () => fixture(async (page) => {
  await page.touchscreen.tap(EMPTY.x, EMPTY.y);
  await page.getByRole("menu").waitFor();
  await page.touchscreen.tap(520, 400);
  await page.getByRole("menu").waitFor({ state: "detached" });
  assert.deepEqual(await events(page), ["open", "close"]);
  // The surface is still live: the next tap opens again, at the new point.
  await page.touchscreen.tap(520, 400);
  await page.getByRole("menu").waitFor();
  assert.deepEqual(await events(page), ["open", "close", "open"]);
  assert.deepEqual(await page.evaluate(() => locusGestureFixture.at()), { x: 520, y: 400, card: undefined });
}));

test("a finger that panned across the background was never a tap", () => fixture(async (page) => {
  const finger = await touch(page);
  await finger.down(EMPTY);
  for (const step of [20, 45, 80]) await finger.move({ x: EMPTY.x + step, y: EMPTY.y - step });
  await finger.up();
  await page.waitForTimeout(150);
  assert.equal(await menus(page), 0);
  assert.deepEqual(await events(page), []);
}));

test("a tap while text is selected clears the selection rather than opening", () => fixture(async (page) => {
  await page.evaluate(() => {
    const range = document.createRange();
    range.selectNodeContents(document.getElementById("card")!);
    getSelection()!.addRange(range);
  });
  await page.touchscreen.tap(EMPTY.x, EMPTY.y);
  await page.waitForTimeout(150);
  assert.equal(await menus(page), 0);
  assert.deepEqual(await events(page), []);
}));
