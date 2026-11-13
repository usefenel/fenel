import { describe, expect, test } from "bun:test";
import { authoringWorkerHostFixtureBindings } from "./authoring-worker-host.fixture";

// C1/C2: the actual host owners and protocol, with a controllable message loop.
// The preserved pre-edit sources provide the deliberately failing policy control.
const source = await Bun.file(new URL(process.env.FENEL_BOUNDED_BASELINE === "1"
  ? "../../../../../../.tmp-diag/bounded-reader-20261103/baseline/authoring-catalog-worker.ts"
  : "./authoring-catalog-worker.ts", import.meta.url)).text();
const code = new Bun.Transpiler({ loader: "ts" }).transformSync(source.replace(/\r\n?/g, "\n")
  .replace(/^import[\s\S]*?;\n/gm, "").replace(/^export \{[^}]*\} from [^;]+;\n/gm, ""))
  .replace(/^export /gm, "");

function harness(zeroGrace = false) {
  let now = 0, epoch = 0;
  const timers = new Set<{ callback: () => void; due: number }>();
  const workers: any[] = [];
  class Worker {
    posted: any[] = []; terminated = false; onmessage: any; onerror: any; onmessageerror: any;
    constructor() { workers.push(this); }
    postMessage(message: any) { this.posted.push(message); }
    terminate() { this.terminated = true; }
    emit(data: any) { this.onmessage?.({ data }); }
    reply(id: number, result: any = {}) { this.emit({ id, ok: true, result }); }
    started(id: number, startedAt = now) { this.emit({ id, event: "started", startedAt }); }
    finished(id: number) { this.emit({ id, event: "finished" }); }
  }
  const bindings: Record<string, any> = {
    Worker, globalThis: {}, performance: { timeOrigin: 0, now: () => now },
    setTimeout: (callback: () => void, delay: number) => { const timer = { callback, due: now + delay }; timers.add(timer); return timer; },
    clearTimeout: (timer: any) => timers.delete(timer),
    createSignal: (initial: any) => { let value = initial; return [() => value, (next: any) => { value = next(value); }]; },
    onBrowserSessionChange: () => () => {}, sessionEpoch: () => epoch,
    assertCurrentSession: (expected: number) => { if (epoch !== expected) throw new Error("The account session changed."); },
    closeRegistryPreparationWorker: () => {}, registerCatalogEntities: () => {}, registerIdentifiedCatalogEntity: () => {},
    prepareEngineBodyDispatch: async () => {}, concreteAuthoringSession: (session: any) => session,
    localAuthoringScopeForSession: () => undefined, installPreparedWorkspaceCatalog: () => {}, accountFieldRegistryState: () => undefined,
    retainCheckedRepositoryNamespaces: () => {}, clearCheckedRepositoryNamespaces: () => {}, markLocalRegistryToken: () => {},
    registryTransportSnapshot: (value: unknown) => structuredClone(value),
    assertReaderSourceMetadata: () => {}, captureReaderSourceMetadata: () => undefined,
    authoringExpressionSourceEntries: () => [], reachedSavedSources: () => [],
  };
  Object.assign(bindings, authoringWorkerHostFixtureBindings(bindings));
  const clientCode = zeroGrace ? code.replace("READER_RETIREMENT_ALLOWANCE_MS = 250", "READER_RETIREMENT_ALLOWANCE_MS = 0") : code;
  const api = new Function(...Object.keys(bindings), `${clientCode}; return {
    prepareLocalCatalogInWorker, prepareCatalogInWorker, attachPreparedAuthoringWorker, discardPreparedReaderWorker,
    preparedReaderWorkerForSession, rankAuthoringSuggestions, runAuthoringWorker, borrowLocalOrdinaryTransport,
    discardWarmAuthoringRealm, disposePreparedAuthoringWorkers, activeClients, byOwner, warmRealms,
  };`)(...Object.values(bindings));
  return { ...api, ...bindings, workers, timers,
    getNow: () => now,
    stall(ms: number) { now += ms; },
    advance(ms: number) {
      const end = now + ms;
      for (;;) {
        const next = [...timers].filter(timer => timer.due <= end).sort((a, b) => a.due - b.due)[0];
        if (!next) break;
        now = next.due; timers.delete(next); next.callback();
      }
      now = end;
    },
    changeSession() { epoch++; api.disposePreparedAuthoringWorkers(); },
  };
}
const tick = async () => { for (let i = 0; i < 12; i++) await Promise.resolve(); };
async function reader(h: ReturnType<typeof harness>) {
  const lineage = {}, registry = {}, session = { registry, mode: "detached" }, catalog = {};
  const ready = h.prepareLocalCatalogInWorker("this-tab", { owners: [], fields: [], facets: [] }, [], [], { lineage });
  const worker = h.workers.at(-1)!;
  worker.reply(worker.posted[0].id, { catalog, displayCatalog: [] });
  h.attachPreparedAuthoringWorker(registry, await ready, session);
  const handle = h.preparedReaderWorkerForSession(session);
  return { lineage, registry, session, worker, handle, client: h.byOwner.get(registry) };
}
function job(h: any, r: any, method = "rank-suggestions") {
  const promise = h.runAuthoringWorker(r.session, method === "rank-suggestions"
    ? { method, entries: [], options: {} } : { method, inputs: [], knownIcons: [] });
  const result = Promise.allSettled([promise]);
  return { result, id: r.worker.posted.at(-1).id };
}
function retire(h: any, r: any) { h.discardPreparedReaderWorker(r.handle, { keepRealm: true }); }
function successor(h: any, r: any, options = {}, snapshot = { owners: [], fields: [], facets: [] }) {
  return h.prepareLocalCatalogInWorker("this-tab", snapshot, [], [], { lineage: r.lineage, ...options });
}

