// The linked data of a collection drawn as one graph of the app's own data
// cards: each node is the card the app draws for that value (the caller's
// `card`), the lines are Fenel's links between them, named by the holder's
// field. The drawing machinery is the sets graph's and the Dependencies
// panel's (dependency-graph-drawing.tsx: the node frame and the arrow, the
// lit and dimmed arrows when a card is pointed at, Fit). Where the cards sit
// is linked-data-graph.ts: a two-dimensional layout over the cards' measured
// sizes, computed once and then frozen. A narrow pane stacks the cards, each
// with its links written under it.
// Solid/browser renderer allowance: display only, the same kind as the other graph surfaces.

import { Errored, For, Loading, Show, createEffect, createMemo, createSignal, createUniqueId, onSettled } from "solid-js";
import type { JSX } from "@solidjs/web";
import { GraphArrow, GraphNodeFrame } from "./dependency-graph-drawing";
import { IconByName } from "./icons";
import { CardLoadingIndicator } from "./value-card";
import { ownsDataOpenEvent } from "./data-transfer/events";
import { RecordRowLimitContext } from "./layout-renderer/record-value-rows";
import { linkedGraphFit, linkedGraphLayout, linkedIncomingGroups, linkedRoutes, linkedSiblingGroups, settleOverlaps, type LinkedGraph,
  type LinkedLayout, type LinkedNode, type PlacedCard } from "./linked-data-graph";
import "./linked-data-graph.css";

/** Every card is drawn at this width; its height is its own. */
export const LINKED_CARD_WIDTH = 232;
/** Rows a record's card shows here; the others wait behind "Show N more fields". */
const CARD_ROWS = 2;
/** Below this pane width the cards stack, each with its links written under it. */
const STACK_BELOW = 560;
/** How long after the first layout a card that changes size (its values and
 * pictures arriving) still re-lays the graph out, unless the reader has
 * already scrolled or clicked in it. */
const RELAYOUT_WINDOW = 90000;
const MAX_RELAYOUTS = 4;
/** Cards drawn per turn while the graph prepares. */
const CARDS_PER_TURN = 4;
/** The lines' colour: the Dependencies panel's "refers to" slate (dependency-graph-drawing.tsx). */
const LINE_COLOR = "#64748b";
/** The line weight: between the sets graph's and the Dependencies panel's. */
const LINE_WEIGHT = 1.6;

type Size = { width: number; height: number };

