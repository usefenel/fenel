import { describe, expect, test } from "bun:test";
import { createRoot, createSignal, createMemo, createEffect, flush, latest, untrack, onSettled, isPending, refresh }
  from "../../../node_modules/solid-js/dist/solid.dev.js";

// B4 wave 1 lane B: the production `NativeRepresentationEditor` body (up to
// its JSX) runs with a Local reader whose page session throws on every
// registry/evaluator read. The page representation owners record any call;
// the worker client records requests answered explicitly here. The shared
// semantic owners have their own real-engine parity test
// (`native-representation-worker.test.ts`).
const transpiler = new Bun.Transpiler({ loader: "ts" });
const source = (await Bun.file(new URL("./VariantValueEditor.tsx", import.meta.url)).text()).replace(/\r\n/g, "\n");
const componentStart = source.indexOf("function NativeRepresentationEditor(");
const begin = source.indexOf("  const session = useAuthoringSession();", componentStart);
const end = source.indexOf("  return <div class=\"vve-representation\"", begin);
// The owner helper is optional so the same harness also runs the pre-move
// editor (fail-first: it projects on the page and sends no worker request).
const ownerStart = source.indexOf("function sameNativeRepresentationOwner(");
const owner = ownerStart < 0 ? "" : source.slice(ownerStart, source.indexOf("\n}\n", ownerStart) + 3);
if (componentStart < 0 || begin < 0 || end < begin) throw new Error("NativeRepresentationEditor fixture boundary moved.");
const body = transpiler.transformSync(`${owner}\n${source.slice(begin, end)}
  const exposed = name => { try { return eval(name); } catch { return undefined; } };
  return { mode, setSelected, nativeRecordContext, publishStructure, createStructure, editError,
    shown: exposed("shown") ?? projection, localInput: exposed("localInput") ?? (() => undefined),
    busy: exposed("busy") ?? (() => false), editable: exposed("localEditable") ?? (() => true),
    retryProjection: exposed("retryProjection") ?? (() => {}), retryEdit: exposed("retryEdit") ?? (() => {}),
    editRetry: exposed("editRetry") ?? (() => false), guardElement: exposed("localGuardElement") };`);
// The production reader interaction guard (FieldRenderer), extracted unchanged
// and run with the real Solid `isPending`/`latest` over browser-like events.
const fieldSource = (await Bun.file(new URL("../field-renderer/FieldRenderer.tsx", import.meta.url)).text()).replace(/\r\n/g, "\n");
const guardStart = fieldSource.indexOf("export function createReaderInteractionGuard(") >= 0
  ? fieldSource.indexOf("export function createReaderInteractionGuard(") : fieldSource.indexOf("function createReaderInteractionGuard(");
const guardEnd = fieldSource.indexOf("\n}\n", guardStart) + 3;
if (guardStart < 0 || guardEnd < guardStart) throw new Error("Reader interaction guard boundary moved.");
class KeyboardEvent { constructor(type, init = {}) { this.type = type; Object.assign(this, init); this.prevented = false; }
  preventDefault() { this.prevented = true; } stopImmediatePropagation() {} }
class InputEvent extends KeyboardEvent {}
class HTMLInputElement {} class HTMLTextAreaElement {}
const createRealGuard = new Function("isPending", "latest", "onSettled", "KeyboardEvent", "HTMLInputElement", "HTMLTextAreaElement",
  `${transpiler.transformSync(fieldSource.slice(guardStart, guardEnd)).replace(/^export /gm, "")}; return createReaderInteractionGuard;`)(
  isPending, latest, onSettled, KeyboardEvent, HTMLInputElement, HTMLTextAreaElement);
/** A guarded element: dispatch returns whether the guard prevented the event. */
function guardedElement() {
  const listeners = new Map();
  return { addEventListener: (name, listener) => listeners.set(name, listener), removeEventListener: name => listeners.delete(name),
    dispatch(event) { listeners.get(event.type)?.(event); return event.prevented; } };
}
const asyncSource = await Bun.file(new URL("../async-value.ts", import.meta.url)).text();
const createAsyncValue = new Function("createMemo", "createSignal", "isPending", "refresh",
  `${transpiler.transformSync(asyncSource.slice(asyncSource.indexOf("const LOADING:"))).replace(/^export /gm, "")};return createAsyncValue;`)(
  createMemo, createSignal, isPending, refresh);
