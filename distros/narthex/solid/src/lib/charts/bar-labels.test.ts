import { expect, test } from "bun:test";

// charts/index.tsx is Solid JSX: the pure label helpers are compiled from its source.
const source = await Bun.file(new URL("./index.tsx", import.meta.url)).text();
const start = source.indexOf("/** Approximate advance of one character");
const end = source.indexOf("\nexport function BarChart(", start);
if (start < 0 || end < 0) throw new Error("bar label helpers moved");
const code = new Bun.Transpiler({ loader: "ts" }).transformSync(source.slice(start, end)).replace(/^export /gm, "");
const { barSlotWidth, barLabel, barChartFontSize, barChartTextLayout } = new Function(`${code}; return { barSlotWidth, barLabel, barChartFontSize, barChartTextLayout };`)() as {
  barSlotWidth: (barWidth: number, labels: readonly string[], charWidth?: number) => number;
  barLabel: (label: string, slot: number, charWidth?: number) => string;
  barChartFontSize: (height: number) => number;
  barChartTextLayout: (height: number) => { fontSize: number; charWidth: number; valueReserve: number; valueGap: number; axisBaseline: number; svgHeight: number } };

test("bar chart text is the app's content size at a focused chart, scales with it, never under 11px (owner review, Nov 11)", () => {
  // The focused grouping chart is 320px tall: 0.8rem (12.8px) labels and values.
  expect(barChartFontSize(320)).toBeCloseTo(12.8, 5);
  // Smaller charts (the card preview at 120, its compact form at 72) stay legible.
  expect(barChartFontSize(120)).toBe(11);
  expect(barChartFontSize(72)).toBe(11);
  // A taller chart grows its text, up to a cap.
  expect(barChartFontSize(400)).toBeCloseTo(13.52, 5);
  expect(barChartFontSize(2000)).toBe(16);
  expect(barChartFontSize(240)).toBeGreaterThan(barChartFontSize(160));
});

test("the chart reserves room for its text: values above the tallest bar, labels below the axis", () => {
  const layout = barChartTextLayout(320);
  expect(layout.fontSize).toBeCloseTo(12.8, 5);
  // The tallest bar's value label (font + gap) stays inside the SVG.
  expect(layout.valueReserve).toBeGreaterThanOrEqual(layout.fontSize + layout.valueGap);
  // The axis label's baseline sits a full line under the axis and inside the SVG.
  expect(layout.axisBaseline).toBeGreaterThanOrEqual(320 + layout.fontSize);
  expect(layout.svgHeight).toBeGreaterThan(layout.axisBaseline);
  // Label truncation uses the advance of the size actually drawn.
  expect(layout.charWidth).toBeCloseTo(12.8 * 0.6, 5);
  const slot = barSlotWidth(60, ["Alex Martin"], layout.charWidth);
  expect(barLabel("Alex Martin", slot, layout.charWidth)).toBe("Alex Martin");
});

test("bar labels are read whole when the chart has room (polish lane 2: not \"Alex Mart...\")", () => {
  const slot = barSlotWidth(60, ["Alex Martin", "Sam Lee"]);
  expect(barLabel("Alex Martin", slot)).toBe("Alex Martin");
  expect(barLabel("Sam Lee", slot)).toBe("Sam Lee");
  // A very long label is capped and shortened with an ellipsis.
  const long = "A very long customer name that cannot fit under one bar";
  const capped = barSlotWidth(20, [long]);
  expect(capped).toBeLessThanOrEqual(150);
  expect(barLabel(long, capped).endsWith("…")).toBe(true);
});
