// The species sets as a graph: the SAME view model the nested boxes draw
// (nested-sets-format.ts, read from plants.fenel's judged data), laid out the
// way the Dependencies panel lays out its graph. What a set is made of sits on
// the left, what holds it on the right: species, then genera (and, under them,
// the sets that cut across families), then families. Every arrow is "is a
// subset of" / "is a member of"; one is drawn only where the model holds a
// decided `Just true` or the membership itself (a set's member list). An
// undecided verdict is an undecided arrow (drawn dashed, never solid); a
// verdict decided false, or no verdict in the data, draws no arrow. Nothing
// here decides a relation. Placement and routing reuse the column geometry of
// dependency-graph-layout.ts (planGutters, routeEdges).
// Solid/browser renderer allowance — the same kind as the other card surfaces.

import { GRAPH_GEOMETRY, planGutters, routeEdges, type RoutedEdge } from "./dependency-graph-layout";
import { VERDICT_TOOLTIP, verdictText, type LifeFormSet, type NamedSet, type NestedSetsModel, type SpeciesChip } from "./nested-sets-format";
import type { InlineImageValue } from "./expression-runner/image-canvas-data";
import type { ClassificationLink } from "./nested-sets-classification";

/** "taxon": any broader rank the model may later hold (a kingdom, a root). */
export type SetGraphNodeKind = "species" | "genus" | "family" | "taxon" | "life-form" | "named-set";

export type SetGraphNode = {
  id: string;
  kind: SetGraphNodeKind;
  /** 0: species; 1: genera, then the sets that cut across families; 2: families.
   * A classification of any depth: the set's height above its leaves. */
  column: number;
  title: string;
  detail: string | undefined;
  titleItalic: boolean;
  detailItalic: boolean;
  /** The whole name, for the card's tooltip and accessible name. */
  label: string;
  /** The sets of the classification that hold this node in the model's
   * structure (a species' genus, a genus' family), whatever their verdict:
   * the tree's rows come from this nesting, its arrows from the judgments. */
  holders: string[];
  /** A set that cuts across the classification (a life form, a set by name). */
  across: boolean;
  picture?: InlineImageValue;
  /** A classification's node is its item (a bare constructor): its mark is the item's glyph. */
  item?: unknown;
  /** A stated link to the other classification (gives foods, comes from a living thing). */
  link?: ClassificationLink;
};

export type SetGraphEdge = {
  from: string;
  to: string;
  /** Member of a set, or a set within a larger set: one style for both. */
  relation: "subset";
  /** Only "true" is drawn solid; "undecided" is drawn dashed. */
  decided: "true" | "undecided";
  /** A taxonomy arrow (species to genus, genus to family) rather than a set that cuts across. */
  tree: boolean;
  /** The "not decided" wording, on hover, for an undecided arrow. */
  tooltip?: string;
};

export type SetGraph = { nodes: SetGraphNode[]; edges: SetGraphEdge[] };

const speciesId = (species: SpeciesChip) => `species:${species.scientific}`;

/** The graph of a species-sets model; undefined when its family selection is
 * undecided (the boxes then show "Not decided" and the structural reader). */
