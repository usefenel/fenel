import { after, before, test } from "node:test";
import { strict as assert } from "node:assert";
import { readFile, writeFile } from "node:fs/promises";
import { chromium, type Browser, type Page } from "playwright";
import type {} from "./locus-context-menu.fixture";

let browser: Browser;
let script: string;
let css: string;
before(async () => {
  [script, css] = await Promise.all([readFile(process.argv[2]!, "utf8"), readFile(process.argv[3]!, "utf8")]);
  browser = await chromium.launch({ headless: true, timeout: 30_000, channel: process.env["FENEL_TEST_BROWSER_CHANNEL"] });
});
after(async () => { await browser?.close(); });

async function fixture(run: (page: Page) => Promise<void>) {
  const page = await browser.newPage({ viewport: { width: 640, height: 480 } });
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  try {
    await page.route("**/*", (route) => route.fulfill({ body: "<html><body></body></html>", contentType: "text/html" }));
    await page.goto("https://fenel.test");
    await page.addStyleTag({ content: css });
    await page.addScriptTag({ content: script, type: "module" });
    await page.waitForFunction(() => typeof locusMenuFixture !== "undefined");
    await run(page);
    assert.deepEqual(errors, []);
  } finally { await page.close(); }
}

async function pendingSuggestions(page: Page, pointer = false) {
  await page.evaluate(() => locusMenuFixture.replaceItems([
    { id: "suggestions", label: "Suggestions", children: [{ id: "pending", label: "Preparing suggestions", disabled: true }] },
    { id: "copy", label: "Copy" },
  ]));
  await page.getByRole("button", { name: "Open menu", exact: true }).press("Enter");
  await page.waitForFunction(() => document.activeElement?.getAttribute("data-locus-menu-item") === "suggestions");
  if (pointer) await page.getByRole("menuitem", { name: "Suggestions", exact: true }).hover();
  else {
    await page.keyboard.press("ArrowRight");
    await page.waitForFunction(() => document.activeElement?.getAttribute("aria-label") === "Suggestions");
  }
}

async function resolveSuggestions(page: Page) {
  await page.evaluate(() => locusMenuFixture.replaceItems([
    { id: "suggestions", label: "Suggestions", children: [
      { id: "disabled", label: "Unavailable suggestion", disabled: true },
      { id: "first", label: "First suggestion" },
      { id: "second", label: "Second suggestion" },
    ] },
    { id: "copy", label: "Copy" },
  ]));
  await page.waitForTimeout(100);
}

test("Home's actual menu owner retains its root and focus across async item updates", () => fixture(async page => {
  await page.evaluate(() => {
    homeMenuLifetimeFixture.rows([{ id: "first", label: "First row" }, { id: "second", label: "Second row" }]);
    homeMenuLifetimeFixture.open("first target");
  });
  const root = page.getByRole("menu", { name: "Data actions", exact: true });
  await root.waitFor();
  const owned = await root.elementHandle();
  await page.getByRole("menuitem", { name: "Second row", exact: true }).focus();
  await page.evaluate(() => homeMenuLifetimeFixture.rows([{ id: "first", label: "First row updated" }, { id: "second", label: "Second row updated" }]));
  await page.getByRole("menuitem", { name: "Second row updated", exact: true }).waitFor();
  assert.equal(await owned!.evaluate(element => element === document.querySelector('[role="menu"]')), true);
  assert.equal(await page.evaluate(() => document.activeElement?.getAttribute("data-locus-menu-item")), "second");
  assert.deepEqual(await page.evaluate(() => homeMenuLifetimeFixture.closes), []);
}));

test("Home's actual menu owner retains its root for a keepOpen action", () => fixture(async page => {
  await page.evaluate(() => homeMenuLifetimeFixture.open("kept target"));
  const root = page.getByRole("menu", { name: "Data actions", exact: true });
  await root.waitFor();
  const owned = await root.elementHandle();
  await page.getByRole("menuitem", { name: "More rows", exact: true }).press("Enter");
  await page.getByRole("menuitem", { name: "Ready row", exact: true }).waitFor();
  assert.equal(await owned!.evaluate(element => element === document.querySelector('[role="menu"]')), true);
  assert.equal(await root.evaluate(element => element === document.activeElement || element.contains(document.activeElement)), true);
  assert.deepEqual(await page.evaluate(() => homeMenuLifetimeFixture.closes), []);
  await page.keyboard.press("Escape");
  await root.waitFor({ state: "detached" });
  assert.deepEqual(await page.evaluate(() => homeMenuLifetimeFixture.closes), ["data"]);
}));

