import { describe, expect, test } from "bun:test";
import { createEffect, createRoot, createSignal, createStore, flush, onCleanup, untrack } from "solid-js";

// C1: the production address owner runs over controlled browser history and
// checked root/operation answers. No renderer or evaluator is fabricated.
const source = await Bun.file(new URL("./workspace-address.ts", import.meta.url)).text();
const start = source.indexOf("export function installWorkspaceAddress(");
if (start < 0) throw new Error("Address owner boundary moved");
const code = new Bun.Transpiler({ loader: "ts" }).transformSync(source.slice(start)).replace(/^export /gm, "");
type Source = { $tag: "PublicSource" | "AllDataSource" | "ThisTabSource" };
type Lens = { id: string; source: Source; focus: { $tag: "RootFocus" } };
function harness() {
  let release!: () => void;
  const model = new Promise<void>(resolve => { release = resolve; });
  const navigations: string[] = [], focused: Source[] = [];
  let preparations = 0;
  const [lens, setLens] = createSignal<Lens>({ id: "persisted", source: { $tag: "PublicSource" }, focus: { $tag: "RootFocus" } });
  const [location, setLocation] = createStore({ pathname: "/", search: "", key: "initial", state: undefined });
  const bindings = { createEffect, createSignal, onCleanup, untrack,
    useLocation: () => location, useNavigate: () => (path: string) => { navigations.push(path); },
    workspaceSourceKey: (source: Source) => source.$tag,
    scopeFromWorkspace: () => ({ kind: "root" }), decodeLocusAddress: (path: string) => path.split("/").filter(Boolean).map(decodeURIComponent),
    locusSegmentUsesHostRoute: () => false, LENS_ADDRESS_NAVIGATION: "fenel.lens-address",
    resolveLocusAddress: () => ({ focus: { kind: "root" }, segments: [], readerIndependent: true }),
    locusAddressForScope: () => "/",
  };
  const install = new Function(...Object.keys(bindings), `${code}; return installWorkspaceAddress;`)(...Object.values(bindings));
  let dispose!: () => void;
  const address = createRoot(end => {
    dispose = end;
    return install({ enabled: true, active: lens, accounts: () => [],
      prepare: async () => { preparations++; await model; },
      operate: async () => { throw new Error("Root navigation needs no member operation"); },
      root: async (source: Source) => ({ id: source.$tag }),
      focus: async (source: Source, _focus: unknown, assertCurrent?: () => void) => {
        assertCurrent?.(); focused.push(source); setLens({ id: "persisted", source, focus: { $tag: "RootFocus" } }); return true;
      },
      failed: () => {},
    });
  });
  flush();
  return { address, dispose, release, navigations, focused, lens, preparations: () => preparations,
    commitLocal: () => { setLens({ id: "persisted", source: { $tag: "ThisTabSource" }, focus: { $tag: "RootFocus" } }); address.navigated(); flush(); },
    visitPublic: () => { setLocation(draft => { draft.pathname = "/@fenel"; draft.key = "later"; }); flush(); },
  };
}
async function settle() { for (let index = 0; index < 20; index++) { await Promise.resolve(); flush(); } }

