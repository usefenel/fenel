import { For, Match, Show, Switch, createContext, createEffect, createMemo, createSignal, createUniqueId, flush, onSettled, untrack, useContext, type Accessor } from "solid-js";
import { Portal, type JSX } from "@solidjs/web";
import { IconPencil, IconBolt, IconLink, IconVariable, IconBraces, IconCode, IconListDetails, IconGripVertical, IconPlus, IconAlertTriangle, IconX, IconPackage } from "~/lib/icons";
import { openModalDialog, closeModalDialog } from "../confirm-modal";
import { ValueCard } from "../value-card";
import { useValueHoverCard } from "../value-hover-preview";
import { ExpressionGraphValuePreview, type ExpressionGraphValue } from "./ExpressionEditor";
import { CornerMenu, CornerMenuButton, createCornerMenu } from "../corner-menu";
import type { LocusMenuItem } from "../locus-context-menu";
import type { DataInspectionSuggestions } from "../DataInspectionDialog";
import { captureDataOccurrence, type DataOccurrenceCapture, type DataOccurrenceSource, type DataReadOccurrence } from "../data-occurrence";
import type { ExprNode } from "@fenel/engine/authoring/expression";
import type { ContainedValuePreview } from "../data-transfer/DataValueSurface";
import { FieldLabelSurface } from "../field-renderer/field-label-surface";
import { StringInputSurface } from "../field-renderer/string-input-surface";
import { displayNameText, displayNameTooltipCode, type DisplayNameInput } from "../display-name";
import { DisplayNameText } from "../display-name-text";

type CallLayout = "compact" | "expanded" | "graph";
const CallLayoutContext = createContext<{ compact: () => boolean; layout: () => CallLayout; detailed: () => boolean; withinCall: boolean }>({ compact: () => false, layout: () => "expanded", detailed: () => false, withinCall: false });
export function useExpressionCallCompact() { return useContext(CallLayoutContext).compact; }
/** Authoring chooses the same mounted graph presentation used by inspection. */
export const ExpressionGraphAuthoringContext = createContext<() => boolean>(() => false);
/** Settings of the expression lens itself, owned by the outermost editor. */
export const ExpressionLensSettingsContext = createContext<{ foldDeep: () => boolean; setFoldDeep?: (fold: boolean) => void }>({ foldDeep: () => false });
export const ExpressionGraphCaptureContext = createContext<{ request?: () => void; activate?: (active: boolean, token: object, node?: ExprNode, allowed?: boolean) => void;
  available: () => boolean; pending: () => boolean; pendingLabel?: () => string | undefined }>({ available: () => false, pending: () => false });
/** An enclosing lexical expression remains the captured evaluation root. */
export const ExpressionGraphScopeCaptureContext = createContext<{ node: () => ExprNode | undefined; allowed: () => boolean }>({
  node: () => undefined, allowed: () => true,
});
// null (a value) outside an ExprFieldShell, where readers use `nodeChrome?.`: Solid 2
// throws on a read with no provider and no default.
const ExpressionChromeContext = createContext<{ element: () => HTMLElement | undefined; restore: () => void } | null>(null);
type GraphSlotPresentation = {
  suggestionOwner?: () => DataInspectionSuggestions | undefined;
  edgeLabel?: (inspect: () => void) => JSX.Element;
  slotPreview?: (unfold: () => void) => JSX.Element;
  sourceKind?: () => "data" | "computed";
  onInsertCall?: () => void;
  canInsertCall?: () => boolean;
  onNameResult?: () => void;
  canNameResult?: () => boolean;
  graphError?: () => string | undefined;
};
const GraphSlotContext = createContext<{ active: () => boolean; present?: (presentation: GraphSlotPresentation) => void }>({ active: () => false });
/** Scope surfaces reuse the live graph lens without owning another layout. */
export function useExpressionGraphPresentation() {
  const layout = useContext(CallLayoutContext);
  const slot = useContext(GraphSlotContext);
  const authoring = useContext(ExpressionGraphAuthoringContext);
  return () => !layout.detailed() && (layout.layout() === "graph" || slot.active() || authoring());
}
function suggestionsMenuItem(owner: DataInspectionSuggestions | undefined): LocusMenuItem | undefined {
  return owner ? { id: "suggestions", label: "Suggestions", icon: "lightbulb",
    children: owner.items().length ? owner.items() : [{ id: "suggestions-preparing", label: "Checking suggestions…", disabled: true }] } : undefined;
}
const EXPRESSION_REPLACE_ITEMS = new Set(["replace-expression", "replace"]);
/** One order for every expression node menu: how it is shown (the lens) first,
 *  then changes to the data, then replacing it, then deleting it. */
function expressionNodeMenu(parts: { lens: LocusMenuItem; edit?: LocusMenuItem | undefined; authoring: readonly LocusMenuItem[];
  inputs?: LocusMenuItem | undefined; convert?: LocusMenuItem | undefined; suggestions?: LocusMenuItem | undefined;
  settings?: { foldDeep: () => boolean; setFoldDeep?: (fold: boolean) => void } }): LocusMenuItem[] {
  const settings = parts.settings;
  const lens = settings?.setFoldDeep ? { ...parts.lens, children: [...parts.lens.children ?? [],
    { id: "fold-deep", label: "Fold deep nesting", separatorBefore: true, checked: settings.foldDeep(),
      tooltip: "Show expressions nested four levels deep or more as a short summary you can open",
      onSelect: () => settings.setFoldDeep?.(!settings.foldDeep()) }] } : parts.lens;
  const remove = parts.authoring.filter(item => item.id === "delete-expression");
  const replace = [...parts.authoring.filter(item => EXPRESSION_REPLACE_ITEMS.has(item.id)), ...(parts.convert ? [parts.convert] : []),
    ...(parts.suggestions ? [parts.suggestions] : [])];
  const edit = [...(parts.edit ? [parts.edit] : []),
    ...parts.authoring.filter(item => item.id !== "delete-expression" && !EXPRESSION_REPLACE_ITEMS.has(item.id)),
    ...(parts.inputs ? [parts.inputs] : [])];
  return [lens, ...[edit, replace, remove].flatMap(group => group.map((item, index) => index === 0 ? { ...item, separatorBefore: true } : item))];
}
const ExpressionInspectorContext = createContext<{
  open: () => void;
  graphChanged: (active: boolean) => void;
  graph: () => boolean;
  summary: () => boolean;
  requestVisual: () => void;
  layoutChoice: () => CallLayout | undefined;
  chooseLayout: (choice: CallLayout) => void;
  codeItem: () => LocusMenuItem;
  authoringItems: () => LocusMenuItem[];
  suggestionOwner: () => DataInspectionSuggestions | undefined;
  canInsertCall: () => boolean;
  onInsertCall: () => void;
  onNameResult: () => void;
  canNameResult: () => boolean;
} | null>(null); // null outside an ExprFieldShell (a value: an undefined default throws in Solid 2)
/** Opens the enclosing occurrence's own window (its editor, or its pending
 * insertion when one is set). Undefined outside an ExprFieldShell. */
export function useExpressionInspectorOpen(): (() => void) | undefined {
  return useContext(ExpressionInspectorContext)?.open;
}

/** `via`: bend points between start and end (a routed edge, such as the If's side lane). */
export type GraphEdgeGeometry = { path: string; x: number; y: number; startX: number; startY: number; endX: number; endY: number; leader?: string; annotationWidth?: number;
  via?: readonly { x: number; y: number }[] };
type GraphArgument = {
  row: HTMLElement; source: HTMLElement; input: HTMLElement; active: () => boolean;
  id: string; color: () => string; label: () => JSX.Element;
  annotated: () => boolean;
  ordinal: () => number;
  name: () => DisplayNameInput;
  menuItems: () => readonly LocusMenuItem[];
  canInsertCall: () => boolean;
  onInsertCall: () => void;
  graphError: () => string | undefined;
  inspect: () => void;
  openMenu: (event: MouseEvent) => void;
  annotation?: HTMLElement;
  geometry: () => GraphEdgeGeometry | undefined;
  position: (geometry: GraphEdgeGeometry) => void;
  settlePlacement: () => void;
};
type GraphContainedEdge = {
  source: HTMLElement; input: HTMLElement; active: () => boolean;
  id: string; color: () => string;
  geometry: () => GraphEdgeGeometry | undefined;
  position: (geometry: GraphEdgeGeometry) => void;
};
const CallGraphContext = createContext<{
  active: () => boolean;
  single: () => boolean;
  sources: () => HTMLElement | undefined;
  register: (argument: GraphArgument) => () => void;
  registerContained: (edge: GraphContainedEdge) => () => void;
  registerRefresh: (refresh: () => void) => () => void;
  registerReset: (reset: () => void) => () => void;
  registerPlacementCheck: (check: () => void) => () => void;
  registerSettler: (settle: () => void) => () => void;
  settleLayout: () => void;
  refresh: () => void;
  settlePlacements: (except: string) => void;
  trace: (id: string, active: boolean, extend?: boolean, focused?: boolean) => void;
} | null>(null);

type GraphCollectionItem = {
  id: string; input: HTMLButtonElement;
  data: () => ContainedValuePreview;
  caption: () => string | undefined;
  occurrence: () => DataOccurrenceSource | undefined;
  render: (data?: ExpressionGraphValue, onOpenData?: (child: ContainedValuePreview) => void, occurrence?: DataReadOccurrence) => JSX.Element;
  expanded: () => boolean;
};
const GraphCollectionContext = createContext<{
  active: () => boolean;
  register: (item: GraphCollectionItem) => () => void;
} | null>(null);

/** The graph's ordinary collection card keeps its item data and read body.
 * Opening a contained item only adds mounted presentation and a measured edge. */
export function ExpressionGraphCollectionSurface(props: { children: JSX.Element }) {
  const graph = useContext(CallGraphContext);
  const hoverCard = useValueHoverCard();
  const [items, setItems] = createSignal<GraphCollectionItem[]>([]);
  let alive = true;
  onSettled(() => () => { alive = false; });
  const active = () => !!graph?.active() && !hoverCard();
  return <GraphCollectionContext value={{ active, register: item => {
    setItems(previous => [...previous, item]);
    return () => queueMicrotask(() => { if (alive) setItems(previous => previous.filter(current => current !== item)); });
  } }}><div class="expr-graph-collection">
    <Show when={active() && items().some(item => item.expanded())}>
      <div class="expr-graph-collection__sources" aria-label="Expanded list items">
        <For each={items().filter(item => item.expanded())}>{item =>
          <ExpressionGraphContainedNode item={item} />
        }</For>
      </div>
    </Show>
    <div class="expr-graph-collection__body">{props.children}</div>
  </div></GraphCollectionContext>;
}

/** A graph-only port above the existing collection preview. Contextual labels
 * identify the item path; the optional data name remains a separate fact. */
export function ExpressionGraphCollectionItemControl(props: {
  data: ContainedValuePreview;
  source?: unknown;
  caption?: string;
  occurrence?: DataReadOccurrence;
  render: (data?: ExpressionGraphValue, onOpenData?: (child: ContainedValuePreview) => void, occurrence?: DataReadOccurrence) => JSX.Element;
}) {
  const collection = useContext(GraphCollectionContext);
  const graph = useContext(CallGraphContext);
  const hoverCard = useValueHoverCard();
  const [expanded, setExpanded] = createSignal(false);
  const id = `expression-graph-item-${createUniqueId()}`;
  let input: HTMLButtonElement | undefined;
  const occurrence: Accessor<DataOccurrenceSource | undefined> = createMemo<DataOccurrenceSource | undefined>((): DataOccurrenceSource | undefined => {
    const origin = props.occurrence;
    if (!origin || origin.source.state === "unavailable") return origin?.source;
    const data = props.data;
    const selection: ContainedValuePreview = { ...data, path: origin.path };
    const openContext = origin.source.openContext;
    const source: DataOccurrenceSource = { state: "source", capture: (): DataOccurrenceCapture => {
      const captured = captureDataOccurrence(origin.source, selection);
      return { ...captured, current: (): boolean => occurrence() === source && captured.current() };
    }, openContext: openContext ? (event, nested) => {
      if (occurrence() !== source) { event.preventDefault(); event.stopPropagation(); return; }
      openContext(event, { ...nested, path: [...selection.path, ...nested.path] });
    } : undefined };
    return source;
  });
  createEffect(() => ({ source: props.source, value: props.data.value }), (current, previous) => {
    if (previous && (current.source !== previous.source || current.value !== previous.value)) setExpanded(false);
  });
  onSettled(() => {
    if (!collection || !input || hoverCard()) return;
    return collection.register({ id, input, data: () => props.data,
      caption: () => displayNameText(props.caption ?? props.data.caption), occurrence,
      render: (data, onOpenData, selected) => props.render(data, onOpenData, selected), expanded });
  });
  // A47 (Nov 13, Rom): no dot over an item at rest. In an active graph a click
  // (or Enter/Space) on the item's own circle expands it: its node and arrow
  // appear and then its dot; the circle again, or the dot, collapses it.
  const graphItem = () => !!collection?.active() && !hoverCard();
  const toggle = () => { setExpanded(value => !value); graph?.refresh(); };
  onSettled(() => {
    const item = input?.parentElement;
    if (!collection || !item) return;
    const onItemClick = (event: MouseEvent) => {
      if (!graphItem()) return;
      const cell = event.target instanceof Element ? event.target.closest(".locus-previews__cell") : null;
      if (!cell || !item.contains(cell) || cell.closest(".locus-previews__item") !== item) return;
      event.preventDefault(); event.stopPropagation(); toggle();
    };
    // The circle is focusable but not a native button: Enter and Space on it
    // toggle the same way (the hover card's own Enter would open the item).
    const onItemKey = (event: KeyboardEvent) => {
      if (!graphItem() || (event.key !== "Enter" && event.key !== " ")) return;
      const cell = event.target instanceof Element && event.target.matches(".locus-previews__cell") ? event.target : null;
      if (!cell || cell.closest(".locus-previews__item") !== item) return;
      event.preventDefault(); event.stopPropagation(); toggle();
    };
    item.addEventListener("click", onItemClick, true);
    item.addEventListener("keydown", onItemKey, true);
    return () => { item.removeEventListener("click", onItemClick, true); item.removeEventListener("keydown", onItemKey, true); };
  });
  createEffect(() => ({ shown: graphItem(), open: expanded() }), state => {
    const cell = input?.parentElement?.querySelector<HTMLElement>(":scope > .locus-previews__cell");
    if (!cell) return;
    if (state.shown) cell.setAttribute("aria-expanded", state.open ? "true" : "false");
    else cell.removeAttribute("aria-expanded");
  });
  return collection ? <button type="button" ref={input} hidden={!collection.active() || hoverCard() || !expanded()}
    class={["expr-call__input-dot", "expr-graph-collection__item-dot", { "expr-call__input-dot--connected": expanded() }]}
    aria-label={`${expanded() ? "Collapse" : "Expand"} ${props.data.label}`}
    aria-pressed={expanded() ? "true" : "false"}
    data-tooltip={`${expanded() ? "Collapse" : "Expand"} ${props.data.label}`}
    onPointerEnter={event => aimItemHint(event.currentTarget)} onFocus={event => aimItemHint(event.currentTarget)}
    onClick={event => { event.stopPropagation(); toggle(); }}>
    <span class="expr-call__input-dot-core" aria-hidden="true" />
    <Show when={!expanded()}><svg class="expr-call__input-dot-hint" viewBox="0 0 28 28" aria-hidden="true">
      <path d="M 4 25 L 15.9 9.9 L 13.1 7.1 L 27 2.4 L 22.9 16.9 L 20.1 14.1 L 4.8 25.8 Z" />
    </svg></Show>
  </button> : null;
}

