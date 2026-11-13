// C1: actual Home saved-definition editor; only its captured reader IO is controlled.
import { For, Show, Switch, Match, Loading, Errored, createContext, useContext, createMemo, createSignal, createEffect, onSettled, onCleanup, untrack, snapshot, refresh, flush, latest } from "solid-js";
import { render, Portal } from "@solidjs/web";
import type { FenelFunction, FenelType, FieldDef, Instance, TypeScheme, TypeConstructorParam } from "@fenel/engine/types";
import { Nothing, Just, Str, Bool, Rational, Nat, peelMaybeValue } from "@fenel/engine/type-foundation";
import { createRegistry, registryTransportSnapshot } from "../../../../../../implementations/typescript/engine/src/registry";
import { readerSourceMetadataEvaluateContext } from "@fenel/engine/expressions";
import { stdModule } from "@fenel/engine/modules/std";
import { planFieldPersistence, type FieldPersistenceSnapshot } from "@fenel/engine/field-authoring";
import { createAuthoringEnvironment, inferAuthoringFunctionDraft, projectAuthoringScheme, reconcileAuthoringSchemeBody, type AuthoringCatalogFunctionEntry } from "@fenel/engine/authoring/environment";
import { authoringExpressionHasEmptySlot, buildAuthoringSignatureDeclaration, projectAuthoringInferenceOutcome } from "@fenel/engine/authoring/signature-authoring";
import { reconcileAuthoringBindingRows } from "@fenel/engine/authoring/binding-edits";
import { editAuthoringGenericDeclaration, type AuthoringGenericEdit } from "@fenel/engine/authoring/generic-parameters";
import { printFenel, entitySchemaFields, refEntityTypeOf, peelMaybe } from "@fenel/engine";
import { canonical } from "@fenel/engine/locale";
import { typeDisplayName } from "@fenel/engine/authoring/expression";
import { getSystemRegistry } from "@fenel/engine/system-registry";
import { resolveIdentifiedFieldView } from "@fenel/engine/identified-field-view";
import { typeFieldOccurrences, defaultValueForAuthoring, valueToJsonWire, valueFromJsonWire, VALUE_JSON_ENCODING,
  isValueJsonEncoding, isInstanceJsonEncoding } from "@fenel/engine/authoring/type";
import { ExpressionEditor, ExpressionTrace, SavedValuesContext, TypePicker, LambdaParamsContext, InstanceTraceContext, toLogic, logicToExprNode,
  inferExpressionTypeName, inferExpressionType, listRefs, evaluateAuthoringExpression as evaluateSessionExpression, type ExprNode, type LambdaParam } from "../expression-runner";
import { createLocalAuthoringSession, concreteAuthoringSession,
  localAuthoringScopeForSession as sessionLocalAuthoringScope, type LocalAuthoringScope, type AuthoringSession } from "../expression-runner/account-authoring-session";
