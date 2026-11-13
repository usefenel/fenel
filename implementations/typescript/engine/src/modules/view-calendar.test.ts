// Calendar placement of date groups (typed grouping M5, 2026-11-06).
//
//   bun test --timeout 60000 ./src/modules/view-calendar.test.ts
//
// The first test switches the host timezone (America/Los_Angeles, then
// Pacific/Kiritimati): the projection writes days with the CalendarDate codec
// only, so the output is identical in every host timezone.
import { beforeAll, describe, expect, test } from "bun:test";
import { invokeCallable, type EvaluateContext } from "../json-logic";
import { createRegistry } from "../registry";
import { withInterpretedResolver } from "../engine-bodies-dispatch";
import { dispatchRegistry } from "../system-entities";
import { stdModule } from "./std";
import { timeModule } from "./time";
import { pictureModule } from "./picture";
import { viewModule } from "./view";

let context: EvaluateContext;
const run = <T>(f: () => T): T => withInterpretedResolver(f);
const call = (id: string, ...args: unknown[]): unknown => run(() => invokeCallable({ $ref: id }, args, context));
const day = (year: number, month: number, dayOfMonth: number) => ({ year, month, day: dayOfMonth });
const grouping = (entries: Array<{ key: unknown; value: unknown }>) => ({ $tag: "Just", _0: { $tag: "OrdinaryMap", entries } });

beforeAll(() => run(() => {
  const registry = createRegistry([stdModule, timeModule, pictureModule, viewModule], { dispatchRegistry });
  context = registry.evaluateContext();
}), 900_000);

describe("view.calendarDayPlacements", () => {
  test("a decided CalendarDate grouping places each group on its day, year and month", () => {
    const groups = grouping([
      { key: day(2024, 2, 29), value: [{ amount: 10 }, { amount: 30 }] },
      { key: day(2024, 3, 1), value: [{ amount: 20 }] },
      { key: day(2024, 12, 31), value: [{ amount: 40 }] },
    ]);
    const expected = { $tag: "Ok", _0: [
      { $tag: "CalendarDayPlacement", day: "2024-02-29", year: 2024, month: 2, entry: 0 },
      { $tag: "CalendarDayPlacement", day: "2024-03-01", year: 2024, month: 3, entry: 1 },
      { $tag: "CalendarDayPlacement", day: "2024-12-31", year: 2024, month: 12, entry: 2 },
    ] };
    const previous = process.env.TZ;
    const offsets: Record<string, number> = {};
    try {
      // Bun applies a runtime TZ change to Date; the projection must not depend on it.
      for (const zone of ["America/Los_Angeles", "Pacific/Kiritimati"]) {
        process.env.TZ = zone;
        offsets[zone] = new Date(2024, 1, 29).getTimezoneOffset();
        expect(call("view:calendarDayPlacements", groups)).toEqual(expected);
      }
    } finally {
      if (previous === undefined) delete process.env.TZ; else process.env.TZ = previous;
    }
    console.log(JSON.stringify({ offsets }));
    expect(offsets["America/Los_Angeles"]).not.toBe(offsets["Pacific/Kiritimati"]);
  }, 300_000);

  test("the empty grouping has no days", () => {
    expect(call("view:calendarDayPlacements", grouping([]))).toEqual({ $tag: "Ok", _0: [] });
  }, 300_000);

  test("an undecided grouping is an explicit Err", () => {
    expect(call("view:calendarDayPlacements", { $tag: "Nothing" })).toMatchObject({ $tag: "Err" });
  }, 300_000);

  test("a Person-keyed grouping is an Err, not a calendar", () => {
    const groups = grouping([{ key: { $tag: "Person", name: "Alex", phone: "+1" }, value: [] }]);
    expect(call("view:calendarDayPlacements", groups)).toMatchObject({ $tag: "Err" });
  }, 300_000);

  test("an invalid date key (2023-02-29) and any other value are Errs", () => {
    expect(call("view:calendarDayPlacements", grouping([{ key: day(2023, 2, 29), value: [] }]))).toMatchObject({ $tag: "Err" });
    expect(call("view:calendarDayPlacements", [1, 2, 3])).toMatchObject({ $tag: "Err" });
  }, 300_000);
});

describe("view.groupingPresentation (recommended presentation of a grouping)", () => {
  test("Calendar Date keys recommend the Calendar", () => {
    const result = call("view:groupingPresentation", grouping([{ key: day(2024, 2, 29), value: [{ amount: 10 }] }])) as { $tag: string; days: unknown[] };
    expect(result.$tag).toBe("GroupingCalendar");
    expect(result.days).toEqual([{ $tag: "CalendarDayPlacement", day: "2024-02-29", year: 2024, month: 2, entry: 0 }]);
  }, 300_000);

  test("numbers per key recommend bars labelled by the key's caption", () => {
    const groups = grouping([
      { key: { $tag: "Person", name: "Alex", phone: "+1" }, value: 40 },
      { key: "Sam", value: 90 },
      { key: 7, value: 1 },
      { key: day(2024, 3, 1), value: 2.5 },
    ]);
    expect(call("view:groupingPresentation", groups)).toEqual({ $tag: "GroupingBars", bars: [
      { $tag: "GroupingBar", label: "Alex", value: 40, entry: 0 },
      { $tag: "GroupingBar", label: "Sam", value: 90, entry: 1 },
      { $tag: "GroupingBar", label: "7", value: 1, entry: 2 },
      { $tag: "GroupingBar", label: "2024-03-01", value: 2.5, entry: 3 },
    ] });
  }, 300_000);

  // Q10 (Rom, Nov 8): a record key reads by its first text field (structural
  // default; a Person by its name), and a record without one has no caption.
  test("a record key's caption is its first text field, else empty", () => {
    const groups = grouping([
      { key: { $tag: "Person", name: "Alex Martin", phone: "+1 415 555 2671" }, value: 2 },
      { key: { amount: 3, label: "Rent", note: "monthly" }, value: 1 },
      { key: { year: 2024, total: 3 }, value: 4 },
    ]);
    expect(call("view:groupingPresentation", groups)).toEqual({ $tag: "GroupingBars", bars: [
      { $tag: "GroupingBar", label: "Alex Martin", value: 2, entry: 0 },
      { $tag: "GroupingBar", label: "Rent", value: 1, entry: 1 },
      { $tag: "GroupingBar", label: "", value: 4, entry: 2 },
    ] });
  }, 300_000);

  test("any other decided grouping recommends its table; anything else is not a grouping", () => {
    expect(call("view:groupingPresentation", grouping([{ key: { $tag: "Person", name: "Alex" }, value: [{ amount: 1 }] }])))
      .toEqual({ $tag: "GroupingTable", size: 1 });
    expect(call("view:groupingPresentation", grouping([]))).toEqual({ $tag: "GroupingTable", size: 0 });
    expect(call("view:groupingPresentation", { $tag: "Nothing" })).toEqual({ $tag: "NotAGrouping" });
    expect(call("view:groupingPresentation", [1, 2])).toEqual({ $tag: "NotAGrouping" });
    expect(call("view:groupingPresentation", { $tag: "Just", _0: { a: 1 } })).toEqual({ $tag: "NotAGrouping" });
  }, 300_000);
});
