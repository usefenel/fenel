// The drawing every column-laid graph shares: the node card's frame and the
// arrow. The Dependencies panel (dependency-graph-dialog.tsx) and the species
// sets graph (nested-sets-graph-view.tsx) both draw with these, over the
// geometry of dependency-graph-layout.ts. Styles: data-inspection-dialog.css.

import { createMemo, Show } from "solid-js";
import type { JSX } from "@solidjs/web";
import { roundedPath } from "./dependency-graph-layout";

/** Edge styles by relation: "refers to" (references and calls) is solid
 * slate with a filled head; "is a subset of" (also "is a member of") keeps
 * the same route and thickness, in a lighter slate with a hollow head. */
export type GraphEdgeRelation = "reference" | "subset";
const GRAPH_EDGE_STYLES: Record<GraphEdgeRelation, { color: string; hollowHead?: boolean }> = {
  reference: { color: "#64748b" },
  subset: { color: "#94a3b8", hollowHead: true },
};

/** One arrow, drawn like the expression graph's: a 3 px shaft fading in from
 * its source, a soft relief under it and a separate sharp head on the card
 * edge. The route is axis-aligned and always enters its card horizontally.
 * An undecided relation is dashed and says so on hover (`tooltip`). */
export function GraphArrow(props: { id: string; points: ReadonlyArray<{ x: number; y: number }>; relation: GraphEdgeRelation;
  undecided?: boolean; tooltip?: string;
  /** A colour of its own (a set's tint) in place of the relation's. */
  tone?: string;
  /** Pointing at a card lights the arrows that touch it and dims the others. */
  emphasis?: "lit" | "dim";
  /** The shaft's stroke width; 3 by default (the Dependencies panel). A thin
   * line also gets a smaller head. */
  weight?: number;
  /** One flat colour instead of the fade in from the source (a tree's trunk
   * continues lines that are already at full colour). */
  solid?: boolean }) {
  const style = () => GRAPH_EDGE_STYLES[props.relation];
  const weight = () => props.weight ?? 3;
  const thin = () => weight() < 2;
  const paint = createMemo(() => {
    const points = props.points;
    if (points.length < 2) return undefined;
    const tip = points[points.length - 1]!, before = points[points.length - 2]!;
    // A route always enters its card square to the side it meets: sideways
    // in the left-to-right graphs, upright in the top-to-bottom tree.
    const [length, half, inset] = thin() ? [10, 5, 8] : [12, 6, 9];
    // A straight line at an angle (the linked-data graph, where cards spread
    // in every direction): its head points along the line.
    if (tip.x !== before.x && tip.y !== before.y) {
      const span = Math.hypot(tip.x - before.x, tip.y - before.y);
      const ux = (tip.x - before.x) / span, uy = (tip.y - before.y) / span;
      const bx = tip.x - ux * length, by = tip.y - uy * length;
      return { path: roundedPath([...points.slice(0, -1), { x: tip.x - ux * inset, y: tip.y - uy * inset }]), start: points[0]!, tip,
        head: `M ${tip.x} ${tip.y} L ${bx - uy * half} ${by + ux * half} L ${bx + uy * half} ${by - ux * half} Z` };
    }
    if (Math.abs(tip.y - before.y) > Math.abs(tip.x - before.x)) {
      const direction = Math.sign(tip.y - before.y) || 1;
      const shaft = [...points.slice(0, -1), { x: tip.x, y: tip.y - direction * inset }];
      const base = tip.y - direction * length;
      return { path: roundedPath(shaft), start: points[0]!, tip,
        head: `M ${tip.x} ${tip.y} L ${tip.x - half} ${base} L ${tip.x + half} ${base} Z` };
    }
    const direction = Math.sign(tip.x - before.x) || 1;
    const shaft = [...points.slice(0, -1), { x: tip.x - direction * inset, y: tip.y }];
    const base = tip.x - direction * length;
    return { path: roundedPath(shaft), start: points[0]!, tip,
      head: `M ${tip.x} ${tip.y} L ${base} ${tip.y - half} L ${base} ${tip.y + half} Z` };
  });
  return <Show when={paint()}>{arrow => <g class="dependency-graph__arrow" data-relation={props.relation}
    data-decided={props.undecided ? "undecided" : undefined} data-emphasis={props.emphasis} data-tooltip={props.tooltip}
    data-tooltip-follow-cursor={props.tooltip ? "" : undefined} style={{ color: props.tone ?? style().color }}>
    <defs>
      <linearGradient id={props.id} gradientUnits="userSpaceOnUse"
        x1={arrow().start.x} y1={arrow().start.y} x2={arrow().tip.x} y2={arrow().tip.y}>
        <stop offset="0" stop-color="currentColor" stop-opacity="0.42" />
        <stop offset="1" stop-color="currentColor" stop-opacity="1" />
      </linearGradient>
    </defs>
    <Show when={!thin()}><path d={arrow().path} fill="none" stroke="currentColor" stroke-width={weight() + 2} opacity="0.14" transform="translate(0, 1)" /></Show>
    <path class="dependency-graph__edge" d={arrow().path} fill="none" stroke={props.solid ? "currentColor" : `url(#${props.id})`} stroke-width={weight()}
      stroke-linejoin="round" stroke-linecap={thin() ? "round" : undefined} stroke-dasharray={props.undecided ? (thin() ? "5 4" : "6 5") : undefined} />
    <path d={arrow().head} fill={style().hollowHead ? "#fff" : "currentColor"} stroke={style().hollowHead ? "currentColor" : "none"}
      stroke-width={style().hollowHead ? (thin() ? weight() : 1.5) : undefined} stroke-linejoin={thin() ? "round" : undefined} />
    {/* The drawing ignores the pointer; only an arrow with words to say takes a hover. */}
    <Show when={props.tooltip}><path d={arrow().path} fill="none" stroke="transparent" stroke-width="12" pointer-events="stroke" /></Show>
  </g>}</Show>;
}

/** A node's card frame: the white box a graph places (absolutely, through
 * `style`) and names for hover and assistive technology. Its content is the
 * caller's: the Dependencies caption, or a set's name and count. */
export function GraphNodeFrame(props: { id: string; label: string; focus?: boolean; opens?: boolean;
  style?: Record<string, string>; data?: Record<string, string | undefined>; children: JSX.Element;
  onPointerEnter?: () => void; onPointerLeave?: () => void }) {
  return <div class={["dependency-graph-node", { "dependency-graph-node--focus": !!props.focus, "dependency-graph-node--opens": !!props.opens }]}
    data-dependency-node={props.id} aria-current={props.focus ? "true" : undefined} style={props.style}
    role="group" aria-label={props.label} data-tooltip={props.label} {...(props.data ?? {})}
    onPointerEnter={() => props.onPointerEnter?.()} onPointerLeave={() => props.onPointerLeave?.()}>
    {props.children}
  </div>;
}
