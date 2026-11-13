// Run with --conditions=browser --conditions=development for Solid 2's graph.
import { describe, expect, test } from "bun:test";
import { Show, createEffect, createMemo, createRoot, createSignal, createStore, flush, lazy, onSettled, untrack } from "solid-js";
import { cloneDraftValue } from "./native-draft";
import { workspaceSourceKey } from "./workspace-wire";

// Actual HomeEntry request/handoff owners, with real Solid 2 scheduling.
// The renderer/evaluator graph is not imported: held children track mounted
// identity and local presentation across public panel choices and URL intents.
const source = (await Bun.file(process.env.FENEL_HOME_ENTRY_HANDOFF_SOURCE ?? new URL("./home-entry.tsx", import.meta.url)).text()).replace(/\r\n/g, "\n");
function section(startMarker: string, endMarker: string) {
  const start = source.indexOf(startMarker), end = source.indexOf(endMarker, start);
  if (start < 0 || end <= start) throw new Error(`Home address handoff boundary changed: ${startMarker}`);
  return source.slice(start, end);
}
const requestState = section(source.includes("  const resumedCreation =") ? "  const resumedCreation =" : "  const [request, setRequest] = createSignal<", "  const [retryingEpoch,");
const requestedMemo = section("  const requested = createMemo(", "  // Solid 2 computes eagerly.");
const openWorkspace = section("  function openWorkspace(", source.indexOf("  const [inspectionIntent,") > source.indexOf("  function openWorkspace(")
  ? "  const [inspectionIntent," : "  onSettled(() => {");
const retargetAndEffect = section("  function retarget(", "  function chooseBranch(");
const showingMemo = section(source.includes("  const [enteredWorkspace, setEnteredWorkspace]")
  ? "  const [enteredWorkspace, setEnteredWorkspace]" : "  const showingWorkspace = createMemo(", "  createEffect(() => {\n    const runtime = props.readRuntime;");
