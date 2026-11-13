import { describe, expect, test } from "bun:test";
import { evaluate } from "../json-logic";
import { createRegistry } from "../registry";
import { stdModule } from "./std";
import { pictureModule } from "./picture";
import { viewModule } from "./view";
import { entriesCanvasExpression, isCanvasPlacement, keyedPlacements, placementFromGeometry, withCanvasPlacement, withKeyedPlacement } from "../authoring/locus-canvas";

const registry = createRegistry([stdModule, pictureModule, viewModule]);
const context = registry.evaluateContext();
const nothing = { $tag: "Nothing" };
const just = (value: unknown) => ({ $tag: "Just", _0: value });

function call(name: string, ...args: unknown[]): any {
  const variables = Object.fromEntries(args.map((value, index) => [`arg${index}`, value]));
  return evaluate({ call: [name, ...args.map((_, index) => ({ var: `arg${index}` }))] }, variables, context);
}

describe("Fenel placed-data derivation", () => {
  test("an empty source stays empty, even with authored placements", () => {
    const placement = { at: { x: 0.3, y: 0.4 }, width: nothing, height: nothing };
    expect(call("placeAll", [], [just(placement)])).toEqual([]);
  });

  test("source values are retained in order and missing positions have finite defaults", () => {
    const items = Array.from({ length: 17 }, (_, index) => ({ id: index }));
    const result = call("placeAll", items, []) as any[];
    expect(result.map((entry) => entry.item)).toEqual(items);
    expect(result.every((entry) => Number.isFinite(entry.placement.at.x)
      && Number.isFinite(entry.placement.at.y)
      && entry.placement.at.x >= 0 && entry.placement.at.x <= 1
      && entry.placement.at.y >= 0 && entry.placement.at.y <= 1)).toBe(true);
    expect(new Set(result.map((entry) => JSON.stringify(entry.placement.at))).size).toBe(items.length);
  });

  test("authored positions win, Nothing defaults, and new source items remain visible", () => {
    const placement = { at: { x: 0.6, y: 0.7 }, width: just(0.25), height: nothing };
    const placements = [nothing, just(placement)];
    const before = call("placeAll", ["a", "b"], placements);
    const after = call("placeAll", ["a", "b", "c"], placements);
    expect(after[1]).toMatchObject({ placement, item: "b" });
    expect(after[2].item).toBe("c");
    expect(before[1].placement).toEqual(after[1].placement);
    expect(after[0].placement).toEqual(call("defaultPlacement", 0, 3));
  });

  test("fresh evaluation follows a changed source without copying its old contents", () => {
    const expression = { call: ["view:placeAll", { var: "source" }, { var: "placements" }] };
    const first = evaluate(expression, { source: ["old"], placements: [] }, context) as any[];
    const second = evaluate(expression, { source: ["edited", "new"], placements: [] }, context) as any[];
    expect(first.map((entry) => entry.item)).toEqual(["old"]);
    expect(second.map((entry) => entry.item)).toEqual(["edited", "new"]);
  });

  test("an authored placement is the same value Fenel's own placements are", () => {
    const fenel = call("defaultPlacement", 0, 1);
    expect(placementFromGeometry({ x: fenel.at.x, y: fenel.at.y })).toEqual(fenel);
    expect(isCanvasPlacement(fenel)).toBe(true);
    // Placements authored before the constructor tag remain readable.
    expect(isCanvasPlacement({ at: { x: 0, y: 0 }, width: nothing, height: nothing })).toBe(true);
    expect(isCanvasPlacement({ $tag: "Other", at: { x: 0, y: 0 }, width: nothing, height: nothing })).toBe(false);
  });

  test("placement lookup defaults before indexing a missing slot", () => {
    for (const index of [0, 1, 5]) {
      expect(call("placementAt", [], index, 6)).toEqual(call("defaultPlacement", index, 6));
    }
    expect(call("placementAt", [nothing], 4, 6)).toEqual(call("defaultPlacement", 4, 6));
    // A native null in a slot matches neither Maybe arm; it defaults rather
    // than evaluating to host-null and dropping the whole canvas.
    expect(call("placementAt", [null], 0, 1)).toEqual(call("defaultPlacement", 0, 1));
    expect(call("placeAll", ["a"], [null])[0]).toEqual({ $tag: "Placed", item: "a", placement: call("defaultPlacement", 0, 1) });
  });

  test("a long source is placed without growing the stack per item", () => {
    const items = Array.from({ length: 3000 }, (_, index) => index);
    const result = call("placeAll", items, []) as any[];
    expect(result).toHaveLength(items.length);
    expect(result.map((entry) => entry.item)).toEqual(items);
  }, 120_000);
});

