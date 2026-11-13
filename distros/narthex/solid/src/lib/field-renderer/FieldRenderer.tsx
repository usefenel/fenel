// ---------------------------------------------------------------------------
// Universal Field Renderer — renders editors for any FenelType.
//
// Used by:
// - Flow editor: action parameter editors
// - Form builder: form field editors
// - FenelForm widget: end-user form rendering
//
// Takes a FieldDef and renders the Fenel-owned field edit plan through
// browser/editor leaves (StringEditor / NumberEditor / DateEditor / refs,
// records, variants, maps, expression widgets, masks).
// ---------------------------------------------------------------------------

import { Show, For, createSignal, createMemo, createEffect, createContext, createUniqueId, useContext, onSettled, latest, isPending, type Accessor, type Component, Loading } from "solid-js";
import { createAsyncValue } from "~/lib/async-value";
import type { JSX } from "@solidjs/web";
import { Dynamic } from "@solidjs/web";
import { ModalOverlay } from "../confirm-modal";
import type {
  FenelType,
  FieldDef,
  SelectOption,
  RefOption,
  SetExpr,
  EditDisplay,
  FieldRef,
  LocaleString,
} from "@fenel/engine/types";
import { getSystemEntity, repositoryProviderScope } from "@fenel/engine/system-entities";
import { dispatchRegistry } from "@fenel/engine/system-entities";
import { inferDisplayField } from "@fenel/engine/types";
import { canonical } from "@fenel/engine/locale";
import type { TextChannel } from "@fenel/engine/types";
import { entitySchemaFields, getDefaultView, parseInput, stdModule, printFenel, getNamedPattern, patternDeriv, patternNullable, patternFirstSet, forcedPrefix, decomposeFlatPattern, type Pattern, type FlatSegment } from "@fenel/engine";
import { createRepositoryRegistry } from "@fenel/engine/repository-registry";
import { fieldChoiceSelectionPlan, fieldReaderPlan, fieldRecordEditPlan, fieldRecordSlotsPlan, fieldTypeLabelPlan, type FieldRecordResult, type FieldRecordSlotEntry, type FieldReaderPlan, type FieldReaderPlanArgs, type FieldEditPlan, type FieldEditorPlan, type FieldMatrixRowPlan, type FieldVariantCasePlan } from "@fenel/engine/authoring/field-render";
import { fieldListChipsEditPlan, fieldListChipsSelectionPlan, type FieldListChipsAction } from "@fenel/engine/authoring/field-render";
import { referenceRows } from "~/lib/reference-data";
import { peelMaybeValue, Nothing, Just, refHandle } from "@fenel/engine/type-foundation";
import { peelSetExpr } from "@fenel/engine/set-marker";
import type { ModuleRegistry } from "@fenel/engine/registry";
import { registryTransportSnapshot } from "../../../../../../implementations/typescript/engine/src/registry";
import { resolveIdentifiedFieldView } from "@fenel/engine/identified-field-view";

import { IconPlus, IconTrash, IconMail, IconPhone, IconLink, IconUser, IconCircleCheck, IconCircleX, IconByName, IconWorld } from "~/lib/icons";
import { FieldLabelSurface } from "./field-label-surface";
import { StringInputSurface } from "./string-input-surface";
import { FieldHintsContext, MembershipHintsView, createMembershipHints, fieldHintSet, hintBadge, type MembershipHintObserver } from "./refinement-hints";
import { useRefResolver, useRefCreator } from "./ref-context";
import { useEntityComponent } from "./entity-components";
import { useReaderRuntime } from "~/lib/reader-runtime";
import { useParams } from "./params-context";
import { AddressAutocomplete } from "./AddressAutocomplete";
import "../admin-form/admin-form.css";
import { SpatialMap } from "./SpatialMap";
import { ExpressionEditor, TermsEditor } from "~/lib/expression-builder";
import { TypeBuilder } from "~/lib/type-builder";
import { LocaleStringEditor } from "~/lib/representations/LocaleStringEditor";
import { RecordValuesContext } from "./record-values-context";
import { createFieldPublishGate } from "./field-publish-gate";
import { createAuthoringEnvironment, dependentTypeForValuePath } from "@fenel/engine/authoring/environment";
import { scopedConcreteType } from "~/lib/data-transfer/expressions";
import { DETACHED_AUTHORING_SESSION, useAuthoringSession, type AuthoringSession } from "~/lib/expression-runner/authoring-session";
import { preparedReaderWorkerForSession, registryHasSnapshotOwner, runPreparedReaderWorker } from "~/lib/expression-runner/authoring-catalog-worker";
import { sessionEpoch } from "~/lib/browser-session";
import { namedFieldId } from "~/lib/field-occurrence/model";

const FIELD_AUTHORING_ENV = createAuthoringEnvironment();

/** Substitute top-level `$el` references in a type using the given
 *  record-values context. Falls back to the original type when the
 *  reference doesn't resolve (e.g. the sibling hasn't been picked yet),
 *  so callers can render a placeholder rather than crashing. */
export function resolveElInType(
  t: FenelType,
  ctx: Record<string, unknown>,
  session?: AuthoringSession,
): FenelType {
  if (session) return scopedConcreteType(t, session.evaluateContext, session.environment, session.registry, ctx) ?? t;
  // Compatibility for standalone unprepared consumers. A supplied session
  // always owns resolution; an unreadable scoped type stays unresolved.
  return dependentTypeForValuePath(FIELD_AUTHORING_ENV, t, ctx);
}
import { MarkupEditor } from "~/lib/markup-editor";
import { MarkupExprEditor } from "~/lib/markup-editor/MarkupExprEditor";
import { StringExprEditor } from "~/lib/string-expr-editor";
import { VariantValueEditor, RawValueEditor } from "~/lib/variant-value/VariantValueEditor";
import { nativeValueTypeName, isNativeValueRepresentation } from "@fenel/engine/authoring/type";
import { NumberInput } from "~/lib/number-input";
import { numericTextCodec } from "~/lib/numeric-text-codec";
import { LocusSelect, type LocusSelectOption } from "~/lib/locus-select";
import { elem as makeElem, text as makeText, type MarkupValue } from "@fenel/engine/markup";

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

export type FieldRendererProps = {
  /** Explicit repository/account context for UUID field facets. */
  registry?: ModuleRegistry;
  /**
   * Product/persisted fields are strict by default: when a registry is in
   * scope they must carry a NamedField UUID. Synthetic host-only fields (for
   * example an InstanceEditor method record) opt into transient mode
   * explicitly. The transient provider also fences every nested renderer from
   * accidentally inheriting an account registry for field identity.
   */
  identityMode?: "identified" | "transient";
  /**
   * The registry whose functions an `$arrow` field offers and resolves (the
   * `FunctionPicker`). A separate concern from `registry`: it names callables,
   * not field identities, so the transient fence keeps it, and nested
   * renderers inherit it. Without one the picker uses the inherited field
   * registry; only a surface with no registry at all falls back to std.
   */
  callableRegistry?: CallableRegistry;
  field: FieldDef;
  value: unknown;
  onChange: (value: unknown) => void;
  /** Observe this field's existing hint answer for its enclosing display. */
  observeMembershipHints?: MembershipHintObserver;
  /** Compact mode: minimal chrome, no labels */
  compact?: boolean;
  /** Browser autofill purpose for a scalar field; its editor remains type-driven. */
  autocomplete?: JSX.InputHTMLAttributes<HTMLInputElement>["autocomplete"];
};

/** What an `$arrow` field picks from: the functions a registry lists and the
 *  handle spellings (id, codeName, UUID, dotted name) it resolves. */
export type CallableRegistry = Pick<ModuleRegistry, "listFunctions" | "getFunction">;

/** The callable registry in scope, kept apart from the field presentation
 *  registry: a transient renderer clears inherited field identity, never the
 *  functions its synthetic fields may name. */
const CallableRegistryContext = createContext<Accessor<CallableRegistry | undefined>>(() => undefined);

import { FieldPresentationRegistryProvider, useFieldPresentationRegistry } from "./field-presentation-context";
import { functionOptionLabel, functionOptionLabelIn, functionPickerHandle, functionPickerKey, functionPickerOptionReadable, functionPickerOptions,
  functionPickerRegistry, functionPickerSelection, functionPickerSelectionReadable, functionPickerSignature, functionPickerValue,
  type FunctionPickerSelection } from "./function-picker-model";
import { GLOBAL_ONLY } from "@fenel/engine";
export { FieldPresentationRegistryProvider, useFieldPresentationRegistry } from "./field-presentation-context";

// ---------------------------------------------------------------------------
// ExprFieldContext — when ExpressionEditor renders FieldRenderer, it
// provides this context so nested sub-editors (list items, record fields,
// variant cases) get inline / call / ref toggle composition.
// ---------------------------------------------------------------------------

export type ExprFieldWrapperProps = {
  /** When provided, the wrapper owns the field's label so the [label,
   *  toggle, editor] order matches top-level rendering. The inner
   *  FieldRenderer auto-suppresses its own label in this case. */
  field?: FieldDef;
  value: unknown;
  onChange: (value: unknown) => void;
  typeName?: string;
  children: any;
};

/** Specialised wrapper for list items — owns the whole `.fr-list-item`
 *  card so the index + mode toggle + remove button can share a single
 *  header row. The default ListEditor rendering is used when no wrapper
 *  is provided in context. */
export type ListItemWrapperProps = {
  index: number;
  /** Inner element type — passed through to call/ref pickers so they
   *  can structurally filter to functions returning the right shape. */
  innerType?: FenelType;
  typeName?: string;
  value: unknown;
  onChange: (value: unknown) => void;
  onRemove: () => void;
  children: any;
};

/** Editor for `$arrow`-typed fields, provided via expression-runner so
 *  the inline mode of an arrow field is a real lambda body composer
 *  (using the universal ExpressionEditor for the return type) instead
 *  of a "pick a function" select. When no editor is provided in context,
 *  FieldRenderer falls back to the simple FunctionPicker. */
export type ArrowBodyEditorProps = {
  arrowType: { $arrow: { params: readonly FieldDef[]; returns: FenelType } };
  value: unknown;
  onChange: (value: unknown) => void;
};

/** A plain-form host (the New data simple form) shows each value's default
 * input only: the "Value representations" toggle stays in the full editor. */
export const PlainFieldsContext = createContext<boolean>(false);

export const ExprFieldContext = createContext<{
  Wrapper: Component<ExprFieldWrapperProps>;
  ListItemWrapper?: Component<ListItemWrapperProps>;
  ArrowBodyEditor?: Component<ArrowBodyEditorProps>;
  /** The authoring session can supply a valid widget/constructor seed. */
  defaultValueForType?: (type: FenelType) => unknown;
} | null>(null);

function WithExprField(props: {
  field?: FieldDef;
  value: unknown;
  onChange: (v: unknown) => void;
  typeName?: string;
  children: any;
}) {
  const ctx = useContext(ExprFieldContext);
  return (
    <Show when={ctx} fallback={props.children}>
      {(c) => {
        const W = c().Wrapper;
        return <W field={props.field} value={props.value} onChange={props.onChange} typeName={props.typeName}>{props.children}</W>;
      }}
    </Show>
  );
}

/** Display-friendly type label supplied by the Fenel-owned field edit plan. */
export function displayTypeLabel(t: FenelType | undefined): string {
  return fieldTypeLabelPlan(t);
}

type ReaderFieldPlanRequest = Omit<FieldReaderPlanArgs, "registry" | "evaluateContext">;

/** Component-local occurrence lifetime, projected from validated FieldKey
 * wire data. A positional ordinal is meaningful only under this same owner. */
function readerFieldOccurrenceKey(field: FieldDef): string | undefined {
  const named = namedFieldId(field);
  return named !== null ? `named:${named}` : field.key?.$tag === "PositionalField" ? `positional:${field.key.index}` : undefined;
}

/** A2 native interaction lifetime, shared by the reader's prepared controls.
 * Structural interaction waits for the current plan. Native text edits pass
 * whenever `acceptsText` holds in the latest view (the same occurrence's
 * editor is current), even while an unrelated transition is still pending:
 * a person typing never loses a key (demo 1, 2026-11-08). */
export function createReaderInteractionGuard(ready: () => boolean, acceptsText?: () => boolean) {
  let guardedElement: HTMLElement | undefined;
  const blockPendingInteraction = (event: Event) => {
    // Removing a focused input can dispatch change inside a render effect.
    // Probe pending before latest so that event cannot read an async plan.
    if (!isPending(ready) && latest(ready)) return;
    if (acceptsText && nativeTextEdit(event)) {
      let accepted = false;
      try { accepted = !!latest(acceptsText); } catch { accepted = false; }
      if (accepted) return;
    }
    if (event instanceof KeyboardEvent && (event.key === "Tab" || event.key === "Escape"
      || ((event.ctrlKey || event.metaKey) && ["a", "c"].includes(event.key.toLowerCase())))) return;
    if (event instanceof KeyboardEvent && ["ArrowLeft", "ArrowRight", "Home", "End"].includes(event.key)
      && (event.target instanceof HTMLInputElement || event.target instanceof HTMLTextAreaElement)) return;
    event.preventDefault(); event.stopImmediatePropagation();
  };
  const guardedEvents = ["beforeinput", "input", "click", "change", "keydown", "paste", "drop"];
  const release = () => {
    for (const name of guardedEvents) guardedElement?.removeEventListener(name, blockPendingInteraction, true);
    guardedElement = undefined;
  };
  onSettled(() => release);
  return (element: HTMLElement) => {
    release(); guardedElement = element;
    for (const name of guardedEvents) element.addEventListener(name, blockPendingInteraction, true);
  };
}

/** A native text edit (typing, deleting, pasting into a text input or area):
 * the edits a field's own publish gate and its record's edit queue carry. */
function nativeTextEdit(event: Event): boolean {
  const target = event.target;
  if (!(target instanceof HTMLInputElement || target instanceof HTMLTextAreaElement)) return false;
  if (event.type === "beforeinput" || event.type === "input" || event.type === "paste") return true;
  return event instanceof KeyboardEvent && event.type === "keydown" && !event.ctrlKey && !event.metaKey && !event.altKey
    && (event.key.length === 1 || event.key === "Backspace" || event.key === "Delete");
}

/** A2/B3 field-plan lifetime only. Semantic preparation stays with the same
 * source helper on every backend; matching Local readers require their exact
 * worker, and a pending/refused worker never selects a page-side fallback. */