const code = new Bun.Transpiler({ loader: "tsx" }).transformSync(requestState + requestedMemo + openWorkspace + retargetAndEffect + showingMemo);
type InputIntent = { id: number; text: string };
type Request = { epoch: number; action?: unknown; byUser: boolean; source: string };
type PreparedOwner = { runtime: object; source: string; epoch: number; presentation: string };
function harness(initial?: InputIntent, emptyControls = false, standalone = false, initialPresentation?: string) {
  let requests = 0, mounts = 0, codeLoads = 0, editorMounts = 0;
  const events: string[] = [];
  const codeFlights: Array<{ resolve: (value: { default: () => string }) => void; reject: (error: Error) => void }> = [];
  const Editor = lazy(() => {
    codeLoads++; events.push("editor-code");
    return new Promise<{ default: () => string }>((resolve, reject) => { codeFlights.push({ resolve, reject }); });
  });
  const [input, setInput] = createSignal(initial);
  const [ready, setReady] = createSignal(false);
  const [drawer, setDrawer] = createSignal(!emptyControls);
  const [picker, setPicker] = createSignal(!emptyControls);
  const [epoch, setEpoch] = createSignal(8);
  const [runtime, setRuntime] = createSignal<object>({ id: "reader-one" });
  const [paneSource, setPaneSource] = createSignal("public");
  const [mode, setMode] = createSignal("data");
  const [presentation, setPresentation] = createSignal(initialPresentation);
  // A page a fresh visit paints from the snapshot (Demo, the Fenel root, a record).
  const [snapshotPage, setSnapshotPage] = createSignal(false);
  const publicRoot = { id: "checked-public-root" };
  let dispose!: () => void;
  const bindings = {
    createSignal, createMemo, createEffect, untrack, onSettled, cloneDraftValue,
    props: { pane: { addressInputs: input, presentation, source: () => ({ $tag: "PublicSource" }) }, publicRoot, get readRuntime() { return runtime(); },
      ...(standalone ? {} : { renderWorkspace: () => undefined, prepareWorkspace: () => Editor.preload() }) },
    HomeWorkspace: Editor,
    sessionEpoch: epoch,
    paneSourceKey: paneSource,
    readProjection: () => publicRoot,
    currentNewOriginMatches: () => true,
    newExpressionRequest: () => undefined,
    workspace: { ready, request: () => { requests++; events.push("reader-request"); } },
    setPickerOpen: (open: boolean) => { events.push("picker"); setPicker(open); },
    setDrawerOpen: (open: boolean) => { events.push("drawer"); setDrawer(open); },
    currentReads: () => true,
    failed: () => false,
    inspectionMode: mode,
    heldLiteralInspection: () => false,
    creationReadAllowed: () => true,
    setInspectionIntent: () => {},
    focusIntent: () => undefined,
    inspectionIntent: () => undefined,
    typePreviewIntent: () => undefined,
    contextMenu: () => undefined,
    pickerOpen: picker,
    quickValue: () => undefined,
    readingClipboard: () => false,
    externalAdding: () => false,
    drawerOpen: drawer,
    savingQuickValue: () => false,
    earlyDraftHeld: () => false,
    earlyPickers: () => 0,
    dataInspectionPanelVisible: () => false,
    earlyHandoff: () => undefined,
    earlyDraftChanged: () => false,
    setEarlyDraft: () => {},
    publicSnapshotPage: snapshotPage,
  };
  const state = createRoot(end => {
    dispose = end;
    const actual = new Function(...Object.keys(bindings), `${code}; return { request, requested, showingWorkspace, openWorkspace, requestPresentationBody, setRequest };`)(...Object.values(bindings)) as {
      request: () => Request | undefined; requested: () => boolean; showingWorkspace: () => boolean;
      openWorkspace: (action?: unknown, byUser?: boolean, source?: string) => void;
      requestPresentationBody: (kind: string) => void; setRequest: (request: Request | undefined) => void;
    };
    // This is HomeEntry's real non-keyed Show boundary. A small held child
    // observes its mount identity and private presentation state; it has no
    // evaluator or data from another reader.
    const rendered = Show({ get when() { return actual.showingWorkspace(); }, fallback: "early",
      children: (_shown: () => boolean) => {
        mounts++;
        return { runtime: untrack(runtime), source: untrack(paneSource), epoch: untrack(epoch), presentation: "initial" };
      } }) as unknown as () => "early" | PreparedOwner;
    return { ...actual, rendered };
  });
  flush();
  return { ...state, events, dispose, input,
    requests: () => requests, mounts: () => mounts,
    codeLoads: () => codeLoads, editorMounts: () => editorMounts,
    resolveCode: () => codeFlights.at(-1)!.resolve({ default: () => { editorMounts++; return "editor"; } }),
    rejectCode: () => codeFlights.at(-1)!.reject(new Error("Controlled editor code refusal")),
    open: (action: unknown = "browse") => { state.openWorkspace(action, true, "source"); flush(); },
    setInput: (value?: InputIntent) => { setInput(value); flush(); },
    ready: () => { setReady(true); flush(); },
    nextSession: () => { setEpoch(value => value + 1); flush(); },
    replaceRuntime: () => { setRuntime({ id: "reader-two" }); flush(); },
    replaceSource: () => { setPaneSource("this-tab"); flush(); },
    mode: (value: string) => { setMode(value); flush(); },
    presentation: (value: string) => { setPresentation(value); flush(); },
    selectPresentation: (value: string) => { setPresentation(value); state.requestPresentationBody(value); flush(); },
    cancelPresentation: () => { state.setRequest(undefined); flush(); },
    snapshotPage: (value: boolean) => { setSnapshotPage(value); flush(); },
    /** A collection or function page acquiring the body by itself (`focusedPublicCollection`'s effect). */
    acquire: () => { state.openWorkspace(undefined, false, "source"); flush(); },
  };
}