test("Home's actual menu target replacement creates a new menu owner", () => fixture(async page => {
  await page.evaluate(() => homeMenuLifetimeFixture.open("old target"));
  const root = page.getByRole("menu", { name: "Data actions", exact: true });
  await root.waitFor();
  const owned = await root.elementHandle();
  await page.evaluate(() => homeMenuLifetimeFixture.open("new target"));
  await page.getByRole("menuitem", { name: "Select new target", exact: true }).waitFor();
  assert.equal(await owned!.evaluate(element => element.isConnected), false, "A new target owns a fresh menu lifetime");
  assert.equal(await root.count(), 1);
  assert.deepEqual(await page.evaluate(() => homeMenuLifetimeFixture.closes), []);
}));

test("Home's actual action and close retain the original synchronous gesture and owner", () => fixture(async page => {
  await page.evaluate(() => homeMenuLifetimeFixture.open("selected target"));
  await page.getByRole("menuitem", { name: "Select selected target", exact: true }).press("Enter");
  await page.getByRole("menu").waitFor({ state: "detached" });
  assert.deepEqual(await page.evaluate(() => homeMenuLifetimeFixture.actions), [
    { target: "selected target", userActivated: true, menuPresent: true },
  ]);
  assert.deepEqual(await page.evaluate(() => homeMenuLifetimeFixture.closes), ["data"]);
  await page.evaluate(() => { homeMenuLifetimeFixture.rows([{ id: "ready", label: "Ready suggestion" }]); homeMenuLifetimeFixture.open("lens target", true); });
  await page.getByRole("menu", { name: "Suggestions", exact: true }).waitFor();
  await page.getByRole("menuitem", { name: "Ready suggestion", exact: true }).press("Escape");
  await page.getByRole("menu").waitFor({ state: "detached" });
  assert.deepEqual(await page.evaluate(() => homeMenuLifetimeFixture.closes), ["data", "lens"]);
}));

async function intentSuggestions(page: Page, ready = false) {
  await page.evaluate(ready => locusMenuFixture.replaceItems([
    { id: "intent", label: "Suggestions", onOpen: () => locusMenuFixture.events.push({
      action: "submenu-intent", userActivated: navigator.userActivation.isActive,
    }), children: [{ id: ready ? "result" : "pending", label: ready ? "Ready suggestion" : "Checking suggestions…", disabled: !ready }] },
    { id: "copy", label: "Copy" },
  ]), ready);
}

test("submenu opening callbacks cover pointer, chevron and keyboard intent without running on focus", () => fixture(async page => {
  for (const method of ["ArrowRight", "Enter", "Space", "pointer", "chevron"]) {
    await page.mouse.move(5, 470);
    await intentSuggestions(page);
    await page.evaluate(() => { locusMenuFixture.events.length = 0; });
    await page.getByRole("button", { name: "Open menu", exact: true }).press("Enter");
    await page.waitForFunction(() => document.activeElement?.getAttribute("data-locus-menu-item") === "intent");
    assert.equal(await page.evaluate(() => locusMenuFixture.events.length), 0, `${method}: initial focus is not open intent`);
    if (method === "pointer") await page.getByRole("menuitem", { name: "Suggestions", exact: true }).hover();
    else if (method === "chevron") await page.locator('[data-locus-menu-item="intent"] .locus-context-menu-chevron').click();
    else await page.keyboard.press(method);
    await page.getByRole("menu", { name: "Suggestions", exact: true }).waitFor();
    assert.ok(await page.evaluate(() => locusMenuFixture.events.some(row => row.action === "submenu-intent")), method);
    // Chevron clicks can include pointer entry first. The requesting Home
    // owner keeps its synchronous once guard across those two open intents.
    await page.keyboard.press("Escape");
    await page.getByRole("menu").waitFor({ state: "detached" });
  }
}));

