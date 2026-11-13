// ---------------------------------------------------------------------------
// Targeted tests for the typeclass-driven operator dispatch — the
// post-overhaul picture where operators are Fenel functions with metadata
// rather than hardcoded JSON-Logic case branches.
//
// Integration paths are exercised by fenel-syntax.test.ts (parse/print
// round-trip) and set-algebra.test.ts ($preimage + fn-ref aggregates).
// This file pins specific behaviors that are easy to regress silently.
// ---------------------------------------------------------------------------

import { describe, it, expect } from "vitest";
import { parse } from "./fenel-parser";
import { print } from "./engine-bodies-dispatch";
import { evaluate } from "./json-logic";
import { dispatchRegistry } from "./system-entities";
import { getSystemEvaluateContext } from "./system-registry";
import { GLOBAL_ONLY } from "./dispatch-registry";

describe("Landing 1 probe 4 — pure std liveness negative control", () => {
  it("keeps printing, eq, operators, and data-typeclass resolution unchanged", () => {
    const ctx = getSystemEvaluateContext();
    const expression = parse("1 + 2 * 3");

    expect(print(expression)).toBe("1 + 2 * 3");
    expect(evaluate(expression, {}, ctx)).toBe(7);
    expect(evaluate({ call: ["eq", "same", "same"] }, {}, ctx)).toBe(true);

    // modules-as-values Phase 2e — the instance is argued by the handle `std.add`.
    expect(dispatchRegistry.resolve("std.add", "Infixable", GLOBAL_ONLY)).toMatchObject({
      notation: "+",
      precedence: 6,
      associativity: "left",
    });

    const reprableBool = dispatchRegistry
      .listMatchingInstances("JsRuntime", "Reprable", GLOBAL_ONLY)
      .find((instance) => instance.args[1] === "Boolean");
    expect(reprableBool).toMatchObject({
      args: ["JsRuntime", "Boolean"],
      methods: { native: { $ref: "Boolean" } },
    });

    expect(dispatchRegistry.resolve("Boolean", "Truthy", GLOBAL_ONLY)).toEqual(
      expect.objectContaining({ truthy: expect.anything() }),
    );
  }, 300_000);
});

describe("operators-as-functions — parser emits call form", () => {
  it("binary infix emits {call: [codeName, l, r]}", () => {
    expect(parse("1 + 2")).toEqual({ call: ["add", 1, 2] });
    expect(parse("a == b")).toEqual({ call: ["eq", { var: "a" }, { var: "b" }] });
    expect(parse("a and b")).toEqual({ call: ["and", { var: "a" }, { var: "b" }] });
  });

  it("unary prefix emits {call: [codeName, x]} via Prefixable", () => {
    expect(parse("not x")).toEqual({ call: ["not", { var: "x" }] });
    expect(parse("-x")).toEqual({ call: ["negate", { var: "x" }] });
  });
});

describe("operators-as-functions — printer renders infix via typeclass", () => {
  it("Infixable arity-2 call renders as `lhs OP rhs`", () => {
    expect(print({ call: ["add", 1, 2] })).toBe("1 + 2");
    expect(print({ call: ["eq", { var: "a" }, 0] })).toBe("a == 0");
    expect(print({ call: ["mul", { call: ["add", 1, 2] }, 3] })).toBe("(1 + 2) * 3");
  });

  it("Prefixable arity-1 call renders as `<notation> arg`", () => {
    expect(print({ call: ["negate", { var: "x" }] })).toBe("-x");
    expect(print({ call: ["not", { var: "x" }] })).toBe("not x");
  });

  it("round-trips: parse → print → parse produces identical AST", () => {
    for (const src of ["1 + 2", "a == 0", "not x", "-x", "(a + b) * c", "a and (b or c)"]) {
      const ast = parse(src);
      expect(parse(print(ast))).toEqual(ast);
    }
  });
});

describe("typeclass instances drive the operator inventory", () => {
  it("Infixable registry contains the std operator set", () => {
    const insts = dispatchRegistry.listInstances("Infixable");
    const notations = new Set(insts.map((i) => i.methods?.notation));
    for (const n of ["+", "-", "*", "/", "%", "==", "!=", "<", "<=", ">", ">=", "and", "or", "cat"]) {
      expect(notations.has(n)).toBe(true);
    }
  });

  it("Prefixable registry has `not` and `-` (negate)", () => {
    const insts = dispatchRegistry.listInstances("Prefixable");
    const notations = new Set(insts.map((i) => i.methods?.notation));
    expect(notations.has("not")).toBe(true);
    expect(notations.has("-")).toBe(true);
  });
});

describe("key-as-fnId shorthand", () => {
  it("{add: [1, 2]} evaluates as a call to add", () => {
    const ctx = getSystemEvaluateContext();
    expect(evaluate({ add: [1, 2] }, {}, ctx)).toBe(3);
    expect(evaluate({ mul: [3, 4] }, {}, ctx)).toBe(12);
  });

  it("registry-less fallback via BUILTIN_OP_NATIVES still works", () => {
    expect(evaluate({ add: [1, 2] })).toBe(3);
    expect(evaluate({ eq: [5, 5] })).toBe(true);
  });

  it("explicit `call` form remains valid", () => {
    expect(evaluate({ call: ["add", 10, 20] }, {}, getSystemEvaluateContext())).toBe(30);
  });
});

// `$preimage` with function-reference aggregators retired in Phase 3.
// The composition shape `length(value) >= N` now lives directly inside
// `$where`; tests for that path live in the Vec / LengthBoundedString
// suites in dependent-types.test.ts.
