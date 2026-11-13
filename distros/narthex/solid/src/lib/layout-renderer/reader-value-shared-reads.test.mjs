import { describe, expect, test } from "bun:test";
import { createRoot, createSignal, createStore, createMemo, createEffect, flush, latest,
  onSettled, isPending, refresh, NotReadyError } from "../../../node_modules/solid-js/dist/solid.dev.js";
import { createLocalReaderPresentation } from "../local-reader-presentation.ts";

// Typed read surfaces over the Local reader's shared reads (2026-11-11): the
// production request/paint code of TypedReadValue (extracted as in
// reader-value-lifetime.test.mjs), the async shim, the transport copier and
// the real presentation cache. The worker is a controlled `run`. One world
// (reader, worker handle, cache) serves every surface mounted in a test.
const renderer = await Bun.file(new URL("./TypedReadValue.tsx", import.meta.url)).text();
const worker = await Bun.file(new URL("../expression-runner/authoring-catalog-worker.ts", import.meta.url)).text();
const asyncSource = await Bun.file(new URL("../async-value.ts", import.meta.url)).text();
const registry = await Bun.file(new URL("../../../../../../implementations/typescript/engine/src/registry-transport.ts", import.meta.url)).text();
const transpiler = new Bun.Transpiler({ loader: "ts" }), compile = source => transpiler.transformSync(source).replace(/^export /gm, "");
const section = (source, start, end) => {
  const first = source.indexOf(start), last = source.indexOf(end, first + start.length);
  if (first < 0 || last < 0) throw Error("Production fixture boundary changed: " + start);
  return source.slice(first, last);
};
const wrapper = section(renderer.slice(renderer.indexOf("export function TypedReadValue(")), "  const reader =", "  const unavailable =");
const localReaderReadSession = new Function("preparedSnapshotOwnerOf", "registryHasSnapshotOwner",
  `${compile(section(worker, "export function localReadSession(", "/** Bind only a scope"))};return localReaderReadSession;`)(selected => selected.registry, () => false);
const snapshot = new Function(`${compile(section(registry, "export function registryTransportSnapshot<", "/** An injective text encoding of a transport value,"))};return registryTransportSnapshot;`)();
const createAsyncValue = new Function("createMemo", "createSignal", "isPending", "refresh",
  `${compile(asyncSource.slice(asyncSource.indexOf("const LOADING:")))};return createAsyncValue;`)(createMemo, createSignal, isPending, refresh);
const packet = label => ({ root: { field: { name: "value", type: { $ref: "Profile" }, label: { $tag: "Nothing" }, meta: {}, ui: { $tag: "Nothing" } },
  body: "structural", structure: "record", recordLabel: "Record", numeric: false, glyph: {}, readPlan: null,
  typePresentation: { label, icon: "profile" } }, children: [] });
async function settle() { for (let tick = 0; tick < 14; tick++) { await Promise.resolve(); flush(); } }

function world() {
  const session = { label: "reader", registry: { label: "registry" }, environment: {}, evaluateContext: {} };
  const templates = { list: () => [], listComponentNames: () => [] };
  const [revision, setRevision] = createSignal(1);
  const [token, setToken] = createSignal({ label: "worker-one" });
  const handles = new WeakMap();
  const handle = () => { const key = token(); let found = handles.get(key); if (!found) { found = { token: key }; handles.set(key, found); } return found; };
  const calls = [];
  const presentation = createLocalReaderPresentation({ worker: handle, catalog: () => [], knownIcons: () => ["profile"],
    views: () => ({ views: templates.list(), componentNames: templates.listComponentNames() }),
    run: (target, payload, signal) => new Promise((resolve, reject) => {
      signal?.addEventListener("abort", () => reject(signal.reason), { once: true });
      calls.push({ handle: target, payload, signal, resolve, reject });
    }) });
  const reader = { kind: "local", client: {}, session: () => session, revision, templates: () => templates, registry: () => session.registry,
    readValue: (target, input, selected, signal) => selected === templates ? presentation.readValue(target, input, signal) : undefined };
  /** Answer every request not answered yet, one packet per input. */
  const answer = label => { for (const call of calls) if (!call.answered) { call.answered = true; call.resolve({ valueReads: call.payload.inputs.map(() => packet(label)) }); } };
  return { session, reader, calls, answer, setRevision, setToken, handle, direct: [] };
}

