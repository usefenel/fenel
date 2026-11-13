import { describe, expect, test } from "bun:test";
import type { TransferSnapshot } from "./types";
import { internalFromClipboardHtml, transferClipboardHtml } from "./clipboard";
import { LOCAL_BROWSER_SOURCE_ID } from "../browser-data-storage";

const source = await Bun.file(new URL("./queue.ts", import.meta.url)).text();
const code = new Bun.Transpiler({ loader: "ts" }).transformSync(source)
  .replace(/^import .* from [^\n]+;\s*$/gm, "").replace(/^export /gm, "");
type QueueRevisionSignal = (initial: number, options?: { ownedWrite?: boolean }) => readonly [() => number, (next: (previous: number) => number) => void];
const plainRevisionSignal: QueueRevisionSignal = initial => {
  let value = initial;
  return [() => value, next => { value = next(value); }];
};
function harness(initialAccount?: string, signalFactory: QueueRevisionSignal = plainRevisionSignal) {
  let epoch = 7;
  let account = initialAccount;
  let changed = () => {};
  const module = new Function("sessionEpoch", "onBrowserSessionChange", "browserAccountScope", "LOCAL_BROWSER_SOURCE_ID", "internalFromClipboardHtml", "createSignal", `${code}; return {
    queueWorkspaceTransfer, takeWorkspaceTransfers, discardWorkspaceTransfers, hasWorkspaceTransfers, workspaceTransferOwner,
    peekWorkspaceTransfers, claimWorkspaceTransfer, acknowledgeWorkspaceTransfer, releaseWorkspaceTransfer, localTransfersPending };`)(
    () => epoch, (listener: () => void) => { changed = listener; },
    () => account, LOCAL_BROWSER_SOURCE_ID, internalFromClipboardHtml,
    signalFactory,
  ) as typeof import("./queue");
  const stageSession = (nextAccount: string | undefined) => { account = nextAccount; changed(); };
  const publishSession = () => { epoch++; };
  return { ...module, stageSession, publishSession,
    epoch: () => epoch,
    nextSession: (nextAccount?: string) => { stageSession(nextAccount); publishSession(); } };
}
const snapshot = (text: string): TransferSnapshot => ({ text, files: [], html: "", internal: "", uriList: "" });
const homeSource = (await Bun.file(new URL("../../routes/app/home.tsx", import.meta.url)).text()).replace(/\r\n/g, "\n");
const ownerBinding = homeSource.match(/const transferOwner = [\s\S]*?;\n/)?.[0];
const acceptStart = homeSource.indexOf("let acceptedShellAction = false;");
const acceptEnd = homeSource.indexOf("onSettled(() => {", acceptStart);
if (!ownerBinding || acceptStart < 0 || acceptEnd < 0) throw new Error("Home shell handoff boundary changed");
const handoffCode = new Bun.Transpiler({ loader: "ts" }).transformSync(ownerBinding + homeSource.slice(acceptStart, acceptEnd));

const preparedStart = homeSource.indexOf("let importChain = Promise.resolve();");
const preparedEnd = homeSource.indexOf("  const valueRevisions", preparedStart);
const valueImportStart = homeSource.indexOf("  function importIntoValueScope(");
const valueImportEnd = homeSource.indexOf("  type MenuTarget", valueImportStart);
if ([preparedStart, preparedEnd, valueImportStart, valueImportEnd].some(index => index < 0)) throw new Error("Prepared Home import boundary changed");
const preparedImportCode = new Bun.Transpiler({ loader: "ts" }).transformSync(
  homeSource.slice(preparedStart, preparedEnd) + homeSource.slice(valueImportStart, valueImportEnd));

function importGate<T = void>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>(yes => { resolve = yes; });
  return { promise, resolve };
}

/** Production prepared-import consumers; only decoding/checking/persistence IO
 * and presentation callbacks are held. Queue ownership remains the real code. */
function preparedImports(h: ReturnType<typeof harness>, options: { value?: boolean; root?: boolean; empty?: boolean } = {}) {
  const owner = h.workspaceTransferOwner(undefined, "pane", h.epoch(), LOCAL_BROWSER_SOURCE_ID)!;
  let here = options.value ? { kind: "value", viewId: "nested", itemId: "list-data", path: [] as string[] }
    : options.root ? { kind: "root" } : { kind: "view", viewId: "nested" };
  const analyzeEntered = importGate(), releaseAnalyze = importGate();
  const flushEntered = importGate(), releaseFlush = importGate<boolean>();
  const writeEntered = importGate(), releaseWrite = importGate();
  const rootEntered = importGate(), releaseRoot = importGate();
  const analyzed: string[] = [], claims: object[] = [], updates: object[] = [], failures: string[] = [], notices: unknown[] = [];
  const cleanup: Array<() => void> = [];
  const roots: Array<{ onPublished?: () => void }> = [];
  let completed = 0, view = { kind: "list", items: [] as object[] };
  const rootRow = { id: LOCAL_BROWSER_SOURCE_ID, view: { kind: "list", items: [] } };
  const bindings = {
    reader: { kind: "local" }, client: { rootId: LOCAL_BROWSER_SOURCE_ID }, transferOwner: owner,
    sessionEpoch: h.epoch, assertCurrentSession: (epoch: number) => { if (epoch !== h.epoch()) throw new Error("Session changed"); },
    scope: () => here, scopeKey: (scope: unknown) => JSON.stringify(scope),
    root: () => rootRow,
    current: () => options.root ? rootRow : { id: "nested", view },
    rowById: (id: string) => id === rootRow.id ? rootRow : id === "nested" ? { id, view } : undefined,
    queueWorkspaceTransfer: h.queueWorkspaceTransfer,
    claimWorkspaceTransfer: (...args: Parameters<typeof h.claimWorkspaceTransfer>) => { claims.push(args[0]); return h.claimWorkspaceTransfer(...args); },
    acknowledgeWorkspaceTransfer: h.acknowledgeWorkspaceTransfer, releaseWorkspaceTransfer: h.releaseWorkspaceTransfer,
    onCleanup: (callback: () => void) => cleanup.push(callback),
    setImporting: () => {}, setTransferComplete: () => {}, setTransferSequence: () => {},
    ingestTransfer: async (captured: TransferSnapshot, options: { signal?: AbortSignal }) => {
      options.signal?.throwIfAborted(); return [{ value: captured.text, source: "text" }];
    },
    transferSession: () => ({ registry: {}, evaluateContext: {} }),
    analyzeWorkspaceTransfer: async (items: Array<{ value: string }>) => {
      analyzed.push(items[0]!.value); analyzeEntered.resolve(); await releaseAnalyze.promise;
      return options.empty ? [] : [{ expr: { kind: "literal", value: items[0]!.value }, type: { $ref: "String" } }];
    },
    transferCaptions: () => [undefined], genId: () => "pasted-occurrence", clamp01: (value: number) => value,
    viewPersistence: { read: () => view, update: (_id: string, value: typeof view) => { updates.push(value); view = value; },
      flush: async () => { flushEntered.resolve(); return releaseFlush.promise; } },
    asView: (value: unknown) => value, isoDate: () => "2026-10-16", appendTreeChild: () => { throw new Error("Unexpected tree branch"); },
    changeRoot: async (_command: unknown, _revision: unknown, _source: unknown, publication?: { onPublished?: () => void }) => {
      roots.push(publication ?? {}); rootEntered.resolve(); await releaseRoot.promise;
    },
    valueScope: () => ({ ok: true, sourceExpression: { kind: "literal", value: [] }, scopeIdentity: JSON.stringify(here) }),
    appendExpressionAt: (source: object, path: string[], expression: object) => ({ source, path, expression }),
    expressionEditOptions: () => ({}), writeValueScopeExpression: async () => { writeEntered.resolve(); await releaseWrite.promise; },
    acknowledgeRootRevision: () => {}, revalidate: () => {}, refresh: async () => {}, all: () => ({}),
    setImportNotice: (notice: unknown) => notices.push(notice), completeImport: () => { completed++; },
    setToolbarError: (failure: string) => failures.push(failure), afterImport: undefined,
  };
  const imports = new Function(...Object.keys(bindings), `${preparedImportCode}; return {
    view: importIntoView, value: importIntoValueScope, settled: () => importChain };`)(...Object.values(bindings)) as {
    view(snapshot: TransferSnapshot, viewId?: string, hint?: object, ticket?: object): void;
    value(snapshot: TransferSnapshot, ticket?: object): void;
    settled(): Promise<void>;
  };
  return { ...imports, owner, analyzeEntered, releaseAnalyze, flushEntered, releaseFlush, writeEntered, releaseWrite,
    rootEntered, releaseRoot, analyzed, claims, updates, failures, notices, roots,
    completed: () => completed, close: () => cleanup.forEach(callback => callback()),
    scope: () => here, changeScope: (next: typeof here) => { here = next; } };
}

