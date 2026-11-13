// Run with: bun test --conditions=browser --conditions=development ./src/lib/expression-runner/local-home-ops.test.mjs
import { describe, expect, test } from "bun:test";
import { createSignal, createEffect, createMemo, createRoot, flush, latest, onCleanup, untrack } from "solid-js";
import { compiled, section } from "./local-save-admission.fixture.mjs";
import { resolveLocusCatalogReference } from "../locus-catalog-reference";
import { followLocusPath } from "../locus-reference";

// B4 wave 4 lane H: Home's remaining Local page reads run in the reader's
// worker. Home's sections and the production client (`local-reader-actions.ts`)
// are extracted unchanged and run against a page session whose registry,
// evaluator, environment and catalogue THROW (each read is recorded); the
// worker records each request and tests answer them explicitly.
// `B4W4H_HOME` points the Home sections at another copy of home.tsx (the
// fail-first runs use the base).
const homePath = process.env.B4W4H_HOME ? `file:///${process.env.B4W4H_HOME.replaceAll("\\", "/")}` : new URL("../../routes/app/home.tsx", import.meta.url);
const homeSource = (await Bun.file(new URL(homePath)).text()).replaceAll("\r\n", "\n");
const clientSource = (await Bun.file(new URL("./local-reader-actions.ts", import.meta.url)).text()).replaceAll("\r\n", "\n");
const clientCode = compiled(clientSource.slice(clientSource.indexOf("/** The existing Local refusal sentences")));
const TOOLS = "This reader's editing tools are not ready. Try again after preparation.";
const CHANGED = "This data changed while preparing the edit. Try again with its current contents.";
async function settle() { for (let turn = 0; turn < 24; turn++) { await Promise.resolve(); flush(); } }
const tick = () => new Promise(resolve => setTimeout(resolve, 1));
const deferred = () => { let resolve, reject; const promise = new Promise((yes, no) => { resolve = yes; reject = no; }); return { promise, resolve, reject }; };

function world() {
  const pageReads = [], requests = [];
  const [revision, setRevision] = createSignal(1);
  const worker = { fixture: "worker" };
  const poisoned = label => {
    const session = { label, mode: "detached" };
    for (const key of ["registry", "evaluateContext", "environment", "catalog"]) Object.defineProperty(session, key, { get() {
      pageReads.push(`${label}.${key}`); throw new Error(`Page ${key} read for a Local reader`);
    } });
    return session;
  };
  const session = poisoned("local-page-session");
  const reader = { kind: "local", revision: () => revision(), session: () => session, epoch: 1,
    registry: () => { pageReads.push("reader.registry"); throw new Error("Page registry read for a Local reader"); } };
  const capture = (r, s) => r?.kind === "local" ? { epoch: 1, facade: s(), concrete: s(), worker, revision: r.revision() } : undefined;
  const same = (a, b) => a.worker === b.worker && a.revision === b.revision && a.concrete === b.concrete;
  const current = (c, r, s) => { const now = untrack(() => capture(r, s)); return !!now && same(now, c); };
  const record = transport => (target, payload, signal) => {
    const held = deferred();
    requests.push({ transport, target, payload: structuredClone(payload), signal, ...held });
    return held.promise;
  };
  const imports = { createEffect, createSignal, onCleanup, untrack,
    preparedReaderWorkerForSession: facade => ({ handle: worker, facade }),
    runPreparedReaderWorker: record("prepared"), runAuthoringWorker: record("context"),
    localGuidanceCapture: capture, localGuidanceCurrent: current, sameLocalGuidanceCapture: same,
    draftValueFingerprint: JSON.stringify, reachedSavedSources: () => [] };
  const client = new Function(...Object.keys(imports), `${clientCode}; return { LOCAL_ACTION_TOOLS_PENDING, LOCAL_ACTION_CHANGED,
    runLocalReaderAction, readActionResult, createLocalReaderAnswer };`)(...Object.values(imports));
  return { client, session, poisoned, reader, requests, pageReads, snapshot: worker,
    bump: () => { setRevision(value => value + 1); flush(); },
    answer: async (index, value) => { requests[index].resolve(value); await settle(); },
    fail: async (index, error) => { requests[index].reject(error); await settle(); } };
}
function run(code, deps, names) {
  return new Function(...Object.keys(deps), `${compiled(code)}; return { ${names.join(", ")} };`)(...Object.values(deps));
}
const helperCode = () => section(homeSource, "// B4 wave 4 lane H: a Local reader's signature guards", "/** Every live value belongs");
function helpers(w, latestRead = latest) {
  return run(helperCode(), { createSignal, untrack, latest: latestRead, runLocalReaderAction: w.client.runLocalReaderAction,
    readActionResult: w.client.readActionResult, LOCAL_ACTION_CHANGED: w.client.LOCAL_ACTION_CHANGED,
    LOCAL_SAVE_TOOLS_PENDING: TOOLS, LOCAL_SAVE_CHANGED: CHANGED, draftValueFingerprint: JSON.stringify,
    // B4 wave 4 lane H continuation: the worker snapshot keys the field icon cache.
    authoringWorkerSnapshot: () => w.snapshot, resolveLocusCatalogReference },
  ["createLocalSignatureGuard", "parameterTextEdit", "localValueSearch", "readLocalHandles", "readLocalCallSignature",
    "localReferenceResolver", "localFieldIcon"]);
}
const scheme = (returns) => ({ quantified: [], body: { $arrow: { params: [], returns } } });

