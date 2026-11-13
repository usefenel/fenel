import { Errored, For, Loading, NotReadyError, Show, createContext, createMemo, createSignal, latest, lazy, onSettled, useContext } from "solid-js";
import type { JSX } from "@solidjs/web";
import type { FenelFunction, FenelType, FieldDef } from "@fenel/engine/types";
import type { ModuleRegistry } from "@fenel/engine/registry";
import { registryTransportSnapshot } from "../../../../../../implementations/typescript/engine/src/registry";
import { exactTransportKey } from "../../../../../../implementations/typescript/engine/src/registry-transport";
import type { TemplateRegistry } from "@fenel/engine/template-registry";
import { entitySchemaFields, resolveEffect } from "@fenel/engine";
import { typeConstructorOf } from "../../../../../../implementations/typescript/engine/src/effect-dispatch";
import { recordFieldsForType } from "@fenel/engine/authoring/expression";
import { isFenelTypeLike, peelMaybeForAuthoring, resolveValueType, nativeValueTypeName } from "@fenel/engine/authoring/type";
import { projectLocusTypeDescriptions } from "../../../../../../implementations/typescript/engine/src/authoring/locus-type-presentation";
import { Anything, Nothing, peelMaybeValue, refHandle } from "@fenel/engine/type-foundation";
import { surfaceReadValuePlan } from "@fenel/engine/authoring/surface";
import { fieldNumericTextCodecPlan } from "@fenel/engine/authoring/field-render";
import { useAuthoringSession, type AuthoringSession } from "~/lib/expression-runner/authoring-session";
import { ExpressionGraphCollectionItemControl } from "~/lib/expression-runner/expression-surfaces";
import { useReaderRuntime, type ReaderRuntime } from "~/lib/reader-runtime";
import { readerTypeLabelInSession, readerTypePresentationInSession, type SourceReaderValueReadInput,
  type SourceReaderValueReadPacket } from "~/lib/reader-presentation";
import { DataPreview, DataThumbnail, DelimitedText, hasDataPreview, StructuralReadValue } from "~/lib/data-transfer/DataPreview";
import { listPreviewGlyph } from "~/lib/list-preview-glyph";
import { singleConstructorFields } from "~/lib/locus-table-columns";
import { carriedConstructor } from "~/lib/carried-constructor";
import { constructorLabel } from "~/lib/constructor-label";
import { VariantValueRenderer } from "~/lib/variant-value/VariantValueRenderer";
import { IconByName, LUCIDE_BY_NAME } from "~/lib/icons";
import { CollectionChips, CollectionPreviewStrip, ValueCard, ValueCardCaption, valueCardLabel, valueCardTypeLabel } from "~/lib/value-card";
import { chipHref, chipName } from "~/lib/collection-chips";
import { childrenOf } from "~/lib/locus-scope";
import { readLocusCatalogReference } from "~/lib/locus-catalog-reference";
import { childValueType } from "~/lib/data-transfer/child-type";
import { DataValueSurface, type ContainedValuePreview, type ContainedValueWrapper, type ValueStructureFacts, type ValueStructureRender } from "~/lib/data-transfer/DataValueSurface";
import type { FunctionCardType } from "~/lib/function-card-body";
import { TypeDataPreviewBody } from "~/lib/type-data-preview";
import { presentedTypeTarget, typeIconForPresentation } from "~/lib/type-icon-presentation";
import { webRegistry } from "~/lib/web-template-registry";
import { LayoutRenderer, ReadPlanValue, ReadValue, type TemplateComponentProps } from "./LayoutRenderer";
import { LineChart } from "~/lib/charts";
import { AnimationFrameStripView } from "~/lib/storybook";
import { RichDocumentRead } from "~/lib/documents/RichDocumentRead";
import { DataOccurrenceBoundary, type DataOccurrenceSource } from "~/lib/data-occurrence";
import { codeName, displayNameText, presentedDisplayName, type DisplayNameInput } from "~/lib/display-name";
import { RecordValueRows, fieldEditInPlace } from "./record-value-rows";
// Polish item 1: the small in-place field editor loads on first use.
const LocusQuickEdit = lazy(async () => ({ default: (await import("~/lib/locus-quick-edit")).LocusQuickEdit }));
import { CalendarDateRead } from "./calendar-date-read";
import { fieldSlotName, fieldWireKey } from "./typed-read-field-slots";
import { ValueCardFocusedContext, ValueCardInlineContext, useValueCardFocused, useValueCardInline } from "~/lib/value-hover-preview";
import { booleanText } from "~/lib/boolean-text";
import { fieldConstructor, fieldHoldsNothing, recordHeadingField, recordPortraitField } from "./record-card-plan";
import { ItemMark, useItemPresentation } from "~/lib/item-glyph";
import { pictureOf } from "~/lib/data-transfer/thumbnail-text";
import { ImageCanvas } from "~/lib/expression-runner/ImageCanvas";
import { DisplayNameText } from "~/lib/display-name-text";
import { returnedExpressionNode } from "~/lib/lens-shortcuts";
import { createLocalReturnedExpression } from "~/lib/expression-runner/local-editor-reads";
import { ExpressionEditor, ExpressionGraphValueContext, type HeldExpressionPresentation } from "~/lib/expression-runner/ExpressionEditor";
import type { FunctionSignatureOrigins } from "~/lib/expression-runner/function-signature-origins";
import type { ExprNode } from "@fenel/engine/authoring/expression";
import { detectStructuralForm } from "~/lib/expression-runner/expression-structure";
import { ExpressionGraphCaptureContext, ExpressionGraphScopeCaptureContext } from "~/lib/expression-runner/expression-surfaces";
import { functionDisplayName } from "~/lib/expression-runner/callable-names";
import { localReaderReadSession, preparedReaderWorkerForSession, runPreparedReaderWorker, type PreparedReaderWorker } from "~/lib/expression-runner/authoring-catalog-worker";
import { concreteAuthoringSession } from "~/lib/expression-runner/account-authoring-session";
import type { AuthoringReaderTypeDescriptions, AuthoringReaderTypePreview, AuthoringReaderValueReads } from "~/lib/expression-runner/authoring-worker-protocol";
import { createAsyncValue } from "~/lib/async-value";
import { LensSpinner } from "~/lib/loading-screen";
import "./typed-read-value.css";
// A decided grouping (std OrdinaryMap) reads through its registered Viewable body.
import "~/lib/grouping-read";
// SolverDemo Solutions read as answers through their registered Viewable body.
import "~/lib/solver-solutions-view";
// Encyclopedia species sets read as nested sets through their registered Viewable body.
import "~/lib/nested-sets-view";

webRegistry.registerComponent("point-line-chart", LineChart);
webRegistry.registerComponent("animation-frames", AnimationFrameStripView);
webRegistry.registerComponent("rich-document", RichDocumentRead);
webRegistry.registerComponent("returned-expression", ReturnedExpressionRead);
// Source Viewable CalendarDate (time.fenel) selects this read leaf.
webRegistry.registerComponent("calendar-date", CalendarDateRead);
// Source Viewable selects this shared body; glyph facts stay with its reader
// and occurrence, just as they do for the existing collection thumbnails.
webRegistry.registerComponent("data-thumbnail", (props: TemplateComponentProps) =>
  <DataThumbnail value={props.value} valueIcon={typeof props.context._valueIcon === "string" ? props.context._valueIcon : undefined}
    emoji={typeof props.context._valueEmoji === "string" ? props.context._valueEmoji : undefined}
    typeIcon={typeof props.context._typeIcon === "string" ? props.context._typeIcon : undefined} />);

/** Display metadata for the same held expression surfaces, including a
 * function's captured source. This never reads or invokes a callable body. */
function readExpressionPresentation(reader: ReaderRuntime | undefined, session: () => AuthoringSession): HeldExpressionPresentation {
  return {
    callable: id => {
      // B3: a Local reader answers callables from its worker references.
      const local = reader?.kind === "local";
      const entry = local ? undefined : session().environment.getFunctionEntry?.(id);
      const declaration = local ? reader.catalogLookups.fn(id) as FenelFunction | undefined
        : session().registry.getIdentifiedFunction(id);
      const metadata = reader?.presentation(id);
      return entry || declaration || metadata ? { id,
        name: presentedDisplayName(metadata) ?? (entry ? functionDisplayName(entry) : undefined),
        icon: metadata?.icon, emoji: metadata?.emoji, picture: metadata?.picture, params: entry?.params ?? declaration?.params,
        returns: entry?.returns ?? declaration?.returns, isConstructor: entry?.kind === "constructor" } : undefined;
    },
    typeLabel: type => reader?.kind === "local" ? reader.typePresentation?.(type)?.label ?? ""
      : typedReadTypeLabel(type, session(), reader),
    fieldLabel: field => fieldSlotName(field, reader?.kind === "local" ? undefined : session().registry),
    reference: id => {
      const metadata = reader?.presentation(id);
      return metadata ? { name: presentedDisplayName(metadata), icon: metadata.icon, emoji: metadata.emoji } : undefined;
    },
    readValue: (data, compact) => <TypedReadValue value={data.value} type={data.type} compact={compact} readSession={session()}
      occurrence={{ state: "unavailable", issue: "This expression inspection has no editable source selection." }} />,
  };
}