export function nestedSetsGraph(model: NestedSetsModel): SetGraph | undefined {
  const families = model.kind === "family" ? [model.family] : model.families;
  if (!families) return undefined;
  // "undecided" (a `Nothing` selection) and an absent field draw no set.
  const lifeForms: readonly LifeFormSet[] = model.kind === "collection" && typeof model.lifeForms === "object" ? model.lifeForms : [];
  const namedSets: readonly NamedSet[] = model.kind === "collection" && typeof model.namedSets === "object" ? model.namedSets : [];

  const nodes: SetGraphNode[] = [];
  const known = new Set<string>();
  const add = (node: SetGraphNode) => { if (!known.has(node.id)) { known.add(node.id); nodes.push(node); } };
  const genusId = (family: string, genus: string) => `genus:${family}/${genus}`;
  const holdersOf = (species: SpeciesChip) => families.flatMap((family) => family.genera
    .filter((genus) => genus.species.some((row) => row.scientific === species.scientific)).map((genus) => genusId(family.name, genus.name)));
  const addSpecies = (species: SpeciesChip) => add({
    id: speciesId(species), kind: "species", column: 0, holders: holdersOf(species), across: false,
    title: species.common ?? species.scientific, detail: species.common ? species.scientific : undefined,
    titleItalic: !species.common, detailItalic: true,
    label: species.common ? `${species.common} (${species.scientific})` : species.scientific,
    ...(species.picture ? { picture: species.picture } : {}),
  });

  // Families in the model's order, genera grouped by family, species grouped
  // by genus: the taxonomy's arrows run between neighbours and never cross.
  for (const family of families) for (const genus of family.genera) for (const species of genus.species) addSpecies(species);
  for (const set of lifeForms) for (const species of set.species) addSpecies(species);
  for (const set of namedSets) for (const species of set.species) addSpecies(species);
  for (const family of families) for (const genus of family.genera) add({
    id: genusId(family.name, genus.name), kind: "genus", column: 1, holders: [`family:${family.name}`], across: false,
    title: genus.name, detail: genus.countText,
    titleItalic: true, detailItalic: false, label: `${genus.name}, ${genus.countText}`,
  });
  for (const set of lifeForms) add({ id: `life-form:${set.key}`, kind: "life-form", column: 1, holders: [], across: true, title: set.title,
    detail: set.countText, titleItalic: false, detailItalic: false, label: `${set.title}, ${set.countText}` });
  for (const set of namedSets) add({ id: `named:${set.name}`, kind: "named-set", column: 1, holders: [], across: true, title: set.name,
    detail: set.countText, titleItalic: false, detailItalic: false, label: `${set.name}, ${set.countText}` });
  for (const family of families) {
    const detail = family.commonName ? `${family.commonName} · ${family.countText}` : family.countText;
    add({ id: `family:${family.name}`, kind: "family", column: 2, holders: [], across: false, title: family.name, detail,
      titleItalic: false, detailItalic: false, label: `${family.name}, ${detail}` });
  }

  const edges: SetGraphEdge[] = [];
  const titleOf = (id: string) => nodes.find((node) => node.id === id)?.title ?? id;
  const arrow = (from: string, to: string, decided: SetGraphEdge["decided"], tree: boolean) => {
    if (!known.has(from) || !known.has(to) || edges.some((row) => row.from === from && row.to === to)) return;
    edges.push({ from, to, relation: "subset", decided, tree,
      ...(decided === "undecided" ? { tooltip: `${titleOf(from)} ⊆ ${titleOf(to)}: ${verdictText("undecided", titleOf(to))}. ${VERDICT_TOOLTIP.undecided}` } : {}) });
  };
  // The taxonomy first (drawn first, so beneath)...
  for (const family of families) for (const genus of family.genera) {
    // A species listed in a genus set is a member of it: the set's own data.
    for (const species of genus.species) arrow(speciesId(species), genusId(family.name, genus.name), "true", true);
  }
  for (const family of families) for (const genus of family.genera) {
    if (genus.verdict === "true" || genus.verdict === "undecided") arrow(genusId(family.name, genus.name), `family:${family.name}`, genus.verdict, true);
  }
  // ...then the sets that cut across families, drawn above it.
  for (const set of lifeForms) for (const species of set.species) arrow(speciesId(species), `life-form:${set.key}`, "true", false);
  for (const set of namedSets) for (const species of set.species) arrow(speciesId(species), `named:${set.name}`, "true", false);
  // A set by name within a family (a family answer has no `family` of its own).
  // A genus answer would be an arrow inside one column: its words stay in the boxes.
  for (const set of namedSets) for (const answer of set.answers) {
    if (answer.family === undefined && (answer.verdict === "true" || answer.verdict === "undecided")) {
      arrow(`named:${set.name}`, `family:${answer.taxon}`, answer.verdict, false);
    }
  }
  return { nodes, edges };
}

export type PlacedSetGraphNode = SetGraphNode & { nodeIndex: number; x: number; y: number; width: number; height: number;
  /** The tree's row (top = 0); absent in the left-to-right graph. */
  level?: number };
export type SetGraphLayout = { nodes: PlacedSetGraphNode[]; edges: RoutedEdge[];
  /** The tree's connectors, one per parent (empty in the left-to-right graph). */
  brackets: TreeBracket[];
  /** Which way the arrows run: "horizontal" (the graph) or "vertical" (the tree). */
  orientation: "horizontal" | "vertical";
  /** Always empty: this graph draws every node of the value (no "+k more"). */
  more: never[]; width: number; height: number };

/** Inner gutters may grow past the Dependencies panel's cap: every species
 * sends one arrow per set that holds it, and the graph scrolls. */
const MAX_SET_GUTTER = 320;
/** The straight run of every arrow into (and out of) a card in the
 * left-to-right graph: no turn right before an arrowhead. */
const ENTRY_RUN = 18;

/** Natural size: fixed card size, one column per kind, each column in the
 * model's order. A genus sits level with the middle of its species and a
 * family with the middle of its genera (pushed down only to keep cards
 * apart); the sets that cut across families sit under the genera. A container
 * wider than the drawing centres it; a narrower one scrolls. */