function surface(w, initial) {
  let disposeRoot;
  const h = createRoot(dispose => {
    disposeRoot = dispose;
    const [data, setData] = createStore(initial);
    const props = { get value() { return data; }, type: { $ref: "Profile" }, dataPath: ["base"] };
    const bindings = { createMemo, createSignal, createAsyncValue, latest, onSettled, NotReadyError, props,
      useReaderRuntime: () => w.reader, useAuthoringSession: () => w.session, registryTransportSnapshot: snapshot,
      preparedReaderWorkerForSession: () => w.handle(), localReaderReadSession, LUCIDE_BY_NAME: { profile: {} },
      // The direct path of a read the shared cache does not serve.
      runPreparedReaderWorker: (handle, payload, signal) => new Promise((resolve, reject) => { w.direct.push({ handle, payload, signal, resolve, reject }); }) };
    const api = new Function(...Object.keys(bindings), compile(`${wrapper};return{readInput,readRequest,current,projectedRead,paint,paintOwner,busy};`))(...Object.values(bindings));
    createEffect(() => ({ input: api.readInput(), paint: api.paint(), owner: api.paintOwner(), busy: api.busy(), request: api.readRequest() }), () => {});
    return { api, data, setData };
  });
  h.dispose = () => { disposeRoot(); flush(); };
  return h;
}

describe("typed read surfaces share and keep their Local reads", () => {
  test("a publication that changes neither the worker nor the value asks nothing; the paint stays and is current again", async () => {
    const w = world(), h = surface(w, { profile: { city: "Paris" }, count: 1 });
    try {
      await settle();
      expect(w.calls).toHaveLength(1);
      expect(w.calls[0].payload.inputs).toHaveLength(1);
      expect(w.calls[0].payload.inputs[0].value).toEqual({ profile: { city: "Paris" }, count: 1 });
      w.answer("first"); await settle();
      const painted = h.api.paint(), input = h.api.readInput();
      expect(painted.packet.root.typePresentation.label).toBe("first");
      for (let publication = 2; publication < 8; publication++) { w.setRevision(publication); await settle(); }
      // Every publication re-captured the value (a new input), and none asked the worker.
      expect(h.api.readInput()).not.toBe(input);
      expect(h.api.readInput().revision).toBe(7);
      expect(w.calls).toHaveLength(1);
      expect(w.direct).toHaveLength(0);
      expect(h.api.paint().input).toBe(h.api.readInput());
      expect(h.api.paint().packet).toBe(painted.packet);
      expect(h.api.busy()).toBe(false);
      expect(h.api.current(h.api.readInput())).toBe(true);
    } finally { h.dispose(); await settle(); }
  });

  test("an actual change of the value is asked once; the previous paint stays meanwhile", async () => {
    const w = world(), h = surface(w, { profile: { city: "Paris" } });
    try {
      await settle(); w.answer("old"); await settle();
      h.setData(draft => { draft.profile.city = "Rome"; });
      await settle();
      expect(w.calls).toHaveLength(2);
      expect(w.calls[1].payload.inputs[0].value.profile.city).toBe("Rome");
      expect(h.api.paint().packet.root.typePresentation.label).toBe("old");
      w.answer("new"); await settle();
      expect(h.api.paint().packet.root.typePresentation.label).toBe("new");
      // Back to the first content: its packet is still held.
      h.setData(draft => { draft.profile.city = "Paris"; });
      await settle();
      expect(w.calls).toHaveLength(2);
      expect(h.api.paint().packet.root.typePresentation.label).toBe("old");
    } finally { h.dispose(); await settle(); }
  });

  test("a restored worker is asked again: the refresh the revision dependency existed for is kept", async () => {
    const w = world(), h = surface(w, { profile: { city: "Paris" } });
    try {
      await settle(); w.answer("before"); await settle();
      const before = w.calls[0].handle;
      w.setToken({ label: "worker-two" });
      await settle();
      expect(w.calls).toHaveLength(2);
      expect(w.calls[1].handle).not.toBe(before);
      expect(h.api.paint()).toBeUndefined();
      w.answer("after"); await settle();
      expect(h.api.paint().packet.root.typePresentation.label).toBe("after");
    } finally { h.dispose(); await settle(); }
  });

  test("going up and back: a remounted surface of an unchanged value paints without a request", async () => {
    const w = world();
    const first = surface(w, { profile: { city: "Paris" } }), sibling = surface(w, { profile: { city: "Paris" } });
    await settle();
    // Two mounted surfaces of equal content: one request, one input.
    expect(w.calls).toHaveLength(1);
    expect(w.calls[0].payload.inputs).toHaveLength(1);
    w.answer("card"); await settle();
    expect(first.api.paint().packet).toBe(sibling.api.paint().packet);
    first.dispose(); sibling.dispose(); await settle();
    const back = surface(w, { profile: { city: "Paris" } });
    try {
      await settle();
      expect(w.calls).toHaveLength(1);
      expect(back.api.paint().packet.root.typePresentation.label).toBe("card");
      expect(back.api.busy()).toBe(false);
    } finally { back.dispose(); await settle(); }
  });

  test("leaving while the read is in flight cancels it only with the last surface", async () => {
    const w = world();
    const first = surface(w, { profile: { city: "Oslo" } }), second = surface(w, { profile: { city: "Oslo" } });
    await settle();
    expect(w.calls).toHaveLength(1);
    first.dispose(); await settle();
    expect(w.calls[0].signal.aborted).toBe(false);
    second.dispose(); await settle();
    expect(w.calls[0].signal.aborted).toBe(true);
  });
});
