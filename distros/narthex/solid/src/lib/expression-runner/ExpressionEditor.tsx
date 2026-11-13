import { For, Match, Show, Switch, createContext, createEffect, createMemo, createSignal, lazy, onSettled, useContext } from "solid-js";
import type { JSX } from "@solidjs/web";
import type { ExprNode, WhereBinding } from "@fenel/engine/authoring/expression";
import type { FieldDef, FenelType, TypeScheme } from "@fenel/engine/types";
import type { MembershipHintObserver } from "../field-renderer/refinement-hints";
import type { AuthoringSession } from "./account-authoring-session";
import { DataPreview, DataThumbnail } from "../data-transfer/DataPreview";
import type { GlyphPicture } from "../glyph-picture";
import { CardLoadingIndicator, CollectionPreviewStrip, ValueCard, ValueCardCaption } from "../value-card";
import { ValueHoverPreview } from "../value-hover-preview";
import { IconByName, TYPE_ICON_FALLBACKS } from "../icons";
import { FieldLabelSurface } from "../field-renderer/field-label-surface";
import { StringInputSurface } from "../field-renderer/string-input-surface";
import { NumberInput } from "../number-input";
import { Nothing, peelMaybeValue } from "@fenel/engine/maybe-value";
import { valueCardLabel, valueCardTypeLabel } from "../value-card";
import { ExprFieldShell, ExpressionArgumentDialog, ExpressionCallSurface, useExpressionInspectorOpen, ExpressionCallArgumentRow, ExpressionGraphAuthoringContext, ExpressionGraphCaptureContext, ExpressionGraphScopeCaptureContext, ExpressionGraphCollectionItemControl, ExpressionGraphCollectionSurface, ExpressionNodeContent, ExpressionReferenceSurface, useExpressionCallCompact, type Mode } from "./expression-surfaces";
import { blankLocalBinding, detectStructuralForm, heldBareReference, heldBareReferenceValue, heldDoLetChain, positionalParameter, structuralModeForForm } from "./expression-structure";
import { RecordValueEditorSurface, LambdaFormEditorSurface, WhereFormEditorSurface, ConstructFormEditorSurface, LetBindingsFormEditorSurface, MatchFormEditorSurface, IfGraphSurface, FunctionResultCard } from "./structural-surfaces";
import { TypeContract, TypeContractType, type TypeContractOrigin } from "./type-contract";
import type { FunctionSignatureOrigins } from "./function-signature-origins";
import { ExtendedExpressionEditor } from "./ExtendedExpressionForms";
import { CornerMenu, createCornerMenu } from "../corner-menu";
import type { ContainedValuePreview } from "../data-transfer/DataValueSurface";
import { readLocusCatalogReference } from "../locus-catalog-reference";
import { codeName, displayNameText, type DisplayNameInput } from "../display-name";
import { DisplayNameText } from "../display-name-text";
import { createDataOccurrenceSuggestions, type DataOccurrenceSource, type DataReadOccurrence } from "../data-occurrence";
import type { LocusMenuItem } from "../locus-context-menu";
import { compareFunctionSearch, displayCallableHandle, functionDisplayName, functionSearchRank, type CallableNameEntry } from "./callable-names";
import { FunctionPickerSurface, type FunctionPickerModel, type FunctionPickerQuery, type FunctionPickerRow } from "./function-picker-surface";

export type ExprViewMode = "nested" | "pipe";
export type ExpressionGraphValue = { readonly value: unknown; readonly type?: FenelType; readonly caption?: DisplayNameInput; readonly valueIcon?: string; readonly valueEmoji?: string; readonly typeLabel?: string; readonly typeIcon?: string };
export type ExpressionGraphValueResolver = (node: ExprNode) => ExpressionGraphValue | undefined;
export const ExpressionGraphValueContext = createContext<ExpressionGraphValueResolver | null>(null);
/** Inside a function read its inputs are unknowns: values that depend on
 * them are not missing data, and each input keeps its declared type where it
 * is used. Local names shadow inputs (`local`, no declared type). `name` is
 * how the function's signature rows name the input, so its graph nodes match. */
export type ExpressionGraphInput = { readonly type?: FenelType; readonly local?: boolean; readonly name?: DisplayNameInput };
/** Where a function's computation lands (FunctionResultCard): its return
 * type's label, icon and origin, handed to the one node its body ends in. */
type FunctionResultSlot = { readonly type?: string; readonly icon?: string; readonly origin?: TypeContractOrigin };
export const ExpressionGraphInputsContext = createContext<ReadonlyMap<string, ExpressionGraphInput> | null>(null);
export type HeldCallablePresentation = { readonly id: string; readonly name?: DisplayNameInput; readonly icon?: string; readonly emoji?: string;
  /** The reader's Picturable picture of this callable (a constructor's own picture). */
  readonly picture?: GlyphPicture;
  readonly params?: readonly FieldDef[]; readonly returns?: FenelType; readonly isConstructor?: boolean };
/** An item's own identity mark in a graph list, without data. */
export type HeldItemGlyph = { name?: DisplayNameInput; icon?: string; emoji?: string; picture?: GlyphPicture };
export type HeldExpressionPresentation = {
  callable(id: string): HeldCallablePresentation | undefined;
  typeLabel(type: FenelType): string | undefined;
  graphTypeLabel?(type: FenelType): string | undefined;
  /** Existing reader projection of a declared list element; no inference. */
  listElementType?(type: FenelType): FenelType | undefined;
  /** Display metadata from the same captured reader, preserving exact hints. */
  displayValueType?(value: unknown, declared?: FenelType, observedType?: FenelType): FenelType | undefined;
  /** Rich data reads supplied by the existing current reader; never evaluates
   * the producing expression or acquires an authoring session. */
  readValue?(data: ExpressionGraphValue, compact?: boolean, onOpenData?: (child: ContainedValuePreview) => void, detail?: boolean,
    occurrence?: DataReadOccurrence): JSX.Element;
  /** The source owner captures this exact authored occurrence and destination. */
  occurrence?(node: ExprNode): DataOccurrenceSource;
  typeIcon?(type: FenelType): string | undefined;
  fieldLabel?(field: FieldDef): DisplayNameInput;
  reference?(id: string): { readonly name?: DisplayNameInput; readonly icon?: string; readonly emoji?: string; readonly kind?: "function" | "type" | "data" } | undefined;
  graphValue?: ExpressionGraphValueResolver;
  /** Functions this reader can already list (repository first, its own once
   * its tools are ready). `pending` names what is still arriving. */
  functionChoices?(): HeldFunctionChoices;
  /** Start reading choices on the first picker; never on a plain render. */
  requestFunctionChoices?(): void;
  /** An early function picker opened (true) or closed (false). Its owner
   * keeps this lens in place while one is open, so the user's place (the
   * picker and its query) survives the editing tools becoming ready. */
  pickerOpen?(open: boolean): void;
};
/** A listed function: its naming fields (callable-names.ts) and its inputs. */
export type HeldFunctionChoice = CallableNameEntry & { readonly label: string; readonly description?: string;
  readonly params: readonly { readonly name: string }[] };
export type HeldFunctionChoices = { readonly entries: readonly HeldFunctionChoice[]; readonly pending?: string; readonly error?: string;
  /** Read the listed functions again after `error`. */
  readonly retry?: () => void;
  /** Functions not listed yet that the user may ask for explicitly. */
  readonly more?: { readonly label: string; readonly detail?: string; readonly run: () => void } };
export type ExpressionEditorProps = {
  expr: ExprNode;
  onChange: (next: ExprNode) => void;
  /** B4 fix round 2: the surface whose Saves a pending nested value check
   * blocks (an object the surface also passes to its Save checks). */
  draftCheckScope?: object;
  viewMode?: ExprViewMode;
  typeName?: string;
  fieldDef?: FieldDef;
  expectedScheme?: TypeScheme;
  /** Presentation only: observe the current literal field's existing hint answer. */
  observeMembershipHints?: MembershipHintObserver;
  hideResultGuidance?: boolean;
  deferFunctionChoices?: boolean;
  paramName?: string;
  hideLabel?: boolean;
  hideTopLevelAnnotation?: boolean;
  /** The shared type contract of the root occurrence (see TypeContract):
   * where its requirement comes from, in plain words, and a declared type
   * held by an owner outside the expression (read-only without its write). */
  requirementSource?: string;
  declaredType?: FenelType;
  onDeclaredTypeChange?: (type: FenelType | undefined) => void;
  declaredReadonly?: string;
  typeMenuItems?: readonly LocusMenuItem[];
  /** The owner already shows the root occurrence's TypeContract (e.g. the
   * New data dialog's Type block): the root does not repeat it. */
  hideTypeContract?: boolean;
  /** Editor lens, as TypeBuilder's: "simple" shows a root constructor draft of
   * named fields as a plain form (simple-data-form.tsx); "full" (default) is
   * the whole expression editor. Only the root reads it. */
  presentation?: "simple" | "full";
  /** Simple lens: a Create was tried, so every field says what it still needs. */
  simpleShowIssues?: boolean;
  /** Start every expression slot in the existing editable graph lens. */
  graphAuthoring?: boolean;
  /** Plain draft data uses the shared DOM leaves while the catalog prepares. */
  authoringPending?: boolean;
  authoringSession?: AuthoringSession;
  /** Current-reader display facts only. No session or judgment is fabricated. */
  inspection?: HeldExpressionPresentation;
  /** Already-observed data from this reader's execution; never a request to run. */
  graphValue?: ExpressionGraphValueResolver;
  onCaptureGraph?: () => void;
  graphCapturePending?: boolean;
  graphCapturePendingLabel?: string;
  onGraphActiveChange?: (active: boolean, node?: ExprNode, allowed?: boolean) => void;
  /** Held inspection of a function: where each slot of the ROOT function's
   * signature got its type (written or inferred), from its declaration. */
  signatureOrigins?: FunctionSignatureOrigins;
};

