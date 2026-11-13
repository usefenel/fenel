import { describe, expect, test } from "bun:test";
import { rowOffsets, visibleRows } from "./virtual-table-model";

const fixed = (count: number, height: number) => rowOffsets(count, () => height);

describe("row offsets", () => {
  test("accumulate the heights, with the total last", () => {
    expect([...rowOffsets(4, (index) => [10, 20, 5, 15][index]!)]).toEqual([0, 10, 30, 35, 50]);
  });

  test("an unusable height counts as zero and a bad count as empty", () => {
    expect([...rowOffsets(3, (index) => [NaN, -4, 7][index]!)]).toEqual([0, 0, 0, 7]);
    expect([...rowOffsets(-2, () => 10)]).toEqual([0]);
    expect([...rowOffsets(NaN, () => 10)]).toEqual([0]);
    expect([...rowOffsets(2.7, () => 10)]).toEqual([0, 10, 20]);
  });
});

describe("the rows drawn for a viewport", () => {
  test("an empty table draws nothing", () => {
    expect(visibleRows(rowOffsets(0, () => 30), { scrollTop: 0, viewportHeight: 300 }))
      .toEqual({ start: 0, end: 0, padTop: 0, padBottom: 0, total: 0 });
  });

  test("at the top, exactly the rows that fit", () => {
    expect(visibleRows(fixed(10_000, 30), { scrollTop: 0, viewportHeight: 300 }))
      .toEqual({ start: 0, end: 10, padTop: 0, padBottom: 9_990 * 30, total: 300_000 });
  });

  test("a row cut by either edge is drawn", () => {
    const rows = visibleRows(fixed(10_000, 30), { scrollTop: 3_015, viewportHeight: 300 });
    expect([rows.start, rows.end]).toEqual([100, 111]);
    expect(rows.padTop).toBe(3_000);
    expect(rows.padBottom).toBe((10_000 - 111) * 30);
  });

  test("spacers and drawn rows always add up to the total", () => {
    const offsets = fixed(10_000, 30);
    for (const scrollTop of [0, 1, 29, 30, 12_345, 299_700, 400_000]) {
      const rows = visibleRows(offsets, { scrollTop, viewportHeight: 250, overscan: 3 });
      expect(rows.padTop + (offsets[rows.end]! - offsets[rows.start]!) + rows.padBottom).toBe(rows.total);
    }
  });

  test("overscan adds rows on both sides, clamped to the table", () => {
    const offsets = fixed(1_000, 20);
    expect(visibleRows(offsets, { scrollTop: 2_000, viewportHeight: 200, overscan: 5 }))
      .toMatchObject({ start: 95, end: 115 });
    expect(visibleRows(offsets, { scrollTop: 0, viewportHeight: 200, overscan: 5 }))
      .toMatchObject({ start: 0, end: 15 });
    expect(visibleRows(offsets, { scrollTop: 19_800, viewportHeight: 200, overscan: 5 }))
      .toMatchObject({ start: 985, end: 1_000, padBottom: 0 });
  });

  test("scrolling past either end shows the nearest rows", () => {
    const offsets = fixed(100, 10);
    expect(visibleRows(offsets, { scrollTop: 5_000, viewportHeight: 50 })).toMatchObject({ start: 99, end: 100 });
    expect(visibleRows(offsets, { scrollTop: -40, viewportHeight: 50 })).toMatchObject({ start: 0, end: 5 });
    expect(visibleRows(offsets, { scrollTop: NaN, viewportHeight: 50 })).toMatchObject({ start: 0, end: 5 });
  });

  test("a table with rows always draws at least one", () => {
    expect(visibleRows(fixed(50, 10), { scrollTop: 100, viewportHeight: 0 })).toMatchObject({ start: 10, end: 11 });
  });

  test("rows of different heights are found by their measured offsets", () => {
    // Heights alternate 10, 100: an even row 2k starts at 110 * k.
    const offsets = rowOffsets(1_000, (index) => (index % 2 === 0 ? 10 : 100));
    const rows = visibleRows(offsets, { scrollTop: 2_205, viewportHeight: 110 });
    // Row 40 (10 px) is cut at the top, row 41 (100 px) is whole, row 42 is cut at the bottom.
    expect([rows.start, rows.end]).toEqual([40, 43]);
    expect(rows.padTop).toBe(2_200);
  });

  test("the drawn row count depends on the viewport, not on the list's length", () => {
    for (const count of [1_000, 100_000, 1_000_000]) {
      const rows = visibleRows(fixed(count, 32), { scrollTop: 32 * (count / 2), viewportHeight: 640, overscan: 6 });
      expect(rows.end - rows.start).toBeLessThanOrEqual(640 / 32 + 1 + 12);
    }
  });
});
