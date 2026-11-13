/** Mechanical authoring adapters for view:placeAll and view:placeEntries. Shared by persistence
 * migration and the web renderer. The definition, default placement and
 * derivation execute in fenel/modules/view/types.fenel. No IO or runtime
 * imports belong here, so a lightweight shell can decode persisted data. */
import type { ExprNode } from "./expression-authoring";
import type { FenelType } from "../types";

export const PLACE_ALL_FUNCTION = "view:placeAll";
/** A canvas over a data set's entries: placements keyed by occurrence id. */
export const PLACE_ENTRIES_FUNCTION = "view:placeEntries";

/** The current reader's identified-function lookup. Its misses and refusals
 * are authoritative; labels and code names never substitute for identity. */
export type CanvasFunctionIdentityResolver = (handle: string) => { readonly id: string } | undefined;

function canvasFunction(expr: ExprNode | undefined, resolveFunction?: CanvasFunctionIdentityResolver): string | undefined {
  if (expr?.kind !== "call" || expr.args.length !== 2) return undefined;
  if (resolveFunction === undefined) {
    return expr.fnId === PLACE_ALL_FUNCTION || expr.fnId === PLACE_ENTRIES_FUNCTION ? expr.fnId : undefined;
  }
  try {
    const actual = resolveFunction(expr.fnId)?.id;
    if (typeof actual !== "string" || actual.length === 0) return undefined;
    const positional = resolveFunction(PLACE_ALL_FUNCTION)?.id;
    const keyed = resolveFunction(PLACE_ENTRIES_FUNCTION)?.id;
    if (actual === positional && actual === keyed) return undefined;
    if (actual === positional) return PLACE_ALL_FUNCTION;
    if (actual === keyed) return PLACE_ENTRIES_FUNCTION;
  } catch {
    // A hidden, ambiguous or retired reader lookup cannot classify the wire.
  }
  return undefined;
}

export type OptionalNumber = { $tag: "Nothing" } | { $tag: "Just"; _0: number };
/** A `view:Placement` value. Placements written before the constructor tag
 * was authored have none; readers accept both. */
export type CanvasPlacement = {
  $tag?: "Placement";
  at: { x: number; y: number };
  width: OptionalNumber;
  height: OptionalNumber;
};
export type AuthoredPlacement = { $tag: "Nothing" } | { $tag: "Just"; _0: CanvasPlacement };
export type PlacedValue = { placement: CanvasPlacement; item: unknown };
/** A `view:KeyedPlacement`: the placement authored for the entry whose id is `key`. */
export type KeyedPlacement = { $tag: "KeyedPlacement"; key: string; placement: CanvasPlacement };

export function canvasExpression(source: ExprNode, placements: readonly AuthoredPlacement[] = []): ExprNode {
  return {
    kind: "call",
    fnId: PLACE_ALL_FUNCTION,
    args: [source, { kind: "literal", value: [...placements] }],
  };
}

/** A canvas over a data set's entries (`view:placeEntries`). */
export function entriesCanvasExpression(entries: ExprNode, placements: readonly KeyedPlacement[] = []): ExprNode {
  return {
    kind: "call",
    fnId: PLACE_ENTRIES_FUNCTION,
    args: [entries, { kind: "literal", value: [...placements] }],
  };
}

/** Either canvas derivation: positional (`placeAll`) or keyed (`placeEntries`). */
export function isCanvasExpression(expr: ExprNode | undefined, resolveFunction?: CanvasFunctionIdentityResolver): expr is Extract<ExprNode, { kind: "call" }> {
  return canvasFunction(expr, resolveFunction) !== undefined;
}

export function isEntriesCanvasExpression(expr: ExprNode | undefined, resolveFunction?: CanvasFunctionIdentityResolver): expr is Extract<ExprNode, { kind: "call" }> {
  return canvasFunction(expr, resolveFunction) === PLACE_ENTRIES_FUNCTION;
}

export function canvasSource(expr: ExprNode, resolveFunction?: CanvasFunctionIdentityResolver): ExprNode | undefined {
  return isCanvasExpression(expr, resolveFunction) ? expr.args[0] : undefined;
}

function optionalNumber(value: unknown): value is OptionalNumber {
  if (!value || typeof value !== "object") return false;
  const node = value as Record<string, unknown>;
  return node.$tag === "Nothing"
    || (node.$tag === "Just" && typeof node._0 === "number" && Number.isFinite(node._0));
}

export function isCanvasPlacement(value: unknown): value is CanvasPlacement {
  if (!value || typeof value !== "object") return false;
  const node = value as Record<string, unknown>;
  const at = node.at as Record<string, unknown> | undefined;
  return (node.$tag === undefined || node.$tag === "Placement")
    && !!at && typeof at === "object"
    && typeof at.x === "number" && Number.isFinite(at.x)
    && typeof at.y === "number" && Number.isFinite(at.y)
    && optionalNumber(node.width) && optionalNumber(node.height);
}

export function isPlacedValue(value: unknown): value is PlacedValue {
  return !!value && typeof value === "object" && "item" in value
    && "placement" in value && isCanvasPlacement(value.placement);
}

