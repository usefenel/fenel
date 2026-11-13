import { afterEach, describe, expect, test } from "bun:test";
import { createRoot, createMemo, createStore, flush } from "../../../node_modules/solid-js/dist/solid.dev.js";
import { registryTransportSnapshot } from "../../../../../../implementations/typescript/engine/src/registry-transport.ts";
import { checkRegistryPreparationBuild } from "../../../../../../implementations/typescript/engine/src/field-identity-worker-client.ts";
// L5a-finish: this page bundle's build identity, as the client sees it.
const BUILD = "page-build";

// C1: execute the actual browser client and its existing strict transport
// copier with host ports only. No engine import, registry build or real timer.
const transpiler = new Bun.Transpiler({ loader: "ts" });
const clientSource = await Bun.file(new URL("./authoring-catalog-worker.ts", import.meta.url)).text();
const eraseImports = source => source.replace(/^import[\s\S]*?;\r?\n/gm, "")
  .replace(/^export \{[^}]*\} from [^;]+;\r?\n/gm, "");
const hostCode = source => transpiler.transformSync(eraseImports(source))
  .replace(/^export /gm, "").replaceAll("import.meta.url", '\"https://fixture.test/reader-worker.js\"');
const clientCode = hostCode(clientSource);
const earlySource = await Bun.file(new URL("./authoring-catalog-early-realm.ts", import.meta.url)).text();
const earlyCode = hostCode(earlySource);
const transportSource = await Bun.file(new URL("./authoring-worker-transport.ts", import.meta.url)).text();
const transportCode = hostCode(transportSource);
const fixtures = [];
afterEach(() => { for (const fixture of fixtures.splice(0)) fixture.api.disposePreparedAuthoringWorkers(); });
// Exercise the metadata operation through every existing context, cancellation,
// retirement and epoch control; the client owns the shared lifetime contract.
const payload = () => ({ method: "project-reader-metadata", targets: ["first", "missing", "first"] });
const equalityMethods = ["project-reader-choice-selection", "project-reader-list-selection", "edit-reader-list-chips", "project-reader-field-plan",
  "project-reader-record-slots", "edit-reader-record-field"];
function equalityOperation(method, value) {
  if (method === "project-reader-record-slots") return { method, value, fields: ["b", "a", "b"], representationTypeName: "RecordRepresentation" };
  if (method === "edit-reader-record-field") return { method, value, field: "b", edited: value, representationTypeName: "RecordRepresentation" };
  if (method === "project-reader-field-plan") return { method, value,
    field: { name: "original", type: { $ref: "Declared" }, meta: { retained: value } },
    recordValues: { sibling: value }, fieldMode: "identified", channelId: "chosen", channelsEnabled: true };
  return { method, value, ...(method === "edit-reader-list-chips"
    ? { type: { $ref: "List" }, declarationType: { $ref: "Declared" },
      action: { $tag: "FieldListAppendChoice", index: 0, expected: value } }
    : { options: [{ value, label: "Selected" }] }) };
}
const valueReadOperation = value => ({ method: "project-reader-values", inputs: [{ value,
  typeLookup: "session", views: [], componentNames: [] }], knownIcons: ["star"] });
const settle = async () => { for (let turn = 0; turn < 4; turn++) await Promise.resolve(); };

describe("durable storage on the physical authoring owner", () => {
  const record = { schema: "fenel.local-data.v1", generation: 1, data: { tabId: "fenel-browser-local", revision: 0 } };
  const command = () => ({ method: "commit-local-storage", next: record.data });
  const receipt = (worker, id, outcome = { status: "committed", record }) =>
    worker.onmessage({ data: { id, event: "storage-settled", outcome } });
  function start(h, transport = h.early.spawnAuthoringTransport(), signal, notify = () => {}) {
    const flight = h.physical.requestAuthoringStorageCommit(transport, command(), notify, signal);
    return { ...flight, transport, worker: transport.worker, id: transport.nextId };
  }

  test("reader cancellation cannot lose a committed receipt or let a generic finish retire its job", async () => {
    const h = load(), controller = new AbortController(), seen = [];
    const f = start(h, undefined, controller.signal, outcome => seen.push(outcome));
    controller.abort(new Error("reader closed"));
    await expect(f.result).rejects.toThrow("reader closed");
    f.worker.onmessage({ data: { id: f.id, event: "finished" } });
    f.worker.reply(f.id, { storageRecord: record });
    expect(f.transport.jobs.has(f.id)).toBe(true);
    expect(seen).toEqual([]);
    h.physical.observeAuthoringTransport(f.transport, () => {
      if (!f.transport.jobs.size) {
        expect(seen).toEqual([{ status: "committed", record }]);
        h.physical.closeAuthoringTransport(f.transport, "idle closed");
      }
    });
    receipt(f.worker, f.id);
    expect(await f.settled).toEqual({ status: "committed", record });
    expect(f.transport.storage.size).toBe(0);
    expect(f.transport.closed).toBe(true);
  });

  test("definite refusal settles keeper before reader and permits another commit", async () => {
    const h = load(), seen = [], f = start(h, undefined, undefined, outcome => seen.push(outcome));
    receipt(f.worker, f.id, { status: "not-committed", error: "Foreign generation" });
    expect(seen).toEqual([{ status: "not-committed", error: "Foreign generation" }]);
    await expect(f.result).rejects.toThrow("Foreign generation");
    expect((await f.settled).status).toBe("not-committed");
    const next = start(h, f.transport); receipt(next.worker, next.id);
    expect(await next.result).toEqual({ storageRecord: record });
    expect(f.transport.closed).toBe(false);
  });

  test("unknown and duplicate receipts never acknowledge another write", async () => {
    const h = load(), seen = [], f = start(h, undefined, undefined, outcome => seen.push(outcome));
    receipt(f.worker, f.id + 100);
    expect(seen).toEqual([]);
    receipt(f.worker, f.id); receipt(f.worker, f.id);
    await f.result;
    const next = start(h, f.transport, undefined, outcome => seen.push(outcome));
    receipt(f.worker, f.id);
    expect(seen).toHaveLength(1);
    expect(f.transport.storage.has(next.id)).toBe(true);
    receipt(next.worker, next.id); await next.result;
    expect(seen).toHaveLength(2);
  });

  test.each(["crash", "messageerror", "malformed"])("%s after posting settles uncertainty and the retirement barrier", async cause => {
    const h = load(), seen = [], f = start(h, undefined, undefined, outcome => seen.push(outcome));
    const drained = h.physical.retireAuthoringTransport(f.transport, "reader retired", () => true);
    await expect(f.result).rejects.toThrow("reader retired");
    if (cause === "crash") f.worker.onerror({ message: "crashed" });
    else if (cause === "messageerror") f.worker.onmessageerror();
    else receipt(f.worker, f.id, { status: "committed", record: { generation: 1 } });
    await drained;
    expect((await f.settled).status).toBe("uncertain");
    expect(seen).toHaveLength(1);
    expect(f.transport.jobs.size).toBe(0);
    expect(f.transport.retirement).toBeUndefined();
  });

  test("unposted closure and clone failure are definite noncommits", async () => {
    const h = load(), transport = h.early.spawnAuthoringTransport();
    const remove = h.physical.observeAuthoringTransport(transport, () => {
      h.physical.closeAuthoringTransport(transport, "closed before post");
    });
    const f = start(h, transport); remove();
    expect((await f.settled).status).toBe("not-committed");
    await expect(f.result).rejects.toThrow("before post");
    expect(f.worker.posted).toEqual([]);
    const fresh = h.early.spawnAuthoringTransport();
    const clone = h.physical.requestAuthoringStorageCommit(fresh, { ...command(), next: () => {} }, () => {});
    expect((await clone.settled).status).toBe("not-committed");
    await expect(clone.result).rejects.toThrow();
    expect(fresh.closed).toBe(false);
    expect(fresh.jobs.size).toBe(0);
  });

  test("pre-aborted and already closed admission settle without posting", async () => {
    const h = load(), controller = new AbortController(); controller.abort(new Error("pre-aborted"));
    const f = start(h, undefined, controller.signal);
    expect((await f.settled).status).toBe("not-committed");
    await expect(f.result).rejects.toThrow("pre-aborted");
    h.physical.closeAuthoringTransport(f.transport, "closed");
    const next = start(h, f.transport);
    expect((await next.settled).status).toBe("not-committed");
    await expect(next.result).rejects.toThrow("closed");
    expect(f.worker.posted).toEqual([]);
  });

  test("storage requires an explicit durable owner and release refuses unsettled writes", async () => {
    const h = load(), transport = h.early.spawnAuthoringTransport();
    await expect(h.physical.requestAuthoringTransport(transport, command())).rejects.toThrow("durable settlement owner");
    const f = start(h, transport);
    expect(() => h.physical.controlAuthoringTransport(transport, { method: "release" })).toThrow("unsettled");
    receipt(f.worker, f.id); await f.result;
  });

  test("retirement preserves the original dispatch deadline and refuses fresh initialization", async () => {
    const h = load(), f = start(h);
    h.advance(179_000);
    const drained = h.physical.retireAuthoringTransport(f.transport, "retired", () => true);
    await expect(f.result).rejects.toThrow("retired");
    expect(() => h.physical.reserveAuthoringInitialization(f.transport, { method: "initialize" })).toThrow("retired");
    h.advance(1_000); await drained;
    expect((await f.settled).status).toBe("uncertain");
    expect(f.worker.terminated).toBe(true);
  });

  test("a started commit keeps its execution deadline while draining", async () => {
    const h = load(), f = start(h); f.worker.started(f.id);
    h.advance(179_000);
    const drained = h.physical.retireAuthoringTransport(f.transport, "retired");
    await expect(f.result).rejects.toThrow("retired");
    expect(f.worker.terminated).toBe(false);
    h.advance(1_000); await drained;
    expect((await f.settled).status).toBe("uncertain");
  });

  test("release can strengthen to termination, and cannot then weaken", async () => {
    const h = load(), f = start(h); let releases = 0;
    const drained = h.physical.retireAuthoringTransport(f.transport, "rebuild", () => { releases++; return true; });
    const strengthened = h.physical.retireAuthoringTransport(f.transport, "holder closed");
    h.physical.retireAuthoringTransport(f.transport, "late rebuild", () => { releases++; return true; });
    expect(strengthened).toBe(drained);
    expect(f.worker.terminated).toBe(false);
    receipt(f.worker, f.id); await drained;
    expect((await f.settled).status).toBe("committed");
    await expect(f.result).rejects.toThrow("rebuild");
    expect(releases).toBe(0);
    expect(f.worker.terminated).toBe(true);
  });

  test("two drained warm incarnations admit fresh writes with no stale release callback", async () => {
    const h = load(), transport = h.early.spawnAuthoringTransport(), releases = [];
    for (let incarnation = 0; incarnation < 2; incarnation++) {
      const f = start(h, transport);
      const drained = h.physical.retireAuthoringTransport(transport, "rebuild", () => {
        releases.push(incarnation); h.physical.controlAuthoringTransport(transport, { method: "release" }); return true;
      });
      receipt(f.worker, f.id); await drained;
      await expect(f.result).rejects.toThrow("rebuild");
      expect((await f.settled).status).toBe("committed");
      expect(transport.retirement).toBeUndefined();
      expect(transport.closed).toBe(false);
    }
    expect(releases).toEqual([0, 1]);
  });

  test("a release callback cannot undo a reentrant escalation to termination", async () => {
    const h = load(), transport = h.early.spawnAuthoringTransport();
    await h.physical.retireAuthoringTransport(transport, "rebuild", () => {
      void h.physical.retireAuthoringTransport(transport, "holder closed");
      return true;
    });
    expect(transport.closed).toBe(true);
    expect(transport.reason).toBe("holder closed");
  });

  test.each([false, true])("pre-initialization closure drains storage even with reservation=%s", async reserved => {
    const h = load(), lineage = {};
    h.early.spawnEarlyAuthoringRealm(lineage, 1);
    const transport = h.physicalTransports[0];
    if (reserved) h.early.reserveEarlyAuthoringRealm(lineage);
    const f = start(h, transport);
    h.early.disposeEarlyAuthoringTransports();
    expect(f.worker.terminated).toBe(false);
    await expect(f.result).rejects.toThrow("snapshot changed");
    receipt(f.worker, f.id);
    expect((await f.settled).status).toBe("committed");
    expect(f.worker.terminated).toBe(true);
  });

  test("a keeper callback fault cannot lose its receipt or strand a peer", async () => {
    const h = load(), f = start(h, undefined, undefined, () => { throw new Error("keeper fault"); });
    const peer = start(h, f.transport);
    receipt(f.worker, f.id);
    expect((await f.settled).status).toBe("committed");
    expect((await peer.settled).status).toBe("uncertain");
    await expect(peer.result).rejects.toThrow("acknowledgement");
    expect(f.transport.closed).toBe(true);
    expect(f.transport.storage.size).toBe(0);
  });

  test.each(["warm", "holder", "session"])("actual Local client disposal drains storage before %s disposition", async disposition => {
    const h = load(), lineage = {};
    const preparing = h.api.prepareLocalCatalogInWorker("tab-a", { owners: [], fields: [], facets: [] }, [], [], { lineage });
    const worker = h.workers[0], transport = h.physicalTransports[0], catalog = { marker: 1 };
    worker.reply(worker.posted[0].id, { catalog, displayCatalog: [] }); await preparing;
    const handle = h.api.prepareReaderWorkerHandle(catalog);
    const f = start(h, transport);
    h.api.discardPreparedReaderWorker(handle, { keepRealm: true });
    await expect(f.result).rejects.toThrow("snapshot");
    if (disposition === "holder") h.api.discardWarmAuthoringRealm(lineage);
    if (disposition === "session") { h.changeEpoch(); h.api.disposePreparedAuthoringWorkers(); }
    expect(worker.terminated).toBe(false);
    receipt(worker, f.id); await settle();
    expect((await f.settled).status).toBe("committed");
    if (disposition !== "warm") { expect(worker.terminated).toBe(true); return; }
    expect(worker.terminated).toBe(false);
    expect(worker.posted.at(-1).method).toBe("release");
    const successor = h.api.prepareLocalCatalogInWorker("tab-a", { owners: [], fields: [], facets: [] }, [], [], { lineage });
    expect(h.workers).toHaveLength(1);
    worker.reply(worker.posted.at(-1).id, { catalog: { marker: 2 }, displayCatalog: [] }); await successor;
  });
});

