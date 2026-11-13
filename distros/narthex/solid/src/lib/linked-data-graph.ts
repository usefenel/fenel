// The linked data of a collection, drawn as a graph of the app's own data
// cards (linked-data-graph-view.tsx). Display only: Fenel's dependency walk
// (`view.dependencyLinkedRounds`, see linked-data-graph-query.ts) decides the
// links and names them by the holder's field; this module keeps the part of
// that answer a collection draws, finds where each member holds what it links
// to (so the card shows the value already rendered there, no new read), and
// places the cards in two dimensions, once.

import type { ExprNode } from "@fenel/engine/authoring/expression";

export type LinkedNode = { id: string; label: string };
/** `from` holds `to` by reference (a project holds its authors). */
export type LinkedEdge = { from: string; to: string; labels: string[] };
export type LinkedGraph = { nodes: LinkedNode[]; edges: LinkedEdge[] };
export type LinkedPathStep = string | number;
export type HeldReference = { identity: string; path: LinkedPathStep[] };

const own = (value: unknown, key: string): unknown =>
  value !== null && typeof value === "object" && Object.prototype.hasOwnProperty.call(value, key)
    ? (value as Record<string, unknown>)[key] : undefined;

/** A card's own title, where its body draws none: a value that IS a function
 * held by reference (`{$ref}`, a formula a project holds) is titled with the
 * name the app shows for that function (`name`: its authored label, else its
 * code name marked as code). A record, a list or a scalar heads itself in its
 * body (a record's name row): no title here. */
export function linkedCardTitle<Name>(value: unknown, name: (id: string) => Name | undefined): Name | undefined {
  if (!value || typeof value !== "object" || Array.isArray(value)) return undefined;
  const keys = Object.keys(value);
  const id = (value as { $ref?: unknown }).$ref;
  return keys.length === 1 && typeof id === "string" && id !== "" ? name(id) : undefined;
}

/** Where one authored expression holds other data by reference, and the path
 * of that position in the value it produces: a saved reference (`ref`), or a
 * code identity held as a value (`{$ref}`, a formula held by a project). Only
 * the codec's list, record and construction carriers are followed; a call's
 * arguments are a computation, not a position of the value, and are never
 * entered. Literal payloads are never read. */
export function heldReferences(expression: ExprNode | undefined): HeldReference[] {
  const found: HeldReference[] = [];
  const visit = (node: unknown, path: LinkedPathStep[], depth: number) => {
    if (depth > 24 || node === null || typeof node !== "object") return;
    const kind = own(node, "kind");
    if (kind === "ref") {
      const identity = own(node, "savedExprId");
      if (typeof identity === "string" && identity !== "") found.push({ identity, path });
      return;
    }
    if (kind !== "literal") return;
    const carrier = own(node, "value");
    if (carrier === null || typeof carrier !== "object" || Array.isArray(carrier)) return;
    const keys = Object.keys(carrier);
    const code = own(carrier, "$ref");
    if (keys.length === 1 && typeof code === "string" && code !== "") { found.push({ identity: code, path }); return; }
    const items = own(carrier, "__list");
    if (Array.isArray(items)) { items.forEach((item, index) => visit(item, [...path, index], depth + 1)); return; }
    for (const key of ["__construct", "__record"]) {
      const fields = own(own(carrier, key), "fields");
      if (!Array.isArray(fields)) continue;
      for (const field of fields) {
        const name = own(field, "name");
        if (typeof name === "string" && name !== "") visit(own(field, "value"), [...path, name], depth + 1);
      }
      return;
    }
  };
  visit(expression, [], 0);
  return found;
}

/** A collection's members: the entries of an authored record or list that are
 * references to saved data (People and projects: Rom, Bayne, Fenel...). Its
 * other entries (a list it computes, a type or function it lists) are not
 * linked data of their own, and a constructed datum (a project) is one datum.
 * Fewer than two: not a collection of linked data. */
export function collectionMemberReferences(expression: ExprNode | undefined): HeldReference[] {
  return heldReferences(expression).filter(row => row.path.length === 1 && memberIsReference(expression, row.path[0]!));
}

function memberIsReference(expression: ExprNode | undefined, key: LinkedPathStep): boolean {
  const carrier = own(expression, "value");
  const items = own(carrier, "__list");
  if (Array.isArray(items)) return typeof key === "number" && own(items[key], "kind") === "ref";
  // A constructed datum (a project, a mascot) is one datum, never a collection.
  const fields = own(own(carrier, "__record"), "fields");
  return Array.isArray(fields) && fields.some(field => own(field, "name") === key && own(own(field, "value"), "kind") === "ref");
}

