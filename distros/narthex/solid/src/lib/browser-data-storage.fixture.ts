// Actual browser storage boundary; only its selected pure model loader is
// supplied by the smoke build. All admission/CAS decisions execute Fenel.
import { browserDataPresence, createBrowserDataStorage, LOCAL_BROWSER_SOURCE_ID, type BrowserDataRecord } from "./browser-data-storage";
import { loadWorkspaceModel } from "./workspace-model-loader";
import type { BrowserReaderSnapshot, LocalTabData, LocalTabSource } from "./local-locus-data";
import type { LocusSynchronization } from "./locus-synchronization";
import type { ModuleRegistry } from "@fenel/engine/registry";
import type { EvaluateContext } from "@fenel/engine/expressions";

declare const FENEL_STORAGE_SOURCE_INTEGRATION: boolean;

async function initial(payload?: unknown): Promise<LocalTabData> {
  const model = await loadWorkspaceModel({ projected: true });
  const state = model.workspaceCall<LocalTabData>("defaultTabData", LOCAL_BROWSER_SOURCE_ID, { kind: "grid" });
  if (payload !== undefined) state.values = [{ id: "fixture-value", value: { id: "fixture-value", slug: "fixture-value",
    query: { kind: "expression", expr: { kind: "literal", value: payload } } } }];
  return state;
}

async function raw(databaseName: string, replacement?: { value: unknown }): Promise<unknown> {
  const database = await new Promise<IDBDatabase>((resolve, reject) => {
    const open = indexedDB.open(databaseName, 1);
    open.onupgradeneeded = () => open.result.createObjectStore("sources");
    open.onsuccess = () => resolve(open.result);
    open.onerror = () => reject(open.error);
  });
  try {
    return await new Promise((resolve, reject) => {
      const transaction = database.transaction("sources", replacement ? "readwrite" : "readonly");
      const request = replacement ? transaction.objectStore("sources").put(replacement.value, "local")
        : transaction.objectStore("sources").get("local");
      transaction.oncomplete = () => resolve(replacement ? replacement.value : request.result);
      transaction.onabort = () => reject(transaction.error);
    });
  } finally { database.close(); }
}

const storage = (databaseName: string) => createBrowserDataStorage({ databaseName });

Object.assign(globalThis, { browserDataStorageFixture: {
  initial, raw,
  // L4 first paint: the page's read-only presence probe on native IndexedDB.
  presence: (databaseName: string) => browserDataPresence({ databaseName }),
  async databases() {
    return (await indexedDB.databases()).map(entry => ({ name: entry.name, version: entry.version }));
  },
  load: (databaseName: string) => storage(databaseName).load(),
  commit: (databaseName: string, next: LocalTabData, expectedGeneration?: number) =>
    storage(databaseName).commit(next, expectedGeneration),
  async abortCommit(databaseName: string, expectedGeneration: number) {
    const controller = new AbortController();
    const put = IDBObjectStore.prototype.put;
    let entered = false;
    IDBObjectStore.prototype.put = function (this: IDBObjectStore, ...args: Parameters<IDBObjectStore["put"]>) {
      const request = put.apply(this, args);
      entered = true;
      controller.abort(new DOMException("Fixture cancellation", "AbortError"));
      return request;
    };
    try {
      await storage(databaseName).commit(await initial("aborted replacement"), expectedGeneration, controller.signal);
      return { entered, refused: false };
    } catch (error) {
      return { entered, refused: true, name: (error as Error).name };
    } finally { IDBObjectStore.prototype.put = put; }
  },
  async preAborted(databaseName: string) {
    const controller = new AbortController(); controller.abort();
    const host = storage(databaseName);
    const state = await initial();
    const results = await Promise.allSettled([host.load(controller.signal), host.commit(state, undefined, controller.signal)]);
    return results.map(result => result.status);
  },
  async lossless(databaseName: string) {
    const payload = { negativeZero: -0, notANumber: NaN, positiveInfinity: Infinity,
      negativeInfinity: -Infinity, binary: new Uint8Array([0, 1, 127, 255]) };
    const saved = await storage(databaseName).commit(await initial(payload), undefined);
    const loaded = await storage(databaseName).load();
    const value = (loaded?.data.values[0].value.query.expr as { value: typeof payload }).value;
    return { generation: saved.generation, negativeZero: Object.is(value.negativeZero, -0),
      notANumber: Number.isNaN(value.notANumber), positiveInfinity: value.positiveInfinity === Infinity,
      negativeInfinity: value.negativeInfinity === -Infinity, binary: value.binary instanceof Uint8Array,
      bytes: [...value.binary] };
  },
  async cloneFailure(databaseName: string, expectedGeneration: number) {
    try {
      await storage(databaseName).commit(await initial({ uncloneable: () => 1 }), expectedGeneration);
      return false;
    } catch { return true; }
  },
  async projectedOnly(databaseName: string) {
    const next = await initial("ordinary authored value");
    next.rootProjection = { authority: "should not persist" } as unknown as NonNullable<LocalTabData["rootProjection"]>;
    next.expressionValueIds = ["reader-only"];
    next.expressionHeads = { placeAll: "reader-only" };
    const saved: BrowserDataRecord = await storage(databaseName).commit(next, undefined);
    const loaded = await raw(databaseName) as BrowserDataRecord;
    return { saved: Object.keys(saved.data).sort(), loaded: Object.keys(loaded.data).sort() };
  },
} });

