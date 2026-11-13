// ---------------------------------------------------------------------------
// /app/home — the customizable, OS-like home page.
//
// One account root contains ordinary Fenel expressions. The breadcrumb is a
// path into that value; account selection changes the authority and root.
// Renderer rows are projections. Canvas positions are authored Placement
// values, and every write preserves its source expression and revision.
// ---------------------------------------------------------------------------

import { For, Show, createContext, createMemo, createProjection, createSignal, createEffect, onSettled, onCleanup, useContext, Loading, Errored, snapshot, refresh, lazy, untrack, latest, isPending } from "solid-js";
import type { JSX } from "@solidjs/web";
import { Portal } from "@solidjs/web";
import { revalidate, useNavigate, useBeforeLeave, useLocation } from "@solidjs/router";
import {
  getTags,
  getIOAction,
  getStopAction,
  getCodeName,
  getLabel,
  getDescription,
  // Phase 3j (module-substrate) — read-time display label with the
  // humanized-codeName / id fallback the loader stopped auto-stamping.
  displayLabel,
  getIcon,
  getEmoji,
  resolveEffect,
  type FenelFunction,
  type FenelType,
  type TypeScheme,
  type TypeConstructorParam,
  type FieldDef,
  Maybe,
  peelMaybe,
  peelList,
  invokeCallable,
  entitySchemaFields,
} from "@fenel/engine";
import { Ref, functionRefHandle } from "@fenel/engine/type-foundation";
import { decodeLocusAddressInputs, encodeLocusAddressInputs, type LocusAddressInput } from "~/lib/locus-address-inputs";
import { guardLeave } from "~/lib/leave-guard";
import { DISPLAY_CATCH_UP_WAIT_MS, settleWithin } from "~/lib/settle-within";
import { getCatalog as workspaceCatalog, getCatalogEntry as workspaceCatalogEntry } from "~/lib/workspace-catalog";
import { accountCatalogLookups, entryToItem } from "~/lib/data-items";
import type { PublicLocusData } from "~/lib/public-locus-data";
import { publicDemoInputProvider } from "~/lib/public-locus-data";
import { getLocusRoot, editLocusRoot, getLocusViews, getActiveLocusView, getSavedQueries, getFunctionByName, getTypeByName, getTypes, getFunctions, getFunctionInstancesById, getInstanceTimeline, api, apiFetch, useApiClient, createAccountApiClient } from "~/lib/api";
import { type DataItem } from "~/lib/data-search";
import { buildDataItems } from "~/lib/data-items";
import { accountFieldRegistry } from "~/lib/account-field-registry";
import { EntityInstancesPanel } from "~/lib/instance-detail/EntityInstancesPanel";
import {
  ExpressionEditor,
  ExpressionTrace,
  SavedValuesContext,
  ActivePickerProvider,
  TypePicker,
  LambdaParamsContext,
  InstanceTraceContext,
  type ExprNode,
  type ExprViewMode,
  type LambdaParam,
  type SavedValueOption,
  type SavedValuesProvider,
  type InstanceTrace,
  type InstanceTraceProvider,
  toLogic,
  evaluateAuthoringExpression as evaluateSessionExpression,
  logicToExprNode,
  DETACHED_AUTHORING_SESSION,
  accountAuthoringSession,
  inferExpressionTypeName,
  inferExpressionType,
  expressionInferenceItem,
  listRefs,
  detectStructuralForm,
} from "~/lib/expression-runner";
import { prepareAuthoringSessionForFunction, authoringSessionAccountScope } from "~/lib/expression-runner/authoring-session";
import { doLetChainAsWhere, heldFunctionLambda, whereEditAsDoLetChain } from "~/lib/expression-runner/expression-structure";
import { functionSignatureOrigins, type FunctionSignatureOrigins } from "~/lib/expression-runner/function-signature-origins";
import { authoringStructureEnvironment, concreteAuthoringSession, localAuthoringScopeForSession,
  publishedAuthoringEnvironment } from "~/lib/expression-runner/account-authoring-session";
import { authoringWorkerRetired, authoringWorkerReplacementPending, authoringWorkerSnapshot, evaluateExpressionInWorker,
  expressionSaveIssueInWorker, inferExpressionsInWorker, preparedReaderWorkerForSession, scopePreparedReaderWorker, runPreparedReaderWorker,
  type PreparedReaderWorker } from "~/lib/expression-runner/authoring-catalog-worker";
import type { AuthoringFunctionDraftInference, AuthoringFunctionBodySaveIssue, AuthoringReaderValueReads } from "~/lib/expression-runner/authoring-worker-protocol";
import { completeLiveDraft, createLocalLiveGuidance, localGuidanceCapture, localGuidanceCurrent } from "~/lib/expression-runner/live-guidance-local";
import { openLocalLiveGuidance, createLocalReaderAnswer, LOCAL_ACTION_CHANGED, loweredLogic, raisedNode, readActionField, readActionResult,
  runLocalReaderAction } from "~/lib/expression-runner/local-reader-actions";
import type { ReaderActionOf, ReaderLensShortcutEdit, ReaderLensShortcutPreparation, ReaderLensShortcutStep,
  ReaderPreparedLensRecipe } from "~/lib/expression-runner/authoring-worker-reader-extensions";
import type { LocalGuidanceCapture } from "~/lib/expression-runner/live-guidance-local";
import type { ReaderCallSignature, ReaderSignatureEdit, ReaderSignatureReconciled } from "~/lib/expression-runner/reader-home-ops";
import { createGuidanceLane, localDraftChecksPending } from "~/lib/expression-runner/live-guidance";
import { WorkerRequestError } from "~/lib/expression-runner/authoring-worker-transport";
import { environmentForCatalog, sessionCatalogSections } from "~/lib/expression-runner/authoring-catalog";
import { isFenelTypeLike, peelListForAuthoring, peelMaybeForAuthoring, peelResultForAuthoring, resolveValueType, detectTypeKind, TYPE_KIND_LABELS } from "@fenel/engine/authoring/type";
import { projectAuthoringScheme, inferAuthoringFunctionDraft, reconcileAuthoringSchemeBody, type AuthoringCatalogFunctionEntry } from "@fenel/engine/authoring/environment";
import { authoringExpressionHasEmptySlot, buildAuthoringSignatureDeclaration, projectAuthoringInferenceOutcome } from "@fenel/engine/authoring/signature-authoring";
import { editAuthoringGenericDeclaration, type AuthoringGenericEdit } from "@fenel/engine/authoring/generic-parameters";
import { reconcileAuthoringBindingRows } from "@fenel/engine/authoring/binding-edits";
import { LambdaFormEditorSurface } from "~/lib/expression-runner/structural-surfaces";
import { GenericParametersEditor } from "~/lib/function-editor/GenericParametersEditor";
import { displayFunctionSignature } from "~/lib/expression-runner/call-display";
import { assertJsonAuthoringValue, carrierTypeName, constructorFieldsForTag, recordFieldsForType, typeCode, typeDisplayName, typePhrase } from "@fenel/engine/authoring/expression";
import "~/lib/home-entry.css";
import { NewItemPickerModal } from "~/lib/new-item-picker";
import { QUICK_TYPE_CATEGORIES, QUICK_TYPE_SUBTYPES } from "~/lib/new-value-types";
import { LocusContextMenu, type LocusMenuItem } from "~/lib/locus-context-menu";
import { LocusQuickValue, quickValueShape, type QuickValueShape } from "~/lib/locus-quick-value";
import { TypeDraftCard, clampCardPosition } from "~/lib/type-draft-card";
import { createTypeDraft, typeDraftWithTypedName, type TypeDraft } from "~/lib/type-draft-save";
import { TypePickerPreferredContext } from "~/lib/type-builder/TypePicker";
import { listedTypeIdentities } from "~/lib/type-builder/type-picker-rows";
import { LocusNotifications, type LocusNotice } from "~/lib/home-entry";
import { LocusLoadFailure, locusNoticeKey } from "~/lib/locus-notifications";
import { LocusBrowse, type BrowseGroup, type BrowsePending, type BrowseRow } from "~/lib/locus-browse";
import { LocusSelect, locusSelectOptions } from "~/lib/locus-select";
import { locusNewMenu, locusOpenMenuItems, locusContextPosition, ownsLocusContextMenu } from "~/lib/locus-menu-actions";
import { createLocusTapMenu } from "~/lib/locus-menu-gesture";
import { armPublicDemoCopy, publicDemoCopyBranch, type HomeAction, type CreationCardAnchor } from "~/lib/home-action";
import { emptyExpressionSlot, expectedTypeForName, seedExpressionForType, expressionForLiteralValue } from "~/lib/expression-runner/creation-seed";
import { draftSaveIssue, draftSaveValidation, functionBodySaveIssue, type CreationValidation } from "~/lib/expression-runner/creation-validation";
import { constructForm } from "~/lib/expression-runner/simple-data-form-model";
import { ValueDisplay } from "~/lib/storybook";
import { confirmDialog, promptDialog, openModalDialog, closeModalDialog, ModalOverlay } from "~/lib/confirm-modal";
import { RepresentationsPanel } from "~/lib/representations/RepresentationsPanel";
import { LUCIDE_ICON_NAMES } from "~/lib/representations/lucide-icon-names";
import { persistRepresentation, persistRepresentations, representationWrites } from "~/lib/representations/persist";
import { TypeBuilder, GenericTypeScopeContext } from "~/lib/type-builder/TypeBuilder";
import type { TypePickerSelection, CaptureTypePickerTarget } from "~/lib/type-builder";
import { TypeContract } from "~/lib/expression-runner/type-contract";
import { FenelCodeEditor } from "~/lib/function-editor/FenelCodeEditor";
import { FunctionCardBody, type FunctionCardType } from "~/lib/function-card-body";
import { RecipeFactsCard } from "~/lib/recipe-facts-card";
import { FunctionGraph } from "~/lib/function-graph";
import { TypeDataPlayground } from "~/lib/type-data-playground";
import { ExpressionDisplay } from "~/lib/expression-builder/ExpressionDisplay";
import { inlineWidgetFor } from "~/lib/expression-runner/inline-widgets";
import { typeToSetExpr } from "@fenel/engine/fenel-check";
import CHECK_DEMO_SOURCE from "../../../../../../fenel/modules/publicdemo/check-demo.fenel?raw";
import PASSWORD_RECORD_DEMO_SOURCE from "../../../../../../fenel/modules/publicdemo/password-record-demo.fenel?raw";
import { StepsEditor } from "~/lib/function-editor/StepsEditor";
import { ConstraintsEditor } from "~/lib/instances/ConstraintsEditor";
import { AuthoringSessionContext, reactiveAuthoringSession, type AuthoringSession } from "~/lib/expression-runner/authoring-session";
import type { ModuleRegistry } from "@fenel/engine/registry";
import {
  FieldAuthoringProvider,
  createFieldResurrectionSelection,
  desiredFieldFacetValues,
  fieldFacetReplacementIds,
  forgetFieldFacetDrafts,
  persistedRootFieldOwner,
  type FieldFacetDraftMap,
} from "~/lib/field-occurrence";
import { displayTypeLabel, FieldRenderer, RecordValuesContext } from "~/lib/field-renderer";
import { incompleteMembershipNote, MembershipHintsView, hintsTooltipText, type MembershipHintSource, type MembershipHintObserver } from "~/lib/field-renderer/refinement-hints";
import {
  ensureUserRegistriesLoaded,
  reloadUserRegistries,
  userFunctions,
} from "~/lib/user-registries";
import { subject, accountSelectionPending } from "~/lib/auth";
import { createViewPersistence } from "~/lib/home-view-persistence";
import { useWorkspaceRootShelf } from "~/lib/workspace-root-shelf";
import { cloneDraftValue, draftValueFingerprint } from "~/lib/native-draft";
import { createIOCallController } from "~/lib/io-call-controller";
import { IconArrowsLeftRight, IconByName, IconSearch, IconSettings, IconStack, LUCIDE_BY_NAME, TYPE_ICON_FALLBACKS } from "~/lib/icons";
import { presentedTypeTarget, typeIconForPresentation } from "~/lib/type-icon-presentation";
import { printFenel } from "@fenel/engine";
import { reachedSavedSources } from "~/lib/expression-runner/expression-evaluation";
import { expressionTextReadability, inspectionFunctionCodeName, inspectionSourceExpression, printAuthoringExpressionText,
  readAuthoringExpressionText } from "~/lib/expression-runner/expression-text";
import { registryTransportSnapshot } from "../../../../../../implementations/typescript/engine/src/registry-transport";
import { createLocalExpressionPrint, createLocalExpressionTyping, readLocalExpressionText,
  type LocalTextRead } from "~/lib/expression-runner/local-expression-text";
import { Anything, Just, List, Nothing, peelMaybeValue, refHandle } from "@fenel/engine/type-foundation";
import { buildSetExpr, peelSetExpr } from "@fenel/engine/set-marker";
import { captureDataTransfer, copyTransferItem, classifyData, ingestTransfer, type TransferItem, type TransferSnapshot } from "~/lib/data-transfer";
import { readClipboardTransfer } from "~/lib/data-transfer/clipboard";
import { transferCommandsFor, type TransferCommands } from "~/lib/data-transfer/commands";
import { inferTransferExpression, prepareTransferItem, scopedConcreteType, transferContainerShape, transferCaptions } from "~/lib/data-transfer/expressions";
import { analyzeWorkspaceTransfer } from "~/lib/data-transfer/session-analysis";
import { DataValueSurface, type ContainedValuePreview, type ValueEdit } from "~/lib/data-transfer/DataValueSurface";
import { TypedReadValue, TypeDataPreview } from "~/lib/layout-renderer";
import { typedReadTypeLabel, typedReadTypePresentation, typedReadValueCaption } from "~/lib/layout-renderer/TypedReadValue";
import { hasDataPreview } from "~/lib/data-transfer/data-preview-shape";
import { DesktopDataPreview } from "~/lib/desktop-data";
import { calendarCellForm, calendarCellRoom, type CalendarCellRoom } from "~/lib/calendar-cell-form";
import { GROUPING_LAYOUT } from "~/lib/grouping-lens";
import { ValueHoverPreview } from "~/lib/value-hover-preview";
import { CardLoadingIndicator, RowPending, CollectionPreviewStrip, DataUnavailable, ListOrderRail, ValueCard, ValueCardCaption, ValueTypeCaption, useValueCardInline, valueCardLabel as locale, valueCardTypeLabel } from "~/lib/value-card";
import { accountDataIcon } from "~/lib/account-data-selector";
import { createFlowCardMotion } from "~/lib/flow-card-motion";
import { CreationScopePath, MoveValueDialog, type MovePlace, type DataDestinationGroup } from "~/lib/move-value-dialog";
import { DependencyGraphHostContext, DependencyGraphPanel, createSourceDependencyGraphData, expressionMentions,
  type DependencyGraphHost, type DependencyGraphProjection, type DependencyGraphValue } from "~/lib/dependency-graph-dialog";
import { assertReaderSourceMetadata, captureReaderSourceMetadata, sourceExecutableSlots, type ReaderSourceMetadataCapture } from "~/lib/reader-source-metadata";
import { dependencyNodeTarget } from "~/lib/dependency-node-target";
import { collectionLinkedGraph, collectionMemberReferences, heldReferences, linkedCardTitle, type HeldReference, type LinkedNode } from "~/lib/linked-data-graph";
import { DisplayNameText } from "~/lib/display-name-text";
import { readLinkedParts, readLinkedValues, type LinkedWalk } from "~/lib/linked-data-graph-query";
import { linkedKind, nameUnnamedLinks } from "~/lib/linked-data-graph-facts";
import { LinkedDataGraph } from "~/lib/linked-data-graph-view";
import { addressInspectionPanels } from "~/lib/address-panels";
import { isDataTransfer, isNativeEditingTarget } from "~/lib/data-transfer/events";
import { isHomeUndoShortcut } from "~/lib/undo-shortcut";
import { readableIdentities } from "~/lib/readable-ids";
import { cardConstructorKey, cardTypeOrdinal } from "~/lib/card-type-ordinal";
import { takeWorkspaceTransfers, workspaceTransferOwner, queueWorkspaceTransfer, claimWorkspaceTransfer,
  acknowledgeWorkspaceTransfer, releaseWorkspaceTransfer, peekWorkspaceTransfers,
  type WorkspaceTransferTicket } from "~/lib/data-transfer/queue";
import { assertCurrentSession, onBrowserSessionChange, sessionEpoch } from "~/lib/browser-session";
import { inferAuthoringExpression } from "@fenel/engine/authoring/expression";

import { createSlicedSearch } from "~/lib/home-search/sliced-search";
import type { ValueSuggestion } from "~/lib/home-search/value-suggestions";
import { localFieldName } from "~/lib/expression-runner/local-field-names";
import { LocusBreadcrumb } from "~/lib/locus-breadcrumb";
import { LensDataSummary, LensEditInLocalAction } from "~/lib/lens-data-summary";
import { dataChangesShown, editInLocalShown } from "~/lib/edit-in-local";
import {
  ROOT_SCOPE, appendValueAt, childrenOf, containerSummary, isEnterable, isLocusSetRef, isReferenceValue,
  locusSetRef, parentScope, removeValueAt, scopeKey, scopeLabel, scopeViewId,
  setValueAt, valueAt,
  type LocusPathStep, type LocusScope, type LocusSetRef,
} from "~/lib/locus-scope";
import { arrange, arrangementOf, readArrangement, writeArrangement } from "~/lib/locus-arrangement";
import { childValueType } from "~/lib/data-transfer/child-type";
import { typeConstructorOf } from "../../../../../../implementations/typescript/engine/src/effect-dispatch";
import { expressionForTransfer } from "~/lib/data-transfer/expressions";
import { followLocusPath } from "~/lib/locus-reference";
import {
  locusCatalogReference, locusCatalogReferenceMetadata, locusCatalogReferenceValue, readLocusCatalogReference,
  resolveLocusCatalogReference, type LocusCatalogAddress, type LocusCatalogCard, type LocusCatalogReference,
  type LocusCatalogResolver, type LocusCatalogLookups,
} from "~/lib/locus-catalog-reference";
import { rootDataRow, type LocusRootCommand } from "~/lib/locus-root-data";
import { LocusLayoutControl } from "~/lib/locus-layout-control";
import { ListTile } from "~/lib/list-tile";
import { listShowsTiles } from "~/lib/list-tile-model";
import { bareConstructorTag } from "~/lib/constructor-presentation";
import { locusLayoutOptions, type LocusLayoutChoice } from "~/lib/locus-layout-options";
import { declaredFieldOrder, groupingEntryKey, groupingTableColumns, groupingTableHeadings, locusTableColumns, projectedTableColumns, readerTypeResolver } from "~/lib/locus-table-columns";
import { GroupingKey } from "~/lib/grouping-read";
import { VirtualTable, type VirtualTableColumn } from "~/lib/virtual-table";
import { tryResolveIdentifiedFieldView } from "@fenel/engine/identified-field-view";
import { canonical } from "@fenel/engine/locale";
import { displayCallableName } from "~/lib/expression-runner/call-display";
import { codeName as codeNameOf, displayNameItemFields, displayNameText, humanName, pickDisplayName, type DisplayName, type DisplayNameInput } from "~/lib/display-name";
import { recordChildNameFields } from "~/lib/layout-renderer/typed-read-field-slots";
import { canvasExpression, canvasSource, entriesCanvasExpression, isCanvasExpression, isEntriesCanvasExpression, isPlacedValue, placedListType, projectPlacedItems, placementFromItem, withCanvasPlacement, withKeyedPlacement } from "~/lib/locus-canvas-data";
import { editableContainerAt, expressionAt, projectAuthoredRead, replaceExpressionAt, appendExpressionAt, removeExpressionAt, retainExpressionChildren, type ExpressionEditOptions } from "~/lib/locus-expression-edit";
import { AccountDataSwitcher, publicDataSelected } from "~/lib/account-data-switcher";
import type { WorkspacePane } from "~/lib/workspace-pane";
import { locusReaderWrites } from "~/lib/locus-reader-writes";
import { savedValueOptions } from "~/lib/locus-expression-sources";
import { ReaderRuntimeProvider, useReaderRuntime, type ReaderRuntime } from "~/lib/reader-runtime";
import { useLocusSynchronization } from "~/lib/locus-synchronization";
import { layoutFromWorkspaceCode, readWorkspaceDataTarget, scopeFromWorkspace, scopeToWorkspace, workspaceSourceKey } from "~/lib/workspace-wire";
import { DataThumbnail, TransferFeedback } from "~/lib/data-transfer/DataPreview";
import { matchesUserQuery } from "~/lib/data-items/user-items";
import { checkLensTypedSubject, prepareLensShortcut, admitLensShortcutResult, lensRecipeArgumentType,
  withLensShortcutArguments, withLensShortcutDisposition, lensTypedSubjectExpression,
  lensTypedSubjectInput,
  type LensShortcut, type LensShortcutInput, type LensSubjectAdmission, type LensTypedSubject } from "~/lib/lens-shortcuts";
import { DeferredCard } from "~/lib/deferred-card";
import { createAsyncValue } from "~/lib/async-value";
import { createLocusCardEvaluation, evaluateLocusCard, readLocusCardResult, readLocusCapturedValue, type LocusCardResult } from "~/lib/locus-card-evaluation";
import { expressionRendersSampledMedia } from "~/lib/saved-expression-identity";
import { savedExpressionDeclaration, shareSavedExpressionMap } from "~/lib/saved-expression-map";
import { publicDataDeclaredScheme } from "~/lib/public-data-declaration";
import { LensSpinner } from "~/lib/loading-screen";
import { createReaderPresentation, ownPresentationFromReaderSnapshot, projectReaderValueReadInSession, type SourceReaderValueReadPacket } from "~/lib/reader-presentation";
import { webRegistry } from "~/lib/web-template-registry";
import { DataInspectionDialog, DataInspectionControls, DataInspectionPanels, DataInspectionSuggestionsPanel, createDataInspectionSuggestions, dataInspectionPanelVisible, toggleDataInspectionPanel, type DataInspectionMode } from "~/lib/DataInspectionDialog";
import type { DataSuggestion, DataSuggestionInput, SuggestionDisposition } from "~/lib/data-suggestions";
import { captureDataOccurrence, type DataOccurrenceSource } from "~/lib/data-occurrence";

function homeAuthoringSession(reader?: ReaderRuntime) {
  if (reader) return reader.session();
  if (publicDataSelected()) return DETACHED_AUTHORING_SESSION;
  const current = subject();
  return current?.$tag === "User" || current?.$tag === "Bot"
    ? accountAuthoringSession({ accountId: current.accountId, functions: userFunctions() })
    : DETACHED_AUTHORING_SESSION;
}

/** B4 F1: the field registry Home hands a renderer. A Local reader passes its
 * own registry by identity with its snapshot (`reader.registry()`); the page
 * session's registry is never read for it. */
function readerFieldOwner(reader: ReaderRuntime | undefined, session: () => AuthoringSession): ModuleRegistry {
  return reader?.kind === "local" ? reader.registry() : session().registry;
}

// A public reader sees only the bundled repository. Never publish that
// registry into account state, or reuse a former account's catalog on logout.
function getCatalog(reader?: ReaderRuntime) {
  if (reader) return reader.catalog();
  return !publicDataSelected() ? workspaceCatalog() : sessionCatalogSections(DETACHED_AUTHORING_SESSION.registry);
}
function getCatalogEntry(id: string, reader?: ReaderRuntime) {
  if (reader) return reader.catalogEntry(id);
  if (!publicDataSelected()) return workspaceCatalogEntry(id);
  return getCatalog().flatMap((section) => section.entries).find((entry) => entry.id === id);
}

/** The Fenel source of a pinned item — the same round trip the expression
 *  editor's code lens uses (ExprNode -> JSON Logic -> text), read-only here.
 *  Everything in the typespace is a value with a type, so everything can be
 *  read as code; this is that view for a card. */
type RenderedCardValue = { value: unknown; source?: ExprNode; sourcePath?: readonly LocusPathStep[] };
/** A collection's linked-data graph, asked once (linked-data-graph-query.ts). */
type LinkedCollectionAsk = { members: readonly HeldReference[];
  /** The reader session the ask was made under: the drawing reads types through it, never a live (pending) one. */
  session: AuthoringSession;
  /** Each member's declared type, from the collection's own type. */
  types: ReadonlyMap<string, FenelType | undefined>;
  read: Promise<{ walk: LinkedWalk; values: ReadonlyMap<string, unknown> }> };
/** `contained`: a value shown inside a card (a synthetic inspection item); its
 * Suggestions make new data from its authored copy, never rewrite it in place. */
type MenuOccurrence = { item: LayoutItem; evaluated: RenderedCardValue; current: () => boolean; contained?: true; openContained?: (mode?: DataInspectionMode) => void };

/** Keep the nearest authored producer and only the path through its result.
 * A computed child cannot be mistaken for a literal expression of its own. */
function projectAuthoredExpression(source: ExprNode, path: readonly LocusPathStep[], options: ExpressionEditOptions): { source: ExprNode; sourcePath: readonly LocusPathStep[] } {
  for (let depth = path.length; depth >= 0; depth--) {
    try {
      return { source: expressionAt(source, path.slice(0, depth), options), sourcePath: path.slice(depth) };
    } catch { /* A computed child retains its enclosing source and result path. */ }
  }
  return { source, sourcePath: path };
}

function itemExpression(item: LayoutItem, savedExprById: Map<string, ExprNode>, session = homeAuthoringSession(),
  evaluated?: RenderedCardValue): ExprNode | null {
  // B4 wave 4 lane H: a Local session's published structure environment.
  return evaluated?.source ?? (evaluated ? expressionForTransfer({ value: evaluated.value, type: item.valueType,
    typeName: classifyData(evaluated.value), source: "fenel" }, authoringStructureEnvironment(session)) : resolveExpr(item, savedExprById));
}

/** Function references expose the admitted declaration's body, never their
 * transport handle, through the same reader that renders the callable.
 * B4 wave 4 lane H: a Local reader's function is its worker's catalogue
 * answer (`reader.catalogLookups`, pending: none yet); its page registry is
 * never read. */
function itemFunction(item: LayoutItem, saved: Map<string, ExprNode>, session: ReturnType<typeof homeAuthoringSession>,
  evaluated?: RenderedCardValue, reader?: ReaderRuntime): FenelFunction | undefined {
  const expr = itemExpression(item, saved, session, evaluated);
  const reference = (expr?.kind === "literal" ? readLocusCatalogReference(expr.value) : undefined)
    ?? readLocusCatalogReference(evaluated?.value);
  if (!reference || reference.kind !== undefined && reference.kind !== "function") return undefined;
  if (reader?.kind === "local") {
    const target = resolveLocusCatalogReference({ ...reference, kind: "function" }, reader.catalogLookups);
    return (target?.callable ?? (target?.kind === "function" ? target.value : undefined)) as FenelFunction | undefined;
  }
  return session.registry.getFunction(reference.id);
}

/** A card holding a type (a catalogue reference to a type or entity): its
 * handle and name. Demo 1 (Nov 8, Rom): a type card's actions ("New Person",
 * "See all Person") live in its right-click menu, never as card buttons. */
function itemTypeReference(item: LayoutItem, saved: Map<string, ExprNode>, session: ReturnType<typeof homeAuthoringSession>,
  evaluated?: RenderedCardValue, reader?: ReaderRuntime): { id: string; name?: string } | undefined {
  const expr = itemExpression(item, saved, session, evaluated);
  // The same resolution the card itself uses (a Local `{ $ref }` names no kind).
  const card = (expr?.kind === "literal" ? catalogCardOf(expr.value, reader) : undefined) ?? catalogCardOf(evaluated?.value, reader);
  if (!card || (card.$pin !== "type" && card.$pin !== "entity")) return undefined;
  return { id: card.id.startsWith("entity:") ? card.id.slice("entity:".length) : card.id, name: card.name };
}

/** A card's printed source, before printing: a final comment, or the source
 * node, its parameters' names and the header comments. B4 wave 4 lane H: a
 * Local reader's function is its worker catalogue's (`itemFunction`), and
 * its body is raised by the session's structure environment (the codec reads
 * no page registry or frame). */
function itemSourcePlan(item: LayoutItem, savedExprById: Map<string, ExprNode>, session: ReturnType<typeof homeAuthoringSession>,
  evaluated?: RenderedCardValue, reader?: ReaderRuntime): { text: string } | { source: ExprNode; boundNames: string[]; header: string } {
  try {
    const expr = itemExpression(item, savedExprById, session, evaluated);
    if (!expr) return { text: "-- this card's reference resolved to nothing" };
    const fn = itemFunction(item, savedExprById, session, evaluated, reader);
    if (fn && fn.body === undefined) return { text: "-- This function is a native declaration; it has no Fenel body." };
    const source = fn ? logicToExprNode(fn.body!, fn.params.map(param => param.name), session) : expr;
    const path = evaluated?.sourcePath;
    const projection = path?.length ? `-- Selected from this expression's result: ${path.map(step => typeof step === "number" ? `item ${step + 1}` : JSON.stringify(step)).join(" → ")}\n` : "";
    const parameters = fn?.params.length ? `-- Parameters: ${fn.params.map(param => param.name).join(", ")}\n` : "";
    return { source, boundNames: fn?.params.map((param) => param.name) ?? [], header: projection + parameters };
  } catch (error) {
    return { text: `-- could not print this data as Fenel: ${(error as Error).message}` };
  }
}

function itemFenelSource(item: LayoutItem, savedExprById: Map<string, ExprNode>, session = homeAuthoringSession(),
  evaluated?: RenderedCardValue, reader?: ReaderRuntime): string {
  const plan = itemSourcePlan(item, savedExprById, session, evaluated, reader);
  if ("text" in plan) return plan.text;
  try {
    const logic = toLogic(inspectionSourceExpression(plan.source, inspectionFunctionCodeName(session)), (id) => savedExprById.get(id), session);
    return plan.header + printFenel(logic as never, undefined, {
      constructorRoutes: session.environment.catalog.exactConstructorRoutes ?? [],
      constructorTargets: session.environment.catalog.patternConstructors ?? [],
      referenceRoutes: session.environment.catalog.referenceRoutes ?? [],
      boundNames: plan.boundNames,
    });
  } catch (error) {
    return `-- could not print this data as Fenel: ${(error as Error).message}`;
  }
}

/** B4 wave 4 lane H: the pending line of a Local card's code (never the
 * failure text while its print is merely being asked). */
const LOCAL_CODE_PENDING = "-- Preparing Fenel code…";
/** A card's "Show code" text for a Local reader: printed in its worker
 * (`print-reader-expression-text`, Inspection presentation: the same lowering,
 * code names and printer routes as `itemFenelSource`), guidance class, asked
 * only while `open()`. Pending shows `LOCAL_CODE_PENDING`; a refusal shows
 * the printer's message. `undefined` for any other reader (it prints on the
 * page). Call inside the card's owner. */
function createLocalItemSource(reader: ReaderRuntime | undefined, session: () => AuthoringSession, open: () => boolean,
  input: () => { item: LayoutItem; saved: Map<string, ExprNode>; evaluated?: RenderedCardValue }): (() => string) | undefined {
  if (reader?.kind !== "local") return undefined;
  const plan = createMemo(() => {
    if (!open()) return undefined;
    const { item, saved, evaluated } = input();
    return { saved, plan: itemSourcePlan(item, saved, session(), evaluated, reader) };
  });
  const printed = createLocalExpressionPrint(() => reader, session, () => {
    const current = plan();
    return current && !("text" in current.plan) ? { node: current.plan.source, lookup: (id: string) => current.saved.get(id),
      boundNames: current.plan.boundNames, presentation: "inspection" as const } : undefined;
  }, { priority: "guidance" });
  return () => {
    const current = plan();
    if (!current) return "";
    if ("text" in current.plan) return current.plan.text;
    const reply = printed.print();
    if (!reply) return LOCAL_CODE_PENDING;
    return reply.$tag === "Err" ? `-- could not print this data as Fenel: ${reply._0}` : current.plan.header + reply._0.text;
  };
}

/** B4 unit D item 2: one `infer-function-draft` reply with `lowerBody`, split
 * into the inference the preview shows and the lowered body Save persists
 * (both from the same request; a reply without the body refuses Save). */
function splitLoweredFunctionDraft(reply: Promise<AuthoringFunctionDraftInference>) {
  const promise = reply.then(({ loweredBody: _body, ...inferred }) => inferred as AuthoringFunctionDraftInference);
  const body = reply.then(result => {
    if (!Object.hasOwn(result, "loweredBody")) throw new Error("The authoring worker response could not be read.");
    return result.loweredBody;
  });
  body.catch(() => {});
  return { promise, body };
}

/** B4 unit D item 2: the registry's `getFunction` answer of a definitions
 * reference reply (`project-reader-references` with `definitions`). */
function readLocalDefinition(reply: unknown): FenelFunction | undefined {
  const references = reply && typeof reply === "object" ? (reply as { references?: unknown }).references : undefined;
  if (!Array.isArray(references) || references.length !== 1 || !references[0] || typeof references[0] !== "object")
    throw new Error("The authoring worker response could not be read.");
  return (references[0] as { reference?: { definition?: { fn?: FenelFunction } } }).reference?.definition?.fn;
}

// B4 wave 4 lane H: a Local reader's signature guards (Home's function and
// type editors: return type, parameter rows, type shape) reconcile in its
// worker (`reconcile-reader-signature`, weight 0), in the draft's own frame;
// the page frame is never read. Two kinds of edit:
// - held (`hold`): a type change is not applied until the worker answers
//   (no "Checking…" hint). It stands on `base` (the slot it replaces): if that
//   moved before the answer is applied, the edit is refused with the existing
//   copy; if only `state` moved (other parts the request reads), it is asked
//   again on the current state. A refusal shows the reconciler's own message;
// - followed (`follow`): text the user types (a parameter's name) is applied at
//   once and only the body's reconciliation waits; the latest state is sent,
//   an answer for an older state is dropped and asked again, never applied.
// Followed reconciliation runs before any held edit. `pending()` is true while
// any edit waits (Save refuses with the existing copy); `issue()` is a
// followed edit's refusal, until a later edit settles. States compare by
// content (`draftValueFingerprint`), never by a transport copy's identity.
type LocalSignatureJob = { base: () => readonly unknown[]; state: () => readonly unknown[];
  edit: () => ReaderSignatureEdit | undefined; apply: (reconciled: ReaderSignatureReconciled) => void };
function createLocalSignatureGuard(options: { reader: () => ReaderRuntime | undefined; session: () => AuthoringSession;
  via: () => AuthoringSession | undefined; closed: () => boolean; refuse: (message: string) => void }) {
  const [pending, setPending] = createSignal(false);
  const [issue, setIssue] = createSignal<string>();
  const held: LocalSignatureJob[] = [];
  let followed: LocalSignatureJob | undefined;
  /** A followed edit whose request failed for want of the worker: asked again at `retry()` (Save). */
  let retained: LocalSignatureJob | undefined;
  /** The last followed edit, read after a held edit applies (is the shown state reconciled now?). */
  let lastFollow: LocalSignatureJob | undefined;
  let draining = false;
  /** Save waits here for the pending check instead of refusing (`settled()`). */
  let settledWaiters: Array<() => void> = [];
  const busy = () => draining || held.length > 0 || !!followed;
  const print = (values: readonly unknown[]) => draftValueFingerprint(values);
  const failure = (error: unknown) => error instanceof Error ? error.message : String(error);
  const ask = async (edit: ReaderSignatureEdit) => {
    const via = latest(options.via);
    if (!via) throw new Error(LOCAL_SAVE_TOOLS_PENDING);
    return runLocalReaderAction(options.reader(), options.session, { method: "reconcile-reader-signature", edit },
      readActionResult<ReaderSignatureReconciled>("reconciled", value => !!value && typeof value === "object"
        && !!(value as { scheme?: unknown }).scheme), { via });
  };
  async function settleFollowed(job: LocalSignatureJob) {
    lastFollow = job;
    // Async preview work may still hold the graph's committed version after
    // a timer. Read the in-flight draft at each imperative queue boundary.
    const state = latest(() => print(job.state()));
    try {
      const edit = latest(job.edit);
      if (!edit) { setIssue(undefined); return; }
      const answer = await ask(edit);
      if (options.closed()) return;
      // A newer edit (or another change) is asked next; this answer is dropped.
      if (followed || latest(() => print(job.state())) !== state) { followed ??= job; return; }
      // A refusal shows where the editor's errors show, and Save refuses with it.
      if (answer.$tag === "Err") { setIssue(answer._0); options.refuse(answer._0); }
      else { setIssue(undefined); latest(() => job.apply(answer._0)); }
      // The applied writes land before the next edit reads the state.
      await Promise.resolve();
    } catch (error) {
      if (options.closed() || followed) return;
      if (error instanceof Error && error.message === LOCAL_ACTION_CHANGED) { followed = job; return; }
      // Transient (no worker yet, a failed request): kept, and asked again at Save.
      retained = job;
      setIssue(failure(error));
      options.refuse(failure(error));
    }
  }
  async function settleHeld(job: LocalSignatureJob) {
    // The slot as this edit leaves the queue: an earlier held edit's result
    // is the state it applies on (the latest pick wins).
    const at = latest(() => print(job.base()));
    for (let moves = 0; ;) {
      if (latest(() => print(job.base())) !== at) { options.refuse(LOCAL_SAVE_CHANGED); return; }
      const state = latest(() => print(job.state()));
      let answer: Awaited<ReturnType<typeof ask>>;
      try {
        const edit = latest(job.edit);
        if (!edit) { options.refuse(LOCAL_SAVE_CHANGED); return; }
        answer = await ask(edit);
      } catch (error) {
        if (options.closed()) return;
        // The reader moved while answering: ask again (a bounded number of times).
        if (error instanceof Error && error.message === LOCAL_ACTION_CHANGED && ++moves < 3) continue;
        options.refuse(failure(error)); return;
      }
      if (options.closed()) return;
      if (latest(() => print(job.base())) !== at) { options.refuse(LOCAL_SAVE_CHANGED); return; }
      // A name edit is reconciled first; then (as after any other change the
      // request read, such as body typing) this edit is asked again on it.
      if (followed || latest(() => print(job.state())) !== state) { if (followed) await settleFollowed(takeFollowed()); continue; }
      if (answer.$tag === "Err") { options.refuse(answer._0); return; }
      latest(() => job.apply(answer._0));
      await Promise.resolve();
      // The applied edit may have reconciled a followed one as well.
      if (lastFollow && !latest(lastFollow.edit)) { setIssue(undefined); retained = undefined; }
      return;
    }
  }
  const takeFollowed = () => { const job = followed!; followed = undefined; return job; };
  async function drain() {
    if (draining) return;
    draining = true;
    setPending(true);
    try {
      while (!options.closed() && (held.length || followed)) {
        if (followed) await settleFollowed(takeFollowed());
        else await settleHeld(held.shift()!);
      }
    } finally {
      draining = false;
      setPending(!options.closed() && (!!held.length || !!followed));
      if (options.closed() || !busy()) { const waiters = settledWaiters; settledWaiters = []; for (const resolve of waiters) resolve(); }
    }
  }
  return {
    pending, issue,
    /** Same-tick truth of `pending()`: a follow or hold in this event counts. */
    busy,
    /** Resolves once every queued check has been answered (or the editor closed);
     * the reconciled draft and any refusal (`issue()`) are then current. */
    settled(): Promise<void> {
      if (options.closed() || !busy()) return Promise.resolve();
      return new Promise(resolve => { settledWaiters.push(resolve); });
    },
    hold(job: LocalSignatureJob) {
      held.push(job); setPending(true);
      // A held type pick can follow a name write in the same event. Let that
      // write land before draining its followed reconciliation first.
      queueMicrotask(() => void drain());
    },
    /** Ask a followed edit that failed for want of the worker again; true when one was asked. */
    retry(): boolean {
      if (!retained) return false;
      followed = retained; retained = undefined;
      setPending(true); void drain();
      return true;
    },
    // After the editor's own change has landed (and a burst of keystrokes has
    // ended): the request reads the shown state.
    follow(job: LocalSignatureJob) { followed = job; setPending(true); setTimeout(() => void drain(), 0); },
  };
}
/** Only a parameter's text (its name or label) differs: typed text is applied
 * at once and only the body's reconciliation waits. */
function parameterTextEdit(current: readonly FieldDef[], next: readonly FieldDef[]): boolean {
  if (current.length !== next.length) return false;
  const shape = ({ name: _name, label: _label, ...rest }: FieldDef) => draftValueFingerprint(rest);
  return current.some((field, index) => field !== next[index])
    && current.every((field, index) => field === next[index] || shape(field) === shape(next[index]!));
}

/** B4 wave 4 lane H: catalogue references for a Local reader, as the page
 * resolved them with its registry and frame (`getFunction`,
 * `_typeFamilyOwner`, `getIdentifiedEntity`), answered by its worker
 * (`project-reader-references`). `settle(compute)` runs `compute` until every
 * reference it reads is answered (asking the worker for the ones it missed);
 * afterwards `resolve` keeps those answers and reads any other id from the
 * reader's live lookups (a display read: pending is no reference). */
function localReferenceResolver(reader: ReaderRuntime, session: () => AuthoringSession) {
  const answers = new Map<string, { fn?: unknown; typeFamilyOwner?: unknown; entityType?: FenelType } | null>();
  let missing: Set<string> | undefined;
  const read = <K extends "fn" | "typeFamilyOwner" | "entityType">(key: K) => (id: string) => {
    if (answers.has(id)) return answers.get(id)?.[key];
    if (missing) { missing.add(id); return undefined; }
    return reader.catalogLookups[key]?.(id);
  };
  const lookups: LocusCatalogLookups = { fn: read("fn"), typeFamilyOwner: read("typeFamilyOwner") as LocusCatalogLookups["typeFamilyOwner"],
    entityType: read("entityType") as LocusCatalogLookups["entityType"], entry: id => reader.catalogLookups.entry(id) };
  return {
    resolve: (reference: LocusCatalogReference) => resolveLocusCatalogReference(reference, lookups),
    async settle<T>(compute: () => T): Promise<T> {
      for (let round = 0; round < 16; round++) {
        const seen = new Set<string>();
        missing = seen;
        let value: T | undefined, refusal: { error: unknown } | undefined;
        // A read that missed an answer can refuse (`followLocusPath` throws on
        // an unresolved reference): ask for what it missed, then run again.
        try { value = compute(); } catch (error) { refusal = { error }; } finally { missing = undefined; }
        const asked = [...seen];
        if (!asked.length) { if (refusal) throw refusal.error; return value as T; }
        const references = await runLocalReaderAction(reader, session, { method: "project-reader-references", targets: asked }, reply => {
          const rows = reply && typeof reply === "object" ? (reply as { references?: unknown }).references : undefined;
          if (!Array.isArray(rows) || rows.length !== asked.length) throw new Error("The authoring worker response could not be read.");
          return rows as Array<{ target: string; reference?: { fn?: unknown; typeFamilyOwner?: unknown; entityType?: FenelType } }>;
        });
        for (const [index, target] of asked.entries()) answers.set(target, references[index]?.target === target ? references[index]!.reference ?? null : null);
      }
      throw new Error("This data's references could not be read.");
    },
  };
}
/** B4 wave 4 lane H: a Local reader's identified field icon (Home's
 * breadcrumb), answered by its worker (`project-reader-call-signature` with
 * `fieldIcons`: `getFieldRepresentation("Iconable", id)`), cached per worker
 * snapshot and reader revision. Reactive: the first read asks; pending and
 * failed show no icon (the thumbnail's own glyph). */
const localFieldIconCaches = new WeakMap<object, { revision: number; icons: Map<string, string | null>; version: () => number; bump: () => void }>();
function localFieldIcon(reader: ReaderRuntime, session: AuthoringSession, fieldId: string): string | undefined {
  let snapshot: object | undefined;
  try { snapshot = authoringWorkerSnapshot(session); } catch { snapshot = undefined; }
  if (!snapshot) return undefined;
  const revision = reader.revision();
  let cache = localFieldIconCaches.get(snapshot);
  if (!cache || cache.revision !== revision) {
    const [version, setVersion] = createSignal(0);
    cache = { revision, icons: new Map(), version, bump: () => setVersion(value => value + 1) };
    localFieldIconCaches.set(snapshot, cache);
  }
  cache.version();
  if (cache.icons.has(fieldId)) return cache.icons.get(fieldId) ?? undefined;
  const own = cache;
  own.icons.set(fieldId, null);
  void runLocalReaderAction(reader, () => session, { method: "project-reader-call-signature", fieldIcons: [fieldId], priority: "guidance" },
    reply => {
      const icons = reply && typeof reply === "object" ? (reply as { fieldIcons?: unknown }).fieldIcons : undefined;
      if (!Array.isArray(icons) || icons.length !== 1) throw new Error("The authoring worker response could not be read.");
      const icon = (icons[0] as { icon?: unknown } | undefined)?.icon;
      return typeof icon === "string" ? icon : undefined;
    }).then(icon => { if (icon !== undefined) { own.icons.set(fieldId, icon); own.bump(); } },
    // A moved capture asks again on the next read.
    (error: unknown) => { if (error instanceof Error && error.message === LOCAL_ACTION_CHANGED) { own.icons.delete(fieldId); own.bump(); } });
  return undefined;
}
/** B4 wave 4 lane H: an IO call card's argument for a Local reader, evaluated
 * in its worker (`evaluate-expression` with `admitInvocations`, as the Call
 * form's Run); the page frame is never read. Without a prepared worker it
 * refuses with the existing tools copy; the worker's own refusal is its
 * message. */
async function localIOArgument(session: AuthoringSession, arg: ExprNode, saved: ReadonlyMap<string, ExprNode>,
  priority?: "guidance"): Promise<unknown> {
  const job = evaluateExpressionInWorker(session, arg, saved, undefined, undefined, { admitInvocations: true, ...(priority ? { priority } : {}) });
  if (!job) throw new Error(LOCAL_SAVE_TOOLS_PENDING);
  return (await job).result;
}
/** B4 wave 4 lane H: a call signature reply (`project-reader-call-signature`). */
function readLocalCallSignature(reply: unknown): ReaderCallSignature {
  const signature = reply && typeof reply === "object" ? (reply as { callSignature?: unknown }).callSignature : undefined;
  const value = signature as ReaderCallSignature | undefined;
  if (!value || typeof value !== "object" || !Array.isArray(value.params) || !Array.isArray(value.schemes)
    || value.schemes.some(entry => !entry || typeof entry !== "object"))
    throw new Error("The authoring worker response could not be read.");
  return value;
}
/** B4 wave 4 lane H: a `handles` reply (`project-reader-call-signature`). */
function readLocalHandles(reply: unknown): Array<string | undefined> {
  const handles = reply && typeof reply === "object" ? (reply as { handles?: unknown }).handles : undefined;
  if (!Array.isArray(handles) || handles.some(entry => !entry || typeof entry !== "object"
    || (entry as { handle?: unknown }).handle !== undefined && typeof (entry as { handle?: unknown }).handle !== "string"))
    throw new Error("The authoring worker response could not be read.");
  return handles.map(entry => (entry as { handle?: string }).handle);
}

/** B4 wave 4 lane H: Browse's value half for a Local reader, in its worker
 * (`query-reader-value-search`, guidance class, latest wins). Only the items
 * `buildValueCandidates` reads are sent (it skips functions and untyped
 * items). A yielded answer, or one asked under a moved reader, is asked
 * again; any other failure answers no values. */
async function localValueSearch(reader: ReaderRuntime, session: () => AuthoringSession, query: string, items: DataItem[],
  signal: AbortSignal): Promise<readonly ValueSuggestion[]> {
  const request = { method: "query-reader-value-search" as const, query, priority: "guidance" as const,
    items: items.filter(item => item.type && item.kind !== "function") };
  for (;;) {
    try {
      const reply = await runLocalReaderAction(reader, session, request, answer => answer, { signal });
      if (Object.hasOwn(reply, "yielded")) continue;
      const matches = (reply as { matches?: unknown }).matches;
      if (!Array.isArray(matches)) throw new Error("The authoring worker response could not be read.");
      return matches as ValueSuggestion[];
    } catch (error) {
      if (!signal.aborted && error instanceof Error && error.message === LOCAL_ACTION_CHANGED) continue;
      throw error;
    }
  }
}

/** Every live value belongs to the same account authority as its editor. */
function evaluateAuthoringExpression(...args: Parameters<typeof evaluateSessionExpression>) {
  return evaluateSessionExpression(args[0], args[1], args[2] ?? homeAuthoringSession(), args[3]);
}

/** B4 slice 1: a Local reader's Save-time admission runs in that reader's own
 * worker (`expression-save-issue`: the existing `draftSaveIssue`, with the
 * page's evaluation moved into the same request when `evaluate` is set). It
 * never reads the page session's registry or evaluator. Fail closed: no
 * worker, a pending replacement, a worker failure, or a reply whose epoch,
 * reader revision, concrete session, worker snapshot, source metadata or
 * submitted draft no longer holds refuses Save and keeps the draft; there is
 * no page fallback. The reply is advisory: writes keep the source's CAS. */
const LOCAL_SAVE_TOOLS_PENDING = "This reader's editing tools are not ready. Try again after preparation.";
const LOCAL_SAVE_CHANGED = "This data changed while preparing the edit. Try again with its current contents.";
const LOCAL_SAVE_DRAFT_CHANGED = "The draft changed while it was being checked. Save again.";
const LOCAL_SAVE_UNCHECKABLE = "This value cannot be checked for saving.";
type LocalSaveAdmission = NonNullable<Parameters<typeof expressionSaveIssueInWorker>[3]> & {
  reader: ReaderRuntime; session: () => AuthoringSession; saved: ReadonlyMap<string, ExprNode>;
  /** The site's own currentness (dialog, draft, destination), checked after the reply. */
  current?: () => void; signal?: AbortSignal;
  /** B4 fix round 2: the surface whose pending nested value checks refuse this Save. */
  draftScope?: object;
};
async function localExpressionSaveIssue(node: ExprNode, admission: LocalSaveAdmission): Promise<string | undefined> {
  const { saved, ...options } = admission;
  return localWorkerSaveIssue(node, admission, (facade, sourceMetadata, signal) => expressionSaveIssueInWorker(facade, node, saved,
    { ...localSaveIssueOptions(options), ...(sourceMetadata ? { sourceMetadata } : {}) }, signal));
}
function localSaveIssueOptions(options: Omit<LocalSaveAdmission, "saved">) {
  const { reader: _reader, session: _session, current: _current, signal: _signal, draftScope: _draftScope, ...rest } = options;
  return rest;
}
/** B4 slice 2: a function body's Save check (`function-body-save-issue`, the
 * operation the Function editor's Save already uses) with the same captures. */
async function localFunctionBodySaveIssue(node: ExprNode, definition: FenelFunction,
  admission: Pick<LocalSaveAdmission, "reader" | "session" | "current" | "signal" | "draftScope">): Promise<string | undefined> {
  return localWorkerSaveIssue(node, admission, (facade, sourceMetadata, signal) => {
    const handle = preparedReaderWorkerForSession(facade);
    if (!handle) return undefined;
    const rootDeclaration = savedExpressionDeclaration(node);
    return runPreparedReaderWorker(handle, { method: "function-body-save-issue", node, definition,
      ...(rootDeclaration ? { rootDeclaration } : {}), ...(sourceMetadata ? { sourceMetadata: sourceMetadata.packet } : {}) }, signal)
      .then(reply => reply as AuthoringFunctionBodySaveIssue);
  });
}
async function localWorkerSaveIssue(node: ExprNode, admission: Pick<LocalSaveAdmission, "reader" | "session" | "current" | "signal" | "draftScope">,
  send: (facade: AuthoringSession, sourceMetadata: ReturnType<typeof captureReaderSourceMetadata>, signal?: AbortSignal)
    => Promise<AuthoringFunctionBodySaveIssue> | undefined): Promise<string | undefined> {
  const { reader, session, current, signal, draftScope } = admission;
  signal?.throwIfAborted();
  // B4 fix round 2: a nested value still being checked has cleared its slot;
  // saving now would persist the cleared slot (this surface's checks, or an
  // unscoped check of this reader's source).
  if (localDraftChecksPending(draftScope, reader)) throw new Error(LOCAL_SAVE_DRAFT_CHANGED);
  const epoch = sessionEpoch();
  const captured = latest(() => {
    const facade = session();
    const concrete = concreteAuthoringSession(facade);
    let worker: object | undefined;
    try { worker = authoringWorkerReplacementPending(concrete) ? undefined : authoringWorkerSnapshot(concrete); }
    catch { worker = undefined; }
    return { facade, concrete, worker, revision: reader.revision() };
  });
  if (reader.kind !== "local" || !captured.worker) throw new Error(LOCAL_SAVE_TOOLS_PENDING);
  const sourceMetadata = captureReaderSourceMetadata(captured.facade);
  const fingerprint = draftValueFingerprint(node);
  const job = send(captured.facade, sourceMetadata, signal);
  if (!job) throw new Error(LOCAL_SAVE_TOOLS_PENDING);
  let reply: Awaited<typeof job>;
  try { reply = await job; }
  catch (error) {
    // Structured clone refused the request: the draft holds a host value.
    if (error instanceof Error && error.name === "DataCloneError") throw new Error(LOCAL_SAVE_UNCHECKABLE);
    throw error;
  }
  assertCurrentSession(epoch);
  signal?.throwIfAborted();
  latest(() => {
    let tools = false;
    try {
      tools = concreteAuthoringSession(session()) === captured.concrete && authoringWorkerSnapshot(captured.concrete) === captured.worker;
    } catch { tools = false; }
    // A replaced session or worker is preparing again; a newer revision is new data.
    if (!tools) throw new Error(LOCAL_SAVE_TOOLS_PENDING);
    if (reader.revision() !== captured.revision) throw new Error(LOCAL_SAVE_CHANGED);
    if (draftValueFingerprint(node) !== fingerprint) throw new Error(LOCAL_SAVE_DRAFT_CHANGED);
    if (sourceMetadata) assertReaderSourceMetadata(sourceMetadata, captured.facade);
    current?.();
  });
  return reply.issue;
}

// ---------------------------------------------------------------------------
// The layout value model and `addToLocus` now live in `~/lib/locus-view-model`,
// which imports nothing from the engine — that is what lets the SHELL pin a
// value before the typed workspace exists. Re-exported here so every existing
// reference in this file and its importers is unchanged.
export { addToLocus, asView, genId, clamp01, appendTreeChild, EMPTY_CANVAS } from "~/lib/locus-view-model";
export type {
  PlacementHint, ItemSource, LayoutItem, TreeItem, AnyView, LocusViewRow,
  CanvasView, ListView, TableView, GridView, TreeView, TabsView, CalendarView, TimelineView, MapView,
} from "~/lib/locus-view-model";
import {
  addToLocus, asView, genId, clamp01, appendTreeChild, EMPTY_CANVAS,
} from "~/lib/locus-view-model";
import type {
  PlacementHint, ItemSource, LayoutItem, TreeItem, AnyView, LocusViewRow,
  CanvasView, ListView, TableView, GridView, TreeView, TabsView, CalendarView, TimelineView, MapView, ChartView,
} from "~/lib/locus-view-model";
import { BarChart } from "~/lib/charts";

// Layout value shapes
// ---------------------------------------------------------------------------

/** Reference to another value or a literal expression — both forms allowed
 *  per item. A ref points at a savedQueries row by id; the renderer
 *  resolves it at render time so edits propagate everywhere. Inline expr
 *  is for ad-hoc "pin this one-off" cases. */

// ---------------------------------------------------------------------------
// Ops panel — per-card "what functions can I run with this value?". Filters
// the catalog to functions whose first parameter accepts the same type the
// card's value carries (Id<X> phantom matches, or $named equality, or a
// $maybe relaxation). Renders one button per match. Click invokes via the
// existing /io/invoke endpoint with the card's runState value as the first
// arg; functions with extra params get default-seeded values for the rest.
// ---------------------------------------------------------------------------

type CatalogFn = { fn: FenelFunction; codeName: string; label?: string };

const cachedCatalogFns = new WeakMap<object, { revision: number; rows: CatalogFn[] }>();

function allCatalogFns(reader?: ReaderRuntime): CatalogFn[] {
  const catalog = getCatalog(reader);
  const revision = reader?.revision() ?? 0;
  const cached = cachedCatalogFns.get(catalog);
  if (cached?.revision === revision) return cached.rows;
  // Keep each committed registry's projection separate, including refreshed
  // snapshots for the same account. Importing Home never builds the catalog.
  const out: CatalogFn[] = [];
  for (const section of catalog) {
    if (section.id !== "function") continue;
    for (const entry of section.entries) {
      const fn = entry.entity ? null : (entry as { fn?: FenelFunction }).fn;
      if (!fn) continue;
      const codeName =
        locale(reader ? reader.presentation(fn.id)?.codeName : getCodeName(fn.id)) ?? fn.id ?? "";
      // Phase 3j: displayLabel never blanks (label → humanized codeName → id),
      // so an undecorated fn shows a real name instead of an empty label.
      const label = locale(reader ? reader.presentation(fn.id)?.label : displayLabel(fn.id));
      out.push({ fn, codeName, label });
    }
  }
  cachedCatalogFns.set(catalog, { revision, rows: out });
  return out;
}

/** Best-effort phantom-entity-name extraction (mirrors the helper in
 *  expression-runner). Used to compare tagged Id<X> types by their
 *  phantom enum tag. */
function phantomEntity(t: FenelType | undefined): string | null {
  if (!t || typeof t !== "object" || !("$tagged" in t)) return null;
  const ph = (t as { $tagged: { phantom?: FenelType } }).$tagged?.phantom;
  if (!ph || typeof ph !== "object" || !("$refined" in ph)) return null;
  const set = (ph as { $refined: { set?: unknown } }).$refined?.set;
  const sv = peelSetExpr(set); // dual-read the $refined.set SetExpr (3b-1)
  if (sv?.kind !== "SeEnum") return null;
  const values = sv.values;
  if (!Array.isArray(values) || values.length === 0) return null;
  return typeof values[0] === "string" ? values[0] : null;
}

function namedTypeOf(t: FenelType | undefined): string | null {
  if (!t || typeof t !== "object") return null;
  if ("$ref" in t) return String((t as { $ref: unknown }).$ref);
  const maybe = peelMaybe(t);
  if (maybe) return namedTypeOf(maybe.value);
  if ("$refined" in t) return namedTypeOf((t as { $refined: { base: FenelType } }).$refined.base);
  return null;
}

/** True when a value of type `have` would satisfy a parameter of type
 *  `want`. Matches by phantom Id<X> first (covers our typed handles),
 *  then by named primitive (peeling $maybe / $refined). Conservative —
 *  unknown / structural types fall through to false. */
function paramAccepts(have: FenelType | undefined, want: FenelType | undefined): boolean {
  if (!have || !want) return false;
  // Polymorphic param ($var "a") — accepts any value. Without this,
  // generic ops like pinToView(value: ∀a. a) never surface.
  if (typeof want === "object" && "$var" in (want as object)) return true;
  const hp = phantomEntity(have);
  const wp = phantomEntity(want);
  if (hp && wp) return hp === wp;
  if (hp || wp) return false;
  const hn = namedTypeOf(have);
  const wn = namedTypeOf(want);
  if (hn && wn) return hn === wn;
  return false;
}

/** Default-seed a value for a non-leading parameter when invoking an
 *  op directly from a card without an args modal. Booleans default to
 *  false, Maybe defaults to null, otherwise null. */
function seedDefault(t: FenelType): unknown {
  if (!t || typeof t !== "object") return null;
  if (peelMaybe(t)) return null;
  if ("$ref" in t && (t as { $ref: unknown }).$ref === "Boolean") return false;
  return null;
}



/** Returns the ExprNode for an item, resolving refs against the saved-
 *  expression registry. Returns null when the ref points at something
 *  that's no longer there (e.g. user deleted the saved expression). */
function resolveExpr(
  item: LayoutItem,
  savedExprById: Map<string, ExprNode>,
): ExprNode | null {
  // Phase-2 explicit source
  if (item.source?.kind === "ref") {
    return savedExprById.get(item.source.ref.id) ?? null;
  }
  if (item.source?.kind === "expr") return item.source.expr;
  // Legacy inline
  if (item.expr) return item.expr;
  return null;
}

function rendersPicture(item: LayoutItem, saved: Map<string, ExprNode>, session: AuthoringSession): boolean {
  const expr = resolveExpr(item, saved);
  return !!expr && expressionRendersSampledMedia(expr, saved, session);
}

// ---------------------------------------------------------------------------
// Catalog references. A saved reference is Fenel's `{$ref}`; `{$pin}` values
// written before it stay readable. The committed account registry decides
// what either one names, so a card never classifies a referent it cannot see.
// ---------------------------------------------------------------------------

function resolveCatalogReference(reference: LocusCatalogReference, reader?: ReaderRuntime) {
  if (reader) return resolveLocusCatalogReference(reference, reader.catalogLookups);
  if (!publicDataSelected()) return accountFieldRegistry() ? resolveLocusCatalogReference(reference, accountCatalogLookups) : undefined;
  const registry = DETACHED_AUTHORING_SESSION.registry;
  return resolveLocusCatalogReference(reference, {
    fn: (id) => registry.getFunction(id),
    typeFamilyOwner: (id) => DETACHED_AUTHORING_SESSION.evaluateContext._typeFamilyOwner?.(id),
    entry: () => undefined,
    entityType: (name) => registry.getIdentifiedEntity(name)?.type,
  });
}

/** The card a reference renders as. `null` is a reference this account
 *  cannot resolve; `undefined` means the value is not a reference at all. */
function catalogCardOf(value: unknown, reader?: ReaderRuntime): LocusCatalogCard | null | undefined {
  if (!readLocusCatalogReference(value)) return undefined;
  return locusCatalogReferenceMetadata(value, (reference) => resolveCatalogReference(reference, reader)) ?? null;
}

/** The literal a newly authored catalog reference stores. */
function catalogReferenceExpr(address: LocusCatalogAddress, reader?: ReaderRuntime): ExprNode {
  return { kind: "literal", value: locusCatalogReferenceValue(address, reader?.catalogLookups ?? accountCatalogLookups) };
}

/** The type a card holding a reference shows and filters its operations by:
 *  a function's signature, or the structure of the type it names. A legacy
 *  pin this account cannot resolve still says what kind of thing it named. */
function catalogReferenceType(value: unknown, reader?: ReaderRuntime): FenelType | undefined {
  const reference = readLocusCatalogReference(value);
  if (!reference) return undefined;
  const target = resolveCatalogReference(reference, reader);
  if (target?.kind === "function" || target?.callable !== undefined) {
    const fn = (target.callable ?? target.value) as FenelFunction;
    return { $arrow: { params: fn.params, returns: fn.returns } } as FenelType;
  }
  if (target) return target.kind === "type" || target.kind === "entity" ? { $type: true } : undefined;
  if (reference.kind === "function") return { $ref: "Function" } as FenelType;
  if (reference.kind !== "type" && reference.kind !== "entity") return undefined;
  const format = getCatalogEntry(reference.id, reader)?.set;
  if (format) return { $refined: { base: { $ref: "String" }, set: format } } as FenelType;
  return { $type: true };
}

/** Capture the pane at component setup. Async callbacks keep these closures,
 * so another pane can never redirect their reads, writes or presentation. */
type HomeSourceTicket = { origin: object | undefined };
/** B3: a layout row (table, calendar, timeline, tree) evaluates its item the
 * way a card does, through the shared worker-backed card evaluation, for every
 * reader kind. A painted card result is reused; nothing runs on the page. */
function useRowEvaluation(props: { item: LayoutItem; savedExprById: Map<string, ExprNode> }) {
  const { homeAuthoringSession } = useHomeReader();
  const data = useContext(HomeDataContext);
  const evaluation = createLocusCardEvaluation(() => {
    const rendered = data?.evaluated(props.item);
    return { expr: resolveExpr(props.item, props.savedExprById) ?? undefined, saved: props.savedExprById,
      session: homeAuthoringSession(), ...(rendered ? { evaluated: rendered } : {}) };
  });
  return createMemo(() => {
    const value = evaluation.value();
    return { result: value.result, error: value.error, loading: evaluation.loading() };
  });
}

function useHomeReader() {
  const reader = useReaderRuntime();
  const client = useApiClient();
  const synchronization = useLocusSynchronization();
  const sourceSession = reader ? createMemo(() => {
    const base = reader.session();
    return reactiveAuthoringSession(() => base, () => {
      const capture = reader.captureSourceMetadata?.();
      return capture?.session === base ? capture : undefined;
    });
  }) : undefined;
  const authoringSession = () => sourceSession?.() ?? homeAuthoringSession();
  const captureSourceTicket = (): HomeSourceTicket => ({ origin: client.drafts?.source() });
  const assertSourceTicket = (ticket: HomeSourceTicket) => {
    if (ticket.origin !== client.drafts?.source()) {
      throw new Error("The data source changed while editing. Your draft is kept here. Reopen the latest data before applying it.");
    }
  };
  // B3: a Local reader answers declaration ids from its worker references.
  const declarationIdOf = (id: string): string | undefined => {
    if (reader?.kind !== "local") return reader?.registry().getFunction(id)?.id;
    const fn = reader.catalogLookups.fn(id);
    return fn && typeof fn === "object" && typeof (fn as { id?: unknown }).id === "string" ? (fn as { id: string }).id : undefined;
  };
  const observePending = <T,>(compute: () => T): { value: T; pending: boolean; failed: boolean } =>
    reader?.observePending ? reader.observePending(compute) : { value: compute(), pending: false, failed: false };
  const representationString = (typeName: string, id: string, method: string) => {
    const value = reader?.representation(typeName, id)?.[method];
    return typeof value === "string" ? value : undefined;
  };
  function temporaryEdits() {
    return reader?.kind === "local" || reader?.kind === "public"
      || !!client.drafts && (synchronization?.enabled() === false || client.drafts.pending() > 0);
  }
  function assertAppearanceDrafts(drafts: Record<string, Record<string, unknown>>) {
    if (reader?.kind === "account" && client.drafts && (synchronization?.enabledNow() === false || client.drafts.pending() > 0)
      && Object.keys(drafts).length > 0) {
      throw new Error("Turn synchronization on to apply appearance rules, or create in Local.");
    }
  }
  return {
    ...client, client, reader,
    assertAppearanceDrafts, captureSourceTicket, assertSourceTicket,
    temporaryEdits,
    publicDataSelected: () => reader ? reader.kind === "public" : publicDataSelected(),
    homeAuthoringSession: authoringSession,
    accountFieldRegistry: () => reader ? reader.registry() : accountFieldRegistry(),
    userFunctions: () => reader ? reader.functions() : userFunctions(),
    reloadUserRegistries: (definitionSave?: unknown) => {
      if (reader?.kind === "account" && client.didRefreshDefinitions(definitionSave)) return Promise.resolve();
      return reader ? reader.reload() : reloadUserRegistries();
    },
    accountAuthoringSession: (scope: Parameters<typeof accountAuthoringSession>[0]) => reader
      ? scope.draft ? reader.draftSession(scope.draft) : authoringSession() : accountAuthoringSession(scope),
    prepareAuthoringSessionForFunction: (...args: Parameters<typeof prepareAuthoringSessionForFunction>) => reader
      ? reader.prepareFunction(args[0], args[1]?.draft, args[2]) : prepareAuthoringSessionForFunction(...args),
    evaluateAuthoringExpression: (...args: Parameters<typeof evaluateSessionExpression>) =>
      evaluateSessionExpression(args[0], args[1], args[2] ?? authoringSession(), args[3], { trace: false, ...args[4] }),
    getCatalog: () => getCatalog(reader),
    getCatalogEntry: (id: string) => getCatalogEntry(id, reader),
    allCatalogFns: () => allCatalogFns(reader),
    catalogCardOf: (value: unknown) => catalogCardOf(value, reader),
    /** B3: the reader has not answered what this reference names yet. */
    catalogReferencePending: (value: unknown) => !!readLocusCatalogReference(value)
      && observePending(() => catalogCardOf(value, reader)).pending,
    observePending,
    /** B3: the reader's name for this id is current (a Local reader answered in
     * its current incarnation). Persisting a name requires it. */
    nameCurrent: (id: string) => reader?.kind !== "local" || !reader.presentationPending?.(id),
    /** The frame that merges occurrence glyphs (a pure engine projection).
     * B3: a Local reader uses the repository engine frame, never its page session. */
    presentationFrame: () => reader?.kind === "local" ? undefined : authoringSession().evaluateContext,
    catalogReferenceExpr: (address: LocusCatalogAddress) => catalogReferenceExpr(address, reader),
    catalogReferenceType: (value: unknown) => catalogReferenceType(value, reader),
    resolveCatalogReference: (reference: LocusCatalogReference) => resolveCatalogReference(reference, reader),
    itemFenelSource: (item: LayoutItem, saved: Map<string, ExprNode>, evaluated?: RenderedCardValue) =>
      itemFenelSource(item, saved, authoringSession(), evaluated, reader),
    /** B4 wave 4 lane H: a Local card's code, printed in its worker. */
    localItemSource: (open: () => boolean, input: () => { item: LayoutItem; saved: Map<string, ExprNode>; evaluated?: RenderedCardValue }) =>
      createLocalItemSource(reader, authoringSession, open, input),
    knownTypeIconName: (name: string | undefined) => knownTypeIconName(name, reader),
    findTypeCatalogEntry: (name: string | undefined) => findTypeCatalogEntry(name, reader),
    getLabel: (id: string) => reader ? reader.presentation(id)?.label
      ?? reader.representation("Labelable", id)?.label as ReturnType<typeof getLabel> : getLabel(id),
    displayLabel: (id: string) => reader ? reader.presentation(id)?.label
      ?? reader.representation("Labelable", id)?.label as ReturnType<typeof displayLabel> ?? id : displayLabel(id),
    callableName: (id: string, fallback?: string) => {
      // B3: an unanswered Local name is reserved, never shown as a code name.
      if (reader?.presentationPending?.(id)) return fallback ?? "";
      const authored = locale(reader ? reader.representation("Labelable", id)?.label : getLabel(id));
      if (authored) return authored;
      const metadata = reader?.presentation(id);
      const declarationId = declarationIdOf(id);
      const label = locale(metadata?.label);
      const codeName = locale(metadata?.codeName ?? (reader ? reader.representation("Codeable", id)?.codeName : getCodeName(id)));
      // Catalog fallbacks can carry the declaration wire while the value carries its UUID.
      return displayCallableName(id, label === declarationId ? undefined : label,
        codeName ?? declarationId, fallback);
    },
    /** `callableName`, marked as code when no human label was found. */
    callableDisplayName: (id: string, fallback?: string): DisplayName => {
      if (reader?.presentationPending?.(id)) return humanName(fallback ?? "");
      const authored = locale(reader ? reader.representation("Labelable", id)?.label : getLabel(id));
      if (authored) return humanName(authored);
      const metadata = reader?.presentation(id);
      const declarationId = declarationIdOf(id);
      const label = locale(metadata?.label);
      const codeName = locale(metadata?.codeName ?? (reader ? reader.representation("Codeable", id)?.codeName : getCodeName(id)));
      const shown = label === declarationId ? undefined : label;
      const text = displayCallableName(id, shown, codeName ?? declarationId, fallback);
      return shown && shown === text && shown !== codeName ? humanName(text) : codeNameOf(text);
    },
    /** A21: a reference's shown name. A Labelable instance's label was authored
     *  (a name typed in the app is stored as one): it reads as a label even when
     *  it equals the derived code name; otherwise the label/code-name rule. */
    presentedName: (id: string): DisplayNameInput => {
      const authored = locale(reader ? reader.representation("Labelable", id)?.label : getLabel(id));
      if (authored?.trim()) return humanName(authored);
      const label = locale(reader ? reader.presentation(id)?.label
        ?? reader.representation("Labelable", id)?.label as ReturnType<typeof getLabel> : getLabel(id));
      const code = locale(reader ? reader.presentation(id)?.codeName
        ?? reader.representation("Codeable", id)?.codeName as ReturnType<typeof getCodeName> : getCodeName(id));
      return pickDisplayName(label, code);
    },
    getCodeName: (id: string) => reader ? reader.presentation(id)?.codeName
      ?? reader.representation("Codeable", id)?.codeName as ReturnType<typeof getCodeName> : getCodeName(id),
    getDescription: (id: string) => reader ? reader.presentation(id)?.description
      ?? reader.representation("Describable", id)?.description as ReturnType<typeof getDescription> : getDescription(id),
    // Name-row glyphs need selected own-facet provenance. A legacy surface
    // without a captured reader still retains explicit occurrence icons.
    getIcon: (id: string) => reader?.ownIcon?.(id),
    getEmoji: (id: string) => reader ? reader.presentation(id)?.emoji ?? representationString("Emojiable", id, "emoji") : getEmoji(id),
    // B3 (Rom D-14 (2)): a Local frame refuses every perform, so a Local card
    // offers no IO affordance; the call evaluates in the worker like any other.
    getIOAction: (id: string) => reader?.kind === "local" ? undefined
      : reader ? representationString("IOInvokable", id, "ioAction") : getIOAction(id),
    getStopAction: (id: string) => {
      if (reader?.kind === "local") return undefined;
      if (!reader) return getStopAction(id);
      const value = peelMaybeValue((reader.representation("IOInvokable", id)?.stopAction ?? Nothing) as Parameters<typeof peelMaybeValue>[0]);
      return typeof value === "string" ? value : undefined;
    },
    getTags: (id: string) => {
      if (!reader) return getTags(id);
      const tags = reader.representation("Taggable", id)?.tags;
      return Array.isArray(tags) ? tags as string[] : undefined;
    },
    // B4 unit E: a Local reader encodes in its own worker, never with a page registry.
    persistRepresentation: (...args: Parameters<typeof persistRepresentation>) =>
      persistRepresentation(args[0], args[1], args[2], args[3], client,
        reader?.kind === "local" ? client.instanceEncoding!() : reader?.registry() ?? accountFieldRegistry()),
    persistRepresentations: (targetId: string, representations: Parameters<typeof persistRepresentations>[1], canContinue?: () => boolean) =>
      persistRepresentations(targetId, representations, undefined, client,
        reader?.kind === "local" ? client.instanceEncoding!() : reader?.registry() ?? accountFieldRegistry(), canContinue),
    /** Save a new definition and its own representations. A Local tab rebuilds
     * its whole checked reader per transaction, so both go in one transaction. */
    saveDefinitionWithRepresentations: async (bundle: Parameters<typeof client.api.definitionBundleSave>[0], targetId: string,
      representations: Parameters<typeof persistRepresentations>[1], canContinue: () => boolean, expectedRevision?: number) => {
      if (reader?.kind === "local" && !client.drafts && client.editDefinitionAndData
        && (expectedRevision !== undefined || Object.keys(representations).length > 0)) {
        const encoding = client.instanceEncoding!();
        const { root } = await client.getLocusRoot();
        if (!canContinue()) return undefined;
        const writes = await representationWrites(targetId, representations, undefined, client, encoding, canContinue);
        if (!writes || !canContinue()) return undefined;
        return client.editDefinitionAndData(bundle, expectedRevision ?? root.revision, { representations: writes, encodingRegistry: encoding });
      }
      const committed = await client.api.definitionBundleSave(bundle);
      if (!canContinue()) return committed;
      await persistRepresentations(targetId, representations, undefined, client,
        reader?.kind === "local" ? client.instanceEncoding!() : reader?.registry() ?? accountFieldRegistry(), canContinue);
      return committed;
    },
    addToLocus: (...args: Parameters<typeof addToLocus>) => addToLocus(args[0], args[1], args[2], client),
  };
}


/** Every id in a layout's items, nested tree children included. */
function layoutItemIds(items: readonly LayoutItem[]): Set<string> {
  const ids = new Set<string>();
  const walk = (list: readonly LayoutItem[]) => {
    for (const item of list) { ids.add(item.id); walk((item as TreeItem).children ?? []); }
  };
  walk(items);
  return ids;
}

const FLAT_SCOPE_NESTING = "This is a flat list, so it cannot nest one item under another. Put them in a list inside it to nest them.";

/** A card standing for one child of the value you are inside. Its id CARRIES
 *  its key, because a synthesised card has no row to be looked up in — the
 *  renderers hand ids back and the key has to survive that round trip. List
 *  index `1` and field `"1"` are different places, hence the two prefixes. */
/** One date group's place on the derived Calendar (view.CalendarDayPlacement). */
type DerivedCalendarDay = { day: string; year: number; month: number; entry: number };
/** One bar of a numeric grouping (view.GroupingBar). */
type DerivedBar = { label: string; value: number; entry: number };
/** view.groupingPresentation's recommendation for a decided grouping. */
type DerivedGrouping = { kind: "calendar"; days: DerivedCalendarDay[] } | { kind: "chart"; bars: DerivedBar[] } | { kind: "table"; size: number };
const GROUPING_PRESENTATION_FUNCTION = "view:groupingPresentation";
function groupingEntryCount(grouping: DerivedGrouping): number {
  return grouping.kind === "table" ? grouping.size : grouping.kind === "chart" ? grouping.bars.length
    : grouping.days.reduce((count, day) => Math.max(count, day.entry + 1), 0);
}
/** The earliest group's day ("YYYY-MM-DD" from the CalendarDate codec, so the
 *  text order is the date order for the codec's four-digit years). */
function earliestCalendarDay(days: readonly DerivedCalendarDay[]): DerivedCalendarDay | undefined {
  return days.reduce<DerivedCalendarDay | undefined>((first, row) => !first || row.day < first.day ? row : first, undefined);
}

function childItemId(key: LocusPathStep): string {
  return typeof key === "number" ? `i#${key}` : `f.${key}`;
}
function childItemKey(id: string): LocusPathStep | undefined {
  if (id.startsWith("i#")) {
    const index = Number(id.slice(2));
    return Number.isInteger(index) && index >= 0 ? index : undefined;
  }
  if (id.startsWith("f.")) return id.slice(2);
  return undefined;
}

// ---------------------------------------------------------------------------
// Page
// ---------------------------------------------------------------------------

/** Context exposed by HomePage so deeply-nested cards (e.g. TypePinCard's
 *  "Instantiate" button) can open the create modals on the home view
 *  instead of routing away. Avoids prop-threading the open callbacks
 *  through every layout renderer. */
type CreateModalContextValue = {
  instantiateType: (typeName: string, cardAnchor?: CreationCardAnchor) => void;
  instantiateValueType: (type: FenelType) => void;
  /** Open NewValueModal pre-filled with a source layout item — clones
   *  the item's expression (and label/description if it's a ref to a
   *  saved value) into the modal so the user edits a fresh draft and
   *  Save creates a new saved value. */
  duplicateItem: (item: LayoutItem) => void;
  /** `evaluate`: an explicit apply shows the computed result at once;
   * otherwise the draft opens for editing and previews on request. */
  composeSuggestion: (node: ExprNode, options?: { evaluate?: boolean }) => void;
  /** Apply a Suggestions action at once: in place (Apply here) or as new data
   *  from the selected data (New data from this). `item`: the selected card. */
  applySuggestion: (node: ExprNode, suggestion: DataSuggestion, disposition: SuggestionDisposition, item?: LayoutItem,
    origin?: InspectionSaveOrigin) => void;
};
const CreateModalContext = createContext<CreateModalContextValue | null>(null);
const HomeDataContext = createContext<{
  referencesReady: () => boolean;
  canWrite: () => boolean;
  canAdd: () => boolean;
  canArrange: () => boolean;
  /** A tree layout nests an item under its sibling. Only a data set keeps a
   *  tree of items; the root and a value scope are flat lists, where the
   *  nested item would read as removed. */
  canNest: () => boolean;
  add: typeof addToLocus;
  listSummary: (item: LayoutItem) => { name: string; count: number; items: readonly LayoutItem[];
    type?: FenelType; savedExprById: Map<string, ExprNode>; enter: (child: LayoutItem) => void } | undefined;
  dataTarget: (item: LayoutItem) => ReturnType<typeof readWorkspaceDataTarget>;
  session: () => ReturnType<typeof accountAuthoringSession>;
  evaluated: (item: LayoutItem) => RenderedCardValue | undefined;
  /** Source-owned changes, shared by every occurrence of the same datum. */
  unsaved: (item: LayoutItem) => boolean;
  /** The last in-place apply on this card, offered back where it happened. */
  appliedUndo?: (itemId: string) => { message: string; undo: () => void } | undefined;
  /** 1-based position of this card among the scope's cards of the same type
   *  (an unnamed record reads as "Transaction 2"). */
  typeOrdinal?: (item: LayoutItem) => number | undefined;
  import:(captured: TransferSnapshot, hint?: PlacementHint) => void;
  type: (item: LayoutItem) => FenelType | undefined;
  /** B4 wave 4 lane H: a Local reader answers from its worker (a promise). */
  savedValue: (id: string) => import("~/lib/data-transfer").TransferItem | undefined | Promise<import("~/lib/data-transfer").TransferItem | undefined>;
  revision: (item: LayoutItem) => number;
  replace: (item: LayoutItem, expr: ExprNode, type?: FenelType, revision?: number,
    edit?: ValueEdit,
    /** The root revision the edit was authored against, when it was opened
     *  earlier than it is saved (the Edit dialog). */
    rootRevision?: number, definitionBundle?: Parameters<typeof api.definitionBundleSave>[0], expectedSavedQuery?: Record<string, unknown>, sourceTicket?: HomeSourceTicket, assertCurrent?: () => void) => Promise<void>;
  /** Entering a card makes ITS value the locus. False when the value is a
   *  leaf: there would be nothing inside to show.
   *
   *  The card passes the value it ALREADY evaluated to show. Without that this
   *  asks the evaluator again, once per card per render, for an answer the
   *  caller is holding. */
  canEnter: (item: LayoutItem, evaluated?: { value: unknown }) => boolean;
  enter: (item: LayoutItem, evaluated?: { value: unknown }) => void;
  openLens: (item: LayoutItem, evaluated?: { value: unknown }, mode?: "stack" | "split") => void;
  enterPath: (item: LayoutItem, path: readonly LocusPathStep[], evaluated: { value: unknown }) => void;
  /** True when the SCOPE asks before a removal — so the card must not ask as
   *  well. At the root a card stands for a whole data set, and the question
   *  worth asking there is not the one a card knows how to ask. */
  scopeConfirmsRemoval: () => boolean;
  /** A card inside a value is a POSITION in that value, not an expression of
   *  its own — there is no saved expression behind it to open. Editing one
   *  happens in place, through its typed fields. */
  canEditExpression: () => boolean;
  /** Move this value OUT to the scope that encloses this one.
   *
   *  A value is reachable from the scopes inside the one holding it, so
   *  sharing one between two siblings means putting it where both can see it.
   *  Without this the only way to do that is to paste it again, which makes a
   *  second value — and the whole point is that it is the same one. */
  canLift: (item: LayoutItem) => boolean;
  liftLabel: () => string;
  lift: (item: LayoutItem) => void;
  openMenu: (event: MouseEvent, occurrence?: MenuOccurrence) => void;
  openContainedMenu: (event: MouseEvent, parent: LayoutItem, data: ContainedValuePreview, evaluated?: RenderedCardValue) => void;
  occurrenceFor: (getItem: () => LayoutItem | undefined, getEvaluated?: () => RenderedCardValue | undefined) => DataOccurrenceSource;
  menuOpen: (itemId: string) => boolean;
  openInspection: (item: LayoutItem, mode: DataInspectionMode, evaluated?: RenderedCardValue) => void;
  /** A card's own reference in the current editable root, when published. */
  cardReference: (itemId: string) => ExprNode | undefined;
  focusedExpressionState: () => ReturnType<typeof createInspectionExpressionState>;
  inspectionValue: (item: LayoutItem) => InspectionValueEdit | undefined;
  inspectionOrigin: () => InspectionSaveOrigin | undefined;
  /** `receipt.body`: the function body this Save lowered and persisted. */
  saveInspection: (item: LayoutItem, expr: ExprNode, fn?: FenelFunction, origin?: InspectionSaveOrigin,
    receipt?: { body?: unknown }) => Promise<"data" | "lens">;
  instantiateFunction: (pin: { id: string; name: string }) => void;
  codeOpen: (itemId: string) => boolean;
  desktop: () => boolean;
  openDesktop: (item: LayoutItem, evaluated?: { value: unknown }) => void;
  toggleCode: (itemId: string) => void;
  cutId: () => string | undefined;
  requestInspect: (itemId: string) => void;
  inspectRequest: () => string | undefined;
  repairType: (item: LayoutItem, name: string) => void;
  demoCopyBranch: (itemId: string, caption?: string) => "new:showcase-demo" | "new:recipe-demo" | undefined;
  editDemoInLocal: (branch: "new:showcase-demo" | "new:recipe-demo") => void;
}>();

export default function HomePage(props: { initialAction?: HomeAction; publicData?: PublicLocusData; pane?: WorkspacePane } = {}) {
  const { reader, client, getLocusRoot, editLocusRoot, getSavedQueries, getTypes, getFunctions,
    api, apiFetch, revalidate, homeAuthoringSession, evaluateAuthoringExpression, getCatalog,
    getCatalogEntry, allCatalogFns, catalogReferenceExpr, catalogCardOf, resolveCatalogReference, knownTypeIconName, callableName, callableDisplayName,
    accountFieldRegistry, userFunctions, accountAuthoringSession, addToLocus, getFunctionByName,
    prepareAuthoringSessionForFunction, reloadUserRegistries, captureSourceTicket, assertSourceTicket, temporaryEdits, presentationFrame } = useHomeReader();
  const synchronization = useLocusSynchronization();
  const transferOwner = untrack(() => props.publicData ? undefined
    : workspaceTransferOwner(client.accountId, props.pane?.id, client.epoch ?? sessionEpoch(), client.rootId));
  const sharedWrites = locusReaderWrites(client);
  const location = useLocation();
  const redirect = useNavigate();
  // A boolean memo: a lens pane is a new object on every lens change (its
  // presentation, focus or subject). Read directly, it re-ran this mount's
  // root and saved-data reads (and so its whole value scope) for a change of
  // Representation; in a Local lens that refetch ran as a transition which
  // Solid 2.0 rc.7 could leave unsettled, holding the lens on Loading.
  const redirectToPublic = createMemo(() => !props.pane && !props.publicData
    && /^\/app\/home\/?$/.test(location.pathname));
  createEffect(redirectToPublic, (needed) => { if (needed) redirect(`/app${location.search}`, { replace: true }); });
  // A shell action initializes this mount's draft once. Subsequent edits belong
  // to the user; replaying the action after a prop change would reset them.
  const initialAction = untrack(() => props.initialAction);
  // Object-shaped hand-offs discriminate on `kind`.
  const initialValue = typeof initialAction === "object" && initialAction.kind === "new:value"
    ? initialAction : undefined;
  const initialExpression = typeof initialAction === "object" && initialAction.kind === "new:expression"
    ? initialAction : undefined;
  const initialBrowse = typeof initialAction === "object" && initialAction.kind === "browse"
    ? initialAction : undefined;
  const initialPin = typeof initialAction === "object" && initialAction.kind === "pin"
    ? initialAction : undefined;
  const initialSavedOpen = typeof initialAction === "object" && initialAction.kind === "open-saved"
    ? initialAction : undefined;
  const initialSource = typeof initialAction === "object" && initialAction.kind === "show-code"
    ? initialAction : undefined;
  const initialInspection = typeof initialAction === "object" && initialAction.kind === "inspect-data"
    ? initialAction : undefined;
  const initialSuggestions = typeof initialAction === "object" && initialAction.kind === "suggest-data"
    ? initialAction : undefined;
  const initialCall = typeof initialAction === "object" && initialAction.kind === "call-function"
    ? initialAction : undefined;
  const [earlyTypeInspection, setEarlyTypeInspection] = createSignal<FenelType | undefined>(
    typeof initialAction === "object" && initialAction.kind === "inspect-type" ? initialAction.type : undefined);
  // An address may name the panels this lens opens with (`?panels=dependencies`).
  const addressPanels = untrack(() => props.pane ? undefined : addressInspectionPanels(location.search));
  const [localInspectionMode, setLocalInspectionMode] = createSignal<DataInspectionMode>(initialInspection?.mode
    ?? (addressPanels ? { panels: addressPanels } : "data"));
  const lensMode = () => props.pane?.inspectionMode?.() ?? localInspectionMode();
  const setLensMode = (mode: DataInspectionMode) => props.pane?.onInspectionMode ? props.pane.onInspectionMode(mode) : setLocalInspectionMode(mode);
  if (!reader && !untrack(() => props.publicData || redirectToPublic())) void ensureUserRegistriesLoaded();
  // Keep a failed read distinct from an empty account. In particular, a list
  // timeout must not seed another Home or leave the page loading indefinitely.
  const all = createMemo(() => {
    // Keep the committed local source in this graph even when framework query
    // guards invoke the transport untracked across its async boundary.
    if (reader?.kind === "local") reader.revision();
    client.drafts?.revision();
    const sourceTicket = captureSourceTicket();
    return props.publicData ? { root: props.publicData.root, failed: false, sourceTicket } : redirectToPublic()
    ? { root: null, failed: false, sourceTicket } : getLocusRoot().then(
    (data) => ({ ...data, failed: false, sourceTicket }),
    () => ({ root: null, failed: true, sourceTicket }),
    );
  });
  const savedAll = createMemo(() => {
    if (reader?.kind === "local") reader.revision();
    client.drafts?.revision();
    return props.publicData || redirectToPublic() ? { queries: [], categories: [], failed: false } : getSavedQueries().then(
    (data) => ({ ...data, failed: false }),
    () => ({ queries: [], categories: [], failed: true }),
    );
  });
  const [retryingData, setRetryingData] = createSignal(false);
  const root = () => all().root;
  const rootSourceTicket = () => all().sourceTicket;
  const homes = () => (root()?.lists ?? []) as LocusViewRow[];
  const rootRow = () => { const data = root(); return data ? rootDataRow(data) : null; };
  const rowById = (id: string) => id === root()?.id ? rootRow() : homes().find((home) => home.id === id) ?? null;
  const dataLoadErrors = createMemo(() => all().failed || savedAll().failed ? ["Could not load data."] : []);

  // ---- the one root write queue ----------------------------------------
  // A root command and a list's draft each move the ONE root revision, so they
  // share one queue, and each records the revision it produced. A write
  // authored at revision `a` is sent at the latest revision only when every
  // revision after `a` came from this tab's own acknowledged writes: those
  // were this user's edits, made in order. A revision produced anywhere else
  // still fails the compare-and-swap, as it must.
  let rootWriteChain: Promise<unknown> = Promise.resolve();
  let rootWritesInFlight = 0;
  let ownRevisions: { accountId: string; sourceOrigin: object | undefined; revisions: Set<number>; latest: number } | undefined;
  function acknowledgeRootRevision(accountId: string, revision: number | undefined, result: unknown) {
    if (revision === undefined) return;
    let sourceOrigin = client.drafts?.resultSource(result);
    let acknowledged = revision;
    // An automatic save can retire its browser source before this receipt
    // reaches the pane. Only its exact physical acknowledgement can cross.
    if (sourceOrigin !== client.drafts?.source()) {
      if (client.drafts?.source() !== undefined) return;
      const physical = client.drafts?.resultRootRevision(result);
      if (physical === undefined) return;
      sourceOrigin = undefined;
      acknowledged = physical;
    }
    if (ownRevisions?.accountId !== accountId || ownRevisions.sourceOrigin !== sourceOrigin) {
      ownRevisions = { accountId, sourceOrigin, revisions: new Set(), latest: acknowledged };
    }
    ownRevisions.revisions.add(acknowledged);
    ownRevisions.latest = Math.max(ownRevisions.latest, acknowledged);
  }
  function rebasedRevision(accountId: string, authored: number): number {
    const own = ownRevisions?.accountId === accountId && ownRevisions.sourceOrigin === client.drafts?.source()
      ? ownRevisions : undefined;
    if (!own || authored >= own.latest) return authored;
    for (let revision = authored + 1; revision <= own.latest; revision++) {
      if (!own.revisions.has(revision)) return authored;
    }
    return own.latest;
  }
  function enqueueRootWrite<T>(write: () => Promise<T>): Promise<T> {
    const work = sharedWrites.enqueue(write);
    rootWritesInFlight++;
    rootWriteChain = work.catch(() => {}).finally(() => { rootWritesInFlight--; });
    return work;
  }
  /** A list write through the shared queue: rebased over this tab's own
   *  writes, and acknowledged with the revision it produced. */
  function writeLocusList(id: string, patch: { name?: string; view?: Record<string, unknown>; active?: boolean },
    expectedRootRevision?: number, sourceTicket = captureSourceTicket()) {
    const accountId = root()?.id;
    return enqueueRootWrite(async () => {
      assertSourceTicket(sourceTicket);
      const result = await api.locusViewUpdate(id, { ...patch,
        ...(expectedRootRevision === undefined || !accountId ? {} : { expectedRootRevision: rebasedRevision(accountId, expectedRootRevision) }) });
      if (accountId) acknowledgeRootRevision(accountId, (result as { locusView?: { rootRevision?: number } })?.locusView?.rootRevision, result);
      return result;
    });
  }

  const [draftRevision, setDraftRevision] = createSignal(0);
  const viewPersistence = createViewPersistence<AnyView>({
    version: () => { assertSourceTicket(rootSourceTicket()); return root()?.revision; },
    origin: () => client.drafts?.source(),
    write: (id, view, expectedRootRevision) => writeLocusList(id, { view: view as Record<string, unknown> }, expectedRootRevision),
    writtenVersion: (result) => {
      if (client.drafts?.resultSource(result) === client.drafts?.source()) {
        return (result as { locusView?: { rootRevision?: number } })?.locusView?.rootRevision;
      }
      if (client.drafts?.source() !== undefined) throw new Error("The data source changed while saving. Discard these changes and reload the latest data.");
      const physical = client.drafts?.resultRootRevision(result);
      if (physical === undefined) throw new Error("The data source changed while saving. Discard these changes and reload the latest data.");
      return physical;
    },
    refresh: async () => {
      revalidate(["locusRoot", "locusViews", "activeLocusView"]);
      // Surface reload failures before the display memos record their failure
      // state, then wait for both committed views before dropping the draft.
      await getLocusRoot();
      await refresh(all);
    },
    changed: () => setDraftRevision((revision) => revision + 1),
  });
  // ---- WHERE YOU ARE ----------------------------------------------------
  // There is one top-level value and you are somewhere inside it. The data
  // sets are not universes to pick between — they are the items of that one
  // `List Anything`, so the root scope LISTS them and you enter one.
  // `design/locus-as-value.md` §1-§2; the model is `~/lib/locus-scope`.
  const [localScope, setScope] = createSignal<LocusScope>(ROOT_SCOPE);
  const scope = createMemo<LocusScope>(() => props.pane?.focus() ?? localScope(), {
    // A lens selection changes the saved preferences, not every lens's data
    // focus. Keep those unchanged focuses from re-evaluating all their cards.
    equals: (before, after) => before.kind === after.kind && (before.kind === "root"
      || before.kind === "view" && after.kind === "view" && before.viewId === after.viewId
      || before.kind === "value" && after.kind === "value" && before.viewId === after.viewId
        && before.itemId === after.itemId && !!before.rootItem === !!after.rootItem
        && before.path.length === after.path.length && before.path.every((step, index) => step === after.path[index])
        && (before.passThrough?.length ?? 0) === (after.passThrough?.length ?? 0)
        && (before.passThrough ?? []).every((depth, index) => depth === after.passThrough?.[index])),
  });
  function navigateScope(next: LocusScope, presentation?: LocusLayoutChoice) {
    const item = props.pane?.source().$tag === "AllDataSource" && next.kind === "value" && next.rootItem && next.path.length === 0
      ? root()?.items.find(item => item.id === next.itemId) : undefined;
    const expression = item?.source?.kind === "expr" ? item.source.expr : item?.expr;
    const target = expression?.kind === "literal" ? readWorkspaceDataTarget(expression.value) : undefined;
    if (target && props.pane?.onDataTarget) {
      // The lens shows the clicked location's name and mark at once.
      const icon = item?.representations?.Iconable?.icon, emoji = item?.representations?.Emojiable?.emoji;
      props.pane.onDataTarget(target, undefined, presentation, { name: item?.caption,
        icon: typeof icon === "string" ? icon : undefined, emoji: typeof emoji === "string" ? emoji : undefined });
      return;
    }
    // The saved lens changes focus and presentation together. Publishing the
    // focus first mounts the destination in the old layout, then mounts and
    // evaluates every card again when its own presentation arrives.
    if (props.pane) props.pane.onFocus(next, presentation, navigationIntentFor(next));
    else setScope(next);
  }
  /** What this reader already shows of a destination, for the lens to show at once. */
  function navigationIntentFor(next: LocusScope): import("~/lib/workspace-pane").WorkspaceNavigationIntent | undefined {
    if (!props.pane) return undefined;
    if (next.kind === "root") return { name: props.pane.sourceLabel(),
      icon: props.pane.accounts().find(account => account.id === workspaceSourceKey(props.pane!.source()))?.icon };
    if (next.kind === "view") return { name: root()?.lists.find(row => row.id === next.viewId)?.name };
    const step = next.path.at(-1);
    if (step !== undefined) return { name: typeof step === "string" ? step : `Item ${step + 1}` };
    const item = next.rootItem ? root()?.items.find(candidate => candidate.id === next.itemId)
      : root()?.lists.find(row => row.id === next.viewId)?.view.items.find(candidate => candidate.id === next.itemId);
    const icon = item?.representations?.Iconable?.icon, emoji = item?.representations?.Emojiable?.emoji;
    return { name: item?.caption, icon: typeof icon === "string" ? icon : undefined, emoji: typeof emoji === "string" ? emoji : undefined };
  }
  function openTypeAsData(type: FenelType) {
    if (!props.pane?.onSubjectData) { setEarlyTypeInspection(type); return; }
    props.pane.onSubjectData({ $tag: "LensTypedSubject", dataType: { $type: true }, data: type,
      originSource: props.pane.source(), originFocus: scopeToWorkspace(scope()), producer: Nothing, producerInput: Nothing, producerBinding: Nothing }, "value");
    setLensMode("data");
  }

  const [rootSaving, setRootSaving] = createSignal(0);
  const [rootWriteError, setRootWriteError] = createSignal<string>();
  /** The last root write's failure, set in the same turn it fails. A signal
   *  written there lands on a later microtask, after a waiter already read it. */
  let rootWriteFailure: string | undefined;
  async function changeRoot(command: LocusRootCommand, authoredRevision = root()?.revision, sourceTicket = rootSourceTicket(),
    publication?: import("~/lib/api").RootPublicationOptions) {
    const epoch = sessionEpoch();
    const accountId = root()?.id;
    if (!accountId) throw new Error("Wait for your data to load before editing it.");
    setRootSaving((count) => count + 1);
    const work = enqueueRootWrite(async () => {
      try {
        assertCurrentSession(epoch);
        assertSourceTicket(sourceTicket);
        const displayed = root();
        if (!displayed || displayed.id !== accountId) throw new Error("The account changed before this edit was saved.");
        // Appending a fresh identity and choosing a layout commute with any edit.
        // Anything else was authored against one snapshot and never adopts a
        // later revision, except over this tab's own acknowledged writes.
        const commutes = (candidate: LocusRootCommand): boolean => candidate.kind === "append" || candidate.kind === "layout"
          || candidate.kind === "batch" && candidate.commands.every(commutes);
        const commuting = commutes(command);
        // A refreshed display memo can still retain its prior committed value
        // inside an async UI transition. Only commuting commands read the
        // actual source response here, after earlier queued writes finish.
        const data = commuting ? (await client.getLocusRoot.uncached()).root : displayed;
        assertCurrentSession(epoch);
        assertSourceTicket(sourceTicket);
        client.signal?.throwIfAborted();
        if (data.id !== accountId || root()?.id !== accountId) throw new Error("The data source changed before this edit was saved.");
        const authored = commuting ? data.revision : authoredRevision;
        if (authored === undefined) throw new Error("The edit has no source revision.");
        let written: Awaited<ReturnType<typeof editLocusRoot>>;
        try { written = await editLocusRoot(data.id, rebasedRevision(accountId, authored), command, publication); }
        catch (error) {
          if (error && typeof error === "object" && "status" in error && error.status === 409) {
            revalidate(["locusRoot", "locusViews", "activeLocusView"]);
            await refresh(all);
          }
          throw error;
        }
        acknowledgeRootRevision(accountId, written.root.revision, written);
        rootWriteFailure = undefined;
        assertCurrentSession(epoch);
        revalidate(["locusRoot", "locusViews", "activeLocusView"]);
        // The write is committed and acknowledged (later queued writes rebase on
        // it). The display catch-up may hold this action only a bounded time: a
        // root read that stayed unsettled kept Create on "Creating…" for minutes
        // after its data was saved, and a second click saved it twice (Nov 13).
        await settleWithin(refresh(all), DISPLAY_CATCH_UP_WAIT_MS);
      } catch (error) {
        rootWriteFailure = error instanceof Error ? error.message : String(error);
        throw error;
      }
    });
    try {
      await work;
      // A later write that succeeds, followed by the refresh above, means the
      // tab holds the current root again: the earlier failure no longer blocks.
      if (epoch === sessionEpoch()) { rootWriteFailure = undefined; setRootWriteError(undefined); }
    }
    catch (error) { if (epoch === sessionEpoch()) setRootWriteError(error instanceof Error ? error.message : String(error)); throw error; }
    finally { if (epoch === sessionEpoch()) setRootSaving((count) => count - 1); }
  }

  /** The data set the locus is inside, or null at the root. Every operation
   *  that acts on a set reads this, so they all follow the scope. */
  const current = () => {
    draftRevision();
    const id = scopeViewId(scope());
    const row = id ? rowById(id) : rootRow();
    return row ? { ...row, view: viewPersistence.read(row.id, asView(row.view)) } : null;
  };
  const pendingViewWrites = () => { draftRevision(); return viewPersistence.status(); };
  onSettled(() => synchronization?.register(`home:${client.epoch ?? sessionEpoch()}:${props.pane?.id ?? client.accountId ?? "local"}`, {
    stageBeforeSave: true,
    pending: () => pendingViewWrites().length > 0,
    saving: () => pendingViewWrites().some(write => write.saving),
    error: () => pendingViewWrites().find(write => write.error)?.error,
    save: () => viewPersistence.flushAll(),
    discard: async () => {
      for (const write of pendingViewWrites()) if (!viewPersistence.discard(write.id)) return false;
      await retryHomeData();
      return true;
    },
  }));
  // Leaving waits for writes still in flight. A root command that already
  // failed kept nothing to save (its notice says what happened), so it does
  // not hold every later navigation hostage.
  useBeforeLeave((event) => {
    if (props.pane) return;
    guardLeave(event, {
      idle: () => pendingViewWrites().length === 0 && rootSaving() === 0 && valueSaving() === 0 && !client.drafts?.pending(),
      prepare: async () => {
        if (valueSaving() > 0) { setToolbarError("Wait for the data edit to finish before leaving this data."); return false; }
        const [, saved] = await Promise.all([rootWriteChain, viewPersistence.flushAll()]);
        if (!saved) return false;
        if (client.drafts?.pending() && synchronization?.enabledNow() === false) {
          setToolbarError("Save or discard the pending changes before leaving this data.");
          return false;
        }
        return true;
      },
    });
  });
  onSettled(() => {
    const beforeUnload = (event: BeforeUnloadEvent) => {
      if (pendingViewWrites().length === 0 && rootSaving() === 0 && valueSaving() === 0 && !client.drafts?.pending()
        && !editing() && !composing() && !typeComposing() && !fnComposing() && !calling() && !quickValue()) return;
      void viewPersistence.flushAll();
      event.preventDefault();
      event.returnValue = "";
    };
    window.addEventListener("beforeunload", beforeUnload);
    return () => window.removeEventListener("beforeunload", beforeUnload);
  });
  onCleanup(() => { void viewPersistence.flushAll(); });

  // Map<savedQueryId, ExprNode> for resolving ref-based items.
  const savedExprById = createMemo(() => {
    const listed = ((savedAll() as { queries?: { id: string; query?: { expr?: ExprNode } }[] })?.queries);
    return shareSavedExpressionMap(root()?.expressions, listed);
  });

  // Inline editing — the page hosts a single editor modal so renderers
  // don't each spawn their own. setEditing(item) opens the editor.
  type ItemEditState = { item: LayoutItem; homeId: string; rootRevision?: number; standalone?: "definition" | "saved";
    expectedSavedQuery?: Record<string, unknown>; sourceTicket?: HomeSourceTicket };
  const [editing, setEditing] = createSignal<ItemEditState | null>(null);
  function savedQueryForItem(item: LayoutItem): Record<string, unknown> | undefined {
    const id = item.source?.kind === "ref" ? item.source.ref.id : undefined;
    return id ? ((savedAll() as { queries?: { id: string; query: Record<string, unknown> }[] }).queries ?? [])
      .find(saved => saved.id === id)?.query : undefined;
  }
  function openItemEditor(state: ItemEditState) {
    const query = savedQueryForItem(state.item);
    setEditing({ ...state, sourceTicket: rootSourceTicket(), expectedSavedQuery: query ? cloneDraftValue(query) : undefined });
  }
  function openSavedItemEditor(savedExprId: string, caption: string) {
    openItemEditor({ homeId: "", standalone: "saved", item: {
      id: `browse:saved:${savedExprId}`, caption,
      source: { kind: "ref", ref: { kind: "savedExpr", id: savedExprId } },
    } });
  }

  const [calling, setCalling] = createSignal<{ fnId: string; fnName: string; addressInputs?: readonly LocusAddressInput[];
    addressOrigin?: { source: string; focus: LocusScope } } | null>(null);

  // "+ New value" — opens the Gimp/Photoshop-style composer over the view:
  // big output canvas in the middle, expression panel on the right. On save
  // we create a savedQueries row and pin a ref to it on this view.
  // The shell may have already answered the picker (`new:<branch>`), in which
  // case this mount opens that editor directly instead of re-asking.
  const [composing, setComposing] = createSignal(
    !!initialValue || !!initialExpression || initialAction === "new:value" || initialAction === "new:expression",
  );
  const [composeExpression, setComposeExpression] = createSignal(!!initialExpression || initialAction === "new:expression");
  const [composeCheckpoint, setComposeCheckpoint] = createSignal(initialExpression?.checkpoint);
  const [composeEvaluateOnRequest, setComposeEvaluateOnRequest] = createSignal(false);
  /** A Suggestions draft starts at its subject's root, never inside the data it
   *  reads (which would make the new data part of its own source; review B1). */
  const [composeAtRoot, setComposeAtRoot] = createSignal(false);
  /** The last in-place apply, offered back once ("Applied Reverse · Undo").
   *  Polish lane 2 (Nov 9): it names the card it changed, so its Undo also
   *  sits next to that card, and Ctrl+Z (outside a text box) runs it. */
  const [appliedNotice, setAppliedNotice] = createSignal<{ message: string; itemId?: string; undo: () => Promise<void> }>();
  /** Fix lane A (Nov 8): a refused in-place apply (or its Undo) is also said
   *  next to the Suggestions that started it, not only in the notices menu. */
  const [suggestionApplyError, setSuggestionApplyError] = createSignal<string>();
  /** The Suggestions action the composer was opened with, if any. */
  let composedSuggestion: ExprNode | undefined;
  /** Open a Suggestions action's created result where it landed, in the
   *  presentation its value recommends (view.groupingPresentation: Calendar
   *  for Calendar Date keys, a chart for numbers per key, otherwise a table). */
  async function openCreatedSuggestion(node: ExprNode, occurrence: { id: string } | undefined,
    place: { kind: string; rootId?: string; listId?: string; scope?: LocusScope } | undefined) {
    if (!occurrence || !place || place.scope?.kind === "value") return;
    const rootId = root()?.id;
    if (!rootId || place.rootId && place.rootId !== rootId) return;
    const next: LocusScope | undefined = place.kind === "root"
      ? { kind: "value", viewId: rootId, itemId: occurrence.id, path: [], rootItem: true }
      : place.listId ? { kind: "value", viewId: place.listId, itemId: occurrence.id, path: [] } : undefined;
    if (!next) return;
    const grouping = await derivedGrouping(node, savedExprById(), homeAuthoringSession()).catch(() => undefined);
    navigateScope(next, grouping?.kind);
  }
  // When the user clicks "Instantiate" on a pinned type card we want
  // NewValueModal to open with the type preselected — captured here
  // so the modal can read it on mount. Cleared on close.
  const [composePresetType, setComposePresetType] = createSignal<string | null>(initialExpression?.checkpoint?.typeName ?? (initialValue?.preset ? null : initialValue?.typeName ?? null));
  const [composePresetValueType, setComposePresetValueType] = createSignal<FenelType | undefined>(initialExpression?.checkpoint?.valueType ?? initialValue?.preset?.type);
  const [composePlacement, setComposePlacement] = createSignal<PlacementHint | undefined>(initialExpression?.checkpoint?.placement ?? initialValue?.placement ?? initialValue?.point);
  const [composeCardAnchor, setComposeCardAnchor] = createSignal<CreationCardAnchor | undefined>(initialExpression?.checkpoint?.cardAnchor ?? initialValue?.cardAnchor);
  // "Duplicate" presets — when set, NewValueModal opens with the
  // source's expression pre-filled (and Labelable/Describable drafts
  // pre-seeded if the source was a ref to a named saved value).
  const [composePresetExpr, setComposePresetExpr] = createSignal<ExprNode | null>(initialExpression?.expr ?? (initialValue?.preset
    ? { kind: "literal", value: initialValue.preset.value } : null));
  const [composePresetReps, setComposePresetReps] = createSignal<
    Record<string, Record<string, unknown>> | null
  >(initialExpression?.checkpoint?.reps ?? null);
  // Inline create-modal state for type / function — keep them in the
  // home view rather than routing to /app/types/create or /app/functions
  // so the user stays in the create flow alongside value creation.
  const [typeComposing, setTypeComposing] = createSignal(initialAction === "new:type");
  /** Where a new type's small card appears (a menu's click point); none = the modal. */
  const [typeDraftAnchor, setTypeDraftAnchor] = createSignal<{ x: number; y: number; hint?: PlacementHint; epoch: number }>();
  const [fnComposing, setFnComposing] = createSignal(initialAction === "new:function");

  const createModalCtx: CreateModalContextValue = {
    instantiateType: (typeName: string, cardAnchor?: CreationCardAnchor) => {
      setComposeCardAnchor(cardAnchor);
      setComposePresetValueType(undefined);
      setComposePresetType(typeName);
      setComposing(true);
    },
    instantiateValueType: (type: FenelType) => {
      setComposeCardAnchor(undefined);
      setComposePresetType(null);
      setComposePresetValueType(type);
      setComposePresetExpr(null);
      setComposePresetReps(null);
      setComposeExpression(false);
      setComposing(true);
    },
    duplicateItem: (item: LayoutItem) => {
      setComposeCardAnchor(undefined);
      // Resolve the source expression — refs read from the saved-
      // queries map, inline items use their own expr.
      const expr = resolveExpr(item, savedExprById());
      if (!expr) return;
      setComposePresetExpr(expr);
      // For ref items, seed name/description from the source saved
      // query so the user starts with a sensible draft and can edit.
      const reps: Record<string, Record<string, unknown>> = {};
      if (item.source?.kind === "ref") {
        const refId = item.source.ref.id;
        const list = ((savedAll() as any)?.queries ?? []) as Array<{
          id: string;
          name?: string;
          description?: string;
        }>;
        const sq = list.find((q) => q.id === refId);
        if (sq?.name) reps["Labelable"] = { label: sq.name };
        if (sq?.description) reps["Describable"] = { description: sq.description };
      }
      setComposePresetReps(Object.keys(reps).length > 0 ? reps : null);
      setComposing(true);
    },
    composeSuggestion: (node, options) => {
      if (editingDraftOpen()) { setToolbarError("Finish the current edit before opening a suggestion."); return; }
      setComposeCardAnchor(undefined);
      composedSuggestion = node;
      // Auto retains the canonical inference owner. Projecting a result
      // scheme to its body would lose binders and nominal associations.
      setComposePresetExpr(node); setComposePresetType(null); setComposePresetValueType(undefined);
      setComposePresetReps(null); setComposePlacement(undefined); setComposeExpression(true); setComposeEvaluateOnRequest(!options?.evaluate);
      setComposeAtRoot(true);
      setComposing(true);
    },
    applySuggestion: (node, suggestion, disposition, item, origin) => { void applySuggestion(node, suggestion, disposition, item, origin); },
  };
  /** The editable root itself as a creation destination, added through the
   *  root branch (`addToLocus`), whatever the current scope (review B1). */
  function rootCreationDestination() {
    const data = root();
    if (!data || data.canEdit !== true) return undefined;
    const rootId = data.id; const epoch = sessionEpoch(); const sourceTicket = client.drafts?.source();
    return {
      place: { accountId: client.accountId ?? "", accountLabel: props.pane?.sourceLabel() ?? "This data",
        sourceId: reader?.kind === "local" ? "local" : client.accountId, kind: "root" as const, rootId, revision: data.revision,
        listName: scopeLabel(ROOT_SCOPE, scopeNames()), scope: cloneDraftValue(ROOT_SCOPE), listType: data.type },
      reader, client, saved: savedValuesProvider, add: addToLocus, names: scopeNames(),
      assertCurrent: () => {
        assertCurrentSession(epoch);
        client.signal.throwIfAborted();
        if (root()?.id !== rootId || root()?.canEdit !== true) throw new Error("The data source changed. Choose the scope again before creating data.");
        if (sourceTicket !== client.drafts?.source()) throw new Error("This data source changed. Choose its scope again.");
      },
    };
  }
  /** Demo 1 (Rom, Nov 7: D1, D5): a Suggestions action applied at once. Apply
   *  here rewrites the selected data's own expression in place (the action's
   *  result fits its type). New data from this adds the action's expression,
   *  which reads its source through the source's reference, as a card at the
   *  root. Polish lane B (Rom, Nov 8, Q7): when the source is a root card in
   *  view, the new card is placed right after it and nothing navigates (it reads as its
   *  result there: a grouping as its miniature calendar or bars); otherwise it
   *  is appended and opened in the presentation its value recommends. The card
   *  keeps the checked result type, so it is captioned as its result. A
   *  read-only root keeps the New data composer. */
  async function applySuggestion(node: ExprNode, suggestion: DataSuggestion, disposition: SuggestionDisposition,
    item: LayoutItem | undefined, origin?: InspectionSaveOrigin) {
    if (editingDraftOpen()) { setToolbarError("Finish the current edit before applying a suggestion."); return; }
    setSuggestionApplyError(undefined);
    try {
      if (disposition === "ApplyToDraft") {
        if (!item && scope().kind === "value") {
          const controller = focusedExpressionController();
          if (!controller) throw new Error("Wait for this data's editing tools.");
          controller.stageValue({ path: [], expr: node });
          setAppliedNotice(undefined);
          return;
        }
        // Root-card actions retain their existing destination and Undo (review S5).
        const subject = item ?? lensExpressionSubject()?.item;
        if (!subject) throw new Error("The original data is unavailable.");
        const previous = item ? resolveExpr(item, savedExprById()) ?? undefined
          : subject.source?.kind === "expr" ? subject.source.expr : undefined;
        const writeOrigin = origin ?? (item ? undefined : focusedExpressionState().saveOrigin);
        const destination = await homeData.saveInspection(subject, node, undefined, writeOrigin);
        if (destination === "lens") throw new Error("This data cannot be changed here. Use New data from this.");
        // Home has no history: offer this one change back (the same write).
        if (previous) setAppliedNotice({ message: `Applied ${suggestion.label}`, itemId: subject.id, undo: async () => {
          setAppliedNotice(undefined);
          setSuggestionApplyError(undefined);
          try { await homeData.saveInspection(subject, previous, undefined, writeOrigin); }
          catch (error) {
            const message = error instanceof Error ? error.message : String(error);
            setToolbarError(message); setSuggestionApplyError(message);
          }
        } });
        return;
      }
      const data = root();
      if (data?.canEdit !== true) { createModalCtx.composeSuggestion(node, { evaluate: true }); return; }
      const resultType = suggestion.resultScheme && suggestion.resultScheme.quantified.length === 0
        ? suggestion.resultScheme.body : undefined;
      const occurrence: LayoutItem = { id: genId(), caption: suggestion.label, source: { kind: "expr", expr: node },
        ...(resultType ? { valueType: resultType } : {}) };
      const sourceId = item?.id ?? lensExpressionSubject()?.item?.id;
      if (!await insertRootCardAfter(sourceId, occurrence))
        await openCreatedSuggestion(node, occurrence, { kind: "root", rootId: data.id });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      setToolbarError(message); setSuggestionApplyError(message);
    }
  }
  /** A new root card placed right after its source where that card is in view
   *  (the root list); otherwise appended. Answers whether it was placed beside. */
  async function insertRootCardAfter(sourceId: string | undefined, occurrence: LayoutItem): Promise<boolean> {
    const items = root()?.items ?? [];
    const at = sourceId && untrack(scope).kind === "root" ? items.findIndex(row => row.id === sourceId) : -1;
    if (at < 0) {
      await changeRoot({ kind: "append", item: occurrence });
      return false;
    }
    const order = items.map(row => row.id);
    order.splice(at + 1, 0, occurrence.id);
    await changeRoot(at === items.length - 1 ? { kind: "append", item: occurrence }
      : { kind: "batch", commands: [{ kind: "append", item: occurrence }, { kind: "reorder", itemIds: order }] });
    return true;
  }
  /** Demo 1 (Rom, Nov 8): the data of a type, as one list. A Local tab
   *  publishes, per declared type, the list of its cards' references
   *  (`<tab>:instances:<type>`, Fenel `view:tabDataRoot`); undefined where the
   *  root publishes none (an account root). */
  function typeInstancesReference(typeId: string): { id: string; handle: string } | undefined {
    const data = root();
    if (data?.canEdit !== true) return undefined;
    const prefix = `${data.referenceId}:instances:`;
    const identity = (handle: string) => reader?.kind === "local" ? reader.catalogLookups.entityOwner?.(handle)?.id ?? handle : handle;
    const handles = Object.keys(data.expressions ?? {}).filter(id => id.startsWith(prefix)).map(id => id.slice(prefix.length));
    const wanted = identity(typeId);
    const handle = handles.find(candidate => candidate === typeId) ?? handles.find(candidate => identity(candidate) === wanted);
    return handle === undefined ? undefined : { id: prefix + handle, handle };
  }
  /** "See all <Type>" is an action whose result is that list: a new card
   *  reading the published reference (live: a new value of the type joins it,
   *  an edit of one shows in it), typed `List <Type>`, right after the type's
   *  card. Its ordinary menu then offers Open beside, Suggestions, ... */
  async function seeAllOfType(typeCard: LayoutItem, reference: { id: string; handle: string }, label: string) {
    if (editingDraftOpen()) { setToolbarError("Finish the current edit first."); return; }
    try {
      const occurrence: LayoutItem = { id: genId(), caption: `All ${label}`,
        source: { kind: "expr", expr: { kind: "ref", savedExprId: reference.id } }, valueType: List({ $ref: reference.handle }) };
      await insertRootCardAfter(typeCard.id, occurrence);
    } catch (error) {
      setToolbarError(error instanceof Error ? error.message : String(error));
    }
  }

  // The four creation presets share the picker with an unrestricted
  // expression entry, which opens the editor with an inferred type.
  const [picking, setPicking] = createSignal(initialAction === "new");
  const editingDraftOpen = () => !!editing() || composing() || typeComposing() || fnComposing() || !!calling() || !!quickValue();
  /** Polish item 1 (Nov 8): one field of a card written in place from the
   *  small edit card. The edit is the item editor's Apply on a smaller draft:
   *  the field's value becomes an expression of the field's type, the card's
   *  authored expression is rewritten only at that path (references and calls
   *  elsewhere stay), the whole result passes the item editor's save check
   *  against the card's type, and the write is the same replace (a local draft
   *  until Save when synchronization is off or in Local). */
  /** Where a card's field may be written in place: a writable root or list
   *  card, or a card inside an authored value scope (not a followed reference). */
  function fieldEditAvailable(item: LayoutItem): boolean {
    if (props.publicData || !homeData.canWrite() || item.id.startsWith("$lens")) return false;
    if (scope().kind !== "value") return item.id !== "$self" && homeData.canEditExpression();
    const state = valueScope();
    return !!state?.ok && !state.followedReference && (item.id === "$self" || childItemKey(item.id) !== undefined);
  }
  async function editFieldAt(item: LayoutItem | undefined, path: readonly (string | number)[], value: unknown,
    type: FenelType | undefined) {
    if (!item) throw new Error("This data is no longer here to change.");
    if (editingDraftOpen()) throw new Error("Finish the current edit first.");
    if (!fieldEditAvailable(item)) throw new Error("This data is read-only here.");
    if (path.length === 0) throw new Error("Edit the whole data in its editor.");
    if (scope().kind === "value") {
      // A card inside a value (an item of a list, or the value itself) is a
      // position in that value: the same path write-back as the item editor,
      // whose value-scope write runs the save check against the source's type.
      const session = transferSession();
      const fieldExpr = expressionForTransfer({ value, type, typeName: classifyData(value), source: "fenel" }, session.environment);
      const controller = focusedExpressionController();
      if (!controller) throw new Error("Wait for this data's editing tools.");
      const key = childItemKey(item.id);
      controller.stageValue({ path: [...(key === undefined ? [] : [key]), ...path], expr: fieldExpr });
      return;
    }
    const rootRevision = root()?.revision;
    const sourceTicket = rootSourceTicket();
    const epoch = sessionEpoch();
    const assertTarget = () => {
      assertCurrentSession(epoch);
      assertSourceTicket(sourceTicket);
      if (root()?.revision !== rootRevision) throw new Error("This data changed while preparing the edit. Try again with its current contents.");
    };
    const original = resolveExpr(item, savedExprById());
    if (!original) throw new Error("This data is no longer here to change.");
    const session = transferSession();
    const fieldExpr = expressionForTransfer({ value, type, typeName: classifyData(value), source: "fenel" }, session.environment);
    // Refuses a computed position (editableContainerAt): such a field has no
    // authored value of its own to change here.
    const rewritten = replaceExpressionAt(original, path, fieldExpr, expressionEditOptions());
    if (item.valueType) {
      let issue: string | undefined;
      if (!props.publicData && reader?.kind === "local") {
        issue = await localExpressionSaveIssue(rewritten, { reader, session: transferSession, saved: savedExprById(),
          expectedType: item.valueType, evaluate: true, signal: client.signal, current: assertTarget });
      } else {
        issue = draftSaveIssue(rewritten, session.environment, { expectedType: item.valueType,
          registry: session.registry, resolveSavedExpr: (id) => savedExprById().get(id),
          evaluatedValue: evaluateAuthoringExpression(rewritten, (id) => savedExprById().get(id), session).result,
          evaluateContext: session.evaluateContext });
      }
      if (issue) throw new Error(issue);
    }
    assertTarget();
    await homeData.replace(item, rewritten, item.valueType, homeData.revision(item), { path, expr: fieldExpr }, rootRevision,
      undefined, undefined, sourceTicket, assertTarget);
  }
  const [linkedDemoAdding, setLinkedDemoAdding] = createSignal(false);

  async function createLinkedDemo(kind: "numbers" | "showcase" | "recipe" = "numbers") {
    if (reader?.kind !== "local" || linkedDemoAdding()) return;
    const epoch = reader.epoch;
    const authoredRevision = reader.revision();
    setPicking(false);
    setLinkedDemoAdding(true);
    try {
      const { localTabDataSource } = await import("~/lib/local-locus-data");
      assertCurrentSession(epoch);
      client.signal?.throwIfAborted();
      const source = localTabDataSource();
      if (source.id !== client.rootId) throw new Error("The local source changed before the demo was added.");
      // B4 unit D: the starter is planned in this reader's worker
      // (`plan-reader-linked-demo`, the shared `linked-demo-plan.ts`: UUID
      // acquisition, checked type/ExprNode transport, Fenel-owned example data,
      // references and commands). The page only transacts the commands, under
      // the revision they were planned for; there is no page fallback.
      const planned = await runLocalReaderAction(reader, () => reader.session(), { method: "plan-reader-linked-demo", kind },
        readActionResult<Array<{ $tag: string; [key: string]: unknown }>>("linkedDemo", Array.isArray),
        { signal: client.signal });
      assertCurrentSession(epoch);
      client.signal?.throwIfAborted();
      if (planned.$tag === "Err") throw new Error(planned._0);
      const commands = planned._0;
      const changed = await source.transact(commands, authoredRevision, client.signal);
      assertCurrentSession(epoch);
      client.signal?.throwIfAborted();
      acknowledgeRootRevision(changed.id, changed.revision, changed);
      revalidate("savedQueries");
      revalidate("locusRoot");
      navigateScope(ROOT_SCOPE);
    } catch (error) {
      if (epoch === sessionEpoch() && !client.signal?.aborted) setToolbarError(error instanceof Error ? error.message : String(error));
    } finally {
      if (epoch === sessionEpoch() && !client.signal?.aborted) setLinkedDemoAdding(false);
    }
  }

  function itemDemoCopy(itemId: string | undefined, caption?: string) {
    if (root()?.canEdit === true) return undefined;
    return publicDemoCopyBranch(caption)
      ?? (scope().kind === "root" && itemId ? publicDemoCopyBranch(rowById(itemId)?.name) : undefined);
  }
  function focusDemoCopy() {
    if (root()?.canEdit === true) return undefined;
    const here = scope();
    if (here.kind === "value") {
      for (const step of here.path) {
        if (typeof step !== "string") continue;
        const branch = publicDemoCopyBranch(step);
        if (branch) return branch;
      }
    }
    if (here.kind === "root") return undefined;
    return publicDemoCopyBranch(rowById(here.viewId)?.name);
  }
  /** Edit in Local beside the value's name, with Save and Discard (owner review, Nov 11). */
  const focusEditInLocal = { offered: () => !!focusDemoCopy(), disabled: () => linkedDemoAdding(),
    onEdit: () => { const next = focusDemoCopy(); if (next) pickCreationBranch(next); } };
  function pickCreationBranch(branch: "new:value" | "new:type" | "new:function" | "new:expression" | "new:showcase-demo" | "new:recipe-demo") {
    const localDemo = branch === "new:showcase-demo" || branch === "new:recipe-demo";
    // Public and Local are different addresses. Remember the copy, then open Local.
    if (localDemo && reader?.kind !== "local") {
      setPicking(false);
      armPublicDemoCopy(branch);
      navigate(branch === "new:recipe-demo" ? "/~?new=recipe" : "/~?new=showcase");
      return;
    }
    if (rootShelf && (localDemo ? reader?.kind !== "local" : root()?.canEdit !== true)) {
      const epoch = sessionEpoch();
      const rootId = root()?.id;
      const focus = scopeKey(scope());
      setPicking(false);
      queueMicrotask(() => {
        if (epoch === sessionEpoch() && !client.signal?.aborted && root()?.id === rootId && scopeKey(scope()) === focus) rootShelf.request(branch);
      });
      return;
    }
    setPicking(false);
    if (branch === "new:recipe-demo") { void createLinkedDemo("recipe"); return; }
    if (branch === "new:showcase-demo") { void createLinkedDemo("showcase"); return; }
    if (branch === "new:type") { setTypeComposing(true); return; }
    if (branch === "new:function") { setFnComposing(true); return; }
    setComposeExpression(branch === "new:expression");
    setComposing(true);
  }

  const navigate = useNavigate();

  // Surface failed mutations from the toolbar (layout switch, rename,
  // activate, …). Without this they silently bubbled out as unhandled
  // rejections — fine on desktop with devtools open, invisible on mobile.
  const [toolbarError, setToolbarError] = createSignal<string | null>(null);

  // Drag-pin drawer — left/right slide-in showing the same data
  // universe as /app/data plus the user's saved expressions, with the
  // same parser-driven search. Drop on the home content (or click) to
  // pin.
  // A pin picked in the shell's drawer arrives with the drawer still open, so
  // the user lands where they were rather than on a bare canvas.
  const [drawerOpen, setDrawerOpen] = createSignal(
    initialAction === "browse" || initialAction === "search" || !!initialPin || !!initialBrowse);
  const [drawerQuery, setDrawerQuery] = createSignal(initialBrowse?.query ?? "");
  // Solid 2 evaluates these memos even with the drawer hidden. Keep both its
  // reads and expensive catalog build out of the initial Home data load.
  const drawerTypes = createMemo(() => drawerOpen() && !props.publicData ? getTypes() : undefined);
  const drawerFns = createMemo(() => drawerOpen() && !props.publicData ? getFunctions() : undefined);

  const drawerDataItems = createMemo<DataItem[]>(() =>
    drawerOpen() ? props.publicData ? getCatalog().flatMap((section) => section.entries.flatMap((entry) => {
      const item = entryToItem(entry);
      return item && props.publicData!.catalogPaths.has(item.routeId) ? [item] : [];
    })) : buildDataItems({
      catalog: reader ? [...getCatalog()] : undefined,
      userTypes: ((drawerTypes() as any)?.types ?? []) as never[],
      userFns: ((drawerFns() as any)?.functions ?? []) as never[],
    }) : [],
  );

  // List of saved expressions for the drawer.
  const savedExpressions = createMemo(() => {
    const list = ((savedAll() as any)?.queries ?? []) as any[];
    return list
      .filter((sq) => (sq.query as any)?.kind === "data-search" || (sq.query as any)?.kind === "expression")
      .filter((sq) => (sq.query as any)?.expr)
      // A value need not be named (its name is a `Labelable` instance, and it
      // may have none). Normalise the absence HERE so no downstream reader has
      // to remember that — one of them called `.toLowerCase()` on it.
      .map((sq) => ({ id: sq.id, name: (sq.name as string | null) ?? "", description: sq.description as string | null }));
  });

  /** Browse and search are ONE question: this is it with an empty query.
   *  Sorted by label and capped so opening the panel is a list, not a wall. */
  const drawerBrowseItems = createMemo<DataItem[]>(() => drawerQuery().trim()
    ? []
    : [...drawerDataItems()].sort((a, b) => a.label.localeCompare(b.label)).slice(0, 120));
  /** ...and this is it with one. Sliced and abortable: deciding whether the
   *  typed text is a value of each scalar-shaped type in the catalog builds a
   *  validation plan per candidate, and matching identifiers is subtype-aware
   *  over the whole universe. Run inside a memo a keystroke invalidates, that
   *  was seconds of blocked main thread per character — the caret fell behind
   *  the typing and the browser offered to kill the page. */
  const searchResult = createSlicedSearch({
    query: () => drawerOpen() ? drawerQuery() : "",
    items: drawerDataItems,
    registry: () => props.publicData?.registry ?? accountFieldRegistry(),
    // B4 wave 4 lane H: a Local reader's value half runs in its worker.
    ...(reader?.kind === "local" ? { values: (query: string, items: DataItem[], signal: AbortSignal) =>
      localValueSearch(reader, homeAuthoringSession, query, items, signal) } : {}),
  });
  const drawerSavedMatches = createMemo(() => {
    const text = drawerQuery().trim().toLowerCase();
    if (!text) return savedExpressions();
    return savedExpressions().filter((sq) =>
      sq.name.toLowerCase().includes(text)
      || sq.id.toLowerCase().includes(text)
      || (sq.description ?? "").toLowerCase().includes(text),
    );
  });
  function pinCatalogItem(item: DataItem) {
    const expr = catalogReferenceExpr({ kind: item.kind, id: item.routeId });
    void homeData.add({ expr }, item.label);
  }
  function openPublicCatalogItem(item: DataItem) {
    const address = props.publicData?.catalogPaths.get(item.routeId);
    if (!address || !root()) return;
    setDrawerOpen(false);
    navigateScope({ kind: "value", viewId: root()!.id, itemId: address.itemId, path: [...address.path], rootItem: true });
  }
  function catalogRow(item: DataItem, detail?: string): BrowseRow {
    return {
      id: `${item.kind}:${item.routeId}`,
      label: item.label,
      detail: detail || item.description || undefined,
      badge: item.kind,
      drag: (transfer: DataTransfer) => {
        transfer.setData("application/x-fenel-pin",
          JSON.stringify({ $pin: item.kind, name: item.routeId, id: item.routeId }));
        transfer.setData("application/x-fenel-pin-caption", item.label);
      },
      pick: () => props.publicData ? openPublicCatalogItem(item) : pinCatalogItem(item),
      open: () => {
        if (props.publicData) { openPublicCatalogItem(item); return; }
        if (reader) {
          setDrawerOpen(false);
          openItemEditor({ homeId: "", standalone: "definition", item: {
            id: `browse:${item.kind}:${item.routeId}`, caption: item.label,
            source: { kind: "expr", expr: catalogReferenceExpr({ kind: item.kind, id: item.routeId }) },
          } });
          return;
        }
        setDrawerOpen(false); navigate(`${item.routeBase}${encodeURIComponent(item.routeId)}`);
      },
    };
  }
  /** One list. The groups are the old two surfaces' sections, in the order a
   *  locus cares about: what you could CREATE from what you typed, what you
   *  already saved, then the catalog behind it. */
  const browseGroups = createMemo<BrowseGroup[]>(() => {
    if (props.pane?.source().$tag === "AllDataSource") return [{ id: "data", title: "All data",
      rows: (root()?.items ?? []).filter(item => matchesUserQuery({ routeId: item.id, label: locale(item.representations?.Labelable?.label) || item.caption || "Data", description: "" }, drawerQuery())).map(item => ({
        id: item.id, label: locale(item.representations?.Labelable?.label) || item.caption || "Data",
        pick: () => { setDrawerOpen(false); homeData.enter(item); },
        open: () => { setDrawerOpen(false); homeData.openLens(item); },
      })) }];
    const result = searchResult();
    const typed = drawerQuery().trim();
    const fresh = result.query === typed;
    return [
      { id: "create", title: "Create data", rows: (fresh && !props.publicData ? result.values : []).map((suggestion) => ({
        id: `create:${suggestion.id}`,
        label: suggestion.label,
        detail: suggestion.detail,
        badge: suggestion.status === "complete" ? "new data" : "incomplete",
        disabled: suggestion.status !== "complete",
        pick: () => {
          if (suggestion.status !== "complete") return;
          setDrawerOpen(false);
          setComposePresetType(suggestion.typeName);
          setComposePresetExpr({ kind: "literal", value: suggestion.value });
          setComposing(true);
        },
      })) },
      { id: "saved", title: "Saved data", rows: [], pendingLabel: "Reading saved data…", readRows: () => drawerSavedMatches().map((row) => ({
        id: `saved:${row.id}`,
        label: row.name || "Untitled",
        detail: row.description ?? undefined,
        drag: (transfer: DataTransfer) => {
          transfer.setData("application/x-fenel-savedexpr-id", row.id);
          transfer.setData("application/x-fenel-savedexpr-name", row.name);
        },
        pick: () => void homeData.add({ savedExprId: row.id }, row.name || undefined),
        open: () => {
          setDrawerOpen(false);
          if (reader) openSavedItemEditor(row.id, row.name || "Untitled");
          else navigate(`/app/values?id=${encodeURIComponent(row.id)}`);
        },
      })) },
      { id: "catalog", title: typed ? "Identifiers" : "Catalog",
        rows: [], pendingLabel: "Reading the catalog…", readRows: () => typed
          ? (fresh ? result.identifiers : []).map((match) => catalogRow(match.item, match.reasonText))
          : drawerBrowseItems().map((item) => catalogRow(item)) },
    ];
  });
  const browsePending = createMemo<BrowsePending[]>(() => {
    if (props.pane?.source().$tag === "AllDataSource") return [];
    const result = searchResult();
    return result.running || result.query !== drawerQuery().trim()
      ? [{ id: "searching", label: "Searching…" }] : [];
  });

  // SavedValues for the context — same source as savedExprById, with name
  // attached so LiteralEditor's "+ ref" picker can show real labels.
  const savedValues = createMemo<SavedValueOption[]>(() => {
    const list = ((savedAll() as any)?.queries ?? []) as any[];
    return savedValueOptions(root(), list
      .filter((sq) => (sq.query as any)?.kind === "expression")
      .filter((sq) => (sq.query as any)?.expr)
      .map((sq) => ({
        id: sq.id as string,
        name: (sq.name as string | null) ?? "",
        expr: (sq.query as any).expr as ExprNode,
      })));
  });
  const savedValuesById = createMemo(() => {
    const m = new Map<string, SavedValueOption>();
    for (const sv of savedValues()) m.set(sv.id, sv);
    return m;
  });
  const savedValuesProvider: SavedValuesProvider = {
    list: () => savedValues(),
    byId: (id) => savedValuesById().get(id),
  };

  function transferSession() {
    if (!props.publicData) return homeAuthoringSession();
    if (reader?.kind !== "public") return props.publicData.session;
    const source = homeAuthoringSession();
    if (concreteAuthoringSession(source) !== props.publicData.session)
      throw new Error("This public data's reader changed. Reopen the data and retry.");
    return source;
  }

  // References are followed through `resolveCatalogReference`: the committed
  // registry is scoped to this session, so a label or a browser-supplied
  // account id never widens what can be followed.

  const [importing, setImporting] = createSignal(0);
  const [transferSequence, setTransferSequence] = createSignal(0);
  const [transferComplete, setTransferComplete] = createSignal(false);
  const [dropOver, setDropOver] = createSignal(false);
  const [importNotice, setImportNotice] = createSignal<string>();
  let stage: HTMLDivElement | undefined;
  let importChain = Promise.resolve();
  const importControllers = new Set<AbortController>();
  onCleanup(() => { for (const controller of importControllers) controller.abort(); });

  /** B4 unit D: `transferCaptions` for a Local reader, in its worker
   * (`project-reader-transfer-captions`); items travel as the worker's
   * structured clone, as `analyze-transfer` items do. */
  async function localTransferCaptions(items: readonly TransferItem[], signal?: AbortSignal): Promise<Array<string | undefined>> {
    const answer = await runLocalReaderAction(reader, transferSession, { method: "project-reader-transfer-captions", items },
      readActionResult<Array<string | undefined>>("captions", Array.isArray), { signal, via: "reader" });
    if (answer.$tag === "Err") throw new Error(answer._0);
    return answer._0;
  }
  function importIntoView(captured: TransferSnapshot, viewId = current()?.id, hint?: PlacementHint,
    retainedTicket?: WorkspaceTransferTicket) {
    const epoch = sessionEpoch();
    const controller = new AbortController();
    const local = reader?.kind === "local";
    const localRoot = local && viewId === client.rootId && scope().kind === "root";
    const ticket = retainedTicket ?? (local ? queueWorkspaceTransfer(captured, localRoot ? undefined : viewId,
      hint && "x" in hint ? hint : undefined, transferOwner, localRoot ? { initialLocalRoot: true } : undefined) : undefined);
    importControllers.add(controller);
    setImporting((count) => count + 1);
    setTransferComplete(false);
    setTransferSequence(sequence => sequence + 1);
    importChain = importChain.then(async () => {
      assertCurrentSession(epoch);
      controller.signal.throwIfAborted();
      if (ticket && !claimWorkspaceTransfer(ticket, transferOwner, localRoot ? { resumeInitialLocalRoot: true } : undefined)) return;
      if (localRoot && client.ingestExternal) {
        const added = await client.ingestExternal(captured, { signal: controller.signal,
          onPublished: receipt => {
            if (ticket) acknowledgeWorkspaceTransfer(ticket, transferOwner);
            acknowledgeRootRevision(receipt.root.id, receipt.root.revision, { root: receipt.root });
            setImportNotice(receipt.notes.join(" ") || undefined);
            setTransferComplete(true);
            completeImport();
          } });
        if (added) {
          if (epoch === sessionEpoch()) {
            revalidate(["locusRoot", "locusViews", "activeLocusView"]);
            await refresh(all);
          }
          return;
        }
        // General data keeps this same receipt while the existing receiver
        // checker runs; only its final source publication can retire it.
      }
      const items = await ingestTransfer(captured, { signal: controller.signal });
      controller.signal.throwIfAborted();
      assertCurrentSession(epoch);
      const session = transferSession();
      const analyzed = await analyzeWorkspaceTransfer(items, session, controller.signal);
      controller.signal.throwIfAborted();
      assertCurrentSession(epoch);
      controller.signal.throwIfAborted();
      assertCurrentSession(epoch);
      const row = viewId ? rowById(viewId) : current();
      if (!row) throw new Error("The destination list is no longer available. Paste again into the current data.");
      // B4 unit D: a Local reader names pasted items in its worker.
      const captions = local ? await localTransferCaptions(items, controller.signal)
        : transferCaptions(items, { registry: session.registry, evaluateContext: session.evaluateContext });
      controller.signal.throwIfAborted();
      assertCurrentSession(epoch);
      const additions = analyzed.map((item, index): LayoutItem => {
        return {
            id: genId(), ...(captions[index] ? { caption: captions[index] } : {}),
            source: { kind: "expr", expr: item.expr }, valueType: item.type,
          x: clamp01((hint && "x" in hint ? hint.x : 0.18) + index * 0.035),
          y: clamp01((hint && "y" in hint ? hint.y : 0.18) + index * 0.035),
        };
      });
      if (local && additions.length === 0) {
        if (ticket) acknowledgeWorkspaceTransfer(ticket, transferOwner);
        completeImport();
        return;
      }
      if (row.id === root()?.id) {
        // One batch per 256 items (the server's atomic limit): a failure
        // saves none of a batch, so pasting again cannot duplicate it.
        const items = additions.map(({ x: _x, y: _y, ...item }) => item);
        for (let start = 0; start < items.length; start += 256) {
          await changeRoot({ kind: "batch", commands: items.slice(start, start + 256).map((item) => ({ kind: "append" as const, item })) },
            undefined, undefined, local && start + 256 >= items.length ? { onPublished: () => {
              if (ticket) acknowledgeWorkspaceTransfer(ticket, transferOwner);
              setTransferComplete(true);
            } } : undefined);
        }
        completeImport();
        return;
      }
      const view = viewPersistence.read(row.id, asView(row.view));
      for (const item of additions) {
        if (view.kind === "calendar") item.date = hint && "date" in hint ? hint.date : isoDate(new Date());
        if (view.kind === "timeline") item.ts = hint && "ts" in hint ? hint.ts : Date.now();
        if (view.kind === "map") {
          item.lat = hint && "lat" in hint ? hint.lat : view.center?.lat ?? 0;
          item.lng = hint && "lng" in hint ? hint.lng : view.center?.lng ?? 0;
        }
      }
      viewPersistence.update(row.id, view.kind === "tree" && hint && "parentId" in hint
        ? additions.reduce((next, item) => appendTreeChild(next, hint.parentId, item), view)
        : { ...view, items: [...view.items, ...additions] });
      setImportNotice(items.map((item) => item.note).filter(Boolean).join(" ") || undefined);
      if (!await viewPersistence.flush(row.id)) throw new Error("The data is kept here, but saving failed. Retry from the notifications menu.");
      controller.signal.throwIfAborted();
      assertCurrentSession(epoch);
      if (ticket) acknowledgeWorkspaceTransfer(ticket, transferOwner);
      completeImport();
    }).catch((error) => {
      afterImport = undefined;
        if (!controller.signal.aborted && epoch === sessionEpoch()) {
          // This prepared surface reports a refused event in its toolbar;
          // it has no retained Retry action that could own a FIFO head.
          if (ticket) acknowledgeWorkspaceTransfer(ticket, transferOwner);
          setToolbarError(error instanceof Error ? error.message : String(error));
        }
    }).finally(() => {
        if (ticket) releaseWorkspaceTransfer(ticket, transferOwner);
      importControllers.delete(controller);
      if (!controller.signal.aborted && epoch === sessionEpoch()) setImporting((count) => count - 1);
    });
  }

  const valueRevisions = sharedWrites.valueRevisions;
  const pendingValueWrites = sharedWrites.pendingValues;
  const [valueSaving, setValueSaving] = createSignal(0);
  const releaseTransferSession = onBrowserSessionChange(() => {
    for (const controller of importControllers) controller.abort();
    importControllers.clear();
    valueRevisions.clear();
    pendingValueWrites.clear();
    setImporting(0);
  });
  onCleanup(releaseTransferSession);
  // A value's edit counter is keyed by WHERE THE VALUE LIVES, never by where
  // you are standing — the same item edited from its card and from inside it
  // must share one counter, or two concurrent edits look independent.
  const valueMutationKey = (item: LayoutItem) => item.source?.kind === "ref"
    ? `saved:${item.source.ref.id}` : `view:${scopeViewId(scope()) ?? "root"}:${item.id}`;
  /** A constructor application in a stored value is data the paste codec
   *  wrote for a typed value: its fields are edited in place, named by the
   *  constructor's parameters in this account's authoring session. */
  const expressionEditOptions = (session: AuthoringSession = transferSession()): ExpressionEditOptions => ({
    constructorFields: (fnId) => {
      const entry = session.environment.getFunctionEntry?.(fnId) as
        { kind?: string; params?: readonly { name: string }[] } | undefined;
      return entry?.kind === "constructor" && entry.params ? entry.params.map((param) => param.name) : undefined;
    },
  });
  const appendAll = (expr: ExprNode, path: readonly LocusPathStep[], entries: readonly ExprNode[]) =>
    entries.reduce((current, entry) => appendExpressionAt(current, path, entry, expressionEditOptions()), expr);
  // Scoped cards carry already-computed data, including data that happens to
  // resemble an editor marker. Keep that host projection outside persisted
  // LayoutItem wires; every renderer can read it without invoking the codec.
  const renderedValues = new WeakMap<ExprNode, RenderedCardValue>();
  function renderedDataExpression(value: unknown, authored?: Pick<RenderedCardValue, "source" | "sourcePath">): ExprNode {
    const expr: ExprNode = { kind: "literal", value };
    renderedValues.set(expr, { value, ...authored });
    return expr;
  }
  function itemIsUnsaved(item: LayoutItem): boolean {
    const drafts = client.drafts;
    if (!drafts) return false;
    const paneWrites = pendingViewWrites();
    const synthetic = item.id === "$self" || childItemKey(item.id) !== undefined;
    if (!synthetic && drafts.dirty(item.id) || item.source?.kind === "ref" && drafts.dirty(item.source.ref.id)) return true;
    const pending = drafts.pending();
    // Known source status must not wait for an unrelated root/evaluation read.
    if (pending === 0 && paneWrites.length === 0) return false;
    const here = scope();
    const state = here.kind === "value" && synthetic
      ? valueScope() : undefined;
    const owner = state?.ok ? state.item : item;
    if (drafts.dirty(owner.id) || owner.source?.kind === "ref" && drafts.dirty(owner.source.ref.id)) return true;
    if (paneWrites.length > 0) {
      const row = current();
      if (row && paneWrites.some(write => write.id === row.id)) {
        const held = findLocusItem(row.view.items, owner.id);
        const original = findLocusItem(rowById(row.id)?.view.items ?? [], owner.id);
        if (held && draftValueFingerprint(held) !== draftValueFingerprint(original)) return true;
      }
    }
    if (pending === 0) return false;
    const expression = resolveExpr(owner, savedExprById());
    if (expression?.kind === "ref" && drafts.dirty(expression.savedExprId)) return true;
    const reference = expression?.kind === "literal" ? readLocusCatalogReference(expression.value) : undefined;
    if (!reference) return false;
    if (drafts.dirty(reference.id)) return true;
    // B4 wave 4 lane H: a Local reader's definition ids are its worker's
    // catalogue answers (pending: not known to be unsaved yet).
    const definitionId = reader?.kind === "local"
      ? (reader.catalogLookups.fn(reference.id) as FenelFunction | undefined)?.id ?? reader.catalogLookups.entityOwner?.(reference.id)?.id
      : (() => {
        const registry = homeAuthoringSession().registry;
        return registry.getFunction(reference.id)?.id ?? registry.getIdentifiedEntity(reference.id)?.id;
      })();
    return definitionId !== undefined && drafts.dirty(definitionId);
  }
  const homeData = {
    referencesReady: () => !savedAll().failed,
    unsaved: itemIsUnsaved,
    appliedUndo: (itemId: string) => {
      const applied = appliedNotice();
      return applied && applied.itemId === itemId ? { message: applied.message, undo: () => { void applied.undo(); } } : undefined;
    },
    typeOrdinal: (item: LayoutItem) => {
      const row = scopeSubject().row;
      return row ? cardTypeOrdinal(row.view.items, item, (card) => cardConstructorKey(resolveExpr(card, savedExprById()))) : undefined;
    },
    // Inside a value, the cards can be changed only where the container they
    // sit in is authored data all the way down. Offering an edit through a
    // saved-value reference or a computation would only be refused later,
    // after "+ New" had already saved a value it then cannot place.
    canWrite: () => {
      if (valueScopeLoading()) return false;
      const state = valueScope();
      const here = scope();
      return root()?.canEdit === true && (!state || state.ok && !state.followedReference && here.kind === "value"
        && (state.leaf
          ? (here.path.length === 0 ? state.sourceExpression.kind === "literal"
            : editableContainerAt(state.sourceExpression, here.path.slice(0, -1), expressionEditOptions()))
          : editableContainerAt(state.sourceExpression, here.path, expressionEditOptions())));
    },
    canArrange: () => {
      if (valueScopeLoading()) return false;
      const state = valueScope();
      const here = scope();
      return root()?.canEdit === true && (!state || state.ok && !state.followedReference && here.kind === "value"
        && (here.path.length === 0 && isCanvasExpression(state.sourceExpression, canvasFunctions())
          || !state.leaf && editableContainerAt(state.sourceExpression, here.path, expressionEditOptions())));
    },
    canAdd: () => {
      const state = valueScope();
      return homeData.canWrite() && (!state || state.ok && Array.isArray(state.container));
    },
    canNest: () => scope().kind === "view" && homeData.canArrange(),
    session: transferSession,
    evaluated: (item: LayoutItem) => {
      const expr = resolveExpr(item, savedExprById());
      return expr ? renderedValues.get(expr) : undefined;
    },
    listSummary: (item: LayoutItem) => {
      if (scope().kind !== "root") return undefined;
      const row = homes().find((row) => row.id === item.id);
      return row ? { name: row.name, count: row.view.items.length, items: row.view.items,
        type: item.valueType ?? root()?.lists.find((list) => list.id === item.id)?.valueType,
        savedExprById: savedExprById(),
        enter: (child: LayoutItem) => navigateScope({ kind: "value", viewId: row.id, itemId: child.id, path: [] }) } : undefined;
    },
    async add(source: { expr: ExprNode; valueType?: FenelType } | { savedExprId: string; valueType?: FenelType }, caption?: string, hint?: PlacementHint,
      _client?: import("~/lib/api").ApiClient, occurrence?: { id: string }) {
      try {
        if (accountSelectionPending()) throw new Error("Wait for the account change to finish.");
        const here = scope();
        const epoch = sessionEpoch();
        const sourceRoot = root()?.id;
        // Creation can save definitions/representations before adding their
        // references. Read the committed destination after those writes; this
        // refresh retains optimistic list drafts and their authored CAS base.
        // Bounded like changeRoot's catch-up: past the wait, a plain append reads
        // the source itself, and any other command keeps its compare-and-swap
        // (a stale display fails visibly; it is never written blindly).
        revalidate(["locusRoot", "locusViews", "activeLocusView"]);
        await settleWithin(refresh(all), DISPLAY_CATCH_UP_WAIT_MS);
        if ("savedExprId" in source) {
          revalidate("savedQueries");
          await settleWithin(refresh(savedAll), DISPLAY_CATCH_UP_WAIT_MS);
        }
        if (here.kind === "value") await valueScopeResponse.refetch();
        assertCurrentSession(epoch);
        if (root()?.id !== sourceRoot || scopeKey(scope()) !== scopeKey(here)) throw new Error("The destination changed while preparing this data.");
        if (!homeData.canAdd()) throw new Error("Add data in an editable list.");
        const expr: ExprNode = "savedExprId" in source ? { kind: "ref", savedExprId: source.savedExprId } : source.expr;
        if (here.kind === "value") {
          const state = valueScope();
          if (!state?.ok) throw new Error("This data is no longer here to change.");
          if (occurrence && "savedExprId" in source && expressionMentions(expressionAt(state.sourceExpression, here.path, expressionEditOptions())).refs.includes(source.savedExprId)) return true;
          await writeValueScopeExpression(state, appendExpressionAt(state.sourceExpression, here.path, expr, expressionEditOptions()));
        } else {
          const item: LayoutItem = { id: occurrence?.id ?? genId(), caption, valueType: source.valueType,
            source: "savedExprId" in source ? { kind: "ref", ref: { kind: "savedExpr", id: source.savedExprId } }
              : { kind: "expr", expr } };
          if (here.kind === "root") {
            if (root()?.items.some(existing => existing.id === item.id)) return true;
            if (hint && "afterId" in hint) await insertRootCardAfter(hint.afterId, item);
            else await changeRoot({ kind: "append", item });
          }
          else {
            const row = current();
            if (!row) throw new Error("This list is no longer here.");
            const view = row.view;
            if (view.items.some(existing => existing.id === item.id)) {
              if (!await viewPersistence.flush(row.id)) throw new Error("The data is kept here, but saving failed. Retry from the notifications menu.");
              return true;
            }
            if (view.kind === "canvas" && hint && "x" in hint) { item.x = hint.x; item.y = hint.y; }
            viewPersistence.update(row.id, { ...view, items: [...view.items, item] });
            if (!await viewPersistence.flush(row.id)) throw new Error("The data is kept here, but saving failed. Retry from the notifications menu.");
          }
        }
        return true;
      } catch (error) { setToolbarError(error instanceof Error ? error.message : String(error)); return false; }
    },
    // Adding lands in the scope you are IN. At the root the items are data
    // sets, so a value dropped there becomes one; inside a value, it joins
    // the list you are looking at.
    import: (captured: TransferSnapshot, hint?: PlacementHint) => {
      if (!homeData.canWrite()) { setToolbarError("This data is read-only here."); return; }
      const here = scope();
      if (here.kind === "root") { void importIntoRoot(captured); return; }
      if (here.kind === "value") { void importIntoValueScope(captured); return; }
      importIntoView(captured, current()?.id, hint);
    },
    dataTarget: (item: LayoutItem) => {
      const expression = item.source?.kind === "expr" ? item.source.expr : item.expr;
      return props.pane?.source().$tag === "AllDataSource" && expression?.kind === "literal" ? readWorkspaceDataTarget(expression.value) : undefined;
    },
    canEnter: (item: LayoutItem, evaluated?: { value: unknown }) => enterScopeFor(item, evaluated) !== undefined,
    enter: (item: LayoutItem, evaluated?: { value: unknown }) => {
      const next = enterScopeFor(item, evaluated);
      if (next) navigateScope(next);
    },
    openLens: (item: LayoutItem, evaluated?: { value: unknown }, mode?: "stack" | "split") => {
      const expression = item.source?.kind === "expr" ? item.source.expr : item.expr;
      const target = props.pane?.source().$tag === "AllDataSource" && expression?.kind === "literal" ? readWorkspaceDataTarget(expression.value) : undefined;
      if (target && props.pane?.onDataTarget) { props.pane.onDataTarget(target, mode ?? "stack"); return; }
      const next = enterScopeFor(item, evaluated);
      if (next) {
        if (props.pane) props.pane.onOpenLens(next, mode);
        else navigateScope(next);
      }
    },
    enterPath: (item: LayoutItem, path: readonly LocusPathStep[], evaluated: { value: unknown }) => {
      const next = enterScopeFor(item, evaluated);
      if (next?.kind === "value") navigateScope({ ...next, path: [...next.path, ...path] });
    },
    scopeConfirmsRemoval: () => scope().kind !== "view",
    canEditExpression: () => homeData.canWrite() && scope().kind !== "value",
    canLift: (item: LayoutItem) => homeData.canWrite() && scope().kind === "value" && childItemKey(item.id) !== undefined
      && valueScope()?.ok === true && !(valueScope() as Extract<ValueScopeState, { ok: true }>).followedReference,
    liftLabel: () => {
      const up = parentScope(scope());
      return up ? `Move out to ${scopeLabel(up, scopeNames())}` : "Move out";
    },
    lift: (item: LayoutItem) => { void liftItem(item); },
    type(item: LayoutItem) {
      if (item.valueType) return item.valueType;
      const session = transferSession();
      const rendered = homeData.evaluated(item);
      const expr = rendered ? expressionForTransfer({ value: rendered.value, typeName: classifyData(rendered.value),
        source: "fenel" }, session.environment) : resolveExpr(item, savedExprById());
      if (!expr) return undefined;
      // Stored values are data: infer them as the transfer codec does, which
      // binds the list-literal helper to the exact std function even in the
      // detached environment that keeps no bare names.
      const result = inferTransferExpression(expr, { ...session.environment,
        resolveSavedExpr: (id) => savedExprById().get(id) });
      return result.outcome.$tag === "Solved" ? result.type : undefined;
    },
    savedValue(id: string) {
      const saved = savedValuesById().get(id);
      if (!saved) return undefined;
      const session = transferSession();
      // B4 wave 4 lane H: a Local reader evaluates and infers the saved value
      // in its worker (`evaluate-expression`, `infer-expression`); the pasted
      // item is the same data, named by the inferred type's display name.
      if (reader?.kind === "local") return (async () => {
        const sources = savedExprById();
        const evaluation = evaluateExpressionInWorker(session, saved.expr, sources);
        const inference = inferExpressionsInWorker(session, [expressionInferenceItem(saved.expr, session)], sources);
        if (!evaluation || !inference) throw new Error(LOCAL_SAVE_TOOLS_PENDING);
        const [evaluated, [inferred]] = await Promise.all([evaluation, inference]);
        const typeName = inferred?.type ? typeDisplayName(inferred.type, authoringStructureEnvironment(session)) : undefined;
        return { value: evaluated.result, typeName: typeName ?? "Value", label: saved.name, source: "fenel" as const };
      })();
      const value = evaluateAuthoringExpression(saved.expr, (id) => savedExprById().get(id), session).result;
      return { value, typeName: inferExpressionTypeName(saved.expr, session) ?? "Value", label: saved.name, source: "fenel" as const };
    },
    async saveInspection(item: LayoutItem, expr: ExprNode, fn?: FenelFunction, origin?: InspectionSaveOrigin,
      receipt?: { body?: unknown }): Promise<"data" | "lens"> {
      const here = origin?.scope ?? scope();
      const epoch = origin?.epoch ?? sessionEpoch();
      const revision = origin?.rootRevision ?? root()?.revision;
      const sourceTicket = origin?.sourceTicket ?? rootSourceTicket();
      const checkDestination = () => {
        assertCurrentSession(epoch);
        assertSourceTicket(sourceTicket);
        if (scope() !== here) throw new Error("The lens changed while saving. Return to the data and try again.");
        if (root()?.revision !== revision) throw new Error("This data changed while saving. Try again with its current contents.");
      };
      checkDestination();
      if (props.publicData || item.id.startsWith("$lens:") || item.id === "$lens-subject") return "lens";
      if (fn) {
        const response = await getFunctionByName(fn.id);
        checkDestination();
        const row = persistedFunctionDefinition((response as { definition?: FunctionDefinitionRow } | null)?.definition);
        if (!row) return "lens";
        if (root()?.canEdit !== true) throw new Error("This account's data is read-only.");
        const session = await prepareAuthoringSessionForFunction(fn.id);
        checkDestination();
        let current: FenelFunction | undefined;
        let body: FenelFunction["body"];
        // The page's definition and the current one are compared as data.
        let comparable = (value: FenelFunction) => draftValueFingerprint(value);
        if (reader?.kind === "local") {
          // B4 unit D item 2: a Local reader reads the current definition and
          // lowers the body in the function's own worker frame (weight 0).
          const found = await runLocalReaderAction(reader, homeAuthoringSession, { method: "project-reader-references", targets: [fn.id],
            definitions: true }, readLocalDefinition, { via: session, signal: client.signal });
          body = loweredLogic(await runLocalReaderAction(reader, homeAuthoringSession, { method: "lower-reader-expression", node: expr,
            savedExpressions: [], unresolved: true }, reply => reply, { via: session, signal: client.signal })) as FenelFunction["body"];
          checkDestination();
          current = found;
          // The worker's answer crossed the canonical transport (sorted keys):
          // compare the page's definition under that same transport.
          comparable = value => draftValueFingerprint(registryTransportSnapshot(value, "Local function save check"));
        } else {
          current = session.registry.getFunction(fn.id);
          body = toLogic(expr, undefined, session) as FenelFunction["body"];
        }
        if (!current || comparable(current) !== comparable(fn)) {
          throw new Error("This function changed while editing. Your draft is kept here.");
        }
        const updated: FenelFunction = { ...fn, body };
        const storageName = row.name ?? fn.id;
        const committed = await api.definitionBundleSave({ ownerMutations: [functionDefinitionOwner(updated, row, storageName, reader)] });
        if (receipt) receipt.body = cloneDraftValue(body);
        assertCurrentSession(epoch);
        if (scope() !== here) return "data";
        void revalidate(["functions", `function:${storageName}`]);
        await reloadUserRegistries(committed);
        if (origin) { origin.rootRevision = root()?.revision; origin.sourceTicket = captureSourceTicket(); }
        return "data";
      }
      if (here.kind === "value") {
        const state = valueScope();
        // Fix lane A (Nov 8): this write REPLACES the expression at the
        // authored prefix of the scope's path (a value inside a computed
        // result saves its producer), so only the containers above that
        // prefix must be authored data; the value there may itself be
        // computed (after Reverse, `reverse(list)`). `canWrite` asks whether
        // cards can be added INTO it ("+ New").
        if (root()?.canEdit !== true || valueScopeLoading() || !state?.ok || state.followedReference) {
          throw new Error("This data is read-only here.");
        }
        checkDestination();
        const projection = projectAuthoredExpression(state.sourceExpression, here.path, expressionEditOptions());
        const authoredPath = here.path.slice(0, here.path.length - projection.sourcePath.length);
        // A child of a computed root has no independently authored source
        // here. Open the root producer to replace it; nested authored producers
        // remain editable at their own prefix without changing sibling sources.
        if (here.path.length > 0 && authoredPath.length === 0
          || authoredPath.length > 0 && !editableContainerAt(state.sourceExpression, authoredPath.slice(0, -1), expressionEditOptions())) {
          throw new Error("This data is read-only here.");
        }
        const rewritten = replaceExpressionAt(state.sourceExpression, authoredPath, expr, expressionEditOptions());
        await writeValueScopeExpression(state, rewritten, undefined, origin?.expectedSavedQuery, sourceTicket);
        if (origin) {
          origin.rootRevision = root()?.revision;
          origin.sourceTicket = captureSourceTicket();
          const expectedQuery = origin.expectedSavedQuery ?? state.sourceQuery;
          if (expectedQuery) origin.expectedSavedQuery = { ...expectedQuery, kind: "expression", expr: rewritten };
        }
        return "data";
      }
      if (!homeData.canEditExpression()) throw new Error("This data is read-only here.");
      checkDestination();
      await homeData.replace(item, expr, item.valueType, homeData.revision(item), undefined, revision, undefined, origin?.expectedSavedQuery, sourceTicket);
      if (origin) {
        origin.rootRevision = root()?.revision;
        origin.sourceTicket = captureSourceTicket();
        if (origin.expectedSavedQuery) origin.expectedSavedQuery = { ...origin.expectedSavedQuery, kind: "expression", expr };
      }
      return "data";
    },
    revision: (item: LayoutItem) => valueRevisions.get(valueMutationKey(item)) ?? 0,
    async replace(item: LayoutItem, expr: ExprNode, type?: FenelType, revision?: number,
      edit?: ValueEdit, rootRevision?: number, definitionBundle?: Parameters<typeof api.definitionBundleSave>[0], expectedSavedQuery?: Record<string, unknown>, sourceTicket = rootSourceTicket(), assertCurrent?: () => void) {
      assertCurrent?.();
      const epoch = sessionEpoch();
      assertSourceTicket(sourceTicket);
      const authoredRootRevision = rootRevision ?? root()?.revision;
      if (root()?.canEdit !== true) throw new Error("This account's data is read-only.");
      // A card inside a VALUE scope is a position in that value, not a row in
      // a data set. Editing it writes through the container it belongs to —
      // the same write-back the nested field editor already performs, applied
      // one scope out.
      const here = scope();
      const childKey = childItemKey(item.id);
      if (here.kind === "value" && (childKey !== undefined || item.id === "$self")) {
        const state = valueScope();
        if (!state?.ok) throw new Error("This data is no longer here to change.");
        const target = [...here.path, ...(childKey === undefined ? [] : [childKey]), ...(edit?.path ?? [])];
        await writeValueScopeExpression(state, edit && "append" in edit
          ? appendAll(state.sourceExpression, target, edit.append)
          : replaceExpressionAt(state.sourceExpression, target, edit?.expr ?? expr, expressionEditOptions()), definitionBundle, expectedSavedQuery, sourceTicket, assertCurrent);
        return;
      }
      if (edit) {
        const original = resolveExpr(item, savedExprById());
        if (!original) throw new Error("This data is no longer here to change.");
        // Only the changed part is written: appended items or one field. The
        // rest of the authored expression keeps its references and calls.
        expr = "append" in edit
          ? appendAll(original, edit.path, edit.append)
          : replaceExpressionAt(original, edit.path, edit.expr, expressionEditOptions());
      }
      const row = current();
      if (!row) throw new Error("Wait for this data to load before changing it.");
      const key = valueMutationKey(item);
      if (pendingValueWrites.has(key) || (revision !== undefined && revision !== (valueRevisions.get(key) ?? 0))) {
        throw new Error("Another edit to this data is being saved. Paste again after it finishes.");
      }
      const operation = {};
      pendingValueWrites.set(key, operation);
      setValueSaving((count) => count + 1);
      valueRevisions.set(key, (valueRevisions.get(key) ?? 0) + 1);
      try {
      if (definitionBundle) {
        if (!client.editDefinitionAndData || authoredRootRevision === undefined) throw new Error("This data source cannot save a definition and its data together.");
        const storedId = item.source?.kind === "ref" ? item.source.ref.id : undefined;
        const stored = storedId ? ((savedAll() as { queries?: Array<{ id: string; query: Record<string, unknown> }> })?.queries ?? [])
          .find(value => value.id === storedId) : undefined;
        if (storedId && !stored) throw new Error("This saved data is no longer available.");
        if (row.id !== root()?.id) throw new Error("This list cannot save a definition and its card together.");
        const occurrence: LocusRootCommand = { kind: "replace", itemId: item.id, item: { ...item,
          valueType: type ?? item.valueType,
          ...(storedId ? {} : { source: { kind: "expr", expr }, expr: undefined }),
        } };
        const changed = await enqueueRootWrite(() => {
          assertSourceTicket(sourceTicket);
          assertCurrent?.();
          return client.editDefinitionAndData!(definitionBundle, authoredRootRevision, {
            occurrence, ...(storedId && stored ? { savedValue: { id: storedId, expectedQuery: expectedSavedQuery ?? stored.query,
              query: { ...stored.query, kind: "expression", expr,
                ...(type ? { valueType: type } : {}) } } } : {}),
          });
        });
        assertCurrentSession(epoch);
        acknowledgeRootRevision(changed.root.id, changed.root.revision, changed);
        revalidate(["savedQueries", "locusRoot"]);
        await Promise.all([refresh(savedAll), refresh(all)]);
        return;
      }
      if (item.source?.kind === "ref") {
        const id = item.source.ref.id;
        const stored = ((savedAll() as any)?.queries ?? []).find((value: any) => value.id === id);
        if (!stored) throw new Error("This saved data is no longer available.");
        if (client.editSavedValue) {
          const expectedRevision = rootRevision ?? root()?.revision;
          if (expectedRevision === undefined) throw new Error("Wait for this data to load before changing it.");
          const changed = await client.editSavedValue(id, { ...stored.query, kind: "expression", expr,
            ...(type ? { valueType: type } : {}) }, expectedRevision,
            row.id === root()?.id ? { kind: "replace", itemId: item.id, item: { ...item, valueType: type ?? item.valueType } } : undefined,
            expectedSavedQuery ?? stored.query);
          assertCurrentSession(epoch);
          acknowledgeRootRevision(changed.root.id, changed.root.revision, changed);
          revalidate(["savedQueries", "locusRoot"]);
          await Promise.all([refresh(savedAll), refresh(all)]);
          return;
        }
        await api.savedQueryUpdate(id, { query: { ...stored.query, kind: "expression", expr }, expectedQuery: expectedSavedQuery ?? stored.query });
        assertCurrentSession(epoch);
        revalidate(["savedQueries"]);
        await refresh(savedAll);
      }
      assertCurrentSession(epoch);
      const latestRow = rowById(row.id);
      if (!latestRow) throw new Error("The destination list was removed while saving this data.");
      const view = viewPersistence.read(row.id, asView(latestRow.view));
      if (row.id === root()?.id) {
        // The item is the snapshot the edit was authored from, so the root
        // revision is too: a replace never adopts a later one silently.
        await changeRoot({ kind: "replace", itemId: item.id, item: { ...item,
          valueType: type ?? item.valueType,
          ...(item.source?.kind === "ref" ? {} : { source: { kind: "expr", expr }, expr: undefined }),
        } }, rootRevision ?? root()?.revision, sourceTicket);
        return;
      }
      viewPersistence.update(row.id, updateItemInView(view, item.id, (currentItem) => ({
        ...currentItem, valueType: type ?? currentItem.valueType,
        caption: item.caption, representations: item.representations,
        ...(item.source?.kind === "ref" ? {} : { source: { kind: "expr" as const, expr }, expr: undefined }),
      })));
      if (!await viewPersistence.flush(row.id)) throw new Error("The data is kept here, but saving failed. Retry from the notifications menu.");
      } finally {
        if (pendingValueWrites.get(key) === operation) pendingValueWrites.delete(key);
        if (epoch === sessionEpoch()) setValueSaving((count) => count - 1);
      }
    },
  };

  // -------------------------------------------------------------------------
  // The scope's SUBJECT — what the renderers draw, and where their edits go.
  //
  // Every scope produces the same two things: a list of cards, and one channel
  // to write changes back through. That is the whole of "views all the way
  // down": the eight layouts do not know which scope they are drawing, because
  // there is nothing scope-shaped for them to know.
  //
  //   root  — the data sets. Writing back creates and deletes sets.
  //   view  — a set's items. Writing back is the `locus_views` row. (Today.)
  //   value — one item's contents. Writing back edits the value.
  // -------------------------------------------------------------------------
  const accountKey = () => {
    if (reader) return reader.accountId ?? "public";
    const who = subject();
    return who?.$tag === "User" || who?.$tag === "Bot" ? who.accountId : "anonymous";
  };
  // Arrangement for the two scopes with no row of their own is browser-local
  // (`~/lib/locus-arrangement` says why, and what retires it). This counter is
  // what makes a drag there visible, since localStorage is not reactive.
  const [arrangementRevision, setArrangementRevision] = createSignal(0);

  /** The root's cards: one per data set, each a reference to it. */
  const rootItems = createMemo<LayoutItem[]>(() => root()?.items ?? []);

  type ValueScopeState =
    | {
        ok: true;
        row: LocusViewRow;
        item: LayoutItem;
        /** The actual producer's whole value, located by basePath in the item. */
        rootValue: unknown;
        /** The producer's checked type before following any result reference. */
        rootValueType: FenelType | undefined;
        basePath: readonly LocusPathStep[];
        itemType: FenelType | undefined;
        expressionOptions: ExpressionEditOptions;
        sourceWorker?: object;
        /** The value at the path: what you are inside. */
        container: unknown;
        children: { key: LocusPathStep; label: string; value: unknown }[];
        containerType: FenelType | undefined;
        sourceExpression: ExprNode;
        sourceSnapshot: ReadonlyMap<string, ExprNode>;
        sourceQuery?: Record<string, unknown>;
        sourceTicket: HomeSourceTicket;
        sourceSession: AuthoringSession;
        resolveReference: (reference: LocusCatalogReference) => ReturnType<typeof resolveLocusCatalogReference>;
        leaf: boolean;
        /** Whole-value Viewable and collection policy from this exact reader. */
        presentation?: SourceReaderValueReadPacket;
        rootRevision: number;
        scopeIdentity: string;
        epoch: number;
        /** Registry definitions are read through their reference; edits must
         * use their existing definition authoring boundary. */
        followedReference: boolean;
        /** Calendar days of a decided CalendarDate grouping at this scope's
         *  root (view.calendarDayPlacements answered Ok with at least one
         *  group). Absent for every other value: the Calendar is not offered. */
        calendarDays?: readonly DerivedCalendarDay[];
        /** A decided grouping at this scope's root, with its recommended
         *  presentation (view.groupingPresentation). */
        grouping?: DerivedGrouping;
      }
    | { ok: false; error: string };

  /** Resolve a value scope: the item it hangs from, the container at its path,
   *  and that container's children. Every way this can fail is an ANSWER —
   *  the card went away, the reference dangles, the value is a leaf — so each
   *  returns its own sentence rather than an empty view. */
  // A retired worker (a rebuild of this source is running, or its worker is
  // being restored) is a preparing state: the value stays pending until the
  // published or restored worker changes this token.
  const valueScopeWorkerRetired = createMemo(() => scope().kind === "value" && (reader?.kind === "local"
    ? authoringWorkerReplacementPending(transferSession()) : authoringWorkerRetired(transferSession())));
  // Compared by token: another reader's worker announcement re-runs this memo
  // with the same token, and must not restart (and hide) this reader's read.
  const valueScopeWorker = createMemo<{ token?: object; error?: string } | undefined>(() => {
    if (scope().kind !== "value" || valueScopeWorkerRetired()) return undefined;
    try { return { token: authoringWorkerSnapshot(transferSession()) }; }
    catch (error) { return { error: error instanceof Error ? error.message : String(error) }; }
  }, { equals: (before, after) => before === after || !!before && !!after
    && before.token === after.token && before.error === after.error });
  const valueScopeRequest = createMemo(() => {
    const here = scope();
    if (here.kind !== "value") return undefined;
    draftRevision();
    const row = rowById(here.viewId);
    if (!row) return { error: "The list holding this data is no longer here." };
    const view = viewPersistence.read(row.id, asView(row.view));
    const item = findLocusItem(view.items, here.itemId);
    if (!item) return { error: "This data is no longer in that list." };
    const saved = savedExprById();
    const expr = resolveExpr(item, saved);
    if (!expr) return { error: "This card's reference resolved to nothing." };
    const session = transferSession();
    const selectedWorker = valueScopeWorker();
    if (selectedWorker && "error" in selectedWorker) return { error: selectedWorker.error };
    // B4 wave 4 lane H: a Local reader follows references with its worker's
    // catalogue answers (`localReferenceResolver`, below); no page registry.
    const localReferences = reader?.kind === "local" ? localReferenceResolver(reader, () => session) : undefined;
    const resolveReference = localReferences ? localReferences.resolve : (() => {
      const catalog = getCatalog();
      const presentation = createReaderPresentation(() => ({ registry: session.registry, session, catalog }));
      return (reference: LocusCatalogReference) => resolveLocusCatalogReference(reference, {
        fn: id => session.evaluateContext.getFunction?.(id), entry: presentation.catalogEntry,
        typeFamilyOwner: id => session.evaluateContext._typeFamilyOwner?.(id),
        entityType: id => session.registry.getIdentifiedEntity(id)?.type,
      });
    })();
    const templates = reader?.templates() ?? webRegistry;
    const readTemplates = { views: templates.list(), componentNames: templates.listComponentNames?.() ?? [] };
    const readCatalog = reader?.catalog() ?? getCatalog();
    const declaredType = homeData.type(item);
    const capturedExpressionOptions = expressionEditOptions(session);
    const projection = projectAuthoredRead(expr, here.path, declaredType, capturedExpressionOptions);
    return { here, row, item, expr, saved, session, worker: selectedWorker?.token, resolveReference, localReferences, declaredType, projection, capturedExpressionOptions, readTemplates, readCatalog,
      sourceQuery: savedQueryForItem(item),
      sourceTicket: rootSourceTicket(),
      rootRevision: root()!.revision, scopeIdentity: scopeKey(here), epoch: sessionEpoch() };
  });
  const valueScopeResult = createMemo<ValueScopeState | undefined>(() => {
    const input = valueScopeRequest();
    if (!input) return undefined;
    if ("error" in input) return { ok: false, error: input.error! };
    if (valueScopeWorkerRetired()) return new Promise<ValueScopeState>(() => {});
    return (async (): Promise<ValueScopeState> => {
      const { here, row, item, expr, saved, session, worker, resolveReference, localReferences, declaredType, projection, capturedExpressionOptions,
        rootRevision, scopeIdentity, epoch, sourceQuery, sourceTicket, readTemplates, readCatalog } = input;
      try {
        // The source observes this reader's exact token through its memo. Worker
        // announcements for another reader must not hide this data or dispose
        // its expression editor; the evaluator still checks its own live token.
        const rootValue = (await untrack(() => evaluateLocusCard(projection.expression, saved, session))).result;
        assertCurrentSession(epoch);
        client.signal?.throwIfAborted();
        assertSourceTicket(sourceTicket);
        if (authoringWorkerSnapshot(session) !== worker) throw new Error("This authoring snapshot was replaced. Retry with the current data.");
        // All inputs and lookup closures belong to this captured read. Solid
        // discards superseded async generations; reading committed UI getters
        // here can instead observe the focus preceding this pending transition.
        const follow = () => {
          const resolved = followLocusPath(rootValue, projection.resultPath, resolveReference);
          const callable = readLocusCatalogReference(resolved.value);
          return { resolved, callable, catalogTarget: callable ? resolveReference(callable) : undefined };
        };
        // A Local reader asks its worker for every reference the path reads.
        const { resolved, callable, catalogTarget } = localReferences ? await localReferences.settle(follow) : follow();
        if (authoringWorkerSnapshot(session) !== worker) throw new Error("This authoring snapshot was replaced. Retry with the current data.");
        const container = resolved.value;
        let containerType = resolved.followed ? undefined : projection.type;
        if (callable) {
          if (catalogTarget?.kind === "function") {
            const definition = catalogTarget.value as FenelFunction;
            containerType = { $arrow: { params: definition.params, returns: definition.returns } };
          }
        }
        for (let depth = 0; !resolved.followed && depth < projection.resultPath.length; depth++) {
          const step = projection.resultPath[depth]!;
          containerType = childValueType(valueAt(rootValue, projection.resultPath.slice(0, depth)), containerType, step, session);
        }
        const shape = containerType ? resolveValueType(containerType, name => (reader?.kind === "local" ? reader.resolveTypeName?.(name)
          : session.registry.getIdentifiedEntity(name)?.type) ?? session.environment.resolveTypeRef?.({ $ref: name })) : undefined;
        const typeData = isFenelTypeLike(container) && (!callable || !!catalogTarget && catalogTarget.kind !== "function");
        if (typeData) containerType = { $type: true };
        const children = typeData || shape && "$arrow" in shape ? undefined : childrenOf(container);
        // Resolve the unchanged aggregate's scoped presentation before turning
        // it into child cards. Local/public use their prepared workers, with
        // the same currentness checks as the value read; no page dispatch.
        let presentation: SourceReaderValueReadPacket | undefined;
        if (children !== undefined) {
          const readInput = { value: container, type: containerType, typeLookup: "session" as const, ...readTemplates };
          if (reader?.kind === "local" || reader?.kind === "public") {
            const handle = preparedReaderWorkerForSession(session);
            if (!handle) throw new Error("This reader's display tools are not ready.");
            const answer = await runPreparedReaderWorker(handle, { method: "project-reader-values", inputs: [readInput],
              knownIcons: Object.keys(LUCIDE_BY_NAME) }, client.signal) as AuthoringReaderValueReads;
            presentation = answer.valueReads[0];
            if (!presentation?.root || !Array.isArray(presentation.children)) throw new Error("This data's display is unavailable.");
          } else presentation = projectReaderValueReadInSession(readInput, session, { catalog: readCatalog }, Object.keys(LUCIDE_BY_NAME));
          assertSourceTicket(sourceTicket);
          if (authoringWorkerSnapshot(session) !== worker) throw new Error("This authoring snapshot was replaced. Retry with the current data.");
        }
        // Typed grouping: the Fenel projection decides whether this value is a
        // decided grouping and how to show it (calendar days, bars or a table).
        // Only a root record can be a Maybe (OrdinaryMap ...).
        const grouping = here.path.length === 0 && !resolved.followed && children !== undefined
          && !!container && typeof container === "object" && !Array.isArray(container)
          ? await derivedGrouping(expr, saved, session) : undefined;
        const calendarDays = grouping?.kind === "calendar" ? grouping.days : undefined;
        assertCurrentSession(epoch);
        client.signal?.throwIfAborted();
        return { ok: true, row, item, rootValue, rootValueType: projection.type, basePath: projection.basePath,
          itemType: declaredType, expressionOptions: capturedExpressionOptions, sourceWorker: worker,
          container, children: children ? [...children] : [], containerType,
          ...(calendarDays ? { calendarDays } : {}), ...(grouping ? { grouping } : {}),
          resolveReference,
          sourceExpression: expr, leaf: children === undefined, presentation, followedReference: resolved.followed,
          sourceSnapshot: saved, sourceSession: session, sourceQuery, sourceTicket,
          rootRevision, scopeIdentity, epoch };
      } catch (error) {
        // Retirement during this read is not a failure: the memo recomputes
        // when the worker token changes and stays pending meanwhile.
        if (untrack(() => reader?.kind === "local" ? authoringWorkerReplacementPending(session) : authoringWorkerRetired(session))) return new Promise<ValueScopeState>(() => {});
        return { ok: false, error: error instanceof Error ? error.message : String(error) };
      }
    })();
  });
  const [valueScopeRefreshes, setValueScopeRefreshes] = createSignal(0);
  const valueScopeResponse = Object.assign(valueScopeResult, {
    async refetch() {
      setValueScopeRefreshes(count => count + 1);
      try { await refresh(valueScopeResult); }
      finally { setValueScopeRefreshes(count => count - 1); }
    },
  });
  const valueScopeLoading = () => scope().kind === "value"
    && (valueScopeRefreshes() > 0 || isPending(valueScopeResponse));
  const valueScope = createMemo<ValueScopeState | undefined>(() => {
    // The initial result belongs to the handoff's Loading boundary. A
    // placeholder would commit an empty prepared lens over the loaded shell.
    const state = valueScopeResponse();
    if (valueScopeLoading()) return undefined;
    return state;
  });

  // A released drag or resize shows where it was released, not where it was
  // last saved. Its placements are a DRAFT of the canvas expression until the
  // write that carries them settles and the root is re-read; the next gesture
  // builds on the draft, so two quick gestures both land. One write is in
  // flight at a time, and it always carries the newest draft.
  type CanvasDraft = { scope: string; base: ExprNode; rootRevision: number; expression: ExprNode;
    geometry: ReadonlyMap<string, Pick<LayoutItem, "x" | "y" | "w" | "h">>; settled: boolean };
  const [canvasDraft, setCanvasDraftSignal] = createSignal<CanvasDraft>();
  // The writer and the next gesture read this plain copy, not the signal: a
  // signal write lands on the next microtask, and both run in the same turn
  // as the write (reading the signal there saw no draft, and nothing was sent).
  let currentCanvasDraft: CanvasDraft | undefined;
  function setCanvasDraft(draft: CanvasDraft | undefined) {
    currentCanvasDraft = draft;
    setCanvasDraftSignal(draft);
  }
  function draftFor(state: Extract<ValueScopeState, { ok: true }>, draft: CanvasDraft | undefined): CanvasDraft | undefined {
    if (!draft || draft.scope !== state.scopeIdentity) return undefined;
    // A settled draft stands until the re-read brings the expression it wrote.
    return draft.settled && draft.base !== state.sourceExpression ? undefined : draft;
  }
  /** The draft the cards render from (tracked). */
  const activeCanvasDraft = (state: Extract<ValueScopeState, { ok: true }>) => draftFor(state, canvasDraft());
  /** A keyed canvas's entry ids, in the order its cards are placed. */
  function canvasFunctions(session = transferSession()) {
    // B4 wave 4 lane H: a Local reader's handle is its worker's answer
    // (reactive; pending names no canvas function yet).
    if (reader?.kind === "local") return (handle: string) => {
      const id = reader.referenceHandle?.(handle);
      return id ? { id } : undefined;
    };
    return (handle: string) => {
      const selected = session.registry.getIdentifiedFunction(handle);
      const id = selected && session.registry.getUuid(selected.id);
      return id ? { id } : undefined;
    };
  }
  function canvasEntryIds(expr: ExprNode, session = transferSession()): string[] {
    const source = canvasSource(expr, canvasFunctions(session));
    const entries = source ? evaluateAuthoringExpression(source, (id) => savedExprById().get(id), session).result : undefined;
    if (!Array.isArray(entries) || !entries.every((entry) => !!entry && typeof entry === "object"
      && typeof (entry as { id?: unknown }).id === "string")) {
      throw new Error("This canvas's entries could not be read.");
    }
    return entries.map((entry) => (entry as { id: string }).id);
  }
  /** B4 wave 4 lane H: `canvasEntryIds` for a Local reader, evaluated in its worker. */
  async function localCanvasEntryIds(expr: ExprNode, session = transferSession()): Promise<string[]> {
    const source = canvasSource(expr, canvasFunctions(session));
    const job = source ? evaluateExpressionInWorker(session, source, savedExprById()) : undefined;
    if (!job) throw new Error(source ? LOCAL_SAVE_TOOLS_PENDING : "This canvas's entries could not be read.");
    const entries = (await job).result;
    if (!Array.isArray(entries) || !entries.every((entry) => !!entry && typeof entry === "object"
      && typeof (entry as { id?: unknown }).id === "string")) {
      throw new Error("This canvas's entries could not be read.");
    }
    return entries.map((entry) => (entry as { id: string }).id);
  }
  let canvasWriting = false;
  async function writeCanvasDraft(item: LayoutItem) {
    if (canvasWriting) return;
    canvasWriting = true;
    try {
      for (let draft = currentCanvasDraft; draft && !draft.settled; draft = currentCanvasDraft) {
        await homeData.replace(item, draft.expression, homeData.type(item), undefined, undefined, draft.rootRevision);
        if (currentCanvasDraft === draft) setCanvasDraft({ ...draft, settled: true });
      }
    } catch (error) {
      setCanvasDraft(undefined);
      setToolbarError(error instanceof Error ? error.message : String(error));
    } finally { canvasWriting = false; }
  }

  /** view.groupingPresentation applied to this scope's source, in the same
   *  reader (its worker for Local). Any refusal or failure is "not a
   *  grouping"; nothing here judges keys, dates or numbers. */
  async function derivedGrouping(expr: ExprNode, saved: ReadonlyMap<string, ExprNode>,
    session: AuthoringSession): Promise<DerivedGrouping | undefined> {
    try {
      const node: ExprNode = { kind: "call", fnId: GROUPING_PRESENTATION_FUNCTION, args: [expr] };
      const answer = (await untrack(() => evaluateLocusCard(node, saved, session))).result as
        { $tag?: unknown; days?: unknown; bars?: unknown; size?: unknown };
      if (answer?.$tag === "GroupingCalendar" && Array.isArray(answer.days)) {
        const days = answer.days.map(row => row as Partial<DerivedCalendarDay>);
        return days.length > 0 && days.every(row => typeof row.day === "string" && typeof row.year === "number"
          && typeof row.month === "number" && typeof row.entry === "number")
          ? { kind: GROUPING_LAYOUT.GroupingCalendar, days: days.map(row => ({ day: row.day!, year: row.year!, month: row.month!, entry: row.entry! })) } : undefined;
      }
      if (answer?.$tag === "GroupingBars" && Array.isArray(answer.bars)) {
        const bars = answer.bars.map(row => row as Partial<DerivedBar>);
        return bars.every(row => typeof row.label === "string" && typeof row.value === "number" && typeof row.entry === "number")
          ? { kind: GROUPING_LAYOUT.GroupingBars, bars: bars.map(row => ({ label: row.label!, value: row.value!, entry: row.entry! })) } : undefined;
      }
      if (answer?.$tag === "GroupingTable" && typeof answer.size === "number") return { kind: GROUPING_LAYOUT.GroupingTable, size: answer.size };
      return undefined;
    } catch { return undefined; }
  }
  /** How this value scope's grouping is drawn: a pane's explicit
   *  presentation, else the remembered arrangement, else the grouping's
   *  recommendation. Read without reading the row it produces. */
  function derivedGroupingKind(state: Extract<ValueScopeState, { ok: true }>): AnyView["kind"] | LocusLayoutChoice | undefined {
    const here = scope();
    const grouping = state.grouping;
    if (!grouping || here.kind !== "value" || here.path.length !== 0) return undefined;
    if (props.pane) {
      let selected: LocusLayoutChoice | undefined;
      try { selected = props.pane.presentation(); } catch { selected = undefined; }
      if (selected) return selected;
    }
    arrangementRevision();
    return readArrangement(accountKey(), scopeKey(here), grouping.kind).kind;
  }

  const automaticWholeValue = createMemo(() => {
    const state = valueScope();
    if (!state?.ok || !state.presentation?.root.view) return false;
    // Pane and browser-local choices are explicit; Automatic delegates to the
    // reader's existing Viewable without changing the underlying collection.
    if (props.pane) return props.pane.presentation() === undefined;
    arrangementRevision();
    return !readArrangement(accountKey(), scopeKey(scope()), "list").explicit;
  });
  const generatedCollectionCaptions = new WeakSet<ExprNode>();
  const valueScopeItems = createMemo<LayoutItem[]>(() => {
    const state = valueScope();
    if (!state?.ok) return [];
    const session = state.sourceSession;
    const here = scope();
    const authored = (...child: LocusPathStep[]): Pick<RenderedCardValue, "source" | "sourcePath"> | undefined => {
      if (here.kind !== "value") return undefined;
      return projectAuthoredExpression(state.sourceExpression, [...here.path, ...child], expressionEditOptions());
    };
    const authoredCaption = (projection?: Pick<RenderedCardValue, "source" | "sourcePath">) =>
      projection?.source?.kind === "ref" && !projection.sourcePath?.length
        ? savedValuesById().get(projection.source.savedExprId)?.name : undefined;
    const caption = (fallback: string, projection?: Pick<RenderedCardValue, "source" | "sourcePath">) => authoredCaption(projection) || fallback;
    if (state.leaf || automaticWholeValue()) return [{ ...focusedLocusItem(state.item, here), id: "$self", valueType: state.containerType,
      source: { kind: "expr", expr: renderedDataExpression(state.container, authored()) } }];
    arrangementRevision();
    // A derived Calendar shows each date group's members on its day. The
    // data owns the date: these items are neither descendable nor rewritable
    // (their ids are not child keys) and carry no stored placement.
    const groupingKind = derivedGroupingKind(state);
    const childType = (path: LocusPathStep[]) => {
      let type = state.containerType;
      for (let depth = 0; depth < path.length; depth++) type = childValueType(valueAt(state.container, path.slice(0, depth)), type, path[depth]!, session);
      return type;
    };
    if (state.calendarDays && groupingKind === "calendar") {
      return state.calendarDays.map((place): LayoutItem => {
        const path: LocusPathStep[] = ["_0", "entries", place.entry, "value"];
        return { id: `cal.${place.entry}`, caption: place.day, date: place.day, valueType: childType(path),
          source: { kind: "expr", expr: renderedDataExpression(valueAt(state.container, path), authored(...path)) } };
      });
    }
    // A grouping's table (and its chart's legend) shows one row per entry:
    // its key and its value, as the entry records themselves.
    if (state.grouping && (groupingKind === "table" || groupingKind === "chart")) {
      const bars = state.grouping.kind === "chart" ? state.grouping.bars : undefined;
      return Array.from({ length: groupingEntryCount(state.grouping) }, (_, index): LayoutItem => {
        const path: LocusPathStep[] = ["_0", "entries", index];
        return { id: `map.${index}`, caption: bars?.[index]?.label ?? `Entry ${index + 1}`, valueType: childType(path),
          source: { kind: "expr", expr: renderedDataExpression(valueAt(state.container, path), authored(...path)) } };
      });
    }
    // Only a placeAll derivation is projected as a canvas (see
    // locusLayoutOptions); its cards are the placed items.
    if (here.kind === "value" && here.path.length === 0 && isCanvasExpression(state.sourceExpression, canvasFunctions(session))
      && Array.isArray(state.container) && state.container.every(isPlacedValue)
      && readArrangement(accountKey(), scopeKey(here), "canvas").kind === "canvas") {
      // placeAll preserves its source list's item slots. The Fenel projection
      // follows only captured saved-source identities; arbitrary computed
      // lists retain their full producer and residual result path.
      const canvasList = !isEntriesCanvasExpression(state.sourceExpression, canvasFunctions(session))
        ? canvasSource(state.sourceExpression, canvasFunctions(session)) : undefined;
      // B4 wave 4 lane H: a Local reader has no page frame for this projection;
      // its placed cards keep the canvas expression's own source paths.
      const retained = (canvasList && reader?.kind !== "local" ? invokeCallable(Ref("view.sourceExpressionFromSnapshot"),
        [Object.fromEntries(state.sourceSnapshot), canvasList], state.sourceSession.evaluateContext) : undefined) as
        { $tag: "Just"; _0: ExprNode } | { $tag: "Nothing" } | undefined;
      const listSource = retained?.$tag === "Just" ? retained._0 : undefined;
      const placed = projectPlacedItems(state.container, (value, index) => {
        const projection = listSource === undefined ? authored(index, "item")
          : projectAuthoredExpression(listSource, [index], expressionEditOptions());
        const source = projection?.sourcePath?.length ? authored(index, "item") : projection;
        return { id: childItemId(index), caption: caption(`Item ${index + 1}`, source),
          source: { kind: "expr", expr: renderedDataExpression(value, source) } };
      });
      const draft = activeCanvasDraft(state);
      if (placed) return draft ? placed.map((item) => ({ ...item, ...draft.geometry.get(item.id) })) : placed;
    }
    return state.children.map((child): LayoutItem => {
      const source = authored(child.key);
      const expression = renderedDataExpression(child.value, source);
      // A record field's card takes the field slot name the inline record rows
      // show (authored label, else the code name in the code face).
      // A bare constructor (a tree's leaf) is named by its own Labelable: the reader's caption for it.
      const constructorCaption = typeof child.key === "number" && !authoredCaption(source) && bareConstructorTag(child.value) !== undefined
        ? state.presentation?.children.find(projected => projected.key === child.key)?.caption : undefined;
      const item: LayoutItem = { id: childItemId(child.key),
        ...(constructorCaption !== undefined ? displayNameItemFields(constructorCaption)
          : recordChildNameFields(state.presentation?.root.fieldSlots, child.key, child.label, authoredCaption(source))),
        source: { kind: "expr", expr: expression },
        valueType: childValueType(state.container, state.containerType, child.key, session) };
      if (typeof child.key === "number" && !authoredCaption(source)
        && !state.presentation?.children.find(projected => projected.key === child.key)?.caption)
        generatedCollectionCaptions.add(expression);
      return item;
    });
  });

  /** A row the renderers can consume for a scope that has none. Its id is the
   *  scope key, so the rendered surface remounts when you move. */
  function derivedRow(items: LayoutItem[], name: string, fallbackKind: AnyView["kind"],
    grouping?: DerivedGrouping): LocusViewRow {
    arrangementRevision();
    const key = scopeKey(scope());
    // A decided grouping opens in its recommended presentation (Calendar for
    // Calendar Date keys, a chart for numbers per key, otherwise its table).
    const remembered = readArrangement(accountKey(), key, grouping?.kind ?? fallbackKind);
    const calendarDays = grouping?.kind === "calendar" ? grouping.days : undefined;
    // Coordinates belong to Placed data. Old browser-only positions cannot
    // silently turn an arbitrary value into a canvas again. A Calendar or a
    // chart is kept only while the value still supports it.
    const kind = ["grid", "list", "table", "tree", "tabs"].includes(remembered.kind)
      || remembered.kind === "calendar" && !!calendarDays || remembered.kind === "chart" && grouping?.kind === "chart"
      ? remembered.kind : fallbackKind;
    const view = arrange(items, { kind, places: {} });
    // A derived Calendar opens on the month of its earliest group.
    const first = calendarDays ? earliestCalendarDay(calendarDays) : undefined;
    if (view.kind === "chart" && grouping?.kind === "chart") return { id: key, name, active: true, view: { ...view, bars: grouping.bars } };
    return { id: key, name, active: true, view: view.kind === "calendar" && first ? { ...view, year: first.year, month: first.month } : view };
  }

  /** The focused list's declared field order: its Table's columns. Served
   *  records can arrive with sorted keys; a tile reads its type's first fields. */
  const focusedListFieldOrder = createMemo<readonly string[] | undefined>(() => {
    if (scope().kind !== "value") return undefined;
    const state = valueScope();
    if (!state?.ok || state.grouping || !Array.isArray(state.container)) return undefined;
    try {
      const session = state.sourceSession;
      // The reader's declaration answers a type the catalogue's label-deduplicated rows lack (Countries, Nov 12).
      return declaredFieldOrder(childValueType(state.container, state.containerType, 0, session), session.environment,
        name => reader?.kind === "local" ? reader.resolveTypeName?.(name) : session.registry.getIdentifiedEntity(name)?.type);
    } catch { return undefined; }
  });
  /** The focused data is a list whose every item has a compact thumbnail mark
   *  (list-tile-model.ts): its Grid draws them as tiles, and it opens in Grid. */
  const focusedListTiles = createMemo(() => {
    if (scope().kind !== "value") return false;
    const state = valueScope();
    return !!state?.ok && !state.grouping && Array.isArray(state.container) && listShowsTiles(state.container, focusedListFieldOrder(),
      // The reader's own glyph of each item: a constructor's registered picture or emoji is its face.
      index => state.presentation?.children.find(child => child.key === index)?.glyph);
  });
  const scopeSubject = createMemo<{ row: LocusViewRow | null; error?: string; persist: (next: AnyView) => void }>(() => {
    const here = scope();
    if (here.kind === "root") {
      return { row: rootRow(), persist: persistRootScope };
    }
    if (here.kind === "view") {
      const row = current();
      return {
        row,
        error: row ? undefined : "That data is no longer here. Go up to see its parent.",
        persist: (next: AnyView) => { if (row) viewPersistence.update(row.id, next); },
      };
    }
    const state = valueScope();
    if (valueScopeLoading()) return { row: null, persist: () => {} };
    if (!state?.ok) return { row: null, error: state?.error ?? "There is nothing inside this data.", persist: () => {} };
    const canvas = here.path.length === 0 && isCanvasExpression(state.sourceExpression, canvasFunctions());
    // A focused list whose items each have a compact mark opens as keys (a Grid of tiles).
    return { row: derivedRow(valueScopeItems(), state.item.caption ?? "Data", canvas ? "canvas" : focusedListTiles() ? "grid" : "list", state.grouping),
      persist: persistValueScope };
  });
  function currentInspectionOrigin(): InspectionSaveOrigin | undefined {
    const here = scope();
    if (here.kind === "value") {
      const state = valueScope();
      if (!state?.ok) return undefined;
      if (state.sourceTicket.origin !== client.drafts?.source()) return undefined;
      return { scope: here, epoch: sessionEpoch(), rootRevision: state.rootRevision, sourceTicket: state.sourceTicket,
        expectedSavedQuery: state.sourceQuery ? cloneDraftValue(state.sourceQuery) : undefined };
    }
    const sourceTicket = rootSourceTicket();
    if (sourceTicket.origin !== client.drafts?.source()) return undefined;
    return { scope: here, epoch: sessionEpoch(), rootRevision: root()?.revision, sourceTicket };
  }
  // A draft edited in the early lens arrives once, for its own scope only.
  let earlyHandoff = initialInspection?.draft
    ? { scope: scopeKey(initialInspection.scope), epoch: untrack(sessionEpoch), ...initialInspection.draft } : undefined;
  const focusedExpressionState = createMemo(() => {
    const here = scope();
    const epoch = sessionEpoch();
    props.pane?.subject?.();
    const handoff = earlyHandoff && earlyHandoff.scope === scopeKey(here) && earlyHandoff.epoch === epoch ? earlyHandoff : undefined;
    earlyHandoff = undefined;
    const state = createInspectionExpressionState(undefined, handoff && cloneDraftValue(handoff.node));
    if (handoff) state.earlyHandoff = { baseline: draftValueFingerprint(handoff.baseline), commit: handoff.commit };
    state.saveOrigin = untrack(() => {
      const owner = here.kind === "value" ? findLocusItem(rowById(here.viewId)?.view.items ?? [], here.itemId) : undefined;
      const query = owner ? savedQueryForItem(owner) : undefined;
      return { scope: here, epoch, rootRevision: root()?.revision, sourceTicket: rootSourceTicket(), expectedSavedQuery: query ? cloneDraftValue(query) : undefined };
    });
    return state;
  });
  // B4 unit D: a Local reader admits its held lens subject, and builds that
  // subject's expression, in its worker (`run-reader-lens-shortcut`,
  // "held-subject", guidance class: a display read) with the shared
  // `lens-shortcuts.ts` owners; its page session is never read. Pending is
  // never an admission: the lens shows its pending frame meanwhile.
  const localLensReader = reader?.kind === "local" ? reader : undefined;
  const localHeldOrigin = createMemo<{ origin?: ExprNode; error?: string }>(() => {
    if (!localLensReader || !props.pane?.subject?.()) return {};
    const state = valueScope();
    if (!state?.ok) return {};
    try { return { origin: shortcutOriginExpression(state.sourceExpression) }; }
    catch (error) { return { error: error instanceof Error ? error.message : String(error) }; }
  });
  const localHeldSubject = localLensReader ? createLocalReaderAnswer(() => localLensReader, homeAuthoringSession, () => {
    const held = props.pane?.subject?.();
    const source = props.pane?.source();
    if (!held || !source) return undefined;
    const origin = localHeldOrigin().origin;
    return { method: "run-reader-lens-shortcut" as const, priority: "guidance" as const, step: "held-subject" as const,
      subject: held, source, focus: scopeToWorkspace(scope()), ...(origin ? { origin } : {}) };
  }, readActionField<{ admission: LensSubjectAdmission; expression?: ExprNode; expressionError?: string }>("heldSubject")) : undefined;
  const heldSubjectAdmission = createMemo(() => {
    const held = props.pane?.subject?.();
    const source = props.pane?.source();
    if (!held || !source) return undefined;
    if (localHeldSubject) return localHeldSubject.answer()?.admission;
    return checkLensTypedSubject(homeAuthoringSession(), held, source, scopeToWorkspace(scope()));
  });
  /** A Local held subject whose worker verdict has not arrived (B4 unit D). */
  const heldSubjectPending = () => !!localHeldSubject && !!props.pane?.subject?.() && !!props.pane?.source()
    && heldSubjectAdmission() === undefined && !localHeldSubject.failure();
  const heldLensSubject = createMemo<{ value: unknown; type: FenelType } | undefined>(() => {
    const admission = heldSubjectAdmission();
    return admission?.ok ? { value: admission.subject.data, type: admission.subject.dataType } : undefined;
  });
  const lensExpressionSubject = createMemo<{ item: LayoutItem; evaluated?: RenderedCardValue } | undefined>(() => {
    const here = scope();
    const held = props.pane?.subject?.();
    const accepted = heldLensSubject();
    if (held && !accepted) return undefined;
    if (held && accepted && localHeldSubject) {
      // B4 unit D: the worker built this expression with the admission; its
      // failure is the page's thrown message.
      const failure = localHeldOrigin().error ?? localHeldSubject.answer()?.expressionError;
      if (failure) throw new Error(failure);
      const expression = localHeldSubject.answer()?.expression;
      if (!expression) return undefined;
      return { item: { id: "$lens-subject", valueType: accepted.type,
        source: { kind: "expr", expr: expression } }, evaluated: { value: accepted.value, source: expression } };
    }
    if (held && accepted) {
      const state = valueScope();
      const origin = state?.ok ? shortcutOriginExpression(state.sourceExpression) : undefined;
      const expression = lensTypedSubjectExpression(homeAuthoringSession(), held, origin)
        ?? expressionForTransfer({ value: accepted.value, type: accepted.type,
          typeName: classifyData(accepted.value), source: "fenel" }, homeAuthoringSession().environment,
          { registry: homeAuthoringSession().registry, evaluateContext: homeAuthoringSession().evaluateContext });
      return { item: { id: "$lens-subject", valueType: accepted.type,
        source: { kind: "expr", expr: expression } }, evaluated: { value: accepted.value, source: expression } };
    }
    if (here.kind === "value") {
      const state = valueScope();
      if (!state?.ok) return undefined;
      const authored = projectAuthoredExpression(state.sourceExpression, here.path, expressionEditOptions());
      return { item: { ...focusedLocusItem(state.item, here), id: "$self", valueType: state.containerType,
        source: { kind: "expr", expr: authored.source } },
        evaluated: { value: state.container, ...authored } };
    }
    const row = scopeSubject().row;
    if (!row) return undefined;
    const source: ExprNode = { kind: "literal", value: { __list: row.view.items.map(item => resolveExpr(item, savedExprById()) ?? emptyExpressionSlot()) } };
    return { item: { id: `$lens:${scopeKey(here)}`, caption: row.name, source: { kind: "expr", expr: source } } };
  });

  const lensExpressionAvailable = createMemo(() => !!lensExpressionSubject());
  const focusedExpressionController = createMemo(() => {
    const state = focusedExpressionState();
    if (!lensExpressionAvailable()) return undefined;
    return untrack(() => createInspectionExpressionController({
      get item() { return lensExpressionSubject()!.item; },
      get evaluated() { return lensExpressionSubject()!.evaluated; },
      get savedExprById() { return savedExprById(); }, state,
    }, { type: homeData.type, saveInspection: homeData.saveInspection,
      focusedExpressionState, inspectionOrigin: currentInspectionOrigin }));
  });

  const lensExpressionFailure = () => {
    if (scope().kind !== "value") return undefined;
    const state = valueScope();
    return state?.ok === false ? state.error : undefined;
  };
  // The early menu retains an authored occurrence, never a callable body.
  // Re-read that occurrence in this reader before opening the shared form.
  let initialCallConsumed = false;
  const initialCallTarget = createMemo(() => {
    if (!initialCall || initialCallConsumed) return undefined;
    const changed = { ok: false as const, error: "This data changed. Instantiate the current function again." };
    if (client.signal?.aborted || initialCall.epoch !== sessionEpoch()
      || initialCall.source !== (props.pane ? workspaceSourceKey(props.pane.source()) : "public")
      || draftValueFingerprint(initialCall.scope) !== draftValueFingerprint(scope())) return changed;
    const data = root();
    if (!data) return undefined;
    if (data.id !== initialCall.rootId || data.revision !== initialCall.revision) return changed;
    const here = initialCall.target;
    const row = rowById(here.viewId);
    const item = row && findLocusItem(viewPersistence.read(row.id, asView(row.view)).items, here.itemId);
    const source = item && resolveExpr(item, savedExprById());
    if (!item || !source) return changed;
    const authored = projectAuthoredExpression(source, here.path, expressionEditOptions());
    const reference = authored.source.kind === "literal" ? readLocusCatalogReference(authored.source.value) : undefined;
    if (authored.sourcePath.length || reference?.id !== initialCall.referenceId) return changed;
    const selected = { ...item, source: { kind: "expr" as const, expr: authored.source } };
    const resolve = () => itemFunction(selected, savedExprById(), homeAuthoringSession(), undefined, reader);
    const answer = reader?.observePending ? reader.observePending(resolve) : { value: resolve(), pending: false, failed: false };
    if (answer.failed) return { ok: false as const,
      error: "Could not read this function. Retry its data reader, then instantiate the function again." };
    if (answer.pending) return undefined;
    return answer.value ? { ok: true as const, fnId: answer.value.id, fnName: initialCall.caption || answer.value.id } : changed;
  });
  createEffect(initialCallTarget, target => {
    if (!target || initialCallConsumed) return;
    initialCallConsumed = true;
    if (target.ok) setCalling({ fnId: target.fnId, fnName: target.fnName });
    else setToolbarError(target.error);
  });

  let handledAddressRequest = 0;
  const addressExpressionSubject = createMemo<ReturnType<typeof lensExpressionSubject>>(() => {
    if (!props.pane?.addressInputs?.()) return undefined;
    const here = scope();
    if (here.kind === "value") {
      const row = rowById(here.viewId);
      const item = row && findLocusItem(viewPersistence.read(row.id, asView(row.view)).items, here.itemId);
      const source = item && resolveExpr(item, savedExprById());
      if (item && source) {
        const authored = projectAuthoredExpression(source, here.path, expressionEditOptions());
        const selected = { item: { ...focusedLocusItem(item, here), id: "$self",
          source: { kind: "expr" as const, expr: authored.source } } };
        // An exact authored reference is already function data. Opening its
        // existing Call form does not need to evaluate its containing record.
        if (!authored.sourcePath.length && itemFunction(selected.item, savedExprById(), homeAuthoringSession(), undefined, reader)) return selected;
      }
    }
    return lensExpressionSubject();
  });
  createEffect(() => ({ request: props.pane?.addressInputs?.(), selected: addressExpressionSubject(), focus: scope(),
    source: props.pane?.source(), session: homeAuthoringSession() }), state => {
    const request = state.request;
    if (!request || request.id === handledAddressRequest || !state.selected || !state.source
      || request.source !== workspaceSourceKey(state.source) || scopeKey(request.focus) !== scopeKey(state.focus)) return;
    handledAddressRequest = request.id;
    const fn = itemFunction(state.selected.item, savedExprById(), state.session, state.selected.evaluated, reader);
    if (fn) setCalling({ fnId: fn.id, fnName: state.selected.item.caption || fn.id, addressInputs: request.inputs,
      addressOrigin: { source: request.source, focus: request.focus } });
    else setToolbarError("This data is not a function. Named address inputs need a function.");
    props.pane?.onAddressInputsHandled?.(request.id);
  });

  /** Where entering this card leads, or undefined when it is a leaf.
   *
   *  `evaluated` is the value the caller already has. Only the context menu
   *  arrives without one, because it is built from a click position rather
   *  than from a rendered card. */
  const [shortcutDraft, setShortcutDraft] = createSignal<{ shortcut: LensShortcut; input: LensShortcutInput;
    epoch: number; origin: string; source: string;
    /** B4 unit D (Local): the worker's answer for this exact shortcut. */
    local?: ReaderLensShortcutEdit }>();
  const [shortcutRunning, setShortcutRunning] = createSignal(false);
  const [shortcutIssue, setShortcutIssue] = createSignal<string>();
  let activeShortcutRun: object | undefined;
  function closeLensShortcut() {
    activeShortcutRun = undefined; setShortcutDraft(undefined); setShortcutRunning(false);
    queuedShortcutEdit = undefined; setLocalShortcutEditing(false); setLocalShownArguments(undefined); setLocalShownDisposition(undefined);
  }
  // B4 unit D: a Local reader's shortcut steps run in its worker
  // (`run-reader-lens-shortcut`), user actions at weight 0. A moved capture
  // refuses with the existing copy; there is no page fallback.
  function localLensStep<T>(step: ReaderLensShortcutStep, field: string, capture?: LocalGuidanceCapture): Promise<T> {
    return runLocalReaderAction(localLensReader, homeAuthoringSession, { method: "run-reader-lens-shortcut", ...step },
      readActionField<T>(field), { signal: client.signal, ...(capture ? { capture } : {}) });
  }
  // Argument and disposition edits of a Local shortcut are applied by the
  // worker. The field shows the latest edit at once; edits made while one is
  // answered wait and are sent next (latest value per field), never dropped;
  // Run waits until every edit is applied. A refused edit stays shown and
  // queued with its message, and is sent again with the next edit.
  const [localShortcutEditing, setLocalShortcutEditing] = createSignal(false);
  const [localShownArguments, setLocalShownArguments] = createSignal<{ value: unknown }>();
  const [localShownDisposition, setLocalShownDisposition] = createSignal<{ value: LensShortcut["disposition"] }>();
  let queuedShortcutEdit: { arguments?: { value: unknown }; disposition?: LensShortcut["disposition"] } | undefined;
  let shortcutEditRunning = false;
  function queueLocalShortcutEdit(edit: NonNullable<typeof queuedShortcutEdit>) {
    queuedShortcutEdit = { ...queuedShortcutEdit, ...edit };
    if (edit.arguments) setLocalShownArguments(edit.arguments);
    if (edit.disposition) setLocalShownDisposition({ value: edit.disposition });
    setLocalShortcutEditing(true);
    void drainLocalShortcutEdits();
  }
  /** `start`: the draft just written (a signal write lands on the next
   * microtask); after each await the signal is read again. */
  async function drainLocalShortcutEdits(start = shortcutDraft()) {
    if (shortcutEditRunning) return;
    shortcutEditRunning = true;
    let failed = false;
    let draft = start;
    try {
      for (;;) {
        if (!draft) { queuedShortcutEdit = undefined; break; }
        // The first answer (fields and argument type) is asked at open.
        const edit = queuedShortcutEdit ?? (draft.local ? undefined : {});
        if (!edit) break;
        queuedShortcutEdit = undefined;
        let answer: ReaderActionOf<ReaderLensShortcutEdit>;
        try { answer = await localLensStep<ReaderActionOf<ReaderLensShortcutEdit>>({ step: "edit", shortcut: draft.shortcut, ...edit }, "edited"); }
        catch (error) {
          if (shortcutDraft() !== draft) { draft = shortcutDraft(); continue; }
          queuedShortcutEdit = { ...edit, ...(queuedShortcutEdit ?? {}) };
          failed = true;
          setShortcutIssue(error instanceof Error ? error.message : String(error));
          break;
        }
        if (shortcutDraft() !== draft) { draft = shortcutDraft(); continue; }
        if (answer.$tag === "Err") {
          queuedShortcutEdit = { ...edit, ...(queuedShortcutEdit ?? {}) };
          failed = true;
          setShortcutIssue(answer._0);
          break;
        }
        const next = { ...draft, shortcut: answer._0.shortcut, local: answer._0 };
        setShortcutDraft(next);
        draft = next;
      }
    } finally {
      shortcutEditRunning = false;
      if (!failed && !queuedShortcutEdit) {
        setLocalShortcutEditing(false); setLocalShownArguments(undefined); setLocalShownDisposition(undefined);
      }
    }
  }
  function shortcutOriginExpression(fallback: ExprNode): ExprNode {
    const here = scope();
    if (here.kind === "value" && here.path.length) {
      const projected = projectAuthoredExpression(fallback, here.path, expressionEditOptions());
      if (projected.sourcePath?.length) throw new Error("The original computed result path is unavailable for this shortcut.");
      return projected.source;
    }
    const id = here.kind === "value" && here.rootItem && here.path.length === 0
      ? `${root()?.referenceId}:${here.itemId}` : undefined;
    return id && root()?.expressions[id] ? { kind: "ref", savedExprId: id } : fallback;
  }
  const shortcutField = (name: string): FieldDef | undefined => {
    if (localLensReader) return name === "arguments" ? shortcutDraft()?.local?.fields.arguments : shortcutDraft()?.local?.fields.disposition;
    const definition = homeAuthoringSession().registry.getIdentifiedEntity(name === "arguments" ? "LensFunctionRecipe" : "LensShortcut");
    return definition ? entitySchemaFields(definition).find(field => field.name === name) : undefined;
  };
  const shortcutArgumentsField = createMemo(() => {
    const selected = shortcutDraft()?.shortcut;
    const field = selected && shortcutField("arguments");
    const type = selected?.operation.$tag !== "InvokeLensRecipe" ? undefined
      : localLensReader ? shortcutDraft()?.local?.argumentType : lensRecipeArgumentType(homeAuthoringSession(), selected.operation.recipe);
    return field && type ? { ...field, type } : undefined;
  });
  function selectedShortcutInput(shortcut: LensShortcut): LensShortcutInput {
    const plan = shortcutInputPlan(shortcut);
    if ("input" in plan) return plan.input;
    return lensTypedSubjectInput(homeAuthoringSession(), plan.typed.subject, plan.typed.origin, plan.typed.originType) ?? plan.fallback();
  }
  /** B4 unit D: the same input for a Local reader, its typed branch answered by the worker. */
  async function localShortcutInput(shortcut: LensShortcut, capture?: LocalGuidanceCapture): Promise<LensShortcutInput> {
    const plan = shortcutInputPlan(shortcut);
    if ("input" in plan) return plan.input;
    const answer = await localLensStep<{ input?: LensShortcutInput }>({ step: "input", ...plan.typed }, "input", capture);
    return answer.input ?? plan.fallback();
  }
  type ShortcutInputPlan = { input: LensShortcutInput }
    | { typed: { subject: LensTypedSubject; origin: ExprNode; originType: FenelType }; fallback: () => LensShortcutInput };
  function shortcutInputPlan(shortcut: LensShortcut): ShortcutInputPlan {
    const pane = props.pane;
    if (!pane) throw new Error("Open a lens to use its shortcuts.");
    const selected = lensExpressionSubject();
    if (!selected?.item.source || selected.item.source.kind !== "expr") throw new Error("Wait for this data to finish loading.");
    if (selected.evaluated?.sourcePath?.length) throw new Error("This computed child needs its result path selected in the expression before a shortcut can use it.");
    const held = heldLensSubject();
    const value = valueScope();
    const edited = focusedExpressionState().savedValue();
    if (edited) return { input: { value: edited.value, type: focusedType()!,
      expression: focusedExpressionState().savedDraft() ?? edited.source ?? selected.item.source.expr,
      retainedBinding: focusedExpressionState().savedDraft() ?? edited.source ?? selected.item.source.expr,
      source: pane.source(), focus: scopeToWorkspace(scope()) } };
    if (held) {
      const origin = value?.ok ? shortcutOriginExpression(value.sourceExpression) : undefined;
      const subject = props.pane?.subject?.();
      const expression = selected.item.source.expr;
      const fallback = (): LensShortcutInput => {
        if (peelMaybeValue(props.pane?.subject?.()?.producer) != null) throw new Error("The shortcut's original source could not be checked.");
        return { value: held.value, type: held.type, expression,
          source: pane.source(), focus: scopeToWorkspace(scope()) };
      };
      return origin && value?.ok && value.containerType && subject
        ? { typed: { subject, origin, originType: value.containerType }, fallback } : { input: fallback() };
    }
    if (value?.ok) {
      const here = scope();
      const linked = shortcut.disposition.$tag === "CreateDerivedData" && here.kind === "value" && here.path.length === 0
        && here.rootItem && root()?.expressions[`${root()!.referenceId}:${here.itemId}`];
      return { input: { value: value.container, type: value.containerType ?? focusedType()!,
        expression: linked ? { kind: "ref", savedExprId: `${root()!.referenceId}:${(here as Extract<LocusScope, {kind:"value"}>).itemId}` }
          : selected.item.source.expr, source: pane.source(), focus: scopeToWorkspace(scope()) } };
    }
    const row = scopeSubject().row;
    const values = row?.view.items.map(item => {
      const painted = homeData.evaluated(item);
      if (painted) return painted;
      const expr = resolveExpr(item, savedExprById());
      const cached = expr ? readLocusCardResult(expr, savedExprById(), homeAuthoringSession()) : undefined;
      return cached && !cached.error ? { value: cached.result } : undefined;
    });
    if (!values || values.some(value => !value)) throw new Error("Wait for the collection's data to finish loading.");
    return { input: { value: values.map(value => value!.value), type: focusedType()!, expression: selected.item.source.expr,
      source: pane.source(), focus: scopeToWorkspace(scope()) } };
  }
  function selectShortcutPresentation(shortcut: LensShortcut, selected?: { value: unknown; type: FenelType }, apply = true) {
    const presentation = peelMaybeValue(shortcut.presentation);
    if (!presentation || !props.pane) return;
    const fn = homeAuthoringSession().registry.getFunction("view.workspacePresentationCode");
    if (!fn) throw new Error("Lens presentations are unavailable in this reader.");
    const code = invokeCallable({ $ref: homeAuthoringSession().registry.getUuid(fn.id) ?? fn.id },
      [presentation], homeAuthoringSession().evaluateContext) as string;
    return applyShortcutPresentation(shortcut, code, selected, apply);
  }
  /** B4 unit D: the presentation's code comes from a Local reader's worker. */
  async function localShortcutPresentation(shortcut: LensShortcut, selected?: { value: unknown; type: FenelType }, apply = true,
    capture?: LocalGuidanceCapture) {
    const presentation = peelMaybeValue(shortcut.presentation);
    if (!presentation || !props.pane) return;
    const code = await localLensStep<ReaderActionOf<string>>({ step: "presentation-code", presentation }, "presentationCode", capture);
    if (code.$tag === "Err") throw new Error(code._0);
    return applyShortcutPresentation(shortcut, code._0, selected, apply);
  }
  function applyShortcutPresentation(shortcut: LensShortcut, code: string, selected: { value: unknown; type: FenelType } | undefined, apply: boolean) {
    if (!props.pane) return;
    const kind = layoutFromWorkspaceCode(code);
    if (kind) {
      const choices = selected ? locusLayoutOptions({ type: selected.type, value: selected.value, canTable: true })
        .filter(choice => root()?.canEdit === true && shortcut.disposition.$tag === "CreateDerivedData"
          || choice.value === "value" || choice.value === "code" || choice.value === "list") : layoutOptions();
      if (!choices.some(choice => choice.value === kind)) throw new Error("This presentation is unavailable for the selected data.");
      if (apply) props.pane.onPresentation(kind);
      return kind;
    }
  }
  createEffect(() => ({ request: props.pane?.shortcutRequest?.(), ready: !!root(),
    here: scope(), value: scope().kind === "value" ? valueScope() : undefined }), state => {
    if (!state.request || !state.ready || state.here.kind === "value" && !state.value?.ok) return;
    props.pane?.onShortcutHandled?.(state.request.id);
    const shortcut = state.request.shortcut;
    if (localLensReader) { void openLocalLensShortcut(shortcut); return; }
    try {
      if (shortcut.operation.$tag === "PresentLensSubject") {
        const planned = prepareLensShortcut(homeAuthoringSession(), shortcut, { expression: { kind: "literal", value: 0 },
          value: 0, type: focusedType()!, source: props.pane!.source(), focus: scopeToWorkspace(scope()) });
        if (!planned.ok) throw new Error(planned.issue);
        if (planned.plan.kind !== "subject") return;
        const code = peelMaybeValue(planned.plan.presentation)?.$tag === "CodePresentation";
        if (planned.plan.subject.$tag === "CurrentDataSubject" && peelMaybeValue(planned.plan.presentation) != null) {
          selectShortcutPresentation(shortcut); setLensMode("data");
        }
        else setLensMode(toggleDataInspectionPanel(lensMode(), planned.plan.subject.$tag === "CurrentDataSubject" ? "data" : code ? "code" : "expression"));
        return;
      }
      setShortcutIssue(undefined);
      setShortcutDraft({ shortcut, input: selectedShortcutInput(shortcut), epoch: sessionEpoch(),
        origin: scopeKey(scope()), source: workspaceSourceKey(props.pane!.source()) });
    } catch (error) { setToolbarError(error instanceof Error ? error.message : String(error)); }
  });
  /** B4 unit D: the shortcut request effect's work for a Local reader. */
  async function openLocalLensShortcut(shortcut: LensShortcut) {
    const epoch = sessionEpoch(), origin = scopeKey(scope()), source = workspaceSourceKey(props.pane!.source());
    const moved = () => epoch !== sessionEpoch() || origin !== scopeKey(scope()) || source !== workspaceSourceKey(props.pane!.source());
    try {
      const capture = localGuidanceCapture(localLensReader, homeAuthoringSession);
      if (shortcut.operation.$tag === "PresentLensSubject") {
        const planned = await localLensStep<ReaderLensShortcutPreparation>({ step: "prepare", shortcut, input: { expression: { kind: "literal", value: 0 },
          value: 0, type: focusedType()!, source: props.pane!.source(), focus: scopeToWorkspace(scope()) } }, "prepared", capture);
        if (moved()) return;
        if (!planned.ok) throw new Error(planned.issue);
        if (planned.plan.kind !== "subject") return;
        const code = peelMaybeValue(planned.plan.presentation)?.$tag === "CodePresentation";
        if (planned.plan.subject.$tag === "CurrentDataSubject" && peelMaybeValue(planned.plan.presentation) != null) {
          await localShortcutPresentation(shortcut, undefined, true, capture);
          if (moved()) return;
          setLensMode("data");
        }
        else setLensMode(toggleDataInspectionPanel(lensMode(), planned.plan.subject.$tag === "CurrentDataSubject" ? "data" : code ? "code" : "expression"));
        return;
      }
      setShortcutIssue(undefined);
      const input = await localShortcutInput(shortcut, capture);
      if (moved()) return;
      const draft = { shortcut, input, epoch, origin, source };
      setShortcutDraft(draft);
      void drainLocalShortcutEdits(draft);
    } catch (error) { if (!moved()) setToolbarError(error instanceof Error ? error.message : String(error)); }
  }
  async function runLensShortcut() {
    const draft = shortcutDraft();
    if (!draft || shortcutRunning()) return;
    const token = {}; activeShortcutRun = token;
    const onSubjectData = props.pane?.onSubjectData;
    const current = () => activeShortcutRun === token && shortcutDraft() === draft && draft.epoch === sessionEpoch()
      && draft.origin === scopeKey(scope()) && draft.source === workspaceSourceKey(props.pane!.source());
    setShortcutRunning(true); setShortcutIssue(undefined);
    try {
      if (!current()) throw new Error("The data changed. Open this shortcut again.");
      let plan: ReaderPreparedLensRecipe;
      let admitted: LensSubjectAdmission;
      let presentation: LocusLayoutChoice | undefined;
      if (localLensReader) {
        // B4 unit D: every step under one capture of this reader's worker.
        if (localShortcutEditing()) throw new Error("The shortcut's arguments are still being applied. Run again.");
        const capture = localGuidanceCapture(localLensReader, homeAuthoringSession);
        const input = await localShortcutInput(draft.shortcut, capture);
        if (!current()) return;
        const prepared = await localLensStep<ReaderLensShortcutPreparation>({ step: "prepare", shortcut: draft.shortcut, input,
          ...(draft.shortcut.disposition.$tag === "ApplyToDraft" ? { draftType: input.type } : {}) }, "prepared", capture);
        if (!prepared.ok) throw new Error(prepared.issue);
        if (prepared.plan.kind !== "recipe") throw new Error("Choose an operation to run.");
        plan = prepared.plan;
        const result = await evaluateLocusCard(plan.node, savedExprById(), homeAuthoringSession());
        if (result.error) throw new Error(result.error);
        if (!current()) return;
        try { admitted = await localLensStep<LensSubjectAdmission>({ step: "admit", plan, value: result.result, source: props.pane!.source() }, "admitted", capture); }
        catch (error) {
          if (error instanceof Error && error.message === LOCAL_ACTION_CHANGED) throw new Error("The reader changed while running this shortcut. Try again.");
          throw error;
        }
        if (!admitted.ok) throw new Error(admitted.issue);
        presentation = await localShortcutPresentation(draft.shortcut, { value: admitted.subject.data, type: admitted.subject.dataType }, false, capture);
        if (!current()) return;
      } else {
        const input = selectedShortcutInput(draft.shortcut);
        const prepared = prepareLensShortcut(homeAuthoringSession(), draft.shortcut, input,
          draft.shortcut.disposition.$tag === "ApplyToDraft" ? input.type : undefined);
        if (!prepared.ok) throw new Error(prepared.issue);
        if (prepared.plan.kind !== "recipe") throw new Error("Choose an operation to run.");
        const result = await evaluateLocusCard(prepared.plan.node, savedExprById(), homeAuthoringSession());
        if (result.error) throw new Error(result.error);
        if (!current()) return;
        plan = prepared.plan;
        admitted = admitLensShortcutResult(homeAuthoringSession(), prepared.plan, result.result, props.pane!.source());
        if (!admitted.ok) throw new Error(admitted.issue);
        presentation = selectShortcutPresentation(draft.shortcut, { value: admitted.subject.data, type: admitted.subject.dataType }, false);
      }
      let presentationApplied = false;
      if (draft.shortcut.disposition.$tag === "ApplyToDraft" && !props.pane?.subject?.()) {
        const selected = lensExpressionSubject();
        if (!selected) throw new Error("The original data is unavailable.");
        const destination = await homeData.saveInspection(selected.item, plan.node, undefined, focusedExpressionState().saveOrigin);
        if (!current()) return;
        if (destination === "lens") { onSubjectData?.(admitted.subject, presentation); presentationApplied = true; }
      } else if (draft.shortcut.disposition.$tag === "CreateDerivedData" && root()?.canEdit === true) {
        const item: LayoutItem = { id: genId(), caption: draft.shortcut.label,
          source: { kind: "expr", expr: plan.node }, valueType: plan.resultType };
        await changeRoot({ kind: "append", item });
        if (!current()) return;
        navigateScope({ kind: "value", viewId: root()!.id, itemId: item.id, path: [], rootItem: true }, presentation);
        presentationApplied = true;
      } else { onSubjectData?.(admitted.subject, presentation); presentationApplied = true; }
      if (activeShortcutRun !== token || shortcutDraft() !== draft || draft.epoch !== sessionEpoch()) return;
      setLensMode("data");
      if (!presentationApplied && presentation) props.pane?.onPresentation(presentation);
      setShortcutDraft(undefined);
    } catch (error) {
      if (shortcutDraft() === draft && draft.epoch === sessionEpoch()) setShortcutIssue(error instanceof Error ? error.message : String(error));
    } finally { if (activeShortcutRun === token) { activeShortcutRun = undefined; setShortcutRunning(false); } }
  }

  function enterScopeFor(item: LayoutItem, evaluated?: { value: unknown }): LocusScope | undefined {
    const here = scope();
    if (here.kind === "root") {
      if (homes().some((row) => row.id === item.id)) return { kind: "view", viewId: item.id };
    }
    let value: unknown;
    const rendered = evaluated ?? homeData.evaluated(item);
    if (rendered) value = rendered.value;
    else {
      const expr = resolveExpr(item, savedExprById());
      if (!expr) return undefined;
      // A context menu can enter data before its card finishes computing.
      // The focused surface awaits the same background read; never execute
      // the expression merely to decide whether to offer navigation.
      try { value = readLocusCardResult(expr, savedExprById(), transferSession())?.result; }
      catch { return undefined; }
    }
    // Enter the target, never the reference's transport fields. Keep the
    // incoming path so the breadcrumb returns to the occurrence we followed.
    if (isReferenceValue(value)) {
      try {
        const target = followLocusPath(value, [], resolveCatalogReference).value;
        if (!isReferenceValue(target) && !isEnterable(target)) return undefined;
      }
      catch { return undefined; }
    }
    if (here.kind === "root") return root() ? { kind: "value", viewId: root()!.id, itemId: item.id, path: [], rootItem: true } : undefined;
    if (here.kind === "view") return { kind: "value", viewId: here.viewId, itemId: item.id, path: [] };
    const key = childItemKey(item.id);
    if (key === undefined) return undefined;
    const state = valueScope();
    const throughItem = state?.ok && Array.isArray(state.container) && state.container.every(isPlacedValue)
      && scopeSubject().row?.view.kind === "canvas";
    return throughItem
      ? { ...here, path: [...here.path, key, "item"], passThrough: [...(here.passThrough ?? []), here.path.length + 1] }
      : { ...here, path: [...here.path, key] };
  }

  // ---- writing back -------------------------------------------------------

  function rememberArrangement(next: AnyView) {
    writeArrangement(accountKey(), scopeKey(scope()), { kind: next.kind, places: {} });
    setArrangementRevision((revision) => revision + 1);
  }

  function persistRootScope(next: AnyView) {
    if (root()?.canEdit !== true) return;
    const authoredRevision = root()?.revision;
    // An item a tree layout nested is still present; it was not removed. The
    // root is a flat list and cannot hold that nesting, so it is refused.
    const present = layoutItemIds(next.items);
    if (rootItems().some((item) => !next.items.some((candidate) => candidate.id === item.id) && present.has(item.id))) {
      setToolbarError(FLAT_SCOPE_NESTING);
      return;
    }
    const removed = rootItems().filter((item) => !present.has(item.id));
    void (async () => {
      for (const item of removed) {
        if (!await confirmDialog({ message: `Remove ${item.caption || "this data"}?`, variant: "danger", confirmLabel: "Remove" })) return;
        await changeRoot({ kind: "remove", itemId: item.id }, authoredRevision);
      }
      const ids = next.items.map((item) => item.id);
      if (ids.some((id, index) => rootItems()[index]?.id !== id)) await changeRoot({ kind: "reorder", itemIds: ids });
    })().catch((error) => setToolbarError(error instanceof Error ? error.message : String(error)));
  }

  async function deleteSet(viewId: string) {
    const row = homes().find((home) => home.id === viewId);
    if (!row) return;
    const held = viewPersistence.read(row.id, asView(row.view)).items.length;
    const confirmed = await confirmDialog({
      message: `Delete "${row.name}"?`,
      detail: held === 0 ? undefined : `It holds ${held === 1 ? "1 item" : `${held} items`}, which go with it.`,
      variant: "danger",
      confirmLabel: "Delete",
    });
    if (!confirmed) return;
    try {
      if (!await viewPersistence.flush(row.id)) return;
      await changeRoot({ kind: "remove", itemId: row.id });
      navigateScope(ROOT_SCOPE);
    } catch (error) {
      setToolbarError(`Could not delete that data: ${error instanceof Error ? error.message : String(error)}`);
    }
  }

  function persistValueScope(next: AnyView, localKeys?: string[]) {
    const here = scope();
    if (here.kind !== "value") return;
    const state = valueScope();
    if (!state?.ok) return;
    if (state.followedReference || !homeData.canArrange()) return;
    const session = transferSession();
    const resolveCanvasFunction = canvasFunctions(session);
    if (isCanvasExpression(state.sourceExpression, resolveCanvasFunction)) {
      if (next.kind !== "canvas") { rememberArrangement(next); return; }
      const projected = valueScopeItems();
      if (next.items.length !== projected.length || next.items.some((item, index) => item.id !== projected[index]?.id)) {
        setToolbarError("Add, remove, or reorder items in this canvas's source list.");
        return;
      }
      const draft = draftFor(state, currentCanvasDraft);
      const from = draft?.expression ?? state.sourceExpression;
      let expression = from;
      const geometry = new Map(draft?.geometry);
      // B4 wave 4 lane H: a Local keyed canvas reads its entry ids in its
      // worker; the move applies when they arrive, on the same state.
      if (reader?.kind === "local" && !localKeys && isEntriesCanvasExpression(from, resolveCanvasFunction)) {
        void localCanvasEntryIds(from, session).then(keys => {
          if (valueScope() !== state || scope() !== here || (draftFor(state, currentCanvasDraft)?.expression ?? state.sourceExpression) !== from)
            setToolbarError(LOCAL_SAVE_CHANGED);
          else persistValueScope(next, keys);
        }, error => setToolbarError(error instanceof Error ? error.message : String(error)));
        return;
      }
      try {
        const keys = localKeys ?? (isEntriesCanvasExpression(from, resolveCanvasFunction) ? canvasEntryIds(from, session) : undefined);
        if (keys && keys.length !== next.items.length) throw new Error("This canvas changed while you moved it. Try again.");
        const live = keys && new Set(keys);
        for (let index = 0; index < next.items.length; index++) {
          const item = next.items[index]!;
          const previous = projected[index]!;
          if (item.x !== previous.x || item.y !== previous.y || item.w !== previous.w || item.h !== previous.h) {
            expression = keys
              ? withKeyedPlacement(expression, keys[index]!, placementFromItem(item), live, resolveCanvasFunction)
              : withCanvasPlacement(expression, index, placementFromItem(item), resolveCanvasFunction);
            geometry.set(item.id, { x: item.x, y: item.y, w: item.w, h: item.h });
          }
        }
      } catch (error) {
        setToolbarError(error instanceof Error ? error.message : String(error));
        return;
      }
      if (expression === from) return;
      setCanvasDraft({ scope: state.scopeIdentity, base: draft?.base ?? state.sourceExpression,
        rootRevision: draft?.rootRevision ?? state.rootRevision, expression, geometry, settled: false });
      void writeCanvasDraft(state.item);
      return;
    }
    rememberArrangement(next);
    // As at the root: a value's children are a flat list, so a nested child
    // is refused, never read as removed.
    const present = layoutItemIds(next.items);
    if (state.children.some((child) => !next.items.some((item) => item.id === childItemId(child.key))
      && present.has(childItemId(child.key)))) {
      setToolbarError(FLAT_SCOPE_NESTING);
      return;
    }
    const wanted = next.items.map((item) => childItemKey(item.id))
      .filter((key): key is LocusPathStep => key !== undefined);
    const had = state.children.map((child) => child.key);
    if (wanted.length === had.length && wanted.every((key, index) => key === had[index])) return;
    void rewriteContainer(here, state, wanted);
  }

  /** Rebuild the container from the keys the renderer handed back — which is
   *  both "what is still here" and "in what order". A variant keeps its `$tag`:
   *  dropping the discriminator would change what the value IS. */
  async function rewriteContainer(
    here: Extract<LocusScope, { kind: "value" }>,
    state: Extract<ValueScopeState, { ok: true }>,
    keys: LocusPathStep[],
  ) {
    try {
      await writeValueScopeExpression(state, retainExpressionChildren(state.sourceExpression, here.path, keys, expressionEditOptions()));
    } catch (error) {
      setToolbarError(error instanceof Error ? error.message : String(error));
    }
  }

  /** One write-back for every edit made inside a value: turn the whole changed
   *  value into an expression and replace the card that holds it. This is the
   *  SAME path the nested field editor uses, which is why editing a value from
   *  inside it and from its card cannot disagree. */
  async function writeValueScopeExpression(state: Extract<ValueScopeState, { ok: true }>, expr: ExprNode,
    definitionBundle?: Parameters<typeof api.definitionBundleSave>[0], expectedSavedQuery?: Record<string, unknown>, sourceTicket = state.sourceTicket, assertCurrent?: () => void) {
    const assertTarget = () => {
      assertCurrent?.();
      assertCurrentSession(state.epoch);
      assertSourceTicket(sourceTicket);
      if (scopeKey(scope()) !== state.scopeIdentity || current()?.id !== state.row.id) {
        throw new Error("The destination changed while preparing this edit. Return to it and try again.");
      }
      if (root()?.revision !== state.rootRevision) {
        throw new Error("This data changed while preparing the edit. Try again with its current contents.");
      }
    };
    assertTarget();
    if (state.followedReference) throw new Error("Edit this definition through its type or function editor.");
    if (state.item.valueType) {
      let issue: string | undefined;
      if (!props.publicData && reader?.kind === "local") {
        // B4 slice 1: evaluation and admission run together in the reader's worker.
        issue = await localExpressionSaveIssue(expr, { reader, session: transferSession, saved: savedExprById(),
          expectedType: state.item.valueType, evaluate: true, signal: client.signal, current: assertTarget });
      } else {
        const session = transferSession();
        issue = draftSaveIssue(expr, session.environment, { expectedType: state.item.valueType,
          registry: session.registry, resolveSavedExpr: (id) => savedExprById().get(id),
          evaluatedValue: evaluateAuthoringExpression(expr, (id) => savedExprById().get(id), session).result,
          evaluateContext: session.evaluateContext });
      }
      if (issue) throw new Error(issue);
    }
    const type = homeData.type(state.item);
    await homeData.replace(state.item, expr, type, undefined, undefined, state.rootRevision, definitionBundle, expectedSavedQuery ?? state.sourceQuery, sourceTicket, assertCurrent);
  }

  /** The names the breadcrumb and the lift label read a scope by. */
  function scopeNames() {
    return {
      viewName: (id: string) => rowById(id)?.name,
      itemName: (viewId: string, itemId: string) => {
        const row = rowById(viewId);
        return row ? findLocusItem(asView(row.view).items, itemId)?.caption : undefined;
      },
    };
  }

  /** The explicit move keeps its original reader and source across awaits. */
  function assertValueScopeCurrent(state: Extract<ValueScopeState, { ok: true }>) {
    assertCurrentSession(state.epoch);
    client.signal?.throwIfAborted();
    assertSourceTicket(state.sourceTicket);
    if (valueScope() !== state || scopeKey(scope()) !== state.scopeIdentity || root()?.revision !== state.rootRevision
      || transferSession() !== state.sourceSession || authoringWorkerSnapshot(state.sourceSession) !== state.sourceWorker)
      throw new Error("This data's source changed while preparing the move. Retry with its current contents.");
  }

  /** A breadcrumb may reuse an ancestor read, but cannot turn a projected
   * child's value into that ancestor or start an unsolicited parent run. */
  function valueScopeBreadcrumbRead(state: Extract<ValueScopeState, { ok: true }>, path: readonly LocusPathStep[]) {
    if (path.length >= state.basePath.length && state.basePath.every((step, index) => path[index] === step))
      return { known: true as const, value: state.rootValue, type: state.rootValueType, path: path.slice(state.basePath.length) };
    const retained = readLocusCardResult(state.sourceExpression, state.sourceSnapshot, state.sourceSession);
    if (retained && !retained.error) return { known: true as const, value: retained.result, type: state.itemType, path };
    const projected = projectAuthoredRead(state.sourceExpression, path, state.itemType, state.expressionOptions);
    return { known: false as const, type: projected.basePath.length === path.length ? projected.type : undefined };
  }

  /** Ancestors are read only for an explicit move, using the original source
   * and exact captured reader. A projected child is never a fabricated parent. */
  async function valueScopeParentValue(state: Extract<ValueScopeState, { ok: true }>, path: readonly LocusPathStep[]) {
    assertValueScopeCurrent(state);
    if (path.length >= state.basePath.length && state.basePath.every((step, index) => path[index] === step))
      return valueAt(state.rootValue, path.slice(state.basePath.length));
    const answer = readLocusCardResult(state.sourceExpression, state.sourceSnapshot, state.sourceSession)
      ?? await evaluateLocusCard(state.sourceExpression, state.sourceSnapshot, state.sourceSession, { transient: true, signal: client.signal });
    assertValueScopeCurrent(state);
    if (answer.error) throw new Error(answer.error);
    return valueAt(answer.result, path);
  }

  /** Move a value out to the scope that encloses this one.
   *
   *  It leaves where it was and arrives where its new siblings can see it —
   *  the SAME value, not a copy, which is the whole reason the operation
   *  exists. The arrival is written FIRST: a failure then leaves the value in
   *  both places, which the user can see and fix, where the other order would
   *  lose it. */
  async function liftItem(item: LayoutItem) {
    const here = scope();
    if (here.kind !== "value") return;
    const key = childItemKey(item.id);
    if (key === undefined) return;
    const state = valueScope();
    if (!state?.ok) { setToolbarError("This data is no longer here to move."); return; }
    const from = [...here.path, key];
    try {
      const expr = expressionAt(state.sourceExpression, from, state.expressionOptions);
      const remaining = removeExpressionAt(state.sourceExpression, from, state.expressionOptions);
      if (here.path.length > 0) {
        // Out into the value one level up. Only a list can take it without
        // being told a name.
        const parentPath = here.path.slice(0, -1);
        if (!Array.isArray(await valueScopeParentValue(state, parentPath))) {
          throw new Error("The data out here is a record, so it needs a field name. Edit it to add one.");
        }
        await writeValueScopeExpression(state, appendExpressionAt(remaining, parentPath, expr, state.expressionOptions),
          undefined, undefined, state.sourceTicket, () => assertValueScopeCurrent(state));
      } else {
        // Out into the data set: the value becomes a card of its own.
        const row = rowById(here.viewId);
        if (!row) throw new Error("The list holding this data is no longer here.");
        const session = transferSession();
        const type = childValueType(state.container, state.containerType, key, session);
        const view = viewPersistence.read(row.id, asView(row.view));
        const card: LayoutItem = {
          id: genId(), caption: item.caption, valueType: type,
          source: { kind: "expr", expr },
        };
        if (row.id === root()?.id && state.item.source?.kind !== "ref") {
          await changeRoot({ kind: "batch", commands: [
            { kind: "append", item: card },
            { kind: "replace", itemId: state.item.id, item: { ...state.item, source: { kind: "expr", expr: remaining } } },
          ] }, state.rootRevision);
        } else if (row.id !== root()?.id && state.item.source?.kind !== "ref") {
          const next = updateItemInView(view, state.item.id, (original) => ({ ...original, source: { kind: "expr", expr: remaining }, expr: undefined }));
          viewPersistence.update(row.id, { ...next, items: [...next.items, card] });
          if (!await viewPersistence.flush(row.id)) throw new Error("The move is kept here, but saving failed. Retry above.");
        } else {
          throw new Error("Move this item from the saved data's source so its references stay intact.");
        }
      }
      setImportNotice("Moved out. It is reachable from here and from everything inside.");
    } catch (error) {
      setToolbarError(error instanceof Error ? error.message : String(error));
    }
  }

  /** Adding at the root means adding a data set, because that is what the
   *  root's items ARE. The value lands inside the new set. */
  async function importIntoRoot(captured: TransferSnapshot) {
    importIntoView(captured, root()?.id);
  }

  /** Adding inside a value appends to the list you are looking at. A record
   *  cannot grow without being told a field name, so it says so. */
  function importIntoValueScope(captured: TransferSnapshot, retainedTicket?: WorkspaceTransferTicket) {
    const here = scope();
    if (here.kind !== "value") return;
    const epoch = sessionEpoch();
    const controller = new AbortController();
    const ticket = retainedTicket ?? (reader?.kind === "local"
      ? queueWorkspaceTransfer(captured, here.viewId, undefined, transferOwner) : undefined);
    importControllers.add(controller);
    setImporting((count) => count + 1);
    setTransferComplete(false);
    setTransferSequence(sequence => sequence + 1);
    importChain = importChain.then(async () => {
      assertCurrentSession(epoch);
      controller.signal.throwIfAborted();
      if (ticket && !claimWorkspaceTransfer(ticket, transferOwner)) return;
      if (scopeKey(scope()) !== scopeKey(here)) throw new Error("The destination changed before this paste could start. Return to it and paste again.");
      const state = valueScope();
      if (!state?.ok) throw new Error(state?.error ?? "This data is no longer here.");
      if (state.scopeIdentity !== scopeKey(here)) throw new Error("This data is still changing. Paste again when it is ready.");
      const items = await ingestTransfer(captured, { signal: controller.signal });
      controller.signal.throwIfAborted();
      assertCurrentSession(epoch);
      const session = transferSession();
      const analyzed = await analyzeWorkspaceTransfer(items, session, controller.signal);
      controller.signal.throwIfAborted();
      assertCurrentSession(epoch);
      if (analyzed.length === 0) {
        if (ticket) acknowledgeWorkspaceTransfer(ticket, transferOwner);
        completeImport();
        return;
      }
      let nextExpr = state.sourceExpression;
      for (const entry of analyzed) nextExpr = appendExpressionAt(nextExpr, here.path, entry.expr, expressionEditOptions());
      await writeValueScopeExpression(state, nextExpr);
      controller.signal.throwIfAborted();
      assertCurrentSession(epoch);
      if (ticket) acknowledgeWorkspaceTransfer(ticket, transferOwner);
      setImportNotice(items.map((item) => item.note).filter(Boolean).join(" ") || undefined);
      completeImport();
    }).catch(error => {
      afterImport = undefined;
      if (!controller.signal.aborted && epoch === sessionEpoch()) {
        if (ticket) acknowledgeWorkspaceTransfer(ticket, transferOwner);
        setToolbarError(error instanceof Error ? error.message : String(error));
      }
    }).finally(() => {
      if (ticket) releaseWorkspaceTransfer(ticket, transferOwner);
      importControllers.delete(controller);
      if (!controller.signal.aborted && epoch === sessionEpoch()) setImporting((count) => count - 1);
    });
    return importChain;
  }

  type MenuSuggestionIntent = {
    captured: { ok: true; source: ReturnType<typeof captureDataOccurrence>; session: AuthoringSession;
      revision: string; inputFingerprint: string } | { ok: false; error: unknown };
    requested: boolean;
  };
  type MenuTarget = {
    x: number; y: number; epoch: number; viewId?: string;
    focus: LocusScope; source?: string;
    suggestions?: boolean;
    suggestionsLens?: boolean;
    item?: LayoutItem; element: Element | null; transfer?: TransferCommands; hint?: PlacementHint;
    occurrence?: MenuOccurrence;
    suggestionIntent?: MenuSuggestionIntent;
  };
  const [contextMenu, setContextMenu] = createSignal<MenuTarget>();
  const [startedSuggestionMenu, setStartedSuggestionMenu] = createSignal<MenuTarget>();
  const [codeItemId, setCodeItemId] = createSignal<string>();
  const [sourceDialog, setSourceDialog] = createSignal<LayoutItem>();
  function openInspection(item: LayoutItem, mode: DataInspectionMode, evaluated = homeData.evaluated(item)) {
    setLensMode(mode);
    const next = enterScopeFor(item, evaluated);
    if (next) navigateScope(next);
  }
  let sourceIntentConsumed = false;
  // A focused leaf is rendered as $self, while a container renders its
  // children. Inspect the original container when no matching card exists;
  // its authored source remains available even if evaluation is still pending.
  createEffect(() => {
    if (!initialSource) return undefined;
    const here = scope();
    if (initialSource.scope && scopeKey(initialSource.scope) !== scopeKey(here)) return undefined;
    if (here.kind !== "value") return { cardId: initialSource.itemId };
    if (here.itemId !== initialSource.itemId) return undefined;
    if (props.pane) return { expressionLens: true };
    const state = valueScope();
    if (state?.ok && state.leaf) return { cardId: "$self" };
    const row = rowById(here.viewId);
    if (!row) return undefined;
    const item = findLocusItem(viewPersistence.read(row.id, asView(row.view)).items, here.itemId);
    const expr = item && resolveExpr(item, savedExprById());
    return item && expr ? { item: { ...item, source: { kind: "expr" as const, expr } } } : undefined;
  }, target => {
    if (!target || sourceIntentConsumed) return;
    sourceIntentConsumed = true;
    if (target.expressionLens) { setLensMode("code"); focusedExpressionState().setCode(true); }
    else if (target.cardId) setCodeItemId(target.cardId);
    else if (target.item) setSourceDialog(target.item);
  });
  const [cutMark, setCutMark] = createSignal<{ itemId: string }>();
  const [inspectItem, setInspectItem] = createSignal<string>();
  const [moving, setMoving] = createSignal<LayoutItem>();
  const [readingClipboard, setReadingClipboard] = createSignal(false);
  let clipboardRead: AbortController | undefined;
  onCleanup(() => clipboardRead?.abort());
  createEffect(() => `${sessionEpoch()}:${current()?.id ?? ""}`, () => {
    setContextMenu(undefined);
    clipboardRead?.abort();
  });

  function menuIsCurrent(menu: MenuTarget): boolean {
    return menu.epoch === sessionEpoch() && menu.viewId === current()?.id;
  }
  // B4 unit D: a Local reader prepares the menu item's copy in its worker
  // when the menu opens (guidance class, latest wins), so Copy itself writes
  // the clipboard synchronously inside the menu's gesture.
  const [copyPrefetchMenu, setCopyPrefetchMenu] = createSignal<MenuTarget>();
  createEffect(() => contextMenu(), menu => { if (menu) setCopyPrefetchMenu(menu); });
  const localCopyPrefetch = !props.publicData && reader?.kind === "local" ? createLocalReaderAnswer(() => reader, transferSession, () => {
    const menu = copyPrefetchMenu();
    const item = menu?.item;
    if (!menu || !item || menu.transfer) return undefined;
    const rendered = homeData.evaluated(item);
    if (!rendered) return undefined;
    return { method: "prepare-reader-transfer-item" as const, priority: "guidance" as const, item: { value: cloneDraftValue(rendered.value),
      type: homeData.type(item), typeName: classifyData(rendered.value), label: item.caption, source: "fenel" as const } };
  }, readActionResult<TransferItem>("transferItem", value => !!value && typeof value === "object"), { via: () => transferSession() }) : undefined;

  function vagueType(type: FenelType | undefined): boolean {
    if (!type) return true;
    if ("$record" in type || "$variant" in type || "$complement" in type) return true;
    return false;
  }

  const repairedTypes = new Set<string>();
  function repairType(item: LayoutItem, name: string) {
    const key = `${item.id}:${name}`;
    if (repairedTypes.has(key) || root()?.canEdit !== true || !homeData.canWrite()) return;
    const entry = transferSession().environment.catalog.types.find((candidate) =>
      (candidate.name === name || candidate.id === name) && candidate.entityId);
    if (!entry?.entityId || refHandle(item.valueType) === entry.entityId || !vagueType(item.valueType)) return;
    const row = current();
    if (!row || !findLocusItem(row.view.items, item.id)) return;
    repairedTypes.add(key);
    const type = { $ref: entry.entityId } as FenelType;
    if (row.id === root()?.id) {
      void changeRoot({ kind: "replace", itemId: item.id, item: { ...item, valueType: type } }).catch(() => { repairedTypes.delete(key); });
      return;
    }
    const view = viewPersistence.read(row.id, asView(row.view));
    viewPersistence.update(row.id, updateItemInView(view, item.id, (currentItem) => ({ ...currentItem, valueType: type })));
    void viewPersistence.flush(row.id).then((saved) => { if (!saved) repairedTypes.delete(key); });
  }

  function finishCut(menu: MenuTarget) {
    const mark = cutMark();
    setCutMark(undefined);
    if (!mark || (menu.item?.id === mark.itemId && menu.transfer)) return;
    const subject = scopeSubject();
    if (!subject.row || !findLocusItem(subject.row.view.items, mark.itemId)) return;
    subject.persist(removeLocusItem(subject.row.view, mark.itemId));
  }

  let afterImport: (() => void) | undefined;
  function completeImport() {
    setTransferComplete(true);
    const done = afterImport;
    afterImport = undefined;
    done?.();
  }

  async function placeMoved(place: MovePlace, item: LayoutItem) {
    const expr = resolveExpr(item, savedExprById());
    const sameAccount = !client.accountId || place.accountId === client.accountId;
    let source = item.source;
    if (!sameAccount) {
      const value = homeData.evaluated(item)?.value;
      if (value === undefined) throw new Error("This data is still loading, so it cannot move to another account yet.");
      source = { kind: "expr", expr: { kind: "literal", value } };
    } else if (!source && expr) source = { kind: "expr", expr };
    const moved: LayoutItem = {
      id: genId(), caption: item.caption, valueType: item.valueType, representations: item.representations, source,
    };
    const remote = sameAccount ? undefined : createAccountApiClient(place.accountId);
    const rootApi = remote ?? client;
    const views = remote?.api ?? api;
    if (place.kind === "root") {
      const loaded = (await rootApi.getLocusRoot.uncached()).root;
      await rootApi.editLocusRoot(place.rootId, loaded.revision, { kind: "append", item: moved });
    } else if (place.listId) {
      const loaded = (await rootApi.getLocusRoot.uncached()).root;
      const list = loaded.lists.find((entry) => entry.id === place.listId);
      if (!list) throw new Error("That list is no longer there.");
      await views.locusViewUpdate(list.id, {
        view: { ...list.view, items: [...list.view.items, moved] },
        expectedRootRevision: loaded.revision,
      });
    }
    const subject = scopeSubject();
    if (subject.row && findLocusItem(subject.row.view.items, item.id)) {
      subject.persist(removeLocusItem(subject.row.view, item.id));
    }
    if (!sameAccount) revalidate(["locusRoot", "locusViews", "activeLocusView"]);
  }

  /** `lens`: the graph belongs to the lens panel's latest ask. That panel's
   * memo asks again whenever the focus, source ticket or session changes, so
   * the latest ask IS the current subject. Comparing those signals again
   * from a worker answer is wrong: after an in-app move the answer lands
   * outside the move's transition, where they still read the previous focus,
   * and every graph after the first move was refused. */
  function dependencyData(item: LayoutItem, sourceReference: string | undefined, lens: { latest?: object }) {
    const session = homeAuthoringSession();
    const capture = captureReaderSourceMetadata(session);
    if (!capture) throw new Error("Dependencies need this data's current source. Wait for its reader to prepare, then retry.");
    const epoch = sessionEpoch();
    const ask = {};
    lens.latest = ask;
    const ownedCapture = { ...capture, current: () => !client.signal?.aborted && capture.current() && epoch === sessionEpoch()
      && lens.latest === ask };
    const projection = createSourceDependencyGraphData(session, { $tag: "DependencySourceLocator",
      source: capture.packet.source, rootId: capture.packet.rootId, occurrenceId: item.id }, ownedCapture,
      node => createModalCtx.composeSuggestion(node), message => setToolbarError(message), undefined, sourceReference);
    return { projection, capture: ownedCapture };
  }
  // A retained reference selects its admitted binding through the same Fenel
  // source query. Other children keep their card's graph centred on the
  // references and calls of their own authored source, when it has one.
  const lensDependencies = createMemo((): { projection?: DependencyGraphProjection; centre?: readonly string[];
    containedIn?: string; guidance?: string; occurrences?: ReaderSourceMetadataCapture["packet"]["occurrences"];
    collection?: LinkedCollectionAsk } => {
    const here = scope();
    // A list or a whole source has no single card to draw: say what to open
    // instead of raising an error (the panel stays open across navigation).
    if (props.pane?.subject?.() || here.kind !== "value") {
      lensDependencyAsk.latest = undefined;
      return { guidance: "Open a data card to inspect its dependencies." };
    }
    if (!here.path.length) {
      const data = dependencyData({ id: here.itemId }, undefined, lensDependencyAsk);
      return { projection: data.projection, occurrences: data.capture?.packet.occurrences };
    }
    const loaded = root();
    const card = loaded && findLocusItem(here.rootItem ? loaded.items
      : loaded.lists.find(row => row.id === here.viewId)?.view.items ?? [], here.itemId);
    const expression = card && resolveExpr(card, savedExprById());
    const authored = expression ? projectAuthoredExpression(expression, here.path, expressionEditOptions()) : undefined;
    // A collection of linked data (People and projects): its members and what
    // they hold, drawn as one graph of their cards. Decided from the authored
    // source alone, before any card is evaluated, so the whole Demo is never walked.
    const members = authored && !authored.sourcePath.length ? collectionMemberReferences(authored.source) : [];
    if (members.length >= 2) {
      let collectionType = card ? homeData.type(card) : undefined;
      for (const step of here.path) collectionType = childValueType(undefined, collectionType, step, transferSession());
      const collection = linkedCollectionData(members, collectionType);
      // A card opens through the public catalogue's own paths; the packet is read later, off this turn.
      return { collection };
    }
    const sourceReference = authored?.source.kind === "ref" ? authored.source.savedExprId : undefined;
    const data = dependencyData({ id: here.itemId }, sourceReference, lensDependencyAsk);
    // The identities the nested value is made of, as the codec reports them:
    // code identities held as `{$ref}` count too (`/std/add` centres on add).
    const slots = authored && !authored.sourcePath.length ? sourceExecutableSlots(authored.source) : [];
    const identities = (tags: readonly string[]) => slots.flatMap(slot => tags.includes(slot.$tag) && "identity" in slot ? [slot.identity] : []);
    return { projection: data.projection, occurrences: data.capture?.packet.occurrences,
      centre: [...new Set([...identities(["SourceReference", "SourceFieldReference"]), ...identities(["SourceCodeReference"]),
        ...identities(["SourceCall", "SourceConstructor"])])],
      // A retained reference draws its own graph; other parts show their card.
      containedIn: sourceReference === undefined ? displayNameText(card?.caption)?.trim() || "its card" : undefined };
  }, { lazy: true });
  // The lens panel's latest dependency ask (read only once the memo above runs).
  const lensDependencyAsk: { latest?: object } = {};
  /** One ask of Fenel's walk for every member's parts (linked-data-graph-query.ts),
   * owned like the panel's other asks: a later ask or another reader retires it. */
  function linkedCollectionData(members: readonly HeldReference[], collectionType: FenelType | undefined): LinkedCollectionAsk {
    const session = homeAuthoringSession();
    const epoch = sessionEpoch();
    const ask = {};
    lensDependencyAsk.latest = ask;
    const ids = [...new Set(members.map(member => member.identity))];
    const saved = savedExprById();
    // The members' values this page already holds (the collection it shows,
    // once its read has settled): no second evaluation. Evaluating them again
    // took about 20 seconds of the page's thread for People and projects.
    const held = untrack(() => {
      try {
        if (valueScopeLoading()) return undefined;
        const state = valueScope();
        if (!state?.ok) return undefined;
        const found = new Map(members.map(member => [member.identity, valueAt(state.container, [member.path[0]!])] as const));
        return ids.every(id => found.get(id) !== undefined) ? found : undefined;
      } catch { return undefined; }
    });
    // The three costly steps (the reader's source packet, Fenel's walk, the
    // members' values) run on the page for public data: each in its own turn,
    // after the panel has painted, so the page keeps answering between them.
    const turn = () => new Promise<void>(resolve => setTimeout(resolve, 0));
    const read = turn().then(() => {
      const capture = captureReaderSourceMetadata(session);
      if (!capture) throw new Error("Dependencies need this data's current source. Wait for its reader to prepare, then retry.");
      const ownedCapture = { ...capture, current: () => !client.signal?.aborted && capture.current() && epoch === sessionEpoch()
        && lensDependencyAsk.latest === ask };
      return turn().then(() => readLinkedParts(session, ownedCapture, ids));
    }).then(walk => held ? { walk, values: held as ReadonlyMap<string, unknown> } : turn().then(() => readLinkedValues(session, ids, saved))
      .then(values => ({ walk, values: new Map(ids.map((id, index) => [id, values[index]] as const)) as ReadonlyMap<string, unknown> })));
    // The panel reports a refusal; an unobserved one is not an unhandled error.
    read.catch(() => {});
    const types = new Map(members.map(member => [member.identity,
      childValueType(undefined, collectionType, member.path[0]!, transferSession())] as const));
    return { members, session, types, read };
  }
  /** A graph card's type, as a data card of that type names it (its mark and label). */
  function LinkedCardType(typeProps: { item: LayoutItem }) {
    const presentation = useDataTypePresentation({ get type() { return typeProps.item.valueType; },
      get declaredType() { return typeProps.item.valueType; }, get value() { return homeData.evaluated(typeProps.item)?.value; } });
    return <Show when={!presentation().pending && presentation().label}>{label =>
      <span class="linked-graph__type"><ValueTypeCaption label={label()} icon={presentation().icon} /></span>}</Show>;
  }
  /** A graph card's title where its body draws none: a function held by
   * reference is named as a function card names it (its authored label, else
   * its code name in the code face). Records head themselves in their body. */
  function LinkedCardTitle(titleProps: { value: unknown; fallback?: string }) {
    const title = () => linkedCardTitle(titleProps.value, id => callableDisplayName(id, titleProps.fallback));
    return <Show when={displayNameText(title())?.trim() ? title() : undefined}>{name =>
      <span class="linked-graph__title"><DisplayNameText name={name()} /></span>}</Show>;
  }
  /** The collection's graph: its members' cards as the page draws them, and
   * each linked part's card from the value its member already holds. */
  function LinkedCollectionGraph(graphProps: { ask: LinkedCollectionAsk }) {
    const walk = createAsyncValue(() => graphProps.ask, ask => ask.read);
    const view = createMemo(() => {
      const answer = walk();
      if (!answer) return undefined;
      const parts = answer.walk;
      // Each member's card: its value from the one batched read, its type from the collection's.
      const memberCards = new Map<string, LayoutItem>();
      for (const member of graphProps.ask.members) {
        const value = answer.values.get(member.identity);
        if (value === undefined || memberCards.has(member.identity)) continue;
        memberCards.set(member.identity, { id: `$linked:${member.identity}`, caption: String(member.path[0]),
          valueType: graphProps.ask.types.get(member.identity),
          source: { kind: "expr", expr: renderedDataExpression(value, { source: { kind: "ref", savedExprId: member.identity }, sourcePath: [] }) } });
      }
      const saved = savedExprById();
      const positions = new Map<string, HeldReference[]>(graphProps.ask.members.map(member => [member.identity, heldReferences(saved.get(member.identity))]));
      const members: LinkedNode[] = graphProps.ask.members.map(member => {
        const item = memberCards.get(member.identity);
        return { id: member.identity, label: (item && displayNameText(item.caption)?.trim()) || String(member.path[member.path.length - 1]) };
      });
      const graph = collectionLinkedGraph({ members, walk: parts,
        held: holder => new Set((positions.get(holder) ?? []).map(row => row.identity)) });
      // A link Fenel leaves unnamed (a formula held as a function reference)
      // takes the name the holder's own type gives that field.
      nameUnnamedLinks(graphProps.ask.session, graph.edges,
        edge => positions.get(edge.from)?.find(row => row.identity === edge.to)?.path[0],
        id => ({ declared: memberCards.get(id)?.valueType, value: answer.values.get(id) }));
      const partCards = new Map<string, LayoutItem>();
      // The value each part's card draws, for its title (a function held by reference).
      const partValues = new Map<string, unknown>();
      for (const node of graph.nodes) {
        if (memberCards.has(node.id)) continue;
        for (const member of graphProps.ask.members) {
          const holder = memberCards.get(member.identity);
          const holderValue = answer.values.get(member.identity);
          const at = positions.get(member.identity)?.find(row => row.identity === node.id);
          if (!holder || holderValue === undefined || !at) continue;
          let type = holder.valueType, value: unknown = holderValue;
          for (const step of at.path) { type = childValueType(value, type, step, graphProps.ask.session); value = valueAt(value, [step]); }
          if (value === undefined) continue;
          const isCode = !!value && typeof value === "object" && (value as { $ref?: unknown }).$ref === node.id;
          partValues.set(node.id, value);
          const source: ExprNode = isCode ? { kind: "literal", value: { $ref: node.id } } : { kind: "ref", savedExprId: node.id };
          partCards.set(node.id, { id: `$linked:${node.id}`, caption: node.label, valueType: type,
            source: { kind: "expr", expr: renderedDataExpression(value, { source, sourcePath: [] }) } });
          break;
        }
      }
      // Each card's kind (its type's identity), for joining the lines of holders of one kind.
      const kinds = new Map<string, string | undefined>();
      for (const [id, item] of [...memberCards, ...partCards]) kinds.set(id, linkedKind(graphProps.ask.session, item.valueType, homeData.evaluated(item)?.value));
      return { graph, memberCards, partCards, partValues, kinds, central: new Set(members.map(member => member.id)) };
    });
    return <Show when={view()} fallback={<Show when={!walk.loading && walk.error} fallback={<LensSpinner />}>
      {error => <div class="related-data-panel__status" role="alert">
        <p class="dependency-graph-refusal">Links can't be drawn: some data in this tab couldn't be read.</p>
        <details class="dependency-graph-refusal__details"><summary>Details</summary>
          {(() => { const issue = error(); return issue instanceof Error ? issue.message : String(issue); })()}</details>
      </div>}</Show>}>
      {shown => <Show when={shown().memberCards.size > 0} fallback={<LensSpinner />}>
        <LinkedDataGraph graph={shown().graph} central={shown().central} label="Linked data" kind={id => shown().kinds.get(id)}
          canOpen={id => dependencyGraphHost.canOpen?.(id) === true} open={id => dependencyGraphHost.open?.(id)}
          card={node => { const item = shown().memberCards.get(node.id) ?? shown().partCards.get(node.id);
            return item ? <>
              <LinkedCardType item={item} />
              <LinkedCardTitle value={shown().partValues.get(node.id)} fallback={node.label} />
              <EvaluatedFlowItemView item={item} savedExprById={savedExprById()} evaluated={homeData.evaluated(item)}
                onRemove={() => {}} preview presentation="body" />
            </> : <DependencyNodeCaption label={node.label} type={dependencyNodeType(node.id)} />; }} />
      </Show>}
    </Show>;
  }
  /** One datum's Dependencies as the same graph of cards: Fenel's linked
   * walk around it (its parts and its users, two links), every node that is
   * saved data drawn as its card from ONE batched read of their values, a
   * function held by reference as its card, anything else (a call, the Demo
   * that holds it) by its name. Lines run from the holder to what it holds. */
  function FocusLinkedGraph(graphProps: { projection: DependencyGraphProjection }) {
    const answer = createAsyncValue(() => graphProps.projection, async projection => {
      const graph: DependencyGraphValue = "local" in projection ? (await projection.local.read).value : projection.value;
      const saved = savedExprById();
      const nodes = Array.isArray(graph.nodes) ? graph.nodes : [];
      const refs = nodes.map(node => node.id).filter(id => saved.has(id));
      const values = refs.length ? await readLinkedValues(homeAuthoringSession(), refs, saved) : [];
      return { graph, values: new Map(refs.map((id, index) => [id, values[index]] as const)) };
    });
    const view = createMemo(() => {
      const settled = answer();
      if (!settled) return undefined;
      const { graph, values } = settled;
      const session = homeAuthoringSession();
      const nodes: LinkedNode[] = (Array.isArray(graph.nodes) ? graph.nodes : []).map(node => ({ id: node.id, label: node.label }));
      const edges = new Map<string, { from: string; to: string; labels: string[] }>();
      for (const edge of Array.isArray(graph.edges) ? graph.edges : []) {
        // Fenel's edge runs from the part to its holder; drawn from the holder.
        const key = JSON.stringify([edge.to, edge.from]);
        const labels = (Array.isArray(edge.labels) ? edge.labels : []).filter((label): label is string => typeof label === "string" && label !== "");
        const kept = edges.get(key);
        if (kept) { for (const label of labels) if (!kept.labels.includes(label)) kept.labels.push(label); }
        else if (edge.to !== edge.from) edges.set(key, { from: edge.to, to: edge.from, labels: [...new Set(labels)] });
      }
      const cards = new Map<string, LayoutItem>();
      const held = new Map<string, unknown>();
      for (const node of nodes) {
        const value = values.has(node.id) ? values.get(node.id)
          : session.registry.getFunction(node.id) ? { $ref: node.id } : undefined;
        if (value === undefined) continue;
        held.set(node.id, value);
        const source: ExprNode = values.has(node.id) ? { kind: "ref", savedExprId: node.id } : { kind: "literal", value: { $ref: node.id } };
        cards.set(node.id, { id: `$linked:${node.id}`, caption: node.label,
          source: { kind: "expr", expr: renderedDataExpression(value, { source, sourcePath: [] }) } });
      }
      // A link Fenel leaves unnamed takes the name the holder's type gives that field.
      const saved = savedExprById();
      const linked = [...edges.values()];
      nameUnnamedLinks(session, linked, edge => heldReferences(saved.get(edge.from)).find(row => row.identity === edge.to)?.path[0],
        id => ({ value: values.get(id) }));
      const kinds = new Map<string, string | undefined>([...values].map(([id, value]) => [id, linkedKind(session, undefined, value)] as const));
      return { graph: { nodes, edges: linked }, cards, held, kinds, central: new Set([graph.focus]) };
    });
    return <Show when={view()} fallback={<Show when={!answer.loading && answer.error} fallback={<LensSpinner />}>
      {error => <div class="related-data-panel__status" role="alert">
        <p class="dependency-graph-refusal">Links can't be drawn: some data in this tab couldn't be read.</p>
        <details class="dependency-graph-refusal__details"><summary>Details</summary>
          {(() => { const issue = error(); return issue instanceof Error ? issue.message : String(issue); })()}</details>
      </div>}</Show>}>
      {shown => <LinkedDataGraph graph={shown().graph} central={shown().central} label="Dependencies" kind={id => shown().kinds.get(id)}
        canOpen={id => dependencyGraphHost.canOpen?.(id) === true} open={id => dependencyGraphHost.open?.(id)}
        card={node => { const item = shown().cards.get(node.id);
          return item ? <>
            <LinkedCardType item={item} />
            <LinkedCardTitle value={shown().held.get(node.id)} fallback={node.label} />
            <EvaluatedFlowItemView item={item} savedExprById={savedExprById()} evaluated={homeData.evaluated(item)}
              onRemove={() => {}} preview presentation="body" />
          </> : <DependencyNodeCaption label={node.label} type={dependencyNodeType(node.id)} />; }} />}
    </Show>;
  }
  function openContextMenu(event: MouseEvent, occurrence?: MenuOccurrence) {
    if (!ownsLocusContextMenu(event)) return;
    event.preventDefault();
    event.stopPropagation();
    const element = event.target instanceof Element ? event.target : null;
    const position = locusContextPosition(event);
    const itemId = element?.closest<HTMLElement>("[data-locus-item]")?.dataset.locusItem;
    const row = current();
    const date = element?.closest<HTMLElement>("[data-home-date]")?.dataset.homeDate;
    const parentId = element?.closest<HTMLElement>("[data-home-parent]")?.dataset.homeParent;
    const rect = (element?.closest(".home-canvas") ?? stage)?.getBoundingClientRect();
    const hint: PlacementHint | undefined = parentId ? { parentId } : date ? { date }
      : rect && row?.view.kind === "canvas"
        ? { x: clamp01((position.x - rect.left) / rect.width), y: clamp01((position.y - rect.top) / rect.height) } : undefined;
    const item = occurrence?.item ?? (itemId ? findLocusItem(scopeSubject().row?.view.items ?? [], itemId) : undefined);
    // Capture the original subject now, without starting an unrelated query.
    // Closing an older menu retains the owner's existing held-panel rule.
    dataSuggestions.close();
    const suggestionIntent = captureDataSuggestionsFor(item, occurrence);
    setContextMenu({ ...position, epoch: sessionEpoch(), viewId: row?.id, focus: scope(),
      source: props.pane && workspaceSourceKey(props.pane.source()), element, hint,
      item, occurrence, suggestionIntent,
      transfer: transferCommandsFor(element),
    });
  }

  /** Where a Dependencies node lives in this tab, if anywhere. */
  const dependencyNodeScope = (id: string) => {
    const loaded = root();
    return dependencyNodeTarget(id, { rootId: loaded?.id, rootItems: loaded?.items, lists: loaded?.lists,
      packetOccurrences: lensDependencies()?.occurrences, catalogPaths: props.publicData?.catalogPaths });
  };
  /** A node's declared type, when this page holds it: the item's own type,
   * or a public library entry's signature. Nothing is evaluated. */
  const dependencyNodeType = (id: string): FenelType | undefined => {
    const item = dependencyNodeItem(id);
    if (item) return item.valueType;
    if (!props.publicData) return undefined;
    const fn = homeAuthoringSession().registry.getFunction(id);
    return fn ? fn.params.length ? { $arrow: { params: fn.params, returns: fn.returns } } as FenelType : fn.returns : undefined;
  };
  /** A node's caption, as a data card of this page heads itself. */
  function DependencyNodeCaption(captionProps: { label: string; type?: FenelType; onOpen?: () => void }) {
    const presentation = useDataTypePresentation(captionProps);
    return <ValueCardCaption caption={captionProps.label} presentation="inline" hideType
      icon={captionProps.type && !presentation().pending ? presentation().icon : undefined} onOpen={captionProps.onOpen} />;
  }
  /** The item a node opens, for its mark and hover card. */
  const dependencyNodeItem = (id: string): LayoutItem | undefined => {
    const target = dependencyNodeScope(id);
    const loaded = root();
    if (target?.kind !== "value" || target.path.length || !loaded) return undefined;
    return findLocusItem(target.rootItem ? loaded.items : loaded.lists.find(row => row.id === target.viewId)?.view.items ?? [], target.itemId);
  };
  /** The context menu's Dependencies item: this lens moves to the item and
   * shows its Dependencies panel (decision 8: no separate dialog). */
  function showDependenciesOf(item: LayoutItem) {
    if (!dataInspectionPanelVisible(lensMode(), "dependencies")) setLensMode(toggleDataInspectionPanel(lensMode(), "dependencies"));
    const here = scope();
    if (here.kind === "value" && here.itemId === item.id && !here.path.length) return;
    const target = enterScopeFor(item);
    if (target) navigateScope(target);
  }
  // A click moves this lens; the panel stays open and draws the new focus.
  const dependencyGraphHost: DependencyGraphHost = {
    canOpen: id => dependencyNodeScope(id) !== undefined,
    open: id => { const next = dependencyNodeScope(id); if (next) navigateScope(next); },
    // The card's own type mark: the icon a data card of that type shows.
    caption: (id, label, open) => <DependencyNodeCaption label={label} type={dependencyNodeType(id)} onOpen={open} />,
    // Only a value this page already evaluated is previewed: nothing runs for a hover.
    preview: id => {
      const item = dependencyNodeItem(id);
      const rendered = item && homeData.evaluated(item);
      return item && rendered ? <EvaluatedFlowItemView item={{ id: "$preview", caption: item.caption, valueType: homeData.type(item) }}
        savedExprById={new Map()} evaluated={{ value: rendered.value }} onRemove={() => {}} preview /> : undefined;
    },
  };

  function captureContainedOccurrence(parent: LayoutItem, child: ContainedValuePreview, evaluated?: RenderedCardValue): MenuOccurrence {
    const epoch = sessionEpoch();
    const ticket = rootSourceTicket();
    const revision = root()?.revision;
    const rendered = evaluated ?? homeData.evaluated(parent);
    const linked = parent.source?.kind === "ref" ? parent.source.ref.id : undefined;
    const source: ExprNode | undefined = linked ? { kind: "ref", savedExprId: linked }
      : rendered?.source ?? resolveExpr(parent, savedExprById()) ?? undefined;
    const path = [...(rendered?.sourcePath ?? []), ...child.path];
    const authored = source ? projectAuthoredExpression(source, path, expressionEditOptions()) : { source: undefined, sourcePath: path };
    const item: LayoutItem = { id: `$inspect:${parent.id}:${scopeKey({ kind: "value", viewId: "", itemId: "", path: child.path })}`,
      ...displayNameItemFields(child.caption), valueType: child.getType(), source: authored.source ? { kind: "expr", expr: authored.source } : undefined };
    const current = () => epoch === sessionEpoch()
      && ticket === rootSourceTicket() && revision === root()?.revision;
    const focus = scope();
    const focusIdentity = scopeKey(focus);
    const focused = focus.kind === "value" && !props.pane?.subject?.() && !valueScopeLoading()
      ? valueScope() : undefined;
    const navigationSource = props.pane && workspaceSourceKey(props.pane.source());
    const relativePath = [...child.path];
    // The selected occurrence's temporary id is provenance, not an address.
    // Enter its actual parent through the same owner as an ordinary card.
    const destination = parent.id === "$self" && focus.kind === "value" ? focus : enterScopeFor(parent, rendered);
    const openContained = destination?.kind === "value" && rendered !== undefined && relativePath.length > 0
      && (focus.kind !== "value" || focused?.ok)
      && (parent.id !== "$self" || focused?.ok && rendered.value === focused.container) ? (mode?: DataInspectionMode) => {
        if (!current() || client.signal?.aborted || scopeKey(scope()) !== focusIdentity || props.pane?.subject?.() || valueScopeLoading()
          || navigationSource !== (props.pane && workspaceSourceKey(props.pane.source()))) return;
        if (focused?.ok) {
          const latest = valueScope();
          if (!latest?.ok || latest.container !== focused.container || latest.sourceTicket !== focused.sourceTicket
            || latest.rootRevision !== focused.rootRevision) return;
        }
        if (mode) setLensMode(mode);
        navigateScope({ ...destination, path: [...destination.path, ...relativePath] });
      } : undefined;
    return { item, evaluated: { value: child.value, ...authored }, contained: true, current, openContained };
  }
  function openContainedMenu(event: MouseEvent, parent: LayoutItem, child: ContainedValuePreview, evaluated?: RenderedCardValue) {
    if (!ownsLocusContextMenu(event)) return;
    openContextMenu(event, captureContainedOccurrence(parent, child, evaluated));
  }

  // A finger cannot right-click. On a touch or pen surface a tap on the view's
  // own background opens the same menu, and a long press on a card opens it
  // over that card; a press on a control does neither.
  const tapMenu = createLocusTapMenu(openContextMenu);

  const [quickValue, setQuickValue] = createSignal<{
    typeName: string; shape: QuickValueShape; x: number; y: number; hint?: PlacementHint; epoch: number;
  }>();
  createEffect(() => sessionEpoch(), () => setQuickValue(undefined));

  function openComposerAt(typeName: string, hint?: PlacementHint, cardAnchor?: CreationCardAnchor) {
    setComposeCardAnchor(cardAnchor);
    setComposePlacement(hint);
    setComposeExpression(false);
    setComposePresetType(typeName);
    setComposePresetExpr(null);
    setComposePresetReps(null);
    setComposing(true);
  }

  /** "New beside -> Type" from a menu: the small type card where you clicked. */
  function openTypeDraftAt(menu: MenuTarget) {
    if (!menuIsCurrent(menu) || editingDraftOpen()) return;
    setTypeDraftAnchor({ x: menu.x, y: menu.y, hint: menu.hint, epoch: sessionEpoch() });
    setTypeComposing(true);
  }

  function creationMenuIsCurrent(menu: MenuTarget): boolean {
    return menuIsCurrent(menu) && scopeKey(scope()) === scopeKey(menu.focus)
      && (!props.pane || menu.source === workspaceSourceKey(props.pane.source()));
  }
  function creationCardAnchor(menu: MenuTarget): CreationCardAnchor {
    const card = menu.element?.closest("[data-locus-item]");
    const rect = card?.getBoundingClientRect();
    return { x: menu.x, y: menu.y, ...(rect ? { beside: {
      left: rect.left, top: rect.top, right: rect.right, bottom: rect.bottom,
    } } : {}) };
  }
  function creationPlacement(menu: MenuTarget): PlacementHint | undefined {
    return scope().kind === "root" && menu.item ? { afterId: menu.item.id } : menu.hint;
  }

  function openNewAt(menu: MenuTarget, typeName?: string) {
    if (!creationMenuIsCurrent(menu) || editingDraftOpen()) return;
    const placement = creationPlacement(menu);
    setComposePlacement(placement);
    if (typeName) {
      // A type you can simply TYPE gets the small card where you clicked. The
      // full-width composer is for values that need more than a value: a
      // constructor pick, a record, an expression.
      const shape = quickValueShape(typeName);
      if (shape) {
        setQuickValue({ typeName, shape, x: menu.x, y: menu.y, hint: placement, epoch: sessionEpoch() });
        return;
      }
      openComposerAt(typeName, placement, creationCardAnchor(menu));
    } else { setComposeCardAnchor(creationCardAnchor(menu)); setPicking(true); }
  }

  async function copyFromMenu(menu: MenuTarget): Promise<boolean> {
    if (!menuIsCurrent(menu)) return false;
    setCutMark(undefined);
    try {
      if (menu.transfer?.canCopy()) {
        await menu.transfer.copy();
        return true;
      }
      if (!menu.item) return false;
      const expr = resolveExpr(menu.item, savedExprById());
      if (!expr) throw new Error("This data is no longer available to copy.");
      const session = transferSession();
      const rendered = homeData.evaluated(menu.item);
      let historyNotice: string | undefined;
      if (localCopyPrefetch) {
        // B4 unit D: the copy prepared when this menu opened; nothing awaits
        // before the clipboard write. Still being prepared refuses.
        const prepared = copyPrefetchMenu() === menu ? localCopyPrefetch.answer() : undefined;
        if (!prepared) throw new Error(localCopyPrefetch.failure() ?? "This data changed. Copy again when its display is ready.");
        if (prepared.$tag === "Err") throw new Error(prepared._0);
        historyNotice = await copyTransferItem(prepared._0);
      } else {
        const evaluated = rendered ? { result: rendered.value }
          : evaluateAuthoringExpression(expr, (id) => savedExprById().get(id), session);
        historyNotice = await copyTransferItem(prepareTransferItem({
          value: cloneDraftValue(evaluated.result), type: homeData.type(menu.item),
          typeName: classifyData(evaluated.result), label: menu.item.caption, source: "fenel",
        }, session.environment, session.registry, session.evaluateContext));
      }
      if (menuIsCurrent(menu)) setImportNotice(historyNotice ?? "Copied.");
      return true;
    } catch (error) {
      if (menuIsCurrent(menu)) setToolbarError(error instanceof Error ? error.message : "Could not copy this data.");
      return false;
    }
  }

  async function pasteFromMenu(menu: MenuTarget, asNewItem = false) {
    if (!menuIsCurrent(menu)) return;
    clipboardRead?.abort();
    const controller = new AbortController();
    clipboardRead = controller;
    setReadingClipboard(true);
    setToolbarError(null);
    // Clipboard permission can keep this read pending while a tab, saved value,
    // or nested field changes. Capture the destination before that await.
    const destination = !asNewItem && menu.transfer && menu.item
      ? findLocusItem(current()?.view.items ?? [], menu.item.id) : undefined;
    const source = destination ? resolveExpr(destination, savedExprById()) : undefined;
    const revision = destination ? homeData.revision(destination) : undefined;
    const destinationType = destination?.valueType;
    try {
      const captured = await readClipboardTransfer(controller.signal);
      controller.signal.throwIfAborted();
      if (!menuIsCurrent(menu)) return;
      if (!asNewItem && menu.transfer) {
        const latest = destination ? findLocusItem(current()?.view.items ?? [], destination.id) : undefined;
        if (!menu.element?.isConnected || transferCommandsFor(menu.element) !== menu.transfer || !menu.transfer.canPaste()) {
          throw new Error("This paste destination changed. Right-click its current data and paste again.");
        }
        if (menu.item && (!latest
          || menu.element.closest<HTMLElement>("[data-locus-item]")?.dataset.locusItem !== menu.item.id
          || resolveExpr(latest, savedExprById()) !== source
          || homeData.revision(latest) !== revision
          || latest.valueType !== destinationType)) {
          throw new Error("This data changed while reading the clipboard. Paste again into its current contents.");
        }
        await menu.transfer.paste(captured);
        finishCut(menu);
      } else {
        afterImport = () => finishCut(menu);
        homeData.import(captured, menu.hint);
      }
    } catch (error) {
      if (!controller.signal.aborted && menuIsCurrent(menu)) setToolbarError(error instanceof Error ? error.message : "Could not read the clipboard. Use Ctrl+V or ⌘V to paste.");
    } finally {
      if (clipboardRead === controller) { clipboardRead = undefined; setReadingClipboard(false); }
    }
  }

  function contextItems(menu: MenuTarget): LocusMenuItem[] {
    const item = menu.item;
    if (item && menu.occurrence) {
      const occurrence = menu.occurrence;
      const callable = itemFunction(item, savedExprById(), homeAuthoringSession(), occurrence.evaluated, reader);
      const open = (mode?: DataInspectionMode) => {
        if (!occurrence.current()) return;
        if (occurrence.openContained) occurrence.openContained(mode);
        else if (!occurrence.contained) {
          if (mode) openInspection(item, mode, occurrence.evaluated);
          else homeData.enter(item, occurrence.evaluated);
        }
      };
      return [
        ...locusOpenMenuItems(() => open(), undefined, open),
        { id: "lens-shortcuts", label: "Suggestions", icon: "lightbulb",
          onOpen: () => startMenuDataSuggestions(menu), children: contextDataSuggestionItems(menu) },
        ...(callable ? [{ id: "instantiate", label: "Instantiate function", icon: "play",
          onSelect: () => setCalling({ fnId: callable.id, fnName: item.caption || callable.id }) }] : []),
      ];
    }
    const into = item ? enterScopeFor(item) : undefined;
    const up = parentScope(scope());
    const liftable = item && homeData.canLift(item) ? item : undefined;
    const writable = homeData.canWrite();
    const presentationFocus = scopeKey(menu.focus);
    const presentationSource = menu.source;
    const currentItem = !!item && (item.id === "$self" || item.id === "$lens-subject" || item.id.startsWith("$lens:"));
    const selectedScope = currentItem ? scope() : into;
    const location = item && homeData.dataTarget(item);
    const presentationTarget = location ?? (selectedScope && props.pane
      ? { $tag: "ValuePresentationTarget" as const, source: props.pane.source(), focus: scopeToWorkspace(selectedScope) } : undefined);
    const summary = item && homeData.listSummary(item);
    const choices = !item || currentItem ? layoutOptions() : locusLayoutOptions({
      type: location ? undefined : item.valueType ?? summary?.type,
      value: location ? undefined : summary?.items ?? homeData.evaluated(item)?.value, canTable: !!props.pane,
    });
    function presentationIsCurrent() {
      return menuIsCurrent(menu) && scopeKey(scope()) === presentationFocus
        && (!props.pane || presentationSource === workspaceSourceKey(props.pane.source()));
    }
    function present(kind: LocusLayoutChoice, mode?: "stack" | "split" | "float") {
      if (!presentationIsCurrent()) return;
      if (item && !currentItem) {
        if (presentationTarget && props.pane?.onDataTarget) {
          if (!mode) setLensMode("data");
          props.pane.onDataTarget(presentationTarget, mode, kind);
        }
      } else if (mode && props.pane) props.pane.onOpenLens(scope(), mode, kind);
      else { setLensMode("data"); void setLayoutKind(kind); }
    }
    const demoCopy = (item ? itemDemoCopy(item.id, typeof item.caption === "string" ? item.caption : undefined) : undefined) ?? focusDemoCopy();
    return [
      ...(demoCopy ? [{ id: "edit-in-local", label: "Edit in Local", icon: "pencil" as const,
        onSelect: () => pickCreationBranch(demoCopy) }] : []),
      ...(into ? locusOpenMenuItems(() => navigateScope(into), props.pane
        ? mode => props.pane!.onOpenLens(into, mode) : undefined,
        item ? mode => openInspection(item, mode) : undefined, props.pane?.openElsewhere ? {
          open: place => location ? props.pane!.openElsewhere!(scopeFromWorkspace(location.focus), place, location.source)
            : props.pane!.openElsewhere!(into, place),
          unavailable: props.pane.openElsewhereUnavailable?.(location?.source) } : undefined) : item ? locusOpenMenuItems(
          () => homeData.enter(item), undefined, mode => openInspection(item, mode)) : []),
      ...(liftable ? [{ id: "lift", label: homeData.liftLabel(), icon: "arrow-up" as const,
        onSelect: () => homeData.lift(liftable) }] : []),
      ...(up ? [{ id: "up", label: "Go up", icon: "arrow-up" as const,
        separatorBefore: !!into, onSelect: () => navigateScope(up) }] : []),
      { id: "representation", label: "Representation", icon: "panels-top-left",
        children: [
          ...choices.map(option => ({ id: `representation:${option.value}`, label: option.label,
            icon: option.icon, checked: (!item || currentItem) && lensMode() !== "expression" && currentKind() === option.value,
            disabled: item && !currentItem ? !presentationTarget || !props.pane?.onDataTarget
              : !scopeSubject().row || !props.pane && root()?.canEdit !== true,
            onSelect: () => present(option.value),
            children: props.pane && option.value !== "derive-canvas" ? [
              { id: `representation:${option.value}:split`, label: "Beside this lens", icon: "layout-grid", onSelect: () => present(option.value, "split") },
              { id: `representation:${option.value}:stack`, label: "Over this lens", icon: "layers", onSelect: () => present(option.value, "stack") },
              { id: `representation:${option.value}:float`, label: "Floating lens", icon: "panels-top-left", onSelect: () => present(option.value, "float") },
            ] : undefined,
          })),
          { id: "representation:expression", label: "Expression", icon: "route",
            checked: (!item || currentItem) && lensMode() === "expression",
            onSelect: () => {
              if (!presentationIsCurrent()) return;
              if (item && !currentItem) openInspection(item, "expression"); else setLensMode("expression");
            } },
        ] },
      { id: "lens-shortcuts", label: "Suggestions", icon: "lightbulb",
        onOpen: () => startMenuDataSuggestions(menu),
        children: [...(!item ? props.pane?.shortcuts?.()?.map(shortcut => ({ id: `lens-shortcut-${shortcut.id}`, label: shortcut.label,
          icon: shortcut.icon, onSelect: () => props.pane!.onShortcut?.(shortcut) })) ?? [] : []), ...contextDataSuggestionItems(menu)] },
      ...(writable ? [locusNewMenu(() => openNewAt(menu), (typeName) => openNewAt(menu, typeName),
        { beside: !!item, onBranch: (branch) => branch === "new:type" ? openTypeDraftAt(menu) : pickCreationBranch(branch) })] : []),
      { id: "code", label: codeItemId() === item?.id ? "Show data" : "Show Fenel code", icon: "code",
        disabled: !item, separatorBefore: true, onSelect: () => item && setCodeItemId((current) => current === item.id ? undefined : item.id) },
      ...(() => {
        const typeRef = item && writable ? itemTypeReference(item, savedExprById(), homeAuthoringSession(), homeData.evaluated(item), reader) : undefined;
        if (!item || !typeRef) return [];
        // The type's presented name ("Transaction"), never its identity handle.
        const handle = /^[0-9a-f]{8}-[0-9a-f]{4}-/i;
        const presentation = (id: string) => locale(reader ? reader.presentation(id)?.label
          ?? reader.representation("Labelable", id)?.label as Parameters<typeof locale>[0] : getLabel(id))
          || (reader ? reader.presentation(id)?.codeName : undefined);
        let presented: string | undefined;
        try { presented = valueCardTypeLabel(typedReadTypeLabel({ $ref: typeRef.id }, homeAuthoringSession(), reader)); }
        catch { presented = undefined; }
        const label = [presentation(typeRef.id), presentation(`entity:${typeRef.id}`), presented,
          typeof item.caption === "string" ? item.caption.trim() : undefined, typeRef.name]
          .find(name => !!name && !handle.test(name)) ?? "data";
        return [
          { id: "type-new", label: `New ${label}`, icon: "plus" as const, onSelect: () => {
            if (creationMenuIsCurrent(menu) && !editingDraftOpen()) { setComposePlacement(creationPlacement(menu)); createModalCtx.instantiateType(typeRef.id, creationCardAnchor(menu)); }
          } },
          // Demo 1 (Rom, Nov 8): an action whose result is the type's data as
          // one live list, a new card after this one. Where the root publishes
          // no such list (an account root), the type's own dialog lists them.
          { id: "type-see-all", label: `See all ${label}`, icon: "list" as const, onSelect: () => {
            if (!menuIsCurrent(menu)) return;
            const reference = typeInstancesReference(typeRef.id);
            if (reference) void seeAllOfType(item, reference, label);
            else if (menu.viewId) openItemEditor({ item, homeId: menu.viewId, rootRevision: root()?.revision });
          } },
        ];
      })(),
      ...(item && itemFunction(item, savedExprById(), homeAuthoringSession(), homeData.evaluated(item), reader)
        ? [{ id: "call", label: "Instantiate function", icon: "play" as const, onSelect: () => {
          const fn = itemFunction(item, savedExprById(), homeAuthoringSession(), homeData.evaluated(item), reader);
          if (fn) setCalling({ fnId: fn.id, fnName: item.caption || fn.id });
        } }] : []),
      { id: "copy", label: "Copy", icon: "copy", shortcut: "Ctrl+C / ⌘C", separatorBefore: true,
        disabled: menu.transfer ? !menu.transfer.canCopy() : !item, onSelect: () => { void copyFromMenu(menu); } },
      { id: "cut", label: "Cut", icon: "share-2", disabled: !writable || !item,
        onSelect: () => { void copyFromMenu(menu).then((copied) => { if (copied && menuIsCurrent(menu) && item) setCutMark({ itemId: item.id }); }); } },
      { id: "paste", label: "Paste", icon: "clipboard", shortcut: "Ctrl+V / ⌘V",
        disabled: !writable || readingClipboard() || !!menu.transfer && !menu.transfer.canPaste(), onSelect: () => { void pasteFromMenu(menu); } },
      ...(menu.transfer ? [{ id: "paste-new", label: "Paste as new item", icon: "clipboard" as const, disabled: readingClipboard(),
        onSelect: () => { void pasteFromMenu(menu, true); } }] : []),
      ...(item && writable ? [
        { id: "move", label: "Move…", icon: "folder-tree" as const, separatorBefore: true,
          onSelect: () => { if (menuIsCurrent(menu)) setMoving(item); } },
        ...(homeData.listSummary(item) ? [] : [{ id: "edit", label: "Edit…", icon: "pencil" as const, onSelect: () => {
          if (menuIsCurrent(menu) && menu.viewId) openItemEditor({ item, homeId: menu.viewId, rootRevision: root()?.revision });
        } }]),
        { id: "duplicate", label: "Duplicate…", icon: "layers" as const, onSelect: () => {
          if (menuIsCurrent(menu) && !editingDraftOpen()) { setComposePlacement(menu.hint); createModalCtx.duplicateItem(item); }
        } },
        // The lens panel is the one Dependencies outlet: focus the item, show the panel.
        { id: "graph", label: "Dependencies", icon: "git-branch" as const, onSelect: () => { if (menuIsCurrent(menu)) showDependenciesOf(item); } },
        { id: "remove", label: "Remove from list", icon: "trash" as const, danger: true, onSelect: () => {
          const row = current();
            if (menuIsCurrent(menu) && row && homeData.canWrite()) {
              const subject = scopeSubject();
              if (subject.row) subject.persist(removeLocusItem(subject.row.view, item.id));
            }
        } },
      ] : []),
      { id: "browse", label: "Browse or search…", icon: "search", separatorBefore: true,
        onSelect: () => setDrawerOpen(true) },
    ];
  }

  let acceptedShellAction = false;
  createEffect(() => ({ root: root(), saved: savedAll() }), (ready) => {
    if (props.publicData || acceptedShellAction || !ready.root || ready.saved.failed) return;
    acceptedShellAction = true;
    if (initialAction === "new:showcase-demo") void createLinkedDemo("showcase");
    if (initialAction === "new:recipe-demo") void createLinkedDemo("recipe");
    const local = reader?.kind === "local";
    const localRoot = local && scope().kind === "root";
    const captures = local ? peekWorkspaceTransfers(transferOwner, localRoot ? { resumeInitialLocalRoot: true } : undefined)
      : takeWorkspaceTransfers(transferOwner);
    for (const entry of captures) {
      const here = scope();
      if (local && here.kind === "value" && entry.viewId === here.viewId) {
        void importIntoValueScope(entry.snapshot, entry.ticket);
      } else importIntoView(entry.snapshot, entry.viewId ?? ready.root.id, entry.point, local ? entry.ticket : undefined);
    }
    // The early Browse arrow uses the same editor and captures its current
    // source ticket/query here, after this reader's root and saved rows settle.
    if (initialSavedOpen) openSavedItemEditor(initialSavedOpen.savedExprId, initialSavedOpen.caption);
    // A row the user picked in the shell's drawer, before this workspace
    // existed. Applying it here is what makes that click mean something
    // instead of being swallowed by the wait.
    if (initialPin) {
      if (initialPin.savedExprId) {
        void homeData.add({ savedExprId: initialPin.savedExprId }, initialPin.caption);
      } else if (initialPin.pin) {
        const expr = catalogReferenceExpr({ kind: initialPin.pin.kind, id: initialPin.pin.routeId });
        void homeData.add({ expr }, initialPin.caption);
      }
    }
  });
  onSettled(() => {
    const paste = (event: ClipboardEvent) => {
      if (props.pane && !props.pane.active()) return;
      if (accountSelectionPending()) return;
      if (event.defaultPrevented || isNativeEditingTarget(event.target) || !isDataTransfer(event.clipboardData)) return;
      if (event.target instanceof Element && event.target.closest("[data-fenel-transfer-target], .modal-overlay")) return;
      if (document.querySelector(".modal-overlay")) return;
      event.preventDefault();
      homeData.import(captureDataTransfer(event.clipboardData!));
    };
    document.addEventListener("paste", paste);
    return () => document.removeEventListener("paste", paste);
  });

  async function onDropPin(e: DragEvent) {
    if (accountSelectionPending()) return;
    if (e.defaultPrevented || isNativeEditingTarget(e.target)) return;
    if (isDataTransfer(e.dataTransfer)) {
      e.preventDefault();
      e.stopPropagation();
      setDropOver(false);
      const rect = stage?.getBoundingClientRect();
      const date = e.target instanceof Element ? e.target.closest<HTMLElement>("[data-home-date]")?.dataset.homeDate : undefined;
      const parentId = e.target instanceof Element ? e.target.closest<HTMLElement>("[data-home-parent]")?.dataset.homeParent : undefined;
      homeData.import(captureDataTransfer(e.dataTransfer!),
        parentId ? { parentId } : date ? { date }
          : rect ? { x: (e.clientX - rect.left) / rect.width, y: (e.clientY - rect.top) / rect.height } : undefined);
      return;
    }
    e.preventDefault();
    const id = e.dataTransfer?.getData("application/x-fenel-savedexpr-id");
    const name = e.dataTransfer?.getData("application/x-fenel-savedexpr-name");
    if (id) {
      const ok = await homeData.add({ savedExprId: id }, name || undefined);
      if (ok) void revalidate(["locusViews", "activeLocusView"]);
      return;
    }
    // Catalog item drop — the drawer ships the catalog address as
    // application/x-fenel-pin. Only a reference is accepted: other JSON on
    // that channel is not a value the user chose, so it is not stored.
    const pinJson = e.dataTransfer?.getData("application/x-fenel-pin");
    if (pinJson) {
      const caption =
        e.dataTransfer?.getData("application/x-fenel-pin-caption") || undefined;
      let reference: LocusCatalogReference | undefined;
      try { reference = readLocusCatalogReference(JSON.parse(pinJson)); } catch { reference = undefined; }
      if (!reference) return;
      const expr: ExprNode = reference.kind === undefined
        ? { kind: "literal", value: locusCatalogReference(reference.id) }
        : catalogReferenceExpr({ kind: reference.kind, id: reference.id, name: reference.name });
      await homeData.add({ expr }, caption);
    }
  }
  function onDragOverPin(e: DragEvent) {
    if (e.defaultPrevented || isNativeEditingTarget(e.target)) return;
    const dt = e.dataTransfer;
    if (!dt) return;
    if (isDataTransfer(dt)) {
      e.preventDefault();
      dt.dropEffect = "copy";
      setDropOver(true);
      return;
    }
    const types = dt.types;
    if (
      !types.includes("application/x-fenel-savedexpr-id")
      && !types.includes("application/x-fenel-pin")
    ) return;
    e.preventDefault();
    dt.dropEffect = "copy";
  }

  async function retryHomeData() {
    if (retryingData()) return;
    setRetryingData(true);
    try {
      if (await reader?.retryPresentation?.() === false) return false;
      revalidate(["locusRoot", "locusViews", "activeLocusView", "savedQueries"]);
      await Promise.all([refresh(all), refresh(savedAll)]);
      return true;
    } finally {
      setRetryingData(false);
    }
  }

  function retryExpressionData(reset: () => void) {
    const epoch = sessionEpoch(), here = scopeKey(scope()), revision = root()?.revision, ticket = rootSourceTicket();
    void retryHomeData().then(retried => {
      if (!retried || epoch !== sessionEpoch() || client.signal?.aborted || here !== scopeKey(scope())
        || revision !== root()?.revision) return;
      try { assertSourceTicket(ticket); } catch { return; }
      reset();
    }, () => {});
  }
  async function activateHome(id: string) {
    try {
      await api.locusViewActivate(id);
      void revalidate(["locusViews", "activeLocusView"]);
    } catch {/* ignore */}
  }

  async function newHome() {
    const result = await promptDialog({
      message: "Name this list:",
      defaultValue: "Untitled",
      confirmLabel: "Create",
    });
    const name = typeof result === "string" ? result.trim() : null;
    if (!name) return;
    try {
      const created = await api.locusViewCreate({ name, view: { kind: "canvas", items: [] }, active: true });
      void revalidate(["locusViews", "activeLocusView"]);
      // You made it to put something in it. Go in.
      const id = ((created as any)?.locusView as LocusViewRow | undefined)?.id;
      if (id) navigateScope({ kind: "view", viewId: id });
    } catch {/* ignore */}
  }

  async function duplicateHome() {
    const c = current();
    if (!c) return;
    const result = await promptDialog({
      message: "Name the copy:",
      defaultValue: `${c.name} copy`,
      confirmLabel: "Duplicate",
    });
    const name = typeof result === "string" ? result.trim() : null;
    if (!name) return;
    try {
      // Flush first: a copy of a view with unsaved edits should carry them.
      if (!await viewPersistence.flush(c.id)) return;
      const accountId = root()?.id;
      // Creating a set moves the root revision too: acknowledge it, and
      // refresh the root rather than only the list queries.
      await enqueueRootWrite(async () => {
        const created = await api.locusViewCreate({ name, view: asView(c.view), active: true });
        if (accountId) acknowledgeRootRevision(accountId, (created as { locusView?: { rootRevision?: number } })?.locusView?.rootRevision, created);
      });
      revalidate(["locusRoot", "locusViews", "activeLocusView"]);
      await refresh(all);
    } catch (e: any) {
      setToolbarError(`Could not duplicate this list: ${e?.message ?? String(e)}`);
    }
  }

  async function renameHome() {
    const c = current();
    if (!c) return;
    const result = await promptDialog({
      message: "Rename list:",
      defaultValue: c.name,
      confirmLabel: "Rename",
    });
    const next = typeof result === "string" ? result.trim() : null;
    if (!next || next === c.name) return;
    try {
      await writeLocusList(c.id, { name: next });
      revalidate(["locusRoot", "locusViews", "activeLocusView"]);
      await refresh(all);
    } catch (error) {
      setToolbarError(`Could not rename this data: ${error instanceof Error ? error.message : String(error)}`);
    }
  }

  const [localCodePresentation, setLocalCodePresentation] = createSignal<{ account: string; scope: string }>();
  async function setLayoutKind(kind: LocusLayoutChoice) {
    if (!layoutOptions().some((option) => option.value === kind)) return;
    if (props.pane && kind !== "derive-canvas") { props.pane.onPresentation(kind); return; }
    if (kind === "code") { setLocalCodePresentation({ account: accountKey(), scope: scopeKey(scope()) }); return; }
    setLocalCodePresentation(undefined);
    if (root()?.canEdit !== true) return;
    if (kind === "derive-canvas") { await createCanvas(); return; }
    if (kind === "value" || kind === "desktop") return;
    // A scope with no row of its own keeps its layout with its arrangement.
    const here = scope();
    if (here.kind === "root") {
      if (kind === "grid" || kind === "list" || kind === "tree" || kind === "tabs") {
        try { await changeRoot({ kind: "layout", layout: { kind } }); }
        catch (error) { setToolbarError(error instanceof Error ? error.message : String(error)); }
      }
      return;
    }
    if (here.kind !== "view") {
      const derived = scopeSubject().row;
      if (!derived) return;
      rememberArrangement(arrange(derived.view.items, { kind, places: {} }));
      return;
    }
    const c = current();
    if (!c) return;
    const view = asView(c.view);
    const next: AnyView = kind === "grid"
      ? { kind: "grid", cols: 4, items: view.items }
      : kind === "list"
        ? { kind: "list", items: view.items }
        : kind === "table"
        ? { kind: "table", items: view.items }
        : kind === "tree"
          ? { kind: "tree", items: view.items as TreeItem[] }
          : kind === "tabs"
            ? { kind: "tabs", items: view.items }
            : kind === "calendar"
              ? { kind: "calendar", items: view.items }
              : kind === "timeline"
                ? { kind: "timeline", items: view.items }
                : kind === "map"
                  ? { kind: "map", items: view.items }
                  : { kind: "canvas", items: view.items };
    try {
      viewPersistence.update(c.id, next);
      await viewPersistence.flush(c.id);
      setToolbarError(null);
    } catch (e: any) {
      setToolbarError(`Layout change failed: ${e?.message ?? String(e)}`);
    }
  }

  async function setListAxis(axis: "horizontal" | "vertical") {
    if (currentKind() !== "list") return;
    const stored = axis === "horizontal" ? "horizontal" as const : undefined;
    const here = scope();
    if (here.kind === "root") {
      if (!props.pane && root()?.canEdit !== true) return;
      try { await changeRoot({ kind: "layout", layout: stored ? { kind: "list", axis: stored } : { kind: "list" } }); }
      catch (error) { setToolbarError(error instanceof Error ? error.message : String(error)); }
      return;
    }
    const apply = (view: AnyView): ListView => {
      const items = "items" in view ? view.items : [];
      return { kind: "list", items, ...(stored ? { axis: stored } : {}) };
    };
    if (here.kind !== "view") {
      const derived = scopeSubject().row;
      if (derived) rememberArrangement(apply(asView(derived.view)));
      return;
    }
    const c = current();
    if (!c) return;
    try {
      viewPersistence.update(c.id, apply(asView(c.view)));
      await viewPersistence.flush(c.id);
      setToolbarError(null);
    } catch (error) {
      setToolbarError(`Layout change failed: ${error instanceof Error ? error.message : String(error)}`);
    }
  }

  /** A list is either stacked or a sideways rail. Anything else is stacked. */
  const listAxis = (): "horizontal" | "vertical" => {
    const view = scopeSubject().row?.view;
    return view && "axis" in view && view.axis === "horizontal" ? "horizontal" : "vertical";
  };
  /** Which layout the scope you are IN is drawn with. */
  const currentKind = (): LocusLayoutChoice => {
    const selected = props.pane?.presentation();
    if (selected && layoutOptions().some(option => option.value === selected)) return selected;
    if (props.pane?.subject?.()) return Array.isArray(heldLensSubject()?.value) ? "list" : "value";
    const local = localCodePresentation();
    if (!props.pane && local?.account === accountKey() && local.scope === scopeKey(scope())) return "code";
    const state = valueScope();
    if (state?.ok && state.leaf) return "value";
    const saved = scopeSubject().row?.view.kind ?? "list";
    // Opening a saved list starts with readable flowing cards, including old
    // canvases. Its coordinates remain data: an explicit Canvas presentation
    // above still shows them, as does directly focusing a canvas derivation.
    return saved === "canvas" && (scope().kind === "view"
      || !layoutOptions().some(option => option.value === "canvas")) ? "list" : saved;
  };
  // The current authorized transport already declares direct items and record
  // fields. Keep those facts while their parent expression prepares; following
  // references, list indices or computed shapes still belongs to valueScope.
  function admittedFocusedType(): FenelType | undefined {
    const here = scope();
    if (here.kind !== "value" || client.signal?.aborted) return undefined;
    try {
      assertCurrentSession(client.epoch ?? sessionEpoch());
      assertSourceTicket(rootSourceTicket());
    } catch { return undefined; }
    draftRevision();
    const row = rowById(here.viewId);
    if (!row) return undefined;
    const view = viewPersistence.read(row.id, asView(row.view));
    let type = findLocusItem(view.items, here.itemId)?.valueType;
    for (const step of here.path) {
      if (typeof step !== "string" || !type || !("$record" in type)) return undefined;
      type = type.$record.fields.find(field => field.name === step)?.type;
    }
    return type;
  }
  const focusedType = () => {
    if (heldLensSubject()) return heldLensSubject()!.type;
    const state = valueScope();
    const here = scope();
    if (state?.ok) return state.containerType;
    if (here.kind === "value") return state ? undefined : admittedFocusedType();
    return here.kind === "view"
      ? root()?.lists.find((row) => row.id === here.viewId)?.valueType ?? List(Anything) : root()?.type;
  };
  let suggestionTarget: LayoutItem | undefined;
  let suggestionOccurrence: MenuOccurrence | undefined;
  function selectedSuggestionData(target?: LayoutItem, occurrence?: MenuOccurrence) {
    if (occurrence && (occurrence.item !== target || !occurrence.current())) throw new Error("This data changed. Open Suggestions again.");
    const selected = target ? { item: target, evaluated: occurrence?.evaluated ?? homeData.evaluated(target) } : lensExpressionSubject();
    if (!selected) throw new Error("Wait for this data's source to become available.");
    const sourcePath = selected.evaluated?.sourcePath;
    const linked = selected.item.source?.kind === "ref" ? selected.item.source.ref.id : undefined;
    // Focused discovery reads this session's current expression. The same
    // worker still plans/admit actions; no stale saved-value hint accompanies
    // a private draft. New-data references keep their existing source owner.
    const controller = !target && scope().kind === "value" ? focusedExpressionController() : undefined;
    if (controller?.sourceReadPending() || controller?.state.sourceError()) throw new Error("Finish the current code edit to use Suggestions.");
    const privateDraft = !!controller && !controller.fn() && controller.dirty();
    const own: ExprNode | undefined = privateDraft ? controller!.draft()
      : selected.evaluated?.source ?? resolveExpr(selected.item, savedExprById()) ?? undefined;
    const expression: ExprNode | undefined = own ?? (linked ? { kind: "ref", savedExprId: linked } : undefined);
    const type = target ? sourcePath?.length ? selected.item.valueType : homeData.type(target) : focusedType();
    if (!expression || (!type && !sourcePath?.length)) throw new Error("This data's expression or type is unresolved.");
    // Demo 1: new data reads a whole card (or saved value) through its own
    // reference, so it follows the card's edits. Only in an editable root, where
    // the new data lands at the root (review B1, B2); a contained or computed
    // child stays an authored copy, and so does a read-only source.
    const here = scope();
    const state = valueScope();
    const data = root();
    const whole = !occurrence?.contained && !sourcePath?.length;
    const focused = !target && selected.item.id === "$self" && here.kind === "value" && state?.ok === true && !state.followedReference;
    const cardId = !whole || data?.canEdit !== true ? undefined : target ? target.id
      : focused && here.path.length === 0 && here.rootItem && here.viewId === data.id ? here.itemId : undefined;
    const reference: ExprNode | undefined = !whole || data?.canEdit !== true ? undefined
      : linked ? { kind: "ref", savedExprId: linked } : cardId !== undefined ? cardReferenceExpression(cardId) : undefined;
    // Apply here only rewrites the scope's own authored value or a whole root
    // card at the root (review B5); any other subject makes new data.
    const inPlace = data?.canEdit === true && whole && (target ? here.kind === "root" && data.items.some(item => item.id === target.id)
      : focused && !controller?.fn());
    const dispositions: readonly SuggestionDisposition[] = inPlace ? ["CreateDerivedData", "ApplyToDraft"] : ["CreateDerivedData"];
    return { expression, type, ...(sourcePath ? { sourcePath } : {}),
      ...(!privateDraft && selected.evaluated ? { value: selected.evaluated.value } : {}),
      ...(reference ? { reference } : {}), dispositions };
  }
  /** A card's own reference in the current editable root (`<root reference>:<card id>`,
   * account and Local roots alike), when the root publishes it. */
  function cardReferenceExpression(itemId: string): ExprNode | undefined {
    const data = root();
    const id = data && data.canEdit === true ? `${data.referenceId}:${itemId}` : undefined;
    return id && data?.expressions?.[id] ? { kind: "ref", savedExprId: id } : undefined;
  }
  function suggestionSourceForTarget(getTarget: () => LayoutItem | undefined,
    getOccurrence?: () => MenuOccurrence | undefined): Extract<DataOccurrenceSource, { state: "source" }> {
    return { state: "source", capture: () => {
    if (client.signal?.aborted) throw new Error("This data's source is closed. Open Suggestions again.");
    const session = homeAuthoringSession();
    const epoch = sessionEpoch();
    const readerRevision = reader?.revision();
    const rootRevision = root()?.revision;
    const sourceTicket = rootSourceTicket();
    const focus = draftValueFingerprint(scope());
    const source = props.pane && workspaceSourceKey(props.pane.source());
    const target = getTarget();
    const occurrence = getOccurrence?.();
    const selection = selectedSuggestionData(target, occurrence);
    const { dispositions, ...selected } = selection;
    const fingerprint = draftValueFingerprint(selection);
    const savedExpressions = [...savedExprById()] as const;
    const savedFingerprint = draftValueFingerprint(savedExpressions);
    const revision = `${epoch}:${readerRevision ?? ""}:${rootRevision ?? ""}:${focus}:${fingerprint}:${savedFingerprint}`;
    const input: DataSuggestionInput = { ...selected, savedExpressions, revision,
      sourceType: selected.sourcePath?.length ? undefined : selected.type };
    return { session, input, dispositions, current: () => {
      try {
        return !client.signal?.aborted && getTarget() === target && getOccurrence?.() === occurrence && epoch === sessionEpoch() && readerRevision === reader?.revision() && session === homeAuthoringSession()
          && rootRevision === root()?.revision && sourceTicket === rootSourceTicket() && focus === draftValueFingerprint(scope())
          && source === (props.pane && workspaceSourceKey(props.pane.source()))
          && fingerprint === draftValueFingerprint(selectedSuggestionData(target, occurrence)) && savedFingerprint === draftValueFingerprint([...savedExprById()]);
      } catch { return false; }
    }, select: (node, suggestion, options) => options?.disposition
      ? createModalCtx.applySuggestion(node, suggestion, options.disposition, target)
      : createModalCtx.composeSuggestion(node, options),
      reportIssue: message => setToolbarError(message) };
    } };
  }
  const dataOccurrence = suggestionSourceForTarget(() => suggestionTarget, () => suggestionOccurrence);
  let activeSuggestionIntent: MenuSuggestionIntent | undefined;
  const dataSuggestions = createDataInspectionSuggestions(() => {
    const intent = activeSuggestionIntent;
    if (!intent) throw new Error("Open Suggestions again.");
    if (!intent.captured.ok) throw intent.captured.error;
    const held = intent.captured;
    if (!held.source.current()) throw new Error("This data changed. Open Suggestions again.");
    // Keep each owner read fresh (including More/reopen source identities),
    // but never turn an old menu into permission to capture a new subject.
    const captured = captureDataOccurrence(dataOccurrence);
    if (!captured.current() || captured.session !== held.session || captured.input.revision !== held.revision
      || draftValueFingerprint(captured.input) !== held.inputFingerprint) {
      throw new Error("This data changed. Open Suggestions again.");
    }
    if (!held.source.current()) throw new Error("This data changed. Open Suggestions again.");
    return { ...captured, current: () => held.source.current() && captured.current() };
  });
  dataOccurrence.suggestions = dataSuggestions;
  function captureDataSuggestionsFor(item?: LayoutItem, occurrence?: MenuOccurrence): MenuSuggestionIntent {
    suggestionTarget = item; suggestionOccurrence = occurrence;
    setStartedSuggestionMenu(undefined);
    try {
      const source = captureDataOccurrence(dataOccurrence);
      return { captured: { ok: true, source, session: source.session, revision: source.input.revision,
        inputFingerprint: draftValueFingerprint(source.input) }, requested: false };
    }
    catch (error) { return { captured: { ok: false, error }, requested: false }; }
  }
  const unrequestedDataSuggestions: readonly LocusMenuItem[] = [
    { id: "data-suggestions-pending", label: "Checking suggestions…", icon: "loader-circle", disabled: true },
  ];
  function contextDataSuggestionItems(menu: MenuTarget): readonly LocusMenuItem[] {
    // An unopened menu cannot expose another target's retained result rows.
    return startedSuggestionMenu() === menu ? dataSuggestions.items() : unrequestedDataSuggestions;
  }
  function startMenuDataSuggestions(menu: MenuTarget): void {
    if (contextMenu() !== menu || !menuIsCurrent(menu)) return;
    const intent = menu.suggestionIntent;
    if (!intent || intent.requested) return;
    // Solid writes commit later. Keep exactly-once start synchronous even if
    // pointer and keyboard events request this submenu before that commit.
    intent.requested = true;
    activeSuggestionIntent = intent;
    setStartedSuggestionMenu(menu);
    dataSuggestions.open();
  }
  function openDataSuggestionsFor(item?: LayoutItem, occurrence?: MenuOccurrence) {
    const intent = captureDataSuggestionsFor(item, occurrence);
    intent.requested = true; activeSuggestionIntent = intent;
    dataSuggestions.open();
  }
  const lensOccurrence = suggestionSourceForTarget(() => undefined);
  const lensSuggestions = createDataInspectionSuggestions(() => captureDataOccurrence(lensOccurrence));
  lensOccurrence.suggestions = lensSuggestions;
  onSettled(() => props.pane?.registerSuggestions?.(lensSuggestions));
  createEffect(() => ({ epoch: sessionEpoch(), revision: reader?.revision(), root: root()?.revision,
    focus: draftValueFingerprint(scope()), source: props.pane && workspaceSourceKey(props.pane.source()),
    inspection: draftValueFingerprint([focusedExpressionState().draft(), focusedExpressionState().savedDraft(),
      focusedExpressionState().sourceReadPending(), focusedExpressionState().sourceError()]) }), () => {
      dataSuggestions.invalidate(); lensSuggestions.invalidate();
    });
  let initialSuggestionsConsumed = false;
  createEffect(() => initialSuggestions ? { root: root(), row: initialSuggestions.producer ? undefined : scopeSubject().row, focus: scope(), epoch: sessionEpoch(),
    source: props.pane ? workspaceSourceKey(props.pane.source()) : "public",
    subject: !initialSuggestions.producer && !initialSuggestions.itemId && initialSuggestions.scope.kind === "value" ? lensExpressionSubject() : undefined } : undefined, state => {
    if (!initialSuggestions || initialSuggestionsConsumed || !state?.root || !initialSuggestions.producer && !state.row) return;
    const parent: LayoutItem | undefined = initialSuggestions.producer ? { id: "$suggest-source", valueType: initialSuggestions.producerType,
      source: { kind: "expr", expr: initialSuggestions.producer } }
      : initialSuggestions.itemId && state.row ? findLocusItem(state.row.view.items, initialSuggestions.itemId) : undefined;
    if (initialSuggestions.epoch !== state.epoch || initialSuggestions.source !== state.source
      || draftValueFingerprint(initialSuggestions.scope) !== draftValueFingerprint(state.focus) || state.root.id !== initialSuggestions.rootId
      || state.root.revision !== initialSuggestions.revision || initialSuggestions.itemId && !parent) {
      initialSuggestionsConsumed = true; setToolbarError("This data changed. Open Suggestions again."); return;
    }
    if (!initialSuggestions.producer && !initialSuggestions.itemId && initialSuggestions.scope.kind === "value" && !state.subject) return;
    initialSuggestionsConsumed = true;
    const subject = state.subject ?? (!parent && initialSuggestions.selection ? lensExpressionSubject() : undefined);
    const selection = initialSuggestions.selection;
    const occurrence = selection && (parent ?? subject?.item) ? captureContainedOccurrence(parent ?? subject!.item, {
      value: selection.value, label: selection.caption ?? "Data", caption: selection.caption, path: selection.path,
      getType: () => selection.type,
    }, subject?.evaluated) : undefined;
    const item = occurrence?.item ?? parent;
    if (selection && !occurrence) { setToolbarError("This data changed. Open Suggestions again."); return; }
    if (item) openDataSuggestionsFor(item, occurrence); else lensSuggestions.open();
    setContextMenu({ ...initialSuggestions.position, epoch: state.epoch, viewId: current()?.id,
      focus: state.focus, source: props.pane ? state.source : undefined, item, element: null, suggestions: true,
      ...(!item ? { suggestionsLens: true } : {}), ...(occurrence ? { occurrence } : {}) });
  });
  const canvasSourceReference = () => {
    const here = scope();
    const data = root();
    if (!data || data.canEdit !== true || here.kind === "root") return undefined;
    if (here.kind === "view") {
      // A data set's canvas is keyed by its entries' occurrence ids
      // (`view:placeEntries`), so removing, reordering or editing an item moves
      // no other card. A value has no such ids, and its canvas stays positional.
      const row = data.lists.find((candidate) => candidate.id === here.viewId);
      if (!row) return undefined;
      return row.entriesReferenceId ? { id: row.entriesReferenceId, keyed: true } : { id: row.referenceId, keyed: false };
    }
    const state = valueScope();
    if (!state?.ok || here.path.length !== 0 || !Array.isArray(state.container) || state.followedReference) return undefined;
    if (state.item.source?.kind === "ref") return { id: state.item.source.ref.id, keyed: false };
    return here.viewId === data.id ? { id: `${data.referenceId}:${here.itemId}`, keyed: false } : undefined;
  };
  const layoutOptions = createMemo(() => {
    const state = valueScope();
    const here = scope();
    const held = heldLensSubject();
    return locusLayoutOptions({ type: focusedType(), value: held ? held.value : state?.ok ? state.container : [],
      // Only the derivation itself is a canvas, not a list inside one item.
      derivedCanvas: state?.ok ? here.kind === "value" && here.path.length === 0 && isCanvasExpression(state.sourceExpression, canvasFunctions())
        : here.kind === "view" ? root()?.lists.find((row) => row.id === here.viewId)?.derivedCanvas : false,
      canDeriveCanvas: !!canvasSourceReference(),
      // The root's layout is stored in its `LocusRootValue`, which has no table.
      canTable: !!props.pane || here.kind !== "root",
      calendar: state?.ok === true && here.kind === "value" && here.path.length === 0 && !!state.calendarDays,
      groupingTable: state?.ok === true && here.kind === "value" && here.path.length === 0 && !!state.grouping,
      chart: state?.ok === true && here.kind === "value" && here.path.length === 0 && state.grouping?.kind === "chart" })
      .filter(option => (!!props.pane || option.value !== "desktop")
        && (!props.pane?.subject?.() || option.value === "value" || option.value === "code" || option.value === "list"));
  });
  /** The type of one element of the list this scope shows, for the table's
   *  columns: the same peel that gives each card its child type. */
  const focusedElementType = createMemo(() => {
    const state = valueScope();
    const here = scope();
    if (state?.ok && state.grouping && here.kind === "value" && here.path.length === 0) {
      let entryType = state.containerType;
      const path: LocusPathStep[] = ["_0", "entries", 0];
      for (let depth = 0; depth < path.length; depth++) entryType = childValueType(valueAt(state.container, path.slice(0, depth)), entryType, path[depth]!, transferSession());
      if (entryType) return entryType;
    }
    const type = focusedType();
    return type ? childValueType(undefined, type, 0, transferSession()) : undefined;
  });
  async function createCanvas() {
    const source = canvasSourceReference();
    if (!source) return;
    try {
      if (!await viewPersistence.flushAll()) return;
      const id = genId();
      // `view:placeAll : List a -> List (Maybe Placement) -> List (Placed a)` and
      // `view:placeEntries : List (LocusEntry a) -> List KeyedPlacement -> List (Placed a)`,
      // so the canvas's type follows from its source's, and is declared here
      // the way a pasted or new value's is. Dragging edits the placements,
      // which never changes it.
      const element = peelList((focusedType() ?? List(Anything)) as FenelType)?.elem ?? Anything;
      const item: LayoutItem = { id, caption: `${scopeLabel(scope(), scopeNames())} canvas`,
        valueType: placedListType(element),
        source: { kind: "expr", expr: source.keyed
          ? entriesCanvasExpression({ kind: "ref", savedExprId: source.id })
          : canvasExpression({ kind: "ref", savedExprId: source.id }) } };
      await changeRoot({ kind: "append", item });
      navigateScope({ kind: "value", viewId: root()!.id, itemId: id, path: [], rootItem: true });
    } catch (error) { setToolbarError(error instanceof Error ? error.message : String(error)); }
  }

  let viewOpsButton: HTMLButtonElement | undefined;
  const [viewOpsOpen, setViewOpsOpen] = createSignal<{ x: number; y: number }>();
  /** These act on the data SET you are inside. At the root you are outside
   *  every set, so the only one that means anything there is adding one. */
  const viewOpsItems = (): LocusMenuItem[] => [
    { id: "rename", label: "Rename…", icon: "pencil", disabled: !current(),
      onSelect: () => { void renameHome(); } },
    { id: "duplicate", label: "Duplicate", icon: "copy", disabled: !current(),
      onSelect: () => { void duplicateHome(); } },
    { id: "delete", label: "Delete", icon: "trash", danger: true, separatorBefore: true,
      disabled: !current(),
      onSelect: () => { const c = current(); if (c) void deleteSet(c.id); } },
  ];

  /** Everything the workspace has to SAY, collected into the bar. The locus
   *  body holds the values in the view and nothing else — a status card in
   *  that flow reads as one more item in the space. */
  // A dismissal hides one notice as it read: the same id raised again with a
  // different message (a new failure, or a save that went on to fail) shows.
  const [dismissedNotices, setDismissedNotices] = createSignal<readonly string[]>([]);
  const dismissNotice = (id: string) => {
    const notice = untrack(raisedNotices).find((candidate) => candidate.id === id);
    if (notice) setDismissedNotices([...untrack(dismissedNotices), locusNoticeKey(notice)]);
  };
  const raisedNotices = createMemo<LocusNotice[]>(() => {
    const raised: LocusNotice[] = [];
    const error = toolbarError();
    if (error && error !== rootWriteError()) raised.push({ id: "toolbar", tone: "error", message: error });
    if (rootWriteError()) raised.push({ id: "root-write", tone: "error", message: rootWriteError()!,
      retry: { label: "Reload latest", run: () => { void (async () => {
        if (!await confirmDialog({ message: "Reload the saved data?", detail: "Keep any open editing draft before continuing. The failed change was not confirmed as saved.", confirmLabel: "Reload" })) return;
        await retryHomeData();
        rootWriteFailure = undefined;
        setRootWriteError(undefined);
        setToolbarError(null);
      })(); } } });
    const scopeError = scopeSubject().error;
    if (scopeError && dataLoadErrors().length === 0) raised.push({ id: "scope", tone: "error", message: scopeError,
      ...(scope().kind === "value" ? { retry: { label: "Retry", run: () => { void valueScopeResponse.refetch(); } } } : {}) });
    for (const [index, message] of dataLoadErrors().entries()) {
      raised.push({ id: `data-${index}`, tone: "error", message,
        retry: { label: retryingData() ? "Retrying…" : "Retry", run: () => { void retryHomeData(); } } });
    }
    for (const write of pendingViewWrites()) {
      raised.push(write.error
        ? { id: `write-${write.id}`, tone: "error", message: `Data changes are unsaved: ${write.error}`,
            retry: write.blocked || write.error.includes("changed in another session")
              ? { label: "Reload latest", run: () => { void (async () => {
                  if (!await confirmDialog({ message: "Discard these unsaved changes and load the latest data?", variant: "danger", confirmLabel: "Discard and reload" })) return;
                  if (viewPersistence.discard(write.id)) await retryHomeData();
                })(); } }
              : { label: "Retry", run: () => { void viewPersistence.flush(write.id); } } }
        : { id: `write-saving-${write.id}`, tone: "info", message: temporaryEdits() ? "Applying data changes…" : "Saving data changes…" });
    }
    if (importing() > 0) raised.push({ id: "importing", tone: "info", message: "Importing data…" });
    if (rootSaving() > 0) raised.push({ id: "saving-root", tone: "info", message: temporaryEdits() ? "Updating data…" : "Saving data…" });
    if (readingClipboard()) raised.push({ id: "clipboard", tone: "info", message: "Reading the clipboard…" });
    const note = importNotice();
    if (note) raised.push({ id: "import-note", tone: "info", message: note });
    const applied = appliedNotice();
    if (applied) raised.push({ id: "applied", tone: "info", message: applied.message,
      actions: [{ label: "Undo", run: () => { void applied.undo(); } }] });
    return raised;
  });
  const notices = createMemo<LocusNotice[]>(() => {
    const hidden = dismissedNotices();
    return raisedNotices().filter((notice) => !hidden.includes(locusNoticeKey(notice)));
  });
  // A dismissed notice must be able to return when it is raised again.
  // Fix lane A (Nov 8): an effect's apply reruns whenever its compute does,
  // even for an equal key, and an in-place apply reloads the row (a new row
  // object, same id; or no row for a moment). Clear only when the owner
  // really changes, so the apply's "Applied …" notice and its Undo stay.
  let noticesOwner: string | undefined;
  createEffect(() => ({ epoch: sessionEpoch(), id: current()?.id }), next => {
    if (next.id === undefined) return;
    const owner = `${next.epoch}:${next.id}`;
    if (owner === noticesOwner) return;
    noticesOwner = owner;
    setDismissedNotices([]); setAppliedNotice(undefined); setSuggestionApplyError(undefined);
  });
  // Polish lane 2 (Nov 9): Ctrl+Z / Cmd+Z runs the same Undo as the notice
  // and the card's own Undo, in the active pane, when focus is not in a text
  // box (which keeps its native undo) and no dialog is open.
  const undoShortcut = (event: KeyboardEvent) => {
    if (props.pane && !props.pane.active()) return;
    if (!isHomeUndoShortcut(event)) return;
    const applied = appliedNotice();
    if (!applied || document.querySelector('.modal-overlay, dialog[open], [role="dialog"]')) return;
    event.preventDefault();
    void applied.undo();
  };
  document.addEventListener("keydown", undoShortcut);
  onCleanup(() => document.removeEventListener("keydown", undoShortcut));

  const editingNow = () => valueSaving() > 0 || importing() > 0 || readingClipboard() || editing() || composing()
    || typeComposing() || fnComposing() || calling() || quickValue() || shortcutDraft();
  /** Synchronous: `flushPane` would answer true at once (nothing to wait for or refuse). */
  const flushPaneIdle = () => !editingNow() && rootWritesInFlight === 0 && rootWriteFailure === undefined
    && !rootWriteError() && viewPersistence.status().length === 0;
  async function flushPane(reason?: "home-check" | "home"): Promise<boolean> {
    if (editingNow()) {
      setToolbarError("Finish the current edit before closing or changing this lens.");
      return false;
    }
    await rootWriteChain;
    if (rootWriteFailure !== undefined || rootWriteError()) return false;
    if (!await viewPersistence.flushAll()) return false;
    if (editingNow()) {
      setToolbarError("Finish the current edit before closing or changing this lens.");
      return false;
    }
    if (reason === "home") {
      setEarlyTypeInspection(undefined); setDrawerOpen(false); setPicking(false);
    }
    return true;
  }
  onSettled(() => props.pane?.registerFlush(flushPane, flushPaneIdle));
  const rootShelf = useWorkspaceRootShelf();
  onSettled(() => {
    if (!rootShelf || !props.pane) return;
    return rootShelf.register({
      paneId: props.pane.id,
      sourceKey: () => workspaceSourceKey(props.pane!.source()),
      isRoot: () => props.pane!.focus().kind === "root",
      isActive: () => props.pane!.active(),
      accountId: () => {
        const source = props.pane!.source();
        return source.$tag === "AccountSource" ? source.accountId : undefined;
      },
      canCreate: () => root()?.canEdit === true,
      creationResolved: () => !!root(),
      run: (action) => {
        if (editingDraftOpen() || picking()) return;
        if (action === "browse") setDrawerOpen(true);
        else if (action === "new:expression") {
          setComposeCheckpoint(undefined);
          if (props.pane?.source().$tag === "ThisTabSource") props.pane.onCreationDraft?.({
            focus: cloneDraftValue(scope()), action: { kind: "new:expression", expr: emptyExpressionSlot() },
          }, client);
          setComposeCardAnchor(undefined); setComposePlacement(undefined); setComposeExpression(true); setComposing(true);
        }
        else if (action === "new:function" && homeData.canAdd()) { setComposePlacement(undefined); setFnComposing(true); }
        else if (action === "new:type" && homeData.canAdd()) { setComposePlacement(undefined); setTypeComposing(true); }
        else if (action === "new:value" && homeData.canAdd()) { setComposeCardAnchor(undefined); setComposePlacement(undefined); setComposeExpression(false); setComposing(true); }
        else if (action === "new:recipe-demo") void createLinkedDemo("recipe");
        else if (action === "new:showcase-demo") void createLinkedDemo("showcase");
        else if (homeData.canAdd()) { setComposePlacement(undefined); setPicking(true); }
      },
    });
  });

  const subjectTypeName = () => refHandle(focusedType()) ?? (scope().kind === "root" ? "List" : "");
  // B4 wave 4 lane H: a Local reader's subject type handle is its worker
  // registry's `getUuid` answer (guidance class); pending is no handle.
  const localSubjectHandle = reader?.kind === "local" ? createLocalReaderAnswer(() => reader, homeAuthoringSession, () => {
    const name = subjectTypeName();
    return name ? { method: "project-reader-call-signature" as const, handles: [name], priority: "guidance" as const } : undefined;
  }, readLocalHandles) : undefined;
  createEffect(() => {
    const name = subjectTypeName();
    const typeRef = localSubjectHandle ? name ? localSubjectHandle.answer()?.[0] : undefined : reader?.registry().getUuid(name);
    return { onSubject: props.pane?.onSubject, typeRef,
      label: scopeLabel(scope(), scopeNames()), kind: currentKind() };
  }, value => { value.onSubject?.(value.typeRef, value.label, value.kind); });

  function presentedRow(): LocusViewRow {
    const row = scopeSubject().row!;
    const kind = currentKind();
    if (kind === "calendar") {
      // A derived Calendar (also a pane's presentation) opens on its earliest group's month.
      const state = valueScope();
      const first = state?.ok && state.calendarDays ? earliestCalendarDay(state.calendarDays) : undefined;
      if (first) return { ...row, view: { ...row.view, kind: "calendar", year: first.year, month: first.month } as AnyView };
    }
    if (kind === "chart") {
      const state = valueScope();
      if (state?.ok && state.grouping?.kind === "chart") return { ...row, view: { kind: "chart", items: row.view.items, bars: state.grouping.bars } };
    }
    return kind === "value" || kind === "code" || kind === "derive-canvas" ? row
      : { ...row, view: { ...row.view, kind: kind === "desktop" ? "grid" : kind } as AnyView };
  }

  const lensDataCodeSubject = createMemo<{ item: LayoutItem; expression: ExprNode } | { error: string } | undefined>(() => {
    if (props.pane?.subject?.() && !heldLensSubject()) return { error: "This lens data is unavailable in the current reader." };
    if (currentKind() !== "code") return undefined;
    const session = transferSession();
    const savedValue = focusedExpressionState().savedValue();
    const held = heldLensSubject();
    const state = valueScope();
    const row = scopeSubject().row;
    if (!savedValue && !held && !state?.ok && !row) return undefined;
    let value: unknown;
    const type = held?.type ?? focusedType();
    if (savedValue) value = savedValue.value;
    else if (held) value = held.value;
    else if (state?.ok) value = state.container;
    else {
      const saved = savedExprById();
      const values: unknown[] = [];
      for (const item of row!.view.items) {
        const expression = resolveExpr(item, saved);
        const checked = expression ? readLocusCardResult(expression, saved, session) : undefined;
        if (checked?.error) return { error: checked.error };
        if (!checked || checked.result === undefined) return {
          error: "Some data has no readable result yet. Open Data to load it, or run its function explicitly before showing the result as Code.",
        };
        values.push(checked.result);
      }
      value = values;
    }
    if (value === undefined) return { error: "This data has no readable Code presentation." };
    try { assertJsonAuthoringValue(value, undefined, "data", true); }
    catch (error) { return { error: `This data has no readable Code presentation: ${error instanceof Error ? error.message : String(error)}` }; }
    try {
      return { item: { id: "$data-code", caption: scopeLabel(scope(), scopeNames()), valueType: type },
        expression: expressionForTransfer({ value, type, typeName: classifyData(value), source: "fenel" }, session.environment) };
    } catch (error) {
      return { error: `This data has no readable Code presentation: ${error instanceof Error ? error.message : String(error)}` };
    }
  });

  function HomeToolbar() {
    const sourceIcon = () => props.pane?.source().$tag === "AllDataSource" ? "list"
      : props.pane ? accountDataIcon(props.pane.accounts().find(account => account.id === workspaceSourceKey(props.pane!.source()))) : undefined;
    const summaryName = useDataCaptionPresentation({
      get caption() {
        if (heldLensSubject()) return undefined;
        const here = scope();
        if (here.kind === "root") return "All data";
        const state = valueScope();
        return state?.ok ? focusedLocusItem(state.item, here).caption : scopeLabel(here, scopeNames());
      },
      get value() { const held = heldLensSubject(); if (held) return held.value;
        const state = valueScope(); return state?.ok ? state.container : undefined; },
      get representations() { if (heldLensSubject()) return undefined;
        const state = valueScope(); return state?.ok ? focusedLocusItem(state.item, scope()).representations : undefined; },
    });
    const summaryUnnamed = () => !displayNameText(summaryName())?.trim();
    const subjectType = useDataTypePresentation({
      get type() { return focusedType(); },
      get declaredType() { return focusedType(); },
      get value() { const held = heldLensSubject(); if (held) return held.value;
        const state = valueScope(); return state?.ok ? state.container : undefined; },
    });
    const summaryPresentation = createMemo(() => {
      const held = heldLensSubject();
      if (held) {
        const reference = readLocusCatalogReference(held.value);
        return reference ? reader?.presentation(reference.id) : undefined;
      }
      if (scope().kind === "root") return { icon: sourceIcon() ?? (props.pane?.source().$tag === "AllDataSource" ? "list" : "user"), emoji: undefined };
      const state = valueScope();
      if (!state?.ok) return undefined;
      const item = focusedLocusItem(state.item, scope());
      const reference = readLocusCatalogReference(state.container);
      const own = reference ? reader?.presentation(reference.id) : undefined;
      const icon = item.representations?.Iconable?.icon;
      const emoji = item.representations?.Emojiable?.emoji;
      return ownPresentationFromReaderSnapshot(presentationFrame(), new Map<string, Record<string, unknown>>([
        ["Iconable", { icon: typeof icon === "string" ? icon : own?.icon }],
        ["Emojiable", { emoji: typeof emoji === "string" ? emoji : own?.emoji }],
      ]), reference?.id ?? item.id);
    });
    const summaryIcon = () => summaryPresentation()?.icon;
    const summaryEmoji = () => summaryPresentation()?.emoji;
    return (<>
      <TransferFeedback sequence={transferSequence()} complete={transferComplete()} />
      <Show when={props.pane?.summaryMount?.()}>{mount => <Portal mount={mount()}><LensDataSummary
        account={props.pane?.source().$tag !== "AllDataSource" ? props.pane?.sourceLabel() : undefined}
        accountIcon={sourceIcon()}
        name={summaryName()} unnamed={summaryUnnamed()} pending={!root()}
        icon={summaryIcon()} emoji={summaryEmoji()}
        typeLabel={subjectType().detailLabel || undefined} typeIcon={subjectType().icon} typeTerm={subjectType().code}
        typePreview={focusedType() ? () => <ValueCard class="home-item--type-preview" heading={<ValueCardCaption
          caption={summaryName()} unnamed={summaryUnnamed()}
          icon={summaryIcon()} emoji={summaryEmoji()} typeLabel={subjectType().detailLabel} typeIcon={subjectType().icon} />}>
          <TypeDataPreview type={focusedType()!} compact fieldRegistry={readerFieldOwner(reader, homeAuthoringSession)} /></ValueCard> : undefined}
        onTypeOpen={focusedType() ? () => openTypeAsData(focusedType()!) : undefined}
        actions={() => <InspectionSessionActions controller={focusedExpressionController()} editInLocal={focusEditInLocal} />} /></Portal>}</Show>
      <div class="home-toolbar">
        <Show when={!props.pane}>
          <AccountDataSwitcher disabled={importing() > 0 || valueSaving() > 0 || rootSaving() > 0 || readingClipboard() || !!editing() || composing() || typeComposing() || fnComposing() || !!quickValue()}
            beforeChange={async () => {
              if (!await flushPane()) throw new Error("Finish applying these changes before changing accounts.");
              if (client.drafts?.pending() && synchronization?.enabledNow() === false) {
                throw new Error("Save or discard the pending changes before changing accounts.");
              }
            }} />
        </Show>
        {/* WHERE YOU ARE. The dropdown that used to sit here asked which
            data you wanted, which presumes several disjoint universes to pick
            between; there is one, and what the dropdown listed were its items.
            So they are cards in the root scope now, and this is a position
            with a way back up. `design/locus-as-value.md` §1-§2. */}
        <LocusBreadcrumb
          scope={scope()}
          pending={props.pane?.navigationPending?.()}
          renderScopeThumbnail={target => {
            const held = scopeKey(target) === scopeKey(scope()) ? heldLensSubject() : undefined;
            if (held) return <CardValuePreview value={held.value} type={held.type} />;
            if (target.kind === "root") return <CardValuePreview value={undefined} type={root()?.type ?? List(Anything)}
              valueIcon={scopeKey(target) === scopeKey(scope()) ? summaryIcon() : sourceIcon()} />;
            if (target.kind === "view") {
              const item = rootItems().find(item => item.id === target.viewId);
              const occurrence = item?.representations?.Iconable?.icon;
              return <CardValuePreview value={undefined} type={root()?.lists.find(row => row.id === target.viewId)?.valueType ?? List(Anything)}
                valueIcon={typeof occurrence === "string" ? occurrence : undefined} />;
            }
            const state = valueScope();
            if (!state?.ok || state.item.id !== target.itemId || state.row.id !== target.viewId) return <CardValuePreview value={undefined} />;
            const read = valueScopeBreadcrumbRead(state, target.path);
            if (!read.known) {
              const icon = !target.path.length ? state.item.representations?.Iconable?.icon : undefined;
              return <CardValuePreview value={undefined} type={read.type} valueIcon={typeof icon === "string" ? icon : undefined} />;
            }
            const rootValue = read.value, rootType = read.type, relativePath = read.path;
            if (target.path.length === 0) {
              const occurrence = state.item.representations?.Iconable?.icon;
              return <CardValuePreview value={rootValue} type={rootType}
                valueIcon={typeof occurrence === "string" ? occurrence : undefined} />;
            }
            const session = state.sourceSession;
            const initial = followLocusPath(rootValue, [], state.resolveReference);
            let type = initial.followed ? undefined : rootType;
            let value = initial.value;
            let fieldIcon: string | undefined;
            for (const step of relativePath) {
              const tag = value && typeof value === "object" && "$tag" in value && typeof value.$tag === "string" ? value.$tag : undefined;
              const fields = tag ? constructorFieldsForTag(tag, { ...session.environment, scrutineeType: type }) : recordFieldsForType(type, session.environment);
              const field = typeof step === "string" ? fields?.find(field => field.name === step) : undefined;
              // B4 wave 4 lane H: a Local reader's field icon is its worker's answer.
              const icon = field?.key?.$tag !== "NamedField" ? undefined : reader?.kind === "local"
                ? localFieldIcon(reader, session, field.key.ref.$ref) : session.registry.getFieldRepresentation("Iconable", field.key.ref.$ref)?.methods.icon;
              fieldIcon = typeof icon === "string" ? icon : undefined;
              type = childValueType(value, type, step, session);
              const next = followLocusPath(value, [step], state.resolveReference);
              value = next.value;
              if (next.followed) type = undefined;
            }
            return <CardValuePreview value={scopeKey(target) === scopeKey(scope()) ? state.container : value}
              type={scopeKey(target) === scopeKey(scope()) ? state.containerType : type}
              valueIcon={fieldIcon} />;
          }}
          icon={summaryIcon()}
          subjectName={scope().kind !== "root" || heldLensSubject() ? summaryName() || "Data" : undefined}
          subjectUnnamed={scope().kind !== "root" || heldLensSubject() ? summaryUnnamed() : false}
          rootLabel={props.pane?.sourceLabel()} rootIcon={sourceIcon()}
          onAllData={props.pane?.onAllData ? () => props.pane!.onAllData!() : undefined}
          onOpenAllDataLens={props.pane?.onAllData} allData={props.pane?.source().$tag === "AllDataSource"}
          onOpenLens={props.pane?.onOpenLens}
          viewName={scopeNames().viewName}
          itemName={scopeNames().itemName}
          onNavigate={navigateScope}
          typeTerm={subjectType().code}
          typeLabel={subjectType().label}
          typeIcon={subjectType().icon}
          typePreview={() => <ValueCard class="home-item--type-preview" heading={<ValueCardCaption
            caption={summaryName()} unnamed={summaryUnnamed()}
            icon={summaryIcon()} emoji={summaryEmoji()} typeLabel={subjectType().detailLabel} typeIcon={subjectType().icon} />}>
            <TypeDataPreview type={focusedType() ?? List(Anything)} compact fieldRegistry={readerFieldOwner(reader, homeAuthoringSession)} /></ValueCard>}
          onTypeOpen={() => openTypeAsData(focusedType() ?? List(Anything))}
        />
        <Show when={scope().kind === "view" && current() && root()?.canEdit}><button
          type="button"
          class="btn"
          style="padding: 0.25rem 0.4rem"
          ref={(element) => { viewOpsButton = element; }}
          aria-haspopup="menu"
          aria-expanded={viewOpsOpen() ? "true" : "false"}
          aria-label="Data operations"
          data-tooltip="Rename, duplicate, or delete this data"
          onClick={() => {
            const rect = viewOpsButton?.getBoundingClientRect();
            setViewOpsOpen(rect ? { x: rect.left, y: rect.bottom + 4 } : undefined);
          }}
        ><IconSettings size={16} /></button></Show>
        <LocusLayoutControl
          kind={currentKind()}
          options={layoutOptions()}
          onChange={(kind) => void setLayoutKind(kind)}
          disabled={!scopeSubject().row || !props.pane && root()?.canEdit !== true}
        />
        <Show when={currentKind() === "list"}>
          <button type="button" class="btn home-action-button" style="padding: 0.25rem 0.5rem; font-size: 0.78rem"
            data-tooltip={listAxis() === "horizontal" ? "Stack this list downward" : "Lay this list side by side"}
            onClick={() => void setListAxis(listAxis() === "horizontal" ? "vertical" : "horizontal")}>
            {/* The narrow toolbar hides button text: without an icon this control was a blank square. */}
            <Show when={listAxis() === "horizontal"} fallback={<IconArrowsLeftRight size={16} />}><IconStack size={16} /></Show>
            {listAxis() === "horizontal" ? "Stack" : "Row"}
          </button>
        </Show>
        {/* ONE control. Browse is search with an empty query — the same rows
            over the same universe — so two buttons were one concept twice. */}
        <button
          type="button"
          class="btn home-search-trigger home-action-button"
          style="padding: 0.25rem 0.6rem; font-size: 0.78rem"
          aria-expanded={drawerOpen() ? "true" : "false"}
          onClick={() => setDrawerOpen(!drawerOpen())}
          data-tooltip="Browse everything, or search it"
        >
          <IconSearch size={16} />
          Browse
        </button>
        <button
          type="button"
          class="btn home-new-button home-action-button"
          aria-label="New data"
          style="padding: 0.25rem 0.6rem; font-size: 0.78rem"
          onClick={() => {
            if (root()?.canEdit !== true && rootShelf) { rootShelf.request("new:expression"); return; }
            setComposeCheckpoint(undefined);
            if (props.pane?.source().$tag === "ThisTabSource") props.pane.onCreationDraft?.({
              focus: cloneDraftValue(scope()), action: { kind: "new:expression", expr: emptyExpressionSlot() },
            }, client);
            setComposeCardAnchor(undefined); setComposePlacement(undefined); setComposeExpression(true); setComposing(true);
          }}
          disabled={editingDraftOpen() || picking() || linkedDemoAdding()}
          data-tooltip={linkedDemoAdding() ? "Create data\nAdding linked data…"
            : picking() ? "Create data\nChoose data in the open dialog."
            : editingDraftOpen() ? "Create data\nFinish or cancel the current edit."
            : root()?.canEdit !== true && rootShelf ? "Create data\nOpen Local to add data."
            : !homeData.canAdd() ? valueScopeLoading() || !root() ? "Create data\nLoading data…"
              : homeData.canWrite() ? "Create data\nOpen a list to add data."
              : "Create data\nThis data is read-only." : "Create data"}
        >
          <IconByName name="plus" size={16} /><span>New</span>
        </button>
        <button type="button" class="btn home-action-button" aria-label="More creation options" data-tooltip="More creation options" aria-haspopup="dialog"
          aria-expanded={picking() ? "true" : "false"} disabled={editingDraftOpen() || linkedDemoAdding()}
          style="padding: 0.25rem 0.4rem; font-size: 0.78rem" onClick={() => { setComposePlacement(undefined); setPicking(true); }}>
          <IconByName name="chevron-down" size={16} />
        </button>
        {/* Edit in Local sits with the value's name (InspectionSessionActions)
            whenever a summary or the page heading holds it (owner review, Nov 11). */}
        <Show when={props.pane && !props.pane.summaryMount?.() && focusDemoCopy()}>{branch => <button type="button" class="btn home-action-button" aria-label="Edit in Local"
          disabled={linkedDemoAdding()} data-tooltip="Copy this example into Local and edit it there"
          onClick={event => { event.stopPropagation(); const next = focusDemoCopy(); if (next) pickCreationBranch(next); }}><IconByName name="pencil" size={16} /></button>}</Show>
        <Show when={props.pane && !props.pane.toolbarMount?.()}><button type="button" class="workspace-pane__close" aria-label="Close lens" data-tooltip="Close lens"
          onClick={() => props.pane?.onClose()}>×</button></Show>
        <Show when={!props.pane}><DataInspectionControls mode={lensMode()} onModeChange={setLensMode} suggestionOwner={lensSuggestions} dependencies /></Show>
      </div></>);
  }

  return (
    <SavedValuesContext value={savedValuesProvider}>
     <CreateModalContext value={createModalCtx}>
      <InspectionSessionContext value={focusedExpressionController}><HomeDataContext value={{
        ...homeData,
        openMenu: openContextMenu,
        openContainedMenu,
        occurrenceFor: (getItem, getEvaluated) => {
          const item = createMemo(getItem);
          const evaluated = createMemo(() => getEvaluated?.());
          const occurrence = createMemo<MenuOccurrence | undefined>(() => {
            const capturedItem = item(); const capturedValue = evaluated();
            return capturedItem && capturedValue ? { item: capturedItem, evaluated: capturedValue,
              current: () => capturedItem === item() && capturedValue === evaluated() } : undefined;
          });
          // Polish item 1: an editable card's fields can be changed in place.
          return { ...suggestionSourceForTarget(item, occurrence), edit: {
            available: () => !editingDraftOpen() && !!item() && fieldEditAvailable(item()!),
            applyLabel: () => temporaryEdits() ? "Apply" : "Save",
            write: (path, value, type) => editFieldAt(item(), path, value, type),
            // The item editor opens from a root or list card; inside a value
            // the card's own menu keeps its Edit entry.
            get openFull() {
              return scope().kind === "value" ? undefined : () => {
                const target = item(); const viewId = scopeViewId(scope()) ?? root()?.id;
                if (target && viewId && scope().kind !== "value") openItemEditor({ item: target, homeId: viewId, rootRevision: root()?.revision });
              };
            },
          } };
        },
        menuOpen: (itemId) => contextMenu()?.item?.id === itemId,
        openInspection,
        cardReference: cardReferenceExpression,
        focusedExpressionState,
        inspectionValue: item => {
          const here = scope();
          const state = valueScope();
          if (here.kind !== "value" || props.publicData || root()?.canEdit !== true || valueScopeLoading()
            || !state?.ok || state.followedReference) return undefined;
          const key = childItemKey(item.id);
          if (item.id !== "$self" && key === undefined) return undefined;
          return { controller: focusedExpressionController, path: () => key === undefined ? [] : [key],
            focused: () => item.id === "$self", available: () => {
              const current = valueScope();
              return scope() === here && !props.publicData && root()?.canEdit === true && !valueScopeLoading()
                && !!current?.ok && !current.followedReference;
            } };
        },
        inspectionOrigin: currentInspectionOrigin,
        instantiateFunction: (pin) => {
          setCalling({ fnId: pin.id, fnName: pin.name });
        },
        codeOpen: (itemId) => codeItemId() === itemId,
        desktop: () => currentKind() === "desktop",
        openDesktop: (item, evaluated) => {
          if (item.id === "$self") props.pane?.onPresentation("value");
          else homeData.enter(item, evaluated);
        },
        toggleCode: (itemId) => setCodeItemId((current) => current === itemId ? undefined : itemId),
        cutId: () => cutMark()?.itemId,
        requestInspect: setInspectItem,
        inspectRequest: inspectItem,
        repairType,
        demoCopyBranch: itemDemoCopy,
        editDemoInLocal: pickCreationBranch,
      }}>
      <Show when={props.pane} fallback={<HomeToolbar />}>
        <Show when={props.pane!.toolbarMount()}>{(mount) =>
          <Portal mount={mount() as HTMLElement}><HomeToolbar /></Portal>
        }</Show>
      </Show>
      <Show when={!props.pane}><InspectionSessionActions controller={focusedExpressionController()} editInLocal={focusEditInLocal} /></Show>
      <LocusNotifications notices={notices()} onDismiss={dismissNotice} />
      <Show when={shortcutDraft()} keyed>{draft => <ModalOverlay class="modal-overlay"
        onClick={event => { if (event.target === event.currentTarget) closeLensShortcut(); }}
        onKeyDown={event => { if (event.key === "Escape") closeLensShortcut(); }}>
        <div class="modal home-composer-modal" role="dialog" aria-modal="true" aria-label={`Shortcut: ${draft.shortcut.label}`}>
          <header class="modal-header"><h2>{draft.shortcut.label}</h2><button type="button" class="btn"
            onClick={closeLensShortcut}>Close</button></header>
          <div class="home-composer-modal__body">
            <Show when={shortcutDraft()?.shortcut.operation.$tag === "InvokeLensRecipe" && shortcutArgumentsField()} keyed
              fallback={localLensReader && !shortcutDraft()?.local ? undefined : <p class="text-muted">The shortcut's argument type is unavailable in this reader.</p>}>
              {field => <RecordValuesContext value={() => shortcutDraft()!.shortcut.operation.$tag === "InvokeLensRecipe"
                ? (shortcutDraft()!.shortcut.operation as { $tag:"InvokeLensRecipe"; recipe: import("~/lib/lens-shortcuts").LensFunctionRecipe }).recipe as unknown as Record<string, unknown> : {}}>
                <FieldRenderer field={field} registry={readerFieldOwner(reader, homeAuthoringSession)} callableRegistry={readerFieldOwner(reader, homeAuthoringSession)}
                  value={localShownArguments() ? localShownArguments()!.value : shortcutDraft()!.shortcut.operation.$tag === "InvokeLensRecipe"
                    ? (shortcutDraft()!.shortcut.operation as { $tag:"InvokeLensRecipe"; recipe: import("~/lib/lens-shortcuts").LensFunctionRecipe }).recipe.arguments : undefined}
                  onChange={args => localLensReader ? queueLocalShortcutEdit({ arguments: { value: args } }) : setShortcutDraft(current => current ? { ...current,
                    shortcut: withLensShortcutArguments(homeAuthoringSession(), current.shortcut, args) } : current)} />
              </RecordValuesContext>}
            </Show>
            <Show when={shortcutField("disposition")} keyed>{field => <FieldRenderer field={field}
              registry={readerFieldOwner(reader, homeAuthoringSession)} value={localShownDisposition()?.value ?? shortcutDraft()!.shortcut.disposition}
              onChange={disposition => localLensReader ? queueLocalShortcutEdit({ disposition: disposition as LensShortcut["disposition"] })
                : setShortcutDraft(current => current ? { ...current,
                shortcut: withLensShortcutDisposition(homeAuthoringSession(), current.shortcut,
                  disposition as LensShortcut["disposition"]) } : current)} />}</Show>
            <Show when={shortcutIssue()}>{issue => <p role="alert">{issue()}</p>}</Show>
          </div>
          <footer class="modal-footer"><button type="button" class="btn" disabled={shortcutRunning() || localShortcutEditing() || !shortcutArgumentsField()}
            onClick={() => void runLensShortcut()}>{shortcutRunning() ? "Running…" : "Run"}</button></footer>
        </div>
      </ModalOverlay>}</Show>
      <Show when={sourceDialog()}>{item => <ItemExpressionDialog item={item()} savedExprById={savedExprById()}
        initialCode onClose={() => setSourceDialog(undefined)} />}</Show>
      <Show when={viewOpsOpen()} keyed>{(at) => (
        <LocusContextMenu
          x={at.x}
          y={at.y}
          items={viewOpsItems()}
          onClose={() => setViewOpsOpen(undefined)}
        />
      )}</Show>

      {/* No notice column here: everything the workspace reports reaches the
          user through the bar's notification affordance. */}

      <DataInspectionPanels mode={lensMode()} inline subjectKey={scope()} data={() => <InspectionDraftPreview
        controller={focusedExpressionController()} item={lensExpressionSubject()?.item} savedExprById={savedExprById()} bodyOnly
        fallback={() => <Show when={currentKind() === "code"} fallback={<Show when={props.pane?.subject?.()} fallback={<Show when={focusedExpressionState().savedValue()} keyed fallback={<div
        ref={stage}
        data-locus-surface="workspace"
        data-read-only={root()?.canEdit !== true ? "true" : undefined}
        class={`home-stage fenel-transfer-workspace ${drawerOpen() ? "home-stage--with-drawer" : ""} ${dropOver() ? "fenel-transfer-workspace--over" : ""}`}
        aria-label={props.publicData ? "Public data" : "Data — paste or drop to add data"}
        tabindex={0}
        onContextMenu={tapMenu.onContextMenu}
        onPointerDown={tapMenu.onPointerDown}
        onPointerMove={tapMenu.onPointerMove}
        onPointerUp={tapMenu.onPointerUp}
        onPointerCancel={tapMenu.onPointerCancel}
        onClick={tapMenu.onClick}
        onDragOver={onDragOverPin}
        onDragLeave={(event) => {
          if (!(event.relatedTarget instanceof Node) || !stage?.contains(event.relatedTarget)) setDropOver(false);
        }}
        onDrop={(e) => void onDropPin(e)}
      >
        {/* The offer to drop is made WHILE something is being dragged over the
            surface, and only then. Hovering a view is not an intent to add to
            it, so nothing is advertised on hover — this is the one moment the
            offer is true, and it is stated plainly instead of as a dashed
            outline the user has to interpret. */}
        <Show when={dropOver()}>
          <div class="fenel-transfer-workspace__drop" aria-hidden="true">
            <span>Drop to add to this data</span>
          </div>
        </Show>
        {/* One renderer, three scopes. The layouts do not know which one
            they are drawing — that is what makes entering a value not a
            feature but a consequence. */}
        <Show when={valueScopeLoading()}><LensSpinner /></Show>
        <Show when={scopeSubject().row?.id} keyed fallback={
          <Show when={!valueScopeLoading() && dataLoadErrors().length === 0 && !scopeSubject().error}>
            <EmptyState message={retryingData() ? "Loading…" : "Nothing here yet. Add data."} />
          </Show>
        }>
          {/* Keyed on the scope id: moving scope remounts the surface, so no
              renderer carries drag state across a move. */}
          {(_scopeId) => (
            <ViewRenderer
              home={presentedRow()}
              derivedCalendar={(() => { const state = valueScope(); return !!state?.ok && !!state.calendarDays && scope().kind === "value"; })()}
              groupingTable={(() => { const state = valueScope(); const here = scope(); return !!state?.ok && !!state.grouping && here.kind === "value" && here.path.length === 0; })()}
              persist={(next) => { if (root()?.canEdit === true) scopeSubject().persist(next); }}
              savedExprById={savedExprById()}
              elementType={focusedElementType()}
              contentFirst={(() => { const state = valueScope(); return state?.ok && state.presentation?.root.contentFirst === true; })()}
              tiles={focusedListTiles()} tileFieldOrder={focusedListFieldOrder()}
              generatedCaption={item => item.source?.kind === "expr" && generatedCollectionCaptions.has(item.source.expr)}
              wholeView={automaticWholeValue()}
              pane={props.pane}
              onEdit={(item) => {
                const viewId = scopeViewId(scope()) ?? root()?.id;
                if (viewId && scope().kind !== "value") openItemEditor({ item, homeId: viewId, rootRevision: root()?.revision });
              }}
              onCallFunction={(pin) => setCalling({ fnId: pin.id, fnName: pin.name })}
            />
          )}
        </Show>
      </div>}>
        {value => <Show when={lensExpressionSubject()}>{subject => <InspectionDataValue item={{ ...subject().item,
          source: { kind: "expr", expr: value.source! } }} value={value.value} evaluated={value}
          savedExprById={savedExprById()} expressionState={focusedExpressionState()} controller={focusedExpressionController()} bodyOnly />}</Show>}
      </Show>}><Show when={heldLensSubject()} keyed fallback={heldSubjectPending() ? <CardLoadingIndicator label="Preparing this scope…" />
        : localHeldSubject?.failure() ? <ValueFailure message={localHeldSubject.failure()} retry={() => localHeldSubject!.retry()} /> : <DataUnavailable label={heldSubjectAdmission()?.ok === false
        ? (heldSubjectAdmission() as { ok: false; issue: string }).issue : "This lens data is unavailable in the current reader."} />}>
        {data => <TypedReadValue value={focusedExpressionState().savedValue()?.value ?? data.value} type={data.type} fieldRegistry={readerFieldOwner(reader, homeAuthoringSession)}
          occurrence={lensOccurrence}
          onDataContext={(event, child) => {
            const selected = lensExpressionSubject();
            if (selected) openContainedMenu(event, selected.item, child, selected.evaluated);
          }}
          fallback={<DataValueSurface value={focusedExpressionState().savedValue()?.value ?? data.value} type={data.type} label="Data" session={homeAuthoringSession} />} />}
      </Show></Show>}><Errored fallback={(error, reset) => <ValueFailure message={String(error())} retry={reset} />}>
        <Loading fallback={<CardLoadingIndicator label="Preparing data as Code…" />}>
          <Show when={lensDataCodeSubject()} keyed fallback={<CardLoadingIndicator label="Preparing data as Code…" />}>
            {subject => "error" in subject ? <DataUnavailable label={subject.error} /> : <InspectionExpression
              item={subject.item} dataExpression={subject.expression} readOnly savedExprById={savedExprById()} presentation="code" />}
          </Show>
        </Loading></Errored></Show>} />} expression={() => <Errored fallback={(error, reset) => <ValueFailure message={String(error())} retry={() => retryExpressionData(reset)} />}>
        <Loading fallback={<CardLoadingIndicator label="Preparing expression…" />}><Show when={lensExpressionSubject()} fallback={<Show when={lensExpressionFailure()} keyed fallback={<CardLoadingIndicator label="Preparing expression…" />}>
          {message => <ValueFailure message={message} retry={() => retryExpressionData(() => { void valueScopeResponse.refetch().catch(() => {}); })} />}
        </Show>}>
          {subject => <Show when={focusedExpressionState()} keyed>{state => <InspectionExpression item={subject().item} evaluated={subject().evaluated}
            savedExprById={savedExprById()} state={state} presentation="visual" />}</Show>}
        </Show></Loading></Errored>} code={() => <Errored fallback={(error, reset) => <ValueFailure message={String(error())} retry={() => retryExpressionData(reset)} />}>
        <Loading fallback={<CardLoadingIndicator label="Preparing Fenel code…" />}><Show when={lensExpressionSubject()} fallback={<Show when={lensExpressionFailure()} keyed fallback={<CardLoadingIndicator label="Preparing Fenel code…" />}>
          {message => <ValueFailure message={message} retry={() => retryExpressionData(() => { void valueScopeResponse.refetch().catch(() => {}); })} />}
        </Show>}>
          {subject => <Show when={focusedExpressionState()} keyed>{state => <InspectionExpression item={subject().item} evaluated={subject().evaluated}
            savedExprById={savedExprById()} state={state} presentation="code" />}</Show>}
        </Show></Loading></Errored>}
        suggestions={() => <>
          <Show when={suggestionApplyError()}>{error => <p class="data-error" role="alert">{error()}</p>}</Show>
          <Show when={appliedNotice()}>{applied => <p class="home-item__applied" role="status">
            <span class="home-item__applied-text">{applied().message}</span>
            <button type="button" class="home-item__applied-undo" data-tooltip="Undo (Ctrl+Z)"
              onClick={() => { void applied().undo(); }}>Undo</button>
          </p>}</Show>
          <DataInspectionSuggestionsPanel owner={lensSuggestions} visible={dataInspectionPanelVisible(lensMode(), "suggestions")} />
        </>}
        dependencies={() => <Errored fallback={(error, reset) => <ValueFailure message={String(error())} retry={reset} />}>
          <Loading fallback={<CardLoadingIndicator label="Preparing dependencies…" />}>
            {/* Keyed: each ask mounts its own panel, so nothing inside reads a
                retired ask after the focus moved (no stale reads, no throw). */}
            <Show when={lensDependencies()} keyed fallback={<CardLoadingIndicator label="Preparing dependencies…" />}>
              {graph => <Show when={graph.collection} keyed fallback={<Show when={graph.projection} keyed fallback={<p class="related-data-panel__status">{graph.guidance}</p>}>
                {/* A datum's own graph (a card, a retained reference): the same cards. A value
                    nested inside a card keeps the drawing centred on what it is made of. */}
                {projection => graph.containedIn === undefined ? <FocusLinkedGraph projection={projection} />
                  : <DependencyGraphHostContext value={dependencyGraphHost}>
                  <DependencyGraphPanel projection={projection} centre={graph.centre} containedIn={graph.containedIn} />
                </DependencyGraphHostContext>}
              </Show>}>{collection => <LinkedCollectionGraph ask={collection} />}</Show>}
            </Show>
          </Loading>
        </Errored>} />

      <Show when={drawerOpen()}>
        <LocusBrowse
          query={drawerQuery()}
          onQuery={setDrawerQuery}
          groups={browseGroups()}
          pending={browsePending()}
          onClose={() => setDrawerOpen(false)}
        />
      </Show>

      <Show when={editing()} keyed>
        {(state) => (
          <EditModal
            item={state.item}
            homeId={state.homeId}
            standalone={state.standalone}
            savedExprById={savedExprById()}
            expectedSavedQuery={state.expectedSavedQuery}
            sourceTicket={state.sourceTicket}
            onApplied={() => { if (temporaryEdits()) setImportNotice("Applied locally."); }}
            onSaveItem={async (item, expr, definitionBundle, occurrenceChanged = true, assertCurrent, signal) => {
              assertCurrent?.();
              const epoch = sessionEpoch();
              assertSourceTicket(state.sourceTicket ?? rootSourceTicket());
              const authoredRootRevision = state.rootRevision ?? root()?.revision;
              if (definitionBundle && (!occurrenceChanged || state.standalone === "definition")) {
                if (!client.editDefinitionAndData || authoredRootRevision === undefined) throw new Error("Wait for this data to load before changing it.");
                const changed = await enqueueRootWrite(() => {
                  assertSourceTicket(state.sourceTicket ?? rootSourceTicket());
                  assertCurrent?.();
                  return client.editDefinitionAndData!(definitionBundle, authoredRootRevision);
                });
                assertCurrentSession(epoch);
                acknowledgeRootRevision(changed.root.id, changed.root.revision, changed);
                revalidate("locusRoot");
                await refresh(all);
                return;
              }
              if (state.standalone === "definition") return;
              if (state.standalone === "saved") {
                const id = item.source?.kind === "ref" ? item.source.ref.id : undefined;
                const saved = ((savedAll() as { queries?: { id: string; query: Record<string, unknown> }[] })?.queries ?? [])
                  .find(value => value.id === id);
                if (!id || !saved) throw new Error("This saved data is no longer available in this account.");
                const expectedType = item.valueType ?? saved.query.valueType as FenelType | undefined;
                let issue: string | undefined;
                if (reader?.kind === "local") {
                  // B4 slice 1: the reader's worker decides; nothing is written meanwhile.
                  issue = await localExpressionSaveIssue(expr, { reader, session: homeAuthoringSession, saved: savedExprById(),
                    ...(expectedType === undefined ? {} : { expectedType }), signal, current: () => {
                      assertCurrent?.();
                      assertSourceTicket(state.sourceTicket ?? rootSourceTicket());
                    } });
                } else {
                  const session = homeAuthoringSession();
                  issue = draftSaveIssue(expr, session.environment, {
                    expectedType,
                    registry: session.registry,
                    evaluateContext: session.evaluateContext,
                    resolveSavedExpr: reference => savedExprById().get(reference),
                  });
                }
                if (issue) throw new Error(issue);
                if (definitionBundle) {
                  if (!client.editDefinitionAndData || authoredRootRevision === undefined) throw new Error("Wait for this data to load before changing it.");
                  const changed = await enqueueRootWrite(() => {
                    assertSourceTicket(state.sourceTicket ?? rootSourceTicket());
                    assertCurrent?.();
                    return client.editDefinitionAndData!(definitionBundle, authoredRootRevision,
                      { savedValue: { id, query: { ...saved.query, expr }, expectedQuery: state.expectedSavedQuery ?? saved.query } });
                  });
                  assertCurrentSession(epoch);
                  acknowledgeRootRevision(changed.root.id, changed.root.revision, changed);
                } else await api.savedQueryUpdate(id, { query: { ...saved.query, expr }, expectedQuery: state.expectedSavedQuery ?? saved.query });
                revalidate("savedQueries");
                return;
              }
              await homeData.replace(item, expr, item.valueType, undefined, undefined, authoredRootRevision, definitionBundle, state.expectedSavedQuery, state.sourceTicket, assertCurrent);
            }}
            onClose={() => setEditing(null)}
          />
        )}
      </Show>

      <Show when={contextMenu()} keyed>{(menu) => <LocusContextMenu x={menu.x} y={menu.y}
        label={menu.suggestions ? "Suggestions" : undefined}
        items={menu.suggestions ? (menu.suggestionsLens ? lensSuggestions : dataSuggestions).items() : contextItems(menu)}
        onClose={() => { (menu.suggestionsLens ? lensSuggestions : dataSuggestions).close(); setContextMenu(undefined); }} />}</Show>
      <Show when={moving()}>{(item) => <MoveValueDialog label={item().caption || "this data"}
        value={homeData.evaluated(item())?.value} environment={transferSession().environment}
        source={{ accountId: client.accountId, listId: scope().kind === "root" ? undefined : current()?.id }}
        onClose={() => setMoving(undefined)}
        onPlace={(place) => placeMoved(place, item())} />}</Show>

      <Show when={quickValue()?.epoch === sessionEpoch() ? quickValue() : undefined}>{(quick) => (
        <LocusQuickValue
          typeName={quick().typeName}
          shape={quick().shape}
          x={quick().x}
          y={quick().y}
          onCommit={async (value) => {
            const expr: ExprNode = { kind: "literal", value };
            const pinned = await homeData.add({ expr }, undefined, quick().hint);
            if (!pinned) throw new Error("Could not add this data here.");
          }}
          onOpenFull={() => { const q = quick(); setQuickValue(undefined); openComposerAt(q.typeName, q.hint); }}
          onClose={() => setQuickValue(undefined)}
        />
      )}</Show>

      <Show when={picking()}>
        <NewItemPickerModal
          onClose={() => { setComposeCardAnchor(undefined); setPicking(false); }}
          onPickValue={() => pickCreationBranch("new:value")}
          onPickType={() => pickCreationBranch("new:type")}
          onPickFunction={() => pickCreationBranch("new:function")}
          onPickFunctionCall={() => {
            setPicking(false);
            if (reader) { setDrawerQuery(""); setDrawerOpen(true); }
            else navigate("/app/functions");
          }}
          onPickExpression={() => pickCreationBranch("new:expression")}
        />
      </Show>

      <Show when={composing()}>
        <NewValueModal
          expressionMode={composeExpression()}
          creation={composeExpression() || !!composeCardAnchor() ? {
            pane: props.pane,
            current: composeAtRoot() ? rootCreationDestination() : homeData.canAdd() && root() ? {
              place: { accountId: client.accountId ?? "", accountLabel: props.pane?.sourceLabel() ?? "This data",
                sourceId: reader?.kind === "local" ? "local" : client.accountId,
                kind: scope().kind === "root" ? "root" : "list", rootId: root()!.id, revision: root()!.revision,
                listId: scope().kind === "view" ? scopeViewId(scope()) : undefined,
                listName: scopeLabel(scope(), scopeNames()), scope: cloneDraftValue(scope()),
                listType: scope().kind === "value" && valueScope()?.ok ? (valueScope() as Extract<ValueScopeState, { ok: true }>).containerType
                  : scope().kind === "view" ? root()!.lists.find(list => list.id === scopeViewId(scope()))?.valueType : root()!.type },
              reader, client, saved: savedValuesProvider, add: homeData.add, names: scopeNames(),
              assertCurrent: (() => {
                const here = scopeKey(scope()); const rootId = root()!.id; const epoch = sessionEpoch();
                const sourceTicket = client.drafts?.source();
                return () => {
                  assertCurrentSession(epoch);
                  client.signal.throwIfAborted();
                  if (root()?.id !== rootId || scopeKey(scope()) !== here || !homeData.canAdd()) {
                    throw new Error("The creation scope changed. Choose the scope again before creating data.");
                  }
                  if (sourceTicket !== client.drafts?.source()) throw new Error("This data source changed. Choose its scope again.");
                };
              })(),
              assertSource: (() => {
                const here = cloneDraftValue(scope());
                const state = here.kind === "value" ? valueScope() : undefined;
                if (here.kind !== "value" || !state?.ok) return undefined;
                const options = expressionEditOptions();
                const original = draftValueFingerprint(expressionAt(state.sourceExpression, here.path, options));
                const type = draftValueFingerprint(state.item.valueType);
                return (fresh: import("~/lib/locus-root-data").LocusRootData, sources: Map<string, ExprNode>, createdId?: string) => {
                  const item = findLocusItem(here.rootItem ? fresh.items : fresh.lists.find(row => row.id === here.viewId)?.view.items ?? [], here.itemId);
                  const expr = item && resolveExpr(item, sources);
                  if (!item || !expr || !editableContainerAt(expr, here.path, options) || draftValueFingerprint(item.valueType) !== type) {
                    throw new Error("The selected collection changed. Choose its scope again before creating data.");
                  }
                  const container = expressionAt(expr, here.path, options);
                  if (createdId && expressionMentions(container).refs.includes(createdId)) return;
                  if (draftValueFingerprint(container) !== original) throw new Error("The selected collection changed. Choose its scope again before creating data.");
                };
              })(),
            } : undefined,
          } : undefined}
          evaluateOnRequest={composeEvaluateOnRequest()}
          presetType={composePresetType() ?? undefined}
          cardAnchor={composeCardAnchor()}
          presetValueType={composePresetValueType()}
          placement={composePlacement()}
          presetExpr={composePresetExpr() ?? undefined}
          presetReps={composePresetReps() ?? undefined}
          checkpoint={composeCheckpoint()}
          onDraftChange={action => {
            if (props.pane?.source().$tag !== "ThisTabSource") return;
            props.pane.onCreationDraft?.(action ? { focus: cloneDraftValue(scope()), action } : undefined, client);
          }}
          onSwitchKind={(kind) => {
            setComposeCheckpoint(undefined);
            if (props.pane?.source().$tag === "ThisTabSource") props.pane.onCreationDraft?.({
              focus: cloneDraftValue(scope()), action: kind === "type" ? "new:type" : "new:function",
            }, client);
            setComposing(false);
            setComposeCardAnchor(undefined);
            setComposeExpression(false);
            setComposeEvaluateOnRequest(false);
            setComposePresetType(null);
            setComposePresetValueType(undefined);
            setComposePresetExpr(null);
            setComposePresetReps(null);
            if (kind === "type") setTypeComposing(true);
            if (kind === "function") setFnComposing(true);
          }}
          onCreated={(occurrence, place) => {
            const node = composedSuggestion;
            composedSuggestion = undefined;
            if (node) void openCreatedSuggestion(node, occurrence, place);
          }}
          onClose={() => {
            composedSuggestion = undefined;
            setComposeAtRoot(false);
            setComposeCheckpoint(undefined);
            props.pane?.onCreationDraft?.(undefined, client);
            setComposing(false);
            setComposeCardAnchor(undefined);
            setComposePlacement(undefined);
            setComposeExpression(false);
            setComposeEvaluateOnRequest(false);
            setComposePresetType(null);
            setComposePresetValueType(undefined);
            setComposePresetExpr(null);
            setComposePresetReps(null);
          }}
        />
      </Show>

      <Show when={typeComposing()}>
        <TypeComposer anchor={typeDraftAnchor()?.epoch === sessionEpoch() ? typeDraftAnchor() : undefined}
          preferred={() => listedTypeIdentities(current()?.view.items ?? [])}
          onClose={() => { props.pane?.onCreationDraft?.(undefined, client); setTypeDraftAnchor(undefined); setTypeComposing(false); }} />
      </Show>

      <Show when={fnComposing()}>
        <NewFunctionModal onClose={() => { props.pane?.onCreationDraft?.(undefined, client); setFnComposing(false); }} />
      </Show>

      <Show when={calling()} keyed>
        {(state) => (
          <FunctionCallModal
            fnId={state.fnId}
            fnName={state.fnName}
            addressInputs={state.addressInputs}
            onAddressInputsChange={inputs => {
              if (state.addressOrigin && props.pane?.active()
                && workspaceSourceKey(props.pane.source()) === state.addressOrigin.source
                && JSON.stringify(scopeToWorkspace(props.pane.focus())) === JSON.stringify(scopeToWorkspace(state.addressOrigin.focus))) {
                props.pane.onAddressInputsChanged?.(inputs);
              }
            }}
            onClose={() => setCalling(null)}
          />
        )}
      </Show>
      <Show when={earlyTypeInspection()}>{type => <TypeInspectionDialog type={type()} onClose={() => setEarlyTypeInspection(undefined)} />}</Show>
      </HomeDataContext></InspectionSessionContext>
     </CreateModalContext>
    </SavedValuesContext>
  );
}

function ViewRenderer(props: {
  pane?: WorkspacePane;
  home: LocusViewRow;
  /** The Calendar shows a derived date grouping: read-only, data-owned dates. */
  derivedCalendar?: boolean;
  /** The scope is a grouping's entries: as a table, a key and a value column. */
  groupingTable?: boolean;
  persist: (next: AnyView) => void;
  savedExprById: Map<string, ExprNode>;
  /** The element type of the list shown, when known (the table's columns). */
  elementType?: FenelType;
  contentFirst?: boolean;
  /** A focused list whose items have compact marks: its Grid draws tiles. */
  tiles?: boolean;
  tileFieldOrder?: readonly string[];
  generatedCaption?: (item: LayoutItem) => boolean;
  wholeView?: boolean;
  onEdit: (item: LayoutItem) => void;
  onCallFunction: (pin: { $pin: string; name: string; id: string }) => void;
}) {
  const view = createMemo(() => asView(props.home.view));
  const subject = createMemo(() => view().items.length === 1 && view().items[0]?.id === "$self"
    ? view().items[0] : undefined);
  // Switch on the view's kind. Once user-defined layout types arrive,
  // this dispatch becomes a `getLayout(viewType)` lookup against the
  // engine's Layout typeclass — the typeclass is already registered
  // for the four built-in shapes (see implementations/typescript/engine/src/builtin-classes.ts).
  // Dispatch by view kind. Each branch picks the matching renderer.
  // Adding a new layout = registering the typeclass instance + writing
  // a new renderer + adding a `view().kind === "X"` arm here.
  return (
    <Show when={subject()} keyed fallback={<Show when={view().kind === "list"} fallback={
      <Show when={view().kind === "table"} fallback={
      <Show when={view().kind === "grid"} fallback={
        <Show when={view().kind === "tree"} fallback={
          <Show when={view().kind === "tabs"} fallback={
            <Show when={view().kind === "calendar"} fallback={
              <Show when={view().kind === "timeline"} fallback={
                <Show when={view().kind === "map"} fallback={
                  <Show when={view().kind === "chart"} fallback={
                    <CanvasRenderer home={props.home} persist={props.persist} view={view() as CanvasView} savedExprById={props.savedExprById} onEdit={props.onEdit} onCallFunction={props.onCallFunction} />
                  }>
                    <GroupingChartRenderer view={view() as ChartView} />
                  </Show>
                }>
                  <MapRenderer home={props.home} persist={props.persist} view={view() as MapView} savedExprById={props.savedExprById} onEdit={props.onEdit} />
                </Show>
              }>
                <TimelineRenderer home={props.home} persist={props.persist} view={view() as TimelineView} savedExprById={props.savedExprById} onEdit={props.onEdit} />
              </Show>
            }>
              <CalendarRenderer home={props.home} persist={props.persist} view={view() as CalendarView} savedExprById={props.savedExprById} onEdit={props.onEdit}
                derived={props.derivedCalendar} />
            </Show>
          }>
            <TabsRenderer home={props.home} persist={props.persist} view={view() as TabsView} savedExprById={props.savedExprById} onEdit={props.onEdit} onCallFunction={props.onCallFunction} />
          </Show>
        }>
          <TreeRenderer home={props.home} persist={props.persist} view={view() as TreeView} savedExprById={props.savedExprById} onEdit={props.onEdit} />
        </Show>
      }>
        <GridRenderer home={props.home} persist={props.persist} view={view() as GridView} savedExprById={props.savedExprById} onEdit={props.onEdit} onCallFunction={props.onCallFunction}
          contentFirst={props.contentFirst} tiles={props.tiles} tileFieldOrder={props.tileFieldOrder} generatedCaption={props.generatedCaption} />
      </Show>
      }>
        <TableRenderer pane={props.pane} persist={props.persist} view={view() as TableView} savedExprById={props.savedExprById} elementType={props.elementType} caption={props.home.name} onEdit={props.onEdit} onCallFunction={props.onCallFunction}
          grouping={props.groupingTable} generatedCaption={props.generatedCaption} />
      </Show>
    }>
      <ListRenderer home={props.home} persist={props.persist} view={view() as ListView} savedExprById={props.savedExprById} onEdit={props.onEdit} onCallFunction={props.onCallFunction}
        contentFirst={props.contentFirst} generatedCaption={props.generatedCaption} />
    </Show>}>
      {item => <FlowItemView item={item} savedExprById={props.savedExprById} presentation="body"
        wholeView={props.wholeView}
        onRemove={() => {}} onEdit={() => props.onEdit(item)} onCallFunction={props.onCallFunction} />}
    </Show>
  );
}

// ---------------------------------------------------------------------------
// Canvas renderer — the v1 layout. Items absolutely-positioned by their
// proportional (x, y) within the canvas, draggable to reposition.
// ---------------------------------------------------------------------------

function CanvasRenderer(props: {
  home: LocusViewRow;
  persist: (next: AnyView) => void;
  view: CanvasView;
  savedExprById: Map<string, ExprNode>;
  onEdit: (item: LayoutItem) => void;
  onCallFunction: (pin: { $pin: string; name: string; id: string }) => void;
}) {
  const { addToLocus } = useHomeReader();
  const locusAdd = useContext(HomeDataContext)?.add ?? addToLocus;
  const homeData = useContext(HomeDataContext);
  let surface: HTMLDivElement | undefined;
  const persist = (next: AnyView) => props.persist(next);

  function moveItem(id: string, x: number, y: number) {
    const next: CanvasView = {
      ...props.view,
      items: props.view.items.map((it) =>
        it.id === id ? { ...it, x: clamp01(x), y: clamp01(y) } : it,
      ),
    };
    persist(next);
  }

  function resizeItem(id: string, w: number, h: number) {
    const next: CanvasView = {
      ...props.view,
      items: props.view.items.map((it) =>
        it.id === id ? { ...it, w: clamp01(w), h: clamp01(h) } : it,
      ),
    };
    persist(next);
  }

  function removeItem(id: string) {
    const next: CanvasView = { ...props.view, items: props.view.items.filter((it) => it.id !== id) };
    persist(next);
  }

  function duplicateItem(id: string) {
    // Hand off to the home-level CreateModalContext so the user gets
    // a NewValueModal pre-filled with the source's expression (and
    // label/description, when the source is a ref). Save creates a
    // fresh saved value rather than re-pinning the same one twice.
    const ctx = useContext(CreateModalContext);
    const src = props.view.items.find((it) => it.id === id);
    if (src) ctx?.duplicateItem(src);
  }

  // Toggle the per-item expanded flag on the canvas view. Default
  // (undefined) means expanded — that way pre-existing items keep
  // showing their bodies after this lands.
  function toggleExpanded(id: string) {
    const next: CanvasView = {
      ...props.view,
      items: props.view.items.map((it) => {
        if (it.id !== id) return it;
        const cur = it.expanded !== false;
        return { ...it, expanded: !cur };
      }),
    };
    persist(next);
  }

  // Toggle the per-item "show this card's edges" flag.
  function toggleEdgesShown(id: string) {
    const next: CanvasView = {
      ...props.view,
      items: props.view.items.map((it) =>
        it.id === id ? { ...it, edgesShown: !it.edgesShown } : it,
      ),
    };
    persist(next);
  }

  // View-level master toggle for arrow visibility. Lives on the
  // view itself so it persists alongside the items.
  const masterEdgesVisible = createMemo(() => {
    const v = props.view as CanvasView & { edgesVisible?: unknown };
    return v.edgesVisible !== false;
  });
  function toggleMasterEdges() {
    const cur = masterEdgesVisible();
    const next = { ...props.view, edgesVisible: !cur } as CanvasView;
    persist(next);
  }

  function onCanvasDrop(e: DragEvent) {
    const id = e.dataTransfer?.getData("application/x-fenel-savedexpr-id");
    if (!id || !surface) return;
    e.preventDefault();
    e.stopPropagation();
    const rect = surface.getBoundingClientRect();
    const x = clamp01((e.clientX - rect.left) / rect.width);
    const y = clamp01((e.clientY - rect.top) / rect.height);
    const name = e.dataTransfer?.getData("application/x-fenel-savedexpr-name");
    void locusAdd({ savedExprId: id }, name || undefined, { x, y });
  }
  function onCanvasDragOver(e: DragEvent) {
    if (!e.dataTransfer?.types.includes("application/x-fenel-savedexpr-id")) return;
    e.preventDefault();
    e.dataTransfer.dropEffect = "copy";
  }

  type CanvasEdge = { from: string; to: string; kind: "fn-call" | "saved-ref" };
  const edges = createMemo<CanvasEdge[]>(() => {
    const items = props.view.items;
    const fnPinByFnId = new Map<string, string>();
    const savedRefByExprId = new Map<string, string>();
    for (const it of items) {
      const src = it.source;
      if (!src) continue;
      if (src.kind === "ref" && src.ref.kind === "savedExpr") {
        savedRefByExprId.set(src.ref.id, it.id);
      } else if (src.kind === "expr") {
        const projected = homeData?.evaluated(it);
        if (projected?.source?.kind === "ref" && !projected.sourcePath?.length) {
          savedRefByExprId.set(projected.source.savedExprId, it.id);
        }
        if (src.expr.kind !== "literal") continue;
        const reference = readLocusCatalogReference(src.expr.value);
        if (reference) fnPinByFnId.set(reference.id, it.id);
      }
    }
    const out: CanvasEdge[] = [];
    function walk(expr: ExprNode, fromId: string): void {
      if (expr.kind === "call") {
        const target = fnPinByFnId.get(expr.fnId);
        if (target && target !== fromId) {
          out.push({ from: fromId, to: target, kind: "fn-call" });
        }
        for (const a of expr.args) walk(a, fromId);
      }
    }
    for (const it of items) {
      const src = it.source;
      if (!src) continue;
      const projected = homeData?.evaluated(it);
      const authored = projected?.source ?? (src.kind === "expr" ? src.expr
        : { kind: "ref" as const, savedExprId: src.ref.id });
      const expression = authored.kind === "ref" ? props.savedExprById.get(authored.savedExprId) : authored;
      if (!expression) continue;
      walk(expression, it.id);
      for (const reference of listRefs(expression)) {
        const target = savedRefByExprId.get(reference);
        if (target && target !== it.id) out.push({ from: it.id, to: target, kind: "saved-ref" });
      }
    }
    return out;
  });

  // Filter edges by master + per-item toggles. Master OFF hides
  // everything. Master ON with no per-item picks shows everything.
  // Master ON with one or more items having edgesShown shows only
  // edges that touch one of those items.
  const visibleEdges = createMemo<CanvasEdge[]>(() => {
    if (!masterEdgesVisible()) return [];
    const filterIds = new Set(
      props.view.items.filter((it) => it.edgesShown).map((it) => it.id),
    );
    if (filterIds.size === 0) return edges();
    return edges().filter((e) => filterIds.has(e.from) || filterIds.has(e.to));
  });

  // Browser rectangles include minimum widths, collapsed heights and temporary
  // drag transforms. Connections follow those same rendered card boundaries.
  type CardBounds = { x: number; y: number; w: number; h: number };
  const [surfaceSize, setSurfaceSize] = createSignal({ w: 0, h: 0, cards: new Map<string, CardBounds>() });
  function measureSurface() {
    if (!surface) return;
    const r = surface.getBoundingClientRect();
    if (r.width > 0 || r.height > 0) {
      const cards = new Map<string, CardBounds>();
      for (const element of surface.children) {
        if (!(element instanceof HTMLElement) || !element.dataset.locusItem) continue;
        const card = element.getBoundingClientRect();
        cards.set(element.dataset.locusItem, { x: card.left - r.left, y: card.top - r.top, w: card.width, h: card.height });
      }
      setSurfaceSize({ w: r.width, h: r.height, cards });
    }
  }
  onSettled(() => {
    if (!surface) return;
    let frame = 0;
    const schedule = () => {
      if (frame) return;
      frame = requestAnimationFrame(() => { frame = 0; observeCards(); measureSurface(); });
    };
    const ro = new ResizeObserver(schedule);
    const observed = new Set<Element>();
    const observeCards = () => {
      for (const element of observed) {
        if (element.parentElement !== surface) { ro.unobserve(element); observed.delete(element); }
      }
      for (const element of surface!.children) {
        if (!(element instanceof HTMLElement) || !element.dataset.locusItem || observed.has(element)) continue;
        observed.add(element); ro.observe(element);
      }
    };
    ro.observe(surface);
    const changes = new MutationObserver(schedule);
    changes.observe(surface, { childList: true, subtree: true, attributes: true, attributeFilter: ["style"] });
    observeCards(); measureSurface(); schedule();
    return () => { ro.disconnect(); changes.disconnect(); cancelAnimationFrame(frame); };
  });
  // Re-measure when items change so a freshly-loaded canvas (items
  // arrived via createMemo after first paint) picks up the surface
  // size as soon as the DOM has it.
  createEffect(
    () => props.view.items.length,
    () => {
      requestAnimationFrame(measureSurface);
    },
  );

  // Selection. A card you can point at but not SELECT cannot be operated on as
  // a thing; this is the affordance every later bulk action needs, and the one
  // Rom asked for. Ctrl/Cmd or Shift extends, the bare canvas clears, Escape
  // clears, Delete unpins exactly what the per-card × already unpins.
  const [selection, setSelected] = createSignal<readonly string[]>([]);
  const selected = createMemo(() => {
    const live = new Set(props.view.items.map((item) => item.id));
    return selection().filter((id) => live.has(id));
  }, { equals: (before, after) => before.length === after.length && before.every((id, index) => id === after[index]) });
  const isSelected = (id: string) => selected().includes(id);
  function selectItem(id: string, extend: boolean) {
    if (!extend) { setSelected([id]); return; }
    setSelected(isSelected(id) ? selected().filter((x) => x !== id) : [...selected(), id]);
  }
  function onCanvasKeyDown(event: KeyboardEvent) {
    if (selected().length === 0) return;
    if (event.key === "Escape") { setSelected([]); event.preventDefault(); return; }
    if (event.key !== "Delete" && event.key !== "Backspace") return;
    if (isNativeEditingTarget(event.target)) return;
    event.preventDefault();
    const doomed = selected();
    setSelected([]);
    for (const id of doomed) removeItem(id);
  }

  let scroller: HTMLDivElement | undefined;
  return (
    /* The canvas is a fixed coordinate space — a card's x/y are FRACTIONS of it
       — so it cannot grow to reach a card that has been pushed out of it. What
       can grow is the space AROUND it: this scroller holds the canvas inset
       from the bar at the top and margined on the other three sides, so a card
       parked under the bar or hanging off an edge is always scrollable back
       into view with room to spare. The bar's own height IS that top margin,
       which is why nothing lands behind it in the first place. */
    <div
      ref={(element) => { scroller = element; }}
      class="home-canvas-scroll"
      onPointerDown={(event) => { if (event.target === scroller) setSelected([]); }}
      onDragOver={onCanvasDragOver}
      onDrop={onCanvasDrop}
    >
    <div
      ref={surface}
      class="home-canvas"
      tabindex={0}
      onKeyDown={onCanvasKeyDown}
      onPointerDown={(event) => {
        // Only a click on the bare canvas clears; a click that landed on a card
        // is that card's business.
        if (event.target === surface) setSelected([]);
      }}
      onDragOver={onCanvasDragOver}
      onDrop={onCanvasDrop}
    >
      {/* Nothing is said about a surface holding nothing. "Empty view" is a
          claim about the DATA, and an empty list is not an absence — `[]` is a
          value like any other. The bar and the right-click menu are the
          affordances; a sentence in the middle of the canvas is not. */}
      <button
        type="button"
        class="home-canvas__edges-toggle"
        onClick={(e) => { e.stopPropagation(); toggleMasterEdges(); }}
        data-tooltip={masterEdgesVisible() ? "Hide all relationship arrows" : "Show all relationship arrows"}
      >
        {masterEdgesVisible() ? "↳ Arrows on" : "↳ Arrows off"}
      </button>
      {/* The existing connection layer stays beneath the interactive cards;
          pixel coordinates keep arrowheads square at every canvas size. */}
      <Show when={surfaceSize().w > 0 && surfaceSize().h > 0 && visibleEdges().length > 0}>
        <svg
          class="home-canvas__edges"
          viewBox={`0 0 ${surfaceSize().w} ${surfaceSize().h}`}
          width={surfaceSize().w}
          height={surfaceSize().h}
        >
          <For each={visibleEdges()}>
            {(edge) => {
              const geometry = createMemo(() => {
                const sf = surfaceSize().cards.get(edge.to);
                const st = surfaceSize().cards.get(edge.from);
                if (!sf || !st) return undefined;
                const fx = sf.x + sf.w / 2, fy = sf.y + sf.h / 2;
                const tx = st.x + st.w / 2, ty = st.y + st.h / 2;
                const dx = tx - fx, dy = ty - fy;
                const len = Math.hypot(dx, dy);
                if (len === 0) return undefined;
                const start = Math.min(dx === 0 ? Infinity : sf.w / (2 * Math.abs(dx)), dy === 0 ? Infinity : sf.h / (2 * Math.abs(dy)));
                const end = Math.min(dx === 0 ? Infinity : st.w / (2 * Math.abs(dx)), dy === 0 ? Infinity : st.h / (2 * Math.abs(dy)));
                // Overlapping cards have no exposed center-line segment.
                if (start + end >= 1) return undefined;
                return { x1: fx + dx * start, y1: fy + dy * start, x2: tx - dx * end, y2: ty - dy * end,
                  ux: dx / len, uy: dy / len, head: Math.min(14, len * (1 - start - end) * 0.7) };
              });
              const stroke = edge.kind === "fn-call" ? "#64748b" : "#3b82f6";
              return <Show when={geometry()}>{value => <>
                <line x1={value().x1} y1={value().y1} x2={value().x2} y2={value().y2}
                  stroke={stroke} stroke-opacity="0.55" stroke-width="2" />
                <polygon points={`${value().x2},${value().y2} ${value().x2 - value().ux * value().head - value().uy * value().head * 0.5},${value().y2 - value().uy * value().head + value().ux * value().head * 0.5} ${value().x2 - value().ux * value().head + value().uy * value().head * 0.5},${value().y2 - value().uy * value().head - value().ux * value().head * 0.5}`}
                  fill={stroke} fill-opacity="0.85" />
              </>}</Show>;
            }}
          </For>
        </svg>
      </Show>
      <For each={props.view.items}>
        {(item) => (
          <CanvasItemView
            item={item}
            selected={isSelected(item.id)}
            onSelect={(extend) => selectItem(item.id, extend)}
            savedExprById={props.savedExprById}
            onMove={(x, y) => moveItem(item.id, x, y)}
            onResize={(w, h) => resizeItem(item.id, w, h)}
            onRemove={() => removeItem(item.id)}
            onDuplicate={() => duplicateItem(item.id)}
            onEdit={() => props.onEdit(item)}
            onToggleExpanded={() => toggleExpanded(item.id)}
            onToggleEdges={() => toggleEdgesShown(item.id)}
            onCallFunction={props.onCallFunction}
            getSurface={() => surface}
          />
        )}
      </For>
    </div>
    </div>
  );
}

/** The per-item operations every flowing layout (list, grid, table) offers:
 *  remove, duplicate, and move by one place. Each hands the whole next view to
 *  `persist`, where a data set saves it on its row and a value scope rewrites
 *  its container from the items that remain, in their new order. */
function useFlowItemOperations(props: {
  view: ListView | GridView | TableView;
  persist: (next: AnyView) => void;
}, moving?: { prepare: (items: readonly LayoutItem[]) => void }) {
  // Read at setup: a click handler runs with no owner, where useContext throws.
  const create = useContext(CreateModalContext);
  return {
    remove(id: string) {
      props.persist({ ...props.view, items: props.view.items.filter((it) => it.id !== id) });
    },
    /** Hand off to the home-level CreateModalContext so the user gets a
     *  NewValueModal pre-filled with the source's expression (and
     *  label/description, when the source is a ref). Save creates a fresh
     *  saved value rather than pinning the same one twice. */
    duplicate(id: string) {
      const src = props.view.items.find((it) => it.id === id);
      if (src) create?.duplicateItem(src);
    },
    move(id: string, delta: number) {
      const items = props.view.items.slice();
      const idx = items.findIndex((it) => it.id === id);
      if (idx < 0) return;
      const target = idx + delta;
      if (target < 0 || target >= items.length) return;
      const [it] = items.splice(idx, 1);
      items.splice(target, 0, it!);
      moving?.prepare(items);
      props.persist({ ...props.view, items });
    },
  };
}

function ListRenderer(props: {
  home: LocusViewRow;
  contentFirst?: boolean;
  generatedCaption?: (item: LayoutItem) => boolean;
  persist: (next: AnyView) => void;
  view: ListView;
  savedExprById: Map<string, ExprNode>;
  onEdit: (item: LayoutItem) => void;
  onCallFunction?: (pin: { $pin: string; name: string; id: string }) => void;
}) {
  const data = useContext(HomeDataContext);
  const motion = createFlowCardMotion(() => props.view.items,
    item => draftValueFingerprint(data?.evaluated(item)?.source ?? item.source ?? item.expr), item => typeof childItemKey(item.id) === "number");
  const ops = useFlowItemOperations(props, motion);
  return (
    <div ref={motion.attach} class="home-list" data-axis={props.view.axis === "horizontal" ? "horizontal" : "vertical"}
      data-focused={props.view.items.length === 1 && props.view.items[0]?.id === "$self" ? "true" : undefined}>
      <For each={motion.rows()} keyed={row => row.key}>
        {(row, index) => (
          <div class="home-item-row" data-flow-card-key={row().key} data-rail={props.view.axis === "horizontal" ? "horizontal" : "vertical"}>
            <ListOrderRail index={index()} count={props.view.items.length}
              direction={props.view.axis === "horizontal" ? "horizontal" : "vertical"}
              onMoveUp={() => ops.move(row().item.id, -1)} onMoveDown={() => ops.move(row().item.id, +1)} />
            <DeferredCard label={row().item.caption} later={rendersPicture(row().item, props.savedExprById, data?.session() ?? homeAuthoringSession())} render={() => <FlowItemView
              item={row().item}
              contentFirst={props.contentFirst} generatedCaption={props.generatedCaption?.(row().item)} indexed
              savedExprById={props.savedExprById}
              onRemove={() => ops.remove(row().item.id)}
              onDuplicate={() => ops.duplicate(row().item.id)}
              onEdit={() => props.onEdit(row().item)}
              onCallFunction={props.onCallFunction}
            />} />
          </div>
        )}
      </For>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Table — the view of `List a` (Rom, 2026-09-24). A record element type gives
// one column per declared field; any other element gets one column showing the
// item through the same body a card shows. Only the rows in view are drawn, so
// a list of thousands stays usable. A row header offers every action a card's
// header does (ItemHeaderActions), so choosing the table takes no item
// management away. A field cell shows its value read-only: a field is edited by
// entering the row (the one-column table shows the card body, which stays
// editable exactly as the card's is).
// ---------------------------------------------------------------------------

function TableRenderer(props: {
  pane?: WorkspacePane;
  persist: (next: AnyView) => void;
  view: TableView;
  savedExprById: Map<string, ExprNode>;
  elementType?: FenelType;
  caption: string;
  onEdit: (item: LayoutItem) => void;
  onCallFunction?: (pin: { $pin: string; name: string; id: string }) => void;
  /** A grouping's entries: the key is each row's heading, one value column. */
  grouping?: boolean;
  /** An unnamed position ("Item 3"): its row heading is the bare number. */
  generatedCaption?: (item: LayoutItem) => boolean;
}) {
  const { reader, homeAuthoringSession } = useHomeReader();
  const ops = useFlowItemOperations(props);
  const numbered = (item: LayoutItem | undefined) => !props.grouping && !!item && !!props.generatedCaption?.(item);
  const entryLayout = createMemo(() => {
    const session = homeAuthoringSession();
    // B4 wave 4 lane H: a Local reader has no page frame (a dependent field
    // type stays undecided: its declared shape) and its field labels are its
    // worker's names (`project-reader-field-names`; pending: the field's name).
    if (reader?.kind === "local") return locusTableColumns(props.elementType, {
      resolver: readerTypeResolver(session.environment, name => reader.resolveTypeName?.(name)),
      shape: (type) => transferContainerShape(type, session.environment, () => undefined),
      label: (field) => (field.key?.$tag === "NamedField" ? localFieldName(reader, session, field.key.ref.$ref)?.label : undefined) || field.name,
    });
    return locusTableColumns(props.elementType, {
      // A type the catalogue's label-deduplicated rows lack keeps its columns (Countries, Nov 12).
      resolver: readerTypeResolver(session.environment, name => session.registry.getIdentifiedEntity(name)?.type),
      shape: (type) => transferContainerShape(type, session.environment, session.evaluateContext, session.registry),
      // The label a field renders with everywhere: its identified field view
      // in this account's registry, else its declared name (as `fieldEditPlan`).
      label: (field) => {
        const view = tryResolveIdentifiedFieldView(session.registry, field);
        return view.ok ? canonical(view.value.presentation.label) || field.name : field.name;
      },
    });
  });
  // A grouping's headings name the key's and the value's types, as their
  // captions read ("Person", "List of transactions"), else "Key" and "Value".
  const headings = createMemo(() => props.grouping
    ? groupingTableHeadings(entryLayout(), type => typedReadTypeLabel(type, homeAuthoringSession(), reader)) : undefined);
  const baseLayout = createMemo(() => props.grouping ? groupingTableColumns(entryLayout(), headings()?.value) : entryLayout());
  const projection = createMemo(() => {
    const layout = baseLayout();
    // Absence retains declaration order without worker traffic.
    const identities = layout.kind === "fields" ? layout.columns.map(column => column.identity ?? column.id) : [];
    if (layout.kind !== "fields" || !props.pane?.fields?.() || !props.pane.projectFields) return { layout, order: identities };
    return props.pane.projectFields(identities)
      .then(packet => ({ layout: projectedTableColumns(layout, packet.visible), order: packet.order }));
  });
  const layout = createMemo(() => projection().layout);
  const [fieldMenu, setFieldMenu] = createSignal<{ x: number; y: number }>();
  const [fieldIssue, setFieldIssue] = createSignal<string>();
  const updateFields = (order: string[], hidden: string[]) => {
    setFieldIssue(undefined);
    void props.pane?.onFields?.({ $tag: "LensFieldPreferences", order, hidden })
      .catch(issue => setFieldIssue(issue instanceof Error ? issue.message : "Could not save table fields."));
  };
  const fieldItems = (): LocusMenuItem[] => {
    const base = baseLayout();
    if (base.kind !== "fields") return [];
    const preference = props.pane?.fields?.();
    const hidden = preference?.hidden ?? [];
    const all = projectedTableColumns(base, projection().order);
    const ordered = all.kind === "fields" ? all.columns : [];
    const ids = ordered.map(column => column.identity ?? column.id);
    return [...ordered.map((column, index): LocusMenuItem => {
      const identity = column.identity ?? column.id;
      return { id: identity, label: column.label, children: [
        { id: "visible", label: hidden.includes(identity) ? "Show field" : "Hide field", icon: hidden.includes(identity) ? "eye" : "eye-off",
          onSelect: () => updateFields(preference?.order ?? ids, hidden.includes(identity) ? hidden.filter(id => id !== identity) : [...hidden, identity]) },
        { id: "earlier", label: "Move earlier", disabled: index === 0, onSelect: () => {
          const next = [...ids]; [next[index - 1], next[index]] = [next[index]!, next[index - 1]!]; updateFields(next, hidden);
        } },
        { id: "later", label: "Move later", disabled: index === ids.length - 1, onSelect: () => {
          const next = [...ids]; [next[index], next[index + 1]] = [next[index + 1]!, next[index]!]; updateFields(next, hidden);
        } },
      ] };
    }), { id: "reset", label: "Show all in declaration order", separatorBefore: true,
      onSelect: () => { void props.pane?.onFields?.(undefined).catch(issue => setFieldIssue(String(issue))); } }];
  };
  const columns = createMemo((): VirtualTableColumn[] => {
    const current = layout();
    return [
      { id: "$item", label: props.grouping ? headings()?.key ?? "Key" : "",
        width: props.grouping ? "14rem" : props.view.items.length > 0 && props.view.items.every(numbered) ? "4.5rem" : "11rem" },
      ...(current.kind === "fields"
        ? current.columns.map((column) => ({ id: column.id, label: column.label, title: column.label }))
        : [{ id: "$value", label: "Data" }]),
    ];
  });
  return <div class="home-table">
    <Show when={props.pane?.onFields && baseLayout().kind === "fields" ? props.pane.toolbarMount() : undefined}>{mount =>
      <Portal mount={mount()}><button type="button" class="btn home-action-button" aria-label="Table fields" aria-haspopup="menu"
        aria-expanded={fieldMenu() ? "true" : "false"} onClick={event => {
          const rect = event.currentTarget.getBoundingClientRect(); setFieldMenu({ x: rect.left, y: rect.bottom + 4 });
        }}>Fields</button></Portal>}
    </Show>
    <Show when={fieldIssue()}>{issue => <p role="alert">{issue()}</p>}</Show>
    <Show when={fieldMenu()} keyed>{menu => <LocusContextMenu x={menu.x} y={menu.y} label="Table fields"
      items={fieldItems()} onClose={() => setFieldMenu(undefined)} />}</Show>
    {/* Rows are keyed on their item: a row's evaluation memo must never read
        an index the list no longer has ("Stale read from <Show>"). */}
    <VirtualTable label={`${props.caption} as a table`} columns={columns()}
      rowCount={props.view.items.length} rowKey={(index) => props.view.items[index]?.id ?? index}
      estimatedRowHeight={layout().kind === "fields" ? 44 : 96}
      renderRow={(index) => <Show when={props.view.items[index]} keyed>{(item) =>
        <TableRow item={item} savedExprById={props.savedExprById} position={numbered(item) ? index + 1 : undefined} grouping={props.grouping}
          columns={layout()} onCallFunction={props.onCallFunction}
          onRemove={() => ops.remove(item.id)}
          onDuplicate={() => ops.duplicate(item.id)}
          onEdit={() => props.onEdit(item)}
          onMoveUp={() => ops.move(item.id, -1)}
          onMoveDown={() => ops.move(item.id, +1)} />}</Show>} />
  </div>;
}

function TableRow(props: {
  item: LayoutItem;
  savedExprById: Map<string, ExprNode>;
  columns: ReturnType<typeof locusTableColumns>;
  onCallFunction?: (pin: { $pin: string; name: string; id: string }) => void;
  onRemove: () => void;
  onDuplicate: () => void;
  onEdit: () => void;
  onMoveUp: () => void;
  onMoveDown: () => void;
  /** An unnamed position: the heading is this number, not "Item N". */
  position?: number;
  /** A grouping's entry: the heading is the entry's key itself. */
  grouping?: boolean;
}) {
  // Evaluated the way a card evaluates its item (in the worker), and only for
  // rows in view. B3: never a synchronous page evaluation per row.
  const row = useRowEvaluation(props);
  const evaluated = createMemo((): { value: unknown; error?: string } => ({ value: row().result, error: row().error }));
  const fieldValue = (key: string) => {
    const value = evaluated().value;
    return value && typeof value === "object" && !Array.isArray(value)
      ? (value as Record<string, unknown>)[key] : undefined;
  };
  return <>
    <th scope="row" class={["virtual-table__row-header", { "virtual-table__row-header--position": props.position !== undefined }]}
      aria-label={props.position !== undefined ? props.item.caption : undefined}>
      {/* A grouping's row is headed by its key as the mini table draws it
          ("Rom · rom@…", a number, a date), not "Entry n" (groupedtable). */}
      <span class="virtual-table__caption">{props.grouping && groupingEntryKey(evaluated().value)
        ? <GroupingKey value={groupingEntryKey(evaluated().value)!.key} /> : props.position ?? props.item.caption ?? ""}</span>
      <span class="virtual-table__row-actions">
        <ItemHeaderActions item={props.item} value={evaluated().value}
          onRemove={props.onRemove} onDuplicate={props.onDuplicate} onEdit={props.onEdit}
          onMoveUp={props.onMoveUp} onMoveDown={props.onMoveDown} />
      </span>
    </th>
    <Show when={!evaluated().error} fallback={
      <td colspan={props.columns.kind === "fields" ? props.columns.columns.length : 1}>
        <ValueFailure message={evaluated().error} label={props.item.caption} />
      </td>
    }>
    <Show when={!row().loading} fallback={
      <td colspan={props.columns.kind === "fields" ? props.columns.columns.length : 1}><div class="virtual-table__cell"><RowPending /></div></td>
    }>
      <Show when={props.columns.kind === "fields" ? props.columns.columns : undefined} fallback={
        <td><div class="virtual-table__cell">
          <ResultBody value={evaluated().value} item={props.item} onCallFunction={props.onCallFunction}
            localReps={props.item.representations} />
        </div></td>
      }>
        {(fields) => <For each={fields()}>{(column) =>
          <td><div class="virtual-table__cell">
            <ResultBody value={fieldValue(column.id)} type={column.field.type} recordDepth={1}
              onCallFunction={props.onCallFunction} />
          </div></td>}</For>}
      </Show>
    </Show>
    </Show>
  </>;
}

// ---------------------------------------------------------------------------
// Calendar — items positioned by ISO date. Demonstrates the Layout
// typeclass extending to a temporal spatial dimension. Drag an item to
// a different day to update its date; the same shape generalises to
// Timeline (Map<Timestamp, _>) and other date-keyed layouts.
// ---------------------------------------------------------------------------

function CalendarRenderer(props: {
  home: LocusViewRow;
  persist: (next: AnyView) => void;
  view: CalendarView;
  savedExprById: Map<string, ExprNode>;
  onEdit: (item: LayoutItem) => void;
  /** A derived date grouping: items are data-owned (no drag, drop, removal,
   *  duplication or unscheduled tray) and month navigation is this
   *  renderer's own view state, never written anywhere. */
  derived?: boolean;
}) {
  const { addToLocus } = useHomeReader();
  const locusAdd = useContext(HomeDataContext)?.add ?? addToLocus;
  const persist = (next: AnyView) => { if (!props.derived) props.persist(next); };

  const today = new Date();
  // Derived mode: opened on the view's month (the earliest group), then local.
  const [shown, setShown] = createSignal<{ year: number; month: number } | undefined>(undefined);
  const year = createMemo(() => shown()?.year ?? props.view.year ?? today.getFullYear());
  const month = createMemo(() => shown()?.month ?? props.view.month ?? today.getMonth() + 1); // 1..12

  function shiftMonth(delta: number) {
    let y = year();
    let m = month() + delta;
    while (m < 1) { m += 12; y -= 1; }
    while (m > 12) { m -= 12; y += 1; }
    if (props.derived) { setShown({ year: y, month: m }); return; }
    persist({ ...props.view, year: y, month: m });
  }

  function gotoToday() {
    if (props.derived) { setShown({ year: today.getFullYear(), month: today.getMonth() + 1 }); return; }
    persist({ ...props.view, year: today.getFullYear(), month: today.getMonth() + 1 });
  }

  function setItemDate(id: string, date: string | undefined) {
    const next: CalendarView = {
      ...props.view,
      items: props.view.items.map((it) => it.id === id ? { ...it, date } : it),
    };
    persist(next);
  }

  function removeItem(id: string) {
    const next: CalendarView = { ...props.view, items: props.view.items.filter((it) => it.id !== id) };
    persist(next);
  }

  function duplicateItem(id: string) {
    // Hand off to the home-level CreateModalContext so the user gets
    // a NewValueModal pre-filled with the source's expression (and
    // label/description, when the source is a ref). Save creates a
    // fresh saved value rather than re-pinning the same one twice.
    const ctx = useContext(CreateModalContext);
    const src = props.view.items.find((it) => it.id === id);
    if (src) ctx?.duplicateItem(src);
  }

  // Build the 6×7 month grid. We pad with leading/trailing days from
  // the neighbouring months so each row has 7 cells (standard calendar
  // shape). Week starts Monday — adjust if you prefer Sunday.
  const cells = createMemo(() => {
    const y = year();
    const m = month();
    const first = new Date(y, m - 1, 1);
    const startDow = (first.getDay() + 6) % 7; // Mon = 0
    const out: { iso: string; year: number; month: number; day: number; inMonth: boolean; isToday: boolean }[] = [];
    const start = new Date(y, m - 1, 1 - startDow);
    for (let i = 0; i < 42; i++) {
      const d = new Date(start);
      d.setDate(start.getDate() + i);
      const iso = isoDate(d);
      out.push({
        iso,
        year: d.getFullYear(),
        month: d.getMonth() + 1,
        day: d.getDate(),
        inMonth: d.getMonth() + 1 === m && d.getFullYear() === y,
        isToday: iso === isoDate(today),
      });
    }
    return out;
  });

  // Bucket items by their date (ISO string). Items without a date go
  // into the "unscheduled" tray below the grid.
  const itemsByDate = createMemo(() => {
    const m = new Map<string, LayoutItem[]>();
    for (const it of props.view.items) {
      if (!it.date) continue;
      const arr = m.get(it.date) ?? [];
      arr.push(it);
      m.set(it.date, arr);
    }
    return m;
  });
  const unscheduled = createMemo(() => props.view.items.filter((it) => !it.date));

  // Drag-and-drop — items announce their id; cells accept a drop and
  // call setItemDate.
  function onItemDragStart(e: DragEvent, id: string) {
    e.dataTransfer?.setData("application/x-fenel-layout-item", id);
    e.dataTransfer?.setData("text/plain", id);
    e.dataTransfer!.effectAllowed = "move";
  }
  function onCellDragOver(e: DragEvent) {
    if (props.derived) return;
    if (isDataTransfer(e.dataTransfer)) return;
    e.preventDefault();
    if (e.dataTransfer) e.dataTransfer.dropEffect = "move";
  }
  function onCellDrop(e: DragEvent, iso: string | undefined) {
    if (props.derived) return;
    if (isDataTransfer(e.dataTransfer)) return;
    e.preventDefault();
    // Internal drag: an existing item being moved between days. The
    // payload is plain text (the item id).
    const internalId = e.dataTransfer?.getData("text/plain");
    if (internalId && props.view.items.some((it) => it.id === internalId)) {
      e.stopPropagation();
      setItemDate(internalId, iso);
      return;
    }
    // External drag-pin from the drawer: savedExprId payload.
    const externalId = e.dataTransfer?.getData("application/x-fenel-savedexpr-id");
    if (externalId) {
      e.stopPropagation();
      const name = e.dataTransfer?.getData("application/x-fenel-savedexpr-name");
      void locusAdd({ savedExprId: externalId }, name || undefined, iso ? { date: iso } : undefined);
    }
  }

  const monthName = () => new Date(year(), month() - 1, 1).toLocaleString(undefined, { month: "long", year: "numeric" });

  // Owner review (Nov 11): a day with room shows its items at the list row's
  // size; a phone-width or crowded day keeps the compact chips. The grid is
  // measured once; every cell shares its room (7 columns, 6 weeks).
  let grid: HTMLDivElement | undefined;
  const [cellRoom, setCellRoom] = createSignal<CalendarCellRoom>({ width: 0, height: 0 });
  onSettled(() => {
    const target = grid;
    if (!target || typeof ResizeObserver === "undefined") return;
    const measure = () => {
      if (!target.isConnected) return;
      const gap = parseFloat(getComputedStyle(target).rowGap) || 0;
      const next = calendarCellRoom({ gridWidth: target.clientWidth, gridHeight: target.clientHeight, gap });
      const prev = untrack(cellRoom);
      if (prev.width !== next.width || prev.height !== next.height) setCellRoom(next);
    };
    const observer = new ResizeObserver(measure);
    observer.observe(target);
    measure();
    return () => observer.disconnect();
  });
  const cellForm = (iso: string) => calendarCellForm(cellRoom(), (itemsByDate().get(iso) ?? []).length, { captioned: !props.derived });

  return (
    <div class="home-calendar">
      <div class="home-calendar__head">
        <button type="button" class="btn" style="padding: 0.2rem 0.5rem; font-size: 0.78rem" onClick={() => shiftMonth(-1)} data-tooltip="Previous month">‹</button>
        <span class="home-calendar__title">{monthName()}</span>
        <button type="button" class="btn" style="padding: 0.2rem 0.5rem; font-size: 0.78rem" onClick={() => shiftMonth(+1)} data-tooltip="Next month">›</button>
        <button type="button" class="btn" style="padding: 0.2rem 0.5rem; font-size: 0.78rem; margin-left: 0.5rem" onClick={gotoToday}>Today</button>
        <Show when={!props.derived}>
          <span class="text-muted" style="font-size: 0.72rem; margin-left: auto">drag items between days · pin defaults to today</span>
        </Show>
      </div>

      <div class="home-calendar__weekdays">
        <For each={["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"]}>
          {(d) => <div class="home-calendar__weekday">{d}</div>}
        </For>
      </div>

      <div class="home-calendar__grid" ref={grid}>
        <For each={cells()}>
          {(cell) => (
            <div
              class={`home-calendar__cell ${cell.inMonth ? "" : "home-calendar__cell--out"} ${cell.isToday ? "home-calendar__cell--today" : ""}`}
              data-home-date={cell.iso}
              data-cell-form={cellForm(cell.iso)}
              aria-current={cell.isToday ? "date" : undefined}
              onDragOver={onCellDragOver}
              onDrop={(e) => onCellDrop(e, cell.iso)}
            >
              <div class="home-calendar__day-num">{cell.day}</div>
              <div class="home-calendar__day-items">
                <For each={itemsByDate().get(cell.iso) ?? []}>
                  {(item) => (
                    <CalendarItemView
                      item={item}
                      derived={props.derived}
                      savedExprById={props.savedExprById}
                      onEdit={() => props.onEdit(item)}
                      onRemove={() => removeItem(item.id)}
                      onDuplicate={() => duplicateItem(item.id)}
                      onDragStart={(e) => onItemDragStart(e, item.id)}
                    />
                  )}
                </For>
              </div>
            </div>
          )}
        </For>
      </div>

      <Show when={!props.derived && unscheduled().length > 0}>
        <div class="home-calendar__tray">
          <div
            class="home-calendar__tray-label"
            onDragOver={onCellDragOver}
            onDrop={(e) => onCellDrop(e, undefined)}
          >Unscheduled (drop here to remove date):</div>
          <div class="home-calendar__tray-items">
            <For each={unscheduled()}>
              {(item) => (
                <CalendarItemView
                  item={item}
                  savedExprById={props.savedExprById}
                  onEdit={() => props.onEdit(item)}
                  onRemove={() => removeItem(item.id)}
                  onDuplicate={() => duplicateItem(item.id)}
                  onDragStart={(e) => onItemDragStart(e, item.id)}
                />
              )}
            </For>
          </div>
        </div>
      </Show>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Chart of a numeric grouping (a count or a sum per key): the existing bar
// chart lens over the Fenel projection's bars (label = the key's caption).
// ---------------------------------------------------------------------------

function GroupingChartRenderer(props: { view: ChartView }) {
  const data = createMemo(() => (props.view.bars ?? []).map(bar => ({ label: bar.label, value: bar.value })));
  return <div class="home-grouping-chart" data-grouping-chart="bars"><BarChart data={data()} height={320} /></div>;
}

/** Keep failures at the affected data, with full details behind the shared card. */
function ValueFailure(props: { message: string | undefined; label?: string; retry?: () => void }) {
  const data = useContext(HomeDataContext);
  return <Show when={props.message && data?.referencesReady() !== false}>
    <LocusLoadFailure message={props.label ? `Could not show ${props.label}.` : "Could not show data."}
      detail={props.message} retry={props.retry} />
  </Show>;
}

function CalendarItemView(props: {
  item: LayoutItem;
  /** Data-owned placement: not draggable, no edit/duplicate/remove controls. */
  derived?: boolean;
  savedExprById: Map<string, ExprNode>;
  onEdit: () => void;
  onRemove: () => void;
  onDuplicate: () => void;
  onDragStart: (e: DragEvent) => void;
}) {
  // B3: evaluated in the worker like a card, never synchronously on the page.
  const row = useRowEvaluation(props);
  const evaluated = createMemo(() => ({ result: row().result, error: row().error }));
  return (
    <div
      class="home-calendar__item"
      data-locus-item={props.item.id}
      draggable={props.derived ? "false" : "true"}
      onDragStart={(e) => { if (props.derived) { e.preventDefault(); return; } props.onDragStart(e); }}
      data-tooltip={props.derived ? undefined : props.item.caption ?? ""}
    >
      {/* Polish lane 2 (Nov 9): a derived date group sits in its own day; its
          caption is that date as ISO text ("2026-11-03"), so it is not shown. */}
      <Show when={!props.derived}>
      <div class="home-calendar__item-head">
        <span class="home-calendar__item-caption">{props.item.caption ?? "(item)"}</span>
        <Show when={!props.derived}>
          <button type="button" class="home-item__btn" onClick={(e) => { e.stopPropagation(); props.onEdit(); }} data-tooltip="Edit">✎</button>
          <button type="button" class="home-item__btn" onClick={(e) => { e.stopPropagation(); props.onDuplicate(); }} data-tooltip="Duplicate">⎘</button>
          <button type="button" class="home-item__remove" onClick={(e) => { e.stopPropagation(); props.onRemove(); }} data-tooltip="Remove">×</button>
        </Show>
      </div>
      </Show>
      <Show when={(evaluated() as any).error}>
        <ValueFailure message={evaluated().error} label={props.item.caption} />
      </Show>
      <Show when={!(evaluated() as any).error}>
        <div class="home-calendar__item-body">
          <Show when={!row().loading} fallback={<RowPending />}>
            <ResultBody value={evaluated().result} item={props.item} localReps={props.item.representations} />
          </Show>
        </div>
      </Show>
    </div>
  );
}

function isoDate(d: Date): string {
  const yyyy = d.getFullYear();
  const mm = String(d.getMonth() + 1).padStart(2, "0");
  const dd = String(d.getDate()).padStart(2, "0");
  return `${yyyy}-${mm}-${dd}`;
}

// ---------------------------------------------------------------------------
// Timeline — items along a horizontal axis by millisecond timestamp.
// Range computed from items if not specified; renderer projects each
// item to a proportional x position. Drag horizontally to update ts.
// ---------------------------------------------------------------------------

function TimelineRenderer(props: {
  home: LocusViewRow;
  persist: (next: AnyView) => void;
  view: TimelineView;
  savedExprById: Map<string, ExprNode>;
  onEdit: (item: LayoutItem) => void;
}) {
  const persist = (next: AnyView) => props.persist(next);
  let surface: HTMLDivElement | undefined;

  // Default range: 30-day window centred on today, unless items pull it
  // wider (the bounds expand to fit). Manual `from`/`to` always win.
  const range = createMemo(() => {
    const stamps = props.view.items.map((it) => it.ts).filter((t): t is number => typeof t === "number");
    const now = Date.now();
    let from = props.view.from;
    let to = props.view.to;
    if (typeof from !== "number" || typeof to !== "number") {
      if (stamps.length > 0) {
        const lo = Math.min(...stamps);
        const hi = Math.max(...stamps);
        const pad = Math.max((hi - lo) * 0.1, 1000 * 60 * 60 * 24);
        from = lo - pad;
        to = hi + pad;
      } else {
        from = now - 1000 * 60 * 60 * 24 * 15;
        to = now + 1000 * 60 * 60 * 24 * 15;
      }
    }
    if (to <= from) to = from + 1000 * 60 * 60 * 24;
    return { from: from!, to: to! };
  });

  function setTs(id: string, ts: number) {
    const next: TimelineView = {
      ...props.view,
      items: props.view.items.map((it) => it.id === id ? { ...it, ts } : it),
    };
    persist(next);
  }

  function removeItem(id: string) {
    const next: TimelineView = { ...props.view, items: props.view.items.filter((it) => it.id !== id) };
    persist(next);
  }

  function duplicateItem(id: string) {
    // Hand off to the home-level CreateModalContext so the user gets
    // a NewValueModal pre-filled with the source's expression (and
    // label/description, when the source is a ref). Save creates a
    // fresh saved value rather than re-pinning the same one twice.
    const ctx = useContext(CreateModalContext);
    const src = props.view.items.find((it) => it.id === id);
    if (src) ctx?.duplicateItem(src);
  }

  // Drag — pointer-driven horizontal repositioning.
  let dragId: string | null = null;
  let dragPointerId: number = 0;
  function onPointerDown(e: PointerEvent, id: string) {
    if (e.button !== 0) return;
    if ((e.target as HTMLElement).closest(".home-item__remove")) return;
    if ((e.target as HTMLElement).closest(".home-item__btn")) return;
    dragId = id;
    dragPointerId = e.pointerId;
    (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
    e.preventDefault();
  }
  function onPointerMove(e: PointerEvent) {
    if (!dragId || !surface) return;
    const rect = surface.getBoundingClientRect();
    const t = (e.clientX - rect.left) / rect.width;
    const r = range();
    const ts = Math.round(r.from + Math.max(0, Math.min(1, t)) * (r.to - r.from));
    setTs(dragId, ts);
  }
  function onPointerUp(e: PointerEvent) {
    if (!dragId) return;
    (e.currentTarget as HTMLElement).releasePointerCapture(dragPointerId);
    dragId = null;
  }

  // Build a handful of axis tick marks (~6 evenly across the range).
  const ticks = createMemo(() => {
    const r = range();
    const n = 6;
    const out: { t: number; label: string; pct: number }[] = [];
    for (let i = 0; i <= n; i++) {
      const t = r.from + (i * (r.to - r.from)) / n;
      out.push({
        t,
        label: new Date(t).toLocaleDateString(undefined, { month: "short", day: "numeric" }),
        pct: (i * 100) / n,
      });
    }
    return out;
  });

  return (
    <div class="home-timeline">
      <div class="home-timeline__head">
        <span class="text-muted" style="font-size: 0.78rem">
          {new Date(range().from).toLocaleDateString()} → {new Date(range().to).toLocaleDateString()} · drag items horizontally to change time
        </span>
      </div>

      <div ref={surface} class="home-timeline__track">
        <div class="home-timeline__axis">
          <For each={ticks()}>
            {(tick) => (
              <div class="home-timeline__tick" style={`left: ${tick.pct.toFixed(2)}%`}>
                <div class="home-timeline__tick-line" />
                <div class="home-timeline__tick-label">{tick.label}</div>
              </div>
            )}
          </For>
        </div>

        <For each={props.view.items}>
          {(item) => {
            const r = range();
            const ts = typeof item.ts === "number" ? item.ts : (r.from + r.to) / 2;
            const pct = ((ts - r.from) / (r.to - r.from)) * 100;
            return (
              <div
                class="home-timeline__item"
                data-locus-item={item.id}
                style={`left: ${Math.max(0, Math.min(100, pct)).toFixed(3)}%`}
                onPointerDown={(e) => onPointerDown(e, item.id)}
                onPointerMove={onPointerMove}
                onPointerUp={onPointerUp}
                onPointerCancel={onPointerUp}
              >
                <div class="home-timeline__item-head">
                  <span class="home-timeline__item-caption">{item.caption ?? ""}</span>
                  <button type="button" class="home-item__btn" onClick={(e) => { e.stopPropagation(); props.onEdit(item); }} data-tooltip="Edit">✎</button>
                  <button type="button" class="home-item__btn" onClick={(e) => { e.stopPropagation(); duplicateItem(item.id); }} data-tooltip="Duplicate">⎘</button>
                  <button type="button" class="home-item__remove" onClick={(e) => { e.stopPropagation(); removeItem(item.id); }} data-tooltip="Remove">×</button>
                </div>
                <div class="home-timeline__item-ts mono">
                  {new Date(ts).toLocaleString(undefined, { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" })}
                </div>
                <TimelineItemBody item={item} savedExprById={props.savedExprById} />
              </div>
            );
          }}
        </For>
      </div>
    </div>
  );
}

function TimelineItemBody(props: { item: LayoutItem; savedExprById: Map<string, ExprNode> }) {
  // B3: evaluated in the worker like a card, never synchronously on the page.
  const row = useRowEvaluation(props);
  const evaluated = createMemo(() => ({ result: row().result, error: row().error }));
  return (
    <div class="home-timeline__item-body">
      <Show when={(evaluated() as any).error}>
        <ValueFailure message={evaluated().error} label={props.item.caption} />
      </Show>
      <Show when={!(evaluated() as any).error}>
        <Show when={!row().loading} fallback={<RowPending />}>
          <ResultBody value={evaluated().result} item={props.item} localReps={props.item.representations} />
        </Show>
      </Show>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Map — items at lat/lng on a real geographic map. Uses MapLibre GL
// (already a dep) with OpenStreetMap raster tiles. Markers are
// draggable; drag-end writes new lat/lng to the underlying item.
// ---------------------------------------------------------------------------

function MapRenderer(props: {
  home: LocusViewRow;
  persist: (next: AnyView) => void;
  view: MapView;
  savedExprById: Map<string, ExprNode>;
  onEdit: (item: LayoutItem) => void;
}) {
  const { addToLocus } = useHomeReader();
  const locusAdd = useContext(HomeDataContext)?.add ?? addToLocus;
  const persist = (next: AnyView) => props.persist(next);
  let containerEl: HTMLDivElement | undefined;
  let map: any = null; // maplibregl.Map — lazy-loaded
  let markers: Map<string, any> = new Map();
  const [error, setError] = createSignal<string | null>(null);

  function setLatLng(id: string, lat: number, lng: number) {
    const next: MapView = {
      ...props.view,
      items: props.view.items.map((it) => it.id === id ? { ...it, lat, lng } : it),
    };
    persist(next);
  }

  function removeItem(id: string) {
    const next: MapView = { ...props.view, items: props.view.items.filter((it) => it.id !== id) };
    persist(next);
  }

  function duplicateItem(id: string) {
    // Hand off to the home-level CreateModalContext so the user gets
    // a NewValueModal pre-filled with the source's expression (and
    // label/description, when the source is a ref). Save creates a
    // fresh saved value rather than re-pinning the same one twice.
    const ctx = useContext(CreateModalContext);
    const src = props.view.items.find((it) => it.id === id);
    if (src) ctx?.duplicateItem(src);
  }

  // Default centre + zoom: average of items if any, else Greenwich.
  function computeCenter(): [number, number] {
    const explicit = props.view.center;
    if (explicit) return [explicit.lng, explicit.lat];
    const withCoords = props.view.items.filter((it) => typeof it.lat === "number" && typeof it.lng === "number");
    if (withCoords.length === 0) return [0.0015, 51.4779];
    const lat = withCoords.reduce((s, it) => s + (it.lat ?? 0), 0) / withCoords.length;
    const lng = withCoords.reduce((s, it) => s + (it.lng ?? 0), 0) / withCoords.length;
    return [lng, lat];
  }

  const [mapModule, setMapModule] = createSignal<any>(undefined);

  // Re-sync markers whenever the item set changes, once the map module is up.
  createEffect(
    () => ({
      gl: mapModule(),
      items: props.view.items.map((it) => [it.id, it.lat, it.lng, it.caption] as const),
    }),
    ({ gl }) => {
      if (gl) syncMarkers(gl);
    },
  );

  onSettled(() => { void (async () => {
    if (!containerEl) return;
    try {
      const maplibregl = (await import("maplibre-gl")).default;
      // Load the matching package stylesheet only when the map is used.
      await import("maplibre-gl/dist/maplibre-gl.css");
      map = new maplibregl.Map({
        container: containerEl,
        style: {
          version: 8,
          sources: {
            osm: {
              type: "raster",
              tiles: [
                "https://a.tile.openstreetmap.org/{z}/{x}/{y}.png",
                "https://b.tile.openstreetmap.org/{z}/{x}/{y}.png",
                "https://c.tile.openstreetmap.org/{z}/{x}/{y}.png",
              ],
              tileSize: 256,
              attribution: "© OpenStreetMap contributors",
            },
          },
          layers: [{ id: "osm", type: "raster", source: "osm" }],
        },
        center: computeCenter(),
        zoom: props.view.zoom ?? 9,
      });
      // Initial markers
      syncMarkers(maplibregl);
      // Publishing the module lets the re-sync effect below run at component
      // scope: Solid 2 forbids creating primitives inside onSettled, and an
      // effect created after an await was never owned by this scope anyway.
      setMapModule(() => maplibregl);
    } catch (e: any) {
      setError(e?.message ?? String(e));
    }
  })(); });

  onCleanup(() => {
    for (const m of markers.values()) m.remove?.();
    markers.clear();
    if (map) map.remove();
  });

  function syncMarkers(maplibregl: any) {
    if (!map) return;
    const present = new Set<string>();
    for (const item of props.view.items) {
      if (typeof item.lat !== "number" || typeof item.lng !== "number") continue;
      present.add(item.id);
      let mk = markers.get(item.id);
      if (!mk) {
        const el = document.createElement("div");
        el.className = "home-map__marker";
        el.title = item.caption ?? "";
        el.textContent = "📍";
        mk = new maplibregl.Marker({ element: el, draggable: true })
          .setLngLat([item.lng, item.lat])
          .addTo(map);
        mk.on("dragend", () => {
          const ll = mk.getLngLat();
          setLatLng(item.id, ll.lat, ll.lng);
        });
        markers.set(item.id, mk);
      } else {
        mk.setLngLat([item.lng, item.lat]);
        const el = mk.getElement();
        if (el && item.caption) el.title = item.caption;
      }
    }
    // Remove markers whose items disappeared
    for (const [id, mk] of markers) {
      if (!present.has(id)) {
        mk.remove();
        markers.delete(id);
      }
    }
  }

  return (
    <div class="home-map">
      <div class="home-map__head">
        <span class="text-muted" style="font-size: 0.78rem">
          drag markers to update lat/lng · {props.view.items.length} pin{props.view.items.length === 1 ? "" : "s"}
        </span>
      </div>
      <Show when={error()}>
        <div class="data-error">Map failed to load: {error()}</div>
      </Show>
      <div
        ref={containerEl}
        class="home-map__container"
        onDragOver={(e) => {
          if (!e.dataTransfer?.types.includes("application/x-fenel-savedexpr-id")) return;
          e.preventDefault();
          e.dataTransfer.dropEffect = "copy";
        }}
        onDrop={(e) => {
          const id = e.dataTransfer?.getData("application/x-fenel-savedexpr-id");
          if (!id || !map || !containerEl) return;
          e.preventDefault();
          e.stopPropagation();
          const rect = containerEl.getBoundingClientRect();
          const point: [number, number] = [e.clientX - rect.left, e.clientY - rect.top];
          const ll = map.unproject(point);
          const name = e.dataTransfer?.getData("application/x-fenel-savedexpr-name");
          void locusAdd({ savedExprId: id }, name || undefined, { lat: ll.lat, lng: ll.lng });
        }}
      />
      <div class="home-map__items">
        <For each={props.view.items}>
          {(item) => (
            <div class="home-map__item-row" data-locus-item={item.id}>
              <span class="home-map__item-caption">{item.caption ?? "(item)"}</span>
              <span class="text-muted mono" style="font-size: 0.7rem">
                {typeof item.lat === "number" ? item.lat.toFixed(4) : "—"}, {typeof item.lng === "number" ? item.lng.toFixed(4) : "—"}
              </span>
              <button type="button" class="home-item__btn" onClick={() => props.onEdit(item)} data-tooltip="Edit">✎</button>
              <button type="button" class="home-item__btn" onClick={() => duplicateItem(item.id)} data-tooltip="Duplicate">⎘</button>
              <button type="button" class="home-item__remove" onClick={() => removeItem(item.id)} data-tooltip="Remove">×</button>
            </div>
          )}
        </For>
      </div>
    </div>
  );
}

function TabsRenderer(props: {
  home: LocusViewRow;
  persist: (next: AnyView) => void;
  view: TabsView;
  savedExprById: Map<string, ExprNode>;
  onEdit: (item: LayoutItem) => void;
  onCallFunction?: (pin: { $pin: string; name: string; id: string }) => void;
}) {
  const persist = (next: AnyView) => props.persist(next);

  const activeId = createMemo(() => {
    const id = props.view.activeId;
    if (id && props.view.items.some((it) => it.id === id)) return id;
    return props.view.items[0]?.id ?? null;
  });

  function setActive(id: string) {
    const next: TabsView = { ...props.view, activeId: id };
    persist(next);
  }

  function removeItem(id: string) {
    const items = props.view.items.filter((it) => it.id !== id);
    const next: TabsView = {
      ...props.view,
      items,
      activeId: props.view.activeId === id ? items[0]?.id : props.view.activeId,
    };
    persist(next);
  }

  function duplicateItem(id: string) {
    // Hand off to the home-level CreateModalContext so the user gets
    // a NewValueModal pre-filled with the source's expression (and
    // label/description, when the source is a ref). Save creates a
    // fresh saved value rather than re-pinning the same one twice.
    const ctx = useContext(CreateModalContext);
    const src = props.view.items.find((it) => it.id === id);
    if (src) ctx?.duplicateItem(src);
  }

  const activeItem = createMemo(() => props.view.items.find((it) => it.id === activeId()));

  return (
    <div class="home-tabs">
      <Show when={props.view.items.length > 0}>
        <div class="home-tabs__strip">
          <For each={props.view.items}>
            {(item, i) => (
              <button
                type="button"
                class={`home-tabs__tab ${activeId() === item.id ? "home-tabs__tab--active" : ""}`}
                data-locus-item={item.id}
                onClick={() => setActive(item.id)}
                data-tooltip={item.caption ?? `Tab ${i() + 1}`}
              >
                <span class="home-tabs__tab-label">{item.caption ?? `Tab ${i() + 1}`}</span>
                <span
                  class="home-item__remove"
                  onClick={(e) => { e.stopPropagation(); removeItem(item.id); }}
                  data-tooltip="Remove tab"
                  role="button"
                >×</span>
              </button>
            )}
          </For>
        </div>
        <Show when={activeItem()}>
          {(item) => (
            <FlowItemView
              item={item()}
              savedExprById={props.savedExprById}
              onRemove={() => removeItem(item().id)}
              onDuplicate={() => duplicateItem(item().id)}
              onEdit={() => props.onEdit(item())}
              onCallFunction={props.onCallFunction}
            />
          )}
        </Show>
      </Show>
    </div>
  );
}

function TreeRenderer(props: {
  home: LocusViewRow;
  persist: (next: AnyView) => void;
  view: TreeView;
  savedExprById: Map<string, ExprNode>;
  onEdit: (item: LayoutItem) => void;
}) {
  const persist = (next: AnyView) => props.persist(next);

  function updateItems(transform: (items: TreeItem[]) => TreeItem[]) {
    const next: TreeView = { ...props.view, items: transform(props.view.items) };
    persist(next);
  }

  // Walk the tree by id, applying `mapper` to the matched node. Removal
  // returns null and the parent drops it.
  function mapTree(items: TreeItem[], id: string, mapper: (it: TreeItem) => TreeItem | null): TreeItem[] {
    const out: TreeItem[] = [];
    for (const it of items) {
      if (it.id === id) {
        const m = mapper(it);
        if (m !== null) out.push(m);
      } else if (it.children?.length) {
        out.push({ ...it, children: mapTree(it.children, id, mapper) });
      } else {
        out.push(it);
      }
    }
    return out;
  }

  /** Walk the tree to find an id and report (parent-array, index, item).
   *  Returns null when the id isn't found. The parent-array is the
   *  *array reference* so callers can splice in new positions. */
  function findInTree(
    items: TreeItem[],
    id: string,
    parentChain: TreeItem[] = [],
  ): { parent: TreeItem[]; index: number; item: TreeItem; ancestors: TreeItem[] } | null {
    for (let i = 0; i < items.length; i++) {
      const it = items[i]!;
      if (it.id === id) return { parent: items, index: i, item: it, ancestors: parentChain };
      if (it.children?.length) {
        const sub = findInTree(it.children, id, [...parentChain, it]);
        if (sub) return sub;
      }
    }
    return null;
  }

  /** Rebuild the tree by applying a structural transformation. We
   *  serialize → mutate a deep clone → return. Cheap given typical
   *  tree sizes. */
  function withTreeMutation(transform: (items: TreeItem[]) => void): TreeItem[] {
    const cloned = cloneDraftValue(props.view.items) as TreeItem[];
    transform(cloned);
    return cloned;
  }

  function toggleCollapsed(id: string) {
    updateItems((items) => mapTree(items, id, (it) => ({ ...it, collapsed: !it.collapsed })));
  }
  function removeNode(id: string) {
    updateItems((items) => mapTree(items, id, () => null));
  }

  /** Move sibling up or down within the parent array. */
  function moveNode(id: string, delta: -1 | 1) {
    const next = withTreeMutation((items) => {
      const found = findInTree(items, id);
      if (!found) return;
      const { parent, index } = found;
      const target = index + delta;
      if (target < 0 || target >= parent.length) return;
      const [it] = parent.splice(index, 1);
      parent.splice(target, 0, it!);
    });
    updateItems(() => next);
  }

  /** Indent — make this node a child of the previous sibling. No-op if
   *  the node is the first sibling (nothing to indent into). */
  function indentNode(id: string) {
    const next = withTreeMutation((items) => {
      const found = findInTree(items, id);
      if (!found) return;
      const { parent, index } = found;
      if (index === 0) return;
      const prev = parent[index - 1]!;
      const [it] = parent.splice(index, 1);
      prev.children = prev.children ?? [];
      prev.children.push(it!);
      prev.collapsed = false;
    });
    updateItems(() => next);
  }

  /** Outdent — move this node out of its parent into the grandparent's
   *  children, just after the parent. No-op at root level. */
  function outdentNode(id: string) {
    const next = withTreeMutation((items) => {
      const found = findInTree(items, id);
      if (!found || found.ancestors.length === 0) return;
      const { item, ancestors } = found;
      const parent = ancestors[ancestors.length - 1]!;
      const grandparent = ancestors.length > 1 ? ancestors[ancestors.length - 2]!.children! : items;
      // Remove from parent
      const inParent = parent.children!.findIndex((c) => c.id === id);
      if (inParent < 0) return;
      parent.children!.splice(inParent, 1);
      if (parent.children!.length === 0) delete parent.children;
      // Insert after parent in grandparent
      const parentIdx = grandparent.findIndex((c: TreeItem) => c.id === parent.id);
      grandparent.splice(parentIdx + 1, 0, item);
    });
    updateItems(() => next);
  }

  return (
    <div class="home-tree">
      <For each={props.view.items}>
        {(item) => (
          <TreeNodeView
            item={item}
            depth={0}
            savedExprById={props.savedExprById}
            onToggle={toggleCollapsed}
            onRemove={removeNode}
            onEdit={(it) => props.onEdit(it)}
            onMove={moveNode}
            onIndent={indentNode}
            onOutdent={outdentNode}
          />
        )}
      </For>
    </div>
  );
}

function TreeNodeView(props: {
  item: TreeItem;
  depth: number;
  savedExprById: Map<string, ExprNode>;
  onToggle: (id: string) => void;
  onRemove: (id: string) => void;
  onEdit: (item: LayoutItem) => void;
  onMove: (id: string, delta: -1 | 1) => void;
  onIndent: (id: string) => void;
  onOutdent: (id: string) => void;
}) {
  const { addToLocus } = useHomeReader();
  const nestData = useContext(HomeDataContext);
  const locusAdd = nestData?.add ?? addToLocus;
  function onNodeDrop(e: DragEvent) {
    const id = e.dataTransfer?.getData("application/x-fenel-savedexpr-id");
    if (!id) return;
    e.preventDefault();
    e.stopPropagation();
    const name = e.dataTransfer?.getData("application/x-fenel-savedexpr-name");
    void locusAdd({ savedExprId: id }, name || undefined, { parentId: props.item.id });
  }
  function onNodeDragOver(e: DragEvent) {
    if (!e.dataTransfer?.types.includes("application/x-fenel-savedexpr-id")) return;
    e.preventDefault();
    e.dataTransfer.dropEffect = "copy";
  }
  // B3: evaluated in the worker like a card, never synchronously on the page.
  const row = useRowEvaluation(props);
  const evaluated = createMemo(() => ({ result: row().result, error: row().error }));
  const hasChildren = () => Array.isArray(props.item.children) && props.item.children!.length > 0;
  const isCollapsed = () => !!props.item.collapsed;
  return (
    <>
      <div
        class="home-tree__node"
        data-locus-item={props.item.id}
        data-home-parent={props.item.id}
        style={`padding-left: ${0.5 + props.depth * 1.25}rem`}
        onDragOver={onNodeDragOver}
        onDrop={onNodeDrop}
      >
        <button
          type="button"
          class="home-tree__toggle"
          onClick={() => hasChildren() && props.onToggle(props.item.id)}
          aria-label="Toggle children"
          data-tooltip={hasChildren() ? (isCollapsed() ? "Expand" : "Collapse") : ""}
          style={hasChildren() ? "" : "visibility: hidden"}
        >
          {isCollapsed() ? "▸" : "▾"}
        </button>
        <div class="home-tree__caption">{props.item.caption ?? ""}</div>
        <div class="home-tree__body">
          <Show when={(evaluated() as any).error}>
            <ValueFailure message={evaluated().error} label={props.item.caption} />
          </Show>
          <Show when={!(evaluated() as any).error}>
            <Show when={!row().loading} fallback={<RowPending />}>
              <ResultBody value={evaluated().result} item={props.item} localReps={props.item.representations} />
            </Show>
          </Show>
        </div>
        <button
          type="button"
          class="home-item__btn"
          onClick={(e) => { e.stopPropagation(); props.onMove(props.item.id, -1); }}
          data-tooltip="Move up"
        >▲</button>
        <button
          type="button"
          class="home-item__btn"
          onClick={(e) => { e.stopPropagation(); props.onMove(props.item.id, +1); }}
          data-tooltip="Move down"
        >▼</button>
        <Show when={nestData?.canNest() !== false}>
          <button
            type="button"
            class="home-item__btn"
            onClick={(e) => { e.stopPropagation(); props.onOutdent(props.item.id); }}
            data-tooltip="Outdent (promote out of parent)"
            disabled={props.depth === 0}
          >↤</button>
          <button
            type="button"
            class="home-item__btn"
            onClick={(e) => { e.stopPropagation(); props.onIndent(props.item.id); }}
            data-tooltip="Indent (nest under previous sibling)"
          >↦</button>
        </Show>
        <button
          type="button"
          class="home-item__btn"
          onClick={(e) => { e.stopPropagation(); props.onEdit(props.item); }}
          data-tooltip="Edit"
        >✎</button>
        <button
          type="button"
          class="home-item__remove"
          onClick={(e) => { e.stopPropagation(); props.onRemove(props.item.id); }}
          data-tooltip="Remove"
        >×</button>
      </div>
      <Show when={hasChildren() && !isCollapsed()}>
        <For each={props.item.children!}>
          {(child) => (
            <TreeNodeView
              item={child}
              depth={props.depth + 1}
              savedExprById={props.savedExprById}
              onToggle={props.onToggle}
              onRemove={props.onRemove}
              onEdit={props.onEdit}
              onMove={props.onMove}
              onIndent={props.onIndent}
              onOutdent={props.onOutdent}
            />
          )}
        </For>
      </Show>
    </>
  );
}

function GridRenderer(props: {
  home: LocusViewRow;
  contentFirst?: boolean;
  /** Draw each item as a key-like tile (list-tile.tsx) instead of its card. */
  tiles?: boolean;
  /** The items' declared field order (their Table's columns). */
  tileFieldOrder?: readonly string[];
  generatedCaption?: (item: LayoutItem) => boolean;
  persist: (next: AnyView) => void;
  view: GridView;
  savedExprById: Map<string, ExprNode>;
  onEdit: (item: LayoutItem) => void;
  onCallFunction?: (pin: { $pin: string; name: string; id: string }) => void;
}) {
  const data = useContext(HomeDataContext);
  const motion = createFlowCardMotion(() => props.view.items,
    item => draftValueFingerprint(data?.evaluated(item)?.source ?? item.source ?? item.expr), item => typeof childItemKey(item.id) === "number");
  const ops = useFlowItemOperations(props, motion);
  const cols = () => props.view.cols ?? 4;
  const tiles = () => !!props.tiles && !data?.desktop();
  return (
    <>
      <div ref={motion.attach} class={["home-grid", { "home-grid--desktop": !!data?.desktop(), "home-grid--content-first": !!props.contentFirst && !data?.desktop() && !tiles(),
        "home-grid--tiles": tiles() }]} style={{ "--home-grid-columns": cols(), "--home-grid-items": Math.max(1, props.view.items.length) }}>
        <For each={motion.rows()} keyed={row => row.key}>
          {(row, index) => (
            <div class="home-item-row" data-flow-card-key={row().key} data-rail="vertical">
              {/* A tile is the same data as its card: the circle's thumbnail,
                  enlarged, with the card's open, menu and hover preview. */}
              <Show when={tiles()} fallback={<>
              <ListOrderRail index={index()} count={props.view.items.length} direction="vertical"
                onMoveUp={() => ops.move(row().item.id, -1)} onMoveDown={() => ops.move(row().item.id, +1)} />
              <DeferredCard label={row().item.caption} later={rendersPicture(row().item, props.savedExprById, data?.session() ?? homeAuthoringSession())} render={() => <FlowItemView
                item={row().item}
                contentFirst={props.contentFirst} generatedCaption={props.generatedCaption?.(row().item)} indexed={!data?.desktop()}
                savedExprById={props.savedExprById}
                onRemove={() => ops.remove(row().item.id)}
                onDuplicate={() => ops.duplicate(row().item.id)}
                onEdit={() => props.onEdit(row().item)}
                onCallFunction={props.onCallFunction}
              />} /></>}>
                <ListTile itemId={row().item.id} value={data?.evaluated(row().item)?.value}
                  caption={props.generatedCaption?.(row().item) ? undefined : row().item.caption} fieldOrder={props.tileFieldOrder}
                  label={row().item.caption || "Data"} menuOpen={data?.menuOpen(row().item.id)}
                  preview={() => <EvaluatedFlowItemView item={row().item} savedExprById={props.savedExprById} onRemove={() => {}} preview />}
                  onOpen={data ? () => data.enter(row().item, data.evaluated(row().item)) : undefined}
                  onContextMenu={event => data?.openMenu(event)}>
                  <ListItemPreview item={row().item} savedExprById={props.savedExprById} />
                </ListTile>
              </Show>
            </div>
          )}
        </For>
      </div>
    </>
  );
}

// ---------------------------------------------------------------------------
// Shared IO-call surface — the affordance that gives any item card the
// Run / Stop / suspended-prompt / "operations on result" UX. Used by
// FlowItemView (every non-canvas view) and — once the canvas item view
// gets refactored — by CanvasItemView too. CanvasItemView currently
// keeps a near-identical inline copy of the same state machine; that
// duplication is tagged TODO and will collapse onto this hook in a
// follow-up commit. The render fragments below cover the bits both
// views agree on (status badge / action buttons / result panel / ops
// card).
// ---------------------------------------------------------------------------

function useIOCallSurface(props: {
  item: LayoutItem;
  savedExprById: Map<string, ExprNode>;
  preview?: boolean;
  evaluated?: { value: unknown };
}) {
  const { reader, api, evaluateAuthoringExpression, homeAuthoringSession, allCatalogFns, catalogCardOf, catalogReferenceType, getLabel, displayLabel, getCodeName, getIOAction, getStopAction } = useHomeReader();
  const data = useContext(HomeDataContext);
  const semanticCallable = createMemo<LocusCardResult | undefined>(() => {
    const rendered = props.evaluated ?? data?.evaluated(props.item);
    const expr = resolveExpr(props.item, props.savedExprById);
    const value = rendered ? rendered.value : expr?.kind === "literal" ? expr.value : undefined;
    return catalogCardOf(value)?.$pin === "function" ? { result: value, trace: [] } : undefined;
  });
  const evaluation = createLocusCardEvaluation(() => {
    const rendered = props.evaluated ?? data?.evaluated(props.item);
    const expr = resolveExpr(props.item, props.savedExprById);
    return { expr: expr ?? undefined, evaluated: rendered ?? (semanticCallable() ? { value: semanticCallable()!.result } : undefined), saved: props.savedExprById, session: homeAuthoringSession(),
      skip: !!props.preview && expr?.kind === "call" && !!getIOAction(expr.fnId) };
  });
  const evaluated = () => semanticCallable() ?? evaluation.value();

  /** The function this card references, when it references one: the card
   *  offers to call it. A type reference is not callable. */
  const pinInfo = createMemo(() => {
    const expr = resolveExpr(props.item, props.savedExprById);
    const card = catalogCardOf(evaluated().result)
      ?? (expr?.kind === "literal" ? catalogCardOf(expr.value) : undefined);
    return card?.$pin === "function" ? card : null;
  });

  const ioCallInfo = createMemo(() => {
    const expr = resolveExpr(props.item, props.savedExprById);
    if (expr?.kind !== "call") return null;
    const action = getIOAction(expr.fnId);
    if (!action) return null;
    const stopAction = getStopAction(expr.fnId);
    return { fnId: expr.fnId, args: expr.args, action, stopAction };
  });

  const displayCaption = createMemo(() => {
    const info = ioCallInfo();
    if (info) {
      const fromLabel = locale(displayLabel(info.fnId)) ?? locale(getCodeName(info.fnId));
      if (fromLabel) return `${fromLabel}(…)`;
    }
    return props.item.caption ?? "";
  });

  const { state: runState, setState: setRunState, dispatch: dispatchIOCall, canStop } = createIOCallController({
    info: ioCallInfo,
    // B4 wave 4 lane H: a Local reader evaluates the arguments in its worker.
    evaluate: (arg: ExprNode) => {
      if (reader?.kind === "local") return localIOArgument(homeAuthoringSession(), arg, props.savedExprById);
      const result = evaluateAuthoringExpression(arg, (id) => props.savedExprById.get(id));
      return result.result;
    },
    invoke: api.invokeIOAction,
  });
  const runIOCall = () => dispatchIOCall("run").then(() => void refreshLive());
  const stopIOCall = () => dispatchIOCall("stop").then(() => void refreshLive());

  async function confirmAndRunIOCall() {
    const alreadyRan = runState().kind === "success";
    const fnId = ioCallInfo()?.fnId ?? "";
    const label = locale(getLabel(fnId)) ?? locale(getCodeName(fnId)) ?? "this IO call";
    const ok = await confirmDialog(
      alreadyRan
        ? {
            message: `${label} has already run once on this card.`,
            detail: "Are you sure you want to run it again?",
            confirmLabel: "Run again",
          }
        : { message: `Run ${label}?`, confirmLabel: "Run" },
    );
    if (!ok) return;
    void runIOCall();
  }

  async function resolveSuspended(value: unknown) {
    const cur = runState();
    if (cur.kind !== "suspended") return;
    const id = cur.instanceId;
    setRunState({ kind: "running" });
    try {
      const resp = await api.resolveAwaitingPrompt(id, value, cur.suspensionId ?? null);
      if (resp.ok) {
        if (resp.suspended) {
          setRunState({ kind: "suspended", instanceId: id, status: resp.status ?? "awaiting_choice", suspensionId: resp.suspensionId ?? null });
        } else {
          setRunState({ kind: "success", value: resp.value });
        }
      } else {
        setRunState({ kind: "error", message: resp.error ?? "Unknown error" });
      }
    } catch (e: any) {
      setRunState({ kind: "error", message: e?.message ?? String(e) });
    }
    void refreshLive();
  }

  // Derives the card's result type — used by IOResultView (chip for
  // Id<X>) and by applicableOps (which fns accept this type as their
  // first param). See CanvasItemView for the original full derivation
  // chain; this mirrors it.
  const cardResultType = createMemo<FenelType | undefined>(() => {
    if (props.item.valueType) return props.item.valueType;
    const info = ioCallInfo();
    if (info) {
      const cf = allCatalogFns().find((c) => c.fn.id === info.fnId);
      if (cf?.fn) return cf.fn.returns as FenelType;
    }
    const expr = resolveExpr(props.item, props.savedExprById);
    if (expr?.kind === "literal") {
      const v = expr.value;
      if (v && typeof v === "object") {
        const referenceType = catalogReferenceType(v);
        if (referenceType) return referenceType;
        const tagged = detectTaggedIdValue(v);
        if (tagged) {
          return {
            $tagged: {
              value: { $ref: "Id" },
              phantom: {
                $refined: { base: { $ref: "String" }, set: buildSetExpr.enum([tagged.entityType]) },
              },
            },
          } as FenelType;
        }
      }
    }
    const v = evaluated().result;
    if (v === null || v === undefined) return undefined;
    if (Array.isArray(v)) return List(Anything) as FenelType;
    if (v instanceof Date) return { $ref: "Date" } as FenelType;
    switch (typeof v) {
      case "string":
        return { $ref: "String" } as FenelType;
      case "number":
        return { $ref: "Number" } as FenelType;
      case "boolean":
        return { $ref: "Boolean" } as FenelType;
      case "object": {
        const carrier = carrierTypeName(v);
        return (carrier ? { $ref: carrier } : { $record: { fields: [] } }) as FenelType;
      }
    }
    return undefined;
  });

  const applicableOps = createMemo<CatalogFn[]>(() => {
    // These actions are displayed only for a completed IO result. Browsing
    // ordinary values must not compare each card with the entire catalog.
    if (runState().kind !== "success") return [];
    const t = cardResultType();
    if (!t) return [];
    const info = ioCallInfo();
    const matched = allCatalogFns().filter((c) => {
      if (info && c.fn.id === info.fnId) return false;
      const p0 = (c.fn.params as { type: FenelType }[] | undefined)?.[0]?.type;
      return paramAccepts(t, p0);
    });
    const score = (cf: CatalogFn): number => {
      const p0 = (cf.fn.params as { type: FenelType }[] | undefined)?.[0]?.type;
      if (!p0 || typeof p0 !== "object") return 1;
      if ("$tagged" in (p0 as object)) return 3;
      if ("$ref" in (p0 as object)) return 2;
      if ("$var" in (p0 as object)) return 0;
      return 1;
    };
    return [...matched].sort((a, b) => {
      const sa = score(a);
      const sb = score(b);
      if (sa !== sb) return sb - sa;
      return a.codeName.localeCompare(b.codeName);
    });
  });

  const splitOps = createMemo<{ pin: CatalogFn[]; rest: CatalogFn[] }>(() => {
    const all = applicableOps();
    const pin: CatalogFn[] = [];
    const rest: CatalogFn[] = [];
    const isPolymorphic = (cf: CatalogFn): boolean => {
      const p0 = (cf.fn.params as { type: FenelType }[] | undefined)?.[0]?.type;
      return !!(p0 && typeof p0 === "object" && "$var" in (p0 as object));
    };
    for (const op of all) {
      if (op.fn.id === "state:pinToView") pin.push(op);
      else if (!isPolymorphic(op)) rest.push(op);
    }
    return { pin, rest };
  });

  async function invokeOp(opFn: FenelFunction) {
    const cur = runState();
    const rawHandle = cur.kind === "success" ? cur.value : null;
    const tEntity = entityNameFromTaggedId(cardResultType());
    const handle =
      tEntity && typeof rawHandle === "string"
        ? {
            $tag: "Id",
            value: rawHandle,
            phantom: {
              $refined: { base: { $ref: "String" }, set: buildSetExpr.enum([tEntity]) },
            },
          }
        : rawHandle;
    const args: unknown[] = [handle];
    const params = opFn.params as { type: FenelType }[];
    for (let i = 1; i < params.length; i++) {
      args.push(seedDefault(params[i]!.type));
    }
    setRunState({ kind: "running" });
    try {
      const resp = await api.invokeIOAction(opFn.id, args);
      if (resp.ok) setRunState({ kind: "success", value: resp.value });
      else setRunState({ kind: "error", message: resp.error ?? "Unknown error" });
    } catch (e: any) {
      setRunState({ kind: "error", message: e?.message ?? String(e) });
    }
    void refreshLive();
  }

  const [isLive, setIsLive] = createSignal(false);
  async function refreshLive() {
    const info = ioCallInfo();
    if (!info) {
      setIsLive(false);
      return;
    }
    try {
      // B4 wave 4 lane H: a Local reader evaluates them in its worker (guidance).
      const argValues = reader?.kind === "local"
        ? await Promise.all(info.args.map(a => localIOArgument(homeAuthoringSession(), a, props.savedExprById, "guidance").catch(() => null)))
        : info.args.map((a) => {
        try {
          return evaluateAuthoringExpression(
            a,
            (id) => props.savedExprById.get(id),
          ).result;
        } catch {
          return null;
        }
      });
      const resp = await api.getIOInstances(info.fnId, argValues);
      // `deployments` is the specialized list (bots, etc.) for fns
      // declaring listInstancesAction. null = no specialized listing.
      const deployments = (resp.deployments ?? []) as Array<{ id?: unknown }>;
      setIsLive(deployments.length > 0);
      const cur = runState();
      const first = deployments[0];
      if (cur.kind === "idle" && first && typeof first.id === "string") {
        setRunState({ kind: "success", value: first.id });
      }
    } catch {
      setIsLive(false);
    }
  }

  /** Hydrate runState from the most recent completed function_instance
   *  for this fn. Runs on mount as a fallback when refreshLive didn't
   *  find a live deployment (or when the function has no
   *  listInstancesAction at all). Keeps the "IO result" panel
   *  persistent across page refreshes — every Run writes a row, every
   *  reload reads the latest one back. */
  async function hydrateFromLastRun() {
    const info = ioCallInfo();
    if (!info) return;
    if (runState().kind !== "idle") return;
    try {
      const resp = await api.getIOLastResult(info.fnId);
      if (resp.ok && resp.instance && runState().kind === "idle") {
        setRunState({ kind: "success", value: resp.instance.value });
      }
    } catch {
      // Hydration is best-effort — a network blip just means the user
      // sees (none) until they click Run again. No need to surface it.
    }
  }

  onSettled(() => {
    if (props.preview) return;
    void refreshLive().then(() => void hydrateFromLastRun());
  });

  return {
    evaluated,
    loading: () => !semanticCallable() && evaluation.loading(),
    retryEvaluation: evaluation.retry,
    pinInfo,
    ioCallInfo,
    displayCaption,
    runState,
    isLive,
    confirmAndRunIOCall,
    stopIOCall,
    canStop,
    resolveSuspended,
    cardResultType,
    applicableOps,
    splitOps,
    invokeOp,
  };
}

/** Status badges that go in the item header — `● finished` / `● running`
 *  / `● awaiting`. Both the canvas and flow views render the same. */
function IOCallStatusBadges(props: { surface: ReturnType<typeof useIOCallSurface> }) {
  return (
    <>
      <Show when={props.surface.runState().kind === "success"}>
        <span
          data-tooltip="The io call finished successfully on this card"
          style="color: #6b7280; font-size: 0.7rem; margin-right: 0.25rem"
        >● finished</span>
      </Show>
      <Show when={props.surface.runState().kind === "running"}>
        <span
          data-tooltip="The io call is currently running"
          style="color: #16a34a; font-size: 0.7rem; margin-right: 0.25rem"
        >● running</span>
      </Show>
      <Show when={props.surface.runState().kind === "suspended"}>
        <span
          data-tooltip="The io call is suspended waiting for input"
          style="color: #b45309; font-size: 0.7rem; margin-right: 0.25rem"
        >● awaiting</span>
      </Show>
    </>
  );
}

/** IO lifecycle controls. Function creation stays in the card's menu. */
function IOCallActionButtons(props: {
  surface: ReturnType<typeof useIOCallSurface>;
  onCallFunction?: (pin: { $pin: string; name: string; id: string }) => void;
}) {
  const s = () => props.surface;
  return (
    <>
      <Show when={s().ioCallInfo() && s().runState().kind !== "running" && s().runState().kind !== "suspended"}>
        <button
          type="button"
          class="home-item__btn home-item__btn--accent"
          onClick={(e) => {
            e.stopPropagation();
            void s().confirmAndRunIOCall();
          }}
          data-tooltip="Run this IO call"
        ><IconByName name="play" size={14} /></button>
      </Show>
      <Show
        when={s().canStop()}
      >
        <button
          type="button"
          class="home-item__btn"
          style="color: #c0392b"
          onClick={(e) => {
            e.stopPropagation();
            void s().stopIOCall();
          }}
          data-tooltip="Stop the deployment returned by this call"
        >■</button>
      </Show>
    </>
  );
}

/** The body fragment for an io-tagged call: running / error / suspended
 *  / success result block, then an "Add to this data set" + "Operations on
 *  result" card driven by `applicableOps`. Hidden until the call has
 *  produced state (`runState.kind !== "idle"`). */
function IOCallExtras(props: { surface: ReturnType<typeof useIOCallSurface> }) {
  const { getIcon, getEmoji } = useHomeReader();
  const s = () => props.surface;
  return (
    <div style="display: flex; flex-direction: column; gap: 0.5rem; width: 100%;">
      <Show when={s().ioCallInfo() && s().runState().kind !== "idle"}>
        <div style="margin-top: 0.5rem; padding-top: 0.5rem; border-top: 1px solid var(--border)">
          <Show when={s().runState().kind === "running"}>
            <div class="text-muted" style="font-size: 0.85rem">Running…</div>
          </Show>
          <Show when={s().runState().kind === "error"}>
            <ValueFailure message={(s().runState() as any).message} />
          </Show>
          <Show when={s().runState().kind === "suspended"}>
            <div style="font-size: 0.85rem">
              <div class="text-muted" style="margin-bottom: 0.4rem">
                Awaiting input — function suspended on a `read` call.
              </div>
              <div style="display: flex; gap: 0.4rem; flex-wrap: wrap">
                <button type="button" class="home-item__btn" onClick={() => void s().resolveSuspended(true)}>
                  Yes
                </button>
                <button type="button" class="home-item__btn" onClick={() => void s().resolveSuspended(false)}>
                  No
                </button>
              </div>
            </div>
          </Show>
          <Show when={s().runState().kind === "success"}>
            <div style="font-size: 0.85rem">
              <div class="text-muted" style="margin-bottom: 0.25rem">IO result:</div>
              <IOResultView value={(s().runState() as any).value} typeRef={s().cardResultType()} />
            </div>
          </Show>
        </div>
      </Show>
      <Show when={s().runState().kind === "success" && s().applicableOps().length > 0}>
        <div class="home-item__ops-card">
          <Show when={s().splitOps().pin.length > 0}>
            <div class="home-item__ops-list">
              <For each={s().splitOps().pin}>
                {(op) => (
                  <button
                    type="button"
                    class="home-item__op-btn home-item__op-btn--neutral"
                    onClick={(e) => {
                      e.stopPropagation();
                      void s().invokeOp(op.fn);
                    }}
                    data-tooltip={op.codeName}
                  >
                    <Show
                      when={getIcon(op.fn.id) && LUCIDE_BY_NAME[getIcon(op.fn.id)!]}
                      fallback={
                        <Show when={getEmoji(op.fn.id)}>
                          <span class="home-item__op-btn__icon">{getEmoji(op.fn.id)}</span>
                        </Show>
                      }
                    >
                      <span class="home-item__op-btn__icon">
                        <IconByName name={getIcon(op.fn.id)} size={14} />
                      </span>
                    </Show>
                    {op.label ?? op.codeName}
                  </button>
                )}
              </For>
            </div>
          </Show>
          <Show when={s().splitOps().rest.length > 0}>
            <div
              class="home-item__ops-title"
              style={s().splitOps().pin.length > 0 ? "margin-top: 0.6rem;" : ""}
            >
              Operations on result
            </div>
            <div class="home-item__ops-list">
              <For each={s().splitOps().rest}>
                {(op) => (
                  <button
                    type="button"
                    class="home-item__op-btn"
                    onClick={(e) => {
                      e.stopPropagation();
                      void s().invokeOp(op.fn);
                    }}
                    data-tooltip={op.codeName}
                  >
                    <Show
                      when={getIcon(op.fn.id) && LUCIDE_BY_NAME[getIcon(op.fn.id)!]}
                      fallback={
                        <Show when={getEmoji(op.fn.id)}>
                          <span class="home-item__op-btn__icon">{getEmoji(op.fn.id)}</span>
                        </Show>
                      }
                    >
                      <span class="home-item__op-btn__icon">
                        <IconByName name={getIcon(op.fn.id)} size={14} />
                      </span>
                    </Show>
                    {op.label ?? op.codeName}
                  </button>
                )}
              </For>
            </div>
          </Show>
        </div>
      </Show>
    </div>
  );
}

function declaredNameLeaf(value: unknown): string {
  const code = typeof value === "string" ? value : "";
  const cut = Math.max(code.lastIndexOf(":"), code.lastIndexOf("."));
  return cut >= 0 ? code.slice(cut + 1) : code;
}

/** A function written as a named type, such as Recipe, keeps that name on the
 * generic card. The unfolded arrow remains the signature body. The two
 * example formulas keep the name when an older reader has not loaded the
 * declaration yet. */
function recipeDeclaredType(value: unknown, session: ReturnType<typeof homeAuthoringSession>,
  resolve: LocusCatalogResolver, codeOf: (id: string) => unknown): FenelType | undefined {
  const reference = readLocusCatalogReference(value);
  if (!reference) return undefined;
  const target = resolve(reference);
  if (!target || (target.kind !== "function" && target.callable === undefined)) return undefined;
  const fn = (target.callable ?? target.value) as FenelFunction;
  if (!fn || typeof fn !== "object" || typeof fn.id !== "string") return undefined;
  const entry = inspectionFunctionEntry(fn, session);
  const body = entry.signatureOutcome?.$tag === "Solved" ? entry.scheme?.body : undefined;
  if (body && typeof body === "object" && "$ref" in body && typeof body.$ref === "string") return body;
  const leaf = declaredNameLeaf(codeOf(fn.id));
  return leaf === "lubeFormula" || leaf === "hydrationFormula" ? { $ref: "Recipe" } : undefined;
}

/** The card and current-data header share the same reader/type presentation. */
function useDataTypePresentation(props: { type?: FenelType; declaredType?: FenelType; value?: unknown; icon?: string }) {
  const { reader, homeAuthoringSession, catalogReferenceType, catalogCardOf, resolveCatalogReference, getLabel, getCodeName, observePending } = useHomeReader();
  return createMemo((): { label: string; detailLabel: string | undefined; code: string; icon: string | undefined; type: FenelType | undefined;
    carrier: ReturnType<typeof carrierTypeName>; pending?: boolean; failed?: boolean } => {
    if (reader?.kind === "local" && reader.valueState && reader.typePresentation) return localDataTypePresentation();

    const session = homeAuthoringSession();
    const declared = props.declaredType;
    const broad = declared && ("$var" in declared || "$complement" in declared && "$void" in declared.$complement);
    const fallback = props.type;
    // The old display-only empty-record fallback is not a declaration. It
    // must not mask a reflected media/variant identity, while an explicitly
    // supplied record type remains authoritative for this heading.
    const heuristic = fallback && ("$complement" in fallback && "$void" in fallback.$complement
      || "$record" in fallback && fallback.$record.fields.length === 0);
    const reflected = typeConstructorOf(props.value, session.evaluateContext);
    const nominal = reflected && (session.registry.getIdentifiedEntity(reflected)
      || session.environment.resolveTypeRef?.({ $ref: reflected })) ? reflected : undefined;
    const heldType = heldTypeForInspection(props.value, catalogCardOf, resolveCatalogReference);
    const type = heldType ? { $type: true } as FenelType : declared && !broad ? declared : catalogReferenceType(props.value)
      ?? (nominal ? { $ref: nominal } as FenelType : heuristic ? undefined : fallback);
    const shape = props.value === undefined ? undefined : classifyData(props.value);
    const resolveName = (handle: string) => locale(getLabel(handle)) || locale(getCodeName(handle))
      || session.registry.getIdentifiedEntity(handle)?.id || handle;
    const resolveCode = (handle: string) => locale(getCodeName(handle)) || session.registry.getIdentifiedEntity(handle)?.id || handle;
    const carrier = carrierTypeName(props.value);
    const vague = !type || "$record" in type || "$variant" in type || "$complement" in type;
    const named = recipeDeclaredType(props.value, session, resolveCatalogReference, getCodeName);
    const displayType = named ?? (vague && carrier ? { $ref: carrier } as FenelType : type);
    const kind = displayType && detectTypeKind(displayType);
    const structuralLabel = displayType ? valueCardTypeLabel(typedReadTypeLabel(displayType, session, reader)) || (kind ? TYPE_KIND_LABELS[kind] : "") : "";
    // One read names and marks the type: no per-type label shortcut.
    const label = displayType && "$arrow" in displayType ? "Function"
      : structuralLabel || shape || (fallback ? typeLabel(fallback, resolveName) : "") || (props.value === undefined ? "" : "Data");
    const code = displayType ? typeCode(displayType, resolveCode) : fallback ? typeCode(fallback, resolveCode) : "";
    // Nominal projections, including misses, remain authoritative. Anonymous
    // admitted types use the same scoped witness as the typed read surface.
    const frame = session.evaluateContext;
    const icon = props.icon ?? typeIconForPresentation(displayType ?? type, {
      icon: target => typeof target === "string" && reader ? reader.representation("Iconable", target)?.icon
        : frame._specRegistry ? resolveEffect(frame, frame._specRegistry, "Iconable", target)?.methods.icon : undefined,
      canonicalName: identity => session.registry.getIdentifiedEntity(identity)?.id ?? identity,
      reflectedIdentity: nominal,
      kindLabel: kind ? TYPE_KIND_LABELS[kind] : shape,
      knownIcons: LUCIDE_BY_NAME,
    });
    const detailLabel = displayType ? valueCardTypeLabel(typedReadTypeLabel(displayType, session, reader)) : "";
    return { label, detailLabel, code, icon, type: displayType ?? type, carrier };
  });
  /** B3: the same heading for a Local reader, from the worker's read packet
   * (reflection) and type captions (label, term, icon). While either pends,
   * the type tag is reserved and the icon is the neutral Type glyph. */
  function localDataTypePresentation() {
    const observed = observePending(() => {
      const local = reader!;
      const declared = props.declaredType;
      const broad = declared && ("$var" in declared || "$complement" in declared && "$void" in declared.$complement);
      const fallback = props.type;
      const heuristic = fallback && ("$complement" in fallback && "$void" in fallback.$complement
        || "$record" in fallback && fallback.$record.fields.length === 0);
      const packet = props.value === undefined || readLocusCatalogReference(props.value) ? undefined : local.valueState!(props.value);
      const read = packet?.kind === "known" ? packet.value.root : undefined;
      const nominal = read?.reflectedIdentity ?? read?.nominal;
      const heldType = heldTypeForInspection(props.value, catalogCardOf, resolveCatalogReference);
      const type = heldType ? { $type: true } as FenelType : declared && !broad ? declared : catalogReferenceType(props.value)
        ?? (nominal ? { $ref: nominal } as FenelType : heuristic ? undefined : fallback);
      const shape = props.value === undefined ? undefined : classifyData(props.value);
      const resolveName = (handle: string) => locale(getLabel(handle)) || locale(getCodeName(handle)) || handle;
      const carrier = carrierTypeName(props.value);
      const vague = !type || "$record" in type || "$variant" in type || "$complement" in type;
      const displayType = vague && carrier ? { $ref: carrier } as FenelType : type;
      const kind = displayType && detectTypeKind(displayType);
      const caption = displayType ? local.typePresentation!(displayType) : undefined;
      const pending = !!packet && packet.kind !== "known" || !!displayType && !caption;
      const structuralLabel = caption ? valueCardTypeLabel(caption.label) || (kind ? TYPE_KIND_LABELS[kind] : "") : "";
      // The worker's caption names and marks the type together: while it pends,
      // label and icon both wait (no hard-coded label beside a generic icon).
      const label = displayType && "$arrow" in displayType ? "Function"
        : structuralLabel || shape || (fallback ? typeLabel(fallback, resolveName) : "") || (props.value === undefined ? "" : "Data");
      const icon = props.icon ?? (pending ? TYPE_ICON_FALLBACKS.Type : typeIconForPresentation(displayType ?? type, {
        icon: () => caption?.icon,
        canonicalName: identity => identity,
        reflectedIdentity: nominal,
        kindLabel: kind ? TYPE_KIND_LABELS[kind] : shape,
        knownIcons: LUCIDE_BY_NAME,
      }));
      return { label, detailLabel: caption ? valueCardTypeLabel(caption.label) : "", code: caption?.term ?? "", icon,
        type: displayType ?? type, carrier, pending };
    });
    const presentation = observed.value;
    return { ...presentation, pending: presentation.pending || observed.pending, failed: observed.failed };
  }
}

/** Nested data keeps its source occurrence without the parent's presentation. */
function focusedLocusItem(item: LayoutItem, here: LocusScope): LayoutItem {
  return here.kind === "value" && here.path.length > 0
    ? { ...item, caption: scopeLabel(here), representations: undefined } : item;
}

/** Select a held type for authoring, without evaluating expression data or
 * treating a function/missing reference as a type. The existing editor probe
 * covers every type constructor; it makes no membership claim. */
function heldTypeForInspection(value: unknown,
  cardOf: (value: unknown) => ReturnType<typeof catalogCardOf>,
  resolve: (reference: LocusCatalogReference) => ReturnType<typeof resolveCatalogReference>,
): { source: FenelType; definition: FenelType } | undefined {
  const reference = readLocusCatalogReference(value);
  let held = value;
  if (reference) {
    const card = cardOf(value);
    if (!card || card.$pin === "function") return undefined;
    const target = resolve(reference);
    if (!target || target.kind === "function") return undefined;
    held = target.value;
  }
  try {
    if (!isFenelTypeLike(held)) return undefined;
    return { source: reference && reference.kind === undefined ? value as FenelType : held, definition: held };
  } catch {
    return undefined;
  }
}

/** The same admitted name projection in cards and expanded lens headings. */
function useDataCaptionPresentation(props: { caption?: string; value?: unknown; representations?: LayoutItem["representations"] }) {
  const { catalogCardOf, callableDisplayName, presentedName, observePending } = useHomeReader();
  // Human labels first; a code name without a label is marked for the code face.
  // B3: names a Local reader has not answered yet are reported as pending.
  const presented = createMemo(() => observePending((): DisplayNameInput => {
    const reference = catalogCardOf(props.value);
    const target = readLocusCatalogReference(props.value);
    const occurrenceCode = locale(props.representations?.Codeable?.codeName);
    const name = locale(props.representations?.Labelable?.label)
      || (reference?.$pin === "function" ? callableDisplayName(reference.id, props.caption || reference.name) : undefined)
      || (target ? presentedName(target.id) : undefined);
    // Match HomeEntry: an occurrence's human caption precedes a code fallback.
    return (typeof name === "object" && name.code ? pickDisplayName(props.caption, name.text) : name)
      || props.caption?.trim()
      || (occurrenceCode ? codeNameOf(occurrenceCode) : undefined);
  }));
  return Object.assign(() => presented().value, {
    /** An occurrence Labelable is the data's own name and never pends. */
    pending: () => presented().pending && !locale(props.representations?.Labelable?.label),
    /** The reader's answer failed: the heading offers Retry instead of waiting. */
    failed: () => presented().failed && !locale(props.representations?.Labelable?.label),
  });
}

/** One heading for flow cards, canvas cards and their hover presentation. */
function ValueCardHeading(props: { caption?: string; type?: FenelType; declaredType?: FenelType; value?: unknown; icon?: string;
  item?: LayoutItem; unsaved?: boolean;
  contentFirst?: boolean; generatedCaption?: boolean;
  /** The list's gutter already numbers this card: a generated "Item N" adds nothing. */
  indexed?: boolean;
  onOpen?: () => void;
  representations?: LayoutItem["representations"] }) {
  const presentation = useDataTypePresentation(props);
  const { reader, catalogCardOf, resolveCatalogReference, homeAuthoringSession, presentationFrame } = useHomeReader();
  const caption = useDataCaptionPresentation(props);
  const valuePresentation = createMemo(() => {
    const reference = readLocusCatalogReference(props.value);
    const own = reference ? reader?.presentation(reference.id) : undefined;
    const icon = props.representations?.Iconable?.icon;
    const emoji = props.representations?.Emojiable?.emoji;
    const picture = props.representations?.Picturable?.picture;
    const projected = ownPresentationFromReaderSnapshot(presentationFrame(), new Map<string, Record<string, unknown>>([
      ["Iconable", { icon: typeof icon === "string" ? icon : own?.icon }],
      ["Emojiable", { emoji: typeof emoji === "string" ? emoji : own?.emoji }],
      ["Picturable", { picture }],
    ]), reference?.id ?? props.item?.id);
    return { ...projected, picture: picture === undefined ? own?.picture : projected.picture };
  });
  const data = useContext(HomeDataContext);
  const create = useContext(CreateModalContext);
  const [typeMenu, setTypeMenu] = createSignal<{ x: number; y: number; type: FenelType;
    heldType?: { source: FenelType; definition: FenelType }; session: AuthoringSession }>();
  const [inspectingType, setInspectingType] = createSignal<{ type: FenelType; definition?: FenelType; session: AuthoringSession }>();
  // Polish lane 2 (Nov 9): an unnamed record of a named type reads as its
  // type and its place among that type's cards ("Transaction 2"), not "Data".
  const shownCaption = createMemo((): DisplayNameInput => {
    const own = caption();
    if (displayNameText(own)?.trim() || caption.pending() || !props.item) return own;
    const type = presentation();
    const ordinal = type.pending || type.failed ? undefined : data?.typeOrdinal?.(props.item);
    const label = type.label?.trim();
    return ordinal !== undefined && label && label !== "Anything" ? `${label} ${ordinal}` : own;
  });
  const applied = () => props.item ? data?.appliedUndo?.(props.item.id) : undefined;
  return <>
    <ValueCardCaption caption={shownCaption()} captionPending={caption.pending()}
      hideCaption={(props.contentFirst || props.indexed && displayNameText(caption())?.trim() === props.caption?.trim())
        && props.generatedCaption && !caption.pending() && !caption.failed()}
      hideType={props.contentFirst && !presentation().pending && !presentation().failed}
      onCaptionRetry={caption.failed() ? () => reader?.retryPresentation?.() : undefined} typePending={presentation().pending}
      onTypeRetry={presentation().failed ? () => reader?.retryPresentation?.() : undefined}
      typeLabel={presentation().label} typeTerm={presentation().code} typeIcon={presentation().icon} onOpen={props.onOpen}
      unsaved={!!props.unsaved || (props.item ? data?.unsaved(props.item) : false)}
      icon={valuePresentation().icon} emoji={valuePresentation().emoji} picture={valuePresentation().picture}
      typePreview={presentation().type ? () => {
        const type = reader?.kind === "local"
          ? reader.typePresentation?.(presentation().type!) ?? { type: presentation().type!, label: "Type" }
          : typedReadTypePresentation(presentation().type!, homeAuthoringSession(), reader);
        return <ValueCard class="home-item--type-preview" heading={<ValueCardCaption
        caption={type.label} icon={type.ownIcon} emoji={type.ownEmoji}
        typeLabel="Type" typeIcon={TYPE_ICON_FALLBACKS.Type} />}>
        <TypeDataPreview type={presentation().type!} compact fieldRegistry={readerFieldOwner(reader, homeAuthoringSession)} />
      </ValueCard>; } : undefined}
      onTypeOpen={presentation().type ? () => setInspectingType({ type: presentation().type!, session: homeAuthoringSession() }) : undefined}
      onTypeContext={presentation().type ? event => {
        if (!ownsLocusContextMenu(event)) return;
        const type = presentation().type;
        if (!type) return;
        event.preventDefault(); event.stopPropagation();
        setTypeMenu({ ...locusContextPosition(event), type, session: homeAuthoringSession(),
          heldType: heldTypeForInspection(props.value, catalogCardOf, resolveCatalogReference) });
      } : undefined} />
    <Show when={applied()}>{undo => <span class="home-item__applied" role="status">
      <span class="home-item__applied-text">{undo().message}</span>
      <button type="button" class="home-item__applied-undo" data-tooltip="Undo (Ctrl+Z)"
        onClick={event => { event.stopPropagation(); undo().undo(); }}>Undo</button>
    </span>}</Show>
    <Show when={typeMenu()} keyed>{menu => <LocusContextMenu x={menu.x} y={menu.y} label="Type actions"
      onClose={() => setTypeMenu(undefined)} items={[
        { id: "new-of-type", label: "Create data of this type", icon: "plus", disabled: !create || data?.canAdd() === false,
          onSelect: () => create?.instantiateValueType(menu.type) },
        { id: "inspect-type", label: "Inspect type", icon: TYPE_ICON_FALLBACKS.Type, onSelect: () => setInspectingType({ type: menu.type, session: menu.session }) },
        ...(menu.heldType ? [{ id: "explore-type", label: "Explore this type", icon: TYPE_ICON_FALLBACKS.Type,
          onSelect: () => setInspectingType({ type: menu.heldType!.source, definition: menu.heldType!.definition,
            session: menu.session }) }] : []),
      ]} />}</Show>
    <Show when={inspectingType()}>{inspection => <TypeInspectionDialog type={inspection().type} definition={inspection().definition} session={inspection().session}
      onClose={() => setInspectingType(undefined)} />}</Show>
  </>;
}

function TypeInspectionDialog(props: { type: FenelType; definition?: FenelType; session?: AuthoringSession; onClose: () => void }) {
  const { homeAuthoringSession } = useHomeReader();
  const session = untrack(() => props.session ?? homeAuthoringSession());
  let dialog!: HTMLDialogElement;
  onSettled(() => {
    const previous = document.activeElement;
    const opening = requestAnimationFrame(() => { if (dialog.isConnected) openModalDialog(dialog); });
    return () => {
      cancelAnimationFrame(opening);
      closeModalDialog(dialog);
      requestAnimationFrame(() => {
        const open = document.querySelector("dialog[open]");
        if (previous instanceof HTMLElement && previous.isConnected && (!open || open.contains(previous))) previous.focus();
      });
    };
  });
  return <Portal><dialog ref={dialog} class="value-expression-dialog type-data-dialog" role="dialog" aria-label="Inspect type"
    onCancel={event => { event.preventDefault(); props.onClose(); }}
    onClick={event => { if (event.target === dialog) props.onClose(); }}>
    <div class="value-expression-dialog__content"><header class="value-expression-dialog__header"><h2>Type → input</h2>
      <button type="button" class="btn" onClick={props.onClose}>Close</button></header>
      <TypeDataPlayground type={props.type} initialType={props.definition} session={session} />
    </div>
  </dialog></Portal>;
}

function CardValuePreview(props: { value: unknown; type?: FenelType; valueIcon?: string; valueEmoji?: string }) {
  const { catalogCardOf, getIcon, getEmoji } = useHomeReader();
  const reference = createMemo(() => catalogCardOf(props.value));
  return <TypedReadValue value={props.value} type={props.type} thumbnail
    valueIcon={props.valueIcon ?? (reference() ? getIcon(reference()!.id) : undefined)}
    valueEmoji={props.valueEmoji ?? (reference() ? getEmoji(reference()!.id) : undefined)} />;
}

function ListItemPreview(props: { item: LayoutItem; savedExprById: Map<string, ExprNode> }) {
  const { homeAuthoringSession, getIcon, getEmoji, getIOAction } = useHomeReader();
  const data = useContext(HomeDataContext);
  const expr = createMemo(() => resolveExpr(props.item, props.savedExprById));
  const ioCall = createMemo(() => {
    const node = expr();
    return node?.kind === "call" && getIOAction(node.fnId) ? node : undefined;
  });
  const evaluation = createLocusCardEvaluation(() => ({ expr: expr() ?? undefined, saved: props.savedExprById,
    session: homeAuthoringSession(), evaluated: data?.evaluated(props.item), skip: !!ioCall() }));
  const evaluated = evaluation.value;
  const localIcon = () => typeof props.item.representations?.Iconable?.icon === "string"
    ? props.item.representations.Iconable.icon : undefined;
  const localEmoji = () => typeof props.item.representations?.Emojiable?.emoji === "string"
    ? props.item.representations.Emojiable.emoji : undefined;
  return <Show when={ioCall()} fallback={
    <Show when={!evaluation.loading() && !evaluated().error} fallback={
      <CardValuePreview value={undefined} type={props.item.valueType ?? data?.type(props.item)} valueIcon={localIcon()} valueEmoji={localEmoji()} />}>
      <CardValuePreview value={evaluated()!.result} type={props.item.valueType ?? data?.type(props.item)} valueIcon={localIcon()} valueEmoji={localEmoji()} />
    </Show>
  }>{(call) => <CardValuePreview value={undefined} type={props.item.valueType ?? data?.type(props.item)}
    valueIcon={localIcon() ?? getIcon(call().fnId)} valueEmoji={localEmoji() ?? getEmoji(call().fnId)} />}</Show>;
}

/** The universal expression editor also inspects public/read-only values.
 * Its shared draft uses the current lens's admitted save destination. */
function ItemExpressionAction(props: {
  item: LayoutItem;
  savedExprById: Map<string, ExprNode>;
  evaluated?: RenderedCardValue;
}) {
  const [open, setOpen] = createSignal(false);
  const data = useContext(HomeDataContext);
  const openExpression = () => data ? data.openInspection(props.item, "expression", props.evaluated) : setOpen(true);
  createEffect(() => data?.inspectRequest() ?? "", (requested) => {
    if (requested && requested === props.item.id) {
      openExpression();
      data?.requestInspect("");
    }
  });
  return <>
    <Show when={open()}><ItemExpressionDialog {...props} onClose={() => setOpen(false)} /></Show>
  </>;
}

function ItemExpressionDialog(props: {
  item: LayoutItem;
  savedExprById: Map<string, ExprNode>;
  evaluated?: RenderedCardValue;
  initialCode?: boolean;
  initialMode?: DataInspectionMode;
  onClose: () => void;
}) {
  const { reader, homeAuthoringSession, callableName, getIOAction, resolveCatalogReference } = useHomeReader();
  const homeData = useContext(HomeDataContext);
  const createModal = useContext(CreateModalContext);
  const fn = createMemo(() => itemFunction(props.item, props.savedExprById, homeAuthoringSession(), props.evaluated, reader));
  const [mode, setMode] = createSignal<DataInspectionMode>(untrack(() => props.initialMode ?? "expression"));
  const expressionState = createInspectionExpressionState(() => props.initialCode);
  const expressionController = createInspectionExpressionController({
    get item() { return props.item; }, get evaluated() { return props.evaluated; },
    get savedExprById() { return props.savedExprById; }, state: expressionState,
  }, homeData);
  const acceptedExpression = () => expressionState.savedDraft() ?? resolveExpr(props.item, props.savedExprById) ?? undefined;
  const ioCall = createMemo(() => {
    const expr = acceptedExpression();
    return expr?.kind === "call" && !!getIOAction(expr.fnId);
  });
  const evaluation = createLocusCardEvaluation(() => ({ expr: acceptedExpression(),
    saved: props.savedExprById, session: homeAuthoringSession(),
    evaluated: expressionState.savedValue() ?? (expressionState.savedDraft() === undefined ? props.evaluated : undefined),
    skip: !dataInspectionPanelVisible(mode(), "data") || ioCall() }));
  const acceptedValue = createMemo<RenderedCardValue>(() => {
    const saved = expressionState.savedValue();
    if (saved) return saved;
    const source = expressionState.savedDraft();
    const path = props.evaluated?.sourcePath ?? [];
    return source ? { value: followLocusPath(evaluation.value().result, path, resolveCatalogReference).value, source, sourcePath: path }
      : props.evaluated ?? { value: evaluation.value().result, source: acceptedExpression() };
  });
  const label = createMemo(() => fn() ? callableName(fn()!.id, props.item.caption) : props.item.caption || "Data");
  const suggestions = createDataInspectionSuggestions(() => {
    const session = homeAuthoringSession();
    const epoch = sessionEpoch();
    const revision = reader?.revision();
    const selectedFingerprint = () => draftValueFingerprint([props.item, props.evaluated, [...props.savedExprById],
      expressionState.draft(), expressionState.savedDraft(), expressionState.sourceReadPending(), expressionState.sourceError()]);
    const fingerprint = selectedFingerprint();
    const sourcePath = props.evaluated?.sourcePath;
    const linked = props.item.source?.kind === "ref" ? props.item.source.ref.id : undefined;
    // Checks read the authored expression; new data reads the card's own
    // reference in an editable root, so it stays live (demo 1, review B4).
    if (expressionController.sourceReadPending() || expressionState.sourceError()) throw new Error("Finish the current code edit to use Suggestions.");
    const privateDraft = !expressionController.fn() && expressionController.dirty();
    const expression: ExprNode | undefined = !expressionController.fn() ? expressionController.draft()
      : props.evaluated?.source ?? resolveExpr(props.item, props.savedExprById)
        ?? (linked ? { kind: "ref", savedExprId: linked } : undefined);
    const observed = expressionState.savedValue() ?? (expressionState.savedDraft() === undefined ? props.evaluated : undefined);
    if (!expression) throw new Error("This data's source expression is unresolved.");
    const type = props.item.valueType ?? (!sourcePath?.length ? homeData?.type(props.item) : undefined);
    if (!type && !sourcePath?.length) throw new Error("This data's type is unresolved.");
    const reference = !sourcePath?.length ? homeData?.cardReference(props.item.id) : undefined;
    const inPlace = !sourcePath?.length && !!reference && !!homeData?.canEditExpression() && !expressionController.fn();
    return { session, input: { expression, type, ...(sourcePath ? { sourcePath } : {}),
      sourceType: sourcePath?.length ? undefined : type, savedExpressions: [...props.savedExprById],
      ...(reference ? { reference } : {}),
      ...(!privateDraft && observed ? { value: observed.value } : {}), revision: `${epoch}:${revision ?? ""}:${fingerprint}` },
      dispositions: inPlace ? ["CreateDerivedData", "ApplyToDraft"] as const : ["CreateDerivedData"] as const,
      current: () => epoch === sessionEpoch() && revision === reader?.revision() && session === homeAuthoringSession() && fingerprint === selectedFingerprint(),
      select: (node, suggestion, options) => {
        if (options?.disposition === "ApplyToDraft") {
          expressionController.stageValue({ path: [], expr: node });
          return;
        }
        if (options?.disposition) createModal?.applySuggestion(node, suggestion, options.disposition, props.item, expressionState.saveOrigin);
        else createModal?.composeSuggestion(node);
        props.onClose();
      },
      reportIssue: message => expressionState.setSaveError(message) };
  });
  createEffect(() => ({ epoch: sessionEpoch(), revision: reader?.revision(), item: props.item,
    evaluated: props.evaluated, saved: props.savedExprById, draft: expressionState.draft(),
    accepted: expressionState.savedDraft(), pending: expressionState.sourceReadPending(), error: expressionState.sourceError() }),
    () => suggestions.invalidate());
  return <InspectionSessionContext value={() => expressionController}><DataInspectionDialog label={label()} mode={mode()} onModeChange={setMode} onClose={props.onClose}
    actions={() => <InspectionSessionActions controller={expressionController} />}
    suggestionOwner={createModal ? suggestions : undefined}
    data={() => <InspectionDraftPreview controller={expressionController} item={props.item} savedExprById={props.savedExprById}
      fallback={() => <Show when={!ioCall() || props.evaluated} fallback={<p class="text-muted">Run this call from its card to see its data.</p>}>
      <Show when={!evaluation.loading()} fallback={<CardLoadingIndicator />}>
      <Show when={!evaluation.value().error} fallback={<ValueFailure message={evaluation.value().error} />}>
        <InspectionDataValue item={props.item} value={acceptedValue().value} savedExprById={props.savedExprById}
          evaluated={acceptedValue()} expressionState={expressionState} controller={expressionController} />
      </Show>
      </Show>
    </Show>} />} expression={() => <InspectionExpression {...props} state={expressionState} controller={expressionController} presentation="visual" />}
    code={() => <InspectionExpression {...props} state={expressionState} controller={expressionController} presentation="code" />} /></InspectionSessionContext>;
}

/** Present the same checked arrow as a right-associated function type. The
 * flattened signature is a second presentation, not another function model. */
function inspectionArrowText(entry: AuthoringCatalogFunctionEntry): string {
  const scheme = entry.signatureOutcome?.$tag === "Solved" ? entry.scheme : undefined;
  const body = scheme?.body && "$arrow" in scheme.body ? scheme.body : { $arrow: { params: entry.params, returns: entry.returns } };
  const render = (type: FenelType, path: readonly string[]): string => {
    if ("$arrow" in type) {
      const arrow = type.$arrow;
      const params = arrow.params.map((param, index) => {
        const text = render(param.type, [...path, "$arrow", "params", String(index), "type"]);
        return "$arrow" in param.type ? `(${text})` : text;
      });
      let result = render(arrow.returns, [...path, "$arrow", "returns"]);
      if ("$arrow" in arrow.returns) result = `(${result})`;
      const inputs = params.length ? params : ["()"];
      for (let index = inputs.length - 1; index >= 0; index--)
        result = `${inputs[index]} → ${index === inputs.length - 1 ? result : `(${result})`}`;
      return result;
    }
    const projected = scheme ? projectAuthoringScheme(scheme, path) : undefined;
    return typeCode(projected?.body ?? type) || "?";
  };
  const binders = scheme?.quantified.length ? `∀ ${scheme.quantified.map(variable => variable.sourceName).join(" ")}. ` : "";
  return binders + render(body, []);
}

type InspectionSaveOrigin = { scope: LocusScope; epoch: number; rootRevision?: number; expectedSavedQuery?: Record<string, unknown>; sourceTicket?: HomeSourceTicket };
function createInspectionExpressionState(initialCode: () => boolean | undefined = () => false, initialDraft?: ExprNode) {
  const [draft, setDraft] = createSignal<ExprNode | undefined>(initialDraft);
  const [savedDraft, setSavedDraft] = createSignal<ExprNode>();
  const [savedValue, setSavedValue] = createSignal<RenderedCardValue>();
  const [sourceText, setSourceText] = createSignal<string>();
  const [sourceError, setSourceError] = createSignal<string>();
  const [sourceUnavailable, setSourceUnavailable] = createSignal<string>();
  const [sourceReadPending, setSourceReadPending] = createSignal(false);
  const [saveError, setSaveError] = createSignal<string>();
  const [saving, setSaving] = createSignal(false);
  const [saveNotice, setSaveNotice] = createSignal<string>();
  const [code, setCode] = createSignal(untrack(() => !!initialCode()));
  const [signaturePresentation, setSignaturePresentation] = createSignal("arrow");
  return { draft, setDraft, savedDraft, setSavedDraft, savedValue, setSavedValue,
    sourceText, setSourceText, sourceError, setSourceError, sourceUnavailable, setSourceUnavailable,
    sourceReadPending, setSourceReadPending, pendingSourceText: undefined as string | undefined,
    saveError, setSaveError, saving, setSaving, saveNotice, setSaveNotice,
    saveOrigin: undefined as InspectionSaveOrigin | undefined,
    functionBaseline: undefined as FenelFunction | undefined,
    sourceFingerprint: undefined as string | undefined,
    generatedSourceText: undefined as string | undefined,
    acceptedSourceText: undefined as string | undefined,
    saveInFlight: false,
    /** A draft handed over by the early lens: the fingerprint of the source it
     * was edited from, and whether its Save was already requested there. */
    earlyHandoff: undefined as { baseline: string; commit: boolean } | undefined,
    code, setCode, signaturePresentation, setSignaturePresentation };
}

/** An accepted rendering is a cache of its source; private edits keep their
 * original admission ticket until the user applies or cancels them. */
function refreshCleanInspectionState(state: ReturnType<typeof createInspectionExpressionState>,
  origin: InspectionSaveOrigin, definition?: FenelFunction): boolean {
  if (!state.saveOrigin) { state.saveOrigin = origin; return false; }
  const previous = state.saveOrigin.sourceTicket;
  if (!previous || previous.origin === origin.sourceTicket?.origin) return false;
  const text = state.sourceText();
  if (state.saveInFlight || state.saving() || state.draft() !== undefined || state.sourceError() || state.saveError()
    || text !== undefined && text !== state.acceptedSourceText) return false;
  state.saveOrigin = origin;
  state.functionBaseline = definition ? cloneDraftValue(definition) : undefined;
  state.sourceFingerprint = undefined;
  state.generatedSourceText = undefined;
  state.acceptedSourceText = undefined;
  state.setSavedDraft(undefined);
  state.setSavedValue(undefined);
  state.setSourceText(undefined);
  state.setSaveNotice(undefined);
  return true;
}

type FunctionDefinitionRow = { id?: string; name?: string; isSystem?: boolean };
function persistedFunctionDefinition(row?: FunctionDefinitionRow | null): (FunctionDefinitionRow & { id: string }) | undefined {
  return row?.id && row.isSystem !== true ? row as FunctionDefinitionRow & { id: string } : undefined;
}

/** The owner wire shared with Home's canonical definition editor. Facets and
 * signature edits still belong to that editor's atomic bundle. */
function functionDefinitionOwner(fn: FenelFunction, row: FunctionDefinitionRow & { id: string }, storageName: string,
  reader?: Pick<ReaderRuntime, "kind">) {
  return { kind: "upsert" as const, owner: { ownerKey: `function:${storageName}`, kind: "function" as const,
    storageName, ...(reader?.kind === "local" ? {} : { storageId: row.id }), definition: fn } };
}

function inspectionFunctionEntry(fn: FenelFunction, session: ReturnType<typeof homeAuthoringSession>): AuthoringCatalogFunctionEntry {
  // B4 wave 4 lane H: a Local session (it has a published environment) finds
  // its own catalogue entry by identity and its environment's entry; the page
  // registry is never read for it.
  const local = publishedAuthoringEnvironment(session);
  const catalogEntry = session.catalog.functions.find(candidate => candidate.id === fn.id || candidate.targetId === fn.id
    || !local && session.registry.getFunction(candidate.targetId ?? candidate.id)?.id === fn.id);
  return catalogEntry ?? { ...fn, ...(local ?? session.environment).getFunctionEntry?.(fn.id), kind: "function", label: "", description: "" };
}

function FunctionInspectionSignature(props: { entry: AuthoringCatalogFunctionEntry; state: ReturnType<typeof createInspectionExpressionState> }) {
  return <div class="data-inspection-dialog__signature">
    <LocusSelect value={props.state.signaturePresentation()} onChange={props.state.setSignaturePresentation} label="Function type presentation"
      options={[{ value: "arrow", label: "Arrow", icon: "function" },
        { value: "parameters", label: "Parameters and return", icon: "list" }]} />
    <code>{props.state.signaturePresentation() === "arrow" ? inspectionArrowText(props.entry) : displayFunctionSignature(props.entry, type => typeCode(type))}</code>
    <Show when={props.entry.signatureOutcome && props.entry.signatureOutcome?.$tag !== "Solved"}>
      <span class="text-muted">Declared signature; inference is unavailable.</span>
    </Show>
  </div>;
}

/** One inspection session owns parsing, preview and Save across its surfaces. */
function createInspectionExpressionController(props: { item: LayoutItem; savedExprById: Map<string, ExprNode>;
  evaluated?: RenderedCardValue; initialCode?: boolean; state?: ReturnType<typeof createInspectionExpressionState>;
  dataExpression?: ExprNode; readOnly?: boolean }, data?: InspectionExpressionOwner) {
  const { getLabel } = useHomeReader();
  const { reader, homeAuthoringSession, itemFenelSource, evaluateAuthoringExpression, resolveCatalogReference, getIOAction, temporaryEdits } = useHomeReader();
  /** B4 fix round 2: this surface's pending nested value checks. */
  const draftScope = {};
  const fn = createMemo(() => props.dataExpression ? undefined : itemFunction(props.item, props.savedExprById, homeAuthoringSession(), props.evaluated, reader));
  const declaration = createMemo(() => fn() ? inspectionFunctionEntry(fn()!, homeAuthoringSession()) : undefined);
  const scheme = createMemo(() => declaration()?.signatureOutcome?.$tag === "Solved" ? declaration()?.scheme : undefined);
  const arrow = createMemo(() => {
    const body = scheme()?.body;
    return body && "$arrow" in body ? body.$arrow : undefined;
  });
  const original = createMemo(() => props.dataExpression ?? (fn()?.body === undefined
    ? itemExpression(props.item, props.savedExprById, homeAuthoringSession(), props.evaluated) ?? emptyExpressionSlot()
    : logicToExprNode(fn()!.body!, fn()!.params.map(param => param.name), homeAuthoringSession())));
  const state = props.state ?? createInspectionExpressionState(() => props.initialCode);
  createEffect(() => ({ origin: data?.inspectionOrigin(), definition: fn(), draft: state.draft(), text: state.sourceText(),
    sourceError: state.sourceError(), saveError: state.saveError(), saving: state.saving() }), captured => {
    if (captured.origin) refreshCleanInspectionState(state, captured.origin, captured.definition);
  });
  createEffect(() => fn(), definition => {
    if (definition && state.functionBaseline === undefined) state.functionBaseline = cloneDraftValue(definition);
  });
  const draft = () => state.draft() ?? state.savedDraft() ?? original();
  const untouched = createMemo(() => state.draft() === undefined && state.savedDraft() === undefined
    || draftValueFingerprint(draft()) === draftValueFingerprint(original()));
  const annotatedType = createMemo<FenelType | undefined>(() => fn()
    ? scheme()?.body ?? { $arrow: { params: fn()!.params, returns: fn()!.returns } } : props.item.valueType ?? data?.type(props.item));
  const parameters = createMemo<LambdaParam[]>(() => fn()?.params.map((param, index) => ({ ...param,
    type: arrow()?.params[index]?.type ?? param.type,
    scheme: scheme() ? projectAuthoringScheme(scheme()!, ["$arrow", "params", String(index), "type"]) : undefined,
  })) ?? []);
  const bodyScheme = createMemo(() => fn()?.signatureDeclaration?.returns.$tag === "Absent" ? undefined
    : scheme() ? projectAuthoringScheme(scheme()!, ["$arrow", "returns"]) : undefined);
  /** Public source data: its declaration's checked result scheme. The item's
   * raw type alone drops the nested owners (`List Ingredients`), which the
   * existing judgment refuses by design; any other data keeps its raw type. */
  const dataScheme = createMemo(() => fn() || props.evaluated?.sourcePath?.length ? undefined
    : publicDataDeclaredScheme(props.item.valueType, id => homeAuthoringSession().environment.getFunctionEntry?.(id),
      declared => projectAuthoringScheme(declared, ["$arrow", "returns"])));
  // B4 slice 2: a Local reader's Inspection check runs in its worker, latest
  // wins, only once the draft is edited. Checking shows no issue; Save asks
  // the worker again and never reads this memo.
  const localGuidance = reader?.kind === "local" ? createLocalLiveGuidance<{ node: ExprNode; definition?: FenelFunction;
    expectedType?: FenelType }, string | undefined>(() => reader, homeAuthoringSession, async ([item], capture, signal) => {
    if (item!.definition) {
      const handle = preparedReaderWorkerForSession(capture.facade);
      if (!handle) return [undefined];
      const rootDeclaration = savedExpressionDeclaration(item!.node);
      const reply = await runPreparedReaderWorker(handle, { method: "function-body-save-issue", node: item!.node, definition: item!.definition,
        ...(rootDeclaration ? { rootDeclaration } : {}), ...(capture.sourceMetadata ? { sourceMetadata: capture.sourceMetadata.packet } : {}),
        priority: "guidance" }, signal) as AuthoringFunctionBodySaveIssue;
      return [reply.issue];
    }
    const reply = await expressionSaveIssueInWorker(capture.facade, item!.node, props.savedExprById, {
      ...(item!.expectedType === undefined ? {} : { expectedType: item!.expectedType }),
      ...(capture.sourceMetadata ? { sourceMetadata: capture.sourceMetadata } : {}), priority: "guidance" }, signal);
    return reply ? [reply.issue] : [undefined];
  }, { batch: 1, label: "inspection" }) : undefined;
  onCleanup(() => localGuidance?.dispose());
  // A complete draft's check showed at open on the page: one request at open.
  // B4 unit D item 2: the open-time completeness check lowers in the worker.
  openLocalLiveGuidance(localGuidance, () => reader, homeAuthoringSession, draft, id => props.savedExprById.get(id));
  createEffect(() => untouched() ? undefined : draftValueFingerprint(draft()), edited => { if (edited !== undefined) localGuidance?.touch(); });
  const checkedDraftIssue = createMemo(() => {
    const definition = state.functionBaseline ?? fn();
    if (definition && definition.body === undefined) return undefined;
    if (localGuidance) {
      const expectedType = props.evaluated?.sourcePath?.length ? undefined : props.item.valueType;
      return localGuidance.read({ node: draft(), ...(definition ? { definition } : expectedType === undefined ? {} : { expectedType }) });
    }
    const session = homeAuthoringSession();
    const resolveSavedExpr = (id: string) => props.savedExprById.get(id);
    return definition ? functionBodySaveIssue(draft(), definition, { ...session.environment, resolveSavedExpr }, {
      registry: session.registry, evaluateContext: session.evaluateContext,
    }) : draftSaveIssue(draft(), session.environment, {
      expectedType: props.evaluated?.sourcePath?.length ? undefined : props.item.valueType,
      ...(dataScheme() ? { expectedScheme: dataScheme() } : {}),
      registry: session.registry, evaluateContext: session.evaluateContext, resolveSavedExpr,
    });
  });
  // Polish lane 2 (Nov 9): a type the checker names by its identity reads by its label.
  const draftIssue = createMemo(() => {
    const issue = checkedDraftIssue();
    return issue ? readableIdentities(issue, (id) => locale(getLabel(id))) : issue;
  });
  const codeTypeEnv = createMemo(() => {
    const env = new Map();
    for (const param of parameters()) {
      try { env.set(param.name, typeToSetExpr(param.type)); }
      catch { env.set(param.name, buildSetExpr.all()); }
    }
    return env;
  });
  /** Typed text the worker has not read yet: Save reads it first. The plain
   * value is read synchronously; its signal holds the surface's prints. Declared
   * before the print below, whose `hold` reads it at creation (fix lane A, Nov 8). */
  const sourceReadPending = state.sourceReadPending;
  function setPendingSourceText(text: string | undefined) { state.pendingSourceText = text; state.setSourceReadPending(text !== undefined); }
  // B4 unit C: a Local reader prints and reads its Inspection text in its
  // worker (the shared `expression-text.ts`, as on the page for Account and
  // public readers); its page session is not read for text.
  // Prints follow edits: guidance weight, and none while typed text waits
  // for its read (the read's draft is printed next).
  const localText = localGuidance ? createLocalExpressionPrint(() => reader, homeAuthoringSession, () =>
    fn()?.body === undefined && fn() ? undefined : { node: draft(), lookup: id => props.savedExprById.get(id), presentation: "inspection",
      boundNames: fn()?.params.map((param) => param.name) ?? [] }, { priority: "guidance", hold: () => sourceReadPending() }) : undefined;
  const localTyping = localGuidance ? createLocalExpressionTyping(() => reader, homeAuthoringSession, (text, read) => {
    if (state.pendingSourceText !== text || state.sourceText() !== text) return;
    setPendingSourceText(undefined);
    applyReadSource(read);
  }) : undefined;
  onSettled(() => {
    const text = state.pendingSourceText;
    if (text !== undefined && localTyping) localTyping.type(text, parameters().map(param => param.name));
  });
  const codeNames = createMemo(() => localGuidance ? undefined : inspectionFunctionCodeName(homeAuthoringSession()));
  /** The printed source and how it reads back; `undefined` while a Local
   * reader's worker prints it. */
  const printedSource = createMemo<{ text: string; readable: boolean; parseError?: string; failure?: string } | undefined>(() => {
    if (fn()?.body === undefined && fn()) {
      const text = itemFenelSource(props.item, props.savedExprById, props.evaluated);
      return { text, ...expressionTextReadability(text) };
    }
    if (localText) {
      const reply = localText.print();
      if (!reply) return undefined;
      return reply.$tag === "Ok" ? reply._0 : { text: "", readable: false, failure: reply._0 };
    }
    const text = printAuthoringExpressionText(draft(), id => props.savedExprById.get(id), homeAuthoringSession(),
      { boundNames: fn()?.params.map((param) => param.name) ?? [], presentation: "inspection", codeNames: codeNames() });
    return { text, ...expressionTextReadability(text) };
  });
  const source = () => printedSource()?.text ?? "";
  // A CodeMirror edit may be incomplete. Its last admitted node remains the
  // shared visual draft; only another visual edit replaces the user's text.
  createEffect(() => ({ node: draft(), reading: printedSource() }), ({ node, reading }) => {
    if (!reading) return;
    const printed = reading.text;
    if (state.sourceError() && state.draft() === undefined && state.sourceText() !== undefined) return;
    const fingerprint = draftValueFingerprint(node);
    const sameNode = state.sourceFingerprint === fingerprint;
    if (sameNode && state.generatedSourceText === printed) return;
    const replacingGeneratedText = state.sourceText() === state.generatedSourceText;
    state.generatedSourceText = printed;
    // A printer diagnostic describes an unavailable text presentation. The
    // admitted visual expression remains editable; only the user's Code parse
    // failures belong to sourceError and prevent applying their draft.
    if (reading.failure !== undefined) state.setSourceUnavailable(reading.failure);
    else if (!reading.readable) {
      state.setSourceUnavailable("Part of this expression has no text form yet; edit it in the editor.");
    } else state.setSourceUnavailable(reading.parseError);
    if (sameNode && !replacingGeneratedText) return;
    state.sourceFingerprint = fingerprint;
    state.setSourceText(printed);
    if (state.draft() === undefined && !state.saveInFlight) state.acceptedSourceText = printed;
    state.setSourceError(undefined);
  });
  function changeCode(text: string) {
    if (props.readOnly || state.sourceUnavailable()) return;
    if (text === (state.sourceText() ?? source())) return;
    if (state.draft() === undefined) {
      const admitted = cloneDraftValue(draft());
      state.sourceFingerprint = draftValueFingerprint(admitted);
      state.setDraft(admitted);
    }
    state.setSourceText(text);
    state.setSaveNotice(undefined);
    state.setSaveError(undefined);
    const names = parameters().map(param => param.name);
    if (localTyping) {
      // Typing reads in the worker at guidance weight, latest wins.
      setPendingSourceText(text);
      localTyping.type(text, names);
      return;
    }
    try { applyReadSource({ $tag: "Ok", _0: readAuthoringExpressionText(text, names, homeAuthoringSession()) }); }
    catch (error) { applyReadSource({ $tag: "Err", _0: error instanceof Error ? error.message : String(error) }); }
  }
  function applyReadSource(read: LocalTextRead) {
    if (read.$tag === "Err") { state.setSourceError(read._0); return; }
    state.sourceFingerprint = draftValueFingerprint(read._0);
    state.setDraft(read._0);
    state.setSourceError(undefined);
  }
  /** Local Save: typed text the worker has not read yet is read first, at
   * Save weight; `false` when it does not read (its error is shown). */
  async function readPendingSource(signal: AbortSignal): Promise<boolean> {
    const text = state.pendingSourceText;
    if (text === undefined || !localTyping) return true;
    localTyping.cancel();
    const read = await readLocalExpressionText(reader, homeAuthoringSession, text, parameters().map(param => param.name), { signal });
    if (state.sourceText() !== text) throw new Error(LOCAL_SAVE_DRAFT_CHANGED);
    setPendingSourceText(undefined);
    applyReadSource(read);
    return read.$tag === "Ok";
  }
  function formatCode() {
    if (!state.sourceError() && printedSource() && state.pendingSourceText === undefined) state.setSourceText(source());
  }
  function changeDraft(node: ExprNode) {
    if (props.readOnly) return;
    localTyping?.cancel();
    setPendingSourceText(undefined);
    state.sourceFingerprint = undefined;
    state.generatedSourceText = undefined;
    state.setSourceText(undefined);
    state.setSourceError(undefined);
    state.setSaveNotice(undefined);
    state.setSaveError(undefined);
    state.setDraft(node);
  }
  function cancelChanges() {
    if (state.saveInFlight || state.saving()) return;
    localTyping?.cancel();
    setPendingSourceText(undefined);
    state.setDraft(undefined);
    state.sourceFingerprint = undefined;
    state.generatedSourceText = undefined;
    state.setSourceError(undefined);
    state.setSourceUnavailable(undefined);
    state.setSourceText(undefined);
    state.setSaveNotice(undefined);
    state.setSaveError(undefined);
  }
  let disposed = false;
  /** B4 slice 2: a Local Save admission in flight ends with this editor. */
  let saveController: AbortController | undefined;
  onSettled(() => () => { disposed = true; saveController?.abort(); });
  // The early lens kept this draft while the editing tools prepared. Its Save
  // runs here, through this lens's ordinary Save, once; a source that changed
  // meanwhile keeps the draft for review instead of saving over it.
  createEffect(() => state.earlyHandoff ? draftValueFingerprint(original()) : undefined, current => {
    const handoff = state.earlyHandoff;
    if (!handoff || current === undefined) return;
    state.earlyHandoff = undefined;
    if (current !== handoff.baseline) {
      state.setSaveError("This data changed while its editing tools prepared. Your draft is kept here: review it, then save.");
      return;
    }
    if (handoff.commit) void saveChanges();
  });
  async function saveChanges() {
    if (props.readOnly || state.saveInFlight || state.sourceError() && state.pendingSourceText === undefined
      || fn() && fn()!.body === undefined) return;
    // B4 slice 2: a Local Save asks its worker below and never reads the
    // live guidance memo; the page check stays for Account and public readers.
    if (!localGuidance) {
      const issue = draftIssue();
      if (issue) { state.setSaveError(issue); return; }
    }
    const focused = data?.focusedExpressionState() === state;
    const current = () => focused ? data?.focusedExpressionState() === state : !disposed;
    state.saveInFlight = true;
    state.setSaving(true);
    state.setSaveNotice(undefined);
    state.setSaveError(undefined);
    const saveSignal = (saveController = new AbortController()).signal;
    try {
      // B4 unit C: a Local reader's typed text is read in its worker first.
      if (state.pendingSourceText !== undefined && !await readPendingSource(saveSignal)) return;
      const submitted = cloneDraftValue(draft());
      const submittedFingerprint = draftValueFingerprint(submitted);
      const submittedSource = state.sourceText();
      const definition = state.functionBaseline ?? fn();
      if (definition && (!fn() || draftValueFingerprint(fn()) !== draftValueFingerprint(definition))) {
        throw new Error("This function changed while editing. Your draft is kept here.");
      }
      if (localGuidance && reader) {
        // Save cancels this surface's guidance first, then waits on its own
        // admission (weight 0), never behind guidance.
        localGuidance.cancel();
        const admission = { reader, session: homeAuthoringSession, signal: saveSignal, draftScope,
          current: () => { if (!current()) throw new Error("This editor was closed before the data was saved."); } };
        const expectedType = props.evaluated?.sourcePath?.length ? undefined : props.item.valueType;
        const issue = definition ? await localFunctionBodySaveIssue(submitted, definition, admission)
          : await localExpressionSaveIssue(submitted, { ...admission, saved: props.savedExprById, ...(expectedType === undefined ? {} : { expectedType }) });
        if (issue) throw new Error(issue);
      }
      const session = homeAuthoringSession();
      const epoch = sessionEpoch();
      const receipt: { body?: unknown } = {};
      const destination = await data?.saveInspection(props.item, submitted, definition, state.saveOrigin, receipt) ?? "lens";
      assertCurrentSession(epoch);
      if (!current()) return;
      let value: RenderedCardValue | undefined;
      if (destination === "lens" && !definition) {
        const path = props.evaluated?.sourcePath ?? [];
        if (submitted.kind === "call" && getIOAction(submitted.fnId)) {
          value = { value: undefined, source: submitted, sourcePath: path };
        } else if (localGuidance) {
          // B4 slice 2: a Local lens result is evaluated by the reader's worker.
          const job = evaluateExpressionInWorker(session, submitted, props.savedExprById, saveSignal);
          if (!job) throw new Error(LOCAL_SAVE_TOOLS_PENDING);
          const result = await job;
          assertCurrentSession(epoch);
          if (!current()) return;
          value = { value: followLocusPath(result.result, path, resolveCatalogReference).value, source: submitted, sourcePath: path };
        } else {
          const result: LocusCardResult = evaluateAuthoringExpression(submitted, id => props.savedExprById.get(id), session);
          if (result.error) throw new Error(result.error);
          value = { value: followLocusPath(result.result, path, resolveCatalogReference).value, source: submitted, sourcePath: path };
        }
      }
      const unchanged = draftValueFingerprint(draft()) === submittedFingerprint && state.sourceText() === submittedSource;
      state.setSavedDraft(submitted);
      state.setSavedValue(value);
      if (definition && destination === "data") {
        // B4 unit D item 2: a Local reader's baseline is the body its Save
        // lowered (in the function's worker frame) and persisted.
        const body = localGuidance && reader ? receipt.body : toLogic(submitted, undefined, session);
        state.functionBaseline = cloneDraftValue({ ...definition, body: body as FenelFunction["body"] });
      }
      if (unchanged) {
        state.setDraft(undefined);
        state.sourceFingerprint = undefined;
        state.generatedSourceText = undefined;
        // A Local text still being printed keeps the editor's text.
        const acceptedText = printedSource() ? source() : state.sourceText();
        state.setSourceText(acceptedText);
        state.acceptedSourceText = acceptedText;
      }
      state.setSaveNotice(temporaryEdits() ? "Applied locally." : destination === "lens" ? "Applied in this lens." : "Saved.");
    } catch (error) {
      if (current()) state.setSaveError(error instanceof Error ? error.message : String(error));
    } finally {
      state.saveInFlight = false;
      if (current()) state.setSaving(false);
    }
  }
  const dirty = createMemo(() => {
    const node = state.draft();
    const text = state.sourceText();
    return !!state.sourceError() || sourceReadPending()
      || node !== undefined && draftValueFingerprint(node) !== draftValueFingerprint(state.savedDraft() ?? original())
      || text !== undefined && text !== state.acceptedSourceText && text !== state.generatedSourceText;
  });
  const canEditValue = () => !props.readOnly && !state.saving() && !fn();
  function stageValue(edit: ValueEdit) {
    if (!canEditValue()) throw new Error("This data is not editable here.");
    if (sourceReadPending() || state.sourceError()) throw new Error("Finish the current code edit first.");
    const session = homeAuthoringSession();
    const options: ExpressionEditOptions = { constructorFields: id => {
      const entry = session.environment.getFunctionEntry?.(id);
      return entry?.kind === "constructor" ? entry.params.map(param => param.name) : undefined;
    } };
    const path = [...(props.evaluated?.sourcePath ?? []), ...edit.path];
    // The existing authored-path owner refuses a computed child. A centre
    // edit changes this same draft; only the session's Save can persist it.
    changeDraft("append" in edit
      ? edit.append.reduce((node, child) => appendExpressionAt(node, path, child, options), draft())
      : replaceExpressionAt(draft(), path, edit.expr, options));
  }
  const previewing = () => dirty() && !fn();
  const previewBlocked = () => {
    if (state.sourceError()) return "Fix the code to preview this draft.";
    const node = draft();
    return node.kind === "call" && getIOAction(node.fnId) ? "Run this call from its card to see its data." : undefined;
  };
  const previewInput = createMemo(() => {
    const expr = draft();
    const skip = !previewing() || sourceReadPending() || !!previewBlocked();
    const controller = new AbortController();
    onCleanup(() => controller.abort());
    return { expr, saved: props.savedExprById, session: homeAuthoringSession(), skip,
      transient: true, signal: controller.signal };
  });
  const preview = createLocusCardEvaluation(previewInput);
  const previewValue = createMemo<RenderedCardValue>(() => {
    const path = props.evaluated?.sourcePath ?? [];
    return { value: followLocusPath(preview.value().result, path, resolveCatalogReference).value,
      source: draft(), sourcePath: path };
  });
  return { state, draftScope, fn, declaration, draft, untouched, annotatedType, parameters, bodyScheme, dataScheme,
    draftIssue, codeTypeEnv, printedSource, source, sourceReadPending, changeCode, formatCode,
    changeDraft, cancelChanges, saveChanges, dirty, canEditValue, stageValue, previewing, previewBlocked, preview, previewValue,
    readOnly: () => !!props.readOnly };
}

type InspectionExpressionController = ReturnType<typeof createInspectionExpressionController>;
type InspectionExpressionOwner = {
  type: (item: LayoutItem) => FenelType | undefined;
  focusedExpressionState: () => ReturnType<typeof createInspectionExpressionState>;
  inspectionOrigin: () => InspectionSaveOrigin | undefined;
  saveInspection: (item: LayoutItem, expr: ExprNode, fn?: FenelFunction, origin?: InspectionSaveOrigin,
    receipt?: { body?: unknown }) => Promise<"data" | "lens">;
};
const InspectionSessionContext = createContext<(() => InspectionExpressionController | undefined) | null>(null);
type InspectionValueEdit = { controller: () => InspectionExpressionController | undefined; available: () => boolean;
  path: () => readonly LocusPathStep[]; focused: () => boolean };
const InspectionValueEditContext = createContext<InspectionValueEdit | null>(null);
const InspectionQuickEdit = lazy(async () => ({ default: (await import("~/lib/locus-quick-edit")).LocusQuickEdit }));

/** The whole value's actions sit with its name, independent of open panels. */
function InspectionSessionActions(props: { controller?: InspectionExpressionController;
  /** A public example's Local copy: the same place and button as Save and
   * Discard, never together with them (owner review, Nov 11). */
  editInLocal?: { offered: () => boolean; onEdit: () => void; disabled?: () => boolean } }) {
  const changes = (controller: InspectionExpressionController | undefined) => controller
    ? { readOnly: controller.readOnly(), dirty: controller.dirty(), saving: controller.state.saving() } : undefined;
  return <>
  <Show when={editInLocalShown(!!props.editInLocal?.offered(), changes(props.controller))}>
    <LensEditInLocalAction onEdit={() => props.editInLocal?.onEdit()} disabled={props.editInLocal?.disabled?.()} />
  </Show>
  <Show when={props.controller} keyed>{controller => <div class="inspection-session-actions">
    <Show when={dataChangesShown(changes(controller))}>
      <div class="inspection-session-actions__buttons" role="group" aria-label="Data changes">
        <button type="button" class="btn inspection-session-actions__discard" disabled={controller.state.saving()}
          onClick={controller.cancelChanges}><span aria-hidden="true"><IconByName name="x" size={15} /></span><span>Discard</span></button>
        <button type="button" class="btn inspection-session-actions__save"
          disabled={controller.state.saving() || !!controller.state.sourceError() || !!controller.draftIssue()
            || !!controller.fn() && controller.fn()!.body === undefined}
          data-tooltip={controller.draftIssue()} onClick={() => void controller.saveChanges()}>
          <span aria-hidden="true"><IconByName name="check" size={15} /></span><span>{controller.state.saving() ? "Saving…" : "Save"}</span>
        </button>
      </div>
    </Show>
    <Show when={controller.state.saveError()}>{error => <p class="data-error" role="alert">{error()}</p>}</Show>
  </div>}</Show>
  </>;
}

/** Only the pending/error wrapper is new; the data still uses its universal renderer. */
function InspectionDraftPreview(props: { controller?: InspectionExpressionController; item?: LayoutItem;
  savedExprById: Map<string, ExprNode>; bodyOnly?: boolean; fallback: () => JSX.Element }) {
  return <Show when={props.controller?.previewing() && props.item ? props.controller : undefined} keyed fallback={props.fallback()}>
    {controller => <Show when={!controller.previewBlocked()} fallback={<p class="text-muted" role="status">{controller.previewBlocked()}</p>}>
      <Show when={!controller.sourceReadPending() && !controller.preview.loading()} fallback={<CardLoadingIndicator label="Previewing changes…" />}>
        <Show when={!controller.preview.value().error} fallback={<ValueFailure message={controller.preview.value().error}
          retry={() => { void controller.preview.retry(); }} />}>
          <InspectionDataValue item={props.item!} value={controller.previewValue().value}
            evaluated={controller.previewValue()} savedExprById={props.savedExprById}
            expressionState={controller.state} controller={controller} bodyOnly={props.bodyOnly} />
        </Show>
      </Show>
    </Show>}
  </Show>;
}

/** Parameters remain unknown bindings in the existing universal editor. */
function InspectionExpression(props: { item: LayoutItem; savedExprById: Map<string, ExprNode>;
  evaluated?: RenderedCardValue; initialCode?: boolean; state?: ReturnType<typeof createInspectionExpressionState>;
  controller?: InspectionExpressionController;
  presentation?: "visual" | "code"; dataExpression?: ExprNode; readOnly?: boolean }) {
  const { reader, homeAuthoringSession } = useHomeReader();
  const data = useContext(HomeDataContext);
  const shared = useContext(InspectionSessionContext);
  const controller = untrack(() => {
    if (props.controller) return props.controller;
    const session = shared?.();
    return props.state && session?.state === props.state ? session : undefined;
  }) ?? createInspectionExpressionController(props, data);
  const { state, draftScope, fn, declaration, draft, untouched, annotatedType, parameters, bodyScheme, dataScheme,
    draftIssue, codeTypeEnv, printedSource, source, changeCode, formatCode, changeDraft } = controller;
  const showingCode = () => props.presentation ? props.presentation === "code" : state.code();
  const functionReadSource = createMemo(() => {
    const node = draft();
    if (fn() || node.kind !== "literal" || detectStructuralForm(node.value)?.kind !== "lambda") return undefined;
    const session = homeAuthoringSession(), epoch = sessionEpoch(), revision = reader?.revision();
    const fingerprint = draftValueFingerprint(node);
    return { node, current: () => session === homeAuthoringSession() && epoch === sessionEpoch()
      && revision === reader?.revision() && node === draft() && fingerprint === draftValueFingerprint(draft()) };
  });
  const [inspectingType, setInspectingType] = createSignal<FenelType>();
  // A function body written as `let …; let …; result` draws as its local names
  // and its body graph (the frame the Data lens shows), not one "do block" box.
  // Edits made there return as the same lets.
  const shownDraft = createMemo(() => (fn() ? doLetChainAsWhere(draft()) : undefined) ?? draft());
  const changeShownDraft = (next: ExprNode) => changeDraft(shownDraft() !== draft() ? whereEditAsDoLetChain(next, draft()) : next);
  return <div class="data-inspection-expression">
      <Show when={declaration()}>{entry => <FunctionInspectionSignature entry={entry()} state={state} />}</Show>
      <Show when={!fn() && props.evaluated?.sourcePath?.length}>
        <p class="text-muted">Selected result: {props.evaluated!.sourcePath!.map(step => typeof step === "number" ? `item ${step + 1}` : step).join(" → ")}</p>
      </Show>
      <Show when={!props.presentation}><div class="value-expression-dialog__controls">
          <button type="button" class="btn" aria-pressed={!showingCode() ? "true" : "false"} onClick={() => state.setCode(false)}>Visual expression</button>
          <button type="button" class="btn" aria-pressed={showingCode() ? "true" : "false"} onClick={() => state.setCode(true)}>Fenel code</button>
      </div></Show>
      <div class="data-inspection-expression__content">
      <Errored fallback={(error, reset) => <ValueFailure message={String(error())} retry={reset} />}>
        <Loading fallback={<CardLoadingIndicator label={showingCode() ? "Preparing Fenel code…" : "Preparing expression…"} />}>
          <Show when={!fn() || fn()!.body !== undefined} fallback={<p class="text-muted">This function is a native declaration; it has no Fenel body.</p>}>
          <Show when={showingCode()} fallback={<Show when={functionReadSource()} fallback={<LambdaParamsContext value={parameters}><ExpressionEditor expr={shownDraft()} onChange={changeShownDraft} draftCheckScope={draftScope}
            graphAuthoring={!props.readOnly}
            graphValue={node => {
              try {
                const observed = readLocusCardResult(node, props.savedExprById, homeAuthoringSession(), { capture: true });
                return observed && !observed.error ? { value: observed.result } : undefined;
              } catch { return undefined; }
            }}
            fieldDef={fn() && fn()!.signatureDeclaration?.returns.$tag !== "Absent"
              ? { name: "body", type: bodyScheme()?.body ?? fn()!.returns, label: Nothing, meta: {}, ui: Nothing } : undefined}
            expectedScheme={bodyScheme() ?? dataScheme()}
            hideResultGuidance={!!fn() && untouched()}
            requirementSource={fn() ? "the function's result type" : undefined}
            declaredType={!fn() && !props.evaluated?.sourcePath?.length ? props.item.valueType : undefined}
            declaredReadonly="This data's type is kept with the data; this lens edits its expression."
            typeMenuItems={annotatedType() ? [{ id: "explore-type", label: fn() ? "Explore the function's type…" : "Explore this type…",
              icon: TYPE_ICON_FALLBACKS.Type, tooltip: "Try the type with generated input in a temporary playground",
              onSelect: () => setInspectingType(annotatedType()) }] : undefined}
            authoringSession={homeAuthoringSession()} viewMode="nested" hideLabel /></LambdaParamsContext>}>
            {captured => <TypedReadValue value={props.evaluated?.value} type={annotatedType()} functionSource={captured()}
              fieldRegistry={readerFieldOwner(reader, homeAuthoringSession)} />}
          </Show>}>
            {/* The signature above (FunctionInspectionSignature) already names the parameters. */}
            <div class="data-inspection-expression__code" onFocusOut={event => { if (!event.currentTarget.contains(event.relatedTarget as Node | null)) formatCode(); }}>
              {/* B4 unit C: a Local reader's first print is still on its way. */}
              <Show when={state.sourceText() !== undefined || printedSource()} fallback={<CardLoadingIndicator label="Preparing Fenel code…" />}>
              <FenelCodeEditor value={state.sourceText() ?? source()} onChange={props.readOnly || state.sourceUnavailable() ? undefined : changeCode}
                readonly={props.readOnly || !!state.sourceUnavailable()} typeEnv={codeTypeEnv()} wrapLines minHeight="200px" />
              </Show>
            </div>
            <Show when={state.sourceUnavailable()}>{message => <p class="text-muted" role="status">{message()}</p>}</Show>
          </Show>
          </Show>
        </Loading>
      </Errored>
      <Show when={state.sourceError()}>{error => <p class="data-error" role="alert">{error()}</p>}</Show>
      <Show when={!state.sourceError() && draftIssue()}>{issue => <p class="data-error" role="alert">{issue()}</p>}</Show>
      <Show when={state.saveNotice()}>{notice => <p class="text-muted" role="status">{notice()}</p>}</Show>
      </div>
      <Show when={inspectingType()}>{type => <TypeInspectionDialog type={type()} onClose={() => setInspectingType(undefined)} />}</Show>
  </div>;
}

/** The inspected container uses the same full cards as a focused Locus. Each
 * child keeps the nearest authored expression and its path into that result. */
function InspectionDataValue(props: { item: LayoutItem; value: unknown; savedExprById: Map<string, ExprNode>;
  evaluated?: RenderedCardValue; expressionState?: ReturnType<typeof createInspectionExpressionState>;
  controller?: InspectionExpressionController; bodyOnly?: boolean }) {
  const { reader, homeAuthoringSession, catalogCardOf, resolveCatalogReference } = useHomeReader();
  const data = useContext(HomeDataContext);
  const rootOccurrence = data?.occurrenceFor(() => props.item, () => props.evaluated);
  const centreEditAvailable = () => {
    const focused = data?.inspectionValue(props.item);
    return focused ? focused.available() : rootOccurrence?.state === "source" && !!rootOccurrence.edit?.available();
  };
  const callable = createMemo(() => {
    const session = homeAuthoringSession();
    if (itemFunction(props.item, props.savedExprById, session, props.evaluated, reader)) return true;
    // B3: a Local reader resolves declared names inertly (no page registry).
    const shape = props.item.valueType ? resolveValueType(props.item.valueType, name => reader?.resolveTypeName
      ? reader.resolveTypeName(name) : session.registry.getIdentifiedEntity(name)?.type
        ?? session.environment.resolveTypeRef?.({ $ref: name })) : undefined;
    return !!(shape && "$arrow" in shape);
  });
  const children = createMemo(() => props.bodyOnly && !Array.isArray(props.value) || callable() || heldTypeForInspection(props.value, catalogCardOf, resolveCatalogReference)
    ? undefined : childrenOf(props.value));
  const projected = createMemo(() => {
    const session = homeAuthoringSession();
    const linked = props.item.source?.kind === "ref" ? props.item.source.ref.id : undefined;
    const source: ExprNode | null = linked ? { kind: "ref", savedExprId: linked }
      : props.evaluated?.source ?? resolveExpr(props.item, props.savedExprById);
    return children()?.map(child => {
      const path = [...(props.evaluated?.sourcePath ?? []), child.key];
      const authored: Pick<RenderedCardValue, "source" | "sourcePath"> = source ? projectAuthoredExpression(source, path, {
        constructorFields: id => {
          const entry = session.environment.getFunctionEntry?.(id);
          return entry?.kind === "constructor" ? entry.params.map(param => param.name) : undefined;
        },
      }) : { source: undefined, sourcePath: path };
      const item: LayoutItem = { id: `$inspect:${props.item.id}:${childItemId(child.key)}`,
        ...displayNameItemFields(typeof child.key === "string" ? child.label : typedReadValueCaption(child.value, reader)),
        valueType: childValueType(props.value, props.item.valueType, child.key, session),
        source: authored.source ? { kind: "expr", expr: authored.source } : undefined };
      return { item, path: [child.key], evaluated: { value: child.value, ...authored } };
    });
  });
  return <Show when={projected()} fallback={<InspectionValueEditContext value={{ controller: () => props.controller,
    path: () => [], focused: () => !!props.bodyOnly, available: centreEditAvailable }}><InspectionDataCard item={props.item} savedExprById={props.savedExprById}
    bodyOnly={props.bodyOnly}
    functionExpression={callable()}
    expressionState={callable() ? props.expressionState : undefined}
    evaluated={{ value: props.value, ...props.evaluated }} /></InspectionValueEditContext>}>
    {cards => <div class="data-inspection-dialog__record">
      <For each={cards()} fallback={<span class="text-muted">Empty {Array.isArray(props.value) ? "list" : "record"}</span>}>
        {card => <InspectionValueEditContext value={{ controller: () => props.controller, path: () => card.path, focused: () => false, available: centreEditAvailable }}>
          <InspectionDataCard item={card.item} evaluated={card.evaluated} savedExprById={props.savedExprById}
            unsaved={data?.unsaved(props.item)} /></InspectionValueEditContext>}
      </For>
    </div>}
  </Show>;
}

/** A card's actions stay attached to this inspected occurrence rather than
 * looking its temporary id up among the surrounding lens's persisted rows. */
function InspectionDataCard(props: { item: LayoutItem; evaluated: RenderedCardValue; savedExprById: Map<string, ExprNode>;
  unsaved?: boolean;
  functionExpression?: boolean; expressionState?: ReturnType<typeof createInspectionExpressionState>; bodyOnly?: boolean }) {
  const data = useContext(HomeDataContext);
  const item = createMemo(() => props.item);
  const evaluated = createMemo(() => props.evaluated);
  function openMenu(event: MouseEvent) {
    const capturedItem = item();
    const capturedValue = evaluated();
    data?.openMenu(event, { item: capturedItem, evaluated: capturedValue,
      current: () => capturedItem === item() && capturedValue === evaluated() });
  }
  return <div onContextMenu={openMenu}>
    <EvaluatedFlowItemView item={props.item} savedExprById={props.savedExprById} evaluated={props.evaluated}
      presentation={props.bodyOnly ? "body" : undefined}
      unsaved={props.unsaved}
      inspection functionExpression={props.functionExpression} expressionState={props.expressionState}
      onRemove={() => {}} onCallFunction={data?.instantiateFunction}
      onMenu={openMenu} menuOpen={data?.menuOpen(props.item.id)} />
  </div>;
}

function FlowItemView(props: Parameters<typeof EvaluatedFlowItemView>[0]) {
  const data = useContext(HomeDataContext);
  const { itemFenelSource, localItemSource } = useHomeReader();
  // B4 wave 4 lane H: a Local reader's card code prints in its worker.
  const localCode = localItemSource(() => !!data?.codeOpen(props.item.id), () => ({ item: props.item, saved: props.savedExprById }));
  const code = localCode ?? (() => itemFenelSource(props.item, props.savedExprById));
  return <Show when={data?.dataTarget(props.item)} fallback={<Show when={data?.listSummary(props.item)} fallback={<EvaluatedFlowItemView {...props} />}>
    {(summary) => {
      const collection = () => <CollectionPreviewStrip items={summary().items} label={`${summary().name}, ${summary().count} items`}
        itemLabel={(item) => item.caption || "Data"} onOpenItem={(item) => summary().enter(item)}
        onEnterCollection={() => data?.enter(props.item)}
        render={(item) => <ListItemPreview item={item} savedExprById={summary().savedExprById} />}
        preview={(item) => <EvaluatedFlowItemView item={item} savedExprById={summary().savedExprById}
          onRemove={() => {}} preview />} />;
      return <ValueCard itemId={props.item.id} presentation={props.presentation}
      class={data?.desktop() && !props.preview && !data?.codeOpen(props.item.id) ? "home-item--desktop" : undefined}
      codeOpen={data?.codeOpen(props.item.id)}
      menuOpen={data?.menuOpen(props.item.id)}
      onMenu={(event) => data?.openMenu(event)}
      heading={<ValueCardHeading item={props.item} caption={summary().name} type={List(Anything)} declaredType={summary().type}
        icon="list" representations={props.item.representations} onOpen={() => data!.enter(props.item)} />}
      code={code} onOpen={() => data!.openLens(props.item)}
      actions={<>
        <ItemExpressionAction item={props.item} savedExprById={props.savedExprById} />
        <Show when={data?.demoCopyBranch(props.item.id, typeof props.item.caption === "string" ? props.item.caption : undefined)}>{branch => <button type="button" class="btn"
          data-tooltip="Copy this example into Local and edit it there"
          onClick={event => { event.stopPropagation(); const next = data?.demoCopyBranch(props.item.id, typeof props.item.caption === "string" ? props.item.caption : undefined); if (next) data?.editDemoInLocal(next); }}>Edit in Local</button>}</Show>
      </>}>
      <Show when={data?.desktop() && !props.preview} fallback={collection()}>
        <DesktopDataPreview label={summary().name} collection={collection()} onOpen={() => data!.enter(props.item)} />
      </Show>
    </ValueCard>; }}
  </Show>}>{target => <ValueCard itemId={props.item.id} presentation={props.presentation} codeOpen={data?.codeOpen(props.item.id)} menuOpen={data?.menuOpen(props.item.id)}
    onMenu={event => data?.openMenu(event)} onOpen={() => data?.openLens(props.item)}
    heading={<ValueCardHeading item={props.item} caption={props.item.caption} value={target()} type={props.item.valueType} declaredType={props.item.valueType}
      representations={props.item.representations} onOpen={() => data?.enter(props.item)} />}
    code={code}
    actions={<ItemExpressionAction item={props.item} savedExprById={props.savedExprById} />}>
    <DataThumbnail value={target()} valueIcon={typeof props.item.representations?.Iconable?.icon === "string" ? props.item.representations.Iconable.icon : undefined}
      emoji={typeof props.item.representations?.Emojiable?.emoji === "string" ? props.item.representations.Emojiable.emoji : undefined} />
  </ValueCard>}</Show>;
}

function EvaluatedFlowItemView(props: {
  item: LayoutItem;
  savedExprById: Map<string, ExprNode>;
  onRemove: () => void;
  onDuplicate?: () => void;
  onEdit?: () => void;
  onMoveUp?: () => void;
  onMoveDown?: () => void;
  onCallFunction?: (pin: { $pin: string; name: string; id: string }) => void;
  preview?: boolean;
  inspection?: boolean;
  functionExpression?: boolean;
  expressionState?: ReturnType<typeof createInspectionExpressionState>;
  onMenu?: (event: MouseEvent) => void;
  menuOpen?: boolean;
  /** Hovering already-rendered data never converts it back into executable expressions. */
  evaluated?: RenderedCardValue;
  unsaved?: boolean;
  /** The lens already presents this subject's heading and type. */
  presentation?: "body";
  /** Source-selected Viewable must precede the collection-summary fallback. */
  wholeView?: boolean;
  contentFirst?: boolean;
  generatedCaption?: boolean;
  /** A list or grid gutter numbers this card (ValueCardHeading `indexed`). */
  indexed?: boolean;
}) {
  const { reader, homeAuthoringSession, itemFenelSource, localItemSource, callableName } = useHomeReader();
  const data = useContext(HomeDataContext);
  // B4 wave 4 lane H: a Local reader's card code prints in its worker.
  const localCode = localItemSource(() => !props.preview && !!data?.codeOpen(props.item.id),
    () => ({ item: props.item, saved: props.savedExprById, evaluated: props.evaluated ?? data?.evaluated(props.item) }));
  // Use getter properties on the literal so the hook's memos read
  // through to FlowItemView's reactive `props` and re-evaluate when
  // savedExprById populates (the savedQueries fetch is async — the
  // Map starts empty and arrives a moment later). A plain
  // `{item: props.item, savedExprById: props.savedExprById}` literal
  // would snapshot the values once and leave resolveExpr returning
  // null forever ("Reference resolved to nothing.").
  const surface = useIOCallSurface({
    get item() {
      return props.item;
    },
    get savedExprById() {
      return props.savedExprById;
    },
    get preview() { return props.preview; },
    get evaluated() { return props.evaluated; },
  });
  const enterableValue = () => surface.evaluated().result;
  // The focused function reads only this occurrence's authored source, just
  // as Code does. A computed result path is not the lambda that produced it.
  const functionReadSource = createMemo(() => {
    if (!props.functionExpression && !(props.item.id === "$self" && !props.preview)) return undefined;
    if (!props.functionExpression && surface.pinInfo()?.$pin !== "function") {
      const type = surface.cardResultType(), session = homeAuthoringSession();
      const shape = type && resolveValueType(type, id => reader?.resolveTypeName ? reader.resolveTypeName(id)
        : session.registry.getIdentifiedEntity(id)?.type ?? session.environment.resolveTypeRef?.({ $ref: id }));
      if (!shape || !("$arrow" in shape)) return undefined;
    }
    const item = props.item, saved = props.savedExprById;
    const authored = () => {
      const observed = props.evaluated ?? data?.evaluated(props.item);
      return observed?.sourcePath?.length ? undefined : observed?.source ?? resolveExpr(props.item, props.savedExprById) ?? undefined;
    };
    const node = authored();
    const session = homeAuthoringSession(), epoch = sessionEpoch(), revision = reader?.revision();
    const fingerprint = draftValueFingerprint(node);
    // A value that REFERENCES a function this reader can read (a catalogue
    // recipe) draws that function's body, by the Expression panel's own path
    // (itemFunction, then the codec with its parameter names). One it cannot
    // read keeps the reference, which reads as unavailable.
    // Its declaration says which signature slots were written and which inferred.
    let origins: FunctionSignatureOrigins | undefined = undefined;
    const shown = (() => {
      if (!node || node.kind === "literal" && detectStructuralForm(node.value)?.kind === "lambda") return node;
      try {
        const fn = itemFunction(item, saved, session, props.evaluated ?? data?.evaluated(item), reader);
        if (fn?.body === undefined) return node;
        const names = fn.params.map(param => param.name);
        origins = functionSignatureOrigins(fn.signatureDeclaration);
        return heldFunctionLambda(names, logicToExprNode(fn.body, names, session));
      } catch { return node; }
    })();
    return { node: shown, origins, current: () => item === props.item && saved === props.savedExprById && session === homeAuthoringSession()
      && epoch === sessionEpoch() && revision === reader?.revision() && node === authored()
      && fingerprint === draftValueFingerprint(authored()) };
  });
  function DesktopPreview() {
    const presentation = useDataTypePresentation({
      get type() { return surface.cardResultType(); },
      get declaredType() { return props.item.valueType; },
      get value() { return enterableValue(); },
    });
    return <DesktopDataPreview label={surface.displayCaption()}
      icon={typeof props.item.representations?.Iconable?.icon === "string" ? props.item.representations.Iconable.icon : presentation().icon}
      preview={hasDataPreview(enterableValue()) ? <TypedReadValue value={enterableValue()} type={surface.cardResultType()} callableName={callableName} compact /> : undefined}
      collection={Array.isArray(enterableValue()) ? <ResultBody value={enterableValue()} item={props.item}
        localReps={props.item.representations} /> : undefined}
      onOpen={() => data?.openDesktop(props.item, { value: enterableValue() })} />;
  }
  createEffect(() => props.preview || props.inspection ? "" : carrierTypeName(surface.evaluated().result) ?? "", (name) => {
    if (name) data?.repairType(props.item, name);
  });
  return (
    <ValueCard itemId={props.item.id} busy={surface.loading()} presentation={props.presentation}
      class={data?.desktop() && !props.preview && !props.inspection && !data?.codeOpen(props.item.id) ? "home-item--desktop" : undefined}
      codeOpen={data?.codeOpen(props.item.id)}
      menuOpen={props.menuOpen ?? data?.menuOpen(props.item.id)}
      cut={data?.cutId() === props.item.id}
      onOpen={(props.contentFirst || props.indexed && props.generatedCaption) && !props.preview && data ? () => data.enter(props.item, props.evaluated ?? data.evaluated(props.item)) : undefined}
      onMenu={props.preview ? undefined : props.onMenu ?? ((event) => data?.openMenu(event))}
      heading={<ValueCardHeading item={props.item} unsaved={props.unsaved} caption={surface.displayCaption()} type={surface.cardResultType()} declaredType={props.item.valueType}
          contentFirst={props.contentFirst} generatedCaption={props.generatedCaption} indexed={props.indexed}
          value={surface.evaluated().result}
          representations={props.item.representations} onOpen={!props.preview && data
            ? () => data!.enter(props.item, props.evaluated ?? data.evaluated(props.item)) : undefined} />}
      code={props.preview ? undefined : localCode ?? (() => itemFenelSource(props.item, props.savedExprById,
        props.evaluated ?? data?.evaluated(props.item)))}
      actions={
        <Show when={!props.preview}>
        <IOCallStatusBadges surface={surface} />
        <IOCallActionButtons surface={surface} onCallFunction={props.onCallFunction} />
        <ItemExpressionAction item={props.item} savedExprById={props.savedExprById}
          evaluated={props.evaluated ?? data?.evaluated(props.item)} />
        </Show>
      }>
        <Show when={surface.evaluated().error}>
          <ValueFailure message={surface.evaluated().error} label={props.item.caption} retry={() => { void surface.retryEvaluation(); }} />
        </Show>
        <Show when={!surface.loading() && !surface.evaluated().error}>
          {/* Match the canvas: suppress the bare-value placeholder for IO
              call cards (the call itself is the value — the runtime
              executes it on Run), so "(none)" doesn't float above the
              real IO result section. */}
          <Show
            when={
              !surface.ioCallInfo() ||
              (surface.evaluated().result != null && surface.evaluated().result !== undefined)
            }
          >
            <Show when={props.wholeView} fallback={<Show when={data?.desktop() && !props.preview && !props.inspection} fallback={<ResultBody
              value={surface.evaluated().result}
              item={props.item}
              evaluated={props.evaluated ?? data?.evaluated(props.item)}
              onCallFunction={props.onCallFunction}
              localReps={props.item.representations}
              preview={props.preview || props.inspection} inspection={props.inspection}
              functionSource={functionReadSource()}
            />}><DesktopPreview /></Show>}>
              <TypedReadValue value={surface.evaluated().result} type={surface.cardResultType()}
                fieldRegistry={readerFieldOwner(reader, homeAuthoringSession)} callableName={callableName} functionSource={functionReadSource()} />
            </Show>
          </Show>
          <Show when={!props.preview}><IOCallExtras surface={surface} /></Show>
        </Show>
    </ValueCard>
  );
}

/** The actions a card's header offers for its item: enter, move out, move up
 *  and down, edit, duplicate, remove. Shared by the card (EvaluatedFlowItemView)
 *  and a table row, so changing layout never takes an action away. */
function ItemHeaderActions(props: {
  item: LayoutItem;
  /** The item's evaluated value, which decides whether it can be entered. */
  value: unknown;
  onRemove: () => void;
  onDuplicate?: () => void;
  onEdit?: () => void;
  onMoveUp?: () => void;
  onMoveDown?: () => void;
}) {
  const cardTransfer = useContext(HomeDataContext);
  return (
    <button type="button" class="home-item__btn" aria-label="Actions" aria-haspopup="menu" data-tooltip="Actions"
      aria-expanded={cardTransfer?.menuOpen(props.item.id) ? "true" : "false"}
      onClick={(event) => { event.stopPropagation(); cardTransfer?.openMenu(event); }}>
      <IconByName name="menu" size={14} />
    </button>
  );
}

function FunctionPinCard(props: {
  pin: { $pin: string; name: string; id: string };
  onCall?: () => void;
  embedded?: boolean;
  signature?: boolean;
  /** A data-card preview, rather than the focused function or its inspector. */
  preview?: boolean;
  /** Per-card overrides keyed by typeclass name. Closest scope wins —
   *  this card's overrides shadow the underlying value's typeclass
   *  instances. See LayoutItem.representations. */
  localReps?: Record<string, Record<string, unknown>>;
}) {
  const { reader, api, publicDataSelected, callableName, homeAuthoringSession } = useHomeReader();
  const inline = useValueCardInline();
  const signature = createMemo(() => {
    const session = homeAuthoringSession();
    // B4 wave 4 lane H: a Local reader's function is its worker's catalogue
    // answer (pending: no signature yet); the page registry is never read.
    const fn = reader?.kind === "local" ? reader.catalogLookups.fn(props.pin.id) as FenelFunction | undefined
      : session.registry.getFunction(props.pin.id);
    if (!fn) return undefined;
    const entry = inspectionFunctionEntry(fn, session);
    const scheme = entry.signatureOutcome?.$tag === "Solved" ? entry.scheme : undefined;
    return { arrow: scheme?.body && "$arrow" in scheme.body ? scheme.body.$arrow : { params: fn.params, returns: fn.returns }, scheme };
  });
  // Pin objects carry the codeName slug under `name`; for display we
  // prefer the function's Labelable instance (the human-readable
  // label registered at defineFunction time) and only fall back to
  // the slug's trailing segment when no label exists. Per-card
  // representation overrides win over the typeclass-registered
  // instance (Phase 1.4 — locusView per-item ephemeral scope).
  const shortName = createMemo(() => {
    const local = props.localReps?.["Labelable"]?.["label"];
    if (typeof local === "string" && local) return local;
    if (local && typeof local === "object" && "en" in (local as Record<string, unknown>)) {
      const en = (local as Record<string, unknown>)["en"];
      if (typeof en === "string" && en) return en;
    }
    return callableName(props.pin.id, props.pin.name);
  });
  const nameLeaf = (value: unknown, fallback = ""): string => {
    const code = typeof value === "string" && value ? value : fallback;
    const cut = Math.max(code.lastIndexOf(":"), code.lastIndexOf("."));
    return cut >= 0 ? code.slice(cut + 1) : code;
  };
  const typeWord = createMemo(() => {
    const body = signature()?.scheme?.body;
    if (body && typeof body === "object" && "$ref" in body && typeof (body as { $ref?: unknown }).$ref === "string") {
      const ref = (body as { $ref: string }).$ref;
      return locale(getLabel(ref)) || locale(getCodeName(ref)) || nameLeaf(ref);
    }
    if (nameLeaf(getCodeName(props.pin.id), props.pin.name) === "lubeFormula"
      || nameLeaf(getCodeName(props.pin.id), props.pin.name) === "hydrationFormula") return "Recipe";
    return "function";
  });
  const showRecipeFacts = createMemo(() => {
    if (inline()) return false;
    const body = signature()?.scheme?.body;
    if (body && typeof body === "object" && "$ref" in body && typeof (body as { $ref?: unknown }).$ref === "string"
      && nameLeaf((body as { $ref: string }).$ref) === "Recipe") return true;
    const leaf = nameLeaf(getCodeName(props.pin.id), props.pin.name);
    return leaf === "lubeFormula" || leaf === "hydrationFormula";
  });
  const [showInstances, setShowInstances] = createSignal(false);
  const [instData, setInstData] = createSignal<{
    runs: any[];
    deployments: any[] | null;
    loading: boolean;
    error: string | null;
  }>({ runs: [], deployments: null, loading: false, error: null });
  async function loadInstances() {
    setInstData((s) => ({ ...s, loading: true }));
    try {
      const resp = await api.getIOInstances(props.pin.id);
      setInstData({
        runs: (resp.runs ?? []) as any[],
        deployments: (resp.deployments ?? null) as any[] | null,
        loading: false,
        error: resp.deploymentsError ?? null,
      });
    } catch (e: any) {
      setInstData({
        runs: [],
        deployments: null,
        loading: false,
        error: e?.message ?? String(e),
      });
    }
  }
  function toggleInstances() {
    const open = !showInstances();
    setShowInstances(open);
    if (open) void loadInstances();
  }
  function SampledGraph() {
    return <Show when={!inline() && signature()}>{value =>
      <FunctionGraph pinId={props.pin.id} arrow={value().arrow} session={homeAuthoringSession} />}</Show>;
  }
  return (
    <div class={["home-pin-card home-pin-card--function", { "home-pin-card--function-preview": !!props.preview && !inline() }]}>
      <Show when={!!signature() && (props.signature !== false || !!props.preview)}><div class="home-function-card__presentation">
        <Show when={props.signature !== false && signature()}>{value => <FunctionTypeBody arrow={value().arrow} scheme={value().scheme} />}</Show>
        <Show when={props.preview}><SampledGraph /></Show>
      </div></Show>
      <Show when={!props.embedded && !inline()}><div class="home-pin-card__head">
        <div class="home-pin-card__icon">ƒ</div>
        <div class="home-pin-card__info">
          <Show when={!reader && !publicDataSelected()} fallback={<span class="home-pin-card__name">{shortName()}</span>}>
          <a class="home-pin-card__name" href={`/app/functions/${encodeURIComponent(props.pin.id)}`}>
            {shortName()}
          </a>
          </Show>
          <span class="home-pin-card__type">{typeWord()}</span>
        </div>
      </div></Show>
      <Show when={showRecipeFacts()}>
        <RecipeFactsCard pinId={props.pin.id} session={homeAuthoringSession} />
      </Show>
      <Show when={!props.preview}><SampledGraph /></Show>
      <Show when={!inline()}><div class="home-pin-card__actions">
        <Show when={props.onCall && !props.embedded}>
          <button type="button" class="home-pin-card__call" onClick={() => props.onCall?.()}>
            Call
          </button>
        </Show>
        <Show when={!publicDataSelected()}><button
          type="button"
          class="home-pin-card__instances-btn"
          onClick={(e) => { e.stopPropagation(); toggleInstances(); }}
          data-tooltip="Show all instances of this function"
        >
          {showInstances() ? "Hide instances" : "Instances"}
        </button></Show>
      </div></Show>
      <Show when={showInstances()}>
        <div class="home-pin-card__instances-panel">
          <Show when={instData().loading}>
            <div class="text-muted" style="font-size: 0.72rem">Loading…</div>
          </Show>
          {/* Deployments section — only when the fn declared a
              listInstancesAction (e.g. runTelegramCollector → bots).
              null = no specialized listing; [] = listing exists but
              empty; the two read differently. */}
          <Show when={!instData().loading && instData().deployments !== null}>
            <div class="home-pin-card__instances-section-title">
              Deployments
            </div>
            <Show when={instData().deployments!.length === 0}>
              <div class="text-muted" style="font-size: 0.72rem; margin-bottom: 0.5rem">
                No active deployments.
              </div>
            </Show>
            <Show when={instData().deployments!.length > 0}>
              <ul class="home-pin-card__instances-list" style="margin-bottom: 0.5rem">
                <For each={instData().deployments!}>
                  {(row: any) => (
                    <li class="home-pin-card__instances-row">
                      <span class="mono" style="font-size: 0.72rem">{row.label ?? row.username ?? row.id}</span>
                      <Show when={row.enabled}>
                        <span style="color: #16a34a; font-size: 0.65rem; margin-left: 0.4rem">● active</span>
                      </Show>
                    </li>
                  )}
                </For>
              </ul>
            </Show>
            <Show when={instData().error}>
              <ValueFailure message={instData().error ?? undefined} label={shortName()} />
            </Show>
          </Show>
          {/* Runs section — universal. Every function-with-a-body
              produces function_instances rows when invoked. */}
          <Show when={!instData().loading}>
            <div class="home-pin-card__instances-section-title">
              Runs
            </div>
            <Show when={instData().runs.length === 0}>
              <div class="text-muted" style="font-size: 0.72rem">No runs yet.</div>
            </Show>
            <Show when={instData().runs.length > 0}>
              <ul class="home-pin-card__instances-list">
                <For each={instData().runs}>
                  {(row: any) => (
                    <li class="home-pin-card__instances-row">
                      <span class="mono" style="font-size: 0.72rem">{row.label ?? row.id}</span>
                      <Show when={row.status === "completed"}>
                        <span style="color: #6b7280; font-size: 0.65rem; margin-left: 0.4rem">● finished</span>
                      </Show>
                      <Show when={row.status === "running"}>
                        <span style="color: #16a34a; font-size: 0.65rem; margin-left: 0.4rem">● running</span>
                      </Show>
                      <Show when={row.status === "failed" || row.status === "cancelled"}>
                        <span style="color: #c0392b; font-size: 0.65rem; margin-left: 0.4rem">● {row.status}</span>
                      </Show>
                    </li>
                  )}
                </For>
              </ul>
            </Show>
          </Show>
        </div>
      </Show>
    </div>
  );
}

/** A Local tab has no instance endpoint: its data of a type are the items of
 * its own root declared with that type (the same items Home lists), previewed
 * through ListItemPreview. Shared by the type card's Instances panel and the
 * type inspector of the Edit dialog; it follows the tab's revision while shown.
 * An empty list says nothing (no empty-state claim). */
function LocalTypeInstances(props: { typeName: string }) {
  const { reader, client } = useHomeReader();
  const [localData, setLocalData] = createSignal<{ items: LayoutItem[]; saved: Map<string, ExprNode> }>();
  const localIdentity = (handle: string | undefined) => handle === undefined ? undefined
    : reader?.kind === "local" ? reader.catalogLookups.entityOwner?.(handle)?.id ?? handle : handle;
  const localInstances = createMemo(() => {
    const data = localData();
    if (!data) return [];
    const own = new Set([props.typeName, localIdentity(props.typeName)].filter((id): id is string => !!id));
    return data.items.filter(item => {
      const handle = refHandle(item.valueType);
      return handle !== undefined && (own.has(handle) || own.has(localIdentity(handle) ?? ""));
    });
  });
  async function loadLocalInstances() {
    const [{ root }, saved] = await Promise.all([client.getLocusRoot(), client.getSavedQueries()]);
    const listed = (saved as { queries?: { id: string; query?: { expr?: ExprNode } }[] })?.queries;
    setLocalData({ items: root?.items ?? [], saved: shareSavedExpressionMap(root?.expressions, listed) });
  }
  // The shown list follows the tab's edits (a newly created instance).
  createEffect(() => reader?.kind === "local" ? reader.revision() : undefined,
    (revision) => { if (revision !== undefined) void loadLocalInstances().catch(() => setLocalData(undefined)); });
  return (
    <Show when={localInstances().length > 0}>
      <ul class="home-pin-card__instances-list">
        <For each={localInstances()}>{item => <li class="home-pin-card__instances-row">
          <Show when={item.caption}>{caption => <span class="home-pin-card__instance-caption">{caption()}</span>}</Show>
          <ListItemPreview item={item} savedExprById={localData()!.saved} />
        </li>}</For>
      </ul>
    </Show>
  );
}

/** Card surfaced when the pinned value is a non-function pin —
 *  type / entity / typeclass / constructor. Mirrors FunctionPinCard
 *  but with type-appropriate actions: "Instantiate" (create a value
 *  of this type) instead of "Call", and "Instances" reads the
 *  account's persisted entity_instances rather than running fn
 *  invocations. */
function TypePinCard(props: {
  pin: { $pin: string; name: string; id: string };
  localReps?: Record<string, Record<string, unknown>>;
  expanded?: boolean;
}) {
  const { reader, homeAuthoringSession, resolveCatalogReference } = useHomeReader();
  const inline = useValueCardInline();
  // Strip the "entity:" prefix the catalog uses for routing.
  const entityName = createMemo(() => {
    const id = props.pin.id || props.pin.name;
    return id.startsWith("entity:") ? id.slice("entity:".length) : id;
  });
  const definition = createMemo(() => {
    const target = resolveCatalogReference({ id: props.pin.id, kind: props.pin.$pin });
    return target && isFenelTypeLike(target.value) ? target.value : undefined;
  });
  const [inspectingType, setInspectingType] = createSignal<FenelType>();

  // Demo 1 (Nov 8, Rom): a type's card shows its DEFINITION (one row per field:
  // label and type with its icon; variants with their fields). Its actions
  // ("New Person", "See all Person") are in the card's right-click menu; "See
  // all" adds the type's data as one live list after this card.
  return (
    <div class="home-pin-card home-pin-card--type">
      <Show when={definition()} fallback={<span class="text-muted">Type definition is unavailable.</span>}>
        {type => <TypeDataPreview type={type()} compact={inline()}
          fieldRegistry={readerFieldOwner(reader, homeAuthoringSession)} onOpenType={setInspectingType} />}
      </Show>
      <Show when={inspectingType()}>{type => <TypeInspectionDialog type={type()} onClose={() => setInspectingType(undefined)} />}</Show>
      <Show when={props.expanded && !inline()}>
        <div class="home-pin-card__instances-panel">
          <Show when={reader?.kind === "local"} fallback={<EntityInstancesPanel name={entityName()} type={definition()} />}>
            <LocalTypeInstances typeName={entityName()} />
          </Show>
        </div>
      </Show>
    </div>
  );
}

/** Extract the entity-type name encoded in an Id<X>'s phantom param.
 *  Returns null when the type isn't a $tagged Id-like wrapper. */
function entityNameFromTaggedId(t: FenelType | undefined): string | null {
  if (!t || typeof t !== "object") return null;
  const tagged = (t as { $tagged?: { value?: unknown; phantom?: unknown } }).$tagged;
  if (!tagged) return null;
  const valTag = tagged.value as { $ref?: string } | undefined;
  if (valTag?.$ref !== "Id") return null;
  const phantom = tagged.phantom as { $refined?: { set?: unknown } } | undefined;
  const sv = peelSetExpr(phantom?.$refined?.set); // dual-read $refined.set (3b-1)
  const enumVals = sv?.kind === "SeEnum" ? (sv.values as string[]) : undefined;
  if (Array.isArray(enumVals) && enumVals.length > 0) return enumVals[0]!;
  return null;
}

/** Render an Id<X> value as a typed chip — entity name + short id.
 *  No inline actions: pinToView appears as a regular operation in
 *  the operations card (a function that takes the value as input is
 *  exactly what an operation is, so no special-casing required). */
function TaggedIdChip(props: { id: string; entityType: string }) {
  const short = () => {
    const s = props.id;
    return s.length > 12 ? `${s.slice(0, 8)}…${s.slice(-4)}` : s;
  };
  return (
    <span style="display: inline-flex; align-items: center; gap: 0.35rem; padding: 0.2rem 0.5rem; background: var(--surface-2, #f3f4f6); border: 1px solid var(--border, #e5e7eb); border-radius: 0.4rem; font-size: 0.78rem;">
      <span class="tagged-id-chip__type">
        {props.entityType}
      </span>
      <span class="mono" data-tooltip={props.id}>{short()}</span>
    </span>
  );
}

/** Renders an IO call's success value with type-aware dispatch. Today
 *  it special-cases Id<X> as a chip; everything else falls through to
 *  ValueDisplay. The typeRef is the function's declared `returns`,
 *  which carries the phantom typing the runtime can't otherwise
 *  preserve (the IO handler returns a bare UUID string for Id<X>). */
function IOResultView(props: { value: unknown; typeRef: FenelType | undefined }) {
  const entityType = createMemo(() => entityNameFromTaggedId(props.typeRef));
  return (
    <Show
      when={entityType() && typeof props.value === "string" && props.value.length > 0}
      fallback={<ValueDisplay value={props.value} />}
    >
      <TaggedIdChip id={props.value as string} entityType={entityType()!} />
    </Show>
  );
}

/** Detect a `{$tag: "Id", value: <uuid>, phantom: ...}` record produced
 *  by the TaggedIdChip pin path. Returns the (entityType, id) pair when
 *  the shape matches; null otherwise. */
function detectTaggedIdValue(v: unknown): { entityType: string; id: string } | null {
  if (!v || typeof v !== "object") return null;
  const o = v as Record<string, unknown>;
  if (o["$tag"] !== "Id") return null;
  const id = o["value"];
  if (typeof id !== "string") return null;
  const phantom = o["phantom"] as { $refined?: { set?: unknown } } | undefined;
  const sv = peelSetExpr(phantom?.$refined?.set); // dual-read $refined.set (3b-1)
  const enumVals = sv?.kind === "SeEnum" ? (sv.values as string[]) : undefined;
  if (Array.isArray(enumVals) && enumVals.length > 0) {
    return { entityType: enumVals[0]!, id };
  }
  return null;
}

function FunctionTypeBody(props: {
  arrow: { params: readonly FieldDef[]; returns: FenelType };
  scheme?: TypeScheme;
}) {
  const { reader, homeAuthoringSession, knownTypeIconName, getLabel, getCodeName } = useHomeReader();
  const [inspectingType, setInspectingType] = createSignal<FenelType>();
  const entry = (type: FenelType, path: readonly string[], term?: string): FunctionCardType<FenelType> => {
    const projected = props.scheme ? projectAuthoringScheme(props.scheme, path)?.body ?? type : type;
    const id = "$ref" in projected ? projected.$ref : undefined;
    const target = presentedTypeTarget(projected);
    const own = target ? reader?.presentation(target) : undefined;
    // B4 F1: a Local reader's anonymous type captions are its worker's
    // (B3 `typePresentation`); the page frame is never read for it.
    const local = reader?.kind === "local";
    const presented = local && !id ? reader.typePresentation?.(projected) : undefined;
    const frame = local ? undefined : homeAuthoringSession().evaluateContext;
    const icon = id ? knownTypeIconName(id) : local ? presented?.icon : frame?._specRegistry
      ? resolveEffect(frame, frame._specRegistry, "Iconable", projected)?.methods.icon : undefined;
    return { type: projected, label: peelResultForAuthoring(projected)
      ? local ? valueCardTypeLabel(reader.typePresentation?.(projected)?.label ?? "") || "Type" : typedReadTypePresentation(projected, homeAuthoringSession(), reader).label
      : typeCode(projected, handle => locale(getLabel(handle)) ?? locale(getCodeName(handle)) ?? handle).replaceAll("->", "→"),
      icon: typeof icon === "string" && LUCIDE_BY_NAME[icon] ? icon : undefined,
      ownIcon: own?.icon, ownEmoji: own?.emoji, term };
  };
  const inputs = createMemo(() => props.arrow.params.map((param, index) => entry(param.type,
    ["$arrow", "params", String(index), "type"], param.name)));
  const output = createMemo(() => entry(props.arrow.returns, ["$arrow", "returns"]));
  return <>
    <FunctionCardBody inputs={inputs()} output={output()}
      previewType={type => <ValueCard heading={<ValueCardCaption caption={type.label} icon={type.ownIcon} emoji={type.ownEmoji}
        typeLabel="Type" typeIcon={TYPE_ICON_FALLBACKS.Type} />}>
        <TypedReadValue value={type.type} type={{ $type: true }} compact fieldRegistry={readerFieldOwner(reader, homeAuthoringSession)} />
      </ValueCard>}
      onOpenType={type => setInspectingType(type.type)}
      onOpenInputs={() => setInspectingType({ $record: { fields: [...props.arrow.params] } })} />
    <Show when={inspectingType()}>{type => <TypeInspectionDialog type={type()} onClose={() => setInspectingType(undefined)} />}</Show>
  </>;
}

function ResultBody(props: {
  value: unknown;
  type?: FenelType;
  item?: LayoutItem;
  evaluated?: RenderedCardValue;
  preview?: boolean;
  inspection?: boolean;
  functionSource?: { node?: ExprNode; current: () => boolean };
  onCallFunction?: (pin: { $pin: string; name: string; id: string }) => void;
  /** Per-card representation overrides (LayoutItem.representations).
   *  Threaded into pin cards so a single locusView item can override
   *  the underlying pinned value's labels/icons/etc. */
  localReps?: Record<string, Record<string, unknown>>;
  /** A table cell is already one field of a row: its record value reads on
   * one line (the record display rule's nested line mode), not as rows. */
  recordDepth?: number;
}) {
  const { reader, catalogCardOf, catalogReferencePending, resolveCatalogReference, homeAuthoringSession, callableName } = useHomeReader();
  const transfer = useContext(HomeDataContext);
  const inline = useValueCardInline();
  const scopedEdit = useContext(InspectionValueEditContext);
  const inspectionEdit = createMemo(() => {
    if (props.preview && !props.inspection) return undefined;
    const edit = scopedEdit ?? (props.item ? transfer?.inspectionValue(props.item) : undefined);
    return edit?.available() && edit.controller() ? edit : undefined;
  });
  const editCurrent = createMemo(() => {
    const edit = inspectionEdit();
    const controller = edit?.controller();
    const draft = controller?.draft();
    const text = controller?.state.sourceText();
    return () => !edit || controller === edit.controller() && draft === controller?.draft() && text === controller?.state.sourceText();
  });
  async function writeInspectionValue(value: unknown, type: FenelType | undefined, path: readonly LocusPathStep[] = []) {
    const edit = inspectionEdit();
    const controller = edit?.controller();
    if (!edit || !controller) throw new Error("Wait for this data's editing tools.");
    const session = homeAuthoringSession();
    const expr = expressionForTransfer({ value, type, typeName: classifyData(value), source: "fenel" }, session.environment);
    controller.stageValue({ path: [...edit.path(), ...path], expr });
  }
  const focusedScalar = () => !inline() && (!props.preview || !!props.inspection)
    && (props.item?.id === "$self" || !!inspectionEdit()?.focused())
    && (typeof props.value === "number" || typeof props.value === "string");
  const scalarEditable = () => focusedScalar() && !!inspectionEdit()?.controller()?.canEditValue();
  const [editingScalar, setEditingScalar] = createSignal<{ anchor: DOMRect; value: unknown; type?: FenelType; current: () => boolean }>();
  function openScalarEditor(element: HTMLElement) {
    if (!scalarEditable()) return;
    setEditingScalar({ anchor: element.getBoundingClientRect(), value: props.value, type: valueType(), current: editCurrent() });
  }
  const heldType = createMemo(() => heldTypeForInspection(props.value, catalogCardOf, resolveCatalogReference));
  const [inspectingType, setInspectingType] = createSignal<FenelType>();
  // Structural inference can be much more expensive than displaying a known
  // media result. Only the read branch that needs an element/field type asks
  // for it; mounting an editable card must not infer an unused whole value.
  const valueType = createMemo(() => props.type ?? props.item?.valueType ?? (props.item ? transfer?.type(props.item) : undefined), { lazy: true });
  const arrowType = createMemo(() => {
    const type = valueType();
    const session = homeAuthoringSession();
    const resolved = type ? resolveValueType(type, id => reader?.resolveTypeName ? reader.resolveTypeName(id)
      : session.registry.getIdentifiedEntity(id)?.type ?? session.environment.resolveTypeRef?.({ $ref: id })) : undefined;
    return resolved && "$arrow" in resolved ? resolved.$arrow : undefined;
  }, { lazy: true });
  const isArray = createMemo(() => Array.isArray(props.value));
  /** `undefined`: not a reference. `null`: a reference this account cannot
   *  resolve, which is reported rather than shown as its transport record. */
  const reference = createMemo(() => catalogCardOf(props.value));
  const pinValue = createMemo(() => reference() ?? null);
  const isFunctionPin = createMemo(() => pinValue()?.$pin === "function");
  const setRef = createMemo(() => isLocusSetRef(props.value) ? props.value : null);
  const contained = createMemo(() => childrenOf(props.value) ?? [], { lazy: true });
  const previewCard = (value: unknown, type: FenelType | undefined, label: string) =>
    <EvaluatedFlowItemView item={{ id: "$preview", caption: label, valueType: type }} savedExprById={new Map()}
      evaluated={{ value }} onRemove={() => {}} preview />;
  const contextData = (event: MouseEvent, selected: ContainedValuePreview) => {
    if (props.item) transfer?.openContainedMenu(event, props.item, selected, props.evaluated);
  };
  const sourceOccurrence = transfer?.occurrenceFor(() => props.item, () => props.evaluated);
  const readOccurrence = createMemo<DataOccurrenceSource | undefined>(() => {
    const occurrence = props.item ? sourceOccurrence : undefined;
    const edit = inspectionEdit();
    return occurrence?.state === "source" && edit ? { ...occurrence, edit: {
      available: () => !!edit.controller()?.canEditValue(), applyLabel: () => "Apply",
      write: (path, value, type) => writeInspectionValue(value, type, path),
    } } : occurrence;
  });
  return (
    <div class={["inspection-value", { "inspection-value--focused-scalar": focusedScalar(), "inspection-value--editable": scalarEditable() }]}
      role={scalarEditable() ? "button" : undefined} tabindex={scalarEditable() ? 0 : undefined}
      aria-label={scalarEditable() ? "Edit data" : undefined}
      onClick={event => {
        if (event.target instanceof Element && event.target.closest("button, a, input, textarea, select, [contenteditable=true]")) return;
        if (scalarEditable()) event.stopPropagation();
        openScalarEditor(event.currentTarget);
      }}
      onKeyDown={event => {
        if (event.target === event.currentTarget && (event.key === "Enter" || event.key === " ")) {
          event.preventDefault(); event.stopPropagation(); openScalarEditor(event.currentTarget);
        }
      }}>
    <Show when={!setRef()} fallback={<LocusSetCard set={setRef()!} />}>
    <Show when={!heldType() || !!pinValue()} fallback={<>
      <TypeDataPreview type={heldType()!.definition} compact={inline() || props.item?.id !== "$self"}
        fieldRegistry={readerFieldOwner(reader, homeAuthoringSession)} callableName={callableName} onOpenType={setInspectingType} />
      <Show when={inspectingType()}>{type => <TypeInspectionDialog type={type()} onClose={() => setInspectingType(undefined)} />}</Show>
    </>}>
    <Show when={reference() !== null} fallback={
      // B3: a reference the Local worker has not answered yet is loading, not missing.
      <Show when={!catalogReferencePending(props.value)} fallback={<CardLoadingIndicator />}>
        <ValueFailure message="The referenced data is not available in this account." label={props.item?.caption} />
      </Show>
    }>
    <Show when={!pinValue()} fallback={
      <Show
        when={isFunctionPin()}
        fallback={<TypePinCard pin={pinValue()!} localReps={props.localReps} expanded={props.item?.id === "$self"} />}
      >
        <Show when={props.functionSource} fallback={<FunctionPinCard
          pin={pinValue()!}
          embedded={!!props.item}
          signature={props.item?.id !== "$self"}
          preview={!props.inspection && props.item?.id !== "$self"}
          onCall={props.onCallFunction ? () => props.onCallFunction!(pinValue()!) : undefined}
          localReps={props.localReps}
        />}><TypedReadValue value={props.value} type={valueType()} functionSource={props.functionSource}
          fieldRegistry={readerFieldOwner(reader, homeAuthoringSession)} callableName={callableName} /></Show>
      </Show>
    }>
      <Show when={!arrowType()} fallback={<Show when={props.functionSource} fallback={<FunctionTypeBody arrow={arrowType()!} />}>
        <TypedReadValue value={props.value} type={valueType()} functionSource={props.functionSource}
          fieldRegistry={readerFieldOwner(reader, homeAuthoringSession)} callableName={callableName} />
      </Show>}>
      <Show when={!props.preview || !!inspectionEdit()} fallback={<TypedReadValue value={props.value} type={valueType()}
        callableName={inline() ? () => "" : callableName} compact={inline()} onDataContext={contextData} occurrence={readOccurrence()} />}>
      <Show
        when={detectTaggedIdValue(props.value)}
        fallback={
          <Show when={props.item && transfer && containerSummary(props.value)} fallback={
          <Show when={props.item && transfer && (transfer.canWrite() || !!inspectionEdit())} fallback={
          <Show when={props.type} fallback={
          <Show when={isArray()} fallback={<ValueDisplay value={props.value} />}>
            <div class="home-item__list">
              <For each={(props.value as unknown[])}>
                {(child) => (
                  <div class="home-item__list-cell">
                    <ValueDisplay value={child} />
                  </div>
                )}
              </For>
              <Show when={(props.value as unknown[]).length === 0}>
                <div class="home-item__error" style="color: #9ca3af; font-style: italic">
                  (empty list)
                </div>
              </Show>
            </div>
          </Show>
          }>
            <TypedReadValue value={props.value} type={valueType()} recordDepth={props.recordDepth}
              fieldRegistry={readerFieldOwner(reader, homeAuthoringSession)} callableName={callableName} onDataContext={contextData} occurrence={readOccurrence()} />
          </Show>
          }>
            <DataValueSurface value={props.value} type={props.item?.valueType} label={props.item?.caption}
              hideCopy
              session={() => transfer!.session()}
              getType={valueType}
              current={editCurrent()}
              resolveSavedValue={(id) => transfer!.savedValue(id)}
              revision={() => transfer!.revision(props.item!)}
              renderValue={(child, render) => <TypedReadValue value={child.value} type={child.getType()}
                fieldRegistry={readerFieldOwner(reader, () => transfer!.session())} callableName={callableName} structuralFallback={render}
                dataPath={child.path} onDataContext={contextData} occurrence={readOccurrence()} />}
              renderChild={(child, render) => <ValueHoverPreview label={child.label}
                onContextMenu={event => contextData(event, child)}
                onOpen={() => transfer!.enterPath(props.item!, child.path, { value: props.value })}
                preview={() => previewCard(child.value, child.getType(), child.label)}>
                {render()}
              </ValueHoverPreview>}
              onChange={next => {
                const edit = inspectionEdit();
                if (!edit) return transfer!.replace(props.item!, next.expr, next.type, next.revision, next.edit);
                const controller = edit.controller();
                if (!controller) throw new Error("Wait for this data's editing tools.");
                controller.stageValue(next.edit ? { ...next.edit, path: [...edit.path(), ...next.edit.path] }
                  : { path: edit.path(), expr: next.expr });
              }} />
          </Show>
          }>
            {/* Record display rule (2026-11-06): a record value reads as label: value
                rows through the shared typed read owner, which also decides when space
                is tight enough for the compact per-field strip. Lists keep their strip. */}
            <Show when={isArray()} fallback={<TypedReadValue value={props.value} type={valueType()}
              fieldRegistry={readerFieldOwner(reader, homeAuthoringSession)} callableName={callableName}
              onDataContext={contextData} occurrence={readOccurrence()} />}>
            <CollectionPreviewStrip items={contained()} label={containerSummary(props.value) ?? "Contents"}
              countLabel={`${contained().length} ${isArray() ? contained().length === 1 ? "item" : "items" : contained().length === 1 ? "field" : "fields"}`}
              itemLabel={(child) => child.label}
              onItemContextMenu={(event, child) => contextData(event, { value: child.value, label: child.label,
                caption: typeof child.key === "string" ? child.label : undefined, path: [child.key],
                getType: () => childValueType(props.value, valueType(), child.key, transfer?.session() ?? homeAuthoringSession()) })}
              onOpenItem={(child) => transfer!.enterPath(props.item!, [child.key], { value: props.value })}
              onEnterCollection={() => transfer!.enter(props.item!, { value: props.value })}
              render={(child) => <CardValuePreview value={child.value}
                type={childValueType(props.value, valueType(), child.key, transfer?.session() ?? homeAuthoringSession())} />}
              preview={(child) => previewCard(child.value,
                childValueType(props.value, valueType(), child.key, transfer?.session() ?? homeAuthoringSession()), child.label)} />
            </Show>
          </Show>
        }
      >
        {(tagged) => (
          <TaggedIdChip id={tagged().id} entityType={tagged().entityType} />
        )}
      </Show>
      </Show>
      </Show>
    </Show>
    </Show>
    </Show>
    </Show>
    <Show when={editingScalar()} keyed>{edit => <Loading fallback={null}>
      <InspectionQuickEdit name={props.item?.caption ?? "Data"} type={edit.type} value={edit.value}
        registry={readerFieldOwner(reader, homeAuthoringSession)} anchor={edit.anchor} applyLabel="Apply"
        onApply={async value => {
          if (!edit.current()) throw new Error("This draft changed. Open its current value to edit it.");
          await writeInspectionValue(value, edit.type);
        }} onClose={() => setEditingScalar(undefined)} />
    </Loading>}</Show>
    </div>
  );
}

/** Legacy data-set references use the same compact value previews as the
 *  root's current list cards when their contents are available in scope. */
function LocusSetCard(props: { set: LocusSetRef }) {
  const data = useContext(HomeDataContext);
  const summary = createMemo(() => data?.listSummary({ id: props.set.$locus }));
  return (
    <Show when={summary()} fallback={
      <div class="locus-set-card"><IconStack size={18} /><span>{props.set.name}</span>
        <span class="locus-previews__count">{props.set.count} {props.set.count === 1 ? "item" : "items"}</span>
      </div>
    }>{(list) =>
      <CollectionPreviewStrip items={list().items} label={`${list().name}, ${list().count} items`}
        itemLabel={(item) => item.caption || "Data"} onOpenItem={(item) => list().enter(item)}
        onEnterCollection={() => data?.enter({ id: props.set.$locus })}
        render={(item) => <ListItemPreview item={item} savedExprById={list().savedExprById} />}
        preview={(item) => <EvaluatedFlowItemView item={item} savedExprById={list().savedExprById}
          onRemove={() => {}} preview />} />
    }</Show>
  );
}

function EditorPreparation(props: { label: string; onClose: () => void; children: JSX.Element }) {
  const placeholder = (error?: string) => <ModalOverlay class="modal-overlay" onClick={(event) => {
    if (event.target === event.currentTarget) props.onClose();
  }}><div class="modal-box call-modal-box" role="dialog" aria-modal="true" aria-label={props.label}>
    <div class="call-modal-head">
      <strong>{props.label}</strong>
      <Show when={!error}><span class="home-new-button__spinner" role="status" aria-label="Loading editor" data-tooltip="Loading this function's editing tools" /></Show>
      <button type="button" class="btn" onClick={props.onClose}>Close</button>
    </div>
    <Show when={error}><p class="data-error" role="alert">{error}</p></Show>
  </div></ModalOverlay>;
  return <Errored fallback={(error) => placeholder(String(error()))}>
    <Loading fallback={placeholder()}>{props.children}</Loading>
  </Errored>;
}

function FunctionCallModal(props: { fnId: string; fnName: string; addressInputs?: readonly LocusAddressInput[];
  onAddressInputsChange?: (inputs: readonly LocusAddressInput[]) => void; onClose: () => void }) {
  return <EditorPreparation label={props.fnName} onClose={props.onClose}><FunctionCallModalContent {...props} /></EditorPreparation>;
}

/** Feed the existing tester the literal edited by the canonical input. This
 * surface is limited to source-owned public examples of global constraints;
 * it does not execute expressions or authorize account data or effects. */
function CallInputDiagnostics(props: {
  value: unknown;
  type: FenelType;
  name: string;
  session: ReturnType<typeof useHomeReader>["homeAuthoringSession"];
}) {
  // B4 F1: a Local reader's tester runs in its worker; no page frame is handed in.
  const reader = useReaderRuntime();
  const widget = createMemo(() => inlineWidgetFor(props.type, undefined, props.session().environment));
  const fields = createMemo(() => {
    const type = widget()?.type;
    return type && "$record" in type ? type.$record.fields : [];
  });
  return <Show when={widget()}>
    <Show when={fields().length > 0} fallback={
      <div class="call-input-diagnostics" data-input-diagnostics={props.name}>
        <h4>{props.name}: value membership</h4>
        <ExpressionDisplay expr={typeToSetExpr(widget()!.type)} showRawToggle={false} showTester
          candidate={{ value: props.value }} evaluateContext={reader?.kind === "local" ? undefined : props.session().evaluateContext} />
      </div>
    }>
      <For each={fields()}>{field => <CallInputDiagnostics
        value={props.value && typeof props.value === "object" ? (props.value as Record<string, unknown>)[field.name] : undefined}
        type={field.type} name={field.name} session={props.session} />}</For>
    </Show>
  </Show>;
}

function FunctionCallModalContent(props: { fnId: string; fnName: string; addressInputs?: readonly LocusAddressInput[];
  onAddressInputsChange?: (inputs: readonly LocusAddressInput[]) => void; onClose: () => void }) {
  const { reader, homeAuthoringSession, getFunctionByName, userFunctions, prepareAuthoringSessionForFunction, publicDataSelected, evaluateAuthoringExpression, callableName, nameCurrent, observePending, getTags, addToLocus } = useHomeReader();
  const locusAdd = useContext(HomeDataContext)?.add ?? addToLocus;
  const savedCtx = useContext(SavedValuesContext);
  const refResolver = (id: string) => savedCtx?.byId(id)?.expr;
  const pinName = createMemo(() => observePending(() => nameCurrent(props.fnId)));
  const authoringSession = createMemo(() => {
    if (reader) return reader.prepareFunction(props.fnId);
    if (publicDataSelected()) return DETACHED_AUTHORING_SESSION;
    const current = subject();
    return current?.$tag === "User" || current?.$tag === "Bot"
      ? prepareAuthoringSessionForFunction(props.fnId, { accountId: current.accountId, functions: userFunctions() })
      : DETACHED_AUTHORING_SESSION;
  });
  const fnData = createMemo(() =>
    !publicDataSelected() ? getFunctionByName(props.fnId).catch(() => null)
      : { definition: { function: homeAuthoringSession().registry.getFunction(props.fnId) } },
  );

  const fn = createMemo<FenelFunction | null>(() => {
    const d = fnData() as any;
    return d?.definition?.function ?? null;
  });

  const params = createMemo(() => fn()?.params ?? []);
  const validationDemoSource = createMemo(() => {
    if (!publicDataSelected()) return undefined;
    const registry = authoringSession().registry;
    const provider = publicDemoInputProvider(registry, props.fnId);
    // Exact provider ownership selects the public source roster. A lookalike
    // function label or a different account's definition cannot enable it.
    if (provider === undefined) return undefined;
    if (provider === registry.getFunction("CheckDemo.checkDemoStartingInputs")) return CHECK_DEMO_SOURCE;
    if (provider === registry.getFunction("PasswordRecordDemo.passwordRecordDemoStartingInputs")) return PASSWORD_RECORD_DEMO_SOURCE;
    return undefined;
  });
  const validationDemo = () => validationDemoSource() !== undefined;
  const [sourceExpanded, setSourceExpanded] = createSignal(false);
  const functionSource = createMemo(() => {
    const f = fn();
    if ((!sourceExpanded() && !validationDemo()) || f?.body === undefined) return "";
    // A2 source projection for this exact public provider: keep the authored
    // types and definitions intact instead of reconstructing their syntax.
    if (validationDemo()) return validationDemoSource()!;
    // B4 wave 4 lane H: a Local reader's handle is its worker's answer.
    const handle = reader?.kind === "local" ? reader.referenceHandle?.(f.id) : authoringSession().registry.getUuid(f.id);
    const name = locale(getCodeName(handle ?? f.id)) ?? "_";
    return printFenel({ program: [
      { type_sig: { name, type: { $arrow: { params: f.params, returns: f.returns } } } },
      { def: { name, params: f.params.map(param => param.name), body: f.body } },
    ] });
  });

  const isIO = createMemo(() => {
    const f = fn();
    if (!f) return false;
    const tags = getTags(f.id);
    return tags?.includes("io") ?? false;
  });

  const returnTypeLabel = createMemo(() => {
    const f = fn();
    if (!f) return "";
    const base = typeLabel(f.returns);
    return isIO() ? `IO ${base}` : base;
  });

  const [argExprs, setArgExprs] = createSignal<ExprNode[]>([]);
  const [addressIssues, setAddressIssues] = createSignal<string[]>([]);
  const [addressShareNote, setAddressShareNote] = createSignal<string>();
  const [addressRunRequest, setAddressRunRequest] = createSignal<{
    node: ExprNode; session: ReturnType<typeof concreteAuthoringSession>; saved: ReadonlyMap<string, ExprNode>;
    epoch: number; revision: number | undefined;
  }>();
  let addressRunController: AbortController | undefined;
  onCleanup(() => addressRunController?.abort());
  let addressInitialized = false;
  /** B4 unit C: a Local reader decodes its address inputs in its worker. */
  const localAddress = reader?.kind === "local";
  /** The inputs (and their parameters) waiting for the worker's decode; the
   * form shows no editable input and Pin/Run stay disabled until it answers. */
  const [addressDecodeRequest, setAddressDecodeRequest] = createSignal<{ inputs: readonly LocusAddressInput[]; params: readonly FieldDef[] }>();
  const addressDecodePending = () => !!addressDecodeRequest();
  let addressDecoding: AbortController | undefined;
  const [addressDecodeRetry, setAddressDecodeRetry] = createSignal(0);
  onCleanup(() => addressDecoding?.abort());
  /** One decode at Save weight (the form waits on it), asked again whenever
   * the worker or its capture comes back: a cold worker shows the existing
   * "tools not ready" copy, a moved capture or a failed answer re-asks under
   * the next capture. Nothing is seeded or encoded meanwhile. */
  function decodeLocalAddressInputs(inputs: readonly LocusAddressInput[], p: readonly FieldDef[]) {
    setAddressIssues([]);
    setAddressDecodeRequest({ inputs, params: p });
  }
  if (localAddress) createEffect(() => {
    addressDecodeRetry();
    const request = addressDecodeRequest();
    return request ? { request, capture: localGuidanceCapture(reader, authoringSession) } : undefined;
  }, next => {
    addressDecoding?.abort();
    addressDecoding = undefined;
    if (!next) return;
    const { request, capture } = next;
    const handle = capture && untrack(() => preparedReaderWorkerForSession(capture.facade));
    if (!capture || !handle) { setAddressIssues([LOCAL_SAVE_TOOLS_PENDING]); return; }
    const own = addressDecoding = new AbortController();
    void (runPreparedReaderWorker(handle, { method: "decode-reader-address-inputs", inputs: [...request.inputs], params: [...request.params] },
      own.signal) as Promise<{ decoded?: { args?: unknown; issues?: unknown } }>).then(reply => {
      if (addressDecoding !== own) return;
      addressDecoding = undefined;
      const decoded = reply?.decoded;
      if (!localGuidanceCurrent(capture, reader, authoringSession)) { setAddressDecodeRetry(value => value + 1); return; }
      if (!decoded || !Array.isArray(decoded.args) || !Array.isArray(decoded.issues)) throw new Error("The authoring worker response could not be read.");
      setArgExprs(decoded.args as ExprNode[]); setAddressIssues(decoded.issues as string[]);
      setAddressDecodeRequest(undefined);
    }).catch((error: unknown) => {
      if (own.signal.aborted) return;
      if (addressDecoding === own) addressDecoding = undefined;
      // Shown until the worker or its capture comes back and answers.
      setAddressIssues([error instanceof Error ? error.message : String(error)]);
    });
  });
  /** B4 unit C: input edits re-encode the address in the worker at guidance
   * weight, latest wins; only the latest edit's answer is published, and a
   * failed or unreadable answer publishes nothing (the address stays): the
   * latest edit is asked again when the worker or its capture comes back. */
  const addressLane = localAddress ? createGuidanceLane() : undefined;
  onCleanup(() => addressLane?.dispose());
  let addressEdit = 0;
  const [addressEncodeRequest, setAddressEncodeRequest] = createSignal<{ edit: number; args: ExprNode[]; params: readonly FieldDef[] }>();
  const ADDRESS_NOT_SHARED = "Some inputs stay in this form because an address cannot preserve them. Use the data copy tools to share them.";
  function encodeLocalAddressInputs(next: ExprNode[]) {
    if (addressDecodePending()) return;
    setAddressEncodeRequest({ edit: ++addressEdit, args: next, params: resolvedParams() });
  }
  if (localAddress) createEffect(() => {
    const request = addressEncodeRequest();
    return request ? { request, capture: localGuidanceCapture(reader, authoringSession) } : undefined;
  }, next => {
    if (!next?.capture) return;
    const { request, capture } = next;
    addressLane!.request(async signal => {
      if (request.edit !== addressEdit) return;
      const handle = preparedReaderWorkerForSession(capture.facade);
      if (!handle) return;
      let reply: { encoded?: { $tag?: string; _0?: { inputs?: unknown; omittedExpressions?: unknown } } };
      try {
        reply = await runPreparedReaderWorker(handle, { method: "encode-reader-address-inputs", args: request.args, params: [...request.params],
          savedExpressions: reachedSavedSources(request.args, refResolver), priority: "guidance" }, signal) as typeof reply;
      } catch { return; }
      if (signal.aborted || request.edit !== addressEdit || !localGuidanceCurrent(capture, reader, authoringSession)) return;
      const body = reply?.encoded?.$tag === "Ok" ? reply.encoded._0 : undefined;
      if (body && Array.isArray(body.inputs) && typeof body.omittedExpressions === "boolean") {
        props.onAddressInputsChange?.(body.inputs as LocusAddressInput[]);
        setAddressShareNote(body.omittedExpressions ? ADDRESS_NOT_SHARED : undefined);
      } else if (reply?.encoded?.$tag === "Err") {
        // The page's own encoding threw here: an address cannot carry these inputs.
        props.onAddressInputsChange?.([]);
        setAddressShareNote(ADDRESS_NOT_SHARED);
      } else return;
      if (untrack(addressEncodeRequest) === request) setAddressEncodeRequest(undefined);
    });
  });

  createEffect(
    // A Local reader's address inputs are decoded by its worker: its page
    // environment is not read for them (the seeding below never runs then).
    () => ({ p: params(), args: argExprs(), environment: localAddress && props.addressInputs ? undefined
      : reader?.kind === "local" ? authoringStructureEnvironment(authoringSession()) : authoringSession().environment, ready: !!fn() }),
    ({ p, args, environment: captured, ready }) => {
      if (!ready) return;
      if (props.addressInputs && !addressInitialized) {
        addressInitialized = true;
        if (localAddress) { decodeLocalAddressInputs(props.addressInputs, p); return; }
        const decoded = decodeLocusAddressInputs(props.addressInputs, p, authoringSession());
        setArgExprs(decoded.args); setAddressIssues(decoded.issues);
        return;
      }
      // The inputs arrive from the worker; nothing is seeded meanwhile.
      if (localAddress && props.addressInputs) return;
      if (p.length > 0 && args.length === 0) {
        const session = authoringSession();
        const environment = captured ?? (reader?.kind === "local" ? authoringStructureEnvironment(session) : session.environment);
        // Public demo inputs belong to the public reader only (B4 wave 4 lane H).
        const provider = reader?.kind === "local" ? undefined : publicDemoInputProvider(session.registry, props.fnId);
        if (provider) {
          const inputs = evaluateAuthoringExpression({ kind: "call", fnId: session.registry.getUuid(provider.id)!, args: [] },
            refResolver, session).result as Array<{ function: unknown; arguments: unknown[] }>;
          const entry = inputs.find(input => session.registry.getFunction(refHandle(input.function) ?? "")?.id === fn()?.id);
          if (entry && entry.arguments.length === p.length) {
            setArgExprs(p.map((param, index) => expressionForLiteralValue(entry.arguments[index], param.type, environment)));
            return;
          }
        }
        setArgExprs(p.map((param) => seedExpressionForType(param.type, environment)));
      }
    },
  );

  // Argument expressions remain the source. Only completed literal data is
  // projected for sibling-dependent types; computing an argument here would
  // execute it again and could perform an effect before the call is admitted.
  const inputValues = createProjection<Record<string, unknown>>(() => Object.fromEntries(params().flatMap((param, index) => {
    const argument = argExprs()[index];
    return argument?.kind === "literal" && argument.value !== undefined && argument.value !== null
      && !detectStructuralForm(argument.value) ? [[param.name, argument.value]] : [];
  })), {});
  // B4 wave 4 lane H: a Local reader's sibling-dependent parameter types and
  // their schemes are computed in its worker, in this function's session
  // (guidance class, latest wins). Parameters show as authored until the
  // first answer, then as last answered; the checks and Add wait for the
  // answer of the current inputs (pending is no verdict).
  const callSignatureRequest = () => {
    // Slot reads update the pending projection before snapshot's untracked copy.
    // Every argument edit replaces this array.
    void argExprs();
    const f = fn();
    return f ? { method: "project-reader-call-signature" as const, fnId: props.fnId, functionId: f.id ?? props.fnId,
      params: params(), inputValues: snapshot({ ...inputValues }) } : undefined;
  };
  const localCallSignature = reader?.kind === "local" ? createLocalReaderAnswer(() => reader, authoringSession, () => {
    const request = callSignatureRequest();
    return request ? { ...request, priority: "guidance" as const } : undefined;
  }, readLocalCallSignature) : undefined;
  let retainedCallSignature: ReaderCallSignature | undefined;
  const resolvedParams = createMemo(() => {
    if (localCallSignature) {
      const answer = localCallSignature.answer();
      if (answer) retainedCallSignature = answer;
      return (answer ?? retainedCallSignature)?.params ?? params();
    }
    const session = authoringSession();
    const declared = params();
    return declared.map((param, index) => {
      // Dependent signatures bind earlier inputs. Missing/computed drafts are
      // unavailable data, so retain the authored dependent type until filled.
      if (!declared.slice(0, index).every(previous => inputValues[previous.name] !== undefined)) return param;
      const type = scopedConcreteType(param.type, session.evaluateContext, session.environment, session.registry, inputValues);
      return type && type !== param.type ? { ...param, type } : param;
    });
  });
  const parameterSchemes = createMemo(() => {
    if (localCallSignature) {
      void resolvedParams();
      return (localCallSignature.answer() ?? retainedCallSignature)?.schemes.map(entry => entry.scheme) ?? [];
    }
    const session = authoringSession();
    const declaration = session.environment.getFunctionEntry?.(props.fnId);
    if (declaration?.signatureOutcome?.$tag !== "Solved" || !declaration.scheme) return [];
    const declared = params();
    return resolvedParams().map((param, index) => {
      const projected = projectAuthoringScheme(declaration.scheme!, ["$arrow", "params", String(index), "type"]);
      if (!projected || param.type === declared[index]?.type) return projected;
      // A sibling-dependent type is already concretized above. Close that
      // exact result in the same function's source frame, without evaluating
      // arguments or attaching the old dependent type's nominal occurrences.
      const resolved = session.registry.callSiteTyping.resolveType(param.type, fn()?.id ?? props.fnId);
      return resolved.ok ? resolved.type : undefined;
    });
  });
  const callExpr = createMemo<ExprNode>(() => ({
    kind: "call",
    fnId: props.fnId,
    args: argExprs(),
  }));
  // B4 slice 2: a Local reader checks the inputs, evaluates the call and
  // checks its result in its worker, in the page's order, latest wins, only
  // after an edit. Checking shows no issue and no result; pinning asks again.
  type CallGuidanceItem = { args: Array<{ index: number; node: ExprNode; expectedType: FenelType; expectedScheme?: TypeScheme } | { pending: string }>;
    call: ExprNode; evaluate: boolean; result: { expectedType?: FenelType; expectedScheme?: TypeScheme } };
  type CallGuidance = { inputIssue?: string; inputIssueArgument?: number; evaluation?: { result: unknown; trace: []; error?: string }; resultIssue?: string };
  async function localCallVerdict(item: CallGuidanceItem, session: AuthoringSession, sourceMetadata: ReturnType<typeof captureReaderSourceMetadata>,
    signal: AbortSignal | undefined, priority?: "guidance"): Promise<CallGuidance> {
    const saved = new Map((savedCtx?.list() ?? []).map(value => [value.id, value.expr] as const));
    const metadata = sourceMetadata ? { sourceMetadata } : {};
    const check = async (node: ExprNode, options: { expectedType?: FenelType; expectedScheme?: TypeScheme }) => {
      const job = expressionSaveIssueInWorker(session, node, saved, { ...options, ...metadata, ...(priority ? { priority } : {}) }, signal);
      if (!job) throw new Error(LOCAL_SAVE_TOOLS_PENDING);
      return (await job).issue;
    };
    for (const argument of item.args) {
      if ("pending" in argument) return { inputIssue: `Complete the earlier inputs to determine the type of ${argument.pending}.` };
      const issue = await check(argument.node, { expectedType: argument.expectedType,
        ...(argument.expectedScheme ? { expectedScheme: argument.expectedScheme } : {}) });
      if (issue) return { inputIssue: issue, inputIssueArgument: argument.index };
    }
    const callIssue = await check(item.call, {});
    if (callIssue) return { inputIssue: callIssue };
    if (!item.evaluate) return {};
    const job = evaluateExpressionInWorker(session, item.call, saved, signal, undefined, { admitInvocations: true,
      admission: item.result, ...metadata, ...(priority ? { priority } : {}) });
    if (!job) throw new Error(LOCAL_SAVE_TOOLS_PENDING);
    try {
      const reply = await job;
      return { evaluation: { result: reply.result, trace: [] }, ...(reply.issue === undefined ? {} : { resultIssue: reply.issue }) };
    } catch (error) {
      // The worker's own evaluation refusal is shown as today; a transport
      // failure stays "checking".
      if (!(error instanceof WorkerRequestError) || error.code !== undefined) throw error;
      return { evaluation: { result: undefined, trace: [], error: error.message } };
    }
  }
  const callGuidance = reader?.kind === "local" ? createLocalLiveGuidance<CallGuidanceItem, CallGuidance>(() => reader, authoringSession,
    async ([item], capture, signal) => [await localCallVerdict(item!, capture.facade, capture.sourceMetadata, signal, "guidance")],
    { batch: 1, label: "call" }) : undefined;
  onCleanup(() => callGuidance?.dispose());
  // The seeded inputs' checks and result showed at open on the page: one
  // request at open once every input is seeded and complete.
  // B4 unit D item 2: the open-time completeness check lowers in the worker.
  openLocalLiveGuidance(callGuidance, () => reader, authoringSession,
    () => fn() && argExprs().length === params().length ? callExpr() : undefined, refResolver);
  /** `signature`: a Local pin's own answer for the submitted inputs. */
  const callGuidanceItem = (signature?: ReaderCallSignature): CallGuidanceItem => {
    const currentArgs = argExprs();
    const args: CallGuidanceItem["args"] = [];
    const schemes = signature ? signature.schemes.map(entry => entry.scheme) : parameterSchemes();
    for (const [index, param] of (signature?.params ?? resolvedParams()).entries()) {
      const argument = currentArgs[index];
      if (!argument) continue;
      if ("$el" in param.type) { args.push({ pending: param.name }); break; }
      const expectedScheme = schemes[index];
      args.push({ index, node: argument, expectedType: param.type, ...(expectedScheme ? { expectedScheme } : {}) });
    }
    const declaration = authoringSession().environment.getFunctionEntry?.(props.fnId);
    const expectedScheme = declaration?.signatureOutcome?.$tag === "Solved" && declaration.scheme
      ? projectAuthoringScheme(declaration.scheme, ["$arrow", "returns"]) : undefined;
    const returns = fn()?.returns;
    return { args, call: callExpr(), evaluate: !!fn() && !props.addressInputs && !addressIssues().length,
      result: { ...(returns ? { expectedType: returns } : {}), ...(expectedScheme ? { expectedScheme } : {}) } };
  };
  const callLocalAnswer = createMemo(() => callGuidance
    ? localCallSignature && !localCallSignature.answer()
      ? localCallSignature.failure() ? { inputIssue: localCallSignature.failure() } : {}
      : callGuidance.read(callGuidanceItem()) ?? {} : undefined);
  const inputCheck = createMemo<{ issue?: string; argument?: number }>(() => {
    const local = callLocalAnswer();
    if (local) return { issue: local.inputIssue, argument: local.inputIssueArgument };
    const session = authoringSession();
    const options = {
      registry: session.registry,
      resolveSavedExpr: refResolver,
      evaluateContext: session.evaluateContext,
    };
    const currentArgs = argExprs();
    for (const [index, param] of resolvedParams().entries()) {
      const argument = currentArgs[index];
      if (!argument) continue;
      if ("$el" in param.type) return { issue: `Complete the earlier inputs to determine the type of ${param.name}.` };
      const issue = draftSaveIssue(argument, session.environment, {
        ...options, expectedType: param.type, expectedScheme: parameterSchemes()[index],
      });
      if (issue) return { issue, argument: index };
    }
    return { issue: draftSaveIssue(callExpr(), session.environment, options) };
  });
  const inputIssue = createMemo(() => inputCheck().issue);
  const addressPreview = createAsyncValue(addressRunRequest, request => {
    addressRunController?.abort();
    const controller = new AbortController();
    addressRunController = controller;
    const job = evaluateExpressionInWorker(request.session, request.node, request.saved, controller.signal,
      authoringSessionAccountScope(request.session), { admitInvocations: true });
    if (!job) throw new Error("This reader's editing tools are not ready. Try again after preparation.");
    return job;
  });
  // A later explicit Run is inline activity. Read its current pending state
  // without suspending the already mounted lens or its shared input form.
  const addressPreviewState = createMemo(() => latest(() => {
    const loading = addressPreview.loading;
    return { request: addressRunRequest(), loading, error: loading ? undefined : addressPreview.error,
      result: loading ? undefined : addressPreview() };
  }));
  const evaluated = createMemo(() => {
    if (!fn() || inputIssue() || addressIssues().length) return null;
    const local = callLocalAnswer();
    if (local && !props.addressInputs) return local.evaluation ?? null;
    if (props.addressInputs) {
      const preview = addressPreviewState();
      const request = preview.request;
      if (!request || isIO() || request.epoch !== sessionEpoch() || request.revision !== reader?.revision()
        || request.session !== concreteAuthoringSession(authoringSession())) return null;
      if (preview.loading) return null;
      const result = preview.result;
      return preview.error ? { result: undefined, trace: [], error: String((preview.error as Error)?.message ?? preview.error) }
        : result ?? null;
    }
    try {
      return evaluateAuthoringExpression(callExpr(), refResolver, authoringSession(), {}, { admitInvocations: true });
    } catch (e: any) {
      return { result: undefined, trace: [], error: e?.message ?? String(e) };
    }
  });
  const [triedInput, setTriedInput] = createSignal<ReturnType<typeof evaluated>>();
  function tryInput() {
    if (inputIssue() || addressIssues().length) return;
    if (props.addressInputs) {
      addressRunController?.abort();
      const session = concreteAuthoringSession(authoringSession());
      setAddressRunRequest({ node: cloneDraftValue(callExpr()), session,
        saved: new Map((savedCtx?.list() ?? []).map(value => [value.id, value.expr])), epoch: sessionEpoch(), revision: reader?.revision() });
      return;
    }
    if (!validationDemo()) return;
    try {
      setTriedInput(evaluateAuthoringExpression(cloneDraftValue(callExpr()), refResolver, authoringSession(), {}, { admitInvocations: true }));
    } catch (error) {
      setTriedInput({ result: undefined, trace: [], error: error instanceof Error ? error.message : String(error) });
    }
  }
  const currentResult = createMemo(() => triedInput() ?? evaluated());
  const resultIssue = createMemo(() => {
    const result = currentResult();
    if (!result || ("error" in result && result.error)) return undefined;
    // A Local result was checked in the same worker request that computed it.
    const local = callLocalAnswer();
    if (local && !triedInput() && !props.addressInputs) return local.resultIssue;
    const session = authoringSession();
    const declaration = session.environment.getFunctionEntry?.(props.fnId);
    const expectedScheme = declaration?.signatureOutcome?.$tag === "Solved" && declaration.scheme
      ? projectAuthoringScheme(declaration.scheme, ["$arrow", "returns"]) : undefined;
    return draftSaveIssue(callExpr(), session.environment, {
      expectedType: fn()?.returns,
      expectedScheme,
      registry: session.registry,
      resolveSavedExpr: refResolver,
      evaluatedValue: result.result,
      evaluateContext: session.evaluateContext,
    });
  });
  const displayedResult = createMemo(() => {
    if (inputIssue()) return null;
    const result = currentResult();
    const issue = resultIssue();
    return issue ? { result: undefined, trace: [], error: issue } : result;
  });
  // B4 slice 2: a Local pin refused by its worker shows its refusal in the
  // call's existing issue line. It never disables Add (a transient refusal,
  // such as tools not ready, must not lock a call without inputs); a retry or
  // an input edit clears it.
  const [pinRefusal, setPinRefusal] = createSignal<string>();
  /** B4 fix round 2: this surface's pending nested value checks. */
  const draftScope = {};
  const draftIssue = createMemo(() => addressIssues().length ? addressIssues().join(" ") : inputIssue() ?? resultIssue());
  const [inputHintSources, setInputHintSources] = createSignal<readonly MembershipHintSource[]>([]);
  const observeInputHints: MembershipHintObserver = source => {
    setInputHintSources(current => [...current, source]);
    return () => setInputHintSources(current => current.filter(entry => entry !== source));
  };
  const incompleteInputNote = () => {
    const check = inputCheck();
    if (addressIssues().length || !check.issue || check.argument === undefined
      || draftIssue() !== check.issue) return undefined;
    const node = argExprs()[check.argument], parameter = resolvedParams()[check.argument];
    if (node?.kind !== "literal" || !parameter) return undefined;
    const type = parameterSchemes()[check.argument]?.body ?? parameter.type;
    for (const source of inputHintSources()) {
      const note = incompleteMembershipNote(source, node, type, node.value);
      if (note) return note;
    }
    return undefined;
  };

  const [pinning, setPinning] = createSignal(false);
  const [pinned, setPinned] = createSignal(false);
  let dismissed = false;
  let pinInFlight = false;
  let closeTimer: ReturnType<typeof setTimeout> | undefined;
  let onPinDismiss: (() => void) | undefined;
  function dismiss() {
    dismissed = true;
    clearTimeout(closeTimer);
    closeTimer = undefined;
    onPinDismiss?.();
  }
  onSettled(() => dismiss);
  function close() {
    dismiss();
    props.onClose();
  }

  async function pinResult() {
    // B3: a caption is persisted only from the reader's CURRENT answer, never a
    // stale, fallback or placeholder name; the button waits meanwhile.
    // B4 slice 2: a Local pin asks its worker (below), never the guidance memo.
    if (dismissed || pinInFlight || pinned() || (callGuidance ? addressIssues().length : draftIssue()) || !nameCurrent(props.fnId)) return;
    pinInFlight = true;
    setPinning(true);
    setPinRefusal(undefined);
    // B4 fix round 2: a Local pin persists exactly the call its worker admitted.
    let admittedCall: ExprNode | undefined;
    try {
      if (callGuidance && reader) {
        callGuidance.cancel();
        // B4 wave 4 lane H: the call is checked with the current inputs'
        // signature; while the display's answer is pending, the pin asks for
        // it itself (weight 0) and checks with that answer.
        let signature: ReaderCallSignature | undefined;
        if (localCallSignature && !localCallSignature.answer()) {
          const request = callSignatureRequest();
          if (!request) throw new Error(LOCAL_SAVE_TOOLS_PENDING);
          try { signature = await runLocalReaderAction(reader, authoringSession, request, readLocalCallSignature); }
          catch (error) { if (!dismissed) setPinRefusal(error instanceof Error ? error.message : String(error)); throw error; }
          if (dismissed) return;
          if (draftValueFingerprint(request.inputValues) !== draftValueFingerprint(snapshot({ ...inputValues }))) {
            setPinRefusal(LOCAL_SAVE_DRAFT_CHANGED); throw new Error(LOCAL_SAVE_DRAFT_CHANGED);
          }
        }
        const item = callGuidanceItem(signature);
        const submitted = cloneDraftValue(item.call);
        const submittedFingerprint = draftValueFingerprint(submitted);
        const pinController = new AbortController();
        onPinDismiss = () => pinController.abort();
        // The same captures and fences as Save admission (epoch, revision,
        // session, worker, source metadata); weight 0, never behind guidance.
        let issue: string | undefined;
        try {
          issue = await localWorkerSaveIssue(item.call, { reader, session: authoringSession, signal: pinController.signal, draftScope,
            current: () => {
              if (dismissed) throw new Error("This call was closed before it was saved.");
              // Inputs stay editable while pinning: a changed call is not the admitted one.
              if (draftValueFingerprint(callExpr()) !== submittedFingerprint) throw new Error(LOCAL_SAVE_DRAFT_CHANGED);
            } },
          (facade, sourceMetadata, signal) => localCallVerdict(item, facade, sourceMetadata, signal).then(answer => {
            // Page parity: an evaluation error alone never refused a pin.
            const refusal = answer.inputIssue ?? answer.resultIssue;
            return refusal === undefined ? {} : { issue: refusal };
          }));
        } catch (error) {
          if (!dismissed) setPinRefusal(error instanceof Error ? error.message : String(error));
          throw error;
        }
        if (dismissed) return;
        if (issue) { setPinRefusal(issue); throw new Error(issue); }
        admittedCall = submitted;
      }
      // Caption uses the function's Labelable instance — the
      // human-readable label registered at defineFunction time —
      // rather than the codeName slug. Falls back to the codeName
      // when no label exists, then to the trailing segment of the
      // fn id (e.g. "runCollector" out of "telegram:runCollector").
      const label = callableName(props.fnId, props.fnName);
      const expr = admittedCall ?? cloneDraftValue(callExpr());
      const added = await locusAdd({ expr }, `${label}(…)`);
      if (dismissed) return;
      if (!added) throw new Error("Could not save this call in the current data.");
      setPinned(true);
      closeTimer = setTimeout(() => { if (!dismissed) close(); }, 600);
    } catch {
      if (!dismissed) setPinning(false);
    } finally {
      pinInFlight = false;
    }
  }

  function setArg(idx: number, expr: ExprNode) {
    if (addressDecodePending()) return;
    if (props.addressInputs) { addressRunController?.abort(); setAddressRunRequest(undefined); }
    setAddressIssues([]);
    setTriedInput(undefined);
    const next = untrack(argExprs).map((a, i) => i === idx ? expr : a);
    setArgExprs(next);
    // B4 slice 2: an input edit (seeded inputs are untouched).
    setPinRefusal(undefined);
    callGuidance?.touch();
    if (props.addressInputs && props.onAddressInputsChange) {
      if (addressLane) { encodeLocalAddressInputs(next); return; }
      try {
        const encoded = encodeLocusAddressInputs(next, resolvedParams(), authoringSession(), node => toLogic(node, refResolver, authoringSession()), printFenel);
        props.onAddressInputsChange(encoded.inputs);
        setAddressShareNote(encoded.omittedExpressions ? "Some inputs stay in this form because an address cannot preserve them. Use the data copy tools to share them." : undefined);
      } catch {
        props.onAddressInputsChange([]);
        setAddressShareNote("Some inputs stay in this form because an address cannot preserve them. Use the data copy tools to share them.");
      }
    }
  }

  // Modal header uses the human-readable Labelable. Falls back to the
  // codeName slug's trailing segment when no label exists.
  const shortName = () => callableName(props.fnId, props.fnName);
  // A card's own caption (several words, written for people) titles the form;
  // a bare code name keeps the "Call name" wording.
  const formTitle = () => /\s/.test(props.fnName.trim()) ? props.fnName.trim() : `Call ${shortName()}`;
  // Quiet by default: each input is its label, its field and its hint. The
  // editor's own chrome (mode selectors, type rows, menus) returns with Advanced.
  const [advancedForm, setAdvancedForm] = createSignal(false);
  // The cross and Escape close the form (the quiet form has no Cancel). Escape
  // first belongs to whatever is open over the form: a tooltip, a picker or a
  // menu, or a dialog opened from it.
  let formBox: HTMLDivElement | undefined;
  onSettled(() => {
    const escape = (event: KeyboardEvent) => {
      if (event.key !== "Escape" || event.defaultPrevented || !formBox?.isConnected) return;
      if (document.querySelector('[role="tooltip"], [role="menu"], [role="listbox"]')) return;
      const own = formBox.closest(".modal-overlay");
      const overlays = document.querySelectorAll(".modal-overlay");
      if (overlays[overlays.length - 1] !== own) return;
      // A key pressed inside another dialog (an editor opened from a field) is that dialog's.
      const within = event.target instanceof Element ? event.target.closest('[role="dialog"], dialog, .modal-overlay') : null;
      if (within && within !== own && !within.contains(formBox)) return;
      close();
    };
    document.addEventListener("keydown", escape);
    return () => document.removeEventListener("keydown", escape);
  });

  return (
    <ModalOverlay class="modal-overlay" onClick={(e) => { if (e.target === e.currentTarget) close(); }}>
      <div ref={(element) => { formBox = element; }} class={["modal-box", "call-modal-box", { "call-modal-box--quiet": !advancedForm() }]}
        data-field-labels={advancedForm() ? undefined : "outlined"}>
        <div class="call-modal-head">
          <h3 style="margin: 0; font-size: 1rem">{formTitle()}</h3>
          <span class="call-modal-head__tools">
            <button type="button" class="btn call-modal-head__advanced" aria-pressed={advancedForm() ? "true" : "false"}
              data-tooltip={advancedForm() ? "Show only the inputs and their hints" : "Show each input's editor controls and types"}
              onClick={() => setAdvancedForm(shown => !shown)}>Advanced</button>
            <button type="button" class="home-item__remove" onClick={close}>×</button>
          </span>
        </div>

        <div class="call-modal-body">
          <Show when={addressIssues().length}><div class="home-item__error" role="alert">{addressIssues().join(" ")}</div></Show>
          <Show when={addressShareNote()}><p class="text-muted">{addressShareNote()}</p></Show>
          <Show when={props.addressInputs && isIO()}><p class="text-muted">These address inputs prepare a call. Run IO explicitly from its card.</p></Show>
          <Show when={!fn()}>
            <div class="text-muted" style="font-size: 0.85rem; padding: 0 1rem">Loading function…</div>
          </Show>

          <Show when={fn()}>
            <ActivePickerProvider>
            <div class={{ "call-modal-input-source": true, "call-modal-input-source--joined": validationDemo() }}>
            <div class="call-modal-card">
              <div class="call-modal-card__header">
                <span class="call-modal-card__title">Parameters</span>
              </div>
              <div class="call-modal-card__body">
                <RecordValuesContext value={() => ({ ...inputValues })}>
                <Show when={params().length === 0}>
                  <div class="text-muted" style="font-size: 0.85rem">No parameters — call directly.</div>
                </Show>
                <Show when={addressDecodePending()}>
                  <CardLoadingIndicator label="Preparing expression…" />
                </Show>
                <For each={addressDecodePending() ? [] : params()}>
                  {(param, idx) => {
                    const field = createMemo(() => resolvedParams()[idx()] ?? param);
                    // A concrete dependent record can become editable only
                    // after its current parameter type is available. Keep the
                    // authored/default argument intact until an actual edit.
                    const visualArgument = createMemo(() => {
                      const expression = argExprs()[idx()] ?? emptyExpressionSlot();
                      return expression.kind === "literal" && expression.value !== undefined && expression.value !== null
                        && !detectStructuralForm(expression.value)
                        ? expressionForLiteralValue(expression.value, field().type, authoringSession().environment)
                        : expression;
                    });
                    const dataCandidate = createMemo(() => {
                      const expression = argExprs()[idx()];
                      return expression?.kind === "literal" && expression.value !== undefined
                        && expression.value !== null && !detectStructuralForm(expression.value)
                        ? expression : undefined;
                    });
                    const recordCandidate = createMemo(() => {
                      const candidate = dataCandidate();
                      const visual = visualArgument();
                      if (!candidate || !candidate.value || typeof candidate.value !== "object" || Array.isArray(candidate.value)
                        || readLocusCatalogReference(candidate.value) || isFenelTypeLike(candidate.value)
                        || visual.kind !== "literal" || detectStructuralForm(visual.value) || visual.value !== candidate.value) return undefined;
                      const session = authoringSession();
                      if (inlineWidgetFor(field().type, undefined, session.environment)) return undefined;
                      // B4 wave 4 lane H: a Local reader names its types through its inert lookup.
                      const schema = resolveValueType(field().type, name => session.environment.resolveNamedType?.(name)
                        ?? (reader?.kind === "local" ? reader.resolveTypeName?.(name) : session.registry.getIdentifiedEntity(name)?.type));
                      return "$record" in schema && schema.$record.fields.length > 0 ? candidate : undefined;
                    });
                    return (
                    <div>
                    <Show when={recordCandidate()} fallback={<ExpressionEditor draftCheckScope={draftScope}
                      paramName={param.name}
                      expr={visualArgument()}
                      onChange={(e) => setArg(idx(), e)}
                      viewMode="nested"
                      typeName={typeLabel(field().type)}
                      fieldDef={field()}
                      expectedScheme={parameterSchemes()[idx()]}
                      authoringSession={authoringSession()}
                      observeMembershipHints={source => observeInputHints({ ...source, occurrence: () => {
                        const candidate = dataCandidate(), visual = visualArgument();
                        return candidate && visual.kind === "literal" && Object.is(visual.value, candidate.value)
                          && source.occurrence?.() === visual ? candidate : undefined;
                      } })}
                    />}>{candidate => <FieldRenderer
                      registry={readerFieldOwner(reader, authoringSession)}
                      callableRegistry={readerFieldOwner(reader, authoringSession)}
                      identityMode={field().key?.$tag === "NamedField" ? "identified" : "transient"}
                      field={field()}
                      value={candidate().value}
                      onChange={value => setArg(idx(), { kind: "literal", value })}
                      observeMembershipHints={source => observeInputHints({ ...source, occurrence: () => recordCandidate() })}
                    />}</Show>
                    <Show when={validationDemo() ? dataCandidate() : undefined}>
                      {candidate => <CallInputDiagnostics
                        value={candidate().value}
                        type={field().type} name={param.name} session={authoringSession} />}
                    </Show>
                    </div>
                    );
                  }}
                </For>
                <Show when={validationDemo() || props.addressInputs && !isIO()}>
                  {/* A validation demo's repeat control belongs to Advanced; an address's Run control is the form's own. */}
                  <button type="button" class="btn" data-repeat-check={props.addressInputs ? undefined : ""}
                    onClick={tryInput} disabled={addressDecodePending() || !!props.addressInputs && addressPreviewState().loading}>
                    {props.addressInputs ? addressPreviewState().loading ? "Running…" : "Run this call" : "Try this input"}
                  </button>
                  <p class="call-input-note" role="status" data-repeat-check={props.addressInputs ? undefined : ""}>{props.addressInputs
                    ? addressPreviewState().loading ? "Running the call…" : addressPreviewState().error ? "The call could not finish. Check the issue and try again."
                      : addressPreviewState().request && evaluated() ? "The call ran with these inputs." : "The address fills the inputs. Run the call after checking them."
                    : triedInput() ? "The same candidate was checked again." : "Edit the candidate, then try it to repeat the value check."}</p>
                </Show>
                </RecordValuesContext>
              </div>
            </div>

            <Show when={fn()?.body !== undefined}>
              <details class="call-modal-card" open={validationDemo()} onToggle={(event) => setSourceExpanded(event.currentTarget.open)}>
                <summary class="call-modal-card__header">
                  <span class="call-modal-card__title">Fenel source</span>
                </summary>
                <div class="call-modal-card__body">
                  <Show when={sourceExpanded() || validationDemo()}>
                    <FenelCodeEditor value={functionSource()} readonly minHeight="120px" />
                  </Show>
                </div>
              </details>
            </Show>
            </div>

            <Show when={draftIssue()}>
              <Show when={incompleteInputNote()} fallback={
                <div class="home-item__error"><Show when={validationDemo()}>Expression type check: </Show>{draftIssue()}</div>
              }>{note => <p class="text-muted" role="status">{note()}</p>}</Show>
            </Show>
            <Show when={!draftIssue() && pinRefusal()}>{refusal => <div class="home-item__error">{refusal()}</div>}</Show>

            <Show when={!!displayedResult()}>
              <div class="call-modal-card call-modal-card--output">
                <div class="call-modal-card__header">
                  <span class="call-modal-card__title">Returns</span>
                  <Show when={fn()?.returns}>
                    <span class="fr-type-badge">{returnTypeLabel()}</span>
                  </Show>
                </div>
                <div class="call-modal-card__body">
                  <Show when={(displayedResult() as any)?.error}>
                    <div class="home-item__error">{(displayedResult() as any)?.error}</div>
                  </Show>
                  <Show when={!!displayedResult() && !(displayedResult() as any)?.error}>
                    <Show when={typeLabel(fn()!.returns) !== "Unit"} fallback={
                      <span class="text-muted mono" style="font-size: 0.8rem">()</span>
                    }>
                      <DataValueSurface value={displayedResult()?.result} type={fn()!.returns}
                        label="Returns" session={authoringSession}
                        renderValue={(data, render) => <TypedReadValue value={data.value}
                          type={data.getType()} fieldRegistry={readerFieldOwner(reader, authoringSession)} callableName={callableName}
                          structuralFallback={render} />} />
                    </Show>
                  </Show>
                </div>
              </div>
            </Show>
            </ActivePickerProvider>
          </Show>
        </div>

        <div class="call-modal-foot">
          <button type="button" class="btn" data-form-cancel="" onClick={close}>Cancel</button>
          <Show when={!publicDataSelected()}>
          <Show when={pinName().failed}>
            <span class="text-muted" role="alert">Name unavailable.</span>
            <button type="button" class="btn" onClick={() => reader?.retryPresentation?.()}>Retry</button>
          </Show>
          <button
            type="button"
            class="btn btn-primary"
            disabled={!fn() || pinning() || addressDecodePending() || !!draftIssue() || !nameCurrent(props.fnId)}
            aria-busy={!nameCurrent(props.fnId) && !pinName().failed ? "true" : undefined}
            data-tooltip={draftIssue()}
            onClick={() => void pinResult()}
          >
            {pinned() ? "✓ Added" : pinning() ? "Adding…" : !nameCurrent(props.fnId) && !pinName().failed ? "Preparing its name…" : "Add result to this data"}
          </button></Show>
        </div>
      </div>
    </ModalOverlay>
  );
}

function typeLabel(t: unknown, resolveName?: (handle: string) => string): string {
  const label = typePhrase(t as FenelType, resolveName).replace(/^(?:A|An) /, "");
  return label.charAt(0).toUpperCase() + label.slice(1);
}

function typeTerm(t: unknown, resolveName?: (handle: string) => string): string {
  return typeCode(t as FenelType, resolveName);
}

function CanvasItemView(props: {
  item: LayoutItem;
  savedExprById: Map<string, ExprNode>;
  onMove: (x: number, y: number) => void;
  onResize: (w: number, h: number) => void;
  onRemove: () => void;
  onDuplicate: () => void;
  onEdit: () => void;
  onToggleExpanded: () => void;
  onToggleEdges: () => void;
  onCallFunction: (pin: { $pin: string; name: string; id: string }) => void;
  getSurface: () => HTMLDivElement | undefined;
  selected: boolean;
  onSelect: (extend: boolean) => void;
}) {
  const { reader, api, evaluateAuthoringExpression, homeAuthoringSession, allCatalogFns, catalogCardOf, catalogReferenceType, itemFenelSource, localItemSource, knownTypeIconName, getLabel, displayLabel, getCodeName, getIcon, getEmoji, getIOAction, getStopAction } = useHomeReader();
  const data = useContext(HomeDataContext);
  const evaluation = createLocusCardEvaluation(() => ({ expr: resolveExpr(props.item, props.savedExprById) ?? undefined,
    evaluated: data?.evaluated(props.item), saved: props.savedExprById, session: homeAuthoringSession() }));
  const evaluated = evaluation.value;

  /** The function this card references, when it references one. */
  const pinInfo = createMemo(() => {
    const expr = resolveExpr(props.item, props.savedExprById);
    const card = expr?.kind === "literal" ? catalogCardOf(expr.value) : undefined;
    return card?.$pin === "function" ? card : null;
  });

  // If the pinned expression is a `call` to an io-tagged function (one
  // with an `IOInvokable` instance), this exposes the `Run` affordance —
  // pure eval can't actually run it, so we dispatch through the runtime
  // IO handler via the /app/io/invoke endpoint.
  const ioCallInfo = createMemo(() => {
    const expr = resolveExpr(props.item, props.savedExprById);
    if (expr?.kind !== "call") return null;
    const action = getIOAction(expr.fnId);
    if (!action) return null;
    const stopAction = getStopAction(expr.fnId);
    return { fnId: expr.fnId, args: expr.args, action, stopAction };
  });

  // Header caption — prefer the function's Labelable instance when
  // the item is an io call card. Falls back to the stored
  // item.caption (which may itself have been written from the label
  // at pin time) and finally to the raw codeName slug. Computing it
  // here means the displayed text follows label changes without
  // touching the persisted caption.
  const displayCaption = createMemo(() => {
    const info = ioCallInfo();
    if (info) {
      const fromLabel =
        locale(displayLabel(info.fnId)) ?? locale(getCodeName(info.fnId));
      if (fromLabel) return `${fromLabel}(…)`;
    }
    return props.item.caption ?? "";
  });

  // Expand state is persisted on the item itself (server-side via
  // locusView). Default (undefined) is "expanded" so legacy items keep
  // showing their bodies; a user collapse explicitly stores false.
  const expanded = () => props.item.expanded !== false;

  const { state: runState, setState: setRunState, dispatch: dispatchIOCall, canStop } = createIOCallController({
    info: ioCallInfo,
    // B4 wave 4 lane H: a Local reader evaluates the arguments in its worker.
    evaluate: (arg: ExprNode) => {
      if (reader?.kind === "local") return localIOArgument(homeAuthoringSession(), arg, props.savedExprById);
      const result = evaluateAuthoringExpression(arg, (id) => props.savedExprById.get(id));
      return result.result;
    },
    invoke: api.invokeIOAction,
  });
  const runIOCall = () => dispatchIOCall("run").then(() => void refreshLive());

  /** Click handler for the ▶ Run button — always confirms before
   *  invoking the IO call. When the previous run already succeeded
   *  (runState.kind === "success") the prompt mentions that so the
   *  user knows they're re-running, not running for the first time. */
  async function confirmAndRunIOCall() {
    const alreadyRan = runState().kind === "success";
    const label =
      locale(getLabel(ioCallInfo()?.fnId ?? "")) ??
      locale(getCodeName(ioCallInfo()?.fnId ?? "")) ??
      "this IO call";
    const ok = await confirmDialog(
      alreadyRan
        ? {
            message: `${label} has already run once on this card.`,
            detail: "Are you sure you want to run it again?",
            confirmLabel: "Run again",
          }
        : { message: `Run ${label}?`, confirmLabel: "Run" },
    );
    if (!ok) return;
    void runIOCall();
  }
  const stopIOCall = () => dispatchIOCall("stop").then(() => void refreshLive());

  async function resolveSuspended(value: unknown) {
    const cur = runState();
    if (cur.kind !== "suspended") return;
    const id = cur.instanceId;
    setRunState({ kind: "running" });
    try {
      const resp = await api.resolveAwaitingPrompt(id, value, cur.suspensionId ?? null);
      if (resp.ok) {
        if (resp.suspended) setRunState({ kind: "suspended", instanceId: id, status: resp.status ?? "awaiting_choice", suspensionId: resp.suspensionId ?? null });
        else setRunState({ kind: "success", value: resp.value });
      } else setRunState({ kind: "error", message: resp.error ?? "Unknown error" });
    } catch (e: any) {
      setRunState({ kind: "error", message: e?.message ?? String(e) });
    }
    void refreshLive();
  }

  // ---- Generic ops panel --------------------------------------------------
  // Resolve the card's result type from the io-call's declared return,
  // then list every catalog function whose first parameter accepts it.
  // Click → invoke /io/invoke with the run result as arg[0] (the typed
  // handle) and seeded defaults for any remaining params.
  const cardResultType = createMemo<FenelType | undefined>(() => {
    // 1. IO call card — declared returns from the function spec.
    const info = ioCallInfo();
    if (info) {
      const cf = allCatalogFns().find((c) => c.fn.id === info.fnId);
      if (cf?.fn) return cf.fn.returns as FenelType;
    }

    // 2. Inspect the resolved expression directly. The evaluator's
    //    output for literal objects can drop fields the renderer
    //    relies on (the JSON-Logic dataflow doesn't preserve every
    //    shape verbatim), so reading from item.source.expr keeps
    //    the type derivation deterministic.
    const expr = resolveExpr(props.item, props.savedExprById);
    if (expr?.kind === "literal") {
      const v = expr.value;
      if (v && typeof v === "object") {
        // A reference → the function's signature, or the structure of the
        // type it names (so a format reads "String" and a record "Record").
        const referenceType = catalogReferenceType(v);
        if (referenceType) return referenceType;
        // Tagged Id<X> — reconstruct from the phantom-enum tag the
        // chip pin path baked into the value.
        const tagged = detectTaggedIdValue(v);
        if (tagged) {
          return {
            $tagged: {
              value: { $ref: "Id" },
              phantom: {
                $refined: {
                  base: { $ref: "String" },
                  set: buildSetExpr.enum([tagged.entityType]),
                },
              },
            },
          } as FenelType;
        }
      }
    }

    // 3. Live-value inspection — covers references that resolve to
    //    structured pin objects via a saved query.
    const v = evaluated().result;
    if (v && typeof v === "object") {
      const referenceType = catalogReferenceType(v);
      if (referenceType) return referenceType;
      const tagged = detectTaggedIdValue(v);
      if (tagged) {
        return {
          $tagged: {
            value: { $ref: "Id" },
            phantom: {
              $refined: {
                base: { $ref: "String" },
                set: buildSetExpr.enum([tagged.entityType]),
              },
            },
          },
        } as FenelType;
      }
    }

    // 4. Primitive fallback — every value has *some* type, so a card
    //    pinned to a plain string / number / boolean / list / record
    //    still surfaces a type tag. Order matters: arrays first
    //    (typeof [] === "object"), then dates, then plain objects.
    if (v === null || v === undefined) return undefined;
    if (Array.isArray(v)) return List(Anything) as FenelType;
    if (v instanceof Date) return { $ref: "Date" } as FenelType;
    switch (typeof v) {
      case "string":
        return { $ref: "String" } as FenelType;
      case "number":
        return { $ref: "Number" } as FenelType;
      case "boolean":
        return { $ref: "Boolean" } as FenelType;
      case "object": {
        const carrier = carrierTypeName(v);
        return (carrier ? { $ref: carrier } : { $record: { fields: [] } }) as FenelType;
      }
    }

    return undefined;
  });

  const applicableOps = createMemo<CatalogFn[]>(() => {
    if (runState().kind !== "success") return [];
    const t = cardResultType();
    if (!t) return [];
    const info = ioCallInfo();
    const matched = allCatalogFns().filter((c) => {
      if (info && c.fn.id === info.fnId) return false;
      const p0 = (c.fn.params as { type: FenelType }[] | undefined)?.[0]?.type;
      return paramAccepts(t, p0);
    });
    // Relevance ranking — specific param matches rank above polymorphic
    // ones. An op whose first param's phantom-entity matches the
    // result type is the most relevant; one whose first param is just
    // a polymorphic `∀a. a` is least relevant. Pin lives in its own
    // category and is rendered separately, so we still keep it in the
    // list for `splitOps` to peel off.
    const score = (cf: CatalogFn): number => {
      const p0 = (cf.fn.params as { type: FenelType }[] | undefined)?.[0]?.type;
      if (!p0 || typeof p0 !== "object") return 1;
      if ("$tagged" in (p0 as object)) return 3; // entity-specific
      if ("$ref" in (p0 as object)) return 2; // named primitive
      if ("$var" in (p0 as object)) return 0;   // polymorphic
      return 1;
    };
    return [...matched].sort((a, b) => {
      const sa = score(a);
      const sb = score(b);
      if (sa !== sb) return sb - sa;
      return a.codeName.localeCompare(b.codeName);
    });
  });

  /** Split applicable ops into the special "pin" category and the
   *  general operations list. Pin is always first in its own row;
   *  everything else follows in the relevance-ranked list. Polymorphic
   *  fns (∀a. a) are filtered out of `rest` — they tend to flood the
   *  list with std helpers (id, const, render, accum, …) that
   *  aren't meaningful operations on the specific result. The only
   *  polymorphic op we actually want surfaced is pinToView, which
   *  lives in `pin` already. */
  const splitOps = createMemo<{ pin: CatalogFn[]; rest: CatalogFn[] }>(() => {
    const all = applicableOps();
    const pin: CatalogFn[] = [];
    const rest: CatalogFn[] = [];
    const isPolymorphic = (cf: CatalogFn): boolean => {
      const p0 = (cf.fn.params as { type: FenelType }[] | undefined)?.[0]?.type;
      return !!(p0 && typeof p0 === "object" && "$var" in (p0 as object));
    };
    for (const op of all) {
      if (op.fn.id === "state:pinToView") pin.push(op);
      else if (!isPolymorphic(op)) rest.push(op);
    }
    return { pin, rest };
  });

  async function invokeOp(opFn: FenelFunction) {
    const cur = runState();
    const rawHandle = cur.kind === "success" ? cur.value : null;
    // Reconstruct the typed shape for tagged Id<X> values before
    // piping through the op. The IO runtime returns a bare UUID for
    // Id<X> so the server-side type info is lost; rewrapping here
    // means downstream consumers (e.g. pinToView's literal pin)
    // see the structured value and can render it as a chip later.
    const tEntity = entityNameFromTaggedId(cardResultType());
    const handle = tEntity && typeof rawHandle === "string"
      ? {
          $tag: "Id",
          value: rawHandle,
          phantom: {
            $refined: {
              base: { $ref: "String" },
              set: buildSetExpr.enum([tEntity]),
            },
          },
        }
      : rawHandle;
    const args: unknown[] = [handle];
    const params = opFn.params as { type: FenelType }[];
    for (let i = 1; i < params.length; i++) {
      args.push(seedDefault(params[i]!.type));
    }
    setRunState({ kind: "running" });
    try {
      const resp = await api.invokeIOAction(opFn.id, args);
      if (resp.ok) setRunState({ kind: "success", value: resp.value });
      else setRunState({ kind: "error", message: resp.error ?? "Unknown error" });
    } catch (e: any) {
      setRunState({ kind: "error", message: e?.message ?? String(e) });
    }
    void refreshLive();
  }

  // Live deployment indicator. Asks the server whether this io call has
  // an active deployment matching its args (e.g. for runTelegramCollector
  // a bot row with collectorConfig set whose token === args[0]). The
  // signal feeds the green ● Running badge on the card header.
  const [isLive, setIsLive] = createSignal(false);
  async function refreshLive() {
    const info = ioCallInfo();
    if (!info) { setIsLive(false); return; }
    try {
      // B4 wave 4 lane H: a Local reader evaluates them in its worker (guidance).
      const argValues = reader?.kind === "local"
        ? await Promise.all(info.args.map(a => localIOArgument(homeAuthoringSession(), a, props.savedExprById, "guidance").catch(() => null)))
        : info.args.map((a) => {
        try {
          return evaluateAuthoringExpression(a, (id) => props.savedExprById.get(id)).result;
        } catch {
          return null;
        }
      });
      const resp = await api.getIOInstances(info.fnId, argValues);
      // `deployments` = specialized list for fns with
      // listInstancesAction. null when no specialized listing exists.
      const deployments = (resp.deployments ?? []) as Array<{ id?: unknown }>;
      setIsLive(deployments.length > 0);
      // Rehydrate runState from the live deployment after a refresh —
      // otherwise the local signal stays at "idle" and the IO result
      // section + Operations card disappear, leaving an empty card
      // even though the bot is registered. Only triggers when local
      // state is still idle (so an in-flight Run from the user
      // doesn't get clobbered) and only for deployment-type ops
      // whose first deployment carries a usable id.
      const cur = runState();
      const first = deployments[0];
      if (cur.kind === "idle" && first && typeof first.id === "string") {
        setRunState({ kind: "success", value: first.id });
      }
    } catch {
      setIsLive(false);
    }
  }

  /** Persistence fallback: when refreshLive didn't find a live
   *  deployment (or the fn has no listInstancesAction), hydrate the IO
   *  result panel from the most recent completed function_instance for
   *  this fnId. Mirrors the same logic in `useIOCallSurface` so canvas
   *  and non-canvas views show the same persisted result on reload. */
  async function hydrateFromLastRun() {
    const info = ioCallInfo();
    if (!info) return;
    if (runState().kind !== "idle") return;
    try {
      const resp = await api.getIOLastResult(info.fnId);
      if (resp.ok && resp.instance && runState().kind === "idle") {
        setRunState({ kind: "success", value: resp.instance.value });
      }
    } catch { /* best-effort */ }
  }
  onSettled(() => {
    void refreshLive().then(() => void hydrateFromLastRun());
  });

  // The CARD follows the pointer, not a stand-in label. Tracking is a plain
  // `transform` written straight to the node: it neither touches reactive
  // state nor persists anything until the drag ends, so a drag costs one
  // compositor update per frame and no re-render.
  let dragState: {
    startX: number; startY: number;
    startLeft: number; startTop: number;
    pointerId: number; frame?: number;
  } | null = null;
  let resizeState: {
    startX: number; startY: number; startW: number; startH: number; pointerId: number;
    latest?: { w: number; h: number };
  } | null = null;
  /** The size the handle is at while it is held. Like a drag's transform, it
   *  is shown without being saved: the card commits one size on release. On a
   *  derived canvas every save is a new root revision, so saving per pointer
   *  event queued one write per event, each against a stale revision. */
  const [resizeDraft, setResizeDraft] = createSignal<{ w: number; h: number }>();

  let itemEl: HTMLDivElement | undefined;

  function onHeaderPointerDown(e: PointerEvent) {
    if (cardTransfer?.canArrange() === false) return;
    if (e.button !== 0) return;
    const target = e.target as HTMLElement;
    if (target.closest(".home-item__btn, .home-item__remove, input, textarea, select, button")) return;
    const surface = props.getSurface();
    if (!surface || !itemEl) return;

    // Where the card sits before the drag, measured once. The release
    // position is that plus the pointer delta — no second measurement, so
    // nothing depends on when the cleared transform reaches layout.
    const itemRect = itemEl.getBoundingClientRect();
    dragState = {
      startX: e.clientX, startY: e.clientY,
      startLeft: itemRect.left, startTop: itemRect.top,
      pointerId: e.pointerId,
    };
    itemEl.setPointerCapture(e.pointerId);
    itemEl.classList.add("home-item--dragging");
    e.preventDefault();
  }

  function onPointerMove(e: PointerEvent) {
    const drag = dragState;
    if (!drag || !itemEl) return;
    // One write per animation frame. Pointer events can outpace the display,
    // and a card that queues a transform per event tears instead of tracking.
    if (drag.frame !== undefined) cancelAnimationFrame(drag.frame);
    const dx = e.clientX - drag.startX;
    const dy = e.clientY - drag.startY;
    drag.frame = requestAnimationFrame(() => {
      drag.frame = undefined;
      if (dragState === drag && itemEl) itemEl.style.transform = `translate(${dx}px, ${dy}px)`;
    });
  }

  function onPointerUp(e: PointerEvent) {
    const drag = dragState;
    if (!drag) return;
    dragState = null;
    if (drag.frame !== undefined) cancelAnimationFrame(drag.frame);
    const surface = props.getSurface();
    if (itemEl) {
      itemEl.releasePointerCapture(drag.pointerId);
      itemEl.classList.remove("home-item--dragging");
      // Hand the position back to the persisted left/top. Clearing the
      // transform in the same turn as the commit avoids a one-frame snap.
      itemEl.style.transform = "";
    }

    if (surface) {
      const rect = surface.getBoundingClientRect();
      const x = (drag.startLeft + (e.clientX - drag.startX) - rect.left) / rect.width;
      const y = (drag.startTop + (e.clientY - drag.startY) - rect.top) / rect.height;
      props.onMove(x, y);
    }
  }

  // Resize — corner handle. Starts size at the item's current rect (or
  // the configured w/h if set), then translates pointer delta into
  // proportional size changes against the surface.
  function onResizeStart(e: PointerEvent) {
    if (cardTransfer?.canArrange() === false) return;
    if (e.button !== 0) return;
    const surface = props.getSurface();
    if (!surface) return;
    const surfaceRect = surface.getBoundingClientRect();
    const itemEl = (e.currentTarget as HTMLElement).parentElement as HTMLElement | null;
    if (!itemEl) return;
    const itemRect = itemEl.getBoundingClientRect();
    resizeState = {
      startX: e.clientX,
      startY: e.clientY,
      startW: (props.item.w ?? itemRect.width / surfaceRect.width),
      startH: (props.item.h ?? itemRect.height / surfaceRect.height),
      pointerId: e.pointerId,
    };
    (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
    e.preventDefault();
    e.stopPropagation();
  }

  function onResizeMove(e: PointerEvent) {
    if (!resizeState) return;
    const surface = props.getSurface();
    if (!surface) return;
    const rect = surface.getBoundingClientRect();
    const dx = (e.clientX - resizeState.startX) / rect.width;
    const dy = (e.clientY - resizeState.startY) / rect.height;
    const w = Math.max(0.06, resizeState.startW + dx);
    const h = Math.max(0.06, resizeState.startH + dy);
    resizeState.latest = { w, h };
    setResizeDraft({ w, h });
  }

  function onResizeEnd(e: PointerEvent) {
    if (!resizeState) return;
    (e.currentTarget as HTMLElement).releasePointerCapture(resizeState.pointerId);
    const size = resizeState.latest;
    resizeState = null;
    setResizeDraft(undefined);
    if (size) props.onResize(size.w, size.h);
  }

  /** Copy belongs to the card's BAR, next to Duplicate — the two are the same
   *  kind of act on the same subject. It used to live inside the card BODY, on
   *  the value surface, where it read as an operation on whatever it happened
   *  to be sitting next to, and reported itself by parking the word "Copied."
   *  under the value for good. Here it is one icon and one toast that expires.
   *
   *  It writes the real system clipboard: the Fenel payload, plus text/plain
   *  and text/html, so it pastes into other apps as well as back into Fenel. */
  const cardTransfer = useContext(HomeDataContext);
  /** The value this card is showing — reused to answer "can it be entered?"
   *  rather than evaluating the same expression again for the same answer. */
  const enterableValue = () => (evaluated() as { result?: unknown }).result;
  const [copied, setCopied] = createSignal<string>();
  let copiedTimer: ReturnType<typeof setTimeout> | undefined;
  onCleanup(() => clearTimeout(copiedTimer));
  function flashCopied(text: string) {
    clearTimeout(copiedTimer);
    setCopied(text);
    copiedTimer = setTimeout(() => setCopied(undefined), 1300);
  }
  const copyableValue = createMemo(() => {
    const value = (evaluated() as { result?: unknown }).result;
    return value === undefined || value === null ? undefined : value;
  });
  // B4 wave 4 lane H: a Local reader's copy is prepared in its worker
  // (`prepare-reader-transfer-item`) when the Copy button is approached
  // (pointer or focus), and written inside the click; nothing awaits before
  // the clipboard write. Still being prepared refuses with the menu's copy.
  const [copyArmed, setCopyArmed] = createSignal(false);
  const localCopy = reader?.kind === "local" && cardTransfer ? createLocalReaderAnswer(() => reader, () => cardTransfer.session(), () => {
    const value = copyArmed() ? copyableValue() : undefined;
    return value === undefined ? undefined : { method: "prepare-reader-transfer-item" as const, priority: "guidance" as const,
      item: { value: cloneDraftValue(value), type: cardTransfer.type(props.item) ?? props.item.valueType, typeName: classifyData(value),
        label: props.item.caption, source: "fenel" as const } };
  }, readActionResult<TransferItem>("transferItem", value => !!value && typeof value === "object"), { via: () => cardTransfer.session() }) : undefined;
  async function copyCard() {
    const context = cardTransfer;
    const value = copyableValue();
    if (!context || value === undefined) return;
    if (localCopy) {
      try {
        const prepared = localCopy.answer();
        if (!prepared) throw new Error(localCopy.failure() ?? "This data changed. Copy again when its display is ready.");
        if (prepared.$tag === "Err") throw new Error(prepared._0);
        flashCopied(await copyTransferItem(prepared._0) ?? "Copied");
      } catch (error) {
        // The refusal's own copy (still preparing, the worker's message).
        flashCopied(error instanceof Error && error.message ? error.message : "Could not copy");
      }
      return;
    }
    try {
      const session = context.session();
      const historyNotice = await copyTransferItem(prepareTransferItem({
        value: cloneDraftValue(value),
        type: context.type(props.item) ?? props.item.valueType,
        typeName: classifyData(value),
        label: props.item.caption,
        source: "fenel",
      }, session.environment, session.registry, session.evaluateContext));
      flashCopied(historyNotice ?? "Copied");
    } catch (error) {
      flashCopied(error instanceof Error && error.message ? "Could not copy" : "Could not copy");
    }
  }

  // Read this card as Fenel source instead of as its value. Printing is only
  // done while the lens is open, so a card that is never toggled never pays it.
  const codeView = () => !!data?.codeOpen(props.item.id);
  createEffect(codeView, (open) => { if (open && !expanded()) props.onToggleExpanded(); });
  // B4 wave 4 lane H: a Local reader's card code prints in its worker.
  const localCode = localItemSource(codeView, () => ({ item: props.item, saved: props.savedExprById, evaluated: data?.evaluated(props.item) }));
  const fenelSource = createMemo(() => codeView()
    ? localCode ? localCode() : itemFenelSource(props.item, props.savedExprById, data?.evaluated(props.item))
    : "");

  const itemStyle = createMemo(() => {
    const style: Record<string, string> = {
      left: `${(((props.item.x ?? 0.5)) * 100).toFixed(3)}%`,
      top: `${(((props.item.y ?? 0.5)) * 100).toFixed(3)}%`,
    };
    const draft = resizeDraft();
    const width = draft?.w ?? props.item.w;
    const height = draft?.h ?? props.item.h;
    if (typeof width === "number") {
      style.width = `${(width * 100).toFixed(3)}%`;
      style["max-width"] = "none";
    }
    // Persisted height only applies when expanded. Collapsing the card
    // hides the body, so retaining the persisted height would leave an
    // empty rectangle below the header. Omitting `height` lets the
    // card auto-size to the header (and resize handle) instead.
    if (typeof height === "number" && expanded()) {
      style.height = `${(height * 100).toFixed(3)}%`;
      style["max-height"] = "none";
    }
    return style;
  });

  return (
    <div
      ref={itemEl}
      class={["home-item", { "home-item--selected": props.selected, "home-item--preparing": expanded() && !codeView() && evaluation.loading() }]}
      aria-busy={expanded() && !codeView() && evaluation.loading() ? "true" : undefined}
      data-locus-item={props.item.id}
      data-selected={props.selected ? "true" : "false"}
      aria-selected={props.selected ? "true" : "false"}
      style={itemStyle()}
      onPointerDown={(event) => {
        // Selecting is what a click on the card MEANS. The card's own buttons
        // stop propagation for their own actions, so this never steals them.
        if (event.button !== 0) return;
        const target = event.target as HTMLElement;
        if (target.closest(".home-item__btn, .home-item__remove, input, textarea, select, button")) return;
        props.onSelect(event.ctrlKey || event.metaKey || event.shiftKey);
      }}
      onPointerMove={onPointerMove}
      onPointerUp={onPointerUp}
      onPointerCancel={onPointerUp}
    >
      <div class="home-item__header" onPointerDown={onHeaderPointerDown} style="cursor: grab">
        <button
          type="button"
          class="home-item__btn"
          onClick={(e) => { e.stopPropagation(); props.onToggleExpanded(); }}
          data-tooltip={expanded() ? "Collapse" : "Expand"}
        >{expanded() ? "▾" : "▸"}</button>
        <ValueCardHeading item={props.item} caption={displayCaption()} type={cardResultType()} declaredType={props.item.valueType} value={evaluated().result}
          representations={props.item.representations} onOpen={cardTransfer
            ? () => cardTransfer.enter(props.item, data?.evaluated(props.item)) : undefined} />
        <ItemExpressionAction item={props.item} savedExprById={props.savedExprById} evaluated={data?.evaluated(props.item)} />
        {/* Header status reflects the *invocation*, not any
            downstream deployment that the call may have left in the
            runtime. A finished one-shot whose return value is a
            live entity (e.g. runTelegramCollector → Id<bot> with the
            bot still registered) reads as "● finished" here — the
            call itself returned. The deployment's own liveness is
            shown on its instance chip on the function pin card. */}
        <Show when={runState().kind === "success"}>
          <span
            data-tooltip="The io call finished successfully on this card"
            style="color: #6b7280; font-size: 0.7rem; margin-right: 0.25rem"
          >● finished</span>
        </Show>
        <Show when={runState().kind === "running"}>
          <span
            data-tooltip="The io call is currently running"
            style="color: #16a34a; font-size: 0.7rem; margin-right: 0.25rem"
          >● running</span>
        </Show>
        <Show when={runState().kind === "suspended"}>
          <span
            data-tooltip="The io call is suspended waiting for input"
            style="color: #b45309; font-size: 0.7rem; margin-right: 0.25rem"
          >● awaiting</span>
        </Show>
        <Show when={pinInfo()}>
          <button
            type="button"
            class="home-item__btn home-item__btn--accent"
            onClick={(e) => {
              e.stopPropagation();
              props.onCallFunction(pinInfo()!);
            }}
            data-tooltip="Instantiate this function"
          >▶</button>
        </Show>
        {/* A declared Stop action consumes the successful run's handle. */}
        <Show when={ioCallInfo() && runState().kind !== "running" && runState().kind !== "suspended"}>
          <button
            type="button"
            class="home-item__btn home-item__btn--accent"
            onClick={(e) => { e.stopPropagation(); confirmAndRunIOCall(); }}
            data-tooltip="Run this IO call"
          >▶</button>
        </Show>
        <Show when={canStop()}>
          <button
            type="button"
            class="home-item__btn"
            style="color: #c0392b"
            onClick={(e) => { e.stopPropagation(); void stopIOCall(); }}
            data-tooltip="Stop the deployment returned by this call"
          >■</button>
        </Show>
        <button
          type="button"
          class="home-item__btn"
          style={props.item.edgesShown ? "color: #111827; font-weight: 700" : ""}
          onClick={(e) => { e.stopPropagation(); props.onToggleEdges(); }}
          data-tooltip={props.item.edgesShown ? "Show all cards' connections" : "Show only this card's connections"}
        >↔</button>
        {/* Entering a card makes ITS value the locus. There is nothing to
            implement behind this: the card holds a value, a view renders a
            value, so the root view can render that one. */}
        <Show when={cardTransfer?.canLift(props.item)}>
          <button
            type="button"
            class="home-item__btn"
            onClick={(e) => { e.stopPropagation(); cardTransfer!.lift(props.item); }}
            data-tooltip={cardTransfer!.liftLabel()}
            aria-label="Move out"
          >↥</button>
        </Show>
        <Show when={cardTransfer?.canEditExpression() !== false}>
          <button
            type="button"
            class="home-item__btn"
            onClick={(e) => { e.stopPropagation(); props.onEdit(); }}
            data-tooltip="Edit"
          >✎</button>
        </Show>
        <button
          type="button"
          class="home-item__btn"
          onClick={(e) => { e.stopPropagation(); props.onDuplicate(); }}
          data-tooltip="Duplicate"
        >⎘</button>
        <Show when={cardTransfer && copyableValue() !== undefined}>
          <span class="home-item__copy-slot">
            <button
              type="button"
              class="home-item__btn"
              onClick={(e) => { e.stopPropagation(); void copyCard(); }}
              onPointerEnter={() => setCopyArmed(true)} onFocus={() => setCopyArmed(true)}
              data-tooltip="Copy this data to the clipboard"
              aria-label="Copy data"
            >⧉</button>
            <Show when={copied()}>{(text) => (
              <span class="home-item__copied" role="status">{text()}</span>
            )}</Show>
          </span>
        </Show>
        <button
          type="button"
          class="home-item__remove"
          onClick={(e) => {
            e.stopPropagation();
            // At the root a card stands for a whole data set, and inside a
            // value it stands for one of its contents. Those deserve their
            // own question, which the scope asks — so the card asks only
            // where it is the one that knows what removal means.
            if (cardTransfer?.scopeConfirmsRemoval()) { props.onRemove(); return; }
            void confirmDialog({
              message: "Remove this item from the list?",
              variant: "danger",
              confirmLabel: "Remove",
            }).then((ok) => {
              if (ok) props.onRemove();
            });
          }}
          data-tooltip="Remove from list"
        >×</button>
      </div>
      <Show when={expanded()}>
      <div class="home-item__body">
        <Show when={codeView()}>
          <pre class="home-item__code">{fenelSource()}</pre>
        </Show>
        <Show when={!codeView() && (evaluated() as any).error}>
          <ValueFailure message={(evaluated() as { error?: string }).error} label={props.item.caption} retry={() => { void evaluation.retry(); }} />
        </Show>
        <Show when={!codeView() && evaluation.loading()}><CardLoadingIndicator /></Show>
        <Show when={!codeView() && !evaluation.loading() && !(evaluated() as any).error}>
          {/* IO call cards have no meaningful inline result (the call
              itself is the value — the runtime executes it on Run);
              suppress the ResultBody to avoid a "(none)" placeholder
              floating above the actual IO result section below. */}
          <Show when={!ioCallInfo() || (evaluated().result != null && evaluated().result !== undefined)}>
            <ResultBody
              value={evaluated().result}
              item={props.item}
              onCallFunction={props.onCallFunction}
              localReps={props.item.representations}
            />
          </Show>
        </Show>
        {/* IO sections, grouped so they share one gap. The body itself is a
            column now, so this no longer has to defend against the value and
            the operations card being laid out side by side. */}
        <div style="display: flex; flex-direction: column; gap: 0.5rem; width: 100%;">
        <Show when={ioCallInfo() && runState().kind !== "idle"}>
          <div style="margin-top: 0.5rem; padding-top: 0.5rem; border-top: 1px solid var(--border)">
            <Show when={runState().kind === "running"}>
              <div class="text-muted" style="font-size: 0.85rem">Running…</div>
            </Show>
            <Show when={runState().kind === "error"}>
              <ValueFailure message={(runState() as any).message} label={props.item.caption} />
            </Show>
            <Show when={runState().kind === "suspended"}>
              <div style="font-size: 0.85rem">
                <div class="text-muted" style="margin-bottom: 0.4rem">
                  Awaiting input — function suspended on a `read` call.
                </div>
                <div style="display: flex; gap: 0.4rem; flex-wrap: wrap">
                  <button type="button" class="home-item__btn" onClick={() => void resolveSuspended(true)}>
                    Yes
                  </button>
                  <button type="button" class="home-item__btn" onClick={() => void resolveSuspended(false)}>
                    No
                  </button>
                </div>
              </div>
            </Show>
            <Show when={runState().kind === "success"}>
              <div style="font-size: 0.85rem">
                <div class="text-muted" style="margin-bottom: 0.25rem">IO result:</div>
                <IOResultView
                  value={(runState() as any).value}
                  typeRef={cardResultType()}
                />
              </div>
            </Show>
          </div>
        </Show>
        <Show when={runState().kind === "success" && applicableOps().length > 0}>
          <div class="home-item__ops-card">
            <Show when={splitOps().pin.length > 0}>
              <div class="home-item__ops-list">
                <For each={splitOps().pin}>
                  {(op) => (
                    <button
                      type="button"
                      class="home-item__op-btn home-item__op-btn--neutral"
                      onClick={(e) => { e.stopPropagation(); void invokeOp(op.fn); }}
                      data-tooltip={op.codeName}
                    >
                      {/* Prefer the lucide icon (Iconable) when there's
                          a registered SVG component for the name; fall
                          back to the emoji glyph (Emojiable) otherwise.
                          Either renders inside the same span slot. */}
                      <Show
                        when={getIcon(op.fn.id) && LUCIDE_BY_NAME[getIcon(op.fn.id)!]}
                        fallback={
                          <Show when={getEmoji(op.fn.id)}>
                            <span class="home-item__op-btn__icon">{getEmoji(op.fn.id)}</span>
                          </Show>
                        }
                      >
                        <span class="home-item__op-btn__icon">
                          <IconByName name={getIcon(op.fn.id)} size={14} />
                        </span>
                      </Show>
                      {op.label ?? op.codeName}
                    </button>
                  )}
                </For>
              </div>
            </Show>
            <Show when={splitOps().rest.length > 0}>
              <div
                class="home-item__ops-title"
                style={splitOps().pin.length > 0 ? "margin-top: 0.6rem;" : ""}
              >
                Operations on result
              </div>
              <div class="home-item__ops-list">
                <For each={splitOps().rest}>
                  {(op) => (
                    <button
                      type="button"
                      class="home-item__op-btn"
                      onClick={(e) => { e.stopPropagation(); void invokeOp(op.fn); }}
                      data-tooltip={op.codeName}
                    >
                      {/* Prefer the lucide icon (Iconable) when there's
                          a registered SVG component for the name; fall
                          back to the emoji glyph (Emojiable) otherwise.
                          Either renders inside the same span slot. */}
                      <Show
                        when={getIcon(op.fn.id) && LUCIDE_BY_NAME[getIcon(op.fn.id)!]}
                        fallback={
                          <Show when={getEmoji(op.fn.id)}>
                            <span class="home-item__op-btn__icon">{getEmoji(op.fn.id)}</span>
                          </Show>
                        }
                      >
                        <span class="home-item__op-btn__icon">
                          <IconByName name={getIcon(op.fn.id)} size={14} />
                        </span>
                      </Show>
                      {op.label ?? op.codeName}
                    </button>
                  )}
                </For>
              </div>
            </Show>
          </div>
        </Show>
        </div>
      </div>
      </Show>
      {/* Resize handle — bottom-right corner. Captures its own pointer
          events so the parent's drag handler doesn't fire. Hidden
          when the card is collapsed: there's no body to resize and
          dragging would otherwise grow the empty area. */}
      <Show when={expanded()}>
        <div
          class="home-item__resize"
          onPointerDown={onResizeStart}
          onPointerMove={onResizeMove}
          onPointerUp={onResizeEnd}
          onPointerCancel={onResizeEnd}
          data-tooltip="Drag to resize"
        />
      </Show>
    </div>
  );
}

// ---------------------------------------------------------------------------
// EditModal — opened by clicking the ✎ button on any home item. The
// editor surface is the full ExpressionEditor + ExpressionTrace so the
// user gets the same composer/observability they have in /app/values.
//
// Two save paths:
//   - Ref item   → PUT savedQueries/<id> (every pin of this ref everywhere
//                  picks up the change immediately)
//   - Inline item → PUT locusViews/<homeId> with the item's expr replaced
// ---------------------------------------------------------------------------

function EditModal(props: Parameters<typeof EditModalContent>[0]) {
  return <EditorPreparation label={props.standalone ? "Open data" : "Edit data"} onClose={props.onClose}><EditModalContent {...props} /></EditorPreparation>;
}

function EditModalContent(props: {
  item: LayoutItem;
  homeId: string;
  /** Browse opens the referenced definition/value itself, without a card or
   * root mutation. It uses this same inspector and its captured reader. */
  standalone?: "definition" | "saved";
  savedExprById: Map<string, ExprNode>;
  expectedSavedQuery?: Record<string, unknown>;
  sourceTicket?: HomeSourceTicket;
  /** `signal` ends with this editor: a Local reader's Save admission aborts with it. */
  onSaveItem?: (item: LayoutItem, expr: ExprNode, definitionBundle?: Parameters<typeof api.definitionBundleSave>[0], occurrenceChanged?: boolean, assertCurrent?: () => void, signal?: AbortSignal) => Promise<void>;
  onApplied?: () => void;
  onClose: () => void;
}) {
  const { reader, client, api, getLocusRoot, editLocusRoot, getFunctionByName, getTypeByName, getFunctionInstancesById, getInstanceTimeline, revalidate, userFunctions, reloadUserRegistries, prepareAuthoringSessionForFunction, resolveCatalogReference, homeAuthoringSession, temporaryEdits, captureSourceTicket, assertSourceTicket } = useHomeReader();
  const sourceTicket = untrack(() => props.sourceTicket ?? captureSourceTicket());
  const [fieldFacets, setFieldFacets] = createSignal<FieldFacetDraftMap>({});
  const [fieldFacetsDirty, setFieldFacetsDirty] = createSignal(false);
  const fieldResurrections = createFieldResurrectionSelection();
  const changeFieldFacet = (fieldId: string, next: FieldFacetDraftMap[string]) => {
    setFieldFacets((current) => ({ ...current, [fieldId]: next }));
    setFieldFacetsDirty(true);
  };
  const hydrateFieldFacet = (fieldId: string, next: FieldFacetDraftMap[string]) => {
    setFieldFacets((current) => Object.prototype.hasOwnProperty.call(current, fieldId)
      ? current
      : { ...current, [fieldId]: next });
  };
  const forgetFieldFacet = (fieldId: string) => {
    setFieldFacets((current) => forgetFieldFacetDrafts(current, fieldId));
  };
  const initial = createMemo<ExprNode>(() => {
    const expr = resolveExpr(props.item, props.savedExprById);
    return expr ?? emptyExpressionSlot();
  });
  const [draft, setDraft] = createSignal<ExprNode>(initial());
  // Display typed constructor data through the existing editable projection.
  // The retained source and draft stay byte-faithful until a real field edit;
  // unknown tags/extra fields remain literal under that canonical boundary.
  const visualDraft = createMemo(() => {
    const current = draft();
    const type = props.item.valueType;
    return current.kind === "literal" && type && !detectStructuralForm(current.value)
      ? expressionForLiteralValue(current.value, type, homeAuthoringSession().environment)
      : current;
  });
  const [savedBaseline, setSavedBaseline] = createSignal<{ id: string; fingerprint: string } | null>(null);
  let initializedSavedId: string | undefined;
  createEffect(
    () => {
      const id = props.item.source?.kind === "ref" ? props.item.source.ref.id : undefined;
      return { id, expr: id ? props.savedExprById.get(id) : undefined };
    },
    ({ id, expr }) => {
      if (id !== undefined && id === initializedSavedId) return;
      if (!id || !expr) { initializedSavedId = undefined; setSavedBaseline(null); return; }
      initializedSavedId = id;
      setSavedBaseline({ id, fingerprint: draftValueFingerprint(expr) });
      setDraft(cloneDraftValue(expr));
    },
  );
  const savedExpressionChanged = createMemo(() => {
    const baseline = savedBaseline();
    const current = baseline ? props.savedExprById.get(baseline.id) : undefined;
    return !!baseline && (!current || draftValueFingerprint(current) !== baseline.fingerprint);
  });
  const [saving, setSaving] = createSignal(false);
  const [saveError, setSaveError] = createSignal<string | null>(null);

  // Live-trace drawer — default closed so the expression editor gets
  // full width. Pinning it permanently steals horizontal room from the
  // editor, which matters most for nested function bodies (a deep tree
  // gets cropped on the right edge by the always-on trace).
  const [traceOpen, setTraceOpen] = createSignal(false);
  let dismissed = false;
  let saveInFlight = false;
  let savedPreviewController: AbortController | undefined;
  /** B4 slice 1: a Local Save admission in flight ends with this editor. */
  let saveController: AbortController | undefined;
  onSettled(() => () => { dismissed = true; savedPreviewController?.abort(); saveController?.abort(); });
  /** B4 fix round 2: this surface's pending nested value checks. */
  const draftScope = {};
  function close() {
    dismissed = true;
    savedPreviewController?.abort();
    saveController?.abort();
    props.onClose();
  }
  // Vertical-stack mode for match arms (and other side-by-side form
  // rows). Big screens fit `| pat → body |` on one line, but a deeply
  // nested match body quickly runs out of horizontal room — flipping
  // this on puts the body under the pattern instead.
  const [armsStacked, setArmsStacked] = createSignal(false);
  // Instance-trace overlay state — when the pinned item is a function,
  // the user can pick one of that function's recent invocations and the
  // editor decorates each binding / call site with its actual runtime
  // value. The overlay is opt-in: `null` means "edit mode" (no traces);
  // any string is a specific instance id.
  const [selectedInstanceId, setSelectedInstanceId] = createSignal<string | null>(null);

  // Function-reference detection: when the item is a literal reference to a
  // function (`{$ref}`, or a legacy `{$pin: "function"}`), the modal surfaces
  // the function's body (signature + Fenel-printed orchestration) so the
  // user can inspect / debug without clicking through to the function page.
  let knownFunctionReference: { id: string; name: string } | undefined;
  const functionPin = createMemo<{
    id: string;
    name: string;
    fn: FenelFunction | null;
  } | null>(() => {
    const d = draft();
    if (d.kind !== "literal") return null;
    const reference = readLocusCatalogReference(d.value);
    if (!reference) return null;
    const target = resolveCatalogReference(reference);
    if ((target?.kind ?? reference.kind) !== "function") {
      return reference.id === knownFunctionReference?.id ? { ...knownFunctionReference, fn: null } : null;
    }
    return { id: reference.id, name: reference.name ?? reference.id, fn: target ? target.value as FenelFunction : null };
  });

  const functionSignature = createMemo<string | null>(() => {
    const fp = functionPin();
    if (!fp?.fn) return null;
    const params = (fp.fn.params ?? [])
      .map((p) => `${p.name}: ${typeLabel(p.type)}`)
      .join(", ");
    const ret = typeLabel(fp.fn.returns);
    return `(${params}) → ${ret}`;
  });

  // Saved ingress owns declaration mode; effective registry signatures have
  // already replaced Absent slots and cannot reconstruct that authored choice.
  const functionDefinition = createMemo(async () => {
    const fp = functionPin();
    if (!fp) return null;
    try {
      const resp = await getFunctionByName(fp.id);
      return (resp as { definition?: FunctionDefinitionRow & { function?: FenelFunction } } | null)?.definition ?? null;
    } catch { return null; }
  });
  const functionRowId = createMemo(() => functionDefinition()?.id ?? null);
  const persistedFunctionRow = createMemo(() => persistedFunctionDefinition(functionDefinition()) ?? null);
  const functionIngress = createMemo(() => functionDefinition()?.function);
  const [definitionLens, setDefinitionLens] = createSignal<"simple" | "full">("simple");
  const [functionResultMode, setFunctionResultMode] = createSignal<"infer" | "explicit">("explicit");
  const [functionSchemeMetadata, setFunctionSchemeMetadata] = createSignal<Omit<TypeScheme, "body">>({ quantified: [] });
  const [functionSignatureDirty, setFunctionSignatureDirty] = createSignal(false);
  const [functionGenericIssue, setFunctionGenericIssue] = createSignal<string>();
  const [functionRequirements, setFunctionRequirements] = createSignal<FenelFunction["requires"]>();

  const functionSourceAuthoringSession = createMemo(() => {
    const fn = functionPin()?.fn;
    if (!fn) return undefined;
    if (reader) return reader.prepareFunction(fn.id);
    const current = subject();
    return prepareAuthoringSessionForFunction(
      fn.id,
      current?.$tag === "User" || current?.$tag === "Bot"
        ? { accountId: current.accountId, functions: userFunctions() }
        : undefined,
    );
  });

  /** Convert the function's JSON-Logic body into the ExpressionEditor's
   *  ExprNode AST so the body renders through the structured editor
   *  (function picker, lambda builder, ref / param toggles) instead of
   *  raw text. Operators outside ExprNode's native vocabulary (do /
   *  let / match / if / construct / cat / arithmetic / boolean) get
   *  wrapped as opaque calls with synthetic fnIds — they still appear
   *  as nodes in the editor tree, just labelled with the operator
   *  name. Variables (`{var:"x"}`) map to lambda-param refs. Lambdas
   *  (`{fn:[…, body]}`) map to literal `__lambda` values, the same
   *  shape NewValueModal's lambda builder produces. */
  // B4 unit D item 2: a Local reader raises the body in its worker, in the
  // function's own frame (weight 0: the editor waits on it); the editor
  // initializes once the answer arrives, never from an empty draft.
  const localFunctionBody = reader?.kind === "local" ? createLocalReaderAnswer(() => reader, homeAuthoringSession, () => {
    const fn = functionIngress() ?? functionPin()?.fn;
    if (fn?.body === undefined) return undefined;
    return { method: "raise-reader-logic" as const, logic: fn.body, params: fn.params?.map((p) => p.name) ?? [] };
  }, readActionResult<ExprNode>("raised", value => !!value && typeof value === "object"),
  { via: () => functionSourceAuthoringSession() }) : undefined;
  /** A Local body whose worker answer has not arrived. */
  const functionBodyPending = () => {
    const fn = functionIngress() ?? functionPin()?.fn;
    return !!localFunctionBody && fn?.body !== undefined && localFunctionBody.answer() === undefined;
  };
  const functionBodyExpr = createMemo<ExprNode | null>(() => {
    const fp = functionPin();
    const fn = functionIngress() ?? fp?.fn;
    if (fn?.body === undefined) return null;
    if (localFunctionBody) {
      const raised = localFunctionBody.answer();
      if (!raised) return null;
      if (raised.$tag === "Err") throw new Error(raised._0);
      return raised._0;
    }
    return logicToExprNode(
      fn.body,
      fn.params?.map((p) => p.name) ?? [],
      functionSourceAuthoringSession(),
    );
  });
  const [bodyDraft, setBodyDraft] = createSignal<ExprNode | null>(null);
  const functionHasBody = createMemo(() => bodyDraft() !== null);

  /** Editable draft of the function's signature — `(params) → returns`.
   *  Rendered above the body via TypeBuilder in `lockKind="arrow"` mode
   *  so users can rename / retype / add / remove params from the same
   *  modal that owns the body. Initialized once from the function spec;
   *  persisted on save via the atomic definition bundle. The body editor reads
   *  `params` from this draft (not from the original `fp.fn.params`) so
   *  the param picker / lambda-param context picks up renames live. */
  const initialArrowDraft = createMemo<FenelType | null>(() => {
    const fp = functionPin();
    const fn = functionIngress() ?? fp?.fn;
    if (!fn) return null;
    if (fn.signatureDeclaration?.scheme) return fn.signatureDeclaration.scheme.body;
    return {
      $arrow: {
        params: (fn.params ?? []) as FieldDef[],
        returns: fn.returns as FenelType,
      },
    } as FenelType;
  });
  const [arrowDraft, setArrowDraft] = createSignal<FenelType | null>(null);
  const [functionBaseline, setFunctionBaseline] = createSignal<{
    id: string; fn: FenelFunction; body: ExprNode | null; arrow: FenelType; fingerprint: string; ingressFingerprint?: string;
  } | null>(null);
  let initializedFunctionId: string | undefined;
  createEffect(
    () => ({ pin: functionPin(), ingress: functionIngress(), body: functionBodyExpr(), arrow: initialArrowDraft(), pending: functionBodyPending() }),
    ({ pin, ingress, body, arrow, pending }) => {
      if (initializedFunctionId !== undefined && pin?.id === initializedFunctionId) return;
      if (pending) return;
      const fn = ingress ?? pin?.fn;
      if (!pin || !fn || !arrow) {
        initializedFunctionId = undefined;
        knownFunctionReference = undefined;
        setFunctionBaseline(null); setBodyDraft(null); setArrowDraft(null);
        return;
      }
      initializedFunctionId = pin.id;
      const baseline = { id: pin.fn?.id ?? fn.id, fn: cloneDraftValue(fn), body: body ? cloneDraftValue(body) : null,
        arrow: cloneDraftValue(arrow), fingerprint: draftValueFingerprint(pin.fn),
        ingressFingerprint: ingress ? draftValueFingerprint(ingress) : undefined };
      knownFunctionReference = { id: pin.id, name: pin.name };
      setFunctionBaseline(baseline);
      setBodyDraft(baseline.body);
      setArrowDraft(baseline.arrow);
      const { body: _signatureBody, ...metadata } = fn.signatureDeclaration?.scheme ?? { quantified: [], body: arrow };
      setFunctionSchemeMetadata(cloneDraftValue(metadata));
      setFunctionResultMode(ingress?.signatureDeclaration?.returns.$tag === "Absent" ? "infer" : "explicit");
      setFunctionRequirements(cloneDraftValue(fn.requires));
      setFunctionSignatureDirty(false); setFunctionGenericIssue(undefined);
    },
  );
  const functionDefinitionChanged = createMemo(() => {
    const baseline = functionBaseline();
    const current = functionPin()?.fn;
    return !!baseline && (!current || current.id !== baseline.id || draftValueFingerprint(current) !== baseline.fingerprint
      || baseline.ingressFingerprint !== undefined && draftValueFingerprint(functionIngress()) !== baseline.ingressFingerprint);
  });

  const functionSignatureShapeIssue = createMemo(() => {
    const baseline = functionBaseline();
    if (!baseline) return undefined;
    const type = baseline.arrow;
    return !("$arrow" in type) || type.$arrow.params.length !== baseline.fn.params.length
      ? "This signature has a different parameter structure. Edit it in its source to preserve its binders." : undefined;
  });
  const functionOwnedScheme = createMemo<TypeScheme | undefined>(() => {
    const type = arrowDraft();
    return type ? { ...functionSchemeMetadata(), body: type } : undefined;
  });
  function installFunctionScheme(scheme: TypeScheme) {
    if (functionSignatureShapeIssue() || !("$arrow" in scheme.body)) {
      setSaveError(functionSignatureShapeIssue() ?? "The function signature needs an arrow type."); return;
    }
    const { body, ...metadata } = scheme;
    setFunctionSchemeMetadata(metadata); setArrowDraft(body); setFunctionSignatureDirty(true);
  }
  function editSavedFunctionGeneric(edit: AuthoringGenericEdit): { ok: true } | { ok: false; message: string } {
    const scheme = functionOwnedScheme();
    const issue = functionSignatureShapeIssue();
    if (!scheme || issue) return { ok: false, message: issue ?? "Wait for this function's signature." };
    const result = editAuthoringGenericDeclaration(cloneDraftValue({ scheme,
      ...(bodyDraft() === null ? {} : { body: bodyDraft()! }), requires: functionRequirements() }), edit);
    if (!result.ok) return result;
    installFunctionScheme(result.value.scheme);
    if (result.value.body !== undefined) setBodyDraft(result.value.body);
    setFunctionRequirements(result.value.requires);
    return { ok: true };
  }
  const functionDeclaration = createMemo(() => {
    const fn = functionBaseline()?.fn;
    const scheme = functionOwnedScheme();
    if (!fn || !scheme || !("$arrow" in scheme.body) || functionSignatureShapeIssue()) return fn?.signatureDeclaration;
    const original = functionIngress()?.signatureDeclaration;
    return buildAuthoringSignatureDeclaration({ functionId: fn.id,
      declarationName: original?.declarationName ?? fn.id, codeName: original?.codeName ?? fn.id,
      ownerModule: `authoring-${fn.id}`, parameterCount: scheme.body.$arrow.params.length,
      inferResult: functionHasBody() && functionResultMode() === "infer", scheme });
  });
  let approvedFunctionFields: FieldDef[] | undefined;
  // B4 wave 4 lane H: a Local reader reconciles this editor's signature
  // guards in its worker, in the function's own frame (held type edits,
  // followed name edits; `createLocalSignatureGuard`), and its type shape in
  // the reader's frame (followed: text typed into a type is never held).
  const localFunctionSignature = reader?.kind === "local" ? createLocalSignatureGuard({ reader: () => reader,
    session: homeAuthoringSession, via: () => functionAuthoringSession(), closed: () => dismissed,
    refuse: message => setSaveError(message) }) : undefined;
  const localTypeSignature = reader?.kind === "local" ? createLocalSignatureGuard({ reader: () => reader,
    session: homeAuthoringSession, via: () => reader.session(), closed: () => dismissed,
    refuse: message => setSaveError(message) }) : undefined;
  /** The parameter rows the body is reconciled with while a Local name edit
   * follows (`undefined`: the shown rows). */
  let reconciledFunctionFields: FieldDef[] | undefined;
  const consistentFunctionFields = () => reconciledFunctionFields ?? functionParameterFields();
  const withFunctionParams = (scheme: TypeScheme, params: FieldDef[], returns?: FenelType): TypeScheme => {
    const arrow = (scheme.body as { $arrow: { params: FieldDef[]; returns: FenelType } }).$arrow;
    return { ...scheme, body: { $arrow: { ...arrow, params, ...(returns ? { returns } : {}) } } };
  };
  function guardFunctionFields(next: readonly FieldDef[]) {
    const scheme = functionOwnedScheme();
    if (!scheme || !("$arrow" in scheme.body) || functionSignatureShapeIssue()) {
      setSaveError(functionSignatureShapeIssue() ?? "Wait for this function's signature."); return false;
    }
    if (localFunctionSignature) {
      const rows = [...next];
      const applyReconciled = (reconciled: ReaderSignatureReconciled) => {
        if (bodyDraft() !== null) setBodyDraft(reconciled.binding!.body);
        reconciledFunctionFields = undefined;
        installFunctionScheme(reconciled.scheme);
      };
      if (parameterTextEdit(functionParameterFields(), rows)) {
        // The typed name shows at once; the body's reconciliation follows.
        reconciledFunctionFields = consistentFunctionFields();
        approvedFunctionFields = rows;
        setArrowDraft(withFunctionParams(scheme, rows).body); setFunctionSignatureDirty(true);
        localFunctionSignature.follow({ base: () => [], state: () => [arrowDraft(), functionSchemeMetadata(), bodyDraft()],
          edit: () => {
            const consistent = reconciledFunctionFields, current = functionOwnedScheme();
            if (!consistent || !current || draftValueFingerprint(consistent) === draftValueFingerprint(functionParameterFields())) return undefined;
            const returns = functionBodyReturnType()!;
            return { kind: "binding-rows", draft: { params: consistent, body: bodyDraft() ?? emptyExpressionSlot(), returns },
              next: functionParameterFields(), scheme: withFunctionParams(current, consistent) };
          }, apply: applyReconciled });
        setSaveError(null); return true;
      }
      localFunctionSignature.hold({ base: () => [functionParameterFields(), functionSchemeMetadata()], state: () => [bodyDraft()],
        edit: () => {
          const current = functionOwnedScheme();
          if (!current || !("$arrow" in current.body)) return undefined;
          const consistent = consistentFunctionFields();
          return { kind: "binding-rows", draft: { params: consistent, body: bodyDraft() ?? emptyExpressionSlot(),
            returns: current.body.$arrow.returns }, next: rows, scheme: withFunctionParams(current, consistent) };
        }, apply: applyReconciled });
      return false;
    }
    const result = reconcileAuthoringBindingRows({ params: scheme.body.$arrow.params,
      body: bodyDraft() ?? emptyExpressionSlot(), returns: scheme.body.$arrow.returns }, [...next],
    functionAuthoringSession()?.evaluateContext);
    if (!result.ok) { setSaveError(result.diagnostics[0]?.message ?? "Resolve the parameter's uses before changing it."); return false; }
    const reconciled = reconcileAuthoringSchemeBody({ scheme, context: functionAuthoringSession()?.evaluateContext,
      nextBody: { $arrow: { ...scheme.body.$arrow,
      params: [...result.value.params], returns: result.value.returns } } });
    if (!reconciled.ok) { setSaveError(reconciled.message); return false; }
    approvedFunctionFields = [...result.value.params];
    if (bodyDraft() !== null) setBodyDraft(result.value.body);
    installFunctionScheme(reconciled.scheme);
    setSaveError(null); return true;
  }
  let approvedFunctionResult: TypeScheme | undefined;
  function guardFunctionResult(next: FenelType) {
    approvedFunctionResult = undefined;
    const scheme = functionOwnedScheme();
    if (!scheme || !("$arrow" in scheme.body) || functionSignatureShapeIssue()) return false;
    if (localFunctionSignature) {
      localFunctionSignature.hold({ base: () => [functionBodyReturnType(), functionSchemeMetadata()], state: () => [arrowDraft()],
        edit: () => {
          const current = functionOwnedScheme();
          if (!current || !("$arrow" in current.body)) return undefined;
          const consistent = consistentFunctionFields();
          return { kind: "scheme", scheme: withFunctionParams(current, consistent), nextBody: withFunctionParams(current, consistent, next).body };
        },
        apply: reconciled => {
          const shown = functionParameterFields(), following = reconciledFunctionFields;
          approvedFunctionResult = reconciled.scheme;
          changeFunctionResult(next); setFunctionResultMode("explicit"); setFunctionSignatureDirty(true);
          // A name edit still following stays shown.
          if (following) { setArrowDraft(withFunctionParams(functionOwnedScheme()!, shown).body); reconciledFunctionFields = following; }
        } });
      return false;
    }
    const result = reconcileAuthoringSchemeBody({ scheme, context: functionAuthoringSession()?.evaluateContext,
      nextBody: { $arrow: { ...scheme.body.$arrow, returns: next } } });
    if (!result.ok) { setSaveError(result.message); return false; }
    approvedFunctionResult = result.scheme; setSaveError(null); return true;
  }
  function changeFunctionResult(_next: FenelType) {
    const approved = approvedFunctionResult; approvedFunctionResult = undefined;
    if (approved) installFunctionScheme(approved);
  }

  // Recursive references must see the edited signature in this reader's source.
  // Module-owned functions retain their registry source frame.
  const functionAuthoringSession = createMemo(() => {
    const fn = functionBaseline()?.fn ?? functionPin()?.fn;
    if (!fn) return undefined;
    const arrow = arrowDraft();
    const draft = !functionSignatureShapeIssue() && arrow && typeof arrow === "object" && "$arrow" in arrow
      ? {
          ...fn,
          params: [...arrow.$arrow.params],
          returns: arrow.$arrow.returns,
          signatureDeclaration: functionDeclaration(),
          requires: functionRequirements(),
        } satisfies FenelFunction
      : fn;
    if (reader?.kind === "local") return reader.draftSession(draft);
    if (reader) return reader.prepareFunction(fn.id, draft);
    const current = subject();
    const accountId = current?.$tag === "User" || current?.$tag === "Bot" ? current.accountId : undefined;
    if (!accountId) return functionSourceAuthoringSession();
    return prepareAuthoringSessionForFunction(fn.id, {
      accountId,
      functions: userFunctions(),
      draft,
    });
  });

  const captureFunctionRequirementsTarget: CaptureTypePickerTarget = () => latest(() => {
    const available = () => !dismissed && !saveInFlight && !saving() && !functionDefinitionChanged();
    if (!available()) return undefined;
    try { assertSourceTicket(sourceTicket); } catch { return undefined; }
    const item = props.item, baseline = functionBaseline(), body = bodyDraft(), arrow = arrowDraft(), requirements = functionRequirements();
    const currentSession = () => concreteAuthoringSession(functionAuthoringSession() ?? homeAuthoringSession());
    const concrete = currentSession(), epoch = sessionEpoch();
    const fingerprint = () => draftValueFingerprint({ item: props.item, baseline: functionBaseline(), body: bodyDraft(),
      arrow: arrowDraft(), metadata: functionSchemeMetadata(), requires: functionRequirements(), mode: functionResultMode() });
    const revision = fingerprint();
    return () => latest(() => {
      try { assertSourceTicket(sourceTicket); } catch { return false; }
      return available() && item === props.item && baseline === functionBaseline() && body === bodyDraft()
        && arrow === arrowDraft() && requirements === functionRequirements() && concrete === currentSession()
        && epoch === sessionEpoch() && revision === fingerprint();
    });
  });

  /** Lambda params surfaced inside the function body editor — the
   *  function's own declared params (botToken, entries, …) so `{var:
   *  "botToken"}` renders as a recognised param ref instead of a
   *  free variable. Sourced from `arrowDraft` (not the static
   *  `fp.fn.params`) so the body editor sees rename / type edits live
   *  as the user makes them. */
  const functionParameterFields = createMemo<FieldDef[]>(() => {
    const a = arrowDraft();
    if (!a || typeof a !== "object" || !("$arrow" in a)) return [];
    return a.$arrow.params;
  });
  const functionBodyParams = createMemo<LambdaParam[]>(() => functionParameterFields().map((p, index) => ({ ...p,
    scheme: functionOwnedScheme() ? projectAuthoringScheme(functionOwnedScheme()!, ["$arrow", "params", String(index), "type"]) : undefined })));
  const functionBodyReturnType = createMemo<FenelType | undefined>(() => {
    const arrow = arrowDraft();
    return arrow && typeof arrow === "object" && "$arrow" in arrow ? arrow.$arrow.returns : undefined;
  });
  type LocalSavedFunctionPreviewRequest = {
    session: AuthoringSession; base: AuthoringSession; handle: PreparedReaderWorker; worker: object;
    epoch: number; revision: number; controller: AbortController;
    sourceMetadata: ReturnType<typeof captureReaderSourceMetadata>;
  };
  type LocalSavedFunctionPreviewJob = { request: LocalSavedFunctionPreviewRequest; promise: Promise<AuthoringFunctionDraftInference>;
    /** B4 unit D item 2: the body the worker lowered and checked for this request. */
    body: Promise<unknown> } | { error: string };
  const localSavedFunctionPreviewWorker = createMemo(() => reader?.kind === "local" && functionHasBody()
    ? authoringWorkerSnapshot(functionAuthoringSession() ?? homeAuthoringSession()) : undefined);
  const localSavedFunctionPreviewBaseHandle = createMemo(() => {
    if (reader?.kind !== "local" || !functionHasBody()) return undefined;
    try { return preparedReaderWorkerForSession(concreteAuthoringSession(reader.session())); }
    catch { return undefined; }
  });
  const localSavedFunctionPreviewContext = createMemo<Pick<LocalSavedFunctionPreviewRequest, "session" | "base" | "handle" | "worker"> | { error: string } | undefined>(() => {
    if (reader?.kind !== "local" || !functionHasBody()) return undefined;
    try {
      const facade = functionAuthoringSession();
      if (!facade) return undefined;
      const session = concreteAuthoringSession(facade);
      const base = concreteAuthoringSession(reader.session());
      const worker = localSavedFunctionPreviewWorker();
      const baseHandle = localSavedFunctionPreviewBaseHandle();
      const scope = localAuthoringScopeForSession(session);
      const handle = baseHandle && scope ? scopePreparedReaderWorker(baseHandle, scope) : undefined;
      if (!handle || !worker) throw new Error("This reader's editing tools are not ready. Try again after preparation.");
      return { session, base, handle, worker };
    } catch (error) { return { error: error instanceof Error ? error.message : String(error) }; }
  });
  const localSavedFunctionPreviewJob = createMemo<LocalSavedFunctionPreviewJob | undefined>(() => {
    savedPreviewController?.abort();
    savedPreviewController = undefined;
    const context = localSavedFunctionPreviewContext();
    if (!context || "error" in context) return context;
    const baseline = functionBaseline(); const node = bodyDraft();
    const declaration = functionDeclaration(); const arrow = arrowDraft();
    if (!baseline || !node || !declaration || !arrow || !("$arrow" in arrow) || functionSignatureShapeIssue()) return undefined;
    try {
      if (reader?.kind !== "local") throw new Error("This reader's editing tools are not ready. Try again after preparation.");
      const { session, base, handle, worker } = context;
      const controller = new AbortController();
      savedPreviewController = controller;
      const request: LocalSavedFunctionPreviewRequest = { session, base, handle, worker, controller,
        epoch: sessionEpoch(), revision: reader.revision(), sourceMetadata: captureReaderSourceMetadata(homeAuthoringSession()) };
      // B4 unit D item 2: the worker lowers the draft body in this function's
      // frame (the page's codec adapter and refusal) and checks it in the
      // same request; its reply carries the lowered body Save persists.
      const fn: FenelFunction = { ...baseline.fn, params: arrow.$arrow.params, returns: arrow.$arrow.returns,
        requires: functionRequirements(), signatureDeclaration: declaration };
      const reply = (runPreparedReaderWorker(handle, { method: "infer-function-draft", fn, declaration,
        lowerBody: { node, refusal: "Use a parameter for saved data in a function body." } },
        controller.signal) as Promise<AuthoringFunctionDraftInference>).then(result => {
        assertLocalSavedFunctionPreview(request);
        return result;
      });
      const { promise, body } = splitLoweredFunctionDraft(reply);
      return { request, promise, body };
    } catch (error) { return { error: error instanceof Error ? error.message : String(error) }; }
  });
  function assertLocalSavedFunctionPreview(request: LocalSavedFunctionPreviewRequest) {
    return latest(() => {
      assertCurrentSession(request.epoch);
      request.controller.signal.throwIfAborted();
      assertSourceTicket(sourceTicket);
      const conflict = sourceConflict();
      if (conflict) throw new Error(conflict);
      const current = localSavedFunctionPreviewJob();
      if (dismissed || !current || !("request" in current) || current.request !== request
        || reader?.revision() !== request.revision || concreteAuthoringSession(reader.session()) !== request.base
        || concreteAuthoringSession(functionAuthoringSession() ?? homeAuthoringSession()) !== request.session
        || authoringWorkerSnapshot(request.session) !== request.worker) {
        throw new Error("This function or its reader changed while checking. Your draft is kept here; try again.");
      }
      if (request.sourceMetadata) assertReaderSourceMetadata(request.sourceMetadata, homeAuthoringSession());
    });
  }
  const localSavedFunctionPreview = createAsyncValue(() => {
    const job = localSavedFunctionPreviewJob();
    return job && "request" in job ? job : undefined;
  }, job => job.promise);
  const localSavedFunctionPreviewState = createMemo(() => latest(() => {
    const loading = localSavedFunctionPreview.loading;
    return { loading, result: loading ? undefined : localSavedFunctionPreview(), error: loading ? undefined : localSavedFunctionPreview.error };
  }));
  const nonLocalFunctionPreview = createMemo(() => {
    if (reader?.kind === "local") return undefined;
    const baseline = functionBaseline(); const node = bodyDraft();
    const declaration = functionDeclaration(); const arrow = arrowDraft();
    if (!baseline || !node || !declaration || !arrow || !("$arrow" in arrow) || functionSignatureShapeIssue()) return undefined;
    const session = functionAuthoringSession();
    if (!session) return undefined;
    try {
      const fn: FenelFunction = { ...baseline.fn, params: arrow.$arrow.params, returns: arrow.$arrow.returns,
        requires: functionRequirements(), signatureDeclaration: declaration,
        body: toLogic(node, () => { throw new Error("Use a parameter for saved data in a function body."); }, session) as FenelFunction["body"] };
      return { result: inferAuthoringFunctionDraft(fn, declaration, session.environment, { registry: session.registry }) };
    } catch (error) { return { error: error instanceof Error ? error.message : String(error) }; }
  });
  const functionPreview = (): { pending?: boolean; result?: AuthoringFunctionDraftInference; error?: string } | undefined => {
    if (reader?.kind === "local") return latest(() => {
      const job = localSavedFunctionPreviewJob();
      if (!job) return undefined;
      if ("error" in job) return { error: job.error };
      const state = localSavedFunctionPreviewState();
      return { pending: state.loading, result: state.result, error: state.error === undefined ? undefined
        : state.error instanceof Error ? state.error.message : String(state.error) };
    });
    return nonLocalFunctionPreview();
  };
  const functionResultType = () => functionResultMode() === "infer" && bodyDraft() !== null
    ? functionPreview()?.result?.fn?.returns : functionBodyReturnType();

  // Type-reference detection — mirrors `functionPin`. When the literal is a
  // reference to a type (`{$ref}`, or a legacy `{$pin: "entity"|"type"}`),
  // surface its FenelType through TypeBuilder so the user can browse the
  // schema right in the modal — same UX as a function body, just for the
  // structural side of "types = UI = app". Resolution goes through the
  // account's catalog, so it works for both system and module entities.
  let knownEntityReference: { id: string; name: string } | undefined;
  const entityPin = createMemo<{
    id: string;
    name: string;
    type: FenelType | null;
  } | null>(() => {
    const d = draft();
    if (d.kind !== "literal") return null;
    const reference = readLocusCatalogReference(d.value);
    if (!reference) return null;
    const target = resolveCatalogReference(reference);
    const kind = target?.kind ?? reference.kind;
    if (kind !== "entity" && kind !== "type") {
      return reference.id === knownEntityReference?.id ? { ...knownEntityReference, type: null } : null;
    }
    return { id: reference.id, name: reference.name ?? reference.id, type: target ? target.value as FenelType : null };
  });

  // Resolve the pin against the persisted type surface. Only a real account
  // row may enter bundle authoring; synthesized repository/module types are
  // explicitly fenced as read-only instead of presenting a save-shaped UI.
  const entityDefinition = createMemo(async () => {
    const ep = entityPin();
    if (!ep) return null;
    try {
      const response = await getTypeByName(ep.name);
      const row = (response as { definition?: Record<string, unknown> })?.definition;
      if (!row || row.isSystem === true) {
        return { kind: "read-only" as const, reason: "Repository and module types are authored in their source module." };
      }
      return {
        kind: "persisted" as const,
        row: row as {
          id?: string;
          name: string;
          type: FenelType;
          params?: (string | TypeConstructorParam)[];
          typeScheme?: TypeScheme;
          module?: string;
          codeName?: string;
        },
      };
    } catch {
      return { kind: "read-only" as const, reason: "This type has no writable account definition." };
    }
  });
  const persistedEntityRow = createMemo(() => {
    const state = entityDefinition();
    return state?.kind === "persisted" ? state.row : null;
  });
  const entityReadOnlyReason = () => {
    const state = entityDefinition();
    return state?.kind === "read-only"
      ? state.reason
      : "Checking whether this type has a writable account definition…";
  };
  const authoringOwnerKey = createMemo(() => {
    const fp = functionPin();
    if (fp) return `function:${fp.name}`;
    const row = persistedEntityRow();
    return row ? `type:${row.name}` : null;
  });
  let priorAuthoringOwnerKey: string | null | undefined;
  createEffect(
    () => authoringOwnerKey(),
    (key) => {
      if (key === priorAuthoringOwnerKey) return;
      priorAuthoringOwnerKey = key;
      setFieldFacets({});
      setFieldFacetsDirty(false);
      fieldResurrections.clear();
    },
  );

  const [typeDraft, setTypeDraft] = createSignal<FenelType | null>(null);
  const [typeDraftDirty, setTypeDraftDirty] = createSignal(false);
  const [typeParamsDraft, setTypeParamsDraft] = createSignal<readonly (string | TypeConstructorParam)[]>([]);
  const [typeSchemeMetadata, setTypeSchemeMetadata] = createSignal<Omit<TypeScheme, "body">>({ quantified: [] });
  const [typeGenericIssue, setTypeGenericIssue] = createSignal<string>();
  const [typeBaseline, setTypeBaseline] = createSignal<{ key: string; fingerprint: string; ingressFingerprint?: string;
    row?: NonNullable<ReturnType<typeof persistedEntityRow>> } | null>(null);
  let priorEntityDraftKey: string | null = null;
  createEffect(
    () => ({ pin: entityPin(), row: persistedEntityRow() }),
    ({ pin: ep, row }) => {
      const key = ep ? `${ep.id}\u0000${ep.name}` : null;
      if (key !== null && key === priorEntityDraftKey) return;
      if (!ep?.type || !key) {
        priorEntityDraftKey = null; knownEntityReference = undefined;
        setTypeBaseline(null); setTypeDraft(null); setTypeDraftDirty(false);
        return;
      }
      priorEntityDraftKey = key;
      knownEntityReference = { id: ep.id, name: ep.name };
      setTypeBaseline({ key, fingerprint: draftValueFingerprint(ep.type),
        ingressFingerprint: row ? draftValueFingerprint(row) : undefined, row: row ? cloneDraftValue(row) : undefined });
      setTypeDraft(cloneDraftValue(row?.type ?? ep.type));
      setTypeParamsDraft(cloneDraftValue(row?.params ?? []));
      const { body: _typeBody, ...metadata } = row?.typeScheme ?? { quantified: [], body: row?.type ?? ep.type };
      setTypeSchemeMetadata(cloneDraftValue(metadata)); setTypeGenericIssue(undefined);
      setTypeDraftDirty(false);
    },
  );
  const typeDefinitionChanged = createMemo(() => {
    const baseline = typeBaseline();
    const current = entityPin();
    return !!baseline && (!current?.type || `${current.id}\u0000${current.name}` !== baseline.key
      || draftValueFingerprint(current.type) !== baseline.fingerprint
      || baseline.ingressFingerprint !== undefined && draftValueFingerprint(persistedEntityRow()) !== baseline.ingressFingerprint);
  });
  const typeOwnedScheme = createMemo<TypeScheme | undefined>(() => {
    const type = typeDraft();
    return type ? { ...typeSchemeMetadata(), body: type } : undefined;
  });
  const typeGenericEditable = () => !!typeBaseline()?.row?.typeScheme || !typeBaseline()?.row?.params?.length;
  function installSavedTypeScheme(next: TypeScheme) {
    if (!typeGenericEditable()) { setSaveError("Edit this type's source signature to retain its existing type-parameter identities."); return; }
    const { body, ...metadata } = next;
    setTypeDraft(body); setTypeSchemeMetadata(metadata); setTypeDraftDirty(true);
  }
  let approvedTypeShape: { body: FenelType; scheme?: TypeScheme } | undefined;
  /** The scheme a Local type shape edit is reconciled from while it follows. */
  let reconciledTypeScheme: TypeScheme | undefined;
  function guardSavedTypeShape(next: FenelType) {
    approvedTypeShape = undefined;
    const scheme = typeOwnedScheme();
    const ownsScheme = !!typeBaseline()?.row?.typeScheme || typeParamsDraft().length > 0 && typeGenericEditable();
    if (scheme && ownsScheme && localTypeSignature) {
      // Shown at once; the scheme's reconciliation follows (Save waits for it).
      reconciledTypeScheme ??= scheme;
      approvedTypeShape = { body: next };
      localTypeSignature.follow({ base: () => [], state: () => [typeDraft(), typeSchemeMetadata()],
        edit: () => {
          const from = reconciledTypeScheme, shape = typeDraft();
          return from && shape ? { kind: "scheme", scheme: from, nextBody: shape } : undefined;
        },
        apply: reconciled => { reconciledTypeScheme = undefined; installSavedTypeScheme(reconciled.scheme); } });
      setSaveError(null); return true;
    }
    if (scheme && ownsScheme) {
      const result = reconcileAuthoringSchemeBody({ scheme, nextBody: next, context: homeAuthoringSession().evaluateContext });
      if (!result.ok) { setSaveError(result.message); return false; }
      approvedTypeShape = { body: result.scheme.body, scheme: result.scheme };
    } else approvedTypeShape = { body: next };
    setSaveError(null); return true;
  }
  function changeSavedTypeShape(_next: FenelType) {
    const approved = approvedTypeShape; approvedTypeShape = undefined;
    if (!approved) return;
    if (approved.scheme) installSavedTypeScheme(approved.scheme);
    else { setTypeDraft(approved.body); setTypeDraftDirty(true); }
  }

  // Recent instances for this function — used by the instance picker in the
  // modal header. Only fetched once the registry-id → UUID resolve succeeds.
  const instancesList = createMemo(async () => {
    const fnUuid = functionRowId();
    if (!fnUuid) return [] as Array<Record<string, unknown>>;
    try {
      const data = await getFunctionInstancesById(fnUuid);
      return data.instances ?? [];
    } catch {
      return [];
    }
  });

  // Full timeline for the currently-selected instance — traces + events +
  // the instance row. When this fires the editor below switches into
  // "overlay mode": every let-binding and call site renders a value chip.
  const instanceTimeline = createMemo(async () => {
    const fnUuid = functionRowId();
    const instId = selectedInstanceId();
    if (!fnUuid || !instId) return null;
    try {
      return await getInstanceTimeline(fnUuid, instId);
    } catch {
      return null;
    }
  });

  // Build the InstanceTraceProvider that descendants of
  // InstanceTraceContext.Provider see. Name-based lookup today (simple
  // and unambiguous for the bodies we have); refines to step_path matching
  // once the editor↔runtime path bridge lands.
  const traceProvider = createMemo<InstanceTraceProvider | undefined>(() => {
    const tl = instanceTimeline();
    if (!tl) return undefined;
    const traces: InstanceTrace[] = (tl.traces ?? []) as InstanceTrace[];
    const byLetMap = new Map<string, InstanceTrace[]>();
    const byCallMap = new Map<string, InstanceTrace[]>();
    for (const t of traces) {
      if (t.kind === "let") {
        const arr = byLetMap.get(t.name) ?? [];
        arr.push(t);
        byLetMap.set(t.name, arr);
        continue;
      }
      // IO traces whose `meta` is `Just({$tag: "LetBinding", letName})`
      // ALSO surface under the let-lookup — handles the IO-let-binding case
      // where we don't emit a separate `let` trace (the IO trace IS the
      // binding's value). Pre-Phase-12-canonical-maybe, meta was
      // `{ letName?: string }` and we dispatched on key presence.
      const tm = peelMaybeValue(t.meta);
      const letName = tm && tm.$tag === "LetBinding" ? tm.letName : undefined;
      if (typeof letName === "string") {
        const arr = byLetMap.get(letName) ?? [];
        arr.push(t);
        byLetMap.set(letName, arr);
      }
      // Index call-site traces by both full id and bare codeName so the
      // editor finds matches whether it has `state:insertConversation` or
      // `insertConversation` in hand.
      const arr = byCallMap.get(t.name) ?? [];
      arr.push(t);
      byCallMap.set(t.name, arr);
      if (t.name.includes(":")) {
        const codeName = t.name.split(":").pop()!;
        const arrC = byCallMap.get(codeName) ?? [];
        arrC.push(t);
        byCallMap.set(codeName, arrC);
      }
      // Capability calls (e.g. `state.insert_conversation`) get a third
      // lookup key — the snake_case action name — since runtime traces
      // use the action name, while the editor renders the codeName.
      if (t.name.includes(".")) {
        const tail = t.name.split(".").pop()!;
        // snake_case → camelCase
        const camel = tail.replace(/_([a-z])/g, (_, c) => c.toUpperCase());
        const arrC = byCallMap.get(camel) ?? [];
        arrC.push(t);
        byCallMap.set(camel, arrC);
      }
    }
    return {
      byLet: (name) => byLetMap.get(name) ?? [],
      byCall: (fnNameOrId) => byCallMap.get(fnNameOrId) ?? [],
    };
  });
  // Read async definition/session/trace prerequisites in a tracked branch
  // before mounting providers whose setup consumes their current props.
  const functionEditorReady = createMemo(() => {
    if (!functionPin()?.fn) return false;
    const sourceSession = functionSourceAuthoringSession();
    const draftSession = functionAuthoringSession();
    persistedFunctionRow();
    instancesList();
    traceProvider();
    return sourceSession !== undefined && draftSession !== undefined;
  });
  // Per-card representation overrides (LayoutItem.representations) —
  // shape is Record<typeName, methods>; RepresentationsPanel adapts that
  // compatibility shape to the general InstanceEditor draft model.
  const [cardReps, setCardReps] = createSignal<Record<string, Record<string, unknown>>>(
    props.item.representations ?? {},
  );

  const isRef = () => props.item.source?.kind === "ref";
  const sourceConflict = createMemo(() => savedExpressionChanged()
    ? "This saved expression changed while you were editing it. Your draft is kept here. Copy it before reopening the current data."
    : typeDefinitionChanged()
      ? "This type changed while you were editing it. Your draft is kept here. Copy it before reopening the current definition."
      : functionDefinitionChanged()
        ? "This function changed while you were editing it. Your draft is kept here. Copy it before reopening the current definition."
        : undefined);

  async function save() {
    if (dismissed || saveInFlight) return;
    saveInFlight = true;
    setSaving(true);
    setSaveError(null);
    const saveSignal = (saveController = new AbortController()).signal;
    let functionSubmissionCurrent = () => true;
    try {
      // B4 fix round 2: a nested value of this editor still being checked has
      // cleared its slot; no Local Save path may persist it meanwhile.
      if (reader?.kind === "local" && localDraftChecksPending(draftScope, reader)) throw new Error(LOCAL_SAVE_DRAFT_CHANGED);
      // B4 wave 4 lane H: a signature edit still being reconciled is not this draft.
      if (localFunctionSignature?.retry() || localTypeSignature?.retry()
        || localFunctionSignature?.pending() || localTypeSignature?.pending()) throw new Error(LOCAL_SAVE_DRAFT_CHANGED);
      const signatureIssue = localFunctionSignature?.issue() ?? localTypeSignature?.issue();
      if (signatureIssue) throw new Error(signatureIssue);
      const functionFingerprint = (signature: boolean) => draftValueFingerprint({ body: bodyDraft(), arrow: arrowDraft(),
        requires: functionRequirements(), resultMode: functionResultMode(), signatureDirty: functionSignatureDirty(),
        genericIssue: functionGenericIssue(), ...(signature ? { declaration: functionDeclaration() } : {}), expression: draft(),
        representations: cardReps(), fieldFacets: fieldFacets(), resurrectFieldIds: fieldResurrections.fieldIds() });
      const intent = latest(() => {
        const conflict = sourceConflict();
        if (conflict) throw new Error(conflict);
        assertSourceTicket(sourceTicket);
        const item = props.item;
        const expression = draft();
        const original = initial();
        const representations = cardReps();
        const facets = fieldFacets();
        const resurrectFieldIds = fieldResurrections.fieldIds();
        const fieldAuthoringChanged = fieldFacetsDirty() || resurrectFieldIds.length > 0;
        const pin = functionPin();
        const baseline = functionBaseline();
        const body = bodyDraft();
        const arrow = arrowDraft();
        const bodyChanged = !!(baseline && body && draftValueFingerprint(body) !== draftValueFingerprint(baseline.body));
        const sigChanged = !!(baseline && arrow && (functionSignatureDirty()
          || draftValueFingerprint(arrow) !== draftValueFingerprint(baseline.arrow)));
        const functionEdited = !!(pin && baseline && (bodyChanged || sigChanged || fieldAuthoringChanged));
        const signatureChanged = bodyChanged || sigChanged;
        const genericIssue = pin ? functionGenericIssue() : undefined;
        if (genericIssue) throw new Error(genericIssue);
        if (functionEdited && functionDefinitionChanged()) {
          throw new Error("This function changed while you were editing it. Your draft is kept here. Copy it before reopening the current definition.");
        }
        const row = functionEdited ? persistedFunctionRow() : undefined;
        if (functionEdited && !row) throw new Error("This function is authored in its source module.");
        const signatureIssue = functionEdited && signatureChanged ? functionSignatureShapeIssue() : undefined;
        if (signatureIssue) throw new Error(signatureIssue);
        const needsBodyCheck = functionEdited && signatureChanged && !!(body || baseline?.fn.body !== undefined);
        const facade = needsBodyCheck ? functionAuthoringSession() : undefined;
        const local = reader?.kind === "local" && functionEdited && signatureChanged && body
          ? localSavedFunctionPreviewJob() : undefined;
        const needsSavedValueCheck = item.source?.kind === "ref" && item.valueType && props.standalone !== "definition"
          && draftValueFingerprint(expression) !== draftValueFingerprint(original);
        const reference = needsSavedValueCheck && original.kind === "literal" ? readLocusCatalogReference(original.value) : undefined;
        const definitionKind = reference ? resolveCatalogReference(reference)?.kind ?? reference.kind : undefined;
        const homeSession = needsSavedValueCheck && definitionKind !== "entity" && definitionKind !== "function"
          ? concreteAuthoringSession(homeAuthoringSession()) : undefined;
        const ep = entityPin();
        const typeIssue = ep ? typeGenericIssue() : undefined;
        if (typeIssue) throw new Error(typeIssue);
        const nextType = ep ? typeDraft() : null;
        const entityState = ep && nextType ? entityDefinition() : undefined;
        const typeDirty = !!(ep && nextType && entityState?.kind === "persisted" && typeDraftDirty());
        const typeEdited = !!(ep && nextType && entityState?.kind === "persisted" && (typeDirty || fieldAuthoringChanged));
        const typeBase = typeEdited ? typeBaseline() : undefined;
        const typeParams = typeEdited ? typeParamsDraft() : [];
        const ownsTypeScheme = typeEdited && (typeBase?.row?.typeScheme || typeParams.length > 0 && typeGenericEditable());
        return { item, homeId: props.homeId, saveItem: props.onSaveItem, standalone: props.standalone,
          expectedSavedQuery: props.expectedSavedQuery, savedExprById: props.savedExprById,
          expression, original, definitionKind, representations, fieldFacets: facets, resurrectFieldIds, fieldAuthoringChanged,
          pin, baseline, row, body, arrow, bodyChanged, sigChanged, functionEdited, signatureChanged,
          declaration: functionEdited && signatureChanged ? functionDeclaration() : undefined,
          requires: functionEdited && signatureChanged ? functionRequirements() : undefined,
          resultMode: functionEdited && signatureChanged && body ? functionResultMode() : undefined,
          local, session: facade ? concreteAuthoringSession(facade) : undefined, homeSession,
          functionFingerprint: reader?.kind === "local" && functionEdited ? functionFingerprint(signatureChanged) : undefined,
          rootDeclaration: local && body ? savedExpressionDeclaration(body) : undefined,
          sourceMetadata: local && "request" in local ? local.request.sourceMetadata : undefined,
          entityPin: ep, entityState, nextType, typeDirty, typeBaseline: typeBase, typeParams,
          ownsTypeScheme, typeScheme: ownsTypeScheme ? typeOwnedScheme() : undefined };
      });
      const item = cloneDraftValue(intent.item);
      const homeId = intent.homeId;
      const saveItem = intent.saveItem;
      const submittedDraft = cloneDraftValue(intent.expression);
      const reps = cloneDraftValue(intent.representations);
      const expressionChanged = draftValueFingerprint(submittedDraft) !== draftValueFingerprint(intent.original);
      const occurrenceChanged = expressionChanged
        || draftValueFingerprint(reps) !== draftValueFingerprint(item.representations ?? {});
      const itemIsRef = item.source?.kind === "ref";
      const referenceId = item.source?.kind === "ref" ? item.source.ref.id : undefined;
      if (itemIsRef && expressionChanged && item.valueType && intent.standalone !== "definition") {
        const definitionKind = intent.definitionKind;
        if (definitionKind !== "entity" && definitionKind !== "function") {
          let issue: string | undefined;
          if (reader?.kind === "local") {
            // B4 slice 1: the reader's worker decides in its own frame.
            const submitted = draftValueFingerprint(submittedDraft);
            issue = await localExpressionSaveIssue(submittedDraft, { reader, session: () => concreteAuthoringSession(homeAuthoringSession()), draftScope,
              saved: intent.savedExprById, expectedType: item.valueType, signal: saveSignal, current: () => {
                if (dismissed) throw new Error("This editor was closed before the data was saved.");
                assertSourceTicket(sourceTicket);
                if (draftValueFingerprint(draft()) !== submitted) throw new Error(LOCAL_SAVE_DRAFT_CHANGED);
              } });
            if (dismissed) return;
          } else {
            const session = intent.homeSession!;
            issue = draftSaveIssue(submittedDraft, session.environment, {
              expectedType: item.valueType, registry: session.registry,
              resolveSavedExpr: id => intent.savedExprById.get(id), evaluateContext: session.evaluateContext,
            });
          }
          if (issue) throw new Error(issue);
        }
      }
      const fieldMutation = cloneDraftValue({
        desiredFacets: desiredFieldFacetValues(intent.fieldFacets),
        replaceFacetFieldIds: fieldFacetReplacementIds(intent.fieldFacets),
        resurrectFieldIds: intent.resurrectFieldIds.length > 0
          ? [...intent.resurrectFieldIds]
          : undefined,
      });
      // Function-pin items: when the user edited the function body
      // inline via the ExpressionEditor surfaced under the pin, project
      // the draft back to JSON-Logic and upsert the function row. Skip
      // when the body wasn't loaded (no fn record in the catalog) or
      // is unchanged from the loaded version.
      const fp = intent.pin;
      const baseline = intent.baseline;
      const bodyExpr = intent.body;
      const arrowExpr = intent.arrow;
      const bodyChanged = intent.bodyChanged;
      const sigChanged = intent.sigChanged;
      const fieldAuthoringChanged = intent.fieldAuthoringChanged;
      let functionBundle: Parameters<typeof api.definitionBundleSave>[0] | undefined;
      let functionQueryKey = "";
      let submittedLocalRequest: LocalSavedFunctionPreviewRequest | undefined;
      if (intent.functionFingerprint !== undefined) {
        functionSubmissionCurrent = () => latest(() => functionFingerprint(intent.signatureChanged) === intent.functionFingerprint);
      }
      const assertSubmittedFunction = () => latest(() => {
        if (dismissed) throw new Error("This editor was closed before the function was saved.");
        if (submittedLocalRequest) assertLocalSavedFunctionPreview(submittedLocalRequest);
        if (!functionSubmissionCurrent()) {
          throw new Error("This function changed while checking. Your draft is kept here; try again.");
        }
      });
      if (fp && baseline && (bodyChanged || sigChanged || fieldAuthoringChanged)) {
        const row = intent.row;
        if (!row) throw new Error("This function is authored in its source module.");
        const storageName = row.name ?? fp.name;
        functionQueryKey = `function:${storageName}`;
        const updatedFn: FenelFunction = {
          ...baseline.fn,
          id: baseline.fn.id,
        };
        if (bodyChanged && bodyExpr) {
          if (reader?.kind === "local") {
            // B4 unit D item 2: the body lowered in the worker for exactly the
            // checked request (asserted below); never a page lowering.
            const local = intent.local;
            if (!local || !("request" in local)) {
              throw new Error(local && "error" in local ? local.error : "Wait for this function's authoring tools before saving.");
            }
            updatedFn.body = await local.body as FenelFunction["body"];
            if (dismissed) return;
          } else updatedFn.body = toLogic(
            bodyExpr,
            undefined,
            intent.session,
          ) as FenelFunction["body"];
        }
        // Pull params + returns out of the arrow draft. TypeBuilder
        // guarantees the shape stays `$arrow` because we lock the kind
        // picker, but be defensive — if anything else came through, skip
        // the signature update rather than silently rewriting it.
        if (sigChanged && arrowExpr && typeof arrowExpr === "object" && "$arrow" in arrowExpr) {
          const a = (arrowExpr as { $arrow: { params: FieldDef[]; returns: FenelType } }).$arrow;
          updatedFn.params = a.params;
          updatedFn.returns = a.returns;
        }
        if (bodyChanged || sigChanged) {
          updatedFn.signatureDeclaration = intent.declaration;
          updatedFn.requires = intent.requires;
          if (bodyExpr) {
            const local = intent.local;
            if (reader?.kind === "local" && (!local || !("request" in local))) {
              throw new Error(local && "error" in local ? local.error : "Wait for this function's authoring tools before saving.");
            }
            const preview = local && "request" in local ? { result: await local.promise, error: undefined } : latest(functionPreview);
            if (dismissed) return;
            if (local && "request" in local) { submittedLocalRequest = local.request; assertSubmittedFunction(); }
            if (preview?.error) throw new Error(preview.error);
            if (preview?.result?.outcome.$tag === "Invalid") throw new Error(preview.result.outcome.diagnostics[0]?.message ?? "Complete the function before saving.");
            if (intent.resultMode === "infer") {
              if (preview?.result?.outcome.$tag !== "Solved" || !preview.result.fn) {
                throw new Error("Choose a result type to finish this function; its result cannot be inferred yet.");
              }
              updatedFn.returns = preview.result.fn.returns;
            }
          }
        }
        if ((bodyChanged || sigChanged) && (bodyExpr || updatedFn.body !== undefined)) {
          const session = intent.session;
          if (!session) throw new Error("Wait for this function's authoring tools before saving.");
          let issue: string | undefined;
          if (reader?.kind === "local") {
            if (!submittedLocalRequest) throw new Error("Wait for this function's authoring tools before saving.");
            // B4 unit D item 2: an unedited body is raised in the worker.
            const node = bodyExpr ?? raisedNode(await runPreparedReaderWorker(submittedLocalRequest.handle, { method: "raise-reader-logic",
              logic: updatedFn.body, params: updatedFn.params.map(param => param.name) }, submittedLocalRequest.controller.signal));
            if (dismissed) return;
            assertSubmittedFunction();
            const rootDeclaration = intent.rootDeclaration;
            const checked = await runPreparedReaderWorker(submittedLocalRequest.handle, { method: "function-body-save-issue", node,
              definition: updatedFn, ...(rootDeclaration ? { rootDeclaration } : {}),
              ...(intent.sourceMetadata ? { sourceMetadata: intent.sourceMetadata.packet } : {}) },
            submittedLocalRequest.controller.signal) as AuthoringFunctionBodySaveIssue;
            if (dismissed) return;
            assertSubmittedFunction();
            issue = checked.issue;
          } else issue = functionBodySaveIssue(bodyExpr ?? logicToExprNode(updatedFn.body, updatedFn.params.map(param => param.name), session),
            updatedFn, session.environment, {
            registry: session.registry, evaluateContext: session.evaluateContext,
          });
          if (issue) throw new Error(issue);
        }
        functionBundle = cloneDraftValue({
          ownerMutations: [functionDefinitionOwner(updatedFn, row, storageName, reader)],
          ...fieldMutation,
        });
      }
      const ep = intent.entityPin;
      const entityState = intent.entityState;
      const nextType = intent.nextType;
      let typeBundle: Parameters<typeof api.definitionBundleSave>[0] | undefined;
      if (
        ep
        && nextType
        && entityState?.kind === "persisted"
        && (intent.typeDirty || fieldAuthoringChanged)
      ) {
        const storageName = entityState.row.name || ep.name;
        typeBundle = cloneDraftValue({
          ownerMutations: [{
            kind: "upsert",
            owner: {
              ownerKey: `type:${storageName}`,
              kind: "type",
              storageName,
              ...(reader?.kind !== "local" && entityState.row.id ? { storageId: entityState.row.id } : {}),
              definition: { id: storageName, type: nextType,
                ...(intent.typeBaseline?.row?.params !== undefined || intent.typeParams.length ? { params: [...intent.typeParams] } : {}),
                ...(intent.ownsTypeScheme ? { typeScheme: intent.typeScheme } : {}),
                ...(intent.typeBaseline?.row?.module === undefined ? {} : { module: intent.typeBaseline.row.module }),
                ...(intent.typeBaseline?.row?.codeName === undefined ? {} : { codeName: intent.typeBaseline.row.codeName }),
              },
            },
          }],
          ...fieldMutation,
        });
      }
      assertSubmittedFunction();
      if (itemIsRef && !saveItem && !(submittedLocalRequest && functionBundle)) {
        if (!referenceId) throw new Error("Missing ref id");
        await api.savedQueryUpdate(referenceId, { query: { kind: "expression", expr: submittedDraft }, expectedQuery: intent.expectedSavedQuery });
        if (dismissed) return;
        void revalidate("savedQueries");
      }
      const localDefinitionBundle = functionBundle ?? typeBundle;
      if ((reader?.kind === "local" || client.drafts) && client.editDefinitionAndData && localDefinitionBundle && saveItem) {
        await saveItem({ ...item, representations: Object.keys(reps).length ? reps : undefined }, submittedDraft,
          localDefinitionBundle, occurrenceChanged, assertSubmittedFunction, saveSignal);
        if (dismissed) return;
        void revalidate(["functions", "types", "definition", "savedQueries", "locusRoot"]);
        await reloadUserRegistries();
        if (!dismissed) { props.onApplied?.(); close(); }
        return;
      }
      if (functionBundle) {
        if (latest(functionDefinitionChanged)) throw new Error("This function changed while you were editing it. Your draft is kept here. Copy it before reopening the current definition.");
        let committed: unknown;
        if (submittedLocalRequest) {
          assertSubmittedFunction();
          if (!client.editDefinitionAndData) throw new Error("This data source cannot save this checked definition.");
          committed = await client.editDefinitionAndData(functionBundle, submittedLocalRequest.revision, {
            ...(itemIsRef && referenceId ? { savedValue: { id: referenceId, query: { ...intent.expectedSavedQuery, kind: "expression", expr: submittedDraft },
              expectedQuery: intent.expectedSavedQuery } } : {}),
          });
        } else committed = await api.definitionBundleSave(functionBundle);
        if (dismissed) return;
        void revalidate(["functions", functionQueryKey]);
        await reloadUserRegistries(committed);
        if (dismissed) return;
      }
      if (typeBundle) {
        if (latest(typeDefinitionChanged)) throw new Error("This type changed while you were editing it. Your draft is kept here. Copy it before reopening the current definition.");
        const committed = await api.definitionBundleSave(typeBundle);
        if (dismissed) return;
        void revalidate(["types", "definition"]);
        await reloadUserRegistries(committed);
        if (dismissed) return;
      }
      // A definition edit changes the referenced data, not its occurrence.
      // Replacing an unchanged pin would add a second transaction against the
      // revision from before the definition save and can only manufacture a
      // conflict. Actual occurrence edits still use the existing scoped writer.
      if ((functionBundle || typeBundle) && !occurrenceChanged) { props.onApplied?.(); close(); return; }
      // Per-card representation overrides + (for inline items) the
      // expression itself live in the locusView. Always update the
      // locusView item so representations get persisted regardless
      // of whether the source is a ref or inline.
      if (saveItem) {
        await saveItem({ ...item, representations: Object.keys(reps).length ? reps : undefined }, submittedDraft,
          undefined, undefined, undefined, saveSignal);
        if (dismissed) return;
        props.onApplied?.();
        close();
        return;
      }
      const data = await getLocusRoot();
      if (dismissed) return;
      latest(() => assertSourceTicket(sourceTicket));
      const home = data.root.id === homeId ? rootDataRow(data.root)
        : data.root.lists.find((row) => row.id === homeId);
      if (!home) throw new Error("No active home");
      const view = asView(home.view);
      const hasReps = Object.keys(reps).length > 0;
      const next: AnyView = updateItemInView(view, item.id, (it) => {
        const updated: LayoutItem = { ...it };
        if (!itemIsRef) {
          updated.source = { kind: "expr", expr: submittedDraft };
          updated.expr = undefined;
        }
        if (hasReps) {
          updated.representations = reps;
        } else {
          delete updated.representations;
        }
        return updated;
      });
      if (data.root.id === home.id) {
        const updatedItem = findLocusItem(next.items, item.id);
        if (!updatedItem) throw new Error("This data was removed while editing it.");
        await editLocusRoot(data.root.id, data.root.revision, { kind: "replace", itemId: updatedItem.id, item: updatedItem });
      } else await api.locusViewUpdate(home.id, { view: next as Record<string, unknown>, expectedRootRevision: data.root.revision });
      if (dismissed) return;
      void revalidate(["locusRoot", "locusViews", "activeLocusView"]);
      props.onApplied?.();
      close();
    } catch (e: any) {
      if (!dismissed && functionSubmissionCurrent()) setSaveError(e?.message ?? String(e));
    } finally {
      saveInFlight = false;
      if (!dismissed) setSaving(false);
    }
  }

  return (
    <ModalOverlay class="modal-overlay" onClick={(e) => { if (e.target === e.currentTarget) close(); }}>
      <div class="modal-box home-edit-modal">
        <div class="home-edit-modal__head">
          <h3 style="margin: 0; font-size: 0.95rem">
            {props.standalone === "definition" ? "Definition" : props.standalone === "saved" ? "Saved data" : "Edit"}{props.item.caption ? `: ${props.item.caption}` : ""}
            <Show when={!props.standalone && isRef()}>
              <span class="badge badge-blue" style="margin-left: 0.5rem; font-size: 0.65rem">linked</span>
            </Show>
            <Show when={!props.standalone && !isRef()}>
              <span class="badge badge-gray" style="margin-left: 0.5rem; font-size: 0.65rem">inline</span>
            </Show>
          </h3>
          <div style="display: flex; gap: 0.4rem; align-items: center">
            <button
              type="button"
              class="btn"
              onClick={() => setArmsStacked(!armsStacked())}
              style="padding: 0.2rem 0.55rem; font-size: 0.78rem"
              data-tooltip={armsStacked()
                ? "Lay match arms out side-by-side (pattern → body)"
                : "Stack match arms vertically (body under pattern) — better on narrow screens"}
            >
              {armsStacked() ? "⬌ side-by-side" : "⬍ stack arms"}
            </button>
            <button
              type="button"
              class="btn"
              onClick={() => setTraceOpen(!traceOpen())}
              style="padding: 0.2rem 0.55rem; font-size: 0.78rem"
              data-tooltip={traceOpen() ? "Hide the live-trace drawer" : "Show the live-trace drawer"}
            >
              {traceOpen() ? "Live trace ✕" : "Live trace ▸"}
            </button>
            {/* Instance picker — only meaningful when the modal is showing a
              *  function pin. Picking an instance switches the body editor
              *  into overlay mode: each let-binding and call site renders
              *  its real runtime value next to the name. "edit" returns
              *  to the plain definition view. */}
            <Show when={functionPin() && (instancesList() ?? []).length > 0}>
              <LocusSelect
                class="home-edit-modal__run-select"
                label="Past run"
                tooltip="Show the body decorated with a past run's traces — or 'edit' to hide the overlay"
                value={selectedInstanceId() ?? ""}
                options={[
                  { value: "", label: "edit (no instance)" },
                  ...instancesList()!.map((inst) => {
                    // `getFunctionInstances` (db/queries/function-tracking.ts)
                    // returns rows shaped `{instanceId, status, startedAt, …}`
                    // — the row id is the `instanceId` field, not `id`.
                    const o = inst as {
                      instanceId?: string;
                      id?: string;
                      status?: string;
                      startedAt?: string;
                    };
                    const id = o.instanceId ?? o.id ?? "";
                    const status = o.status ?? "";
                    const ts = o.startedAt ? new Date(o.startedAt).toLocaleString() : "";
                    return { value: id, label: `${status} · ${ts} · ${id ? id.slice(0, 8) : "?"}` };
                  }),
                ]}
                onChange={(v) => setSelectedInstanceId(v.length > 0 ? v : null)}
              />
            </Show>
            <button type="button" class="btn" onClick={close} style="padding: 0.2rem 0.55rem; font-size: 0.78rem">Close</button>
          </div>
        </div>
        <fieldset disabled={saving()} inert={saving()} style="border: 0; min-width: 0; display: contents;">
        <div

          class={["home-edit-modal__body", {
            "home-edit-modal__body--trace-open": traceOpen(),
            "home-edit-modal__body--arms-stacked": armsStacked(),
          }]}
        >
          <section class="home-edit-modal__editor">
            <Show when={props.standalone !== "definition"}>
            <h4 class="data-group-title" style="font-size: 0.85rem">Expression</h4>
            <ExpressionEditor expr={visualDraft()} onChange={setDraft} graphAuthoring draftCheckScope={draftScope}
              fieldDef={props.item.valueType ? { name: "value", type: props.item.valueType, label: Nothing, ui: Nothing, meta: {} } : undefined} />
            </Show>
            <Show when={props.standalone === "definition" && !functionPin() && !entityPin()}>
              <div class="data-error" role="alert">This definition is no longer available in this account.</div>
            </Show>
            {/* Function-pin inspector — render the body through the
                same ExpressionEditor used in NewValueModal's inline
                tab, wrapped in LambdaParamsContext so the function's
                declared params (botToken, entries, …) surface as
                recognised param refs inside the editor. Same UX as
                the lambda / function builder used everywhere else. */}
            {/* Type inspector. Account rows use the same atomic owner/facet
                bundle as the full type editor; repository/module types are
                visibly read-only. */}
            <Show when={entityPin() && typeDraft()}>
              <div style="margin-top: 1rem">
                <h4 class="data-group-title" style="font-size: 0.85rem; margin: 0 0 0.4rem">
                  Type schema
                </h4>
                <div class="mono text-muted" style="font-size: 0.72rem; margin-bottom: 0.4rem">
                  {entityPin()!.name}
                </div>
                <Show
                  when={persistedEntityRow()}
                  fallback={
                    <div>
                      <div class="text-muted" style="font-size: 0.75rem; margin-bottom: 0.5rem">
                        {entityReadOnlyReason()}
                      </div>
                      <FenelCodeEditor value={printFenel({ type_sig: { name: "value", type: typeDraft() } })} readonly minHeight="180px" />
                    </div>
                  }
                >
                  {(row) => (
                    <FieldAuthoringProvider
                      facetsByFieldId={fieldFacets()}
                      onFieldFacetsChange={changeFieldFacet}
                      onFieldFacetsHydrate={hydrateFieldFacet}
                      onFieldFacetsForget={forgetFieldFacet}
                      ownerKey={`type:${row().name}`}
                      owner={persistedRootFieldOwner("type", row().name)}
                      resurrectFieldIds={fieldResurrections.fieldIds()}
                      onFieldResurrectionChange={fieldResurrections.onChange}
                    >
                      <LocusSelect label="Editor lens" value={definitionLens()}
                        options={[{ value: "simple", label: "Simple" }, { value: "full", label: "Full controls" }]}
                        onChange={value => setDefinitionLens(value === "full" ? "full" : "simple")} />
                      <LambdaFormEditorSurface title={typeParamsDraft().length ? "Type generator" : "Type"}
                        parameterList={() => <Show when={typeGenericEditable()} fallback={
                          <p class="text-muted">Edit this type's source signature to retain its existing type-parameter identities.</p>
                        }><Show when={typeOwnedScheme()}>{scheme => <GenericParametersEditor scheme={scheme()}
                          presentation={definitionLens()} params={typeParamsDraft()} onParamsChange={params => { setTypeParamsDraft(params); setTypeDraftDirty(true); }}
                          onChange={installSavedTypeScheme} onIssueChange={setTypeGenericIssue} />}</Show></Show>}
                        result={definitionLens() === "full" || (typeOwnedScheme()?.quantified.length ?? 0) > 0
                          ? () => <TypeContract declared="Type" declaredReadonly="A type definition always produces a Type." />
                          : undefined}
                        body={() => <TypeBuilder presentation={definitionLens()} value={typeDraft()} genericScheme={typeOwnedScheme()}
                          beforeChange={guardSavedTypeShape} onChange={changeSavedTypeShape} />} />
                    </FieldAuthoringProvider>
                  )}
                </Show>

                {/* Instances — the data side. Recent rows of this Type
                  *  rendered as a compact list. Each row links to the
                  *  legacy `/app/types/:name/:id` detail page until in-
                  *  place instance inspection lands in the modal. */}
                <h4 class="data-group-title" style="font-size: 0.85rem; margin: 1rem 0 0.4rem">
                  Instances
                </h4>
                <Show when={reader?.kind === "local"} fallback={<EntityInstancesPanel
                  name={entityPin()!.name}
                  type={typeDraft()}
                />}>
                  <LocalTypeInstances typeName={entityPin()!.id.startsWith("entity:") ? entityPin()!.id.slice("entity:".length) : entityPin()!.id} />
                </Show>

                <Show when={!reader}><div style="margin-top: 0.6rem">
                  <a
                    href={`/app/types/${encodeURIComponent(entityPin()!.id)}`}
                    class="text-muted"
                    style="font-size: 0.7rem"
                  >
                    Open in full editor →
                  </a>
                </div></Show>
              </div>
            </Show>
            <Show when={localFunctionBody?.failure()}>{failure => <ValueFailure message={failure()} retry={() => localFunctionBody!.retry()} />}</Show>
            <Show when={functionPin() && arrowDraft() && functionEditorReady()}>
              <div style="margin-top: 1rem">
                <h4 class="data-group-title" style="font-size: 0.85rem; margin: 0 0 0.4rem">
                  Signature
                </h4>
                <div class="mono text-muted" style="font-size: 0.72rem; margin-bottom: 0.4rem">
                  {functionPin()!.name}
                </div>
                {/* Reuse the existing TypeBuilder for the function's
                  *  `(params) → returns` shape. `lockKind="arrow"` hides
                  *  the kind picker so the user can't accidentally
                  *  convert a function into a record, while ArrowBody
                  *  inside TypeBuilder gives the full params editor
                  *  (name + nested TypeBuilder per param + add/remove)
                  *  AND the returns editor. Same primitive everywhere a
                  *  signature is shaped, per CLAUDE.md "reuse over
                  *  reinvent". */}
                <Show when={persistedFunctionRow()} fallback={
                  <div>
                    <p class="text-muted">This function is authored in its source module.</p>
                    <FenelCodeEditor value={printFenel({ type_sig: { name: "value", type: arrowDraft() } })} readonly minHeight="80px" />
                  </div>
                }>
                <Show when={!functionSignatureShapeIssue()} fallback={<>
                  <p class="data-error">{functionSignatureShapeIssue()}</p>
                  <FenelCodeEditor value={printFenel({ type_sig: { name: "value", type: arrowDraft() } })} readonly minHeight="80px" />
                  <FenelCodeEditor value={functionBaseline()?.fn.body === undefined ? "" : printFenel(functionBaseline()!.fn.body!)} readonly minHeight="120px" />
                </>}>
                <LocusSelect label="Editor lens" value={definitionLens()}
                  options={[{ value: "simple", label: "Simple" }, { value: "full", label: "Full controls" }]}
                  onChange={value => setDefinitionLens(value === "full" ? "full" : "simple")} />
                <FieldAuthoringProvider
                  facetsByFieldId={fieldFacets()}
                  onFieldFacetsChange={changeFieldFacet}
                  onFieldFacetsHydrate={hydrateFieldFacet}
                  onFieldFacetsForget={forgetFieldFacet}
                  ownerKey={`function:${functionPin()!.name}`}
                  owner={persistedRootFieldOwner("function", functionPin()!.name)}
                  resurrectFieldIds={fieldResurrections.fieldIds()}
                  onFieldResurrectionChange={fieldResurrections.onChange}
                >
                  <LambdaFormEditorSurface parameterList={() => <>
                    <TypeBuilder presentation={definitionLens()} lockKind="record"
                      value={{ $record: { fields: functionParameterFields() } }}
                      genericScheme={functionOwnedScheme()}
                      beforeFieldsChange={guardFunctionFields} authoringSession={functionAuthoringSession()}
                      onChange={next => {
                        if (approvedFunctionFields) { approvedFunctionFields = undefined; return; }
                        if ("$record" in next) guardFunctionFields(next.$record.fields);
                      }} />
                    <details><summary>Type parameters</summary><Show when={functionOwnedScheme()}>{scheme =>
                      <GenericParametersEditor scheme={scheme()} onChange={installFunctionScheme}
                        onEdit={editSavedFunctionGeneric} onIssueChange={setFunctionGenericIssue} />
                    }</Show></details>
                  </>} result={() => {
                    // The function's result is one occurrence of the shared type
                    // contract: inferred from the body, or declared in the signature.
                    const inferring = () => functionResultMode() === "infer" && bodyDraft() !== null;
                    return <TypeContract
                      inferred={inferring() && functionResultType() ? displayTypeLabel(functionResultType()!) : undefined}
                      note={inferring() && !functionResultType() ? functionPreview()?.pending ? "Checking result type…"
                        : functionPreview()?.result ? projectAuthoringInferenceOutcome(functionPreview()!.result!.outcome).label
                        : "Complete the body to infer its result." : undefined}
                      declared={!inferring() && functionBodyReturnType() ? displayTypeLabel(functionBodyReturnType()!) : undefined}
                      onUseInferred={inferring() && functionResultType() ? () => {
                        const inferred = functionResultType()!;
                        if (!guardFunctionResult(inferred)) return;
                        changeFunctionResult(inferred); setFunctionResultMode("explicit"); setFunctionSignatureDirty(true);
                      } : undefined}
                      onRemoveDeclared={bodyDraft() !== null ? () => { setFunctionResultMode("infer"); setFunctionSignatureDirty(true); } : undefined}
                      editor={() => <TypeBuilder presentation={definitionLens()} value={functionBodyReturnType()} genericScheme={functionOwnedScheme()}
                        authoringSession={functionAuthoringSession()} beforeChange={guardFunctionResult}
                        onChange={next => { changeFunctionResult(next); setFunctionResultMode("explicit"); setFunctionSignatureDirty(true); }} />} />;
                  }} details={() => <ConstraintsEditor value={functionRequirements() ?? []}
                    captureTarget={captureFunctionRequirementsTarget} disabled={saving() || functionDefinitionChanged()}
                    onChange={next => { if (dismissed || saveInFlight || saving() || functionDefinitionChanged()) return;
                      setFunctionRequirements(next); setFunctionSignatureDirty(true); }} label="Required interfaces" />}
                  diagnostics={() => <>
                    <Show when={functionPreview()?.error}><p class="data-error">{functionPreview()?.error}</p></Show>
                    <Show when={functionPreview()?.result?.outcome.$tag === "Invalid"}>
                      <p class="data-error">{functionPreview()?.result?.outcome.diagnostics?.[0]?.message}</p>
                    </Show>
                  </>} body={() => <GenericTypeScopeContext value={() => {
                    const scheme = functionOwnedScheme(); return scheme ? { scheme } : undefined;
                  }}><Show when={bodyDraft()} fallback={<p class="text-muted">This function has no authored Fenel body to display.</p>}>
                    <LambdaParamsContext value={functionBodyParams}><InstanceTraceContext value={traceProvider}>
                      <ExpressionEditor expr={bodyDraft()!} onChange={setBodyDraft} graphAuthoring draftCheckScope={draftScope}
                        fieldDef={functionResultMode() === "explicit" && functionBodyReturnType()
                          ? { name: "result", type: functionBodyReturnType()!, label: Nothing, ui: Nothing, meta: {} } : undefined}
                        expectedScheme={functionResultMode() === "explicit" && functionOwnedScheme()
                          ? projectAuthoringScheme(functionOwnedScheme()!, ["$arrow", "returns"]) : undefined}
                        authoringSession={functionAuthoringSession()} requirementSource="the function's result type" />
                    </InstanceTraceContext></LambdaParamsContext>
                  </Show></GenericTypeScopeContext>} />
                </FieldAuthoringProvider>
                </Show>
                </Show>
                <Show when={!persistedFunctionRow()}>
                  <FenelCodeEditor value={functionBaseline()?.fn.body === undefined ? "" : printFenel(functionBaseline()!.fn.body!)} readonly minHeight="180px" />
                </Show>
              </div>
            </Show>
            {/* Per-card representation overrides — the same draft-mode
                panel used by NewValueModal/NewTypeModal/NewFunctionModal.
                Drafts written here land in LayoutItem.representations
                (per-locusView ephemeral scope) instead of the global
                dispatch-instance table. */}
            <Show when={!props.standalone}>
            <h4 class="data-group-title" style="font-size: 0.85rem; margin-top: 1rem">Card overrides</h4>
            <RepresentationsPanel
              mode="draft"
              drafts={cardReps()}
              onDraftsChange={setCardReps}
            />
            </Show>
          </section>
          <Show when={traceOpen()}>
            <section class="home-edit-modal__trace">
              <h4 class="data-group-title" style="font-size: 0.85rem">Live trace</h4>
              <ExpressionTrace expr={draft()} />
            </section>
          </Show>
        </div>
        </fieldset>
        <Show when={saveError()}>
          <div class="data-error">{saveError()}</div>
        </Show>
        <Show when={sourceConflict()}>
          <div class="data-error" role="alert">{sourceConflict()}</div>
        </Show>
        <div class="home-edit-modal__foot">
          <Show when={isRef()}>
            <span class="text-muted" style="font-size: 0.78rem">
              {temporaryEdits() ? client.drafts
                ? "Applying updates every linked card. Use Save at the top to keep the changes."
                : "Applying updates every linked card. With sync off, use Save at the top to keep changes."
                : "Saving updates every linked card."}
            </span>
          </Show>
          <button type="button" class="btn" onClick={close}>Cancel</button>
          <Show when={props.standalone !== "definition" || persistedEntityRow() || persistedFunctionRow()}>
          <button type="button" class="btn btn-primary" disabled={saving() || !!sourceConflict() || !!functionGenericIssue() || !!typeGenericIssue()} onClick={() => void save()}>
            {saving() ? temporaryEdits() ? "Applying…" : "Saving…" : temporaryEdits() ? "Apply" : "Save"}
          </button>
          </Show>
        </div>
      </div>
    </ModalOverlay>
  );
}

// ---------------------------------------------------------------------------
// NewValueModal — two-step composer for a brand-new value:
//   - Primary representations stay pinned above the scroll body
//   - Type picker is the first body step
//   - Expression editor is the clean second body step
//
// Save creates a savedQueries row (`kind: "expression"`) and pins a ref to it
// on the active view, so the new value is immediately visible and any
// future edits propagate everywhere.
// ---------------------------------------------------------------------------

// Kinds the composer can produce. The value composer owns value instances;
// type/function entries route to the matching creation surfaces in the
// same home modal stack.
type NewValueKind = "value" | "type" | "function";
type NewValueStep = "type" | "expression";
const KIND_OPTIONS: { id: NewValueKind; label: string; title: string }[] = [
  { id: "value", label: "data", title: "Create a typed data expression" },
  { id: "type", label: "type", title: "Create a type definition" },
  { id: "function", label: "function", title: "Create a function definition" },
];

const NEW_VALUE_ICON_OPTIONS = LUCIDE_ICON_NAMES.filter((name) => !!LUCIDE_BY_NAME[name]);

function newValueSlug(name: string): string {
  const base = name.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 60);
  return `expression-${base || "value"}-${Date.now().toString(36)}`;
}


/** Read a single string out of a representation draft, resolving
 *  LocaleString shapes to their `en` value (or the first non-empty
 *  locale). Used to bridge the typeclass-shaped draft to legacy single-
 *  string columns (saved_queries.name, .description, slug source). */
function repString(
  drafts: Record<string, Record<string, unknown>>,
  typeName: string,
  methodName: string,
): string {
  const v = drafts[typeName]?.[methodName];
  if (typeof v === "string") return v;
  if (v && typeof v === "object") {
    const en = (v as Record<string, unknown>)["en"];
    if (typeof en === "string" && en.trim() !== "") return en;
    const first = Object.values(v as Record<string, unknown>).find(
      (s) => typeof s === "string" && (s as string).trim() !== "",
    );
    if (typeof first === "string") return first;
  }
  return "";
}

function isBlankRepresentationValue(value: unknown): boolean {
  if (value === undefined || value === null) return true;
  if (typeof value === "string") return value.trim() === "";
  if (value && typeof value === "object" && !Array.isArray(value)) {
    const values = Object.values(value as Record<string, unknown>);
    if (values.length === 0) return true;
    return values.every(isBlankRepresentationValue);
  }
  return false;
}

function setRepresentationMethodDraft(
  current: Record<string, Record<string, unknown>>,
  typeName: string,
  methodName: string,
  value: unknown,
): Record<string, Record<string, unknown>> {
  const next = { ...current };
  const methods = { ...(next[typeName] ?? {}) };
  if (isBlankRepresentationValue(value)) delete methods[methodName];
  else methods[methodName] = value;
  if (Object.keys(methods).length === 0) delete next[typeName];
  else next[typeName] = methods;
  return next;
}

/** Writes the visible text of a LocaleString draft method. A single English
 *  entry stays a plain string (LocaleStringEditor's own collapse rule); other
 *  authored locales are kept. */
function setLocaleStringMethodDraft(
  current: Record<string, Record<string, unknown>>,
  typeName: string,
  methodName: string,
  text: string,
): Record<string, Record<string, unknown>> {
  const previous = current[typeName]?.[methodName];
  const next = previous && typeof previous === "object" && !Array.isArray(previous)
    ? { ...(previous as Record<string, unknown>), en: text }
    : text;
  return setRepresentationMethodDraft(current, typeName, methodName, next);
}

/** One icon picker for a composer draft's Iconable: the identity row and the
 *  small type card show the same control. */
function ComposerIconPicker(props: { icon: string; iconOptions: readonly string[]; onIcon: (name: string) => void;
  open: boolean; onOpenChange: (open: boolean) => void;
  /** Drawn, muted, while nothing is chosen (a type's neutral glyph), not "?". */
  unsetIcon?: string }) {
  return (
    <div class="home-composer-modal__icon-picker">
      <button
        type="button"
        class={["home-composer-modal__identity-icon-button", { "home-composer-modal__identity-icon-button--set": !!props.icon }]}
        onClick={() => props.onOpenChange(!props.open)}
        data-tooltip={props.icon ? `Icon: ${props.icon}` : "Choose icon"}
      >
        <Show when={props.icon && LUCIDE_BY_NAME[props.icon]}>
          <IconByName name={props.icon} size={16} />
        </Show>
        <Show when={!props.icon && props.unsetIcon && LUCIDE_BY_NAME[props.unsetIcon] ? props.unsetIcon : undefined} keyed>
          {(name) => <span class="home-composer-modal__identity-icon-fallback"><IconByName name={name} size={16} /></span>}
        </Show>
        <Show when={props.icon ? !LUCIDE_BY_NAME[props.icon] : !(props.unsetIcon && LUCIDE_BY_NAME[props.unsetIcon])}>
          <span class="home-composer-modal__identity-icon-fallback">
            {props.icon ? props.icon.slice(0, 2) : "?"}
          </span>
        </Show>
      </button>
      <Show when={props.open}>
        <div class="home-composer-modal__icon-menu">
          <button
            type="button"
            class={["home-composer-modal__icon-option", { "home-composer-modal__icon-option--active": !props.icon }]}
            onClick={() => {
              props.onIcon("");
              props.onOpenChange(false);
            }}
          >
            <span class="home-composer-modal__icon-option-preview">?</span>
            <span>No icon</span>
          </button>
          <For each={props.iconOptions}>
            {(n) => (
              <button
                type="button"
                class={["home-composer-modal__icon-option", { "home-composer-modal__icon-option--active": props.icon === n }]}
                onClick={() => {
                  props.onIcon(n);
                  props.onOpenChange(false);
                }}
              >
                <span class="home-composer-modal__icon-option-preview">
                  <Show when={LUCIDE_BY_NAME[n]} fallback={n.slice(0, 2)}>
                    <IconByName name={n} size={14} />
                  </Show>
                </span>
                <span>{n}</span>
              </button>
            )}
          </For>
        </div>
      </Show>
    </div>
  );
}

/** The composer's pinned identity row: one icon picker, one primary text
 *  representation and the door to every representation. Each composer
 *  chooses which representation the text writes (data: Labelable, type:
 *  Codeable); the row only edits that composer's one draft. */
function ComposerIdentityRow(props: {
  title: string;
  placeholder: string;
  value: string;
  onInput: (value: string) => void;
  icon: string;
  iconOptions: readonly string[];
  onIcon: (name: string) => void;
  iconPickerOpen: boolean;
  onIconPickerOpenChange: (open: boolean) => void;
  onAllRepresentations: () => void;
  mono?: boolean;
  hideHeading?: boolean;
}) {
  return (
    <div class="home-composer-modal__identity">
      <div class="home-composer-modal__identity-inner">
        <Show when={!props.hideHeading}><span class="home-composer-modal__section-title home-composer-modal__identity-label">{props.title}</span></Show>
        <div class="home-composer-modal__identity-row">
          <ComposerIconPicker icon={props.icon} iconOptions={props.iconOptions} onIcon={props.onIcon}
            open={props.iconPickerOpen} onOpenChange={props.onIconPickerOpenChange} />
          <label class="home-composer-modal__identity-field home-composer-modal__identity-field--label">
            <input
              class={["home-composer-modal__identity-input", { mono: !!props.mono }]}
              type="text"
              value={props.value}
              onInput={(e) => props.onInput(e.currentTarget.value)}
              placeholder={props.placeholder}
              aria-label={props.title}
            />
          </label>
          <button
            type="button"
            class="home-composer-modal__identity-more"
            aria-label="All representations" data-tooltip="All representations"
            onClick={() => props.onAllRepresentations()}
          >
            <span aria-hidden="true"><IconByName name="ellipsis" size={16} /></span>
          </button>
        </div>
      </div>
    </div>
  );
}

/** The nested "All representations" dialog over a composer's draft. */
function ComposerRepresentationsModal(props: {
  drafts: Record<string, Record<string, unknown>>;
  onDraftsChange: (next: Record<string, Record<string, unknown>>) => void;
  saving: boolean;
  onClose: () => void;
}) {
  return (
    <div
      class="modal-overlay modal-overlay--nested"
      onClick={(e) => {
        if (e.target === e.currentTarget) props.onClose();
      }}
    >
      <div class="modal-box home-representations-modal">
        <div class="home-representations-modal__head">
          <h3 class="home-representations-modal__title">Representations</h3>
          <button
            type="button"
            class="btn"
            onClick={() => props.onClose()}
            style="padding: 0.2rem 0.55rem; font-size: 0.78rem"
          >
            Close
          </button>
        </div>
        <div class="home-representations-modal__body" inert={props.saving}>
          <fieldset disabled={props.saving} style="border: 0; min-width: 0; display: contents;">
          <RepresentationsPanel
            mode="draft"
            drafts={props.drafts}
            onDraftsChange={props.onDraftsChange}
          />
          </fieldset>
        </div>
      </div>
    </div>
  );
}

function knownTypeIconName(typeName: string | undefined, reader?: ReaderRuntime): string | undefined {
  const icon = typeName && reader ? reader.presentation(typeName)?.icon ?? reader.representation("Iconable", typeName)?.icon : undefined;
  const name = typeName ? (reader ? typeof icon === "string" ? icon : undefined : getIcon(typeName)) ?? TYPE_ICON_FALLBACKS[typeName] : undefined;
  return name && LUCIDE_BY_NAME[name] ? name : undefined;
}

function findTypeCatalogEntry(typeName: string | undefined, reader?: ReaderRuntime) {
  if (!typeName) return undefined;
  const normalized = typeName.toLowerCase();
  for (const section of getCatalog(reader)) {
    if (section.id === "function") continue;
    for (const entry of section.entries) {
      const name = locale(entry.name);
      const entityId = entry.entity?.id;
      if (
        name === typeName ||
        entry.id === typeName ||
        entry.id === normalized ||
        entityId === typeName
      ) {
        return entry;
      }
    }
  }
  return undefined;
}

function QuickTypeIcon(props: { typeName: string }) {
  const { knownTypeIconName } = useHomeReader();
  const iconName = () => knownTypeIconName(props.typeName);

  return (
    <Show when={iconName()} keyed>
      {(name) => (
        <span class="home-composer-modal__quickpick-icon" aria-hidden="true">
          <IconByName name={name} size={15} />
        </span>
      )}
    </Show>
  );
}

function QuickTypeChipContent(props: { typeName: string; label?: string | undefined; hint?: string | undefined }) {
  return (
    <>
      <QuickTypeIcon typeName={props.typeName} />
      <span class="home-composer-modal__quickpick-chip-copy">
        <span class="home-composer-modal__quickpick-chip-name mono">{props.label ?? props.typeName}</span>
        <Show when={props.hint}>
          <span class="home-composer-modal__quickpick-chip-hint text-muted">{props.hint}</span>
        </Show>
      </span>
    </>
  );
}

function hasQuickTypeDrill(typeName: string): boolean {
  const subs = QUICK_TYPE_SUBTYPES[typeName];
  return !!subs?.some((sub) => sub.name !== typeName);
}

function QuickTypeChip(props: {
  typeName: string;
  label?: string | undefined;
  hint?: string | undefined;
  active: boolean;
  canDrill: boolean;
  onSelect: () => void;
  onDrill: () => void;
}) {
  return (
    <div

      class={["home-composer-modal__quickpick-split", {
        "home-composer-modal__quickpick-split--active": props.active,
        "home-composer-modal__quickpick-split--drillable": props.canDrill,
      }]}
    >
      <button
        type="button"
        class="home-composer-modal__quickpick-chip home-composer-modal__quickpick-chip--split-main"
        onClick={props.onSelect}
        data-tooltip={props.hint}
      >
        <QuickTypeChipContent typeName={props.typeName} hint={props.hint} />
      </button>
      <Show when={props.canDrill}>
        <button
          type="button"
          class="home-composer-modal__quickpick-drill"
          onClick={(e) => {
            e.stopPropagation();
            props.onDrill();
          }}
          data-tooltip={`Browse ${props.typeName} refinements`}
          aria-label={`Browse ${props.typeName} refinements`}
        >
          <IconByName name="chevron-right" size={14} />
        </button>
      </Show>
    </div>
  );
}

type CreationDestination = {
  place: MovePlace;
  reader?: ReaderRuntime;
  client: import("~/lib/api").ApiClient;
  saved: SavedValuesProvider;
  add: typeof addToLocus;
  assertCurrent: () => void;
  assertSource?: (root: import("~/lib/locus-root-data").LocusRootData, expressions: Map<string, ExprNode>, createdId?: string) => void;
  names?: { viewName: (id: string) => string | undefined; itemName: (viewId: string, itemId: string) => string | undefined };
};

function NewValueModal(props: {
  onClose: () => void;
  /** After the created data was added: its occurrence and the place it
   *  landed in (a Suggestions action opens its result there). */
  onCreated?: (occurrence: { id: string } | undefined, place: { kind: string; rootId?: string; listId?: string;
    scope?: LocusScope } | undefined) => void;
  expressionMode?: boolean;
  creation?: { pane?: WorkspacePane; current?: CreationDestination };
  /** A discovered operation remains data until the user requests a preview. */
  evaluateOnRequest?: boolean;
  onSwitchKind?: (kind: Exclude<NewValueKind, "value">) => void;
  presetType?: string;
  /** A small typed card at the originating data; expansion keeps this draft. */
  cardAnchor?: CreationCardAnchor;
  presetValueType?: FenelType;
  placement?: PlacementHint;
  /** Initial expression — used by the duplicate flow to fork an
   *  existing value's body into a fresh draft. */
  presetExpr?: ExprNode;
  /** Initial representation drafts — duplicate flow seeds Labelable/
   *  Describable from the source saved value's name/description. */
  presetReps?: Record<string, Record<string, unknown>>;
  checkpoint?: Extract<HomeAction, { kind: "new:expression" }>["checkpoint"];
  onDraftChange?: (action: Extract<HomeAction, { kind: "new:expression" }> | undefined) => void;
}) {
  const origin = useHomeReader();
  const { reader, api, revalidate, homeAuthoringSession, evaluateAuthoringExpression, persistRepresentation, addToLocus: addToOrigin, temporaryEdits, assertAppearanceDrafts } = origin;
  const originSaved = useContext(SavedValuesContext);
  const originAdd = useContext(HomeDataContext)?.add ?? addToOrigin;
  const initialCreation = untrack(() => props.creation);
  const [destination, setDestination] = createSignal<CreationDestination | undefined>(untrack(() => props.checkpoint?.destination ? undefined : initialCreation?.current));
  const [choosingScope, setChoosingScope] = createSignal(false);
  const [scopeStart, setScopeStart] = createSignal<MovePlace>();
  const [preparingScope, setPreparingScope] = createSignal(untrack(() => !!props.checkpoint?.destination));
  let scopeGeneration = 0;
  const creationEpoch = untrack(sessionEpoch);
  const savedCtx: SavedValuesProvider = {
    list: () => destination()?.saved.list() ?? originSaved?.list() ?? [],
    byId: id => destination()?.saved.byId(id) ?? (!initialCreation ? originSaved?.byId(id) : undefined),
  };
  const locusAdd: typeof addToLocus = (...args) => (destination()?.add ?? originAdd)(...args);
  const creationOccurrence = initialCreation ? { id: untrack(() => props.checkpoint?.creationOccurrenceId) ?? genId() } : undefined;
  let createdValueId: string | undefined = untrack(() => props.checkpoint?.createdValueId);
  let createdValueQuery: Record<string, unknown> | undefined = untrack(() => props.checkpoint?.createdValueQuery);
  const interruptedSubmission = untrack(() => props.checkpoint?.submitted === true);
  let submissionStarted = interruptedSubmission;
  let checkpointLocal = reader?.kind === "local";
  let requestedLocalDestination = untrack(() => props.checkpoint?.destination);
  let dismissed = false;
  let saveInFlight = false;
  onSettled(() => () => { dismissed = true; });
  /** B4 slice 1: a Local Save admission in flight ends with this dialog. */
  let saveController: AbortController | undefined;
  onSettled(() => () => { saveController?.abort(); });
  function close() {
    if (saveInFlight) return;
    scopeGeneration++;
    dismissed = true;
    props.onDraftChange?.(undefined);
    props.onClose();
  }
  function openCreationScope(scope?: LocusScope) {
    if (saveInFlight || createdValueId) return;
    scopeGeneration++; setPreparingScope(false);
    const target = destination();
    setScopeStart(scope && target ? { ...target.place, scope, kind: scope.kind === "root" ? "root" : "list",
      listId: scope.kind === "view" ? scope.viewId : undefined,
      listName: scopeLabel(scope, target.names), listType: undefined, canCreate: false } : target?.place);
    setChoosingScope(true);
  }
  const authoringSession = createMemo(() => destination()?.reader?.session() ?? homeAuthoringSession());
  const initial = untrack(() => ({ presetType: props.presetType, presetValueType: props.presetValueType, presetExpr: props.presetExpr,
    presetReps: props.presetReps, expressionMode: props.expressionMode, checkpoint: props.checkpoint }));
  const [chosenType, setChosenType] = createSignal<string>(initial.presetType ?? "");
  const [chosenValueType, setChosenValueType] = createSignal(initial.presetValueType);
  const expectedType = createMemo(() => {
    const name = chosenType();
    return chosenValueType() ?? (name ? expectedTypeForName(name, authoringSession().environment) : undefined);
  });
  const rootField = createMemo<FieldDef | undefined>(() => {
    const type = expectedType();
    return type ? { name: "", type, label: Nothing, ui: Nothing, meta: {} } : undefined;
  });
  const [draft, setDraft] = createSignal<ExprNode>(untrack(() => initial.presetExpr
    ?? (initial.presetType || initial.presetValueType
      ? seedExpressionForType(expectedType(), authoringSession().environment, initial.presetType)
      : emptyExpressionSlot())));
  const [authoredDraft, setAuthoredDraft] = createSignal(initial.checkpoint?.authored ?? initial.presetExpr !== undefined);
  function updateDraft(next: ExprNode) {
    retainDraft({ expr: next, authored: true });
    setAuthoredDraft(true);
    setDraft(next);
    setSaveError(null);
    setCheckRefusal(false);
    // B4 slice 2: an authored edit (a seeded draft is untouched).
    composerGuidance.touch();
  }
  // Representation drafts captured pre-create — Labelable/Describable/
  // Iconable/Categorizable/etc. The Labelable.label doubles as the
  // saved_queries.name (and slug source); Describable.description doubles
  // as saved_queries.description. After savedQueryCreate returns the id,
  // every populated draft is written through to dispatch instances so
  // surfaces that read via Labelable/Iconable/… pick them up.
  const [reps, setReps] = createSignal<Record<string, Record<string, unknown>>>(
    initial.presetReps ?? {},
  );
  const name = () => repString(reps(), "Labelable", "label");
  const description = () => repString(reps(), "Describable", "description");
  const icon = () => repString(reps(), "Iconable", "icon");
  const iconOptions = createMemo(() => {
    const current = icon();
    return current && !NEW_VALUE_ICON_OPTIONS.includes(current)
      ? [current, ...NEW_VALUE_ICON_OPTIONS]
      : NEW_VALUE_ICON_OPTIONS;
  });
  const [viewMode, setViewMode] = createSignal<ExprViewMode>(initial.checkpoint?.viewMode ?? "nested");
  // Demo 1 (Nov 8): new data of a record type opens as a plain form (the
  // editor's simple lens); "Advanced" shows the full expression editor.
  // Presentation state belongs to the same retained typed draft.
  const cardAnchor = untrack(() => props.checkpoint?.cardAnchor ?? props.cardAnchor);
  const [cardExpanded, setCardExpanded] = createSignal(untrack(() => props.checkpoint?.cardExpanded ?? false));
  const [editorLens, setEditorLens] = createSignal<"simple" | "full">(untrack(() => props.checkpoint?.editorLens ?? "simple"));
  const inlineCard = () => !!cardAnchor && !cardExpanded();
  const [cardPosition, setCardPosition] = createSignal({ x: cardAnchor?.x ?? 0, y: cardAnchor?.y ?? 0 });
  let creationCard: HTMLDivElement | undefined;
  let creationCardFocused = false;
  /** A Create was tried: the simple form's fields say what they still need. */
  const [createTried, setCreateTried] = createSignal(false);
  /** The last refusal is the draft check's (an engine text the form rephrases). */
  const [checkRefusal, setCheckRefusal] = createSignal(false);
  // Empty string == "auto" / inferred. When the user picks an explicit type,
  // we forward it to the ExpressionEditor so the function picker filters by
  // return type and the literal editor offers matching examples.
  // `presetType` is the type-name to pre-fill (e.g. when this modal is
  // opened via a TypePinCard's "Instantiate" action).
  const [composerStep, setComposerStep] = createSignal<NewValueStep>(
    initial.expressionMode || initial.presetType || initial.presetValueType || initial.presetExpr ? "expression" : "type",
  );
  const [chosenKind, setChosenKind] = createSignal<NewValueKind>("value");
  const [pickingType, setPickingType] = createSignal(false);
  let typePickerGeneration = 0;
  function setTypePickerOpen(open: boolean) { typePickerGeneration++; setPickingType(open); }
  const [pickingKind, setPickingKind] = createSignal(false);
  const [iconPickerOpen, setIconPickerOpen] = createSignal(false);
  const [identityOpen, setIdentityOpen] = createSignal(false);
  const [representationsOpen, setRepresentationsOpen] = createSignal(false);
  // Drill-down state for the quick-pick: when set, we're inside that
  // top type's subtype grid. Cleared on "back" or when a type is chosen
  // via the rich picker (since that's a top-level decision).
  const [quickpickParent, setQuickpickParent] = createSignal<string | null>(null);

  function setRepMethod(typeName: string, methodName: string, value: unknown) {
    const next = setRepresentationMethodDraft(reps(), typeName, methodName, value);
    retainDraft({ reps: next });
    setReps(next);
  }
  function showExpressionStep() {
    setComposerStep("expression");
    setTypePickerOpen(false);
    setPickingKind(false);
    setIconPickerOpen(false);
  }
  function showTypeStep() {
    setComposerStep("type");
    setTypePickerOpen(false);
    setPickingKind(false);
    setIconPickerOpen(false);
  }
  function pickAutoType() {
    pickTopType("");
  }
  function pickTopType(name: string) {
    const seeded = !authoredDraft() ? seedExpressionForType(expectedTypeForName(name, authoringSession().environment), authoringSession().environment, name) : draft();
    retainDraft({ expr: seeded, typeName: name, valueType: undefined });
    setChosenType(name);
    setChosenValueType(undefined);
    if (!authoredDraft()) {
      setDraft(seeded);
    }
    setSaveError(null);
    setQuickpickParent(null);
    showExpressionStep();
  }
  function drillQuickType(name: string) {
    if (!hasQuickTypeDrill(name)) return;
    setQuickpickParent(name);
    setTypePickerOpen(false);
    setPickingKind(false);
    setIconPickerOpen(false);
  }
  function pickSubType(name: string) {
    pickTopType(name);
  }
  function pickFromRichPicker(selection: TypePickerSelection) {
    if (dismissed || saveInFlight || saving()) return;
    if (selection.kind === "auto") { pickAutoType(); return; }
    if (selection.ownership === "existing-choice") { pickTopType(selection.reference); return; }
    const valueType: FenelType = { $ref: selection.reference };
    const seeded = !authoredDraft()
      ? seedExpressionForType(valueType, authoringSession().environment) : draft();
    retainDraft({ expr: seeded, typeName: "", valueType });
    setChosenType("");
    setChosenValueType(valueType);
    if (!authoredDraft()) setDraft(seeded);
    setSaveError(null);
    setQuickpickParent(null);
    showExpressionStep();
  }
  const captureRichTypeTarget: CaptureTypePickerTarget = () => latest(() => {
    const available = () => !dismissed && !saveInFlight && !saving() && pickingType()
      && composerStep() === "type" && !choosingScope() && !preparingScope() && !createdValueId;
    if (!available()) return undefined;
    const generation = typePickerGeneration, scope = scopeGeneration;
    const target = destination(), node = draft(), type = chosenValueType();
    const concrete = concreteAuthoringSession(authoringSession()), epoch = sessionEpoch();
    const source = (target?.client ?? origin.client).drafts?.source();
    const fingerprint = () => draftValueFingerprint({ draft: draft(), typeName: chosenType(), valueType: chosenValueType(),
      authored: authoredDraft(), representations: reps(), viewMode: viewMode(), kind: chosenKind(),
      place: destination()?.place, placement: props.placement });
    const revision = fingerprint();
    return () => latest(() => available() && generation === typePickerGeneration && scope === scopeGeneration
      && target === destination() && node === draft() && type === chosenValueType()
      && source === (destination()?.client ?? origin.client).drafts?.source()
      && concrete === concreteAuthoringSession(authoringSession()) && epoch === sessionEpoch() && revision === fingerprint());
  });
  const [saving, setSaving] = createSignal(false);
  const [saveError, setSaveError] = createSignal<string | null>(null);
  const [uncertainSubmission, setUncertainSubmission] = createSignal(false);
  function retainDraft(next: Partial<NonNullable<Extract<HomeAction, { kind: "new:expression" }>["checkpoint"]>> & { expr?: ExprNode } = {}) {
    if (!checkpointLocal) { props.onDraftChange?.(undefined); return; }
    const { expr, ...checkpoint } = next;
    props.onDraftChange?.({ kind: "new:expression", expr: expr ?? draft(), checkpoint: {
      typeName: chosenType(), valueType: chosenValueType(), reps: reps(), authored: authoredDraft(), viewMode: viewMode(),
      cardAnchor, cardExpanded: cardExpanded(), editorLens: editorLens(), placement: props.placement,
      creationOccurrenceId: creationOccurrence?.id,
      submitted: submissionStarted, createdValueId, createdValueQuery, ...checkpoint,
      destination: requestedLocalDestination,
    } });
  }
  onSettled(() => { retainDraft(); });

  async function creationPlaces(): Promise<DataDestinationGroup[]> {
    const groups: DataDestinationGroup[] = [];
    if (initialCreation?.current) groups.push({ label: "Current location", places: [initialCreation.current.place] });
    if (initialCreation?.pane?.creationSource && !(initialCreation.current?.place.sourceId === "local" && initialCreation.current.place.kind === "root")) groups.push({ label: "Local", places: [{
      sourceId: "local", accountId: "", accountLabel: "Local", kind: "root",
      rootId: "", revision: 0, listName: "All data",
    }] });
    return groups;
  }

  function creationSource(place: MovePlace) {
    const sourceId = place.sourceId ?? place.accountId;
    const current = initialCreation?.current;
    if (current && sourceId === (current.place.sourceId ?? current.place.accountId)) {
      return { client: current.client, ready: async () => current.reader };
    }
    return initialCreation?.pane?.creationSource?.(sourceId);
  }

  async function creationChildren(place: MovePlace): Promise<MovePlace[]> {
    const source = creationSource(place);
    if (!source) throw new Error("This data source is not available in this lens.");
    const sourceTicket = source.client.drafts?.source();
    const assertTreeCurrent = () => {
      assertCurrentSession(creationEpoch); source.client.signal.throwIfAborted();
      if (dismissed || sourceTicket !== source.client.drafts?.source()) throw new Error("This data source changed. Browse its scope again.");
    };
    const root = (await source.client.getLocusRoot.uncached()).root;
    assertTreeCurrent();
    if (dismissed || !root || place.rootId && root.id !== place.rootId) throw new Error("This data source changed. Browse its scope again.");
    const here = place.scope ?? (place.kind === "root" ? ROOT_SCOPE : { kind: "view" as const, viewId: place.listId! });
    const sameSourceReader = (place.sourceId ?? place.accountId) === (initialCreation?.current?.place.sourceId ?? initialCreation?.current?.place.accountId)
      ? initialCreation?.current?.reader : undefined;
    const editOptions: ExpressionEditOptions = { constructorFields: id => {
      const entry = sameSourceReader?.session().environment.getFunctionEntry?.(id) as { kind?: string; params?: readonly { name: string }[] } | undefined;
      return entry?.kind === "constructor" ? entry.params?.map(field => field.name) : undefined;
    } };
    const expressions = new Map(Object.entries(root.expressions));
    const itemLocation = (item: LayoutItem, scope: Extract<LocusScope, { kind: "value" }>) => {
      const expression = resolveExpr(item, expressions);
      const data = expression?.kind === "literal" ? expression.value : undefined;
      const list = Array.isArray(data) || !!data && typeof data === "object" && "__list" in data && Array.isArray(data.__list);
      return location(scope, item.caption || "Data", item.valueType,
        root.canEdit === true && list && !!expression && editableContainerAt(expression, [], editOptions));
    };
    const location = (scope: LocusScope, listName: string, listType?: FenelType, canEdit = false, canExpand = true): MovePlace => ({
      ...place, rootId: root.id, revision: root.revision, scope, listName, listType, canEdit: root.canEdit === true, canCreate: canEdit, canExpand,
      kind: scope.kind === "root" ? "root" : "list", listId: scope.kind === "view" ? scope.viewId : undefined,
    });
    function occurrences(items: readonly LayoutItem[]): LayoutItem[] {
      return items.flatMap(item => [item, ...occurrences((item as TreeItem).children ?? [])]);
    }
    if (here.kind === "root") return [
      ...root.lists.map(list => location({ kind: "view", viewId: list.id }, list.name || "Data", list.valueType, root.canEdit === true)),
      ...occurrences(root.items).filter(item => !root.lists.some(list => list.id === item.id)).map(item => itemLocation(item, {
        kind: "value", viewId: root.id, itemId: item.id, rootItem: true, path: [],
      })),
    ];
    if (here.kind === "view") {
      const list = root.lists.find(list => list.id === here.viewId);
      if (!list) throw new Error("This collection is no longer available.");
      return occurrences(list.view.items).map(item => itemLocation(item, { kind: "value", viewId: list.id, itemId: item.id, path: [] }));
    }
    const items = here.rootItem ? root.items : root.lists.find(list => list.id === here.viewId)?.view.items;
    const item = items && findLocusItem(items, here.itemId);
    if (!item) throw new Error("This data is no longer available.");
    const saved = await source.client.getSavedQueries.uncached();
    assertTreeCurrent();
    const savedExpressions = shareSavedExpressionMap(root.expressions, saved.queries);
    const expr = resolveExpr(item, savedExpressions);
    if (!expr) throw new Error("This expression is no longer available.");
    const runtime = await source.ready();
    assertTreeCurrent();
    if (!runtime) throw new Error("This data reader is not ready.");
    const session = runtime.session();
    const value = (await evaluateLocusCard(expr, savedExpressions, session, { transient: true, signal: source.client.signal })).result;
    assertTreeCurrent();
    if (dismissed) throw new Error("The creation dialog was closed.");
    const followed = followLocusPath(value, here.path, reference => resolveLocusCatalogReference(reference, runtime.catalogLookups));
    const options: ExpressionEditOptions = { constructorFields: id => {
      const entry = session.environment.getFunctionEntry?.(id) as { kind?: string; params?: readonly { name: string }[] } | undefined;
      return entry?.kind === "constructor" ? entry.params?.map(field => field.name) : undefined;
    } };
    let type = followed.followed ? undefined : item.valueType;
    for (let depth = 0; !followed.followed && depth < here.path.length; depth++) {
      type = childValueType(valueAt(value, here.path.slice(0, depth)), type, here.path[depth]!, session);
    }
    return (childrenOf(followed.value) ?? []).map(child => {
      const scope: LocusScope = { ...here, path: [...here.path, child.key] };
      return location(scope, child.label, childValueType(followed.value, type, child.key, session),
        root.canEdit === true && !followed.followed && Array.isArray(child.value) && editableContainerAt(expr, scope.path, options),
        childrenOf(child.value) !== undefined);
    });
  }

  async function chooseCreationScope(place: MovePlace) {
    if (saveInFlight || createdValueId || dismissed) return;
    checkpointLocal = reader?.kind === "local" && (place.sourceId ?? place.accountId) === "local";
    if (!checkpointLocal) props.onDraftChange?.(undefined);
    else {
      requestedLocalDestination = { rootId: place.rootId ?? "", scope: cloneDraftValue(place.scope
        ?? (place.kind === "root" ? ROOT_SCOPE : { kind: "view", viewId: place.listId! })) };
      retainDraft();
    }
    const generation = ++scopeGeneration;
    setPreparingScope(true); setSaveError(null);
    const isCurrent = () => !dismissed && generation === scopeGeneration && creationEpoch === sessionEpoch();
    try {
      if (initialCreation?.current && (place.sourceId ?? place.accountId) === (initialCreation.current.place.sourceId ?? initialCreation.current.place.accountId)
        && (!place.rootId || place.rootId === initialCreation.current.place.rootId)
        && scopeKey(place.scope ?? (place.kind === "root" ? ROOT_SCOPE : { kind: "view", viewId: place.listId! }))
          === scopeKey(initialCreation.current.place.scope ?? (initialCreation.current.place.kind === "root" ? ROOT_SCOPE : { kind: "view", viewId: initialCreation.current.place.listId! }))) {
        initialCreation.current.assertCurrent();
        setDestination(initialCreation.current);
        return;
      }
      const source = creationSource(place);
      if (!source) throw new Error("This scope is not available in this lens.");
      const runtime = await source.ready();
      if (!isCurrent()) return;
      const sourceTicket = source.client.drafts?.source();
      const [rootResponse, savedResponse] = await Promise.all([source.client.getLocusRoot.uncached(), source.client.getSavedQueries.uncached()]);
      if (!isCurrent()) return;
      if (sourceTicket !== source.client.drafts?.source()) throw new Error("This data source changed. Choose its scope again.");
      const root = rootResponse.root;
      if (!root || root.canEdit !== true || place.rootId && root.id !== place.rootId) throw new Error("This scope is no longer editable.");
      const nested = place.scope?.kind === "value" ? place.scope : undefined;
      const list = place.kind === "list" && !nested ? root.lists.find(list => list.id === place.listId) : undefined;
      if (place.kind === "list" && !nested && !list) throw new Error("This list is no longer available.");
      const expressions = shareSavedExpressionMap(root.expressions, savedResponse.queries);
      const saved: SavedValueOption[] = [...expressions].map(([id, expr]) => ({ id, expr,
        name: savedResponse.queries.find(row => row.id === id)?.name ?? "" }));
      const assertCurrent = () => {
        assertCurrentSession(creationEpoch); source.client.signal.throwIfAborted();
        if (dismissed) throw new Error("The creation dialog was closed.");
        if (sourceTicket !== source.client.drafts?.source()) throw new Error("This data source changed. Choose its scope again.");
      };
      const options: ExpressionEditOptions = { constructorFields: id => {
        const entry = runtime?.session().environment.getFunctionEntry?.(id) as { kind?: string; params?: readonly { name: string }[] } | undefined;
        return entry?.kind === "constructor" ? entry.params?.map(field => field.name) : undefined;
      } };
      const selectedOwner = nested && findLocusItem(nested.rootItem ? root.items : root.lists.find(row => row.id === nested.viewId)?.view.items ?? [], nested.itemId);
      const selectedExpression = selectedOwner && resolveExpr(selectedOwner, expressions);
      if (nested && (!selectedOwner || !selectedExpression || !editableContainerAt(selectedExpression, nested.path, options))) {
        throw new Error("Choose an authored collection for the new data.");
      }
      let selectedListType = nested ? selectedOwner?.valueType : list?.valueType ?? root.type;
      if (nested && selectedExpression) {
        if (!runtime) throw new Error("This data reader is no longer ready.");
        const session = runtime.session();
        const value = (await evaluateLocusCard(selectedExpression, expressions, session, { transient: true, signal: source.client.signal })).result;
        assertCurrent();
        if (!isCurrent()) return;
        const resolved = followLocusPath(value, nested.path, reference => resolveLocusCatalogReference(reference, runtime.catalogLookups));
        if (resolved.followed || !Array.isArray(resolved.value)) throw new Error("Choose an authored collection for the new data.");
        for (let depth = 0; depth < nested.path.length; depth++) {
          selectedListType = childValueType(valueAt(value, nested.path.slice(0, depth)), selectedListType, nested.path[depth]!, session);
        }
      }
      const selectedContainer = nested && selectedExpression ? draftValueFingerprint(expressionAt(selectedExpression, nested.path, options)) : undefined;
      const selectedOwnerType = selectedOwner ? draftValueFingerprint(selectedOwner.valueType) : undefined;
      const assertSource = nested ? (fresh: import("~/lib/locus-root-data").LocusRootData, sources: Map<string, ExprNode>) => {
        assertCurrent();
        const owner = findLocusItem(nested.rootItem ? fresh.items : fresh.lists.find(row => row.id === nested.viewId)?.view.items ?? [], nested.itemId);
        const expression = owner && resolveExpr(owner, sources);
        if (!owner || !expression || !editableContainerAt(expression, nested.path, options)
          || draftValueFingerprint(owner.valueType) !== selectedOwnerType) throw new Error("The selected collection changed. Choose its scope again before creating data.");
        const container = expressionAt(expression, nested.path, options);
        if (createdValueId && expressionMentions(container).refs.includes(createdValueId)) return;
        if (draftValueFingerprint(container) !== selectedContainer) throw new Error("The selected collection changed. Choose its scope again before creating data.");
      } : undefined;
      const selected = { ...place, rootId: root.id, revision: root.revision, listType: selectedListType };
      const occurrenceId = genId();
      const add: typeof addToLocus = async (value, caption, hint) => {
        assertCurrent();
        if (selected.kind === "root") return locusReaderWrites(source.client).enqueue(async () => {
          assertCurrent();
          return addToLocus(value, caption, hint, source.client, { id: occurrenceId });
        });
        return locusReaderWrites(source.client).enqueue(async () => {
          assertCurrent();
          const ticket = source.client.drafts?.source();
          const latest = (await source.client.getLocusRoot.uncached()).root;
          assertCurrent();
          if (!latest || latest.id !== selected.rootId || latest.canEdit !== true || ticket !== source.client.drafts?.source()) {
            throw new Error("The creation scope changed. Choose it again.");
          }
          if (nested) {
            if (!runtime) throw new Error("This data reader is no longer ready.");
            const session = runtime.session();
            const latestSaved = (await source.client.getSavedQueries.uncached()).queries;
            assertCurrent();
            const sources = shareSavedExpressionMap(latest.expressions, latestSaved);
            assertSource?.(latest, sources);
            const ownerItems = nested.rootItem ? latest.items : latest.lists.find(row => row.id === nested.viewId)?.view.items;
            const owner = ownerItems && findLocusItem(ownerItems, nested.itemId);
            const expr = owner && resolveExpr(owner, sources);
            if (!owner || !expr) throw new Error("The selected data is no longer available.");
            const options: ExpressionEditOptions = { constructorFields: id => {
              const entry = session.environment.getFunctionEntry?.(id) as { kind?: string; params?: readonly { name: string }[] } | undefined;
              return entry?.kind === "constructor" ? entry.params?.map(field => field.name) : undefined;
            } };
            if (!editableContainerAt(expr, nested.path, options)) throw new Error("Create data in an authored collection.");
            if ("savedExprId" in value && expressionMentions(expressionAt(expr, nested.path, options)).refs.includes(value.savedExprId)) return true;
            const appended = appendExpressionAt(expr, nested.path, "savedExprId" in value ? { kind: "ref", savedExprId: value.savedExprId } : value.expr, options);
            let issue: string | undefined;
            if (runtime.kind === "local") {
              // B4 slice 1: evaluation and admission run together in the reader's worker.
              issue = await localExpressionSaveIssue(appended, { reader: runtime, session: () => runtime.session(), saved: sources, draftScope,
                ...(owner.valueType === undefined ? {} : { expectedType: owner.valueType }), evaluate: true,
                signal: saveController?.signal ?? source.client.signal, current: assertCurrent });
            } else {
              const result = evaluateAuthoringExpression(appended, id => sources.get(id), session).result;
              issue = draftSaveIssue(appended, session.environment, { expectedType: owner.valueType,
                registry: session.registry, resolveSavedExpr: id => sources.get(id), evaluatedValue: result, evaluateContext: session.evaluateContext });
            }
            if (issue) throw new Error(issue);
            assertCurrent();
            if (owner.source?.kind === "ref") {
              const id = owner.source.ref.id;
              const stored = latestSaved.find(row => row.id === id);
              if (!stored) throw new Error("The referenced data is no longer available.");
              const query = { ...stored.query, kind: "expression", expr: appended };
              if (source.client.editSavedValue) await source.client.editSavedValue(id, query, latest.revision, undefined, stored.query);
              else await source.client.api.savedQueryUpdate(id, { query, expectedQuery: stored.query });
            } else {
              const changed: LayoutItem = { ...owner, source: { kind: "expr", expr: appended }, expr: undefined };
              if (nested.rootItem) await source.client.editLocusRoot(latest.id, latest.revision, { kind: "replace", itemId: owner.id, item: changed });
              else {
                const row = latest.lists.find(row => row.id === nested.viewId);
                if (!row) throw new Error("This collection is no longer available.");
                await source.client.api.locusViewUpdate(row.id, { view: { ...row.view,
                  items: updateItemInView(row.view, owner.id, () => changed).items }, expectedRootRevision: latest.revision });
              }
            }
            assertCurrent();
            source.client.revalidate(["locusRoot", "savedQueries", "locusViews", "activeLocusView"]);
            return true;
          }
          const currentList = latest.lists.find(list => list.id === selected.listId);
          if (!currentList) throw new Error("This list is no longer available.");
          if (draftValueFingerprint(currentList.valueType) !== draftValueFingerprint(selected.listType)) {
            throw new Error("This list's type changed. Choose its scope again before creating data.");
          }
          if (currentList.view.items.some(item => item.id === occurrenceId)) return true;
          const item: LayoutItem = { id: occurrenceId, caption, valueType: value.valueType,
            source: "savedExprId" in value ? { kind: "ref", ref: { kind: "savedExpr", id: value.savedExprId } }
              : { kind: "expr", expr: value.expr } };
          await source.client.api.locusViewUpdate(currentList.id, {
            view: { ...currentList.view, items: [...currentList.view.items, item] }, expectedRootRevision: latest.revision,
          });
          assertCurrent();
          source.client.revalidate(["locusRoot", "locusViews", "activeLocusView"]);
          return true;
        });
      };
      setDestination({ place: selected, reader: runtime, client: source.client, saved: {
        list: () => saved, byId: id => saved.find(value => value.id === id),
      }, add, assertCurrent, assertSource, names: {
        viewName: id => root.lists.find(row => row.id === id)?.name,
        itemName: (viewId, itemId) => findLocusItem(viewId === root.id ? root.items : root.lists.find(row => row.id === viewId)?.view.items ?? [], itemId)?.caption,
      } });
    } catch (error) {
      if (isCurrent()) { setSaveError(error instanceof Error ? error.message : String(error)); throw error; }
    } finally { if (isCurrent()) setPreparingScope(false); }
  }
  onSettled(() => {
    if (!initialCreation || !requestedLocalDestination && initialCreation.current) return;
    queueMicrotask(() => {
      if (dismissed || creationEpoch !== untrack(sessionEpoch)) return;
      const target = requestedLocalDestination;
      void chooseCreationScope({ sourceId: "local", accountId: "", accountLabel: "Local",
        kind: target?.scope.kind && target.scope.kind !== "root" ? "list" : "root",
        rootId: target?.rootId ?? "", revision: 0, listName: "All data",
        scope: target?.scope, listId: target?.scope.kind === "view" ? target.scope.viewId : undefined,
      }).catch(() => {});
    });
  });

  // Refs in the draft are inlined at evaluation time so the engine never
  // sees a `ref` op. The lookup pulls from the same SavedValuesContext that
  // the LiteralEditor's "+ ref" picker browses.
  const refResolver = (id: string) => savedCtx?.byId(id)?.expr;

  // A saved selection has no cached catalogue caption: reopen/reload reads
  // the same reader-owned Labelable presentation as the ordinary data cards.
  const declaredTypePresentation = () => {
    const type = expectedType();
    if (!type) return undefined;
    const heldReader = destination()?.reader ?? reader;
    return heldReader?.kind === "local" ? heldReader.typePresentation?.(type)
      : typedReadTypePresentation(type, authoringSession(), heldReader);
  };
  // A caption is a noun phrase ("Person", not "A person"), as on data cards.
  const declaredTypeLabel = () => valueCardTypeLabel(declaredTypePresentation()?.label);
  // Diagnostic names are the same reader-owned captions already shown in
  // the header; they never supply compatibility or membership evidence.
  const creationTypeName = () => declaredTypeLabel() || chosenType() || undefined;

  const [requestedPreview, setRequestedPreview] = createSignal<{ node: ExprNode; session: AuthoringSession;
    fingerprint: string; savedFingerprint: string; revision?: number; epoch: number;
    requirementFingerprint: string;
    snapshot: ReturnType<typeof evaluateSessionExpression>; issue?: string; validation?: CreationValidation }>();
  const previewSavedFingerprint = () => draftValueFingerprint((savedCtx?.list() ?? []).map(value => [value.id, value.expr]));
  const previewRequirement = () => {
    const target = destination(), expected = expectedType();
    return { expectedType: expected,
      expectedListType: expected === undefined && initialCreation ? target?.place.listType : undefined,
      scope: target?.place, scopeGeneration };
  };
  const previewCurrent = () => {
    const preview = requestedPreview();
    return !!preview && preview.node === draft() && preview.session === authoringSession() && preview.epoch === sessionEpoch()
      && preview.revision === (destination()?.reader ?? reader)?.revision() && preview.fingerprint === draftValueFingerprint(draft())
      && preview.savedFingerprint === previewSavedFingerprint()
      && preview.requirementFingerprint === draftValueFingerprint(previewRequirement());
  };
  function previewDraft() {
    const node = draft();
    const session = authoringSession();
    if (guidanceReader()?.kind === "local") { void previewLocalDraft(node, session); return; }
    const requirement = cloneDraftValue(previewRequirement());
    const issue = draftSaveIssue(node, session.environment, {
      expectedType: requirement.expectedType, expectedTypeName: creationTypeName(),
      registry: session.registry, resolveSavedExpr: refResolver,
    });
    if (issue) { setSaveError(issue); return; }
    try {
      const snapshot = evaluateAuthoringExpression(node, refResolver, session, {}, { capture: true });
      setRequestedPreview({ node, session, snapshot, fingerprint: draftValueFingerprint(node),
        savedFingerprint: previewSavedFingerprint(), requirementFingerprint: draftValueFingerprint(requirement),
        revision: (destination()?.reader ?? reader)?.revision(), epoch: sessionEpoch() }); setSaveError(null);
    } catch (error) { setSaveError(error instanceof Error ? error.message : String(error)); }
  }
  /** B4 slice 2: a Local reader's Preview checks, then evaluates, in its
   * worker (weight 0: an explicit request), in the page's order. */
  async function previewLocalDraft(node: ExprNode, session: AuthoringSession) {
    const local = guidanceReader();
    if (local?.kind !== "local") return;
    const saved = new Map((savedCtx?.list() ?? []).map(value => [value.id, value.expr] as const));
    const fingerprint = draftValueFingerprint(node), savedFingerprint = previewSavedFingerprint(), revision = local.revision(), epoch = sessionEpoch();
    // One immutable requirement is used for both requests. A type/list/scope
    // change during either await cannot publish an answer for the new target.
    const requirement = cloneDraftValue(previewRequirement()), requirementFingerprint = draftValueFingerprint(requirement);
    const admission = { ...(requirement.expectedType === undefined ? {} : { expectedType: requirement.expectedType }),
      ...(requirement.expectedListType === undefined ? {} : { expectedListType: requirement.expectedListType }),
      ...(creationTypeName() ? { expectedTypeName: creationTypeName() } : {}) };
    const stale = () => dismissed || draft() !== node || authoringSession() !== session || sessionEpoch() !== epoch
      || local.revision() !== revision || draftValueFingerprint(draft()) !== fingerprint
      || previewSavedFingerprint() !== savedFingerprint
      || draftValueFingerprint(previewRequirement()) !== requirementFingerprint;
    try {
      const checked = expressionSaveIssueInWorker(session, node, saved, admission);
      if (!checked) throw new Error(LOCAL_SAVE_TOOLS_PENDING);
      const issue = (await checked).issue;
      if (stale()) return;
      if (issue) { setSaveError(issue); return; }
      const job = evaluateExpressionInWorker(session, node, saved, undefined, undefined, { capture: true,
        admission: { ...admission, creationValidation: true } });
      if (!job) throw new Error(LOCAL_SAVE_TOOLS_PENDING);
      const reply = await job;
      if (stale()) return;
      const snapshot = { result: reply.result, trace: [], ...(reply.captures ? { captures: reply.captures } : {}) } as unknown as ReturnType<typeof evaluateSessionExpression>;
      setRequestedPreview({ node, session, snapshot, issue: reply.issue, validation: reply.validation, fingerprint,
        savedFingerprint, requirementFingerprint, revision, epoch });
      setSaveError(null);
    } catch (error) { if (!stale()) setSaveError(error instanceof Error ? error.message : String(error)); }
  }
  // B4 slice 2: a Local reader's live evaluation, its check and the inferred
  // type come from its worker (one evaluate-then-check request and one
  // inference item per edit, latest wins, nothing before an edit). Checking
  // shows no value, no issue and no inferred type; Save asks its worker again.
  const guidanceReader = () => destination()?.reader ?? reader;
  /** B4 fix round 2: this surface's pending nested value checks. */
  const draftScope = {};
  type ComposerGuidanceItem = { node: ExprNode; evaluate: boolean;
    /** An incomplete draft is not evaluated; it is checked (the page's draftSaveIssue). */
    check?: boolean; admission: import("~/lib/expression-runner/authoring-worker-protocol").ExpressionAdmissionInput;
    infer?: import("~/lib/expression-runner/authoring-worker-protocol").ExpressionInferenceItem };
  type ComposerGuidance = { evaluation?: { result: unknown; trace: []; error?: string }; issue?: string; validation?: CreationValidation;
    inferred?: import("~/lib/expression-runner/authoring-worker-protocol").ExpressionInferenceReply };
  const composerGuidance = createLocalLiveGuidance<ComposerGuidanceItem, ComposerGuidance>(guidanceReader, authoringSession,
    async ([item], capture, signal) => {
      const saved = new Map((savedCtx?.list() ?? []).map(value => [value.id, value.expr] as const));
      const sourceMetadata = capture.sourceMetadata ? { sourceMetadata: capture.sourceMetadata } : {};
      const answer: ComposerGuidance = {};
      if (item!.evaluate) {
        const job = evaluateExpressionInWorker(capture.facade, item!.node, saved, signal, undefined,
          { admission: item!.admission, priority: "guidance", ...sourceMetadata });
        if (!job) throw new Error(LOCAL_SAVE_TOOLS_PENDING);
        try {
          const reply = await job;
          answer.evaluation = { result: reply.result, trace: [] };
          answer.validation = reply.validation;
          if (reply.issue !== undefined) answer.issue = reply.issue;
        } catch (error) {
          // The worker's own evaluation refusal is this draft's answer; a
          // transport failure stays "checking" until the next edit.
          if (!(error instanceof WorkerRequestError) || error.code !== undefined) throw error;
          answer.evaluation = { result: undefined, trace: [], error: error.message };
        }
      }
      if (item!.check) {
        const job = expressionSaveIssueInWorker(capture.facade, item!.node, saved, { ...item!.admission, priority: "guidance", ...sourceMetadata }, signal);
        if (!job) throw new Error(LOCAL_SAVE_TOOLS_PENDING);
        const reply = await job;
        answer.validation = reply.validation;
        if (reply.issue !== undefined) answer.issue = reply.issue;
      }
      if (item!.infer) {
        const job = inferExpressionsInWorker(capture.facade, [item!.infer], saved, { priority: "guidance", ...sourceMetadata }, signal);
        if (!job) throw new Error(LOCAL_SAVE_TOOLS_PENDING);
        answer.inferred = (await job)[0];
      }
      return [answer];
    }, { batch: 1, label: "composer" });
  onCleanup(() => composerGuidance.dispose());
  // Opening or selecting a complete seed is a request to create that data,
  // without authoring an edit. Use the existing completeness check over the
  // published structure before asking the captured worker; incomplete seeds
  // stay idle. The same owner observes later type-picker seed changes.
  // B4 unit D item 2: the worker retains its own final completeness check.
  openLocalLiveGuidance(composerGuidance, guidanceReader, authoringSession, () => {
    if (guidanceReader()?.kind !== "local" || composerStep() !== "expression" || props.evaluateOnRequest
      || saving() || saveInFlight) return undefined;
    const node = draft();
    return completeLiveDraft(node, current => toLogic(current, refResolver, authoringSession())) ? node : undefined;
  }, refResolver);
  const composerLocalAnswer = createMemo(() => {
    if (guidanceReader()?.kind !== "local") return undefined;
    // Keep Local pending (truthy), so Save cannot re-arm guidance or enter the page fallback.
    if (saving() || saveInFlight) return {};
    const node = draft();
    let emptySlot: boolean;
    try { emptySlot = authoringExpressionHasEmptySlot(toLogic(node, refResolver, authoringSession())); }
    catch { emptySlot = false; }
    const expected = expectedType();
    const listType = expected === undefined && initialCreation ? destination()?.place.listType : undefined;
    const blank = node.kind === "literal" && node.value === undefined;
    return composerGuidance.read({ node, evaluate: !props.evaluateOnRequest && !emptySlot,
      ...(!props.evaluateOnRequest && emptySlot ? { check: true } : {}),
      admission: { creationValidation: true, ...(expected ? { expectedType: expected } : {}), ...(listType ? { expectedListType: listType } : {}),
        ...(creationTypeName() ? { expectedTypeName: creationTypeName() } : {}) },
      ...(composerStep() === "type" || blank || emptySlot ? {} : { infer: expressionInferenceItem(node, authoringSession()) }) }) ?? {};
  });
  const evaluated = createMemo(() => {
    if (props.evaluateOnRequest) return previewCurrent() ? requestedPreview()!.snapshot : { result: undefined, trace: [] };
    const local = composerLocalAnswer();
    if (local) return local.evaluation ?? { result: undefined, trace: [] };
    try {
      if (authoringExpressionHasEmptySlot(toLogic(draft(), refResolver, authoringSession()))) return { result: undefined, trace: [] };
      return evaluateAuthoringExpression(draft(), refResolver, authoringSession());
    } catch (e: any) {
      return { result: undefined, trace: [], error: e?.message ?? String(e) };
    }
  });

  /** The element type a typed destination list requires of new data. */
  const destinationElementType = createMemo(() => initialCreation && destination()?.place.listType
    // B4 wave 4 lane H: a Local reader names its types through its inert lookup.
    ? peelListForAuthoring(resolveValueType(destination()!.place.listType!, name => reader?.kind === "local" && reader.resolveTypeName
      ? reader.resolveTypeName(name) : authoringSession().registry.getIdentifiedEntity(name)?.type))?.elem
    : undefined);
  /** The simple form can show this draft: a constructor of a chosen type. */
  const simpleAvailable = () => !props.expressionMode && !props.evaluateOnRequest && composerStep() === "expression"
    && !!constructForm(draft());
  const simpleLens = () => editorLens() === "simple" && simpleAvailable();
  const simpleTitle = () => simpleAvailable() && declaredTypeLabel() ? `New ${declaredTypeLabel()}` : undefined;
  /** The synchronous preconditions every Save keeps (Local and page). */
  const draftPrecondition = () => {
    if (interruptedSubmission || uncertainSubmission()) return "This creation may already be saved. Check the selected data before creating it again; your draft is kept here.";
    if (initialCreation && (preparingScope() || !destination())) return "Choose an editable scope before creating data.";
    if (composerStep() === "type") return "Choose a type or use Auto before saving.";
    if (props.evaluateOnRequest && !previewCurrent()) return "Preview this expression before saving.";
    return undefined;
  };
  const creationValidation = createMemo(() => {
    if (draftPrecondition()) return undefined;
    const local = composerLocalAnswer();
    if (local) return props.evaluateOnRequest ? previewCurrent() ? requestedPreview()?.validation : undefined : local.validation;
    return draftSaveValidation(draft(), authoringSession().environment, {
      expectedType: expectedType() ?? destinationElementType(),
      expectedTypeName: creationTypeName(),
      registry: authoringSession().registry,
      resolveSavedExpr: refResolver,
      evaluatedValue: evaluated().result,
      evaluateContext: authoringSession().evaluateContext,
    });
  });
  const draftIssue = createMemo(() => {
    const precondition = draftPrecondition();
    if (precondition) return precondition;
    const local = composerLocalAnswer();
    if (local) return props.evaluateOnRequest ? requestedPreview()?.issue : local.issue;
    return creationValidation()?.issue;
  });
  const creationState = () => creationValidation()?.state.$tag ?? "HintUnknown";
  const creationReady = () => {
    const validation = creationValidation();
    return validation?.state.$tag === "HintPass" && validation.verdict.$tag === "Just"
      && validation.verdict._0 === true && !validation.issue && !draftPrecondition();
  };
  const creationValidationHints = () => ({ state: { $tag: creationState() }, rules: [] });
  const creationHintFields = () => {
    const validation = creationValidation();
    if (!validation) return [];
    const labels = new Map<string, string>();
    try {
      const session = authoringSession(), heldReader = destination()?.reader ?? reader;
      const environment = authoringStructureEnvironment(session), form = constructForm(draft());
      // Reuse the editor's declared field projection, not a second type walk.
      const fields = form ? constructorFieldsForTag(form.tag, { ...environment, scrutineeType: expectedType() })
        : recordFieldsForType(expectedType(), environment);
      for (const field of fields ?? []) {
        let label = canonical(peelMaybeValue(field.label) ?? "") || field.name;
        if (heldReader?.kind === "local") {
          if (field.key?.$tag === "NamedField") label = localFieldName(heldReader, session, field.key.ref.$ref)?.label || label;
        } else {
          const view = tryResolveIdentifiedFieldView(session.registry, field);
          if (view.ok) label = canonical(view.value.presentation.label) || label;
        }
        labels.set(field.name, label);
      }
    } catch { /* Pending presentation retains the checker's own field path. */ }
    return validation.fields.map(field => ({ ...field, label: field.path ? labels.get(field.path) : declaredTypeLabel() }));
  };
  const creationValidationTooltip = () => {
    const validation = creationValidation();
    if (draftPrecondition()) return draftPrecondition();
    if (!validation) return "Checking data…";
    const fields = creationHintFields();
    // An actual ongoing field rule already explains the amber root. Keep
    // the canonical issue internally, without duplicating its generic mismatch.
    const explained = validation.issueDiagnostic?.code === "authoring.literal-membership"
      && validation.issueDiagnostic.path?.length === 1 && validation.issueDiagnostic.path[0] === "$expression"
      && validation.state.$tag === "HintNotYet"
      && fields.some(field => field.hints.rules.some(rule => rule.state.$tag === "HintNotYet"));
    const issue = explained || !validation.issue ? undefined : readableIdentities(validation.issue, id => {
      if (id === chosenType() || id === refHandle(expectedType())) return declaredTypeLabel();
      const heldReader = destination()?.reader ?? reader;
      return locale(heldReader ? heldReader.presentation(id)?.label : origin.getLabel(id));
    });
    return hintsTooltipText(creationValidationHints(), true, fields, issue)
      || (validation.state.$tag === "HintPass" ? "Data fits its type." : "Checking data…");
  };
  const inferredValueType = createMemo(() => {
    if (composerStep() === "type") return undefined;
    const local = composerLocalAnswer();
    if (local) return local.inferred?.type;
    const current = draft();
    if (current.kind === "literal" && current.value === undefined) return undefined;
    if (authoringExpressionHasEmptySlot(toLogic(current, refResolver, authoringSession()))) return undefined;
    return inferExpressionType(current, {}, authoringSession());
  });
  const inferredType = createMemo(() => {
    const type = inferredValueType();
    return type ? typeDisplayName(type, authoringSession().environment) : undefined;
  });
  /** Lock the inferred type in as the chosen type, through the same owner
   * the type step writes (a named type, or a structural value type). */
  function useInferredType() {
    const type = inferredValueType();
    if (!type) return;
    const name = "$ref" in type && typeof type.$ref === "string" ? type.$ref : undefined;
    retainDraft({ typeName: name ?? "", valueType: name ? undefined : type });
    setChosenType(name ?? "");
    setChosenValueType(name ? undefined : type);
    setSaveError(null);
  }
  const declaredTypeIcon = () => declaredTypePresentation()?.icon ?? (expectedType() ? TYPE_ICON_FALLBACKS.Type : undefined);
  const declaredTypeDescription = () => {
    const type = expectedType(), heldReader = destination()?.reader ?? reader;
    const target = type && presentedTypeTarget(type);
    if (typeof target !== "string") return undefined;
    return locale(heldReader ? heldReader.presentation(target)?.description
      ?? heldReader.representation("Describable", target)?.description : origin.getDescription(target));
  };

  // Refs the draft uses, resolved to their saved-value names so the
  // summary chip can show "5 references" with a tooltip listing them.
  const referencedValues = createMemo(() => {
    const ids = listRefs(draft());
    return ids.map((id) => ({
      id,
      name: savedCtx?.byId(id)?.name ?? `(missing: ${id.slice(0, 8)}…)`,
    }));
  });

  async function save() {
    if (dismissed || saveInFlight) return;
    // B4 slice 2: a Local Save keeps the synchronous preconditions and asks its
    // worker below; it never reads the live guidance memo.
    const localDraftReader = guidanceReader()?.kind === "local" ? guidanceReader() : undefined;
    const issue = localDraftReader ? draftPrecondition() : draftIssue();
    setCreateTried(true);
    setCheckRefusal(false);
    if (issue) { setCheckRefusal(true); setSaveError(issue); return; }
    // No name is required. The name box authors a `Labelable` instance, and a
    // value that has none is simply unnamed — it has an id, and every surface
    // that shows it falls back to its type. Refusing to save without one was
    // the legacy NOT NULL column speaking through the authoring surface.
    const n = name().trim();
    const target = destination();
    const saveClient = target?.client ?? origin.client;
    const submittedDraft = cloneDraftValue(draft());
    const submittedType = cloneDraftValue(expectedType());
    const submittedSession = authoringSession(), submittedScope = scopeGeneration;
    const submittedFingerprint = draftValueFingerprint({ draft: draft(), type: expectedType(), reps: reps() });
    const assertSubmittedCurrent = () => {
      if (dismissed || creationEpoch !== sessionEpoch() || submittedScope !== scopeGeneration
        || submittedSession !== authoringSession()
        || submittedFingerprint !== draftValueFingerprint({ draft: draft(), type: expectedType(), reps: reps() }))
        throw new Error(LOCAL_SAVE_DRAFT_CHANGED);
      target?.assertCurrent();
    };
    saveInFlight = true;
    setSaving(true);
    setSaveError(null);
    const saveSignal = (saveController = new AbortController()).signal;
    try {
      if (localDraftReader) {
        // The page's draft check, in the worker (evaluate, then check), after
        // cancelling this surface's guidance: Save never waits behind it.
        composerGuidance.cancel();
        const submitted = draftValueFingerprint(submittedDraft);
        const listType = submittedType === undefined && initialCreation ? target?.place.listType : undefined;
        const draftCheck = await localExpressionSaveIssue(submittedDraft, { reader: localDraftReader, session: authoringSession, draftScope,
          saved: new Map((savedCtx?.list() ?? []).map(value => [value.id, value.expr] as const)),
          ...(submittedType === undefined ? {} : { expectedType: submittedType }), ...(listType ? { expectedListType: listType } : {}),
          ...(creationTypeName() ? { expectedTypeName: creationTypeName() } : {}), evaluate: true, signal: saveSignal,
          current: () => {
            if (dismissed) throw new Error("The creation dialog was closed.");
            target?.assertCurrent();
            if (draftValueFingerprint(draft()) !== submitted) throw new Error(LOCAL_SAVE_DRAFT_CHANGED);
          } });
        if (draftCheck) { setCheckRefusal(true); throw new Error(draftCheck); }
      }
      if (initialCreation) {
        if (!target) throw new Error("Choose an editable scope before creating data.");
        target.assertCurrent();
        const ticket = saveClient.drafts?.source();
        const [rootResponse, savedResponse] = await Promise.all([saveClient.getLocusRoot.uncached(), saveClient.getSavedQueries.uncached()]);
        assertSubmittedCurrent();
        target.assertCurrent();
        const root = rootResponse.root;
        if (!root || root.id !== target.place.rootId || root.canEdit !== true || ticket !== saveClient.drafts?.source()) {
          throw new Error("The creation scope changed. Choose it again before creating data.");
        }
        const list = target.place.kind === "list" && target.place.listId ? root.lists.find(list => list.id === target.place.listId) : undefined;
        if (target.place.listId && !list) throw new Error("This list is no longer available.");
        const sources = shareSavedExpressionMap(root.expressions, savedResponse.queries);
        target.assertSource?.(root, sources, createdValueId);
        for (const id of listRefs(submittedDraft)) {
          if (!sources.has(id) || draftValueFingerprint(sources.get(id)) !== draftValueFingerprint(savedCtx.byId(id)?.expr)) {
            throw new Error("Referenced data changed or is unavailable in this scope. Choose the scope again before creating data.");
          }
        }
        const type = list?.valueType ?? target.place.listType;
        const local = target.reader?.kind === "local" ? target.reader : undefined;
        let placementIssue: string | undefined;
        if (local) {
          // B4 slice 1: the worker peels the list's element type with its own
          // Local registry, as the page did with its registry; the chosen type
          // stays the fallback when the list type has no element.
          const submitted = draftValueFingerprint(submittedDraft);
          placementIssue = await localExpressionSaveIssue(submittedDraft, { reader: local, session: authoringSession, saved: sources, draftScope,
            ...(type === undefined ? {} : { expectedListType: type }), ...(submittedType === undefined ? {} : { expectedType: submittedType }),
            evaluate: true, signal: saveSignal, current: () => {
              target.assertCurrent();
              if (draftValueFingerprint(draft()) !== submitted) throw new Error(LOCAL_SAVE_DRAFT_CHANGED);
            } });
          target.assertCurrent();
        } else {
          const element = type && peelListForAuthoring(resolveValueType(type, name => authoringSession().registry.getIdentifiedEntity(name)?.type))?.elem;
          const fresh = evaluateAuthoringExpression(submittedDraft, id => sources.get(id), authoringSession());
          placementIssue = draftSaveIssue(submittedDraft, authoringSession().environment, {
            expectedType: element ?? submittedType, registry: authoringSession().registry, resolveSavedExpr: id => sources.get(id),
            evaluatedValue: fresh.result, evaluateContext: authoringSession().evaluateContext,
          });
        }
        if (placementIssue) { setCheckRefusal(true); throw new Error(placementIssue); }
      }
      assertSubmittedCurrent();
      assertAppearanceDrafts(reps());
      const payload = {
        ...(n ? { name: n } : {}),
        slug: newValueSlug(n),
        description: description().trim() || undefined,
        query: { kind: "expression", expr: submittedDraft,
          ...(submittedType ? { valueType: submittedType } : {}) } as Record<string, unknown>,
      };
      const representationDrafts = cloneDraftValue(reps());
      const placement = cloneDraftValue(props.placement);
      const beforeCreate = saveClient.drafts?.source();
      submissionStarted = true;
      retainDraft({ submitted: true });
      const res = createdValueId
        ? await saveClient.api.savedQueryUpdate(createdValueId, { ...payload, expectedQuery: createdValueQuery })
        : await saveClient.api.savedQueryCreate(payload);
      if (dismissed) return;
      const id = createdValueId ?? (res as any)?.query?.id as string | undefined;
      createdValueId = id;
      createdValueQuery = cloneDraftValue((res as { query?: { query?: Record<string, unknown> } })?.query?.query ?? payload.query);
      retainDraft({ submitted: true, createdValueId, createdValueQuery });
      target?.assertCurrent();
      if (target && beforeCreate !== saveClient.drafts?.source()
        && saveClient.drafts?.resultSource(res) !== saveClient.drafts?.source()
        && !(saveClient.drafts?.source() === undefined && saveClient.drafts?.resultRootRevision(res) !== undefined)) {
        throw new Error("The data source changed while creating data. The created identity is retained for retry.");
      }
      if (id) {
        // Persist every representation draft against the new id so
        // typeclass-aware surfaces (function editor, type pages, card
        // overrides, …) pick them up. A refusal keeps this composer and its
        // created identity for retry instead of silently dropping a rule.
        for (const [typeName, methods] of Object.entries(representationDrafts)) {
          try {
            // B4 unit E: a Local reader encodes in its own worker.
            if (target) await (await import("~/lib/representations/persist")).persistRepresentation(typeName, id, methods,
              undefined, target.client, target.reader?.kind === "local" ? target.client.instanceEncoding!() : target.reader?.registry());
            else await persistRepresentation(typeName, id, methods);
          } catch (e) {
            if (dismissed) return;
            throw new Error(`The data was created, but its appearance changes could not be applied. Retry in this dialog. ${e instanceof Error ? e.message : String(e)}`);
          }
          if (dismissed) return;
        }
        saveClient.revalidate(["savedQueries"]);
        const added = await locusAdd({ savedExprId: id, valueType: submittedType }, n, placement, saveClient, creationOccurrence);
        if (dismissed) return;
        if (!added) throw new Error(temporaryEdits() ? "The data was created locally, but could not be added here. Retry to add the same data."
          : "The data is saved, but could not be added here. Retry to add the same data.");
        const landed = destination()?.place;
        props.onCreated?.(creationOccurrence, landed ? { kind: landed.kind, rootId: landed.rootId, listId: landed.listId,
          scope: landed.scope ? cloneDraftValue(landed.scope) : undefined } : undefined);
      }
      void saveClient.revalidate(["savedQueries", "locusRoot", "locusViews", "activeLocusView"]);
      saveInFlight = false;
      close();
    } catch (e: any) {
      if (!dismissed && submissionStarted && !createdValueId) {
        setUncertainSubmission(true);
        setSaveError("This creation may already be saved. Check the selected data before creating it again; your draft is kept here.");
      } else if (!dismissed) setSaveError(createdValueId
        ? `The data was created in ${destination()?.place.accountLabel ?? "this scope"}, but could not be added to the chosen location. Retry keeps the same data; changing scope requires a new creation. ${e?.message ?? String(e)}`
        : e?.message ?? String(e));
    } finally {
      saveInFlight = false;
      if (!dismissed) setSaving(false);
    }
  }

  function toggleComposerPresentation() {
    if (dismissed || saveInFlight || saving()) return;
    const expanded = cardAnchor ? !cardExpanded() : undefined;
    const lens = cardAnchor ? expanded ? "full" : "simple" : simpleLens() ? "full" : "simple";
    retainDraft({ editorLens: lens, ...(expanded === undefined ? {} : { cardExpanded: expanded }) });
    if (expanded !== undefined) setCardExpanded(expanded);
    setEditorLens(lens);
  }
  function positionCreationCard() {
    if (!creationCard || !cardAnchor || !untrack(inlineCard)) return;
    const box = creationCard.getBoundingClientRect(), beside = cardAnchor.beside;
    const viewport = { width: window.innerWidth, height: window.innerHeight };
    const at = !beside ? cardAnchor
      : beside.right + 8 + box.width <= viewport.width - 8 ? { x: beside.right + 8, y: beside.top }
      : beside.left - 8 - box.width >= 8 ? { x: beside.left - 8 - box.width, y: beside.top }
      : { x: beside.left, y: beside.bottom + 8 };
    const next = clampCardPosition(at, { width: box.width, height: box.height }, viewport);
    const current = untrack(cardPosition);
    if (next.x !== current.x || next.y !== current.y) setCardPosition(next);
    if (!creationCardFocused) {
      const active = document.activeElement;
      if (active && active !== creationCard && creationCard.contains(active)) creationCardFocused = true;
      else {
        const input = Array.from(creationCard.querySelectorAll<HTMLElement>('input:not([type="hidden"]), textarea, [contenteditable="true"]'))
          .find(element => element.getClientRects().length > 0 && !element.matches(":disabled"));
        if (input) { input.focus(); creationCardFocused = true; }
      }
    }
  }
  onSettled(() => {
    if (!cardAnchor || !creationCard) return;
    positionCreationCard();
    const observer = typeof ResizeObserver === "function" ? new ResizeObserver(positionCreationCard) : undefined;
    observer?.observe(creationCard);
    window.addEventListener("resize", positionCreationCard);
    if (untrack(inlineCard) && !creationCardFocused) creationCard.focus();
    return () => { observer?.disconnect(); window.removeEventListener("resize", positionCreationCard); };
  });

  function ComposerTypePicker() {
    return <AuthoringSessionContext value={authoringSession()}>
      <TypePicker allowAuto onPick={pickFromRichPicker} captureTarget={captureRichTypeTarget}
        onCancel={() => setTypePickerOpen(false)} />
    </AuthoringSessionContext>;
  }
  function ComposerExpressionEditor() {
    return (<ExpressionEditor draftCheckScope={draftScope}
                    expr={draft()}
                    onChange={updateDraft}
                    graphAuthoring
                    deferFunctionChoices
                    viewMode={viewMode()}
                    typeName={chosenType() || undefined}
                    fieldDef={rootField()}
                    authoringSession={authoringSession()}
                    onCaptureGraph={props.evaluateOnRequest ? previewDraft : undefined}
                    graphValue={props.evaluateOnRequest ? node => previewCurrent()
                      ? readLocusCapturedValue(draft(), new Map((savedCtx?.list() ?? []).map(value => [value.id, value.expr])),
                        authoringSession(), node, evaluated()) : undefined : undefined}
                    hideLabel
                    hideTopLevelAnnotation
                    hideTypeContract
                    presentation={simpleLens() ? "simple" : "full"}
                    simpleShowIssues={createTried()}
                  />);
  }

  // Keep anchored cards in viewport coordinates outside lens containment.
  // This choice is fixed for the draft's lifetime, including full expansion.
  function CreationChrome(chrome: { children: import("@solidjs/web").JSX.Element }) {
    return cardAnchor ? <Portal>{chrome.children}</Portal> : <>{chrome.children}</>;
  }
  return (
    <CreationChrome>
    <div class={["modal-overlay", "modal-overlay--composer", { "modal-overlay--simple-composer": simpleLens(),
      "modal-overlay--inline-composer": inlineCard() }]} onClick={(e) => { if (e.target === e.currentTarget) close(); }}>
      <div ref={element => { creationCard = element; }} class={["modal-box", "home-composer-modal", {
        "home-composer-modal--simple": simpleLens(), "home-composer-modal--inline": inlineCard(),
      }]} role="dialog" aria-modal={inlineCard() ? undefined : "true"} tabindex={inlineCard() ? -1 : undefined}
        style={inlineCard() ? { left: `${Math.round(cardPosition().x)}px`, top: `${Math.round(cardPosition().y)}px` } : undefined}
        onKeyDown={event => {
          if (event.defaultPrevented) return;
          if (event.key === "Escape") { event.preventDefault(); event.stopPropagation(); close(); }
          if (event.key === "Enter" && (event.ctrlKey || event.metaKey)) { event.preventDefault(); void save(); }
        }}
        aria-label={simpleTitle() ?? (initialCreation ? "New data" : props.expressionMode ? "New expression" : "New data")}>
        <div class="home-composer-modal__head">
          <div class="home-composer-modal__head-inner">
            <div class="home-composer-modal__head-titles">
              <h3 class="home-composer-modal__title">
                <Show when={simpleTitle()} fallback={initialCreation ? "New data" : props.expressionMode ? "New expression" : "New data"}>
                  New{" "}<span class="home-composer-modal__type-badge"><ValueTypeCaption label={declaredTypeLabel()} icon={declaredTypeIcon()} /></span>
                </Show>
              </h3>
              <Show when={!initialCreation || !!cardAnchor}>
                <button type="button" class="btn home-composer-modal__header-icon" aria-label="Data representations"
                  aria-expanded={identityOpen() ? "true" : "false"} disabled={saving()}
                  data-tooltip={identityOpen() ? "Hide data representations" : "Data representations"}
                  onClick={() => setIdentityOpen(open => !open)}>
                  <IconByName name="palette" size={16} />
                </button>
              </Show>
              <Show when={!initialCreation && !simpleLens()}>
              <div class="home-composer-modal__chips" inert={saving()}>
                {/* Kind chip — small dropdown. Only "value" saves today. */}
                <button
                  type="button"
                  class="home-composer-modal__chip home-composer-modal__chip--editable"
                  disabled={saving()}
                  onClick={() => { setPickingKind(!pickingKind()); setTypePickerOpen(false); }}
                  data-tooltip="Pick what kind of thing to create"
                >
                  <span class="home-composer-modal__chip-label">kind</span>
                  <span class="home-composer-modal__chip-value">{chosenKind() === "value" ? "data" : chosenKind()}</span>
                  <span class="home-composer-modal__chip-caret">▾</span>
                </button>
                {/* Refs summary — only when the draft uses external values. */}
                <Show when={referencedValues().length > 0}>
                  <span
                    class="home-composer-modal__chip home-composer-modal__chip--info"
                    data-tooltip={referencedValues().map((r) => r.name).join("\n")}
                  >
                    <span class="home-composer-modal__chip-label">refs</span>
                    <span class="home-composer-modal__chip-value">
                      {referencedValues().length} external value{referencedValues().length === 1 ? "" : "s"}
                    </span>
                  </span>
                </Show>
              </div>
              </Show>
            </div>
            <div class="home-composer-modal__head-actions">
              <Show when={simpleAvailable() || !!cardAnchor}>
                <button type="button" class="btn home-composer-modal__header-icon" aria-pressed={cardAnchor ? cardExpanded() ? "true" : "false" : simpleLens() ? "false" : "true"}
                  aria-label={inlineCard() || simpleLens() ? "Advanced" : "Simple form"} disabled={saving()}
                  onClick={toggleComposerPresentation}
                  data-tooltip={inlineCard() || simpleLens() ? "Expand to the full expression editor" : cardAnchor ? "Back to the card beside this data" : "Back to the simple form"}>
                  <Show when={inlineCard() || simpleLens()} fallback={<IconByName name="minimize" size={16} />}><span aria-hidden="true">⤢</span></Show>
                </button>
              </Show>
            </div>
            <button type="button" class="btn home-composer-modal__head-close"
              aria-label={initialCreation ? "Close new data" : "Close"} data-tooltip="Close" onClick={close}>
              <span aria-hidden="true"><IconByName name="x" size={16} /></span>
            </button>
          </div>
        </div>

        <fieldset disabled={saving()} inert={saving()} style="border: 0; min-width: 0; display: contents;">
        <Show when={!initialCreation && pickingKind()}>
          <div class="home-composer-modal__chip-picker home-composer-modal__chip-picker--small">
            <For each={KIND_OPTIONS}>
              {(k) => (
                <button
                  type="button"

                  class={["home-composer-modal__kind-option", { "home-composer-modal__kind-option--active": !!(chosenKind() === k.id) }]}
                  onClick={() => {
                    if (saveInFlight) return;
                    if (k.id === "value") {
                      setChosenKind(k.id);
                      setPickingKind(false);
                      return;
                    }
                    if (props.onSwitchKind) {
                      dismissed = true;
                      props.onSwitchKind(k.id);
                    }
                  }}
                  data-tooltip={k.title}
                >
                  <span class="mono" style="font-weight: 600">{k.label}</span>
                </button>
              )}
            </For>
          </div>
        </Show>

        <Show when={!initialCreation || !!cardAnchor}>
        <div class="home-composer-modal__representations" hidden={!identityOpen()} inert={!identityOpen() || saving()}>
        <ComposerIdentityRow title="Label" placeholder="Untitled data" value={name()} hideHeading
          onInput={value => setRepMethod("Labelable", "label", value)}
          icon={icon()} iconOptions={iconOptions()} onIcon={value => setRepMethod("Iconable", "icon", value)}
          iconPickerOpen={iconPickerOpen()} onIconPickerOpenChange={open => { setIconPickerOpen(open); setPickingKind(false); }}
          onAllRepresentations={() => { setIconPickerOpen(false); setRepresentationsOpen(true); }} />
        </div>

        <Show when={referencedValues().length > 0 && !simpleLens()}>
          <div class="home-composer-modal__refs-summary">
            <span class="text-muted" style="font-size: 0.72rem">Referenced data:</span>
            <For each={referencedValues()}>
              {(r) => (
                <span class="home-composer-modal__ref-pill mono" data-tooltip={r.id}>
                  → {r.name}
                </span>
              )}
            </For>
          </div>
        </Show>

        </Show>

        <Show when={initialCreation && (!inlineCard() || !destination())}>
          <section class="home-composer-modal__scope">
            <h4 class="home-composer-modal__section-title" style="margin: 0 0 .5rem">Scope</h4>
            <button type="button" class="btn" aria-label="Change creation scope"
              disabled={saving() || !!createdValueId}
              onClick={() => openCreationScope()}>
              Browse scopes
            </button>
            <CreationScopePath place={destination()?.place ?? { accountId: "", sourceId: "local", accountLabel: "Local",
              kind: "root", rootId: "", revision: 0, listName: "All data" }}
              viewName={id => destination()?.names?.viewName(id) ?? (destination()?.place.listId === id ? destination()?.place.listName : undefined)}
              itemName={(_viewId, itemId) => {
                const here = destination()?.place.scope;
                return destination()?.names?.itemName(_viewId, itemId) ?? (here?.kind === "value" && here.itemId === itemId && here.path.length === 0 ? destination()?.place.listName : undefined);
              }} onNavigate={openCreationScope} />
            <Show when={preparingScope()}><CardLoadingIndicator label="Preparing this scope…" /></Show>
            <Show when={!destination() && !preparingScope()}><p class="text-muted" style="font-size: .8rem; margin: .5rem 0 0">
              This location cannot contain new data. Create it in Local, or choose another scope.
            </p></Show>
          </section>
        </Show>
        <div class="home-composer-modal__body">
          <section class="home-composer-modal__main">
            <Show when={composerStep() === "type"} fallback={
              <div class="home-composer-modal__expression-step">
                <Show when={!simpleLens()}>
                <section class="home-composer-modal__type" aria-label="Type">
                  <h4 class="home-composer-modal__section-title">Type</h4>
                  <TypeContract declared={declaredTypeLabel()} declaredIcon={declaredTypeIcon()} declaredDescription={declaredTypeDescription()}
                    inferred={inferredType()}
                    note={!declaredTypeLabel() && !inferredType() ? "Auto: inferred from the expression" : undefined}
                    required={destinationElementType() ? { label: typePhrase(destinationElementType()!).replace(/^(?:A|An) /, "")
                      || displayTypeLabel(destinationElementType()!), source: destination()?.place.listName } : undefined}
                    onUseInferred={inferredValueType() ? useInferredType : undefined}
                    onRemoveDeclared={pickAutoType} onChooseDeclared={saving() ? undefined : showTypeStep} />
                </section>
                <div class="home-composer-modal__expr-head">
                  <h4 class="home-composer-modal__section-title">Expression</h4>
                  <Show when={props.evaluateOnRequest}><button type="button" class="btn"
                    onClick={previewDraft}>Preview</button></Show>
                </div>
                </Show>

                <Show when={!simpleLens() && (evaluated() as any).error}>
                  <div class="data-error" style="margin: 0;">{(evaluated() as any).error}</div>
                </Show>
                <Show when={!simpleLens() && (!initialCreation || authoredDraft()) && draftIssue() && !(evaluated() as any).error && (!props.evaluateOnRequest || previewCurrent())}>
                  <div class="data-error" style="margin: 0;">{draftIssue()}</div>
                </Show>
                <Show when={props.evaluateOnRequest && !previewCurrent()}><p class="text-muted">Fill any empty arguments, then Preview.</p></Show>

                <div class="home-composer-modal__expr" inert={saving() || preparingScope()}>
                  <SavedValuesContext value={savedCtx}>
                  <Show when={initialCreation ? destination()?.reader : undefined} keyed fallback={<Show when={!initialCreation || destination() && !destination()?.reader}>
                  <ComposerExpressionEditor />
                  </Show>}>{runtime => <ReaderRuntimeProvider runtime={runtime}><ComposerExpressionEditor /></ReaderRuntimeProvider>}</Show>
                  </SavedValuesContext>
                </div>

                <Show when={(!initialCreation || !!cardAnchor) && !simpleLens()}><details class="home-composer-modal__trace-details">
                  <summary class="text-muted" style="font-size: 0.75rem; cursor: pointer">Live trace</summary>
                  <ExpressionTrace expr={props.evaluateOnRequest ? undefined : draft()} snapshot={props.evaluateOnRequest ? evaluated() : undefined}
                    viewMode={viewMode()} authoringSession={authoringSession()} />
                </details></Show>
              </div>
            }>
              <div class="home-composer-modal__quickpick">
                <Show when={pickingType()} fallback={
                  <Show
                    when={quickpickParent()}
                    fallback={
                      <>
                        <span class="home-composer-modal__quickpick-label">Pick a type</span>
                        <div class="home-composer-modal__quickpick-category">
                          <span class="home-composer-modal__quickpick-cat-label">Auto</span>
                          <div class="home-composer-modal__quickpick-grid">
                            <QuickTypeChip
                              typeName="Auto"
                              hint="infer from expression"
                              active={!chosenType()}
                              canDrill={false}
                              onSelect={pickAutoType}
                              onDrill={() => {}}
                            />
                          </div>
                        </div>
                        <For each={QUICK_TYPE_CATEGORIES}>
                          {(cat, i) => (
                            <div

                              class={["home-composer-modal__quickpick-category", { "home-composer-modal__quickpick-category--divided": !!(i() > 0) }]}
                            >
                              <span class="home-composer-modal__quickpick-cat-label">{cat.label}</span>
                              <div class="home-composer-modal__quickpick-grid">
                                <For each={cat.types}>
                                  {(t) => (
                                    <QuickTypeChip
                                      typeName={t.name}
                                      label={t.label}
                                      hint={t.hint}
                                      active={chosenType() === t.name}
                                      canDrill={hasQuickTypeDrill(t.name)}
                                      onSelect={() => pickTopType(t.name)}
                                      onDrill={() => drillQuickType(t.name)}
                                    />
                                  )}
                                </For>
                              </div>
                            </div>
                          )}
                        </For>
                        <button
                          type="button"
                          class="home-composer-modal__quickpick-chip home-composer-modal__quickpick-chip--more home-composer-modal__quickpick-chip--full"
                          onClick={() => { setTypePickerOpen(true); setPickingKind(false); }}
                          data-tooltip="Browse the full type catalog"
                        >
                          <span class="home-composer-modal__quickpick-chip-copy">
                            <span class="home-composer-modal__quickpick-chip-name mono">see more...</span>
                            <span class="home-composer-modal__quickpick-chip-hint text-muted">browse all types</span>
                          </span>
                        </button>
                      </>
                    }
                  >
                    {(parent) => (
                      <>
                        <button
                          type="button"
                          class="home-composer-modal__quickpick-back"
                          onClick={() => setQuickpickParent(null)}
                          data-tooltip="Back to top types"
                        >
                          <span class="home-composer-modal__quickpick-back-arrow">←</span>
                          <span class="home-composer-modal__quickpick-back-label">{parent()}</span>
                          <span class="text-muted home-composer-modal__quickpick-back-hint">refine</span>
                        </button>
                        <div class="home-composer-modal__quickpick-grid">
                          <For each={QUICK_TYPE_SUBTYPES[parent()] ?? [{ name: parent(), label: undefined, hint: "" }]}>
                            {(t) => (
                              <QuickTypeChip
                                typeName={t.name}
                                label={t.label}
                                hint={t.hint}
                                active={chosenType() === t.name}
                                canDrill={t.name !== parent() && hasQuickTypeDrill(t.name)}
                                onSelect={() => pickSubType(t.name)}
                                onDrill={() => drillQuickType(t.name)}
                              />
                            )}
                          </For>
                          <button
                            type="button"
                            class="home-composer-modal__quickpick-chip home-composer-modal__quickpick-chip--more"
                            onClick={() => { setTypePickerOpen(true); setPickingKind(false); }}
                            data-tooltip="Browse the full type catalog"
                          >
                            <span class="home-composer-modal__quickpick-chip-copy">
                              <span class="home-composer-modal__quickpick-chip-name mono">see more...</span>
                              <span class="home-composer-modal__quickpick-chip-hint text-muted">browse all types</span>
                            </span>
                          </button>
                        </div>
                      </>
                    )}
                  </Show>
                }>
                  <div class="home-composer-modal__rich-type-picker">
                    <Show when={initialCreation ? destination()?.reader : undefined} keyed
                      fallback={<Show when={!initialCreation || destination() && !destination()?.reader}>
                        <ComposerTypePicker />
                      </Show>}>{runtime => <ReaderRuntimeProvider runtime={runtime}><ComposerTypePicker /></ReaderRuntimeProvider>}</Show>
                  </div>
                </Show>
              </div>
            </Show>
          </section>
        </div>

        </fieldset>
        <footer class="home-composer-modal__footer home-composer-modal__footer--create">
          <span class="home-composer-modal__create-status" tabindex="0" aria-label="Creation validation"
            data-tooltip={creationValidationTooltip()} data-tooltip-marks="">
            <button type="button" class="btn home-action-button home-composer-modal__create" disabled={saving() || !creationReady()}
              data-validation-state={creationState()}
              onClick={() => void save()}>
              <MembershipHintsView hints={creationValidationHints()} compact embedded />
              {saving() ? initialCreation || temporaryEdits() ? "Creating…" : "Saving…"
                : initialCreation || temporaryEdits() ? "Create" : "Save & pin"}
            </button>
          </span>
        </footer>
        <Show when={initialCreation && choosingScope()}>
          <MoveValueDialog purpose="create" label="data" value={undefined} environment={authoringSession().environment}
            loadPlaces={creationPlaces} loadChildren={creationChildren} currentPlace={scopeStart() ?? destination()?.place}
            includeAccounts onClose={() => { scopeGeneration++; setPreparingScope(false); setChoosingScope(false); }} onPlace={chooseCreationScope} />
        </Show>
        <Show when={saveError()}>
          <div class="data-error home-composer-modal__save-error" role="alert">{saveError()}</div>
        </Show>

        <Show when={representationsOpen()}>
          <ComposerRepresentationsModal drafts={reps()} saving={saving()}
            onDraftsChange={next => { retainDraft({ reps: next }); setReps(next); }}
            onClose={() => setRepresentationsOpen(false)} />
        </Show>
      </div>
    </div>
    </CreationChrome>
  );
}

/** A new type: the small card beside the clicked card when opened from a
 *  point (`anchor`), else the full modal; "More..." moves the card's draft
 *  into the modal. The picker offers `preferred` types (this list's) first. */
function TypeComposer(props: { anchor?: { x: number; y: number; hint?: PlacementHint }; preferred: () => readonly string[];
  onClose: () => void }) {
  const anchor = untrack(() => props.anchor);
  const draft = createHomeTypeDraft(() => anchor?.hint);
  onSettled(() => () => draft.dispose());
  const [full, setFull] = createSignal(!anchor);
  const [iconPickerOpen, setIconPickerOpen] = createSignal(false);
  const iconOptions = createMemo(() => {
    const current = draft.icon();
    return current && !NEW_VALUE_ICON_OPTIONS.includes(current) ? [current, ...NEW_VALUE_ICON_OPTIONS] : NEW_VALUE_ICON_OPTIONS;
  });
  return (
    <TypePickerPreferredContext value={props.preferred}>
      <Show when={full() || !anchor} fallback={
        <TypeDraftCard draft={draft} x={anchor!.x} y={anchor!.y}
          icon={<ComposerIconPicker icon={draft.icon()} iconOptions={iconOptions()} unsetIcon={TYPE_ICON_FALLBACKS.Type}
            onIcon={value => draft.setReps(current => setRepresentationMethodDraft(current, "Iconable", "icon", value))}
            open={iconPickerOpen()} onOpenChange={setIconPickerOpen} />}
          onNameInput={value => draft.setReps(current => typeDraftWithTypedName(current, value, setLocaleStringMethodDraft))}
          onMore={() => { setIconPickerOpen(false); setFull(true); }}
          onClose={props.onClose} onCreated={props.onClose} />}>
        <NewTypeModal draft={draft} onClose={props.onClose} />
      </Show>
    </TypePickerPreferredContext>
  );
}

// ---------------------------------------------------------------------------
// NewTypeModal — modal version of /app/types/create. Schema fields +
// representations (label/description/icon/…) authored inline so the
// user never leaves the home view. Mirrors NewValueModal's shell.
// ---------------------------------------------------------------------------

function NewTypeModal(props: { draft?: TypeDraft; onClose: () => void }) {
  const { reader, temporaryEdits } = useHomeReader();
  // Opened from the small type card's "More...", the modal shows the card's
  // draft; opened directly, it owns a fresh one.
  const draft = untrack(() => props.draft) ?? createHomeTypeDraft();
  const codeName = draft.codeName;
  const icon = draft.icon;
  const setReps = draft.setReps;
  const reps = draft.reps;
  const saving = draft.saving;
  const checking = draft.checking;
  const saveError = draft.saveError;
  const typeScheme = draft.typeScheme;
  const typeParams = draft.typeParams;
  const typeShape = draft.typeShape;
  const setTypeShape = draft.setTypeShape;
  const setFieldFacets = draft.setFieldFacets;
  const fieldFacets = draft.fieldFacets;
  const fieldResurrections = draft.fieldResurrections;
  const { changeFieldFacet, hydrateFieldFacet, forgetFieldFacet, installTypeScheme, setTypeParams, setGenericIssue, guardTypeShape, changeTypeShape } = draft;
  const iconOptions = createMemo(() => {
    const current = icon();
    return current && !NEW_VALUE_ICON_OPTIONS.includes(current)
      ? [current, ...NEW_VALUE_ICON_OPTIONS]
      : NEW_VALUE_ICON_OPTIONS;
  });
  const [iconPickerOpen, setIconPickerOpen] = createSignal(false);
  const [representationsOpen, setRepresentationsOpen] = createSignal(false);
  // The whole type shape is authored via TypeBuilder — the user can pick any
  // of the engine's 18 type constructors (record / variant / arrow / refined
  // / …), and TypeBuilder recurses for nested fields. The draft (shape, names,
  // facets) and its save are lib/type-draft-save.ts, shared with the small
  // type card: "More..." on the card opens this modal on the same draft.
  const [editorLens, setEditorLens] = createSignal<"simple" | "full">("simple");
  const typeId = () => draft.typeId;
  const ownsDraft = !untrack(() => props.draft);
  onSettled(() => () => { if (ownsDraft) draft.dispose(); });
  function close() { if (ownsDraft) draft.dispose(); props.onClose(); }
  async function save() {
    if (await draft.save()) close();
  }

  return (
    <ModalOverlay class="modal-overlay" onClick={(e) => { if (e.target === e.currentTarget) close(); }}>
      <div class="modal-box home-composer-modal">
        <div class="home-composer-modal__head">
          <div class="home-composer-modal__head-titles">
            <h3 class="home-composer-modal__title">New type</h3>
            <Show when={reader?.kind === "local"}><p class="text-muted" style="font-size: 0.75rem; margin: 0.25rem 0">
              Local · sync or Save keeps data on this device. Unsaved changes are lost on reload or close.
            </p></Show>
            <div class="home-composer-modal__chips">
              <span class="home-composer-modal__chip home-composer-modal__chip--info">
                <span class="home-composer-modal__chip-label">kind</span>
                <span class="home-composer-modal__chip-value">type</span>
              </span>
            </div>
          </div>
          <button type="button" class="btn" onClick={close} style="padding: 0.2rem 0.55rem; font-size: 0.78rem">Close</button>
        </div>

        <fieldset disabled={saving()} inert={saving()} style="border: 0; min-width: 0; display: contents;">
        <ComposerIdentityRow title="Name" placeholder="Person" value={draft.labelName() || codeName()} mono={!draft.labelName()}
          onInput={value => setReps(current => typeDraftWithTypedName(current, value, setLocaleStringMethodDraft))}
          icon={icon()} iconOptions={iconOptions()}
          onIcon={value => setReps(current => setRepresentationMethodDraft(current, "Iconable", "icon", value))}
          iconPickerOpen={iconPickerOpen()} onIconPickerOpenChange={setIconPickerOpen}
          onAllRepresentations={() => { setIconPickerOpen(false); setRepresentationsOpen(true); }} />
        </fieldset>

        <div class="home-composer-modal__body">
          <section class="home-composer-modal__main">
            <fieldset disabled={saving()} inert={saving()} style="border: 0; min-width: 0; display: contents;">
            <LocusSelect label="Editor lens" value={editorLens()}
              options={[{ value: "simple", label: "Simple" }, { value: "full", label: "Full controls" }]}
              onChange={value => setEditorLens(value === "full" ? "full" : "simple")} />
            <FieldAuthoringProvider
              facetsByFieldId={fieldFacets()}
              onFieldFacetsChange={changeFieldFacet}
              onFieldFacetsHydrate={hydrateFieldFacet}
              onFieldFacetsForget={forgetFieldFacet}
              ownerKey={`type:${typeId()}`}
              owner={persistedRootFieldOwner("type", typeId())}
              resurrectFieldIds={fieldResurrections.fieldIds()}
              onFieldResurrectionChange={fieldResurrections.onChange}
            >
              <LambdaFormEditorSurface title={typeParams().length ? "Type generator" : "Type"}
                parameterList={() => <GenericParametersEditor scheme={typeScheme()} onChange={installTypeScheme}
                  presentation={editorLens()} params={typeParams()} onParamsChange={next => setTypeParams(next.map(param =>
                    typeof param === "string" ? { name: param, constraints: [] } : param))}
                  onIssueChange={setGenericIssue} />}
                /* Simple lens: a type without parameters always produces a Type, so the
                   fixed result is shown only in Full controls or for a generator. */
                result={editorLens() === "full" || typeScheme().quantified.length > 0
                  ? () => <TypeContract declared="Type" declaredReadonly="A type definition always produces a Type." />
                  : undefined}
                body={() => <TypeBuilder presentation={editorLens()} value={typeShape()} genericScheme={typeScheme()}
                  beforeChange={guardTypeShape} onChange={changeTypeShape} />}
                details={() => <><RepresentationsPanel mode="draft" drafts={reps()} onDraftsChange={setReps} />
                  <details><summary>Identity</summary><code>{typeId()}</code></details></>} />
            </FieldAuthoringProvider>
            </fieldset>
          </section>
        </div>

        <Show when={saveError()}>
          <div class="data-error" style="margin: 0 1rem">{saveError()}</div>
        </Show>
        <div class="home-composer-modal__foot">
          <button type="button" class="btn" onClick={close}>Cancel</button>
          <button type="button" class="btn btn-primary" disabled={saving()} onClick={() => void save()}>
            {checking() ? "Checking…" : saving() ? temporaryEdits() ? "Creating…" : "Saving…" : temporaryEdits() ? "Create type locally" : "Create type"}
          </button>
        </div>
        <Show when={representationsOpen()}>
          <ComposerRepresentationsModal drafts={reps()} saving={saving()} onDraftsChange={setReps}
            onClose={() => setRepresentationsOpen(false)} />
        </Show>
      </div>
    </ModalOverlay>
  );
}

/** The new-type draft over this Home's reader: the Local worker's shape
 *  reconciliation, the definition save and the add to the list (beside
 *  `hint`'s card when given). One draft serves the type card and the modal. */
function createHomeTypeDraft(hint?: () => PlacementHint | undefined): TypeDraft {
  const { reader, revalidate, saveDefinitionWithRepresentations, addToLocus, assertAppearanceDrafts, homeAuthoringSession } = useHomeReader();
  const locusAdd = useContext(HomeDataContext)?.add ?? addToLocus;
  return createTypeDraft({
    localSignature: reader?.kind === "local" ? hooks => createLocalSignatureGuard({ reader: () => reader,
      session: homeAuthoringSession, via: () => reader.session(), closed: hooks.closed, refuse: hooks.refuse }) : undefined,
    reconcile: (scheme, nextBody) => reconcileAuthoringSchemeBody({ scheme, nextBody, context: homeAuthoringSession().evaluateContext }),
    assertAppearanceDrafts, resurrections: createFieldResurrectionSelection,
    saveDefinition: (bundle, id, representations, canContinue) => saveDefinitionWithRepresentations(bundle, id, representations, canContinue),
    typesChanged: () => { void revalidate("types"); },
    add: async (id, label) => !!await locusAdd({ expr: { kind: "literal", value: locusCatalogReference(id) }, valueType: { $type: true } },
      label, hint?.()),
  });
}

// ---------------------------------------------------------------------------
// NewFunctionModal — canonical function composer. Signature, requirements and
// expression/steps lenses share the universal editors and representation drafts.
// ---------------------------------------------------------------------------

const FN_DEFAULT_BODY: ExprNode = { kind: "literal", value: "" };

function NewFunctionModal(props: { onClose: () => void }) {
  const { reader, api, revalidate, homeAuthoringSession, userFunctions, reloadUserRegistries, accountAuthoringSession, saveDefinitionWithRepresentations, addToLocus, temporaryEdits, assertAppearanceDrafts } = useHomeReader();
  /** B4 fix round 2: this surface's pending nested value checks. */
  const draftScope = {};
  const locusAdd = useContext(HomeDataContext)?.add ?? addToLocus;
  const [fieldFacets, setFieldFacets] = createSignal<FieldFacetDraftMap>({});
  const [authoredFacetRevision, setAuthoredFacetRevision] = createSignal(0);
  const changeFieldFacet = (fieldId: string, next: FieldFacetDraftMap[string]) => {
    setFieldFacets((current) => ({ ...current, [fieldId]: next }));
    setAuthoredFacetRevision((current) => current + 1);
  };
  const hydrateFieldFacet = (fieldId: string, next: FieldFacetDraftMap[string]) => {
    setFieldFacets((current) => Object.prototype.hasOwnProperty.call(current, fieldId)
      ? current
      : { ...current, [fieldId]: next });
  };
  const forgetFieldFacet = (fieldId: string) => {
    setFieldFacets((current) => forgetFieldFacetDrafts(current, fieldId));
  };
  const fieldResurrections = createFieldResurrectionSelection();
  const [reps, setReps] = createSignal<Record<string, Record<string, unknown>>>({});
  // One browser entropy leaf per draft; naming never changes its identity.
  const [functionId] = createSignal(crypto.randomUUID());
  const fnName = () => repString(reps(), "Codeable", "codeName");
  const declarationName = createMemo(() => fnName().trim() || functionId());
  const setFnName = (codeName: string) => setReps(current => ({ ...current,
    Codeable: { ...current.Codeable, codeName } }));
  // Params authored as a $record FenelType so the user gets the same
  // TypeBuilder UX as schema fields. We extract `fields` on submit to
  // populate the function's `params` and feed LambdaParamsContext for
  // the body editor.
  const [paramsType, setParamsType] = createSignal<FenelType>({ $record: { fields: [] } });
  const [returnsType, setReturnsType] = createSignal<FenelType>({ $ref: "String" });
  const [resultMode, setResultMode] = createSignal<"infer" | "explicit">("infer");
  const [editorLens, setEditorLens] = createSignal<"simple" | "full">("simple");
  const [schemeMetadata, setSchemeMetadata] = createSignal<Omit<TypeScheme, "body">>({ quantified: [] });
  const [genericIssue, setGenericIssue] = createSignal<string>();
  const [requires, setRequires] = createSignal<FenelFunction["requires"]>();
  const [body, setBody] = createSignal<ExprNode>(FN_DEFAULT_BODY);
  const [bodyLens, setBodyLens] = createSignal<"expression" | "steps">("expression");
  const [stepsIssue, setStepsIssue] = createSignal<string>();
  let bodyEdited = false;
  const [hasBody, setHasBody] = createSignal(true);
  const activeStepsIssue = createMemo(() => hasBody() && bodyLens() === "steps" ? stepsIssue() : undefined);
  const [saving, setSaving] = createSignal(false);
  const [saveError, setSaveError] = createSignal<string | null>(null);
  let dismissed = false;
  let saveInFlight = false;
  let previewController: AbortController | undefined;
  onSettled(() => () => { dismissed = true; previewController?.abort(); });
  function close() {
    dismissed = true;
    previewController?.abort();
    props.onClose();
  }

  const authoredDraft = createMemo(() => ({ body: body(), params: paramsType(), returns: returnsType(),
    resultMode: resultMode(), metadata: schemeMetadata(), genericIssue: genericIssue(), requires: requires(), hasBody: hasBody(),
    representations: reps(), facetRevision: authoredFacetRevision(), resurrectFieldIds: fieldResurrections.fieldIds() }));
  const authoredSubmission = createMemo(() => ({ ...authoredDraft(), stepsIssue: activeStepsIssue() }));
  createEffect(authoredSubmission, () => { setSaveError(null); }, { defer: true });
  const captureNewFunctionRequirementsTarget: CaptureTypePickerTarget = () => latest(() => {
    const available = () => !dismissed && !saveInFlight && !saving();
    if (!available()) return undefined;
    const id = functionId(), submitted = authoredSubmission();
    const revision = draftValueFingerprint(submitted), epoch = sessionEpoch();
    const currentSession = () => concreteAuthoringSession(newFunctionAuthoringSession() ?? homeAuthoringSession());
    const concrete = currentSession();
    return () => latest(() => available() && id === functionId() && submitted === authoredSubmission()
      && revision === draftValueFingerprint(authoredSubmission()) && epoch === sessionEpoch() && concrete === currentSession());
  });

  // The outer record is locked; each parameter still authors any Fenel type.
  const paramFields = createMemo<FieldDef[]>(() => {
    const t = paramsType();
    if (t && typeof t === "object" && "$record" in t) {
      return (t as { $record: { fields?: FieldDef[] } }).$record.fields ?? [];
    }
    return [];
  });

  const ownedScheme = createMemo<TypeScheme>(() => ({ ...schemeMetadata(),
    body: { $arrow: { params: paramFields(), returns: returnsType() } } }));
  let approvedParameterFields: FieldDef[] | undefined;
  /** B4 wave 4 lane H: the parameter rows the body is reconciled with (a
   * Local name edit is shown at once; its body reconciliation follows). */
  let reconciledParameterFields: FieldDef[] = untrack(paramFields);
  function installOwnedScheme(scheme: TypeScheme) {
    if (!("$arrow" in scheme.body)) { setSaveError("The function signature needs an arrow type."); return; }
    const { body: arrowType, ...metadata } = scheme;
    setSchemeMetadata(metadata);
    setParamsType({ $record: { fields: arrowType.$arrow.params } });
    setReturnsType(arrowType.$arrow.returns);
    reconciledParameterFields = arrowType.$arrow.params;
  }
  function editGenericDeclaration(edit: AuthoringGenericEdit) {
    const result = editAuthoringGenericDeclaration({ scheme: ownedScheme(),
      ...(hasBody() ? { body: body() } : {}), requires: requires() }, edit);
    if (!result.ok) { setGenericIssue(result.message); return result; }
    installOwnedScheme(result.value.scheme);
    if (result.value.body !== undefined) setBody(result.value.body);
    setRequires(result.value.requires);
    setGenericIssue(undefined);
    return { ok: true as const };
  }
  let approvedReturnScheme: TypeScheme | undefined;
  // B4 wave 4 lane H: a Local reader reconciles these guards in its worker,
  // in the new function's own frame (held type edits, followed name edits).
  const localSignature = reader?.kind === "local" ? createLocalSignatureGuard({ reader: () => reader,
    session: homeAuthoringSession, via: () => newFunctionAuthoringSession(), closed: () => dismissed,
    refuse: message => setSaveError(message) }) : undefined;
  function guardReturnType(next: FenelType) {
    if (localSignature) {
      // On the rows the body is reconciled with; a name edit that is still
      // unreconciled stays shown (and still follows) after it applies.
      localSignature.hold({ base: () => [returnsType(), schemeMetadata()], state: () => [paramsType(), body()],
        edit: () => ({ kind: "scheme", scheme: { ...schemeMetadata(), body: { $arrow: { params: reconciledParameterFields, returns: returnsType() } } },
          nextBody: { $arrow: { params: reconciledParameterFields, returns: next } } }),
        apply: reconciled => {
          const shown = paramFields(), consistent = reconciledParameterFields;
          approvedReturnScheme = reconciled.scheme; changeReturnType(next); setResultMode("explicit");
          if (shown !== consistent) { const installed = reconciledParameterFields; setParamsType({ $record: { fields: shown } }); reconciledParameterFields = installed; }
        } });
      return false;
    }
    const result = reconcileAuthoringSchemeBody({ scheme: ownedScheme(),
      context: (newFunctionAuthoringSession() ?? homeAuthoringSession()).evaluateContext,
      nextBody: { $arrow: { params: paramFields(), returns: next } } });
    if (!result.ok) { setSaveError(result.message); return false; }
    approvedReturnScheme = result.scheme;
    setSaveError(null);
    return true;
  }
  function changeReturnType(next: FenelType) {
    if (!approvedReturnScheme && !guardReturnType(next)) return;
    const approved = approvedReturnScheme!;
    approvedReturnScheme = undefined;
    if (!("$arrow" in approved.body)) { setSaveError("The function signature needs an arrow type."); return; }
    installOwnedScheme(approved);
    if (!bodyEdited) {
      // B4 wave 4 lane H: a Local session's published structure environment (its seeds).
      const session = newFunctionAuthoringSession() ?? homeAuthoringSession();
      const environment = reader?.kind === "local" ? authoringStructureEnvironment(session) : session.environment;
      setBody(seedExpressionForType(approved.body.$arrow.returns, environment));
    }
  }
  const declaration = createMemo(() => buildAuthoringSignatureDeclaration({
    functionId: functionId(), declarationName: declarationName(),
    codeName: declarationName(), ownerModule: `authoring-${functionId()}`,
    parameterCount: paramFields().length, inferResult: hasBody() && resultMode() === "infer",
    scheme: ownedScheme(),
  }));
  function guardParameterFields(next: readonly FieldDef[]) {
    if (localSignature) {
      const rows = [...next];
      if (parameterTextEdit(paramFields(), rows)) {
        // Applied at once (TypeBuilder's own change); the body follows.
        localSignature.follow({ base: () => [], state: () => [paramsType(), returnsType(), schemeMetadata(), body()],
          edit: () => {
            const reconciled = reconciledParameterFields, current = paramFields();
            if (draftValueFingerprint(reconciled) === draftValueFingerprint(current)) return undefined;
            return { kind: "binding-rows", draft: { params: reconciled, body: body(), returns: returnsType() }, next: current,
              scheme: { ...schemeMetadata(), body: { $arrow: { params: reconciled, returns: returnsType() } } } };
          },
          apply: reconciled => { setBody(reconciled.binding!.body); installOwnedScheme(reconciled.scheme); } });
        return true;
      }
      // From the rows the body is reconciled with, so a name edit still
      // following is reconciled by this edit too.
      localSignature.hold({ base: () => [paramsType(), returnsType(), schemeMetadata()], state: () => [body()],
        edit: () => ({ kind: "binding-rows", draft: { params: reconciledParameterFields, body: body(), returns: returnsType() }, next: rows,
          scheme: { ...schemeMetadata(), body: { $arrow: { params: reconciledParameterFields, returns: returnsType() } } } }),
        apply: reconciled => { setBody(reconciled.binding!.body); installOwnedScheme(reconciled.scheme); } });
      return false;
    }
    const session = newFunctionAuthoringSession() ?? homeAuthoringSession();
    const result = reconcileAuthoringBindingRows({ params: paramFields(), body: body(),
      returns: returnsType() }, [...next], session.evaluateContext);
    if (!result.ok) { setSaveError(result.diagnostics[0]?.message ?? "Resolve the parameter's uses before changing it."); return false; }
    const reconciled = reconcileAuthoringSchemeBody({ scheme: ownedScheme(), context: session.evaluateContext,
      nextBody: { $arrow: { params: [...result.value.params], returns: result.value.returns } } });
    if (!reconciled.ok) { setSaveError(reconciled.message); return false; }
    approvedParameterFields = [...result.value.params];
    setBody(result.value.body);
    installOwnedScheme(reconciled.scheme);
    setSaveError(null);
    return true;
  }

  // In-scope params for ExpressionEditor's "param" picker — same shape
  // as a lambda binding. Filtered to fields with a non-empty name.
  const lambdaParams = createMemo<LambdaParam[]>(() =>
    paramFields()
      .filter((f) => typeof f.name === "string" && f.name.trim() !== "" && f.name !== "_")
      .map((f) => ({ ...f, scheme: projectAuthoringScheme(ownedScheme(),
        ["$arrow", "params", String(paramFields().indexOf(f)), "type"]) })),
  );

  const newFunctionDefinition = createMemo(() => {
    const id = functionId();
    return id.length === 0
      ? undefined
      : {
          id,
          params: paramFields(),
          returns: returnsType(),
          signatureDeclaration: declaration(),
          ...(requires() === undefined ? {} : { requires: requires() }),
        } satisfies FenelFunction;
  });
  const stepsOrigin = createMemo(() => ({ body: body(), definition: newFunctionDefinition(), hasBody: hasBody() }));
  const newFunctionAuthoringSession = createMemo(() => {
    const draft = newFunctionDefinition();
    if (reader?.kind === "local") return draft ? reader.draftSession(draft) : reader.session();
    const current = subject();
    const accountId = reader?.accountId ?? (current?.$tag === "User" || current?.$tag === "Bot" ? current.accountId : undefined);
    if (!accountId) return undefined;
    return accountAuthoringSession({
      accountId,
      functions: userFunctions(),
      ...(draft === undefined ? {} : { draft }),
    });
  });

  // B4 unit D item 2: a Local reader's Steps view lowers the body in its
  // worker, in the new function's own frame (guidance class: a display read),
  // and raises each Steps edit there (weight 0). An edit shows at once; edits
  // made while one is answered wait and the latest is sent next, never
  // dropped; Save refuses while an edit is being applied.
  const localStepsLowered = reader?.kind === "local" ? createLocalReaderAnswer(() => reader, homeAuthoringSession,
    () => bodyLens() === "steps" && hasBody() ? { method: "lower-reader-expression" as const, node: body(), savedExpressions: [],
      unresolved: true as const, priority: "guidance" as const } : undefined,
    readActionResult<{ logic: unknown; emptySlot: boolean }>("lowered", value => !!value && typeof value === "object"),
    { via: () => newFunctionAuthoringSession() }) : undefined;
  /** The Steps logic last edited, and (once raised) the body it became: shown
   * only while it is being raised or while the body is still that body. */
  const [localStepsShown, setLocalStepsShown] = createSignal<{ logic: unknown; body?: ExprNode }>();
  const [localStepsPending, setLocalStepsPending] = createSignal(false);
  const [localStepsIssue, setLocalStepsIssue] = createSignal<string>();
  type LocalStepsEdit = { logic: unknown; origin: ReturnType<typeof stepsOrigin> };
  let queuedSteps: LocalStepsEdit | undefined;
  /** A Steps edit the worker refused: shown with its message and Retry. */
  let failedSteps: LocalStepsEdit | undefined;
  let stepsRaising = false;
  function retryLocalSteps() {
    const failed = failedSteps;
    if (failed && failed.origin === latest(stepsOrigin)) void retryFunctionTools(() => {
      if (failedSteps === failed && failed.origin === latest(stepsOrigin)) raiseLocalSteps(failed.logic);
    });
  }
  function raiseLocalSteps(next: unknown) {
    failedSteps = undefined;
    queuedSteps = { logic: next, origin: latest(stepsOrigin) };
    setLocalStepsShown({ logic: next }); setLocalStepsPending(true); setLocalStepsIssue(undefined);
    void drainLocalSteps();
  }
  async function drainLocalSteps() {
    if (stepsRaising || !reader) return;
    stepsRaising = true;
    let failed = false;
    try {
      while (queuedSteps && !dismissed) {
        const { logic, origin: submitted } = queuedSteps;
        queuedSteps = undefined;
        // The body and definition this Steps edit was made on; a newer
        // authoring input wins, while presentation-only edits commute.
        if (latest(stepsOrigin) !== submitted) { setLocalStepsShown(undefined); continue; }
        try {
          // Only the new function's own frame raises its body; never the reader's.
          const target = newFunctionAuthoringSession();
          if (!target) throw new Error(LOCAL_SAVE_TOOLS_PENDING);
          const node = await runLocalReaderAction(reader, homeAuthoringSession, { method: "raise-reader-logic", logic,
            params: lambdaParams().map((param) => param.name) }, raisedNode, { via: target });
          if (dismissed) return;
          if (latest(stepsOrigin) !== submitted) {
            if (currentQueuedSteps()) continue;
            queuedSteps = undefined; setLocalStepsShown(undefined); break;
          }
          if (!queuedSteps) { bodyEdited = true; setBody(node); setLocalStepsShown({ logic, body: node }); }
        } catch (error) {
          if (dismissed) return;
          if (latest(stepsOrigin) !== submitted) {
            if (currentQueuedSteps()) continue;
            queuedSteps = undefined; setLocalStepsShown(undefined); break;
          }
          // Settled: the edit is not applied. The Steps view shows the body
          // again, the message offers Retry, and nothing is pending (Save
          // saves the body as shown); a newer edit replaces the refused one.
          if (queuedSteps) continue;
          failed = true;
          failedSteps = { logic, origin: submitted };
          setLocalStepsShown(undefined);
          setLocalStepsIssue(error instanceof Error ? error.message : String(error));
          break;
        }
      }
    } finally {
      stepsRaising = false;
      if (failed || !queuedSteps) setLocalStepsPending(false);
    }
  }
  function currentQueuedSteps() {
    return queuedSteps !== undefined && queuedSteps.origin === latest(stepsOrigin);
  }
  const stepsBody = createMemo((): { body: FenelFunction["body"] | undefined; error: string | undefined; pending?: boolean;
    retry?: () => void } => {
    if (localStepsLowered) {
      const shown = localStepsShown();
      if (shown && localStepsPending()) return { body: shown.logic as FenelFunction["body"], error: undefined };
      const failure = localStepsLowered.failure();
      if (failure) {
        const capture = localGuidanceCapture(reader, homeAuthoringSession);
        return { body: undefined, error: failure, retry: () => {
          void retryFunctionTools(() => {
            if (capture && localGuidanceCurrent(capture, reader, homeAuthoringSession)
              && localStepsLowered.failure() === failure) localStepsLowered.retry();
          });
        } };
      }
      const lowered = localStepsLowered.answer();
      if (!lowered) return shown && shown.body === body() ? { body: shown.logic as FenelFunction["body"], error: undefined }
        : { body: undefined, error: undefined, pending: true };
      return lowered.$tag === "Err" ? { body: undefined, error: lowered._0 }
        : { body: lowered._0.logic as FenelFunction["body"], error: undefined };
    }
    try {
      return { body: toLogic(body(), undefined, newFunctionAuthoringSession() ?? homeAuthoringSession()) as FenelFunction["body"], error: undefined };
    } catch (error) {
      return { body: undefined, error: error instanceof Error ? error.message : String(error) };
    }
  });
  const composerSession = reactiveAuthoringSession(() => newFunctionAuthoringSession() ?? homeAuthoringSession());
  type LocalFunctionPreviewRequest = {
    session: AuthoringSession; base: AuthoringSession; handle: PreparedReaderWorker; worker: object;
    epoch: number; revision: number; controller: AbortController;
    sourceMetadata: ReturnType<typeof captureReaderSourceMetadata>;
  };
  type LocalFunctionPreviewJob = { request: LocalFunctionPreviewRequest; promise: Promise<AuthoringFunctionDraftInference>;
    /** B4 unit D item 2: the body the worker lowered and checked for this request. */
    body: Promise<unknown> } | { error: string };
  const localFunctionPreviewWorker = createMemo(() => reader?.kind === "local" && hasBody()
    ? authoringWorkerSnapshot(newFunctionAuthoringSession() ?? homeAuthoringSession()) : undefined);
  const localFunctionPreviewBaseHandle = createMemo(() => {
    if (reader?.kind !== "local" || !hasBody()) return undefined;
    try { return preparedReaderWorkerForSession(concreteAuthoringSession(reader.session())); }
    catch { return undefined; }
  });
  const localFunctionPreviewContext = createMemo<Pick<LocalFunctionPreviewRequest, "session" | "base" | "handle" | "worker"> | { error: string } | undefined>(() => {
    if (reader?.kind !== "local" || !hasBody()) return undefined;
    try {
      const facade = newFunctionAuthoringSession();
      if (!facade) throw new Error("Wait for this function's authoring tools before saving.");
      const session = concreteAuthoringSession(facade);
      const base = concreteAuthoringSession(reader.session());
      const worker = localFunctionPreviewWorker();
      const baseHandle = localFunctionPreviewBaseHandle();
      const scope = localAuthoringScopeForSession(session);
      const handle = baseHandle && scope ? scopePreparedReaderWorker(baseHandle, scope) : undefined;
      if (!handle || !worker) throw new Error("This reader's editing tools are not ready. Try again after preparation.");
      return { session, base, handle, worker };
    } catch (error) { return { error: error instanceof Error ? error.message : String(error) }; }
  });
  // Keep the existing inline pending owner: a previous inferred return is not
  // evidence for a newer body, signature or reader.
  const localFunctionPreviewJob = createMemo<LocalFunctionPreviewJob | undefined>(() => {
    previewController?.abort();
    previewController = undefined;
    const context = localFunctionPreviewContext();
    if (!context || "error" in context) return context;
    try {
      if (reader?.kind !== "local") throw new Error("This reader's editing tools are not ready. Try again after preparation.");
      const { session, base, handle, worker } = context;
      const controller = new AbortController();
      previewController = controller;
      const request: LocalFunctionPreviewRequest = { session, base, handle, worker, controller,
        epoch: sessionEpoch(), revision: reader.revision(), sourceMetadata: captureReaderSourceMetadata(homeAuthoringSession()) };
      // B4 unit D item 2: the worker lowers the draft body in this function's
      // frame (the page's codec adapter and refusal) and checks it in the
      // same request; its reply carries the lowered body Save persists.
      const fn: FenelFunction = { id: functionId(), params: paramFields(), returns: returnsType(),
        ...(requires() === undefined ? {} : { requires: requires() }), signatureDeclaration: declaration() };
      const reply = (runPreparedReaderWorker(handle, { method: "infer-function-draft", fn, declaration: declaration(),
        lowerBody: { node: body(), refusal: "Use a parameter for saved data in a function body." } },
        controller.signal) as Promise<AuthoringFunctionDraftInference>).then(result => {
        assertLocalFunctionPreview(request);
        return result;
      });
      const split = splitLoweredFunctionDraft(reply);
      return { request, promise: split.promise, body: split.body };
    } catch (error) {
      return { error: error instanceof Error ? error.message : String(error) };
    }
  });
  function assertLocalFunctionPreview(request: LocalFunctionPreviewRequest) {
    return latest(() => {
      assertCurrentSession(request.epoch);
      request.controller.signal.throwIfAborted();
      const current = localFunctionPreviewJob();
      if (dismissed || !current || !("request" in current) || current.request !== request
        || reader?.revision() !== request.revision || concreteAuthoringSession(reader.session()) !== request.base
        || concreteAuthoringSession(newFunctionAuthoringSession() ?? homeAuthoringSession()) !== request.session
        || authoringWorkerSnapshot(request.session) !== request.worker) {
        throw new Error("This function or its reader changed while checking. Your draft is kept here; try again.");
      }
      if (request.sourceMetadata) assertReaderSourceMetadata(request.sourceMetadata, homeAuthoringSession());
    });
  }
  const localFunctionPreview = createAsyncValue(() => {
    const job = localFunctionPreviewJob();
    return job && "request" in job ? job : undefined;
  }, job => job.promise);
  const localFunctionPreviewState = createMemo(() => latest(() => {
    const loading = localFunctionPreview.loading;
    return { loading, result: loading ? undefined : localFunctionPreview(), error: loading ? undefined : localFunctionPreview.error };
  }));
  const functionPreview = createMemo(() => {
    if (!hasBody()) return { result: undefined, error: undefined };
    if (reader?.kind === "local") {
      const job = localFunctionPreviewJob();
      if (job && "error" in job) return { result: undefined, error: job.error };
      const state = localFunctionPreviewState();
      return { pending: state.loading, result: state.result, error: state.error === undefined ? undefined
        : state.error instanceof Error ? state.error.message : String(state.error) };
    }
    const session = newFunctionAuthoringSession() ?? homeAuthoringSession();
    try {
      const fn: FenelFunction = { id: functionId(), params: paramFields(), returns: returnsType(),
        ...(requires() === undefined ? {} : { requires: requires() }), signatureDeclaration: declaration(),
        body: toLogic(body(), () => { throw new Error("Use a parameter for saved data in a function body."); }, session) as FenelFunction["body"] };
      return { result: inferAuthoringFunctionDraft(fn, declaration(), session.environment,
        { registry: session.registry }), error: undefined };
    } catch (error) {
      return { result: undefined, error: error instanceof Error ? error.message : String(error) };
    }
  });
  const inferredPresentation = createMemo(() => functionPreview().result
    ? projectAuthoringInferenceOutcome(functionPreview().result!.outcome) : undefined);
  const resultType = () => resultMode() === "infer" && hasBody()
    ? functionPreview().result?.fn?.returns : returnsType();

  async function retryFunctionTools(retry?: () => void) {
    if (dismissed || reader?.kind !== "local") return;
    const epoch = sessionEpoch(), revision = reader.revision(), submitted = latest(stepsOrigin), job = latest(localFunctionPreviewJob);
    const failed = latest(functionPreview).error !== undefined;
    const restored = await reader.retryPresentation?.();
    if (dismissed || restored !== true || epoch !== sessionEpoch() || reader.revision() !== revision
      || latest(stepsOrigin) !== submitted) return;
    // A restored source publishes a new preview itself. An ordinary request
    // failure keeps its job, so explicitly re-ask that same current draft.
    if (failed && latest(localFunctionPreviewJob) === job) refresh(localFunctionPreviewJob);
    retry?.();
  }

  async function save() {
    let submitted: ReturnType<typeof authoredSubmission> | undefined;
    let started = false;
    try {
      // Event and Promise continuations read the in-flight draft explicitly.
      // Capture its code, metadata and flight together before yielding.
      const intent = latest(() => {
        if (dismissed || saveInFlight || saving()) return undefined;
        submitted = authoredSubmission();
        if (genericIssue()) { setSaveError(genericIssue()!); return undefined; }
        const pendingStepsIssue = activeStepsIssue();
        if (pendingStepsIssue) { setSaveError(pendingStepsIssue); return undefined; }
        // B4 unit D item 2: a Steps edit still being applied is not this body.
        if (localStepsPending()) { setSaveError(LOCAL_SAVE_DRAFT_CHANGED); return undefined; }
        // B4 wave 4 lane H: a signature edit still being reconciled is not this draft.
        if (localSignature?.retry() || localSignature?.pending()) { setSaveError(LOCAL_SAVE_DRAFT_CHANGED); return undefined; }
        const signatureIssue = localSignature?.issue();
        if (signatureIssue) { setSaveError(signatureIssue); return undefined; }
        if (!("$record" in paramsType())) { setSaveError("Function parameters must be a list of named fields."); return undefined; }
        assertAppearanceDrafts(reps());
        const hasFunctionBody = hasBody();
        const sourceNode = hasFunctionBody ? body() : undefined;
        const rootDeclaration = sourceNode ? savedExpressionDeclaration(sourceNode) : undefined;
        const id = functionId();
        return {
          id, hasFunctionBody, mode: resultMode(), session: hasFunctionBody ? newFunctionAuthoringSession() : undefined,
          local: reader?.kind === "local" && hasFunctionBody ? localFunctionPreviewJob() : undefined,
          preview: reader?.kind === "local" ? undefined : functionPreview(),
          node: sourceNode ? cloneDraftValue(sourceNode) : undefined, rootDeclaration,
          fn: cloneDraftValue({ id, params: paramFields(), returns: resultType() ?? returnsType(),
            signatureDeclaration: declaration(), ...(requires() === undefined ? {} : { requires: requires() }) }) as FenelFunction,
          representationDrafts: cloneDraftValue(reps()),
          desiredFacets: desiredFieldFacetValues(fieldFacets()),
          replaceFacetFieldIds: fieldFacetReplacementIds(fieldFacets()),
          resurrectFieldIds: fieldResurrections.fieldIds().length > 0 ? [...fieldResurrections.fieldIds()] : undefined,
          name: fnName().trim(),
        };
      });
      if (!intent) return;
      started = true;
      saveInFlight = true;
      setSaving(true);
      setSaveError(null);
      const { id, fn, local, representationDrafts } = intent;
      let submittedLocalRequest: LocalFunctionPreviewRequest | undefined;
      const assertSubmittedFunction = () => latest(() => {
        if (dismissed) throw new Error("This function editor was closed.");
        if (submittedLocalRequest) assertLocalFunctionPreview(submittedLocalRequest);
        if (authoredSubmission() !== submitted) throw new Error("This function changed while checking. Your draft is kept here; try again.");
        // B4 unit D item 2: a Steps edit still being raised is newer than this Save.
        if (localStepsPending()) throw new Error(LOCAL_SAVE_DRAFT_CHANGED);
        if (localSignature?.pending()) throw new Error(LOCAL_SAVE_DRAFT_CHANGED);
      });
      if (intent.hasFunctionBody) {
        if (reader?.kind === "local" && (!local || !("request" in local))) {
          throw new Error(local && "error" in local ? local.error : "Wait for this function's authoring tools before saving.");
        }
        const preview = local && "request" in local ? { result: await local.promise, error: undefined } : intent.preview!;
        if (dismissed) return;
        if (local && "request" in local) {
          submittedLocalRequest = local.request;
          assertSubmittedFunction();
        }
        if (preview.error) throw new Error(preview.error);
        if (preview.result?.outcome.$tag === "Invalid") throw new Error(preview.result.outcome.diagnostics[0]?.message ?? "Complete the function before saving.");
        if (intent.mode === "infer" && (preview.result?.outcome.$tag !== "Solved" || !preview.result.fn)) {
          throw new Error("Choose a result type to finish this function; its result cannot be inferred yet.");
        }
        if (intent.mode === "infer" && preview.result?.fn) fn.returns = preview.result.fn.returns;
        const session = intent.session;
        if (!session) throw new Error("Wait for this function's authoring tools before saving.");
        const node = intent.node!;
        const rootDeclaration = intent.rootDeclaration;
        // Saving a live reference needs an explicit dependency representation.
        // Reject it here instead of dropping it or silently capturing a snapshot.
        // B4 unit D item 2: a Local body was lowered in the worker for exactly
        // the checked request (its preview refused saved references already).
        fn.body = local && "request" in local ? await local.body as FenelFunction["body"] : toLogic(node, () => {
          throw new Error("References to saved data cannot be saved in a function body yet. Replace the reference with explicit data or a function parameter.");
        }, session) as FenelFunction["body"];
        if (dismissed) return;
        let issue: string | undefined;
        if (local && "request" in local) {
          if (localDraftChecksPending(draftScope, reader)) throw new Error(LOCAL_SAVE_DRAFT_CHANGED);
          const checked = await runPreparedReaderWorker(local.request.handle, { method: "function-body-save-issue", node, definition: fn,
            ...(rootDeclaration ? { rootDeclaration } : {}),
            ...(local.request.sourceMetadata ? { sourceMetadata: local.request.sourceMetadata.packet } : {}) },
          local.request.controller.signal) as AuthoringFunctionBodySaveIssue;
          if (dismissed) return;
          assertSubmittedFunction();
          issue = checked.issue;
        } else issue = functionBodySaveIssue(node, fn, session.environment, {
          registry: session.registry, evaluateContext: session.evaluateContext,
        });
        if (issue) throw new Error(issue);
      }
      const committed = await saveDefinitionWithRepresentations({
        ownerMutations: [{ kind: "upsert", owner: { ownerKey: `function:${id}`, kind: "function", storageName: id, definition: fn } }],
        desiredFacets: intent.desiredFacets,
        replaceFacetFieldIds: intent.replaceFacetFieldIds,
        resurrectFieldIds: intent.resurrectFieldIds,
      }, id, representationDrafts, () => {
        if (dismissed) return false;
        if (submittedLocalRequest || localStepsPending()) assertSubmittedFunction();
        return true;
      }, submittedLocalRequest?.revision);
      if (dismissed) return;
      void revalidate("functions");
      await reloadUserRegistries(committed);
      if (dismissed) return;
      const added = await locusAdd({ expr: { kind: "literal", value: locusCatalogReference(id) } },
        repString(representationDrafts, "Labelable", "label") || intent.name || undefined);
      if (dismissed) return;
      if (!added) throw new Error("The function was saved, but could not be added here. Retry to add the same function.");
      close();
    } catch (e: any) {
      if (latest(() => !dismissed && authoredSubmission() === submitted)) setSaveError(e?.message ?? String(e));
    } finally {
      if (started) saveInFlight = false;
      if (started && !dismissed) setSaving(false);
    }
  }

  return (
    <ModalOverlay class="modal-overlay" onClick={(e) => { if (e.target === e.currentTarget) close(); }}>
      <div class="modal-box home-composer-modal">
        <div class="home-composer-modal__head">
          <div class="home-composer-modal__head-titles">
            <h3 class="home-composer-modal__title">New function</h3>
            <Show when={reader?.kind === "local"}><p class="text-muted" style="font-size: 0.75rem; margin: 0.25rem 0">
              Local · sync or Save keeps data on this device. Unsaved changes are lost on reload or close.
            </p></Show>
            <div class="home-composer-modal__chips">
              <span class="home-composer-modal__chip home-composer-modal__chip--info">
                <span class="home-composer-modal__chip-label">kind</span>
                <span class="home-composer-modal__chip-value">function</span>
              </span>
              <span class="home-composer-modal__chip home-composer-modal__chip--info">
                <span class="home-composer-modal__chip-label">returns</span>
                <span class="home-composer-modal__chip-value">{resultType() ? displayTypeLabel(resultType()!) : "Not inferred yet"}</span>
              </span>
            </div>
          </div>
          <button type="button" class="btn" onClick={close} style="padding: 0.2rem 0.55rem; font-size: 0.78rem">Close</button>
        </div>

        <div class="home-composer-modal__body">
          <section class="home-composer-modal__main">
            <fieldset disabled={saving()} inert={saving()} style="border: 0; min-width: 0; display: contents;">
            <div style="display: flex; flex-direction: column; gap: 0.25rem">
              <label class="home-composer-modal__field-label">Code name (optional)</label>
              <input
                value={fnName()}
                onInput={(e) => setFnName(e.currentTarget.value)}
                placeholder="greet"
                style="font-family: ui-monospace, monospace; padding: 0.4rem; border: 1px solid #d1d5db; border-radius: 4px; max-width: 320px"
              />
            </div>
            <LocusSelect label="Editor lens" value={editorLens()}
              options={[{ value: "simple", label: "Simple" }, { value: "full", label: "Full controls" }]}
              onChange={value => setEditorLens(value === "full" ? "full" : "simple")} />
            <FieldAuthoringProvider
              facetsByFieldId={fieldFacets()}
              onFieldFacetsChange={changeFieldFacet}
              onFieldFacetsHydrate={hydrateFieldFacet}
              onFieldFacetsForget={forgetFieldFacet}
              ownerKey={functionId() ? `function:${functionId()}` : undefined}
              owner={functionId() ? persistedRootFieldOwner("function", functionId()) : undefined}
              resurrectFieldIds={fieldResurrections.fieldIds()}
              onFieldResurrectionChange={fieldResurrections.onChange}
            >
              <LambdaFormEditorSurface parameterList={() => <>
              <TypeBuilder presentation={editorLens()}
                value={paramsType()}
                genericScheme={ownedScheme()}
                onChange={next => {
                  const approved = approvedParameterFields;
                  approvedParameterFields = undefined;
                  setParamsType(approved ? { $record: { fields: approved } } : next);
                }}
                beforeFieldsChange={guardParameterFields}
                lockKind="record"
                authoringSession={newFunctionAuthoringSession()}
              />
              <details><summary>Type parameters</summary>
                <GenericParametersEditor scheme={ownedScheme()} onChange={installOwnedScheme}
                  onEdit={editGenericDeclaration} onIssueChange={setGenericIssue} />
              </details>
              </>} result={() => <>
              {/* The function's result is one occurrence of the shared type
                  contract: inferred from the body, or declared in the signature. */}
              <TypeContract
                inferred={resultMode() === "infer" && hasBody() && resultType() ? displayTypeLabel(resultType()!) : undefined}
                note={resultMode() === "infer" && hasBody() && !resultType() ? functionPreview().pending ? "Checking result type…"
                  : inferredPresentation()?.label ?? "Complete the body to infer its result." : undefined}
                declared={resultMode() === "explicit" || !hasBody() ? displayTypeLabel(returnsType()) : undefined}
                onUseInferred={resultMode() === "infer" && hasBody() && resultType() ? () => {
                  const inferred = resultType()!;
                  if (!guardReturnType(inferred)) return;
                  changeReturnType(inferred); setResultMode("explicit");
                } : undefined}
                onRemoveDeclared={hasBody() ? () => setResultMode("infer") : undefined}
                editor={() => <TypeBuilder presentation={editorLens()}
                  value={returnsType()}
                  genericScheme={ownedScheme()}
                  authoringSession={newFunctionAuthoringSession()}
                  beforeChange={guardReturnType} onChange={next => { changeReturnType(next); setResultMode("explicit"); }}
                />} />
              <Show when={functionPreview().error}>{error => reader?.kind === "local"
                ? <ValueFailure message={error()} retry={() => { void retryFunctionTools(); }} />
                : <p class="data-error">{error()}</p>}</Show>
              <Show when={functionPreview().result?.outcome.$tag === "Invalid"}>
                <p class="data-error">{functionPreview().result?.outcome.diagnostics?.[0]?.message}</p>
              </Show>
              </>} details={() => <>
              <label class="home-composer-modal__field-label">Requirements</label>
              <ConstraintsEditor value={requires() ?? []} captureTarget={captureNewFunctionRequirementsTarget} disabled={saving()}
                onChange={next => { if (!dismissed && !saveInFlight && !saving()) setRequires(next); }} label="Required interfaces" />
              <RepresentationsPanel mode="draft" drafts={reps()} onDraftsChange={setReps}
                startOpen={["Labelable", "Describable"]} />
              <details><summary>Identity</summary><code>{functionId()}</code></details>
              </>} body={() => <GenericTypeScopeContext value={() => ({ scheme: ownedScheme() })}>
              <div style="display: flex; align-items: center; gap: 0.5rem">
                <label
                  style="font-size: 0.78rem; color: #555; display: flex; align-items: center; gap: 0.3rem; cursor: pointer;"
                  data-tooltip="A definition without a body declares its signature. An implementation must be supplied before it can run."
                >
                  <input type="checkbox" checked={hasBody()} onChange={(e) => setHasBody(e.currentTarget.checked)} />
                  Has a body
                </label>
              </div>
              <Show when={hasBody()}>
                <div class="expr-view-toggle" aria-label="Function body lens">
                  <button type="button" class={["expr-view-toggle__btn", { "expr-view-toggle__btn--active": bodyLens() === "expression" }]}
                    aria-pressed={bodyLens() === "expression" ? "true" : "false"}
                    disabled={localStepsPending()} onClick={() => setBodyLens("expression")}>Expression</button>
                  <button type="button" class={["expr-view-toggle__btn", { "expr-view-toggle__btn--active": bodyLens() === "steps" }]}
                    aria-pressed={bodyLens() === "steps" ? "true" : "false"} onClick={() => setBodyLens("steps")}>Steps</button>
                </div>
                <Show when={bodyLens() === "steps"} fallback={
                  <LambdaParamsContext value={lambdaParams}>
                    <ExpressionEditor draftCheckScope={draftScope}
                      expr={body()}
                      onChange={(next) => { bodyEdited = true; setBody(next); }}
                      fieldDef={resultMode() === "explicit" ? { name: "result", type: returnsType(), label: Nothing, ui: Nothing, meta: {} } : undefined}
                      expectedScheme={resultMode() === "explicit" ? projectAuthoringScheme(ownedScheme(), ["$arrow", "returns"]) : undefined}
                      hideLabel
                      requirementSource="the function's result type"
                      authoringSession={newFunctionAuthoringSession()}
                    />
                  </LambdaParamsContext>
                }>
                  <AuthoringSessionContext value={composerSession}>
                    <Show when={localStepsIssue() && failedSteps?.origin === stepsOrigin() ? localStepsIssue() : undefined}>
                      {issue => <ValueFailure message={issue()} retry={retryLocalSteps} />}
                    </Show>
                    <Show when={!stepsBody().error} fallback={stepsBody().retry
                      ? <ValueFailure message={stepsBody().error} retry={stepsBody().retry} /> : <p class="data-error">{stepsBody().error}</p>}>
                    <Show when={!stepsBody().pending}>
                    <StepsEditor
                      body={stepsBody().body}
                      params={paramFields()}
                      name={fnName()}
                      onIssueChange={(issue) => { setStepsIssue(issue); }}
                      onChange={(next) => {
                        if (localStepsLowered) { raiseLocalSteps(next); return; }
                        bodyEdited = true;
                        setBody(logicToExprNode(next, lambdaParams().map((param) => param.name), newFunctionAuthoringSession() ?? homeAuthoringSession()));
                      }}
                    />
                    </Show>
                    </Show>
                  </AuthoringSessionContext>
                </Show>
              </Show>
              </GenericTypeScopeContext>} />
            </FieldAuthoringProvider>
            </fieldset>
          </section>
        </div>

        <Show when={saveError()}>
          <div class="data-error" style="margin: 0 1rem">{saveError()}</div>
        </Show>
        <div class="home-composer-modal__foot">
          <button type="button" class="btn" onClick={close}>Cancel</button>
          <button type="button" class="btn btn-primary" disabled={saving()} onClick={() => void save()}>
            {saving() ? temporaryEdits() ? "Creating…" : "Saving…" : temporaryEdits() ? "Create function locally" : "Create function"}
          </button>
        </div>
      </div>
    </ModalOverlay>
  );
}

/** Insert `child` into the children of the tree node identified by
 *  `parentId`. Returns a new TreeView; original is untouched. If the
 *  parent isn't found, the child is appended at the root level. */

/** Recursively update a matching item in any layout view (incl. tree
 *  children). Returns a fresh view; original is untouched. */
function updateItemInView(
  view: AnyView,
  id: string,
  mapper: (it: LayoutItem) => LayoutItem,
): AnyView {
  if (view.kind === "tree") {
    const walk = (items: TreeItem[]): TreeItem[] =>
      items.map((it) => {
        if (it.id === id) return { ...mapper(it) } as TreeItem;
        if (it.children?.length) return { ...it, children: walk(it.children) };
        return it;
      });
    return { ...view, items: walk(view.items) };
  }
  return {
    ...view,
    items: view.items.map((it) => (it.id === id ? mapper(it) : it)),
  } as AnyView;
}

function findLocusItem(items: readonly LayoutItem[], id: string): LayoutItem | undefined {
  for (const item of items) {
    if (item.id === id) return item;
    const child = findLocusItem((item as TreeItem).children ?? [], id);
    if (child) return child;
  }
  return undefined;
}

function removeLocusItem(view: AnyView, id: string): AnyView {
  const remove = (items: TreeItem[]): TreeItem[] => items
    .filter((item) => item.id !== id)
    .map((item) => item.children ? { ...item, children: remove(item.children) } : item);
  const items = remove(view.items);
  return view.kind === "tabs" && view.activeId === id
    ? { ...view, items, activeId: items[0]?.id } : { ...view, items };
}

function EmptyState(props: { message: string }) {
  return (
    <div class="home-canvas__empty" style="position: static; height: 60vh">
      {props.message}
    </div>
  );
}


// ---------------------------------------------------------------------------
// Helper exposed to the rest of the app for the "add to the data set in scope"
// action. It was called "pin to home"; nothing is pinned, because nothing was
// hidden -- see `~/lib/add-to-locus`.
// Imports `import { addToLocus } from "~/routes/app/home"`. Appends
// an item with default centered position to the active home view.
// ---------------------------------------------------------------------------

/** Optional position hint passed to addToLocus — when set, overrides
 *  the layout's default-position rule so per-renderer drop handlers
 *  can land items exactly where the cursor was. */

/** Pin a value to the active home. Two forms:
 *   - `{ expr }` — inline expression (one-off)
 *   - `{ savedExprId }` — reference to a savedQueries row; the home re-
 *     resolves on every render so edits propagate.
 *  Caption is optional; falls back to "" in the item header.
 *  Hint is optional; precision drop handlers pass it to land items at
 *  the exact cursor position / cell / parent / coords. */
