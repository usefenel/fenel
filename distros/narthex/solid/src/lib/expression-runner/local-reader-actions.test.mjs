// Run with: bun test --conditions=browser --conditions=development ./src/lib/expression-runner/local-reader-actions.test.mjs
import { describe, expect, test } from "bun:test";
import { createRoot, createSignal, createMemo, createEffect, flush, latest, refresh, onCleanup, untrack } from "solid-js";
import { reachedSavedSources } from "./expression-evaluation";
import { compiled, section } from "./local-save-admission.fixture.mjs";

// B4 wave 3 lane A (census unit D and item 2): Home's actions and the function
// editors' lowering for a Local reader run in its worker. The production client
// module (`local-reader-actions.ts`) and Home's sections are extracted
// unchanged and run against a page session whose registry, evaluator,
// environment and catalogue THROW (each read is recorded). The worker records
// each request; tests answer them explicitly. `B4ACT_HOME` points the Home
// sections at another copy of home.tsx (the fail-first runs use the base).
const homePath = process.env.B4ACT_HOME ? `file:///${process.env.B4ACT_HOME.replaceAll("\\", "/")}` : new URL("../../routes/app/home.tsx", import.meta.url);
const homeSource = (await Bun.file(new URL(homePath)).text()).replaceAll("\r\n", "\n");
const clientSource = (await Bun.file(new URL("./local-reader-actions.ts", import.meta.url)).text()).replaceAll("\r\n", "\n");
const clientCode = compiled(clientSource.slice(clientSource.indexOf("/** The existing Local refusal sentences")));
const TOOLS = "This reader's editing tools are not ready. Try again after preparation.";
const CHANGED = "This data changed while preparing the edit. Try again with its current contents.";
const literal = value => ({ kind: "literal", value });
async function settle() { for (let turn = 0; turn < 24; turn++) { await Promise.resolve(); flush(); } }
const deferred = () => { let resolve, reject; const promise = new Promise((yes, no) => { resolve = yes; reject = no; }); return { promise, resolve, reject }; };

function world() {
  const pageReads = [], requests = [];
  const [revision, setRevision] = createSignal(1), [prepared, setPrepared] = createSignal(true);
  let worker = { fixture: "worker" };
  const poisoned = label => {
    const session = { label, mode: "detached" };
    for (const key of ["registry", "evaluateContext", "environment", "catalog"]) Object.defineProperty(session, key, { get() {
      pageReads.push(`${label}.${key}`); throw new Error(`Page ${key} read for a Local reader`);
    } });
    return session;
  };
  const session = poisoned("local-page-session");
  const reader = { kind: "local", revision: () => revision(), session: () => session, epoch: 1 };
  const capture = (r, s) => r?.kind === "local" && prepared() ? { epoch: 1, facade: s(), concrete: s(), worker, revision: r.revision() } : undefined;
  const same = (a, b) => a.worker === b.worker && a.revision === b.revision && a.concrete === b.concrete;
  const current = (c, r, s) => { const now = untrack(() => capture(r, s)); return !!now && same(now, c); };
  const record = transport => (target, payload, signal) => {
    const held = deferred();
    requests.push({ transport, target, payload: structuredClone(payload), signal, ...held });
    return held.promise;
  };
  const imports = { createEffect, createSignal, onCleanup, untrack,
    preparedReaderWorkerForSession: facade => prepared() ? { handle: worker, facade } : undefined,
    runPreparedReaderWorker: record("prepared"), runAuthoringWorker: record("context"),
    localGuidanceCapture: capture, localGuidanceCurrent: current, sameLocalGuidanceCapture: same,
    draftValueFingerprint: JSON.stringify, reachedSavedSources };
  const client = new Function(...Object.keys(imports), `${clientCode}; return { LOCAL_ACTION_TOOLS_PENDING, LOCAL_ACTION_CHANGED,
    runLocalReaderAction, readActionResult, readActionField, createLocalReaderAnswer, openLocalLiveGuidance, loweredLogic, raisedNode };`)(...Object.values(imports));
  return { client, session, poisoned, reader, requests, pageReads, capture, current,
    bump: () => { setRevision(value => value + 1); flush(); }, unprepare: () => { setPrepared(false); flush(); },
    reprepare: () => { setPrepared(true); flush(); },
    replaceWorker: () => { worker = { fixture: "worker-two" }; setRevision(value => value); flush(); },
    answer: async (index, value) => { requests[index].resolve(value); await settle(); },
    fail: async (index, error) => { requests[index].reject(error); await settle(); } };
}

