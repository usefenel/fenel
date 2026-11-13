// LAUNCH-PLAN row 9: the data half of a function card's plot (see
// function-graph.tsx): the handles, the sampler call and the reply readers.
import type { ExprNode } from "@fenel/engine/authoring/expression";
import type { AuthoringSession } from "./expression-runner/account-authoring-session";
import type { PointLineChartValue } from "./charts";
import type { ReaderRuntime } from "./reader-runtime";

export const FUNCTION_GRAPH_SAMPLER = "DrawingDemo.functionGraph";

/** The worker handles of the sampled function and the sampler, or undefined
 * when this reader cannot name them (yet). */
export function graphHandles(reader: ReaderRuntime | undefined, session: AuthoringSession, pinId: string):
  { fn: string; sampler: string } | undefined {
  if (reader?.kind === "local") {
    const fn = reader.referenceHandle?.(pinId), sampler = reader.referenceHandle?.(FUNCTION_GRAPH_SAMPLER);
    return fn && sampler ? { fn, sampler } : undefined;
  }
  const registry = session.registry;
  const declaration = registry.getIdentifiedFunction(FUNCTION_GRAPH_SAMPLER);
  const sampler = declaration && registry.getUuid(declaration.id);
  const pin = registry.getFunction(pinId);
  const fn = pin && registry.getUuid(pin.id);
  return sampler && fn ? { fn, sampler } : undefined;
}

/** The sampler's call over the judged range (the function as a reference). */
export function functionGraphNode(handles: { fn: string; sampler: string }, range: { lo: number; hi: number }): ExprNode {
  return { kind: "call", fnId: handles.sampler, args: [
    { kind: "literal", value: { $ref: handles.fn } }, { kind: "literal", value: range.lo }, { kind: "literal", value: range.hi },
  ] };
}

/** Only a drawn plan reaches LineChart; a refusal or another value shows nothing. */
export function drawableFunctionGraph(value: unknown): PointLineChartValue | undefined {
  if (!value || typeof value !== "object" || (value as { $tag?: unknown }).$tag !== "PointLineChart") return undefined;
  const plot = (value as { plot?: { path?: unknown; marks?: unknown } }).plot;
  return plot && typeof plot.path === "string" && Array.isArray(plot.marks) ? value as PointLineChartValue : undefined;
}

export function judgedRange(reply: unknown): { lo: number; hi: number } | undefined {
  const graph = reply && typeof reply === "object" ? (reply as { functionGraph?: { range?: { lo?: unknown; hi?: unknown } } }).functionGraph : undefined;
  const range = graph?.range;
  return typeof range?.lo === "number" && typeof range.hi === "number" ? { lo: range.lo, hi: range.hi } : undefined;
}