// Exercise NewFunctionModal's actual parameter handler and installation path,
// including their Solid writes, rather than reproducing the guard's queue.
function newFunctionParameters(w, options = {}) {
  const code = `
    const reader = w.reader, homeAuthoringSession = () => w.session;
    const draft = w.poisoned("new-function-draft"), newFunctionAuthoringSession = () => draft;
    const [paramsType, setParamsType] = createSignal({ $record: { fields: [] } });
    const [returnsType, setReturnsType] = createSignal({ $ref: "String" });
    const [schemeMetadata, setSchemeMetadata] = createSignal({ quantified: [] });
    const [body, setBody] = createSignal({ kind: "literal", value: "" });
    const shownParamFields = createMemo(() => paramsType().$record.fields);
    const paramFields = () => readParameters(shownParamFields());
    const ownedScheme = createMemo(() => ({ ...schemeMetadata(), body: { $arrow: { params: paramFields(), returns: returnsType() } } }));
    let reconciledParameterFields = [], approvedParameterFields;
    const refused = [], setSaveError = error => { if (error) refused.push(error); };
    const localSignature = h.createLocalSignatureGuard({ reader: () => reader, session: homeAuthoringSession,
      via: newFunctionAuthoringSession, closed: () => false, refuse: setSaveError });
    const parameterTextEdit = h.parameterTextEdit;
    ${section(homeSource, "  function installOwnedScheme(scheme: TypeScheme) {", "  function editGenericDeclaration(edit: AuthoringGenericEdit) {")}
    ${section(homeSource, "  function guardParameterFields(next: readonly FieldDef[]) {", "  // In-scope params for ExpressionEditor")}
    const change = next => { if (guardParameterFields(next)) setParamsType({ $record: { fields: next } }); };
  `;
  let result;
  createRoot(dispose => { result = { ...run(code, { createSignal, createMemo, h: helpers(w, options.latest), w,
    readParameters: options.readParameters ?? (rows => rows), draftValueFingerprint: JSON.stringify },
    ["change", "paramFields", "body", "setBody", "refused", "localSignature"]), dispose }; });
  return result;
}
const parameterField = (name = "field1", type = "String") => ({ name, type: { $ref: type },
  key: { $tag: "NamedField", ref: { $ref: "new-parameter-uuid" } }, label: { $tag: "Nothing" }, ui: { $tag: "Nothing" }, meta: {} });
const parameterReply = (request, body = request.payload.edit.draft.body) => {
  const { edit } = request.payload;
  return { reconciled: { $tag: "Ok", _0: { scheme: { ...edit.scheme,
    body: { $arrow: { params: edit.next, returns: edit.draft.returns } } },
    binding: { params: edit.next, body, returns: edit.draft.returns } } } };
};

describe("New Function's actual parameter guard", () => {
  test("first Add waits for the worker, retains its Field UUID, and retries a moved reader", async () => {
    const w = world(), t = newFunctionParameters(w);
    try {
      t.change([parameterField()]);
      await settle();
      expect(t.localSignature.pending()).toBe(true);
      expect(t.paramFields()).toEqual([]);
      expect(w.requests).toHaveLength(1);
      w.bump();
      await w.answer(0, parameterReply(w.requests[0]));
      expect(t.paramFields()).toEqual([]);
      expect(w.requests).toHaveLength(2);
      expect(w.requests[1].payload.edit.next).toEqual([parameterField()]);
      await w.answer(1, parameterReply(w.requests[1]));
      expect(t.paramFields()).toEqual([parameterField()]);
      expect(t.localSignature.pending()).toBe(false);
      expect(t.refused).toEqual([]);
      expect(w.pageReads).toEqual([]);
    } finally { t.dispose(); }
  });
  test("a same-turn rename and type pick send the name-only edit before changing the type", async () => {
    const w = world(), t = newFunctionParameters(w);
    try {
      t.change([parameterField()]); await settle(); await w.answer(0, parameterReply(w.requests[0]));
      t.setBody({ kind: "param", name: "field1" }); flush();
      // No flush or timer between the two user edits: held drain must let the
      // typed name land before reading the followed edit's current rows.
      t.change([parameterField("probeInput")]);
      t.change([parameterField("probeInput", "Number")]);
      await settle();
      expect(w.requests).toHaveLength(2);
      expect(w.requests[1].payload.edit.draft.params).toEqual([parameterField()]);
      expect(w.requests[1].payload.edit.next).toEqual([parameterField("probeInput")]);
      expect(t.localSignature.pending()).toBe(true);
      await w.answer(1, parameterReply(w.requests[1], { kind: "param", name: "probeInput" }));
      expect(w.requests).toHaveLength(3);
      expect(w.requests[2].payload.edit.draft.params).toEqual([parameterField("probeInput")]);
      expect(w.requests[2].payload.edit.draft.body).toEqual({ kind: "param", name: "probeInput" });
      expect(w.requests[2].payload.edit.next).toEqual([parameterField("probeInput", "Number")]);
      await w.answer(2, parameterReply(w.requests[2]));
      expect(t.paramFields()).toEqual([parameterField("probeInput", "Number")]);
      expect(t.body()).toEqual({ kind: "param", name: "probeInput" });
      expect(t.localSignature.pending()).toBe(false);
      expect(t.refused).toEqual([]);
      expect(w.pageReads).toEqual([]);
    } finally { t.dispose(); }
  });
  test("a followed rename reads the in-flight rows when the committed graph stays old across a timer", async () => {
    let committedRows, readingLatest = false;
    // Supplied stale/current accessors reproduce the native preview boundary:
    // a timer alone does not release its old committed parameter rows. The
    // production handler, queue and worker client remain the actual sources.
    const latestRead = read => latest(() => {
      const previous = readingLatest; readingLatest = true;
      try { return read(); } finally { readingLatest = previous; }
    });
    const w = world(), t = newFunctionParameters(w, { latest: latestRead,
      readParameters: rows => committedRows && !readingLatest ? committedRows : rows });
    try {
      t.change([parameterField()]); await settle(); await w.answer(0, parameterReply(w.requests[0]));
      committedRows = t.paramFields();
      t.change([parameterField("probeInput")]); flush();
      // Deliberately keep committedRows unchanged after the actual timer fires.
      await tick(); await settle();
      expect(t.paramFields()).toEqual([parameterField()]);
      expect(w.requests).toHaveLength(2);
      expect(w.requests[1].payload.edit.draft.params).toEqual([parameterField()]);
      expect(w.requests[1].payload.edit.next).toEqual([parameterField("probeInput")]);
      committedRows = undefined;
      t.change([parameterField("probeInput", "Number")]);
      await w.answer(1, parameterReply(w.requests[1]));
      expect(w.requests).toHaveLength(3);
      expect(w.requests[2].payload.edit.draft.params).toEqual([parameterField("probeInput")]);
      expect(w.requests[2].payload.edit.next).toEqual([parameterField("probeInput", "Number")]);
      await w.answer(2, parameterReply(w.requests[2]));
      expect(t.paramFields()).toEqual([parameterField("probeInput", "Number")]);
      expect(t.refused).toEqual([]);
      expect(w.pageReads).toEqual([]);
    } finally { t.dispose(); }
  });
});