/** Every held graph occurrence projects the same reader-owned type facts.
 * A refined hint also refreshes its badge; old generic labels cannot survive
 * on a card whose reader has already supplied a more precise type. */
function heldGraphValue(data: ExpressionGraphValue, presentation: HeldExpressionPresentation,
  declared?: FenelType): ExpressionGraphValue {
  const type = presentation.displayValueType?.(data.value, declared, data.type) ?? data.type ?? declared;
  const currentBadge = data.type !== undefined && type === data.type;
  return { ...data, type,
    typeLabel: (currentBadge ? data.typeLabel : undefined)
      ?? (type && (presentation.graphTypeLabel ?? presentation.typeLabel)(type)),
    typeIcon: (currentBadge ? data.typeIcon : undefined) ?? (type && presentation.typeIcon?.(type)) };
}

/** Reader callbacks receive one reactive metadata carrier across layouts.
 * Replacing observed data updates its fields without rebuilding the graph. */
function ExpressionGraphReadValueSurface(props: { data: ExpressionGraphValue;
  readValue: (data: ExpressionGraphValue) => JSX.Element }) {
  const data: ExpressionGraphValue = {
    get value() { return props.data.value; }, get type() { return props.data.type; },
    get caption() { return props.data.caption; }, get valueIcon() { return props.data.valueIcon; }, get valueEmoji() { return props.data.valueEmoji; },
    get typeLabel() { return props.data.typeLabel; }, get typeIcon() { return props.data.typeIcon; },
  };
  return <>{props.readValue(data)}</>;
}

const Prepared = lazy(() => import("./index").then(module => ({ default: module.PreparedExpressionEditor })));

/** The canonical expression component owns both held-data inspection and its
 * prepared authoring controller. Both consume the same recursive UI surfaces. */
export function ExpressionEditor(props: ExpressionEditorProps) {
  const inheritedValues = useContext(ExpressionGraphValueContext);
  const inheritedGraphAuthoring = useContext(ExpressionGraphAuthoringContext);
  const inheritedCapture = useContext(ExpressionGraphCaptureContext);
  const graphRoots = new Map<object, { node?: ExprNode; allowed?: boolean }>();
  let graphActive = false;
  let selectedGraph: { node?: ExprNode; allowed?: boolean } | undefined;
  function activate(active: boolean, token: object, node?: ExprNode, allowed?: boolean) {
    if (!props.onGraphActiveChange) { inheritedCapture.activate?.(active, token, node, allowed); return; }
    if (active) { graphRoots.delete(token); graphRoots.set(token, { node, allowed }); } else graphRoots.delete(token);
    const next = graphRoots.size > 0;
    const selected = [...graphRoots.values()].at(-1);
    if (next !== graphActive || selected?.node !== selectedGraph?.node || selected?.allowed !== selectedGraph?.allowed) {
      graphActive = next; selectedGraph = selected; props.onGraphActiveChange(next, selected?.node, selected?.allowed);
    }
  }
  onSettled(() => () => {
    graphRoots.clear();
    if (graphActive) { graphActive = false; selectedGraph = undefined; props.onGraphActiveChange?.(false); }
  });
  const graphValue: ExpressionGraphValueResolver = node => (props.graphValue ?? props.inspection?.graphValue ?? inheritedValues)?.(node);
  const graphAuthoring = () => props.graphAuthoring ?? inheritedGraphAuthoring();
  // Held data becomes an early editing surface: the same recursive held
  // surfaces receive the draft's edits while the prepared tools load.
  const heldEditing = () => !!graphAuthoring() && !!props.authoringPending;
  const heldEdit = (next: ExprNode) => props.onChange(next);
  return <ExpressionGraphAuthoringContext value={graphAuthoring}><ExpressionGraphCaptureContext value={{ request: () => props.onCaptureGraph ? props.onCaptureGraph() : inheritedCapture.request?.(),
    available: () => !!props.onCaptureGraph || !!props.onGraphActiveChange || inheritedCapture.available(),
    pending: () => props.onCaptureGraph || props.onGraphActiveChange ? !!props.graphCapturePending : inheritedCapture.pending(),
    pendingLabel: () => props.onCaptureGraph || props.onGraphActiveChange ? props.graphCapturePendingLabel : inheritedCapture.pendingLabel?.(), activate }}>
    <ExpressionGraphValueContext value={graphValue}><Show when={props.inspection} fallback={
      <Show when={graphAuthoring() && props.authoringPending} fallback={<Prepared {...props} />}>
        <PendingExpressionDraft expr={props.expr} onChange={props.onChange} />
      </Show>
    }>
    {presentation => <div data-expression-inspection="true" aria-readonly={heldEditing() ? undefined : "true"}
      data-expression-early-editing={heldEditing() ? "true" : undefined}>
      <HeldNode node={props.expr} presentation={presentation()} field={props.fieldDef}
        paramName={props.paramName} typeName={props.typeName} hideLabel={props.hideLabel}
        signatureOrigins={props.signatureOrigins} edit={heldEditing() ? heldEdit : undefined} />
    </div>}
  </Show></ExpressionGraphValueContext></ExpressionGraphCaptureContext></ExpressionGraphAuthoringContext>;
}

/** Empty data has no expression to prepare. These existing scalar DOM leaves
 * edit the same draft; catalogue-dependent choices retain their prepared owner. */
function PendingExpressionDraft(props: { expr: ExprNode; onChange: (next: ExprNode) => void; allowLocalBindings?: boolean }) {
  const literal = () => props.expr.kind === "literal" ? props.expr.value : undefined;
  const empty = () => props.expr.kind === "literal" && props.expr.value === undefined;
  const scalar = () => empty() || typeof literal() === "string" || typeof literal() === "number";
  const change = (value: unknown) => props.onChange({ kind: "literal", value });
  const where = () => {
    const form = props.expr.kind === "literal" ? detectStructuralForm(props.expr.value, () => true) : null;
    return form?.kind === "where" ? form : undefined;
  };
  const addBinding = () => change({ __where: { body: props.expr, bindings: [blankLocalBinding([])] } });
  const choices = () => <div class="expr-graph-authoring-actions" aria-label="Add data">
    <button type="button" class="expr-form__btn" onClick={() => change("")}>Text</button>
    <button type="button" class="expr-form__btn" onClick={() => change(0)}>Number</button>
    <button type="button" class="expr-form__btn" disabled data-tooltip="Preparing editing tools…">Function</button>
  </div>;
  return <Show when={where()} fallback={<ExprFieldShell mode="inline" nodeKind={props.expr.kind} empty={empty()} inlineAvailable={false}
    graphHeading={<ValueCardCaption unnamed typeLabel={typeof literal() === "string" ? "String" : typeof literal() === "number" ? "Number" : undefined} />}
    onRemove={scalar() ? () => change(undefined) : undefined}
    onAddBinding={props.allowLocalBindings !== false ? addBinding : undefined}
    graphBody={<Show when={!empty()} fallback={<><span class="text-muted">Add data or a function</span>{choices()}</>}>
      <Show when={scalar()} fallback={<span class="text-muted">Expression</span>}><DataPreview value={literal()} /></Show>
    </Show>}>
    <Show when={scalar()} fallback={<span class="text-muted" role="status">Preparing editing tools…</span>}>
      <Switch fallback={choices()}>
        <Match when={typeof literal() === "string"}><StringInputSurface value={literal() as string} onChange={change} /></Match>
        <Match when={typeof literal() === "number"}><NumberInput value={literal()} class="fe-input" onChange={change} /></Match>
      </Switch>
      <span class="text-muted" role="status">Preparing editing tools…</span>
    </Show>
  </ExprFieldShell>}>{form => <WhereFormEditorSurface body={form().body} bindings={form().bindings}
    onChange={next => "kind" in next ? props.onChange(next) : change({ __where: next })}
    bindingName={slot => <StringInputSurface value={slot.binding.name} placeholder="binding name" onChange={slot.onChange} />}
    expression={slot => <PendingExpressionDraft expr={slot.value} onChange={slot.onChange}
      allowLocalBindings={slot.index !== undefined} />}
  />}</Show>;
}