describe("explicit public layouts acquire the existing prepared Home", () => {
  for (const kind of [undefined, "value", "desktop"]) test(`${kind ?? "automatic"} keeps the lightweight initial read`, () => {
    const h = harness(undefined, true, false, kind);
    try {
      h.ready();
      expect(h.requests()).toBe(0); expect(h.codeLoads()).toBe(0);
      expect(h.rendered()).toBe("early"); expect(h.mounts()).toBe(0);
    } finally { h.dispose(); }
  });

  for (const kind of ["table", "grid", "list"]) test(`${kind} prepares the shared body while retaining its early read`, () => {
    const h = harness(undefined, true);
    try {
      h.presentation(kind);
      expect(h.requests()).toBe(1); expect(h.codeLoads()).toBe(1);
      expect(h.request()).toEqual({ epoch: 8, action: undefined, byUser: true, source: "source" });
      expect(h.rendered()).toBe("early"); expect(h.mounts()).toBe(0);
      h.ready();
      expect(h.rendered()).not.toBe("early"); expect(h.mounts()).toBe(1);
      const owner = h.rendered();
      h.presentation(kind === "table" ? "grid" : "table");
      expect(h.rendered()).toBe(owner); expect(h.mounts()).toBe(1);
      expect(h.requests()).toBe(1); expect(h.codeLoads()).toBe(1);
    } finally { h.dispose(); }
  });

  test("a separate lens already carrying Table prepares its own body", () => {
    const h = harness(undefined, true, false, "table");
    try {
      expect(h.requests()).toBe(1); expect(h.codeLoads()).toBe(1);
      expect(h.rendered()).toBe("early");
      h.ready(); expect(h.mounts()).toBe(1); expect(h.rendered()).not.toBe("early");
    } finally { h.dispose(); }
  });

  test("a presentation preserves an existing captured call intent", () => {
    const h = harness(undefined, true);
    const action = { kind: "call-function", referenceId: "greek-call", rootId: "public-root", revision: 2 };
    try {
      h.open(action);
      const pending = h.request();
      h.selectPresentation("table");
      expect(h.request()).toBe(pending); expect(h.request()?.action).toBe(action);
      expect(h.requests()).toBe(1); expect(h.codeLoads()).toBe(1);
      h.ready(); expect(h.mounts()).toBe(1);
    } finally { h.dispose(); }
  });

  test("selecting the same presentation again retries a cancelled handoff", () => {
    const h = harness(undefined, true);
    try {
      h.selectPresentation("table"); h.cancelPresentation();
      expect(h.requested()).toBe(false); expect(h.rendered()).toBe("early");
      h.selectPresentation("table");
      expect(h.requests()).toBe(2); expect(h.codeLoads()).toBe(1);
      h.ready(); expect(h.mounts()).toBe(1);
    } finally { h.dispose(); }
  });

  test("a retired session cannot publish its pending Table handoff", () => {
    const h = harness(undefined, true);
    try {
      h.presentation("table"); h.nextSession(); h.ready();
      expect(h.requested()).toBe(false); expect(h.rendered()).toBe("early"); expect(h.mounts()).toBe(0);
      expect(h.requests()).toBe(1);
    } finally { h.dispose(); }
  });
});

