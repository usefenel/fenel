// ---------------------------------------------------------------------------
// Layout-aware operations — concrete demonstration that home views are
// just data. Each function takes a layout-able record (HomeView,
// CanvasView, CalendarView, TreeView, etc.) and returns a plain Fenel
// value — count, kind tag, list of dates, flattened tree.
//
// Implementations are defensive: missing fields, bad types, undefined
// inputs all degrade gracefully to sensible defaults so users composing
// with arbitrary records don't get explosions.
// ---------------------------------------------------------------------------

type Item = {
  id?: string;
  caption?: string;
  date?: string;
  ts?: number;
  lat?: number;
  lng?: number;
  children?: Item[];
};

const asItems = (v: unknown): Item[] => {
  if (!v || typeof v !== "object") return [];
  const items = (v as { items?: unknown }).items;
  return Array.isArray(items) ? (items as Item[]) : [];
};

const asKind = (v: unknown): string => {
  if (!v || typeof v !== "object") return "";
  const k = (v as { kind?: unknown }).kind;
  return typeof k === "string" ? k : "";
};

/** Total number of *top-level* items in a layout. For tree views, use
 *  `treeFlatten` first if you want the recursive count. */
export function layoutItemCount(view: unknown): number {
  return asItems(view).length;
}

/** Layout strategy tag — "canvas", "list", "grid", "tree", "tabs",
 *  "calendar", "timeline", "map", or "" for an unrecognized record. */
export function layoutKind(view: unknown): string {
  return asKind(view);
}

/** Captions of all items, in order. Items without a caption become "". */
export function layoutCaptions(view: unknown): string[] {
  return asItems(view).map((it) => it.caption ?? "");
}

/** ISO date strings of items that have a `date` field, in order.
 *  Useful on a CalendarView to enumerate scheduled days. */
export function layoutDates(view: unknown): string[] {
  return asItems(view)
    .map((it) => it.date)
    .filter((d): d is string => typeof d === "string" && d.length > 0);
}

/** Timestamps of items that have a `ts` field, in order. Useful on a
 *  TimelineView. */
export function layoutTimestamps(view: unknown): number[] {
  return asItems(view)
    .map((it) => it.ts)
    .filter((t): t is number => typeof t === "number");
}

/** {lat, lng} pairs of items that have both, in order. Useful on a
 *  MapView. */
export function layoutCoords(view: unknown): { lat: number; lng: number }[] {
  return asItems(view)
    .filter((it) => typeof it.lat === "number" && typeof it.lng === "number")
    .map((it) => ({ lat: it.lat as number, lng: it.lng as number }));
}

/** Recursively walk a tree view, returning every node in DFS order. For
 *  non-tree views it just returns the top-level items. */
export function layoutTreeFlatten(view: unknown): Item[] {
  const items = asItems(view);
  const out: Item[] = [];
  const walk = (xs: Item[]) => {
    for (const x of xs) {
      out.push(x);
      if (Array.isArray(x.children)) walk(x.children);
    }
  };
  walk(items);
  return out;
}

/** Maximum depth of a tree view (0 for an empty view, 1 for a flat
 *  list of leaves, etc.). For non-tree views: returns 1 if there are
 *  items, 0 otherwise. */
export function layoutTreeDepth(view: unknown): number {
  const items = asItems(view);
  let max = 0;
  const walk = (xs: Item[], depth: number) => {
    if (xs.length === 0) return;
    if (depth > max) max = depth;
    for (const x of xs) {
      if (Array.isArray(x.children) && x.children.length > 0) {
        walk(x.children, depth + 1);
      }
    }
  };
  walk(items, 1);
  return max;
}

/** Short human-readable summary of a layout. e.g. "5 items · canvas" or
 *  "12 items · calendar · 7 with dates". */
export function layoutSummary(view: unknown): string {
  const kind = asKind(view) || "(unknown)";
  const items = asItems(view);
  const count = items.length;
  const noun = count === 1 ? "item" : "items";
  let extra = "";
  if (kind === "calendar") {
    const withDates = items.filter((it) => typeof it.date === "string").length;
    extra = ` · ${withDates} with dates`;
  } else if (kind === "timeline") {
    const withTs = items.filter((it) => typeof it.ts === "number").length;
    extra = ` · ${withTs} timestamped`;
  } else if (kind === "map") {
    const withCoords = items.filter((it) => typeof it.lat === "number" && typeof it.lng === "number").length;
    extra = ` · ${withCoords} pinned on map`;
  } else if (kind === "tree") {
    extra = ` · depth ${layoutTreeDepth(view)}`;
  }
  return `${count} ${noun} · ${kind}${extra}`;
}
