import { describe, expect, test } from "bun:test";
import {
  createRoot, createSignal, createMemo, createEffect, flush, latest, isPending, refresh,
} from "../../../node_modules/solid-js/dist/solid.dev.js";

// C1 scheduling/transport fixture only. Production worker branches and Home
// preview/Save bodies are extracted unchanged. Semantic adapters and browser IO
// are controlled; these tests make no inference or membership acceptance claim.
// No engine module, native table, registry or actual Worker is imported here.
const transpiler = new Bun.Transpiler({ loader: "ts" });
const workerSource = await Bun.file(new URL("./authoring-catalog-worker-main.ts", import.meta.url)).text();
const homeSource = await Bun.file(process.env.B4DRAFT_HOME ?? new URL("../../routes/app/home.tsx", import.meta.url)).text();
const asyncSource = await Bun.file(new URL("../async-value.ts", import.meta.url)).text();

function section(source, start, end) {
  const first = source.indexOf(start), last = source.indexOf(end, first + start.length);
  if (first < 0 || last < 0) throw new Error(`Production fixture boundary changed: ${start}`);
  return source.slice(first, last);
}
function noteExpression(source, prefix) {
  const start = source.indexOf(`note={${prefix}`), end = source.indexOf("declared={", start);
  if (start < 0 || end < 0) throw new Error(`Production TypeContract note boundary changed: ${prefix}`);
  const expression = source.slice(start + "note={".length, end).trim();
  if (!expression.endsWith("}")) throw new Error(`Production TypeContract note did not close: ${prefix}`);
  return expression.slice(0, -1);
}
const compiled = source => transpiler.transformSync(source).replace(/^export /gm, "");
const workerCode = compiled(workerSource.slice(workerSource.indexOf("const scope =")))
  .replaceAll("import.meta.env.BASE_URL", '"/"');
const modal = section(homeSource, "function NewFunctionModal(", "/** Insert `child`");
const lifetimeCode = section(modal, "  let dismissed = false;", "  const authoredSubmission =");
const authoredCode = section(modal, "  const authoredSubmission =", "  // The outer record");
const stepsInputCode = modal.includes("  const newFunctionDefinition =")
  ? section(modal, "  const newFunctionDefinition =", "  const newFunctionAuthoringSession =") : "";
const previewCode = section(modal, "  type LocalFunctionPreviewRequest =", "  const inferredPresentation =");
const inferredPresentationCode = section(modal, "  const inferredPresentation =", "  const resultType =");
const newNoteExpression = noteExpression(modal, "resultMode()");
const resultCode = section(modal, "  const resultType =", "  async function save()");
const saveCode = section(modal, "  async function save()", "\n  return (");
const definitionSaveCode = section(homeSource, "    saveDefinitionWithRepresentations: async (", "    addToLocus:");
const savedModal = section(homeSource, "function EditModalContent(", "// NewValueModal");
const savedLifetimeCode = section(savedModal, "  let dismissed = false;", "  // Vertical-stack mode");
const savedInitialArrowCode = section(savedModal, "  const initialArrowDraft =", "  const [arrowDraft");
const savedHasBodyCode = section(savedModal, "  const functionHasBody =", "\n");
const savedInitializeCode = section(savedModal, "  let initializedFunctionId:", "  const functionDefinitionChanged =");
const savedDefinitionChangedCode = section(savedModal, "  const functionDefinitionChanged =", "  const functionSignatureShapeIssue =");
const savedShapeIssueCode = section(savedModal, "  const functionSignatureShapeIssue =", "  const functionOwnedScheme =");
const savedDeclarationCode = section(savedModal, "  const functionDeclaration =", "  let approvedFunctionFields:");
const savedConflictCode = section(savedModal, "  const sourceConflict =", "  async function save()");
const savedBodyReturnCode = section(savedModal, "  const functionBodyReturnType =", "  type LocalSavedFunctionPreviewRequest =");
const savedPreviewCode = section(savedModal, "  type LocalSavedFunctionPreviewRequest =", "  const functionResultType =");
const savedResultCode = section(savedModal, "  const functionResultType =", "  // Type-reference detection");
const savedInferringCode = section(savedModal, "                    const inferring =", "\n");
const savedNoteExpression = noteExpression(savedModal, "inferring()");
const savedSaveCode = section(savedModal, "  async function save()", "\n  return (");
const savedOwnerCode = section(homeSource, "function persistedFunctionDefinition(", "function inspectionFunctionEntry(");
// B4 unit D item 2: the production split of a lowered draft reply (Home).
const splitLoweredFunctionDraft = new Function(compiled(`${section(homeSource, "function splitLoweredFunctionDraft(", "/** Every live value belongs")}
  return splitLoweredFunctionDraft;`))();
