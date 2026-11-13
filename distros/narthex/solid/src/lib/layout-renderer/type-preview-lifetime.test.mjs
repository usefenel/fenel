import { describe, expect, test } from "bun:test";
import { createRoot, createSignal, createMemo, createEffect, flush, latest, onSettled, isPending, refresh }
  from "../../../node_modules/solid-js/dist/solid.dev.js";

// Existing TypeDataPreview host lifetime, using the actual Solid graph and
// async shim. Worker packets are controlled; no registry or evaluator boots.
const component = (await Bun.file(new URL("./TypedReadValue.tsx", import.meta.url)).text()).replace(/\r\n?/g, "\n");
const asyncSource = (await Bun.file(new URL("../async-value.ts", import.meta.url)).text()).replace(/\r\n?/g, "\n");
const compile = source => new Bun.Transpiler({ loader: "ts" }).transformSync(source).replace(/^export /gm, "");
const start = component.indexOf("  const completePreview = () =>");
const end = component.indexOf("  const previewMaps = createMemo(", start);
if (start < 0 || end <= start) throw Error("TypeDataPreview lifetime boundary changed");
const createAsyncValue = new Function("createMemo", "createSignal", "isPending", "refresh",
  `${compile(asyncSource.slice(asyncSource.indexOf("const LOADING:")))}; return createAsyncValue;`)
  (createMemo, createSignal, isPending, refresh);