export function nestedSetsGraphLayout(graph: SetGraph, options: { width: number }): SetGraphLayout {
  const { rowGap, padY, cardHeight } = GRAPH_GEOMETRY;
  const column = new Map<string, number>(graph.nodes.map((node) => [node.id, node.column] as const));
  const columnWidth = new Map<number, number>();
  for (const node of graph.nodes) columnWidth.set(node.column, Math.max(columnWidth.get(node.column) ?? 0, cardWidthFor(node)));
  const widthOf = (at: number) => columnWidth.get(at) ?? GRAPH_GEOMETRY.cardWidth;
  const columns = [...new Set(graph.nodes.map((node) => node.column as number))].sort((a, b) => a - b);
  const first = columns[0] ?? 0, last = columns[columns.length - 1] ?? 0;
  const drawn = graph.edges.map((edge, edgeIndex) => ({ edge, edgeIndex }))
    .filter(({ edge }) => edge.from !== edge.to && column.has(edge.from) && column.has(edge.to));
  const gutters = planGutters(drawn, column, first, last, { maxInnerGutter: MAX_SET_GUTTER });

  // The router spreads its lanes over `gutters.width(g)`; each inner gutter is
  // that much plus a straight run on both sides, which the router skips by
  // reading each column as ENTRY_RUN wider than its cards (`columnSize`).
  const columnX = new Map<number, number>();
  let cursor = gutters.width(first - 1);
  for (let at = first; at <= last; at++) {
    columnX.set(at, cursor); cursor += widthOf(at) + (at < last ? gutters.width(at) + 2 * ENTRY_RUN : 0);
  }
  const natural = Math.ceil(cursor + gutters.width(last));
  const shift = Math.max(0, (options.width - natural) / 2);
  for (const [at, x] of columnX) columnX.set(at, x + shift);

  const sources = new Map<string, string[]>();
  for (const edge of graph.edges) if (edge.tree) { const list = sources.get(edge.to) ?? []; list.push(edge.from); sources.set(edge.to, list); }
  const nodes: PlacedSetGraphNode[] = [];
  const placed = new Map<string, PlacedSetGraphNode>();
  const columnBoxes = new Map<number, Array<{ y: number; height: number }>>();
  for (const at of columns) {
    let next = padY;
    let across = false;
    const boxes: Array<{ y: number; height: number }> = [];
    graph.nodes.forEach((node, nodeIndex) => {
      if (node.column !== at) return;
      // One more gap between the genera and the sets that cut across families.
      if ((node.kind === "life-form" || node.kind === "named-set") && !across) { across = true; if (boxes.length) next += rowGap; }
      const centres = (sources.get(node.id) ?? []).flatMap((id) => { const card = placed.get(id); return card ? [card.y + card.height / 2] : []; });
      const want = centres.length ? centres.reduce((sum, y) => sum + y, 0) / centres.length - cardHeight / 2 : next;
      const y = Math.max(want, next);
      const card: PlacedSetGraphNode = { ...node, nodeIndex, x: columnX.get(at)!, y, width: widthOf(at), height: cardHeight };
      nodes.push(card); placed.set(node.id, card); boxes.push({ y, height: cardHeight });
      next = y + cardHeight + rowGap;
    });
    columnBoxes.set(at, boxes);
  }
  const height = Math.ceil(Math.max(cardHeight, ...nodes.map((node) => node.y + node.height)) + padY);
  const edges = routeEdges({ gutters, column, placed, columnBoxes, columnX, cardWidth: GRAPH_GEOMETRY.cardWidth,
    columnSize: (at) => widthOf(at) + ENTRY_RUN, first, last, height });
  return { nodes, edges, brackets: [], more: [], width: Math.max(natural, Math.ceil(options.width)), height, orientation: "horizontal" };
}

/** The three drawings of the value, in the order the switch offers them. */
export type NestedSetsRepresentation = "boxes" | "tree" | "graph";

/** The drawing shown: the boxes unless the reader chose another drawing and
 * the value has a graph (an undecided selection keeps the boxes' fallback). */
export function nestedSetsRepresentation(choice: NestedSetsRepresentation | undefined, drawable: boolean): NestedSetsRepresentation {
  return (choice === "graph" || choice === "tree") && drawable ? choice : "boxes";
}

/** The switch is one button that cycles, like the list's Row/Stack button:
 * Boxes, then the Tree, then the Graph, then the Boxes again. */
export function nextDrawing(current: NestedSetsRepresentation): NestedSetsRepresentation {
  return current === "boxes" ? "tree" : current === "tree" ? "graph" : "boxes";
}

/** The rough advance of the card's two text sizes (0.84rem and 0.74rem of
 * the app's sans-serif) and its chrome (padding, mark, gap). An estimate:
 * enough that "nightshade family · 3 species" never ends in an ellipsis. */
const TITLE_CHAR = 7.2, DETAIL_CHAR = 6.4, CARD_CHROME = 47;
const MIN_CARD = 150, MAX_CARD = 300;

/** A card as wide as its longest line, between 150 and 300 px. */
export function cardWidthFor(node: Pick<SetGraphNode, "title" | "detail">): number {
  const text = Math.max(node.title.length * TITLE_CHAR, (node.detail?.length ?? 0) * DETAIL_CHAR);
  return Math.min(MAX_CARD, Math.max(MIN_CARD, Math.ceil(text + CARD_CHROME)));
}

/** "Fit": the scale that brings the drawing's width into the card's; never
 * above 1 (a small drawing keeps its natural size). */
export function fitScale(naturalWidth: number, availableWidth: number): number {
  return availableWidth > 0 && naturalWidth > availableWidth ? availableWidth / naturalWidth : 1;
}

/** How many tints the sets that cut across take in turn (the expression
 * graph's input-slot tones, nested-sets-view.css). */
export const SET_TINT_COUNT = 5;

/** Each set that cuts across the classification gets its own tint, by its
 * order in the model (the same set keeps its tint on every redraw). */
export function crossSetTints(graph: SetGraph): Map<string, number> {
  const tints = new Map<string, number>();
  for (const node of graph.nodes) if (node.across) tints.set(node.id, tints.size % SET_TINT_COUNT);
  return tints;
}

/** Each node's row in the tree, top = 0. A node's height is how far it sits
 * above the members (a member is 0, a set 1 + its tallest member set), taken
 * from the model's nesting, never from rank names: a root and kingdoms above
 * the families are simply higher rows. The broadest sets share the top row;
 * the sets that cut across take one row under the members. */