const settle = async () => { for (let turn = 0; turn < 16; turn++) { await Promise.resolve(); flush(); } };
const deferred = () => { let resolve, reject; const promise = new Promise((yes, no) => { resolve = yes; reject = no; }); return { promise, resolve, reject }; };
const UNAVAILABLE = "This representation is unavailable for this data.";
const EDIT_REFUSED = "This representation cannot accept the edited data.";
const CREATE_REFUSED = "This representation cannot create data for this type.";
const CHANGED = "This data changed while its representation was preparing.";
const TOOLS = "This reader's editing tools are not ready.";
const ok = value => ({ $tag: "Ok", _0: value });
const err = message => ({ $tag: "Err", _0: message });
const natType = { $opaque: { name: "Nat", pure: { $variant: { cases: [] } } } };
const pureNat = { $variant: { cases: [{ name: "Zero" }, { name: "Succ" }] } };
const nativeNat = { $union: [{ $ref: "SmallNatNative" }, { $ref: "NatDigitRepresentation" }] };

function harness(options = {}) {
  const pageCalls = [], pageReads = [], requests = [], writes = [], guards = [];
  const poisoned = label => {
    const session = { label, environment: { resolveNamedType: name => { pageReads.push(`${label}.environment:${name}`); return undefined; } } };
    for (const key of ["registry", "evaluateContext"]) Object.defineProperty(session, key, { enumerable: true, get() {
      pageReads.push(`${label}.${key}`);
      if (options.account) return { label: `${label} ${key}` };
      throw new Error(`Page ${key} read for a Local reader`);
    } });
    return session;
  };
  let token = { capture: 1 }, closed = false, worker = options.noWorker ? undefined : { worker: "one" };
  let replacementPending = !!options.replacementPending;
  let dispose, api, setters;
  createRoot(close => {
    dispose = close;
    const [session, setSession] = createSignal(poisoned("local-page-session"));
    const [revision, setRevision] = createSignal(4);
    const [value, setValue] = createSignal(Object.hasOwn(options, "value") ? options.value : 3);
    const [workerRevision, setWorkerRevision] = createSignal(0);
    const reader = { kind: options.account ? "account" : "local", revision, session };
    const record = name => (...args) => { pageCalls.push({ name, args }); if (options.account) return options.page?.[name]?.(...args); throw new Error(`page ${name}`); };
    const imports = {
      props: { get typeName() { return "Nat"; }, get type() { return natType; }, get value() { return value(); },
        // With `echo`, the parent stores what the editor publishes, as a real parent does.
        get onChange() { return next => { writes.push(next); if (options.echo) setValue(() => options.echo === "copy" ? structuredClone(next) : next); }; },
        evaluateContext: undefined, nativeRecordContext: undefined },
      useAuthoringSession: () => session(), useReaderRuntime: () => reader, useFieldPresentationRegistry: () => () => undefined,
      createSignal, createMemo, createEffect, latest, untrack, onSettled, createAsyncValue,
      isNativeValueRepresentation: (_name, candidate) => candidate == null || typeof candidate === "number",
      runtimeRepresentationNativeContext: record("runtimeRepresentationNativeContext"),
      projectNativeRepresentation: record("projectNativeRepresentation"),
      editNativeRepresentation: record("editNativeRepresentation"),
      createNativeRepresentation: record("createNativeRepresentation"),
      NATIVE_REPRESENTATION_UNAVAILABLE: UNAVAILABLE, NATIVE_REPRESENTATION_EDIT_REFUSED: EDIT_REFUSED,
      NATIVE_REPRESENTATION_CREATE_REFUSED: CREATE_REFUSED, NATIVE_REPRESENTATION_CHANGED: CHANGED,
      NATIVE_REPRESENTATION_TOOLS_UNAVAILABLE: TOOLS,
      authoringWorkerReplacementPending: () => { workerRevision(); return replacementPending; },
      createReaderInteractionGuard: options.realGuard ? createRealGuard : ready => { guards.push(ready); return () => {}; },
      exactTransportKey: candidate => JSON.stringify(candidate),
      // The pre-move editor's own page owners (absent from the moved editor).
      ...Object.fromEntries(["runtimeRepresentationNativeType", "resolveRuntimeRepresentationMethod", "invokeRuntimeRepresentationMethod",
        "runtimeRepresentationInspect", "pureValueType", "validateValue", "frameAccount", "defaultValueFor"].map(name => [name, record(name)])),
      preparedReaderWorkerForSession: () => { workerRevision(); if (closed) throw new Error("This authoring snapshot was replaced. Retry with the current data."); return worker; },
      localGuidanceCapture: (current, readSession) => current?.kind === "local" ? { token, revision: current.revision(), session: readSession() } : undefined,
      localGuidanceCurrent: (capture, current, readSession) => capture.token === token && capture.revision === untrack(current.revision)
        && capture.session === readSession(),
      runPreparedReaderWorker: (handle, payload, signal) => {
        const held = deferred();
        requests.push({ handle, payload: structuredClone(payload), signal, ...held });
        return held.promise;
      },
    };
    api = new Function(...Object.keys(imports), body)(...Object.values(imports));
    createEffect(() => [api.shown(), api.localInput(), api.editError(), api.busy()], () => {});
    setters = { setValue, setRevision, setSession: () => setSession(poisoned("replacement-session")),
      setWorkerRevision, session };
  });
  flush();
  return { api, pageCalls, pageReads, requests, writes, guards, ...setters,
    replaceCapture: () => { token = { capture: 2 }; },
    replaceWorker: () => { worker = { worker: "replacement" }; setters.setWorkerRevision(revision => revision + 1); },
    attachWorker: () => { worker = { worker: "attached" }; replacementPending = false; setters.setWorkerRevision(revision => revision + 1); },
    close: () => { closed = true; setters.setWorkerRevision(revision => revision + 1); },
    answer: async (index, reply) => { requests[index].resolve(structuredClone(reply)); await settle(); },
    fail: async (index, error) => { requests[index].reject(error); await settle(); },
    dispose: () => { dispose(); flush(); } };
}

