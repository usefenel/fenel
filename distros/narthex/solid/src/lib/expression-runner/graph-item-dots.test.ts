// A47 (Nov 13, Rom: "remove the dots over the list items when the item is not expanded. If we click on the list item,
// it should expand an arrow though, and then those dots can appear."). A list card in a graph shows its items without
// dots at rest; a click (or Enter/Space) on an item's circle expands it (its node and arrow appear, then its dot,
// connected); the circle again or the dot collapses it; an expanded item keeps its dot. Source-level (no DOM here).
//   bun test ./distros/narthex/solid/src/lib/expression-runner/graph-item-dots.test.ts
import { describe, expect, test } from "bun:test";
import { readFile } from "node:fs/promises";

const surfaces = (await readFile(new URL("./expression-surfaces.tsx", import.meta.url), "utf8")).replaceAll("\r\n", "\n");
const control = surfaces.slice(surfaces.indexOf("export function ExpressionGraphCollectionItemControl"), surfaces.indexOf("export function inputHintTurn"));

describe("a list item's port in a graph", () => {
  test("at rest the item has no dot; an expanded item keeps it", () => {
    expect(control).toContain("hidden={!collection.active() || hoverCard() || !expanded()}");
    expect(control).toContain('"expr-call__input-dot--connected": expanded()');
  });

  test("a click on the item's own circle toggles it, before the circle's own open handler", () => {
    expect(control).toContain('item.addEventListener("click", onItemClick, true);');
    expect(control).toMatch(/closest\("\.locus-previews__cell"\)/);
    expect(control).toMatch(/event\.preventDefault\(\); event\.stopPropagation\(\); toggle\(\);/);
  });

  test("Enter and Space on the focused circle do the same; the circle says whether it is expanded", () => {
    expect(control).toContain('item.addEventListener("keydown", onItemKey, true);');
    expect(control).toContain('event.key !== "Enter" && event.key !== " "');
    expect(control).toContain('cell.setAttribute("aria-expanded", state.open ? "true" : "false")');
  });

  test("outside an active graph (or in a hover card) nothing changes", () => {
    expect(control).toContain("const graphItem = () => !!collection?.active() && !hoverCard();");
    expect(control.match(/if \(!graphItem\(\)/g)?.length).toBe(2);
  });

  test("the dot still collapses its item", () => {
    expect(control).toContain("onClick={event => { event.stopPropagation(); toggle(); }}>");
  });
});
