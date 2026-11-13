import { describe, expect, it } from "vitest";
import {
  __defineDataContextBindingForTests,
  __newEvaluatorOwnedRecordForTests,
  evaluate,
  ownDataRead,
  type EvaluateContext,
} from "./json-logic";
import type { FenelFunction } from "./types";

const Nothing = { $tag: "Nothing" } as const;

const hostileFunction: FenelFunction = {
  id: "test:hostile-params",
  params: ["__proto__", "constructor"].map((name) => ({
    name,
    type: { $ref: "Number" },
    label: Nothing,
    ui: Nothing,
    meta: {},
  })),
  returns: { $ref: "Number" },
  body: { "+": [{ var: "__proto__" }, { var: "constructor" }] },
};

describe("ownDataRead foreign host boundary", () => {
  it("distinguishes present undefined from an inherited or accessor slot", () => {
    const record = Object.create({ inherited: 7 }) as Record<string, unknown>;
    let getterReads = 0;
    Object.defineProperty(record, "present", { value: undefined });
    Object.defineProperty(record, "accessor", { get() { getterReads++; return 9; } });
    expect(ownDataRead(record, "present")).toEqual({ found: true, value: undefined });
    expect(ownDataRead(record, "inherited")).toEqual({ found: false });
    expect(ownDataRead(record, "accessor")).toEqual({ found: false });
    expect(getterReads).toBe(0);
  });

  it("refuses an own accessor despite an inherited descriptor value", () => {
    let getterReads = 0;
    const record = Object.defineProperty({ present: undefined }, "x", {
      enumerable: true, get() { getterReads++; return "accessor result"; },
    });
    const previous = Object.getOwnPropertyDescriptor(Object.prototype, "value");
    const pollution = Object.assign(Object.create(null), { value: "inherited poison", configurable: true, writable: true });
    let accessorRead: unknown, undefinedRead: unknown, evaluated: unknown;
    Object.defineProperty(Object.prototype, "value", pollution);
    try {
      accessorRead = ownDataRead(record, "x");
      undefinedRead = ownDataRead(record, "present");
      evaluated = evaluate({ var: ["x", "missing"] }, record, {});
    } finally {
      Reflect.deleteProperty(Object.prototype, "value");
      if (previous !== undefined) Object.defineProperty(Object.prototype, "value", previous);
    }
    expect(accessorRead).toEqual({ found: false });
    expect(undefinedRead).toEqual({ found: true, value: undefined });
    expect(evaluated).toBe("missing");
    expect(getterReads).toBe(0);
  });

  it("reads a Proxy descriptor without its get trap and preserves descriptor exceptions", () => {
    let getReads = 0, descriptorReads = 0;
    const payload = {};
    const proxy = new Proxy({ x: payload }, {
      get() { getReads++; throw new Error("ordinary get must not run"); },
      getOwnPropertyDescriptor(target, key) {
        descriptorReads++;
        return Reflect.getOwnPropertyDescriptor(target, key);
      },
    });
    expect(ownDataRead(proxy, "x")).toEqual({ found: true, value: payload });
    expect(ownDataRead(proxy, "missing")).toEqual({ found: false });
    expect(getReads).toBe(0);
    expect(descriptorReads).toBe(2);
    const reason = new Error("descriptor read refused");
    const throwing = new Proxy({}, { getOwnPropertyDescriptor() { throw reason; } });
    let caught: unknown;
    try { ownDataRead(throwing, "x"); } catch (error) { caught = error; }
    expect(caught).toBe(reason);
  });
});

