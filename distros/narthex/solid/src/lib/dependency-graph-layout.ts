/** Where the Dependencies panel draws its graph. A pure function of the graph
 * data (Fenel built it; nothing here decides a link) and the space available:
 *
 * - Columns by SIGNED DISTANCE from the focus: data it is made from on the
 *   left (two steps upstream is two columns left), data that uses it on the
 *   right. Each side follows its own direction only: what else a user of the
 *   focus is made of (the other parts of a shared card) is not a dependency
 *   of the focus; it is counted on the focus column, never drawn. A cycle
 *   keeps the first distance it was reached at.
 * - Each column shows at most `cap` cards; the rest is one exact "+k more".
 * - Edges are routed from card sides through the free gutters between columns
 *   and the free gaps between cards: no segment ever passes behind a card (a
 *   straight line through the focus card once read as a false link). */

export type LayoutGraphNode = { id: string; label: string };
export type LayoutGraphEdge = { from: string; to: string; labels?: readonly string[] };
export type LayoutGraph = { focus: string; nodes: readonly LayoutGraphNode[]; edges: readonly LayoutGraphEdge[] };

export type PlacedNode = { id: string; label: string; nodeIndex: number; column: number; focus: boolean;
  x: number; y: number; width: number; height: number };
export type MoreChip = { column: number; count: number; x: number; y: number; width: number; height: number;
  /** Set when the counted data lies in columns dropped for room: the way it lies. */
  direction?: "left" | "right" };
export type RoutedEdge = { from: string; to: string; edgeIndex: number; labels: string[];
  points: Array<{ x: number; y: number }>; path: string;
  /** Where the field name is written: just before the arrow, above the line. */
  label?: { text: string; x: number; y: number } };
/** The made-from links of the focus grouped by the field that holds them:
 * one quiet heading above the group's cards, one arrow into the focus. A
 * node held by several fields is drawn in its first group; the others count
 * it in `also`. `label` is "" for an unnamed group (no heading). */
export type DependencyGroup = { id: string; label: string; ids: string[]; also: number;
  x: number; y: number; width: number; height: number;
  /** The bracket on the cards' right side that the group's arrow leaves from. */
  bracket: { x: number; y1: number; y2: number } };
export type DependencyLayout = { nodes: PlacedNode[]; more: MoreChip[]; edges: RoutedEdge[]; width: number; height: number;
  groups: DependencyGroup[];
  focusColumn: { x: number; width: number };
  /** Where a control under the graph goes (asked with `footer`): under the focus column. */
  footer?: { x: number; y: number; width: number; height: number } };

export type DependencyLayoutOptions = { width: number; cap?: number; cardHeight?: number; minCardWidth?: number; maxCardWidth?: number;
  /** The free height the graph may fill: a small graph is centred in it, never squeezed into a strip. */
  height?: number;
  /** Height of a control drawn right under the graph; graph and control are centred together. */
  footer?: number;
  /** Columns the reader expanded with their "+k more" chip: every card shown. */
  expanded?: readonly number[] };

export const DEPENDENCY_GRAPH_CAP = 8;
export const DEPENDENCY_ROWS_CAP = 6;

const ROW_GAP = 22;
/** Clear of the viewport's 18 px edge fade and the panel edge. */
const SAFE_X = 34;
const PAD_Y = 26;
const INNER_GUTTER = 46;
const MAX_DEPTH = 6;
const FOOTER_GAP = 14;
const CHIP_HEIGHT = 24;
const HEADING_HEIGHT = 16;
const HEADING_GAP = 6;
/** More links than this into one card side share one arrow, even unnamed. */
const MAX_ARROWS_INTO_CARD = 7;
const LANE_SPACING = 9;
const LABEL_CHAR = 6.2;
/** The geometry every column-drawn graph shares (gaps, margins, lane spacing). */
export const GRAPH_GEOMETRY = { rowGap: ROW_GAP, padY: PAD_Y, safeX: SAFE_X, laneSpacing: LANE_SPACING, cardHeight: 52, cardWidth: 180 } as const;