describe("bounded retirement of one permanently closed Local reader", () => {
  for (const completion of ["result", "refusal", "finished", "started-then-finished"]) {
    test(`${completion} physically settles cancellation before same-realm initialization`, async () => {
      const h = harness(), r = await reader(h), old = job(h, r, "project-reader-values");
      const originalDeadline = [...h.timers][0];
      retire(h, r);
      expect(r.client.closed).toBe(true); expect(r.worker.terminated).toBe(false);
      expect(r.client.transport.pending.size).toBe(0); expect(r.client.transport.jobs.size).toBe(1);
      expect([...h.timers]).toContain(originalDeadline);
      const pending = successor(h, r);
      expect(r.worker.posted.filter((x: any) => x.method === "initialize")).toHaveLength(1);
      expect((await old.result)[0].status).toBe("rejected");
      if (completion === "result") r.worker.reply(old.id);
      else if (completion === "refusal") r.worker.emit({ id: old.id, ok: false, error: "obsolete" });
      else { if (completion === "started-then-finished") r.worker.started(old.id); r.worker.finished(old.id); }
      await tick();
      expect(h.workers).toHaveLength(1); expect(r.worker.terminated).toBe(false);
      const initialization = r.worker.posted.at(-1);
      expect(initialization.method).toBe("initialize"); expect(initialization.id).toBeGreaterThan(old.id);
      expect(r.worker.posted.findIndex((x: any) => x.method === "release")).toBeLessThan(r.worker.posted.length - 1);
      r.worker.reply(initialization.id, { catalog: {}, displayCatalog: [] }); await pending;
      h.disposePreparedAuthoringWorkers();
    });
  }

  test("blocked work falls back at 250ms and never reserves initialization during drain", async () => {
    const h = harness(), r = await reader(h); job(h, r); retire(h, r);
    const pending = successor(h, r); h.advance(249);
    expect(h.workers).toHaveLength(1); expect(r.worker.terminated).toBe(false);
    expect([...r.client.transport.jobs.values()].some((x: any) => x.method === "initialize")).toBe(false);
    h.advance(1); await tick(); expect(r.worker.terminated).toBe(true); expect(h.workers).toHaveLength(2);
    const fresh = h.workers[1]; fresh.reply(fresh.posted[0].id, { catalog: {}, displayCatalog: [] }); await pending;
    h.disposePreparedAuthoringWorkers();
  });

  test("all initialization data is captured and exactly one successor owns the wait", async () => {
    const h = harness(), r = await reader(h), old = job(h, r), ids = ["saved"], snapshot: any = { owners: [], fields: [], facets: [] };
    retire(h, r); const pending = successor(h, r, { localValueIds: ids }, snapshot);
    await expect(successor(h, r)).rejects.toThrow("owner");
    ids[0] = "later"; snapshot.owners.push({ id: "later" });
    r.worker.reply(old.id); await tick();
    await expect(successor(h, r)).rejects.toThrow("owner");
    const initialization = r.worker.posted.at(-1);
    expect(initialization.method).toBe("initialize"); expect(initialization.localValueIds).toEqual(["saved"]);
    expect(initialization.snapshot.owners).toEqual([]);
    r.worker.reply(initialization.id, { catalog: {}, displayCatalog: [] }); await pending;
    h.disposePreparedAuthoringWorkers();
  });

  test("mutable direct-call options cannot redirect the claimed holder or reader source", async () => {
    const h = harness(), r = await reader(h), old = job(h, r); retire(h, r);
    const options = { independent: true, lineage: r.lineage, localSourceId: "this-tab" };
    const pending = h.prepareCatalogInWorker(undefined, { owners: [], fields: [], facets: [] }, [], [], options);
    options.lineage = {}; options.localSourceId = "different-tab"; options.independent = false;
    r.worker.reply(old.id); await tick();
    expect(h.workers).toHaveLength(1); const initialization = r.worker.posted.at(-1);
    expect(initialization.localSourceId).toBe("this-tab");
    const preparing = [...h.activeClients].find((client: any) => !client.closed) as any;
    expect(preparing.lineage).toBe(r.lineage); expect(preparing.localSourceId).toBe("this-tab"); expect(preparing.independent).toBe(true);
    r.worker.reply(initialization.id, { catalog: {}, displayCatalog: [] }); await pending;
    h.disposePreparedAuthoringWorkers();
  });

  test("diagnostic work between start receipt and timer setup cannot extend execution", async () => {
    const h = harness(), r = await reader(h); h.globalThis.__fenelAuthoringTimings = true;
    const old = job(h, r); h.performance.measure = () => h.stall(5);
    r.worker.started(old.id, 0);
    expect(r.client.transport.jobs.get(old.id).executionDeadline).toBe(180_000);
    expect([...h.timers].map((timer: any) => timer.due)).toEqual([180_000]);
    h.stall(179_995); r.worker.reply(old.id);
    expect(r.worker.terminated).toBe(true); expect((await old.result)[0].status).toBe("rejected");
  });

  test("initialization execution clock is exactly its reservation deadline", async () => {
    const h = harness(), transport = h.createAuthoringWorkerTransport(new h.Worker(), 0);
    let clockReads = 0; h.performance.now = () => h.getNow() + clockReads++;
    const reservation = h.reserveAuthoringInitialization(transport, { method: "initialize" });
    const job = transport.jobs.get(reservation.id);
    expect(job.executionDeadline).toBe(job.initializationDeadline);
    reservation.post(); h.stall(job.initializationDeadline);
    transport.worker.reply(reservation.id, { catalog: {}, displayCatalog: [] });
    await expect(reservation.result).rejects.toThrow("too long"); expect(transport.closed).toBe(true);
  });

  for (const options of [ { localSourceId: "different" }, { accountId: "account" }, {} ]) {
    test(`incompatible same-holder preparation ${JSON.stringify(options)} cannot bypass retirement`, async () => {
      const h = harness(), r = await reader(h); job(h, r); retire(h, r);
      const pending = h.prepareCatalogInWorker(options.accountId, { owners: [], fields: [], facets: [] }, [], [], {
        independent: true, lineage: r.lineage, localSourceId: options.localSourceId,
      });
      await expect(pending).rejects.toThrow("retiring Local source"); expect(h.workers).toHaveLength(1);
      h.disposePreparedAuthoringWorkers();
    });
  }

  test("zero-grace isolated source control retains immediate busy-worker replacement", async () => {
    const h = harness(true), r = await reader(h); job(h, r); retire(h, r);
    expect(r.worker.terminated).toBe(true); expect(r.client.transport.jobs.size).toBe(0);
    const pending = successor(h, r), fresh = h.workers[1];
    expect(h.workers).toHaveLength(2); fresh.reply(fresh.posted[0].id, { catalog: {}, displayCatalog: [] }); await pending;
    h.disposePreparedAuthoringWorkers();
  });

  test("early-realm namespace preflight preserves its existing physical owner", async () => {
    const h = harness(), lineage = {};
    h.spawnEarlyAuthoringRealm(lineage, 0);
    const pending = h.prepareCatalogInWorker(undefined, { owners: [], fields: [], facets: [] }, [], [], {
      independent: true, localSourceId: "this-tab", lineage,
      sourceModules: [{ id: "source", source: "module Example where" }], onRepositoryNamespaces: () => {},
    });
    expect(h.workers).toHaveLength(1); const worker = h.workers[0];
    expect(worker.posted[0].method).toBe("repository-namespaces");
    worker.reply(worker.posted[0].id, { repositoryNamespaces: [], repositoryEntities: [], identifiedRepositoryEntities: [] });
    await tick(); worker.reply(worker.posted.at(-1).id, { catalog: {}, displayCatalog: [] }); await pending;
    h.disposePreparedAuthoringWorkers();
  });

  test("ordinary borrowing cannot enter between warm release and claimed adoption", async () => {
    const h = harness(), r = await reader(h), before = h.borrowLocalOrdinaryTransport(r.lineage, 0), old = job(h, r);
    retire(h, r); const pending = successor(h, r);
    r.worker.reply(old.id);
    expect(() => h.borrowLocalOrdinaryTransport(r.lineage, 0)).toThrow();
    expect(() => before.assertCurrent()).toThrow();
    await tick(); const initialization = r.worker.posted.at(-1);
    r.worker.reply(initialization.id, { catalog: {}, displayCatalog: [] }); await pending;
    h.disposePreparedAuthoringWorkers();
  });

  for (const kind of ["unowned", "different-reader", "initialization", "ordinary", "preparation", "storage"]) {
    test(`${kind} work refuses reader optimization and keeps existing retirement`, async () => {
      const h = harness(), r = await reader(h); job(h, r);
      if (kind === "initialization") h.reserveAuthoringInitialization(r.client.transport, { method: "initialize" });
      else if (kind === "storage") h.requestAuthoringStorageCommit(r.client.transport, { method: "commit-local-storage" }, () => {});
      else h.requestAuthoringTransport(r.client.transport, { method: kind === "ordinary" ? "run-local-ordinary"
        : kind === "preparation" ? "prepare-registry-step" : "project-reader-values" }, undefined, undefined,
      kind === "different-reader" ? {} : undefined).catch(() => {});
      retire(h, r);
      if (kind === "storage") {
        expect(r.worker.terminated).toBe(false); h.advance(250); expect(r.worker.terminated).toBe(false);
        h.discardWarmAuthoringRealm(r.lineage); h.disposePreparedAuthoringWorkers();
        h.advance(180_000);
      } else expect(r.worker.terminated).toBe(true);
      h.disposePreparedAuthoringWorkers();
    });
  }

  for (const fault of ["crash", "malformed", "observer"]) {
    test(`${fault} settles the physical decision and permits a fresh successor`, async () => {
      const h = harness(), r = await reader(h), old = job(h, r); retire(h, r); const pending = successor(h, r);
      if (fault === "crash") r.worker.onerror({ message: "worker crashed" });
      else if (fault === "malformed") r.worker.emit({ nope: true });
      else { h.observeAuthoringTransport(r.client.transport, () => { throw new Error("observer failed"); }); r.worker.reply(old.id); }
      await tick(); expect(r.worker.terminated).toBe(true); expect(h.workers).toHaveLength(2);
      const fresh = h.workers[1]; fresh.reply(fresh.posted[0].id, { catalog: {}, displayCatalog: [] }); await pending;
      h.disposePreparedAuthoringWorkers();
    });
  }

  for (const stop of ["abort", "holder", "session"]) {
    test(`${stop} closes the claimed drain without an orphan or replacement`, async () => {
      const h = harness(), r = await reader(h), old = job(h, r), controller = new AbortController();
      retire(h, r); const result = Promise.allSettled([successor(h, r, { signal: controller.signal })]);
      if (stop === "abort") controller.abort(new Error("cancel preparation"));
      else if (stop === "holder") h.discardWarmAuthoringRealm(r.lineage);
      else h.changeSession();
      r.worker.reply(old.id); expect((await result)[0].status).toBe("rejected");
      expect(r.worker.terminated).toBe(true); expect(h.workers).toHaveLength(1);
      expect(h.warmRealms.size).toBe(0); expect(h.activeClients.size).toBe(0); expect(h.timers.size).toBe(0);
    });
  }

  test("abort after successful physical park still removes the unadopted warm realm", async () => {
    const h = harness(), r = await reader(h), old = job(h, r), controller = new AbortController();
    retire(h, r); const result = Promise.allSettled([successor(h, r, { signal: controller.signal })]);
    r.worker.reply(old.id); expect(h.warmRealms.size).toBe(1);
    controller.abort(new Error("cancel after park")); expect((await result)[0].status).toBe("rejected");
    expect(r.worker.terminated).toBe(true); expect(h.workers).toHaveLength(1);
    expect(h.warmRealms.size).toBe(0); expect(h.activeClients.size).toBe(0);
  });

  test("session change closes a healthy attached Local reader without throwing during teardown", async () => {
    const h = harness(), r = await reader(h), old = job(h, r);
    expect(() => h.changeSession()).not.toThrow();
    expect((await old.result)[0].status).toBe("rejected"); expect(r.worker.terminated).toBe(true);
    expect(h.activeClients.size).toBe(0); expect(h.timers.size).toBe(0);
  });

  test("session change closes the adopted successor while initialization is preparing", async () => {
    const h = harness(), r = await reader(h), old = job(h, r); retire(h, r);
    const result = Promise.allSettled([successor(h, r)]); r.worker.reply(old.id); await tick();
    expect(r.worker.posted.at(-1).method).toBe("initialize");
    expect(() => h.changeSession()).not.toThrow(); expect((await result)[0].status).toBe("rejected");
    expect(r.worker.terminated).toBe(true); expect(h.activeClients.size).toBe(0); expect(h.timers.size).toBe(0);
  });

  test("physical settlement accepted before cutoff survives a delayed adoption microtask", async () => {
    const h = harness(), r = await reader(h), old = job(h, r); retire(h, r); const pending = successor(h, r);
    h.advance(249); r.worker.reply(old.id); h.stall(2_000); await tick();
    expect(h.workers).toHaveLength(1); expect(r.worker.terminated).toBe(false);
    r.worker.reply(r.worker.posted.at(-1).id, { catalog: {}, displayCatalog: [] }); await pending;
    h.disposePreparedAuthoringWorkers();
  });

  test("the original 179 + 1 second watchdog survives retirement without successor reservation", async () => {
    const h = harness(), r = await reader(h); job(h, r); h.advance(179_000);
    const drained = h.retireAuthoringTransport(r.client.transport, "retiring", () => true, { owner: r.client, allowanceMs: 2_000 });
    expect(() => h.reserveAuthoringInitialization(r.client.transport, { method: "initialize" })).toThrow("retiring");
    h.advance(999); expect(r.worker.terminated).toBe(false);
    h.advance(1); await drained; expect(h.getNow()).toBe(180_000); expect(r.worker.terminated).toBe(true);
    h.disposePreparedAuthoringWorkers();
  });

  for (const clockKind of ["execution", "grace"]) {
    for (const message of ["result", "refusal", "started", "finished"]) {
      test(`delayed ${message} cannot settle after the ${clockKind} cutoff before timers run`, async () => {
        const h = harness(), r = await reader(h), old = job(h, r);
        if (clockKind === "execution") { r.worker.started(old.id); h.advance(179_999); }
        retire(h, r); const pending = successor(h, r); h.stall(clockKind === "execution" ? 1 : 250);
        if (message === "result") r.worker.reply(old.id);
        else if (message === "refusal") r.worker.emit({ id: old.id, ok: false, error: "late refusal" });
        else if (message === "started") r.worker.started(old.id);
        else r.worker.finished(old.id);
        expect(r.worker.terminated).toBe(true); await tick();
        const fresh = h.workers[1]; fresh.reply(fresh.posted[0].id, { catalog: {}, displayCatalog: [] }); await pending;
        h.disposePreparedAuthoringWorkers();
      });
    }
  }

  test("delayed start tightens retirement to its original execution deadline", async () => {
    const h = harness(), r = await reader(h), old = job(h, r); h.advance(179_900);
    retire(h, r); const pending = successor(h, r); r.worker.started(old.id, 0);
    h.advance(99); expect(r.worker.terminated).toBe(false); h.advance(1);
    expect(r.worker.terminated).toBe(true); await tick();
    const fresh = h.workers[1]; fresh.reply(fresh.posted[0].id, { catalog: {}, displayCatalog: [] }); await pending;
    h.disposePreparedAuthoringWorkers();
  });

  test("a context-missing response queued before retirement cannot retry a closed reader", async () => {
    const h = harness(), r = await reader(h), context = r.client.contexts.get(r.session);
    context.scope = { sourceId: "this-tab" };
    const old = job(h, r), posted = r.worker.posted.length;
    r.worker.emit({ id: old.id, ok: false, error: "context missing", code: "context-missing" });
    retire(h, r); expect((await old.result)[0].status).toBe("rejected");
    expect(r.worker.posted.filter((x: any) => x.method === "rank-suggestions")).toHaveLength(1);
    expect(r.worker.posted.length).toBe(posted + 1); h.disposePreparedAuthoringWorkers();
  });

  test("namespace preflight terminates an overlapping drain before fresh preparation", async () => {
    const h = harness(), r = await reader(h); job(h, r); retire(h, r);
    const pending = h.prepareCatalogInWorker(undefined, { owners: [], fields: [], facets: [] }, [], [], {
      independent: true, localSourceId: "this-tab", lineage: r.lineage,
      sourceModules: [{ id: "source", source: "module Example where" }], onRepositoryNamespaces: () => {},
    });
    await tick(); expect(r.worker.terminated).toBe(true); expect(h.workers).toHaveLength(2);
    const fresh = h.workers[1]; expect(fresh.posted[0].method).toBe("repository-namespaces");
    fresh.reply(fresh.posted[0].id, { repositoryNamespaces: [], repositoryEntities: [], identifiedRepositoryEntities: [] });
    await tick(); fresh.reply(fresh.posted.at(-1).id, { catalog: {}, displayCatalog: [] }); await pending;
    h.disposePreparedAuthoringWorkers();
  });

  for (const message of ["result", "refusal", "started", "finished"]) {
    test(`an expired delayed ${message} cannot defeat the original dispatch deadline (179 + 1)`, async () => {
      const h = harness(), r = await reader(h), old = job(h, r);
      h.advance(179_999); retire(h, r); const pending = successor(h, r);
      expect(r.worker.terminated).toBe(false);
      expect([...r.client.transport.jobs.values()].some((x: any) => x.method === "initialize")).toBe(false);
      h.stall(1);
      if (message === "result") r.worker.reply(old.id);
      else if (message === "refusal") r.worker.emit({ id: old.id, ok: false, error: "late refusal" });
      else if (message === "started") r.worker.started(old.id, 179_999);
      else r.worker.finished(old.id);
      expect(r.worker.terminated).toBe(true); await tick();
      const fresh = h.workers[1]; fresh.reply(fresh.posted[0].id, { catalog: {}, displayCatalog: [] }); await pending;
      h.disposePreparedAuthoringWorkers();
    });
  }
});