describe("B4 wave 4 lane H: a Local signature guard reconciles in the draft's worker frame", () => {
  function guard(w) {
    const h = helpers(w), refused = [], applied = [];
    const draft = w.poisoned("draft-session");
    const [returns, setReturns] = createSignal({ $ref: "String" });
    const [params, setParams] = createSignal([]);
    let closed = false;
    const g = h.createLocalSignatureGuard({ reader: () => w.reader, session: () => w.session, via: () => draft,
      closed: () => closed, refuse: message => refused.push(message) });
    const holdReturn = next => g.hold({ base: () => [returns()], state: () => [params()],
      edit: () => ({ kind: "scheme", scheme: scheme(returns()), nextBody: { $arrow: { params: params(), returns: next } } }),
      apply: reconciled => { applied.push(reconciled.scheme); setReturns(next); } });
    return { g, h, draft, refused, applied, returns, setReturns, params, setParams, holdReturn, close: () => { closed = true; } };
  }
  test("a held edit is not applied until the worker answers, then applied; it goes to the draft's own worker context", async () => {
    const w = world(), t = guard(w);
    t.holdReturn({ $ref: "Number" });
    await settle();
    expect(t.g.pending()).toBe(true);
    expect(t.applied).toEqual([]);
    expect(w.requests).toHaveLength(1);
    expect(w.requests[0].transport).toBe("context");
    expect(w.requests[0].target).toBe(t.draft);
    expect(w.requests[0].payload).toEqual({ method: "reconcile-reader-signature", edit: { kind: "scheme", scheme: scheme({ $ref: "String" }),
      nextBody: { $arrow: { params: [], returns: { $ref: "Number" } } } } });
    await w.answer(0, { reconciled: { $tag: "Ok", _0: { scheme: scheme({ $ref: "Number" }) } } });
    flush();
    expect(t.applied).toEqual([scheme({ $ref: "Number" })]);
    expect(t.g.pending()).toBe(false);
    expect(t.refused).toEqual([]);
    expect(w.pageReads).toEqual([]);
  });
  test("a held edit the worker refuses is refused visibly with the reconciler's message; a moved slot refuses with the existing copy", async () => {
    const w = world(), t = guard(w);
    t.holdReturn({ $ref: "Number" });
    await settle();
    await w.answer(0, { reconciled: { $tag: "Err", _0: "This type parameter is still used." } });
    expect(t.refused).toEqual(["This type parameter is still used."]);
    t.holdReturn({ $ref: "Bool" });
    await settle();
    t.setReturns({ $ref: "Date" }); flush();
    await w.answer(1, { reconciled: { $tag: "Ok", _0: { scheme: scheme({ $ref: "Bool" }) } } });
    expect(t.refused).toEqual(["This type parameter is still used.", CHANGED]);
    expect(t.applied).toEqual([]);
    expect(t.g.pending()).toBe(false);
    expect(w.pageReads).toEqual([]);
  });
  test("a held edit asked under a reader that moved is asked again on the same state, then applied", async () => {
    const w = world(), t = guard(w);
    t.holdReturn({ $ref: "Number" });
    await settle();
    w.bump();
    await w.answer(0, { reconciled: { $tag: "Ok", _0: { scheme: scheme({ $ref: "Number" }) } } });
    expect(w.requests).toHaveLength(2);
    expect(t.applied).toEqual([]);
    await w.answer(1, { reconciled: { $tag: "Ok", _0: { scheme: scheme({ $ref: "Number" }) } } });
    expect(t.applied).toHaveLength(1);
  });
  test("held edits are answered in order, each on the state the previous one left: the latest pick wins", async () => {
    const w = world(), t = guard(w);
    t.holdReturn({ $ref: "Number" });
    t.holdReturn({ $ref: "Bool" });
    await settle();
    expect(w.requests).toHaveLength(1);
    await w.answer(0, { reconciled: { $tag: "Ok", _0: { scheme: scheme({ $ref: "Number" }) } } });
    // Review S2: the second pick is asked on the state the first one left.
    expect(w.requests).toHaveLength(2);
    expect(w.requests[1].payload.edit.scheme).toEqual(scheme({ $ref: "Number" }));
    await w.answer(1, { reconciled: { $tag: "Ok", _0: { scheme: scheme({ $ref: "Bool" }) } } });
    flush();
    expect(t.refused).toEqual([]);
    expect(t.applied).toHaveLength(2);
    expect(t.returns()).toEqual({ $ref: "Bool" });
  });
  test("review S2: typing that moves the request's state keeps re-asking a held edit, never refusing it", async () => {
    const w = world(), t = guard(w);
    t.holdReturn({ $ref: "Number" });
    for (let round = 0; round < 5; round++) {
      await settle();
      t.setParams([{ name: `p${round}` }]); flush();
      await w.answer(round, { reconciled: { $tag: "Ok", _0: { scheme: scheme({ $ref: "Number" }) } } });
    }
    expect(t.applied).toEqual([]);
    await w.answer(5, { reconciled: { $tag: "Ok", _0: { scheme: scheme({ $ref: "Number" }) } } });
    flush();
    expect(t.refused).toEqual([]);
    expect(t.applied).toHaveLength(1);
  });
  test("review S1: a rename asked before the worker was ready shows its refusal, is asked again at Save, and clears when reconciled", async () => {
    const w = world(), h = helpers(w), refused = [], applied = [];
    let ready = false;
    const draft = w.poisoned("draft-session");
    const g = h.createLocalSignatureGuard({ reader: () => w.reader, session: () => w.session, via: () => ready ? draft : undefined,
      closed: () => false, refuse: message => refused.push(message) });
    let reconciledRows = [{ name: "x" }], shown = [{ name: "y" }];
    const job = { base: () => [], state: () => [shown],
      edit: () => JSON.stringify(reconciledRows) === JSON.stringify(shown) ? undefined : { kind: "binding-rows",
        draft: { params: reconciledRows, body: { kind: "param", name: "x" }, returns: { $ref: "Number" } }, next: shown, scheme: scheme({ $ref: "Number" }) },
      apply: reconciled => { reconciledRows = reconciled.binding.params; applied.push(reconciled.binding.body); } };
    g.follow(job);
    await tick(); await settle();
    expect(g.issue()).toBe(TOOLS);
    expect(refused).toEqual([TOOLS]);
    ready = true;
    expect(g.retry()).toBe(true);
    await settle();
    expect(w.requests).toHaveLength(1);
    await w.answer(0, { reconciled: { $tag: "Ok", _0: { scheme: scheme({ $ref: "Number" }), binding: { params: shown, body: { kind: "param", name: "y" }, returns: {} } } } });
    flush();
    expect(applied).toEqual([{ kind: "param", name: "y" }]);
    expect(g.issue()).toBeUndefined();
    expect(g.retry()).toBe(false);
  });
  test("review S1: a held edit that reconciles the shown rows clears a followed edit's refusal", async () => {
    const w = world(), h = helpers(w), refused = [];
    const draft = w.poisoned("draft-session");
    const g = h.createLocalSignatureGuard({ reader: () => w.reader, session: () => w.session, via: () => draft,
      closed: () => false, refuse: message => refused.push(message) });
    let reconciledRows = [{ name: "x" }], shown = [{ name: "y" }];
    const edit = () => JSON.stringify(reconciledRows) === JSON.stringify(shown) ? undefined : { kind: "binding-rows",
      draft: { params: reconciledRows, body: {}, returns: {} }, next: shown, scheme: scheme({}) };
    g.follow({ base: () => [], state: () => [shown], edit, apply: () => {} });
    await tick(); await settle();
    await w.answer(0, { reconciled: { $tag: "Err", _0: "Resolve the parameter's uses before changing it." } });
    flush();
    expect(g.issue()).toBe("Resolve the parameter's uses before changing it.");
    expect(refused).toEqual(["Resolve the parameter's uses before changing it."]);
    g.hold({ base: () => [], state: () => [], edit, apply: () => { reconciledRows = shown; } });
    await settle();
    await w.answer(1, { reconciled: { $tag: "Ok", _0: { scheme: scheme({}), binding: { params: shown, body: {}, returns: {} } } } });
    flush();
    expect(g.issue()).toBeUndefined();
  });
  test("review S3: a Local Add while the display's signature pends asks for it itself at weight 0", () => {
    const pin = section(homeSource, "  async function pinResult() {", "  return (");
    expect(pin).toContain("signature = await runLocalReaderAction(reader, authoringSession, request, readLocalCallSignature);");
    expect(pin).toContain("const item = callGuidanceItem(signature);");
    expect(pin).not.toContain("setPinRefusal(localCallSignature.failure() ?? LOCAL_SAVE_TOOLS_PENDING)");
  });
  test("a followed name edit: the stale answer is dropped and the latest state asked again; Save waits meanwhile", async () => {
    const w = world(), t = guard(w);
    const job = { base: () => [], state: () => [t.params()],
      edit: () => ({ kind: "binding-rows", draft: { params: [], body: { kind: "literal", value: 1 }, returns: { $ref: "Number" } }, next: t.params(),
        scheme: scheme({ $ref: "Number" }) }),
      apply: reconciled => t.applied.push(reconciled.binding.params.map(p => p.name)) };
    t.setParams([{ name: "a" }]); flush();
    t.g.follow(job);
    flush();
    expect(t.g.pending()).toBe(true);
    await tick(); await settle();
    expect(w.requests).toHaveLength(1);
    expect(w.requests[0].payload.edit.next).toEqual([{ name: "a" }]);
    t.setParams([{ name: "ab" }]); flush();
    t.g.follow(job);
    await w.answer(0, { reconciled: { $tag: "Ok", _0: { scheme: scheme({ $ref: "Number" }), binding: { params: [{ name: "a" }], body: {}, returns: {} } } } });
    expect(t.applied).toEqual([]);
    expect(w.requests).toHaveLength(2);
    expect(w.requests[1].payload.edit.next).toEqual([{ name: "ab" }]);
    await w.answer(1, { reconciled: { $tag: "Err", _0: "Resolve the parameter's uses before changing it." } });
    flush();
    expect(t.g.issue()).toBe("Resolve the parameter's uses before changing it.");
    expect(t.g.pending()).toBe(false);
    expect(w.pageReads).toEqual([]);
  });
  // Night 2026-11-06: New type's first "Create type locally" click, made while
  // a just-picked field type was still being reconciled, refused silently
  // (its refusal was cleared when the reconciliation landed). Save now waits.
  test("settled(): Save can wait for the pending check, then read the reconciled draft", async () => {
    const w = world(), t = guard(w);
    await t.g.settled();
    const job = { base: () => [], state: () => [t.params()],
      edit: () => ({ kind: "binding-rows", draft: { params: [], body: { kind: "literal", value: 1 }, returns: { $ref: "Number" } }, next: t.params(),
        scheme: scheme({ $ref: "Number" }) }),
      apply: reconciled => t.applied.push(reconciled.binding.params.map(p => p.name)) };
    t.setParams([{ name: "a" }]); flush();
    t.g.follow(job);
    expect(t.g.busy()).toBe(true);
    let waited = false;
    const done = t.g.settled().then(() => { waited = true; });
    await tick(); await settle();
    expect(w.requests).toHaveLength(1);
    expect(waited).toBe(false);
    await w.answer(0, { reconciled: { $tag: "Ok", _0: { scheme: scheme({ $ref: "Number" }), binding: { params: [{ name: "a" }], body: {}, returns: {} } } } });
    await done;
    expect(t.applied).toEqual([["a"]]);
    expect(t.g.busy()).toBe(false);
    expect(t.g.issue()).toBe(undefined);
  });
  test("without the draft's session the edit is refused with the tools copy", async () => {
    const w = world(), h = helpers(w), refused = [];
    const g = h.createLocalSignatureGuard({ reader: () => w.reader, session: () => w.session, via: () => undefined,
      closed: () => false, refuse: message => refused.push(message) });
    g.hold({ base: () => [], state: () => [], edit: () => ({ kind: "scheme", scheme: scheme({}), nextBody: {} }), apply: () => { throw new Error("applied"); } });
    await settle();
    expect(refused).toEqual([TOOLS]);
  });
  test("only a parameter's text is followed; a type, a removal or an addition is held", () => {
    const w = world(), h = helpers(w);
    const a = { name: "a", type: { $ref: "Number" }, label: { $tag: "Nothing" } };
    expect(h.parameterTextEdit([a], [{ ...a, name: "b" }])).toBe(true);
    expect(h.parameterTextEdit([a], [a])).toBe(false);
    expect(h.parameterTextEdit([a], [{ ...a, type: { $ref: "String" } }])).toBe(false);
    expect(h.parameterTextEdit([a], [])).toBe(false);
    expect(h.parameterTextEdit([a], [a, { ...a, name: "c" }])).toBe(false);
  });
});