/** A collapsed input's hint arrow points where its node unfolds: fanned by
 * the input's place among its siblings (up to 50 degrees either side of
 * vertical), straight up for a single input. The drawn arrow points 45 degrees
 * to the right, hence the offset. */
export function inputHintTurn(index: number, count: number): number {
  const half = (count - 1) / 2;
  return Math.round(((index - half) / Math.max(1, half)) * 50 - 45);
}

function aimItemHint(dot: HTMLElement) {
  const dots = [...dot.closest(".locus-previews")?.querySelectorAll<HTMLElement>(".expr-graph-collection__item-dot") ?? []]
    .filter(candidate => !candidate.hidden);
  const index = Math.max(0, dots.indexOf(dot));
  dot.style.setProperty("--expr-input-hint-turn", `${inputHintTurn(index, Math.max(1, dots.length))}deg`);
}

function ExpressionGraphContainedNode(props: { item: GraphCollectionItem }) {
  const graph = useContext(CallGraphContext);
  const [geometry, position] = createSignal<GraphEdgeGeometry>();
  let source: HTMLDivElement | undefined;
  onSettled(() => {
    if (!source || !graph) return;
    return graph.registerContained({ source, input: props.item.input, id: props.item.id,
      active: () => props.item.expanded() && graph.active(), color: () => "var(--expr-graph-slot-0)", geometry, position });
  });
  return <div class="expr-graph-collection__item-node" ref={source} data-expression-graph-movable="contained">
    <ExpressionGraphMoveHandle active={!!graph?.active()} label={`Move ${props.item.data().label} node`}
      element={() => source} anchor={() => graphDataCard(source)} />
    <ExpressionGraphValuePreview data={{ value: props.item.data().value, type: props.item.data().getType(),
      caption: props.item.caption(), typeLabel: props.item.data().typeLabel, typeIcon: props.item.data().typeIcon }}
      occurrence={props.item.occurrence()}
      presentation="full" body={(_compact, onOpenData, data, _detail, occurrence) => props.item.render(data, onOpenData, occurrence)} />
  </div>;
}

function graphDataCard(source: HTMLElement | undefined): HTMLElement | undefined {
  if (!source) return undefined;
  const node = source.querySelector<HTMLElement>(":scope > .expr-node, :scope > [data-expression-inspection] > .expr-node, :scope > .fenel-transfer-target > .expr-node");
  const scope = node?.querySelector<HTMLElement>('[data-expression-scope="true"]');
  if (scope?.closest(".expr-node") === node) return scope;
  return node?.querySelector<HTMLElement>(":scope > .expr-graph-collection > .expr-graph-collection__body > .expr-graph-data-card, :scope > .expr-graph-data-card")
    ?? source.querySelector<HTMLElement>(":scope > .expr-call-graph__data-card-host > .expr-graph-collection > .expr-graph-collection__body > .home-item, :scope > .expr-graph-collection > .expr-graph-collection__body > .home-item")
    ?? undefined;
}

/** Mounted graph coordinates are host presentation only. CSS translate stays
 * separate from the existing Inline/Node transform animations and ExprNode. */
function ExpressionGraphMoveHandle(props: {
  active: boolean;
  label: string;
  element: () => HTMLElement | undefined;
  anchor?: () => HTMLElement | undefined;
  position?: { x: number; y: number };
}) {
  const graph = useContext(CallGraphContext);
  const element = untrack(() => props.element);
  const anchor = untrack(() => props.anchor);
  // Host callbacks read an owned memo: a lazy prop getter must resolve in a
  // normal computation, rather than first creating its memo in onSettled.
  const active = createMemo(() => props.active);
  const [dragging, setDragging] = createSignal(false);
  const offset = untrack(() => props.position ?? { x: 0, y: 0 });
  let paintedOffset = offset;
  let cancelGesture: ((disposing?: boolean) => void) | undefined;
  let disposed = false;
  let grip: HTMLButtonElement | undefined;
  let touchSurface: HTMLElement | undefined;
  let suppressTouchClick = false;
  function placeGrip() {
    if (!grip || !anchor) return;
    const card = anchor();
    const parent = grip.offsetParent;
    if (!card || !(parent instanceof HTMLElement) || !card.getClientRects().length) return;
    const bounds = card.getBoundingClientRect(), origin = parent.getBoundingClientRect();
    for (const [property, value] of [["--expr-grip-x", `${bounds.left - origin.left}px`],
      ["--expr-grip-y", `${bounds.top + bounds.height / 2 - origin.top}px`]]) {
      if (grip.style.getPropertyValue(property) !== value) grip.style.setProperty(property, value);
    }
  }
  function paint(next = offset) {
    const target = element();
    if (!target) return;
    const translate = active() && (next.x || next.y) ? `${next.x}px ${next.y}px` : "";
    if (target.style.translate !== translate) target.style.translate = translate;
    paintedOffset = active() ? { ...next } : { x: 0, y: 0 };
    graph?.refresh();
  }
  function reachable(next: { x: number; y: number }) {
    const target = element();
    const stage = target?.closest<HTMLElement>(".expr-call-graph--root")
      ?.querySelector<HTMLElement>(":scope > .expr-call-graph__stage");
    if (!target || !stage || !target.getClientRects().length || !stage.getClientRects().length) return next;
    const bounds = target.getBoundingClientRect();
    const canvas = stage.getBoundingClientRect();
    // Transforms do not extend negative scroll overflow. Keep every grip
    // reachable at the top/left while allowing positive scrollable movement.
    return { x: Math.max(next.x, paintedOffset.x - bounds.left + canvas.left + 12),
      y: Math.max(next.y, paintedOffset.y - bounds.top + canvas.top + 12) };
  }
  function reset() {
    cancelGesture?.();
    offset.x = 0; offset.y = 0;
    paint();
  }
  function revalidate() {
    placeGrip();
    if (disposed || cancelGesture || !active() || !(offset.x || offset.y)) return;
    for (let target = element(); target; target = target.parentElement ?? undefined) {
      if (target.getAnimations().some(animation => animation.playState === "running")) return;
      if (target.matches(".expr-call-graph--root")) break;
    }
    const next = reachable(offset);
    if (Math.abs(next.x - offset.x) < 0.1 && Math.abs(next.y - offset.y) < 0.1) return;
    offset.x = next.x; offset.y = next.y;
    paint();
  }
  createEffect(active, enabled => {
    if (!enabled) cancelGesture?.();
    touchSurface?.toggleAttribute("data-expression-graph-touch-movable", enabled);
    paint();
  });
  onSettled(() => {
    paint();
    placeGrip();
    touchSurface = grip?.parentElement ?? undefined;
    touchSurface?.toggleAttribute("data-expression-graph-touch-movable", active());
    const touch = (event: PointerEvent) => {
      if (event.pointerType !== "touch" || event.defaultPrevented) return;
      suppressTouchClick = false;
      const source = event.target instanceof Element ? event.target : undefined;
      if (source?.closest("[data-expression-graph-movable]") !== element()) return;
      const control = source?.closest("button, a, input, textarea, select, [contenteditable], [role='button']");
      if (control && !control.matches(".expr-function-node__title-button, .home-item__caption--link, .value-hover-preview")) return;
      gesture(event, true);
    };
    const click = (event: MouseEvent) => {
      if (!suppressTouchClick) return;
      suppressTouchClick = false;
      event.preventDefault(); event.stopImmediatePropagation();
    };
    touchSurface?.addEventListener("pointerdown", touch, true);
    touchSurface?.addEventListener("click", click, true);
    const unregister = graph?.registerReset(reset);
    const unregisterPlacement = graph?.registerPlacementCheck(revalidate);
    return () => {
      disposed = true; cancelGesture?.(true); unregister?.(); unregisterPlacement?.();
      touchSurface?.removeEventListener("pointerdown", touch, true);
      touchSurface?.removeEventListener("click", click, true);
      touchSurface?.removeAttribute("data-expression-graph-touch-movable");
      element()?.style.removeProperty("translate");
    };
  });
  function gesture(event: PointerEvent, fromTouchSurface = false) {
    if (!active() || disposed || event.button !== 0 || !event.isPrimary) return;
    cancelGesture?.();
    graph?.settleLayout();
    if (!active()) return;
    const capture = event.currentTarget as HTMLElement;
    if (!fromTouchSurface) {
      event.preventDefault(); event.stopPropagation();
      capture.focus({ preventScroll: true });
    }
    const pointerId = event.pointerId;
    const origin = { x: offset.x, y: offset.y, px: event.clientX, py: event.clientY };
    let moved = !fromTouchSurface;
    if (moved) setDragging(true);
    const position = (sample: PointerEvent) => reachable({ x: origin.x + sample.clientX - origin.px,
      y: origin.y + sample.clientY - origin.py });
    const crossedThreshold = (sample: PointerEvent) => Math.hypot(sample.clientX - origin.px, sample.clientY - origin.py) >= 6;
    const move = (sample: PointerEvent) => {
      if (sample.pointerId !== pointerId || !moved && !crossedThreshold(sample)) return;
      if (!moved) {
        moved = true; suppressTouchClick = true; setDragging(true);
        try { capture.setPointerCapture(pointerId); } catch { /* Window listeners still own cleanup. */ }
      }
      sample.preventDefault(); paint(position(sample));
    };
    const cleanup = (disposing = false) => {
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", end);
      window.removeEventListener("pointercancel", cancel);
      window.removeEventListener("blur", blur);
      window.removeEventListener("keydown", escape);
      capture.removeEventListener("lostpointercapture", lost);
      cancelGesture = undefined;
      if (capture.hasPointerCapture(pointerId)) capture.releasePointerCapture(pointerId);
      if (!disposing) setDragging(false);
    };
    const rollback = (disposing = false) => { cleanup(disposing); if (!disposing) paint(); };
    const blur = () => rollback();
    const cancel = (sample: PointerEvent) => { if (sample.pointerId === pointerId) rollback(); };
    const lost = (sample: PointerEvent) => { if (sample.pointerId === pointerId && sample.target === capture) rollback(); };
    const escape = (key: KeyboardEvent) => { if (key.key === "Escape") { key.preventDefault(); key.stopPropagation(); rollback(); } };
    const end = (sample: PointerEvent) => {
      if (sample.pointerId !== pointerId) return;
      // Use the actual pointer-up sample, not a queued Solid draft read.
      if (fromTouchSurface && !moved && !crossedThreshold(sample)) { cleanup(); return; }
      if (fromTouchSurface) suppressTouchClick = true;
      const next = position(sample);
      cleanup(); offset.x = next.x; offset.y = next.y; paint();
    };
    cancelGesture = rollback;
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", end);
    window.addEventListener("pointercancel", cancel);
    window.addEventListener("blur", blur);
    window.addEventListener("keydown", escape);
    capture.addEventListener("lostpointercapture", lost);
    // Synthetic fixture events have no live native pointer to capture.
    if (!fromTouchSurface) try { capture.setPointerCapture(pointerId); } catch { /* Window listeners still own cleanup. */ }
  }
  return <button type="button" class="expr-graph-node__grip" hidden={!active()} ref={grip}
    aria-label={props.label} aria-description="Arrow keys move this node; Shift moves farther; Home resets its position."
    data-graph-dragging={dragging() ? "true" : undefined}
    onPointerDown={gesture} onClick={event => event.stopPropagation()} onKeyDown={event => {
      if (!active() || disposed) return;
      if (event.key === "Home") { event.preventDefault(); event.stopPropagation(); reset(); return; }
      const step = event.shiftKey ? 40 : 10;
      const dx = event.key === "ArrowLeft" ? -step : event.key === "ArrowRight" ? step : 0;
      const dy = event.key === "ArrowUp" ? -step : event.key === "ArrowDown" ? step : 0;
      if (!dx && !dy) return;
      event.preventDefault(); event.stopPropagation(); cancelGesture?.(); graph?.settleLayout();
      if (!active()) return;
      const next = reachable({ x: offset.x + dx, y: offset.y + dy });
      offset.x = next.x; offset.y = next.y; paint();
    }}><span aria-hidden="true"><IconGripVertical size={15} /></span></button>;
}

// Canonical expression presentation, extracted from the recursive editor.
// Semantic owners supply labels, traces, node content and admitted actions;
// these frames need no registry, authoring session, evaluator or codec.
export type StructuralMode = "do" | "eval" | "match" | "record" | "lambda" | "type"
  | "list" | "lookup" | "apply" | "scope" | "pipeline" | "operation" | "template";
export type Mode = "inline" | "use" | "call" | "ref" | "param" | StructuralMode | "code";

export function modeLabel(mode: Mode): string {
  if (mode === "inline") return "inline";
  if (mode === "use") return "use";
  if (mode === "call") return "call";
  if (mode === "ref") return "ref";
  if (mode === "param") return "param";
  if (mode === "do") return "do";
  if (mode === "eval") return "eval";
  if (mode === "match") return "match";
  if (mode === "record") return "{ }";
  if (mode === "lambda") return "Function";
  if (mode === "type") return "type";
  if (mode === "lookup") return "lookup";
  if (mode === "apply") return "apply";
  if (mode === "scope") return "with instance";
  if (mode === "pipeline") return "pipeline";
  if (mode === "operation") return "operation";
  if (mode === "list") return "list";
  if (mode === "template") return "template";
  return "code";
}

export function isStructuralMode(mode: Mode): mode is StructuralMode {
  return mode === "do"
    || mode === "eval"
    || mode === "match"
    || mode === "record"
    || mode === "lambda"
    || mode === "type"
    || mode === "list" || mode === "lookup" || mode === "apply"
    || mode === "scope" || mode === "pipeline" || mode === "operation" || mode === "template";
}

export function isUseMode(mode: Mode): boolean {
  return mode === "use" || mode === "call" || mode === "ref" || mode === "param";
}

export function ModeIcon(props: { mode: Mode; size?: number }) {
  return (
    <Switch>
      <Match when={props.mode === "inline"}><IconPencil size={props.size ?? 13} /></Match>
      <Match when={props.mode === "use"}><IconLink size={props.size ?? 13} /></Match>
      <Match when={props.mode === "call"}><IconBolt size={props.size ?? 13} /></Match>
      <Match when={props.mode === "ref"}><IconLink size={props.size ?? 13} /></Match>
      <Match when={props.mode === "param"}><IconVariable size={props.size ?? 13} /></Match>
      <Match when={props.mode === "do"}><IconBraces size={props.size ?? 13} /></Match>
      <Match when={props.mode === "eval"}><IconBolt size={props.size ?? 13} /></Match>
      <Match when={props.mode === "match"}><IconVariable size={props.size ?? 13} /></Match>
      <Match when={props.mode === "record"}><IconListDetails size={props.size ?? 13} /></Match>
      <Match when={props.mode === "lambda"}><IconVariable size={props.size ?? 13} /></Match>
      <Match when={props.mode === "type"}><IconBraces size={props.size ?? 13} /></Match>
      <Match when={props.mode === "code"}><IconCode size={props.size ?? 13} /></Match>
    </Switch>
  );
}

