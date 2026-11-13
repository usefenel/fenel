import { authoringWorkerHostFixtureBindings } from "./authoring-worker-host.fixture";
import { describe, expect, test } from "bun:test";
import { Worker as ThreadWorker } from "node:worker_threads";
import { createSignal, flush } from "../../../node_modules/solid-js/dist/solid.dev.js";

// C1/C2: run the production browser client and detached Retry lifecycle against
// real isolated threads. Registry/catalogue results are inert transport fixtures;
// the blocked synchronous loop is deliberately unable to receive cancellation.
const source = await Bun.file(new URL("./authoring-catalog-worker.ts", import.meta.url)).text();
const sessions = await Bun.file(new URL("./authoring-session.ts", import.meta.url)).text();
const transpiler = new Bun.Transpiler({ loader: "ts" });
const clientCode = transpiler.transformSync(source.replace(/^import[\s\S]*?;\r?\n/gm, "")
  .replace(/^export \{[^}]*\} from [^;]+;\r?\n/gm, ""))
  .replace(/^export /gm, "").replaceAll("import.meta.url", '"https://fixture.test/client.js"');
const sessionStart = sessions.indexOf("function detachedSessionForRegistry(");
const sessionEnd = sessions.indexOf("const moduleSessions", sessionStart);
if (sessionStart < 0 || sessionEnd < 0) throw new Error("Detached session boundary changed");
const sessionCode = transpiler.transformSync(`
let detachedSessionCache, detachedSessionPreparation, detachedRepositoryPreparation;
const registrySessions = new WeakMap(), detachedPreparedCatalogs = new WeakMap();
${sessions.slice(sessionStart, sessionEnd)}
`).replace(/^export /gm, "");
const timeoutMessage = "The operation took too long. Try again with less data.";
const unreadableMessage = "The authoring worker response could not be read.";
const clockOrigin = 1_000_000_000_000;
const workerCode = `
const { parentPort, workerData } = require("node:worker_threads");
const heartbeat = new Int32Array(workerData.heartbeat);
const clock = new Int32Array(workerData.clock);
const performance = { timeOrigin: workerData.timeOrigin, now: () => Atomics.load(clock, 0) };
const queue = [], held = new Map();
let active;
const lifecycle = (id, event) => parentPort.postMessage(event === "started"
  ? { id, event, startedAt: performance.timeOrigin + performance.now() } : { id, event });
const reply = (id, result) => parentPort.postMessage({ id, ok: true, result });
const block = id => {
  Atomics.add(heartbeat, 0, 1);
  parentPort.postMessage({ fixture: "blocked", id });
  while (true) Atomics.add(heartbeat, 0, 1);
};
const complete = (id, result, error) => {
  const message = held.get(id);
  if (!message) throw new Error("No held fixture job " + id);
  held.delete(id);
  if (error) parentPort.postMessage({ id, ok: false, error });
  else reply(id, { result, trace: [] });
  // Deliberately no separate finished event: final responses finish a job.
  if (active?.id === id) { active = undefined; pump(); }
};
const run = message => {
  const value = message.node?.value;
  if (value === "prestart-stall") {
    parentPort.postMessage({ fixture: "unstarted", id: message.id });
    return;
  }
  lifecycle(message.id, "started");
  if (value === "block") return block(message.id);
  if (value === "hold" || value?.fixture === "fifo" || value?.fixture === "parallel") {
    held.set(message.id, message);
    parentPort.postMessage({ fixture: "holding", id: message.id, label: value?.label });
    return;
  }
  reply(message.id, { result: value, trace: [] });
  if (active?.id === message.id) { active = undefined; pump(); }
};
const pump = () => {
  if (active || !queue.length) return;
  active = queue.shift();
  run(active);
};
parentPort.on("message", message => {
  if (message.fixtureCommand) {
    if (message.fixtureCommand === "complete") complete(message.id, message.result, message.error);
    else if (message.fixtureCommand === "emit") lifecycle(message.id, message.event);
    else if (message.fixtureCommand === "emit-raw") parentPort.postMessage(message.data);
    parentPort.postMessage({ fixture: "ack", token: message.token });
    return;
  }
  if (message.method === "initialize") {
    if (workerData.delayInitialization) {
      parentPort.postMessage({ fixture: "initializing", id: message.id });
      return;
    }
    lifecycle(message.id, "started");
    if (workerData.blockInitialization) return block(message.id);
    return reply(message.id, { catalog: { types: [], functions: [], capabilities: [],
      catalogTypes: [], operatorCodeNameByNotation: new Map() }, displayCatalog: [] });
  }
  if (message.method === "cancel") {
    const index = queue.findIndex(job => job.id === message.id);
    if (index >= 0) queue.splice(index, 1);
    held.delete(message.id);
    lifecycle(message.id, "finished");
    parentPort.postMessage({ fixture: "cancelled", id: message.id });
    if (active?.id === message.id) { active = undefined; pump(); }
    return;
  }
  // A parked asynchronous RPC can coexist with another active RPC. FIFO jobs
  // instead wait for a controlled real-thread completion before starting.
  if (message.node?.value?.fixture === "parallel") return run(message);
  queue.push(message);
  pump();
});
`;