describe("B4 wave 4 lane H: Browse's value half and the handle reads ask the worker", () => {
  const items = [{ kind: "entity", routeId: "entity:Email", label: "Email", type: { $ref: "Email" } },
    { kind: "function", routeId: "fn", label: "fn", type: { $ref: "Number" } }, { kind: "entity", routeId: "entity:X", label: "X" }];
  test("only the items the candidates read are sent; a yielded or moved answer is asked again", async () => {
    const w = world(), h = helpers(w);
    const controller = new AbortController();
    const done = h.localValueSearch(w.reader, () => w.session, "a@b.co", items, controller.signal);
    await settle();
    expect(w.requests[0].payload).toEqual({ method: "query-reader-value-search", query: "a@b.co", priority: "guidance", items: [items[0]] });
    expect(w.requests[0].transport).toBe("prepared");
    await w.answer(0, { yielded: true });
    expect(w.requests).toHaveLength(2);
    w.bump();
    await w.answer(1, { matches: [] });
    expect(w.requests).toHaveLength(3);
    const matches = [{ id: "Email", status: "complete", value: "a@b.co" }];
    await w.answer(2, { matches });
    expect(await done).toEqual(matches);
    expect(w.pageReads).toEqual([]);
  });
  test("handle and call signature replies are read strictly", () => {
    const w = world(), h = helpers(w);
    expect(h.readLocalHandles({ handles: [{ handle: "uuid" }, {}] })).toEqual(["uuid", undefined]);
    expect(() => h.readLocalHandles({ handles: [{ handle: 3 }] })).toThrow("could not be read");
    expect(h.readLocalCallSignature({ callSignature: { params: [], schemes: [{}] } })).toEqual({ params: [], schemes: [{}] });
    expect(() => h.readLocalCallSignature({ callSignature: { params: [] } })).toThrow("could not be read");
  });
});