describe("named URL inputs retain the existing Home editor intent", () => {
  test("a public card call intent mounts the same prepared Home once", () => {
    const h = harness(undefined, true);
    const action = { kind: "call-function", referenceId: "signup-uuid", rootId: "public-root", revision: 2 };
    try {
      h.ready(); expect(h.showingWorkspace()).toBe(false);
      h.open(action);
      expect(h.request()?.action).toBe(action); expect(h.showingWorkspace()).toBe(true); expect(h.mounts()).toBe(1);
      h.ready(); expect(h.mounts()).toBe(1);
    } finally { h.dispose(); }
  });
  test("the initial address effect is registered after its request state and retarget callbacks", () => {
    const effect = source.indexOf("createEffect(() => props.pane?.addressInputs?.()?.id");
    expect(effect).toBeGreaterThan(source.indexOf("const [request, setRequest]"));
    expect(effect).toBeGreaterThan(source.indexOf("function retarget("));
  });

  test("an input already present during setup records source intent and requests the reader", () => {
    const h = harness({ id: 41, text: "the quick brown fox" });
    try {
      expect(h.requests()).toBe(1);
      expect(h.request()).toEqual({ epoch: 8, action: undefined, byUser: true, source: "source" });
      expect(h.requested()).toBe(true); expect(h.showingWorkspace()).toBe(false);
      expect(h.events).toEqual(["picker", "drawer", "editor-code", "reader-request"]);
      h.ready(); expect(h.showingWorkspace()).toBe(true);
      expect(h.requests()).toBe(1);
    } finally { h.dispose(); }
  });

  test("reader readiness alone keeps a public data lens on its early renderer", () => {
    const h = harness();
    try { h.ready(); expect(h.requests()).toBe(0); expect(h.requested()).toBe(false); expect(h.showingWorkspace()).toBe(false); }
    finally { h.dispose(); }
  });

  test("one address id triggers once, while a later address records one new intent", () => {
    const h = harness({ id: 41, text: "first" });
    try {
      h.setInput({ id: 41, text: "same intent, different object" }); expect(h.requests()).toBe(1);
      h.setInput({ id: 42, text: "new addressed call" }); expect(h.requests()).toBe(2);
      expect(h.request()?.source).toBe("source");
      h.setInput({ id: 42, text: "same new intent" }); expect(h.requests()).toBe(2);
    } finally { h.dispose(); }
  });

  test("consuming addressInputs preserves the ready handoff instead of returning to the early lens", () => {
    const h = harness({ id: 41, text: "prefill only" });
    try {
      h.ready(); expect(h.showingWorkspace()).toBe(true);
      const retained = h.request(); h.setInput(undefined);
      expect(h.request()).toBe(retained); expect(h.requested()).toBe(true); expect(h.showingWorkspace()).toBe(true);
      expect(h.requests()).toBe(1); expect(h.input()).toBeUndefined();
    } finally { h.dispose(); }
  });
});

describe("editor code acquisition overlaps its existing reader preparation", () => {
  const settle = async () => { for (let turn = 0; turn < 8; turn++) await Promise.resolve(); flush(); };

  test("an editor intent starts the existing lazy code before reader readiness without mounting it", async () => {
    const h = harness({ id: 71, text: "prepare the Call editor" });
    try {
      expect(h.codeLoads()).toBe(1); expect(h.requests()).toBe(1);
      expect(h.events.indexOf("editor-code")).toBeLessThan(h.events.indexOf("reader-request"));
      expect(h.showingWorkspace()).toBe(false); expect(h.mounts()).toBe(0); expect(h.editorMounts()).toBe(0);
      h.resolveCode(); await settle();
      expect(h.showingWorkspace()).toBe(false); expect(h.mounts()).toBe(0); expect(h.editorMounts()).toBe(0);
      h.ready(); expect(h.showingWorkspace()).toBe(true); expect(h.mounts()).toBe(1);
      expect(h.editorMounts()).toBe(0);
    } finally { h.dispose(); }
  });

  test("ordinary data and reader readiness acquire no editor code", () => {
    const h = harness(undefined, true);
    try {
      expect(h.codeLoads()).toBe(0); h.ready();
      expect(h.codeLoads()).toBe(0); expect(h.requests()).toBe(0); expect(h.mounts()).toBe(0);
    } finally { h.dispose(); }
  });

  test("retargeting shares the lazy flight and retains the latest intent", async () => {
    const h = harness();
    try {
      h.open("browse"); h.open("new:function");
      expect(h.codeLoads()).toBe(1); expect(h.request()?.action).toBe("new:function");
      expect(h.mounts()).toBe(0); expect(h.editorMounts()).toBe(0);
      h.resolveCode(); await settle(); h.open("browse");
      expect(h.codeLoads()).toBe(1); expect(h.request()?.action).toBe("browse");
    } finally { h.dispose(); }
  });

  test("a code refusal leaves reader preparation intact and the lazy owner retries", async () => {
    const h = harness({ id: 72, text: "retry" });
    try {
      h.rejectCode(); await settle();
      expect(h.requests()).toBe(1); expect(h.request()?.source).toBe("source"); expect(h.mounts()).toBe(0);
      h.open(); expect(h.codeLoads()).toBe(2); expect(h.requests()).toBe(2);
      h.resolveCode(); await settle(); h.ready(); expect(h.showingWorkspace()).toBe(true);
    } finally { h.dispose(); }
  });

  test("the standalone Home entry preloads its own existing lazy component", async () => {
    const h = harness({ id: 73, text: "standalone" }, false, true);
    try {
      expect(h.codeLoads()).toBe(1); expect(h.editorMounts()).toBe(0); expect(h.mounts()).toBe(0);
      h.resolveCode(); await settle(); expect(h.editorMounts()).toBe(0);
    } finally { h.dispose(); }
  });

  test("a session change during code acquisition cannot publish the retained editor intent", async () => {
    const h = harness({ id: 74, text: "old session" });
    try {
      h.nextSession(); h.resolveCode(); await settle(); h.ready();
      expect(h.requested()).toBe(false); expect(h.showingWorkspace()).toBe(false); expect(h.mounts()).toBe(0);
      expect(h.editorMounts()).toBe(0);
    } finally { h.dispose(); }
  });
});