function load() {
  let epoch = 1, elapsed = 0, nextTimer = 0, signalReads = 0;
  const timers = new Map(), workers = [], scopes = new WeakMap(), transports = [], physicalTransports = [];
  const preparationCloses = [];
  const preparationFailures = [], reconstructedPreparationFailure = new Error("Restored preparation diagnostic");
  const origin = 1_000_000_000_000;
  class ScriptedWorker {
    posted = [];
    terminated = false;
    constructor() { workers.push(this); }
    postMessage(message) { this.posted.push(structuredClone(message)); }
    terminate() { this.terminated = true; }
    reply(id, result) { this.onmessage?.({ data: { id, ok: true, result } }); }
    error(id, code) { this.onmessage?.({ data: { id, ok: false, error: "context unavailable", code } }); }
    started(id, startedAt = origin + elapsed) { this.onmessage?.({ data: { id, event: "started", startedAt } }); }
  }
  const sessionListeners = [];
  const bindings = {
    Worker: ScriptedWorker,
    registryTransportSnapshot(value, context, mode, readDataProperty) {
      const observation = { value, context, mode, readDataProperty };
      transports.push(observation);
      const captured = registryTransportSnapshot(value, context, mode, readDataProperty);
      observation.captured = captured;
      return captured;
    },
    createSignal: initial => {
      let value = initial;
      return [() => { signalReads++; return value; }, next => { value = next(value); }];
    },
    concreteAuthoringSession: session => session,
    localAuthoringScopeForSession: session => scopes.get(session),
    sessionEpoch: () => epoch,
    assertCurrentSession: captured => { if (captured !== epoch) throw new Error("The browser session changed."); },
    onBrowserSessionChange: listener => { sessionListeners.push(listener); return () => {}; },
    closeRegistryPreparationWorker: when => { preparationCloses.push(when); },
    AUTHORING_BUILD_IDENTITY: BUILD, checkRegistryPreparationBuild,
    throwRegistryPreparationFailure: failure => { preparationFailures.push(failure); throw reconstructedPreparationFailure; },
    clearCheckedRepositoryNamespaces: () => {}, retainCheckedRepositoryNamespaces: () => {},
    registerCatalogEntities: () => {}, registerIdentifiedCatalogEntity: () => {}, prepareEngineBodyDispatch: async () => {},
    installPreparedWorkspaceCatalog: () => {}, accountFieldRegistryState: () => undefined,
    performance: { timeOrigin: origin, now: () => elapsed },
    setTimeout: (callback, delay) => { const id = ++nextTimer; timers.set(id, { callback, at: elapsed + delay }); return id; },
    clearTimeout: id => timers.delete(id),
  };
  const physical = new Function(...Object.keys(bindings), `${transportCode}; return {
    createAuthoringWorkerTransport, requestAuthoringTransport, reserveAuthoringInitialization, controlAuthoringTransport,
    closeAuthoringTransport, retireAuthoringTransport, requestAuthoringStorageCommit,
    observeAuthoringTransport, WorkerRequestError, AUTHORING_JOB_ALLOWANCE_MS, AUTHORING_INITIALIZATION_ALLOWANCE_MS,
  };`)(...Object.values(bindings));
  const createTransport = physical.createAuthoringWorkerTransport;
  physical.createAuthoringWorkerTransport = (...args) => {
    const transport = createTransport(...args); physicalTransports.push(transport); return transport;
  };
  Object.assign(bindings, physical);
  const early = new Function(...Object.keys(bindings), `${earlyCode}; return {
    spawnEarlyAuthoringRealm, retryEarlyAuthoringRealm, findLocalOrdinaryTransport, spawnReaderAuthoringRealm, discardEarlyAuthoringRealm, availableEarlyAuthoringRealm,
    reserveEarlyAuthoringRealm, acquireEarlyAuthoringPreparation, spawnAuthoringTransport,
    bindAuthoringTransport, borrowCoreAuthoringTransport, disposeEarlyAuthoringTransports, repositoryAuthoringRealmOwner,
  };`)(...Object.values(bindings));
  Object.assign(bindings, early);
  const api = new Function(...Object.keys(bindings), `${clientCode}; return {
    acquireEarlyLocalEnginePreparation,
    prepareLocalCatalogInWorker, prepareCatalogInWorker, prepareRepositoryCatalogInWorker,
    attachPreparedAuthoringWorker, discardPreparedAuthoringWorker, discardPreparedAuthoringCatalog,
    prepareModuleCatalogInWorker, bindModuleAuthoringWorkerSession,
    prepareReaderWorkerHandle, preparedReaderWorkerCatalog, preparedReaderWorkerForSession,
    scopePreparedReaderWorker, runPreparedReaderWorker, runAuthoringWorker,
    authoringWorkerSnapshot, authoringWorkerRetired, disposePreparedAuthoringWorkers,
    discardPreparedReaderWorker, discardWarmAuthoringRealm, WARM_REALM_IDLE_MS, AUTHORING_INITIALIZATION_ALLOWANCE_MS,
    acquireLocalRegistryPreparation, borrowLocalOrdinaryTransport,
  };`)(...Object.values(bindings));
  async function prepare({ sourceId = "tab-a", accountId, repository = false, catalog: suppliedCatalog } = {}) {
    const snapshot = { owners: [], fields: [], facets: [] };
    let preparationOwner;
    const preparing = repository ? api.prepareRepositoryCatalogInWorker()
      : accountId !== undefined ? api.prepareCatalogInWorker(accountId, snapshot, [], [], { independent: true })
      : api.prepareLocalCatalogInWorker(sourceId, snapshot, [], [], { onRegistryPreparation: owner => { preparationOwner = owner; } });
    const worker = workers.at(-1), catalog = suppliedCatalog ?? { marker: workers.length }, displayCatalog = [{ marker: workers.length }];
    worker.reply(worker.posted[0].id, { catalog, displayCatalog });
    await preparing;
    return { worker, catalog, displayCatalog, preparationOwner, handle: api.prepareReaderWorkerHandle(catalog) };
  }
  function advance(ms) {
    elapsed += ms;
    for (const [id, timer] of [...timers]) if (timer.at <= elapsed && timers.delete(id)) timer.callback();
  }
  const fixture = { early, physical, physicalTransports, sessionListeners, api, prepare, workers, scopes, transports, advance, preparationCloses, preparationFailures, reconstructedPreparationFailure,
    workerRevisionReads: () => signalReads, changeEpoch: () => { epoch++; } };
  fixtures.push(fixture);
  return fixture;
}