/** The collection's linked data: its members, then what each member holds by
 * reference, with Fenel's labelled links between them. The walk's edges run
 * from the part to its holder (a datum is made from its parts); here each one
 * is kept only when a member holds that part, and drawn from the holder. A
 * part a member only computes with (a call, a constructor) stays inside the
 * card that makes it. Members keep their collection order; parts follow in
 * the order Fenel reached them. */
export function collectionLinkedGraph(input: {
  members: readonly LinkedNode[];
  walk: { nodes: readonly LinkedNode[]; edges: readonly { from: string; to: string; labels?: readonly string[] }[] };
  held: (holder: string) => ReadonlySet<string>;
}): LinkedGraph {
  const memberIds = new Set(input.members.map(member => member.id));
  const labels = new Map(input.walk.nodes.map(node => [node.id, node.label] as const));
  const nodes: LinkedNode[] = input.members.map(member => ({ id: member.id, label: member.label }));
  const placed = new Set(memberIds);
  const edges = new Map<string, LinkedEdge>();
  for (const edge of input.walk.edges) {
    const holder = edge.to, part = edge.from;
    if (!memberIds.has(holder) || holder === part || !input.held(holder).has(part)) continue;
    if (!placed.has(part)) { placed.add(part); nodes.push({ id: part, label: labels.get(part) ?? part }); }
    const key = JSON.stringify([holder, part]);
    const kept = edges.get(key);
    const added = (edge.labels ?? []).filter(label => typeof label === "string" && label !== "");
    if (kept) { for (const label of added) if (!kept.labels.includes(label)) kept.labels.push(label); }
    else edges.set(key, { from: holder, to: part, labels: [...new Set(added)] });
  }
  return { nodes, edges: [...edges.values()] };
}

// ---------------------------------------------------------------------------
// Layout: a deterministic force layout over the cards' real sizes, computed
// once, then every overlap removed. No randomness: the same graph and sizes
// always give the same picture.

export type LayoutCard = { id: string; width: number; height: number };
export type PlacedCard = LayoutCard & { x: number; y: number };
export type LinkedLayout = { cards: PlacedCard[]; width: number; height: number };
export type Point = { x: number; y: number };

export const LINKED_GRAPH_GAP = 24;
/** The least gap between two linked cards, side by side and one above the
 * other: room for the name written on their line. */
const LINKED_PAIR_GAP_ACROSS = 124, LINKED_PAIR_GAP_DOWN = 48;
const PADDING = 24;

/** Places the cards in two dimensions: linked cards pull together, every card
 * pushes the others away, and the `central` ones (the collection's own
 * members) are held nearer the middle than what they link to. `aspect` is the
 * pane's width over its height: the drawing spreads to that shape. */
