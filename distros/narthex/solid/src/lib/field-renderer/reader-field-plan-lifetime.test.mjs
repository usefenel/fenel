import { describe, expect, test } from "bun:test";
import { createRoot, createSignal, createMemo, createEffect, createStore, flush, isPending, latest, onSettled, refresh, untrack }
  from "../../../node_modules/solid-js/dist/solid.dev.js";

// C1 host controls: run the production field-plan lifetime and strict copier
// in the real Solid 2 graph. Registry semantics, RPC delivery and DOM event
// dispatch are explicit controlled ports; no registry or browser worker boots.
const [source, asyncSource, registrySource, occurrenceSource, stringSource] = await Promise.all([
  Bun.file(new URL("./FieldRenderer.tsx", import.meta.url)).text(),
  Bun.file(new URL("../async-value.ts", import.meta.url)).text(),
  Bun.file(new URL("../../../../../../implementations/typescript/engine/src/registry-transport.ts", import.meta.url)).text(),
  Bun.file(new URL("../field-occurrence/model.ts", import.meta.url)).text(),
  Bun.file(new URL("./string-input-surface.tsx", import.meta.url)).text(),
]);
const transpiler = new Bun.Transpiler({ loader: "ts" });
const compile = code => transpiler.transformSync(code).replace(/^export /gm, "");
function section(text, begin, end) {
  const start = text.indexOf(begin), finish = text.indexOf(end, start + begin.length);
  if (start < 0 || finish < start) throw new Error(`The field-plan fixture boundary moved: ${begin}`);
  return text.slice(start, finish);
}
const helper = section(source, "function createReaderFieldPlan(", "/** Shared label row");
const occurrenceHelper = section(source, "function readerFieldOccurrenceKey(", "/** A2/B3 field-plan lifetime");
const ownerHelper = section(source, "function localFieldSelectionWorker(", "/** Adapts the Fenel-owned edit plan");
const publishGates = {
  body: section(source.slice(source.indexOf("function FieldRendererBody(")), "  const change = createFieldChange(", "\n"),
  nested: section(source.slice(source.indexOf("function TypeEditor(")), "  const change = createFieldChange(", "\n"),
};
// Nov 13: both controls build their change callback through one helper and the pure publish gate.
const changeHelper = section(source, "function createFieldChange(", "/** B4 wave 4 lane E");
const requestKeyHelper = section(source, "function planRequestKeyApartFromValue(", "function samePlanRequest(");
const createFieldPublishGate = new Function(`${compile(await Bun.file(new URL("./field-publish-gate.ts", import.meta.url)).text())}; return createFieldPublishGate;`)();
const gateOccurrenceKey = new Function("namedFieldId", `${compile(section(source, "function readerFieldOccurrenceKey(",
  "/** A2 native interaction lifetime"))}; return readerFieldOccurrenceKey;`)(field => namedFieldId(field));
const gateSameFieldOwner = new Function(`${compile(section(source, "function sameFieldOwner(", "/** Two plan owners"))}; return sameFieldOwner;`)();
const channelCode = section(source.slice(source.indexOf("function FieldRendererBody(")),
  "  const channelOwner = createMemo(", "  const preparation = createReaderFieldPlan(");
const copier = new Function(`${compile(section(registrySource, "export function registryTransportSnapshot<",
  "/** An injective text encoding of a transport value,"))}; return registryTransportSnapshot;`)();
const namedFieldId = new Function(`${compile(section(occurrenceSource, "export function namedFieldId(",
  "export type ParsedNamedFieldOccurrence"))}; return namedFieldId;`)();
const stringBody = section(stringSource, "  let model =", "\n  return (");
const stringValueExpressions = [...stringSource.matchAll(/\bvalue=\{([^}]+)\}/g)].map(match => match[1]);
if (stringValueExpressions.length !== 2 || stringValueExpressions[0] !== stringValueExpressions[1])
  throw new Error("The native string controls no longer share one value projection.");
const nativeString = new Function("createSignal", "createEffect", "untrack", "latest", "props",
  `${compile(stringBody)}; return { input, displayed: () => (${stringValueExpressions[0]}) };`);
const createAsyncValue = new Function("createMemo", "createSignal", "isPending", "refresh",
  `${compile(asyncSource.slice(asyncSource.indexOf("const LOADING:")))}; return createAsyncValue;`)
  (createMemo, createSignal, isPending, refresh);