describe("prepared reader worker host ownership", () => {
  test("instance metadata dispatch preserves native arguments and authored order through direct and session APIs", async () => {
    for (const legacy of [false, true]) {
      const h = load(), { api } = h;
      const { worker, catalog, handle } = await h.prepare();
      const registry = {}, session = { mode: "detached", registry };
      api.attachPreparedAuthoringWorker(registry, catalog, session);
      const invoke = operation => legacy ? api.runAuthoringWorker(session, operation) : api.runPreparedReaderWorker(handle, operation);
      const beforeRosterCopies = h.transports.length;
      const roster = invoke({ method: "project-reader-instance-interfaces", priority: "guidance" });
      const rosterRequest = worker.posted.at(-1);
      expect(rosterRequest.method).toBe("project-reader-instance-interfaces");
      expect(rosterRequest.priority).toBe("guidance");
      // Session calls forward canonical requests through their existing context;
      // direct prepared requests additionally capture them before forwarding.
      expect(h.transports).toHaveLength(beforeRosterCopies + (legacy ? 0 : 1));
      if (!legacy) expect(h.transports.at(-1).mode).toBe("canonical");
      const rosterResult = { instanceInterfaces: { $tag: "Ok", _0: { interfaces: [], representational: [] } } };
      worker.reply(rosterRequest.id, rosterResult);
      expect(await roster).toBe(rosterResult);

      const bytes = Uint8Array.of(1, 2, 255), date = new Date("2026-10-22T12:34:56.789Z");
      const authored = { z: 1, a: 2, bytes, date };
      const operation = { method: "project-reader-instance-methods-type", typeName: "Example",
        args: ["Bytes", { $el: { lit: authored } }, bytes, date], priority: "guidance" };
      const running = invoke(operation);
      expect(h.transports.at(-1).mode).toBe("value-read");
      expect(h.transports.at(-1).readDataProperty).toBe(Reflect.get);
      const request = worker.posted.at(-1);
      expect(request.method).toBe(operation.method);
      expect(request.typeName).toBe(operation.typeName);
      expect(request.priority).toBe("guidance");
      const posted = request.args[1].$el.lit;
      expect(Object.keys(posted)).toEqual(["z", "a", "bytes", "date"]);
      expect(posted.bytes).toBeInstanceOf(Uint8Array);
      expect(posted.bytes).not.toBe(bytes);
      expect(posted.bytes).toEqual(Uint8Array.of(1, 2, 255));
      expect(request.args[2]).toBe(posted.bytes);
      expect(posted.date).toBeInstanceOf(Date);
      expect(posted.date.getTime()).toBe(date.getTime());
      expect(request.args[3].getTime()).toBe(date.getTime());
      bytes[0] = 9; date.setTime(0);
      expect([...posted.bytes]).toEqual([1, 2, 255]);
      expect(posted.date.toISOString()).toBe("2026-10-22T12:34:56.789Z");
      const result = { instanceMethodsType: { $tag: "Ok", _0: { $ref: "Bytes" } } };
      worker.reply(request.id, result);
      expect(await running).toBe(result);

      for (const args of [[() => {}], [Object.defineProperty({}, "hidden", { value: true })]]) {
        const before = worker.posted.length;
        await expect(invoke({ ...operation, args })).rejects.toThrow();
        expect(worker.posted.length).toBe(before);
      }
      let reads = 0;
      const args = [undefined];
      Object.defineProperty(args, "0", { enumerable: true, get() { reads++; return new Date(0); } });
      const before = worker.posted.length;
      await expect(invoke({ ...operation, args })).rejects.toThrow("accessor");
      expect(reads).toBe(0);
      expect(worker.posted.length).toBe(before);
    }
  });

  test("value reads use native-preserving capture through direct and legacy APIs before the actual post", async () => {
    for (const legacy of [false, true]) {
      const h = load(), { api } = h;
      const { worker, catalog, handle } = await h.prepare();
      const registry = {}, session = { mode: "detached", registry };
      api.attachPreparedAuthoringWorker(registry, catalog, session);
      const date = new Date("2026-10-22T12:34:56.789Z");
      const buffer = new ArrayBuffer(8);
      new Uint8Array(buffer).set([1, 2, 3, 4, 5, 6, 7, 8]);
      const words = new Uint16Array(buffer, 2, 2), data = new DataView(buffer, 1, 3);
      const value = { b: 2, a: 1, date, repeatedDate: date, buffer, repeatedBuffer: buffer, words, data };
      const control = structuredClone(value);
      const operation = valueReadOperation(value);
      const running = legacy ? api.runAuthoringWorker(session, operation) : api.runPreparedReaderWorker(handle, operation);
      const observation = h.transports.at(-1);
      expect(observation.mode).toBe("value-read");
      expect(observation.readDataProperty).toBe(Reflect.get);
      const captured = observation.captured.inputs[0].value;
      expect(captured.date).toBeInstanceOf(Date);
      expect(captured.date.getTime()).toBe(date.getTime());
      expect(captured.date).not.toBe(date);
      expect(captured.date).toBe(captured.repeatedDate);
      expect(captured.buffer).toBe(captured.repeatedBuffer);
      expect(captured.words.buffer).toBe(captured.buffer);
      expect(captured.data.buffer).toBe(captured.buffer);
      const request = worker.posted.at(-1);
      expect(request.method).toBe("project-reader-values");
      expect(request.knownIcons).toEqual(["star"]);
      expect(Object.keys(request.inputs[0].value)).toEqual(Object.keys(value));
      const posted = request.inputs[0].value;
      expect(posted.date).toBeInstanceOf(Date);
      expect(posted.date.getTime()).toBe(date.getTime());
      // Bun's structuredClone currently splits repeated Date identity. The
      // strict copier's sharing is asserted above; compare this host boundary
      // with the same runtime's control rather than claiming it repairs Bun.
      expect(posted.date === posted.repeatedDate).toBe(control.date === control.repeatedDate);
      expect(posted.buffer).not.toBe(buffer);
      expect(posted.words).toBeInstanceOf(Uint16Array);
      expect(posted.words.byteOffset).toBe(2);
      expect(posted.words.length).toBe(2);
      expect(posted.data).toBeInstanceOf(DataView);
      expect(posted.data.byteOffset).toBe(1);
      expect(posted.data.byteLength).toBe(3);
      expect(posted.words.buffer).toBe(posted.buffer);
      expect(posted.data.buffer).toBe(posted.buffer);
      date.setTime(0); new Uint8Array(buffer)[2] = 255;
      expect(posted.date.getTime()).toBe(control.date.getTime());
      expect([...new Uint8Array(posted.buffer)]).toEqual([...new Uint8Array(control.buffer)]);
      const result = { valueReads: [{ root: { body: "scalar" }, children: [] }] };
      worker.reply(request.id, result);
      expect(await running).toBe(result);
    }
  });

  test("value-read callbacks, host registries, hidden data and inherited methods refuse before posting", async () => {
    for (const legacy of [false, true]) {
      const h = load(), { api } = h;
      const { worker, catalog, handle } = await h.prepare();
      const registry = {}, session = { mode: "detached", registry };
      api.attachPreparedAuthoringWorker(registry, catalog, session);
      const invoke = operation => legacy ? api.runAuthoringWorker(session, operation) : api.runPreparedReaderWorker(handle, operation);
      for (const change of [
        operation => { operation.inputs[0].views = [{ render: () => true }]; },
        operation => { operation.registry = { getFunction: () => undefined }; },
        operation => { operation.inputs[0].value = Object.defineProperty({ b: 2, a: 1 }, "hidden", { value: true }); },
      ]) {
        const operation = valueReadOperation({ b: 2, a: 1 });
        change(operation);
        const before = worker.posted.length;
        await expect(invoke(operation)).rejects.toThrow();
        expect(h.transports.at(-1).mode).toBe("value-read");
        expect(worker.posted.length).toBe(before);
      }
      let reads = 0;
      const operation = valueReadOperation({ b: 2, a: 1 });
      Object.defineProperty(operation.inputs[0], "value", { enumerable: true, get() { reads++; return new Date(0); } });
      const before = worker.posted.length;
      await expect(invoke(operation)).rejects.toThrow("accessor");
      expect(reads).toBe(0);
      expect(worker.posted.length).toBe(before);
      const inherited = Object.getOwnPropertyDescriptor(Object.prototype, "method");
      let missing;
      try {
        Object.defineProperty(Object.prototype, "method", { value: "project-reader-values", configurable: true });
        missing = invoke({ inputs: [], knownIcons: [] });
      } finally {
        if (inherited) Object.defineProperty(Object.prototype, "method", inherited);
        else delete Object.prototype.method;
      }
      await expect(missing).rejects.toThrow("operation is unavailable");
      expect(worker.posted.length).toBe(before);
    }
  });

  test("record operations preserve constructor tags, physical field aliases and ordered slots through either client API", async () => {
    for (const legacy of [false, true]) for (const method of ["project-reader-record-slots", "edit-reader-record-field"]) {
      const h = load(), { api } = h;
      const { worker, catalog, handle } = await h.prepare();
      const registry = {}, session = { mode: "detached", registry };
      api.attachPreparedAuthoringWorker(registry, catalog, session);
      const invoke = operation => legacy ? api.runAuthoringWorker(session, operation) : api.runPreparedReaderWorker(handle, operation);
      const shared = { b: 2, a: 1 };
      const value = { _1: shared, $tag: "Point", _0: shared };
      const operation = { method, value, representationTypeName: "Point", ...(method === "project-reader-record-slots"
        ? { fields: ["left", "right", "left"] } : { field: "left", edited: shared }) };
      const running = invoke(operation);
      const request = worker.posted.at(-1);
      expect(request.method).toBe(method);
      expect(request.representationTypeName).toBe("Point");
      expect(request.value).not.toBe(value);
      expect(Object.keys(request.value)).toEqual(["_1", "$tag", "_0"]);
      expect(request.value.$tag).toBe("Point");
      expect(request.value._0).toBe(request.value._1);
      expect(Object.keys(request.value._0)).toEqual(["b", "a"]);
      expect(Object.hasOwn(request.value, "left")).toBe(false);
      expect(h.transports.at(-1).mode).toBe("equality");
      if (method === "project-reader-record-slots") expect(request.fields).toEqual(["left", "right", "left"]);
      else {
        expect(request.field).toBe("left");
        expect(request.edited).toBe(request.value._0);
      }
      const result = method === "project-reader-record-slots"
        ? { recordSlots: [{ field: "left", slot: { $tag: "Ok", _0: { wire: "_0", value: { $tag: "Just", _0: shared } } } },
          { field: "right", slot: { $tag: "Ok", _0: { wire: "_1", value: { $tag: "Just", _0: shared } } } }] }
        : { edit: { $tag: "Ok", _0: value } };
      worker.reply(request.id, result);
      expect(await running).toBe(result);
      let reads = 0;
      for (const key of [method === "project-reader-record-slots" ? "fields" : "field", "representationTypeName"]) {
        const hostile = { ...operation };
        Object.defineProperty(hostile, key, { enumerable: true, get() { reads++; return operation[key]; } });
        const before = worker.posted.length;
        await expect(invoke(hostile)).rejects.toThrow("accessor");
        expect(worker.posted.length).toBe(before);
      }
      expect(reads).toBe(0);
    }
  });

  test("numeric codec discovery is admitted through direct and legacy equality routes without a value payload", async () => {
    for (const legacy of [false, true]) {
      const h = load(), { api } = h;
      const { worker, catalog, handle } = await h.prepare();
      const registry = {}, session = { mode: "detached", registry };
      api.attachPreparedAuthoringWorker(registry, catalog, session);
      const invoke = operation => legacy ? api.runAuthoringWorker(session, operation) : api.runPreparedReaderWorker(handle, operation);
      const operation = { method: "project-reader-numeric-codec", typeName: "Rational" };
      const running = invoke(operation);
      const request = worker.posted.at(-1);
      expect(request.method).toBe(operation.method);
      expect(request.typeName).toBe("Rational");
      expect(Object.hasOwn(request, "value")).toBe(false);
      expect(Object.hasOwn(request, "codec")).toBe(false);
      expect(h.transports.at(-1).mode).toBe("equality");
      const result = { codec: { decode: { $ref: "selected-decode" }, encode: { $ref: "selected-encode" } } };
      worker.reply(request.id, result);
      expect(await running).toBe(result);
      const hidden = Object.defineProperty({ ...operation }, "hidden", { value: "must not erase" });
      const before = worker.posted.length;
      await expect(invoke(hidden)).rejects.toThrow("non-enumerable");
      expect(worker.posted.length).toBe(before);
    }
  });

  test("numeric encode observes nested-only Solid store edits through the same proxy", async () => {
    const h = load(), { api } = h;
    const { worker, handle } = await h.prepare();
    const capture = createRoot(dispose => {
      const [state, update] = createStore({ value: { b: { amount: 1 }, a: 2 } });
      const original = state.value;
      const calls = [];
      const current = createMemo(() => {
        const pending = api.runPreparedReaderWorker(handle, { method: "encode-reader-numeric-text",
          codec: { typeName: "Rational" }, value: state.value });
        const entry = { pending, request: worker.posted.at(-1) };
        calls.push(entry);
        return entry;
      });
      return { state, update, original, calls, current, dispose };
    });
    try {
      const before = capture.current();
      expect(before.request.value.b.amount).toBe(1);
      capture.update(draft => { draft.value.b.amount = 9; });
      flush();
      const after = capture.current();
      expect(capture.state.value).toBe(capture.original);
      expect(after).not.toBe(before);
      expect(after.request.value.b.amount).toBe(9);
      expect(before.request.value.b.amount).toBe(1);
      expect(Object.keys(after.request.value)).toEqual(["b", "a"]);
      expect(h.transports.at(-1).readDataProperty).toBe(Reflect.get);
      for (const entry of capture.calls) worker.reply(entry.request.id, { encoded: { $tag: "Ok", _0: String(entry.request.value.b.amount) } });
      await Promise.all(capture.calls.map(entry => entry.pending));
    } finally { capture.dispose(); }
  });

  test("field plans capture current nested field keys, declaration, values and siblings without replacing store proxies", async () => {
    const h = load(), { api } = h;
    const { worker, handle } = await h.prepare();
    const capture = createRoot(dispose => {
      const shared = { b: { amount: 1 }, a: 2 };
      const [state, update] = createStore({ value: shared, recordValues: { chosen: shared, selected: { $ref: "Before" } },
        field: { name: "field", key: { $tag: "NamedField", ref: { $ref: "before-field" } },
          type: { $ref: "Before" }, meta: { retained: shared } } });
      const originals = { value: state.value, field: state.field, recordValues: state.recordValues };
      const calls = [];
      const current = createMemo(() => {
        const pending = api.runPreparedReaderWorker(handle, { method: "project-reader-field-plan", field: state.field,
          value: state.value, recordValues: state.recordValues, fieldMode: "identified", channelsEnabled: true });
        const entry = { pending, request: worker.posted.at(-1) };
        calls.push(entry);
        return entry;
      });
      return { state, update, originals, calls, current, dispose };
    });
    try {
      const before = capture.current();
      capture.update(draft => {
        draft.value.b.amount = 7;
        draft.field.key.ref.$ref = "after-field";
        draft.field.type.$ref = "After";
        draft.recordValues.selected.$ref = "After";
      });
      flush();
      const after = capture.current();
      expect(after).not.toBe(before);
      expect(capture.state.value).toBe(capture.originals.value);
      expect(capture.state.field).toBe(capture.originals.field);
      expect(capture.state.recordValues).toBe(capture.originals.recordValues);
      expect(after.request.field.key.ref.$ref).toBe("after-field");
      expect(after.request.field.type.$ref).toBe("After");
      expect(after.request.recordValues.selected.$ref).toBe("After");
      expect(after.request.value.b.amount).toBe(7);
      expect(after.request.value).toBe(after.request.recordValues.chosen);
      expect(after.request.value).toBe(after.request.field.meta.retained);
      expect(Object.keys(after.request.value)).toEqual(["b", "a"]);
      expect(before.request.field.key.ref.$ref).toBe("before-field");
      expect(before.request.value.b.amount).toBe(1);
      for (const entry of capture.calls) worker.reply(entry.request.id, { fieldPlan: { plan: {}, channels: [] } });
      await Promise.all(capture.calls.map(entry => entry.pending));
    } finally { capture.dispose(); }
  });

  test("live child accessors and hidden fields refuse before any getter or worker post", async () => {
    const h = load(), { api } = h;
    const { worker, handle } = await h.prepare();
    let reads = 0;
    const hostile = Object.defineProperty({}, "danger", { enumerable: true, get() { reads++; return "must not execute"; } });
    for (const child of [hostile, Object.defineProperty({ b: 2, a: 1 }, "hidden", { value: "must not erase" })]) {
      const capture = createRoot(dispose => {
        const [state, update] = createStore({ value: { nested: { amount: 1 } } });
        update(draft => { draft.value.nested = child; });
        flush();
        return { state, dispose };
      });
      try {
        const before = worker.posted.length;
        await expect(api.runPreparedReaderWorker(handle, { method: "encode-reader-numeric-text",
          codec: { typeName: "Rational" }, value: capture.state.value })).rejects.toThrow();
        expect(worker.posted.length).toBe(before);
        expect(reads).toBe(0);
      } finally { capture.dispose(); }
    }
  });

  test("polluted descriptor values and inherited methods cannot enter either client route", async () => {
    const h = load(), { api } = h;
    const { worker, catalog, handle } = await h.prepare();
    const registry = {}, session = { mode: "detached", registry };
    api.attachPreparedAuthoringWorker(registry, catalog, session);
    const originalValue = Object.getOwnPropertyDescriptor(Object.prototype, "value");
    const originalMethod = Object.getOwnPropertyDescriptor(Object.prototype, "method");
    let pollutedReads = 0, methodReads = 0;
    const accessor = {};
    Object.defineProperty(accessor, "method", { enumerable: true, get() { methodReads++; return "project-reader-numeric-codec"; } });
    const pending = [];
    const before = worker.posted.length;
    try {
      const descriptor = Object.assign(Object.create(null), { configurable: true,
        get() { pollutedReads++; return "project-reader-numeric-codec"; } });
      Object.defineProperty(Object.prototype, "value", descriptor);
      Object.defineProperty(Object.prototype, "method", Object.assign(Object.create(null), {
        configurable: true, value: "project-reader-numeric-codec", writable: true,
      }));
      pending.push(api.runPreparedReaderWorker(handle, accessor));
      pending.push(api.runAuthoringWorker(session, accessor));
      pending.push(api.runPreparedReaderWorker(handle, { typeName: "Rational" }));
      pending.push(api.runAuthoringWorker(session, { typeName: "Rational" }));
    } finally {
      if (originalValue) Object.defineProperty(Object.prototype, "value", originalValue);
      else delete Object.prototype.value;
      if (originalMethod) Object.defineProperty(Object.prototype, "method", originalMethod);
      else delete Object.prototype.method;
    }
    for (const result of pending) await expect(result).rejects.toThrow();
    expect(pollutedReads).toBe(0);
    expect(methodReads).toBe(0);
    expect(worker.posted.length).toBe(before);
  });

  test("live method overlays choose equality capture before either client route can normalize values", async () => {
    for (const legacy of [false, true]) for (const method of [
      "project-reader-choice-selection", "project-reader-field-plan", "encode-reader-numeric-text",
    ]) {
      const h = load(), { api } = h;
      const { worker, catalog, handle } = await h.prepare();
      const registry = {}, session = { mode: "detached", registry };
      api.attachPreparedAuthoringWorker(registry, catalog, session);
      const invoke = operation => legacy ? api.runAuthoringWorker(session, operation) : api.runPreparedReaderWorker(handle, operation);
      const proxyFor = value => {
        const operation = method === "encode-reader-numeric-text"
          ? { method, codec: { typeName: "Rational" }, value } : equalityOperation(method, value);
        const backing = { ...operation, method: "project-reader-metadata" };
        return new Proxy(backing, { get(target, key, receiver) { return key === "method" ? method : Reflect.get(target, key, receiver); } });
      };
      const valid = proxyFor({ b: 2, a: 1 });
      expect(Object.getOwnPropertyDescriptor(valid, "method").value).toBe("project-reader-metadata");
      const running = invoke(valid);
      const request = worker.posted.at(-1);
      expect(request.method).toBe(method);
      expect(Object.keys(request.value)).toEqual(["b", "a"]);
      expect(h.transports.at(-1).mode).toBe("equality");
      worker.reply(request.id, { retained: true });
      await running;
      const hidden = Object.defineProperty({ b: 2, a: 1 }, "hidden", { value: "must not erase" });
      const before = worker.posted.length;
      await expect(invoke(proxyFor(hidden))).rejects.toThrow("non-enumerable");
      expect(h.transports.at(-1).mode).toBe("equality");
      expect(worker.posted.length).toBe(before);
    }
  });

  test("a method that changes while the direct request is copied cannot select a later operation", async () => {
    const h = load(), { api } = h;
    const { worker, handle } = await h.prepare();
    let reads = 0;
    const payload = new Proxy({ method: "project-reader-metadata", targets: [], codec: { typeName: "Rational" }, value: { b: 2, a: 1 } }, {
      get(target, key, receiver) {
        if (key === "method") return ++reads === 1 ? "project-reader-metadata" : "encode-reader-numeric-text";
        return Reflect.get(target, key, receiver);
      },
    });
    const before = worker.posted.length;
    await expect(api.runPreparedReaderWorker(handle, payload)).rejects.toThrow("operation is unavailable");
    expect(reads).toBe(2);
    expect(worker.posted.length).toBe(before);
  });

  test("a legacy canonical request cannot switch to an equality operation during its later spread", async () => {
    const h = load(), { api } = h;
    const { worker, catalog } = await h.prepare();
    const registry = {}, session = { mode: "detached", registry };
    api.attachPreparedAuthoringWorker(registry, catalog, session);
    let reads = 0;
    const value = Object.defineProperty({ b: 2, a: 1 }, "hidden", { value: "must not erase" });
    const payload = new Proxy({ method: "project-reader-metadata", targets: [], codec: { typeName: "Rational" }, value }, {
      get(target, key, receiver) {
        if (key === "method") return ++reads === 1 ? "project-reader-metadata" : "encode-reader-numeric-text";
        return Reflect.get(target, key, receiver);
      },
    });
    const before = worker.posted.length;
    const pending = api.runAuthoringWorker(session, payload);
    const posted = worker.posted.length > before ? worker.posted.at(-1) : undefined;
    // Settle even a regression so failure reports never leave a hanging RPC.
    if (posted) { worker.reply(posted.id, {}); await pending; }
    else await expect(pending).rejects.toThrow();
    expect(posted).toBeUndefined();
  });

  test("ordinary legacy requests preserve literal key order while only private contexts select scopes", async () => {
    const h = load(), { api } = h;
    const { worker, catalog } = await h.prepare();
    const registry = {}, base = { mode: "detached", registry };
    api.attachPreparedAuthoringWorker(registry, catalog, base);
    const draft = { mode: "detached", registry };
    const admittedScope = { sourceId: "tab-a", functions: [{ id: "admitted" }] };
    h.scopes.set(draft, admittedScope);
    for (const selected of [base, draft]) {
      const before = h.transports.length;
      const pending = api.runAuthoringWorker(selected, { method: "evaluate-expression",
        node: { kind: "literal", value: { b: 2, a: 1 } }, savedExpressions: [], contextId: 77,
        sourceModule: "foreign", scope: { sourceId: "foreign", functions: [] } });
      const request = worker.posted.at(-1);
      expect(request.contextId).not.toBe(77);
      expect(request.sourceModule).toBeUndefined();
      expect(request.scope).toEqual(selected === draft ? admittedScope : undefined);
      expect(Object.keys(request.node.value)).toEqual(["b", "a"]);
      expect(h.transports.length).toBe(before);
      worker.reply(request.id, { result: { retained: true } });
      await pending;
    }
  });

  test("a context-missing retry rechecks the original method before any second legacy post", async () => {
    const h = load(), { api } = h;
    const { worker, catalog } = await h.prepare();
    const registry = {}, base = { mode: "detached", registry }, draft = { mode: "detached", registry };
    api.attachPreparedAuthoringWorker(registry, catalog, base);
    h.scopes.set(draft, { sourceId: "tab-a", functions: [] });
    let reads = 0;
    const payload = new Proxy({ method: "project-reader-metadata", targets: [], codec: { typeName: "Rational" }, value: { b: 2, a: 1 } }, {
      get(target, key, receiver) {
        if (key === "method") return ++reads <= 2 ? "project-reader-metadata" : "encode-reader-numeric-text";
        return Reflect.get(target, key, receiver);
      },
    });
    const pending = api.runAuthoringWorker(draft, payload);
    const request = worker.posted.at(-1);
    expect(request.method).toBe("project-reader-metadata");
    expect(request.scope).toEqual({ sourceId: "tab-a", functions: [] });
    const beforeRetry = worker.posted.length;
    worker.error(request.id, "context-missing");
    await expect(pending).rejects.toThrow("operation changed");
    expect(reads).toBe(3);
    expect(worker.posted.length).toBe(beforeRetry);
  });

  test("reader operations share admitted scopes, cancellation and reader generation fences", async () => {
    const cases = [
      { operation: { method: "decode-reader-numeric-text", codec: { typeName: "Rational" }, value: "2.5" },
        result: { decoded: { $tag: "Ok", _0: { numerator: 5, denominator: 2 } } } },
      { operation: { method: "encode-reader-numeric-text", codec: { typeName: "Rational" }, value: { numerator: 5, denominator: 2 } },
        result: { encoded: { $tag: "Ok", _0: "2.5" } } },
      { operation: equalityOperation("project-reader-record-slots", { b: 2, a: 1 }),
        result: { recordSlots: [{ field: "b", slot: { $tag: "Ok", _0: { wire: "_0", value: { $tag: "Just", _0: 2 } } } }] } },
      { operation: equalityOperation("edit-reader-record-field", { b: 2, a: 1 }),
        result: { edit: { $tag: "Ok", _0: { b: 7, a: 1 } } } },
      { operation: valueReadOperation({ b: 2, a: 1 }), result: { valueReads: [{ root: { body: "scalar" }, children: [] }] } },
    ];
    for (const { operation, result } of cases) {
      const h = load(), { api } = h;
      const { worker, catalog, handle } = await h.prepare();
      const scoped = api.scopePreparedReaderWorker(handle, { sourceId: "tab-a", functions: [{ id: "reader-operation-draft" }] });
      const running = api.runPreparedReaderWorker(scoped, { ...operation, contextId: 77,
        sourceModule: "foreign", scope: { sourceId: "foreign", functions: [] } });
      const request = worker.posted.at(-1);
      expect(request.method).toBe(operation.method);
      expect(request.contextId).not.toBe(77);
      expect(request.scope).toEqual({ sourceId: "tab-a", functions: [{ id: "reader-operation-draft" }] });
      expect(request.sourceModule).toBeUndefined();
      worker.reply(request.id, result);
      expect(await running).toBe(result);
      const refused = api.runPreparedReaderWorker(scoped, operation);
      worker.error(worker.posted.at(-1).id);
      await expect(refused).rejects.toThrow("context unavailable");
      const controller = new AbortController(), reason = new Error("reader caller cancelled");
      const cancelled = api.runPreparedReaderWorker(scoped, operation, controller.signal);
      const abandoned = worker.posted.at(-1);
      controller.abort(reason);
      await expect(cancelled).rejects.toBe(reason);
      expect(worker.posted.at(-1)).toEqual({ id: abandoned.id, method: "cancel" });
      worker.reply(abandoned.id, result);
      const retired = api.runPreparedReaderWorker(scoped, operation);
      const stale = worker.posted.at(-1);
      api.discardPreparedAuthoringCatalog(catalog);
      await expect(retired).rejects.toThrow("snapshot changed");
      await expect(api.runPreparedReaderWorker(scoped, operation)).rejects.toThrow("replaced");
      const restored = await h.prepare();
      const fresh = api.runPreparedReaderWorker(restored.handle, operation);
      const current = restored.worker.posted.at(-1);
      worker.reply(stale.id, { wrong: "stale reader generation" });
      restored.worker.reply(current.id, result);
      expect(await fresh).toBe(result);
      const disposed = api.runPreparedReaderWorker(restored.handle, operation);
      api.disposePreparedAuthoringWorkers();
      await expect(disposed).rejects.toThrow("snapshot changed");
      await expect(api.runPreparedReaderWorker(restored.handle, operation)).rejects.toThrow("replaced");
      const third = await h.prepare();
      const changed = api.runPreparedReaderWorker(third.handle, operation);
      const changedRequest = third.worker.posted.at(-1);
      h.changeEpoch();
      third.worker.reply(changedRequest.id, result);
      await expect(changed).rejects.toThrow("session changed");
      const before = third.worker.posted.length;
      await expect(api.runPreparedReaderWorker(third.handle, operation)).rejects.toThrow("session changed");
      expect(third.worker.posted.length).toBe(before);
    }
  });

  test("numeric codecs and values use equality capture through both direct and legacy client APIs", async () => {
    for (const legacy of [false, true]) for (const method of ["decode-reader-numeric-text", "encode-reader-numeric-text"]) {
      const h = load(), { api } = h;
      const { worker, catalog, handle } = await h.prepare();
      const registry = {}, session = { mode: "detached", registry };
      api.attachPreparedAuthoringWorker(registry, catalog, session);
      const invoke = operation => legacy ? api.runAuthoringWorker(session, operation) : api.runPreparedReaderWorker(handle, operation);
      for (const codec of [
        { methods: { encode: { $ref: "selected-encode" }, decode: { $ref: "selected-decode" } } },
        { typeName: "SelectedNumericType" },
      ]) {
        const value = method === "decode-reader-numeric-text" ? "2.5" : { b: 2, a: 1 };
        const operation = { method, codec, value };
        const running = invoke(operation);
        const request = worker.posted.at(-1);
        expect(request.method).toBe(method);
        expect(request.codec).toEqual(codec);
        expect(request.codec).not.toBe(codec);
        if (codec.methods) expect(Object.keys(request.codec.methods)).toEqual(["encode", "decode"]);
        if (typeof value === "string") expect(request.value).toBe(value);
        else {
          expect(Object.keys(request.value)).toEqual(["b", "a"]);
          expect(request.value).not.toBe(value);
        }
        expect(h.transports.at(-1).mode).toBe("equality");
        worker.reply(request.id, { retained: true });
        await running;
        const hiddenCodec = Object.defineProperty({ ...codec }, "hidden", { value: "must not erase" });
        const before = worker.posted.length;
        await expect(invoke({ ...operation, codec: hiddenCodec })).rejects.toThrow("non-enumerable");
        expect(worker.posted.length).toBe(before);
        if (typeof value !== "string") {
          const hiddenValue = Object.defineProperty({ b: 2, a: 1 }, "hidden", { value: "must not erase" });
          await expect(invoke({ ...operation, value: hiddenValue })).rejects.toThrow("non-enumerable");
          expect(worker.posted.length).toBe(before);
        }
        let reads = 0;
        const hostile = { codec, value };
        Object.defineProperty(hostile, "method", { enumerable: true, get() { reads++; return method; } });
        await expect(invoke(hostile)).rejects.toThrow("accessor");
        expect(reads).toBe(0);
        expect(worker.posted.length).toBe(before);
      }
    }
  });

  test("field plans retain exact admitted scopes and channel identity across cancellation and source replacement", async () => {
    const h = load(), { api } = h;
    const { worker, catalog, handle } = await h.prepare();
    const operation = equalityOperation("project-reader-field-plan", { b: 2, a: 1 });
    const scoped = api.scopePreparedReaderWorker(handle, { sourceId: "tab-a", functions: [{ id: "scoped" }] });
    const running = api.runPreparedReaderWorker(scoped, { ...operation, contextId: 77, sourceModule: "forged",
      scope: { sourceId: "foreign", functions: [] } });
    const request = worker.posted.at(-1);
    expect(request.contextId).not.toBe(77);
    expect(request.scope).toEqual({ sourceId: "tab-a", functions: [{ id: "scoped" }] });
    expect(request.sourceModule).toBeUndefined();
    expect(request.field).toEqual(operation.field);
    expect(request.recordValues.sibling).toBe(request.value);
    const channel = { id: "chosen", kind: "text" };
    const result = { fieldPlan: { plan: { editor: { channel } }, channels: [channel], activeChannelId: "chosen" } };
    worker.reply(request.id, result);
    expect(await running).toBe(result);
    expect(result.fieldPlan.plan.editor.channel).toBe(result.fieldPlan.channels[0]);
    const controller = new AbortController(), reason = new Error("field plan cancelled");
    const cancelled = api.runPreparedReaderWorker(scoped, operation, controller.signal);
    const abandoned = worker.posted.at(-1);
    controller.abort(reason);
    await expect(cancelled).rejects.toBe(reason);
    expect(worker.posted.at(-1)).toEqual({ id: abandoned.id, method: "cancel" });
    worker.reply(abandoned.id, result);
    const retired = api.runPreparedReaderWorker(scoped, operation);
    const stale = worker.posted.at(-1);
    api.discardPreparedAuthoringCatalog(catalog);
    await expect(retired).rejects.toThrow("snapshot changed");
    await expect(api.runPreparedReaderWorker(scoped, operation)).rejects.toThrow("replaced");
    const restored = await h.prepare();
    const fresh = api.runPreparedReaderWorker(restored.handle, operation);
    const currentRequest = restored.worker.posted.at(-1);
    worker.reply(stale.id, { fieldPlan: { plan: "stale", channels: [] } });
    restored.worker.reply(currentRequest.id, result);
    expect(await fresh).toBe(result);
    const disposed = api.runPreparedReaderWorker(restored.handle, operation);
    api.disposePreparedAuthoringWorkers();
    await expect(disposed).rejects.toThrow("snapshot changed");
    await expect(api.runPreparedReaderWorker(restored.handle, operation)).rejects.toThrow("replaced");
  });

  test("field-plan field metadata and sibling observations cannot lose hidden properties before posting", async () => {
    const h = load(), { api } = h;
    const { worker, handle } = await h.prepare();
    const hidden = () => Object.defineProperty({ b: 2, a: 1 }, "hidden", { value: "must not erase" });
    for (const location of ["metadata", "siblings", "original-type"]) {
      const operation = equalityOperation("project-reader-field-plan", { b: 2, a: 1 });
      if (location === "metadata") operation.field.meta.retained = hidden();
      else if (location === "siblings") operation.recordValues.sibling = hidden();
      else operation.field.type = Object.defineProperty({ $ref: "Declared" }, "hidden", { value: "must not erase" });
      const before = worker.posted.length;
      await expect(api.runPreparedReaderWorker(handle, operation)).rejects.toThrow("non-enumerable");
      expect(h.transports.at(-1).mode).toBe("equality");
      expect(worker.posted.length).toBe(before);
    }
  });

  test("complete type previews use admitted scopes and retain cancellation, snapshot and epoch fences", async () => {
    const h = load(), { api } = h;
    const { worker, catalog, handle } = await h.prepare();
    const scoped = api.scopePreparedReaderWorker(handle, { sourceId: "tab-a", functions: [] });
    const type = { $ref: "Selected" };
    const operation = { method: "project-reader-type-preview", type, typeLookup: "registry", knownIcons: ["star"] };
    const running = api.runPreparedReaderWorker(scoped, { ...operation, contextId: 88, sourceModule: "foreign" });
    const request = worker.posted.at(-1);
    expect(request).toMatchObject(operation);
    expect(request.contextId).not.toBe(88);
    expect(request.scope).toEqual({ sourceId: "tab-a", functions: [] });
    expect(request.sourceModule).toBeUndefined();
    const root = { $ref: "Selected" };
    const preview = { root, rows: [{ type: root, description: { type: root }, presentation: { type: root } }], fieldLabels: [] };
    worker.reply(request.id, { preview });
    expect((await running).preview).toBe(preview);
    const controller = new AbortController(), reason = new Error("preview cancelled");
    const cancelled = api.runPreparedReaderWorker(scoped, operation, controller.signal);
    const abandoned = worker.posted.at(-1);
    controller.abort(reason);
    await expect(cancelled).rejects.toBe(reason);
    expect(worker.posted.at(-1)).toEqual({ id: abandoned.id, method: "cancel" });
    worker.reply(abandoned.id, { preview });
    const retired = api.runPreparedReaderWorker(scoped, operation);
    api.discardPreparedAuthoringCatalog(catalog);
    await expect(retired).rejects.toThrow("snapshot changed");
    await expect(api.runPreparedReaderWorker(scoped, operation)).rejects.toThrow("replaced");
    const current = await h.prepare();
    const changed = api.runPreparedReaderWorker(current.handle, operation);
    const pending = current.worker.posted.at(-1);
    h.changeEpoch();
    current.worker.reply(pending.id, { preview });
    await expect(changed).rejects.toThrow("session changed");
    const before = current.worker.posted.length;
    await expect(api.runPreparedReaderWorker(current.handle, operation)).rejects.toThrow("session changed");
    expect(current.worker.posted.length).toBe(before);
  });

  test("equality-bound operations preserve admitted value order before the actual worker post", async () => {
    for (const method of equalityMethods) {
      const h = load(), { api } = h;
      const { worker, handle } = await h.prepare();
      const value = { b: 2, a: 1 };
      const operation = equalityOperation(method, value);
      const pending = api.runPreparedReaderWorker(handle, operation);
      const request = worker.posted.at(-1);
      expect(request.method).toBe(method);
      expect(Object.keys(request.value)).toEqual(["b", "a"]);
      expect(request.value).not.toBe(value);
      if (method === "edit-reader-list-chips") expect(request.action.expected).toBe(request.value);
      else if (method === "edit-reader-record-field") expect(request.edited).toBe(request.value);
      else if (method === "project-reader-record-slots") expect(request.fields).toEqual(["b", "a", "b"]);
      else if (method === "project-reader-field-plan") {
        expect(request.recordValues.sibling).toBe(request.value);
        expect(request.field.meta.retained).toBe(request.value);
        expect(request.field.type).toEqual({ $ref: "Declared" });
      }
      else expect(request.options[0].value).toBe(request.value);
      expect(h.transports.at(-1).mode).toBe("equality");
      expect(h.transports.at(-1).context).toBe("prepared reader worker request");
      worker.reply(request.id, { retained: true });
      await pending;
      for (const malformed of [
        () => { const record = { b: 2, a: 1 }; Object.defineProperty(record, "hidden", { value: 7 }); return record; },
        () => { const array = [1]; Object.defineProperty(array, "hidden", { value: 7 }); return array; },
      ]) {
        const before = worker.posted.length;
        await expect(api.runPreparedReaderWorker(handle, { ...operation, value: malformed() })).rejects.toThrow();
        expect(worker.posted.length).toBe(before);
        expect(h.transports.at(-1).mode).toBe("equality");
      }
    }
  });

  test("ordinary operations keep canonical transport and method accessors cannot bypass equality admission", async () => {
    const h = load(), { api } = h;
    const { worker, handle } = await h.prepare();
    const value = { b: 2, a: 1 };
    Object.defineProperty(value, "hidden", { value: "canonical omission" });
    const array = [1];
    Object.defineProperty(array, "hidden", { value: "canonical omission" });
    const pending = api.runPreparedReaderWorker(handle, { method: "project-reader-metadata", targets: [], value, array });
    const request = worker.posted.at(-1);
    expect(h.transports.at(-1).mode).toBe("canonical");
    expect(Object.keys(request.value)).toEqual(["a", "b"]);
    expect(Object.hasOwn(request.value, "hidden")).toBe(false);
    expect(Object.hasOwn(request.array, "hidden")).toBe(false);
    worker.reply(request.id, { entries: [] });
    await pending;
    let reads = 0;
    const hostile = { value };
    Object.defineProperty(hostile, "method", { enumerable: true, get() { reads++; return "project-reader-choice-selection"; } });
    const before = worker.posted.length;
    await expect(api.runPreparedReaderWorker(handle, hostile)).rejects.toThrow("accessor");
    expect(reads).toBe(0);
    expect(worker.posted.length).toBe(before);
  });

  test("legacy session calls use the same equality capture before posting selection values", async () => {
    const h = load(), { api } = h;
    const { worker, catalog } = await h.prepare();
    const registry = {}, session = { mode: "detached", registry };
    api.attachPreparedAuthoringWorker(registry, catalog, session);
    for (const method of equalityMethods) {
      const value = { b: 2, a: 1 };
      const operation = equalityOperation(method, value);
      const running = api.runAuthoringWorker(session, operation);
      expect(running).toBeDefined();
      const request = worker.posted.at(-1);
      expect(request.method).toBe(method);
      expect(Object.keys(request.value)).toEqual(["b", "a"]);
      expect(h.transports.at(-1).mode).toBe("equality");
      worker.reply(request.id, { retained: true });
      await running;
      const hidden = { b: 2, a: 1 };
      Object.defineProperty(hidden, "hidden", { value: "must not erase" });
      const before = worker.posted.length;
      await expect(api.runAuthoringWorker(session, { ...operation, value: hidden })).rejects.toThrow("non-enumerable");
      expect(worker.posted.length).toBe(before);
    }
    let reads = 0;
    const hostile = { value: { b: 2, a: 1 } };
    Object.defineProperty(hostile, "method", { enumerable: true, get() { reads++; return "project-reader-choice-selection"; } });
    const before = worker.posted.length;
    await expect(api.runAuthoringWorker(session, hostile)).rejects.toThrow("accessor");
    expect(reads).toBe(0);
    expect(worker.posted.length).toBe(before);
  });

  test("committed field and instance metadata operations share base handles, cancellation and same-source retirement fences", async () => {
    for (const operation of [
      { method: "query-reader-field-catalog", query: { search: "scoped label", cursor: "unchanged-cursor", limit: 7 } },
      { method: "query-reader-field-identity", fieldId: "owner-only-field" },
      { method: "query-reader-field-resurrections", target: { ownerKey: "type-owner", ownerKind: "type", storageName: "Stored type" } },
      { method: "query-reader-field-facets" },
      { method: "project-reader-instance-interfaces", priority: "guidance" },
      { method: "project-reader-instance-methods-type", typeName: "Reprable", args: ["JsRuntime", "Bytes"], priority: "guidance" },
    ]) {
      const { api, prepare } = load();
      const { worker, catalog, handle } = await prepare();
      const running = api.runPreparedReaderWorker(handle, { ...operation, contextId: 19,
        sourceModule: "foreign", scope: { sourceId: "another-source", functions: [] } });
      const request = worker.posted.at(-1);
      expect(request).toMatchObject({ ...operation, contextId: 0 });
      expect(request.scope).toBeUndefined();
      expect(request.sourceModule).toBeUndefined();
      worker.reply(request.id, { retained: operation.method });
      expect(await running).toEqual({ retained: operation.method });
      const controller = new AbortController(), reason = new Error("field lookup caller cancelled");
      const cancelled = api.runPreparedReaderWorker(handle, operation, controller.signal);
      const abandoned = worker.posted.at(-1);
      worker.started(abandoned.id);
      controller.abort(reason);
      await expect(cancelled).rejects.toBe(reason);
      expect(worker.posted.at(-1)).toEqual({ id: abandoned.id, method: "cancel" });
      worker.reply(abandoned.id, { ignored: true });
      const retired = api.runPreparedReaderWorker(handle, operation);
      const stale = worker.posted.at(-1);
      api.discardPreparedAuthoringCatalog(catalog);
      await expect(retired).rejects.toThrow("snapshot changed");
      await expect(api.runPreparedReaderWorker(handle, operation)).rejects.toThrow("replaced");
      const current = await prepare();
      const restored = api.runPreparedReaderWorker(current.handle, operation);
      const fresh = current.worker.posted.at(-1);
      worker.reply(stale.id, { wrong: "retired source" });
      current.worker.reply(fresh.id, { retained: "current source" });
      expect(await restored).toEqual({ retained: "current source" });
    }
  });

  test("lightweight presentation batches reuse admitted scopes, cancellation and retirement", async () => {
    const { api, prepare } = load();
    const { worker, catalog, handle } = await prepare();
    const scoped = api.scopePreparedReaderWorker(handle, { sourceId: "tab-a", functions: [{ id: "scoped-fn" }] });
    const batch = { method: "project-reader-presentations", targets: ["first", "missing", "first"] };
    const running = api.runPreparedReaderWorker(scoped, batch);
    const request = worker.posted.at(-1);
    expect(request.method).toBe(batch.method);
    expect(request.targets).toEqual(batch.targets);
    expect(request.scope).toEqual({ sourceId: "tab-a", functions: [{ id: "scoped-fn" }] });
    const result = { presentations: [{ target: "first", presentation: { label: "Scoped" } },
      { target: "missing" }, { target: "first", presentation: { label: "Scoped" } }] };
    worker.reply(request.id, result);
    expect(await running).toEqual(result);
    const controller = new AbortController(), reason = new Error("presentation caller cancelled");
    const cancelled = api.runPreparedReaderWorker(scoped, batch, controller.signal);
    const pending = worker.posted.at(-1);
    controller.abort(reason);
    await expect(cancelled).rejects.toBe(reason);
    expect(worker.posted.at(-1)).toEqual({ id: pending.id, method: "cancel" });
    worker.reply(pending.id, result);
    const retired = api.runPreparedReaderWorker(scoped, batch);
    api.discardPreparedAuthoringCatalog(catalog);
    await expect(retired).rejects.toThrow("snapshot changed");
    await expect(api.runPreparedReaderWorker(scoped, batch)).rejects.toThrow("replaced");
  });

  test("one preparation has one opaque base handle and its exact inert projections", async () => {
    const { api, prepare } = load();
    const first = await prepare(), second = await prepare();
    expect(api.prepareReaderWorkerHandle(first.catalog)).toBe(first.handle);
    expect(first.handle).not.toBe(second.handle);
    expect(Object.isFrozen(first.handle)).toBe(true);
    expect(Reflect.ownKeys(first.handle)).toEqual([]);
    const projected = api.preparedReaderWorkerCatalog(first.handle);
    expect(Object.isFrozen(projected)).toBe(true);
    expect(projected.catalog).toBe(first.catalog);
    expect(projected.displayCatalog).toBe(first.displayCatalog);
    expect(() => api.prepareReaderWorkerHandle({ ...first.catalog })).toThrow("unavailable");
    for (const forged of [{}, structuredClone(first.handle), Object.create(first.handle)]) {
      await expect(api.runPreparedReaderWorker(forged, payload())).rejects.toThrow("unavailable");
    }
  });

  test("runs without a registry/session and refuses control methods or supplied context selection", async () => {
    const { api, prepare } = load();
    const { worker, handle } = await prepare();
    const running = api.runPreparedReaderWorker(handle, { ...payload(), contextId: 99,
      sourceModule: "foreign", scope: { accountId: "foreign", functions: [] } });
    const request = worker.posted.at(-1);
    expect(request.contextId).toBe(0);
    expect(request.sourceModule).toBeUndefined();
    expect(request.scope).toBeUndefined();
    worker.reply(request.id, [{ current: true }]);
    expect(await running).toEqual([{ current: true }]);
    const before = worker.posted.length;
    for (const method of ["initialize", "release", "prepare-repository-registry-step", "prepare-registry-step", "seal-registry-preparation",
      "repository-namespaces", "module-catalog", "cancel", "toString", "__proto__", "unknown"]) {
      await expect(api.runPreparedReaderWorker(handle, { method })).rejects.toThrow("operation is unavailable");
    }
    expect(worker.posted.length).toBe(before);
  });

  test("both public request paths refuse exact-generation controls through base and draft contexts", async () => {
    const h = load(), { api } = h;
    const { worker, catalog, handle } = await h.prepare();
    const initialize = worker.posted[0];
    const registry = {}, base = { mode: "detached", registry }, draft = { mode: "detached", registry };
    api.attachPreparedAuthoringWorker(registry, catalog, base);
    const scope = { sourceId: "tab-a", functions: [{ id: "draft-function" }] };
    h.scopes.set(draft, scope);
    const draftHandle = api.scopePreparedReaderWorker(handle, scope);
    const before = worker.posted.length;
    const forgedControls = [
      { method: "prepare-repository-registry-step", request: { kind: "fields", roots: [], options: {} } },
      { method: "prepare-registry-step", initializationId: initialize.id, localSourceId: initialize.localSourceId,
        request: { kind: "facets", entities: [], identities: [], directives: [] } },
      { method: "seal-registry-preparation", initializationId: initialize.id, localSourceId: initialize.localSourceId },
      { ...initialize, method: "initialize" },
      { method: "release" },
      { method: "__proto__" },
      { method: "toString" },
    ];
    for (const selected of [{ session: base, handle }, { session: draft, handle: draftHandle }]) {
      for (const control of forgedControls) {
        for (const legacy of [false, true]) {
          const pending = legacy ? api.runAuthoringWorker(selected.session, control)
            : api.runPreparedReaderWorker(selected.handle, control);
          // Settle an accidental post so a regression reports an assertion
          // failure instead of waiting for the worker watchdog.
          if (worker.posted.length !== before) worker.reply(worker.posted.at(-1).id, {});
          await expect(pending).rejects.toThrow("operation is unavailable");
          expect(worker.posted.length).toBe(before);
        }
      }
    }
    expect(worker.terminated).toBe(false);
    // Invalid public controls also refuse before trying to find a worker.
    await expect(api.runAuthoringWorker({ mode: "detached", registry: {} }, forgedControls[0])).rejects.toThrow("operation is unavailable");
  });

  test("already bound base/module sessions route before touching their registry", async () => {
    const { api, prepare, workerRevisionReads } = load();
    const { worker, catalog, handle } = await prepare();
    const registry = {}, session = { mode: "detached" };
    let reads = 0;
    Object.defineProperty(session, "registry", { get() { reads++; throw new Error("registry was read"); } });
    api.attachPreparedAuthoringWorker(registry, catalog, session);
    const beforeLookup = workerRevisionReads();
    expect(api.preparedReaderWorkerForSession(session)).toBe(handle);
    expect(workerRevisionReads()).toBe(beforeLookup + 1);
    expect(api.authoringWorkerSnapshot(session)).toBeDefined();
    const running = api.runAuthoringWorker(session, payload());
    worker.reply(worker.posted.at(-1).id, []);
    await running;
    expect(reads).toBe(0);

    const preparingModule = api.prepareModuleCatalogInWorker(registry, "std");
    const moduleCatalog = { marker: "std" };
    worker.reply(worker.posted.at(-1).id, { catalog: moduleCatalog });
    await preparingModule;
    const module = { mode: "module", registry, sourceModule: "std" };
    api.bindModuleAuthoringWorkerSession(module, moduleCatalog);
    Object.defineProperty(module, "registry", { get() { reads++; throw new Error("module registry was read"); } });
    const moduleHandle = api.preparedReaderWorkerForSession(module);
    expect(moduleHandle).not.toBe(handle);
    expect(api.preparedReaderWorkerForSession(module)).toBe(moduleHandle);
    expect(api.preparedReaderWorkerCatalog(moduleHandle).catalog).toBe(moduleCatalog);
    const moduleRun = api.runPreparedReaderWorker(moduleHandle, payload());
    expect(worker.posted.at(-1)).toMatchObject({ contextId: 0, sourceModule: "std" });
    worker.reply(worker.posted.at(-1).id, []);
    await moduleRun;
    expect(reads).toBe(0);
  });

  test("a fresh captured draft gets its own context before its first read; unknown scopes refuse", async () => {
    const { api, prepare, scopes } = load();
    const { worker, catalog, handle } = await prepare();
    const registry = {}, session = { mode: "detached", registry };
    api.attachPreparedAuthoringWorker(registry, catalog, session);
    const draft = { mode: "detached", registry };
    expect(api.preparedReaderWorkerForSession(draft)).toBeUndefined();
    const before = worker.posted.length;
    let reads = 0;
    const lazy = { mode: "detached", get registry() { reads++; throw new Error("cold registry was read"); } };
    expect(api.preparedReaderWorkerForSession(lazy)).toBeUndefined();
    expect(reads).toBe(0);
    expect(worker.posted.length).toBe(before);
    scopes.set(draft, { sourceId: "tab-a", functions: [] });
    const draftHandle = api.preparedReaderWorkerForSession(draft);
    expect(draftHandle).toBeDefined();
    expect(draftHandle).not.toBe(handle);
    expect(worker.posted.length).toBe(before);
    const admitted = api.runPreparedReaderWorker(draftHandle, payload());
    const request = worker.posted.at(-1);
    expect(request.contextId).toBeGreaterThan(0);
    expect(request.scope).toEqual({ sourceId: "tab-a", functions: [] });
    worker.reply(request.id, []);
    await admitted;
    expect(api.preparedReaderWorkerForSession(draft)).toBe(draftHandle);
    const direct = api.runAuthoringWorker(draft, payload());
    expect(worker.posted.at(-1).contextId).toBe(request.contextId);
    expect(worker.posted.at(-1).scope).toBeUndefined();
    worker.reply(worker.posted.at(-1).id, []);
    await direct;
    for (const scope of [{ sourceId: "tab-b", functions: [] }, { accountId: "tab-a", functions: [] }]) {
      const foreign = { mode: "detached", registry };
      scopes.set(foreign, scope);
      expect(api.preparedReaderWorkerForSession(foreign)).toBeUndefined();
    }
  });

  test("captures matching scope data, preserving aliases, Bytes and optional absence", async () => {
    const { api, prepare } = load();
    const { worker, handle } = await prepare();
    const bytes = new Uint8Array([3, 7]);
    const fn = { id: "draft", body: { bytes, outcome: { $tag: "Nothing" } } };
    const scoped = api.scopePreparedReaderWorker(handle, { sourceId: "tab-a", functions: [fn], draft: fn,
      evaluateContext: { inert: "never sent" } });
    fn.id = "mutated"; bytes[0] = 99;
    const run = api.runPreparedReaderWorker(scoped, payload());
    const request = worker.posted.at(-1);
    expect(request.scope.functions[0].id).toBe("draft");
    expect(request.scope.functions[0]).toBe(request.scope.draft);
    expect(request.scope.draft.body.bytes).toEqual(new Uint8Array([3, 7]));
    expect(request.scope.draft.body.outcome).toEqual({ $tag: "Nothing" });
    expect(Object.hasOwn(request.scope, "evaluateContext")).toBe(false);
    worker.reply(request.id, []);
    await run;
    const next = api.scopePreparedReaderWorker(scoped, { sourceId: "tab-a", functions: [] });
    const replaced = api.runPreparedReaderWorker(next, payload());
    expect(worker.posted.at(-1).contextId).not.toBe(request.contextId);
    expect(worker.posted.at(-1).scope.functions).toEqual([]);
    expect(Object.hasOwn(worker.posted.at(-1).scope, "draft")).toBe(false);
    worker.reply(worker.posted.at(-1).id, []);
    await replaced;
  });

  test("coordinate mismatches reject instead of offering another execution path", async () => {
    const { api, prepare } = load();
    const local = await prepare(), account = await prepare({ accountId: "account-a" }), repository = await prepare({ repository: true });
    for (const [handle, scope] of [
      [local.handle, { sourceId: "tab-b", functions: [] }],
      [local.handle, { accountId: "account-a", functions: [] }],
      [account.handle, { accountId: "account-b", functions: [] }],
      [account.handle, { sourceId: "tab-a", functions: [] }],
      [repository.handle, { functions: [] }],
      [repository.handle, { accountId: "", functions: [] }],
      [repository.handle, { sourceId: "", functions: [] }],
    ]) expect(() => api.scopePreparedReaderWorker(handle, scope)).toThrow("does not belong");
    const scoped = api.scopePreparedReaderWorker(account.handle, { accountId: "account-a", functions: [] });
    const run = api.runPreparedReaderWorker(scoped, payload());
    expect(account.worker.posted.at(-1).scope.accountId).toBe("account-a");
    account.worker.reply(account.worker.posted.at(-1).id, []);
    await run;
    expect(local.worker.posted).toHaveLength(1);
    expect(repository.worker.posted).toHaveLength(1);
  });

  test("scope accessors and executable leaves are refused without invoking a getter", async () => {
    const { api, prepare } = load();
    const { worker, handle } = await prepare();
    let reads = 0;
    const getter = { get sourceId() { reads++; return "tab-a"; }, functions: [] };
    const nested = { sourceId: "tab-a", functions: [{ get id() { reads++; return "draft"; } }] };
    for (const scope of [getter, nested]) expect(() => api.scopePreparedReaderWorker(handle, scope)).toThrow("accessor");
    expect(reads).toBe(0);
    for (const invalid of [() => {}, Symbol("x"), new Map(), new Array(1)]) {
      expect(() => api.scopePreparedReaderWorker(handle, { sourceId: "tab-a", functions: [invalid] })).toThrow();
    }
    expect(worker.posted).toHaveLength(1);
  });

  test("evicted contexts resend the exact captured scope once", async () => {
    const { api, prepare } = load();
    const { worker, handle } = await prepare();
    const scoped = api.scopePreparedReaderWorker(handle, { sourceId: "tab-a", functions: [{ id: "draft" }] });
    const first = api.runPreparedReaderWorker(scoped, payload());
    const initial = worker.posted.at(-1);
    worker.reply(initial.id, []);
    await first;
    initial.scope.functions[0].id = "transport-copy-only";
    const retry = api.runPreparedReaderWorker(scoped, payload());
    const absent = worker.posted.at(-1);
    expect(absent.scope).toBeUndefined();
    worker.error(absent.id, "context-missing");
    await settle();
    const retried = worker.posted.at(-1);
    expect(retried.id).not.toBe(absent.id);
    expect(retried.contextId).toBe(initial.contextId);
    expect(retried.scope.functions).toEqual([{ id: "draft" }]);
    worker.reply(retried.id, []);
    await retry;
    const failed = api.runPreparedReaderWorker(scoped, payload());
    worker.error(worker.posted.at(-1).id, "context-missing");
    await settle();
    worker.error(worker.posted.at(-1).id, "context-missing");
    await expect(failed).rejects.toThrow("context unavailable");
  });

  test("retirement refuses exact old handles and sessions after same-registry restoration", async () => {
    const { api, prepare } = load();
    const old = await prepare(), registry = {}, oldSession = { registry, mode: "detached" };
    api.attachPreparedAuthoringWorker(registry, old.catalog, oldSession);
    const pending = api.runPreparedReaderWorker(old.handle, payload());
    const oldRequest = old.worker.posted.at(-1);
    api.discardPreparedAuthoringWorker(registry);
    await expect(pending).rejects.toThrow("replaced");
    const fresh = await prepare(), newSession = { registry, mode: "detached" };
    api.attachPreparedAuthoringWorker(registry, fresh.catalog, newSession);
    expect(() => api.preparedReaderWorkerForSession(oldSession)).toThrow("replaced");
    await expect(api.runAuthoringWorker(oldSession, payload())).rejects.toThrow("replaced");
    await expect(api.runPreparedReaderWorker(old.handle, payload())).rejects.toThrow("replaced");
    expect(() => api.preparedReaderWorkerCatalog(old.handle)).toThrow("replaced");
    expect(api.preparedReaderWorkerForSession(newSession)).toBe(fresh.handle);
    const run = api.runPreparedReaderWorker(fresh.handle, payload());
    const current = fresh.worker.posted.at(-1);
    expect(current.id).toBe(oldRequest.id);
    old.worker.reply(oldRequest.id, [{ stale: true }]);
    fresh.worker.reply(current.id, [{ current: true }]);
    expect(await run).toEqual([{ current: true }]);
  });

  test("a reply followed by retirement before its continuation still refuses", async () => {
    const { api, prepare } = load();
    const { worker, catalog, handle } = await prepare();
    const run = api.runPreparedReaderWorker(handle, payload());
    worker.reply(worker.posted.at(-1).id, [{ retired: true }]);
    // The reply has already removed the pending entry. Disposal alone cannot
    // reject it; the shared completion boundary must check the exact client.
    api.discardPreparedAuthoringCatalog(catalog);
    await expect(run).rejects.toThrow("replaced");
  });

  test("pre-abort avoids hostile payload reads; active abort keeps existing cancellation behavior", async () => {
    const { api, prepare } = load();
    const { worker, handle } = await prepare();
    const stopped = new AbortController(), reason = new Error("caller cancelled");
    stopped.abort(reason);
    let reads = 0;
    const hostile = { get method() { reads++; throw new Error("must not read"); } };
    await expect(api.runPreparedReaderWorker(handle, hostile, stopped.signal)).rejects.toBe(reason);
    expect(reads).toBe(0);
    await expect(api.runPreparedReaderWorker(handle, hostile)).rejects.toThrow("accessor");
    expect(reads).toBe(0);
    const controller = new AbortController();
    const run = api.runPreparedReaderWorker(handle, payload(), controller.signal);
    const request = worker.posted.at(-1);
    worker.started(request.id);
    controller.abort(reason);
    await expect(run).rejects.toBe(reason);
    expect(worker.posted.at(-1)).toEqual({ id: request.id, method: "cancel" });
    worker.reply(request.id, [{ stale: true }]);
    expect(worker.terminated).toBe(false);
  });

  test("epoch changes before dispatch or after a reply refuse the direct operation", async () => {
    const fixture = load(), { api } = fixture;
    const { worker, handle } = await fixture.prepare();
    const run = api.runPreparedReaderWorker(handle, payload());
    fixture.changeEpoch();
    worker.reply(worker.posted.at(-1).id, []);
    await expect(run).rejects.toThrow("session changed");
    const before = worker.posted.length;
    await expect(api.runPreparedReaderWorker(handle, payload())).rejects.toThrow("session changed");
    expect(() => api.scopePreparedReaderWorker(handle, { sourceId: "tab-a", functions: [] })).toThrow("session changed");
    expect(worker.posted.length).toBe(before);
  });

  test("late start delivery does not grant the direct operation a new execution deadline", async () => {
    const { api, prepare, advance } = load();
    const { worker, handle } = await prepare();
    const run = api.runPreparedReaderWorker(handle, payload());
    const request = worker.posted.at(-1);
    advance(120_000);
    worker.started(request.id, 1_000_000_000_000);
    advance(59_999);
    expect(worker.terminated).toBe(false);
    advance(1);
    await expect(run).rejects.toThrow("took too long");
    expect(worker.terminated).toBe(true);
  });
});

