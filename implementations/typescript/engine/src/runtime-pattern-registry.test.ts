import { describe, expect, test } from "vitest";
import { Nothing } from "./type-foundation";
import { createRegistry } from "./registry";
import {
  evaluate,
  resolveImportAlias,
  resolveImportedName,
  type EvaluateContext,
} from "./json-logic";
import type { FenelFunction, FenelModule, FenelType, FieldDef } from "./types";

function field(name: string): FieldDef {
  return {
    name,
    type: { $ref: "String" },
    label: Nothing,
    ui: Nothing,
    meta: {},
  };
}

function variantModule(
  moduleName: string,
  entityId: string,
  ctor: string,
  fields: FieldDef[],
): FenelModule {
  return {
    name: moduleName,
    label: moduleName,
    entities: [{
      id: entityId,
      type: { $variant: { cases: [{ name: ctor, fields }] } } as FenelType,
    }],
    functions: [],
  };
}

describe("field-identity Phase 4b — registry runtime pattern metadata", () => {
  test("identified constructor views expose frozen ordered slots while pattern caches stay evaluator-private", () => {
    const sourceField = field("payload");
    const recordField = field("recordValue");
    const mod = variantModule("runtime-pattern", "TwinOwner", "TwinBox", [sourceField]);
    mod.entities!.push({
      id: "TwinRecord",
      type: { $record: { fields: [recordField] } } as FenelType,
    });
    const reg = createRegistry([mod]);
    const first = reg.evaluateContext();
    const second = reg.evaluateContext();

    expect(Object.getPrototypeOf(first._ctorFieldKeys)).toBeNull();
    expect(first._ctorFieldKeys).toBe(second._ctorFieldKeys);
    expect(first._patternPlans).toBeUndefined();
    expect(second._patternPlans).toBeUndefined();
    expect(Object.isFrozen(first._ctorFieldKeys)).toBe(true);
    expect(Object.isFrozen(first._constructors)).toBe(true);
    expect(first._moduleNames).not.toHaveProperty("add");
    expect(first._uuidBySlug).not.toHaveProperty("set");
    expect(Object.getPrototypeOf(first.natives)).toBeNull();
    expect(first._strictPatternFields).toBe(false);
    expect(first._ctorFieldKeys!["TwinBox"]?.map((slot) => slot.wire)).toEqual(["payload"]);
    expect(first._ctorFieldKeys!["TwinRecord"]?.map((slot) => slot.wire)).toEqual(["recordValue"]);
    expect(first._ctorFieldKeys!["TwinBox"]?.[0]?.key.$tag).toBe("NamedField");
    expect(first._constructors!["TwinBox"]).toEqual(["payload"]);
    expect("key" in sourceField).toBe(false);
    expect("key" in recordField).toBe(false);
  }, 90_000);

  test("public routing projections cannot poison the live memoized resolver table", () => {
    const reg = createRegistry([]);
    const first = reg.routingTable();
    const live = reg.evaluateContext()._routingTable?.();

    expect(Object.isFrozen(first)).toBe(true);
    expect(Object.isFrozen(first.routeIdx)).toBe(true);
    expect(Object.isFrozen(live)).toBe(true);
    expect(() => {
      first.routeIdx.poison = { $tag: "RDirect" };
    }).toThrow();
    expect(Object.prototype.hasOwnProperty.call(reg.routingTable().routeIdx, "poison")).toBe(false);
    expect(Object.prototype.hasOwnProperty.call(
      (reg.evaluateContext()._routingTable?.() as typeof first).routeIdx,
      "poison",
    )).toBe(false);

    // type-substrate P1(a.18) — the evaluator now retains ONE private clone per
    // registry per dispatch version, keyed on the `_routingTable` getter rather
    // than on the context object. The PUBLIC getter must therefore still be
    // copy-on-read, or an external caller would hold the very object the served
    // resolver reads. Defeater: return the private copy from the getter.
    //
    // PRECONDITION, asserted rather than assumed: `registryEgressValue` clones
    // only a graph that CARRIES BYTES, and returns the deep-frozen memo as-is
    // otherwise. This registry is built with no modules, so what makes its
    // routing table Bytes-bearing is the process-global DEFAULT dispatch
    // registry (`Exemplifiable Bytes`). Without that the two reads would be the
    // same object and the assertion below would be vacuous — so the Bytes are
    // checked first.
    const hasBytes = (v: unknown, seen = new Set<unknown>()): boolean => {
      if (v instanceof Uint8Array) return true;
      if (v === null || typeof v !== "object" || seen.has(v)) return false;
      seen.add(v);
      return Object.values(v as Record<string, unknown>).some((x) => hasBytes(x, seen));
    };
    const ctx = reg.evaluateContext();
    const readA = ctx._routingTable?.() as typeof first;
    const readB = ctx._routingTable?.() as typeof first;
    expect(hasBytes(readA)).toBe(true);
    expect(readA).not.toBe(readB);
    expect(Object.isFrozen(readA)).toBe(true);
    expect(Object.isFrozen(readB)).toBe(true);
    expect(readA).toEqual(readB);
  }, 30_000);

  test("a same-tag/different-identified-slots conflict is absent while the legacy constructor table remains", () => {
    const reg = createRegistry([
      variantModule("runtime-pattern-a", "TwinOwnerA", "TwinConflict", [field("left")]),
      variantModule("runtime-pattern-b", "TwinOwnerB", "TwinConflict", [field("right")]),
    ]);
    const ctx = reg.evaluateContext();

    expect(Object.prototype.hasOwnProperty.call(ctx._constructors, "TwinConflict")).toBe(true);
    expect(Object.prototype.hasOwnProperty.call(ctx._ctorFieldKeys, "TwinConflict")).toBe(false);
  }, 30_000);

  test("import/sample/render tables retain prototype-hostile semantic names as own data", () => {
    const reg = createRegistry([variantModule(
      "runtime-pattern-hostile",
      "HostileOwner",
      "__proto__",
      [field("constructor")],
    )]);
    const ctx = reg.evaluateContext();

    expect(Object.getPrototypeOf(ctx._sampleByTag)).toBeNull();
    expect(Object.getPrototypeOf(ctx._renderByTag)).toBeNull();
    expect(Object.prototype.hasOwnProperty.call(ctx._ctorFieldKeys, "__proto__")).toBe(true);
    expect(ctx._ctorFieldKeys!["__proto__"]?.[0]?.wire).toBe("constructor");

    const names = reg.buildImportFrame([
      { module: "Imported", names: ["__proto__"] },
    ] as never);
    const aliases = reg.buildImportFrame([
      { module: "Imported", as: "constructor" },
    ] as never);
    expect(Object.getPrototypeOf(names.names)).toBeNull();
    expect(Object.getPrototypeOf(aliases.aliases)).toBeNull();
    expect(resolveImportedName({ _importStack: [names] }, "__proto__")).toBe("Imported:__proto__");
    expect(resolveImportAlias({ _importStack: [aliases] }, "constructor")).toBe("Imported");
  }, 30_000);

  test("constructor reflection uses the ingress snapshot and rejects a hostile re-ingress", () => {
    const mod = variantModule(
      "runtime-pattern-constructor-accessor",
      "AccessorOwner",
      "AccessorBox",
      [field("payload")],
    );
    const rawCase = (
      mod.entities![0]!.type as {
        $variant: { cases: Array<Record<string, unknown>> };
      }
    ).$variant.cases[0]!;
    const reg = createRegistry([mod]);
    let reads = 0;
    Object.defineProperty(rawCase, "name", {
      enumerable: true,
      configurable: true,
      get: () => {
        reads += 1;
        return "AccessorBox";
      },
    });

    const ctx = reg.evaluateContext();

    expect(ctx._ctorFieldKeys!["AccessorBox"]?.map((slot) => slot.wire)).toEqual(["payload"]);
    expect(ctx._constructors!["AccessorBox"]).toEqual(["payload"]);
    expect(reads).toBe(0);
    // modules[1]: `createRegistrySteps` prepends the `authority` module to any
    // module list that lacks it (rights R2a), so the test's module is second.
    expect(() => createRegistry([mod])).toThrow(
      /registry modules\[1\]\.entities\[0\]\.type\.\$variant\.cases\[0\]: accessor property "name" is not allowed/,
    );
    expect(reads).toBe(0);
  }, 30_000);

  test("constructor reflection rejects an entity-type accessor without executing it", () => {
    const mod = variantModule(
      "runtime-pattern-entity-type-accessor",
      "EntityTypeAccessorOwner",
      "EntityTypeAccessorBox",
      [],
    );
    const entity = mod.entities![0]!;
    let reads = 0;
    Object.defineProperty(entity, "type", {
      enumerable: true,
      configurable: true,
      get: () => {
        reads += 1;
        return { $variant: { cases: [] } };
      },
    });

    expect(() => createRegistry([mod])).toThrow(/accessor property "type" is not allowed/);
    expect(reads).toBe(0);
  }, 30_000);

  test("sample/render ingress rejects inherited reference accessors without reading them", () => {
    const mod = variantModule(
      "runtime-pattern-dispatch-accessor",
      "DispatchOwner",
      "DispatchBox",
      [],
    );
    let reads = 0;
    const inheritedReference = {};
    Object.defineProperty(inheritedReference, "$ref", {
      get: () => {
        reads += 1;
        return "poison";
      },
    });
    mod.instances = [
      {
        typeName: "Sampleable",
        args: ["DispatchOwner"],
        methods: { sample: Object.create(inheritedReference) },
      },
      {
        typeName: "Renderable",
        args: ["DispatchOwner"],
        methods: { render: Object.create(inheritedReference) },
      },
    ];

    // modules[1]: the prepended `authority` module is modules[0] (see above).
    expect(() => createRegistry([mod])).toThrow(
      /registry modules\[1\]\.instances\[0\]\.methods\.sample: non-plain transport object is not allowed/,
    );
    expect(reads).toBe(0);
  }, 30_000);
});

