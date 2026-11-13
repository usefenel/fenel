import { beforeAll, describe, expect, test } from "bun:test";
import { dispatchedDataExpressionValue, dispatchedJsonLogicToExpr } from "./engine-bodies-dispatch";
import { loadFenelModule } from "./fenel-module";
import { evaluate, type EvaluateContext } from "./json-logic";
import { stdModule } from "./modules/std";
import { createRegistry } from "./registry";

describe("checking-only data expression projection", () => {
  let context: EvaluateContext;
  let targets: Record<string, string>;
  beforeAll(() => {
    const source = loadFenelModule(`module ConstructorDataProjectionProbe where
Choice = Local | Foreign
Customer = Customer name: String country: Choice
Order = Order customer: Customer items: List Customer zip: String
`, "ConstructorDataProjectionProbe");
    const registry = createRegistry([stdModule, source]);
    context = registry.evaluateContext();
    targets = Object.fromEntries(registry.listConstructorSignatures()
      .filter((row) => row.ownerModule === "ConstructorDataProjectionProbe")
      .map((row) => [row.name, row.targetId]));
  }, 60_000);

  const customer = () => ({ construct: [targets.Customer, {
    country: { construct: [targets.Local] }, name: "Alice",
  }] });
  const order = () => ({ construct: [targets.Order, {
    zip: "12345", items: [customer(), customer()], customer: customer(),
  }] });

  test("projects source-owned exact constructors and nested lists without caller function lookup", () => {
    let lookups = 0;
    const captured = { ...context, getFunction: () => { lookups++; throw new Error("Caller lookup ran"); } };
    const prog = order();
    const original = structuredClone(prog);
    const projected = dispatchedDataExpressionValue(prog, captured);
    expect(projected).toEqual({ $tag: "Concrete", value: {
      $tag: "Order", zip: "12345",
      customer: { $tag: "Customer", name: "Alice", country: { $tag: "Local" } },
      items: Array.from({ length: 2 }, () => ({ $tag: "Customer", name: "Alice", country: { $tag: "Local" } })),
    } });
    expect(projected).toEqual({ $tag: "Concrete", value: evaluate(prog, {}, context) });
    expect(lookups).toBe(0);
    expect(prog).toEqual(original);
    const slots = context._ctorFieldKeys![targets.Customer!]!;
    const lifted = dispatchedJsonLogicToExpr(customer(), {
      [targets.Customer!]: slots.map((slot) => ({ key: slot.key, wireName: slot.wire })),
      [targets.Local!]: [],
    }) as { $tag: string; _0: { fields: unknown } };
    expect(lifted._0.fields).toEqual(slots.map((slot) => ({ key: slot.key, wireName: slot.wire })));
  });

  test("keeps record and list data separate from ordinary appendItem and native calls", () => {
    let calls = 0;
    const captured = { ...context,
      getFunction: () => { calls++; throw new Error("Caller lookup ran"); },
      natives: { sideEffect: () => { calls++; return 7; } },
    };
    expect(dispatchedDataExpressionValue({ first: [1, 2], second: [] }, captured))
      .toEqual({ $tag: "Concrete", value: { first: [1, 2], second: [] } });
    for (const prog of [
      { call: ["appendItem", 1, []] },
      { call: ["sideEffect"] },
      { construct: [targets.Customer, { name: { call: ["sideEffect"] }, country: { construct: [targets.Local] } }] },
      { var: "captured" },
      { $ref: "captured" },
      { if: [true, customer(), customer()] },
      { fn: [["x"], { call: ["sideEffect"] }] },
      { call: ["$", { fn: [["x"], { call: ["sideEffect"] }] }, 1] },
      { $tag: "ECall", fnId: "sideEffect", args: [], lit: true },
      { __fenelFn: true, params: [] },
      { add: 1 },
      { abs: -2 },
      { abs: [] },
      { construct: [targets.Customer, { name: { appendItem: [1, []] }, country: { construct: [targets.Local] } }] },
    ]) expect(dispatchedDataExpressionValue(prog, captured).$tag).toBe("Residual");
    expect(calls).toBe(0);
  });

  test("unavailable constructor metadata, malformed sources and accessors remain residual", () => {
    let reads = 0;
    const cyclic: Record<string, unknown> = { first: 1 };
    cyclic.second = cyclic;
    const getter = Object.defineProperty({}, "$tag", { enumerable: true, get: () => { reads++; return "Local"; } });
    const hostileContext = Object.defineProperty({ ...context }, "_ctorFieldKeys", {
      get: () => { reads++; return context._ctorFieldKeys; },
    });
    for (const prog of [null, undefined, cyclic, getter, [1, , 3], { construct: ["Unknown"] }]) {
      expect(dispatchedDataExpressionValue(prog, context).$tag).toBe("Residual");
    }
    expect(dispatchedDataExpressionValue(customer(), {})).toEqual({ $tag: "Residual", expr: customer() });
    expect(dispatchedDataExpressionValue(customer(), hostileContext).$tag).toBe("Residual");
    expect(reads).toBe(0);
  });

  test("raw tagged carriers stay residual while explicit constructors retain runtime parity", () => {
    const value = { $tag: "Customer", name: "Alice", country: { $tag: "Local" } };
    for (const prog of [
      value,
      { first: value, second: [] },
      [{ $tag: "Local" }],
      { construct: [targets.Customer, { name: "Alice", country: { $tag: "Local" } }] },
      { ...value, extra: 1 },
      { ...value, $tag: targets.Customer },
      { $tag: "Customer", renamed: "Alice", country: { $tag: "Local" } },
    ]) expect(dispatchedDataExpressionValue(prog, context)).toEqual({ $tag: "Residual", expr: prog });
    for (const tag of ["True", "False"]) {
      const raw = { $tag: tag };
      expect(evaluate(raw, {}, context)).toEqual(raw);
      expect(dispatchedDataExpressionValue(raw, context)).toEqual({ $tag: "Residual", expr: raw });
      const target = Object.entries(context._constructorWireNames ?? {}).find(([target, wire]) =>
        wire === tag && target !== tag && context._constructors?.[target] !== undefined
        && context._ctorFieldKeys?.[target] !== undefined)?.[0];
      expect(target).toBeDefined();
      const explicit = { construct: [target] };
      expect(dispatchedDataExpressionValue(explicit, context))
        .toEqual({ $tag: "Concrete", value: evaluate(explicit, {}, context) });
      expect(evaluate(explicit, {}, context)).toBe(tag === "True");
    }
  });
});