describe("initial address navigation keeps the displayed reader", () => {
  test("Local commit retains All data while preparing and never publishes the stored public address", async () => {
    const h = harness();
    try {
      expect(h.address.initialLoading()).toBe(true);
      expect(h.address.initialRootSource()).toEqual({ $tag: "AllDataSource" });
      const finish = h.address.navigationStarted({ retainInitial: true }); flush();
      expect(h.address.initialLoading()).toBe(true); expect(h.navigations).toEqual([]);
      h.commitLocal(); finish(); h.release(); await settle();
      expect(h.address.initialLoading()).toBe(false);
      expect(h.navigations).toEqual(["/~"]); expect(h.focused).toEqual([]);
      expect(h.preparations()).toBe(1);
    } finally { h.dispose(); }
  });

  test("a refused destination resumes the original address without exposing the stored public reader", async () => {
    const h = harness();
    try {
      const finish = h.address.navigationStarted({ retainInitial: true }); flush();
      finish(); flush();
      expect(h.address.initialLoading()).toBe(true); expect(h.navigations).toEqual([]);
      expect(h.preparations()).toBe(2);
      h.release(); await settle();
      expect(h.focused).toEqual([{ $tag: "AllDataSource" }]);
      expect(h.lens().source.$tag).toBe("AllDataSource");
      expect(h.navigations.some(path => path.includes("@fenel"))).toBe(false);
      expect(h.address.initialLoading()).toBe(false);
    } finally { h.dispose(); }
  });

  test("a superseded destination cannot release the newer destination's preview", async () => {
    const h = harness();
    try {
      const first = h.address.navigationStarted({ retainInitial: true }); flush();
      const second = h.address.navigationStarted({ retainInitial: true }); flush();
      first(); flush();
      expect(h.preparations()).toBe(1); expect(h.address.initialLoading()).toBe(true);
      h.commitLocal(); second(); h.release(); await settle();
      expect(h.preparations()).toBe(1); expect(h.navigations).toEqual(["/~"]);
    } finally { h.dispose(); }
  });

  test("browser navigation supersedes a retained destination's cleanup", async () => {
    const h = harness();
    try {
      const finish = h.address.navigationStarted({ retainInitial: true }); flush();
      h.visitPublic(); await settle();
      finish(); flush(); h.release(); await settle();
      expect(h.preparations()).toBe(1); expect(h.focused).toEqual([]);
      expect(h.address.initialLoading()).toBe(false);
    } finally { h.dispose(); }
  });

  test("closing the address owner retires a retained cleanup", async () => {
    const h = harness();
    const finish = h.address.navigationStarted({ retainInitial: true }); flush();
    h.dispose(); finish(); h.release(); await settle();
    expect(h.preparations()).toBe(1); expect(h.focused).toEqual([]); expect(h.navigations).toEqual([]);
  });
});

// A2/B3 + C1: run the production address owner and surface preparation callback.
// Control only browser history, model completion and the early-realm host leaf;
// execute readReady's actual synchronous prefix rather than copying its policy.
const surfaceSource = await Bun.file(new URL("./workspace-surface.tsx", import.meta.url)).text();
const prepareStart = surfaceSource.indexOf("    prepare: source => {");
const prepareEnd = surfaceSource.indexOf("    operate: props.store.operate,", prepareStart);
if (prepareStart < 0 || prepareEnd < 0) throw new Error("Source-aware address preparation boundary moved");
const prepareCallback = surfaceSource.slice(prepareStart, prepareEnd).trim().replace(/^prepare: /, "").replace(/,$/, "");
const localSource = await Bun.file(new URL("./local-locus-data.ts", import.meta.url)).text();
const readReadyStart = localSource.indexOf("  const readReady = (): Promise<void> => {");
const readReadyEnd = localSource.indexOf("    reading ??=", readReadyStart);
if (readReadyStart < 0 || readReadyEnd < 0) throw new Error("Local reader's synchronous preparation boundary moved");
const readReadyPrefix = new Bun.Transpiler({ loader: "ts" }).transformSync(
  localSource.slice(localSource.indexOf("{", readReadyStart) + 1, readReadyEnd));
const primeStart = localSource.indexOf("  const primeOrdinaryOwner = () => {");
const primeEnd = localSource.indexOf("  type Prepared<", primeStart);
if (primeStart < 0 || primeEnd < 0) throw new Error("Local ordinary owner priming boundary moved");
const primeCode = new Bun.Transpiler({ loader: "ts" }).transformSync(localSource.slice(primeStart, primeEnd));