/** A positional canvas's placement argument; a keyed canvas has none. */
export function authoredPlacements(expr: ExprNode, resolveFunction?: CanvasFunctionIdentityResolver): readonly AuthoredPlacement[] | undefined {
  if (canvasFunction(expr, resolveFunction) !== PLACE_ALL_FUNCTION || expr.kind !== "call") return undefined;
  const arg = expr.args[1];
  if (arg?.kind !== "literal" || !Array.isArray(arg.value)) return undefined;
  return arg.value.every((entry: unknown) => {
    if (!entry || typeof entry !== "object" || !("$tag" in entry)) return false;
    return entry.$tag === "Nothing"
      || (entry.$tag === "Just" && "_0" in entry && isCanvasPlacement(entry._0));
  }) ? arg.value as AuthoredPlacement[] : undefined;
}

/** Dragging edits just one argument slot. A computed placement argument is
 * intentionally not replaced with a literal: doing so would discard code. */
export function withCanvasPlacement(expr: ExprNode, index: number, placement: CanvasPlacement,
  resolveFunction?: CanvasFunctionIdentityResolver): ExprNode {
  if (!Number.isInteger(index) || index < 0 || !isCanvasPlacement(placement)) {
    throw new Error("A canvas placement needs a valid item index and finite coordinates.");
  }
  const existing = authoredPlacements(expr, resolveFunction);
  if (!existing || !isCanvasExpression(expr, resolveFunction)) {
    throw new Error("Edit this canvas's placement expression to change its positions.");
  }
  const next = [...existing];
  while (next.length <= index) next.push({ $tag: "Nothing" });
  next[index] = { $tag: "Just", _0: placement };
  return { ...expr, args: [expr.args[0]!, { kind: "literal", value: next }] };
}

export function isKeyedPlacement(value: unknown): value is KeyedPlacement {
  if (!value || typeof value !== "object") return false;
  const node = value as Record<string, unknown>;
  return node.$tag === "KeyedPlacement" && typeof node.key === "string" && node.key.length > 0
    && isCanvasPlacement(node.placement);
}

/** A keyed canvas's placement argument, when it is literal data. */
export function keyedPlacements(expr: ExprNode, resolveFunction?: CanvasFunctionIdentityResolver): readonly KeyedPlacement[] | undefined {
  if (!isEntriesCanvasExpression(expr, resolveFunction)) return undefined;
  const arg = expr.args[1];
  if (arg?.kind !== "literal" || !Array.isArray(arg.value)) return undefined;
  return arg.value.every(isKeyedPlacement) ? arg.value as KeyedPlacement[] : undefined;
}

/** Dragging a card of a keyed canvas sets the placement for its entry's id,
 * in place when one exists. With `liveKeys`, placements for entries that are
 * gone are dropped at the same time, so the argument does not grow forever. A
 * computed placement argument is refused, as for a positional canvas. */
export function withKeyedPlacement(expr: ExprNode, key: string, placement: CanvasPlacement,
  liveKeys?: ReadonlySet<string>, resolveFunction?: CanvasFunctionIdentityResolver): ExprNode {
  if (typeof key !== "string" || key.length === 0 || !isCanvasPlacement(placement)) {
    throw new Error("A canvas placement needs an entry id and finite coordinates.");
  }
  const existing = keyedPlacements(expr, resolveFunction);
  if (!existing || !isEntriesCanvasExpression(expr, resolveFunction)) {
    throw new Error("Edit this canvas's placement expression to change its positions.");
  }
  const authored: KeyedPlacement = { $tag: "KeyedPlacement", key, placement };
  const kept = existing.filter((entry) => entry.key === key || !liveKeys || liveKeys.has(entry.key));
  const at = kept.findIndex((entry) => entry.key === key);
  const next = at < 0 ? [...kept, authored] : kept.map((entry, index) => index === at ? authored : entry);
  return { ...expr, args: [expr.args[0]!, { kind: "literal", value: next }] };
}

export function placementFromGeometry(item: { x?: number; y?: number; w?: number; h?: number }): CanvasPlacement {
  if (typeof item.x !== "number" || !Number.isFinite(item.x)
    || typeof item.y !== "number" || !Number.isFinite(item.y)) {
    throw new Error("A canvas item needs finite coordinates.");
  }
  // `view:Placement` declares `width: Maybe Number`: no positivity, the same
  // rule `isCanvasPlacement` reads with. Rejecting here as well made one
  // hand-authored or legacy zero size block every later move of its card, and
  // the migration of the list holding it.
  const dimension = (value: number | undefined): OptionalNumber => {
    if (value === undefined) return { $tag: "Nothing" };
    if (!Number.isFinite(value)) throw new Error("A canvas size must be a finite number.");
    return { $tag: "Just", _0: value };
  };
  // The same shape `view:defaultPlacement` evaluates to: a `Placement` value.
  return { $tag: "Placement", at: { x: item.x, y: item.y }, width: dimension(item.w), height: dimension(item.h) };
}

/** An ordinary type expression; the registered Fenel type definitions remain
 * the authority for List and Placed, rather than a second field schema here. */
export function placedListType(itemType: FenelType): FenelType {
  return { $el: { call: ["List", { $el: { call: ["Placed", itemType] } }] } };
}