function acceptPrepared(h: ReturnType<typeof harness>, prepared: ReturnType<typeof preparedImports>) {
  const bindings = {
    props: { pane: { id: "pane" } }, client: { rootId: LOCAL_BROWSER_SOURCE_ID, epoch: h.epoch() },
    untrack: (read: () => unknown) => read(), sessionEpoch: h.epoch, workspaceTransferOwner: h.workspaceTransferOwner,
    reader: { kind: "local" }, scope: prepared.scope, root: () => ({ id: LOCAL_BROWSER_SOURCE_ID }),
    savedAll: () => ({ failed: false }), initialPin: undefined, initialAction: undefined,
    peekWorkspaceTransfers: h.peekWorkspaceTransfers, takeWorkspaceTransfers: h.takeWorkspaceTransfers,
    importIntoView: prepared.view, importIntoValueScope: prepared.value,
    createEffect: (read: () => unknown, apply: (value: unknown) => void) => apply(read()),
  };
  new Function(...Object.keys(bindings), handoffCode)(...Object.values(bindings));
}

/** Run HomePage's actual acceptance effect without the unrelated typed UI. */
function acceptInHome(h: ReturnType<typeof harness>, publicReader: boolean, accountId?: string) {
  const imported: string[] = [];
  const bindings = {
    props: { publicData: publicReader ? {} : undefined, pane: { id: "pane" } },
    client: { accountId, epoch: 7 }, untrack: (read: () => unknown) => read(), sessionEpoch: () => 7,
    workspaceTransferOwner: h.workspaceTransferOwner, takeWorkspaceTransfers: h.takeWorkspaceTransfers,
    peekWorkspaceTransfers: h.peekWorkspaceTransfers, reader: undefined, scope: () => ({ kind: "root" }),
    root: () => ({ id: accountId ?? "public" }), savedAll: () => ({ failed: false }), initialPin: undefined, initialAction: undefined,
    importIntoView: (value: TransferSnapshot) => imported.push(value.text),
    createEffect: (read: () => unknown, apply: (value: unknown) => void) => apply(read()),
  };
  new Function(...Object.keys(bindings), handoffCode)(...Object.values(bindings));
  return imported;
}