const deferred = () => {
  let resolve, reject;
  const promise = new Promise((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
};
async function settle() { for (let tick = 0; tick < 20; tick++) { await Promise.resolve(); flush(); } }
function fixture({ peer = false, rejectOnAbort = false } = {}) {
  let disposeRoot;
  const h = createRoot(dispose => {
    disposeRoot = dispose;
    const [worker, setWorker] = createSignal({ label: "worker-one" });
    const [type, setType] = createSignal({ $ref: "Person" });
    const calls = [], observed = [], peers = [];
    const selected = { registry: {} };
    const reader = { kind: "local" };
    const props = { get type() { return type(); } };
    const bindings = { createMemo, createAsyncValue, onSettled, reader, props,
      session: () => selected, localSession: () => selected,
      preparedReaderWorkerForSession: () => worker(), LUCIDE_BY_NAME: {},
      runPreparedReaderWorker: (handle, payload, signal) => {
        const pending = deferred();
        calls.push({ handle, payload, signal, ...pending });
        if (rejectOnAbort) signal.addEventListener("abort", () => pending.reject(new DOMException("Retired", "AbortError")), { once: true });
        return pending.promise;
      } };
    const api = new Function(...Object.keys(bindings),
      `${compile(component.slice(start, end))}; return { projectionInput, projected, currentProjection };`)
      (...Object.values(bindings));
    // A second display read can share the same source transition. Its worker
    // may remain busy while this type's complete packet is already available.
    const sibling = peer ? createMemo(() => {
      const handle = worker();
      const pending = deferred(); peers.push({ handle, ...pending });
      return pending.promise;
    }, { loadingValue: "pending" }) : () => undefined;
    createEffect(() => ({ input: api.projectionInput(), current: api.currentProjection(),
      loading: api.projected.loading, error: api.projected.error, sibling: sibling() }),
    value => { observed.push(value); });
    return { api, worker, setWorker, type, setType, calls, observed, peers };
  });
  h.dispose = () => { disposeRoot(); flush(); };
  return h;
}
function reply(call) {
  const root = structuredClone(call.payload.type);
  call.resolve({ preview: { root, rows: [{ type: root }], fieldLabels: [] } });
}
async function withFixture(options, work) {
  const h = fixture(options);
  try { await settle(); await work(h); }
  finally { h.dispose(); for (const call of h.calls) reply(call); for (const peer of h.peers) peer.resolve("done"); await settle(); }
}

describe("type preview actual Solid lifetime", () => {
  test("a temporarily unavailable reader resumes on its newly prepared handle", async () => withFixture({ rejectOnAbort: true }, async h => {
    reply(h.calls[0]); await settle();
    h.setWorker(undefined); await settle();
    expect(h.api.currentProjection()).toBeUndefined();
    h.setWorker({ label: "worker-two" }); await settle();
    expect(h.calls).toHaveLength(2);
    reply(h.calls[1]); await settle();
    expect(h.api.projected.loading).toBe(false);
    expect(h.api.projected.error).toBeUndefined();
    expect(h.api.currentProjection()?.worker).toBe(h.calls[1].handle);
  }));

  test("retirement rejection and the replacement handle cannot leave a stale error or spinner", async () => withFixture({ rejectOnAbort: true }, async h => {
    reply(h.calls[0]); await settle();
    h.setWorker({ label: "worker-two" }); await settle();
    expect(h.calls).toHaveLength(2);
    h.setWorker({ label: "worker-three" }); await settle();
    expect(h.calls).toHaveLength(3);
    const next = h.calls[2]; reply(next); await settle();
    expect(h.api.projected.loading).toBe(false);
    expect(h.api.projected.error).toBeUndefined();
    expect(h.api.currentProjection()?.worker).toBe(next.handle);
  }));

  test("a pending old handle is cancelled and its replacement settles without the old reply", async () => withFixture({}, async h => {
    expect(h.calls).toHaveLength(1);
    const first = h.calls[0];
    h.setWorker({ label: "worker-two" }); await settle();
    expect(h.calls).toHaveLength(2);
    expect(first.signal.aborted).toBe(true);
    const next = h.calls[1]; reply(next); await settle();
    expect(h.api.projected.loading).toBe(false);
    expect(h.api.currentProjection()?.worker).toBe(next.handle);
    reply(first); await settle();
    expect(h.api.currentProjection()?.worker).toBe(next.handle);
  }));

  test("a settled card follows two handle replacements and rejects their late packets", async () => withFixture({}, async h => {
    reply(h.calls[0]); await settle();
    expect(h.api.currentProjection()?.worker).toBe(h.calls[0].handle);
    h.setWorker({ label: "worker-two" }); await settle();
    const second = h.calls[1];
    h.setWorker({ label: "worker-three" }); await settle();
    expect(h.calls).toHaveLength(3); expect(second.signal.aborted).toBe(true);
    const third = h.calls[2]; reply(third); await settle();
    expect(h.api.projected.loading).toBe(false);
    expect(h.api.currentProjection()?.worker).toBe(third.handle);
    reply(second); await settle();
    expect(h.api.currentProjection()?.worker).toBe(third.handle);
    h.dispose(); expect(third.signal.aborted).toBe(false);
  }));

  test("an available type packet settles while a sibling read of the replacement remains pending", async () => withFixture({ peer: true }, async h => {
    reply(h.calls[0]); h.peers[0].resolve("first"); await settle();
    const first = h.api.currentProjection(); expect(first).toBeDefined();
    h.setWorker({ label: "worker-two" }); await settle();
    expect(h.calls).toHaveLength(2); expect(h.peers).toHaveLength(2);
    reply(h.calls[1]); await settle();
    expect(h.api.projected.loading).toBe(false);
    expect(h.api.currentProjection()?.worker).toBe(h.calls[1].handle);
  }));

  test("a latest read cannot strand the owned replacement request", async () => withFixture({}, async h => {
    reply(h.calls[0]); await settle();
    latest(h.api.currentProjection);
    h.setWorker({ label: "worker-two" });
    latest(h.api.currentProjection);
    await settle(); expect(h.calls.length).toBeGreaterThanOrEqual(2);
    const next = h.calls.at(-1); reply(next); await settle();
    expect(h.api.projected.loading).toBe(false);
    expect(h.api.currentProjection()?.worker).toBe(next.handle);
  }));
});