test("async focus repair and ordinary focus never invoke a submenu opening callback", () => fixture(async page => {
  await page.mouse.move(5, 470);
  await intentSuggestions(page);
  await page.getByRole("button", { name: "Open menu", exact: true }).press("Enter");
  await page.waitForFunction(() => document.activeElement?.getAttribute("data-locus-menu-item") === "intent");
  await page.getByRole("menuitem", { name: "Suggestions", exact: true }).focus();
  await intentSuggestions(page, true);
  await page.waitForTimeout(100);
  assert.equal(await page.evaluate(() => locusMenuFixture.events.length), 0);
  await page.keyboard.press("ArrowRight");
  await page.waitForFunction(() => document.activeElement?.getAttribute("data-locus-menu-item") === "result");
  const before = await page.evaluate(() => locusMenuFixture.events.length);
  await intentSuggestions(page, true);
  await page.waitForTimeout(100);
  assert.equal(await page.evaluate(() => locusMenuFixture.events.length), before, "Rendering/focus repair cannot reopen work");
}));

test("a viewport-clamped Suggestions submenu still treats pointer entry as intent without requiring a click", () => fixture(async page => {
  await page.mouse.move(5, 5);
  await intentSuggestions(page);
  await page.evaluate(() => locusMenuFixture.open(638, 478));
  const root = page.getByRole("menu", { name: "Data actions", exact: true });
  await root.waitFor();
  const bounds = await root.boundingBox();
  assert.ok(bounds && bounds.x + bounds.width <= 632 && bounds.y + bounds.height <= 472);
  await page.waitForFunction(() => document.activeElement?.getAttribute("data-locus-menu-item") === "intent");
  assert.equal(await page.evaluate(() => locusMenuFixture.events.length), 0);
  await page.getByRole("menuitem", { name: "Suggestions", exact: true }).hover();
  await page.getByRole("menu", { name: "Suggestions", exact: true }).waitFor();
  assert.ok(await page.evaluate(() => locusMenuFixture.events.some(row => row.action === "submenu-intent")));
}));

test("async submenu options retain keyboard focus and Escape dismisses without a focus workaround", () => fixture(async page => {
  await page.evaluate(() => {
    const events: unknown[] = [];
    Object.assign(globalThis, { asyncMenuFocusEvents: events });
    for (const type of ["focusin", "focusout"]) document.addEventListener(type, event => {
      const target = event.target as HTMLElement;
      const related = (event as FocusEvent).relatedTarget as HTMLElement | null;
      events.push({ type, target: target.outerHTML.slice(0, 220), connected: target.isConnected, related: related?.outerHTML.slice(0, 120) });
    });
  });
  await pendingSuggestions(page);
  await resolveSuggestions(page);
  const capture = process.env["FENEL_LOCUS_ASYNC_FOCUS_CAPTURE"];
  if (capture) {
    await page.screenshot({ path: capture });
    await writeFile(`${capture}.json`, JSON.stringify(await page.evaluate(() => ({
      viewport: { width: innerWidth, height: innerHeight },
      activeElement: document.activeElement?.outerHTML.slice(0, 300),
      events: (globalThis as typeof globalThis & { asyncMenuFocusEvents: unknown[] }).asyncMenuFocusEvents,
    })), null, 2));
  }
  assert.equal(await page.evaluate(() => document.activeElement?.getAttribute("data-locus-menu-item")), "first");
  await page.keyboard.press("ArrowDown");
  assert.equal(await page.evaluate(() => document.activeElement?.getAttribute("data-locus-menu-item")), "second");
  await page.keyboard.press("ArrowLeft");
  assert.equal(await page.evaluate(() => document.activeElement?.getAttribute("data-locus-menu-item")), "suggestions");
  await page.keyboard.press("Escape");
  assert.equal(await page.getByRole("menu").count(), 0);
  assert.equal(await page.locator("#trigger").evaluate(element => document.activeElement === element), true);
}));

test("async menu replacement retains a surviving item and falls back when the focused item disappears", () => fixture(async page => {
  await pendingSuggestions(page);
  await resolveSuggestions(page);
  // Establish actual current focus independently of the pending-panel repair.
  await page.getByRole("menuitem", { name: "Second suggestion", exact: true }).focus();
  await page.evaluate(() => locusMenuFixture.replaceItems([
    { id: "suggestions", label: "Suggestions", children: [{ id: "first", label: "First suggestion" }, { id: "second", label: "Second suggestion updated" }] },
  ]));
  await page.waitForTimeout(100);
  assert.equal(await page.evaluate(() => document.activeElement?.getAttribute("data-locus-menu-item")), "second");
  await page.evaluate(() => locusMenuFixture.replaceItems([
    { id: "suggestions", label: "Suggestions", children: [{ id: "first", label: "First suggestion" }] },
  ]));
  await page.waitForTimeout(100);
  assert.equal(await page.evaluate(() => document.activeElement?.getAttribute("data-locus-menu-item")), "first");
}));