describe("pending clipboard handoff ownership", () => {
  const resume = { resumeInitialLocalRoot: true };
  const initial = { initialLocalRoot: true };

  test("Local pending observation survives ownership changes and includes post-cookie captures", () => {
    const h = harness();
    const old = h.workspaceTransferOwner(undefined, "before", 7, LOCAL_BROWSER_SOURCE_ID);
    expect(h.localTransfersPending()).toBe(false);
    const ticket = h.queueWorkspaceTransfer(snapshot("initial"), undefined, undefined, old, initial)!;
    expect(h.localTransfersPending()).toBe(true);
    h.claimWorkspaceTransfer(ticket, old);
    h.nextSession("A");
    h.discardWorkspaceTransfers(old);
    expect(h.localTransfersPending()).toBe(true);
    const fresh = h.workspaceTransferOwner(undefined, "new-pane", 8, LOCAL_BROWSER_SOURCE_ID);
    h.claimWorkspaceTransfer(ticket, fresh, resume);
    h.releaseWorkspaceTransfer(ticket, fresh);
    expect(h.localTransfersPending()).toBe(true);
    h.claimWorkspaceTransfer(ticket, fresh);
    h.acknowledgeWorkspaceTransfer(ticket, fresh);
    expect(h.localTransfersPending()).toBe(false);
    h.queueWorkspaceTransfer(snapshot("after-cookie"), undefined, undefined, fresh, initial);
    expect(h.localTransfersPending()).toBe(true);
    h.nextSession("B");
    expect(h.localTransfersPending()).toBe(false);
  });

  test("pending Local observation includes nested scopes and excludes private, draft and legacy destinations", () => {
    const h = harness();
    const local = h.workspaceTransferOwner(undefined, "pane", 7, LOCAL_BROWSER_SOURCE_ID);
    h.queueWorkspaceTransfer(snapshot("private"), undefined, undefined, h.workspaceTransferOwner("A", "pane"));
    h.queueWorkspaceTransfer(snapshot("draft"), undefined, undefined, h.workspaceTransferOwner(undefined, "pane", 7, "account-staging"));
    h.queueWorkspaceTransfer(snapshot("legacy"));
    expect(h.localTransfersPending()).toBe(false);
    h.queueWorkspaceTransfer(snapshot("nested"), "a-list", undefined, local);
    expect(h.localTransfersPending()).toBe(true);
    h.discardWorkspaceTransfers(local);
    expect(h.localTransfersPending()).toBe(false);
    // The existing full checker can own an internal Local-root transfer too;
    // this scheduling observation neither validates nor migrates that data.
    h.queueWorkspaceTransfer({ ...snapshot("internal-root"), internal: "copied-data" }, undefined, undefined, local);
    expect(h.localTransfersPending()).toBe(true);
    h.discardWorkspaceTransfers(local);
    expect(h.localTransfersPending()).toBe(false);
  });

  test("post-cookie nested Local receipts hold adoption until acknowledgement or cancellation and never migrate", () => {
    const h = harness("A");
    const local = h.workspaceTransferOwner(undefined, "nested", 7, LOCAL_BROWSER_SOURCE_ID);
    const first = h.queueWorkspaceTransfer(snapshot("nested after cookie"), "local-list", undefined, local, initial)!;
    expect(h.localTransfersPending()).toBe(true);
    h.claimWorkspaceTransfer(first, local);
    expect(h.localTransfersPending()).toBe(true);
    h.releaseWorkspaceTransfer(first, local);
    expect(h.localTransfersPending()).toBe(true);
    h.claimWorkspaceTransfer(first, local);
    h.acknowledgeWorkspaceTransfer(first, local);
    expect(h.localTransfersPending()).toBe(false);
    h.queueWorkspaceTransfer(snapshot("cancel nested"), "local-list", undefined, local, initial);
    h.discardWorkspaceTransfers(local);
    expect(h.localTransfersPending()).toBe(false);
    h.queueWorkspaceTransfer(snapshot("obsolete nested"), "local-list", undefined, local, initial);
    h.nextSession("B");
    expect(h.localTransfersPending()).toBe(false);
    const next = h.workspaceTransferOwner(undefined, "next", 8, LOCAL_BROWSER_SOURCE_ID);
    expect(h.peekWorkspaceTransfers(next, resume)).toEqual([]);
    h.queueWorkspaceTransfer(snapshot("nested before logout"), "local-list", undefined, next);
    expect(h.localTransfersPending()).toBe(true);
    h.nextSession();
    expect(h.localTransfersPending()).toBe(false);
  });

  test("the existing queue notifies the real Solid2 graph without a false ownership-gap observation", async () => {
    const solid = await import(new URL("../../../node_modules/solid-js/dist/solid.dev.js", import.meta.url).href) as typeof import("solid-js");
    const observed: boolean[] = [];
    let dispose = () => {};
    let h!: ReturnType<typeof harness>;
    solid.createRoot(end => {
      dispose = end;
      h = harness(undefined, solid.createSignal);
      solid.createEffect(h.localTransfersPending, value => { observed.push(value); });
    });
    try {
      solid.flush();
      expect(observed).toEqual([false]);
      const old = h.workspaceTransferOwner(undefined, "old", 7, LOCAL_BROWSER_SOURCE_ID);
      const ticket = h.queueWorkspaceTransfer(snapshot("initial"), undefined, undefined, old, initial)!;
      expect(h.localTransfersPending()).toBe(true);
      solid.flush();
      expect(observed).toEqual([false, true]);
      h.claimWorkspaceTransfer(ticket, old);
      h.nextSession("A");
      h.discardWorkspaceTransfers(old);
      solid.flush();
      expect(observed.slice(1).every(value => value)).toBe(true);
      const fresh = h.workspaceTransferOwner(undefined, "fresh", 8, LOCAL_BROWSER_SOURCE_ID);
      h.claimWorkspaceTransfer(ticket, fresh, resume);
      h.releaseWorkspaceTransfer(ticket, fresh);
      solid.flush();
      expect(observed.slice(1).every(value => value)).toBe(true);
      h.claimWorkspaceTransfer(ticket, fresh);
      h.acknowledgeWorkspaceTransfer(ticket, fresh);
      solid.flush();
      expect(observed.at(-1)).toBe(false);
      expect(observed.slice(1, -1).every(value => value)).toBe(true);
      h.queueWorkspaceTransfer(snapshot("after-cookie"), undefined, undefined, fresh);
      solid.flush();
      expect(observed.at(-1)).toBe(true);
      h.takeWorkspaceTransfers(fresh);
      solid.flush();
      expect(observed.at(-1)).toBe(false);
      h.queueWorkspaceTransfer(snapshot("discard"), undefined, undefined, fresh);
      solid.flush();
      h.discardWorkspaceTransfers(fresh);
      solid.flush();
      expect(observed.at(-1)).toBe(false);
      h.queueWorkspaceTransfer(snapshot("logout"), undefined, undefined, fresh);
      solid.flush();
      h.nextSession();
      solid.flush();
      expect(observed.at(-1)).toBe(false);
      const nested = h.workspaceTransferOwner(undefined, "nested", 9, LOCAL_BROWSER_SOURCE_ID);
      const nestedTicket = h.queueWorkspaceTransfer(snapshot("nested after cookie"), "local-list", undefined, nested)!;
      solid.flush();
      expect(observed.at(-1)).toBe(true);
      h.claimWorkspaceTransfer(nestedTicket, nested);
      solid.flush();
      expect(observed.at(-1)).toBe(true);
      h.acknowledgeWorkspaceTransfer(nestedTicket, nested);
      solid.flush();
      expect(observed.at(-1)).toBe(false);
      h.queueWorkspaceTransfer(snapshot("cancel nested"), "local-list", undefined, nested);
      solid.flush();
      h.discardWorkspaceTransfers(nested);
      solid.flush();
      expect(observed.at(-1)).toBe(false);
    } finally { dispose(); }
  });

  test("a claimed capture stays queued until publication and cannot be taken twice", () => {
    const h = harness();
    const owner = h.workspaceTransferOwner(undefined, "pane", 7, LOCAL_BROWSER_SOURCE_ID);
    const ticket = h.queueWorkspaceTransfer(snapshot("image"), undefined, undefined, owner, initial)!;
    expect(h.peekWorkspaceTransfers(owner)[0]?.ticket).toBe(ticket);
    expect(h.claimWorkspaceTransfer(ticket, owner)?.snapshot.text).toBe("image");
    expect(h.claimWorkspaceTransfer(ticket, owner)).toBeUndefined();
    expect(h.takeWorkspaceTransfers(owner)).toEqual([]);
    expect(h.hasWorkspaceTransfers(owner)).toBe(true);
    expect(h.acknowledgeWorkspaceTransfer(ticket, owner)).toBe(true);
    expect(h.acknowledgeWorkspaceTransfer(ticket, owner)).toBe(false);
    expect(h.takeWorkspaceTransfers(owner)).toEqual([]);
  });

  test("a slow fallback blocks later captures until the head is published or handed to the editor", () => {
    const h = harness();
    const owner = h.workspaceTransferOwner(undefined, "pane", 7, LOCAL_BROWSER_SOURCE_ID);
    const first = h.queueWorkspaceTransfer(snapshot("complex"), undefined, undefined, owner)!;
    const second = h.queueWorkspaceTransfer(snapshot("image"), undefined, undefined, owner)!;
    expect(h.claimWorkspaceTransfer(second, owner)).toBeUndefined();
    expect(h.claimWorkspaceTransfer(first, owner)?.ticket).toBe(first);
    expect(h.peekWorkspaceTransfers(owner)).toEqual([]);
    expect(h.claimWorkspaceTransfer(second, owner)).toBeUndefined();
    expect(h.takeWorkspaceTransfers(owner)).toEqual([]);
    expect(h.releaseWorkspaceTransfer(first, owner)).toBe(true);
    expect(h.claimWorkspaceTransfer(second, owner)).toBeUndefined();
    expect(h.takeWorkspaceTransfers(owner).map(entry => entry.snapshot.text)).toEqual(["complex", "image"]);
    expect(h.claimWorkspaceTransfer(first, owner)).toBeUndefined();
  });

  test("initial anonymous resolutions and the first account retain only raw external Local root captures", () => {
    const h = harness();
    const local = h.workspaceTransferOwner(undefined, "before", 7, LOCAL_BROWSER_SOURCE_ID);
    const account = h.workspaceTransferOwner("private-account", "before");
    const draft = h.workspaceTransferOwner(undefined, "before", 7, "account-staging");
    const ticket = h.queueWorkspaceTransfer(snapshot("external"), undefined, undefined, local, initial)!;
    h.queueWorkspaceTransfer(snapshot("private"), undefined, undefined, account, initial);
    h.queueWorkspaceTransfer(snapshot("draft"), undefined, undefined, draft, initial);
    h.queueWorkspaceTransfer(snapshot("nested-local"), "a-list", undefined, local, initial);
    h.queueWorkspaceTransfer({ ...snapshot("internal"), internal: "private-data" }, undefined, undefined, local, initial);
    h.queueWorkspaceTransfer({ ...snapshot("reference"), savedExprId: "private-id" }, undefined, undefined, local, initial);
    h.queueWorkspaceTransfer({ ...snapshot("html-copy"), html: transferClipboardHtml("private-data", "private") }, undefined, undefined, local, initial);
    h.queueWorkspaceTransfer(snapshot("legacy"));
    h.nextSession();
    const anonymous = h.workspaceTransferOwner(undefined, "anonymous", 8, LOCAL_BROWSER_SOURCE_ID);
    expect(h.peekWorkspaceTransfers(anonymous, resume).map(entry => entry.ticket)).toEqual([ticket]);
    expect(h.takeWorkspaceTransfers(account)).toEqual([]);
    expect(h.takeWorkspaceTransfers(draft)).toEqual([]);
    expect(h.takeWorkspaceTransfers()).toEqual([]);
    h.nextSession();
    h.nextSession("signed-in");
    const fresh = h.workspaceTransferOwner(undefined, "after", 10, LOCAL_BROWSER_SOURCE_ID);
    expect(h.peekWorkspaceTransfers(fresh, resume).map(entry => entry.snapshot.text)).toEqual(["external"]);
    expect(h.claimWorkspaceTransfer(ticket, fresh, resume)?.ticket).toBe(ticket);
    expect(h.acknowledgeWorkspaceTransfer(ticket, fresh)).toBe(true);
  });

  test("migrated root captures need explicit fresh-root adoption, then retain strict pane ownership", () => {
    const h = harness();
    const old = h.workspaceTransferOwner(undefined, "pane", 7, LOCAL_BROWSER_SOURCE_ID);
    const ticket = h.queueWorkspaceTransfer(snapshot("external"), undefined, undefined, old, initial)!;
    h.claimWorkspaceTransfer(ticket, old);
    h.nextSession("A");
    const samePane = h.workspaceTransferOwner(undefined, "pane", 8, LOCAL_BROWSER_SOURCE_ID);
    const sibling = h.workspaceTransferOwner(undefined, "sibling", 8, LOCAL_BROWSER_SOURCE_ID);
    const wrongSource = h.workspaceTransferOwner(undefined, "pane", 8, "account-staging");
    const privateReader = h.workspaceTransferOwner("A", "pane", 8);
    h.discardWorkspaceTransfers(old);
    h.discardWorkspaceTransfers(samePane);
    expect(h.takeWorkspaceTransfers(samePane)).toEqual([]);
    expect(h.peekWorkspaceTransfers(sibling)).toEqual([]);
    expect(h.peekWorkspaceTransfers(wrongSource, resume)).toEqual([]);
    expect(h.peekWorkspaceTransfers(privateReader, resume)).toEqual([]);
    expect(h.acknowledgeWorkspaceTransfer(ticket, old)).toBe(false);
    expect(h.releaseWorkspaceTransfer(ticket, old)).toBe(false);
    expect(h.claimWorkspaceTransfer(ticket, sibling)).toBeUndefined();
    expect(h.claimWorkspaceTransfer(ticket, samePane, resume)?.ticket).toBe(ticket);
    expect(h.releaseWorkspaceTransfer(ticket, samePane)).toBe(true);
    expect(h.claimWorkspaceTransfer(ticket, sibling, resume)).toBeUndefined();
    expect(h.takeWorkspaceTransfers(samePane).map(entry => entry.snapshot.text)).toEqual(["external"]);
  });

  test("staged epoch invalidation rejects old same-task acknowledgements before the signal is published", () => {
    const h = harness();
    const old = h.workspaceTransferOwner(undefined, "pane", 7, LOCAL_BROWSER_SOURCE_ID);
    const ticket = h.queueWorkspaceTransfer(snapshot("external"), undefined, undefined, old, initial)!;
    h.claimWorkspaceTransfer(ticket, old);
    h.stageSession("A");
    expect(h.acknowledgeWorkspaceTransfer(ticket, old)).toBe(false);
    expect(h.releaseWorkspaceTransfer(ticket, old)).toBe(false);
    expect(h.queueWorkspaceTransfer(snapshot("late"), undefined, undefined, old, initial)).toBeUndefined();
    h.discardWorkspaceTransfers(old);
    h.publishSession();
    const fresh = h.workspaceTransferOwner(undefined, "new", 8, LOCAL_BROWSER_SOURCE_ID);
    expect(h.claimWorkspaceTransfer(ticket, fresh, resume)?.snapshot.text).toBe("external");
    expect(h.acknowledgeWorkspaceTransfer(ticket, fresh)).toBe(true);
  });

  test("publication acknowledged before the initial session resolves is never retried", () => {
    const h = harness();
    const old = h.workspaceTransferOwner(undefined, "pane", 7, LOCAL_BROWSER_SOURCE_ID);
    const ticket = h.queueWorkspaceTransfer(snapshot("published"), undefined, undefined, old, initial)!;
    h.claimWorkspaceTransfer(ticket, old);
    expect(h.acknowledgeWorkspaceTransfer(ticket, old)).toBe(true);
    h.nextSession("A");
    const fresh = h.workspaceTransferOwner(undefined, "new", 8, LOCAL_BROWSER_SOURCE_ID);
    expect(h.peekWorkspaceTransfers(fresh, resume)).toEqual([]);
  });

  test("logout and account switches drop initial continuations and later Local captures", () => {
    for (const nextAccount of [undefined, "B", "A"]) {
      const h = harness();
      const old = h.workspaceTransferOwner(undefined, "before", 7, LOCAL_BROWSER_SOURCE_ID);
      h.queueWorkspaceTransfer(snapshot("initial"), undefined, undefined, old, initial);
      h.nextSession("A");
      const current = h.workspaceTransferOwner(undefined, "after", 8, LOCAL_BROWSER_SOURCE_ID);
      h.queueWorkspaceTransfer(snapshot("later"), undefined, undefined, current, initial);
      h.nextSession(nextAccount);
      const fresh = h.workspaceTransferOwner(undefined, "new", 9, LOCAL_BROWSER_SOURCE_ID);
      expect(h.peekWorkspaceTransfers(fresh, resume)).toEqual([]);
    }
    const h = harness("A");
    const current = h.workspaceTransferOwner(undefined, "pane", 7, LOCAL_BROWSER_SOURCE_ID);
    h.queueWorkspaceTransfer(snapshot("already-signed-in"), undefined, undefined, current, initial);
    h.nextSession();
    expect(h.peekWorkspaceTransfers(h.workspaceTransferOwner(undefined, "new", 8, LOCAL_BROWSER_SOURCE_ID), resume)).toEqual([]);
  });

  test("capture retains the event's file list, point and source ownership", () => {
    const h = harness();
    const owner = h.workspaceTransferOwner(undefined, "pane", 7, LOCAL_BROWSER_SOURCE_ID);
    const file = new File(["pixels"], "image.png", { type: "image/png" });
    const captured = { ...snapshot("original"), files: [file] };
    const point = { x: 0.2, y: 0.3 };
    h.queueWorkspaceTransfer(captured, undefined, point, owner, initial);
    captured.text = "changed";
    captured.files.length = 0;
    point.x = 0.9;
    const queued = h.peekWorkspaceTransfers(owner)[0]!;
    expect(queued.snapshot.text).toBe("original");
    expect(queued.snapshot.files).toEqual([file]);
    expect(queued.point).toEqual({ x: 0.2, y: 0.3 });
  });

  test("a faster sibling and the legacy surface cannot consume another reader's pending data", () => {
    const h = harness();
    const a = h.workspaceTransferOwner("A", "pane");
    const b = h.workspaceTransferOwner("B", "pane");
    const aSibling = h.workspaceTransferOwner("A", "sibling");
    h.queueWorkspaceTransfer(snapshot("private-A"), undefined, undefined, a);
    h.queueWorkspaceTransfer(snapshot("private-B"), undefined, undefined, b);
    h.queueWorkspaceTransfer(snapshot("same-account-sibling"), "destination", undefined, aSibling);
    h.queueWorkspaceTransfer(snapshot("legacy"));
    expect(h.takeWorkspaceTransfers(b).map(entry => entry.snapshot.text)).toEqual(["private-B"]);
    expect(h.takeWorkspaceTransfers().map(entry => entry.snapshot.text)).toEqual(["legacy"]);
    expect(h.takeWorkspaceTransfers(aSibling).map(entry => entry.snapshot.text)).toEqual(["same-account-sibling"]);
    expect(h.takeWorkspaceTransfers(a).map(entry => entry.snapshot.text)).toEqual(["private-A"]);
  });

  test("cancel and pane teardown discard only that pane's handoff", () => {
    const h = harness();
    const a = h.workspaceTransferOwner("A", "one");
    const sibling = h.workspaceTransferOwner("A", "two");
    h.queueWorkspaceTransfer(snapshot("abandoned"), "root-A", { x: 0.2, y: 0.3 }, a);
    h.queueWorkspaceTransfer(snapshot("retained"), "root-A", undefined, sibling);
    h.discardWorkspaceTransfers(a);
    expect(h.hasWorkspaceTransfers(a)).toBe(false);
    expect(h.hasWorkspaceTransfers(sibling)).toBe(true);
    expect(h.takeWorkspaceTransfers(sibling)[0]?.snapshot.text).toBe("retained");
  });

  test("session changes discard old handoffs and late stale enqueue is refused", () => {
    const h = harness();
    const old = h.workspaceTransferOwner("A", "pane");
    h.queueWorkspaceTransfer(snapshot("old"), undefined, undefined, old);
    h.nextSession();
    h.queueWorkspaceTransfer(snapshot("late"), undefined, undefined, old);
    expect(h.takeWorkspaceTransfers(old)).toEqual([]);
    const next = h.workspaceTransferOwner("A", "pane");
    h.queueWorkspaceTransfer(snapshot("new"), undefined, undefined, next);
    expect(h.takeWorkspaceTransfers(old)).toEqual([]);
    expect(h.takeWorkspaceTransfers(next)[0]?.snapshot.text).toBe("new");
  });

  test("captured ownership is immutable at enqueue and a pane cannot omit its reader", () => {
    const h = harness();
    const original = { accountId: "A", paneId: "one", epoch: 7 };
    h.queueWorkspaceTransfer(snapshot("A"), undefined, undefined, original);
    original.accountId = "B";
    expect(h.takeWorkspaceTransfers(original)).toEqual([]);
    expect(h.takeWorkspaceTransfers(h.workspaceTransferOwner("A", "one"))[0]?.snapshot.text).toBe("A");
    expect(() => h.workspaceTransferOwner(undefined, "pane")).toThrow("captured data reader");
  });

  test("a tab source owns its handoff without acquiring account identity", () => {
    const h = harness();
    const local = h.workspaceTransferOwner(undefined, "pane", 7, "tab-source");
    const other = h.workspaceTransferOwner(undefined, "pane", 7, "other-tab-source");
    const account = h.workspaceTransferOwner("tab-source", "pane", 7);
    expect(local?.accountId).toBeUndefined();
    expect(local?.sourceId).toBe("tab-source");
    h.queueWorkspaceTransfer(snapshot("local"), undefined, undefined, local);
    h.queueWorkspaceTransfer(snapshot("legacy"));
    expect(h.takeWorkspaceTransfers(other)).toEqual([]);
    expect(h.takeWorkspaceTransfers(account)).toEqual([]);
    expect(h.takeWorkspaceTransfers(local).map(entry => entry.snapshot.text)).toEqual(["local"]);
    expect(h.takeWorkspaceTransfers().map(entry => entry.snapshot.text)).toEqual(["legacy"]);
  });

  test("the actual public Home handoff consumes neither legacy nor private data", () => {
    const h = harness();
    const a = h.workspaceTransferOwner("A", "pane");
    h.queueWorkspaceTransfer(snapshot("private"), undefined, undefined, a);
    h.queueWorkspaceTransfer(snapshot("legacy"));
    expect(acceptInHome(h, true)).toEqual([]);
    expect(h.takeWorkspaceTransfers(a)[0]?.snapshot.text).toBe("private");
    expect(h.takeWorkspaceTransfers()[0]?.snapshot.text).toBe("legacy");
  });

  test("HomePage drains only the reader and pane that captured its pending transfer", () => {
    const h = harness();
    const a = h.workspaceTransferOwner("A", "pane");
    const b = h.workspaceTransferOwner("B", "pane");
    h.queueWorkspaceTransfer(snapshot("A"), undefined, undefined, a);
    h.queueWorkspaceTransfer(snapshot("B"), undefined, undefined, b);
    expect(acceptInHome(h, false, "B")).toEqual(["B"]);
    expect(h.takeWorkspaceTransfers(a)[0]?.snapshot.text).toBe("A");
  });
});

