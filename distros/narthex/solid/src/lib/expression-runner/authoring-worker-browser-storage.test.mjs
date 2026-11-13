// C1/C2: real physical transport and storage adapter, controlled native-cloning
// Worker port. No registry, Fenel policy or application reader is constructed.
import { afterEach, describe, expect, test } from "bun:test";
import { beginBrowserDataStorageCommit } from "../browser-data-storage";
import { createAuthoringWorkerBrowserStorage } from "./authoring-worker-browser-storage";
import { closeAuthoringTransport, createAuthoringWorkerTransport, observeAuthoringTransport } from "./authoring-worker-transport";

const record = { schema: "fenel.local-data.v1", generation: 1,
  data: { tabId: "fenel-browser-local", revision: 0, entries: [], values: [], representations: [],
    layout: { kind: "list" }, definitions: { owners: [], fields: [], facets: [] } } };
const transports = [];
afterEach(() => { for (const transport of transports.splice(0)) closeAuthoringTransport(transport, "fixture closed"); });
function fixture() {
  const worker = { sent: [], terminated: false,
    postMessage(message) { this.sent.push(structuredClone(message)); },
    terminate() { this.terminated = true; },
    reply(id, result) { this.onmessage({ data: { id, ok: true, result: structuredClone(result) } }); },
    receipt(id, outcome) { this.onmessage({ data: { id, event: "storage-settled", outcome: structuredClone(outcome) } }); },
  };
  const transport = createAuthoringWorkerTransport(worker, 1);
  transports.push(transport);
  return { worker, transport, storage: createAuthoringWorkerBrowserStorage(transport) };
}
function deferred() {
  let resolve, reject;
  const promise = new Promise((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
}

describe("worker-backed browser storage adapter", () => {
  test("load accepts only the closed absent or record envelope", async () => {
    const h = fixture();
    let loading = h.storage.load();
    expect(h.worker.sent[0].method).toBe("load-local-storage");
    h.worker.reply(h.transport.nextId, {});
    expect(await loading).toBeUndefined();
    loading = h.storage.load();
    h.worker.reply(h.transport.nextId, { storageRecord: undefined });
    expect(await loading).toBeUndefined();
    loading = h.storage.load();
    h.worker.reply(h.transport.nextId, { storageRecord: record });
    expect(await loading).toEqual(record);
  });

  test.each([null, [], { presentations: [] }, { storageRecord: null },
    { storageRecord: record, extra: true }, { storageRecord: { ...record, generation: 0 } },
    { storageRecord: { ...record, data: [] } }, { storageRecord: { ...record, schema: 2 } }].map(value => [value]))(
    "load refuses an unreadable storage response: %p", async response => {
      const h = fixture(), loading = h.storage.load();
      h.worker.reply(h.transport.nextId, response);
      await expect(loading).rejects.toThrow("could not be read");
    });

  test("reader cancellation preserves late durable acknowledgement and synchronous observer order", async () => {
    const h = fixture(), abort = new AbortController(), events = [];
    const flight = h.storage.beginCommit(record.data, undefined, outcome => events.push(outcome.status), abort.signal);
    const id = h.transport.nextId;
    let settled = false;
    void flight.settled.then(() => { settled = true; events.push("settled"); });
    abort.abort(new Error("reader cancelled"));
    await expect(flight.result).rejects.toThrow("reader cancelled");
    expect(settled).toBe(false);
    observeAuthoringTransport(h.transport, () => {
      if (!h.transport.storage.size) expect(events[0]).toBe("committed");
    });
    h.worker.receipt(id, { status: "committed", record });
    expect(events).toEqual(["committed"]);
    expect(await flight.settled).toEqual({ status: "committed", record });
    expect(events).toEqual(["committed", "settled"]);
  });

  test("compatibility commit waits for the durable outcome after reader cancellation", async () => {
    const h = fixture(), abort = new AbortController();
    const committing = h.storage.commit(record.data, 0, abort.signal);
    const id = h.transport.nextId;
    abort.abort(new Error("reader cancelled"));
    h.worker.receipt(id, { status: "committed", record });
    expect(await committing).toEqual(record);
  });

  test("physical closure after posting is uncertain and never a definite abort", async () => {
    const h = fixture(), seen = [];
    const flight = h.storage.beginCommit(record.data, 0, outcome => seen.push(outcome));
    closeAuthoringTransport(h.transport, "worker crashed");
    expect(seen).toEqual([{ status: "uncertain", error: "worker crashed" }]);
    expect(await flight.settled).toEqual(seen[0]);
    await expect(flight.result).rejects.toThrow("worker crashed");
    const next = fixture(), committing = next.storage.commit(record.data, 0);
    closeAuthoringTransport(next.transport, "unknown outcome");
    await expect(committing).rejects.toThrow("unknown outcome");
  });

  test.each([
    Object.assign([], { status: "committed", record }),
    { status: "committed", record: Object.assign([], record) },
    { status: "committed", record: { ...record, data: [] } },
  ].map(value => [value]))("malformed durable receipt cannot establish a committed baseline: %p", async outcome => {
    const h = fixture(), seen = [];
    const flight = h.storage.beginCommit(record.data, undefined, value => seen.push(value));
    h.worker.receipt(h.transport.nextId, outcome);
    expect((await flight.settled).status).toBe("uncertain");
    expect(seen.map(value => value.status)).toEqual(["uncertain"]);
    expect(h.transport.closed).toBe(true);
    await expect(flight.result).rejects.toThrow("could not be read");
  });

  test("native clone failure and durable abort are definite noncommits", async () => {
    const h = fixture(), seen = [];
    let flight = h.storage.beginCommit({ ...record.data, unsupported: () => {} }, 0, outcome => seen.push(outcome));
    expect((await flight.settled).status).toBe("not-committed");
    await expect(flight.result).rejects.toThrow();
    expect(h.worker.sent).toEqual([]);
    expect(h.transport.closed).toBe(false);
    flight = h.storage.beginCommit(record.data, 0, outcome => seen.push(outcome));
    h.worker.receipt(h.transport.nextId, { status: "not-committed", error: "generation conflict" });
    expect(await flight.settled).toEqual({ status: "not-committed", error: "generation conflict" });
    await expect(flight.result).rejects.toThrow("generation conflict");
    expect(seen.map(outcome => outcome.status)).toEqual(["not-committed", "not-committed"]);
  });

  test.each(["committed", "uncertain"])("observer faults preserve a %s outcome", async status => {
    const h = fixture(), seen = [];
    const flight = h.storage.beginCommit(record.data, 0, outcome => { seen.push(outcome); throw new Error("keeper failed"); });
    if (status === "committed") h.worker.receipt(h.transport.nextId, { status, record });
    else closeAuthoringTransport(h.transport, "worker crashed");
    expect((await flight.settled).status).toBe(status);
    expect(seen).toHaveLength(1);
    expect(seen[0].status).toBe(status);
    expect(h.transport.closed).toBe(true);
    // A committed receipt still resolves its already-detached reader. Closure
    // uncertainty rejects it. Both branches have an internal rejection handler.
    if (status === "committed") expect(await flight.result).toEqual(record);
    else await expect(flight.result).rejects.toThrow("worker crashed");
  });
});

describe("page storage compatibility acknowledgement", () => {
  test("observer runs before settlement and cannot relabel a committed record", async () => {
    const pending = deferred(), events = [];
    const storage = { load: async () => undefined, commit: () => pending.promise };
    const flight = beginBrowserDataStorageCommit(storage, record.data, 0, outcome => {
      events.push(outcome.status); throw new Error("observer failed");
    });
    void flight.settled.then(() => events.push("settled"));
    pending.resolve(record);
    expect(await flight.settled).toEqual({ status: "committed", record });
    await expect(flight.result).rejects.toThrow("observer failed");
    expect(events).toEqual(["committed", "settled"]);
  });

  test.each(["sync", "async"])("%s page refusal is definitely uncommitted", async kind => {
    const seen = [], storage = { load: async () => undefined, commit() {
      if (kind === "sync") throw new Error("definite abort");
      return Promise.reject(new Error("definite abort"));
    } };
    const flight = beginBrowserDataStorageCommit(storage, record.data, undefined, outcome => seen.push(outcome));
    expect(await flight.settled).toEqual({ status: "not-committed", error: "definite abort" });
    await expect(flight.result).rejects.toThrow("definite abort");
    expect(seen).toHaveLength(1);
  });

  test("optional worker flight retains independent result and uncertainty", async () => {
    const h = fixture(), abort = new AbortController(), seen = [];
    const flight = beginBrowserDataStorageCommit(h.storage, record.data, 0, outcome => seen.push(outcome), abort.signal);
    abort.abort(new Error("cancelled"));
    await expect(flight.result).rejects.toThrow("cancelled");
    expect(seen).toEqual([]);
    closeAuthoringTransport(h.transport, "closed without receipt");
    expect(await flight.settled).toEqual({ status: "uncertain", error: "closed without receipt" });
    expect(seen).toHaveLength(1);
  });
});