describe("the Local reader action client", () => {
  test("copy matches the existing Local refusals", () => {
    const w = world();
    expect([w.client.LOCAL_ACTION_TOOLS_PENDING, w.client.LOCAL_ACTION_CHANGED]).toEqual([TOOLS, CHANGED]);
  });
  test("an action without a prepared worker refuses; a moved capture refuses after the reply; a malformed reply refuses", async () => {
    const w = world();
    const read = w.client.readActionResult("linkedDemo", Array.isArray);
    const moved = w.client.runLocalReaderAction(w.reader, () => w.session, { method: "plan-reader-linked-demo", kind: "numbers" }, read);
    await settle();
    expect(w.requests[0].payload).toEqual({ method: "plan-reader-linked-demo", kind: "numbers" });
    expect(w.requests[0].transport).toBe("prepared");
    w.bump();
    await w.answer(0, { linkedDemo: { $tag: "Ok", _0: [] } });
    await expect(moved).rejects.toThrow(CHANGED);
    const malformed = w.client.runLocalReaderAction(w.reader, () => w.session, { method: "plan-reader-linked-demo", kind: "numbers" }, read);
    await settle();
    await w.answer(1, { linkedDemo: { $tag: "Ok", _0: "not commands" } });
    await expect(malformed).rejects.toThrow("The authoring worker response could not be read.");
    w.unprepare();
    await expect(w.client.runLocalReaderAction(w.reader, () => w.session, { method: "plan-reader-linked-demo", kind: "numbers" }, read))
      .rejects.toThrow(TOOLS);
    expect(w.pageReads).toEqual([]);
  });
  test("`via` sends through that exact session's worker context (structured clone)", async () => {
    const w = world();
    const target = { label: "function-frame" };
    const job = w.client.runLocalReaderAction(w.reader, () => w.session, { method: "raise-reader-logic", logic: { var: "x" }, params: ["x"] },
      w.client.raisedNode, { via: target });
    await settle();
    expect(w.requests[0].transport).toBe("context");
    expect(w.requests[0].target).toBe(target);
    await w.answer(0, { raised: { $tag: "Ok", _0: { kind: "param", name: "x" } } });
    expect(await job).toEqual({ kind: "param", name: "x" });
    const refused = w.client.runLocalReaderAction(w.reader, () => w.session, { method: "raise-reader-logic", logic: {}, params: [] },
      w.client.raisedNode, { via: "reader" });
    await settle();
    expect(w.requests[1].target).toBe(w.session);
    await w.answer(1, { raised: { $tag: "Err", _0: "codec refusal" } });
    await expect(refused).rejects.toThrow("codec refusal");
  });
  test("a display answer: latest request wins, nothing is shown while asked, a moved capture asks again", async () => {
    const w = world();
    const [node, setNode] = createSignal(literal(1));
    const answer = createRoot(() => w.client.createLocalReaderAnswer(() => w.reader, () => w.session,
      () => ({ method: "lower-reader-expression", node: node(), savedExpressions: [], priority: "guidance" }),
      w.client.readActionResult("lowered")));
    await settle();
    expect(w.requests.map(r => r.payload.priority)).toEqual(["guidance"]);
    expect(answer.answer()).toBeUndefined();
    setNode(literal(2));
    await settle();
    expect(w.requests[0].signal.aborted).toBe(true);
    await w.answer(0, { lowered: { $tag: "Ok", _0: { logic: 1, emptySlot: false } } });
    expect(answer.answer()).toBeUndefined();
    await w.answer(1, { lowered: { $tag: "Ok", _0: { logic: 2, emptySlot: false } } });
    expect(answer.answer()).toEqual({ $tag: "Ok", _0: { logic: 2, emptySlot: false } });
    w.bump();
    await settle();
    expect(answer.answer()).toBeUndefined();
    expect(w.requests).toHaveLength(3);
    await w.answer(2, { lowered: { $tag: "Ok", _0: { logic: 2, emptySlot: false } } });
    expect(answer.answer()?.$tag).toBe("Ok");
    expect(w.pageReads).toEqual([]);
  });
  test("a display read's failure settles with its message, is not re-asked by itself, and Retry asks again; no worker sends nothing until one is prepared", async () => {
    const w = world();
    w.unprepare();
    const answer = createRoot(() => w.client.createLocalReaderAnswer(() => w.reader, () => w.session,
      () => ({ method: "raise-reader-logic", logic: 1, params: [] }), w.client.readActionResult("raised")));
    await settle();
    expect(w.requests).toHaveLength(0);
    expect(answer.failure()).toBeUndefined();
    w.reprepare();
    await settle();
    expect(w.requests).toHaveLength(1);
    await w.answer(0, { raised: "malformed" });
    expect(answer.answer()).toBeUndefined();
    expect(answer.failure()).toBe("The authoring worker response could not be read.");
    await settle();
    expect(w.requests).toHaveLength(1);
    answer.retry();
    await settle();
    expect(w.requests).toHaveLength(2);
    expect(answer.failure()).toBeUndefined();
    await w.answer(1, { raised: { $tag: "Ok", _0: literal(1) } });
    expect(answer.answer()).toEqual({ $tag: "Ok", _0: literal(1) });
  });
  test("open-time completeness lowers in the worker with the reached sources; it opens guidance once, and an edit stops it", async () => {
    const w = world();
    const saved = new Map([["s", literal(3)], ["unused", literal(4)]]);
    const [draft, setDraft] = createSignal(literal(undefined));
    let touches = 0;
    const guidance = { touched: false, touch() { touches++; this.touched = true; } };
    createRoot(() => w.client.openLocalLiveGuidance(guidance, () => w.reader, () => w.session, draft, id => saved.get(id)));
    await settle();
    expect(w.requests).toHaveLength(0);
    setDraft({ kind: "call", fnId: "f", args: [{ kind: "ref", savedExprId: "s" }] });
    await settle();
    expect(w.requests[0].payload).toEqual({ method: "lower-reader-expression", node: { kind: "call", fnId: "f", args: [{ kind: "ref", savedExprId: "s" }] },
      savedExpressions: [["s", literal(3)]], priority: "guidance" });
    await w.answer(0, { lowered: { $tag: "Ok", _0: { logic: {}, emptySlot: true } } });
    expect(touches).toBe(0);
    setDraft(literal(5));
    await settle();
    await w.answer(1, { lowered: { $tag: "Ok", _0: { logic: 5, emptySlot: false } } });
    expect(touches).toBe(1);
    // Opened: later drafts (typing) send no lowering.
    setDraft(literal(6));
    await settle();
    expect(w.requests).toHaveLength(2);
    expect(w.pageReads).toEqual([]);
  });
  test("a surface touched by an edit before it is complete stops asking", async () => {
    const w = world();
    const [draft, setDraft] = createSignal(literal(1));
    const guidance = { touched: false, touch() { this.touched = true; } };
    createRoot(() => w.client.openLocalLiveGuidance(guidance, () => w.reader, () => w.session, draft, () => undefined));
    await settle();
    expect(w.requests).toHaveLength(1);
    guidance.touched = true;
    setDraft(literal(2));
    await settle();
    expect(w.requests).toHaveLength(1);
    expect(w.requests[0].signal.aborted).toBe(true);
  });
});

/** Run a Home section with `deps`; `names` are returned. */
function run(code, deps, names) {
  return new Function(...Object.keys(deps), `${compiled(code)}; return { ${names.join(", ")} };`)(...Object.values(deps));
}
const pageOwner = (w, label) => (...args) => {
  // A page owner reads its session's registry (as each real owner does).
  for (const value of args) if (value && typeof value === "object" && "label" in value) void value.registry;
  throw new Error(`${label} ran on the page`);
};

describe("Home's Local starters are planned in the reader's worker", () => {
  const code = section(homeSource, "  async function createLinkedDemo(", "  function itemDemoCopy(")
    .replace('await import("~/lib/local-locus-data")', "await importLocalData()");
  function mount(w) {
    const errors = [], transactions = [], navigation = [];
    const [adding, setAdding] = createSignal(false);
    const source = { id: "local", transact: async (commands, revision) => { transactions.push({ commands, revision }); return { id: "local", revision: 2 }; } };
    const deps = { reader: w.reader, linkedDemoAdding: adding, setLinkedDemoAdding: setAdding, setPicking: () => {},
      client: { rootId: "local", signal: new AbortController().signal }, importLocalData: async () => ({ localTabDataSource: () => source }),
      assertCurrentSession: () => {}, sessionEpoch: () => 1, acknowledgeRootRevision: () => {}, revalidate: () => {},
      navigateScope: next => navigation.push(next), ROOT_SCOPE: { kind: "root" }, setToolbarError: message => errors.push(message),
      runLocalReaderAction: w.client.runLocalReaderAction, readActionResult: w.client.readActionResult,
      // The base planner's page owners (absent from the moved code).
      expectedTypeForName: (_name, environment) => environment, invokeCallable: pageOwner(w, "invokeCallable"),
      Ref: id => ({ $ref: id }), List: type => type, placedListType: type => type, functionRefHandle: () => undefined, crypto };
    return { ...run(code, deps, ["createLinkedDemo"]), errors, transactions, navigation };
  }
  test("the worker plans; the page transacts its commands at the authored revision", async () => {
    const w = world(), m = mount(w);
    const done = m.createLinkedDemo("recipe");
    await settle();
    expect(w.requests.map(r => r.payload)).toEqual([{ method: "plan-reader-linked-demo", kind: "recipe" }]);
    const commands = [{ $tag: "AppendItem", item: { id: "a", source: { kind: "expr", expr: literal(1) } } }];
    await w.answer(0, { linkedDemo: { $tag: "Ok", _0: commands } });
    await done;
    expect(m.transactions).toEqual([{ commands, revision: 1 }]);
    expect(m.navigation).toEqual([{ kind: "root" }]);
    expect(m.errors).toEqual([]);
    expect(w.pageReads).toEqual([]);
  });
  test("a refusal shows the planner's copy, a moved capture the existing copy, a missing worker the tools copy; nothing is written", async () => {
    const w = world(), m = mount(w);
    let done = m.createLinkedDemo("showcase");
    await settle();
    await w.answer(0, { linkedDemo: { $tag: "Err", _0: "The people and projects example's checked types or source identity are unavailable." } });
    await done;
    done = m.createLinkedDemo("numbers");
    await settle();
    w.bump();
    await w.answer(1, { linkedDemo: { $tag: "Ok", _0: [] } });
    await done;
    w.unprepare();
    await m.createLinkedDemo("numbers");
    expect(m.errors).toEqual(["The people and projects example's checked types or source identity are unavailable.", CHANGED, TOOLS]);
    expect(m.transactions).toEqual([]);
    expect(w.pageReads).toEqual([]);
  });
});