describe("B4 wave 4 lane H: Home's function lookups read a Local reader's worker answers", () => {
  const ops = section(homeSource, "function itemExpression(", "function itemFenelSource(");
  const entry = section(homeSource, "function inspectionFunctionEntry(", "function FunctionInspectionSignature(");
  const fn = { id: "tab:double", params: [], returns: { $ref: "Number" } };
  function mount(w, published) {
    const lookups = { fn: id => id === "tab:double" ? fn : undefined, entry: () => undefined, entityType: () => undefined };
    const reader = { ...w.reader, catalogLookups: lookups };
    const deps = { readLocusCatalogReference: value => value && typeof value === "object" && value.$catalog ? { id: value.$catalog } : undefined,
      resolveLocusCatalogReference, resolveExpr: item => item.expr, expressionForTransfer: () => { throw new Error("transfer"); },
      classifyData: () => "x", authoringStructureEnvironment: session => published ?? session.environment,
      publishedAuthoringEnvironment: () => published, homeAuthoringSession: () => w.session };
    return { reader, ...run(ops + entry, deps, ["itemFunction", "inspectionFunctionEntry"]) };
  }
  test("itemFunction: the worker catalogue's function; the page registry is never read", () => {
    const w = world(), m = mount(w, { getFunctionEntry: () => undefined });
    const item = { expr: { kind: "literal", value: { $catalog: "tab:double" } } };
    expect(m.itemFunction(item, new Map(), w.session, undefined, m.reader)).toBe(fn);
    expect(w.pageReads).toEqual([]);
  });
  test("inspectionFunctionEntry: a Local session's own catalogue entry and environment; the page registry is never read", () => {
    const w = world();
    const local = { mode: "detached", catalog: { functions: [{ id: "other" }, { id: "x", targetId: "tab:double", label: "Double" }] } };
    for (const key of ["registry", "evaluateContext", "environment"]) Object.defineProperty(local, key, { get() {
      w.pageReads.push(`local.${key}`); throw new Error(`Page ${key} read`); } });
    const published = { getFunctionEntry: id => ({ id, kind: "function", scheme: { quantified: [], body: { $arrow: { params: [], returns: { $ref: "Number" } } } } }) };
    const m = mount(w, published);
    expect(m.inspectionFunctionEntry(fn, local)).toEqual({ id: "x", targetId: "tab:double", label: "Double" });
    const missing = { id: "tab:missing", params: [], returns: { $ref: "Number" } };
    expect(m.inspectionFunctionEntry(missing, local)).toMatchObject({ id: "tab:missing", kind: "function", label: "" });
    expect(w.pageReads).toEqual([]);
  });
});