test("async rows do not steal focus after deliberate blur, outside focus, or dismissal", () => fixture(async page => {
  await pendingSuggestions(page);
  await page.evaluate(() => (document.activeElement as HTMLElement).blur());
  await resolveSuggestions(page);
  assert.equal(await page.evaluate(() => document.activeElement === document.body), true);
  await page.getByRole("textbox", { name: "Outside input", exact: true }).focus();
  await page.getByRole("menu").waitFor({ state: "detached" });
  await resolveSuggestions(page);
  assert.equal(await page.getByRole("textbox", { name: "Outside input", exact: true }).evaluate(element => document.activeElement === element), true);
  await pendingSuggestions(page);
  await page.evaluate(() => {
    locusMenuFixture.replaceItems([{ id: "late", label: "Late result" }]);
    document.activeElement!.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true, cancelable: true }));
  });
  await page.waitForTimeout(100);
  assert.equal(await page.getByRole("menu").count(), 0);
  assert.equal(await page.locator("#trigger").evaluate(element => document.activeElement === element), true);
}));

test("pointer opening does not move focus into a pending submenu when options arrive", () => fixture(async page => {
  await pendingSuggestions(page, true);
  await resolveSuggestions(page);
  assert.equal(await page.evaluate(() => document.activeElement?.getAttribute("data-locus-menu-item")), "suggestions");
  await page.keyboard.press("ArrowRight");
  await page.waitForFunction(() => document.activeElement?.getAttribute("data-locus-menu-item") === "first");
}));

test("all-disabled results retain the pending panel, and a newly disabled current row is skipped", () => fixture(async page => {
  await pendingSuggestions(page);
  await page.evaluate(() => locusMenuFixture.replaceItems([
    { id: "suggestions", label: "Suggestions", children: [{ id: "unavailable", label: "No available suggestions", disabled: true }] },
  ]));
  await page.waitForTimeout(100);
  assert.equal(await page.evaluate(() => document.activeElement?.getAttribute("aria-label")), "Suggestions");
  await resolveSuggestions(page);
  await page.getByRole("menuitem", { name: "Second suggestion", exact: true }).focus();
  await page.evaluate(() => locusMenuFixture.replaceItems([
    { id: "suggestions", label: "Suggestions", children: [
      { id: "second", label: "Second suggestion", disabled: true }, { id: "first", label: "First suggestion" },
    ] },
  ]));
  await page.waitForTimeout(100);
  assert.equal(await page.evaluate(() => document.activeElement?.getAttribute("data-locus-menu-item")), "first");
  await page.evaluate(() => locusMenuFixture.replaceItems([{ id: "copy", label: "Copy" }]));
  await page.waitForTimeout(100);
  assert.equal(await page.evaluate(() => document.activeElement?.getAttribute("data-locus-menu-item")), "copy");
}));

test("same-tick deliberate blur and owner disposal prevent a queued focus repair", () => fixture(async page => {
  await pendingSuggestions(page);
  await page.evaluate(() => {
    (document.activeElement as HTMLElement).blur();
    locusMenuFixture.replaceItems([{ id: "changed", label: "Changed row" }]);
  });
  await page.waitForTimeout(100);
  assert.equal(await page.evaluate(() => document.activeElement === document.body), true);
  await page.getByRole("textbox", { name: "Outside input", exact: true }).focus();
  await pendingSuggestions(page);
  await page.evaluate(() => {
    locusMenuFixture.replaceItems([{ id: "disposed", label: "Disposed row" }]);
    locusMenuFixture.dispose();
  });
  await page.waitForTimeout(100);
  assert.equal(await page.getByRole("menu").count(), 0);
  assert.equal(await page.evaluate(() => document.activeElement === document.body), true);
}));

