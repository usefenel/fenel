// L4 first paint: the actual Local holder and endpoint client, the actual
// presence leaf and the actual generated packet. Only the worker (ordinary
// operations and its storage read) and the browser IndexedDB are controlled;
// Fenel bodies decide every worker answer.
import { describe, expect, test } from "bun:test";
import { captureRegistryTransportObservation } from "../../../../../implementations/typescript/engine/src/registry-transport";
import { loadFenelModule } from "../../../../../implementations/typescript/engine/src/fenel-module";
import { evaluate, type EvaluateContext } from "../../../../../implementations/typescript/engine/src/json-logic";
import { stdNatives, stdNativesCtx } from "../../../../../fenel/modules/std/ffi/std-ffi";
import { Anything, List } from "@fenel/engine/type-foundation";
import { Just, Nothing } from "@fenel/engine/maybe-value";
import * as browserDataStorage from "./browser-data-storage";
import { beginBrowserDataStorageCommit, browserDataPresence, type BrowserDataRecord, type BrowserDataStorage } from "./browser-data-storage";
import * as localBootstrap from "./local-bootstrap";
import generatedPacket from "./generated/local-bootstrap.json";
import { runLocalOrdinaryOperation, type LocalOrdinaryOperation } from "./local-ordinary-operations";
import type { LocalTabData, LocalTabSource } from "./local-locus-data";
import type { LocusSynchronization } from "./locus-synchronization";
import type { ApiClient } from "./api";

const solid = await import(new URL("./dist/solid.js", import.meta.resolve("solid-js/package.json")).href) as typeof import("solid-js");
const functions = new Map<string, NonNullable<ReturnType<typeof loadFenelModule>["functions"]>[number]>();
for (const [path, name] of [["view/types.fenel", "view"], ["view/local-data.fenel", "view"], ["view/dependencies.fenel", "view"],
  ["std/appendItem.fenel", "std"], ["std/not.fenel", "std"], ["std/native/collection-native.fenel", "std"]]) {
  const module = loadFenelModule(await Bun.file(new URL(`../../../../../fenel/modules/${path}`, import.meta.url)).text(), name!,
    { bootstrapParser: "typescript" });
  for (const fn of module.functions ?? []) {
    functions.set(fn.id, fn); functions.set(fn.id.replace(":", "."), fn);
    functions.set(fn.id.slice(fn.id.indexOf(":") + 1), fn);
  }
}
// GLOBAL_ONLY: literal test data and the existing pure source policies only.
const context: EvaluateContext = { getFunction: name => functions.get(name),
  natives: Object.assign(Object.create(null), stdNatives), nativesCtx: Object.assign(Object.create(null), stdNativesCtx),
  _constructors: { Ok: ["_0"], Err: ["_0"], Just: ["_0"], Nothing: [] } };
