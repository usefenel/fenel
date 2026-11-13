// LAUNCH-PLAN row 9: the function card's plot wiring. The worker op asks the
// real Fenel `engine:functionGraphDomain` (no stub); the session is a fake
// that supplies only the function row and the named-type resolution.
// Run: bun test --timeout 300000 ./distros/narthex/solid/src/lib/function-graph.test.ts
import { describe, expect, setDefaultTimeout, test } from "bun:test";
import type { FenelType, FieldDef } from "@fenel/engine/types";
import { judgeReaderFunctionGraph } from "./expression-runner/reader-home-ops";
import type { AuthoringSession } from "./expression-runner/account-authoring-session";
import { drawableFunctionGraph, functionGraphNode } from "./function-graph-plan";

setDefaultTimeout(300_000);

const Num: FenelType = { $ref: "Number" };
const Str: FenelType = { $ref: "String" };
// `DrawingPosition = Number | value ∈ [16..56]` in the registered SetExpr carrier.
const position: FenelType = { $refined: { base: Num, set: { $tag: "SeInterval", interval: {
  lo: { $tag: "Just", _0: { value: 16, inclusive: true } }, hi: { $tag: "Just", _0: { value: 56, inclusive: true } } } } } };
const param = (type: FenelType): FieldDef => ({ name: "x", key: { $tag: "PositionalField", index: 0 }, type } as FieldDef);

function session(functions: Record<string, { requires?: unknown[] }>): AuthoringSession {
  return {
    registry: { getFunction: (id: string) => functions[id] ? { id, params: [], ...functions[id] } : undefined },
    environment: { resolveTypeRef: (type: FenelType) => "$ref" in type && type.$ref === "Position" ? position : undefined },
  } as unknown as AuthoringSession;
}
const pure = session({ f: {}, io: { requires: [{ class: "Http" }] } });

describe("function card plot", () => {
  test("a pure Number -> Number function samples -5..5", () => {
    expect(judgeReaderFunctionGraph({ functionId: "f", params: [param(Num)], returns: Num }, pure)).toEqual({ range: { lo: -5, hi: 5 } });
  });
  test("a named interval refinement of Number samples its bounds", () => {
    expect(judgeReaderFunctionGraph({ functionId: "f", params: [param({ $ref: "Position" } as FenelType)], returns: Num }, pure))
      .toEqual({ range: { lo: 16, hi: 56 } });
  });
  test("non-numeric, multi-parameter, effectful and unknown functions are not sampled", () => {
    expect(judgeReaderFunctionGraph({ functionId: "f", params: [param(Str)], returns: Num }, pure)).toEqual({});
    expect(judgeReaderFunctionGraph({ functionId: "f", params: [param(Num)], returns: Str }, pure)).toEqual({});
    expect(judgeReaderFunctionGraph({ functionId: "f", params: [param(Num), { ...param(Num), name: "y", key: { $tag: "PositionalField", index: 1 } } as FieldDef], returns: Num }, pure)).toEqual({});
    expect(judgeReaderFunctionGraph({ functionId: "io", params: [param(Num)], returns: Num }, pure)).toEqual({});
    expect(judgeReaderFunctionGraph({ functionId: "missing", params: [param(Num)], returns: Num }, pure)).toEqual({});
  });
  test("the sampler call passes the function as a reference and draws only a plan", () => {
    expect(functionGraphNode({ fn: "fn-handle", sampler: "sampler-handle" }, { lo: -5, hi: 5 })).toEqual({ kind: "call", fnId: "sampler-handle", args: [
      { kind: "literal", value: { $ref: "fn-handle" } }, { kind: "literal", value: -5 }, { kind: "literal", value: 5 }] });
    const plan = { $tag: "PointLineChart", points: [], bounds: {}, plot: { path: "M 30 10 L 40 20", marks: [] }, explanation: "" };
    expect(drawableFunctionGraph(plan)).toBe(plan as never);
    expect(drawableFunctionGraph({ $tag: "PointLineChartRefused", reason: "no" })).toBeUndefined();
    expect(drawableFunctionGraph(undefined)).toBeUndefined();
  });
});
