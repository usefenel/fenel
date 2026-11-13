import { describe, expect, test } from "bun:test";
import { compiled, homeSource, section, localWorld, settle } from "./local-save-admission.fixture.mjs";

// B4 slice 1: Home's Save-time admission for a Local reader. Each Save site's
// production body is extracted unchanged from Home. The page session of the
// Local reader throws on every registry/evaluator read, and every page
// semantic adapter records a call: a site decides from its worker or refuses.
const writeValueScopeCode = section(homeSource, "  async function writeValueScopeExpression(", "  /** The names the breadcrumb");
const savedItemCallbackCode = section(homeSource,
  "            onSaveItem={async (item, expr, definitionBundle, occurrenceChanged = true, assertCurrent, signal) => {", "\n            onClose=")
  .trim().replace(/^onSaveItem=\{/, "").slice(0, -1);
const composerModal = section(homeSource, "function NewValueModal(", "// NewTypeModal");
const nestedAddCode = section(composerModal, "      const add: typeof addToLocus = async (value, caption, hint) => {", "\n      setDestination({")
  .trim().replace(/^const add: typeof addToLocus = /, "").replace(/;$/, "");
const composerSaveCode = section(composerModal, "  async function save() {", "\n  function toggleComposerPresentation()");

const literal = value => ({ kind: "literal", value });
const clone = value => structuredClone(value);

function pageAdapters() {
  const calls = [];
  return { calls,
    draftSaveIssue: () => { calls.push("draftSaveIssue"); return "page refusal"; },
    evaluateAuthoringExpression: () => { calls.push("evaluate"); return { result: "page value" }; } };
}

// Site A: an edit inside a value (value scope write-back).
function valueScopeSite(world, options = {}) {
  const page = pageAdapters(), writes = [];
  let rootRevision = 7;
  const controller = new AbortController();
  const saved = new Map([["saved-source", literal(2)]]);
  const imports = { props: { publicData: undefined }, reader: world.reader, client: { signal: controller.signal },
    transferSession: world.reader.session, savedExprById: () => saved, localExpressionSaveIssue: world.localExpressionSaveIssue,
    draftSaveIssue: page.draftSaveIssue, evaluateAuthoringExpression: page.evaluateAuthoringExpression,
    assertCurrentSession: captured => world.imports.assertCurrentSession(captured), assertSourceTicket: ticket => { if (ticket !== "ticket") throw new Error("Stale ticket"); },
    scopeKey: value => value, scope: () => "value-scope", current: () => ({ id: "row" }), root: () => ({ revision: rootRevision }),
    homeData: { type: () => ({ $ref: "Declared" }), replace: async (...args) => { writes.push(clone(args.slice(0, 2))); } } };
  const write = new Function(...Object.keys(imports), `${compiled(writeValueScopeCode)}; return writeValueScopeExpression;`)(...Object.values(imports));
  const state = { epoch: 1, sourceTicket: "ticket", scopeIdentity: "value-scope", row: { id: "row" }, rootRevision: 7,
    followedReference: false, item: { id: "card", valueType: options.valueType ?? { $ref: "Number" } } };
  return { page, writes, saved, controller, run: expr => write(state, expr), changeRoot: () => { rootRevision++; } };
}

// Site B: Browse opens a saved value standalone; its Save checks the value.
function savedValueSite(world) {
  const page = pageAdapters(), writes = [];
  const controller = new AbortController();
  const query = { kind: "expression", expr: literal(1), valueType: { $ref: "Number" } };
  const saved = new Map([["saved-id", literal(1)]]);
  const imports = { state: { standalone: "saved", sourceTicket: "ticket", rootRevision: 3, expectedSavedQuery: query },
    sessionEpoch: world.imports.sessionEpoch, assertSourceTicket: ticket => { if (ticket !== "ticket") throw new Error("Stale ticket"); },
    rootSourceTicket: () => "ticket", root: () => ({ revision: 3 }), client: {}, enqueueRootWrite: async action => action(),
    assertCurrentSession: world.imports.assertCurrentSession, acknowledgeRootRevision: () => {}, revalidate: () => {},
    refresh: async () => {}, all: () => ({}), savedAll: () => ({ queries: [{ id: "saved-id", query }] }),
    homeAuthoringSession: world.reader.session, reader: world.reader, localExpressionSaveIssue: world.localExpressionSaveIssue,
    draftSaveIssue: page.draftSaveIssue, savedExprById: () => saved,
    api: { savedQueryUpdate: async (...args) => { writes.push(clone(args)); return {}; } },
    homeData: { replace: async () => { throw new Error("Unplanned occurrence write"); } } };
  const callback = new Function(...Object.keys(imports), compiled(`return (${savedItemCallbackCode});`))(...Object.values(imports));
  const item = { id: "browse:saved:saved-id", source: { kind: "ref", ref: { kind: "savedExpr", id: "saved-id" } } };
  return { page, writes, saved, controller, run: expr => callback(item, expr, undefined, true, undefined, controller.signal) };
}

// Site D: creating data inside a value's collection appends a reference to it.
function nestedAppendSite(world) {
  const page = pageAdapters(), writes = [];
  const list = literal([literal(1)]);
  const latest = { id: "root", canEdit: true, revision: 5, lists: [], expressions: {},
    items: [{ id: "owner", valueType: { $ref: "Numbers" }, source: { kind: "expr", expr: list } }] };
  let dismissed = false;
  const controller = new AbortController();
  const imports = {
    assertCurrent: () => { if (dismissed) throw new Error("The creation dialog was closed."); },
    selected: { kind: "list", rootId: "root" }, nested: { rootItem: true, itemId: "owner", viewId: "root", path: [] },
    locusReaderWrites: () => ({ enqueue: action => action() }), addToLocus: async () => { throw new Error("Unplanned root add"); },
    occurrenceId: "occurrence", runtime: world.reader, assertSource: undefined, createdValueId: undefined,
    source: { client: { drafts: undefined, signal: controller.signal, getLocusRoot: { uncached: async () => ({ root: latest }) },
      getSavedQueries: { uncached: async () => ({ queries: [] }) }, revalidate: () => {},
      editLocusRoot: async (...args) => { writes.push(clone(args)); return {}; }, api: {} } },
    shareSavedExpressionMap: () => new Map([["created-id", literal(2)]]),
    findLocusItem: (items, id) => items.find(item => item.id === id), resolveExpr: item => item.source.expr,
    editableContainerAt: () => true, expressionMentions: () => ({ refs: [] }), expressionAt: expression => expression,
    appendExpressionAt: (expression, _path, value) => literal([...expression.value, value]), updateItemInView: () => { throw new Error("Unplanned view write"); },
    evaluateAuthoringExpression: page.evaluateAuthoringExpression, draftSaveIssue: page.draftSaveIssue,
    localExpressionSaveIssue: world.localExpressionSaveIssue, LOCAL_SAVE_CHANGED: world.LOCAL_SAVE_CHANGED,
    LOCAL_SAVE_DRAFT_CHANGED: world.LOCAL_SAVE_DRAFT_CHANGED, saveController: undefined,
    draftScope: { surface: "composer" },
  };
  const add = new Function(...Object.keys(imports), compiled(`return (${nestedAddCode});`))(...Object.values(imports));
  return { page, writes, controller, dismiss: () => { dismissed = true; }, run: () => add({ savedExprId: "created-id" }, "Created") };
}

// Site E: the creation composer places new data into its chosen list.
function composerSite(world) {
  const page = pageAdapters(), writes = [], errors = [];
  let draft = { kind: "call", fnId: "user:make", args: [literal(2)] };
  let dismissed = false;
  const root = { id: "root", canEdit: true, revision: 2, expressions: {},
    lists: [{ id: "list", valueType: { $ref: "Scores" } }], items: [] };
  const target = { place: { kind: "list", rootId: "root", listId: "list" }, reader: world.reader,
    client: { drafts: undefined, getLocusRoot: { uncached: async () => ({ root }) }, getSavedQueries: { uncached: async () => ({ queries: [] }) },
      api: { savedQueryCreate: async payload => { writes.push(clone(payload)); return { query: { id: "created-id", query: payload.query } }; } },
      revalidate: () => {} },
    assertCurrent: () => { if (dismissed) throw new Error("The creation dialog was closed."); } };
  const imports = {
    dismissed: false, saveInFlight: false, saveController: undefined, submissionStarted: false,
    scopeGeneration: 0, creationEpoch: world.imports.sessionEpoch(), sessionEpoch: world.imports.sessionEpoch,
    createdValueId: undefined, createdValueQuery: undefined, creationOccurrence: { id: "occurrence" },
    draftIssue: () => undefined, setSaveError: value => { errors.push(value); }, setSaving: () => {},
    // Demo 1 (Nov 8): the simple form's Create-attempt and refusal marks.
    setCreateTried: () => {}, setCheckRefusal: () => {},
    setUncertainSubmission: () => {}, name: () => "", description: () => "", reps: () => ({}), newValueSlug: () => "slug",
    destination: () => target, origin: { client: target.client }, cloneDraftValue: clone, draft: () => draft,
    expectedType: () => undefined, initialCreation: { pane: undefined }, shareSavedExpressionMap: () => new Map(),
    listRefs: () => [], draftValueFingerprint: JSON.stringify, savedCtx: { byId: () => undefined, list: () => [] },
    peelListForAuthoring: type => type?.$list ? { elem: type.$list } : undefined,
    resolveValueType: (type, resolve) => type.$ref ? resolve(type.$ref) ?? type : type,
    authoringSession: world.reader.session, localExpressionSaveIssue: world.localExpressionSaveIssue, LOCAL_SAVE_CHANGED: world.LOCAL_SAVE_CHANGED,
    // B4 slice 2: Save asks the draft check (the page's draftIssue inputs) first.
    guidanceReader: () => target.reader, draftPrecondition: () => undefined, chosenType: () => "Score", creationTypeName: () => "Score", draftScope: { surface: "composer" },
    composerGuidance: { cancel: () => { writes.push("guidance cancelled"); } },
    LOCAL_SAVE_DRAFT_CHANGED: world.LOCAL_SAVE_DRAFT_CHANGED,
    evaluateAuthoringExpression: page.evaluateAuthoringExpression, draftSaveIssue: page.draftSaveIssue,
    assertAppearanceDrafts: () => {}, props: { placement: undefined }, retainDraft: () => {},
    persistRepresentation: async () => {}, locusAdd: async (...args) => { writes.push({ added: clone(args.slice(0, 2)) }); return true; },
    temporaryEdits: () => true, close: () => { writes.push("closed"); },
  };
  const save = new Function(...Object.keys(imports), `${compiled(composerSaveCode)}; return save;`)(...Object.values(imports));
  return { page, writes: { get length() { return writes.filter(row => row !== "guidance cancelled").length; },
      toJSON: () => writes.filter(row => row !== "guidance cancelled") }, allWrites: writes, errors, run: () => save(),
    edit: () => { draft = literal("edited while checking"); },
    dismiss: () => { dismissed = true; }, draft: () => draft };
}

const sites = [
  { name: "value scope edit", make: valueScopeSite, evaluate: true, expectedType: { $ref: "Number" },
    start: h => h.run(literal(3)), writes: 1 },
  { name: "standalone saved value", make: savedValueSite, evaluate: undefined, expectedType: { $ref: "Number" },
    start: h => h.run(literal(3)), writes: 1 },
  { name: "append into a nested collection", make: nestedAppendSite, evaluate: true, expectedType: { $ref: "Numbers" },
    start: h => h.run(), writes: 1 },
  // `Scores` is an alias only the worker's Local registry knows: the reader's
  // inert `resolveTypeName` misses it, so the page must send the list type.
  { name: "composer placement", make: composerSite, evaluate: true, expectedType: undefined, expectedListType: { $ref: "Scores" },
    worldOptions: { types: {} }, start: h => h.run(), writes: 3,
    // Request 0 is the draft check (B4 slice 2), admitted here; 1 is placement.
    first: 1, prelude: async world => { await settle(); await world.answer(0, {}); } },
];

describe("Local Save sites decide from the reader's worker", () => {
  for (const site of sites) {
    test(`${site.name}: a worker refusal refuses Save without a page check or a write`, async () => {
      const world = localWorld(site.worldOptions), h = site.make(world);
      const flight = Promise.resolve(site.start(h)).then(() => undefined, error => error);
      await site.prelude?.(world);
      await settle();
      const first = site.first ?? 0;
      expect(world.requests).toHaveLength(first + 1);
      const request = world.requests[first];
      expect(request.session).toBe(world.session());
      expect(request.options.evaluate).toBe(site.evaluate);
      expect(request.options.expectedType).toEqual(site.expectedType);
      expect(request.options.expectedListType).toEqual(site.expectedListType);
      expect(request.options.sourceMetadata?.packet).toEqual({ generation: "metadata-one" });
      expect(request.signal).toBeInstanceOf(AbortSignal);
      await world.answer(first, { issue: "Finish with Number before saving." });
      const outcome = await flight;
      if (site.name === "composer placement") expect(h.errors.at(-1)).toBe("Finish with Number before saving.");
      else expect(outcome?.message).toBe("Finish with Number before saving.");
      expect(h.writes.length).toBe(0);
      expect(h.page.calls).toEqual([]);
      expect(world.pageReads).toEqual([]);
    });

    test(`${site.name}: a worker admission proceeds to the existing write`, async () => {
      const world = localWorld(site.worldOptions), h = site.make(world);
      const flight = Promise.resolve(site.start(h));
      await site.prelude?.(world);
      await settle();
      await world.answer(site.first ?? 0, {});
      await flight;
      expect(h.writes.length).toBe(site.writes);
      expect(h.page.calls).toEqual([]);
      expect(world.pageReads).toEqual([]);
    });

    test(`${site.name}: a reader revision bump during the check refuses and persists nothing`, async () => {
      const world = localWorld(site.worldOptions), h = site.make(world);
      const flight = Promise.resolve(site.start(h)).then(() => undefined, error => error);
      await site.prelude?.(world);
      await settle();
      world.bumpRevision();
      await world.answer(site.first ?? 0, {});
      const outcome = await flight;
      const message = site.name === "composer placement" ? h.errors.at(-1) : outcome?.message;
      expect(message).toBe(world.LOCAL_SAVE_CHANGED);
      expect(h.writes.length).toBe(0);
      expect(h.page.calls).toEqual([]);
    });

    test(`${site.name}: a closed worker or a worker failure refuses with no page call`, async () => {
      for (const mode of ["closed", "missing", "failure"]) {
        const world = localWorld({ ...site.worldOptions, missingWorker: mode === "missing" }), h = site.make(world);
        if (mode === "closed") world.closeWorker();
        const flight = Promise.resolve(site.start(h)).then(() => undefined, error => error);
        if (mode === "failure") await site.prelude?.(world);
        await settle();
        const first = site.first ?? 0;
        if (mode === "failure") { expect(world.requests).toHaveLength(first + 1); await world.fail(first, new Error("The operation took too long. Try again with less data.")); }
        else expect(world.requests).toHaveLength(mode === "missing" ? 0 : 0);
        const outcome = await flight;
        const message = site.name === "composer placement" ? h.errors.at(-1) : outcome?.message;
        expect(message).toBe(mode === "failure" ? "The operation took too long. Try again with less data." : world.LOCAL_SAVE_TOOLS_PENDING);
        expect(h.writes.length).toBe(0);
        expect(h.page.calls).toEqual([]);
        expect(world.pageReads).toEqual([]);
      }
    });
  }

  test("a draft edited during the composer check refuses and keeps the newer draft", async () => {
    const world = localWorld(sites[3].worldOptions), h = composerSite(world);
    const flight = h.run();
    await sites[3].prelude(world);
    await settle();
    h.edit();
    await world.answer(1, {});
    await flight;
    expect(h.errors.at(-1)).toBe("The draft changed while it was being checked. Save again.");
    expect(h.draft()).toEqual(literal("edited while checking"));
    expect(h.writes.length).toBe(0);
  });

  test("B4 slice 2: the composer's Save first cancels its guidance, then checks the draft with the page's inputs", async () => {
    const world = localWorld(sites[3].worldOptions), h = composerSite(world);
    const flight = h.run();
    await settle();
    expect(h.allWrites).toEqual(["guidance cancelled"]);
    expect(world.requests).toHaveLength(1);
    expect(world.requests[0].options).toMatchObject({ expectedTypeName: "Score", evaluate: true });
    expect(world.requests[0].options.priority).toBeUndefined();
    await world.answer(0, { issue: "Finish with Score before saving." });
    await flight;
    expect(h.errors.at(-1)).toBe("Finish with Score before saving.");
    // A refused draft check sends no placement and writes nothing.
    expect(world.requests).toHaveLength(1);
    expect(h.writes.length).toBe(0);
    expect(h.page.calls).toEqual([]);
    expect(world.pageReads).toEqual([]);
  });

  test("a dismissed nested creation refuses after the reply and writes nothing", async () => {
    const world = localWorld(), h = nestedAppendSite(world);
    const flight = h.run().then(() => undefined, error => error);
    await settle();
    h.dismiss();
    await world.answer(0, {});
    expect((await flight)?.message).toBe("The creation dialog was closed.");
    expect(h.writes).toEqual([]);
  });

  test("a value scope edit refuses when its root moved, a replaced worker or session, or changed metadata", async () => {
    for (const change of ["root", "worker", "session", "metadata", "epoch"]) {
      const world = localWorld(), h = valueScopeSite(world);
      const flight = h.run(literal(3)).then(() => undefined, error => error);
      await settle();
      if (change === "root") h.changeRoot();
      if (change === "worker") world.replaceWorker();
      if (change === "session") world.replaceSession();
      if (change === "metadata") world.changeMetadata();
      if (change === "epoch") world.bumpEpoch();
      await world.answer(0, {});
      const outcome = await flight;
      expect(outcome).toBeInstanceOf(Error);
      if (change === "worker" || change === "session")
        expect(outcome.message).toBe("This reader's editing tools are not ready. Try again after preparation.");
      expect(h.writes).toEqual([]);
      expect(h.page.calls).toEqual([]);
    }
  });

  test("a value that cannot cross to the worker refuses with a plain sentence", async () => {
    const world = localWorld(), h = valueScopeSite(world);
    const flight = h.run(literal(3)).then(() => undefined, error => error);
    await settle();
    await world.fail(0, new DOMException("#<Object> could not be cloned.", "DataCloneError"));
    expect((await flight)?.message).toBe("This value cannot be checked for saving.");
    expect(h.writes).toEqual([]);
  });

  test("aborting the Save's signal before the reply refuses without a write", async () => {
    const world = localWorld(), h = valueScopeSite(world);
    const flight = h.run(literal(3)).then(() => undefined, error => error);
    await settle();
    h.controller.abort(new Error("The reader closed."));
    await world.answer(0, {});
    expect((await flight)?.message).toBe("The reader closed.");
    expect(h.writes).toEqual([]);
  });
});

describe("Save admission is sent only from Save handlers", () => {
  test("all eight Local write admissions stay in write handlers, never in a memo or a mount", () => {
    const definition = homeSource.indexOf("async function localExpressionSaveIssue(") + "async function ".length;
    const occurrences = [...homeSource.matchAll(/localExpressionSaveIssue\(/g)].map(match => match.index);
    expect(occurrences.filter(index => index === definition)).toHaveLength(1);
    // The declaration is not a call. The eighth real call belongs to the
    // canonical inline field write, which checks before homeData.replace.
    const calls = occurrences.filter(index => index !== definition);
    const handlers = [
      section(homeSource, "  async function editFieldAt(", "\n  const [linkedDemoAdding"),
      section(homeSource, "  async function writeValueScopeExpression(", "  /** The names the breadcrumb"),
      section(homeSource, "            onSaveItem={async (item, expr", "\n            onClose="),
      section(homeSource, "function EditModalContent(", "// NewValueModal"),
      nestedAddCode, composerSaveCode,
      // B4 slice 2: Inspection's Save.
      section(homeSource, "  async function saveChanges() {", "\n  return <div class=\"data-inspection-expression\">"),
    ];
    const inside = index => handlers.some(code => { const start = homeSource.indexOf(code); return index >= start && index < start + code.length; });
    expect(calls.length).toBe(8);
    for (const index of calls) expect(inside(index)).toBe(true);
    // Inside the editor, only its save() sends the admission.
    const editor = section(homeSource, "function EditModalContent(", "// NewValueModal");
    const editorSave = section(editor, "  async function save() {", "\n  return (");
    expect(editor.split("localExpressionSaveIssue(").length).toBe(editorSave.split("localExpressionSaveIssue(").length);
    // Save admission reaches the worker client only through the checked helper.
    // B4 slice 2: the other direct calls are live guidance sends (guidance
    // priority, never admission) and the composer's explicit Preview.
    const helper = section(homeSource, "async function localExpressionSaveIssue(", "function localSaveIssueOptions(");
    const guidance = [
      section(homeSource, "  // B4 slice 2: a Local reader's Inspection check runs in its worker", "  const draftIssue = createMemo("),
      section(homeSource, "  async function localCallVerdict(", "  const callGuidance ="),
      section(homeSource, "  async function previewLocalDraft(", "  // B4 slice 2: a Local reader's live evaluation"),
      // B4 fix round 2: the composer's guidance checks an incomplete draft.
      section(homeSource, "  const composerGuidance = createLocalLiveGuidance", "  onCleanup(() => composerGuidance.dispose());"),
    ];
    const direct = [...homeSource.matchAll(/expressionSaveIssueInWorker\(/g)].map(match => match.index);
    expect(direct).toHaveLength(5);
    for (const index of direct) expect([helper, ...guidance].some(code => {
      const start = homeSource.indexOf(code); return index >= start && index < start + code.length;
    })).toBe(true);
  });

  test("mounting the creation composer sends no expression-save-issue request", () => {
    // The composer's memos and mount effects are the code outside save().
    // B4 slice 2: the explicit Preview handler is a user request, not a mount.
    const previewCode = section(composerModal, "  async function previewLocalDraft(", "  // B4 slice 2: a Local reader's live evaluation");
    // Live guidance sends at guidance priority (never admission); the live
    // guidance tests pin that nothing is sent at mount for an incomplete draft.
    const guidanceSend = section(composerModal, "  const composerGuidance = createLocalLiveGuidance", "  onCleanup(() => composerGuidance.dispose());");
    expect(guidanceSend).toContain('priority: "guidance"');
    const outsideSave = composerModal.replace(composerSaveCode, "").replace(nestedAddCode, "").replace(previewCode, "").replace(guidanceSend, "");
    expect(outsideSave).not.toContain("localExpressionSaveIssue(");
    expect(outsideSave).not.toContain("expressionSaveIssueInWorker(");
    expect(outsideSave).not.toContain("expression-save-issue");
  });
});