describe("Local registry preparation lease on the catalogue client", () => {
  const preparation = () => ({ kind: "facets", entities: [], identities: [], directives: [] });

  test("the initialization callback supplies an opaque owner before completion; only that exact Local source can acquire", async () => {
    const h = load();
    let owner;
    const preparing = h.api.prepareLocalCatalogInWorker("tab-a", { owners: [], fields: [], facets: [] }, [], [], {
      onRegistryPreparation(value) { owner = value; },
    });
    const worker = h.workers[0], initialize = worker.posted[0];
    expect(owner).toBeDefined();
    expect(Object.isFrozen(owner)).toBe(true);
    expect(Reflect.ownKeys(owner)).toEqual([]);
    expect(initialize.method).toBe("initialize");
    expect(() => h.api.acquireLocalRegistryPreparation(owner, "tab-a")).toThrow("no longer available");
    const catalog = {};
    worker.reply(initialize.id, { catalog, displayCatalog: [] });
    await preparing;
    expect(() => h.api.acquireLocalRegistryPreparation({}, "tab-a")).toThrow("owner is unavailable");
    expect(() => h.api.acquireLocalRegistryPreparation(catalog, "tab-a")).toThrow("owner is unavailable");
    expect(() => h.api.acquireLocalRegistryPreparation(owner, "tab-b")).toThrow("Local source");
    const lease = h.api.acquireLocalRegistryPreparation(owner, "tab-a");
    const running = lease.run(preparation());
    const sent = worker.posted.at(-1);
    expect(sent).toEqual({ id: initialize.id + 1, method: "prepare-registry-step", initializationId: initialize.id,
      localSourceId: "tab-a", request: preparation(), build: BUILD });
    const value = { rows: [], byField: new Map() };
    worker.reply(sent.id, { registryPreparation: { ok: true, value, build: BUILD } });
    expect(await running).toBe(value);
    lease.release();
    await expect(lease.run(preparation())).rejects.toThrow("lease is closed");
    expect(worker.terminated).toBe(false);
  });

  test("a catalogue object reused by another initialization never rebinds an older owner", async () => {
    const h = load(), catalog = {};
    const first = await h.prepare({ catalog });
    h.api.discardPreparedReaderWorker(first.handle);
    const second = await h.prepare({ catalog });
    expect(() => h.api.acquireLocalRegistryPreparation(first.preparationOwner, "tab-a")).toThrow("replaced");
    const lease = h.api.acquireLocalRegistryPreparation(second.preparationOwner, "tab-a");
    const running = lease.run(preparation()), sent = second.worker.posted.at(-1);
    expect(first.worker.posted.some(message => message.method === "prepare-registry-step")).toBe(false);
    second.worker.reply(sent.id, { registryPreparation: { ok: true, value: [], build: BUILD } });
    expect(await running).toEqual([]);
    lease.release();
  });

  test("attachment seals every preparation lease and sends one generation-bound control before reader requests", async () => {
    const h = load(), { worker, catalog, preparationOwner, handle } = await h.prepare();
    const lease = h.api.acquireLocalRegistryPreparation(preparationOwner, "tab-a");
    const registry = {}, session = { mode: "detached", registry };
    h.api.attachPreparedAuthoringWorker(registry, catalog, session);
    const seal = worker.posted.at(-1);
    expect(seal).toEqual({ id: worker.posted[0].id + 1, method: "seal-registry-preparation",
      initializationId: worker.posted[0].id, localSourceId: "tab-a" });
    expect(() => h.api.acquireLocalRegistryPreparation(preparationOwner, "tab-a")).toThrow("no longer available");
    await expect(lease.run(preparation())).rejects.toThrow("no longer available");
    h.api.attachPreparedAuthoringWorker(registry, catalog, session);
    expect(worker.posted.at(-1)).toBe(seal);
    const running = h.api.runPreparedReaderWorker(handle, payload()), sent = worker.posted.at(-1);
    expect(sent.id).toBeGreaterThan(seal.id);
    worker.reply(sent.id, { entries: [] });
    expect(await running).toEqual({ entries: [] });
    expect(worker.terminated).toBe(false);
  });

  test("a failed attachment seal refuses attachment and disposes the client", async () => {
    const h = load(), { worker, catalog, preparationOwner } = await h.prepare();
    const lease = h.api.acquireLocalRegistryPreparation(preparationOwner, "tab-a");
    const post = worker.postMessage.bind(worker);
    worker.postMessage = message => {
      if (message.method === "seal-registry-preparation") throw new Error("Closed worker port");
      post(message);
    };
    const registry = {};
    expect(() => h.api.attachPreparedAuthoringWorker(registry, catalog, { registry, mode: "detached" })).toThrow("Closed worker port");
    expect(worker.terminated).toBe(true);
    await expect(lease.run(preparation())).rejects.toThrow("replaced");
  });

  test("aborting one lease cancels only its requests and keeps a running job's watchdog until acknowledgment", async () => {
    const h = load(), { worker, preparationOwner } = await h.prepare();
    const cancelledLease = h.api.acquireLocalRegistryPreparation(preparationOwner, "tab-a");
    const survivingLease = h.api.acquireLocalRegistryPreparation(preparationOwner, "tab-a");
    const cancelled = cancelledLease.run(preparation()), first = worker.posted.at(-1);
    worker.started(first.id);
    const surviving = survivingLease.run(preparation()), second = worker.posted.at(-1);
    const reason = new Error("Abandoned page build");
    cancelledLease.abort(reason);
    await expect(cancelled).rejects.toBe(reason);
    expect(worker.posted.at(-1)).toEqual({ id: first.id, method: "cancel" });
    expect(worker.terminated).toBe(false);
    // An aborted synchronous job still owns its remaining execution budget.
    h.advance(179_999);
    expect(worker.terminated).toBe(false);
    worker.onmessage({ data: { id: first.id, event: "finished" } });
    worker.started(second.id);
    h.advance(2);
    expect(worker.terminated).toBe(false);
    worker.reply(first.id, { registryPreparation: { ok: true, value: ["late"], build: BUILD } });
    worker.reply(second.id, { registryPreparation: { ok: true, value: ["current"], build: BUILD } });
    expect(await surviving).toEqual(["current"]);
    survivingLease.release();
  });

  // borrow-deadline (2026-10-31): a request's own signal abandons only that
  // request (the lease serves the next one), and `started` follows the
  // worker's start ACK of that job, never its post.
  test("a request's own signal abandons only that request; started follows its job's start ACK", async () => {
    const h = load(), { worker, preparationOwner } = await h.prepare();
    const lease = h.api.acquireLocalRegistryPreparation(preparationOwner, "tab-a");
    const starts = [], own = new AbortController();
    const abandoned = lease.run(preparation(), { signal: own.signal, started: () => starts.push("first") });
    const first = worker.posted.at(-1);
    expect(first.method).toBe("prepare-registry-step");
    expect(starts).toEqual([]);
    worker.started(first.id);
    expect(starts).toEqual(["first"]);
    const reason = new Error("The signature borrow passed its deadline.");
    own.abort(reason);
    await expect(abandoned).rejects.toBe(reason);
    expect(worker.posted.at(-1)).toEqual({ id: first.id, method: "cancel" });
    // The lease stays: its next request is posted and answered.
    const queued = new AbortController();
    const next = lease.run(preparation(), { signal: queued.signal, started: () => starts.push("second") });
    const second = worker.posted.at(-1);
    expect(second.method).toBe("prepare-registry-step");
    // A third request abandoned while queued never reports a start.
    const dropped = new AbortController();
    const third = lease.run(preparation(), { signal: dropped.signal, started: () => starts.push("third") });
    const thirdSent = worker.posted.at(-1);
    dropped.abort(new Error("dropped"));
    await expect(third).rejects.toThrow("dropped");
    expect(worker.posted.at(-1)).toEqual({ id: thirdSent.id, method: "cancel" });
    worker.reply(first.id, { registryPreparation: { ok: true, value: ["late"], build: BUILD } });
    worker.onmessage({ data: { id: first.id, event: "finished" } });
    worker.started(second.id);
    worker.started(thirdSent.id);
    expect(starts).toEqual(["first", "second"]);
    worker.reply(second.id, { registryPreparation: { ok: true, value: ["current"], build: BUILD } });
    expect(await next).toEqual(["current"]);
    expect(worker.terminated).toBe(false);
    lease.release();
    await expect(lease.run(preparation())).rejects.toThrow("lease is closed");
  });

  test("the lease's own abort still ends a request that carries its own signal", async () => {
    const h = load(), { worker, preparationOwner } = await h.prepare();
    const lease = h.api.acquireLocalRegistryPreparation(preparationOwner, "tab-a");
    const own = new AbortController();
    const running = lease.run(preparation(), { signal: own.signal }), sent = worker.posted.at(-1);
    const reason = new Error("Abandoned page build");
    lease.abort(reason);
    await expect(running).rejects.toBe(reason);
    expect(worker.posted.at(-1)).toEqual({ id: sent.id, method: "cancel" });
    await expect(lease.run(preparation(), { signal: own.signal })).rejects.toBe(reason);
    expect(worker.posted.at(-1)).toEqual({ id: sent.id, method: "cancel" });
  });

  test("an aborted synchronous preparation still times out if the worker never acknowledges it", async () => {
    const h = load(), { worker, preparationOwner } = await h.prepare();
    const lease = h.api.acquireLocalRegistryPreparation(preparationOwner, "tab-a");
    const running = lease.run(preparation()), sent = worker.posted.at(-1);
    worker.started(sent.id);
    lease.abort(new Error("Cancelled"));
    await expect(running).rejects.toThrow("Cancelled");
    h.advance(180_000);
    expect(worker.terminated).toBe(true);
  });

  test("retirement, attachment and an epoch change after submission prevent a late answer from escaping", async () => {
    for (const ending of ["retire", "attach", "epoch"]) {
      const h = load(), { worker, catalog, preparationOwner, handle } = await h.prepare();
      const lease = h.api.acquireLocalRegistryPreparation(preparationOwner, "tab-a");
      const running = lease.run(preparation()), sent = worker.posted.at(-1);
      if (ending === "retire") h.api.discardPreparedReaderWorker(handle);
      else if (ending === "epoch") h.changeEpoch();
      else { const registry = {}; h.api.attachPreparedAuthoringWorker(registry, catalog, { registry, mode: "detached" }); }
      worker.reply(sent.id, { registryPreparation: { ok: true, value: ["stale"], build: BUILD } });
      await expect(running).rejects.toThrow();
      const before = worker.posted.length;
      await expect(lease.run(preparation())).rejects.toThrow();
      expect(worker.posted.length).toBe(before);
    }
  });

  test("structured diagnostic failures pass intact to the engine's reconstruction boundary", async () => {
    for (const name of ["FieldIdentityKernelError", "FieldFacetProjectionError"]) {
      const h = load(), { worker, preparationOwner } = await h.prepare();
      const lease = h.api.acquireLocalRegistryPreparation(preparationOwner, "tab-a");
      const running = lease.run(preparation()), sent = worker.posted.at(-1);
      const failure = { ok: false, name, message: "Rejected declaration", diagnostic: { code: "conflict", fieldId: "field-1" }, build: BUILD };
      worker.reply(sent.id, { registryPreparation: failure });
      await expect(running).rejects.toBe(h.reconstructedPreparationFailure);
      expect(h.preparationFailures).toEqual([failure]);
      expect(worker.terminated).toBe(false);
      lease.release();
    }
  });

  // L5a-finish: the page refuses an answer that does not name its own build
  // (a worker of another build, or one that predates the check), success or
  // failure alike; the registry then computes that step itself.
  test("an answer of another build never reaches the page build, on either lease", async () => {
    for (const build of ["other-build", undefined, ""]) {
      for (const answer of [{ ok: true, value: ["altered"] },
        { ok: false, name: "FieldFacetProjectionError", message: "Altered refusal", diagnostic: { code: "conflict" } }]) {
        const h = load(), { worker, preparationOwner } = await h.prepare();
        const lease = h.api.acquireLocalRegistryPreparation(preparationOwner, "tab-a");
        const running = lease.run(preparation()), sent = worker.posted.at(-1);
        expect(sent.build).toBe(BUILD);
        worker.reply(sent.id, { registryPreparation: { ...answer, ...(build === undefined ? {} : { build }) } });
        const error = await running.then(() => undefined, caught => caught);
        expect(error?.name).toBe("RegistryPreparationBuildMismatch");
        expect(h.preparationFailures).toEqual([]);
        lease.release();

        const lineage = {};
        h.early.spawnEarlyAuthoringRealm(lineage, 1);
        const early = h.workers.at(-1), earlyLease = h.api.acquireEarlyLocalEnginePreparation();
        const earlyRun = earlyLease.run(preparation()), earlySent = early.posted.at(-1);
        expect(earlySent.build).toBe(BUILD);
        early.reply(earlySent.id, { registryPreparation: { ...answer, ...(build === undefined ? {} : { build }) } });
        const earlyError = await earlyRun.then(() => undefined, caught => caught);
        expect(earlyError?.name).toBe("RegistryPreparationBuildMismatch");
        earlyLease.release();
      }
    }
  });

  test("unreadable preparation envelopes refuse without using another worker", async () => {
    for (const result of [{ entries: [] }, { registryPreparation: null }, { registryPreparation: { ok: "true", value: [] } }]) {
      const h = load(), { worker, preparationOwner } = await h.prepare();
      const lease = h.api.acquireLocalRegistryPreparation(preparationOwner, "tab-a");
      const running = lease.run(preparation()), sent = worker.posted.at(-1);
      worker.reply(sent.id, result);
      await expect(running).rejects.toThrow("could not be read");
      expect(h.workers).toHaveLength(1);
      lease.release();
    }
  });
});