export interface ExpressionModeProps {
  mode: Mode;
  switchTo?: (mode: Mode) => void;
  readonly?: boolean;
  savedReferencesAvailable?: boolean;
  paramAvailable?: boolean;
  unifiedUse?: boolean;
  expressionForms?: boolean;
  inlineAvailable?: boolean;
}

/** The creation/use control; presentation lenses live in the shared menu. */
export function ModeToggle(props: ExpressionModeProps) {
  const [open, setOpen] = createSignal(false);
  const disabled = () => !!props.readonly || !props.switchTo;
  const selectedMode = createMemo<Mode>(() =>
    props.mode === "code" ? "use" : props.unifiedUse && isUseMode(props.mode) ? "use" : props.mode,
  );
  const visualModes = createMemo<Mode[]>(() => {
    const modes: Mode[] = props.inlineAvailable === false ? [] : ["inline"];
    modes.push(props.unifiedUse ? "use" : "call");
    if (!props.unifiedUse) {
      if (props.savedReferencesAvailable) modes.push("ref");
      if (props.paramAvailable) modes.push("param");
    }
    if (props.expressionForms) modes.push("lambda", "type", "do", "eval", "match", "record",
      "list", "template", "lookup", "apply", "pipeline", "scope", "operation");
    return modes;
  });
  const alternatives = createMemo(() => visualModes().filter((mode) => mode !== selectedMode()));
  createEffect(
    () => props.mode === "code" || disabled(),
    (close) => {
      if (close) setOpen(false);
    },
  );
  function choose(mode: Mode) {
    if (disabled()) return;
    setOpen(false);
    props.switchTo?.(mode);
  }
  return (
    <div class="expr-mode-toolbar">
            <div class="expr-mode-select">
              <button
                type="button"
                class="expr-mode-select__current"
                data-tooltip="Change visual editing mode"
                disabled={disabled()}
                onClick={() => { if (!disabled()) setOpen(!open()); }}
              >
                <ModeIcon mode={selectedMode()} />
                {modeLabel(selectedMode())}
                <span class="expr-mode-select__chevron">▾</span>
              </button>
              <Show when={open()}>
                <div class="expr-mode-select__menu">
                  <For each={alternatives()}>
                    {(mode) => (
                      <button
                        type="button"
                        class="expr-mode-select__option"
                        data-tooltip={`Switch to ${modeLabel(mode)}`}
                        disabled={disabled()}
                        onClick={() => choose(mode)}
                      >
                        <ModeIcon mode={mode} />
                        {modeLabel(mode)}
                      </button>
                    )}
                  </For>
                </div>
              </Show>
            </div>
    </div>
  );
}

/** One label → mode toggle → body frame for every expression slot. */
export function ExprFieldShell(props: ExpressionModeProps & {
  label?: JSX.Element;
  hideLabel?: boolean;
  contentClass?: string;
  nodeKind?: "literal" | "call" | "ref" | "param";
  graphHeading?: JSX.Element;
  graphUnnamed?: boolean;
  graphSourceKind?: "data" | "computed";
  graphBody?: JSX.Element;
  graphEdgeLabel?: GraphSlotPresentation["edgeLabel"];
  graphSlotPreview?: GraphSlotPresentation["slotPreview"];
  graphError?: string;
  inspectorLabel?: DisplayNameInput;
  graphEligible?: boolean;
  empty?: boolean;
  onReplace?: () => void;
  onAddFunction?: () => void;
  onInsertCall?: () => void;
  onInsertBefore?: () => void;
  onInsertAfter?: () => void;
  /** Swap this step with the step before it (the call feeding its first input). */
  onMoveUp?: () => void;
  /** Swap this step with the step after it (the call it feeds as first input). */
  onMoveDown?: () => void;
  onNameResult?: () => void;
  canNameResult?: boolean;
  onAddBinding?: () => void;
  onRemove?: () => void;
  suggestionOwner?: DataInspectionSuggestions;
  /** An insertion pending in this occurrence's dialog: the dialog shows this
   * content while the editor stays in place and previews the insertion. */
  pendingInsert?: () => JSX.Element;
  onPendingInsertClose?: () => void;
  children: JSX.Element;
}) {
  const layout = useContext(CallLayoutContext);
  const slot = useContext(GraphSlotContext);
  const graphAuthoring = useContext(ExpressionGraphAuthoringContext);
  const [surfaceGraph, setSurfaceGraph] = createSignal(false);
  const [inspecting, setInspecting] = createSignal(false);
  const parentDialog = useContext(ExpressionDialogContext);
  // A dialog opened for a pending insertion keeps that role until it closes,
  // so confirming never relocates the editor into it for one frame.
  const [insertWindow, setInsertWindow] = createSignal(false);
  const editorInDialog = () => inspecting() && !insertWindow() && !props.pendingInsert;
  const [editorRequested, setEditorRequested] = createSignal(false);
  const [callLayoutChoice, setCallLayoutChoice] = createSignal<CallLayout | undefined>();
  const menu = createCornerMenu();
  createEffect(() => menu.isOpen() ? props.suggestionOwner : undefined,
    owner => owner?.hold());
  const graph = () => !layout.detailed() && props.graphEligible !== false
    && (slot.active() || surfaceGraph() || graphAuthoring());
  const preview = () => graph() && (props.nodeKind !== "call" || slot.active() && layout.layout() !== "graph");
  let editor: HTMLDivElement | undefined;
  let editorMount: HTMLDivElement | undefined;
  let dialogMount: HTMLDivElement | undefined;
  let chrome: HTMLDivElement | undefined;
  let content: HTMLDivElement | undefined;
  function restoreChrome() {
    if (editor && chrome && content && chrome.parentElement !== editor) editor.insertBefore(chrome, content);
  }
  function relocateEditor(inspect = untrack(editorInDialog)) {
    const destination = inspect ? dialogMount : editorMount;
    if (editor && destination && editor.parentElement !== destination) destination.appendChild(editor);
  }
  function closeInspector() {
    // Restore the same controls before the dialog's owned mount is removed.
    if (editor && editorMount) editorMount.appendChild(editor);
    if (untrack(insertWindow) || untrack(() => !!props.pendingInsert)) props.onPendingInsertClose?.();
    setInsertWindow(false);
    setInspecting(false);
    onSettled(() => {
      const buttons = editorMount?.parentElement?.querySelectorAll<HTMLButtonElement>(".corner-menu-button");
      [...buttons ?? []].findLast(button => button.getClientRects().length > 0)?.focus({ preventScroll: true });
    });
  }
  function requestVisual() { if (props.mode === "code") props.switchTo?.("code"); }
  function editWith(action?: () => void) {
    requestVisual();
    action?.();
    setInspecting(true);
  }
  const authoringItems = (): LocusMenuItem[] => props.readonly || !graphAuthoring() ? [] : [
    ...(props.onReplace ? [{ id: props.empty ? "add-expression" : "replace-expression",
      label: props.empty ? "Add data or a function" : "Replace expression", icon: "refresh-cw",
      tooltip: props.empty ? undefined : "Choose other data or another function for this place",
      onSelect: () => editWith(props.onReplace) }] : []),
    ...(props.onAddFunction && !props.empty ? [{ id: "add-function", label: "Add function", icon: "plus",
      tooltip: "Pass this expression to a function", onSelect: () => editWith(props.onAddFunction) }] : []),
    ...((props.onInsertBefore || props.onInsertAfter) && !props.empty ? [{ id: "insert-call", label: "Insert call", icon: "plus", children: [
      ...(props.onInsertBefore ? [{ id: "insert-call-before", label: "Before", icon: "arrow-up",
        tooltip: "Pass the first input through another function", onSelect: () => editWith(props.onInsertBefore) }] : []),
      ...(props.onInsertAfter ? [{ id: "insert-call-after", label: "After", icon: "arrow-down",
        tooltip: "Pass this call's output through another function", onSelect: () => editWith(props.onInsertAfter) }] : []),
    ] }] : []),
    ...(props.onMoveUp && !props.empty ? [{ id: "move-up", label: "Move up", icon: "arrow-up",
      tooltip: "Swap this step with the step before it", onSelect: () => props.onMoveUp?.() }] : []),
    ...(props.onMoveDown && !props.empty ? [{ id: "move-down", label: "Move down", icon: "arrow-down",
      tooltip: "Swap this step with the step after it", onSelect: () => props.onMoveDown?.() }] : []),
    ...(props.onNameResult && props.canNameResult !== false && !props.empty ? [{ id: "name-result", label: "Name result for following steps…", icon: "tag",
      tooltip: "Give this result a local name for the following expression", onSelect: () => props.onNameResult?.() }] : []),
    ...(props.onAddBinding ? [{ id: "add-local-binding", label: "Add local binding", icon: "plus",
      onSelect: () => props.onAddBinding?.() }] : []),
    ...(props.onRemove && !props.empty ? [{ id: "delete-expression", label: props.nodeKind === "call" ? "Delete call" : "Delete expression", icon: "trash", danger: true,
      onSelect: () => { props.onRemove?.(); if (inspecting()) closeInspector(); } }] : []),
  ];
  function chooseLayout(choice: CallLayout) {
    requestVisual();
    setCallLayoutChoice(choice);
    if (inspecting()) closeInspector();
  }
  const codeItem = (): LocusMenuItem => ({ id: "code", label: "Code", icon: "code", checked: props.mode === "code",
    disabled: !props.switchTo, tooltip: props.switchTo ? "Show Fenel code" : "Preparing Fenel code…",
    onSelect: () => {
      if (!props.switchTo) return;
      if (graph() || layout.compact()) setInspecting(true);
      if (props.mode !== "code") props.switchTo("code");
    } });
  const lensSettings = useContext(ExpressionLensSettingsContext);
  const menuItems = (): LocusMenuItem[] => expressionNodeMenu({
    settings: lensSettings,
    lens: { id: "lens", label: "Lens", icon: "panels-top-left", children: [
      ...(props.nodeKind === "call" ? (["compact", "expanded", "graph"] as const).map(choice => ({
        id: choice, label: choice === "compact" ? "Compact" : choice === "expanded" ? "Expanded" : "Graph",
        checked: props.mode !== "code" && (callLayoutChoice() ?? (layout.withinCall ? layout.layout() : "graph")) === choice,
        onSelect: () => chooseLayout(choice),
      })) : [{ id: "expression", label: "Expression", icon: "route", checked: props.mode !== "code", onSelect: requestVisual }]),
      codeItem(),
    ] },
    edit: { id: "inspect", label: props.readonly ? "Inspect" : "Edit", icon: "pencil", onSelect: () => setInspecting(true) },
    authoring: authoringItems(),
    suggestions: suggestionsMenuItem(props.suggestionOwner),
  });
  createEffect(editorInDialog, relocateEditor);
  createEffect(editorInDialog, active => { if (active) setEditorRequested(true); });
  createEffect(() => ({ inspecting: inspecting(), pending: !!props.pendingInsert }), ({ inspecting, pending }) => {
    if (inspecting && pending) {
      setInsertWindow(true);
      // Keep the pending insertion in sight beside its window.
      requestAnimationFrame(() => editor?.querySelector(".expr-call--pending")?.scrollIntoView({ block: "center", inline: "nearest" }));
    }
    // Confirmed (or abandoned) by the editor: its insert window closes.
    else if (inspecting && !pending && untrack(insertWindow)) { setInsertWindow(false); setInspecting(false); }
  });
  onSettled(() => {
    slot.present?.({ sourceKind: () => props.graphSourceKind ?? (props.nodeKind === "call" ? "computed" : "data"),
      suggestionOwner: () => props.suggestionOwner,
      edgeLabel: inspect => props.graphEdgeLabel?.(inspect), slotPreview: unfold => props.graphSlotPreview?.(unfold),
      canInsertCall: () => !props.readonly && graphAuthoring() && !props.empty && !!props.onInsertCall,
      onInsertCall: () => { if (!props.readonly && graphAuthoring()) editWith(props.onInsertCall); }, graphError: () => props.graphError,
      canNameResult: () => !props.readonly && graphAuthoring() && !props.empty && !!props.onNameResult && props.canNameResult !== false,
      onNameResult: () => { if (!props.readonly && graphAuthoring() && props.canNameResult !== false) props.onNameResult?.(); } });
    relocateEditor();
    return () => editor?.remove();
  });
  return (
    <ExpressionInspectorContext value={{ open: () => setInspecting(true),
      graphChanged: active => { if (!editorInDialog() && !layout.detailed()) setSurfaceGraph(active); },
      graph: () => slot.active() || surfaceGraph() || graphAuthoring(), summary: () => graph() && !editorInDialog(),
      requestVisual, layoutChoice: callLayoutChoice, chooseLayout, codeItem, authoringItems,
      suggestionOwner: () => props.suggestionOwner,
      canInsertCall: () => !props.readonly && graphAuthoring() && !props.empty && !!(props.onInsertAfter ?? props.onInsertCall),
      onInsertCall: () => { if (!props.readonly && graphAuthoring()) editWith(props.onInsertAfter ?? props.onInsertCall); },
      canNameResult: () => !props.readonly && graphAuthoring() && !props.empty && !!props.onNameResult && props.canNameResult !== false,
      onNameResult: () => { if (!props.readonly && graphAuthoring() && props.canNameResult !== false) props.onNameResult?.(); } }}>
    <ExpressionChromeContext value={{ element: () => chrome, restore: restoreChrome }}>
    <ExpressionDialogContext value={() => editorInDialog() || parentDialog()}>
    <div class={["expr-node", "corner-menu-host", { "expr-node--compact": !editorInDialog() && layout.compact(), "expr-node--graph": graph(),
      "expr-node--graph-data": preview(), "expr-node--graph-unnamed": !!props.graphUnnamed, "expr-node--inspecting": editorInDialog() }]}
      data-corner-menu-owner={preview() ? "true" : undefined} onContextMenu={event => { if (preview()) menu.open(event); }}>
      <Show when={preview()}>
        <ExpressionGraphCollectionSurface><ValueCard class="expr-graph-data-card corner-menu-host" presentation="graph" heading={props.graphHeading ?? props.label}
          onMenu={menu.open} menuOpen={menu.isOpen()} onOpen={() => setInspecting(true)}>
          <div class="expr-graph-data-card__content"><CallLayoutContext value={{ compact: () => true,
            layout: () => "compact", detailed: layout.detailed, withinCall: true }}>{props.graphBody}</CallLayoutContext></div>
          {/* Data and calls share one set of operations: Edit, Add function,
              Add local binding and Delete live in the card's menu (and a click
              opens Edit). Only an empty slot keeps its one entry action. */}
          <Show when={graphAuthoring() && !props.readonly && props.empty && props.onReplace}><div class="expr-graph-authoring-actions">
            <button type="button" class="expr-form__btn" onClick={() => editWith(props.onReplace)}>Add data or a function</button>
          </div></Show>
        </ValueCard></ExpressionGraphCollectionSurface>
      </Show>
      <div class="expr-node__editor-mount" ref={editorMount}>
      <div class="expr-node__editor corner-menu-host" ref={editor} hidden={preview() && !editorInDialog()}
        data-corner-menu-owner="true" onContextMenu={menu.open}>
      <CallLayoutContext value={{ compact: () => !editorInDialog() && layout.compact(), layout: layout.layout,
        detailed: () => editorInDialog() || layout.detailed(), withinCall: layout.withinCall }}>
      <GraphSlotContext value={{ active: () => false }}>
      <div class="expr-node__chrome" ref={chrome}>
      {/* Inside its own dialog the dialog title names the data and the shared
          type contract states its type: the label line would repeat both. */}
      <Show when={!props.hideLabel && !editorInDialog()}>{props.label}</Show>
      <Show when={!graphAuthoring() || props.graphEligible !== false}><ModeToggle
        mode={props.mode}
        switchTo={props.switchTo}
        readonly={props.readonly}
        savedReferencesAvailable={props.savedReferencesAvailable}
        paramAvailable={props.paramAvailable}
        unifiedUse={props.unifiedUse}
        expressionForms={props.expressionForms}
        inlineAvailable={props.inlineAvailable}
      /></Show>
      {/* Inside its own dialog the data is already the subject: its actions
          stay on right-click and the corner bubble would overlap the frame. */}
      <Show when={!inspecting() && (props.nodeKind !== "call" || props.mode === "code" && !graph())}>
        <CornerMenuButton onMenu={menu.open} open={menu.isOpen()} ref={menu.attach} />
      </Show>
      </div>
      <div class={props.contentClass ?? "expr-node__content"} ref={content}>
        <Show when={props.nodeKind === "call" || !preview() || editorInDialog() || editorRequested()}>
          {props.children}
        </Show>
      </div>
      </GraphSlotContext>
      </CallLayoutContext>
      </div>
      </div>
      <CornerMenu menu={menu} items={menuItems()} label="Expression actions" trigger={false} />
      <Show when={inspecting()}>
        <ExpressionArgumentDialog label={props.inspectorLabel ?? "Expression"} onClose={closeInspector}
          placement={insertWindow() || props.pendingInsert ? "side" : undefined}>
          <Show when={insertWindow() || props.pendingInsert} fallback={
            <div class="expr-node__inspector-mount" ref={element => { dialogMount = element; onSettled(relocateEditor); }} />}>
            {props.pendingInsert?.()}
          </Show>
        </ExpressionArgumentDialog>
      </Show>
    </div>
    </ExpressionDialogContext>
    </ExpressionChromeContext>
    </ExpressionInspectorContext>
  );
}