function trackedController() {
  const controller = new AbortController(), listeners = new Set();
  const { signal } = controller;
  const add = signal.addEventListener.bind(signal), remove = signal.removeEventListener.bind(signal);
  signal.addEventListener = (kind, callback, options) => {
    if (kind === "abort") listeners.add(callback);
    return add(kind, callback, options);
  };
  signal.removeEventListener = (kind, callback, options) => {
    if (kind === "abort") listeners.delete(callback);
    return remove(kind, callback, options);
  };
  return { controller, signal, listeners };
}

function harness({ blockFirstInitialization = false, delayFirstInitialization = false,
  holdStartedAcknowledgments = false } = {}) {
  const workers = [], deadlines = new Set(), deadlineHistory = [];
  const clock = new Int32Array(new SharedArrayBuffer(4));
  let registryBuilds = 0, now = 0, timerOrder = 0;
  const registry = {};
  class BrowserWorker {
    constructor() {
      this.sent = [];
      this.messages = [];
      this.waiters = [];
      this.delayedStarts = new Map();
      this.observedStarts = new Set();
      this.nextControl = 0;
      this.terminationCalls = 0;
      this.heartbeat = new Int32Array(new SharedArrayBuffer(4));
      this.blocked = this.waitFor(data => data.fixture === "blocked").then(data => data.id);
      this.holding = this.waitFor(data => data.fixture === "holding").then(data => data.id);
      this.cancelled = this.waitFor(data => data.fixture === "cancelled").then(data => data.id);
      this.thread = new ThreadWorker(workerCode, { eval: true, workerData: {
        heartbeat: this.heartbeat.buffer,
        clock: clock.buffer, timeOrigin: clockOrigin,
        blockInitialization: blockFirstInitialization && workers.length === 0,
        delayInitialization: delayFirstInitialization && workers.length === 0,
      } });
      this.exited = new Promise(resolve => this.thread.once("exit", resolve));
      this.thread.on("message", data => {
        this.messages.push(data);
        const firstStart = data.event === "started" && !this.observedStarts.has(data.id);
        if (data.event === "started") this.observedStarts.add(data.id);
        if (holdStartedAcknowledgments && firstStart
          && this.sent.find(message => message.id === data.id)?.method !== "initialize") {
          // Capture the actual thread's original timestamp, delaying only its
          // delivery to the browser client, as a busy browser event loop can.
          this.delayedStarts.set(data.id, data);
        } else if (!data.fixture) this.onmessage?.({ data });
        for (const waiter of [...this.waiters]) {
          if (!waiter.matches(data)) continue;
          this.waiters.splice(this.waiters.indexOf(waiter), 1);
          waiter.resolve(data);
        }
      });
      this.thread.on("error", error => this.onerror?.({ message: error.message }));
      workers.push(this);
    }
    waitFor(matches) {
      const previous = this.messages.find(matches);
      return previous ? Promise.resolve(previous)
        : new Promise(resolve => this.waiters.push({ matches, resolve }));
    }
    async control(fixtureCommand, values) {
      const token = ++this.nextControl;
      this.postMessage({ fixtureCommand, ...values, token });
      await this.waitFor(data => data.fixture === "ack" && data.token === token);
    }
    complete(id, result, error) { return this.control("complete", { id, result, error }); }
    emit(id, event) { return this.control("emit", { id, event }); }
    emitStarted(id, startedAt, omitStamp = false) {
      const data = { id, event: "started", ...(!omitStamp ? { startedAt } : {}) };
      this.postMessage({ fixtureCommand: "emit-raw", data, token: ++this.nextControl });
      // A rejected event can terminate its thread before a subsequent ack.
      // Resolve from the event after the real client has already consumed it.
      return this.waitFor(message => message.id === id && message.event === "started"
        && Object.hasOwn(message, "startedAt") === !omitStamp && Object.is(message.startedAt, startedAt));
    }
    deliverStarted(id) {
      const data = this.delayedStarts.get(id);
      if (!data) throw new Error("No delayed fixture start " + id);
      this.delayedStarts.delete(id);
      this.onmessage?.({ data });
      return data;
    }
    postMessage(message) { this.sent.push(message); this.thread.postMessage(message); }
    terminate() { this.terminationCalls++; void this.thread.terminate(); }
  }
  const bindings = {
    Worker: BrowserWorker, createSignal, concreteAuthoringSession: session => session,
    spawnAuthoringWorker: () => new BrowserWorker(),
    localAuthoringScopeForSession: () => undefined,
    clearCheckedRepositoryNamespaces: () => {}, retainCheckedRepositoryNamespaces: () => {},
    sessionEpoch: () => 1, assertCurrentSession: epoch => { expect(epoch).toBe(1); },
    onBrowserSessionChange: () => {}, closeRegistryPreparationWorker: () => {}, installPreparedWorkspaceCatalog: () => {},
    accountFieldRegistryState: () => undefined,
    performance: { timeOrigin: clockOrigin, now: () => Atomics.load(clock, 0) },
    setTimeout: (callback, delay) => {
      const deadline = { callback, delay, due: now + delay, order: ++timerOrder };
      deadlines.add(deadline); deadlineHistory.push(deadline); return deadline;
    },
    clearTimeout: deadline => deadlines.delete(deadline),
  };
  Object.assign(bindings, authoringWorkerHostFixtureBindings(bindings));
  const api = new Function(...Object.keys(bindings), `${clientCode}; return {
    prepareCatalogInWorker, prepareRepositoryCatalogInWorker, attachPreparedAuthoringWorker,
    discardPreparedAuthoringCatalog,
    authoringWorkerSnapshot, runAuthoringWorker, prepareModuleCatalogInWorker, disposePreparedAuthoringWorkers,
    activeClients, byOwner, byCatalog, revision: workerRevision };`)(...Object.values(bindings));
  const sessionBindings = {
    ...api, Worker: BrowserWorker, registerAuthoringSessionFacade: () => {},
    createRepositoryRegistryAsync: async () => { registryBuilds++; return registry; },
    createRepositoryRegistry: () => { throw new Error("No synchronous registry fallback"); },
    modulesFor: () => [], dispatchRegistry: {}, withinWorkspaceLimit: (_stage, load) => load(),
    browserEvaluateContext: () => ({}), catalogFor: () => { throw new Error("No synchronous catalogue fallback"); },
    environmentFor: catalog => ({ catalog }), createDetachedAuthoringEnvironment: value => value,
  };
  const sessionApi = new Function(...Object.keys(sessionBindings), `${sessionCode}; return {
    prepareDetachedAuthoringSession };`)(...Object.values(sessionBindings));
  const setClock = milliseconds => { now = milliseconds; Atomics.store(clock, 0, milliseconds); };
  const nextDeadline = () => [...deadlines].sort((a, b) => a.due - b.due || a.order - b.order)[0];
  const advance = milliseconds => {
    const target = now + milliseconds;
    let fired = 0;
    for (let deadline; (deadline = nextDeadline()) && deadline.due <= target;) {
      if (++fired > 1_000) throw new Error("Fixture timer did not settle");
      deadlines.delete(deadline);
      setClock(Math.max(now, deadline.due));
      deadline.callback();
    }
    setClock(target);
  };
  return { ...api, ...sessionApi, workers, deadlines, deadlineHistory, registryBuilds: () => registryBuilds,
    advance, now: () => now,
    // A blocked browser event loop cannot service already-due timers or worker
    // messages. Tests explicitly choose which queued message arrives first.
    stallMainThread: milliseconds => setClock(now + milliseconds),
    evaluate: (session, value, signal) => api.runAuthoringWorker(session,
      { method: "evaluate-expression", node: { kind: "literal", value }, savedExpressions: [] }, signal),
    expire: (delay = 180_000) => {
      const deadline = nextDeadline();
      expect(deadline?.delay).toBe(delay);
      advance(Math.max(0, deadline.due - now));
      return deadline;
    },
    close: async () => {
      api.disposePreparedAuthoringWorkers();
      await Promise.all(workers.map(worker => worker.exited));
    },
  };
}