// W1: successive snapshots of one Local holder reuse the realm the previous
// snapshot released. Every lifetime rule below is pinned against today's
// fresh-worker path: refusal of stale requests, failure, session, abort, idle.
describe("warm Local catalogue realm across rebuilds", () => {
  const snapshot = () => ({ owners: [], fields: [], facets: [] });
  async function prepareWarm(h, lineage, { sourceId = "tab-a", signal } = {}) {
    const sent = new Map(h.workers.map(worker => [worker, worker.posted.length]));
    const preparing = h.api.prepareLocalCatalogInWorker(sourceId, snapshot(), [], [], { lineage, ...(signal ? { signal } : {}) });
    // The realm that received this initialization: a new one or the warm one.
    const worker = h.workers.find(candidate => candidate.posted.length > (sent.get(candidate) ?? 0));
    const initialize = worker.posted.at(-1);
    expect(initialize.method).toBe("initialize");
    const catalog = { marker: `catalog-${initialize.id}` };
    worker.reply(initialize.id, { catalog, displayCatalog: [] });
    await preparing;
    return { worker, catalog, initialize, handle: h.api.prepareReaderWorkerHandle(catalog) };
  }

  test("a rebuild reuses the released idle realm and continues its request ids", async () => {
    const h = load(), lineage = {};
    const first = await prepareWarm(h, lineage);
    h.api.discardPreparedReaderWorker(first.handle, { keepRealm: true });
    expect(first.worker.terminated).toBe(false);
    const release = first.worker.posted.at(-1);
    expect(release).toEqual({ id: first.initialize.id + 1, method: "release" });
    const second = await prepareWarm(h, lineage);
    expect(h.workers).toHaveLength(1);
    expect(second.worker).toBe(first.worker);
    expect(second.initialize.id).toBeGreaterThan(release.id);
    expect(second.handle).not.toBe(first.handle);
  });

  test("a request bound to snapshot N refuses once N+1 starts on the same realm, and no late reply crosses", async () => {
    const h = load(), lineage = {};
    const first = await prepareWarm(h, lineage);
    h.api.discardPreparedReaderWorker(first.handle, { keepRealm: true });
    const preparing = h.api.prepareLocalCatalogInWorker("tab-a", snapshot(), [], [], { lineage });
    const initialize = first.worker.posted.at(-1);
    const before = first.worker.posted.length;
    await expect(h.api.runPreparedReaderWorker(first.handle, payload())).rejects.toThrow("replaced");
    expect(() => h.api.scopePreparedReaderWorker(first.handle, { sourceId: "tab-a", functions: [] })).toThrow("replaced");
    expect(first.worker.posted.length).toBe(before);
    // An id from snapshot N cannot resolve snapshot N+1's initialization.
    first.worker.reply(first.initialize.id, { catalog: { stale: true }, displayCatalog: [] });
    const catalog = { marker: "current" };
    first.worker.reply(initialize.id, { catalog, displayCatalog: [] });
    expect(await preparing).toBe(catalog);
  });

  test("a failed N+1 terminates the reused realm; Retry prepares a fresh worker", async () => {
    const h = load(), lineage = {};
    const first = await prepareWarm(h, lineage);
    h.api.discardPreparedReaderWorker(first.handle, { keepRealm: true });
    const failing = h.api.prepareLocalCatalogInWorker("tab-a", snapshot(), [], [], { lineage });
    first.worker.error(first.worker.posted.at(-1).id);
    await expect(failing).rejects.toThrow();
    expect(first.worker.terminated).toBe(true);
    const retry = await prepareWarm(h, lineage);
    expect(h.workers).toHaveLength(2);
    expect(retry.worker).not.toBe(first.worker);
  });

  test("abort and the initialization allowance of N+1 terminate the reused realm", async () => {
    for (const ending of ["abort", "timeout"]) {
      const h = load(), lineage = {};
      const first = await prepareWarm(h, lineage);
      h.api.discardPreparedReaderWorker(first.handle, { keepRealm: true });
      const controller = new AbortController();
      const pending = h.api.prepareLocalCatalogInWorker("tab-a", snapshot(), [], [], { lineage, signal: controller.signal });
      if (ending === "abort") controller.abort(new Error("Cancelled rebuild"));
      else h.advance(h.api.AUTHORING_INITIALIZATION_ALLOWANCE_MS);
      await expect(pending).rejects.toThrow();
      expect(first.worker.terminated).toBe(true);
      await prepareWarm(h, lineage);
      expect(h.workers).toHaveLength(2);
    }
  });

  test("a busy, unprepared or plainly discarded realm is terminated, never kept", async () => {
    const h = load(), lineage = {};
    const busy = await prepareWarm(h, lineage);
    const running = h.api.runPreparedReaderWorker(busy.handle, payload());
    h.api.discardPreparedReaderWorker(busy.handle, { keepRealm: true });
    await expect(running).rejects.toThrow("replaced");
    expect(busy.worker.terminated).toBe(true);
    const plain = await prepareWarm(h, lineage);
    h.api.discardPreparedReaderWorker(plain.handle);
    expect(plain.worker.terminated).toBe(true);
    await prepareWarm(h, lineage);
    expect(h.workers).toHaveLength(3);
  });

  test("another holder or an unowned preparation never takes a warm realm", async () => {
    const h = load(), lineage = {};
    const first = await prepareWarm(h, lineage);
    h.api.discardPreparedReaderWorker(first.handle, { keepRealm: true });
    await prepareWarm(h, {});
    await prepareWarm(h, undefined);
    expect(h.workers).toHaveLength(3);
    expect(first.worker.terminated).toBe(false);
    expect((await prepareWarm(h, lineage)).worker).toBe(first.worker);
  });

  test("session change closes the page preparation worker at once; a holder close only once it is idle", () => {
    const h = load();
    h.api.disposePreparedAuthoringWorkers();
    h.api.discardWarmAuthoringRealm({});
    expect(h.preparationCloses).toEqual(["now", "idle"]);
  });

  test("session change, an epoch change before reuse, holder close and the idle bound terminate a warm realm", async () => {
    for (const ending of ["session", "epoch", "holder", "idle"]) {
      const h = load(), lineage = {};
      const first = await prepareWarm(h, lineage);
      h.api.discardPreparedReaderWorker(first.handle, { keepRealm: true });
      if (ending === "session") h.api.disposePreparedAuthoringWorkers();
      else if (ending === "holder") h.api.discardWarmAuthoringRealm(lineage);
      else if (ending === "idle") {
        h.advance(h.api.WARM_REALM_IDLE_MS - 1);
        expect(first.worker.terminated).toBe(false);
        h.advance(1);
      } else h.changeEpoch();
      if (ending !== "epoch") expect(first.worker.terminated).toBe(true);
      const next = await prepareWarm(h, lineage);
      expect(first.worker.terminated).toBe(true);
      expect(next.worker).not.toBe(first.worker);
    }
  });
});