/** Code is a lens over the same mounted visual editor. A graph inspector keeps
 * its pending code draft while the graph returns to its readable node display. */
export function ExpressionCodeLensSurface(props: { code: boolean; renderCode: () => JSX.Element; children: JSX.Element }) {
  const inspector = useContext(ExpressionInspectorContext);
  const [retainGraphCode, setRetainGraphCode] = createSignal(false);
  createEffect(() => props.code && !!inspector?.graph(), retain => { if (retain) setRetainGraphCode(true); });
  const visible = () => props.code && !inspector?.summary();
  return <><Show when={!props.code || inspector?.graph() || retainGraphCode()}><div class="expr-node__visual-editor" hidden={visible()}>{props.children}</div></Show>
    <Show when={props.code || retainGraphCode()}><div class="expr-node__code-editor" hidden={!visible()}>{props.renderCode()}</div></Show></>;
}

/** The call's existing header, badges, trace, replacement action and arguments. */
export function ExpressionCallSurface(props: {
  name: JSX.Element;
  icon?: JSX.Element;
  resultType?: JSX.Element;
  isConstructor?: boolean;
  openParamCount?: number;
  trace?: JSX.Element;
  actions?: JSX.Element;
  onConvertToLiteral?: () => void;
  readonly?: boolean;
  /** Only a call occupying this ExprFieldShell owns its label/code chrome. */
  nodeChrome?: boolean;
  /** A pending insertion's preview: shown dashed until it is confirmed. */
  pending?: boolean;
  missingInputs?: readonly { ordinal: number; name: DisplayNameInput }[];
  graphResult?: (inspect: () => void) => JSX.Element;
  graphNode?: ExprNode;
  graphCaptureAllowed?: boolean;
  children: JSX.Element;
}) {
  const inherited = useContext(CallLayoutContext);
  const inheritedGraph = useContext(CallGraphContext);
  const nodeChrome = useContext(ExpressionChromeContext);
  const inspector = useContext(ExpressionInspectorContext);
  const [layoutChoice, setLayoutChoice] = createSignal<CallLayout | undefined>();
  const menu = createCornerMenu();
  createEffect(() => menu.isOpen() ? inspector?.suggestionOwner() : undefined,
    owner => owner?.hold());
  const capture = useContext(ExpressionGraphCaptureContext);
  const scopeCapture = useContext(ExpressionGraphScopeCaptureContext);
  const layout = (): CallLayout => inherited.detailed() ? "expanded" : (props.nodeChrome ? inspector?.layoutChoice() : undefined) ?? layoutChoice()
    ?? (inherited.withinCall ? inherited.layout() : "graph");
  const compact = () => layout() === "compact";
  const graph = () => layout() === "graph";
  const rootGraph = () => graph() && inherited.layout() !== "graph";
  const graphActivationToken = {};
  let graphWasActive = false;
  const argumentsByRow = new Set<GraphArgument>();
  const containedEdges = new Set<GraphContainedEdge>();
  const nestedGraphRefreshes = new Set<() => void>();
  const nodeResets = new Set<() => void>();
  const placementChecks = new Set<() => void>();
  const nestedSettlers = new Set<() => void>();
  const resultPosition = { x: 0, y: 0 };
  const [argumentCount, setArgumentCount] = createSignal(0);
  const [edges, setEdges] = createSignal<GraphArgument[]>([]);
  const [itemEdges, setItemEdges] = createSignal<GraphContainedEdge[]>([]);
  const [size, setSize] = createSignal({ width: 0, height: 0 });
  const [tracedInput, setTracedInput] = createSignal<string>();
  const [hoveredDot, setHoveredDot] = createSignal<string>();
  const [focusedDot, setFocusedDot] = createSignal<string>();
  const extendedInput = () => hoveredDot() ?? focusedDot();
  const activeInput = () => tracedInput() ?? extendedInput();
  const trace = (id: string, active: boolean, extend = false, focused = false) => {
    if (extend) (focused ? setFocusedDot : setHoveredDot)(current => active ? id : current === id ? undefined : current);
    else setTracedInput(current => active ? id : current === id ? undefined : current);
  };
  const [resultGeometry, setResultGeometry] = createSignal<GraphEdgeGeometry>();
  const resultId = `expression-graph-result-${createUniqueId()}`;
  const frameId = `expression-function-frame-${createUniqueId()}`;
  const coneShape = "M 3.5 0.5 H 44.5 Q 46.5 0.5 46.5 2.5 C 45 9 31.5 11 28.5 19.5 H 19.5 C 16.5 11 3 9 1.5 2.5 Q 1.5 0.5 3.5 0.5 Z";
  const [identityShape, setIdentityShape] = createSignal<{ width: number; height: number; radius: number; outline: string; tip: string; bottomBrace: string; centerBrace: string; slimTip: string }>();
  let identityMount: HTMLSpanElement | undefined;
  let outer: HTMLDivElement | undefined;
  let stage: HTMLDivElement | undefined;
  let sources: HTMLDivElement | undefined;
  let chromeMount: HTMLDivElement | undefined;
  let resultMount: HTMLDivElement | undefined;
  let callMount: HTMLDivElement | undefined;
  let observer: ResizeObserver | undefined;
  let frame: number | undefined;
  let alive = true;
  let centerOnEntry = false;
  function chooseLayout(choice: CallLayout) {
    inspector?.requestVisual();
    centerOnEntry = choice === "graph";
    if (props.nodeChrome && inspector) inspector.chooseLayout(choice);
    else setLayoutChoice(choice);
  }
  function arrangeAutomatically() {
    settleOwnLayout();
    resultPosition.x = 0; resultPosition.y = 0;
    for (const reset of nodeResets) reset();
    refresh();
  }
  function settleOwnLayout() {
    for (const argument of argumentsByRow) argument.settlePlacement();
    for (const settle of nestedSettlers) settle();
  }
  const lensSettings = useContext(ExpressionLensSettingsContext);
  const menuItems = (): LocusMenuItem[] => expressionNodeMenu({
    settings: lensSettings,
    lens: { id: "lens", label: "Lens", icon: "panels-top-left", children: [
      ...(["compact", "expanded", "graph"] as const).map(choice => ({ id: choice,
        label: choice === "compact" ? "Compact" : choice === "expanded" ? "Expanded" : "Graph",
        checked: !inspector?.codeItem().checked && layout() === choice,
        disabled: inherited.detailed() && !props.nodeChrome,
        onSelect: () => chooseLayout(choice),
      })),
      ...(inspector ? [inspector.codeItem()] : []),
      ...(graph() ? [{ id: "arrange", label: "Arrange automatically", icon: "refresh-cw", onSelect: arrangeAutomatically }] : []),
    ] },
    edit: inspector ? { id: "inspect", label: props.readonly ? "Inspect" : "Edit", icon: "pencil", onSelect: inspector.open } : undefined,
    authoring: !props.readonly ? inspector?.authoringItems() ?? [] : [],
    inputs: graph() && argumentCount() > 0 ? { id: "inputs", label: "Inputs", icon: "arrow-down", children: [...argumentsByRow]
      .filter(argument => argument.row.isConnected)
      .sort((a, b) => a.row.compareDocumentPosition(b.row) & Node.DOCUMENT_POSITION_FOLLOWING ? -1 : 1)
      .map(argument => ({ id: argument.id, label: displayNameText(argument.name()) ?? "Input",
        labelCode: displayNameTooltipCode(argument.name()), children: argument.menuItems() })) } : undefined,
    convert: props.onConvertToLiteral ? { id: "replace", label: "Replace with new data", icon: "refresh-cw",
      tooltip: "Replace this call with data you enter directly",
      disabled: !!props.readonly, onSelect: () => { if (!props.readonly) props.onConvertToLiteral?.(); } } : undefined,
    suggestions: suggestionsMenuItem(inspector?.suggestionOwner()),
  });
  function refresh() {
    if (!alive || !stage) return;
    // A parent placement transforms its entire mounted source. ResizeObserver
    // sees layout sizes only, so descendants must remeasure as that transform
    // moves and after it finishes instead of retaining the folded geometry.
    for (const refreshNested of nestedGraphRefreshes) refreshNested();
    if (frame !== undefined) return;
    frame = requestAnimationFrame(() => {
      frame = undefined;
      if (!alive || !stage?.isConnected) return;
      if (!graph()) { setEdges([]); setItemEdges([]); return; }
      for (const check of placementChecks) check();
      const rows = [...argumentsByRow].filter(argument => argument.row.isConnected);
      rows.sort((a, b) => a.row.compareDocumentPosition(b.row) & Node.DOCUMENT_POSITION_FOLLOWING ? -1 : 1);
      const active = rows.filter(argument => argument.active());
      // Source order follows the existing supplied argument rows, including
      // after insertion/removal. This only moves owned browser DOM.
      active.forEach((argument, index) => {
        if (sources && argument.source.parentElement === sources && sources.children[index] !== argument.source)
          sources.insertBefore(argument.source, sources.children[index] ?? null);
      });
      // Center the complete supplied/missing input group over its function.
      const missingCount = props.missingInputs?.length ?? 0;
      const inputCount = rows.length + missingCount;
      const inputOffsets = rows.map((argument, index) => {
        const offset = (index - (inputCount - 1) / 2) * 22;
        const coordinate = `${offset}px`;
        if (argument.row.style.getPropertyValue("--expr-input-offset") !== coordinate)
          argument.row.style.setProperty("--expr-input-offset", coordinate);
        const turn = `${inputHintTurn(index, inputCount)}deg`;
        if (argument.row.style.getPropertyValue("--expr-input-hint-turn") !== turn)
          argument.row.style.setProperty("--expr-input-hint-turn", turn);
        return offset;
      });
      const missingOffset = (rows.length - (inputCount - 1) / 2) * 22;
      const visibleOffsets = [...inputOffsets, ...Array.from({ length: missingCount }, (_, index) => missingOffset + index * 22)];
      const inputLeft = visibleOffsets.length ? Math.min(...visibleOffsets) - 16 : -16;
      const inputWidth = visibleOffsets.length ? Math.max(...visibleOffsets) - inputLeft + 16 : 32;
      const functionNode = stage.querySelector<HTMLElement>(":scope > .expr-call--graph");
      for (const [property, value] of [["--expr-input-pill-left", `${inputLeft}px`],
        ["--expr-input-pill-width", `${inputWidth}px`], ["--expr-missing-input-offset", `${missingOffset}px`]]) {
        if (functionNode && functionNode.style.getPropertyValue(property) !== value) functionNode.style.setProperty(property, value);
      }
      if (identityMount) {
        const identityStyle = getComputedStyle(identityMount);
        const width = parseFloat(identityStyle.width);
        const height = parseFloat(identityStyle.height);
        const radius = Math.min(parseFloat(identityStyle.borderTopLeftRadius), width / 2, height / 2);
        if (width > 0 && height > 0) {
          const center = width / 2;
          const half = Math.min(14, Math.max(4, (width - radius * 2) / 2));
          const bottom = height - 0.5;
          const brace = `C ${center + half} ${bottom + 4} ${center + half * 0.75} ${bottom + 4} ${center + half * 0.45} ${bottom + 4} C ${center + 2} ${bottom + 4} ${center + 2} ${bottom + 7} ${center} ${bottom + 10} C ${center - 2} ${bottom + 7} ${center - 2} ${bottom + 4} ${center - half * 0.45} ${bottom + 4} C ${center - half * 0.75} ${bottom + 4} ${center - half} ${bottom + 4} ${center - half} ${bottom}`;
          const outline = `M ${radius + 0.5} 0.5 H ${width - radius - 0.5} Q ${width - 0.5} 0.5 ${width - 0.5} ${radius + 0.5} V ${height - radius - 0.5} Q ${width - 0.5} ${bottom} ${width - radius - 0.5} ${bottom} H ${center + half} ${brace} H ${radius + 0.5} Q 0.5 ${bottom} 0.5 ${height - radius - 0.5} V ${radius + 0.5} Q 0.5 0.5 ${radius + 0.5} 0.5 Z`;
          const tip = `M ${center + half} ${bottom} ${brace} Z`;
          const bottomBrace = `M ${radius + 0.5} 0.5 H ${width - radius - 0.5} Q ${width - 0.5} 0.5 ${width - 0.5} ${radius + 0.5} V ${height - radius - 0.5} C ${width - 0.5} ${bottom + 4} ${center + center * 0.45} ${bottom + 4} ${center + center * 0.18} ${bottom + 4} C ${center + 2} ${bottom + 4} ${center + 2} ${bottom + 7} ${center} ${bottom + 10} C ${center - 2} ${bottom + 7} ${center - 2} ${bottom + 4} ${center - center * 0.18} ${bottom + 4} C ${center - center * 0.45} ${bottom + 4} 0.5 ${bottom + 4} 0.5 ${height - radius - 0.5} V ${radius + 0.5} Q 0.5 0.5 ${radius + 0.5} 0.5 Z`;
          const centerHalf = Math.min(20, Math.max(4, (width - radius * 2 - 1) / 2 - 8));
          const centerCurve = `C ${center + centerHalf} ${bottom + 5} ${center + centerHalf * 0.75} ${bottom + 5} ${center + centerHalf * 0.45} ${bottom + 5} C ${center + 3} ${bottom + 5} ${center + 3} ${bottom + 10} ${center} ${bottom + 14} C ${center - 3} ${bottom + 10} ${center - 3} ${bottom + 5} ${center - centerHalf * 0.45} ${bottom + 5} C ${center - centerHalf * 0.75} ${bottom + 5} ${center - centerHalf} ${bottom + 5} ${center - centerHalf} ${bottom}`;
          const centerBrace = `M ${radius + 0.5} 0.5 H ${width - radius - 0.5} Q ${width - 0.5} 0.5 ${width - 0.5} ${radius + 0.5} V ${height - radius - 0.5} Q ${width - 0.5} ${bottom} ${width - radius - 0.5} ${bottom} H ${center + centerHalf} ${centerCurve} H ${radius + 0.5} Q 0.5 ${bottom} 0.5 ${height - radius - 0.5} V ${radius + 0.5} Q 0.5 0.5 ${radius + 0.5} 0.5 Z`;
          const slimHalf = Math.min(12, Math.max(4, (width - radius * 2 - 1) / 2 - 8));
          const slimCurve = `C ${center + slimHalf * 0.72} ${bottom} ${center + slimHalf * 0.50} ${bottom + 22 * 0.12} ${center + slimHalf * 0.32} ${bottom + 22 * 0.38} C ${center + slimHalf * 0.14} ${bottom + 22 * 0.64} ${center + slimHalf * 0.08} ${bottom + 22 * 0.84} ${center} ${bottom + 22} C ${center - slimHalf * 0.08} ${bottom + 22 * 0.84} ${center - slimHalf * 0.14} ${bottom + 22 * 0.64} ${center - slimHalf * 0.32} ${bottom + 22 * 0.38} C ${center - slimHalf * 0.50} ${bottom + 22 * 0.12} ${center - slimHalf * 0.72} ${bottom} ${center - slimHalf} ${bottom}`;
          const slimTip = `M ${radius + 0.5} 0.5 H ${width - radius - 0.5} Q ${width - 0.5} 0.5 ${width - 0.5} ${radius + 0.5} V ${height - radius - 0.5} Q ${width - 0.5} ${bottom} ${width - radius - 0.5} ${bottom} H ${center + slimHalf} ${slimCurve} H ${radius + 0.5} Q 0.5 ${bottom} 0.5 ${height - radius - 0.5} V ${radius + 0.5} Q 0.5 0.5 ${radius + 0.5} 0.5 Z`;
          setIdentityShape(previous => previous?.width === width && previous.height === height && previous.radius === radius
            ? previous : { width, height, radius, outline, tip, bottomBrace, centerBrace, slimTip });
        }
      }
      const bounds = stage.getBoundingClientRect();
      const next: GraphArgument[] = [];
      const segments: { argument: GraphArgument; x1: number; y1: number; x2: number; y2: number }[] = [];
      for (const argument of active) {
        if (argument.source.parentElement !== sources) continue;
        // Sources exit their visible card/funnel; inputs arrive directly at
        // the floating indicator, with a small gap before its painted edge.
        const child = argument.source.querySelector<HTMLElement>(".expr-node");
        const sourceNode = graphDataCard(argument.source)
          ?? child?.querySelector<HTMLElement>(".expr-call-graph__stage")?.querySelector<HTMLElement>(":scope > .expr-call--graph > .expr-call__head")
          ?? argument.source;
        const receiver = argument.row.closest<HTMLElement>(".expr-call--graph");
        if (!receiver) continue;
        // A scope frame (a function, local names, an If) is itself the source:
        // never one of the function nodes drawn inside it.
        const source = (sourceNode.matches('[data-expression-scope="true"]') ? sourceNode
          : (sourceNode.parentElement?.dataset.functionFrame === "plain"
            ? sourceNode.querySelector<HTMLElement>(".expr-function-node__title")
            : sourceNode.querySelector<HTMLElement>(".expr-function-node__outlet")) ?? sourceNode).getBoundingClientRect();
        const target = (receiver.querySelector<HTMLElement>(":scope > .expr-call__head") ?? receiver).getBoundingClientRect();
        if (!source.width || !source.height || !target.width || !target.height) continue;
        const x1 = source.left + source.width / 2 - bounds.left;
        const caption = sourceNode.matches(".home-item--graph-body")
          ? sourceNode.querySelector<HTMLElement>(":scope > .home-item__header")?.getBoundingClientRect() : undefined;
        const belowCaption = caption && source.left + source.width / 2 >= caption.left
          && source.left + source.width / 2 <= caption.right ? Math.max(source.bottom, caption.bottom) : source.bottom;
        const y1 = belowCaption - bounds.top + 2;
        const input = argument.input.querySelector<HTMLElement>(".expr-call__input-dot-core")?.getBoundingClientRect()
          ?? argument.input.getBoundingClientRect();
        const inputX = input.left + input.width / 2 - bounds.left;
        const inputY = input.top + input.height / 2 - bounds.top;
        const distance = Math.hypot(inputX - x1, inputY - y1);
        const clearance = Math.max(input.width, input.height) / 2 + 2;
        const x2 = inputX - (distance ? (inputX - x1) / distance * clearance : 0);
        const y2 = inputY - (distance ? (inputY - y1) / distance * clearance : clearance);
        segments.push({ argument, x1, y1, x2, y2 });
        next.push(argument);
      }
      const annotations: { left: number; right: number; top: number; bottom: number }[] = [];
      for (const segment of segments) {
        const { argument, x1, y1, x2, y2 } = segment;
        if (!argument.annotated()) {
          argument.position({ path: `M ${x1} ${y1} L ${x2} ${y2}`, x: 0, y: 0,
            startX: x1, startY: y1, endX: x2, endY: y2 });
          continue;
        }
        const labelHeight = argument.annotation?.offsetHeight || 64;
        const labelWidth = argument.annotation?.offsetWidth || 224;
        const midpoint = (y1 + y2) / 2;
        const low = Math.min(y1, y2) + labelHeight / 2 + 8;
        const high = Math.max(y1, y2) - labelHeight / 2 - 8;
        const bands = low <= high ? [low, midpoint, high] : [midpoint];
        const viewport = outer?.closest<HTMLElement>(".expr-call-graph--root")?.getBoundingClientRect();
        const rightLimit = viewport ? viewport.right - bounds.left - 12 : Math.max(bounds.width, outer?.clientWidth ?? 0) - 12;
        let placement: { x: number; y: number; score: number; centerX: number } | undefined;
        for (const y of bands) {
          const top = y - labelHeight / 2;
          const bottom = y + labelHeight / 2;
          const centerX = y2 === y1 ? (x1 + x2) / 2 : x1 + (y - y1) * (x2 - x1) / (y2 - y1);
          const slopeClearance = y2 !== y1 ? Math.abs((x2 - x1) / (y2 - y1)) * Math.min(labelHeight / 2, Math.abs(y2 - y1) / 2) : Math.abs(x2 - x1) / 2;
          const near = centerX + slopeClearance + 12;
          let x = near;
          // Reuse the same measured clearances in each vertical band. The
          // closest side card can sit near an arrow's start, middle or end.
          const obstacles: { left: number; right: number }[] = [];
          for (const line of segments) {
            const lo = Math.max(top, Math.min(line.y1, line.y2));
            const hi = Math.min(bottom, Math.max(line.y1, line.y2));
            if (lo > hi) continue;
            const a = line.y2 === line.y1 ? line.x1 : line.x1 + (lo - line.y1) * (line.x2 - line.x1) / (line.y2 - line.y1);
            const b = line.y2 === line.y1 ? line.x2 : line.x1 + (hi - line.y1) * (line.x2 - line.x1) / (line.y2 - line.y1);
            obstacles.push({ left: Math.min(a, b) - 8, right: Math.max(a, b) + 8 });
          }
          for (const annotation of annotations) {
            if (top < annotation.bottom + 6 && bottom > annotation.top - 6) obstacles.push(annotation);
          }
          obstacles.sort((a, b) => a.left - b.left);
          for (const obstacle of obstacles) {
            if (x <= obstacle.right && x + labelWidth >= obstacle.left) x = obstacle.right + 12;
          }
          const overflow = Math.max(0, x + labelWidth - rightLimit);
          const score = overflow * 8 + x - near + Math.abs(y - midpoint) * 0.1;
          if (!placement || score < placement.score) placement = { x, y, score, centerX };
        }
        const { x, y } = placement!;
        const top = y - labelHeight / 2;
        const bottom = y + labelHeight / 2;
        const annotationWidth = Math.max(1, rightLimit - x);
        annotations.push({ left: x, right: x + Math.min(labelWidth, annotationWidth), top, bottom });
        argument.position({ path: `M ${x1} ${y1} L ${x2} ${y2}`, x, y,
          startX: x1, startY: y1, endX: x2, endY: y2, annotationWidth,
          leader: x - placement!.centerX > 36 ? `M ${placement!.centerX + 7} ${y} L ${x - 5} ${y}` : undefined });
      }
      const visibleItems: GraphContainedEdge[] = [];
      for (const edge of containedEdges) {
        if (!edge.active() || !edge.source.isConnected || !edge.input.isConnected) continue;
        const card = graphDataCard(edge.source) ?? edge.source;
        const sourceBounds = card.getBoundingClientRect();
        const inputBounds = (edge.input.querySelector<HTMLElement>(".expr-call__input-dot-core") ?? edge.input).getBoundingClientRect();
        if (!sourceBounds.width || !sourceBounds.height || !inputBounds.width || !inputBounds.height) continue;
        const centerX = sourceBounds.left + sourceBounds.width / 2;
        const centerY = sourceBounds.top + sourceBounds.height / 2;
        const targetX = inputBounds.left + inputBounds.width / 2;
        const targetY = inputBounds.top + inputBounds.height / 2;
        const dx = targetX - centerX, dy = targetY - centerY;
        // Result-list items can sit beside their parent, leaving its producer
        // arrow clear. Exit the real card edge that faces the item port.
        const ratio = Math.min(dx ? sourceBounds.width / 2 / Math.abs(dx) : Infinity,
          dy ? sourceBounds.height / 2 / Math.abs(dy) : Infinity);
        const boundaryX = Number.isFinite(ratio) ? centerX + dx * ratio : centerX;
        const boundaryY = Number.isFinite(ratio) ? centerY + dy * ratio : sourceBounds.bottom;
        const startX = boundaryX - bounds.left;
        const badge = card.querySelector<HTMLElement>(":scope > .home-item__header")?.getBoundingClientRect();
        const exitY = boundaryY >= sourceBounds.bottom - 0.5 && badge && boundaryX >= badge.left
          && boundaryX <= badge.right ? Math.max(boundaryY, badge.bottom) : boundaryY;
        const inputX = targetX - bounds.left;
        const inputY = targetY - bounds.top;
        const directionDistance = Math.hypot(inputX - startX, inputY - (exitY - bounds.top));
        const startY = exitY - bounds.top + (directionDistance ? (inputY - (exitY - bounds.top)) / directionDistance * 2 : 2);
        const clearedStartX = startX + (directionDistance ? (inputX - startX) / directionDistance * 2 : 0);
        const distance = Math.hypot(inputX - clearedStartX, inputY - startY);
        const clearance = Math.max(inputBounds.width, inputBounds.height) / 2 + 2;
        const endX = inputX - (distance ? (inputX - clearedStartX) / distance * clearance : 0);
        const endY = inputY - (distance ? (inputY - startY) / distance * clearance : clearance);
        edge.position({ path: `M ${clearedStartX} ${startY} L ${endX} ${endY}`, x: 0, y: 0, startX: clearedStartX, startY, endX, endY });
        visibleItems.push(edge);
      }
      setItemEdges(previous => previous.length === visibleItems.length && previous.every((edge, index) => edge === visibleItems[index]) ? previous : visibleItems);
      setSize({ width: bounds.width, height: bounds.height });
      const result = graphDataCard(resultMount) ?? resultMount?.querySelector<HTMLElement>(".home-item") ?? resultMount;
      const receiver = stage.querySelector<HTMLElement>(":scope > .expr-call--graph");
      if (rootGraph() && result?.isConnected && receiver) {
        const sourceBounds = ((receiver.dataset.functionFrame === "plain"
          ? receiver.querySelector<HTMLElement>(":scope > .expr-call__head > .expr-function-node__title")
          : receiver.querySelector<HTMLElement>(":scope > .expr-call__head > .expr-function-node__outlet"))
          ?? receiver.querySelector<HTMLElement>(":scope > .expr-call__head") ?? receiver).getBoundingClientRect();
        const targetBounds = result.getBoundingClientRect();
        const startX = sourceBounds.left + sourceBounds.width / 2 - bounds.left;
        const startY = sourceBounds.bottom - bounds.top + 2;
        const endX = targetBounds.left + targetBounds.width / 2 - bounds.left;
        const endY = targetBounds.top - bounds.top - 2;
        setResultGeometry(targetBounds.width && targetBounds.height ? {
          path: `M ${startX} ${startY} L ${endX} ${endY}`,
          x: 0, y: 0, startX, startY, endX, endY,
        } : undefined);
      } else setResultGeometry(undefined);
      // Keep each edge's presentation mounted while browser geometry changes.
      setEdges(previous => previous.length === next.length && previous.every((edge, index) => edge === next[index]) ? previous : next);
      if (centerOnEntry && outer && outer.clientWidth > 0) {
        // Center once after the automatic node layout is measured. Later
        // edits, resizes and scroll events retain the reader's chosen pan.
        outer.scrollLeft = Math.max(0, (bounds.width - outer.clientWidth) / 2);
        centerOnEntry = false;
      }
    });
  }
  function register(argument: GraphArgument) {
    argumentsByRow.add(argument);
    setArgumentCount(argumentsByRow.size);
    observer?.observe(argument.source);
    observer?.observe(argument.input);
    refresh();
    return () => {
      if (!argumentsByRow.delete(argument)) return;
      observer?.unobserve(argument.source);
      observer?.unobserve(argument.input);
      if (argument.annotation) observer?.unobserve(argument.annotation);
      // A source change can dispose this slot inside its parent's computation.
      // Retire its DOM registration now; publish only to the surviving graph.
      queueMicrotask(() => {
        if (!alive) return;
        if (![...argumentsByRow].some(current => current.id === argument.id)) {
          trace(argument.id, false, true);
          trace(argument.id, false, true, true);
          trace(argument.id, false);
        }
        setArgumentCount(argumentsByRow.size);
        refresh();
      });
    };
  }
  function registerContained(edge: GraphContainedEdge) {
    containedEdges.add(edge);
    observer?.observe(edge.source); observer?.observe(edge.input);
    refresh();
    return () => {
      containedEdges.delete(edge);
      observer?.unobserve(edge.source); observer?.unobserve(edge.input);
      refresh();
    };
  }
  function relocateChrome() {
    if (!props.nodeChrome) return;
    const chrome = nodeChrome?.element();
    if (graph() && chrome && chromeMount) {
      if (chrome.parentElement !== chromeMount) chromeMount.appendChild(chrome);
    } else nodeChrome?.restore();
    refresh();
  }
  createEffect(graph, relocateChrome);
  createEffect(graph, active => { inspector?.graphChanged(active); });
  createEffect(() => {
    const scopeNode = scopeCapture.node();
    return { active: rootGraph(), node: scopeNode ?? props.graphNode,
      allowed: props.graphCaptureAllowed === false ? false : scopeNode ? scopeCapture.allowed() : props.graphCaptureAllowed };
  }, current => {
    if (current.active || graphWasActive) capture.activate?.(current.active, graphActivationToken, current.node, current.allowed);
    graphWasActive = current.active;
  });
  createEffect(layout, refresh);
  createEffect(() => ({ active: rootGraph(), detailed: inherited.detailed() }), (next, previous) => {
    // Inspection temporarily expands the same graph. Returning from it keeps
    // the reader's pan; an explicit layout change still centers on entry.
    if (!next.detailed && !previous?.detailed) centerOnEntry = next.active;
    refresh();
  });
  createEffect(graph, active => {
    if (!active) { setTracedInput(undefined); setHoveredDot(undefined); setFocusedDot(undefined); }
    if (!active || !stage || !outer) { setEdges([]); setItemEdges([]); return; }
    observer = new ResizeObserver(refresh);
    observer.observe(stage);
    const viewport = outer.closest<HTMLElement>(".expr-call-graph--root");
    if (viewport && viewport !== outer) {
      observer.observe(viewport);
      viewport.addEventListener("scroll", refresh);
    }
    if (resultMount?.isConnected) observer.observe(resultMount);
    for (const argument of argumentsByRow) {
      observer.observe(argument.source);
      observer.observe(argument.input);
      if (argument.annotation?.isConnected) observer.observe(argument.annotation);
    }
    for (const edge of containedEdges) { observer.observe(edge.source); observer.observe(edge.input); }
    const mutations = new MutationObserver(records => {
      if (records.some(record => !(record.target instanceof Element
        && record.target.closest(".expr-call-graph__edges, .expr-call-graph__edge-labels, .expr-call-graph__edge-controls")))) refresh();
    });
    mutations.observe(stage, { subtree: true, childList: true, characterData: true, attributes: true });
    outer.addEventListener("scroll", refresh, true);
    stage.addEventListener("input", refresh, true);
    window.addEventListener("resize", refresh);
    refresh();
    return () => {
      if (frame !== undefined) cancelAnimationFrame(frame);
      frame = undefined;
      observer?.disconnect();
      observer = undefined;
      mutations.disconnect();
      outer?.removeEventListener("scroll", refresh, true);
      if (viewport !== outer) viewport?.removeEventListener("scroll", refresh);
      stage?.removeEventListener("input", refresh, true);
      window.removeEventListener("resize", refresh);
    };
  });
  onSettled(() => {
    const unregisterRefresh = inheritedGraph?.registerRefresh(refresh);
    const unregisterReset = inheritedGraph?.registerReset(arrangeAutomatically);
    const unregisterSettler = inheritedGraph?.registerSettler(settleOwnLayout);
    relocateChrome();
    return () => { alive = false; if (graphWasActive) capture.activate?.(false, graphActivationToken);
      unregisterRefresh?.(); unregisterReset?.(); unregisterSettler?.(); nestedGraphRefreshes.clear(); nodeResets.clear(); placementChecks.clear(); nestedSettlers.clear();
      if (props.nodeChrome) nodeChrome?.restore(); if (frame !== undefined) cancelAnimationFrame(frame); argumentsByRow.clear(); containedEdges.clear(); };
  });
  return (
    <CallLayoutContext value={{ compact, layout, detailed: inherited.detailed, withinCall: true }}>
    <CallGraphContext value={{ active: graph, single: () => argumentCount() === 1, sources: () => sources, register, registerContained, refresh, trace,
      registerRefresh: refreshNested => { nestedGraphRefreshes.add(refreshNested); return () => { nestedGraphRefreshes.delete(refreshNested); }; },
      registerReset: reset => { nodeResets.add(reset); return () => { nodeResets.delete(reset); }; },
      registerPlacementCheck: check => { placementChecks.add(check); return () => { placementChecks.delete(check); }; },
      registerSettler: settle => { nestedSettlers.add(settle); return () => { nestedSettlers.delete(settle); }; },
      settleLayout: () => inheritedGraph ? inheritedGraph.settleLayout() : settleOwnLayout(),
      settlePlacements: except => { for (const argument of argumentsByRow) if (argument.id !== except) argument.settlePlacement(); } }}>
    <div class={["expr-call-graph", { "expr-call-graph--active": graph(), "expr-call-graph--root": rootGraph() }]} ref={outer}>
    <div class="expr-call-graph__stage" ref={stage}>
    <div class="expr-call-graph__sources" ref={sources} aria-label="Input nodes" />
    <Show when={graph()}><svg class="expr-call-graph__edges" aria-hidden="true"
      width={size().width} height={size().height}>
      <For each={edges()}>{edge => <ExpressionGraphArrow id={edge.id} geometry={edge.geometry()} color={edge.color()}
        invalid={!!edge.graphError()}
        hovered={activeInput() === edge.id} dimmed={!!activeInput() && activeInput() !== edge.id}
        onTrace={active => trace(edge.id, active)} onMenu={edge.openMenu} />}</For>
      <For each={itemEdges()}>{edge => <ExpressionGraphArrow id={edge.id} geometry={edge.geometry()} color={edge.color()} final />}</For>
      <Show when={resultGeometry()}>{geometry => <ExpressionGraphArrow id={resultId} geometry={geometry()} color="var(--expr-graph-slot-0)" final
        hovered={activeInput() === resultId} dimmed={!!activeInput() && activeInput() !== resultId}
        onTrace={active => trace(resultId, active)} onMenu={menu.open} />}</Show>
    </svg></Show>
    <Show when={graph()}><div class="expr-call-graph__edge-labels">
      <For each={edges().filter(edge => edge.annotated())}>{edge => <div class="expr-call-graph__edge-label" ref={element => {
        if (edge.annotation) observer?.unobserve(edge.annotation);
        edge.annotation = element;
        observer?.observe(element);
        refresh();
      }}
        style={{ left: `${edge.geometry()?.x ?? 0}px`, top: `${edge.geometry()?.y ?? 0}px`, "--expr-input-color": edge.color(),
          "--expr-graph-annotation-width": `${edge.geometry()?.annotationWidth ?? 352}px` }}>
        <div class="expr-call-graph__edge-preview">{edge.label()}</div>
        <Show when={edge.graphError()}>{message => <div class="expr-call-graph__edge-error" id={`${edge.id}-error`} role="status">
          {message()}
        </div>}</Show>
      </div>}</For>
    </div></Show>
    <Show when={graph()}><div class="expr-call-graph__edge-controls">
      <For each={edges()}>{edge => <>
        <Show when={edge.graphError()}><button type="button" class="expr-call-graph__edge-warning"
          data-corner-menu-owner="true" onContextMenu={edge.openMenu}
          aria-label={`Inspect type error on ${displayNameText(edge.name())} input`} aria-describedby={`${edge.id}-error`}
          data-tooltip={edge.graphError()}
          style={{ left: `${((edge.geometry()?.startX ?? 0) + (edge.geometry()?.endX ?? 0)) / 2}px`,
            top: `${((edge.geometry()?.startY ?? 0) + (edge.geometry()?.endY ?? 0)) / 2}px` }}
          onPointerEnter={event => { if (event.pointerType !== "touch") trace(edge.id, true); }}
          onPointerLeave={() => trace(edge.id, false)}
          onFocus={() => trace(edge.id, true, true, true)} onBlur={() => trace(edge.id, false, true, true)}
          onClick={event => { event.stopPropagation(); edge.inspect(); }}><IconAlertTriangle size={17} /></button></Show>
        <Show when={edge.canInsertCall()}><button type="button"
          class={["expr-call-graph__edge-insert", { "expr-call-graph__edge-insert--active": activeInput() === edge.id,
            "expr-call-graph__edge-insert--invalid": !!edge.graphError() }]}
          aria-label={`Insert function call on ${displayNameText(edge.name())} input`} data-tooltip="Insert function call between these steps"
          data-expression-graph-insert={edge.id}
          data-corner-menu-owner="true" onContextMenu={edge.openMenu}
          style={{ left: `${((edge.geometry()?.startX ?? 0) + (edge.geometry()?.endX ?? 0)) / 2 - (edge.graphError() ? 38 : 0)}px`,
            top: `${((edge.geometry()?.startY ?? 0) + (edge.geometry()?.endY ?? 0)) / 2}px` }}
          onPointerEnter={event => { if (event.pointerType !== "touch") trace(edge.id, true); }}
          onPointerLeave={() => trace(edge.id, false)}
          onFocus={() => trace(edge.id, true, true, true)} onBlur={() => trace(edge.id, false, true, true)}
          onClick={event => { event.stopPropagation(); edge.onInsertCall(); }}><IconPlus size={17} /></button></Show>
      </>}</For>
      <Show when={rootGraph() && resultGeometry() && !props.readonly && inspector?.canInsertCall()}><button type="button"
        class={["expr-call-graph__edge-insert", { "expr-call-graph__edge-insert--active": activeInput() === resultId }]}
        aria-label="Insert function call before result" data-tooltip="Pass this call's output through another function"
        data-expression-graph-insert={resultId}
        data-corner-menu-owner="true" onContextMenu={menu.open}
        style={{ left: `${((resultGeometry()?.startX ?? 0) + (resultGeometry()?.endX ?? 0)) / 2}px`,
          top: `${((resultGeometry()?.startY ?? 0) + (resultGeometry()?.endY ?? 0)) / 2}px` }}
        onPointerEnter={event => { if (event.pointerType !== "touch") trace(resultId, true); }}
        onPointerLeave={() => trace(resultId, false)}
        onFocus={() => trace(resultId, true, true, true)} onBlur={() => trace(resultId, false, true, true)}
        onClick={event => { event.stopPropagation(); inspector?.onInsertCall(); }}><IconPlus size={17} /></button></Show>
    </div></Show>
    <div class={["expr-call", "corner-menu-host", { "expr-call--pending": !!props.pending, "expr-call--ctor": !!props.isConstructor, "expr-call--compact": compact(), "expr-call--graph": graph(), "expr-call--single-input": graph() && argumentCount() === 1,
      "expr-call--has-inputs": graph() && argumentCount() + (props.missingInputs?.length ?? 0) > 0 }]}
      ref={callMount} data-expression-graph-movable="function"
      data-call-layout={layout()} data-function-frame="plain" data-corner-menu-owner="true" onContextMenu={menu.open}
      style={{ "--expr-input-count": argumentCount() + (props.missingInputs?.length ?? 0),
        "--expr-missing-input-count": props.missingInputs?.length ?? 0 }}>
      <div class={["expr-call__head", { "expr-function-node__head": graph() }]}>
        <Show when={graph()}><svg class="expr-function-node__frame" viewBox="0 0 192 78" preserveAspectRatio="none" aria-hidden="true">
          <defs>
            <radialGradient id={`${frameId}-end-erase`}>
              <stop offset="0" stop-color="black" /><stop offset="0.25" stop-color="black" />
              <stop offset="1" stop-color="black" stop-opacity="0" />
            </radialGradient>
            <mask id={`${frameId}-ends`} maskUnits="userSpaceOnUse" x="-16" y="-16" width="224" height="110">
              <rect x="-16" y="-16" width="224" height="110" fill="white" />
              <circle cx="1" cy="1" r="24" fill={`url(#${frameId}-end-erase)`} />
              <circle cx="191" cy="1" r="24" fill={`url(#${frameId}-end-erase)`} />
              <circle cx="96" cy="76" r="30" fill={`url(#${frameId}-end-erase)`} />
            </mask>
          </defs>
          <g mask={`url(#${frameId}-ends)`}>
            <path class="expr-function-node__mist" d="M 1 1 C 28 12 50 18 96 18 C 142 18 164 12 191 1 L 191 38 C 191 56 174 57 138 57 C 111 57 111 69 102 76 L 90 76 C 81 69 81 57 54 57 C 18 57 1 56 1 38 Z"
              fill="var(--expr-call-surface-background)" />
            <path class="expr-function-node__bracket" d="M 1 1 L 1 38 C 1 56 18 57 54 57 C 77 57 81 69 90 76 M 102 76 C 111 69 115 57 138 57 C 174 57 191 56 191 38 L 191 1"
              stroke="var(--expr-call-surface-border)" vector-effect="non-scaling-stroke" />
          </g>
        </svg></Show>
        <span class={["expr-call__name", { "expr-function-node__title": graph(), "corner-menu-host": graph() }]} ref={identityMount}
          data-corner-menu-owner={graph() ? "true" : undefined} onContextMenu={event => { if (graph()) menu.open(event); }}>
          <ExpressionGraphMoveHandle active={graph()} label="Move function node" element={() => callMount} />
          <Show when={graph()}><svg class="expr-function-node__identity-shape" aria-hidden="true" preserveAspectRatio="none"
            viewBox={`0 0 ${identityShape()?.width ?? 84} ${(identityShape()?.height ?? 34) + 22}`}
            style={{ color: rootGraph() ? "var(--expr-graph-slot-0)" : "var(--expr-input-color, var(--expr-graph-slot-0))" }}>
            <defs><linearGradient id={`${frameId}-attached-reflection`} gradientUnits="userSpaceOnUse" x1="0" x2="0"
              y1={(identityShape()?.height ?? 34) - 0.5} y2={(identityShape()?.height ?? 34) + 9.5}>
              <stop offset="0" stop-color="currentColor" stop-opacity="0" />
              <stop offset="0.35" stop-color="currentColor" stop-opacity="0.58" />
              <stop offset="1" stop-color="currentColor" stop-opacity="0" />
            </linearGradient></defs>
            <path class="expr-function-node__identity-fill" d={identityShape()?.outline} fill="var(--expr-call-surface-background)" stroke="none" />
            <path class="expr-function-node__identity-reflection" d={identityShape()?.tip} fill={`url(#${frameId}-attached-reflection)`} stroke="none" />
            <path class="expr-function-node__identity-border" d={identityShape()?.outline} fill="none" stroke="var(--expr-call-surface-border)" vector-effect="non-scaling-stroke" />
            <path class="expr-function-node__identity-bottom-brace" d={identityShape()?.bottomBrace}
              fill="var(--expr-call-surface-background)" stroke="var(--expr-call-surface-border)" vector-effect="non-scaling-stroke" />
            <path class="expr-function-node__identity-center-brace" d={identityShape()?.centerBrace}
              fill="var(--expr-call-surface-background)" stroke="var(--expr-call-surface-border)" vector-effect="non-scaling-stroke" />
            <path class="expr-function-node__identity-slim-tip" d={identityShape()?.slimTip}
              fill="var(--expr-call-surface-background)" stroke="var(--expr-call-surface-border)" vector-effect="non-scaling-stroke" />
          </svg></Show>
          <Show when={graph()} fallback={props.name}><button type="button" class="expr-function-node__title-button"
            aria-label={`${props.readonly ? "Inspect" : "Edit"} function call`} onClick={event => { event.stopPropagation(); inspector?.open(); }}>
            <Show when={props.icon}><span class="expr-function-node__icon">{props.icon}</span></Show>{props.name}
          </button></Show>
          <Show when={graph()}><CornerMenuButton onMenu={menu.open} open={menu.isOpen()}
            label="Function call actions" ref={menu.attach} /></Show>
          <Show when={props.isConstructor}>
            <span class="expr-call__ctor-badge expr-function-node__icon" role="img" aria-label="Creates data" data-tooltip="Creates data"><IconPackage size={14} /></span>
          </Show>
          <Show when={(props.openParamCount ?? 0) > 0}>
            <span
              class="expr-call__partial-badge mono"
              data-tooltip="Trailing parameters are intentionally left open"
            >
              partial · {props.openParamCount}
            </span>
          </Show>
        </span>
        <Show when={!graph()}>{props.trace}{props.actions}</Show>
        <CornerMenu menu={menu} items={menuItems()} label="Function call actions" trigger={!graph()} />
        <Show when={graph()}><span class="expr-function-node__outlet" aria-hidden="true">
          <svg class="expr-function-node__brace" viewBox="0 0 48 12" aria-hidden="true"
            style={{ color: rootGraph() ? "var(--expr-graph-slot-0)" : "var(--expr-input-color, var(--expr-graph-slot-0))" }}>
            <path d="M 1 1 C 1 5 4 6 9 6 L 17 6 C 21 6 22 7 24 11 C 26 7 27 6 31 6 L 39 6 C 44 6 47 5 47 1" />
          </svg>
          <svg class="expr-function-node__cone" viewBox="0 0 48 20" preserveAspectRatio="none" aria-hidden="true"
            style={{ color: rootGraph() ? "var(--expr-graph-slot-0)" : "var(--expr-input-color, var(--expr-graph-slot-0))" }}>
            <defs><linearGradient id={`${frameId}-cone-fill`} gradientUnits="userSpaceOnUse" x1="0" y1="0" x2="0" y2="19">
              <stop offset="0" stop-color="var(--expr-call-surface-background)" />
              <stop offset="0.25" stop-color="var(--expr-call-surface-background)" />
              <stop offset="1" stop-color="var(--expr-call-surface-background)" stop-opacity="0" />
            </linearGradient><linearGradient id={`${frameId}-cone-reflection`} gradientUnits="userSpaceOnUse" x1="0" y1="0" x2="0" y2="19">
              <stop offset="0" stop-color="currentColor" stop-opacity="0.78" />
              <stop offset="0.25" stop-color="currentColor" stop-opacity="0.58" />
              <stop offset="1" stop-color="currentColor" stop-opacity="0" />
            </linearGradient></defs>
            <path class="expr-function-node__cone-fill" d={coneShape}
              fill={`url(#${frameId}-cone-fill)`} stroke="none" />
            <path class="expr-function-node__cone-reflection" d={coneShape}
              fill={`url(#${frameId}-cone-reflection)`} stroke="none" />
            <path class="expr-function-node__cone-border" d="M 19.5 19.5 C 16.5 11 3 9 1.5 2.5 Q 1.5 0.5 3.5 0.5 H 44.5 Q 46.5 0.5 46.5 2.5 C 45 9 31.5 11 28.5 19.5"
              fill="none" vector-effect="non-scaling-stroke" />
          </svg>
        </span></Show>
      </div>
      <div class="expr-call__args" role={graph() ? "group" : undefined} aria-label={graph() ? "Function inputs" : undefined}>{props.children}
      <Show when={graph() && props.missingInputs?.length}><div class="expr-call__missing-inputs" aria-label="Missing inputs">
        <For each={props.missingInputs}>{input => <button type="button" class="expr-call__input-dot expr-call__input-dot--empty"
          data-expression-graph-input="true" data-input-ordinal={input.ordinal} aria-label={`Supply ${displayNameText(input.name)}`}
          data-tooltip={`${displayNameText(input.name)}: missing data`} data-tooltip-code={displayNameTooltipCode(input.name)} onClick={event => { event.stopPropagation(); inspector?.open(); }} />}</For>
      </div></Show></div>
      <div class="expr-call__node-chrome" ref={chromeMount} />
    </div>
    <Show when={rootGraph() && props.graphResult}><div class="expr-call-graph__result" data-expression-graph-movable="result" ref={element => {
      resultMount = element; observer?.observe(element); refresh();
    }}><ExpressionGraphMoveHandle active={rootGraph()} label="Move result node" element={() => resultMount}
      anchor={() => graphDataCard(resultMount)} position={resultPosition} />
      {props.graphResult?.(() => inspector?.open())}</div></Show>
    </div>
    </div>
    </CallGraphContext>
    </CallLayoutContext>
  );
}

