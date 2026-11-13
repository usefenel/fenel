// Run with: bun test --conditions=browser --conditions=development ./src/lib/expression-runner/local-expression-text.test.mjs
import { describe, expect, test } from "bun:test";
import { createRoot, createSignal, flush, onCleanup, untrack, createEffect, createMemo } from "solid-js";
import { createGuidanceLane, draftCheckReaderKey, draftChecksPending, holdDraftCheck, localDraftChecksPending, releaseDraftCheck } from "./live-guidance";
import { reachedSavedSources } from "./expression-evaluation";
import { localWorld } from "./local-save-admission.fixture.mjs";
import { compiled, homeSource, section } from "./local-save-admission.fixture.mjs";

// B4 unit C: each Local text site's production code is extracted unchanged
// (the client module `local-expression-text.ts`, Home's Inspection Code and
// Call address inputs, the recursive editor's code lens) and run against a
// page session whose registry, evaluator, catalogue and environment throw.
// The worker client records each request; tests answer them explicitly. The
// scheduler is the production guidance lane with a controlled frame.
const clientSource = (await Bun.file(new URL("./local-expression-text.ts", import.meta.url)).text()).replaceAll("\r\n", "\n");
const editorSource = (await Bun.file(new URL("./index.tsx", import.meta.url)).text()).replaceAll("\r\n", "\n");
const clientCode = compiled(clientSource.slice(clientSource.indexOf("/** The existing Local refusal sentences")));
const literal = value => ({ kind: "literal", value });
async function settle() { for (let turn = 0; turn < 16; turn++) { await Promise.resolve(); flush(); } }
const deferred = () => { let resolve, reject; const promise = new Promise((yes, no) => { resolve = yes; reject = no; }); return { promise, resolve, reject }; };
const TOOLS = "This reader's editing tools are not ready. Try again after preparation.";
const CHANGED = "This data changed while preparing the edit. Try again with its current contents.";

function world() {
  const pageReads = [], requests = [], frames = [];
  // Reactive like the reader's revision and the worker snapshot it reads.
  const [revision, setRevision] = createSignal(1), [prepared, setPrepared] = createSignal(true);
  let worker = { fixture: "worker" };
  const session = { label: "local-page-session", mode: "detached" };
  for (const key of ["registry", "evaluateContext", "environment", "catalog"]) Object.defineProperty(session, key, { get() {
    pageReads.push(key); throw new Error(`Page ${key} read for a Local reader`);
  } });
  const reader = { kind: "local", revision: () => revision() };
  const capture = (r, s) => r?.kind === "local" && prepared() ? { epoch: 1, facade: s(), concrete: s(), worker, revision: r.revision() } : undefined;
  const current = (c, r, s) => { const now = capture(r, s); return !!now && now.worker === c.worker && now.revision === c.revision; };
  const frame = callback => { frames.push(callback); return () => { const i = frames.indexOf(callback); if (i >= 0) frames.splice(i, 1); }; };
  const imports = { createEffect, createSignal, onCleanup, untrack,
    preparedReaderWorkerForSession: facade => { expect(facade).toBe(session); return prepared() ? { handle: worker } : undefined; },
    runPreparedReaderWorker: (handle, payload, signal) => { const held = deferred(); requests.push({ handle, payload: structuredClone(payload), signal, ...held }); return held.promise; },
    localGuidanceCapture: capture, localGuidanceCurrent: current,
    createGuidanceLane: given => createGuidanceLane(given ?? frame), draftValueFingerprint: JSON.stringify, reachedSavedSources };
  const client = new Function(...Object.keys(imports), `${clientCode}; return { LOCAL_TEXT_TOOLS_PENDING, LOCAL_TEXT_CHANGED,
    readLocalExpressionText, printLocalExpressionText, createLocalExpressionPrint, createLocalExpressionTyping };`)(...Object.values(imports));
  return { client, session, reader, requests, pageReads, frames, capture, current,
    bump: () => { setRevision(value => value + 1); flush(); }, unprepare: () => { setPrepared(false); flush(); },
    reprepare: () => { worker = { fixture: "worker-two" }; setPrepared(true); flush(); },
    runFrame: async () => { for (const callback of frames.splice(0)) callback(); await settle(); },
    answer: async (index, value) => { requests[index].resolve(value); await settle(); } };
}
const ok = node => ({ read: { $tag: "Ok", _0: node } });

