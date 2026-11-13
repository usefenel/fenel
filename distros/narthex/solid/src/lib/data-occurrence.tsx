import { createContext, createEffect, createMemo, createSignal, latest, onSettled, Show, untrack, useContext, type Accessor } from "solid-js";
import type { JSX } from "@solidjs/web";
import type { FenelType } from "@fenel/engine/types";
import type { ExprNode } from "@fenel/engine/authoring/expression";
import type { AuthoringSession } from "./expression-runner/account-authoring-session";
import type { ContainedValuePreview } from "./data-transfer/DataValueSurface";
import type { DataSuggestion, DataSuggestionInput, SuggestionDisposition } from "./data-suggestions";
import { createDataInspectionSuggestions, type DataInspectionSuggestions } from "./DataInspectionDialog";
import { LocusContextMenu } from "./locus-context-menu";
import type { LocusMenuItem } from "./locus-context-menu";
import { locusContextPosition, ownsLocusContextMenu } from "./locus-menu-actions";
import { draftValueFingerprint } from "./native-draft";

/** Browser capture/action ports only. None of these callbacks are Fenel data. */
export type DataOccurrenceCapture = {
  session: AuthoringSession;
  input: DataSuggestionInput;
  /** The destinations an applied action may take here (review S4): Apply here
   * (rewrite this data in place) and/or New data from this; the first is the
   * fallback when an action's default is not supported. Absent: both. */
  dispositions?: readonly SuggestionDisposition[];
  current: () => boolean;
  /** `evaluate`: show the applied result at once (an explicit one-click apply). */
  select: (node: ExprNode, suggestion: DataSuggestion, options?: { evaluate?: boolean; disposition?: SuggestionDisposition }) => void;
  reportIssue?: (message: string) => void;
};

export type DataOccurrenceSource = {
  state: "source";
  /** Capture the rendered root BEFORE appending a child's result path. The
   * root owns producer declarations, lexical context and the action port. */
  capture: (selection?: ContainedValuePreview) => DataOccurrenceCapture;
  /** Existing source-owned menu/handoff port, including a still preparing reader. */
  openContext?: (event: MouseEvent, selection: ContainedValuePreview) => void;
  /** An existing whole-subject owner can retain its completed/in-flight query. */
  suggestions?: DataInspectionSuggestions;
  /** Polish item 1: the in-place write port, present only where this data's
   * own authored value may be changed here (an editable root card or value
   * scope). Readers never write through it otherwise. */
  edit?: DataOccurrenceEdit;
} | { state: "unavailable"; issue: string };

/** One field written in place: the value at `path` (value coordinates from
 * the rendered root, the same path a read passes as `dataPath`) becomes
 * `value` of `type`. The host keeps the rest of the authored expression and
 * applies its usual guards; with synchronization off or in Local the write is
 * a local draft kept until Save, like the editor dialog's Apply. */
export type DataOccurrenceEdit = {
  /** Whether a field may be edited here now (writable data, no other edit open). */
  available: () => boolean;
  /** The commit button's word: "Apply" for a local draft, else "Save". */
  applyLabel: () => string;
  write: (path: readonly (string | number)[], value: unknown, type: FenelType | undefined) => Promise<void>;
  /** The full editor for this data. */
  openFull?: () => void;
};

export type DataReadOccurrence = { source: DataOccurrenceSource; path: readonly (string | number)[] };

/** A2/B3 transport: retain the producer and captured source scope while the
 * existing Fenel path/checking owner projects the selected child's scheme.
 * The observed child supplies display/check facts, never a replacement body. */
export function captureDataOccurrence(source: DataOccurrenceSource, selection?: ContainedValuePreview): DataOccurrenceCapture {
  if (source.state === "unavailable") throw new Error(source.issue);
  const captured = source.capture(selection);
  if (!selection?.path.length) return captured;
  const hasProducerPath = !!captured.input.sourcePath?.length;
  const input: DataSuggestionInput = { ...captured.input,
    sourcePath: [...captured.input.sourcePath ?? [], ...selection.path],
    sourceType: captured.input.sourceType ?? (hasProducerPath ? undefined : captured.input.type),
    sourceScheme: captured.input.sourceScheme ?? (hasProducerPath ? undefined : captured.input.scheme),
    type: selection.getType(), scheme: undefined, value: selection.value,
    revision: draftValueFingerprint({ revision: captured.input.revision, path: selection.path }),
  };
  // A selected child is new data from its parent, never rewritten in place,
  // and is checked and read as its own authored copy.
  return { ...captured, input: { ...input, reference: undefined }, dispositions: ["CreateDerivedData"] };
}

