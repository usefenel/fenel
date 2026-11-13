import { beforeAll, describe, expect, test } from "bun:test";
import SOURCE from "../../../../fenel/modules/publicdemo/utility-numbers.fenel?raw";
import STATISTICS_TYPES from "../../../../fenel/modules/publicdemo/statistics-types.fenel?raw";
import STATISTICS_SOURCE from "../../../../fenel/modules/publicdemo/statistics-demo.fenel?raw";
import DRAWING from "../../../../fenel/modules/publicdemo/drawing-demo.fenel?raw";
import { loadFenelModule, loadFenelModuleUnion } from "./fenel-module";
import { invokeCallable, type EvaluateContext } from "./json-logic";
import { createRegistry, type ModuleRegistry } from "./registry";
import { stdModule } from "./modules/std";
import { timeModule } from "./modules/time";
import { pictureModule } from "./modules/picture";
import { pathModule } from "./modules/path";
import { Just, Nothing } from "./type-foundation";

// Extends existing C1: executes the real authored recipes and their existing
// statistics/time owners. No calculation or validator is implemented here.
let registry: ModuleRegistry;
let context: EvaluateContext;
beforeAll(() => {
  registry = createRegistry([
    stdModule, timeModule, pictureModule, pathModule,
    loadFenelModule(DRAWING, "DrawingDemo"),
    ...loadFenelModuleUnion([
      { src: STATISTICS_TYPES, name: "StatisticsDemo" },
      { src: STATISTICS_SOURCE, name: "StatisticsDemo" },
    ]),
    loadFenelModule(SOURCE, "UtilityDemo"),
  ]);
  context = registry.evaluateContext();
}, 180_000);

const call = (name: string, ...args: unknown[]) => invokeCallable({ $ref: `UtilityDemo:${name}` }, args, context);
const Ok = (value: unknown) => ({ $tag: "Ok", _0: value });
const duration = (totalSeconds: number, milliseconds: number) => Ok({
  $tag: "FixedDurationTotal", totalSeconds,
  duration: { $tag: "Duration", ms: milliseconds },
});
const refused = (name: string, ...args: unknown[]) => {
  const value = call(name, ...args) as { $tag: string; _0: unknown };
  expect(value.$tag).toBe("Err");
  expect(typeof value._0).toBe("string");
  expect((value._0 as string).length).toBeGreaterThan(0);
  return value;
};