import type { PreparedReaderWorker } from "../expression-runner/authoring-catalog-worker";
import { authoringWorkerReplacementPending, evaluateExpressionInWorker, expressionSaveIssueInWorker, inferExpressionsInWorker } from "../expression-runner/authoring-catalog-worker";
import { createLocalLiveGuidance, localGuidanceCapture, localGuidanceCurrent } from "../expression-runner/live-guidance-local";
import { createGuidanceLane, localDraftChecksPending } from "../expression-runner/live-guidance";
import { openLocalLiveGuidance, createLocalReaderAnswer, raisedNode, readActionResult, runLocalReaderAction, LOCAL_ACTION_CHANGED } from "../expression-runner/local-reader-actions";
import { WorkerRequestError } from "../expression-runner/authoring-worker-transport";
import { expressionInferenceItem } from "../expression-runner";
import { peelListForAuthoring, resolveValueType } from "@fenel/engine/authoring/type";
import { getSavedQueries } from "../api";
import { CardLoadingIndicator } from "../value-card";
import { CreationScopePath, MoveValueDialog } from "../move-value-dialog";
import { expressionMentions } from "../dependency-graph-dialog";
import { ROOT_SCOPE, childrenOf, scopeKey, scopeLabel, valueAt } from "../locus-scope";
import { childValueType } from "../data-transfer/child-type";
import { followLocusPath } from "../locus-reference";
import { rootDataRow } from "../locus-root-data";
import { editableContainerAt, expressionAt, appendExpressionAt } from "../locus-expression-edit";
import { locusReaderWrites } from "../locus-reader-writes";
import { evaluateLocusCard, readLocusCapturedValue } from "../locus-card-evaluation";
import { shareSavedExpressionMap } from "../saved-expression-map";
import { addToLocus, asView } from "../locus-view-model";
import { clampCardPosition } from "../type-draft-card";
import type { CreationCardAnchor } from "../home-action";
import { LocusLoadFailure } from "../locus-notifications";
import type { AuthoringFunctionDraftInference, AuthoringFunctionBodySaveIssue, AuthoringWorkerPayload } from "../expression-runner/authoring-worker-protocol";
import { assertReaderSourceMetadata, captureReaderSourceMetadata } from "../reader-source-metadata";
import { savedExpressionDeclaration, restoreSavedExpressionDeclaration } from "../saved-expression-map";
import { createAsyncValue } from "../async-value";
import { AuthoringSessionContext, createDetachedAuthoringEnvironment } from "../expression-runner/authoring-session";
import { emptyExpressionSlot, expectedTypeForName, seedExpressionForType, expressionForLiteralValue } from "../expression-runner/creation-seed";
import { detectStructuralForm } from "../expression-runner/expression-structure";
import { draftSaveIssue, functionBodySaveIssue } from "../expression-runner/creation-validation";
import { LambdaFormEditorSurface } from "../expression-runner/structural-surfaces";
import { GenericParametersEditor } from "./GenericParametersEditor";
import { TypeBuilder, GenericTypeScopeContext } from "../type-builder/TypeBuilder";
import { TypeContract } from "../expression-runner/type-contract";
import type { CaptureTypePickerTarget, TypePickerSelection } from "../type-builder";
import { typedReadTypePresentation } from "../layout-renderer/TypedReadValue";
import { presentedTypeTarget } from "../type-icon-presentation";
import { ReaderRuntimeProvider, ReaderRuntimeContext, type ReaderRuntime } from "../reader-runtime";
import { phonePickerVisualSession, phonePickerVisualReader, phonePickerVisualRow, phonePickerVisualHandle } from "../type-builder/type-picker-owner.browser-fixture";
// The existing fixture build exposes this exact production component only in
// the explicit Phone capsule. It does not copy or replace its implementation.
declare const PhoneVisualNodeEditor: (props: any) => import("@solidjs/web").JSX.Element;
import { ConstraintsEditor } from "../instances/ConstraintsEditor";
import { RepresentationsPanel } from "../representations/RepresentationsPanel";
import { LocusSelect } from "../locus-select";
import { ModalOverlay } from "../confirm-modal";
import { FenelCodeEditor } from "./FenelCodeEditor";
import { displayTypeLabel, EntityComponentProvider, RefResolverProvider } from "../field-renderer";
import { FieldPresentationRegistryProvider } from "../field-renderer/field-presentation-context";
import { AdminForm, entityComponentLookup } from "../admin-form";
import { VariantValueEditor, VariantValueRenderer } from "../variant-value";
import { DataTable, type ColumnDef } from "../data-table";
import { UsagesSection } from "../../routes/app/types/[id]/usages";
import { LoadingScreen } from "../loading-screen";
import { ApiClientContext, createPublicApiClient, type FieldAuthoringCatalogRow } from "../api";
import { persistRepresentation as persistRepresentationOwner } from "../representations/persist";
import { apiRowToDraft, instanceKey, type InstanceApiRow } from "../instances/instance-draft";
import { readLocusCatalogReference, resolveLocusCatalogReference, locusCatalogReferenceValue } from "../locus-catalog-reference";
import { cloneDraftValue, draftValueFingerprint } from "../native-draft";
import { IconByName, LUCIDE_BY_NAME, TYPE_ICON_FALLBACKS } from "../icons";
import { LUCIDE_ICON_NAMES } from "../representations/lucide-icon-names";
import { QUICK_TYPE_CATEGORIES, QUICK_TYPE_SUBTYPES } from "../new-value-types";
import { valueCardLabel as locale } from "../value-card";
import { assertCurrentSession, sessionEpoch } from "../browser-session";
import { FieldAuthoringProvider, createFieldResurrectionSelection, desiredFieldFacetValues, fieldFacetReplacementIds,
  forgetFieldFacetDrafts, persistedRootFieldOwner, namedFieldId, fieldFacetDraftsForOccurrences, type FieldFacetDraftMap } from "../field-occurrence";

