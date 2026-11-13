import { describe, expect, test } from "bun:test";
import {
  createRoot, createSignal, createMemo, createEffect, createUniqueId,
  flush, isPending, latest, onSettled, refresh,
} from "../../../node_modules/solid-js/dist/solid.dev.js";

// Host scheduling and lifetime only. The production control bodies and async
// shim are extracted unchanged; semantic adapters and worker transport are
// controlled. No registry, native table, evaluator or browser Worker is loaded.
const source = await Bun.file(new URL("./FieldRenderer.tsx", import.meta.url)).text();
const asyncSource = await Bun.file(new URL("../async-value.ts", import.meta.url)).text();
const transpiler = new Bun.Transpiler({ loader: "ts" });
const compiled = code => transpiler.transformSync(code).replace(/^export /gm, "");
function section(text, start, end) {
  const first = text.indexOf(start), last = text.indexOf(end, first + start.length);
  if (first < 0 || last < 0) throw new Error(`Production fixture boundary changed: ${start}`);
  return text.slice(first, last);
}
const ownerCode = section(source, "function localFieldSelectionWorker(", "/** Adapts the Fenel-owned edit plan");
const selectCode = section(section(source, "function SelectEditor(", "function FileEditor("),
  "  const publication =", "\n  return (");
const listCode = section(source.slice(source.indexOf("function ChannelEditor(")),
  "  const editor =", "  const ctxParams =");
const createAsyncValue = new Function("createMemo", "createSignal", "isPending", "refresh",
  `${compiled(asyncSource.slice(asyncSource.indexOf("const LOADING:")))}; return createAsyncValue;`)
  (createMemo, createSignal, isPending, refresh);
