// The species sets drawn as a graph (nested-sets-graph.ts lays it out), left
// to right ("Graph") or top to bottom ("Tree"): the same cards and arrows as
// the Dependencies panel (dependency-graph-drawing.tsx), with the "is a
// subset of" arrow style. The drawing keeps its natural size and scrolls
// inside its frame both ways; "Fit" scales it down to the card's width. Every
// node is drawn. Each set that cuts across the families has its own tint, on
// its card and on the arrows into it; pointing at a card lights the arrows
// that touch it. Cards are not clickable: the model carries no identity of a
// species, genus or family to open (see nested-sets-format.ts).
// Solid/browser renderer allowance — the same kind as the other card surfaces.

import { For, Show, createEffect, createMemo, createSignal, createUniqueId, onSettled } from "solid-js";
import { GraphArrow, GraphNodeFrame } from "./dependency-graph-drawing";
import { DataPreview } from "./data-transfer/DataPreview";
import { IconByName } from "./icons";
import { typeIconForPresentation } from "./type-icon-presentation";
import { bracketEmphasis, crossSetTints, fitScale, nestedSetsGraphLayout, nestedSetsTreeLayout, treeRootCentre, type PlacedSetGraphNode, type SetGraph,
  type TreeBracket } from "./nested-sets-graph";
import { roundedPath } from "./dependency-graph-layout";
import { ItemMark, LinkMarks } from "./nested-sets-classification-view";

/** The model carries no type of its own: species are records, the others are
 * sets. The marks come from the shared fallback catalogue. */
const SPECIES_ICON = typeIconForPresentation(undefined, { kindLabel: "Record" });
const SET_ICON = typeIconForPresentation(undefined, { kindLabel: "Type" });

const tintVar = (slot: number | undefined) => slot === undefined ? undefined : `var(--nested-sets-tint-${slot})`;

function SetGraphCard(props: { node: PlacedSetGraphNode; tile: boolean; tint: string | undefined; onHover: (id: string | undefined) => void }) {
  const style = () => {
    const box: Record<string, string> = { left: `${props.node.x}px`, top: `${props.node.y}px`, width: `${props.node.width}px`, height: `${props.node.height}px` };
    if (props.tint) box["--set-tint"] = props.tint;
    return box;
  };
  const icon = (size: number) => <IconByName name={props.node.kind === "species" ? SPECIES_ICON : SET_ICON} size={size} />;
  // A classification's node is its item: its mark is the item's own glyph (its list circle's).
  const mark = (size: number) => <Show when={props.node.item !== undefined} fallback={<Show when={props.node.picture} fallback={icon(size)}>
    {(picture) => <DataPreview value={picture()} thumbnail />}
  </Show>}><ItemMark value={props.node.item} /></Show>;
  const detail = () => <Show when={props.node.detail}>{(text) =>
    <span class={["nested-sets-graph__detail", { "nested-sets-graph__italic": props.node.detailItalic }]}>{text()}</span>}</Show>;
  return <GraphNodeFrame id={props.node.id} label={props.node.label} style={style()}
    data={{ "data-set-node": props.node.kind, "data-set-tint": props.tint ? "" : undefined }}
    onPointerEnter={() => props.onHover(props.node.id)} onPointerLeave={() => props.onHover(undefined)}>
    <Show when={props.tile} fallback={<div class="nested-sets-graph__card">
      <span class="home-item__value-icon nested-sets-graph__mark" aria-hidden="true">{mark(15)}</span>
      <span class="nested-sets-graph__text">
        <span class={["nested-sets-graph__title", { "nested-sets-graph__italic": props.node.titleItalic }]}>{props.node.title}</span>
        {detail()}
      </span>
      <LinkMarks link={props.node.link} />
    </div>}>
      {/* A species in the tree: its picture as a large mark, then its names. */}
      <div class="nested-sets-tree__tile">
        <span class="nested-sets-tree__picture-wrap">
          <span class="nested-sets-tree__picture" aria-hidden="true">{mark(26)}</span>
          <LinkMarks link={props.node.link} />
        </span>
        <span class={["nested-sets-tree__name", { "nested-sets-graph__italic": props.node.titleItalic }]}>{props.node.title}</span>
        {detail()}
      </div>
    </Show>
  </GraphNodeFrame>;
}

/** The tree's and the graph's line weight: thinner than the Dependencies
 * panel's arrows (whose default this option leaves unchanged). */
const CONNECTOR_WEIGHT = 1.25;

/** One parent's bracket: each child's line (its vertical, then its stretch
 * of the shared bus, rounded where they meet), then the trunk into the parent
 * with the bracket's one hollow arrowhead. An undecided child's line is
 * dashed and says so on hover. */
