import { ExprFieldShell, ExpressionCallSurface, ExpressionCallArgumentRow, ExpressionCodeLensSurface, ExpressionGraphAuthoringContext, ExpressionLensSettingsContext, ExpressionGraphCaptureContext, ExpressionGraphScopeCaptureContext, ExpressionNodeContent, ExpressionReferenceSurface, ExpressionResultBindingDialog, ExpressionDialogContext, isStructuralMode, type Mode, type StructuralMode } from "./expression-surfaces";
export { ExpressionEditor } from "./ExpressionEditor";
import { ExpressionEditor, ExpressionGraphValueContext, ExpressionGraphValuePreview, ExpressionGraphListPreview, ExpressionLiteralSurface, type ExpressionGraphValue, type ExpressionEditorProps, type ExprViewMode, type HeldExpressionPresentation } from "./ExpressionEditor";
export type { ExprViewMode } from "./ExpressionEditor";
import { ModalOverlay } from "~/lib/confirm-modal";
import { reactiveAuthoringSession } from "./authoring-session";

// ---------------------------------------------------------------------------
// ExpressionEditor — interactive composer for Fenel expressions, with
// live trace evaluation.
//
// Each argument slot is one of three modes:
//   - "example" — pick a value from the param type's Exemplifiable list
//   - "literal" — type a value directly (text / number / boolean)
//   - "call"    — nest another function call (recursive ExpressionEditor)
//
// The editor maintains an internal `ExprNode` tree, projects it to a
// JSON-Logic expression on every change, and re-runs it through the
// engine's traced evaluator. The trace is rendered with the same step
// pipeline the storybook uses, so the user sees every intermediate
// value as they compose.
// ---------------------------------------------------------------------------

import { For, Match, Show, Switch, createContext, createEffect, createMemo, createSignal, createUniqueId, onCleanup, useContext, Loading, snapshot, untrack, latest, onSettled } from "solid-js";
import type { JSX } from "@solidjs/web";
import { createAsyncValue } from "~/lib/async-value";
import { createLocusCardEvaluation, readLocusCapturedValue, readLocusCardResult } from "~/lib/locus-card-evaluation";
import { assertReaderSourceMetadata, captureReaderSourceMetadata, type ReaderSourceMetadataCapture } from "~/lib/reader-source-metadata";
import { authoringWorkerSnapshot, evaluateExpressionInWorker, expressionSaveIssueInWorker, inferExpressionsInWorker, preparedSnapshotOwnerOf } from "./authoring-catalog-worker";
import { createLocalExpressionCopy, evaluateLocalExpression } from "./local-editor-reads";
import { publishedAuthoringEnvironment } from "./account-authoring-session";
import { sessionEpoch } from "~/lib/browser-session";
import { createListboxKeys } from "~/lib/listbox-keys";
import { FunctionPickerSurface, type FunctionPickerModel, type FunctionPickerQuery, type FunctionPickerRow, type PickerKindFilter } from "./function-picker-surface";
import {
  getExamples,
  getLabel,
  // Phase 3j (module-substrate) — read-time display label (label → humanized
  // codeName → id) for function pins whose fn declares no explicit @label.
  displayLabel,
  getDescription,
  getCodeName,
  resolveEffect,
  phantomEntityName,
  type FenelFunction,
  type FieldDef,
  type FenelType,
  type TypeScheme,
  type LocaleString,
  type TraceStep,
  List,
} from "@fenel/engine";
import { detectTypeKind, TYPE_KIND_LABELS, peelListForAuthoring as peelList, peelMaybeForAuthoring as peelMaybe } from "@fenel/engine/authoring/type";
import { typeCode, typePhrase } from "@fenel/engine/authoring/expression";
import { authoringBindingNameIssue, editAuthoringBinding, editAuthoringCall, inspectAuthoringExpressionOccurrence, replaceAuthoringExpressionOccurrence, proposeAuthoringResultBinding, selectAuthoringCallCandidates, type AuthoringBindingEdit } from "@fenel/engine/authoring/binding-edits";
import { draftValueFingerprint } from "~/lib/native-draft";
import type { TraceMeta, InferenceOutcome } from "@fenel/engine/types";
import { createDataInspectionSuggestions, type DataInspectionSuggestions } from "../DataInspectionDialog";
import { scopedExpectedType, scopedResultRequirement, type DataSuggestionInput } from "../data-suggestions";
import type { DataOccurrenceSource, DataReadOccurrence } from "../data-occurrence";

import { useApiClient, type ApiClient } from "~/lib/api";
import { useReaderRuntime, type ReaderRuntime } from "~/lib/reader-runtime";
import { typeConstructorOf } from "../../../../../../implementations/typescript/engine/src/effect-dispatch";
import { annotationTypeForEditor, codeLensTextIsReadable } from "./annotation-lens";
import { authoringLogicToExprNode, printAuthoringExpressionText, readAuthoringExpressionText } from "./expression-text";
import { createLocalExpressionPrint, readLocalExpressionText } from "./local-expression-text";
import { canonical } from "@fenel/engine/locale";
import { Just, Nothing, peelMaybeValue, type Maybe } from "@fenel/engine/type-foundation";
import {
  authoringScopeForDoBlock,
  authoringScopeForLetBinding,
  dependentTypeForValuePath,
  inferAuthoringCallGuidance,
  projectAuthoringChildExpectation,
  projectAuthoringScheme,
  expectedSchemeForType,
  judgeAuthoringSchemeCompatibility,
  rankAuthoringFunctionSuggestions,
  refLiteralKind,
  createAuthoringEnvironment,
  type AuthoringCatalogFunctionEntry,
  type AuthoringEnvironment,
  type AuthoringLiteralMembership,
} from "@fenel/engine/authoring/environment";
import { rankSuggestionsForEditor, readWrappingInputInference, yieldToInput } from "./async-suggestions";
import { sessionCatalogSections } from "./authoring-catalog";
import { measureAuthoringWork } from "./performance-diagnostics";
import { judgeAuthoringResult } from "./result-judgment";
import type { ExpressionInferenceItem, ExpressionInferenceReply } from "./authoring-worker-protocol";
import type { LiveGuidance } from "./live-guidance";
import { createGuidanceLane, DraftCheckScopeContext, draftCheckReaderKey, holdDraftCheck, openLiveGuidance, releaseDraftCheck } from "./live-guidance";
/** The existing Local refusal sentence, for a nested check with no job. */
const NESTED_TOOLS_PENDING = "This reader's editing tools are not ready. Try again after preparation.";
import { completeLiveDraft, createLocalLiveGuidance, localGuidanceCapture, localGuidanceCurrent, sameLocalGuidanceCapture } from "./live-guidance-local";
import { WorkerRequestError } from "./authoring-worker-transport";
import {
  AuthoringSessionContext,
  DETACHED_AUTHORING_SESSION,
  useAuthoringSession,
  authoringSessionAccountScope,
  concreteAuthoringSession,
  type AuthoringSession,
} from "./authoring-session";
export {
  AuthoringSessionContext,
  DETACHED_AUTHORING_SESSION,
  accountAuthoringSession,
  authoringSessionForFunction,
  authoringSessionScopeForFunction,
  declaringModuleForFunction,
  moduleAuthoringSession,
  type AccountAuthoringScope,
  type AuthoringSession,
} from "./authoring-session";
import { ValueDisplay } from "~/lib/storybook";
import { constructorExpression, expectedTypeForName, seedExpressionForType, expressionForLiteralValue } from "./creation-seed";
import { SimpleDataForm, useSimpleFormModel } from "./simple-data-form";
import { rootConstructorTag } from "./simple-data-form-model";
import { savedValueMatches, savedValueShownName } from "../locus-expression-sources";
import { draftSaveIssue } from "./creation-validation";
import { authoringExpressionHasEmptySlot } from "@fenel/engine/authoring/signature-authoring";
import { validateBindingName, type NameRole } from "./binding-name";
import { inferScopedAuthoringExpression, literalMembershipFor } from "./literal-membership";
import { inlineWidgetFor } from "./inline-widgets";
import { ImageCanvas } from "./ImageCanvas";
import { isInlineImageValue } from "./image-canvas-data";
import { authoringExpressionLogic, authoringExpressionSites, evaluateAuthoringExpressionInSession } from "./expression-evaluation";
import { ExpressionTransferTarget } from "~/lib/data-transfer/ExpressionTransferTarget";
import { LocusSelect, locusSelectOptions } from "~/lib/locus-select";
import { DataPreview } from "~/lib/data-transfer/DataPreview";
import { DataValueSurface, type ContainedValuePreview } from "~/lib/data-transfer/DataValueSurface";
import { ValueCard, ValueCardCaption, valueCardLabel, valueCardTypeLabel } from "~/lib/value-card";
import { TypedReadValue, typedReadDisplayType, typedReadTypeLabel } from "~/lib/layout-renderer/TypedReadValue";
import { callArgumentPlan, nextReturnedFunctionParameter } from "./call-argument-plan";
import { compareFunctionSearch as sharedCompareFunctionSearch, functionSearchRank as sharedFunctionSearchRank, functionSearchTier } from "./callable-names";
import { constructorNameCounts as constructorPickerNameCounts, displayCallableHandle as fnCodeName, displayFunctionName as functionPickerDisplayName, displayFunctionSignature, functionDisplayName, parameterDisplayName, searchableFunctionSpellings } from "./call-display";
import { codeName, displayNameText, type DisplayName, type DisplayNameInput } from "../display-name";
import { callNodeDisplayName } from "./call-node-name";
import { useItemPresentation } from "~/lib/item-glyph";
import { localFieldName, localParameterName } from "./local-field-names";
import { createLocalPickerCompatibility } from "./local-picker-compatibility";
import type { ReaderCompatibilityItem } from "./authoring-worker-reader-extensions";
import { LIVE_INFERENCE_BATCH_LIMIT } from "./live-guidance-limits";
import { DisplayNameText } from "../display-name-text";
import "./authoring-guidance.css";
import { TypeContract, TypeContractType, type TypeContractRequirement } from "./type-contract";
import type { LocusMenuItem } from "~/lib/locus-context-menu";
import { RawValueEditor } from "~/lib/variant-value";
import { ExtendedExpressionEditor } from "./ExtendedExpressionForms";
import { FieldRenderer, FieldLabel, ExprFieldContext, RecordValuesContext, displayTypeLabel, type ExprFieldWrapperProps, type ListItemWrapperProps, type ArrowBodyEditorProps } from "~/lib/field-renderer";
import { incompleteMembershipNote, type MembershipHintSource, type MembershipHintObserver } from "~/lib/field-renderer/refinement-hints";
import { IconByName, IconTrash, LUCIDE_BY_NAME, TYPE_ICON_FALLBACKS } from "~/lib/icons";
import { typeIconForPresentation } from "../type-icon-presentation";
import {
  ALGEBRAIC_PATTERN_MODES,
  EVALUATOR_STRATEGIES,
  RUNTIME_AUTHORING_OPERATORS,
  callSlotMetadata,
  collectReferencedSavedExpressions,
  constructorFieldsForTag,
  defaultFnCodeName,
  defaultPatternForMode,
  expandAuthoringParamPaths,
  exprNodeToLogic,
  inferAuthoringPatternBindings as inferAuthoringPatternBindingsCore,
  partialCallNode,
  patternMode as patternModeCore,
  peelToArrowType,
  peelToRecordType,
  recordFieldsForType,
  summarizeAuthoringPattern,
  summarizeExprNode,
  typeDisplayName,
  type AlgebraicPatternMode,
  type AuthoringKernelContext,
  type AuthoringInferenceContext,
  type AuthoringInferenceResult,
  type EvaluatorStrategy,
  type ExprNode,
  type RefResolver,
  type WhereBinding,
} from "./expr-node-codec";
export type { ExprNode, RefResolver } from "./expr-node-codec";

// ---------------------------------------------------------------------------
// AST — what the editor stores internally
// ---------------------------------------------------------------------------

const EMPTY_EXPRESSION: ExprNode = { kind: "literal", value: undefined };

// ---------------------------------------------------------------------------
// B4 F2: the editor's structure off the page registry. Every structure read
// (seeds, inline widgets, record and constructor fields, call routes, function
// entries, type names, the catalogue) goes through `editorEnvironment`: for a
// Local session, the environment it published when it was built from its
// worker-checked catalogue (`publishAuthoringEnvironment`); for every other
// session its own environment, unchanged. A Local session that published none
// (not expected) reads an empty environment: the editor offers nothing rather
// than reading the page. Engine-body analyses take no page frame for a Local
// session (`editorFrame`): they are closed draft analyses.
// ---------------------------------------------------------------------------

let emptyStructureEnvironment: AuthoringEnvironment | undefined;
export function editorEnvironment(session: AuthoringSession): AuthoringEnvironment {
  const published = publishedAuthoringEnvironment(session);
  if (published) return published;
  if (preparedSnapshotOwnerOf(session)) return emptyStructureEnvironment ??= createAuthoringEnvironment();
  return session.environment;
}
const widgetEnvironments = new WeakMap<AuthoringEnvironment, WeakMap<object, AuthoringEnvironment>>();
/** Widget capability reads (`inlineWidgetFor`, literal seeds) for a slot.
 * A Local slot's type can be an exact reference to an identified declaration
 * (a picked std type such as Phone is its UUID handle), which the published
 * catalogue rows, keyed by entity id, do not name. Its worker's reference
 * projection (the registry's identified entity) supplies that definition, so
 * the capability lookup sees through the reference, e.g. to a refinement's
 * String carrier. Reactive: a pending answer resolves to nothing until it
 * arrives. Every other session reads its environment unchanged. */
export function editorWidgetEnvironment(session: AuthoringSession, reader: ReaderRuntime | undefined): AuthoringEnvironment {
  const environment = editorEnvironment(session);
  const lookups = reader?.kind === "local" && localStructure(session) ? reader.catalogLookups : undefined;
  if (!reader || !lookups) return environment;
  let byReader = widgetEnvironments.get(environment);
  if (!byReader) widgetEnvironments.set(environment, byReader = new WeakMap());
  const cached = byReader.get(reader);
  if (cached) return cached;
  const identified = (handle: string): FenelType | undefined => {
    const owner = lookups.entityOwner?.(handle);
    const named = owner && owner.id !== handle ? environment.resolveNamedType?.(owner.id) : undefined;
    if (named) return named;
    const type = lookups.entityType(handle);
    return type && typeof type === "object" && !Array.isArray(type) ? type as FenelType : undefined;
  };
  const adapted: AuthoringEnvironment = Object.freeze({
    ...environment,
    resolveNamedType: (name: string) => environment.resolveNamedType?.(name) ?? identified(name),
    resolveTypeRef: (type: FenelType) => {
      const resolved = environment.resolveTypeRef?.(type);
      if (resolved !== undefined || !("$ref" in type) || environment.hasFunctionRefLiteral(type.$ref)) return resolved;
      return identified(type.$ref);
    },
  });
  byReader.set(reader, adapted);
  return adapted;
}
/** The catalogue: a Local session's published one, else the session's own. */
function editorCatalog(session: AuthoringSession) {
  return localStructure(session) ? editorEnvironment(session).catalog : session.catalog;
}
/** Whether this session's structure is published (a Local session). */
function localStructure(session: AuthoringSession): boolean {
  return publishedAuthoringEnvironment(session) !== undefined || preparedSnapshotOwnerOf(session) !== undefined;
}
/** The frame an engine-body draft analysis runs under: none for Local. */
function editorFrame(session: AuthoringSession) {
  return localStructure(session) ? undefined : session.evaluateContext;
}
/** The field registry a field label or renderer reads: a Local reader's own
 * registry by identity (its renderers route it to the worker), never the page
 * session's; every other session's own registry. */
export function editorFieldRegistry(session: AuthoringSession, reader: ReaderRuntime | undefined) {
  if (!localStructure(session)) return session.registry;
  return reader?.kind === "local" ? reader.registry() : undefined;
}
/** Containment options for a page-side compatibility judgment: a Local
 * session supplies no page registry (its judgments run in the worker). */
function editorContainment(session: AuthoringSession) {
  return localStructure(session) ? {} : { registry: session.registry };
}
/** A parameter's shown name. A Local session's identified field names come
 * from its worker (`project-reader-field-names`); until answered, and for a
 * transient field, the field's own label or name, as without a registry. */
function editorParameterName(field: FieldDef | undefined, ordinal: number, session: AuthoringSession,
  reader: ReaderRuntime | undefined): DisplayName {
  if (!localStructure(session)) return parameterDisplayName(field, ordinal, session.registry);
  return localParameterName(field, ordinal,
    field?.key?.$tag === "NamedField" ? localFieldName(reader, session, field.key.ref.$ref) : undefined);
}
/** A type's shown phrase: a Local reader's worker type presentation (B3),
 * else this session's published type name while it is pending. */
function editorTypePhrase(type: FenelType, session: AuthoringSession, reader: ReaderRuntime | undefined,
  fallback = true): string | undefined {
  if (localStructure(session)) {
    const presented = reader?.kind === "local" ? reader.typePresentation?.(type)?.label : undefined;
    return presented || (fallback ? typeNameOf(type, session) || displayTypeLabel(type) : undefined);
  }
  const phrase = typePhrase(type, handle => valueCardLabel(reader?.presentation(handle)?.label)
    || reader?.presentation(handle)?.codeName || session.registry.getIdentifiedEntity(handle)?.id || handle);
  return fallback ? phrase || typeNameOf(type, session) || displayTypeLabel(type) : phrase;
}
/** A slot's shown type caption (field captions, "Required", "Final result").
 * Display only: a slot's `typeName` stays its semantic spelling, which for an
 * exact reference is a handle. A Local reader shows its worker's type
 * presentation, the caption the TypeBuilder shows for the same type, so a
 * picked `Phone` or a Local `Person` reads by name, never by UUID. Other
 * sessions keep their spelling. */
export function editorTypeCaption(type: FenelType | undefined, session: AuthoringSession, reader: ReaderRuntime | undefined,
  spelled?: string): string | undefined {
  const presented = type && localStructure(session) ? valueCardTypeLabel(editorTypePhrase(type, session, reader, false)) : undefined;
  return presented || spelled || (type ? typeNameOf(type, session) || displayTypeLabel(type) : undefined);
}

/** B4 wave 4 lane E: a Local list item's display type, `typedReadDisplayType`'s
 * role for a Local reader: the worker's read packet for the value against the
 * element type (its reflection and declared-type choice), else the element
 * type or the observed one while that packet is pending. The page registry and
 * frame are never read. */
function localGraphDisplayType(value: unknown, element: FenelType | undefined, observed: FenelType | undefined,
  reader: ReaderRuntime | undefined): FenelType | undefined {
  const declared = element ?? observed;
  if (value === undefined || reader?.kind !== "local" || !reader.valueState) return declared;
  const state = reader.valueState(value, declared);
  return (state.kind === "known" || state.kind === "stale" ? state.value.root.displayType : undefined) ?? declared;
}

/** B4 F2: the data a purely literal seed stands for, without evaluation (a
 * Local reader never evaluates on the page): a constructor of literal inputs
 * becomes its tagged data, accepted only when the existing data projection
 * (`expressionForLiteralValue`) reads it back as exactly this seed. Anything
 * else (a computed input, an empty slot) has none: the new item stays empty. */
function literalSeedData(seed: ExprNode, type: FenelType | undefined, session: AuthoringSession): { value: unknown } | undefined {
  const data = (node: ExprNode, depth: number): { value: unknown } | undefined => {
    if (depth > 12) return undefined;
    if (node.kind === "literal" && !detectStructuralForm(node.value)) return node.value === undefined ? undefined : { value: node.value };
    const form = node.kind === "literal" ? detectStructuralForm(node.value) : null;
    const tagged = node.kind === "call" ? { id: node.fnId, inputs: node.args.map((value, index) => ({ name: `_${index}`, value })) }
      : form?.kind === "construct" ? { id: form.tag, inputs: form.fields } : undefined;
    if (!tagged) return undefined;
    const entry = authoringFunctionEntry(session, tagged.id, node.kind === "call" ? node.args.length : undefined);
    if (entry?.kind !== "constructor") return undefined;
    const out: Record<string, unknown> = { $tag: entry.codeName ?? entry.id };
    for (const input of tagged.inputs) {
      const inner = data(input.value, depth + 1);
      if (!inner) return undefined;
      out[input.name] = inner.value;
    }
    return { value: out };
  };
  const candidate = data(seed, 0);
  if (!candidate) return undefined;
  try {
    return JSON.stringify(expressionForLiteralValue(candidate.value, type, editorEnvironment(session))) === JSON.stringify(seed) ? candidate : undefined;
  } catch { return undefined; }
}

/** Thin UI adapter over the pure ExprNode codec. */
export function toLogic(
  node: ExprNode,
  resolver?: RefResolver,
  session: AuthoringSession = DETACHED_AUTHORING_SESSION,
): unknown {
  return authoringExpressionLogic(node, resolver, session);
}

/** One marshal/evaluate boundary for product previews. The same authoring
 * session chooses persisted function/constructor identities and supplies the
 * registry context that can execute those identities, so callers cannot pair
 * the system picker with a narrower ad-hoc runtime registry. */
export function evaluateAuthoringExpression(
  node: ExprNode,
  resolver?: RefResolver,
  session: AuthoringSession = DETACHED_AUTHORING_SESSION,
  data: Record<string, unknown> = {},
  options: { trace?: boolean; capture?: boolean; admitInvocations?: boolean } = {},
) {
  return evaluateAuthoringExpressionInSession(node, resolver, session, data, options);
}


export function logicToExprNode(
  node: unknown,
  paramNames: string[] = [],
  session: AuthoringSession = DETACHED_AUTHORING_SESSION,
): ExprNode {
  return authoringLogicToExprNode(node, paramNames, session);
}

/** Walk the AST and return the unique saved-expression ids it references.
 *  Used by NewValueModal to surface a "5 external values" summary chip. */
export function listRefs(node: ExprNode): string[] {
  return collectReferencedSavedExpressions(node);
}

/** Reader/host reflection only: the shared icon boundary keeps an exact
 * supplied type and receives scope and already-classified presentation facts. */
function preparedTypeIcon(type: FenelType | undefined, session: AuthoringSession,
  reader?: ReaderRuntime, value?: unknown): string {
  // B3: a Local reader's type icons come from its worker; the neutral Type
  // glyph shows while that answer is pending (Rom D-14 (6)).
  if (reader?.kind === "local" && reader.typePresentation) {
    const kind = type && detectTypeKind(type);
    const caption = type ? reader.typePresentation(type) : undefined;
    if (type && !caption) return TYPE_ICON_FALLBACKS.Type;
    return typeIconForPresentation(type, { icon: () => caption?.icon, canonicalName: identity => identity,
      kindLabel: kind ? TYPE_KIND_LABELS[kind] : undefined, knownIcons: LUCIDE_BY_NAME });
  }
  const frame = session.evaluateContext;
  const reflected = typeConstructorOf(value, frame);
  const kind = type && detectTypeKind(type);
  return typeIconForPresentation(type, {
    icon: target => typeof target === "string" && reader ? reader.representation("Iconable", target)?.icon
      : frame._specRegistry ? resolveEffect(frame, frame._specRegistry, "Iconable", target)?.methods.icon : undefined,
    canonicalName: identity => session.registry.getIdentifiedEntity(identity)?.id ?? identity,
    reflectedIdentity: reflected && (session.registry.getIdentifiedEntity(reflected)
      || editorEnvironment(session).resolveTypeRef?.({ $ref: reflected })) ? reflected : undefined,
    kindLabel: kind ? TYPE_KIND_LABELS[kind] : undefined,
    knownIcons: LUCIDE_BY_NAME,
  });
}

// ---------------------------------------------------------------------------
// SavedValuesContext — lets nested LiteralEditor instances offer a "use a
// saved value" picker without each call site threading a list down through
// every NodeEditor recursion. Top-level callers (NewValueModal, /values,
// home pinned items) provide the list + lookup; if no provider is mounted,
// the "+ ref" affordance is hidden.
// ---------------------------------------------------------------------------

/** `unnamed`/`ordinal`: an uncaptioned root card (locus-expression-sources). */
export type SavedValueOption = { id: string; name: string; expr: ExprNode; unnamed?: boolean; ordinal?: number };

export type SavedValuesProvider = {
  list: () => SavedValueOption[];
  byId: (id: string) => SavedValueOption | undefined;
};

export const SavedValuesContext = createContext<SavedValuesProvider | null>(null);

// ---------------------------------------------------------------------------
// LambdaParamsContext — surfaces the params that are in scope inside a
// lambda body, so NodeEditor can offer a "param" mode (mirroring "ref")
// where the user picks one of the in-scope params to reference. The
// LambdaEditor pushes its arrow's params here and accumulates outer-scope
// params on top, so nested lambdas see all enclosing bindings.
// ---------------------------------------------------------------------------

export type LambdaParam = { name: string; type: FenelType; scheme?: TypeScheme; bindingId?: string;
  typeApplication?: import("@fenel/engine/authoring/generic-type-application").GenericTypeCall };

export const LambdaParamsContext = createContext<() => LambdaParam[]>(() => []);
// This browser capture owner follows the whole mounted draft through structural
// children; result-binding continuation retains its narrower rewrite scope.
const SuggestionDraftContext = createContext<(() => ExprNode) | null>(null);
type SuggestionCheckScope = {
  node: () => ExprNode;
  destination: () => DataSuggestionInput["destination"];
  lexicalBindings: () => DataSuggestionInput["lexicalBindings"];
};
const SuggestionCheckContext = createContext<SuggestionCheckScope | null>(null);

// ---------------------------------------------------------------------------
// InstanceTraceContext — per-instance trace overlay.
//
// When the editor host picks an instance (e.g. via the "instances ▾" dropdown
// in the home edit modal), it loads that instance's traces and exposes them
// here. NodeEditor (call-mode) and LetBindingsEditor look up traces by
// function/binding name and render an inline value chip showing the actual
// runtime value at that expression site. With this on, browsing the function
// definition doubles as browsing a specific run — same UX, optional overlay.
//
// Today's lookup is name-based: `byLet(name)` for let-binding values,
// `byCall(fnName)` for call sites. Once `Trace.stepPath` is widely emitted
// the lookup can refine to `byPath(stepPath)` for unambiguous mapping when
// the same name appears twice in a body. The runtime already tags traces
// with `step_path` (see `runtime/evaluator.ts:turn()` + `IORequest.stepPath`)
// — wiring `byPath` is a follow-up once the editor↔runtime path bridge lands.
// ---------------------------------------------------------------------------

export type InstanceTrace = {
  id: string;
  name: string;
  kind: "call" | "read" | "wait" | "io" | "pure" | "let";
  status: "running" | "completed" | "failed" | "suspended";
  /** Phase 14 of canonical-maybe — mirror of `Trace.output` lift; readers
   *  use `peelMaybeValue(output)` (Just(null) collapses to null per the
   *  Option A codec at db/queries/traces.ts). */
  output: Maybe<unknown>;
  error: Maybe<string>;
  durationMs: Maybe<number>;
  /** Phase 14 of canonical-maybe — mirror of `Trace.stepPath` lift. */
  stepPath: Maybe<string>;
  /** Phase 12 of canonical-maybe — typed `TraceMeta` variant; readers
   *  dispatch on `peelMaybeValue(meta)?.$tag` (e.g. `"LetBinding"`).
   *  Pre-Phase-12, this was `{ letName?: string } & Record<string,
   *  unknown>` with key-presence dispatch. */
  meta: Maybe<TraceMeta>;
};

export type InstanceTraceProvider = {
  /** Traces of kind `"let"` (or IO traces with `meta.letName`) for a binding
   *  name. Multiple matches when the same name is bound in different
   *  branches (we don't dedupe — the caller picks). */
  byLet: (name: string) => InstanceTrace[];
  /** Traces whose `name` matches a call site's function id / codeName.
   *  Includes `call`, `io`, `pure` kinds. */
  byCall: (fnNameOrId: string) => InstanceTrace[];
};

/** Carried as an accessor (`() => provider`) — Solid contexts hand a static
 *  value to descendants at setup time, so a plain `provider | undefined`
 *  would freeze at whatever was loaded when the editor first rendered.
 *  An accessor closes over the parent's signal, so the badges' reactive
 *  scope re-reads it when the host swaps the selected instance. */
export const InstanceTraceContext = createContext<() => InstanceTraceProvider | undefined>(() => undefined);

/** Peel a type to a `$record` if there's one underneath layers of
 *  refinement / opaque-newtype / named-reference. Used by the param
 *  expander so `ctx: CollectorContext` (a `$named` reference) gets
 *  unwrapped to its underlying record before we walk the fields. */
function peelToRecord(t: FenelType, session: AuthoringSession): FenelType | undefined {
  return peelToRecordType(t, editorEnvironment(session));
}

/** Peel a FenelType through `$refined` / `$opaque` wrappers to find the
 *  underlying `$arrow` (function type) if one exists. Returns the `$arrow`
 *  type directly (not the wrapper) so callers can read params/returns.
 *  Used to decide whether a slot wants a *function* — in which case
 *  ref-mode offers a FunctionPicker that nominates a function as a typed
 *  `{$ref}` value (point-free), the same way an arrow slot's inline mode
 *  offers a lambda body. */
function peelArrowType(t: FenelType | undefined, session: AuthoringSession): FenelType | undefined {
  return peelToArrowType(t, editorEnvironment(session));
}

/** A `{kind:"literal", value:{$ref:id}}` is a typed function reference — a
 *  function nominated as a *value* (the `Ref` substrate; Phase 2). Returns
 *  the referenced function id when the node is such a literal, else null.
 *  Used to route the node to a function-ref pill instead of the generic
 *  literal editor, and to keep read-back lossless (the engine self-evaluates
 *  `{$ref}` — `json-logic.ts` single-key `$`-marker pass-through). */
function refLiteralId(node: ExprNode): string | null {
  if (node.kind !== "literal") return null;
  const v = node.value;
  if (
    v && typeof v === "object" && !Array.isArray(v)
    && "$ref" in (v as Record<string, unknown>)
    && typeof (v as Record<string, unknown>).$ref === "string"
  ) {
    return (v as { $ref: string }).$ref;
  }
  return null;
}

/** Expand a flat list of params into the list of all dot-path-accessible
 *  bindings reachable from them. For a record-typed param, every field
 *  (and recursively, every record sub-field) is surfaced as a dotted
 *  binding alongside the original — so `ctx: CollectorContext` produces
 *  `[ctx, ctx.botId, ctx.chatId, ctx.userId, ctx.user, ctx.startedAt]`,
 *  each typed at its leaf. The compiled JSON Logic `{var: "ctx.botId"}`
 *  resolves dot-paths natively, so no special handling at runtime.
 *
 *  We intentionally only descend into record kinds — variants, lists,
 *  maybes, etc. all require runtime case analysis or unwrapping that
 *  isn't expressible as a flat field access. */
export function expandParamPaths(
  params: LambdaParam[],
  session: AuthoringSession = DETACHED_AUTHORING_SESSION,
): LambdaParam[] {
  return expandAuthoringParamPaths(params, editorEnvironment(session));
}

// ---------------------------------------------------------------------------
// ActivePickerContext — ensures only one ref/call picker is open at a time
// across the editor. Each picker-opening site (NodeEditor,
// NestedExprWrapper, NestedListItemWrapper) calls `claim(closeMe)` when
// its picker opens. If another picker was active, its registered
// `closeMe` is fired first so that picker collapses back to inline.
// The function returned from `claim` releases the slot, called via
// onCleanup when the picker closes naturally (cancel/pick/mode toggle).
// ---------------------------------------------------------------------------

export type PickerClaim = (close: () => void) => () => void;

function createPickerClaimer(): PickerClaim {
  let currentClose: (() => void) | null = null;
  return (close: () => void) => {
    if (currentClose && currentClose !== close) {
      currentClose();
    }
    currentClose = close;
    return () => {
      if (currentClose === close) currentClose = null;
    };
  };
}

export const ActivePickerContext = createContext<PickerClaim | null>(null);

/** Wraps children so all ref/call pickers underneath share a single
 *  active-picker slot. Use this when multiple `<ExpressionEditor>` are
 *  rendered as siblings and should not all be openable simultaneously. */
export function ActivePickerProvider(props: { children: any }) {
  const claim = createPickerClaimer();
  return (
    <ActivePickerContext value={claim}>
      {props.children}
    </ActivePickerContext>
  );
}

// ---------------------------------------------------------------------------
// Editor-path context — tracks how deeply nested the current editor is
// and surfaces a breadcrumb trail so a "zoom in" modal can show the user
// where they are inside the larger expression. Both NodeEditor and
// MatchPatternEditor check this; once depth crosses NODE_DEPTH_LIMIT,
// they render a CollapseStub instead of the full editor body. Clicking
// the stub fires `openModal` (provided by the root ExpressionEditor) to
// show the same sub-expression at depth 0 with the breadcrumbs above.
// ---------------------------------------------------------------------------

type PathSegment = { label: string };

type EditorPathState = {
  depth: number;
  path: PathSegment[];
  /** Open a modal showing a sub-expression. The render thunk is invoked
   *  inside the modal under a fresh provider at depth 0 + the captured
   *  path, so the editor renders inline (depth-check passes) and the
   *  breadcrumbs above show the user how they got there. */
  openModal?: (path: PathSegment[], render: () => any) => void;
  /** The expression lens setting "Fold deep nesting"; off unless chosen. */
  fold?: () => boolean;
};

const EditorPathContext = createContext<EditorPathState>({ depth: 0, path: [] });

/** How many nested editor frames to allow inline before collapsing to a
 *  "expand →" stub when the lens folds deep nesting. Tuned so the depth ≈
 *  horizontal-room budget — past 4 levels the rightmost editor barely fits. */
const NODE_DEPTH_LIMIT = 4;

/** Push a breadcrumb segment + bump depth for everything rendered under
 *  this provider. Use this around any recursive call to NodeEditor or
 *  MatchPatternEditor so the depth counter reflects the visual nesting
 *  and the path captures the route from root. */
function PathSegmentProvider(props: { label: string; children: any }) {
  const parent = useContext(EditorPathContext);
  return (
    <EditorPathContext
      value={{
        depth: parent.depth + 1,
        path: [...parent.path, { get label() { return props.label; } }],
        openModal: parent.openModal,
        fold: parent.fold,
      }}
    >
      {props.children}
    </EditorPathContext>
  );
}

/** Placeholder rendered in place of a deeply nested editor body. The
 *  "expand →" button hands a render closure back to the root
 *  ExpressionEditor's modal so the same editor can be shown at depth 0
 *  with breadcrumbs. */
function CollapseStub(props: {
  summary: string;
  onExpand: () => void;
}) {
  return (
    <div class="expr-collapse">
      <span class="expr-collapse__icon mono">⋯</span>
      <span class="expr-collapse__summary mono">{props.summary}</span>
      <button
        type="button"
        class="expr-collapse__expand"
        onClick={props.onExpand}
        data-tooltip="Open in a modal"
      >
        expand →
      </button>
    </div>
  );
}

/** Tiny human-readable summary for an ExprNode — used by CollapseStub
 *  to hint what's hidden behind the "expand" button. Doesn't recurse;
 *  one line max. */
/** A selected constructor's shown name. A record type's own constructor
 * shows its owner's catalogue label (one row for that entity); otherwise the
 * constructor's picker name. Display only, never a source spelling. */
function constructorEntryCaption(entry: FnEntry, session: AuthoringSession, reader: ReaderRuntime | undefined): string {
  const ownerName = entry.parentEntity;
  // B4 F2: a Local reader's owner facts (its registry's identified entity
  // and nominal identity) come from its worker; the caption is the same
  // catalogue label. Until they are known, the constructor's own name.
  if (ownerName && entry.ownerIdentity && localStructure(session)) {
    const lookups = reader?.kind === "local" ? reader.catalogLookups : undefined;
    const type = lookups?.entityType(ownerName) as FenelType | undefined;
    const owner = lookups?.entityOwner?.(ownerName);
    if (owner && owner.nominalIdentity === entry.ownerIdentity && type && typeof type === "object" && "$record" in type) {
      const labels = editorCatalog(session).types.filter(row => row.entityId === owner.id);
      if (labels.length === 1) return labels[0]!.name;
    }
  } else if (ownerName && entry.ownerIdentity
    && session.registry.getEntityNominalIdentity(ownerName) === entry.ownerIdentity) {
    const owner = session.registry.getIdentifiedEntity(ownerName);
    if (owner?.type && "$record" in owner.type) {
      const labels = editorCatalog(session).types.filter(type => type.entityId === owner.id);
      if (labels.length === 1) return labels[0]!.name;
    }
  }
  return functionPickerDisplayName(entry);
}

/** The constructor caption of a `Tag { … }` literal whose summary the source
 * printer could only write in identity notation (`@{…}`): a Local type is
 * named by its Codeable/Labelable presentation, which is not a source route. */
function constructSummaryCaption(n: ExprNode, session: AuthoringSession, reader: ReaderRuntime | undefined): string | undefined {
  if (n.kind !== "literal" || detectStructuralForm(n.value)?.kind !== "construct") return undefined;
  const tag = (n.value as { __construct?: { tag?: unknown } }).__construct?.tag;
  if (typeof tag !== "string") return undefined;
  const target = editorEnvironment(session).resolveConstructorTarget?.(tag);
  const entry = target ? authoringFunctionEntry(session, target) : undefined;
  return entry?.kind === "constructor" && entry.signatureOutcome?.$tag === "Solved" ? constructorEntryCaption(entry, session, reader) : undefined;
}

function summarizeNode(n: ExprNode, session: AuthoringSession, boundNames: readonly string[], reader?: ReaderRuntime): string {
  const summary = summarizeNode0(n, session, boundNames);
  if (!reader || !summary.startsWith("@{")) return summary;
  const caption = constructSummaryCaption(n, session, reader);
  const end = summary.indexOf("}");
  // An unnamed constructor keeps the printer's identity notation.
  return caption && end > 0 && !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(caption)
    ? caption + summary.slice(end + 1) : summary;
}
function summarizeNode0(n: ExprNode, session: AuthoringSession, boundNames: readonly string[]): string {
  return summarizeExprNode(n, fnCodeName, {
    constructorRoutes: editorEnvironment(session).catalog.exactConstructorRoutes ?? [],
    constructorTargets: editorEnvironment(session).catalog.patternConstructors ?? [],
    referenceRoutes: editorEnvironment(session).catalog.referenceRoutes ?? [],
    boundNames,
  });
}

/** Same idea for raw match-arm patterns (which are NOT ExprNodes). */
function summarizePattern(p: unknown): string {
  return summarizeAuthoringPattern(p);
}

// ---------------------------------------------------------------------------
// Function index — std + (optionally) user functions
// ---------------------------------------------------------------------------

type FnEntry = AuthoringCatalogFunctionEntry;