function createReaderFieldPlan(request: () => ReaderFieldPlanRequest | undefined,
  registry: () => ModuleRegistry | undefined, reader: ReturnType<typeof useReaderRuntime>, authoring: AuthoringSession,
  retainTransientSlot = false) {
  const requested = createMemo(request);
  const owner = createMemo(() => {
    if (!requested()) return undefined;
    const session = reader?.session() ?? authoring;
    const activeRegistry = registry();
    const worker = localFieldSelectionWorker(reader, session, activeRegistry);
    const context = worker ? undefined : pageFieldFrame(reader, session, activeRegistry);
    return { session, registry: activeRegistry, worker, context, epoch: sessionEpoch(), revision: worker ? reader?.revision() : undefined };
  });
  const input = createMemo(() => {
    const args = requested();
    if (!args) return undefined;
    const capturedOwner = owner()!;
    try {
      const captured = registryTransportSnapshot(args, "reader field plan input", "equality", Reflect.get);
      return { kind: "request" as const, field: args.field, value: args.value, captured, owner: capturedOwner };
    } catch (error) { return { kind: "error" as const, field: args.field, value: args.value, error, owner: capturedOwner }; }
  });
  // The last accepted worker answer. A newer input that differs from its
  // request only in data that plan does not read reuses it (no re-plan, so
  // typing never blocks the field; demo 1, 2026-11-08). See planReadsData.
  let answered: { input: Extract<NonNullable<ReturnType<typeof input>>, { kind: "request" }>; result: FieldReaderPlan } | undefined;
  const planInput = createMemo(() => {
    const captured = input();
    if (!captured || captured.kind === "error" || !captured.owner.worker) return captured;
    const previous = answered;
    return previous && samePlanOwner(previous.input.owner, captured.owner)
      && samePlanRequest(previous.input.captured as Record<string, unknown>, captured.captured as Record<string, unknown>,
        previous.result) ? previous.input : captured;
  });
  let pending: AbortController | undefined;
  let alive = true;
  // Native text edits pass while this occurrence's editor is painted and its
  // pending plan request differs from the shown one only by the value: what
  // is typed then goes through the field's publish gate, which holds it until
  // the plan is ready (Nov 13: keys typed during such a re-plan were
  // swallowed). A re-plan for other inputs (a dependent type's siblings) and
  // structural interaction still wait for the plan.
  const guardElement = createReaderInteractionGuard(() => !!checked(), () => {
    if (checked()) return true;
    const captured = input(), shown = paint() ? retained?.input : undefined;
    if (captured?.kind !== "request" || shown?.kind !== "request") return false;
    const key = planRequestKeyApartFromValue(captured.captured as Record<string, unknown>);
    return key !== undefined && key === planRequestKeyApartFromValue(shown.captured as Record<string, unknown>);
  });
  onSettled(() => () => { alive = false; pending?.abort(); });
  const currentOwner = (captured: NonNullable<ReturnType<typeof input>>, fresh = false) => {
    if (!alive || sessionEpoch() !== captured.owner.epoch) return false;
    const current = fresh ? latest(owner) : owner();
    if (!current || current.session !== captured.owner.session || current.registry !== captured.owner.registry
      || current.revision !== captured.owner.revision) return false;
    const route = captured.owner.worker;
    try { return !route || route.kind === "worker" && current.worker?.kind === "worker"
      && current.worker.worker === route.worker && preparedReaderWorkerForSession(route.session) === route.worker; }
    catch { return false; }
  };
  const projected = createAsyncValue(() => ({ input: planInput() }), ({ input: captured }) => {
    pending?.abort(); pending = undefined;
    if (!captured) return undefined;
    if (captured.kind === "error") throw captured.error;
    if (!captured.owner.worker) return undefined;
    if (captured.owner.worker.kind === "error") throw captured.owner.worker.error;
    const controller = new AbortController(); pending = controller;
    return runPreparedReaderWorker(captured.owner.worker.worker,
      { method: "project-reader-field-plan", ...captured.captured }, controller.signal).then(reply => {
      controller.signal.throwIfAborted();
      if (latest(planInput) !== captured || !currentOwner(captured, true)) throw new Error("This field changed while its editor was preparing.");
      const result = (reply as { fieldPlan: FieldReaderPlan }).fieldPlan;
      if (!Object.hasOwn(reply, "fieldPlan") || !result?.plan?.editor || !Array.isArray(result.channels))
        throw new Error("This field's editor plan could not be read.");
      answered = { input: captured, result };
      return { input: captured, result };
    }).finally(() => { if (pending === controller) pending = undefined; });
  }, { holdTransitions: false });
  const synchronous = createMemo(() => {
    const captured = input();
    return captured?.kind === "request" && !captured.owner.worker ? { input: captured,
      result: fieldReaderPlan({ ...captured.captured, registry: captured.owner.registry, evaluateContext: captured.owner.context }) } : undefined;
  });
  const checked = () => {
    const captured = input();
    if (!captured || captured.kind === "error") return undefined;
    if (!captured.owner.worker) { const result = synchronous(); return result?.input === captured && currentOwner(captured) ? result : undefined; }
    const keyed = planInput();
    const result = projected.loading ? undefined : projected();
    if (!result || result.input !== keyed || !currentOwner(captured)) return undefined;
    // A reused answer is paired with the current data it was not asked about.
    return keyed === captured ? result : { input: captured, result: result.result };
  };
  let retained: ReturnType<typeof checked>;
  const paint = createMemo(() => {
    const captured = input();
    const result = checked();
    if (result) retained = result;
    if (!captured || !retained) return undefined;
    const previous = retained.input;
    const oldRoute = previous.owner.worker, route = captured.owner.worker;
    let sameOccurrence = false;
    if (previous.kind === "request" && captured.kind === "request"
      && previous.captured.fieldMode === captured.captured.fieldMode) {
      const left = previous.captured.field, right = captured.captured.field;
      const leftKey = readerFieldOccurrenceKey(left), rightKey = readerFieldOccurrenceKey(right);
      sameOccurrence = leftKey !== undefined || rightKey !== undefined ? leftKey !== undefined && leftKey === rightKey
        : previous.field === captured.field || retainTransientSlot && previous.captured.fieldMode === "transient" && !left.key && !right.key;
    }
    if (!(sameOccurrence && previous.owner.session === captured.owner.session
      && previous.owner.registry === captured.owner.registry && previous.owner.epoch === captured.owner.epoch
      && (oldRoute?.kind === "worker" ? route?.kind === "worker" && oldRoute.worker === route.worker : !route))) return undefined;
    return { result: retained.result,
      field: result ? result.input.field : previous.captured.field,
      value: result ? result.input.value : previous.captured.value };
  });
  return { input, paint, presentation: () => paint()?.result, ready: () => !!checked(),
    loading: () => !!input()?.owner.worker && projected.loading,
    error: () => { const captured = input(); return captured?.kind === "error" ? captured.error : captured?.owner.worker ? projected.error : undefined; },
    retry: () => projected.refetch(), guardElement };
}

/** The field's change callback for its current plan binding. A value typed
 * into this field's shown editor and published through a binding that is no
 * longer current, or whose plan is not ready, goes to the newest binding of
 * the SAME plan identity: same field occurrence, owner (session, registry,
 * worker), publish callback and plan request apart from the value itself. It
 * is published at once when that binding can publish, otherwise when its plan
 * is ready (the latest value wins; field-publish-gate.ts). Launch night,
 * Nov 13: a date part decoded by the Local worker after its plan had moved on
 * was dropped while the input still showed it. A value typed before any
 * editor was shown, or under another field, owner, callback or plan request
 * (a dependent type re-planned by its siblings), is still dropped. */
function createFieldChange(preparation: ReturnType<typeof createReaderFieldPlan>, onChange: () => (value: unknown) => void) {
  type Binding = { captured: ReturnType<typeof preparation.input>; occurrence: string | undefined;
    publish: (value: unknown) => void; callback: (value: unknown) => void };
  const gate = createFieldPublishGate<Binding>({
    current: () => latest(change),
    canPublish: (binding) => binding.captured !== undefined && latest(preparation.input) === binding.captured
      && !!latest(preparation.ready) && latest(change) === binding,
    sameField: (left, right) => {
      const a = left.captured, b = right.captured;
      if (a?.kind !== "request" || b?.kind !== "request" || left.publish !== right.publish) return false;
      const sameOccurrence = left.occurrence !== undefined || right.occurrence !== undefined
        ? left.occurrence === right.occurrence : a.field === b.field;
      if (!sameOccurrence || !sameFieldOwner(a, b)) return false;
      const key = planRequestKeyApartFromValue(a.captured as Record<string, unknown>);
      return key !== undefined && key === planRequestKeyApartFromValue(b.captured as Record<string, unknown>);
    },
    publish: (binding, value) => binding.publish(value),
  });
  const change = createMemo((): Binding => {
    const captured = preparation.input(), publish = onChange();
    const occurrence = captured?.kind === "request" ? readerFieldOccurrenceKey(captured.captured.field) : undefined;
    // Only data typed into a shown editor of this occurrence waits for its plan.
    const binding: Binding = { captured, occurrence, publish,
      callback: (value: unknown): void => { gate.send(binding, value, !!latest(preparation.paint)); } };
    return binding;
  });
  createEffect(() => ({ ready: preparation.ready(), binding: change() }), () => { gate.flush(); });
  return change;
}

/** B4 wave 4 lane E: an identified field's shown label for a Local reader,
 * from its worker's field plan (the same `presentation.label` the page's
 * `resolveIdentifiedFieldView` reads); the page registry is never read.
 * `undefined` while pending or refused (the caller shows the field's name). */
export function createLocalFieldLabel(field: () => FieldDef | undefined, registry: () => ModuleRegistry | undefined) {
  const reader = useReaderRuntime();
  const authoring = useAuthoringSession();
  const plan = createReaderFieldPlan(() => {
    const current = field();
    return current ? { field: current, fieldMode: "identified" as const, channelsEnabled: false } : undefined;
  }, registry, reader, authoring);
  return (): string | undefined => plan.presentation()?.plan.label;
}

/** Two captured field-plan inputs of one owner lifetime (session, registry,
 * exact worker route). */
function sameFieldOwner(left: { owner: { session: unknown; registry: unknown; worker?: unknown } } | undefined,
  right: typeof left): boolean {
  if (!left || !right) return false;
  const leftRoute = left.owner.worker as { kind?: string; worker?: unknown } | undefined;
  const rightRoute = right.owner.worker as { kind?: string; worker?: unknown } | undefined;
  return left.owner.session === right.owner.session && left.owner.registry === right.owner.registry
    && (leftRoute?.kind === "worker" ? rightRoute?.kind === "worker" && leftRoute.worker === rightRoute.worker : !rightRoute);
}

/** Two plan owners are the same lifetime: session, registry, epoch, revision
 * and exact worker route (the fields `currentOwner` checks). */
function samePlanOwner(left: { session: unknown; registry: unknown; worker?: unknown; epoch: unknown; revision: unknown },
  right: typeof left): boolean {
  const leftRoute = left.worker as { kind?: string; worker?: unknown } | undefined;
  const rightRoute = right.worker as { kind?: string; worker?: unknown } | undefined;
  return left.session === right.session && left.registry === right.registry && left.epoch === right.epoch
    && left.revision === right.revision && leftRoute?.kind === "worker" && rightRoute?.kind === "worker"
    && leftRoute.worker === rightRoute.worker;
}

/** Which typed data an answered field plan read. The engine reads the field's
 * value only for a list editor's canonical choices (field-render-plan.fenel,
 * fieldCompositePlan's FtList branch; field-render.ts fieldListMembership),
 * and the record's sibling values only through `$el` dependent types (peelEl,
 * resolveDependentType). plan-data-reads.test.mjs pins both reads. */
function planReadsData(result: FieldReaderPlan, field: unknown): { value: boolean; recordValues: boolean } {
  return { value: result.plan.editor.kind === "list", recordValues: containsDependentType(field) };
}

function containsDependentType(value: unknown): boolean {
  if (!value || typeof value !== "object") return false;
  if (Array.isArray(value)) return value.some(containsDependentType);
  return Object.hasOwn(value, "$el") || Object.values(value).some(containsDependentType);
}

/** The same worker request apart from data the answered plan does not read. */
/** A field plan request apart from the field's own value (the data a typed
 * edit changes); undefined when it cannot be read as plain data. */
function planRequestKeyApartFromValue(request: Record<string, unknown>): string | undefined {
  try { return JSON.stringify({ ...request, value: undefined }); } catch { return undefined; }
}

function samePlanRequest(previous: Record<string, unknown>, next: Record<string, unknown>, result: FieldReaderPlan): boolean {
  const reads = planReadsData(result, next.field);
  const key = (request: Record<string, unknown>) => JSON.stringify({ ...request,
    value: reads.value ? request.value : undefined, recordValues: reads.recordValues ? request.recordValues : undefined });
  try { return key(previous) === key(next); } catch { return false; }
}

/** Shared label row — name, optional required marker, type badge, help text.
 *  Single source of truth for "how a field's label should look". Accepts
 *  either a FieldDef (which it derives all four pieces from) or explicit
 *  name/typeName/required/helpText props for callers that don't have a
 *  FieldDef in hand (e.g., ExpressionEditor's top-level NodeEditor).
 *
 *  For `$arrow` field types, a small "Function" kind chip is rendered
 *  above the type-signature badge so the user gets both the category
 *  (function) and the precise signature. Other type kinds stay
 *  single-badge. */
export function FieldLabel(props: {
  id?: string;
  registry?: ModuleRegistry;
  field?: FieldDef;
  plan?: FieldEditPlan;
  name?: string;
  typeName?: string;
  required?: boolean;
  helpText?: string;
  typePresentation?: "badge" | "data";
  typeIcon?: string;
}) {
  // Read the surrounding record's values so `$el`-typed fields can show
  // the *resolved* type in the chip — e.g. "User" instead of "<type>" —
  // once the user picks a value for the referenced sibling.
  const recordValues = useContext(RecordValuesContext);
  const inheritedRegistry = useFieldPresentationRegistry();
  const registry = () => props.registry ?? inheritedRegistry();
  const reader = useReaderRuntime();
  const authoring = useAuthoringSession();
  const preparation = createReaderFieldPlan(() => props.plan || !props.field ? undefined : {
    field: props.field, recordValues: recordValues(), fieldMode: registry() ? "identified" : "transient", channelsEnabled: false,
  }, registry, reader, authoring);
  const plan = createMemo(() => props.plan ?? preparation.presentation()?.plan);

  const name = createMemo(() =>
    props.name ?? plan()?.label ?? props.field?.name,
  );
  // A plain form (New data's simple lens) names fields only: no type pills.
  const plainFields = useContext(PlainFieldsContext);
  const typeName = createMemo(() =>
    plainFields ? undefined : props.typeName ?? plan()?.typeLabel,
  );
  const required = createMemo(() =>
    props.required ?? plan()?.required ?? false,
  );
  const helpText = createMemo(() => {
    if (props.helpText) return props.helpText;
    return plan()?.helpText;
  });
  // Detect the function "kind" — for $arrow types we render an extra chip
  // above the signature. Uses the resolved type so `$el`→arrow shows
  // the Function chip too.
  const isArrow = createMemo(() => {
    return plan()?.editor.kind === "arrow";
  });

  return (
    <><FieldLabelSurface
      id={props.id}
      name={name()}
      typeName={typeName()}
      required={required()}
      helpText={helpText()}
      isArrow={isArrow()}
      typePresentation={props.typePresentation}
      typeIcon={props.typeIcon}
    /><Show when={!props.plan && props.field && !preparation.ready()}>
      <span class="text-muted" role={preparation.error() ? "alert" : "status"}>
        {preparation.error() ? "This field's details are unavailable." : "Preparing field details…"}
      </span>
    </Show></>
  );
}

/** The plan's authored example of a complete value (a text editor's
 *  placeholder), for the field's hints. Display only. */
function fieldExample(editor: object): string | undefined {
  const placeholder = (editor as { placeholder?: unknown }).placeholder;
  return typeof placeholder === "string" && placeholder.trim() ? placeholder : undefined;
}

/** A concealed input (a password box): its text is never shown again elsewhere. */
function fieldConceals(editor: object): boolean {
  return (editor as { inputType?: unknown }).inputType === "password";
}

/** Internal renderer. The public wrapper below establishes the resolved
 * registry as context so identified record/variant descendants cannot
 * silently fall back to transient declaration rendering. */
function FieldRendererBody(props: FieldRendererProps) {
  const labelId = createUniqueId();
  const recordValues = useContext(RecordValuesContext);
  const inheritedRegistry = useFieldPresentationRegistry();
  const registry = () => props.registry ?? inheritedRegistry();
  const reader = useReaderRuntime();
  const authoring = useAuthoringSession();
  const channelOwner = createMemo(() => {
    const session = reader?.session() ?? authoring;
    const activeRegistry = registry();
    const route = localFieldSelectionWorker(reader, session, activeRegistry);
    const field = props.field;
    let fieldKey: string | undefined;
    try {
      fieldKey = readerFieldOccurrenceKey(registryTransportSnapshot(field, "field channel occurrence", "equality", Reflect.get));
    }
    catch { /* The plan owner reports descriptor refusal; channel capture reads no getters. */ }
    return { field, fieldKey, session, registry: activeRegistry, worker: route?.kind === "worker" ? route.worker : undefined };
  });
  const [channelIntent, setChannelIntent] = createSignal<{ owner: ReturnType<typeof channelOwner>; id: string }>();
  const channelId = () => {
    const selected = channelIntent(), current = channelOwner();
    const sameField = selected && (selected.owner.fieldKey !== undefined || current.fieldKey !== undefined
      ? selected.owner.fieldKey !== undefined && selected.owner.fieldKey === current.fieldKey : selected.owner.field === current.field);
    return selected && sameField && selected.owner.session === current.session
      && selected.owner.registry === current.registry && selected.owner.worker === current.worker ? selected.id : undefined;
  };
  const preparation = createReaderFieldPlan(() => ({ field: props.field, value: props.value, recordValues: recordValues(),
    fieldMode: registry() ? "identified" : "transient", channelsEnabled: true,
    ...(channelId() === undefined ? {} : { channelId: channelId() }) }), registry, reader, authoring);
  const change = createFieldChange(preparation, () => props.onChange);
  // When wrapped in expression context, the wrapper renders the label
  // (so the [label, toggle, editor] order is the same as at top-level).
  // Suppress the internal label to avoid double rendering.
  const exprCtx = useContext(ExprFieldContext);
  const showInternalLabel = createMemo(() => !props.compact && !exprCtx);
  // Demo 10: the membership judgment's live hints for the field's expected type (latest value only).
  const hints = createMembershipHints(() => { const p = preparation.paint(); return p ? fieldHintSet(p.result.plan.editor) : undefined; },
    () => props.value, { worker: localFieldSelectionWorker, frame: pageFieldFrame });

  // Display-only registration; nested fields do not inherit this occurrence.
  // A held plan or a disposed field supplies no answer to an enclosing label.
  onSettled(() => {
    let active = true;
    const release = props.observeMembershipHints?.({ type: () => props.field.type, value: () => props.value,
      hints: () => active && preparation.ready() ? hints() : undefined });
    return () => { active = false; release?.(); };
  });

  return (
    <div class={["fr-field", { "fr-field--compact": !!(props.compact || !!exprCtx) }]} data-tooltip-focus-host=""
      data-field-group={preparation.paint()?.result.plan.editor.kind === "record" ? "" : undefined}
      data-field-plan-state={preparation.ready() ? "ready" : preparation.error() ? "unavailable" : "pending"}>
      <Show when={preparation.paint()}>{prepared => <>
      <Show when={showInternalLabel()}><FieldLabel id={labelId}
        field={prepared().field} plan={prepared().result.plan} /></Show>
      <div class="fr-field__control" ref={preparation.guardElement} style={{ display: "contents" }} aria-disabled={preparation.ready() ? "false" : "true"}
        aria-busy={preparation.loading() ? "true" : "false"}>
      {/* Channel switcher — only shown when multiple channels exist */}
      <Show when={prepared().result.channels.length > 1}>
        <div class="fr-channel-switcher">
          <For each={prepared().result.channels}>
            {(ch) => (
              <button

                class={["fr-channel-tab", { "fr-channel-tab--active": ch.id === prepared().result.activeChannelId }]}
                aria-label={ch.name}
                onClick={() => { if (latest(preparation.ready)) setChannelIntent({ owner: latest(channelOwner), id: ch.id }); }}
                type="button"
                data-tooltip={ch.name}
              >
                <Show when={ch.icon} fallback={ch.name}>
                  <ChannelIcon icon={ch.icon!} />
                </Show>
              </button>
            )}
          </For>
        </div>
      </Show>
      <div class="fr-field__editor">
      <FieldHintsContext value={hints}>
      <ChannelEditor
        field={prepared().field}
        plan={prepared().result.plan}
        type={prepared().result.plan.editor.rawType}
        value={prepared().value}
        onChange={change().callback}
        labelId={showInternalLabel() ? labelId : undefined}
        autocomplete={props.autocomplete}
      />
      </FieldHintsContext>
      {/* One presentation wherever a field's type has rules: the status icon, its rules in the tooltip. */}
      <MembershipHintsView hints={hints()} pending={hints.pending()} compact
        empty={props.value === undefined || props.value === null || props.value === ""}
        example={fieldExample(prepared().result.plan.editor)}
        text={typeof props.value === "string" && !fieldConceals(prepared().result.plan.editor) ? props.value : undefined} />
      </div>
      </div></>}</Show>
      <Show when={!preparation.ready()}><span class="text-muted" role={preparation.error() ? "alert" : "status"}>
        {preparation.error() ? "This field's editor is unavailable." : "Preparing field…"}
      </span><Show when={preparation.error()}><button type="button" class="expr-form__btn"
        onClick={() => { void preparation.retry(); }}>Retry</button></Show></Show>
    </div>
  );
}

