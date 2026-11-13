// Test harness: the build replaces this declaration with Home's actual modal.
// Universal editors and the persistence closure remain production code; only
// reader IO is controlled and draft setters are exposed for regression setup.
import { For, Show, Loading, Errored, createContext, createMemo, createSignal, createEffect, onSettled, useContext, snapshot, flush, untrack, latest } from "solid-js";
import { render } from "@solidjs/web";
import { Nothing, Str, Bool, Nat, Int, Rational, List, Maybe } from "@fenel/engine/type-foundation";
import type { FenelFunction, FenelType, FieldDef, Constraint, TypeScheme, TypeConstructorParam } from "@fenel/engine/types";
import { createRegistry } from "@fenel/engine/registry";
import { registryTransportSnapshot } from "../../../../../../implementations/typescript/engine/src/registry";
import { readerSourceMetadataEvaluateContext } from "@fenel/engine/expressions";
import { createAuthoringEnvironment, inferAuthoringFunctionDraft, projectAuthoringScheme, reconcileAuthoringSchemeBody } from "@fenel/engine/authoring/environment";
import { editAuthoringGenericDeclaration, type AuthoringGenericEdit } from "@fenel/engine/authoring/generic-parameters";
import { buildAuthoringSignatureDeclaration, projectAuthoringInferenceOutcome } from "@fenel/engine/authoring/signature-authoring";
import { reconcileAuthoringBindingRows } from "@fenel/engine/authoring/binding-edits";
import { LambdaFormEditorSurface } from "../expression-runner/structural-surfaces";
import { GenericParametersEditor } from "./GenericParametersEditor";
import { ExpressionEditor, LambdaParamsContext, toLogic, logicToExprNode, type ExprNode, type LambdaParam } from "../expression-runner";
import { AuthoringSessionContext, reactiveAuthoringSession, createDetachedAuthoringEnvironment, type AuthoringSession } from "../expression-runner/authoring-session";
import { createAccountAuthoringSession, createLocalAuthoringSession, concreteAuthoringSession,
  localAuthoringScopeForSession as sessionLocalAuthoringScope, type LocalAuthoringScope } from "../expression-runner/account-authoring-session";
import type { PreparedReaderWorker } from "../expression-runner/authoring-catalog-worker";
import type { AuthoringFunctionDraftInference, AuthoringFunctionBodySaveIssue, AuthoringWorkerPayload } from "../expression-runner/authoring-worker-protocol";
import { assertReaderSourceMetadata, captureReaderSourceMetadata } from "../reader-source-metadata";
import { savedExpressionDeclaration, restoreSavedExpressionDeclaration } from "../saved-expression-map";
import { assertCurrentSession, sessionEpoch } from "../browser-session";
import { createAsyncValue } from "../async-value";
import { expectedTypeForName, seedExpressionForType } from "../expression-runner/creation-seed";
import { functionBodySaveIssue } from "../expression-runner/creation-validation";
import { RepresentationsPanel } from "../representations/RepresentationsPanel";
import { TypeBuilder, GenericTypeScopeContext } from "../type-builder/TypeBuilder";
import { TypeContract } from "../expression-runner/type-contract";
import { ConstraintsEditor } from "../instances/ConstraintsEditor";
import { LocusSelect } from "../locus-select";
import { ModalOverlay } from "../confirm-modal";
import { FieldAuthoringProvider, createFieldResurrectionSelection, desiredFieldFacetValues, fieldFacetReplacementIds, forgetFieldFacetDrafts, persistedRootFieldOwner, type FieldFacetDraftMap } from "../field-occurrence";
import { displayTypeLabel } from "../field-renderer";
import { locusCatalogReference } from "../locus-catalog-reference";
import { createTypeDraft, typeDraftWithTypedName, type TypeDraft } from "../type-draft-save";
// Names Home's spliced composer helpers (identity row, icon picker) read.
import { LUCIDE_ICON_NAMES } from "../representations/lucide-icon-names";
import { IconByName, LUCIDE_BY_NAME } from "../icons";
import { cloneDraftValue, draftValueFingerprint } from "../native-draft";
import type { CaptureTypePickerTarget } from "../type-builder";
// B4 slice 2 names the spliced NewFunctionModal reads (Home imports/defines them).
import { localDraftChecksPending } from "../expression-runner/live-guidance";
const LOCAL_SAVE_DRAFT_CHANGED = "The draft changed while it was being checked. Save again.";
import { StepsEditor } from "./StepsEditor";
import { functionStore } from "./store";
import { ApiClientContext, createPublicApiClient, type FieldAuthoringCatalogRow } from "../api";
import { instanceKey, type InstanceApiRow, type InstanceDraft } from "../instances/instance-draft";