/** Arrow paint stays in the browser, over the same measured node borders.
 * The If decision (structural-surfaces) paints its condition and branch
 * edges with this same arrow. */
export function ExpressionGraphArrow(props: { id: string; geometry?: GraphEdgeGeometry; color: string; final?: boolean;
  hovered?: boolean; dimmed?: boolean; invalid?: boolean; onTrace?: (active: boolean) => void; onMenu?: (event: MouseEvent) => void }) {
  const paint = createMemo(() => {
    const geometry = props.geometry;
    if (!geometry) return undefined;
    const bends = geometry.via ?? [];
    const from = bends.at(-1) ?? { x: geometry.startX, y: geometry.startY };
    const incomingX = geometry.endX - from.x;
    const incomingY = geometry.endY - from.y;
    const distance = Math.hypot(incomingX, incomingY);
    const tipX = geometry.endX;
    const tipY = geometry.endY;
    const ux = distance ? incomingX / distance : 0;
    const uy = distance ? incomingY / distance : 1;
    // Paint the shaft behind the base of an independent sharp head. A stroke
    // ending at the tip protrudes past it, especially with round line caps.
    const shaftX = tipX - ux * 9;
    const shaftY = tipY - uy * 9;
    const baseX = tipX - ux * 12;
    const baseY = tipY - uy * 12;
    return { x: tipX, y: tipY,
      path: `M ${geometry.startX} ${geometry.startY}${bends.map(point => ` L ${point.x} ${point.y}`).join("")} L ${shaftX} ${shaftY}`,
      head: `M ${tipX} ${tipY} L ${baseX - uy * 6} ${baseY + ux * 6} L ${baseX + uy * 6} ${baseY - ux * 6} Z` };
  });
  return <g class={["expr-call-graph__arrow", { "expr-call-graph__arrow--active": !!props.hovered,
    "expr-call-graph__arrow--dimmed": !!props.dimmed, "expr-call-graph__arrow--invalid": !!props.invalid }]}
    data-expression-graph-arrow={props.id} style={{ color: props.color }}>
    <defs>
      <linearGradient id={`${props.id}-gradient`} gradientUnits="userSpaceOnUse"
        x1={props.geometry?.startX} y1={props.geometry?.startY} x2={props.geometry?.endX} y2={props.geometry?.endY}>
        <stop offset="0" stop-color="currentColor" stop-opacity="0.42" />
        <stop offset="1" stop-color="currentColor" stop-opacity="1" />
      </linearGradient>
    </defs>
    <path class="expr-call-graph__arrow-relief" d={paint()?.path} fill="none" stroke="currentColor"
      stroke-width="5" opacity="0.14" transform="translate(0, 1)" />
    <Show when={props.geometry?.leader}><path class="expr-call-graph__annotation-leader" d={props.geometry?.leader}
      fill="none" stroke="currentColor" stroke-width="1" stroke-dasharray="3 3" opacity="0.4" /></Show>
    <path data-expression-graph-edge="true" data-expression-graph-final={props.final ? "true" : undefined}
      data-expression-graph-invalid={props.invalid ? "true" : undefined}
      d={paint()?.path} fill="none" stroke={`url(#${props.id}-gradient)`} stroke-width="3"
      stroke-dasharray={props.invalid ? "6 6" : undefined} />
    <path class="expr-call-graph__arrowhead" data-expression-graph-tip="true" data-tip-x={paint()?.x} data-tip-y={paint()?.y}
      d={paint()?.head} fill="currentColor" stroke="none" />
    <Show when={props.onTrace}><path class="expr-call-graph__arrow-hit" d={props.geometry?.path} fill="none"
      stroke="transparent" stroke-width="14" data-expression-graph-hit={props.id}
      data-corner-menu-owner={props.onMenu ? "true" : undefined} onContextMenu={event => props.onMenu?.(event)}
      onPointerEnter={event => { if (event.pointerType !== "touch") props.onTrace?.(true); }}
      onPointerLeave={() => props.onTrace?.(false)} /></Show>
  </g>;
}