/** Graph data reuses ordinary cards and their inline lens/full-card hover. The
 * owner supplies observed data; this surface never evaluates an expression. */
export function ExpressionGraphValuePreview(props: {
  data?: ExpressionGraphValue;
  typeLabel?: string;
  /** Lane D: the type is still being inferred; its place stays reserved. */
  typePending?: boolean;
  caption?: DisplayNameInput;
  /** Genuine data identity, separately from the input slot's accessible label. */
  dataCaption?: DisplayNameInput;
  inline?: boolean;
  presentation?: "full" | "inline";
  /** Prepared readers may provide their typed renderer; held data stays light. */
  thumbnail?: () => JSX.Element;
  body?: (compact?: boolean, onOpenData?: (child: ContainedValuePreview) => void, data?: ExpressionGraphValue, detail?: boolean,
    occurrence?: DataReadOccurrence) => JSX.Element;
  occurrence?: DataOccurrenceSource;
  onOpen?: () => void;
}) {
  const capture = useContext(ExpressionGraphCaptureContext);
  const unknownInputs = !!useContext(ExpressionGraphInputsContext);
  const menu = createCornerMenu();
  const [opened, setOpened] = createSignal(false);
  const [openedChild, setOpenedChild] = createSignal<{ root: ExpressionGraphValue; child: ContainedValuePreview }>();
  const [menuSelection, setMenuSelection] = createSignal<ContainedValuePreview>();
  const suggestions = createDataOccurrenceSuggestions(() => props.occurrence, menuSelection);
  createEffect(() => menu.isOpen() ? suggestions : undefined, owner => owner?.hold());
  function openMenu(event: MouseEvent, selection?: ContainedValuePreview) {
    setMenuSelection(selection); menu.open(event);
  }
  const caption = () => props.data?.caption ?? props.caption ?? "Data";
  const dataCaption = () => props.data?.caption ?? props.dataCaption;
  const typeLabel = () => props.data?.typeLabel ?? props.typeLabel;
  const thumbnail = () => <Show when={props.data} fallback={<IconByName name={TYPE_ICON_FALLBACKS.Data} size={16} />}>
    {data => <Show when={props.thumbnail} fallback={<DataThumbnail value={data().value}
      valueIcon={data().valueIcon} emoji={data().valueEmoji} typeIcon={data().typeIcon} />}>{props.thumbnail?.()}</Show>}
  </Show>;
  const openData = () => { if (props.data) { setOpenedChild(undefined); setOpened(true); } };
  const openContained = (child: ContainedValuePreview) => {
    if (props.data) {
      const parent = openedChild();
      setOpenedChild({ root: props.data, child: parent?.root === props.data && opened()
        ? { ...child, path: [...parent.child.path, ...child.path] } : child });
      setOpened(true);
    }
  };
  /** The opened root reads like its badge: an owner may supply the observed
   * data and its caption/type label separately (the prepared editor does). */
  const openedRoot = createMemo((): ExpressionGraphValue | undefined => props.data && {
    ...props.data, caption: props.data.caption ?? props.dataCaption, typeLabel: props.data.typeLabel ?? props.typeLabel });
  const openedData = (): ExpressionGraphValue | undefined => {
    const selected = openedChild();
    if (!selected) return openedRoot();
    return selected.root === props.data ? { value: selected.child.value, type: selected.child.getType(),
      caption: selected.child.caption, typeLabel: selected.child.typeLabel, typeIcon: selected.child.typeIcon } : undefined;
  };
  createEffect(() => openedChild()?.root !== undefined && openedChild()?.root !== props.data,
    stale => { if (stale) { setOpened(false); setOpenedChild(undefined); } });
  const items = () => [
    { id: "inspect-data", label: "Inspect data", icon: "search", disabled: !props.data, onSelect: openData },
    ...(props.onOpen ? [{ id: "inspect-expression", label: "Inspect expression", icon: "route", onSelect: props.onOpen }] : []),
    { id: "suggestions", label: "Suggestions", icon: "lightbulb", children: suggestions.items().length ? suggestions.items()
      : [{ id: "suggestions-preparing", label: "Checking suggestions…", disabled: true }] },
  ];
  const card = (presentation: "full" | "inline", readData?: () => ExpressionGraphValue | undefined, detail = false) => {
    const data = () => readData ? readData() : props.data;
    const card = () => <ValueCard
    class={presentation === "full" ? "expr-call-graph__result-data-card" : "expr-call-graph__edge-data-card"}
    presentation={presentation === "full" && !detail ? "graph" : presentation} compactLayout={presentation === "inline" ? "one-line" : undefined}
    onMenu={event => openMenu(event, readData ? openedChild()?.child : undefined)} menuOpen={menu.isOpen()} onOpen={presentation === "full" && !readData ? openData : undefined}
    busy={!data() && capture.pending()} loadingLabel={capture.pendingLabel?.() ?? "Computing data…"}
    heading={<ValueCardCaption caption={data()?.caption ?? (!readData ? props.dataCaption : undefined)} icon={data()?.valueIcon} emoji={data()?.valueEmoji}
      typeLabel={data()?.typeLabel ?? (!readData ? props.typeLabel : undefined)} typeIcon={data()?.typeIcon} onOpen={!readData ? openData : undefined}
      typePending={!readData && !!props.typePending && !(data()?.typeLabel ?? props.typeLabel)} />}>
    <Show when={data()} fallback={unknownInputs ? null : <span class="text-muted" data-tooltip="This expression has no observed result yet">Data not available</span>}>
      <ExpressionGraphReadValueSurface data={data()!} readValue={current => props.body?.(presentation === "inline", openContained, current, detail,
        props.occurrence ? { source: props.occurrence, path: readData ? openedChild()?.child.path ?? [] : [] } : undefined)
        ?? <DataPreview value={current.value} />} />
    </Show>
  </ValueCard>;
    return presentation === "full" && props.presentation === "full" && !detail && !readData
      ? <ExpressionGraphCollectionSurface>{card()}</ExpressionGraphCollectionSurface> : card();
  };
  return <div class={["expr-call-graph__data-card-host", { "expr-call-graph__data-card-host--unnamed": !displayNameText(dataCaption())?.trim() }]}
    data-corner-menu-owner="true" onContextMenu={event => openMenu(event)}>
    <Show when={props.inline} fallback={<Show when={props.presentation === "full"} fallback={
      <ValueHoverPreview class="expr-call-graph__edge-data" label={caption()} onOpen={openData} fullPreview
        onContextMenu={event => openMenu(event)} preview={() => card("full")}>{card("inline")}</ValueHoverPreview>
    }>{card("full")}</Show>}>
    <Show when={props.data} fallback={<button type="button" class="expr-call-graph__edge-value expr-call-graph__edge-value--pending"
      aria-label={`${props.inline ? "Show input as a node" : "Inspect input"}: ${displayNameText(caption())}`}
      data-tooltip={unknownInputs ? "Known when the function is called" : "Computed data is not available yet"}
      onClick={event => { event.stopPropagation(); props.onOpen?.(); }}>{thumbnail()}</button>}>
      <ValueHoverPreview class="expr-call-graph__edge-value" label={caption()} onOpen={props.onOpen} fullPreview
        onContextMenu={event => openMenu(event)} preview={() => card("full")}>{thumbnail()}</ValueHoverPreview>
    </Show>
    </Show>
    <CornerMenu menu={menu} items={items()} trigger={false} label="Data actions" />
    <Show when={opened()}><ExpressionArgumentDialog variant="viewer" label={openedData()?.caption ?? openedData()?.typeLabel ?? typeLabel() ?? "Data"} onClose={() => setOpened(false)}>
      {card("full", openedData, true)}
    </ExpressionArgumentDialog></Show>
  </div>;
}

/** The existing literal-editor block is also its universal data read lens. */
export function ExpressionLiteralSurface(props: { value: unknown; readonly?: boolean; children?: JSX.Element }) {
  const compact = useExpressionCallCompact();
  return <div class="expr-literal--block"><Show when={compact()} fallback={<Show when={props.readonly} fallback={props.children}>
    <DataPreview value={props.value} />
  </Show>}><Show when={props.value === " "} fallback={<DataPreview value={props.value} />}>
    <span class="expr-literal__space text-muted" aria-label="Space" data-tooltip="Space">Space</span>
  </Show></Show></div>;
}