/** Source Viewable chooses inspection of the returned Expr itself. Metadata
 * belongs to its current reader; enclosing authoring/trace/capture contexts
 * cannot turn this held value into another request to execute its producer. */
function ReturnedExpressionRead(props: TemplateComponentProps) {
  const reader = useReaderRuntime();
  const inheritedSession = useAuthoringSession();
  const session = () => reader?.session() ?? inheritedSession;
  // B4 wave 4 lane E: a Local reader reads the returned Expr data through
  // the canonical codec in its worker (`read-reader-returned-expression`);
  // its page session is never read. A spinner shows while it is asked.
  const localExpression = reader?.kind === "local"
    ? createLocalReturnedExpression(() => reader, session, () => ({ value: props.value })) : undefined;
  const expression = createMemo(() => localExpression ? localExpression.answer()?.node : returnedExpressionNode(session(), props.value));
  const expressionPending = () => !!localExpression && !localExpression.answer() && !localExpression.failure();
  const presentation = readExpressionPresentation(reader, session);
  return <Show when={expression()} fallback={<Show when={!expressionPending()} fallback={<LensSpinner />}>
    <span class="text-muted" role="status">Expression lens unavailable for this data.</span></Show>}>
    {node => <ExpressionGraphCaptureContext value={{ available: () => false, pending: () => false }}>
      <ExpressionGraphScopeCaptureContext value={{ node: () => undefined, allowed: () => false }}>
        <ExpressionGraphValueContext value={null}>
          <ExpressionEditor expr={node()} inspection={presentation} graphAuthoring={false} hideLabel onChange={() => {}} />
        </ExpressionGraphValueContext>
      </ExpressionGraphScopeCaptureContext>
    </ExpressionGraphCaptureContext>}
  </Show>;
}

/** Reuse the reader's existing reflection for an absent/generic child hint.
 * This selects display metadata only; the declared container type stays intact. */
export function typedReadDisplayType(value: unknown, declared: FenelType | undefined,
  session: AuthoringSession, fieldRegistry?: ModuleRegistry, observedType?: FenelType): FenelType | undefined {
  const resolve = (name: string) => (fieldRegistry ?? session.registry).getIdentifiedEntity(name)?.type
    ?? (fieldRegistry ? undefined : session.environment.resolveTypeRef?.({ $ref: name }));
  const generic = (type: FenelType) => {
    if ("$var" in type) return true;
    if ("$refined" in type || "$tagged" in type) return false;
    const projected = "$ref" in type ? resolve(type.$ref) ?? type : type;
    // An indirect alias can retain a nominal/refinement wrapper that the
    // value projection intentionally erases. Keep that exact declaration.
    if ("$ref" in projected) return false;
    if ("$refined" in projected || "$tagged" in projected) return false;
    const resolved = resolveValueType(projected, resolve);
    return "$complement" in resolved && "$void" in resolved.$complement;
  };
  if (declared && !generic(declared)) return declared;
  if (observedType && !generic(observedType)) return observedType;
  const reflected = typeConstructorOf(value, session.evaluateContext);
  const resolved = reflected && ((fieldRegistry ?? session.registry).getIdentifiedEntity(reflected)?.type
    ?? (fieldRegistry ? undefined : session.environment.resolveTypeRef?.({ $ref: reflected })));
  return reflected && resolved ? { $ref: reflected } : declared ?? observedType;
}

/** Card names are the current reader's existing projections of a reference,
 * never a list position or an identity manufactured from its runtime shape. */
export function typedReadValueCaption(value: unknown, reader?: ReaderRuntime): DisplayNameInput {
  const reference = readLocusCatalogReference(value);
  const presentation = reference && reader?.presentation(reference.id);
  return presentedDisplayName(presentation || undefined);
}

/** A data heading uses its own icon; the separate type row keeps type defaults. */
export function typedReadValueIcon(value: unknown, reader?: ReaderRuntime): string | undefined {
  const reference = readLocusCatalogReference(value);
  return reference ? reader?.ownIcon?.(reference.id) : undefined;
}

export function typedReadTypeOwnIcon(type: FenelType, reader?: ReaderRuntime): string | undefined {
  const target = presentedTypeTarget(type);
  return target ? reader?.ownIcon?.(target) : undefined;
}

/** Hover, graph and detailed cards use the same existing type formatter. */
export function typedReadTypeLabel(type: FenelType | undefined, session: AuthoringSession,
  reader?: ReaderRuntime, fieldRegistry?: ModuleRegistry): string {
  // Local captions belong to the snapshot's worker. Missing captions stay
  // misses for the caller's existing display fallback, without page reads.
  if (reader?.kind === "local") return type ? reader.typePresentation?.(type)?.label ?? "" : "Anything";
  return readerTypeLabelInSession(type, session, reader, fieldRegistry);
}

/** The same checked type facts supply card captions, type data and signatures. */
export function typedReadTypePresentation(type: FenelType, session: AuthoringSession,
  reader?: ReaderRuntime, fieldRegistry?: ModuleRegistry): FunctionCardType<FenelType> {
  const presentation = readerTypePresentationInSession(type, session, reader, fieldRegistry, LUCIDE_BY_NAME);
  return { ...presentation, label: valueCardTypeLabel(presentation.label) || "Type" };
}

/** The typed read surface shared by full values and compact previews. The
 * surrounding card controls its size; template selection and structural
 * rendering stay in the same reader and the same universal read components.
 * Held callable data is never invoked by this display. Numeric text is a pure
 * source projection evaluated in the same captured reader as the data. */
type TypedReadNavigation = {
  value: unknown;
  path: readonly (string | number)[];
  current: () => boolean;
};
type TypedReadValueProps = {
  value: unknown;
  type?: FenelType;
  compact?: boolean;
  /** The focused occurrence's authored source, supplied by its existing
   * owner. Browser provenance only: never transported or recovered from a
   * runtime closure or another function's declaration. Absence of a lambda
   * (or a retired capture) keeps the signature and says the body is unavailable. */
  functionSource?: { node?: ExprNode; current: () => boolean;
    /** Where each signature slot got its type (written or inferred), from the
     * function's declaration; absent when the owner does not know. */
    origins?: FunctionSignatureOrigins };
  /** Detailed data uses the shared structural/transfer owner and typed leaves. */
  detail?: boolean;
  renderChild?: (value: ContainedValuePreview, render: () => JSX.Element) => JSX.Element;
  /** The shared collection circle shows media, then a registered Iconable icon,
   * then that item's Emojiable glyph. */
  thumbnail?: boolean;
  /** Contextual occurrence/value Iconable, resolved by the owning reader. */
  valueIcon?: string;
  /** Emojiable glyph used when this item has no registered Iconable icon. */
  valueEmoji?: string;
  /** The surrounding data surface keeps generic inspection and transfer. */
  templateOnly?: boolean;
  /** Identified layout slots keep their explicit field/type owner. */
  fieldRegistry?: ModuleRegistry;
  /** Optional callable presentation supplied by this value's owning reader. */
  callableName?: (handle: string) => string | undefined;
  /** Existing card/locus owners decide where a contained value opens. */
  onOpenData?: (data: ContainedValuePreview) => void;
  /** The existing data owner receives the nearest displayed occurrence. */
  onDataContext?: (event: MouseEvent, data: ContainedValuePreview) => void;
  occurrence?: DataOccurrenceSource;
  onOpenType?: (type: FenelType) => void;
  /** Current occurrence glyph for shared thumbnails and fallback previews.
   * Custom presentation selection and media preview retain precedence. */
  fallback?: JSX.Element;
  /** The structural owner supplies its existing recursive body when no view wins. */
  structuralFallback?: (facts?: ValueStructureFacts) => JSX.Element;
  /** The structural owner's current occurrence path, including variant payloads. */
  dataPath?: readonly (string | number)[];
  /** Browser-only provenance shared by recursive read leaves, never a DTO. */
  readNavigation?: TypedReadNavigation;
  /** Existing parent frame forwarded through recursive fallback rendering. */
  readSession?: AuthoringSession;
  /** The structural parent's existing contained-value wrapper paints only
   * after this child's own value/facts pair is ready. */
  readWrap?: ContainedValueWrapper;
  readContainedLabel?: string;
  /** Nested record rows stop after a few levels and use the short printer. */
  recordDepth?: number;
};
type LocalTypedReadInput = {
  session: AuthoringSession;
  worker: PreparedReaderWorker;
  templates: TemplateRegistry;
  wire: SourceReaderValueReadInput;
  /** The wire's exact bytes (`exactTransportKey`); absent when unkeyable. */
  wireKey: string | undefined;
  ui: TypedReadValueProps;
  revision: number;
} | { error: unknown };

// True for the value of a record's field row: there a list shows its items' names
// (CollectionChips). Table and calendar cells, tiles and compact cards keep marks.
const RecordFieldValueContext = createContext<boolean>(false);

