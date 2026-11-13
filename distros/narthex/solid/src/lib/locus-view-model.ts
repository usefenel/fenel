// ---------------------------------------------------------------------------
// locus-view-model — what a Locus view IS, and how to put something in one.
//
// Extracted verbatim out of `routes/app/home.tsx` so the SHELL can pin a value
// before the typed workspace exists. Everything here is plain decoding and API
// calls: no engine import, nothing that needs a built registry. That property
// is the point, exactly as in `data-items/user-items` — a value import from
// `@fenel/engine` here would put the 3-minute workspace build back in front of
// "right-click, type a string, press Enter".
//
// `home.tsx` re-exports these, so its own call sites are unchanged.
//
// This is a MOVE, not a rewrite: the types, `asView`, `appendTreeChild`,
// `genId`, `clamp01` and `addToLocus` are the same code they were, so a
// behaviour change here would be a mistake rather than an intent.
// ---------------------------------------------------------------------------

import type { FenelType } from "@fenel/engine";
import type { ExprNode } from "~/lib/expression-runner";
import { defaultApiClient, type ApiClient } from "~/lib/api";
import { ApiResponseError } from "./api-read-recovery";
import type { LocusRootData } from "./locus-root-data";
import { assertCurrentSession, browserAccountScope, sessionEpoch } from "./browser-session";

export type ItemSource =
  | { kind: "ref"; ref: { kind: "savedExpr"; id: string } }
  | { kind: "expr"; expr: ExprNode };

export type LayoutItem = {
  /** Stable id within the view — used as drag key, not persisted globally. */
  id: string;
  /** Proportional position in [0, 1]². Canvas only — list/grid ignore. */
  x?: number;
  y?: number;
  /** Proportional size in [0, 1]² — canvas only. Defaults applied when
   *  unset (auto-fit content with sane min/max). */
  w?: number;
  h?: number;
  /** ISO YYYY-MM-DD — calendar layout positions by this. Other layouts
   *  ignore. */
  date?: string;
  /** Unix milliseconds — timeline layout positions by this. */
  ts?: number;
  /** Lat/lng — map layout positions by these (geographic degrees). */
  lat?: number;
  lng?: number;
  /** Source — ref or inline. (Optional for backward-compat with the
   *  earlier shape; resolveSource defaults to inline.) */
  source?: ItemSource;
  /** Legacy inline expression (pre-Phase 2). Equivalent to {source:expr}. */
  expr?: ExprNode;
  /** Optional human-readable caption. */
  caption?: string;
  /** Type retained when data is imported, including structural file values. */
  valueType?: FenelType;
  /** UI: card body expanded? Persisted to locusView so the state
   *  survives page reloads. Undefined treated as "expanded" — old
   *  items keep showing their content. */
  expanded?: boolean;
  /** UI: this card's edges currently isolated? Used by the per-item
   *  arrow toggle alongside the view-level master visibility flag. */
  edgesShown?: boolean;
  /** Per-card representation overrides — keyed by typeclass name.
   *  When the card renders, the pin/value display checks here BEFORE
   *  falling through to the underlying value's typeclass instance.
   *  Lets a user give the same value a different label / icon / etc.
   *  on different cards without touching the persisted instance.
   *
   *  Example: pin a function called "runTelegramCollector" to the
   *  view, override Labelable here to "My customer-support bot" so
   *  this card reads that, while the function's persisted Labelable
   *  stays generic.
   *
   *  Storage shape mirrors Instance.methods exactly:
   *    representations: { Labelable: { label: "My bot" }, Iconable: { icon: "bot" } }
   *
   *  Phase 1.4 of unified-dispatch — ephemeral per-locusView overlay.
   *  See `design/representations.md`. */
  representations?: Record<string, Record<string, unknown>>;
};

// Backward-compat alias for code that imported the old name.
export type CanvasItem = LayoutItem;

export type CanvasView = {
  kind: "canvas";
  items: LayoutItem[];
  /** Master toggle for relationship arrows. Default (undefined) leaves
   *  them on; explicit false hides them. Persisted on the home view. */
  edgesVisible?: boolean | undefined;
};
/** `axis` turns the same list into a vertical stack or a sideways rail.
 *  Missing means stacked, which is how every list saved before this field reads. */
