import { describe, expect, test } from "bun:test";
import { createRoot, createEffect, createSignal, createStore, flush, onCleanup, untrack } from "solid-js";

// Launch day, Nov 12: a public deep link showed a spinner until its worker had
// resolved the address (15 to 80 s on a slow host), although the bundled public
// snapshot already holds that data. The production address owner runs here over
// controlled history. Only the reader answers are scripted: the build's early
// answer (`initialFocus`), the model preparation and the resolver's own answer.
// The early answer is display only: this file pins that it never focuses a lens,
// never accepts an address and is refused for every source but the public one.
const source = await Bun.file(new URL("./workspace-address.ts", import.meta.url)).text();
const start = source.indexOf("export function installWorkspaceAddress(");
if (start < 0) throw new Error("Address owner boundary moved");
const code = new Bun.Transpiler({ loader: "ts" }).transformSync(source.slice(start)).replace(/^export /gm, "");
type Source = { $tag: "PublicSource" | "AllDataSource" | "ThisTabSource" } | { $tag: "AccountSource"; accountId: string };
type Focus = { kind: "root" } | { kind: "value"; viewId: string; itemId: string; path: string[]; rootItem: true };
type Lens = { id: string; source: Source; focus: { $tag: "RootFocus" } | { $tag: "Focused"; focus: Focus } };
const valueFocus = (...path: string[]): Focus => ({ kind: "value", viewId: "public-fenel", itemId: "demo", path, rootItem: true });