/** A recursive argument slot and its existing trailing-parameter action. */
export function ExpressionCallArgumentRow(props: {
  /** A human label, or the picked display name (a code name without a label
   * renders in the shared code face, tooltips included). */
  parameterName?: DisplayNameInput;
  ordinal?: number;
  /** Semantic presentation stays with the existing expression owner. */
  edgeLabel?: (inspect: () => void) => JSX.Element;
  slotPreview?: (unfold: () => void) => JSX.Element;
  /** A presentation hint only; arity/types still belong to the caller. */
  nodeByDefault?: boolean;
  filled?: boolean;
  partialActions?: boolean;
  onOpen?: () => void;
  readonly?: boolean;
  children: JSX.Element;
}) {
  const layout = useContext(CallLayoutContext);
  const graph = useContext(CallGraphContext);
  const [opened, setOpened] = createSignal(false);
  const parentDialog = useContext(ExpressionDialogContext);
  const menu = createCornerMenu();
  const [nodeChoice, setNodeChoice] = createSignal<boolean | undefined>();
  const [presentation, setPresentation] = createSignal<GraphSlotPresentation>();
  createEffect(() => menu.isOpen() ? presentation()?.suggestionOwner?.() : undefined,
    owner => owner?.hold());
  const [geometry, position] = createSignal<GraphEdgeGeometry>();
  const edgeId = `expression-graph-arrow-${createUniqueId()}`;
  const color = () => `var(--expr-graph-slot-${props.ordinal ?? 0}, hsl(${((props.ordinal ?? 0) * 137.508 + 10) % 360} 55% 42%))`;
  const graphMode = () => !!graph?.active() && !layout.detailed();
  const asNode = () => graphMode() && (nodeChoice() ?? !!props.nodeByDefault);
  const childLayout = (): CallLayout => opened() ? "expanded" : graphMode()
    ? asNode() ? "graph" : "expanded" : layout.layout();
  const canOpen = () => layout.compact() || graphMode();
  const parameterText = () => displayNameText(props.parameterName);
  const parameterCode = () => displayNameTooltipCode(props.parameterName);
  let row: HTMLDivElement | undefined;
  let inlineMount: HTMLDivElement | undefined;
  let source: HTMLDivElement | undefined;
  let input: HTMLDivElement | undefined;
  let dialogMount: HTMLDivElement | undefined;
  let returnFocus: HTMLElement | undefined;
  let disposed = false;
  const placementAnimations = new Set<Animation>();
  let placementFrame: number | undefined;
  let placementTarget: boolean | undefined;
  let placementRevision = 0;
  let dotPointer = false;
  let dotFocused = false;
  const updateTrace = () => {
    graph?.trace(edgeId, asNode() && dotPointer, true);
    graph?.trace(edgeId, asNode() && dotFocused, true, true);
  };
  function relocate() {
    if (disposed || !source || !inlineMount) return;
    const destination = opened() ? dialogMount : asNode() ? graph?.sources() : inlineMount;
    if (destination && source.parentElement !== destination) {
      const focus = document.activeElement;
      const retainFocus = focus instanceof HTMLElement && source.contains(focus);
      destination.appendChild(source);
      if (retainFocus && focus.isConnected) focus.focus({ preventScroll: true });
    }
    graph?.refresh();
  }
  createEffect(() => [graphMode(), asNode(), opened(), parameterText()], relocate);
  createEffect(asNode, updateTrace);
  createEffect(graphMode, active => {
    if (!active) {
      dotPointer = false; dotFocused = false; updateTrace();
      if (placementTarget !== undefined) setNodeChoice(placementTarget);
      placementRevision++;
      if (placementFrame !== undefined) cancelAnimationFrame(placementFrame);
      placementFrame = undefined;
      for (const animation of placementAnimations) animation.cancel();
      placementAnimations.clear();
      placementTarget = undefined;
    }
  });
  function settlePlacement() {
    if (placementTarget === undefined && !placementAnimations.size && placementFrame === undefined) return;
    const target = placementTarget;
    placementRevision++;
    if (placementFrame !== undefined) cancelAnimationFrame(placementFrame);
    placementFrame = undefined;
    for (const animation of placementAnimations) animation.cancel();
    placementAnimations.clear();
    placementTarget = undefined;
    if (target !== undefined) setNodeChoice(target);
    flush();
    relocate();
  }
  function choosePlacement(next: boolean) {
    if (next === asNode() && placementTarget === undefined && placementAnimations.size === 0) return;
    const revision = ++placementRevision;
    const root = row?.closest<HTMLElement>(".expr-call-graph--root") ?? row?.closest<HTMLElement>(".expr-call-graph");
    const stage = root?.querySelector<HTMLElement>(":scope > .expr-call-graph__stage");
    const moving = stage ? [...stage.querySelectorAll<HTMLElement>(":scope > .expr-call-graph__sources > .expr-call-graph__source-entry, :scope > .expr-call, :scope > .expr-call-graph__result")] : [];
    const before = new Map(moving.map(element => [element, element.getBoundingClientRect()]));
    const previousSource = source?.getBoundingClientRect();
    const previouslyNode = asNode();
    graph?.settlePlacements(edgeId);
    for (const element of moving) for (const animation of element.getAnimations()) {
      if (animation.effect instanceof KeyframeEffect && animation.effect.getKeyframes().some(keyframe => keyframe.transform))
        animation.cancel();
    }
    for (const animation of placementAnimations) animation.cancel();
    placementAnimations.clear();
    if (placementFrame !== undefined) cancelAnimationFrame(placementFrame);
    placementFrame = undefined;
    placementTarget = next;
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches || !source || !input) {
      setNodeChoice(next);
      placementTarget = undefined;
      return;
    }
    const dotBounds = input.querySelector<HTMLElement>(".expr-call__input-dot-core")?.getBoundingClientRect()
      ?? input.getBoundingClientRect();
    const keepConnectorsWithNodes = () => {
      if (disposed || revision !== placementRevision) return;
      graph?.refresh();
      placementFrame = placementAnimations.size ? requestAnimationFrame(keepConnectorsWithNodes) : undefined;
    };
    const animate = (element: HTMLElement, keyframes: Keyframe[]) => {
      const animation = element.animate(keyframes, { duration: 320, easing: "cubic-bezier(.22,.8,.25,1)", fill: "none" });
      placementAnimations.add(animation);
      const finish = () => {
        if (disposed || revision !== placementRevision) return;
        placementAnimations.delete(animation);
        if (!placementAnimations.size) placementTarget = undefined;
        graph?.refresh();
      };
      void animation.finished.then(finish, finish);
      return animation;
    };
    const moveSiblings = () => {
      if (!stage || disposed || revision !== placementRevision) return;
      const current = stage.querySelectorAll<HTMLElement>(":scope > .expr-call-graph__sources > .expr-call-graph__source-entry, :scope > .expr-call, :scope > .expr-call-graph__result");
      for (const element of current) {
        if (element === source) continue;
        const previous = before.get(element);
        if (!previous) continue;
        const bounds = element.getBoundingClientRect();
        const x = previous.left - bounds.left;
        const y = previous.top - bounds.top;
        const scaleX = bounds.width ? previous.width / bounds.width : 1;
        const scaleY = bounds.height ? previous.height / bounds.height : 1;
        if (Math.abs(x) > 0.1 || Math.abs(y) > 0.1 || Math.abs(scaleX - 1) > 0.01 || Math.abs(scaleY - 1) > 0.01)
          animate(element, [{ transform: `translate(${x + (previous.width - bounds.width) / 2}px, ${y + (previous.height - bounds.height) / 2}px) scale(${scaleX}, ${scaleY})` }, { transform: "translate(0, 0) scale(1)" }]);
      }
    };
    const foldedAt = (bounds: DOMRect) => ({
      transform: `translate(${dotBounds.left + dotBounds.width / 2 - bounds.left - bounds.width / 2}px, ${dotBounds.top + dotBounds.height / 2 - bounds.top - bounds.height / 2}px) scale(0.02)`, opacity: 0,
    });
    const previousAt = (bounds: DOMRect) => previousSource && previouslyNode ? {
      transform: `translate(${previousSource.left + previousSource.width / 2 - bounds.left - bounds.width / 2}px, ${previousSource.top + previousSource.height / 2 - bounds.top - bounds.height / 2}px) scale(${bounds.width ? previousSource.width / bounds.width : 1}, ${bounds.height ? previousSource.height / bounds.height : 1})`, opacity: 1,
    } : undefined;
    if (next) {
      setNodeChoice(true);
      // The placement event is an imperative browser boundary: commit this
      // same mounted node before measuring its destination, without snapshots.
      flush();
      relocate();
      moveSiblings();
      const bounds = source.getBoundingClientRect();
      animate(source, [previousAt(bounds) ?? foldedAt(bounds), { transform: "translate(0, 0) scale(1)", opacity: 1 }]);
      keepConnectorsWithNodes();
    } else {
      const bounds = source.getBoundingClientRect();
      const shrinking = animate(source, [previousAt(bounds) ?? { transform: "translate(0, 0) scale(1)", opacity: 1 }, foldedAt(bounds)]);
      keepConnectorsWithNodes();
      void shrinking.finished.then(() => {
        if (disposed || revision !== placementRevision) return;
        setNodeChoice(false);
        flush();
        relocate();
        moveSiblings();
        keepConnectorsWithNodes();
      }, () => {});
    }
  }
  onSettled(() => {
    if (!row || !source || !input) return;
    const unregister = graph?.register({ row, source, input, active: () => asNode() && !opened(),
      id: edgeId, color, label: () => (props.edgeLabel ?? presentation()?.edgeLabel)?.(() => open()),
      annotated: () => presentation()?.sourceKind?.() === "computed" || !!presentation()?.graphError?.(),
      ordinal: () => props.ordinal ?? 0,
      name: () => props.parameterName ?? "Input", menuItems, geometry, position, settlePlacement,
      canInsertCall: () => !!presentation()?.canInsertCall?.(),
      onInsertCall: () => presentation()?.onInsertCall?.(), graphError: () => presentation()?.graphError?.(), inspect: open, openMenu: menu.open });
    relocate();
    return () => {
      disposed = true;
      placementRevision++;
      if (placementFrame !== undefined) cancelAnimationFrame(placementFrame);
      for (const animation of placementAnimations) animation.cancel();
      placementAnimations.clear();
      unregister?.();
      // The editor owns this element even while it is displayed in the source
      // row or dialog. Remove it on slot disposal, rather than leaving a ghost.
      source?.remove();
    };
  });
  const open = () => {
    if (!canOpen()) return;
    returnFocus = document.activeElement instanceof HTMLElement ? document.activeElement : undefined;
    setOpened(true);
  };
  const lensSettings = useContext(ExpressionLensSettingsContext);
  const menuItems = (): LocusMenuItem[] => expressionNodeMenu({
    settings: lensSettings,
    lens: { id: "lens", label: "Lens", icon: "panels-top-left", children: [
      { id: "inline", label: "Inline", tooltip: "Show this input inside its function's node", checked: !asNode(), onSelect: () => choosePlacement(false) },
      { id: "node", label: "Node", tooltip: "Show this input as its own node with an arrow", checked: asNode(), onSelect: () => choosePlacement(true) },
    ] },
    edit: { id: "inspect", label: props.readonly ? "Inspect" : "Edit", icon: "pencil", onSelect: open },
    authoring: !props.readonly && presentation()?.canNameResult?.() ? [{ id: "name-result", label: "Name result for following steps…", icon: "tag",
      tooltip: "Give this input result a local name for following steps", onSelect: () => presentation()?.onNameResult?.() }] : [],
    suggestions: suggestionsMenuItem(presentation()?.suggestionOwner?.()),
  });
  return (
    <div class={["expr-call__arg-row", { "expr-call__arg-row--compact": layout.compact(), "expr-call__arg-row--graph": graphMode(), "expr-call__arg-row--node": asNode(), "expr-call__arg-row--single-input": graphMode() && !!graph?.single() }]}
      style={{ "--expr-input-color": color() }} ref={row}
      role={canOpen() && !graphMode() ? "button" : undefined} tabindex={canOpen() && !graphMode() ? 0 : undefined}
      aria-label={graphMode() ? `${parameterText() ?? "argument"} input slot` : canOpen() ? `Open ${parameterText() ?? "argument"}` : undefined}
      data-tooltip={canOpen() && !graphMode() ? `Open ${parameterText() ?? "argument"}` : undefined}
      data-tooltip-code={canOpen() && !graphMode() ? parameterCode() : undefined}
      onClick={event => {
        if ((event.target as HTMLElement).closest("button")) return;
        if (graphMode()) return;
        event.stopPropagation(); open();
      }}
      onKeyDown={event => {
        if (event.target !== event.currentTarget || !canOpen() || (event.key !== "Enter" && event.key !== " ")) return;
        event.preventDefault(); event.stopPropagation(); open();
      }}>
      <div class="expr-call__input corner-menu-host" ref={input} data-expression-graph-input="true"
        data-corner-menu-owner="true" onContextMenu={menu.open}
        hidden={!graphMode()}>
        <button type="button" class={["expr-call__input-dot", { "expr-call__input-dot--connected": asNode(),
          "expr-call__input-dot--empty": props.filled === false }]}
          ref={menu.attach} aria-haspopup="menu" aria-expanded={menu.isOpen() ? "true" : "false"}
          data-input-ordinal={props.ordinal ?? 0} aria-pressed={asNode() ? "true" : "false"}
          aria-label={`${asNode() ? "Collapse" : "Expand"} ${parameterText() ?? "input"}`}
          data-tooltip={`${parameterText() ?? "Input"}${props.filled === false ? ": missing data" : ""}`}
          data-tooltip-code={parameterCode()}
          onPointerEnter={event => { if (event.pointerType !== "touch") { dotPointer = true; updateTrace(); } }}
          onPointerLeave={() => { dotPointer = false; updateTrace(); }}
          // Only keyboard focus traces the edge: a click leaves the dot focused
          // and must not keep its hover highlight once the pointer leaves.
          onFocus={event => { dotFocused = event.currentTarget.matches(":focus-visible"); updateTrace(); }}
          onBlur={() => { dotFocused = false; updateTrace(); }}
          onClick={event => { event.stopPropagation(); choosePlacement(!(placementTarget ?? asNode())); }}
          onKeyDown={event => {
            if (event.key !== "ArrowDown" && event.key !== "ContextMenu" && !(event.shiftKey && event.key === "F10")) return;
            event.preventDefault(); event.stopPropagation();
            const bounds = event.currentTarget.getBoundingClientRect();
            event.currentTarget.dispatchEvent(new MouseEvent("contextmenu", { bubbles: true, cancelable: true,
              clientX: bounds.left, clientY: bounds.bottom + 4 }));
          }}>
          <span class="expr-call__input-dot-core" aria-hidden="true" />
          <Show when={!asNode()}><svg class="expr-call__input-dot-hint" viewBox="0 0 28 28" aria-hidden="true">
            <path d="M 4 25 L 15.9 9.9 L 13.1 7.1 L 27 2.4 L 22.9 16.9 L 20.1 14.1 L 4.8 25.8 Z" />
          </svg></Show>
        </button>
        <CornerMenu menu={menu} items={menuItems()} trigger={false} label={`Input actions for ${parameterText() ?? "input"}`} />
      </div>
      <div class="expr-call__arg-slot" ref={inlineMount}>
        <div class={["expr-call-graph__source-entry", { "expr-call-graph__source-entry--node": asNode() && !opened() }]} ref={source}
          data-expression-graph-movable="input"
          style={{ "--expr-input-color": color() }}
          data-expression-graph-source={asNode() && !opened() ? "true" : undefined}>
          <ExpressionGraphMoveHandle active={asNode() && !opened()} label="Move input node" element={() => source}
            anchor={() => graphDataCard(source)} />
          <CallLayoutContext value={{ compact: () => childLayout() === "compact", layout: childLayout,
            detailed: () => opened() || layout.detailed(), withinCall: !opened() }}>
          <GraphSlotContext value={{ active: () => graphMode() && !opened(), present: setPresentation }}>
            <ExpressionDialogContext value={() => opened() || parentDialog()}>{props.children}</ExpressionDialogContext>
          </GraphSlotContext>
          </CallLayoutContext>
        </div>
      </div>
      <Show when={opened()}>
        <ExpressionArgumentDialog label={props.parameterName ?? "Argument"}
          onClose={() => { setOpened(false); onSettled(() => {
            relocate();
            const target = returnFocus?.isConnected ? returnFocus
              : row?.querySelector<HTMLElement>(".corner-menu-button, .value-hover-preview, button") ?? row;
            target?.focus({ preventScroll: true });
          }); }}>
          <div class="expr-call__dialog-mount" ref={element => { dialogMount = element; onSettled(relocate); }} />
        </ExpressionArgumentDialog>
      </Show>
      <Show when={props.parameterName !== undefined && props.partialActions !== false}>
        <button
          type="button"
          class="expr-call__partial-btn"
          disabled={!!props.readonly || !props.onOpen}
          onClick={() => { if (!props.readonly) props.onOpen?.(); }}
          data-tooltip={`Open ${parameterText()} and trailing parameters`}
          data-tooltip-code={parameterCode()}
        >
          open
        </button>
      </Show>
    </div>
  );
}

