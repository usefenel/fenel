import { describe, expect, test } from "bun:test";
import type { ExprNode } from "./expression-authoring";
import {
  PLACE_ALL_FUNCTION, PLACE_ENTRIES_FUNCTION, canvasExpression, entriesCanvasExpression,
  isCanvasExpression, isEntriesCanvasExpression, canvasSource, authoredPlacements, keyedPlacements,
  withCanvasPlacement, withKeyedPlacement, type CanvasFunctionIdentityResolver, type CanvasPlacement,
} from "./locus-canvas";

const positionalId = "df5f046f-3f84-4fd9-941a-9c4bfb9fa757";
const keyedId = "8ff09898-78a2-49f8-9a2b-bcde983a615e";
const foreignId = "5baf72f6-7c17-4b48-b086-283eabc0f735";
const positional = { id: positionalId, codeName: "placeAll", label: "Create canvas data" };
const keyed = { id: keyedId, codeName: "placeEntries", label: "Create canvas data" };
const foreign = { id: foreignId, codeName: "placeAll", label: positional.label };
const currentFunctions = new Map([
  [PLACE_ALL_FUNCTION, positional], [positionalId, positional],
  [PLACE_ENTRIES_FUNCTION, keyed], [keyedId, keyed], [foreignId, foreign],
]);
const resolveFunction: CanvasFunctionIdentityResolver = handle => currentFunctions.get(handle);
const source: ExprNode = { kind: "ref", savedExprId: "retained-source" };
const placement: CanvasPlacement = { at: { x: 0.25, y: 0.35 }, width: { $tag: "Nothing" }, height: { $tag: "Nothing" } };
const otherPlacement: CanvasPlacement = { at: { x: 0.55, y: 0.65 }, width: { $tag: "Just", _0: 0.2 }, height: { $tag: "Nothing" } };

function producer(expression: ExprNode, fnId: string): ExprNode {
  if (expression.kind !== "call") throw new Error("Expected a call fixture");
  return { ...expression, fnId };
}