describe("B4 wave 4 lane H: Home's Local sites no longer read the page registry or frame", () => {
  // The census rows of this lane, by their production text.
  const sites = [
    ["the lens subject's type handle", "  const subjectTypeName = () =>", "  function presentedRow()", ["reader?.registry().getUuid(name)"]],
    ["a function card's signature", "function FunctionPinCard(", "  // Pin objects carry the codeName slug", ["reader.catalogLookups.fn(props.pin.id)"]],
    ["the new function's return type guard", "  function guardReturnType(next: FenelType) {", "  function changeReturnType(", ["localSignature.hold("]],
    ["the new function's parameter guard", "  function guardParameterFields(next: readonly FieldDef[]) {", "  // In-scope params for ExpressionEditor", ["localSignature.follow(", "localSignature.hold("]],
    ["Browse's value half", "  const searchResult = createSlicedSearch({", "  const drawerSavedMatches", ["localValueSearch(reader"]],
    ["the Call form's parameter types", "  const resolvedParams = createMemo(() => {", "  const callExpr = createMemo", ["localCallSignature.answer()"]],
  ];
  for (const [label, start, end, markers] of sites) test(label, () => {
    const code = section(homeSource, start, end);
    for (const marker of markers) expect(code).toContain(marker);
  });
});

describe("B4 wave 4 lane H (continuation): a Local card's code prints in its worker", () => {
  const code = section(homeSource, "function itemExpression(", "/** B4 unit D item 2: one `infer-function-draft` reply");
  const fn = { id: "tab:double", params: [{ name: "n" }], returns: { $ref: "Number" }, body: { "*": [{ var: "n" }, 2] } };
  const native = { id: "tab:native", params: [], returns: { $ref: "Number" } };
  function mount(w, prints) {
    const lookups = { fn: id => id === "tab:double" ? fn : id === "tab:native" ? native : undefined, entry: () => undefined, entityType: () => undefined };
    const reader = { ...w.reader, catalogLookups: lookups };
    const deps = { readLocusCatalogReference: value => value && typeof value === "object" && value.$catalog ? { id: value.$catalog } : undefined,
      resolveLocusCatalogReference, resolveExpr: item => item.expr, expressionForTransfer: () => { throw new Error("transfer"); },
      classifyData: () => "x", authoringStructureEnvironment: session => session.environment, homeAuthoringSession: () => w.session,
      // The structure-environment codec (it reads no page registry or frame).
      logicToExprNode: (logic, params) => ({ kind: "raised", logic, params }), createMemo: compute => compute,
      createLocalExpressionPrint: (_reader, _session, request) => ({ print: () => { const current = request(); prints.push(current); return current && w.printed; } }) };
    return { reader, ...run(code, deps, ["createLocalItemSource", "LOCAL_CODE_PENDING"]) };
  }
  test("closed asks nothing; pending shows the pending line, never a failure; the answer shows with its header comments", () => {
    const w = world(), prints = [], m = mount(w, prints);
    let open = false;
    const item = { expr: { kind: "literal", value: { $catalog: "tab:double" } } };
    const text = m.createLocalItemSource(m.reader, () => w.session, () => open, () => ({ item, saved: new Map() }));
    expect(text()).toBe("");
    expect(prints).toEqual([]);
    open = true;
    expect(text()).toBe(m.LOCAL_CODE_PENDING);
    expect(prints.at(-1)).toMatchObject({ node: { kind: "raised", logic: fn.body, params: ["n"] }, boundNames: ["n"], presentation: "inspection" });
    w.printed = { $tag: "Ok", _0: { text: "n * 2", readable: true } };
    expect(text()).toBe("-- Parameters: n\nn * 2");
    w.printed = { $tag: "Err", _0: "The printer refused." };
    expect(text()).toBe("-- could not print this data as Fenel: The printer refused.");
    expect(w.pageReads).toEqual([]);
  });
  test("a native function and an unresolved card answer at once; other readers print on the page", () => {
    const w = world(), prints = [], m = mount(w, prints);
    const native = m.createLocalItemSource(m.reader, () => w.session, () => true,
      () => ({ item: { expr: { kind: "literal", value: { $catalog: "tab:native" } } }, saved: new Map() }));
    expect(native()).toBe("-- This function is a native declaration; it has no Fenel body.");
    const missing = m.createLocalItemSource(m.reader, () => w.session, () => true, () => ({ item: { expr: null }, saved: new Map() }));
    expect(missing()).toBe("-- this card's reference resolved to nothing");
    expect(m.createLocalItemSource({ kind: "account" }, () => w.session, () => true, () => ({}))).toBeUndefined();
    expect(prints.filter(Boolean)).toEqual([]);
    expect(w.pageReads).toEqual([]);
  });
});