// Controlled async transport only: Home's requests invoke the existing owners
// in their exact captured Local session. Browser Worker isolation is outside
// this component fixture's evidence.
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
    if (heldWorker?.stage === input.method) await heldWorker.promise;
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

declare const EditModalContent: (props: any) => import("@solidjs/web").JSX.Element;
declare const NewValueModal: (props: any) => import("@solidjs/web").JSX.Element;
declare const UserDefinedTypeDetail: (props: any) => import("@solidjs/web").JSX.Element;
const HomeDataContext = createContext<any>();
const genId = () => crypto.randomUUID();
const typeLabel = displayTypeLabel;
const subject = () => ({ $tag: "Anonymous" });
const EntityInstancesPanel = () => <p class="text-muted">No stored instances in this fixture.</p>;
const resolveExpr = (item: any) => item.source.expr;
let controls: any;
let valueControls: any;
// Optional held runtime comes from the caller's matched source capsule. The
// fixture does not invent catalogue ownership or replace picker resolution.
let valueReaderOverride: ReaderRuntime | undefined;
let readPhoneExpression: () => ExprNode = () => ({ kind: "literal", value: undefined });
const phoneVisualReader = () => ({ ...phonePickerVisualReader, client: dedicatedBaseClient,
  registry: () => phonePickerVisualSession.registry, session: () => phonePickerVisualSession,
  draftSession: () => phonePickerVisualSession,
} as ReaderRuntime);
let valuePending: Promise<void> | undefined;
let dispose: (() => void) | undefined;
let row: any;
let kind: "function" | "type" = "function";
let writes: any[] = [];
let closed = 0;
let valuePlacements: any[] = [];
let kindSwitches: string[] = [];
let held: { promise: Promise<void>; resolve: () => void; reject: (error: Error) => void } | undefined;
let sourceOrigin = 0;
const [definitionRevision, setDefinitionRevision] = createSignal(0);
let base: AuthoringSession | undefined;
let localBaseSession: AuthoringSession | undefined;
// Checked catalogue rows beside the saved definition (the insert-window
// captures pick among them: ranked, previewed and inserted by the editor).
let catalogueFunctions: AuthoringCatalogFunctionEntry[] = [];
let realTypeSession: AuthoringSession | undefined;
function baseSession() {
  if (realTypeSession) return realTypeSession;
  if (base) return base;
  const types = Object.entries({ String: Str, Boolean: Bool, Number: Rational, Nat })
    .map(([name, type]) => ({ id: name, name, type, description: "", category: "fixture" }));
  const environment = createDetachedAuthoringEnvironment(createAuthoringEnvironment({ types, functions: catalogueFunctions, capabilities: [],
    catalogTypes: types.map(type => type.type), operatorCodeNameByNotation: new Map() }));
  return base = { mode: "detached", environment, catalog: environment.catalog, registry: createRegistry([]), evaluateContext: {} };
}
function scope(draft?: FenelFunction) {
  if (valueReaderOverride) return draft ? valueReaderOverride.draftSession(draft) : valueReaderOverride.session();
  definitionRevision();
  const functions = kind === "function" ? [row.function] : [];
  const session = localBaseSession ??= bindFixtureLocalSession(createLocalAuthoringSession(baseSession(), {
    sourceId: "saved-editor-fixture", functions,
  }));
  return draft ? bindFixtureLocalSession(createLocalAuthoringSession(session, {
    sourceId: "saved-editor-fixture", functions, draft,
  })) : session;
}
function useHomeReader() {
  const api = {
    definitionBundleSave: async (bundle: unknown) => { writes.push(cloneDraftValue(bundle)); if (held) await held.promise; return {}; },
    savedQueryCreate: async (payload: unknown) => { writes.push(cloneDraftValue(payload)); if (held) await held.promise; return { query: { id: "created-data" } }; },
  };
  return {
    reader: valueReaderOverride ?? { kind: "local", sourceId: "saved-editor-fixture", session: () => scope(), revision: definitionRevision,
      registry: () => scope().registry, prepareFunction: (_id: string, draft?: FenelFunction) => scope(draft), draftSession: scope },
    client: { drafts: undefined, api, revalidate: () => {},
      editDefinitionAndData: async (bundle: unknown, _revision: number, _mutation: unknown) => {
        writes.push(cloneDraftValue(bundle)); if (held) await held.promise; return {};
      } },
    api,
    getFunctionByName: async () => ({ definition: kind === "function" ? cloneDraftValue(row) : undefined }),
    getTypeByName: async () => ({ definition: kind === "type" ? cloneDraftValue(row) : undefined }),
    getFunctionInstancesById: async () => ({ instances: [] }), getInstanceTimeline: async () => undefined,
    revalidate: () => {}, reloadUserRegistries: async () => {}, userFunctions: () => kind === "function" ? [row.function] : [],
    prepareAuthoringSessionForFunction: () => scope(), homeAuthoringSession: scope,
    evaluateAuthoringExpression: evaluateSessionExpression, persistRepresentation: async () => {}, assertAppearanceDrafts: () => {},
    addToLocus: async (...args: unknown[]) => { valuePlacements.push(cloneDraftValue(args.slice(0, 3))); return true; },
    knownTypeIconName: () => undefined, findTypeCatalogEntry: () => undefined, displayLabel: (id: string) => id, getDescription: () => undefined,
    resolveCatalogReference: (reference: { id: string; kind?: string }) => {
      definitionRevision();
      if (realTypeSession) return resolveLocusCatalogReference(reference, realTypeLookups());
      return { kind: kind === "type" ? "entity" : "function", value: kind === "type" ? row.type : {
        ...row.function, signatureDeclaration: undefined,
      } };
    },
    temporaryEdits: () => false, captureSourceTicket: () => ({ origin: sourceOrigin }),
    assertSourceTicket: (ticket: { origin: number }) => { if (ticket.origin !== sourceOrigin) throw Error("The data source changed while editing."); },
    getLocusRoot: async () => { throw Error("Definition-only edits must not read the root"); },
    editLocusRoot: async () => { throw Error("Definition-only edits must not write the root"); },
  };
}
function realTypeLookups() {
  const session = realTypeSession!;
  return { fn: (id: string) => session.registry.getFunction(id), entry: () => undefined,
    entityType: (id: string) => session.registry.getIdentifiedEntity(id)?.type,
    typeFamilyOwner: (id: string) => session.evaluateContext._typeFamilyOwner?.(id) };
}