/** Resolve the signature a call will actually use. The picker roster can
 * intentionally contain a capability row whose `Module.member` spelling is
 * shadowed by a real module member; semantic editor slots must mirror runtime
 * precedence through the environment's exact-route table. */
function authoringFunctionEntry(
  session: AuthoringSession,
  id: string,
  arity?: number,
): FnEntry | undefined {
  const entry = editorEnvironment(session).getFunctionEntry?.(id, arity) as FnEntry | undefined;
  if (!entry) return undefined;
  const target = entry.targetId ?? entry.id;
  const presentation = editorCatalog(session).functions.find(candidate => (candidate.targetId ?? candidate.id) === target);
  return presentation?.label && presentation.label !== entry.label ? { ...entry, label: presentation.label } : entry;
}

function functionPickerSelectionId(entry: FnEntry): string {
  return entry.kind === "constructor"
    ? entry.targetId ?? entry.id
    : entry.targetId ?? entry.id;
}

function functionPickerSemanticKey(entry: FnEntry): string {
  if (entry.notation !== undefined) {
    return JSON.stringify(["operator", entry.id, entry.notation, entry.params.length]);
  }
  return JSON.stringify([entry.kind === "constructor" ? "constructor" : "function", entry.targetId ?? entry.id]);
}

/** `FN_INDEX` is a complete presentation roster, not a runtime-precedence
 * table. Project every row through the environment before the picker filters,
 * counts, searches, displays, or selects it. A capability row shadowed by a
 * real Module.member therefore becomes that module entry, and the duplicate
 * raw rows collapse on their effective semantic target. */
const pickerIndexCache = new WeakMap<AuthoringSession, { source: readonly FnEntry[]; entries: FnEntry[] }>();
function projectFunctionPickerIndex(
  session: AuthoringSession,
  functions: readonly FnEntry[],
): FnEntry[] {
  const cached = pickerIndexCache.get(session);
  if (cached?.source === functions) return cached.entries;
  const projected = new Map<string, { entry: FnEntry; priority: number }>();
  for (const raw of functions) {
    // Constructor roster rows describe an exact semantic owner even when
    // several owners share the same short tag. Resolve that exact target
    // before consulting the source-frame spelling, otherwise two `Dup` rows
    // would both collapse to whichever bare `Dup` the current import frame
    // selects and the other owner would disappear from the picker.
    const effective = raw.kind === "constructor" && raw.targetId !== undefined
      ? authoringFunctionEntry(session, raw.targetId, raw.params.length)
        ?? authoringFunctionEntry(session, raw.id, raw.params.length)
      : authoringFunctionEntry(session, raw.id, raw.params.length)
        ?? (raw.targetId === undefined || raw.targetId === raw.id
          ? undefined
          : authoringFunctionEntry(session, raw.targetId, raw.params.length));
    if (effective === undefined) continue;

    const selectionId = functionPickerSelectionId(effective);
    const entry = {
      ...effective,
      // Exact constructor resolution intentionally returns the semantic
      // owner row, whose id is the short source tag and whose `codeName` can
      // therefore be absent. Retain the picker row's short presentation name
      // while keeping the exact target below as the selected/persisted id.
      ...(effective.kind === "constructor" && raw.codeName !== undefined
        ? { codeName: raw.codeName }
        : {}),
      ...(selectionId === effective.id
        ? {}
        : { id: selectionId, targetId: selectionId }),
    };
    const key = functionPickerSemanticKey(entry);
    // Prefer the raw row that already names the selected effective target. It
    // carries that target's own label/description instead of a shadow row's.
    const priority = raw.id === selectionId ? 2 : raw.targetId === selectionId ? 1 : 0;
    const prior = projected.get(key);
    if (prior === undefined || priority > prior.priority) {
      projected.set(key, { entry, priority });
    }
  }
  const entries = [...projected.values()].map(({ entry }) => entry);
  pickerIndexCache.set(session, { source: functions, entries });
  return entries;
}

function authoritativePickerSignature(entry: FnEntry): {
  params: FieldDef[];
  returns: FenelType;
} | undefined {
  if (entry.signatureOutcome?.$tag !== "Solved" || entry.scheme === undefined) {
    return undefined;
  }
  const body = entry.scheme.body;
  if (body === null || typeof body !== "object" || !("$arrow" in body)) {
    return undefined;
  }
  const arrow = body.$arrow;
  if (!Array.isArray(arrow.params)) return undefined;
  return { params: arrow.params, returns: arrow.returns };
}

export function resolveFnId(
  name: string,
  session: AuthoringSession = DETACHED_AUTHORING_SESSION,
): string | undefined {
  return editorEnvironment(session).resolveFunctionId(name);
}

function editorGetFunction(session: AuthoringSession, handle: string): true | undefined {
  return editorEnvironment(session).hasFunctionRefLiteral(handle) ? true : undefined;
}

function resolveElInType(
  session: AuthoringSession,
  type: FenelType,
  values: Record<string, unknown>,
): FenelType {
  return dependentTypeForValuePath(editorEnvironment(session), type, values);
}

/** Read the authoritative callable shape; contextual substitutions come from
 * inferAuthoringCallGuidance, preserving the registry's scheme authority. */
function registryCallParams(entry: FnEntry): FieldDef[] {
  return authoritativePickerSignature(entry)?.params ?? entry.params;
}

// ---------------------------------------------------------------------------
// Public API — editor + live trace
// ---------------------------------------------------------------------------

/** How the expression is rendered. "nested" is the classic call-tree form
 *  `g(f(x))`; "pipe" linearizes chains into `x |> f |> g` (matching Fenel's
 *  real `pipe` operator). Pipe is display-only — the AST is unchanged. */

const ExpressionGoalContext = createContext<() => FenelType | undefined>(() => undefined);
/** B4 slice 2: a Local reader's live inference for one editor root, answered
 * by its worker (`infer-expression`), latest wins, nothing before an edit.
 * Absent for Account and public readers, which keep the page inference. */
const ExpressionGuidanceContext = createContext<LiveGuidance<ExpressionInferenceItem, ExpressionInferenceReply> | null>(null);

function expressionField(type: FenelType | undefined, name = "value"): FieldDef | undefined {
  return type ? { name, type, label: Nothing, meta: {}, ui: Nothing } : undefined;
}

function widgetTypeForSlot(type: FenelType | undefined, value: unknown): FenelType | undefined {
  if (type && !("$var" in type)) return type;
  if (typeof value === "string") return { $ref: "String" };
  if (typeof value === "number") return { $ref: "Number" };
  if (isInlineImageValue(value)) return { $ref: "Image" };
  return type;
}

export function PreparedExpressionEditor(props: ExpressionEditorProps) {
  const inheritedSession = useAuthoringSession();
  const session = () => props.authoringSession ?? inheritedSession;
  const sharedSession = reactiveAuthoringSession(session);
  const inheritedGoal = useContext(ExpressionGoalContext);
  const goal = () => props.expectedScheme?.body ?? props.fieldDef?.type
    ?? expectedTypeForName(props.typeName, editorEnvironment(session()))
    ?? inheritedGoal();
  // Reuse a parent's active-picker slot if one is provided (so siblings
  // share); otherwise own one for this editor's subtree.
  const parentClaim = useContext(ActivePickerContext);
  const claim = parentClaim ?? createPickerClaimer();

  // Modal state for the zoom-in flow. Only the *outermost* ExpressionEditor
  // owns this; nested ExpressionEditors inherit their parent's openModal
  // so a single modal stack is shared across the tree.
  const parentPath = useContext(EditorPathContext);
  const isRoot = !parentPath.openModal;
  const saved = useContext(SavedValuesContext);
  const lambdaParams = useContext(LambdaParamsContext);
  const inheritedGraphValues = useContext(ExpressionGraphValueContext);
  const inheritedCapture = useContext(ExpressionGraphCaptureContext);
  const savedExpressions = createMemo<ReadonlyMap<string, ExprNode>>(() =>
    new Map((saved?.list() ?? []).map(option => [option.id, option.expr])));
  const editorReader = useReaderRuntime();
  // B4 fix round 2: the surface scope a nested value check is held under.
  const draftCheckScope = props.draftCheckScope ?? useContext(DraftCheckScopeContext);
  const inheritedGuidance = useContext(ExpressionGuidanceContext) ?? undefined;
  const guidance = inheritedGuidance ?? (editorReader?.kind === "local"
    ? createLocalLiveGuidance<ExpressionInferenceItem, ExpressionInferenceReply>(() => editorReader, session,
      (items, capture, signal) => inferExpressionsInWorker(capture.facade, items, savedExpressions(),
        { ...(capture.sourceMetadata ? { sourceMetadata: capture.sourceMetadata } : {}), priority: "guidance" }, signal),
      // The edited node and its ancestors are new objects: answered first.
      { label: "editor", identity: item => item.node }) : undefined);
  if (guidance && !inheritedGuidance) onCleanup(() => guidance.dispose());
  // The page showed a complete expression's inferred types, mismatches and
  // edge issues at open: the root asks once, at open.
  if (!inheritedGuidance) openLiveGuidance(guidance, () => completeLiveDraft(props.expr,
    node => authoringExpressionLogic(node, id => savedExpressions().get(id), session())));
  // Every edit through this editor asks for the guidance of the new draft.
  const editorChange = (next: ExprNode) => { guidance?.touch(); props.onChange(next); };
  const activeGraphs = new Map<object, { node: ExprNode; allowed: boolean }>();
  let graphOwnerAlive = true;
  const [graphActive, setGraphActive] = createSignal(false);
  const [graphSelection, setGraphSelection] = createSignal<{ node: ExprNode; allowed: boolean }>();
  const currentGraphWorker = createMemo(() => {
    try { return authoringWorkerSnapshot(concreteAuthoringSession(session())); }
    catch { return undefined; }
  });
  const currentGraphSourceMetadata = createMemo(() => {
    try { return captureReaderSourceMetadata(session()); }
    catch { return undefined; }
  });
  const [captureRequest, setCaptureRequest] = createSignal<{
    root: ExprNode; expr: ExprNode; saved: ReadonlyMap<string, ExprNode>; session: AuthoringSession; epoch: number;
    owner: AuthoringSession; sourceMetadata?: ReaderSourceMetadataCapture;
    worker?: object; controller: AbortController; observed?: import("~/lib/locus-card-evaluation").LocusCardResult;
  }>();
  const captureCurrent = () => {
    const request = captureRequest();
    currentGraphWorker();
    try {
      const sourceMetadata = currentGraphSourceMetadata();
      if (request?.sourceMetadata) assertReaderSourceMetadata(request.sourceMetadata, session());
      return !!request && !request.controller.signal.aborted && request.root === props.expr
        && request.expr === graphSelection()?.node && request.saved === savedExpressions()
        && request.owner === session() && request.session === concreteAuthoringSession(session()) && request.epoch === sessionEpoch()
        && request.sourceMetadata?.generationToken === sourceMetadata?.generationToken
        && request.worker === untrack(() => authoringWorkerSnapshot(request.session));
    } catch { return false; }
  };
  const completeExpression = createMemo(() => {
    try { return !authoringBindingNameIssue(props.expr, editorFrame(session()))
      && !authoringExpressionHasEmptySlot(authoringExpressionLogic(props.expr, id => savedExpressions().get(id), session())); }
    catch { return false; }
  });
  const mayCapture = () => isRoot && lambdaParams().length === 0 && graphSelection()?.allowed !== false && completeExpression();
  const externalCapture = () => !!props.onGraphActiveChange || !!props.onCaptureGraph || inheritedCapture.available();
  // Only the mounted Graph owns these observations. Closing it or changing
  // source releases the prior run; hovering and node placement only read it.
  const capture = isRoot ? createLocusCardEvaluation(() => ({
    expr: captureRequest()?.expr, saved: captureRequest()?.saved ?? savedExpressions(),
    session: captureRequest()?.owner ?? session(), sourceMetadata: captureRequest()?.sourceMetadata, transient: true,
    signal: captureRequest()?.controller.signal,
    observed: captureCurrent() ? captureRequest()?.observed : undefined,
    capture: true,
    skip: !mayCapture() || !captureCurrent() || externalCapture(),
  })) : undefined;
  function startCapture() {
    captureRequest()?.controller.abort();
    const selected = graphSelection();
    if (!graphActive() || !selected || !mayCapture() || externalCapture()) { setCaptureRequest(undefined); return; }
    const owner = session();
    let sourceMetadata: ReaderSourceMetadataCapture | undefined;
    try { sourceMetadata = captureReaderSourceMetadata(owner); }
    catch { setCaptureRequest(undefined); return; }
    const current = concreteAuthoringSession(owner);
    // Association comes from the canonical codec. A disappearing/edited
    // subtree cannot briefly run its preceding graph selection.
    const source = authoringExpressionSites(props.expr, id => savedExpressions().get(id), owner);
    if (!source.sites.some(site => site.node === selected.node)) { setCaptureRequest(undefined); return; }
    let worker: object | undefined;
    let observed: import("~/lib/locus-card-evaluation").LocusCardResult | undefined;
    try {
      worker = authoringWorkerSnapshot(current);
      observed = readLocusCardResult(selected.node, savedExpressions(), owner, { capture: true, sourceMetadata });
    } catch { setCaptureRequest(undefined); return; }
    setCaptureRequest({ root: props.expr, expr: selected.node, saved: savedExpressions(), session: current, owner, sourceMetadata, worker,
      epoch: sessionEpoch(), controller: new AbortController(), observed });
  }
  createEffect(() => ({ active: graphActive(), selection: graphSelection(), allowed: mayCapture(), external: externalCapture(), expr: props.expr,
    saved: savedExpressions(), owner: session(), session: concreteAuthoringSession(session()),
    generation: currentGraphSourceMetadata()?.generationToken, worker: currentGraphWorker(), epoch: sessionEpoch() }), () => startCapture());
  onCleanup(() => { graphOwnerAlive = false; activeGraphs.clear(); captureRequest()?.controller.abort(); });
  const activateGraph = (active: boolean, token: object, node?: ExprNode, allowed = true) => {
    if (!graphOwnerAlive) return;
    allowed = allowed && completeExpression();
    if (externalCapture()) { inheritedCapture.activate?.(active, token, node, allowed); return; }
    activeGraphs.delete(token);
    if (active && node) activeGraphs.set(token, { node, allowed });
    queueMicrotask(() => {
      if (!graphOwnerAlive) return;
      setGraphSelection([...activeGraphs.values()].at(-1));
      setGraphActive(activeGraphs.size > 0);
    });
  };
  const requestCapture = () => {
    if (props.onCaptureGraph) { props.onCaptureGraph(); return; }
    if (inheritedCapture.available()) { inheritedCapture.request?.(); return; }
    startCapture();
  };
  const graphValue = (node: ExprNode): ExpressionGraphValue | undefined => {
    if (mayCapture() && captureCurrent() && capture && !capture.loading() && !capture.value().error) {
      const request = captureRequest()!;
      const value = readLocusCapturedValue(request.expr, request.saved, request.owner, node, capture.value(), request.sourceMetadata);
      if (value) return value;
    }
    const existing = props.graphValue?.(node) ?? inheritedGraphValues?.(node);
    if (existing) return existing;
    if ((node === props.expr || node === graphSelection()?.node) && mayCapture()) {
      try {
        const result = readLocusCardResult(node, savedExpressions(), session());
        if (result && !result.error) return { value: result.result };
      } catch { /* A replaced reader has no current result. */ }
    }
    return undefined;
  };
  const [modal, setModal] = createSignal<{
    path: PathSegment[];
    render: () => any;
  } | null>(null);

  const [foldDeep, setFoldDeep] = createSignal(false);
  const pathState: EditorPathState = isRoot
    ? {
        depth: 0,
        path: [],
        openModal: (path, render) => setModal({ path, render }),
        fold: foldDeep,
      }
    : parentPath;
  // The simple lens (New data): a root constructor draft as a plain form.
  const simpleModel = useSimpleFormModel(() => isRoot && props.presentation === "simple" ? props.expr : undefined, session);
  const inheritedLensSettings = useContext(ExpressionLensSettingsContext);
  const lensSettings = isRoot ? { foldDeep, setFoldDeep } : inheritedLensSettings;

  return (
    <AuthoringSessionContext value={sharedSession}>
      <ExpressionGuidanceContext value={guidance ?? null}>
      <DraftCheckScopeContext value={draftCheckScope}>
      <ExpressionGraphValueContext value={graphValue}>
      <ExpressionGraphCaptureContext value={{ request: requestCapture, activate: activateGraph,
        available: () => externalCapture() || mayCapture(),
        pending: () => props.onCaptureGraph ? !!props.graphCapturePending : inheritedCapture.available()
          ? inheritedCapture.pending() : captureCurrent() && !!capture?.loading(),
        pendingLabel: () => props.onCaptureGraph || props.onGraphActiveChange ? props.graphCapturePendingLabel
          : inheritedCapture.available() ? inheritedCapture.pendingLabel?.()
          : captureCurrent() && capture?.loading() ? "Computing data…" : undefined }}>
      <ActivePickerContext value={claim}>
        <EditorPathContext value={pathState}>
          <ExpressionLensSettingsContext value={lensSettings}>
          <ExpressionGoalContext value={goal}>
          <Show when={captureCurrent() && capture?.value().error}>
            {error => <div class="expr-graph-capture-state expr-graph-capture-state--error" role="status">{error()}</div>}
          </Show>
          {/* The depth fold is read when each editor mounts: changing the
              setting remounts the tree under its new presentation. */}
          <Show keyed when={!isRoot || foldDeep() ? "folded" : "unfolded"}>{(_fold) => <Show
            when={!!simpleModel()} fallback={<NodeEditor
            node={props.expr}
            onChange={guidance ? editorChange : props.onChange}
            typeName={props.typeName}
            paramName={props.paramName}
            fieldDef={props.fieldDef}
            expectedScheme={props.expectedScheme}
            observeMembershipHints={props.observeMembershipHints}
            hideResultGuidance={props.hideResultGuidance}
            deferFunctionChoices={props.deferFunctionChoices}
            hideLabel={props.hideLabel}
            suppressAnnotationCreate={props.hideTopLevelAnnotation}
            requirementSource={props.requirementSource}
            declaredType={props.declaredType}
            onDeclaredTypeChange={props.onDeclaredTypeChange}
            declaredReadonly={props.declaredReadonly}
            typeMenuItems={props.typeMenuItems}
            hideTypeContract={props.hideTypeContract}
            viewMode={props.viewMode ?? "nested"}
          />}><SimpleDataForm model={simpleModel()!} onChange={guidance ? editorChange : props.onChange}
            showIssues={props.simpleShowIssues} /></Show>}</Show>
          <Show keyed when={isRoot && modal()}>
            {state => <ExprZoomModal
              state={state}
              onClose={() => setModal(null)}
              onOpenSub={(p, r) => setModal({ path: p, render: r })}
              onNavigate={(targetDepth) => {
                void targetDepth;
                setModal(null);
              }}
            />}
          </Show>
          </ExpressionGoalContext>
          </ExpressionLensSettingsContext>
        </EditorPathContext>
      </ActivePickerContext>
      </ExpressionGraphCaptureContext>
      </ExpressionGraphValueContext>
      </DraftCheckScopeContext>
      </ExpressionGuidanceContext>
    </AuthoringSessionContext>
  );
}

function ExprZoomModal(props: {
  state: { path: PathSegment[]; render: () => any };
  onClose: () => void;
  onOpenSub: (path: PathSegment[], render: () => any) => void;
  onNavigate: (targetDepth: number) => void;
}) {
  return (
    <ModalOverlay
      class="modal-overlay"
      onClick={(e) => {
        if (e.target === e.currentTarget) props.onClose();
      }}
    >
      <div class="modal-box expr-zoom-modal">
        <div class="expr-zoom-modal__head">
          <div class="expr-zoom-modal__breadcrumbs">
            <button
              type="button"
              class="expr-zoom-modal__bc-segment mono"
              onClick={() => props.onNavigate(0)}
              data-tooltip="Back to root"
            >
              root
            </button>
            <For each={props.state.path}>
              {(seg, i) => (
                <>
                  <span class="expr-zoom-modal__bc-sep mono">›</span>
                  <Show
                    when={i() < props.state.path.length - 1}
                    fallback={
                      <span class="expr-zoom-modal__bc-segment expr-zoom-modal__bc-segment--current mono">
                        {seg.label}
                      </span>
                    }
                  >
                    <button
                      type="button"
                      class="expr-zoom-modal__bc-segment mono"
                      onClick={() => props.onNavigate(i() + 1)}
                      data-tooltip="Back to this level"
                    >
                      {seg.label}
                    </button>
                  </Show>
                </>
              )}
            </For>
          </div>
          <button
            type="button"
            class="btn"
            onClick={props.onClose}
            style="padding: 0.2rem 0.55rem; font-size: 0.78rem"
          >
            Close
          </button>
        </div>
        <div class="expr-zoom-modal__body">
          <EditorPathContext
            value={{
              depth: 0,
              path: props.state.path,
              openModal: props.onOpenSub,
              fold: () => true,
            }}
          >
            {props.state.render()}
          </EditorPathContext>
        </div>
      </div>
    </ModalOverlay>
  );
}

export type ExpressionTraceSnapshot = { result: unknown; trace: TraceStep[]; error?: string };

export function ExpressionTrace(props: {
  expr?: ExprNode;
  snapshot?: ExpressionTraceSnapshot;
  data?: Record<string, unknown>;
  viewMode?: ExprViewMode;
  authoringSession?: AuthoringSession;
}) {
  const inheritedSession = useAuthoringSession();
  const session = () => props.authoringSession ?? inheritedSession;
  const savedCtx = useContext(SavedValuesContext);
  const resolver = createMemo<RefResolver | undefined>(() =>
    savedCtx ? (id) => savedCtx.byId(id)?.expr : undefined,
  );
  // B4 F2: a Local reader's live trace runs in its worker (`evaluate-expression`
  // with `trace`, guidance class, latest wins); while the next answer is
  // pending the previous trace stays shown, unchanged.
  const reader = useReaderRuntime();
  const localTrace = () => !props.snapshot && props.expr !== undefined && props.data === undefined && localStructure(session());
  let traceController: AbortController | undefined;
  onCleanup(() => traceController?.abort());
  const workerTrace = createAsyncValue(() => {
    if (!localTrace()) return undefined;
    const owner = session();
    let worker: object | undefined, revision: number | undefined;
    try { worker = authoringWorkerSnapshot(owner); revision = reader?.revision(); } catch { worker = undefined; }
    return { expr: props.expr!, owner, worker, revision,
      saved: new Map((savedCtx?.list() ?? []).map(option => [option.id, option.expr] as const)) };
  }, async request => {
    traceController?.abort();
    const controller = traceController = new AbortController();
    const job = evaluateExpressionInWorker(request.owner, request.expr, request.saved, controller.signal, undefined,
      { trace: true, priority: "guidance" });
    if (!job) throw new Error(NESTED_TOOLS_PENDING);
    const reply = await job;
    return { result: reply.result, trace: [...reply.trace] as TraceStep[] };
  });
  let shownTrace: ExpressionTraceSnapshot | undefined;
  const evaluated = createMemo((): ExpressionTraceSnapshot => {
    if (props.snapshot) return props.snapshot;
    if (!props.expr) return { result: undefined, trace: [] as TraceStep[] };
    if (localTrace()) {
      if (workerTrace.loading) return shownTrace ?? { result: undefined, trace: [] as TraceStep[] };
      const error = workerTrace.error;
      return shownTrace = error !== undefined ? { result: undefined, trace: [] as TraceStep[], error: error instanceof Error ? error.message : String(error) }
        : workerTrace() ?? { result: undefined, trace: [] as TraceStep[] };
    }
    try {
      return evaluateAuthoringExpression(props.expr, resolver(), session(), props.data);
    } catch (e) {
      return { result: undefined, trace: [] as TraceStep[], error: String(e) };
    }
  });

  const isPipe = () => props.viewMode === "pipe";

  return (
    <div class={["expr-trace", { "expr-trace--pipe": !!(isPipe()) }]}>
      <Show when={"error" in evaluated() && (evaluated() as ExpressionTraceSnapshot).error}>
        {(error) => <div class="expr-code-lens__error" role="alert">{error()}</div>}
      </Show>
      <Show
        when={evaluated().trace.length > 0}
        fallback={
          <div class="expr-trace__final">
            <div class="storybook-trace__cell-label mono">value</div>
            <ValueDisplay value={evaluated().result} />
          </div>
        }
      >
        <div class="storybook-trace__cell-label mono" style="margin-bottom: 0.4rem">trace</div>
        <Show when={isPipe()}>
          <div class="storybook-trace__step storybook-trace__step--initial">
            <div class="storybook-trace__step-head">
              <span class="storybook-trace__step-name mono text-muted">initial</span>
            </div>
            <div class="storybook-trace__cell">
              <ValueDisplay value={evaluated().trace[0]?.args[0]} />
            </div>
          </div>
        </Show>
        <For each={evaluated().trace}>
          {(step, i) => (
            <>
              <Show when={i() > 0 || isPipe()}>
                <div class="storybook-trace__arrow">↓</div>
              </Show>
              <div class="storybook-trace__step">
                <div class="storybook-trace__step-head">
                  <span class="storybook-trace__step-name mono">{fnCodeName(step.fnName)}</span>
                  <Show when={step.args.length > 1}>
                    <span class="storybook-trace__step-extras mono">
                      {step.args.slice(1).map(formatArg).join(", ")}
                    </span>
                  </Show>
                  <span class="storybook-trace__step-op">{step.op}</span>
                </div>
                <div class="storybook-trace__cell">
                  <ValueDisplay value={step.result} />
                </div>
              </div>
            </>
          )}
        </For>
      </Show>
    </div>
  );
}

// ---------------------------------------------------------------------------
// PrettyValue — structural renderer for trace outputs.
//
// `ValueDisplay` from storybook already handles media-typed values (images,
// audio, etc.) — it falls back to `<pre>JSON.stringify</pre>` for plain
// records / ADTs, which is what the trace overlay was showing as a raw blob.
// This renderer fills that gap: variants render as `Tag <value>` or
// `Tag { field: value }`, plain records as `{ field: value, ... }`, arrays
// as `[v, v, ...]`. Atoms still route through `RenderScalar` via
// `ValueDisplay` for consistency with the rest of the dashboard.
// ---------------------------------------------------------------------------

function PrettyValue(props: { value: unknown; depth?: number }) {
  const depth = () => props.depth ?? 0;
  const v = () => props.value;

  return (
    <Switch fallback={<ValueDisplay value={v()} />}>
      <Match when={v() === null}>
        <span class="pv-null mono">null</span>
      </Match>
      <Match when={v() === undefined}>
        <span class="pv-null mono">(none)</span>
      </Match>
      <Match when={typeof v() === "boolean"}>
        <span class={`pv-bool ${v() ? "pv-bool--t" : "pv-bool--f"}`}>{v() ? "✓ true" : "✗ false"}</span>
      </Match>
      <Match when={Array.isArray(v())}>
        <span class="pv-list mono">
          [
          <For each={v() as unknown[]}>
            {(item, i) => (
              <>
                {i() > 0 ? ", " : ""}
                <PrettyValue value={item} depth={depth() + 1} />
              </>
            )}
          </For>
          ]
        </span>
      </Match>
      <Match when={v() !== null && typeof v() === "object" && "$tag" in (v() as object)}>
        {(_) => {
          const obj = v() as Record<string, unknown>;
          const tag = String(obj.$tag);
          const fields = Object.entries(obj).filter(([k]) => k !== "$tag");
          // Single-`value` payload (Maybe / Result / similar) — render as
          // `Tag <inner>` instead of `Tag { value: <inner> }`. Reads more
          // like real Fenel.
          if (fields.length === 0) return <span class="pv-tag mono">{tag}</span>;
          if (fields.length === 1 && fields[0]![0] === "value") {
            return (
              <span class="pv-variant">
                <span class="pv-tag mono">{tag}</span>{" "}
                <PrettyValue value={fields[0]![1]} depth={depth() + 1} />
              </span>
            );
          }
          return (
            <span class="pv-variant">
              <span class="pv-tag mono">{tag}</span>{" "}
              <PrettyRecord entries={fields} depth={depth() + 1} />
            </span>
          );
        }}
      </Match>
      <Match when={v() !== null && typeof v() === "object"}>
        <PrettyRecord entries={Object.entries(v() as object)} depth={depth() + 1} />
      </Match>
    </Switch>
  );
}

function PrettyRecord(props: { entries: [string, unknown][]; depth?: number }) {
  const stacked = () => (props.depth ?? 0) === 0 && props.entries.length > 2;
  return (
    <span class={`pv-record mono ${stacked() ? "pv-record--stacked" : ""}`}>
      {"{"}
      <For each={props.entries}>
        {([k, v], i) => (
          <span class="pv-record__entry">
            {i() > 0 ? <span class="pv-record__sep">,</span> : null}
            <span class="pv-key">{k}</span>
            <span class="pv-eq">:</span>
            <PrettyValue value={v} depth={(props.depth ?? 0) + 1} />
          </span>
        )}
      </For>
      {"}"}
    </span>
  );
}

/** Compact one-line representation of `value`, capped at ~64 chars. Used in
 *  the badge's collapsed state so it fits on a single line next to the
 *  binding name without pushing other UI around. */