export function LinkedDataGraph(props: {
  graph: LinkedGraph;
  /** The collection's own members: held nearer the middle than what they link to. */
  central: ReadonlySet<string>;
  /** The node's card: the value's own data card, or its name when no value is at hand. */
  card: (node: LinkedNode) => JSX.Element;
  canOpen?: (id: string) => boolean;
  open?: (id: string) => void;
  label?: string;
  /** Each card's kind (its type): holders of one kind reaching one target through one field join into one trunk. */
  kind?: (id: string) => string | undefined;
}) {
  const gradient = createUniqueId();
  const [pane, setPane] = createSignal<Size>({ width: 0, height: 0 });
  const [sizes, setSizes] = createSignal<Readonly<Record<string, Size>>>({});
  const [frozen, setFrozen] = createSignal<LinkedLayout>();
  const [fit, setFit] = createSignal(true);
  const [hovered, setHovered] = createSignal<string>();
  let host!: HTMLDivElement;
  let viewport: HTMLDivElement | undefined;
  onSettled(() => {
    // The free height below the graph's top, to the window's bottom (the pane
    // scrolls no further); the width is the pane's.
    const measure = () => {
      const top = host.getBoundingClientRect().top;
      const height = Math.max(380, Math.floor(window.innerHeight - Math.max(0, top) - 16));
      const width = host.clientWidth;
      const now = pane();
      if (Math.abs(now.width - width) > 2 || Math.abs(now.height - height) > 2) setPane({ width, height });
    };
    const observer = new ResizeObserver(measure);
    observer.observe(host);
    window.addEventListener("resize", measure);
    measure();
    return () => { observer.disconnect(); window.removeEventListener("resize", measure); };
  });
  const stacked = () => pane().width > 0 && pane().width < STACK_BELOW;
  // Each card reports its size; once every card has one and none has changed
  // for a moment, the layout is computed. A card still preparing (its own
  // spinner) can grow later: within the first seconds a real change of size
  // lays the graph out again once more; after that positions stay put and
  // the lines follow each card's live edges.
  let settle: ReturnType<typeof setTimeout> | undefined;
  let giveUp: ReturnType<typeof setTimeout> | undefined;
  let firstLayout: number | undefined;
  // Once the reader scrolls or clicks in the graph, nothing moves under them.
  let touched = false;
  let relayouts = 0;
  // A plain mirror of the reported sizes: several cards report in one turn,
  // before the signal's write lands.
  const measured = new Map<string, Size>();
  let basis = new Map<string, Size>();
  const kindOf = (id: string) => props.kind?.(id);
  let layoutPane: Size | undefined;
  let paneChange: ReturnType<typeof setTimeout> | undefined;
  let overlapCheck: ReturnType<typeof setTimeout> | undefined;
  const layOut = () => {
    clearTimeout(giveUp); clearTimeout(overlapCheck);
    basis = new Map(measured);
    layoutPane = pane();
    firstLayout ??= Date.now();
    const cards = props.graph.nodes.map(node => ({ id: node.id, width: measured.get(node.id)?.width || LINKED_CARD_WIDTH,
      height: measured.get(node.id)?.height || 96 }));
    const view = pane();
    // The targets of one split, and the holders of one join, gather on one side of their card.
    const siblings = [
      ...linkedSiblingGroups(props.graph.edges).filter(group => group.length >= 2)
        .map(group => ({ holder: group[0]!.from, members: group.map(edge => edge.to) })),
      ...linkedIncomingGroups(props.graph.edges, kindOf).filter(group => group.length >= 2)
        .map(group => ({ holder: group[0]!.to, members: group.map(edge => edge.from) })),
    ];
    setFrozen(linkedGraphLayout(cards, props.graph.edges, { aspect: view.height > 0 ? view.width / view.height : 1.6,
      central: props.central, siblings }));
  };
  const report = (id: string, size: Size) => {
    if (!(size.width > 0) || !(size.height > 0)) return;
    const known = measured.get(id);
    if (known && Math.abs(known.width - size.width) < 1 && Math.abs(known.height - size.height) < 1) return;
    measured.set(id, size);
    setSizes(Object.fromEntries(measured));
    if (firstLayout !== undefined) {
      const was = basis.get(id);
      // Only a card that GREW lays the graph out again, a few times at most:
      // sizes that come and go can never keep the drawing moving.
      if (!touched && relayouts < MAX_RELAYOUTS && Date.now() - firstLayout < RELAYOUT_WINDOW
        && (!was || size.height - was.height > 10)) {
        clearTimeout(settle); settle = setTimeout(() => { relayouts++; layOut(); }, 900);
        return;
      }
      // Otherwise the drawing stays where it is and only what the card now
      // overlaps moves aside (no card ever sits on another).
      clearTimeout(overlapCheck); overlapCheck = setTimeout(settleInPlace, 300);
      return;
    }
    giveUp ??= setTimeout(layOut, 4000);
    clearTimeout(settle);
    if (props.graph.nodes.every(node => measured.has(node.id))) settle = setTimeout(layOut, 450);
  };
  const settleInPlace = () => {
    const layout = frozen();
    if (!layout) return;
    const cards = settleOverlaps(layout.cards.map(card => ({ ...card, ...(measured.get(card.id) ?? {}) })));
    const left = Math.min(...cards.map(card => card.x)), top = Math.min(...cards.map(card => card.y));
    const shifted = cards.map(card => ({ ...card, x: card.x - left + 24, y: card.y - top + 24 }));
    const moved = shifted.some((card, index) => card.x !== layout.cards[index]!.x || card.y !== layout.cards[index]!.y);
    if (!moved && shifted.every(card => card.x + card.width + 24 <= layout.width && card.y + card.height + 24 <= layout.height)) return;
    setFrozen({ cards: shifted, width: Math.max(...shifted.map(card => card.x + card.width)) + 24,
      height: Math.max(...shifted.map(card => card.y + card.height)) + 24 });
  };
  // The layout follows the pane: a lens opened or closed beside the graph, or
  // the window resized, lays it out again for the new shape, once the size has
  // settled (only a real change of size; the layout itself never changes it).
  createEffect(() => { const now = pane(); return `${now.width}x${now.height}`; }, () => {
    const now = pane();
    if (firstLayout === undefined || !layoutPane) return;
    if (Math.abs(now.width - layoutPane.width) <= 24 && Math.abs(now.height - layoutPane.height) <= 24) return;
    clearTimeout(paneChange);
    paneChange = setTimeout(() => {
      const settled = pane();
      if (layoutPane && Math.abs(settled.width - layoutPane.width) <= 24 && Math.abs(settled.height - layoutPane.height) <= 24) return;
      if (settled.width >= STACK_BELOW) layOut();
    }, 400);
  });
  // Cards are drawn a few at a time, each batch in its own turn, so the page
  // keeps answering while two dozen data cards render.
  const [drawnCount, setDrawnCount] = createSignal(0);
  onSettled(() => {
    let count = 0, stopped = false;
    const step = () => {
      if (stopped) return;
      count = Math.min(props.graph.nodes.length, count + CARDS_PER_TURN);
      setDrawnCount(count);
      if (count < props.graph.nodes.length) setTimeout(step, 0);
    };
    setTimeout(step, 0);
    return () => { stopped = true; };
  });
  const drawnNodes = createMemo(() => props.graph.nodes.slice(0, drawnCount()));
  onSettled(() => () => { clearTimeout(settle); clearTimeout(giveUp); clearTimeout(paneChange); clearTimeout(overlapCheck); });
  // Positions are frozen; sizes stay live (a card that grows keeps its place).
  const placed = createMemo(() => {
    const layout = frozen();
    if (!layout) return undefined;
    const live = sizes();
    const cards = new Map<string, PlacedCard>(layout.cards.map(card => [card.id, { ...card, ...(live[card.id] ?? {}) }]));
    return { layout, cards };
  });
  const scale = () => { const shown = placed(); return shown && fit() ? linkedGraphFit(shown.layout, { width: pane().width - 2, height: pane().height - 2 }) : 1; };
  // Before the layout exists the cards are drawn once, hidden, in a plain grid
  // where they measure themselves; the layout then only moves them (each card
  // renders once: no second copy for measuring).
  const provisional = createMemo(() => {
    const columns = Math.max(1, Math.floor(Math.max(pane().width, LINKED_CARD_WIDTH) / (LINKED_CARD_WIDTH + 24)));
    const cards = new Map<string, PlacedCard>(props.graph.nodes.map((node, index) => [node.id, { id: node.id,
      x: (index % columns) * (LINKED_CARD_WIDTH + 24), y: Math.floor(index / columns) * 300, width: LINKED_CARD_WIDTH, height: 96 }]));
    return { layout: { cards: [...cards.values()], width: columns * (LINKED_CARD_WIDTH + 24),
      height: Math.ceil(props.graph.nodes.length / columns) * 300 } as LinkedLayout, cards };
  });
  const geometry = () => placed() ?? provisional();
  // A link is (holder, field, target): one stem per holder and field that
  // splits, one trunk per target, field and kind that joins (Rom, 00:28).
  const routes = createMemo(() => { const shown = placed(); return shown ? linkedRoutes(props.graph.edges, shown.cards, kindOf) : undefined; });
  const emphasis = (from: readonly string[], to: readonly string[]) => {
    const at = hovered();
    return at === undefined ? undefined : from.includes(at) || to.includes(at) ? "lit" as const : "dim" as const;
  };
  const opens = (id: string) => props.canOpen?.(id) === true;
  const onCardClick = (id: string, event: MouseEvent) => {
    if (!opens(id) || !ownsDataOpenEvent(event, event.currentTarget as Element)) return;
    event.stopPropagation();
    props.open?.(id);
  };
  const cardBody = (node: LinkedNode, onSize?: (size: Size) => void) => {
    let element!: HTMLDivElement;
    onSettled(() => {
      if (!onSize) return;
      const observer = new ResizeObserver(() => onSize({ width: element.offsetWidth, height: element.offsetHeight }));
      observer.observe(element);
      onSize({ width: element.offsetWidth, height: element.offsetHeight });
      return () => observer.disconnect();
    });
    return <div ref={el => { element = el; }} class="linked-graph__card" data-opens={opens(node.id) ? "true" : undefined}
      tabindex={opens(node.id) ? 0 : undefined}
      onClick={event => onCardClick(node.id, event)}
      onKeyDown={event => {
        if (event.target !== event.currentTarget || (event.key !== "Enter" && event.key !== " ") || !opens(node.id)) return;
        event.preventDefault(); props.open?.(node.id);
      }}>
      {/* A card that is still preparing (or fails) keeps its own place: it never holds the whole graph. */}
      <Errored fallback={() => <span class="linked-graph__fallback">{node.label}</span>}>
        <Loading fallback={<CardLoadingIndicator />}>
          <RecordRowLimitContext value={{ rows: CARD_ROWS }}>{props.card(node)}</RecordRowLimitContext>
        </Loading>
      </Errored>
    </div>;
  };
  // The phone: the cards one under the other, each with its links in words.
  const linksOf = (id: string) => {
    const groups = new Map<string, LinkedNode[]>();
    for (const edge of props.graph.edges) {
      if (edge.from !== id) continue;
      const target = props.graph.nodes.find(node => node.id === edge.to);
      if (!target) continue;
      const name = edge.labels.join(", ") || "Links to";
      groups.set(name, [...(groups.get(name) ?? []), target]);
    }
    return [...groups.entries()].map(([name, targets]) => ({ name, targets }));
  };
  return <div ref={host} class="linked-graph" data-stacked={stacked() ? "true" : undefined}
    role="group" aria-label={props.label ?? "Linked data"}>
    <Show when={!stacked()} fallback={<ol class="linked-graph__stack">
      <For each={props.graph.nodes}>{node => <li class="linked-graph__stack-item" data-linked-node={node.id}>
        {cardBody(node)}
        <For each={linksOf(node.id)}>{group => <p class="linked-graph__stack-links">
          <span class="linked-graph__stack-relation">{group.name}</span>{" "}
          <For each={group.targets}>{(target, index) => <>
            <Show when={index() > 0}>{", "}</Show>
            <Show when={opens(target.id)} fallback={<span>{target.label}</span>}>
              <button type="button" class="linked-graph__stack-target" onClick={() => props.open?.(target.id)}>{target.label}</button>
            </Show>
          </>}</For>
        </p>}</For>
      </li>}</For>
    </ol>}>
      <div class="linked-graph__viewport" ref={element => { viewport = element; }}
        onPointerDown={() => { touched = true; }} onWheel={() => { touched = true; }}
        style={{ height: `${pane().height}px` }} data-fit={fit() ? "true" : undefined}>
        <div class="linked-graph__sizer" style={{ width: `${Math.ceil(geometry().layout.width * scale())}px`,
          height: `${Math.ceil(geometry().layout.height * scale())}px`, visibility: placed() ? undefined : "hidden" }}
          aria-hidden={placed() ? undefined : "true"}>
          <div class="dependency-graph-canvas linked-graph__canvas"
            style={{ width: `${geometry().layout.width}px`, height: `${geometry().layout.height}px`,
              ...(scale() < 1 ? { transform: `scale(${scale()})`, "transform-origin": "0 0" } : {}) }}>
            <Show when={routes()}>{drawn => <svg class="dependency-graph" width={geometry().layout.width} height={geometry().layout.height}
              viewBox={`0 0 ${geometry().layout.width} ${geometry().layout.height}`} aria-hidden="true">
              <For each={drawn().stems}>{stem => <g class="dependency-graph__arrow linked-graph__stem" data-emphasis={emphasis([stem.from], stem.to)}
                style={{ color: LINE_COLOR }}>
                <path d={`M ${stem.points[0].x} ${stem.points[0].y} L ${stem.points[1].x} ${stem.points[1].y}`} fill="none" stroke="currentColor"
                  stroke-width={LINE_WEIGHT} stroke-linecap="round" />
                <circle cx={stem.points[1].x} cy={stem.points[1].y} r={LINE_WEIGHT + 1.2} fill="currentColor" />
              </g>}</For>
              <For each={drawn().segments}>{(segment, index) => <Show when={segment.head} fallback={
                <g class="dependency-graph__arrow linked-graph__segment" data-emphasis={emphasis([segment.edge.from], [segment.edge.to])} style={{ color: LINE_COLOR }}>
                  <path d={`M ${segment.points[0].x} ${segment.points[0].y} L ${segment.points[1].x} ${segment.points[1].y}`} fill="none"
                    stroke="currentColor" stroke-width={LINE_WEIGHT} stroke-linecap="round" />
                </g>}>
                <GraphArrow id={`${gradient}-s${index()}`} points={segment.points} relation="reference"
                  emphasis={emphasis([segment.edge.from], [segment.edge.to])} weight={LINE_WEIGHT} solid />
              </Show>}</For>
              <For each={drawn().trunks}>{(trunk, index) => <g class="linked-graph__trunk">
                <GraphArrow id={`${gradient}-t${index()}`} points={trunk.points} relation="reference"
                  emphasis={emphasis(trunk.from, [trunk.to])} weight={LINE_WEIGHT} solid />
                <circle class="dependency-graph__arrow" data-emphasis={emphasis(trunk.from, [trunk.to])} cx={trunk.points[0].x} cy={trunk.points[0].y}
                  r={LINE_WEIGHT + 1.2} fill={LINE_COLOR} />
              </g>}</For>
              <For each={drawn().labels}>{label => <text class="linked-graph__label" x={label.at.x} y={label.at.y} text-anchor="middle"
                paint-order="stroke" stroke="#ffffff" stroke-width="4" stroke-linejoin="round"
                data-emphasis={emphasis(label.from, label.to)}>{label.text}</text>}</For>
            </svg>}</Show>
            <For each={drawnNodes()}>{node => <Show when={geometry().cards.get(node.id)}>{card =>
              <GraphNodeFrame id={node.id} label={node.label} opens={opens(node.id)}
                style={{ left: `${card().x}px`, top: `${card().y}px`, width: `${LINKED_CARD_WIDTH}px` }}
                data={{ "data-linked-node": node.id, "data-central": props.central.has(node.id) ? "true" : undefined,
                  // The whole card is readable: no name tooltip over it.
                  "data-tooltip": undefined }}
                onPointerEnter={() => setHovered(node.id)} onPointerLeave={() => setHovered(undefined)}>
                {cardBody(node, size => report(node.id, size))}
              </GraphNodeFrame>}</Show>}</For>
          </div>
        </div>
        <Show when={!placed()}><div class="linked-graph__preparing"><CardLoadingIndicator /></div></Show>
        <Show when={placed()}>
          <button type="button" class="linked-graph__fit" aria-pressed={fit() ? "true" : "false"}
            data-tooltip={fit() ? "Show at actual size" : "Fit the whole graph"}
            onClick={() => { setFit(value => !value); if (viewport) { viewport.scrollLeft = 0; viewport.scrollTop = 0; } }}>
            <IconByName name={fit() ? "maximize" : "minimize"} size={14} /><span>{fit() ? "Actual size" : "Fit"}</span>
          </button>
        </Show>
      </div>
    </Show>
  </div>;
}
