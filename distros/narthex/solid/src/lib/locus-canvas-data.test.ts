import { describe, expect, test } from "bun:test";
import type { ExprNode } from "@fenel/engine/authoring/expression";
import {
  authoredPlacements, canvasExpression, canvasSource, isCanvasExpression,
  placementFromItem, projectPlacedItems, withCanvasPlacement,
} from "./locus-canvas-data";

const source: ExprNode = { kind: "ref", savedExprId: "locus:account:photos" };
const placement = placementFromItem({ x: 0.15, y: 0.3, w: 0.2 });

describe("canvas derivations", () => {
  test("a drag preserves the live source and authors only the selected placement", () => {
    const initial = canvasExpression(source);
    const moved = withCanvasPlacement(initial, 2, placement);
    expect(canvasSource(moved)).toBe(source);
    expect(authoredPlacements(initial)).toEqual([]);
    expect(authoredPlacements(moved)).toEqual([
      { $tag: "Nothing" }, { $tag: "Nothing" }, { $tag: "Just", _0: placement },
    ]);
    expect(isCanvasExpression(JSON.parse(JSON.stringify(moved)))).toBe(true);
  });

  test("a second drag retains all other authored positions", () => {
    const original = withCanvasPlacement(canvasExpression(source), 2, placement);
    const second = placementFromItem({ x: 0.7, y: 0.1, h: 0.4 });
    const moved = withCanvasPlacement(original, 0, second);
    expect(authoredPlacements(moved)?.[2]).toEqual({ $tag: "Just", _0: placement });
    expect(authoredPlacements(moved)?.[0]).toEqual({ $tag: "Just", _0: second });
  });

  test("computed placement arguments are not silently replaced with snapshots", () => {
    const computed: ExprNode = {
      kind: "call", fnId: "view:placeAll",
      args: [source, { kind: "ref", savedExprId: "positions" }],
    };
    expect(() => withCanvasPlacement(computed, 0, placement)).toThrow("placement expression");
  });

  test("malformed placement arguments and non-finite drag coordinates are refused", () => {
    expect(() => withCanvasPlacement(canvasExpression(source), -1, placement)).toThrow();
    expect(() => placementFromItem({ x: NaN, y: 0 })).toThrow();
    expect(() => placementFromItem({ x: 0, y: Infinity })).toThrow();
    expect(() => placementFromItem({ x: 0, y: 0, w: Number.NaN })).toThrow();
    // `Placement` declares `width: Maybe Number`; a finite size is kept as authored.
    expect(placementFromItem({ x: 0, y: 0, w: 0 }).width).toEqual({ $tag: "Just", _0: 0 });
    const malformed: ExprNode = {
      kind: "call", fnId: "view:placeAll", args: [source, { kind: "literal", value: [{}] }],
    };
    expect(() => withCanvasPlacement(malformed, 0, placement)).toThrow();
  });
});

describe("placed value projection", () => {
  test("uses authored coordinates while rendering the referenced item", () => {
    const photo = { title: "Iris", pixels: [1, 2, 3] };
    const items = projectPlacedItems([{ placement, item: photo }], (item, index) => ({
      id: `child:${index}`, caption: "Photo",
      source: { kind: "expr", expr: { kind: "literal", value: item } },
    }));
    expect(items).toEqual([{
      id: "child:0", caption: "Photo", x: 0.15, y: 0.3, w: 0.2, h: undefined,
      source: { kind: "expr", expr: { kind: "literal", value: photo } },
    }]);
    expect((items?.[0]?.source as { expr: ExprNode }).expr).toEqual({ kind: "literal", value: photo });
  });

  test("an ordinary image list is not a canvas and malformed entries do not disappear", () => {
    expect(projectPlacedItems(["image"], () => ({ id: "unreachable" }))).toBeUndefined();
    expect(projectPlacedItems([{ placement, item: "ok" }, {}], () => ({ id: "unreachable" }))).toBeUndefined();
    expect(projectPlacedItems([], () => ({ id: "unreachable" }))).toEqual([]);
  });
});