// Controlled async transport only: the actual Home requests still invoke the
// existing inference/admission owners in their exact captured Local session.
// This fixture does not exercise a browser Worker or claim thread isolation.
type WorkerStage = "infer-function-draft" | "function-body-save-issue";
let fixtureWorkerToken: object = Object.freeze({});
const workerSessions = new WeakMap<AuthoringSession, object>();
const workerScopes = new WeakMap<LocalAuthoringScope, AuthoringSession>();
const workerHandles = new WeakMap<AuthoringSession, PreparedReaderWorker>();
const workerBindings = new WeakMap<PreparedReaderWorker, { session: AuthoringSession; token: object; epoch: number }>();
let heldWorker: { stage: WorkerStage; promise: Promise<void>; resolve: () => void; reject: (error: Error) => void } | undefined;
let workerPending = 0;
let workerRequests: AuthoringWorkerPayload[] = [];
function bindFixtureLocalSession(session: AuthoringSession): AuthoringSession {
  workerSessions.set(session, fixtureWorkerToken);
  return session;
}
function localAuthoringScopeForSession(supplied: AuthoringSession) {
  const session = concreteAuthoringSession(supplied);
  const scope = sessionLocalAuthoringScope(session);
  if (scope) workerScopes.set(scope, session);
  return scope;
}
function authoringWorkerSnapshot(supplied: AuthoringSession): object | undefined {
  const token = workerSessions.get(concreteAuthoringSession(supplied));
  if (token && token !== fixtureWorkerToken) throw Error("This authoring snapshot was replaced. Retry with the current data.");
  return token;
}
function preparedReaderWorkerForSession(supplied: AuthoringSession): PreparedReaderWorker | undefined {
  const session = concreteAuthoringSession(supplied);
  const token = authoringWorkerSnapshot(session);
  if (!token) return undefined;
  let handle = workerHandles.get(session);
  if (!handle) {
    handle = Object.freeze({}) as PreparedReaderWorker;
    workerHandles.set(session, handle);
    workerBindings.set(handle, { session, token, epoch: sessionEpoch() });
  }
  return handle;
}
function scopePreparedReaderWorker(handle: PreparedReaderWorker, scope: LocalAuthoringScope): PreparedReaderWorker {
  const binding = workerBindings.get(handle);
  const session = workerScopes.get(scope);
  if (!binding || binding.token !== fixtureWorkerToken || !session
    || authoringWorkerSnapshot(session) !== binding.token
    || sessionLocalAuthoringScope(binding.session)?.sourceId !== scope.sourceId) {
    throw Error("The authoring scope does not belong to this prepared reader.");
  }
  return preparedReaderWorkerForSession(session)!;
}
async function runPreparedReaderWorker(handle: PreparedReaderWorker, payload: AuthoringWorkerPayload,
  signal?: AbortSignal): Promise<AuthoringFunctionDraftInference | AuthoringFunctionBodySaveIssue> {
  const binding = workerBindings.get(handle);
  if (!binding) throw Error("The prepared reader worker is unavailable.");
  const current = () => {
    signal?.throwIfAborted(); assertCurrentSession(binding.epoch);
    if (binding.token !== fixtureWorkerToken || authoringWorkerSnapshot(binding.session) !== binding.token) {
      throw Error("This authoring snapshot was replaced. Retry with the current data.");
    }
  };
  current();
  const input = registryTransportSnapshot(payload, "fixture function request");
  workerRequests.push(input); workerPending++;
  try {
    await Promise.resolve();
    const held = heldWorker;
    if (held && held.stage === input.method) await held.promise;
    current();
    const session = binding.session;
    if (input.method === "infer-function-draft") {
      return registryTransportSnapshot(inferAuthoringFunctionDraft(input.fn, input.declaration, session.environment,
        { registry: session.registry }), "fixture function draft result");
    }
    if (input.method === "function-body-save-issue") {
      const node = input.rootDeclaration ? restoreSavedExpressionDeclaration(input.node, input.rootDeclaration) : input.node;
      const evaluateContext = readerSourceMetadataEvaluateContext(session.evaluateContext, input.sourceMetadata);
      return registryTransportSnapshot({ issue: functionBodySaveIssue(node, input.definition, session.environment,
        { registry: session.registry, evaluateContext }) }, "fixture function body save result");
    }
    throw Error("This fixture only transports function authoring operations.");
  } finally { workerPending--; }
}
function resetFixtureWorker() {
  heldWorker?.resolve(); heldWorker = undefined;
  fixtureWorkerToken = Object.freeze({}); workerRequests = [];
  localBaseSession = undefined;
}