/** Columns by signed distance; first assignment wins (breadth-first). */
function assignColumns(graph: LayoutGraph): { column: Map<string, number>; order: string[]; parentEdge: Map<string, number>; others: number } {
  const ids = new Set(graph.nodes.map(node => node.id));
  const touching = new Map<string, number[]>();
  graph.edges.forEach((edge, index) => {
    if (!ids.has(edge.from) || !ids.has(edge.to) || edge.from === edge.to) return;
    for (const end of [edge.from, edge.to]) { const list = touching.get(end) ?? []; list.push(index); touching.set(end, list); }
  });
  const column = new Map<string, number>();
  const parentEdge = new Map<string, number>();
  const order: string[] = [];
  const visit = (start: string) => {
    if (column.has(start)) return;
    column.set(start, 0); order.push(start);
    const queue = [start];
    for (let head = 0; head < queue.length; head++) {
      const at = queue[head]!;
      const here = column.get(at)!;
      for (const index of touching.get(at) ?? []) {
        const edge = graph.edges[index]!;
        // An arrow points from the data being used to the data that uses it.
        const [other, step] = edge.from === at ? [edge.to, 1] : [edge.from, -1];
        // Upstream nodes walk on upstream, downstream nodes downstream.
        if (here !== 0 && Math.sign(step) !== Math.sign(here)) continue;
        if (column.has(other)) continue;
        column.set(other, here + step); parentEdge.set(other, index); order.push(other); queue.push(other);
      }
    }
  };
  if (ids.has(graph.focus)) visit(graph.focus);
  else if (graph.nodes[0]) visit(graph.nodes[0].id);
  // Within one side, data that uses another sits further out than it (Fen uses
  // Fenel, so Fen is right of Fenel even when both are one step from the focus).
  for (let round = 0; round < graph.nodes.length; round++) {
    let changed = false;
    for (const edge of graph.edges) {
      const from = column.get(edge.from), to = column.get(edge.to);
      if (from === undefined || to === undefined || edge.from === edge.to) continue;
      if (from > 0 && to > 0 && to <= from && from < MAX_DEPTH) { column.set(edge.to, from + 1); changed = true; }
      else if (from < 0 && to < 0 && from >= to && to > -MAX_DEPTH) { column.set(edge.from, to - 1); changed = true; }
    }
    if (!changed) break;
  }
  // A cycle can push nodes far out and leave empty columns between: renumber
  // each side so its columns are contiguous, keeping their order.
  for (const sign of [-1, 1]) {
    const used = [...new Set([...column.values()].filter(at => Math.sign(at) === sign))].sort((a, b) => Math.abs(a) - Math.abs(b));
    const renumber = new Map(used.map((at, index) => [at, sign * (index + 1)] as const));
    for (const [id, at] of column) if (renumber.has(at)) column.set(id, renumber.get(at)!);
  }
  const others = graph.nodes.filter(node => !column.has(node.id)).length;
  return { column, order, parentEdge, others };
}

const segmentLength = (a: { x: number; y: number }, b: { x: number; y: number }) => Math.abs(a.x - b.x) + Math.abs(a.y - b.y);

/** An axis-aligned polyline with small rounded corners. */
export function roundedPath(points: ReadonlyArray<{ x: number; y: number }>, radius = 6): string {
  const clean = points.filter((point, index) => index === 0 || segmentLength(point, points[index - 1]!) > 0.01);
  if (clean.length === 0) return "";
  let d = `M ${clean[0]!.x} ${clean[0]!.y}`;
  for (let index = 1; index < clean.length - 1; index++) {
    const [previous, corner, next] = [clean[index - 1]!, clean[index]!, clean[index + 1]!];
    const r = Math.min(radius, segmentLength(previous, corner) / 2, segmentLength(corner, next) / 2);
    const toward = (from: { x: number; y: number }, to: { x: number; y: number }, distance: number) => {
      const length = segmentLength(from, to) || 1;
      return { x: from.x + (to.x - from.x) / length * distance, y: from.y + (to.y - from.y) / length * distance };
    };
    const before = toward(corner, previous, r), after = toward(corner, next, r);
    d += ` L ${before.x} ${before.y} Q ${corner.x} ${corner.y} ${after.x} ${after.y}`;
  }
  const last = clean[clean.length - 1]!;
  return clean.length > 1 ? `${d} L ${last.x} ${last.y}` : d;
}

const labelsOf = (edge: LayoutGraphEdge) => Array.isArray(edge.labels) ? edge.labels.filter(label => typeof label === "string" && label !== "") : [];

/** Which gutters each drawn edge runs through, and how wide each gutter is.
 * Shared by every graph drawn in columns (the Dependencies panel, the species
 * sets graph): gutter g lies right of column g (g = first - 1 is the left
 * margin); each edge takes its own lane in every gutter it crosses. */