/** Adapt captured UI lifetime to the existing query owner; no discovery,
 * matching or ranking is implemented here. */
export function createDataOccurrenceSuggestions(getSource: () => DataOccurrenceSource | undefined,
  getSelection?: () => ContainedValuePreview | undefined): DataInspectionSuggestions {
  const local = createDataInspectionSuggestions(() => {
    const source = getSource();
    if (!source) throw new Error("Suggestions need this data's source expression.");
    const selection = getSelection?.();
    const captured = captureDataOccurrence(source, selection);
    return { ...captured, current: () => source === getSource() && selection === getSelection?.() && captured.current() };
  });
  let opened: DataInspectionSuggestions | undefined;
  let frame: { source: DataOccurrenceSource | undefined; selection: ContainedValuePreview | undefined } | undefined;
  const target = () => {
    const source = getSource();
    return source?.state === "source" && !getSelection?.()?.path.length && source.suggestions ? source.suggestions : local;
  };
  const active = () => opened ?? target();
  const currentFrame = () => !frame || frame.source === getSource() && frame.selection === getSelection?.();
  const guarded = (rows: readonly LocusMenuItem[], source: DataOccurrenceSource | undefined,
    selection: ContainedValuePreview | undefined): readonly LocusMenuItem[] => rows.map(row => ({ ...row,
      ...(row.onSelect ? { onSelect: () => {
        if (source === getSource() && selection === getSelection?.()) row.onSelect?.();
        else local.invalidate();
      } } : {}),
      ...(row.children ? { children: guarded(row.children, source, selection) } : {}),
    }));
  return {
    items: () => currentFrame() ? guarded(active().items(), getSource(), getSelection?.())
      : [{ id: "data-occurrence-changed", label: "This data changed. Open Suggestions again.", disabled: true }],
    pending: () => currentFrame() && active().pending(),
    issue: () => currentFrame() ? active().issue() : "This data changed. Open Suggestions again.",
    read: () => currentFrame() ? active().read() : undefined,
    open: () => {
      const next = target(); if (opened && opened !== next) opened.close(); opened = next;
      frame = { source: getSource(), selection: getSelection?.() }; next.open();
    },
    close: () => { opened?.close(); opened = undefined; frame = undefined; },
    invalidate: () => { opened?.invalidate(); if (opened !== local) local.invalidate(); },
    hold: () => {
      const owner = target();
      const captured = { source: getSource(), selection: getSelection?.() };
      opened = owner; frame = captured;
      const release = owner.hold();
      return () => { release(); if (opened === owner && frame === captured) { opened = undefined; frame = undefined; } };
    },
    warm: () => target().warm(),
    select: (suggestion, options) => { if (currentFrame()) active().select(suggestion, options); else local.invalidate(); },
    preview: (suggestion, args) => currentFrame() ? active().preview?.(suggestion, args) : undefined,
  };
}

type DataOccurrenceOutlet = { source: Accessor<DataOccurrenceSource | undefined>;
  occurrence: Accessor<DataOccurrenceSource | undefined>;
  open: (event: MouseEvent, selection: ContainedValuePreview) => void };
const DataOccurrenceContext = createContext<DataOccurrenceOutlet | null>(null);

/** Every new data root explicitly supplies its occurrence or is unavailable.
 * Descendants that retain the SAME occurrence share one nearest menu outlet.
 * An unavailable root never bubbles a context request into its parent's data. */
