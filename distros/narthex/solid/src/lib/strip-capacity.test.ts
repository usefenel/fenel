// A46 round 2 (Nov 13, build B23): the graph's list cards for `reverse (sortAscending [3, 1, 2])` read "3 … 3 items":
// the strip had room for all three circles, but not for them AND the count, so it showed one circle and "…". When
// every item fits only without the count, all items are shown and the count yields (it says nothing the circles do
// not). The edge chip between two steps never shows its type cut ("Li…"): the type stays whole or leaves, the items
// stay. Source-level; the pure helper is compiled from value-card.tsx (Solid JSX).
//   bun test ./distros/narthex/solid/src/lib/strip-capacity.test.ts
import { describe, expect, test } from "bun:test";
import { readFile } from "node:fs/promises";

const source = (await readFile(new URL("./value-card.tsx", import.meta.url), "utf8")).replaceAll("\r\n", "\n");
const start = source.indexOf("export function stripCapacity(");
const end = source.indexOf("\nexport function ValueCard(", start);
if (start < 0 || end < 0) throw new Error("stripCapacity is missing");
const code = new Bun.Transpiler({ loader: "ts" }).transformSync(source.slice(start, end)).replace(/^export /gm, "");
type Plan = { capacity: number; countYields: boolean };
const stripCapacity = new Function(`${code}; return stripCapacity;`)() as (input: { items: number; room: number; countWidth: number; gap: number; diameter: number; step: number; countOnlyWhenElided?: boolean }) => Plan;

// The graph card measured in build B23 (1280x900): about 162 px inside, 44 px circles overlapping to a 37 px step,
// "3 items" about 48 px wide, a 6 px gap.
const card = { room: 162, countWidth: 48, gap: 6, diameter: 44, step: 37 };

describe("a list strip's circles and its count", () => {
  test("three items that fit only without the count: all three, the count yields", () => {
    expect(stripCapacity({ ...card, items: 3 })).toEqual({ capacity: 4, countYields: true });
  });

  test("items that fit beside the count keep it; too many keep the count and the ellipsis", () => {
    expect(stripCapacity({ ...card, items: 2 })).toEqual({ capacity: 2, countYields: false });
    expect(stripCapacity({ ...card, room: 400, items: 3 }).countYields).toBe(false);
    expect(stripCapacity({ ...card, items: 7 })).toEqual({ capacity: 2, countYields: false });
    expect(stripCapacity({ ...card, items: 0 })).toEqual({ capacity: 2, countYields: false });
  });

  // Recipe card (Rom, Nov 13): "3 items" beside three shown circles adds nothing; the card asks for the count
  // only when items are elided. Other strips keep their rule (the cases above pass no flag).
  test("count only when elided: every item shown means the count yields; an elided strip keeps it", () => {
    const only = { ...card, countOnlyWhenElided: true };
    expect(stripCapacity({ ...only, room: 400, items: 3 })).toEqual({ capacity: 10, countYields: true });
    expect(stripCapacity({ ...only, items: 2 })).toEqual({ capacity: 4, countYields: true });
    expect(stripCapacity({ ...only, items: 3 })).toEqual({ capacity: 4, countYields: true });
    expect(stripCapacity({ ...only, items: 7 })).toEqual({ capacity: 2, countYields: false });
    expect(stripCapacity({ ...only, items: 0 })).toEqual({ capacity: 2, countYields: false });
    expect(stripCapacity({ ...only, room: 20, items: 3 })).toEqual({ capacity: 0, countYields: false });
  });

  test("no room or no measured circle: nothing", () => {
    expect(stripCapacity({ ...card, room: 20, items: 3 })).toEqual({ capacity: 0, countYields: false });
    expect(stripCapacity({ ...card, diameter: 0, items: 3 })).toEqual({ capacity: 0, countYields: false });
  });

  test("the strip uses the plan, and a yielding count stays measurable out of the flow", async () => {
    expect(source).toContain("const plan = stripCapacity({ items: props.items.length, room, countWidth: count.scrollWidth,");
    expect(source).toContain('class={["locus-previews__count", { "locus-previews__count--yielded": countYields() }]}');
    const css = (await readFile(new URL("./home-entry.css", import.meta.url), "utf8")).replaceAll("\r\n", "\n");
    expect(css).toContain(".locus-previews__count--yielded { position: absolute; inset-inline-end: 0; top: 0; visibility: hidden; clip-path: inset(50%); pointer-events: none; }");
  });
});

describe("an edge chip's type is whole or absent, never cut", () => {
  test("the items come first and the type wraps out of the one-line chip when it does not fit", async () => {
    const css = (await readFile(new URL("../routes/app.css", import.meta.url), "utf8")).replaceAll("\r\n", "\n");
    const chip = ".expr-call-graph__edge-data-card.home-item--inline:not(.home-item--inline-two-line):has(> .home-item__body .locus-previews--inline-with-items)";
    expect(css).toContain(`${chip} {\n  flex-direction: row-reverse; flex-wrap: wrap; align-content: flex-start; justify-content: flex-end; overflow: hidden;\n}`);
    expect(css).toContain(`${chip} > .home-item__body { order: -1; }`);
    expect(css).toContain(`${chip} > .home-item__header {\n  flex: 0 0 auto; max-width: none;\n}`);
  });
});