// Optional integration mode reuses the real holder/coordinator/IndexedDB leaf.
// Its selected registry is real; only worker/catalog acquisition is bypassed.
if (FENEL_STORAGE_SOURCE_INTEGRATION) {
  let source: LocalTabSource | undefined;
  let synchronization: LocusSynchronization | undefined;
  let releaseRoot: (() => void) | undefined;
  let databaseName: string | undefined;
  let preparations = 0;
  const active = () => {
    if (!source || !synchronization || !databaseName) throw new Error("Open the integration source first.");
    return { source, synchronization, databaseName };
  };
  const close = () => { source?.dispose(); source = undefined; synchronization = undefined; releaseRoot?.(); releaseRoot = undefined; };
  async function inspect() {
    const current = active();
    const { flush } = await import("solid-js"); flush();
    const saved = await storage(current.databaseName).load();
    const clipboard = (state: LocalTabData) => current.source.project<Array<{ value: { id: string } }>>(
      "tabClipboardEntries", state).map(entry => entry.value.id);
    return { revision: current.source.revision(), layout: current.source.state().layout.kind,
      clipboard: clipboard(current.source.state()), pending: current.synchronization.pending(),
      enabled: current.synchronization.enabledNow(), error: current.synchronization.error(), preparations,
      saved: saved ? { generation: saved.generation, layout: saved.data.layout.kind, clipboard: clipboard(saved.data) } : undefined };
  }
  Object.assign(globalThis, { browserDataSourceIntegrationFixture: {
    async open(nextDatabaseName: string) {
      close(); preparations = 0; databaseName = nextDatabaseName;
      const [{ createBrowserDataSource }, { createLocusSynchronization }, { createRoot, untrack },
        { sessionEpoch }, { createAuthoringEnvironment }, model] = await Promise.all([
        import("./local-locus-data"), import("./locus-synchronization"), import("solid-js"),
        import("./browser-session"), import("@fenel/engine/authoring/environment"),
        loadWorkspaceModel({ projected: true }),
      ]);
      const selected = model as typeof model & { registry: ModuleRegistry; evaluateContext: EvaluateContext };
      const catalog = { types: [], functions: [], capabilities: [], catalogTypes: [], operatorCodeNameByNotation: new Map<string, string>() };
      const environment = createAuthoringEnvironment(catalog, { moduleMembers: selected.registry });
      const snapshot: BrowserReaderSnapshot = { registry: selected.registry, session: {
        mode: "module", sourceModule: "view", registry: selected.registry, catalog, environment,
        evaluateContext: selected.evaluateContext,
      }, functions: [], types: [], functionRows: [], catalog: [],
        readPresentations: async () => [], readMetadata: async () => ({ entries: [] }) };
      createRoot(dispose => {
        releaseRoot = dispose;
        const epoch = untrack(sessionEpoch);
        synchronization = createLocusSynchronization(epoch);
        source = createBrowserDataSource({ id: LOCAL_BROWSER_SOURCE_ID, epoch, clipboard: true,
          storage: storage(nextDatabaseName), synchronization,
          prepareSnapshot: async (_definitions, _representations, signal) => {
            signal.throwIfAborted(); preparations++; return snapshot;
          }, retireSnapshot: () => {},
        });
      });
      await active().source.ready();
      return inspect();
    },
    inspect, close,
    async layout(kind: "grid" | "list" | "tree" | "tabs", expectedRevision?: number) {
      await active().source.transact([{ $tag: "TabSetLayout", layout: { kind } }], expectedRevision);
      return inspect();
    },
    async retainClipboard(id: string) {
      await active().source.retainClipboard({ id, value: id, typeName: "String", transfer: "encoded", bytes: 100,
        copiedAt: 1, source: "native-source-integration" });
      return inspect();
    },
    enabled: (next: boolean) => active().synchronization.setEnabled(next),
    async save() { const accepted = await active().synchronization.saveAll(); return { accepted, state: await inspect() }; },
    async discard() { const accepted = await active().synchronization.discardAll(); return { accepted, state: await inspect() }; },
  } });
}