export function treeLevels(graph: SetGraph): Map<string, number> {
  const children = new Map<string, string[]>();
  for (const node of graph.nodes) for (const holder of node.holders) {
    const list = children.get(holder) ?? []; list.push(node.id); children.set(holder, list);
  }
  const byId = new Map(graph.nodes.map((node) => [node.id, node] as const));
  const heights = new Map<string, number>();
  const height = (id: string, seen: Set<string>): number => {
    const known = heights.get(id);
    if (known !== undefined) return known;
    if (seen.has(id)) return 0;
    seen.add(id);
    const kids = (children.get(id) ?? []).filter((child) => byId.has(child));
    // A set with no member drawn still sits above the members' row.
    const value = kids.length ? 1 + Math.max(...kids.map((child) => height(child, seen))) : byId.get(id)?.kind === "species" ? 0 : 1;
    heights.set(id, value);
    return value;
  };
  const tree = graph.nodes.filter((node) => !node.across);
  for (const node of tree) height(node.id, new Set());
  const top = Math.max(0, ...tree.map((node) => heights.get(node.id)!));
  const levels = new Map<string, number>();
  for (const node of graph.nodes) levels.set(node.id, node.across ? top + 1 : top - heights.get(node.id)!);
  return levels;
}

/** A species in the tree: a compact picture tile (a 56 px mark, its common
 * name, its scientific name), twelve to about 1,400 px. */
export const TREE_TILE = { width: 112, height: 136, gap: 10 } as const;
const TREE_CARD_GAP = 16;
/** The gap between two rows of the classification: a trunk, a bus, the verticals. */
const TREE_ROW_GAP = 64;
/** Per set, under the species: its bus's own lane, and its drop beside the others under one tile. */
const ACROSS_LANE = 22;
const DROP_SPACING = 6;

export type Point = { x: number; y: number };
/** One child's line in a bracket: up (or down) from the middle of its card's
 * edge to the bus, then along the bus to the trunk. The bus is the union of
 * these stretches, so pointing at a child lights exactly its own way in. */
export type TreeConnector = { child: string; edgeIndex: number; points: Point[]; undecided: boolean; tooltip?: string };
/** A parent's one connector, the classic tree bracket: a trunk from the bus
 * into the middle of the parent's edge (its only arrowhead, `trunk[1]` is the
 * tip), and one line per child that is decided within it (or undecided:
 * dashed). A set that cuts across hangs under the species: the same bracket
 * mirrored. */
export type TreeBracket = { parent: string; across: boolean; trunk: [Point, Point]; connectors: TreeConnector[] };

/** The same graph top to bottom. Rows by `treeLevels`; within a row, the
 * model's order. The members' row is laid first, left to right; every set
 * above is centred over its members (pushed right only to keep cards apart),
 * and so is each set that cuts across, in its row under the members. Each
 * parent gets one bracket, computed here from the rows and card centres (not
 * through the Dependencies router): its bus midway in the gap under it. The
 * sets that cut across get one bus each, at its own height in the gap under
 * the species. A link that would pass through the classification (a set by
 * name into a family) is left to the other drawings; one decided false is
 * not drawn; with no child decided true, a parent has no bracket. */
