import { expect, test } from "bun:test";

// value-card.tsx is Solid JSX: the pure helper is compiled from its source.
const source = await Bun.file(new URL("./value-card.tsx", import.meta.url)).text();
const start = source.indexOf("export function stripVisibleCount(");
const end = source.indexOf("\nexport function ValueCard(", start);
if (start < 0 || end < 0) throw new Error("stripVisibleCount moved");
const code = new Bun.Transpiler({ loader: "ts" }).transformSync(source.slice(start, end)).replace(/^export /gm, "");
const stripVisibleCount = new Function(`${code}; return stripVisibleCount;`)() as (capacity: number, count: number) => number;

test("a strip with room for one circle shows the first item, never a lone ellipsis (polish lane 2)", () => {
  expect(stripVisibleCount(0, 0)).toBe(0);
  expect(stripVisibleCount(3, 0)).toBe(0);
  expect(stripVisibleCount(1, 1)).toBe(1);
  expect(stripVisibleCount(3, 3)).toBe(3);
  expect(stripVisibleCount(1, 2)).toBe(1);
  expect(stripVisibleCount(0, 2)).toBe(0);
  expect(stripVisibleCount(3, 2)).toBe(2);
  expect(stripVisibleCount(3, 5)).toBe(2);
  expect(stripVisibleCount(2, 5)).toBe(1);
});