// Dedicated Type mode keeps the actual page body and shared renderers. These
// records describe captured IO only; no private editor/dirty/readiness setter
// is exposed. The ordinary Home fixture remains on its existing reader seam.
type DedicatedStage = "definition" | "representation" | "reload";
type DedicatedIO = {
  name: string; storageId: string; definition: any; identities: FieldAuthoringCatalogRow[]; rows: InstanceApiRow[];
  snapshot: FieldPersistenceSnapshot;
  bundles: any[]; representationCalls: any[]; metadataWrites: any[]; lookups: string[];
  facetReads: number; facetCompleted: number; reloads: number; revalidations: unknown[]; navigations: string[];
  failures: Map<string, string>;
  held?: { stage: DedicatedStage; typeName?: string; promise: Promise<void>; resolve: () => void; reject: (error: Error) => void };
};
let dedicatedIO: DedicatedIO;
let dedicatedRegistry: ReturnType<typeof createRegistry> | undefined;
let dedicatedSession: AuthoringSession | undefined;
let setDedicatedDefinition: (value: any) => void;
async function dedicatedWait(stage: DedicatedStage, typeName?: string) {
  const held = dedicatedIO.held;
  if (held?.stage === stage && (!held.typeName || held.typeName === typeName)) await held.promise;
}
const dedicatedBaseClient = createPublicApiClient();
const api = { ...dedicatedBaseClient.api,
  definitionBundleSave: async (bundle: Parameters<typeof dedicatedBaseClient.api.definitionBundleSave>[0]) => {
    const request = dedicatedIO;
    request.bundles.push(cloneDraftValue(bundle));
    await dedicatedWait("definition");
    const mutation = bundle.ownerMutations[0];
    if (mutation?.kind !== "upsert") throw new Error("The dedicated Type fixture saves one owner definition.");
    const { snapshot } = planFieldPersistence({
      currentOwners: request.snapshot.owners, currentFields: request.snapshot.fields,
      currentFacets: request.snapshot.facets, ...bundle,
    });
    request.definition = cloneDraftValue(mutation.owner.definition);
    request.snapshot = cloneDraftValue(snapshot);
    return { snapshot };
  },
  dispatchInstanceCreate: async (body: any) => {
    dedicatedIO.metadataWrites.push(cloneDraftValue(body));
    return { dispatchInstance: { id: `written-${dedicatedIO.metadataWrites.length}` } };
  },
  dispatchInstanceUpdate: async (id: string, instance: any, valueEncoding?: string) => {
    dedicatedIO.metadataWrites.push(cloneDraftValue({ id, instance, valueEncoding }));
    return {};
  },
};
const getTypes = async () => ({ types: [] });
const getEntityInstances = async () => ({ instances: [] });
async function getFieldFacetInstances() {
  const request = dedicatedIO;
  request.facetReads++;
  const response = { dispatchInstances: cloneDraftValue(request.rows) };
  request.facetCompleted++;
  return response;
}
const dedicatedClient = { ...dedicatedBaseClient, api,
  getFieldAuthoringCatalog: async () => ({ fields: cloneDraftValue(dedicatedIO.identities), facetInterfaceNames: ["Labelable", "Describable"] }),
  getFieldAuthoringIdentity: async (id: string) => ({ field: cloneDraftValue(dedicatedIO.identities.find(field => field.fieldId === id) ?? null) }),
  getFieldResurrectionCatalog: async () => ({ fields: [] }), getFieldFacetInstances,
  apiFetch: async <T,>(path: string): Promise<T> => {
    const typeName = new URL(path, "https://fenel.test/").searchParams.get("typeName") ?? "";
    dedicatedIO.lookups.push(typeName);
    await dedicatedWait("representation", typeName);
    const failure = dedicatedIO.failures.get(typeName);
    if (failure) throw Error(failure);
    return { dispatchInstances: cloneDraftValue(dedicatedIO.rows) } as T;
  },
};
const revalidate = (key: unknown) => { dedicatedIO.revalidations.push(cloneDraftValue(key)); };
const useNavigate = () => (path: string) => { dedicatedIO.navigations.push(path); };
const accountFieldRegistry = () => dedicatedRegistry;
async function persistRepresentation(typeName: string, target: string, methods: Record<string, unknown>) {
  const request = dedicatedIO;
  request.representationCalls.push(cloneDraftValue({ typeName, target, methods }));
  await persistRepresentationOwner(typeName, target, methods, undefined, dedicatedClient, dedicatedRegistry);
  if (typeName === "Labelable") request.definition.label = cloneDraftValue(methods.label);
  if (typeName === "Describable") request.definition.description = cloneDraftValue(methods.description);
}
async function reloadDedicated() {
  const request = dedicatedIO;
  request.reloads++;
  await dedicatedWait("reload");
  setDedicatedDefinition(cloneDraftValue(request.definition));
}