function rowTreeLayout(graph: SetGraph): SetGraphLayout {
  const { cardHeight, safeX, padY } = GRAPH_GEOMETRY;
  const levels = treeLevels(graph);
  const levelOf = (id: string) => levels.get(id) ?? 0;
  const tree = graph.nodes.filter((node) => !node.across);
  const bottom = Math.max(0, ...tree.map((node) => levelOf(node.id)));
  const last = Math.max(bottom, ...graph.nodes.map((node) => levelOf(node.id)));
  const isTile = (node: SetGraphNode) => !node.across && levelOf(node.id) === bottom;
  const levelWidth = new Map<number, number>();
  for (const node of graph.nodes) if (!isTile(node)) {
    const at = levelOf(node.id);
    levelWidth.set(at, Math.max(levelWidth.get(at) ?? 0, cardWidthFor(node)));
  }
  const sizeOf = (node: SetGraphNode) => isTile(node) ? { width: TREE_TILE.width, height: TREE_TILE.height }
    : { width: levelWidth.get(levelOf(node.id)) ?? MIN_CARD, height: cardHeight };
  const rowHeight = (at: number) => at === bottom ? TREE_TILE.height : cardHeight;

  const drawn = graph.edges.map((edge, edgeIndex) => ({ edge, edgeIndex })).filter(({ edge }) => {
    const from = levels.get(edge.from), to = levels.get(edge.to);
    if (from === undefined || to === undefined || edge.from === edge.to) return false;
    return edge.tree ? to < from : from === bottom && to === bottom + 1;
  });

  // Across: the members' row, then each row above, then the sets that cut across.
  const across = new Map<string, number>();
  const membersOf = new Map<string, string[]>();
  for (const node of graph.nodes) for (const holder of node.holders) {
    const list = membersOf.get(holder) ?? []; list.push(node.id); membersOf.set(holder, list);
  }
  for (const { edge } of drawn) if (!edge.tree) {
    const list = membersOf.get(edge.to) ?? []; list.push(edge.from); membersOf.set(edge.to, list);
  }
  const byId = new Map(graph.nodes.map((node) => [node.id, node] as const));
  const rowOrder = [bottom, ...Array.from({ length: bottom }, (_, index) => bottom - 1 - index), ...(last > bottom ? [last] : [])];
  for (const at of rowOrder) {
    // A card wider than its members may start left of them: the whole
    // drawing shifts right afterwards, so nothing is pushed off-centre.
    let cursor = at === bottom ? 0 : -Infinity;
    for (const node of graph.nodes) {
      if (levelOf(node.id) !== at) continue;
      const { width } = sizeOf(node);
      const centres = (membersOf.get(node.id) ?? []).flatMap((id) => {
        const x = across.get(id); const member = byId.get(id);
        return x === undefined || !member ? [] : [x + sizeOf(member).width / 2];
      });
      const want = centres.length ? centres.reduce((sum, x) => sum + x, 0) / centres.length - width / 2 : Math.max(cursor, 0);
      const x = Math.max(want, cursor);
      across.set(node.id, x);
      cursor = x + width + (isTile(node) ? TREE_TILE.gap : TREE_CARD_GAP);
    }
  }
  const shift = safeX - Math.min(0, ...across.values());
  for (const [id, x] of across) across.set(id, x + shift);

  // Down: rows separated by gaps; the gap under the species holds one bus per set that cuts across.
  const acrossSets = graph.nodes.filter((node) => node.across && drawn.some(({ edge }) => edge.to === node.id));
  const gapUnder = (at: number) => at === bottom ? Math.max(TREE_ROW_GAP, ACROSS_LANE * (acrossSets.length + 1)) : TREE_ROW_GAP;
  const rowY = new Map<number, number>();
  let y = padY;
  for (let at = 0; at <= last; at++) { rowY.set(at, y); y += rowHeight(at) + (at < last ? gapUnder(at) : 0); }
  const height = Math.ceil(y + padY);

  const nodes: PlacedSetGraphNode[] = [];
  const placed = new Map<string, PlacedSetGraphNode>();
  graph.nodes.forEach((node, nodeIndex) => {
    const at = levelOf(node.id);
    const card: PlacedSetGraphNode = { ...node, nodeIndex, level: at, x: across.get(node.id) ?? safeX, y: rowY.get(at) ?? padY, ...sizeOf(node) };
    nodes.push(card); placed.set(node.id, card);
  });
  const width = Math.ceil(Math.max(0, ...nodes.map((node) => node.x + node.width)) + safeX);
  const centre = (card: PlacedSetGraphNode) => card.x + card.width / 2;
  const brackets: TreeBracket[] = [];

  // The classification: a bracket per parent, children left to right.
  for (const parent of nodes) {
    if (parent.across) continue;
    const links = drawn.filter(({ edge }) => edge.tree && edge.to === parent.id)
      .flatMap(({ edge, edgeIndex }) => { const child = placed.get(edge.from); return child ? [{ edge, edgeIndex, child }] : []; })
      .sort((a, b) => centre(a.child) - centre(b.child));
    if (!links.some(({ edge }) => edge.decided === "true")) continue;
    const trunkX = centre(parent);
    const parentEdge = parent.y + parent.height;
    const busY = parentEdge + gapUnder(levelOf(parent.id)) / 2;
    const connectors = links.map(({ edge, edgeIndex, child }): TreeConnector => {
      const childX = centre(child);
      const run = blockedRun(child, levelOf(parent.id));
      return { child: child.id, edgeIndex, undecided: edge.decided === "undecided", ...(edge.tooltip ? { tooltip: edge.tooltip } : {}),
        points: run === undefined ? [{ x: childX, y: child.y }, { x: childX, y: busY }, { x: trunkX, y: busY }]
          : [{ x: childX, y: child.y }, { x: childX, y: run.jogY }, { x: run.x, y: run.jogY }, { x: run.x, y: busY }, { x: trunkX, y: busY }] };
    });
    brackets.push({ parent: parent.id, across: false, trunk: [{ x: trunkX, y: busY }, { x: trunkX, y: parentEdge }], connectors });
  }

  // A child more than one row under its parent may meet a card on its way
  // up: it jogs once, low in its own row's gap, to the nearest free line.
  function blockedRun(child: PlacedSetGraphNode, parentLevel: number): { x: number; jogY: number } | undefined {
    const childLevel = levelOf(child.id);
    if (childLevel <= parentLevel + 1) return undefined;
    const between = nodes.filter((card) => !card.across && levelOf(card.id) > parentLevel && levelOf(card.id) < childLevel);
    const free = (x: number) => between.every((card) => x < card.x - 6 || x > card.x + card.width + 6);
    const childX = centre(child);
    if (free(childX)) return undefined;
    const candidates = between.flatMap((card) => [card.x - 12, card.x + card.width + 12]).filter(free)
      .sort((a, b) => Math.abs(a - childX) - Math.abs(b - childX));
    const x = candidates[0];
    return x === undefined ? undefined : { x, jogY: child.y - gapUnder(childLevel - 1) / 4 };
  }

  // The sets that cut across, mirrored under the species: one lane each.
  const speciesBottom = (rowY.get(bottom) ?? padY) + rowHeight(bottom);
  const lanesUnder = new Map<string, string[]>();
  for (const set of acrossSets) for (const { edge } of drawn) if (edge.to === set.id) {
    const list = lanesUnder.get(edge.from) ?? []; list.push(set.id); lanesUnder.set(edge.from, list);
  }
  acrossSets.forEach((set, lane) => {
    const card = placed.get(set.id);
    if (!card) return;
    const links = drawn.filter(({ edge }) => !edge.tree && edge.to === set.id)
      .flatMap(({ edge, edgeIndex }) => { const member = placed.get(edge.from); return member ? [{ edge, edgeIndex, member }] : []; })
      .sort((a, b) => centre(a.member) - centre(b.member));
    if (!links.some(({ edge }) => edge.decided === "true")) return;
    const busY = speciesBottom + gapUnder(bottom) * (lane + 1) / (acrossSets.length + 1);
    const trunkX = centre(card);
    const connectors = links.map(({ edge, edgeIndex, member }): TreeConnector => {
      // Several drops under one tile: centred as a group, a few pixels apart.
      const sets = lanesUnder.get(member.id) ?? [set.id];
      const x = centre(member) + (sets.indexOf(set.id) - (sets.length - 1) / 2) * DROP_SPACING;
      return { child: member.id, edgeIndex, undecided: edge.decided === "undecided", ...(edge.tooltip ? { tooltip: edge.tooltip } : {}),
        points: [{ x, y: member.y + member.height }, { x, y: busY }, { x: trunkX, y: busY }] };
    });
    brackets.push({ parent: set.id, across: true, trunk: [{ x: trunkX, y: busY }, { x: trunkX, y: card.y }], connectors });
  });

  return { nodes, edges: [], brackets, more: [], width, height, orientation: "vertical" };
}

