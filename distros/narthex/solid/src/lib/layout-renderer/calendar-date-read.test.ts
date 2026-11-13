// D3 (2026-11-07): a CalendarDate reads as the reader's medium date.
// Run: bun test ./src/lib/layout-renderer/calendar-date-read.test.ts (distro dir).
import { describe, expect, test } from "bun:test";
import { calendarDateParts, calendarDateText } from "./calendar-date-text";

describe("calendar-date read leaf", () => {
  test("a valid date reads as the locale's medium date", () => {
    expect(calendarDateText({ year: 2026, month: 11, day: 3 }, "en-GB")).toBe("3 Nov 2026");
    expect(calendarDateText({ year: 2024, month: 2, day: 29 }, "en-GB")).toBe("29 Feb 2024");
    // Years before 100 are not shifted into the 1900s.
    expect(calendarDateText({ year: 99, month: 12, day: 31 }, "en-GB")).toBe("31 Dec 99");
  });

  test("anything that is not one real date gives no date text", () => {
    for (const value of [{ year: 2026, month: 2, day: 30 }, { year: 2026, month: 13, day: 1 }, { year: 2026, month: 1 },
      { year: "2026", month: 1, day: 1 }, { year: 2026.5, month: 1, day: 1 }, "2026-11-03", null, [2026, 11, 3]]) {
      expect(calendarDateText(value, "en-GB"), JSON.stringify(value)).toBeUndefined();
    }
  });

  // Polish item 3 (Nov 8): the badge shows numeric parts in the reader's
  // order; separators are their own parts so they can be styled apart.
  test("the badge parts follow the reader's language, separators apart", () => {
    const text = (parts: ReturnType<typeof calendarDateParts>) => parts?.map(part => `${part.kind}:${part.text}`).join(" ");
    expect(text(calendarDateParts({ year: 2026, month: 11, day: 3 }, "en-US"))).toBe("value:11 separator:/ value:3 separator:/ value:2026");
    expect(text(calendarDateParts({ year: 2026, month: 11, day: 3 }, "en-GB"))).toBe("value:03 separator:/ value:11 separator:/ value:2026");
    expect(text(calendarDateParts({ year: 2026, month: 11, day: 3 }, "de-DE"))).toBe("value:3 separator:. value:11 separator:. value:2026");
    expect(calendarDateParts({ year: 2026, month: 2, day: 30 }, "en-US")).toBeUndefined();
    expect(calendarDateParts({ year: 2026, month: 11, day: 3 }, "en-US")?.every(part => part.text.trim() === part.text)).toBe(true);
  });
});