describe("early Local engine realm", () => {
  const preparation = { kind: "fields", roots: [], options: { mode: "strict-embedded", lock: new Map() } };
  test("one early realm supplies repository steps then initialization with increasing ids", async () => {
    const h = load(), lineage = {};
    h.early.spawnEarlyAuthoringRealm(lineage, 1);
    h.early.spawnEarlyAuthoringRealm(lineage, 1);
    const worker = h.workers[0], lease = h.api.acquireEarlyLocalEnginePreparation();
    const run = lease.run(preparation);
    expect(worker.posted[0].method).toBe("prepare-repository-registry-step");
    expect(worker.posted[0].build).toBe(BUILD);
    worker.reply(worker.posted[0].id, { registryPreparation: { ok: true, value: ["checked"], build: BUILD } });
    expect(await run).toEqual(["checked"]);
    lease.release();
    const initializing = h.api.prepareLocalCatalogInWorker("tab", { owners: [], fields: [], facets: [] }, [], [], { lineage });
    expect(h.workers).toHaveLength(1);
    await settle();
    expect(worker.posted[1].method).toBe("initialize");
    expect(worker.posted[1].id).toBeGreaterThan(worker.posted[0].id);
    worker.reply(worker.posted[1].id, { catalog: {}, displayCatalog: [] });
    await initializing;
    expect(worker.terminated).toBe(false);
    h.early.spawnEarlyAuthoringRealm(lineage, 1);
    expect(h.workers).toHaveLength(1);
  });
  test("abort cancels only the lease; holder close waits for the finished job", async () => {
    const h = load(), lineage = {};
    h.early.spawnEarlyAuthoringRealm(lineage, 1);
    const worker = h.workers[0], lease = h.api.acquireEarlyLocalEnginePreparation();
    const run = lease.run(preparation);
    const rejected = run.catch(error => error);
    const id = worker.posted[0].id;
    worker.started(id);
    lease.abort(new Error("cancelled"));
    expect(await rejected).toBeInstanceOf(Error);
    expect(worker.posted.at(-1)).toEqual({ id, method: "cancel" });
    h.early.discardEarlyAuthoringRealm(lineage);
    expect(worker.terminated).toBe(false);
    worker.onmessage({ data: { id, event: "finished" } });
    expect(worker.terminated).toBe(true);
  });
  test("a held preparation lease reserves one realm until release, then initialization uses it", async () => {
    const h = load(), lineage = {};
    h.early.spawnEarlyAuthoringRealm(lineage, 1);
    const worker = h.workers[0], lease = h.api.acquireEarlyLocalEnginePreparation();
    const initializing = h.api.prepareLocalCatalogInWorker("tab", { owners: [], fields: [], facets: [] }, [], [], { lineage });
    expect(h.workers).toHaveLength(1);
    expect(worker.posted.some(message => message.method === "initialize")).toBe(false);
    expect(h.api.acquireEarlyLocalEnginePreparation()).toBeUndefined();
    lease.release();
    await settle();
    expect(worker.terminated).toBe(false);
    expect(worker.posted[0].method).toBe("initialize");
    worker.reply(worker.posted[0].id, { catalog: {}, displayCatalog: [] });
    await initializing;
    expect(h.workers).toHaveLength(1);
  });
  test("crash rejects the projected step and leaves the next acquisition unavailable", async () => {
    const h = load();
    h.early.spawnEarlyAuthoringRealm({}, 1);
    const worker = h.workers[0], lease = h.api.acquireEarlyLocalEnginePreparation();
    const run = lease.run(preparation), rejected = run.catch(error => error);
    worker.onerror({ message: "crashed" });
    expect(await rejected).toBeInstanceOf(Error);
    expect(h.api.acquireEarlyLocalEnginePreparation()).toBeUndefined();
    expect(worker.terminated).toBe(true);
  });
  test("holder close and session teardown cover workers before client wrapping", () => {
    for (const mode of ["close", "session"]) {
      const h = load(), lineage = {};
      h.early.spawnEarlyAuthoringRealm(lineage, 1);
      const worker = h.workers[0];
      if (mode === "close") h.early.discardEarlyAuthoringRealm(lineage);
      else for (const listener of h.sessionListeners) listener();
      expect(worker.terminated).toBe(true);
      expect(h.early.availableEarlyAuthoringRealm()).toBeUndefined();
    }
  });
  test("session teardown rejects an in-flight early job", async () => {
    const h = load();
    h.early.spawnEarlyAuthoringRealm({}, 1);
    const lease = h.api.acquireEarlyLocalEnginePreparation();
    const run = lease.run(preparation), rejected = run.catch(error => error);
    for (const listener of h.sessionListeners) listener();
    expect(await rejected).toBeInstanceOf(Error);
    expect(h.workers[0].terminated).toBe(true);
  });
});