/** Above this natural width (one row of leaves), the tree wraps: the twelve
 * species of the species sets keep their one row (about 1,500 px); the tree
 * of life (9,800 px in one row) does not. */
const WRAP_ABOVE = 2400;
/** A set's leaves wrap into rows of at most this many tiles. */
const LEAF_COLUMNS = 4;
/** A set's child sets wrap into rows no wider than this; the top row (the
 * kingdoms side by side under All life) into rows no wider than `WRAP_TOP_ROW`. */
const WRAP_ROW = 1100;
const WRAP_TOP_ROW = 2700;
/** Between two child blocks in a row; between a card (or a row) and the row under it. */
const BLOCK_GAP = 24;
const WRAP_ROW_GAP = 56;
/** A block of several rows keeps this margin on its left: its spine runs down it. */
const SPINE = 16;

/** The same graph top to bottom (Tree). A small tree keeps one row per level
 * (`rowTreeLayout`). A tree wider than `WRAP_ABOVE` wraps instead, so it reads
 * on a desktop card: each set is a block, its card on top and its children
 * below it in rows (leaves in rows of at most four tiles, child sets in rows
 * no wider than `WRAP_ROW`, the top row wider). A block of one row is
 * the classic bracket; a block of several rows is left-aligned and its spine
 * runs down its left margin, one bus per row. A set that cuts across hangs
 * under the leaf grid that holds all its members, each member's line leaving
 * through the gap beside its tile. */
export function nestedSetsTreeLayout(graph: SetGraph): SetGraphLayout {
  const rows = rowTreeLayout(graph);
  return rows.width <= WRAP_ABOVE ? rows : wrappedTreeLayout(graph);
}

/** The x the tree view centres when it opens: the middle of its top row (the root). */
export function treeRootCentre(layout: SetGraphLayout): number | undefined {
  const top = layout.nodes.filter((node) => !node.across && node.level === 0);
  if (!top.length) return undefined;
  const left = Math.min(...top.map((node) => node.x)), right = Math.max(...top.map((node) => node.x + node.width));
  return (left + right) / 2;
}

type WrapCard = { id: string; x: number; y: number; width: number; height: number };
type WrapBlock = { width: number; height: number; cards: WrapCard[]; brackets: TreeBracket[] };

function moveBlock(block: WrapBlock, dx: number, dy: number): WrapBlock {
  const point = (at: Point): Point => ({ x: at.x + dx, y: at.y + dy });
  return { width: block.width, height: block.height,
    cards: block.cards.map((card) => ({ ...card, x: card.x + dx, y: card.y + dy })),
    brackets: block.brackets.map((bracket) => ({ ...bracket, trunk: [point(bracket.trunk[0]), point(bracket.trunk[1])],
      connectors: bracket.connectors.map((connector) => ({ ...connector, points: connector.points.map(point) })) })) };
}