const entrySource = (await Bun.file(new URL("../home-entry.tsx", import.meta.url)).text()).replace(/\r\n/g, "\n");
const ingressStart = entrySource.indexOf("  const localRootTransfer = ");
const ingressEnd = entrySource.indexOf("  function acceptTransfer(", ingressStart);
const lifetimeStart = entrySource.indexOf("  let externalImport:");
const lifetimeEnd = entrySource.indexOf("  const [savingQuickValue,", lifetimeStart);
const cancelStart = entrySource.indexOf("  function cancelRequest(");
const cancelEnd = entrySource.indexOf("  /** Re-target", cancelStart);
if ([ingressStart, ingressEnd, lifetimeStart, lifetimeEnd, cancelStart, cancelEnd].some(offset => offset < 0)) throw new Error("HomeEntry external ingress boundary changed");
const ingressCode = new Bun.Transpiler({ loader: "ts" }).transformSync(
  entrySource.slice(lifetimeStart, lifetimeEnd) + entrySource.slice(ingressStart, ingressEnd) + entrySource.slice(cancelStart, cancelEnd));

/** Actual event receiver and drain, with only its browser IO held. The queue
 * and publication callbacks are real; no conversion or admission is simulated. */
function homeIngress(h: ReturnType<typeof harness>, pane = "pane", delayedAbort = false) {
  const transferOwner = h.workspaceTransferOwner(undefined, pane, h.epoch(), LOCAL_BROWSER_SOURCE_ID);
  const cleanup: Array<() => void> = [];
  const effects: Array<() => void> = [];
  const calls: Array<{ snapshot: TransferSnapshot; ingress: { signal: AbortSignal; onPublished: (receipt: { notes: string[] }) => void };
    resolve: (value: object | undefined) => void; reject: (error: Error) => void }> = [];
  let adding = false, error: string | undefined, requests = 0, refreshes = 0;
  let notes: readonly string[] = [];
  let request: { epoch: number; byUser: boolean; source: string; action?: unknown } | undefined;
  const feedback: unknown[] = [];
  const lifetime = new AbortController();
  const bindings = { ...h, transferOwner,
    untrack: (read: () => unknown) => read(),
    prepareOnDemand: () => true, displayFocus: () => ({ kind: "root" }), readProjection: () => undefined,
    currentReads: () => true, paneSourceKey: () => "local", destinationId: () => LOCAL_BROWSER_SOURCE_ID,
    sessionEpoch: h.epoch, onCleanup: (run: () => void) => cleanup.push(run),
    createEffect: (read: () => unknown, run: (state: unknown) => void) => effects.push(() => run(read())),
    client: { signal: lifetime.signal, ingestExternal: (snapshot: TransferSnapshot, ingress: { signal: AbortSignal; onPublished: (receipt: { notes: string[] }) => void }) =>
      new Promise<object | undefined>((resolve, reject) => {
        calls.push({ snapshot, ingress, resolve, reject });
        if (!delayedAbort) ingress.signal.addEventListener("abort", () => reject(new DOMException("Paste cancelled", "AbortError")), { once: true });
      }) },
    setExternalAdding: (next: boolean) => { adding = next; }, setClipboardError: (next?: string) => { error = next; },
    setTransferNotes: (next: readonly string[]) => { notes = next; },
    setTransferFeedback: (next: unknown) => feedback.push(next), transferSequence: 0,
    revalidate: () => { refreshes++; }, openWorkspace: () => { requests++; request = { epoch: h.epoch(), byUser: true, source: "transfer" }; },
    externalAdding: () => adding, rootShelf: undefined, props: { pane: { id: pane } }, setPickerOpen: () => {},
    request: () => request, setRequest: (next?: typeof request) => { request = next; },
  };
  const actual = new Function(...Object.keys(bindings), `${ingressCode}; return {receiveTransfer,drainExternalTransfers,cancelRequest};`)(...Object.values(bindings)) as {
    receiveTransfer: (snapshot: TransferSnapshot) => void; drainExternalTransfers: () => Promise<void>; cancelRequest: (source?: string) => void;
  };
  const update = () => effects.forEach(run => run());
  update();
  return { ...actual, calls, owner: transferOwner, update,
    state: () => ({ adding, error, notes, requests, refreshes, feedback: [...feedback], request }),
    sourceIntent: () => { request = { epoch: h.epoch(), byUser: true, source: "source" }; },
    dispose: () => { for (const run of cleanup) run(); lifetime.abort(); h.discardWorkspaceTransfers(transferOwner); },
    publish: (index: number, notes: string[] = []) => { const call = calls[index]!; call.ingress.signal.throwIfAborted(); call.ingress.onPublished({ notes }); call.resolve({ notes }); },
  };
}
const settleIngress = async () => { await Promise.resolve(); await Promise.resolve(); };