export type GutterPlan = {
  plan: Array<{ edge: LayoutGraphEdge; edgeIndex: number; gutters: number[] }>;
  use: Map<number, number[]>;
  width: (g: number) => number;
};

export function planGutters(drawn: ReadonlyArray<{ edge: LayoutGraphEdge; edgeIndex: number }>, column: ReadonlyMap<string, number>,
  first: number, last: number, options: { maxInnerGutter?: number } = {}): GutterPlan {
  const maxInner = options.maxInnerGutter ?? 150;
  const use = new Map<number, number[]>();
  const gutterLabel = new Map<number, number>();
  const plan = drawn.map(({ edge, edgeIndex }) => {
    const from = column.get(edge.from)!, to = column.get(edge.to)!;
    const gutters: number[] = [];
    if (to > from) for (let g = from; g < to; g++) gutters.push(g);
    else if (to < from) for (let g = from - 1; g >= to; g--) gutters.push(g);
    else gutters.push(from);
    for (const g of gutters) { const list = use.get(g) ?? []; list.push(edgeIndex); use.set(g, list); }
    const entry = gutters[gutters.length - 1]!;
    const text = labelsOf(edge).join(", ");
    if (text) gutterLabel.set(entry, Math.max(gutterLabel.get(entry) ?? 0, text.length * LABEL_CHAR + 22));
    return { edge, edgeIndex, gutters };
  });
  const width = (g: number) => {
    const lanes = use.get(g)?.length ?? 0;
    const outer = g < first || g >= last;
    if (outer) return Math.min(90, Math.max(SAFE_X, SAFE_X + lanes * LANE_SPACING));
    return Math.min(maxInner, Math.max(INNER_GUTTER, 20 + lanes * LANE_SPACING, gutterLabel.get(g) ?? 0));
  };
  return { plan, use, width };
}

/** Routes every planned edge from a card side through its gutter lanes and
 * the free gaps between cards: no segment passes behind a card. Each card
 * side spreads the edges that meet it, in plan order.
 *
 * Written along a MAIN axis (the one the columns follow) and a CROSS axis.
 * "horizontal" (the default): columns run left to right, main = x. "vertical":
 * the columns are rows running top to bottom, main = y; the router works on
 * the transposed drawing and transposes its points back. `placed` is always
 * in real coordinates; `columnX` is each column's main-axis start,
 * `columnSize` its main-axis extent (default `cardWidth`), `columnBoxes` the
 * cross-axis extents of what each column holds (`y`/`height` read as x/width
 * when vertical), `height` the drawing's cross-axis extent. */
