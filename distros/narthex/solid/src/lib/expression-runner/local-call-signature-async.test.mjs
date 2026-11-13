// Run with: bun test --conditions=browser --conditions=development ./src/lib/expression-runner/local-call-signature-async.test.mjs
import { expect, test } from "bun:test";
import { createComponent, createEffect, createMemo, createProjection, createRoot, createSignal, flush, Loading, onCleanup, snapshot, untrack } from "solid-js";
import { draftValueFingerprint } from "../native-draft";
import { createLiveGuidance } from "./live-guidance";
import { compiled, deferred, homeSource, localWorld, section } from "./local-save-admission.fixture.mjs";

// Actual Home projection, signature/guidance chain, and Local client owners.
// Only source acquisition and worker delivery are controlled. No registry boots.
const captureSource = (await Bun.file(new URL("./live-guidance-local.ts", import.meta.url)).text()).replaceAll("\r\n", "\n");
const actionSource = (await Bun.file(new URL("./local-reader-actions.ts", import.meta.url)).text()).replaceAll("\r\n", "\n");
const owner = section(homeSource, "  // Argument expressions remain the source.", "  const addressPreview = createAsyncValue(");
const decoder = section(homeSource, "function readLocalCallSignature(", "function readLocalHandles(");
const pinCheck = section(homeSource, "          if (draftValueFingerprint(request.inputValues)", "\n        }\n        const item = callGuidanceItem(signature);");
const literal = value => ({ kind: "literal", value });
const field = { name: "input", type: { $ref: "Number" }, key: { $tag: "NamedField", ref: { $ref: "field-identity" } },
  label: { $tag: "Nothing" }, ui: { $tag: "Nothing" }, meta: {} };
const definition = { id: "function-identity", params: [field], returns: { $ref: "String" }, body: "result" };
async function settle() { for (let turn = 0; turn < 20; turn++) { await Promise.resolve(); flush(); } }
const unwrap = value => typeof value === "function" ? unwrap(value()) : Array.isArray(value) ? value.map(unwrap) : value;

function mount() {
  return createRoot(dispose => {
    const world = localWorld(), sessionReady = deferred(), definitionReady = deferred();
    world.session().environment.getFunctionEntry = () => undefined;
    const [args, setArgs] = createSignal([literal(0)]);
    const [sessionInput, setSessionInput] = createSignal(sessionReady.promise);
    const [definitionInput, setDefinitionInput] = createSignal(definitionReady.promise);
    const authoringSession = createMemo(() => sessionInput()), fnData = createMemo(() => definitionInput());
    const fn = createMemo(() => fnData().definition.function), params = createMemo(() => fn().params);
    const posts = [], refusals = [];
    const captureImports = { ...world.imports, untrack, createLiveGuidance, authoringExpressionHasEmptySlot: () => false };
    const capture = new Function(...Object.keys(captureImports), compiled(captureSource.slice(captureSource.indexOf("export type LocalGuidanceCapture")))
      + "; return { createLocalLiveGuidance, localGuidanceCapture, localGuidanceCurrent, sameLocalGuidanceCapture };")(...Object.values(captureImports));
    const send = (_target, payload, signal) => {
      const held = deferred(); posts.push({ payload: structuredClone(payload), signal, ...held }); return held.promise;
    };
    const actionImports = { ...capture, createEffect, createSignal, onCleanup, untrack, draftValueFingerprint,
      preparedReaderWorkerForSession: () => ({ fixture: "handle" }), runPreparedReaderWorker: send, runAuthoringWorker: send,
      reachedSavedSources: () => [] };
    const actions = new Function(...Object.keys(actionImports), compiled(actionSource.slice(actionSource.indexOf("/** The existing Local refusal sentences")))
      + "; return { createLocalReaderAnswer, openLocalLiveGuidance };")(...Object.values(actionImports));
    // Public worker clients receive a host metadata capture, not a cloneable
    // packet. Record their ordinary node/admission data without cloning it.
    const check = (_session, node, _saved, options, signal) => send(undefined,
      { method: "expression-save-issue", node, priority: options.priority }, signal);
    const evaluate = (_session, node, _saved, signal, _scope, options) => send(undefined,
      { method: "evaluate-expression", node, priority: options.priority }, signal);
    const bindings = { ...capture, ...actions, createMemo, createSignal, createProjection, snapshot, onCleanup, untrack,
      params, fn, authoringSession, argExprs: args, props: { fnId: definition.id }, reader: world.reader,
      detectStructuralForm: () => undefined, savedCtx: { list: () => [] }, refResolver: () => undefined,
      projectAuthoringScheme: () => undefined, expressionSaveIssueInWorker: check, evaluateExpressionInWorker: evaluate,
      LOCAL_SAVE_TOOLS_PENDING: world.LOCAL_SAVE_TOOLS_PENDING, WorkerRequestError: class extends Error {}, addressIssues: () => [],
      draftSaveIssue: () => { throw new Error("Local page fallback"); }, draftValueFingerprint,
      setPinRefusal: issue => refusals.push(issue), LOCAL_SAVE_DRAFT_CHANGED: world.LOCAL_SAVE_DRAFT_CHANGED };
    let api;
    const rendered = createComponent(Loading, { fallback: "pending", get children() {
      api = new Function(...Object.keys(bindings), compiled(decoder) + compiled(owner)
        + `; function assertPinInputs(request) { ${compiled(pinCheck)} }
          return { callSignatureRequest, localCallSignature, callGuidance, callLocalAnswer, assertPinInputs };`)(...Object.values(bindings));
      const display = createMemo(() => api.callLocalAnswer());
      return () => JSON.stringify(display());
    } });
    createEffect(() => unwrap(rendered), () => {});
    sessionReady.resolve(world.session()); definitionReady.resolve({ definition: { function: definition } });
    return { dispose, world, posts, refusals, setArgs, setDefinitionInput, get api() { return api; },
      edit(value) { setArgs([literal(value)]); api.callGuidance.touch(); },
      replaceSession() {
        const ready = deferred(); world.replaceSession(); world.session().environment.getFunctionEntry = () => undefined;
        setSessionInput(ready.promise); return () => ready.resolve(world.session());
      },
      async frame() { await new Promise(resolve => setTimeout(resolve, 0)); await settle(); },
      async answer(index, value) { posts[index].resolve(value); await settle(); },
      async signature(index) { await this.answer(index, { callSignature: { params: posts[index].payload.params, schemes: [] } }); },
    };
  });
}
const signatures = h => h.posts.map((row, index) => ({ row, index })).filter(({ row }) => row.payload.method === "project-reader-call-signature");
async function ready() {
  const h = mount(); await settle();
  expect(signatures(h)).toHaveLength(1); expect(signatures(h)[0].row.payload.inputValues).toEqual({ input: 0 });
  return h;
}

