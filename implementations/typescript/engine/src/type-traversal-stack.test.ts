import { expect, test } from "bun:test";
import { functionUsages } from "./type-traversal";
import { Nothing } from "./type-foundation";
import type { FenelFunction } from "./types";

function fixtureFunction(index: number, target: boolean): FenelFunction {
  return {
    id: `stack-fixture:${index}`,
    params: [{
      name: "value",
      key: {
        $tag: "NamedField",
        ref: {
          $ref: `30000000-0000-4000-8000-${String(index + 1).padStart(12, "0")}`,
        },
      },
      label: Nothing,
      type: { $ref: target ? "StackTarget" : "String" },
      meta: {},
      ui: Nothing,
    }],
    returns: { $ref: "Boolean" },
  };
}

test("function usage scanning is stack-safe for a browser-sized catalog", () => {
  const inputs = Array.from({ length: 5_000 }, (_, index) => ({
    fn: fixtureFunction(index, index === 4_999),
  }));

  const usages = functionUsages(inputs, "StackTarget");

  expect(usages).toHaveLength(1);
  expect(usages[0]?.id).toBe("stack-fixture:4999");
  expect(usages[0]?.asParam).toEqual([{
    $tag: "FieldUsageSlot",
    key: {
      $tag: "NamedField",
      ref: { $ref: "30000000-0000-4000-8000-000000005000" },
    },
    wireName: "value",
  }]);
});
