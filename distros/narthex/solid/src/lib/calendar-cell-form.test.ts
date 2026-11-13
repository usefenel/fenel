import { expect, test } from "bun:test";
import { calendarCellForm, calendarCellRoom } from "./calendar-cell-form";

// Desktop lens at 1280x900: a day cell is about 170 x 75-92 px (owner review, Nov 11).
const desktop = calendarCellRoom({ gridWidth: 1216, gridHeight: 560, gap: 1 });
// Phone at 390 px: seven columns of about 47 px.
const phone = calendarCellRoom({ gridWidth: 330, gridHeight: 600, gap: 1 });

test("a grid's cell room is its seventh and sixth, less the 1px gaps", () => {
  expect(desktop.width).toBeCloseTo((1216 - 6) / 7, 5);
  expect(desktop.height).toBeCloseTo((560 - 5) / 6, 5);
  expect(calendarCellRoom({ gridWidth: 0, gridHeight: 0, gap: 1 })).toEqual({ width: 0, height: 0 });
});

test("a desktop day with one item uses the regular list-row presentation", () => {
  expect(calendarCellForm(desktop, 1)).toBe("regular");
  expect(calendarCellForm({ width: 170, height: 75 }, 1)).toBe("regular");
});

test("a phone-width day keeps the compact chips", () => {
  expect(calendarCellForm(phone, 1)).toBe("compact");
  expect(calendarCellForm({ width: 60, height: 200 }, 1)).toBe("compact");
});

test("more items than fit keep the compact chips", () => {
  expect(calendarCellForm({ width: 170, height: 75 }, 2)).toBe("compact");
  expect(calendarCellForm({ width: 170, height: 150 }, 2)).toBe("regular");
  expect(calendarCellForm({ width: 170, height: 150 }, 3)).toBe("compact");
});

test("a captioned (pinned) item needs its caption line too", () => {
  expect(calendarCellForm({ width: 170, height: 75 }, 1, { captioned: true })).toBe("compact");
  expect(calendarCellForm({ width: 170, height: 110 }, 1, { captioned: true })).toBe("regular");
});

test("an unmeasured cell (first paint) or an empty day stays compact", () => {
  expect(calendarCellForm({ width: 0, height: 0 }, 1)).toBe("compact");
  expect(calendarCellForm(desktop, 0)).toBe("compact");
});