export function routeEdges(input: { gutters: GutterPlan; column: ReadonlyMap<string, number>;
  placed: ReadonlyMap<string, { x: number; y: number; width: number; height: number }>;
  columnBoxes: ReadonlyMap<number, ReadonlyArray<{ y: number; height: number }>>;
  columnX: ReadonlyMap<number, number>; cardWidth: number; first: number; last: number; height: number;
  columnSize?: (at: number) => number; orientation?: "horizontal" | "vertical" }): RoutedEdge[] {
  const { gutters: { plan, use: gutterUse, width: gutterWidth }, column, columnBoxes, columnX, cardWidth, first, last, height } = input;
  const vertical = input.orientation === "vertical";
  const columnSize = input.columnSize ?? (() => cardWidth);
  const placed: ReadonlyMap<string, { x: number; y: number; width: number; height: number }> = vertical
    ? new Map([...input.placed].map(([id, box]) => [id, { x: box.y, y: box.x, width: box.height, height: box.width }] as const))
    : input.placed;
  const real = (point: { x: number; y: number }) => vertical ? { x: point.y, y: point.x } : point;
  // Ports: each card side spreads the edges that meet it.
  type Side = "left" | "right";
  const ports = new Map<string, number[]>();
  const portKey = (id: string, side: Side) => `${side}:${id}`;
  const sides = plan.map(({ edge, edgeIndex }) => {
    const from = column.get(edge.from)!, to = column.get(edge.to)!;
    const out: Side = to >= from ? "right" : "left";
    const into: Side = to > from ? "left" : "right";
    for (const key of [portKey(edge.from, out), portKey(edge.to, into)]) { const list = ports.get(key) ?? []; list.push(edgeIndex); ports.set(key, list); }
    return { out, into };
  });
  const portY = (id: string, side: Side, edgeIndex: number) => {
    const card = placed.get(id)!;
    const list = ports.get(portKey(id, side)) ?? [edgeIndex];
    const k = list.indexOf(edgeIndex);
    return card.y + card.height * (k + 1) / (list.length + 1);
  };
  const laneX = (g: number, edgeIndex: number) => {
    const list = gutterUse.get(g) ?? [edgeIndex];
    const k = list.indexOf(edgeIndex);
    const left = g < first ? columnX.get(first)! - gutterWidth(g) : columnX.get(g)! + columnSize(g);
    const widthHere = gutterWidth(g);
    // Outer margins hug the card they serve; inner gutters spread evenly.
    if (g < first) return columnX.get(first)! - 14 - k * LANE_SPACING;
    if (g >= last) return left + 14 + k * LANE_SPACING;
    return left + widthHere * (k + 1) / (list.length + 1);
  };
  /** The free horizontal channel through a column nearest to `want`. */
  const channelY = (at: number, want: number) => {
    const boxes = columnBoxes.get(at) ?? [];
    if (!boxes.length) return want;
    const candidates = [Math.max(4, boxes[0]!.y - ROW_GAP / 2)];
    for (let index = 0; index < boxes.length - 1; index++) candidates.push(boxes[index]!.y + boxes[index]!.height + ROW_GAP / 2);
    const end = boxes[boxes.length - 1]!;
    candidates.push(Math.min(height - 4, end.y + end.height + ROW_GAP / 2));
    return candidates.reduce((best, y) => Math.abs(y - want) < Math.abs(best - want) ? y : best);
  };

  return plan.map(({ edge, edgeIndex, gutters }, position) => {
    const source = placed.get(edge.from)!, target = placed.get(edge.to)!;
    const { out, into } = sides[position]!;
    const startY = portY(edge.from, out, edgeIndex), endY = portY(edge.to, into, edgeIndex);
    const points = [{ x: out === "right" ? source.x + source.width : source.x, y: startY }];
    let y = startY;
    gutters.forEach((g, step) => {
      const x = laneX(g, edgeIndex);
      points.push({ x, y });
      const isLast = step === gutters.length - 1;
      // Cross the next column through a free gap, nearest the target's port.
      const nextColumn = column.get(edge.to)! > column.get(edge.from)! ? g + 1 : g;
      const crossing = isLast ? endY : channelY(nextColumn, endY);
      points.push({ x, y: crossing });
      y = crossing;
    });
    const end = { x: into === "left" ? target.x : target.x + target.width, y: endY };
    points.push(end);
    const text = labelsOf(edge).join(", ");
    const label = text ? into === "left" ? { text, x: end.x - 14, y: endY - 8 } : { text, x: end.x + 14, y: endY - 8 } : undefined;
    const drawn = points.map(real);
    return { from: edge.from, to: edge.to, edgeIndex, labels: labelsOf(edge), points: drawn, path: roundedPath(drawn),
      ...(label ? { label: { text: label.text, ...real(label) } } : {}) };
  });
}