function inlineSummary(value: unknown): string {
  if (value === null) return "null";
  if (value === undefined) return "(none)";
  if (typeof value === "boolean") return value ? "true" : "false";
  if (typeof value === "number") return String(value);
  if (typeof value === "string") return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.length}]`;
  if (typeof value === "object") {
    const o = value as Record<string, unknown>;
    if ("$tag" in o) {
      const tag = String(o.$tag);
      const fields = Object.entries(o).filter(([k]) => k !== "$tag");
      if (fields.length === 0) return tag;
      if (fields.length === 1 && fields[0]![0] === "value") {
        return `${tag} ${inlineSummary(fields[0]![1])}`;
      }
      return `${tag} { … }`;
    }
    const keys = Object.keys(o);
    if (keys.length === 0) return "{}";
    if (keys.length <= 2) {
      return `{ ${keys.map((k) => `${k}: ${inlineSummary(o[k])}`).join(", ")} }`;
    }
    return `{ ${keys[0]}, ${keys[1]}, … }`;
  }
  return String(value);
}

// ---------------------------------------------------------------------------
// TraceBadge — compact, click-to-expand value chip for the instance overlay.
//
// Collapsed state is a single-line summary (`▸ Ok { id: …, … }`) that fits
// under a binding name without crowding the row. Click opens a small
// popover anchored to the trigger with the full pretty-rendered value +
// trace metadata. Click-outside dismisses.
// ---------------------------------------------------------------------------

export function TraceBadge(props: { trace: InstanceTrace; typeName?: string }) {
  const [open, setOpen] = createSignal(false);
  let triggerRef: HTMLSpanElement | undefined;

  const statusClass = () =>
    props.trace.status === "failed"
      ? "expr-trace-badge--failed"
      : props.trace.status === "completed"
      ? "expr-trace-badge--ok"
      : "expr-trace-badge--running";

  // Click-outside dismissal: only attach the listener while the popover is
  // open. Without this, every badge on the page would track every document
  // click, which adds up fast in a deep editor tree.
  createEffect(
    () => open(),
    (isOpen) => {
      if (!isOpen) return;
      const onDocClick = (e: MouseEvent) => {
        if (triggerRef && !triggerRef.contains(e.target as Node)) setOpen(false);
      };
      const onKey = (e: KeyboardEvent) => {
        if (e.key === "Escape") setOpen(false);
      };
      document.addEventListener("mousedown", onDocClick);
      document.addEventListener("keydown", onKey);
      return () => {
        document.removeEventListener("mousedown", onDocClick);
        document.removeEventListener("keydown", onKey);
      };
    },
  );

  const summary = createMemo(() =>
    props.trace.status === "failed"
      ? peelMaybeValue(props.trace.error) ?? "error"
      : inlineSummary(peelMaybeValue(props.trace.output)),
  );

  return (
    <span class={["expr-trace-badge", { [statusClass()]: true }]} ref={(el) => (triggerRef = el)}>
      <button
        type="button"
        class="expr-trace-badge__trigger"
        onClick={() => setOpen(!open())}
        data-tooltip="Click to expand the runtime value"
      >
        <span class="expr-trace-badge__arrow">{open() ? "▾" : "▸"}</span>
        <span class="expr-trace-badge__summary">{summary()}</span>
      </button>
      <Show when={open()}>
        <div class="expr-trace-badge__popover">
          <div class="expr-trace-badge__popover-value">
            <Show
              when={props.trace.status !== "failed"}
              fallback={<span class="expr-trace-badge__err mono">{peelMaybeValue(props.trace.error) ?? "(error)"}</span>}
            >
              <PrettyValue value={peelMaybeValue(props.trace.output)} />
            </Show>
          </div>
          <div class="expr-trace-badge__detail">
            <Show when={props.trace.durationMs.$tag === "Just"}>
              <div class="expr-trace-badge__row">
                <span class="expr-trace-badge__label mono">duration</span>
                <span class="mono">{peelMaybeValue(props.trace.durationMs)}ms</span>
              </div>
            </Show>
            <Show when={peelMaybeValue(props.trace.stepPath)}>
              <div class="expr-trace-badge__row">
                <span class="expr-trace-badge__label mono">step</span>
                <span class="mono">{peelMaybeValue(props.trace.stepPath)}</span>
              </div>
            </Show>
            <Show when={props.trace.kind}>
              <div class="expr-trace-badge__row">
                <span class="expr-trace-badge__label mono">kind</span>
                <span class="mono">{props.trace.kind}</span>
              </div>
            </Show>
          </div>
        </div>
      </Show>
    </span>
  );
}

/** Look up the bound value for `name` in the active instance overlay (if
 *  any) and render it. No-op when no instance is selected or the binding
 *  hasn't been observed yet. */
function LetTraceBadge(props: { name: string }) {
  const traceCtxAccessor = useContext(InstanceTraceContext);
  const trace = createMemo(() => traceCtxAccessor()?.byLet(props.name)[0]);
  return (
    <Show when={trace()}>
      {(t) => <TraceBadge trace={t()} />}
    </Show>
  );
}

/** Look up traces for a call site (by fnId / codeName) and render the
 *  first matching one. Used inside call-mode NodeEditor headers. */
function CallTraceBadge(props: { fnName: string }) {
  const traceCtxAccessor = useContext(InstanceTraceContext);
  const trace = createMemo(() => traceCtxAccessor()?.byCall(props.fnName)[0]);
  return (
    <Show when={trace()}>
      {(t) => <TraceBadge trace={t()} />}
    </Show>
  );
}

// ---------------------------------------------------------------------------
// ExprFieldShell — single source of truth for the [label, mode toggle,
// content] structure. Used by NodeEditor (top-level) and NestedExprWrapper
// (nested). The caller drives mode state and content; the shell only owns
// the structural ordering and styling, so a top-level field and a nested
// field render identically (label first, toggle second, body third).
// ---------------------------------------------------------------------------

function PreparedExprFieldShell(props: {
  /** Field info — used to render the label. Either pass a FieldDef
   *  (preferred — drives all four label pieces) or pass paramName/typeName
   *  directly for callers that don't have a FieldDef in hand. */
  field?: FieldDef;
  fieldScheme?: TypeScheme;
  paramName?: string;
  typeName?: string;
  hideLabel?: boolean;
  /** Mode state. Caller owns the underlying state representation. */
  mode: () => Mode;
  switchTo: (m: Mode) => void;
  /** CSS class for the content slot; controls picker positioning rules. */
  contentClass?: string;
  /** Whether to surface the "param" mode when lambda params are in scope.
   *  Only NodeEditor opts in; nested wrappers leave it off. */
  paramMode?: boolean;
  unifiedUse?: boolean;
  expressionForms?: boolean;
  inlineAvailable?: boolean;
  nodeKind?: ExprNode["kind"];
  graphBody?: JSX.Element;
  graphCaption?: DisplayNameInput;
  graphCaptionOverride?: boolean;
  graphIcon?: string;
  graphEmoji?: string;
  graphTypeLabel?: string;
  /** Lane D: the occurrence's type is still being inferred. */
  graphTypePending?: boolean;
  graphTypeIcon?: string;
  graphType?: FenelType;
  graphEdgeLabel?: (inspect: () => void) => JSX.Element;
  graphSlotPreview?: (unfold: () => void) => JSX.Element;
  graphEligible?: boolean;
  empty?: boolean;
  onReplace?: () => void;
  onAddFunction?: () => void;
  onInsertCall?: () => void;
  onInsertBefore?: () => void;
  onInsertAfter?: () => void;
  onMoveUp?: () => void;
  onMoveDown?: () => void;
  onNameResult?: () => void;
  graphError?: string;
  onAddBinding?: () => void;
  onRemove?: () => void;
  suggestionOwner?: DataInspectionSuggestions;
  pendingInsert?: () => JSX.Element;
  onPendingInsertClose?: () => void;
  children: any;
}) {
  const session = useAuthoringSession();
  const saved = useContext(SavedValuesContext);
  const lambdaParams = useContext(LambdaParamsContext);
  const reader = useReaderRuntime();
  const namedField = () => props.field?.key?.$tag === "NamedField" ? props.field : undefined;
  const graphCaption = createMemo((): DisplayNameInput => {
    const field = namedField();
    if (field) return editorParameterName(field, 0, session, reader);
    const name = props.paramName || props.field?.name;
    return canonical(peelMaybeValue(props.field?.label) ?? "") || (name ? codeName(name) : undefined);
  });
  const typeIcon = () => props.graphTypeIcon ?? preparedTypeIcon(props.graphType ?? props.field?.type
    ?? (props.typeName ? { $ref: props.typeName } : undefined), session, reader);
  /** Display only: `typeName` stays this slot's semantic spelling (a handle). */
  const typeCaption = createMemo(() => editorTypeCaption(props.field?.type
    ?? (props.typeName ? { $ref: props.typeName } : undefined), session, reader, props.typeName));
  return <ExprFieldShell mode={props.mode()} switchTo={props.switchTo}
    suggestionOwner={props.suggestionOwner}
    graphEligible={props.graphEligible} empty={props.empty}
    onReplace={props.onReplace} onAddFunction={props.onAddFunction} onAddBinding={props.onAddBinding} onRemove={props.onRemove}
    onInsertCall={props.onInsertCall} onInsertBefore={props.onInsertBefore} onInsertAfter={props.onInsertAfter} graphError={props.graphError}
    onMoveUp={props.onMoveUp} onMoveDown={props.onMoveDown}
    onNameResult={props.onNameResult}
    pendingInsert={props.pendingInsert} onPendingInsertClose={props.onPendingInsertClose}
    graphUnnamed={props.graphCaptionOverride && !displayNameText(props.graphCaption)?.trim()}
    nodeKind={props.nodeKind} graphBody={props.graphBody} inspectorLabel={graphCaption() ?? props.graphCaption ?? "Expression"}
    graphSourceKind={props.nodeKind === "call" ? "computed" : "data"}
    graphEdgeLabel={props.graphEdgeLabel} graphSlotPreview={props.graphSlotPreview}
    graphHeading={<ValueCardCaption caption={props.graphCaptionOverride ? props.graphCaption : props.graphCaption ?? graphCaption()} icon={props.graphIcon} emoji={props.graphEmoji}
      typeLabel={props.graphTypeLabel ?? typeCaption()} typeIcon={typeIcon()}
      typePending={!!props.graphTypePending && !(props.graphTypeLabel ?? typeCaption())} />}
    label={<Show when={props.field || props.paramName || props.typeName}>
      <FieldLabel registry={editorFieldRegistry(session, reader)} field={namedField()}
        name={namedField() ? undefined : (canonical(peelMaybeValue(props.field?.label) ?? "") || props.paramName) ?? props.field?.name}
        typePresentation="data"
        typeIcon={typeIcon()}
        typeName={props.typeName !== undefined ? typeCaption() : (!namedField() && props.field
          ? props.fieldScheme?.quantified.length ? typeCode(props.fieldScheme.body) : typeCaption() : undefined)}
        required={false} />
    </Show>}
    hideLabel={props.hideLabel} contentClass={props.contentClass}
    savedReferencesAvailable={!!saved} paramAvailable={!!props.paramMode && lambdaParams().length > 0}
    unifiedUse={props.unifiedUse} expressionForms={props.expressionForms} inlineAvailable={props.inlineAvailable}>
    {props.children}
  </ExprFieldShell>;
}

// ---------------------------------------------------------------------------
// Recursive node editor
// ---------------------------------------------------------------------------

type ResultBindingContinuation = {
  node: () => ExprNode;
  root: () => ExprNode;
  path: () => (string | number)[];
  apply: (next: ExprNode) => void;
};
const ResultBindingContext = createContext<ResultBindingContinuation | null>(null);

/** Transport the actual argument occurrence. Structural children establish
 * their own continuation so this host carrier never widens lexical scope. */
function ResultBindingInput(props: { node: ExprNode; index: number; children: JSX.Element }) {
  const parent = useContext(ResultBindingContext);
  if (!parent) return <>{props.children}</>;
  return <ResultBindingContext value={{
    node: () => props.node, root: parent.root,
    path: () => [...parent.path(), "args", props.index], apply: parent.apply,
  }}>{props.children}</ResultBindingContext>;
}

type NodeEditorProps = {
  node: ExprNode;
  onChange: (next: ExprNode) => void;
  typeName: string | undefined;
  paramName?: string;
  fieldDef?: FieldDef;
  expectedType?: FenelType;
  expectedScheme?: TypeScheme;
  observeMembershipHints?: MembershipHintObserver;
  expectedOutcome?: InferenceOutcome;
  detachSuggestionContext?: boolean;
  hideResultGuidance?: boolean;
  deferFunctionChoices?: boolean;
  hideLabel?: boolean;
  allowLocalBindings?: boolean;
  suppressAnnotationCreate?: boolean;
  /** Plain words for the place whose requirement this slot receives,
   * e.g. "Reverse › Items". */
  requirementSource?: string;
  /** A declared constraint held by an owner outside this expression (a
   * binding's type, a data item's type). It is also this slot's check. */
  declaredType?: FenelType;
  /** The owner's write; without it the declared type is shown read-only. */
  onDeclaredTypeChange?: (type: FenelType | undefined) => void;
  /** Why an owner-held declared type cannot be edited here. */
  declaredReadonly?: string;
  /** Further type actions of this occurrence (e.g. explore the type). */
  typeMenuItems?: readonly LocusMenuItem[];
  /** A parent already shows this occurrence's type contract. */
  hideTypeContract?: boolean;
  /** The parent call moves this step (its first input) down past itself. */
  onMoveDown?: () => void;
  viewMode: ExprViewMode;
};

/** The insertion pending in a graph dialog: its preview stands in the draft's
 * place in this lens only (dashed, not code) until it is confirmed. */
const pendingCalls = new WeakSet<ExprNode>();
const PENDING_FUNCTION_ID = "@pending/choose-function";

/** One occurrence of the recursive editor. A pending insertion is lens-level
 * state over the draft: the body renders its preview in place of the node,
 * while edits stay on the real node and nothing is written until the
 * insertion is confirmed. */
function NodeEditor(props: NodeEditorProps) {
  const [pending, setPending] = createSignal<{ preview: () => ExprNode | undefined }>({ preview: () => undefined }, { ownedWrite: true });
  const shown = () => pending().preview() ?? props.node;
  return <NodeEditorBody {...props} node={shown()} realNode={props.node}
    registerPending={preview => setPending({ preview })}
    commitChange={props.onChange}
    onChange={next => { if (!untrack(() => pending().preview())) props.onChange(next); }} />;
}

function NodeEditorBody(props: NodeEditorProps & {
  /** The draft's node while a pending insertion previews in its place. */
  realNode?: ExprNode;
  registerPending?: (preview: () => ExprNode | undefined) => void;
  /** The unguarded write that confirms a pending insertion. */
  commitChange?: (next: ExprNode) => void;
}) {
  const graphValue = useContext(ExpressionGraphValueContext);
  const graphAuthoring = useContext(ExpressionGraphAuthoringContext);
  const inheritedScopeCapture = useContext(ExpressionGraphScopeCaptureContext);
  const parentResultBinding = useContext(ResultBindingContext);
  const parentSuggestionDraft = useContext(SuggestionDraftContext);
  const parentSuggestionCheck = useContext(SuggestionCheckContext);
  const suggestionDraft = parentSuggestionDraft ?? (() => props.node);
  const resultBindingContinuation = (): ResultBindingContinuation => parentResultBinding?.node() === props.node
    ? parentResultBinding : { node: () => props.node, root: () => props.node, path: () => [], apply: props.onChange };
  const resultBindingScope: ResultBindingContinuation = {
    node: () => props.node, root: () => resultBindingContinuation().root(),
    path: () => resultBindingContinuation().path(), apply: next => resultBindingContinuation().apply(next),
  };
  const session = useAuthoringSession();
  const transferSaved = useContext(SavedValuesContext);
  const reader = useReaderRuntime();
  const guidance = useContext(ExpressionGuidanceContext) ?? undefined;
  const graphCaptureContext = useContext(ExpressionGraphCaptureContext);
  const params = useContext(LambdaParamsContext);
  const recordValues = useContext(RecordValuesContext);
  // Depth check — once we're nested past the limit, render a collapse
  // stub instead of the full editor body. The stub's "expand →" button
  // opens a modal showing this same NodeEditor at depth 0 (so it renders
  // inline) with the breadcrumb trail above. The onChange closure is
  // captured into the modal's render thunk, so edits inside the modal
  // propagate back to the parent tree as if nothing changed.
  const pathCtx = useContext(EditorPathContext);
  if (pathCtx.depth >= NODE_DEPTH_LIMIT && pathCtx.openModal && untrack(() => pathCtx.fold?.())) {
    const fullPath = pathCtx.path;
    const openModal = pathCtx.openModal;
    return (
      <CollapseStub
        summary={summarizeNode(props.node, session, params().map((param) => param.name))}
        onExpand={() => openModal(fullPath, () =>
          <SuggestionCheckContext value={parentSuggestionCheck}>
            <SuggestionDraftContext value={suggestionDraft}>
              <LambdaParamsContext value={params}>
                <RecordValuesContext value={recordValues}>
                  <SavedValuesContext value={transferSaved}>
                    <ResultBindingContext value={parentResultBinding}>
                      <ExpressionGraphScopeCaptureContext value={inheritedScopeCapture}>
                        <NodeEditorBody {...props} />
                      </ExpressionGraphScopeCaptureContext>
                    </ResultBindingContext>
                  </SavedValuesContext>
                </RecordValuesContext>
              </LambdaParamsContext>
            </SuggestionDraftContext>
          </SuggestionCheckContext>)}
      />
    );
  }
  let typePickerGeneration = 0;
  let typePickerAlive = true;
  onSettled(() => () => { typePickerAlive = false; typePickerGeneration++; });
  const [picking, setPicking] = createSignal(false);
  const [pickingRef, setPickingRef] = createSignal(false);
  const [pickingParam, setPickingParam] = createSignal(false);
  const [pickingUse, setPickingUse] = createSignal(false);
  const [wrapping, setWrapping] = createSignal(false);
  const [wrappingBefore, setWrappingBefore] = createSignal(false);
  // An insertion started from the graph's menus opens its own dialog and
  // previews in the lens; "Use this result" keeps the inline picker.
  const [insertDialog, setInsertDialog] = createSignal(false);
  const [previewFunction, setPreviewFunction] = createSignal<string>();
  const [callEditIssue, setCallEditIssue] = createSignal<string>();
  const [namingResult, setNamingResult] = createSignal(false);
  const [resultBindingName, setResultBindingName] = createSignal("result");
  const [resultBindingIssue, setResultBindingIssue] = createSignal<string>();
  const [resultBindingProposal, setResultBindingProposal] = createSignal<{
    root: ExprNode; epoch: number; session: AuthoringSession; bindingsKey: string;
    value: Extract<ReturnType<typeof proposeAuthoringResultBinding>, { ok: true }>["value"];
  }>();
  // `codeView` is a read-only lens over the current ExprNode — toggling
  // it shows the printed Fenel syntax of the subtree without mutating
  // anything. Independent of the other picker signals because it doesn't
  // conflict with them logically (you might toggle code-on briefly even
  // mid-edit). When on, the structural content slot below is replaced
  // by a `<pre>` block.
  const [codeView, setCodeView] = createSignal(false);
  const claim = useContext(ActivePickerContext);
  // Read the surrounding record's values so any `$el` references in this
  // field's type get resolved before being passed to call/ref/param
  // pickers (which filter functions / saved values / params by structural
  // type match — and an unresolved `$el` matches nothing useful).
  const resolvedFieldType = createMemo(() =>
    props.expectedScheme?.body ?? props.expectedType ?? (props.fieldDef
      ? resolveElInType(session, props.fieldDef.type, recordValues())
      : props.declaredType ?? expectedTypeForName(props.typeName, editorEnvironment(session))),
  );
  const effectiveField = createMemo(() => {
    const type = resolvedFieldType();
    return type ? { ...(props.fieldDef ?? expressionField(type, props.paramName)!), type } : undefined;
  });
  const expectedScheme = createMemo(() => props.expectedScheme
    ?? expectedSchemeForType(resolvedFieldType(), editorEnvironment(session)));
  const [literalHintSource, setLiteralHintSource] = createSignal<MembershipHintSource>();
  const observeLiteralHints: MembershipHintObserver = source => {
    const owned = { ...source, occurrence: () => props.node };
    setLiteralHintSource(owned);
    const release = props.observeMembershipHints?.(owned);
    return () => {
      release?.();
      setLiteralHintSource(current => current === owned ? undefined : current);
    };
  };
  const inferenceContext = useExpressionInferenceContext(session);
  const inlineWidgetState = createMemo(() => {
    const value = props.node.kind === "literal" ? props.node.value : undefined;
    const type = widgetTypeForSlot(resolvedFieldType(), value);
    const compute = () => inlineWidgetFor(type, props.typeName, editorWidgetEnvironment(session, reader));
    // A Local slot whose exact type reference its worker has not answered yet
    // has no known capability: it waits instead of opening the function search.
    if (reader?.kind !== "local" || !reader.observePending || !localStructure(session)) return { widget: compute(), pending: false };
    const observed = reader.observePending(compute);
    return { widget: observed.value, pending: observed.value === undefined && observed.pending && !observed.failed };
  });
  const inlineWidget = () => inlineWidgetState().widget;
  const genericSlot = () => resolvedFieldType() === undefined || "$var" in resolvedFieldType()!;
  const needsChoice = () => props.node.kind === "literal"
    && !detectStructuralForm(props.node.value)
    && !isEditableTypeLiteral(props.node.value, session)
    && !refLiteralId(props.node)
    && inlineWidget() === undefined
    && !inlineWidgetState().pending;

  function closePicker() {
    typePickerGeneration++;
    setPicking(false);
    setPickingRef(false);
    setPickingParam(false);
    setPickingUse(false);
    setWrapping(false);
    setWrappingBefore(false);
    setInsertDialog(false);
    setPreviewFunction(undefined);
  }

  function isPickingAny() {
    return picking() || pickingRef() || pickingParam() || pickingUse() || wrapping();
  }

  createEffect(
    () => isPickingAny(),
    (picking) => {
      if (!picking) return;
      const release = claim?.(closePicker);
      return () => release?.();
    },
  );

  const mode = (): Mode => {
    if (codeView()) return "code";
    if (isPickingAny()) return "use";
    const structuralMode = structuralModeForNode(props.node);
    if (structuralMode) return structuralMode;
    if (props.node.kind === "literal" && isEditableTypeLiteral(props.node.value, session)) return "type";
    if (props.node.kind === "literal" && detectStructuralForm(props.node.value)) return "use";
    if (props.node.kind === "literal" && refLiteralId(props.node)) return "use";
    if (props.node.kind === "call" || props.node.kind === "ref" || props.node.kind === "param") return "use";
    if (needsChoice()) return "use";
    return "inline";
  };

  function setLiteral(value: unknown) {
    props.onChange({ kind: "literal", value });
  }

  function pickFunction(fnId: string) {
    const entry = authoringFunctionEntry(session, fnId);
    if (!entry) return;
    const guided = inferAuthoringCallGuidance(entry, registryCallParams(entry).map(() => EMPTY_EXPRESSION),
      expectedScheme() ?? resolvedFieldType(), inferenceContext());
    const args = guided.params.map((param) => seedExpressionForType(param.type, editorEnvironment(session)));
    props.onChange(entry.kind === "constructor"
      ? constructorExpression(entry.targetId ?? fnId, guided.params, args)
      : { kind: "call", fnId, args });
    setPicking(false);
    setPickingUse(false);
  }

  function pickLocalFunction(param: LambdaParam) {
    const type = peelArrowType(param.type, session);
    if (!type || !("$arrow" in type)) return;
    if (param.typeApplication?.ready === false) return;
    props.onChange({ kind: "literal", value: { __apply: {
      target: { kind: "param", name: param.name },
      args: (param.typeApplication?.params ?? type.$arrow.params).map((parameter, index) => param.typeApplication?.seeds[index]
        ? { kind: "param", name: param.typeApplication.seeds[index] } as ExprNode
        : isTypeMetaType(parameter.type)
        ? seedStructuralNode("type", EMPTY_EXPRESSION, parameter.type, undefined, session)!
        : seedExpressionForType(parameter.type, editorEnvironment(session))),
      syntax: "call",
    } } });
    closePicker();
  }

  function pickRef(savedExprId: string) {
    props.onChange({ kind: "ref", savedExprId });
    setPickingRef(false);
    setPickingUse(false);
  }

  // The shared picker has already checked this reference in its held reader.
  // Transport it unchanged into the existing type-as-value literal form.
  function pickTypeRef(selection: TypePickerSelection) {
    if (!typePickerAlive || selection.kind !== "type") return;
    setLiteral({ $ref: selection.reference } as unknown as Record<string, unknown>);
    closePicker();
  }

  // Producer P4 — nominate a function as a typed value. Mirrors
  // `pickTypeRef` (which emits a `{$named}` literal for a type field):
  // a function reference is a `{$ref: id}` literal that the engine
  // self-evaluates and applies through any HOF (Phase 2). No new
  // ExprNode kind — it's a literal carrying the `Ref` value form.
  function pickFunctionRef(fnId: string) {
    setLiteral({ $ref: fnId });
    setPickingRef(false);
    setPickingUse(false);
  }

  function pickParam(name: string) {
    props.onChange({ kind: "param", name });
    setPickingParam(false);
    setPickingUse(false);
  }

  const isTypeField = createMemo(() => isTypeMetaType(resolvedFieldType()));
  // A function-typed slot (peeling refined/opaque) wants a *function* —
  // ref-mode offers the FunctionPicker so the user can pass one point-free.
  const isArrowField = createMemo(() => peelArrowType(resolvedFieldType(), session) !== undefined);
  // Ranking starts when the shared function picker is opened.
  const expectedRecordFields = createMemo(() => expectedRecordFieldsFor(resolvedFieldType(), session));

  function clearToLiteral() {
    if (inlineWidget()) {
      props.onChange(seedExpressionForType(resolvedFieldType(), editorWidgetEnvironment(session, reader), props.typeName));
    } else {
      setPickingUse(true);
    }
  }

  function switchTo(m: Mode) {
    typePickerGeneration++;
    if (m === "code") {
      // Toggle: clicking `code` again exits back to whatever the node
      // already was (no clear needed — code is non-destructive). All
      // other picker signals stay where they were so the previous
      // editing mode is restored on exit.
      setCodeView(!codeView());
      return;
    }
    // Any non-code switch exits the code lens automatically.
    setCodeView(false);
    setWrapping(false);
    setWrappingBefore(false);
    if (m === "use") {
      setPicking(false);
      setPickingRef(false);
      setPickingParam(false);
      setPickingUse(true);
      return;
    }
    if (isStructuralMode(m)) {
      setPicking(false);
      setPickingRef(false);
      setPickingParam(false);
      setPickingUse(false);
      const next = seedStructuralNode(
        m,
        props.node,
        resolvedFieldType(),
        expectedRecordFields(),
        session,
      );
      if (next) props.onChange(next);
      return;
    }
    if (m === "inline") {
      if (!inlineWidget()) return;
      setPicking(false);
      setPickingRef(false);
      setPickingParam(false);
      setPickingUse(false);
      if (props.node.kind !== "literal" || detectStructuralForm(props.node.value)) clearToLiteral();
    } else if (m === "call") {
      setPickingRef(false);
      setPickingParam(false);
      setPickingUse(false);
      setPicking(true);
    } else if (m === "ref") {
      setPicking(false);
      setPickingParam(false);
      setPickingUse(false);
      setPickingRef(true);
    } else {
      setPicking(false);
      setPickingRef(false);
      setPickingUse(false);
      setPickingParam(true);
    }
  }

  const isPipeEligible = () =>
    props.viewMode === "pipe" &&
    props.node.kind === "call" &&
    props.node.args[0]?.kind === "call";
  /** The requirement `resultGuidance` judges this slot's result against. */
  const resultRequirement = createMemo(() => {
    const expected = resolvedFieldType();
    if (!expected) return undefined;
    const scheme = expectedScheme();
    return { expected, ...(scheme ? { scheme } : {}), label: editorTypeCaption(expected, session, reader, props.typeName)! };
  });
  const currentInference = createMemo(() => {
    if (props.node.kind === "literal" && props.node.value === undefined) return undefined;
    const concrete = genericSlot() && props.node.kind === "literal" && inlineWidget()
      ? widgetTypeForSlot(undefined, props.node.value) : undefined;
    const expected = concrete ? expectedSchemeForType(concrete, editorEnvironment(session)) ?? { quantified: [], body: concrete }
      : expectedScheme() ?? (resolvedFieldType() ? { quantified: [], body: resolvedFieldType()! } : undefined);
    // B4 slice 2: a Local reader's worker infers, and judges the result
    // against this slot's requirement in the same item (`resultGuidance`).
    if (guidance) return guidance.read({ node: props.node, ...(expected ? { expectedScheme: expected } : {}),
      bindings: inferenceContext().bindings ?? {}, ...(resultRequirement() ? { judge: resultRequirement()! } : {}) });
    return measureAuthoringWork("current expression inference", () => inferScopedAuthoringExpression(props.node, inferenceContext(), { expectedScheme: expected }));
  });
  const graphData = createMemo<ExpressionGraphValue | undefined>(() => {
    const observed = graphValue?.(props.node);
    const inferred = observed?.type ? undefined : currentInference();
    const solvedType = inferred?.outcome.$tag === "Solved" ? inferred.scheme?.body ?? inferred.type : undefined;
    if (observed) {
      const type = observed.type ?? solvedType ?? resolvedFieldType();
      return { ...observed, type, typeIcon: observed.typeIcon ?? preparedTypeIcon(type, session, reader, observed.value) };
    }
    return props.node.kind === "literal" && props.node.value !== undefined && !detectStructuralForm(props.node.value)
      ? { value: props.node.value, type: solvedType ?? resolvedFieldType(),
        typeIcon: preparedTypeIcon(solvedType ?? resolvedFieldType(), session, reader, props.node.value) } : undefined;
  });
  const graphType = () => {
    const inferred = currentInference();
    return graphData()?.type ?? (inferred?.outcome.$tag === "Solved" ? inferred.scheme?.body ?? inferred.type : undefined);
  };
  const graphTypeLabel = () => {
    const data = graphData();
    if (data?.typeLabel) return data.typeLabel;
    const type = graphType();
    return type ? editorTypePhrase(type, session, reader) : undefined;
  };
  const graphIdentity = (): DisplayNameInput => props.node.kind === "ref" ? transferSaved?.byId(props.node.savedExprId)?.name
    : props.node.kind === "param" ? codeName(props.node.name) : undefined;
  const graphList = () => { const form = props.node.kind === "literal" ? detectStructuralForm(props.node.value) : null; return form?.kind === "list" ? form.content : undefined; };
  const graphListData = (node: ExprNode): ExpressionGraphValue | undefined => {
    const observed = graphValue?.(node);
    const parent = graphType() ?? resolvedFieldType();
    const element = parent ? peelList(parent)?.elem : undefined;
    const caption: DisplayNameInput = node.kind === "param" ? codeName(node.name) : node.kind === "ref" ? transferSaved?.byId(node.savedExprId)?.name : undefined;
    const value = observed ? observed.value : node.kind === "literal" ? node.value : undefined;
    const type = localStructure(session) ? localGraphDisplayType(value, element, observed?.type, reader)
      : typedReadDisplayType(value, element, session, undefined, observed?.type);
    // B4 wave 4 lane E: a Local reader's caption is its worker type presentation.
    const typeLabel = (shown: FenelType | undefined) => localStructure(session)
      ? (shown ? editorTypePhrase(shown, session, reader) : undefined) || "Anything" : typedReadTypeLabel(shown, session, reader);
    const currentBadge = observed?.type !== undefined && type === observed.type;
    return observed ? { ...observed, caption: observed.caption ?? caption, type,
      typeLabel: (currentBadge ? observed.typeLabel : undefined) || typeLabel(type),
      typeIcon: (currentBadge ? observed.typeIcon : undefined) ?? preparedTypeIcon(type, session, reader, value) }
      : node.kind === "literal" && node.value !== undefined && !detectStructuralForm(node.value)
        ? { value: node.value, type, typeLabel: typeLabel(type),
          typeIcon: preparedTypeIcon(type, session, reader, node.value) } : undefined;
  };
  const graphCallableName = (handle: string) => {
    const entry = authoringFunctionEntry(session, handle);
    return entry ? functionPickerDisplayName(entry) : undefined;
  };
  const graphThumbnail = () => <TypedReadValue value={graphData()?.value} type={graphType()}
    valueIcon={graphData()?.valueIcon} valueEmoji={graphData()?.valueEmoji} thumbnail />;
  const graphReadBody = (compact = false, onOpenData?: (child: ContainedValuePreview) => void, data?: ExpressionGraphValue, detail = false,
    occurrence?: DataReadOccurrence) =>
    <TypedReadValue value={data ? data.value : graphData()?.value} type={data ? data.type : graphType()}
      valueIcon={data ? data.valueIcon : graphData()?.valueIcon} callableName={graphCallableName}
      occurrence={occurrence?.source ?? suggestionSource()} dataPath={occurrence?.path}
      compact={compact} detail={detail} onOpenData={onOpenData} />;
  /** The draft's own node: a pending insertion previews over it, never in it. */
  const real = () => props.realNode ?? props.node;
  const wrappingInput = () => { const node = real(); return wrappingBefore() && node.kind === "call" ? node.args[0] : node; };
  const wrappingExpected = createMemo(() => {
    const node = real();
    if (!wrappingBefore() || node.kind !== "call") return expectedScheme() ?? resolvedFieldType();
    const entry = authoringFunctionEntry(session, node.fnId, node.args.length);
    if (!entry) return undefined;
    const guided = callArgumentPlan(node, entry, expectedScheme() ?? resolvedFieldType(), inferenceContext());
    return guided.paramSchemes[0] ?? guided.params[0]?.type;
  });
  const wrappingExpectedScheme = () => {
    const expected = wrappingExpected();
    return expected && "quantified" in expected ? expected as TypeScheme : undefined;
  };
  const wrappingInference = createMemo(() => {
    const node = wrappingInput();
    if (!node || !wrapping()) return undefined;
    const wanted = wrappingExpected();
    const expected = wrappingExpectedScheme() ?? (wanted ? { quantified: [], body: wanted as FenelType } : undefined);
    const item: ExpressionInferenceItem = { node, bindings: inferenceContext().bindings ?? {},
      ...(expected ? { expectedScheme: expected } : {}) };
    return readWrappingInputInference(item, request => {
      // Local readers resolve the transported expectation and check membership
      // in their captured worker. The page reads no registry/frame here.
      if (guidance) return guidance.read(request);
      const scheme = request.expectedScheme && !localStructure(session)
        ? scopedResultRequirement(session, { expected: request.expectedScheme.body, scheme: request.expectedScheme }).scheme
        : request.expectedScheme;
      const inferred = inferScopedAuthoringExpression(request.node, inferenceContext(),
        scheme ? { expectedScheme: scheme } : {});
      const compatibility = request.compatibility && !localStructure(session)
        ? scopedExpectedType(session, request.compatibility) : undefined;
      if (compatibility === undefined) return inferred;
      let match: ExpressionInferenceReply["compatibility"] = "unknown";
      if (inferred.scheme) {
        try { match = judgeAuthoringSchemeCompatibility(inferred.scheme, compatibility, editorContainment(session)); }
        catch { /* The existing worker compatibility check also abstains on failure. */ }
      }
      return { ...inferred, compatibility: match };
    });
  });
  const wrappingScheme = createMemo(() => {
    const inferred = wrappingInference();
    return inferred?.outcome.$tag === "Solved" ? inferred.scheme : undefined;
  });
  /** Both contextual and fallback requests keep the same latest-wins capture;
   * a pending input never ranks by the result requirement alone. */
  const wrappingInputPending = createMemo(() => !!wrappingInput() && wrapping() && !!guidance
    && wrappingInference() === undefined && guidance.busy());
  /** Where the inserted call's result goes, in plain words: before a call it
   * fills that call's first input; otherwise it takes this slot's place. */
  const wrappingRequirementSource = () => {
    const node = real();
    if (!wrappingBefore() || node.kind !== "call") return props.requirementSource;
    const entry = authoringFunctionEntry(session, node.fnId, node.args.length);
    const first = entry ? registryCallParams(entry)[0] : undefined;
    return entry && first ? `${functionPickerDisplayName(entry)} › ${displayNameText(editorParameterName(first, 0, session, reader))}` : undefined;
  };
  function startWrapping(before = false, dialog = false) {
    closePicker();
    setCallEditIssue(undefined);
    setWrappingBefore(before);
    setInsertDialog(dialog);
    setWrapping(true);
  }
  /** The same call edit for the preview and the confirmed insertion. With no
   * function chosen yet the inserted call is a pending placeholder. */
  function buildWrap(fnId: string | undefined) {
    const current = wrappingInput();
    if (!current) return undefined;
    let call: ExprNode;
    if (fnId === undefined) call = { kind: "call", fnId: PENDING_FUNCTION_ID, args: [current] };
    else {
      const entry = authoringFunctionEntry(session, fnId);
      if (!entry || registryCallParams(entry).length === 0) return undefined;
      const guided = inferAuthoringCallGuidance(entry, registryCallParams(entry).map((_, index) => index === 0 ? current : EMPTY_EXPRESSION),
        wrappingExpected(), inferenceContext());
      // The wrapped expression fills the first input. Every other input stays an
      // open slot the user sees and fills, never a value chosen on their behalf.
      const args = [current, ...guided.params.slice(1).map(() => EMPTY_EXPRESSION)];
      call = entry.kind === "constructor"
        ? constructorExpression(entry.targetId ?? fnId, guided.params, args)
        : { kind: "call" as const, fnId, args };
    }
    return editAuthoringCall(real(), { kind: "wrap", call, ...(wrappingBefore() ? { targetIndex: 0 } : {}) });
  }
  /** Move this call up past the call feeding its first input (Fenel plans the
   * swap over the original carriers). Its first input's Move down is this. */
  function moveUp() {
    closePicker(); setCodeView(false);
    const edited = editAuthoringCall(real(), { kind: "swap" });
    if (!edited.ok) { setCallEditIssue(edited.diagnostics[0]?.message ?? "Could not move this call."); return; }
    setCallEditIssue(undefined);
    (props.commitChange ?? props.onChange)(edited.value);
  }
  function wrapResult(fnId: string) {
    const edited = buildWrap(fnId);
    if (!edited) return;
    if (!edited.ok) { setCallEditIssue(edited.diagnostics[0]?.message ?? "Could not insert this call."); return; }
    setCallEditIssue(undefined);
    closePicker();
    (props.commitChange ?? props.onChange)(edited.value);
  }
  /** The pending insertion in the lens: the placeholder until a function is
   * highlighted, then that function's call with its other inputs open. */
  const pendingPreview = createMemo<ExprNode | undefined>(() => {
    if (!wrapping() || !insertDialog()) return undefined;
    const fnId = previewFunction();
    let edited = buildWrap(fnId);
    if (fnId !== undefined && !edited?.ok) edited = buildWrap(undefined);
    if (!edited?.ok) return undefined;
    const preview = edited.value;
    const inserted = wrappingBefore() && preview.kind === "call" ? preview.args[0] : preview;
    if (inserted) pendingCalls.add(inserted);
    return preview;
  });
  props.registerPending?.(pendingPreview);
  /** This occurrence is (part of) a preview: no checks, no write actions. */
  const previewing = () => pendingPreview() !== undefined || pendingCalls.has(props.node);
  function addLocalBinding() {
    props.onChange({ kind: "literal", value: { __where: {
      body: props.node, bindings: [blankLocalBinding([])],
    } } });
  }
  function previewResultBinding() {
    const continuation = resultBindingContinuation();
    const root = continuation.root();
    const proposal = proposeAuthoringResultBinding(root, continuation.path(), resultBindingName(), {
      lower: node => toLogic(node, id => transferSaved?.byId(id)?.expr, session),
      boundNames: params().map(param => param.name),
      context: editorFrame(session),
    });
    if (!proposal.ok) {
      setResultBindingProposal(undefined);
      setResultBindingIssue(proposal.diagnostics[0]?.message ?? "Could not name this result.");
      return;
    }
    setResultBindingIssue(undefined);
    setResultBindingProposal({ root, epoch: sessionEpoch(), session: concreteAuthoringSession(session),
      bindingsKey: draftValueFingerprint(params().map(param => param.name)), value: proposal.value });
  }
  const currentResultBindingProposal = () => {
    const proposal = resultBindingProposal();
    return proposal?.root === resultBindingContinuation().root() && proposal.epoch === sessionEpoch()
      && proposal.session === concreteAuthoringSession(session)
      && proposal.bindingsKey === draftValueFingerprint(params().map(param => param.name)) ? proposal : undefined;
  };
  function closeResultBinding() { setNamingResult(false); setResultBindingProposal(undefined); setResultBindingIssue(undefined); }
  function applyResultBinding() {
    const proposal = currentResultBindingProposal();
    if (!proposal) { setResultBindingIssue("The expression changed. Preview it again."); return; }
    resultBindingContinuation().apply(proposal.value.expression);
    closeResultBinding();
  }
  const bindingPreviewPresentation: HeldExpressionPresentation = {
    callable: id => {
      const entry = authoringFunctionEntry(session, id);
      return entry ? { id, name: functionDisplayName(entry), params: registryCallParams(entry), returns: entry.returns,
        isConstructor: entry.kind === "constructor" } : undefined;
    },
    typeLabel: type => typeNameOf(type, session) ?? displayTypeLabel(type),
    readValue: (data, compact) => <TypedReadValue value={data.value} type={data.type} compact={compact} />,
    graphValue: node => graphValue?.(node),
  };
  const resultGuidance = createMemo(() => {
    const expected = resolvedFieldType();
    if (!expected || props.node.kind === "literal" && props.node.value === undefined) return undefined;
    const result = currentInference();
    if (!result) return undefined;
    const label = editorTypeCaption(expected, session, reader, props.typeName)!;
    // A Local reader's verdict came with its inference (same shared judgment).
    const judged = guidance ? (result as ExpressionInferenceReply).judgment : judgeResult(props.node, expected, expectedScheme(), label, result);
    if (!judged) return undefined;
    // A compatible plain value carries no edge issue (unchanged behaviour).
    return judged.mismatch || props.node.kind === "call" || structuralModeForNode(props.node) ? judged : undefined;
  });
  /** Graph capture of this occurrence is allowed only on a checked answer:
   * with Local guidance, a pending answer is never "allowed" (B4 fix round 2). */
  const graphCaptureChecked = () => (!guidance || currentInference() !== undefined)
    && currentInference()?.outcome.$tag !== "Invalid" && !resultGuidance()?.graphIssue;
  /** Lane D (4b): the Local reader's inference of this occurrence has not
   * answered yet. Its graph data and type are pending, never "not available"
   * and never a type ("Anything") guessed meanwhile. */
  const inferencePending = () => !!guidance && currentInference() === undefined && guidance.busy();
  /** A pending insertion's placeholder call: its type waits for the choice. */
  const choosingFunction = () => props.node.kind === "call" && props.node.fnId === PENDING_FUNCTION_ID;
  const graphTypePending = () => (inferencePending() || choosingFunction()) && !graphTypeLabel();
  const pendingGraphCapture = { ...graphCaptureContext, pending: () => graphCaptureContext.pending() || inferencePending(),
    pendingLabel: () => graphCaptureContext.pending() ? graphCaptureContext.pendingLabel?.() : inferencePending() ? "Checking types…" : undefined };
  /** The existing result judgment (B4 slice 2: one shared function, which a
   * Local reader's worker runs for this editor through `infer-expression`). */
  function judgeResult(node: ExprNode, expected: FenelType, scheme: TypeScheme | undefined, label: string,
    result: AuthoringInferenceResult) {
    return judgeAuthoringResult(node, expected, scheme, label, result, session);
  }
  const scopeCapture = {
    node: () => inheritedScopeCapture.node() ?? (isLocalBindingsNode(props.node) ? props.node : undefined),
    allowed: () => inheritedScopeCapture.node() ? inheritedScopeCapture.allowed()
      : params().length === 0 && graphCaptureChecked(),
  };
  // ---- The occurrence's type contract (TypeContract) -------------------
  const contractTypeLabel = (type: FenelType, spelled?: string) => editorTypeCaption(type, session, reader, spelled)!;
  /** An annotation `(expression : Type)` is this occurrence's declared type. */
  const annotation = createMemo(() => {
    const form = props.node.kind === "literal" ? detectStructuralForm(props.node.value) : null;
    return form?.kind === "ann" ? form as { kind: "ann"; expr: ExprNode; type: unknown } : undefined;
  });
  /** What inference observes of the authored expression itself: the inner
   * expression of an annotation, otherwise this slot's current inference. */
  const observedInference = createMemo(() => {
    const ann = annotation();
    if (ann && guidance) return guidance.read({ node: ann.expr, bindings: inferenceContext().bindings ?? {} });
    return ann ? inferScopedAuthoringExpression(ann.expr, inferenceContext()) : currentInference();
  });
  const inferredType = createMemo(() => {
    const result = observedInference();
    return result?.outcome.$tag === "Solved" ? result.scheme?.body ?? result.type : undefined;
  });
  const declaredContract = createMemo<{ type?: FenelType; label: string; readonly?: string } | undefined>(() => {
    const ann = annotation();
    if (ann) {
      const type = annotationTypeForEditor(ann.type);
      return type ? { type, label: contractTypeLabel(type) }
        : { label: JSON.stringify(ann.type), readonly: "This annotation's type cannot be read by the type builder." };
    }
    if (props.declaredType === undefined) return undefined;
    return { type: props.declaredType, label: contractTypeLabel(props.declaredType, props.typeName),
      readonly: props.onDeclaredTypeChange ? undefined : props.declaredReadonly ?? "This type is set by the data's owner." };
  });
  /** Declared-type writes go to the existing owner: the annotation form of
   * this expression, or the owner that supplied `declaredType`. */
  const canDeclare = () => !!annotation() || !!props.onDeclaredTypeChange
    || props.declaredType === undefined && !props.suppressAnnotationCreate && !(props.node.kind === "literal" && props.node.value === undefined);
  function setDeclaredType(type: FenelType | undefined) {
    const ann = annotation();
    if (ann) {
      props.onChange(type === undefined ? ann.expr : { kind: "literal", value: { __ann: { expr: ann.expr, type } } });
      return;
    }
    if (props.onDeclaredTypeChange) { props.onDeclaredTypeChange(type); return; }
    if (type !== undefined && canDeclare()) props.onChange({ kind: "literal", value: { __ann: { expr: props.node, type } } });
  }
  /** An annotation's own check: its inner expression against its type. */
  const annotationGuidance = createMemo(() => {
    const ann = annotation();
    const declared = declaredContract();
    if (!ann || !declared?.type || ann.expr.kind === "literal" && ann.expr.value === undefined) return undefined;
    const scheme = expectedSchemeForType(declared.type, editorEnvironment(session));
    if (guidance) return guidance.read({ node: ann.expr, expectedScheme: scheme ?? { quantified: [], body: declared.type },
      bindings: inferenceContext().bindings ?? {}, judge: { expected: declared.type, ...(scheme ? { scheme } : {}), label: declared.label } })?.judgment;
    const result = inferScopedAuthoringExpression(ann.expr, inferenceContext(),
      { expectedScheme: scheme ?? { quantified: [], body: declared.type } });
    return judgeResult(ann.expr, declared.type, scheme, declared.label, result);
  });
  const contract = createMemo(() => {
    const declared = declaredContract();
    const required = props.declaredType === undefined ? resolvedFieldType() : undefined;
    const inferred = inferredType();
    const mismatch = props.hideResultGuidance ? undefined
      : resultGuidance()?.mismatch ? resultGuidance()!.message : annotationGuidance()?.mismatch ? annotationGuidance()!.message : undefined;
    return {
      inferred: inferred ? contractTypeLabel(inferred) : undefined,
      declared: declared?.label,
      declaredReadonly: declared?.readonly,
      required: required ? { label: contractTypeLabel(required, props.typeName), source: props.requirementSource } : undefined,
      mismatch,
    };
  });
  // B4 F2 (slice 2 review M3): while this occurrence's Local answer is
  // pending, the hints its answer drives (the inferred type, the mismatch, the
  // edge issue) stay as last shown, visually unchanged, until the new answer
  // arrives. Display only: graph capture (`graphCaptureChecked`), Save and the
  // declared/required parts never read the held copy.
  const answerPending = () => {
    if (!guidance) return false;
    const blank = (node: ExprNode) => node.kind === "literal" && node.value === undefined;
    const ann = annotation();
    const waiting = !blank(props.node) && currentInference() === undefined
      || !!ann && !blank(ann.expr) && observedInference() === undefined;
    // Only while a request is actually waiting or in flight (read after the
    // readers asked): a failed or never-sent request (no worker) drops it.
    return waiting && guidance.busy();
  };
  let shownHint: { inferred?: string; mismatch?: string; graphIssue?: string } | undefined;
  const hint = createMemo(() => {
    const now = { inferred: contract().inferred, mismatch: contract().mismatch, graphIssue: resultGuidance()?.graphIssue };
    if (shownHint && answerPending()) return shownHint;
    return shownHint = now;
  });
  const incompleteNote = () => {
    const node = props.node, current = resultGuidance();
    // Only this literal's current required-type mismatch gets a neutral note.
    // Annotation errors, held inference, graph capture and admission stay owned
    // by their existing judgments.
    if (node.kind !== "literal" || annotation() || props.hideResultGuidance
      || !current?.mismatch || hint().mismatch !== current.message) return undefined;
    return incompleteMembershipNote(literalHintSource(), node, resolvedFieldType(), node.value);
  };

  // Browser lifetime only: the existing Suggestions owner captures and checks
  // this exact slot, independently of its destination, without evaluating it.
  const suggestionDestination = (): DataSuggestionInput["destination"] => {
    const expected = expectedScheme() ?? resolvedFieldType();
    const hasRequirement = props.expectedOutcome !== undefined || props.expectedScheme !== undefined
      || props.expectedType !== undefined || props.fieldDef !== undefined || !!props.typeName;
    return hasRequirement ? {
      expected,
      outcome: props.expectedOutcome ?? (expected ? { $tag: "Solved" } : {
        $tag: "AnnotationRequired", diagnostics: [{ code: "suggestions.destination-unresolved",
          message: "The required type is not available in this context.", functionId: "expression-slot" }],
      }),
    } : undefined;
  };
  const suggestionLexicalBindings = () => params().filter(param => !param.name.includes("."))
    .map(param => ({ name: param.name, type: param.type, scheme: param.scheme }));
  // An initializer's uses do not become an authored result contract. Mounted
  // initializer slots start a fresh checker capture with their own real scope.
  const suggestionCheckScope: SuggestionCheckScope = {
    node: () => props.detachSuggestionContext ? props.node : parentSuggestionCheck?.node() ?? props.node,
    destination: () => props.detachSuggestionContext ? suggestionDestination()
      : parentSuggestionCheck ? parentSuggestionCheck.destination() : suggestionDestination(),
    lexicalBindings: () => props.detachSuggestionContext ? suggestionLexicalBindings()
      : parentSuggestionCheck?.lexicalBindings() ?? suggestionLexicalBindings(),
  };
  const suggestionSnapshot = (node: ExprNode = props.node) => {
    let destination = node === props.node ? suggestionDestination() : undefined;
    // Dotted picker aliases are presentation rows. Inference projects paths
    // from their authoritative root binding and its complete scheme.
    const lexicalBindings = suggestionLexicalBindings();
    const checkerRoot = suggestionCheckScope.node();
    const occurrence = inspectAuthoringExpressionOccurrence(checkerRoot, node, editorFrame(session));
    let enclosing: DataSuggestionInput["enclosing"];
    if (!occurrence.ok || occurrence.value.detached) {
      destination = { expected: destination?.expected, outcome: { $tag: "AnnotationRequired", diagnostics: [{
        code: "suggestions.enclosing-unavailable", functionId: "expression-slot",
        message: "The enclosing expression could not be checked for this occurrence.",
      }] } };
    } else if (node !== props.node || occurrence.value.annotations.length > 0) {
      enclosing = { expression: checkerRoot, path: occurrence.value.path,
        destination: suggestionCheckScope.destination(), lexicalBindings: suggestionCheckScope.lexicalBindings() };
    }
    const savedExpressions = transferSaved?.list().map(value => [value.id, value.expr] as const);
    const root = resultBindingContinuation().root();
    const path = resultBindingContinuation().path();
    const revision = draftValueFingerprint({ node, slot: props.node, root, draft: suggestionDraft(), path, destination, enclosing, lexicalBindings, savedExpressions,
      annotation: { field: props.fieldDef, type: props.expectedType, scheme: props.expectedScheme, typeName: props.typeName,
        outcome: props.expectedOutcome }, siblings: recordValues() });
    return { destination, enclosing, lexicalBindings, savedExpressions, root, revision };
  };
  // The picker owns reference/reader proof; this closure owns the occurrence
  // being edited, including in-place edits and same-turn mode changes.
  function captureTypePickerTarget(lane: "reference" | "use"): ReturnType<CaptureTypePickerTarget> {
    return latest(() => {
      const available = () => typePickerAlive && !codeView() && isTypeField()
        && (lane === "reference" ? pickingRef() : pickingUse() || (needsChoice() && !isPickingAny()));
      if (!available()) return undefined;
      const generation = typePickerGeneration;
      const node = props.node, realNode = props.realNode, field = props.fieldDef;
      const root = resultBindingContinuation().root(), draft = suggestionDraft();
      const scope = inheritedScopeCapture.node();
      const concrete = concreteAuthoringSession(session), epoch = sessionEpoch();
      const fingerprint = () => draftValueFingerprint({ node: props.node, realNode: props.realNode,
        root: resultBindingContinuation().root(), draft: suggestionDraft(), path: resultBindingContinuation().path(),
        scope: inheritedScopeCapture.node(), field: props.fieldDef, type: props.expectedType,
        scheme: props.expectedScheme, outcome: props.expectedOutcome, declared: props.declaredType,
        typeName: props.typeName, viewMode: props.viewMode, siblings: recordValues(), params: params() });
      const revision = fingerprint();
      return () => latest(() => available() && generation === typePickerGeneration
        && node === props.node && realNode === props.realNode && field === props.fieldDef
        && root === resultBindingContinuation().root() && draft === suggestionDraft() && scope === inheritedScopeCapture.node()
        && concrete === concreteAuthoringSession(session) && epoch === sessionEpoch() && revision === fingerprint());
    });
  }
  const captureSuggestion = (node: ExprNode) => {
    const captured = suggestionSnapshot(node);
    const slot = props.node;
    const occurrence = inspectAuthoringExpressionOccurrence(slot, node, editorFrame(session));
    if (!occurrence.ok || occurrence.value.detached) throw new Error("This data's authored occurrence is unavailable. Open its expression to check Suggestions.");
    const concrete = concreteAuthoringSession(session);
    const epoch = sessionEpoch();
    const context = { ...inferenceContext(), bindings: Object.fromEntries(captured.lexicalBindings
      .map(binding => [binding.name, binding.scheme ?? binding.type])) };
    const source = inferScopedAuthoringExpression(node, context);
    return {
      session: concrete,
      input: { expression: node, type: source.type, scheme: source.scheme,
        sourceType: source.type, sourceScheme: source.scheme,
        destination: captured.destination, enclosing: captured.enclosing, lexicalBindings: captured.lexicalBindings,
        savedExpressions: captured.savedExpressions, revision: captured.revision },
      current: () => epoch === sessionEpoch() && concrete === concreteAuthoringSession(session)
        && props.node === slot && suggestionSnapshot(node).revision === captured.revision,
      select: (next: ExprNode) => {
        const replaced = replaceAuthoringExpressionOccurrence(slot, occurrence.value.path, next, editorFrame(session));
        if (!replaced.ok) { setCallEditIssue(replaced.diagnostics[0]?.message ?? "This data changed. Open Suggestions again."); return; }
        closePicker(); setCallEditIssue(undefined); props.onChange(replaced.value);
      },
      reportIssue: setCallEditIssue,
    };
  };
  const suggestionOwner = createDataInspectionSuggestions(() => captureSuggestion(props.node));
  const rootSuggestionSource: DataOccurrenceSource = { state: "source", capture: () => captureSuggestion(props.node), suggestions: suggestionOwner };
  const childSuggestionSources = new WeakMap<ExprNode, DataOccurrenceSource>();
  const suggestionSource = (node?: ExprNode): DataOccurrenceSource => {
    if (!node) return rootSuggestionSource;
    let source = childSuggestionSources.get(node);
    if (!source) { source = { state: "source", capture: () => captureSuggestion(node) }; childSuggestionSources.set(node, source); }
    return source;
  };

  // B4 wave 4 lane E: a Local reader's paste and copy on a slot evaluate in
  // its worker (`evaluate-expression`); its copy is prefetched there on intent
  // (`prepare-reader-transfer-item`). The page never evaluates for it.
  const localTransfer = localStructure(session) && reader?.kind === "local";
  const transferSavedMap = () => new Map((transferSaved?.list() ?? []).map(option => [option.id, option.expr] as const));
  const localCopy = localTransfer ? createLocalExpressionCopy(() => reader, () => session, () => ({ node: props.node,
    saved: transferSavedMap(), type: resolvedFieldType(), typeName: props.typeName })) : undefined;

  /** The insert window: the data editor of the occurrence being created. Its
   * contract says what the chosen function receives and must produce. */
  const pendingInsertDialog = () => <>
    <FunctionPicker onPick={wrapResult} onCancel={closePicker} requiresInput
      paramType={wrappingExpectedScheme()?.body ?? wrappingExpected() as FenelType | undefined} expectedScheme={wrappingExpectedScheme()}
      paramTypeName={wrappingBefore() ? undefined : props.typeName} inputScheme={wrappingScheme()} inputPending={wrappingInputPending()}
      requirementSource={wrappingRequirementSource()} onHighlight={setPreviewFunction} />
    <Show when={callEditIssue()}>{message => <div class="expr-type-guidance expr-type-guidance--mismatch" role="status">{message()}</div>}</Show>
  </>;
  return (
    <SuggestionCheckContext value={suggestionCheckScope}><SuggestionDraftContext value={suggestionDraft}><ExpressionTransferTarget node={props.node} onChange={props.onChange} session={session}
      expectedType={resolvedFieldType()} expectedScheme={expectedScheme()} typeName={props.typeName}
      resolveSavedValue={localTransfer ? async (id) => {
        const saved = transferSaved?.byId(id);
        if (!saved) return undefined;
        const value = await evaluateLocalExpression(session, saved.expr, transferSavedMap());
        return { value, typeName: inferExpressionTypeName(saved.expr, session) ?? "Value", label: saved.name, source: "fenel" };
      } : (id) => {
        const saved = transferSaved?.byId(id);
        if (!saved) return undefined;
        const value = evaluateAuthoringExpression(saved.expr, (id) => transferSaved?.byId(id)?.expr, session).result;
        return { value, typeName: inferExpressionTypeName(saved.expr, session) ?? "Value", label: saved.name, source: "fenel" };
      }}
      localCopy={localCopy}
      readValue={() => localTransfer ? evaluateLocalExpression(session, props.node, transferSavedMap()) : evaluateAuthoringExpression(props.node,
        transferSaved ? (id) => transferSaved.byId(id)?.expr : undefined, session).result}>
    <ExpressionGraphScopeCaptureContext value={scopeCapture}><PreparedExprFieldShell
      suggestionOwner={props.node.kind === "literal" && props.node.value === undefined ? undefined : suggestionOwner}
      field={props.fieldDef}
      fieldScheme={expectedScheme()}
      paramName={props.paramName}
      typeName={props.typeName}
      hideLabel={props.hideLabel}
      mode={mode}
      switchTo={switchTo}
      paramMode
      unifiedUse
      expressionForms
      inlineAvailable={inlineWidget() !== undefined}
      nodeKind={props.node.kind}
      graphEligible={isLocalBindingsNode(props.node) ? false : undefined}
      empty={props.node.kind === "literal" && props.node.value === undefined}
      onReplace={() => switchTo("use")}
      onAddFunction={props.node.kind !== "call" ? () => startWrapping(false, true) : undefined}
      onInsertCall={() => startWrapping(false, true)}
      onInsertBefore={props.node.kind === "call" && props.node.args.length > 0 ? () => startWrapping(true, true) : undefined}
      onInsertAfter={props.node.kind === "call" ? () => startWrapping(false, true) : undefined}
      onMoveUp={canSwapWithFirstInput(props.node) ? moveUp : undefined}
      onMoveDown={props.onMoveDown}
      pendingInsert={wrapping() && insertDialog() ? pendingInsertDialog : undefined}
      onPendingInsertClose={closePicker}
      onNameResult={() => { closePicker(); setResultBindingIssue(undefined); setResultBindingProposal(undefined); setNamingResult(true); }}
      graphError={previewing() ? undefined : callEditIssue() ?? hint().graphIssue}
      onAddBinding={props.allowLocalBindings !== false && !isLocalBindingsNode(props.node) ? addLocalBinding : undefined}
      onRemove={() => {
        closePicker(); setCodeView(false);
        if (props.node.kind === "call") {
          const entry = authoringFunctionEntry(session, props.node.fnId, props.node.args.length);
          const edited = editAuthoringCall(props.node, { kind: "remove", index: 0, empty: EMPTY_EXPRESSION,
            names: entry ? callArgumentPlan(props.node, entry, expectedScheme() ?? resolvedFieldType(), inferenceContext()).params.map(param => param.name) : [],
            logic: toLogic(props.node, id => transferSaved?.byId(id)?.expr, session) });
          if (!edited.ok) { setCallEditIssue(edited.diagnostics[0]?.message ?? "Could not delete this call."); return; }
          setCallEditIssue(undefined);
          props.onChange(edited.value);
        } else { setCallEditIssue(undefined); props.onChange(EMPTY_EXPRESSION); }
      }}
      graphCaption={graphData()?.caption ?? graphIdentity()}
      graphCaptionOverride
      graphIcon={graphData()?.valueIcon}
      graphEmoji={graphData()?.valueEmoji}
      graphTypeLabel={graphTypeLabel()} graphTypePending={graphTypePending()}
      graphTypeIcon={graphData()?.typeIcon}
      graphType={graphType() ?? resolvedFieldType()}
      graphEdgeLabel={inspect => <ExpressionGraphValuePreview data={graphData()} typeLabel={graphTypeLabel()} typePending={graphTypePending()} occurrence={suggestionSource()}
        caption={props.paramName ?? props.fieldDef?.name} dataCaption={graphIdentity()}
        thumbnail={graphThumbnail} body={graphReadBody} onOpen={inspect} />}
      graphSlotPreview={unfold => <ExpressionGraphValuePreview data={graphData()} typeLabel={graphTypeLabel()} typePending={graphTypePending()} occurrence={suggestionSource()}
        caption={props.paramName ?? props.fieldDef?.name} dataCaption={graphIdentity()}
        thumbnail={graphThumbnail} body={graphReadBody} inline onOpen={unfold} />}
      graphBody={<Show when={graphData()} fallback={<Switch fallback={<span class="expr-graph-data-card__symbol">{summarizeNode(props.node, session, params().map(param => param.name), reader)}</span>}>
        <Match when={graphList()}>{items => <ExpressionGraphListPreview items={items()} data={graphListData}
          occurrence={suggestionSource}
          typeLabel={type => editorTypePhrase(type, session, reader, false) ?? ""}
          typeIcon={type => preparedTypeIcon(type, session, reader)}
          thumbnail={data => <TypedReadValue value={data.value} type={data.type} valueIcon={data.valueIcon} valueEmoji={data.valueEmoji} thumbnail />}
          readValue={(data, onOpenData, node, occurrence) => <TypedReadValue value={data.value} type={data.type} callableName={graphCallableName}
            occurrence={occurrence?.source ?? (node ? suggestionSource(node) : { state: "unavailable", issue: "This data's authored occurrence is unavailable. Open its expression to check Suggestions." })}
            dataPath={occurrence?.path}
            onOpenData={onOpenData} />} />}</Match>
        <Match when={props.node.kind === "literal" && !detectStructuralForm(props.node.value)}>
          <Show when={(props.node as { value: unknown }).value !== undefined} fallback={<span class="text-muted">Choose data</span>}>
              <TypedReadValue value={(props.node as { value: unknown }).value} type={resolvedFieldType()} compact
                occurrence={suggestionSource()}
                callableName={handle => {
                  const entry = authoringFunctionEntry(session, handle);
                  return entry ? functionPickerDisplayName(entry) : undefined;
                }} />
          </Show>
        </Match>
        <Match when={props.node.kind === "ref"}>
          <ExpressionReferenceSurface glyph="→" name={transferSaved?.byId((props.node as Extract<ExprNode, { kind: "ref" }>).savedExprId)?.name ?? "Saved data"}
            tooltip="Saved data reference" swapTooltip="Pick different saved data" convertTooltip="Replace this reference with data" readonly />
        </Match>
        <Match when={props.node.kind === "param"}>
          <ExpressionReferenceSurface glyph="λ" name={(props.node as Extract<ExprNode, { kind: "param" }>).name}
            tooltip="Parameter" swapTooltip="Pick a different parameter" convertTooltip="Replace this parameter with data" readonly />
        </Match>
      </Switch>}>{graphReadBody()}</Show>}
    >
      <ExpressionCodeLensSurface code={codeView()} renderCode={() => <NodeCodeView node={props.node} onChange={props.onChange} />}>
        <Show when={!props.hideTypeContract && !previewing() && (!isPickingAny() || wrapping() && !insertDialog())}>
          <TypeContract inferred={hint().inferred} declared={contract().declared}
            declaredReadonly={contract().declaredReadonly} required={contract().required}
            note={incompleteNote()} mismatch={incompleteNote() ? undefined : hint().mismatch}
            onUseInferred={canDeclare() && inferredType() ? () => setDeclaredType(inferredType()) : undefined}
            onRemoveDeclared={annotation() || props.onDeclaredTypeChange ? () => setDeclaredType(undefined) : undefined}
            editor={canDeclare() ? () => <TypeBuilder value={declaredContract()?.type ?? null}
              onChange={type => setDeclaredType(type)} authoringSession={session} /> : undefined}
            menuItems={props.typeMenuItems} />
        </Show>

        {/* A pending insertion keeps the occurrence visible: it previews there. */}
        <Show when={!isPickingAny() || wrapping() && insertDialog()}>
          <ExpressionNodeContent kind={props.node.kind}
            renderLiteral={() => <Show when={!needsChoice()}>{/* A value-position `{$ref}` literal arrives from TWO producers
              (Phase 4's `pickFunctionRef` + Phase 7g-value's `pickTypeRef`),
              sharing the type-transparent form. Discriminate by RESOLVING the
              handle function-first (`refLiteralKind`): a function-handle → the
              ƒ-pill (Phase 4 — UNCHANGED, only GUARDED); a type-handle → the
              type-pill (this phase); a non-`{$ref}` literal → LiteralEditor. */}
          <Switch
            fallback={
              <LiteralEditor
                node={props.node as { kind: "literal"; value: unknown }}
                typeName={props.typeName}
                fieldDef={effectiveField()}
                expectedScheme={expectedScheme()}
                expectedOutcome={props.expectedOutcome}
                observeMembershipHints={observeLiteralHints}
                onChange={(v) => setLiteral(v)}
                onReplace={props.onChange}
                onPickFunction={pickFunction}
              />
            }
          >
            <Match
              when={
                refLiteralKind(
                  (props.node as { value: unknown }).value,
                  (handle) => editorGetFunction(session, handle),
                ) === "function" &&
                refLiteralId(props.node)
              }
            >
              {(fnId) => (
                <FunctionRefEditor
                  fnId={fnId()}
                  onConvertToLiteral={() => clearToLiteral()}
                  onSwitchRef={() => setPickingUse(true)}
                />
              )}
            </Match>
            <Match
              when={
                refLiteralKind(
                  (props.node as { value: unknown }).value,
                  (handle) => editorGetFunction(session, handle),
                ) === "type" &&
                refLiteralId(props.node)
              }
            >
              {(handle) => (
                <TypeRefEditor
                  handle={handle()}
                  onConvertToLiteral={() => clearToLiteral()}
                  onSwitchRef={() => setPickingUse(true)}
                />
              )}
            </Match>
          </Switch></Show>}
            renderCall={() => <><Show
            when={isPipeEligible()}
            fallback={
              <ResultBindingContext value={resultBindingScope}><CallEditor
                node={props.node as { kind: "call"; fnId: string; args: ExprNode[] }}
                onChange={(next) => props.onChange(next)}
                onConvertToLiteral={() => clearToLiteral()}
                onMoveFirstInputDown={canSwapWithFirstInput(props.node) ? moveUp : undefined}
                viewMode={props.viewMode}
                expectedType={resolvedFieldType()}
                expectedScheme={expectedScheme()}
                resultScheme={currentInference()?.outcome.$tag === "Solved" ? currentInference()?.scheme : undefined}
                graphCaptureAllowed={graphCaptureChecked()}
                graphResult={inspect => <ExpressionGraphCaptureContext value={pendingGraphCapture}>
                  <ExpressionGraphValuePreview data={graphData()} presentation="full"
                  typeLabel={graphTypeLabel()} typePending={graphTypePending()} dataCaption={graphData()?.caption ?? graphIdentity()}
                  body={graphReadBody} onOpen={inspect} /></ExpressionGraphCaptureContext>}
              /></ResultBindingContext>
            }
          >
            <PipeView
              node={props.node as { kind: "call"; fnId: string; args: ExprNode[] }}
              onChange={(next) => props.onChange(next)}
              onConvertToLiteral={() => clearToLiteral()}
              viewMode={props.viewMode}
              expectedType={resolvedFieldType()}
              expectedScheme={expectedScheme()}
            />
          </Show></>}
            renderReference={() => <><RefEditor
            node={props.node as { kind: "ref"; savedExprId: string }}
            onConvertToLiteral={() => clearToLiteral()}
            onSwitchRef={() => setPickingUse(true)}
          /></>}
            renderParameter={() => <><ParamRefDisplay
            node={props.node as { kind: "param"; name: string }}
            onConvertToLiteral={() => clearToLiteral()}
            onSwitchParam={() => setPickingParam(true)}
          /></>}
          />
        </Show>

        <Show when={pickingUse() || (needsChoice() && !isPickingAny())}>
          <Show when={needsChoice() && props.node.kind === "literal" && props.node.value != null}>
            <DataPreview value={(props.node as { kind: "literal"; value: unknown }).value} />
          </Show>
          <Show when={needsChoice() && genericSlot()}>
            <div class="expr-literal-choices">
              <span>Enter data:</span>
              <button type="button" class="expr-form__btn" onClick={() => { closePicker(); setLiteral(""); }}>Text</button>
              <button type="button" class="expr-form__btn" onClick={() => { closePicker(); setLiteral(0); }}>Number</button>
            </div>
          </Show>
          <UsePicker
            onPickFunction={pickFunction}
            onPickLocalFunction={pickLocalFunction}
            onPickTypeRef={pickTypeRef}
            captureTypeTarget={() => captureTypePickerTarget("use")}
            onPickFunctionRef={pickFunctionRef}
            onPickSaved={pickRef}
            onPickParam={pickParam}
            onCancel={needsChoice() ? undefined : closePicker}
            fieldType={resolvedFieldType()}
            expectedScheme={expectedScheme()}
            typeName={props.typeName}
            isTypeField={isTypeField()}
            isArrowField={isArrowField()}
            requirementSource={props.requirementSource}
          />
        </Show>

        <Show when={callEditIssue()}>{message => <div class="expr-type-guidance expr-type-guidance--mismatch" role="status">{message()}</div>}</Show>
        <ExpressionResultBindingDialog open={namingResult()} name={resultBindingName()}
          onNameChange={name => { setResultBindingName(name); setResultBindingProposal(undefined); setResultBindingIssue(undefined); }}
          onPreview={previewResultBinding} onApply={currentResultBindingProposal() ? applyResultBinding : undefined}
          onClose={closeResultBinding} error={resultBindingIssue() ?? (resultBindingProposal() && !currentResultBindingProposal() ? "The expression changed. Preview it again." : undefined)}
          preview={<Show when={currentResultBindingProposal()}>{proposal => <>
            <p class="text-muted">Available inside: {summarizeNode(proposal().value.scope, session, params().map(param => param.name))}</p>
            <ExpressionEditor expr={proposal().value.expression} inspection={bindingPreviewPresentation} onChange={() => {}} onGraphActiveChange={() => {}} hideLabel />
          </>}</Show>} />
        <Show when={wrapping() && !insertDialog()}>
          <FunctionPicker onPick={wrapResult} onCancel={closePicker}
            requiresInput
            paramType={wrappingExpectedScheme()?.body ?? wrappingExpected() as FenelType | undefined} expectedScheme={wrappingExpectedScheme()}
            paramTypeName={wrappingBefore() ? undefined : props.typeName} inputScheme={wrappingScheme()} inputPending={wrappingInputPending()}
            requirementSource={wrappingRequirementSource()} />
        </Show>

        <Show when={picking()}>
          <FunctionPicker
            onPick={pickFunction}
            onPickLocal={pickLocalFunction}
            onCancel={() => setPicking(false)}
            paramType={resolvedFieldType()}
            expectedScheme={expectedScheme()}
            paramTypeName={props.typeName}
            requirementSource={props.requirementSource}
          />
        </Show>

        <Show when={pickingRef() && isTypeField()}>
          <TypePicker
            onPick={pickTypeRef}
            captureTarget={() => captureTypePickerTarget("reference")}
            onCancel={closePicker}
          />
        </Show>

        {/* Function-typed slot → nominate a function as a typed `{$ref}`
            value. Same ref-mode, third fork: type fields → TypePicker
            (`{$named}`), arrow fields → FunctionPicker (`{$ref}`), else
            saved values. `initialKind="function"` lands on the functions
            tab (reuse, no new picker / no new prop). */}
        <Show when={pickingRef() && !isTypeField() && isArrowField()}>
          <FunctionPicker
            onPick={pickFunctionRef}
            onCancel={() => setPickingRef(false)}
            initialKind="function"
            paramType={resolvedFieldType()}
            expectedScheme={expectedScheme()}
            referenceMode
            paramTypeName={props.typeName}
          />
        </Show>

        <Show when={pickingRef() && !isTypeField() && !isArrowField()}>
          <SavedValuePicker
            onPick={pickRef}
            onCancel={() => setPickingRef(false)}
            typeName={props.typeName}
            fieldType={resolvedFieldType()}
            expectedScheme={expectedScheme()}
          />
        </Show>

        <Show when={pickingParam()}>
          <ParamPicker
            onPick={pickParam}
            onCancel={() => setPickingParam(false)}
            paramType={resolvedFieldType()}
            expectedScheme={expectedScheme()}
            paramTypeName={props.typeName}
          />
        </Show>

        <Show when={!isPickingAny() && !needsChoice() && currentInference()?.scheme}>
          <div class="expr-result-actions"><button type="button" class="expr-form__btn" onClick={() => startWrapping()}
            data-tooltip="Add a function that takes this expression as its first argument">Use this result</button></div>
        </Show>
        <Show when={props.allowLocalBindings !== false && !isPickingAny() && !isLocalBindingsNode(props.node)}>
          <LocalBindingsEntry onAdd={addLocalBinding} compact={pathCtx.depth > 0} />
        </Show>
      </ExpressionCodeLensSurface>
    </PreparedExprFieldShell></ExpressionGraphScopeCaptureContext>
    </ExpressionTransferTarget></SuggestionDraftContext></SuggestionCheckContext>
  );
}

type StructuralCreateKind =
  | "do"
  | "let"
  | "where"
  | "ann"
  | "eval"
  | "match"
  | "record"
  | "lambda"
  | "type" | "list" | "lookup" | "apply" | "scope" | "pipeline" | "operation" | "template";

function structuralModeForNode(node: ExprNode): StructuralMode | null {
  if (node.kind !== "literal") return null;
  return structuralModeForForm(detectStructuralForm(node.value));
}

function isBlankLiteral(node: ExprNode): boolean {
  return node.kind === "literal" && (node.value === null || node.value === undefined);
}

function childSeed(current: ExprNode): ExprNode {
  return isBlankLiteral(current) ? { kind: "literal", value: undefined } : current;
}

/** A call can move past the step feeding its first input when that step is a
 * call with an input of its own. Offered regardless of types (a swap that no
 * longer type-checks shows its edge issue); Fenel's swap plan decides. */
function canSwapWithFirstInput(node: ExprNode): boolean {
  if (node.kind !== "call") return false;
  const first = node.args[0];
  return first?.kind === "call" && first.args.length > 0;
}

function isLocalBindingsNode(node: ExprNode): boolean {
  return node.kind === "literal" && detectStructuralForm(node.value)?.kind === "where";
}

function isExprNodeValue(value: unknown): value is ExprNode {
  return !!value && typeof value === "object" && typeof (value as { kind?: unknown }).kind === "string";
}

function expectedRecordFieldsFor(
  t: FenelType | undefined,
  session: AuthoringSession,
): FieldDef[] | undefined {
  return recordFieldsForType(t, editorEnvironment(session));
}

function seedRecordFields(
  current: ExprNode,
  expectedFields: FieldDef[] | undefined,
  session: AuthoringSession,
): { name: string; value: ExprNode }[] {
  if (current.kind === "literal" && current.value && typeof current.value === "object" && !Array.isArray(current.value)
    && (Object.getPrototypeOf(current.value) === Object.prototype || Object.getPrototypeOf(current.value) === null)) {
    const descriptors = Object.getOwnPropertyDescriptors(current.value);
    const names = Reflect.ownKeys(current.value);
    if (names.every((name) => typeof name === "string"
      && descriptors[name]?.enumerable && "value" in descriptors[name]!)) {
      const form = detectStructuralForm(current.value);
      if (form?.kind === "record") return form.fields;
      if (!form && names.every((name) => !(name as string).startsWith("$"))) {
        return (names as string[]).map((name) => {
          const matches = expectedFields?.filter((field) => field.name === name);
          return {
            name,
            value: expressionForLiteralValue(descriptors[name]!.value, matches?.length === 1 ? matches[0]!.type : undefined,
              editorEnvironment(session)),
          };
        });
      }
    }
  }
  const first = expectedFields?.[0];
  return first ? [{ name: first.name, value: seedExpressionForType(first.type, editorEnvironment(session)) }]
    : [{ name: "field", value: childSeed(current) }];
}

function seedLambda(fieldType: FenelType | undefined, session: AuthoringSession): ExprNode | null {
  const arrow = peelToArrowType(fieldType, editorEnvironment(session));
  if (arrow && "$arrow" in arrow) return seedExpressionForType(arrow, editorEnvironment(session));
  return {
    kind: "literal",
    value: {
      __lambda: {
        params: ["x"],
        body: { kind: "literal", value: undefined },
      },
    },
  };
}

function seedStructuralNode(
  kind: StructuralCreateKind,
  current: ExprNode,
  fieldType: FenelType | undefined,
  expectedFields: FieldDef[] | undefined,
  session: AuthoringSession,
): ExprNode | null {
  if (kind === "list") return { kind: "literal", value: { __list: isBlankLiteral(current) ? [] : [current] } };
  if (kind === "template") return { kind: "literal", value: { __cat: [childSeed(current)] } };
  if (kind === "lookup") return { kind: "literal", value: { __var: { path: "", arrayForm: false } } };
  if (kind === "apply") return { kind: "literal", value: { __apply: { target: childSeed(current), args: [] } } };
  if (kind === "pipeline") return { kind: "literal", value: { __pipe: { value: childSeed(current), steps: [] } } };
  if (kind === "operation") return { kind: "literal", value: { __operator: { op: "if", args: [childSeed(current), { kind: "literal", value: undefined }, { kind: "literal", value: undefined }] } } };
  if (kind === "scope") return { kind: "literal", value: { __withInstance: {
    frame: logicToExprNode({ typeName: "", args: [], methods: {} }, [], session),
    body: childSeed(current),
  } } };
  if (kind === "do") {
    return { kind: "literal", value: { __do: [childSeed(current)] } };
  }
  if (kind === "let") {
    return {
      kind: "literal",
      value: {
        __let: {
          bindings: [{ name: "x", expr: childSeed(current) }],
        },
      },
    };
  }
  if (kind === "where") {
    return {
      kind: "literal",
      value: {
        __where: {
          body: childSeed(current),
          bindings: [{ name: "x", expr: { kind: "literal", value: undefined } }],
        },
      },
    };
  }
  if (kind === "ann") {
    return {
      kind: "literal",
      value: {
        __ann: {
          expr: childSeed(current),
          type: fieldType ?? { $ref: "Value" },
        },
      },
    };
  }
  if (kind === "eval") {
    return {
      kind: "literal",
      value: {
        __evaluator: {
          strategy: "lazy",
          body: childSeed(current),
        },
      },
    };
  }
  if (kind === "match") {
    return {
      kind: "literal",
      value: {
        __match: {
          scrutinee: childSeed(current),
          arms: [{ pattern: "_", body: { kind: "literal", value: undefined } }],
        },
      },
    };
  }
  if (kind === "record") {
    return {
      kind: "literal",
      value: { __record: { fields: seedRecordFields(current, expectedFields, session) } },
    };
  }
  if (kind === "type") {
    return {
      kind: "literal",
      value: { $record: { fields: [] } },
    };
  }
  return seedLambda(fieldType, session);
}

/** Editable Fenel-syntax lens over one ExprNode subtree. Round-trip flow:
 *  ExprNode → JSON Logic via `toLogic` → text via `printFenel`; edits apply
 *  through the canonical engine parser, then `logicToExprNode` brings the
 *  parsed JSON-Logic shape back to the single editor AST. A type annotation
 *  prints and reads as `(e : T)`. When the printer can only dump part of the
 *  expression as JSON (a type it cannot write as syntax), the text would not
 *  read back to the same expression, so the lens shows it read-only. */
function NodeCodeView(props: { node: ExprNode; onChange: (next: ExprNode) => void }) {
  const session = useAuthoringSession();
  const params = useContext(LambdaParamsContext);
  const savedCtx = useContext(SavedValuesContext);
  // B4 unit C: a Local reader prints and reads this text in its worker; the
  // page session is not read. Account and public readers run the same shared
  // text boundary (`expression-text.ts`) here.
  const reader = useReaderRuntime();
  const local = reader?.kind === "local";
  const resolver = createMemo<RefResolver | undefined>(() =>
    savedCtx ? (id) => savedCtx.byId(id)?.expr : undefined,
  );
  const blank = () => props.node.kind === "literal" && props.node.value === undefined;
  const localPrint = local ? createLocalExpressionPrint(() => reader, () => session, () => blank() ? undefined : {
    node: props.node, boundNames: params().map((param) => param.name), presentation: "editor",
    lookup: (id) => savedCtx?.byId(id)?.expr }) : undefined;
  /** `undefined` before a Local reader's first print (read-only meanwhile). */
  const printed = createMemo<{ text: string; readable: boolean } | undefined>(() => {
    if (blank()) return { text: "", readable: codeLensTextIsReadable("") };
    if (localPrint) {
      const reply = localPrint.print();
      if (!reply) return undefined;
      return reply.$tag === "Ok" ? { text: reply._0.text, readable: reply._0.readable }
        : { text: `-- print error: ${reply._0}`, readable: false };
    }
    let text: string;
    try {
      text = printAuthoringExpressionText(props.node, resolver(), session,
        { boundNames: params().map((param) => param.name), presentation: "editor" });
    } catch (e) {
      text = `-- print error: ${(e as Error).message}`;
    }
    return { text, readable: codeLensTextIsReadable(text) };
  });
  const code = () => printed()?.text ?? "";
  const readable = () => printed()?.readable ?? false;
  /** A Local reader's first print has not answered yet. */
  const printing = () => local && !printed();
  const [draft, setDraft] = createSignal("");
  const [error, setError] = createSignal<string | null>(null);
  // A Local re-print of the same expression (its capture moved: a write, a
  // worker replacement) never replaces text the user edited and has not
  // applied; a print of another expression does, as for every reader.
  let shownKey: string | undefined;
  let shownText = "";
  // The compute is one string (equal strings do not re-apply): Account
  // readers keep their former rule, a new printed text replaces the draft.
  createEffect(
    () => printed() ? JSON.stringify([local ? draftValueFingerprint(props.node) : "", code()]) : undefined,
    (shown) => {
      if (shown === undefined) return;
      const [key, text] = JSON.parse(shown) as [string, string];
      const dirty = local && key === shownKey && untrack(draft) !== shownText;
      shownKey = key;
      shownText = text;
      if (dirty) return;
      setDraft(text);
      setError(null);
    },
  );
  let applying: AbortController | undefined;
  /** A Local Apply is being read in the worker, where it may wait behind the
   * tab's own work: the lens says so until the read settles. */
  const [applyPending, setApplyPending] = createSignal(false);
  // B4 unit C fix: a Local Apply in flight holds this surface's Saves (they
  // refuse with the existing "draft changed" copy) until it settles.
  const applyOwner = useContext(DraftCheckScopeContext) ?? draftCheckReaderKey(reader);
  const applyToken = {};
  const settleApply = () => { applying = undefined; setApplyPending(false); releaseDraftCheck(applyOwner, applyToken); };
  onCleanup(() => { applying?.abort(); applying = undefined; releaseDraftCheck(applyOwner, applyToken); });
  function applyDraft() {
    if (!readable()) return;
    if (draft() === code()) {
      setError(null);
      return;
    }
    const names = params().map((p) => p.name);
    if (local) {
      // Apply is a user action: weight 0, latest wins; the answer applies only
      // to the text and node it was read for.
      applying?.abort();
      const own = applying = new AbortController();
      holdDraftCheck(applyOwner, applyToken);
      setApplyPending(true);
      const text = draft(), node = props.node;
      void readLocalExpressionText(reader, () => session, text, names, { signal: own.signal }).then(read => {
        if (applying !== own) return;
        settleApply();
        if (draft() !== text || props.node !== node) return;
        if (read.$tag === "Err") { setError(read._0); return; }
        props.onChange(read._0);
        setError(null);
      }, (e: unknown) => {
        if (applying !== own || own.signal.aborted) return;
        settleApply();
        setError(e instanceof Error ? e.message : String(e));
      });
      return;
    }
    try {
      props.onChange(readAuthoringExpressionText(draft(), names, session));
      setError(null);
    } catch (e) {
      setError((e as Error).message);
    }
  }
  return (
    <div class="expr-code-lens">
      <textarea
        class="expr-code-view expr-code-view--input mono"
        aria-label="Fenel expression code"
        value={draft()}
        readonly={!readable()}
        spellcheck={false}
        onInput={(e) => setDraft(e.currentTarget.value)}
        onBlur={applyDraft}
        onKeyDown={(e) => {
          if ((e.ctrlKey || e.metaKey) && e.key === "Enter") {
            e.preventDefault();
            applyDraft();
          } else if (e.key === "Escape") {
            e.preventDefault();
            if (printing()) return;
            setDraft(code());
            setError(null);
          }
        }}
      />
      <div class="expr-code-lens__actions">
        <button type="button" class="expr-form__btn" disabled={!readable()} aria-busy={applyPending() ? "true" : undefined} onClick={applyDraft}>
          {applyPending() ? "applying…" : "apply"}
        </button>
        <button
          type="button"
          class="expr-form__btn"
          disabled={printing() || draft() === code()}
          onClick={() => {
            setDraft(code());
            setError(null);
          }}
        >
          reset
        </button>
        <Show when={error()}>
          {(msg) => <span class="expr-code-lens__error">{msg()}</span>}
        </Show>
        <Show when={!readable()}>
          {/* A print that has not answered yet (just applied, or the reader still
              preparing) is pending work, not a refusal. */}
          <Show when={printing()} fallback={<span class="expr-code-lens__error">Part of this expression has no text form yet; edit it in the editor.</span>}>
            <span class="text-muted" role="status">Preparing this code…</span>
          </Show>
        </Show>
      </div>
    </div>
  );
}

function CallEditor(props: {
  node: { kind: "call"; fnId: string; args: ExprNode[] };
  onChange: (next: ExprNode) => void;
  onConvertToLiteral: () => void;
  /** Swap this call with the step feeding its first input ("Move down" there). */
  onMoveFirstInputDown?: () => void;
  viewMode: ExprViewMode;
  expectedType?: FenelType;
  expectedScheme?: TypeScheme;
  resultScheme?: TypeScheme;
  graphResult?: (inspect: () => void) => JSX.Element;
  graphCaptureAllowed?: boolean;
}) {
  const session = useAuthoringSession();
  const lambdaParams = useContext(LambdaParamsContext);
  const scopeCapture = useContext(ExpressionGraphScopeCaptureContext);
  const reader = useReaderRuntime();
  const items = useItemPresentation();
  const inferenceContext = useExpressionInferenceContext(session);
  const entry = createMemo(() => authoringFunctionEntry(session, props.node.fnId, props.node.args.length));
  // A call is a constructor either because its index entry says so
  // (constructors registered via buildStdIndex) or — failing that
  // — because the fnId starts with an uppercase letter (Fenel
  // convention; covers user-defined ADTs whose tags aren't yet in the
  // index). When no entry is found at all, we fall back to iterating
  // the node's own args so the slots still render.
  const isCtor = createMemo(() => {
    const e = entry();
    if (e) return e.kind === "constructor";
    return props.node.fnId.startsWith("@ctor/") || /^[A-Z]/.test(fnCodeName(props.node.fnId));
  });
  const guidance = createMemo(() => {
    const current = entry();
    return current ? measureAuthoringWork("call argument guidance", () => callArgumentPlan(props.node, current,
      props.expectedScheme ?? props.expectedType, inferenceContext())) : undefined;
  });
  const params = createMemo(() => guidance()?.params ?? (entry() ? registryCallParams(entry()!) : []));
  const slotMeta = createMemo(() => callSlotMetadata(
    props.node,
    entry() ? params() : undefined,
  ));
  const openParamCount = createMemo(() => slotMeta().openParamCount);
  const resultParam = createMemo(() => nextReturnedFunctionParameter(
    entry(), props.node.args.length, params().length, props.resultScheme,
  ));

  function updateArg(idx: number, next: ExprNode) {
    const args = props.node.args.slice();
    args[idx] = next;
    props.onChange({ ...props.node, args });
  }

  function openFrom(idx: number) {
    props.onChange(partialCallNode(props.node, idx));
  }

  function fillNextArg() {
    const param = params()[props.node.args.length];
    if (param) props.onChange({ ...props.node, args: [...props.node.args, seedExpressionForType(param.type, editorEnvironment(session))] });
  }

  function fillAllArgs() {
    props.onChange({ ...props.node, args: [...props.node.args,
      ...params().slice(props.node.args.length).map((param) => seedExpressionForType(param.type, editorEnvironment(session)))] });
  }

  // The call a pending insertion previews: dashed, and named for the choice
  // still to make while no function is highlighted.
  const pendingCall = () => pendingCalls.has(props.node);
  return <ExpressionCallSurface
    nodeChrome
    pending={pendingCall()}
    graphNode={props.node} graphCaptureAllowed={(scopeCapture.node() ? scopeCapture.allowed() : lambdaParams().length === 0) && props.graphCaptureAllowed !== false}
    graphResult={props.graphResult}
    missingInputs={params().slice(props.node.args.length).map((parameter, offset) => ({
      ordinal: props.node.args.length + offset,
      name: editorParameterName(parameter, props.node.args.length + offset, session, reader),
    }))}
    name={props.node.fnId === PENDING_FUNCTION_ID ? "Choose a function…" : <DisplayNameText name={callNodeDisplayName(entry(), props.node.fnId, items)} />}
    icon={(() => {
      const icon = reader?.presentation(entry()?.targetId ?? props.node.fnId)?.icon;
      return icon ? <IconByName name={icon} size={16} /> : undefined;
    })()}
    resultType={(() => {
      const current = entry();
      const type = props.resultScheme?.body ?? (current && props.node.args.length === params().length
        && props.node.args.length === registryCallParams(current).length ? current.returns : undefined);
      return type ? editorTypePhrase(type, session, reader) : undefined;
    })()}
    isConstructor={isCtor()} openParamCount={openParamCount()}
    trace={<CallTraceBadge fnName={defaultFnCodeName(props.node.fnId)} />}
    onConvertToLiteral={props.onConvertToLiteral}>

        <Show
          when={entry()}
          fallback={
            <For keyed={false} each={props.node.args}>
              {(a, i) => (
                <ExpressionCallArgumentRow parameterName={`Input ${i + 1}`} ordinal={i} nodeByDefault={i === 0 || a().kind === "call"}
                  filled={a().kind !== "literal" || (a() as Extract<ExprNode, { kind: "literal" }>).value !== undefined} partialActions={false}>
                <PathSegmentProvider label={`${fnCodeName(props.node.fnId)}.arg${i + 1}`}>
                  <ResultBindingInput node={a()} index={i}>
                  <NodeEditor
                    node={a()}
                    onChange={(next) => updateArg(i, next)}
                    typeName={undefined}
                    paramName={`arg ${i + 1}`}
                    viewMode={props.viewMode}
                  />
                  </ResultBindingInput>
                </PathSegmentProvider>
                </ExpressionCallArgumentRow>
              )}
            </For>
          }
        >
          <Show when={params().length > 0}>
            <div class="expr-call__partial-actions">
              <Show when={openParamCount() > 0}>
                <button
                  type="button"
                  class="expr-call__partial-btn"
                  onClick={fillNextArg}
                  data-tooltip="Fill the next open argument slot"
                >
                  + next
                </button>
                <button
                  type="button"
                  class="expr-call__partial-btn"
                  onClick={fillAllArgs}
                  data-tooltip="Fill every open argument slot"
                >
                  fill all
                </button>
              </Show>
            </div>
          </Show>
          <For keyed={false} each={slotMeta().renderedArgs}>
            {(slot) => (
              <ExpressionCallArgumentRow parameterName={editorParameterName(slot().param, slot().index, session, reader)}
                ordinal={slot().index} nodeByDefault={slot().index === 0 || props.node.args[slot().index]?.kind === "call"}
                filled={!!props.node.args[slot().index] && (props.node.args[slot().index]?.kind !== "literal"
                  || (props.node.args[slot().index] as Extract<ExprNode, { kind: "literal" }>).value !== undefined)} onOpen={() => openFrom(slot().index)}>

                  <PathSegmentProvider label={`${fnCodeName(props.node.fnId)}.${slot().param?.name ?? `arg${slot().index + 1}`}`}>
                    <ResultBindingInput node={props.node.args[slot().index] ?? EMPTY_EXPRESSION} index={slot().index}>
                    <NodeEditor
                      node={props.node.args[slot().index] ?? EMPTY_EXPRESSION}
                      onChange={(next) => updateArg(slot().index, next)}
                      typeName={slot().param ? typeNameOf(slot().param!.type, session) : undefined}
                      paramName={slot().param?.name ?? `argument ${slot().index + 1}`}
                      fieldDef={slot().param}
                      expectedScheme={guidance()?.paramSchemes[slot().index]}
                      requirementSource={`${functionPickerDisplayName(entry()!)} › ${displayNameText(editorParameterName(slot().param, slot().index, session, reader))}`}
                      onMoveDown={slot().index === 0 ? props.onMoveFirstInputDown : undefined}
                      viewMode={props.viewMode}
                    />
                    </ResultBindingInput>
                  </PathSegmentProvider>

              </ExpressionCallArgumentRow>
            )}
          </For>
        </Show>
        <Show when={!entry()}>
          <button type="button" class="expr-call__partial-btn"
            onClick={() => props.onChange({ ...props.node, args: [...props.node.args, EMPTY_EXPRESSION] })}>
            + argument
          </button>
        </Show>
        <Show when={resultParam()}>
          {(param) => <button type="button" class="expr-call__partial-btn"
            data-tooltip="Apply the function returned by this call"
            onClick={() => props.onChange({ ...props.node, args: [...props.node.args,
              seedExpressionForType(param().type, editorEnvironment(session))] })}>
            + result argument
          </button>}
        </Show>
        <Show when={props.node.args.length > 0 && (!entry() || props.node.args.length > params().length)}>
          <button type="button" class="expr-call__partial-btn"
            onClick={() => props.onChange({ ...props.node, args: props.node.args.slice(0, -1) })}>
            Remove last argument
          </button>
        </Show>

  </ExpressionCallSurface>;
}

// ---------------------------------------------------------------------------
// Pipe view — display-only linearization of nested calls into `x |> f |> g`
// ---------------------------------------------------------------------------

type PipeSpineStep = {
  node: { kind: "call"; fnId: string; args: ExprNode[] };
  /** Replaces this step's whole subtree, threading the change up to the root. */
  onChange: (next: ExprNode) => void;
};

/** Walk the spine from the outer call inward through `args[0]` until we hit a
 *  non-call. Returns the steps in OUTER-FIRST order plus the value sitting at
 *  the bottom of the spine and an onChange that replaces it. */
function walkPipeSpine(
  start: { kind: "call"; fnId: string; args: ExprNode[] },
  startOnChange: (next: ExprNode) => void,
): { value: ExprNode; valueOnChange: (next: ExprNode) => void; steps: PipeSpineStep[] } {
  const steps: PipeSpineStep[] = [];
  let curNode: ExprNode = start;
  let curOnChange: (next: ExprNode) => void = startOnChange;

  // A nullary call is the value at the bottom of the pipe. Walking past it
  // would invent an input slot and turn Nothing into the impossible Nothing x.
  while (curNode.kind === "call" && curNode.args.length > 0) {
    const callNode: { kind: "call"; fnId: string; args: ExprNode[] } = curNode;
    const callOnChange: (next: ExprNode) => void = curOnChange;
    steps.push({ node: callNode, onChange: callOnChange });

    const arg0: ExprNode = callNode.args[0] ?? EMPTY_EXPRESSION;
    const arg0OnChange = (next: ExprNode) => {
      const args = callNode.args.slice();
      args[0] = next;
      callOnChange({ ...callNode, args });
    };

    curNode = arg0;
    curOnChange = arg0OnChange;
  }

  return { value: curNode, valueOnChange: curOnChange, steps };
}

function PipeView(props: {
  node: { kind: "call"; fnId: string; args: ExprNode[] };
  onChange: (next: ExprNode) => void;
  onConvertToLiteral: () => void;
  viewMode: ExprViewMode;
  expectedType?: FenelType;
  expectedScheme?: TypeScheme;
}) {
  const session = useAuthoringSession();
  const inferenceContext = useExpressionInferenceContext(session);
  const chain = createMemo(() => walkPipeSpine(props.node, props.onChange));
  // Display order is innermost-first (top) so reading top-to-bottom matches
  // application order: value → first step applied → … → last step applied.
  const reversedSteps = createMemo(() => chain().steps.slice().reverse());
  const guidance = createMemo(() => {
    let expected: FenelType | TypeScheme | undefined = props.expectedScheme ?? props.expectedType;
    return chain().steps.map((step) => {
      const entry = authoringFunctionEntry(session, step.node.fnId, step.node.args.length);
      const current = entry ? callArgumentPlan(step.node, entry, expected, inferenceContext()) : undefined;
      expected = current?.paramSchemes[0] ?? current?.params[0]?.type;
      return current;
    });
  });
  const valueField = () => guidance().at(-1)?.params[0];

  const valueTypeName = createMemo(() => {
    const t = valueField()?.type;
    return t ? typeNameOf(t, session) : undefined;
  });

  function clearStepToLiteral(originalIdx: number, step: PipeSpineStep) {
    // The outermost step (originalIdx === 0) defers to the parent's
    // `onConvertToLiteral`, which knows the surrounding param's example
    // fallback. Inner steps fall back to the containing call's first param.
    if (originalIdx === 0) {
      props.onConvertToLiteral();
      return;
    }
    const t = guidance()[originalIdx - 1]?.params[0]?.type;
    step.onChange(seedExpressionForType(t, editorEnvironment(session)));
  }

  return (
    <div class="expr-pipe">
      <div class="expr-pipe__value">
        <PathSegmentProvider label="pipe value">
          <NodeEditor
            node={chain().value}
            onChange={chain().valueOnChange}
            typeName={valueTypeName()}
            fieldDef={valueField()}
            expectedScheme={guidance().at(-1)?.paramSchemes[0]}
            viewMode={props.viewMode}
          />
        </PathSegmentProvider>
      </div>
      <For keyed={false} each={reversedSteps()}>
        {(step, i) => {
          // Index gives us a stable position; re-derive the original
          // outer-first index reactively so chain edits stay correct.
          const originalIdx = () => reversedSteps().length - 1 - i;
          return (
            <>
              <div class="expr-pipe__arrow">↓</div>
              <PipeStep
                node={step().node}
                onChange={step().onChange}
                onConvertToLiteral={() => clearStepToLiteral(originalIdx(), step())}
                viewMode={props.viewMode}
                params={guidance()[originalIdx()]?.params}
                paramSchemes={guidance()[originalIdx()]?.paramSchemes}
              />
            </>
          );
        }}
      </For>
    </div>
  );
}

function PipeStep(props: {
  node: { kind: "call"; fnId: string; args: ExprNode[] };
  onChange: (next: ExprNode) => void;
  onConvertToLiteral: () => void;
  viewMode: ExprViewMode;
  params?: FieldDef[];
  paramSchemes?: (TypeScheme | undefined)[];
}) {
  const session = useAuthoringSession();
  const reader = useReaderRuntime();
  const items = useItemPresentation();
  const entry = createMemo(() => authoringFunctionEntry(session, props.node.fnId, props.node.args.length));
  // Only supplied arguments render. Trailing open parameters are a partial
  // application, including in pipe view; switching views must not create holes.
  const params = createMemo(() => props.params ?? (entry() ? registryCallParams(entry()!) : undefined));
  const slots = createMemo(() => callSlotMetadata(props.node, params()));
  const sideArgs = createMemo(() => slots().renderedArgs.filter((slot) => slot.index > 0));

  function updateArg(idx: number, next: ExprNode) {
    const args = props.node.args.slice();
    args[idx] = next;
    props.onChange({ ...props.node, args });
  }

  return (
    <ExpressionCallSurface name={<DisplayNameText name={callNodeDisplayName(entry(), props.node.fnId, items)} />}
      icon={(() => { const icon = reader?.presentation(entry()?.targetId ?? props.node.fnId)?.icon;
        return icon ? <IconByName name={icon} size={16} /> : undefined; })()}
      isConstructor={entry()?.kind === "constructor"} openParamCount={slots().openParamCount}
      onConvertToLiteral={props.onConvertToLiteral}>
      <Show when={sideArgs().length > 0 || slots().openParamCount > 0}>
          <For keyed={false} each={sideArgs()}>
            {(slot) => (
              <ExpressionCallArgumentRow partialActions={false} parameterName={editorParameterName(slot().param, slot().index, session, reader)}
                ordinal={slot().index} nodeByDefault={slot().index === 0 || props.node.args[slot().index]?.kind === "call"}>
              <PathSegmentProvider label={`${fnCodeName(props.node.fnId)}.${slot().param?.name ?? `arg${slot().index + 1}`}`}>
                <NodeEditor
                  node={props.node.args[slot().index] ?? EMPTY_EXPRESSION}
                  onChange={(next) => updateArg(slot().index, next)}
                  typeName={slot().param ? typeNameOf(slot().param!.type, session) : undefined}
                  paramName={slot().param?.name ?? `argument ${slot().index + 1}`}
                  fieldDef={slot().param}
                  expectedScheme={props.paramSchemes?.[slot().index]}
                  viewMode={props.viewMode}
                />
              </PathSegmentProvider>
              </ExpressionCallArgumentRow>
            )}
          </For>
          <Show when={slots().openParamCount > 0}>
            <button type="button" class="expr-call__partial-btn"
              data-tooltip="Fill the next open argument slot"
              onClick={() => {
                const param = params()?.[props.node.args.length];
                if (param) props.onChange({ ...props.node, args: [...props.node.args, seedExpressionForType(param.type, editorEnvironment(session))] });
              }}>+ next</button>
          </Show>
          <Show when={props.node.args.length > (params()?.length ?? props.node.args.length)}>
            <button type="button" class="expr-call__partial-btn"
              onClick={() => props.onChange({ ...props.node, args: props.node.args.slice(0, -1) })}>
              Remove last argument
            </button>
          </Show>
      </Show>
    </ExpressionCallSurface>
  );
}

/** Detect a {$pin} sentinel — these values carry a typed reference to
 *  some artefact (function, type, page, …) rather than scalar data, so
 *  the literal editor surfaces a meaningful display rather than
 *  String([object Object]). */
function detectPinValue(v: unknown): { kind: string; name: string; id: string } | null {
  if (!v || typeof v !== "object") return null;
  const o = v as Record<string, unknown>;
  if (typeof o["$pin"] !== "string") return null;
  const name = typeof o["name"] === "string" ? o["name"] : "";
  const id = typeof o["id"] === "string" ? o["id"] : name;
  return { kind: o["$pin"] as string, name, id };
}

/** Detect a structural Fenel form (do / let / if / match / construct /
 *  lambda) tagged with a `__form` marker — the same convention
 *  `__lambda` uses. These are sequencing / control-flow / data-building
 *  forms, not function calls, but they still need rich editor UX
 *  (recursive sub-editors) so they render via dedicated builders that
 *  delegate child slots to NodeEditor. */
import { blankLocalBinding, detectStructuralForm as detectStructuralFormCore, structuralModeForForm, type StructuralForm } from "./expression-structure";
import { LocalBindingsEntry, LambdaFormEditorSurface, RecordValueEditorSurface, WhereFormEditorSurface, ConstructFormEditorSurface, LetBindingsFormEditorSurface, MatchFormEditorSurface } from "./structural-surfaces";

export function detectStructuralForm(value: unknown): StructuralForm | null {
  return detectStructuralFormCore(value, (strategy) => strategy in EVALUATOR_STRATEGIES);
}

function LiteralEditor(props: {
  node: { kind: "literal"; value: unknown };
  typeName: string | undefined;
  fieldDef?: FieldDef;
  expectedScheme?: TypeScheme;
  expectedOutcome?: InferenceOutcome;
  observeMembershipHints?: MembershipHintObserver;
  onChange: (v: unknown) => void;
  /** Replaces this whole occurrence: a structural form that unwraps (its last
   * local binding removed) yields an expression, never this literal's value. */
  onReplace: (node: ExprNode) => void;
  onPickFunction: (fnId: string) => void;
}) {
  const session = useAuthoringSession();
  const reader = useReaderRuntime();
  const pin = createMemo(() => detectPinValue(props.node.value));
  const structural = createMemo(() => detectStructuralForm(props.node.value));
  const typeLiteral = createMemo(() => isEditableTypeLiteral(props.node.value, session) ? props.node.value : null);
  const widget = createMemo(() => {
    const requiredType = props.fieldDef?.type;
    const control = inlineWidgetFor(widgetTypeForSlot(requiredType, props.node.value),
      props.typeName, editorWidgetEnvironment(session, reader));
    return control ? { ...control, requiredType } : undefined;
  });
  // The widget owner already resolves aliases. Preserve that exact mapping
  // back to its selected requirement without comparing or resolving types again.
  const observeWidgetHints: MembershipHintObserver = source => props.observeMembershipHints?.({
    ...source, type: () => widget()?.requiredType,
    hints: () => {
      const control = widget();
      return control && source.type() === control.type ? source.hints() : undefined;
    },
  }) ?? (() => {});

  /** When this slot's declared type peels to a `$record`, surface its
   *  fields so a nested `record { … }` structural-form literal can
   *  constrain its field-name picker. Falls back to `undefined` for
   *  untyped slots — those keep free-form entry. */
  const expectedRecordFields = createMemo<FieldDef[] | undefined>(() => {
    const fd = props.fieldDef;
    if (!fd) return undefined;
    const rec = peelToRecord(fd.type, session);
    if (!rec || !("$record" in rec)) return undefined;
    return (rec as { $record: { fields: FieldDef[] } }).$record.fields;
  });

  return (
    <Show when={pin()} fallback={
      <Show when={structural()} fallback={
        <Show when={typeLiteral()} fallback={
          <Show when={widget()}>
            {(control) => <Show when={control().kind === "image"} fallback={
              <ExpressionLiteralSurface value={props.node.value}>
                <ExprFieldContext value={{ Wrapper: NestedExprWrapper, ListItemWrapper: NestedListItemWrapper, ArrowBodyEditor: LambdaEditor,
                  defaultValueForType: (type) => {
                    const seed = seedExpressionForType(type, editorEnvironment(session));
                    if (seed.kind === "literal" && !detectStructuralForm(seed.value)) return seed.value;
                    if (draftSaveIssue(seed, editorEnvironment(session))) return undefined;
                    // B4 F2: a Local reader never evaluates on the page: a
                    // purely literal seed is its data, a computed one leaves
                    // the new slot incomplete (Save refuses an empty item).
                    if (localStructure(session)) return literalSeedData(seed, type, session)?.value;
                    try { return evaluateAuthoringExpression(seed, undefined, session).result; } catch { return undefined; }
                  },
                }}>
                  <FieldRenderer
                    registry={editorFieldRegistry(session, reader)}
                    identityMode={props.fieldDef?.key?.$tag === "NamedField" ? "identified" : "transient"}
                    field={{ ...(props.fieldDef ?? expressionField(control().type)!), type: control().type }}
                    value={props.node.value}
                    onChange={props.onChange}
                    observeMembershipHints={observeWidgetHints}
                    compact
                  />
                </ExprFieldContext>
              </ExpressionLiteralSurface>
            }>
              <ImageCanvas value={props.node.value} />
            </Show>}
          </Show>
        }>
          {(type) => (
            <TypeLiteralEditor type={type()} onChange={props.onChange} />
          )}
        </Show>
      }>
        {(form) => (
          <StructuralFormEditor
            form={form()}
            onChange={props.onChange}
            onReplace={props.onReplace}
            onPickFunction={props.onPickFunction}
            fieldType={props.fieldDef?.type}
            expectedScheme={props.expectedScheme}
            expectedOutcome={props.expectedOutcome}
            expectedRecordFields={expectedRecordFields()}
          />
        )}
      </Show>
    }>
      {(p) => <PinLiteralDisplay pin={p()} />}
    </Show>
  );
}

/** Dispatch to the right builder for each structural form. Each builder
 *  edits the form in-place and writes back through `onChange` using the
 *  same `__form` marker shape (so round-trip with `logicToExprNode` is
 *  preserved). All child slots route through `NodeEditor` so the full
 *  call/inline/ref/param tab UX nests recursively. */
function StructuralFormEditor(props: {
  form: StructuralForm;
  onChange: (v: unknown) => void;
  onReplace: (node: ExprNode) => void;
  onPickFunction: (fnId: string) => void;
  fieldType?: FenelType;
  expectedScheme?: TypeScheme;
  expectedOutcome?: InferenceOutcome;
  /** Expected fields of a `record { … }` literal at this slot — derived
   *  from the slot's declared type (peeled to `$record`). When present,
   *  the record builder constrains its field-name picker to these
   *  names. Undefined ⇒ untyped slot ⇒ free-form entry. */
  expectedRecordFields?: FieldDef[];
}) {
  const session = useAuthoringSession();
  const localParams = useContext(LambdaParamsContext);
  const inferenceContext = useExpressionInferenceContext(session);
  const liveGuidance = useContext(ExpressionGuidanceContext) ?? undefined;
  const parentScheme = createMemo(() => props.expectedScheme
    ?? expectedSchemeForType(props.fieldType, editorEnvironment(session))
    ?? (props.fieldType ? { quantified: [], body: props.fieldType } : undefined));
  const listElement = createMemo(() => props.form.kind === "list"
    ? projectAuthoringChildExpectation(parentScheme(), { kind: "list-element" }, editorEnvironment(session)) : undefined);
  const applicationType = createMemo(() => {
    if (props.form.kind !== "apply" || props.form.content.target.kind !== "param") return undefined;
    const name = props.form.content.target.name;
    const parameter = localParams().findLast(param => param.name === name);
    const arrow = peelArrowType(parameter?.type, session);
    if (!arrow || !("$arrow" in arrow)) return undefined;
    // Explicit type applications retain their declared kinds and argument
    // carriers. Ordinary local calls use the same complete-scheme guidance as
    // catalogue calls, including equations supplied by sibling arguments.
    const target = parameter?.typeApplication === undefined
      ? liveGuidance ? liveGuidance.read({ node: props.form.content.target, bindings: inferenceContext().bindings ?? {} })
        : inferScopedAuthoringExpression(props.form.content.target, inferenceContext()) : undefined;
    const scheme = target?.outcome.$tag === "Solved" ? target.scheme : undefined;
    const guidance = scheme && "$arrow" in scheme.body
      ? inferAuthoringCallGuidance({
        id: name, params: scheme.body.$arrow.params, returns: scheme.body.$arrow.returns,
        scheme, signatureOutcome: target?.outcome,
      }, props.form.content.args, parentScheme(), inferenceContext()) : undefined;
    return { type: arrow, scheme: parameter?.typeApplication ? parameter.scheme : scheme,
      params: parameter?.typeApplication?.params ?? guidance?.params ?? arrow.$arrow.params,
      paramSchemes: guidance?.paramSchemes };
  });
  const graphCapture = useContext(ExpressionGraphCaptureContext);
  return (
    <Switch>
      <Match when={(props.form.kind === "list" || props.form.kind === "lookup" || props.form.kind === "apply"
        || props.form.kind === "scope" || props.form.kind === "pipeline" || props.form.kind === "operation") && props.form}>
        {(form) => <ExtendedExpressionEditor form={form()} onChange={props.onChange}
          operators={RUNTIME_AUTHORING_OPERATORS}
          applicationParameters={applicationType()?.params}
          applicationType={applicationType()?.type}
          applicationScheme={applicationType()?.scheme}
          applicationParameterSchemes={applicationType()?.paramSchemes}
          listElementType={listElement()?.type}
          listElementScheme={listElement()?.scheme}
          listElementOutcome={props.expectedOutcome ?? listElement()?.outcome}
          resultType={props.fieldType} resultScheme={props.expectedScheme} resultOutcome={props.expectedOutcome}
          expression={(slot) => <ExpressionGraphCaptureContext value={{ ...graphCapture,
            activate: (active, token, node, allowed) => graphCapture.activate?.(active, token, node,
              form().kind === "scope" && slot.label === "Body" ? false : allowed) }}>
            <PathSegmentProvider label={slot.label}>
              <NodeEditor node={slot.value} paramName={slot.label} onChange={slot.onChange}
                expectedType={slot.type} expectedScheme={slot.scheme} expectedOutcome={slot.outcome}
                typeName={slot.type ? typeNameOf(slot.type, session) : undefined} viewMode="nested" />
            </PathSegmentProvider>
          </ExpressionGraphCaptureContext>}
          literal={(slot) => <RawValueEditor value={slot.value} label={slot.label} onChange={slot.onChange} />}
        />}
      </Match>
      <Match when={props.form.kind === "do" && (props.form as { kind: "do"; body: ExprNode[] })}>
        {(f) => (
          <DoBlockEditor
            body={f().body}
            expectedType={props.fieldType}
            expectedScheme={props.expectedScheme}
            expectedOutcome={props.expectedOutcome}
            onChange={(next) => props.onChange({ __do: next })}
          />
        )}
      </Match>
      <Match when={props.form.kind === "let" && (props.form as { kind: "let"; bindings: { name: string; expr: ExprNode }[] })}>
        {(f) => (
          <LetBindingsEditor
            bindings={f().bindings}
            expectedType={props.fieldType}
            expectedScheme={props.expectedScheme}
            expectedOutcome={props.expectedOutcome}
            onChange={(next) => props.onChange({ __let: { bindings: next } })}
          />
        )}
      </Match>
      <Match when={props.form.kind === "where" && (props.form as { kind: "where"; body: ExprNode; bindings: WhereBinding<ExprNode>[] })}>
        {(f) => (
          <WhereFormEditor
            body={f().body}
            bindings={f().bindings}
            expectedType={props.fieldType}
            expectedScheme={props.expectedScheme}
            expectedOutcome={props.expectedOutcome}
            onChange={(next) => {
              if (isExprNodeValue(next)) props.onReplace(next);
              else props.onChange({ __where: next });
            }}
          />
        )}
      </Match>
      <Match when={props.form.kind === "ann" && (props.form as { kind: "ann"; expr: ExprNode; type: unknown })}>
        {(f) => (
          <AnnotationFormEditor
            expr={f().expr}
            type={f().type}
            expectedOutcome={props.expectedOutcome}
            onChange={(next) => props.onChange({ __ann: next })}
          />
        )}
      </Match>
      <Match when={props.form.kind === "cat" && (props.form as { kind: "cat"; parts: ExprNode[] })}>
        {(f) => (
          <CatFormEditor
            parts={f().parts}
            onChange={(next) => props.onChange({ __cat: next })}
          />
        )}
      </Match>
      <Match when={props.form.kind === "evaluator" && (props.form as { kind: "evaluator"; strategy: EvaluatorStrategy; body: ExprNode })}>
        {(f) => (
          <EvaluatorFormEditor
            strategy={f().strategy}
            body={f().body}
            expectedType={props.fieldType}
            expectedScheme={props.expectedScheme}
            expectedOutcome={props.expectedOutcome}
            onChange={(next) => props.onChange({ __evaluator: next })}
          />
        )}
      </Match>
      <Match when={props.form.kind === "match" && (props.form as { kind: "match"; scrutinee: ExprNode; arms: { pattern: unknown; body: ExprNode }[] })}>
        {(f) => (
          <MatchFormEditor
            scrutinee={f().scrutinee}
            arms={f().arms}
            expectedType={props.fieldType}
            expectedScheme={props.expectedScheme}
            expectedOutcome={props.expectedOutcome}
            onChange={(next) => props.onChange({ __match: next })}
          />
        )}
      </Match>
      <Match when={props.form.kind === "construct" && (props.form as { kind: "construct"; tag: string; fields: { name: string; value: ExprNode }[] })}>
        {(f) => (
          <ConstructValueEditor
            tag={f().tag}
            fields={f().fields}
            onChange={(next) => props.onChange({ __construct: next })}
            onPickFunction={props.onPickFunction}
            expectedType={props.fieldType}
            expectedScheme={props.expectedScheme}
            expectedOutcome={props.expectedOutcome}
          />
        )}
      </Match>
      <Match when={props.form.kind === "record" && (props.form as { kind: "record"; fields: { name: string; value: ExprNode }[] })}>
        {(f) => (
          <RecordValueEditor
            fields={f().fields}
            onChange={(next) => props.onChange({ __record: next })}
            expectedFields={props.expectedRecordFields}
            expectedType={props.fieldType}
            expectedScheme={props.expectedScheme}
            expectedOutcome={props.expectedOutcome}
          />
        )}
      </Match>
      <Match when={props.form.kind === "lambda" && (props.form as { kind: "lambda"; params: string[]; body: ExprNode; arrayParams?: boolean })}>
        {(f) => (
          <LambdaFormEditor
            params={f().params}
            body={f().body}
            arrowType={peelArrowType(props.fieldType, session)}
            expectedScheme={props.expectedScheme}
            expectedOutcome={props.expectedOutcome}
            onChange={(next) => props.onChange({ __lambda: { ...(f().arrayParams === undefined ? {} : { arrayParams: f().arrayParams }), ...next } })}
          />
        )}
      </Match>
    </Switch>
  );
}

function TypeLiteralEditor(props: {
  type: FenelType;
  onChange: (v: unknown) => void;
}) {
  return (
    <div class="expr-literal--block expr-type-literal">
      <div class="expr-form__head mono">type</div>
      <TypeBuilder
        value={props.type}
        onChange={(next) => props.onChange(next)}
      />
    </div>
  );
}

const GENERIC_LAMBDA_PARAM_TYPE = { $ref: "Value" } as FenelType;

function LambdaFormEditor(props: {
  params: string[];
  body: ExprNode;
  arrowType?: FenelType;
  expectedScheme?: TypeScheme;
  expectedOutcome?: InferenceOutcome;
  onChange: (next: { params: string[]; body: ExprNode }) => void;
}) {
  const session = useAuthoringSession();
  const inheritedParams = useContext(LambdaParamsContext);
  const [bindingIssue, setBindingIssue] = createSignal("");
  const arrow = createMemo(() => {
    const t = props.arrowType;
    return t && typeof t === "object" && "$arrow" in t
      ? (t as { $arrow: { params: FieldDef[]; returns: FenelType } }).$arrow
      : undefined;
  });
  const lambdaParams = createMemo<LambdaParam[]>(() => [
    ...inheritedParams().filter((param) => !props.params.includes(param.name.split(".")[0]!)),
    ...props.params
      .filter((name) => name.trim() !== "")
      .map((name, i) => ({
        name,
        label: arrow()?.params[i]?.label ?? Nothing,
        type: arrow()?.params[i]?.type ?? GENERIC_LAMBDA_PARAM_TYPE,
        scheme: props.expectedScheme ? projectAuthoringScheme(props.expectedScheme, ["$arrow", "params", String(i), "type"]) : undefined,
        meta: {},
        ui: Nothing,
      })),
  ]);

  function editBinding(edit: AuthoringBindingEdit) {
    const result = editAuthoringBinding({
      params: props.params.map((name) => ({ name })),
      body: props.body,
    }, edit, editorFrame(session));
    if (!result.ok) {
      setBindingIssue(result.diagnostics.map((issue) => issue.message).join(" "));
      return false;
    }
    setBindingIssue("");
    const params = result.value.params.map((param) => param.name);
    if (edit.kind === "add") params.push(edit.name);
    if (edit.kind === "remove") params.splice(edit.index, 1);
    props.onChange({ params, body: result.value.body });
    return true;
  }
  function addParam() {
    let name = "x";
    let n = 1;
    const used = [...props.params, ...inheritedParams().map((param) => param.name.split(".")[0]!)];
    while (used.includes(name)) name = `x${++n}`;
    editBinding({ kind: "add", name });
  }
  function setBody(body: ExprNode) {
    props.onChange({ params: props.params, body });
  }

  return (
    <LambdaFormEditorSurface
      params={props.params}
      onAdd={!arrow() || props.params.length < arrow()!.params.length ? addParam : undefined}
      onRemove={!arrow() || props.params.length > arrow()!.params.length
        ? (index) => editBinding({ kind: "remove", index }) : undefined}
      parameter={(slot) => <BindingNameInput
        value={slot.name}
        onChange={(name) => editBinding({ kind: "rename", index: slot.index, name })}
        placeholder="param"
      />}
      parameterType={(slot) => <Show when={arrow()?.params[slot.index]}>
        {(p) => <TypeContractType type={displayTypeLabel(p().type)} />}
      </Show>}
      result={() => <TypeContract required={arrow() ? { label: displayTypeLabel(arrow()!.returns) } : undefined}
        note={arrow() ? undefined : "Inferred from body"} />}
      diagnostics={() => <Show when={bindingIssue()}><div class="data-error" role="alert">{bindingIssue()}</div></Show>}
      body={() => <LambdaParamsContext value={() => expandParamPaths(lambdaParams(), session)}>
        <PathSegmentProvider label="Function body">
          <NodeEditor
            node={props.body}
            onChange={setBody}
            typeName={arrow() ? displayTypeLabel(arrow()!.returns) : undefined}
            fieldDef={arrow() ? { name: "body", label: Nothing, type: arrow()!.returns, meta: {}, ui: Nothing } : undefined}
            expectedScheme={props.expectedScheme ? projectAuthoringScheme(props.expectedScheme, ["$arrow", "returns"]) : undefined}
            expectedOutcome={props.expectedOutcome}
            hideLabel
            viewMode="nested"
          />
        </PathSegmentProvider>
      </LambdaParamsContext>}
    />
  );
}

/** Anonymous record literal — `{ field1 = expr1, … }`. Same shape as
 *  ConstructValueEditor minus the tag header. Each row is a field-name
 *  input + recursive NodeEditor for the value expression. */
function RecordValueEditor(props: {
  fields: { name: string; value: ExprNode }[];
  onChange: (next: { fields: { name: string; value: ExprNode }[] }) => void;
  /** Declared fields of the expected record type (when known). Acts the
   *  same way as a constructor's params: the field-name input becomes a
   *  select scoped to these names; "+ field" adds the first unbound
   *  declared field; the button disables when all are bound. */
  expectedFields?: FieldDef[];
  expectedType?: FenelType;
  expectedScheme?: TypeScheme;
  expectedOutcome?: InferenceOutcome;
}) {
  const session = useAuthoringSession();
  const parentScheme = createMemo(() => props.expectedScheme
    ?? expectedSchemeForType(props.expectedType, editorEnvironment(session))
    ?? (props.expectedType ? { quantified: [], body: props.expectedType } : undefined));
  function update(i: number, patch: Partial<{ name: string; value: ExprNode }>) {
    const out = props.fields.slice();
    out[i] = { ...out[i]!, ...patch };
    props.onChange({ fields: out });
  }
  function removeAt(i: number) {
    const out = props.fields.slice();
    out.splice(i, 1);
    props.onChange({ fields: out });
  }
  const remainingFieldNames = createMemo(() => {
    const expected = props.expectedFields;
    if (!expected) return [] as string[];
    const used = new Set(props.fields.map((f) => f.name));
    return expected.map((p) => p.name).filter((n) => !used.has(n));
  });
  function fieldDefinition(name: string): FieldDef | undefined {
    return props.expectedFields?.find((field) => field.name === name);
  }
  function fieldExpectation(name: string) {
    return projectAuthoringChildExpectation(parentScheme(),
      { kind: "record-field", name, key: fieldDefinition(name)?.key }, editorEnvironment(session));
  }
  function addField() {
    const expected = props.expectedFields;
    if (expected) {
      const rem = remainingFieldNames();
      if (rem.length === 0) return;
      const n = rem[0]!;
      props.onChange({
        fields: [...props.fields, { name: n, value: { kind: "literal", value: undefined } }],
      });
      return;
    }
    let n = "field";
    let k = 1;
    while (props.fields.some((f) => f.name === n)) n = `field${++k}`;
    props.onChange({
      fields: [...props.fields, { name: n, value: { kind: "literal", value: undefined } }],
    });
  }
  return (
    <RecordValueEditorSurface
      fields={props.fields}
      onAdd={addField}
      onRemove={removeAt}
      addDisabled={!!props.expectedFields && remainingFieldNames().length === 0}
      addTooltip={
        !props.expectedFields
          ? "Add a field"
          : remainingFieldNames().length === 0
            ? "All fields are already set"
            : remainingFieldNames().length === 1
              ? `Add field "${remainingFieldNames()[0]}"`
              : "Add the next unset field"
      }
      fieldName={(slot) => <CtorFieldNameSelect
        value={slot.field.name}
        onChange={(next) => update(slot.index, { name: next })}
        params={props.expectedFields}
        usedNames={props.fields.map((g, j) => (j === slot.index ? "" : g.name)).filter(Boolean)}
      />}
      expression={(slot) => {
        const expected = createMemo(() => fieldExpectation(slot.field.name));
        return <PathSegmentProvider label={`record.${slot.field.name || "?"}`}>
          <NodeEditor
            node={slot.field.value}
            onChange={(next) => update(slot.index, { value: next })}
            fieldDef={fieldDefinition(slot.field.name)}
            expectedType={expected().type}
            expectedScheme={expected().scheme}
            expectedOutcome={props.expectedOutcome ?? expected().outcome}
            typeName={expected().type ? typeNameOf(expected().type!, session) : undefined}
            viewMode="nested"
          />
        </PathSegmentProvider>;
      }}
    />
  );
}

/** `Tag { field1 = expr1, … }` — ADT construction with named fields.
 *  A selected constructor is a reference; an unresolved authored tag is an
 *  identifier. Each field row has a field-name input plus a recursive NodeEditor.
 *  Same visual conventions as PatternCtorEditor — amber tinting + indented
 *  field rows — but in the *value* sub-language (an expression-builder
 *  on each field slot, not a pattern-builder). */
function ConstructValueEditor(props: {
  tag: string;
  fields: { name: string; value: ExprNode }[];
  onChange: (next: { tag: string; fields: { name: string; value: ExprNode }[] }) => void;
  onPickFunction: (fnId: string) => void;
  expectedType?: FenelType;
  expectedScheme?: TypeScheme;
  expectedOutcome?: InferenceOutcome;
}) {
  const session = useAuthoringSession();
  const reader = useReaderRuntime();
  const [picking, setPicking] = createSignal(false);
  const displayTag = () => {
    const entry = ctorEntry();
    return entry ? constructorEntryCaption(entry, session, reader) : props.tag;
  };
  function pickCtor(fnId: string) {
    const entry = authoringFunctionEntry(session, fnId);
    if (entry?.kind === "constructor" && entry.signatureOutcome?.$tag === "Solved"
      && (entry.targetId ?? fnId) !== (ctorEntry()?.targetId ?? props.tag)) props.onPickFunction(fnId);
    setPicking(false);
  }
  function setTag(next: string) {
    props.onChange({ tag: next === displayTag() ? props.tag : next, fields: props.fields });
  }
  function update(i: number, patch: Partial<{ name: string; value: ExprNode }>) {
    const out = props.fields.slice();
    out[i] = { ...out[i]!, ...patch };
    props.onChange({ tag: props.tag, fields: out });
  }
  function removeAt(i: number) {
    const out = props.fields.slice();
    out.splice(i, 1);
    props.onChange({ tag: props.tag, fields: out });
  }
  /** Declared params of the picked tag — same pattern as
   *  PatternCtorEditor minus the scrutinee path. Tries the exact environment
   *  resolver first, then walks the live catalog so user-module ADTs that
   *  registered after FN_INDEX was built still surface their fields. */
  const ctorParams = createMemo(() => {
    return constructorFieldsForTag(props.tag, editorEnvironment(session));
  });
  const ctorEntry = createMemo(() => {
    const target = editorEnvironment(session).resolveConstructorTarget?.(props.tag);
    const entry = target ? authoringFunctionEntry(session, target) : undefined;
    return entry?.kind === "constructor" && entry.signatureOutcome?.$tag === "Solved"
      ? entry : undefined;
  });
  function fieldScheme(name: string): TypeScheme | undefined {
    const entry = ctorEntry();
    const indices = entry?.params.flatMap((param, index) => param.name === name ? [index] : []) ?? [];
    return entry?.scheme && indices.length === 1
      ? projectAuthoringScheme(entry.scheme, ["$arrow", "params", String(indices[0]), "type"])
      : undefined;
  }
  const remainingFieldNames = createMemo(() => {
    const params = ctorParams();
    if (!params) return [] as string[];
    const used = new Set(props.fields.map((f) => f.name));
    return params.map((p) => p.name).filter((n) => !used.has(n));
  });
  /** Per-field declared type — used to give the value slot's NodeEditor
   *  the right `typeName` (so inline-mode parses + the constructor
   *  picker can filter). */
  function fieldTypeName(name: string): string | undefined {
    const p = ctorParams()?.find((pp) => pp.name === name);
    return p ? typeNameOf(p.type, session) : undefined;
  }
  function addField() {
    const params = ctorParams();
    if (params) {
      const rem = remainingFieldNames();
      if (rem.length === 0) return;
      const n = rem[0]!;
      props.onChange({
        tag: props.tag,
        fields: [...props.fields, { name: n, value: { kind: "literal", value: undefined } }],
      });
      return;
    }
    let n = "value";
    let k = 1;
    while (props.fields.some((f) => f.name === n)) n = `value${++k}`;
    props.onChange({
      tag: props.tag,
      fields: [...props.fields, { name: n, value: { kind: "literal", value: undefined } }],
    });
  }
  return <ConstructFormEditorSurface fields={props.fields} picking={picking()}
    picker={() => <FunctionPicker onPick={pickCtor} onCancel={() => setPicking(false)}
      initialKind="constructor" lockKind paramType={props.expectedType} expectedScheme={props.expectedScheme} />}
    tag={() => <Show when={ctorEntry()} fallback={
      <BindingNameInput value={props.tag} onChange={setTag} placeholder="Tag (e.g. Just)" allowUppercase />
    }>
      <button type="button" class="expr-pattern__ctor-tag-btn mono"
        onClick={() => setPicking(true)} data-tooltip="Pick a constructor">
        {displayTag()} <span class="expr-pattern__ctor-swap">↻</span>
      </button>
    </Show>}
    onAdd={addField} onRemove={removeAt}
    addDisabled={!!ctorParams() && remainingFieldNames().length === 0}
    addTooltip={!ctorParams()
      ? "Add a field"
      : remainingFieldNames().length === 0
        ? "All fields are already bound"
        : remainingFieldNames().length === 1
          ? `Add field "${remainingFieldNames()[0]}"`
          : "Add the next unbound field"}
    fieldName={slot => <CtorFieldNameSelect
      value={slot.field.name}
      onChange={(next) => update(slot.index, { name: next })}
      params={ctorParams()}
      usedNames={props.fields.map((g, j) => (j === slot.index ? "" : g.name)).filter(Boolean)}
    />}
    expression={slot => <PathSegmentProvider label={`${displayTag() || "?"} . ${slot.field.name}`}>
      <NodeEditor
        node={slot.field.value}
        onChange={(next) => update(slot.index, { value: next })}
        typeName={fieldTypeName(slot.field.name)}
        fieldDef={ctorParams()?.find((param) => param.name === slot.field.name)}
        expectedScheme={fieldScheme(slot.field.name)}
        expectedOutcome={!fieldScheme(slot.field.name) && !ctorParams()?.find((param) => param.name === slot.field.name)?.type
          ? props.expectedOutcome : undefined}
        viewMode="nested"
      />
    </PathSegmentProvider>} />;
}

/** `do { … }` — sequenced statements. Each is its own NodeEditor slot.
 *  Last slot's value is the block's return value; intermediate slots
 *  are evaluated for effect. The visual keyword + numbered gutter make
 *  the sequencing obvious. */
function DoBlockEditor(props: {
  body: ExprNode[];
  expectedType?: FenelType;
  expectedScheme?: TypeScheme;
  expectedOutcome?: InferenceOutcome;
  onChange: (next: ExprNode[]) => void;
}) {
  const session = useAuthoringSession();
  const inheritedParams = useContext(LambdaParamsContext);
  function updateAt(i: number, next: ExprNode) {
    const out = props.body.slice();
    out[i] = next;
    props.onChange(out);
  }
  function removeAt(i: number) {
    const out = props.body.slice();
    out.splice(i, 1);
    props.onChange(out);
  }
  function addAfter(i: number) {
    const out = props.body.slice();
    out.splice(i + 1, 0, { kind: "literal", value: undefined });
    props.onChange(out);
  }
  const scopeAtStmt = createMemo<LambdaParam[][]>(() => {
    return authoringScopeForDoBlock(
      props.body,
      inheritedParams(),
      editorEnvironment(session),
    ) as LambdaParam[][];
  });
  return (
    <div class="expr-form expr-form--do">
      <div class="expr-form__head mono">do</div>
      <div class="expr-form__rows">
        <For each={props.body}>
          {(stmt, i) => (
            <div class="expr-form__row">
              <span class="expr-form__gutter mono">{i() + 1}</span>
              <div class="expr-form__slot">
                <LambdaParamsContext
                  value={() => expandParamPaths([
                    ...inheritedParams(),
                    ...(scopeAtStmt()[i()] ?? []),
                  ], session)}
                >
                  <PathSegmentProvider label={`do step ${i() + 1}`}>
                    <NodeEditor
                      node={stmt}
                      onChange={(next) => updateAt(i(), next)}
                      detachSuggestionContext={i() !== props.body.length - 1}
                      expectedType={i() === props.body.length - 1 ? props.expectedType : undefined}
                      expectedScheme={i() === props.body.length - 1 ? props.expectedScheme : undefined}
                      expectedOutcome={i() === props.body.length - 1 ? props.expectedOutcome : undefined}
                      typeName={undefined}
                      viewMode="nested"
                    />
                  </PathSegmentProvider>
                </LambdaParamsContext>
              </div>
              <div class="expr-form__row-actions">
                <button
                  type="button"
                  class="expr-form__btn"
                  onClick={() => addAfter(i())}
                  data-tooltip="Add statement below"
                >
                  + below
                </button>
                <Show when={props.body.length > 1}>
                  <button
                    type="button"
                    class="expr-form__btn"
                    onClick={() => removeAt(i())}
                    data-tooltip="Remove this statement"
                  >
                    ✕
                  </button>
                </Show>
              </div>
            </div>
          )}
        </For>
        <Show when={props.body.length === 0}>
          <button
            type="button"
            class="expr-form__btn"
            onClick={() => props.onChange([{ kind: "literal", value: undefined }])}
          >
            + add first statement
          </button>
        </Show>
      </div>
    </div>
  );
}

/** `let name = expr; …` — name/expr binding pairs. Each binding's
 *  expression slot is a NodeEditor; the binding name is an editable
 *  text input. The trailing slot in the Fenel `let` form is the body —
 *  represented here as the last binding (Fenel parser leaves the body
 *  as the last entry in the let-record).
 *
 *  Each binding optionally carries a declared `type` annotation. When
 *  present, the value's NodeEditor receives it as `fieldDef` so the
 *  literal sub-editor can drive typed UX (record-field picker, scalar
 *  inline editor, etc.). On serialisation the type is preserved via
 *  the engine's `ann` operator — `let x : T = expr` becomes
 *  `{let: {x: {ann: [<expr>, T]}}}` — which the evaluator strips. */
function LetBindingsEditor(props: {
  bindings: { name: string; type?: FenelType; expr: ExprNode }[];
  expectedType?: FenelType;
  expectedScheme?: TypeScheme;
  expectedOutcome?: InferenceOutcome;
  onChange: (next: { name: string; type?: FenelType; expr: ExprNode }[]) => void;
}) {
  const session = useAuthoringSession();
  /** Params inherited from the enclosing scope. Each unannotated prior
   *  binding is inferred from its own value by the shared Fenel kernel;
   *  downstream usages never manufacture a first-hit type. */
  const inheritedParams = useContext(LambdaParamsContext);

  function scopeParamsFor(i: number): LambdaParam[] {
    return authoringScopeForLetBinding(
      props.bindings,
      i,
      inheritedParams(),
      editorEnvironment(session),
    ) as LambdaParam[];
  }

  function update(i: number, patch: Partial<{ name: string; type?: FenelType; expr: ExprNode }>) {
    const out = props.bindings.slice();
    out[i] = { ...out[i]!, ...patch };
    props.onChange(out);
  }
  function setType(i: number, type: FenelType | undefined) {
    const out = props.bindings.slice();
    const next = { ...out[i]! };
    if (type === undefined) delete next.type;
    else next.type = type;
    out[i] = next;
    props.onChange(out);
  }
  function removeAt(i: number) {
    const out = props.bindings.slice();
    out.splice(i, 1);
    props.onChange(out);
  }
  function addBinding() {
    props.onChange([...props.bindings, blankLocalBinding(props.bindings)]);
  }
  return <LetBindingsFormEditorSurface bindings={props.bindings} onAdd={addBinding} onRemove={removeAt}
    bindingName={slot => <>
      <BindingNameInput value={slot.binding.name} onChange={(next) => update(slot.index, { name: next })}
        placeholder="binding name" />
      <LetTraceBadge name={slot.binding.name} />
    </>}
    expression={slot => <PathSegmentProvider label={`local ${slot.binding.name || "?"}`}>
      <LambdaParamsContext value={() => scopeParamsFor(slot.index)}>
        <NodeEditor
          node={slot.binding.expr}
          onChange={(next) => update(slot.index, { expr: next })}
          detachSuggestionContext={slot.index !== props.bindings.length - 1
            || !(props.expectedType || props.expectedScheme || props.expectedOutcome)}
          expectedType={slot.index === props.bindings.length - 1 && slot.binding.type === undefined ? props.expectedType : undefined}
          expectedScheme={slot.index === props.bindings.length - 1 && slot.binding.type === undefined ? props.expectedScheme : undefined}
          expectedOutcome={slot.index === props.bindings.length - 1 ? props.expectedOutcome
            ?? (slot.binding.type && (props.expectedType || props.expectedScheme) ? {
              $tag: "AnnotationRequired", diagnostics: [{ code: "authoring.let-result-context",
                functionId: "<authoring-let-result>", message: "This returned binding has both a declared type and a surrounding result requirement. Check the complete expression before applying a suggestion." }],
            } : undefined) : undefined}
          typeName={slot.binding.type ? typeNameOf(slot.binding.type, session) : undefined}
          fieldDef={slot.binding.type ? { name: slot.binding.name, label: Nothing, type: slot.binding.type, meta: {}, ui: Nothing } : undefined}
          declaredType={slot.binding.type}
          onDeclaredTypeChange={(type) => setType(slot.index, type)}
          requirementSource={slot.index === props.bindings.length - 1 ? "the enclosing result" : undefined}
          viewMode="nested"
        />
      </LambdaParamsContext>
    </PathSegmentProvider>} />;
}

function WhereFormEditor(props: {
  expectedType?: FenelType;
  expectedScheme?: TypeScheme;
  expectedOutcome?: InferenceOutcome;
  body: ExprNode;
  bindings: WhereBinding<ExprNode>[];
  onChange: (next: { body: ExprNode; bindings: WhereBinding<ExprNode>[] } | ExprNode) => void;
}) {
  const session = useAuthoringSession();
  const inheritedParams = useContext(LambdaParamsContext);
  // Where evaluates its bindings in source order, then its body. Reuse the
  // existing binding-scope projection for both ordinary recursive slots.
  const scopeParamsFor = (index: number) => authoringScopeForLetBinding(
    props.bindings, index, inheritedParams(), editorEnvironment(session),
  ) as LambdaParam[];
  return <WhereFormEditorSurface body={props.body} bindings={props.bindings} onChange={props.onChange}
    bindingName={slot => <BindingNameInput value={slot.binding.name} onChange={slot.onChange} placeholder="binding name" />}
    expression={slot => <PathSegmentProvider label={slot.index === undefined ? "expression" : `local ${props.bindings[slot.index]?.name || "?"}`}>
      <LambdaParamsContext value={() => scopeParamsFor(slot.index ?? props.bindings.length)}>
        <NodeEditor node={slot.value} onChange={slot.onChange} typeName={undefined}
          detachSuggestionContext={slot.index !== undefined}
          expectedType={slot.index === undefined ? props.expectedType : undefined}
          expectedScheme={slot.index === undefined ? props.expectedScheme : undefined}
          expectedOutcome={slot.index === undefined ? props.expectedOutcome : undefined}
          hideLabel={slot.index === undefined} allowLocalBindings={slot.index !== undefined} viewMode="nested" />
      </LambdaParamsContext>
    </PathSegmentProvider>} />;
}

/** `(expression : Type)`: the expression, then the type it must have. */
function AnnotationFormEditor(props: {
  expr: ExprNode;
  type: unknown;
  expectedOutcome?: InferenceOutcome;
  onChange: (next: { expr: ExprNode; type: unknown }) => void;
}) {
  const typeValue = createMemo(() => annotationTypeForEditor(props.type));
  return (
    <div class="expr-form expr-form--ann">
      <div
        class="expr-form__head mono"
        data-tooltip="Type annotation, written (expression : Type): the expression must have this type"
      >
        :
      </div>
      <div class="expr-form__rows">
        <div class="expr-form__row">
          <span class="expr-form__head mono">expr</span>
          <div class="expr-form__slot">
            <PathSegmentProvider label="annotation expression">
              <NodeEditor
                node={props.expr}
                onChange={(expr) => props.onChange({ expr, type: props.type })}
                expectedType={typeValue() ?? undefined}
                expectedOutcome={typeValue() === null ? { $tag: "AnnotationRequired", diagnostics: [{
                  code: "authoring.annotation-unavailable", functionId: "<authoring-annotation>",
                  message: "Choose a readable annotation type before applying a suggestion to this expression.",
                }] } : props.expectedOutcome}
                typeName={undefined}
                hideTypeContract
                viewMode="nested"
              />
            </PathSegmentProvider>
          </div>
        </div>
        {/* The type is this expression's declared type: the enclosing slot's
            TypeContract shows and edits it (and removes the annotation). */}
      </div>
    </div>
  );
}

function CatFormEditor(props: {
  parts: ExprNode[];
  onChange: (next: ExprNode[]) => void;
}) {
  function updateAt(i: number, next: ExprNode) {
    const out = props.parts.slice();
    out[i] = next;
    props.onChange(out);
  }
  function removeAt(i: number) {
    const out = props.parts.slice();
    out.splice(i, 1);
    props.onChange(out);
  }
  function addAfter(i: number) {
    const out = props.parts.slice();
    out.splice(i + 1, 0, { kind: "literal", value: "" });
    props.onChange(out);
  }
  return (
    <div class="expr-form expr-form--cat">
      <div class="expr-form__head mono">cat</div>
      <div class="expr-form__rows">
        <For each={props.parts}>
          {(part, i) => (
            <div class="expr-form__row">
              <span class="expr-form__gutter mono">{i() + 1}</span>
              <div class="expr-form__slot">
                <PathSegmentProvider label={`cat part ${i() + 1}`}>
                  <NodeEditor
                    node={part}
                    onChange={(next) => updateAt(i(), next)}
                    typeName={undefined}
                    viewMode="nested"
                  />
                </PathSegmentProvider>
              </div>
              <div class="expr-form__row-actions">
                <button
                  type="button"
                  class="expr-form__btn"
                  onClick={() => addAfter(i())}
                  data-tooltip="Add part below"
                >
                  + below
                </button>
                <Show when={props.parts.length > 1}>
                  <button
                    type="button"
                    class="expr-form__btn"
                    onClick={() => removeAt(i())}
                    data-tooltip="Remove this part"
                  >
                    ✕
                  </button>
                </Show>
              </div>
            </div>
          )}
        </For>
        <Show when={props.parts.length === 0}>
          <button
            type="button"
            class="expr-form__btn"
            onClick={() => props.onChange([{ kind: "literal", value: "" }])}
          >
            + add first part
          </button>
        </Show>
      </div>
    </div>
  );
}

function EvaluatorFormEditor(props: {
  expectedType?: FenelType;
  expectedScheme?: TypeScheme;
  expectedOutcome?: InferenceOutcome;
  strategy: EvaluatorStrategy;
  body: ExprNode;
  onChange: (next: { strategy: EvaluatorStrategy; body: ExprNode }) => void;
}) {
  const graphCapture = useContext(ExpressionGraphCaptureContext);
  const strategies = Object.keys(EVALUATOR_STRATEGIES) as EvaluatorStrategy[];
  return (
    <div class="expr-form expr-form--evaluator">
      <div class="expr-form__head mono">evaluator</div>
      <div class="expr-form__rows">
        <div class="expr-form__row">
          <span class="expr-form__head mono">strategy</span>
          <LocusSelect
            label="Strategy"
            value={props.strategy}
            options={locusSelectOptions(strategies)}
            minWidth="120px"
            onChange={(strategy) => props.onChange({
              strategy: strategy as EvaluatorStrategy,
              body: props.body,
            })}
          />
        </div>
        <div class="expr-form__row">
          <span class="expr-form__head mono">body</span>
          <div class="expr-form__slot">
            <ExpressionGraphCaptureContext value={{ ...graphCapture,
              activate: (active, token, node) => graphCapture.activate?.(active, token, node, false) }}>
            <PathSegmentProvider label={`${props.strategy} body`}>
              <NodeEditor
                node={props.body}
                onChange={(body) => props.onChange({ strategy: props.strategy, body })}
                expectedType={props.expectedType}
                expectedScheme={props.expectedScheme}
                expectedOutcome={props.expectedOutcome}
                typeName={undefined}
                viewMode="nested"
              />
            </PathSegmentProvider>
            </ExpressionGraphCaptureContext>
          </div>
        </div>
      </div>
    </div>
  );
}


/** `match scrutinee of pat -> body | pat -> body | …` — scrutinee
 *  expression + per-arm (pattern, body) pairs. Each arm's pattern
 *  routes through MatchPatternEditor (a separate sub-language editor
 *  for ADT / record / bind / wildcard / guard patterns); each body
 *  is a full NodeEditor instance, so the call/inline/ref/param tab
 *  UX nests inside arm bodies. */
function MatchFormEditor(props: {
  expectedType?: FenelType;
  expectedScheme?: TypeScheme;
  expectedOutcome?: InferenceOutcome;
  scrutinee: ExprNode;
  arms: { pattern: unknown; body: ExprNode }[];
  onChange: (next: { scrutinee: ExprNode; arms: { pattern: unknown; body: ExprNode }[] }) => void;
}) {
  const session = useAuthoringSession();
  // Build a `paramTypes` map from the in-scope lambda params (the same
  // context the param-picker uses). The shared inference bridge uses it to type
  // `{var: <name>}` scrutinees against their declared lambda type.
  const lambdaParams = useContext(LambdaParamsContext);
  const savedCtx = useContext(SavedValuesContext);
  const inferCtx = createMemo<ExpressionInferenceUiContext>(() => {
    const pt: Record<string, FenelType | TypeScheme> = {};
    for (const p of lambdaParams()) pt[p.name] = p.scheme ?? p.type;
    return {
      bindings: pt,
      resolver: savedCtx ? (id) => savedCtx.byId(id)?.expr : undefined,
    };
  });
  // The scrutinee's inferred type — threads down into per-arm pattern
  // editors so the constructor picker can filter to constructors of
  // this ADT only. Returns undefined when inference can't tell, in
  // which case downstream pickers fall back to showing everything.
  const scrutineeInference = createMemo(() =>
    inferExpression(props.scrutinee, inferCtx(), session)
  );
  const scrutineeType = createMemo(() => scrutineeInference().type);
  const scrutineeScheme = createMemo(() =>
    scrutineeInference().scheme ?? scrutineeInference().type
  );

  function setScrutinee(next: ExprNode) {
    props.onChange({ scrutinee: next, arms: props.arms });
  }
  function updateArm(i: number, patch: Partial<{ pattern: unknown; body: ExprNode }>) {
    const out = props.arms.slice();
    out[i] = { ...out[i]!, ...patch };
    props.onChange({ scrutinee: props.scrutinee, arms: out });
  }
  function removeArm(i: number) {
    const out = props.arms.slice();
    out.splice(i, 1);
    props.onChange({ scrutinee: props.scrutinee, arms: out });
  }
  function addArmAfter(i: number) {
    const out = props.arms.slice();
    out.splice(i + 1, 0, { pattern: "_", body: { kind: "literal", value: undefined } });
    props.onChange({ scrutinee: props.scrutinee, arms: out });
  }
  return <MatchFormEditorSurface arms={props.arms} onAddAfter={addArmAfter} onRemove={removeArm}
    scrutinee={() => <PathSegmentProvider label="match scrutinee">
      <NodeEditor node={props.scrutinee} onChange={setScrutinee} typeName={undefined} viewMode="nested" />
    </PathSegmentProvider>}
    pattern={slot => <PathSegmentProvider label={`arm ${slot.index + 1} pattern`}>
      <MatchPatternEditor value={slot.arm.pattern} onChange={(next) => updateArm(slot.index, { pattern: next })}
        scrutineeType={scrutineeType()} />
    </PathSegmentProvider>}
    body={slot => <PathSegmentProvider label={`arm ${slot.index + 1} body`}>
      {/* Pattern bindings join the existing lexical environment for this arm. */}
      <LambdaParamsContext value={() => expandParamPaths([
        ...lambdaParams(),
        ...patternBindingsForArm(slot.arm.pattern, scrutineeScheme(), session),
      ], session)}>
        <NodeEditor
          node={slot.arm.body}
          onChange={(next) => updateArm(slot.index, { body: next })}
          expectedType={props.expectedType}
          expectedScheme={props.expectedScheme}
          expectedOutcome={props.expectedOutcome}
          typeName={undefined}
          viewMode="nested"
        />
      </LambdaParamsContext>
    </PathSegmentProvider>} />;
}

// ---------------------------------------------------------------------------
// Match-arm pattern editor
//
// Patterns are a *separate sub-language* from expressions — they sit on
// the left of `->` in case arms and have their own JSON-Logic shapes:
//
//   "_"                                    wildcard (matches anything)
//   {$bind: "name"}                        binds the scrutinee to `name`
//   42 / "s" / true                        literal (matches by equality)
//   {$tag: "Just", _0: <pat>, …}        ADT constructor + field binds
//   {field1: <pat>, field2: <pat>, …}      plain-record structural match
//   {$guard: [<pat>, <Boolean expr>]}      pattern with a boolean gate
//
// MatchPatternEditor exposes a mode toggle (wild / bind / literal / ctor /
// record / guard) and renders the right sub-editor for each. Constructor
// and record fields are themselves patterns, so the editor recurses.
// ---------------------------------------------------------------------------

type PatternMode = AlgebraicPatternMode;
const PATTERN_MODES = ALGEBRAIC_PATTERN_MODES;

function MatchPatternEditor(props: {
  value: unknown;
  onChange: (next: unknown) => void;
  /** Type of the value being matched against. Threaded down to the
   *  constructor picker so it can filter to constructors of this ADT
   *  only. Undefined when inference can't tell — picker falls back to
   *  the full constructor list. */
  scrutineeType?: FenelType;
}) {
  const suggestionCheck = useContext(SuggestionCheckContext);
  const suggestionDraft = useContext(SuggestionDraftContext);
  const params = useContext(LambdaParamsContext);
  const recordValues = useContext(RecordValuesContext);
  const saved = useContext(SavedValuesContext);
  const resultBinding = useContext(ResultBindingContext);
  const scopeCapture = useContext(ExpressionGraphScopeCaptureContext);
  // Same depth-collapse as NodeEditor — once a pattern is nested past
  // the limit, render a stub and open the same editor inside a modal.
  const pathCtx = useContext(EditorPathContext);
  if (pathCtx.depth >= NODE_DEPTH_LIMIT && pathCtx.openModal && untrack(() => pathCtx.fold?.())) {
    const fullPath = pathCtx.path;
    const openModal = pathCtx.openModal;
    return (
      <CollapseStub
        summary={summarizePattern(props.value)}
        onExpand={() => openModal(fullPath, () =>
          <SuggestionCheckContext value={suggestionCheck}>
            <SuggestionDraftContext value={suggestionDraft}>
              <LambdaParamsContext value={params}>
                <RecordValuesContext value={recordValues}>
                  <SavedValuesContext value={saved}>
                    <ResultBindingContext value={resultBinding}>
                      <ExpressionGraphScopeCaptureContext value={scopeCapture}>
                        <MatchPatternEditor {...props} />
                      </ExpressionGraphScopeCaptureContext>
                    </ResultBindingContext>
                  </SavedValuesContext>
                </RecordValuesContext>
              </LambdaParamsContext>
            </SuggestionDraftContext>
          </SuggestionCheckContext>)}
      />
    );
  }
  const mode = createMemo(() => patternModeCore(props.value));

  function setMode(next: PatternMode) {
    if (next === mode()) return;
    props.onChange(defaultPatternForMode(next));
  }

  return (
    <div class="expr-pattern">
      <div class="expr-pattern__modes">
        <For each={PATTERN_MODES}>
          {(m) => (
            <button
              type="button"
              class={{
                "expr-pattern__mode": true,
                active: mode() === m.mode,
              }}
              onClick={() => setMode(m.mode)}
              data-tooltip={m.hint}
            >
              {m.label}
            </button>
          )}
        </For>
      </div>
      <div class="expr-pattern__body">
        <Switch>
          <Match when={mode() === "wildcard"}>
            <span class="text-muted mono" style="font-size: 0.78rem">matches anything</span>
          </Match>
          <Match when={mode() === "bind"}>
            <PatternBindEditor
              value={props.value}
              onChange={props.onChange}
            />
          </Match>
          <Match when={mode() === "literal"}>
            <PatternLiteralEditor
              value={props.value}
              onChange={props.onChange}
            />
          </Match>
          <Match when={mode() === "ctor"}>
            <PatternCtorEditor
              value={props.value}
              onChange={props.onChange}
              scrutineeType={props.scrutineeType}
            />
          </Match>
          <Match when={mode() === "record"}>
            <PatternRecordEditor
              value={props.value}
              onChange={props.onChange}
            />
          </Match>
          <Match when={mode() === "guard"}>
            <PatternGuardEditor
              value={props.value}
              onChange={props.onChange}
              scrutineeType={props.scrutineeType}
            />
          </Match>
        </Switch>
      </div>
    </div>
  );
}

function PatternBindEditor(props: {
  value: unknown;
  onChange: (next: unknown) => void;
}) {
  const name = createMemo(() => {
    const v = props.value as { $bind?: unknown };
    return typeof v?.$bind === "string" ? v.$bind : "x";
  });
  return (
    <BindingNameInput
      value={name()}
      onChange={(n) => props.onChange({ $bind: n })}
      placeholder="binding name"
    />
  );
}

function PatternLiteralEditor(props: {
  value: unknown;
  onChange: (next: unknown) => void;
}) {
  // Use ScalarLiteralInput for typed entry, defaulting to string. Pattern
  // literals can be string / number / boolean. Legacy null data remains
  // inspectable, but is not offered as a new Fenel pattern.
  const kind = createMemo<"string" | "number" | "boolean" | "">(() => {
    const v = props.value;
    if (typeof v === "string") return "string";
    if (typeof v === "number") return "number";
    if (typeof v === "boolean") return "boolean";
    return "";
  });
  function setKind(next: "string" | "number" | "boolean") {
    if (next === "string") props.onChange("");
    else if (next === "number") props.onChange(0);
    else if (next === "boolean") props.onChange(false);
  }
  const typeName = () => (kind() === "number" ? "Number" : kind() === "boolean" ? "Boolean" : kind() === "string" ? "String" : undefined);
  return (
    <div style="display: flex; gap: 0.4rem; align-items: center">
      <LocusSelect
        label="Literal kind"
        value={kind()}
        options={locusSelectOptions(["string", "number", "boolean"])}
        fallbackOption={{ value: "", label: "Choose kind" }}
        minWidth="120px"
        onChange={(next) => setKind(next as never)}
      />
      <Show when={kind() !== ""}>
        <ScalarLiteralInput
          value={props.value}
          typeName={typeName()}
          onChange={(v) => props.onChange(v)}
        />
      </Show>
    </div>
  );
}

/** `{$tag: "Just", _0: <pat>, …}` — ADT constructor pattern. A picked
 *  constructor keeps its exact target id while field bindings remain name →
 *  sub-pattern pairs recursively edited through MatchPatternEditor. */
function PatternCtorEditor(props: {
  value: unknown;
  onChange: (next: unknown) => void;
  /** Type of the scrutinee — used to filter the constructor picker so
   *  only constructors of this ADT are offered. The FN_INDEX entry for
   *  each constructor declares `returns: { $ref: <entityName> }`, so
   *  passing `scrutineeType` as the picker's `paramType` lets its
   *  built-in return-type filter do the work. */
  scrutineeType?: FenelType;
}) {
  const session = useAuthoringSession();
  const pickerNameCounts = constructorPickerNameCounts(
    projectFunctionPickerIndex(session, editorCatalog(session).functions),
  );
  const obj = createMemo(() => (props.value as Record<string, unknown>) ?? {});
  const tag = createMemo(() => String(obj().$tag ?? ""));
  const fields = createMemo(() => {
    return Object.entries(obj()).filter(([k]) => k !== "$tag") as [string, unknown][];
  });
  const [picking, setPicking] = createSignal(false);
  const tagDisplay = createMemo(() => {
    const selectedTag = tag();
    const entry = authoringFunctionEntry(session, selectedTag);
    return entry?.kind === "constructor"
      ? functionPickerDisplayName({
          ...entry,
          codeName: entry.codeName ?? entry.id,
          id: entry.targetId ?? selectedTag,
        }, pickerNameCounts)
      : fnCodeName(selectedTag);
  });

  /** Declared fields of the picked constructor — the source of truth
   *  for which field names are valid. Three paths, in order:
   *    1. The scrutinee's type, peeled to its `$variant` cases, then
   *       matching `tag()` to one of them. Strongest signal because
   *       it doesn't rely on the global FN_INDEX having loaded this
   *       ADT at module-init time.
   *    2. The environment's exact signature resolver — the cached registry
   *       snapshot from module init, with constructor-owner disambiguation.
   *    3. Live catalog walk — covers entities (especially user
   *       modules) registered AFTER FN_INDEX was built. Without this,
   *       a user-defined `Either<E, A> = Left … | Right …` that
   *       loaded with the function being edited would silently fall
   *       to free-form input even though its cases are in the
   *       catalog right now.
   *  `undefined` ⇒ unknown tag ⇒ fall back to free-form entry. */
  const ctorParams = createMemo(() => {
    return constructorFieldsForTag(tag(), {
      ...editorEnvironment(session),
      scrutineeType: props.scrutineeType,
    });
  });

  /** Param names not yet bound to any field row — what "+ field" can add
   *  and what the field-name select offers as alternatives. */
  const remainingFieldNames = createMemo(() => {
    const params = ctorParams();
    if (!params) return [] as string[];
    const used = new Set(fields().map(([k]) => k));
    return params.map((p) => p.name).filter((n) => !used.has(n));
  });

  /** Pick a constructor from the registry and rewrite the pattern to
   *  match its shape: tag set to the constructor's name, fields seeded
   *  with `{$bind: <fieldName>}` (the Fenel shorthand `Just { value }`
   *  expands to `Just { value = $bind value }`). For nullary
   *  constructors like `Nothing`, no fields are added. The user can
   *  still rename / remove / edit field patterns after picking. */
  function pickCtor(fnId: string) {
    const entry = authoringFunctionEntry(session, fnId);
    if (!entry || entry.kind !== "constructor") {
      setPicking(false);
      return;
    }
    // The source spelling can be shared by constructors from different
    // semantic owners. Keep the exact target selected by FunctionPicker in
    // authoring state; `toLogic` projects it back to the runtime source tag.
    const next: Record<string, unknown> = {
      $tag: entry.targetId ?? fnId,
    };
    for (const p of entry.params) {
      next[p.name] = { $bind: p.name };
    }
    props.onChange(next);
    setPicking(false);
  }
  function setFieldName(i: number, nextName: string) {
    const fs = fields();
    const [, val] = fs[i]!;
    const rebuilt: Record<string, unknown> = { $tag: tag() };
    fs.forEach(([k, v], j) => {
      rebuilt[j === i ? nextName : k] = j === i ? val : v;
    });
    props.onChange(rebuilt);
  }
  function setFieldValue(i: number, nextVal: unknown) {
    const fs = fields();
    const rebuilt: Record<string, unknown> = { $tag: tag() };
    fs.forEach(([k, v], j) => {
      rebuilt[k] = j === i ? nextVal : v;
    });
    props.onChange(rebuilt);
  }
  function removeField(i: number) {
    const fs = fields();
    const rebuilt: Record<string, unknown> = { $tag: tag() };
    fs.forEach(([k, v], j) => {
      if (j !== i) rebuilt[k] = v;
    });
    props.onChange(rebuilt);
  }
  function addField() {
    const params = ctorParams();
    // With a known constructor: append the first unbound declared
    // param. Button is disabled when nothing remains, so this is
    // safe.
    if (params) {
      const remaining = remainingFieldNames();
      if (remaining.length === 0) return;
      const n = remaining[0]!;
      props.onChange({ ...obj(), [n]: { $bind: n } });
      return;
    }
    // Fallback: no registered ctor yet (user editing the tag) — keep
    // the old `value` / `value2` placeholder behavior so the row is
    // still addable.
    let n = "value";
    let k = 1;
    while (fields().some(([fn]) => fn === n)) n = `value${++k}`;
    props.onChange({ ...obj(), [n]: { $bind: n } });
  }
  return (
    <div class="expr-pattern__ctor">
      <Show
        when={!picking()}
        fallback={
          <FunctionPicker
            onPick={pickCtor}
            onCancel={() => setPicking(false)}
            initialKind="constructor"
            lockKind
            paramType={props.scrutineeType}
            paramTypeName={props.scrutineeType ? typeNameOf(props.scrutineeType, session) : undefined}
          />
        }
      >
        <div class="expr-pattern__ctor-head">
          <button
            type="button"
            class="expr-pattern__ctor-tag-btn mono"
            onClick={() => setPicking(true)}
            data-tooltip="Pick a constructor"
          >
            <Show when={tag()} fallback={<span class="text-muted">(pick constructor)</span>}>
              {tagDisplay()}
            </Show>
            <span class="expr-pattern__ctor-swap">↻</span>
          </button>
          <button
            type="button"
            class="expr-form__btn"
            onClick={addField}
            disabled={!!ctorParams() && remainingFieldNames().length === 0}
            data-tooltip={
              !ctorParams()
                ? "Add a field"
                : remainingFieldNames().length === 0
                  ? "All fields are already bound"
                  : remainingFieldNames().length === 1
                    ? `Add field "${remainingFieldNames()[0]}"`
                    : "Add the next unbound field"
            }
          >+ field</button>
        </div>
        <Show when={fields().length > 0}>
          <div class="expr-pattern__ctor-fields">
            <For each={fields()}>
              {([k, v], i) => {
                // Each constructor field has its own declared type
                // (e.g. `Just :: a -> Maybe<a>` → field `value` is
                // type `a`). Look it up in the catalog so the nested
                // pattern's constructor picker can narrow to that
                // field's ADT. Falls back to undefined for unknown
                // tags / fields — picker shows all constructors.
                const fieldType = (): FenelType | undefined => {
                  const ctor = authoringFunctionEntry(session, tag());
                  if (!ctor || ctor.kind !== "constructor") return undefined;
                  const p = ctor.params.find((pp) => pp.name === k);
                  return p?.type;
                };
                return (
                  <div class="expr-pattern__ctor-field">
                    <CtorFieldNameSelect
                      value={k}
                      onChange={(next) => setFieldName(i(), next)}
                      params={ctorParams()}
                      usedNames={fields()
                        .map(([fn]) => fn)
                        .filter((fn) => fn !== k)}
                    />
                    <span class="expr-form__eq mono">=</span>
                    <div class="expr-form__slot">
                      <PathSegmentProvider label={`${tag() || "?"} . ${k}`}>
                        <MatchPatternEditor
                          value={v}
                          onChange={(next) => setFieldValue(i(), next)}
                          scrutineeType={fieldType()}
                        />
                      </PathSegmentProvider>
                    </div>
                    <button
                      type="button"
                      class="expr-form__btn"
                      onClick={() => removeField(i())}
                      data-tooltip="Remove field"
                    >
                      ✕
                    </button>
                  </div>
                );
              }}
            </For>
          </div>
        </Show>
      </Show>
    </div>
  );
}

/** `{field1: <pat>, field2: <pat>, …}` — plain-record structural match.
 *  Same UX as PatternCtorEditor minus the tag — each row is a field
 *  name + sub-pattern. */
function PatternRecordEditor(props: {
  value: unknown;
  onChange: (next: unknown) => void;
}) {
  const obj = createMemo(() => (props.value as Record<string, unknown>) ?? {});
  const fields = createMemo(() => Object.entries(obj()) as [string, unknown][]);
  function setFieldName(i: number, nextName: string) {
    const fs = fields();
    const rebuilt: Record<string, unknown> = {};
    fs.forEach(([k, v], j) => {
      rebuilt[j === i ? nextName : k] = v;
    });
    props.onChange(rebuilt);
  }
  function setFieldValue(i: number, nextVal: unknown) {
    const fs = fields();
    const rebuilt: Record<string, unknown> = {};
    fs.forEach(([k, v], j) => {
      rebuilt[k] = j === i ? nextVal : v;
    });
    props.onChange(rebuilt);
  }
  function removeField(i: number) {
    const fs = fields();
    const rebuilt: Record<string, unknown> = {};
    fs.forEach(([k, v], j) => {
      if (j !== i) rebuilt[k] = v;
    });
    props.onChange(rebuilt);
  }
  function addField() {
    let n = "field";
    let k = 1;
    while (fields().some(([fn]) => fn === n)) n = `field${++k}`;
    props.onChange({ ...obj(), [n]: { $bind: n } });
  }
  return (
    <div class="expr-pattern__ctor">
      <div class="expr-pattern__ctor-head">
        <span class="text-muted mono" style="font-size: 0.78rem">record</span>
        <button type="button" class="expr-form__btn" onClick={addField}>+ field</button>
      </div>
      <Show when={fields().length > 0}>
        <div class="expr-pattern__ctor-fields">
          <For each={fields()}>
            {([k, v], i) => (
              <div class="expr-pattern__ctor-field">
                <BindingNameInput
                  value={k}
                  onChange={(next) => setFieldName(i(), next)}
                  placeholder="field"
                  role="field"
                />
                <span class="expr-form__eq mono">=</span>
                <div class="expr-form__slot">
                  <PathSegmentProvider label={`record.${k}`}>
                    <MatchPatternEditor
                      value={v}
                      onChange={(next) => setFieldValue(i(), next)}
                    />
                  </PathSegmentProvider>
                </div>
                <button
                  type="button"
                  class="expr-form__btn"
                  onClick={() => removeField(i())}
                  data-tooltip="Remove field"
                >
                  ✕
                </button>
              </div>
            )}
          </For>
        </div>
      </Show>
    </div>
  );
}

/** `{$guard: [<inner pat>, <Boolean expr>]}` — pattern with a boolean
 *  predicate. Inner pattern routes back through MatchPatternEditor; the
 *  predicate is a Boolean ExprNode edited via NodeEditor. The predicate's
 *  scope sees any binds made by the inner pattern. */
function PatternGuardEditor(props: {
  value: unknown;
  onChange: (next: unknown) => void;
  /** Forwarded to the inner pattern so constructor filtering still
   *  applies — a guard wraps a pattern + boolean condition, but the
   *  pattern's scrutinee type is unchanged. */
  scrutineeType?: FenelType;
}) {
  const pair = createMemo(() => {
    const v = props.value as { $guard?: unknown };
    return Array.isArray(v?.$guard) ? v.$guard : ["_", { kind: "literal", value: true }];
  });
  const innerPat = () => pair()[0];
  const cond = createMemo<ExprNode>(() => {
    const c = pair()[1];
    if (c && typeof c === "object" && "kind" in (c as object)) return c as ExprNode;
    return { kind: "literal", value: true };
  });
  function setInner(next: unknown) {
    props.onChange({ $guard: [next, pair()[1]] });
  }
  function setCond(next: ExprNode) {
    props.onChange({ $guard: [pair()[0], next] });
  }
  return (
    <div class="expr-pattern__guard">
      <div class="expr-form__row">
        <span class="expr-form__head mono">pat</span>
        <div class="expr-form__slot">
          <PathSegmentProvider label="guard pattern">
            <MatchPatternEditor value={innerPat()} onChange={setInner} scrutineeType={props.scrutineeType} />
          </PathSegmentProvider>
        </div>
      </div>
      <div class="expr-form__row">
        <span class="expr-form__head mono">if</span>
        <div class="expr-form__slot">
          <PathSegmentProvider label="guard condition">
            <NodeEditor
              node={cond()}
              onChange={setCond}
              typeName="Boolean"
              viewMode="nested"
            />
          </PathSegmentProvider>
        </div>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// BindingNameInput — text input for Fenel identifiers (let-bindings,
// lambda params, pattern binds, ADT tag names). Validates locally:
//   - non-empty
//   - first char must be letter / underscore (or uppercase if allowed)
//   - rest letters / digits / underscores
//   - reserved keywords blocked (`using` only for a binding, not a field)
// Shows a red border + tooltip when invalid; the value is still passed
// through onChange so the user isn't blocked while typing. The rules live in
// `binding-name.ts`.
// ---------------------------------------------------------------------------

function BindingNameInput(props: {
  value: string;
  onChange: (next: string) => void | boolean;
  placeholder?: string;
  /** ADT tag names and type names start with uppercase; binding / let
   *  / param names start with lowercase. Tags / types should pass
   *  `allowUppercase`. */
  allowUppercase?: boolean;
  /** Names already in use in the surrounding scope (other record
   *  fields, other let-bindings, etc.). The current row's own name
   *  must NOT be in this list — callers filter it out. */
  usedNames?: readonly string[];
  /** A record field name (`field`) or a bound name (`binding`, the
   *  default): a field may be named `using`, a binding may not. */
  role?: NameRole;
}) {
  const error = createMemo(() =>
    validateBindingName(props.value, {
      allowUppercase: props.allowUppercase,
      usedNames: props.usedNames,
      role: props.role,
    }),
  );
  return (
    <input

      class={["expr-form__name mono", { "expr-form__name--invalid": !!(error() !== null) }]}
      value={props.value}
      placeholder={props.placeholder ?? "name"}
      onInput={(e) => {
        if (props.onChange(e.currentTarget.value) === false) e.currentTarget.value = props.value;
      }}
      data-tooltip={error() ?? "Valid identifier"}
    />
  );
}

/** Field-name picker for constructor patterns. The valid set is the
 *  picked constructor's declared params — free-form text is the wrong
 *  affordance here, so we render a `LocusSelect` of available names. The
 *  current row's name stays selectable; names already bound by sibling
 *  rows are excluded so the user can't create a duplicate by hand.
 *
 *  When no constructor is in scope yet (tag isn't a registered ctor —
 *  e.g. transient state after a manual edit), we fall back to the
 *  free-form `BindingNameInput` so the row stays editable. */
function CtorFieldNameSelect(props: {
  value: string;
  onChange: (next: string) => void;
  /** Declared params of the picked constructor. Undefined ⇒ unknown
   *  ctor ⇒ fall back to free-form entry. */
  params: FieldDef[] | undefined;
  /** Field names already used by *other* rows in this pattern. */
  usedNames: readonly string[];
}) {
  const options = createMemo<string[]>(() => {
    if (!props.params) return [];
    const used = new Set(props.usedNames);
    const out = props.params
      .map((p) => p.name)
      .filter((n) => !used.has(n));
    // Surface the current value even if it's not a declared param
    // (legacy pattern, ctor renamed) — otherwise the select would
    // render blank and the user couldn't see what they had.
    if (!out.includes(props.value)) out.unshift(props.value);
    return out;
  });
  const isInvalid = createMemo(() =>
    !!props.params && !props.params.some((p) => p.name === props.value),
  );
  return (
    <Show
      when={props.params}
      fallback={
        <BindingNameInput
          value={props.value}
          onChange={props.onChange}
          placeholder="field"
          usedNames={props.usedNames}
          role="field"
        />
      }
    >
      <LocusSelect
        class={isInvalid() ? "mono expr-form__name--invalid" : "mono"}
        label="Field"
        value={props.value}
        options={locusSelectOptions(options())}
        minWidth="7rem"
        onChange={props.onChange}
        tooltip={
          isInvalid()
            ? `"${props.value}" is not a field of this constructor`
            : options().length === 1
              ? "Only one field available"
              : "Pick a field"
        }
        disabled={options().length <= 1}
      />
    </Show>
  );
}

/** Mini-card surfaced inline for $pin literal values. The pin itself
 *  is a typed reference — its underlying definition lives elsewhere
 *  (a function row, a type row, …) — so the editor shows what's
 *  pinned (label + signature) and links out to the surface that owns
 *  the edit (e.g. /app/functions/<name>). All Fenel functions are
 *  equal regardless of provenance, so no "user-function" badge. */
function PinLiteralDisplay(props: {
  pin: { kind: string; name: string; id: string };
}) {
  const session = useAuthoringSession();
  const reader = useReaderRuntime();
  const fn = createMemo(() => {
    if (props.pin.kind !== "function") return null;
    const idOrName = props.pin.id || props.pin.name;
    // B4 F2: a Local reader's function comes from its worker's reference.
    if (localStructure(session)) return (reader?.kind === "local" ? reader.catalogLookups.fn(idOrName) as FenelFunction | undefined : undefined) ?? null;
    return session.registry.getFunction(idOrName) ?? null;
  });

  const isType = () =>
    props.pin.kind === "type" || props.pin.kind === "entity";

  const labelText = createMemo(() => {
    if (reader) {
      const presentation = reader.presentation(fn()?.id ?? (props.pin.id || props.pin.name));
      const label = presentation?.label ?? presentation?.codeName;
      return label ? canonical(label) : props.pin.name || props.pin.id;
    }
    if (fn()) {
      const raw = displayLabel(fn()!.id) ?? getCodeName(fn()!.id);
      return raw ? canonical(raw as LocaleString) : props.pin.name;
    }
    if (isType()) {
      const raw = getLabel(props.pin.name);
      return raw ? canonical(raw as LocaleString) : props.pin.name;
    }
    return props.pin.name || props.pin.id;
  });

  const signature = createMemo(() => {
    const f = fn();
    if (!f) return null;
    const params = (f.params ?? [])
      .map((p) => `${p.name}: ${displayTypeLabel(p.type)}`)
      .join(", ");
    const ret = displayTypeLabel(f.returns);
    return `(${params}) → ${ret}`;
  });

  return (
    <div class="expr-literal__pin">
      <div class="expr-literal__pin-head">
        <span class="expr-literal__pin-name">{labelText()}</span>
        {/* The "Edit definition →" link that lived here pointed at
          *  `/app/functions/:name` / `/app/types/:name` — full pages
          *  outside the modal. That made the modal feel like a preview
          *  with the real editor "elsewhere". Today the modal IS the
          *  editor (signature + body + traces, all inline), so the
          *  out-of-modal portal is wrong. If a card-style pin display
          *  is ever needed in a non-edit context, surface the link
          *  there explicitly — don't put it here. */}
      </div>
      <Show when={signature()}>
        <div class="expr-literal__pin-sig mono">{signature()}</div>
      </Show>
    </div>
  );
}

function RefEditor(props: {
  node: { kind: "ref"; savedExprId: string };
  onConvertToLiteral: () => void;
  onSwitchRef: () => void;
}) {
  const savedCtx = useContext(SavedValuesContext);
  const target = createMemo(() => savedCtx?.byId(props.node.savedExprId));

  return <ExpressionReferenceSurface glyph="→" name={target()?.name ?? `(missing: ${props.node.savedExprId})`}
    tooltip={`Reference to saved value ${props.node.savedExprId}`} swapTooltip="Pick a different saved value"
    convertTooltip="Replace this reference with a literal value"
    onSwap={props.onSwitchRef} onConvertToLiteral={props.onConvertToLiteral} />;
}

/** FunctionRefEditor — the pill for a typed function reference
 *  (`{kind:"literal", value:{$ref:id}}`, the P4 producer's output). Mirrors
 *  RefEditor's saved-value pill but resolves the display code-name from the
 *  editor's exact environment resolver — the `Codeable` projection over
 *  the id. A ƒ glyph marks it as a function value. An unknown id degrades to
 *  `(missing: …)` (mirrors RefEditor) rather than crashing. Swap re-opens the
 *  FunctionPicker; "✕ ref" converts back to an inline literal. */
function FunctionRefEditor(props: {
  fnId: string;
  onConvertToLiteral: () => void;
  onSwitchRef: () => void;
}) {
  const session = useAuthoringSession();
  const entry = createMemo(() => authoringFunctionEntry(session, props.fnId));
  const name = createMemo(() => {
    const e = entry();
    return e ? functionPickerDisplayName(e) : `(missing: ${fnCodeName(props.fnId)})`;
  });
  return <ExpressionReferenceSurface glyph="ƒ" name={name()}
    detail={entry() ? sigShort(entry()!, session) : undefined} tooltip={`Function reference ${name()}`}
    swapTooltip="Pick a different function" convertTooltip="Replace this function reference with a literal value"
    onSwap={props.onSwitchRef} onConvertToLiteral={props.onConvertToLiteral} />;
}

/** Type-as-value references keep their wire identity; their caption is the
 * current reader's ordinary Labelable/type presentation, including on reopen. */
function TypeRefEditor(props: {
  handle: string;
  onConvertToLiteral: () => void;
  onSwitchRef: () => void;
}) {
  const session = useAuthoringSession();
  const reader = useReaderRuntime();
  const name = () => localStructure(session)
    ? valueCardTypeLabel(editorTypePhrase({ $ref: props.handle }, session, reader, false)) ?? props.handle
    : valueCardTypeLabel(typedReadTypeLabel({ $ref: props.handle }, session, reader)) ?? props.handle;
  return <ExpressionReferenceSurface glyph="τ" name={name()} detail="type"
    tooltip={`Type reference ${name()}`} swapTooltip="Pick a different type"
    convertTooltip="Replace this type reference with a literal value"
    onSwap={props.onSwitchRef} onConvertToLiteral={props.onConvertToLiteral} />;
}

/** ParamRefDisplay — same shape as RefEditor but for lambda-param refs.
 *  Shows the param's name as a pill (with a λ glyph) plus swap/clear
 *  buttons. The param's type comes from LambdaParamsContext, looked up
 *  by name. */
function ParamRefDisplay(props: {
  node: { kind: "param"; name: string };
  onConvertToLiteral: () => void;
  onSwitchParam: () => void;
}) {
  const params = useContext(LambdaParamsContext);
  const target = createMemo(() => params().find((p) => p.name === props.node.name));

  return <ExpressionReferenceSurface glyph="λ" name={props.node.name}
    detail={target() ? target()!.scheme?.quantified.length ? typeCode(target()!.scheme!.body) : displayTypeLabel(target()!.type) : "(out of scope)"}
    tooltip={`Lambda param ${props.node.name}`} swapTooltip="Pick a different param" convertKind="param"
    convertTooltip="Replace this reference with a literal value"
    onSwap={props.onSwitchParam} onConvertToLiteral={props.onConvertToLiteral} />;
}

function ExamplePicker(props: {
  examples: unknown[];
  value: unknown;
  onChange: (v: unknown) => void;
  /** When true, the picker is shown alongside ScalarLiteralInput as a
   *  "load a preset" affordance — values typed in the input often won't
   *  match any preset, so we show a "presets…" placeholder rather than
   *  pretending the first example is selected. */
  asPresets?: boolean;
}) {
  const matchIdx = createMemo(() => props.examples.findIndex((e) => sameValue(e, props.value)));
  const selectedValue = () => {
    const j = matchIdx();
    if (j >= 0) return String(j);
    return props.asPresets ? "" : "0";
  };

  return (
    <LocusSelect
      label={props.asPresets ? "Presets" : "Examples"}
      value={selectedValue()}
      // "presets…" labels the trigger while the typed value matches no
      // preset; like the native placeholder option, it picks nothing.
      fallbackOption={props.asPresets ? { value: "", label: "presets…" } : undefined}
      options={props.examples.map((ex, i) => ({ value: String(i), label: shortLabel(ex, i) }))}
      minWidth="120px"
      onChange={(raw) => {
        if (raw === "") return;
        const i = Number(raw);
        const v = props.examples[i];
        if (v !== undefined) props.onChange(v);
      }}
    />
  );
}

function ScalarLiteralInput(props: {
  value: unknown;
  typeName: string | undefined;
  onChange: (v: unknown) => void;
}) {
  // Pick the editor kind from typeName first, then from the value's
  // runtime type. Booleans are intentionally absent — Boolean values
  // live in Call mode (as `True`/`False` constructors), never in
  // Inline, so this component never gets called with a Boolean type
  // or value through the normal flow. The `typeof number` fallback
  // covers untyped numeric record-literal fields.
  const inferred = () => {
    if (props.typeName === "Number" || props.typeName === "Int" || props.typeName === "Nat") return "number";
    if (props.typeName === "String") return "string";
    if (typeof props.value === "number") return "number";
    return "string";
  };

  return (
    <input
      class="expr-literal__input"
      type={inferred() === "number" ? "number" : "text"}
      value={props.value === null || props.value === undefined ? "" : String(props.value)}
      onInput={(e) => {
        const raw = e.currentTarget.value;
        if (inferred() === "number") {
          const n = Number(raw);
          props.onChange(Number.isFinite(n) ? n : 0);
        } else {
          props.onChange(raw);
        }
      }}
    />
  );
}

type UsePickerTab = "functions" | "params" | "saved" | "types";

/** The picker's one search order (callable-names.ts), with this catalogue's
 * qualified spellings. The held picker uses the same order. */
function functionSearchRank(
  fn: FnEntry,
  query: string,
  constructorNameCounts: ReadonlyMap<string, number>,
  qualifiedNames: ReadonlyMap<string, readonly string[]>,
): number {
  return sharedFunctionSearchRank(fn, query, constructorNameCounts, qualifiedNames.get(fn.targetId ?? fn.id));
}

function compareFunctionSearch(
  a: FnEntry,
  b: FnEntry,
  query: string,
  constructorNameCounts: ReadonlyMap<string, number>,
  qualifiedNames: ReadonlyMap<string, readonly string[]>,
): number {
  return sharedCompareFunctionSearch(a, b, query, constructorNameCounts, fn => qualifiedNames.get(fn.targetId ?? fn.id) ?? []);
}

function UsePicker(props: {
  onPickFunction: (fnId: string) => void;
  onPickLocalFunction?: (param: LambdaParam) => void;
  onPickTypeRef: (selection: TypePickerSelection) => void;
  captureTypeTarget: CaptureTypePickerTarget;
  onPickFunctionRef: (fnId: string) => void;
  onPickSaved: (savedExprId: string) => void;
  onPickParam: (name: string) => void;
  onCancel?: () => void;
  fieldType?: FenelType;
  expectedScheme?: TypeScheme;
  typeName?: string;
  isTypeField: boolean;
  isArrowField: boolean;
  showParams?: boolean;
  requirementSource?: string;
}) {
  const savedCtx = useContext(SavedValuesContext);
  const lambdaParams = useContext(LambdaParamsContext);
  const [tab, setTab] = createSignal<UsePickerTab>("functions");
  let tabGeneration = 0;
  const changeTab = (next: UsePickerTab) => { tabGeneration++; setTab(next); };
  const captureTypeTarget: CaptureTypePickerTarget = () => latest(() => {
    if (tab() !== "types" || !props.isTypeField) return undefined;
    const target = props.captureTypeTarget();
    if (!target) return undefined;
    const generation = tabGeneration;
    return () => latest(() => generation === tabGeneration && tab() === "types" && props.isTypeField && target());
  });
  const tabs = createMemo<UsePickerTab[]>(() => {
    const out: UsePickerTab[] = ["functions"];
    if (props.isTypeField) out.push("types");
    if (props.showParams !== false && lambdaParams().length > 0) out.push("params");
    if (savedCtx && !props.isTypeField) out.push("saved");
    return out;
  });
  createEffect(
    () => ({ list: tabs(), current: tab() }),
    ({ list, current }) => {
      if (!list.includes(current)) changeTab(list[0] ?? "functions");
    },
  );
  const pickFunction = (fnId: string) =>
    props.isArrowField ? props.onPickFunctionRef(fnId) : props.onPickFunction(fnId);

  return (
    <div class="expr-use-picker">
      <div class="expr-picker__tabs">
        <For each={tabs()}>
          {(t) => (
            <button
              type="button"
              class={{ "expr-picker__tab": true, active: tab() === t }}
              onClick={() => changeTab(t)}
            >
              <Switch fallback={t}>
                <Match when={t === "functions"}>functions</Match>
                <Match when={t === "params"}>local</Match>
                <Match when={t === "saved"}>saved</Match>
                <Match when={t === "types"}>types</Match>
              </Switch>
            </button>
          )}
        </For>
      </div>

      <Show when={tab() === "functions"}>
        <FunctionPicker
          onPick={pickFunction}
          onPickLocal={props.isArrowField ? undefined : props.onPickLocalFunction}
          onCancel={props.onCancel}
          paramType={props.fieldType}
          expectedScheme={props.expectedScheme}
          paramTypeName={props.typeName}
          referenceMode={props.isArrowField}
          initialKind={props.isArrowField ? "function" : "all"}
          lockKind={props.isArrowField}
          requirementSource={props.requirementSource}
        />
      </Show>
      <Show when={tab() === "types"}>
        <TypePicker onPick={props.onPickTypeRef} captureTarget={captureTypeTarget} onCancel={props.onCancel} />
      </Show>
      <Show when={tab() === "params"}>
        <ParamPicker
          onPick={props.onPickParam}
          onCancel={props.onCancel}
          paramType={props.fieldType}
          expectedScheme={props.expectedScheme}
          paramTypeName={props.typeName}
        />
      </Show>
      <Show when={tab() === "saved"}>
        <SavedValuePicker
          onPick={props.onPickSaved}
          onCancel={props.onCancel}
          typeName={props.typeName}
          fieldType={props.fieldType}
          expectedScheme={props.expectedScheme}
        />
      </Show>
    </div>
  );
}

type FunctionPickerProps = {
  onPick: (fnId: string) => void;
  /** Explicit lexical values; these are never catalog function identities. */
  onPickLocal?: (param: LambdaParam) => void;
  onCancel?: () => void;
  /** Expected return type — used for structural filtering. When provided,
   *  solved authoritative schemes are structurally filtered. Fenced/unknown
   *  rows remain visible but disabled; compatibility return fields never make
   *  an inclusion/exclusion decision. Pass the actual FenelType, not a display
   *  string. */
  paramType?: FenelType;
  expectedScheme?: TypeScheme;
  referenceMode?: boolean;
  inputScheme?: TypeScheme;
  /** The input's type is still being inferred (`inputScheme` will follow):
   * show a pending state, never a ranking by the result type alone. */
  inputPending?: boolean;
  /** Inserting a call needs an input even when its source type is unknown. */
  requiresInput?: boolean;
  /** Display string for the placeholder text (e.g. "List<Record>"). */
  paramTypeName?: string;
  /** Pre-select this kind tab on open. Default `"all"`. */
  initialKind?: PickerKindFilter;
  /** When true, hide the kind tabs entirely and lock the picker to
   *  `initialKind`. Use when only one kind is semantically meaningful
   *  in the surrounding context (e.g. picking a constructor for a
   *  pattern arm). */
  lockKind?: boolean;
  /** Plain words for the place that requires the picked result. */
  requirementSource?: string;
  /** The highlighted catalogue function, for a live preview of the choice. */
  onHighlight?: (fnId: string | undefined) => void;
};

/** The prepared source of the one function picker (FunctionPickerSurface):
 * this session's catalogue, type ranking, constructors and local functions. */
function FunctionPicker(props: FunctionPickerProps) {
  return <FunctionPickerSurface model={query => preparedFunctionPickerModel(props, query)}
    initialKind={props.initialKind} lockKind={props.lockKind} onCancel={props.onCancel} onHighlight={props.onHighlight} />;
}

/** A row's signature: the checked scheme, rendered off the input path. */
function pickerSignature(entry: FnEntry | undefined, session: AuthoringSession, fallback?: () => string): () => JSX.Element {
  return () => entry ? <PickerSignature entry={entry} session={session} /> : fallback?.();
}

/** What the picked function receives and must produce, through the same type
 * contract as every occurrence. */
function pickerContract(contract: { receives: () => string | undefined; required: () => TypeContractRequirement | undefined;
  finalResult: () => string | undefined }): JSX.Element {
  return <>
    <TypeContract class="expr-picker__contract" receives={contract.receives()} required={contract.required()} />
    <Show when={contract.finalResult()}>{result => <span>Final result: {result()}</span>}</Show>
  </>;
}

/** A picker ranking: the engine's verdict per entry, and whether the
 * function's own source marks it internal (lane D, Rom's decision (b)). */
type PickerRanking = Array<{ entry: FnEntry; match: "direct" | "adaptable" | "mismatch" | "unavailable"; internal?: boolean }>;

function preparedFunctionPickerModel(props: FunctionPickerProps, query: FunctionPickerQuery): FunctionPickerModel {
  const session = useAuthoringSession();
  const pickerModel = createMemo(() => {
    // Facade resolution intentionally untracks; this read follows its owner.
    const catalog = editorCatalog(session);
    const owner = concreteAuthoringSession(session);
    const entries = measureAuthoringWork("picker index", () => projectFunctionPickerIndex(owner, catalog.functions));
    return { owner, entries, counts: constructorPickerNameCounts(entries),
      spellings: searchableFunctionSpellings(catalog.exactFunctionRoutes) };
  });
  const inferenceContext = useExpressionInferenceContext(session);
  const constructorNameCounts = () => pickerModel().counts;
  const qualifiedNames = () => pickerModel().spellings;
  const filter = query.text, kindFilter = query.kind, showOther = query.showOther;
  const expectedType = createMemo(() => props.paramType ?? expectedTypeForName(props.paramTypeName, editorEnvironment(session)));
  const expected = createMemo(() => props.expectedScheme
    ?? expectedSchemeForType(expectedType(), editorEnvironment(session)) ?? expectedType());
  const expectedLabel = () => props.paramTypeName
    ?? (expected() ? displayTypeLabel(props.expectedScheme?.body ?? expected() as FenelType) : undefined);
  // Display only: the picker's comparisons keep `expectedLabel`'s spelling.
  const reader = useReaderRuntime();
  const shownExpected = () => expected() ? editorTypeCaption(props.expectedScheme?.body ?? expectedType(), session, reader, expectedLabel()) : undefined;
  const goal = useContext(ExpressionGoalContext);
  const callCandidates = createMemo(() => {
    const current = pickerModel();
    return selectAuthoringCallCandidates(current.entries,
      !!props.requiresInput || !!props.inputScheme, editorFrame(current.owner));
  });
  const suggestionRequest = createMemo(() => ({ owner: pickerModel().owner, expected: expected(),
    mode: props.referenceMode ? "reference" as const : "call" as const,
    inputScheme: props.inputScheme, inputPending: !!props.inputPending && !props.inputScheme, candidates: callCandidates() }));
  // Lane D (3b): no ranking runs while the input's type is pending.
  const suggestions = createAsyncValue(suggestionRequest,
    async request => ({ request, rows: request.inputPending ? [] as PickerRanking : await rankSuggestionsForEditor(request.owner, request.candidates,
      request.expected, { ...editorContainment(request.owner), mode: request.mode, inputScheme: request.inputScheme },
      authoringSessionAccountScope(request.owner)) as PickerRanking }));
  const ranked = createMemo(() => {
    const receipt = suggestions();
    return suggestions.loading || receipt?.request !== suggestionRequest() ? [] : receipt.rows;
  });
  const matches = createMemo(() => new Map(ranked().map(({ entry, match }) => [entry, match])));

  // Tab counts follow the current catalogue and return-type filter. Text
  // search changes the rendered subset without changing those counts.
  // Lane D (Rom's decision (b)): a function its source marks internal (the
  // ranking's `internal` fact) stays out of the default rows; a typed query or
  // "show other functions" still reaches it.
  const typeFiltered = createMemo(() => {
    const reachInternal = showOther() || !!filter().trim();
    return ranked().filter(({ match, internal }) => (reachInternal || !internal)
      && ((!expected() && !props.inputScheme) || showOther() || match === "direct" || match === "adaptable"))
      .map(({ entry }) => entry);
  });
  // Methods and symbolic notation are ordinary functions. Constructors keep
  // their own filter because they directly build a value of the chosen type.
  const fnCount = createMemo(() => typeFiltered().filter((f) => f.kind !== "constructor").length);
  const ctorCount = createMemo(() => typeFiltered().filter((f) => f.kind === "constructor").length);

  const filtered = createMemo(() => {
    const f = filter().toLowerCase();
    const k = kindFilter();
    let out = typeFiltered();
    if (k === "function") {
      out = out.filter((fn) => fn.kind !== "constructor");
    } else if (k === "constructor") {
      out = out.filter((fn) => fn.kind === "constructor");
    }
    if (f) out = out.filter((fn) => Number.isFinite(functionSearchRank(fn, f, constructorNameCounts(), qualifiedNames())));
    const priorities = { direct: 0, adaptable: 1, mismatch: 2, unavailable: 3 };
    const tier = (fn: FnEntry) => functionSearchTier(functionSearchRank(fn, f, constructorNameCounts(), qualifiedNames()));
    return out.toSorted((a, b) => {
      // A typed query lists the closer name match first (Rom: "reverse" lists
      // Reverse before a description match); type fit orders each tier.
      const textTier = f ? tier(a) - tier(b) : 0;
      if (textTier) return textTier;
      const typeRank = priorities[matches().get(a)!] - priorities[matches().get(b)!];
      if (typeRank) return typeRank;
      if (!f && a.kind !== b.kind) return a.kind === "constructor" ? -1 : b.kind === "constructor" ? 1 : 0;
      if (!f && a.kind === "constructor" && b.kind === "constructor" && a.params.length !== b.params.length) return a.params.length - b.params.length;
      return compareFunctionSearch(a, b, f, constructorNameCounts(), qualifiedNames());
    });
  });
  const localCandidates = createMemo(() => {
    if (!props.onPickLocal || props.referenceMode || kindFilter() === "constructor") return [];
    return inferenceContext().lexicalBindings.flatMap(param => {
      if (!param.name.toLowerCase().includes(filter().toLowerCase())) return [];
      const type = peelArrowType(param.type, session);
      if (!type || !("$arrow" in type)) return [];
      // The lexical root owns the callable's complete scheme. Reuse the same
      // checked suggestion projection as catalogue functions, retaining shared
      // binders and nominal owners instead of guessing from a display return.
      const inferred = param.typeApplication === undefined
        ? inferScopedAuthoringExpression({ kind: "param", name: param.name }, inferenceContext()) : undefined;
      const scheme = inferred?.outcome.$tag === "Solved" ? inferred.scheme : undefined;
      const entry: FnEntry | undefined = scheme && "$arrow" in scheme.body ? {
        id: param.name, params: scheme.body.$arrow.params, returns: scheme.body.$arrow.returns,
        kind: "function", label: param.name, description: "", scheme, signatureOutcome: inferred!.outcome,
      } : undefined;
      return [{ param, entry }];
    });
  });
  /** One compatibility item per candidate that needs one (in order). */
  const localItems = createMemo(() => {
    const want = expected();
    return localCandidates().map(({ param, entry }): ReaderCompatibilityItem | undefined => param.typeApplication !== undefined
      ? want ? { scheme: { quantified: [], body: param.typeApplication.returns }, expected: want } : undefined
      : entry ? { entry, ...(want ? { expected: want } : {}) } : undefined);
  });
  // B4 F2: a Local reader judges these rows in its worker; until its answer
  // they are not compatible (shown only with "other" functions, disabled).
  const pickerReader = useReaderRuntime();
  const localCompatibility = localStructure(session) ? createLocalPickerCompatibility(() => pickerReader, () => session,
    () => localItems().flatMap(item => item ? [item] : [])) : undefined;
  const localRows = createMemo(() => {
    const items = localItems();
    const verdicts = localCompatibility?.verdicts();
    let answered = 0;
    return localCandidates().flatMap(({ param, entry }, index) => {
      const item = items[index];
      const verdict = item ? localCompatibility ? verdicts?.[answered++] : undefined : undefined;
      const match = !entry ? undefined : localCompatibility ? verdict && "match" in verdict ? verdict.match : undefined
        : rankAuthoringFunctionSuggestions([entry], expected(), editorContainment(session))[0]?.match;
      const compatible = param.typeApplication !== undefined
        ? !expected() || (localCompatibility ? !!verdict && "compatibility" in verdict && verdict.compatibility === "compatible"
          : judgeAuthoringSchemeCompatibility({ quantified: [], body: param.typeApplication.returns }, expected()!, editorContainment(session)) === "compatible")
        : match === "direct" || match === "adaptable";
      return compatible || showOther() ? [{ param, entry, compatible: compatible && param.typeApplication?.ready !== false }] : [];
    });
  });
  function pickLocal(param: LambdaParam) {
    if (!localRows().some(current => current.param === param && current.compatible)) return;
    props.onPickLocal?.(param);
  }
  function pickGlobal(fn: FnEntry) {
    const request = suggestionRequest();
    const receipt = suggestions();
    if (request.owner !== concreteAuthoringSession(session) || suggestions.loading
      || receipt?.request !== request || !filtered().includes(fn) || authoritativePickerSignature(fn) === undefined) return;
    props.onPick(fn.id);
  }
  // Lane D: the requirement reads by its shown name (a picked type's caption,
  // never its identity handle), and a row is never said to match while the
  // input it must accept is unknown: it is then judged by its result only.
  const requirementLabel = () => shownExpected() ?? expectedLabel();
  const inputUnknown = () => !!props.requiresInput && !props.inputScheme;
  const matchLabel = (match: string | undefined) => match === "direct"
    ? (expected() ? (inputUnknown() ? `Returns ${requirementLabel()}; its input is not checked` : `Matches ${requirementLabel()}`) : "Accepts this result")
    : match === "adaptable" ? "Can fit when its arguments are supplied"
    : match === "mismatch" ? (props.inputScheme ? "Needs a different input or another step" : `Needs another step to produce ${requirementLabel()}`)
    : "Compatibility is not yet known";
  // One row object per entry and verdict, so a recomputed list keeps its
  // rendered rows; a replaced catalogue or verdict mints new rows.
  const globalRows = new WeakMap<FnEntry, FunctionPickerRow>();
  function globalRow(fn: FnEntry): FunctionPickerRow {
    const match = matches().get(fn);
    const typed = !!(expected() || props.inputScheme);
    const owner = pickerModel().owner;
    const counts = constructorNameCounts();
    const name = functionDisplayName(fn, counts);
    const cached = globalRows.get(fn);
    const unavailable = authoritativePickerSignature(fn) === undefined;
    const label = typed && !unavailable ? matchLabel(match) : undefined;
    if (cached && cached.match === match && cached.matchLabel === label && displayNameText(cached.name) === name.text) return cached;
    const status = fn.signatureOutcome?.$tag === "Invalid" ? "invalid signature"
      : fn.signatureOutcome?.$tag === "AnnotationRequired" ? "annotation required" : "signature unavailable";
    const row: FunctionPickerRow = {
      key: `global:${fn.id}`, fnId: fn.id, name,
      badge: fn.kind === "constructor" ? "constructor" : undefined,
      status: unavailable ? status : undefined, disabled: unavailable,
      tooltip: unavailable ? `${fn.description} — ${status}` : fn.description,
      signature: unavailable ? () => "no authoritative callable scheme" : pickerSignature(fn, owner),
      match, matchLabel: label,
      take: () => pickGlobal(fn),
    };
    globalRows.set(fn, row);
    return row;
  }
  return {
    placeholder: "Search functions and constructors…",
    local: () => localRows().map(row => ({
      key: `local:${row.param.bindingId ?? row.param.name}`, name: codeName(row.param.name), badge: "local" as const,
      disabled: !row.compatible, localBinding: row.param.bindingId ?? row.param.name,
      tooltip: row.param.typeApplication?.ready === false ? "This application needs a declared type parameter for its higher-kinded input." : undefined,
      signature: pickerSignature(row.entry, pickerModel().owner, () => typeCode(row.param.type)),
      take: () => pickLocal(row.param),
    })),
    rows: () => filtered().map(globalRow),
    counts: () => ({ all: fnCount() + ctorCount() + localRows().length, functions: fnCount() + localRows().length, constructors: ctorCount() }),
    revision: expected,
    typeFiltered: () => !!(expected() || props.inputScheme),
    guidance: () => pickerContract({
      receives: () => props.inputScheme ? editorTypeCaption(props.inputScheme.body, session, reader) : undefined,
      required: () => expected() ? { label: shownExpected()!, source: props.requirementSource } : undefined,
      finalResult: () => expected() && goal() && displayTypeLabel(goal()!) !== expectedLabel() ? editorTypeCaption(goal()!, session, reader) : undefined,
    }),
    pending: () => suggestionRequest().inputPending ? "Checking the input's type…"
      : suggestions.loading ? "Finding compatible functions…" : undefined,
    failure: () => suggestions.error ? { message: "Could not prepare function suggestions. Close and reopen the picker to retry." } : undefined,
    // Any type-filtered list speaks when it is empty (a slot typed by a picked
    // type has no paramTypeName); an unfiltered list stays silent.
    empty: () => !suggestionRequest().inputPending && (expected() || props.inputScheme)
      ? `No matching suggestions${(shownExpected() ?? props.paramTypeName) ? ` for ${shownExpected() ?? props.paramTypeName}` : ""}. Try another search or show other functions.`
      : undefined,
  };
}

// ---------------------------------------------------------------------------
// NestedExprWrapper — provided via ExprFieldContext to FieldRenderer's
// sub-editors (list items, record fields, variant cases). Shows an
// inline / call / ref toggle above the value editor. Call and ref modes
// evaluate and deliver a plain value back to the parent.
// ---------------------------------------------------------------------------

/** Keep an expression draft for a field stored inside a literal value. A draft
 * remains editable until it evaluates; incomplete drafts clear the parent slot
 * so saving cannot silently retain the previously completed value. */
function NestedValueExpression(props: {
  value: unknown;
  type?: FenelType;
  field?: FieldDef;
  typeName?: string;
  onChange: (value: unknown) => void;
}) {
  const session = useAuthoringSession();
  const recordValues = useContext(RecordValuesContext);
  const saved = useContext(SavedValuesContext);
  const reader = useReaderRuntime();
  // B4 slice 2: a Local reader checks and evaluates the draft in its worker,
  // latest wins; until the answer the parent slot stays cleared (pending is
  // never a completed value) and this reader's Saves refuse.
  const lane = reader?.kind === "local" ? createGuidanceLane() : undefined;
  // Held under this editor's surface scope, else its reader's source.
  const checkOwner = useContext(DraftCheckScopeContext) ?? draftCheckReaderKey(reader);
  let changeGeneration = 0;
  const fieldType = createMemo(() => props.type
    ? resolveElInType(session, props.type, recordValues())
    : expectedTypeForName(props.typeName, editorEnvironment(session)));
  let lastPublished = props.value;
  const fromValue = (value: unknown) => value == null ? EMPTY_EXPRESSION
    : expressionForLiteralValue(value, fieldType(), editorEnvironment(session), props.typeName);
  const [draft, setDraft] = createSignal(fromValue(props.value));
  const [error, setError] = createSignal<string | undefined>(undefined);
  createEffect(() => props.value, (value) => {
    if (sameValue(value, lastPublished)) return;
    lastPublished = value;
    setDraft(fromValue(value));
    setError(undefined);
  });
  function publish(value: unknown) {
    lastPublished = value;
    props.onChange(value);
  }
  function change(next: ExprNode) {
    setDraft(next);
    setError(undefined);
    const generation = ++changeGeneration;
    if (next.kind === "literal" && !detectStructuralForm(next.value)) {
      lane?.cancel();
      settleCheck();
      publish(next.value);
      return;
    }
    if (lane) {
      publish(undefined);
      pendingCheck = { next, expectedType: fieldType(), generation };
      holdDraftCheck(checkOwner, checkToken);
      askAgain();
      return;
    }
    const resolver: RefResolver | undefined = saved ? (id) => saved.byId(id)?.expr : undefined;
    const issue = draftSaveIssue(next, editorEnvironment(session), {
      registry: session.registry, resolveSavedExpr: resolver,
    });
    if (issue) {
      setError(issue);
      publish(undefined);
      return;
    }
    try {
      const result = evaluateAuthoringExpression(next, resolver, session).result;
      const issue = draftSaveIssue(next, editorEnvironment(session), {
        expectedType: fieldType(), registry: session.registry, resolveSavedExpr: resolver,
        evaluatedValue: result, evaluateContext: session.evaluateContext,
      });
      if (issue) { setError(issue); publish(undefined); return; }
      publish(result);
    } catch (error) {
      setError(error instanceof Error ? error.message : String(error));
      publish(undefined);
    }
  }
  /** The page's two checks and its evaluation, in the same order, in the
   * worker: the draft's own check, then evaluation with the field-type check
   * of that value. A newer edit owns the slot. Only a missing capture or a
   * closed transport (the capture no longer holds) keeps this draft pending
   * and asks again, now or when the reader's capture next changes; any other
   * outcome, including a missing job or a page-side failure, settles the
   * check as this draft's answer (its message shown, its hold released). */
  async function changeInWorker(next: ExprNode, expectedType: FenelType | undefined, generation: number, signal: AbortSignal) {
    const capture = localGuidanceCapture(reader, () => session);
    if (!capture) return;
    const sources = new Map((saved?.list() ?? []).map(option => [option.id, option.expr] as const));
    const metadata = capture.sourceMetadata ? { sourceMetadata: capture.sourceMetadata } : {};
    // undefined: a newer edit owns the slot; false: stale, ask again.
    const fresh = () => generation !== changeGeneration ? undefined : localGuidanceCurrent(capture, reader, () => session);
    const stale = () => { const now = fresh(); if (now === false) askAgain(); return now !== true; };
    try {
      const checked = expressionSaveIssueInWorker(capture.facade, next, sources, { ...metadata, priority: "guidance" }, signal);
      if (!checked) { setError(NESTED_TOOLS_PENDING); settleCheck(); return; }
      const issue = (await checked).issue;
      if (stale()) return;
      if (issue) { setError(issue); settleCheck(); return; }
      const evaluated = evaluateExpressionInWorker(capture.facade, next, sources, signal, undefined,
        { admission: expectedType === undefined ? {} : { expectedType }, priority: "guidance", ...metadata });
      if (!evaluated) { setError(NESTED_TOOLS_PENDING); settleCheck(); return; }
      const reply = await evaluated;
      if (stale()) return;
      settleCheck();
      if (reply.issue) { setError(reply.issue); return; }
      publish(reply.result);
    } catch (error) {
      if (signal.aborted) return;
      const now = fresh();
      if (now === undefined) return;
      // A closed transport retires this capture: stay pending; the reader's
      // next capture (a replacement worker) asks again.
      if (now === false) { askAgain(); return; }
      // Otherwise (the worker's refusal, an unreadable reply, a host value
      // that cannot be checked, a page-side error) this is the draft's answer.
      setError(error instanceof Error ? error.message : String(error));
      settleCheck();
    }
  }
  let pendingCheck: { next: ExprNode; expectedType: FenelType | undefined; generation: number } | undefined;
  const checkToken = {};
  function settleCheck() { pendingCheck = undefined; releaseDraftCheck(checkOwner, checkToken); }
  function askAgain() {
    const asked = pendingCheck;
    if (!asked || !lane) return;
    lane.request(signal => changeInWorker(asked.next, asked.expectedType, asked.generation, signal));
  }
  // The reader's capture changed (a worker became ready or was replaced, a
  // newer revision): a pending draft asks again. A recomputed capture that is
  // the same (any worker announcement rebuilds the object) does not.
  let seenCapture: ReturnType<typeof localGuidanceCapture>;
  let captureSeen = false;
  if (lane) createEffect(() => localGuidanceCapture(reader, () => session), capture => {
    const previous = seenCapture, first = !captureSeen;
    seenCapture = capture;
    captureSeen = true;
    if (first || !capture || !pendingCheck) return;
    if (previous && sameLocalGuidanceCapture(previous, capture)) return;
    askAgain();
  });
  onCleanup(() => { lane?.dispose(); settleCheck(); });
  return <>
    <NodeEditor node={draft()} onChange={change} fieldDef={props.field ?? expressionField(fieldType())}
      expectedType={fieldType()} typeName={props.typeName} viewMode="nested" allowLocalBindings={false} />
    <Show when={error()}>{(message) => <div class="expr-type-guidance expr-type-guidance--mismatch" role="status">{message()}</div>}</Show>
  </>;
}

function NestedExprWrapper(props: ExprFieldWrapperProps) {
  return <PathSegmentProvider label={props.field?.name ?? props.typeName ?? "value"}>
    <NestedValueExpression value={props.value} onChange={props.onChange}
      field={props.field} type={props.field?.type} typeName={props.typeName} />
  </PathSegmentProvider>;
}

function NestedListItemWrapper(props: ListItemWrapperProps) {
  return <div class="fr-list-item">
    <div class="fr-list-item-header">
      <span class="fr-list-item-index">{props.index + 1}</span>
      <button type="button" class="fe-btn-danger-sm" onClick={props.onRemove} data-tooltip="Remove item"><IconTrash size={12} /></button>
    </div>
    <div class="expr-nested__content fr-list-item__body">
      <PathSegmentProvider label={`item ${props.index + 1}`}>
        <NestedValueExpression value={props.value} onChange={props.onChange}
          type={props.innerType} typeName={props.typeName} />
      </PathSegmentProvider>
    </div>
  </div>;
}

// ---------------------------------------------------------------------------
// LambdaEditor adapts an arrow-valued field to the shared function editor.
// Contextual types remain the field's contract; stored names are lexical binders.
// ---------------------------------------------------------------------------

function LambdaEditor(props: ArrowBodyEditorProps) {
  const session = useAuthoringSession();
  const recordValues = useContext(RecordValuesContext);
  const arrow = createMemo(() => ({
    $arrow: {
      ...props.arrowType.$arrow,
      params: props.arrowType.$arrow.params.map((param) => ({
        ...param,
        type: resolveElInType(session, param.type, recordValues()),
      })),
      returns: resolveElInType(session, props.arrowType.$arrow.returns, recordValues()),
    },
  }));
  const stored = createMemo(() => {
    const value = props.value;
    if (!value || typeof value !== "object" || !("__lambda" in value)) return undefined;
    const inner = (value as { __lambda: unknown }).__lambda;
    return inner && typeof inner === "object" ? inner : undefined;
  });
  const params = createMemo(() => {
    const inner = stored();
    return inner && "params" in inner && Array.isArray(inner.params)
      ? inner.params as string[] : arrow().$arrow.params.map((param) => param.name);
  });
  const body = createMemo<ExprNode>(() => {
    const inner = stored();
    if (inner && "body" in inner && inner.body && typeof inner.body === "object" && "kind" in inner.body)
      return inner.body as ExprNode;
    if (inner && "kind" in inner) return inner as ExprNode;
    return { kind: "literal", value: undefined };
  });
  function update(next: { params: string[]; body: ExprNode }) {
    const inner = stored();
    if (inner && "params" in inner) {
      props.onChange({ __lambda: { ...inner, ...next } });
      return;
    }
    // A body-only change retains the legacy marker. Naming an inline binder
    // uses the established named marker, without inventing field identities.
    props.onChange({ __lambda: next.params.every((name, index) => name === params()[index])
      && next.params.length === params().length ? next.body : next });
  }
  return <LambdaFormEditor params={params()} body={body()} arrowType={arrow()} onChange={update} />;
}

// ---------------------------------------------------------------------------
// ParamPicker — same shape as SavedValuePicker but pulls from
// LambdaParamsContext (the lambda's in-scope params) and filters by
// structural type compatibility with the field's expected type.
// ---------------------------------------------------------------------------

function ParamPicker(props: {
  onPick: (name: string) => void;
  onCancel?: () => void;
  paramType?: FenelType;
  expectedScheme?: TypeScheme;
  paramTypeName?: string;
}) {
  const session = useAuthoringSession();
  const params = useContext(LambdaParamsContext);
  const reader = useReaderRuntime();
  const [filter, setFilter] = createSignal("");
  const wanted = createMemo(() => props.paramType
    ? props.expectedScheme ?? expectedSchemeForType(props.paramType, editorEnvironment(session)) ?? props.paramType : undefined);
  // B4 F2: a Local reader filters its inputs in its worker; until the answer
  // none is offered (and the picker says nothing).
  const compatibility = localStructure(session) ? createLocalPickerCompatibility(() => reader, () => session, () => {
    const want = wanted();
    return want ? params().map(p => ({ scheme: p.scheme ?? { quantified: [], body: p.type }, expected: want })) : undefined;
  }) : undefined;
  const checking = () => !!compatibility && wanted() !== undefined && params().length > 0 && compatibility.verdicts() === undefined;

  const filtered = createMemo(() => {
    let out = params();
    const want = wanted();
    if (want) {
      const verdicts = compatibility?.verdicts();
      out = compatibility ? out.filter((_, index) => { const verdict = verdicts?.[index];
        return !!verdict && "compatibility" in verdict && verdict.compatibility === "compatible"; })
        : out.filter((p) => judgeAuthoringSchemeCompatibility(p.scheme ?? { quantified: [], body: p.type }, want, editorContainment(session)) === "compatible");
    }
    const f = filter().toLowerCase();
    if (f) out = out.filter((p) => p.name.toLowerCase().includes(f));
    return out.slice(0, 80);
  });
  const listId = createUniqueId();
  const keys = createListboxKeys<LambdaParam>({
    rows: filtered,
    id: (param) => param.name,
    domPrefix: `${listId}-option`,
    pick: (param) => props.onPick(param.name),
    close: () => props.onCancel?.(),
    resetOn: () => ({ filter: filter(), expected: props.expectedScheme ?? props.paramType }),
  });

  return (
    <div class="expr-picker">
      <div class="expr-picker__head">
        <input
          class="expr-picker__input"
          placeholder={props.paramTypeName ? `pick an input of type ${props.paramTypeName}…` : "pick an input…"}
          data-tooltip="The parameters of the enclosing lambda"
          value={filter()}
          onInput={(e) => setFilter(e.currentTarget.value)}
          onKeyDown={keys.keyDown}
          role="combobox"
          aria-label="Search local inputs"
          aria-expanded="true"
          aria-controls={listId}
          aria-autocomplete="list"
          aria-activedescendant={keys.activeDescendant()}
          autocomplete="off"
          spellcheck={false}
          autofocus
        />
        <Show when={props.onCancel}>
          <button type="button" class="expr-picker__cancel" onClick={props.onCancel}>cancel</button>
        </Show>
      </div>
      <div id={listId} class="expr-picker__list" role="listbox" aria-label="Local inputs">
        {/* An empty list says nothing. Only a type-filtered search that hides
            inputs speaks, because it names what to do next. */}
        <Show when={compatibility?.error()}>{message => <div class="admin-form-error" role="alert">{message()}</div>}</Show>
        <Show when={filtered().length === 0 && params().length > 0 && props.paramTypeName && !checking() && !compatibility?.error()}>
          <div class="text-muted" style="padding: 0.65rem; font-size: 0.75rem; text-align: center">
            No input here is a {props.paramTypeName}. Try another search, or choose a function or a saved value instead.
          </div>
        </Show>
        <For each={filtered()}>
          {(p) => (
            <button
              type="button"
              id={keys.optionDomId(p.name)}
              role="option"
              tabindex={-1}
              aria-selected={keys.isActive(p) ? "true" : "false"}
              class={["expr-picker__item", { "expr-picker__item--active": keys.isActive(p) }]}
              onMouseMove={() => keys.hover(p)}
              onClick={() => props.onPick(p.name)}
              data-tooltip={p.name}
            >
              <span class="mono" style="font-weight: 600">{p.name}</span>
              <span class="text-muted mono" style="font-size: 0.7rem">{p.scheme?.quantified.length ? typeCode(p.scheme.body) : displayTypeLabel(p.type)}</span>
            </button>
          )}
        </For>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Saved-value picker — surfaced by LiteralEditor's "+ ref" button. Same
// shape as FunctionPicker (search box + scrollable list) but pulls from
// SavedValuesContext rather than the function index.
// ---------------------------------------------------------------------------

// ---------------------------------------------------------------------------
// EntityIdPicker — list rows of an entity (by phantom name) and let the
// user pick one as a UUID literal. Used by the ref-mode of `$tagged`
// fields (Id<X> phantom-tag pattern). Special-cases "entity_definition"
// since the types catalog isn't exposed via /entity-instances.
// ---------------------------------------------------------------------------

type EntityIdRow = { id: string; label: string };

function fetchEntityIdRows(entityType: string, client: ApiClient, session: AuthoringSession,
  reader?: ReaderRuntime): Promise<EntityIdRow[]> {
  if (entityType === "entity_definition") {
    return client.apiFetch<{ types?: Array<{ id: string; name: string; label?: string }> }>(`/types`).then(
      (r) =>
        (r.types ?? []).map((t) => ({
          id: t.id,
          label: t.label ? `${t.label} (${t.name})` : t.name,
        })),
    );
  }
  // Interfaces (record-of-methods dispatch faces) don't live in
  // entity-instances — they're registered in the engine's dispatchRegistry
  // (a Map<string, Interface> keyed by type name) and exposed through the
  // in-process catalog under the merged section id "interface" (Phase 6b —
  // supersedes the old "typeclass"/"spec" split; everything is a type). Their
  // "id" is the name itself ("Labelable", "Iconable", …) — the bare type name.
  // Pulled synchronously from the catalog here since the engine is bundled into
  // the client; no API call needed, and new interfaces appear automatically
  // without any picker code changes. Entry ids still carry the `tc:` (parametric
  // format families) / `spec:` (representation records) origin prefixes, stripped
  // below; the `entityType === "typeclass"` picker key is an inert Id<X>-target
  // token (the phantom name a field carries), not a live section id.
  if (entityType === "typeclass") {
    const rows: EntityIdRow[] = [];
    const seen = new Set<string>();
    // B4 F2: a Local reader's interfaces come from its worker's catalogue.
    const sections = localStructure(session) ? reader?.kind === "local" ? reader.catalog() : []
      : sessionCatalogSections(session.registry);
    for (const section of sections) {
      if (section.id !== "interface") continue;
      for (const entry of section.entries) {
        // Strip the per-section prefix: `tc:` for typeclass, `spec:` for spec.
        const baseId = entry.id.startsWith("tc:")
          ? entry.id.slice(3)
          : entry.id.startsWith("spec:")
            ? entry.id.slice(5)
            : entry.id;
        if (seen.has(baseId)) continue;
        seen.add(baseId);
        rows.push({
          id: baseId,
          label: canonical(entry.name) || baseId,
        });
      }
    }
    return Promise.resolve(rows);
  }
  return client.apiFetch<{ instances?: Array<{ id: string; data?: Record<string, unknown> }> }>(
    `/entity-instances/${entityType}`,
  ).then((r) =>
    (r.instances ?? []).map((row) => {
      const data = row.data ?? {};
      const labelKey = ["name", "label", "title", "slug"].find((k) => typeof data[k] === "string");
      const labelVal = labelKey ? String(data[labelKey]) : `${entityType}:${row.id.slice(0, 8)}`;
      return { id: row.id, label: labelVal };
    }),
  );
}

function EntityIdPicker(props: {
  entityType: string;
  onPick: (uuid: string) => void;
  onCancel: () => void;
}) {
  const client = useApiClient();
  const session = useAuthoringSession();
  const [filter, setFilter] = createSignal("");
  const reader = useReaderRuntime();
  const rows = createAsyncValue(() => props.entityType, (entityType) => fetchEntityIdRows(entityType, client, session, reader));
  const filtered = createMemo(() => {
    const all = rows() ?? [];
    const f = filter().toLowerCase().trim();
    if (!f) return all.slice(0, 100);
    return all.filter((r) => r.label.toLowerCase().includes(f) || r.id.toLowerCase().includes(f)).slice(0, 100);
  });

  return (
    <div class="expr-picker">
      <div class="expr-picker__head">
        <input
          class="expr-picker__input"
          placeholder={`pick a ${props.entityType}…`}
          value={filter()}
          onInput={(e) => setFilter(e.currentTarget.value)}
          autofocus
        />
        <button type="button" class="expr-picker__cancel" onClick={props.onCancel}>cancel</button>
      </div>
      <div class="expr-picker__list">
        <Show when={rows.loading}>
          <div class="text-muted" style="padding: 0.65rem; font-size: 0.75rem; text-align: center">Loading…</div>
        </Show>
        <Show when={rows.error !== undefined}>
          <div class="admin-form-error" role="alert">Unable to load the {props.entityType} list: {rows.error instanceof Error ? rows.error.message : String(rows.error)}</div>
        </Show>
        <For each={filtered()}>
          {(row) => (
            <button
              type="button"
              class="expr-picker__item"
              onClick={() => props.onPick(row.id)}
              data-tooltip={row.id}
            >
              <span class="mono" style="font-weight: 600">{row.label}</span>
              <span class="text-muted mono" style="font-size: 0.7rem">→ {row.id.slice(0, 8)}…</span>
            </button>
          )}
        </For>
      </div>
    </div>
  );
}

export function SavedValuePicker(props: {
  onPick: (savedExprId: string) => void;
  /** A plain form lists saved data by name only (no identity hash). */
  plain?: boolean;
  onCancel?: () => void;
  typeName?: string;
  fieldType?: FenelType;
  expectedScheme?: TypeScheme;
}) {
  const session = useAuthoringSession();
  const ctx = useContext(SavedValuesContext);
  const reader = useReaderRuntime();
  const [filter, setFilter] = createSignal("");
  const shownType = () => props.typeName ? editorTypeCaption(props.fieldType ?? { $ref: props.typeName }, session, reader, props.typeName) : undefined;
  const savedExpected = createMemo(() => props.fieldType
    ? props.expectedScheme ?? expectedSchemeForType(props.fieldType, editorEnvironment(session)) ?? { quantified: [], body: props.fieldType }
    : undefined);
  // B4 F2: a Local reader infers and judges its saved values in its worker
  // (`infer-expression` with `compatibility`); until the answer none is offered.
  const localSaved = localStructure(session) ? createAsyncValue(() => {
    const expected = savedExpected();
    const list = ctx?.list() ?? [];
    let worker: object | undefined, revision: number | undefined;
    try { worker = authoringWorkerSnapshot(session); revision = reader?.revision(); } catch { worker = undefined; }
    // A replaced worker or a newer revision asks again.
    return expected && list.length ? { expected, list, owner: session, worker, revision } : undefined;
  }, async ({ expected, list, owner }) => {
    const saved = new Map(list.map(sv => [sv.id, sv.expr] as const));
    const ids = new Set<string>();
    for (let start = 0; start < list.length; start += LIVE_INFERENCE_BATCH_LIMIT) {
      const chunk = list.slice(start, start + LIVE_INFERENCE_BATCH_LIMIT);
      const job = inferExpressionsInWorker(owner, chunk.map(sv => ({ node: sv.expr, expectedScheme: expected, compatibility: expected })), saved);
      if (!job) throw new Error(NESTED_TOOLS_PENDING);
      const replies = await job;
      chunk.forEach((sv, index) => { if (replies[index]?.compatibility === "compatible") ids.add(sv.id); });
    }
    return { list, ids };
  }) : undefined;

  /** A failed worker check shows its refusal (the existing copy). */
  const savedUnavailable = () => localSaved && !localSaved.loading && localSaved.error !== undefined
    ? localSaved.error instanceof Error ? localSaved.error.message : NESTED_TOOLS_PENDING : undefined;
  /** The type-filtered claim below speaks about the saved values only once a
   * Local worker check has finished without error (as the parameter picker's
   * `!checking()` guard): a pending or failed check found nothing yet. */
  const savedChecked = () => !localSaved || (!localSaved.loading && localSaved.error === undefined);

  // Demo 1 (Nov 8): a saved record built by the expected type's own
  // constructor is that type's data, so it is listed at once; the worker's
  // check (every saved value, in batches) adds the rest when it answers. A
  // refined expectation keeps the check alone (its base constructor's data
  // need not satisfy the refinement).
  const expectedConstructor = createMemo(() => {
    const type = props.fieldType;
    if (!type || !localSaved) return undefined;
    try {
      const environment = editorEnvironment(session);
      const resolved = "$ref" in type ? environment.resolveTypeRef?.(type) ?? environment.resolveNamedType?.(type.$ref) : type;
      if (!resolved || "$refined" in resolved) return undefined;
      return rootConstructorTag(seedExpressionForType(type, environment));
    } catch { return undefined; }
  });
  const typed = createMemo(() => {
    let all = ctx?.list() ?? [];
    if (props.fieldType && localSaved) {
      const receipt = localSaved();
      const tag = expectedConstructor();
      all = !localSaved.loading && receipt?.list === all ? all.filter(sv => receipt.ids.has(sv.id))
        : tag !== undefined ? all.filter(sv => rootConstructorTag(sv.expr) === tag) : [];
    } else if (props.fieldType) {
      const want = props.fieldType;
      const expected = props.expectedScheme ?? expectedSchemeForType(want, editorEnvironment(session)) ?? { quantified: [], body: want };
      all = all.filter((sv) => {
        const result = inferExpression(sv.expr, {
          expectedScheme: expected, resolver: ctx ? (id) => ctx.byId(id)?.expr : undefined,
        }, session);
        return result.scheme !== undefined && judgeAuthoringSchemeCompatibility(result.scheme, expected, editorContainment(session)) === "compatible";
      });
    }
    return all;
  });
  // Launch night (Nov 13): an unnamed card reads as its heading ("Person 1"),
  // and a search also matches its data's text ("Rom" finds that Person).
  const shownName = (sv: SavedValueOption) => props.plain ? savedValueShownName(sv, shownType()) : sv.name;
  const searched = createMemo(() => {
    const f = filter();
    const all = typed();
    if (!f.trim()) return all.slice(0, 80);
    return all.filter((sv) => savedValueMatches(sv, f, props.plain ? shownType() : undefined,
      (id) => ctx?.byId(id)?.expr)).slice(0, 80);
  });
  const listId = createUniqueId();
  const keys = createListboxKeys<SavedValueOption>({
    rows: searched,
    id: (saved) => saved.id,
    domPrefix: `${listId}-option`,
    pick: (saved) => props.onPick(saved.id),
    close: () => props.onCancel?.(),
    resetOn: () => ({ filter: filter(), expected: props.expectedScheme ?? props.fieldType }),
  });

  return (
    <div class="expr-picker">
      <div class="expr-picker__head">
        <input
          class="expr-picker__input"
          placeholder={shownType() ? `reference a saved ${shownType()}…` : "reference a saved value…"}
          value={filter()}
          onInput={(e) => setFilter(e.currentTarget.value)}
          onKeyDown={keys.keyDown}
          role="combobox"
          aria-label="Search saved values"
          aria-expanded="true"
          aria-controls={listId}
          aria-autocomplete="list"
          aria-activedescendant={keys.activeDescendant()}
          autocomplete="off"
          spellcheck={false}
          autofocus
        />
        <Show when={props.onCancel}>
          <button type="button" class="expr-picker__cancel" onClick={props.onCancel}>cancel</button>
        </Show>
      </div>
      <div id={listId} class="expr-picker__list" role="listbox" aria-label="Saved values">
        <Show when={savedUnavailable()}>{message => <div class="admin-form-error" role="alert">{message()}</div>}</Show>
        <For each={searched()}>
          {(sv) => (
            <button
              type="button"
              id={keys.optionDomId(sv.id)}
              role="option"
              tabindex={-1}
              aria-selected={keys.isActive(sv) ? "true" : "false"}
              class={["expr-picker__item", { "expr-picker__item--active": keys.isActive(sv) }]}
              onMouseMove={() => keys.hover(sv)}
              onClick={() => props.onPick(sv.id)}
              data-tooltip={shownName(sv)}
            >
              <span class={{ mono: !props.plain }} style="font-weight: 600">{shownName(sv)}</span>
              <Show when={!props.plain}><span class="text-muted mono" style="font-size: 0.7rem">→ {sv.id.slice(0, 8)}…</span></Show>
            </button>
          )}
        </For>
        {/* An empty list says nothing. Only a type filter that hides every
            saved value speaks, because it names what to do next; a search
            that hides values of the type is not that claim (Nov 13). */}
        <Show when={savedChecked() && typed().length === 0 && (ctx?.list() ?? []).length > 0 && props.typeName}>
          <div class="text-muted" style="padding: 0.65rem; font-size: 0.75rem; text-align: center">
            None of your saved values is a {shownType()}. Try another search, or choose a function instead.
          </div>
        </Show>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// TypePicker is now defined in `~/lib/type-builder` (used as the leaf of
// the universal TypeBuilder) and re-exported here for back-compat with
// callers that import it from this module.
// ---------------------------------------------------------------------------

import { TypePicker, TypeBuilder, type TypePickerSelection, type CaptureTypePickerTarget } from "~/lib/type-builder";
import { isFenelTypeLike } from "~/lib/type-builder/type-builder-model";
export { TypePicker };

/** Detect whether a field's type is the universe `{$type: true}`. Type-
 *  typed fields get a special ref-mode treatment (open TypePicker and
 *  store a `$named` reference) since saved values almost never carry a
 *  FenelType as their payload. */
function isTypeMetaType(t: FenelType | undefined): boolean {
  return !!(t && typeof t === "object" && "$type" in t && (t as { $type: unknown }).$type === true);
}

function isEditableTypeLiteral(
  value: unknown,
  session: AuthoringSession = DETACHED_AUTHORING_SESSION,
): value is FenelType {
  // This is a probe over arbitrary expression data, including __do/__lambda
  // markers. The engine's type-only peeling boundary now rejects non-types.
  try {
    if (!isFenelTypeLike(value)) return false;
  } catch {
    return false;
  }
  return refLiteralKind(value, (handle) => editorGetFunction(session, handle)) !== "function";
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function typeNameOf(
  t: FenelType,
  session: AuthoringSession = DETACHED_AUTHORING_SESSION,
): string | undefined {
  return typeDisplayName(t, editorEnvironment(session));
}

// structural-dispatch Phase 4a — the browser-side `typeMatches` is DELETED. Its
// structural-compatibility logic was a per-type Fenel fact re-encoded as a TS
// walk (`[[feedback_no_language_concept_in_ts]]`); it is now the `.fenel`
// `engine:typeSubsumes` body, bottoming at the shipped `set:decideSubset` for
// genuine subtype precision, consumed in-process via the authoring environment's
// FunctionPicker return-type filter.

const pickerSignatureCache = new WeakMap<AuthoringSession, WeakMap<FnEntry, string>>();
function PickerSignature(props: { entry: FnEntry; session: AuthoringSession }) {
  const signature = createAsyncValue(() => ({ entry: props.entry, session: props.session }), async ({ entry, session }) => {
    let cache = pickerSignatureCache.get(session);
    if (!cache) pickerSignatureCache.set(session, cache = new WeakMap());
    const cached = cache.get(entry);
    if (cached !== undefined) return cached;
    await yieldToInput();
    const value = measureAuthoringWork("picker signature", () => sigShort(entry, session));
    cache.set(entry, value);
    return value;
  });
  return <>{signature() ?? "…"}</>;
}

function sigShort(fn: FnEntry, session: AuthoringSession): string {
  return displayFunctionSignature(fn, type => typeNameOf(type, session));
}

function shortLabel(v: unknown, idx: number): string {
  if (v === null) return "null";
  if (v === undefined) return "undefined";
  if (typeof v === "string") {
    if (v.length === 0) return '""';
    if (v.length > 20) return JSON.stringify(v.slice(0, 18) + "…");
    return JSON.stringify(v);
  }
  if (typeof v === "number" || typeof v === "boolean") return String(v);
  if (v && typeof v === "object" && "width" in (v as object) && "height" in (v as object)) {
    const o = v as { width: number; height: number };
    return `image #${idx + 1} (${o.width}×${o.height})`;
  }
  return `value #${idx + 1}`;
}

