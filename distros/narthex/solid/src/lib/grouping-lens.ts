// The lens a decided grouping opens in. Fenel's `view.groupingPresentation`
// answers how a grouping reads (GroupingCalendar, GroupingBars, GroupingTable,
// NotAGrouping); this table maps that answer to the lens. Home's
// `derivedGrouping` reads it to open derived data (Group by date opens as a
// Calendar, Sum of amount per person as a Chart), and a Suggestions row reads
// it to name that lens beside its result type (owner review, Nov 11).

import { locusLayoutOption, type LocusLayoutOption } from "./locus-layout-options";

export const GROUPING_LAYOUT = { GroupingCalendar: "calendar", GroupingBars: "chart", GroupingTable: "table" } as const;

export type GroupingLayout = (typeof GROUPING_LAYOUT)[keyof typeof GROUPING_LAYOUT];

/** The lens for a `view.groupingPresentation` answer's tag; none for anything else. */
export function groupingLayout(tag: unknown): GroupingLayout | undefined {
  return typeof tag === "string" && Object.prototype.hasOwnProperty.call(GROUPING_LAYOUT, tag)
    ? GROUPING_LAYOUT[tag as keyof typeof GROUPING_LAYOUT] : undefined;
}

/** A Suggestions row's lens chip: the Representation control's own icon and
 * name for its result's lens, only when that lens says more than the data's
 * ordinary reading. A table of key rows is how a map reads anyway, so it, a
 * list and a card show the result type alone. */
export function suggestionLensChip(presentation: { $tag: string; days?: readonly unknown[] } | undefined): LocusLayoutOption | undefined {
  // As Home opens it: a calendar answer with no placed day is not a calendar.
  if (presentation?.$tag === "GroupingCalendar" && !presentation.days?.length) return undefined;
  const layout = groupingLayout(presentation?.$tag);
  return layout && layout !== "table" ? locusLayoutOption(layout) : undefined;
}