export function linkedGraphLayout(cards: readonly LayoutCard[], links: readonly { from: string; to: string }[],
  options: { aspect?: number; gap?: number; central?: ReadonlySet<string>; iterations?: number;
    /** Cards one holder reaches through the same field (Fenel's ten languages):
     * held together on one side of it, so their lines share one stem. */
    siblings?: readonly { holder: string; members: readonly string[] }[] } = {}): LinkedLayout {
  const n = cards.length;
  if (n === 0) return { cards: [], width: 0, height: 0 };
  const gap = options.gap ?? LINKED_GRAPH_GAP;
  // Cards are wider than tall and overlaps resolve sideways less often, so the
  // forces aim a little wider than the pane to end at its shape.
  const aspect = Math.min(3.2, Math.max(0.4, (options.aspect ?? 1.6) * 1.05));
  const index = new Map(cards.map((card, at) => [card.id, at] as const));
  const pairs: [number, number][] = [];
  const seen = new Set<string>();
  for (const link of links) {
    const a = index.get(link.from), b = index.get(link.to);
    if (a === undefined || b === undefined || a === b) continue;
    const key = a < b ? `${a}:${b}` : `${b}:${a}`;
    if (seen.has(key)) continue;
    seen.add(key); pairs.push([a, b]);
  }
  const degree = cards.map(() => 0);
  const neighbours: number[][] = cards.map(() => []);
  for (const [a, b] of pairs) {
    degree[a] = degree[a]! + 1; degree[b] = degree[b]! + 1;
    neighbours[a]!.push(b); neighbours[b]!.push(a);
  }
  const radius = cards.map(card => Math.hypot(card.width, card.height) / 2);
  const spacing = radius.reduce((sum, r) => sum + r, 0) / n * 2 + gap;
  // Order: breadth first from the most linked card, so linked cards start near each other.
  const order: number[] = [];
  const reached = new Set<number>();
  const byDegree = cards.map((_, at) => at).sort((a, b) => degree[b]! - degree[a]! || a - b);
  for (const start of byDegree) {
    if (reached.has(start)) continue;
    reached.add(start);
    const queue = [start];
    while (queue.length) {
      const at = queue.shift()!;
      order.push(at);
      for (const next of [...neighbours[at]!].sort((a, b) => degree[b]! - degree[a]! || a - b)) {
        if (!reached.has(next)) { reached.add(next); queue.push(next); }
      }
    }
  }
  // A sunflower spiral in that order, stretched to the pane's shape.
  const x = new Float64Array(n), y = new Float64Array(n);
  const stretch = Math.sqrt(aspect);
  order.forEach((at, rank) => {
    const angle = rank * 2.399963229728653;
    const r = spacing * 0.55 * Math.sqrt(rank + 0.5);
    x[at] = Math.cos(angle) * r * stretch;
    y[at] = Math.sin(angle) * r / stretch;
  });
  const central = options.central;
  const groups = (options.siblings ?? []).flatMap(group => {
    const holder = index.get(group.holder);
    const members = [...new Set(group.members)].flatMap(id => { const at = index.get(id); return at === undefined || at === holder ? [] : [at]; });
    return holder === undefined || members.length < 2 ? [] : [{ holder, members }];
  });
  // A sibling's own line to its holder pulls softly: the group as a whole keeps its distance.
  const grouped = new Set(groups.flatMap(group => group.members.map(at => group.holder < at ? `${group.holder}:${at}` : `${at}:${group.holder}`)));
  const iterations = options.iterations ?? 360;
  const dx = new Float64Array(n), dy = new Float64Array(n);
  for (let step = 0; step < iterations; step++) {
    const heat = 1 - step / iterations;
    const limit = spacing * (0.04 + 0.5 * heat * heat);
    dx.fill(0); dy.fill(0);
    for (let a = 0; a < n; a++) {
      for (let b = a + 1; b < n; b++) {
        let ex = x[a]! - x[b]!, ey = y[a]! - y[b]!;
        if (ex === 0 && ey === 0) { ex = (a - b) * 0.37; ey = (b - a) * 0.21; }
        const distance = Math.max(1, Math.hypot(ex, ey));
        const overlapX = (cards[a]!.width + cards[b]!.width) / 2 + gap - Math.abs(ex);
        const overlapY = (cards[a]!.height + cards[b]!.height) / 2 + gap - Math.abs(ey);
        const reach = radius[a]! + radius[b]! + gap;
        let force = distance < reach * 2 ? reach * reach / distance * 0.16 : 0;
        if (overlapX > 0 && overlapY > 0) force += Math.min(overlapX, overlapY) * 1.5;
        dx[a] += ex / distance * force; dy[a] += ey / distance * force;
        dx[b] -= ex / distance * force; dy[b] -= ey / distance * force;
      }
    }
    for (const [a, b] of pairs) {
      const ex = x[a]! - x[b]!, ey = y[a]! - y[b]!;
      const distance = Math.max(1, Math.hypot(ex, ey));
      const rest = radius[a]! + radius[b]! + gap * 0.5;
      const soft = grouped.has(a < b ? `${a}:${b}` : `${b}:${a}`);
      const force = (distance - rest) * (soft ? 0.25 : degree[a] === 1 || degree[b] === 1 ? 1.4 : 0.9);
      dx[a] -= ex / distance * force; dy[a] -= ey / distance * force;
      dx[b] += ex / distance * force; dy[b] += ey / distance * force;
    }
    // Siblings gather around their own middle, and that middle stands off to
    // one side of the holder: a fan, whose lines can share one stem.
    for (const group of groups) {
      let mx = 0, my = 0, size = 0;
      for (const at of group.members) { mx += x[at]!; my += y[at]!; size += radius[at]!; }
      mx /= group.members.length; my /= group.members.length; size /= group.members.length;
      let vx = mx - x[group.holder]!, vy = my - y[group.holder]!;
      let distance = Math.hypot(vx, vy);
      if (distance < 1) { vx = x[group.holder]! || 1; vy = y[group.holder]! || 0.3; distance = Math.hypot(vx, vy); }
      vx /= distance; vy /= distance;
      const want = radius[group.holder]! + size * Math.sqrt(group.members.length) * 0.75 + gap;
      const push = (want - Math.hypot(mx - x[group.holder]!, my - y[group.holder]!)) * 0.3;
      for (const at of group.members) {
        dx[at] += vx * push - (x[at]! - mx) * 0.35;
        dy[at] += vy * push - (y[at]! - my) * 0.35;
      }
      dx[group.holder] -= vx * push * 0.3; dy[group.holder] -= vy * push * 0.3;
    }
    for (let at = 0; at < n; at++) {
      const pull = (central?.has(cards[at]!.id) ? 0.07 : 0.045) * (pairs.length ? 1 : 2) * (0.25 + 1.1 * (1 - heat));
      dx[at] -= x[at]! * pull;
      dy[at] -= y[at]! * pull * aspect * aspect;
      const length = Math.hypot(dx[at]!, dy[at]!);
      if (length > 0) {
        const move = Math.min(length, limit);
        x[at] += dx[at]! / length * move;
        y[at] += dy[at]! / length * move;
      }
    }
  }
  // No two cards overlap: push each overlapping pair apart along its shorter
  // overlap. Two linked cards keep a wider gap: their line carries a name.
  const linkedPairs = new Set(pairs.map(([a, b]) => a < b ? `${a}:${b}` : `${b}:${a}`));
  for (let pass = 0; pass < 400; pass++) {
    let moved = false;
    for (let a = 0; a < n; a++) {
      for (let b = a + 1; b < n; b++) {
        const ex = x[a]! - x[b]!, ey = y[a]! - y[b]!;
        // A name is written across: side by side, two linked cards need its
        // width between them; one above the other, its height.
        const linked = linkedPairs.has(`${a}:${b}`);
        const overlapX = (cards[a]!.width + cards[b]!.width) / 2 + (linked ? LINKED_PAIR_GAP_ACROSS : gap) - Math.abs(ex);
        const overlapY = (cards[a]!.height + cards[b]!.height) / 2 + (linked ? LINKED_PAIR_GAP_DOWN : gap) - Math.abs(ey);
        if (overlapX <= 0 || overlapY <= 0) continue;
        moved = true;
        if (overlapX / aspect < overlapY) {
          const shift = overlapX / 2 + 0.5, sign = ex === 0 ? (a < b ? -1 : 1) : Math.sign(ex);
          x[a] += sign * shift; x[b] -= sign * shift;
        } else {
          const shift = overlapY / 2 + 0.5, sign = ey === 0 ? (a < b ? -1 : 1) : Math.sign(ey);
          y[a] += sign * shift; y[b] -= sign * shift;
        }
      }
    }
    if (!moved) break;
  }
  let left = Infinity, top = Infinity, right = -Infinity, bottom = -Infinity;
  for (let at = 0; at < n; at++) {
    left = Math.min(left, x[at]! - cards[at]!.width / 2); right = Math.max(right, x[at]! + cards[at]!.width / 2);
    top = Math.min(top, y[at]! - cards[at]!.height / 2); bottom = Math.max(bottom, y[at]! + cards[at]!.height / 2);
  }
  return {
    cards: cards.map((card, at) => ({ ...card, x: Math.round(x[at]! - card.width / 2 - left + PADDING), y: Math.round(y[at]! - card.height / 2 - top + PADDING) })),
    width: Math.ceil(right - left + PADDING * 2), height: Math.ceil(bottom - top + PADDING * 2),
  };
}