function orderingHarness(pathname: string, sourceAware = true) {
  const events: string[] = [], focused: Source[] = [];
  let release!: () => void, realm = false;
  const prepared = new Promise<void>(resolve => { release = resolve; });
  const prime = new Function("assertActive", "ownsLocalRealm", "spawnEarlyAuthoringRealm", "workerLineage", "epoch", "retryEarlyAuthoringRealm",
    `let earlyRealm, snapshot; ${primeCode}; return primeOrdinaryAdmission;`)(() => {}, true,
    () => { if (!realm) { realm = true; events.push("early-realm"); } return {}; }, {}, 0, () => undefined);
  const readReady = new Function("assertActive", "options", "ready", "primeOrdinaryAdmission", "prepared",
    `return () => { ${readReadyPrefix}; return prepared; };`)(
    () => {}, { progressiveRead: true }, () => {}, prime, prepared);
  const prepareModel = () => { events.push("ordinary-prepare"); return prepared; };
  const prepare = sourceAware ? new Function("localTabDataSource", "prepareModel", `return (${prepareCallback});`)(
    () => ({ readReady }), prepareModel) : prepareModel;
  const bindings = { createEffect, createSignal, onCleanup, untrack,
    useLocation: () => ({ pathname, search: "", key: "initial", state: undefined }), useNavigate: () => () => {},
    workspaceSourceKey: (source: Source) => source.$tag,
    scopeFromWorkspace: () => ({ kind: "root" }), decodeLocusAddress: (path: string) => path.split("/").filter(Boolean).map(decodeURIComponent),
    locusSegmentUsesHostRoute: () => false, LENS_ADDRESS_NAVIGATION: "fenel.lens-address",
    resolveLocusAddress: (_root: unknown, segments: string[]) => ({ focus: { kind: "root" }, segments, readerIndependent: true }),
    locusAddressForScope: () => "/",
  };
  const install = new Function(...Object.keys(bindings), `${code}; return installWorkspaceAddress;`)(...Object.values(bindings));
  let dispose!: () => void;
  const address = createRoot(end => {
    dispose = end;
    return install({ enabled: true, active: () => undefined, accounts: () => [], prepare,
      operate: async () => { throw new Error("The extracted traversal does not invoke a model"); },
      root: async (source: Source) => { events.push("root"); if (source.$tag === "ThisTabSource") await readReady(); return { id: source.$tag }; },
      focus: async (source: Source, _focus: unknown, assertCurrent?: () => void) => {
        assertCurrent?.(); focused.push(source); return true;
      }, failed: () => {},
    });
  });
  flush();
  return { address, events, focused, release, dispose, realm: () => realm };
}

describe("direct address preparation starts the selected Local holder", () => {
  test("preference-only preparation leaves a direct Local child without an early realm", () => {
    const h = orderingHarness("/~/_saved", false);
    try {
      expect(h.events).toEqual(["ordinary-prepare"]); expect(h.realm()).toBe(false);
      expect(h.address.initialRootSource()).toBeUndefined(); expect(h.focused).toEqual([]);
    } finally { h.dispose(); h.release(); }
  });

  test("Local child primes before preference preparation without awaiting its completion", async () => {
    const h = orderingHarness("/~/_saved");
    try {
      expect(h.events).toEqual(["early-realm", "ordinary-prepare"]);
      expect(h.address.initialRootSource()).toBeUndefined(); expect(h.focused).toEqual([]);
      h.release(); await settle();
      expect(h.events).toEqual(["early-realm", "ordinary-prepare", "root"]);
      expect(h.focused).toEqual([{ $tag: "ThisTabSource" }]); expect(h.address.initialLoading()).toBe(false);
    } finally { h.dispose(); h.release(); }
  });

  for (const [pathname, tag, primesLocal] of [
    ["/~", "ThisTabSource", true], ["/@fenel/Example", "PublicSource", false], ["/", "AllDataSource", false],
  ] as const) test(`source preparation and root preview remain correct for ${pathname}`, async () => {
    const h = orderingHarness(pathname);
    try {
      expect(h.events).toEqual(primesLocal ? ["early-realm", "ordinary-prepare"] : ["ordinary-prepare"]);
      expect(h.realm()).toBe(primesLocal); expect(h.focused).toEqual([]);
      expect(h.address.initialRootSource()).toEqual(pathname === "/@fenel/Example" ? undefined : { $tag: tag });
      h.release(); await settle();
      expect(h.focused).toEqual([{ $tag: tag }]); expect(h.address.initialLoading()).toBe(false);
    } finally { h.dispose(); h.release(); }
  });
});

