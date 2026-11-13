// Run with --conditions=browser --conditions=development for Solid's browser graph.
import { describe, expect, test } from "bun:test";
import { NotReadyError, createLoadingBoundary, createMemo, createRoot, createSignal, flush, isPending, refresh, untrack } from "solid-js";
import type { LocusScope } from "./locus-scope";
import type { LocusLayoutChoice } from "./locus-layout-options";

// Exercise Home's real adapter without loading its editor/registry graph. The
// controlled boundary is the pane's persisted focus/presentation publication.
const home = await Bun.file(process.env.FENEL_LENS_FOCUS_SOURCE ?? new URL("../routes/app/home.tsx", import.meta.url)).text();
const transpiler = new Bun.Transpiler({ loader: "ts" });
const focusStart = home.indexOf("  const [localScope, setScope]");
const focusEnd = home.indexOf("  const heldSubjectAdmission", focusStart);
const kindStart = home.indexOf("  const currentKind =");
const kindEnd = home.indexOf("  const focusedType =", kindStart);
if ([focusStart, focusEnd, kindStart, kindEnd].some(index => index < 0)) throw new Error("Home lens adapter moved");
const bindFocus = new Function("props", "createSignal", "createMemo", "ROOT_SCOPE",
  `${transpiler.transformSync(home.slice(focusStart, focusEnd))}; return { scope, navigateScope };`);
const bindKind = new Function("props", "scope", "valueScope", "scopeSubject", "layoutOptions",
  `const localCodePresentation = () => undefined; ${transpiler.transformSync(home.slice(kindStart, kindEnd))}; return currentKind;`);

describe("lens focus and presentation", () => {
  test("entering a value publishes its focus and presentation together", async () => {
    const harness = createRoot(dispose => {
      const [lens, setLens] = createSignal<{ focus: LocusScope; presentation: string }>({
        focus: { kind: "root" }, presentation: "list",
      });
      let pending = Promise.resolve();
      const pane = {
        focus: () => lens().focus,
        source: () => ({ $tag: "PublicSource" }),
        onFocus: (focus: LocusScope) => { pending = Promise.resolve().then(() => { setLens({ focus, presentation: "grid" }); }); },
      };
      const actual = bindFocus({ pane }, createSignal, createMemo, { kind: "root" }) as {
        scope: () => LocusScope; navigateScope: (scope: LocusScope) => void;
      };
      const rendered: string[] = [];
      const shown = createMemo(() => {
        const focus = actual.scope();
        const value = `${focus.kind}:${lens().presentation}`;
        rendered.push(value);
        return value;
      });
      return { ...actual, shown, rendered, dispose, pending: () => pending };
    });
    try {
      expect(untrack(harness.shown)).toBe("root:list");
      harness.navigateScope({ kind: "view", viewId: "children" });
      flush();
      expect(untrack(harness.shown)).toBe("root:list");
      await harness.pending();
      flush();
      expect(untrack(harness.shown)).toBe("view:grid");
      expect(harness.rendered).not.toContain("view:list");
    } finally { harness.dispose(); }
  });

  test("selecting another lens does not invalidate this lens's unchanged value focus", () => {
    const harness = createRoot(dispose => {
      const initial: LocusScope = { kind: "value", viewId: "list", itemId: "record", path: ["parts", 1], rootItem: true, passThrough: [1] };
      const [focus, setFocus] = createSignal(initial);
      const actual = bindFocus({ pane: { focus, onFocus: setFocus } }, createSignal, createMemo, { kind: "root" }) as { scope: () => LocusScope };
      let reads = 0;
      const value = createMemo(() => { reads++; return actual.scope(); });
      return { initial, setFocus, value, reads: () => reads, dispose };
    });
    try {
      untrack(harness.value);
      const before = harness.reads();
      harness.setFocus({ ...harness.initial, path: ["parts", 1], passThrough: [1] });
      flush();
      untrack(harness.value);
      expect(harness.reads()).toBe(before);
      harness.setFocus({ ...harness.initial, path: ["parts", "1"], passThrough: [1] });
      flush();
      expect(untrack(harness.value)).toMatchObject({ path: ["parts", "1"] });
      expect(harness.reads()).toBe(before + 1);
    } finally { harness.dispose(); }
  });

  const presentation = (scope: LocusScope, selected?: LocusLayoutChoice, supportsCanvas = true) => {
    const row = { view: { kind: "canvas" } };
    return bindKind({ pane: { presentation: () => selected } }, () => scope, () => undefined,
      () => ({ row }), () => [{ value: "list" }, { value: "grid" }, ...(supportsCanvas ? [{ value: "canvas" }] : [])])();
  };

  // Rom's 2026-10-12 choice: List is the automatic fallback (84a2b15f).
  test("saved lists default to List while an explicit canvas preserves coordinates", () => {
    expect(presentation({ kind: "view", viewId: "placed-list" })).toBe("list");
    expect(presentation({ kind: "view", viewId: "placed-list" }, "canvas")).toBe("canvas");
    expect(presentation({ kind: "view", viewId: "old-list" }, undefined, false)).toBe("list");
    expect(presentation({ kind: "value", viewId: "root", itemId: "authored-canvas", path: [] })).toBe("canvas");
  });
});