describe("core demand overlapping initialization", () => {
  test.each(["local", "account"])("%s keeps the initialization budget before its start ACK", async kind => {
    const h = load(), lineage = {};
    const snapshot = { owners: [], fields: [], facets: [] };
    const preparing = kind === "local"
      ? h.api.prepareLocalCatalogInWorker("tab", snapshot, [], [], { lineage })
      : h.api.prepareCatalogInWorker("account", snapshot, [], [], { independent: true, lineage });
    const worker = h.workers[0], initialization = worker.posted[0];
    const borrow = h.early.borrowCoreAuthoringTransport(lineage, 1);
    const core = borrow.suggest("queued"), request = worker.posted.at(-1);
    h.advance(180_000);
    expect(worker.terminated).toBe(false);
    worker.started(initialization.id);
    h.advance(419_999);
    expect(worker.terminated).toBe(false);
    worker.reply(initialization.id, { catalog: {}, displayCatalog: [] }); await preparing;
    worker.started(request.id);
    worker.reply(request.id, { coreValueSuggestion: { input: "queued", suggestions: [] } });
    await core; borrow.dispose();
  });
  test.each(["unsent", "posted", "success"])("%s initialization retirement restores the ordinary queue bound", async ending => {
    const h = load(), transport = h.early.spawnAuthoringTransport(), worker = h.workers[0];
    const abort = new AbortController();
    const initialization = h.physical.reserveAuthoringInitialization(transport, { method: "initialize" }, abort.signal);
    const initialized = initialization.result.catch(error => error);
    if (ending !== "unsent") initialization.post();
    const core = h.physical.requestAuthoringTransport(transport, { method: "core-value-suggestions", input: "queued" });
    const result = core.catch(error => error);
    h.advance(179_999); expect(worker.terminated).toBe(false);
    if (ending === "success") worker.reply(initialization.id, { catalog: {}, displayCatalog: [] });
    else abort.abort(new Error("initialization cancelled"));
    if (ending === "posted") worker.onmessage({ data: { id: initialization.id, event: "finished" } });
    await initialized;
    h.advance(179_999); expect(worker.terminated).toBe(false);
    h.advance(1); expect(await result).toBeInstanceOf(Error); expect(worker.terminated).toBe(true);
  });
  test("a core job that actually starts still has 180 seconds during reserved initialization", async () => {
    const h = load(), transport = h.early.spawnAuthoringTransport(), worker = h.workers[0];
    const initialization = h.physical.reserveAuthoringInitialization(transport, { method: "initialize" });
    const initialized = initialization.result.catch(error => error);
    const core = h.physical.requestAuthoringTransport(transport, { method: "core-value-suggestions", input: "running" });
    const result = core.catch(error => error);
    worker.started(worker.posted.at(-1).id);
    h.advance(179_999); expect(worker.terminated).toBe(false);
    h.advance(1); await initialized;
    expect(await result).toBeInstanceOf(Error); expect(worker.terminated).toBe(true);
  });
});

