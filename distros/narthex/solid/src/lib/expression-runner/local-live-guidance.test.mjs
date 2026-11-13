// Run with: bun test --conditions=browser --conditions=development ./src/lib/expression-runner/local-live-guidance.test.mjs
import { describe, expect, test } from "bun:test";
import { createEffect, createMemo, createProjection, createRoot, createSignal, flush, onCleanup, snapshot, untrack } from "solid-js";
import { compiled, homeSource, section, localWorld, settle as settleFixture } from "./local-save-admission.fixture.mjs";
import { readableIdentities } from "../readable-ids";
import { constructForm } from "./simple-data-form-model";
import { createGuidanceLane, createLiveGuidance, draftCheckReaderKey, draftChecksPending, holdDraftCheck, localDraftChecksPending,
  openLiveGuidance, releaseDraftCheck } from "./live-guidance";
const callCaptureSource = (await Bun.file(new URL("./live-guidance-local.ts", import.meta.url)).text()).replaceAll("\r\n", "\n");
const callActionSource = (await Bun.file(new URL("./local-reader-actions.ts", import.meta.url)).text()).replaceAll("\r\n", "\n");
const hintsViewSource = (await Bun.file(new URL("../field-renderer/refinement-hints.tsx", import.meta.url)).text()).replaceAll("\r\n", "\n");
const hintsTooltipText = new Function(`${compiled(section(hintsViewSource, "export function hintBadge(", "/** Tracks whether focus"))}; return hintsTooltipText;`)();
// Stands in for unit C's lowering: a draft is complete when no slot is blank.
const blank = node => node?.kind === "literal" && node.value === undefined;
const completeLiveDraft = node => !blank(node) && !(node.kind === "call" && node.args.some(blank));
// B4 unit D item 2: Home's open-time completeness lowers in the worker
// (`openLocalLiveGuidance`, tested in local-reader-actions.test.mjs); these
// fixtures stand it in with the production opener and the same blank-slot rule.
const openLocalLiveGuidance = (guidance, _reader, _session, draft) =>
  openLiveGuidance(guidance, () => { const node = draft(); return !!node && completeLiveDraft(node); });

