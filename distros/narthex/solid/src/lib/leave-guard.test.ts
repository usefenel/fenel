// The browser Back/Forward path through the REAL router code (Solid Router's
// browser history and its before-leave lifecycle) over a stand-in history that
// behaves like Chrome: a history.go() issued while another traversal is still
// pending is dropped. Nov 12: every second Back did nothing, because the
// router's undo (go(+1)) and the guard's retry (go(-1)) were issued 1 ms apart.
import { afterEach, expect, test } from "bun:test";
import { browserHistory, createBeforeLeave, type BeforeLeaveEventArgs, type Location } from "@solidjs/router";
import { guardLeave, type LeaveGuardHost } from "./leave-guard";

type Entry = { url: string; state: { _depth: number } | null };

class StandInBrowser {
  entries: Entry[];
  index: number;
  pending = false;
  dropped = 0;
  listeners: (() => void)[] = [];
  constructor(urls: string[], index = urls.length - 1) {
    this.entries = urls.map((url, depth) => ({ url, state: { _depth: depth } }));
    this.index = index;
  }
  get here() { return this.entries[this.index]!.url; }
  readonly history = {
    owner: this,
    get state() { return this.owner.entries[this.owner.index]!.state; },
    get length() { return this.owner.entries.length; },
    replaceState(state: Entry["state"], _title: string, url?: string) {
      const entry = this.owner.entries[this.owner.index]!;
      entry.state = state; if (url) entry.url = url;
    },
    pushState(state: Entry["state"], _title: string, url: string) {
      this.owner.entries.splice(this.owner.index + 1);
      this.owner.entries.push({ url, state });
      this.owner.index++;
    },
    go: (delta: number) => {
      // Chrome: a second traversal requested while one is pending is ignored.
      if (this.pending) { this.dropped++; return; }
      const target = this.index + delta;
      if (target < 0 || target >= this.entries.length) return;
      this.pending = true;
      setTimeout(() => {
        this.pending = false;
        this.index = target;
        // DOM dispatch: listeners added during this dispatch wait for the next event.
        for (const listener of [...this.listeners]) listener();
      }, 1);
    },
  };
  readonly location = {
    owner: this,
    get pathname() { return new URL(this.owner.here, "https://x.invalid").pathname; },
    get search() { return new URL(this.owner.here, "https://x.invalid").search; },
    get hash() { return new URL(this.owner.here, "https://x.invalid").hash; },
  };
  addEventListener(type: string, listener: () => void) { if (type === "popstate") this.listeners.push(listener); }
  removeEventListener(type: string, listener: () => void) {
    if (type === "popstate") this.listeners = this.listeners.filter(candidate => candidate !== listener);
  }
  setTimeout(handler: () => void, ms: number) { return setTimeout(handler, ms); }
  clearTimeout(timer: unknown) { clearTimeout(timer as ReturnType<typeof setTimeout>); }
  scrollTo() {}
}

const previousWindow = (globalThis as { window?: unknown }).window;
afterEach(() => { (globalThis as { window?: unknown }).window = previousWindow; });

const wait = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));

/** The router as the app mounts it: browser history, its popstate handler and one leave guard. */
function mount(urls: string[], guard: { idle: () => boolean; prepare: () => Promise<boolean> }, index?: number) {
  const browser = new StandInBrowser(urls, index);
  (globalThis as { window?: unknown }).window = browser;
  const history = browserHistory();
  // Stamps the current entry's depth, as the router does on every write.
  history.set({ value: browser.here, replace: true, scroll: false });
  const lifecycle = createBeforeLeave();
  history.utils!.beforeLeave!.current = lifecycle;
  let shown = browser.here;
  const notified: string[] = [];
  history.init!(() => { shown = browser.here; notified.push(shown); });
  const routerLocation = {
    get pathname() { return new URL(shown, "https://x.invalid").pathname; },
    get search() { return new URL(shown, "https://x.invalid").search; },
    get hash() { return new URL(shown, "https://x.invalid").hash; },
  } as unknown as Location;
  let prepared = 0;
  lifecycle.subscribe({
    listener: (event: BeforeLeaveEventArgs) => guardLeave(event, {
      idle: guard.idle, prepare: () => { prepared++; return guard.prepare(); },
    }, browser as unknown as LeaveGuardHost, 1000),
    location: routerLocation,
    // The router's own navigate for a number: `utils.go(delta)`.
    navigate: ((to: string | number) => { if (typeof to === "number") browser.history.go(to); }) as never,
  });
  return {
    browser, notified,
    get shown() { return shown; },
    get prepared() { return prepared; },
    /** In-app navigation (a click): the router pushes and shows the new address. */
    push(url: string) {
      history.set({ value: url, scroll: false }); shown = url;
    },
  };
}

const pages = Array.from({ length: 11 }, (_, i) => `/demo/page%20${i}`);

test("nothing pending: ten Backs in a row over ten visited pages all work, and nothing is asked", async () => {
  const app = mount(pages, { idle: () => true, prepare: async () => true });
  for (let i = 9; i >= 0; i--) {
    app.browser.history.go(-1);
    await wait(125);
    expect(app.browser.here).toBe(pages[i]!);
    expect(app.shown).toBe(pages[i]!);
  }
  expect(app.notified).toEqual(pages.slice(0, 10).reverse());
  expect(app.prepared).toBe(0);
  expect(app.browser.dropped).toBe(0);
});