function freshFieldIO() {
  return {
    identities: new Map<string, FieldAuthoringCatalogRow>(), interfaces: [] as string[],
    rows: [] as InstanceApiRow[], reads: 0, completed: 0,
    held: undefined as { promise: Promise<void>; resolve: () => void } | undefined,
  };
}
let fieldIO = freshFieldIO();
function resetFieldIO() { fieldIO.held?.resolve(); fieldIO = freshFieldIO(); }

// IO-only fixture responses: persisted field metadata can arrive independently
// of a held definition save; all facet merging remains in the real provider.
const fixtureApi = { ...createPublicApiClient(),
  getFieldAuthoringCatalog: async () => ({ fields: [...fieldIO.identities.values()], facetInterfaceNames: [...fieldIO.interfaces] }),
  getFieldAuthoringIdentity: async (id: string) => ({ field: fieldIO.identities.get(id) ?? null }),
  getFieldResurrectionCatalog: async () => ({ fields: [] }),
  getFieldFacetInstances: async () => {
    const request = fieldIO;
    request.reads++;
    await request.held?.promise;
    request.completed++;
    return { dispatchInstances: cloneDraftValue(request.rows) };
  },
};

declare const NewFunctionModal: (props: { onClose: () => void }) => import("@solidjs/web").JSX.Element;
declare const NewTypeModal: (props: { onClose: () => void }) => import("@solidjs/web").JSX.Element;
declare const functionBodyExpr: () => ExprNode | null;

type Controls = {
  snapshot: () => Record<string, unknown>;
  params: (type: FenelType) => void;
  returns: (type: FenelType) => void;
  body: (expr: ExprNode) => void;
  reps: (values: Record<string, Record<string, unknown>>) => void;
  requires: (constraints: Constraint[]) => void;
  hasBody: (value: boolean) => void;
  resultMode?: (value: "infer" | "explicit") => void;
  ownedScheme?: (scheme: TypeScheme) => void;
  guardParams?: (fields: FieldDef[]) => boolean;
  facets?: (value: FieldFacetDraftMap) => void;
  authorFacet?: (fieldId: string, value: FieldFacetDraftMap[string]) => void;
  editReturn?: (type: FenelType) => boolean;
};
let controls!: Controls;
let typeControls!: {
  snapshot: () => Record<string, unknown>;
  shape: (type: FenelType) => void;
  reps: Controls["reps"];
  scheme?: (scheme: TypeScheme) => void;
  params?: (params: TypeConstructorParam[]) => void;
  editShape?: (type: FenelType) => boolean;
  facets?: Controls["facets"];
  authorFacet?: Controls["authorFacet"];
};
let dispose: (() => void) | undefined;
let closed = 0;
const bundles: unknown[] = [];
const representations: unknown[] = [];
const additions: unknown[] = [];
let reloads = 0;
type SaveStage = "definition" | "representation" | "reload" | "addition";
let held: { stage: SaveStage; promise: Promise<void>; resolve: () => void; reject: (error: Error) => void } | undefined;
async function waitAt(stage: SaveStage) {
  if (held?.stage === stage) await held.promise;
}
const HomeDataContext = createContext<{ add: (...args: unknown[]) => Promise<boolean> } | null>(null);
const subject = () => ({ $tag: "User", accountId: "fixture-account" });

