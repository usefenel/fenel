import { afterEach, describe, expect, test } from "bun:test";
import { loadFenelModule } from "../../../../../implementations/typescript/engine/src/fenel-module";
import { evaluate, type EvaluateContext } from "../../../../../implementations/typescript/engine/src/json-logic";
import { stdNatives, stdNativesCtx } from "../../../../../fenel/modules/std/ffi/std-ffi";
import { captureRegistryTransportObservation, captureRegistryTransportRoundTrip, registryTransportSnapshot } from "../../../../../implementations/typescript/engine/src/registry-transport";
import { runLocalOrdinaryOperation, assertLocalOrdinaryOperation } from "./local-ordinary-operations";
import { beginBrowserDataStorageCommit } from "./browser-data-storage";
import { Anything, List, Ref } from "@fenel/engine/type-foundation";

// C2 actual Local recovery integration: actual holder, early/current/warm maps, physical transport,
// storage adapter and paired graph adapter; controlled Worker ports and reader
// registry preparation. Every ordinary/storage semantic body is existing Fenel.
const root = new URL("../../../../../", import.meta.url);
const input = (path: string) => Bun.file(new URL(path, root)).text();
const transpiler = new Bun.Transpiler({ loader: "ts" });
function code(text: string) {
  return transpiler.transformSync(text.replace(/^import[\s\S]*?;\r?\n/gm, "")
    .replace(/^export \{[^}]*\} from [^;]+;\r?\n/gm, ""))
    .replace(/^export /gm, "").replaceAll("import.meta.url", '"https://fixture.test/authoring-worker.js"')
    .replace(/\bimport\(("[^\"]+"|'[^']+')\)/g, "load($1)");
}
const holderText = await input("distros/narthex/solid/src/lib/local-locus-data.ts");
const holderCode = code(holderText.slice(holderText.indexOf("let tabKeeper:"), holderText.indexOf("/** Local endpoint transport:")));
const earlyCode = code(await input("distros/narthex/solid/src/lib/expression-runner/authoring-catalog-early-realm.ts"));
const catalogCode = code(await input("distros/narthex/solid/src/lib/expression-runner/authoring-catalog-worker.ts"));
const transportCode = code(await input("distros/narthex/solid/src/lib/expression-runner/authoring-worker-transport.ts"));
const pairedCode = code(await input("distros/narthex/solid/src/lib/expression-runner/authoring-worker-local-ordinary.ts"));
const storageCode = code(await input("distros/narthex/solid/src/lib/expression-runner/authoring-worker-browser-storage.ts"));
const syncText = await input("distros/narthex/solid/src/lib/locus-synchronization.tsx");
const syncCode = code(syncText.slice(syncText.indexOf("let retained:")));
const functions = new Map<string, any>();
for (const [path, name] of [["view/types.fenel", "view"], ["view/local-data.fenel", "view"], ["view/dependencies.fenel", "view"],
  ["std/appendItem.fenel", "std"], ["std/not.fenel", "std"], ["std/native/collection-native.fenel", "std"]]) {
  const module = loadFenelModule(await input(`fenel/modules/${path}`), name!, { bootstrapParser: "typescript" });
  for (const fn of module.functions ?? []) {
    functions.set(fn.id, fn); functions.set(fn.id.replace(":", "."), fn); functions.set(fn.id.slice(fn.id.indexOf(":") + 1), fn);
  }
}
// GLOBAL_ONLY: literal fixtures and the existing pure source policies; no
// account scope, registry initialization or native Worker claim is made here.
const context: EvaluateContext = { getFunction: name => functions.get(name),
  natives: Object.assign(Object.create(null), stdNatives), nativesCtx: Object.assign(Object.create(null), stdNativesCtx),
  _constructors: { Ok: ["_0"], Err: ["_0"], Just: ["_0"], Nothing: [] } };
function call(name: string, ...args: any[]): any {
  return evaluate({ call: [`view:${name}`, ...args.map((_, index) => ({ var: `arg${index}` }))] },
    Object.fromEntries(args.map((arg, index) => [`arg${index}`, arg])), context);
}
const just = (value: unknown) => ({ $tag: "Just", _0: value });
const nothing = { $tag: "Nothing" };
const model = { workspaceCall: call, allDataRootDescriptions: () => [] };
const gate = () => { let resolve!: () => void; const promise = new Promise<void>(yes => { resolve = yes; }); return { promise, resolve }; };
const turn = async () => { for (let index = 0; index < 40; index++) await Promise.resolve(); };
const operation = (id = "fresh") => ({ kind: "tabDataRootCommand", args: [{ kind: "remove", itemId: id }] });
const cleanups: Array<() => void> = [];
afterEach(() => { for (const cleanup of cleanups.splice(0)) cleanup(); });
function fixture() {
  let epoch = 1, now = 0, nextTimer = 0;
  const listeners = new Set<() => void>(), timers = new Map<number, { at: number; callback(): void }>();
  const workers: any[] = [], physicalTransports: any[] = [];
  let raw: any, nextOrdinaryCrash = false, initializationGate: ReturnType<typeof gate> | undefined;
  let ordinaryGate: ReturnType<typeof gate> | undefined;
  let commitGate: ReturnType<typeof gate> | undefined, initializations = 0, readerPreparations = 0, commits = 0;
  const invoke = (source: string, exports: string, bindings: Record<string, any>) =>
    new Function(...Object.keys(bindings), `${source}; return {${exports}};`)(...Object.values(bindings));
  class ScriptedWorker {
    posted: any[] = []; terminated = false; onmessage: any; onerror: any; onmessageerror: any;
    constructor() { workers.push(this); }
    terminate() { this.terminated = true; }
    crash(message = "physical crash") { this.onerror?.({ message }); }
    postMessage(message: any) {
      const received = structuredClone(message); this.posted.push(received);
      queueMicrotask(async () => {
        if (this.terminated || received.id === undefined || received.method === "cancel") return;
        const emit = (packet: any) => this.onmessage?.({ data: structuredClone(packet) });
        emit({ id: received.id, event: "started", startedAt: 1_000_000 + now });
        try {
          let result: any;
          if (received.method === "initialize") {
            initializations++;
            const hold = initializationGate; initializationGate = undefined;
            await hold?.promise;
            result = { catalog: { functions: [], marker: initializations }, displayCatalog: [] };
          } else if (received.method === "run-local-ordinary") {
            const hold = ordinaryGate; ordinaryGate = undefined; await hold?.promise;
            if (this.terminated) return;
            if (nextOrdinaryCrash) { nextOrdinaryCrash = false; this.crash("ordinary crash"); return; }
            result = { localOrdinary: { operation: received.operation, value: runLocalOrdinaryOperation(model as any, received.operation) } };
          } else if (received.method === "load-local-storage") {
            const checked = call("browserDataStoredState", "fenel-browser-local", raw ? just(raw) : nothing);
            if (checked.$tag !== "Ok") throw Error(checked._0);
            result = checked._0.$tag === "Nothing" ? {} : { storageRecord: { ...raw, data: checked._0._0 } };
          } else if (received.method === "commit-local-storage") {
            commits++;
            const hold = commitGate; commitGate = undefined; await hold?.promise;
            if (this.terminated) return;
            const checked = call("browserDataStoragePlan", "fenel-browser-local", raw ? just(raw) : nothing,
              received.expectedGeneration === undefined ? nothing : just(received.expectedGeneration), received.next);
            if (checked.$tag !== "Ok") {
              emit({ id: received.id, event: "storage-settled", outcome: { status: "not-committed", error: checked._0 } }); throw Error(checked._0);
            }
            raw = structuredClone(checked._0);
            emit({ id: received.id, event: "storage-settled", outcome: { status: "committed", record: raw } });
            result = { storageRecord: raw };
          } else throw Error(`Unexpected scripted request ${received.method}`);
          if (!this.terminated) emit({ id: received.id, ok: true, result });
        } catch (error) {
          if (!this.terminated) emit({ id: received.id, ok: false, error: error instanceof Error ? error.message : String(error) });
        } finally { if (!this.terminated) emit({ id: received.id, event: "finished" }); }
      });
    }
  }
  const bindings: Record<string, any> = {
    Worker: ScriptedWorker,
    createSignal: (initial: unknown) => { let value = initial; return [() => value, (next: any) => { value = typeof next === "function" ? next(value) : next; }]; },
    untrack: (read: () => unknown) => read(),
    sessionEpoch: () => epoch, assertCurrentSession: (captured: number) => { if (captured !== epoch) throw Error("session changed"); },
    onBrowserSessionChange: (listener: () => void) => { listeners.add(listener); return () => listeners.delete(listener); },
    registryTransportSnapshot, captureRegistryTransportRoundTrip, captureRegistryTransportObservation,
    concreteAuthoringSession: (session: unknown) => session, localAuthoringScopeForSession: () => undefined,
    closeRegistryPreparationWorker: () => {}, throwRegistryPreparationFailure: (value: unknown) => { throw Error(String(value)); },
    clearCheckedRepositoryNamespaces: () => {}, retainCheckedRepositoryNamespaces: () => {}, registerCatalogEntities: () => {},
    registerIdentifiedCatalogEntity: () => {}, prepareEngineBodyDispatch: async () => {}, installPreparedWorkspaceCatalog: () => {},
    accountFieldRegistryState: () => undefined,
    performance: { timeOrigin: 1_000_000, now: () => now },
    setTimeout: (callback: () => void, delay: number) => { const id = ++nextTimer; timers.set(id, { callback, at: now + delay }); return id; },
    clearTimeout: (id: number) => timers.delete(id),
  };
  const physical = invoke(transportCode, "createAuthoringWorkerTransport, requestAuthoringTransport, reserveAuthoringInitialization, controlAuthoringTransport, closeAuthoringTransport, retireAuthoringTransport, observeAuthoringTransport, WorkerRequestError, requestAuthoringStorageCommit, isAuthoringStorageRecord", bindings);
  const createTransport = physical.createAuthoringWorkerTransport;
  physical.createAuthoringWorkerTransport = (...args: any[]) => { const value = createTransport(...args); physicalTransports.push(value); return value; };
  Object.assign(bindings, physical);
  const early = invoke(earlyCode, "spawnEarlyAuthoringRealm,retryEarlyAuthoringRealm,findLocalOrdinaryTransport,spawnReaderAuthoringRealm,discardEarlyAuthoringRealm,availableEarlyAuthoringRealm,reserveEarlyAuthoringRealm,acquireEarlyAuthoringPreparation,spawnAuthoringTransport,bindAuthoringTransport,borrowCoreAuthoringTransport,disposeEarlyAuthoringTransports,repositoryAuthoringRealmOwner,bindCoreAuthoringOwner,inheritCoreAuthoringOwner", bindings);
  Object.assign(bindings, early);
  const catalog = invoke(catalogCode, "createPreparedSnapshotOwner,prepareLocalCatalogInWorker,attachPreparedAuthoringWorker,prepareReaderWorkerHandle,preparedReaderWorkerClosed,beginPreparedReaderWorkerReplacement,discardPreparedReaderWorker,discardPreparedAuthoringWorker,discardWarmAuthoringRealm,borrowLocalOrdinaryTransport,disposePreparedAuthoringWorkers", bindings);
  const paired = invoke(pairedCode, "prepareAuthoringLocalOperation", { ...bindings, assertLocalOrdinaryOperation });
  const storage = invoke(storageCode, "createAuthoringWorkerBrowserStorage", bindings);
  const synchronization = invoke(syncCode, "locusSynchronizationForSession", bindings).locusSynchronizationForSession;
  const holderBindings = { ...bindings, ...paired, ...storage, beginBrowserDataStorageCommit, runLocalOrdinaryOperation,
    LOCAL_BROWSER_SOURCE_ID: "fenel-browser-local", locusSynchronizationForSession: synchronization,
    planLocalDefinitionBundle: async (_id: string, current: unknown) => current,
    prepareLocalReaderSnapshot: async (_id: string, definitions: any, options: any) => {
      readerPreparations++;
      const owner = options.restore?.owner ?? catalog.createPreparedSnapshotOwner();
      const checked = await catalog.prepareLocalCatalogInWorker(_id, definitions, [], [], { signal: options.signal,
        representations: options.representations, lineage: options.lineage });
      const registry = options.restore?.registry ?? {};
      const session = { registry, mode: "local", catalog: { functions: [] }, evaluateContext: {} };
      catalog.attachPreparedAuthoringWorker(registry, checked, session, owner);
      return { kind: "local", worker: catalog.prepareReaderWorkerHandle(checked), owner, registry, session,
        functions: [], types: [], functionRows: [], catalog: [], readMetadata: async () => ({ entries: [] }) };
    },
    load: async (name: string) => {
      if (name.endsWith("authoring-catalog-worker")) return catalog;
      if (name === "@fenel/engine/type-foundation") return { Anything, List, Ref };
      if (name === "@fenel/engine") return { invokeCallable: (ref: any, args: any[]) => call(ref.$ref.slice(5), ...args) };
      if (name === "./reader-source-metadata") return { readerSourceMetadataPacket: () => ({}) };
      if (name === "./workspace-model-loader") throw Error("No compatibility model should be acquired");
      throw Error(`Unexpected holder import ${name}`);
    },
  };
  const holder = invoke(holderCode, "localTabDataSource", holderBindings);
  const source = holder.localTabDataSource();
  cleanups.push(() => { source.dispose(); catalog.disposePreparedAuthoringWorkers(); });
  return { source, workers, physicalTransports, physical, early, catalog,
    sync: synchronization(), initializations: () => initializations, preparations: () => readerPreparations,
    commits: () => commits, disk: () => raw,
    ordinaryRequests: () => workers.flatMap(worker => worker.posted.filter((message: any) => message.method === "run-local-ordinary")),
    failNextOrdinary: () => { nextOrdinaryCrash = true; },
    holdInitialization: () => initializationGate = gate(), holdOrdinary: () => ordinaryGate = gate(), holdCommit: () => commitGate = gate(),
    changeEpoch: () => { epoch++; for (const listener of [...listeners]) listener(); },
  };
}

describe("Local ordinary new-admission recovery on actual physical owners", () => {
  test("unobservable initial inputs refuse before the first physical owner is primed", async () => {
    for (const itemId of [() => "host callable", new Map([["host", "map"]])]) {
      const h = fixture();
      await expect(h.source.ordinary({ kind: "tabDataRootCommand", args: [{ kind: "remove", itemId }] })).rejects.toThrow("transport");
      expect(h.workers).toHaveLength(0); expect(h.ordinaryRequests()).toHaveLength(0);
    }
  });
  test("unobservable new inputs refuse before a closed initial owner is rearmed", async () => {
    for (const itemId of [() => "host callable", new Map([["host", "map"]])]) {
      const h = fixture(); h.failNextOrdinary();
      await expect(h.source.ordinary(operation("failed"))).rejects.toThrow("ordinary crash");
      await expect(h.source.ordinary({ kind: "tabDataRootCommand", args: [{ kind: "remove", itemId }] })).rejects.toThrow("transport");
      expect(h.workers).toHaveLength(1); expect(h.ordinaryRequests()).toHaveLength(1);
    }
  });
  test("a new pure operation rearms a settled failed initial realm without replaying the failed request", async () => {
    const h = fixture(); h.failNextOrdinary();
    await expect(h.source.ordinary(operation("failed"))).rejects.toThrow("ordinary crash");
    expect(h.workers).toHaveLength(1); expect(h.initializations()).toBe(0); expect(h.source.state()).toBeUndefined();
    const result = await h.source.ordinary(operation("new-attempt"));
    expect(result.command.itemId).toBe("new-attempt"); expect(h.workers).toHaveLength(2);
    expect(h.ordinaryRequests().map(request => request.operation.args[0].itemId)).toEqual(["failed", "new-attempt"]);
    expect(h.initializations()).toBe(0); expect(h.source.state()).toBeUndefined();
  });
  test("readReady is a distinct initial admission after an earlier pure worker crash", async () => {
    const h = fixture(); h.failNextOrdinary();
    await expect(h.source.ordinary(operation("failed"))).rejects.toThrow("ordinary crash");
    await h.source.readReady();
    expect(h.source.root().revision).toBe(0); expect(h.workers).toHaveLength(2); expect(h.initializations()).toBe(0);
  });
  test("concurrent new initial operations share one replacement incarnation", async () => {
    const h = fixture(); await h.source.ordinary(operation()); h.workers[0].crash();
    const results = await Promise.all([h.source.ordinary(operation("one")), h.source.ordinary(operation("two"))]);
    expect(results.map(result => result.command.itemId)).toEqual(["one", "two"]); expect(h.workers).toHaveLength(2); expect(h.initializations()).toBe(0);
  });
  test("ready restores a definitely closed published Local reader on the existing owner", async () => {
    const h = fixture(); await h.source.ready(); const previous = h.source.snapshot(), state = h.source.state();
    h.workers[0].crash(); await h.source.ready();
    expect(h.source.snapshot()).not.toBe(previous); expect(h.source.snapshot().registry).toBe(previous.registry);
    expect(h.source.state()).toBe(state); expect(h.workers).toHaveLength(2); expect(h.initializations()).toBe(2);
  });
  test("concurrent public operations coalesce reader recovery and post only after preparation", async () => {
    const h = fixture(); await h.source.ready(); h.workers[0].crash(); const hold = h.holdInitialization();
    const requests = h.ordinaryRequests().length;
    const one = h.source.ordinary(operation("one")), two = h.source.ordinary(operation("two"));
    await turn(); expect(h.workers).toHaveLength(2); expect(h.ordinaryRequests()).toHaveLength(requests);
    hold.resolve(); const results = await Promise.all([one, two]);
    expect(results.map(result => result.command.itemId)).toEqual(["one", "two"]); expect(h.workers).toHaveLength(2); expect(h.initializations()).toBe(2);
  });
  test("submitted deep identity mutation during reader recovery refuses before posting the operation", async () => {
    const h = fixture(); await h.source.ready(); h.workers[0].crash(); const hold = h.holdInitialization();
    const submitted = operation("before"), original = h.ordinaryRequests().length;
    const pending = h.source.ordinary(submitted); void pending.catch(() => {});
    await turn(); submitted.args[0] = { ...submitted.args[0] }; hold.resolve();
    await expect(pending).rejects.toThrow("transport");
    expect(h.ordinaryRequests().slice(original).every(request => request.operation.kind === "publication")).toBe(true);
  });
  for (const boundary of ["caller", "source", "epoch"] as const) test(`${boundary} cancellation during recovery refuses the new operation`, async () => {
    const h = fixture(); await h.source.ready(); h.workers[0].crash(); const hold = h.holdInitialization(), controller = new AbortController();
    const count = h.ordinaryRequests().length;
    const pending = h.source.ordinary(operation("cancelled"), controller.signal); void pending.catch(() => {});
    await turn();
    if (boundary === "caller") controller.abort(Error("caller cancelled")); else if (boundary === "source") h.source.dispose(); else h.changeEpoch();
    hold.resolve(); await expect(pending).rejects.toThrow();
    expect(h.ordinaryRequests().slice(count).every(request => request.operation.kind !== "tabDataRootCommand")).toBe(true);
    expect(h.workers).toHaveLength(2);
  });
  test("an active rebuild neither starts a competing recovery nor revives the adopted early ticket", async () => {
    const h = fixture(); await h.source.ready(); const hold = h.holdInitialization();
    const writing = h.source.saveDefinitions({ ownerMutations: [] }); void writing.catch(() => {}); await turn();
    expect(h.workers).toHaveLength(1);
    const reading = h.source.ordinary(operation("during-rebuild")); void reading.catch(() => {}); await turn();
    expect(h.workers).toHaveLength(1); expect(h.initializations()).toBe(2);
    hold.resolve(); await writing; await reading;
    expect(h.workers).toHaveLength(1); expect(h.initializations()).toBe(2);
  });
  test("an active initial storage drain refuses new admission without spawning", async () => {
    const h = fixture(); await h.source.ordinary(operation()); const transport = h.physicalTransports[0], hold = h.holdCommit();
    const flight = h.physical.requestAuthoringStorageCommit(transport, { method: "commit-local-storage",
      next: call("tabDataWithClipboard", call("defaultLocalTabData", "fenel-browser-local")) }, () => {});
    void flight.result.catch(() => {}); await turn();
    const drained = h.physical.retireAuthoringTransport(transport, "draining", () => true);
    await expect(flight.result).rejects.toThrow("draining");
    await expect(h.source.ordinary(operation("during-drain"))).rejects.toThrow();
    expect(h.workers).toHaveLength(1); expect(transport.retirement).toBeDefined();
    hold.resolve(); await drained;
    expect((await flight.settled).status).toBe("committed");
    expect(transport.retirement).toBeUndefined(); expect(transport.jobs.size).toBe(0);
  });
  test("an ended initial holder ticket is never revived by new admission", async () => {
    const h = fixture(); await h.source.ordinary(operation());
    const ticket = h.early.availableEarlyAuthoringRealm(); h.early.discardEarlyAuthoringRealm(ticket.lineage);
    expect(ticket.retireWhenIdle).toBe(true); expect(ticket.transport.closed).toBe(true);
    await expect(h.source.ordinary(operation("retired"))).rejects.toThrow();
    expect(h.workers).toHaveLength(1);
  });
  test("Save resolves a current provider after an idle published worker crash", async () => {
    const h = fixture(); await h.sync.setEnabled(false); await h.source.ready();
    await h.source.transact([{ $tag: "TabSetLayout", layout: { kind: "grid" } }]); h.workers[0].crash();
    expect(await h.sync.saveAll()).toBe(true); expect(h.workers).toHaveLength(2); expect(h.commits()).toBe(1); expect(h.sync.pending()).toBe(0);
  });
  test("uncertain storage remains blocked across fresh ordinary recovery", async () => {
    const h = fixture(); await h.sync.setEnabled(false); await h.source.ready();
    await h.source.transact([{ $tag: "TabSetLayout", layout: { kind: "grid" } }]); const hold = h.holdCommit();
    const saving = h.sync.saveAll(); await turn(); expect(h.commits()).toBe(1); h.workers[0].crash("uncertain storage crash");
    hold.resolve(); expect(await saving).toBe(false); expect(h.sync.pending()).toBe(1);
    expect(await h.source.ordinary(operation("recover-only"))).toMatchObject({ command: { itemId: "recover-only" } });
    expect(await h.sync.saveAll()).toBe(false); expect(h.commits()).toBe(1); expect(h.sync.pending()).toBe(1); expect(h.sync.error()).toBeDefined();
  });
});
