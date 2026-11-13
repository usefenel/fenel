/** Arrow geometry for the If decision (`IfGraphSurface`), in the surface's
 * own coordinates. Pure: the surface measures the DOM and paints these edges
 * with the call graph's own arrow (`ExpressionGraphArrow`).
 *
 * The condition flows into the one dot above If. Under If, one dot per branch
 * sends an arrow into its branch (True, then False). When a narrow screen
 * stacks the branches, the False arrow runs down a side lane (`gutter`) past
 * the True branch instead of crossing it. */
export type IfGraphBox = { left: number; right: number; top: number; bottom: number };
export type IfGraphDot = { x: number; y: number; radius: number };
export type IfGraphEdge = { path: string; x: number; y: number; startX: number; startY: number; endX: number; endY: number;
  via: { x: number; y: number }[] };
export type IfGraphLabelSide = "start" | "end";

export function ifGraphEdges(input: {
  /** The condition's visible bottom: its result chip, or the whole condition. */
  condition: IfGraphBox;
  /** The box is not a centred chip: start straight above the dot instead. */
  straightCondition?: boolean;
  conditionDot: IfGraphDot;
  trueDot: IfGraphDot;
  falseDot: IfGraphDot;
  /** Each branch's content box (below its label). */
  whenTrue: IfGraphBox;
  whenFalse: IfGraphBox;
  /** The x of the side lane used when the branches stack. */
  gutter: number;
}): { condition: IfGraphEdge; whenTrue: IfGraphEdge; whenFalse: IfGraphEdge; stacked: boolean;
  trueLabelSide: IfGraphLabelSide; falseLabelSide: IfGraphLabelSide } {
  const conditionStart = { x: input.straightCondition ? input.conditionDot.x : centre(input.condition), y: input.condition.bottom + 2 };
  const condition = edge(conditionStart, [], approach(input.conditionDot, conditionStart));
  const stacked = input.whenFalse.top >= input.whenTrue.bottom - 1;
  const trueTarget = { x: centre(input.whenTrue), y: input.whenTrue.top - 2 };
  const falseTarget = { x: centre(input.whenFalse), y: input.whenFalse.top - 2 };
  const whenTrue = edge(leave(input.trueDot, trueTarget), [], trueTarget);
  const lane = stacked ? [{ x: input.gutter, y: input.falseDot.y + 16 },
    { x: input.gutter, y: Math.max(input.falseDot.y + 16, input.whenFalse.top - 26) }] : [];
  const whenFalse = edge(leave(input.falseDot, lane[0] ?? falseTarget), lane, falseTarget);
  return { condition, whenTrue, whenFalse, stacked,
    trueLabelSide: labelSide(whenTrue, "start"), falseLabelSide: labelSide(whenFalse, "end") };
}

const centre = (box: IfGraphBox) => (box.left + box.right) / 2;

/** A point on the dot's ring (with the input arrows' 2px gap), facing `toward`. */
function ring(dot: IfGraphDot, toward: { x: number; y: number }, fallbackY: number) {
  const dx = toward.x - dot.x, dy = toward.y - dot.y;
  const distance = Math.hypot(dx, dy);
  const clearance = dot.radius + 2;
  return distance ? { x: dot.x + dx / distance * clearance, y: dot.y + dy / distance * clearance }
    : { x: dot.x, y: dot.y + fallbackY * clearance };
}
const approach = (dot: IfGraphDot, from: { x: number; y: number }) => ring(dot, from, -1);
const leave = (dot: IfGraphDot, toward: { x: number; y: number }) => ring(dot, toward, 1);

function edge(start: { x: number; y: number }, via: { x: number; y: number }[], end: { x: number; y: number }): IfGraphEdge {
  const path = `M ${[start, ...via, end].map(point => `${point.x} ${point.y}`).join(" L ")}`;
  return { path, x: 0, y: 0, startX: start.x, startY: start.y, endX: end.x, endY: end.y, via };
}

/** The label goes on the side away from the arrow's last leg. */
function labelSide(edge: IfGraphEdge, fallback: IfGraphLabelSide): IfGraphLabelSide {
  const from = edge.via.at(-1) ?? { x: edge.startX, y: edge.startY };
  const dx = edge.endX - from.x;
  return Math.abs(dx) < 4 ? fallback : dx < 0 ? "start" : "end";
}