let baseSession: AuthoringSession;
let localBaseSession: AuthoringSession | undefined;
function fixtureSession() {
  if (baseSession) return baseSession;
  const types = Object.entries({ String: Str, Boolean: Bool, Nat, Number: Rational, Int, Unit: { $unit: true } as FenelType, Type: { $type: true } as FenelType })
    .map(([name, type]) => ({ id: name, name, type, description: "", category: "fixture" }));
  const params: FieldDef[] = [{ name: "input", type: { $var: "a" }, label: Nothing, ui: Nothing, meta: {},
    key: { $tag: "PositionalField", index: 0 } }];
  const returns: FenelType = { $unit: true };
  // This controlled IO has forall a. a -> Unit. It tests body preservation,
  // not the production sleep declaration; checking its body never runs it.
  const functions = [{ id: "sleep", targetId: "sleep", label: "Sleep", description: "", kind: "function" as const,
    params, returns, scheme: { quantified: [{ id: "a", sourceName: "a", kind: { $tag: "KType" as const } }],
      body: { $arrow: { params, returns } } }, signatureOutcome: { $tag: "Solved" as const } }];
  const environment = createDetachedAuthoringEnvironment(createAuthoringEnvironment({ types, capabilities: [], catalogTypes: types.map(entry => entry.type), functions, operatorCodeNameByNotation: new Map() }));
  const registry = createRegistry([]);
  return baseSession = { mode: "detached", environment, catalog: environment.catalog, registry, evaluateContext: registry.evaluateContext() };
}
function localFixtureSession() {
  return localBaseSession ??= bindFixtureLocalSession(createLocalAuthoringSession(fixtureSession(), {
    sourceId: "home-function-fixture", functions: [],
  }));
}
const homeFixtureSession = () => readerKind === "local" ? localFixtureSession() : fixtureSession();
// Each reader transaction the controlled client receives. A Local tab rebuilds
// its whole checked reader once per transaction (61391420), so a new definition
// and its own representations must arrive as ONE transaction there.
const transactions: string[] = [];
let readerKind: "account" | "local" = "account";
// Controlled IO with the production signatures that Home's actual
// `saveDefinitionWithRepresentations` (spliced below by the build) calls.
async function persistRepresentations(id: string, values: Record<string, Record<string, unknown>>, _scope: unknown,
  _client: unknown, _registry: unknown, canContinue?: () => boolean) {
  for (const [typeName, methods] of Object.entries(values)) {
    if (canContinue && !canContinue()) return;
    transactions.push("representation");
    representations.push(cloneDraftValue([typeName, id, methods]));
    await waitAt("representation");
  }
}
// B4 unit E: a Local reader's saves encode through the client's worker
// encoding; this fixture's opaque one must be exactly what Home hands over.
const localInstanceEncoding = Object.freeze({ encodeInstances: async () => { throw new Error("Unexpected fixture encoding"); } });
async function representationWrites(id: string, values: Record<string, Record<string, unknown>>, _scope: unknown,
  _client: unknown, encoding: unknown, canContinue?: () => boolean) {
  if (readerKind === "local" && encoding !== localInstanceEncoding)
    throw new Error("A Local definition save encoded its representations without the reader's worker encoding.");
  if (canContinue && !canContinue()) return undefined;
  return Object.entries(values).map(([typeName, methods]) => ({ typeName, args: [id], instance: { typeName, args: [id], methods } }));
}
const accountFieldRegistry = () => fixtureSession().registry;
function useHomeReader() {
  const reader = readerKind === "local"
    ? { kind: "local" as const, sourceId: "home-function-fixture", registry: () => localFixtureSession().registry,
      session: localFixtureSession, revision: () => 0,
      draftSession: (draft: FenelFunction) => bindFixtureLocalSession(createLocalAuthoringSession(localFixtureSession(), {
        sourceId: "home-function-fixture", functions: [], draft })) }
    : { kind: undefined, accountId: "fixture-account", registry: () => fixtureSession().registry, session: undefined, draftSession: undefined };
  const client = {
    drafts: undefined,
    ...(readerKind === "local" ? { instanceEncoding: () => localInstanceEncoding } : {}),
    api: { definitionBundleSave: async (bundle: unknown) => {
      transactions.push("definition"); bundles.push(cloneDraftValue(bundle)); await waitAt("definition"); return {};
    } },
    getLocusRoot: async () => ({ root: { revision: 0 } }),
    editDefinitionAndData: readerKind === "local" ? async (bundle: unknown, _revision: number,
      mutation: { representations?: Array<{ typeName: string; args: string[]; instance: { methods: Record<string, unknown> } }>;
        encodingRegistry?: unknown }) => {
      if (mutation.encodingRegistry !== localInstanceEncoding)
        throw new Error("A Local definition save was written under another encoding than its worker's.");
      transactions.push("definition+representations"); bundles.push(cloneDraftValue(bundle)); await waitAt("definition");
      for (const write of mutation.representations ?? []) representations.push(cloneDraftValue([write.typeName, write.args[0], write.instance.methods]));
      return {};
    } : undefined,
  };
  return {
    reader,
    temporaryEdits: () => false,
    assertAppearanceDrafts: () => {},
    api: client.api,
    revalidate: () => {}, homeAuthoringSession: homeFixtureSession, userFunctions: () => [],
    reloadUserRegistries: async () => { reloads++; await waitAt("reload"); },
    accountAuthoringSession: (scope: Parameters<typeof createAccountAuthoringSession>[1]) => createAccountAuthoringSession(fixtureSession(), scope),
    persistRepresentation: async (...args: unknown[]) => { representations.push(cloneDraftValue(args)); await waitAt("representation"); },
    persistRepresentations: (targetId: string, values: Record<string, Record<string, unknown>>, canContinue?: () => boolean) =>
      persistRepresentations(targetId, values, undefined, client, reader?.registry() ?? accountFieldRegistry(), canContinue),
    /* ACTUAL_HOME_DEFINITION_SAVE */
    addToLocus: async (...args: unknown[]) => { additions.push(cloneDraftValue(args)); await waitAt("addition"); return true; },
  };
}
function repString(values: Record<string, Record<string, unknown>>, name: string, method: string) {
  const value = values[name]?.[method];
  return typeof value === "string" ? value : "";
}