describe("authoring worker deadline retirement and recovery", () => {
  test("a timed-out synchronous worker stops, settles siblings and Retry gets a fresh worker", async () => {
    const h = harness();
    try {
      const session = await h.prepareDetachedAuthoringSession(), worker = h.workers[0];
      const catalog = session.catalog, client = h.byOwner.get(session.registry);
      const token = h.authoringWorkerSnapshot(session);
      const healthyRegistry = {}, healthySession = { mode: "detached", registry: healthyRegistry };
      const healthyCatalog = await h.prepareRepositoryCatalogInWorker();
      h.attachPreparedAuthoringWorker(healthyRegistry, healthyCatalog, healthySession);
      const healthyWorker = h.workers[1];
      const healthyToken = h.authoringWorkerSnapshot(healthySession);
      flush();
      const revision = h.revision();
      const first = trackedController(), sibling = trackedController(), module = trackedController();
      const blocked = h.evaluate(session, "block", first.signal);
      const blockedId = await worker.blocked;
      expect(Atomics.load(worker.heartbeat, 0)).not.toBe(0);
      const queued = h.evaluate(session, "queued", sibling.signal);
      const moduleJob = h.prepareModuleCatalogInWorker(session.registry, "fixture", module.signal);
      const results = Promise.allSettled([blocked, queued, moduleJob]);
      expect(client.transport.pending.size).toBe(3);
      expect([first, sibling, module].map(value => value.listeners.size)).toEqual([1, 1, 1]);
      const expired = h.expire();
      expect((await results).map(result => [result.status, result.reason?.message]))
        .toEqual(Array.from({ length: 3 }, () => ["rejected", timeoutMessage]));
      expect(client.closed).toBe(true);
      expect(client.transport.pending.size).toBe(0);
      expect(h.activeClients.has(client)).toBe(false);
      expect(h.activeClients.size).toBe(1);
      expect(h.deadlines.size).toBe(0);
      expect([first, sibling, module].map(value => value.listeners.size)).toEqual([0, 0, 0]);
      expect(worker.terminationCalls).toBe(1);
      expect(worker.sent.some(message => message.method === "cancel")).toBe(false);
      await worker.exited;
      expect(worker.thread.threadId).toBe(-1);
      const stopped = Atomics.load(worker.heartbeat, 0);
      expect(() => h.authoringWorkerSnapshot(session)).toThrow("snapshot was replaced");
      expect(() => h.attachPreparedAuthoringWorker({}, catalog, session)).toThrow("unavailable");
      await expect(h.evaluate(session, "stale")).rejects.toThrow("snapshot was replaced");
      worker.onmessage?.({ data: { id: blockedId, ok: true, result: { result: "late", trace: [] } } });
      worker.onmessage?.({ data: { id: blockedId, event: "started" } });
      worker.onmessage?.({ data: { id: blockedId, event: "finished" } });
      expect(client.transport.pending.size).toBe(0);
      expect(client.transport.jobs.size).toBe(0);
      expect(h.deadlines.size).toBe(0);
      flush();
      expect(h.revision()).toBe(revision + 1);
      expect(healthyWorker.terminationCalls).toBe(0);
      expect(h.authoringWorkerSnapshot(healthySession)).toBe(healthyToken);
      expect(await h.evaluate(healthySession, "unrelated reader")).toEqual({ result: "unrelated reader", trace: [] });
      const retried = await h.prepareDetachedAuthoringSession();
      expect(retried).toBe(session);
      expect(h.registryBuilds()).toBe(1);
      expect(h.workers).toHaveLength(3);
      expect(h.authoringWorkerSnapshot(retried)).not.toBe(token);
      expired.callback();
      expect(await h.evaluate(retried, "fresh")).toEqual({ result: "fresh", trace: [] });
      expect(Atomics.load(worker.heartbeat, 0)).toBe(stopped);
      expect(h.byOwner.get(retried.registry)).not.toBe(client);
      expect(h.workers[2].terminationCalls).toBe(0);
    } finally { await h.close(); }
  }, 10_000);

  test("initialization timeout removes its preparation listener and permits a fresh preparation", async () => {
    const h = harness({ blockFirstInitialization: true }), preparation = trackedController();
    try {
      const pending = h.prepareCatalogInWorker(undefined, { owners: [], fields: [], facets: [] }, [], [],
        { independent: true, signal: preparation.signal });
      const result = Promise.allSettled([pending]), worker = h.workers[0];
      await worker.blocked;
      expect(preparation.listeners.size).toBe(1);
      h.expire(600_000);
      expect((await result)[0]).toMatchObject({ status: "rejected", reason: { message: timeoutMessage } });
      await worker.exited;
      expect(worker.thread.threadId).toBe(-1);
      expect(worker.terminationCalls).toBe(1);
      expect(preparation.listeners.size).toBe(0);
      expect(h.deadlines.size).toBe(0);
      expect(h.activeClients.size).toBe(0);
      const next = trackedController();
      const catalog = await h.prepareCatalogInWorker(undefined, { owners: [], fields: [], facets: [] }, [], [],
        { independent: true, signal: next.signal });
      const registry = {}, session = { mode: "detached", registry };
      expect(next.listeners.size).toBe(1);
      h.attachPreparedAuthoringWorker(registry, catalog, session);
      expect(next.listeners.size).toBe(0);
      next.controller.abort(new Error("Preparation owner released after attachment"));
      expect(await h.evaluate(session, "recovered initialization")).toEqual({ result: "recovered initialization", trace: [] });
    } finally { await h.close(); }
  }, 10_000);

  test("ordinary cancellation and completed deadlines retain their live worker", async () => {
    const h = harness(), cancellation = trackedController();
    try {
      const session = await h.prepareDetachedAuthoringSession(), worker = h.workers[0];
      const token = h.authoringWorkerSnapshot(session);
      const pending = h.evaluate(session, "hold", cancellation.signal);
      const result = Promise.allSettled([pending]);
      const heldId = await worker.holding;
      const oldDeadline = h.deadlineHistory.at(-1);
      cancellation.controller.abort(new Error("Editor closed"));
      expect((await result)[0]).toMatchObject({ status: "rejected", reason: { message: "Editor closed" } });
      expect(await worker.cancelled).toBe(heldId);
      expect(cancellation.listeners.size).toBe(0);
      expect(h.deadlines.size).toBe(0);
      oldDeadline.callback();
      expect(await h.evaluate(session, "after cancellation")).toEqual({ result: "after cancellation", trace: [] });
      expect(h.deadlines.size).toBe(0);
      h.deadlineHistory.at(-1).callback();
      expect(h.authoringWorkerSnapshot(session)).toBe(token);
      expect(h.byOwner.get(session.registry).closed).toBe(false);
      expect(worker.terminationCalls).toBe(0);
      expect(worker.sent.filter(message => message.method === "cancel").map(message => message.id)).toEqual([heldId]);
    } finally { await h.close(); }
  }, 10_000);

  test("initialization's first started acknowledgment does not reset its submission deadline", async () => {
    const h = harness({ delayFirstInitialization: true });
    try {
      const results = Promise.allSettled([h.prepareCatalogInWorker(undefined,
        { owners: [], fields: [], facets: [] }, [], [], { independent: true })]);
      const worker = h.workers[0];
      const { id } = await worker.waitFor(data => data.fixture === "initializing");
      h.advance(120_000);
      await worker.emit(id, "started");
      h.advance(479_999);
      expect(worker.terminationCalls).toBe(0);
      h.advance(1);
      expect((await results)[0]).toMatchObject({ status: "rejected", reason: { message: timeoutMessage } });
      expect(h.now()).toBe(600_000);
      await worker.exited;
      expect(worker.terminationCalls).toBe(1);
      expect(h.deadlines.size).toBe(0);
    } finally { await h.close(); }
  }, 10_000);

  test("a bounded future initialization start preserves the original 600 second submission deadline", async () => {
    const h = harness({ delayFirstInitialization: true });
    try {
      const results = Promise.allSettled([h.prepareCatalogInWorker(undefined,
        { owners: [], fields: [], facets: [] }, [], [], { independent: true })]);
      const worker = h.workers[0];
      const { id } = await worker.waitFor(data => data.fixture === "initializing");
      h.advance(120_000);
      await worker.emitStarted(id, clockOrigin + h.now() + 1);
      expect(worker.terminationCalls).toBe(0);
      expect([...h.deadlines].map(deadline => [deadline.delay, deadline.due])).toEqual([[600_000, 600_000]]);
      h.advance(479_999);
      expect(worker.terminationCalls).toBe(0);
      h.advance(1);
      expect((await results)[0]).toMatchObject({ status: "rejected", reason: { message: timeoutMessage } });
      expect(h.now()).toBe(600_000);
      await worker.exited;
      expect(worker.terminationCalls).toBe(1);
      expect(h.deadlines.size).toBe(0);
    } finally { await h.close(); }
  }, 10_000);

  test("an overdue initialization acknowledgment cannot outrun its queued submission timer", async () => {
    const h = harness({ delayFirstInitialization: true });
    try {
      const results = Promise.allSettled([h.prepareCatalogInWorker(undefined,
        { owners: [], fields: [], facets: [] }, [], [], { independent: true })]);
      const worker = h.workers[0];
      const { id } = await worker.waitFor(data => data.fixture === "initializing");
      h.stallMainThread(600_001);
      await worker.emitStarted(id, clockOrigin + h.now());
      expect(worker.terminationCalls).toBe(1);
      expect((await results)[0]).toMatchObject({ status: "rejected", reason: { message: timeoutMessage } });
      await worker.exited;
      expect(h.now()).toBe(600_001);
      expect(h.deadlines.size).toBe(0);
    } finally { await h.close(); }
  }, 10_000);

  test("a start delivered 120 seconds late retains only its original 60 seconds", async () => {
    const h = harness({ holdStartedAcknowledgments: true });
    try {
      const session = await h.prepareDetachedAuthoringSession(), worker = h.workers[0];
      const client = h.byOwner.get(session.registry);
      const results = Promise.allSettled([h.evaluate(session, "hold")]);
      const id = await worker.holding;
      expect(worker.delayedStarts.get(id).startedAt).toBe(clockOrigin);
      h.advance(120_000);
      expect(worker.deliverStarted(id).startedAt).toBe(clockOrigin);
      expect([...h.deadlines].map(deadline => [deadline.delay, deadline.due])).toEqual([[60_000, 180_000]]);
      h.advance(59_999);
      expect(client.closed).toBe(false);
      h.advance(1);
      expect((await results)[0]).toMatchObject({ status: "rejected", reason: { message: timeoutMessage } });
      expect(h.now()).toBe(180_000);
      await worker.exited;
      expect(worker.terminationCalls).toBe(1);
    } finally { await h.close(); }
  }, 10_000);

  test("an already-overdue start is refused before any queued watchdog callback runs", async () => {
    const h = harness({ holdStartedAcknowledgments: true });
    try {
      const session = await h.prepareDetachedAuthoringSession(), worker = h.workers[0];
      const client = h.byOwner.get(session.registry);
      const results = Promise.allSettled([h.evaluate(session, "hold")]);
      const id = await worker.holding;
      h.stallMainThread(180_001);
      expect(worker.deliverStarted(id).startedAt).toBe(clockOrigin);
      expect(client.closed).toBe(true);
      expect(worker.terminationCalls).toBe(1);
      expect((await results)[0]).toMatchObject({ status: "rejected", reason: { message: timeoutMessage } });
      expect(h.now()).toBe(180_001);
      expect(h.deadlines.size).toBe(0);
      await worker.exited;
    } finally { await h.close(); }
  }, 10_000);

  for (const offset of [0.10009765625, 0.00024414, 1]) {
    test(`a start ${offset} ms ahead of receipt is clamped to the ordinary 180 second allowance`, async () => {
      const h = harness({ holdStartedAcknowledgments: true });
      try {
        const session = await h.prepareDetachedAuthoringSession(), worker = h.workers[0];
        const client = h.byOwner.get(session.registry);
        const results = Promise.allSettled([h.evaluate(session, "hold")]);
        const id = await worker.holding;
        await worker.emitStarted(id, clockOrigin + offset);
        expect(client.closed).toBe(false);
        expect(client.transport.jobs.get(id).started).toBe(true);
        expect([...h.deadlines].map(deadline => [deadline.delay, deadline.due])).toEqual([[180_000, 180_000]]);
        h.advance(179_999);
        expect(client.closed).toBe(false);
        h.advance(1);
        expect((await results)[0]).toMatchObject({ status: "rejected", reason: { message: timeoutMessage } });
        expect(h.now()).toBe(180_000);
        await worker.exited;
        expect(worker.terminationCalls).toBe(1);
        expect(h.deadlines.size).toBe(0);
      } finally { await h.close(); }
    }, 10_000);
  }

  for (const [label, startedAt, omitStamp = false] of [
    ["missing", undefined, true], ["string", "not a timestamp"], ["null", null],
    ["NaN", NaN], ["positive infinity", Infinity], ["negative infinity", -Infinity],
    ["just outside the future allowance", clockOrigin + 1.000244140625],
    ["future", clockOrigin + 60_000],
  ]) {
    test(`a first ${label} start timestamp refuses immediately instead of extending the budget`, async () => {
      const h = harness({ holdStartedAcknowledgments: true });
      try {
        const session = await h.prepareDetachedAuthoringSession(), worker = h.workers[0];
        const client = h.byOwner.get(session.registry);
        const results = Promise.allSettled([h.evaluate(session, "hold")]);
        const id = await worker.holding;
        await worker.emitStarted(id, startedAt, omitStamp);
        expect(client.closed).toBe(true);
        expect(worker.terminationCalls).toBe(1);
        expect((await results)[0]).toMatchObject({ status: "rejected", reason: { message: unreadableMessage } });
        expect(h.now()).toBe(0);
        expect(h.deadlines.size).toBe(0);
        await worker.exited;
      } finally { await h.close(); }
    }, 10_000);
  }

  test("FIFO queue wait does not spend each job's 180 second execution allowance", async () => {
    const h = harness();
    try {
      const session = await h.prepareDetachedAuthoringSession(), worker = h.workers[0];
      const client = h.byOwner.get(session.registry), token = h.authoringWorkerSnapshot(session);
      const labels = ["one", "two", "three"];
      const jobs = labels.map(label => h.evaluate(session, { fixture: "fifo", label }));
      const results = Promise.allSettled(jobs);
      for (const [index, label] of labels.entries()) {
        const { id } = await worker.waitFor(data => data.fixture === "holding" && data.label === label);
        expect(client.transport.pending.size).toBe(3 - index);
        expect(worker.messages.filter(data => data.event === "started" && data.id > 1)).toHaveLength(index + 1);
        h.advance(110_000);
        expect(client.closed).toBe(false);
        await worker.complete(id, label);
      }
      expect(h.now()).toBe(330_000);
      expect(await results).toEqual(labels.map(result => ({
        status: "fulfilled", value: { result, trace: [] },
      })));
      expect(client.transport.pending.size).toBe(0);
      expect(client.transport.jobs.size).toBe(0);
      expect(h.deadlines.size).toBe(0);
      expect(worker.terminationCalls).toBe(0);
      expect(h.authoringWorkerSnapshot(session)).toBe(token);
    } finally { await h.close(); }
  }, 10_000);

  test("a worker that never acknowledges a queued job is retired after 180 seconds", async () => {
    const h = harness();
    try {
      const session = await h.prepareDetachedAuthoringSession(), worker = h.workers[0];
      const client = h.byOwner.get(session.registry);
      const results = Promise.allSettled([h.evaluate(session, "prestart-stall")]);
      const { id } = await worker.waitFor(data => data.fixture === "unstarted");
      expect(worker.messages.some(data => data.id === id && data.event === "started")).toBe(false);
      h.advance(179_999);
      expect(client.closed).toBe(false);
      h.advance(1);
      expect((await results)[0]).toMatchObject({ status: "rejected", reason: { message: timeoutMessage } });
      await worker.exited;
      expect(worker.terminationCalls).toBe(1);
      expect(client.transport.pending.size).toBe(0);
      expect(h.deadlines.size).toBe(0);
    } finally { await h.close(); }
  }, 10_000);

  test("aborting the only consumer cannot release a synchronously hung worker's watchdog", async () => {
    const h = harness(), consumer = trackedController();
    try {
      const session = await h.prepareDetachedAuthoringSession(), worker = h.workers[0];
      const client = h.byOwner.get(session.registry);
      const results = Promise.allSettled([h.evaluate(session, "block", consumer.signal)]);
      const id = await worker.blocked;
      consumer.controller.abort(new Error("Editor closed"));
      expect((await results)[0]).toMatchObject({ status: "rejected", reason: { message: "Editor closed" } });
      expect(consumer.listeners.size).toBe(0);
      expect(client.transport.pending.size).toBe(0);
      expect(client.transport.jobs.size).toBe(1);
      expect(client.transport.jobs.get(id).started).toBe(true);
      expect(h.deadlines.size).toBe(1);
      expect(worker.sent.filter(message => message.method === "cancel").map(message => message.id)).toEqual([id]);
      h.advance(179_999);
      expect(client.closed).toBe(false);
      h.advance(1);
      await worker.exited;
      expect(client.closed).toBe(true);
      expect(worker.terminationCalls).toBe(1);
      expect(worker.thread.threadId).toBe(-1);
      expect(client.transport.jobs.size).toBe(0);
      expect(h.deadlines.size).toBe(0);
    } finally { await h.close(); }
  }, 10_000);

  test("duplicate started acknowledgments do not extend a running job's deadline", async () => {
    const h = harness();
    try {
      const session = await h.prepareDetachedAuthoringSession(), worker = h.workers[0];
      const client = h.byOwner.get(session.registry);
      const results = Promise.allSettled([h.evaluate(session, "hold")]);
      const id = await worker.holding;
      h.advance(120_000);
      await worker.emit(id, "started");
      await worker.emitStarted(id, NaN);
      await worker.emitStarted(id, clockOrigin + 1_000_000);
      expect(client.closed).toBe(false);
      h.advance(59_999);
      expect(client.closed).toBe(false);
      h.advance(1);
      expect((await results)[0]).toMatchObject({ status: "rejected", reason: { message: timeoutMessage } });
      expect(h.now()).toBe(180_000);
      await worker.exited;
      expect(worker.terminationCalls).toBe(1);
    } finally { await h.close(); }
  }, 10_000);

  test("finished without a result cannot abandon a still-pending request", async () => {
    const h = harness();
    try {
      const session = await h.prepareDetachedAuthoringSession(), worker = h.workers[0];
      const client = h.byOwner.get(session.registry);
      const results = Promise.allSettled([h.evaluate(session, "hold")]);
      const id = await worker.holding;
      await worker.emit(id, "finished");
      expect(client.transport.pending.size).toBe(1);
      h.advance(180_000);
      expect((await results)[0]).toMatchObject({ status: "rejected", reason: { message: timeoutMessage } });
      await worker.exited;
      expect(worker.terminationCalls).toBe(1);
      expect(h.deadlines.size).toBe(0);
    } finally { await h.close(); }
  }, 10_000);

  test("final errors finish jobs, and completed or unknown lifecycle messages stay inert", async () => {
    const h = harness();
    try {
      const session = await h.prepareDetachedAuthoringSession(), worker = h.workers[0];
      const client = h.byOwner.get(session.registry), token = h.authoringWorkerSnapshot(session);
      const results = Promise.allSettled([h.evaluate(session, "hold")]);
      const id = await worker.holding;
      await worker.complete(id, undefined, "Worker refusal");
      expect((await results)[0]).toMatchObject({ status: "rejected", reason: { message: "Worker refusal" } });
      await worker.emit(id, "started");
      await worker.emit(id, "finished");
      await worker.emit(999_999, "started");
      await worker.emit(999_999, "finished");
      expect(client.transport.pending.size).toBe(0);
      expect(client.transport.jobs.size).toBe(0);
      expect(h.deadlines.size).toBe(0);
      h.advance(180_000);
      expect(client.closed).toBe(false);
      expect(worker.terminationCalls).toBe(0);
      expect(h.authoringWorkerSnapshot(session)).toBe(token);
      expect(await h.evaluate(session, "still usable")).toEqual({ result: "still usable", trace: [] });
    } finally { await h.close(); }
  }, 10_000);

  for (const [completed, remaining, timeoutAt] of [["first", "second", 240_000], ["second", "first", 180_000]]) {
    test(`finishing ${completed} of two active RPCs preserves ${remaining}'s own deadline`, async () => {
      const h = harness();
      try {
        const session = await h.prepareDetachedAuthoringSession(), worker = h.workers[0];
        const client = h.byOwner.get(session.registry);
        const first = h.evaluate(session, { fixture: "parallel", label: "first" });
        const firstResult = Promise.allSettled([first]);
        const firstHeld = await worker.waitFor(data => data.fixture === "holding" && data.label === "first");
        h.advance(60_000);
        const second = h.evaluate(session, { fixture: "parallel", label: "second" });
        const secondResult = Promise.allSettled([second]);
        const secondHeld = await worker.waitFor(data => data.fixture === "holding" && data.label === "second");
        expect(client.transport.pending.size).toBe(2);
        h.advance(60_000);
        const held = { first: firstHeld, second: secondHeld };
        const results = { first: firstResult, second: secondResult };
        await worker.complete(held[completed].id, completed);
        expect((await results[completed])[0]).toEqual({ status: "fulfilled", value: { result: completed, trace: [] } });
        expect(client.transport.pending.size).toBe(1);
        h.advance(timeoutAt - h.now() - 1);
        expect(client.closed).toBe(false);
        h.advance(1);
        expect((await results[remaining])[0]).toMatchObject({ status: "rejected", reason: { message: timeoutMessage } });
        expect(h.now()).toBe(timeoutAt);
        await worker.exited;
        expect(worker.terminationCalls).toBe(1);
        expect(client.transport.pending.size).toBe(0);
        expect(h.deadlines.size).toBe(0);
      } finally { await h.close(); }
    }, 10_000);
  }
});