export function TypedReadValue(props: TypedReadValueProps) {
  const reader = useReaderRuntime();
  const inheritedSession = useAuthoringSession();
  let alive = true;
  let pendingRead: AbortController | undefined;
  type ReadRequest = { input: Extract<LocalTypedReadInput, { worker: PreparedReaderWorker }>;
    controller: AbortController; state: "pending" | "ready" | "error" };
  let activeRequest: ReadRequest | undefined;
  const [readRequest, setReadRequest] = createSignal<ReadRequest | undefined>(undefined, { ownedWrite: true });
  onSettled(() => {
    const closed = () => pendingRead?.abort(new Error("This data's reader was closed."));
    reader?.client.signal?.addEventListener("abort", closed, { once: true });
    return () => { alive = false; pendingRead?.abort(); reader?.client.signal?.removeEventListener("abort", closed); };
  });
  const readInput = createMemo<LocalTypedReadInput | undefined>(() => {
    if (reader?.kind !== "local" && reader?.kind !== "public") return undefined;
    try {
      // B3: Local reads and qualified public base reads use the worker's
      // packet. Local function/draft selection retains its existing owner.
      const base = reader.session();
      const requested = props.readSession ?? base;
      // Repository projection is qualified only for this prepared base owner.
      // Foreign/draft/module frames retain their existing scoped read body.
      if (reader.kind === "public" && (requested.mode !== "detached" || requested.sourceModule !== undefined
        || concreteAuthoringSession(requested) !== concreteAuthoringSession(base)
        || requested.registry !== base.registry || requested.environment !== base.environment || requested.evaluateContext !== base.evaluateContext
        || props.fieldRegistry !== undefined && props.fieldRegistry !== reader.registry())) return undefined;
      const session = reader.kind === "local"
        ? localReaderReadSession(base, inheritedSession, reader.registry(), props.fieldRegistry) : requested;
      if (!session) throw new Error("This data's display is unavailable here.");
      const worker = preparedReaderWorkerForSession(session);
      if (!worker) throw new Error("This reader's display tools are not ready.");
      const templates = reader.templates();
      const componentNames = templates.listComponentNames?.();
      if (!componentNames) throw new Error("This reader's display tools are not ready.");
      // Reflect reads subscribe to deep store properties at the earliest
      // capture. Native leaves and descriptor refusals use the same transport
      // boundary as the prepared worker; the original value stays private.
      const wire = registryTransportSnapshot<SourceReaderValueReadInput>({
        value: props.value, type: props.type, compact: props.compact,
        thumbnail: props.thumbnail, templateOnly: props.templateOnly,
        typeLookup: props.fieldRegistry ? "registry" : "session",
        views: templates.list(), componentNames,
      }, "typed reader value request", "value-read", Reflect.get);
      // The focused function's source is page provenance the body reads live
      // (`functionExpression`), not part of this worker read: a new capture of
      // the same source must not start a new read (Local `/~/<function>`).
      const ui = { value: props.value, type: props.type, compact: props.compact, detail: props.detail,
        get functionSource() { return props.functionSource; },
        renderChild: props.renderChild, thumbnail: props.thumbnail, valueIcon: props.valueIcon,
        valueEmoji: props.valueEmoji, templateOnly: props.templateOnly, fieldRegistry: props.fieldRegistry,
        callableName: props.callableName, onOpenData: props.onOpenData, onDataContext: props.onDataContext,
        occurrence: props.occurrence, onOpenType: props.onOpenType, structuralFallback: props.structuralFallback,
        dataPath: props.dataPath, readNavigation: props.readNavigation, readWrap: props.readWrap,
        readContainedLabel: props.readContainedLabel, recordDepth: props.recordDepth,
        get fallback() { return props.fallback; } };
      let wireKey: string | undefined;
      try { wireKey = exactTransportKey(wire); } catch { wireKey = undefined; }
      return { session, worker, templates, wire, wireKey, ui, revision: reader.revision() };
    } catch (error) {
      if (error instanceof NotReadyError) throw error;
      return { error };
    }
  }, {
    // A re-run that asks the worker the same question (an upstream memo that
    // re-ran with the same value) keeps its input: a new one would make the
    // painted body stale until the same answer returns, and a focused
    // function then fell back to "Function body unavailable in this reader."
    equals: (previous, next) => previous === next || !!previous && !!next && "worker" in previous && "worker" in next
      && previous.session === next.session && previous.worker === next.worker && previous.templates === next.templates
      && previous.revision === next.revision && previous.wireKey !== undefined && previous.wireKey === next.wireKey
      && (Object.keys(next.ui) as (keyof TypedReadValueProps)[]).every(key => key === "fallback" || key === "functionSource"
        || previous.ui[key] === next.ui[key]),
  });
  const current = (input: ReturnType<typeof readInput>) => {
    if (!alive || reader?.client.signal?.aborted || !input || !("worker" in input)) return false;
    try { return latest(readInput) === input && preparedReaderWorkerForSession(input.session) === input.worker; }
    catch { return false; }
  };
  const projectedRead = createAsyncValue(() => ({ input: readInput() }), ({ input }) => {
    pendingRead?.abort(); pendingRead = undefined;
    if (!input) return undefined;
    if ("error" in input) throw input.error;
    const controller = new AbortController(); pendingRead = controller;
    const request: ReadRequest = { input, controller, state: "pending" }; activeRequest = request;
    // Keep status publication outside owned compute even when a native event
    // pulls this graph through latest(). The private token refuses immediately;
    // its UI mirror lands in a separate microtask.
    queueMicrotask(() => {
      if (alive && pendingRead === controller && !controller.signal.aborted && activeRequest === request)
        setReadRequest(request);
    });
    // A Local reader shares and keeps these reads (one per worker incarnation,
    // template roster and captured value): a publication or a remount that
    // changes none of them asks nothing. Any read it does not serve (another
    // worker context, a public reader) asks its worker directly, as before.
    const shared: Promise<unknown> | undefined = reader?.kind === "local"
      ? reader.readValue?.(input.worker, input.wire, input.templates, controller.signal) : undefined;
    const asked: Promise<unknown> = shared ?? runPreparedReaderWorker(input.worker, { method: "project-reader-values", inputs: [input.wire],
      knownIcons: Object.keys(LUCIDE_BY_NAME) }, controller.signal);
    return asked.then(reply => {
      controller.signal.throwIfAborted();
      if (!current(input)) throw new Error("This data's reader was replaced.");
      const packets = (reply as AuthoringReaderValueReads).valueReads;
      const packet = Array.isArray(packets) && packets.length === 1 ? packets[0] : undefined;
      if (!packet || !packet.root || !Array.isArray(packet.children)
        || !packet.root.field || !packet.root.glyph || typeof packet.root.numeric !== "boolean"
        || !["held-type", "callable-type", "optional", "preview", "collection", "string", "scalar", "structural"].includes(packet.root.body)
        || typeof packet.root.recordLabel !== "string" || packet.root.body === "scalar" && !packet.root.scalarPlan
        || !["record", "array", "leaf"].includes(packet.root.structure)
        || !Object.hasOwn(packet.root, "readPlan") || packet.root.readPlan !== null
          && (!packet.root.readPlan || typeof packet.root.readPlan !== "object"))
        throw new Error("This data's display is unavailable.");
      if (alive && pendingRead === controller) {
        activeRequest = { input, controller, state: "ready" }; setReadRequest(activeRequest);
      }
      return { input, packet, controller };
    }).catch(error => {
      if (alive && pendingRead === controller) {
        activeRequest = { input, controller, state: "error" }; setReadRequest(activeRequest);
      }
      throw error;
    }).finally(() => { if (pendingRead === controller) pendingRead = undefined; });
  });
  const readOutcome = createMemo(() => ({ result: projectedRead(), error: projectedRead.error }));
  const busy = () => {
    const input = readInput(), request = readRequest();
    return !!input && "worker" in input && request?.input === input && request.state === "pending";
  };
  const paint = createMemo<Awaited<ReturnType<typeof projectedRead>> | undefined>(previous => {
    const input = readInput();
    const result = latest(readOutcome).result;
    if (!input || !("worker" in input)) return undefined;
    const request = readRequest();
    if (request?.input === input && request.state === "error") return undefined;
    if (result?.input === input) return result;
    // The retained body always owns its immutable value snapshot and facts.
    // Its action ports refuse while a newer lease is pending. Another reader,
    // field owner or template snapshot never inherits this paint.
    return previous && previous.input.session === input.session
      && previous.input.worker === input.worker && previous.input.templates === input.templates
      && previous.input.ui.fieldRegistry === input.ui.fieldRegistry
      && previous.input.wire.typeLookup === input.wire.typeLookup ? previous : undefined;
  });
  const paintOwner = createMemo<{ session: AuthoringSession; worker: PreparedReaderWorker; templates: TemplateRegistry;
    fieldRegistry: ModuleRegistry | undefined; typeLookup: SourceReaderValueReadInput["typeLookup"] } | undefined>(previous => {
    const bound = paint();
    if (!bound) return undefined;
    if (previous?.session === bound.input.session && previous.worker === bound.input.worker
      && previous.templates === bound.input.templates && previous.fieldRegistry === bound.input.ui.fieldRegistry
      && previous.typeLookup === bound.input.wire.typeLookup) return previous;
    return { session: bound.input.session, worker: bound.input.worker, templates: bound.input.templates,
      fieldRegistry: bound.input.ui.fieldRegistry, typeLookup: bound.input.wire.typeLookup };
  });
  // B3: Retry also forgets the presentation cache's failed answers.
  const retry = async () => {
    const captured = readInput();
    const restored = await reader?.retryPresentation?.();
    if (!alive || restored === false || readInput() !== captured) return;
    activeRequest = undefined;
    return projectedRead.refetch();
  };
  const unavailable = () => <span><span class="text-muted" role="alert">This data's display is unavailable.</span>{" "}
    <button type="button" class="expr-form__btn" onClick={() => { void retry(); }}>Retry</button></span>;
  const failed = () => {
    const input = readInput();
    if (!input) return false;
    if ("error" in input) return true;
    const request = readRequest();
    return request?.input === input && request.state === "error";
  };
  return <Show when={readInput()} fallback={<TypedReadValueBody {...props} />}>
    <Show when={paintOwner()} keyed fallback={<Show when={!busy() && failed()}
      fallback={<span class="home-new-button__spinner" style="display:inline-block;width:12px;height:12px;position:static;vertical-align:middle" role="status" aria-label="Loading" />}>{unavailable()}</Show>}>
      {owner => {
        const ownerPaint = createMemo<NonNullable<ReturnType<typeof paint>>>(previous =>
          paintOwner() === owner ? paint() ?? previous! : previous!);
        const ports = createMemo(() => {
          const bound = ownerPaint(), input = bound.input;
          const isCurrent = () => {
            // Track the committed mirror even while the synchronous token
            // refuses. The token only closes the pre-flush window; it cannot
            // grant readiness ahead of the graph's committed receipt.
            const request = readRequest(), active = activeRequest;
            return current(input) && active?.input === input && active.state === "ready"
              && request?.input === input && request.state === "ready" && request.controller === active.controller
              && request.controller === bound.controller
              && (!input.ui.readNavigation || input.ui.readNavigation.current());
          };
          const navigation = input.ui.readNavigation ?? { value: input.ui.value, path: input.ui.dataPath ?? [], current: isCurrent };
          const selection = (data: ContainedValuePreview): ContainedValuePreview | undefined => {
            if (!isCurrent()) return undefined;
            const prefix = navigation.path;
            if (data.path.length < prefix.length || !prefix.every((key, index) => data.path[index] === key)) return undefined;
            const path = data.path.slice(prefix.length);
            // A custom read component may deliberately introduce a new data
            // root. Only the matching root or a retained physical child maps
            // back to this occurrence's original value.
            if (!path.length && !Object.is(data.value, input.wire.value)) return data;
            let value = navigation.value;
            for (const key of path) {
              if (value === null || typeof value !== "object") return undefined;
              const descriptor = Object.getOwnPropertyDescriptor(value, key);
              if (!descriptor || !Object.hasOwn(descriptor, "value")) return undefined;
              value = Reflect.get(value, key);
            }
            return { ...data, value };
          };
          return { input, packet: bound.packet, current: isCurrent, navigation, selection,
            openData: input.ui.onOpenData ? (data: ContainedValuePreview) => {
              const selected = selection(data); if (selected) input.ui.onOpenData?.(selected);
            } : undefined,
            dataContext: input.ui.onDataContext ? (event: MouseEvent, data: ContainedValuePreview) => {
              const selected = selection(data); if (selected) input.ui.onDataContext?.(event, selected);
            } : undefined,
            openType: input.ui.onOpenType ? (type: FenelType) => { if (isCurrent()) input.ui.onOpenType?.(type); } : undefined };
        });
        const body = (structure?: ValueStructureRender) => <TypedReadValueBody {...ports().input.ui} value={ports().input.wire.value} type={ports().input.wire.type}
            readFacts={ports().packet} readSession={owner.session} readTemplates={owner.templates}
            readCurrent={ports().current} readMapSelection={ports().selection} readNavigation={ports().navigation}
            onOpenData={ports().openData} onDataContext={ports().dataContext} onOpenType={ports().openType}
            structuralFallback={structure ?? ports().input.ui.structuralFallback} />;
        const contained: ContainedValuePreview = {
          get value() { return ports().input.wire.value; },
          get label() { return ports().input.ui.readContainedLabel ?? "Data"; },
          get caption() { return ports().packet.root.caption; },
          get path() { return ports().input.ui.dataPath ?? []; },
          getType: () => ports().packet.root.displayType ?? ports().packet.root.valueType ?? ports().input.wire.type,
          get typeLabel() { return valueCardTypeLabel(ports().packet.root.typePresentation?.label ?? "") || "Anything"; },
          get typeIcon() { return ports().packet.root.typePresentation?.icon; },
          get valueIcon() { return ports().packet.root.ownPresentation?.icon; },
          get valueEmoji() { return ports().packet.root.ownPresentation?.emoji; },
          get readFacts() { return ports().packet; }, get readCurrent() { return ports().current; },
        };
        return <span style="display:contents" aria-busy={busy() ? "true" : undefined}>
          <Show when={ports().input.ui.readWrap} fallback={body()}>{wrap => <>{wrap()(contained, body)}</>}</Show>
          <Show when={busy()}><span class="home-new-button__spinner" style="display:inline-block;width:12px;height:12px;position:static;vertical-align:middle" role="status" aria-label="Loading" /></Show>
        </span>;
      }}
    </Show>
  </Show>;
}