describe("Fenel keyed placements: a canvas over a data set's entries", () => {
  const entry = (id: string, value: unknown) => ({ $tag: "LocusEntry", id, value });
  const at = (x: number, y: number) => ({ $tag: "Placement", at: { x, y }, width: nothing, height: nothing });
  const keyed = (key: string, placement: unknown) => ({ $tag: "KeyedPlacement", key, placement });

  test("an entry takes the placement authored for its id; the others take their defaults", () => {
    const result = call("placeEntries", [entry("a", 1), entry("b", 2), entry("c", 3)], [keyed("b", at(0.5, 0.6))]) as any[];
    expect(result.map((placed) => placed.item)).toEqual([1, 2, 3]);
    expect(result[1].placement).toEqual(at(0.5, 0.6));
    expect(result[0].placement).toEqual(call("defaultPlacement", 0, 3));
    expect(result[2].placement).toEqual(call("defaultPlacement", 2, 3));
  });

  test("removing, reordering or editing an entry moves no other entry's card", () => {
    const placements = [keyed("a", at(0.1, 0.1)), keyed("b", at(0.2, 0.2)), keyed("c", at(0.3, 0.3))];
    const place = (entries: unknown[]) => Object.fromEntries((call("placeEntries", entries, placements) as any[])
      .map((placed, index) => [(entries[index] as { id: string }).id, placed.placement]));
    const original = place([entry("a", 1), entry("b", 2), entry("c", 3)]);
    expect(place([entry("a", 1), entry("c", 3)])).toEqual({ a: original.a, c: original.c });
    expect(place([entry("c", 3), entry("a", 1), entry("b", 2)])).toEqual(original);
    expect(place([entry("a", 1), entry("b", "edited"), entry("c", 3)])).toEqual(original);
  });

  test("a placement whose entry is gone is ignored, and a long set is placed in one pass", () => {
    expect(call("placeEntries", [entry("a", 1)], [keyed("gone", at(0.9, 0.9))])[0].placement).toEqual(call("defaultPlacement", 0, 1));
    const entries = Array.from({ length: 3000 }, (_, index) => entry(`e${index}`, index));
    const placements = entries.map((_, index) => keyed(`e${index}`, at(index / 3000, 0.5)));
    const result = call("placeEntries", entries, placements) as any[];
    expect(result).toHaveLength(3000);
    expect(result[2999].placement.at.x).toBeCloseTo(2999 / 3000);
  }, 120_000);

  test("the codec sets one entry's placement in place, prunes placements for gone entries, and keeps positional canvases apart", () => {
    const source = { kind: "ref" as const, savedExprId: "locus:owner:set:entries" };
    const canvas = entriesCanvasExpression(source, [keyed("a", at(0.1, 0.1)) as never, keyed("old", at(0.2, 0.2)) as never]);
    const moved = withKeyedPlacement(canvas, "a", placementFromGeometry({ x: 0.4, y: 0.5 }), new Set(["a", "b"]));
    expect(keyedPlacements(moved) as unknown).toEqual([keyed("a", placementFromGeometry({ x: 0.4, y: 0.5 }))]);
    const added = withKeyedPlacement(moved, "b", placementFromGeometry({ x: 0.6, y: 0.7, w: 0.2 }));
    expect(keyedPlacements(added)!.map((entry) => entry.key)).toEqual(["a", "b"]);
    expect((added as { args: unknown[] }).args[0]).toEqual(source);
    // A keyed canvas has no positional slots, and the reverse holds too.
    expect(() => withCanvasPlacement(canvas, 0, placementFromGeometry({ x: 0, y: 0 }))).toThrow("placement expression");
    expect(() => withKeyedPlacement({ kind: "call", fnId: "view:placeAll", args: [source, { kind: "literal", value: [] }] }, "a",
      placementFromGeometry({ x: 0, y: 0 }))).toThrow("placement expression");
  });
});