describe("captured canvas function identity", () => {
  test("UUID and legacy producers are classified only through the supplied current identity lookup", () => {
    for (const head of [positionalId, PLACE_ALL_FUNCTION]) {
      const expression = producer(canvasExpression(source), head);
      expect(isCanvasExpression(expression, resolveFunction)).toBe(true);
      expect(isEntriesCanvasExpression(expression, resolveFunction)).toBe(false);
      expect(canvasSource(expression, resolveFunction)).toBe(source);
      expect(authoredPlacements(expression, resolveFunction)).toEqual([]);
      expect(keyedPlacements(expression, resolveFunction)).toBeUndefined();
    }
    for (const head of [keyedId, PLACE_ENTRIES_FUNCTION]) {
      const expression = producer(entriesCanvasExpression(source), head);
      expect(isCanvasExpression(expression, resolveFunction)).toBe(true);
      expect(isEntriesCanvasExpression(expression, resolveFunction)).toBe(true);
      expect(canvasSource(expression, resolveFunction)).toBe(source);
      expect(keyedPlacements(expression, resolveFunction)).toEqual([]);
      expect(authoredPlacements(expression, resolveFunction)).toBeUndefined();
    }
  });

  test("resolver-less callers retain legacy compatibility without guessing UUID or equal-name identities", () => {
    expect(isCanvasExpression(canvasExpression(source))).toBe(true);
    expect(isEntriesCanvasExpression(entriesCanvasExpression(source))).toBe(true);
    expect(isCanvasExpression(producer(canvasExpression(source), positionalId))).toBe(false);
    expect(isCanvasExpression(producer(canvasExpression(source), foreignId), resolveFunction)).toBe(false);
    expect(canvasSource(producer(canvasExpression(source), foreignId), resolveFunction)).toBeUndefined();
    expect(authoredPlacements(producer(canvasExpression(source), foreignId), resolveFunction)).toBeUndefined();
  });

  test("provided resolver misses, hidden canonical targets, throws and ambiguous identities refuse all adapters", () => {
    const absent: CanvasFunctionIdentityResolver = () => undefined;
    const hidden: CanvasFunctionIdentityResolver = handle => handle === PLACE_ALL_FUNCTION ? undefined : currentFunctions.get(handle);
    const retired: CanvasFunctionIdentityResolver = () => { throw new Error("reader retired or lookup ambiguous"); };
    const ambiguous: CanvasFunctionIdentityResolver = () => positional;
    for (const lookup of [absent, hidden, retired, ambiguous]) {
      const expression = producer(canvasExpression(source), positionalId);
      expect(isCanvasExpression(expression, lookup)).toBe(false);
      expect(isEntriesCanvasExpression(expression, lookup)).toBe(false);
      expect(canvasSource(expression, lookup)).toBeUndefined();
      expect(authoredPlacements(expression, lookup)).toBeUndefined();
      expect(keyedPlacements(expression, lookup)).toBeUndefined();
      expect(() => withCanvasPlacement(expression, 0, placement, lookup)).toThrow("placement expression");
      expect(() => withKeyedPlacement(expression, "a", placement, undefined, lookup)).toThrow("placement expression");
    }
    expect(isCanvasExpression(canvasExpression(source), absent)).toBe(false);
    const missing = producer(canvasExpression(source), "missing-target");
    expect(isCanvasExpression(missing, resolveFunction)).toBe(false);
    const wrongArity: ExprNode = { kind: "call", fnId: positionalId, args: [source] };
    expect(isCanvasExpression(wrongArity, resolveFunction)).toBe(false);
  });

  test("moving a UUID positional producer preserves its identity, live source and untouched placements", () => {
    const original = producer(canvasExpression(source, [{ $tag: "Just", _0: placement }]), positionalId);
    const moved = withCanvasPlacement(original, 2, otherPlacement, resolveFunction);
    expect(moved.kind === "call" && moved.fnId).toBe(positionalId);
    expect(canvasSource(moved, resolveFunction)).toBe(source);
    expect(authoredPlacements(moved, resolveFunction)).toEqual([
      { $tag: "Just", _0: placement }, { $tag: "Nothing" }, { $tag: "Just", _0: otherPlacement },
    ]);
    expect(authoredPlacements(original, resolveFunction)).toEqual([{ $tag: "Just", _0: placement }]);
    expect(() => withKeyedPlacement(original, "a", placement, undefined, resolveFunction)).toThrow("placement expression");
    const computed: ExprNode = { kind: "call", fnId: positionalId, args: [source, { kind: "ref", savedExprId: "computed-placements" }] };
    expect(() => withCanvasPlacement(computed, 0, placement, resolveFunction)).toThrow("placement expression");
    expect(computed.args[1]).toEqual({ kind: "ref", savedExprId: "computed-placements" });
  });

  test("moving a UUID keyed producer retains source identity, keyed order and existing pruning behavior", () => {
    const original = producer(entriesCanvasExpression(source, [
      { $tag: "KeyedPlacement", key: "a", placement },
      { $tag: "KeyedPlacement", key: "gone", placement },
    ]), keyedId);
    const moved = withKeyedPlacement(original, "b", otherPlacement, new Set(["a", "b"]), resolveFunction);
    expect(moved.kind === "call" && moved.fnId).toBe(keyedId);
    expect(canvasSource(moved, resolveFunction)).toBe(source);
    expect(keyedPlacements(moved, resolveFunction)).toEqual([
      { $tag: "KeyedPlacement", key: "a", placement }, { $tag: "KeyedPlacement", key: "b", placement: otherPlacement },
    ]);
    expect(keyedPlacements(original, resolveFunction)?.map(entry => entry.key)).toEqual(["a", "gone"]);
    expect(() => withCanvasPlacement(original, 0, placement, resolveFunction)).toThrow("placement expression");
    const computed: ExprNode = { kind: "call", fnId: keyedId, args: [source, { kind: "ref", savedExprId: "computed-keyed-placements" }] };
    expect(() => withKeyedPlacement(computed, "b", placement, undefined, resolveFunction)).toThrow("placement expression");
    expect(computed.args[1]).toEqual({ kind: "ref", savedExprId: "computed-keyed-placements" });
  });
});