function formatArg(v: unknown): string {
  if (v === null || v === undefined) return String(v);
  if (typeof v === "number" || typeof v === "boolean") return String(v);
  if (typeof v === "string") {
    return v.length > 16 ? JSON.stringify(v.slice(0, 14) + "…") : JSON.stringify(v);
  }
  return "…";
}

function sameValue(a: unknown, b: unknown): boolean {
  if (a === b) return true;
  // Cheap structural equality for the values we store as examples.
  try {
    return JSON.stringify(a) === JSON.stringify(b);
  } catch {
    return false;
  }
}

// Re-export so consumers can build one without the editor.
export const expressionRunnerHelpers = { fnCodeName, typeNameOf };

/** UI projection of the shared Fenel inference result. */
export function inferExpressionTypeName(
  node: ExprNode,
  session: AuthoringSession = DETACHED_AUTHORING_SESSION,
): string | undefined {
  const t = inferExpressionType(node, {}, session);
  return t ? typeNameOf(t, session) : undefined;
}

/** Shared inference projection used by pickers and the match-pattern editor.
 *  AnnotationRequired/Invalid outcomes project to `undefined`, which callers
 *  treat as "no filtering".
 *
 *  Context (all optional):
 *    - `bindings` — map from lambda-param / let-binding name to its
 *      type. Used to type `{kind: "param", name}` nodes. The closest
 *      caller will usually pass `LambdaParamsContext` flat-merged with
 *      any visible let-bindings.
 *    - `resolver` — same shape as `toLogic`'s ref resolver. When set,
 *      `ref` nodes get inlined and re-inferred.
 */
