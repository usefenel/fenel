/** Renderer projection for ordinary Fenel placed data. The shared authoring
 * codec stays independent of the browser and persistence transport. */
import type { LayoutItem } from "./locus-view-model";
import { isPlacedValue, placementFromGeometry, type PlacedValue } from "../../../../../implementations/typescript/engine/src/authoring/locus-canvas";
export * from "../../../../../implementations/typescript/engine/src/authoring/locus-canvas";
export const placementFromItem = placementFromGeometry;

/** Keep caller-owned ids, captions and types; unwrap only the subject and
 * authored geometry. The result is a disposable renderer projection. */
export function projectPlacedItems(
  value: unknown,
  makeItem: (item: unknown, index: number) => LayoutItem,
): LayoutItem[] | undefined {
  if (!Array.isArray(value) || !value.every(isPlacedValue)) return undefined;
  return value.map((placed: PlacedValue, index) => ({
    ...makeItem(placed.item, index),
    x: placed.placement.at.x,
    y: placed.placement.at.y,
    w: placed.placement.width.$tag === "Just" ? placed.placement.width._0 : undefined,
    h: placed.placement.height.$tag === "Just" ? placed.placement.height._0 : undefined,
  }));
}