describe("source-owned practical number and fixed-time utilities", () => {
  test("ordinary recipes have bodies, exact result declarations and no native shims", () => {
    for (const name of ["percentageOf", "percentageChange", "discountedTotal", "mixedDuration", "elapsedSeconds"]) {
      const fn = registry.getFunction(`UtilityDemo:${name}`)!;
      expect(fn.body).toBeDefined();
      expect(fn.returns).toBeDefined();
      expect(fn.returns).not.toEqual({ $record: { fields: [] } });
    }
    const loaded = loadFenelModule(SOURCE, "UtilityDemo");
    expect(loaded.nativeImpls).toBeUndefined();
    expect(loaded.nativeImplsCtx).toBeUndefined();
  });

  test.each([
    [250, 15, 37.5], [0, 10, 0], [-200, 12.5, -25],
    [200, -12.5, -25], [1000000, 1000000, 10000000000],
  ])("percentage of %p at %p gives %p", (value, percent, expected) => {
    expect(call("percentageOf", value, percent)).toEqual(Ok(expected));
  });

  test("percentage inputs refuse non-finite, wrong or out-of-bounds scalars", () => {
    for (const value of [NaN, Infinity, -Infinity, 1000001, -1000001, "10", null]) {
      refused("percentageOf", value, 10);
      refused("percentageOf", 10, value);
    }
    expect(call("percentageOf", 10, 25)).toEqual(Ok(2.5));
  });

  test("percentage change has an explicit positive-baseline convention", () => {
    expect(call("percentageChange", 80, 100)).toEqual(Ok(25));
    expect(call("percentageChange", 100, 80)).toEqual(Ok(-20));
    expect(call("percentageChange", 50, 0)).toEqual(Ok(-100));
    expect(call("percentageChange", 50, -50)).toEqual(Ok(-200));
    expect(call("percentageChange", 50, 50)).toEqual(Ok(0));
    for (const baseline of [0, -1, NaN, Infinity, 1000001, "50"]) refused("percentageChange", baseline, 100);
    for (const after of [NaN, Infinity, -Infinity, 1000001, -1000001, "100"]) refused("percentageChange", 80, after);
    expect(refused("percentageChange", 1e-310, 1000000)._0).toBe("The calculation exceeds the finite Number range.");
    expect(call("percentageChange", 80, 100)).toEqual(Ok(25));
  });

  test("discount keeps price and discount domains explicit", () => {
    expect(call("discountedTotal", 120, 20)).toEqual(Ok(96));
    expect(call("discountedTotal", 120, 0)).toEqual(Ok(120));
    expect(call("discountedTotal", 120, 100)).toEqual(Ok(0));
    expect(call("discountedTotal", 19.95, 10)).toEqual(Ok(17.955));
    for (const price of [-1, 1000001, Infinity, NaN, "120"]) refused("discountedTotal", price, 20);
    for (const discount of [-1, 101, Infinity, NaN, "20"]) refused("discountedTotal", 120, discount);
  });

  test("mixed fixed durations reuse time milliseconds and yield the exact 3965-second example", () => {
    expect(call("mixedDuration", 1, 6, 5)).toEqual(duration(3965, 3965000));
    expect(call("mixedDuration", 0, 0, 0)).toEqual(duration(0, 0));
    expect(call("mixedDuration", 0.5, 0.25, 0.125)).toEqual(duration(1815.125, 1815125));
    expect(call("mixedDuration", 1000000, 1000000, 1000000)).toEqual(duration(3661000000, 3661000000000));
    for (const component of [-1, 1000001, Infinity, -Infinity, NaN, "1", null]) {
      refused("mixedDuration", component, 6, 5);
      refused("mixedDuration", 1, component, 5);
      refused("mixedDuration", 1, 6, component);
    }
    expect(call("mixedDuration", 1, 6, 5)).toEqual(duration(3965, 3965000));
  });

  test("elapsed supplied milliseconds preserve ordering, integer endpoints and actual Duration", () => {
    expect(call("elapsedSeconds", 0, 2500)).toEqual(duration(2.5, 2500));
    expect(call("elapsedSeconds", 1791200000000, 1791203965000)).toEqual(duration(3965, 3965000));
    expect(call("elapsedSeconds", -10000000000000, 10000000000000)).toEqual(duration(20000000000, 20000000000000));
    expect(call("elapsedSeconds", 42, 42)).toEqual(duration(0, 0));
    refused("elapsedSeconds", 10, 9);
    for (const endpoint of [0.5, -10000000000001, 10000000000001, Infinity, NaN, "0"]) {
      refused("elapsedSeconds", endpoint, 10000000000000);
      refused("elapsedSeconds", -10000000000000, endpoint);
    }
  });

  test("the numeric collection retains callable references and reuses existing bounded statistics", () => {
    const tools = call("numberTools") as Record<string, { $ref: string }>;
    expect(Object.keys(tools).sort()).toEqual(["percentageOf", "percentageChange", "discountedTotal", "numberStatistics", "mixedDuration", "elapsedSeconds"].sort());
    for (const name of ["percentageOf", "percentageChange", "discountedTotal", "mixedDuration", "elapsedSeconds"]) {
      expect(tools[name]).toEqual({ $ref: registry.getUuid(`UtilityDemo:${name}`) ?? `UtilityDemo:${name}` });
    }
    expect(tools.numberStatistics).toEqual({ $ref: registry.getUuid("StatisticsDemo:numberStatistics") ?? "StatisticsDemo:numberStatistics" });
    const empty = invokeCallable(tools.numberStatistics!, [[]], context) as { $tag: string; summary: unknown };
    expect(empty.$tag).toBe("NumberStatistics");
    expect(empty.summary).toEqual({ $tag: "NumberSummary", count: 0, total: 0, average: Nothing, minimum: Nothing, maximum: Nothing });
    const summary = invokeCallable(tools.numberStatistics!, [[0.5, -1.5, 4]], context) as { summary: unknown };
    expect(summary.summary).toEqual({ $tag: "NumberSummary", count: 3, total: 3, average: Just(1), minimum: Just(-1.5), maximum: Just(4) });
    for (const values of [[Infinity], [1000001], Array(65).fill(1)]) {
      expect((invokeCallable(tools.numberStatistics!, [values], context) as { $tag: string }).$tag).toBe("NumberStatisticsRefused");
    }
  });

  test("source-owned starting data invokes actual callables, including statistics and fixed time", () => {
    const inputs = call("utilityNumberStartingInputs") as Array<{ function: { $ref: string }; arguments: unknown[] }>;
    expect(inputs).toHaveLength(6);
    const outputs = inputs.map(input => invokeCallable(input.function, input.arguments, context));
    expect(outputs[0]).toEqual(Ok(37.5));
    expect(outputs[1]).toEqual(Ok(25));
    expect(outputs[2]).toEqual(Ok(96));
    expect((outputs[3] as { summary: { total: number } }).summary.total).toBe(50);
    expect(outputs[4]).toEqual(duration(3965, 3965000));
    expect(outputs[5]).toEqual(duration(2.5, 2500));
  });
});