// Exact Home inspection projection, composed with its universal body editor.
// This component fixture does not simulate a persisted reader or native startup.
function FunctionBodyInspection(props: { fn: FenelFunction }) {
  const functionPin = () => ({ fn: props.fn });
  const functionIngress = () => undefined;
  const functionSourceAuthoringSession = fixtureSession;
  /* ACTUAL_FUNCTION_BODY_PROJECTION */
  return <section style="padding: 2rem; background: white">
    <h2>Function body inspection</h2>
    <p>{props.fn.id}</p>
    <Show when={functionBodyExpr()} fallback={<p data-absent-body>No body editor</p>}>
      {body => <ExpressionEditor expr={body()} onChange={() => {}} authoringSession={fixtureSession()}
        fieldDef={{ name: "result", type: props.fn.returns, label: Nothing, ui: Nothing, meta: {} }} />}
    </Show>
  </section>;
}

const fixture = {
  mount(keepHistory = false, kind: "account" | "local" = "account") {
    dispose?.(); closed = 0; readerKind = kind; resetFixtureWorker();
    if (!keepHistory) { bundles.length = 0; representations.length = 0; additions.length = 0; transactions.length = 0; reloads = 0; resetFieldIO(); }
    const host = document.getElementById("fixture")!; host.replaceChildren();
    dispose = render(() => <Errored fallback={error => <pre data-fixture-error>{String(error())}</pre>}>
      <Loading fallback={<p>Loading function editor…</p>}><ApiClientContext value={fixtureApi}><AuthoringSessionContext value={homeFixtureSession()}>
        <NewFunctionModal onClose={() => {
          closed++; dispose?.(); host.replaceChildren();
          const message = document.createElement("p");
          message.textContent = "New function editor is closed.";
          host.append(message);
        }} />
      </AuthoringSessionContext></ApiClientContext></Loading>
    </Errored>, host);
  },
  mountType(kind: "account" | "local" = "account") {
    dispose?.(); closed = 0; readerKind = kind; resetFixtureWorker(); bundles.length = 0; representations.length = 0; additions.length = 0; transactions.length = 0;
    resetFieldIO();
    const host = document.getElementById("fixture")!; host.replaceChildren();
    dispose = render(() => <Errored fallback={error => <pre data-fixture-error>{String(error())}</pre>}>
      <Loading fallback={<p>Loading type editor…</p>}><ApiClientContext value={fixtureApi}><AuthoringSessionContext value={homeFixtureSession()}>
        <NewTypeModal onClose={() => { closed++; dispose?.(); host.replaceChildren(); }} />
      </AuthoringSessionContext></ApiClientContext></Loading>
    </Errored>, host);
  },
  typeState: () => ({ ...typeControls.snapshot(), bundles: cloneDraftValue(bundles), representations: cloneDraftValue(representations), additions: cloneDraftValue(additions), transactions: [...transactions], closed }),
  setTypeShape: (value: FenelType) => { typeControls.shape(value); flush(); },
  setTypeReps: (value: Record<string, Record<string, unknown>>) => { typeControls.reps(value); flush(); },
  setTypeScheme: (value: TypeScheme) => { typeControls.scheme?.(value); flush(); },
  setTypeParams: (value: TypeConstructorParam[]) => { typeControls.params?.(value); flush(); },
  setTypeFacets: (value: FieldFacetDraftMap) => { typeControls.facets?.(value); flush(); },
  authorFieldFacet(kind: "function" | "type", fieldId: string, value: FieldFacetDraftMap[string]) {
    const change = (kind === "function" ? controls : typeControls).authorFacet;
    if (!change) throw new Error("This frozen creator has no exposed authored facet callback");
    change(fieldId, value); flush();
  },
  configureFieldIO(identity: FieldAuthoringCatalogRow, rows: InstanceApiRow[], hold = true) {
    fieldIO.identities.set(identity.fieldId, cloneDraftValue(identity));
    fieldIO.interfaces = ["Labelable", "Describable"];
    fieldIO.rows = cloneDraftValue(rows);
    if (hold) {
      let resolve!: () => void;
      const promise = new Promise<void>(done => { resolve = done; });
      fieldIO.held = { promise, resolve };
    }
  },
  fieldIOState: () => ({ reads: fieldIO.reads, completed: fieldIO.completed, held: !!fieldIO.held, rows: cloneDraftValue(fieldIO.rows) }),
  releaseFieldFacets(rows?: InstanceApiRow[]) {
    if (!fieldIO.held) throw new Error("No field facet read is held");
    if (rows) fieldIO.rows = cloneDraftValue(rows);
    const current = fieldIO.held; fieldIO.held = undefined; current.resolve();
  },
  seedFieldFacet(kind: "function" | "type", fieldId: string, methods: Record<string, unknown>) {
    const draft: InstanceDraft = { typeName: "Labelable", args: [fieldId], methods };
    (kind === "function" ? controls : typeControls).facets?.({ [fieldId]: { [instanceKey(draft)]: draft } });
    flush();
  },
  editTypeShape: (value: FenelType) => { const result = typeControls.editShape?.(value); flush(); return result; },
  state: () => ({ ...controls.snapshot(), bundles: cloneDraftValue(bundles), representations: cloneDraftValue(representations), additions: cloneDraftValue(additions), transactions: [...transactions], reloads, closed }),
  workerState: () => ({ pending: workerPending, held: heldWorker?.stage, requests: cloneDraftValue(workerRequests) }),
  holdWorker(stage: WorkerStage) {
    if (heldWorker) throw Error("A function worker operation is already held");
    let resolve!: () => void; let reject!: (error: Error) => void;
    const promise = new Promise<void>((yes, no) => { resolve = yes; reject = no; });
    heldWorker = { stage, promise, resolve, reject };
  },
  releaseWorker(error?: string) {
    const pending = heldWorker; heldWorker = undefined;
    if (error) pending?.reject(Error(error)); else pending?.resolve();
  },
  holdNext(stage: SaveStage) {
    if (held) throw new Error("A save stage is already held");
    let resolve!: () => void; let reject!: (error: Error) => void;
    const promise = new Promise<void>((done, fail) => { resolve = done; reject = fail; });
    held = { stage, promise, resolve, reject };
  },
  releaseHeld(fail = false) {
    const current = held;
    if (!current) throw new Error("No save stage is held");
    held = undefined;
    if (fail) current.reject(new Error("Delayed save failed")); else current.resolve();
  },
  setParams: (value: FenelType) => { controls.params(value); flush(); },
  setReturns: (value: FenelType) => { controls.returns(value); flush(); },
  setBody: (value: ExprNode) => { controls.body(value); flush(); },
  setReps: (value: Record<string, Record<string, unknown>>) => { controls.reps(value); flush(); },
  setRequires: (value: Constraint[]) => { controls.requires(value); flush(); },
  setResultMode: (value: "infer" | "explicit") => { controls.resultMode?.(value); flush(); },
  setOwnedScheme: (value: TypeScheme) => { controls.ownedScheme?.(value); flush(); },
  guardParams: (value: FieldDef[]) => { const accepted = controls.guardParams?.(value); flush(); return accepted; },
  setFacets: (value: FieldFacetDraftMap) => { controls.facets?.(value); flush(); },
  editReturn: (value: FenelType) => { const result = controls.editReturn?.(value); flush(); return result; },
  inspectBody(value: unknown, returns: FenelType) {
    dispose?.();
    const host = document.getElementById("fixture")!; host.replaceChildren();
    dispose = render(() => <AuthoringSessionContext value={fixtureSession()}>
      <FunctionBodyInspection fn={{ id: `body = ${JSON.stringify(value)}`, params: [], returns, body: value as FenelFunction["body"] }} />
    </AuthoringSessionContext>, host);
  },
  globalStoreSentinel() { functionStore.load({ id: "sentinel-function", name: "sentinel", params: [], returns: { $ref: "Number" }, body: false, active: true }); flush(); },
  globalStoreState: () => cloneDraftValue(functionStore.serialize()),
  reopenSaved() {
    const bundle = bundles.at(-1) as { ownerMutations: [{ owner: { definition: FenelFunction } }] };
    const saved = bundle.ownerMutations[0].owner.definition;
    fixture.mount(); controls.params({ $record: { fields: saved.params } }); controls.returns(saved.returns);
    if (saved.signatureDeclaration?.scheme) controls.ownedScheme?.(saved.signatureDeclaration.scheme);
    controls.resultMode?.(saved.signatureDeclaration?.returns.$tag === "Absent" ? "infer" : "explicit");
    controls.requires(saved.requires ?? []); controls.hasBody(Object.hasOwn(saved, "body"));
    if (Object.hasOwn(saved, "body")) controls.body(logicToExprNode(saved.body, saved.params.map(param => param.name), fixtureSession()));
    flush(); return saved;
  },
};
declare global { var homeFunctionFixture: typeof fixture; }
globalThis.homeFunctionFixture = fixture;