describe("HomeEntry retained Local ingress", () => {
  test("supported capture gives immediate feedback without an authoring request and acknowledges before sign-in", async () => {
    const h = harness();
    const home = homeIngress(h);
    home.receiveTransfer(snapshot("external"));
    expect(home.calls).toHaveLength(1);
    expect(home.state().adding).toBe(true);
    expect(home.state().feedback).toHaveLength(1);
    expect(home.state().requests).toBe(0);
    home.publish(0);
    h.nextSession("A");
    home.dispose();
    await settleIngress();
    const replacement = homeIngress(h, "new-pane");
    expect(replacement.calls).toEqual([]);
    expect(home.state().refreshes).toBe(1);
    expect(home.state().feedback).toHaveLength(2);
  });

  test("unsupported capture releases once to existing authoring fallback", async () => {
    const h = harness();
    const home = homeIngress(h);
    home.receiveTransfer(snapshot("complex"));
    home.calls[0]!.resolve(undefined);
    await settleIngress();
    expect(home.state().requests).toBe(1);
    expect(home.state().adding).toBe(false);
    expect(h.takeWorkspaceTransfers(home.owner).map(entry => entry.snapshot.text)).toEqual(["complex"]);
  });

  test("publication forwards source guidance and the next capture clears it", async () => {
    const h = harness();
    const home = homeIngress(h);
    home.receiveTransfer(snapshot("large JSON text"));
    home.publish(0, ["The exact text was preserved."]);
    await settleIngress();
    expect(home.state().notes).toEqual(["The exact text was preserved."]);
    expect(home.state().requests).toBe(0);
    home.receiveTransfer(snapshot("next paste"));
    expect(home.state().notes).toEqual([]);
    home.dispose();
    await settleIngress();
  });

  test("a general-checker head is not retried or overtaken by a later fast capture", async () => {
    const h = harness();
    const home = homeIngress(h);
    home.receiveTransfer(snapshot("complex"));
    home.calls[0]!.resolve(undefined);
    await settleIngress();
    home.receiveTransfer(snapshot("later image"));
    home.update();
    await settleIngress();
    expect(home.calls.map(call => call.snapshot.text)).toEqual(["complex"]);
    expect(home.state().requests).toBe(1);
    expect(h.takeWorkspaceTransfers(home.owner).map(entry => entry.snapshot.text)).toEqual(["complex", "later image"]);
  });

  test("failed capture keeps its receipt for Retry and pane cancellation removes it", async () => {
    const h = harness();
    const home = homeIngress(h);
    home.receiveTransfer(snapshot("retry"));
    home.calls[0]!.reject(new Error("Could not decode this image"));
    await settleIngress();
    expect(home.state().error).toBe("Could not decode this image");
    expect(h.hasWorkspaceTransfers(home.owner)).toBe(true);
    const retry = home.drainExternalTransfers();
    expect(home.calls).toHaveLength(2);
    home.dispose();
    await retry;
    expect(h.hasWorkspaceTransfers(home.owner)).toBe(false);
    expect(home.state().requests).toBe(0);
  });

  test("initial sign-in before publication retries the raw capture with the fresh Local reader", async () => {
    const h = harness();
    const home = homeIngress(h);
    home.receiveTransfer(snapshot("captured before cookie response"));
    h.nextSession("A");
    home.dispose();
    await settleIngress();
    const replacement = homeIngress(h, "new-pane");
    expect(replacement.calls.map(call => call.snapshot.text)).toEqual(["captured before cookie response"]);
    expect(home.calls[0]!.ingress.signal.aborted).toBe(true);
    replacement.publish(0);
    await settleIngress();
    expect(replacement.state().requests).toBe(0);
    expect(h.hasWorkspaceTransfers(replacement.owner)).toBe(false);
  });

  test("a new paste after cancellation starts when an old non-abortable import retires", async () => {
    const h = harness();
    const home = homeIngress(h, "pane", true);
    home.receiveTransfer(snapshot("cancelled"));
    home.cancelRequest("transfer");
    home.receiveTransfer(snapshot("new paste"));
    expect(home.calls).toHaveLength(1);
    home.calls[0]!.reject(new DOMException("Paste cancelled", "AbortError"));
    await settleIngress();
    expect(home.calls.map(call => call.snapshot.text)).toEqual(["cancelled", "new paste"]);
    home.publish(1);
    await settleIngress();
    expect(h.hasWorkspaceTransfers(home.owner)).toBe(false);
  });

  test("cancelling source inspection keeps a separate in-flight Local paste", async () => {
    const h = harness();
    const home = homeIngress(h);
    home.receiveTransfer(snapshot("keep paste"));
    home.sourceIntent();
    home.cancelRequest();
    expect(home.calls[0]!.ingress.signal.aborted).toBe(false);
    expect(h.hasWorkspaceTransfers(home.owner)).toBe(true);
    home.publish(0);
    await settleIngress();
    expect(h.hasWorkspaceTransfers(home.owner)).toBe(false);
  });

  test("the transfer notice Cancel preserves a separately armed source inspection", async () => {
    const h = harness();
    const home = homeIngress(h);
    home.receiveTransfer(snapshot("cancel paste only"));
    home.sourceIntent();
    home.cancelRequest("transfer");
    await settleIngress();
    expect(home.calls[0]!.ingress.signal.aborted).toBe(true);
    expect(h.hasWorkspaceTransfers(home.owner)).toBe(false);
    expect(home.state().request?.source).toBe("source");
  });
});