export function dependencyGraphLayout(graph: LayoutGraph, options: DependencyLayoutOptions): DependencyLayout {
  const cardHeight = options.cardHeight ?? 52;
  const footer = options.footer && options.footer > 0 ? FOOTER_GAP + options.footer : 0;
  // As many cards per column as the panel's height holds (at least 4).
  const cap = Math.max(1, options.cap ?? (options.height
    ? Math.max(4, Math.floor((options.height - 2 * PAD_Y - footer - CHIP_HEIGHT - ROW_GAP + ROW_GAP) / (cardHeight + ROW_GAP)))
    : DEPENDENCY_GRAPH_CAP));
  const expanded = new Set(options.expanded ?? []);
  const minCard = options.minCardWidth ?? 150, maxCard = options.maxCardWidth ?? 180;
  const { column, order } = assignColumns(graph);
  const indexOf = new Map(graph.nodes.map((node, index) => [node.id, index] as const));
  const byColumn = new Map<number, string[]>();
  for (const id of order) { const at = column.get(id)!; const list = byColumn.get(at) ?? []; list.push(id); byColumn.set(at, list); }
  let columns = [...byColumn.keys()].sort((a, b) => a - b);
  if (!columns.includes(0)) columns.push(0), columns.sort((a, b) => a - b);
  // Fewer columns rather than narrower cards: the farthest column goes first
  // (the smaller one on a tie, then the right one); its data is counted on
  // the nearest column kept on that side. The focus and its direct links stay.
  const folded = new Map<number, number>();
  const needs = (count: number) => 2 * SAFE_X + count * minCard + (count - 1) * INNER_GUTTER;
  // The focus's direct links are never folded away.
  const direct = new Set(graph.edges.flatMap(edge => edge.from === graph.focus ? [edge.to] : edge.to === graph.focus ? [edge.from] : []));
  while (needs(columns.length) > options.width) {
    const left = columns[0]!, right = columns[columns.length - 1]!;
    const size = (at: number) => (byColumn.get(at)?.length ?? 0) + (folded.get(at) ?? 0);
    const candidates = [left, right].filter(at => Math.abs(at) >= 2 && !(byColumn.get(at) ?? []).some(id => direct.has(id)));
    if (!candidates.length) break;
    const drop = candidates.sort((a, b) => Math.abs(b) - Math.abs(a) || size(a) - size(b) || b - a)[0]!;
    const into = drop - Math.sign(drop);
    folded.set(into, (folded.get(into) ?? 0) + size(drop));
    byColumn.delete(drop); folded.delete(drop);
    columns = columns.filter(at => at !== drop);
  }

  // Group the focus's made-from column by the field that holds each link.
  const fieldsInto = new Map<string, string[]>();
  for (const edge of graph.edges) {
    if (edge.to !== graph.focus || column.get(edge.from) !== -1) continue;
    fieldsInto.set(edge.from, [...(fieldsInto.get(edge.from) ?? []), ...labelsOf(edge)]);
  }
  const named = [...fieldsInto.values()].some(labels => labels.length > 0);
  const leftIds = byColumn.get(-1) ?? [];
  let fieldGroups: Array<{ label: string; ids: string[]; also: number }> = [];
  if (columns.includes(-1) && leftIds.length && (named || leftIds.length > MAX_ARROWS_INTO_CARD)) {
    const byLabel = new Map<string, { label: string; ids: string[]; also: number }>();
    for (const id of leftIds) {
      const labels = named ? [...new Set(fieldsInto.get(id) ?? [])] : [];
      (labels.length ? labels : [""]).forEach((label, index) => {
        const group = byLabel.get(label) ?? { label, ids: [], also: 0 };
        byLabel.set(label, group);
        if (index === 0) group.ids.push(id); else group.also++;
      });
    }
    fieldGroups = [...byLabel.values()].filter(group => group.ids.length > 0);
    byColumn.set(-1, fieldGroups.flatMap(group => group.ids));
  }

  // Cap each column; the focus is always shown, in the middle of its column.
  const shown = new Map<number, string[]>();
  const hidden = new Map<number, number>();
  for (const at of columns) {
    const all = byColumn.get(at) ?? [];
    if (at === 0 && all.includes(graph.focus)) {
      const others = all.filter(id => id !== graph.focus);
      const kept = others.slice(0, cap - 1);
      kept.splice(Math.floor(kept.length / 2), 0, graph.focus);
      shown.set(at, kept); hidden.set(at, others.length - (kept.length - 1));
    } else {
      const limit = expanded.has(at) ? all.length : cap;
      shown.set(at, all.slice(0, limit)); hidden.set(at, Math.max(0, all.length - limit));
    }
  }
  const shownLeft = new Set(shown.get(-1) ?? []);
  const visibleGroups = fieldGroups.map((group, index) => ({ ...group, id: `group:${index}`, ids: group.ids.filter(id => shownLeft.has(id)) }))
    .filter(group => group.ids.length > 0);
  const grouped = new Set(visibleGroups.flatMap(group => group.ids));
  // Data with no link to the focus in either direction (the other parts of a
  // card that also holds the focus) is not a dependency: neither drawn nor counted.
  const visible = new Set([...shown.values()].flat());

  // Edges between drawn nodes, and which gutter each one runs through.
  const drawn = [...graph.edges.map((edge, edgeIndex) => ({ edge, edgeIndex }))
    .filter(({ edge }) => edge.from !== edge.to && visible.has(edge.from) && visible.has(edge.to)
      && !(edge.to === graph.focus && grouped.has(edge.from))),
    ...visibleGroups.map((group, index) => ({ edge: { from: group.id, to: graph.focus } as LayoutGraphEdge, edgeIndex: graph.edges.length + index }))];
  const routeColumn = new Map(column);
  for (const group of visibleGroups) routeColumn.set(group.id, -1);
  const first = columns[0]!, last = columns[columns.length - 1]!;
  const gutters = planGutters(drawn, routeColumn, first, last);
  const gutterWidth = gutters.width;
  const span = last - first + 1;
  const innerGutters = Array.from({ length: span - 1 }, (_, index) => gutterWidth(first + index)).reduce((sum, width) => sum + width, 0);
  const leftMargin = gutterWidth(first - 1), rightMargin = gutterWidth(last);
  const fit = (options.width - leftMargin - rightMargin - innerGutters) / span;
  // Only the focus and its direct links can be left too wide: those cards
  // narrow to fit, never below a readable two-line name.
  const cardWidth = Math.round(Math.max(Math.min(minCard, 120), Math.min(maxCard, fit)));

  const columnX = new Map<number, number>();
  let cursor = leftMargin;
  for (let at = first; at <= last; at++) { columnX.set(at, cursor); cursor += cardWidth + (at < last ? gutterWidth(at) : 0); }
  const contentWidth = cursor + rightMargin;
  const width = Math.max(contentWidth, Math.min(options.width, contentWidth + 0));
  // Centre the drawing when there is room to spare.
  const shift = Math.max(0, (options.width - contentWidth) / 2);
  for (const [at, x] of columnX) columnX.set(at, x + shift);
  const finalWidth = Math.max(width, options.width);

  const chips = (at: number) => ((hidden.get(at) ?? 0) > 0 ? 1 : 0) + ((folded.get(at) ?? 0) > 0 ? 1 : 0);
  const headings = (at: number) => at === -1 ? visibleGroups.filter(group => group.label).length * (HEADING_HEIGHT + HEADING_GAP) : 0;
  const columnHeight = (at: number) => {
    const count = shown.get(at)?.length ?? 0;
    return count * cardHeight + Math.max(0, count - 1) * ROW_GAP + chips(at) * (ROW_GAP + CHIP_HEIGHT) + headings(at);
  };
  const tallest = Math.max(cardHeight, ...columns.map(columnHeight));
  const height = Math.max(tallest + footer + PAD_Y * 2, Math.floor(options.height ?? 0));
  // Every column is centred on one midline; a control under the graph shifts
  // that midline up so graph and control sit centred together.
  const midline = (height - footer) / 2;

  const nodes: PlacedNode[] = [];
  const more: MoreChip[] = [];
  const placed = new Map<string, PlacedNode>();
  const columnBoxes = new Map<number, Array<{ y: number; height: number }>>();
  const headingAt = new Map<string, number>();
  for (const at of columns) {
    const ids = shown.get(at) ?? [];
    let y = midline - columnHeight(at) / 2;
    const boxes: Array<{ y: number; height: number }> = [];
    for (const id of ids) {
      const opening = at === -1 ? visibleGroups.find(group => group.ids[0] === id) : undefined;
      if (opening?.label) {
        headingAt.set(opening.id, y);
        boxes.push({ y, height: HEADING_HEIGHT });
        y += HEADING_HEIGHT + HEADING_GAP;
      }
      const node = graph.nodes[indexOf.get(id)!]!;
      const card: PlacedNode = { id, label: node.label, nodeIndex: indexOf.get(id)!, column: at, focus: id === graph.focus,
        x: columnX.get(at)!, y, width: cardWidth, height: cardHeight };
      nodes.push(card); placed.set(id, card); boxes.push({ y, height: cardHeight });
      y += cardHeight + ROW_GAP;
    }
    const rest = hidden.get(at) ?? 0;
    if (rest > 0) {
      more.push({ column: at, count: rest, x: columnX.get(at)!, y, width: cardWidth, height: CHIP_HEIGHT });
      boxes.push({ y, height: CHIP_HEIGHT });
      y += CHIP_HEIGHT + ROW_GAP;
    }
    const beyond = folded.get(at) ?? 0;
    if (beyond > 0) {
      more.push({ column: at, count: beyond, x: columnX.get(at)!, y, width: cardWidth, height: CHIP_HEIGHT,
        direction: at < 0 ? "left" : "right" });
      boxes.push({ y, height: CHIP_HEIGHT });
    }
    columnBoxes.set(at, boxes);
  }

  // Each group leaves from a bracket just right of its cards, at its middle.
  const groups: DependencyGroup[] = visibleGroups.map(group => {
    const cards = group.ids.map(id => placed.get(id)!);
    const x = columnX.get(-1)!;
    const y1 = cards[0]!.y + cardHeight / 2, y2 = cards[cards.length - 1]!.y + cardHeight / 2;
    const headingY = headingAt.get(group.id) ?? cards[0]!.y;
    return { id: group.id, label: group.label, ids: group.ids, also: group.also, x, y: headingY, width: cardWidth,
      height: group.label ? HEADING_HEIGHT : 0, bracket: { x: x + cardWidth + 6, y1, y2 } };
  });
  const routed = new Map<string, { x: number; y: number; width: number; height: number }>(placed);
  for (const group of groups) routed.set(group.id, { x: group.x, y: group.bracket.y1, width: cardWidth + 6, height: group.bracket.y2 - group.bracket.y1 });
  const edges = routeEdges({ gutters, column: routeColumn, placed: routed, columnBoxes, columnX, cardWidth, first, last, height });

  const focusCard = placed.get(graph.focus);
  const bottom = Math.max(...[...columnBoxes.values()].flat().map(box => box.y + box.height), midline);
  return { nodes, more, edges, groups, width: Math.ceil(finalWidth), height: Math.ceil(height),
    focusColumn: { x: focusCard?.x ?? 0, width: focusCard?.width ?? cardWidth },
    ...(footer ? { footer: { x: focusCard?.x ?? columnX.get(0)!, y: bottom + FOOTER_GAP, width: focusCard?.width ?? cardWidth,
      height: options.footer! } } : {}) };
}