/** Render an editor for a single FieldDef. A registry supplied at any product
 * boundary is inherited by every nested FieldRenderer spawned by structural
 * editors; callers do not need to thread it through record/variant recursion.
 * The callable registry is inherited the same way, and it sits outside the
 * identity fence, so a transient subtree still names the caller's functions. */
export function FieldRenderer(props: FieldRendererProps) {
  const inheritedRegistry = useFieldPresentationRegistry();
  const inheritedCallables = useContext(CallableRegistryContext);
  const transient = () => props.identityMode === "transient";
  const registry = () => transient()
    ? undefined
    : props.registry ?? inheritedRegistry();
  return (
    <CallableRegistryContext value={() => props.callableRegistry ?? inheritedCallables()}>
      <Show when={!transient()} fallback={
        <FieldPresentationRegistryProvider registry={undefined}>
          <FieldRendererBody {...props} registry={undefined} />
        </FieldPresentationRegistryProvider>
      }>
        <Show
          when={registry()}
          fallback={<FieldRendererBody {...props} registry={undefined} />}
        >
          {(activeRegistry) => (
            <FieldPresentationRegistryProvider registry={activeRegistry()}>
              <FieldRendererBody {...props} registry={activeRegistry()} />
            </FieldPresentationRegistryProvider>
          )}
        </Show>
      </Show>
    </CallableRegistryContext>
  );
}

export type ReaderRecordSlotsInput = {
  value: unknown;
  fields: readonly string[];
  representationTypeName?: string;
};

/** A2/B3 record observation and edit lifetime. Physical slot interpretation
 * stays in the existing source owners; the captured coordinate is UI data only. */
export function createReaderRecordOperations<T = undefined>(request: () => ReaderRecordSlotsInput | undefined,
  options: { evaluateContext?: () => AuthoringSession["evaluateContext"] | undefined; coordinate?: () => T;
    publication?: () => object } = {}) {
  const registry = useFieldPresentationRegistry();
  const reader = useReaderRuntime();
  const authoring = useAuthoringSession();
  const requested = createMemo(request);
  const owner = createMemo(() => {
    const args = requested();
    if (!args) return undefined;
    const session = reader?.session() ?? authoring, activeRegistry = registry();
    const suppliedContext = options.evaluateContext?.();
    // B4 F1: a Local reader supplies no page frame for its own record (its
    // editors pass none), so any supplied frame is a custom one; the page
    // session's frame is never read to compare.
    const customFrame = suppliedContext !== undefined && args.representationTypeName === undefined
      && (reader?.kind === "local" || suppliedContext !== session.evaluateContext);
    const worker = customFrame ? undefined : localFieldSelectionWorker(reader, session, activeRegistry);
    const context = worker ? undefined : suppliedContext ?? pageFieldFrame(reader, session, activeRegistry);
    return { session, registry: activeRegistry, worker, context, suppliedContext,
      epoch: sessionEpoch(), revision: worker ? reader?.revision() : undefined };
  });
  const input = createMemo(() => {
    const args = requested();
    if (!args) return undefined;
    const capturedOwner = owner()!, coordinate = options.coordinate?.();
    try {
      const captured = registryTransportSnapshot({ request: args, coordinate }, "reader record input", "equality", Reflect.get);
      return { kind: "request" as const, request: args, coordinate, captured, owner: capturedOwner };
    } catch (error) { return { kind: "error" as const, error, owner: capturedOwner }; }
  });
  let alive = true, pending: AbortController | undefined;
  type Captured = NonNullable<ReturnType<typeof input>>;
  type Observation = { input: Extract<Captured, { kind: "request" }>; recordSlots: FieldRecordSlotEntry[] };
  let editFlight: { input: Captured; controller: AbortController; publication: object | undefined } | undefined;
  const [editing, setEditing] = createSignal<{ input: Captured; controller: AbortController; publication: object | undefined }>();
  const [editError, setEditError] = createSignal<{ input: Captured; publication: object | undefined; message: string }>();
  onSettled(() => () => { alive = false; pending?.abort(); editFlight?.controller.abort(); });
  const currentOwner = (captured: Captured, fresh = false) => {
    if (!alive || sessionEpoch() !== captured.owner.epoch) return false;
    const current = fresh ? latest(owner) : owner();
    if (!current || current.session !== captured.owner.session || current.registry !== captured.owner.registry
      || current.context !== captured.owner.context || current.suppliedContext !== captured.owner.suppliedContext
      || current.revision !== captured.owner.revision) return false;
    const route = captured.owner.worker;
    try { return !route || route.kind === "worker" && current.worker?.kind === "worker"
      && current.worker.worker === route.worker && preparedReaderWorkerForSession(route.session) === route.worker; }
    catch { return false; }
  };
  const projected = createAsyncValue(() => ({ input: input() }), ({ input: captured }) => {
    pending?.abort(); pending = undefined;
    if (editFlight && editFlight.input !== captured) { editFlight.controller.abort(); editFlight = undefined; }
    if (!captured) return undefined;
    if (captured.kind === "error") throw captured.error;
    if (!captured.owner.worker) return undefined;
    if (captured.owner.worker.kind === "error") throw captured.owner.worker.error;
    const controller = new AbortController(); pending = controller;
    return runPreparedReaderWorker(captured.owner.worker.worker,
      { method: "project-reader-record-slots", ...captured.captured.request }, controller.signal).then(reply => {
      controller.signal.throwIfAborted();
      if (latest(input) !== captured || !currentOwner(captured, true)) throw new Error("This record changed while its fields were preparing.");
      const recordSlots = (reply as { recordSlots: FieldRecordSlotEntry[] }).recordSlots;
      if (!Object.hasOwn(reply, "recordSlots") || !Array.isArray(recordSlots)
        || recordSlots.length !== captured.captured.request.fields.length
        || recordSlots.some((entry, index) => entry.field !== captured.captured.request.fields[index]
          || !entry.slot || !["Ok", "Err"].includes(entry.slot.$tag)))
        throw new Error("This record's fields could not be read.");
      return { input: captured, recordSlots };
    }).finally(() => { if (pending === controller) pending = undefined; });
  }, { holdTransitions: false });
  const synchronous = createMemo<Observation | { input: Observation["input"]; error: unknown } | undefined>(() => {
    const captured = input();
    if (captured?.kind !== "request" || captured.owner.worker) return undefined;
    try { return { input: captured,
      recordSlots: fieldRecordSlotsPlan(captured.captured.request.value, captured.captured.request.fields, captured.owner.context) }; }
    catch (error) { return { input: captured, error }; }
  });
  const checked = () => {
    const captured = input();
    if (!captured || captured.kind === "error") return undefined;
    const result = captured.owner.worker ? projected.loading ? undefined : projected() : synchronous();
    return result?.input === captured && "recordSlots" in result && currentOwner(captured) ? result : undefined;
  };
  let retained: ReturnType<typeof checked>;
  const paint = createMemo(() => {
    const captured = input(), result = checked();
    if (result) retained = result;
    if (!captured || captured.kind === "error" || !retained) return undefined;
    const previous = retained.input, route = captured.owner.worker, oldRoute = previous.owner.worker;
    if (previous.owner.session !== captured.owner.session || previous.owner.registry !== captured.owner.registry
      || previous.owner.epoch !== captured.owner.epoch || previous.owner.context !== captured.owner.context
      || previous.owner.suppliedContext !== captured.owner.suppliedContext
      || (oldRoute?.kind === "worker" ? route?.kind !== "worker" || oldRoute.worker !== route.worker : !!route)) return undefined;
    return { recordSlots: retained.recordSlots,
      value: result ? result.input.request.value : previous.captured.request.value,
      coordinate: result ? result.input.coordinate : previous.captured.coordinate };
  });
  const busy = () => { const flight = editing(); return !!flight && flight.input === input() && flight.publication === options.publication?.(); };
  const ready = () => !!checked() && !busy();
  // Native text edits pass while this record's fields are painted for the same
  // occurrence; their values are queued below rather than dropped.
  const guardElement = createReaderInteractionGuard(ready, () => !!paint());
  // A typed field value never waits on, nor is dropped by, the single edit
  // flight (demo 1, 2026-11-08: CalendarDate parts typed key by key). While an
  // edit runs or the record re-reads, the newest edited data per field of this
  // same occurrence and publication is kept, and sent in order once ready.
  let queued: { occurrence: Captured; publication: object; edits: Map<string, unknown> } | undefined;
  const sameRecordOccurrence = (left: Captured, right: Captured) => left.kind === "request" && right.kind === "request"
    && left.owner.session === right.owner.session && left.owner.registry === right.owner.registry
    && left.owner.context === right.owner.context && left.owner.suppliedContext === right.owner.suppliedContext
    && left.owner.epoch === right.owner.epoch
    && (left.owner.worker?.kind === "worker" ? right.owner.worker?.kind === "worker" && left.owner.worker.worker === right.owner.worker.worker : !right.owner.worker)
    && JSON.stringify([left.captured.coordinate, left.captured.request.fields, left.captured.request.representationTypeName])
      === JSON.stringify([right.captured.coordinate, right.captured.request.fields, right.captured.request.representationTypeName]);
  const enqueue = (captured: Captured, publication: object | undefined, field: string, edited: unknown): boolean => {
    if (!publication || captured.kind !== "request") return false;
    if (!queued || queued.publication !== publication || !sameRecordOccurrence(queued.occurrence, captured))
      queued = { occurrence: captured, publication, edits: new Map() };
    queued.edits.delete(field); queued.edits.set(field, edited);
    return true;
  };
  const replay = () => {
    const pendingEdits = queued;
    if (!pendingEdits || !alive) return;
    const captured = latest(input), publication = options.publication ? latest(options.publication) : undefined;
    if (!captured || publication !== pendingEdits.publication || !sameRecordOccurrence(pendingEdits.occurrence, captured)) { queued = undefined; return; }
    const next = pendingEdits.edits.entries().next();
    if (next.done) { queued = undefined; return; }
    const [field, edited] = next.value;
    pendingEdits.edits.delete(field);
    if (!pendingEdits.edits.size) queued = undefined;
    const lease = pendingEdits.publication as { callback: (value: unknown) => void };
    edit(field, edited, result => { if (options.publication && latest(options.publication) === lease) lease.callback(result); });
  };
  createEffect(() => ready(), isReady => { if (isReady && queued) replay(); });
  const edit = (field: string, edited: unknown, publish: (value: unknown) => void): void => {
    const captured = latest(input), receipt = latest(checked);
    const publication = options.publication ? latest(options.publication) : undefined;
    if (editFlight && (editFlight.input !== captured || editFlight.publication !== publication || editFlight.controller.signal.aborted)) {
      editFlight.controller.abort(); editFlight = undefined;
    }
    if (!captured || captured.kind === "error") return;
    if (!receipt || receipt.input !== captured || editFlight) {
      // Only data typed into the occurrence the reader sees waits; a gesture
      // made before a worker, session, field-list or UI-path change is refused.
      const shown = retained?.input;
      if (!shown || !sameRecordOccurrence(shown, captured)) return;
      let copied: unknown;
      try { copied = registryTransportSnapshot(edited, "reader record edit", "equality", Reflect.get); }
      catch (error) { setEditError({ input: captured, publication, message: error instanceof Error ? error.message : String(error) }); return; }
      enqueue(captured, publication, field, copied);
      return;
    }
    const selected = receipt.recordSlots.find(entry => entry.field === field);
    if (!selected || selected.slot.$tag === "Err") {
      setEditError({ input: captured, publication, message: selected?.slot.$tag === "Err" ? selected.slot._0 : "This record field is unavailable." });
      return;
    }
    const controller = new AbortController(), flight = { input: captured, controller, publication };
    const current = () => alive && !controller.signal.aborted && latest(input) === captured && latest(checked) === receipt
      && (!options.publication || latest(options.publication) === publication) && currentOwner(captured, true);
    const complete = (result: FieldRecordResult<unknown>) => {
      if (!current()) {
        const now = latest(input);
        if (alive && !controller.signal.aborted && now && publication && latest(options.publication!) === publication
          && sameRecordOccurrence(captured, now) && !queued?.edits.has(field)) {
          let copied: unknown;
          try { copied = registryTransportSnapshot(edited, "reader record edit", "equality", Reflect.get); } catch { return; }
          enqueue(now, publication, field, copied);
          if (latest(ready)) replay();
        }
        return;
      }
      if (result?.$tag === "Err") { setEditError({ input: captured, publication, message: result._0 }); return; }
      if (result?.$tag !== "Ok" || !Object.hasOwn(result, "_0")) throw new Error("This record change could not be read.");
      setEditError(undefined); publish(result._0);
    };
    const failed = (error: unknown) => {
      if (current()) setEditError({ input: captured, publication, message: error instanceof Error ? error.message : "This record cannot accept the edited data." });
    };
    try {
      const value = registryTransportSnapshot(edited, "reader record edit", "equality", Reflect.get);
      if (!current()) return;
      setEditError(undefined);
      if (!captured.owner.worker) {
        complete(fieldRecordEditPlan(captured.captured.request.value, field, value, captured.owner.context));
        return;
      }
      if (captured.owner.worker.kind === "error") throw captured.owner.worker.error;
      editFlight = flight; setEditing(flight);
      void runPreparedReaderWorker(captured.owner.worker.worker, { method: "edit-reader-record-field",
        value: captured.captured.request.value, field, edited: value,
        ...(captured.captured.request.representationTypeName === undefined ? {} : { representationTypeName: captured.captured.request.representationTypeName }),
      }, controller.signal).then(reply => {
        if (!Object.hasOwn(reply, "edit")) throw new Error("This record change could not be read.");
        complete((reply as { edit: FieldRecordResult<unknown> }).edit);
      }).catch(failed).finally(() => {
        if (editFlight === flight) { editFlight = undefined; if (alive) setEditing(undefined); }
      });
    } catch (error) { failed(error); }
  };
  return { input, paint, ready, guardElement, edit,
    loading: () => !!input()?.owner.worker && projected.loading || busy(),
    error: () => {
      const captured = input();
      if (captured?.kind === "error") return captured.error;
      const failure = editError();
      if (failure?.input === captured && failure?.publication === options.publication?.()) return failure?.message;
      if (captured?.owner.worker) return projected.error;
      const result = synchronous(); return result && "error" in result ? result.error : undefined;
    },
    retry: () => projected.refetch() };
}

/** Tiny icon resolver for channel tabs */
function ChannelIcon(props: { icon: string }) {
  const ICONS: Record<string, string> = {
    keyboard: "type",
    map: "globe",
    location: "map-pin",
    calendar: "calendar",
    contacts: "user",
    palette: "palette",
    camera: "image",
    mic: "message-circle",
  };
  return <span class="fr-channel-icon" aria-hidden="true"><IconByName name={ICONS[props.icon] ?? props.icon} size={14} /></span>;
}

