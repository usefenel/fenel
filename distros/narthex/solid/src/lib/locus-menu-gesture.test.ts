import { beforeEach, expect, test } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

test("Locus tap gesture opens the context menu on touch only (isolated Chromium)", async () => {
  const directory = await mkdtemp(join(tmpdir(), "fenel-locus-gesture-"));
  try {
    const compilerPath = Bun.resolveSync("@solidjs/compiler", dirname(fileURLToPath(import.meta.resolve("@solidjs/vite-plugin"))));
    const compiler = await import(pathToFileURL(compilerPath).href);
    const browser = await Bun.build({
      entrypoints: [fileURLToPath(new URL("./locus-menu-gesture.fixture.tsx", import.meta.url))],
      target: "browser", conditions: ["browser", "development"],
      plugins: [{ name: "context-menu-browser-leaf", setup(build) {
        build.onResolve({ filter: /^@fenel\// }, (args) => { throw new Error(`Tap gesture fixture eagerly imports ${args.path}`); });
        build.onLoad({ filter: /\.tsx$/ }, async (args) => ({
          loader: "ts",
          contents: (await compiler.transformAsync(await Bun.file(args.path).text(), {
            filename: args.path, generate: "dom", hydratable: false, dev: true,
          })).code,
        }));
        build.onLoad({ filter: /\.css$/ }, () => ({ loader: "js", contents: "" }));
      } }],
    });
    if (!browser.success) throw new AggregateError(browser.logs, "Tap gesture browser fixture build failed");
    const browserPath = join(directory, "browser.js");
    await Bun.write(browserPath, browser.outputs[0]!);
    const runner = await Bun.build({
      entrypoints: [fileURLToPath(new URL("./locus-menu-gesture.node-fixture.ts", import.meta.url))],
      target: "node", packages: "external",
    });
    if (!runner.success) throw new AggregateError(runner.logs, "Tap gesture Node fixture build failed");
    const nodePath = join(directory, "runner.mjs");
    await Bun.write(nodePath, (await runner.outputs[0]!.text()).replace('from "playwright"', `from ${JSON.stringify(import.meta.resolve("playwright"))}`));
    // Playwright's Windows pipe transport is owned by Node, as in the existing
    // browser boundary fixture. No dev server or engine startup is involved.
    const child = Bun.spawn(["node", nodePath, browserPath, fileURLToPath(new URL("./locus-context-menu.css", import.meta.url))], { stdout: "pipe", stderr: "pipe" });
    const [exitCode, stdout, stderr] = await Promise.all([child.exited, new Response(child.stdout).text(), new Response(child.stderr).text()]);
    if (exitCode !== 0) throw new Error(`${stdout}\n${stderr}`);
    expect(stdout).toContain("# fail 0");
    expect(stdout).toMatch(/# pass 8(?:\r?\n|$)/);
    console.log(stdout);
  } finally {
    const target = resolve(directory);
    if (!target.startsWith(resolve(tmpdir()) + "/") && !target.startsWith(resolve(tmpdir()) + "\\")) throw new Error("Tap gesture fixture cleanup escaped the temporary directory");
    await rm(target, { recursive: true, force: true });
  }
}, 120_000);

// ---------------------------------------------------------------------------
// The gesture state machine itself, with no browser in the way. Chromium proves
// the WIRING above; these prove the decisions, and they run anywhere.

/** Enough of an element to answer `closest` and to carry a dispatched event,
 *  which is all the module asks of one. Each stub lists the selectors it
 *  matches and its ancestors answer through the chain, so "a press inside a
 *  card" is expressible. */
class StubElement {
  isConnected = true;
  constructor(readonly selectors: readonly string[] = [], readonly parent?: StubElement) {}
  closest(query: string): StubElement | null {
    const wanted = query.split(", ");
    for (let node: StubElement | undefined = this; node; node = node.parent) {
      if (node.selectors.some((selector) => wanted.includes(selector))) return node;
    }
    return null;
  }
  /** The surface handler is what a bubbling contextmenu reaches in the DOM. */
  dispatchEvent(event: StubMouseEvent): boolean {
    event.target = this;
    dispatched.push(event);
    bubbleTo?.(event);
    return !event.defaultPrevented;
  }
}

class StubMouseEvent {
  target: StubElement | undefined;
  defaultPrevented = false;
  propagationStopped = false;
  clientX = 0; clientY = 0; button = 0; bubbles = false;
  constructor(readonly type: string, init: Record<string, unknown> = {}) { Object.assign(this, init); }
  preventDefault() { this.defaultPrevented = true; }
  stopPropagation() { this.propagationStopped = true; }
}

const dispatched: StubMouseEvent[] = [];
let bubbleTo: ((event: StubMouseEvent) => void) | undefined;
const documentListeners: Array<{ type: string; fn: (event: unknown) => void; capture: unknown }> = [];
let selectionText = "";

Object.assign(globalThis, {
  Element: StubElement,
  MouseEvent: StubMouseEvent,
  window: { getSelection: () => ({ toString: () => selectionText }) },
  document: {
    addEventListener: (type: string, fn: (event: unknown) => void, capture: unknown) =>
      documentListeners.push({ type, fn, capture }),
    removeEventListener: (_type: string, fn: (event: unknown) => void) => {
      const at = documentListeners.findIndex((listener) => listener.fn === fn);
      if (at >= 0) documentListeners.splice(at, 1);
    },
  },
});

const { createLocusTapMenu, locusTapTargetIsBackground, locusPressTargetIsCard, noteLocusMenuDismissal } =
  await import("./locus-menu-gesture");

type Menu = ReturnType<typeof createLocusTapMenu>;

const BACKGROUND = new StubElement();
const CARD = new StubElement(["[data-locus-item]"]);
const CAPTION_IN_CARD = new StubElement([], CARD);
const BUTTON_IN_CARD = new StubElement(["button"], CARD);
const CONTROL = new StubElement(["button"]);
/** The dwell plus enough slack that a slow machine does not decide the test. */
const AFTER_HOLD = 700;

beforeEach(() => {
  dispatched.length = 0;
  documentListeners.length = 0;
  bubbleTo = undefined;
  selectionText = "";
});

type Press = { pointerType?: string; isPrimary?: boolean; pointerId?: number; x: number; y: number; target?: StubElement };
function event({ pointerType = "touch", isPrimary = true, pointerId = 1, x, y, target = BACKGROUND }: Press) {
  return { pointerType, isPrimary, pointerId, clientX: x, clientY: y, target } as unknown as PointerEvent;
}
function mouseEvent(type: string, init: Record<string, unknown> = {}) {
  return new StubMouseEvent(type, init);
}

/** One surface, reporting where — if anywhere — it opened a menu. */
function surface() {
  const opened: Array<{ x: number; y: number }> = [];
  const menu = createLocusTapMenu((e) => opened.push({ x: e.clientX, y: e.clientY }));
  bubbleTo = (e) => menu.onContextMenu(e as unknown as MouseEvent);
  return { menu, opened };
}

function gesture(steps: (menu: Menu) => void) {
  const { menu, opened } = surface();
  steps(menu);
  return opened;
}

function tap(menu: Menu, press: Press, release: Partial<Press> = {}) {
  const down = event(press);
  const up = event({ ...press, ...release });
  menu.onPointerDown(down);
  menu.onPointerUp(up);
  menu.onClick(up);
  return down;
}

test("a tap on the background opens the menu at the finger", () => {
  expect(gesture((menu) => { tap(menu, { x: 60, y: 320 }); })).toEqual([{ x: 60, y: 320 }]);
});

test("the target's own activation wins: a control, and a short tap on a card", () => {
  const asTarget = (stub: StubElement) => stub as unknown as EventTarget;
  expect(locusTapTargetIsBackground(asTarget(CAPTION_IN_CARD))).toBe(false);
  expect(locusTapTargetIsBackground(asTarget(BACKGROUND))).toBe(true);
  expect(locusTapTargetIsBackground(null)).toBe(false);
  expect(locusPressTargetIsCard(asTarget(CAPTION_IN_CARD))).toBe(true);
  // A button inside a card belongs to the button, not to the card.
  expect(locusPressTargetIsCard(asTarget(BUTTON_IN_CARD))).toBe(false);
  expect(locusPressTargetIsCard(asTarget(BACKGROUND))).toBe(false);
  for (const target of [CONTROL, CARD, CAPTION_IN_CARD, BUTTON_IN_CARD]) {
    expect(gesture((menu) => { tap(menu, { x: 60, y: 320, target }); })).toEqual([]);
  }
});

test("a mouse keeps its own gesture, and a second finger is not a tap", () => {
  expect(gesture((menu) => { tap(menu, { x: 60, y: 320, pointerType: "mouse" }); })).toEqual([]);
  expect(gesture((menu) => { tap(menu, { x: 60, y: 320, isPrimary: false }); })).toEqual([]);
  expect(gesture((menu) => { tap(menu, { x: 60, y: 320, pointerType: "pen" }); })).toEqual([{ x: 60, y: 320 }]);
});

test("a finger that travelled was a pan; a cancelled press was never a tap", () => {
  expect(gesture((menu) => { tap(menu, { x: 60, y: 320 }, { x: 60, y: 360 }); })).toEqual([]);
  // Still a tap at the edge of the slop the module allows for a steady finger.
  expect(gesture((menu) => { tap(menu, { x: 60, y: 320 }, { x: 68, y: 326 }); })).toEqual([{ x: 68, y: 326 }]);
  expect(gesture((menu) => {
    menu.onPointerDown(event({ x: 60, y: 320 }));
    menu.onPointerCancel();
    menu.onPointerUp(event({ x: 60, y: 320 }));
    menu.onClick(event({ x: 60, y: 320 }));
  })).toEqual([]);
});

test("an arm is spent once, and only by the click its own tap produced", () => {
  // A click the tap did not produce — a keyboard Enter on the focused surface
  // reports the origin, not the finger — must not spend a pending arm.
  expect(gesture((menu) => {
    menu.onPointerDown(event({ x: 60, y: 320 }));
    menu.onPointerUp(event({ x: 60, y: 320 }));
    menu.onClick(event({ x: 0, y: 0 }));
  })).toEqual([]);
  expect(gesture((menu) => {
    const up = event({ x: 60, y: 320 });
    menu.onPointerDown(up);
    menu.onPointerUp(up);
    menu.onClick(up);
    menu.onClick(up);
  })).toEqual([{ x: 60, y: 320 }]);
});

test("a press that clears a selection has already meant something", () => {
  selectionText = "picked text";
  expect(gesture((menu) => { tap(menu, { x: 60, y: 320 }); })).toEqual([]);
  selectionText = "";
  expect(gesture((menu) => { tap(menu, { x: 60, y: 320 }); })).toEqual([{ x: 60, y: 320 }]);
});

test("the tap that dismissed an open menu does not reopen one", () => {
  expect(gesture((menu) => {
    const down = event({ x: 60, y: 320 });
    // What the open menu's outside-pointerdown listener does before it closes.
    noteLocusMenuDismissal(down);
    menu.onPointerDown(down);
    menu.onPointerUp(down);
    menu.onClick(down);
    // The NEXT tap is the user's again.
    tap(menu, { x: 120, y: 200 });
  })).toEqual([{ x: 120, y: 200 }]);
});

test("holding a card raises a real contextmenu on what the finger is over", async () => {
  const { menu, opened } = surface();
  menu.onPointerDown(event({ x: 240, y: 160, target: CAPTION_IN_CARD }));
  expect(opened).toEqual([]);
  await Bun.sleep(AFTER_HOLD);
  expect(opened).toEqual([{ x: 240, y: 160 }]);
  // The surface reads the press's own target and point, which is how the menu
  // knows WHICH card it is over.
  expect(dispatched.map((e) => [e.type, e.target === CAPTION_IN_CARD, e.bubbles, e.button, e.clientX, e.clientY]))
    .toEqual([["contextmenu", true, true, 2, 240, 160]]);
});

test("a hold only counts while the finger stays put and stays down", async () => {
  for (const abandon of [
    (menu: Menu) => menu.onPointerMove(event({ x: 240, y: 200, target: CAPTION_IN_CARD })),
    (menu: Menu) => menu.onPointerCancel(),
    (menu: Menu) => menu.onPointerUp(event({ x: 240, y: 160, target: CAPTION_IN_CARD })),
  ]) {
    const { menu, opened } = surface();
    menu.onPointerDown(event({ x: 240, y: 160, target: CAPTION_IN_CARD }));
    abandon(menu);
    await Bun.sleep(AFTER_HOLD);
    expect(opened).toEqual([]);
  }
  // Drift inside the slop is a steady finger, not a pan.
  const { menu, opened } = surface();
  menu.onPointerDown(event({ x: 240, y: 160, target: CAPTION_IN_CARD }));
  menu.onPointerMove(event({ x: 246, y: 168, target: CAPTION_IN_CARD }));
  await Bun.sleep(AFTER_HOLD);
  expect(opened).toEqual([{ x: 240, y: 160 }]);
});

test("a mouse never holds, and neither does the background", async () => {
  for (const press of [
    { x: 240, y: 160, target: CAPTION_IN_CARD, pointerType: "mouse" },
    { x: 60, y: 320, target: BACKGROUND },
  ]) {
    const { menu, opened } = surface();
    menu.onPointerDown(event(press));
    await Bun.sleep(AFTER_HOLD);
    expect(opened).toEqual([]);
  }
});

test("the release after a hold eats exactly the click it leaves behind", async () => {
  const { menu, opened } = surface();
  menu.onPointerDown(event({ x: 240, y: 160, target: CAPTION_IN_CARD }));
  await Bun.sleep(AFTER_HOLD);
  expect(documentListeners).toEqual([]);
  menu.onPointerUp(event({ x: 240, y: 160, target: CAPTION_IN_CARD }));
  // The menu is open UNDER the finger, so the click the release produces has
  // to die before it can activate the first item it lands on.
  expect(documentListeners.map((listener) => [listener.type, listener.capture]))
    .toEqual([["click", true], ["pointerdown", true]]);
  const ghost = mouseEvent("click", { clientX: 240, clientY: 160 });
  documentListeners[0]!.fn(ghost);
  expect([ghost.defaultPrevented, ghost.propagationStopped]).toEqual([true, true]);
  // One click, then it stops watching: the next one is the user choosing.
  expect(documentListeners).toEqual([]);
  expect(opened).toEqual([{ x: 240, y: 160 }]);
});

test("the next press ends the watch, so a click the user meant is never eaten", async () => {
  const { menu } = surface();
  menu.onPointerDown(event({ x: 240, y: 160, target: CAPTION_IN_CARD }));
  await Bun.sleep(AFTER_HOLD);
  menu.onPointerUp(event({ x: 240, y: 160, target: CAPTION_IN_CARD }));
  // Pressing a menu item is a press: it clears the watch on the way in, and
  // the click that finishes it reaches the item.
  documentListeners.find((listener) => listener.type === "pointerdown")!.fn(mouseEvent("pointerdown"));
  expect(documentListeners).toEqual([]);
});

test("a native long-press contextmenu and this one never both answer a hold", async () => {
  // Android raises its own first: it opens the menu and the pending hold dies.
  const first = surface();
  first.menu.onPointerDown(event({ x: 240, y: 160, target: CAPTION_IN_CARD }));
  first.menu.onContextMenu(mouseEvent("contextmenu", { clientX: 240, clientY: 160 }) as unknown as MouseEvent);
  await Bun.sleep(AFTER_HOLD);
  expect(first.opened).toEqual([{ x: 240, y: 160 }]);

  // Ours gets there first: the native one that follows is spent, not a second
  // menu at the same point.
  const second = surface();
  second.menu.onPointerDown(event({ x: 240, y: 160, target: CAPTION_IN_CARD }));
  await Bun.sleep(AFTER_HOLD);
  const native = mouseEvent("contextmenu", { clientX: 240, clientY: 160 });
  second.menu.onContextMenu(native as unknown as MouseEvent);
  expect(second.opened).toEqual([{ x: 240, y: 160 }]);
  expect(native.defaultPrevented).toBe(true);
});

test("a right-click is still a right-click, hold state or not", () => {
  const { menu, opened } = surface();
  const click = () => menu.onContextMenu(mouseEvent("contextmenu", { clientX: 500, clientY: 90 }) as unknown as MouseEvent);
  click();
  click();
  expect(opened).toEqual([{ x: 500, y: 90 }, { x: 500, y: 90 }]);
});