function call<T = any>(name: string, ...args: unknown[]): T {
  return evaluate({ call: [`view:${name}`, ...args.map((_, index) => ({ var: `arg${index}` }))] },
    Object.fromEntries(args.map((arg, index) => [`arg${index}`, arg])), context) as T;
}
function accepted<T>(value: { $tag: string; _0: T | string }): T {
  if (value.$tag !== "Ok") throw new Error(String(value._0));
  return value._0 as T;
}
function gate() {
  let resolve!: () => void;
  const promise = new Promise<void>(yes => { resolve = yes; });
  return { promise, resolve };
}
async function tick() { for (let i = 0; i < 30; i++) await Promise.resolve(); solid.flush(); }
/** Settles within a few macrotasks, or reports that it is still pending. */
async function settledSoon<T>(promise: Promise<T>): Promise<{ value: T } | "pending"> {
  const timer = new Promise<"pending">(done => setTimeout(() => done("pending"), 50));
  return Promise.race([promise.then(value => ({ value })), timer]);
}
const transpiler = new Bun.Transpiler({ loader: "ts" });
function compiled(text: string) {
  return transpiler.transformSync(text).replace(/^import .*;\r?\n/gm, "")
    .replace(/^export\s*\{[^}]*\};?\r?\n/gm, "").replace(/^export /gm, "")
    .replace(/\bimport\(("[^"]+")\)/g, "load($1)");
}
// FENEL_FIRST_PAINT_HOLDER_SOURCE selects another holder file (fail-first runs).
const holderPath = process.env.FENEL_FIRST_PAINT_HOLDER_SOURCE ?? new URL("./local-locus-data.ts", import.meta.url);
const holderText = await Bun.file(holderPath).text();
console.log("Local holder source", String(holderPath), new Bun.CryptoHasher("sha256").update(holderText).digest("hex"));
const holderCode = compiled(holderText.slice(holderText.indexOf("let tabKeeper:")));
const sessionCode = compiled(await Bun.file(new URL("./browser-session.ts", import.meta.url)).text());
const syncText = await Bun.file(new URL("./locus-synchronization.tsx", import.meta.url)).text();
const syncCode = compiled(syncText.slice(syncText.indexOf("let retained:")));
const sourceId = "fenel-browser-local";

// ---- a minimal IndexedDB: one database, one store, records by key ----------
type FakeDatabase = { version: number; stores: Map<string, Map<string, unknown>> };
function fakeIndexedDB(initial?: { record?: unknown; stores?: string[] }) {
  const databases = new Map<string, FakeDatabase>();
  if (initial) {
    const stores = new Map((initial.stores ?? ["sources"]).map(name => [name, new Map<string, unknown>()]));
    if (initial.record !== undefined) stores.get("sources")!.set("local", initial.record);
    databases.set("fenel.local-data", { version: 1, stores });
  }
  const log: string[] = [];
  const later = (run: () => void) => setTimeout(run, 0);
  const factory = {
    open(name: string, version?: number) {
      log.push(`open ${name} ${version}`);
      const request: Record<string, any> = {};
      later(() => {
        const existing = databases.get(name);
        const target = version ?? existing?.version ?? 1;
        if (existing && existing.version > target) { request.error = new DOMException("version", "VersionError"); request.onerror?.(); return; }
        const created: FakeDatabase = existing ?? { version: 0, stores: new Map() };
        const connection = {
          objectStoreNames: { contains: (store: string) => created.stores.has(store) },
          createObjectStore: (store: string) => { log.push(`create ${store}`); created.stores.set(store, new Map()); },
          transaction(store: string, mode: string) {
            log.push(`transaction ${store} ${mode}`);
            const records = created.stores.get(store);
            if (!records) throw new DOMException("store", "NotFoundError");
            return { objectStore: () => ({
              count(key: string) { const count: Record<string, any> = {}; later(() => { count.result = records.has(key) ? 1 : 0; count.onsuccess?.(); }); return count; },
              get(key: string) { log.push(`get ${key}`); const read: Record<string, any> = {}; later(() => { read.result = records.get(key); read.onsuccess?.(); }); return read; },
            }) };
          },
          close: () => { log.push("close"); },
        };
        if (created.version < target) {
          let aborted = false;
          request.result = connection;
          request.transaction = { abort: () => { aborted = true; log.push("abort upgrade"); } };
          request.onupgradeneeded?.();
          if (aborted) { request.error = new DOMException("aborted", "AbortError"); request.onerror?.(); return; }
          created.version = target; databases.set(name, created);
        }
        request.result = connection;
        request.onsuccess?.();
      });
      return request;
    },
  };
  return { factory: factory as unknown as IDBFactory, log, databases };
}

type Fixture = ReturnType<typeof fixture>;
function fixture(options: { indexedDB?: IDBFactory } = {}) {
  const session = new Function("createSignal", "flush", `${sessionCode}; return {
    sessionEpoch, assertCurrentSession, onBrowserSessionChange, expireBrowserSession };`)(solid.createSignal, solid.flush) as
    Pick<typeof import("./browser-session"), "sessionEpoch" | "assertCurrentSession" | "onBrowserSessionChange" | "expireBrowserSession">;
  const sync = new Function("createSignal", "untrack", "assertCurrentSession", "sessionEpoch",
    `${syncCode}; return locusSynchronizationForSession;`)(solid.createSignal, solid.untrack, session.assertCurrentSession, session.sessionEpoch) as
    (epoch?: number) => LocusSynchronization;
  // The worker: its storage read and ordinary operations wait for `release`.
  let raw: BrowserDataRecord | undefined;
  let worker = gate();
  let loadFailure: Error | undefined;
  const operations: string[] = [];
  const storageLoads: number[] = [];
  const attempts: Array<number | undefined> = [];
  const storage: BrowserDataStorage = {
    async load(signal) {
      storageLoads.push(storageLoads.length);
      await worker.promise;
      // A real worker reply is a later task: a looping reader cannot starve timers.
      await new Promise(done => setTimeout(done, 0)); signal?.throwIfAborted();
      if (loadFailure) throw loadFailure;
      const checked = accepted<any>(call("browserDataStoredState", sourceId, raw ? Just(raw) : Nothing));
      return checked.$tag === "Nothing" ? undefined : { ...raw!, data: checked._0 };
    },
    async commit(data, generation, signal) {
      attempts.push(generation); signal?.throwIfAborted();
      const record = accepted<BrowserDataRecord>(call("browserDataStoragePlan", sourceId,
        raw ? Just(raw) : Nothing, generation === undefined ? Nothing : Just(generation), data));
      raw = structuredClone(record);
      return record;
    },
  };
  const model = { workspaceCall: call, allDataRootDescriptions: () => [] } as any;
  const bindings = {
    captureRegistryTransportObservation, runLocalOrdinaryOperation,
    retryEarlyAuthoringRealm: () => undefined,
    createAuthoringWorkerBrowserStorage: () => storage,
    prepareAuthoringLocalOperation: async (_transport: unknown, operation: LocalOrdinaryOperation, guard: { assertCurrent(): void }) => {
      guard.assertCurrent();
      await worker.promise;
      operations.push(operation.kind);
      // One structured message, as the worker reply preserves request sharing.
      const value = runLocalOrdinaryOperation(model, operation);
      guard.assertCurrent();
      return { kind: "prepared", value, assertCurrent: guard.assertCurrent, release: () => {} };
    },
    beginBrowserDataStorageCommit,
    ...session, createSignal: solid.createSignal, untrack: solid.untrack,
    LOCAL_BROWSER_SOURCE_ID: sourceId, createBrowserDataStorage: () => storage, locusSynchronizationForSession: sync,
    bindCoreAuthoringOwner: () => {}, inheritCoreAuthoringOwner: () => {},
    spawnEarlyAuthoringRealm: () => {}, discardEarlyAuthoringRealm: () => {},
    planLocalDefinitionBundle: () => { throw new Error("Unexpected definition plan"); },
    prepareLocalReaderSnapshot: async () => ({ kind: "local", worker: {}, owner: {}, registry: {}, callableLabels: [],
      session: { catalog: { functions: [] }, evaluateContext: {} }, functions: [], types: [], functionRows: [], catalog: [] }),
    load: async (name: string) => {
      if (name === "./local-bootstrap") return { ...localBootstrap,
        emptyLocalFirstPaint: (id: string) => localBootstrap.emptyLocalFirstPaint(id, { indexedDB: options.indexedDB }) };
      if (name === "./workspace-model-loader") return { loadWorkspaceModel: async () => model };
      if (name === "@fenel/engine") return { invokeCallable: (ref: { $ref: string }, args: unknown[]) => call(ref.$ref.slice(5), ...args) };
      if (name === "@fenel/engine/type-foundation") return { List, Anything, Ref: ($ref: string) => ({ $ref }) };
      if (name === "./reader-source-metadata") return { readerSourceMetadataPacket: () => { throw new Error("Unexpected metadata"); } };
      if (name.endsWith("authoring-catalog-worker")) return { discardPreparedReaderWorker: () => {}, discardWarmAuthoringRealm: () => {},
        borrowLocalOrdinaryTransport: () => ({ transport: {}, assertCurrent: () => {} }),
        beginPreparedReaderWorkerReplacement: () => () => {}, preparedReaderWorkerClosed: () => false };
      throw new Error(`Unexpected import ${name}`);
    },
  };
  const holder = new Function(...Object.keys(bindings), `${holderCode}; return { localTabDataSource, createLocalApiClient, keeper: () => tabKeeper };`)
    (...Object.values(bindings)) as { localTabDataSource(): LocalTabSource; createLocalApiClient(source: LocalTabSource): ApiClient;
      keeper(): { state?: LocalTabData; storage?: { record?: BrowserDataRecord; lastSynced: LocalTabData } } };
  return {
    source: holder.localTabDataSource, client: holder.createLocalApiClient, keeper: holder.keeper,
    synchronization: () => sync(), operations, storageLoads, attempts, record: () => raw,
    /** A stored record the worker will read (written by another tab). */
    store(data: LocalTabData) {
      raw = accepted<BrowserDataRecord>(call("browserDataStoragePlan", sourceId, raw ? Just(raw) : Nothing,
        raw ? Just(raw.generation) : Nothing, data));
    },
    release() { worker.resolve(); },
    failLoad(error?: Error) { loadFailure = error; },
    /** Let the waiting worker requests through; later ones wait again. */
    releaseAndHold() { const current = worker; worker = gate(); current.resolve(); },
    hold() { worker = gate(); },
    advance() { session.expireBrowserSession(solid.untrack(session.sessionEpoch)); solid.flush(); },
    close() { worker.resolve(); session.expireBrowserSession(solid.untrack(session.sessionEpoch)); solid.flush(); },
  };
}

const noteItem = (id: string, caption: string) => ({ id, caption, representations: {},
  source: { kind: "expr", expr: { kind: "literal", value: caption } } });
const packet = () => localBootstrap.readLocalBootstrap(generatedPacket, sourceId);
async function firstRoot(f: Fixture, client: ApiClient) {
  const read = await settledSoon(client.getLocusRoot());
  if (read === "pending") throw new Error("The first Local root waited for the worker.");
  return read.value.root;
}

describe("browser data presence (read-only IndexedDB probe)", () => {
  test("an absent database is empty and is not created", async () => {
    const idb = fakeIndexedDB();
    expect(await browserDataPresence({ indexedDB: idb.factory })).toBe("empty");
    expect(idb.databases.size).toBe(0);
    expect(idb.log).toEqual(["open fenel.local-data 1", "abort upgrade"]);
  });
  test("a store without the Local key is empty; a stored record is present; nothing is read or written", async () => {
    const empty = fakeIndexedDB({});
    expect(await browserDataPresence({ indexedDB: empty.factory })).toBe("empty");
    const stored = fakeIndexedDB({ record: { schema: "fenel.local-data.v1", generation: 1, data: {} } });
    expect(await browserDataPresence({ indexedDB: stored.factory })).toBe("present");
    for (const log of [empty.log, stored.log]) expect(log).toEqual(["open fenel.local-data 1", "transaction sources readonly", "close"]);
  });
  test("the probe reads exactly the storage's own database, version, store and key", async () => {
    const location = browserDataStorage.BROWSER_DATA_STORAGE;
    expect(location).toEqual({ database: "fenel.local-data", version: 1, store: "sources", key: "local" });
    expect(Object.isFrozen(location)).toBe(true);
    const stored = fakeIndexedDB({ record: { generation: 1 } });
    expect(await browserDataPresence({ indexedDB: stored.factory })).toBe("present");
    expect(stored.log.slice(0, 2)).toEqual([`open ${location.database} ${location.version}`, `transaction ${location.store} readonly`]);
    const storage = await Bun.file(new URL("./browser-data-storage.ts", import.meta.url)).text();
    for (const literal of ['"fenel.local-data"', '"sources"', '"local"']) expect(storage.split(literal).length - 1).toBe(1);
  });
  test("any doubt is unknown: no factory, a missing store, a newer version, a throwing open", async () => {
    expect(globalThis.indexedDB).toBeUndefined();
    expect(await browserDataPresence()).toBe("unknown");
    expect(await browserDataPresence({ indexedDB: fakeIndexedDB({ stores: [] }).factory })).toBe("unknown");
    const newer = fakeIndexedDB({}); newer.databases.get("fenel.local-data")!.version = 2;
    expect(await browserDataPresence({ indexedDB: newer.factory })).toBe("unknown");
    expect(await browserDataPresence({ indexedDB: { open() { throw new Error("denied"); } } as unknown as IDBFactory })).toBe("unknown");
  });
});

describe("Local first paint from the build-time packet", () => {
  test("empty storage paints root, Local and an editable New before any worker reply", async () => {
    const idb = fakeIndexedDB();
    const f = fixture({ indexedDB: idb.factory });
    try {
      const source = f.source(); const client = f.client(source);
      const root = await firstRoot(f, client);
      // The worker never answered: no ordinary operation ran, its storage read started once.
      expect(f.operations).toEqual([]); expect(f.storageLoads).toEqual([0]);
      expect(root).toEqual(packet().root);
      expect({ name: root.name, canEdit: root.canEdit, persisted: root.persisted, items: root.items.map(item => item.caption) })
        .toEqual({ name: "Local", canEdit: true, persisted: false, items: ["Clipboard"] });
      const saved = await settledSoon(client.getSavedQueries());
      expect(saved === "pending" ? saved : (saved.value as any).queries.map((row: any) => row.name)).toEqual(["Clipboard"]);
      // Display-only: no state, no keeper data, nothing to save.
      expect(source.state()).toBeUndefined(); expect(f.keeper().state).toBeUndefined();
      expect(f.synchronization().pending()).toBe(0); expect(await f.synchronization().saveAll()).toBe(true);
      expect(f.attempts).toEqual([]); expect(idb.databases.size).toBe(0);
      expect(await settledSoon(source.readReady())).toBe("pending");
    } finally { f.close(); }
  });

  test("stored data publishes no packet: reads wait for the worker as before", async () => {
    const idb = fakeIndexedDB({ record: { schema: "fenel.local-data.v1", generation: 1, data: {} } });
    const f = fixture({ indexedDB: idb.factory });
    try {
      f.store(call("tabDataWithClipboard", call("defaultLocalTabData", sourceId)));
      const source = f.source(); const client = f.client(source);
      const reading = client.getLocusRoot();
      expect(await settledSoon(reading)).toBe("pending");
      expect(() => source.root()).toThrow("not ready");
      f.release();
      const { root } = await reading;
      expect(f.operations[0]).toBe("validateTabData");
      expect(root).toBe(source.root());
      expect(root.typeDescriptions).toEqual([]);
    } finally { f.close(); }
  });

  test("the worker's answer replaces the packet; edits wait for the worker's baseline", async () => {
    const f = fixture({ indexedDB: fakeIndexedDB().factory });
    try {
      const source = f.source(); const client = f.client(source);
      const provisional = await firstRoot(f, client);
      expect(source.root()).toBe(provisional);
      // An edit submitted on the first paint is not admitted before the worker.
      const command = call("tabDataRootCommand", { kind: "append", item: noteItem("mine", "Mine") });
      const edit = source.transact([command]);
      expect(await settledSoon(edit)).toBe("pending");
      expect(f.operations).toEqual([]); expect(source.state()).toBeUndefined();
      f.release();
      const edited = await edit;
      // The worker's admission ran in full, then the edit on its state.
      expect(f.operations.slice(0, 4)).toEqual(["defaultLocalTabData", "tabDataCheckRoot", "tabDataWithClipboard", "publication"]);
      expect(f.operations).toContain("applyTabDataCommands");
      expect(edited.revision).toBe(1); expect(edited.items.map(item => item.caption)).toEqual(["Clipboard", "Mine"]);
      expect(source.root()).toBe(edited); expect(source.root()).not.toBe(provisional);
      expect(source.state().revision).toBe(1);
      // One identity per value: the keeper and baseline pair stay the worker's.
      const published = (await client.getLocusRoot()).root;
      expect(published).toBe(source.root());
      expect(f.keeper().state?.revision).toBe(1);
      // The edit saved once, from the worker's baseline (absent record), and
      // the clean keeper keeps its exact ordinary baseline pairing.
      expect(f.attempts).toEqual([undefined]); expect(f.record()?.data.revision).toBe(1);
      expect(f.keeper().state).toBe(f.keeper().storage?.lastSynced);
      expect(f.synchronization().pending()).toBe(0);
    } finally { f.close(); }
  });

  test("a worker answer that differs from the packet wins", async () => {
    const f = fixture({ indexedDB: fakeIndexedDB().factory });
    try {
      const source = f.source(); const client = f.client(source);
      const provisional = await firstRoot(f, client);
      expect(provisional.items.map(item => item.id)).toEqual([`${sourceId}:clipboard`]);
      expect(provisional.typeDescriptions?.length).toBeGreaterThan(0);
      // Another tab stored data after the presence probe.
      const other = accepted<LocalTabData>(call("applyTabDataCommands", call("tabDataWithClipboard", call("defaultLocalTabData", sourceId)), 0,
        [call("tabDataRootCommand", { kind: "append", item: noteItem("other", "Other tab") })]));
      f.store(other);
      let observed = 0;
      const dispose = solid.createRoot(dispose => {
        solid.createEffect(() => { source.revision(); return source.state(); }, () => { observed++; });
        return dispose;
      });
      await tick(); const before = observed;
      f.release();
      await source.readReady(); await tick();
      expect(observed).toBeGreaterThan(before);
      const winner = (await client.getLocusRoot()).root;
      expect(winner).toBe(source.root()); expect(winner).not.toBe(provisional);
      expect(winner.items.map(item => item.caption)).toEqual(["Clipboard", "Other tab"]); expect(winner.revision).toBe(1);
      expect(winner.typeDescriptions).toEqual([]);
      expect(f.keeper().state).toBe(f.keeper().storage?.lastSynced);
      expect(f.synchronization().pending()).toBe(0);
      dispose();
    } finally { f.close(); }
  });

  test("a failed first worker read withdraws the packet and reports the failure", async () => {
    const f = fixture({ indexedDB: fakeIndexedDB().factory });
    try {
      const source = f.source(); const client = f.client(source);
      await firstRoot(f, client);
      f.failLoad(new Error("controlled worker failure")); f.release();
      await expect(source.readReady()).rejects.toThrow("controlled worker failure");
      await tick();
      expect(() => source.root()).toThrow("not ready");
      await expect(client.getLocusRoot()).rejects.toThrow("controlled worker failure");
    } finally { f.close(); }
  });

  test("a withdrawn packet is never served again, and failures do not loop the worker", async () => {
    const f = fixture({ indexedDB: fakeIndexedDB().factory });
    const owner = solid.createRoot(dispose => {
      const source = f.source(); const client = f.client(source);
      // As Home's root read: a reactive consumer of the Local endpoint.
      const root = solid.createMemo(() => client.getLocusRoot().then(
        data => ({ root: data.root as typeof data.root | undefined, error: undefined as string | undefined }),
        error => ({ root: undefined, error: error instanceof Error ? error.message : String(error) })),
      { loadingValue: { root: undefined, error: undefined } });
      const saved = solid.createMemo(() => client.getSavedQueries().then(data => (data as any).queries.length as number, () => -1),
        { loadingValue: undefined as number | undefined });
      return { source, root, saved, dispose };
    });
    try {
      for (let i = 0; i < 10 && !owner.root().root; i++) await new Promise(done => setTimeout(done, 10));
      expect(owner.root().root?.canEdit).toBe(true); expect(owner.saved()).toBe(1);
      expect(f.storageLoads).toHaveLength(1);
      // The first worker read fails; any later read attempt waits.
      f.failLoad(new Error("controlled worker failure")); f.releaseAndHold();
      for (let i = 0; i < 20; i++) { await new Promise(done => setTimeout(done, 5)); solid.flush(); }
      expect(owner.root()).toEqual({ root: undefined, error: "controlled worker failure" });
      expect(owner.saved()).toBe(-1);
      expect(() => owner.source.root()).toThrow("not ready");
      expect(() => owner.source.savedValues()).toThrow("not ready");
      expect(f.storageLoads.length).toBeLessThanOrEqual(2);
      // Further failures never re-trigger the consumers by themselves.
      f.release();
      for (let i = 0; i < 20; i++) { await new Promise(done => setTimeout(done, 5)); solid.flush(); }
      expect(f.storageLoads.length).toBeLessThanOrEqual(2);
      expect(owner.root().error).toBe("controlled worker failure");
      // A later successful worker read publishes the worker's own data.
      f.failLoad(undefined);
      await owner.source.readReady(); await tick();
      for (let i = 0; i < 10 && !owner.root().root; i++) await new Promise(done => setTimeout(done, 10));
      expect(owner.root().root).toBe(owner.source.root());
      expect(owner.root().root?.typeDescriptions).toEqual([]);
    } finally { owner.dispose(); f.close(); }
  });

  test("a later epoch with retained data offers no packet", async () => {
    const f = fixture({ indexedDB: fakeIndexedDB().factory });
    try {
      f.release();
      const first = f.source(); await first.readReady();
      f.advance(); f.hold();
      const next = f.source(); const client = f.client(next);
      expect(await settledSoon(client.getLocusRoot())).toBe("pending");
    } finally { f.close(); }
  });
});