describe("Home's lens shortcuts run in a Local reader's worker", () => {
  const held = section(homeSource, "  const heldSubjectAdmission = createMemo(() => {", "  const heldLensSubject = createMemo<");
  const flow = section(homeSource, "  const [shortcutDraft, setShortcutDraft] = createSignal<", "  function enterScopeFor(");
  const subject = { $tag: "LensTypedSubject", dataType: { $ref: "Number" }, data: 4, originSource: { $tag: "ThisTabSource" },
    originFocus: { $tag: "RootFocus" }, producer: { $tag: "Nothing" }, producerInput: { $tag: "Nothing" }, producerBinding: { $tag: "Nothing" } };
  const recipe = { $tag: "LensFunctionRecipe", inputType: { $ref: "String" }, argumentsType: { $ref: "Args" }, resultType: { $ref: "String" },
    callableType: { $ref: "Fn" }, callable: { $ref: "reverse" }, arguments: { count: 1 } };
  const shortcut = { $tag: "LensShortcut", id: "reverse", label: "Reverse", icon: "x", operation: { $tag: "InvokeLensRecipe", recipe },
    disposition: { $tag: "PresentExistingData" }, presentation: { $tag: "Nothing" } };
  test("the held subject's admission is the worker's verdict; pending is no admission", async () => {
    const w = world();
    const [answer, setAnswer] = createSignal();
    const deps = { createMemo, props: { pane: { subject: () => subject, source: () => ({ $tag: "ThisTabSource" }) } },
      localHeldSubject: { answer }, checkLensTypedSubject: pageOwner(w, "checkLensTypedSubject"), homeAuthoringSession: () => w.session,
      scopeToWorkspace: () => ({ $tag: "RootFocus" }), scope: () => ({ kind: "root" }) };
    const m = createRoot(() => run(held, deps, ["heldSubjectAdmission"]));
    expect(m.heldSubjectAdmission()).toBeUndefined();
    setAnswer({ admission: { ok: false, issue: "The lens data belongs to another source or focus." } });
    flush();
    expect(m.heldSubjectAdmission()).toEqual({ ok: false, issue: "The lens data belongs to another source or focus." });
    expect(w.pageReads).toEqual([]);
  });
  function mount(w) {
    const subjects = [], modes = [], toolbar = [], presentations = [];
    const [lensMode, setLensMode] = createSignal("data");
    const pane = { source: () => ({ $tag: "ThisTabSource" }), subject: () => undefined, onSubjectData: (s, p) => subjects.push([s, p]),
      onPresentation: kind => presentations.push(kind), shortcutRequest: () => undefined, onShortcutHandled: () => {} };
    const deps = { createSignal, createMemo, createEffect, untrack, props: { pane },
      localLensReader: w.reader, reader: w.reader, homeAuthoringSession: () => w.session, client: { signal: new AbortController().signal },
      runLocalReaderAction: w.client.runLocalReaderAction, readActionField: w.client.readActionField,
      localGuidanceCapture: w.capture, LOCAL_ACTION_CHANGED: CHANGED,
      scope: () => ({ kind: "root" }), scopeKey: () => "root", workspaceSourceKey: () => "tab", sessionEpoch: () => 1,
      scopeToWorkspace: () => ({ $tag: "RootFocus" }), root: () => ({ id: "root", canEdit: false, expressions: {} }),
      lensExpressionSubject: () => ({ item: { id: "$self", source: { kind: "expr", expr: literal("abc") } } }),
      heldLensSubject: () => undefined, valueScope: () => ({ ok: true, container: "abc", containerType: { $ref: "String" },
        sourceExpression: literal("abc") }), focusedExpressionState: () => ({ savedValue: () => undefined, savedDraft: () => undefined }),
      focusedType: () => ({ $ref: "String" }), projectAuthoredExpression: node => ({ source: node, sourcePath: [] }), expressionEditOptions: () => ({}),
      peelMaybeValue: value => value?.$tag === "Just" ? value._0 : undefined, layoutFromWorkspaceCode: code => code === "value" ? "value" : undefined,
      locusLayoutOptions: () => [{ value: "value" }], layoutOptions: () => [{ value: "value" }],
      setLensMode, lensMode, toggleDataInspectionPanel: (_mode, next) => next, setToolbarError: message => toolbar.push(message),
      evaluateLocusCard: async node => ({ result: `evaluated:${JSON.stringify(node)}`, trace: [] }), savedExprById: () => new Map(),
      // The page owners a Local reader must not reach.
      prepareLensShortcut: pageOwner(w, "prepareLensShortcut"), admitLensShortcutResult: pageOwner(w, "admitLensShortcutResult"),
      lensTypedSubjectInput: pageOwner(w, "lensTypedSubjectInput"), lensRecipeArgumentType: pageOwner(w, "lensRecipeArgumentType"),
      invokeCallable: pageOwner(w, "invokeCallable"), entitySchemaFields: pageOwner(w, "entitySchemaFields"),
      homeData: {}, genId: () => "new", changeRoot: async () => {}, navigateScope: () => {}, readLocusCardResult: () => undefined, resolveExpr: () => undefined };
    const api = createRoot(() => run(flow, deps, ["shortcutDraft", "setShortcutDraft", "shortcutIssue", "runLensShortcut", "shortcutArgumentsField",
      "typeof queueLocalShortcutEdit === 'undefined' ? undefined : queueLocalShortcutEdit",
      "typeof localShortcutEditing === 'undefined' ? undefined : localShortcutEditing",
      "typeof localShownArguments === 'undefined' ? undefined : localShownArguments",
      "typeof openLocalLensShortcut === 'undefined' ? undefined : openLocalLensShortcut",
      "typeof drainLocalShortcutEdits === 'undefined' ? undefined : drainLocalShortcutEdits"]
      .map(name => name.startsWith("typeof") ? `${name.split(" ")[1]}: ${name}` : name)));
    return { ...api, subjects, modes, toolbar, presentations, lensMode };
  }
  const input = { value: "abc", type: { $ref: "String" }, expression: literal("abc"), source: { $tag: "ThisTabSource" }, focus: { $tag: "RootFocus" } };
  const edited = (s, extra = {}) => ({ edited: { $tag: "Ok", _0: { shortcut: s, argumentType: { $ref: "Args" },
    fields: { arguments: { name: "arguments", type: { $ref: "Args" } }, disposition: { name: "disposition", type: { $ref: "D" } } }, ...extra } } });
  test("Run prepares, admits and presents in the worker under one capture; the evaluated plan is the worker's", async () => {
    const w = world(), m = mount(w);
    m.setShortcutDraft({ shortcut, input, epoch: 1, origin: "root", source: "tab" });
    flush();
    const running = m.runLensShortcut();
    await settle();
    expect(w.requests.map(r => [r.payload.method, r.payload.step])).toEqual([["run-reader-lens-shortcut", "prepare"]]);
    expect(w.requests[0].payload.input).toEqual(input);
    const plan = { kind: "recipe", shortcut, node: literal("plan"), resultType: { $ref: "String" }, resultScheme: { quantified: [], body: { $ref: "String" } },
      input, producer: { $tag: "ELit" }, producerInput: "input" };
    await w.answer(0, { prepared: { ok: true, plan } });
    expect(w.requests[1].payload).toEqual({ method: "run-reader-lens-shortcut", step: "admit", plan, value: `evaluated:${JSON.stringify(literal("plan"))}`,
      source: { $tag: "ThisTabSource" } });
    const admitted = { ok: true, subject: { ...subject, data: "cba", dataType: { $ref: "String" } } };
    await w.answer(1, { admitted });
    await running;
    expect(m.subjects).toEqual([[admitted.subject, undefined]]);
    expect(m.shortcutDraft()).toBeUndefined();
    expect(w.pageReads).toEqual([]);
  });
  test("a capture that moved while the result was admitted refuses with the shortcut's existing copy", async () => {
    const w = world(), m = mount(w);
    m.setShortcutDraft({ shortcut, input, epoch: 1, origin: "root", source: "tab" });
    flush();
    const running = m.runLensShortcut();
    await settle();
    await w.answer(0, { prepared: { ok: true, plan: { kind: "recipe", shortcut, node: literal("plan"), resultType: {}, resultScheme: {}, input,
      producer: {}, producerInput: "input" } } });
    w.bump();
    await w.answer(1, { admitted: { ok: true, subject } });
    await running;
    expect(m.shortcutIssue()).toBe("The reader changed while running this shortcut. Try again.");
    expect(m.subjects).toEqual([]);
    expect(w.pageReads).toEqual([]);
  });
  test("argument edits show at once, wait while one is answered, and the latest is sent next; Run waits; a refused edit stays queued", async () => {
    const w = world(), m = mount(w);
    expect(typeof m.queueLocalShortcutEdit).toBe("function");
    m.setShortcutDraft({ shortcut, input, epoch: 1, origin: "root", source: "tab" });
    flush();
    void m.drainLocalShortcutEdits();
    await settle();
    // Open: the fields and the argument type of this exact shortcut.
    expect(w.requests.map(r => r.payload)).toEqual([{ method: "run-reader-lens-shortcut", step: "edit", shortcut }]);
    expect(m.shortcutArgumentsField()).toBeUndefined();
    await w.answer(0, edited(shortcut));
    expect(m.shortcutArgumentsField()).toEqual({ name: "arguments", type: { $ref: "Args" } });
    const withCount = count => ({ ...shortcut, operation: { $tag: "InvokeLensRecipe", recipe: { ...recipe, arguments: { count } } } });
    m.queueLocalShortcutEdit({ arguments: { value: { count: 2 } } });
    m.queueLocalShortcutEdit({ arguments: { value: { count: 3 } } });
    m.queueLocalShortcutEdit({ disposition: { $tag: "CreateDerivedData" } });
    m.queueLocalShortcutEdit({ arguments: { value: { count: 4 } } });
    await settle();
    expect(m.localShownArguments()).toEqual({ value: { count: 4 } });
    expect(m.localShortcutEditing()).toBe(true);
    expect(w.requests.slice(1).map(r => r.payload)).toEqual([{ method: "run-reader-lens-shortcut", step: "edit", shortcut, arguments: { value: { count: 2 } } }]);
    await m.runLensShortcut();
    expect(m.shortcutIssue()).toBe("The shortcut's arguments are still being applied. Run again.");
    await w.answer(1, edited(withCount(2)));
    expect(w.requests[2].payload).toEqual({ method: "run-reader-lens-shortcut", step: "edit", shortcut: withCount(2),
      arguments: { value: { count: 4 } }, disposition: { $tag: "CreateDerivedData" } });
    await w.answer(2, { edited: { $tag: "Err", _0: "The shortcut's arguments could not be checked." } });
    expect(m.shortcutIssue()).toBe("The shortcut's arguments could not be checked.");
    expect(m.localShortcutEditing()).toBe(true);
    expect(m.localShownArguments()).toEqual({ value: { count: 4 } });
    // The next edit sends the refused one again with it.
    m.queueLocalShortcutEdit({ arguments: { value: { count: 5 } } });
    await settle();
    expect(w.requests[3].payload).toEqual({ method: "run-reader-lens-shortcut", step: "edit", shortcut: withCount(2),
      arguments: { value: { count: 5 } }, disposition: { $tag: "CreateDerivedData" } });
    const final = { ...withCount(5), disposition: { $tag: "CreateDerivedData" } };
    await w.answer(3, edited(final));
    expect(m.shortcutDraft().shortcut).toEqual(final);
    expect(m.localShortcutEditing()).toBe(false);
    expect(m.localShownArguments()).toBeUndefined();
    expect(w.pageReads).toEqual([]);
  });
  test("a PresentLensSubject shortcut is planned and its presentation coded in the worker", async () => {
    const w = world(), m = mount(w);
    const present = { ...shortcut, operation: { $tag: "PresentLensSubject", subject: { $tag: "CurrentDataSubject" } },
      presentation: { $tag: "Just", _0: { $tag: "ValuePresentation" } } };
    const opened = m.openLocalLensShortcut(present);
    await settle();
    expect(w.requests[0].payload.step).toBe("prepare");
    await w.answer(0, { prepared: { ok: true, plan: { kind: "subject", subject: { $tag: "CurrentDataSubject" }, presentation: present.presentation } } });
    expect(w.requests[1].payload).toEqual({ method: "run-reader-lens-shortcut", step: "presentation-code", presentation: { $tag: "ValuePresentation" } });
    await w.answer(1, { presentationCode: { $tag: "Ok", _0: "value" } });
    await opened;
    expect(m.presentations).toEqual(["value"]);
    expect(m.lensMode()).toBe("data");
    expect(w.pageReads).toEqual([]);
  });
});