/** Where the segment from a card's centre towards `towards` leaves the card,
 * `clearance` pixels outside its border. */
function borderPoint(card: PlacedCard, towards: Point, clearance: number): Point {
  const cx = card.x + card.width / 2, cy = card.y + card.height / 2;
  const ex = towards.x - cx, ey = towards.y - cy;
  if (ex === 0 && ey === 0) return { x: cx, y: cy };
  const halfW = card.width / 2 + clearance, halfH = card.height / 2 + clearance;
  const scale = Math.min(ex === 0 ? Infinity : halfW / Math.abs(ex), ey === 0 ? Infinity : halfH / Math.abs(ey));
  return { x: cx + ex * scale, y: cy + ey * scale };
}

/** One link's straight line between two placed cards, from border to border. */
export function linkedEdgePoints(from: PlacedCard, to: PlacedCard): [Point, Point] {
  const a = { x: from.x + from.width / 2, y: from.y + from.height / 2 };
  const b = { x: to.x + to.width / 2, y: to.y + to.height / 2 };
  return [borderPoint(from, b, 2), borderPoint(to, a, 3)];
}

/** The links grouped by holder and field name, in their first order. */
export function linkedSiblingGroups(edges: readonly LinkedEdge[]): LinkedEdge[][] {
  const groups = new Map<string, LinkedEdge[]>();
  for (const edge of edges) {
    const key = JSON.stringify([edge.from, edge.labels.join(", ")]);
    groups.set(key, [...(groups.get(key) ?? []), edge]);
  }
  return [...groups.values()];
}