describe("Local representation switching runs in the reader's worker", () => {
  test("constructors are projected by one worker request; the page derives nothing", async () => {
    const h = harness();
    try {
      h.api.setSelected("structural"); await settle();
      expect(h.requests.map(row => row.payload)).toEqual([{ method: "project-reader-representation",
        typeName: "Nat", type: natType, mode: "structural", value: 3 }]);
      expect(h.requests[0].handle).toEqual({ worker: "one" });
      // Checking: nothing painted, no error, busy.
      expect(h.api.shown().type).toBeUndefined(); expect(h.api.shown().error).toBeUndefined(); expect(h.api.busy()).toBe(true);
      const projected = { $tag: "Succ", _0: { $tag: "Succ", _0: { $tag: "Succ", _0: { $tag: "Zero" } } } };
      await h.answer(0, { projection: ok({ type: pureNat, value: projected }) });
      expect(h.api.shown().type).toEqual(pureNat); expect(h.api.shown().value).toEqual(projected);
      expect(h.api.shown().evaluateContext).toBeUndefined(); expect(h.api.busy()).toBe(false);
      expect(h.pageCalls).toEqual([]); expect(h.pageReads).toEqual([]);
      // User actions run at weight 0: no guidance priority.
      expect(h.requests.every(row => !Object.hasOwn(row.payload, "priority"))).toBe(true);
    } finally { h.dispose(); }
  });

  test("representation fields select the worker's native frame by name; children get no page context", async () => {
    const h = harness();
    try {
      h.api.setSelected("representation"); await settle();
      expect(h.requests.at(-1).payload).toMatchObject({ method: "project-reader-representation", mode: "representation", value: 3 });
      await h.answer(h.requests.length - 1, { projection: ok({ type: nativeNat, value: 3 }) });
      expect(h.api.shown().type).toEqual(nativeNat);
      expect(h.api.shown().evaluateContext).toBeUndefined();
      expect(h.api.nativeRecordContext()).toEqual({ representationTypeName: "Nat" });
      expect(h.pageCalls).toEqual([]); expect(h.pageReads).toEqual([]);
    } finally { h.dispose(); }
  });

  test("an admitted edit publishes the worker's owner value; a refusal shows the existing copy and publishes nothing", async () => {
    const h = harness();
    try {
      h.api.setSelected("representation"); await settle();
      await h.answer(0, { projection: ok({ type: nativeNat, value: 3 }) });
      h.api.publishStructure().callback(5); await settle();
      expect(h.requests[1].payload).toEqual({ method: "edit-reader-representation", typeName: "Nat", type: natType,
        mode: "representation", edited: 5 });
      expect(h.api.busy()).toBe(true);
      await h.answer(1, { changed: ok(5) });
      expect(h.writes).toEqual([5]); expect(h.api.editError()).toBeUndefined();
      // The published value is the parent's next value: projected again.
      const paintedType = h.api.shown().type;
      h.setValue(5); await settle();
      expect(h.requests[2].payload).toMatchObject({ method: "project-reader-representation", value: 5 });
      // Meanwhile the same owner's view stays painted.
      expect(h.api.shown().type).toBe(paintedType);
      // Meanwhile it shows the data this editor published, and takes edits.
      expect(h.api.shown().value).toBe(5); expect(h.api.editable()).toBe(true);
      await h.answer(2, { projection: ok({ type: nativeNat, value: 5 }) });
      // An equal projected type keeps its identity, so nested editors keep their state.
      expect(h.api.shown().type).toBe(paintedType); expect(h.api.shown().value).toBe(5); expect(h.api.busy()).toBe(false);
      h.api.publishStructure().callback(-1); await settle();
      await h.answer(3, { changed: err(EDIT_REFUSED) });
      expect(h.writes).toEqual([5]); expect(h.api.editError()).toBe(EDIT_REFUSED);
      // The refused data is not left on show: the view is the current data's.
      expect(h.api.shown().value).toBe(5);
      expect(h.pageCalls).toEqual([]); expect(h.pageReads).toEqual([]);
    } finally { h.dispose(); }
  });

  test("an edit made while the previous one is answered waits and is sent next: no edit is lost", async () => {
    // Representation fields of a ratio: type "2" in num, then "3" before the
    // first answer and before the re-projection.
    const h = harness({ echo: true }), view = { num: "1", den: "2" };
    try {
      h.api.setSelected("representation"); await settle();
      await h.answer(0, { projection: ok({ type: nativeNat, value: view }) });
      const first = { num: "2", den: "2" }, second = { num: "3", den: "2" };
      h.api.publishStructure().callback(first); await settle();
      expect(h.requests[1].payload).toMatchObject({ method: "edit-reader-representation", edited: first });
      // The view shows the edited data, so the next edit builds on it.
      expect(h.api.shown().value).toEqual(first); expect(h.api.editable()).toBe(true);
      h.api.publishStructure().callback(second); await settle();
      expect(h.requests).toHaveLength(2);
      expect(h.api.shown().value).toEqual(second);
      await h.answer(1, { changed: ok({ owner: "2/2" }) });
      expect(h.writes).toEqual([{ owner: "2/2" }]);
      // The waiting edit is sent at once, and the re-projection of the first is asked too.
      const methods = h.requests.slice(2).map(row => row.payload.method).sort();
      expect(methods).toEqual(["edit-reader-representation", "project-reader-representation"]);
      const edit = h.requests.findIndex((row, index) => index > 1 && row.payload.method === "edit-reader-representation");
      expect(h.requests[edit].payload.edited).toEqual(second);
      expect(h.api.shown().value).toEqual(second);
      const projection = h.requests.findIndex((row, index) => index > 1 && row.payload.method === "project-reader-representation");
      await h.answer(projection, { projection: ok({ type: nativeNat, value: first }) });
      // An outstanding edit keeps its data on show over an older view.
      expect(h.api.shown().value).toEqual(second);
      await h.answer(edit, { changed: ok({ owner: "3/2" }) });
      expect(h.writes).toEqual([{ owner: "2/2" }, { owner: "3/2" }]);
      const last = h.requests.length - 1;
      expect(h.requests[last].payload).toMatchObject({ method: "project-reader-representation", value: { owner: "3/2" } });
      expect(h.api.shown().value).toEqual(second);
      await h.answer(last, { projection: ok({ type: nativeNat, value: second }) });
      expect(h.api.shown().value).toEqual(second); expect(h.api.busy()).toBe(false); expect(h.api.editError()).toBeUndefined();
    } finally { h.dispose(); }
  });

  test("the latest of several waiting edits is sent; a refused one shows its copy and the next still runs", async () => {
    const h = harness({ echo: true });
    try {
      h.api.setSelected("representation"); await settle();
      await h.answer(0, { projection: ok({ type: nativeNat, value: 3 }) });
      h.api.publishStructure().callback(4); await settle();
      h.api.publishStructure().callback(5); await settle();
      h.api.publishStructure().callback(6); await settle();
      expect(h.requests).toHaveLength(2);
      await h.answer(1, { changed: err(EDIT_REFUSED) });
      expect(h.api.editError()).toBe(EDIT_REFUSED);
      expect(h.requests[2].payload).toMatchObject({ method: "edit-reader-representation", edited: 6 });
      expect(h.api.shown().value).toBe(6);
      await h.answer(2, { changed: ok(6) });
      expect(h.writes).toEqual([6]); expect(h.api.editError()).toBeUndefined();
    } finally { h.dispose(); }
  });

  test("an edit on a view that no longer shows the current data is refused visibly and input is blocked", async () => {
    const h = harness();
    try {
      h.api.setSelected("representation"); await settle();
      await h.answer(0, { projection: ok({ type: nativeNat, value: 3 }) });
      expect(h.guards).toHaveLength(1); expect(h.guards[0]()).toBe(true);
      // The parent's data changes outside this editor: the old view stays painted.
      h.setValue(9); await settle();
      expect(h.api.shown().value).toBe(3);
      expect(h.guards[0]()).toBe(false); expect(h.api.editable()).toBe(false);
      h.api.publishStructure().callback(4); await settle();
      expect(h.requests.filter(row => row.payload.method === "edit-reader-representation")).toEqual([]);
      expect(h.api.editError()).toBe(CHANGED);
      await h.answer(1, { projection: ok({ type: nativeNat, value: 9 }) });
      expect(h.guards[0]()).toBe(true);
    } finally { h.dispose(); }
  });

  test("with the real input guard, a keystroke during a re-projection in flight is not prevented and reaches the queue", async () => {
    const h = harness({ echo: true, realGuard: true });
    try {
      h.api.setSelected("representation"); await settle();
      await h.answer(0, { projection: ok({ type: nativeNat, value: { num: "1" } }) });
      const element = guardedElement(); h.api.guardElement(element);
      expect(element.dispatch(new KeyboardEvent("keydown", { key: "2" }))).toBe(false);
      h.api.publishStructure().callback({ num: "2" }); await settle();
      await h.answer(1, { changed: ok({ owner: "2" }) });
      // The parent echoed the published value: its re-projection is in flight.
      expect(h.requests.at(-1).payload).toMatchObject({ method: "project-reader-representation", value: { owner: "2" } });
      expect(element.dispatch(new KeyboardEvent("keydown", { key: "3" }))).toBe(false);
      expect(element.dispatch(new InputEvent("beforeinput", { data: "3" }))).toBe(false);
      expect(isPending(() => h.api.editable())).toBe(false);
      h.api.publishStructure().callback({ num: "3" }); await settle();
      const edit = h.requests.at(-1);
      expect(edit.payload).toMatchObject({ method: "edit-reader-representation", edited: { num: "3" } });
      expect(h.api.shown().value).toEqual({ num: "3" });
      await h.answer(h.requests.indexOf(edit), { changed: ok({ owner: "3" }) });
      expect(h.writes).toEqual([{ owner: "2" }, { owner: "3" }]);
    } finally { h.dispose(); }
  });

  test("a mode switch during a chain finishes its edits in their own mode, without a refusal", async () => {
    const h = harness({ echo: true });
    try {
      h.api.setSelected("representation"); await settle();
      await h.answer(0, { projection: ok({ type: nativeNat, value: 3 }) });
      h.api.publishStructure().callback(4); await settle();
      h.api.publishStructure().callback(5); await settle();
      h.api.setSelected("structural"); await settle();
      // The structural view is asked for; the chain no longer shows.
      expect(h.requests.at(-1).payload).toMatchObject({ method: "project-reader-representation", mode: "structural" });
      expect(h.api.shown().value).not.toBe(5);
      await h.answer(1, { changed: ok(4) });
      expect(h.writes).toEqual([4]); expect(h.api.editError()).toBeUndefined();
      const waiting = h.requests.findLast(row => row.payload.method === "edit-reader-representation");
      expect(waiting.payload).toEqual({ method: "edit-reader-representation", typeName: "Nat", type: natType, mode: "representation", edited: 5 });
      await h.answer(h.requests.indexOf(waiting), { changed: ok(5) });
      expect(h.writes).toEqual([4, 5]); expect(h.api.editError()).toBeUndefined();
      const projection = h.requests.findLast(row => row.payload.method === "project-reader-representation");
      expect(projection.payload).toMatchObject({ method: "project-reader-representation", mode: "structural", value: 5 });
      await h.answer(h.requests.indexOf(projection), { projection: ok({ type: pureNat, value: "five" }) });
      expect(h.api.shown().value).toBe("five"); expect(h.api.editable()).toBe(true);
    } finally { h.dispose(); }
  });

  test("a worker replaced during a chain keeps the edit with the tools message and a Retry through the new worker", async () => {
    const h = harness({ echo: true });
    try {
      h.api.setSelected("representation"); await settle();
      await h.answer(0, { projection: ok({ type: nativeNat, value: 3 }) });
      h.api.publishStructure().callback(4); await settle();
      h.replaceWorker(); await settle();
      await h.answer(1, { changed: ok(4) });
      expect(h.writes).toEqual([]);
      expect(h.api.editError()).toBe(TOOLS); expect(h.api.editRetry()).toBe(true);
      expect(h.api.shown().value).toBe(4);
      h.api.retryEdit(); await settle();
      const retried = h.requests.at(-1);
      expect(retried.handle).toEqual({ worker: "replacement" });
      expect(retried.payload).toMatchObject({ method: "edit-reader-representation", edited: 4 });
      await h.answer(h.requests.indexOf(retried), { changed: ok(4) });
      expect(h.writes).toEqual([4]); expect(h.api.editError()).toBeUndefined(); expect(h.api.editRetry()).toBe(false);
    } finally { h.dispose(); }
  });

  test("a parent that hands back an equal copy keeps the chain, before and after the first publish", async () => {
    const h = harness({ echo: "copy", value: { n: 3 } });
    try {
      h.api.setSelected("representation"); await settle();
      await h.answer(h.requests.length - 1, { projection: ok({ type: nativeNat, value: { n: 3 } }) });
      h.api.publishStructure().callback({ n: 4 }); await settle();
      const first = h.requests.length - 1;
      expect(h.requests[first].payload).toMatchObject({ method: "edit-reader-representation", edited: { n: 4 } });
      // The parent re-renders with an equal copy of its data before the answer.
      h.setValue({ n: 3 }); await settle();
      await h.answer(first, { changed: ok({ n: 4 }) });
      expect(h.writes).toEqual([{ n: 4 }]); expect(h.api.editError()).toBeUndefined();
      h.api.publishStructure().callback({ n: 5 }); await settle();
      const second = h.requests.at(-1);
      expect(second.payload).toMatchObject({ method: "edit-reader-representation", edited: { n: 5 } });
      await h.answer(h.requests.indexOf(second), { changed: ok({ n: 5 }) });
      expect(h.writes).toEqual([{ n: 4 }, { n: 5 }]); expect(h.api.editError()).toBeUndefined();
    } finally { h.dispose(); }
  });

  test("a transport failure keeps the waiting edit and offers Retry", async () => {
    const h = harness({ echo: true });
    try {
      h.api.setSelected("representation"); await settle();
      await h.answer(0, { projection: ok({ type: nativeNat, value: 3 }) });
      h.api.publishStructure().callback(4); await settle();
      h.api.publishStructure().callback(5); await settle();
      await h.fail(1, new Error("worker transport failed"));
      expect(h.api.editError()).toBe(UNAVAILABLE); expect(h.api.editRetry()).toBe(true);
      expect(h.api.shown().value).toBe(5); expect(h.writes).toEqual([]);
      h.api.retryEdit(); await settle();
      const retried = h.requests.at(-1);
      expect(retried.payload).toMatchObject({ method: "edit-reader-representation", edited: 5 });
      await h.answer(h.requests.indexOf(retried), { changed: ok(5) });
      expect(h.writes).toEqual([5]); expect(h.api.editError()).toBeUndefined();
    } finally { h.dispose(); }
  });

  test("a default is created by the worker", async () => {
    const h = harness({ value: undefined });
    try {
      h.api.setSelected("structural"); await settle();
      await h.answer(0, { projection: ok({ type: pureNat, value: undefined }) });
      h.api.createStructure(); await settle();
      expect(h.requests[1].payload).toEqual({ method: "create-reader-representation", typeName: "Nat", type: natType, mode: "structural" });
      await h.answer(1, { created: ok({ $tag: "Zero" }) });
      expect(h.writes).toEqual([{ $tag: "Zero" }]);
      expect(h.pageCalls).toEqual([]); expect(h.pageReads).toEqual([]);
    } finally { h.dispose(); }
  });

  test("a revision bump or a draft change between request and reply drops the reply and asks again", async () => {
    const h = harness();
    try {
      h.api.setSelected("structural"); await settle();
      h.setRevision(5); await settle();
      expect(h.requests).toHaveLength(2);
      expect(h.requests[0].signal.aborted).toBe(true);
      await h.answer(0, { projection: ok({ type: pureNat, value: "stale revision" }) });
      expect(h.api.shown().type).toBeUndefined(); expect(h.api.shown().error).toBeUndefined();
      h.setValue(4); await settle();
      expect(h.requests).toHaveLength(3);
      await h.answer(1, { projection: ok({ type: pureNat, value: "stale draft" }) });
      expect(h.api.shown().type).toBeUndefined(); expect(h.api.shown().error).toBeUndefined();
      await h.answer(2, { projection: ok({ type: pureNat, value: "current" }) });
      expect(h.api.shown().value).toBe("current");
    } finally { h.dispose(); }
  });

  test("an untracked capture change (source metadata) drops the reply and re-sends the same request", async () => {
    const h = harness();
    try {
      h.api.setSelected("structural"); await settle();
      h.replaceCapture();
      await h.answer(0, { projection: ok({ type: pureNat, value: "old capture" }) });
      expect(h.requests).toHaveLength(2);
      expect(h.requests[1].payload).toEqual(h.requests[0].payload);
      expect(h.api.shown().type).toBeUndefined();
      await h.answer(1, { projection: ok({ type: pureNat, value: "new capture" }) });
      expect(h.api.shown().value).toBe("new capture");
    } finally { h.dispose(); }
  });

  test("a capture that keeps moving settles with the existing copy and a Retry that asks again", async () => {
    const h = harness();
    try {
      h.api.setSelected("structural"); await settle();
      for (let attempt = 0; attempt < 3; attempt++) {
        h.replaceCapture();
        await h.answer(attempt, { projection: ok({ type: pureNat, value: `capture ${attempt}` }) });
      }
      expect(h.requests).toHaveLength(3);
      expect(h.api.shown().error).toBe(UNAVAILABLE); expect(h.api.shown().retry).toBe(true);
      h.api.retryProjection(); await settle();
      expect(h.requests).toHaveLength(4);
      expect(h.requests[3].payload).toEqual(h.requests[0].payload);
      await h.answer(3, { projection: ok({ type: pureNat, value: "settled" }) });
      expect(h.api.shown().value).toBe("settled"); expect(h.api.shown().error).toBeUndefined();
    } finally { h.dispose(); }
  });

  test("an edit answered after its draft changed is never published", async () => {
    const h = harness();
    try {
      h.api.setSelected("representation"); await settle();
      await h.answer(0, { projection: ok({ type: nativeNat, value: 3 }) });
      h.api.publishStructure().callback(5); await settle();
      h.setValue(7); await settle();
      await h.answer(1, { changed: ok(5) });
      expect(h.writes).toEqual([]);
    } finally { h.dispose(); }
  });

  test("a closed worker refuses with the existing copy; a failed edit or default too", async () => {
    const h = harness({ value: undefined });
    try {
      h.api.setSelected("structural"); await settle();
      await h.answer(0, { projection: ok({ type: pureNat, value: undefined }) });
      h.api.createStructure(); await settle();
      await h.fail(1, new Error("This authoring snapshot was replaced. Retry with the current data."));
      expect(h.api.editError()).toBe(CREATE_REFUSED); expect(h.writes).toEqual([]);
      h.close(); await settle();
      expect(h.api.shown().error).toBe(UNAVAILABLE); expect(h.api.shown().type).toBeUndefined();
      h.api.createStructure(); await settle();
      expect(h.requests).toHaveLength(2);
      expect(h.pageCalls).toEqual([]); expect(h.pageReads).toEqual([]);
    } finally { h.dispose(); }
    const g = harness();
    try {
      g.api.setSelected("representation"); await settle();
      await g.answer(0, { projection: ok({ type: nativeNat, value: 3 }) });
      g.api.publishStructure().callback(5); await settle();
      await g.fail(1, new Error("worker closed"));
      // The data still holds: the edit is kept for Retry (fix round 3, item 4).
      expect(g.api.editError()).toBe(UNAVAILABLE); expect(g.api.editRetry()).toBe(true); expect(g.writes).toEqual([]);
      await settle();
      // A projection refusal shows the existing copy as well.
      g.api.setSelected("structural"); await settle();
      await g.answer(2, { projection: err(UNAVAILABLE) });
      expect(g.api.shown().error).toBe(UNAVAILABLE);
    } finally { g.dispose(); }
  });

  test("a Local session with no worker coming refuses with the record operations' copy, not a spinner", async () => {
    const h = harness({ noWorker: true });
    try {
      h.api.setSelected("structural"); await settle();
      expect(h.requests).toEqual([]);
      expect(h.api.shown().error).toBe(TOOLS); expect(h.api.busy()).toBe(false);
      // A worker attached later is used at once.
      h.attachWorker(); await settle();
      expect(h.requests.map(row => row.payload.method)).toEqual(["project-reader-representation"]);
      expect(h.api.shown().error).toBeUndefined();
      expect(h.pageReads).toEqual([]);
    } finally { h.dispose(); }
  });

  test("a Local session whose worker replacement is coming shows the preparing state", async () => {
    const h = harness({ noWorker: true, replacementPending: true });
    try {
      h.api.setSelected("structural"); await settle();
      expect(h.requests).toEqual([]);
      expect(h.api.shown().error).toBeUndefined(); expect(h.api.busy()).toBe(true);
      h.attachWorker(); await settle();
      expect(h.requests).toHaveLength(1);
    } finally { h.dispose(); }
  });

  test("an Account reader keeps the page path and sends nothing to a worker", async () => {
    const h = harness({ account: true, page: {
      projectNativeRepresentation: () => ({ type: pureNat, value: { $tag: "Zero" } }),
      editNativeRepresentation: (_mode, _name, _type, edited) => edited,
      runtimeRepresentationNativeContext: () => ({ native: true }),
    } });
    try {
      h.api.setSelected("structural"); await settle();
      expect(h.api.shown().type).toEqual(pureNat);
      expect(h.api.shown().evaluateContext).toEqual({ label: "local-page-session evaluateContext" });
      h.api.publishStructure().callback({ $tag: "Zero" }); await settle();
      expect(h.writes).toEqual([{ $tag: "Zero" }]);
      expect(h.requests).toEqual([]);
      expect(h.pageCalls.map(call => call.name).filter(name => name !== "runtimeRepresentationNativeContext"))
        .toEqual(["projectNativeRepresentation", "editNativeRepresentation"]);
      const [mode, typeName, type, value, frame] = h.pageCalls.find(call => call.name === "projectNativeRepresentation").args;
      expect([mode, typeName, type, value]).toEqual(["structural", "Nat", natType, 3]);
      expect(frame.evaluateContext).toEqual({ label: "local-page-session evaluateContext" });
      h.api.setSelected("representation"); await settle();
      expect(h.api.nativeRecordContext()).toEqual({ representationTypeName: "Nat", evaluateContext: { native: true } });
    } finally { h.dispose(); }
  });
});