describe("Home's Local copy writes the clipboard inside the menu's gesture", () => {
  const prefetch = section(homeSource, "  const [copyPrefetchMenu, setCopyPrefetchMenu] = createSignal<MenuTarget>();", "  function vagueType(");
  const copy = section(homeSource, "  async function copyFromMenu(", "  async function pasteFromMenu(");
  function mount(w, rendered) {
    const copied = [], notices = [], errors = [];
    const item = { id: "a", caption: "Total", valueType: { $ref: "Number" } };
    const [contextMenu, setContextMenu] = createSignal();
    const deps = { createSignal, createEffect, createLocalReaderAnswer: w.client.createLocalReaderAnswer, readActionResult: w.client.readActionResult,
      contextMenu, reader: w.reader, props: {}, transferSession: () => w.session, cloneDraftValue: structuredClone, classifyData: () => "Number",
      homeData: { evaluated: () => rendered, type: candidate => candidate.valueType },
      menuIsCurrent: () => true, setCutMark: () => {}, resolveExpr: () => literal(41), savedExprById: () => new Map(),
      copyTransferItem: prepared => { copied.push(prepared); return Promise.resolve("Copied 1 value."); },
      setImportNotice: notice => notices.push(notice), setToolbarError: message => errors.push(message),
      evaluateAuthoringExpression: pageOwner(w, "evaluateAuthoringExpression"), prepareTransferItem: pageOwner(w, "prepareTransferItem") };
    const api = createRoot(() => run(`${prefetch}${copy}`, deps, ["copyFromMenu"]));
    return { ...api, item, copied, notices, errors, open: menu => { setContextMenu(menu); flush(); } };
  }
  test("the item is prepared at guidance weight when the menu opens; Copy writes it synchronously", async () => {
    const w = world(), m = mount(w, { value: 42 });
    const menu = { item: { id: "a", caption: "Total", valueType: { $ref: "Number" } } };
    m.open(menu);
    await settle();
    expect(w.requests.map(r => [r.transport, r.payload])).toEqual([["context", { method: "prepare-reader-transfer-item", priority: "guidance",
      item: { value: 42, type: { $ref: "Number" }, typeName: "Number", label: "Total", source: "fenel" } }]]);
    const prepared = { value: 42, typeName: "Number", source: "fenel", typeIdentities: [{ path: "", reference: "Number", identity: "n" }] };
    await w.answer(0, { transferItem: { $tag: "Ok", _0: prepared } });
    const done = m.copyFromMenu(menu);
    // No await happened before the clipboard write.
    expect(m.copied).toEqual([prepared]);
    expect(await done).toBe(true);
    expect(m.notices).toEqual(["Copied 1 value."]);
    expect(w.pageReads).toEqual([]);
  });
  test("Copy while the item is still being prepared refuses with the existing copy and writes nothing", async () => {
    const w = world(), m = mount(w, { value: 42 });
    const menu = { item: { id: "a", caption: "Total" } };
    m.open(menu);
    await settle();
    expect(await m.copyFromMenu(menu)).toBe(false);
    expect(m.errors).toEqual(["This data changed. Copy again when its display is ready."]);
    expect(m.copied).toEqual([]);
    expect(w.pageReads).toEqual([]);
  });
});