/** The links grouped by target, field name and the holders' kind (their
 * type): BayneOS and DripCollector -> Authors -> Bayne is one group. A holder
 * of unknown kind is a group of its own. */
export function linkedIncomingGroups(edges: readonly LinkedEdge[], kindOf: (id: string) => string | undefined): LinkedEdge[][] {
  const groups = new Map<string, LinkedEdge[]>();
  for (const edge of edges) {
    const kind = kindOf(edge.from);
    const key = JSON.stringify([edge.to, edge.labels.join(", "), kind ?? `#${edge.from}`]);
    groups.set(key, [...(groups.get(key) ?? []), edge]);
  }
  return [...groups.values()];
}

/** How a graph's links are drawn. A link is (holder, field, target). One
 * holder's links through one field leave it as ONE stem that splits at a
 * junction near the holder; several holders of one kind reaching one target
 * through one field JOIN at a junction near the target into ONE trunk with one
 * arrow head. A link can be a branch of a split and of a join at once; the eye
 * follows it through both junctions. No junction is ever shared by two fields,
 * by two holders' stems, or by two targets' trunks. */
export type LinkedRoutes = {
  /** Holder's border to its split junction: one per (holder, field) with two or more targets. */
  stems: Array<{ key: string; from: string; to: readonly string[]; points: [Point, Point] }>;
  /** Join junction to the target's border (the one arrow head): one per (target, field, kind) with two or more holders. */
  trunks: Array<{ key: string; to: string; from: readonly string[]; points: [Point, Point] }>;
  /** Each link's own stretch, from its holder (or split junction) to its target (or join junction). */
  segments: Array<{ edge: LinkedEdge; points: Point[]; head: boolean }>;
  /** Field names, each written once, where it is clear of every card. */
  labels: Array<{ key: string; text: string; at: Point; from: readonly string[]; to: readonly string[] }>;
};

const LABEL_CHAR = 6.2, LABEL_HEIGHT = 13;
/** The least room between two field names. */
const LABEL_GAP = 12;
/** How far a detour passes from the corner of the card it goes around. */
const DETOUR_CLEARANCE = 14;

/** Whether the segment a-b crosses the rectangle grown by `margin`. */
function crosses(a: Point, b: Point, card: PlacedCard, margin: number): boolean {
  const left = card.x - margin, right = card.x + card.width + margin, top = card.y - margin, bottom = card.y + card.height + margin;
  let t0 = 0, t1 = 1;
  const dx = b.x - a.x, dy = b.y - a.y;
  for (const [p, q] of [[-dx, a.x - left], [dx, right - a.x], [-dy, a.y - top], [dy, bottom - a.y]] as const) {
    if (p === 0) { if (q < 0) return false; continue; }
    const r = q / p;
    if (p < 0) { if (r > t1) return false; if (r > t0) t0 = r; }
    else { if (r < t0) return false; if (r < t1) t1 = r; }
  }
  return t0 < t1;
}

/** A straight line from `a` to `b`, or, when it would run behind one of
 * `obstacles`, the shortest clear path round the first card it meets, by one
 * corner or by the two corners of one side (else the straight line). */
