import { describe, expect, test } from "bun:test";
import { createRoot, createSignal, createMemo, createEffect, flush, latest, onSettled, isPending, refresh }
  from "../../../node_modules/solid-js/dist/solid.dev.js";

// B4 F1: the production FunctionPicker body (up to its JSX) for a Local reader
// whose page session throws on every registry/evaluator read: options and the
// stored value's selection come from one worker request; the page registry,
// std fallback and global labels are never read. The worker handler's parity
// with the page model runs over real registries in
// `expression-runner/reader-function-options-parity.test.ts`.
const transpiler = new Bun.Transpiler({ loader: "ts" });
const compile = code => transpiler.transformSync(code).replace(/^export /gm, "");
const source = (await Bun.file(new URL("./FieldRenderer.tsx", import.meta.url)).text()).replace(/\r\n/g, "\n");
const model = (await Bun.file(new URL("./function-picker-model.ts", import.meta.url)).text()).replace(/\r\n/g, "\n");
function section(text, begin, end) {
  const start = text.indexOf(begin), finish = text.indexOf(end, start + begin.length);
  if (start < 0 || finish < start) throw new Error(`The function picker fixture boundary moved: ${begin}`);
  return text.slice(start, finish);
}
const owner = section(source, "function localFieldSelectionWorker(", "/** Adapts the Fenel-owned edit plan");
const picker = source.slice(source.indexOf("function FunctionPicker("));
const body = section(picker, "  const callables = useContext(CallableRegistryContext);", "\n  return (\n");
const helpers = section(model, "function functionPickerHandle(", "export function functionOptionLabel(");
const asyncSource = await Bun.file(new URL("../async-value.ts", import.meta.url)).text();
const createAsyncValue = new Function("createMemo", "createSignal", "isPending", "refresh",
  `${compile(asyncSource.slice(asyncSource.indexOf("const LOADING:")))};return createAsyncValue;`)(createMemo, createSignal, isPending, refresh);
const settle = async () => { for (let turn = 0; turn < 16; turn++) { await Promise.resolve(); flush(); } };
const deferred = () => { let resolve, reject; const promise = new Promise((yes, no) => { resolve = yes; reject = no; }); return { promise, resolve, reject }; };

function harness(options = {}) {
  const pageReads = [], requests = [];
  const session = { label: "page session" };
  for (const key of ["registry", "evaluateContext", "environment", "catalog"]) Object.defineProperty(session, key, { get() {
    pageReads.push(key); throw new Error(`Page session ${key} read for a Local reader`); } });
  const token = { snapshot: "own registry token",
    listFunctions() { pageReads.push("listFunctions"); return [{ id: "page:fn" }]; },
    getFunction(handle) { pageReads.push(`getFunction:${handle}`); return handle === "page:fn" ? { id: "page:fn" } : undefined; } };
  const foreign = { listFunctions: () => [{ id: "foreign:fn" }], getFunction: handle => handle === "foreign:fn" ? { id: "foreign:fn" } : undefined };
  const worker = { worker: "one" };
  let dispose, api, setters, workerRef = { current: worker };
  createRoot(close => {
    dispose = close;
    const [value, setValue] = createSignal(options.value ?? { $ref: "add" });
    const [callable] = createSignal(options.callable === "foreign" ? foreign : undefined);
    const [workerTick, setWorkerTick] = createSignal(0);
    const reader = { kind: options.kind ?? "local", session: () => session, registry: () => token };
    const imports = {
      props: { get value() { return value(); }, arrowType: undefined, label: "Function", onChange: () => {} },
      useContext: () => callable, CallableRegistryContext: {}, useFieldPresentationRegistry: () => () => token,
      useReaderRuntime: () => reader, useAuthoringSession: () => session,
      createMemo, createAsyncValue, onSettled, latest, DETACHED_AUTHORING_SESSION: { detached: true },
      printFenel: () => "", functionOptionLabel: id => { pageReads.push(`label:${id}`); return `page label ${id}`; },
      createRegistryLazy: () => { pageReads.push("std"); return token; },
      preparedReaderWorkerForSession: () => { workerTick(); return options.noWorker ? undefined : workerRef.current; },
      registryHasSnapshotOwner: candidate => candidate === options.stale,
      runPreparedReaderWorker: (handle, payload, signal) => { const held = deferred(); requests.push({ handle, payload, signal, ...held }); return held.promise; },
    };
    api = new Function(...Object.keys(imports), `${compile(helpers)}\n${compile(owner)}\n${compile(body)}
      return { options, selection, fallback, localReady, localError, local, localView: typeof localView === "function" ? localView : () => undefined };`)(...Object.values(imports));
    createEffect(() => [api.options(), api.selection(), api.fallback(), api.localError()], () => {});
    setters = { setValue, replaceWorker: () => { workerRef.current = { worker: "two" }; setWorkerTick(tick => tick + 1); } };
  });
  flush();
  return { api, pageReads, requests, worker, token, ...setters, dispose: () => { dispose(); flush(); } };
}
const answer = (options, selection) => ({ functionOptions: { options, selection } });
const PROMPT = { value: "", label: "— pick a function —" };