/** Render editors for a list of FieldDefs (a form/param section) */
export function FieldListRenderer(props: {
  registry?: ModuleRegistry;
  fields: FieldDef[];
  values: Record<string, unknown>;
  onChange: (id: string, value: unknown) => void;
}) {
  return (
    <div class="fr-field-list">
      <For each={props.fields}>
        {(field) => (
          <FieldRenderer
            registry={props.registry}
            field={field}
            value={props.values[field.name]}
            onChange={(v) => props.onChange(field.name, v)}
          />
        )}
      </For>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Type-level editor — dispatches based on the FenelType structure
// ---------------------------------------------------------------------------

type ChannelEditorProps = {
  field?: FieldDef;
  plan: FieldEditPlan;
  type: FenelType;
  value: unknown;
  onChange: (value: unknown) => void;
  labelId?: string;
  autocomplete?: FieldRendererProps["autocomplete"];
};

/** Select the prepared host service only for this Local reader's field owner.
 * B4 F1: the reader's own field registry is recognised by identity with the
 * reader's snapshot (`reader.registry()`), never by reading its page session;
 * nothing is called on either. A foreign registry keeps its own page route. */
function localFieldSelectionWorker(reader: ReturnType<typeof useReaderRuntime>, session: AuthoringSession,
  registry: ModuleRegistry | undefined) {
  if (reader?.kind !== "local") return undefined;
  try {
    if (registry && registry !== reader.registry()) {
      // A Local snapshot's registry that is no longer this reader's (a
      // superseded snapshot captured earlier) never evaluates on the page.
      if (registryHasSnapshotOwner(registry)) throw new Error(LOCAL_SNAPSHOT_REPLACED);
      return undefined;
    }
    const worker = preparedReaderWorkerForSession(session);
    if (!worker) throw new Error("This reader's editing tools are not ready.");
    return { kind: "worker" as const, session, registry, worker };
  } catch (error) { return { kind: "error" as const, session, registry, error }; }
}

const LOCAL_SNAPSHOT_REPLACED = "This authoring snapshot was replaced. Retry with the current data.";

/** The page frame of a field owner that has no worker route: a standalone
 * control's registry, a foreign registry's own frame, or this (Account or
 * public) reader's session. A Local reader reaches this only with a foreign
 * registry, whose frame it uses; it never reads its page session's frame. */
function pageFieldFrame(reader: ReturnType<typeof useReaderRuntime>, session: AuthoringSession,
  registry: ModuleRegistry | undefined): AuthoringSession["evaluateContext"] {
  if (session === DETACHED_AUTHORING_SESSION) return registry?.evaluateContext() ?? {};
  if (reader?.kind === "local") {
    if (!registry) throw new Error("This reader's editing tools are not ready.");
    return registry.evaluateContext();
  }
  return registry && registry !== session.registry ? registry.evaluateContext() : session.evaluateContext;
}

/** Adapts the Fenel-owned edit plan to browser/editor leaves. */
function ChannelEditor(props: ChannelEditorProps) {
  const editor = createMemo(() => props.plan.editor);
  const publication = createMemo(() => ({ callback: props.onChange }));
  const expressionPublication = createMemo(() => {
    const publish = publication().callback;
    return (expression: Record<string, unknown> | undefined) => publish(expression ?? {});
  });
  const listRegistry = useFieldPresentationRegistry();
  const listReader = useReaderRuntime();
  const listAuthoring = useAuthoringSession();
  const [listChipError, setListChipError] = createSignal<string>();
  const [listChipPending, setListChipPending] = createSignal(false);
  let listGesturePending = false;
  let listAlive = true;
  const listWorker = createMemo(() => localFieldSelectionWorker(listReader, listReader?.session() ?? listAuthoring, listRegistry()));
  const listContext = () => pageFieldFrame(listReader, listReader?.session() ?? listAuthoring, listRegistry());
  const listChipInput = createMemo(() => {
    const plan = editor();
    return plan.kind === "list" && plan.choices
      ? { plan, options: plan.choices, value: props.value, type: props.type, field: props.field, owner: listWorker() }
      : undefined;
  });
  let listSelectionRequest: AbortController | undefined;
  let listGesture: { input: ReturnType<typeof listChipInput>; controller: AbortController } | undefined;
  onSettled(() => () => { listAlive = false; listSelectionRequest?.abort(); listGesture?.controller.abort(); });
  const projectedListSelection = createAsyncValue(() => ({ input: listChipInput() }), ({ input }) => {
    listSelectionRequest?.abort(); listSelectionRequest = undefined;
    if (listGesture && listGesture.input !== input) listGesture.controller.abort();
    if (!input?.owner) return undefined;
    if (input.owner.kind === "error") throw input.owner.error;
    const controller = new AbortController(); listSelectionRequest = controller;
    return runPreparedReaderWorker(input.owner.worker,
      { method: "project-reader-list-selection", options: input.options, value: input.value }, controller.signal)
      .then(reply => {
        controller.signal.throwIfAborted();
        const result = reply as { selection: ReturnType<typeof fieldListChipsSelectionPlan> };
        if (!Object.hasOwn(reply, "selection") || !Array.isArray(result.selection?.occurrences) || !Array.isArray(result.selection?.selected))
          throw new Error("This list selection could not be read.");
        return { input, selection: result.selection };
      }).finally(() => { if (listSelectionRequest === controller) listSelectionRequest = undefined; });
  }, { holdTransitions: false });
  const synchronousListSelection = createMemo(() => {
    const input = listChipInput();
    return input && !input.owner ? fieldListChipsSelectionPlan(input.options, input.value, listContext()) : undefined;
  });
  const listChipSelection = () => {
    const input = listChipInput();
    if (!input) return { occurrences: [], selected: [] };
    if (!input.owner) return synchronousListSelection();
    const result = projectedListSelection();
    return !projectedListSelection.loading && result?.input === input ? result.selection : undefined;
  };
  const listChipReady = () => !listChipInput()?.owner || !!listChipSelection();
  const editListChips = async (action: FieldListChipsAction) => {
    if (!listAlive || listGesturePending || listSelectionRequest) return;
    const input = latest(listChipInput);
    if (!input || (input.owner && !latest(listChipSelection))) return;
    const lease = latest(publication), publish = lease.callback;
    const current = () => listAlive && latest(listChipInput) === input && latest(publication) === lease;
    try {
      const session = input.owner?.session ?? latest(() => listReader?.session() ?? listAuthoring);
      const ownerType = input.field && refHandle(input.field.type) ? input.field.type : undefined;
      let changed: ReturnType<typeof fieldListChipsEditPlan>;
      if (input.owner) {
        if (input.owner.kind === "error") throw input.owner.error;
        const controller = new AbortController(); listGesture = { input, controller };
        listGesturePending = true; setListChipPending(true);
        const reply = await runPreparedReaderWorker(input.owner.worker, { method: "edit-reader-list-chips",
          type: input.plan.rawType, value: input.value, action, declarationType: ownerType }, controller.signal);
        controller.signal.throwIfAborted();
        if (!current() || preparedReaderWorkerForSession(input.owner.session) !== input.owner.worker) return;
        if (!Object.hasOwn(reply, "edit")) throw new Error("This list change could not be checked.");
        changed = (reply as { edit: ReturnType<typeof fieldListChipsEditPlan> }).edit;
      } else changed = fieldListChipsEditPlan(input.plan.rawType, input.value, action, listContext(),
        listRegistry() ?? (session === DETACHED_AUTHORING_SESSION ? undefined : session.registry), ownerType);
      if (!current()) return;
      if (changed?.$tag !== "Ok" || !Array.isArray(changed._0)) {
        setListChipError(changed?.$tag === "Err" ? changed._0 : "This list change could not be checked.");
        return;
      }
      setListChipError(undefined);
      publish(changed._0);
    } catch (problem) {
      if (current()) setListChipError(problem instanceof Error ? problem.message : "This list change could not be checked.");
    } finally {
      listGesture = undefined; listGesturePending = false;
      if (listAlive) setListChipPending(false);
    }
  };
  const ctxParams = useParams();
  const paramsFromContext = () => (ctxParams.length > 0 ? ctxParams : undefined);
  const exprCtx = useContext(ExprFieldContext);
  const [showStructure, setShowStructure] = createSignal(false);
  const plainFields = useContext(PlainFieldsContext);
  const nativeName = () => {
    const plan = editor();
    if (plan.kind === "text" && plan.inputType === "password") return undefined;
    return plan.kind === "list" ? "List" : nativeValueTypeName(props.type);
  };
  const structuralValue = () => showStructure() || props.value !== undefined && !!nativeName()
    && !isNativeValueRepresentation(nativeName(), props.value);

  return (
    <>
      <Show when={nativeName() && !plainFields}>
        <button type="button" class="vve-btn-add" data-structure-toggle onClick={() => setShowStructure(!showStructure())}>{showStructure() ? "Default editor" : "Value representations"}</button>
      </Show>
      <Show when={!structuralValue()} fallback={<VariantValueEditor type={props.type} value={props.value} onChange={props.onChange} />}>
      <Show when={editor().kind === "locale-string"}>
        <LocaleStringEditor value={props.value as LocaleString | undefined} onChange={props.onChange} />
      </Show>
      <Show when={editor().kind === "custom" && (editor() as Extract<FieldEditorPlan, { kind: "custom" }>).leaf === "address-autocomplete"}>
        <AddressAutocomplete
          value={props.value}
          onChange={props.onChange}
          labelId={props.labelId}
          placeholder={(editor() as Extract<FieldEditorPlan, { kind: "custom" }>).placeholder}
          config={(editor() as Extract<FieldEditorPlan, { kind: "custom" }>).channel as TextChannel}
        />
      </Show>

      <Show when={editor().kind === "expression" && (editor() as Extract<FieldEditorPlan, { kind: "expression" }>).leaf === "terms"}>
        <TermsEditor
          value={props.value as Record<string, unknown> | undefined}
          onChange={expressionPublication()}
        />
      </Show>

      <Show when={editor().kind === "expression" && (editor() as Extract<FieldEditorPlan, { kind: "expression" }>).leaf !== "terms"}>
        <ExpressionEditor
          value={props.value as Record<string, unknown> | undefined}
          onChange={expressionPublication()}
          label={undefined}
        />
      </Show>

      <Show when={editor().kind === "markup" && (editor() as Extract<FieldEditorPlan, { kind: "markup" }>).expression}>
        <MarkupExprEditor
          value={(props.value ?? { call: ["element", "div", [], []] }) as any}
          onChange={publication().callback}
          params={paramsFromContext()}
          targetSubset={targetSubsetFromSet((editor() as Extract<FieldEditorPlan, { kind: "markup" }>).set)}
        />
      </Show>

      <Show when={editor().kind === "string-expression"}>
        <StringExprEditor
          value={props.value as any}
          onChange={publication().callback}
          params={paramsFromContext()}
          placeholder={(editor() as Extract<FieldEditorPlan, { kind: "string-expression" }>).placeholder}
        />
      </Show>

      <Show when={editor().kind === "type"}>
        <TypeBuilder
          value={props.value as FenelType | null | undefined}
          onChange={props.onChange}
        />
      </Show>

      <Show when={editor().kind === "select"}>
        <SelectEditor
          type={props.type}
          options={(editor() as Extract<FieldEditorPlan, { kind: "select" }>).options}
          value={props.value}
          onChange={props.onChange}
          radio={(editor() as Extract<FieldEditorPlan, { kind: "select" }>).radio}
        />
      </Show>

      <Show when={editor().kind === "text"}>
        <StringEditor
          plan={editor() as Extract<FieldEditorPlan, { kind: "text" }>}
          name={props.field?.name}
          labelId={props.labelId}
          autocomplete={props.autocomplete}
          required={props.plan.required}
          value={props.value}
          onChange={props.onChange}
          onBlur={() => {
            if (typeof props.value !== "string" || props.value === "") return;
            const result = parseInput(props.value, props.type);
            if (result.ok && result.value !== props.value) props.onChange(result.value);
          }}
        />
      </Show>

      <Show when={editor().kind === "number"}>
        <NumberEditor
          plan={editor() as Extract<FieldEditorPlan, { kind: "number" }>}
          name={props.field?.name}
          labelId={props.labelId}
          required={props.plan.required}
          value={props.value}
          onChange={props.onChange}
        />
      </Show>

      <Show when={editor().kind === "boolean"}>
        <BooleanEditor value={props.value} onChange={props.onChange} />
      </Show>

      <Show when={editor().kind === "date"}>
        <DateEditor
          plan={editor() as Extract<FieldEditorPlan, { kind: "date" }>}
          value={props.value}
          onChange={props.onChange}
        />
      </Show>

      <Show when={editor().kind === "file"}>
        <FileEditor value={props.value} onChange={props.onChange} />
      </Show>

      <Show when={editor().kind === "ref"}>
        <RefEditor
          entityType={(editor() as Extract<FieldEditorPlan, { kind: "ref" }>).entityType}
          filter={(editor() as Extract<FieldEditorPlan, { kind: "ref" }>).filter}
          value={props.value}
          onChange={props.onChange}
          placeholder={(editor() as Extract<FieldEditorPlan, { kind: "ref" }>).placeholder}
        />
      </Show>

      <Show when={editor().kind === "list"}>
        <ListEditor
          innerType={(editor() as Extract<FieldEditorPlan, { kind: "list" }>).itemType}
          itemTypeLabel={(editor() as Extract<FieldEditorPlan, { kind: "list" }>).itemTypeLabel}
          itemDefault={(editor() as Extract<FieldEditorPlan, { kind: "list" }>).itemDefault}
          choices={(editor() as Extract<FieldEditorPlan, { kind: "list" }>).choices}
          canonical={(editor() as Extract<FieldEditorPlan, { kind: "list" }>).canonical}
          occurrences={listChipSelection()?.occurrences}
          selected={listChipSelection()?.selected}
          onChipEdit={editListChips}
          chipError={listChipError()}
          chipPending={listChipPending()}
          chipReady={listChipReady()}
          value={props.value}
          onChange={props.onChange}
        />
        <Show when={!listChipReady()}><Show when={!projectedListSelection.loading && projectedListSelection.error}
          fallback={<span class="home-new-button__spinner" style={{ display: "inline-block" }} role="status" aria-label="Loading" />}>
          <p class="field-error" role="alert">This list selection is unavailable.</p>
        </Show></Show>
      </Show>

      <Show when={editor().kind === "arrow"}>
        <Show
          when={exprCtx?.ArrowBodyEditor}
          fallback={<FunctionPicker label={props.plan.label} arrowType={editor().rawType} value={props.value} onChange={props.onChange} />}
        >
          {(W) => (
            <Dynamic
              component={W()}
              arrowType={(editor().rawType as { $arrow: { params: readonly FieldDef[]; returns: FenelType } })}
              value={props.value}
              onChange={props.onChange}
            />
          )}
        </Show>
      </Show>

      <Show when={editor().kind === "record"}>
        <RecordEditor
          fields={(editor() as Extract<FieldEditorPlan, { kind: "record" }>).fields}
          value={props.value}
          onChange={props.onChange}
        />
      </Show>

      <Show when={editor().kind === "freeform-record"}>
        <RawValueEditor
          value={typeof props.value === "object" && props.value !== null && !Array.isArray(props.value)
            ? (props.value as Record<string, unknown>)
            : {}}
          onChange={props.onChange}
        />
      </Show>

      <Show when={editor().kind === "variant"}>
        <UnionEditor
          discriminator={(editor() as Extract<FieldEditorPlan, { kind: "variant" }>).discriminator}
          cases={(editor() as Extract<FieldEditorPlan, { kind: "variant" }>).cases}
          toggle={(editor() as Extract<FieldEditorPlan, { kind: "variant" }>).toggle}
          value={props.value}
          onChange={props.onChange}
        />
      </Show>

      <Show when={editor().kind === "matrix"}>
        <MatrixEditor
          rows={(editor() as Extract<FieldEditorPlan, { kind: "matrix" }>).rows}
          columns={(editor() as Extract<FieldEditorPlan, { kind: "matrix" }>).columns}
          value={props.value as Record<string, Record<string, unknown>> | undefined}
          onChange={props.onChange}
        />
      </Show>

      <Show when={editor().kind === "markup" && !(editor() as Extract<FieldEditorPlan, { kind: "markup" }>).expression}>
        <MarkupEditor
          value={ensureMarkupValue(props.value)}
          onChange={props.onChange}
          targetSubset={targetSubsetFromSet((editor() as Extract<FieldEditorPlan, { kind: "markup" }>).set)}
        />
      </Show>

      <Show when={editor().kind === "unsupported"}>
        <div class="fr-channel-placeholder">
          <Show when={(editor() as Extract<FieldEditorPlan, { kind: "unsupported" }>).channel}>
            <span>{(editor() as Extract<FieldEditorPlan, { kind: "unsupported" }>).reason}</span>
          </Show>
          <VariantValueEditor type={editor().rawType} value={props.value} onChange={props.onChange} />
        </div>
      </Show>

      <Show when={editor().kind === "map"}>
        <VariantValueEditor
          type={editor().rawType}
          value={props.value}
          onChange={props.onChange}
        />
      </Show>
      </Show>
    </>
  );
}

function targetSubsetFromSet(set?: SetExpr): string | undefined {
  const view = peelSetExpr(set);
  return view?.kind === "SeRef" ? view.handle : undefined;
}

function fieldForType(type: FenelType, ui?: EditDisplay): FieldDef {
  return {
    name: "value",
    label: Nothing,
    type,
    meta: {},
    ui: ui ? Just(ui) : Nothing,
  };
}

/** Type-only editor — for nested uses (list items, union variants) where no channel applies. */
function TypeEditor(props: { type: FenelType; value: unknown; onChange: (v: unknown) => void; ui?: EditDisplay }) {
  const recordValues = useContext(RecordValuesContext);
  const registry = useFieldPresentationRegistry();
  const reader = useReaderRuntime();
  const authoring = useAuthoringSession();
  const field = createMemo(() => fieldForType(props.type, props.ui));
  const preparation = createReaderFieldPlan(() => ({ field: field(), value: props.value, recordValues: recordValues(),
    fieldMode: "transient", channelsEnabled: false, ...(props.ui ? { presentationOverride: { display: props.ui } } : {}) }),
  registry, reader, authoring, true);
  const change = createFieldChange(preparation, () => props.onChange);
  return (
    <><Show when={preparation.paint()}>{prepared => <div ref={preparation.guardElement} style={{ display: "contents" }}
      aria-disabled={preparation.ready() ? "false" : "true"} aria-busy={preparation.loading() ? "true" : "false"}>
      <ChannelEditor
      field={prepared().field}
      plan={prepared().result.plan}
      type={prepared().result.plan.editor.rawType}
      value={prepared().value}
      onChange={change().callback}
    />
    </div>}</Show><Show when={!preparation.ready()}><span class="text-muted" role={preparation.error() ? "alert" : "status"}>
      {preparation.error() ? "This field's editor is unavailable." : "Preparing field…"}
    </span><Show when={preparation.error()}><button type="button" class="expr-form__btn"
      onClick={() => { void preparation.retry(); }}>Retry</button></Show></Show></>
  );
}

// ---------------------------------------------------------------------------
// Primitives
// ---------------------------------------------------------------------------

function FormatIcon(props: { icon?: string }) {
  switch (props.icon) {
    case "mail": return <IconMail size={16} />;
    case "phone": return <IconPhone size={16} />;
    case "link": return <IconLink size={16} />;
    case "user": return <IconUser size={16} />;
    default: return null;
  }
}

/**
 * Pull a Pattern out of a SetExpr if one is statically present:
 *   - `{$ref: "format:..."}` — looked up in the format-presets registry
 *   - `{$pattern: <Pattern>}` — used directly
 *   - `{$intersect: [...]}` — recurse into each part and use the first hit
 * Returns undefined when no Pattern is reachable, so the input falls back
 * to plain text rendering.
 */
function patternFromSet(set?: SetExpr): Pattern | undefined {
  const v = set ? peelSetExpr(set) : null;
  if (!v) return undefined;
  if (v.kind === "SeRef") return getNamedPattern(v.handle);
  if (v.kind === "SePattern") return v.pattern;
  if (v.kind === "SeIntersect") {
    for (const p of v.branches) {
      const found = patternFromSet(p);
      if (found) return found;
    }
  }
  return undefined;
}

// ---------------------------------------------------------------------------
// Per-segment helpers (used by SegmentedInput, defined here so MaskedTextInput
// and SegmentedInput can stay close to their dispatch site in StringEditor).
// ---------------------------------------------------------------------------

/** Greedy mask within a single segment: drop chars rejected by the pattern,
 *  keep the rest. No auto-insert — separators are between segments, not in
 *  them. */
function maskSegmentInput(pattern: Pattern, raw: string): string {
  let cur = pattern;
  let out = "";
  for (const ch of raw) {
    const next = patternDeriv(cur, ch);
    if (next.t === "empty") continue;
    cur = next;
    out += ch;
  }
  return out;
}

/** A segment is "complete" when its sub-pattern accepts the current value
 *  (nullable residual) AND no further character would extend it. That's the
 *  signal to advance focus to the next segment. */
function isSegmentComplete(pattern: Pattern, value: string): boolean {
  let cur = pattern;
  for (const ch of value) {
    const next = patternDeriv(cur, ch);
    if (next.t === "empty") return false;
    cur = next;
  }
  if (!patternNullable(cur)) return false;
  return patternFirstSet(cur).length === 0;
}

/** A segment is "stoppable" when its sub-pattern accepts the current value
 *  but more chars *could* still extend it. Used for separator-jump: if the
 *  user types the literal that follows the segment (e.g. "." in IPv4 after
 *  an octet), we advance focus only if the partial input is itself a valid
 *  segment value, even though more digits would be legal. */
function isSegmentStoppable(pattern: Pattern, value: string): boolean {
  let cur = pattern;
  for (const ch of value) {
    const next = patternDeriv(cur, ch);
    if (next.t === "empty") return false;
    cur = next;
  }
  return patternNullable(cur);
}

/** Walk the segments left-to-right and pull out each group's substring. For
 *  groups, consume chars greedily through `deriv` until rejection. For
 *  literals, advance past them when present. Tolerant of incomplete or
 *  missing literals — the goal is to surface whatever the user has typed. */
function parseValueIntoSegments(value: string, segs: FlatSegment[]): string[] {
  const groupValues: string[] = [];
  let pos = 0;
  for (const seg of segs) {
    if (seg.kind === "literal") {
      if (value.startsWith(seg.text, pos)) pos += seg.text.length;
    } else {
      let cur = seg.pattern;
      let consumed = 0;
      while (pos + consumed < value.length) {
        const ch = String.fromCodePoint(value.codePointAt(pos + consumed)!);
        const next = patternDeriv(cur, ch);
        if (next.t === "empty") break;
        cur = next;
        consumed += ch.length;
      }
      groupValues.push(value.slice(pos, pos + consumed));
      pos += consumed;
    }
  }
  return groupValues;
}

/** Re-assemble segments + per-group values back into a single string.
 *  Optional literals are buffered until a non-empty group is found, so a
 *  separator like "-" before an empty optional zip4 is dropped. */
function composeSegmentValues(segs: FlatSegment[], groupValues: string[]): string {
  let out = "";
  let groupIdx = 0;
  let pendingLiteral = "";
  for (const seg of segs) {
    if (seg.kind === "literal") {
      if (seg.optional) pendingLiteral += seg.text;
      else { out += pendingLiteral + seg.text; pendingLiteral = ""; }
    } else {
      const v = groupValues[groupIdx] ?? "";
      groupIdx++;
      if (v.length > 0) {
        out += pendingLiteral + v;
        pendingLiteral = "";
      } else if (seg.optional) {
        pendingLiteral = "";
      } else {
        out += pendingLiteral + v;
        pendingLiteral = "";
      }
    }
  }
  return out;
}

/** Should we hide an optional literal segment at index `i`? Yes if the next
 *  group segment after it is optional AND empty — because the literal is the
 *  separator that precedes that group. */
function shouldHideOptionalLiteral(
  segs: FlatSegment[],
  groupValues: string[],
  i: number,
): boolean {
  let groupIdx = 0;
  for (let j = 0; j < i; j++) {
    if (segs[j]!.kind === "group") groupIdx++;
  }
  for (let j = i + 1; j < segs.length; j++) {
    const s = segs[j]!;
    if (s.kind === "group") {
      return s.optional && (groupValues[groupIdx] ?? "") === "";
    }
  }
  return false;
}

/**
 * Derivative-driven masked text input. On each input event:
 *   1. Replay the raw value from scratch through the Pattern; skip any char
 *      whose derivative is `empty` (illegal-at-this-position).
 *   2. After the last accepted char, append the run of forced literals the
 *      residual demands (so typing "12" in dd/MM yields "12/" automatically).
 *   3. Suppress auto-insert when the user is deleting (raw shorter and a
 *      prefix of the previous value), so backspace doesn't get fought by
 *      the mask immediately re-adding the separator.
 */
function MaskedTextInput(props: {
  pattern: Pattern;
  value: string;
  onChange: (v: string) => void;
  onBlur?: () => void;
  placeholder?: string;
  inputType?: string;
  class?: string;
  name?: string;
  labelId?: string;
  required?: boolean;
  autocomplete?: FieldRendererProps["autocomplete"];
}) {
  const apply = (raw: string, prev: string) => {
    const isDeletion = raw.length < prev.length && prev.startsWith(raw);
    let cur = props.pattern;
    let out = "";
    for (const ch of raw) {
      let next = patternDeriv(cur, ch);
      if (next.t === "empty") {
        const forced = forcedPrefix(cur);
        if (forced) {
          out += forced;
          for (const f of forced) cur = patternDeriv(cur, f);
          next = patternDeriv(cur, ch);
        }
        if (next.t === "empty") continue;
      }
      cur = next;
      out += ch;
    }
    if (!isDeletion) out += forcedPrefix(cur);
    return out;
  };

  return (
    <input
      class={props.class ?? "fe-input"}
      type={props.inputType ?? "text"}
      name={props.name}
      aria-labelledby={props.labelId}
      required={props.required}
      autocomplete={props.autocomplete}
      value={props.value}
      placeholder={props.placeholder}
      onInput={(e) => {
        const raw = e.currentTarget.value;
        const next = apply(raw, props.value);
        props.onChange(next);
        if (next !== raw) e.currentTarget.value = next;
      }}
      onBlur={() => props.onBlur?.()}
    />
  );
}

/**
 * Segmented input — one `<input>` per top-level group in the Pattern, with
 * literals rendered inline as separators. Auto-advances focus when the
 * current segment can no longer accept characters; backspace at the start of
 * an empty segment moves back to the previous one.
 *
 * Falls back to a plain text input if the Pattern's top-level structure
 * isn't a flat seq of literals + groups (e.g. has alternation at the root).
 */
function SegmentedInput(props: {
  pattern: Pattern;
  value: string;
  onChange: (v: string) => void;
  onBlur?: () => void;
}) {
  const segments = createMemo(() => decomposeFlatPattern(props.pattern));
  const segValues = createMemo(() => {
    const segs = segments();
    return segs ? parseValueIntoSegments(props.value, segs) : [];
  });
  const groupSegIndices = createMemo(() => {
    const segs = segments();
    if (!segs) return [];
    const out: number[] = [];
    segs.forEach((s, i) => { if (s.kind === "group") out.push(i); });
    return out;
  });

  const inputRefs: (HTMLInputElement | undefined)[] = [];

  const handleSegInput = (groupIdx: number, raw: string) => {
    const segs = segments();
    if (!segs) return;
    const segIdx = groupSegIndices()[groupIdx];
    if (segIdx === undefined) return;
    const seg = segs[segIdx]!;
    if (seg.kind !== "group") return;
    const masked = maskSegmentInput(seg.pattern, raw);
    const newVals = segValues().slice();
    newVals[groupIdx] = masked;
    props.onChange(composeSegmentValues(segs, newVals));
    if (isSegmentComplete(seg.pattern, masked)) {
      inputRefs[groupIdx + 1]?.focus();
    }
  };

  const handleSegKeyDown = (groupIdx: number, e: KeyboardEvent) => {
    const target = e.currentTarget as HTMLInputElement;
    if (e.key === "Backspace" && target.value === "" && groupIdx > 0) {
      e.preventDefault();
      const prev = inputRefs[groupIdx - 1];
      if (prev) {
        prev.focus();
        prev.setSelectionRange(prev.value.length, prev.value.length);
      }
      return;
    }
    const segs = segments();
    if (!segs) return;
    const segIdx = groupSegIndices()[groupIdx];
    if (segIdx === undefined) return;
    let nextLitChar: string | undefined;
    for (let j = segIdx + 1; j < segs.length; j++) {
      const s = segs[j]!;
      if (s.kind === "group") break;
      if (!shouldHideOptionalLiteral(segs, segValues(), j)) {
        nextLitChar = [...s.text][0];
        break;
      }
    }
    const seg = segs[segIdx]!;
    if (
      nextLitChar &&
      e.key === nextLitChar &&
      seg.kind === "group" &&
      target.value !== "" &&
      isSegmentStoppable(seg.pattern, target.value)
    ) {
      e.preventDefault();
      inputRefs[groupIdx + 1]?.focus();
    }
  };

  return (
    <Show when={segments()} fallback={
      <input
        class="fe-input"
        value={props.value}
        onInput={(e) => props.onChange(e.currentTarget.value)}
        onBlur={() => props.onBlur?.()}
      />
    }>
      <div class="fr-segmented">
        <For each={segments()!}>{(seg, i) =>
          seg.kind === "literal" ? (
            <span

              class={["fr-seg-literal", {
                "fr-seg-literal--hidden":
                  seg.optional && shouldHideOptionalLiteral(segments()!, segValues(), i()),
              }]}
            >{seg.text}</span>
          ) : (
            (() => {
              const groupIdx = groupSegIndices().indexOf(i());
              return (
                <input
                  ref={(el) => { inputRefs[groupIdx] = el; }}
                  class="fe-input fr-seg-input"
                  value={segValues()[groupIdx] ?? ""}
                  placeholder={seg.name}
                  onInput={(e) => handleSegInput(groupIdx, e.currentTarget.value)}
                  onKeyDown={(e) => handleSegKeyDown(groupIdx, e)}
                  onBlur={() => props.onBlur?.()}
                />
              );
            })()
          )
        }</For>
      </div>
    </Show>
  );
}

function StringEditor(props: {
  plan: Extract<FieldEditorPlan, { kind: "text" }>;
  value: unknown;
  onChange: (v: unknown) => void;
  onBlur?: () => void;
  name?: string;
  labelId?: string;
  required?: boolean;
  autocomplete?: FieldRendererProps["autocomplete"];
}) {
  const str = () => (props.value == null ? "" : typeof props.value === "object" ? JSON.stringify(props.value) : String(props.value));
  const isTextarea = () => props.plan.widget === "textarea";
  const pattern = createMemo(() => patternFromSet(props.plan.set));

  const fieldHints = useContext(FieldHintsContext);
  const validationState = createMemo(() => {
    const v = str();
    if (!v) return null;
    // One data source (demo 10, Rom): the field's own membership hints decide
    // the badge. Green only when the whole value passes, red only when typing
    // more cannot fix it; an incomplete text is no error ("test@gmail").
    return hintBadge(fieldHints());
  });

  // Anchor the nested Show output to one DOM insertion owner so an accepted
  // widget change replaces the native leaf across asynchronous plan updates.
  return (
    <div class="fr-string-editor" style={{ display: "contents" }}>
    <Show when={isTextarea()} fallback={
      <div class={["fr-input-wrap", {
        "fr-input-wrap--valid": validationState() === "valid",
        "fr-input-wrap--invalid": validationState() === "invalid",
      }]}>
        <Show when={props.plan.icon && !props.plan.prefix}>
          <span class="fr-prefix fr-prefix--icon"><FormatIcon icon={props.plan.icon} /></span>
        </Show>
        <Show when={props.plan.prefix}>
          <span class="fr-prefix">{props.plan.prefix}</span>
        </Show>
        <Show when={props.plan.widget !== "native" && pattern()} fallback={
          <StringInputSurface
            inputType={props.plan.inputType}
            name={props.name}
            labelId={props.labelId}
            required={props.required}
            autocomplete={props.autocomplete}
            value={str()}
            placeholder={props.plan.placeholder ?? ""}
            onChange={(value) => props.onChange(value)}
            onBlur={() => props.onBlur?.()}
          />
        }>
          {(p) => (
            <Show when={props.plan.widget === "segmented"} fallback={
              <MaskedTextInput
                pattern={p()}
                value={str()}
                onChange={(v) => props.onChange(v)}
                onBlur={() => props.onBlur?.()}
                placeholder={props.plan.placeholder ?? ""}
                inputType={props.plan.inputType}
                name={props.name}
                labelId={props.labelId}
                required={props.required}
                autocomplete={props.autocomplete}
              />
            }>
              <SegmentedInput
                pattern={p()}
                value={str()}
                onChange={(v) => props.onChange(v)}
                onBlur={() => props.onBlur?.()}
              />
            </Show>
          )}
        </Show>
        <Show when={props.plan.suffix}>
          <span class="fr-suffix">{props.plan.suffix}</span>
        </Show>
        <Show when={validationState()}>
          {(state) => (
            <span class={["fr-validation-badge", {
              "fr-validation-badge--valid": state() === "valid",
              "fr-validation-badge--invalid": state() === "invalid",
            }]}>
              {state() === "valid" ? <IconCircleCheck size={14} class="icon-pass" /> : <IconCircleX size={14} class="icon-fail" />}
            </span>
          )}
        </Show>
      </div>
    }>
      <StringInputSurface
        textarea
        name={props.name}
        labelId={props.labelId}
        required={props.required}
        value={str()}
        placeholder={props.plan.placeholder ?? ""}
        onChange={(value) => props.onChange(value)}
        rows={3}
      />
    </Show>
    </div>
  );
}

function NumberEditor(props: {
  plan: Extract<FieldEditorPlan, { kind: "number" }>;
  name?: string;
  labelId?: string;
  required?: boolean;
  value: unknown;
  onChange: (v: unknown) => void;
}) {
  const reader = useReaderRuntime();
  const authoring = useAuthoringSession();
  const registry = useFieldPresentationRegistry();
  const codecSession = createMemo(() => reader?.session() ?? authoring);
  const codecTypeName = createMemo(() => props.plan.textCodec ? props.plan.numericTypeName : undefined);
  const codecWorker = createMemo(() => {
    const route = localFieldSelectionWorker(reader, codecSession(), registry());
    return route?.kind === "worker" ? route.worker : route?.kind === "error" ? route.error : undefined;
  });
  // B4 F1: the same owner test as every other field control (identity with
  // the reader's snapshot), never a read of the page session's registry.
  const codecRemote = createMemo(() => codecWorker() !== undefined);
  // The source plan may be freshly transported after every model edit. Codec
  // lifetime follows its source/type identity, preserving a focused lexeme
  // across an ordinary value echo instead of treating it as an external edit.
  const codec = createMemo(() => {
    codecWorker();
    const typeName = codecTypeName();
    return typeName ? numericTextCodec(codecSession(), { typeName }, { remote: codecRemote() }) : undefined;
  });
  const bounds = () => props.plan.bounds;
  const widget = () => props.plan.widget;
  const displayVal = () => {
    const v = props.value;
    if (v == null || v === "") return bounds()?.lo ?? 0;
    return Number(v);
  };

  return (
    <Show when={widget() === "stepper" && !codec()} fallback={
    <Show when={widget() === "slider" && bounds() != null && !codec()} fallback={
      <div class="fr-input-wrap">
        <Show when={props.plan.prefix}>
          <span class="fr-prefix">{props.plan.prefix}</span>
        </Show>
        <NumberInput
          class="fe-input"
          name={props.name}
          ariaLabelledBy={props.labelId}
          required={props.required}
          value={props.value}
          textCodec={codec()}
          placeholder={props.plan.placeholder ?? ""}
          step={props.plan.integer ? 1 : "any"}
          onChange={props.onChange}
        />
        <Show when={props.plan.suffix}>
          <span class="fr-suffix">{props.plan.suffix}</span>
        </Show>
      </div>
    }>
      <div class="fr-slider-wrap">
        <input
          class="fr-slider"
          type="range"
          min={bounds()!.lo}
          max={bounds()!.hi}
          step={bounds()!.step}
          value={displayVal()}
          onInput={(e) => props.onChange(Number(e.currentTarget.value))}
        />
        <NumberInput
          class="fe-input fr-slider-value"
          name={props.name}
          ariaLabelledBy={props.labelId}
          required={props.required}
          min={bounds()!.lo}
          max={bounds()!.hi}
          step={bounds()!.step}
          value={props.value}
          onChange={props.onChange}
        />
        <Show when={props.plan.suffix}>
          <span class="fr-suffix">{props.plan.suffix}</span>
        </Show>
      </div>
    </Show>
    }>
      <div class="fr-stepper">
        <button
          class="fr-stepper-btn"
          type="button"
          disabled={bounds() != null && displayVal() <= bounds()!.lo}
          onClick={() => props.onChange(displayVal() - (bounds()?.step ?? 1))}
        >-</button>
        <span class="fr-stepper-value">{displayVal()}</span>
        <button
          class="fr-stepper-btn"
          type="button"
          disabled={bounds() != null && displayVal() >= bounds()!.hi}
          onClick={() => props.onChange(displayVal() + (bounds()?.step ?? 1))}
        >+</button>
        <Show when={props.plan.suffix}>
          <span class="fr-suffix">{props.plan.suffix}</span>
        </Show>
      </div>
    </Show>
  );
}

function DateEditor(props: {
  plan: Extract<FieldEditorPlan, { kind: "date" }>;
  value: unknown;
  onChange: (v: unknown) => void;
}) {
  const str = () => (props.value == null ? "" : String(props.value));

  return (
    <input
      class="fe-input"
      type={props.plan.inputType}
      value={str()}
      min={props.plan.min}
      max={props.plan.max}
      placeholder={props.plan.placeholder}
      onInput={(e) => props.onChange(e.currentTarget.value)}
    />
  );
}

function BooleanEditor(props: { value: unknown; onChange: (v: unknown) => void }) {
  return (
    <label class="fr-checkbox">
      <input
        type="checkbox"
        checked={!!props.value}
        onChange={(e) => props.onChange(e.currentTarget.checked)}
      />
    </label>
  );
}

// ---------------------------------------------------------------------------
// FunctionPicker — `$arrow` fields outside an expression editor. Its model
// (selection, options, labels, signature) lives in `function-picker-model.ts`.
// ---------------------------------------------------------------------------

/** Form-facing editor for `$arrow` fields; inside an expression editor the
 *  context's `ArrowBodyEditor` composes a lambda instead. Lists the functions
 *  of the registry in scope (`functionPickerRegistry`), shows a stored
 *  `{ $ref }` or legacy name through that same registry, and writes
 *  `{ $ref: <function id> }`. The field's arrow type, when given, is shown
 *  under the picker as the signature the function must have; it changes
 *  neither what is listed nor what is written. */
function FunctionPicker(props: { label?: string; arrowType?: unknown; value: unknown; onChange: (v: unknown) => void }) {
  const callables = useContext(CallableRegistryContext);
  const inheritedRegistry = useFieldPresentationRegistry();
  const reader = useReaderRuntime();
  const authoring = useAuthoringSession();
  const registry = () => functionPickerRegistry<CallableRegistry>(callables(), inheritedRegistry(), createRegistryLazy);
  // B4 F1: a Local reader's own registry lists, labels and resolves in its
  // worker with the same model; the page registry is never read. A foreign
  // callable registry, or none at all (std), keeps the page route.
  const local = createMemo(() => {
    if (reader?.kind !== "local") return undefined;
    const own = callables() ?? inheritedRegistry();
    if (!own) return undefined;
    return localFieldSelectionWorker(reader, reader.session() ?? authoring, own as ModuleRegistry);
  });
  let alive = true, pending: AbortController | undefined;
  onSettled(() => () => { alive = false; pending?.abort(); });
  const localInput = createMemo(() => { const route = local(); return route ? { route, value: props.value } : undefined; });
  const localAnswer = createAsyncValue(() => localInput(), async input => {
    pending?.abort();
    const controller = new AbortController(); pending = controller;
    try {
      if (input.route.kind === "error") throw input.route.error;
      const route = input.route;
      const current = () => alive && latest(localInput) === input && preparedReaderWorkerForSession(route.session) === route.worker;
      // A yielded answer (another job waited) is asked again; the worker
      // keeps the labels it finished.
      for (;;) {
        const reply = await runPreparedReaderWorker(route.worker,
          { method: "project-reader-function-options", value: input.value, priority: "guidance" }, controller.signal);
        controller.signal.throwIfAborted();
        if (!current()) throw new Error("This field's functions changed while they were preparing.");
        if (Object.hasOwn(reply, "yielded")) continue;
        const answer = (reply as { functionOptions?: { options: readonly { value: string; label: string }[]; selection: FunctionPickerSelection } }).functionOptions;
        if (!answer || !Array.isArray(answer.options) || !answer.options.every(functionPickerOptionReadable)
          || !functionPickerSelectionReadable(answer.selection))
          throw new Error("This field's functions could not be read.");
        return { input, ...answer };
      }
    } finally { if (pending === controller) pending = undefined; }
  });
  const localReady = () => {
    const input = localInput(), answer = localAnswer.loading ? undefined : localAnswer();
    return answer && answer.input === input ? answer : undefined;
  };
  // After a pick only the selection is asked again: the last options of the
  // same worker and session stay listed, and a stored id that is one of them
  // shows as selected while its answer is pending (an alias waits for it).
  let retained: { route: Extract<NonNullable<ReturnType<typeof local>>, { kind: "worker" }>; options: readonly { value: string; label: string }[] } | undefined;
  const localView = createMemo(() => {
    const input = localInput();
    if (!input) return undefined;
    const answer = localReady();
    if (answer) {
      if (answer.input.route.kind === "worker") retained = { route: answer.input.route, options: answer.options };
      return { options: answer.options, selection: answer.selection, ready: true };
    }
    const route = input.route;
    const kept = retained && route.kind === "worker" && retained.route.worker === route.worker && retained.route.session === route.session
      ? retained : undefined;
    if (!kept) return undefined;
    const handle = functionPickerHandle(input.value);
    const selection: FunctionPickerSelection = handle === undefined ? { kind: "none" }
      : kept.options.some(option => option.value === handle) ? { kind: "function", id: handle } : { kind: "none" };
    return { options: kept.options, selection, ready: false };
  });
  // B4 wave 4 lane E: over the reader's own registry, a function the global
  // label lookups do not know is labelled in the reader's frame
  // (`reader.presentation`, its scoped rows), cached per frame; a foreign or
  // std registry keeps the global labels.
  const pageLabels = () => {
    const current = registry();
    if (!reader || reader.kind === "local" || current !== reader.registry()) return { label: functionOptionLabel, key: current };
    return { label: (id: string) => functionOptionLabelIn(() => reader.presentation(id), id), key: reader.session().evaluateContext as object };
  };
  const pageLabel = (id: string) => pageLabels().label(id);
  const options = createMemo<LocusSelectOption[]>(() => [
    { value: "", label: "— pick a function —" },
    ...(local() ? localView()?.options ?? [] : (() => { const page = pageLabels(); return functionPickerOptions(registry(), page.label, page.key); })()),
  ]);
  const selection = createMemo<FunctionPickerSelection>(() => local() ? localView()?.selection ?? { kind: "none" }
    : functionPickerSelection(props.value, registry()));
  const signature = createMemo(() => functionPickerSignature(props.arrowType, printFenel));
  // Labels the trigger when the stored value is not one of the options.
  const fallback = createMemo<LocusSelectOption | undefined>(() => {
    const current = selection();
    if (current.kind === "unresolved") return { value: current.handle, label: current.handle, icon: "alert-triangle" };
    if (current.kind === "function") return { value: current.id, label: local()
      ? localView()?.options.find(option => option.value === current.id)?.label ?? current.id : pageLabel(current.id) };
    return undefined;
  });
  const localError = () => local() && !localReady() && !localAnswer.loading ? localAnswer.error : undefined;
  return (
    <div class="fr-function-picker">
      <LocusSelect
        label={props.label || "Function"}
        value={functionPickerKey(selection())}
        options={options()}
        fallbackOption={fallback()}
        disabled={!!local() && !localView()}
        busy={!!local() && !!localView() && !localView()!.ready}
        tooltip={selection().kind === "unresolved"
          ? "This stored reference does not resolve to a function in this registry"
          : signature() === undefined ? undefined : `Pick a function of type ${signature()}`}
        minWidth="100%"
        onChange={(key) => props.onChange(functionPickerValue(key))}
      />
      <Show when={localError() || local() && !localView()}>
        <span class="text-muted" role={localError() ? "alert" : "status"}>
          {localError() ? "This field's functions are unavailable." : "Preparing functions…"}
        </span>
        <Show when={localError()}><button type="button" class="expr-form__btn"
          onClick={() => { void localAnswer.refetch(); }}>Retry</button></Show>
      </Show>
      <Show when={signature()}>
        {(text) => (
          <div
            class="fr-function-picker__signature mono text-muted"
            style="font-size: 0.72rem; margin-top: 0.2rem;"
            data-tooltip="The type a function needs to fill this field"
          >
            {text()}
          </div>
        )}
      </Show>
    </div>
  );
}

let _fnRegistry: ReturnType<typeof createRepositoryRegistry> | null = null;
function createRegistryLazy() {
  if (!_fnRegistry) _fnRegistry = createRepositoryRegistry([stdModule]);
  return _fnRegistry;
}

// ---------------------------------------------------------------------------
// Select — DOM handles refer back to the plan's original typed choices.
// ---------------------------------------------------------------------------

function SelectEditor(props: {
  type?: FenelType;
  options: SelectOption[];
  value: unknown;
  onChange: (v: unknown) => void;
  radio: boolean;
}) {
  const publication = createMemo(() => ({ callback: props.onChange }));
  const radioGroupName = createUniqueId();
  const registry = useFieldPresentationRegistry();
  const reader = useReaderRuntime();
  const authoring = useAuthoringSession();
  const worker = createMemo(() => localFieldSelectionWorker(reader, reader?.session() ?? authoring, registry()));
  const [choicePending, setChoicePending] = createSignal(false);
  let choiceGesturePending = false;
  let choiceAlive = true;
  // A standalone control has no owner facts: `pageFieldFrame` does not
  // materialize the unrelated detached seed session merely to highlight its
  // ordinary scalar choices. A worker route reads no page frame at all.
  const selectionContext = () => pageFieldFrame(reader, reader?.session() ?? authoring, registry());
  const choices = createMemo(() => {
    const options = props.options.slice();
    const prefix = createUniqueId();
    return {
      options,
      blankToken: `${prefix}:blank`,
      rows: options.map((option, index) => ({
        token: `${prefix}:${index}`,
        index,
        value: option.value,
        label: canonical(option.label),
      })),
    };
  });
  const choiceInput = createMemo(() => ({ choices: choices(), value: props.value, type: props.type, owner: worker() }));
  const [choiceError, setChoiceError] = createSignal<{ input: ReturnType<typeof choiceInput>; message: string }>();
  let choiceSelectionRequest: AbortController | undefined;
  let choiceGesture: { input: ReturnType<typeof choiceInput>; controller: AbortController } | undefined;
  onSettled(() => () => { choiceAlive = false; choiceSelectionRequest?.abort(); choiceGesture?.controller.abort(); });
  const projectedChoiceSelection = createAsyncValue(() => ({ input: choiceInput() }), ({ input }) => {
    choiceSelectionRequest?.abort(); choiceSelectionRequest = undefined;
    if (choiceGesture && choiceGesture.input !== input) choiceGesture.controller.abort();
    if (!input.owner) return undefined;
    if (input.owner.kind === "error") throw input.owner.error;
    const controller = new AbortController(); choiceSelectionRequest = controller;
    return runPreparedReaderWorker(input.owner.worker,
      { method: "project-reader-choice-selection", options: input.choices.options, value: input.value }, controller.signal)
      .then(reply => {
        controller.signal.throwIfAborted();
        const result = reply as { selection: ReturnType<typeof fieldChoiceSelectionPlan> };
        if (!Object.hasOwn(reply, "selection") || !result.selection?.selectedIndex)
          throw new Error("This choice selection could not be read.");
        return { input, selection: result.selection };
      }).finally(() => { if (choiceSelectionRequest === controller) choiceSelectionRequest = undefined; });
  }, { holdTransitions: false });
  const synchronousChoiceSelection = createMemo(() => worker() ? undefined
    : fieldChoiceSelectionPlan(choices().options, props.value, selectionContext()));
  const choiceSelection = () => {
    const input = choiceInput();
    if (!input.owner) return synchronousChoiceSelection();
    const result = projectedChoiceSelection();
    return !projectedChoiceSelection.loading && result?.input === input ? result.selection : undefined;
  };
  const choiceReady = () => !worker() || !!choiceSelection();
  const selectedIndex = createMemo(() => peelMaybeValue<number>(choiceSelection()?.selectedIndex));
  const selectedToken = () => choices().rows[selectedIndex() ?? -1]?.token ?? choices().blankToken;
  const choose = async (token: string) => {
    if (!choiceAlive || choiceGesturePending || choiceSelectionRequest || !latest(choiceReady)) return;
    const input = latest(choiceInput);
    const lease = latest(publication), publish = lease.callback;
    const snapshot = input.choices;
    if (input.owner) {
      try {
        if (input.owner.kind === "error") throw input.owner.error;
        if (preparedReaderWorkerForSession(input.owner.session) !== input.owner.worker)
          throw new Error("This choice reader was replaced. Try again.");
      } catch (problem) {
        setChoiceError({ input, message: problem instanceof Error ? problem.message : "This choice selection could not be checked." });
        return;
      }
    }
    if (token === snapshot.blankToken) {
      if (input.value !== undefined) publish(undefined);
      return;
    }
    const row = snapshot.rows.find((choice) => choice.token === token);
    // An old open menu can outlive a replaced/reordered option array. Its
    // token must never be reinterpreted as a choice in the new array.
    if (!row) return;
    if (!input.owner) {
      if (fieldChoiceSelectionPlan([snapshot.options[row.index]!], input.value, latest(selectionContext)).selectedIndex.$tag === "Nothing") publish(row.value);
      return;
    }
    const current = () => choiceAlive && latest(choiceInput) === input && latest(publication) === lease;
    try {
      const controller = new AbortController(); choiceGesture = { input, controller };
      choiceGesturePending = true; setChoicePending(true);
      const reply = await runPreparedReaderWorker(input.owner.worker, { method: "project-reader-choice-selection",
        options: [snapshot.options[row.index]!], value: input.value }, controller.signal);
      controller.signal.throwIfAborted();
      if (!current() || preparedReaderWorkerForSession(input.owner.session) !== input.owner.worker) return;
      const result = reply as { selection: ReturnType<typeof fieldChoiceSelectionPlan> };
      if (!Object.hasOwn(reply, "selection") || !result.selection?.selectedIndex)
        throw new Error("This choice selection could not be checked.");
      setChoiceError(undefined);
      if (result.selection.selectedIndex.$tag === "Nothing") publish(row.value);
    } catch (problem) {
      if (current()) setChoiceError({ input, message: problem instanceof Error ? problem.message : "This choice selection could not be checked." });
    } finally {
      choiceGesture = undefined; choiceGesturePending = false;
      if (choiceAlive) setChoicePending(false);
    }
  };
  return (
    <>
    <Show when={props.radio} fallback={
      <LocusSelect
        class="fe-input"
        label="Value"
        busy={!choiceReady() || choicePending()}
        value={choiceReady() ? selectedToken() : ""}
        fallbackOption={!choiceReady() ? { value: "", label: !projectedChoiceSelection.loading && projectedChoiceSelection.error ? "Unavailable" : "Checking…" } : undefined}
        options={[{ value: choices().blankToken, label: "Select..." }, ...choices().rows.map((row) => ({ value: row.token, label: row.label }))]}
        onChange={choose}
      />
    }>
      <div class="fr-radio-group" aria-busy={!choiceReady() || choicePending() ? "true" : "false"}>
        <For each={choices().rows}>
          {(row) => (
            <label class="fr-radio">
              <input
                type="radio"
                name={radioGroupName}
                value={row.token}
                checked={choiceReady() && selectedIndex() === row.index}
                aria-disabled={!choiceReady() || choicePending() ? "true" : "false"}
                onClick={event => {
                  if (latest(worker)) { event.preventDefault(); void choose(row.token); }
                }}
                onChange={() => { if (!latest(worker)) void choose(row.token); }}
              />
              {row.label}
            </label>
          )}
        </For>
      </div>
    </Show>
    <Show when={!choiceReady()}><Show when={!projectedChoiceSelection.loading && projectedChoiceSelection.error}
      fallback={<span class="home-new-button__spinner" style={{ display: "inline-block" }} role="status" aria-label="Loading" />}>
      <p class="field-error" role="alert">This choice selection is unavailable.</p>
    </Show></Show>
    <Show when={choicePending() && choiceReady()}><span class="home-new-button__spinner" style={{ display: "inline-block" }} role="status" aria-label="Loading" /></Show>
    <Show when={choiceError()?.input === choiceInput() && choiceError()?.message}>{message => <p class="field-error" role="alert">{message()}</p>}</Show>
    </>
  );
}

// ---------------------------------------------------------------------------
// File, Ref
// ---------------------------------------------------------------------------

function FileEditor(props: { value: unknown; onChange: (v: unknown) => void }) {
  return (
    <input
      class="fe-input"
      type="file"
      onChange={(e) => {
        const file = e.currentTarget.files?.[0];
        if (file) {
          props.onChange({ name: file.name, label: Nothing, size: file.size, type: file.type, ui: Nothing });
        }
      }}
    />
  );
}

/** Explicit adapter from the Fenel FieldRef constructor carried by dispatch
 * instance methods to the host's universal Ref projection. */
function spatialFieldRef(value: unknown): FieldRef | undefined {
  if (value === null || typeof value !== "object") return undefined;
  const ref = value as { $tag?: unknown; handle?: unknown };
  return ref.$tag === "FieldRef" && typeof ref.handle === "string"
    ? { $ref: ref.handle }
    : undefined;
}

function RefEditor(props: {
  entityType: string;
  filter?: import("@fenel/engine/types").Expression;
  value: unknown;
  onChange: (v: unknown) => void;
  placeholder?: string;
}) {
  const publication = createMemo(() => ({ callback: props.onChange }));
  const reader = useReaderRuntime();
  const resolver = useRefResolver();
  const creator = useRefCreator();
  const getComponent = useEntityComponent();
  const [version, setVersion] = createSignal(0);
  const [showMap, setShowMap] = createSignal(false);

  // Check if this entity has static data (e.g. countries)
  const entitySpec = createMemo(() => getSystemEntity(props.entityType));

  // Check if target entity is Spatial (has geometry that can be mapped)
  const spatialMethods = createMemo(() => {
    const methods = dispatchRegistry.resolve(props.entityType, "Spatial", GLOBAL_ONLY);
    if (!methods) return null;
    const geometryField = spatialFieldRef(methods["geometryField"]);
    if (geometryField === undefined) return null;
    const centroidField = spatialFieldRef(methods["centroidField"]);
    return {
      geometryField,
      geometryType: String(methods["geometryType"] ?? ""),
      ...(centroidField === undefined ? {} : { centroidField }),
    };
  });

  // storage-as-effect Phase 3e — ONE options source, the static/dynamic fork
  // collapsed. Reference (bundle) entities read the in-process register through
  // the shared `referenceRows` adapter SYNCHRONOUSLY (no flicker — D-D-i);
  // dynamic entities resolve async via the ref resolver. The caller no longer
  // special-cases static-vs-dynamic: `options()` / `loading()` / `canSelect()`
  // absorb the distinction. (The engine now serves reference reads through the
  // same `StorageHandler` seam — D5; the frontend keeps the bundle read
  // in-process per D-D-i to preserve the no-flicker UX.)
  const bundleOptions = createMemo(() => {
    const spec = entitySpec();
    if (!spec) return null;
    const rows = referenceRows(spec.id);
    if (!rows) return null;
    const refIdMethods = dispatchRegistry.resolve(props.entityType, "Referenceable", GLOBAL_ONLY);
    const refId = (refIdMethods?.["refId"] as string | undefined) ?? "id";
    const displayField = inferDisplayField(entitySchemaFields(spec));
    return rows.map((d) => ({
      value: String(d[refId]),
      label: String(d[displayField]),
      data: d,
    })) as RefOption[];
  });

  // Dynamic options — only fetched for non-reference (non-bundle) entities.
  const dynamicOptions = createAsyncValue(
    () => bundleOptions() ? null : { entityType: props.entityType, filter: props.filter, v: version() },
    (params) => {
      if (!params) return Promise.resolve([]);
      return resolver?.(params.entityType, {}, params.filter) ?? Promise.resolve([]);
    },
  );

  const options = () => bundleOptions() ?? dynamicOptions() ?? [];
  const loading = () => !bundleOptions() && dynamicOptions.loading;
  const optionsError = () => bundleOptions() ? undefined : dynamicOptions.error;
  // A selectable dropdown exists when we have a source of options — the
  // in-process bundle, or a resolver for the dynamic path. Replaces the
  // compound `resolver || staticOptions()` special-case in the JSX.
  const canSelect = () => !!(bundleOptions() || resolver);

  // Check if entity has a custom edit component via its default view
  // (registered through the Viewable typeclass).
  const CustomEditor = createMemo(() => {
    const spec = entitySpec();
    if (!getComponent) return null;
    const view = reader
      ? peelMaybeValue<string>((reader.representation("Viewable", spec?.id ?? props.entityType)?.defaultView ?? Nothing) as Parameters<typeof peelMaybeValue<string>>[0])
      : spec ? getDefaultView(spec.id) : undefined;
    if (!view) return null;
    return getComponent(view);
  });

  async function handleCreate() {
    if (!creator) return;
    const lease = latest(publication), publish = lease.callback, entityType = props.entityType, previous = props.value;
    const newId = await creator(entityType);
    if (newId && latest(publication) === lease && props.entityType === entityType && props.value === previous) {
      setVersion((v) => v + 1);
      publish(newId);
    }
  }

  const hasSpatial = () => !!(spatialMethods() && entitySpec());

  return (
    <>
      <div class="fr-ref-row">
        <Show when={CustomEditor()} fallback={
          <Show when={canSelect()} fallback={
            <input
              class="fe-input"
              type="text"
              value={props.value == null ? "" : String(props.value)}
              placeholder={props.placeholder ?? "Entity ID"}
              onInput={(e) => props.onChange(e.currentTarget.value)}
            />
          }>
            <LocusSelect
              class="fe-input"
              label="Reference"
              value={props.value == null ? "" : String(props.value)}
              options={[
                { value: "", label: optionsError() !== undefined ? "Unable to load options" : loading() ? "Loading..." : (props.placeholder ?? "Select...") },
                ...options().map((opt: RefOption) => ({ value: opt.value, label: canonical(opt.label) })),
              ]}
              onChange={(value) => { if (value !== (props.value == null ? "" : String(props.value))) props.onChange(value || null); }}
              disabled={optionsError() !== undefined}
            />
          </Show>
        }>
          {(Editor) => (
            <Dynamic
              component={Editor()}
              options={options()}
              value={props.value}
              onChange={props.onChange}
              placeholder={props.placeholder}
            />
          )}
        </Show>
        <Show when={creator}>
          <button type="button" class="fe-btn-add fe-btn-add--sm" onClick={handleCreate} data-tooltip="Create new">
            <IconPlus size={10} />
          </button>
        </Show>
        <Show when={hasSpatial()}>
          <button type="button" class="fr-map-btn" onClick={() => setShowMap(!showMap())}
            aria-label={showMap() ? "Hide map" : "Show map"} aria-expanded={showMap() ? "true" : "false"}
            data-tooltip={showMap() ? "Hide map" : "Show map"}>
            <span class="fr-map-btn__icon" aria-hidden="true"><IconWorld size={14} /></span>
          </button>
        </Show>
      </div>

      {/* Spatial map modal */}
      <Show when={optionsError() !== undefined}>
        <div class="admin-form-error" role="alert">Unable to load options: {optionsError() instanceof Error ? (optionsError() as Error).message : String(optionsError())}</div>
      </Show>
      <Show when={showMap() && hasSpatial()}>
        <ModalOverlay class="fr-map-modal-overlay" onClick={(e) => { if (e.target === e.currentTarget) setShowMap(false); }}>
          <div class="fr-map-modal" role="dialog" aria-modal="true" aria-label="Map">
            <div class="fr-map-modal__header">
              <span>Map</span>
              <button type="button" class="fr-map-modal__close" onClick={() => setShowMap(false)}>&times;</button>
            </div>
            <SpatialMap
              entitySpec={entitySpec()!}
              selectedKey={props.value ? String(props.value) : null}
              providerScope={repositoryProviderScope}
              spatial={spatialMethods()!}
            />
          </div>
        </ModalOverlay>
      </Show>
    </>
  );
}

// ---------------------------------------------------------------------------
// Composites — List, Record, Union
// ---------------------------------------------------------------------------


function ListEditor(props: {
  innerType: FenelType;
  itemTypeLabel: string;
  itemDefault?: unknown;
  choices?: SelectOption[];
  canonical?: boolean;
  occurrences?: Array<{ $tag: "Nothing" } | { $tag: "Just"; _0: number }>;
  selected?: boolean[];
  onChipEdit?: (action: FieldListChipsAction) => void;
  chipError?: string;
  chipPending?: boolean;
  chipReady?: boolean;
  value: unknown;
  onChange: (v: unknown) => void;
}) {
  const publication = createMemo(() => ({ callback: props.onChange }));
  const currentValue = createMemo(() => props.value);
  const items = () => (Array.isArray(currentValue()) ? currentValue() as unknown[] : []);
  const [visibleItems, setVisibleItems] = createSignal(40);
  const [chips, setChips] = createSignal(true);
  const ctx = useContext(ExprFieldContext);

  function setItem(index: number, val: unknown, publish = props.onChange) {
    const arr = [...items()];
    arr[index] = val;
    publish(arr);
  }
  function removeItem(index: number, publish = props.onChange) {
    publish(items().filter((_, i) => i !== index));
  }
  function addItem() {
    const seed = ctx?.defaultValueForType?.(props.innerType) ?? props.itemDefault ?? undefined;
    props.onChange([...items(), seed]);
  }

  return (
    <div class="fr-list">
      <Show when={props.choices?.length}>
        <div class="fr-list-presentations" role="group" aria-label="List presentation">
          <button type="button" class="fe-btn-add fe-btn-add--sm" aria-pressed={chips() ? "true" : "false"}
            onClick={() => setChips(true)}>Chips</button>
          <button type="button" class="fe-btn-add fe-btn-add--sm" aria-pressed={!chips() ? "true" : "false"}
            onClick={() => setChips(false)}>Rows</button>
        </div>
      </Show>
      <Show when={chips() && !!props.choices?.length} fallback={<>
      <For keyed={false} each={items().slice(0, visibleItems())}>
        {(item, i) => {
          const change = createMemo(() => {
            const lease = publication(), publish = lease.callback, previous = currentValue();
            const binding = { callback: (value: unknown): void => {
              if (latest(change) === binding && latest(publication) === lease && latest(currentValue) === previous) setItem(i, value, publish);
            } };
            return binding;
          });
          const remove = createMemo(() => {
            const lease = publication(), publish = lease.callback, previous = currentValue();
            const binding = { callback: (): void => {
              if (latest(remove) === binding && latest(publication) === lease && latest(currentValue) === previous) removeItem(i, publish);
            } };
            return binding;
          });
          return (
          <Show when={ctx?.ListItemWrapper} fallback={
            <div class="fr-list-item">
              <div class="fr-list-item-header">
                <span class="fr-list-item-index">{i + 1}</span>
                <button type="button" class="fe-btn-danger-sm" onClick={remove().callback}>
                  <IconTrash size={12} />
                </button>
              </div>
              <div class="fr-list-item__body">
                <TypeEditor
                  type={props.innerType}
                  value={item()}
                  onChange={change().callback}
                />
              </div>
            </div>
          }>
            {(W) => (
              <Dynamic
                component={W()}
                index={i}
                innerType={props.innerType}
                typeName={props.itemTypeLabel}
                value={item()}
                onChange={change().callback}
                onRemove={remove().callback}
              >
                <TypeEditor
                  type={props.innerType}
                  value={item()}
                  onChange={change().callback}
                />
              </Dynamic>
            )}
          </Show>
        ); }}
      </For>
      <Show when={items().length > visibleItems()}><button type="button" class="fe-btn-add fe-btn-add--sm"
        onClick={() => setVisibleItems((count) => count + 40)}>Show more items ({items().length - visibleItems()} remaining)</button></Show>
      <button type="button" class="fe-btn-add fe-btn-add--sm" onClick={addItem}>
        <IconPlus size={10} /> Add item
      </button>
      </>}>
        <Show when={props.canonical} fallback={<>
          <div class="fr-list-chips" role="list" aria-label="Ordered list items">
            <For keyed={false} each={items().slice(0, visibleItems())}>{(item, index) => {
              const option = () => {
                const chosen = props.occurrences?.[index];
                return chosen?.$tag === "Just" ? props.choices?.[chosen._0] : undefined;
              };
              const caption = createMemo(() => {
                const selected = option();
                return selected ? canonical(selected.label) : props.chipReady === false ? "…" : "Unknown item";
              });
              return <div class="fr-list-chip" role="listitem">
                <span class="fr-list-chip__position">{index + 1}</span>
                <span>{caption()}</span>
                <button type="button" class="fr-list-chip__remove" aria-label={`Remove item ${index + 1}`}
                  aria-disabled={props.chipReady === false || props.chipPending ? "true" : "false"}
                  onClick={() => props.onChipEdit?.({ $tag: "FieldListRemoveOccurrence", index, expected: item() })}>
                  <IconTrash size={12} />
                </button>
              </div>;
            }}</For>
            <Show when={items().length === 0}><span class="text-muted">Empty list</span></Show>
          </div>
          <Show when={items().length > visibleItems()}><button type="button" class="fe-btn-add fe-btn-add--sm"
            onClick={() => setVisibleItems(count => count + 40)}>Show more items ({items().length - visibleItems()} remaining)</button></Show>
          <div class="fr-list-chips" role="group" aria-label="Append an item">
            <For each={props.choices}>{(option, index) => <button type="button" class="fr-list-chip fr-list-chip--choice"
              aria-label={`Append ${canonical(option.label)}`}
              aria-disabled={props.chipReady === false || props.chipPending ? "true" : "false"}
              onClick={() => props.onChipEdit?.({ $tag: "FieldListAppendChoice", index: index(), expected: option.value })}>
              <IconPlus size={10} /> {canonical(option.label)}
            </button>}</For>
          </div>
        </>}>
          <div class="fr-list-chips" role="group" aria-label="Choose list items">
            <For each={props.choices}>{(option, index) => <button type="button" class="fr-list-chip fr-list-chip--choice"
              aria-pressed={props.chipReady === false ? undefined : props.selected?.[index()] ? "true" : "false"}
              aria-disabled={props.chipReady === false || props.chipPending ? "true" : "false"}
              onClick={() => props.onChipEdit?.({ $tag: "FieldListToggleChoice", index: index(), expected: option.value })}>
              {canonical(option.label)}
            </button>}</For>
          </div>
        </Show>
      </Show>
      <Show when={props.chipPending && props.chipReady !== false}><span class="home-new-button__spinner" style={{ display: "inline-block" }} role="status" aria-label="Loading" /></Show>
      <Show when={props.chipError}><p class="field-error" role="alert">{props.chipError}</p></Show>
    </div>
  );
}

function RecordEditor(props: {
  fields: FieldDef[];
  value: unknown;
  onChange: (v: unknown) => void;
}) {
  const publication = createMemo(() => ({ callback: props.onChange }));
  const currentValue = createMemo(() => props.value);
  const obj = () =>
    typeof currentValue() === "object" && currentValue() !== null && !Array.isArray(currentValue())
      ? (currentValue() as Record<string, unknown>)
      : {};

  const hasFields = () => props.fields.length > 0;
  const preparation = createReaderRecordOperations(() => hasFields()
    ? { value: obj(), fields: props.fields.map(field => field.name) } : undefined,
  { coordinate: () => props.fields, publication });

  return (
    <Show when={hasFields()} fallback={
      <FreeformRecordEditor value={obj()} onChange={props.onChange} />
    }>
      <div style={{ display: "contents" }}>
      <Show when={preparation.paint()}>{prepared => <RecordValuesContext value={() => prepared().value as Record<string, unknown>}>
      <div class="fr-record" ref={preparation.guardElement} aria-disabled={preparation.ready() ? "false" : "true"}
        aria-busy={preparation.loading() ? "true" : "false"}>
        <For keyed={false} each={prepared().coordinate ?? []}>
          {(field, index) => {
            const slot = () => prepared().recordSlots[index]?.slot;
            const admitted = () => { const current = slot(); return current?.$tag === "Ok" ? current._0 : undefined; };
            const value = () => { const current = admitted(); return current?.value.$tag === "Just" ? current.value._0 : undefined; };
            const change = createMemo(() => {
              const lease = publication(), publish = lease.callback, name = field().name;
              // The record decides whether this edit runs now or waits for its
              // current receipt (queued, never dropped); only a replaced
              // publication refuses it.
              const binding = { callback: (value: unknown): void => {
                if (latest(publication) === lease) preparation.edit(name, value, result => { if (latest(publication) === lease) publish(result); });
              } };
              return binding;
            });
            return <Show when={admitted()} fallback={<p class="text-muted" role="status">{(() => { const current = slot(); return current?.$tag === "Err" ? current._0 : "This record cannot be read safely."; })()}</p>}>
            <WithExprField
              field={field()}
              value={value()}
              onChange={change().callback}
              typeName={displayTypeLabel(field().type)}
            >
              <FieldRenderer
                field={field()}
                value={value()}
                onChange={change().callback}
              />
            </WithExprField>
            </Show>;
          }}
        </For>
      </div>
      </RecordValuesContext>}</Show>
      <Show when={!preparation.ready()}><span class="text-muted" role={preparation.error() ? "alert" : "status"}>
        {preparation.error() ? "This data's fields are unavailable." : "Preparing fields…"}
      </span><Show when={preparation.error()}><button type="button" class="expr-form__btn"
        onClick={() => { void preparation.retry(); }}>Retry</button></Show></Show>
      <Show when={preparation.ready() && preparation.error()}>{error => <p class="text-muted" role="alert">{String(error())}</p>}</Show>
      </div>
    </Show>
  );
}

/** Freeform key-value editor for records with no defined fields */
function FreeformRecordEditor(props: {
  value: Record<string, unknown>;
  onChange: (v: unknown) => void;
}) {
  const entries = () => Object.entries(props.value);

  function setField(key: string, val: unknown) {
    props.onChange({ ...props.value, [key]: val });
  }
  function removeField(key: string) {
    const v = { ...props.value };
    delete v[key];
    props.onChange(v);
  }
  function renameField(oldKey: string, newKey: string) {
    const v: Record<string, unknown> = {};
    for (const [k, val] of Object.entries(props.value)) {
      v[k === oldKey ? newKey : k] = val;
    }
    props.onChange(v);
  }
  function addField() {
    props.onChange({ ...props.value, "": "" });
  }

  return (
    <div class="fr-freeform-record">
      <For keyed={false} each={entries()}>
        {(entry) => (
          <div class="fe-set-row">
            <input
              class="fe-input fe-input--sm fe-set-key"
              value={entry()[0]}
              placeholder="key"
              onInput={(e) => renameField(entry()[0], e.currentTarget.value)}
            />
            <span class="fe-set-eq">=</span>
            <input
              class="fe-input fe-input--sm"
              value={stringifyValue(entry()[1])}
              placeholder="value"
              onInput={(e) => setField(entry()[0], parseValue(e.currentTarget.value))}
            />
            <button type="button" class="fe-btn-danger-sm" onClick={() => removeField(entry()[0])}>
              &times;
            </button>
          </div>
        )}
      </For>
      <button type="button" class="fe-btn-add fe-btn-add--sm" onClick={addField}>
        <IconPlus size={10} /> Add field
      </button>
    </div>
  );
}

const UNION_PICK_CHANGED = "This data changed while its case was checked. Pick the case again.";

function UnionEditor(props: {
  discriminator: string;
  cases: FieldVariantCasePlan[];
  toggle: boolean;
  value: unknown;
  onChange: (v: unknown) => void;
}) {
  const publication = createMemo(() => ({ callback: props.onChange }));
  const currentValue = createMemo(() => props.value);
  const reader = useReaderRuntime();
  const authoring = useAuthoringSession();
  const presentationRegistry = useFieldPresentationRegistry();
  const frame = () => reader?.session() ?? authoring;
  const [editError, setEditError] = createSignal<string>();
  // B4 F1: a Local case pick waits for its worker check; the cases show busy
  // and refuse further picks meanwhile, so no click is silently lost.
  const [picking, setPicking] = createSignal(false);
  let alive = true, pickFlight: AbortController | undefined;
  onSettled(() => () => { alive = false; pickFlight?.abort(); });
  const obj = () =>
    typeof currentValue() === "object" && currentValue() !== null
      ? (currentValue() as Record<string, unknown>)
      : {};
  const preparation = createReaderRecordOperations(() => ({ value: obj(),
    fields: [props.discriminator, ...props.cases.flatMap(entry => entry.fields.map(field => field.name))] }),
  { coordinate: () => ({ cases: props.cases, discriminator: props.discriminator, toggle: props.toggle, value: currentValue() }), publication });
  const coordinate = () => preparation.paint()?.coordinate;
  const variantNames = () => coordinate()?.cases.map((c) => c.name) ?? [];
  const tagSlot = () => coordinate()?.value === null || coordinate()?.value === undefined
    ? undefined : preparation.paint()?.recordSlots[0]?.slot;
  const tagError = () => { const current = tagSlot(); return current?.$tag === "Err" ? current._0 : undefined; };
  /** Currently-selected case. Reads the discriminator on the value, with
   *  a null/undefined fallback to the variant's first declared case —
   *  that covers values stored as native `null` (the legacy Maybe
   *  encoding) without a dedicated Maybe-only adapter: `null` simply
   *  reads as "the first / nullary case" for any variant, which IS
   *  `Nothing` for canonical Maybe. */
  const variantKey = () => {
    const v = coordinate()?.value;
    if (v === null || v === undefined) return variantNames()[0] ?? "";
    const slot = tagSlot();
    return slot?.$tag === "Ok" && slot._0.value.$tag === "Just" && typeof slot._0.value._0 === "string" ? slot._0.value._0 : "";
  };
  const variantCase = () => coordinate()?.cases.find((c) => c.name === variantKey());
  const variantFields = () => variantCase()?.fields ?? [];
  const useToggle = () => !!coordinate()?.toggle && variantNames().length > 0;

  async function pickVariant(name: string) {
    const captured = latest(preparation.input), prepared = latest(preparation.paint), lease = latest(publication);
    if (!prepared?.coordinate || !latest(preparation.ready) || pickFlight) return;
    const slot = latest(tagSlot);
    if (slot?.$tag === "Err") { setEditError(slot._0); return; }
    const current = () => alive && latest(preparation.input) === captured && latest(preparation.ready) && latest(publication) === lease;
    // The first-case display fallback is not stored data. Source selection
    // preserves an actual case (including the empty placeholder) on reselection.
    const route = localFieldSelectionWorker(reader, latest(frame), latest(presentationRegistry));
    if (slot?.$tag === "Ok") {
      const options = [{ value: name, label: name }], key = latest(variantKey);
      // B4 F1: a Local reader asks its worker (the same selection owner, in
      // its own frame); the page session's frame is never read.
      let selection: ReturnType<typeof fieldChoiceSelectionPlan>;
      if (route) {
        const controller = new AbortController(); pickFlight = controller; setPicking(true);
        try {
          if (route.kind === "error") throw route.error;
          const reply = await runPreparedReaderWorker(route.worker,
            { method: "project-reader-choice-selection", options, value: key }, controller.signal);
          controller.signal.throwIfAborted();
          if (!alive) return;
          // The data or its reader moved while the check ran: say so, never a silent drop.
          if (!current() || preparedReaderWorkerForSession(route.session) !== route.worker) { setEditError(UNION_PICK_CHANGED); return; }
          const answer = (reply as { selection?: ReturnType<typeof fieldChoiceSelectionPlan> }).selection;
          if (!Object.hasOwn(reply, "selection") || !answer?.selectedIndex) throw new Error("This choice selection could not be read.");
          selection = answer;
        } catch (problem) {
          if (current()) setEditError(problem instanceof Error ? problem.message : "This choice selection could not be checked.");
          return;
        } finally { if (pickFlight === controller) { pickFlight = undefined; if (alive) setPicking(false); } }
      } else selection = fieldChoiceSelectionPlan(options, key, pageFieldFrame(reader, latest(frame), latest(presentationRegistry)));
      if (selection.selectedIndex.$tag === "Just") return;
    }
    const selected = prepared.coordinate.cases.find((c) => c.name === name);
    if (current()) { if (route) setEditError(undefined); lease.callback(selected?.defaultValue ?? { [prepared.coordinate.discriminator]: name }); }
  }

  return (
    <div style={{ display: "contents" }}><Show when={preparation.paint()}>{prepared => <div class="fr-union" ref={preparation.guardElement}
      aria-disabled={preparation.ready() ? "false" : "true"} aria-busy={preparation.loading() || picking() ? "true" : "false"}>
      <Show when={useToggle()} fallback={
        <LocusSelect
          class="fe-input"
          label="Value type"
          busy={picking()}
          value={variantKey()}
          options={[{ value: "", label: "Select type..." }, ...variantNames().map((name) => ({ value: name, label: name }))]}
          onChange={pickVariant}
        />
      }>
        <div class="expr-mode-toggle">
          <For each={variantNames()}>
            {(name) => (
              <button
                type="button"
                class={{ "expr-mode-toggle__btn": true, active: variantKey() === name }}
                disabled={picking()}
                onClick={() => pickVariant(name)}
              >{name}</button>
            )}
          </For>
        </div>
      </Show>
      <Show when={variantKey() && variantFields().length > 0}>
        <div class="fr-union-fields">
          <For keyed={false} each={variantFields()}>
            {(field) => {
              const slot = () => prepared().recordSlots.find(entry => entry.field === field().name)?.slot;
              const admitted = () => { const current = slot(); return current?.$tag === "Ok" ? current._0 : undefined; };
              const value = () => { const current = admitted(); return current?.value.$tag === "Just" ? current.value._0 : undefined; };
              const change = createMemo(() => {
                const lease = publication(), publish = lease.callback, name = field().name, captured = preparation.input();
                const current = () => latest(change) === binding && latest(publication) === lease && latest(preparation.input) === captured;
                const binding = { callback: (value: unknown): void => {
                  if (current()) preparation.edit(name, value, result => { if (current()) publish(result); });
                } };
                return binding;
              });
              return <Show when={admitted()} fallback={<p class="text-muted" role="status">{(() => { const current = slot(); return current?.$tag === "Err" ? current._0 : "This constructor cannot be read safely."; })()}</p>}>
              <WithExprField
                field={field()}
                value={value()}
                onChange={change().callback}
                typeName={displayTypeLabel(field().type)}
              >
                <FieldRenderer
                  field={field()}
                  value={value()}
                  onChange={change().callback}
                />
              </WithExprField>
              </Show>;
            }}
          </For>
        </div>
      </Show>
      <Show when={tagError()}>{(error) => <p class="text-muted" role="status">{error()}</p>}</Show>
      <Show when={editError()}>{(error) => <p class="text-muted" role="alert">{error()}</p>}</Show>
    </div>}</Show><Show when={!preparation.ready()}><span class="text-muted" role={preparation.error() ? "alert" : "status"}>
      {preparation.error() ? "This data's fields are unavailable." : "Preparing fields…"}
    </span><Show when={preparation.error()}><button type="button" class="expr-form__btn"
      onClick={() => { void preparation.retry(); }}>Retry</button></Show></Show>
    <Show when={preparation.ready() && preparation.error()}>{error => <p class="text-muted" role="alert">{String(error())}</p>}</Show></div>
  );
}

// ---------------------------------------------------------------------------
// MatrixEditor — fixed rows × typed columns
// ---------------------------------------------------------------------------

function MatrixEditor(props: {
  rows: FieldMatrixRowPlan[];
  columns: FieldDef[];
  value: Record<string, Record<string, unknown>> | undefined;
  onChange: (v: unknown) => void;
}) {
  const publication = createMemo(() => ({ callback: props.onChange }));
  const currentValue = createMemo(() => props.value);
  const registry = useFieldPresentationRegistry();
  // B4 wave 4 lane E: a Local reader's column labels come from its worker's
  // field plans; until answered, the column's own name.
  const local = useReaderRuntime()?.kind === "local";
  const columnView = (field: FieldDef) => {
    const activeRegistry = registry();
    if (!activeRegistry) return undefined;
    return resolveIdentifiedFieldView(activeRegistry, field);
  };
  const val = () => currentValue() ?? {};

  function cellValue(rowKey: string, colId: string): unknown {
    return val()[rowKey]?.[colId];
  }

  function updateCell(rowKey: string, colId: string, cellVal: unknown, publish = props.onChange) {
    const current = { ...val() };
    current[rowKey] = { ...(current[rowKey] ?? {}), [colId]: cellVal };
    publish(current);
  }

  const rowEntries = () => props.rows;

  return (
    <div style="overflow-x: auto">
      <table style="width: 100%; border-collapse: collapse; font-size: 0.85rem">
        <thead>
          <tr>
            <th style="text-align: left; padding: 0.4rem; border-bottom: 2px solid #e2e8f0; min-width: 120px" />
            <For keyed={false} each={props.columns}>
              {(col) => {
                const localLabel = local ? createLocalFieldLabel(() => registry() ? col() : undefined, registry) : undefined;
                return <th style="text-align: left; padding: 0.4rem; border-bottom: 2px solid #e2e8f0; min-width: 100px">
                  {registry()
                    ? localLabel ? localLabel() ?? col().name : canonical(columnView(col())!.presentation.label)
                    : col().name}
                </th>;
              }}
            </For>
          </tr>
        </thead>
        <tbody>
          <For keyed={false} each={rowEntries()}>
            {(row) => (
              <tr>
                <td style="padding: 0.4rem; border-bottom: 1px solid #f1f5f9; font-weight: 500">
                  {row().label}
                </td>
                <For keyed={false} each={props.columns}>
                  {(col) => {
                    const change = createMemo(() => {
                      const lease = publication(), publish = lease.callback, rowKey = row().key, currentColumn = col(), name = currentColumn.name, previous = currentValue();
                      const binding = { callback: (value: unknown): void => {
                        if (latest(change) === binding && latest(publication) === lease && latest(currentValue) === previous)
                          updateCell(rowKey, name, value, publish);
                      } };
                      return binding;
                    });
                    return (
                    <td style="padding: 0.25rem; border-bottom: 1px solid #f1f5f9">
                      <TypeEditor
                        type={col().type}
                        value={cellValue(row().key, col().name)}
                        onChange={change().callback}
                        ui={columnView(col())?.display}
                      />
                    </td>
                  ); }}
                </For>
              </tr>
            )}
          </For>
        </tbody>
      </table>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Utilities
// ---------------------------------------------------------------------------

function stringifyValue(v: unknown): string {
  if (v == null) return "";
  if (typeof v === "string") return v;
  return JSON.stringify(v);
}

function parseValue(s: string): unknown {
  const t = s.trim();
  if (t === "") return "";
  if (/^[\[{]/.test(t) || t === "true" || t === "false" || t === "null") {
    try { return JSON.parse(t); } catch { /* fall through */ }
  }
  if (/^-?\d+(\.\d+)?$/.test(t)) return Number(t);
  return s;
}

/**
 * Coerce arbitrary value into a MarkupValue. Strings become a single Text-
 * wrapped paragraph (handles legacy data); already-tagged values pass
 * through; everything else gets a sensible empty document root.
 */
function ensureMarkupValue(v: unknown): MarkupValue {
  if (v && typeof v === "object" && "$tag" in v) {
    const c = (v as { $tag?: unknown }).$tag;
    if (c === "Element" || c === "Text") return v as MarkupValue;
  }
  if (typeof v === "string" && v.length > 0) {
    return makeElem("div", {}, [makeElem("p", {}, [makeText(v)])]);
  }
  return makeElem("div", {}, []);
}