describe("public prepared Home owner retention", () => {
  // Nov 12: from a formula, "Demo" in the path dialog froze the tab for minutes:
  // the body a collection had acquired stayed for every later page, so it
  // evaluated and drew every demo of the Demo record. A fresh /demo paints it
  // from the snapshot in seconds.
  test("a page a fresh visit paints from the snapshot is painted the same way after a collection acquired the body", () => {
    const h = harness(undefined, true);
    try {
      h.ready();
      h.acquire();
      const owner = h.rendered();
      expect(owner).not.toBe("early");
      expect(h.requests()).toBe(1);
      h.snapshotPage(true);
      expect(h.rendered()).toBe("early");
      expect(h.request()).toBeUndefined();
      // Back to a collection: the entered body shows again, without a new acquisition.
      h.snapshotPage(false);
      expect(h.rendered()).not.toBe("early");
      expect(h.requests()).toBe(1);
    } finally { h.dispose(); }
  });
  test("Data → Expression → Data keeps the entered owner and its presentation without a request command", () => {
    const h = harness(undefined, true);
    try {
      h.ready();
      expect(h.rendered()).toBe("early");
      expect(h.mounts()).toBe(0);
      expect(h.requested()).toBe(false);
      h.mode("expression");
      const owner = h.rendered();
      expect(owner).not.toBe("early");
      if (typeof owner === "string") throw new Error("Prepared Home did not mount");
      owner.presentation = "expanded input";
      expect(h.mounts()).toBe(1);
      h.mode("data");
      expect(h.rendered()).toBe(owner);
      expect(h.rendered()).toMatchObject({ presentation: "expanded input" });
      h.mode("expression"); h.mode("data");
      expect(h.rendered()).toBe(owner);
      expect(h.mounts()).toBe(1);
      expect(h.requested()).toBe(false);
      expect(h.requests()).toBe(0);
    } finally { h.dispose(); }
  });

  for (const boundary of ["runtime", "source", "epoch"] as const) test(`a changed ${boundary} cannot reuse an entered prepared owner`, () => {
    const h = harness(undefined, true);
    try {
      h.ready(); h.mode("expression");
      const old = h.rendered();
      expect(old).not.toBe("early");
      h.mode("data");
      expect(h.rendered()).toBe(old);
      if (boundary === "runtime") h.replaceRuntime();
      else if (boundary === "source") h.replaceSource();
      else h.nextSession();
      expect(h.rendered()).toBe("early");
      expect(h.showingWorkspace()).toBe(false);
      expect(h.requested()).toBe(false);
      h.mode("expression");
      const current = h.rendered();
      expect(current).not.toBe("early");
      expect(current).not.toBe(old);
      expect(h.mounts()).toBe(2);
      h.mode("data");
      expect(h.rendered()).toBe(current);
      expect(h.mounts()).toBe(2);
    } finally { h.dispose(); }
  });
});