describe("the function editors lower and raise a Local body in the worker", () => {
  const splitCode = section(homeSource, "function splitLoweredFunctionDraft(", "/** Every live value belongs");
  const split = run(splitCode, {}, ["splitLoweredFunctionDraft"]).splitLoweredFunctionDraft;
  const raise = section(homeSource, "  const functionBodyExpr = createMemo<ExprNode | null>(() => {", "  const [bodyDraft, setBodyDraft]");
  const job = section(homeSource, "  const localFunctionPreviewJob = createMemo<", "  function assertLocalFunctionPreview(");
  const steps = section(homeSource, "  // B4 unit D item 2: a Local reader's Steps view lowers the body in its", "  const composerSession = reactiveAuthoringSession(");
  const authored = section(homeSource, "  const authoredDraft = createMemo(", "  // The outer record");
  const retryTools = section(homeSource, "  async function retryFunctionTools(", "  async function save()");
  const creator = section(homeSource, "function NewFunctionModal(", "/** Insert `child`");
  const creatorNames = section(creator, "  const fnName =", "  const setFnName =");
  const creatorParams = section(creator, "  const paramFields =", "  let approvedParameterFields:");
  const creatorDeclaration = section(creator, "  const declaration =", "  function guardParameterFields(");
  // The frozen fail-first source still keeps this exact object inside its
  // session memo. Extract that original memo verbatim too, without introducing
  // a fixture naming/equality policy that could hide its dependency defect.
  const creatorDefinition = creator.includes("  const newFunctionDefinition =")
    ? section(creator, "  const newFunctionDefinition =", "  const newFunctionAuthoringSession =") : "";
  const creatorSession = section(creator, "  const newFunctionAuthoringSession =", "  // B4 unit D item 2:");
  const representationString = section(homeSource, "function repString(", "function isBlankRepresentationValue(");
  function mountSteps(w, options = {}) {
    const frame = w.poisoned("new-function-frame"), bodies = [], restorations = [], definitionSelections = [];
    const [body, setBody] = createSignal({ kind: "call", fnId: "add", args: [{ kind: "param", name: "x" }, literal(1)] });
    w.reader.retryPresentation = () => {
      const held = deferred(); restorations.push(held);
      if (!options.holdRestoration) held.resolve(true);
      return held.promise;
    };
    const [paramsType, setParamsType] = createSignal({ $record: { fields: [] } });
    const [returnsType, setReturnsType] = createSignal({ $ref: "String" });
    const [requires, setRequires] = createSignal();
    const [reps, setReps] = createSignal({ Codeable: { codeName: "original" } }), [authoredFacetRevision, setFacetRevision] = createSignal(0);
    const [stepsIssue, setStepsIssue] = createSignal();
    const [resurrectFieldIds, setResurrectFieldIds] = createSignal([]);
    const metadata = { quantified: [] };
    w.reader.draftSession = definition => { definitionSelections.push(definition); return options.noFrame ? undefined : frame; };
    const localFunctionPreviewJob = createMemo(() => ({ fixture: "checked preview" }));
    const deps = { createSignal, createMemo, createEffect, createLocalReaderAnswer: w.client.createLocalReaderAnswer, readActionResult: w.client.readActionResult,
      runLocalReaderAction: w.client.runLocalReaderAction, raisedNode: w.client.raisedNode, reader: w.reader, homeAuthoringSession: () => w.session,
      bodyLens: () => "steps", hasBody: () => true, body, setBody: next => { bodies.push(next); setBody(next); },
      lambdaParams: () => [{ name: "x" }], dismissed: false, bodyEdited: false, functionId: () => "new-function-id",
      // Only the semantic declaration builder is controlled; its complete
      // dependency graph, normalized scalar name and definition memo are Home's.
      buildAuthoringSignatureDeclaration: input => input,
      latest, refresh, sessionEpoch: () => 1, localFunctionPreviewJob, functionPreview: () => ({ error: undefined }),
      paramsType, returnsType, requires, reps, authoredFacetRevision, resultMode: () => "infer", schemeMetadata: () => metadata,
      genericIssue: () => undefined, activeStepsIssue: stepsIssue, fieldResurrections: { fieldIds: resurrectFieldIds }, setSaveError: () => {},
      localGuidanceCapture: w.capture, localGuidanceCurrent: w.current,
      toLogic: pageOwner(w, "toLogic"), LOCAL_SAVE_TOOLS_PENDING: TOOLS };
    return { frame, bodies, restorations, definitionSelections, setBodyElsewhere: setBody, body, setStepsIssue,
      editDraft: kind => {
        if (kind === "body") setBody(literal("newer Expression body"));
        if (kind === "params") setParamsType({ $record: { fields: [{ name: "renamed", type: { $ref: "Number" } }] } });
        if (kind === "returns") setReturnsType({ $ref: "Number" });
        if (kind === "requires") setRequires([{ fixture: "new requirement" }]);
        if (kind === "representations") setReps(current => ({ ...current, Labelable: { label: "Newer label" } }));
        if (kind === "description") setReps(current => ({ ...current, Describable: { description: "Newer description" } }));
        if (kind === "codeName") setReps(current => ({ ...current, Codeable: { codeName: "renamed" } }));
        if (kind === "codeNameWhitespace") setReps(current => ({ ...current, Codeable: { codeName: "  original  " } }));
        if (kind === "facet") setFacetRevision(value => value + 1);
        if (kind === "resurrection") setResurrectFieldIds(["resurrected-field-id"]);
      },
      ...createRoot(() => run(`${representationString}${creatorNames}${authored}${creatorParams}${creatorDeclaration}${creatorDefinition}${creatorSession}${steps}${retryTools}`, deps,
        ["stepsBody", "raiseLocalSteps", "localStepsPending", "localStepsIssue", "retryLocalSteps", "authoredSubmission",
          "rawName: fnName", "origin: typeof stepsOrigin === 'undefined' ? authoredDraft : stepsOrigin"])) };
  }
  test("the Steps view lowers in the new function's worker frame; edits show at once and only the latest is raised and applied", async () => {
    const w = world(), m = mountSteps(w);
    await settle();
    expect(w.requests.map(r => [r.transport, r.target, r.payload])).toEqual([["context", m.frame, { method: "lower-reader-expression",
      node: { kind: "call", fnId: "add", args: [{ kind: "param", name: "x" }, literal(1)] }, savedExpressions: [], unresolved: true, priority: "guidance" }]]);
    expect(m.stepsBody()).toEqual({ body: undefined, error: undefined, pending: true });
    await w.answer(0, { lowered: { $tag: "Ok", _0: { logic: { "+": [{ var: "x" }, 1] }, emptySlot: false } } });
    expect(m.stepsBody()).toEqual({ body: { "+": [{ var: "x" }, 1] }, error: undefined });
    for (const n of [2, 3, 4]) m.raiseLocalSteps({ "+": [{ var: "x" }, n] });
    await settle();
    expect(m.stepsBody().body).toEqual({ "+": [{ var: "x" }, 4] });
    expect(m.localStepsPending()).toBe(true);
    expect(w.requests.slice(1).map(r => [r.target, r.payload])).toEqual([[m.frame, { method: "raise-reader-logic", logic: { "+": [{ var: "x" }, 2] }, params: ["x"] }]]);
    await w.answer(1, { raised: { $tag: "Ok", _0: literal("two") } });
    expect(m.bodies).toEqual([]);
    expect(w.requests[2].payload).toEqual({ method: "raise-reader-logic", logic: { "+": [{ var: "x" }, 4] }, params: ["x"] });
    await w.answer(2, { raised: { $tag: "Ok", _0: literal("four") } });
    expect(m.bodies).toEqual([literal("four")]);
    expect(m.localStepsPending()).toBe(false);
    expect(w.pageReads).toEqual([]);
  });
  test("a Steps edit with no new-function frame refuses with the tools copy and sends nothing", async () => {
    const w = world(), m = mountSteps(w, { noFrame: true });
    await settle();
    m.raiseLocalSteps({ var: "x" });
    await settle();
    expect(w.requests).toEqual([]);
    expect(m.localStepsIssue()).toBe(TOOLS);
    expect(m.localStepsPending()).toBe(false);
  });
  for (const changed of ["representations", "requires"]) for (const outcome of ["success", "error"]) test(
    `a pending Steps ${outcome} retains a newer queued edit authored after a ${changed} change`, async () => {
      const w = world(), m = mountSteps(w);
      await settle(); await w.answer(0, { lowered: { $tag: "Ok", _0: { logic: 1, emptySlot: false } } });
      m.raiseLocalSteps({ var: "old" }); await settle();
      m.editDraft(changed); await settle();
      const currentLogic = { var: "newer" };
      m.raiseLocalSteps(currentLogic); await settle();
      expect(m.stepsBody().body).toEqual(currentLogic); expect(w.requests).toHaveLength(2);
      if (outcome === "success") await w.answer(1, { raised: { $tag: "Ok", _0: literal("stale result") } });
      else await w.fail(1, new Error("stale failure"));
      expect(m.bodies).toEqual([]); expect(m.localStepsIssue()).toBeUndefined(); expect(m.localStepsPending()).toBe(true);
      expect(w.requests).toHaveLength(3);
      expect(w.requests[2].payload).toMatchObject({ method: "raise-reader-logic", logic: currentLogic });
      expect(m.stepsBody().body).toEqual(currentLogic);
      await w.answer(2, { raised: { $tag: "Ok", _0: literal("current result") } });
      expect(m.bodies).toEqual([literal("current result")]); expect(m.localStepsPending()).toBe(false);
    });
  const metadataOnlyEdits = ["representations", "description", "facet", "resurrection", "codeNameWhitespace"];
  function expectRetainedMetadata(m, captured) {
    const current = m.authoredSubmission();
    expect(current.representations).toBe(captured.representations);
    expect(current.facetRevision).toBe(captured.facetRevision);
    expect(current.resurrectFieldIds).toBe(captured.resurrectFieldIds);
  }
  for (const changed of metadataOnlyEdits) test(`a ${changed} edit commutes with a pending Steps success and remains in Save metadata`, async () => {
    const w = world(), m = mountSteps(w);
    await settle(); await w.answer(0, { lowered: { $tag: "Ok", _0: { logic: 1, emptySlot: false } } });
    const originalOrigin = m.origin(), originalMetadata = m.authoredSubmission(), frames = m.definitionSelections.length;
    m.raiseLocalSteps({ var: "x" }); await settle();
    m.editDraft(changed); await settle();
    const editedMetadata = m.authoredSubmission(), editedOrigin = m.origin();
    await w.answer(1, { raised: { $tag: "Ok", _0: literal("accepted Steps result") } });
    expect(m.bodies).toEqual([literal("accepted Steps result")]); expect(m.localStepsPending()).toBe(false);
    expect(editedOrigin).toBe(originalOrigin); expect(editedMetadata).not.toBe(originalMetadata);
    expect(m.definitionSelections).toHaveLength(frames); expectRetainedMetadata(m, editedMetadata);
    if (changed === "codeNameWhitespace") {
      expect(m.rawName()).toBe("  original  ");
      expect(m.definitionSelections.at(-1).signatureDeclaration.declarationName).toBe("original");
    }
  });
  for (const changed of metadataOnlyEdits) test(`a ${changed} edit preserves a failed Steps edit's explicit Retry`, async () => {
    const w = world(), m = mountSteps(w);
    await settle(); await w.answer(0, { lowered: { $tag: "Ok", _0: { logic: 1, emptySlot: false } } });
    m.raiseLocalSteps({ var: "x" }); await settle();
    await w.answer(1, { raised: { $tag: "Err", _0: "Current Steps error" } });
    m.editDraft(changed); await settle(); const editedMetadata = m.authoredSubmission();
    m.retryLocalSteps(); await settle();
    expect(m.restorations).toHaveLength(1); expect(w.requests).toHaveLength(3);
    expect(w.requests[2].payload).toMatchObject({ method: "raise-reader-logic", logic: { var: "x" } });
    await w.answer(2, { raised: { $tag: "Ok", _0: literal("retried result") } });
    expect(m.bodies).toEqual([literal("retried result")]); expectRetainedMetadata(m, editedMetadata);
  });
  test("a real normalized Codeable name change refuses a pending Steps result in its old definition", async () => {
    const w = world(), m = mountSteps(w);
    await settle(); await w.answer(0, { lowered: { $tag: "Ok", _0: { logic: 1, emptySlot: false } } });
    const original = m.origin();
    m.raiseLocalSteps({ var: "x" }); await settle();
    m.editDraft("codeName"); await settle();
    await w.answer(1, { raised: { $tag: "Ok", _0: literal("old definition result") } });
    expect(m.bodies).toEqual([]); expect(m.localStepsPending()).toBe(false); expect(m.origin()).not.toBe(original);
    expect(m.rawName()).toBe("renamed"); expect(m.definitionSelections.at(-1).signatureDeclaration.declarationName).toBe("renamed");
  });
  test("metadata edited while tools restore neither drops the selected Steps Retry nor reverts that metadata", async () => {
    const w = world(), m = mountSteps(w, { holdRestoration: true });
    await settle(); await w.answer(0, { lowered: { $tag: "Ok", _0: { logic: 1, emptySlot: false } } });
    m.raiseLocalSteps({ var: "x" }); await settle();
    await w.answer(1, { raised: { $tag: "Err", _0: "Current Steps error" } });
    m.retryLocalSteps(); expect(m.restorations).toHaveLength(1);
    m.editDraft("representations"); await settle(); const editedMetadata = m.authoredSubmission();
    m.restorations[0].resolve(true); await settle();
    expect(w.requests).toHaveLength(3);
    await w.answer(2, { raised: { $tag: "Ok", _0: literal("retried result") } });
    expect(m.bodies).toEqual([literal("retried result")]); expectRetainedMetadata(m, editedMetadata);
  });
  for (const outcome of ["success", "error"]) test(`a metadata edit after B is queued preserves that latest edit when A returns ${outcome}`, async () => {
    const w = world(), m = mountSteps(w);
    await settle(); await w.answer(0, { lowered: { $tag: "Ok", _0: { logic: 1, emptySlot: false } } });
    m.raiseLocalSteps({ var: "A" }); await settle();
    m.raiseLocalSteps({ var: "B" }); await settle();
    m.editDraft("representations"); await settle(); const editedMetadata = m.authoredSubmission();
    if (outcome === "success") await w.answer(1, { raised: { $tag: "Ok", _0: literal("superseded A") } });
    else await w.fail(1, new Error("superseded A failure"));
    expect(w.requests).toHaveLength(3); expect(m.bodies).toEqual([]);
    expect(w.requests[2].payload).toMatchObject({ method: "raise-reader-logic", logic: { var: "B" } });
    expect(m.stepsBody().body).toEqual({ var: "B" }); expect(m.localStepsPending()).toBe(true);
    await w.answer(2, { raised: { $tag: "Ok", _0: literal("current B") } });
    expect(m.bodies).toEqual([literal("current B")]); expectRetainedMetadata(m, editedMetadata);
  });
  for (const outcome of ["success", "error"]) test(
    `a stale Steps ${outcome} discards a queued edit authored before a signature change`, async () => {
      const w = world(), m = mountSteps(w);
      await settle(); await w.answer(0, { lowered: { $tag: "Ok", _0: { logic: 1, emptySlot: false } } });
      m.raiseLocalSteps({ var: "old" }); await settle();
      m.raiseLocalSteps({ var: "queued before change" }); await settle();
      m.editDraft("requires"); await settle();
      if (outcome === "success") await w.answer(1, { raised: { $tag: "Ok", _0: literal("stale result") } });
      else await w.fail(1, new Error("stale failure"));
      expect(w.requests).toHaveLength(2); expect(m.bodies).toEqual([]); expect(m.localStepsPending()).toBe(false);
      expect(m.localStepsIssue()).toBeUndefined(); expect(m.stepsBody()).toEqual({ body: 1, error: undefined });
    });
  test("an edit made in another view is never hidden or overwritten by an earlier Steps edit", async () => {
    const w = world(), m = mountSteps(w);
    await settle();
    await w.answer(0, { lowered: { $tag: "Ok", _0: { logic: 1, emptySlot: false } } });
    m.raiseLocalSteps({ var: "x" });
    await settle();
    await w.answer(1, { raised: { $tag: "Ok", _0: { kind: "param", name: "x" } } });
    expect(m.bodies).toEqual([{ kind: "param", name: "x" }]);
    // The Expression view edits the body; back in Steps the shown Steps
    // logic is not this body: the view waits for the worker's lowering.
    m.setBodyElsewhere(literal("from code"));
    await settle();
    expect(m.stepsBody()).toEqual({ body: undefined, error: undefined, pending: true });
    const lowering = w.requests.findLast(r => r.payload.method === "lower-reader-expression");
    expect(lowering.payload.node).toEqual(literal("from code"));
    // A Steps raise still in flight when another view edits is dropped.
    m.raiseLocalSteps({ var: "late" });
    await settle();
    const raise = w.requests.length - 1;
    m.setBodyElsewhere(literal("newer code"));
    await settle();
    await w.answer(raise, { raised: { $tag: "Ok", _0: { kind: "param", name: "late" } } });
    expect(m.body()).toEqual(literal("newer code"));
    expect(m.localStepsPending()).toBe(false);
  });
  test("a refused Steps edit settles: its message offers Retry, nothing stays pending, and Retry or a newer edit sends again", async () => {
    const w = world(), m = mountSteps(w);
    await settle();
    await w.answer(0, { lowered: { $tag: "Ok", _0: { logic: 1, emptySlot: false } } });
    m.raiseLocalSteps({ var: "y" });
    await settle();
    await w.answer(1, { raised: { $tag: "Err", _0: "Unknown variable y" } });
    expect(m.localStepsIssue()).toBe("Unknown variable y");
    expect(m.localStepsPending()).toBe(false);
    // The view shows the body again (the worker's lowering of it).
    expect(m.stepsBody().body).toEqual(1);
    m.retryLocalSteps();
    await settle();
    expect(w.requests[2].payload.logic).toEqual({ var: "y" });
    expect(m.localStepsPending()).toBe(true);
    await w.fail(2, new Error("This reader's editing tools are not ready. Try again after preparation."));
    expect(m.localStepsPending()).toBe(false);
    m.raiseLocalSteps({ var: "x" });
    await settle();
    expect(w.requests[3].payload.logic).toEqual({ var: "x" });
    await w.answer(3, { raised: { $tag: "Ok", _0: { kind: "param", name: "x" } } });
    expect(m.bodies).toEqual([{ kind: "param", name: "x" }]);
    expect(m.localStepsIssue()).toBeUndefined();
    expect(w.pageReads).toEqual([]);
  });
  for (const changed of ["body", "params", "returns", "requires", "codeName"]) test(
    `a failed Steps edit cannot overwrite a ${changed} edit made before Retry`, async () => {
    const w = world(), m = mountSteps(w);
    await settle(); await w.answer(0, { lowered: { $tag: "Ok", _0: { logic: 1, emptySlot: false } } });
    m.raiseLocalSteps({ var: "old" }); await settle();
    await w.answer(1, { raised: { $tag: "Err", _0: "Old Steps edit refused" } });
    m.editDraft(changed); await settle();
    const requests = w.requests.length;
    m.retryLocalSteps(); await settle();
    expect(m.restorations).toEqual([]); expect(w.requests).toHaveLength(requests);
    if (changed === "body") expect(m.body()).toEqual(literal("newer Expression body"));
    expect(m.bodies).toEqual([]);
  });
  test("a Steps error reported after a signature edit neither publishes its old failure nor installs its body", async () => {
    const w = world(), m = mountSteps(w);
    await settle(); await w.answer(0, { lowered: { $tag: "Ok", _0: { logic: 1, emptySlot: false } } });
    m.raiseLocalSteps({ var: "old" }); await settle();
    m.editDraft("requires"); await settle();
    await w.answer(1, { raised: { $tag: "Err", _0: "Old signature error" } });
    expect(m.localStepsIssue()).toBeUndefined(); expect(m.localStepsPending()).toBe(false); expect(m.bodies).toEqual([]);
    m.retryLocalSteps(); await settle(); expect(m.restorations).toEqual([]);
  });
  test("Steps issue status alone does not invalidate the unchanged authored draft's Retry", async () => {
    const w = world(), m = mountSteps(w);
    await settle(); await w.answer(0, { lowered: { $tag: "Ok", _0: { logic: 1, emptySlot: false } } });
    m.raiseLocalSteps({ var: "old" }); await settle();
    await w.answer(1, { raised: { $tag: "Err", _0: "Current Steps failure" } });
    m.setStepsIssue("Steps lens status changed"); await settle();
    m.retryLocalSteps(); await settle();
    expect(m.restorations).toHaveLength(1); expect(w.requests).toHaveLength(3);
    expect(w.requests[2].payload).toMatchObject({ method: "raise-reader-logic", logic: { var: "old" } });
  });
  test("a failed Steps edit cannot overwrite an Expression edit made while tools restore", async () => {
    const w = world(), m = mountSteps(w, { holdRestoration: true });
    await settle(); await w.answer(0, { lowered: { $tag: "Ok", _0: { logic: 1, emptySlot: false } } });
    m.raiseLocalSteps({ var: "old" }); await settle();
    await w.answer(1, { raised: { $tag: "Err", _0: "Old Steps edit refused" } });
    m.retryLocalSteps(); expect(m.restorations).toHaveLength(1);
    m.setBodyElsewhere(literal("newer Expression body")); await settle();
    const requests = w.requests.length;
    m.restorations[0].resolve(true); await settle();
    expect(w.requests).toHaveLength(requests); expect(m.body()).toEqual(literal("newer Expression body")); expect(m.bodies).toEqual([]);
  });
  test("Steps lowering restores and re-asks a failure only while its original capture remains current", async () => {
    const w = world(), m = mountSteps(w, { holdRestoration: true });
    await settle(); await w.fail(0, new Error("Lowering transport failed"));
    const failed = m.stepsBody(); expect(failed.error).toBe("Lowering transport failed");
    failed.retry(); expect(m.restorations).toHaveLength(1); expect(w.requests).toHaveLength(1);
    m.restorations[0].resolve(true); await settle();
    expect(w.requests).toHaveLength(2); expect(w.requests[1].payload.method).toBe("lower-reader-expression");
    expect(m.stepsBody()).toEqual({ body: undefined, error: undefined, pending: true });
  });
  test("Steps lowering keeps the replacement capture's automatic request instead of aborting and duplicating it", async () => {
    const w = world(), m = mountSteps(w, { holdRestoration: true });
    await settle(); await w.fail(0, new Error("Lowering transport failed"));
    m.stepsBody().retry();
    w.unprepare(); w.replaceWorker(); w.reprepare(); await settle();
    expect(w.requests).toHaveLength(2);
    const current = w.requests[1]; expect(current.signal.aborted).toBe(false);
    m.restorations[0].resolve(true); await settle();
    expect(w.requests).toHaveLength(2); expect(current.signal.aborted).toBe(false);
    await w.answer(1, { lowered: { $tag: "Ok", _0: { logic: 1, emptySlot: false } } });
    expect(m.stepsBody()).toEqual({ body: 1, error: undefined });
  });
  test("the edit dialog's body is the worker's raise, in the function's own frame; pending shows no body", async () => {
    const w = world();
    const frame = w.poisoned("function-frame");
    const fn = { id: "f", params: [{ name: "x" }], body: { "+": [{ var: "x" }, 1] } };
    const deps = { createMemo, functionPin: () => ({ fn }), functionIngress: () => undefined, functionSourceAuthoringSession: () => frame,
      localFunctionBody: undefined, logicToExprNode: pageOwner(w, "logicToExprNode") };
    const m = createRoot(() => {
      deps.localFunctionBody = w.client.createLocalReaderAnswer(() => w.reader, () => w.session, () => ({ method: "raise-reader-logic",
        logic: fn.body, params: ["x"] }), w.client.readActionResult("raised"), { via: () => frame });
      return run(raise, deps, ["functionBodyExpr"]);
    });
    await settle();
    expect(w.requests.map(r => [r.transport, r.target, r.payload])).toEqual([["context", frame, { method: "raise-reader-logic", logic: fn.body, params: ["x"] }]]);
    expect(m.functionBodyExpr()).toBeNull();
    const node = { kind: "call", fnId: "add", args: [{ kind: "param", name: "x" }, literal(1)] };
    await w.answer(0, { raised: { $tag: "Ok", _0: node } });
    expect(m.functionBodyExpr()).toEqual(node);
    expect(w.pageReads).toEqual([]);
  });
  test("the new function's preview asks the worker to lower its body and check it in one request; the reply carries the lowered body", async () => {
    const w = world();
    const context = { session: w.poisoned("draft-session"), base: w.session, handle: { scoped: true }, worker: {} };
    const node = { kind: "call", fnId: "add", args: [{ kind: "param", name: "x" }, literal(1)] };
    const deps = { createMemo, previewController: undefined, localFunctionPreviewContext: () => context, reader: w.reader,
      sessionEpoch: () => 1, captureReaderSourceMetadata: () => undefined, homeAuthoringSession: () => w.session,
      functionId: () => "f", paramFields: () => [{ name: "x" }], returnsType: () => ({ $ref: "Number" }), requires: () => undefined,
      declaration: () => ({ declarationName: "f" }), body: () => node, assertLocalFunctionPreview: () => {},
      runPreparedReaderWorker: (handle, payload, signal) => { const held = deferred(); w.requests.push({ transport: "prepared", target: handle, payload, signal, ...held });
        return held.promise; },
      toLogic: pageOwner(w, "toLogic"), splitLoweredFunctionDraft: split };
    const m = createRoot(() => run(job, deps, ["localFunctionPreviewJob"]));
    const current = m.localFunctionPreviewJob();
    await settle();
    expect(w.requests.map(r => r.payload)).toEqual([{ method: "infer-function-draft", fn: { id: "f", params: [{ name: "x" }], returns: { $ref: "Number" },
      signatureDeclaration: { declarationName: "f" } }, declaration: { declarationName: "f" },
      lowerBody: { node, refusal: "Use a parameter for saved data in a function body." } }]);
    expect(w.requests[0].target).toBe(context.handle);
    const logic = { "+": [{ var: "x" }, 1] };
    await w.answer(0, { outcome: { $tag: "Solved" }, loweredBody: logic });
    expect(await current.promise).toEqual({ outcome: { $tag: "Solved" } });
    expect(await current.body).toEqual(logic);
    expect(w.pageReads).toEqual([]);
  });
});