export type DependencyRowGroupKind = "madeFrom" | "usedBy" | "linked";
export type DependencyRow = { id: string; label: string; nodeIndex: number; distance: number; relation?: string };
export type DependencyRows = { focus: { id: string; label: string; nodeIndex: number };
  groups: Array<{ kind: DependencyRowGroupKind; rows: DependencyRow[]; more: number }> };

/** The same graph as grouped rows, for narrow screens: no arrows, the field
 * name that joins each row to its neighbour nearer the focus. */
export function dependencyGraphRows(graph: LayoutGraph, options: { cap?: number } = {}): DependencyRows {
  const cap = Math.max(1, options.cap ?? DEPENDENCY_ROWS_CAP);
  const { column, order, parentEdge } = assignColumns(graph);
  const indexOf = new Map(graph.nodes.map((node, index) => [node.id, index] as const));
  const row = (id: string): DependencyRow => {
    const node = graph.nodes[indexOf.get(id)!]!;
    const via = parentEdge.get(id);
    const edge = via === undefined ? undefined : graph.edges[via]!;
    const labels = (edge?.labels ?? []).filter(label => typeof label === "string" && label !== "");
    // Two steps away: name the data in between, the way the arrows would.
    const other = edge ? edge.from === id ? edge.to : edge.from : undefined;
    const between = other !== undefined && other !== graph.focus && Math.abs(column.get(id)!) > 1 ? graph.nodes[indexOf.get(other)!]?.label : undefined;
    const relation = [labels.join(", "), between ? `through ${between}` : ""].filter(Boolean).join(" · ");
    return { id, label: node.label, nodeIndex: indexOf.get(id)!, distance: column.get(id)!, ...(relation ? { relation } : {}) };
  };
  const byDistance = (ids: string[]) => ids.map(row).sort((a, b) => Math.abs(a.distance) - Math.abs(b.distance)
    || order.indexOf(a.id) - order.indexOf(b.id));
  const groups: DependencyRows["groups"] = [];
  const add = (kind: DependencyRowGroupKind, rows: DependencyRow[]) => {
    if (rows.length) groups.push({ kind, rows: rows.slice(0, cap), more: Math.max(0, rows.length - cap) });
  };
  add("madeFrom", byDistance(order.filter(id => column.get(id)! < 0)));
  add("usedBy", byDistance(order.filter(id => column.get(id)! > 0)));
  add("linked", byDistance(order.filter(id => column.get(id) === 0 && id !== graph.focus)));
  const focusIndex = indexOf.get(graph.focus);
  const focus = focusIndex === undefined ? { id: graph.focus, label: graph.focus, nodeIndex: -1 }
    : { id: graph.focus, label: graph.nodes[focusIndex]!.label, nodeIndex: focusIndex };
  return { focus, groups };
}