function TypedReadValueBody(props: TypedReadValueProps & {
  readFacts?: SourceReaderValueReadPacket;
  readTemplates?: TemplateRegistry;
  readCurrent?: () => boolean;
  readMapSelection?: (data: ContainedValuePreview) => ContainedValuePreview | undefined;
}) {
  const reader = useReaderRuntime();
  // An item's own glyph (a constructor's picture), for a record card's portrait.
  const itemGlyphs = useItemPresentation();
  const focused = useValueCardFocused();
  // A Bool inside a record field is data and reads as the table lens reads it (boolean-text.ts).
  const inlineData = useValueCardInline();
  const inRecordField = useContext(RecordFieldValueContext);
  const inheritedSession = useAuthoringSession();
  const session = () => props.readSession ?? reader?.session() ?? inheritedSession;
  const registry = () => props.fieldRegistry ?? session().registry;
  // B4 F1: a Local packet's children keep this reader's field owner by
  // identity with its snapshot; the page session's registry is not read.
  const fieldOwner = () => props.readFacts && reader?.kind === "local" ? props.fieldRegistry ?? reader.registry() : registry();
  const templates = () => props.readTemplates ?? reader?.templates() ?? webRegistry;
  // B3: a Local packet render resolves declared type names inertly, without
  // the page registry; reflection and dispatch already happened in the worker.
  const resolveType = (name: string) => props.readFacts && reader?.resolveTypeName ? reader.resolveTypeName(name)
    : registry().getIdentifiedEntity(name)?.type
      ?? (props.fieldRegistry ? undefined : session().environment.resolveTypeRef?.({ $ref: name }));
  const declaredIdentity = createMemo(() => {
    if (props.readFacts) return props.readFacts.root.nominal;
    const type = props.type;
    if (!type) return undefined;
    const handle = refHandle(type);
    if (handle && resolveType(handle)) return handle;
    return "$opaque" in type ? type.$opaque.name : undefined;
  });
  const nominal = createMemo(() => {
    if (props.readFacts) return props.readFacts.root.nominal;
    const declared = declaredIdentity();
    if (declared) return declared;
    // A broad list element hint need not erase the actual constructor's
    // registered owner. Ordinary anonymous structures have no such identity.
    const reflected = typeConstructorOf(props.value, session().evaluateContext);
    return reflected && resolveType(reflected) ? reflected : undefined;
  });
  const representation = (typeName: string) => {
    if (props.readFacts) return undefined;
    const id = nominal();
    if (id && reader) return reader.representation(typeName, id);
    const frame = session().evaluateContext;
    if (id) return frame._specRegistry ? resolveEffect(frame, frame._specRegistry, typeName, id)?.methods : undefined;
    // Anonymous checked type witnesses use the same scoped Iconable dispatch,
    // without manufacturing a nominal owner or a renderer-specific icon rule.
    return typeName === "Iconable" && props.type && frame._specRegistry
      ? resolveEffect(frame, frame._specRegistry, typeName, props.type)?.methods : undefined;
  };
  const view = createMemo(() => {
    if (props.readFacts) return props.readFacts.root.view;
    const methods = representation("Viewable");
    // Viewable declares String methods. Retain the legacy Maybe wire only at
    // this rendering boundary; selection still uses this reader's snapshot.
    const name = (value: unknown): string | undefined => typeof value === "string" ? value
      : peelMaybeValue<string>((value ?? Nothing) as Parameters<typeof peelMaybeValue<string>>[0]) ?? undefined;
    const inline = props.compact
      ? name(methods?.defaultInlineView)
      : undefined;
    const full = name(methods?.defaultView);
    for (const viewName of [inline, full]) {
      const template = viewName ? templates().resolve(viewName) : undefined;
      const component = template?.readComponent ?? template?.component;
      if (template && ((component && templates().getComponent(component)) || template.layout
        || peelMaybeValue(peelMaybeValue(template.display)?.read ?? Nothing))) return template;
    }
    return undefined;
  });
  const icon = createMemo(() => {
    if (props.readFacts) return props.readFacts.root.icon;
    const value = representation("Iconable")?.icon;
    return typeof value === "string" && LUCIDE_BY_NAME[value] ? value : undefined;
  });
  const thumbnailIcon = createMemo(() => {
    if (props.readFacts) return props.readFacts.root.thumbnailIcon;
    const frame = session().evaluateContext;
    return props.type || nominal() ? typeIconForPresentation(props.type, {
      icon: target => typeof target === "string" && reader ? reader.representation("Iconable", target)?.icon
        : frame._specRegistry ? resolveEffect(frame, frame._specRegistry, "Iconable", target)?.methods.icon : undefined,
      canonicalName: identity => registry().getIdentifiedEntity(identity)?.id ?? identity,
      reflectedIdentity: nominal(),
      knownIcons: LUCIDE_BY_NAME,
    }) : undefined;
  });
  const glyph = createMemo(() => {
    if (props.readFacts) return props.readFacts.root.glyph;
    if (!props.thumbnail) return {};
    const frame = session().evaluateContext;
    return listPreviewGlyph(frame, props.value, nominal() ? [nominal()] : [], (className, key) => {
      if (typeof key !== "string") return undefined;
      if (reader) return reader.representation(className, key);
      return frame._specRegistry ? resolveEffect(frame, frame._specRegistry, className, key)?.methods : undefined;
    });
  });
  // Reflection selects presentation but must keep a supplied application and
  // its element types, even when its outer identity is computed with $el.
  const valueType = createMemo<FenelType | undefined>(() => props.readFacts ? props.readFacts.root.valueType
    : props.type && !("$var" in props.type) ? props.type : nominal() ? { $ref: nominal()! } : props.type);
  const optional = createMemo(() => props.readFacts ? props.readFacts.root.optional ? { value: props.readFacts.root.optional.type } : null
    : (props.type && peelMaybeForAuthoring(resolveValueType(props.type, resolveType)))
      || (valueType() ? peelMaybeForAuthoring(resolveValueType(valueType()!, resolveType)) : null));
  // A value of a type with several constructors (`SetExpr`: `SeEnum values: List Any`)
  // is read by the fields of the case it names, typed, not by the untyped
  // preview's raw tags (carried-constructor.ts).
  const carried = createMemo(() => {
    if (props.readFacts) return undefined;
    const entity = nominal() ? registry().getIdentifiedEntity(nominal()!) : undefined;
    return carriedConstructor(entity?.type ?? valueType(), props.value, { resolveNamedType: resolveType });
  });
  const fields = createMemo(() => {
    if (props.readFacts) return props.readFacts.root.fields;
    const entity = nominal() ? registry().getIdentifiedEntity(nominal()!) : undefined;
    const declared = entity ? entitySchemaFields(entity) : recordFieldsForType(valueType(), session().environment);
    if (declared?.length) return declared;
    return singleConstructorFields(entity?.type ?? valueType(), { resolveNamedType: resolveType }) ?? carried()?.fields ?? declared;
  });
  // That case is named above its fields, as the untyped preview named it: by its
  // own Labelable when it has one, else by its code name.
  const caseName = (): DisplayNameInput => {
    const shown = carried();
    if (!shown || fields() !== shown.fields) return undefined;
    return constructorLabel(session().evaluateContext, shown.tag) ?? codeName(shown.tag);
  };
  const field = createMemo(() => props.readFacts ? props.readFacts.root.field : ({ name: "value", type: valueType() ?? { $ref: "Any" } as FenelType,
    label: Nothing, meta: {}, ui: Nothing }));
  const heldType = createMemo(() => {
    if (props.readFacts) return props.readFacts.root.heldType;
    const declared = valueType();
    return declared && "$type" in resolveValueType(declared, resolveType) && isFenelTypeLike(props.value)
      ? props.value : undefined;
  });
  const callableType = createMemo(() => {
    if (props.readFacts) return props.readFacts.root.callableType;
    const declared = valueType();
    const resolved = declared && resolveValueType(declared, resolveType);
    return resolved && "$arrow" in resolved ? resolved : undefined;
  });
  const functionExpression = () => {
    const source = props.functionSource;
    if (!source || !source.current() || props.readCurrent && !props.readCurrent()) return undefined;
    const node = source.node;
    return node?.kind === "literal" && detectStructuralForm(node.value, () => true)?.kind === "lambda" ? node : undefined;
  };
  const functionPresentation = readExpressionPresentation(reader, session);
  const numericValue = createMemo(() => {
    if (props.readFacts) return props.readFacts.root.numeric;
    const name = nativeValueTypeName(resolveValueType(field().type, resolveType));
    return !!name && !!fieldNumericTextCodecPlan(name);
  });
  const collection = createMemo(() => props.readFacts ? props.readFacts.root.structure === "array"
    ? props.readFacts.children.map(child => ({ key: child.key,
      value: Object.getOwnPropertyDescriptor(props.value, child.key)?.value, label: child.label })) : undefined
    : Array.isArray(props.value) ? childrenOf(props.value) : undefined);
  const childType = (key: number | string) => {
    if (props.readFacts) return props.readFacts.children.find(child => child.key === key)?.type;
    const declared = childValueType(props.value, valueType(), key, session());
    const child = collection()?.find(item => item.key === key);
    return child ? typedReadDisplayType(child.value, declared, session(), props.fieldRegistry) : declared;
  };
  const childTypeLabel = (type: FenelType | undefined, key?: number | string) => props.readFacts
    ? props.readFacts.children.find(child => child.key === key)?.typeLabel ?? "Anything"
    : typedReadTypeLabel(type, session(), reader, props.fieldRegistry);
  const childCaption = (value: unknown, key?: number | string) => props.readFacts
    ? props.readFacts.children.find(child => child.key === key)?.caption : typedReadValueCaption(value, reader);
  const childPresentation = (value: unknown, key?: number | string) => {
    if (props.readFacts) return props.readFacts.children.find(child => child.key === key)?.ownPresentation;
    const reference = readLocusCatalogReference(value);
    return reference ? reader?.presentation(reference.id) : undefined;
  };
  const childIcon = (value: unknown, type: FenelType | undefined, key?: number | string) => {
    if (props.readFacts) return props.readFacts.children.find(child => child.key === key)?.typeIcon;
    const frame = session().evaluateContext;
    return typeIconForPresentation(type, {
      icon: target => typeof target === "string" && reader ? reader.representation("Iconable", target)?.icon
        : frame._specRegistry ? resolveEffect(frame, frame._specRegistry, "Iconable", target)?.methods.icon : undefined,
      canonicalName: identity => registry().getIdentifiedEntity(identity)?.id ?? identity,
      reflectedIdentity: typeConstructorOf(value, frame),
      knownIcons: LUCIDE_BY_NAME,
    });
  };
  const childData = (child: { key: number | string; value: unknown; label: string }): ContainedValuePreview => ({
    value: child.value, label: child.label, caption: childCaption(child.value, child.key), path: [...(props.dataPath ?? []), child.key], getType: () => childType(child.key),
    typeLabel: childTypeLabel(childType(child.key), child.key),
    typeIcon: childIcon(child.value, childType(child.key), child.key),
  });
  let dataContextOutlet: ((event: MouseEvent, data: ContainedValuePreview) => void) | undefined;
  const contextData = (event: MouseEvent, data: ContainedValuePreview) => dataContextOutlet?.(event, data);
  const openChild = (child: { key: number | string; value: unknown; label: string }) => props.onOpenData?.(childData(child));
  // In a record's field, each item shows its mark and its short name (collection-chips.ts).
  const chipText = (value: unknown, key: number | string) => chipName(value, {
    caption: item => displayNameText(childCaption(item, key)),
    constructorName: tag => constructorLabel(session().evaluateContext, tag) ?? tag,
  });
  const chipsBody = () => <CollectionChips items={collection()!} label="Items" itemLabel={child => child.label}
    itemName={child => chipText(child.value, child.key)} itemHref={child => chipHref(child.value)}
    onOpenItem={props.onOpenData ? openChild : undefined}
    onItemContextMenu={(event, child) => contextData(event, childData(child))}
    onEnterCollection={props.onOpenData ? () => props.onOpenData?.({ value: props.value, label: "Data", path: props.dataPath ?? [], getType: valueType }) : undefined}
    render={child => <TypedReadValue value={child.value} type={childType(child.key)} thumbnail
      fieldRegistry={props.fieldRegistry} callableName={props.callableName} occurrence={props.occurrence}
      dataPath={[...(props.dataPath ?? []), child.key]} onDataContext={props.onDataContext} readNavigation={props.readNavigation} />}
    preview={child => <ValueCard presentation="inline" compactLayout="two-line" heading={<ValueCardCaption caption={childCaption(child.value, child.key)}
      picture={childPresentation(child.value, child.key)?.picture} icon={childPresentation(child.value, child.key)?.icon} emoji={childPresentation(child.value, child.key)?.emoji}
      typeLabel={childTypeLabel(childType(child.key), child.key)}
      typeIcon={childIcon(child.value, childType(child.key), child.key)} />}>
      <TypedReadValue value={child.value} type={childType(child.key)} fieldRegistry={props.fieldRegistry}
        callableName={props.callableName} dataPath={[...(props.dataPath ?? []), child.key]} onOpenData={props.onOpenData} onOpenType={props.onOpenType}
        onDataContext={props.onDataContext} occurrence={props.occurrence} readNavigation={props.readNavigation} />
    </ValueCard>} />;
  const showChips = () => inRecordField && !props.compact && !props.thumbnail;
  const collectionBody = () => showChips() ? chipsBody() : <CollectionPreviewStrip items={collection()!} label="Items" inlinePreviews
    itemLabel={child => child.label} onOpenItem={props.onOpenData ? openChild : undefined}
    onItemContextMenu={(event, child) => contextData(event, childData(child))}
    onEnterCollection={props.onOpenData ? () => props.onOpenData?.({ value: props.value, label: "Data", path: props.dataPath ?? [], getType: valueType }) : undefined}
    itemControl={child => <ExpressionGraphCollectionItemControl data={childData(child)} source={props.value}
      occurrence={props.occurrence ? { source: props.occurrence, path: [...(props.dataPath ?? []), child.key] } : undefined}
      render={(data, onOpenData, occurrence) => <TypedReadValue value={data ? data.value : child.value} type={data ? data.type : childType(child.key)}
        fieldRegistry={props.fieldRegistry} callableName={props.callableName} onOpenData={onOpenData} onOpenType={props.onOpenType}
        onDataContext={props.onDataContext} dataPath={occurrence?.path ?? [...(props.dataPath ?? []), child.key]}
        readNavigation={data ? undefined : props.readNavigation}
        occurrence={occurrence?.source ?? (data ? { state: "unavailable", issue: "This preview has no source selection here." } : props.occurrence)} />} />}
    render={child => <TypedReadValue value={child.value} type={childType(child.key)} thumbnail
      fieldRegistry={props.fieldRegistry} callableName={props.callableName} occurrence={props.occurrence}
      dataPath={[...(props.dataPath ?? []), child.key]} onDataContext={props.onDataContext} readNavigation={props.readNavigation} />}
    preview={child => <ValueCard presentation="inline" compactLayout="two-line" heading={<ValueCardCaption caption={childCaption(child.value, child.key)}
      picture={childPresentation(child.value, child.key)?.picture} icon={childPresentation(child.value, child.key)?.icon} emoji={childPresentation(child.value, child.key)?.emoji}
      typeLabel={childTypeLabel(childType(child.key), child.key)}
      typeIcon={childIcon(child.value, childType(child.key), child.key)} />}>
      <TypedReadValue value={child.value} type={childType(child.key)} fieldRegistry={props.fieldRegistry}
        callableName={props.callableName} dataPath={[...(props.dataPath ?? []), child.key]} onOpenData={props.onOpenData} onOpenType={props.onOpenType}
        onDataContext={props.onDataContext} occurrence={props.occurrence} readNavigation={props.readNavigation} />
    </ValueCard>} />;
  const fallback = () => props.templateOnly ? null : <Show when={props.fallback} fallback={
    <Show when={props.compact && !numericValue() && icon()} fallback={
      <VariantValueRenderer type={field().type} value={props.value} compact={props.compact} resolveType={resolveType}
        callableName={props.callableName} />
    }>{(name) => <IconByName name={name()} size={24} />}</Show>
  }>{props.fallback}</Show>;
  // A record with known fields uses those fields (record display rule: the
  // row owner decides when a compact space keeps the per-field strip).
  // Thumbnails and a deep nest keep the short printer. Every record, not one type.
  const recordFields = (): FieldDef[] | undefined => {
    if (props.thumbnail || (props.recordDepth ?? 0) >= 6) return undefined;
    if (props.readFacts && (props.readFacts.root.structure !== "record" || props.readFacts.root.body !== "structural")) return undefined;
    const listed = fields();
    if (!listed || listed.length === 0) return undefined;
    const value = props.value;
    if (!value || typeof value !== "object" || Array.isArray(value)) return undefined;
    return listed;
  };
  // No declared fields yet: still read the record's own keys. Compact
  // previews keep the short printer. An explicit structural fallback keeps
  // the transfer tree that asked for it.
  const schemaLessRecord = (): boolean => {
    if (props.compact || props.thumbnail || props.structuralFallback || (props.recordDepth ?? 0) >= 6) return false;
    if (props.readFacts && (props.readFacts.root.structure !== "record" || props.readFacts.root.body !== "structural")) return false;
    const value = props.value;
    if (!value || typeof value !== "object" || Array.isArray(value) || hasDataPreview(value)) return false;
    const prototype = Object.getPrototypeOf(value);
    if (prototype !== Object.prototype && prototype !== null) return false;
    return Object.keys(value).some(key => !key.startsWith("$"));
  };
  const generic = () => <Show when={heldType()} fallback={<Show when={callableType()} fallback={<Show when={optional()} fallback={props.templateOnly ? null :
    <Show when={props.readFacts ? props.readFacts.root.body === "preview" : hasDataPreview(props.value)} fallback={<Show when={collection()} fallback={
    <Show when={props.readFacts ? props.readFacts.root.body === "string" || props.readFacts.root.body === "scalar"
      : props.value === null || typeof props.value !== "object"} fallback={<Show when={recordFields()} fallback={<Show when={schemaLessRecord()} fallback={props.structuralFallback ? props.structuralFallback(() => ({ facts: props.readFacts, value: props.value })) : fallback()}>
      <StructuralReadValue value={props.value} depth={props.recordDepth ?? 0} />
    </Show>}>
      {listed => {
        // B4 F1: a Local packet carries each field's wire key and name.
        const packetSlot = (index: number) => props.readFacts?.root.fieldSlots?.[index];
        const wire = (index: number) => props.readFacts ? packetSlot(index)?.wire ?? listed()[index]!.name : fieldWireKey(listed()[index]!, registry());
        const slotType = (index: number) => props.readFacts?.children.find(child => child.key === wire(index))?.type ?? listed()[index]!.type;
        const fieldValue = (index: number) => Object.getOwnPropertyDescriptor(props.value, wire(index))?.value;
        const fieldLabel = (index: number) => props.readFacts
          ? packetSlot(index)?.name ?? codeName(listed()[index]!.name) : fieldSlotName(listed()[index]!, registry());
        const nested = (props.recordDepth ?? 0) >= 1;
        const slots = () => listed().map((slot, index) => ({ key: wire(index), value: fieldValue(index), index,
          label: displayNameText(fieldLabel(index)) ?? slot.name }));
        // Tight space keeps the compact per-field strip (one circle per field).
        const dense = () => <CollectionPreviewStrip items={slots()} label="Fields"
          countLabel={`${slots().length} ${slots().length === 1 ? "field" : "fields"}`} itemLabel={slot => slot.label}
          onItemContextMenu={(event, slot) => contextData(event, { value: slot.value, label: slot.label, caption: slot.label,
            path: [...(props.dataPath ?? []), slot.key], getType: () => slotType(slot.index) })}
          render={slot => <TypedReadValue value={slot.value} type={slotType(slot.index)} thumbnail
            fieldRegistry={props.fieldRegistry} callableName={props.callableName} occurrence={props.occurrence}
            dataPath={[...(props.dataPath ?? []), slot.key]} onDataContext={props.onDataContext} readNavigation={props.readNavigation} />}
          preview={slot => <ValueCard presentation="inline" compactLayout="two-line" heading={<ValueCardCaption caption={slot.label}
            typeLabel={childTypeLabel(slotType(slot.index), slot.key)} typeIcon={childIcon(slot.value, slotType(slot.index), slot.key)} />}>
            <TypedReadValue value={slot.value} type={slotType(slot.index)} fieldRegistry={props.fieldRegistry}
              callableName={props.callableName} dataPath={[...(props.dataPath ?? []), slot.key]} onDataContext={props.onDataContext}
              occurrence={props.occurrence} readNavigation={props.readNavigation} recordDepth={(props.recordDepth ?? 0) + 1} />
          </ValueCard>} />;
        // Polish item 1 (Nov 8): a click on a field's value opens its small
        // editor where the host gave this data a write port.
        const editPort = () => props.occurrence?.state === "source" ? props.occurrence.edit : undefined;
        const [editingField, setEditingField] = createSignal<{ index: number; anchor: DOMRect }>();
        // The page's focused record reads as one data card (record-card-plan.ts):
        // its picture is the portrait, a name-like first field the heading.
        const cardFields = () => slots().map(slot => ({ name: slot.label, value: slot.value }));
        const asCard = () => focused() && !nested && !props.compact && !props.templateOnly;
        // A constructor field with its own registered picture (a project's logo) is a portrait too, after any real picture.
        const portrait = () => asCard() ? recordPortraitField(cardFields(), constructor => itemGlyphs.glyph(constructor).picture !== undefined) : undefined;
        const heading = () => asCard() ? recordHeadingField(cardFields()) : undefined;
        const portraitImage = () => { const index = portrait(); return index === undefined ? undefined : pictureOf(fieldValue(index)); };
        const portraitConstructor = () => { const index = portrait(); return index === undefined || portraitImage() ? undefined : fieldConstructor(fieldValue(index)); };
        const headingText = () => { const index = heading(); return index === undefined ? undefined : String(fieldValue(index)).trim(); };
        const card = createMemo(() => asCard() ? { lifted: [portrait(), heading()].filter((index): index is number => index !== undefined),
          head: () => <Show when={portraitImage() || portraitConstructor() || headingText()}><span class="record-value__head">
            <Show when={portraitImage()}>{image => <span class="record-value__portrait"><ImageCanvas value={image()} /></span>}</Show>
            <Show when={portraitConstructor()}>{value => <span class="record-value__portrait record-value__portrait--glyph" aria-hidden="true">
              <ItemMark value={value()} presentation={itemGlyphs} /></span>}</Show>
            <Show when={headingText()}>{text => <span class="record-value__heading">{text()}</span>}</Show>
          </span></Show> } : undefined);
        const valueRows = () => <RecordValueRows count={listed().length} mode={nested ? "line" : "rows"} dense={dense} tight={!!props.compact}
          card={card()}
          // A field with nothing to read waits behind "Show N more fields",
          // except where this data can be edited in place (a field to fill).
          holdsNothing={editPort()?.available() ? undefined : index => fieldHoldsNothing(fieldValue(index))}
          editable={index => fieldEditInPlace({ port: !!editPort()?.available(), templateOnly: !!props.templateOnly, value: fieldValue(index) })}
          onActivateValue={(index, anchor) => setEditingField({ index, anchor: anchor.getBoundingClientRect() })}
          // Polish item 3: the field's type icon beside its shown name.
          label={index => <><Show when={childIcon(fieldValue(index), slotType(index), wire(index))}>{name =>
            <span class="record-value__label-icon" aria-hidden="true"><IconByName name={name()} size={13} /></span>}</Show>
            <DisplayNameText name={fieldLabel(index)} /></>}
          value={index => <ValueCardInlineContext value={() => true}><RecordFieldValueContext value={true}><TypedReadValue value={fieldValue(index)} type={slotType(index)}
            fieldRegistry={props.fieldRegistry} recordDepth={(props.recordDepth ?? 0) + 1}
            callableName={props.callableName} onOpenType={props.onOpenType} onOpenData={props.onOpenData}
            onDataContext={props.onDataContext} occurrence={props.occurrence} templateOnly={props.templateOnly}
            dataPath={[...(props.dataPath ?? []), wire(index)]} readNavigation={props.readNavigation} readSession={props.readSession} /></RecordFieldValueContext></ValueCardInlineContext>} />;
        return <><Show when={caseName()} fallback={valueRows()}>{name => <span class="typed-read-fields">
            <DisplayNameText name={name()} />{valueRows()}</span>}</Show>
          <Show when={editPort() ? editingField() : undefined}>{state => <Loading fallback={null}>
            <LocusQuickEdit name={fieldLabel(state().index)} type={slotType(state().index)} value={fieldValue(state().index)}
              registry={props.fieldRegistry ?? registry()} anchor={state().anchor} applyLabel={editPort()!.applyLabel()}
              onApply={value => editPort()!.write([...(props.dataPath ?? []), wire(state().index)], value, slotType(state().index))}
              onOpenFull={editPort()?.openFull} onClose={() => setEditingField(undefined)} />
          </Loading>}</Show></>;
      }}
    </Show>}>
      <Show when={props.readFacts ? props.readFacts.root.body === "string" : typeof props.value === "string"}
        fallback={<Show when={inlineData() ? booleanText(props.value) : undefined} fallback={<ReadPlanValue plan={props.readFacts ? props.readFacts.root.scalarPlan! : surfaceReadValuePlan(props.value, undefined, "scalar")} />}>
          {text => <span class="typed-read-scalar">{text()}</span>}</Show>}>
        <DelimitedText value={props.value as string} type={valueType()} resolveType={resolveType} />
      </Show>
    </Show>
    }>{props.structuralFallback ? props.structuralFallback(() => ({ facts: props.readFacts, value: props.value })) : collectionBody()}</Show>}><DataPreview value={props.value} /></Show>
  }>{inner => <Show when={props.readFacts ? props.readFacts.root.optional?.present
    : props.value && typeof props.value === "object" && "$tag" in props.value && props.value.$tag === "Just"}
    fallback={props.templateOnly ? null : <span class="text-muted">Not set</span>}>
    <TypedReadValue type={inner().value} value={props.readFacts
      ? Object.getOwnPropertyDescriptor(props.value, props.readFacts.root.optional!.key)?.value
      : peelMaybeValue(props.value as Parameters<typeof peelMaybeValue>[0])}
      compact={props.compact} templateOnly={props.templateOnly} fieldRegistry={props.fieldRegistry}
      detail={!!props.detail || !!props.structuralFallback} renderChild={props.renderChild}
      callableName={props.callableName} onOpenType={props.onOpenType} onOpenData={props.onOpenData} onDataContext={props.onDataContext}
      occurrence={props.occurrence}
      dataPath={[...(props.dataPath ?? []), "_0"]} readNavigation={props.readNavigation} />
  </Show>}</Show>}>{type => props.templateOnly ? null : <Show when={props.functionSource && !props.compact && !props.thumbnail} fallback={<TypeDataPreview type={type()} compact={props.compact}
    fieldRegistry={fieldOwner()} callableName={props.callableName} onOpenType={props.onOpenType} readSession={props.readSession} />}>
    <Show when={functionExpression()} fallback={<><TypeDataPreview type={type()} fieldRegistry={fieldOwner()}
      callableName={props.callableName} onOpenType={props.onOpenType} readSession={props.readSession} />
      <p class="text-muted" role="status">Function body unavailable in this reader.</p></>}>
      {node => <ExpressionGraphCaptureContext value={{ available: () => false, pending: () => false }}>
        <ExpressionGraphScopeCaptureContext value={{ node: () => undefined, allowed: () => false }}>
          <ExpressionGraphValueContext value={null}>
            <ExpressionEditor expr={node()} fieldDef={{ name: "function", type: type(), label: Nothing, meta: {}, ui: Nothing }}
              inspection={functionPresentation} graphAuthoring={false} hideLabel onChange={() => {}}
              signatureOrigins={props.functionSource?.origins} />
          </ExpressionGraphValueContext>
        </ExpressionGraphScopeCaptureContext>
      </ExpressionGraphCaptureContext>}
    </Show>
  </Show>}</Show>}>{type => props.templateOnly ? null : <TypeDataPreview type={type()} compact={props.compact}
    fieldRegistry={fieldOwner()} callableName={props.callableName} onOpenType={props.onOpenType} readSession={props.readSession} />}</Show>;

  const detail = () => <DataValueSurface value={props.value} type={props.type ?? Anything} session={session} path={props.dataPath}
    readFacts={props.readFacts} preparedChildren={!!props.readFacts} current={props.readCurrent}
    renderValue={(data, render, wrapper) => <Show when={props.readFacts && Object.is(data.value, props.value)
      && data.path.length === (props.dataPath?.length ?? 0)
      && data.path.every((step, index) => step === props.dataPath?.[index])} fallback={<TypedReadValue value={data.value}
      type={props.readFacts ? data.getType() : typedReadDisplayType(data.value, data.getType(), session(), props.fieldRegistry)}
      valueIcon={data.path.length === (props.dataPath?.length ?? 0)
        && data.path.every((step, index) => step === props.dataPath?.[index]) ? props.valueIcon : undefined}
      compact={props.compact} fieldRegistry={props.fieldRegistry} callableName={props.callableName}
      onOpenType={props.onOpenType} onOpenData={props.onOpenData} onDataContext={props.onDataContext} dataPath={data.path} renderChild={props.renderChild}
      occurrence={props.occurrence}
      structuralFallback={render} readNavigation={props.readNavigation} readWrap={wrapper} readContainedLabel={data.label} />}>
        <TypedReadValueBody {...props} detail={false} structuralFallback={render} />
      </Show>}
    renderChild={(data, render) => {
      const type = () => props.readFacts ? data.getType() : typedReadDisplayType(data.value, data.getType(), session(), props.fieldRegistry);
      const description = () => !props.readFacts && type() ? typedReadTypePresentation(type()!, session(), reader, props.fieldRegistry) : undefined;
      const presented = { get value() { return data.value; }, get label() { return data.label; }, get caption() { return data.caption; },
        get path() { return data.path; }, getType: type, get typeLabel() { return props.readFacts ? data.typeLabel ?? "Anything" : description()?.label ?? "Anything"; },
        get typeIcon() { return props.readFacts ? data.typeIcon : description()?.icon; } };
      // The record surface owns the contextual field label; this heading
      // preserves only the data's independent name.
      return props.renderChild ? props.renderChild(presented, render) : <ValueCard
        heading={<ValueCardCaption caption={props.readFacts ? data.caption : typedReadValueCaption(data.value, reader)}
          icon={props.readFacts ? data.valueIcon : childPresentation(data.value)?.icon}
          emoji={props.readFacts ? data.valueEmoji : childPresentation(data.value)?.emoji}
          typeLabel={presented.typeLabel} typeIcon={presented.typeIcon} />}
        onMenu={event => contextData(event, presented)}
        onOpen={props.onOpenData ? () => props.onOpenData?.(presented) : undefined}>{render()}</ValueCard>;
    }} />;
  // Only the focused value itself is focused: everything it draws (field
  // values, a function's graph and its results) reads as ordinary contents.
  // A detail surface redraws this same value inside it, which stays focused.
  return <ValueCardFocusedContext value={() => !!props.detail && focused()}><DataOccurrenceBoundary value={props.value} type={valueType()} occurrence={props.occurrence}
    current={props.readCurrent} mapSelection={props.readMapSelection}
    dataPath={props.dataPath} onDataContext={props.onDataContext} onOutlet={open => { dataContextOutlet = open; }}><Show when={props.detail} fallback={<Show when={props.thumbnail} fallback={<span class={props.compact ? "typed-read-value typed-read-value--compact" : "typed-read-value"}>
    <Errored fallback={generic}>
      <Loading fallback={generic()}>
        <Show when={props.functionSource && callableType() ? undefined : view()} fallback={generic()}>{(template) => <span class="typed-read-value__presentation">
          <Show when={props.readFacts ? props.readFacts.root.useLayout
            : template().layout && !templates().getComponent(template().readComponent ?? template().component ?? "") && fields()
              && props.value && typeof props.value === "object" && !Array.isArray(props.value)} fallback={
            <ReadValue value={props.value} field={field()} template={template()} registry={templates()}
              occurrence={props.occurrence} dataPath={props.dataPath} onDataContext={props.onDataContext}
              readPlan={props.readFacts?.root.readPlan}
              fieldRegistry={fieldOwner()} context={{ _mode: "read", _channel: "web", _compact: !!props.compact,
                _valueIcon: props.valueIcon, _valueEmoji: props.valueEmoji, _typeIcon: thumbnailIcon() }} fallback={generic()} />
          }>
            <LayoutRenderer layout={template().layout!} fields={fields()!} values={props.value as Record<string, unknown>}
              occurrence={props.occurrence} dataPath={props.dataPath} onDataContext={props.onDataContext}
              layoutPlan={props.readFacts?.root.layoutPlan}
              registry={templates()} fieldRegistry={fieldOwner()} mode="read" fallback={generic()} onChange={() => {}} />
          </Show>
        </span>}</Show>
      </Loading>
    </Errored>
  </span>}><DataThumbnail value={props.value} picture={glyph().picture} valueIcon={glyph().icon ?? props.valueIcon} emoji={glyph().emoji ?? props.valueEmoji} typeIcon={thumbnailIcon()}
    scalarPlan={numericValue() ? props.readFacts ? props.readFacts.root.scalarPlan : surfaceReadValuePlan(props.value, undefined, "scalar") : undefined} /></Show>}>{detail()}</Show></DataOccurrenceBoundary></ValueCardFocusedContext>;
}

