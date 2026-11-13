import { describe, expect, test } from "bun:test";
import { createRoot, createSignal, createMemo, createEffect, flush, latest, onSettled, isPending, refresh, untrack } from "../../../node_modules/solid-js/dist/solid.dev.js";

// Production AtomicEditor preparation and publication bodies, actual Solid 2
// async graph, controlled worker replies. This fixture supplies no numeric plan.
const source = await Bun.file(new URL("./VariantValueEditor.tsx", import.meta.url)).text();
const asyncSource = await Bun.file(new URL("../async-value.ts", import.meta.url)).text();
const stringSource = await Bun.file(new URL("../field-renderer/string-input-surface.tsx", import.meta.url)).text();
const begin = source.indexOf("  const reader =", source.indexOf("function AtomicEditor("));
const end = source.indexOf("  return <Show", begin);
if (begin < 0 || end < begin) throw new Error("AtomicEditor preparation boundary moved.");
const nativeInput = source.slice(end).match(/onChange=\{\(value\) => ([^\n]+)\} \/>/)?.[1];
if (!nativeInput) throw new Error("AtomicEditor native input boundary moved.");
const transpiler = new Bun.Transpiler({ loader: "ts" });
const compile = text => transpiler.transformSync(text).replace(/^export /gm, "");
const stringBegin = stringSource.indexOf("  let model ="), stringEnd = stringSource.indexOf("\n  return (", stringBegin);
const stringValue = stringSource.match(/\bvalue=\{([^}]+)\}/)?.[1];
if (stringBegin < 0 || stringEnd < stringBegin || !stringValue) throw new Error("Shared string host fixture moved.");
const nativeString = new Function("createSignal", "createEffect", "untrack", "latest", "props",
  `${compile(stringSource.slice(stringBegin, stringEnd))}; return { input, displayed: () => (${stringValue}) };`);
const createAsyncValue = new Function("createMemo", "createSignal", "isPending", "refresh",
  `${compile(asyncSource.slice(asyncSource.indexOf("const LOADING:")))}; return createAsyncValue;`)(createMemo, createSignal, isPending, refresh);
const body = compile(`${source.slice(begin, end)}; return { ready, retainedPlan, codec, change: () => change().callback,
  nativeInput: e => { const value = e.currentTarget.value; return ${nativeInput}; }, displayedName, projectedPlan };`);
const deferred = () => { let resolve, reject; const promise = new Promise((yes, no) => { resolve = yes; reject = no; }); return { promise, resolve, reject }; };
async function settle() { for (let tick = 0; tick < 10; tick++) { await Promise.resolve(); flush(); } }
function fixture(options = {}) {
  let dispose;
  const h = createRoot(close => {
    dispose = close;
    const makeSession = label => ({ label, evaluateContext: { label }, registry: { label } });
    const initial = makeSession("first");
    const [session, setSession] = createSignal(initial);
    const [typeName, setTypeName] = createSignal(options.typeName ?? "Rational");
    const [value, setValue] = createSignal(options.value);
    const [notification, setNotification] = createSignal(0);
    const [publisher, setPublisher] = createSignal(0);
    const [handle, setHandle] = createSignal({ label: "first worker" });
    let silentHandle, missing = false;
    const calls = [], writes = [], adapters = [], localPlans = [];
    const preparedReaderWorkerForSession = selected => { notification(); return missing ? undefined : silentHandle ?? handle(); };
    const reader = { kind: options.kind ?? "local", session };
    const props = { get typeName() { return typeName(); }, get value() { return value(); },
      get onChange() { publisher(); return next => writes.push(next); } };
    const asyncValue = (...args) => {
      const state = createAsyncValue(...args);
      if (!options.inheritedPending) return state;
      const read = () => state();
      Object.defineProperties(read, { loading: { get: () => true }, error: { get: () => state.error }, refetch: { value: () => state.refetch() } });
      return read;
    };
    const imports = { props, createMemo, createAsyncValue: asyncValue, onSettled, latest,
      useReaderRuntime: () => reader, useAuthoringSession: () => initial,
      useFieldPresentationRegistry: () => () => options.foreignRegistry,
      preparedReaderWorkerForSession, runPreparedReaderWorker: (worker, payload, signal) => {
        const held = deferred(); calls.push({ worker, payload, signal, ...held }); return held.promise;
      }, fieldNumericTextCodecPlan: (...args) => { localPlans.push(args); return options.synchronousMethods; },
      numericTextCodec: (...args) => { const adapter = { args, identity: adapters.length }; adapters.push(adapter); return adapter; } };
    const api = new Function(...Object.keys(imports), body)(...Object.values(imports));
    const observations = [];
    createEffect(() => options.observePlanOnly ? api.retainedPlan()
      : { ready: api.ready(), plan: api.retainedPlan(), codec: api.codec(), change: api.change() }, value => { observations.push(value); });
    return { api, calls, writes, adapters, localPlans, observations, value, setSession, setTypeName, setValue, setHandle, setPublisher,
      initial, makeSession, notify: () => setNotification(count => count + 1),
      replaceSilently: () => { silentHandle = { label: "new silent worker" }; }, removeWorker: () => { missing = true; } };
  });
  return { ...h, dispose: () => { dispose(); flush(); } };
}
const methods = () => ({ decode: { $ref: "decoder" }, encode: { $ref: "encoder" } });
async function admit(h, index = 0, codec = methods()) { h.calls[index].resolve({ codec: codec === null ? undefined : codec }); await settle(); }

