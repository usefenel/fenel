import { beforeAll, describe, expect, test } from "bun:test";
import { stdNativesCtx } from "../../../../fenel/modules/std/ffi/std-ffi";
import type { EvaluateContext } from "./json-logic";
import { createRegistry, type ModuleRegistry } from "./registry";
import { stdModule } from "./modules/std";
import { withInterpretedResolver } from "./engine-bodies-dispatch";
import { invokeSelfHostSourceBody } from "./self-host-body-oracle";

test("groupBy treats inherited JavaScript property names as ordinary keys", () => {
  const context: EvaluateContext = { getFunction: () => undefined };
  const identity = { __fenelFn: true, params: ["item"], body: { var: "item" }, closure: {} };
  const values = ["constructor", "__proto__", "toString", "constructor"];
  const grouped = stdNativesCtx.groupBy!(context, identity, values) as Record<string, unknown[]>;
  expect(Object.keys(grouped)).toEqual(["constructor", "__proto__", "toString"]);
  expect(Object.entries(grouped)).toEqual([
    ["constructor", ["constructor", "constructor"]],
    ["__proto__", ["__proto__"]],
    ["toString", ["toString"]],
  ]);
  expect(values).toEqual(["constructor", "__proto__", "toString", "constructor"]);
});

// Refactor control (typed grouping M2, 2026-11-06): groupByAcc now runs the
// shared std.groupFold traversal. Its Fenel body must still equal the native
// (entries and key order, callback order, first-error stop). Green before and
// after the refactor.
describe("std.groupBy Fenel body equals the native", () => {
  let registry: ModuleRegistry;
  let context: EvaluateContext;
  beforeAll(() => withInterpretedResolver(() => {
    registry = createRegistry([stdModule]);
    context = registry.evaluateContext();
  }), 900_000);

  test("inherited property names, numeric-looking keys and key order", () => {
    const fn = registry.getFunction("std:groupBy")!;
    const identity = { __fenelFn: true, params: ["item"], body: { var: "item" }, closure: {} };
    const values = ["constructor", "__proto__", "toString", "10", "2", "constructor"];
    const native = stdNativesCtx.groupBy!(context, identity, values) as Record<string, unknown[]>;
    const body = withInterpretedResolver(() => invokeSelfHostSourceBody(fn, [identity, values], context)) as Record<string, unknown[]>;
    expect(Object.entries(body)).toEqual(Object.entries(native));
    expect(Object.keys(body)).toEqual(Object.keys(native));
  }, 300_000);

  test("callback order and the first callback error", () => {
    const fn = registry.getFunction("std:groupBy")!;
    const seen: unknown[] = [];
    const failure = new Error("probe key failure");
    const probe: EvaluateContext = { ...context, natives: { ...context.natives, probeKey: (value: unknown) => {
      seen.push(value);
      if (value === "stop") throw failure;
      return value;
    } } };
    withInterpretedResolver(() => invokeSelfHostSourceBody(fn, [{ $ref: "probeKey" }, ["a", "b", "a"]], probe));
    expect(seen).toEqual(["a", "b", "a"]);
    seen.length = 0;
    expect(() => withInterpretedResolver(() => invokeSelfHostSourceBody(fn, [{ $ref: "probeKey" }, ["first", "stop", "later"]], probe))).toThrow();
    expect(seen).toEqual(["first", "stop"]);
  }, 300_000);
});
