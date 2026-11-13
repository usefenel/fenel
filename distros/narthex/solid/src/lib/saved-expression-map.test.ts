import { expect, test } from "bun:test";
import type { ExprNode } from "@fenel/engine/authoring/expression";
import { shareSavedExpressionMap } from "./saved-expression-map";

const literal = (value: unknown): ExprNode => ({ kind: "literal", value });

test("lenses over one library share the map, and a replaced library does not", () => {
  const expressions = { root: literal("root") };
  const queries = [{ id: "saved", query: { expr: literal("saved") } }];
  const first = shareSavedExpressionMap(expressions, queries);
  const second = shareSavedExpressionMap(expressions, queries);
  expect(second).toBe(first);
  expect(first.get("root")).toBe(expressions.root);
  expect(first.get("saved")).toBe(queries[0]!.query.expr);
  const replaced = shareSavedExpressionMap(expressions, [{ id: "saved", query: { expr: literal("saved") } }]);
  expect(replaced).not.toBe(first);
  const encoded = shareSavedExpressionMap(undefined, [{ id: "saved", query: JSON.stringify({ expr: literal("saved") }) }]);
  expect(encoded.get("saved")).toEqual(literal("saved"));
});