test("keyboard navigation skips disabled items, enters/leaves submenus, and preserves the full New action", () => fixture(async (page) => {
  await page.getByRole("button", { name: "Open menu" }).click();
  const active = () => page.evaluate(() => document.activeElement?.getAttribute("data-locus-menu-item"));
  await page.waitForFunction(() => document.activeElement?.getAttribute("data-locus-menu-item") === "new");
  assert.equal(await active(), "new");
  await page.keyboard.press("ArrowDown");
  assert.equal(await active(), "copy");
  await page.keyboard.press("End");
  assert.equal(await active(), "delete");
  await page.keyboard.press("Home");
  await page.keyboard.press("ArrowRight");
  await page.waitForFunction(() => document.activeElement?.getAttribute("data-locus-menu-item") === "expression");
  await page.keyboard.press("ArrowLeft");
  assert.equal(await active(), "new");
  assert.equal(await page.getByRole("menu", { name: "New", exact: true }).count(), 0);
  await page.keyboard.press("Enter");
  await page.getByRole("menu").waitFor({ state: "detached" });
  assert.deepEqual(await page.evaluate(() => ({ events: locusMenuFixture.events, closed: locusMenuFixture.closed() })), {
    events: [{ action: "new", userActivated: true }], closed: 1,
  });
}));

test("New hover and its split chevron expose quick types without replacing the main click action", () => fixture(async (page) => {
  await page.getByRole("button", { name: "Open menu" }).click();
  await page.getByRole("menuitem", { name: "New", exact: true }).hover();
  await page.getByRole("menu", { name: "New", exact: true }).waitFor();
  await page.getByRole("menuitem", { name: "New", exact: true }).click({ position: { x: 20, y: 16 } });
  assert.deepEqual(await page.evaluate(() => locusMenuFixture.events), [{ action: "new", userActivated: true }]);
  await page.getByRole("button", { name: "Open menu" }).click();
  await page.locator('[data-locus-menu-item="new"] .locus-context-menu-chevron').click();
  await page.waitForFunction(() => document.activeElement?.getAttribute("data-locus-menu-item") === "expression");
  await page.getByRole("menuitem", { name: "Expression", exact: true }).click();
  assert.deepEqual(await page.evaluate(() => locusMenuFixture.events), [
    { action: "new", userActivated: true }, { action: "expression", userActivated: true },
  ]);
  assert.equal(await page.getByRole("menu").count(), 0);
}));

test("menus stay inside the viewport and submenus flip to the left at the right edge", () => fixture(async (page) => {
  await page.evaluate(() => locusMenuFixture.open(638, 478));
  const menu = page.getByRole("menu", { name: "Data actions", exact: true });
  await menu.waitFor();
  const bounds = await menu.boundingBox();
  assert.ok(bounds && bounds.x >= 8 && bounds.y >= 8 && bounds.x + bounds.width <= 632 && bounds.y + bounds.height <= 472);
  await page.getByRole("menuitem", { name: "New", exact: true }).hover();
  const submenu = page.getByRole("menu", { name: "New", exact: true });
  await submenu.waitFor();
  const childBounds = await submenu.boundingBox();
  assert.ok(childBounds && childBounds.x < bounds.x && childBounds.x >= 8 && childBounds.y >= 8 && childBounds.y + childBounds.height <= 472);
  await page.setViewportSize({ width: 360, height: 300 });
  await page.waitForFunction(() => [...document.querySelectorAll('[role="menu"]')].every((element) => {
    const rect = element.getBoundingClientRect();
    return rect.x >= 8 && rect.y >= 8 && rect.right <= innerWidth - 8 && rect.bottom <= innerHeight - 8;
  }));
}));

test("disabled actions stay inert, typeahead works, and Escape/Tab/outside click dismiss correctly", () => fixture(async (page) => {
  await page.getByRole("button", { name: "Open menu" }).click();
  await page.getByRole("menuitem", { name: "Cut Ctrl+X" }).click({ force: true });
  assert.equal(await page.getByRole("menu").count(), 1);
  assert.deepEqual(await page.evaluate(() => locusMenuFixture.events), []);
  await page.keyboard.press("c");
  assert.equal(await page.evaluate(() => document.activeElement?.getAttribute("data-locus-menu-item")), "copy");
  await page.keyboard.press("Escape");
  assert.equal(await page.locator("#trigger").evaluate((element) => document.activeElement === element), true);
  await page.getByRole("button", { name: "Open menu" }).click();
  await page.keyboard.press("Tab");
  assert.equal(await page.getByRole("menu").count(), 0);
  assert.equal(await page.getByLabel("Outside input").evaluate((element) => document.activeElement === element), true);
  await page.getByRole("button", { name: "Open menu" }).click();
  await page.getByLabel("Outside input").click();
  assert.equal(await page.getByRole("menu").count(), 0);
  assert.equal(await page.getByLabel("Outside input").evaluate((element) => document.activeElement === element), true);
  assert.equal(await page.evaluate(() => locusMenuFixture.closed()), 3);
}));