// Keep the actual global-worker notification and Home read owners. Only the
// catalogue/evaluation transport is controlled: a second reader's activation
// must leave this settled data and expression subject mounted in place.
const workerSource = await Bun.file(new URL("./expression-runner/authoring-catalog-worker.ts", import.meta.url)).text();
function workerDeclaration(marker: string) {
  const start = workerSource.indexOf(marker);
  const end = workerSource.indexOf("\n}", start);
  if (start < 0 || end < start) throw new Error(`Worker lifecycle adapter moved: ${marker}`);
  return workerSource.slice(start, end + 2).replace(/^export /, "");
}
const workerCode = transpiler.transformSync([
  workerDeclaration("function ownerOf("),
  workerDeclaration("function currentWorker("),
  workerDeclaration("export function authoringWorkerSnapshot("),
  workerDeclaration("export function authoringWorkerRetired("),
  workerDeclaration("export function attachPreparedAuthoringWorker("),
].join("\n"));
const readStart = home.indexOf("  /** Resolve a value scope:");
const readEnd = home.indexOf("\n  // A released drag", readStart);
const subjectStart = home.indexOf("  const lensExpressionSubject = createMemo");
const subjectEnd = home.indexOf("\n  let handledAddressRequest", subjectStart);
if ([readStart, readEnd, subjectStart, subjectEnd].some(index => index < 0)) throw new Error("Home's focused reader adapter moved");
const readCode = transpiler.transformSync(home.slice(readStart, readEnd) + home.slice(subjectStart, subjectEnd));
type FocusedRead = { ok: true; container: unknown; sourceExpression: unknown } | { ok: false; error: string } | undefined;
type Subject = { item: { source: { expr: unknown } }; evaluated: { value: unknown } } | undefined;
function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>(yes => { resolve = yes; });
  return { promise, resolve };
}
async function settleFocusedRead() {
  for (let index = 0; index < 12; index++) await Promise.resolve();
  flush();
}
function focusedReaderHarness(initialEvaluation?: Promise<{ result: unknown }>) {
  // Home's focused read is an async memo since b8f5b905; in the app it is
  // read under the lens's Loading boundary, so the harness provides one.
  let harness!: ReturnType<typeof focusedReaderOwner>;
  const dispose = createRoot(end => {
    createLoadingBoundary(() => { harness = focusedReaderOwner(initialEvaluation, end); return undefined; }, () => undefined);
    return end;
  });
  flush();
  // A read the graph still holds for its Loading boundary is reported as
  // PENDING instead of escaping the test (the lens shows its pending frame).
  const settled = <T,>(read: () => T) => (): T | typeof PENDING => {
    try { return read(); } catch (error) { if (error instanceof NotReadyError) return PENDING; throw error; }
  };
  return { ...harness, valueScope: settled(harness.valueScope), lensExpressionSubject: settled(harness.lensExpressionSubject), dispose };
}
const PENDING = Symbol("pending");
function focusedReaderOwner(initialEvaluation: Promise<{ result: unknown }> | undefined, dispose: () => void) {
  {
    const [workerRevision, setWorkerRevision] = createSignal(0);
    const registry = { getIdentifiedEntity: () => undefined };
    const session = { registry, environment: {}, evaluateContext: {} };
    // The worker routes by owner; an account session's owner is its registry.
    const byOwner = new WeakMap<object, object>();
    const bySession = new WeakMap<object, object>();
    const retiredByOwner = new WeakMap<object, object>();
    const sessionOwners = new WeakMap<object, object>();
    const ownedRegistries = new WeakSet<object>();
    const byCatalog = new WeakMap<object, object>();
    const snapshotTokens = new WeakMap<object, object>();
    const makeClient = () => ({ closed: false, epoch: 1, independent: true, contexts: new WeakMap() });
    byOwner.set(registry, makeClient());
    let epoch = 1;
    let origin: object | undefined;
    const controller = new AbortController();
    const initialExpression = { kind: "literal", value: "LENEF" };
    const [item, setItem] = createSignal({ id: "reversed", source: { kind: "expr", expr: initialExpression }, valueType: { $ref: "String" } });
    const type = { $ref: "String" };
    const here = { kind: "value", viewId: "demo", itemId: "reversed", path: [] };
    const assertCurrentSession = (expected: number) => { if (expected !== epoch) throw new Error("The browser session changed."); };
    const workerBindings = { workerRevision, byOwner, bySession, retiredByOwner, sessionOwners, ownedRegistries,
      MISSING_SNAPSHOT_OWNER: "missing owner", byCatalog, snapshotTokens,
      concreteAuthoringSession: (value: unknown) => value, assertCurrentSession,
      setWorkerRevision, installPreparedWorkspaceCatalog: () => {}, accountFieldRegistryState: () => undefined };
    const worker = new Function(...Object.keys(workerBindings), `${workerCode}; return { authoringWorkerSnapshot, authoringWorkerRetired, attachPreparedAuthoringWorker };`)(
      ...Object.values(workerBindings)) as { authoringWorkerSnapshot: (session: object) => object | undefined;
        authoringWorkerRetired: (session: object) => boolean;
        attachPreparedAuthoringWorker: (registry: object, catalog: object, session: object) => void };
    let evaluation = initialEvaluation;
    let evaluations = 0;
    // An account reader: retirement is the worker's own authoringWorkerRetired.
    const bindings = { createMemo, createSignal, isPending, refresh, untrack, reader: undefined,
      authoringWorkerSnapshot: worker.authoringWorkerSnapshot, authoringWorkerRetired: worker.authoringWorkerRetired,
      authoringWorkerReplacementPending: () => { throw new Error("An account reader never asks for a Local replacement"); },
      scope: () => here, draftRevision: () => 0,
      rowById: () => ({ id: "demo", view: { kind: "list", items: [item()] } }),
      viewPersistence: { read: (_id: string, view: unknown) => view }, asView: (view: unknown) => view,
      findLocusItem: (items: Array<{ id: string }>, id: string) => items.find(candidate => candidate.id === id),
      savedExprById: () => new Map(), resolveExpr: (value: ReturnType<typeof item>) => value.source.expr,
      transferSession: () => session, getCatalog: () => [], createReaderPresentation: () => ({ catalogEntry: () => undefined }),
      resolveLocusCatalogReference: () => undefined, homeData: { type: () => type }, savedQueryForItem: () => undefined,
      rootSourceTicket: () => ({ origin }), root: () => ({ revision: 1 }), scopeKey: () => "demo:reversed",
      sessionEpoch: () => epoch, client: { signal: controller.signal },
      evaluateLocusCard: (expression: { value: unknown }, _saved: unknown, capturedSession: object) => {
        evaluations++; worker.authoringWorkerSnapshot(capturedSession);
        return evaluation ?? { result: expression.value };
      }, assertCurrentSession,
      assertSourceTicket: (ticket: { origin: unknown }) => { if (ticket.origin !== origin) throw new Error("The data source changed."); },
      followLocusPath: (value: unknown) => ({ value, followed: false }), readLocusCatalogReference: () => undefined,
      resolveValueType: (value: unknown) => value, isFenelTypeLike: () => false, childrenOf: () => undefined,
      props: { pane: { subject: () => undefined } }, heldLensSubject: () => undefined,
      expressionEditOptions: () => ({}), focusedLocusItem: (value: unknown) => value,
      projectAuthoredExpression: (source: unknown) => ({ source, sourcePath: [] }),
    };
    const actual = new Function(...Object.keys(bindings), `${readCode}; return { valueScope, lensExpressionSubject };`)(...Object.values(bindings)) as {
      valueScope: () => FocusedRead; lensExpressionSubject: () => Subject;
    };
    const activate = (targetRegistry: object, targetSession: object) => {
      const catalog = {}; byCatalog.set(catalog, makeClient());
      worker.attachPreparedAuthoringWorker(targetRegistry, catalog, targetSession);
    };
    return { ...actual, dispose, evaluations: () => evaluations,
      activateOther: () => { const otherRegistry = {}; activate(otherRegistry, { registry: otherRegistry }); },
      replaceWorker: () => activate(registry, session),
      holdEvaluation: () => { const held = deferred<{ result: unknown }>(); evaluation = held.promise; return held; },
      changeExpression: (value: string) => setItem({ ...item(), source: { kind: "expr", expr: { kind: "literal", value } } }),
      changeOrigin: () => { origin = {}; }, changeEpoch: () => { epoch++; }, close: () => controller.abort(),
    };
  }
}

