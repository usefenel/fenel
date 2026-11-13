/** Presentation choices for the renderer's supported carriers. This is an
 * editor projection, not a replacement for Fenel's type judgment. In
 * particular, missing date/position data never becomes invented metadata. */
import type { FenelType } from "@fenel/engine/types";
import TYPE_ICON_FALLBACKS from "./type-icon-fallbacks.json";
import { peelListForAuthoring } from "@fenel/engine/authoring/type";
import { hasDataPreview } from "./data-transfer/data-preview-shape";

export type LocusLayoutChoice = "value" | "code" | "list" | "table" | "grid" | "desktop" | "tree" | "tabs"
  | "canvas" | "calendar" | "timeline" | "map" | "chart" | "derive-canvas";

export type LocusLayoutOption = {
  value: LocusLayoutChoice;
  label: string;
  icon: string;
};

const OPTIONS: Record<LocusLayoutChoice, LocusLayoutOption> = {
  value: { value: "value", label: "Data", icon: TYPE_ICON_FALLBACKS.Data },
  code: { value: "code", label: "Code", icon: "code" },
  list: { value: "list", label: "List", icon: "list" },
  table: { value: "table", label: "Table", icon: "table" },
  grid: { value: "grid", label: "Grid", icon: "layout-grid" },
  desktop: { value: "desktop", label: "Desktop", icon: "layout-dashboard" },
  tree: { value: "tree", label: "Tree", icon: "folder-tree" },
  tabs: { value: "tabs", label: "Tabs", icon: "panels-top-left" },
  canvas: { value: "canvas", label: "Canvas", icon: "layout-canvas" },
  calendar: { value: "calendar", label: "Calendar", icon: "calendar" },
  timeline: { value: "timeline", label: "Timeline", icon: "activity" },
  map: { value: "map", label: "Map", icon: "map-pin" },
  chart: { value: "chart", label: "Chart", icon: "activity" },
  "derive-canvas": { value: "derive-canvas", label: "Create canvas…", icon: "layout-canvas" },
};

export function locusLayoutOption(kind: LocusLayoutChoice): LocusLayoutOption {
  return OPTIONS[kind];
}

export function locusLayoutOptions(subject: {
  /** Resolve named/container applications through the existing authoring
   * environment before passing the type. The evaluated value handles the
   * still-unknown type case without making a claim about membership. */
  type?: FenelType;
  value: unknown;
  /** A known placeAll application also recognizes its empty result. */
  derivedCanvas?: boolean;
  /** Only true when a live source reference can be saved in an enclosing
   * scope. Deriving a canvas inside its own source would be a cycle. */
  canDeriveCanvas?: boolean;
  /** False where the layout is stored somewhere that has no table (the
   *  root's layout is a `LocusRootValue.layout`, which knows only list, grid,
   *  tree and tabs). */
  canTable?: boolean;
  /** True when the Fenel projection view.calendarDayPlacements placed this
   *  value's groups on calendar days (a decided CalendarDate grouping with at
   *  least one group). The judgment is Fenel's; this only offers the lens. */
  calendar?: boolean;
  /** True when view.groupingPresentation found a decided grouping (a
   *  Maybe (OrdinaryMap k v)): its entries can be shown as a table. */
  groupingTable?: boolean;
  /** True when that grouping's values are all numbers: a bar chart per key. */
  chart?: boolean;
}): LocusLayoutOption[] {
  if (subject.type && "$type" in subject.type) return [OPTIONS.value, OPTIONS.desktop, OPTIONS.code];
  if (hasDataPreview(subject.value)) return [OPTIONS.value, OPTIONS.desktop, OPTIONS.code];
  const list = Array.isArray(subject.value)
    || !!(subject.type && peelListForAuthoring(subject.type));
  const record = !list && !!subject.value && typeof subject.value === "object";
  if (!list && !record) return [OPTIONS.value, OPTIONS.desktop, OPTIONS.code];

  const choices: LocusLayoutOption[] = [OPTIONS.list, OPTIONS.grid, OPTIONS.desktop, OPTIONS.tree, OPTIONS.tabs];
  if (list) {
    // A table is the view of `List a`: a record element gives one column per
    // field, any other element one column showing it through its own view.
    if (subject.canTable !== false) choices.splice(1, 0, OPTIONS.table);
    // A canvas presents a placeAll derivation: its placements are arguments
    // the canvas edits. A list that merely holds Placed values is data, and
    // is shown and edited as the list it is.
    if (subject.derivedCanvas) choices.push(OPTIONS.canvas);
    else if (subject.canDeriveCanvas) choices.push(OPTIONS["derive-canvas"]);
  }
  if (subject.groupingTable && !list && subject.canTable !== false) choices.splice(1, 0, OPTIONS.table);
  if (subject.calendar) choices.push(OPTIONS.calendar);
  if (subject.chart) choices.push(OPTIONS.chart);
  choices.push(OPTIONS.code);
  return choices;
}