test("nested menus work and disposing removes document listeners and portaled menus", () => fixture(async (page) => {
  await page.getByRole("button", { name: "Open menu" }).click();
  await page.keyboard.press("ArrowRight");
  await page.waitForFunction(() => document.activeElement?.getAttribute("data-locus-menu-item") === "expression");
  await page.keyboard.press("End");
  await page.keyboard.press("ArrowRight");
  await page.waitForFunction(() => document.activeElement?.getAttribute("data-locus-menu-item") === "nested");
  await page.keyboard.press("Enter");
  assert.deepEqual(await page.evaluate(() => locusMenuFixture.events), [{ action: "nested", userActivated: true }]);
  await page.getByRole("button", { name: "Open menu" }).click();
  await page.evaluate(() => locusMenuFixture.dispose());
  assert.equal(await page.getByRole("menu").count(), 0);
  await page.mouse.click(500, 400);
  await page.keyboard.press("Escape");
  assert.equal(await page.evaluate(() => locusMenuFixture.closed()), 1);
}));

test("action callbacks run before the activation event dispatch returns", () => fixture(async (page) => {
  await page.getByRole("button", { name: "Open menu" }).click();
  const result = await page.evaluate(() => {
    const copy = document.querySelector<HTMLButtonElement>('[data-locus-menu-item="copy"]')!;
    copy.dispatchEvent(new MouseEvent("click", { bubbles: true, cancelable: true }));
    // An async handoff would leave this snapshot empty, even if browser user
    // activation itself happened to survive long enough for the clipboard.
    return { events: locusMenuFixture.events.slice(), closed: locusMenuFixture.closed() };
  });
  assert.deepEqual(result, { events: [{ action: "copy", userActivated: true }], closed: 1 });
}));

test("corner menus dismiss when their actions retain or replace the parent owner", () => fixture(async page => {
  for (const label of ["Retained call actions", "Replaced call actions"]) {
    const trigger = page.getByRole("button", { name: label, exact: true });
    await trigger.press("Enter");
    const menu = page.getByRole("menu", { name: label, exact: true });
    await menu.waitFor();
    await page.getByRole("menuitem", { name: "Choose new data", exact: true }).click();
    await page.getByRole("textbox", { name: `Replacement for ${label}`, exact: true }).waitFor();
    await menu.waitFor({ state: "detached" });
    await page.waitForFunction(() => document.querySelectorAll(".locus-context-menu-root--leaving").length === 0);
    assert.equal(await menu.count(), 0, "Replacement controls keep no interactive or painted action menu");
    if (await trigger.count()) assert.equal(await trigger.getAttribute("aria-expanded"), "false");
  }
  assert.deepEqual(await page.evaluate(() => locusMenuFixture.events), [
    { action: "Retained call actions", userActivated: true }, { action: "Replaced call actions", userActivated: true },
  ]);
}));

test("a selected corner menu closes before its async replacement settles", () => fixture(async page => {
  const menu = page.getByRole("menu", { name: "Async replacement actions", exact: true });
  await page.getByRole("button", { name: "Async replacement actions", exact: true }).press("Enter");
  await menu.waitFor();
  try {
    const immediate = await page.evaluate(() => {
      document.querySelector<HTMLButtonElement>('[data-locus-menu-item="replace"]')!.click();
      return locusMenuFixture.events.slice();
    });
    assert.deepEqual(immediate, [{ action: "Async replacement", userActivated: true }],
      "The replacement callback runs synchronously within activation");
    try { await menu.waitFor({ state: "detached", timeout: 500 }); }
    finally {
      if (process.env["FENEL_LOCUS_ASYNC_MENU_CAPTURE"]) await page.screenshot({ path: process.env["FENEL_LOCUS_ASYNC_MENU_CAPTURE"] });
    }
    assert.equal(await page.getByRole("textbox", { name: "Async replacement function", exact: true }).count(), 0,
      "Menu dismissal does not require completing the held replacement");
  } finally {
    await page.evaluate(() => locusMenuFixture.resolveHeldReplacement());
    await page.getByRole("textbox", { name: "Async replacement function", exact: true }).waitFor();
    await menu.waitFor({ state: "detached" });
  }
}));

