// C1/C2: run the real worker scheduler and closed operation runner. Only model
// preparation/invocation is controlled; these tests acquire no app registry.
import { describe, expect, test } from "bun:test";
import { assertLocalOrdinaryOperation, runLocalOrdinaryOperation } from "../local-ordinary-operations";

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
function fixture({ preparation, invoke } = {}) {
  const messages = [], loads = [], calls = [];
  const model = { workspaceCall(name, ...args) {
    calls.push({ name, args });
    return invoke ? invoke(name, args) : { $tag: "Ok", _0: args[0] };
  } };
  const host = { postMessage(message) { messages.push(structuredClone(message)); } };
  const bindings = { globalThis: host, workerMeta: { env: { BASE_URL: "/" } },
    assertProxyTrackingPrecededEngine() {}, clearEngineBodyMemoPartition() {},
    assertLocalOrdinaryOperation, runLocalOrdinaryOperation,
    async loadWorkspaceModel(options) { loads.push(options); if (preparation) await preparation(); return model; },
    coreValueSuggestions: input => ({ input, suggestions: [] }),
  };
  const api = new Function(...Object.keys(bindings), `${code}; return {
    post: data => scope.onmessage({ data: structuredClone(data) }), idle: () => !pumping,
  };`)(...Object.values(bindings));
  return { ...api, messages, loads, calls,
    async settle() {
      for (let turn = 0; turn < 100 && !api.idle(); turn++) await Promise.resolve();
      expect(api.idle()).toBe(true);
    },
  };
}
const command = (id, value = { tabId: "local" }) => ({ id, method: "run-local-ordinary",
  operation: { kind: "validateTabData", args: [value] } });

describe("ordinary operations on the existing worker", () => {
  test("runs before initialization and after release with explicit inline model preparation", async () => {
    const h = fixture(); h.post(command(1)); await h.settle();
    h.post({ id: 2, method: "release" }); h.post(command(3)); await h.settle();
    expect(h.loads).toEqual([{ projected: true, preparation: "inline" }, { projected: true, preparation: "inline" }]);
    expect(h.calls.map(call => call.name)).toEqual(["validateTabData", "validateTabData"]);
    for (const id of [1, 3]) {
      const events = h.messages.filter(message => message.id === id);
      expect(events.map(message => message.event ?? "result")).toEqual(["started", "result", "finished"]);
      const pair = events[1].result.localOrdinary;
      expect(pair.value._0).toBe(pair.operation.args[0]);
    }
  });

  test.each(["scope", "contextId", "sourceModule", "initializationId", "authority", "fn"])(
    "refuses injected %s before model acquisition", async field => {
      const h = fixture(); h.post({ ...command(1), [field]: "forged" }); await h.settle();
      expect(h.loads).toEqual([]); expect(h.calls).toEqual([]);
      expect(h.messages.find(message => message.ok === false).error).toContain("closed data request");
    });

  test.each([{ kind: "perform", args: [] }, { kind: "validateTabData", args: [] },
    { kind: "validateTabData", args: [{}], scope: {} }, { kind: "toString", args: [] }])(
    "invalid operation refuses before preparation: %p", async operation => {
      const h = fixture(); h.post({ id: 1, method: "run-local-ordinary", operation }); await h.settle();
      expect(h.loads).toEqual([]); expect(h.messages.find(message => message.ok === false)).toBeDefined();
    });

  test.each(["cancel", "release"])("%s while preparing prevents evaluation and stale reply", async method => {
    const held = deferred(), h = fixture({ preparation: () => held.promise });
    h.post(command(1)); h.post({ id: method === "cancel" ? 1 : 2, method });
    held.resolve(); await h.settle();
    expect(h.calls).toEqual([]);
    expect(h.messages.filter(message => message.id === 1).map(message => message.event)).toEqual(["started", "finished"]);
    h.post(command(3)); await h.settle(); expect(h.calls).toHaveLength(1);
  });

  test.each(["cancel", "release"])("queued %s removes ordinary work without model acquisition", async method => {
    const held = deferred(), h = fixture({ preparation: () => held.promise });
    h.post(command(1)); h.post(command(2)); h.post({ id: method === "cancel" ? 2 : 3, method });
    held.resolve(); await h.settle();
    expect(h.loads).toHaveLength(1);
    expect(h.calls).toHaveLength(method === "release" ? 0 : 1);
    expect(h.messages.some(message => message.id === 2 && "ok" in message)).toBe(false);
  });

  test("a model failure reports refusal and leaves the queue usable", async () => {
    let attempt = 0;
    const h = fixture({ preparation: async () => { if (attempt++ === 0) throw new Error("model failed"); } });
    h.post(command(1)); h.post(command(2)); await h.settle();
    expect(h.messages.find(message => message.id === 1 && message.ok === false).error).toBe("model failed");
    expect(h.messages.find(message => message.id === 2 && message.ok === true)).toBeDefined();
    expect(h.calls).toHaveLength(1);
  });

  test("a semantic refusal remains its Result and shares one message with input", async () => {
    const h = fixture({ invoke: () => ({ $tag: "Err", _0: "stale revision" }) });
    h.post(command(1)); await h.settle();
    const result = h.messages.find(message => message.ok === true).result.localOrdinary;
    expect(result.value).toEqual({ $tag: "Err", _0: "stale revision" });
    expect(result.operation).toEqual(command(1).operation);
  });
});