/** A list expression keeps its actual item sites and the universal list read
 * chrome. No synthetic array is evaluated or mistaken for observed data. */
export function ExpressionGraphListPreview(props: {
  items: readonly ExprNode[];
  data: (node: ExprNode) => ExpressionGraphValue | undefined;
  typeLabel: (type: FenelType) => string | undefined;
  typeIcon: (type: FenelType) => string | undefined;
  readValue: (data: ExpressionGraphValue, onOpenData?: (child: ContainedValuePreview) => void, node?: ExprNode,
    occurrence?: DataReadOccurrence) => JSX.Element;
  occurrence?: (node: ExprNode) => DataOccurrenceSource;
  thumbnail?: (data: ExpressionGraphValue) => JSX.Element;
  /** An item's own identity glyph (a nullary constructor), without data. */
  glyph?: (node: ExprNode) => HeldItemGlyph | undefined;
}) {
  const unknownInputs = !!useContext(ExpressionGraphInputsContext);
  const childData = (node: ExprNode, index: number): ContainedValuePreview => {
    const data = props.data(node);
    return { value: data?.value, caption: data?.caption, label: `Item ${index + 1}`, path: [index], getType: () => props.data(node)?.type,
      typeLabel: data?.typeLabel || (data?.type && props.typeLabel(data.type)) || "Any",
      typeIcon: data?.typeIcon ?? (data?.type && props.typeIcon(data.type)) };
  };
  return <CollectionPreviewStrip items={props.items} label="Items" inlinePreviews
    itemLabel={(_node, index) => `Item ${index + 1}`}
    itemControl={(node, index) => <Show when={props.data(node)}>{data => <ExpressionGraphCollectionItemControl
      data={childData(node, index)} source={props.items}
      occurrence={props.occurrence ? { source: props.occurrence(node), path: [] } : undefined}
      render={(selected, onOpenData, occurrence) => <ExpressionGraphReadValueSurface data={selected ?? data()}
        readValue={current => props.readValue(current, onOpenData, node, occurrence)} />} />}</Show>}
    render={node => <Show when={props.data(node)} fallback={<DataThumbnail value={undefined} picture={props.glyph?.(node)?.picture}
      valueIcon={props.glyph?.(node)?.icon} emoji={props.glyph?.(node)?.emoji} />}>
      {data => props.thumbnail?.(data()) ?? <DataThumbnail value={data().value} valueIcon={data().valueIcon}
        emoji={data().valueEmoji} typeIcon={data().typeIcon ?? (data().type && props.typeIcon(data().type!))} />}
    </Show>}
    preview={node => <ValueCard presentation="inline" compactLayout="two-line"
      heading={<ValueCardCaption caption={props.data(node)?.caption ?? props.glyph?.(node)?.name}
        picture={props.data(node) ? undefined : props.glyph?.(node)?.picture}
        icon={props.data(node)?.valueIcon} emoji={props.data(node)?.valueEmoji} typeLabel={props.data(node)?.typeLabel || (props.data(node)?.type && props.typeLabel(props.data(node)!.type!)) || "Any"}
        typeIcon={props.data(node)?.typeIcon ?? (props.data(node)?.type && props.typeIcon(props.data(node)!.type!))} />}>
      <Show when={props.data(node)} fallback={unknownInputs || props.glyph?.(node) ? null : <span class="text-muted">Data not available</span>}>{data =>
        <ExpressionGraphReadValueSurface data={data()} readValue={current => props.readValue(current, undefined, node)} />}</Show>
    </ValueCard>} />;
}

/** Held parameter names: the owner's field presentation, then a declared
 * label, then the parameter's code name (code face), then "Input N". */
function heldParameterName(presentation: HeldExpressionPresentation, field: FieldDef | undefined, ordinal: number): DisplayNameInput {
  const owned = field && presentation.fieldLabel?.(field);
  if (displayNameText(owned)) return owned;
  const label = valueCardLabel(peelMaybeValue(field?.label));
  if (label) return label;
  return field?.name ? codeName(field.name) : `Input ${ordinal + 1}`;
}

/** Metadata changes update this mounted call's props. Resolving the callable
 * in HeldNode's render thunk would recreate its graph owner, whose activation
 * itself asks Home for metadata and starts a recursive publication loop. */
function HeldCall(props: { node: Extract<ExprNode, { kind: "call" }>; presentation: HeldExpressionPresentation;
  sourceData: () => ExpressionGraphValue | undefined; graphCaptureAllowed?: boolean; edit?: (next: ExprNode) => void;
  /** The slot's declared type: a result without observed data keeps its type. */
  resultTypeLabel?: string;
  /** This call is a function body's last step: its arrow ends in the Result card. */
  functionResult?: FunctionResultSlot }) {
  const graphValue = useContext(ExpressionGraphValueContext);
  const inputs = useContext(ExpressionGraphInputsContext);
  const described = createMemo(() => props.presentation.callable(props.node.fnId));
  const declaredResult = () => described()?.params && props.node.args.length === described()!.params!.length
    && described()?.returns ? (props.presentation.graphTypeLabel ?? props.presentation.typeLabel)(described()!.returns!) : undefined;
  return <ExpressionCallSurface name={<DisplayNameText name={described()?.name} fallback={<em>Data</em>} />}
    icon={described()?.icon ? <IconByName name={described()!.icon!} size={16} /> : undefined}
    resultType={declaredResult()}
    graphNode={props.node} graphCaptureAllowed={props.graphCaptureAllowed !== false}
    graphResult={inspect => props.functionResult ? <FunctionResultCard type={props.functionResult.type} icon={props.functionResult.icon}
      origin={props.functionResult.origin} /> : <ExpressionGraphValuePreview data={props.sourceData()} presentation="full"
      occurrence={props.presentation.occurrence?.(props.node)}
      typeLabel={props.sourceData()?.typeLabel ?? (props.sourceData()?.type && props.presentation.typeLabel(props.sourceData()!.type!))
        ?? props.resultTypeLabel ?? declaredResult()}
      dataCaption={props.sourceData()?.caption} body={(compact, onOpenData, data, detail, occurrence) => props.presentation.readValue?.(data ?? props.sourceData()!, compact, onOpenData, detail, occurrence)
        ?? <DataPreview value={(data ?? props.sourceData())?.value} />} onOpen={inspect} />}
    missingInputs={described()?.params?.slice(props.node.args.length).map((field, offset) => ({ ordinal: props.node.args.length + offset,
      name: heldParameterName(props.presentation, field, props.node.args.length + offset) }))}
    isConstructor={described()?.isConstructor ?? props.node.callSyntax === "construct"} readonly={!props.edit} nodeChrome
    onConvertToLiteral={props.edit ? () => props.edit?.(emptyHeldSlot()) : undefined}>
    <For keyed={false} each={props.node.args}>{(argument, index) => {
      const field = () => described()?.params?.[index];
      const label = () => heldParameterName(props.presentation, field(), index);
      const data = createMemo<ExpressionGraphValue | undefined>(() => {
        const observed = graphValue?.(argument());
        const current = argument();
        const nested = current.kind === "call" ? props.presentation.callable(current.fnId) : undefined;
        const declaredType = current.kind === "call" && nested?.params?.length === current.args.length ? nested?.returns : field()?.type;
        if (observed) return heldGraphValue(observed, props.presentation, declaredType);
        return current.kind === "literal" && !detectStructuralForm(current.value, () => true) && current.value !== undefined
          ? heldGraphValue({ value: current.value }, props.presentation, field()?.type) : undefined;
      });
      const inputType = () => { const current = argument(); return current.kind === "param" ? inputs?.get(current.name)?.type : undefined; };
      const typeLabel = () => data()?.typeLabel ?? (data()?.type && (props.presentation.graphTypeLabel ?? props.presentation.typeLabel)(data()!.type!))
        ?? (inputType() && props.presentation.typeLabel(inputType()!))
        ?? (argument().kind === "call" ? (() => {
          const nested = argument() as Extract<ExprNode, { kind: "call" }>;
          const callable = props.presentation.callable(nested.fnId);
          return callable?.params?.length === nested.args.length && callable.returns ? (props.presentation.graphTypeLabel ?? props.presentation.typeLabel)(callable.returns) : undefined;
        })() : field() ? (props.presentation.graphTypeLabel ?? props.presentation.typeLabel)(field()!.type) : undefined);
      const dataCaption = () => argument().kind === "param" ? codeName((argument() as Extract<ExprNode, { kind: "param" }>).name)
        : argument().kind === "ref" ? props.presentation.reference?.((argument() as Extract<ExprNode, { kind: "ref" }>).savedExprId)?.name
        : undefined;
      // In a read graph (a function read, a value's Expression panel) every
      // input stays visible as a card (the domain given to solve, the foods
      // given to a recipe): data in, the function, the result out.
      return <ExpressionCallArgumentRow parameterName={label()} ordinal={index}
        nodeByDefault={index === 0 || argument().kind === "call" || !!inputs || !props.edit}
        filled={argument().kind !== "literal" || (argument() as Extract<ExprNode, { kind: "literal" }>).value !== undefined} readonly={!props.edit}
        edgeLabel={inspect => <ExpressionGraphValuePreview data={data()} typeLabel={typeLabel()} caption={label()} dataCaption={dataCaption()}
          occurrence={props.presentation.occurrence?.(argument())}
          body={(compact, onOpenData, selected, detail, occurrence) => props.presentation.readValue?.(selected ?? data()!, compact, onOpenData, detail, occurrence)
            ?? <DataPreview value={(selected ?? data())?.value} />} onOpen={inspect} />}
        slotPreview={unfold => <ExpressionGraphValuePreview data={data()} typeLabel={typeLabel()} caption={label()} dataCaption={dataCaption()}
          occurrence={props.presentation.occurrence?.(argument())}
          body={(compact, onOpenData, selected, detail, occurrence) => props.presentation.readValue?.(selected ?? data()!, compact, onOpenData, detail, occurrence)
            ?? <DataPreview value={(selected ?? data())?.value} />} inline onOpen={unfold} />}>
        <HeldNode node={argument()} presentation={props.presentation} field={field()} hideLabel={!!inputs}
          paramName={displayNameText(label())} graphCaptureAllowed={props.graphCaptureAllowed}
          edit={props.edit ? next => props.edit?.({ ...props.node, args: props.node.args.map((current, position) => position === index ? next : current) }) : undefined} />
      </ExpressionCallArgumentRow>;
    }}</For>
  </ExpressionCallSurface>;
}