// The same production shelf that routes the global bar into HomeEntry. These
// controls hold navigation publication and supply only root read verdicts.
const shelfSource = (await Bun.file(new URL("./workspace-surface.tsx", import.meta.url)).text()).replace(/\r\n/g, "\n");
const shelfStart = shelfSource.indexOf("  const rootHandlers = new Set<"), shelfEnd = shelfSource.indexOf("  createEffect(() => composerSearch.new", shelfStart);
if (shelfStart < 0 || shelfEnd <= shelfStart) throw new Error("Root intent owner moved");
const shelfCode = new Bun.Transpiler({ loader: "ts" }).transformSync(shelfSource.slice(shelfStart, shelfEnd));
type ShelfLens = { id: string; source: { $tag: string; accountId?: string }; focus: { $tag: string; viewId?: string } };
function shelfHarness() {
  return createRoot(dispose => {
    const [scene, setScene] = createStore<{ activeLensId: string; epoch: number; lenses: ShelfLens[] }>({ activeLensId: "origin", epoch: 8,
      lenses: [{ id: "origin", source: { $tag: "PublicSource" }, focus: { $tag: "RootFocus" } },
        { id: "target", source: { $tag: "ThisTabSource" }, focus: { $tag: "RootFocus" } },
        { id: "other", source: { $tag: "AccountSource", accountId: "other-account" }, focus: { $tag: "RootFocus" } }] });
    const runs: Array<{ id: string; action: string }> = [];
    const publications: Array<(id: string) => boolean> = [];
    const active = () => scene.lenses.find(lens => lens.id === scene.activeLensId);
    const bindings = { createSignal, createEffect, untrack, workspaceSourceKey, props: { epoch: 8 }, active, value: () => scene,
      sessionEpoch: () => scene.epoch, document: { querySelector: () => null, querySelectorAll: () => [] }, useSearchParams: () => [{}, () => {}],
      address: { initialLoading: () => false, initialRootSource: () => undefined },
      exploreData: (_source: string, accept: (id: string) => boolean) => { publications.push(accept); accept("target"); } };
    const actual = new Function(...Object.keys(bindings), `let surfaceClosed = false; ${shelfCode}; return {
      rootShelf, pending: () => currentRootIntent, close: () => { surfaceClosed = true; } };`)(...Object.values(bindings)) as {
      rootShelf: { request: (action: string) => void; cancel: (id?: string) => void; register: (handler: object) => () => void };
      pending: () => object | undefined; close: () => void;
    };
    const register = (id: string, create = true, choose = false, resolved = true) => actual.rootShelf.register({ paneId: id,
      sourceKey: () => workspaceSourceKey(scene.lenses.find(lens => lens.id === id)!.source as never),
      isRoot: () => scene.lenses.find(lens => lens.id === id)?.focus.$tag === "RootFocus", isActive: () => scene.activeLensId === id,
      canCreate: () => create, canChooseCreation: () => choose, creationResolved: () => resolved,
      run: (action: string) => runs.push({ id, action }) });
    return { ...actual, active, runs, dispose, register,
      request: () => { actual.rootShelf.request("new"); flush(); },
      arrive: () => { if (publications.at(-1)?.("target")) setScene(draft => { draft.activeLensId = "target"; }); flush(); },
      navigate: (id: string) => { setScene(draft => { draft.activeLensId = id; }); flush(); },
      mutateSource: () => { setScene(draft => { draft.lenses[0]!.source.$tag = "AccountSource"; draft.lenses[0]!.source.accountId = "changed"; }); flush(); },
      restoreSource: () => { setScene(draft => { draft.lenses[0]!.source.$tag = "PublicSource"; delete draft.lenses[0]!.source.accountId; }); flush(); },
      mutateFocus: () => { setScene(draft => { draft.lenses[0]!.focus.$tag = "ViewFocus"; draft.lenses[0]!.focus.viewId = "changed"; }); flush(); },
      restoreFocus: () => { setScene(draft => { draft.lenses[0]!.focus.$tag = "RootFocus"; delete draft.lenses[0]!.focus.viewId; }); flush(); },
      nextSession: () => { setScene(draft => { draft.epoch += 1; }); flush(); },
      publishAllowed: () => publications.at(-1)?.("target") ?? false,
    };
  });
}
async function shelfTurn() { await Promise.resolve(); flush(); }

