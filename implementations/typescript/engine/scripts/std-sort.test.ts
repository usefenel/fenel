import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { loadFenelModule } from "../src/fenel-module";
import { evaluate, type EvaluateContext } from "../src/json-logic";
import { stdNatives, stdNativesCtx } from "../../../../fenel/modules/std/ffi/std-ffi";

// C1 harness: exercise the authored sort without its TS performance branch.
// GLOBAL_ONLY: this isolated fixture has system std operations and no reader,
// account, authority, or product registry projection.
const sourceRoot = resolve(import.meta.dir, "../../../../fenel/modules/std");
const modules = ["hof-combine.fenel", "count.fenel", "fromMaybe.fenel"].map((file) =>
  loadFenelModule(readFileSync(resolve(sourceRoot, file), "utf8"), `sort-fixture-${file}`),
);
const keyModule = loadFenelModule(`module sortFixture where
@native
observedKey : (value: a) -> b
numericKey : (value: Number) -> Number
numericKey value = 0 - value
recordKey : (value: a) -> Number
recordKey value = value.rank
`, "sort-fixture-keys");
const functions = [...modules, keyModule].flatMap((module) => module.functions ?? []);
const functionsById = new Map(functions.map((fn) => [fn.id, fn]));
const functionsByName = new Map(functions.map((fn) => [fn.id.split(":").at(-1)!, fn]));
const { sort: _nativeSort, map: _nativeMap, ...otherHigherOrderNatives } = stdNativesCtx;
const context: EvaluateContext = {
  getFunction: (name) => functionsById.get(name) ?? functionsByName.get(name),
  natives: stdNatives,
  nativesCtx: otherHigherOrderNatives,
  _constructors: { Nothing: [], Just: ["_0"] },
};

function sortBody(values: readonly unknown[], key: unknown, ctx = context): unknown[] {
  // Data bindings keep a record's keys, tags, and nested callable-like payloads
  // from being interpreted as expressions while entering the function.
  return evaluate(
    { call: ["std:sort", { var: "key" }, { var: "values" }] },
    { key, values },
    ctx,
  ) as unknown[];
}

function observedSort<T>(values: readonly T[], project: (value: T) => unknown) {
  const visited: T[] = [];
  const ctx: EvaluateContext = {
    ...context,
    natives: {
      ...stdNatives,
      "sortFixture:observedKey": (value) => {
        visited.push(value as T);
        return project(value as T);
      },
    },
  };
  const sorted = sortBody(values, { $ref: "sortFixture:observedKey" }, ctx) as T[];
  expect(visited).toEqual([...values]);
  return sorted;
}

// Independent small-input oracle: the headwise merge choices, using the actual
// std comparison leaf (including its cross-kind false verdicts): the right head
// goes first only when `lt right left` (2026-10-30: incomparable keys are a tie).
function headwiseSort<T>(values: readonly T[], project: (value: T) => unknown, comparisons: unknown[][]): T[] {
  type Pair = { key: unknown; value: T };
  const merge = (left: Pair[], right: Pair[]): Pair[] => {
    if (left.length === 0) return right;
    if (right.length === 0) return left;
    comparisons.push([right[0]!.key, left[0]!.key]);
    return stdNatives.lt!(right[0]!.key, left[0]!.key)
      ? [right[0]!, ...merge(left, right.slice(1))]
      : [left[0]!, ...merge(left.slice(1), right)];
  };
  const sort = (pairs: Pair[]): Pair[] => {
    if (pairs.length < 2) return pairs;
    const half = Math.floor(pairs.length / 2);
    return merge(sort(pairs.slice(0, half)), sort(pairs.slice(half)));
  };
  return sort(values.map((value) => ({ key: project(value), value }))).map((pair) => pair.value);
}

