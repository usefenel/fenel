/** Where a click on a Dependencies node takes the lens. Pure: it only looks
 * identities up in what this tab already lists, and answers nothing when the
 * node has no place here (a library function, data of another source): such
 * a node is drawn, never a button. */
import type { LocusScope } from "./locus-scope";

type ItemLike = { readonly id: string };
export type DependencyTargetPlaces = {
  /** The tab's root id and its top-level items. */
  rootId?: string;
  rootItems?: readonly ItemLike[];
  lists?: ReadonlyArray<{ readonly id: string; readonly view: { readonly items: readonly ItemLike[] } }>;
  /** The graph's own source packet: an identity that is a saved value names
   * the occurrences that hold it. */
  packetOccurrences?: ReadonlyArray<{ readonly id: string; readonly referenceId?: { readonly $tag: string; readonly _0?: unknown } }>;
  /** Public library and demo entries by identity. */
  catalogPaths?: ReadonlyMap<string, { readonly itemId: string; readonly path: readonly (string | number)[] }>;
};

function itemPlace(id: string, places: DependencyTargetPlaces): LocusScope | undefined {
  if (places.rootId !== undefined && places.rootItems?.some(item => item.id === id)) {
    return { kind: "value", viewId: places.rootId, itemId: id, path: [], rootItem: true };
  }
  const list = places.lists?.find(row => row.view.items.some(item => item.id === id));
  return list ? { kind: "value", viewId: list.id, itemId: id, path: [] } : undefined;
}

export function dependencyNodeTarget(id: string, places: DependencyTargetPlaces): LocusScope | undefined {
  if (typeof id !== "string" || id === "") return undefined;
  const direct = itemPlace(id, places) ?? catalogPlace(id, places);
  if (direct) return direct;
  // A saved value: the first item (or public entry) of this tab that holds it.
  for (const occurrence of places.packetOccurrences ?? []) {
    const reference = occurrence.referenceId;
    if (reference?.$tag !== "Just" || reference._0 !== id) continue;
    const held = itemPlace(occurrence.id, places) ?? catalogPlace(occurrence.id, places);
    if (held) return held;
  }
  return undefined;
}

function catalogPlace(id: string, places: DependencyTargetPlaces): LocusScope | undefined {
  const catalog = places.catalogPaths?.get(id);
  return catalog && places.rootId !== undefined
    ? { kind: "value", viewId: places.rootId, itemId: catalog.itemId, path: [...catalog.path], rootItem: true } : undefined;
}
