import { expect, test } from "bun:test";

// Fix lane A (Nov 8, item 5): Home builds a Chart view with the grouping's bars
// (`presentedRow` in home.tsx) and `ViewRenderer` re-reads it through `asView`.
// Dropping `bars` there drew an empty 40x350 chart for "Count per person".
const views = await Bun.file(new URL("./locus-view-model.ts", import.meta.url)).text();
const from = views.indexOf("export function asView(");
const to = views.indexOf("export function genId(", from);
if (from < 0 || to <= from) throw new Error("asView boundary moved");
const asView = new Function("EMPTY_CANVAS",
  `${new Bun.Transpiler({ loader: "ts" }).transformSync(views.slice(from, to).replace(/^export /, ""))}; return asView;`)(
  { kind: "canvas", items: [] });

test("asView keeps a chart's well-formed bars", () => {
  const bars = [{ label: "Alex Martin", value: 3 }, { label: "Sam Lee", value: 1 }];
  expect(asView({ kind: "chart", items: [], bars })).toEqual({ kind: "chart", items: [], bars });
});

test("asView drops malformed bars rather than drawing them", () => {
  expect(asView({ kind: "chart", items: [], bars: "nope" })).toEqual({ kind: "chart", items: [] });
  expect(asView({ kind: "chart", items: [], bars: [{ label: "x", value: Number.NaN }] })).toEqual({ kind: "chart", items: [] });
  expect(asView({ kind: "chart", items: [], bars: [{ label: 1, value: 2 }] })).toEqual({ kind: "chart", items: [] });
  expect(asView({ kind: "chart", items: [] })).toEqual({ kind: "chart", items: [] });
});