const nothing = { $tag: "Nothing" };
const just = value => ({ $tag: "Just", _0: value });
const choice = selectedIndex => ({ selection: { selectedIndex } });
const selectedList = () => ({ selection: { occurrences: [just(0)], selected: [true, false] } });
const deferred = () => {
  let resolve, reject;
  const promise = new Promise((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
};
async function settle() {
  for (let tick = 0; tick < 8; tick++) { await Promise.resolve(); flush(); }
}

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

function fixture(control, options = {}) {
  let disposeRoot;
  const h = createRoot(dispose => {
    disposeRoot = dispose;
    const plainSessionFor = label => ({ registry: { label, evaluateContext: () => ({ foreign: label }) },
      evaluateContext: { frame: label }, environment: {} });
    const sessionFor = label => options.poisoned ? poisonedSession(plainSessionFor(label)) : plainSessionFor(label);
    const initialSession = sessionFor("reader");
    const [session, setSession] = createSignal(initialSession);
    const [registry, setRegistry] = createSignal(options.foreignRegistry
      ? { label: "other owner", evaluateContext: () => foreignFrame } : ownRegistryOf(initialSession));
    const foreignFrame = { frame: "other owner" };
    const [workerToken, setWorkerToken] = createSignal({ label: "worker-one" });
    const [available, setAvailable] = createSignal(options.available !== false);
    const [notification, setNotification] = createSignal(0);
    const initialOptions = options.options ?? [
      { label: "First", value: { second: 2, first: 1 } },
      { label: "Second", value: { kept: false, empty: "" } },
    ];
    const initialValue = Object.hasOwn(options, "value") ? options.value
      : control === "list" ? [initialOptions[0].value] : initialOptions[0].value;
    const [choices, setChoices] = createSignal(initialOptions);
    const [value, setValue] = createSignal(initialValue);
    const [type, setType] = createSignal({ $ref: "RuntimeType" });
    const [field, setField] = createSignal({ name: "choices", type: { $ref: "DeclaredType" } });
    const [plan, setPlan] = createSignal({ editor: {
      kind: "list", rawType: { $ref: "ListOwner" }, choices: initialOptions,
    } });
    const writes = [], transports = [], synchronous = [], observations = [];
    const handles = new WeakMap();
    let workerFailure, silentWorkerToken, synchronousChoice = { selectedIndex: nothing };
    let synchronousList = selectedList().selection;
    let synchronousEdit = { $tag: "Ok", _0: [initialOptions[1].value] };
    const preparedReaderWorkerForSession = selectedSession => {
      notification();
      if (workerFailure) throw workerFailure;
      if (!available()) return undefined;
      const token = silentWorkerToken ?? workerToken();
      let byToken = handles.get(selectedSession);
      if (!byToken) { byToken = new WeakMap(); handles.set(selectedSession, byToken); }
      let handle = byToken.get(token);
      if (!handle) { handle = { session: selectedSession, token }; byToken.set(token, handle); }
      return handle;
    };
    const reader = { kind: options.kind ?? "local", session, registry: () => ownRegistryOf(session()) };
    const detached = { detached: true };
    const props = {
      get options() { return choices(); }, get value() { return value(); },
      get type() { return type(); }, get field() { return field(); },
      get plan() { return plan(); }, onChange: changed => {
        writes.push(changed);
        if (options.acceptWrites) setValue(changed);
      },
    };
    const imports = {
      createSignal, createMemo, createUniqueId, createAsyncValue, latest, onSettled,
      props, DETACHED_AUTHORING_SESSION: detached,
      useFieldPresentationRegistry: () => registry,
      useReaderRuntime: () => reader,
      useAuthoringSession: () => initialSession,
      preparedReaderWorkerForSession,
      registryHasSnapshotOwner: () => false,
      canonical: label => label,
      peelMaybeValue: maybe => maybe?.$tag === "Just" ? maybe._0 : undefined,
      refHandle: candidate => candidate?.$ref,
      runPreparedReaderWorker: (handle, payload, signal) => {
        const held = deferred();
        transports.push({ handle, payload, signal, ...held });
        return held.promise;
      },
      fieldChoiceSelectionPlan: (...args) => {
        synchronous.push({ method: "choice", args }); return synchronousChoice;
      },
      fieldListChipsSelectionPlan: (...args) => {
        synchronous.push({ method: "list", args }); return synchronousList;
      },
      fieldListChipsEditPlan: (...args) => {
        synchronous.push({ method: "edit", args }); return synchronousEdit;
      },
    };
    const apiCode = control === "choice"
      ? `${selectCode}; return { ready: choiceReady, selection: choiceSelection, choose,
          input: choiceInput, rows: () => choices().rows, blank: () => choices().blankToken,
          token: selectedToken, pending: choicePending, projected: projectedChoiceSelection,
          error: () => choiceError()?.message };`
      : `${listCode}; return { ready: listChipReady, selection: listChipSelection, edit: editListChips,
          input: listChipInput, pending: listChipPending, projected: projectedListSelection,
          error: listChipError };`;
    const api = new Function(...Object.keys(imports), compiled(`${ownerCode}\n${apiCode}`))(...Object.values(imports));
    // Observe the same readiness, selection, pending and error reads as the
    // mounted controls, so source changes run and dispose actual graph jobs.
    createEffect(() => ({ ready: api.ready(), selection: api.selection(), pending: api.pending(), error: api.error() }),
      state => { observations.push(state); });
    return { api, reader, initialSession, initialOptions, initialValue, sessionFor, props,
      session, setSession, registry, setRegistry, foreignFrame,
      choices, setChoices, value, setValue, type, setType, field, setField, plan, setPlan,
      workerToken, setWorkerToken, setAvailable, writes, transports, synchronous, observations,
      notify: () => setNotification(count => count + 1),
      replaceWorkerSilently: () => { silentWorkerToken = { label: "replaced-without-notification" }; },
      setWorkerFailure: failure => { workerFailure = failure; setNotification(count => count + 1); },
      setSynchronousChoice: result => { synchronousChoice = result; },
      setSynchronousList: result => { synchronousList = result; },
      setSynchronousEdit: result => { synchronousEdit = result; },
    };
  });
  h.dispose = () => { disposeRoot(); flush(); };
  return h;
}
async function withFixture(control, options, work) {
  const h = fixture(control, options);
  try { await settle(); return await work(h); }
  finally { h.dispose(); await settle(); }
}
async function admit(h) {
  expect(h.transports).toHaveLength(1);
  h.transports[0].resolve(h.api.choose ? choice(just(0)) : selectedList());
  await settle();
  expect(h.api.ready()).toBe(true);
}

describe("Local choice control worker lifetime", () => {
  test("initial projection waits without main-page equality, and cannot write while pending", async () => {
    await withFixture("choice", {}, async h => {
      expect(h.api.ready()).toBe(false);
      expect(h.api.selection()).toBeUndefined();
      expect(h.synchronous).toEqual([]);
      expect(h.transports[0].payload).toEqual({ method: "project-reader-choice-selection",
        options: h.initialOptions, value: h.initialValue });
      await h.api.choose(h.api.rows()[1].token);
      expect(h.transports).toHaveLength(1);
      expect(h.writes).toEqual([]);
      await admit(h);
      expect(h.api.token()).toBe(h.api.rows()[0].token);
    });
  });

  test("an admitted choice emits the exact original native value only for Nothing", async () => {
    for (const selected of [nothing, just(0)]) await withFixture("choice", {}, async h => {
      await admit(h);
      const original = h.initialOptions[1].value;
      const flight = h.api.choose(h.api.rows()[1].token);
      const request = h.transports[1];
      expect(request.payload).toEqual({ method: "project-reader-choice-selection",
        options: [h.initialOptions[1]], value: h.initialValue });
      expect(request.payload.options[0]).toBe(h.initialOptions[1]);
      expect(request.handle).toBe(h.transports[0].handle);
      expect(h.writes).toEqual([]);
      request.resolve(choice(selected)); await flight; await settle();
      expect(h.writes).toHaveLength(selected.$tag === "Nothing" ? 1 : 0);
      if (h.writes.length) expect(h.writes[0]).toBe(original);
      expect(h.synchronous).toEqual([]);
    });
  });

  test("blank selection preserves ordinary clear semantics without another equality job", async () => {
    for (const value of [undefined, false, "", 0]) await withFixture("choice", { value }, async h => {
      await admit(h);
      await h.api.choose(h.api.blank());
      expect(h.transports).toHaveLength(1);
      expect(h.writes).toEqual(value === undefined ? [] : [undefined]);
    });
  });

  test("options replacement rejects an old menu token, even after new selection is ready", async () => {
    await withFixture("choice", {}, async h => {
      await admit(h);
      const previousToken = h.api.rows()[1].token;
      h.setChoices([...h.initialOptions].reverse()); await settle();
      expect(h.api.ready()).toBe(false);
      h.transports[1].resolve(choice(just(0))); await settle();
      await h.api.choose(previousToken);
      expect(h.transports).toHaveLength(2);
      expect(h.writes).toEqual([]);
    });
  });

  const mutations = {
    options: h => h.setChoices([...h.initialOptions]),
    reorder: h => h.setChoices([...h.initialOptions].reverse()),
    value: h => h.setValue({ replacement: true }),
    type: h => h.setType({ $ref: "ChangedRuntimeType" }),
    session: h => { const next = h.sessionFor("new-reader"); h.setSession(next); h.setRegistry(next.registry); },
    registry: h => h.setRegistry({ evaluateContext: () => h.foreignFrame }),
    worker: h => h.setWorkerToken({ label: "worker-two" }),
  };
  for (const [label, mutate] of Object.entries(mutations)) test(`${label} change aborts the pending choice and admits zero stale writes`, async () => {
    await withFixture("choice", {}, async h => {
      await admit(h);
      const flight = h.api.choose(h.api.rows()[1].token), request = h.transports[1];
      mutate(h); await settle();
      expect(request.signal.aborted).toBe(true);
      request.resolve(choice(nothing)); await flight; await settle();
      expect(h.writes).toEqual([]);
      if (label !== "registry") expect(h.synchronous).toEqual([]);
    });
  });

  test("a plain gesture lock serializes synchronous and microtask-queued clicks", async () => {
    await withFixture("choice", {}, async h => {
      await admit(h);
      const flight = h.api.choose(h.api.rows()[1].token);
      const second = h.api.choose(h.api.rows()[1].token);
      const third = Promise.resolve().then(() => h.api.choose(h.api.rows()[0].token));
      await second; await third;
      expect(h.transports).toHaveLength(2);
      h.transports[1].resolve(choice(nothing)); await flight; await settle();
      expect(h.writes).toEqual([h.initialOptions[1].value]);
      const next = h.api.choose(h.api.rows()[0].token);
      expect(h.transports).toHaveLength(3);
      h.transports[2].resolve(choice(just(0))); await next;
    });
  });

  test("an owner replaced without notification is rechecked before and after the gesture", async () => {
    await withFixture("choice", {}, async h => {
      await admit(h); h.replaceWorkerSilently();
      await h.api.choose(h.api.rows()[1].token);
      expect(h.transports).toHaveLength(1);
      expect(h.writes).toEqual([]);
      expect(h.api.error()).toContain("replaced");
    });
    await withFixture("choice", {}, async h => {
      await admit(h);
      const flight = h.api.choose(h.api.rows()[1].token);
      h.replaceWorkerSilently();
      h.transports[1].resolve(choice(nothing)); await flight; await settle();
      expect(h.writes).toEqual([]);
    });
  });

  test("an old source answer cannot expose a choice while replacement selection is pending", async () => {
    await withFixture("choice", {}, async h => {
      const old = h.transports[0];
      h.setValue({ external: "replacement" }); await settle();
      const replacement = h.transports[1];
      expect(old.signal.aborted).toBe(true);
      old.resolve(choice(just(1))); await settle();
      expect(h.api.ready()).toBe(false);
      expect(h.api.selection()).toBeUndefined();
      replacement.resolve(choice(nothing)); await settle();
      expect(h.api.ready()).toBe(true);
      expect(h.api.token()).toBe(h.api.blank());
      expect(h.writes).toEqual([]);
    });
  });

  test("a queued value replacement fences a completion before an explicit flush", async () => {
    await withFixture("choice", {}, async h => {
      await admit(h);
      const flight = h.api.choose(h.api.rows()[1].token);
      h.setValue({ external: "queued replacement" });
      h.transports[1].resolve(choice(nothing));
      await flight; await settle();
      expect(h.writes).toEqual([]);
    });
  });

  test("an accepted choice refreshes its held selection and pending gestures stay harmless", async () => {
    await withFixture("choice", { acceptWrites: true }, async h => {
      await admit(h);
      const flight = h.api.choose(h.api.rows()[1].token);
      h.transports[1].resolve(choice(nothing)); await flight; await settle();
      expect(h.writes).toEqual([h.initialOptions[1].value]);
      expect(h.value()).toBe(h.initialOptions[1].value);
      expect(h.transports).toHaveLength(3);
      const refreshing = h.transports[2];
      expect(refreshing.payload.value).toBe(h.initialOptions[1].value);
      await h.api.choose(h.api.rows()[0].token);
      await h.api.choose(h.api.blank());
      expect(h.transports).toHaveLength(3);
      expect(h.writes).toHaveLength(1);
      refreshing.resolve(choice(just(1))); await settle();
      expect(h.api.token()).toBe(h.api.rows()[1].token);
      const next = h.api.choose(h.api.rows()[0].token);
      expect(h.transports[3].payload.value).toBe(h.initialOptions[1].value);
      h.transports[3].resolve(choice(nothing)); await next; await settle();
      expect(h.writes).toEqual([h.initialOptions[1].value, h.initialOptions[0].value]);
    });
  });

  test("unmount aborts projection and gesture, and late answers cannot publish", async () => {
    await withFixture("choice", {}, async h => {
      await admit(h);
      const flight = h.api.choose(h.api.rows()[1].token), request = h.transports[1];
      h.dispose();
      expect(request.signal.aborted).toBe(true);
      request.resolve(choice(nothing)); await flight;
      expect(h.writes).toEqual([]);
    });
    await withFixture("choice", {}, async h => {
      const request = h.transports[0]; h.dispose();
      expect(request.signal.aborted).toBe(true);
      request.resolve(choice(just(0))); await settle();
      expect(h.writes).toEqual([]);
    });
  });

  for (const refusal of ["reject", "abort", "missing-selection", "missing-index"]) test(`${refusal} retains the original choice`, async () => {
    await withFixture("choice", {}, async h => {
      await admit(h);
      const flight = h.api.choose(h.api.rows()[1].token), request = h.transports[1];
      if (refusal === "reject") request.reject(new Error("Controlled worker refusal"));
      else if (refusal === "abort") request.reject(new DOMException("Cancelled", "AbortError"));
      else request.resolve(refusal === "missing-selection" ? {} : { selection: {} });
      await flight; await settle();
      expect(h.writes).toEqual([]);
      expect(h.api.error()).toBeTruthy();
      expect(h.api.pending()).toBe(false);
      expect(h.synchronous).toEqual([]);
    });
  });

  test("missing or refused Local worker stays unavailable without synchronous fallback", async () => {
    await withFixture("choice", { available: false }, async h => {
      expect(h.api.ready()).toBe(false);
      expect(h.transports).toEqual([]);
      expect(h.synchronous).toEqual([]);
      expect(h.api.projected.error).toBeInstanceOf(Error);
      await h.api.choose(h.api.rows()[1].token);
      expect(h.writes).toEqual([]);
    });
    await withFixture("choice", {}, async h => {
      h.transports[0].reject(new Error("Controlled initial refusal")); await settle();
      expect(h.api.ready()).toBe(false);
      expect(h.api.projected.error.message).toBe("Controlled initial refusal");
      expect(h.synchronous).toEqual([]);
    });
  });
});

describe("list chip control worker lifetime", () => {
  test("initial projection and edit retain the exact owner, type, declaration, action and value", async () => {
    await withFixture("list", {}, async h => {
      expect(h.api.ready()).toBe(false);
      expect(h.synchronous).toEqual([]);
      const action = { $tag: "FieldListToggleChoice", index: 1, expected: h.initialOptions[1].value };
      await h.api.edit(action);
      expect(h.transports).toHaveLength(1);
      await admit(h);
      const flight = h.api.edit(action), request = h.transports[1];
      expect(request.payload).toEqual({ method: "edit-reader-list-chips", type: h.plan().editor.rawType,
        value: h.initialValue, action, declarationType: h.field().type });
      expect(request.payload.type).toBe(h.plan().editor.rawType);
      expect(request.payload.value).toBe(h.initialValue);
      expect(request.payload.action).toBe(action);
      expect(request.payload.declarationType).toBe(h.field().type);
      expect(request.handle).toBe(h.transports[0].handle);
      expect(h.writes).toEqual([]);
      const changed = [h.initialOptions[1].value];
      request.resolve({ edit: { $tag: "Ok", _0: changed } }); await flight; await settle();
      expect(h.writes[0]).toBe(changed);
      expect(h.synchronous).toEqual([]);
    });
  });

  test("an unnamed field declaration does not invent a nominal owner", async () => {
    await withFixture("list", {}, async h => {
      h.setField({ name: "anonymous", type: { $list: { $ref: "String" } } }); await settle();
      const projection = h.transports.at(-1); projection.resolve(selectedList()); await settle();
      const flight = h.api.edit({ $tag: "FieldListAppendChoice", index: 0, expected: h.initialOptions[0].value });
      const request = h.transports.at(-1);
      expect(request.payload.declarationType).toBeUndefined();
      request.resolve({ edit: { $tag: "Ok", _0: h.initialValue } }); await flight;
    });
  });

  const mutations = {
    options: h => h.setPlan({ editor: { ...h.plan().editor, choices: [...h.initialOptions] } }),
    reorder: h => h.setPlan({ editor: { ...h.plan().editor, choices: [...h.initialOptions].reverse() } }),
    "raw type": h => h.setPlan({ editor: { ...h.plan().editor, rawType: { $ref: "ChangedRawType" } } }),
    value: h => h.setValue([{ replacement: true }]),
    type: h => h.setType({ $ref: "ChangedType" }),
    field: h => h.setField({ name: "new", type: { $ref: "ChangedDeclaredOwner" } }),
    session: h => { const next = h.sessionFor("new-reader"); h.setSession(next); h.setRegistry(next.registry); },
    registry: h => h.setRegistry({ evaluateContext: () => h.foreignFrame }),
    worker: h => h.setWorkerToken({ label: "worker-two" }),
  };
  for (const [label, mutate] of Object.entries(mutations)) test(`${label} change aborts pending list edit and admits zero stale writes`, async () => {
    await withFixture("list", {}, async h => {
      await admit(h);
      const flight = h.api.edit({ $tag: "FieldListRemoveOccurrence", index: 0, expected: h.initialOptions[0].value });
      const request = h.transports[1];
      mutate(h); await settle();
      expect(request.signal.aborted).toBe(true);
      request.resolve({ edit: { $tag: "Ok", _0: [] } }); await flight; await settle();
      expect(h.writes).toEqual([]);
      if (label !== "registry") expect(h.synchronous).toEqual([]);
    });
  });

  test("a plain gesture lock serializes immediate and queued list edits", async () => {
    await withFixture("list", {}, async h => {
      await admit(h);
      const action = { $tag: "FieldListRemoveOccurrence", index: 0, expected: h.initialOptions[0].value };
      const flight = h.api.edit(action);
      await h.api.edit(action); await Promise.resolve().then(() => h.api.edit(action));
      expect(h.transports).toHaveLength(2);
      h.transports[1].resolve({ edit: { $tag: "Ok", _0: [] } }); await flight; await settle();
      expect(h.writes).toEqual([[]]);
      const next = h.api.edit(action); expect(h.transports).toHaveLength(3);
      h.transports[2].resolve({ edit: { $tag: "Err", _0: "Already removed" } }); await next;
    });
  });

  test("a silently replaced worker cannot publish an otherwise accepted list edit", async () => {
    await withFixture("list", {}, async h => {
      await admit(h);
      const flight = h.api.edit({ $tag: "FieldListRemoveOccurrence", index: 0, expected: h.initialOptions[0].value });
      h.replaceWorkerSilently();
      h.transports[1].resolve({ edit: { $tag: "Ok", _0: [] } }); await flight; await settle();
      expect(h.writes).toEqual([]);
    });
  });

  test("an old source answer cannot expose stale list occurrence positions", async () => {
    await withFixture("list", {}, async h => {
      const old = h.transports[0];
      h.setValue([h.initialOptions[1].value]); await settle();
      const replacement = h.transports[1];
      expect(old.signal.aborted).toBe(true);
      old.resolve(selectedList()); await settle();
      expect(h.api.ready()).toBe(false);
      expect(h.api.selection()).toBeUndefined();
      const changedSelection = { occurrences: [just(1)], selected: [false, true] };
      replacement.resolve({ selection: changedSelection }); await settle();
      expect(h.api.selection()).toBe(changedSelection);
      expect(h.writes).toEqual([]);
    });
  });

  test("a queued list replacement fences completion before an explicit flush", async () => {
    await withFixture("list", {}, async h => {
      await admit(h);
      const flight = h.api.edit({ $tag: "FieldListRemoveOccurrence", index: 0, expected: h.initialOptions[0].value });
      h.setValue([{ external: "queued replacement" }]);
      h.transports[1].resolve({ edit: { $tag: "Ok", _0: [] } });
      await flight; await settle();
      expect(h.writes).toEqual([]);
    });
  });

  test("an accepted list edit refreshes held positions and pending gestures stay harmless", async () => {
    await withFixture("list", { acceptWrites: true }, async h => {
      await admit(h);
      const changed = [h.initialOptions[1].value];
      const action = { $tag: "FieldListRemoveOccurrence", index: 0, expected: h.initialOptions[0].value };
      const flight = h.api.edit(action);
      h.transports[1].resolve({ edit: { $tag: "Ok", _0: changed } }); await flight; await settle();
      expect(h.writes).toEqual([changed]);
      expect(h.value()).toBe(changed);
      expect(h.transports).toHaveLength(3);
      const refreshing = h.transports[2];
      expect(refreshing.payload.value).toBe(changed);
      await h.api.edit(action);
      expect(h.transports).toHaveLength(3);
      expect(h.writes).toHaveLength(1);
      refreshing.resolve({ selection: { occurrences: [just(1)], selected: [false, true] } }); await settle();
      const next = h.api.edit({ $tag: "FieldListRemoveOccurrence", index: 0, expected: h.initialOptions[1].value });
      expect(h.transports[3].payload.value).toBe(changed);
      h.transports[3].resolve({ edit: { $tag: "Ok", _0: [] } }); await next; await settle();
      expect(h.writes).toEqual([changed, []]);
    });
  });

  for (const refusal of ["reject", "abort", "missing-edit", "wrong-tag", "wrong-value", "Err"]) test(`${refusal} retains the complete original list`, async () => {
    await withFixture("list", {}, async h => {
      await admit(h);
      const flight = h.api.edit({ $tag: "FieldListRemoveOccurrence", index: 0, expected: h.initialOptions[0].value });
      const request = h.transports[1];
      if (refusal === "reject") request.reject(new Error("Controlled worker refusal"));
      else if (refusal === "abort") request.reject(new DOMException("Cancelled", "AbortError"));
      else request.resolve(refusal === "missing-edit" ? {} : { edit: refusal === "wrong-tag"
        ? { $tag: "Just", _0: [] } : refusal === "wrong-value" ? { $tag: "Ok", _0: { wrong: "shape" } }
          : { $tag: "Err", _0: "Controlled edit refusal" } });
      await flight; await settle();
      expect(h.writes).toEqual([]);
      expect(h.api.error()).toBeTruthy();
      expect(h.api.pending()).toBe(false);
      expect(h.synchronous).toEqual([]);
    });
  });

  test("unmount aborts the list projection or edit and late answers cannot publish", async () => {
    for (const pendingEdit of [false, true]) await withFixture("list", {}, async h => {
      let flight;
      if (pendingEdit) {
        await admit(h);
        flight = h.api.edit({ $tag: "FieldListRemoveOccurrence", index: 0, expected: h.initialOptions[0].value });
      }
      const request = h.transports.at(-1); h.dispose();
      expect(request.signal.aborted).toBe(true);
      request.resolve(pendingEdit ? { edit: { $tag: "Ok", _0: [] } } : selectedList());
      if (flight) await flight;
      await settle(); expect(h.writes).toEqual([]);
    });
  });

  test("a missing Local worker retains the list and avoids main-page equality", async () => {
    await withFixture("list", { available: false }, async h => {
      expect(h.api.ready()).toBe(false);
      expect(h.transports).toEqual([]);
      expect(h.synchronous).toEqual([]);
      expect(h.api.projected.error).toBeInstanceOf(Error);
      await h.api.edit({ $tag: "FieldListRemoveOccurrence", index: 0, expected: h.initialOptions[0].value });
      expect(h.writes).toEqual([]);
    });
  });
});

describe("existing non-Local and explicit foreign owner backends", () => {
  for (const [label, options] of [
    ["account", { kind: "account" }], ["public", { kind: "public" }],
    ["foreign Local registry", { foreignRegistry: true }],
  ]) {
    test(`${label} choice remains synchronous in its own frame`, async () => {
      await withFixture("choice", options, async h => {
        expect(h.api.ready()).toBe(true);
        expect(h.transports).toEqual([]);
        const frame = options.foreignRegistry ? h.foreignFrame : h.initialSession.evaluateContext;
        const initial = h.synchronous.find(call => call.method === "choice");
        expect(initial.args).toEqual([h.initialOptions, h.initialValue, frame]);
        expect(initial.args[2]).toBe(frame);
        await h.api.choose(h.api.rows()[1].token);
        expect(h.writes[0]).toBe(h.initialOptions[1].value);
        expect(h.synchronous.at(-1).args[0]).toEqual([h.initialOptions[1]]);
        expect(h.synchronous.at(-1).args[2]).toBe(frame);
      });
    });
    test(`${label} list remains synchronous with its exact declaration and registry`, async () => {
      await withFixture("list", options, async h => {
        expect(h.api.ready()).toBe(true);
        expect(h.transports).toEqual([]);
        const frame = options.foreignRegistry ? h.foreignFrame : h.initialSession.evaluateContext;
        const initial = h.synchronous.find(call => call.method === "list");
        expect(initial.args[0]).toBe(h.initialOptions);
        expect(initial.args[1]).toBe(h.initialValue);
        expect(initial.args[2]).toBe(frame);
        const action = { $tag: "FieldListAppendChoice", index: 1, expected: h.initialOptions[1].value };
        const changed = [h.initialOptions[1].value];
        h.setSynchronousEdit({ $tag: "Ok", _0: changed });
        await h.api.edit(action);
        const edit = h.synchronous.find(call => call.method === "edit");
        expect(edit.args).toEqual([h.plan().editor.rawType, h.initialValue, action, frame, h.registry(), h.field().type]);
        expect(edit.args[2]).toBe(action); expect(edit.args[3]).toBe(frame);
        expect(edit.args[4]).toBe(h.registry()); expect(edit.args[5]).toBe(h.field().type);
        expect(h.writes[0]).toBe(changed);
      });
    });
  }
});

describe("B4 F1: a Local reader whose page session throws on every registry/evaluator read", () => {
  test("choice and list controls project, choose and edit in the worker only", async () => {
    await withFixture("choice", { poisoned: true }, async h => {
      expect(h.transports[0].payload.method).toBe("project-reader-choice-selection");
      await admit(h);
      const flight = h.api.choose(h.api.rows()[1].token);
      h.transports[1].resolve(choice(nothing)); await flight; await settle();
      expect(h.writes).toEqual([h.initialOptions[1].value]);
      expect(h.synchronous).toEqual([]);
    });
    await withFixture("list", { poisoned: true }, async h => {
      expect(h.transports[0].payload.method).toBe("project-reader-list-selection");
      await admit(h);
      expect(h.synchronous).toEqual([]);
    });
  });

  test("a foreign registry keeps its own frame without reading the page session", async () => {
    await withFixture("choice", { poisoned: true, foreignRegistry: true }, async h => {
      expect(h.transports).toEqual([]);
      expect(h.synchronous).toHaveLength(1);
      expect(h.synchronous[0].args[2]).toBe(h.foreignFrame);
    });
  });

  test("a missing worker refuses without a page read", async () => {
    await withFixture("choice", { poisoned: true, available: false }, async h => {
      expect(h.api.ready()).toBe(false);
      expect(h.transports).toEqual([]); expect(h.synchronous).toEqual([]);
    });
  });
});