/** True inside an expression dialog: the dialog's close (and Escape) is the
 * only close there, so embedded pickers drop their own cancel. */
export const ExpressionDialogContext = createContext<() => boolean>(() => false);

export function ExpressionArgumentDialog(props: { label: DisplayNameInput; onClose: () => void; children: JSX.Element;
  /** "side": a narrower window at the side, so the lens it previews in stays visible. */
  placement?: "side";
  /** "viewer": data inspection. The data card IS the dialog (no titled
   * window around it) over the dimmed lens, closed from the screen's top
   * right corner like an image viewer. Editors keep the titled window. */
  variant?: "viewer" }) {
  let dialog!: HTMLDialogElement;
  onSettled(() => {
    openModalDialog(dialog);
    return () => closeModalDialog(dialog);
  });
  return <Portal><dialog ref={dialog} class={["expr-call-argument-dialog", { "expr-call-argument-dialog--side": props.placement === "side",
    "expr-call-argument-dialog--viewer": props.variant === "viewer" }]} aria-label={displayNameText(props.label)}
    onCancel={event => { event.preventDefault(); props.onClose(); }}
    onClick={event => { event.stopPropagation(); if (event.target === dialog) props.onClose(); }}>
    <Show when={props.variant === "viewer"} fallback={<div class="expr-call-argument-dialog__head"><strong><DisplayNameText name={props.label} /></strong>
      <button type="button" class="expr-call__layout" aria-label="Close argument" onClick={props.onClose}>✕</button>
    </div>}>
      <button type="button" class="expr-call-argument-dialog__viewer-close" aria-label="Close argument" data-tooltip="Close"
        onClick={event => { event.stopPropagation(); props.onClose(); }}><IconX size={20} /></button>
    </Show>
    <div class="expr-call-argument-dialog__body"><ExpressionDialogContext value={() => true}><GraphCollectionContext value={null}>{props.children}</GraphCollectionContext></ExpressionDialogContext></div>
  </dialog></Portal>;
}

