// C1/C2: execute the actual worker queue/cancellation/release owner. Only the
// storage operation is controlled; this fixture builds no application registry.
import { describe, expect, test } from "bun:test";

const source = await Bun.file(new URL("./authoring-catalog-worker-main.ts", import.meta.url)).text();
const code = new Bun.Transpiler({ loader: "ts" }).transformSync(source)
  .replace(/^import[\s\S]*?;\r?\n/gm, "")
  .replace(/^export\s*\{\s*\};?\r?\n/gm, "")
  .replace(/import\.meta/g, "workerMeta");

function deferred() {
  let resolve, reject;
  const promise = new Promise((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
}
const record = { schema: "fenel.local-data.v1", generation: 1, data: { tabId: "fenel-browser-local" } };

function fixture(storage = {}) {
  const messages = [], calls = [];
  let failReceipt = false;
  const host = {
    postMessage(message) {
      if (failReceipt && message.event === "storage-settled") throw new Error("receipt could not be cloned");
      messages.push(structuredClone(message));
    },
  };
  const bindings = {
    globalThis: host,
    workerMeta: { env: { BASE_URL: "/" } },
    assertProxyTrackingPrecededEngine() {},
    createBrowserDataStorage: () => ({
      async load(signal) { calls.push({ method: "load", signal }); return storage.load?.(signal); },
      async commit(next, expected, signal) {
        calls.push({ method: "commit", next, expected, signal });
        return storage.commit ? storage.commit(next, expected, signal) : record;
      },
    }),
    clearEngineBodyMemoPartition() {},
    coreValueSuggestions: input => ({ input, suggestions: [] }),
  };
  const api = new Function(...Object.keys(bindings), `${code}; return {
    post: data => scope.onmessage({ data }), idle: () => !pumping,
  };`)(...Object.values(bindings));
  return { ...api, messages, calls, failReceipt: () => { failReceipt = true; },
    async settle() {
      for (let attempt = 0; attempt < 80 && !api.idle(); attempt++) await Promise.resolve();
      expect(api.idle()).toBe(true);
    },
    receipts(id) { return messages.filter(message => message.id === id && message.event === "storage-settled"); },
  };
}
const commit = id => ({ id, method: "commit-local-storage", next: record.data, expectedGeneration: 0 });

describe("physical worker storage execution", () => {
  test("closed storage operations work before initialization and after snapshot release", async () => {
    const h = fixture({ load: async () => record });
    h.post({ id: 1, method: "load-local-storage" }); await h.settle();
    h.post(commit(2)); await h.settle();
    h.post({ id: 3, method: "release" });
    h.post(commit(4)); await h.settle();
    expect(h.messages.find(message => message.id === 1 && message.ok)).toEqual({ id: 1, ok: true, result: { storageRecord: record } });
    for (const id of [2, 4]) {
      expect(h.receipts(id)).toEqual([{ id, event: "storage-settled", outcome: { status: "committed", record } }]);
      const events = h.messages.filter(message => message.id === id);
      expect(events.map(message => message.event ?? "response")).toEqual(["started", "storage-settled", "response", "finished"]);
    }
    expect(h.calls.map(call => call.method)).toEqual(["load", "commit", "commit"]);
  });

  test("absent storage returns the closed empty packet", async () => {
    const h = fixture(); h.post({ id: 1, method: "load-local-storage" }); await h.settle();
    expect(h.messages.find(message => message.ok)).toEqual({ id: 1, ok: true, result: {} });
    expect(h.receipts(1)).toEqual([]);
  });

  test.each(["cancel", "release"])("queued %s emits one definite noncommit before finished and never writes", async method => {
    const held = deferred(), h = fixture({ load: () => held.promise });
    h.post({ id: 1, method: "load-local-storage" });
    h.post(commit(2));
    h.post({ id: method === "cancel" ? 2 : 3, method });
    h.post({ id: method === "cancel" ? 2 : 4, method });
    expect(h.receipts(2)).toHaveLength(1);
    expect(h.receipts(2)[0].outcome.status).toBe("not-committed");
    expect(h.messages.filter(message => message.id === 2).map(message => message.event)).toEqual(["storage-settled", "finished"]);
    held.resolve(); await h.settle();
    expect(h.calls.map(call => call.method)).toEqual(["load"]);
  });

  test("active cancellation aborts storage and emits noncommit even without a reader response", async () => {
    const h = fixture({ commit: (_next, _expected, signal) => new Promise((_resolve, reject) => {
      signal.addEventListener("abort", () => reject(signal.reason), { once: true });
    }) });
    h.post(commit(1)); h.post({ id: 1, method: "cancel" }); await h.settle();
    expect(h.calls[0].signal.aborted).toBe(true);
    expect(h.receipts(1)).toHaveLength(1);
    expect(h.receipts(1)[0].outcome.status).toBe("not-committed");
    expect(h.messages.filter(message => message.id === 1).map(message => message.event)).toEqual(["started", "storage-settled", "finished"]);
  });

  test("completed storage wins cancellation before the worker continuation and still receipts once", async () => {
    const held = deferred(), h = fixture({ commit: () => held.promise });
    h.post(commit(1)); held.resolve(record); h.post({ id: 1, method: "cancel" }); await h.settle();
    expect(h.calls[0].signal.aborted).toBe(true);
    expect(h.receipts(1)).toEqual([{ id: 1, event: "storage-settled", outcome: { status: "committed", record } }]);
    expect(h.messages.filter(message => message.id === 1).map(message => message.event)).toEqual(["started", "storage-settled", "finished"]);
  });

  test("defensive release aborts an active write and a later incarnation can write", async () => {
    let writes = 0;
    const h = fixture({ commit: (_next, _expected, signal) => {
      if (writes++ > 0) return record;
      return new Promise((_resolve, reject) => {
        signal.addEventListener("abort", () => reject(signal.reason), { once: true });
      });
    } });
    h.post(commit(1)); h.post({ id: 2, method: "release" }); await h.settle();
    expect(h.calls[0].signal.aborted).toBe(true);
    expect(h.receipts(1)).toHaveLength(1);
    expect(h.receipts(1)[0].outcome.status).toBe("not-committed");
    h.post(commit(3)); await h.settle();
    expect(h.receipts(3)[0].outcome).toEqual({ status: "committed", record });
    expect(h.calls[1].signal.aborted).toBe(false);
  });

  test("storage refusal emits terminal noncommit before its normal error and leaves the queue usable", async () => {
    const h = fixture({ commit: async () => { throw new Error("Foreign generation"); } });
    h.post(commit(1)); h.post({ id: 2, method: "core-value-suggestions", input: "String" }); await h.settle();
    expect(h.receipts(1)[0].outcome).toEqual({ status: "not-committed", error: "Foreign generation" });
    expect(h.messages.filter(message => message.id === 1).map(message => message.event ?? "response"))
      .toEqual(["started", "storage-settled", "response", "finished"]);
    expect(h.messages.find(message => message.id === 2 && message.ok).result.coreValueSuggestion.input).toBe("String");
  });

  test("failure to post a committed receipt cannot claim noncommit", async () => {
    const h = fixture(); h.failReceipt(); h.post(commit(1)); await h.settle();
    expect(h.calls).toHaveLength(1);
    expect(h.receipts(1)).toEqual([]);
    expect(h.messages.find(message => message.ok === false).error).toBe("receipt could not be cloned");
  });

  test("storage cannot accept arbitrary function/scope fields", async () => {
    const h = fixture(); h.post({ ...commit(1), scope: { sourceId: "forged" } }); await h.settle();
    h.post({ id: 2, method: "load-local-storage", function: "arbitrary" }); await h.settle();
    expect(h.calls).toEqual([]);
    expect(h.receipts(1)[0].outcome.status).toBe("not-committed");
    expect(h.messages.find(message => message.id === 2 && message.ok === false).error).toContain("ordinary source request");
  });
});