describe("the Local text client", () => {
  test("copy matches the existing Local refusals", () => {
    const w = world();
    expect([w.client.LOCAL_TEXT_TOOLS_PENDING, w.client.LOCAL_TEXT_CHANGED]).toEqual([TOOLS, CHANGED]);
  });
  test("a read without a prepared worker refuses with the existing copy, and a moved capture refuses after the reply", async () => {
    const w = world();
    const moved = w.client.readLocalExpressionText(w.reader, () => w.session, "1", []);
    await settle();
    expect(w.requests[0].payload).toEqual({ method: "read-reader-expression-text", text: "1", names: [] });
    w.bump();
    await w.answer(0, ok(literal(1)));
    await expect(moved).rejects.toThrow(CHANGED);
    w.unprepare();
    await expect(w.client.readLocalExpressionText(w.reader, () => w.session, "1", [])).rejects.toThrow(TOOLS);
    expect(w.pageReads).toEqual([]);
  });
  test("typing: twenty edits in one frame send one guidance read; while it runs, twenty more send one; only the latest text applies", async () => {
    const w = world(), applied = [];
    const typing = createRoot(() => w.client.createLocalExpressionTyping(() => w.reader, () => w.session, (text, read) => applied.push([text, read])));
    for (let i = 0; i < 20; i++) typing.type(`${i}`, ["x"]);
    await w.runFrame();
    expect(w.requests.map(r => [r.payload.text, r.payload.priority])).toEqual([["19", "guidance"]]);
    for (let i = 20; i < 40; i++) typing.type(`${i}`, ["x"]);
    await w.runFrame();
    expect(w.requests).toHaveLength(1);
    await w.answer(0, ok(literal(19)));
    expect(applied).toEqual([]);
    expect(w.requests.map(r => r.payload.text)).toEqual(["19", "39"]);
    await w.answer(1, ok(literal(39)));
    expect(applied).toEqual([["39", { $tag: "Ok", _0: literal(39) }]]);
    expect(w.pageReads).toEqual([]);
  });
  test("print: only reached sources travel; a moved capture keeps the last answer for the same request while it asks again", async () => {
    const w = world();
    const [node, setNode] = createSignal({ kind: "ref", savedExprId: "s" });
    const saved = new Map([["s", { kind: "call", fnId: "f", args: [{ kind: "ref", savedExprId: "t" }] }], ["t", literal(2)], ["unused", literal(3)]]);
    const print = createRoot(() => w.client.createLocalExpressionPrint(() => w.reader, () => w.session,
      () => ({ node: node(), lookup: id => saved.get(id), boundNames: ["x"], presentation: "editor" }), { priority: "guidance" }));
    await settle();
    expect(w.requests[0].payload).toEqual({ method: "print-reader-expression-text", node: { kind: "ref", savedExprId: "s" },
      savedExpressions: [["s", saved.get("s")], ["t", literal(2)]], boundNames: ["x"], presentation: "editor", priority: "guidance" });
    expect(print.print()).toBeUndefined();
    await w.answer(0, { printed: { $tag: "Ok", _0: { text: "s", readable: true } } });
    expect(print.print()).toEqual({ $tag: "Ok", _0: { text: "s", readable: true } });
    expect(print.current()).toBe(true);
    // A Local write: asked again, the previous text stays shown meanwhile.
    w.bump();
    await settle();
    expect(w.requests).toHaveLength(2);
    expect(print.print()).toEqual({ $tag: "Ok", _0: { text: "s", readable: true } });
    expect(print.current()).toBe(false);
    await w.answer(1, { printed: { $tag: "Ok", _0: { text: "s", readable: true } } });
    expect(print.current()).toBe(true);
    setNode(literal(5));
    await settle();
    expect(print.print()).toBeUndefined();
    setNode(literal(6));
    await settle();
    expect(w.requests[2].signal.aborted).toBe(true);
    await w.answer(3, { printed: { $tag: "Err", _0: "print failure" } });
    expect(print.print()).toEqual({ $tag: "Err", _0: "print failure" });
    expect(w.pageReads).toEqual([]);
  });
  test("print: hold() defers asking until it clears", async () => {
    const w = world();
    const [held, setHeld] = createSignal(true);
    createRoot(() => w.client.createLocalExpressionPrint(() => w.reader, () => w.session,
      () => ({ node: literal(1), lookup: () => undefined, boundNames: [], presentation: "inspection" }), { priority: "guidance", hold: held }));
    await settle();
    expect(w.requests).toHaveLength(0);
    setHeld(false);
    await settle();
    expect(w.requests.map(r => r.payload.priority)).toEqual(["guidance"]);
  });
});