type ExpressionInferenceUiContext = {
  bindings?: Record<string, FenelType | TypeScheme>;
  resolver?: RefResolver;
  expectedScheme?: TypeScheme;
};

const abstainingMembership: AuthoringLiteralMembership = () => Nothing;
function useExpressionInferenceContext(session: AuthoringSession): () => AuthoringInferenceContext & { lexicalBindings: readonly LambdaParam[] } {
  const params = useContext(LambdaParamsContext);
  const saved = useContext(SavedValuesContext);
  // The session is a reactive facade over the current authority. Building the
  // membership judge in the component body read it once and kept a stale one
  // after a session change; a memo follows it.
  // B4 slice 2: the registry and evaluator are read only when a membership is
  // actually judged on the page, so a Local editor whose inference runs in its
  // worker reads neither.
  // B4 F2: a Local editor's page-side structure inference (call guidance,
  // pattern bindings, picker rows) judges no literal membership: it abstains
  // (undecided, never a definite), and its live inference runs in the worker.
  const literalMembership = createMemo(() => localStructure(session) ? abstainingMembership
    : literalMembershipFor(editorEnvironment(session), { get registry() { return session.registry; },
      get evaluateContext() { return session.evaluateContext; } }));
  return createMemo(() => {
    // Dotted picker aliases have display types; the captured root scheme owns
    // projection and nominal identity. Retain the same chosen root rows for
    // local callable menus, rather than requiring a separate persisted ID.
    const roots = Object.fromEntries(params().filter(param => !param.name.includes("."))
      .map(param => [param.name, param]));
    return {
      ...editorEnvironment(session),
      literalMembership: literalMembership(),
      lexicalBindings: Object.values(roots),
      bindings: Object.fromEntries(Object.entries(roots).map(([name, param]) => [name, param.scheme ?? param.type])),
      resolveSavedExpr: saved ? (id: string) => saved.byId(id)?.expr : undefined,
    };
  });
}