function emptyHeldSlot(): ExprNode { return { kind: "literal", value: undefined }; }

/** `(\x -> body) $ value` is how `let x = value` reaches saved data (the core
 * desugaring nests one applied lambda per binding); reading names it again.
 * Presentation only: the ExprNode, its evaluation and its Code are unchanged. */
function heldLetChain(node: ExprNode): { body: ExprNode; bindings: WhereBinding<ExprNode>[] } | undefined {
  // A source body's `let …; let …; result` do block reads as the same frame.
  const block = heldDoLetChain(node);
  if (block) return block;
  const bindings: WhereBinding<ExprNode>[] = [];
  let body = node;
  for (;;) {
    const applied = body.kind === "literal" ? detectStructuralForm(body.value, () => true) : null;
    if (applied?.kind !== "apply" || applied.content.syntax === "apply" || applied.content.args.length !== 1) break;
    const target = applied.content.target;
    const lambda = target.kind === "literal" ? detectStructuralForm(target.value, () => true) : null;
    if (lambda?.kind !== "lambda" || lambda.arrayParams || lambda.params.length !== 1) break;
    bindings.push({ name: lambda.params[0]!, expr: applied.content.args[0]! });
    body = lambda.body;
  }
  return bindings.length ? { body, bindings } : undefined;
}

/** A nullary constructor names its own value; showing its identity needs no
 * evaluation (its glyph comes from the reader's existing presentation: its
 * Picturable picture first, as the data cards' marks draw it, then its icon
 * or emoji). A name in scope shows its name. */
export function heldConstructorGlyph(node: ExprNode, presentation: HeldExpressionPresentation): HeldItemGlyph | undefined {
  if (node.kind === "param") return { name: codeName(node.name), icon: "variable" };
  if (node.kind !== "call" || node.args.length > 0) return undefined;
  const constructor = presentation.callable(node.fnId);
  return constructor && (constructor.isConstructor || node.callSyntax === "construct")
    ? { name: constructor.name, icon: constructor.icon, emoji: constructor.emoji, picture: constructor.picture } : undefined;
}

/** A name inside a function read's graph: an input (an unknown until the
 * call) or one of the function's local names. Name only: its type is stated
 * once, in the signature rows. A read-only label, not a field. */
function FunctionNameChip(props: { name: DisplayNameInput; local?: boolean }) {
  return <span class={["expr-function-input", { "expr-function-input--local": !!props.local }]}
    data-tooltip={props.local ? "A local name of this function" : "An input: its data arrives when the function is called"}>
    <span class="expr-form__name"><DisplayNameText name={props.name} /></span>
  </span>;
}

/** Names a function read's parameter as its owner presents the field (its
 * Labelable label, then its declared label), else by the lambda's own binder. */
function frameParameterName(presentation: HeldExpressionPresentation, field: FieldDef | undefined, binder: string): DisplayNameInput {
  if (positionalParameter(field)) return codeName(binder);
  const owned = field && presentation.fieldLabel?.(field);
  if (displayNameText(owned)?.trim()) return owned!;
  const label = valueCardLabel(peelMaybeValue(field?.label));
  return label || codeName(binder);
}

/** Plain data starts editable at once; functions come from what is listed. */
function HeldDataChoices(props: { onData: (value: unknown) => void; onFunction?: () => void }) {
  // The function picker opens in this occurrence's own insert window.
  const openInspector = useExpressionInspectorOpen();
  return <div class="expr-graph-authoring-actions" aria-label="Add data">
    <button type="button" class="expr-form__btn" onClick={() => props.onData("")}>Text</button>
    <button type="button" class="expr-form__btn" onClick={() => props.onData(0)}>Number</button>
    <button type="button" class="expr-form__btn" onClick={() => props.onData({ __list: [] })}>List</button>
    <button type="button" class="expr-form__btn" onClick={() => props.onData({ __record: { fields: [] } })}>Record</button>
    <Show when={props.onFunction}><button type="button" class="expr-form__btn" onClick={() => { props.onFunction?.(); openInspector?.(); }}>Function…</button></Show>
  </div>;
}

/** The held source of the one function picker (FunctionPickerSurface): the
 * functions its owner already lists, named like the prepared catalogue, with
 * their inputs. No engine, type ranking or constructors before the editing
 * tools are ready; the owner's own lines say what is still arriving. */
function heldFunctionPickerModel(presentation: HeldExpressionPresentation, requiresInput: () => boolean,
  onPick: (choice: HeldFunctionChoice) => void, query: FunctionPickerQuery): FunctionPickerModel {
  onSettled(() => { presentation.requestFunctionChoices?.(); });
  const choices = createMemo((): HeldFunctionChoices => presentation.functionChoices?.() ?? { entries: [], pending: "Preparing functions…" });
  // The prepared picker's search order (callable-names.ts): exact, prefix,
  // then substring of the shown name, label and id; descriptions last.
  const filtered = createMemo(() => {
    const text = query.text().trim();
    const needsInput = requiresInput();
    const listed = choices().entries.filter(choice => choice.kind !== "constructor" && (!needsInput || choice.params.length > 0));
    if (!text) return listed;
    return listed.filter(choice => Number.isFinite(functionSearchRank(choice, text)))
      .toSorted((a, b) => compareFunctionSearch(a, b, text));
  });
  const rows = new WeakMap<HeldFunctionChoice, FunctionPickerRow>();
  const row = (choice: HeldFunctionChoice): FunctionPickerRow => {
    let current = rows.get(choice);
    if (!current) rows.set(choice, current = { key: `global:${choice.id}`, fnId: choice.id, name: functionDisplayName(choice),
      tooltip: choice.description || undefined, signature: () => choice.params.map(param => param.name).join(", "),
      take: () => { if (filtered().includes(choice)) onPick(choice); } });
    return current;
  };
  return {
    placeholder: "Search functions…",
    rows: () => filtered().map(row),
    pending: () => choices().pending,
    failure: () => { const current = choices(); return current.error ? { message: current.error, retry: current.retry } : undefined; },
    more: () => choices().more,
  };
}

type HeldChoosing = "replace" | "wrap" | "before";