describe("Atomic numeric plan ownership", () => {
  test("the conditional presentation subscriber wakes for a settled no-codec owner transition", async () => {
    const h = fixture({ observePlanOnly: true });
    try {
      await settle(); await admit(h); expect(h.observations.at(-1)?.input.typeName).toBe("Rational");
      h.setTypeName("String"); await settle(); expect(h.observations.at(-1)).toBeUndefined();
      await admit(h, 1, null); expect(h.observations.at(-1)?.input.typeName).toBe("String");
      expect(h.api.codec()).toBeUndefined(); expect(h.api.ready()).toBe(true);
    } finally { h.dispose(); }
  });
  test("Local initial preparation never selects a page codec or publishes before readiness", async () => {
    const h = fixture();
    try {
      await settle(); expect(h.calls).toHaveLength(1); expect(h.localPlans).toEqual([]);
      expect(h.api.ready()).toBe(false); expect(h.api.retainedPlan()).toBeUndefined();
      h.api.change()("blocked"); expect(h.writes).toEqual([]);
      await admit(h); expect(h.api.ready()).toBe(true);
      expect(h.api.codec().args).toEqual([h.initial, { typeName: "Rational" }, { remote: true }]);
      h.api.change()({ exact: "source" }); expect(h.writes).toEqual([{ exact: "source" }]);
    } finally { h.dispose(); }
  });

  test("fulfilled exact-owner availability is ready despite an inherited pending graph flag", async () => {
    const h = fixture({ inheritedPending: true });
    try {
      await settle(); expect(h.api.ready()).toBe(false);
      await admit(h); expect(h.api.projectedPlan.loading).toBe(true); expect(h.api.ready()).toBe(true);
      h.api.change()("current source data"); expect(h.writes).toEqual(["current source data"]);
    } finally { h.dispose(); }
  });

  test("value echoes and same-owner refreshed codec carriers preserve adapter identity", async () => {
    const h = fixture();
    try {
      await settle(); await admit(h); const codec = h.api.codec();
      h.setValue({ clone: true }); await settle(); expect(h.calls).toHaveLength(1); expect(h.api.codec()).toBe(codec);
      h.notify(); await settle(); expect(h.calls).toHaveLength(2); expect(h.api.retainedPlan()).toBeDefined();
      expect(h.api.ready()).toBe(false); expect(h.api.codec()).toBe(codec);
      await admit(h, 1); expect(h.api.ready()).toBe(true); expect(h.api.codec()).toBe(codec); expect(h.adapters).toHaveLength(1);
    } finally { h.dispose(); }
  });

  for (const change of ["type", "session", "worker"]) test(`${change} drops prior-owner presentation and fences the captured callback`, async () => {
    const h = fixture();
    try {
      await settle(); await admit(h); const oldChange = h.api.change();
      if (change === "type") h.setTypeName("String");
      else if (change === "session") h.setSession(h.makeSession("new reader"));
      else h.setHandle({ label: "new worker" });
      await settle(); expect(h.api.ready()).toBe(false); expect(h.api.retainedPlan()).toBeUndefined();
      oldChange("pending"); expect(h.writes).toEqual([]);
      await admit(h, 1, change === "type" ? null : methods());
      expect(h.api.ready()).toBe(true); oldChange("obsolete"); expect(h.writes).toEqual([]);
      h.api.change()("current"); expect(h.writes).toEqual(["current"]);
    } finally { h.dispose(); }
  });

  test("a silently replaced physical worker blocks source-independent native callbacks", async () => {
    const h = fixture({ typeName: "String" });
    try {
      await settle(); await admit(h, 0, null); expect(h.api.ready()).toBe(true); expect(h.api.codec()).toBeUndefined();
      const change = h.api.change(); h.replaceSilently(); change("late native input"); expect(h.writes).toEqual([]);
    } finally { h.dispose(); }
  });

  test("a queued publisher replacement cannot execute the callback as a signal updater", async () => {
    const h = fixture();
    try {
      await settle(); await admit(h); const old = h.api.change(); h.setPublisher(1);
      old("obsolete before flush"); expect(h.writes).toEqual([]);
      await settle(); expect(h.writes).toEqual([]);
      h.api.change()("current"); expect(h.writes).toEqual(["current"]);
    } finally { h.dispose(); }
  });

  test("a fresh native input uses the latest inert publisher before its queued owner commits", async () => {
    const h = fixture({ typeName: "String" });
    try {
      await settle(); await admit(h, 0, null); h.setPublisher(1);
      h.api.nativeInput({ currentTarget: { value: "fresh current edit" } });
      expect(h.writes).toEqual(["fresh current edit"]);
      await settle(); expect(h.writes).toEqual(["fresh current edit"]);
    } finally { h.dispose(); }
  });

  test("the actual shared string host retains Atomic's draft while its source model is held", async () => {
    const h = fixture({ typeName: "String", value: "before" }); let disposeLeaf;
    try {
      await settle(); await admit(h, 0, null);
      const leaf = createRoot(close => {
        disposeLeaf = close;
        const props = { get value() { return h.value(); }, readonly: false,
          onChange: value => h.api.nativeInput({ currentTarget: { value } }) };
        return nativeString(createSignal, createEffect, untrack, latest, props);
      });
      await settle(); leaf.input({ value: "held current edit" });
      expect(leaf.displayed()).toBe("held current edit");
      await settle(); expect(h.value()).toBe("before"); expect(leaf.displayed()).toBe("held current edit");
      expect(h.writes).toEqual(["held current edit"]);
      h.setValue("held current edit"); await settle(); expect(leaf.displayed()).toBe("held current edit");
      expect(h.writes).toHaveLength(1);
    } finally { disposeLeaf?.(); h.dispose(); }
  });

  test("old plan requests abort, and disposal refuses late delivery", async () => {
    const h = fixture();
    await settle(); const old = h.calls[0]; h.setTypeName("Nat"); await settle(); expect(old.signal.aborted).toBe(true);
    old.resolve({ codec: methods() }); await settle(); expect(h.api.ready()).toBe(false);
    h.dispose(); expect(h.calls[1].signal.aborted).toBe(true); h.calls[1].resolve({ codec: methods() }); await settle(); expect(h.writes).toEqual([]);
  });

  test("disposed native controls cannot publish through a retained ready callback", async () => {
    const h = fixture({ typeName: "String" });
    await settle(); await admit(h, 0, null); const change = h.api.change();
    h.dispose(); change("post-disposal native input"); expect(h.writes).toEqual([]);
  });

  test("synchronous other backends keep the existing scoped source plan", async () => {
    const supplied = methods(), h = fixture({ kind: "account", synchronousMethods: supplied });
    try {
      await settle(); expect(h.calls).toEqual([]); expect(h.api.ready()).toBe(true);
      expect(h.localPlans).toEqual([["Rational", h.initial.evaluateContext]]);
      expect(h.api.codec().args).toEqual([h.initial, { methods: supplied }]);
    } finally { h.dispose(); }
  });

  test("an explicitly different field owner preserves the synchronous backend", async () => {
    const supplied = methods(), h = fixture({ foreignRegistry: { label: "other owner" }, synchronousMethods: supplied });
    try {
      await settle(); expect(h.calls).toEqual([]); expect(h.api.ready()).toBe(true);
      expect(h.api.codec().args).toEqual([h.initial, { methods: supplied }]);
    } finally { h.dispose(); }
  });
});