describe("B4 F1: a Local FunctionPicker lists and resolves in its worker", () => {
  test("one guidance request answers options and selection; nothing is read on the page", async () => {
    const h = harness();
    try {
      await settle();
      expect(h.requests.map(row => row.payload)).toEqual([{ method: "project-reader-function-options", value: { $ref: "add" }, priority: "guidance" }]);
      expect(h.requests[0].handle).toBe(h.worker);
      // Pending: only the prompt, no selection, no positive answer.
      expect(h.api.options()).toEqual([PROMPT]);
      expect(h.api.selection()).toEqual({ kind: "none" });
      h.requests[0].resolve(answer([{ value: "std:add", label: "add (Math)" }], { kind: "function", id: "std:add" })); await settle();
      expect(h.api.options()).toEqual([PROMPT, { value: "std:add", label: "add (Math)" }]);
      expect(h.api.selection()).toEqual({ kind: "function", id: "std:add" });
      expect(h.api.fallback()).toEqual({ value: "std:add", label: "add (Math)" });
      expect(h.pageReads).toEqual([]);
    } finally { h.dispose(); }
  });

  test("a yielded answer is asked again and the final answer is shown", async () => {
    const h = harness();
    try {
      await settle();
      h.requests[0].resolve({ yielded: true }); await settle();
      expect(h.requests).toHaveLength(2);
      expect(h.api.localReady()).toBeUndefined();
      h.requests[1].resolve(answer([{ value: "a", label: "A" }], { kind: "unresolved", handle: "add" })); await settle();
      expect(h.api.fallback()).toEqual({ value: "add", label: "add", icon: "alert-triangle" });
      expect(h.pageReads).toEqual([]);
    } finally { h.dispose(); }
  });

  test("a value change aborts the previous request and a stale answer is never shown", async () => {
    const h = harness();
    try {
      await settle();
      h.setValue({ $ref: "other" }); await settle();
      expect(h.requests).toHaveLength(2);
      expect(h.requests[0].signal.aborted).toBe(true);
      h.requests[0].resolve(answer([{ value: "old", label: "Old" }], { kind: "function", id: "old" })); await settle();
      expect(h.api.localReady()).toBeUndefined();
      h.requests[1].resolve(answer([{ value: "new", label: "New" }], { kind: "function", id: "new" })); await settle();
      expect(h.api.selection()).toEqual({ kind: "function", id: "new" });
    } finally { h.dispose(); }
  });

  test("a malformed answer or a missing worker refuses with copy and no page fallback", async () => {
    const h = harness();
    try {
      await settle();
      h.requests[0].resolve({ functionOptions: { options: "no" } }); await settle();
      expect(h.api.localError()?.message).toBe("This field's functions could not be read.");
      expect(h.api.options()).toEqual([PROMPT]);
    } finally { h.dispose(); }
    const missing = harness({ noWorker: true });
    try {
      await settle();
      expect(missing.requests).toEqual([]);
      expect(missing.api.localError()?.message).toContain("not ready");
      expect(missing.pageReads).toEqual([]);
    } finally { missing.dispose(); }
  });

  test("a foreign callable registry and Account keep the page model", async () => {
    const foreign = harness({ callable: "foreign", value: { $ref: "foreign:fn" } });
    try {
      await settle();
      expect(foreign.requests).toEqual([]);
      expect(foreign.api.selection()).toEqual({ kind: "function", id: "foreign:fn" });
    } finally { foreign.dispose(); }
    const account = harness({ kind: "account", value: { $ref: "page:fn" } });
    try {
      await settle();
      expect(account.requests).toEqual([]);
      expect(account.api.selection()).toEqual({ kind: "function", id: "page:fn" });
      expect(account.pageReads).toContain("listFunctions");
    } finally { account.dispose(); }
  });

  test("after a pick the options stay listed and enabled; only the selection is asked again", async () => {
    const h = harness();
    try {
      await settle();
      const listed = [{ value: "std:add", label: "add (Math)" }, { value: "std:sub", label: "sub (Math)" }];
      h.requests[0].resolve(answer(listed, { kind: "function", id: "std:add" })); await settle();
      h.setValue({ $ref: "std:sub" }); await settle();
      expect(h.requests).toHaveLength(2);
      expect(h.api.options()).toEqual([PROMPT, ...listed]);
      expect(h.api.localView()?.ready).toBe(false);
      expect(h.api.selection()).toEqual({ kind: "function", id: "std:sub" });
      expect(h.api.fallback()).toEqual({ value: "std:sub", label: "sub (Math)" });
      h.requests[1].resolve(answer(listed, { kind: "function", id: "std:sub" })); await settle();
      expect(h.api.localView()?.ready).toBe(true);
      expect(h.api.selection()).toEqual({ kind: "function", id: "std:sub" });
      expect(h.pageReads).toEqual([]);
    } finally { h.dispose(); }
  });

  test("a pending alias keeps the options but claims no selection until answered", async () => {
    const h = harness();
    try {
      await settle();
      const listed = [{ value: "std:add", label: "add (Math)" }];
      h.requests[0].resolve(answer(listed, { kind: "none" })); await settle();
      h.setValue("add"); await settle();
      expect(h.api.options()).toEqual([PROMPT, ...listed]);
      expect(h.api.selection()).toEqual({ kind: "none" });
      h.requests[1].resolve(answer(listed, { kind: "function", id: "std:add" })); await settle();
      expect(h.api.selection()).toEqual({ kind: "function", id: "std:add" });
    } finally { h.dispose(); }
  });

  test("another worker never inherits the previous worker's options", async () => {
    const h = harness();
    try {
      await settle();
      h.requests[0].resolve(answer([{ value: "std:add", label: "add" }], { kind: "none" })); await settle();
      h.replaceWorker(); await settle();
      expect(h.requests.at(-1).handle).toEqual({ worker: "two" });
      expect(h.api.options()).toEqual([PROMPT]);
      expect(h.api.localView()).toBeUndefined();
    } finally { h.dispose(); }
  });

  test("an answer with a malformed option or selection refuses", async () => {
    for (const bad of [answer([{ value: 1, label: "x" }], { kind: "none" }), answer([], { kind: "function" }), answer([], { kind: "other" })]) {
      const h = harness();
      try {
        await settle();
        h.requests[0].resolve(bad); await settle();
        expect(h.api.localError()?.message).toBe("This field's functions could not be read.");
        expect(h.api.options()).toEqual([PROMPT]);
      } finally { h.dispose(); }
    }
  });
});