describe("interpreted function parameter binding", () => {
  it("binds prototype-hostile named-function parameters as own data", () => {
    const ctx: EvaluateContext = {
      getFunction: (name) => (name === hostileFunction.id ? hostileFunction : undefined),
    };

    expect(evaluate({ call: [hostileFunction.id, 3, 5] }, {}, ctx)).toBe(8);
  });

  it("binds prototype-hostile closure parameters as own data", () => {
    const closureCall = {
      apply: [
        {
          fn: [
            "__proto__",
            "constructor",
            { "+": [{ var: "__proto__" }, { var: "constructor" }] },
          ],
        },
        [3, 5],
      ],
    };

    expect(evaluate(closureCall, {}, {})).toBe(8);
  });

  // E3 (2026-10-23): the evaluator reads and copies the records it created
  // itself without descriptors. These pin that a FOREIGN record still takes
  // the descriptor route at every such site, and that the evaluator's own
  // records keep their exact shape.
  const accessorData = (calls: { n: number }, proto: object | null) => {
    const data = Object.create(proto) as Record<string, unknown>;
    Object.defineProperty(data, "x", { get: () => { calls.n++; return 41; }, enumerable: true, configurable: true });
    Object.defineProperty(data, "y", { value: 2, enumerable: true, configurable: true, writable: true });
    return data;
  };

  it("never runs a foreign accessor when reading, copying or capturing a context", () => {
    for (const proto of [null, Object.prototype]) {
      const calls = { n: 0 };
      const data = accessorData(calls, proto);
      expect(evaluate({ var: ["x", "miss"] }, data, {})).toBe("miss");
      expect(evaluate({ where: [{ var: ["x", "miss"] }, { z: 1 }] }, data, {})).toBe("miss");
      expect(evaluate({ where: [{ var: "y" }, { z: 1 }] }, data, {})).toBe(2);
      expect(evaluate({ do: [{ let: { z: 1 } }, { var: ["x", "miss"] }] }, data, {})).toBe("miss");
      expect(evaluate({ match: [{ construct: ["Just", 3] }, { $tag: "Just", _0: { $bind: "v" } }, { var: ["x", "miss"] }] }, data, {})).toBe("miss");
      expect(evaluate({ apply: [{ fn: [[], { var: ["x", "miss"] }] }, []] }, data, {})).toBe("miss");
      expect(evaluate({ apply: [{ fn: [[], { var: "y" }] }, []] }, data, {})).toBe(2);
      expect(calls.n).toBe(0);
    }
  });

  it("never runs a foreign Proxy's get trap when reading or copying a context", () => {
    const traps: string[] = [];
    const data = new Proxy({ y: 2 } as Record<string, unknown>, {
      get(target, key, receiver) { traps.push(`get:${String(key)}`); return Reflect.get(target, key, receiver); },
    });
    expect(evaluate({ where: [{ var: "y" }, { z: 1 }] }, data, {})).toBe(2);
    expect(evaluate({ where: [{ var: "z" }, { z: 1 }] }, data, {})).toBe(1);
    expect(evaluate({ apply: [{ fn: [[], { var: "y" }] }, []] }, data, {})).toBe(2);
    expect(traps).toEqual([]);
  });

  it("reads a frozen record's own data only, and only while it is frozen", () => {
    const calls = { n: 0 };
    const frozenAccessor = Object.freeze(accessorData(calls, Object.prototype));
    expect(evaluate({ var: ["x", "miss"] }, frozenAccessor, {})).toBe("miss");
    expect(evaluate({ where: [{ var: ["x", "miss"] }, { z: 1 }] }, frozenAccessor, {})).toBe("miss");
    expect(evaluate({ var: "y" }, frozenAccessor, {})).toBe(2);
    expect(calls.n).toBe(0);

    const frozenPlain = Object.freeze({ a: 1 });
    expect(evaluate({ var: "a" }, frozenPlain, {})).toBe(1);
    expect(evaluate({ var: ["toString", "miss"] }, frozenPlain, {})).toBe("miss");
    expect(evaluate({ where: [{ var: ["hasOwnProperty", "miss"] }, { z: 1 }] }, frozenPlain, {})).toBe("miss");

    // A record read while still mutable keeps the descriptor route after a
    // slot becomes an accessor.
    const later = { x: 1 } as Record<string, unknown>;
    expect(evaluate({ var: "x" }, later, {})).toBe(1);
    expect(evaluate({ where: [{ var: "x" }, { z: 1 }] }, later, {})).toBe(1);
    Object.defineProperty(later, "x", { get: () => { calls.n++; return 5; }, enumerable: true, configurable: true });
    expect(evaluate({ var: ["x", "miss"] }, later, {})).toBe("miss");
    expect(evaluate({ where: [{ var: ["x", "miss"] }, { z: 1 }] }, later, {})).toBe("miss");
    expect(calls.n).toBe(0);
  });

  // PINNED RESIDUAL (E3, json-logic.ts `EvaluatorOwnedRecord`): an
  // evaluator-owned record is read without descriptors, so an accessor that
  // host code later installs on one of its slots DOES run. Pinned so that any
  // change to it is visible; HEAD before E3 skipped the accessor instead.
  it("pins the evaluator-owned residual: a later-installed getter runs once, a prototype swap never leaks", () => {
    const closure = evaluate({ where: [{ fn: [[], { var: "a" }] }, { a: 1 }] }, {}, {}) as { closure: object };
    const calls = { n: 0 };
    Object.defineProperty(closure.closure, "a", { get: () => { calls.n++; return 5; }, enumerable: true, configurable: true });
    expect(evaluate({ apply: [{ var: "f" }, []] }, { f: closure }, {})).toBe(5);
    expect(calls.n).toBe(1);

    const swapped = evaluate({ where: [{ fn: [[], { var: ["leak", "miss"] }] }, { a: 1 }] }, {}, {}) as { closure: object };
    Object.setPrototypeOf(swapped.closure, { leak: 9 });
    expect(evaluate({ apply: [{ var: "f" }, []] }, { f: swapped }, {})).toBe("miss");

    const value = evaluate({ construct: ["Pair", 1, 2] }, {}, {}) as object;
    Object.setPrototypeOf(value, { x: 7 });
    expect(evaluate({ var: ["v.x", "miss"] }, { v: value }, {})).toBe("miss");
    expect(evaluate({ var: "v._0" }, { v: value }, {})).toBe(1);
  });

  it("a branded binding target whose prototype was swapped takes the defining write", () => {
    const target = __newEvaluatorOwnedRecordForTests();
    const setterCalls = { n: 0 };
    const proto = Object.create(Object.prototype, {
      x: { set: () => { setterCalls.n++; }, configurable: true },
    }) as object;
    Object.setPrototypeOf(target, proto);
    const payload = { evil: 1 };
    __defineDataContextBindingForTests(target, "__proto__", payload);
    __defineDataContextBindingForTests(target, "x", 3);
    expect(setterCalls.n).toBe(0);
    expect(Object.getPrototypeOf(target)).toBe(proto);
    expect(Object.getOwnPropertyDescriptor(target, "__proto__")).toEqual({ value: payload, writable: true, enumerable: true, configurable: true });
    expect(Object.getOwnPropertyDescriptor(target, "x")).toEqual({ value: 3, writable: true, enumerable: true, configurable: true });
  });

  it("keeps the evaluator's own records null-prototype with plain data slots", () => {
    const literal = () => JSON.parse('{"__proto__": 5, "constructor": 6}');
    const record = evaluate({ where: [{ var: "r" }, { r: literal() }] }, {}, {}) as Record<string, unknown>;
    expect(Object.getPrototypeOf(record)).toBeNull();
    expect(Object.getOwnPropertyDescriptor(record, "__proto__")).toEqual({ value: 5, writable: true, enumerable: true, configurable: true });
    expect(Object.getOwnPropertyDescriptor(record, "constructor")).toEqual({ value: 6, writable: true, enumerable: true, configurable: true });
    expect(evaluate({ where: [{ var: "r.__proto__" }, { r: literal() }] }, {}, {})).toBe(5);
    expect(evaluate({ where: [{ var: "r.constructor" }, { r: literal() }] }, {}, {})).toBe(6);
    const closure = evaluate({ where: [{ fn: [[], { var: "a" }] }, { a: 1 }] }, {}, {}) as { closure: object };
    expect(Object.getPrototypeOf(closure.closure)).toBeNull();
    expect(Object.getOwnPropertyDescriptors(closure.closure)).toEqual({
      a: { value: 1, writable: true, enumerable: true, configurable: true },
    });
    expect(evaluate({ where: [{ var: "toString" }, { toString: 7 }] }, {}, {})).toBe(7);
    expect(evaluate({ where: [{ var: ["hasOwnProperty", "miss"] }, { z: 1 }] }, {}, {})).toBe("miss");
    expect(evaluate({ apply: [{ fn: [["__proto__"], { var: "__proto__" }] }, [9]] }, {}, {})).toBe(9);
    const value = evaluate({ construct: ["Pair", 1, 2] }, {}, {}) as Record<string, unknown>;
    expect(Object.getPrototypeOf(value)).toBeNull();
    expect(Object.getOwnPropertyDescriptors(value)).toEqual({
      $tag: { value: "Pair", writable: true, enumerable: true, configurable: true },
      _0: { value: 1, writable: true, enumerable: true, configurable: true },
      _1: { value: 2, writable: true, enumerable: true, configurable: true },
    });
  });

  it("does not copy inherited bindings into a closure application", () => {
    const inheritedOnly = Object.create({ constructor: 99 }) as Record<string, unknown>;
    const closureRead = {
      apply: [{ fn: [[], { var: ["constructor", "missing"] }] }, []],
    };

    expect(evaluate(closureRead, inheritedOnly, {})).toBe("missing");
  });
});