describe("Home Inspection Code for a Local reader reads in its worker", () => {
  const stateCode = section(homeSource, "function createInspectionExpressionState(", "/** An accepted rendering is a cache of its source;");
  const setup = section(homeSource, "  // B4 unit C: a Local reader prints and reads its Inspection text in its", "  const codeNames = createMemo(");
  const handlers = section(homeSource, "  function changeCode(text: string) {", "  function cancelChanges() {");
  function mount(w) {
    return createRoot(() => {
      const state = new Function("createSignal", "untrack", `${compiled(stateCode)}; return createInspectionExpressionState;`)(createSignal, untrack)();
      const draft = () => state.draft() ?? state.savedDraft() ?? literal(0);
      const prints = [];
      const imports = { localGuidance: { fixture: "guidance" }, reader: w.reader, homeAuthoringSession: () => w.session, createSignal,
        createLocalExpressionPrint: (r, s, request, options) => { prints.push({ request, options }); return { print: () => undefined }; },
        createLocalExpressionTyping: (r, s, onRead) => w.client.createLocalExpressionTyping(r, s, onRead, callback => { w.frames.push(callback); return () => {}; }),
        readLocalExpressionText: w.client.readLocalExpressionText,
        readAuthoringExpressionText: () => { throw new Error("The page parsed a Local reader's text"); },
        props: { readOnly: false, savedExprById: new Map() }, fn: () => undefined, state, draft, cloneDraftValue: structuredClone,
        draftValueFingerprint: JSON.stringify, parameters: () => [{ name: "x" }], source: () => "0", printedSource: () => ({ text: "0", readable: true }),
        LOCAL_SAVE_DRAFT_CHANGED: "The draft changed while it was being checked. Save again." };
      return { state, draft, prints, ...new Function(...Object.keys(imports), `${compiled(setup)}; ${compiled(handlers)};
        return { changeCode, readPendingSource, pending: () => pendingSourceText };`)(...Object.values(imports)) };
    });
  }
  test("prints go at guidance weight and are held while typed text waits for its read", async () => {
    const w = world(), m = mount(w);
    const [{ options }] = m.prints;
    expect(options.priority).toBe("guidance");
    expect(options.hold()).toBe(false);
    m.changeCode("x");
    await settle();
    expect(options.hold()).toBe(true);
    await w.runFrame();
    await w.answer(0, ok({ kind: "param", name: "x" }));
    expect(options.hold()).toBe(false);
  });
  test("typing reads at guidance weight, latest wins; the answer replaces the draft; a parse error shows its message", async () => {
    const w = world(), m = mount(w);
    m.changeCode("x +");
    m.changeCode("x + 1");
    await w.runFrame();
    expect(w.requests.map(r => r.payload)).toEqual([{ method: "read-reader-expression-text", text: "x + 1", names: ["x"], priority: "guidance" }]);
    expect(m.state.sourceText()).toBe("x + 1");
    const node = { kind: "call", fnId: "add", args: [{ kind: "param", name: "x" }, literal(1)] };
    await w.answer(0, ok(node));
    expect(m.draft()).toEqual(node);
    expect(m.pending()).toBeUndefined();
    m.changeCode("x + (");
    await w.runFrame();
    await w.answer(1, { read: { $tag: "Err", _0: "Expected an expression at line 1, column 6" } });
    expect(m.state.sourceError()).toBe("Expected an expression at line 1, column 6");
    expect(m.draft()).toEqual(node);
    expect(w.pageReads).toEqual([]);
  });
  test("Save reads unread typed text first at Save weight, cancelling the guidance read", async () => {
    const w = world(), m = mount(w);
    m.changeCode("2");
    await w.runFrame();
    const saving = m.readPendingSource(new AbortController().signal);
    await settle();
    expect(w.requests[0].signal.aborted).toBe(true);
    expect(w.requests[1].payload).toEqual({ method: "read-reader-expression-text", text: "2", names: ["x"] });
    await w.answer(1, ok(literal(2)));
    expect(await saving).toBe(true);
    expect(m.draft()).toEqual(literal(2));
    // Text typed while Save reads refuses that Save and keeps the draft.
    m.changeCode("3");
    const second = m.readPendingSource(new AbortController().signal);
    await settle();
    m.state.setSourceText("4");
    await w.answer(w.requests.length - 1, ok(literal(3)));
    await expect(second).rejects.toThrow("The draft changed while it was being checked. Save again.");
    expect(m.draft()).toEqual(literal(2));
    expect(w.pageReads).toEqual([]);
  });
  test("an answer under a moved capture is dropped", async () => {
    const w = world(), m = mount(w);
    m.changeCode("7");
    await w.runFrame();
    w.bump();
    await w.answer(0, ok(literal(7)));
    // The admitted draft stays; the text waits for Save or the next edit.
    expect(m.draft()).toEqual(literal(0));
    expect(m.pending()).toBe("7");
  });
});