export type ListView = { kind: "list"; items: LayoutItem[]; axis?: "horizontal" | "vertical" };
/** Table view — the view of `List a`: one row per item; one column per field
 *  when the element type is a record, else one column showing each item. */
export type TableView = { kind: "table"; items: LayoutItem[] };
export type GridView = { kind: "grid"; cols?: number; items: LayoutItem[] };

/** Tree items can have nested children. Sharing LayoutItem so refs/inline/
 *  position fields work the same way; children are themselves TreeItems. */
export type TreeItem = LayoutItem & { children?: TreeItem[]; collapsed?: boolean };
export type TreeView = { kind: "tree"; items: TreeItem[] };

/** Tabs view — like list but shows ONE item at a time, with a tab strip
 *  above. `activeId` persists which tab the user has open. */
export type TabsView = { kind: "tabs"; items: LayoutItem[]; activeId?: string };

/** Calendar view — items positioned by ISO date field on each item.
 *  The viewport remembers which year/month the user is currently
 *  browsing; navigation buttons shift it. Items without a date stack
 *  in an "unscheduled" tray below the grid. */
export type CalendarView = {
  kind: "calendar";
  /** Year/month being viewed (1-indexed month, like ISO). Defaults to
   *  the current month when undefined. */
  year?: number;
  month?: number;
  items: LayoutItem[];
};

/** Timeline view — items along a horizontal axis by millisecond
 *  timestamp on each item. `from`/`to` define the visible range;
 *  defaults compute from item bounds (or last 30 days when no items). */
export type TimelineView = {
  kind: "timeline";
  from?: number;
  to?: number;
  items: LayoutItem[];
};

/** Map view — items at lat/lng on a real geographic map. The renderer
 *  uses MapLibre GL with OpenStreetMap tiles. */
export type MapView = {
  kind: "map";
  center?: { lat: number; lng: number };
  zoom?: number;
  items: LayoutItem[];
};

/** A bar chart of a numeric grouping (a count or a sum per key). The bars
 *  are the Fenel projection view.groupingPresentation's, never stored. */
export type ChartView = { kind: "chart"; items: LayoutItem[]; bars?: Array<{ label: string; value: number }> };
export type AnyView = CanvasView | ListView | TableView | GridView | TreeView | TabsView | CalendarView | TimelineView | MapView | ChartView;

export type LocusViewRow = {
  id: string;
  name: string;
  view: AnyView;
  active: boolean;
  updatedAt?: string;
};

export const EMPTY_CANVAS: CanvasView = { kind: "canvas", items: [] };

export type PlacementHint =
  | { afterId: string }            // host-only root insertion; not saved metadata
  | { x: number; y: number }       // canvas — proportional [0,1]²
  | { date: string }                // calendar — ISO YYYY-MM-DD
  | { ts: number }                  // timeline — ms since epoch
  | { lat: number; lng: number }    // map — geographic degrees
  | { parentId: string };           // tree — nest as child of this id