const savedItemCallbackCode = section(homeSource, "            onSaveItem={async (item, expr, definitionBundle, occurrenceChanged = true, assertCurrent, signal) => {", "\n            onClose=")
  .trim().replace(/^onSaveItem=\{/, "").slice(0, -1);
import { localWorld } from "./local-save-admission.fixture.mjs";
const createAsyncValue = new Function("createMemo", "createSignal", "isPending", "refresh",
  `${compiled(asyncSource.slice(asyncSource.indexOf("const LOADING:")))}; return createAsyncValue;`)
  (createMemo, createSignal, isPending, refresh);

const clone = value => structuredClone(value);
const deferred = () => {
  let resolve, reject;
  const promise = new Promise((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
};
async function settle() {
  for (let turn = 0; turn < 8; turn++) { await Promise.resolve(); flush(); }
}
const node = value => ({ kind: "literal", value });
const inference = (marker = "first") => ({
  outcome: { $tag: "Solved", diagnostics: [] },
  fn: { id: "draft-id", params: [], returns: { $ref: `Inferred-${marker}` }, body: marker },
  scheme: { quantified: [{ id: "stable-a", sourceName: "a", kind: { $tag: "KType" } }],
    body: { $arrow: { params: [], returns: { $ref: `Inferred-${marker}` } } },
    nominals: [{ path: ["$arrow", "returns"], identity: "result-owner", publicName: marker }],
    applications: [{ path: [], owner: "application-owner", arguments: [] }] },
  additionalEvidence: { marker, kept: false, empty: "" },
});

function workerHarness() {
  const replies = [], calls = [], snapshots = [], turns = [];
  const session = { registry: { fixture: "exact-registry" }, environment: { fixture: "exact-environment" },
    evaluateContext: { fixture: "base-frame", metadata: { generation: "base" } } };
  let result = inference(), issue;
  let evaluated = "worker value", evaluationFailure;
  const imports = {
    globalThis: { postMessage: value => replies.push(clone(value)) }, initialSession: session,
    isReaderExtensionMethod: () => false,
    registryTransportSnapshot(value, label) { snapshots.push(label); return clone(value); },
    inferAuthoringFunctionDraft(...args) { calls.push({ method: "infer", args }); return result; },
    // B4 unit D item 2: the editor's lowering adapter (a fixture codec here).
    authoringExpressionLogic(value, resolver, owner) {
      calls.push({ method: "lower", args: [value, owner] });
      return value.kind === "ref" ? resolver(value.savedExprId) : { fixtureLowered: value.value };
    },
    functionBodySaveIssue(...args) { calls.push({ method: "body", args }); return issue; },
    draftSaveIssue(...args) { calls.push({ method: "value", args, saved: args[2].resolveSavedExpr?.("saved-source") }); return issue; },
    evaluateAuthoringExpressionInSession(...args) {
      calls.push({ method: "evaluate", args, saved: args[1]("saved-source") });
      if (evaluationFailure) throw evaluationFailure;
      return { result: evaluated, trace: [] };
    },
    restoreSavedExpressionDeclarations(saved, entries) {
      calls.push({ method: "restore-saved", args: [entries] });
      for (const [id, declaration] of entries ?? []) if (saved.has(id)) saved.set(id, { ...saved.get(id), fixtureDeclaration: declaration });
    },
    restoreSavedExpressionDeclaration(value, declaration) {
      calls.push({ method: "restore", args: [value, declaration] });
      return { ...value, fixtureDeclaration: declaration };
    },
    readerSourceMetadataEvaluateContext(base, packet) { return packet ? { ...base, metadata: packet } : base; },
    setTimeout(callback) { turns.push(callback); return turns.length; },
  };
  const api = new Function(...Object.keys(imports), `${workerCode}; base = initialSession;
    return { run, cancelled, currentBase: () => base };`)(...Object.values(imports));
  const start = request => api.run(clone(request));
  const release = async () => { for (const callback of turns.splice(0)) callback(); await settle(); };
  return { session, calls, snapshots, replies, api, start, release,
    setResult: value => { result = value; }, setIssue: value => { issue = value; },
    setEvaluated: value => { evaluated = value; }, failEvaluation: error => { evaluationFailure = error; },
    async run(request) { const flight = start(request); await release(); await flight; return replies.filter(row => "ok" in row).at(-1); } };
}

describe("function draft worker forwards existing semantic adapters", () => {
  test("whole inference result and false/empty bodies cross the actual worker branch unchanged", async () => {
    const h = workerHarness(), result = inference("complete-sidecars"); h.setResult(result);
    for (const body of [false, ""]) {
      const request = { id: h.replies.length + 1, method: "infer-function-draft", contextId: 0,
        fn: { id: "draft-id", params: [], returns: { $ref: "Auto" }, body },
        declaration: { params: [], returns: { $tag: "Absent" }, scheme: result.scheme } };
      const before = clone(request), answer = await h.run(request);
      expect(answer).toEqual({ id: request.id, ok: true, result });
      expect(request).toEqual(before);
      const captured = h.calls.filter(row => row.method === "infer").at(-1).args;
      expect(captured[0]).toEqual(request.fn); expect(captured[1]).toEqual(request.declaration);
      expect(captured[2]).toBe(h.session.environment); expect(captured[3]).toEqual({ registry: h.session.registry });
    }
    expect(h.snapshots).toContain("worker function draft request");
    expect(h.snapshots).toContain("worker function draft result");
  });

  test("B4 unit D item 2: a Local draft body is lowered in the same request, inferred, and crosses back", async () => {
    const h = workerHarness(), result = inference("lowered"); h.setResult(result);
    const refusal = "Use a parameter for saved data in a function body.";
    const request = { id: 1, method: "infer-function-draft", contextId: 0,
      fn: { id: "draft-id", params: [], returns: { $ref: "Auto" } }, declaration: { params: [], returns: { $tag: "Absent" }, scheme: result.scheme },
      lowerBody: { node: node({ b: 2, a: 1 }), refusal } };
    const answer = await h.run(request);
    expect(answer).toEqual({ id: 1, ok: true, result: { ...result, loweredBody: { fixtureLowered: { b: 2, a: 1 } } } });
    // The authored key order reaches the saved body.
    expect(Object.keys(answer.result.loweredBody.fixtureLowered)).toEqual(["b", "a"]);
    const lowered = h.calls.find(row => row.method === "lower").args;
    expect(lowered[0]).toEqual(request.lowerBody.node); expect(lowered[1]).toBe(h.session);
    const inferred = h.calls.find(row => row.method === "infer").args;
    expect(inferred[0]).toEqual({ ...request.fn, body: { fixtureLowered: { b: 2, a: 1 } } });
    // A saved reference refuses the request with the editor's sentence.
    const refused = await h.run({ ...request, id: 2, lowerBody: { node: { kind: "ref", savedExprId: "saved" }, refusal } });
    expect(refused).toEqual({ id: 2, ok: false, error: refusal });
    expect(h.calls.filter(row => row.method === "infer")).toHaveLength(1);
  });

  test("body Save checking restores its declaration and uses an isolated per-job metadata frame", async () => {
    const h = workerHarness(); h.setIssue("controlled refusal");
    const source = { params: [], returns: { $tag: "Absent" } };
    for (const generation of ["job-one", "job-two"]) {
      const packet = { generation };
      const request = { id: h.replies.length + 1, method: "function-body-save-issue", contextId: 0,
        node: node(false), definition: { id: "draft-id", params: [], returns: { $ref: "Boolean" } },
        rootDeclaration: source, sourceMetadata: packet };
      const answer = await h.run(request);
      expect(answer).toEqual({ id: request.id, ok: true, result: { issue: "controlled refusal" } });
      const call = h.calls.filter(row => row.method === "body").at(-1).args;
      expect(call[0]).toEqual({ ...request.node, fixtureDeclaration: source });
      expect(call[1]).toEqual(request.definition); expect(call[2]).toBe(h.session.environment);
      expect(call[3].registry).toBe(h.session.registry);
      expect(call[3].evaluateContext).not.toBe(h.session.evaluateContext);
      expect(call[3].evaluateContext.metadata).toEqual(packet);
      expect(h.session.evaluateContext.metadata).toEqual({ generation: "base" });
    }
    expect(h.snapshots).toContain("worker function body save request");
    expect(h.snapshots).toContain("worker function body save result");
  });

  test("expression Save admission runs the existing draftSaveIssue with the page inputs and same-request evaluation", async () => {
    const h = workerHarness(); h.setIssue("controlled value refusal"); h.setEvaluated(0);
    const packet = { generation: "save-job" }, declaration = { type: { $ref: "Declared" } }, rootDeclaration = { type: { $ref: "Root" } };
    const request = { id: 1, method: "expression-save-issue", contextId: 0, node: node("draft"),
      savedExpressions: [["saved-source", node(2)]], savedDeclarations: [["saved-source", declaration]], rootDeclaration,
      expectedType: { $ref: "Number" }, expectedScheme: { quantified: [], body: { $ref: "Number" } },
      expectedTypeName: "Number", actualTypeName: "Text", evaluate: true, sourceMetadata: packet };
    const answer = await h.run(request);
    expect(answer).toEqual({ id: 1, ok: true, result: { issue: "controlled value refusal" } });
    const evaluation = h.calls.find(row => row.method === "evaluate");
    const check = h.calls.find(row => row.method === "value");
    expect(h.calls.map(row => row.method)).toEqual(["restore-saved", "restore", "evaluate", "value"]);
    // One restored node and saved roster serve both evaluation and admission.
    expect(evaluation.args[0]).toEqual({ ...request.node, fixtureDeclaration: rootDeclaration });
    expect(check.args[0]).toBe(evaluation.args[0]);
    expect(evaluation.saved).toEqual({ ...node(2), fixtureDeclaration: declaration });
    expect(check.saved).toEqual(evaluation.saved);
    expect(evaluation.args[2].evaluateContext.metadata).toEqual(packet);
    expect(evaluation.args[4]).toMatchObject({ trace: false, sourceMetadata: { packet } });
    expect(check.args[1]).toBe(h.session.environment);
    const options = check.args[2];
    expect(options.registry).toBe(h.session.registry);
    expect(options.evaluateContext).toBe(evaluation.args[2].evaluateContext);
    expect(options.evaluateContext.metadata).toEqual(packet);
    expect(h.session.evaluateContext.metadata).toEqual({ generation: "base" });
    expect(Object.hasOwn(options, "evaluatedValue")).toBe(true);
    expect(options.evaluatedValue).toBe(0);
    expect(options).toMatchObject({ expectedType: request.expectedType, expectedScheme: request.expectedScheme,
      expectedTypeName: "Number", actualTypeName: "Text" });
    expect(JSON.stringify(answer)).not.toContain("worker value");
    expect(h.snapshots).toContain("worker expression save result");
  });

  test("expression Save admission without evaluate passes no evaluated value, and an evaluation failure refuses", async () => {
    const h = workerHarness();
    const plain = await h.run({ id: 1, method: "expression-save-issue", contextId: 0, node: node(1), savedExpressions: [] });
    expect(plain).toEqual({ id: 1, ok: true, result: {} });
    expect(h.calls.some(row => row.method === "evaluate")).toBe(false);
    const options = h.calls.find(row => row.method === "value").args[2];
    expect(Object.hasOwn(options, "evaluatedValue")).toBe(false);
    expect(Object.hasOwn(options, "expectedType")).toBe(false);
    expect(options.evaluateContext).toBe(h.session.evaluateContext);
    const failing = workerHarness(); failing.failEvaluation(new Error("Division by zero"));
    const refused = await failing.run({ id: 2, method: "expression-save-issue", contextId: 0, node: node(1), savedExpressions: [], evaluate: true });
    expect(refused).toEqual({ id: 2, ok: false, error: "Division by zero" });
    expect(failing.calls.some(row => row.method === "value")).toBe(false);
  });

  test("cancellation during the actual pre-adapter yield calls neither semantic adapter", async () => {
    for (const method of ["infer-function-draft", "function-body-save-issue", "expression-save-issue"]) {
      const h = workerHarness();
      const flight = h.start({ id: 7, method, contextId: 0, fn: {}, declaration: {}, node: node(0), definition: {}, savedExpressions: [], evaluate: true });
      h.api.cancelled.add(7); await h.release(); await flight;
      expect(h.calls).toEqual([]);
      expect(h.replies.filter(row => "ok" in row)).toEqual([]);
    }
  });
});

function homeHarness(options = {}) {
  const kind = Object.hasOwn(options, "kind") ? options.kind : "local";
  const { missingWorker = false, initialBody = node("first"), initialResultMode = "infer", initialHasBody = true,
    holdPublication, fetchedRootRevision = 4 } = options;
  let disposeRoot;
  const result = createRoot(dispose => {
    disposeRoot = dispose;
    const [body, setBody] = createSignal(initialBody), [paramsType, setParamsType] = createSignal(options.initialParamsType ?? { $record: { fields: [] } });
    const [returnsType, setReturnsType] = createSignal({ $ref: "Authored" }), [resultMode, setResultMode] = createSignal(initialResultMode);
    const [requires, setRequires] = createSignal(), [hasBody, setHasBody] = createSignal(initialHasBody);
    const [genericIssue, setGenericIssue] = createSignal(), [activeStepsIssue, setStepsIssue] = createSignal();
    const [reps, setReps] = createSignal({}), [schemeMetadata] = createSignal({ quantified: [] });
    const [authoredFacetRevision] = createSignal(0), [saving, setSaving] = createSignal(false), [saveError, setSaveError] = createSignal(null);
    const [epoch, setEpoch] = createSignal(1), [revision, setRevision] = createSignal(4);
    const [worker, setWorker] = createSignal({ fixture: "worker-one" }), [available, setAvailable] = createSignal(!missingWorker);
    const [workerNotification, setWorkerNotification] = createSignal(0);
    // B4 unit D item 2: a Steps edit being raised in the worker.
    const [stepsPending, setStepsPending] = createSignal(false);
    const makeSession = label => ({ label, environment: { label }, registry: { label }, evaluateContext: { label } });
    const [base, setBase] = createSignal(makeSession("base")), [draft, setDraft] = createSignal(makeSession("draft"));
    const [metadata, setMetadata] = createSignal({ generation: "metadata-one" });
    const toolsRetries = [];
    const reader = { kind, session: base, revision, registry: () => base().registry,
      retryPresentation: () => { const held = deferred(); toolsRetries.push(held); return held.promise; } };
    const paramFields = () => paramsType().$record.fields;
    const declaration = createMemo(() => ({ params: paramFields().map(() => ({ $tag: "Authored" })),
      returns: resultMode() === "infer" ? { $tag: "Absent" } : { $tag: "Authored" },
      scheme: { ...schemeMetadata(), body: { $arrow: { params: paramFields(), returns: returnsType() } } } }));
    const functionId = () => "draft-id", fnName = () => "";
    const newFunctionAuthoringSession = draft, homeAuthoringSession = base;
    const fieldResurrections = { fieldIds: () => [] }, fieldFacets = () => ({});
    const nestedChecks = [], transports = [], submissions = [], writes = [], additions = [], metadataReads = [], syncCalls = [], cleanups = [], ioEvents = [];
    const scopeSelections = [], scopedHandles = [];
    const preparedHandles = new WeakMap();
    const preparedHandleFor = session => {
      workerNotification();
      if (!available()) return undefined;
      const token = worker();
      let tokens = preparedHandles.get(session);
      if (!tokens) { tokens = new WeakMap(); preparedHandles.set(session, tokens); }
      let handle = tokens.get(token);
      if (!handle) { handle = { fixtureBase: session, token }; tokens.set(token, handle); }
      return handle;
    };

    const publication = deferred();
    let closes = 0, syncIssue, syncResult = inference("sync");
    const props = { onClose: () => { closes++; } };
    // B4 unit E: a Local reader encodes through its worker encoding (an opaque token here).
    const instanceEncoding = Object.freeze({ encodeInstances: async () => { throw new Error("Unexpected encoding"); } });
    const client = {
      drafts: undefined,
      ...(kind === "local" ? { instanceEncoding: () => instanceEncoding } : {}),
      getLocusRoot: async () => {
        ioEvents.push("root-read");
        if (holdPublication === "root") await publication.promise;
        return { root: { revision: fetchedRootRevision } };
      },
      api: { definitionBundleSave: async bundle => {
        writes.push({ method: "definition", bundle: clone(bundle) }); return { fixture: "committed" };
      } },
      editDefinitionAndData: kind === "local" ? async (bundle, expectedRevision, mutation) => {
        writes.push({ method: "atomic", bundle: clone(bundle), expectedRevision,
          representations: clone(mutation.representations), encodingRegistry: mutation.encodingRegistry });
        return { fixture: "committed" };
      } : undefined,
    };
    const definitionImports = {
      reader, client, accountFieldRegistry: () => base().registry,
      representationWrites: async () => {
        ioEvents.push("representation-read");
        if (holdPublication === "representations") await publication.promise;
        return [];
      },
      persistRepresentations: async () => { ioEvents.push("persist-representations"); },
    };
    const definitionHelper = new Function(...Object.keys(definitionImports), compiled(`return {
      ${definitionSaveCode}
    }.saveDefinitionWithRepresentations;`))(...Object.values(definitionImports));
    const imports = {
      createMemo, createEffect, latest, refresh, createAsyncValue,
      onSettled: setup => { const cleanup = setup(); if (cleanup) cleanups.push(cleanup); },
      body, paramsType, returnsType, resultMode, requires, hasBody, genericIssue, activeStepsIssue, reps, schemeMetadata,
      authoredFacetRevision, saving, setSaving, saveError, setSaveError,
      reader, paramFields, declaration, functionId, fnName, newFunctionAuthoringSession, homeAuthoringSession,
      fieldResurrections, fieldFacets, props,
      concreteAuthoringSession: session => session,
      preparedReaderWorkerForSession: preparedHandleFor,
      localAuthoringScopeForSession: session => {
        scopeSelections.push(session); return { sourceId: "tab-id", functions: [], draft: { id: "draft-id", session: session.label } };
      },
      scopePreparedReaderWorker: (handle, scope) => { const scoped = { handle, scope }; scopedHandles.push(scoped); return scoped; },
      authoringWorkerSnapshot: () => { workerNotification(); return worker(); }, sessionEpoch: epoch,
      assertCurrentSession: captured => { if (captured !== epoch()) throw new Error("Stale browser epoch"); },
      captureReaderSourceMetadata: session => { metadataReads.push(session); return { session, packet: metadata() }; },
      assertReaderSourceMetadata: (capture, session) => {
        if (capture.session !== session || capture.packet !== metadata()) throw new Error("Source metadata changed");
      },
      // B4 fix round 2: no nested value check is pending in these fixtures.
      localDraftChecksPending: (scope, reader) => { nestedChecks.push({ scope, reader }); return options.nestedPending ?? false; }, draftScope: { fixture: "surface-scope" },
      LOCAL_SAVE_DRAFT_CHANGED: "The draft changed while it was being checked. Save again.",
      runPreparedReaderWorker: (handle, payload, signal) => {
        // B4 unit D item 2: a Local draft body is lowered by the worker in the
        // same `infer-function-draft` request (`lowerBody`), whose reply carries
        // `loweredBody`. This stand-in worker lowers it with the fixture codec
        // (refusing saved references with the request's sentence) and records
        // the request as the worker then infers it (`fn.body`); the request's
        // own shape is pinned in local-reader-actions.test.mjs.
        if (payload.method === "infer-function-draft" && payload.lowerBody) {
          const { lowerBody, ...rest } = payload;
          let lowered, refusal;
          try { lowered = imports.toLogic(lowerBody.node, () => { throw new Error(lowerBody.refusal); }); }
          catch (error) { refusal = error; }
          const held = deferred();
          const row = { handle, payload: clone({ ...rest, fn: { ...rest.fn, body: lowered } }), signal, lowerBody: clone(lowerBody),
            resolve: value => held.resolve(value && typeof value === "object" && !Object.hasOwn(value, "loweredBody") ? { ...value, loweredBody: clone(lowered) } : value),
            reject: held.reject, promise: held.promise };
          transports.push(row);
          if (refusal) { held.reject(refusal); return held.promise; }
          if (options.immediateInference) Promise.resolve().then(() => row.resolve(inference(String(lowered))));
          return held.promise;
        }
        const held = deferred(); transports.push({ handle, payload: clone(payload), signal, ...held });
        if (options.immediateInference && payload.method === "infer-function-draft") {
          Promise.resolve().then(() => held.resolve(inference(String(payload.fn.body))));
        }
        return held.promise;
      },
      // B4 unit D item 2: no Steps edit is being applied in these fixtures.
      splitLoweredFunctionDraft, localStepsPending: () => stepsPending(),
      // B4 wave 4 lane H: no signature edit is being reconciled in these fixtures.
      localSignature: undefined,
      toLogic: (value, resolver) => {
        if (value.kind === "ref") return resolver(value.savedExprId);
        return value.kind === "literal" ? clone(value.value) : { fixtureLowered: clone(value) };
      },
      inferAuthoringFunctionDraft: (...args) => { syncCalls.push({ method: "infer", args }); return syncResult; },
      projectAuthoringInferenceOutcome: outcome => ({ label: outcome.fixtureLabel ?? `Controlled ${outcome.$tag} annotation` }),
      functionBodySaveIssue: (...args) => { syncCalls.push({ method: "body", args }); return syncIssue; },
      savedExpressionDeclaration: value => value.fixtureDeclaration,
      cloneDraftValue: clone, assertAppearanceDrafts: () => {},
      desiredFieldFacetValues: () => [], fieldFacetReplacementIds: () => [],
      saveDefinitionWithRepresentations: (...args) => { submissions.push(args); return definitionHelper(...args); },
      revalidate: () => {}, reloadUserRegistries: async () => {},
      locusAdd: async (...args) => { additions.push(clone(args)); return true; },
      locusCatalogReference: id => ({ $ref: id }), repString: () => "",
    };
    const api = new Function(...Object.keys(imports), compiled(`${lifetimeCode}\n${authoredCode}\n${stepsInputCode}\n${previewCode}\n${inferredPresentationCode}\n${resultCode}\n${saveCode}
      return { preview: functionPreview, asyncValue: localFunctionPreview, job: localFunctionPreviewJob, assertCurrent: assertLocalFunctionPreview,
        note: () => (${newNoteExpression}), resultType, retryTools: retryFunctionTools, save, close, error: saveError, saving, submitted: authoredSubmission };`))(...Object.values(imports));
    const observations = [];
    if (options.observePreview) createEffect(() => api.asyncValue(), value => { observations.push(value); });
    return { api, instanceEncoding, nestedChecks, transports, toolsRetries, submissions, writes, additions, metadataReads, syncCalls, cleanups, ioEvents, scopeSelections, scopedHandles, observations,
      closes: () => closes, base, draft, body, declaration,
      setBody, setParamsType, setReturnsType, setResultMode, setRequires, setHasBody, setGenericIssue, setStepsIssue, setReps, setStepsPending,
      setEpoch, setRevision, setWorker, setAvailable, setMetadata,
      replaceBase: () => setBase(makeSession("base-replaced")), replaceDraft: () => setDraft(makeSession("draft-replaced")),
      setSyncIssue: value => { syncIssue = value; }, setSyncResult: value => { syncResult = value; },
      releasePublication: () => publication.resolve(),
      notifyWorkers: () => setWorkerNotification(value => value + 1),
    };
  });
  result.dispose = () => { for (const cleanup of result.cleanups.splice(0)) cleanup(); disposeRoot(); };
  return result;
}
async function withHome(options, run) {
  const h = homeHarness(options);
  try { await run(h); } finally { h.dispose(); }
}

describe("Local NewFunction uses its captured worker flight", () => {
  test("explicit tools Retry re-asks a failed current preview without replacing its authored draft", async () => {
    const field = { name: "input", type: { $ref: "Number" }, key: { $tag: "NamedField", ref: { $ref: "field-uuid" } } };
    await withHome({ initialParamsType: { $record: { fields: [field] } } }, async h => {
      h.api.preview(); h.transports[0].reject(new Error("controlled worker failure")); await settle();
      expect(h.api.preview().error).toBe("controlled worker failure");
      const submitted = h.api.submitted(), base = h.base(), draft = h.draft();
      const retry = h.api.retryTools(); expect(h.toolsRetries).toHaveLength(1);
      expect(h.transports).toHaveLength(1); expect(h.writes).toEqual([]);
      h.toolsRetries[0].resolve(true); await retry; h.api.preview(); await settle();
      expect(h.transports).toHaveLength(2);
      expect(h.transports[1].payload.fn.id).toBe(h.transports[0].payload.fn.id);
      expect(h.transports[1].payload.fn.params).toEqual([field]);
      expect(h.transports[1].lowerBody).toEqual(h.transports[0].lowerBody);
      expect(h.api.submitted()).toBe(submitted); expect(h.base()).toBe(base); expect(h.draft()).toBe(draft);
      h.transports[1].resolve(inference("restored")); await settle();
      expect(h.api.preview().error).toBeUndefined(); expect(h.api.preview().result).toEqual(inference("restored"));
      expect(h.writes).toEqual([]); expect(h.additions).toEqual([]); expect(h.closes()).toBe(0);
    });
  });

  test("tools restoration's replacement preview is reused without a duplicate refresh", async () => withHome({}, async h => {
    h.api.preview(); h.transports[0].reject(new Error("closed realm")); await settle();
    const submitted = h.api.submitted(), body = h.body();
    const retry = h.api.retryTools();
    h.setWorker({ fixture: "restored-realm" }); h.replaceBase(); h.replaceDraft(); flush();
    h.api.preview(); expect(h.transports).toHaveLength(2);
    h.toolsRetries[0].resolve(true); await retry; h.api.preview(); await settle();
    expect(h.transports).toHaveLength(2); expect(h.api.submitted()).toBe(submitted); expect(h.body()).toBe(body);
    h.transports[1].resolve(inference("replacement")); await settle();
    expect(h.api.preview().result).toEqual(inference("replacement")); expect(h.writes).toEqual([]);
  }));

  test("a successful preview is not repeated when tools Retry continues another current operation", async () => withHome({}, async h => {
    h.api.preview(); h.transports[0].resolve(inference("already checked")); await settle();
    let continued = 0;
    const retry = h.api.retryTools(() => { continued++; });
    h.toolsRetries[0].resolve(true); await retry; h.api.preview(); await settle();
    expect(continued).toBe(1); expect(h.transports).toHaveLength(1); expect(h.writes).toEqual([]);
  }));

  test("presentation metadata changed during pure tools Retry stays authored without blocking that current preview", async () => withHome({}, async h => {
    h.api.preview(); h.transports[0].reject(new Error("controlled worker failure")); await settle();
    const retry = h.api.retryTools();
    const appearance = { Labelable: { label: "Label authored during tools restoration" } };
    h.setReps(appearance); flush();
    const submitted = h.api.submitted();
    h.toolsRetries[0].resolve(true); await retry; h.api.preview(); await settle();
    expect(h.transports).toHaveLength(2); expect(h.api.submitted()).toBe(submitted);
    expect(h.api.submitted().representations).toBe(appearance);
    h.transports[1].resolve(inference("restored")); await settle();
    expect(h.api.preview().result).toEqual(inference("restored")); expect(h.writes).toEqual([]);
  }));

  for (const changed of ["refused", "undefined", "dismissed", "epoch", "revision", "body"]) test(
    `tools Retry does not re-ask or continue an old operation after ${changed}`, async () => withHome({}, async h => {
      h.api.preview(); h.transports[0].reject(new Error("closed realm")); await settle();
      let continued = 0;
      const retry = h.api.retryTools(() => { continued++; });
      if (changed === "dismissed") h.api.close();
      if (changed === "epoch") h.setEpoch(2);
      if (changed === "revision") h.setRevision(5);
      if (changed === "body") h.setBody(node("newer draft"));
      flush();
      const requests = h.transports.length;
      h.toolsRetries[0].resolve(changed === "undefined" ? undefined : changed !== "refused"); await retry; await settle();
      expect(continued).toBe(0); expect(h.writes).toEqual([]); expect(h.additions).toEqual([]);
      expect(h.transports).toHaveLength(requests);
      if (changed === "refused" || changed === "undefined") {
        expect(h.transports).toHaveLength(1); expect(h.api.preview().error).toBe("closed realm");
      }
      if (changed === "body") expect(h.body()).toEqual(node("newer draft"));
    }));

  test("an unheld next-microtask preview accepts an ordinary edit without duplicate work", async () => withHome({
    observePreview: true, immediateInference: true,
  }, async h => {
    await settle(); expect(h.observations.at(-1)).toEqual(inference("first"));
    const handle = latest(h.api.job).request.handle;
    h.setBody(node("immediate-edit")); flush(); await settle();
    expect(h.observations.at(-1)).toEqual(inference("immediate-edit"));
    expect(h.api.preview().error).toBeUndefined(); expect(h.transports).toHaveLength(2);
    expect(latest(h.api.job).request.handle).toBe(handle); expect(h.scopedHandles).toHaveLength(1);
  }));

  test("the observed client async accessor accepts an ordinary completed-to-edited preview", async () => withHome({ observePreview: true }, async h => {
    await settle(); h.transports[0].resolve(inference("committed")); await settle();
    expect(h.observations.at(-1)).toEqual(inference("committed"));
    const handle = latest(h.api.job).request.handle;
    h.setBody(node("ordinary-edit")); flush(); await settle();
    expect(h.transports).toHaveLength(2);
    const edited = latest(h.api.job);
    expect(edited.request.handle).toBe(handle);
    h.transports[1].resolve(inference("ordinary-edit"));
    await expect(edited.promise).resolves.toEqual(inference("ordinary-edit")); await settle();
    expect(h.observations.at(-1)).toEqual(inference("ordinary-edit"));
    expect(h.api.preview().error).toBeUndefined(); expect(h.transports).toHaveLength(2);
  }));

  test("Save captures the latest pending authored intent before the committed predecessor", async () => withHome({ observePreview: true }, async h => {
    await settle(); h.transports[0].resolve(inference("committed")); await settle();
    const rootDeclaration = { captured: "latest-root-declaration" };
    h.setBody({ ...node("latest-save"), fixtureDeclaration: rootDeclaration });
    // No flush or latest job pull: the actual Save event must capture this edit.
    const flight = h.api.save(); await settle();
    expect(h.transports).toHaveLength(2); expect(h.transports[1].payload.fn.body).toBe("latest-save");
    h.transports[1].resolve(inference("latest-save")); await settle();
    expect(h.transports[2].payload).toMatchObject({ method: "function-body-save-issue", node: { value: "latest-save" },
      rootDeclaration, definition: { body: "latest-save" } });
    h.transports[2].resolve({}); await flight;
    expect(h.writes).toHaveLength(1);
    expect(h.writes[0].bundle.ownerMutations[0].owner.definition.body).toBe("latest-save");
  }));

  test("one immutable draft scopes once across body edits and unrelated worker notifications", async () => withHome({}, async h => {
    h.api.preview(); const original = h.api.job().request;
    expect(h.scopeSelections).toHaveLength(1); expect(h.scopedHandles).toHaveLength(1);
    h.setBody(node("body-two")); flush();
    expect(h.api.job().request.handle).toBe(original.handle);
    expect(h.scopeSelections).toHaveLength(1); expect(h.scopedHandles).toHaveLength(1);
    const flights = h.transports.length; h.notifyWorkers(); flush();
    expect(h.api.job().request.handle).toBe(original.handle); expect(h.transports).toHaveLength(flights);
    expect(h.scopedHandles).toHaveLength(1);
    // The transport fixture controls immutable draft sessions. A signature
    // edit publishes a new such session through the existing reader owner.
    h.setReturnsType({ $ref: "ChangedSignature" }); h.replaceDraft(); flush();
    expect(h.api.job().request.handle).not.toBe(original.handle);
    expect(h.scopeSelections).toHaveLength(2); expect(h.scopedHandles).toHaveLength(2);
  }));

  test("a completed inferred return is unavailable during the next pending preview", async () => withHome({}, async h => {
    h.api.preview(); h.transports[0].resolve(inference("ready")); await settle();
    expect(h.api.preview().result).toEqual(inference("ready"));
    expect(h.api.resultType()).toEqual(inference("ready").fn.returns);
    h.setBody(node("pending-next")); flush();
    expect(h.api.preview().result).toBeUndefined(); expect(h.api.resultType()).toBeUndefined();
    h.transports[1].resolve(inference("next")); await settle();
    expect(h.api.resultType()).toEqual(inference("next").fn.returns);
  }));

  test("pending hides an older inferred result and out-of-order completion cannot replace the newer body", async () => withHome({}, async h => {
    expect(h.api.preview().result).toBeUndefined();
    const first = h.api.job(), one = h.transports[0];
    h.setBody(node("second")); flush();
    expect(h.api.preview().result).toBeUndefined();
    const second = h.api.job(), two = h.transports[1];
    expect(second.request).not.toBe(first.request); expect(one.signal.aborted).toBe(true);
    expect(two.payload.fn.body).toBe("second");
    two.resolve(inference("second")); await settle();
    expect(h.api.preview().result).toEqual(inference("second"));
    one.resolve(inference("first")); await expect(first.promise).rejects.toThrow(); await settle();
    expect(h.api.preview().result).toEqual(inference("second"));
    expect(h.syncCalls).toEqual([]);
  }));

  test("source metadata uses the base and an empty-representation Save retains its checked revision", async () => withHome({ fetchedRootRevision: 99,
    initialBody: { ...node(false), fixtureDeclaration: { captured: "root-declaration" } } }, async h => {
    h.api.preview(); const flight = h.api.save(); await settle();
    expect(h.metadataReads.length).toBeGreaterThan(0); expect(h.metadataReads.every(session => session === h.base())).toBe(true);
    expect(h.metadataReads).not.toContain(h.draft());
    h.transports[0].resolve(inference("false")); await settle();
    const gate = h.transports[1];
    expect(gate.payload.method).toBe("function-body-save-issue");
    expect(gate.payload.rootDeclaration).toEqual({ captured: "root-declaration" });
    expect(gate.payload.sourceMetadata).toEqual({ generation: "metadata-one" });
    expect(gate.payload.definition.body).toBe(false);
    expect(gate.payload.definition.returns).toEqual(inference("false").fn.returns);
    expect(gate.payload.definition.signatureDeclaration.returns).toEqual({ $tag: "Absent" });
    gate.resolve({ issue: undefined }); await flight;
    expect(h.writes).toHaveLength(1); expect(h.additions).toHaveLength(1);
    expect(h.submissions[0].at(-1)).toBe(4);
    expect(h.writes[0]).toMatchObject({ method: "atomic", expectedRevision: 4, representations: [] });
    expect(h.writes[0].encodingRegistry).toBe(h.instanceEncoding);
  }));

  for (const mutation of ["body", "base", "draft", "revision", "epoch", "worker", "metadata"]) {
    test(`a stale ${mutation} refuses the captured preview and performs no Save`, async () => withHome({}, async h => {
      h.api.preview(); const request = h.api.job(), flight = h.api.save(); await settle();
      if (mutation === "body") h.setBody(node("changed"));
      if (mutation === "base") h.replaceBase();
      if (mutation === "draft") h.replaceDraft();
      if (mutation === "revision") h.setRevision(5);
      if (mutation === "epoch") h.setEpoch(2);
      if (mutation === "worker") h.setWorker({ fixture: "replacement" });
      if (mutation === "metadata") h.setMetadata({ generation: "replacement" });
      flush(); h.transports[0].resolve(inference("old"));
      await expect(request.promise).rejects.toThrow(); await flight; await settle();
      expect(h.writes).toEqual([]); expect(h.additions).toEqual([]); expect(h.syncCalls).toEqual([]);
    }));
  }

  test("Save waits for the exact preview and separate body gate; refusal never writes", async () => withHome({}, async h => {
    h.api.preview(); const flight = h.api.save(); await settle();
    expect(h.transports.map(row => row.payload.method)).toEqual(["infer-function-draft"]);
    expect(h.writes).toEqual([]);
    h.transports[0].resolve(inference("captured")); await settle();
    expect(h.transports.map(row => row.payload.method)).toEqual(["infer-function-draft", "function-body-save-issue"]);
    expect(h.writes).toEqual([]);
    h.transports[1].resolve({ issue: "controlled body refusal" }); await flight;
    expect(h.api.error()).toBe("controlled body refusal"); expect(h.writes).toEqual([]); expect(h.additions).toEqual([]);
  }));

  test("B4 unit D item 2: a Steps edit made while Save checks refuses that Save and writes nothing", async () => withHome({}, async h => {
    h.api.preview(); const flight = h.api.save(); await settle();
    h.setStepsPending(true); flush();
    h.transports[0].resolve(inference("captured")); await settle();
    for (const row of h.transports) if (row.payload.method === "function-body-save-issue") row.resolve({});
    await settle(); await flight;
    expect(h.api.error()).toBe("The draft changed while it was being checked. Save again.");
    expect(h.writes).toEqual([]); expect(h.additions).toEqual([]);
  }));

  test("a pending nested value check of this surface refuses the new function's Save before its body gate", async () => withHome({ nestedPending: true }, async h => {
    h.api.preview(); const flight = h.api.save(); await settle();
    h.transports[0].resolve(inference("captured")); await settle();
    // Were the body gate reached, admit it: only the nested hold may refuse.
    for (const row of h.transports) if (row.payload.method === "function-body-save-issue") row.resolve({});
    await settle(); await flight;
    expect(h.api.error()).toBe("The draft changed while it was being checked. Save again.");
    expect(h.transports.map(row => row.payload.method)).toEqual(["infer-function-draft"]);
    expect(h.writes).toEqual([]); expect(h.additions).toEqual([]);
    expect(h.nestedChecks.at(-1).scope).toEqual({ fixture: "surface-scope" });
  }));

  test("Cancel during the body gate cannot publish an error or write after the dialog closes", async () => withHome({}, async h => {
    h.api.preview(); const flight = h.api.save(); await settle();
    h.transports[0].resolve(inference()); await settle(); const gate = h.transports[1];
    h.api.close(); expect(gate.signal.aborted).toBe(true);
    gate.resolve({ issue: "late refusal" }); await flight;
    expect(h.api.error()).toBeNull(); expect(h.writes).toEqual([]); expect(h.closes()).toBe(1);
  }));

  test("changing only authored metadata during the body gate cannot combine old code with newer metadata", async () => withHome({}, async h => {
    h.api.preview(); const flight = h.api.save(); await settle();
    h.transports[0].resolve(inference()); await settle();
    h.setReps({ Labelable: { label: "newer draft" } }); flush();
    h.transports[1].resolve({}); await flight;
    expect(h.writes).toEqual([]); expect(h.additions).toEqual([]);
  }));

  test("missing Local worker refuses without invoking either synchronous adapter", async () => withHome({ missingWorker: true }, async h => {
    expect(h.api.preview().error).toContain("editing tools"); await h.api.save();
    expect(h.transports).toEqual([]); expect(h.syncCalls).toEqual([]); expect(h.writes).toEqual([]);
  }));

  test("a current Local worker rejection is shown without a synchronous rerun", async () => withHome({}, async h => {
    h.api.preview(); const flight = h.api.save(); await settle();
    h.transports[0].reject(new Error("controlled transport failure")); await flight; await settle();
    expect(h.api.error()).toBe("controlled transport failure");
    expect(h.api.preview().error).toBe("controlled transport failure");
    expect(h.syncCalls).toEqual([]); expect(h.writes).toEqual([]); expect(h.transports).toHaveLength(1);
  }));

  for (const [outcome, message] of [
    [{ $tag: "Invalid", diagnostics: [{ message: "controlled invalid draft" }] }, "controlled invalid draft"],
    [{ $tag: "Unresolved", diagnostics: [] }, "Choose a result type"],
  ]) test(`${outcome.$tag} preview cannot proceed to the body gate or persistence in Auto mode`, async () => withHome({}, async h => {
    h.api.preview(); const flight = h.api.save(); await settle();
    h.transports[0].resolve({ outcome }); await flight; await settle();
    expect(h.api.error()).toContain(message); expect(h.transports).toHaveLength(1);
    expect(h.writes).toEqual([]); expect(h.syncCalls).toEqual([]);
  }));

  test("an explicit result remains authored when the inference response carries a different inferred result", async () => withHome({ initialResultMode: "explicit" }, async h => {
    h.api.preview();
    const flight = h.api.save(); await settle();
    h.transports[0].resolve(inference("different")); await settle();
    expect(h.transports[1].payload.definition.returns).toEqual({ $ref: "Authored" });
    expect(h.transports[1].payload.definition.signatureDeclaration.returns).toEqual({ $tag: "Authored" });
    h.transports[1].resolve({}); await flight; expect(h.writes).toHaveLength(1);
  }));

  for (const stage of ["root", "representations"]) {
    for (const changed of ["revision", "body", "cancel"]) test(`${changed} during delayed ${stage} prevents atomic publication`, async () => withHome({ holdPublication: stage }, async h => {
      h.api.preview(); const flight = h.api.save(); await settle();
      h.transports[0].resolve(inference()); await settle(); h.transports[1].resolve({}); await settle();
      expect(h.ioEvents).toContain(stage === "root" ? "root-read" : "representation-read");
      expect(h.submissions).toHaveLength(1); expect(h.writes).toEqual([]);
      if (changed === "revision") h.setRevision(5);
      if (changed === "body") h.setBody(node("changed after semantic checks"));
      if (changed === "cancel") h.api.close();
      flush(); h.releasePublication(); await flight; await settle();
      expect(h.writes).toEqual([]); expect(h.additions).toEqual([]); expect(h.syncCalls).toEqual([]);
    }));
  }

  test("false and empty bodies retain their wire data; bodyless definitions need no inference flight", async () => {
    for (const value of [false, ""]) await withHome({ initialBody: node(value) }, async h => {
      h.api.preview(); const flight = h.api.save(); await settle();
      expect(h.transports[0].payload.fn.body).toBe(value);
      h.transports[0].resolve(inference(String(value))); await settle(); h.transports[1].resolve({}); await flight;
      expect(h.writes[0].bundle.ownerMutations[0].owner.definition.body).toBe(value);
    });
    await withHome({ initialHasBody: false }, async h => {
      expect(h.api.preview().result).toBeUndefined(); await h.api.save();
      expect(h.transports).toEqual([]); expect(h.writes).toHaveLength(1);
      expect(h.writes[0].bundle.ownerMutations[0].owner.definition).not.toHaveProperty("body");
    });
  });

  test("pending source issues and live saved references remain guarded before transport or persistence", async () => {
    for (const kind of ["generic", "steps", "reference"]) await withHome({}, async h => {
      if (kind === "generic") h.setGenericIssue("Apply the pending type parameter first.");
      if (kind === "steps") h.setStepsIssue("Finish the raw Steps edit first.");
      if (kind === "reference") h.setBody({ kind: "ref", savedExprId: "live-source" });
      flush(); const previousFlights = h.transports.length; await h.api.save();
      expect(h.writes).toEqual([]); expect(h.transports).toHaveLength(previousFlights); expect(h.syncCalls).toEqual([]);
      expect(h.transports.some(row => row.payload.method === "function-body-save-issue")).toBe(false);
      expect(h.api.error()).toBeTruthy();
    });
  });

  for (const kind of ["account", undefined]) test(`${kind ?? "public"} preview and Save retain the existing synchronous branch`, async () => withHome({ kind }, async h => {
    expect(h.api.preview().result).toEqual(inference("sync"));
    await h.api.save();
    expect(h.transports).toEqual([]);
    expect(h.syncCalls.some(row => row.method === "infer")).toBe(true);
    expect(h.syncCalls.some(row => row.method === "body")).toBe(true);
    expect(h.writes).toHaveLength(1);
  }));
});

function savedHarness(options = {}) {
  const kind = Object.hasOwn(options, "kind") ? options.kind : "local";
  const { onSaveItem = true, referenceItem = false, moduleReadonly = false,
    unchangedBody = false, holdRootQueue = false, initialBody = node("edited"), rawResultMode = "infer", world } = options;
  let disposeRoot;
  const h = createRoot(dispose => {
    disposeRoot = dispose;
    const rawArrow = { $arrow: { params: [], returns: { $ref: "RawAuthoredReturn" } } };
    const raw = { id: "stored-function", params: [], returns: { $ref: "RawAuthoredReturn" }, body: "original",
      requires: [{ fixture: "raw-requirement" }], signatureDeclaration: {
        declarationName: "raw-ingress-name", codeName: "raw-code-name", params: [], returns: { $tag: rawResultMode === "infer" ? "Absent" : "Authored" },
        scheme: { quantified: [{ id: "raw-a", sourceName: "a", kind: { $tag: "KType" } }], body: rawArrow,
          nominals: [{ path: ["$arrow", "returns"], identity: "raw-owner", publicName: "RawAuthoredReturn" }] },
      } };
    const effective = { ...clone(raw), returns: { $ref: "EffectiveResolvedReturn" }, signatureDeclaration: undefined };
    const [functionIngress, setIngress] = createSignal(raw), [effectiveFunction, setEffective] = createSignal(effective);
    const functionPin = createMemo(() => ({ id: "stored-function", name: "stored-name", fn: effectiveFunction() }));
    const functionBodyExpr = createMemo(() => functionIngress().body === undefined ? null : node(functionIngress().body));
    const [bodyDraft, setBodyDraft] = createSignal(null), [arrowDraft, setArrowDraft] = createSignal(null);
    const [functionBaseline, setFunctionBaseline] = createSignal(null);
    const [functionSchemeMetadata, setFunctionSchemeMetadata] = createSignal({ quantified: [] });
    const [functionResultMode, setFunctionResultMode] = createSignal("explicit");
    const [functionRequirements, setFunctionRequirements] = createSignal();
    const [functionSignatureDirty, setFunctionSignatureDirty] = createSignal(false);
    const [functionGenericIssue, setFunctionGenericIssue] = createSignal();
    const functionOwnedScheme = createMemo(() => arrowDraft() ? { ...functionSchemeMetadata(), body: arrowDraft() } : undefined);
    // B4 unit D item 2: these fixtures supply the raised body directly (never pending).
    const coreImports = { createMemo, createEffect, functionPin, functionIngress, functionBodyExpr, functionBodyPending: () => false,
      functionBaseline, setFunctionBaseline, bodyDraft, setBodyDraft, arrowDraft, setArrowDraft,
      setFunctionSchemeMetadata, setFunctionResultMode, setFunctionRequirements, setFunctionSignatureDirty, setFunctionGenericIssue,
      functionOwnedScheme, functionResultMode, cloneDraftValue: clone, draftValueFingerprint: JSON.stringify,
      buildAuthoringSignatureDeclaration: input => ({ declarationName: input.declarationName, codeName: input.codeName,
        params: Array.from({ length: input.parameterCount }, () => ({ $tag: "Authored" })),
        returns: { $tag: input.inferResult ? "Absent" : "Authored" }, scheme: clone(input.scheme) }),
    };
    const core = new Function(...Object.keys(coreImports), compiled(`let knownFunctionReference;
      ${savedHasBodyCode}\n${savedInitialArrowCode}\n${savedInitializeCode}\n${savedDefinitionChangedCode}\n${savedShapeIssueCode}\n${savedDeclarationCode}
      return { functionHasBody, functionDefinitionChanged, functionSignatureShapeIssue, functionDeclaration };`))(...Object.values(coreImports));
    // Existing cases keep their prepared setup. Natural-ingress cases mount
    // the actual preview/shim before the same extracted initializer effect
    // commits body/baseline/arrow/mode; no hand-populated alternative is used.
    const captureIngress = () => ({ mode: functionResultMode(), baseline: clone(functionBaseline()),
      arrow: clone(arrowDraft()), declaration: clone(core.functionDeclaration()) });
    let ingressSnapshot;
    if (!options.naturalIngress) {
      flush(); ingressSnapshot = captureIngress();
      if (!unchangedBody) setBodyDraft(initialBody);
      flush();
    }
    const originalExpression = world ? node("old value") : node({ $ref: "stored-function" });
    const [draft, setDraft] = createSignal(clone(originalExpression)), [cardReps, setCardReps] = createSignal({});
    const [fieldFacets, setFieldFacets] = createSignal({}), [fieldFacetsDirty, setFieldFacetsDirty] = createSignal(false);
    const [resurrected, setResurrected] = createSignal([]), [savedExpressionChanged, setSavedConflict] = createSignal(false);
    const [typeDefinitionChanged, setTypeConflict] = createSignal(false);
    const [saving, setSaving] = createSignal(false), [saveError, setSaveError] = createSignal(null);
    const [epoch, setEpoch] = createSignal(1), [revision, setRevision] = createSignal(4);
    const [worker, setWorker] = createSignal({ fixture: "saved-worker" }), [available, setAvailable] = createSignal(!options.missingWorker);
    const [workerNotification, setWorkerNotification] = createSignal(0);
    const session = label => ({ label, environment: { label }, registry: { label }, evaluateContext: { label } });
    const [base, setBase] = createSignal(session("saved-base")), [draftSession, setDraftSession] = createSignal(session("saved-draft"));
    const [metadata, setMetadata] = createSignal({ generation: "saved-metadata" });
    const fieldResurrections = { fieldIds: resurrected };
    const reader = { kind, revision, session: base, registry: () => base().registry };
    const sourceTicket = { origin: 1 }; let origin = 1, closes = 0;
    const assertSourceTicket = ticket => { if (ticket.origin !== origin) throw new Error("The data source changed while editing."); };
    const nestedChecks = [], transports = [], writes = [], callbackCalls = [], syncCalls = [], cleanups = [], metadataReads = [], acknowledgments = [];
    const scopeSelections = [], scopedHandles = [];
    const preparedHandles = new WeakMap();
    const preparedHandleFor = session => {
      workerNotification();
      if (!available()) return undefined;
      const token = worker();
      let tokens = preparedHandles.get(session);
      if (!tokens) { tokens = new WeakMap(); preparedHandles.set(session, tokens); }
      let handle = tokens.get(token);
      if (!handle) { handle = { fixtureBase: session, token }; tokens.set(token, handle); }
      return handle;
    };

    const rootQueue = deferred();
    const expectedQuery = { kind: "expression", expr: clone(originalExpression), valueType: { $ref: "DeclaredAlias" },
      declaration: { fixture: "expected-query" } };
    const api = {
      savedQueryUpdate: async (...args) => { writes.push({ method: "saved-query", args: clone(args) }); return {}; },
      definitionBundleSave: async bundle => { writes.push({ method: "definition", bundle: clone(bundle) }); return {}; },
      locusViewUpdate: async (...args) => { writes.push({ method: "view", args: clone(args) }); return {}; },
    };
    const client = { drafts: undefined, editDefinitionAndData: kind === "local" ? async (bundle, expectedRevision, mutation) => {
      writes.push({ method: "atomic", bundle: clone(bundle), expectedRevision, mutation: clone(mutation) });
      return { root: { id: "root", revision: expectedRevision + 1 } };
    } : undefined };
    const callbackImports = { state: { rootRevision: 4, sourceTicket, expectedSavedQuery: expectedQuery },
      sessionEpoch: epoch, assertSourceTicket, rootSourceTicket: () => sourceTicket, root: () => ({ revision: 99 }), client,
      enqueueRootWrite: async action => { if (holdRootQueue) await rootQueue.promise; return action(); },
      assertCurrentSession: captured => { if (captured !== epoch()) throw new Error("Stale browser epoch"); },
      acknowledgeRootRevision: (...args) => acknowledgments.push(args), revalidate: () => {}, refresh: async () => {}, all: () => ({}),
      savedAll: () => ({ queries: [{ id: "saved-id", query: expectedQuery }] }), homeAuthoringSession: base,
      draftSaveIssue: () => { syncCalls.push({ method: "value" }); return undefined; }, savedExprById: () => new Map(), api,
      homeData: { replace: async (...args) => { writes.push({ method: "occurrence", args: clone(args) }); } },
    };
    const callback = new Function(...Object.keys(callbackImports), compiled(`return (${savedItemCallbackCode});`))(...Object.values(callbackImports));
    const props = { item: { id: "card", source: referenceItem ? { kind: "ref", ref: { id: "saved-id" } }
      : { kind: "expr", expr: clone(originalExpression) }, ...(world ? { valueType: { $ref: "Number" } } : {}) },
      homeId: "root", savedExprById: new Map(world ? [["saved-id", clone(originalExpression)]] : []),
      expectedSavedQuery: expectedQuery, sourceTicket,
      onClose: () => { closes++; }, onApplied: () => {},
      ...(onSaveItem ? { onSaveItem: (...args) => { callbackCalls.push(clone(args.slice(0, 4))); return callback(...args); } } : {}),
    };
    const ownerHelpers = new Function(compiled(`${savedOwnerCode}; return { persistedFunctionDefinition, functionDefinitionOwner };`))();
    const row = { id: "storage-id", name: "stored-name", isSystem: moduleReadonly };
    const imports = {
      createMemo, createAsyncValue, latest, onSettled: setup => { const cleanup = setup(); if (cleanup) cleanups.push(cleanup); },
      props, reader: world?.reader ?? reader, client, api, sourceTicket, assertSourceTicket,
      localExpressionSaveIssue: world?.localExpressionSaveIssue ?? (() => { throw new Error("Unplanned Local value admission"); }),
      LOCAL_SAVE_CHANGED: world?.LOCAL_SAVE_CHANGED, LOCAL_SAVE_DRAFT_CHANGED: world?.LOCAL_SAVE_DRAFT_CHANGED,
      saving, setSaving, saveError, setSaveError, functionPin, functionBaseline, bodyDraft, arrowDraft,
      functionDeclaration: core.functionDeclaration, functionDefinitionChanged: core.functionDefinitionChanged,
      functionHasBody: core.functionHasBody,
      functionSignatureShapeIssue: core.functionSignatureShapeIssue, functionRequirements, functionResultMode,
      functionSignatureDirty, functionGenericIssue, savedExpressionChanged, typeDefinitionChanged,
      functionAuthoringSession: draftSession, homeAuthoringSession: world?.reader.session ?? base,
      persistedFunctionRow: () => ownerHelpers.persistedFunctionDefinition(row), functionDefinitionOwner: ownerHelpers.functionDefinitionOwner,
      initial: () => originalExpression, draft, cardReps, fieldFacets, fieldFacetsDirty, fieldResurrections,
      entityPin: () => null, entityDefinition: () => undefined, typeDraft: () => null, typeGenericIssue: () => undefined,
      typeDraftDirty: () => false, typeBaseline: () => undefined, typeParamsDraft: () => [], typeGenericEditable: () => true, typeOwnedScheme: () => undefined,
      cloneDraftValue: clone, draftValueFingerprint: JSON.stringify,
      desiredFieldFacetValues: value => Object.entries(value).map(([fieldId, facets]) => ({ fieldId, facets })),
      fieldFacetReplacementIds: value => Object.keys(value),
      concreteAuthoringSession: value => value,
      preparedReaderWorkerForSession: preparedHandleFor,
      localAuthoringScopeForSession: value => {
        scopeSelections.push(value); return { sourceId: "saved-source", functions: [], draft: { id: "stored-function", session: value.label } };
      },
      scopePreparedReaderWorker: (handle, scope) => { const scoped = { handle, scope }; scopedHandles.push(scoped); return scoped; },
      authoringWorkerSnapshot: () => { workerNotification(); return worker(); }, sessionEpoch: epoch,
      assertCurrentSession: captured => { if (captured !== epoch()) throw new Error("Stale browser epoch"); },
      captureReaderSourceMetadata: value => { metadataReads.push(value); return { session: value, packet: metadata() }; },
      assertReaderSourceMetadata: (capture, value) => { if (capture.session !== value || capture.packet !== metadata()) throw new Error("Source metadata changed"); },
      // B4 fix round 2: no nested value check is pending in these fixtures.
      localDraftChecksPending: (scope, reader) => { nestedChecks.push({ scope, reader }); return options.nestedPending ?? false; },
      LOCAL_SAVE_DRAFT_CHANGED: "The draft changed while it was being checked. Save again.",
      runPreparedReaderWorker: (handle, payload, signal) => {
        // B4 unit D item 2: the stand-in worker lowers a draft body in the
        // same request, as in the NewFunction harness above.
        if (payload.method === "infer-function-draft" && payload.lowerBody) {
          const { lowerBody, ...rest } = payload;
          let lowered, refusal;
          try { lowered = imports.toLogic(lowerBody.node, () => { throw new Error(lowerBody.refusal); }); }
          catch (error) { refusal = error; }
          const held = deferred();
          const row = { handle, payload: clone({ ...rest, fn: { ...rest.fn, body: lowered } }), signal, lowerBody: clone(lowerBody),
            resolve: value => held.resolve(value && typeof value === "object" && !Object.hasOwn(value, "loweredBody") ? { ...value, loweredBody: clone(lowered) } : value),
            reject: held.reject, promise: held.promise };
          transports.push(row);
          if (refusal) { held.reject(refusal); return held.promise; }
          if (options.immediateInference) Promise.resolve().then(() => row.resolve(inference(String(lowered))));
          return held.promise;
        }
        const held = deferred(); transports.push({ handle, payload: clone(payload), signal, ...held });
        if (options.immediateInference && payload.method === "infer-function-draft") {
          Promise.resolve().then(() => held.resolve(inference(String(payload.fn.body))));
        }
        return held.promise; },
      splitLoweredFunctionDraft,
      toLogic: (value, resolver) => value.kind === "ref" ? resolver(value.savedExprId) : clone(value.value),
      logicToExprNode: value => node(value), savedExpressionDeclaration: value => value.fixtureDeclaration,
      inferAuthoringFunctionDraft: (...args) => { syncCalls.push({ method: "infer", args }); return inference("saved-sync"); },
      projectAuthoringInferenceOutcome: outcome => ({ label: outcome.fixtureLabel ?? `Controlled ${outcome.$tag} annotation` }),
      functionBodySaveIssue: (...args) => { syncCalls.push({ method: "body", args }); return undefined; },
      draftSaveIssue: () => { syncCalls.push({ method: "value" }); return undefined; },
      readLocusCatalogReference: value => value?.$ref ? { id: value.$ref, kind: "function" } : undefined,
      resolveCatalogReference: () => ({ kind: "function" }),
      // B4 wave 4 lane H: no signature edit is being reconciled in these fixtures.
      localFunctionSignature: undefined, localTypeSignature: undefined,
      revalidate: () => {}, reloadUserRegistries: async () => {},
      getLocusRoot: async () => { throw new Error("Unplanned root fallback"); }, editLocusRoot: async () => { throw new Error("Unplanned root write"); },
    };
    const editor = new Function(...Object.keys(imports), compiled(`${savedLifetimeCode}\n${savedConflictCode}\n${savedBodyReturnCode}\n${savedPreviewCode}\n${savedResultCode}\n${savedSaveCode}\n${savedInferringCode}
      return { preview: functionPreview, asyncValue: localSavedFunctionPreview, job: localSavedFunctionPreviewJob, resultType: functionResultType,
        note: () => (${savedNoteExpression}), save, close, error: saveError, saving, conflict: sourceConflict };`))(...Object.values(imports));
    const observations = [];
    if (options.observeNaturalPreview) createEffect(() => editor.preview(), value => { observations.push(value); });
    else if (options.observePreview) createEffect(() => editor.asyncValue(), value => { observations.push(value); });
    return { editor, get ingressSnapshot() { return ingressSnapshot ?? captureIngress(); },
      releaseIngress: () => { if (!options.naturalIngress) throw Error("Select natural ingress before release"); flush(); },
      bodyDraft, arrowDraft, functionResultMode, functionBaseline, functionIngress, observations,
      declaration: core.functionDeclaration, scopeSelections, scopedHandles,
      nestedChecks, transports, writes, callbackCalls, syncCalls, cleanups, metadataReads, acknowledgments, expectedQuery, base,
      setBodyDraft, setArrowDraft, setFunctionRequirements, setFunctionSignatureDirty, setFunctionGenericIssue, setDraft,
      setCardReps, setFieldFacets, setFieldFacetsDirty, setResurrected, setSavedConflict, setTypeConflict,
      setEpoch, setRevision, setWorker, setMetadata, setAvailable,
      changeIngress: () => setIngress(value => ({ ...value, signatureDeclaration: { ...value.signatureDeclaration, codeName: "external-ingress" } })),
      changeEffective: () => setEffective(value => ({ ...value, returns: { $ref: "ExternalReturn" } })),
      replaceBase: () => setBase(session("replaced-base")), replaceDraft: () => setDraftSession(session("replaced-draft")),
      retireTicket: () => { origin++; }, releaseRootQueue: () => rootQueue.resolve(), closes: () => closes,
      notifyWorkers: () => setWorkerNotification(value => value + 1),
    };
  });
  h.dispose = () => { for (const cleanup of h.cleanups.splice(0)) cleanup(); disposeRoot(); };
  return h;
}
async function withSaved(options, run) {
  const h = savedHarness(options);
  try { await run(h); } finally { h.dispose(); }
}

describe("Local saved function keeps persisted ingress and checked Save lifetimes", () => {
  test("natural Saved ingress reaches the actual aggregate subscriber with immediate completion", async () => withSaved({
    naturalIngress: true, unchangedBody: true, observeNaturalPreview: true, immediateInference: true,
  }, async h => {
    expect(h.bodyDraft()).toBeNull(); expect(h.transports).toHaveLength(0);
    h.releaseIngress();
    expect(h.transports).toHaveLength(1);
    expect(h.observations.at(-1)?.pending).toBe(true);
    expect(h.observations.at(-1)?.result).toBeUndefined();
    await settle();
    expect(h.observations.at(-1)?.result).toEqual(inference("original"));
    expect(h.observations.at(-1)?.error).toBeUndefined();
    expect(h.ingressSnapshot.mode).toBe("infer");
    expect(h.ingressSnapshot.declaration.returns).toEqual({ $tag: "Absent" });
    expect(h.ingressSnapshot.baseline.fn.body).toBe("original");
    expect(h.transports).toHaveLength(1); expect(h.scopedHandles).toHaveLength(1);
    expect(h.writes).toEqual([]); expect(h.syncCalls).toEqual([]); expect(h.closes()).toBe(0);
  }));

  test("natural Saved ingress hides a different prior type during held replacement and reversed completion", async () => withSaved({
    naturalIngress: true, unchangedBody: true, observeNaturalPreview: true,
  }, async h => {
    expect(h.bodyDraft()).toBeNull(); expect(h.transports).toHaveLength(0);
    h.releaseIngress();
    // Subscriber evidence precedes every imperative preview/job/result pull.
    expect(h.observations.at(-1)?.pending).toBe(true);
    expect(h.observations.at(-1)?.result).toBeUndefined();
    expect(h.transports).toHaveLength(1); expect(h.transports[0].payload.fn.body).toBe("original");
    h.transports[0].resolve(inference("natural-first")); await settle();
    expect(h.observations.at(-1)?.result).toEqual(inference("natural-first"));
    h.setBodyDraft(node("natural-second")); flush();
    expect(h.observations.at(-1)?.pending).toBe(true);
    expect(h.observations.at(-1)?.result).toBeUndefined();
    const second = h.editor.job();
    expect(h.editor.resultType()).toBeUndefined();
    expect(h.editor.note()).toBe("Checking result type…");
    h.setBodyDraft(node("natural-third")); flush();
    expect(h.observations.at(-1)?.pending).toBe(true);
    expect(h.observations.at(-1)?.result).toBeUndefined();
    const third = h.editor.job();
    expect(h.transports).toHaveLength(3); expect(h.transports[1].signal.aborted).toBe(true);
    h.transports[2].resolve(inference("natural-third"));
    await expect(third.promise).resolves.toEqual(inference("natural-third")); await settle();
    expect(h.observations.at(-1)?.result).toEqual(inference("natural-third"));
    expect(h.editor.resultType()).not.toEqual(inference("natural-first").fn.returns);
    h.transports[1].resolve(inference("natural-second"));
    await expect(second.promise).rejects.toThrow(); await settle();
    expect(h.observations.at(-1)?.result).toEqual(inference("natural-third"));
    expect(h.observations.some(row => row?.result?.fn?.returns?.$ref === "Inferred-natural-second")).toBe(false);
    expect(h.ingressSnapshot.declaration.returns).toEqual({ $tag: "Absent" });
    expect(h.scopedHandles).toHaveLength(1); expect(h.writes).toEqual([]); expect(h.syncCalls).toEqual([]);
  }));

  for (const retire of ["source", "metadata", "epoch", "revision", "base", "draft", "worker"]) test(
    "natural Saved ingress rejects " + retire + " retirement through its changed aggregate accessor", async () => withSaved({
      naturalIngress: true, unchangedBody: true, observeNaturalPreview: true,
    }, async h => {
      h.releaseIngress();
      expect(h.observations.at(-1)?.pending).toBe(true);
      h.transports[0].resolve(inference("natural-current")); await settle();
      expect(h.observations.at(-1)?.result).toEqual(inference("natural-current"));
      h.setBodyDraft(node("retired-answer")); flush();
      expect(h.observations.at(-1)?.pending).toBe(true);
      expect(h.observations.at(-1)?.result).toBeUndefined();
      const held = h.editor.job();
      if (retire === "source") h.retireTicket();
      if (retire === "metadata") h.setMetadata({ generation: "retired-source" });
      if (retire === "epoch") h.setEpoch(2);
      if (retire === "revision") h.setRevision(5);
      if (retire === "base") h.replaceBase();
      if (retire === "draft") h.replaceDraft();
      if (retire === "worker") h.setWorker({ fixture: "retired-worker" });
      flush(); h.transports[1].resolve(inference("must-not-surface"));
      await expect(held.promise).rejects.toThrow(); await settle();
      expect(h.observations.some(row => row?.result?.fn?.returns?.$ref === "Inferred-must-not-surface")).toBe(false);
      expect(h.writes).toEqual([]); expect(h.syncCalls).toEqual([]);
    }));

  test("natural Saved ingress root disposal refuses its held answer", async () => {
    const h = savedHarness({ naturalIngress: true, unchangedBody: true, observeNaturalPreview: true });
    let disposed = false;
    try {
      h.releaseIngress(); expect(h.observations.at(-1)?.pending).toBe(true);
      const held = h.editor.job();
      h.dispose(); disposed = true;
      h.transports[0].resolve(inference("disposed-answer"));
      await expect(held.promise).rejects.toThrow(); await settle();
      expect(h.observations.some(row => row?.result?.fn?.returns?.$ref === "Inferred-disposed-answer")).toBe(false);
      expect(h.writes).toEqual([]); expect(h.syncCalls).toEqual([]);
    } finally { if (!disposed) h.dispose(); }
  });

  test("an unheld saved preview accepts an ordinary next-microtask edit", async () => withSaved({
    observePreview: true, immediateInference: true,
  }, async h => {
    await settle(); expect(h.observations.at(-1)).toEqual(inference("edited"));
    const handle = latest(h.editor.job).request.handle;
    h.setBodyDraft(node("saved-immediate-edit")); flush(); await settle();
    expect(h.observations.at(-1)).toEqual(inference("saved-immediate-edit"));
    expect(h.editor.preview().error).toBeUndefined(); expect(h.transports).toHaveLength(2);
    expect(latest(h.editor.job).request.handle).toBe(handle); expect(h.scopedHandles).toHaveLength(1);
  }));

  test("the observed saved async accessor accepts an ordinary edited body", async () => withSaved({ observePreview: true }, async h => {
    await settle(); h.transports[0].resolve(inference("saved-committed")); await settle();
    expect(h.observations.at(-1)).toEqual(inference("saved-committed"));
    const handle = latest(h.editor.job).request.handle;
    h.setBodyDraft(node("saved-ordinary-edit")); flush(); await settle();
    expect(h.transports).toHaveLength(2);
    const edited = latest(h.editor.job); expect(edited.request.handle).toBe(handle);
    h.transports[1].resolve(inference("saved-ordinary-edit"));
    await expect(edited.promise).resolves.toEqual(inference("saved-ordinary-edit")); await settle();
    expect(h.observations.at(-1)).toEqual(inference("saved-ordinary-edit"));
    expect(h.editor.preview().error).toBeUndefined(); expect(h.transports).toHaveLength(2);
  }));

  test("saved Save captures its latest unflushed body and root declaration coherently", async () => withSaved({ observePreview: true }, async h => {
    await settle(); h.transports[0].resolve(inference("saved-committed")); await settle();
    const rootDeclaration = { captured: "saved-latest-root-declaration" };
    h.setBodyDraft({ ...node("saved-latest-save"), fixtureDeclaration: rootDeclaration });
    const flight = h.editor.save(); await settle();
    expect(h.transports).toHaveLength(2); expect(h.transports[1].payload.fn.body).toBe("saved-latest-save");
    h.transports[1].resolve(inference("saved-latest-save")); await settle();
    expect(h.transports[2].payload).toMatchObject({ method: "function-body-save-issue", rootDeclaration,
      node: { value: "saved-latest-save" }, definition: { body: "saved-latest-save" } });
    h.transports[2].resolve({}); await flight;
    expect(h.writes).toHaveLength(1);
    expect(h.writes[0].bundle.ownerMutations[0].owner.definition.body).toBe("saved-latest-save");
  }));

  for (const retire of ["close", "body", "worker", "revision", "epoch"]) test("queued checked Save refuses " + retire + " before the existing atomic write", async () => withSaved({ holdRootQueue: true }, async h => {
    h.editor.preview(); const flight = h.editor.save(); await settle();
    h.transports[0].resolve(inference("queued")); await settle(); h.transports[1].resolve({}); await settle();
    expect(h.callbackCalls).toHaveLength(1); expect(h.writes).toEqual([]);
    if (retire === "close") h.editor.close();
    if (retire === "body") h.setBodyDraft(node("changed-while-queued"));
    if (retire === "worker") h.setWorker({ fixture: "replaced-while-queued" });
    if (retire === "revision") h.setRevision(5);
    if (retire === "epoch") h.setEpoch(2);
    flush(); h.releaseRootQueue(); await flight;
    expect(h.writes).toEqual([]); expect(h.acknowledgments).toEqual([]);
  }));

  test("saved body edits keep declaration and scoped context identity until the immutable signature session changes", async () => withSaved({}, async h => {
    h.editor.preview(); const declaration = h.declaration(), original = h.editor.job().request;
    expect(h.scopeSelections).toHaveLength(1); expect(h.scopedHandles).toHaveLength(1);
    h.setBodyDraft(node("body-only")); flush();
    expect(h.declaration()).toBe(declaration); expect(h.editor.job().request.handle).toBe(original.handle);
    expect(h.scopeSelections).toHaveLength(1); expect(h.scopedHandles).toHaveLength(1);
    const flights = h.transports.length; h.notifyWorkers(); flush();
    expect(h.declaration()).toBe(declaration); expect(h.transports).toHaveLength(flights);
    expect(h.scopedHandles).toHaveLength(1);
    h.setArrowDraft({ $arrow: { params: [], returns: { $ref: "ChangedSignature" } } }); h.replaceDraft(); flush();
    expect(h.declaration()).not.toBe(declaration); expect(h.editor.job().request.handle).not.toBe(original.handle);
    expect(h.scopeSelections).toHaveLength(2); expect(h.scopedHandles).toHaveLength(2);
  }));

  test("raw Absent ingress owns mode and the checked function return stays separate from its declaration", async () => withSaved({
    initialBody: { ...node("edited"), fixtureDeclaration: { captured: "saved-root" } },
  }, async h => {
    expect(h.ingressSnapshot.mode).toBe("infer");
    expect(h.ingressSnapshot.declaration.returns).toEqual({ $tag: "Absent" });
    expect(h.ingressSnapshot.baseline.fn.returns).toEqual({ $ref: "RawAuthoredReturn" });
    expect(h.ingressSnapshot.declaration.codeName).toBe("raw-code-name");
    h.editor.preview(); const flight = h.editor.save(); await settle();
    expect(h.transports[0].payload.declaration.returns).toEqual({ $tag: "Absent" });
    h.transports[0].resolve(inference("saved")); await settle();
    const gate = h.transports[1]; expect(gate.payload.method).toBe("function-body-save-issue");
    expect(gate.payload.definition.returns).toEqual(inference("saved").fn.returns);
    expect(gate.payload.definition.signatureDeclaration.returns).toEqual({ $tag: "Absent" });
    expect(gate.payload.definition.id).toBe("stored-function");
    expect(gate.payload.rootDeclaration).toEqual({ captured: "saved-root" });
    expect(gate.payload.sourceMetadata).toEqual({ generation: "saved-metadata" });
    expect(h.metadataReads.every(value => value === h.base())).toBe(true);
    gate.resolve({}); await flight;
    expect(h.writes).toHaveLength(1); expect(h.writes[0]).toMatchObject({ method: "atomic", expectedRevision: 4 });
    expect(h.callbackCalls[0][3]).toBe(false);
    expect(h.writes[0].bundle.ownerMutations[0].owner).not.toHaveProperty("storageId");
  }));

  for (const stage of ["preview", "body gate"]) {
    for (const changed of ["body", "signature", "requirements", "facets", "representations", "resurrection", "source conflict", "ticket", "ingress", "effective definition", "reader", "draft reader", "revision", "metadata", "epoch", "worker"]) {
      test(`${changed} during saved ${stage} cannot publish a mixed or stale definition`, async () => withSaved({}, async h => {
        h.editor.preview(); const flight = h.editor.save(); await settle();
        if (stage === "body gate") { h.transports[0].resolve(inference()); await settle(); }
        if (changed === "body") h.setBodyDraft(node("newer-body"));
        if (changed === "signature") h.setArrowDraft({ $arrow: { params: [{ name: "later", type: { $ref: "Number" } }], returns: { $ref: "Later" } } });
        if (changed === "requirements") h.setFunctionRequirements([{ fixture: "later-requirement" }]);
        if (changed === "facets") h.setFieldFacets({ "field-id": { Labelable: { label: "later" } } });
        if (changed === "representations") h.setCardReps({ Labelable: { label: "later" } });
        if (changed === "resurrection") h.setResurrected(["restored-field"]);
        if (changed === "source conflict") h.setSavedConflict(true);
        if (changed === "ticket") h.retireTicket();
        if (changed === "ingress") h.changeIngress();
        if (changed === "effective definition") h.changeEffective();
        if (changed === "reader") h.replaceBase();
        if (changed === "draft reader") h.replaceDraft();
        if (changed === "revision") h.setRevision(5);
        if (changed === "metadata") h.setMetadata({ generation: "newer-metadata" });
        if (changed === "epoch") h.setEpoch(2);
        if (changed === "worker") h.setWorker({ fixture: "new-worker" });
        flush();
        h.transports[stage === "preview" ? 0 : 1].resolve(stage === "preview" ? inference("old") : {});
        await flight; await settle();
        expect(h.writes).toEqual([]); expect(h.callbackCalls).toEqual([]); expect(h.syncCalls).toEqual([]);
      }));
    }
  }

  test("saved ready-to-pending preview and reversed completion never expose the previous result", async () => withSaved({}, async h => {
    h.editor.preview(); h.transports[0].resolve(inference("ready")); await settle();
    expect(h.editor.resultType()).toEqual(inference("ready").fn.returns);
    h.setBodyDraft(node("second")); flush(); expect(h.editor.resultType()).toBeUndefined();
    const second = h.editor.job(); h.setBodyDraft(node("third")); flush(); expect(h.editor.preview().result).toBeUndefined();
    h.transports[2].resolve(inference("third")); await settle();
    h.transports[1].resolve(inference("second")); await expect(second.promise).rejects.toThrow(); await settle();
    expect(h.editor.resultType()).toEqual(inference("third").fn.returns);
  }));

  test("a pending nested value check of this editor refuses the saved function's Save with no body gate or write", async () => withSaved({ nestedPending: true }, async h => {
    h.editor.preview(); const flight = h.editor.save(); await settle();
    h.transports[0]?.resolve(inference()); await settle();
    for (const row of h.transports) if (row.payload.method === "function-body-save-issue") row.resolve({});
    await settle(); await flight;
    expect(h.editor.error()).toBe("The draft changed while it was being checked. Save again.");
    expect(h.transports.map(row => row.payload.method).filter(method => method === "function-body-save-issue")).toEqual([]);
    expect(h.writes).toEqual([]); expect(h.callbackCalls).toEqual([]);
    // Its own surface scope (the editor's), and its reader.
    expect(typeof h.nestedChecks.at(-1).scope).toBe("object");
    expect(h.nestedChecks.at(-1).reader?.kind).toBe("local");
  }));

  test("saved body refusal and Cancel keep both publication routes empty", async () => {
    for (const cancel of [false, true]) await withSaved({}, async h => {
      h.editor.preview(); const flight = h.editor.save(); await settle();
      h.transports[0].resolve(inference()); await settle();
      if (cancel) h.editor.close(); h.transports[1].resolve({ issue: "controlled saved-body refusal" });
      await flight; expect(h.writes).toEqual([]); expect(h.callbackCalls).toEqual([]);
      if (!cancel) expect(h.editor.error()).toBe("controlled saved-body refusal");
    });
  });

  test("a saved preview cancelled or rejected before the body gate never falls back to sync admission", async () => {
    for (const cancel of [false, true]) await withSaved({}, async h => {
      h.editor.preview(); const flight = h.editor.save(); await settle();
      if (cancel) { h.editor.close(); h.transports[0].resolve(inference("late")); }
      else h.transports[0].reject(new Error("controlled saved-worker failure"));
      await flight; await settle();
      expect(h.writes).toEqual([]); expect(h.callbackCalls).toEqual([]); expect(h.syncCalls).toEqual([]);
      expect(h.transports).toHaveLength(1);
      if (!cancel) expect(h.editor.error()).toBe("controlled saved-worker failure");
    });
  });

  test("an authored saved result follows raw ingress rather than the effective or newly inferred return", async () => withSaved({ rawResultMode: "explicit" }, async h => {
    expect(h.ingressSnapshot.mode).toBe("explicit");
    expect(h.editor.resultType()).toEqual({ $ref: "RawAuthoredReturn" });
    const flight = h.editor.save(); await settle(); h.transports[0].resolve(inference("different")); await settle();
    expect(h.transports[1].payload.definition.returns).toEqual({ $ref: "RawAuthoredReturn" });
    expect(h.transports[1].payload.definition.signatureDeclaration.returns).toEqual({ $tag: "Authored" });
    h.transports[1].resolve({}); await flight; expect(h.writes).toHaveLength(1);
  }));

  test("standalone Local fallback publishes definition and saved value once at the checked revision", async () => withSaved({ onSaveItem: false, referenceItem: true }, async h => {
    h.editor.preview(); const flight = h.editor.save(); await settle();
    h.transports[0].resolve(inference()); await settle(); h.transports[1].resolve({}); await flight;
    expect(h.writes).toHaveLength(1);
    expect(h.writes[0]).toMatchObject({ method: "atomic", expectedRevision: 4, mutation: {
      savedValue: { id: "saved-id", expectedQuery: h.expectedQuery },
    } });
    expect(h.writes[0].mutation.savedValue.query).toEqual(h.expectedQuery);
    expect(h.writes.some(write => write.method === "saved-query" || write.method === "definition")).toBe(false);
  }));

  test("false and empty saved bodies retain their raw wire values", async () => {
    for (const value of [false, ""]) await withSaved({ initialBody: node(value) }, async h => {
      h.editor.preview(); const flight = h.editor.save(); await settle();
      expect(h.transports[0].payload.fn.body).toBe(value);
      h.transports[0].resolve(inference("saved-value")); await settle();
      expect(h.transports[1].payload.definition.body).toBe(value);
      h.transports[1].resolve({}); await flight;
      expect(h.writes[0].bundle.ownerMutations[0].owner.definition.body).toBe(value);
    });
  });

  test("the existing queued onSaveItem rechecks its source ticket before atomic publication", async () => withSaved({ holdRootQueue: true }, async h => {
    h.editor.preview(); const flight = h.editor.save(); await settle();
    h.transports[0].resolve(inference()); await settle(); h.transports[1].resolve({}); await settle();
    expect(h.callbackCalls).toHaveLength(1); expect(h.writes).toEqual([]);
    h.retireTicket(); h.releaseRootQueue(); await flight;
    expect(h.writes).toEqual([]); expect(h.editor.error()).toContain("data source changed");
  }));

  test("module definitions remain read-only and missing Local workers never invoke sync admission", async () => {
    for (const options of [{ moduleReadonly: true }, { missingWorker: true }]) await withSaved(options, async h => {
      h.editor.preview(); await h.editor.save();
      expect(h.writes).toEqual([]); expect(h.callbackCalls).toEqual([]); expect(h.syncCalls).toEqual([]);
      expect(h.editor.error()).toBeTruthy();
      expect(h.transports.some(row => row.payload.method === "function-body-save-issue")).toBe(false);
    });
  });

  test("facet-only and card-representation-only edits retain their existing paths without a body gate", async () => {
    await withSaved({ unchangedBody: true }, async h => {
      h.setFieldFacets({ "field-id": { Labelable: { label: "field label" } } }); h.setFieldFacetsDirty(true); flush();
      await h.editor.save();
      expect(h.writes).toHaveLength(1); expect(h.writes[0].method).toBe("atomic");
      expect(h.writes[0].bundle.desiredFacets).toHaveLength(1);
      expect(h.transports.some(row => row.payload.method === "function-body-save-issue")).toBe(false);
    });
    await withSaved({ unchangedBody: true }, async h => {
      h.setCardReps({ Labelable: { label: "card label" } }); flush(); await h.editor.save();
      expect(h.writes).toHaveLength(1); expect(h.writes[0].method).toBe("occurrence");
      expect(h.transports.some(row => row.payload.method === "function-body-save-issue")).toBe(false);
    });
  });

  test("saved account branch retains synchronous inference/body checking and storage identity", async () => withSaved({ kind: "account" }, async h => {
    h.editor.preview(); await h.editor.save();
    expect(h.transports).toEqual([]); expect(h.syncCalls.some(row => row.method === "infer")).toBe(true);
    expect(h.syncCalls.some(row => row.method === "body")).toBe(true);
    expect(h.writes).toHaveLength(1); expect(h.writes[0].method).toBe("definition");
    expect(h.writes[0].bundle.ownerMutations[0].owner.storageId).toBe("storage-id");
  }));

  test("public module inspection retains its synchronous preview and read-only Save boundary", async () => withSaved({ kind: undefined, moduleReadonly: true }, async h => {
    expect(h.editor.preview().result).toEqual(inference("saved-sync")); await h.editor.save();
    expect(h.transports).toEqual([]); expect(h.writes).toEqual([]);
    expect(h.syncCalls.some(row => row.method === "infer")).toBe(true);
    expect(h.syncCalls.some(row => row.method === "body")).toBe(false);
    expect(h.editor.error()).toContain("source module");
  }));
});

async function withResultNote(editorKind, options, run) {
  const mount = editorKind === "new" ? withHome : withSaved;
  return mount(options, h => run({ h, api: h.api ?? h.editor, body: h.body ?? h.bodyDraft,
    setBody: h.setBody ?? h.setBodyDraft, transports: h.transports }));
}

describe("Local reference data Save decides from the reader's worker", () => {
  const edited = node("new value");
  test("a worker refusal keeps the draft and writes nothing; no page check runs", async () => {
    const world = localWorld();
    await withSaved({ world, referenceItem: true, unchangedBody: true }, async h => {
      h.setDraft(clone(edited)); flush();
      const flight = h.editor.save(); await settle();
      expect(world.requests).toHaveLength(1);
      expect(world.requests[0].node).toEqual(edited);
      expect(world.requests[0].options.expectedType).toEqual({ $ref: "Number" });
      expect(world.requests[0].options.evaluate).toBeUndefined();
      expect(world.requests[0].saved.get("saved-id")).toEqual(node("old value"));
      await world.answer(0, { issue: "Finish with Number before saving." }); await flight;
      expect(h.editor.error()).toBe("Finish with Number before saving.");
      expect(h.writes).toEqual([]); expect(h.callbackCalls).toEqual([]);
      expect(h.syncCalls).toEqual([]); expect(world.pageReads).toEqual([]);
    });
  });

  test("a worker admission reaches the existing occurrence write", async () => {
    const world = localWorld();
    await withSaved({ world, referenceItem: true, unchangedBody: true }, async h => {
      h.setDraft(clone(edited)); flush();
      const flight = h.editor.save(); await settle();
      await world.answer(0, {}); await flight;
      expect(h.editor.error()).toBe(null);
      expect(h.writes.map(write => write.method)).toEqual(["occurrence"]);
      expect(h.syncCalls).toEqual([]); expect(world.pageReads).toEqual([]);
    });
  });

  test("a revision bump, a draft edit or a closed worker refuses; Cancel aborts the request", async () => {
    for (const change of ["revision", "draft", "closed", "cancel"]) {
      const world = localWorld();
      await withSaved({ world, referenceItem: true, unchangedBody: true }, async h => {
        h.setDraft(clone(edited)); flush();
        if (change === "closed") world.closeWorker();
        const flight = h.editor.save(); await settle();
        if (change === "revision") world.bumpRevision();
        if (change === "draft") { h.setDraft(node("newer")); flush(); }
        if (change === "cancel") { h.editor.close(); expect(world.requests[0].signal.aborted).toBe(true); }
        if (change !== "closed") await world.answer(0, {});
        await flight;
        expect(h.writes).toEqual([]); expect(h.callbackCalls).toEqual([]); expect(h.syncCalls).toEqual([]);
        if (change === "revision") expect(h.editor.error()).toBe(world.LOCAL_SAVE_CHANGED);
        if (change === "draft") expect(h.editor.error()).toBe("The draft changed while it was being checked. Save again.");
        if (change === "closed") expect(h.editor.error()).toBe(world.LOCAL_SAVE_TOOLS_PENDING);
      });
    }
  });
});

describe("actual TypeContract result notes distinguish checking from an unfinished body", () => {
  for (const editorKind of ["new", "saved"]) {
    test(`${editorKind} complete draft initially shows Checking without replacing its body`, async () => withResultNote(editorKind, {}, async ({ h, api, body }) => {
      const retained = body();
      expect(api.note()).toBe("Checking result type…");
      expect(api.preview().pending).toBe(true); expect(api.resultType()).toBeUndefined();
      expect(body()).toBe(retained); expect(h.closes()).toBe(0);
    }));

    test(`${editorKind} renewed checking clears prior type/error and later exposes completed annotation guidance`, async () => withResultNote(editorKind, {}, async ({ h, api, body, setBody, transports }) => {
      const initial = body(); api.note();
      transports[0].resolve(inference("ready-note")); await settle();
      expect(api.note()).toBeUndefined(); expect(api.resultType()).toEqual(inference("ready-note").fn.returns);
      expect(body()).toBe(initial);
      const next = node("another complete body"); setBody(next); flush();
      expect(api.note()).toBe("Checking result type…"); expect(api.resultType()).toBeUndefined();
      expect(api.preview().error).toBeUndefined(); expect(body()).toBe(next);
      transports[1].reject(new Error("controlled completed type error")); await settle();
      expect(api.preview().error).toBe("controlled completed type error");
      expect(api.note()).not.toBe("Checking result type…"); expect(body()).toBe(next);
      const last = node("complete body needing annotation"); setBody(last); flush();
      expect(api.note()).toBe("Checking result type…"); expect(api.preview().error).toBeUndefined();
      expect(api.resultType()).toBeUndefined(); expect(body()).toBe(last);
      transports[2].resolve({ outcome: { $tag: "Unresolved", diagnostics: [], fixtureLabel: "Controlled annotation is required" } });
      await settle();
      expect(api.preview().pending).toBe(false); expect(api.note()).toBe("Controlled annotation is required");
      expect(body()).toBe(last); expect(h.closes()).toBe(0);
    }));

    test(`${editorKind} explicit results and non-Local previews retain their existing note behavior`, async () => {
      const explicit = editorKind === "new" ? { initialResultMode: "explicit" } : { rawResultMode: "explicit" };
      await withResultNote(editorKind, explicit, async ({ api }) => {
        expect(api.preview().pending).toBe(true); expect(api.note()).toBeUndefined();
        expect(api.resultType()).toBeDefined();
      });
      for (const kind of ["account", undefined]) await withResultNote(editorKind, { kind }, async ({ api, transports }) => {
        expect(api.note()).toBeUndefined(); expect(api.resultType()).toBeDefined();
        expect(Object.hasOwn(api.preview(), "pending")).toBe(false); expect(transports).toEqual([]);
      });
    });
  }

  test("bodyless drafts do not acquire Checking guidance", async () => {
    await withHome({ initialHasBody: false }, async h => {
      const retained = h.body(); expect(h.api.note()).toBeUndefined(); expect(h.transports).toEqual([]);
      expect(h.body()).toBe(retained);
    });
    await withSaved({}, async h => {
      h.setBodyDraft(null); flush();
      expect(h.editor.note()).toBeUndefined(); expect(h.editor.preview()).toBeUndefined();
      expect(h.closes()).toBe(0);
    });
  });
});