describe("the recursive editor's code lens applies Local text through the worker", () => {
  const apply = section(editorSource, "  let applying: AbortController | undefined;", "  return (\n    <div class=\"expr-code-lens\">");
  function mount(w, draftText) {
    const changes = [];
    const [draft, setDraft] = createSignal(draftText);
    const [error, setError] = createSignal(null);
    const node = literal(0);
    const scope = { surface: "lens" };
    const imports = { onCleanup, createSignal, readable: () => true, code: () => "0", draft, setError, params: () => [{ name: "x" }], local: true,
      useContext: () => scope, DraftCheckScopeContext: {}, draftCheckReaderKey, holdDraftCheck, releaseDraftCheck,
      reader: w.reader, session: w.session, readLocalExpressionText: w.client.readLocalExpressionText,
      readAuthoringExpressionText: () => { throw new Error("The page parsed a Local reader's text"); },
      props: { get node() { return node; }, onChange: next => changes.push(next) } };
    const api = createRoot(() => new Function(...Object.keys(imports), `${compiled(apply)};
      return { applyDraft, applyPending: typeof applyPending === "undefined" ? undefined : applyPending };`)(...Object.values(imports)));
    return { ...api, changes, error, setDraft, scope };
  }
  test("Apply reads once at Save weight and applies the answer for the same text", async () => {
    const w = world(), m = mount(w, "x");
    m.applyDraft();
    await settle();
    expect(w.requests.map(r => r.payload)).toEqual([{ method: "read-reader-expression-text", text: "x", names: ["x"] }]);
    await w.answer(0, ok({ kind: "param", name: "x" }));
    expect(m.changes).toEqual([{ kind: "param", name: "x" }]);
    expect(w.pageReads).toEqual([]);
  });
  // Nov 12: Ctrl+Enter waited 77 s in the worker's queue and the lens showed nothing meanwhile.
  test("an Apply in flight says so until it settles: an answer, a parse error, a failure, a missing worker", async () => {
    const w = world(), m = mount(w, "x");
    expect(m.applyPending?.()).toBe(false);
    m.applyDraft();
    await settle();
    expect(m.applyPending?.()).toBe(true);
    await w.answer(0, ok({ kind: "param", name: "x" }));
    expect(m.applyPending?.()).toBe(false);
    m.setDraft("y +");
    await settle();
    m.applyDraft();
    await settle();
    expect(m.applyPending?.()).toBe(true);
    await w.answer(1, { read: { $tag: "Err", _0: "Unexpected end of input at 1:4" } });
    expect([m.applyPending?.(), m.error()]).toEqual([false, "Unexpected end of input at 1:4"]);
    m.setDraft("z");
    await settle();
    m.applyDraft();
    await settle();
    w.requests[2].reject(new Error("worker failed"));
    await settle();
    expect([m.applyPending?.(), m.error()]).toEqual([false, "worker failed"]);
    // A newer Apply replaces the one in flight and stays pending for its own read.
    m.setDraft("a");
    await settle();
    m.applyDraft();
    await settle();
    m.setDraft("b");
    await settle();
    m.applyDraft();
    await settle();
    expect(m.applyPending?.()).toBe(true);
    await w.answer(4, ok({ kind: "param", name: "b" }));
    expect(m.applyPending?.()).toBe(false);
    w.unprepare();
    m.setDraft("c");
    await settle();
    m.applyDraft();
    await settle();
    expect([m.applyPending?.(), m.error()]).toEqual([false, TOOLS]);
  });
  test("an Apply in flight holds its surface's Saves: Save refuses with the existing copy until it settles", async () => {
    const w = world(), m = mount(w, "x + 1");
    m.applyDraft();
    await settle();
    expect(draftChecksPending(m.scope)).toBe(true);
    const saveWorld = localWorld({ localDraftChecksPending });
    await expect(saveWorld.localExpressionSaveIssue(literal(0), { reader: saveWorld.reader, session: saveWorld.session,
      saved: new Map(), draftScope: m.scope })).rejects.toThrow("The draft changed while it was being checked. Save again.");
    expect(saveWorld.requests).toHaveLength(0);
    await w.answer(0, ok({ kind: "param", name: "x" }));
    expect(draftChecksPending(m.scope)).toBe(false);
    expect(m.changes).toHaveLength(1);
    // A failed Apply also releases the hold.
    m.setDraft("y");
    m.applyDraft();
    await settle();
    expect(draftChecksPending(m.scope)).toBe(true);
    w.requests[1].reject(new Error("worker failed"));
    await settle();
    expect(draftChecksPending(m.scope)).toBe(false);
  });
  test("an answer for text edited meanwhile is not applied; a parse error and a missing worker show their messages", async () => {
    const w = world(), m = mount(w, "x");
    m.applyDraft();
    await settle();
    m.setDraft("y");
    await w.answer(0, ok({ kind: "param", name: "x" }));
    expect(m.changes).toEqual([]);
    m.applyDraft();
    await settle();
    await w.answer(1, { read: { $tag: "Err", _0: "Unexpected end of input at 1:2" } });
    expect(m.error()).toBe("Unexpected end of input at 1:2");
    w.unprepare();
    m.applyDraft();
    await settle();
    expect(m.error()).toBe(TOOLS);
    expect(w.pageReads).toEqual([]);
  });
});