function detour(a: Point, b: Point, obstacles: readonly PlacedCard[], _from?: PlacedCard, _to?: PlacedCard, depth = 3): Point[] {
  const hit = obstacles.filter(card => crosses(a, b, card, 4));
  if (!hit.length || depth === 0) return [a, b];
  const along = (card: PlacedCard) => (card.x + card.width / 2 - a.x) * (b.x - a.x) + (card.y + card.height / 2 - a.y) * (b.y - a.y);
  const first = hit.reduce((best, card) => along(card) < along(best) ? card : best);
  const c = DETOUR_CLEARANCE;
  const topLeft = { x: first.x - c, y: first.y - c }, topRight = { x: first.x + first.width + c, y: first.y - c };
  const bottomLeft = { x: first.x - c, y: first.y + first.height + c }, bottomRight = { x: first.x + first.width + c, y: first.y + first.height + c };
  // Round the first card it meets by one corner, or by the two corners of one
  // side; from there on, the same again (a card or two further on).
  const turns: Point[][] = [[topLeft], [topRight], [bottomLeft], [bottomRight], [topLeft, topRight], [topRight, topLeft],
    [bottomLeft, bottomRight], [bottomRight, bottomLeft], [topLeft, bottomLeft], [bottomLeft, topLeft], [topRight, bottomRight], [bottomRight, topRight]];
  const clearLeg = (from: Point, to: Point) => !obstacles.some(card => crosses(from, to, card, 2));
  let best: Point[] | undefined, bestLength = Infinity;
  for (const turn of turns) {
    const head = [a, ...turn];
    if (!head.slice(1).every((point, index) => clearLeg(head[index]!, point))) continue;
    const rest = detour(head[head.length - 1]!, b, obstacles, undefined, undefined, depth - 1);
    const path = [...head, ...rest.slice(1)];
    let length = 0, clear = true;
    for (let index = 1; index < path.length && clear; index++) {
      clear = clearLeg(path[index - 1]!, path[index]!);
      length += Math.hypot(path[index]!.x - path[index - 1]!.x, path[index]!.y - path[index - 1]!.y);
    }
    if (clear && length < bestLength) { best = path; bestLength = length; }
  }
  return best ?? [a, b];
}

/** Pushes overlapping cards apart, in place, keeping every other position:
 * used when a card grows after the layout and the drawing may not move as a
 * whole (the reader is using it). Deterministic; converges. */
export function settleOverlaps(cards: PlacedCard[], gap = LINKED_GRAPH_GAP): PlacedCard[] {
  const placed = cards.map(card => ({ ...card }));
  for (let pass = 0; pass < 200; pass++) {
    let moved = false;
    for (let a = 0; a < placed.length; a++) for (let b = a + 1; b < placed.length; b++) {
      const one = placed[a]!, two = placed[b]!;
      const ex = (one.x + one.width / 2) - (two.x + two.width / 2), ey = (one.y + one.height / 2) - (two.y + two.height / 2);
      const overlapX = (one.width + two.width) / 2 + gap - Math.abs(ex);
      const overlapY = (one.height + two.height) / 2 + gap - Math.abs(ey);
      if (overlapX <= 0 || overlapY <= 0) continue;
      moved = true;
      if (overlapX < overlapY) {
        const shift = Math.ceil(overlapX / 2), sign = ex === 0 ? (a < b ? -1 : 1) : Math.sign(ex);
        one.x += sign * shift; two.x -= sign * shift;
      } else {
        const shift = Math.ceil(overlapY / 2), sign = ey === 0 ? (a < b ? -1 : 1) : Math.sign(ey);
        one.y += sign * shift; two.y -= sign * shift;
      }
    }
    if (!moved) break;
  }
  return placed;
}