const documentPasteStart = entrySource.indexOf("  const pasteIntoEmptyView = ");
const documentPasteEnd = entrySource.indexOf("  document.addEventListener(\"paste\", pasteIntoEmptyView)", documentPasteStart);
if (documentPasteStart < 0 || documentPasteEnd < 0) throw new Error("HomeEntry document paste boundary changed");
const documentPasteCode = new Bun.Transpiler({ loader: "ts" }).transformSync(entrySource.slice(documentPasteStart, documentPasteEnd));

describe("HomeEntry visible document paste ownership", () => {
  function dispatch(showing: boolean, requested: boolean, shellConnected = !showing) {
    let shell = 0, prepared = 0;
    const bindings = {
      props: { pane: { active: () => true } }, showingWorkspace: () => showing, requested: () => requested,
      earlyShellElement: { isConnected: shellConnected },
      workspace: { ready: () => true }, document: { querySelector: () => undefined }, Element: class {},
      acceptTransfer: (event: { defaultPrevented: boolean }) => { event.defaultPrevented = true; shell++; },
    };
    const listener = new Function(...Object.keys(bindings), `${documentPasteCode}; return pasteIntoEmptyView;`)(...Object.values(bindings)) as (event: unknown) => void;
    const event = { target: undefined, clipboardData: {}, defaultPrevented: false };
    listener(event);
    if (showing && !shellConnected && !event.defaultPrevented) { event.defaultPrevented = true; prepared++; }
    return { shell, prepared };
  }

  test("visible prepared Home owns body paste after its New request was cancelled", () => {
    expect(dispatch(true, false)).toEqual({ shell: 0, prepared: 1 });
  });

  test("a still-visible shell owns body paste even when its requested tools are ready", () => {
    expect(dispatch(false, true)).toEqual({ shell: 1, prepared: 0 });
  });

  test("a retained shell remains the paste owner while the logical prepared target is pending", () => {
    expect(dispatch(true, false, true)).toEqual({ shell: 1, prepared: 0 });
  });
});

