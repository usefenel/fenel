import { For, Loading, Show, createEffect, createMemo, createSignal, lazy, onCleanup, onSettled, refresh, untrack } from "solid-js";
import { Portal, type JSX } from "@solidjs/web";
import { useNavigate } from "@solidjs/router";
import { apiReadConnectionStatus, defaultApiClient, type ApiClient, type ReaderMetadataProjection } from "./api";
import { ApiUnavailableError } from "./api-readiness";
import type { LocusRootData } from "./locus-root-data";
import type { ExprNode } from "@fenel/engine/authoring/expression";
import type { FenelType, FieldDef } from "@fenel/engine/types";
import { AccountDataSwitcher } from "./account-data-switcher";
import { accountSelectionPending } from "./auth";
import { LocusBrowse, type BrowseGroup, type BrowsePending } from "./locus-browse";
import { createCoreValueSuggestionClient, type CoreValueSuggestionClient } from "./home-search/core-value-suggestions-client";
import type { ValueSuggestion } from "./home-search/value-suggestions";
import { LocusBreadcrumb } from "./locus-breadcrumb";
import { ROOT_SCOPE, scopeAncestors, scopeKey, scopeLabel, valueAt, type LocusScope } from "./locus-scope";
import { createScopeMemo } from "./stable-scope";
import { firstSentence, publicSectionTarget } from "./public-section-presentation";
import { matchesUserQuery, userTypeRouteId } from "./data-items/user-items";
import type { DataItem } from "./data-search";
import { LocusQuickValue, quickValueShape, type QuickValueShape } from "./locus-quick-value";
import { addToLocus, type LayoutItem } from "./locus-view-model";
import { onBrowserSessionChange, sessionEpoch } from "./browser-session";
import { useWorkspaceReadiness, type WorkspaceReadiness } from "./workspace-readiness";
import { LocusNotifications, LocusLoadFailure, locusNoticeKey, type LocusNotice } from "./locus-notifications";
import { IconByName, IconList, IconPlus, IconSearch, IconX, LUCIDE_BY_NAME, TYPE_ICON_FALLBACKS } from "./icons";
import { NewItemPickerModal } from "./new-item-picker";
import { ModalOverlay } from "./confirm-modal";
import { armPublicDemoCopy, publicDemoCopyBranch, type HomeAction, type NewBranch } from "./home-action";
import { cloneDraftValue, draftValueFingerprint } from "./native-draft";
import { DataOccurrenceBoundary, type DataOccurrenceSource, type DataReadOccurrence } from "./data-occurrence";
import { queueWorkspaceTransfer, discardWorkspaceTransfers, hasWorkspaceTransfers, workspaceTransferOwner,
  peekWorkspaceTransfers, claimWorkspaceTransfer, acknowledgeWorkspaceTransfer, releaseWorkspaceTransfer,
  type WorkspaceTransferTicket } from "./data-transfer/queue";
import { isDataTransfer, isNativeEditingTarget } from "./data-transfer/events";
import { captureDataTransfer } from "./data-transfer";
import { readClipboardTransfer } from "./data-transfer/clipboard";
import { LocusContextMenu, type LocusMenuItem } from "./locus-context-menu";
import { locusNewMenu, locusOpenMenuItems, locusContextPosition, ownsLocusContextMenu } from "./locus-menu-actions";
import { createLocusTapMenu } from "./locus-menu-gesture";
import type { LocusLayoutChoice } from "./locus-layout-options";
import { DataPreview, DataThumbnail, hasDataPreview, TransferFeedback } from "./data-transfer/DataPreview";
import { readLocusCatalogReference, resolveLocusCatalogReference } from "./locus-catalog-reference";
import { codeName, displayNameText, humanName, pickDisplayName, type DisplayNameInput } from "./display-name";
import { savedExpressionFromQuery } from "./saved-expression-map";
import { constantData } from "./locus-expression-edit";
import { CardLoadingIndicator, CollectionPreviewStrip, DataUnavailable, ValueCard, ValueCardCaption, valueCardLabel } from "./value-card";
import { cardTypeSource, type CardRead } from "./card-type-source";
import { plainReaderPrintsConstructorTag } from "./early-structure";
import type { WorkspacePane } from "./workspace-pane";
import type { ReaderRuntime } from "./reader-runtime";
import { Nothing } from "@fenel/engine/maybe-value";
import { encodeCheckpointValue } from "@fenel/engine/checkpoint-json";
import { readWorkspaceDataTarget, scopeFromWorkspace, scopeToWorkspace, workspaceSourceKey, type WorkspaceSource } from "./workspace-wire";
import { LensPending, LensSpinner, sharedStartupWait } from "./loading-screen";
import { useWorkspaceRootShelf } from "./workspace-root-shelf";
import { isInlineImageValue } from "./expression-runner/image-canvas-data";
import { useWorkspaceLoad } from "./workspace-load";
import { DesktopDataPreview } from "./desktop-data";
import { QUICK_TYPE_CATEGORIES, QUICK_TYPE_SUBTYPES } from "./new-value-types";
import { DataInspectionControls, DataInspectionPanels, DataInspectionSuggestionsPanel, dataInspectionPanelVisible, type DataInspectionMode } from "./DataInspectionDialog";
import { TypeDataPreviewBody } from "./type-data-preview";
import { presentedTypeTarget, typeIconForPresentation } from "./type-icon-presentation";
import { accountDataIcon } from "./account-data-selector";
import { LensDataSummary, LensEditInLocalAction } from "./lens-data-summary";
import { editInLocalShown } from "./edit-in-local";
import { readPublicInitialValue, readPublicInitialGraphValue } from "./public-bootstrap";
import type { ContainedValuePreview } from "./data-transfer/DataValueSurface";
import { ExpressionEditor, type ExpressionGraphValue, type HeldExpressionPresentation, type HeldFunctionChoice } from "./expression-runner/ExpressionEditor";
import { detectStructuralForm } from "./expression-runner/expression-structure";
import { ExpressionGraphCollectionItemControl } from "./expression-runner/expression-surfaces";
import "./home-entry.css";

/** Which control armed a pending intent. `"transfer"` is a paste or drop: it
 *  has no button of its own, so it reports through the notification bell
 *  instead of borrowing a control that did not start it. */
type PendingSource = "new" | "browse" | "transfer" | "source";
type BrowseSavedRow = { id: string; name: string; description: string | null };
export { LocusNotifications, type LocusNotice } from "./locus-notifications";
type RequestedAction = HomeAction | undefined;
const HomeWorkspace = lazy(async () => {
  const [home, authoring] = await Promise.all([import("../routes/app/home"), import("./workspace-authoring-provider")]);
  const Content = home.default;
  const Provider = authoring.default;
  return { default: (props: { initialAction?: RequestedAction }) => <Provider><Content {...props} /></Provider> };
});
const EarlyReadValue = lazy(() => import("./early-read-value"));
// Mount the early reader only once its module has arrived. A lazy component
// mounted earlier parks a pending load in the current transition; when the
// early card is replaced before the load lands (the workspace takes over),
// that disposed load stays pending there, the transition never completes,
// and later writes entangled with it never commit: a type created afterwards
// never appeared and its save's notice stayed. Loaded, the component mounts
// synchronously and parks nothing.
const [earlyReadValueLoaded, setEarlyReadValueLoaded] = createSignal(false);
let earlyReadValueLoad: Promise<void> | undefined;
function requestEarlyReadValue(): void {
  earlyReadValueLoad ??= EarlyReadValue.preload().then(() => { setEarlyReadValueLoaded(true); },
    () => { earlyReadValueLoad = undefined; });
}
// The prepared app's function card plot (function-graph.tsx, as routes/app/home.tsx
// mounts it): loaded with the reader, so every function card the shell draws gets
// the same sampled curve under the same rule (one parameter, the worker judging
// the range). Until it answers, or when it draws nothing, the card stays as it is.
const ReaderFunctionGraph = lazy(async () => {
  const [graph, reader] = await Promise.all([import("./function-graph"), import("./reader-runtime")]);
  const FunctionGraph = graph.FunctionGraph;
  const ReaderContext = reader.ReaderRuntimeContext;
  return { default: (props: { runtime: ReaderRuntime; pinId: string; arrow: { params: readonly FieldDef[]; returns: FenelType } }) =>
    <ReaderContext value={props.runtime}><FunctionGraph pinId={props.pinId} arrow={props.arrow}
      session={() => props.runtime.session()} /></ReaderContext> };
});
const HeldGraphReadValue = lazy(async () => {
  const [read, reader] = await Promise.all([import("./layout-renderer/TypedReadValue"), import("./reader-runtime")]);
  const TypedReadValue = read.TypedReadValue;
  const ReaderContext = reader.ReaderRuntimeContext;
  // A held result already has its data. Supply its existing reader only;
  // this display does not create authoring tools or request an evaluation.
  return { default: (props: { runtime: ReaderRuntime; data: ExpressionGraphValue; compact?: boolean; detail?: boolean;
    describeType: (type: FenelType) => { label?: string; detailLabel?: string; icon?: string };
    onOpenData?: (child: ContainedValuePreview) => void; occurrence?: DataReadOccurrence;
    onDataContext?: (event: MouseEvent, child: ContainedValuePreview) => void }) =>
    <ReaderContext value={props.runtime}><TypedReadValue value={props.data.value} type={props.data.type}
      valueIcon={props.data.valueIcon} compact={props.compact} detail={props.detail} onOpenData={props.onOpenData}
      occurrence={props.occurrence?.source} dataPath={props.occurrence?.path} onDataContext={props.onDataContext} /></ReaderContext> };
});