describe("physical transport settlement", () => {
  const command = { method: "core-value-suggestions", input: "completed" };
  const answer = { coreValueSuggestion: { input: "completed", suggestions: [] } };

  test.each(["close", "abort"])("a completed reply survives synchronous observer %s", async action => {
    const h = load(), transport = h.early.spawnAuthoringTransport(), worker = h.workers[0];
    const cancellation = new AbortController();
    const result = h.physical.requestAuthoringTransport(transport, command, cancellation.signal);
    const id = worker.posted.at(-1).id;
    const observations = [];
    h.physical.observeAuthoringTransport(transport, () => {
      if (transport.jobs.has(id)) return;
      observations.push(transport.pending.has(id));
      if (action === "close") h.physical.closeAuthoringTransport(transport, "observer retired");
      else cancellation.abort(new Error("observer cancelled"));
    });
    worker.reply(id, answer);
    expect(await result).toEqual(answer);
    expect(observations.length).toBeGreaterThan(0);
    expect(observations.every(pending => !pending)).toBe(true);
    expect(worker.posted.some(message => message.method === "cancel")).toBe(false);
    expect(transport.pending.size).toBe(0);
    expect(transport.jobs.size).toBe(0);
  });

  test("a worker refusal keeps its diagnostic when the idle observer closes the transport", async () => {
    const h = load(), transport = h.early.spawnAuthoringTransport(), worker = h.workers[0];
    const result = h.physical.requestAuthoringTransport(transport, command).catch(error => error);
    const id = worker.posted.at(-1).id;
    h.physical.observeAuthoringTransport(transport, () => {
      if (!transport.jobs.size) h.physical.closeAuthoringTransport(transport, "observer retired");
    });
    worker.error(id, "context-missing");
    const error = await result;
    expect(error).toBeInstanceOf(h.physical.WorkerRequestError);
    expect(error.message).toBe("context unavailable");
    expect(error.code).toBe("context-missing");
  });

  test("a failing observer cannot strand a reply or another pending request", async () => {
    const h = load(), transport = h.early.spawnAuthoringTransport(), worker = h.workers[0];
    const first = h.physical.requestAuthoringTransport(transport, command);
    const id = worker.posted.at(-1).id;
    const second = h.physical.requestAuthoringTransport(transport, command).catch(error => error);
    const closed = [];
    h.physical.observeAuthoringTransport(transport, () => { throw new Error("broken observer"); });
    h.physical.observeAuthoringTransport(transport, () => { closed.push(transport.closed); });
    expect(() => worker.reply(id, answer)).not.toThrow();
    expect(await first).toEqual(answer);
    expect(await second).toBeInstanceOf(Error);
    expect(closed).toContain(true);
    expect(worker.terminated).toBe(true);
    expect(transport.pending.size).toBe(0);
    expect(transport.jobs.size).toBe(0);
    expect(transport.changes.size).toBe(0);
  });

  test("a failing reservation observer settles the reserved promise and never posts", async () => {
    const h = load(), transport = h.early.spawnAuthoringTransport(), worker = h.workers[0];
    h.physical.observeAuthoringTransport(transport, () => { throw new Error("reservation observer"); });
    const result = await h.physical.requestAuthoringTransport(transport, command).catch(error => error);
    expect(result).toBeInstanceOf(Error);
    expect(worker.posted).toHaveLength(0);
    expect(worker.terminated).toBe(true);
    expect(transport.pending.size).toBe(0);
    expect(transport.jobs.size).toBe(0);
  });

  test("a synchronous post failure settles before a failing completion observer", async () => {
    const h = load(), transport = h.early.spawnAuthoringTransport(), worker = h.workers[0];
    const failure = new DOMException("uncloneable request", "DataCloneError");
    worker.postMessage = () => { throw failure; };
    h.physical.observeAuthoringTransport(transport, () => {
      if (!transport.jobs.size) throw new Error("completion observer");
    });
    expect(await h.physical.requestAuthoringTransport(transport, command).catch(error => error)).toBe(failure);
    expect(worker.terminated).toBe(true);
    expect(transport.pending.size).toBe(0);
    expect(transport.jobs.size).toBe(0);
  });

  test("an unsent initialization abort settles before a failing completion observer", async () => {
    const h = load(), transport = h.early.spawnAuthoringTransport(), worker = h.workers[0];
    const cancellation = new AbortController(), reason = new Error("cancelled before post");
    const reservation = h.physical.reserveAuthoringInitialization(transport, { method: "initialize" }, cancellation.signal);
    const result = reservation.result.catch(error => error);
    h.physical.observeAuthoringTransport(transport, () => { if (!transport.jobs.size) throw new Error("idle observer"); });
    expect(() => cancellation.abort(reason)).not.toThrow();
    expect(await result).toBe(reason);
    reservation.post();
    expect(worker.posted).toHaveLength(0);
    expect(transport.closed).toBe(true);
    expect(transport.pending.size).toBe(0);
    expect(transport.jobs.size).toBe(0);
  });

  test("failed cancel posting preserves the reader's abort and settles its sibling despite observer failure", async () => {
    const h = load(), transport = h.early.spawnAuthoringTransport(), worker = h.workers[0];
    const cancellation = new AbortController(), reason = new Error("reader cancelled");
    const first = h.physical.requestAuthoringTransport(transport, command, cancellation.signal).catch(error => error);
    const sibling = h.physical.requestAuthoringTransport(transport, command).catch(error => error);
    worker.postMessage = () => { throw new Error("cancel post failed"); };
    let closureObserved = false;
    h.physical.observeAuthoringTransport(transport, () => { throw new Error("closing observer"); });
    h.physical.observeAuthoringTransport(transport, () => { closureObserved = transport.closed; });
    expect(() => cancellation.abort(reason)).not.toThrow();
    expect(await first).toBe(reason);
    expect((await sibling).message).toContain("could not be cancelled");
    expect(closureObserved).toBe(true);
    expect(transport.jobs.size).toBe(0);
    expect(transport.pending.size).toBe(0);
  });

  test("an ordinary clone failure leaves the physical transport reusable", async () => {
    const h = load(), transport = h.early.spawnAuthoringTransport(), worker = h.workers[0];
    const result = await h.physical.requestAuthoringTransport(transport, { ...command, input: () => {} }).catch(error => error);
    expect(result.name).toBe("DataCloneError");
    expect(transport.closed).toBe(false);
    expect(transport.jobs.size).toBe(0);
    expect(transport.pending.size).toBe(0);
    const next = h.physical.requestAuthoringTransport(transport, command);
    worker.reply(worker.posted.at(-1).id, answer);
    expect(await next).toEqual(answer);
    expect(worker.posted.at(-1).id).toBe(2);
    h.advance(600_000);
    expect(transport.closed).toBe(false);
  });

  test.each([null, [], {}, { id: 1, ok: "yes", result: answer }, { id: 1, ok: true },
    { id: 1, ok: false, error: 7 }, { id: 1, event: "unknown" }])("malformed envelope %# refuses and settles the physical owner", async data => {
    const h = load(), transport = h.early.spawnAuthoringTransport(), worker = h.workers[0];
    const result = h.physical.requestAuthoringTransport(transport, command).catch(error => error);
    expect(() => worker.onmessage({ data })).not.toThrow();
    expect(transport.closed).toBe(true);
    expect(await result).toBeInstanceOf(Error);
    expect(transport.pending.size).toBe(0);
    expect(transport.jobs.size).toBe(0);
  });
});

describe("ordinary Local physical owner", () => {
  const command = { method: "run-local-ordinary", operation: { kind: "defaultLocalTabData", args: ["local"] } };
  async function prepare(h, lineage) {
    const flight = h.api.prepareLocalCatalogInWorker("local", { owners: [], fields: [], facets: [] }, [], [], { lineage });
    await settle();
    const worker = h.workers.at(-1), init = worker.posted.findLast(row => row.method === "initialize"), catalog = {};
    worker.reply(init.id, { catalog, displayCatalog: [] });
    await flight;
    return { worker, handle: h.api.prepareReaderWorkerHandle(catalog) };
  }
  test("read-only lookup refuses an absent owner without spawning", () => {
    const h = load();
    expect(h.early.findLocalOrdinaryTransport({}, 1)).toBeUndefined();
    expect(() => h.api.borrowLocalOrdinaryTransport({}, 1)).toThrow("unavailable");
    expect(h.workers).toHaveLength(0);
  });
  test("the same physical token follows early, reserved, prepared and warm ownership", async () => {
    const h = load(), lineage = {}, early = h.early.spawnEarlyAuthoringRealm(lineage, 1);
    expect(h.early.spawnEarlyAuthoringRealm(lineage, 1)).toBe(early);
    const token = h.api.borrowLocalOrdinaryTransport(lineage, 1), core = h.early.borrowCoreAuthoringTransport(lineage, 1);
    token.assertCurrent();
    const first = await prepare(h, lineage);
    token.assertCurrent(); expect(token.transport.worker).toBe(first.worker);
    h.api.discardPreparedReaderWorker(first.handle, { keepRealm: true });
    token.assertCurrent();
    await expect(core.suggest("old reader")).rejects.toThrow("replaced");
    expect(h.api.borrowLocalOrdinaryTransport(lineage, 1).transport).toBe(token.transport);
    const second = await prepare(h, lineage);
    token.assertCurrent(); expect(second.worker).toBe(first.worker); expect(h.workers).toHaveLength(1);
    h.api.discardPreparedReaderWorker(second.handle);
    expect(() => token.assertCurrent()).toThrow("replaced");
  });
  test("explicit initial failure retry is single-use and cannot rearm a live, forged or retired realm", () => {
    const h = load(), lineage = {}, initial = h.early.spawnEarlyAuthoringRealm(lineage, 1);
    expect(h.early.retryEarlyAuthoringRealm(initial)).toBeUndefined();
    initial.transport.worker.onerror({ message: "initial crash" });
    h.early.spawnEarlyAuthoringRealm(lineage, 1); expect(h.workers).toHaveLength(1);
    expect(h.early.retryEarlyAuthoringRealm({ ...initial })).toBeUndefined();
    const recovered = h.early.retryEarlyAuthoringRealm(initial);
    expect(recovered).toBeDefined(); expect(recovered.lineage).toBe(lineage); expect(h.workers).toHaveLength(2);
    expect(h.early.retryEarlyAuthoringRealm(initial)).toBeUndefined();
    h.early.discardEarlyAuthoringRealm(lineage);
    expect(h.early.retryEarlyAuthoringRealm(recovered)).toBeUndefined();
  });
  test("adopted and old-epoch initial tickets cannot rearm", async () => {
    const h = load(), lineage = {}, initial = h.early.spawnEarlyAuthoringRealm(lineage, 1);
    const prepared = await prepare(h, lineage);
    h.api.discardPreparedReaderWorker(prepared.handle);
    expect(h.early.retryEarlyAuthoringRealm(initial)).toBeUndefined();
    const other = h.early.spawnEarlyAuthoringRealm({}, 1);
    other.transport.worker.onerror({ message: "crash" }); h.changeEpoch();
    expect(() => h.early.retryEarlyAuthoringRealm(other)).toThrow("session changed");
  });
  test("a warm ordinary job suspends idle expiry and restarts it only after settlement", async () => {
    const h = load(), lineage = {}, prepared = await prepare(h, lineage);
    h.api.discardPreparedReaderWorker(prepared.handle, { keepRealm: true });
    h.advance(59_000);
    const token = h.api.borrowLocalOrdinaryTransport(lineage, 1);
    const flight = h.physical.requestAuthoringTransport(token.transport, command), id = token.transport.nextId;
    prepared.worker.started(id); h.advance(61_000);
    expect(prepared.worker.terminated).toBe(false); token.assertCurrent();
    prepared.worker.reply(id, { localOrdinary: { operation: command.operation, value: {} } });
    await flight;
    h.advance(59_999); expect(prepared.worker.terminated).toBe(false);
    h.advance(1); expect(prepared.worker.terminated).toBe(true);
  });
  test("warm durable receipt survives reader cancellation and the former idle deadline", async () => {
    const h = load(), lineage = {}, prepared = await prepare(h, lineage);
    h.api.discardPreparedReaderWorker(prepared.handle, { keepRealm: true });
    const token = h.api.borrowLocalOrdinaryTransport(lineage, 1), abort = new AbortController(), seen = [];
    const flight = h.physical.requestAuthoringStorageCommit(token.transport,
      { method: "commit-local-storage", next: { tabId: "local" } }, outcome => seen.push(outcome.status), abort.signal);
    const id = token.transport.nextId, result = flight.result.catch(error => error);
    prepared.worker.started(id); abort.abort(new Error("cancelled reader"));
    await result; h.advance(61_000);
    expect(prepared.worker.terminated).toBe(false); expect(token.transport.storage.size).toBe(1);
    const record = { schema: "fenel.local-data.v1", generation: 1, data: { tabId: "local" } };
    prepared.worker.onmessage({ data: { id, event: "storage-settled", outcome: { status: "committed", record } } });
    expect((await flight.settled).status).toBe("committed"); expect(seen).toEqual(["committed"]);
    h.advance(59_999); expect(prepared.worker.terminated).toBe(false);
    h.advance(1); expect(prepared.worker.terminated).toBe(true);
  });
  test.each(["holder", "session"])("%s retirement drains a warm save before terminating", async ending => {
    const h = load(), lineage = {}, prepared = await prepare(h, lineage);
    h.api.discardPreparedReaderWorker(prepared.handle, { keepRealm: true });
    const token = h.api.borrowLocalOrdinaryTransport(lineage, 1), seen = [];
    const flight = h.physical.requestAuthoringStorageCommit(token.transport,
      { method: "commit-local-storage", next: { tabId: "local" } }, outcome => seen.push(outcome.status));
    const result = flight.result.catch(error => error), id = token.transport.nextId;
    prepared.worker.started(id);
    if (ending === "holder") h.api.discardWarmAuthoringRealm(lineage);
    else { h.changeEpoch(); h.api.disposePreparedAuthoringWorkers(); }
    await result;
    expect(prepared.worker.terminated).toBe(false); expect(token.transport.storage.size).toBe(1);
    prepared.worker.onmessage({ data: { id, event: "storage-settled", outcome: { status: "not-committed", error: "transaction aborted" } } });
    expect((await flight.settled).status).toBe("not-committed"); expect(seen).toEqual(["not-committed"]);
    expect(prepared.worker.terminated).toBe(true);
  });
});

describe("early realm failure and deadline fences", () => {
  const preparation = { kind: "fields", roots: [], options: { mode: "strict-embedded", lock: new Map() } };
  test("failure before client import invalidates the entry permanently for that holder", () => {
    for (const event of ["onerror", "onmessageerror"]) {
      const h = load(), lineage = {};
      h.early.spawnEarlyAuthoringRealm(lineage, 1);
      h.workers[0][event]({ message: "boot failed" });
      h.early.spawnEarlyAuthoringRealm(lineage, 1);
      expect(h.workers).toHaveLength(1);
      expect(h.workers[0].terminated).toBe(true);
      expect(h.api.acquireEarlyLocalEnginePreparation()).toBeUndefined();
    }
  });
  test("boot that never acknowledges a job exhausts the unchanged dispatch allowance", async () => {
    const h = load(), lineage = {};
    h.early.spawnEarlyAuthoringRealm(lineage, 1);
    const worker = h.workers[0], lease = h.api.acquireEarlyLocalEnginePreparation();
    const rejected = lease.run(preparation).catch(error => error);
    h.advance(179_999);
    expect(worker.terminated).toBe(false);
    h.advance(1);
    expect(await rejected).toBeInstanceOf(Error);
    expect(worker.terminated).toBe(true);
    expect(h.api.acquireEarlyLocalEnginePreparation()).toBeUndefined();
    h.early.spawnEarlyAuthoringRealm(lineage, 1);
    expect(h.workers).toHaveLength(1);
  });
  test("release before the last reply still retires a closed holder", async () => {
    const h = load(), lineage = {};
    h.early.spawnEarlyAuthoringRealm(lineage, 1);
    const worker = h.workers[0], lease = h.api.acquireEarlyLocalEnginePreparation();
    const rejected = lease.run(preparation).catch(error => error);
    const id = worker.posted[0].id;
    lease.release();
    h.early.discardEarlyAuthoringRealm(lineage);
    expect(worker.terminated).toBe(false);
    worker.reply(id, { registryPreparation: { ok: true, value: [], build: BUILD } });
    expect(await rejected).toBeInstanceOf(Error);
    expect(worker.terminated).toBe(true);
  });
});
