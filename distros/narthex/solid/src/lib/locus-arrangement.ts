// ---------------------------------------------------------------------------
// locus-arrangement — how a scope that has NO ROW OF ITS OWN is arranged.
//
// A data set's arrangement lives on its `locus_views` row: which layout, and
// where each card sits. Two scopes have no such row:
//
//   * the ROOT — the top-level `List Anything` whose items are the data sets.
//     It is the container of every row, so it is not one of them.
//   * a VALUE scope — inside an item's value. The children there are positions
//     in a value, and a value has nowhere to keep an `(x, y)`.
//
// Per `design/locus-as-value.md` §3 that second one is not a gap to be filled
// with a sidecar: a canvas placement is an ARGUMENT of a derivation, and the
// derivation is the honest home for it. Until that lands, the arrangement of
// these scopes is browser-local. This module is the whole of that carrier, so
// there is exactly one place to delete when the derivation arrives — and the
// data it holds is genuinely losable: lose it and the cards fall back to their
// default placement, which is what a fresh visitor sees anyway.
//
// It deliberately stores NOTHING about the values themselves. Only where the
// user dragged their cards.
// ---------------------------------------------------------------------------

import type { AnyView, LayoutItem } from "./locus-view-model";

export type LayoutKind = AnyView["kind"];

/** The subset of a `LayoutItem` that is placement rather than content. */
export type Placement = {
  x?: number; y?: number; w?: number; h?: number;
  date?: string; ts?: number; lat?: number; lng?: number;
  expanded?: boolean;
};

export type Arrangement = {
  kind: LayoutKind;
  /** Host observation: a stored choice overrides automatic presentation. */
  explicit?: boolean;
  /** Keyed by the synthesised item id, which is stable within its scope. */
  places: Record<string, Placement>;
};

const STORAGE_PREFIX = "fenel.locus.arrangement";
const PLACEMENT_KEYS = ["x", "y", "w", "h", "date", "ts", "lat", "lng", "expanded"] as const;

function storageKey(accountKey: string, scope: string): string {
  return `${STORAGE_PREFIX}:${accountKey}:${scope}`;
}

/** Browser storage is a host surface that can refuse (private mode, quota,
 *  a disabled cookie policy). A refusal here costs card placement, which is
 *  recoverable — so every access is guarded and a failure is silent. */
function store(): Storage | undefined {
  try {
    return typeof localStorage === "undefined" ? undefined : localStorage;
  } catch {
    return undefined;
  }
}

export function readArrangement(accountKey: string, scope: string, fallbackKind: LayoutKind): Arrangement {
  const raw = (() => {
    try { return store()?.getItem(storageKey(accountKey, scope)) ?? null; } catch { return null; }
  })();
  if (!raw) return { kind: fallbackKind, places: {} };
  try {
    const parsed = JSON.parse(raw) as Partial<Arrangement>;
    const places: Record<string, Placement> = {};
    if (parsed.places && typeof parsed.places === "object") {
      for (const [id, value] of Object.entries(parsed.places)) {
        if (value && typeof value === "object") places[id] = pickPlacement(value as Record<string, unknown>);
      }
    }
    return { kind: (parsed.kind as LayoutKind) ?? fallbackKind, places, explicit: parsed.kind !== undefined };
  } catch {
    return { kind: fallbackKind, places: {} };
  }
}

export function writeArrangement(accountKey: string, scope: string, arrangement: Arrangement): void {
  try {
    store()?.setItem(storageKey(accountKey, scope), JSON.stringify(arrangement));
  } catch {
    /* Placement is recoverable. Losing it must never break the edit. */
  }
}

/** Read a whole `AnyView` back out of the arrangement plus freshly derived
 *  items. The derivation is the source of truth for WHAT is there; the
 *  arrangement only says where each one sits. */
export function arrange(items: LayoutItem[], arrangement: Arrangement): AnyView {
  const placed = items.map((item) => {
    const place = arrangement.places[item.id];
    return place ? { ...item, ...place } : item;
  });
  switch (arrangement.kind) {
    case "grid": return { kind: "grid", cols: 4, items: placed };
    case "list": return { kind: "list", items: placed };
    case "table": return { kind: "table", items: placed };
    case "tree": return { kind: "tree", items: placed };
    case "tabs": return { kind: "tabs", items: placed };
    case "calendar": return { kind: "calendar", items: placed };
    case "timeline": return { kind: "timeline", items: placed };
    case "chart": return { kind: "chart", items: placed };
    case "map": return { kind: "map", items: placed };
    default: return { kind: "canvas", items: placed };
  }
}

/** The arrangement implied by a view the renderers just handed back. Only
 *  placement is kept — item content is derived and must not be frozen here,
 *  or a stale copy would outlive the value it came from. */
export function arrangementOf(view: AnyView): Arrangement {
  const places: Record<string, Placement> = {};
  for (const item of view.items) {
    const place = pickPlacement(item as unknown as Record<string, unknown>);
    if (Object.keys(place).length > 0) places[item.id] = place;
  }
  return { kind: view.kind, places };
}

function pickPlacement(source: Record<string, unknown>): Placement {
  const place: Placement = {};
  for (const key of PLACEMENT_KEYS) {
    const value = source[key];
    if (value !== undefined) (place as Record<string, unknown>)[key] = value;
  }
  return place;
}