function inferExpression(
  node: ExprNode,
  ctx: ExpressionInferenceUiContext = {},
  session: AuthoringSession = DETACHED_AUTHORING_SESSION,
): AuthoringInferenceResult {
  const kernelCtx: AuthoringInferenceContext = {
    ...editorEnvironment(session),
    literalMembership: localStructure(session) ? abstainingMembership
      : literalMembershipFor(editorEnvironment(session), { registry: session.registry, evaluateContext: session.evaluateContext }),
    bindings: ctx.bindings,
    resolveSavedExpr: ctx.resolver,
  };
  const expected = inferenceExpectation(node, ctx.expectedScheme, session);
  return inferScopedAuthoringExpression(node, kernelCtx, { expectedScheme: expected });
}

function inferenceExpectation(node: ExprNode, expectedScheme: TypeScheme | undefined, session: AuthoringSession): TypeScheme | undefined {
  const concrete = node.kind === "literal" ? widgetTypeForSlot(undefined, node.value) : undefined;
  return expectedScheme ?? (concrete ? expectedSchemeForType(concrete, editorEnvironment(session))
    ?? { quantified: [], body: concrete } : undefined);
}

/** B4 slice 2: the `infer-expression` item a Local reader's worker answers in
 * place of `inferExpression(node, {}, session)` (the same expectation, read
 * from the page environment only). */