describe("global creation intent destination", () => {
  test("an unrelated writable root cannot consume New while its temporary destination prepares", async () => {
    const h = shelfHarness();
    try {
      h.request(); h.register("other"); await shelfTurn();
      expect(h.runs).toEqual([]);
      h.arrive(); h.register("target", false, true, false); await shelfTurn();
      expect(h.runs).toEqual([{ id: "target", action: "new" }]);
      expect(h.pending()).toBeUndefined();
    } finally { h.dispose(); }
  });

  for (const change of ["navigate", "source", "focus", "session", "cancel", "close"] as const) test(`${change} retires a pending New before late target publication`, async () => {
    const h = shelfHarness();
    try {
      h.request();
      const original = h.active();
      if (change === "navigate") { h.navigate("other"); h.navigate("origin"); }
      else if (change === "source") { h.mutateSource(); h.restoreSource(); expect(h.active()).toBe(original); }
      else if (change === "focus") { h.mutateFocus(); h.restoreFocus(); expect(h.active()).toBe(original); }
      else if (change === "session") h.nextSession();
      else if (change === "cancel") h.rootShelf.cancel();
      else h.close();
      expect(h.publishAllowed()).toBe(false);
      h.arrive(); h.register("target"); await shelfTurn();
      expect(h.runs).toEqual([]);
    } finally { h.dispose(); }
  });

  test("cancel between target registration and queued delivery prevents the selector from opening", async () => {
    const h = shelfHarness();
    try {
      h.request(); h.arrive(); h.register("target", false, true, false); h.rootShelf.cancel("target");
      await shelfTurn(); expect(h.runs).toEqual([]);
    } finally { h.dispose(); }
  });

  test("a resolved readonly destination drops the intent", async () => {
    const h = shelfHarness();
    try {
      h.request(); h.arrive(); h.register("target", false, false, true); await shelfTurn();
      expect(h.runs).toEqual([]); expect(h.pending()).toBeUndefined();
    } finally { h.dispose(); }
  });
});

// A non-keyed Show hands its child an accessor that throws "Stale read from
// <Show>." once the condition is false. In the running app a child computation
// still read it in the flush that released the value: PendingDestination's
// summary after a navigation (the whole lens surface failed, 2026-11-11), a
// LocusContextMenu placement effect as a LocusSelect menu closed. (A bare
// Solid graph disposes first; the app's held transitions do not.) Views that
// put computations on such a transient object key on it instead.
describe("transient Show values", () => {
  test("lens navigation and menu views key on their transient value", async () => {
    const read = async (path: string) => (await Bun.file(new URL(path, import.meta.url)).text()).replace(/\r\n/g, "\n");
    const surface = await read("./workspace-surface.tsx");
    expect(surface.match(/<Show when=\{pendingNavigation\((?:id|selectedId\(\))\)\} keyed>\{pending => <PendingDestination pending=\{pending\} \/>\}<\/Show>/g)?.length).toBe(2);
    const breadcrumb = await read("./locus-breadcrumb.tsx");
    expect(breadcrumb).not.toMatch(/<Show when=\{props\.pending\}( fallback|>)/);
    expect(breadcrumb.match(/<Show when=\{props\.pending\} keyed/g)?.length).toBe(2);
    const select = await read("./locus-select.tsx");
    expect(select).toContain("<Show when={at()} keyed>{(position) => (");
    const home = await read("../routes/app/home.tsx");
    expect(home).toContain("renderRow={(index) => <Show when={props.view.items[index]} keyed>{(item) =>");
  });
});