test("async source/session captures 0 then 7 and resumes parameter, whole-call and result guidance", async () => {
  const h = await ready();
  try {
    await h.signature(0); h.edit(7); await settle();
    const current = signatures(h).at(-1); expect(current.row.payload.inputValues).toEqual({ input: 7 });
    await h.signature(current.index); await h.frame();
    let index = current.index + 1;
    expect(h.posts[index].payload).toMatchObject({ method: "expression-save-issue", node: literal(7), priority: "guidance" });
    await h.answer(index++, {});
    expect(h.posts[index].payload).toMatchObject({ method: "expression-save-issue", node: { kind: "call", fnId: definition.id, args: [literal(7)] } });
    await h.answer(index++, {}); expect(h.posts[index].payload.method).toBe("evaluate-expression");
    await h.answer(index, { result: "result", trace: [] });
    expect(h.api.callLocalAnswer().evaluation.result).toBe("result"); expect(h.world.pageReads).toEqual([]);
  } finally { h.dispose(); }
});

test("nested replacement and removal keep complete data and Pin's current-input refusal", async () => {
  const h = await ready();
  try {
    const previous = signatures(h)[0].row.payload; await h.signature(0);
    const value = { nested: { amount: 7 }, rows: [{ enabled: false }, { text: "" }] };
    h.edit(value); await settle(); let current = signatures(h).at(-1);
    expect(current.row.payload.inputValues).toEqual({ input: value }); expect(previous.inputValues).toEqual({ input: 0 });
    expect(() => h.api.assertPinInputs(previous)).toThrow(h.world.LOCAL_SAVE_DRAFT_CHANGED);
    expect(() => h.api.assertPinInputs(current.row.payload)).not.toThrow();
    await h.signature(current.index); h.edit(undefined); await settle(); current = signatures(h).at(-1);
    expect(current.row.payload.inputValues).toEqual({}); await h.signature(current.index);
  } finally { h.dispose(); }
});

test("async schema/argument replacement sends the final current parameter identities and data", async () => {
  const h = await ready();
  try {
    await h.signature(0); const renamed = { ...field, name: "renamed", type: { $ref: "String" } };
    h.setDefinitionInput(Promise.resolve({ definition: { function: { ...definition, params: [renamed] } } }));
    h.setArgs([literal({ nested: "fresh" })]); h.api.callGuidance.touch(); await settle();
    expect(signatures(h)).toHaveLength(2); const current = signatures(h).at(-1);
    expect(current.row.payload.params).toEqual([renamed]); expect(current.row.payload.inputValues).toEqual({ renamed: { nested: "fresh" } });
    await h.signature(current.index); expect(h.api.localCallSignature.answer()).toBeDefined();
  } finally { h.dispose(); }
});

test("identical settled data reuses its answer, while a changed pending request refuses a late reply", async () => {
  const h = await ready();
  try {
    await h.signature(0); h.setArgs([literal(0)]); await settle(); expect(signatures(h)).toHaveLength(1);
    h.edit(7); await settle(); const old = signatures(h).at(-1); h.edit(8); await settle(); const current = signatures(h).at(-1);
    expect(old.row.signal.aborted).toBe(true); await h.signature(old.index); expect(h.api.localCallSignature.answer()).toBeUndefined();
    await h.signature(current.index); expect(h.api.localCallSignature.answer()).toBeDefined();
    expect(current.row.payload.inputValues).toEqual({ input: 8 });
  } finally { h.dispose(); }
});

test("async session replacement and changed source metadata keep old captures unavailable", async () => {
  const h = await ready();
  try {
    const old = signatures(h)[0]; const release = h.replaceSession(); await settle(); release(); await settle();
    expect(old.row.signal.aborted).toBe(true); await h.signature(old.index); expect(h.api.localCallSignature.answer()).toBeUndefined();
    let current = signatures(h).at(-1); expect(current.index).toBeGreaterThan(old.index);
    h.world.changeMetadata(); await h.signature(current.index); expect(h.api.localCallSignature.answer()).toBeUndefined();
    const retry = signatures(h).at(-1); expect(retry.index).toBeGreaterThan(current.index);
    await h.signature(retry.index); expect(h.api.localCallSignature.answer()).toBeDefined();
  } finally { h.dispose(); }
});
