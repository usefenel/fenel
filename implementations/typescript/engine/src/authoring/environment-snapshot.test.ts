import { describe, expect, test } from "bun:test";
import { createAuthoringEnvironment, type AuthoringCatalogSnapshot } from "./environment";
import type { FenelType } from "../types";

function catalog(type: FenelType): AuthoringCatalogSnapshot {
  return {
    types: [{ id: "shape", name: "Shape", entityId: "Shape", description: "", category: "type", type }],
    functions: [], capabilities: [], catalogTypes: [type, type],
    operatorCodeNameByNotation: new Map(),
  };
}

function withPrototypeSlot<T>(
  prototype: object,
  key: string,
  descriptor: PropertyDescriptor,
  action: () => T,
): T {
  const prior = Object.getOwnPropertyDescriptor(prototype, key);
  Object.defineProperty(prototype, key, Object.assign(Object.create(null), descriptor));
  try {
    return action();
  } finally {
    Reflect.deleteProperty(prototype, key);
    if (prior !== undefined) Object.defineProperty(prototype, key, prior);
  }
}

describe("owned authoring catalog snapshots", () => {
  test("copies a repeated DAG once while isolating callers and separate sessions", () => {
    const leaf: FenelType = { $ref: "Number" };
    let dag: FenelType = leaf;
    // The source has a small DAG, though expanding every shared edge would
    // create thousands of copies. Identity assertions test the actual contract
    // without relying on a machine-specific timing threshold.
    for (let depth = 0; depth < 12; depth++) dag = { $tuple: [dag, dag] };
    const source = catalog(dag);
    const first = createAuthoringEnvironment(source).catalog;
    const second = createAuthoringEnvironment(source).catalog;
    expect(first.catalogTypes[0]).toBe(first.catalogTypes[1]);
    expect(first.catalogTypes[0]).toBe(first.types[0]!.type);
    expect(first.catalogTypes).not.toBe(source.catalogTypes);
    expect(first.catalogTypes[0]).not.toBe(dag);
    expect(first.catalogTypes[0]).not.toBe(second.catalogTypes[0]);
    let current = first.catalogTypes[0]!;
    for (let depth = 0; depth < 12; depth++) {
      expect(Object.isFrozen(current)).toBe(true);
      if (!("$tuple" in current)) throw new Error("Expected an owned tuple");
      expect(Object.isFrozen(current.$tuple)).toBe(true);
      expect(current.$tuple[0]).toBe(current.$tuple[1]);
      current = current.$tuple[0]!;
    }
    expect(Object.isFrozen(current)).toBe(true);
    leaf.$ref = "String";
    source.catalogTypes.length = 0;
    expect(current).toEqual({ $ref: "Number" });
    expect(first.catalogTypes).toHaveLength(2);
  });

  test("a repeated ancestor remains a cycle rather than a memoized value", () => {
    const cycle: FenelType = { $tuple: [] };
    cycle.$tuple.push(cycle);
    expect(() => createAuthoringEnvironment(catalog(cycle))).toThrow("cyclic catalog data");
  });

  test("accessors are rejected without being invoked after a shared subtree", () => {
    let reads = 0;
    const shared: FenelType = { $ref: "Number" };
    const hostile = Object.defineProperty({}, "$ref", { enumerable: true, get() { reads++; return "Number"; } }) as FenelType;
    const source = catalog(shared);
    source.catalogTypes.push(hostile);
    expect(() => createAuthoringEnvironment(source)).toThrow("accessor property");
    expect(reads).toBe(0);
  });

  test("non-plain prototypes and symbol properties still fail the snapshot boundary", () => {
    const inherited = Object.assign(Object.create({ inherited: true }), { $ref: "Number" }) as FenelType;
    expect(() => createAuthoringEnvironment(catalog(inherited))).toThrow("non-plain catalog data");
    const symbolKey = { $ref: "Number", [Symbol("hidden")]: 1 } as FenelType;
    expect(() => createAuthoringEnvironment(catalog(symbolKey))).toThrow("symbol catalog properties");
  });

  test("top-level catalog rows bypass inherited setters", () => {
    const source = catalog({ $ref: "Number" });
    let setterCalls = 0;
    const output = withPrototypeSlot(Object.prototype, "catalogTypes", {
      configurable: true, set() { setterCalls += 1; },
    }, () => createAuthoringEnvironment(source).catalog);
    expect(setterCalls).toBe(0);
    expect(Object.hasOwn(output, "catalogTypes")).toBe(true);
    expect(output.catalogTypes).toEqual(source.catalogTypes);
    expect(output.catalogTypes).not.toBe(source.catalogTypes);
  });

  test("dense copied array slots bypass inherited numeric setters", () => {
    const source = catalog({ $ref: "Number" });
    source.types = [];
    source.catalogTypes = [{ $ref: "Number" }];
    let setterCalls = 0;
    const output = withPrototypeSlot(Array.prototype, "0", {
      configurable: true, set() { setterCalls += 1; },
    }, () => createAuthoringEnvironment(source).catalog);
    expect(setterCalls).toBe(0);
    expect(Object.hasOwn(output.catalogTypes, "0")).toBe(true);
    expect(output.catalogTypes).toEqual(source.catalogTypes);
    expect(Object.isFrozen(output.catalogTypes)).toBe(true);
  });

  test("an inherited descriptor value never admits an own accessor", () => {
    let getterReads = 0;
    const accessor = Object.defineProperty({}, "$ref", {
      enumerable: true, get() { getterReads += 1; return "Number"; },
    }) as FenelType;
    const source = catalog(accessor);
    let caught: unknown;
    withPrototypeSlot(Object.prototype, "value", {
      value: "inherited poison", configurable: true, writable: true,
    }, () => {
      try { createAuthoringEnvironment(source); } catch (error) { caught = error; }
    });
    expect(caught).toBeInstanceOf(TypeError);
    expect(String(caught)).toContain("accessor property");
    expect(getterReads).toBe(0);
  });

  test("inherited descriptor get cannot invalidate a plain-data copy", () => {
    const source = catalog({ $ref: "Number" });
    let caught: unknown;
    let output: AuthoringCatalogSnapshot | undefined;
    withPrototypeSlot(Object.prototype, "get", {
      value: undefined, configurable: true, writable: true,
    }, () => {
      try { output = createAuthoringEnvironment(source).catalog; } catch (error) { caught = error; }
    });
    expect(caught).toBeUndefined();
    expect(output?.catalogTypes).toEqual(source.catalogTypes);
  });

  test("copies own __proto__ data and preserves null-prototype nested records", () => {
    const source = catalog(Object.assign(Object.create(null), { $ref: "Number" }) as FenelType);
    Object.defineProperty(source, "__proto__", { value: "catalog metadata", enumerable: true });
    const output = createAuthoringEnvironment(source).catalog;
    expect(Object.getPrototypeOf(output)).toBe(Object.prototype);
    expect(Object.getOwnPropertyDescriptor(output, "__proto__")).toEqual({
      value: "catalog metadata", enumerable: true, configurable: false, writable: false,
    });
    expect(Object.getPrototypeOf(output.catalogTypes[0]!)).toBeNull();
    expect(Object.getOwnPropertyDescriptor(output.catalogTypes, "0")).toEqual({
      value: output.catalogTypes[0], enumerable: true, configurable: false, writable: false,
    });
  });

  test("array copying preserves changing Proxy length observations and final shape", () => {
    for (const observed of [[2, 1], [1, 3, 3, 3]]) {
      const source = catalog({ $ref: "Number" });
      source.types = [];
      let lengthReads = 0;
      const target = [{ $ref: "Number" }, { $ref: "String" }, { $ref: "Boolean" }];
      source.catalogTypes = new Proxy(target, {
        get(array, key, receiver) {
          return key === "length" ? observed[lengthReads++] : Reflect.get(array, key, receiver);
        },
      });
      let setterCalls = 0;
      const output = withPrototypeSlot(Array.prototype, "1", {
        configurable: true, set() { setterCalls += 1; },
      }, () => createAuthoringEnvironment(source).catalog);
      const expected = observed.length === 2 ? target.slice(0, 1) : target;
      expect(lengthReads).toBe(observed.length);
      expect(setterCalls).toBe(0);
      expect(output.catalogTypes).toEqual(expected);
      expect(Object.keys(output.catalogTypes)).toEqual(Object.keys(expected));
      expect(Object.getOwnPropertyDescriptor(output.catalogTypes, "length")).toEqual({
        value: expected.length, enumerable: false, configurable: false, writable: false,
      });
    }
  });

  test("array copying does not allocate from a Proxy's reported descriptor length", () => {
    const source = catalog({ $ref: "Number" });
    source.types = [];
    let lengthReads = 0;
    source.catalogTypes = new Proxy([{ $ref: "Number" }], {
      get(array, key, receiver) {
        if (key === "length") { lengthReads += 1; return 1; }
        return Reflect.get(array, key, receiver);
      },
      getOwnPropertyDescriptor(array, key) {
        const descriptor = Reflect.getOwnPropertyDescriptor(array, key);
        return key === "length" ? { ...descriptor, value: Number.MAX_SAFE_INTEGER } : descriptor;
      },
    });
    const output = createAuthoringEnvironment(source).catalog;
    expect(lengthReads).toBe(2);
    expect(output.catalogTypes).toEqual([{ $ref: "Number" }]);
    expect(Object.keys(output.catalogTypes)).toEqual(["0"]);
  });

  test("extra array properties do not become copied tail slots", () => {
    const source = catalog({ $ref: "Number" });
    source.types = [];
    source.catalogTypes = Object.assign([{ $ref: "Number" }], { extra: "ignored" });
    const output = createAuthoringEnvironment(source).catalog;
    expect(output.catalogTypes).toEqual([{ $ref: "Number" }]);
    expect(Object.keys(output.catalogTypes)).toEqual(["0"]);
  });

  test("a sparse array cannot borrow an inherited descriptor-table slot", () => {
    const source = catalog({ $ref: "Number" });
    source.types = [];
    source.catalogTypes = new Array(1);
    let caught: unknown;
    withPrototypeSlot(Object.prototype, "0", {
      configurable: true, value: { value: { $ref: "Number" } },
    }, () => {
      try { createAuthoringEnvironment(source); } catch (error) { caught = error; }
    });
    expect(caught).toBeInstanceOf(TypeError);
    expect(String(caught)).toContain("sparse catalog array slot 0");
  });

  test("reentrant source reflection keeps separate snapshot definition carriers", () => {
    let inner: AuthoringCatalogSnapshot | undefined;
    const leaf = new Proxy({ $ref: "Number" }, {
      ownKeys(target) {
        if (inner === undefined) inner = createAuthoringEnvironment(catalog({ $ref: "String" })).catalog;
        return Reflect.ownKeys(target);
      },
    });
    const outer = createAuthoringEnvironment(catalog(leaf)).catalog;
    expect(outer.catalogTypes[0]).toEqual({ $ref: "Number" });
    expect(inner?.catalogTypes[0]).toEqual({ $ref: "String" });
    expect(outer.catalogTypes[0]).not.toBe(inner?.catalogTypes[0]);
    expect(Object.isFrozen(outer.catalogTypes[0])).toBe(true);
    expect(Object.isFrozen(inner?.catalogTypes[0])).toBe(true);
  });
});