describe("prepared Local import receipt lifetime", () => {
  test("a direct nested list paste keeps its receipt through checking and successful persistence", async () => {
    const h = harness("A"), home = preparedImports(h);
    home.view(snapshot("nested paste"), "nested");
    expect(h.localTransfersPending()).toBe(true);
    await home.analyzeEntered.promise;
    expect(home.claims).toHaveLength(1);
    expect(h.localTransfersPending()).toBe(true);
    home.releaseAnalyze.resolve();
    await home.flushEntered.promise;
    expect(h.localTransfersPending()).toBe(true);
    expect(home.completed()).toBe(0);
    home.releaseFlush.resolve(true);
    await home.settled();
    expect(h.localTransfersPending()).toBe(false);
    expect(home.completed()).toBe(1);
    expect(home.failures).toEqual([]);
  });

  test("initial nested captures keep their exact existing ticket instead of being taken or queued twice", async () => {
    const h = harness("A"), home = preparedImports(h);
    const ticket = h.queueWorkspaceTransfer(snapshot("shell nested"), "nested", undefined, home.owner)!;
    acceptPrepared(h, home);
    await home.analyzeEntered.promise;
    expect(home.claims).toEqual([ticket]);
    expect(h.localTransfersPending()).toBe(true);
    home.releaseAnalyze.resolve();
    await home.flushEntered.promise;
    expect(h.localTransfersPending()).toBe(true);
    home.releaseFlush.resolve(true);
    await home.settled();
    expect(h.localTransfersPending()).toBe(false);
    expect(h.peekWorkspaceTransfers(home.owner)).toEqual([]);
    expect(home.completed()).toBe(1);
  });

  test("the general root path acknowledges at source publication before its persistence promise settles", async () => {
    const h = harness(), home = preparedImports(h, { root: true });
    home.view(snapshot("checked root"), LOCAL_BROWSER_SOURCE_ID);
    await home.analyzeEntered.promise;
    expect(h.localTransfersPending()).toBe(true);
    home.releaseAnalyze.resolve();
    await home.rootEntered.promise;
    expect(h.localTransfersPending()).toBe(true);
    expect(home.roots[0]?.onPublished).toBeFunction();
    home.roots[0]!.onPublished!();
    expect(h.localTransfersPending()).toBe(false);
    expect(home.completed()).toBe(0);
    h.nextSession("A");
    expect(h.peekWorkspaceTransfers(h.workspaceTransferOwner(undefined, "new", h.epoch(), LOCAL_BROWSER_SOURCE_ID),
      { resumeInitialLocalRoot: true })).toEqual([]);
    home.releaseRoot.resolve();
    await home.settled();
  });

  test("a zero-addition result retires the Local receipt without scheduling a write", async () => {
    for (const root of [false, true]) {
      const h = harness(), home = preparedImports(h, { root, empty: true });
      home.view(snapshot("nothing accepted"), root ? LOCAL_BROWSER_SOURCE_ID : "nested");
      await home.analyzeEntered.promise;
      expect(h.localTransfersPending()).toBe(true);
      home.releaseAnalyze.resolve();
      await home.settled();
      expect(h.localTransfersPending()).toBe(false);
      expect(home.updates).toEqual([]);
      expect(home.roots).toEqual([]);
      expect(home.completed()).toBe(1);
    }
  });

  test("a failed nested flush surfaces the failure and cancels its receipt without reporting success", async () => {
    const h = harness("A"), home = preparedImports(h);
    home.view(snapshot("not durably saved"), "nested");
    await home.analyzeEntered.promise;
    home.releaseAnalyze.resolve();
    await home.flushEntered.promise;
    expect(h.localTransfersPending()).toBe(true);
    home.releaseFlush.resolve(false);
    await home.settled();
    expect(h.localTransfersPending()).toBe(false);
    expect(home.completed()).toBe(0);
    expect(home.failures).toEqual(["The data is kept here, but saving failed. Retry from the notifications menu."]);
  });

  test("a direct value-scope paste keeps its strict receipt through the actual scoped write", async () => {
    const h = harness("A"), home = preparedImports(h, { value: true });
    home.value(snapshot("value child"));
    expect(h.localTransfersPending()).toBe(true);
    await home.analyzeEntered.promise;
    expect(home.claims).toHaveLength(1);
    home.releaseAnalyze.resolve();
    await home.writeEntered.promise;
    expect(h.localTransfersPending()).toBe(true);
    expect(home.completed()).toBe(0);
    home.releaseWrite.resolve();
    await home.settled();
    expect(h.localTransfersPending()).toBe(false);
    expect(home.completed()).toBe(1);
  });

  test("initial value-scope captures reach the scoped writer with their existing ticket", async () => {
    const h = harness("A"), home = preparedImports(h, { value: true });
    const ticket = h.queueWorkspaceTransfer(snapshot("value from shell"), "nested", undefined, home.owner)!;
    acceptPrepared(h, home);
    await home.analyzeEntered.promise;
    expect(home.claims).toEqual([ticket]);
    home.releaseAnalyze.resolve();
    await home.writeEntered.promise;
    expect(h.localTransfersPending()).toBe(true);
    expect(home.updates).toEqual([]);
    home.releaseWrite.resolve();
    await home.settled();
    expect(h.localTransfersPending()).toBe(false);
    expect(home.completed()).toBe(1);
  });

  test("saved-list and value-scope imports share one FIFO and leave no ownership gap", async () => {
    const h = harness("A"), home = preparedImports(h, { value: true });
    home.view(snapshot("first list"), "nested");
    home.value(snapshot("second value"));
    await home.analyzeEntered.promise;
    expect(home.analyzed).toEqual(["first list"]);
    home.releaseAnalyze.resolve();
    await home.flushEntered.promise;
    expect(home.analyzed).toEqual(["first list"]);
    expect(h.localTransfersPending()).toBe(true);
    home.releaseFlush.resolve(true);
    await home.writeEntered.promise;
    expect(home.analyzed).toEqual(["first list", "second value"]);
    expect(home.claims).toHaveLength(2);
    expect(h.localTransfersPending()).toBe(true);
    expect(home.completed()).toBe(1);
    home.releaseWrite.resolve();
    await home.settled();
    expect(h.localTransfersPending()).toBe(false);
    expect(home.completed()).toBe(2);
  });

  test("nested checking cannot write or migrate its receipt after a real session transition", async () => {
    for (const value of [false, true]) {
      const h = harness("A"), home = preparedImports(h, { value });
      if (value) home.value(snapshot("obsolete nested value"));
      else home.view(snapshot("obsolete nested list"), "nested");
      await home.analyzeEntered.promise;
      h.nextSession("B");
      home.releaseAnalyze.resolve();
      await home.settled();
      expect(home.updates).toEqual([]);
      expect(home.completed()).toBe(0);
      expect(h.localTransfersPending()).toBe(false);
      const fresh = h.workspaceTransferOwner(undefined, "replacement", h.epoch(), LOCAL_BROWSER_SOURCE_ID);
      expect(h.peekWorkspaceTransfers(fresh, { resumeInitialLocalRoot: true })).toEqual([]);
    }
  });

  test("disposing a prepared importer aborts checking and leaves nested ownership strict", async () => {
    for (const value of [false, true]) {
      const h = harness("A"), home = preparedImports(h, { value });
      if (value) home.value(snapshot("aborted value"));
      else home.view(snapshot("aborted list"), "nested");
      await home.analyzeEntered.promise;
      home.close();
      home.releaseAnalyze.resolve();
      await home.settled();
      expect(home.updates).toEqual([]);
      expect(home.completed()).toBe(0);
      const sibling = h.workspaceTransferOwner(undefined, "sibling", h.epoch(), LOCAL_BROWSER_SOURCE_ID);
      expect(h.peekWorkspaceTransfers(sibling, { resumeInitialLocalRoot: true })).toEqual([]);
      expect(h.peekWorkspaceTransfers(home.owner)).toHaveLength(1);
      h.nextSession("B");
      expect(h.localTransfersPending()).toBe(false);
    }
  });
});