test("root and submenu fades leave only inert paint while a fresh right-click opens immediately", () => fixture(async (page) => {
  await page.getByRole("button", { name: "Open menu" }).click();
  const root = page.getByRole("menu", { name: "Data actions", exact: true });
  assert.equal(await root.evaluate(element => getComputedStyle(element).animationName), "locus-context-menu-in");
  await page.keyboard.press("ArrowRight");
  await page.waitForFunction(() => document.activeElement?.getAttribute("data-locus-menu-item") === "expression");
  const child = page.getByRole("menu", { name: "New", exact: true });
  assert.equal(await child.evaluate(element => getComputedStyle(element).animationName), "locus-context-menu-in");
  const transitions = await page.evaluate(async () => {
    document.activeElement!.dispatchEvent(new KeyboardEvent("keydown", { key: "ArrowLeft", bubbles: true, cancelable: true }));
    await new Promise<void>(resolve => requestAnimationFrame(() => resolve()));
    const childLeaving = document.querySelector<HTMLDivElement>(".locus-context-menu-root--leaving");
    const submenuFade = childLeaving?.inert === true && childLeaving.getAttribute("aria-hidden") === "true";
    document.querySelector<HTMLButtonElement>('[data-locus-menu-item="copy"]')!.click();
    const callbackWasImmediate = locusMenuFixture.events.at(-1)?.action === "copy" && locusMenuFixture.closed() === 1;
    await new Promise<void>(resolve => requestAnimationFrame(() => resolve()));
    const leaving = [...document.querySelectorAll<HTMLDivElement>(".locus-context-menu-root--leaving")];
    const rootFade = leaving.some(element => element.inert && element.getAttribute("aria-hidden") === "true"
      && getComputedStyle(element.firstElementChild!).animationName === "locus-context-menu-out");
    const target = document.getElementById("right-click-target")!;
    const clickPassedThrough = document.elementFromPoint(60, 80)?.closest(".locus-context-menu-root--leaving") == null;
    target.dispatchEvent(new MouseEvent("contextmenu", { clientX: 310, clientY: 310, bubbles: true, cancelable: true }));
    return { submenuFade, rootFade, callbackWasImmediate, clickPassedThrough };
  });
  assert.deepEqual(transitions, { submenuFade: true, rootFade: true, callbackWasImmediate: true, clickPassedThrough: true });
  await root.waitFor();
  assert.equal(await page.getByRole("menu").count(), 1);
  const bounds = await root.boundingBox();
  assert.equal(bounds?.x, 310);
  await page.waitForFunction(() => document.querySelectorAll(".locus-context-menu-root--leaving").length === 0);
}));

test("reduced motion disables entrance animations and removes menus without outgoing copies", () => fixture(async (page) => {
  await page.emulateMedia({ reducedMotion: "reduce" });
  await page.getByRole("button", { name: "Open menu" }).click();
  assert.equal(await page.getByRole("menu").evaluate(element => getComputedStyle(element).animationName), "none");
  await page.keyboard.press("Escape");
  assert.equal(await page.getByRole("menu").count(), 0);
  assert.equal(await page.locator(".locus-context-menu-root--leaving").count(), 0);
}));

test("LocusSelect opens from the keyboard on its current option and hands focus back after a pick", () => fixture(async (page) => {
  const trigger = page.getByRole("button", { name: /^Letter: / });
  const active = () => page.evaluate(() => document.activeElement?.getAttribute("data-locus-menu-item"));
  // The value is part of the trigger's accessible name, as a native select announces it.
  assert.equal(await trigger.getAttribute("aria-label"), "Letter: Bravo");
  await trigger.focus();
  await page.keyboard.press("ArrowDown");
  await page.getByRole("menu", { name: "Letter", exact: true }).waitFor();
  await page.waitForFunction(() => document.activeElement?.getAttribute("data-locus-menu-item") === "b");
  assert.equal(await active(), "b");
  // The options are radio items; only the current one is checked.
  assert.equal(await page.getByRole("menuitemradio").count(), 3);
  assert.equal(await page.getByRole("menuitemradio", { checked: true }).getAttribute("data-locus-menu-item"), "b");
  await page.keyboard.press("ArrowDown");
  assert.equal(await active(), "c");
  await page.keyboard.press("Enter");
  await page.getByRole("menu").waitFor({ state: "detached" });
  assert.equal(await page.evaluate(() => locusMenuFixture.letter()), "c");
  assert.equal(await trigger.evaluate((element) => document.activeElement === element), true);
  assert.equal((await trigger.textContent())?.trim(), "Charlie");
  assert.equal(await trigger.getAttribute("aria-label"), "Letter: Charlie");
  await page.keyboard.press("Enter");
  await page.getByRole("menu", { name: "Letter", exact: true }).waitFor();
  await page.waitForFunction(() => document.activeElement?.getAttribute("data-locus-menu-item") === "c");
  assert.equal(await active(), "c");
  await page.keyboard.press("Escape");
  assert.equal(await page.evaluate(() => locusMenuFixture.letter()), "c");
  assert.equal(await trigger.evaluate((element) => document.activeElement === element), true);
}));

