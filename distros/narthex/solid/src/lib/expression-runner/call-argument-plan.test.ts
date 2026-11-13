import { describe, expect, test } from "bun:test";
import { Nothing } from "@fenel/engine/type-foundation";
import type { FenelType, FieldDef, TypeScheme } from "@fenel/engine/types";
import { inferAuthoringExpressionWithLiteralWitnesses, type AuthoringCatalogFunctionEntry } from "@fenel/engine/authoring/environment";
import type { ExprNode } from "./expr-node-codec";
import { callArgumentPlan, nextReturnedFunctionParameter } from "./call-argument-plan";

const num: FenelType = { $ref: "Number" };
const text: FenelType = { $ref: "String" };
const maybe: FenelType = { $ref: "Maybe" };
const field = (type: FenelType, index = 0): FieldDef => ({ name: `_${index}`, type,
  key: { $tag: "PositionalField", index }, label: Nothing, ui: Nothing, meta: {} });
function entry(id: string, types: FenelType[], returns: FenelType, kind: "constructor" | "function" = "function", quantified: TypeScheme["quantified"] = []): AuthoringCatalogFunctionEntry {
  const params = types.map(field);
  return { id, kind, label: id, description: "", params, returns,
    scheme: { quantified, body: { $arrow: { params, returns } } }, signatureOutcome: { $tag: "Solved" } };
}
const literal = (value: unknown): ExprNode => ({ kind: "literal", value });
const call = (fnId: string, ...args: ExprNode[]): Extract<ExprNode, { kind: "call" }> => ({ kind: "call", fnId, args });

describe("call argument boundaries", () => {
  test("Nothing and Just keep their declared payload arity even for a malformed saved draft", () => {
    for (const fn of [entry("Nothing", [], maybe, "constructor"), entry("Just", [num], maybe, "constructor")]) {
      const context = { getFunctionEntry: () => fn };
      const node = call(fn.id, ...Array.from({ length: fn.params.length + 1 }, () => literal(2)));
      expect(callArgumentPlan(node, fn, undefined, context).params).toHaveLength(fn.params.length);
      expect(nextReturnedFunctionParameter(fn, node.args.length, fn.params.length, fn.scheme)).toBeUndefined();
    }
  }, 180_000);

  test("partial ordinary calls retain their remaining declared parameters", () => {
    const fn = entry("join", [text, text], text);
    const plan = callArgumentPlan(call(fn.id, literal("first")), fn, undefined, { getFunctionEntry: () => fn });
    expect(plan.params).toHaveLength(2);
    expect(plan.params[1]?.type).toEqual(text);
    expect(nextReturnedFunctionParameter(fn, 1, 2, fn.scheme)).toBeUndefined();
  });

  test("a non-callable result does not acquire an extra argument slot", () => {
    const fn = entry("number", [], num);
    const context = { getFunctionEntry: () => fn };
    const plan = callArgumentPlan(call(fn.id, literal(3)), fn, undefined, context);
    expect(plan.params).toHaveLength(0);
    expect(nextReturnedFunctionParameter(fn, 0, 0, { quantified: [], body: num })).toBeUndefined();
  });

  test("a proven callable return exposes its actual parameter and supports supplied tail arguments", () => {
    const returned: FenelType = { $arrow: { params: [field(text)], returns: text } };
    const fn = entry("make", [num], returned);
    const context = { getFunctionEntry: () => fn };
    const result = inferAuthoringExpressionWithLiteralWitnesses(call(fn.id, literal(3)), context);
    expect(result.outcome.$tag).toBe("Solved");
    expect(nextReturnedFunctionParameter(fn, 1, 1, result.scheme)?.type).toEqual(text);
    const plan = callArgumentPlan(call(fn.id, literal(3), literal("hello")), fn, undefined, context);
    expect(plan.params.map((param) => param.type)).toEqual([num, text]);
  });

  test("a generic result is callable only after the kernel specializes it", () => {
    const variable: FenelType = { $var: "a" };
    const identity = entry("identity", [variable], variable, "function", [{ id: "q0", sourceName: "a", kind: { $tag: "KType" } }]);
    const increment = entry("increment", [num], num);
    const context = { getFunctionEntry: (id: string) => id === identity.id ? identity : increment,
      bindings: { callback: increment.scheme! } };
    const node = call(identity.id, { kind: "param", name: "callback" });
    const result = inferAuthoringExpressionWithLiteralWitnesses(node, context);
    expect(result.outcome.$tag).toBe("Solved");
    expect(nextReturnedFunctionParameter(identity, 1, 1, result.scheme)?.type).toEqual(num);
    expect(callArgumentPlan({ ...node, args: [...node.args, literal(3)] }, identity, undefined, context).params).toHaveLength(2);
  });
});