export function asView(view: unknown): AnyView {
  if (!view || typeof view !== "object") return EMPTY_CANVAS;
  const o = view as { kind?: unknown; items?: unknown; cols?: unknown; activeId?: unknown; year?: unknown; month?: unknown };
  const items = Array.isArray(o.items) ? (o.items as LayoutItem[]) : [];
  if (o.kind === "list") {
    const axis = (o as { axis?: unknown }).axis;
    return { kind: "list", items, ...(axis === "horizontal" || axis === "vertical" ? { axis } : {}) };
  }
  if (o.kind === "table") return { kind: "table", items };
  if (o.kind === "chart") {
    // The grouping's bars travel with the view (home.tsx presentedRow); a
    // malformed list is dropped whole rather than drawn in part.
    const bars = (o as { bars?: unknown }).bars;
    const wellFormed = Array.isArray(bars) && bars.every((bar) => !!bar && typeof bar === "object"
      && typeof (bar as { label?: unknown }).label === "string" && Number.isFinite((bar as { value?: unknown }).value));
    return { kind: "chart", items, ...(wellFormed ? { bars: bars as Array<{ label: string; value: number }> } : {}) };
  }
  if (o.kind === "grid") return { kind: "grid", cols: typeof o.cols === "number" ? o.cols : 4, items };
  if (o.kind === "tree") return { kind: "tree", items: items as TreeItem[] };
  if (o.kind === "tabs") return { kind: "tabs", items, activeId: typeof o.activeId === "string" ? o.activeId : undefined };
  if (o.kind === "calendar") return {
    kind: "calendar",
    items,
    year: typeof o.year === "number" ? o.year : undefined,
    month: typeof o.month === "number" ? o.month : undefined,
  };
  if (o.kind === "timeline") {
    const oo = o as { from?: unknown; to?: unknown };
    return {
      kind: "timeline",
      items,
      from: typeof oo.from === "number" ? oo.from : undefined,
      to: typeof oo.to === "number" ? oo.to : undefined,
    };
  }
  if (o.kind === "map") {
    const oo = o as { center?: unknown; zoom?: unknown };
    const center = oo.center && typeof oo.center === "object"
      ? (oo.center as { lat?: number; lng?: number })
      : undefined;
    return {
      kind: "map",
      items,
      center: center && typeof center.lat === "number" && typeof center.lng === "number"
        ? { lat: center.lat, lng: center.lng }
        : undefined,
      zoom: typeof oo.zoom === "number" ? oo.zoom : undefined,
    };
  }
  // Default + canvas — preserve edgesVisible so the master arrow
  // toggle persists across reads. Default (undefined) leaves arrows
  // on; explicit false hides them.
  const oo = o as { edgesVisible?: unknown };
  return {
    kind: "canvas",
    items,
    edgesVisible: typeof oo.edgesVisible === "boolean" ? oo.edgesVisible : undefined,
  };
}
export function genId(): string {
  return Math.random().toString(36).slice(2, 10) + Date.now().toString(36).slice(-4);
}
export function clamp01(n: number): number {
  if (!Number.isFinite(n)) return 0;
  if (n < 0) return 0;
  if (n > 1) return 1;
  return n;
}
export function appendTreeChild(view: TreeView, parentId: string, child: TreeItem): TreeView {
  let inserted = false;
  const walk = (items: TreeItem[]): TreeItem[] =>
    items.map((it) => {
      if (it.id === parentId) {
        inserted = true;
        return { ...it, children: [...(it.children ?? []), child], collapsed: false };
      }
      if (it.children?.length) return { ...it, children: walk(it.children) };
      return it;
    });
  const items = walk(view.items);
  if (!inserted) items.push(child);
  return { ...view, items };
}
export async function addToLocus(
  source: { expr: ExprNode; valueType?: FenelType } | { savedExprId: string; valueType?: FenelType },
  caption?: string,
  _hint?: PlacementHint,
  client: ApiClient = defaultApiClient,
  occurrence?: { id: string },
): Promise<boolean> {
  const epoch = client.epoch ?? sessionEpoch();
  const sourceRoot = client.rootId ?? (client === defaultApiClient ? browserAccountScope() : client.accountId);
  const itemSource: ItemSource = "savedExprId" in source
    ? { kind: "ref", ref: { kind: "savedExpr", id: source.savedExprId } }
    : { kind: "expr", expr: source.expr };
  // A stable occurrence id makes a conflict retry an append of the same value.
  // Placement belongs to an explicitly derived value, not to a plain list.
  const item: LayoutItem = { id: occurrence?.id ?? genId(), source: itemSource, ...(caption === undefined ? {} : { caption }),
    ...(source.valueType === undefined ? {} : { valueType: source.valueType }) };
  try {
    for (let attempt = 0; attempt < 3; attempt++) {
      assertCurrentSession(epoch);
      const sourceTicket = client.drafts?.source();
      const { root } = await client.apiRead<{ root: LocusRootData }>("/locus-root");
      assertCurrentSession(epoch);
      if (sourceTicket !== client.drafts?.source()) throw new Error("The data source changed while adding data. Retry in the current source.");
      // The root must belong to this captured reader, even when another lens
      // is rendering a different account at the same time.
      if (root.id !== sourceRoot) throw new Error("The data source changed. Add the data again in the current source.");
      if (root.items.some((existing) => existing.id === item.id)) return true;
      try {
        await client.editLocusRoot(root.id, root.revision, { kind: "append", item });
        assertCurrentSession(epoch);
        client.revalidate(["locusRoot", "locusViews", "activeLocusView"]);
        return true;
      } catch (error) {
        if (!(error instanceof ApiResponseError) || error.status !== 409 || attempt === 2) throw error;
      }
    }
    return false;
  } catch (e) {
    console.error("addToLocus failed", e);
    return false;
  }
}