export function expressionInferenceItem(node: ExprNode, session: AuthoringSession = DETACHED_AUTHORING_SESSION): ExpressionInferenceItem {
  const expectedScheme = inferenceExpectation(node, undefined, session);
  return expectedScheme ? { node, expectedScheme } : { node };
}

export function inferExpressionType(
  node: ExprNode,
  ctx: ExpressionInferenceUiContext = {},
  session: AuthoringSession = DETACHED_AUTHORING_SESSION,
): FenelType | undefined {
  return inferExpression(node, ctx, session).type;
}

/** Walk a match-arm pattern against a scrutinee type and collect every
 *  name-introducing binding (`{$bind: "name"}`) along with the type
 *  that name takes on inside the arm body.
 *
 *  Patterns nest, so the walker recurses:
 *    - `_` / literal — no bindings
 *    - `{$bind: "x"}` — binds `x` to the *current sub-type* (the scrutinee
 *      type for the top of the pattern, a constructor field's type for
 *      a nested $tag pattern, a record field's type for a record pattern)
 *    - `{$tag: "Just", _0: <p>}` — recurse on `<p>` with the field's
 *      declared type selected through the shared Fenel pattern-inference
 *      boundary; unavailable or ambiguous constructor schemes add no guessed
 *      binding
 *    - `{field1: <p>, …}` — plain-record patterns are outside the canonical
 *      Pattern ADT and therefore add no guessed bindings
 *    - `{$guard: [<p>, …]}` — same bindings as the inner `<p>`
 *
 *  Used by `MatchFormEditor` to extend `LambdaParamsContext` inside each
 *  arm body, so `case Just { value = x } -> body` gives `x` the right
 *  type in `body`'s ref / param pickers and in downstream inference. */
function patternBindingsForArm(
  pattern: unknown,
  scrutineeType: FenelType | TypeScheme | undefined,
  session: AuthoringSession,
): LambdaParam[] {
  const result = inferAuthoringPatternBindingsCore(
    pattern,
    scrutineeType,
    editorEnvironment(session),
  );
  return result.bindings?.map(({ name, type, scheme }) => ({ name, type, scheme })) ?? [];
}