function deferred<T>() {
  let resolve!: (value: T) => void, reject!: (reason: unknown) => void;
  const promise = new Promise<T>((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
}

function harness(pathname: string, options: { search?: string; early?: (segments: readonly string[]) => Promise<Focus | undefined>;
  resolved?: { focus: Focus; missing?: string; detail?: string }; accounts?: Array<{ id: string; slug: string }> } = {}) {
  const model = deferred<void>();
  const navigations: string[] = [], focused: Array<{ source: Source; focus: Focus }> = [], failures: (string | undefined)[] = [];
  const earlyRequests: Array<{ source: Source; segments: string[] }> = [];
  let preparations = 0, resolutions = 0;
  const [lens, setLens] = createSignal<Lens>({ id: "persisted", source: { $tag: "PublicSource" }, focus: { $tag: "RootFocus" } });
  const [location, setLocation] = createStore({ pathname, search: options.search ?? "", key: "initial", state: undefined });
  const bindings = { createEffect, createSignal, onCleanup, untrack,
    useLocation: () => location, useNavigate: () => (path: string) => { navigations.push(path); },
    workspaceSourceKey: (value: Source) => value.$tag === "AccountSource" ? value.accountId : value.$tag,
    scopeFromWorkspace: (focus: Lens["focus"]) => focus.$tag === "RootFocus" ? { kind: "root" } : focus.focus,
    decodeLocusAddress: (path: string) => path.split("/").filter(Boolean).map(decodeURIComponent),
    locusSegmentUsesHostRoute: () => false, LENS_ADDRESS_NAVIGATION: "fenel.lens-address", parentScope: () => undefined,
    // The reader's own resolution (scripted): what the worker answers once the model is prepared.
    resolveLocusAddress: async (_root: unknown, segments: readonly string[]) => {
      resolutions++;
      return { segments: [...segments], readerIndependent: true, ...(options.resolved ?? { focus: valueFocus(...segments.slice(1)) }) };
    },
    locusAddressForScope: async () => undefined,
  };
  const install = new Function(...Object.keys(bindings), `${code}; return installWorkspaceAddress;`)(...Object.values(bindings));
  let dispose!: () => void;
  const address = createRoot(end => {
    dispose = end;
    return install({ enabled: true, active: lens, accounts: () => options.accounts ?? [],
      ...(options.early ? { initialFocus: (value: Source, segments: readonly string[]) => {
        earlyRequests.push({ source: value, segments: [...segments] });
        return options.early!(segments);
      } } : {}),
      prepare: async () => { preparations++; await model.promise; },
      operate: async () => { throw new Error("The scripted resolver needs no member operation"); },
      root: async (value: Source) => ({ id: value.$tag }),
      focus: async (value: Source, focus: Focus, assertCurrent?: () => void) => {
        assertCurrent?.(); focused.push({ source: value, focus });
        setLens({ id: "persisted", source: value, focus: focus.kind === "root" ? { $tag: "RootFocus" } : { $tag: "Focused", focus } });
        return true;
      },
      failed: (message?: string) => { failures.push(message); },
    });
  });
  flush();
  return { address, dispose, navigations, focused, failures, earlyRequests, lens,
    preparations: () => preparations, resolutions: () => resolutions,
    workerReady: () => model.resolve(),
    visit: (path: string) => { setLocation(draft => { draft.pathname = path; draft.search = ""; draft.key = `visit-${path}`; }); flush(); } };
}
async function settle() { for (let index = 0; index < 30; index++) { await Promise.resolve(); flush(); } }

describe("a public deep link shows the build's answer while its worker resolves the address", () => {
  test("the early focus is published before the model is prepared and focuses no lens", async () => {
    const h = harness("/demo/Tree%20of%20life/Tree%20of%20life", { early: async segments => valueFocus(...segments.slice(1)) });
    try {
      await settle();
      expect(h.earlyRequests).toEqual([{ source: { $tag: "PublicSource" }, segments: ["demo", "Tree of life", "Tree of life"] }]);
      expect(h.address.initialFocus()).toEqual({ source: { $tag: "PublicSource" }, focus: valueFocus("Tree of life", "Tree of life") });
      // Nothing was decided: the address is still loading, unresolved, unfocused and unpublished.
      expect(h.address.initialLoading()).toBe(true);
      expect(h.preparations()).toBe(1); expect(h.resolutions()).toBe(0);
      expect(h.focused).toEqual([]); expect(h.navigations).toEqual([]); expect(h.lens().focus.$tag).toBe("RootFocus");
      h.workerReady(); await settle();
      expect(h.resolutions()).toBe(1);
      expect(h.focused).toEqual([{ source: { $tag: "PublicSource" }, focus: valueFocus("Tree of life", "Tree of life") }]);
      expect(h.address.initialLoading()).toBe(false); expect(h.failures.at(-1)).toBeUndefined();
    } finally { h.dispose(); }
  });

  test("the reader's own answer decides, also when it differs from the early one", async () => {
    const h = harness("/demo/Solver", { early: async () => valueFocus("Solver"),
      resolved: { focus: valueFocus(), missing: "Solver", detail: "There is no readable data at this address." } });
    try {
      await settle();
      expect(h.address.initialFocus()?.focus).toEqual(valueFocus("Solver"));
      h.workerReady(); await settle();
      // Exactly today's outcome for a missing member: its deepest readable ancestor and the notice.
      expect(h.focused).toEqual([{ source: { $tag: "PublicSource" }, focus: valueFocus() }]);
      expect(h.failures.at(-1)).toBe("There is no readable data at this address. Address step: Solver");
      expect(h.address.initialLoading()).toBe(false);
    } finally { h.dispose(); }
  });

  test("no answer, or a failed lookup, leaves the address exactly as it was", async () => {
    for (const early of [async () => undefined, async () => { throw new Error("The snapshot is unavailable"); }]) {
      const h = harness("/demo/Unknown", { early });
      try {
        await settle();
        expect(h.earlyRequests.length).toBe(1);
        expect(h.address.initialFocus()).toBeUndefined(); expect(h.address.initialLoading()).toBe(true);
        h.workerReady(); await settle();
        expect(h.focused.length).toBe(1); expect(h.address.initialLoading()).toBe(false);
      } finally { h.dispose(); }
    }
  });

  test("Local, account, All data, root and input addresses never ask for an early focus", async () => {
    const early = async () => valueFocus("never");
    for (const [pathname, search] of [["/~/Recipe%20facts", ""], ["/~tab/Recipe%20facts", ""], ["/@reader/demo", ""],
      ["/", ""], ["/@fenel", ""], ["/demo/Solver", "?home=all"], ["/demo/Solver", "?source=tab"],
      ["/demo/Solve", "?x=3"], ["/app/home", ""]] as const) {
      const h = harness(pathname, { search, early, accounts: [{ id: "reader-account", slug: "reader" }] });
      try {
        await settle();
        expect(h.earlyRequests, `${pathname}${search}`).toEqual([]);
        expect(h.address.initialFocus(), `${pathname}${search}`).toBeUndefined();
      } finally { h.workerReady(); await settle(); h.dispose(); }
    }
  });

  test("the public owner prefix reads the same public address", async () => {
    const h = harness("/@fenel/demo/Solver", { early: async segments => valueFocus(...segments.slice(1)) });
    try {
      await settle();
      expect(h.earlyRequests).toEqual([{ source: { $tag: "PublicSource" }, segments: ["demo", "Solver"] }]);
      expect(h.address.initialFocus()?.focus).toEqual(valueFocus("Solver"));
    } finally { h.workerReady(); await settle(); h.dispose(); }
  });

  test("an answer that arrives after a newer navigation or after loading is dropped", async () => {
    const first = deferred<Focus | undefined>(), second = deferred<Focus | undefined>();
    const h = harness("/demo/Solver", { early: segments => segments[1] === "Solver" ? first.promise : second.promise });
    try {
      await settle();
      h.visit("/demo/Images"); await settle();
      expect(h.earlyRequests.map(request => request.segments)).toEqual([["demo", "Solver"], ["demo", "Images"]]);
      first.resolve(valueFocus("Solver")); await settle();
      // The replaced address may not publish; only the current address's own answer may.
      expect(h.address.initialFocus()).toBeUndefined();
      second.resolve(valueFocus("Images")); await settle();
      expect(h.address.initialFocus()?.focus).toEqual(valueFocus("Images"));
    } finally { h.workerReady(); await settle(); h.dispose(); }
    const slow = deferred<Focus | undefined>();
    const after = harness("/demo/Solver", { early: () => slow.promise });
    try {
      await settle(); after.workerReady(); await settle();
      expect(after.address.initialLoading()).toBe(false);
      slow.resolve(valueFocus("Solver")); await settle();
      expect(after.address.initialFocus()).toBeUndefined();
    } finally { after.dispose(); }
  });

  test("a navigation started from the preview keeps it; a later in-app address asks nothing", async () => {
    const h = harness("/demo/Solver", { early: async segments => valueFocus(...segments.slice(1)) });
    try {
      await settle();
      const finish = h.address.navigationStarted({ retainInitial: true }); flush();
      expect(h.address.initialLoading()).toBe(true);
      expect(h.address.initialFocus()?.focus).toEqual(valueFocus("Solver"));
      finish(); h.workerReady(); await settle();
      expect(h.address.initialLoading()).toBe(false);
      const asked = h.earlyRequests.length;
      h.visit("/demo/Images"); await settle();
      // Not an initial load any more: the shown lens stays until the reader answers.
      expect(h.earlyRequests.length).toBe(asked);
    } finally { h.dispose(); }
  });
});