describe("B4 wave 4 lane H (continuation): value scope references and breadcrumb icons ask the worker", () => {
  test("settle: every reference the path reads is asked, then the computation runs on the answers", async () => {
    const w = world(), h = helpers(w);
    const live = { fn: () => { throw new Error("live lookup during settle"); }, entry: () => undefined, entityType: () => undefined };
    const resolver = h.localReferenceResolver({ ...w.reader, catalogLookups: live }, () => w.session);
    let runs = 0;
    const done = resolver.settle(() => { runs++; return [resolver.resolve({ id: "tab:double" }), resolver.resolve({ id: "Point", kind: "type" })]; });
    await settle();
    expect(w.requests[0].payload).toEqual({ method: "project-reader-references", targets: ["tab:double", "Point"] });
    const fn = { id: "tab:double", params: [], returns: { $ref: "Number" } };
    await w.answer(0, { references: [{ target: "tab:double", reference: { fn } }, { target: "Point", reference: { entityType: { $record: { fields: [] } } } }] });
    expect(await done).toEqual([{ value: fn, kind: "function" }, { value: { $record: { fields: [] } }, kind: "type" }]);
    expect(runs).toBe(2);
    expect(w.pageReads).toEqual([]);
  });
  test("a path that refuses an unanswered reference asks the worker instead of failing (a Local type's own page)", async () => {
    // Home's follow: `followLocusPath` throws "not available in this account"
    // when a reference resolves to nothing. A Local type card holds `{ $ref }`
    // to the type's handle, which the display catalogue does not list: the
    // first round must ask the worker, not surface that refusal.
    const w = world(), h = helpers(w);
    const live = { fn: () => { throw new Error("live lookup during settle"); }, entry: () => undefined, entityType: () => undefined };
    const resolver = h.localReferenceResolver({ ...w.reader, catalogLookups: live }, () => w.session);
    const type = { $record: { fields: [] } };
    const done = resolver.settle(() => followLocusPath({ $ref: "pet-handle" }, [], resolver.resolve));
    await settle();
    expect(w.requests.map(request => request.payload)).toEqual([{ method: "project-reader-references", targets: ["pet-handle"] }]);
    await w.answer(0, { references: [{ target: "pet-handle", reference: { entityType: type } }] });
    expect(await done).toEqual({ value: type, followed: true, references: [{ id: "pet-handle" }] });
    expect(w.pageReads).toEqual([]);
  });
  test("a reference the worker cannot answer still refuses after it was asked; a refusal with nothing to ask is immediate", async () => {
    const w = world(), h = helpers(w);
    const live = { fn: () => undefined, entry: () => undefined, entityType: () => undefined };
    const resolver = h.localReferenceResolver({ ...w.reader, catalogLookups: live }, () => w.session);
    const done = resolver.settle(() => followLocusPath({ $ref: "private" }, [], resolver.resolve));
    const outcome = done.then(() => "resolved", error => error.message);
    await settle();
    expect(w.requests.map(request => request.payload)).toEqual([{ method: "project-reader-references", targets: ["private"] }]);
    await w.answer(0, { references: [{ target: "private" }] });
    expect(await outcome).toMatch(/not available in this account/);
    await expect(resolver.settle(() => { throw new Error("unrelated refusal"); })).rejects.toThrow("unrelated refusal");
    expect(w.requests).toHaveLength(1);
  });
  test("a field icon is asked once per worker snapshot, then shown; pending shows none", async () => {
    const w = world(), h = helpers(w);
    expect(h.localFieldIcon(w.reader, w.session, "field-1")).toBeUndefined();
    expect(h.localFieldIcon(w.reader, w.session, "field-1")).toBeUndefined();
    await settle();
    expect(w.requests.map(r => r.payload)).toEqual([{ method: "project-reader-call-signature", fieldIcons: ["field-1"], priority: "guidance" }]);
    await w.answer(0, { fieldIcons: [{ icon: "mail" }] });
    expect(h.localFieldIcon(w.reader, w.session, "field-1")).toBe("mail");
    expect(w.pageReads).toEqual([]);
  });
});