export function DataOccurrenceBoundary(props: {
  value: unknown;
  type?: FenelType;
  label?: string;
  caption?: string;
  occurrence?: DataOccurrenceSource;
  dataPath?: readonly (string | number)[];
  onDataContext?: (event: MouseEvent, data: ContainedValuePreview) => void;
  /** Share this same outlet with existing collection/card action controls. */
  onOutlet?: (open: (event: MouseEvent, data: ContainedValuePreview) => void) => void;
  /** A prepared body keeps its original source while its data lease changes. */
  current?: () => boolean;
  /** Reattach inert paint selections to that body's private source data. */
  mapSelection?: (data: ContainedValuePreview) => ContainedValuePreview | undefined;
  children?: JSX.Element;
}) {
  const inherited = useContext(DataOccurrenceContext);
  const [position, setPosition] = createSignal<{ x: number; y: number; opener?: Element }>();
  let selected: ContainedValuePreview | undefined;
  let selectedFrame: ReturnType<typeof frame> | undefined;
  let disposed = false;
  const frame = createMemo(() => ({ source: props.occurrence, value: props.value, type: props.type,
    label: props.label, caption: props.caption, path: props.dataPath, handler: props.onDataContext,
    current: props.current, mapSelection: props.mapSelection }));
  const allowed = createMemo(() => {
    try { const gate = frame().current; return gate ? gate() === true : true; }
    catch { return false; }
  });
  const current = (captured: ReturnType<typeof frame>) => {
    if (disposed) return false;
    // The source owns committed readiness and any immediate refusal fence.
    // Do not place its predicate under this boundary's latest read mode.
    try { return (!captured.current || captured.current() === true) && latest(frame) === captured; }
    catch { return false; }
  };
  const source = () => {
    if (disposed) return undefined;
    const captured = latest(frame);
    return current(captured) ? captured.source : undefined;
  };
  const suggestions = createDataOccurrenceSuggestions(() => {
    if (disposed || selectedFrame && selectedFrame !== latest(frame)) return undefined;
    return source();
  }, () => selected);
  onSettled(() => () => { disposed = true; suggestions.close(); });
  createEffect(() => ({ frame: frame(), current: allowed() }), (next, previous) => {
    if (previous?.frame === next.frame && previous.current === next.current) return;
    suggestions.close(); selected = undefined; selectedFrame = undefined; setPosition(undefined);
  });
  const refuse = (event: MouseEvent) => { event.preventDefault(); event.stopPropagation(); };
  function open(event: MouseEvent, selection: ContainedValuePreview, expected?: ReturnType<typeof frame>) {
    if (!ownsLocusContextMenu(event, true)) return;
    if (disposed) { refuse(event); return; }
    const captured = latest(frame);
    if (expected && captured !== expected || !current(captured)) { refuse(event); return; }
    if (captured.source && inherited?.occurrence() === captured.source && inherited.source() !== captured.source) {
      inherited.open(event, selection); return;
    }
    let mapped: ContainedValuePreview | undefined;
    try { mapped = captured.mapSelection ? captured.mapSelection(selection) : selection; }
    catch { refuse(event); return; }
    if (!mapped || latest(frame) !== captured || !current(captured)) { refuse(event); return; }
    selection = mapped;
    if (captured.source && inherited?.occurrence() === captured.source) { inherited.open(event, selection); return; }
    const modal = event.target instanceof Element && event.target.closest('.modal-overlay, dialog[open]');
    const delegate = captured.source?.state === "source"
      ? captured.source.openContext ?? (!modal ? captured.handler : undefined) : undefined;
    if (delegate) {
      try { delegate(event, selection); }
      finally { event.preventDefault(); event.stopPropagation(); }
      return;
    }
    event.preventDefault(); event.stopPropagation();
    selected = selection;
    selectedFrame = captured;
    suggestions.open();
    const opener = event.target instanceof Element
      ? event.target.closest<HTMLElement>("[data-corner-menu-trigger]") ?? event.target : undefined;
    setPosition({ ...locusContextPosition(event), opener });
  }
  function openRoot(event: MouseEvent) {
    if (disposed) { if (ownsLocusContextMenu(event, true)) refuse(event); return; }
    const captured = latest(frame);
    open(event, { value: captured.value, label: captured.label ?? "Data", caption: captured.caption,
      path: captured.path ?? [], getType: () => captured.type }, captured);
  }
  untrack(() => props.onOutlet?.(open));
  return <DataOccurrenceContext value={{ source, occurrence: () => disposed ? undefined : latest(frame).source, open }}>
    <span style="display: contents" onContextMenu={openRoot}>{props.children}</span>
    <Show when={position()} keyed>{at => <LocusContextMenu x={at.x} y={at.y} opener={at.opener} label="Data actions"
      items={[{ id: "data-suggestions", label: "Suggestions", icon: "lightbulb", children: suggestions.items() }]}
      onClose={() => { suggestions.close(); setPosition(undefined); }} />}</Show>
  </DataOccurrenceContext>;
}