describe("Fenel std:sort at roster scale", () => {
  test("handles empty and singleton inputs with zero and one key evaluations", () => {
    expect(observedSort([], (value) => value)).toEqual([]);
    const value = { rank: 2, nested: { $tag: "Just", _0: "kept" } };
    expect(observedSort([value], (item) => item.rank)).toEqual([value]);
  });

  test("sorts numeric keys and keeps equal keys in input order", () => {
    const values = [3, -2, 1, 3, 0, -2, 7].map((rank, ordinal) => ({ rank, ordinal }));
    const expected = [...values].sort((left, right) => left.rank - right.rank);
    const result = observedSort(values, (value) => value.rank);
    expect(result).toEqual(expected);
    result.forEach((value, index) => expect(value).toBe(expected[index]!));
    expect(observedSort(values, () => 1)).toEqual(values);
    expect(values.map((value) => value.rank)).toEqual([3, -2, 1, 3, 0, -2, 7]);
  });

  test("preserves lexical keys and general values without evaluating their payload", () => {
    const values = ["β", "a", "🙂", "a", "A"].map((label, ordinal) => ({
      label, ordinal, payload: { $tag: "Just", _0: { call: ["unregistered", ordinal] } },
    }));
    expect(observedSort(values, (value) => value.label)).toEqual(
      [...values].sort((left, right) => left.label < right.label ? -1 : left.label > right.label ? 1 : 0),
    );
  });

  test("accepts Fenel-defined key functions and custom lambda keys", () => {
    expect(sortBody([2, 7, -3, 0, 5], { $ref: "sortFixture:numericKey" })).toEqual([7, 5, 2, 0, -3]);
    const values = [{ rank: 2, note: "two" }, { rank: -1, note: "minus" }, { rank: 2, note: "later" }];
    expect(sortBody(values, { $ref: "sortFixture:recordKey" })).toEqual([values[1], values[0], values[2]]);
    const lambda = evaluate({ fn: ["item", { var: "item.rank" }] }, {}, context);
    expect(sortBody(values, lambda)).toEqual([values[1], values[0], values[2]]);
  });

  test("follows the headwise lt choices for mixed and boundary scalar keys", () => {
    // Order only: other helpers (count, take, drop) also call std lt, so a
    // trace of lt calls no longer isolates the merge decisions.
    const cases: unknown[][] = [
      [0, "0", 0],
      ["2", 1, "1", 2, 0, "0"],
      [1, "a", -1, "b", 2, "a", 0],
      [true, false, true, 0, "0", false],
      [Infinity, -Infinity, NaN, 0, -0, 1, -1, NaN],
      [0, -0, 0, -0],
      ["", "β", "🙂", "", "", "🙂"],
    ];
    for (const keys of cases) {
      const values = keys.map((key, ordinal) => ({ key, ordinal }));
      const expected = headwiseSort(values, (value) => value.key, []);
      const ctx: EvaluateContext = {
        ...context,
        natives: { ...stdNatives, "sortFixture:observedKey": (value) => (value as { key: unknown }).key },
      };
      expect(sortBody(values, { $ref: "sortFixture:observedKey" }, ctx)).toEqual(expected);
      // The native perf branch gives the same order.
      expect((stdNativesCtx.sort as (c: unknown, f: unknown, x: unknown) => unknown)(ctx,
        { __fenelFn: true, params: ["x"], body: { var: "x.key" }, closure: {} }, values)).toEqual(expected);
    }
  });

  test("threads the exact remaining runs through bounded merge steps", () => {
    const left = [{ k: 1, v: "a" }, { k: 3, v: "c" }];
    const right = [{ k: 2, v: "b" }, { k: 4, v: "d" }];
    const steps = (budget: number) => evaluate(
      { call: ["std:sortMergeSteps", budget, { var: "left" }, { var: "right" }] },
      { left, right },
      context,
    );
    expect(steps(0)).toEqual({ prefix: [], left, right });
    expect(steps(-1)).toEqual({ prefix: [], left, right });
    expect(steps(1)).toEqual({ prefix: [left[0]], left: [left[1]], right });
    expect(steps(2)).toEqual({ prefix: [left[0], right[0]], left: [left[1]], right: [right[1]] });
    expect(steps(4)).toEqual({ prefix: [left[0], right[0], left[1]], left: [], right: [right[1]] });
    const mergeHead = (xs: unknown[], ys: unknown[]) => evaluate(
      { call: ["std:sortMergeHead", { var: "xs" }, { var: "ys" }] },
      { xs, ys },
      context,
    );
    expect(mergeHead([], right)).toEqual({ prefix: [], left: [], right });
    expect(mergeHead(left, [])).toEqual({ prefix: [], left, right: [] });
    expect(mergeHead([], [])).toEqual({ prefix: [], left: [], right: [] });
  });

  test("sorts a non-power-of-two roster with duplicates and exactly one key read per row", () => {
    const values = Array.from({ length: 6_503 }, (_, ordinal) => ({
      rank: (ordinal * 37) % 97,
      ordinal,
      payload: { $tag: "Just", _0: `row-${ordinal}` },
    }));
    const expected = [...values].sort((left, right) => left.rank - right.rank);
    expect(observedSort(values, (value) => value.rank)).toEqual(expected);
  }, 60_000);

  test("handles roster-sized ascending, descending, and all-equal runs", () => {
    const ascending = Array.from({ length: 6_503 }, (_, rank) => ({ rank, payload: `row-${rank}` }));
    expect(observedSort(ascending, (value) => value.rank)).toEqual(ascending);
    expect(observedSort([...ascending].reverse(), (value) => value.rank)).toEqual(ascending);
    expect(observedSort(ascending, () => 0)).toEqual(ascending);
  }, 60_000);

  test("checked registry runs the Fenel sort with identified helper fields and namespace lookup", async () => {
    // Keep construction inside this case: source-only test filters incur no
    // complete registry boot. Run this integration after identity generation.
    const [{ createRegistry }, { stdModule }] = await Promise.all([
      import("../src/registry"),
      import("../src/modules/std"),
    ]);
    const registry = createRegistry([{
      ...stdModule,
      nativeImplsCtx: Object.fromEntries(Object.entries(stdModule.nativeImplsCtx ?? {})
        .filter(([name]) => !["sort", "map", "std:sort", "std:map"].includes(name))),
    }]);
    const registered = registry.getFunction("std:sortMergeSteps")!;
    expect(registered).toBeDefined();
    expect(registry.getFunction("sortMergeSteps")?.id).toBe(registered.id);
    expect("$record" in registered.returns && registered.returns.$record.fields.map((field) => field.name).sort())
      .toEqual(["left", "prefix", "right"]);
    const checkedContext = registry.evaluateContext();
    expect(evaluate(
      { call: ["std:sort", { $ref: "std:id" }, { var: "values" }] },
      { values: [7, -2, 7, 0, 1] },
      checkedContext,
    )).toEqual([-2, 0, 1, 7, 7]);
    const values = [0, "0", 0, "1", 1].map((key, ordinal) => ({ key, ordinal }));
    const key = evaluate({ fn: ["item", { var: "item.key" }] }, {}, checkedContext);
    expect(sortBody(values, key, checkedContext)).toEqual(
      headwiseSort(values, (value) => value.key, []),
    );
  }, 300_000);
});