const fixture = {
  mount(nextKind: "function" | "type", value: any, keep = false, registrySession?: AuthoringSession,
    catalogue: AuthoringCatalogFunctionEntry[] = []) {
    dispose?.(); resetFixtureWorker(); valueReaderOverride = undefined; realTypeSession = registrySession; kind = nextKind; row = cloneDraftValue(value); closed = 0;
    if (catalogue.length || catalogueFunctions.length) { catalogueFunctions = cloneDraftValue(catalogue); base = undefined; }
    if (!keep) writes = [];
    const host = document.getElementById("fixture")!; host.replaceChildren();
    const reference = realTypeSession ? locusCatalogReferenceValue({ id: row.id, kind: "type" }, realTypeLookups()) : { $ref: row.function?.id ?? row.id };
    const item = { id: "definition", caption: row.label ?? row.name, source: { kind: "expr", expr: { kind: "literal", value: reference } } };
    dispose = render(() => <Errored fallback={error => <pre data-fixture-error>{String(error())}</pre>}>
      <Loading fallback={<p>Preparing definition…</p>}><AuthoringSessionContext value={scope()}>
        <EditModalContent item={item} homeId="fixture" standalone="definition" savedExprById={new Map()}
          onClose={() => { closed++; dispose?.(); host.replaceChildren(); }} />
      </AuthoringSessionContext></Loading>
    </Errored>, host);
  },
  state: () => ({ ...controls.snapshot(), writes: cloneDraftValue(writes), closed,
    ...(realTypeSession ? { callableId: realTypeSession.registry.getFunction(row.id)?.id,
      routedKind: resolveLocusCatalogReference({ id: row.id }, realTypeLookups())?.kind,
      projectedCallableId: (resolveLocusCatalogReference({ id: row.id }, realTypeLookups())?.callable as FenelFunction | undefined)?.id,
      projectedParameters: cloneDraftValue((resolveLocusCatalogReference({ id: row.id }, realTypeLookups())?.callable as FenelFunction | undefined)?.params),
      projectedReturns: cloneDraftValue((resolveLocusCatalogReference({ id: row.id }, realTypeLookups())?.callable as FenelFunction | undefined)?.returns),
      reference: locusCatalogReferenceValue({ id: row.id, kind: "type" }, realTypeLookups()) } : {}) }),
  mountRealType(value: any) {
    realTypeSession = undefined;
    const registry = createRegistry([stdModule, { name: "savedTypeFixture", label: "Saved type fixture", entities: [{
      id: value.id, type: value.type, params: value.params, typeScheme: value.typeScheme,
    }] }], { publishCatalogEntities: false, fieldIdentity: { mode: "source-handles", defaultRealm: "repository-source",
      identityKinds: new Map([[value.id, "type"]]) } });
    fixture.mount("type", value, false, { ...baseSession(), registry, evaluateContext: registry.evaluateContext() });
  },
  mountValue(options: { reader?: ReaderRuntime; typeName?: string; valueType?: FenelType; expression?: ExprNode; typeStep?: boolean; evaluateOnRequest?: boolean } = {}) {
    dispose?.(); resetFixtureWorker(); valueReaderOverride = options.reader; realTypeSession = undefined; kind = "type"; row = undefined; closed = 0; writes = []; valuePlacements = []; kindSwitches = [];
    const host = document.getElementById("fixture")!; host.replaceChildren();
    const homeData = { add: useHomeReader().addToLocus };
    const ValueModal = () => <AuthoringSessionContext value={scope()}><HomeDataContext value={homeData}>
      <NewValueModal expressionMode={!options.typeStep} evaluateOnRequest={options.evaluateOnRequest}
        presetType={options.typeName} presetValueType={options.valueType}
        presetExpr={options.expression ?? (options.typeStep ? undefined : { kind: "literal", value: "accepted" })}
        onSwitchKind={(next: string) => { kindSwitches.push(next); }}
        onClose={() => { closed++; dispose?.(); host.replaceChildren(); }} />
    </HomeDataContext></AuthoringSessionContext>;
    dispose = render(() => <Errored fallback={error => <pre data-fixture-error>{String(error())}</pre>}>
      <Loading fallback={<p>Preparing data…</p>}>
        <Show when={valueReaderOverride} keyed fallback={<ValueModal />}>
          {runtime => <ReaderRuntimeContext value={runtime}><ApiClientContext value={runtime.client}>
            <FieldPresentationRegistryProvider registry={runtime.registry()}><ValueModal /></FieldPresentationRegistryProvider>
          </ApiClientContext></ReaderRuntimeContext>}
        </Show>
      </Loading>
    </Errored>, host);
  },
  // Shared retained Phone IO, actual Home/NodeEditor, no Preview or Save.
  mountPhoneValue(authored = false, restored?: { typeName?: string; valueType?: FenelType; draft: ExprNode }) {
    fixture.mountValue({ reader: phoneVisualReader(), evaluateOnRequest: true, typeStep: !restored,
      typeName: restored?.typeName, valueType: restored?.valueType,
      expression: restored?.draft ?? (authored ? { kind: "literal", value: "authored visual draft" } : undefined) });
  },
  mountPhoneExpression(initial?: ExprNode) {
    dispose?.(); resetFixtureWorker(); valueReaderOverride = undefined;
    const host = document.getElementById("fixture")!; host.replaceChildren();
    const runtime = phoneVisualReader();
    dispose = render(() => {
      const [node, setNode] = createSignal<ExprNode>(initial ?? { kind: "literal", value: undefined });
      readPhoneExpression = node;
      return <Errored fallback={error => <pre data-fixture-error>{String(error())}</pre>}>
        <ApiClientContext value={runtime.client}><AuthoringSessionContext value={phonePickerVisualSession}><ReaderRuntimeContext value={runtime}>
          <FieldPresentationRegistryProvider registry={phonePickerVisualSession.registry}>
            <PhoneVisualNodeEditor node={node()} onChange={setNode} typeName="Type" expectedType={{ $type: true }} viewMode="nested" />
          </FieldPresentationRegistryProvider>
        </ReaderRuntimeContext></AuthoringSessionContext></ApiClientContext>
      </Errored>;
    }, host);
  },
  phoneExpressionState: () => snapshot(readPhoneExpression()),
  phoneVisualObservation: () => ({ row: phonePickerVisualRow, reference: phonePickerVisualHandle,
    classification: "controlled visual IO; not Local owner, inference, membership or Save evidence" }),
  valueState: () => ({ ...valueControls.snapshot(), writes: cloneDraftValue(writes), placements: cloneDraftValue(valuePlacements), switches: [...kindSwitches], closed }),
  openValueTypePicker: () => valueControls.openTypePicker(),
  replaceValueDraft: (next: ExprNode) => valueControls.updateDraft(next),
  captureValueTypeTarget: () => valueControls.captureTypeTarget?.(),
  startValueSave: () => { valuePending = valueControls.save(); },
  async releaseValueSave() { fixture.release(); await valuePending; },
  mountDedicated(definition: any, identities: FieldAuthoringCatalogRow[], rows: InstanceApiRow[]) {
    dispose?.(); resetFixtureWorker(); valueReaderOverride = undefined; dedicatedIO?.held?.resolve(); realTypeSession = undefined;
    const name = definition.name ?? definition.id;
    const snapshot: FieldPersistenceSnapshot = {
      owners: [{ ownerKey: "type:" + name, kind: "type", storageName: name, storageId: "dedicated-storage-row",
        definition: cloneDraftValue(definition) }],
      fields: identities.map((field): FieldPersistenceSnapshot["fields"][number] => {
        if (field.realm === "local" || field.reuseVisibility === "local") {
          throw new Error("The dedicated Type fixture requires persisted field identities.");
        }
        return { id: field.fieldId, currentCodeName: field.codeName, status: "live", realm: field.realm,
          reuseVisibility: field.reuseVisibility };
      }),
      facets: rows.map((row): FieldPersistenceSnapshot["facets"][number] => {
        const draft = apiRowToDraft(row);
        const fieldId = draft.args[0];
        if (typeof fieldId !== "string") throw new Error("The dedicated Type fixture requires field facet targets.");
        return { rowId: row.id, fieldId, typeName: draft.typeName, methods: cloneDraftValue(draft.methods),
          scope: "account", priority: draft.priority ?? 100 };
      }),
    };
    dedicatedIO = { name: definition.name ?? definition.id, storageId: "dedicated-storage-row", definition: cloneDraftValue(definition),
      identities: cloneDraftValue(identities), rows: cloneDraftValue(rows), snapshot, bundles: [], representationCalls: [], metadataWrites: [], lookups: [],
      facetReads: 0, facetCompleted: 0, reloads: 0, revalidations: [], navigations: [], failures: new Map() };
    dedicatedRegistry = createRegistry([stdModule, { name: "dedicatedTypeFixture", label: "Dedicated Type fixture", entities: [{
      id: dedicatedIO.name, type: definition.type,
    }] }], { publishCatalogEntities: false, fieldIdentity: { mode: "source-handles", defaultRealm: "repository-source",
      identityKinds: new Map([[dedicatedIO.name, "type"], ...identities.map(field => [field.fieldId, "field"] as const)]),
      externalFields: identities.map(field => ({ id: field.fieldId, currentCodeName: field.codeName })) },
      fieldRepresentations: rows.map((row): Instance => {
        const draft = apiRowToDraft(row);
        // The reader's existing registration boundary uses the same legacy TypeExpr envelope.
        return { ...draft, args: draft.args as Instance["args"], scope: "account" };
      }) });
    dedicatedSession = { ...baseSession(), registry: dedicatedRegistry, evaluateContext: dedicatedRegistry.evaluateContext() };
    const host = document.getElementById("fixture")!; host.replaceChildren();
    dispose = render(() => {
      const [current, setCurrent] = createSignal(cloneDraftValue(definition));
      setDedicatedDefinition = setCurrent;
      return <Errored fallback={error => <pre data-fixture-error>{String(error())}</pre>}>
        <Loading fallback={<p>Preparing dedicated Type…</p>}><AuthoringSessionContext value={dedicatedSession!}>
          <ApiClientContext value={dedicatedClient}><FieldPresentationRegistryProvider registry={dedicatedRegistry!}>
            <UserDefinedTypeDetail name={dedicatedIO.name} id={dedicatedIO.storageId} data={{ definition: current() }} onReload={reloadDedicated} />
          </FieldPresentationRegistryProvider></ApiClientContext>
        </AuthoringSessionContext></Loading>
      </Errored>;
    }, host);
  },
  dedicatedState: () => ({ bundles: cloneDraftValue(dedicatedIO.bundles), representationCalls: cloneDraftValue(dedicatedIO.representationCalls),
    metadataWrites: cloneDraftValue(dedicatedIO.metadataWrites), lookups: [...dedicatedIO.lookups], facetReads: dedicatedIO.facetReads,
    facetCompleted: dedicatedIO.facetCompleted, reloads: dedicatedIO.reloads, revalidations: cloneDraftValue(dedicatedIO.revalidations),
    definition: cloneDraftValue(dedicatedIO.definition) }),
  holdDedicated(stage: DedicatedStage, typeName?: string) {
    let resolve!: () => void, reject!: (error: Error) => void;
    dedicatedIO.held = { stage, typeName, promise: new Promise<void>((yes, no) => { resolve = yes; reject = no; }), resolve, reject };
  },
  failDedicatedRepresentation: (typeName: string, message: string) => { dedicatedIO.failures.set(typeName, message); },
  releaseDedicated(error?: string) {
    const held = dedicatedIO.held; dedicatedIO.held = undefined;
    if (error) held?.reject(Error(error)); else held?.resolve();
  },
  body: (node: ExprNode) => { controls.body(node); flush(); },
  mode: (mode: "infer" | "explicit") => { controls.mode(mode); flush(); },
  result: (type: FenelType) => { controls.result(type); flush(); },
  shape: (type: FenelType) => { controls.shape(type); flush(); },
  parameters: (params: FieldDef[]) => { const ok = controls.parameters(params); flush(); return ok; },
  genericIssue: (issue?: string) => { controls.genericIssue(issue); flush(); },
  facets: (value: FieldFacetDraftMap) => { controls.facets(value); flush(); },
  retireSource: () => { sourceOrigin++; },
  replaceRow: (next: unknown) => { row = cloneDraftValue(next); setDefinitionRevision(value => value + 1); flush(); },
  save: () => controls.save(),
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
  async reopen() {
    const owner = writes.at(-1)?.ownerMutations?.[0]?.owner;
    if (!owner) throw Error("Nothing saved");
    fixture.mount(kind, kind === "function" ? { ...row, function: owner.definition } : { ...row, ...owner.definition });
  },
  hold() {
    let resolve!: () => void, reject!: (error: Error) => void;
    held = { promise: new Promise<void>((yes, no) => { resolve = yes; reject = no; }), resolve, reject };
  },
  release(error?: string) { const pending = held; held = undefined; if (error) pending?.reject(Error(error)); else pending?.resolve(); },
};
declare global { var savedDefinitionFixture: typeof fixture; }
globalThis.savedDefinitionFixture = fixture;