// Execute the preview's actual focus adapter with a held navigation boundary.
// The fixture records the target source and presentation separately so a lens
// code cannot accidentally occupy the source slot after interface changes.
const previewStart = surfaceSource.indexOf("    const navigatePreview = (");
const previewEnd = surfaceSource.indexOf("    const previewPane: WorkspacePane = {", previewStart);
const previewFocusStart = surfaceSource.indexOf("      onFocus: (focus, presentation) => navigatePreview", previewEnd);
const previewFocusEnd = surfaceSource.indexOf("      onDataTarget:", previewFocusStart);
if (previewStart < 0 || previewEnd < 0 || previewFocusStart < 0 || previewFocusEnd < 0) throw new Error("Initial preview focus boundary moved");
const previewCode = new Bun.Transpiler({ loader: "tsx" }).transformSync(
  `${surfaceSource.slice(previewStart, previewEnd)}\nconst pane = { ${surfaceSource.slice(previewFocusStart, previewFocusEnd)} };`);

function previewFocusHarness() {
  let rootSource: Source = { $tag: "ThisTabSource" }, epoch = 5;
  let entry = { abort: new AbortController() };
  let release!: () => void;
  const prepared = new Promise<void>(resolve => { release = resolve; });
  const requests: Array<{ id: string; focus: unknown; presentation?: string; target: Source; fromAddress: boolean }> = [];
  const published: typeof requests = [], failures: string[] = [];
  let flight: Promise<void> | undefined;
  const bindings = {
    value: () => ({ activeLensId: "persisted", lenses: [{ id: "persisted" }] }),
    props: { epoch: 5 }, sessionEpoch: () => epoch, surfaceClosed: false,
    source: () => rootSource, address: { initialRootSource: () => rootSource }, previewEntry: () => entry,
    workspaceSourceFromKey: (key: string): Source => ({ $tag: key === "public" ? "PublicSource" : key === "all" ? "AllDataSource" : "ThisTabSource" }),
    focusLens: (id: string, focus: unknown, presentation: string | undefined, target: Source, fromAddress: boolean, assertCurrent: () => void) => {
      const request = { id, focus, presentation, target, fromAddress }; requests.push(request);
      flight = (async () => { assertCurrent(); await prepared; assertCurrent(); published.push(request); })()
        .catch(error => { failures.push(error instanceof Error ? error.message : String(error)); });
      return flight;
    },
  };
  const pane = new Function(...Object.keys(bindings), `${previewCode}; return pane;`)(...Object.values(bindings)) as {
    onFocus: (focus: unknown, presentation?: string) => void; onSource: (key: string) => void; onAllData: () => void;
  };
  return { pane, requests, published, failures,
    replaceSource: () => { rootSource = { $tag: "PublicSource" }; },
    replaceReader: () => { entry = { abort: new AbortController() }; },
    changeSession: () => { epoch++; },
    finish: async () => { release(); await flight; },
  };
}

describe("initial preview focus preserves presentation and source slots", () => {
  test("a nonempty presentation reaches the existing focus transaction with the preview source", async () => {
    const h = previewFocusHarness(), focus = { kind: "value", itemId: "preview-child", path: [] };
    h.pane.onFocus(focus, "table");
    expect(h.requests).toEqual([{ id: "persisted", focus, presentation: "table", target: { $tag: "ThisTabSource" }, fromAddress: false }]);
    expect(h.published).toEqual([]); await h.finish();
    expect(h.published).toEqual(h.requests); expect(h.failures).toEqual([]);
  });

  test("source selection and All data keep their explicit source argument", async () => {
    const h = previewFocusHarness(); h.pane.onSource("public"); h.pane.onAllData(); await h.finish();
    expect(h.requests.map(request => ({ target: request.target, presentation: request.presentation }))).toEqual([
      { target: { $tag: "PublicSource" }, presentation: undefined }, { target: { $tag: "AllDataSource" }, presentation: undefined },
    ]);
    expect(h.failures).toEqual([]);
  });

  for (const change of ["replaceSource", "replaceReader", "changeSession"] as const) test(`${change}: a delayed preview focus cannot publish`, async () => {
    const h = previewFocusHarness(); h.pane.onFocus({ kind: "root" }, "table"); h[change](); await h.finish();
    expect(h.published).toEqual([]); expect(h.failures).toEqual(["This data preview changed. Open the current data again."]);
  });
});