const deferred = () => {
  let resolve, reject;
  const promise = new Promise((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
};
const nothing = { $tag: "Nothing" };
const listPacket = label => ({ plan: { name: "value", label, typeLabel: "List String", required: true,
  editor: { kind: "list", rawType: { $ref: "List" }, itemType: { $ref: "String" }, choices: { $tag: "Nothing" }, canonical: false } },
  channels: [], activeChannelId: undefined });
const packet = label => ({ plan: { name: "value", label, typeLabel: "String", required: true,
  editor: { kind: "text", rawType: { $ref: "String" }, widget: "text", inputType: "text" } },
  channels: [{ id: "native", name: "Keyboard", kind: "text" }], activeChannelId: "native" });
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
  addEventListener(name, callback, capture) {
    expect(capture).toBe(true); this.listeners.set(name, callback);
  }
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
    const contextReads = [], transports = [], synchronous = [], captures = [], observations = [], writes = [];
    const plainSessionFor = label => ({ registry: { label, evaluateContext() { contextReads.push(label); return { frame: label }; } },
      evaluateContext: { frame: label }, environment: {} });
    const sessionFor = label => options.poisoned ? poisonedSession(plainSessionFor(label)) : plainSessionFor(label);
    const initialSession = sessionFor("reader");
    const [session, setSession] = createSignal(initialSession);
    const foreignFrame = { frame: "explicit other owner" };
    const [registry, setRegistry] = createSignal(options.staleRegistry ?? (options.foreignRegistry
      ? { label: "other owner", evaluateContext() { contextReads.push("foreign"); return foreignFrame; } } : ownRegistryOf(initialSession)));
    const [epoch, setEpoch] = createSignal(2);
    const [revision, setRevision] = createSignal(7);
    const [workerToken, setWorkerToken] = createSignal({ label: "worker-one" });
    const [available, setAvailable] = createSignal(options.available !== false);
    const [notification, setNotification] = createSignal(0);
    const initialField = { name: "value", type: { $el: { var: "selectedType" } }, label: nothing, ui: nothing, meta: {} };
    const initialValue = options.value ?? { second: "value", first: "kept" };
    const initialSiblings = options.siblings ?? { selectedType: { $ref: "String" }, untouched: false };
    const [fieldStore, setFieldStore] = createStore(options.field ?? initialField);
    const [field, setField] = createSignal(options.fieldStore ? fieldStore : options.field ?? initialField);
    const [value, setValue] = createSignal(initialValue);
    const [siblings, setSiblings] = createSignal(initialSiblings);
    const [channelId, setChannelId] = createSignal(undefined);
    const [fieldMode, setFieldMode] = createSignal(options.fieldMode ?? "transient");
    const [enabled, setEnabled] = createSignal(options.enabled !== false);
    const [siblingStore, setSiblingStore] = createStore({ selectedType: { $ref: "String" }, marker: "before" });
    const [valueStore, setValueStore] = createStore({ nested: { amount: 1 }, marker: "before", items: [{ z: 2, a: 1 }] });
    const [useStores, setUseStores] = createSignal(false);
    const initialPublish = next => { writes.push({ owner: "initial", value: next }); };
    const [publisher, setPublisher] = createSignal({ fn: initialPublish });
    let publisherReads = 0;
    const handles = new WeakMap();
    let silentToken, workerFailure;
    const preparedReaderWorkerForSession = selected => {
      notification();
      if (workerFailure) throw workerFailure;
      if (!available()) return undefined;
      const token = silentToken ?? workerToken();
      let byToken = handles.get(selected);
      if (!byToken) { byToken = new WeakMap(); handles.set(selected, byToken); }
      let handle = byToken.get(token);
      if (!handle) { handle = { session: selected, token }; byToken.set(token, handle); }
      return handle;
    };
    const reader = { kind: options.kind ?? "local", session, revision, registry: () => ownRegistryOf(session()) };
    const request = () => enabled() ? { field: field(), value: useStores() ? valueStore : value(),
      recordValues: useStores() ? siblingStore : siblings(), fieldMode: fieldMode(), channelsEnabled: true, channelId: channelId() } : undefined;
    const bindings = {
      createMemo, createSignal, createAsyncValue, latest, isPending, onSettled,
      KeyboardEvent: HostKeyboardEvent,
      HTMLInputElement: HostInputElement,
      HTMLTextAreaElement: HostTextAreaElement,
      DETACHED_AUTHORING_SESSION: { detached: true },
      sessionEpoch: epoch,
      preparedReaderWorkerForSession,
      registryHasSnapshotOwner: candidate => !!options.staleRegistry && candidate === options.staleRegistry,
      namedFieldId,
      registryTransportSnapshot: (input, label, mode, readDataProperty) => {
        captures.push({ input, label, mode, readDataProperty }); return copier(input, label, mode, readDataProperty);
      },
      fieldReaderPlan: args => { synchronous.push(args); return packet("page-owned plan"); },
      runPreparedReaderWorker: (handle, payload, signal) => {
        const held = deferred(); transports.push({ handle, payload, signal, ...held }); return held.promise;
      },
    };
    const create = new Function(...Object.keys(bindings), `${compile(`${ownerHelper}\n${occurrenceHelper}\n${helper}`)}; return createReaderFieldPlan;`)(...Object.values(bindings));
    const api = create(request, registry, reader, initialSession, options.retainTransientSlot ?? options.control === "nested");
    const channel = options.channelControls ? new Function(...Object.keys(bindings), "registry", "reader", "authoring", "props",
      `${compile(`${ownerHelper}\n${occurrenceHelper}\n${channelCode}`)};
        return { owner: channelOwner, id: channelId, setIntent: setChannelIntent };`)
      (...Object.values(bindings), registry, reader, initialSession, { get field() { return field(); } }) : undefined;
    const change = new Function("createMemo", "createEffect", "latest", "preparation", "props", "readerFieldOccurrenceKey", "sameFieldOwner",
      "createFieldPublishGate",
      `${compile(`${requestKeyHelper}\n${changeHelper}`)}\n${compile(publishGates[options.control ?? "body"])}; return () => change().callback;`)
      (createMemo, createEffect, latest, api, { get onChange() { publisherReads++; const current = publisher().fn;
        return options.freshPublisher ? value => current(value) : current; } }, gateOccurrenceKey, gateSameFieldOwner, createFieldPublishGate);
    createEffect(() => ({ ready: api.ready(), loading: api.loading(), error: api.error(), presentation: api.presentation(), paint: api.paint(), callback: change(), channel: channel?.id() }),
      state => { observations.push(state); });
    return { api, reader, initialSession, initialField, initialValue, initialSiblings, sessionFor,
      contextReads, transports, synchronous, captures, observations, session, setSession, registry, setRegistry, foreignFrame,
      epoch, setEpoch, revision, setRevision, field, setField, fieldStore, setFieldStore, value, setValue, siblings, setSiblings,
      channelId, setChannelId, fieldMode, setFieldMode, setEnabled, setUseStores, siblingStore, setSiblingStore, valueStore, setValueStore,
      setAvailable, setWorkerToken,
      change, channel, writes, replacePublish: () => setPublisher({ fn: next => { writes.push({ owner: "replacement", value: next }); } }),
      publisherReads: () => publisherReads,
      replaceWorkerSilently: () => { silentToken = { label: "worker-replaced-without-notification" }; },
      setWorkerFailure: error => { workerFailure = error; setNotification(count => count + 1); },
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
async function admit(h, label = "current") {
  const request = h.transports.at(-1), result = packet(label);
  request.resolve({ fieldPlan: result }); await settle();
  expect(h.api.ready()).toBe(true);
  expect(h.api.presentation()).toBe(result);
  return result;
}

describe("Local reader answers never hold a Solid transition", () => {
  // Demo 1 (2026-11-08): a CalendarDate part's sibling plans stayed "Preparing"
  // for good once a held re-plan transition parked; each Local worker read is
  // per field and starts a fresh flight instead (createAsyncValue option).
  for (const method of ["project-reader-field-plan", "project-reader-record-slots",
    "project-reader-list-selection", "project-reader-choice-selection"]) test(`${method} reads with holdTransitions false`, () => {
    const at = source.indexOf(`method: "${method}"`);
    expect(at).toBeGreaterThan(0);
    const opened = source.lastIndexOf("createAsyncValue(", at);
    const closed = source.indexOf("\n  }", at);
    expect(opened).toBeGreaterThan(0);
    expect(source.slice(opened, at)).not.toContain("\n  }");
    expect(source.slice(closed, closed + 40).replace(/\r/g, "")).toStartWith("\n  }, { holdTransitions: false });");
  });
});

describe("reader field plan worker lifetime", () => {
  test("matching Local planning captures data before RPC and never computes a page plan", async () => withFixture({}, async h => {
    expect(h.api.ready()).toBe(false);
    expect(h.api.presentation()).toBeUndefined();
    expect(h.api.loading()).toBe(true);
    expect(h.transports).toHaveLength(1);
    const request = h.transports[0];
    expect(request.payload).toEqual({ method: "project-reader-field-plan", field: h.initialField, value: h.initialValue,
      recordValues: h.initialSiblings, fieldMode: "transient", channelsEnabled: true, channelId: undefined });
    expect(request.payload.field).not.toBe(h.initialField);
    expect(request.payload.value).not.toBe(h.initialValue);
    expect(request.payload.recordValues).not.toBe(h.initialSiblings);
    expect(Object.keys(request.payload.value)).toEqual(["second", "first"]);
    expect(h.captures.every(row => row.mode === "equality")).toBe(true);
    expect(h.captures.every(row => row.readDataProperty === Reflect.get)).toBe(true);
    expect(h.contextReads).toEqual([]);
    expect(h.synchronous).toEqual([]);
    h.initialValue.second = "changed after capture";
    h.initialSiblings.selectedType.$ref = "Number";
    expect(request.payload.value.second).toBe("value");
    expect(request.payload.recordValues.selectedType.$ref).toBe("String");
    await admit(h);
    expect(h.synchronous).toEqual([]);
  }));

  test("missing and refused Local workers fail without page fallback", async () => {
    await withFixture({ available: false }, async h => {
      expect(h.api.ready()).toBe(false);
      expect(h.api.error()?.message).toContain("not ready");
      expect(h.transports).toEqual([]); expect(h.synchronous).toEqual([]);
    });
    await withFixture({}, async h => {
      h.transports[0].reject(new Error("Current worker refused")); await settle();
      expect(h.api.ready()).toBe(false); expect(h.api.error()?.message).toBe("Current worker refused");
      expect(h.synchronous).toEqual([]);
    });
  });

  for (const member of ["field", "value", "siblings"]) test(`hidden ${member} descriptors refuse before any worker or page observation`, async () => {
    const value = { visible: true };
    Object.defineProperty(value, "hidden", { value: "must stay unreadable", enumerable: false });
    const options = member === "field" ? { field: { name: "value", type: { $ref: "String" }, meta: value } }
      : member === "siblings" ? { siblings: value } : { value };
    await withFixture(options, async h => {
      expect(h.api.ready()).toBe(false); expect(h.api.error()?.message).toContain("non-enumerable");
      expect(h.transports).toEqual([]); expect(h.synchronous).toEqual([]);
    });
  });

  const changes = {
    field: h => h.setField({ ...h.field(), type: { $ref: "Number" } }),
    value: h => h.setValue({ changed: true }),
    siblings: h => h.setSiblings({ selectedType: { $ref: "Number" } }),
    "channel intent": h => h.setChannelId("address"),
    revision: h => h.setRevision(h.revision() + 1),
    session: h => { const next = h.sessionFor("replacement"); h.setSession(next); h.setRegistry(next.registry); },
    worker: h => h.setWorkerToken({ label: "worker-two" }),
    epoch: h => h.setEpoch(h.epoch() + 1),
  };
  for (const [label, change] of Object.entries(changes)) test(`${label} replacement aborts the old projection and publishes only the new answer`, async () => withFixture({}, async h => {
    const old = h.transports[0]; change(h); await settle();
    expect(old.signal.aborted).toBe(true);
    expect(h.api.ready()).toBe(false);
    expect(h.transports).toHaveLength(2);
    old.resolve({ fieldPlan: packet("stale") }); await settle();
    expect(h.api.ready()).toBe(false);
    expect(h.api.presentation()?.plan.label).not.toBe("stale");
    await admit(h, "replacement");
    expect(h.synchronous).toEqual([]);
  }));

  test("a queued sibling update fences a reply before an explicit flush", async () => withFixture({}, async h => {
    const old = h.transports[0];
    h.setSiblings({ selectedType: { $ref: "Number" } });
    old.resolve({ fieldPlan: packet("queued stale") });
    await settle();
    expect(h.api.ready()).toBe(false);
    expect(h.api.presentation()?.plan.label).not.toBe("queued stale");
    await admit(h, "latest siblings");
  }));

  for (const member of ["siblings", "value"]) test(`live ${member} store edits replace the captured projection`, async () => withFixture({}, async h => {
    h.setUseStores(true); await settle();
    const old = h.transports.at(-1), count = h.transports.length;
    if (member === "siblings") h.setSiblingStore(draft => { draft.marker = "after"; draft.selectedType.$ref = "Number"; });
    else h.setValueStore(draft => { draft.marker = "after"; draft.nested.amount = 2; });
    await settle();
    expect(old.signal.aborted).toBe(true);
    expect(h.transports).toHaveLength(count + 1);
    const current = h.transports.at(-1).payload;
    expect(member === "siblings" ? current.recordValues.marker : current.value.marker).toBe("after");
    expect(member === "siblings" ? current.recordValues.selectedType.$ref : current.value.nested.amount).toBe(member === "siblings" ? "Number" : 2);
    expect(member === "siblings" ? old.payload.recordValues.marker : old.payload.value.marker).toBe("before");
    expect(member === "siblings" ? old.payload.recordValues.selectedType.$ref : old.payload.value.nested.amount).toBe(member === "siblings" ? "String" : 1);
    old.resolve({ fieldPlan: packet("store stale") }); await settle();
    expect(h.api.ready()).toBe(false);
    await admit(h, "latest store");
  }));

  test("nested-only live array edits capture current members and length in order", async () => withFixture({}, async h => {
    h.setUseStores(true); await settle();
    const old = h.transports.at(-1);
    h.setValueStore(draft => { draft.items[0].z = 7; draft.items.push({ z: 3, a: 4 }); });
    await settle();
    const current = h.transports.at(-1).payload.value.items;
    expect(old.signal.aborted).toBe(true);
    expect(current).toEqual([{ z: 7, a: 1 }, { z: 3, a: 4 }]);
    expect(Object.keys(current[0])).toEqual(["z", "a"]);
    expect(old.payload.value.items).toEqual([{ z: 2, a: 1 }]);
    await admit(h, "current array");
  }));

  for (const member of ["siblings", "value"]) test(`newly overlaid ${member} accessor is refused without executing it`, async () => withFixture({}, async h => {
    h.setUseStores(true); await settle();
    const old = h.transports.at(-1), requests = h.transports.length;
    let reads = 0;
    const hostile = {};
    Object.defineProperty(hostile, "secret", { enumerable: true, get() { reads++; return "must not read"; } });
    if (member === "siblings") h.setSiblingStore(draft => { draft.selectedType = hostile; });
    else h.setValueStore(draft => { draft.nested = hostile; });
    expect(reads).toBe(0);
    await settle();
    expect(reads).toBe(0);
    expect(old.signal.aborted).toBe(true); expect(h.transports).toHaveLength(requests);
    expect(h.api.ready()).toBe(false); expect(h.api.error()?.message).toContain("accessor");
    expect(h.synchronous).toEqual([]);
  }));

  test("silent worker replacement refuses a late successful answer", async () => withFixture({}, async h => {
    h.replaceWorkerSilently();
    h.transports[0].resolve({ fieldPlan: packet("retired") }); await settle();
    expect(h.api.ready()).toBe(false);
    expect(h.api.presentation()).toBeUndefined();
    expect(h.api.error()?.message).toContain("changed");
    expect(h.synchronous).toEqual([]);
  }));

  test("same-lifetime presentation stays visible while every mutating event is blocked", async () => withFixture({}, async h => {
    const admitted = await admit(h, "retained");
    const element = new HostElement(); h.api.guardElement(element);
    expect(element.dispatch(new HostEvent("input")).defaultPrevented).toBe(false);
    h.setSiblings({ selectedType: { $ref: "Number" } }); await settle();
    expect(h.api.ready()).toBe(false);
    expect(h.api.presentation()).toBe(admitted);
    for (const name of ["beforeinput", "input", "click", "change", "paste", "drop"]) {
      const event = element.dispatch(new HostEvent(name));
      expect(event.defaultPrevented).toBe(true); expect(event.stopped).toBe(true);
    }
    expect(element.dispatch(new HostKeyboardEvent("x")).defaultPrevented).toBe(true);
    for (const event of [new HostKeyboardEvent("Tab"), new HostKeyboardEvent("Escape"),
      new HostKeyboardEvent("c", { ctrlKey: true }), new HostKeyboardEvent("a", { metaKey: true })])
      expect(element.dispatch(event).defaultPrevented).toBe(false);
    for (const target of [new HostInputElement(), new HostTextAreaElement()]) {
      for (const key of ["ArrowLeft", "ArrowRight", "Home", "End"])
        expect(element.dispatch(new HostKeyboardEvent(key, { target })).defaultPrevented).toBe(false);
    }
    expect(element.dispatch(new HostKeyboardEvent("ArrowLeft", { target: element })).defaultPrevented).toBe(true);
    await admit(h, "current");
    expect(element.dispatch(new HostEvent("input")).defaultPrevented).toBe(false);
    h.dispose();
    expect(element.listeners.size).toBe(0);
  }));

  for (const change of ["field", "session", "worker", "epoch"]) test(`${change} retirement clears the retained presentation`, async () => withFixture({}, async h => {
    await admit(h);
    changes[change](h); await settle();
    expect(h.api.ready()).toBe(false);
    expect(h.api.presentation()).toBeUndefined();
  }));

  test("a refused replacement retains display while its interaction guard stays closed", async () => withFixture({}, async h => {
    const admitted = await admit(h, "retained after refusal");
    const element = new HostElement(); h.api.guardElement(element);
    h.setSiblings({ selectedType: { $ref: "Number" } }); await settle();
    h.transports[1].reject(new Error("Replacement refused")); await settle();
    expect(h.api.presentation()).toBe(admitted);
    expect(h.api.ready()).toBe(false); expect(h.api.error()?.message).toBe("Replacement refused");
    expect(element.dispatch(new HostEvent("input")).defaultPrevented).toBe(true);
    expect(h.synchronous).toEqual([]);
  }));

  test("disposal aborts pending work and cannot revive an editor from a late response", async () => withFixture({}, async h => {
    const old = h.transports[0], observations = h.observations.length;
    h.dispose(); expect(old.signal.aborted).toBe(true);
    old.resolve({ fieldPlan: packet("after dispose") }); await settle();
    expect(h.observations).toHaveLength(observations);
    expect(h.synchronous).toEqual([]);
  }));

  test("an absent request starts no planning and retires in-flight work", async () => withFixture({}, async h => {
    const old = h.transports[0]; h.setEnabled(false); await settle();
    expect(old.signal.aborted).toBe(true);
    expect(h.api.presentation()).toBeUndefined(); expect(h.api.ready()).toBe(false);
    old.resolve({ fieldPlan: packet("disabled") }); await settle();
    expect(h.api.presentation()).toBeUndefined();
    expect(h.transports).toHaveLength(1);
  }));

  test("an initially absent request does not acquire an owner or capture data", async () => withFixture({ enabled: false }, async h => {
    expect(h.api.ready()).toBe(false); expect(h.api.presentation()).toBeUndefined();
    expect(h.captures).toEqual([]); expect(h.contextReads).toEqual([]);
    expect(h.transports).toEqual([]); expect(h.synchronous).toEqual([]);
    h.setEnabled(true); await settle();
    expect(h.transports).toHaveLength(1);
    await admit(h);
  }));

  for (const [index, reply] of [{}, { fieldPlan: {} }, { fieldPlan: { plan: { editor: {} } } }].entries())
    test(`unreadable worker plan ${index + 1} stays refused without another backend`, async () => withFixture({}, async h => {
      h.transports[0].resolve(reply); await settle();
      expect(h.api.ready()).toBe(false); expect(h.api.error()?.message).toContain("could not be read");
      expect(h.api.presentation()).toBeUndefined(); expect(h.synchronous).toEqual([]);
    }));

  test("Retry keeps the retained frame blocked until the new current answer", async () => withFixture({}, async h => {
    const admitted = await admit(h, "before retry");
    const element = new HostElement(); h.api.guardElement(element);
    const retrying = h.api.retry(); await settle();
    expect(h.transports).toHaveLength(2);
    expect(h.api.presentation()).toBe(admitted);
    expect(h.api.ready()).toBe(false);
    expect(element.dispatch(new HostEvent("input")).defaultPrevented).toBe(true);
    await admit(h, "after retry"); await retrying; await settle();
    expect(h.api.ready()).toBe(true);
    expect(element.dispatch(new HostEvent("input")).defaultPrevented).toBe(false);
    expect(h.synchronous).toEqual([]);
  }));

  for (const mode of ["account", "public", "foreign"]) test(`${mode} keeps its explicit synchronous owner`, async () => withFixture({
    kind: mode === "foreign" ? "local" : mode, foreignRegistry: mode === "foreign",
  }, async h => {
    expect(h.transports).toEqual([]); expect(h.synchronous).toHaveLength(1);
    expect(h.api.ready()).toBe(true);
    expect(h.api.presentation().plan.label).toBe("page-owned plan");
    expect(h.synchronous[0].registry).toBe(h.registry());
    expect(h.synchronous[0].evaluateContext).toBe(mode === "foreign" ? h.foreignFrame : h.initialSession.evaluateContext);
  }));
});

describe("A2 guard: structural edits wait for the current plan; native text edits pass while the occurrence accepts text", () => {
  // Demo 1 (2026-11-08): keys typed while an unrelated transition was pending
  // were dropped by the guard although the field's latest plan was current.
  const makeGuard = new Function("isPending", "latest", "onSettled", "KeyboardEvent", "HTMLInputElement", "HTMLTextAreaElement",
    `${compile(section(source, "function createReaderInteractionGuard(", "/** A2/B3 field-plan lifetime"))}; return createReaderInteractionGuard;`)
    (isPending, latest, onSettled, HostKeyboardEvent, HostInputElement, HostTextAreaElement);
  const on = (event, target) => { event.target = target; return event; };
  test("text edits into a text input pass; structural events and other keys stay blocked", () => createRoot(dispose => {
    const [accepts, setAccepts] = createSignal(true);
    const element = new HostElement(); makeGuard(() => false, accepts)(element);
    for (const target of [new HostInputElement(), new HostTextAreaElement()]) {
      for (const type of ["beforeinput", "input", "paste"]) expect(element.dispatch(on(new HostEvent(type), target)).defaultPrevented).toBe(false);
      for (const key of ["2", "0", "x", " ", "Backspace", "Delete"]) expect(element.dispatch(new HostKeyboardEvent(key, { target })).defaultPrevented).toBe(false);
      for (const type of ["click", "change", "drop"]) {
        const event = element.dispatch(on(new HostEvent(type), target)); expect(event.defaultPrevented).toBe(true); expect(event.stopped).toBe(true);
      }
      for (const event of [new HostKeyboardEvent("Enter", { target }), new HostKeyboardEvent("x", { target, ctrlKey: true }),
        new HostKeyboardEvent("v", { target, metaKey: true })]) expect(element.dispatch(event).defaultPrevented).toBe(true);
    }
    // Text events that do not edit a text input stay blocked.
    expect(element.dispatch(new HostEvent("input")).defaultPrevented).toBe(true);
    expect(element.dispatch(new HostKeyboardEvent("x")).defaultPrevented).toBe(true);
    // When the occurrence no longer accepts text, typing waits like any other edit.
    setAccepts(false); flush();
    expect(element.dispatch(on(new HostEvent("input"), new HostInputElement())).defaultPrevented).toBe(true);
    expect(element.dispatch(new HostKeyboardEvent("x", { target: new HostInputElement() })).defaultPrevented).toBe(true);
    dispose();
  }));
  test("without a text rule the guard keeps the strict A2 behavior", () => createRoot(dispose => {
    const element = new HostElement(); makeGuard(() => false)(element);
    expect(element.dispatch(on(new HostEvent("input"), new HostInputElement())).defaultPrevented).toBe(true);
    expect(element.dispatch(new HostKeyboardEvent("x", { target: new HostInputElement() })).defaultPrevented).toBe(true);
    dispose();
  }));
});

describe("typing re-plans only a field whose plan reads the typed data", () => {
  // Demo 1 (2026-11-08): "2026" typed key by key into a CalendarDate year kept
  // only "2": every key re-planned the field and its siblings, and the guard
  // blocked the next keys until the new plan landed. The engine reads a value
  // only for a list editor and siblings only through `$el` (see planReadsData).
  const plain = { name: "year", type: { $ref: "Int" }, key: { $tag: "NamedField", ref: { $ref: "year-id" } }, label: nothing, ui: nothing, meta: {} };
  test("each typed key reuses a scalar plan: no worker request, ready, the new value painted", async () => withFixture({ field: plain, value: 2 }, async h => {
    const admitted = await admit(h, "year");
    const requests = h.transports.length;
    const element = new HostElement(); h.api.guardElement(element);
    for (const typed of [20, 202, 2026]) {
      h.setValue(typed); await settle();
      expect(h.transports).toHaveLength(requests);
      expect(h.api.ready()).toBe(true);
      expect(h.api.presentation()).toBe(admitted);
      expect(h.api.paint().value).toBe(typed);
      expect(element.dispatch(new HostEvent("input")).defaultPrevented).toBe(false);
    }
    h.change()(2026);
    expect(h.writes).toEqual([{ owner: "initial", value: 2026 }]);
  }));
  test("a sibling edit reuses a plan whose type does not depend on its siblings", async () => withFixture({ field: plain, value: 2 }, async h => {
    await admit(h, "month");
    const requests = h.transports.length;
    h.setSiblings({ year: 2026, month: 11 }); await settle();
    expect(h.transports).toHaveLength(requests);
    expect(h.api.ready()).toBe(true);
  }));
  test("a dependent ($el) field still re-plans on a sibling edit", async () => withFixture({}, async h => {
    await admit(h, "dependent");
    const requests = h.transports.length;
    h.setSiblings({ selectedType: { $ref: "Number" } }); await settle();
    expect(h.transports).toHaveLength(requests + 1);
    expect(h.api.ready()).toBe(false);
    await admit(h, "replanned");
  }));
  test("a list plan re-plans on a value change (its canonical choices read the value)", async () => withFixture({ field: plain, value: ["a"] }, async h => {
    const result = listPacket("list"); h.transports.at(-1).resolve({ fieldPlan: result }); await settle();
    expect(h.api.ready()).toBe(true);
    const requests = h.transports.length;
    h.setValue(["a", "b"]); await settle();
    expect(h.transports).toHaveLength(requests + 1);
    expect(h.transports.at(-1).payload.value).toEqual(["a", "b"]);
    expect(h.api.ready()).toBe(false);
  }));
  test("a field or owner change still re-plans even when only data moved before", async () => withFixture({ field: plain, value: 2 }, async h => {
    await admit(h, "year");
    const requests = h.transports.length;
    h.setValue(20); await settle();
    h.setField({ ...plain, type: { $ref: "Number" } }); await settle();
    expect(h.transports).toHaveLength(requests + 1);
    h.transports.at(-1).resolve({ fieldPlan: packet("number") }); await settle();
    h.setRevision(h.revision() + 1); await settle();
    expect(h.transports).toHaveLength(requests + 2);
  }));
});

describe("coherent retained field paint", () => {
  const liveKeyChanges = [
    { name: "NamedField UUID", key: { $tag: "NamedField", ref: { $ref: "before" } },
      edit: draft => { draft.key.ref.$ref = "after"; }, expected: { $tag: "NamedField", ref: { $ref: "after" } } },
    { name: "PositionalField ordinal", key: { $tag: "PositionalField", index: 0 },
      edit: draft => { draft.key.index = 1; }, expected: { $tag: "PositionalField", index: 1 } },
    { name: "key removal", key: { $tag: "NamedField", ref: { $ref: "removed" } },
      edit: draft => { delete draft.key; }, expected: undefined },
  ];
  for (const control of ["body", "nested"]) for (const mutation of liveKeyChanges)
    test(`${control} clears retained paint after same-proxy ${mutation.name} mutation`, async () => withFixture({
      control, fieldStore: true, field: { name: "value", type: { $ref: "String" }, key: structuredClone(mutation.key) },
    }, async h => {
      await admit(h, "before key change");
      const original = h.field(), oldRequest = h.transports.at(-1), oldPublish = h.change();
      h.setFieldStore(mutation.edit);
      oldPublish("queued old occurrence"); expect(h.writes).toEqual([]);
      await settle();
      expect(h.field()).toBe(original);
      if (mutation.expected?.$tag === "NamedField") expect(h.field().key.ref.$ref).toBe("after");
      else if (mutation.expected?.$tag === "PositionalField") expect(h.field().key.index).toBe(1);
      else expect(h.field().key).toBeUndefined();
      expect(h.transports.at(-1).payload.field).toBe(h.api.input().captured.field);
      expect(h.transports.at(-1).payload.field.key).toEqual(mutation.expected);
      expect(h.api.ready()).toBe(false); expect(h.api.paint()).toBeUndefined();
      expect(oldRequest.payload.field.key).toEqual(mutation.key);
      await admit(h, "new occurrence");
      oldPublish("late old occurrence"); expect(h.writes).toEqual([]);
      h.change()("current occurrence");
      expect(h.writes).toEqual([{ owner: "initial", value: "current occurrence" }]);
    }));

  for (const key of [{ $tag: "NamedField", ref: { $ref: "same-field" } }, { $tag: "PositionalField", index: 2 }])
    test(`${key.$tag} clones retain only their admitted field/value/plan pair`, async () => withFixture({
      field: { name: "original", type: { $ref: "String" }, key, label: nothing, ui: nothing, meta: {} },
      value: { marker: "original" },
    }, async h => {
      const old = h.transports[0], admitted = await admit(h, "original");
      expect(h.api.paint().field).toBe(h.field());
      expect(h.api.paint().value).toBe(h.value());
      const nextField = { ...h.field(), name: "renamed", key: structuredClone(key), type: { $ref: "Number" } };
      const nextValue = { marker: "replacement" };
      h.setField(nextField); h.setValue(nextValue); await settle();
      expect(h.api.ready()).toBe(false);
      expect(h.api.paint()).toEqual({ result: admitted, field: old.payload.field, value: old.payload.value });
      expect(h.api.paint().field).toBe(old.payload.field);
      expect(h.api.paint().value).toBe(old.payload.value);
      expect(h.api.paint().field.type.$ref).toBe("String");
      const changed = await admit(h, "replacement");
      expect(h.api.paint()).toEqual({ result: changed, field: nextField, value: nextValue });
      expect(h.api.paint().field).toBe(nextField);
      expect(h.api.paint().value).toBe(nextValue);
    }));

  for (const key of [{ $tag: "NamedField", ref: { $ref: "one" } }, { $tag: "PositionalField", index: 1 }])
    test(`${key.$tag} changes clear prior paint instead of inheriting another occurrence`, async () => withFixture({
      field: { name: "original", type: { $ref: "String" }, key },
    }, async h => {
      await admit(h);
      const changedKey = key.$tag === "NamedField" ? { $tag: "NamedField", ref: { $ref: "two" } }
        : { $tag: "PositionalField", index: 2 };
      h.setField({ ...h.field(), key: changedKey }); await settle();
      expect(h.api.ready()).toBe(false); expect(h.api.paint()).toBeUndefined();
      await admit(h);
    }));

  test("keyless Body replacements clear paint while TypeEditor keeps its explicit transient slot", async () => {
    for (const control of ["body", "nested"]) await withFixture({ control }, async h => {
      const previous = h.transports[0], admitted = await admit(h);
      h.setField({ ...h.field(), type: { $ref: "Number" } }); h.setValue(3); await settle();
      expect(h.api.ready()).toBe(false);
      if (control === "body") expect(h.api.paint()).toBeUndefined();
      else expect(h.api.paint()).toEqual({ result: admitted, field: previous.payload.field, value: previous.payload.value });
      await admit(h, "new slot type");
      expect(h.api.paint().value).toBe(3);
      expect(h.api.paint().field).toBe(h.field());
    });
  });

  test("every observed retained packet pairs its own result with the same captured data", async () => withFixture({
    value: { marker: "before" },
  }, async h => {
    const answer = async label => { const result = listPacket(label); h.transports.at(-1).resolve({ fieldPlan: result }); await settle();
      expect(h.api.ready()).toBe(true); expect(h.api.presentation()).toBe(result); };
    await answer("before");
    h.setValue({ marker: "after" }); await settle();
    expect(h.api.paint().result.plan.label).toBe("before");
    expect(h.api.paint().value.marker).toBe("before");
    await answer("after");
    for (const observed of h.observations) {
      if (observed.paint) expect(observed.paint.result.plan.label).toBe(observed.paint.value.marker);
    }
  }));
});

describe("production Body channel occurrence ownership", () => {
  for (const mutation of [
    { name: "named UUID", key: { $tag: "NamedField", ref: { $ref: "before" } }, edit: draft => { draft.key.ref.$ref = "after"; } },
    { name: "positional ordinal", key: { $tag: "PositionalField", index: 0 }, edit: draft => { draft.key.index = 1; } },
    { name: "removed key", key: { $tag: "NamedField", ref: { $ref: "removed" } }, edit: draft => { delete draft.key; } },
  ]) test(`same-proxy ${mutation.name} change resets channel intent`, async () => withFixture({
    channelControls: true, fieldStore: true, field: { name: "value", type: { $ref: "String" }, key: structuredClone(mutation.key) },
  }, async h => {
    const original = h.field();
    h.channel.setIntent({ owner: h.channel.owner(), id: "address" }); await settle();
    expect(h.channel.id()).toBe("address");
    h.setFieldStore(mutation.edit); await settle();
    expect(h.field()).toBe(original); expect(h.channel.id()).toBeUndefined();
  }));

  test("same-key clones keep intent while a keyless replacement clears it", async () => {
    for (const key of [{ $tag: "NamedField", ref: { $ref: "same" } }, { $tag: "PositionalField", index: 0 }, undefined]) {
      await withFixture({ channelControls: true,
        field: { name: "value", type: { $ref: "String" }, ...(key ? { key } : {}) },
      }, async h => {
        h.channel.setIntent({ owner: h.channel.owner(), id: "address" }); await settle();
        expect(h.channel.id()).toBe("address");
        h.setField(structuredClone(h.field())); await settle();
        expect(h.channel.id()).toBe(key ? "address" : undefined);
      });
    }
  });

  test("descriptor refusal precedes channel-key projection and store tracking", async () => {
    let reads = 0;
    const field = { name: "value", type: { $ref: "String" } };
    Object.defineProperty(field, "key", { enumerable: true, get() { reads++; throw Error("must not read"); } });
    await withFixture({ channelControls: true, field }, async h => {
      expect(h.channel.owner().fieldKey).toBeUndefined(); expect(h.channel.id()).toBeUndefined();
      expect(h.api.ready()).toBe(false); expect(h.transports).toEqual([]);
      expect(reads).toBe(0);
    });
  });
});

describe("live property observation retains the existing strict copy contract", () => {
  test("ordinary aliases, record order and arrays survive the optional reader", () => {
    const shared = { z: 2, a: 1 };
    const source = { list: [shared, shared], alias: shared };
    const copy = copier(source, "live property fixture", "equality", Reflect.get);
    expect(Object.keys(copy)).toEqual(["list", "alias"]);
    expect(Object.keys(copy.alias)).toEqual(["z", "a"]);
    expect(copy.list[0]).toBe(copy.list[1]); expect(copy.list[0]).toBe(copy.alias);
    expect(copy.alias).not.toBe(shared);
    copy.alias.z = 9; expect(shared.z).toBe(2);
  });

  test("a fresh observed child is descriptor-checked before any of its properties are read", () => {
    let getterCalls = 0;
    const hostile = {};
    Object.defineProperty(hostile, "secret", { enumerable: true, get() { getterCalls++; return "must not read"; } });
    const original = { child: { original: true } }, reads = [];
    const observe = (owner, key) => {
      reads.push({ owner, key }); return owner === original && key === "child" ? hostile : Reflect.get(owner, key);
    };
    expect(() => copier(original, "fresh child fixture", "equality", observe)).toThrow("accessor");
    expect(getterCalls).toBe(0);
    expect(reads.filter(row => row.owner === hostile)).toEqual([]);
    expect(original.child).toEqual({ original: true });
  });
});

describe("production field publication callbacks", () => {
  for (const control of ["body", "nested"]) {
    test(`${control} accepts a legal fresh JSX callback factory without rereading it during publication`, async () => withFixture({
      control, freshPublisher: true,
    }, async h => {
      await admit(h);
      const reads = h.publisherReads();
      h.change()("typed current value");
      expect(h.writes).toEqual([{ owner: "initial", value: "typed current value" }]);
      expect(h.publisherReads()).toBe(reads);
    }));

    test(`${control} refuses pending and obsolete callbacks after a newer plan becomes editable`, async () => withFixture({ control }, async h => {
      h.change()("pending"); expect(h.writes).toEqual([]);
      await admit(h);
      const previous = h.change();
      h.setSiblings({ selectedType: { $ref: "Number" } }); await settle();
      previous("old while pending"); expect(h.writes).toEqual([]);
      await admit(h, "replacement");
      expect(h.api.ready()).toBe(true);
      previous("old after ready"); expect(h.writes).toEqual([]);
      h.change()("current");
      expect(h.writes).toEqual([{ owner: "initial", value: "current" }]);
    }));

    test(`${control} rechecks a queued callback replacement without redirecting an old edit`, async () => withFixture({ control }, async h => {
      await admit(h);
      const previous = h.change(), requests = h.transports.length;
      h.replacePublish(); previous("queued stale");
      expect(h.writes).toEqual([]);
      await settle(); previous("settled stale");
      expect(h.writes).toEqual([]);
      h.change()("new callback");
      expect(h.writes).toEqual([{ owner: "replacement", value: "new callback" }]);
      expect(h.transports).toHaveLength(requests);
    }));

    test(`${control} fences a queued live sibling-store edit before an explicit flush`, async () => withFixture({ control }, async h => {
      h.setUseStores(true); await settle(); await admit(h);
      const previous = h.change();
      h.setSiblingStore(draft => { draft.selectedType.$ref = "Number"; });
      previous("from old dependent editor");
      expect(h.writes).toEqual([]);
      await settle();
      expect(h.api.ready()).toBe(false);
      await admit(h, "new dependent editor");
      previous("late old dependent editor");
      expect(h.writes).toEqual([]);
      h.change()("new dependent value");
      expect(h.writes).toEqual([{ owner: "initial", value: "new dependent value" }]);
    }));

    test(`${control} cannot publish after worker retirement or root disposal`, async () => {
      await withFixture({ control }, async h => {
        await admit(h); const change = h.change();
        h.replaceWorkerSilently(); change("retired worker");
        expect(h.writes).toEqual([]);
      });
      await withFixture({ control }, async h => {
        await admit(h); const change = h.change(); h.dispose();
        change("disposed"); expect(h.writes).toEqual([]);
      });
    });
  }
});

function stringFixture(options = {}) {
  let disposeRoot;
  const h = createRoot(dispose => {
    disposeRoot = dispose;
    const [external, setExternal] = createSignal("before");
    const [holding, setHolding] = createSignal(false);
    const [readonly, setReadonly] = createSignal(options.readonly ?? false);
    const gate = deferred(), writes = [], observed = [];
    const paint = createMemo(() => holding() ? gate.promise.then(() => external()) : external(), { loadingValue: "before" });
    const props = { get value() { return paint(); }, get readonly() { return readonly(); },
      onChange(value) {
        writes.push(value);
        if (options.holdOnInput) { setExternal(value); setHolding(true); }
      } };
    const leaf = nativeString(createSignal, createEffect, untrack, latest, props);
    createEffect(() => ({ displayed: leaf.displayed(), painted: paint() }), value => { observed.push(value); });
    return { leaf, props, external, setExternal, holding, setHolding, setReadonly, writes, observed, gate };
  });
  let disposed = false;
  h.dispose = () => { if (!disposed) { disposed = true; disposeRoot(); flush(); } };
  return h;
}
async function withString(options, run) {
  const h = stringFixture(options);
  try { await settle(); return await run(h); }
  finally { h.dispose(); await settle(); }
}

describe("actual native StringInputSurface draft", () => {
  test("a held parent plan and same-model paint do not overwrite typed text", async () => withString({ holdOnInput: true }, async h => {
    h.leaf.input({ value: "typed draft" });
    expect(h.leaf.displayed()).toBe("typed draft");
    await settle();
    expect(h.props.value).toBe("before");
    expect(h.leaf.displayed()).toBe("typed draft");
    expect(h.writes).toEqual(["typed draft"]);
    h.gate.resolve(); await settle();
    expect(h.props.value).toBe("typed draft");
    expect(h.leaf.displayed()).toBe("typed draft");
  }));

  test("a changed external model replaces the native draft", async () => withString({}, async h => {
    h.leaf.input({ value: "local draft" }); await settle();
    expect(h.leaf.displayed()).toBe("local draft");
    h.setExternal("external reset"); await settle();
    expect(h.leaf.displayed()).toBe("external reset");
    expect(h.writes).toEqual(["local draft"]);
  }));

  test("readonly input publishes nothing and leaves the admitted text intact", async () => withString({ readonly: true }, async h => {
    h.leaf.input({ value: "must not publish" }); await settle();
    expect(h.writes).toEqual([]); expect(h.leaf.displayed()).toBe("before");
    h.setReadonly(false); await settle();
    h.leaf.input({ value: "editable" }); await settle();
    expect(h.writes).toEqual(["editable"]); expect(h.leaf.displayed()).toBe("editable");
  }));

  test("disposing a held leaf prevents later graph effects and publications", async () => withString({ holdOnInput: true }, async h => {
    h.leaf.input({ value: "typed before disposal" }); await settle();
    const observations = h.observed.length;
    h.dispose(); h.gate.resolve(); h.setExternal("late model"); await settle();
    expect(h.observed).toHaveLength(observations);
    expect(h.writes).toEqual(["typed before disposal"]);
  }));
});

describe("B4 F1: a Local reader whose page session throws on every registry/evaluator read", () => {
  test("the field plan is the worker's; no page plan or frame is read", async () => withFixture({ poisoned: true }, async h => {
    expect(h.transports).toHaveLength(1);
    expect(h.transports[0].payload.method).toBe("project-reader-field-plan");
    await admit(h);
    expect(h.synchronous).toEqual([]); expect(h.contextReads).toEqual([]);
  }));

  test("the identified mode with the reader's own registry still routes to the worker", async () => withFixture({ poisoned: true, fieldMode: "identified" }, async h => {
    expect(h.transports).toHaveLength(1);
    await admit(h);
    expect(h.synchronous).toEqual([]);
  }));

  test("a foreign registry plans with its own frame without reading the page session", async () => withFixture({ poisoned: true, foreignRegistry: true }, async h => {
    expect(h.transports).toEqual([]);
    expect(h.synchronous).toHaveLength(1);
    expect(h.synchronous[0].evaluateContext).toBe(h.foreignFrame);
    expect(h.api.ready()).toBe(true);
  }));

  test("a missing worker refuses without a page fallback", async () => withFixture({ poisoned: true, available: false }, async h => {
    expect(h.api.ready()).toBe(false);
    expect(h.api.error()?.message).toContain("not ready");
    expect(h.synchronous).toEqual([]);
  }));
});

describe("B4 F1 fix: a superseded Local snapshot's registry never evaluates on the page", () => {
  test("a stale (non-throwing) owned registry refuses with the replaced-snapshot copy", async () => {
    const staleRegistry = { label: "superseded snapshot", evaluateContext() { throw new Error("stale registry evaluated on the page"); } };
    await withFixture({ poisoned: true, staleRegistry }, async h => {
      expect(h.transports).toEqual([]);
      expect(h.synchronous).toEqual([]);
      expect(h.api.ready()).toBe(false);
      expect(h.api.error()?.message).toBe("This authoring snapshot was replaced. Retry with the current data.");
    });
  });
});
