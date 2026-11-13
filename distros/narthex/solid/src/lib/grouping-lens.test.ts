import { expect, test } from "bun:test";
import { GROUPING_LAYOUT, groupingLayout, suggestionLensChip } from "./grouping-lens";
import { locusLayoutOption } from "./locus-layout-options";

test("a decided grouping opens in the lens Fenel's view.groupingPresentation recommends", () => {
  expect(groupingLayout("GroupingCalendar")).toBe("calendar");
  expect(groupingLayout("GroupingBars")).toBe("chart");
  expect(groupingLayout("GroupingTable")).toBe("table");
  expect(groupingLayout("NotAGrouping")).toBeUndefined();
  expect(groupingLayout(undefined)).toBeUndefined();
});

test("a suggestion row names its result's lens only when it is not the data's ordinary reading (owner review, Nov 11)", () => {
  const day = { day: "2026-11-03", year: 2026, month: 11, entry: 0 };
  // "Group by date" on transactions: a map read as a Calendar, with the Representation control's own icon and name.
  expect(suggestionLensChip({ $tag: "GroupingCalendar", days: [day] })).toEqual(locusLayoutOption("calendar"));
  expect(suggestionLensChip({ $tag: "GroupingCalendar", days: [day] })).toMatchObject({ label: "Calendar", icon: "calendar" });
  // As Home opens it, a calendar answer with no placed day is not a calendar.
  expect(suggestionLensChip({ $tag: "GroupingCalendar", days: [] })).toBeUndefined();
  // "Sum of amount per person": a map of numbers read as a Chart.
  expect(suggestionLensChip({ $tag: "GroupingBars" })).toMatchObject({ label: "Chart" });
  // Key rows are how a map reads anyway; a list or a card ("Reverse", "Length") has no grouping at all.
  expect(suggestionLensChip({ $tag: "GroupingTable" })).toBeUndefined();
  expect(suggestionLensChip({ $tag: "NotAGrouping" })).toBeUndefined();
  expect(suggestionLensChip(undefined)).toBeUndefined();
});

test("one source of truth: the lens a derived grouping opens in and the row's chip read the same table", async () => {
  const home = await Bun.file(new URL("../routes/app/home.tsx", import.meta.url)).text();
  for (const tag of Object.keys(GROUPING_LAYOUT)) expect(home).toContain(`kind: GROUPING_LAYOUT.${tag}`);
  const panels = await Bun.file(new URL("./related-data-panels.tsx", import.meta.url)).text();
  expect(panels).toContain("createGroupingPresentation(");
  expect(panels).toContain("suggestionLensChip(");
  const read = await Bun.file(new URL("./grouping-read.tsx", import.meta.url)).text();
  expect(read).toContain("const presentation = createGroupingPresentation(");
});
