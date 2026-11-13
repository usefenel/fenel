import { describe, expect, test } from "bun:test";
import { createRoot, createSignal, createMemo, createEffect, createStore, flush, isPending, latest, onSettled, refresh }
  from "../../../node_modules/solid-js/dist/solid.dev.js";

// C1 host lifetime only: reuse the field-plan suite's production-section
// extraction and real Solid 2 graph, with source semantics and RPC delivery as
// controlled ports. No registry, worker or browser is booted by this suite.
const [source, asyncSource, registrySource] = await Promise.all([
  Bun.file(new URL("./FieldRenderer.tsx", import.meta.url)).text(),
  Bun.file(new URL("../async-value.ts", import.meta.url)).text(),
  Bun.file(new URL("../../../../../../implementations/typescript/engine/src/registry-transport.ts", import.meta.url)).text(),
]);
const transpiler = new Bun.Transpiler({ loader: "ts" });
const compile = text => transpiler.transformSync(text).replace(/^export /gm, "");
function section(text, begin, end) {
  const start = text.indexOf(begin), finish = text.indexOf(end, start + begin.length);
  if (start < 0 || finish < start) throw new Error(`The record-operation fixture boundary moved: ${begin}`);
  return text.slice(start, finish);
}
const helper = section(source, "export function createReaderRecordOperations", "/** Tiny icon resolver");
const guard = section(source, "function createReaderInteractionGuard(", "/** A2/B3 field-plan lifetime");
const workerOwner = section(source, "function localFieldSelectionWorker(", "/** Adapts the Fenel-owned edit plan");
const copier = new Function(`${compile(section(registrySource, "export function registryTransportSnapshot<",
  "/** An injective text encoding of a transport value,"))}; return registryTransportSnapshot;`)();
const createAsyncValue = new Function("createMemo", "createSignal", "isPending", "refresh",
  `${compile(asyncSource.slice(asyncSource.indexOf("const LOADING:")))}; return createAsyncValue;`)
  (createMemo, createSignal, isPending, refresh);