test("something pending that saves at once: every Back works (none is dropped)", async () => {
  const app = mount(pages, { idle: () => false, prepare: async () => true });
  for (let i = 9; i >= 5; i--) {
    app.browser.history.go(-1);
    await wait(200);
    expect(app.browser.here).toBe(pages[i]!);
    expect(app.shown).toBe(pages[i]!);
  }
  expect(app.notified).toEqual(pages.slice(5, 10).reverse());
  expect(app.prepared).toBe(5);
  expect(app.browser.dropped).toBe(0);
});

test("a guard that answers after the undo has landed still lets Back through", async () => {
  const app = mount(pages, { idle: () => false, prepare: () => wait(300).then(() => true) });
  app.browser.history.go(-1);
  await wait(100);
  expect(app.browser.here).toBe(pages[10]!);
  await wait(400);
  expect(app.browser.here).toBe(pages[9]!);
  expect(app.shown).toBe(pages[9]!);
  app.browser.history.go(-1);
  await wait(400);
  expect(app.shown).toBe(pages[8]!);
});

test("a guard that answers stay keeps the page, and the next Back asks again", async () => {
  const app = mount(pages, { idle: () => false, prepare: async () => false });
  app.browser.history.go(-1);
  await wait(200);
  expect(app.browser.here).toBe(pages[10]!);
  expect(app.notified).toEqual([]);
  app.browser.history.go(-1);
  await wait(200);
  expect(app.browser.here).toBe(pages[10]!);
  expect(app.notified).toEqual([]);
  expect(app.prepared).toBe(2);
});

test("Forward works, idle or pending", async () => {
  const idle = mount(pages, { idle: () => true, prepare: async () => true }, 3);
  idle.browser.history.go(1);
  await wait(125);
  expect(idle.shown).toBe(pages[4]!);
  const pending = mount(pages, { idle: () => false, prepare: async () => true }, 3);
  pending.browser.history.go(1);
  await wait(200);
  expect(pending.shown).toBe(pages[4]!);
  pending.browser.history.go(1);
  await wait(200);
  expect(pending.shown).toBe(pages[5]!);
});

test("a visitor who moved on while the guard was saving is not pulled back", async () => {
  let release!: (leave: boolean) => void;
  const app = mount(pages, { idle: () => false, prepare: () => new Promise<boolean>(resolve => { release = resolve; }) });
  app.browser.history.go(-1);
  await wait(100);
  expect(app.browser.here).toBe(pages[10]!);
  app.push("/demo/elsewhere");
  release(true);
  await wait(200);
  expect(app.browser.here).toBe("/demo/elsewhere");
});

function directEvent(from: string, to: number) {
  let retried = 0, prevented = false;
  const url = new URL(from, "https://x.invalid");
  const event = {
    from: { pathname: url.pathname, search: url.search, hash: url.hash } as unknown as Location,
    to, options: undefined, defaultPrevented: false,
    preventDefault() { prevented = true; },
    retry() { retried++; },
  } as unknown as BeforeLeaveEventArgs;
  return { event, get retried() { return retried; }, get prevented() { return prevented; } };
}

test("an undo whose popstate never comes: the retry still happens when the page is back at its origin", async () => {
  const browser = new StandInBrowser(["/a", "/b"], 1);
  const call = directEvent("/b", -1);
  guardLeave(call.event, { idle: () => false, prepare: async () => true }, browser as unknown as LeaveGuardHost, 150);
  expect(call.prevented).toBe(true);
  await wait(50);
  expect(call.retried).toBe(0);
  await wait(250);
  expect(call.retried).toBe(1);
});

test("an undo that never happened: no retry from the wrong page", async () => {
  const browser = new StandInBrowser(["/a", "/b"], 0);
  const call = directEvent("/b", -1);
  guardLeave(call.event, { idle: () => false, prepare: async () => true }, browser as unknown as LeaveGuardHost, 150);
  await wait(300);
  expect(call.retried).toBe(0);
});

test("an in-app link (a path, not a history step) is held and retried as before", async () => {
  const call = directEvent("/b", -1);
  const event = { ...call.event, to: "/c" } as BeforeLeaveEventArgs;
  let retried = 0; event.retry = () => { retried++; };
  let prevented = false; event.preventDefault = () => { prevented = true; };
  guardLeave(event, { idle: () => false, prepare: async () => true }, new StandInBrowser(["/b"]) as unknown as LeaveGuardHost, 150);
  expect(prevented).toBe(true);
  await wait(25);
  expect(retried).toBe(1);
  let idlePrevented = false;
  const idleEvent = { ...call.event, to: "/c", preventDefault: () => { idlePrevented = true; } } as BeforeLeaveEventArgs;
  guardLeave(idleEvent, { idle: () => true, prepare: async () => true }, new StandInBrowser(["/b"]) as unknown as LeaveGuardHost, 150);
  expect(idlePrevented).toBe(false);
});