// Checked data renders before authoring. Local tools prepare on interaction;
// typed tools still mount only against a complete reader registry.
export default function HomeEntry(props: {
  client?: ApiClient;
  pane?: WorkspacePane;
  readiness?: WorkspaceReadiness;
  renderWorkspace?: (initialAction?: HomeAction) => JSX.Element;
  /** Acquire the existing lazy editor code while its checked reader prepares.
   * Loading code neither mounts the editor nor grants it a reader. */
  prepareWorkspace?: () => Promise<unknown>;
  /** Checked repository read projection. Public roots never read account HTTP
   * or acquire editing tools until an explicit interaction needs them. */
  publicRoot?: LocusRootData;
  /** Fenel-derived, reader-visible locations above the individual roots. */
  navigationRoot?: LocusRootData;
  /** The checked read session can compute cards before optional editor UI. */
  readRuntime?: ReaderRuntime;
} = {}) {
  const client: ApiClient = untrack(() => props.client) ?? defaultApiClient;
  const transferOwner = untrack(() => props.publicRoot || props.navigationRoot ? undefined
    : workspaceTransferOwner(client.accountId, props.pane?.id, client.epoch ?? sessionEpoch(), client.rootId));
  onCleanup(() => { if (!props.publicRoot && !props.navigationRoot) discardWorkspaceTransfers(transferOwner); });
  const { getLocusRoot, getSavedQueries, getBrowseTypes, getBrowseFunctions, revalidate } = client;
  const readProjection = () => props.navigationRoot ?? props.publicRoot;
  const prepareOnDemand = () => props.pane?.source().$tag === "ThisTabSource";
  const workspace = untrack(() => props.readiness) ?? useWorkspaceReadiness();
  const workspaceLoad = useWorkspaceLoad();
  const rootData = createMemo(() => {
    const epoch = sessionEpoch();
    return (readProjection() ? Promise.resolve({ root: readProjection() }) : getLocusRoot()).then(
      (data) => ({ epoch, root: data?.root, failed: !data?.root || !Array.isArray(data.root.items), unavailable: undefined }),
      // A passed readiness deadline explains itself (what failed, what to do).
      (error) => ({ epoch, root: undefined, failed: true,
        unavailable: error instanceof ApiUnavailableError || props.pane && error instanceof Error ? error.message : undefined }),
    );
  }, { loadingValue: { epoch: -1, root: undefined as LocusRootData | undefined, failed: false, unavailable: undefined as string | undefined } });
  const currentReads = createMemo(() => rootData().epoch === sessionEpoch());
  const current = createMemo(() => currentReads() && !rootData().failed ? rootData().root : undefined);
  const typeDescriptionIndex = createMemo(() => {
    const descriptions = new Map<string, NonNullable<LocusRootData["typeDescriptions"]>[number]>();
    for (const description of current()?.typeDescriptions ?? []) {
      const key = JSON.stringify(encodeCheckpointValue(description.type));
      if (!descriptions.has(key)) descriptions.set(key, description);
    }
    return descriptions;
  }, { lazy: true });
  const failed = createMemo(() => currentReads() && rootData().failed);
  const paneSourceKey = () => {
    const source = props.pane?.source();
    return source ? workspaceSourceKey(source) : "public";
  };
  const [focusIntent, setFocusIntent] = createSignal<{
    epoch: number; source: string; origin: LocusScope; target: LocusScope;
  }>();
  // Kept by value: a publication (a resize) re-reads the same focus as a new
  // object, which must not remount the focused card (stable-scope.ts).
  const displayFocus = createScopeMemo(() => {
    const focus = props.pane?.focus() ?? ROOT_SCOPE;
    const pending = focusIntent();
    return pending?.epoch === sessionEpoch() && pending.source === paneSourceKey() && sameFocus(focus, pending.origin)
      ? pending.target : focus;
  });
  createEffect(() => ({ pending: focusIntent(), focus: props.pane?.focus() ?? ROOT_SCOPE,
    epoch: sessionEpoch(), source: paneSourceKey(), error: workspace.error() }), state => {
    const pending = state.pending;
    if (pending && (pending.epoch !== state.epoch || pending.source !== state.source || state.error
      || sameFocus(state.focus, pending.target) || !sameFocus(state.focus, pending.origin))) setFocusIntent(undefined);
  });
  const [localInspectionMode, setLocalInspectionMode] = createSignal<DataInspectionMode>("data");
  const inspectionMode = () => props.pane?.inspectionMode?.() ?? localInspectionMode();
  function setInspectionMode(mode: DataInspectionMode) {
    if (props.pane?.onInspectionMode) props.pane.onInspectionMode(mode);
    else setLocalInspectionMode(mode);
  }
  // These are checked source nodes from the current reader, not evaluated
  // data. Keep the root occurrence while following its authored field path.
  function previewForScope(focus: LocusScope) {
    const data = current();
    if (!data || focus?.kind !== "value") return undefined;
    const items = focus.rootItem ? data.items : data.lists.find(row => row.id === focus.viewId)?.view.items;
    const original = items?.find(item => item.id === focus.itemId);
    if (!original) return undefined;
    let expr = previewExpression(original);
    let type = original.valueType;
    let caption = original.caption;
    let fieldId: string | undefined;
    for (const step of focus.path) {
      if (expr?.kind !== "literal" || !expr.value || typeof expr.value !== "object" || typeof step !== "string") return undefined;
      const fields = (expr.value as { __record?: { fields?: Array<{ name: string; value: ExprNode }> } }).__record?.fields;
      const field = fields?.find(field => field.name === step);
      if (!field) return undefined;
      expr = field.value;
      const declared = type && "$record" in type ? type.$record.fields.find(field => field.name === step) : undefined;
      fieldId = declared?.key?.$tag === "NamedField" ? declared.key.ref.$ref : undefined;
      type = declared?.type;
      caption = step;
    }
    return expr ? { original, focus, fieldId, item: { ...original, caption,
      representations: focus.path.length > 0 ? undefined : original.representations,
      source: { kind: "expr" as const, expr }, valueType: type } } : undefined;
  }
  const focusedPreview = createMemo(() => previewForScope(displayFocus()));
  const focusedFields = createMemo(() => {
    const focused = focusedPreview();
    const fields = focused && recordPreview(focused.item);
    return fields?.map(member => ({
      item: { id: `$field:${member.name}`, caption: member.name,
        source: { kind: "expr" as const, expr: member.value }, valueType: previewFieldType(focused!.item, member.name) },
      scope: { ...focused!.focus, path: [...focused!.focus.path, member.name] } as LocusScope,
    }));
  });
  /** A public page that a fresh visit paints from the snapshot alone: the Fenel
   * root, a record of sections (`/demo`, `/std`), a record such as a person.
   * Only a collection or function page, or an explicit collection layout
   * (`requestPresentationBody`), acquires the prepared Home body. Read lazily:
   * `focusedPublicCollection` is declared below. */
  function publicSnapshotPage(): boolean {
    const layout = props.pane?.presentation();
    return !!props.publicRoot && !!props.pane && !!current() && !focusedPublicCollection()
      && (layout === undefined || layout === "value" || layout === "desktop");
  }
  const inspectionProducer = () => {
    const selectedType = earlyTypeData();
    if (selectedType) return { node: { kind: "literal" as const, value: selectedType }, resultPath: [] };
    const focus = displayFocus();
    if (focus.kind === "root") {
      const node = current()?.expr;
      return node ? { node, resultPath: [] } : undefined;
    }
    if (focus.kind === "value") {
      const selected = focusedPreview();
      if (selected) {
        const node = previewExpression(selected.item);
        return node ? { node, resultPath: [] } : undefined;
      }
      const data = current();
      const items = focus.rootItem ? data?.items : data?.lists.find(row => row.id === focus.viewId)?.view.items;
      const item = items?.find(candidate => candidate.id === focus.itemId);
      let producer = item && previewExpression(item);
      let depth = 0;
      for (const step of focus.path) {
        if (producer?.kind !== "literal" || !producer.value || typeof producer.value !== "object") break;
        const held = producer.value as { __list?: ExprNode[]; __record?: { fields?: Array<{ name: string; value: ExprNode }> } };
        const child = typeof step === "number" ? held.__list?.[step]
          : held.__record?.fields?.find(field => field.name === step)?.value;
        if (!child) break;
        producer = child;
        depth++;
      }
      return producer ? { node: producer, resultPath: focus.path.slice(depth) } : undefined;
    }
    const row = current()?.lists.find(candidate => candidate.id === focus.viewId);
    const node = row && current()?.expressions[row.referenceId];
    return node ? { node, resultPath: [] } : undefined;
  };
  const [literalEditing, setLiteralEditing] = createSignal<{ node: ExprNode; root: LocusRootData }>();
  // Literal source data is already held by this checked reader. Keep its
  // shared inspection surface until Edit; structural editors retain their
  // existing complete preparation path.
  const heldLiteralInspection = createMemo(() => {
    const producer = inspectionProducer();
    const root = current();
    const editing = literalEditing();
    return !!root && !earlyTypeData() && producer?.node.kind === "literal" && producer.resultPath.length === 0
      && !detectStructuralForm(producer.node.value, () => true)
      && !(editing?.node === producer.node && editing.root === root)
      && dataInspectionPanelVisible(inspectionMode(), "expression")
      && !dataInspectionPanelVisible(inspectionMode(), "code")
      && !dataInspectionPanelVisible(inspectionMode(), "suggestions")
      && !dataInspectionPanelVisible(inspectionMode(), "dependencies");
  }, { lazy: true });
  function editHeldLiteral() {
    const producer = inspectionProducer();
    const root = current();
    if (!producer || !root) return;
    setLiteralEditing({ node: producer.node, root });
    const selected = focusedPreview();
    retarget(selected ? { kind: "inspect-data", item: selected.original, scope: displayFocus(), mode: inspectionMode() } : undefined, "source");
  }
  // These are the server's already-authorized occurrence projections. Only
  // literal values with an existing preview can render before the evaluator;
  // computed values keep their captions until the canonical renderer is ready.
  const previewItems = createMemo<LayoutItem[]>(() => {
    if (!props.pane) return [];
    const data = current();
    const focus = displayFocus();
    if (!data) return [];
    if (focus.kind === "root") return data.items;
    if (focus.kind === "view") {
      const view = data.lists.find(row => row.id === focus.viewId)?.view;
      return view && Array.isArray(view.items) ? view.items as LayoutItem[] : [];
    }
    const fields = focusedFields();
    if (fields) return fields.map(field => field.item);
    const focused = focusedPreview();
    return focused ? [focused.item] : [];
  });
  // The root transport explicitly identifies these occurrence ids as lists.
  // Their count is already authorized data; no expression or type evaluator
  // is needed to show it while the complete renderer prepares.
  const previewLists = createMemo(() => displayFocus().kind === "root" ? current()?.lists ?? [] : []);
  function previewExpression(item: LayoutItem) {
    return item.source?.kind === "expr" ? item.source.expr
      : item.source?.kind === "ref" ? current()?.expressions[item.source.ref.id] : item.expr;
  }
  function previewable(item: LayoutItem): boolean {
    const expr = previewExpression(item);
    if (expr?.kind !== "literal") return false;
    return previewableValue(expr.value);
  }
  /** The same catalogue identity used by Home's itemFunction. Display names
   * and arrow-shaped preview metadata cannot authorize a call. */
  function callablePreviewReference(item: LayoutItem): string | undefined {
    const runtime = props.readRuntime;
    if (!runtime || runtime.epoch !== sessionEpoch() || runtime.client.signal.aborted) return undefined;
    const expression = previewExpression(item);
    const reference = expression?.kind === "literal" ? readLocusCatalogReference(expression.value) : undefined;
    if (!reference || reference.kind !== undefined && reference.kind !== "function") return undefined;
    const target = resolveLocusCatalogReference({ ...reference, kind: "function" }, runtime.catalogLookups);
    return target?.callable !== undefined || target?.kind === "function" ? reference.id : undefined;
  }
  function previewableValue(value: unknown): boolean {
    return typeof value === "string" || typeof value === "number"
      || typeof value === "boolean" || hasDataPreview(value);
  }
  const [pipelinePreviews, setPipelinePreviews] = createSignal<ReadonlyMap<string, unknown>>(new Map());
  const previewSaved = createMemo(() => {
    const epoch = sessionEpoch();
    return (readProjection() ? Promise.resolve({ queries: [] }) : getSavedQueries()).then(
      (data) => ({ epoch, queries: ((data as { queries?: Array<{ id?: string; query?: unknown }> })?.queries ?? []) }),
      () => ({ epoch, queries: [] as Array<{ id?: string; query?: unknown }> }),
    );
  });
  createEffect(() => {
    const savedRead = previewSaved() as { epoch: number; queries: Array<{ id?: string; query?: unknown }> };
    return {
      publicPreview: !!readProjection(),
      items: previewItems(),
      lists: previewLists(),
      expressions: current()?.expressions ?? {},
      queries: savedRead?.epoch === sessionEpoch() ? savedRead.queries : [],
    };
  }, ({ publicPreview, items, lists, expressions, queries }) => {
    if (publicPreview) return;
    let cancelled = false;
    void import("./image-pipeline-preview").then(({ evaluateImagePipeline }) => {
      if (cancelled) return;
      const saved = new Map(Object.entries(expressions));
      for (const query of queries) {
        const expr = savedExpressionFromQuery(query.query);
        if (expr && query.id) saved.set(query.id, expr);
      }
      const next = new Map<string, unknown>();
      const paint = (item: LayoutItem) => {
        const expr = previewExpression(item)
          ?? (item.source?.kind === "ref" ? { kind: "ref" as const, savedExprId: item.source.ref.id } : undefined);
        if (!expr) return;
        const image = evaluateImagePipeline(expr, saved);
        if (image && typeof image === "object" && "pixels" in image) next.set(item.id, image);
      };
      for (const item of items) paint(item);
      for (const row of lists) for (const child of row.view.items ?? []) paint(child);
      setPipelinePreviews(next);
    });
    return () => { cancelled = true; };
  });
  function shellPreview(item: LayoutItem): unknown | undefined {
    const initial = props.publicRoot && readPublicInitialValue(props.publicRoot, previewExpression(item));
    if (initial) return initial.value;
    const painted = pipelinePreviews().get(item.id);
    if (painted !== undefined) return painted;
    const expr = previewExpression(item);
    if (expr?.kind !== "literal") return undefined;
    // Reuse the authored-container codec: constant structural lists are
    // present data, while calls/references inside them still need the reader.
    try {
      const value = constantData(expr);
      return previewableValue(value) || Array.isArray(value) ? value : undefined;
    } catch { return undefined; }
  }
  createEffect(() => (!!props.publicRoot || prepareOnDemand()) && !props.readRuntime && !workspace.error()
    && previewItems().some(item => !recordPreview(item) && !previewLists().some(row => row.id === item.id)
      && shellPreview(item) === undefined && !!previewExpression(item)), needsReader => {
    if (needsReader) workspace.request();
  });
  function previewScope(item: LayoutItem): LocusScope | undefined {
    const focus = props.pane ? displayFocus() : undefined;
    const root = current();
    if (!focus || !root) return undefined;
    if (focus.kind === "root") return previewLists().some(row => row.id === item.id)
      ? { kind: "view", viewId: item.id }
      : { kind: "value", viewId: root.id, itemId: item.id, path: [], rootItem: true };
    if (focus.kind === "view") return { kind: "value", viewId: focus.viewId, itemId: item.id, path: [] };
    return focusedFields()?.find(field => field.item.id === item.id)?.scope ?? focus;
  }
  function dataTarget(item: LayoutItem) {
    const expression = previewExpression(item);
    return props.navigationRoot && expression?.kind === "literal" ? readWorkspaceDataTarget(expression.value) : undefined;
  }
  // Values the card bodies read live (EarlyReadValue), for their captions: a
  // card mounts before its value arrives, and a type the checker left
  // undecided is named by that value once it is read (card-type-source.ts).
  const [cardReads, setCardReads] = createSignal<ReadonlyMap<string, CardRead & { node?: ExprNode }>>(new Map());
  function noteCardRead(item: LayoutItem, read: CardRead) {
    const node = previewExpression(item);
    const prior = untrack(cardReads).get(item.id);
    if (prior && prior.node === node && prior.value === read.value && prior.kind === read.kind) return;
    setCardReads(reads => new Map(reads).set(item.id, { ...read, node }));
  }
  function cardRead(item: LayoutItem): CardRead | undefined {
    const read = cardReads().get(item.id);
    return read && read.node === previewExpression(item) ? read : undefined;
  }
  function previewKind(item: LayoutItem, listed: boolean): { label?: string; icon?: string } {
    const source = cardTypeSource(item.valueType, shellPreview(item), cardRead(item));
    if (source.use === "declared") {
      const description = previewTypeDescription(source.type);
      if (description.label) return description;
    } else if (source.use === "kind") {
      const description = previewTypeDescription({ $ref: source.kind });
      if (description.label && description.label !== "Anything") return description;
    }
    if (listed) return { label: "List", icon: "list" };
    if (item.valueType && "$type" in item.valueType) return { label: "Type", icon: TYPE_ICON_FALLBACKS.Type };
    if (recordPreview(item)) return { label: "Record", icon: TYPE_ICON_FALLBACKS.Record };
    const value = source.use === "value" ? source.value : shellPreview(item) ?? cardRead(item)?.value;
    if (isInlineImageValue(value) || (!!value && typeof value === "object" && "width" in value && "height" in value && "pixels" in value)) {
      return { label: "Image", icon: "image" };
    }
    if (typeof value === "string") return { label: "String", icon: "type" };
    if (typeof value === "number") return { label: "Number", icon: "hash" };
    if (typeof value === "boolean") return { label: "Boolean", icon: "toggle-left" };
    if (Array.isArray(value)) return { label: "List", icon: "list" };
    return { label: value === undefined ? undefined : "Data", icon: value === undefined ? undefined : TYPE_ICON_FALLBACKS.Data };
  }
  /** Structural record facts are already part of the checked read projection.
   * Preview field names without evaluating any field expression or definition. */
  function recordPreview(item: LayoutItem): Array<{ name: string; value: ExprNode }> | undefined {
    const expr = previewExpression(item);
    const initial = props.publicRoot && readPublicInitialValue(props.publicRoot, expr);
    if (initial && item.valueType && projectedTypeDescription(item.valueType)?.kind === "record"
      && initial.value && typeof initial.value === "object" && !Array.isArray(initial.value)
      && !hasDataPreview(initial.value)) return Object.entries(initial.value).filter(([name]) => !name.startsWith("$"))
        .map(([name, value]) => ({ name, value: { kind: "literal", value } }));
    if (expr?.kind !== "literal" || !expr.value || typeof expr.value !== "object") return undefined;
    const fields = (expr.value as { __record?: { fields?: Array<{ name: string; value: ExprNode }> } }).__record?.fields;
    return Array.isArray(fields) ? fields : undefined;
  }
  /** A section: an authored record whose every field is something to open (a
   * function or type reference, a nested section or list, or data read by a
   * call), never a plain value. Its card shows no rows (by shape, not name). */
  function isSectionRecord(item: LayoutItem): boolean {
    const expr = previewExpression(item);
    if (expr?.kind !== "literal" || !expr.value || typeof expr.value !== "object") return false;
    const fields = (expr.value as { __record?: { fields?: Array<{ name: string; value: ExprNode }> } }).__record?.fields;
    return Array.isArray(fields) && fields.length > 0 && fields.every(({ value }) => value.kind === "call" || value.kind === "ref"
      || value.kind === "literal" && !!value.value && typeof value.value === "object"
        && ("$ref" in value.value || "__record" in value.value || "__list" in value.value));
  }
  // A public section's own description and mark, carried by the root's
  // presentation table under the section's address (public-locus-data.ts).
  const sectionPresentations = createMemo(() => new Map((current()?.previewMetadata?.entries ?? [])
    .filter(entry => entry.target.startsWith("section:") && entry.ownPresentation)
    .map(entry => [entry.target, entry.ownPresentation!] as const)));
  function sectionPresentation(scope: LocusScope | undefined) {
    return scope?.kind === "value" && scope.rootItem ? sectionPresentations().get(publicSectionTarget(scope.itemId, scope.path)) : undefined;
  }
  /** The focused section asks for its members as even tiles (its own data,
   * `layout` in public-locus-data.ts): each tile shows the value and its name. */
  const memberTiles = () => displayFocus().kind === "value" && !!focusedFields()
    && sectionPresentation(displayFocus())?.layout === "tiles";
  /** The text shown under a value's name: the first sentence of its own
   * description (its Describable instance, its section's entry, or the own
   * presentation of the definition it references). */
  function shownDescription(value: unknown, representations: LayoutItem["representations"], scope: LocusScope | undefined): string | undefined {
    const text = valueCardLabel(representations?.Describable?.description) ?? valueCardLabel(sectionPresentation(scope)?.description)
      ?? valueCardLabel(projectedOwnPresentation(readLocusCatalogReference(value)?.id)?.description);
    return text?.trim() ? firstSentence(text) : undefined;
  }
  // Direct identities and declared field types are transport facts, not an
  // alternate type inference path. Unknown owners remain generic until ready.
  function previewTypeTarget(type: FenelType | undefined): string | undefined {
    return presentedTypeTarget(type);
  }
  function previewFieldType(item: LayoutItem, name: string): FenelType | undefined {
    return item.valueType && "$record" in item.valueType ? item.valueType.$record.fields.find(field => field.name === name)?.type : undefined;
  }
  function thumbnailValue(item: LayoutItem): unknown {
    const expr = previewExpression(item);
    return shellPreview(item) ?? (expr?.kind === "literal" ? expr.value : undefined);
  }
  const [graphActive, setGraphActive] = createSignal(false);
  const [graphSelection, setGraphSelection] = createSignal<{ node?: ExprNode; allowed: boolean }>();
  const heldCallableDeclarations = createMemo(() => {
    const declarations = new Map<string, { name: string; params?: import("@fenel/engine/types").FieldDef[]; returns?: FenelType; kind: "function" | "type" }>();
    for (const item of current()?.items ?? []) {
      const node = previewExpression(item);
      const type = item.valueType;
      if (node?.kind !== "literal" || !node.value || typeof node.value !== "object" || !type || !("$record" in type)) continue;
      const fields = (node.value as { __record?: { fields?: Array<{ name: string; value: ExprNode }> } }).__record?.fields ?? [];
      for (const field of fields) {
        const value = field.value.kind === "literal" ? field.value.value : undefined;
        const signature = type.$record.fields.find(declared => declared.name === field.name)?.type;
        if (value && typeof value === "object" && "$ref" in value && typeof value.$ref === "string" && signature) {
          if ("$arrow" in signature) declarations.set(value.$ref, { name: field.name, params: signature.$arrow.params, returns: signature.$arrow.returns, kind: "function" });
          else if ("$type" in signature) declarations.set(value.$ref, { name: field.name, kind: "type" });
        }
      }
    }
    return declarations;
  });
  const [heldThumbnailTargets, setHeldThumbnailTargets] = createSignal<{
    root?: LocusRootData; epoch: number; targets: readonly string[];
  }>({ epoch: -1, targets: [] });
  let heldThumbnailDemand: { root: LocusRootData; epoch: number; targets: Set<string>; queued: boolean } | undefined;
  function requestHeldThumbnailTarget(target: string) {
    const root = current();
    const epoch = sessionEpoch();
    if (!root || client.signal.aborted) return;
    if (heldThumbnailDemand?.root !== root || heldThumbnailDemand.epoch !== epoch)
      heldThumbnailDemand = { root, epoch, targets: new Set(), queued: false };
    const demand = heldThumbnailDemand;
    if (demand.targets.has(target)) return;
    demand.targets.add(target);
    if (demand.queued) return;
    demand.queued = true;
    // The canonical renderer reports each identity it displays. Publish its
    // optional metadata demand outside the owned read; do not walk expressions
    // again or prepare semantic tools to obtain browser chrome.
    queueMicrotask(() => {
      demand.queued = false;
      if (heldThumbnailDemand !== demand || current() !== root || sessionEpoch() !== epoch || client.signal.aborted) return;
      setHeldThumbnailTargets({ root, epoch, targets: [...demand.targets] });
    });
  }
  const thumbnailTargets = createMemo(() => {
    const targets = new Set<string>();
    const held = heldThumbnailTargets();
    if (held.root === current() && held.epoch === sessionEpoch())
      for (const target of held.targets) targets.add(target);
    const add = (value: unknown, type?: FenelType) => {
      const valueId = readLocusCatalogReference(value)?.id;
      const typeId = previewTypeTarget(type);
      if (valueId) targets.add(valueId);
      if (typeId) targets.add(typeId);
      if (type && "$arrow" in type) for (const parameter of type.$arrow.params) {
        if (parameter.key?.$tag === "NamedField") targets.add(parameter.key.ref.$ref);
        const parameterTypeId = previewTypeTarget(parameter.type);
        if (parameterTypeId) targets.add(parameterTypeId);
      }
      if (type && "$record" in type) for (const field of type.$record.fields) {
        if (field.key?.$tag === "NamedField") targets.add(field.key.ref.$ref);
        add(undefined, field.type);
      }
      const returnTypeId = type && "$arrow" in type ? previewTypeTarget(type.$arrow.returns) : undefined;
      if (returnTypeId) targets.add(returnTypeId);
    };
    for (const item of previewItems()) {
      const expr = previewExpression(item);
      add(expr?.kind === "literal" ? expr.value : undefined, item.valueType);
      for (const member of recordPreview(item) ?? []) {
        add(member.value.kind === "literal" ? member.value.value : undefined, previewFieldType(item, member.name));
      }
    }
    for (const row of previewLists()) for (const item of row.view.items) {
      const expr = previewExpression(item);
      add(expr?.kind === "literal" ? expr.value : undefined, item.valueType);
    }
    for (const scope of [...scopeAncestors(displayFocus()), displayFocus()]) {
      if (scope.kind === "root") add(undefined, current()?.type);
      else if (scope.kind === "view") add(undefined, current()?.lists.find(row => row.id === scope.viewId)?.valueType);
      else {
        const projected = previewForScope(scope);
        if (projected?.fieldId) targets.add(projected.fieldId);
        if (projected) add(thumbnailValue(projected.item), projected.item.valueType);
      }
    }
    // Request only the selected call's declared parameter identities. Curried
    // returns are part of that same inert contract, not another naming rule or
    // an invitation to project every callable's fields in All data.
    const selected = graphActive() ? graphSelection()?.node ?? inspectionProducer()?.node : undefined;
    if (selected?.kind === "call") {
      targets.add(selected.fnId);
      const target = current()?.previewMetadata?.entries.find(entry => entry.target === selected.fnId)?.canonicalTarget ?? selected.fnId;
      const runtime = props.readRuntime;
      // B4 wave 4 lane S: a Local reader's declaration is its worker's
      // reference answer (no page registry); unanswered, the held one.
      const live = runtime && runtime.epoch === sessionEpoch() && !runtime.client.signal.aborted && workspace.ready();
      const declared = live && runtime.kind === "local"
        ? runtime.catalogLookups.fn(selected.fnId) as { params?: import("@fenel/engine/types").FieldDef[]; returns?: FenelType } | undefined
          ?? heldCallableDeclarations().get(target)
        : live ? runtime.registry().getFunction(selected.fnId) : heldCallableDeclarations().get(target);
      let arrow = declared?.params && declared.returns ? { params: declared.params, returns: declared.returns } : undefined;
      while (arrow) {
        for (const parameter of arrow.params) {
          if (parameter.key?.$tag === "NamedField") targets.add(parameter.key.ref.$ref);
          add(undefined, parameter.type);
        }
        add(undefined, arrow.returns);
        arrow = "$arrow" in arrow.returns ? arrow.returns.$arrow : undefined;
      }
    }
    return [...targets];
  });
  const [thumbnailMetadata, setThumbnailMetadata] = createSignal<{ root?: LocusRootData; epoch: number; entries: ReaderMetadataProjection["entries"] }>({ epoch: -1, entries: [] });
  // Metadata is optional browser chrome. Keep its request outside the async
  // graph so known images and generic circles remain visible while it loads.
  createEffect(() => ({ root: current(), epoch: sessionEpoch(), targets: thumbnailTargets(),
    projected: !!readProjection() || prepareOnDemand() && !workspace.ready() }), ({ root, epoch, targets, projected }) => {
    let cancelled = false;
    const previous = untrack(thumbnailMetadata);
    const retained = previous.root === root && previous.epoch === epoch ? previous.entries : [];
    setThumbnailMetadata({ root, epoch, entries: projected ? root?.previewMetadata?.entries ?? [] : retained });
    if (!projected && root && targets.length) void (async () => {
      const merged = new Map(retained.map(entry => [entry.target, entry]));
      for (let start = 0; start < targets.length; start += 128) {
        const result = await client.api.readerMetadata(targets.slice(start, start + 128));
        if (cancelled || sessionEpoch() !== epoch || client.signal.aborted) return;
        for (const entry of result.entries) merged.set(entry.target, entry);
        setThumbnailMetadata({ root, epoch, entries: [...merged.values()] });
      }
    })().catch(() => { /* A failed optional projection retains generic marks. */ });
    return () => { cancelled = true; };
  });
  function projectedPreviewRepresentation(target: string | undefined, typeName: string): Record<string, unknown> | undefined {
    const projection = thumbnailMetadata();
    if (!target || projection.epoch !== sessionEpoch() || projection.root !== current()) return undefined;
    return projection.entries.find(entry => entry.target === target)?.representations.find(instance => instance.typeName === typeName)?.methods;
  }
  const heldOccurrences = new WeakMap<ExprNode, { source: DataOccurrenceSource; root: LocusRootData | undefined;
    producer: ExprNode | undefined; epoch: number; sourceKey: string; reader: ReaderRuntime | undefined }>();
  const heldExpressionPresentation: HeldExpressionPresentation & Required<Pick<HeldExpressionPresentation, "readValue">> = {
    occurrence(node) {
      const root = current(); const producer = inspectionProducer()?.node; const epoch = sessionEpoch();
      const sourceKey = paneSourceKey(); const reader = props.readRuntime;
      const previous = heldOccurrences.get(node);
      if (previous && previous.root === root && previous.producer === producer && previous.epoch === epoch
        && previous.sourceKey === sourceKey && previous.reader === reader) return previous.source;
      const currentSource = () => root === current() && producer === inspectionProducer()?.node && epoch === sessionEpoch()
        && !client.signal.aborted && (!reader || !reader.client.signal.aborted)
        && sourceKey === paneSourceKey() && reader === props.readRuntime;
      const source: DataOccurrenceSource = { state: "source", openContext: (event, selection) => {
        if (!currentSource()) { event.preventDefault(); event.stopPropagation(); setClipboardError("This data changed. Open Suggestions again."); return; }
        openContextMenu(event, undefined, { parent: { id: "$graph-source", valueType: heldExpressionPresentation.graphValue?.(node)?.type,
          source: { kind: "expr", expr: node } }, data: selection, producer: node });
      }, capture: () => {
          const focus = displayFocus(); const sourceKey = paneSourceKey();
          if (!currentSource() || !root) throw new Error("This data's source changed. Open Suggestions again.");
          if (!workspace.ready() || !reader || reader.epoch !== epoch || reader.client.signal.aborted) {
            throw new Error("This data's source tools are still preparing.");
          }
          const base = reader.session(); const session = sourceReaderSession(reader, base);
          const observed = heldExpressionPresentation.graphValue?.(node);
          const fingerprint = draftValueFingerprint({ node, producer, expressions: root.expressions });
          return { session, input: { expression: node, type: observed?.type, sourceType: observed?.type,
            ...(observed ? { value: observed.value } : {}), savedExpressions: Object.entries(root.expressions ?? {}),
            revision: `${epoch}:${sourceKey}:${root.revision}:${fingerprint}` },
            current: () => !reader.client.signal.aborted && reader === props.readRuntime && base === reader.session() && epoch === sessionEpoch()
              && root === current() && sourceKey === paneSourceKey() && sameFocus(focus, displayFocus())
              && fingerprint === draftValueFingerprint({ node, producer: inspectionProducer()?.node, expressions: current()?.expressions }),
            select: next => retarget({ kind: "new:expression", expr: next }, "source"), reportIssue: setClipboardError };
        } };
      heldOccurrences.set(node, { source, root, producer, epoch, sourceKey, reader });
      return source;
    },
    callable(id) {
      requestHeldThumbnailTarget(id);
      const projection = thumbnailMetadata();
      if (projection.epoch !== sessionEpoch() || projection.root !== current()) return undefined;
      const metadata = projection.entries.find(entry => entry.target === id);
      const declared = heldCallableDeclarations().get(metadata?.canonicalTarget ?? id);
      const codeName = projectedPreviewRepresentation(id, "Codeable")?.codeName;
      const label = valueCardLabel(projectedPreviewRepresentation(id, "Labelable")?.label);
      const own = projectedOwnPresentation(id);
      return metadata || declared?.kind === "function" ? { id, name: pickDisplayName(label, declared?.name ?? (typeof codeName === "string" ? codeName : undefined)), icon: own?.icon, emoji: own?.emoji, params: declared?.params, returns: declared?.returns } : undefined;
    },
    typeLabel(type) {
      const description = previewTypeDescription(type);
      const runtime = props.readRuntime;
      if (description.detailLabel || description.label) return description.detailLabel || description.label;
      // B4 wave 4 lane S: a Local reader's type label is its worker's.
      if (runtime?.kind === "local") return runtime.epoch === sessionEpoch() && !runtime.client.signal.aborted
        && runtime.typePresentation?.(type)?.label || description.code;
      return graphCaptureApiReady() && graphReadPresentation
        && runtime?.epoch === sessionEpoch() && !runtime.client.signal.aborted
        ? graphReadPresentation.typedReadTypeLabel(type, runtime.session(), runtime) : description.code;
    },
    graphTypeLabel(type) { return heldExpressionPresentation.typeLabel(type); },
    listElementType(type) {
      if (!graphCaptureApiReady() || !props.readRuntime || props.readRuntime.epoch !== sessionEpoch() || props.readRuntime.client.signal.aborted) return undefined;
      return graphCaptureApi?.childValueType([], type, 0, props.readRuntime.session());
    },
    displayValueType(value, declared, observedType) {
      const runtime = props.readRuntime;
      // B4 wave 4 lane S: a Local reader keeps the generic-yields-to-observed
      // rule over its structure environment; only the page reflection step is
      // skipped (the typed read surface asks its worker).
      if (runtime?.kind === "local") {
        if (!graphCaptureApiReady() || !graphCaptureApi || runtime.epoch !== sessionEpoch() || runtime.client.signal.aborted)
          return declared ?? observedType;
        try { return graphCaptureApi.framelessDisplayType(declared, observedType, runtime.session().environment); }
        catch { return declared ?? observedType; }
      }
      return graphCaptureApiReady() && graphReadPresentation && runtime?.epoch === sessionEpoch() && !runtime.client.signal.aborted
        ? graphReadPresentation.typedReadDisplayType(value, declared, runtime.session(), undefined, observedType) : declared ?? observedType;
    },
    readValue(data, compact, onOpenData, detail, occurrence) {
      function lightRead(selected: ExpressionGraphValue, open = onOpenData, origin = occurrence): JSX.Element {
        const values = () => selected.value as unknown[];
        const elementType = () => selected.type && heldExpressionPresentation.listElementType?.(selected.type);
        const childType = (value: unknown) => heldExpressionPresentation.displayValueType?.(value, elementType()) ?? elementType();
        const elementDescription = (value: unknown) => {
          const type = childType(value);
          const description = previewTypeDescription(type ?? { $ref: "Any" });
          return { ...description, label: description.detailLabel || description.label
            || (type && heldExpressionPresentation.typeLabel(type)) || "Any" };
        };
        const caption = (value: unknown): DisplayNameInput => previewDisplayName(value, undefined, "") || undefined;
        const label = (value: unknown, index: number) => displayNameText(caption(value)) || `Item ${index + 1}`;
        const childData = (value: unknown, index: number): ContainedValuePreview => ({ value, label: label(value, index),
          caption: caption(value), path: [index], getType: () => childType(value),
          typeLabel: elementDescription(value).label, typeIcon: elementDescription(value).icon });
        // Native list data is already present. Reuse the same early Home
        // circles/hover cards without inventing an element-type judgment.
        let outlet: ((event: MouseEvent, child: ContainedValuePreview) => void) | undefined;
        const content = () => <Show when={Array.isArray(selected.value)} fallback={<DataPreview value={selected.value} />}>
          <CollectionPreviewStrip items={values()} label="Items" inlinePreviews
          itemLabel={label} render={value => <Thumbnail value={value} type={childType(value)} />}
          onItemContextMenu={(event, value, index) => outlet?.(event, { ...childData(value, index), path: [...origin?.path ?? [], index] })}
          onOpenItem={open ? (value, index) => open(childData(value, index)) : undefined}
          itemControl={(value, index) => <ExpressionGraphCollectionItemControl data={childData(value, index)} source={values()}
            occurrence={origin ? { source: origin.source, path: [...origin.path, index] } : undefined}
            render={(data, onOpenData, childOccurrence) => lightRead(data ?? { value, type: childType(value) }, onOpenData, childOccurrence)} />}
          onEnterCollection={open ? () => open({ value: values(), label: displayNameText(selected.caption) ?? "Data", path: [],
            getType: () => selected.type, typeLabel: selected.typeLabel, typeIcon: selected.typeIcon }) : undefined}
          preview={(value, index) => <ValueCard presentation="inline" compactLayout="two-line"
            heading={<ValueCardCaption caption={caption(value)} icon={previewValuePresentation(value, undefined)?.icon} emoji={previewValuePresentation(value, undefined)?.emoji}
              typeLabel={elementDescription(value).label} typeIcon={elementDescription(value).icon} />}>
            {lightRead({ value, type: childType(value) }, open ? child => open({ ...child, path: [index, ...child.path] }) : undefined,
              origin ? { source: origin.source, path: [...origin.path, index] } : undefined)}
          </ValueCard>} /></Show>;
        return origin ? <DataOccurrenceBoundary value={selected.value} type={selected.type} occurrence={origin.source}
          dataPath={origin.path} onOutlet={open => { outlet = open; }}>{content()}</DataOccurrenceBoundary> : content();
      }
      // A28: a focused (not compact) constructor's record waits quietly for its
      // typed view instead of printing its tag and field names as code
      // (early-structure.ts); compact cards keep their early preview.
      const fallback = () => <Show when={compact || !plainReaderPrintsConstructorTag(data.value)} fallback={<CardLoadingIndicator />}>
        {lightRead(data)}<Show when={detail && !(Array.isArray(data.value)
        ? data.value.every(previewableValue) : previewableValue(data.value))}><CardLoadingIndicator label="Preparing typed data…" /></Show></Show>;
      return <Loading fallback={fallback()}>
        <Show when={!showingWorkspace() && props.readRuntime && props.readRuntime.epoch === sessionEpoch() && !props.readRuntime.client.signal.aborted && props.readRuntime}
          fallback={fallback()} keyed>{runtime =>
          <HeldGraphReadValue runtime={runtime} data={data} compact={compact} detail={detail}
            describeType={previewTypeDescription} onOpenData={onOpenData} occurrence={occurrence} />}
        </Show>
      </Loading>;
    },
    typeIcon(type) { return previewTypeDescription(type).icon; },
    fieldLabel(field) {
      const runtime = props.readRuntime;
      if (graphCaptureApiReady() && runtime && runtime.epoch === sessionEpoch() && !runtime.client.signal.aborted && workspace.ready()) {
        // B4 wave 4 lane S: a Local reader's field names are its worker's.
        if (runtime.kind === "local") return graphFieldNames?.localParameterName(field, 0, field?.key?.$tag === "NamedField"
          ? graphFieldNames.localFieldName(runtime, runtime.session(), field.key.ref.$ref) : undefined);
        return graphCaptureApi?.parameterDisplayName(field, 0, runtime.registry());
      }
      return field.key?.$tag === "NamedField"
        ? valueCardLabel(projectedPreviewRepresentation(field.key.ref.$ref, "Labelable")?.label) : undefined;
    },
    reference(id) {
      const declared = heldCallableDeclarations().get(id);
      const codeName = projectedPreviewRepresentation(id, "Codeable")?.codeName;
      const label = valueCardLabel(projectedPreviewRepresentation(id, "Labelable")?.label);
      const own = projectedOwnPresentation(id);
      return { name: pickDisplayName(label, declared?.name ?? (typeof codeName === "string" ? codeName : undefined)), icon: own?.icon, emoji: own?.emoji,
        kind: declared?.kind ?? "data" };
    },
  };
  let readerSessionFacadeFactory: typeof import("./expression-runner/account-authoring-session").reactiveAuthoringSession | undefined;
  let readerSessionFacadeLoad: Promise<NonNullable<typeof readerSessionFacadeFactory>> | undefined;
  let readerSessionFacade: { runtime: ReaderRuntime; base: ReturnType<ReaderRuntime["session"]>;
    session: ReturnType<ReaderRuntime["session"]> } | undefined;
  function loadReaderSessionFacade() {
    return readerSessionFacadeLoad ??= import("./expression-runner/account-authoring-session").then(api => {
      readerSessionFacadeFactory = api.reactiveAuthoringSession;
      return api.reactiveAuthoringSession;
    }, error => { readerSessionFacadeLoad = undefined; throw error; });
  }
  function sourceReaderSession(runtime: ReaderRuntime, base = runtime.session()) {
    if (!readerSessionFacadeFactory) throw new Error("This data's source tools are still preparing.");
    if (readerSessionFacade?.runtime === runtime && readerSessionFacade.base === base) return readerSessionFacade.session;
    const session = readerSessionFacadeFactory(() => base, () => {
      if (runtime !== props.readRuntime || runtime.epoch !== sessionEpoch() || runtime.client.signal.aborted) return undefined;
      const capture = runtime.captureSourceMetadata?.();
      return capture?.session === base ? capture : undefined;
    });
    readerSessionFacade = { runtime, base, session };
    return session;
  }
  // A prepared reader already loaded this identity owner. Retain only its
  // facade constructor here; plain early data never requests editing tools.
  createEffect(() => ({ ready: workspace.ready(), runtime: props.readRuntime, epoch: sessionEpoch() }), state => {
    if (state.ready && state.runtime?.epoch === state.epoch && !state.runtime.client.signal.aborted)
      void loadReaderSessionFacade().catch(() => { /* The existing source capture reports preparation failure. */ });
  });
  let graphAlive = true;
  const [graphCapture, setGraphCapture] = createSignal<{
    root: LocusRootData; node: ExprNode; selected?: ExprNode; producer?: ExprNode;
    runtime: ReaderRuntime; session: ReturnType<ReaderRuntime["session"]>; epoch: number;
    sourceSession?: ReturnType<ReaderRuntime["session"]>;
    saved: ReadonlyMap<string, ExprNode>; controller: AbortController; worker?: object; ownerReady?: boolean;
    pending: boolean; error?: string; result?: import("./locus-card-evaluation").LocusCardResult;
  }>();
  let graphCaptureApi: typeof import("./locus-card-evaluation") | undefined;
  let graphReadPresentation: typeof import("./layout-renderer/TypedReadValue") | undefined;
  let graphFieldNames: typeof import("./expression-runner/local-field-names") | undefined;
  let graphCaptureApiLoad: Promise<typeof import("./locus-card-evaluation")> | undefined;
  const [graphCaptureApiReady, setGraphCaptureApiReady] = createSignal(false);
  function loadGraphReadApi() {
    return graphCaptureApiLoad ??= Promise.all([import("./locus-card-evaluation"), import("./layout-renderer/TypedReadValue"),
      loadReaderSessionFacade(), import("./expression-runner/local-field-names")]).then(([api, presentation, , names]) => {
      graphCaptureApi = api;
      graphReadPresentation = presentation;
      graphFieldNames = names;
      if (graphAlive) setGraphCaptureApiReady(true);
      return api;
    }, error => { graphCaptureApiLoad = undefined; throw error; });
  }
  // The declared child-type projection is part of the existing read API. It
  // does not need a capture request or the wider editor catalogue to finish.
  createEffect(() => ({ active: graphActive(), runtime: props.readRuntime, epoch: sessionEpoch() }), state => {
    if (state.active && state.runtime?.epoch === state.epoch && !state.runtime.client.signal.aborted)
      void loadGraphReadApi().catch(() => { /* The existing typed reader retains the generic fallback. */ });
  });
  const graphWorker = createMemo(() => {
    if (!graphCaptureApiReady()) return undefined;
    try {
      const session = props.readRuntime?.session();
      return session ? graphCaptureApi?.authoringWorkerSnapshot(session) : undefined;
    } catch { return undefined; }
  });
  const currentGraphCapture = () => {
    const capture = graphCapture();
    try {
      return capture && graphAlive && !client.signal.aborted && !capture.controller.signal.aborted
        && capture.root === current() && capture.selected === graphSelection()?.node
        && capture.producer === inspectionProducer()?.node
        && capture.runtime === props.readRuntime && capture.session === capture.runtime.session()
        && capture.epoch === sessionEpoch()
        && (!capture.ownerReady || capture.worker === graphCaptureApi?.authoringWorkerSnapshot(capture.session)) ? capture : undefined;
    } catch { return undefined; }
  };
  const graphCapturePendingLabel = () => {
    if (!graphActive() || !graphAlive || client.signal.aborted || workspace.error()) return undefined;
    const producer = inspectionProducer()?.node;
    if (props.publicRoot && current() === props.publicRoot && producer && readPublicInitialGraphValue(props.publicRoot, producer, producer)) return undefined;
    const capture = currentGraphCapture();
    if (capture?.error) return undefined;
    if (capture?.pending) return capture.ownerReady ? "Computing data…" : "Preparing data…";
    if (!props.readRuntime || !workspace.ready() || showingWorkspace()) return "Preparing data…";
    try { props.readRuntime.session(); } catch { return "Preparing data…"; }
    return undefined;
  };
  heldExpressionPresentation.graphValue = node => {
    const producer = inspectionProducer()?.node;
    if (props.publicRoot && current() === props.publicRoot && producer && !client.signal.aborted) {
      const initial = readPublicInitialGraphValue(props.publicRoot, producer, node);
      if (initial) return initial;
    }
    const capture = currentGraphCapture();
    if (capture && !capture.pending && !capture.error && capture.result && capture.sourceSession && graphCaptureApi) {
      const observed = graphCaptureApi.readLocusCapturedValue(capture.node, capture.saved, capture.sourceSession, node, capture.result);
      if (observed) return observed;
    }
    if (node !== inspectionProducer()?.node && (node !== graphSelection()?.node || !graphSelection()?.allowed)) return undefined;
    const root = current();
    const runtime = props.readRuntime;
    if (graphCaptureApi && root && runtime && !client.signal.aborted) {
      try {
        const value = graphCaptureApi.readLocusCardResult(node, new Map(Object.entries(root.expressions ?? {})), sourceReaderSession(runtime));
        if (value && !value.error) return { value: value.result };
      } catch { /* A replaced reader has no current result. */ }
    }
    if (node === inspectionProducer()?.node && (inspectionProducer()?.resultPath.length ?? 0) === 0) {
      const focused = focusedPreview()?.item;
      const value = focused && shellPreview(focused);
      if (value !== undefined) return { value, type: focused?.valueType };
    }
    return undefined;
  };
  // Early function choices: the build-owned repository catalogue is listed
  // before any registry exists; this reader's complete catalogue replaces it
  // once its tools are ready. Reading starts with the first picker only.
  const [repositoryChoices, setRepositoryChoices] = createSignal<{ entries?: readonly HeldFunctionChoice[]; error?: string }>();
  let repositoryChoiceRead = false;
  heldExpressionPresentation.requestFunctionChoices = () => {
    if (repositoryChoiceRead) return;
    repositoryChoiceRead = true;
    const unavailable = "Could not read the function list.";
    if (repositoryChoices()?.error) setRepositoryChoices(undefined);
    void import("./expression-runner/authoring-catalogue-transport")
      .then(transport => transport.readRepositoryFunctionChoices())
      .then(entries => {
        if (client.signal.aborted) return;
        if (!entries) { repositoryChoiceRead = false; setRepositoryChoices({ error: unavailable }); return; }
        setRepositoryChoices({ entries });
      }, () => {
        repositoryChoiceRead = false;
        if (!client.signal.aborted) setRepositoryChoices({ error: unavailable });
      });
  };
  heldExpressionPresentation.functionChoices = () => {
    const runtime = props.readRuntime;
    if (runtime && workspace.ready() && runtime.epoch === sessionEpoch() && !runtime.client.signal.aborted) {
      try { return { entries: runtime.session().catalog.functions as readonly HeldFunctionChoice[] }; }
      catch { /* A replaced reader keeps the repository listing below. */ }
    }
    const repository = repositoryChoices();
    return { entries: repository?.entries ?? [], error: repository?.error,
      retry: repository?.error ? () => heldExpressionPresentation.requestFunctionChoices?.() : undefined,
      pending: !repository ? "Reading functions…" : workspace.loading() ? "More functions are loading…" : undefined,
      more: workspace.loading() || workspace.error() || readProjection() ? undefined : {
        label: "List this data's own functions", detail: "Functions defined in this data appear once its editing tools are prepared.",
        run: () => workspace.request() } };
  };
  // An open early picker keeps the held lens in place when the editing tools
  // become ready: the user's place (the picker and its query) is kept, and
  // the picker lists this reader's own functions from then on.
  const [earlyPickers, setEarlyPickers] = createSignal(0, { ownedWrite: true });
  heldExpressionPresentation.pickerOpen = open => setEarlyPickers(count => Math.max(0, count + (open ? 1 : -1)));
  // Early editing: before the reader's editing tools exist, the held lens
  // edits a draft of the focused value's own expression. Save hands that draft
  // to the workspace's ordinary Save, which runs once the tools are ready.
  const [earlyDraft, setEarlyDraft] = createSignal<{ epoch: number; source: string; scope: string; baseline: ExprNode; node: ExprNode }>();
  const earlyEditable = createMemo(() => !!props.pane && !readProjection() && current()?.canEdit === true
    && displayFocus().kind === "value" && !earlyTypeData() && !!focusedPreview()
    && inspectionProducer()?.resultPath.length === 0, { lazy: true });
  const currentEarlyDraft = () => {
    const draft = earlyDraft();
    return draft && draft.epoch === sessionEpoch() && draft.source === paneSourceKey() && draft.scope === scopeKey(displayFocus()) ? draft : undefined;
  };
  const earlyDraftChanged = createMemo(() => {
    const draft = currentEarlyDraft();
    return !!draft && draftValueFingerprint(draft.node) !== draftValueFingerprint(draft.baseline);
  }, { lazy: true });
  /** The pending workspace request that carries this draft, if any. */
  const earlyHandoff = () => {
    const action = requested() ? request()?.action : undefined;
    return typeof action === "object" && action.kind === "inspect-data" && action.draft ? action.draft : undefined;
  };
  // An unsaved early draft keeps its lens until Save or Continue hands it over.
  const earlyDraftHeld = () => earlyDraftChanged() && !earlyHandoff();
  function updateEarlyDraft(next: ExprNode) {
    const producer = inspectionProducer()?.node;
    if (!producer || !earlyEditable()) return;
    const held = currentEarlyDraft();
    setEarlyDraft({ epoch: sessionEpoch(), source: paneSourceKey(), scope: scopeKey(displayFocus()), baseline: held?.baseline ?? producer, node: next });
    const pending = request();
    const action = pending?.action;
    if (pending && typeof action === "object" && action.kind === "inspect-data" && action.draft) {
      setRequest({ ...pending, action: { ...action, draft: { ...action.draft, node: next } } });
    }
  }
  function handOffEarlyDraft(commit: boolean) {
    const draft = currentEarlyDraft();
    const selected = focusedPreview();
    if (!draft || !selected || !earlyDraftChanged()) return;
    retarget({ kind: "inspect-data", item: selected.original, scope: displayFocus(), mode: inspectionMode(),
      draft: { baseline: draft.baseline, node: draft.node, commit } }, "source");
  }
  function discardEarlyDraft() {
    if (earlyHandoff()) cancelRequest("source");
    setEarlyDraft(undefined);
  }
  async function captureGraphData() {
    const root = current();
    const producer = inspectionProducer()?.node;
    const selected = graphSelection();
    // A selected closed call can be observed even when it is displayed inside
    // All data. Unknown lexical inputs need their focused producer; the full
    // All data expression is never an automatic graph fallback.
    const node = selected?.allowed && selected.node ? selected.node : displayFocus().kind !== "root" ? producer : undefined;
    const runtime = props.readRuntime;
    if (!graphActive() || !graphAlive || !root || !node || !runtime || client.signal.aborted || showingWorkspace()
      || currentGraphCapture()?.pending) return;
    let session: ReturnType<ReaderRuntime["session"]>;
    try { session = runtime.session(); } catch { return; }
    const capture = { root, node, selected: selected?.node, producer, runtime, session, epoch: sessionEpoch(),
      saved: new Map(Object.entries(root.expressions ?? {})), pending: true, controller: new AbortController() };
    setGraphCapture(capture);
    try {
      graphCaptureApi = await loadGraphReadApi();
      if (currentGraphCapture()?.saved !== capture.saved) return;
      const sourceSession = sourceReaderSession(runtime, session);
      if (selected?.allowed && selected.node && producer) {
        const source = graphCaptureApi.authoringExpressionSites(producer, id => capture.saved.get(id), sourceSession);
        if (!source.sites.some(site => site.node === selected.node)) { setGraphCapture(undefined); return; }
      }
      const owned = { ...capture, sourceSession, ownerReady: true, worker: graphCaptureApi.authoringWorkerSnapshot(session) };
      setGraphCapture(owned);
      const result = graphCaptureApi.readLocusCardResult(node, capture.saved, sourceSession, { capture: true })
        ?? await graphCaptureApi.evaluateLocusCard(node, capture.saved, sourceSession,
          { capture: true, transient: true, signal: capture.controller.signal });
      if (currentGraphCapture()?.saved === capture.saved) setGraphCapture({ ...owned, pending: false, result });
    } catch (error) {
      if (currentGraphCapture()?.saved === capture.saved)
        setGraphCapture({ ...capture, pending: false, error: error instanceof Error ? error.message : String(error) });
    }
  }
  onCleanup(() => { graphAlive = false; graphCapture()?.controller.abort(); });
  function activateGraph(active: boolean, node?: ExprNode, allowed = true) {
    setGraphSelection(active ? { node, allowed } : undefined);
    setGraphActive(active);
  }
  function projectedThumbnailIcon(target: string | undefined): string | undefined {
    const projection = thumbnailMetadata();
    const projected = target && projection.epoch === sessionEpoch() && projection.root === current()
      ? projection.entries.find(entry => entry.target === target) : undefined;
    const runtime = props.readRuntime;
    // A projected miss is authoritative. Before that optional request lands,
    // the ready reader supplies its same scoped Iconable resolution as the
    // prepared editor; no display-name mapping or ambient registry is used.
    const icon = projected ? projected.representations.find(instance => instance.typeName === "Iconable")?.methods.icon
      : target && runtime && runtime.epoch === sessionEpoch() && !runtime.client.signal.aborted && workspace.ready()
        ? runtime.representation("Iconable", target)?.icon : undefined;
    return typeof icon === "string" ? icon : undefined;
  }
  function projectedTypeDescription(type: FenelType) {
    return typeDescriptionIndex().get(JSON.stringify(encodeCheckpointValue(type)));
  }
  function previewTypeDescription(type: FenelType) {
    const target = previewTypeTarget(type);
    const projected = projectedTypeDescription(type);
    const own = projectedOwnPresentation(target);
    const phrase = projected?.phrase.replace(/^(?:A|An) /, "") ?? "";
    const detailLabel = phrase ? phrase.charAt(0).toUpperCase() + phrase.slice(1) : "";
    // A function declared as a named type (`lubeFormula : Recipe`) carries that
    // type's words and code in its projection (public-locus-data.ts): its card
    // says the type ("Recipe"). A written arrow's code is an arrow: "Function".
    const declaredName = "$arrow" in type && !!projected?.code && !/->|→/.test(projected.code);
    // A list reads as what it holds ("List of numbers"), not only as its
    // constructor's own name ("List"): the phrase is the type's own words.
    const label = (projected?.kind === "list" ? detailLabel : "") || valueCardLabel(own?.label)
      || valueCardLabel(projectedPreviewRepresentation(target, "Labelable")?.label)
      || valueCardLabel(projectedPreviewRepresentation(target, "Codeable")?.codeName)
      || ("$arrow" in type && !declaredName ? "Function" : detailLabel || projected?.kindLabel)
      || ("$record" in type ? "Record" : "$variant" in type ? "Variants" : "$type" in type ? "Type" : "");
    return { type, label, detailLabel, code: projected?.code, kind: projected?.kind, ownIcon: own?.icon, ownEmoji: own?.emoji,
      icon: typeIconForPresentation(type, {
        icon: identity => typeof identity === "string" ? projectedThumbnailIcon(identity) : undefined,
        // The type's code travels with its phrase in the same root read, so
        // its icon never trails the label while reader metadata is pending.
        canonicalName: identity => valueCardLabel(projectedPreviewRepresentation(identity, "Codeable")?.codeName)
          || (projected?.code && /^[A-Za-z_][A-Za-z0-9_]*$/.test(projected.code) ? projected.code : undefined) || identity,
        kindLabel: projected?.kindLabel,
        knownIcons: LUCIDE_BY_NAME,
      }) };
  }
  function previewType(type: FenelType, _caption: string, _icon?: string) {
    return <ValueCard class="home-item--type-preview" heading={<ValueCardCaption caption={previewTypeDescription(type).label}
      icon={projectedOwnPresentation(previewTypeTarget(type))?.icon} emoji={projectedOwnPresentation(previewTypeTarget(type))?.emoji} typeLabel="Type" typeIcon={TYPE_ICON_FALLBACKS.Type} />}>
      <TypeDataPreviewBody type={type} compact describeType={previewTypeDescription}
        resolveShape={type => projectedTypeDescription(type)?.previewShape ?? type}
        describeDetails={type => projectedTypeDescription(type)?.previewDetails} />
    </ValueCard>;
  }
  const [typePreviewIntent, setTypePreviewIntent] = createSignal<{
    type: FenelType; encodedType: string; epoch: number; source: string; focus: LocusScope; root: LocusRootData | undefined;
    previousSubject: ReturnType<NonNullable<WorkspacePane["subject"]>>;
  }>();
  const earlyTypeData = createMemo(() => {
    const pending = typePreviewIntent();
    return pending?.epoch === sessionEpoch() && pending.root === current() && pending.source === paneSourceKey()
      && sameFocus(pending.focus, displayFocus()) ? pending.type : undefined;
  });
  createEffect(() => ({ intent: typePreviewIntent(), epoch: sessionEpoch(), source: paneSourceKey(), focus: displayFocus(), root: current(),
    subject: props.pane?.subject?.(), ready: workspace.ready() }), state => {
    const intent = state.intent;
    const ownSubject = intent && state.subject?.dataType && "$type" in state.subject.dataType && state.subject.dataType.$type === true
      && JSON.stringify(encodeCheckpointValue(state.subject.data)) === intent.encodedType;
    if (intent && (intent.epoch !== state.epoch || intent.root !== state.root || intent.source !== state.source || !sameFocus(intent.focus, state.focus)
      || state.subject !== intent.previousSubject && (state.ready || !ownSubject))) setTypePreviewIntent(undefined);
    else if (intent && state.ready && state.subject === intent.previousSubject) {
      props.pane?.onSubjectData?.({ $tag: "LensTypedSubject", dataType: { $type: true }, data: intent.type,
        originSource: props.pane.source(), originFocus: scopeToWorkspace(intent.focus), producer: Nothing, producerInput: Nothing, producerBinding: Nothing });
    }
  });
  const focusedPreviewType = createMemo(() => {
    if (earlyTypeData()) return { $type: true } as FenelType;
    const focus = displayFocus();
    return focus.kind === "root" ? current()?.type : focus.kind === "view"
      ? current()?.lists.find(row => row.id === focus.viewId)?.valueType : focusedPreview()?.item.valueType;
  });
  function openPreviewType(type: FenelType) {
    if (props.pane?.onSubjectData) {
      setTypePreviewIntent({ type, encodedType: JSON.stringify(encodeCheckpointValue(type)), epoch: sessionEpoch(), source: paneSourceKey(), focus: displayFocus(), root: current(), previousSubject: props.pane.subject?.() });
      props.pane.onSubjectData({ $tag: "LensTypedSubject", dataType: { $type: true }, data: type,
        originSource: props.pane.source(), originFocus: scopeToWorkspace(displayFocus()), producer: Nothing, producerInput: Nothing, producerBinding: Nothing });
      setInspectionMode("data");
      workspace.request();
    } else retarget({ kind: "inspect-type", type, scope: displayFocus() }, "source");
  }
  /** Labels first, then the occurrence's own human caption (it ranks with a
   * label, as in the prepared reader); a code name (no label, no caption) is
   * marked so cards show it in the code face; the placeholder last.
   * A label that is an actual Labelable instance was authored (a type the
   * person named "Person"): it reads as a label even when it equals the code
   * name; only a projected label equal to the code name is that code name. */
  function previewDisplayName(value: unknown, representations: LayoutItem["representations"], fallback: DisplayNameInput,
    caption?: string): DisplayNameInput {
    const identity = readLocusCatalogReference(value)?.id;
    const own = projectedOwnPresentation(identity);
    const label = valueCardLabel(representations?.Labelable?.label)
      || valueCardLabel(own?.label)
      || valueCardLabel(projectedPreviewRepresentation(identity, "Labelable")?.label);
    const code = valueCardLabel(representations?.Codeable?.codeName)
      || valueCardLabel(own?.codeName)
      || valueCardLabel(projectedPreviewRepresentation(identity, "Codeable")?.codeName);
    const authored = authoredLabel(identity, representations);
    if (label?.trim() && label.trim() === authored?.trim()) return humanName(label);
    return pickDisplayName(label || valueCardLabel(caption), code) ?? fallback;
  }
  /** The target's own Labelable instance (never a projection's fallback). */
  function authoredLabel(target: string | undefined, representations: LayoutItem["representations"]): string | undefined {
    const own = valueCardLabel(representations?.Labelable?.label)
      || valueCardLabel(projectedPreviewRepresentation(target, "Labelable")?.label);
    if (own || !target) return own;
    const runtime = props.readRuntime;
    return runtime?.epoch === sessionEpoch() && !runtime.client.signal.aborted && workspace.ready()
      ? valueCardLabel(runtime.representation("Labelable", target)?.label) : undefined;
  }
  function previewLabel(value: unknown, representations: LayoutItem["representations"], fallback: string, caption?: string): string {
    return displayNameText(previewDisplayName(value, representations, fallback, caption)) ?? fallback;
  }
  function projectedOwnPresentation(target: string | undefined) {
    const projection = thumbnailMetadata();
    if (!target || projection.epoch !== sessionEpoch() || projection.root !== current()) return undefined;
    const projected = projection.entries.find(entry => entry.target === target);
    if (projected) return projected.ownPresentation;
    const runtime = props.readRuntime;
    return runtime?.epoch === sessionEpoch() && !runtime.client.signal.aborted && workspace.ready()
      ? runtime.presentation(target) : undefined;
  }
  function previewCaptionName(item: LayoutItem, fallback = "Data"): DisplayNameInput {
    return previewDisplayName(thumbnailValue(item), item.representations, item.caption || fallback, item.caption);
  }
  function previewCaption(item: LayoutItem, fallback = "Data"): string {
    return previewLabel(thumbnailValue(item), item.representations, item.caption || fallback, item.caption);
  }
  function previewUnnamed(item: LayoutItem, fallback?: string): boolean {
    return !previewLabel(thumbnailValue(item), item.representations, item.caption || fallback || "", item.caption).trim();
  }
  function previewValuePresentation(value: unknown, representations: LayoutItem["representations"]) {
    const own = projectedOwnPresentation(readLocusCatalogReference(value)?.id);
    const icon = representations?.Iconable?.icon;
    const emoji = representations?.Emojiable?.emoji;
    return { icon: typeof icon === "string" ? icon : own?.icon,
      emoji: typeof emoji === "string" ? emoji : own?.emoji };
  }
  function previewValueIcon(value: unknown, representations: LayoutItem["representations"]): string | undefined {
    return previewValuePresentation(value, representations)?.icon;
  }
  function Thumbnail(props: { value: unknown; type?: FenelType; representations?: LayoutItem["representations"] }) {
    const presented = () => previewValuePresentation(props.value, props.representations);
    return <DataThumbnail value={props.value} valueIcon={presented().icon} emoji={presented().emoji} typeIcon={projectedThumbnailIcon(previewTypeTarget(props.type))
      ?? (props.type ? previewTypeDescription(props.type).icon : undefined)} />;
  }
  function InlinePreview(props: { item: LayoutItem }) {
    return <PreviewBody item={props.item} compact />;
  }
  /** Both checked initial data and live results use the same reader body.
   * Before reader preparation, the existing inert type/data surfaces compose
   * the supplied facts without invoking a callable or inferring another type. */
  function PreviewBody(bodyProps: { item: LayoutItem; compact?: boolean }) {
    const value = () => shellPreview(bodyProps.item);
    const type = () => bodyProps.item.valueType;
    const runtime = () => {
      const reader = props.readRuntime;
      return reader?.epoch === sessionEpoch() && !reader.client.signal.aborted ? reader : undefined;
    };
    const readSession = createMemo(() => {
      const reader = runtime();
      if (!reader) return undefined;
      const base = reader.session();
      if (!reader.captureSourceMetadata && !base.captureSourceMetadata) return { reader, base, session: base };
      return loadReaderSessionFacade().then(() => ({ reader, base, session: sourceReaderSession(reader, base) }));
    });
    const occurrence: DataOccurrenceSource = { state: "source", capture: () => {
      const reader = runtime(); const root = current(); const epoch = sessionEpoch();
      const item = bodyProps.item;
      const linked = item.source?.kind === "ref" ? item.source.ref.id : undefined;
      const expression: ExprNode | undefined = linked ? { kind: "ref", savedExprId: linked } : previewExpression(item);
      if (!reader || !root || !expression) throw new Error("This data's source tools are still preparing.");
      const base = reader.session(); const session = sourceReaderSession(reader, base);
      const source = paneSourceKey(); const focus = displayFocus();
      const savedExpressions = Object.entries(root.expressions ?? {});
      return { session, input: { expression, type: item.valueType, sourceType: item.valueType,
        savedExpressions, revision: draftValueFingerprint({ epoch, source, focus, revision: root.revision, expression }) },
        current: () => runtime() === reader && reader.session() === base && root === current()
          && epoch === sessionEpoch() && item === bodyProps.item && source === paneSourceKey() && sameFocus(focus, displayFocus()),
        select: node => retarget({ kind: "new:expression", expr: node }, "source"), reportIssue: setClipboardError };
    } };
    const unavailable: DataOccurrenceSource = { state: "unavailable", issue: "This data's source expression is not ready." };
    // A function value (a reference to one declaration) shown at full size: its
    // card also draws its sampled curve, as the prepared function card does.
    const sampledFunction = createMemo(() => {
      const declared = type();
      const expression = previewExpression(bodyProps.item);
      const value = expression?.kind === "literal" ? expression.value as { $ref?: unknown } | undefined : undefined;
      return !bodyProps.compact && declared && "$arrow" in declared && value && typeof value === "object" && typeof value.$ref === "string"
        ? { pinId: value.$ref, arrow: declared.$arrow } : undefined;
    });
    requestEarlyReadValue();
    return <><Loading fallback={<Show when={bodyProps.compact || !plainReaderPrintsConstructorTag(value())} fallback={<CardLoadingIndicator />}><DataPreview value={value()} /></Show>}>
      <Show when={earlyReadValueLoaded() ? runtime() : undefined} keyed fallback={<Show when={type() && "$arrow" in type()!}
        fallback={<Show when={value() !== undefined} fallback={<Thumbnail value={thumbnailValue(bodyProps.item)}
          type={type()} representations={bodyProps.item.representations} />}>
          {heldExpressionPresentation.readValue({ value: value(), type: type() }, !!bodyProps.compact)}
        </Show>}>
        <TypeDataPreviewBody type={type()!} compact={bodyProps.compact} describeType={previewTypeDescription} onOpenType={openPreviewType} />
      </Show>}>
        {reader => <EarlyReadValue runtime={reader} sourceSession={() => {
          const source = readSession();
          if (source?.reader !== reader || source.base !== reader.session())
            throw new Error("This data's source changed while its reader was preparing.");
          return source.session;
        }} node={previewExpression(bodyProps.item)!}
          saved={new Map(Object.entries(current()?.expressions ?? {}))} type={type()} compact={bodyProps.compact}
          valueIcon={previewValueIcon(thumbnailValue(bodyProps.item), bodyProps.item.representations)}
          value={value() === undefined ? undefined : { value: value() }} onOpenType={openPreviewType}
          occurrence={previewExpression(bodyProps.item) ? occurrence : unavailable}
          onRead={read => noteCardRead(bodyProps.item, read)}
          onDataContext={(event, data) => openContextMenu(event, undefined, { parent: bodyProps.item, data })} />}
      </Show>
    </Loading>
    <Show when={sampledFunction()}>{fn => <Show when={runtime()} keyed>{reader =>
      <Loading fallback={null}><ReaderFunctionGraph runtime={reader} pinId={fn().pinId} arrow={fn().arrow} /></Loading>}</Show>}</Show></>;
  }
  /** What the clicked card shows of its destination, for the lens to show at once. */
  function navigationIntent(item: LayoutItem) {
    const presented = previewValuePresentation(thumbnailValue(item), item.representations);
    return { name: previewCaptionName(item, ""), icon: presented.icon, emoji: presented.emoji };
  }
  function openPreview(scope: LocusScope, separate = false) {
    setInspectionIntent(undefined);
    const item = scope.kind === "value" && scope.rootItem && scope.path.length === 0 ? current()?.items.find(item => item.id === scope.itemId) : undefined;
    const location = item && dataTarget(item);
    if (location && props.pane?.onDataTarget) {
      props.pane.onDataTarget(location, separate ? "stack" : undefined, undefined, separate ? undefined : navigationIntent(item));
      return;
    }
    if (props.publicRoot) workspace.request();
    if (separate) props.pane?.onOpenLens(scope);
    else if (props.pane) {
      setFocusIntent({ epoch: sessionEpoch(), source: paneSourceKey(), origin: props.pane.focus(), target: scope });
      props.pane.onFocus(scope);
    }
  }
  function PreviewPending() {
    return <Show when={workspace.error()} fallback={<CardLoadingIndicator />}>
      <LocusLoadFailure message="Could not prepare data tools." detail={workspace.error()!} retry={workspace.retry} retryLabel={workspace.retryLabel?.()} />
    </Show>;
  }
  const destinationId = () => {
    const focus = props.pane ? displayFocus() : undefined;
    return focus && focus.kind !== "root" ? focus.viewId : current()?.id;
  };
  // `byUser` separates an intent the user can take back from the automatic
  // request a non-empty canvas raises: cancelling the latter would only let the
  // effect below re-raise it on the next tick.
  type CreationOrigin = { epoch: number; pane?: string; source: string; focus: string; label: string };
  const resumedCreation = untrack(() => props.pane?.source().$tag === "ThisTabSource" ? props.pane.creationDraft?.() : undefined);
  const [request, setRequest] = createSignal<{ epoch: number; action: RequestedAction; byUser: boolean; source: PendingSource; creationOrigin?: CreationOrigin } | undefined>(
    resumedCreation ? untrack(() => ({ epoch: sessionEpoch(), action: cloneDraftValue(resumedCreation.action), byUser: true, source: "new" as const,
      creationOrigin: { epoch: sessionEpoch(), pane: props.pane?.id, source: paneSourceKey(), focus: scopeKey(resumedCreation.focus),
        label: `${props.pane?.sourceLabel() ?? "Local"} / All data` } })) : undefined);
  const [retryingEpoch, setRetryingEpoch] = createSignal<number>();
  const retrying = createMemo(() => retryingEpoch() === sessionEpoch());
  const requested = createMemo(() => request()?.epoch === sessionEpoch());
  // Solid 2 computes eagerly. Define these before notices can read them, even
  // while the root request still has its first-load placeholder.
  const awaitingWorkspace = createMemo(() =>
    requested() && request()?.byUser === true && (!workspace.ready() || request()?.source === "new" && !currentReads()) && !workspace.error());
  const pendingSource = createMemo(() => awaitingWorkspace() ? request()?.source : undefined);
  createEffect(() => ({ pending: request(), focus: displayFocus(), source: paneSourceKey(), root: current(), epoch: sessionEpoch() }), ({ pending, focus, source, root, epoch }) => {
    const action = pending?.action;
    if (typeof action === "object" && (action.kind === "show-code" || action.kind === "inspect-data" || action.kind === "inspect-type") && action.scope
      && scopeKey(action.scope) !== scopeKey(focus)) setRequest(undefined);
    if (typeof action === "object" && (action.kind === "suggest-data" || action.kind === "call-function")
      && (action.epoch !== epoch || action.source !== source || !sameFocus(action.scope, focus)
        || root?.id !== action.rootId || root.revision !== action.revision)) {
      // Moving elsewhere takes the request back; a change of the data under a
      // captured request is reported, never dropped silently.
      const changed = action.epoch === epoch && action.source === source && sameFocus(action.scope, focus) && pending?.byUser;
      setRequest(undefined); setContextMenu(undefined);
      if (changed) setClipboardError(action.kind === "call-function"
        ? "This data changed while its call form was prepared. Instantiate the current function again."
        : "This data changed while its suggestions were prepared. Open Suggestions again.");
    }
  });
  // "+ New" asks WHICH KIND of thing to create. That question is five static
  // buttons, so it opens on the first click with no engine loaded; only the
  // ANSWER waits on the workspace.
  const [pickerOpen, setPickerOpen] = createSignal(false);
  const [pickerOrigin, setPickerOrigin] = createSignal<CreationOrigin>();
  const [pendingPickerChoice, setPendingPickerChoice] = createSignal<CreationOrigin>();
  const creationOrigin = createMemo<CreationOrigin>(() => ({ epoch: sessionEpoch(), pane: props.pane?.id,
    source: paneSourceKey(), focus: scopeKey(displayFocus()), label: displayFocus().kind === "root"
      ? `${props.pane?.sourceLabel() ?? current()?.name ?? "Local"} / All data`
      : "Checking the current location…" }));
  const sameCreationOrigin = (before: CreationOrigin, after: CreationOrigin) => before.epoch === after.epoch
    && before.pane === after.pane && before.source === after.source && before.focus === after.focus;
  function openCreationPicker() {
    if (request()?.source === "new") { props.pane?.onCreationDraft?.(undefined, client); setRequest(undefined); }
    setPickerOrigin(untrack(creationOrigin));
    setPickerOpen(true);
  }
  createEffect(() => ({ origin: creationOrigin(), picker: pickerOpen() && pickerOrigin(), pending: request() }), state => {
    if (state.picker && !sameCreationOrigin(state.picker, state.origin)) setPickerOpen(false);
    if (state.pending?.source === "new" && state.pending.creationOrigin
      && !sameCreationOrigin(state.pending.creationOrigin, state.origin)) setRequest(undefined);
  });
  const [contextMenu, setContextMenu] = createSignal<{ x: number; y: number; point: { x: number; y: number };
    epoch: number; source: string; focus: LocusScope; rootId?: string; revision?: number;
    item?: LayoutItem; typeName?: string; suggestions?: boolean;
    producer?: ExprNode; opener?: Element;
    selection?: Extract<HomeAction, { kind: "suggest-data" }>["selection"] }>();
  createEffect(() => {
    const target = contextMenu();
    if (!target) return false;
    if (target.epoch !== sessionEpoch() || target.source !== paneSourceKey() || !sameFocus(target.focus, displayFocus())) return true;
    const root = current();
    return target.rootId !== root?.id || target.revision !== root?.revision;
  }, expired => { if (expired) setContextMenu(undefined); });
  // The open menu reads this retained target, never the Show's accessor: its
  // placement effect re-runs once more as the menu closes, and a non-keyed
  // accessor then throws "Stale read from <Show>". Not keyed: Suggestions
  // replaces the target while the same menu stays open.
  const shownContextMenu = createMemo<ReturnType<typeof contextMenu>>(previous => contextMenu() ?? previous);
  const [representationOwner, setRepresentationOwner] = createSignal<Pick<typeof import("./locus-layout-options"), "locusLayoutOptions">>();
  const [representationFailed, setRepresentationFailed] = createSignal(false);
  let representationLoading = false;
  let representationDisposed = false;
  onCleanup(() => { representationDisposed = true; });
  function requestRepresentationOptions() {
    if (representationOwner() || representationLoading) return;
    representationLoading = true;
    setRepresentationFailed(false);
    // Optional menu capability code, not a reader/catalogue or source read.
    void import("./locus-layout-options").then(owner => {
      if (!representationDisposed) setRepresentationOwner(owner);
    }).catch(() => {
      if (!representationDisposed) setRepresentationFailed(true);
    }).finally(() => { representationLoading = false; });
  }
  // Browse lists NAMES. The three reads behind those names answer in about
  // five seconds together, while the typed workspace takes minutes to build on
  // a cold dev load — so the panel opens on the reads and the system catalog
  // arrives with the workspace. Nothing is fetched until it is opened.
  //
  // Names arrive through independent reads. Non-empty input also asks a neutral
  // worker for the existing checked core scalar choices; account candidates
  // still belong to the complete prepared reader.
  const browsePane = untrack(() => props.pane);
  const [drawerOpen, setDrawerOpen] = createSignal(untrack(() => browsePane?.browseState?.()?.open ?? false));
  const [drawerQuery, setDrawerQuery] = createSignal(untrack(() => browsePane?.browseState?.()?.query ?? ""));
  createEffect(() => ({ open: drawerOpen(), query: drawerQuery() }), state => browsePane?.onBrowseChange?.(state));
  type CoreRead = { epoch: number; input: string; rows: readonly ValueSuggestion[]; pending: boolean; error?: string };
  const [coreRead, setCoreRead] = createSignal<CoreRead>();
  let coreClient: CoreValueSuggestionClient | undefined;
  let coreAbort: AbortController | undefined;
  let coreOwnerActive = true;
  const stopCore = () => {
    coreAbort?.abort();
    coreAbort = undefined;
    coreClient?.dispose();
    coreClient = undefined;
  };
  onSettled(() => {
    const readerClosed = () => {
      stopCore();
      // Disposal may happen while the parent reconciles owned children. Only
      // a still-mounted reader publishes the cleared rows, outside that scope.
      queueMicrotask(() => { if (coreOwnerActive) setCoreRead(undefined); });
    };
    client.signal.addEventListener("abort", readerClosed, { once: true });
    return () => {
      coreOwnerActive = false;
      client.signal.removeEventListener("abort", readerClosed);
      stopCore();
    };
  });
  createEffect(() => ({ open: drawerOpen(), input: drawerQuery(), epoch: sessionEpoch(),
    editable: !props.publicRoot && current()?.canEdit === true,
    handedOff: workspace.ready() && request()?.source === "browse" }), (state) => {
    coreAbort?.abort();
    if (!state.open || !state.editable || state.handedOff || client.signal.aborted) {
      stopCore(); setCoreRead(undefined); return;
    }
    if (!state.input.length) { setCoreRead(undefined); return; }
    const abort = new AbortController();
    coreAbort = abort;
    setCoreRead({ epoch: state.epoch, input: state.input, rows: [], pending: true });
    try {
      coreClient ??= createCoreValueSuggestionClient(client);
      void coreClient.suggest(state.input, abort.signal).then((rows) => {
        if (abort.signal.aborted || client.signal.aborted || state.epoch !== sessionEpoch()) return;
        setCoreRead({ epoch: state.epoch, input: state.input, rows, pending: false });
      }, () => {
        if (abort.signal.aborted || client.signal.aborted || state.epoch !== sessionEpoch()) return;
        coreClient?.dispose();
        coreClient = undefined;
        setCoreRead({ epoch: state.epoch, input: state.input, rows: [], pending: false,
          error: "Typed choices will be available when editing tools finish loading." });
      });
    } catch {
      setCoreRead({ epoch: state.epoch, input: state.input, rows: [], pending: false,
        error: "Typed choices will be available when editing tools finish loading." });
    }
    return () => abort.abort();
  });
  const currentCoreRead = createMemo(() => {
    const result = coreRead();
    return !client.signal.aborted && result?.epoch === sessionEpoch() && result.input === drawerQuery() ? result : undefined;
  });
  type SavedRead = { epoch: number; rows: Array<Record<string, unknown>> };
  const drawerSaved = createMemo<SavedRead | Promise<SavedRead>>(() => {
    const epoch = sessionEpoch();
    if (!drawerOpen() || props.navigationRoot) return { epoch, rows: [] };
    return getSavedQueries().then(
      (data) => ({ epoch, rows: ((data as { queries?: unknown[] })?.queries ?? []) as Array<Record<string, unknown>> }),
      () => ({ epoch, rows: [] as Array<Record<string, unknown>> }),
    );
  });
  const drawerTypes = createMemo(() => drawerOpen() && !props.navigationRoot
    ? getBrowseTypes().then((data) => data.types, () => []) : []);
  const drawerFns = createMemo(() => drawerOpen() && !props.navigationRoot
    ? getBrowseFunctions().then((data) => data.functions, () => []) : []);
  onSettled(() => onBrowserSessionChange(() => {
    setDrawerOpen(false);
    setDrawerQuery("");
  }));
  const savedRows = createMemo<BrowseSavedRow[]>(() => {
    const result = drawerSaved() as SavedRead;
    const rows = result.epoch === sessionEpoch() ? result.rows : [];
    const text = drawerQuery().trim().toLowerCase();
    return rows
      .filter((row) => {
        const kind = (row["query"] as { kind?: string } | undefined)?.kind;
        return (kind === "expression" || kind === "data-search") && !!(row["query"] as { expr?: unknown })?.expr;
      })
      .map((row) => ({
        id: String(row["id"]),
        name: (row["name"] as string | null) ?? "",
        description: (row["description"] as string | null) ?? null,
      }))
      .filter((row) => !text
        || row.name.toLowerCase().includes(text)
        || row.id.toLowerCase().includes(text)
        || (row.description ?? "").toLowerCase().includes(text));
  });
  type CatalogNameRow = Pick<DataItem, "kind" | "routeId" | "routeBase" | "label" | "description">;
  const typeRows = createMemo<CatalogNameRow[]>(() => drawerTypes()
      .filter(row => !row.isSystem && row.hasDefinition).map(row => ({
        kind: "entity" as const, routeId: userTypeRouteId(row.name), routeBase: "/app/types/" as const,
        label: row.label ?? row.name, description: row.description ?? "",
      })).filter(item => matchesUserQuery(item, drawerQuery())));
  const functionRows = createMemo<CatalogNameRow[]>(() => drawerFns()
      .filter(row => !row.isSystem && row.hasDefinition).map(row => ({
        kind: "function" as const, routeId: row.name, routeBase: "/app/functions/" as const,
        label: row.name, description: row.description ?? "",
      })).filter(item => matchesUserQuery(item, drawerQuery())));
  const navigateTo = (href: string) => { setDrawerOpen(false); navigate(href); };
  /** The shared panel keeps names usable while checked scalar choices arrive. */
  const browseGroups = createMemo<BrowseGroup[]>(() => props.navigationRoot ? [{ id: "data", title: "All data",
    rows: (current()?.items ?? []).filter(item => matchesUserQuery({ routeId: item.id, label: previewCaption(item), description: "" }, drawerQuery())).map(item => ({
      id: item.id, label: previewCaption(item), icon: previewValueIcon(thumbnailValue(item), item.representations),
      pick: () => { setDrawerOpen(false); const next = previewScope(item); if (next) openPreview(next); },
      open: () => { setDrawerOpen(false); const next = previewScope(item); if (next) openPreview(next, true); },
    })) }] : [
    { id: "create", title: "Create data", rows: (currentCoreRead()?.rows ?? []).map((suggestion) => ({
      id: `create:${suggestion.id}`,
      label: suggestion.label,
      detail: suggestion.detail,
      badge: suggestion.status === "complete" ? "new data" : "incomplete",
      disabled: suggestion.status !== "complete",
      pick: () => {
        if (suggestion.status !== "complete" || client.signal.aborted) return;
        retarget({ kind: "new:value", typeName: suggestion.typeName,
          preset: { type: suggestion.type, value: suggestion.value } }, "browse");
      },
    })) },
    { id: "saved", title: "Saved data", rows: [], pendingLabel: "Reading saved data…", readRows: () => savedRows().map((row) => ({
      id: `saved:${row.id}`,
      label: row.name || "Untitled",
      detail: row.description ?? undefined,
      drag: (transfer: DataTransfer) => {
        transfer.setData("application/x-fenel-savedexpr-id", row.id);
        transfer.setData("application/x-fenel-savedexpr-name", row.name);
      },
      pick: () => retarget({ kind: "pin", savedExprId: row.id, caption: row.name || undefined }, "browse"),
      open: () => retarget({ kind: "open-saved", savedExprId: row.id, caption: row.name || "Untitled" }, "source"),
    })) },
    { id: "types", title: "Types", rows: [], pendingLabel: "Reading types…", readRows: () => catalogBrowseRows(typeRows()) },
    { id: "functions", title: "Functions", rows: [], pendingLabel: "Reading functions…", readRows: () => catalogBrowseRows(functionRows()) },
  ]);
  function catalogBrowseRows(items: readonly CatalogNameRow[]) {
    return items.map((item) => ({
      id: `${item.kind}:${item.routeId}`,
      label: item.label,
      detail: item.description || undefined,
      badge: item.kind,
      drag: (transfer: DataTransfer) => {
        // Carry the catalog pin payload so the canvas drop handler can
        // reconstruct the literal.
        transfer.setData("application/x-fenel-pin",
          JSON.stringify({ $pin: item.kind, name: item.routeId, id: item.routeId }));
        transfer.setData("application/x-fenel-pin-caption", item.label);
      },
      pick: () => retarget({ kind: "pin", pin: { kind: item.kind, routeId: item.routeId }, caption: item.label }, "browse"),
      open: () => navigateTo(`${item.routeBase}${encodeURIComponent(item.routeId)}`),
    }));
  }
  /** The shell answers names in seconds and the typed workspace takes minutes,
   *  so an incomplete catalog says so instead of reading as an answer. */
  const browsePending = createMemo<BrowsePending[]>(() => props.navigationRoot ? [] : [
    ...(currentCoreRead()?.pending ? [{ id: "core-values", label: "Checking typed choices…" }] : []),
    ...(currentCoreRead()?.error ? [{ id: "core-values-error", label: currentCoreRead()!.error! }] : []),
    ...(workspace.ready() ? [] : [{ id: "catalog", label: "Loading the rest of the catalog…" }]),
  ]);
  const [clipboardError, setClipboardError] = createSignal<string>();
  const [transferNotes, setTransferNotes] = createSignal<readonly string[]>([]);
  // A type you can simply TYPE does not need the workspace at all: the value is
  // a literal and pinning it is three API calls. So the shell answers it here,
  // in seconds, instead of handing it to a mount that takes minutes.
  const [quickValue, setQuickValue] = createSignal<{
    typeName: string; shape: QuickValueShape; x: number; y: number; point: { x: number; y: number }; epoch: number;
  }>();
  const [readingClipboard, setReadingClipboard] = createSignal(false);
  const [externalAdding, setExternalAdding] = createSignal(false);
  const [transferFeedback, setTransferFeedback] = createSignal<{ sequence: number; complete: boolean }>();
  let transferSequence = 0;
  let externalImport: AbortController | undefined;
  let externalFlight = false;
  let externalFallbackTicket: WorkspaceTransferTicket | undefined;
  let transferSurfaceActive = true;
  onCleanup(() => { transferSurfaceActive = false; externalImport?.abort(); });
  const [savingQuickValue, setSavingQuickValue] = createSignal(false);
  let quickWritePending = false;
  let clipboardRead: AbortController | undefined;
  onCleanup(() => clipboardRead?.abort());
  const navigate = useNavigate();
  // A dismissal hides one notice as it read; a different message under the
  // same id is a new notice and shows.
  const [dismissed, setDismissed] = createSignal<readonly string[]>([]);
  const dismissNotice = (id: string) => {
    const notice = untrack(raisedNotices).find((candidate) => candidate.id === id);
    if (notice) setDismissed([...untrack(dismissed), locusNoticeKey(notice)]);
  };
  // Read by the notices memo below, which runs at creation (fix lane A, Nov 8).
  const currentNewOriginMatches = () => {
    const pending = request();
    return pending?.source !== "new" || !!pending.creationOrigin && sameCreationOrigin(pending.creationOrigin, creationOrigin());
  };
  const newExpressionRequest = () => {
    const pending = request();
    return requested() && pending?.source === "new" && currentNewOriginMatches()
      && typeof pending.action === "object" && pending.action.kind === "new:expression" ? pending.action : undefined;
  };
  const raisedNotices = createMemo<LocusNotice[]>(() => {
    const raised: LocusNotice[] = [];
    if (clipboardError()) raised.push({ id: "clipboard", tone: "error", message: clipboardError()!,
      ...(client.ingestExternal && hasWorkspaceTransfers(transferOwner) ? {
        retry: { label: "Retry paste", run: () => { void drainExternalTransfers(); } },
        actions: [{ label: "Cancel", run: () => cancelRequest("transfer") }],
      } : {}) });
    for (const [index, message] of transferNotes().entries()) {
      raised.push({ id: `transfer-note:${index}`, tone: "info", message });
    }
    if (readingClipboard()) raised.push({ id: "reading-clipboard", tone: "info", message: "Reading the clipboard…" });
    if (externalAdding() || pendingSource() === "transfer") raised.push({ id: "transfer", tone: "info",
      message: "Adding the data you pasted…", detail: externalAdding() ? undefined : workspace.stage() ?? undefined,
      retry: { label: "Cancel", run: () => cancelRequest("transfer") } });
    if (pendingSource() === "source") raised.push({ id: "source", tone: "info",
      message: typeof request()?.action === "object" && (request()!.action as { kind: string }).kind === "open-saved"
        ? "Opening saved data…" : typeof request()?.action === "object" && (request()!.action as { kind: string }).kind === "inspect-type"
        ? "Opening type…" : typeof request()?.action === "object" && (request()!.action as { kind: string }).kind === "suggest-data"
          ? "Checking suggestions…" : typeof request()?.action === "object" && (request()!.action as { kind: string }).kind === "call-function"
            ? "Opening function inputs…" : earlyHandoff()?.commit ? "Saving your expression when its editing tools are ready…"
            : earlyHandoff() ? "Opening your draft in the full editor…" : "Opening Fenel code…", detail: workspace.stage() ?? undefined,
      retry: { label: "Cancel", run: cancelRequest } });
    // A chosen creation waits for its editor: say what is being created, with
    // Cancel, unless its own New data dialog already shows that wait.
    if (pendingSource() === "new" && !newExpressionRequest()) raised.push({ id: "new", tone: "info",
      message: creationNotice(request()?.action), detail: workspace.stage() ?? undefined,
      retry: { label: "Cancel", run: cancelRequest } });
    return raised;
  });
  function creationNotice(action: RequestedAction): string {
    const kind = typeof action === "string" ? action : action?.kind;
    if (typeof action === "object" && action.kind === "new:value") {
      const quick = [...QUICK_TYPE_CATEGORIES.flatMap(category => category.types), ...Object.values(QUICK_TYPE_SUBTYPES).flat()]
        .find(type => type.name === action.typeName);
      return `Creating ${quick?.label ?? (action.typeName === "String" ? "Text" : action.typeName)}…`;
    }
    return kind === "new:type" ? "Creating a type…" : kind === "new:function" ? "Creating a function…" : "Creating data…";
  }
  const notices = createMemo<LocusNotice[]>(() => {
    const hidden = dismissed();
    return raisedNotices().filter((notice) => !hidden.includes(locusNoticeKey(notice)));
  });
  // A notice the user dismissed must be able to come BACK if it is raised
  // again; clearing on the session/view change is what makes that true.
  createEffect(() => `${sessionEpoch()}:${current()?.id ?? ""}`, () => { setDismissed([]); });

  function openContextMenu(event: MouseEvent, typeName?: string, selected?: { parent: LayoutItem; data: ContainedValuePreview; producer?: ExprNode }) {
    if (client.signal.aborted || !ownsLocusContextMenu(event, !!selected)) return;
    event.preventDefault();
    event.stopPropagation();
    const pending = request()?.action;
    if (typeof pending === "object" && pending.kind === "suggest-data") cancelRequest("source");
    if (!typeName) requestRepresentationOptions();
    const position = locusContextPosition(event);
    const rect = (event.currentTarget as HTMLElement).getBoundingClientRect();
    const itemId = event.target instanceof Element ? event.target.closest<HTMLElement>("[data-locus-preview]")?.dataset.locusPreview : undefined;
    setContextMenu({ ...position, epoch: sessionEpoch(), source: paneSourceKey(), focus: displayFocus(),
      rootId: current()?.id, revision: current()?.revision,
      item: selected?.parent ?? previewItems().find(item => item.id === itemId), typeName,
      producer: selected?.producer, opener: event.target instanceof Element ? event.target : undefined,
      selection: selected?.data.path.length ? { path: selected.data.path, value: selected.data.value,
        type: selected.data.getType(), caption: displayNameText(selected.data.caption) } : undefined, point: {
      x: Math.max(0, Math.min(1, (position.x - rect.left) / Math.max(1, rect.width))),
      y: Math.max(0, Math.min(1, (position.y - rect.top) / Math.max(1, rect.height))),
    } });
  }

  // A finger cannot right-click: on a touch or pen surface a tap on the bare
  // canvas opens the same menu.
  const tapMenu = createLocusTapMenu(openContextMenu);

  async function pasteFromMenu(point: { x: number; y: number }) {
    if (current()?.canEdit !== true) { setClipboardError("This data is read-only here."); return; }
    clipboardRead?.abort();
    const controller = new AbortController();
    clipboardRead = controller;
    const epoch = sessionEpoch();
    const viewId = destinationId();
    setReadingClipboard(true);
    setClipboardError(undefined);
    try {
      const captured = await readClipboardTransfer(controller.signal);
      if (controller.signal.aborted || epoch !== sessionEpoch() || destinationId() !== viewId) return;
      receiveTransfer(captured, point);
    } catch (error) {
      if (!controller.signal.aborted && epoch === sessionEpoch()) {
        setClipboardError(error instanceof Error ? error.message : "Could not read the clipboard. Use Ctrl+V or ⌘V to paste.");
      }
    } finally {
      if (clipboardRead === controller) { clipboardRead = undefined; setReadingClipboard(false); }
    }
  }

  /** A data's "Open in a new tab / window" entries, through the lens's address owner. */
  function elsewhere(scope: LocusScope, source?: WorkspaceSource) {
    const pane = props.pane;
    return pane?.openElsewhere ? { open: (place: "tab" | "window") => pane.openElsewhere!(scope, place, source),
      unavailable: pane.openElsewhereUnavailable?.(source) } : undefined;
  }
  function contextItems(point: { x: number; y: number }): LocusMenuItem[] {
    const target = contextMenu();
    if (target?.suggestions) return [
      { id: "data-suggestions-pending", label: workspace.error() ? "Could not prepare suggestions" : "Checking suggestions…",
        icon: workspace.error() ? "alert-circle" : "loader-circle", disabled: true, tooltip: workspace.error() ?? workspace.stage() ?? undefined },
      ...(workspace.error() ? [{ id: "data-suggestions-retry", label: "Retry", icon: "refresh-cw", keepOpen: true,
        onSelect: () => workspace.retry() }] : []),
      { id: "data-suggestions-cancel", label: "Cancel", icon: "x", onSelect: () => cancelRequest("source") },
    ];
    const location = target?.item && dataTarget(target.item);
    if (target?.typeName) return [{ id: "new-of-type", label: "Create data of this type", icon: "plus",
      disabled: current()?.canEdit !== true, onSelect: () => retarget({ kind: "new:value", typeName: target.typeName!, point,
        cardAnchor: { x: target.x, y: target.y },
        ...(target.item && displayFocus().kind === "root" ? { placement: { afterId: target.item.id } } : {}),
      }, "new") }];
    const into = target?.item ? previewScope(target.item) : undefined;
    const callable = target?.item && !target.selection && !target.producer && into?.kind === "value"
      ? callablePreviewReference(target.item) : undefined;
    const presentationFocus = target?.focus ?? displayFocus();
    const presentationSource = target?.source ?? paneSourceKey();
    const presentationEpoch = target?.epoch ?? sessionEpoch();
    const held = props.pane?.subject?.();
    const focused = focusedPreview()?.item;
    const currentItem = !!target?.item && presentationFocus.kind === "value"
      && sameFocus(previewScope(target.item) ?? presentationFocus, presentationFocus);
    const selectedScope = target?.item ? previewScope(target.item) : presentationFocus;
    const selectedList = target?.item && previewLists().find(row => row.id === target.item!.id);
    const presentationTarget = location ?? (selectedScope && props.pane
      ? { $tag: "ValuePresentationTarget" as const, source: props.pane.source(), focus: scopeToWorkspace(selectedScope) } : undefined);
    const presentationValue = location ? undefined : target?.item && !currentItem
      ? selectedList?.view.items ?? shellPreview(target.item)
      : earlyTypeData() ?? held?.data
        ?? (presentationFocus.kind === "value" ? focused && shellPreview(focused) : previewItems().map(item => shellPreview(item)));
    const choices = props.pane ? representationOwner()?.locusLayoutOptions({
      type: location ? undefined : target?.item && !currentItem ? target.item.valueType ?? selectedList?.valueType
        : held?.dataType ?? focusedPreviewType(), value: presentationValue, canTable: true,
    }).filter(option => target?.item && !currentItem || !held || option.value === "value" || option.value === "code" || option.value === "list") ?? [] : [];
    const selectedPresentation = props.pane?.presentation()
      ?? (presentationFocus.kind === "value" ? "value" : presentationFocus.kind === "view"
        ? current()?.lists.find(row => row.id === presentationFocus.viewId)?.view.kind : current()?.layout.kind) as LocusLayoutChoice | undefined;
    function presentationIsCurrent() {
      return presentationEpoch === sessionEpoch() && presentationSource === paneSourceKey()
        && sameFocus(presentationFocus, displayFocus());
    }
    function present(kind: LocusLayoutChoice, mode?: "stack" | "split" | "float") {
      if (!presentationIsCurrent()) return;
      if (target?.item && !currentItem) {
        if (presentationTarget && props.pane?.onDataTarget) {
          if (!mode) setInspectionMode("data");
          props.pane.onDataTarget(presentationTarget, mode, kind);
        }
      } else if (mode && props.pane) props.pane.onOpenLens(presentationFocus, mode, kind);
      else {
        setInspectionMode("data");
        props.pane?.onPresentation(kind);
        requestPresentationBody(kind);
      }
    }
    const selectedName = target?.selection?.path.find((step): step is string => typeof step === "string");
    const demoCopy = (current()?.canEdit === true ? undefined : publicDemoCopyBranch(selectedName))
      ?? (target?.item ? listDemoCopy(target.item.id) : undefined) ?? focusDemoCopy();
    return [
      ...(demoCopy ? [{ id: "edit-in-local", label: "Edit in Local", icon: "pencil" as const,
        onSelect: () => editDemoInLocal(demoCopy) }] : []),
      ...(location && props.pane?.onDataTarget ? locusOpenMenuItems(() => props.pane!.onDataTarget!(location, undefined, undefined, navigationIntent(target!.item!)),
        mode => props.pane!.onDataTarget!(location, mode), undefined, elsewhere(scopeFromWorkspace(location.focus), location.source))
        : into ? locusOpenMenuItems(() => openPreview(into),
        props.pane ? mode => { if (props.publicRoot) workspace.request(); props.pane!.onOpenLens(into, mode); } : undefined,
        target?.item ? mode => openInspection(target.item!, mode) : undefined, elsewhere(into)) : []),
      ...(callable && target?.item && into?.kind === "value" ? [{ id: "call", label: "Instantiate function", icon: "play" as const,
        onSelect: () => {
          if (!presentationIsCurrent()) return;
          const root = current();
          if (!root || root.id !== target.rootId || root.revision !== target.revision
            || callablePreviewReference(target.item!) !== callable) {
            setClipboardError("This data changed. Instantiate the current function again."); return;
          }
          retarget({ kind: "call-function", target: into, referenceId: callable, caption: previewCaption(target.item!),
            scope: target.focus, source: target.source, epoch: target.epoch, rootId: root.id, revision: root.revision }, "source");
        } }] : []),
      ...(target?.item ? [{ id: "code", label: "Show Fenel code", icon: "code" as const,
        onSelect: () => { const focus = displayFocus(); retarget({ kind: "show-code",
          itemId: focus.kind === "value" ? focus.itemId : target.item!.id, scope: focus }, "source"); } }] : []),
      ...(props.pane ? [{ id: "representation", label: "Representation", icon: "panels-top-left",
        children: representationOwner() ? [
          ...choices.map(option => ({ id: `representation:${option.value}`, label: option.label,
            icon: option.icon, checked: (!target?.item || currentItem) && inspectionMode() !== "expression" && selectedPresentation === option.value,
            disabled: !!target?.item && !currentItem && (!presentationTarget || !props.pane?.onDataTarget),
            onSelect: () => present(option.value),
            children: [
              { id: `representation:${option.value}:split`, label: "Beside this lens", icon: "layout-grid", onSelect: () => present(option.value, "split") },
              { id: `representation:${option.value}:stack`, label: "Over this lens", icon: "layers", onSelect: () => present(option.value, "stack") },
              { id: `representation:${option.value}:float`, label: "Floating lens", icon: "panels-top-left", onSelect: () => present(option.value, "float") },
            ],
          })),
          { id: "representation:expression", label: "Expression", icon: "route",
            checked: (!target?.item || currentItem) && inspectionMode() === "expression",
            onSelect: () => {
              if (!presentationIsCurrent()) return;
              if (target?.item && !currentItem) openInspection(target.item, "expression"); else setInspectionMode("expression");
            } },
        ] : [{ id: "representation:loading", label: representationFailed() ? "Representations unavailable" : "Loading representations…", disabled: true }] }] : []),
      { id: "data-suggestions", label: "Suggestions", icon: "lightbulb", keepOpen: true, onSelect: () => {
        const root = current();
        if (!target || !root || !presentationIsCurrent()) return;
        if (root.id !== target.rootId || root.revision !== target.revision) {
          setClipboardError("This data changed. Open Suggestions again."); setContextMenu(undefined); return;
        }
        setContextMenu({ ...target, suggestions: true });
        openWorkspace({ kind: "suggest-data", itemId: target.producer || currentItem ? undefined : target.item?.id, scope: target.focus,
          producer: target.producer, producerType: target.producer ? target.item?.valueType : undefined,
          source: target.source, epoch: target.epoch, rootId: root.id, revision: root.revision,
          position: { x: target.x, y: target.y }, selection: target.selection }, true, "source");
      } },
      // On a data, New creates a sibling beside it, so it needs an editable container.
      ...(target?.item && current()?.canEdit !== true ? [] : [locusNewMenu(() => { openCreationPicker(); workspace.request(); },
        (typeName) => {
          const shape = quickValueShape(typeName);
          if (shape && (!props.pane || props.pane.focus().kind === "root")) {
            const at = contextMenu();
            setQuickValue({ typeName, shape, x: at?.x ?? 0, y: at?.y ?? 0, point, epoch: sessionEpoch() });
            // Keep warming in the background: the NEXT thing the user does
            // probably does need the workspace.
            workspace.request();
            return;
          }
          const at = contextMenu();
          retarget({ kind: "new:value", typeName, point, cardAnchor: { x: at?.x ?? 8, y: at?.y ?? 8 },
            ...(at?.item && displayFocus().kind === "root" ? { placement: { afterId: at.item.id } } : {}),
          }, "new");
        }, { beside: !!target?.item, onBranch: pickCreationBranch })]),
      { id: "copy", label: "Copy", shortcut: "Ctrl+C / ⌘C", separatorBefore: true, disabled: true },
      { id: "paste", label: "Paste", shortcut: "Ctrl+V / ⌘V", disabled: readingClipboard() || current()?.canEdit !== true, onSelect: () => { void pasteFromMenu(point); } },
      // Browse and search are the same question asked with and without a
      // query, so they are one entry opening one panel.
      { id: "browse", label: "Browse or search…", separatorBefore: true,
        onSelect: () => {
          if (props.publicRoot) { openWorkspace("browse", true, "browse"); return; }
          setDrawerOpen(true); workspace.request();
        } },
    ];
  }

  createEffect(() => `${sessionEpoch()}:${current()?.id ?? ""}`, (key, previousKey) => {
    if (key !== previousKey) setContextMenu(undefined);
    clipboardRead?.abort();
    setClipboardError(undefined);
  });

  const [inspectionIntent, setInspectionIntent] = createSignal<{
    item: LayoutItem; epoch: number; source: string; origin: LocusScope; target: LocusScope; passive?: boolean;
  }>();
  function openWorkspace(action?: RequestedAction, byUser = true, source: PendingSource = "transfer", origin?: CreationOrigin) {
    setInspectionIntent(undefined);
    const draftAction = action === "new:expression" ? { kind: "new:expression" as const, expr: { kind: "literal" as const, value: undefined } } : action;
    if (source === "new" && props.pane?.source().$tag === "ThisTabSource"
      && (typeof draftAction === "object" && draftAction.kind === "new:expression"
        || draftAction === "new:value" || draftAction === "new:type" || draftAction === "new:function")) {
      props.pane.onCreationDraft?.({ focus: cloneDraftValue(displayFocus()), action: draftAction }, client);
    }
    setRequest({ epoch: untrack(sessionEpoch), action: draftAction, byUser, source,
      ...(source === "new" ? { creationOrigin: origin ?? untrack(creationOrigin) } : {}) });
    const code = props.prepareWorkspace?.() ?? (props.renderWorkspace ? undefined : HomeWorkspace.preload());
    // The lazy owner retains success and permits another acquisition after a
    // refusal. Its mounted Loading/Errored boundary still owns presentation.
    void code?.catch(() => {});
    workspace.request();
  }
  onSettled(() => {
    if (resumedCreation) queueMicrotask(() => {
      if (!client.signal.aborted && client.epoch === untrack(sessionEpoch)) openWorkspace(resumedCreation.action, true, "new");
    });
  });
  function openInspection(item: LayoutItem, mode: DataInspectionMode) {
    const origin = props.pane?.focus() ?? ROOT_SCOPE;
    const target = previewScope(item) ?? origin;
    setInspectionMode(mode);
    const original = focusedPreview()?.original ?? item;
    openPreview(target);
    setInspectionIntent({ item: original, epoch: sessionEpoch(), source: paneSourceKey(), origin, target, passive: true });
  }
  function sameFocus(left: LocusScope, right: LocusScope) {
    return scopeKey(left) === scopeKey(right) && (left.kind !== "value" || right.kind !== "value"
      || !!left.rootItem === !!right.rootItem
        && (left.passThrough?.length ?? 0) === (right.passThrough?.length ?? 0)
        && (left.passThrough ?? []).every((depth, index) => depth === right.passThrough?.[index]));
  }
  createEffect(() => ({ intent: inspectionIntent(), epoch: sessionEpoch(), focus: props.pane?.focus() ?? ROOT_SCOPE,
    mode: inspectionMode(), source: paneSourceKey(), error: workspace.error(), held: heldLiteralInspection() }), state => {
    const intent = state.intent;
    if (!intent) return;
    if (intent.epoch !== state.epoch || intent.source !== state.source || state.error
      || !sameFocus(state.focus, intent.target) && !sameFocus(state.focus, intent.origin)) {
      setInspectionIntent(undefined); return;
    }
    if (intent.passive && state.held) return;
    if (intent.passive && state.mode === "data") { setInspectionIntent(undefined); return; }
    if (!sameFocus(state.focus, intent.target)) return;
    setInspectionIntent(undefined);
    retarget({ kind: "inspect-data", item: intent.item, mode: state.mode, scope: intent.target }, "source");
  });
  createEffect(() => ({ mode: inspectionMode(), held: heldLiteralInspection(), reads: currentReads() }), ({ mode, held, reads }) => {
    // A mode change updates the existing intent once; observing the request
    // here would subscribe this effect to its own replacement below.
    const { pending, epoch } = untrack(() => ({ pending: request(), epoch: sessionEpoch() }));
    if (pending?.epoch === epoch && typeof pending.action === "object" && pending.action.kind === "inspect-data") {
      setRequest({ ...pending, action: { ...pending.action, mode } });
    }
    if (reads && mode !== "data" && !held) workspace.request();
  });
  /** Take back a pending intent and return to the canvas. The modules keep
   *  loading in the background — only the WAIT is cancelled, so a later click
   *  costs less, never more. */
  function cancelRequest(target?: "transfer" | "source" | Event) {
    const pending = request();
    if (target === "transfer") {
      externalImport?.abort();
      discardWorkspaceTransfers(transferOwner);
      externalFallbackTicket = undefined;
      setExternalAdding(false);
      setClipboardError(undefined);
      // The transfer notice has its own Cancel. It must not take back an
      // independent source inspection or creation intent armed afterward.
      if (pending?.byUser && pending.source === "transfer") setRequest(undefined);
      return;
    }
    if (pending?.source === "new") props.pane?.onCreationDraft?.(undefined, client);
    rootShelf?.cancel(props.pane?.id);
    setPickerOpen(false);
    if (pending?.byUser) {
      // A cancelled paste must not reappear when a later New/Browse action
      // finally mounts the workspace and drains its transfer queue.
      if (!readProjection() && pending.source === "source" && hasWorkspaceTransfers(transferOwner)) {
        // Cancelling inspection takes back only the read request. A separate
        // captured paste keeps its own visible progress and cancellation.
        setRequest(client.ingestExternal && !externalFallbackTicket ? undefined
          : { epoch: sessionEpoch(), action: undefined, byUser: true, source: "transfer" });
        return;
      }
      if (!readProjection() && pending.source !== "source") cancelRequest("transfer");
      setRequest(undefined);
    } else if (target !== "source") {
      cancelRequest("transfer");
    }
  }
  /** Re-target a pending intent instead of refusing the click. The workspace
   *  reads the action once at mount, so whichever action is current when it
   *  becomes ready is the one that opens. */
  function retarget(action: RequestedAction, source: PendingSource = "transfer") {
    setPickerOpen(false);
    if (source !== "browse") setDrawerOpen(false);
    openWorkspace(action, true, source);
  }
  let addressHandoff = 0;
  createEffect(() => props.pane?.addressInputs?.()?.id, id => {
    if (id === undefined || id === addressHandoff) return;
    addressHandoff = id;
    // Preparing the reader alone keeps a public data lens on its early read
    // renderer. A named-input URL is an editor intent: use the same retained
    // handoff as other source actions so Home can mount its shared Call form.
    retarget(undefined, "source");
  });
  function chooseBranch(branch: NewBranch, fromCurrentLocation = false) {
    const origin = fromCurrentLocation ? untrack(creationOrigin) : pickerOrigin();
    if (origin && !sameCreationOrigin(origin, untrack(creationOrigin))) { cancelRequest(); return; }
    setPickerOpen(false);
    openWorkspace(branch, true, "new", origin);
  }
  function listDemoCopy(listId: string | undefined) {
    if (current()?.canEdit === true || !listId) return undefined;
    return publicDemoCopyBranch(current()?.lists.find(row => row.id === listId)?.name);
  }
  function focusDemoCopy() {
    if (current()?.canEdit === true) return undefined;
    const focus = displayFocus();
    if (focus.kind === "value") {
      for (const step of focus.path) {
        if (typeof step !== "string") continue;
        const branch = publicDemoCopyBranch(step);
        if (branch) return branch;
      }
    }
    if (focus.kind === "root") return undefined;
    return listDemoCopy(focus.viewId);
  }
  function editDemoInLocal(branch: "new:showcase-demo" | "new:recipe-demo") {
    if (paneSourceKey() === "local") { chooseBranch(branch, true); return; }
    // Opening Local is an address change. A shelf request started from here
    // was dropped when this public page moved to /@fenel.
    armPublicDemoCopy(branch);
    navigate(branch === "new:recipe-demo" ? "/~?new=recipe" : "/~?new=showcase");
  }
  function pickCreationBranch(branch: "new:value" | "new:type" | "new:function" | "new:expression" | "new:showcase-demo" | "new:recipe-demo") {
    // A pending tab root holds its chosen branch until its write verdict; only
    // a refused or foreign source sends the choice to Local through the shelf.
    // A public demo copy always installs in Local.
    if (branch === "new:showcase-demo" || branch === "new:recipe-demo") { editDemoInLocal(branch); return; }
    if (rootShelf && !creationReadAllowed() && !choosesPendingCreation()) {
      const origin = untrack(creationOrigin);
      setPendingPickerChoice(origin);
      setPickerOpen(false);
      queueMicrotask(() => {
        try {
          if (!representationDisposed && !client.signal.aborted && client.epoch === sessionEpoch()
            && sameCreationOrigin(origin, untrack(creationOrigin))) rootShelf.request(branch);
        } finally { setPendingPickerChoice(undefined); }
      });
      return;
    }
    chooseBranch(branch);
  }
  const localRootTransfer = () => prepareOnDemand() && displayFocus().kind === "root"
    && !readProjection() && !!client.ingestExternal;
  async function drainExternalTransfers() {
    if (externalFlight || !localRootTransfer() || client.signal.aborted) return;
    const next = peekWorkspaceTransfers(transferOwner, { resumeInitialLocalRoot: true })[0];
    if (!next || next.ticket === externalFallbackTicket) return;
    externalFlight = true;
    setExternalAdding(true);
    setClipboardError(undefined);
    const epoch = sessionEpoch();
    let cancelledTicket: WorkspaceTransferTicket | undefined;
    try {
      while (transferSurfaceActive && epoch === sessionEpoch() && localRootTransfer()) {
        const entry = peekWorkspaceTransfers(transferOwner, { resumeInitialLocalRoot: true })[0];
        if (!entry || entry.ticket === externalFallbackTicket
          || !claimWorkspaceTransfer(entry.ticket, transferOwner, { resumeInitialLocalRoot: true })) break;
        const controller = new AbortController();
        externalImport = controller;
        try {
          const added = await client.ingestExternal!(entry.snapshot, { signal: controller.signal, onPublished: receipt => {
            acknowledgeWorkspaceTransfer(entry.ticket, transferOwner);
            if (transferSurfaceActive && epoch === sessionEpoch()) {
              setTransferNotes(receipt.notes);
              setTransferFeedback({ sequence: ++transferSequence, complete: true });
              revalidate(["locusRoot", "savedQueries"]);
            }
          } });
          if (!added) {
            releaseWorkspaceTransfer(entry.ticket, transferOwner);
            // Keep this exact head in the general checker lane. A later fast
            // paste neither probes it again nor overtakes its queued data.
            externalFallbackTicket = entry.ticket;
            openWorkspace();
            break;
          }
        } catch (error) {
          releaseWorkspaceTransfer(entry.ticket, transferOwner);
          if (controller.signal.aborted) cancelledTicket = entry.ticket;
          if (transferSurfaceActive && !controller.signal.aborted && epoch === sessionEpoch()) {
            setClipboardError(error instanceof Error ? error.message : "Could not add the pasted data.");
          }
          break;
        } finally { if (externalImport === controller) externalImport = undefined; }
      }
    } finally {
      externalFlight = false;
      if (transferSurfaceActive) setExternalAdding(false);
      // Browser imports can finish after their cancellation signal. A paste
      // received during that retirement still needs its first attempt; only a
      // different queued ticket may restart here, never the failed old head.
      if (cancelledTicket && transferSurfaceActive && epoch === sessionEpoch() && !client.signal.aborted) {
        const waiting = peekWorkspaceTransfers(transferOwner, { resumeInitialLocalRoot: true })[0];
        if (waiting && waiting.ticket !== cancelledTicket && waiting.ticket !== externalFallbackTicket) void drainExternalTransfers();
      }
    }
  }
  function receiveTransfer(snapshot: import("./data-transfer").TransferSnapshot, point?: { x: number; y: number }) {
    setTransferNotes([]);
    setTransferFeedback({ sequence: ++transferSequence, complete: false });
    const direct = localRootTransfer();
    queueWorkspaceTransfer(snapshot, direct ? undefined : destinationId(), point, transferOwner,
      direct ? { initialLocalRoot: true } : undefined);
    if (direct) void drainExternalTransfers();
    else openWorkspace();
  }
  // Revalidate captured browser data against the fresh Local source after the
  // initial cookie handoff. The queue retains data only, never an old reader.
  createEffect(() => ({ epoch: sessionEpoch(), ready: currentReads(), focus: displayFocus(), source: paneSourceKey() }), () => untrack(() => {
    if (localRootTransfer() && peekWorkspaceTransfers(transferOwner, { resumeInitialLocalRoot: true }).length) {
      void drainExternalTransfers();
    }
  }));
  function acceptTransfer(event: ClipboardEvent | DragEvent, transfer: DataTransfer | null) {
    if (accountSelectionPending()) return;
    if (event.defaultPrevented || isNativeEditingTarget(event.target) || !transfer || !isDataTransfer(transfer)) return;
    event.preventDefault();
    event.stopPropagation();
    if (readProjection() || current()?.canEdit !== true) { setClipboardError("This data is read-only here."); return; }
    receiveTransfer(captureDataTransfer(transfer));
  }
  let earlyShellElement: HTMLDivElement | undefined;
  const pasteIntoEmptyView = (event: ClipboardEvent) => {
    if (props.pane && !props.pane.active()) return;
    // Loading can retain this shell while the prepared body is still pending.
    // The mounted DOM determines which document listener owns a body paste.
    if (!earlyShellElement?.isConnected) return;
    if (document.querySelector('.modal-overlay, [role="dialog"]')) return;
    const target = event.target instanceof Element ? event.target : undefined;
    if (target?.closest("[data-fenel-transfer-target]")) return;
    acceptTransfer(event, event.clipboardData);
  };
  document.addEventListener("paste", pasteIntoEmptyView);
  onCleanup(() => document.removeEventListener("paste", pasteIntoEmptyView));

  const needsTypedCanvas = createMemo(() => {
    if (readProjection() || prepareOnDemand()) return false;
    if (!currentReads() || failed()) return false;
    return (current()?.items.length ?? 0) > 0;
  });
  createEffect(needsTypedCanvas, (needed) => {
    if (needed) untrack(() => { if (!requested()) openWorkspace(undefined, false); });
  });
  // Wait for this actual canvas and its toolbar to paint, not only the outer
  // authentication shell. Heavy module evaluation must not overtake the small
  // view responses and hide the New button behind the initial loading screen.
  createEffect(() => ({ ready: !props.navigationRoot && !prepareOnDemand() && currentReads() && !failed(), epoch: sessionEpoch() }), ({ ready, epoch }) => {
    if (!ready) return;
    let second: number | undefined;
    const first = requestAnimationFrame(() => {
      second = requestAnimationFrame(() => {
        if (epoch === sessionEpoch()) workspace.request();
      });
    });
    return () => { cancelAnimationFrame(first); if (second !== undefined) cancelAnimationFrame(second); };
  });

  async function retryReads() {
    const epoch = sessionEpoch();
    setRetryingEpoch(epoch);
    try {
      revalidate("locusRoot");
      await refresh(rootData);
    } finally {
      if (epoch === sessionEpoch()) setRetryingEpoch(undefined);
    }
  }

  const creationReadAllowed = () => current()?.canEdit === true && (!client.rootId || current()?.id === client.rootId);
  // Choosing a kind needs no registry or write verdict. The captured tab
  // transport owns this pending intent; branch/save admission stays below.
  const choosesPendingCreation = () => !currentReads() && props.pane?.source().$tag === "ThisTabSource" && !!client.rootId
    && client.accountId === undefined && !client.signal.aborted;
  const cancelableNew = () => request()?.source === "new" && requested() && currentNewOriginMatches()
    && awaitingWorkspace() && (!currentReads() || creationReadAllowed());
  const currentRequestAction = () => {
    const pending = request();
    const action = pending?.action;
    if (pending && typeof action === "object" && (action.kind === "suggest-data" || action.kind === "call-function")) {
      const root = current();
      return pending.epoch === sessionEpoch() && action.epoch === sessionEpoch() && action.source === paneSourceKey()
        && sameFocus(action.scope, displayFocus()) && root?.id === action.rootId && root.revision === action.revision ? action : undefined;
    }
    return currentNewOriginMatches() ? action : undefined;
  };
  function updateNewExpression(expr: ExprNode) {
    const pending = request();
    if (pending?.source === "new" && typeof pending.action === "object" && pending.action.kind === "new:expression"
      && props.pane?.source().$tag === "ThisTabSource") {
      props.pane.onCreationDraft?.({ focus: cloneDraftValue(displayFocus()), action: { ...pending.action, expr } }, client);
    }
    setRequest(pending => pending && typeof pending.action === "object" && pending.action.kind === "new:expression"
      ? { ...pending, action: { ...pending.action, expr } } : pending);
  }
  createEffect(() => ({ pending: request(), reads: currentReads(), failed: failed(), root: current() }), state => {
    if (state.pending?.source !== "new" || !state.reads) return;
    if (state.failed || !state.root || state.root.canEdit !== true || client.rootId && state.root.id !== client.rootId) {
      if (props.pane?.source().$tag === "ThisTabSource" && props.pane.creationDraft?.()) {
        setClipboardError("This scope cannot create data right now. Your draft is kept here.");
        return;
      }
      // A refused creation says why instead of disappearing.
      if (state.pending?.byUser && !state.failed && state.root && state.root.canEdit !== true)
        setClipboardError("This data is read-only: nothing can be created here.");
      setRequest(undefined); setPickerOpen(false);
    }
  });
  const [enteredWorkspace, setEnteredWorkspace] = createSignal<{ runtime?: ReaderRuntime; epoch: number; source: string }>();
  const workspaceEntered = createMemo(() => {
    const entered = enteredWorkspace();
    return !!entered && entered.runtime === props.readRuntime && entered.epoch === sessionEpoch() && entered.source === paneSourceKey()
      // An entered body holds collection and function pages only: a page a
      // fresh visit paints from the snapshot is painted the same way after it.
      && !publicSnapshotPage();
  });
  const showingWorkspace = createMemo(() => !!(props.pane || requested()) && currentReads() && !failed() && workspace.ready()
    && (!heldLiteralInspection() || requested())
    && !newExpressionRequest()?.checkpoint?.submitted
    && currentNewOriginMatches()
    && (request()?.source !== "new" || creationReadAllowed())
    && (!readProjection() || workspaceEntered() || requested() || inspectionMode() !== "data" || !!props.pane?.subject?.()
      || !!props.pane?.shortcutRequest?.())
    && !focusIntent() && !inspectionIntent() && !typePreviewIntent()
    // Keep the current gesture's menu until dismissal or selection. Suggestions
    // has already captured its action and hands over through the existing path.
    && (!contextMenu() || !!contextMenu()?.suggestions)
    && !pickerOpen() && !quickValue() && !readingClipboard() && !externalAdding()
    && (!drawerOpen() || requested() && request()?.source === "browse") && !savingQuickValue()
    && !((earlyDraftHeld() || earlyPickers() > 0) && dataInspectionPanelVisible(inspectionMode(), "expression")));
  function requestPresentationBody(kind: LocusLayoutChoice) {
    // The public shell owns Data/Desktop previews. Explicit collection layouts
    // use the existing prepared Home body, retaining its reader and read-only
    // source. A pending action or an entered owner already owns that handoff.
    if (!props.publicRoot || kind === "value" || kind === "desktop"
      || untrack(requested) || untrack(workspaceEntered)) return;
    openWorkspace(undefined, true, "source");
  }
  // A separate/addressed lens receives its presentation after the source menu
  // has gone. Acquire its own body only from that published preference.
  createEffect(() => props.pane?.presentation(), kind => {
    if (kind) requestPresentationBody(kind);
  });
  // A public page focused on one collection (a list value such as
  // `/demo/Greek alphabet/Ordered alphabet`, or a root list row) IS its data:
  // the snapshot paints only its compact preview, while its full lens and
  // Representation control are the prepared Home body. Acquire that body, as an
  // explicit collection layout does, once the preview has painted. Landing
  // pages stay snapshot-only: the Fenel root, and records of sections such as
  // `/demo`, `/std` or `/demo/Greek alphabet` (their fields are the cards).
  // A function (`/demo/Recipe functions/Moisturizing-lubrication formula`) is acquired the
  // same way: its graph is the prepared body. When the snapshot carries no value
  // (a read over its transport allowance, such as the people with their
  // pictures), the root read's declared type description says what it is.
  const focusedPublicCollection = createMemo(() => {
    if (!props.publicRoot || !props.pane || !current()) return false;
    const focus = displayFocus();
    if (focus.kind === "view") return true;
    if (focus.kind !== "value" || focusedFields()) return false;
    const focused = focusedPreview();
    if (!focused) return false;
    if (Array.isArray(shellPreview(focused.item))) return true;
    const declared = focused.item.valueType && projectedTypeDescription(focused.item.valueType)?.kind;
    return declared === "list" || declared === "arrow";
  });
  createEffect(() => focusedPublicCollection() && !requested() && !workspaceEntered() && !workspace.error(), acquire => {
    if (!acquire) return;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const frame = requestAnimationFrame(() => {
      timer = setTimeout(() => {
        if (untrack(focusedPublicCollection) && !untrack(requested) && !untrack(workspaceEntered) && !untrack(inspectionIntent))
          openWorkspace(undefined, false, "source");
      }, 0);
    });
    return () => { cancelAnimationFrame(frame); if (timer !== undefined) clearTimeout(timer); };
  });
  // Moving on to a page a fresh visit paints from the snapshot (Demo, the Fenel
  // root, a record) takes that automatic acquisition back. Held, the prepared
  // body evaluated and drew every demo such a page contains: "Demo" in the
  // path dialog froze the tab for minutes (Nov 12). A visitor's own request
  // (a layout, New, Browse, a call) keeps the body; returning to a collection
  // shows the entered body again without a new acquisition.
  createEffect(() => {
    const pending = request();
    return pending?.byUser === false && pending.source === "source" && pending.action === undefined && publicSnapshotPage();
  }, release => { if (release) setRequest(undefined); });
  // The workspace received any handed-over draft with its request. A changed
  // draft left by switching to another lens stays with this owner until the
  // expression lens returns (and Save, Cancel changes or the unload warning).
  createEffect(showingWorkspace, visible => {
    if (visible && (untrack(earlyHandoff) || !untrack(earlyDraftChanged))) setEarlyDraft(undefined);
  });
  // `resumedCreation` reads the lens's retained creation once, at construction.
  // The owner this one replaces (the address preview, which stays shown until
  // this replacement can render) can still retain a choice for the same lens
  // after that read. Adopt such a later draft here, with the visible pending New,
  // so the prepared Home mounts into its editor instead of dropping the choice.
  // A draft written while the prepared Home is shown belongs to that Home.
  createEffect(() => props.pane?.source().$tag === "ThisTabSource" ? props.pane.creationDraft?.() : undefined, draft => {
    if (!draft || client.signal.aborted || client.epoch !== untrack(sessionEpoch) || untrack(showingWorkspace)) return;
    const pending = untrack(request);
    if (pending?.source === "new" && pending.epoch === untrack(sessionEpoch)) return;
    openWorkspace(cloneDraftValue(draft.action), true, "new");
  });
  createEffect(() => ({ visible: showingWorkspace(), runtime: props.readRuntime, epoch: sessionEpoch(), source: paneSourceKey() }), state => {
    if (!state.visible) return;
    const entered = untrack(enteredWorkspace);
    if (entered && entered.runtime === state.runtime && entered.epoch === state.epoch && entered.source === state.source) return;
    setEnteredWorkspace({ runtime: state.runtime, epoch: state.epoch, source: state.source });
  });
  createEffect(() => {
    const runtime = props.readRuntime;
    let session: ReturnType<ReaderRuntime["session"]> | undefined;
    try { session = runtime?.session(); } catch { session = undefined; }
    return { active: graphActive(), selection: graphSelection(), root: current(), node: inspectionProducer()?.node,
      runtime, session, worker: graphWorker(), epoch: sessionEpoch(), handoff: showingWorkspace() };
  }, (state, previous) => {
    // The tracked inputs above own invalidation. Inspect the current run as a
    // snapshot so publishing/clearing that run cannot trigger its own restart.
    const capture = untrack(currentGraphCapture);
    // Loading the observation API publishes this same pending worker token.
    // Keep that run; a genuinely replaced token needs a new current run.
    if (state.active && !state.handoff && capture?.ownerReady && capture.worker === state.worker
      && previous?.selection?.allowed === state.selection?.allowed) return;
    untrack(graphCapture)?.controller.abort();
    setGraphCapture(undefined);
    // Reader readiness and the prepared editor arrive together. Do not start
    // an immediately-disposed held run; the prepared Graph owns that run.
    if (state.active && state.session && !state.handoff) void untrack(captureGraphData);
  });
  // Keep the query when the complete reader replaces the early Browse panel.
  createEffect(() => ({ open: drawerOpen(), ready: workspace.ready(), query: drawerQuery(),
    action: request()?.epoch === sessionEpoch() ? request()?.action : undefined }), (state) => {
    if (state.open && state.ready && (state.action === undefined || state.action === "browse")) {
      retarget({ kind: "browse", query: state.query }, "browse");
    }
  });
  const rootShelf = useWorkspaceRootShelf();
  createEffect(() => props.pane?.id ?? "", (id) => {
    if (!id || !rootShelf || !props.pane) return;
    let registered = true;
    const unregister = rootShelf.register({
      paneId: id,
      sourceKey: paneSourceKey,
      isRoot: () => displayFocus().kind === "root" && !showingWorkspace(),
      isActive: () => !!props.pane!.active() && !showingWorkspace(),
      accountId: () => {
        const source = props.pane!.source();
        return source.$tag === "AccountSource" ? source.accountId : undefined;
      },
      canCreate: creationReadAllowed,
      creationResolved: currentReads,
      canChooseCreation: choosesPendingCreation,
      pendingCreationPicker: () => {
        if (!registered || client.signal.aborted || client.epoch !== sessionEpoch()) return false;
        const origin = pendingPickerChoice() ?? (pickerOpen() ? pickerOrigin() : undefined);
        return !!origin && sameCreationOrigin(origin, creationOrigin());
      },
      run: (action) => {
        if (action === "new:expression") { chooseBranch("new:expression", true); return; }
        if (action === "new:function") { chooseBranch("new:function"); return; }
        if (action === "new:value" || action === "new:type" || action === "new:recipe-demo" || action === "new:showcase-demo") { chooseBranch(action, true); return; }
        if (action === "browse") {
          if (props.publicRoot) { openWorkspace("browse", true, "browse"); return; }
          setDrawerOpen(true); if (!props.navigationRoot) workspace.request(); return;
        }
        openCreationPicker();
        workspace.request();
      },
    });
    return () => { registered = false; unregister(); };
  });
  const pendingShellWork = (home = false) => {
    const expression = newExpressionRequest()?.expr;
    return quickWritePending || readingClipboard() || !!quickValue() || earlyDraftHeld()
    || !readProjection() && hasWorkspaceTransfers(transferOwner) || requested() && request()?.byUser === true && request()?.source !== "source"
      && !(home && request()?.source === "browse")
      // An unopened New/Browse request holds no authored data. Once tools
      // refuse it, reader recovery may retire that intent; actual draft,
      // clipboard and write state retain the independent guards above.
      && !(workspace.error() && (request()?.source === "browse" || request()?.source === "new"
        && (!expression || expression.kind === "literal" && expression.value === undefined)));
  };
  createEffect(() => ({ pane: props.pane, showing: showingWorkspace() }), ({ pane, showing }) => {
    if (!pane || showing) return;
    return pane.registerFlush(async reason => {
      if (!pendingShellWork(reason === "home-check" || reason === "home")) {
        if (reason === "home") {
          setTypePreviewIntent(undefined); setFocusIntent(undefined); setInspectionIntent(undefined);
          setRequest(undefined); setDrawerOpen(false); setContextMenu(undefined); setClipboardError(undefined);
        }
        return true;
      }
      setClipboardError(quickWritePending ? "Wait for this data to finish saving before changing this lens."
        : "Finish or cancel the pending edit or paste before changing this lens.");
      return false;
    }, () => !pendingShellWork());
  });
  const beforeUnload = (event: BeforeUnloadEvent) => {
    // An unsaved early draft lives in this owner only, whichever lens shows.
    if (!earlyDraftHeld() && (showingWorkspace() || !pendingShellWork())) return;
    event.preventDefault(); event.returnValue = "";
  };
  window.addEventListener("beforeunload", beforeUnload);
  onCleanup(() => window.removeEventListener("beforeunload", beforeUnload));

  function HomeToolbar() {
    const sourceIcon = () => props.pane?.source().$tag === "AllDataSource" ? "list"
      : props.pane ? accountDataIcon(props.pane.accounts().find(account => account.id === workspaceSourceKey(props.pane!.source()))) : undefined;
    const scopeThumbnail = (scope: LocusScope) => {
      const typeData = scopeKey(scope) === scopeKey(displayFocus()) ? earlyTypeData() : undefined;
      if (typeData) return <Thumbnail value={typeData} type={{ $type: true }} />;
      if (scope.kind === "root") return <Thumbnail value={undefined} type={current()?.type}
        representations={{ Iconable: { icon: scopeKey(scope) === scopeKey(displayFocus()) ? summaryIcon() : sourceIcon() } }} />;
      if (scope.kind === "view") {
        const item = current()?.items.find(item => item.id === scope.viewId);
        return <Thumbnail value={item ? thumbnailValue(item) : undefined} type={current()?.lists.find(row => row.id === scope.viewId)?.valueType}
          representations={item?.representations} />;
      }
      const projected = previewForScope(scope);
      const original = scope.rootItem ? current()?.items.find(item => item.id === scope.itemId)
        : current()?.lists.find(row => row.id === scope.viewId)?.view.items.find(item => item.id === scope.itemId);
      const fieldIcon = projectedPreviewRepresentation(projected?.fieldId, "Iconable")?.icon;
      return <Thumbnail value={projected ? thumbnailValue(projected.item) : original ? valueAt(thumbnailValue(original), scope.path) : undefined} type={projected?.item.valueType}
        representations={typeof fieldIcon === "string" ? { Iconable: { icon: fieldIcon } } : projected?.item.representations} />;
    };
    const summaryName = (): DisplayNameInput => earlyTypeData() ? previewDisplayName(earlyTypeData(), undefined, "")
      : displayFocus().kind === "root" ? "All data"
      : focusedPreview() ? previewCaptionName(focusedPreview()!.item, "")
      : scopeLabel(displayFocus(), { viewName: id => current()?.lists.find(row => row.id === id)?.name,
        itemName: (_list, id) => current()?.items.find(item => item.id === id)?.caption
          ?? current()?.lists.flatMap(row => row.view.items).find(item => item.id === id)?.caption });
    const summaryPresentation = () => {
      if (earlyTypeData()) return previewValuePresentation(earlyTypeData(), undefined);
      const held = props.pane?.subject?.();
      if (held) return previewValuePresentation(held.data, undefined);
      if (displayFocus().kind === "root") return { icon: sourceIcon() ?? (props.pane?.source().$tag === "AllDataSource" ? "list" : "user"), emoji: undefined };
      const focused = focusedPreview()?.item;
      const own = focused ? previewValuePresentation(thumbnailValue(focused), focused.representations) : undefined;
      const section = sectionPresentation(displayFocus());
      return own || section ? { icon: own?.icon ?? section?.icon, emoji: own?.emoji ?? section?.emoji } : undefined;
    };
    // A section shown as tiles is seen at once: its page has no sentence under
    // the title (its cover on the parent page keeps it).
    const summaryDescription = () => earlyTypeData() || props.pane?.subject?.() || displayFocus().kind !== "value" || memberTiles() ? undefined
      : shownDescription(focusedPreview() ? thumbnailValue(focusedPreview()!.item) : undefined, focusedPreview()?.item.representations, displayFocus());
    const summaryIcon = () => summaryPresentation()?.icon;
    return (<>
        <Show when={props.pane?.summaryMount?.()}>{mount => <Portal mount={mount()}><LensDataSummary
          account={props.pane?.source().$tag !== "AllDataSource" ? props.pane?.sourceLabel() : undefined}
          accountIcon={sourceIcon()}
          name={summaryName()} icon={summaryPresentation()?.icon} emoji={summaryPresentation()?.emoji}
          description={summaryDescription()}
          pending={!currentReads()} typeLabel={earlyTypeData() ? "Type" : focusedPreviewType() ? previewTypeDescription(focusedPreviewType()!).detailLabel || undefined : undefined}
          typeIcon={focusedPreviewType() ? previewTypeDescription(focusedPreviewType()!).icon : undefined}
          typeTerm={focusedPreviewType() ? previewTypeDescription(focusedPreviewType()!).code : undefined}
          typePreview={focusedPreviewType() ? () => previewType(focusedPreviewType()!, displayNameText(summaryName()) ?? "Data", summaryPresentation()?.icon) : undefined}
          onTypeOpen={focusedPreviewType() ? () => openPreviewType(focusedPreviewType()!) : undefined}
          actions={editInLocalShown(!!focusDemoCopy(), undefined) ? () => <LensEditInLocalAction
            onEdit={() => { const next = focusDemoCopy(); if (next) editDemoInLocal(next); }} /> : undefined} /></Portal>}</Show>
        <div class="home-toolbar">
          <Show when={!props.pane}><AccountDataSwitcher disabled={awaitingWorkspace() && pendingSource() !== "source" || pickerOpen() || !!quickValue() || readingClipboard()} /></Show>
          <Show when={!props.pane}><DataInspectionControls mode={inspectionMode()} onModeChange={setInspectionMode} /></Show>
          <Show when={!props.pane && (!currentReads() || awaitingWorkspace())}>
            <span class="home-read-status" role="status" aria-live="polite">
              <span class="home-new-button__spinner" aria-hidden="true" />
              {apiReadConnectionStatus() === "loading" ? "The server is starting…"
                : apiReadConnectionStatus() === "connecting" ? "Connecting to the server…"
                : !currentReads() ? "Loading data…" : workspace.stage() ?? "Preparing editing tools…"}
            </span>
          </Show>
          {/* Keep the wait visible before the wider breadcrumb on phones. */}
          <LocusBreadcrumb scope={displayFocus()} onNavigate={next => openPreview(next)}
            pending={props.pane?.navigationPending?.()}
            renderScopeThumbnail={scopeThumbnail}
            icon={summaryIcon()}
            subjectName={earlyTypeData() ? summaryName() || "Data" : undefined} subjectUnnamed={earlyTypeData() ? !displayNameText(summaryName())?.trim() : undefined}
            rootLabel={props.pane?.sourceLabel()} rootIcon={sourceIcon()}
            onAllData={props.pane?.onAllData ? () => props.pane!.onAllData!() : undefined}
            onOpenAllDataLens={props.pane?.onAllData} allData={props.pane?.source().$tag === "AllDataSource"}
            viewName={id => current()?.lists.find(row => row.id === id)?.name}
            itemName={(_list, id) => current()?.items.find(item => item.id === id)?.caption}
            onOpenLens={props.pane?.onOpenLens}
            typeLabel={focusedPreviewType() ? previewTypeDescription(focusedPreviewType()!).label : undefined}
            typeIcon={focusedPreviewType() ? previewTypeDescription(focusedPreviewType()!).icon : undefined}
            typePreview={focusedPreviewType() ? () => previewType(focusedPreviewType()!, displayNameText(summaryName()) ?? "Data", summaryIcon()) : undefined}
            onTypeOpen={focusedPreviewType() ? () => openPreviewType(focusedPreviewType()!) : undefined} />
          {/* ONE control. Browse is search with an empty query — same rows,
              same universe — so two buttons were one concept twice. The glass
              is the icon; "Browse" is the word, because that is what it does
              before you type anything. */}
          <button type="button" class="btn home-search-trigger home-action-button"
            aria-expanded={drawerOpen() ? "true" : "false"}
            onClick={() => {
              if (props.publicRoot) { openWorkspace("browse", true, "browse"); return; }
              // Opens immediately on the three reads it needs. The workspace is
              // still warmed in the background, because picking a row needs it.
              // Solid 2 writes land on the next microtask: decide from the
              // value written, never from a read right after the write.
              const open = !drawerOpen();
              setDrawerOpen(open);
              if (props.navigationRoot || !open) return;
              workspace.request();
            }}>
            <IconSearch size={16} />
            Browse
          </button>
          <button type="button" class="btn home-new-button home-action-button"
            aria-label="New data"
            disabled={!rootShelf && !cancelableNew() && current()?.canEdit !== true}
            aria-busy={pendingSource() === "new" ? "true" : "false"} aria-expanded={pickerOpen() ? "true" : "false"}
            data-workspace-ready={workspace.ready() ? "true" : "false"}
            data-tooltip={cancelableNew() || current()?.canEdit === true ? undefined
              : rootShelf ? "Create data\nOpen Local to add data."
              : !current() ? "Create data\nLoading data…" : "Create data\nThis data is read-only."}
            onClick={() => {
              // While the picker is open its own overlay covers this button,
              // so ✕/backdrop is the close there; this branch is defensive.
              if (pickerOpen()) { setPickerOpen(false); return; }
              // The branch that matters: after a choice, this button becomes
              // the way OUT of the wait instead of a dead disabled control.
              if (awaitingWorkspace()) { cancelRequest(); return; }
              if (!creationReadAllowed() && rootShelf) { rootShelf.request("new:expression"); return; }
              chooseBranch("new:expression", true);
            }}>
            <Show when={pendingSource() === "new"}><span class="home-new-button__spinner" aria-hidden="true" /></Show>
            <IconPlus size={16} /><span>New</span>
          </button>
          <button type="button" class="btn home-action-button" aria-label="More creation options" data-tooltip="More creation options" aria-haspopup="dialog"
            aria-expanded={pickerOpen() ? "true" : "false"} disabled={awaitingWorkspace()}
            style="padding: 0.25rem 0.4rem; font-size: 0.78rem" onClick={openCreationPicker}>
            <IconByName name="chevron-down" size={16} />
          </button>
          <LocusNotifications notices={notices()} onDismiss={dismissNotice} />
          <Show when={props.pane && !props.pane.toolbarMount?.()}><button type="button" class="workspace-pane__close" aria-label="Close lens"
            onClick={() => props.pane?.onClose()}><IconX size={16} /></button></Show>
        </div>
    </>);
  }
  // The early shell, rendered by this owner's state. It stays on screen while
  // the prepared editor mounts: only the panel that waits shows as pending.
  const earlyShell = () => (
      <div class="home-entry" ref={element => { earlyShellElement = element; }} onPaste={(event) => acceptTransfer(event, event.clipboardData)}
        onDragOver={(event) => { if (!isNativeEditingTarget(event.target) && event.dataTransfer && isDataTransfer(event.dataTransfer)) { event.preventDefault(); event.dataTransfer.dropEffect = "copy"; } }}
        onDrop={(event) => acceptTransfer(event, event.dataTransfer)}>
        <Show when={props.pane?.toolbarMount()} fallback={<HomeToolbar />}>{mount => <Portal mount={mount()}><HomeToolbar /></Portal>}</Show>
        {/* No notice column here. Everything the shell has to report reaches
            the user through the bar's notification affordance, and a pending
            intent reports itself on the control that armed it. */}

        {/* Engine-free: the question opens on the first click. Its ANSWER is
            what waits on the workspace, and it names the editor to open, so the
            workspace mounts straight into that editor. */}
        <Show when={pickerOpen()}>
          <NewItemPickerModal
            onClose={() => setPickerOpen(false)}
            onPickValue={() => pickCreationBranch("new:value")}
            onPickType={() => pickCreationBranch("new:type")}
            onPickFunction={() => pickCreationBranch("new:function")}
            onPickExpression={() => pickCreationBranch("new:expression")}
            onPickFunctionCall={() => {
              setPickerOpen(false);
              // Reuse Browse, whose existing readiness handoff retains its query.
              if (props.publicRoot) { openWorkspace("browse", true, "browse"); return; }
              setDrawerOpen(true);
              if (!props.navigationRoot) workspace.request();
            }}
          />
        </Show>
        <Show when={newExpressionRequest()}>
          <ModalOverlay class="modal-overlay modal-overlay--composer" onClick={event => {
            if (event.target === event.currentTarget) cancelRequest();
          }}>
            <div class="modal-box home-composer-modal" role="dialog" aria-modal="true" aria-label="New data"
              onKeyDown={event => { if (event.key === "Escape") { event.preventDefault(); cancelRequest(); } }}>
              <header class="home-composer-modal__head"><div class="home-composer-modal__head-inner">
                <h3 class="home-composer-modal__title">New data</h3>
                <button type="button" class="workspace-pane__close" aria-label="Close new data" onClick={cancelRequest}><IconX size={16} /></button>
              </div></header>
              <section class="home-composer-modal__scope">
                <h4 class="home-composer-modal__section-title">Scope</h4>
                <LocusBreadcrumb scope={displayFocus()}
                  rootLabel={props.pane?.sourceLabel() ?? "Local"}
                  rootIcon={paneSourceKey() === "local" ? "monitor" : accountDataIcon(props.pane?.accounts().find(account => account.id === paneSourceKey()))}
                  viewName={id => previewLists().find(row => row.id === id)?.name}
                  itemName={(viewId, itemId) => {
                    const row = previewLists().find(row => row.id === viewId);
                    return (row?.view.items ?? current()?.items ?? []).find(item => item.id === itemId)?.caption;
                  }}
                  onNavigate={() => workspace.request()} />
              </section>
              <section class="home-composer-modal__body"><div class="home-composer-modal__main">
                <h4 class="home-composer-modal__section-title">Expression</h4>
                <ExpressionEditor expr={newExpressionRequest()!.expr} onChange={updateNewExpression}
                  graphAuthoring authoringPending hideLabel hideTopLevelAnnotation />
                <Show when={currentReads() && !creationReadAllowed()}><LocusLoadFailure
                  message="This scope cannot create data right now. Your draft is kept here." /></Show>
                <Show when={newExpressionRequest()?.checkpoint?.submitted}><LocusLoadFailure
                  message="Sign-in interrupted this creation. Your draft is kept here."
                  detail={newExpressionRequest()?.checkpoint?.createdValueId
                    ? `Check Local data for ${newExpressionRequest()!.checkpoint!.createdValueId} before creating it again.`
                    : "Check Local data before creating it again; the earlier save may have completed."} /></Show>
                <Show when={workspace.error()}><LocusLoadFailure message="Could not prepare editing tools. Your draft is kept here."
                  detail={workspace.error()!} retry={workspace.retry} retryLabel={workspace.retryLabel?.()} /></Show>
              </div></section>
              <footer class="home-composer-modal__footer">
                <button type="button" class="btn" disabled>Create</button>
              </footer>
            </div>
          </ModalOverlay>
        </Show>
        {/* The shell's own surface. `data-locus-surface` is how a reader — a
            probe, or a person in devtools — tells the two locus surfaces
            apart: they share a toolbar and a stage on purpose, so nothing
            else in the DOM distinguishes them. */}
        <DataInspectionPanels inline mode={inspectionMode()} data={() =>
          <div class="home-stage" data-locus-surface="shell"><div class="home-canvas" tabindex="0" aria-label="Data: paste or drop to add data"
            onContextMenu={tapMenu.onContextMenu} onPointerDown={tapMenu.onPointerDown}
            onPointerMove={tapMenu.onPointerMove} onPointerUp={tapMenu.onPointerUp}
            onPointerCancel={tapMenu.onPointerCancel} onClick={tapMenu.onClick}>
            {/* Edit in Local sits with the value's name, where Save and Discard
                do (owner review, Nov 11): see the summary's actions above. A
                lens without a summary keeps it at the top of its canvas. */}
            <Show when={!props.pane?.summaryMount?.() && focusDemoCopy()}>{_branch => <div style="margin: 0 0 0.75rem">
              <LensEditInLocalAction onEdit={() => { const next = focusDemoCopy(); if (next) editDemoInLocal(next); }} />
            </div>}</Show>
            <Show when={workspace.error() && currentReads() && !failed()}>
              <LocusLoadFailure message="Could not prepare data tools." detail={workspace.error()!}
                retry={workspace.retry} retryLabel={workspace.retryLabel?.()} />
            </Show>
            <Show when={failed()}>
              <LocusLoadFailure message="Could not load data." detail={rootData().unavailable ?? "Your data is unavailable. Please retry."}
                retry={props.pane ? workspace.retry : () => { void retryReads(); }}
                retryLabel={props.pane ? workspace.retryLabel?.() : retrying() ? "Retrying…" : "Retry"} />
            </Show>
            <Show when={props.pane && !currentReads() && !failed()}>
              <Show when={workspaceLoad} fallback={<LensSpinner />}>
                <LensPending id={props.pane?.id ?? "lens"} stage={sharedStartupWait().stage} detail={sharedStartupWait().detail} />
              </Show>
            </Show>
            <Show when={earlyTypeData()}>{type => <div class="home-entry__previews" aria-label="Type data">
              <ValueCard presentation="body" heading={<ValueCardCaption caption={previewLabel(type(), undefined, "")}
                icon={previewTypeDescription(type()).ownIcon} emoji={previewTypeDescription(type()).ownEmoji} typeLabel="Type" typeIcon={TYPE_ICON_FALLBACKS.Type} />}>
                <TypeDataPreviewBody type={type()} describeType={previewTypeDescription}
                  resolveShape={type => "$opaque" in type ? type.$opaque.pure ?? type : type} onOpenType={openPreviewType} />
              </ValueCard>
            </div>}</Show>
            <Show when={!earlyTypeData() && previewItems().length > 0}>
              <div class={["home-entry__previews", {
                "home-grid--desktop": props.pane?.presentation() === "desktop",
                // A record whose fields are the cards (a section such as `/demo`) flows across the
                // width. One focused value, a root list and a list row keep their single column.
                "home-entry__previews--members": !props.pane?.presentation() && displayFocus().kind === "value" && !!focusedFields(),
                "home-entry__previews--tiles": !props.pane?.presentation() && memberTiles(),
                "home-list": props.pane?.presentation() === "list" || !props.pane?.presentation()
                  && (displayFocus().kind === "root" ? current()?.layout.kind === "list" : !focusedFields()),
              }]} data-axis="vertical" aria-label="Loaded data">
                <For each={previewItems()}>{item => {
                  const list = createMemo(() => previewLists().find(row => row.id === item.id && Array.isArray(row.view.items)));
                  const copyBranch = createMemo(() => listDemoCopy(item.id));
                  const fields = createMemo(() => recordPreview(item));
                  // A section shown as a card (not the focused value itself) is a cover: its
                  // name, mark, sentence and field count, without rows of its contents.
                  const cover = createMemo(() => isSectionRecord(item) && !(displayFocus().kind === "value" && !focusedFields()));
                  const section = createMemo(() => sectionPresentation(previewScope(item)));
                  const presented = () => {
                    const own = previewValuePresentation(thumbnailValue(item), item.representations);
                    return { icon: own?.icon ?? section()?.icon, emoji: own?.emoji ?? section()?.emoji };
                  };
                  const content = () => <Show when={list()} fallback={
                    <Show when={fields()} fallback={
                      <Show when={dataTarget(item)} fallback={<Show when={shellPreview(item) !== undefined || props.readRuntime} fallback={<PreviewPending />}><PreviewBody item={item} /></Show>}>
                        <InlinePreview item={item} />
                      </Show>
                    }>{members => <Show when={!cover()} fallback={<span class="home-entry__cover-count">{members().length} {members().length === 1 ? "field" : "fields"}</span>}>
                    <Show when={shellPreview(item) !== undefined || props.readRuntime} fallback={
                      // Before a reader can read the value, the record keeps its per-field strip.
                      <CollectionPreviewStrip items={members()} label={`${previewCaption(item, "Record")}, ${members().length} fields`}
                      countLabel={`${members().length} fields`} itemLabel={member => previewLabel(member.value.kind === "literal" ? member.value.value : undefined, undefined, member.name)}
                      onItemContextMenu={(event, member) => openContextMenu(event, undefined, { parent: item, data: {
                        value: member.value.kind === "literal" ? member.value.value : undefined, label: member.name, caption: member.name,
                        path: [member.name], getType: () => previewFieldType(item, member.name),
                      } })}
                      onEnterCollection={() => { const scope = previewScope(item); if (scope) openPreview(scope); }}
                      render={member => <Thumbnail value={member.value.kind === "literal" ? member.value.value : undefined} type={previewFieldType(item, member.name)} />}
                      preview={member => {
                        const child: LayoutItem = { id: `$field:${member.name}`, caption: member.name,
                          source: { kind: "expr", expr: member.value }, valueType: previewFieldType(item, member.name) };
                        // A record field's name is its code name.
                        return <ValueCard heading={<ValueCardCaption caption={previewDisplayName(thumbnailValue(child), undefined, codeName(member.name))} unnamed={previewUnnamed(child)}
                          icon={previewValuePresentation(thumbnailValue(child), child.representations)?.icon} emoji={previewValuePresentation(thumbnailValue(child), child.representations)?.emoji}
                          typeLabel={previewKind(child, false).label}
                          typeIcon={projectedThumbnailIcon(previewTypeTarget(child.valueType)) ?? previewKind(child, false).icon ?? TYPE_ICON_FALLBACKS.Type} />}>
                          <InlinePreview item={child} />
                        </ValueCard>;
                      }}
                      onOpenItem={member => { const scope = previewScope(item); if (scope?.kind === "value") openPreview({ ...scope, path: [...scope.path, member.name] }); }} />}>
                      {/* Record display rule: the shared typed read owner renders label: value rows. */}
                      <PreviewBody item={item} />
                    </Show></Show>}</Show>
                  }>{row => <CollectionPreviewStrip items={row().view.items} label={`${row().name}, ${row().view.items.length} items`}
                    itemLabel={child => previewCaption(child)}
                    onItemContextMenu={(event, child, index) => openContextMenu(event, undefined, { parent: item, data: {
                      value: shellPreview(child), label: previewCaption(child), caption: child.caption,
                      path: [index], getType: () => child.valueType,
                    } })}
                    onEnterCollection={() => openPreview({ kind: "view", viewId: row().id })}
                    onOpenItem={child => openPreview({ kind: "value", viewId: row().id, itemId: child.id, path: [] })}
                    render={child => <Thumbnail value={thumbnailValue(child)} type={child.valueType} representations={child.representations} />}
                    preview={child => <ValueCard heading={<ValueCardCaption caption={previewCaptionName(child)} unnamed={previewUnnamed(child)}
                      icon={previewValuePresentation(thumbnailValue(child), child.representations)?.icon} emoji={previewValuePresentation(thumbnailValue(child), child.representations)?.emoji}
                      typeLabel={previewKind(child, false).label}
                      typeIcon={projectedThumbnailIcon(previewTypeTarget(child.valueType)) ?? previewKind(child, false).icon ?? TYPE_ICON_FALLBACKS.Type} />}>
                      <InlinePreview item={child} />
                    </ValueCard>} />}</Show>;
                  return <ValueCard presentation={displayFocus().kind === "value" && !focusedFields() ? "body" : undefined}
                    actions={copyBranch() ? <button type="button" class="btn" data-tooltip="Copy this example into Local and edit it there"
                      onClick={event => { event.stopPropagation(); const branch = copyBranch(); if (branch) editDemoInLocal(branch); }}>Edit in Local</button> : undefined}
                    class={`home-entry__preview${props.pane?.presentation() === "desktop" ? " home-item--desktop" : ""}`} itemId={item.id} previewId={item.id} busy={!dataTarget(item) && !list() && !fields() && shellPreview(item) === undefined && !props.readRuntime && !workspace.error()}
                    loadingLabel="Preparing data reader…"
                    onMenu={event => openContextMenu(event)} menuOpen={contextMenu()?.item?.id === item.id}
                    description={displayFocus().kind === "value" && !focusedFields() || memberTiles() ? undefined : shownDescription(thumbnailValue(item), item.representations, previewScope(item))}
                    heading={<ValueCardCaption caption={previewCaptionName(item, list()?.name || "Data")} unnamed={previewUnnamed(item, list()?.name)}
                      icon={presented().icon} emoji={presented().emoji}
                      typeLabel={previewKind(item, !!list()).label} typeIcon={previewKind(item, !!list()).icon}
                      typePreview={item.valueType ? () => previewType(item.valueType!, previewCaption(item, list()?.name || "Data"),
                        previewValueIcon(thumbnailValue(item), item.representations)) : undefined}
                      onTypeOpen={item.valueType ? () => openPreviewType(item.valueType!) : undefined}
                      onOpen={() => { const next = previewScope(item); if (next) openPreview(next); }}
                      onTypeContext={event => openContextMenu(event, "List")} />}
                    onOpen={() => { const next = previewScope(item); if (next) openPreview(next, true); }}>
                    <Show when={props.pane?.presentation() === "desktop"} fallback={content()}>
                      <DesktopDataPreview label={previewCaption(item, list()?.name || "Data")}
                        icon={previewValueIcon(thumbnailValue(item), item.representations)}
                        preview={!list() && hasDataPreview(shellPreview(item)) ? <DataPreview value={shellPreview(item)} /> : undefined}
                        collection={list() || fields() ? content() : undefined}
                        onOpen={() => {
                          if (displayFocus().kind === "value") props.pane?.onPresentation("value");
                          else { const next = previewScope(item); if (next) openPreview(next); }
                        }} />
                    </Show>
                  </ValueCard>;
                }}</For>
              </div>
            </Show>
          </div></div>
        } expression={() => <>
          <Show when={inspectionProducer()} fallback={<Show when={!workspace.error()}><CardLoadingIndicator label="Preparing expression…" /></Show>}>
            {subject => <>
              <Show when={subject().resultPath.length > 0}><p class="text-muted">This expression produces the parent data containing your selection.</p></Show>
              <Show when={heldLiteralInspection() && current()?.canEdit === true && !earlyEditable()}>
                <button type="button" class="btn" onClick={editHeldLiteral}>Edit expression</button>
              </Show>
              <Show when={heldLiteralInspection() && focusDemoCopy()}>{branch =>
                <button type="button" class="btn" data-tooltip="Copy this example into Local and edit it there"
                  onClick={event => { event.stopPropagation(); const next = focusDemoCopy(); if (next) editDemoInLocal(next); }}>Edit in Local</button>}</Show>
              <Show when={!earlyEditable() && !heldLiteralInspection() && !workspace.ready() && !workspace.error()}><span class="text-muted" role="status"
                aria-label="Preparing editing tools…" style="display: inline-flex; align-items: center; gap: 0.4rem;">
                <span class="home-new-button__spinner" aria-hidden="true" />Preparing editing tools…
              </span></Show>
              <Show when={earlyEditable() && (earlyDraftChanged() || earlyHandoff())}>
                <div class="value-expression-dialog__controls" data-early-expression-draft="true">
                  <button type="button" class="btn" onClick={discardEarlyDraft}>Cancel changes</button>
                  <Show when={earlyHandoff()?.commit} fallback={<button type="button" class="btn" onClick={() => handOffEarlyDraft(true)}>Save</button>}>
                    <span class="text-muted" role="status" style="display: inline-flex; align-items: center; gap: 0.4rem;">
                      <span class="home-new-button__spinner" aria-hidden="true" />{workspace.error() ? "Not saved yet: editing tools could not be prepared." : "Saving when ready…"}
                    </span>
                  </Show>
                  <Show when={workspace.ready() && !earlyHandoff()}>
                    <button type="button" class="btn" onClick={() => handOffEarlyDraft(false)}>Continue in full editor</button>
                  </Show>
                </div>
              </Show>
              <ExpressionEditor expr={earlyEditable() ? currentEarlyDraft()?.node ?? subject().node : subject().node}
                onChange={updateEarlyDraft} hideLabel inspection={heldExpressionPresentation}
                graphAuthoring={earlyEditable() ? true : undefined} authoringPending={earlyEditable()}
                onGraphActiveChange={activateGraph} graphCapturePending={!!graphCapturePendingLabel()}
                graphCapturePendingLabel={graphCapturePendingLabel()} />
              <Show when={currentGraphCapture()?.error}>{error => <p class="data-error" role="status">{error()}</p>}</Show>
            </>}
          </Show>
          <Show when={!heldLiteralInspection() && workspace.error()}><LocusLoadFailure message="Could not prepare expression editing." detail={workspace.error()!} retry={workspace.retry} retryLabel={workspace.retryLabel?.()} /></Show>
        </>} code={() => <Show when={workspace.error()} fallback={<CardLoadingIndicator label="Preparing Fenel code…" />}>
          <LocusLoadFailure message="Could not prepare Fenel code." detail={workspace.error()!} retry={workspace.retry} retryLabel={workspace.retryLabel?.()} />
        </Show>}
        suggestions={() => <DataInspectionSuggestionsPanel owner={props.pane?.suggestions?.()}
          visible={dataInspectionPanelVisible(inspectionMode(), "suggestions")} />}
        dependencies={() => <CardLoadingIndicator label="Preparing dependencies…" />} />
        <Show when={drawerOpen()}>
          <LocusBrowse
            query={drawerQuery()}
            onQuery={setDrawerQuery}
            groups={browseGroups()}
            pending={browsePending()}
            pickPending={pendingSource() === "browse"}
            onClose={() => setDrawerOpen(false)}
          />
        </Show>
        <Show when={contextMenu()}><LocusContextMenu x={shownContextMenu()!.x} y={shownContextMenu()!.y}
          opener={shownContextMenu()!.opener}
          label={shownContextMenu()!.suggestions ? "Suggestions" : undefined}
          items={contextItems(shownContextMenu()!.point)} onClose={() => {
            // Closing the menu (a click elsewhere, Escape, a window blur) keeps
            // a captured Suggestions request: its notice reports it with Cancel.
            setContextMenu(undefined);
          }} /></Show>

        <Show when={quickValue()?.epoch === sessionEpoch() ? quickValue() : undefined}>{(quick) => (
          <LocusQuickValue
            typeName={quick().typeName}
            shape={quick().shape}
            x={quick().x}
            y={quick().y}
            onCommit={async (value) => {
              if (quickWritePending) return;
              quickWritePending = true;
              setSavingQuickValue(true);
              try {
                const pinned = await addToLocus({ expr: { kind: "literal", value } }, undefined, quick().point, client);
                if (!pinned) throw new Error("Could not add this data.");
                // The real renderer takes over after this acknowledged write.
                revalidate(["locusRoot", "locusViews", "activeLocusView"]);
                openWorkspace(undefined, false);
              } finally { quickWritePending = false; setSavingQuickValue(false); }
            }}
            onOpenFull={() => {
              if (quickWritePending) return;
              const q = quick();
              setQuickValue(undefined);
              retarget({ kind: "new:value", typeName: q.typeName, point: q.point }, "new");
            }}
            onClose={() => { if (!quickWritePending) setQuickValue(undefined); }}
          />
        )}</Show>
      </div>
  );
  // Mount this boundary with the early shell. Its later prepared-reader
  // handoff keeps the shown lens until the replacement can actually render.
  return (
    <><TransferFeedback sequence={transferFeedback()?.sequence ?? 0} complete={transferFeedback()?.complete} />
    <Loading on={sessionEpoch()} fallback={<LensSpinner />}><Show when={showingWorkspace()} fallback={earlyShell()}>
        {/* The prepared editor's code and first reads load behind the same
            early shell, never behind a whole-lens loader. */}
        <Loading fallback={earlyShell()}>
          <Show when={props.renderWorkspace} keyed fallback={<HomeWorkspace initialAction={currentRequestAction()} />}>
            {render => render(untrack(currentRequestAction))}
          </Show>
        </Loading>
    </Show></Loading></>
  );
}
