import { describe, expect, test } from "bun:test";
import { parseFenel } from "@fenel/engine";
import {
  catExpression,
  defaultPatternForMode,
  evaluatorStrategyExpression,
  exprNodeToLogic,
  inferAuthoringExpressionType,
  logicToExprNode,
  partialCallNode,
  patternMode,
  readExpression,
  seedExprArg,
  typeDisplayName,
  whereExpression,
} from "./expr-node-codec";

function lowerFenel(src: string): unknown {
  return exprNodeToLogic(logicToExprNode(parseFenel(src)));
}

describe("logicToExprNode structural bridge", () => {
  test("round-trips do blocks through marker-backed editor nodes", () => {
    expect(lowerFenel("1\n2")).toEqual({ do: [1, 2] });
  });

  test("round-trips let bindings through marker-backed editor nodes", () => {
    expect(lowerFenel("let x = 1\nx")).toEqual({
      do: [{ let: { x: 1 } }, { var: "x" }],
    });
  });

  test("round-trips match arms through marker-backed editor nodes", () => {
    expect(lowerFenel("case x of\n  _ -> 1")).toEqual({
      match: [{ var: "x" }, 1],
    });
  });

  test("round-trips anonymous records and named-field constructors", () => {
    expect(lowerFenel('{ name = "Ada" }')).toEqual({ name: "Ada" });
    expect(lowerFenel("Just { value = 1 }")).toEqual({
      construct: ["Just", { value: 1 }],
    });
  });

  test("round-trips lambdas through the same structural marker path", () => {
    expect(lowerFenel("\\x -> x")).toEqual({ fn: ["x", { var: "x" }] });
  });

  test("round-trips qualified method references through the engine method shape", () => {
    const node = logicToExprNode({
      method: ["Foldable", "foldr", { var: "f" }, 0, { var: "xs" }],
    });
    expect(node).toEqual({
      kind: "call",
      fnId: "Foldable.foldr",
      args: [
        { kind: "param", name: "f" },
        { kind: "literal", value: 0 },
        { kind: "param", name: "xs" },
      ],
    });
    expect(exprNodeToLogic(node)).toEqual({
      method: ["Foldable", "foldr", { var: "f" }, 0, { var: "xs" }],
    });
  });

  test("uses engine-owned helpers for Phase 6 expression sugar", () => {
    expect(lowerFenel("x + y where y = 1")).toEqual(whereExpression(
      { call: ["add", { var: "x" }, { var: "y" }] },
      [{ name: "y", expr: 1 }],
    ));
    expect(lowerFenel("`a ${x}`")).toEqual(catExpression(["a ", { var: "x" }]));
    expect(lowerFenel("read(String)")).toEqual(readExpression({ type: "string" }));
    expect(lowerFenel("partial { f x }")).toEqual(
      evaluatorStrategyExpression("partial", { call: ["f", { var: "x" }] }),
    );
  });

  test("re-exports partial-call and pattern authoring helpers", () => {
    expect(exprNodeToLogic(partialCallNode({
      kind: "call",
      fnId: "add",
      args: [
        { kind: "literal", value: 1 },
        { kind: "literal", value: 2 },
      ],
    }, 1))).toEqual({ call: ["add", 1] });

    expect(patternMode(defaultPatternForMode("ctor"))).toBe("ctor");
    expect(patternMode(defaultPatternForMode("guard"))).toBe("guard");
  });

  test("re-exports authoring-kernel inference and metadata helpers", () => {
    expect(typeDisplayName({ $ref: "String" })).toBe("String");
    expect(seedExprArg({ $ref: "String" })).toEqual({ kind: "literal", value: null });
    expect(inferAuthoringExpressionType({ kind: "literal", value: 1 })).toEqual({ $ref: "Number" });
  });
});