describe("field-identity Phase 4b — remaining name-map tails", () => {
  test("general variable paths use own data and never invoke accessors", () => {
    const inherited = Object.create({ constructor: 7 }) as Record<string, unknown>;
    expect(evaluate({ var: "constructor" }, inherited)).toBeNull();

    let reads = 0;
    const accessor = {} as Record<string, unknown>;
    Object.defineProperty(accessor, "value", {
      enumerable: true,
      get: () => { reads += 1; return 8; },
    });
    expect(evaluate({ var: "value" }, accessor)).toBeNull();
    expect(reads).toBe(0);

    const own = {} as Record<string, unknown>;
    Object.defineProperty(own, "__proto__", { value: 9, enumerable: true });
    expect(evaluate({ var: "__proto__" }, own)).toBe(9);
  });

  test("named-call substitution treats hostile parameters as own fields", () => {
    const fn = {
      id: "runtime-pattern:hostileParams",
      params: [{ name: "__proto__" }, { name: "constructor" }],
      returns: { $ref: "String" },
      body: { var: "__proto__" },
    } as unknown as FenelFunction;
    const ctx: EvaluateContext = {
      getFunction: (name) => name === fn.id ? fn : undefined,
    };
    const named = {} as Record<string, unknown>;
    Object.defineProperty(named, "__proto__", { value: "safe", enumerable: true });
    Object.defineProperty(named, "constructor", { value: "also-safe", enumerable: true });

    expect(evaluate({ call: [fn.id, named] }, {}, ctx)).toBe("safe");
  });
});