function TreeBracketPath(props: { bracket: TreeBracket; id: string; tone: string | undefined; hovered: string | undefined }) {
  const emphasis = () => bracketEmphasis(props.bracket, props.hovered);
  return <g class="nested-sets-tree__bracket" data-bracket={props.bracket.parent} style={{ color: props.tone ?? SUBSET_COLOR }}>
    <For each={props.bracket.connectors}>{(connector, index) => <g class="nested-sets-tree__connector"
      data-child={connector.child} data-decided={connector.undecided ? "undecided" : undefined} data-emphasis={emphasis().connectors[index()]}
      data-tooltip={connector.tooltip} data-tooltip-follow-cursor={connector.tooltip ? "" : undefined}>
      <path d={roundedPath(connector.points)} fill="none" stroke="currentColor" stroke-width={CONNECTOR_WEIGHT}
        stroke-linejoin="round" stroke-linecap="round" stroke-dasharray={connector.undecided ? "5 4" : undefined} />
      <Show when={connector.tooltip}><path d={roundedPath(connector.points)} fill="none" stroke="transparent" stroke-width="12" pointer-events="stroke" /></Show>
    </g>}</For>
    <GraphArrow id={props.id} points={props.bracket.trunk} relation="subset" tone={props.tone} weight={CONNECTOR_WEIGHT} solid
      emphasis={emphasis().trunk} />
  </g>;
}

/** The subset relation's line colour (dependency-graph-drawing.tsx). */
const SUBSET_COLOR = "#94a3b8";

export function NestedSetsGraph(props: { graph: SetGraph; orientation: "graph" | "tree"; fit: boolean }) {
  const gradient = createUniqueId();
  const [available, setAvailable] = createSignal(0);
  const [hovered, setHovered] = createSignal<string>();
  let viewport!: HTMLDivElement;
  onSettled(() => {
    const measure = () => setAvailable(viewport.clientWidth);
    const observer = new ResizeObserver(measure);
    observer.observe(viewport); measure();
    return () => observer.disconnect();
  });
  // Natural size; a wider card centres the drawing (CSS), a narrower one scrolls.
  const layout = createMemo(() => props.orientation === "tree" ? nestedSetsTreeLayout(props.graph) : nestedSetsGraphLayout(props.graph, { width: 0 }));
  const scale = () => props.fit ? fitScale(layout().width, available()) : 1;
  const tints = createMemo(() => crossSetTints(props.graph));
  const bottom = createMemo(() => Math.max(0, ...layout().nodes.filter((node) => !node.across).map((node) => node.level ?? 0)));
  const edge = (edgeIndex: number) => props.graph.edges[edgeIndex]!;
  // The tree opens on its root: All life centred, at the top (a wide tree
  // otherwise opened on its empty top-left corner).
  createEffect(() => {
    if (props.orientation !== "tree") return undefined;
    const centre = treeRootCentre(layout()), width = available();
    return centre === undefined || width === 0 ? undefined : Math.max(0, Math.round(centre * scale() - width / 2));
  }, (left) => {
    if (left === undefined) return;
    viewport.scrollLeft = left;
    viewport.scrollTop = 0;
  });
  const emphasis = (from: string, to: string) => {
    const at = hovered();
    return at === undefined ? undefined : at === from || at === to ? "lit" as const : "dim" as const;
  };
  return <div class="nested-sets-graph__viewport" ref={viewport} data-fit={props.fit ? "true" : undefined}>
    <div class="nested-sets-graph__sizer" style={{ width: `${Math.ceil(layout().width * scale())}px`, height: `${Math.ceil(layout().height * scale())}px` }}>
      <div class="dependency-graph-canvas nested-sets-graph" data-orientation={layout().orientation}
        style={{ width: `${layout().width}px`, height: `${layout().height}px`,
          ...(scale() < 1 ? { transform: `scale(${scale()})`, "transform-origin": "0 0" } : {}) }}
        role="group" aria-label={props.orientation === "tree" ? "Species sets as a tree" : "Species sets as a graph"}>
        <svg class="dependency-graph" width={layout().width} height={layout().height}
          viewBox={`0 0 ${layout().width} ${layout().height}`} aria-hidden="true">
          {/* In plan order: the classification first, the sets that cut across above it. */}
          <For each={layout().edges}>{(routed, index) => <GraphArrow id={`${gradient}-${index()}`} points={routed.points}
            relation={edge(routed.edgeIndex).relation} undecided={edge(routed.edgeIndex).decided === "undecided"}
            tooltip={edge(routed.edgeIndex).tooltip} tone={tintVar(tints().get(routed.to))}
            emphasis={emphasis(routed.from, routed.to)} weight={CONNECTOR_WEIGHT} />}</For>
          {/* The tree: one bracket per parent, the classification first, the sets that cut across after. */}
          <For each={layout().brackets}>{(bracket, index) => <TreeBracketPath bracket={bracket} id={`${gradient}-b${index()}`}
            tone={bracket.across ? tintVar(tints().get(bracket.parent)) : undefined} hovered={hovered()} />}</For>
        </svg>
        <For each={layout().nodes}>{(node) => <SetGraphCard node={node} tint={tintVar(tints().get(node.id))} onHover={(id) => setHovered(id)}
          tile={props.orientation === "tree" && !node.across && node.level === bottom()} />}</For>
      </div>
    </div>
  </div>;
}