describe("focused data lifetime", () => {
  test("another reader's worker activation retains the loaded data and expression owner", async () => {
    const harness = focusedReaderHarness();
    try {
      harness.valueScope(); await settleFocusedRead();
      const value = harness.valueScope();
      const subject = harness.lensExpressionSubject();
      expect(value).toMatchObject({ ok: true, container: "LENEF" });
      expect(subject !== PENDING && subject?.evaluated.value).toBe("LENEF");
      const calls = harness.evaluations();
      harness.activateOther(); flush();
      expect(harness.valueScope()).toBe(value);
      expect(harness.lensExpressionSubject()).toBe(subject);
      expect(harness.evaluations()).toBe(calls);
      await settleFocusedRead();
      expect(harness.valueScope()).toBe(value);
    } finally { harness.dispose(); }
  });

  test("the selected reader's worker replacement rereads and refuses the previous flight", async () => {
    const old = deferred<{ result: unknown }>();
    const harness = focusedReaderHarness(old.promise);
    try {
      harness.valueScope(); await settleFocusedRead();
      const current = harness.holdEvaluation();
      harness.replaceWorker(); flush();
      harness.valueScope();
      expect(harness.evaluations()).toBe(2);
      old.resolve({ result: "stale" }); await settleFocusedRead();
      // No answer was ever committed, so the read still belongs to Loading.
      expect(harness.valueScope()).toBe(PENDING);
      current.resolve({ result: "current" }); await settleFocusedRead();
      expect(harness.valueScope()).toMatchObject({ ok: true, container: "current" });
      const currentSubject = harness.lensExpressionSubject();
      expect(currentSubject !== PENDING && currentSubject?.evaluated.value).toBe("current");
    } finally { harness.dispose(); }
  });

  test("a changed source does not display the prior source while its answer prepares", async () => {
    const harness = focusedReaderHarness();
    try {
      harness.valueScope(); await settleFocusedRead();
      expect(harness.valueScope()).toMatchObject({ ok: true, container: "LENEF" });
      const pending = harness.holdEvaluation();
      harness.changeExpression("changed"); flush();
      expect(harness.valueScope()).toBeUndefined();
      expect(harness.lensExpressionSubject()).toBeUndefined();
      pending.resolve({ result: "changed" }); await settleFocusedRead();
      expect(harness.valueScope()).toMatchObject({ ok: true, container: "changed" });
    } finally { harness.dispose(); }
  });

  for (const retirement of ["source", "session", "disposal"] as const) test(`a ${retirement} retirement refuses an in-flight focused answer`, async () => {
    const pending = deferred<{ result: unknown }>();
    const harness = focusedReaderHarness(pending.promise);
    try {
      harness.valueScope(); await settleFocusedRead();
      if (retirement === "source") harness.changeOrigin();
      else if (retirement === "session") harness.changeEpoch();
      else harness.close();
      pending.resolve({ result: "retired" }); await settleFocusedRead();
      if (retirement === "session") {
        // Since 6ec4223b a worker the current session no longer admits reads as
        // retired: the lens keeps preparing until the next worker publishes.
        expect(harness.valueScope()).toBe(PENDING);
        expect(harness.lensExpressionSubject()).toBe(PENDING);
      } else {
        expect(harness.valueScope()).toMatchObject({ ok: false });
        expect(harness.lensExpressionSubject()).toBeUndefined();
      }
    } finally { harness.dispose(); }
  });
});