describe("B4 wave 4 lane H (IO cards): a Local IO call's arguments are evaluated in the reader's worker", () => {
  const ioHelpers = (w, evaluations, prepared = true) => run(helperCode(), { createSignal, untrack, runLocalReaderAction: w.client.runLocalReaderAction,
    readActionResult: w.client.readActionResult, LOCAL_ACTION_CHANGED: w.client.LOCAL_ACTION_CHANGED,
    LOCAL_SAVE_TOOLS_PENDING: TOOLS, LOCAL_SAVE_CHANGED: CHANGED, draftValueFingerprint: JSON.stringify,
    authoringWorkerSnapshot: () => w.snapshot, resolveLocusCatalogReference,
    evaluateExpressionInWorker: (session, node, saved, signal, scope, options) => {
      if (!prepared) return undefined;
      const held = deferred();
      evaluations.push({ session, node, saved, options, ...held });
      return held.promise;
    } }, ["localIOArgument"]);
  test("Run evaluates each argument in the worker with invocations admitted, then invokes with its values; the page session is never read", async () => {
    const { createIOCallController } = await import("../io-call-controller");
    const w = world(), evaluations = [], invoked = [];
    const h = ioHelpers(w, evaluations);
    const args = [{ kind: "literal", value: "token" }, { kind: "call", fnId: "std.concat", args: [] }];
    const controller = createIOCallController({ info: () => ({ fnId: "telegram.start", args }),
      evaluate: arg => h.localIOArgument(w.session, arg, new Map()),
      invoke: async (fnId, values, mode) => { invoked.push({ fnId, values, mode }); return { ok: true, value: "deployment-1" }; } });
    const done = controller.dispatch("run");
    await settle();
    flush();
    expect(controller.state()).toEqual({ kind: "running" });
    expect(evaluations.map(e => [e.session, e.node, e.options])).toEqual([[w.session, args[0], { admitInvocations: true }], [w.session, args[1], { admitInvocations: true }]]);
    expect(invoked).toEqual([]);
    evaluations[0].resolve({ result: "token" });
    evaluations[1].resolve({ result: "abc" });
    await done;
    flush();
    expect(invoked).toEqual([{ fnId: "telegram.start", values: ["token", "abc"], mode: "run" }]);
    expect(controller.state()).toEqual({ kind: "success", value: "deployment-1" });
    expect(w.pageReads).toEqual([]);
  });
  test("a worker refusal or a missing worker is the Run's error, with its own or the existing copy; nothing is invoked", async () => {
    const { createIOCallController } = await import("../io-call-controller");
    const w = world(), evaluations = [], invoked = [];
    const refuse = ioHelpers(w, evaluations), none = ioHelpers(w, [], false);
    for (const [h, expected] of [[refuse, "The call could not be evaluated."], [none, TOOLS]]) {
      const controller = createIOCallController({ info: () => ({ fnId: "telegram.start", args: [{ kind: "literal", value: 1 }] }),
        evaluate: arg => h.localIOArgument(w.session, arg, new Map()),
        invoke: async (...call) => { invoked.push(call); return { ok: true }; } });
      const done = controller.dispatch("run");
      await settle();
      if (h === refuse) evaluations[0].reject(new Error("The call could not be evaluated."));
      await done;
      flush();
      expect(controller.state()).toEqual({ kind: "error", message: expected });
    }
    expect(invoked).toEqual([]);
    expect(w.pageReads).toEqual([]);
  });
  test("both IO card surfaces route a Local reader's Run and live status through the worker", () => {
    const surface = section(homeSource, "function useIOCallSurface(", "  async function confirmAndRunIOCall()");
    const canvas = section(homeSource, "function CanvasItemView(", "  // Read this card as Fenel source instead of as its value.");
    for (const code of [surface, canvas]) {
      expect(code).toContain('if (reader?.kind === "local") return localIOArgument(homeAuthoringSession(), arg, props.savedExprById);');
    }
    const live = homeSource.split("  async function refreshLive() {").slice(1).map(rest => rest.slice(0, rest.indexOf("api.getIOInstances")));
    expect(live).toHaveLength(2);
    for (const code of live) expect(code).toContain('localIOArgument(homeAuthoringSession(), a, props.savedExprById, "guidance")');
  });
});
