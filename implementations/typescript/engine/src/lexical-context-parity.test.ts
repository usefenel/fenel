import { describe, expect, test } from "bun:test";
import { evaluate, type EvaluateContext, type ImportFrame } from "./json-logic";
import type { FenelFunction } from "./types";
import { Nothing } from "./type-foundation";

describe("source Name scope with live ambient context", () => {
  test("module/callback transitions reuse contexts while effect and authority changes remain live", () => {
    const a: ImportFrame = { names: { observe: "inspect", invoke: "B:invoke" }, aliases: {} };
    const b: ImportFrame = { names: { observe: "wrongInspect" }, aliases: {} };
    const functions: FenelFunction[] = [
      { id: "A:run", params: [], returns: { $ref: "Value" }, body: { call: ["invoke", { fn: [[], { call: ["observe"] }] }] } },
      { id: "B:invoke", params: [{ name: "f", type: { $ref: "Value" }, label: Nothing, ui: Nothing, meta: {} }], returns: { $ref: "Value" }, body: { call: [{ var: "f" }] } },
    ];
    const observed: EvaluateContext[] = [];
    const first = [{ typeName: "Live", args: ["first"], methods: {} }];
    const second = [{ typeName: "Live", args: ["second"], methods: {} }];
    const ctx: EvaluateContext = {
      getFunction: (id) => functions.find((fn) => fn.id === id),
      getFunctionImportFrame: (id) => id === "A:run" ? a : id === "B:invoke" ? b : undefined,
      _dictStack: first,
      nativesCtx: { inspect: (current) => { observed.push(current); return current._dictStack; }, wrongInspect: () => { throw new Error("Caller module captured the callback name"); } },
    };
    expect(evaluate({ call: ["A:run"] }, {}, ctx)).toBe(first);
    expect(evaluate({ call: ["A:run"] }, {}, ctx)).toBe(first);
    expect(observed[0]).toBe(observed[1]);
    observed[1]!._dictStack = second;
    expect(evaluate({ call: ["A:run"] }, {}, ctx)).toBe(first);
    expect(observed[2]).not.toBe(observed[1]);
    observed[2]!._importStack = [b];
    expect(evaluate({ call: ["A:run"] }, {}, ctx)).toBe(first);
    expect(observed[3]).not.toBe(observed[2]);
    ctx._dictStack = second;
    expect(evaluate({ call: ["A:run"] }, {}, ctx)).toBe(second);
    expect(observed[4]).not.toBe(observed[3]);
    const captured = evaluate({ fn: [[], { call: ["observe"] }] }, {}, { ...ctx, _importStack: [a], _dictStack: first });
    expect(evaluate({ call: [{ var: "callback" }] }, { callback: captured }, { ...ctx, _importStack: [b], _dictStack: second })).toBe(second);
  });
});