function HeldNode(props: { node: ExprNode; presentation: HeldExpressionPresentation; field?: FieldDef; paramName?: string; typeName?: string;
  hideLabel?: boolean; graphCaptureAllowed?: boolean; edit?: (next: ExprNode) => void; allowLocalBindings?: boolean;
  /** A function read's root: where each signature slot got its type. */
  signatureOrigins?: FunctionSignatureOrigins;
  /** This node is a function body: the node it ends in shows the Result card. */
  functionResult?: FunctionResultSlot }) {
  const graphValue = useContext(ExpressionGraphValueContext);
  const inheritedScopeCapture = useContext(ExpressionGraphScopeCaptureContext);
  const inheritedGraphLens = useContext(ExpressionGraphAuthoringContext);
  const inputs = useContext(ExpressionGraphInputsContext);
  const occurrence = () => props.presentation.occurrence?.(props.node);
  const suggestions = createDataOccurrenceSuggestions(occurrence);
  const form = () => props.node.kind === "literal" ? detectStructuralForm(props.node.value, () => true) : null;
  // Early editing: every change is a whole-node draft replacement handed to
  // the owner; no evaluation, catalogue judgment or persistence happens here.
  const editing = () => !!props.edit;
  // Read-only function presentation: a function, its local names and its
  // decisions are frames around the same graph lens, which starts at a lambda.
  const functionFrame = () => !editing() && form()?.kind === "lambda";
  const graphLens = () => inheritedGraphLens() || functionFrame();
  const letChain = createMemo(() => editing() ? undefined : heldLetChain(props.node));
  const ifArgs = () => {
    const held = form();
    return !editing() && held?.kind === "operation" && held.content.op === "if" && held.content.args.length === 3 ? held.content.args : undefined;
  };
  const ownFrame = () => {
    const held = form();
    return held?.kind === "where" || functionFrame() || !!letChain() || !!ifArgs()
      || !!inputs && (props.node.kind === "param" || !!held && held.kind !== "list");
  };
  const inputType = () => props.node.kind === "param" ? inputs?.get(props.node.name)?.type : undefined;
  // A bare type variable (`a`, `b` of a generic callee) tells a reader nothing,
  // and neither does an unsettled type: it shows nothing, never "Anything".
  const typePhrase = (type: FenelType | undefined) => {
    if (!type || "$var" in type || "$ref" in type && (type.$ref === "Any" || type.$ref === "Anything")) return undefined;
    const label = valueCardTypeLabel(props.presentation.typeLabel(type));
    return label === "Anything" ? undefined : label;
  };
  const typeSlot = (type: FenelType | undefined, origin: TypeContractOrigin | undefined): FunctionResultSlot => {
    const label = typePhrase(type);
    return label ? { type: label, icon: props.presentation.typeIcon?.(type!), origin } : {};
  };
  const empty = () => props.node.kind === "literal" && props.node.value === undefined;
  const [choosing, setChoosing] = createSignal<HeldChoosing>();
  const change = (next: ExprNode) => { setChoosing(undefined); props.edit?.(next); };
  const changeLiteral = (value: unknown) => change({ kind: "literal", value });
  const addBinding = () => changeLiteral({ __where: { body: props.node, bindings: [blankLocalBinding([])] } });
  function pickFunction(choice: HeldFunctionChoice) {
    const mode = choosing();
    const empties = (count: number) => Array.from({ length: Math.max(0, count) }, emptyHeldSlot);
    if (mode === "wrap") change({ kind: "call", fnId: choice.id, args: [props.node, ...empties(choice.params.length - 1)] });
    else if (mode === "before" && props.node.kind === "call") {
      const first = props.node.args[0] ?? emptyHeldSlot();
      change({ ...props.node, args: [{ kind: "call", fnId: choice.id, args: [first, ...empties(choice.params.length - 1)] },
        ...props.node.args.slice(1)] });
    } else change({ kind: "call", fnId: choice.id, args: empties(choice.params.length) });
  }
  // The picker is this occurrence's insert window (ExprFieldShell's pending
  // insertion): closing the window (or Escape) closes the picker.
  const chooser = () => <Show when={editing() && choosing()}>{mode => <FunctionPickerSurface lockKind
    model={query => heldFunctionPickerModel(props.presentation, () => mode() !== "replace", pickFunction, query)}
    onCancel={() => setChoosing(undefined)}>
    <Show when={mode() === "replace"}><HeldDataChoices onData={changeLiteral} /></Show>
  </FunctionPickerSurface>}</Show>;
  createEffect(() => editing() && !!choosing(), open => {
    if (!open) return;
    props.presentation.pickerOpen?.(true);
    return () => props.presentation.pickerOpen?.(false);
  });
  const scopeCapture = {
    node: () => inheritedScopeCapture.node() ?? (form()?.kind === "where" ? props.node : undefined),
    allowed: () => props.graphCaptureAllowed !== false && (!inheritedScopeCapture.node() || inheritedScopeCapture.allowed()),
  };
  const mode = (): Mode => props.node.kind !== "literal" ? props.node.kind
    : structuralModeForForm(form()) ?? (typeof props.node.value === "string" || typeof props.node.value === "number" ? "inline" : "use");
  const literal = (editable = true) => {
    const held = form();
    const value = (props.node as Extract<ExprNode, { kind: "literal" }>).value;
    if (held?.kind === "record") {
      const fields = held.fields;
      const setFields = (next: { name: string; value: ExprNode }[]) => changeLiteral({ __record: { fields: next } });
      const addField = () => {
        let name = "field";
        for (let count = 1; fields.some(field => field.name === name);) name = `field${++count}`;
        setFields([...fields, { name, value: emptyHeldSlot() }]);
      };
      return <RecordValueEditorSurface fields={fields} readonly={!editing()}
        onAdd={editing() ? addField : undefined}
        onRemove={editing() ? index => setFields(fields.filter((_, position) => position !== index)) : undefined}
        fieldName={slot => <Show when={editing()} fallback={<span class="expr-form__name mono">{slot.field.name}</span>}>
          <StringInputSurface value={slot.field.name} placeholder="field name"
            onChange={name => setFields(fields.map((field, position) => position === slot.index ? { ...field, name } : field))} />
        </Show>}
        expression={slot => <HeldNode node={slot.field.value} presentation={props.presentation} graphCaptureAllowed={props.graphCaptureAllowed} hideLabel
          edit={props.edit ? next => setFields(fields.map((field, position) => position === slot.index ? { ...field, value: next } : field)) : undefined} />} />;
    }
    if (held?.kind === "lambda" && functionFrame()) {
      // A function reads as the expression graph it bundles: its signature
      // (TypeContract's rows: Parameters, Returns) is stated once at the top;
      // the graph below uses each input by name only, its lets are named local
      // values, and its last step ends in the Result card. Only the surrounding
      // admitted arrow supplies types; the owner's declaration says where each
      // came from. Nothing checks or runs the body with invented inputs.
      const arrow = () => props.field?.type && "$arrow" in props.field.type ? props.field.type.$arrow : undefined;
      const inner = heldLetChain(held.body) ?? { body: held.body, bindings: [] };
      const scope = new Map<string, ExpressionGraphInput>(inputs ?? []);
      // The lambda's own binder names each input (or its owner's field label).
      const parameterName = (name: string, index: number) => frameParameterName(props.presentation, arrow()?.params[index], name);
      held.params.forEach((name, index) => scope.set(name, { type: arrow()?.params[index]?.type, name: parameterName(name, index) }));
      for (const binding of inner.bindings) scope.set(binding.name, { local: true });
      const result = (): FunctionResultSlot => typeSlot(arrow()?.returns, props.signatureOrigins?.returns);
      // A call or an If draws the graph whose last arrow ends in the Result
      // card; any other body is followed by the card.
      const bodyForm = inner.body.kind === "literal" ? detectStructuralForm(inner.body.value, () => true) : null;
      const bodyEndsInGraph = inner.body.kind === "call"
        || bodyForm?.kind === "operation" && bodyForm.content.op === "if" && bodyForm.content.args.length === 3;
      return <ExpressionGraphInputsContext value={scope}><WhereFormEditorSurface readonly graph caption="Function" kind="function"
        mainLabel="Function body" body={inner.body} bindings={inner.bindings} onChange={() => {}}
        inputs={() => <section class="expr-function-signature" aria-label="Function signature">
          <TypeContract signature={{
            params: held.params.map((name, index) => ({ name: <DisplayNameText name={parameterName(name, index)} />,
              ...typeSlot(arrow()?.params[index]?.type, props.signatureOrigins?.params[index]) })),
            returns: result() }} />
        </section>}
        result={bodyEndsInGraph ? undefined : () => <FunctionResultCard type={result().type} icon={result().icon} origin={result().origin} />}
        bindingName={slot => <span class="expr-local-name"><DisplayNameText name={codeName(slot.binding.name)} /></span>}
        expression={slot => <HeldNode node={slot.value} presentation={props.presentation} hideLabel graphCaptureAllowed={false}
          functionResult={slot.index === undefined && bodyEndsInGraph ? result() : undefined}
          field={slot.index === undefined && arrow() ? { name: "body", type: arrow()!.returns, label: Nothing, meta: {}, ui: Nothing } : undefined} />} />
      </ExpressionGraphInputsContext>;
    }
    const chain = letChain();
    if (chain) return <ExpressionGraphInputsContext value={inputs && new Map<string, ExpressionGraphInput>([...inputs, ...chain.bindings.map(binding => [binding.name, { local: true }] as const)])}>
      <WhereFormEditorSurface readonly graph body={chain.body} bindings={chain.bindings} onChange={() => {}}
        bindingName={slot => <span class="expr-scope-name">{slot.binding.name}</span>}
        expression={slot => <HeldNode node={slot.value} presentation={props.presentation} hideLabel graphCaptureAllowed={props.graphCaptureAllowed}
          field={slot.index === undefined ? props.field : undefined} />} />
    </ExpressionGraphInputsContext>;
    const branches = ifArgs();
    if (branches) return <IfGraphSurface
      condition={() => <HeldNode node={branches[0]!} presentation={props.presentation} hideLabel graphCaptureAllowed={props.graphCaptureAllowed} />}
      whenTrue={() => <HeldNode node={branches[1]!} presentation={props.presentation} hideLabel graphCaptureAllowed={props.graphCaptureAllowed} field={props.field} />}
      whenFalse={() => <HeldNode node={branches[2]!} presentation={props.presentation} hideLabel graphCaptureAllowed={props.graphCaptureAllowed} field={props.field} />}
      // A function body's If ends in the function's Result card; any other If
      // ends in its type, in the cards' type face.
      result={props.functionResult ? () => <FunctionResultCard type={props.functionResult?.type} icon={props.functionResult?.icon}
        origin={props.functionResult?.origin} />
        : typePhrase(props.field?.type) ? () => <span class="expr-if-graph__result-type">
          <TypeContractType type={typePhrase(props.field?.type)} icon={props.field && props.presentation.typeIcon?.(props.field.type)} /></span> : undefined} />;
    if (held?.kind === "lambda") {
      // Only the surrounding admitted arrow supplies types. The lambda's
      // authored names remain its binders; reading it never checks or runs
      // the body with invented arguments.
      const arrow = () => props.field?.type && "$arrow" in props.field.type ? props.field.type.$arrow : undefined;
      return <LambdaFormEditorSurface params={held.params} readonly
        parameter={slot => <span class="expr-form__name"><DisplayNameText name={arrow()?.params[slot.index] && !positionalParameter(arrow()!.params[slot.index])
          ? props.presentation.fieldLabel?.(arrow()!.params[slot.index]!) ?? codeName(slot.name) : codeName(slot.name)} /></span>}
        parameterType={slot => <Show when={arrow()?.params[slot.index]}>{parameter =>
          <TypeContractType type={typePhrase(parameter().type)} icon={props.presentation.typeIcon?.(parameter().type)} />}</Show>}
        result={arrow() ? () => <TypeContractType type={typePhrase(arrow()!.returns)} icon={props.presentation.typeIcon?.(arrow()!.returns)} /> : undefined}
        body={() => <HeldNode node={held.body} presentation={props.presentation} paramName="body" graphCaptureAllowed={false}
          field={arrow() ? { name: "body", type: arrow()!.returns, label: Nothing, meta: {}, ui: Nothing } : undefined} />} />;
    }
    if (held?.kind === "construct") return <ConstructFormEditorSurface fields={held.fields} readonly
      tag={() => <span class="expr-pattern__ctor-tag-btn mono"><DisplayNameText name={props.presentation.callable(held.tag)?.name ?? codeName(displayCallableHandle(held.tag))} /></span>}
      fieldName={slot => <span class="expr-form__name mono">{slot.field.name}</span>}
      expression={slot => <HeldNode node={slot.field.value} presentation={props.presentation} hideLabel graphCaptureAllowed={false} />} />;
    if (held?.kind === "let") return <LetBindingsFormEditorSurface bindings={held.bindings} readonly
      bindingName={slot => <span class="expr-form__name mono">{slot.binding.name}
        <Show when={slot.binding.type}>{type => <span class="text-muted"> : {props.presentation.typeLabel(type())}</span>}</Show>
      </span>}
      expression={slot => <HeldNode node={slot.binding.expr} presentation={props.presentation} hideLabel graphCaptureAllowed={false}
        field={slot.binding.type ? { name: slot.binding.name, type: slot.binding.type, label: Nothing, meta: {}, ui: Nothing } : undefined} />} />;
    if (held?.kind === "match") return <MatchFormEditorSurface arms={held.arms} readonly
      scrutinee={() => <HeldNode node={held.scrutinee} presentation={props.presentation} hideLabel graphCaptureAllowed={false} />}
      pattern={slot => <ExpressionLiteralSurface value={slot.arm.pattern} readonly />}
      body={slot => <HeldNode node={slot.arm.body} presentation={props.presentation} hideLabel graphCaptureAllowed={false} />} />;
    if (held?.kind === "where") return <WhereFormEditorSurface body={held.body} bindings={held.bindings} readonly={!editing()} graph
      onChange={next => { if (props.edit) "kind" in next ? change(next) : changeLiteral({ __where: next }); }}
      bindingName={slot => <Show when={editing()} fallback={<span class="expr-form__name mono">{slot.binding.name}</span>}>
        <StringInputSurface value={slot.binding.name} placeholder="binding name" onChange={slot.onChange} />
      </Show>}
      expression={slot => <HeldNode node={slot.value} presentation={props.presentation} hideLabel
        graphCaptureAllowed={props.graphCaptureAllowed} edit={props.edit ? slot.onChange : undefined}
        allowLocalBindings={slot.index !== undefined} />} />;
    if (held && (held.kind === "list" || held.kind === "lookup" || held.kind === "apply" || held.kind === "scope" || held.kind === "pipeline" || held.kind === "operation")) {
      // Only a list's own rows are plain structure; the other forms keep their
      // typed controls for the prepared editor while their children edit.
      const own = editing() && held.kind === "list";
      return <div class={own ? undefined : "expr-inspection__disabled"}><ExtendedExpressionEditor form={held}
        onChange={marker => { if (props.edit) changeLiteral(marker); }} operators={[]} readonly={!own}
        expression={slot => <HeldNode node={slot.value} presentation={props.presentation} paramName={slot.label}
          graphCaptureAllowed={props.graphCaptureAllowed !== false && held.kind !== "scope"}
          edit={props.edit ? slot.onChange : undefined} />}
        literal={slot => <ExpressionLiteralSurface value={slot.value} readonly />} /></div>;
    }
    if (held) return <CardLoadingIndicator label="Preparing this expression editor…" />;
    const ref = value && typeof value === "object" && Object.keys(value).length === 1 && "$ref" in value
      && typeof value.$ref === "string" ? value.$ref : undefined;
    if (ref) {
      const described = props.presentation.reference?.(ref);
      return <ExpressionReferenceSurface glyph={described?.kind === "function" ? "ƒ" : described?.kind === "type" ? "τ" : "→"}
        name={described?.name ?? <em>data</em>} tooltip={described?.kind === "function" ? "Function" : described?.kind === "type" ? "Type" : "Reference"}
        swapTooltip="Pick a different reference"
        convertTooltip="Replace this reference with data" readonly={!editing()}
        onSwap={editing() ? () => setChoosing("replace") : undefined}
        onConvertToLiteral={editing() ? () => change(emptyHeldSlot()) : undefined} />;
    }
    // In a graph card the card's own "Add data or a function" opens the picker.
    if (editing() && value === undefined) return <HeldDataChoices onData={changeLiteral} onFunction={editable ? () => setChoosing("replace") : undefined} />;
    if (editable && editing() && (typeof value === "string" || typeof value === "number")) {
      return <ExpressionLiteralSurface value={value}><Switch>
        <Match when={typeof value === "string"}><div class="fr-input-wrap"><StringInputSurface value={value as string} onChange={changeLiteral} /></div></Match>
        <Match when={typeof value === "number"}><div class="fr-input-wrap"><NumberInput value={value} class="fe-input" onChange={changeLiteral} /></div></Match>
      </Switch></ExpressionLiteralSurface>;
    }
    return <ExpressionLiteralSurface value={value} readonly />;
  };
  const call = () => <HeldCall node={props.node as Extract<ExprNode, { kind: "call" }>} presentation={props.presentation}
    sourceData={sourceData} graphCaptureAllowed={props.graphCaptureAllowed} edit={props.edit ? change : undefined}
    resultTypeLabel={props.field ? (props.presentation.graphTypeLabel ?? props.presentation.typeLabel)(props.field.type) : undefined}
    functionResult={props.functionResult} />;
  // A reference used as a value (the predicate passed to solve: written as
  // `{ $ref }`, or a name whose observed value is that reference) reads as the
  // named function card below, never as its raw `$ref` handle.
  const valueReference = createMemo(() => heldBareReference(props.node)
    ?? (props.node.kind === "literal" ? undefined : heldBareReferenceValue(graphValue?.(props.node)?.value)));
  const valueFunction = () => { const handle = valueReference(); return handle ? props.presentation.callable(handle) : undefined; };
  // Its type chip is its function type when the reader knows it, else nothing ("Anything" said nothing).
  const valueFunctionType = () => {
    const callable = valueFunction();
    return callable?.params && callable.returns ? (props.presentation.graphTypeLabel ?? props.presentation.typeLabel)(
      { $arrow: { params: [...callable.params], returns: callable.returns } }) : undefined;
  };
  const sourceData = createMemo<ExpressionGraphValue | undefined>(() => {
    if (valueReference()) return undefined;
    const observed = graphValue?.(props.node);
    const callable = props.node.kind === "call" ? props.presentation.callable(props.node.fnId) : undefined;
    const type = props.node.kind === "call" && callable?.params && callable.params.length === props.node.args.length
      ? callable.returns : props.field?.type;
    if (observed) return heldGraphValue(observed, props.presentation, type);
    return props.node.kind === "literal" && props.node.value !== undefined && !form()
      ? heldGraphValue({ value: props.node.value }, props.presentation, type) : undefined;
  });
  const sourceReference = () => {
    if (props.node.kind === "ref") return props.presentation.reference?.(props.node.savedExprId);
    const handle = valueReference();
    if (!handle) return undefined;
    const described = props.presentation.reference?.(handle);
    const callable = valueFunction();
    // The reader's own name for it (a source name such as ticketsSold) when the catalogue has no label.
    const name = described?.name ?? callable?.name ?? (props.node.kind === "param" ? codeName(props.node.name) : undefined);
    // An evaluated value that is a bare reference is a function value.
    const isFunction = !!callable || described?.kind === "function" || props.node.kind !== "literal";
    return { ...described, name, kind: isFunction ? "function" as const : described?.kind,
      icon: described?.icon ?? callable?.icon ?? (isFunction ? "function" : undefined) };
  };
  const sourcePresentation = createMemo(() => {
    const data = sourceData();
    return data && (data.valueIcon !== undefined || data.valueEmoji !== undefined)
      ? { icon: data.valueIcon, emoji: data.valueEmoji } : sourceReference();
  });
  const graphHeadingType = () => valueReference() ? valueFunctionType() : sourceData()?.typeLabel ?? props.typeName
    ?? (sourceData()?.type && props.presentation.typeLabel(sourceData()!.type!))
    ?? (inputType() && props.presentation.typeLabel(inputType()!)) ?? (props.field && props.presentation.typeLabel(props.field.type));
  const listSource = () => { const held = form(); return held?.kind === "list" ? held.content : undefined; };
  const listChild = (node: ExprNode): ExpressionGraphValue | undefined => {
    const observed = graphValue?.(node);
    const declared = props.field && props.presentation.listElementType?.(props.field.type);
    const value = observed ? observed.value : node.kind === "literal" ? node.value : undefined;
    const reference = node.kind === "literal" ? readLocusCatalogReference(node.value)?.id : undefined;
    const caption = node.kind === "param" ? codeName(node.name) : node.kind === "ref" ? props.presentation.reference?.(node.savedExprId)?.name
      : reference ? props.presentation.reference?.(reference)?.name : undefined;
    return observed ? heldGraphValue({ ...observed, caption: observed.caption ?? caption }, props.presentation, declared)
      : node.kind === "literal" && node.value !== undefined && !detectStructuralForm(node.value, () => true)
        ? heldGraphValue({ value, caption }, props.presentation, declared) : undefined;
  };
  return <ExpressionGraphAuthoringContext value={graphLens}><ExpressionGraphScopeCaptureContext value={scopeCapture}><ExprFieldShell mode={mode()} readonly={!editing()} unifiedUse expressionForms
    suggestionOwner={suggestions} empty={editing() && empty()}
    onReplace={editing() ? () => setChoosing("replace") : undefined}
    onAddFunction={editing() ? () => setChoosing("wrap") : undefined}
    onInsertBefore={editing() && props.node.kind === "call" && props.node.args.length > 0 ? () => setChoosing("before") : undefined}
    onInsertAfter={editing() && props.node.kind === "call" ? () => setChoosing("wrap") : undefined}
    onAddBinding={editing() && props.allowLocalBindings !== false && form()?.kind !== "where" ? addBinding : undefined}
    onRemove={editing() ? () => change(emptyHeldSlot()) : undefined}
    pendingInsert={editing() && choosing() ? chooser : undefined}
    onPendingInsertClose={() => setChoosing(undefined)}
    graphEligible={ownFrame() ? false : undefined}
    graphSourceKind={props.node.kind === "call" ? "computed" : "data"}
    // A function value's body names it; its header keeps only its type.
    graphUnnamed={!!valueReference() || !displayNameText(sourceData()?.caption ?? sourceReference()?.name ?? (props.node.kind === "param" ? props.node.name : undefined))?.trim()}
    nodeKind={props.node.kind} inspectorLabel={props.paramName ?? "Expression"}
    graphHeading={<ValueCardCaption caption={sourceData()?.caption ?? sourceReference()?.name
      ?? (props.node.kind === "param" ? codeName(props.node.name) : undefined)}
      icon={sourcePresentation()?.icon} emoji={sourcePresentation()?.emoji}
      typeLabel={graphHeadingType()}
      // Inside a function read an unsettled type shows nothing, never "Anything".
      hideType={!!inputs && !graphHeadingType()}
      typeIcon={valueReference() ? undefined : sourceData()?.typeIcon ?? (props.field && props.presentation.typeIcon?.(props.field.type))} />}
    graphBody={<Show when={sourceData()} fallback={<Switch fallback={<span class="expr-graph-data-card__symbol">{structuralModeForForm(form()) ?? "Expression"}</span>}>
      <Match when={valueReference()}>
        <ExpressionReferenceSurface glyph={sourceReference()?.kind === "function" ? <IconByName name="function" size={16} /> : "→"}
          name={sourceReference()?.name ?? <em>data</em>} tooltip={sourceReference()?.kind === "function" ? "Function" : "Reference"}
          swapTooltip="Pick a different reference" convertTooltip="Replace this reference with data" readonly />
      </Match>
      <Match when={listSource()}>{items => <ExpressionGraphListPreview items={items()} data={listChild}
        glyph={node => heldConstructorGlyph(node, props.presentation)} occurrence={props.presentation.occurrence}
        typeLabel={props.presentation.graphTypeLabel ?? props.presentation.typeLabel}
        typeIcon={type => props.presentation.typeIcon?.(type)}
        readValue={(data, onOpenData, node, occurrence) => props.presentation.readValue?.(data, false, onOpenData, false,
          occurrence ?? (node && props.presentation.occurrence ? { source: props.presentation.occurrence(node), path: [] } : undefined))
          ?? <DataPreview value={data.value} />} />}</Match>
      <Match when={props.node.kind === "literal" && !form()}>{literal(false)}</Match>
      <Match when={props.node.kind === "ref"}>
        <ExpressionReferenceSurface glyph="→" name="Saved data" tooltip="Saved data reference" swapTooltip="Pick different saved data"
          convertTooltip="Replace this reference with data" readonly />
      </Match>
      <Match when={props.node.kind === "param"}>
        <ExpressionReferenceSurface glyph="λ" name={(props.node as Extract<ExprNode, { kind: "param" }>).name}
          tooltip="Parameter" swapTooltip="Pick a different parameter" convertTooltip="Replace this parameter with data" readonly />
      </Match>
    </Switch>}>{data => <ExpressionGraphReadValueSurface data={data()} readValue={current =>
      props.presentation.readValue?.(current, false, undefined, false,
        occurrence() ? { source: occurrence()!, path: [] } : undefined) ?? <DataPreview value={current.value} />} />}</Show>}
    hideLabel={props.hideLabel}
    label={<FieldLabelSurface name={props.paramName ?? props.field?.name}
      typeName={props.typeName ?? (props.field && props.presentation.typeLabel(props.field.type))}
      typePresentation="data" typeIcon={props.field && props.presentation.typeIcon?.(props.field.type)}
      isArrow={!!props.field && "$arrow" in props.field.type} required={false} />}>
    <ExpressionNodeContent kind={props.node.kind} renderLiteral={() => literal()} renderCall={call}
      renderReference={() => <ExpressionReferenceSurface glyph="→" name="Saved data"
        tooltip={(props.node as Extract<ExprNode, { kind: "ref" }>).savedExprId} swapTooltip="Pick different saved data"
        convertTooltip="Replace this reference with data" readonly />}
      renderParameter={() => inputs ? <FunctionNameChip name={inputs.get((props.node as Extract<ExprNode, { kind: "param" }>).name)?.name
          ?? codeName((props.node as Extract<ExprNode, { kind: "param" }>).name)}
        local={inputs.get((props.node as Extract<ExprNode, { kind: "param" }>).name)?.local} />
        : <ExpressionReferenceSurface glyph={<IconByName name="variable" size={16} />}
        name={(props.node as Extract<ExprNode, { kind: "param" }>).name} tooltip="Name in this scope"
        swapTooltip="Pick a different parameter" convertTooltip="Replace this parameter with data" convertKind="param" readonly />} />
  </ExprFieldShell></ExpressionGraphScopeCaptureContext></ExpressionGraphAuthoringContext>;
}