function wrappedTreeLayout(graph: SetGraph): SetGraphLayout {
  const { cardHeight, safeX, padY } = GRAPH_GEOMETRY;
  const levels = treeLevels(graph);
  const byId = new Map(graph.nodes.map((node) => [node.id, node] as const));
  const order = new Map(graph.nodes.map((node, index) => [node.id, index] as const));
  const bottom = Math.max(0, ...graph.nodes.filter((node) => !node.across).map((node) => levels.get(node.id) ?? 0));
  const isLeaf = (id: string) => { const node = byId.get(id); return !!node && !node.across && levels.get(id) === bottom; };
  const sizeOf = (node: SetGraphNode) => isLeaf(node.id) ? { width: TREE_TILE.width, height: TREE_TILE.height } : { width: cardWidthFor(node), height: cardHeight };

  // Each node is drawn once, under its first parent in the data (a tree).
  type Link = { id: string; edgeIndex: number; edge: SetGraphEdge };
  const parentOf = new Map<string, string>();
  const children = new Map<string, Link[]>();
  graph.edges.forEach((edge, edgeIndex) => {
    if (!edge.tree || edge.from === edge.to || !byId.has(edge.from) || !byId.has(edge.to) || parentOf.has(edge.from)) return;
    if (byId.get(edge.from)!.across || byId.get(edge.to)!.across) return;
    parentOf.set(edge.from, edge.to);
    const list = children.get(edge.to) ?? []; list.push({ id: edge.from, edgeIndex, edge }); children.set(edge.to, list);
  });
  for (const list of children.values()) list.sort((a, b) => order.get(a.id)! - order.get(b.id)!);
  // A set that cuts across hangs under the leaf grid holding all its members.
  const acrossLinks = new Map<string, Link[]>();
  graph.edges.forEach((edge, edgeIndex) => {
    if (edge.tree || !byId.get(edge.to)?.across || !isLeaf(edge.from)) return;
    const list = acrossLinks.get(edge.to) ?? []; list.push({ id: edge.from, edgeIndex, edge }); acrossLinks.set(edge.to, list);
  });
  const acrossUnder = new Map<string, string[]>();
  const loose: string[] = [];
  for (const node of graph.nodes) if (node.across) {
    const holders = new Set((acrossLinks.get(node.id) ?? []).map((link) => parentOf.get(link.id)));
    const holder = holders.size === 1 ? [...holders][0] : undefined;
    if (holder !== undefined && (children.get(holder) ?? []).every((link) => isLeaf(link.id))) {
      const list = acrossUnder.get(holder) ?? []; list.push(node.id); acrossUnder.set(holder, list);
    } else loose.push(node.id);
  }

  const connector = (link: Link, points: Point[]): TreeConnector => ({ child: link.id, edgeIndex: link.edgeIndex,
    undecided: link.edge.decided === "undecided", ...(link.edge.tooltip ? { tooltip: link.edge.tooltip } : {}), points });

  /** The sets that cut across, under `cards` (a laid-out grid of leaves), from `top` down. */
  const acrossRow = (ids: readonly string[], cards: readonly WrapCard[], top: number): WrapBlock => {
    const gapUnder = Math.max(TREE_ROW_GAP, ACROSS_LANE * (ids.length + 1));
    const cardTop = top + gapUnder;
    const placed: WrapCard[] = [], brackets: TreeBracket[] = [];
    let cursor = -Infinity;
    ids.forEach((id, lane) => {
      const node = byId.get(id)!, size = sizeOf(node);
      const links = (acrossLinks.get(id) ?? []).flatMap((link) => { const member = cards.find((card) => card.id === link.id); return member ? [{ link, member }] : []; })
        .sort((a, b) => a.member.x - b.member.x);
      const centres = links.map(({ member }) => member.x + member.width / 2);
      const want = centres.length ? centres.reduce((sum, x) => sum + x, 0) / centres.length - size.width / 2 : 0;
      const x = Math.max(want, cursor);
      cursor = x + size.width + TREE_CARD_GAP;
      const card = { id, x, y: cardTop, ...size };
      placed.push(card);
      const busY = top + gapUnder * (lane + 1) / (ids.length + 1);
      const trunkX = x + size.width / 2;
      const lines = links.map(({ link, member }) => {
        const cx = member.x + member.width / 2, foot = member.y + member.height;
        // A tile below this one: leave through the gap on its right.
        const below = cards.some((other) => other.id !== member.id && other.y > member.y && other.x < member.x + member.width && other.x + other.width > member.x);
        const gapX = member.x + member.width + TREE_TILE.gap / 2;
        return connector(link, below
          ? [{ x: cx, y: foot }, { x: cx, y: foot + 6 }, { x: gapX, y: foot + 6 }, { x: gapX, y: busY }, { x: trunkX, y: busY }]
          : [{ x: cx, y: foot }, { x: cx, y: busY }, { x: trunkX, y: busY }]);
      });
      if (lines.some((line) => !line.undecided)) brackets.push({ parent: id, across: true, trunk: [{ x: trunkX, y: busY }, { x: trunkX, y: cardTop }], connectors: lines });
    });
    const right = Math.max(0, ...placed.map((card) => card.x + card.width));
    return { width: right, height: cardTop + Math.max(0, ...placed.map((card) => card.height)) - top, cards: placed, brackets };
  };

  /** A set and everything under it, its card at (0, 0) level. */
  const block = (id: string, top: boolean): WrapBlock => {
    const node = byId.get(id)!, size = sizeOf(node);
    const links = children.get(id) ?? [];
    if (!links.length) return { width: size.width, height: size.height, cards: [{ id, x: 0, y: 0, ...size }], brackets: [] };
    const kids = links.map((link) => ({ link, block: block(link.id, false) }));
    const leaves = kids.every(({ link }) => isLeaf(link.id));
    const gap = leaves ? TREE_TILE.gap : BLOCK_GAP;
    const rowsOf: (typeof kids)[] = [];
    const rowWidth = (row: typeof kids) => row.reduce((sum, kid) => sum + kid.block.width, 0) + gap * (row.length - 1);
    for (const kid of kids) {
      const row = rowsOf[rowsOf.length - 1];
      const full = !row || (leaves ? row.length >= LEAF_COLUMNS : rowWidth(row) + gap + kid.block.width > (top ? WRAP_TOP_ROW : WRAP_ROW));
      if (full) rowsOf.push([kid]); else row!.push(kid);
    }
    const several = rowsOf.length > 1;
    const left = several ? SPINE : 0;
    const content = Math.max(...rowsOf.map(rowWidth));
    let width = Math.max(size.width, left + content);
    const cards: WrapCard[] = [], brackets: TreeBracket[] = [];
    const lines: TreeConnector[] = [];
    const busYs: number[] = [];
    let rowTop = size.height + WRAP_ROW_GAP;
    const kidCards: WrapCard[] = [];
    for (const [index, row] of rowsOf.entries()) {
      const busY = rowTop - WRAP_ROW_GAP / 2;
      busYs.push(busY);
      let x = several ? left : (width - rowWidth(row)) / 2;
      for (const kid of row) {
        const moved = moveBlock(kid.block, x, rowTop);
        cards.push(...moved.cards); brackets.push(...moved.brackets);
        const own = moved.cards.find((card) => card.id === kid.link.id)!;
        kidCards.push(own);
        const cx = own.x + own.width / 2;
        lines.push(connector(kid.link, index === 0 ? [{ x: cx, y: own.y }, { x: cx, y: busY }]
          : [{ x: cx, y: own.y }, { x: cx, y: busY }, { x: SPINE / 2, y: busY }, { x: SPINE / 2, y: busYs[0]! }]));
        x += kid.block.width + gap;
      }
      rowTop += Math.max(...row.map((kid) => kid.block.height)) + WRAP_ROW_GAP;
    }
    let height = rowTop - WRAP_ROW_GAP;
    const cardX = (width - size.width) / 2;
    cards.push({ id, x: cardX, y: 0, ...size });
    const trunkX = cardX + size.width / 2;
    if (lines.some((line) => !line.undecided)) {
      for (const line of lines) line.points.push({ x: trunkX, y: busYs[0]! });
      brackets.push({ parent: id, across: false, trunk: [{ x: trunkX, y: busYs[0]! }, { x: trunkX, y: size.height }], connectors: lines });
    }
    const hanging = acrossUnder.get(id);
    if (hanging && leaves) {
      const row = acrossRow(hanging, kidCards, height);
      cards.push(...row.cards); brackets.push(...row.brackets);
      width = Math.max(width, row.width);
      height += row.height;
    }
    return { width, height, cards, brackets };
  };

  // The roots side by side, then any set that cuts across elsewhere (straight down).
  const roots = graph.nodes.filter((node) => !node.across && !parentOf.has(node.id)).map((node) => block(node.id, true));
  const all: WrapCard[] = [], brackets: TreeBracket[] = [];
  let x = 0, treeHeight = 0;
  for (const root of roots) {
    const moved = moveBlock(root, x, 0);
    all.push(...moved.cards); brackets.push(...moved.brackets);
    x += root.width + BLOCK_GAP; treeHeight = Math.max(treeHeight, root.height);
  }
  if (loose.length) {
    const leafCards = all.filter((card) => isLeaf(card.id));
    const row = acrossRow(loose, leafCards, treeHeight);
    all.push(...row.cards); brackets.push(...row.brackets);
    treeHeight += row.height;
  }
  const minX = Math.min(0, ...all.map((card) => card.x));
  const shifted = moveBlock({ width: 0, height: 0, cards: all, brackets }, safeX - minX, padY);
  const placedById = new Map(shifted.cards.map((card) => [card.id, card] as const));
  const nodes: PlacedSetGraphNode[] = [];
  graph.nodes.forEach((node, nodeIndex) => {
    const card = placedById.get(node.id);
    if (card) nodes.push({ ...node, nodeIndex, level: levels.get(node.id) ?? 0, x: card.x, y: card.y, width: card.width, height: card.height });
  });
  const width = Math.ceil(Math.max(0, ...nodes.map((node) => node.x + node.width)) + safeX);
  const height = Math.ceil(Math.max(0, ...nodes.map((node) => node.y + node.height)) + padY);
  return { nodes, edges: [], brackets: shifted.brackets, more: [], width, height, orientation: "vertical" };
}


/** Pointing at a card: a child lights its own line (its vertical and its
 * stretch of bus) and the trunk, and dims its siblings; the parent lights its
 * whole bracket; any other card dims it. */
export function bracketEmphasis(bracket: TreeBracket, hovered: string | undefined):
  { trunk: "lit" | "dim" | undefined; connectors: Array<"lit" | "dim" | undefined> } {
  if (hovered === undefined) return { trunk: undefined, connectors: bracket.connectors.map(() => undefined) };
  if (hovered === bracket.parent) return { trunk: "lit", connectors: bracket.connectors.map(() => "lit" as const) };
  if (bracket.connectors.some((row) => row.child === hovered)) {
    return { trunk: "lit", connectors: bracket.connectors.map((row) => row.child === hovered ? "lit" as const : "dim" as const) };
  }
  return { trunk: "dim", connectors: bracket.connectors.map(() => "dim" as const) };
}