describe("the code lens keeps unapplied Local text across a re-print", () => {
  const view = section(editorSource, "  const blank = () => props.node.kind === \"literal\" && props.node.value === undefined;", "  let applying: AbortController | undefined;");
  function mount(w) {
    const [node, setNode] = createSignal(literal(1));
    return createRoot(() => {
      const imports = { createMemo, createEffect, createSignal, untrack, local: true, reader: w.reader, session: w.session,
        createLocalExpressionPrint: w.client.createLocalExpressionPrint, draftValueFingerprint: JSON.stringify,
        codeLensTextIsReadable: () => true, printAuthoringExpressionText: () => { throw new Error("The page printed a Local reader's text"); },
        resolver: () => undefined, savedCtx: { byId: id => id === "s" ? { expr: literal(2) } : undefined, list: () => { throw new Error("list() used"); } },
        params: () => [], props: { get node() { return node(); } } };
      const api = new Function(...Object.keys(imports), `${compiled(view)}; return { draft, setDraft, readable, printing, code };`)(...Object.values(imports));
      return { ...api, setNode };
    });
  }
  test("a Local write re-prints without wiping typed text or turning the lens read-only", async () => {
    const w = world(), m = mount(w);
    await settle();
    expect(m.printing()).toBe(true);
    expect(m.readable()).toBe(false);
    await w.answer(0, { printed: { $tag: "Ok", _0: { text: "1", readable: true } } });
    expect(m.draft()).toBe("1");
    m.setDraft("1 + 2");
    w.bump();
    await settle();
    expect(w.requests).toHaveLength(2);
    expect(m.draft()).toBe("1 + 2");
    expect(m.readable()).toBe(true);
    expect(m.printing()).toBe(false);
    await w.answer(1, { printed: { $tag: "Ok", _0: { text: "1", readable: true } } });
    expect(m.draft()).toBe("1 + 2");
    // Another expression (an Apply, a visual edit) replaces the text as before.
    m.setNode({ kind: "ref", savedExprId: "s" });
    await settle();
    expect(w.requests[2].payload.savedExpressions).toEqual([["s", literal(2)]]);
    await w.answer(2, { printed: { $tag: "Ok", _0: { text: "s", readable: true } } });
    expect(m.draft()).toBe("s");
    expect(w.pageReads).toEqual([]);
  });
});