/** Naming previews and admissibility come from the existing authoring owner. */
export function ExpressionResultBindingDialog(props: {
  open: boolean;
  name: string;
  onNameChange: (name: string) => void;
  onPreview: () => void;
  onApply?: () => void;
  onClose: () => void;
  error?: string;
  preview?: JSX.Element;
}) {
  const labelId = `expression-result-binding-${createUniqueId()}`;
  return <Show when={props.open}><ExpressionArgumentDialog label="Name result for following steps" onClose={props.onClose}>
    <div class="expr-result-binding">
      <p class="expr-result-binding__help">The name is available inside the outlined expression. It ends at the outline.</p>
      <div><FieldLabelSurface id={labelId} name="Name" />
        <StringInputSurface name="result-binding-name" labelId={labelId} value={props.name} onChange={props.onNameChange} />
      </div>
      <Show when={props.error}>{error => <div class="data-error" role="alert">{error()}</div>}</Show>
      <Show when={props.preview}><div class="expr-result-binding__preview">{props.preview}</div></Show>
      <div class="expr-result-binding__actions">
        <button type="button" class="expr-form__btn" onClick={() => props.onPreview()}>Preview</button>
        <button type="button" class="expr-form__btn" disabled={!props.onApply} onClick={() => props.onApply?.()}>Apply</button>
      </div>
    </div>
  </ExpressionArgumentDialog></Show>;
}

/** Shared pills for saved data, Function, Type and parameter references. */
export function ExpressionReferenceSurface(props: {
  glyph: JSX.Element;
  name: JSX.Element;
  detail?: JSX.Element;
  tooltip: string;
  swapTooltip: string;
  convertTooltip: string;
  convertKind?: "ref" | "param";
  onSwap?: () => void;
  onConvertToLiteral?: () => void;
  readonly?: boolean;
}) {
  return (
    <div class="expr-ref">
      <span class="expr-ref__pill mono" data-tooltip={props.tooltip}>
        <span class="expr-ref__arrow">{props.glyph}</span>
        <span class="expr-ref__name">{props.name}</span>
        <Show when={props.detail !== undefined}>
          <span class="text-muted" style="font-size: 0.7rem; margin-left: 0.25rem">
            {props.detail}
          </span>
        </Show>
      </span>
      <button
        type="button"
        class="expr-literal__nest"
        disabled={!!props.readonly || !props.onSwap}
        onClick={() => { if (!props.readonly) props.onSwap?.(); }}
        data-tooltip={props.swapTooltip}
      >
        ↻ swap
      </button>
      <button
        type="button"
        class="expr-call__convert"
        disabled={!!props.readonly || !props.onConvertToLiteral}
        onClick={() => { if (!props.readonly) props.onConvertToLiteral?.(); }}
        data-tooltip={props.convertTooltip}
      >
        ✕ {props.convertKind ?? "ref"}
      </button>
    </div>
  );
}

/** The sole node-kind router; preparation/choice gates remain with callers. */
export function ExpressionNodeContent(props: {
  kind: "literal" | "call" | "ref" | "param";
  renderLiteral: () => JSX.Element;
  renderCall: () => JSX.Element;
  renderReference: () => JSX.Element;
  renderParameter: () => JSX.Element;
}) {
  return (
    <Switch>
      <Match when={props.kind === "literal"}>{props.renderLiteral()}</Match>
      <Match when={props.kind === "call"}>{props.renderCall()}</Match>
      <Match when={props.kind === "ref"}>{props.renderReference()}</Match>
      <Match when={props.kind === "param"}>{props.renderParameter()}</Match>
    </Switch>
  );
}
