import { describe, expect, test } from "bun:test";
import { algebraModule } from "../src/modules/algebra";
import { engineModule } from "../src/modules/engine";
import { stdModule } from "../src/modules/std";
import { createEngineBootstrapRegistry } from "../src/registry";
import { invokeSelfHostSourceBody } from "../src/self-host-body-oracle";

// C1: execute the actual current source functions through the canonical
// evaluator carrier and source frame. No replacement evaluator/native bodies.
const registry = createEngineBootstrapRegistry([stdModule, engineModule, algebraModule]);
const context = registry.evaluateContext();
const take = algebraModule.functions!.find(fn => fn.id === "algebra:take")!;
const seq = algebraModule.functions!.find(fn => fn.id === "algebra:seqTakeTwo")!;
const inputs = [
  [10, 20, 30],
  Object.freeze({ $tag: "Vec", "0": 10, "1": 20, "2": 30 }),
];
const firstTwo = { $tag: "Vec", "0": 10, "1": 20 };

describe("actual source axis take and local sequence binding", () => {
  test("zero take over an empty List or Vec does not index an absent cell", () => {
    expect(invokeSelfHostSourceBody(take, [0, []], context)).toEqual({ $tag: "Vec" });
    expect(invokeSelfHostSourceBody(take, [0, { $tag: "Vec" }], context)).toEqual({ $tag: "Vec" });
  });

  test("two take over both finite representations returns the same two-cell Vec", () => {
    for (const input of inputs) {
      expect(invokeSelfHostSourceBody(take, [2, input], context)).toEqual(firstTwo);
    }
    expect(inputs[0]).toEqual([10, 20, 30]);
    expect(inputs[1]).toEqual({ $tag: "Vec", "0": 10, "1": 20, "2": 30 });
  });

  test("seqTakeTwo's real source frame and declared result agree on local Vec take", () => {
    expect(context.getFunctionImportFrame?.(seq.id)?.names.take).toBe(take.id);
    expect(seq.returns).toEqual({ $el: { call: ["Vec", 2, { $var: "a" }] } });
    for (const input of inputs) {
      expect(invokeSelfHostSourceBody(seq, [input], context)).toEqual(firstTwo);
    }
  });
});