describe("the Call form's Local address inputs decode and encode in the worker", () => {
  const block = section(homeSource, "  /** B4 unit C: a Local reader decodes its address inputs in its worker. */", "\n  createEffect(\n");
  const param = name => ({ name, type: { $ref: "Number" } });
  function mount(w) {
    const published = [];
    const [args, setArgs] = createSignal([]);
    const [issues, setIssues] = createSignal([]);
    const [note, setNote] = createSignal();
    const imports = { onCleanup, untrack, createEffect, createSignal, reader: w.reader, authoringSession: () => w.session,
      localGuidanceCapture: w.capture, localGuidanceCurrent: w.current,
      preparedReaderWorkerForSession: () => ({ handle: "worker" }),
      runPreparedReaderWorker: (handle, payload, signal) => { const held = deferred(); w.requests.push({ handle, payload: structuredClone(payload), signal, ...held }); return held.promise; },
      setArgExprs: setArgs, setAddressIssues: setIssues, emptyExpressionSlot: () => literal(undefined),
      LOCAL_SAVE_TOOLS_PENDING: TOOLS, reachedSavedSources, refResolver: id => id === "saved" ? literal(9) : undefined,
      createGuidanceLane: () => createGuidanceLane(callback => { w.frames.push(callback); return () => {}; }),
      resolvedParams: () => [param("a")],
      props: { onAddressInputsChange: inputs => published.push(inputs) }, setAddressShareNote: setNote };
    const api = createRoot(() => new Function(...Object.keys(imports), `${compiled(block)};
      return { decodeLocalAddressInputs, encodeLocalAddressInputs, addressDecodePending };`)(...Object.values(imports)));
    return { ...api, args, issues, note, published };
  }
  test("decoding sends one request at Save weight; inputs stay unavailable until it answers", async () => {
    const w = world(), m = mount(w);
    m.decodeLocalAddressInputs([{ name: "a", text: "1" }], [param("a")]);
    await settle();
    expect(w.requests.map(r => r.payload)).toEqual([{ method: "decode-reader-address-inputs", inputs: [{ name: "a", text: "1" }], params: [param("a")] }]);
    expect(m.addressDecodePending()).toBe(true);
    // No address is encoded or published from the undecoded state.
    m.encodeLocalAddressInputs([literal(7)]);
    await settle(); await w.runFrame();
    expect(w.requests).toHaveLength(1);
    await w.answer(0, { decoded: { args: [literal(1)], issues: ["b: refused"] } });
    expect(m.args()).toEqual([literal(1)]);
    expect(m.issues()).toEqual(["b: refused"]);
    expect(m.addressDecodePending()).toBe(false);
    expect(m.published).toEqual([]);
    expect(w.pageReads).toEqual([]);
  });
  test("a cold worker, a moved capture and a failed answer keep the inputs and ask again when the worker returns", async () => {
    const w = world(), m = mount(w);
    w.unprepare();
    m.decodeLocalAddressInputs([{ name: "a", text: "1" }], [param("a")]);
    await settle();
    expect(w.requests).toHaveLength(0);
    expect(m.issues()).toEqual([TOOLS]);
    expect(m.addressDecodePending()).toBe(true);
    w.reprepare();
    await settle();
    expect(w.requests).toHaveLength(1);
    w.bump();
    await w.answer(0, { decoded: { args: [literal(1)], issues: [] } });
    expect(m.args()).toEqual([]);
    expect(w.requests).toHaveLength(2);
    w.requests[1].reject(new Error("The authoring worker stopped."));
    await settle();
    expect(m.addressDecodePending()).toBe(true);
    expect(m.issues()).toEqual(["The authoring worker stopped."]);
    w.bump();
    await settle();
    await w.answer(2, { decoded: { args: [literal(1)], issues: [] } });
    expect(m.args()).toEqual([literal(1)]);
    expect(m.addressDecodePending()).toBe(false);
  });
  test("re-encoding is guidance weight, latest wins, carries only reached sources, and a failure publishes nothing", async () => {
    const w = world(), m = mount(w);
    for (let i = 0; i < 10; i++) m.encodeLocalAddressInputs([literal(i)]);
    await settle(); await w.runFrame();
    expect(w.requests.map(r => [r.payload.method, r.payload.args, r.payload.priority])).toEqual([["encode-reader-address-inputs", [literal(9)], "guidance"]]);
    expect(w.requests[0].payload.savedExpressions).toEqual([]);
    for (let i = 10; i < 20; i++) m.encodeLocalAddressInputs([literal(i)]);
    m.encodeLocalAddressInputs([{ kind: "ref", savedExprId: "saved" }]);
    await settle(); await w.runFrame();
    await w.answer(0, { encoded: { $tag: "Ok", _0: { inputs: [{ name: "a", text: "9" }], omittedExpressions: false } } });
    expect(m.published).toEqual([]);
    expect(w.requests).toHaveLength(2);
    expect(w.requests[1].payload.savedExpressions).toEqual([["saved", literal(9)]]);
    // A transient worker failure: the address stays, the edit is asked again.
    w.requests[1].reject(new Error("The authoring worker stopped."));
    await settle();
    expect(m.published).toEqual([]);
    w.bump();
    await settle(); await w.runFrame();
    expect(w.requests).toHaveLength(3);
    await w.answer(2, { encoded: { $tag: "Ok", _0: { inputs: [{ name: "a", text: "saved" }], omittedExpressions: true } } });
    expect(m.published).toEqual([[{ name: "a", text: "saved" }]]);
    expect(m.note()).toContain("an address cannot preserve them");
    expect(w.pageReads).toEqual([]);
  });
});