const deferred = () => {
  let resolve, reject;
  const promise = new Promise((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
};
const ok = value => ({ $tag: "Ok", _0: value });
const err = message => ({ $tag: "Err", _0: message });
const just = value => ({ $tag: "Just", _0: value });
const nothing = { $tag: "Nothing" };
const slots = fields => fields.map((field, index) => ({ field, slot: ok({ wire: `physical-${index}`, value: just(`slot-${index}`) }) }));
const errorMessage = value => value instanceof Error ? value.message : value;
async function settle() {
  for (let tick = 0; tick < 10; tick++) { await Promise.resolve(); flush(); }
}
class HostEvent {
  constructor(type) { this.type = type; this.defaultPrevented = false; this.stopped = false; }
  preventDefault() { this.defaultPrevented = true; }
  stopImmediatePropagation() { this.stopped = true; }
}
class HostKeyboardEvent extends HostEvent {
  constructor(key, flags = {}) { super("keydown"); this.key = key; Object.assign(this, flags); }
}
class HostElement {
  listeners = new Map();
  addEventListener(name, callback, capture) { expect(capture).toBe(true); this.listeners.set(name, callback); }
  removeEventListener(name, callback, capture) {
    expect(capture).toBe(true);
    if (this.listeners.get(name) === callback) this.listeners.delete(name);
  }
  dispatch(event) { this.listeners.get(event.type)?.(event); return event; }
}
class HostInputElement extends HostElement {}
class HostTextAreaElement extends HostElement {}

// B4 F1: a Local reader's page session whose registry/evaluator getters throw.
// The reader's own field registry is a separate token (`reader.registry()`).
const poisonTokens = new WeakMap();
function poisonedSession(plain) {
  const session = { label: plain.registry.label };
  poisonTokens.set(session, plain.registry);
  for (const key of ["registry", "evaluateContext", "environment", "catalog"]) Object.defineProperty(session, key, {
    get() { throw new Error(`Page session ${key} read for a Local reader`); } });
  return session;
}
const ownRegistryOf = session => poisonTokens.get(session) ?? session.registry;

function fixture(options = {}) {
  let disposeRoot;
  const h = createRoot(dispose => {
    disposeRoot = dispose;
    const transports = [], reads = [], edits = [], contextReads = [], captures = [], observations = [], writes = [];
    const plainSessionFor = label => ({ registry: { label, evaluateContext() { contextReads.push(label); return { frame: label }; } },
      evaluateContext: { frame: label }, environment: {} });
    const sessionFor = label => options.poisoned ? poisonedSession(plainSessionFor(label)) : plainSessionFor(label);
    const authoring = sessionFor("authoring");
    const [session, setSession] = createSignal(authoring);
    const foreignContext = { frame: "foreign" };
    const foreignRegistry = { label: "foreign", evaluateContext() { contextReads.push("foreign"); return foreignContext; } };
    const [registry, setRegistry] = createSignal(options.foreignRegistry ? foreignRegistry : ownRegistryOf(authoring));
    const [epoch, setEpoch] = createSignal(3), [revision, setRevision] = createSignal(11);
    const [token, setToken] = createSignal({ label: "first worker" });
    const [available, setAvailable] = createSignal(options.available !== false);
    const [notified, setNotified] = createSignal(0);
    const [valueStore, setValueStore] = createStore({ nested: { amount: 1 }, items: [{ z: 2, a: 1 }] });
    const initialValue = options.value ?? { z: "last", a: "first" };
    const initialFields = options.fields ?? ["second", "first", "second"];
    const initialCoordinate = options.coordinate ?? { row: 4, nested: { name: "before" } };
    const [coordinateStore, setCoordinateStore] = createStore({ row: 4, nested: { name: "before" } });
    const [fieldsStore, setFieldsStore] = createStore(["second", "first", "second"]);
    const [value, setValue] = createSignal(initialValue), [fields, setFields] = createSignal(initialFields);
    const [coordinate, setCoordinate] = createSignal(initialCoordinate);
    const [useStores, setUseStores] = createSignal(false);
    const [representation, setRepresentation] = createSignal(options.representationTypeName);
    const [enabled, setEnabled] = createSignal(options.enabled !== false);
    const [context, setContext] = createSignal(options.context);
    const [publisher, setPublisher] = createSignal({ callback: next => writes.push({ owner: "initial", value: next }) });
    const publication = createMemo(() => ({ callback: publisher().callback }));
    const handles = new WeakMap();
    let silentToken, workerFailure, readFailure = options.readFailure, editFailure = options.editFailure;
    let readResult = options.readResult, editResult = options.editResult ?? ok({ source: "edited" });
    const preparedReaderWorkerForSession = selected => {
      notified();
      if (workerFailure) throw workerFailure;
      if (!available()) return undefined;
      const workerToken = silentToken ?? token();
      let byToken = handles.get(selected);
      if (!byToken) { byToken = new WeakMap(); handles.set(selected, byToken); }
      let handle = byToken.get(workerToken);
      if (!handle) { handle = { session: selected, token: workerToken }; byToken.set(workerToken, handle); }
      return handle;
    };
    const reader = options.noReader ? undefined : { kind: options.kind ?? "local", session, revision, registry: () => ownRegistryOf(session()) };
    const bindings = {
      createMemo, createSignal, createEffect, createAsyncValue, latest, isPending, onSettled,
      KeyboardEvent: HostKeyboardEvent, HTMLInputElement: HostInputElement, HTMLTextAreaElement: HostTextAreaElement,
      DETACHED_AUTHORING_SESSION: { detached: true }, sessionEpoch: epoch, preparedReaderWorkerForSession,
      registryHasSnapshotOwner: () => false,
      useFieldPresentationRegistry: () => registry, useReaderRuntime: () => reader, useAuthoringSession: () => authoring,
      registryTransportSnapshot: (input, label, mode, bridge) => {
        captures.push({ input, label, mode, bridge }); return copier(input, label, mode, bridge);
      },
      fieldRecordSlotsPlan: (...args) => { reads.push(args); if (readFailure) throw readFailure; return readResult ?? slots(args[1]); },
      fieldRecordEditPlan: (...args) => { edits.push(args); if (editFailure) throw editFailure; return editResult; },
      runPreparedReaderWorker: (handle, payload, signal) => {
        const held = deferred(); transports.push({ handle, payload, signal, ...held }); return held.promise;
      },
    };
    const create = new Function(...Object.keys(bindings), `${compile(`${workerOwner}\n${guard}\n${helper}`)}; return createReaderRecordOperations;`)
      (...Object.values(bindings));
    const request = () => enabled() ? { value: useStores() ? valueStore : value(), fields: useStores() ? fieldsStore : fields(),
      representationTypeName: representation() } : undefined;
    const api = create(request, { evaluateContext: context, coordinate: () => useStores() ? coordinateStore : coordinate(), publication });
    createEffect(() => ({ input: api.input(), paint: api.paint(), ready: api.ready(), loading: api.loading(), error: api.error() }),
      state => { observations.push(state); });
    return { api, transports, reads, edits, contextReads, captures, observations, writes, authoring, sessionFor, reader,
      initialValue, initialFields, initialCoordinate, foreignContext, foreignRegistry, session, setSession, registry, setRegistry,
      epoch, setEpoch, revision, setRevision, setToken, setAvailable, value, setValue, fields, setFields, coordinate, setCoordinate,
      setUseStores, valueStore, setValueStore, fieldsStore, setFieldsStore, coordinateStore, setCoordinateStore,
      setRepresentation, setEnabled, setContext, publication,
      edit: (field, edited) => api.edit(field, edited, publication().callback),
      replacePublication: () => setPublisher({ callback: next => writes.push({ owner: "replacement", value: next }) }),
      replaceWorkerSilently: () => { silentToken = { label: "unannounced worker" }; },
      setWorkerFailure: error => { workerFailure = error; setNotified(count => count + 1); },
      setReadFailure: error => { readFailure = error; }, setEditFailure: error => { editFailure = error; },
      setReadResult: result => { readResult = result; }, setEditResult: result => { editResult = result; },
    };
  });
  let disposed = false;
  h.dispose = () => { if (!disposed) { disposed = true; disposeRoot(); flush(); } };
  return h;
}
async function withFixture(options, run) {
  const h = fixture(options);
  try { await settle(); return await run(h); }
  finally { h.dispose(); await settle(); }
}
async function admit(h, result) {
  const flight = h.transports.findLast(item => item.payload.method === "project-reader-record-slots");
  const recordSlots = result ?? slots(flight.payload.fields);
  flight.resolve({ recordSlots }); await settle();
  expect(h.api.ready()).toBe(true);
  expect(h.api.paint().recordSlots).toBe(recordSlots);
  return recordSlots;
}
const projections = h => h.transports.filter(item => item.payload.method === "project-reader-record-slots");
const updates = h => h.transports.filter(item => item.payload.method === "edit-reader-record-field");

describe("reader record operation lifetime", () => {
  test("one exact Local batch preserves order, duplicates and per-field Result values", async () => withFixture({}, async h => {
    expect(h.api.ready()).toBe(false); expect(h.api.loading()).toBe(true); expect(h.api.paint()).toBeUndefined();
    expect(h.transports).toHaveLength(1);
    const flight = h.transports[0];
    expect(flight.payload).toEqual({ method: "project-reader-record-slots", value: h.initialValue,
      fields: h.initialFields, representationTypeName: undefined });
    expect(flight.payload.value).not.toBe(h.initialValue); expect(flight.payload.fields).not.toBe(h.initialFields);
    expect(Object.keys(flight.payload.value)).toEqual(["z", "a"]);
    expect(h.captures.every(item => item.mode === "equality" && item.bridge === Reflect.get)).toBe(true);
    expect(h.contextReads).toEqual([]); expect(h.reads).toEqual([]); expect(h.edits).toEqual([]);
    const result = [{ field: "second", slot: ok({ wire: "b", value: just(2) }) },
      { field: "first", slot: err("this field is unavailable") }, { field: "second", slot: ok({ wire: "b", value: nothing }) }];
    await admit(h, result);
    expect(h.api.paint()).toEqual({ value: h.initialValue, coordinate: h.initialCoordinate, recordSlots: result });
    expect(h.api.paint().value).toBe(h.initialValue); expect(h.api.paint().coordinate).toBe(h.initialCoordinate);
    h.edit("first", "refused"); await settle();
    expect(updates(h)).toHaveLength(0); expect(h.api.error()).toBe("this field is unavailable");
    h.edit("absent", "refused"); await settle();
    expect(updates(h)).toHaveLength(0); expect(h.api.error()).toContain("unavailable");
  }));

  test("worker capture is independent of later raw mutations", async () => withFixture({}, async h => {
    const flight = h.transports[0];
    h.initialValue.z = "mutated"; h.initialFields[0] = "mutated"; h.initialCoordinate.nested.name = "mutated";
    expect(flight.payload.value.z).toBe("last"); expect(flight.payload.fields[0]).toBe("second");
    expect(h.api.input().captured.coordinate.nested.name).toBe("before");
  }));

  for (const options of [{ available: false }, { workerFailure: true }]) test(`Local missing/refused worker has no page fallback (${JSON.stringify(options)})`, async () =>
    withFixture(options, async h => {
      if (options.workerFailure) { h.setWorkerFailure(new Error("worker refused")); await settle(); }
      expect(h.api.ready()).toBe(false); expect(h.api.paint()).toBeUndefined();
      expect(errorMessage(h.api.error())).toContain(options.workerFailure ? "worker refused" : "not ready");
      expect(h.reads).toEqual([]); expect(h.edits).toEqual([]);
    }));

  test("Local RPC refusal stays bounded and retries the same source", async () => withFixture({}, async h => {
    h.transports[0].reject(new Error("projection refused")); await settle();
    expect(h.api.ready()).toBe(false); expect(errorMessage(h.api.error())).toBe("projection refused");
    const retry = h.api.retry(); await settle();
    expect(projections(h)).toHaveLength(2); expect(h.api.loading()).toBe(true);
    await admit(h); await retry; await settle(); expect(h.api.error()).toBeUndefined(); expect(h.reads).toEqual([]);
  }));

  test("same-input overlapping refreshes abort the old projection and admit only the newest", async () => withFixture({}, async h => {
    const original = h.transports[0], input = h.api.input();
    const firstRetry = h.api.retry(); await settle(); const middle = projections(h).at(-1);
    const secondRetry = h.api.retry(); await settle();
    expect(h.api.input()).toBe(input); expect(projections(h)).toHaveLength(3);
    expect(original.signal.aborted).toBe(true); expect(middle.signal.aborted).toBe(true);
    original.resolve({ recordSlots: slots(original.payload.fields) }); middle.resolve({ recordSlots: slots(middle.payload.fields) });
    await settle(); expect(h.api.ready()).toBe(false); expect(h.api.paint()).toBeUndefined();
    await admit(h); await Promise.all([firstRetry, secondRetry]); await settle(); expect(h.api.loading()).toBe(false);
  }));

  for (const [label, result] of Object.entries({ missing: {}, nonArray: { recordSlots: {} }, short: { recordSlots: [] },
    order: { recordSlots: slots(["first", "second", "second"]) }, badResult: { recordSlots: [
      { field: "second", slot: { $tag: "Right" } }, ...slots(["first", "second"]) ] } }))
    test(`malformed ${label} batch refuses the entire receipt`, async () => withFixture({}, async h => {
      h.transports[0].resolve(result); await settle();
      expect(h.api.ready()).toBe(false); expect(h.api.paint()).toBeUndefined();
      expect(errorMessage(h.api.error())).toContain("could not be read"); expect(h.reads).toEqual([]);
    }));

  const changes = {
    value: h => h.setValue({ replacement: true }), fields: h => h.setFields(["first"]),
    coordinate: h => h.setCoordinate({ row: 5 }), representation: h => h.setRepresentation("NativeRecord"),
    revision: h => h.setRevision(12), epoch: h => h.setEpoch(4), worker: h => h.setToken({ label: "replacement" }),
    session: h => { const next = h.sessionFor("replacement"); h.setSession(next); h.setRegistry(next.registry); },
    "supplied native context": h => { h.setRepresentation("NativeRecord"); h.setContext({ frame: "native replacement" }); },
  };
  for (const [label, change] of Object.entries(changes)) test(`${label} replacement aborts projection and refuses a late answer`, async () => withFixture({}, async h => {
    const old = h.transports[0]; change(h); await settle();
    expect(old.signal.aborted).toBe(true); expect(projections(h)).toHaveLength(2);
    old.resolve({ recordSlots: slots(old.payload.fields) }); await settle();
    expect(h.api.ready()).toBe(false); expect(h.api.paint()).toBeUndefined();
    await admit(h); expect(h.reads).toEqual([]);
  }));

  test("a queued changed input fences an old answer before explicit flush", async () => withFixture({}, async h => {
    const old = h.transports[0]; h.setValue({ queued: true }); old.resolve({ recordSlots: slots(old.payload.fields) });
    await settle(); expect(h.api.ready()).toBe(false); expect(h.api.paint()).toBeUndefined(); await admit(h);
  }));

  for (const member of ["value", "fields", "coordinate"]) test(`nested live ${member} capture follows current store data`, async () => withFixture({}, async h => {
    h.setUseStores(true); await settle(); const old = h.transports.at(-1), count = projections(h).length;
    if (member === "value") h.setValueStore(draft => { draft.nested.amount = 9; draft.items.push({ z: 3, a: 4 }); });
    else if (member === "fields") h.setFieldsStore(draft => { draft[0] = "renamed"; draft.push("new"); });
    else h.setCoordinateStore(draft => { draft.nested.name = "after"; });
    await settle(); expect(old.signal.aborted).toBe(true); expect(projections(h)).toHaveLength(count + 1);
    const captured = h.api.input().captured;
    if (member === "value") {
      expect(captured.request.value.nested.amount).toBe(9); expect(captured.request.value.items).toHaveLength(2);
      expect(Object.keys(captured.request.value.items[0])).toEqual(["z", "a"]); expect(old.payload.value.nested.amount).toBe(1);
    } else if (member === "fields") expect(captured.request.fields).toEqual(["renamed", "first", "second", "new"]);
    else expect(captured.coordinate.nested.name).toBe("after");
    await admit(h);
  }));

  for (const member of ["value", "coordinate"]) for (const kind of ["accessor", "hidden"])
    test(`${kind} ${member} descriptor refuses without invoking getters`, async () => {
      let getters = 0; const hostile = {};
      Object.defineProperty(hostile, "secret", kind === "accessor" ? { enumerable: true, get() { getters++; return "secret"; } }
        : { enumerable: false, value: "secret" });
      await withFixture({ [member]: hostile }, async h => {
        expect(getters).toBe(0); expect(h.transports).toEqual([]); expect(h.reads).toEqual([]);
        expect(h.api.ready()).toBe(false); expect(errorMessage(h.api.error())).toContain(kind === "accessor" ? "accessor" : "non-enumerable");
      }); expect(getters).toBe(0);
    });

  test("a requested field array accessor is refused without executing it", async () => {
    let getters = 0; const fields = ["second"];
    Object.defineProperty(fields, "0", { enumerable: true, get() { getters++; return "second"; } });
    await withFixture({ fields }, async h => {
      expect(h.transports).toEqual([]); expect(h.reads).toEqual([]);
      expect(errorMessage(h.api.error())).toContain("accessor"); expect(getters).toBe(0);
    }); expect(getters).toBe(0);
  });

  test("an accessor overlaid inside a live store aborts the old plan without execution", async () => withFixture({}, async h => {
    h.setUseStores(true); await settle(); const old = h.transports.at(-1), count = h.transports.length;
    let getters = 0; const hostile = {};
    Object.defineProperty(hostile, "secret", { enumerable: true, get() { getters++; return 1; } });
    h.setValueStore(draft => { draft.nested = hostile; }); await settle();
    expect(getters).toBe(0); expect(old.signal.aborted).toBe(true); expect(h.transports).toHaveLength(count);
    expect(errorMessage(h.api.error())).toContain("accessor");
  }));

  test("pending paint retains a coherent captured value, slot receipt and coordinate", async () => withFixture({}, async h => {
    const first = await admit(h); h.setValue({ updated: true }); h.setCoordinate({ row: 8 }); await settle();
    expect(h.api.ready()).toBe(false); expect(h.api.loading()).toBe(true);
    expect(h.api.paint()).toEqual({ value: { z: "last", a: "first" }, coordinate: { row: 4, nested: { name: "before" } }, recordSlots: first });
    expect(h.api.paint().value).not.toBe(h.initialValue); expect(h.api.paint().coordinate).not.toBe(h.initialCoordinate);
    const next = await admit(h); expect(h.api.paint()).toEqual({ value: { updated: true }, coordinate: { row: 8 }, recordSlots: next });
  }));

  for (const [label, change] of Object.entries({ epoch: h => h.setEpoch(4), worker: h => h.setToken({ label: "replacement" }),
    registry: h => h.setRegistry(h.foreignRegistry), context: h => h.setContext({ frame: "custom" }) }))
    test(`${label} source change never retains the previous paint`, async () => withFixture({}, async h => {
      await admit(h); change(h); await settle();
      if (label === "registry" || label === "context") expect(h.api.paint()?.recordSlots).not.toBe(h.observations.find(item => item.ready)?.paint?.recordSlots);
      else expect(h.api.paint()).toBeUndefined();
    }));

  test("retirement and disposal abort outstanding observations", async () => {
    await withFixture({}, async h => {
      const old = h.transports[0]; h.setEnabled(false); await settle();
      expect(old.signal.aborted).toBe(true); expect(h.api.paint()).toBeUndefined(); expect(h.api.ready()).toBe(false);
      old.resolve({ recordSlots: slots(old.payload.fields) }); await settle(); expect(h.api.paint()).toBeUndefined();
      h.setEnabled(true); await settle(); expect(projections(h)).toHaveLength(2); await admit(h);
    });
    const h = fixture(); await settle(); const old = h.transports[0]; h.dispose();
    expect(old.signal.aborted).toBe(true); old.resolve({ recordSlots: slots(old.payload.fields) }); await settle(); expect(h.writes).toEqual([]);
  });

  test("one edit sends the captured value and native selector, then publishes the exact source result", async () => withFixture({ representationTypeName: "NativeRecord" }, async h => {
    await admit(h); const edited = { z: 8, a: 3 }; h.edit("second", edited); h.edit("first", "duplicate gesture"); await settle();
    expect(updates(h)).toHaveLength(1); expect(h.api.ready()).toBe(false); expect(h.api.loading()).toBe(true);
    const flight = updates(h)[0];
    expect(flight.payload).toEqual({ method: "edit-reader-record-field", value: h.initialValue,
      field: "second", edited, representationTypeName: "NativeRecord" });
    expect(flight.payload.edited).not.toBe(edited); expect(Object.keys(flight.payload.edited)).toEqual(["z", "a"]);
    edited.z = 999; expect(flight.payload.edited.z).toBe(8);
    const updated = { unrelated: "preserved" }; Object.defineProperty(updated, "__proto__", { enumerable: true, value: "own field wire" });
    flight.resolve({ edit: ok(updated) }); await settle();
    expect(h.writes).toEqual([{ owner: "initial", value: updated }]); expect(h.writes[0].value).toBe(updated);
    expect(Object.hasOwn(h.writes[0].value, "__proto__")).toBe(true);
    // Demo 1 (typed keys never dropped): the gesture made during the flight
    // was kept and is sent now, against the same record.
    expect(updates(h)).toHaveLength(2);
    expect(updates(h)[1].payload).toEqual({ method: "edit-reader-record-field", value: h.initialValue,
      field: "first", edited: "duplicate gesture", representationTypeName: "NativeRecord" });
    updates(h)[1].resolve({ edit: ok("second result") }); await settle();
    expect(h.writes.at(-1)).toEqual({ owner: "initial", value: "second result" });
    expect(h.api.ready()).toBe(true); expect(h.api.loading()).toBe(false);
  }));

  for (const [label, change] of Object.entries({ ...changes, publication: h => h.replacePublication(),
    retirement: h => h.setEnabled(false), "silent worker replacement": h => h.replaceWorkerSilently() }))
    test(`${label} replacement fences an in-flight edited result`, async () => withFixture({}, async h => {
      await admit(h); h.edit("second", 9); await settle(); const flight = updates(h)[0];
      change(h); flight.resolve({ edit: ok({ stale: true }) }); await settle(); expect(h.writes).toEqual([]);
      if (!["publication", "silent worker replacement"].includes(label)) expect(flight.signal.aborted).toBe(true);
    }));

  test("a new slot receipt fences an older edit even when the input object is unchanged", async () => withFixture({}, async h => {
    await admit(h); h.edit("second", 9); await settle(); const edit = updates(h)[0], input = h.api.input();
    const retry = h.api.retry(); await settle(); expect(h.api.input()).toBe(input);
    const newReceipt = slots(h.initialFields);
    projections(h).at(-1).resolve({ recordSlots: newReceipt }); await retry; await settle();
    expect(h.api.paint().recordSlots).toBe(newReceipt); expect(h.api.ready()).toBe(false);
    edit.resolve({ edit: ok({ staleReceipt: true }) }); await settle(); expect(h.writes).toEqual([]);
    // The stale result is not published; its typed data is applied again to the new receipt.
    expect(updates(h)).toHaveLength(2); expect(updates(h)[1].payload.edited).toBe(9);
    updates(h)[1].resolve({ edit: ok({ current: true }) }); await settle();
    expect(h.writes).toEqual([{ owner: "initial", value: { current: true } }]); expect(h.api.ready()).toBe(true);
  }));

  test("publication replacement permits a new gesture and aborts the old one", async () => withFixture({}, async h => {
    await admit(h); h.edit("second", "old"); await settle(); const old = updates(h)[0];
    h.replacePublication(); await settle(); h.edit("second", "current"); await settle();
    expect(old.signal.aborted).toBe(true); expect(updates(h)).toHaveLength(2);
    old.resolve({ edit: ok("stale") }); updates(h)[1].resolve({ edit: ok("fresh") }); await settle();
    expect(h.writes).toEqual([{ owner: "replacement", value: "fresh" }]);
  }));

  for (const mode of ["replacement", "nested store"]) test(`a ${mode} UI path move fences the same aliased record occurrence`, async () =>
    withFixture({ coordinate: { path: ["data", "first"] } }, async h => {
      if (mode === "nested store") {
        h.setUseStores(true); h.setCoordinateStore(draft => { draft.path = ["data", "first"]; }); await settle();
      }
      await admit(h);
      const before = h.api.input(), publication = h.publication(), source = before.owner;
      h.edit("second", "old occurrence"); await settle(); const old = updates(h).at(-1);
      if (mode === "nested store") h.setCoordinateStore(draft => { draft.path[1] = "second"; });
      else h.setCoordinate({ path: ["data", "second"] });
      await settle();
      const after = h.api.input();
      expect(after.request.value).toBe(before.request.value); expect(after.request.fields).toBe(before.request.fields);
      expect(after.owner).toBe(source); expect(h.publication()).toBe(publication);
      expect(before.captured.coordinate.path).toEqual(["data", "first"]);
      expect(after.captured.coordinate.path).toEqual(["data", "second"]);
      expect(old.signal.aborted).toBe(true); expect(h.api.ready()).toBe(false);
      old.resolve({ edit: ok("obsolete occurrence") }); await settle(); expect(h.writes).toEqual([]);
      await admit(h); h.edit("second", "current occurrence"); await settle();
      updates(h).at(-1).resolve({ edit: ok("current occurrence result") }); await settle();
      expect(h.writes).toEqual([{ owner: "initial", value: "current occurrence result" }]);
      for (const flight of h.transports) {
        expect(Object.hasOwn(flight.payload, "coordinate")).toBe(false); expect(Object.hasOwn(flight.payload, "path")).toBe(false);
        expect(JSON.stringify(flight.payload)).not.toContain('"path"');
      }
    }));

  test("data typed while the record's data changes waits and is applied to the new record", async () => withFixture({}, async h => {
    await admit(h); h.setValue({ queued: true }); h.edit("second", "typed meanwhile"); await settle();
    expect(updates(h)).toHaveLength(0); expect(h.writes).toEqual([]); expect(h.api.ready()).toBe(false);
    projections(h).at(-1).resolve({ recordSlots: slots(projections(h).at(-1).payload.fields) }); await settle();
    expect(updates(h)).toHaveLength(1);
    expect(updates(h)[0].payload).toEqual({ method: "edit-reader-record-field", value: { queued: true }, field: "second", edited: "typed meanwhile" });
    updates(h)[0].resolve({ edit: ok({ queued: true, second: "typed meanwhile" }) }); await settle();
    expect(h.writes).toEqual([{ owner: "initial", value: { queued: true, second: "typed meanwhile" } }]);
  }));

  for (const [label, change] of Object.entries({ fields: h => h.setFields(["first"]),
    coordinate: h => h.setCoordinate({ row: 6 }), worker: h => h.setToken({ label: "queued" }) }))
    test(`queued ${label} change refuses a gesture before explicit flush`, async () => withFixture({}, async h => {
      await admit(h); change(h); h.edit("second", "stale gesture"); await settle();
      expect(updates(h)).toHaveLength(0); expect(h.writes).toEqual([]); expect(h.api.ready()).toBe(false);
      await admit(h);
    }));

  for (const [label, reply] of Object.entries({ refusal: { edit: err("source refused") }, missing: {}, malformed: { edit: { $tag: "Ok" } } }))
    test(`edit ${label} is bounded and releases the single-flight guard`, async () => withFixture({}, async h => {
      await admit(h); h.edit("second", 3); await settle(); updates(h)[0].resolve(reply); await settle();
      expect(h.writes).toEqual([]); expect(h.api.ready()).toBe(true); expect(h.api.loading()).toBe(false);
      expect(errorMessage(h.api.error())).toContain(label === "refusal" ? "source refused" : "could not be read");
      h.edit("second", 4); await settle(); expect(updates(h)).toHaveLength(2);
      updates(h)[1].resolve({ edit: ok("recovered") }); await settle(); expect(h.writes[0].value).toBe("recovered"); expect(h.api.error()).toBeUndefined();
    }));

  test("edit rejection and hostile edited descriptors refuse without source fallback", async () => withFixture({}, async h => {
    await admit(h); let getters = 0; const edited = {};
    Object.defineProperty(edited, "secret", { enumerable: true, get() { getters++; return "secret"; } });
    h.edit("second", edited); await settle(); expect(getters).toBe(0); expect(updates(h)).toHaveLength(0);
    expect(errorMessage(h.api.error())).toContain("accessor");
    h.edit("second", 4); await settle(); updates(h)[0].reject(new Error("edit transport refused")); await settle();
    expect(h.api.error()).toBe("edit transport refused"); expect(h.api.ready()).toBe(true); expect(h.edits).toEqual([]);
  }));

  test("disposal aborts in-flight edits and refuses late publication", async () => withFixture({}, async h => {
    await admit(h); h.edit("second", 3); await settle(); const flight = updates(h)[0]; h.dispose();
    expect(flight.signal.aborted).toBe(true); flight.resolve({ edit: ok("late") }); await settle(); expect(h.writes).toEqual([]);
  }));

  for (const options of [{ kind: "account" }, { foreignRegistry: true }, { context: { frame: "explicit" } }, { noReader: true }])
    test(`explicit source runs synchronously in its real context (${JSON.stringify(options)})`, async () => withFixture(options, async h => {
      expect(h.transports).toEqual([]); expect(h.api.ready()).toBe(true); expect(h.reads).toHaveLength(1);
      const expectedContext = options.context ?? (options.foreignRegistry ? h.foreignContext : h.authoring.evaluateContext);
      expect(h.reads[0]).toEqual([h.initialValue, h.initialFields, expectedContext]); expect(h.reads[0][2]).toBe(expectedContext);
      h.edit("second", { exact: true }); await settle();
      expect(h.edits).toEqual([[h.initialValue, "second", { exact: true }, expectedContext]]);
      expect(h.writes).toEqual([{ owner: "initial", value: { source: "edited" } }]);
    }));

  test("native representation keeps exact Local worker while fencing the explicit context identity", async () => withFixture({
    representationTypeName: "NativeRecord", context: { frame: "selector context" },
  }, async h => {
    expect(h.transports).toHaveLength(1); expect(h.reads).toEqual([]); expect(h.contextReads).toEqual([]);
    expect(h.transports[0].payload.representationTypeName).toBe("NativeRecord");
    await admit(h); h.edit("second", 8); await settle(); const flight = updates(h)[0];
    h.setContext({ frame: "new selector context" }); flight.resolve({ edit: ok("stale frame") }); await settle();
    expect(h.writes).toEqual([]); expect(flight.signal.aborted).toBe(true); expect(h.reads).toEqual([]);
  }));

  test("account source read and edit exceptions remain inline and recover", async () => withFixture({ kind: "account", readFailure: new Error("source read refused") }, async h => {
    expect(h.api.ready()).toBe(false); expect(errorMessage(h.api.error())).toBe("source read refused"); expect(h.transports).toEqual([]);
    h.setReadFailure(undefined); h.setValue({ recovered: true }); await settle(); expect(h.api.ready()).toBe(true);
    h.setEditFailure(new Error("source edit refused")); h.edit("second", 2); await settle();
    expect(h.api.error()).toBe("source edit refused"); expect(h.writes).toEqual([]); expect(h.api.ready()).toBe(true);
    h.setEditFailure(undefined); h.edit("second", 3); await settle(); expect(h.writes).toHaveLength(1); expect(h.api.error()).toBeUndefined();
  }));

  test("native guard blocks pending and busy mutations while preserving Tab, focus and text navigation", async () => withFixture({}, async h => {
    const element = new HostElement(); element.focused = true; h.api.guardElement(element);
    expect([...element.listeners.keys()]).toEqual(["beforeinput", "input", "click", "change", "keydown", "paste", "drop"]);
    const assertGuard = blocked => {
      for (const type of ["beforeinput", "input", "click", "change", "paste", "drop"]) {
        const event = element.dispatch(new HostEvent(type)); expect(event.defaultPrevented).toBe(blocked); expect(event.stopped).toBe(blocked);
      }
    };
    assertGuard(true);
    for (const key of ["Tab", "Escape"]) expect(element.dispatch(new HostKeyboardEvent(key)).defaultPrevented).toBe(false);
    for (const flags of [{ ctrlKey: true }, { metaKey: true }]) for (const key of ["a", "c"])
      expect(element.dispatch(new HostKeyboardEvent(key, flags)).defaultPrevented).toBe(false);
    for (const target of [new HostInputElement(), new HostTextAreaElement()]) for (const key of ["ArrowLeft", "ArrowRight", "Home", "End"])
      expect(element.dispatch(new HostKeyboardEvent(key, { target })).defaultPrevented).toBe(false);
    expect(element.dispatch(new HostKeyboardEvent("x")).defaultPrevented).toBe(true); expect(element.focused).toBe(true);
    await admit(h); assertGuard(false); h.edit("second", 9); assertGuard(true); await settle(); assertGuard(true); expect(element.focused).toBe(true);
    updates(h)[0].resolve({ edit: ok("done") }); await settle(); assertGuard(false);
    const replacement = new HostElement(); h.api.guardElement(replacement); expect(element.listeners.size).toBe(0);
    h.dispose(); expect(replacement.listeners.size).toBe(0);
  }));
});

describe("B4 F1: a Local reader whose page session throws on every registry/evaluator read", () => {
  test("record slots and edits are the worker's; the page frame is never read", async () => withFixture({ poisoned: true }, async h => {
    expect(projections(h)).toHaveLength(1);
    await admit(h);
    const edited = h.edit("first", "changed"); await settle();
    expect(updates(h)).toHaveLength(1);
    expect(h.reads).toEqual([]); expect(h.edits).toEqual([]); expect(h.contextReads).toEqual([]);
    updates(h)[0].resolve({ edit: { $tag: "Ok", _0: { source: "edited" } } }); await edited; await settle();
  }));

  test("a native representation's record without a supplied frame stays in the worker", async () =>
    withFixture({ poisoned: true, representationTypeName: "NativeRecord" }, async h => {
      expect(projections(h)).toHaveLength(1);
      expect(projections(h)[0].payload.representationTypeName).toBe("NativeRecord");
      expect(h.reads).toEqual([]);
    }));

  test("an explicitly supplied frame is a custom page frame, compared with nothing on the page session", async () =>
    withFixture({ poisoned: true, context: { frame: "explicit" } }, async h => {
      expect(projections(h)).toEqual([]);
      expect(h.reads).toHaveLength(1);
      expect(h.api.ready()).toBe(true);
    }));

  test("a foreign registry uses its own frame without reading the page session", async () =>
    withFixture({ poisoned: true, foreignRegistry: true }, async h => {
      expect(projections(h)).toEqual([]);
      expect(h.contextReads).toEqual(["foreign"]);
      expect(h.api.ready()).toBe(true);
    }));
});