/** Semantic inspection of type data inside the universal read surface. The
 * engine's existing reference and pure-representation projections supply the
 * fields/cases; card layout never enumerates a type's implementation keys. */
export function TypeDataPreview(props: {
  type: FenelType;
  compact?: boolean;
  fieldRegistry?: ModuleRegistry;
  callableName?: (handle: string) => string | undefined;
  onOpenType?: (type: FenelType) => void;
  /** A ready typed-read packet keeps its original type-preview owner until
   * that packet is retired; a sibling reader is never a temporary fallback. */
  readSession?: AuthoringSession;
}) {
  const reader = useReaderRuntime();
  const inheritedSession = useAuthoringSession();
  // B3: a Local preview always belongs to a worker session (see localReaderReadSession).
  const localSession = () => {
    if (reader?.kind !== "local") return undefined;
    try { return props.readSession ?? localReaderReadSession(reader.session(), inheritedSession, reader.registry(), props.fieldRegistry); }
    catch { return undefined; }
  };
  const session = () => localSession() ?? props.readSession ?? reader?.session() ?? inheritedSession;
  const registry = () => props.fieldRegistry ?? session().registry;
  const resolveType = (name: string) => registry().getIdentifiedEntity(name)?.type
    ?? (props.fieldRegistry ? undefined : session().environment.resolveTypeRef?.({ $ref: name }));
  const completePreview = () => reader?.kind === "local";
  type ProjectionInput = { type: FenelType; worker: PreparedReaderWorker; typeLookup: "registry" | "session"; complete: boolean }
    | { type: FenelType; error: unknown };
  type ProjectionResult = { type: FenelType; worker: PreparedReaderWorker; typeLookup: "registry" | "session"; complete: boolean;
    descriptions?: AuthoringReaderTypeDescriptions["descriptions"]; preview?: AuthoringReaderTypePreview["preview"] };
  const projectionWorker = createMemo(() => {
    if (reader?.kind === "local" && !localSession()) return { error: new Error("Type details are unavailable here.") };
    const current = session();
    // An explicitly different field owner cannot borrow this reader's worker.
    if (reader?.kind !== "local" && props.fieldRegistry && props.fieldRegistry !== current.registry) return undefined;
    try {
      const worker = preparedReaderWorkerForSession(current);
      if (!worker && reader?.kind === "local") throw new Error("This reader's editing tools are not ready.");
      return worker;
    } catch (error) { return { error }; }
  });
  const projectionInput = createMemo<ProjectionInput | undefined>(() => {
    const worker = projectionWorker();
    if (!worker) return undefined;
    return "error" in worker ? { type: props.type, error: worker.error }
      : { type: props.type, worker, typeLookup: props.fieldRegistry ? "registry" : "session", complete: completePreview() };
  });
  let pendingProjection: AbortController | undefined;
  onSettled(() => () => pendingProjection?.abort());
  const projected = createAsyncValue<{ input: ProjectionInput | undefined }, ProjectionResult | undefined>(
    () => ({ input: projectionInput() }), ({ input }) => {
    pendingProjection?.abort();
    pendingProjection = undefined;
    if (!input) return undefined;
    if ("error" in input) throw input.error;
    const controller = new AbortController();
    pendingProjection = controller;
    return runPreparedReaderWorker(input.worker, input.complete
      ? { method: "project-reader-type-preview", type: input.type, typeLookup: input.typeLookup, knownIcons: Object.keys(LUCIDE_BY_NAME) }
      : { method: "project-reader-types", root: { type: input.type }, typeLookup: input.typeLookup }, controller.signal)
      .then(reply => {
        if (input.complete) {
          const result = reply as AuthoringReaderTypePreview;
          if (!reply || typeof reply !== "object" || Array.isArray(reply) || !Object.hasOwn(reply, "preview")
            || !result.preview?.root || !Array.isArray(result.preview.rows) || !Array.isArray(result.preview.fieldLabels))
            throw new Error("This type preview is unavailable.");
          return { type: input.type, worker: input.worker, typeLookup: input.typeLookup, complete: true, preview: result.preview };
        }
        const result = reply as AuthoringReaderTypeDescriptions;
        if (!result.descriptions[0]) throw new Error("This type description is unavailable.");
        return { type: input.type, worker: input.worker, typeLookup: input.typeLookup, complete: false, descriptions: result.descriptions };
      }).finally(() => { if (pendingProjection === controller) pendingProjection = undefined; });
  });
  const currentProjection = () => {
    const input = projectionInput();
    const result = projected();
    return input && "worker" in input && result?.worker === input.worker && result.type === input.type
      && result.typeLookup === input.typeLookup && result.complete === input.complete ? result : undefined;
  };
  const previewMaps = createMemo(() => {
    const packet = currentProjection()?.preview;
    return packet ? { root: packet.root, rows: new Map(packet.rows.map(row => [row.type, row])),
      fieldLabels: new Map(packet.fieldLabels.map(entry => [entry.field, entry.label])) } : undefined;
  });
  const previewRow = (type: FenelType) => {
    const packet = previewMaps();
    // The source prop names the request root; every descendant remains inside
    // the one transported graph, whose internal object sharing is preserved.
    const row = packet?.rows.get(type === props.type ? packet.root : type);
    if (!row) throw new Error("This type preview is unavailable.");
    return row;
  };
  const typeEntry = (type: FenelType) => completePreview()
    ? { ...previewRow(type).presentation, label: valueCardTypeLabel(previewRow(type).presentation.label) || "Type" }
    : typedReadTypePresentation(type, session(), reader, registry());
  const descriptions = createMemo(() => projectionInput() ? [] : projectLocusTypeDescriptions({ type: props.type }, undefined, undefined,
    resolveType, session().evaluateContext));
  const description = (type: FenelType) => {
    if (completePreview()) return previewRow(type).description;
    if (type === props.type && projectionInput()) return currentProjection()?.descriptions?.[0];
    return descriptions().find(entry => entry.type === type)
      ?? projectLocusTypeDescriptions({ type }, undefined, undefined, resolveType, session().evaluateContext)[0];
  };
  const fieldLabel = (field: FieldDef) => {
    if (completePreview()) {
      const label = previewMaps()?.fieldLabels.get(field);
      if (label === undefined) throw new Error("This type preview is unavailable.");
      return label;
    }
    return field.key?.$tag === "NamedField"
      ? valueCardLabel(registry().getFieldRepresentation("Labelable", field.key.ref.$ref)?.methods.label) || field.name : field.name;
  };
  const shape = (type: FenelType) => {
    const projectedShape = description(type)?.previewShape;
    if (completePreview() && !projectedShape) throw new Error("This type preview is unavailable.");
    return projectedShape ?? type;
  };
  const variantCaseType = (type: FenelType, index: number) => {
    const record = previewRow(type).caseRecords?.[index];
    if (!record) throw new Error("This type preview is unavailable.");
    return record;
  };
  const unavailable = () => <span class="text-danger" role="alert">Type details are unavailable.</span>;
  return <Show when={!projectionInput() || (!projected.loading && currentProjection())} fallback={
    <Show when={!projected.loading && projected.error} fallback={<LensSpinner />}>
      {unavailable()}
    </Show>
  }><Errored fallback={unavailable}><TypeDataPreviewBody type={props.type} compact={props.compact} describeType={typeEntry}
    resolveShape={shape} describeDetails={type => description(type)?.previewDetails}
    variantCaseType={completePreview() ? variantCaseType : undefined} fieldLabel={fieldLabel}
    caseLabel={tag => constructorLabel(session().evaluateContext, tag)}
    ownTypeIcon={type => completePreview() ? previewRow(type).presentation.ownIcon : typedReadTypeOwnIcon(type, reader)}
    onOpenType={props.onOpenType} /></Errored></Show>;
}