test("a native modal's dropdown stays clickable and keyboard accessible in its top layer", () => fixture(async page => {
  await page.getByRole("button", { name: "Open dialog", exact: true }).click();
  const dialog = page.getByRole("dialog", { name: "Expression inspector fixture", exact: true });
  const trigger = dialog.getByRole("button", { name: "Dialog letter: Bravo", exact: true });
  await trigger.click();
  const menu = dialog.getByRole("menu", { name: "Dialog letter", exact: true });
  await menu.waitFor();
  assert.equal(await menu.evaluate(element => element.closest("dialog")?.open), true);
  await menu.getByRole("menuitemradio", { name: "Charlie", exact: true }).click();
  assert.equal(await page.evaluate(() => locusMenuFixture.letter()), "c");
  assert.equal(await dialog.evaluate(element => (element as HTMLDialogElement).open), true);
  const selected = dialog.getByRole("button", { name: "Dialog letter: Charlie", exact: true });
  assert.equal(await selected.evaluate(element => element === document.activeElement), true);
  await page.keyboard.press("ArrowDown");
  await menu.waitFor();
  await page.waitForFunction(() => document.activeElement?.getAttribute("data-locus-menu-item") === "c");
  await page.keyboard.press("Escape");
  await menu.waitFor({ state: "detached" });
  assert.equal(await dialog.evaluate(element => (element as HTMLDialogElement).open), true);
  assert.equal(await selected.evaluate(element => element === document.activeElement), true);
  await dialog.getByRole("button", { name: "Close dialog", exact: true }).click();
}));

test("a shared overlay's dropdown keeps pointer and keyboard actions in its own modal layer", () => fixture(async page => {
  const overlay = page.getByRole("dialog", { name: "Overlay inspector fixture", exact: true });
  await overlay.getByRole("button", { name: "Overlay letter: Bravo", exact: true }).click();
  const menu = overlay.getByRole("menu", { name: "Overlay letter", exact: true });
  await menu.waitFor();
  assert.equal(await menu.evaluate(element => !!element.closest("[data-modal-transition]")), true);
  await menu.getByRole("menuitemradio", { name: "Charlie", exact: true }).click();
  assert.equal(await page.evaluate(() => locusMenuFixture.letter()), "c");
  const trigger = overlay.getByRole("button", { name: "Overlay letter: Charlie", exact: true });
  assert.equal(await trigger.evaluate(element => document.activeElement === element), true);
  await page.keyboard.press("ArrowDown");
  await menu.waitFor();
  await page.waitForFunction(() => document.activeElement?.getAttribute("data-locus-menu-item") === "c");
  await page.keyboard.press("Home");
  await page.keyboard.press("Enter");
  assert.equal(await page.evaluate(() => locusMenuFixture.letter()), "a");
}));

test("the actual dropdown opener owns the modal layer when a pointer press leaves focus elsewhere", () => fixture(async page => {
  await page.getByRole("textbox", { name: "Outside input", exact: true }).focus();
  const overlay = page.getByRole("dialog", { name: "Overlay inspector fixture", exact: true });
  const trigger = overlay.getByRole("button", { name: "Overlay letter: Bravo", exact: true });
  await trigger.evaluate(element => element.addEventListener("mousedown", event => event.preventDefault()));
  await trigger.click();
  const menu = overlay.getByRole("menu", { name: "Overlay letter", exact: true });
  await menu.waitFor();
  await menu.getByRole("menuitemradio", { name: "Charlie", exact: true }).click();
  assert.equal(await page.evaluate(() => locusMenuFixture.letter()), "c");
  assert.equal(await overlay.getByRole("button", { name: "Overlay letter: Charlie", exact: true })
    .evaluate(element => document.activeElement === element), true);
}));