export function linkedRoutes(edges: readonly LinkedEdge[], cards: ReadonlyMap<string, PlacedCard>,
  kindOf: (id: string) => string | undefined = () => undefined): LinkedRoutes {
  const centre = (card: PlacedCard): Point => ({ x: card.x + card.width / 2, y: card.y + card.height / 2 });
  const drawn = edges.filter(edge => cards.has(edge.from) && cards.has(edge.to) && edge.from !== edge.to);
  const average = (points: readonly Point[]): Point => ({ x: points.reduce((sum, at) => sum + at.x, 0) / points.length,
    y: points.reduce((sum, at) => sum + at.y, 0) / points.length });
  // A junction a short way out of `card` towards `towards`, well before the nearest other end.
  // Junctions already placed: a new one never lands on another (two fields
  // aimed at the same targets still get two dots), it steps aside instead.
  const placedJunctions: Point[] = [];
  const junctionOut = (card: PlacedCard, towards: Point, nearest: number, clearance: number): { start: Point; junction: Point } => {
    const start = borderPoint(card, towards, clearance);
    const span = Math.hypot(towards.x - start.x, towards.y - start.y) || 1;
    const reach = Math.max(14, Math.min(span * 0.4, nearest * 0.55, 96));
    const ux = (towards.x - start.x) / span, uy = (towards.y - start.y) / span;
    // Never inside another card (every line into it would run behind that card).
    const inside = (at: Point) => [...cards.values()].some(other => other.id !== card.id
      && at.x > other.x - 6 && at.x < other.x + other.width + 6 && at.y > other.y - 6 && at.y < other.y + other.height + 6);
    let length = reach;
    while (length > 14 && inside({ x: start.x + ux * length, y: start.y + uy * length })) length = Math.max(14, length * 0.6);
    let junction = { x: start.x + ux * length, y: start.y + uy * length };
    for (let step = 1; step < 12 && placedJunctions.some(at => Math.hypot(at.x - junction.x, at.y - junction.y) < 10); step++) {
      const side = (step % 2 === 1 ? 1 : -1) * Math.ceil(step / 2) * 14;
      junction = { x: start.x + ux * length - uy * side, y: start.y + uy * length + ux * side };
    }
    placedJunctions.push(junction);
    return { start, junction };
  };
  const nameOf = (edge: LinkedEdge) => edge.labels.join(", ");
  // Splits first, aimed at their targets' centres.
  const split = new Map<LinkedEdge, { key: string; junction: Point }>();
  const stems: LinkedRoutes["stems"] = [];
  for (const group of linkedSiblingGroups(drawn)) {
    if (group.length < 2) continue;
    const holder = cards.get(group[0]!.from)!;
    const targets = group.map(edge => cards.get(edge.to)!);
    const middle = average(targets.map(centre));
    const from = borderPoint(holder, middle, 2);
    const nearest = Math.min(...targets.map(card => { const end = borderPoint(card, from, 3); return Math.hypot(end.x - from.x, end.y - from.y); }));
    const { start, junction } = junctionOut(holder, middle, nearest, 2);
    const key = JSON.stringify(["split", holder.id, nameOf(group[0]!)]);
    stems.push({ key, from: holder.id, to: group.map(edge => edge.to), points: [start, junction] });
    for (const edge of group) split.set(edge, { key, junction });
  }
  // Joins next, aimed at where their links come from (a split junction or the holder).
  const sourceOf = (edge: LinkedEdge): Point => split.get(edge)?.junction ?? centre(cards.get(edge.from)!);
  const joined = new Map<LinkedEdge, { key: string; junction: Point }>();
  const trunks: LinkedRoutes["trunks"] = [];
  for (const group of linkedIncomingGroups(drawn, kindOf)) {
    if (group.length < 2) continue;
    const target = cards.get(group[0]!.to)!;
    const sources = group.map(sourceOf);
    const middle = average(sources);
    const from = borderPoint(target, middle, 3);
    const nearest = Math.min(...sources.map(at => Math.hypot(at.x - from.x, at.y - from.y)));
    const { start, junction } = junctionOut(target, middle, nearest, 3);
    const key = JSON.stringify(["join", target.id, nameOf(group[0]!), kindOf(group[0]!.from) ?? ""]);
    trunks.push({ key, to: target.id, from: group.map(edge => edge.from), points: [junction, start] });
    for (const edge of group) joined.set(edge, { key, junction });
  }
  // Each link's own stretch, from its holder (or split junction) to its target
  // (or join junction); a card it is not attached to is passed by one corner
  // when such a detour is clear (a line never runs behind another card).
  const segments: LinkedRoutes["segments"] = drawn.map(edge => {
    const holder = cards.get(edge.from)!, target = cards.get(edge.to)!;
    const join = joined.get(edge)?.junction, fork = split.get(edge)?.junction;
    const from = fork ?? centre(holder), to = join ?? centre(target);
    const obstacles = [...cards.values()].filter(card => card.id !== holder.id && card.id !== target.id);
    const points = detour(from, to, obstacles, fork ? undefined : holder, join ? undefined : target);
    if (!fork) points[0] = borderPoint(holder, points[1]!, 2);
    if (!join) points[points.length - 1] = borderPoint(target, points[points.length - 2]!, 3);
    return { edge, points, head: join === undefined };
  });
  // Field names: one per split stem; one per join trunk, unless every link into
  // it already reads that name on its own split stem; one per plain link.
  const boxes = [...cards.values()];
  // How much of a label's box the cards cover, and the names already placed
  // (kept 12 px apart, so two names never read as one phrase); 0 is clear.
  const written: Array<{ x: number; y: number; width: number; height: number }> = [];
  const boxOf = (at: Point, text: string) => {
    const half = text.length * LABEL_CHAR / 2 + 3;
    return { x: at.x - half, y: at.y - LABEL_HEIGHT, width: half * 2, height: LABEL_HEIGHT + 3 };
  };
  const covered = (at: Point, text: string) => {
    const box = boxOf(at, text);
    let area = 0;
    for (const [rects, margin] of [[boxes, 3], [written, LABEL_GAP]] as const) for (const other of rects) {
      const w = Math.min(box.x + box.width, other.x + other.width + margin) - Math.max(box.x, other.x - margin);
      const h = Math.min(box.y + box.height, other.y + other.height + margin) - Math.max(box.y, other.y - margin);
      if (w > 0 && h > 0) area += w * h;
    }
    return area;
  };
  // Along each candidate line (its middle first), then just beside it: the
  // first spot no card covers; else the least covered one. Cards are drawn
  // over the lines, so a name under a card would be hidden or cut.
  const place = (text: string, lines: ReadonlyArray<readonly Point[]>): Point => {
    const at = placeOnce(text, lines.flatMap(line => line.slice(1).map((point, index) => [line[index]!, point] as const)));
    written.push(boxOf(at, text));
    return at;
  };
  const placeOnce = (text: string, candidates: ReadonlyArray<readonly [Point, Point]>): Point => {
    let best: Point | undefined, bestArea = Infinity;
    for (const [a, b] of candidates) {
      const length = Math.hypot(b.x - a.x, b.y - a.y) || 1;
      const nx = -(b.y - a.y) / length, ny = (b.x - a.x) / length;
      for (const offset of [0, 12, -12, 22, -22]) for (const t of [0.5, 0.4, 0.6, 0.3, 0.7, 0.2, 0.8, 0.12, 0.88]) {
        const at = { x: a.x + (b.x - a.x) * t + nx * offset, y: a.y + (b.y - a.y) * t + ny * offset - 4 };
        const area = covered(at, text);
        if (area === 0) return at;
        if (area < bestArea) { best = at; bestArea = area; }
      }
    }
    return best ?? { x: (candidates[0]![0].x + candidates[0]![1].x) / 2, y: (candidates[0]![0].y + candidates[0]![1].y) / 2 - 4 };
  };
  const segmentOf = new Map(segments.map(row => [row.edge, row.points] as const));
  const labels: LinkedRoutes["labels"] = [];
  for (const stem of stems) {
    const group = drawn.filter(edge => split.get(edge)?.key === stem.key);
    const text = nameOf(group[0]!);
    if (text) labels.push({ key: stem.key, text, from: [stem.from], to: stem.to,
      at: place(text, [stem.points, ...group.map(edge => segmentOf.get(edge)!)]) });
  }
  for (const trunk of trunks) {
    const group = drawn.filter(edge => joined.get(edge)?.key === trunk.key);
    const text = nameOf(group[0]!);
    if (!text || group.every(edge => split.has(edge))) continue;
    labels.push({ key: trunk.key, text, from: trunk.from, to: [trunk.to],
      at: place(text, [trunk.points, ...group.filter(edge => !split.has(edge)).map(edge => segmentOf.get(edge)!)]) });
  }
  for (const row of segments) {
    if (split.has(row.edge) || joined.has(row.edge)) continue;
    const text = nameOf(row.edge);
    if (text) labels.push({ key: JSON.stringify(["link", row.edge.from, row.edge.to]), text, from: [row.edge.from], to: [row.edge.to],
      at: place(text, [row.points]) });
  }
  return { stems, trunks, segments, labels };
}

/** Which links carry their field's name: a holder's several links under the
 * same name (Fenel's ten languages) name it once, on the shortest. */
export function labelledEdges(edges: readonly LinkedEdge[], length: (edge: LinkedEdge) => number): Set<LinkedEdge> {
  const groups = new Map<string, LinkedEdge[]>();
  for (const edge of edges) {
    const name = edge.labels.join(", ");
    if (!name) continue;
    const key = JSON.stringify([edge.from, name]);
    groups.set(key, [...(groups.get(key) ?? []), edge]);
  }
  const shown = new Set<LinkedEdge>();
  for (const group of groups.values()) shown.add(group.reduce((best, edge) => length(edge) < length(best) ? edge : best));
  return shown;
}

/** The scale that fits a drawing into the pane (never above actual size). */
export function linkedGraphFit(layout: { width: number; height: number }, pane: { width: number; height: number }): number {
  if (layout.width <= 0 || layout.height <= 0 || pane.width <= 0 || pane.height <= 0) return 1;
  return Math.min(1, pane.width / layout.width, pane.height / layout.height);
}