// B4 slice 2: each Local live-guidance surface's production code is extracted
// unchanged from Home and the expression editor. The page session throws on
// every registry/evaluator read, page semantic adapters record any call, the
// worker clients record requests answered explicitly here, and the scheduler
// is the production one with a controlled frame. The only page read allowed
// is unit C's text lowering (`toLogic`), which these fixtures stub.
const editorSource = (await Bun.file(new URL("./index.tsx", import.meta.url)).text()).replaceAll("\r\n", "\n");
const literal = value => ({ kind: "literal", value });
const call = (fnId, ...args) => ({ kind: "call", fnId, args });
const number = { $ref: "Number" };
async function settle() { for (let turn = 0; turn < 12; turn++) { await Promise.resolve(); flush(); } await settleFixture(); }
const deferred = () => {
  let resolve, reject;
  const promise = new Promise((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
};
class WorkerRequestError extends Error { constructor(message, code) { super(message); this.code = code; } }

/** The real open-time lowering/currentness owner, with only the worker and
 * canonical empty-slot fact controlled. No test-local seed walker or touch. */
function seedOpenOwner(g, incompleteNode) {
  const ports = { ...g.world.imports, untrack, createLiveGuidance,
    authoringExpressionHasEmptySlot: logic => logic === incompleteNode };
  const capture = new Function(...Object.keys(ports), compiled(callCaptureSource.slice(callCaptureSource.indexOf("export type LocalGuidanceCapture")))
    + "; return { localGuidanceCapture, localGuidanceCurrent, sameLocalGuidanceCapture, completeLiveDraft };")(...Object.values(ports));
  const imports = { ...capture, createEffect, createSignal, onCleanup, untrack, draftValueFingerprint: JSON.stringify,
    preparedReaderWorkerForSession: g.clients.preparedReaderWorkerForSession,
    runPreparedReaderWorker: g.clients.runPreparedReaderWorker,
    runAuthoringWorker: () => { throw new Error("Seed lowering must keep its prepared reader"); }, reachedSavedSources: () => [] };
  const actions = new Function(...Object.keys(imports), compiled(callActionSource.slice(callActionSource.indexOf("/** The existing Local refusal sentences")))
    + "; return { openLocalLiveGuidance };")(...Object.values(imports));
  return { ...actions, completeLiveDraft: capture.completeLiveDraft };
}

/** A held worker client per operation, and the production scheduler. */
function guidanceWorld(options = {}) {
  const world = localWorld({ localDraftChecksPending, ...options });
  const frames = [], requests = [], page = [];
  const record = method => (...args) => {
    const held = deferred();
    requests.push({ method, args, ...held });
    return held.promise;
  };
  const clients = {
    expressionSaveIssueInWorker: record("expression-save-issue"),
    evaluateExpressionInWorker: record("evaluate-expression"),
    inferExpressionsInWorker: record("infer-expression"),
    runPreparedReaderWorker: record("prepared"),
    preparedReaderWorkerForSession: () => ({ fixture: "handle" }),
  };
  const frame = callback => { frames.push(callback); return () => {}; };
  // `createLocalLiveGuidance` over the production `createLiveGuidance`; the
  // capture is the fixture worker token, which tests may replace.
  let token = { fixture: "capture" };
  const [captureVersion, setCaptureVersion] = createSignal(0);
  const createLocalLiveGuidance = (reader, session, send, guidanceOptions) => createLiveGuidance({
    capture: () => { captureVersion(); return reader()?.kind === "local"
      ? { facade: session(), token, revision: reader().revision(), sourceMetadata: undefined } : undefined; },
    sameCapture: (a, b) => a.token === b.token && a.revision === b.revision,
    current: capture => capture.token === token && capture.revision === reader()?.revision(),
    key: item => JSON.stringify(item), send, batch: guidanceOptions.batch, frame });
  const pageAdapters = {
    draftSaveIssue: () => { page.push("draftSaveIssue"); return "page refusal"; },
    functionBodySaveIssue: () => { page.push("functionBodySaveIssue"); return "page refusal"; },
    evaluateAuthoringExpression: () => { page.push("evaluate"); return { result: "page value", trace: [] }; },
    inferAuthoringExpressionWithLiteralWitnesses: () => { page.push("infer"); return { outcome: { $tag: "Solved" } }; },
    inferExpressionType: () => { page.push("inferExpressionType"); return number; },
    judgeResult: () => { page.push("judge"); return { mismatch: true, message: "page" }; },
  };
  return { world, frames, requests, page, clients, pageAdapters, createLocalLiveGuidance,
    replaceCapture: () => { token = { fixture: "capture-two" }; setCaptureVersion(value => value + 1); },
    publishValue: () => { world.bumpRevision(); world.changeMetadata(); setCaptureVersion(value => value + 1); },
    runFrame: async () => { for (const callback of frames.splice(0)) callback(); await settle(); },
    answer: async (index, value) => { requests[index].resolve(value); await settle(); },
    fail: async (index, error) => { requests[index].reject(error); await settle(); } };
}

describe("Inspection: live guidance and Save decide in the worker", () => {
  const inspection = section(homeSource, "  // B4 slice 2: a Local reader's Inspection check runs in its worker", "  const codeTypeEnv = createMemo(");
  // The controller now precedes its shared renderer. Extract only Save's
  // function, ending at the next controller member, rather than its old JSX.
  const saveCode = section(homeSource, "  async function saveChanges() {", "\n  const dirty = createMemo(");
  function mount(g, options = {}) {
    return createRoot(dispose => {
      const [draft, setDraft] = createSignal(options.initial ?? literal(undefined));
      const [untouchedFlag, setUntouched] = createSignal(true);
      const [saveError, setSaveError] = createSignal();
      const writes = [], lowerings = [];
      const state = { functionBaseline: undefined, saveInFlight: false, sourceError: () => undefined, sourceText: () => undefined,
        setSaving() {}, setSaveNotice() {}, setSaveError, setSavedDraft() {}, setSavedValue() {}, setDraft() {}, setSourceText() {} };
      const imports = { ...g.clients, ...g.pageAdapters, createLocalLiveGuidance: g.createLocalLiveGuidance,
        openLiveGuidance, completeLiveDraft, openLocalLiveGuidance,
        reader: g.world.reader, homeAuthoringSession: g.world.reader.session, onCleanup, createEffect, createMemo,
        untouched: untouchedFlag, draft, draftValueFingerprint: JSON.stringify, savedExpressionDeclaration: () => undefined,
        readableIdentities, getLabel: () => undefined, locale: value => value,
        state, fn: () => options.definition, props: { item: { id: "card", valueType: number }, savedExprById: new Map(), evaluated: undefined },
        cloneDraftValue: structuredClone, data: { saveInspection: async (...args) => {
          writes.push(args.slice(0, 2));
          // B4 unit D item 2: the body this Save lowered and persisted.
          if (args[4] && options.persistedBody !== undefined) args[4].body = options.persistedBody;
          return "data"; },
          focusedExpressionState: () => undefined },
        sessionEpoch: g.world.imports.sessionEpoch, assertCurrentSession: g.world.imports.assertCurrentSession,
        localExpressionSaveIssue: g.world.localExpressionSaveIssue,
        localFunctionBodySaveIssue: options.functionCheck ?? (() => { throw new Error("Unplanned function check"); }),
        runLocalReaderAction: async () => { lowerings.push("lowered again"); throw new Error("Unplanned second lowering"); },
        loweredLogic: reply => reply,
        temporaryEdits: () => false, getIOAction: () => undefined, toLogic: () => ({}), source: () => "", printedSource: () => undefined, readPendingSource: async () => true, pendingSourceText: undefined, followLocusPath: value => ({ value }),
        resolveCatalogReference: undefined, LOCAL_SAVE_TOOLS_PENDING: g.world.LOCAL_SAVE_TOOLS_PENDING, draftScope: { surface: "inspection" } };
      const api = new Function(...Object.keys(imports), `let saveController; let disposed = false; ${compiled(inspection)}; ${compiled(saveCode)};
        return { draftIssue, saveChanges, localGuidance };`)(...Object.values(imports));
      return { ...api, dispose, writes, lowerings, state, saveError, edit: async next => { setDraft(next); setUntouched(false); await settle(); } };
    });
  }

  test("an untouched draft sends nothing; an edit sends one guidance check whose verdict shows", async () => {
    const g = guidanceWorld(), m = mount(g);
    expect(m.draftIssue()).toBeUndefined();
    await g.runFrame();
    expect(g.requests).toHaveLength(0);
    await m.edit(literal("text"));
    m.draftIssue();
    await g.runFrame();
    expect(g.requests.map(row => row.method)).toEqual(["expression-save-issue"]);
    const [, node, , requestOptions] = g.requests[0].args;
    expect(node).toEqual(literal("text"));
    expect(requestOptions).toMatchObject({ expectedType: number, priority: "guidance" });
    // Checking: no issue and no positive mark.
    expect(m.draftIssue()).toBeUndefined();
    await g.answer(0, { issue: "Finish with Number before saving." });
    expect(m.draftIssue()).toBe("Finish with Number before saving.");
    expect(g.page).toEqual([]);
    expect(g.world.pageReads).toEqual([]);
    m.dispose();
  });

  test("a complete draft at open sends exactly one guidance check and shows its issue; nothing more without an edit", async () => {
    const g = guidanceWorld(), m = mount(g, { initial: literal("text") });
    await settle();
    m.draftIssue();
    await g.runFrame();
    expect(g.requests.map(row => row.method)).toEqual(["expression-save-issue"]);
    expect(g.requests[0].args[3]).toMatchObject({ expectedType: number, priority: "guidance" });
    await g.answer(0, { issue: "Finish with Number before saving." });
    expect(m.draftIssue()).toBe("Finish with Number before saving.");
    await g.runFrame();
    expect(g.requests).toHaveLength(1);
    expect(g.page).toEqual([]);
    expect(g.world.pageReads).toEqual([]);
    m.dispose();
  });

  test("a function body checks through function-body-save-issue at guidance priority", async () => {
    const definition = { id: "fn", params: [], returns: number, body: 1 };
    const g = guidanceWorld(), m = mount(g, { definition });
    await m.edit(literal(2));
    m.draftIssue();
    await g.runFrame();
    expect(g.requests.map(row => row.method)).toEqual(["prepared"]);
    expect(g.requests[0].args[1]).toMatchObject({ method: "function-body-save-issue", node: literal(2), definition, priority: "guidance" });
    await g.answer(0, { issue: "Complete the function before saving." });
    expect(m.draftIssue()).toBe("Complete the function before saving.");
    expect(g.page).toEqual([]);
    m.dispose();
  });

  test("a function Save's baseline is the body that Save lowered and persisted, not a second lowering", async () => {
    const definition = { id: "fn", params: [], returns: number, body: 1 };
    const g = guidanceWorld(), m = mount(g, { definition, functionCheck: async () => undefined, persistedBody: { persisted: 2 } });
    await m.edit(literal(2));
    await m.saveChanges();
    expect(m.writes).toHaveLength(1);
    expect(m.lowerings).toEqual([]);
    expect(m.saveError()).toBeUndefined();
    expect(m.state.functionBaseline).toEqual({ ...definition, body: { persisted: 2 } });
    m.dispose();
  });

  test("Save while guidance is held cancels it, goes through worker admission and never reads the memo", async () => {
    const g = guidanceWorld(), m = mount(g);
    await m.edit(literal("text"));
    m.draftIssue();
    await g.runFrame();
    const guidance = g.requests[0];
    const flight = m.saveChanges();
    await settle();
    // The held guidance was aborted before the Save admission was sent.
    expect(guidance.args.at(-1).aborted).toBe(true);
    expect(g.world.requests).toHaveLength(1);
    expect(g.world.requests[0].node).toEqual(literal("text"));
    expect(g.world.requests[0].options).toMatchObject({ expectedType: number });
    expect(g.world.requests[0].options.priority).toBeUndefined();
    await g.world.answer(0, { issue: "Finish with Number before saving." });
    await flight;
    expect(m.saveError()).toBe("Finish with Number before saving.");
    expect(m.writes).toEqual([]);
    expect(g.page).toEqual([]);
    expect(g.world.pageReads).toEqual([]);
    m.dispose();
  });

  test("an admitted Save writes; a revision bump during the admission refuses", async () => {
    for (const bump of [false, true]) {
      const g = guidanceWorld(), m = mount(g);
      await m.edit(literal(3));
      const flight = m.saveChanges();
      await settle();
      if (bump) g.world.bumpRevision();
      await g.world.answer(0, {});
      await flight;
      expect(m.writes).toHaveLength(bump ? 0 : 1);
      if (bump) expect(m.saveError()).toBe(g.world.LOCAL_SAVE_CHANGED);
      m.dispose();
    }
  });
});

describe("composer: live evaluation, check and inferred type come from the worker", () => {
  const code = section(homeSource, "  async function previewLocalDraft(", "  const inferredType = createMemo(");
  const previewFacts = section(homeSource, "  const previewSavedFingerprint =", "  function previewDraft(");
  const creationName = section(homeSource, "  const creationTypeName =", "  const [requestedPreview,");
  const pickerCode = section(homeSource, "  function showExpressionStep() {", "  const captureRichTypeTarget:");
  // Extract the real Save-entry and failure-finally flag writes. Full Save
  // admission/currentness controls remain with the existing Save fixture.
  const save = section(homeSource.slice(homeSource.indexOf("  async function previewLocalDraft(")),
    "  async function save() {\n    if (dismissed || saveInFlight) return;", "\n  function ComposerExpressionEditor() {");
  const beginSave = section(save, "    saveInFlight = true;", "    try {");
  const finishSave = "      saveInFlight = false;\n      if (!dismissed) setSaving(false);";
  if (!save.includes("        composerGuidance.cancel();") || !save.includes(finishSave)) throw new Error("Composer Save ownership moved.");
  function mount(g, options = {}) {
    return createRoot(dispose => {
      const [draft, setDraft] = createSignal(options.initial ?? literal(undefined));
      const [saving, setSaving] = createSignal(false);
      const [authored, setAuthored] = createSignal(options.authored ?? false);
      const [step, setStep] = createSignal(options.step ?? "expression");
      const [chosenType, setChosenType] = createSignal(options.chosenType ?? "");
      const [chosenValueType, setChosenValueType] = createSignal();
      const [typePicked, setTypePicked] = createSignal(false);
      const [requestedPreview, setRequestedPreview] = createSignal();
      const opener = options.realSeedOpener ? seedOpenOwner(g, options.incompleteNode) : { openLocalLiveGuidance, completeLiveDraft };
      const errors = [];
      const retained = [];
      g.world.reader.presentation = id => ({ label: options.labels?.[id] });
      const destination = { place: { kind: "list", listType: options.listType }, reader: g.world.reader };
      const [targetPlace, setTargetPlace] = createSignal(destination.place);
      const imports = { ...g.clients, ...g.pageAdapters, createLocalLiveGuidance: g.createLocalLiveGuidance, onCleanup, createMemo,
        openLiveGuidance, ...opener, untrack, authoredDraft: authored,
        reader: g.world.reader, destination: () => options.noDestination ? undefined : { ...destination, place: targetPlace() }, authoringSession: g.world.reader.session,
        draft, savedCtx: { list: () => [], byId: () => undefined }, refResolver: () => undefined, props: { evaluateOnRequest: options.evaluateOnRequest ?? false },
        // Initial transport facts keep the expected type independent of its
        // shown name; production picker handlers then own the selected target.
        expectedType: () => typePicked() ? chosenValueType() ?? (chosenType() ? { $ref: chosenType() } : undefined) : options.expectedType,
        declaredTypeLabel: () => options.typeLabel,
        chosenType, initialCreation: options.initialCreation ?? true,
        composerStep: step, toLogic: node => node,
        authoringExpressionHasEmptySlot: logic => options.emptySlot ? completeLiveDraft(logic) === false : false,
        expressionInferenceItem: node => ({ node }), WorkerRequestError, LOCAL_SAVE_TOOLS_PENDING: "pending",
        interruptedSubmission: false, uncertainSubmission: () => false, preparingScope: () => false,
        requestedPreview, setRequestedPreview,
        setDraft, setChosenType: value => { setTypePicked(true); setChosenType(value); },
        setChosenValueType: value => { setTypePicked(true); setChosenValueType(value); }, setComposerStep: setStep,
        setTypePickerOpen() {}, setPickingKind() {}, setIconPickerOpen() {}, setQuickpickParent() {},
        retainDraft: checkpoint => retained.push(checkpoint), hasQuickTypeDrill: () => false,
        expectedTypeForName: name => name ? { $ref: name } : undefined,
        seedExpressionForType: (type, _environment, name) => options.seeds?.[name ?? type?.$ref] ?? literal(undefined),
        constructForm, authoringStructureEnvironment: () => ({ fixture: "published structure" }),
        constructorFieldsForTag: () => options.fields ?? [], recordFieldsForType: () => options.fields ?? [],
        canonical: value => value, peelMaybeValue: value => value?.$tag === "Just" ? value._0 : undefined,
        localFieldName: (_reader, _session, id) => options.fieldLabels?.[id],
        tryResolveIdentifiedFieldView: () => { throw new Error("A Local tooltip must not read a page registry"); },
        readableIdentities, hintsTooltipText, refHandle: type => type?.$ref, locale: value => value,
        origin: { getLabel: id => options.labels?.[id] },
        cloneDraftValue: structuredClone, scopeGeneration: 0,
        setSaveError: value => errors.push(value), saving, setSaving, dismissed: false, sessionEpoch: g.world.imports.sessionEpoch, draftValueFingerprint: JSON.stringify,
        peelListForAuthoring: () => undefined, resolveValueType: value => value };
      const api = new Function(...Object.keys(imports), `let saveInFlight = false, saveController; ${compiled(creationName)}; ${compiled(previewFacts)}; ${compiled(pickerCode)}; ${compiled(code)};
        return { evaluated, draftIssue, inferredValueType, composerGuidance, draftPrecondition, saving, creationReady, creationState,
          creationValidationTooltip, currentValidation: creationValidation,
          pickTopType, pickFromRichPicker, previewLocalDraft, currentDraft: draft,
          beginSave() { ${compiled(beginSave)} composerGuidance.cancel(); },
          finishSave() { ${compiled(finishSave)} } };`)(...Object.values(imports));
      return { ...api, dispose, errors, retained, authoredDraft: authored,
        changeListRequirement: type => setTargetPlace(place => ({ ...place, listType: type })),
        changeScope: scope => setTargetPlace(place => ({ ...place, scope })),
        edit: async next => { setDraft(next); setAuthored(true); api.composerGuidance.touch(); await settle(); } };
    });
  }


  async function answeredComposer(g, m) {
    await m.edit(literal(5)); m.evaluated(); m.draftIssue(); m.inferredValueType(); await g.runFrame();
    await g.answer(0, { result: 5, trace: [] });
    await g.answer(1, [{ outcome: { $tag: "Solved" }, type: number }]);
    m.evaluated(); m.draftIssue(); m.inferredValueType();
    expect(g.requests).toHaveLength(2);
  }

  const positiveCreation = { verdict: { $tag: "Just", _0: true }, state: { $tag: "HintPass" }, fields: [] };
  async function answerSeed(g, m, start = 0) {
    expect(g.requests[start].method).toBe("prepared");
    expect(g.requests[start].args[1]).toMatchObject({ method: "lower-reader-expression", priority: "guidance" });
    expect(m.creationReady()).toBe(false);
    await g.answer(start, { lowered: { $tag: "Ok", _0: { logic: "captured seed", emptySlot: false } } });
    m.creationReady(); await g.runFrame();
    expect(g.requests[start + 1].method).toBe("evaluate-expression");
    expect(g.requests[start + 1].args[5]).toMatchObject({ priority: "guidance", admission: { creationValidation: true } });
    expect(m.creationReady()).toBe(false);
    await g.answer(start + 1, { result: 0, trace: [], validation: positiveCreation });
    expect(g.requests[start + 2].method).toBe("infer-expression");
    await g.answer(start + 2, [{ outcome: { $tag: "Solved" }, type: number }]);
    expect(m.creationReady()).toBe(true);
  }

  test("complete Number zero, empty-list and nullary presets open one current guidance without becoming authored", async () => {
    for (const initial of [literal(0), literal({ __list: [] }), literal({ __construct: { tag: "Ready", fields: [] } })]) {
      const g = guidanceWorld(), m = mount(g, { initial, realSeedOpener: true });
      expect(m.creationReady()).toBe(false);
      await settle(); m.creationReady(); await g.runFrame();
      expect(g.requests).toHaveLength(1);
      await answerSeed(g, m);
      m.creationReady(); await g.runFrame();
      expect(g.requests).toHaveLength(3);
      expect(m.authoredDraft()).toBe(false);
      expect(m.currentDraft()).toBe(initial);
      expect(g.world.requests).toEqual([]); // no Save admission on open
      expect(g.world.pageReads).toEqual([]);
      m.dispose();
    }
  });

  test("an incomplete seed stays idle; either type picker can select a complete seed without an edit", async () => {
    for (const rich of [false, true]) {
      const initial = literal({ __construct: { tag: "Person", fields: [{ name: "phone", value: literal(undefined) }] } });
      const g = guidanceWorld(), m = mount(g, { initial, incompleteNode: initial, realSeedOpener: true,
        seeds: { Number: literal(0) } });
      await settle(); m.creationReady(); await g.runFrame();
      expect(g.requests).toEqual([]);
      expect(m.creationReady()).toBe(false);
      if (rich) m.pickFromRichPicker({ kind: "type", ownership: "new-choice", reference: "Number" });
      else m.pickTopType("Number");
      await settle(); m.creationReady(); await g.runFrame();
      await answerSeed(g, m);
      expect(m.currentDraft()).toEqual(literal(0));
      expect(m.authoredDraft()).toBe(false);
      expect(m.retained.every(checkpoint => checkpoint.authored !== true)).toBe(true);
      expect(g.world.requests).toEqual([]);
      expect(g.world.pageReads).toEqual([]);
      m.dispose();
    }
  });

  test("a replaced seed-lowering worker cannot open guidance from its stale reply", async () => {
    const g = guidanceWorld(), m = mount(g, { initial: literal(0), realSeedOpener: true });
    await settle();
    expect(g.requests).toHaveLength(1);
    g.world.replaceWorker();
    await g.answer(0, { lowered: { $tag: "Ok", _0: { logic: 0, emptySlot: false } } });
    expect(m.creationReady()).toBe(false);
    expect(g.requests.every(request => request.method === "prepared")).toBe(true);
    await answerSeed(g, m, 1);
    expect(m.authoredDraft()).toBe(false);
    expect(g.world.pageReads).toEqual([]);
    m.dispose();
  });

  test("a complete Suggestions call with evaluateOnRequest stays idle until its explicit Preview", async () => {
    const initial = call("effectful:request", literal(1));
    const g = guidanceWorld(), m = mount(g, { initial, realSeedOpener: true, evaluateOnRequest: true });
    await settle(); m.creationReady(); await g.runFrame();
    expect(g.requests).toEqual([]);
    expect(m.creationReady()).toBe(false);
    const preview = m.previewLocalDraft(m.currentDraft(), g.world.reader.session());
    await settle();
    expect(g.requests.map(request => request.method)).toEqual(["expression-save-issue"]);
    expect(g.requests[0].args[3].priority).toBeUndefined();
    await g.answer(0, {});
    expect(g.requests[1].method).toBe("evaluate-expression");
    await g.answer(1, { result: 0, trace: [], validation: positiveCreation });
    await preview;
    expect(m.creationReady()).toBe(true);
    expect(m.authoredDraft()).toBe(false);
    expect(g.world.requests).toEqual([]);
    expect(g.world.pageReads).toEqual([]);
    m.dispose();
  });

  test("an unchanged explicit Preview stays positive, but changing its selected type keeps the authored draft and disables Create", async () => {
    const initial = call("user:make", literal(1));
    const g = guidanceWorld(), m = mount(g, { initial, authored: true, expectedType: number, evaluateOnRequest: true });
    const preview = m.previewLocalDraft(m.currentDraft(), g.world.reader.session());
    await settle();
    expect(g.requests[0].args[3].expectedType).toEqual(number);
    await g.answer(0, {});
    expect(g.requests[1].args[5].admission.expectedType).toEqual(number);
    await g.answer(1, { result: 1, trace: [], validation: positiveCreation });
    await preview;
    expect(m.creationReady()).toBe(true);
    await settle(); m.creationReady(); await g.runFrame();
    expect(m.creationReady()).toBe(true);
    expect(g.requests).toHaveLength(2);
    m.pickTopType("String"); await settle();
    expect(m.currentDraft()).toBe(initial);
    expect(m.authoredDraft()).toBe(true);
    expect(m.creationReady()).toBe(false);
    expect(m.draftPrecondition()).toBe("Preview this expression before saving.");
    expect(g.requests).toHaveLength(2);
    expect(g.world.requests).toEqual([]);
    expect(g.world.pageReads).toEqual([]);
    m.dispose();
  });

  test("a Preview requirement change during either await drops its reply without executing for a replacement type or list", async () => {
    for (const list of [false, true]) for (const afterCheck of [false, true]) {
      const initial = call("user:make", literal(1));
      const listType = { $ref: "ScoresA" };
      const g = guidanceWorld(), m = mount(g, { initial, authored: true, evaluateOnRequest: true,
        ...(list ? { listType } : { expectedType: number }) });
      const preview = m.previewLocalDraft(m.currentDraft(), g.world.reader.session());
      await settle();
      const admission = g.requests[0].args[3];
      expect(list ? admission.expectedListType : admission.expectedType).toEqual(list ? listType : number);
      if (afterCheck) {
        await g.answer(0, {});
        expect(g.requests[1].method).toBe("evaluate-expression");
        const evaluatedAdmission = g.requests[1].args[5].admission;
        expect(list ? evaluatedAdmission.expectedListType : evaluatedAdmission.expectedType).toEqual(list ? listType : number);
      }
      if (list) m.changeListRequirement({ $ref: "ScoresB" });
      else m.pickTopType("String");
      await settle();
      await g.answer(afterCheck ? 1 : 0, afterCheck ? { result: 1, trace: [], validation: positiveCreation } : {});
      await preview;
      expect(m.currentDraft()).toBe(initial);
      expect(m.creationReady()).toBe(false);
      expect(m.draftPrecondition()).toBe("Preview this expression before saving.");
      expect(g.requests).toHaveLength(afterCheck ? 2 : 1);
      expect(g.world.requests).toEqual([]);
      expect(g.world.pageReads).toEqual([]);
      m.dispose();
    }
  });

  test("a Preview cannot reuse a positive answer after its destination scope changes", async () => {
    const initial = call("user:make", literal(1));
    const g = guidanceWorld(), m = mount(g, { initial, authored: true, expectedType: number, evaluateOnRequest: true });
    const preview = m.previewLocalDraft(m.currentDraft(), g.world.reader.session());
    await settle(); await g.answer(0, {});
    m.changeScope({ kind: "view", viewId: "another-list" }); await settle();
    await g.answer(1, { result: 1, trace: [], validation: positiveCreation });
    await preview;
    expect(m.currentDraft()).toBe(initial);
    expect(m.creationReady()).toBe(false);
    expect(g.world.requests).toEqual([]);
    expect(g.world.pageReads).toEqual([]);
    m.dispose();
  });

  test("the root tooltip groups named field rules and omits only a source-identified aggregate ongoing mismatch", async () => {
    const typeId = "99185fac-6bf2-4dd4-b6c9-7a01cf482f8a";
    const fieldId = "10000000-0000-4000-8000-000000000001";
    const issue = `This expression returns a different type. Finish with ${typeId} before saving.`;
    const base = { state: { $tag: "HintPass" }, rules: [{ id: "string", label: "String", state: { $tag: "HintPass" }, parts: [] }] };
    const phone = { state: { $tag: "HintNotYet" }, rules: [{ id: "phone", label: "valid phone", state: { $tag: "HintNotYet" },
      cursor: { humanLabel: "digit" }, parts: [
        { name: "plus", state: { $tag: "HintPass" }, parts: [] }, { name: "number", state: { $tag: "HintNotYet" }, parts: [] },
      ] }] };
    for (const [diagnostic, whole, hidden] of [
      [{ code: "authoring.literal-membership", path: ["$expression"] }, "HintNotYet", true],
      [{ code: "authoring.literal-membership", path: ["fields", "phone"] }, "HintNotYet", false],
      [{ code: "authoring.binding-name", path: ["binding"] }, "HintNotYet", false],
      [{ code: "authoring.expression-structure", path: ["body"] }, "HintNotYet", false],
      [undefined, "HintNotYet", false],
      [{ code: "authoring.literal-membership", path: ["$expression"] }, "HintUnknown", false],
      [{ code: "authoring.literal-membership", path: ["$expression"] }, "HintBlocked", false],
    ]) {
      const g = guidanceWorld(), m = mount(g, { typeLabel: "Person", chosenType: typeId, expectedType: { $ref: typeId },
        fields: [{ name: "phone", label: { $tag: "Nothing" }, key: { $tag: "NamedField", ref: { $ref: fieldId } } }],
        fieldLabels: { [fieldId]: { label: "Phone" } } });
      await m.edit(literal({ __construct: { tag: "Person", fields: [{ name: "phone", value: literal("+1") }] } }));
      m.creationReady(); await g.runFrame();
      expect(g.requests[0].args[5].admission.expectedTypeName).toBe("Person");
      const validation = { verdict: { $tag: "Nothing" }, state: { $tag: whole }, issue,
        ...(diagnostic ? { issueDiagnostic: diagnostic } : {}), fields: [{ path: "phone", hints: base }, { path: "phone", hints: phone }] };
      await g.answer(0, { result: { phone: "+1" }, trace: [], validation });
      await g.answer(1, [{ outcome: { $tag: "Solved" }, type: number }]);
      const tooltip = m.creationValidationTooltip();
      expect(tooltip.match(/^Phone$/gm)).toHaveLength(1);
      expect(tooltip).toContain("✓ String");
      expect(tooltip).toContain("○ valid phone — not complete yet, next digit");
      expect(tooltip).toContain("✓ plus");
      expect(tooltip).toContain("○ number");
      expect(tooltip).not.toContain(typeId);
      expect(tooltip.includes("This expression returns")).toBe(!hidden);
      expect(m.currentValidation().issue).toBe(issue);
      expect(m.creationReady()).toBe(false);
      g.replaceCapture(); await settle();
      expect(m.creationValidationTooltip()).toBe("Checking data…");
      expect(g.world.pageReads).toEqual([]);
      m.dispose();
    }
  });

  test("Save does not re-arm composer guidance when saved data publishes before appearance persistence", async () => {
    const g = guidanceWorld(), m = mount(g, { expectedType: number }); await answeredComposer(g, m);
    m.beginSave(); await settle(); g.publishValue(); await settle();
    expect(m.evaluated()).toEqual({ result: undefined, trace: [] });
    expect(m.draftIssue()).toBeUndefined(); expect(m.inferredValueType()).toBeUndefined();
    await g.runFrame(); expect(g.requests).toHaveLength(2);
    expect(g.page).toEqual([]); expect(g.world.pageReads).toEqual([]);
    m.dispose();
  });

  test("a failed Save resumes guidance under its newer publication capture", async () => {
    const g = guidanceWorld(), m = mount(g, { expectedType: number }); await answeredComposer(g, m);
    m.beginSave(); await settle(); g.publishValue(); await settle();
    m.evaluated(); await g.runFrame(); expect(g.requests).toHaveLength(2);
    m.finishSave(); await settle(); m.evaluated(); m.draftIssue(); m.inferredValueType(); await g.runFrame();
    expect(g.requests).toHaveLength(3); expect(g.requests[2].method).toBe("evaluate-expression");
    expect(g.page).toEqual([]); m.dispose();
  });

  test("a failed Save can retain already-valid guidance when its capture did not change", async () => {
    const g = guidanceWorld(), m = mount(g, { expectedType: number }); await answeredComposer(g, m);
    m.beginSave(); await settle(); expect(m.evaluated()).toEqual({ result: undefined, trace: [] });
    m.finishSave(); await settle(); expect(m.evaluated()).toEqual({ result: 5, trace: [] });
    await g.runFrame(); expect(g.requests).toHaveLength(2); expect(g.page).toEqual([]); m.dispose();
  });

  test("Save's same-tick flag prevents a first guidance read before its signal commits", async () => {
    const g = guidanceWorld(), m = mount(g, { initial: literal(5), expectedType: number });
    m.composerGuidance.touch(); m.beginSave(); expect(m.saving()).toBe(false);
    expect(m.evaluated()).toEqual({ result: undefined, trace: [] });
    m.draftIssue(); m.inferredValueType(); await settle(); await g.runFrame(); expect(g.requests).toHaveLength(0);
    m.finishSave(); await settle(); m.evaluated(); await g.runFrame(); expect(g.requests).toHaveLength(1);
    expect(g.page).toEqual([]); m.dispose();
  });

  test("Create requires a current definite-positive whole judgment; pending, false and unknown stay disabled", async () => {
    const positive = { verdict: { $tag: "Just", _0: true }, state: { $tag: "HintPass" }, fields: [] };
    for (const validation of [positive,
      { verdict: { $tag: "Just", _0: false }, state: { $tag: "HintNotMet" }, fields: [] },
      { verdict: { $tag: "Nothing" }, state: { $tag: "HintUnknown" }, fields: [] },
      { verdict: { $tag: "Nothing" }, state: { $tag: "HintPass" }, fields: [] }]) {
      const g = guidanceWorld(), m = mount(g, { expectedType: number });
      expect(m.creationReady()).toBe(false);
      await m.edit(literal(7)); m.creationReady(); await g.runFrame();
      expect(m.creationReady()).toBe(false);
      await g.answer(0, { result: 7, trace: [], validation });
      await g.answer(1, [{ outcome: { $tag: "Solved" }, type: number }]);
      expect(m.creationReady()).toBe(validation === positive);
      await m.edit(literal(8));
      expect(m.creationReady()).toBe(false);
      expect(m.creationState()).toBe("HintUnknown");
      m.dispose();
      expect(g.world.pageReads).toEqual([]);
    }
  });

  test("a stale creation verdict after the reader revision changes never turns Create green", async () => {
    const g = guidanceWorld(), m = mount(g, { expectedType: number });
    await m.edit(literal(7)); m.creationReady(); await g.runFrame();
    g.world.bumpRevision();
    await g.answer(0, { result: 7, trace: [], validation: {
      verdict: { $tag: "Just", _0: true }, state: { $tag: "HintPass" }, fields: [] } });
    expect(m.creationReady()).toBe(false);
    expect(m.creationState()).toBe("HintUnknown");
    m.dispose();
    expect(g.world.pageReads).toEqual([]);
  });

  test("nothing at mount; an edit sends one checked evaluation and one inference item at guidance priority", async () => {
    const g = guidanceWorld(), m = mount(g, { listType: { $ref: "Scores" }, chosenType: "Score" });
    m.evaluated(); m.draftIssue(); m.inferredValueType();
    await g.runFrame();
    expect(g.requests).toHaveLength(0);
    await m.edit(call("user:make", literal(2)));
    m.evaluated(); m.draftIssue(); m.inferredValueType();
    await g.runFrame();
    expect(g.requests.map(row => row.method)).toEqual(["evaluate-expression"]);
    const evaluation = g.requests[0].args;
    expect(evaluation[1]).toEqual(call("user:make", literal(2)));
    // The worker peels the list type with its own registry; the page never does.
    expect(evaluation[5]).toMatchObject({ priority: "guidance", admission: { expectedListType: { $ref: "Scores" }, expectedTypeName: "Score" } });
    expect(m.evaluated()).toEqual({ result: undefined, trace: [] });
    expect(m.draftIssue()).toBeUndefined();
    await g.answer(0, { result: 7, trace: [], issue: "Finish with Score before saving." });
    expect(g.requests.map(row => row.method)).toEqual(["evaluate-expression", "infer-expression"]);
    expect(g.requests[1].args[1]).toEqual([{ node: call("user:make", literal(2)) }]);
    expect(g.requests[1].args[3]).toMatchObject({ priority: "guidance" });
    await g.answer(1, [{ outcome: { $tag: "Solved" }, type: number }]);
    expect(m.evaluated()).toEqual({ result: 7, trace: [] });
    expect(m.draftIssue()).toBe("Finish with Score before saving.");
    expect(m.inferredValueType()).toEqual(number);
    expect(g.page).toEqual([]);
    expect(g.world.pageReads).toEqual([]);
    m.dispose();
  });

  test("a preset complete draft asks once at open; an incomplete seed asks nothing", async () => {
    const g = guidanceWorld(), m = mount(g, { authored: true, initial: call("user:make", literal(2)), expectedType: number });
    await settle(); m.evaluated(); m.draftIssue(); m.inferredValueType();
    await g.runFrame();
    expect(g.requests.map(row => row.method)).toEqual(["evaluate-expression"]);
    await g.answer(0, { result: 7, trace: [], issue: "Finish with Number before saving." });
    await g.answer(1, [{ outcome: { $tag: "Solved" }, type: number }]);
    expect(m.evaluated()).toEqual({ result: 7, trace: [] });
    expect(m.draftIssue()).toBe("Finish with Number before saving.");
    expect(m.inferredValueType()).toEqual(number);
    await g.runFrame();
    expect(g.requests).toHaveLength(2);
    const h = guidanceWorld(), n = mount(h, { initial: literal(undefined), expectedType: number });
    await settle(); n.evaluated(); n.draftIssue();
    await h.runFrame();
    expect(h.requests).toHaveLength(0);
    m.dispose(); n.dispose();
  });

  test("a touched incomplete draft shows the empty-slot issue from the worker's check (Save disabled as on the page)", async () => {
    const g = guidanceWorld(), m = mount(g, { emptySlot: true, expectedType: number, chosenType: "Score" });
    await m.edit(call("user:make", literal(undefined)));
    m.evaluated(); m.draftIssue(); m.inferredValueType();
    await g.runFrame();
    expect(g.requests.map(row => row.method)).toEqual(["expression-save-issue"]);
    expect(g.requests[0].args[3]).toMatchObject({ expectedType: number, expectedTypeName: "Score", priority: "guidance" });
    await g.answer(0, { issue: "Complete the empty value slots before saving. Choose a constructor for an absent value." });
    expect(m.draftIssue()).toBe("Complete the empty value slots before saving. Choose a constructor for an absent value.");
    expect(m.evaluated()).toEqual({ result: undefined, trace: [] });
    expect(g.page).toEqual([]);
    m.dispose();
  });

  test("an evaluation refusal shows as today; a transport failure stays checking", async () => {
    const g = guidanceWorld(), m = mount(g, { expectedType: number });
    await m.edit(call("user:divide", literal(1), literal(0)));
    m.evaluated();
    await g.runFrame();
    await g.fail(0, new WorkerRequestError("Division by zero"));
    await g.answer(1, [{ outcome: { $tag: "Solved" }, type: number }]);
    expect(m.evaluated()).toEqual({ result: undefined, trace: [], error: "Division by zero" });
    const h = guidanceWorld(), n = mount(h, { expectedType: number });
    await n.edit(call("user:divide", literal(1), literal(0)));
    n.evaluated();
    await h.runFrame();
    await h.fail(0, new Error("The operation took too long. Try again with less data."));
    expect(n.evaluated()).toEqual({ result: undefined, trace: [] });
    expect(n.draftIssue()).toBeUndefined();
    m.dispose(); n.dispose();
  });
});

describe("call inputs: checks, evaluation and result check run in the worker, in the page's order", () => {
  const signature = section(homeSource, "  // Argument expressions remain the source.", "  let retainedCallSignature:");
  const readSignature = section(homeSource, "function readLocalCallSignature(", "function readLocalHandles(");
  // The old fixture already fixes both parameters to Number and schemes to
  // []. Restore its missing signature-display prerequisite on a separate
  // controlled worker seam; verdict/evaluation requests remain held below.
  // Use the actual capture, async answer and action owners, not a ready flag.
  function signatureClient(g) {
    const captured = { ...g.world.imports, untrack, createLiveGuidance, authoringExpressionHasEmptySlot: () => false };
    const capture = new Function(...Object.keys(captured), compiled(callCaptureSource.slice(callCaptureSource.indexOf("export type LocalGuidanceCapture")))
      + "; return { localGuidanceCapture, localGuidanceCurrent, sameLocalGuidanceCapture };")(...Object.values(captured));
    const requests = [];
    const reply = async (_target, payload) => {
      expect(payload.method).toBe("project-reader-call-signature");
      expect(payload.fnId).toBe("user:add"); expect(payload.functionId).toBe("user:add");
      expect(payload.params).toEqual([{ name: "a", type: number }, { name: "b", type: number }]);
      requests.push(structuredClone(payload));
      return { callSignature: { params: structuredClone(payload.params), schemes: [] } };
    };
    const imports = { ...capture, createEffect, createSignal, onCleanup, untrack, draftValueFingerprint: JSON.stringify,
      preparedReaderWorkerForSession: () => ({ fixture: "signature-handle" }),
      runPreparedReaderWorker: reply, runAuthoringWorker: reply, reachedSavedSources: () => [] };
    const actions = new Function(...Object.keys(imports), compiled(callActionSource.slice(callActionSource.indexOf("/** The existing Local refusal sentences")))
      + "; return { createLocalReaderAnswer, runLocalReaderAction };")(...Object.values(imports));
    return { ...actions, requests };
  }
  const checks = section(homeSource, "  // B4 slice 2: a Local reader checks the inputs, evaluates the call and", "  const addressPreview = createAsyncValue(");
  const results = section(homeSource, "  const evaluated = createMemo(() => {\n    if (!fn() || inputIssue()", "\n  const [pinning, setPinning]");
  const pinning = section(homeSource, "  const [pinning, setPinning]", "  function setArg(");
  const setArgCode = section(homeSource, "  function setArg(", "    if (props.addressInputs && props.onAddressInputsChange) {");
  function mount(g, initial = [literal(undefined), literal(2)]) {
    return createRoot(dispose => {
      const [args, setArgs] = createSignal(initial);
      const params = [{ name: "a", type: number }, { name: "b", type: number }];
      const signatures = signatureClient(g);
      const imports = { ...g.clients, ...g.pageAdapters, createLocalLiveGuidance: g.createLocalLiveGuidance, onCleanup, createMemo, createSignal,
        openLiveGuidance, completeLiveDraft, openLocalLiveGuidance, toLogic: () => ({}), params: () => params,
        createProjection, snapshot, detectStructuralForm: () => null, createLocalReaderAnswer: signatures.createLocalReaderAnswer,
        runLocalReaderAction: signatures.runLocalReaderAction,
        reader: g.world.reader, authoringSession: g.world.reader.session, savedCtx: { list: () => [] }, refResolver: () => undefined,
        argExprs: args, resolvedParams: () => params, parameterSchemes: () => [], fn: () => ({ id: "user:add", params, returns: number }),
        props: { fnId: "user:add" }, callExpr: () => ({ kind: "call", fnId: "user:add", args: args() }), addressIssues: () => [],
        projectAuthoringScheme: () => undefined, WorkerRequestError, LOCAL_SAVE_TOOLS_PENDING: "pending",
        addressPreviewState: () => ({}), addressDecodePending: () => false, sessionEpoch: g.world.imports.sessionEpoch, concreteAuthoringSession: value => value,
        validationDemo: () => false, cloneDraftValue: structuredClone, untrack, setAddressRunRequest() {}, addressRunController: undefined,
        onSettled() {}, nameCurrent: () => true, callableName: () => "add", locusAdd: async (...args) => { added.push(args); return true; },
        localWorkerSaveIssue: g.world.localWorkerSaveIssue, setArgExprs: setArgs, setAddressIssues() {},
        draftValueFingerprint: JSON.stringify, LOCAL_SAVE_DRAFT_CHANGED: g.world.LOCAL_SAVE_DRAFT_CHANGED };
      const added = [];
      const api = new Function(...Object.keys(imports), `${compiled(readSignature)}; ${compiled(signature)}; ${compiled(checks)}; ${compiled(results)}; ${compiled(pinning)};
        ${compiled(setArgCode + "  }")}
        return { inputIssue, evaluated, resultIssue, draftIssue, callGuidance, pinResult, setArg, pinned, pinRefusal,
          signatureAnswer: () => localCallSignature?.answer() };`)(...Object.values(imports));
      api.added = added; api.signatureRequests = signatures.requests;
      return { ...api, dispose, edit: async next => {
        setArgs(next); api.callGuidance.touch(); await settle();
        // Resolve the actual display-signature prerequisite before the held
        // verdict/evaluation phase this fixture controls.
        api.signatureAnswer(); await settle(); expect(api.signatureAnswer()).toBeDefined();
      } };
    });
  }

  test("each input is checked, then the call, then one checked evaluation; verdicts show only for the exact inputs", async () => {
    const g = guidanceWorld(), m = mount(g);
    m.draftIssue();
    await g.runFrame();
    expect(g.requests).toHaveLength(0);
    await m.edit([literal(1), literal(5)]);
    m.draftIssue(); m.evaluated();
    await g.runFrame();
    expect(g.requests.map(row => row.method)).toEqual(["expression-save-issue"]);
    expect(g.requests[0].args[3]).toMatchObject({ expectedType: number, priority: "guidance" });
    await g.answer(0, {});
    await g.answer(1, {});
    await g.answer(2, {});
    expect(g.requests.map(row => row.method)).toEqual(["expression-save-issue", "expression-save-issue", "expression-save-issue", "evaluate-expression"]);
    expect(g.requests[2].args[1]).toEqual(call("user:add", literal(1), literal(5)));
    expect(g.requests[3].args[5]).toMatchObject({ admitInvocations: true, priority: "guidance", admission: { expectedType: number } });
    expect(m.evaluated()).toBeNull();
    await g.answer(3, { result: 6, trace: [] });
    expect(m.evaluated()).toEqual({ result: 6, trace: [] });
    expect(m.draftIssue()).toBeUndefined();
    expect(g.page).toEqual([]);
    expect(g.world.pageReads).toEqual([]);
    m.dispose();
  });

  test("complete seeded inputs ask once at open and show the call's result; a blank input asks nothing", async () => {
    const g = guidanceWorld(), m = mount(g, [literal(1), literal(2)]);
    await settle(); m.draftIssue(); m.evaluated();
    await g.runFrame();
    expect(g.requests.map(row => row.method)).toEqual(["expression-save-issue"]);
    await g.answer(0, {}); await g.answer(1, {}); await g.answer(2, {});
    await g.answer(3, { result: 3, trace: [] });
    expect(m.evaluated()).toEqual({ result: 3, trace: [] });
    await g.runFrame();
    expect(g.requests).toHaveLength(4);
    const h = guidanceWorld(), n = mount(h);
    await settle(); n.draftIssue(); n.evaluated();
    await h.runFrame();
    expect(h.requests).toHaveLength(0);
    m.dispose(); n.dispose();
  });

  test("a Local pin refused by its worker shows the refusal in the call's issue line until the next edit", async () => {
    const g = guidanceWorld(), m = mount(g, [literal(1), literal(2)]);
    await settle();
    const flight = m.pinResult();
    await settle();
    // The pin's own check (weight 0), not guidance.
    expect(g.requests[0].method).toBe("expression-save-issue");
    expect(g.requests[0].args[3].priority).toBeUndefined();
    await g.answer(g.requests.length - 1, { issue: "Finish with Number before saving." });
    await flight;
    expect(m.added).toEqual([]);
    expect(m.pinned()).toBe(false);
    expect(m.pinRefusal()).toBe("Finish with Number before saving.");
    // Shown, but it never disables Add (it is not the draft issue).
    expect(m.draftIssue()).toBeUndefined();
    m.setArg(0, literal(4));
    await settle();
    expect(m.pinRefusal()).toBeUndefined();
    m.dispose();
  });

  test("a transient refusal (tools not ready) does not lock Add; a retry clears it and pins", async () => {
    const g = guidanceWorld(), m = mount(g, [literal(1), literal(2)]);
    await settle();
    g.world.retireWorker();
    await m.pinResult();
    expect(m.pinRefusal()).toBe(g.world.LOCAL_SAVE_TOOLS_PENDING);
    expect(m.draftIssue()).toBeUndefined();
    g.world.restoreWorker();
    const flight = m.pinResult();
    await settle();
    expect(m.pinRefusal()).toBeUndefined();
    for (let index = 0; index < 4; index++) {
      const request = g.requests.find(row => !row.answered);
      if (!request) break;
      request.answered = true;
      request.resolve(request.method === "evaluate-expression" ? { result: 3, trace: [] } : {});
      await settle();
    }
    await flight;
    expect(m.added).toHaveLength(1);
    m.dispose();
  });

  test("an input edited while a Local pin is checked refuses the pin; nothing is persisted", async () => {
    const g = guidanceWorld(), m = mount(g, [literal(1), literal(2)]);
    await settle();
    const flight = m.pinResult();
    await settle();
    m.setArg(1, literal(9));
    await settle();
    // Answer the pin's own checks and its checked evaluation.
    for (let index = 0; index < 4; index++) {
      const request = g.requests.find((row, at) => at >= index && !row.answered && row.args[3]?.priority === undefined && row.args[5]?.priority === undefined);
      if (!request) break;
      request.answered = true;
      request.resolve(request.method === "evaluate-expression" ? { result: 3, trace: [] } : {});
      await settle();
    }
    await flight;
    expect(m.added).toEqual([]);
    expect(m.pinned()).toBe(false);
    expect(m.pinRefusal()).toBe(g.world.LOCAL_SAVE_DRAFT_CHANGED);
    m.dispose();
  });

  test("an unchanged Local pin persists exactly the admitted call", async () => {
    const g = guidanceWorld(), m = mount(g, [literal(1), literal(2)]);
    await settle();
    const flight = m.pinResult();
    await settle();
    for (let index = 0; index < 4; index++) {
      const request = g.requests.find(row => !row.answered);
      if (!request) break;
      request.answered = true;
      request.resolve(request.method === "evaluate-expression" ? { result: 3, trace: [] } : {});
      await settle();
    }
    await flight;
    expect(m.added).toHaveLength(1);
    expect(m.added[0][0].expr).toEqual(call("user:add", literal(1), literal(2)));
    m.dispose();
  });

  test("a call whose evaluation throws is still pinnable, as on the page", async () => {
    const g = guidanceWorld(), m = mount(g, [literal(1), literal(2)]);
    await settle();
    const flight = m.pinResult();
    await settle();
    for (let index = 0; index < 4; index++) {
      const request = g.requests.find(row => !row.answered);
      if (!request) break;
      request.answered = true;
      if (request.method === "evaluate-expression") request.reject(new WorkerRequestError("Division by zero"));
      else request.resolve({});
      await settle();
    }
    await flight;
    expect(m.added).toHaveLength(1);
    expect(m.pinRefusal()).toBeUndefined();
    m.dispose();
  });

  test("an input refusal stops before evaluating", async () => {
    const g = guidanceWorld(), m = mount(g);
    await m.edit([literal("text"), literal(5)]);
    m.draftIssue();
    await g.runFrame();
    await g.answer(0, { issue: "Finish with Number before saving." });
    expect(g.requests).toHaveLength(1);
    expect(m.inputIssue()).toBe("Finish with Number before saving.");
    expect(m.evaluated()).toBeNull();
    m.dispose();
  });
});

describe("the expression editor's inference and result judgment come from the worker", () => {
  const nodeCode = section(editorSource, "  /** The requirement `resultGuidance` judges this slot's result against. */", "  const graphData = createMemo");
  // Include the existing checked-capture gate, ending before the neighbouring
  // pending graph-presentation context (which has its own mounted owner).
  const guidanceCode = section(editorSource, "  const resultGuidance = createMemo(() => {", "  /** Lane D (4b):");
  const captionCode = section(editorSource, "export function editorTypeCaption(", "/** B4 wave 4 lane E:");
  // Acquire the production caption helper. These inert display ports model a
  // Local reader's pending type-label packet; they supply no verdict/registry.
  const editorTypeCaption = new Function("localStructure", "valueCardTypeLabel", "editorTypePhrase", "typeNameOf", "displayTypeLabel",
    `${compiled(captionCode)}; return editorTypeCaption;`)(() => true, label => label, () => undefined, () => "Number", () => "Number");
  function mount(g, node) {
    return createRoot(dispose => {
      const frames = [], requests = [];
      const guidance = createLiveGuidance({ capture: () => ({}), sameCapture: () => true, current: () => true, key: item => JSON.stringify(item),
        send: items => { const held = deferred(); requests.push({ items, ...held }); return held.promise; },
        frame: callback => { frames.push(callback); return () => {}; } });
      const poisoned = g.world.reader.session();
      const imports = { ...g.pageAdapters, createMemo, guidance, props: { node, typeName: undefined },
        editorTypeCaption, reader: g.world.reader,
        resolvedFieldType: () => number, expectedScheme: () => ({ quantified: [], body: number }), genericSlot: () => false, inlineWidget: () => undefined,
        widgetTypeForSlot: () => undefined, expectedSchemeForType: () => undefined, session: poisoned,
        inferenceContext: () => ({ bindings: { x: number } }), typeNameOf: () => "Number", displayTypeLabel: () => "Number",
        measureAuthoringWork: (_label, work) => work(), structuralModeForNode: () => null };
      const api = new Function(...Object.keys(imports), `${compiled(nodeCode)}; ${compiled(guidanceCode)}; return { currentInference, resultGuidance, graphCaptureChecked };`)(...Object.values(imports));
      return { ...api, guidance, requests, dispose,
        runFrame: async () => { for (const callback of frames.splice(0)) callback(); await settle(); },
        answer: async (index, value) => { requests[index].resolve(value); await settle(); } };
    });
  }

  test("an untouched editor sends nothing; after an edit one item carries the node, its expectation, bindings and requirement", async () => {
    const g = guidanceWorld(), m = mount(g, call("user:make", literal(1)));
    expect(m.resultGuidance()).toBeUndefined();
    await m.runFrame();
    expect(m.requests).toHaveLength(0);
    m.guidance.touch();
    await settle();
    m.resultGuidance();
    await m.runFrame();
    expect(m.requests).toHaveLength(1);
    expect(m.requests[0].items).toEqual([{ node: call("user:make", literal(1)), expectedScheme: { quantified: [], body: number },
      bindings: { x: number }, judge: { expected: number, scheme: { quantified: [], body: number }, label: "Number" } }]);
    const judgment = { mismatch: true, message: "Finish with Number before saving.", graphIssue: { $tag: "Nothing" } };
    await m.answer(0, [{ outcome: { $tag: "Solved" }, type: { $ref: "String" }, judgment }]);
    expect(m.resultGuidance()).toEqual(judgment);
    expect(m.currentInference()).toMatchObject({ type: { $ref: "String" } });
    expect(g.page).toEqual([]);
    expect(g.world.pageReads).toEqual([]);
    m.dispose();
  });

  test("a pending answer never allows graph capture; a checked compatible answer does", async () => {
    const g = guidanceWorld(), m = mount(g, literal(1));
    m.guidance.touch();
    await settle();
    expect(m.graphCaptureChecked()).toBe(false);
    await m.runFrame();
    expect(m.graphCaptureChecked()).toBe(false);
    await m.answer(0, [{ outcome: { $tag: "Solved" }, type: number, judgment: { mismatch: false, message: undefined, graphIssue: undefined } }]);
    expect(m.graphCaptureChecked()).toBe(true);
    m.dispose();
  });

  test("an undecided verdict stays no issue for a plain value", async () => {
    const g = guidanceWorld(), m = mount(g, literal(1));
    m.guidance.touch();
    await settle();
    m.resultGuidance();
    await m.runFrame();
    await m.answer(0, [{ outcome: { $tag: "Solved" }, type: { $ref: "Mystery" }, judgment: { mismatch: false, message: undefined, graphIssue: { $tag: "Nothing" } } }]);
    expect(m.resultGuidance()).toBeUndefined();
    m.dispose();
  });

  test("reading the editor's inference context reads neither the page registry nor its evaluator", () => {
    const code = section(editorSource, "function useExpressionInferenceContext(", "function inferExpression(");
    const reads = [];
    const session = { environment: { fixture: "environment" } };
    for (const key of ["registry", "evaluateContext"]) Object.defineProperty(session, key, { get() { reads.push(key); return { fixture: key }; } });
    createRoot(dispose => {
      let membershipOptions;
      // B4 F2: a page (non-Local) session keeps its environment and judge.
      const imports = { createMemo, useContext: () => () => [], LambdaParamsContext: {}, SavedValuesContext: {},
        literalMembershipFor: (_environment, options) => { membershipOptions = options; return "membership"; },
        editorEnvironment: value => value.environment, localStructure: value => value.local === true, abstainingMembership: "abstains" };
      const use = new Function(...Object.keys(imports), `${compiled(code)}; return useExpressionInferenceContext;`)(...Object.values(imports));
      const context = use(session);
      expect(context().literalMembership).toBe("membership");
      expect(reads).toEqual([]);
      // Only a page membership judgment reads them, at judgment time.
      expect(membershipOptions.registry).toEqual({ fixture: "registry" });
      expect(reads).toEqual(["registry"]);
      // B4 F2: a Local session's page-side structure inference abstains and
      // never builds a page judge.
      membershipOptions = undefined;
      const local = { local: true, environment: { fixture: "published" } };
      expect(use(local)().literalMembership).toBe("abstains");
      expect(membershipOptions).toBeUndefined();
      dispose();
    });
  });
});

describe("a nested value draft is checked and evaluated in the worker", () => {
  const code = section(editorSource, "  function change(next: ExprNode) {", "  return <>\n    <NodeEditor node={draft()} onChange={change}");
  function mount(g, initialCapture = { fixture: "capture" }, scope) {
    const published = [], errors = [], frames = [];
    const checkOwner = scope ?? draftCheckReaderKey(g.world.reader);
    return createRoot(dispose => {
      const lane = createGuidanceLane(callback => { frames.push(callback); return () => {}; });
      // The reader's capture is reactive, as localGuidanceCapture is.
      const [capture, setCapture] = createSignal(initialCapture);
      const imports = { ...g.clients, ...g.pageAdapters, lane, reader: g.world.reader, session: g.world.reader.session(),
        saved: { list: () => [], byId: () => undefined }, setDraft() {}, setError: value => errors.push(value), publish: value => published.push(value),
        detectStructuralForm: () => null, fieldType: () => number, WorkerRequestError, createEffect, onCleanup,
        holdDraftCheck, releaseDraftCheck, checkOwner, NESTED_TOOLS_PENDING: "This reader's editing tools are not ready. Try again after preparation.",
        // Captures compare by their fields, as sameLocalGuidanceCapture does.
        sameLocalGuidanceCapture: (a, b) => a.fixture === b.fixture,
        localGuidanceCapture: () => capture(), localGuidanceCurrent: captured => !!untrack(capture) && captured.fixture === untrack(capture).fixture };
      const api = new Function(...Object.keys(imports), `let changeGeneration = 0; ${compiled(code)}; return { change };`)(...Object.values(imports));
      return { ...api, published, errors, dispose, pending: () => draftChecksPending(checkOwner),
        replaceCapture: async () => { setCapture({ fixture: "capture-two" }); await settle(); },
        loseCapture: async () => { setCapture(undefined); await settle(); },
        // A worker announcement: a new capture object, the same capture.
        recomputeCapture: async () => { setCapture({ ...untrack(capture) }); await settle(); },
        runFrame: async () => { for (const callback of frames.splice(0)) callback(); await settle(); } };
    });
  }

  test("an edit clears the parent slot at once, then the worker's check and checked evaluation publish the value", async () => {
    const g = guidanceWorld(), m = mount(g);
    m.change(call("user:make", literal(2)));
    expect(m.published).toEqual([undefined]);
    await m.runFrame();
    expect(g.requests.map(row => row.method)).toEqual(["expression-save-issue"]);
    expect(g.requests[0].args[3]).toMatchObject({ priority: "guidance" });
    expect(g.requests[0].args[3].expectedType).toBeUndefined();
    await g.answer(0, {});
    expect(g.requests[1].method).toBe("evaluate-expression");
    expect(g.requests[1].args[5]).toMatchObject({ priority: "guidance", admission: { expectedType: number } });
    await g.answer(1, { result: 4, trace: [] });
    expect(m.published).toEqual([undefined, 4]);
    expect(m.errors).toEqual([]);
    expect(g.page).toEqual([]);
    expect(g.world.pageReads).toEqual([]);
  });

  test("a newer edit drops the older answer; a changed capture asks again and publishes the value", async () => {
    const g = guidanceWorld(), m = mount(g);
    m.change(call("user:make", literal(2)));
    await m.runFrame();
    m.change(call("user:make", literal(3)));
    await g.answer(0, {});
    // The older draft's answer never publishes or evaluates.
    expect(g.requests).toHaveLength(1);
    await m.runFrame();
    expect(g.requests[1].args[1]).toEqual(call("user:make", literal(3)));
    // Another tab's write bumps the revision between request and reply.
    await m.replaceCapture();
    await g.answer(1, {});
    expect(m.pending()).toBe(true);
    await m.runFrame();
    expect(g.requests[2].args[1]).toEqual(call("user:make", literal(3)));
    await g.answer(2, {});
    await g.answer(3, { result: 6, trace: [] });
    expect(m.published).toEqual([undefined, undefined, 6]);
    expect(m.pending()).toBe(false);
    m.dispose();
  });

  test("no worker at edit time, or a transport failure, keeps the draft pending and asks when the capture returns", async () => {
    const g = guidanceWorld(), m = mount(g, null);
    m.change(call("user:make", literal(2)));
    await m.runFrame();
    expect(g.requests).toHaveLength(0);
    expect(m.pending()).toBe(true);
    await m.replaceCapture();
    await m.runFrame();
    expect(g.requests).toHaveLength(1);
    // A closed transport retires the reader's capture before the job rejects.
    await m.loseCapture();
    await g.fail(0, new Error("The authoring worker failed."));
    expect(m.pending()).toBe(true);
    expect(m.published).toEqual([undefined]);
    // The worker is replaced: the capture returns and the draft asks again.
    await m.replaceCapture();
    await m.runFrame();
    expect(g.requests).toHaveLength(2);
    await g.answer(1, {});
    await g.answer(2, { result: 4, trace: [] });
    expect(m.published).toEqual([undefined, 4]);
    expect(m.pending()).toBe(false);
    m.dispose();
  });

  for (const [failure, setup, fail] of [
    ["a missing job", g => { g.clients.expressionSaveIssueInWorker = () => undefined; }, undefined],
    ["an unreadable reply", undefined, g => g.fail(0, new Error("The authoring worker response could not be read."))],
    ["a page-side TypeError while sending", g => { g.clients.expressionSaveIssueInWorker = () => { throw new TypeError("The prepared reader operation is unavailable."); }; }, undefined],
  ]) test(`${failure} settles the check as the draft's answer and releases the hold`, async () => {
    const g = guidanceWorld();
    setup?.(g);
    const m = mount(g);
    m.change(call("user:make", literal(2)));
    await m.runFrame();
    await fail?.(g);
    await settle();
    expect(m.pending()).toBe(false);
    expect(m.errors.at(-1)).toBeDefined();
    expect(m.published).toEqual([undefined]);
    // Nothing more is asked without an edit or a capture change.
    await m.runFrame();
    expect(g.requests.map(row => row.method)).toEqual(fail ? ["expression-save-issue"] : []);
    m.dispose();
  });

  test("a pending check blocks only its own surface's Saves; an unscoped check blocks its reader's source", async () => {
    const g = guidanceWorld(), surfaceA = { surface: "A" }, surfaceB = { surface: "B" };
    const m = mount(g, undefined, surfaceA);
    m.change(call("user:make", literal(2)));
    expect(m.pending()).toBe(true);
    const save = scope => g.world.localExpressionSaveIssue(literal(1), { reader: g.world.reader, session: g.world.reader.session,
      saved: new Map(), draftScope: scope }).then(() => "admitted", error => error.message);
    const refusedA = save(surfaceA);
    const otherB = save(surfaceB);
    await settle();
    expect(await refusedA).toBe(g.world.LOCAL_SAVE_DRAFT_CHANGED);
    // Surface B's Save is not blocked: its admission was sent and answers.
    expect(g.world.requests).toHaveLength(1);
    await g.world.answer(0, {});
    expect(await otherB).toBe("admitted");
    m.dispose();
    // Two reader objects of one source share its client: an unscoped hold
    // made through one is found through the other.
    const client = { source: "tab" }, token = {};
    holdDraftCheck(draftCheckReaderKey({ kind: "local", client }), token);
    expect(localDraftChecksPending(undefined, { kind: "local", client })).toBe(true);
    expect(localDraftChecksPending(surfaceB, { kind: "local", client: { source: "other" } })).toBe(false);
    releaseDraftCheck(draftCheckReaderKey({ client }), token);
    expect(localDraftChecksPending(undefined, { client })).toBe(false);
  });

  test("a recomputed but unchanged capture does not ask a pending draft again", async () => {
    const g = guidanceWorld(), m = mount(g);
    m.change(call("user:make", literal(2)));
    await m.runFrame();
    expect(g.requests).toHaveLength(1);
    for (let index = 0; index < 3; index++) { await m.recomputeCapture(); await m.runFrame(); }
    expect(g.requests).toHaveLength(1);
    await m.replaceCapture();
    await m.runFrame();
    await g.answer(0, {});
    await m.runFrame();
    expect(g.requests).toHaveLength(2);
    m.dispose();
  });

  test("an issue settles the check and keeps the slot cleared", async () => {
    const h = guidanceWorld(), n = mount(h);
    n.change(call("user:make", literal("x")));
    await n.runFrame();
    await h.answer(0, { issue: "Finish with Number before saving." });
    expect(n.errors).toEqual([undefined, "Finish with Number before saving."]);
    expect(n.published).toEqual([undefined]);
    expect(n.pending()).toBe(false);
    n.dispose();
  });

  test("a Local Save while a nested value is pending refuses with existing copy and sends nothing", async () => {
    const g = guidanceWorld(), m = mount(g);
    m.change(call("user:make", literal(2)));
    expect(m.pending()).toBe(true);
    const refused = await g.world.localExpressionSaveIssue(literal({ field: undefined }), { reader: g.world.reader,
      session: g.world.reader.session, saved: new Map() }).then(() => undefined, error => error);
    expect(refused?.message).toBe(g.world.LOCAL_SAVE_DRAFT_CHANGED);
    expect(g.world.requests).toHaveLength(0);
    m.dispose();
    expect(m.pending()).toBe(false);
  });
});
