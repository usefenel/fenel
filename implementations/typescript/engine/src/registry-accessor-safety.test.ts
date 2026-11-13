import { describe, expect, test } from "bun:test";

import {
  __deepFreezeRegistryValueForTests,
  __registryValueContainsBytesForTests,
  createEngineBootstrapRegistry,
  createRegistry,
  effectiveRegistryModules,
  ownArrayDataValues,
  type RegistryPublicBytesSnapshot,
} from "./registry";
import { createDispatchRegistry } from "./dispatch-registry";
import { __catalogHasRegisteredEntityForTests } from "./type-catalog";
import type { FenelModule, FieldDef, Instance } from "./types";

function moduleWith(instance: Instance): FenelModule {
  return {
    name: "accessor-hostile",
    label: "Accessor hostile",
    entities: [],
    functions: [],
    instances: [instance],
  };
}

describe("effective registry module ingress", () => {
  test("prepends authority exactly when no own authority name is present", () => {
    const mod: FenelModule = { name: "fixture", label: "Fixture", entities: [], functions: [] };
    const input = [mod];
    const effective = effectiveRegistryModules(input);
    expect(effective).toHaveLength(2);
    expect(effective[0]!.name).toBe("authority");
    expect(effective[1]).toBe(mod);
    expect(input).toEqual([mod]);
    expect(effectiveRegistryModules(effective)).toBe(effective);
  });

  test("an inherited authority name is absent and its getter is not read", () => {
    let reads = 0;
    const mod = Object.assign(Object.create({
      get name() { reads += 1; return "authority"; },
    }), { label: "Inherited name", entities: [], functions: [] }) as FenelModule;
    const effective = effectiveRegistryModules([mod]);
    expect(effective).toHaveLength(2);
    expect(effective[0]!.name).toBe("authority");
    expect(effective[1]).toBe(mod);
    expect(reads).toBe(0);
  });

  test("descriptor prototype pollution cannot make accessors into own module or array data", () => {
    let reads = 0;
    const mod = { label: "Accessor name", entities: [], functions: [] } as unknown as FenelModule;
    Object.defineProperty(mod, "name", {
      enumerable: true,
      get() { reads += 1; return "authority"; },
    });
    const slots: unknown[] = [];
    Object.defineProperty(slots, "0", {
      enumerable: true,
      get() { reads += 1; return "poison"; },
    });
    let moduleFailure: unknown;
    let arrayFailure: unknown;
    Object.defineProperty(Object.prototype, "value", {
      value: "authority", writable: true, enumerable: false, configurable: true,
    });
    try {
      try { effectiveRegistryModules([mod]); } catch (error) { moduleFailure = error; }
      try { ownArrayDataValues(slots, "polluted array"); } catch (error) { arrayFailure = error; }
    } finally {
      delete (Object.prototype as Record<string, unknown>).value;
    }
    expect(moduleFailure).toBeInstanceOf(TypeError);
    expect((moduleFailure as Error).message).toContain('accessor property "name" is not allowed');
    expect(arrayFailure).toBeInstanceOf(TypeError);
    expect((arrayFailure as Error).message).toContain('accessor property "0" is not allowed');
    expect(reads).toBe(0);
  });
});

describe("registry semantic method transport", () => {
  test("listFunctions reuses immutable function views behind disposable roster arrays", () => {
    const registry = createEngineBootstrapRegistry([{
      name: "function-roster-egress",
      label: "Function roster egress",
      entities: [],
      functions: [{
        id: "function-roster-egress:identity",
        params: [{
          name: "value",
          type: { $ref: "String" },
          label: { $tag: "Nothing" },
          ui: { $tag: "Nothing" },
          meta: {},
        }],
        returns: { $ref: "String" },
        body: { var: "value" },
      }],
    }], {
      dispatchRegistry: createDispatchRegistry(),
      publishCatalogEntities: false,
    });

    const first = registry.listFunctions();
    const second = registry.listFunctions();
    const expectedIds = second.map((fn) => fn.id);
    const firstFunction = first.find((fn) => fn.id === "function-roster-egress:identity")!;
    const secondFunction = second.find((fn) => fn.id === "function-roster-egress:identity")!;
    expect(first).not.toBe(second);
    expect(firstFunction).toBeDefined();
    expect(firstFunction).toBe(secondFunction);
    expect(Object.isFrozen(firstFunction)).toBe(true);

    first.splice(0, first.length);
    expect(first).toHaveLength(0);
    expect(second.map((fn) => fn.id)).toEqual(expectedIds);
    expect(registry.listFunctions().map((fn) => fn.id)).toEqual(expectedIds);
  });

  test("projects public Bytes metadata immutably without changing runtime Bytes", () => {
    const callerBytes = new Uint8Array([0, 127, 255]);
    const instance: Instance = {
      typeName: "Exemplifiable",
      args: ["BytesExample"],
      methods: { examples: [callerBytes] },
    };
    const dispatchRegistry = createDispatchRegistry();
    dispatchRegistry.addInstance({
      ...instance,
      methods: { examples: [new Uint8Array(callerBytes)] },
    });
    const registry = createEngineBootstrapRegistry([
      moduleWith(instance),
    ], { dispatchRegistry, publishCatalogEntities: false });

    const publishedModule = registry.modules.find((mod) => mod.name === "accessor-hostile")!;
    const examples = publishedModule.instances![0]!.methods.examples;
    expect(Array.isArray(examples)).toBe(true);
    const snapshotBytes = (examples as unknown[])[0] as RegistryPublicBytesSnapshot;
    expect(snapshotBytes).toEqual({ $bytes: [0, 127, 255] });
    expect(Object.isFrozen(snapshotBytes)).toBeTrue();
    expect(Object.isFrozen(snapshotBytes.$bytes)).toBeTrue();

    callerBytes[0] = 99;
    expect(snapshotBytes.$bytes).toEqual([0, 127, 255]);
    expect(() => {
      (snapshotBytes.$bytes as number[])[0] = 88;
    }).toThrow();
    const rereadBytes = (
      registry.modules.find((mod) => mod.name === "accessor-hostile")!
        .instances![0]!.methods.examples as unknown[]
    )[0] as RegistryPublicBytesSnapshot;
    expect(rereadBytes.$bytes).toEqual([0, 127, 255]);

    const runtimeInstance = registry.evaluateContext()._specRegistry
      ?.listInstances("Exemplifiable")
      .find((instance) => instance.args[0] === "BytesExample");
    const runtimeExamples = runtimeInstance?.methods.examples as unknown[] | undefined;
    expect(runtimeExamples?.[0]).toBeInstanceOf(Uint8Array);
    expect(Array.from(runtimeExamples?.[0] as Uint8Array)).toEqual([0, 127, 255]);
  });

  test("semantic function Bytes use copy-on-read while schemes and module DTOs stay canonical", () => {
    const bytes = new Uint8Array([3, 5, 8]);
    const functionId = "bytes-egress:identity";
    const registry = createRegistry([{
      name: "bytes-egress",
      label: "Bytes egress",
      entities: [],
      functions: [{
        id: functionId,
        params: [{
          name: "value",
          type: { $ref: "String" },
          label: { $tag: "Nothing" },
          ui: { $tag: "Nothing" },
          meta: { bytes } as never,
        }],
        returns: { $ref: "String" },
        body: { var: "value" },
      }],
      instances: [{
        typeName: "Codeable",
        args: [functionId],
        methods: { codeName: "identity" },
      }],
    }]);

    const firstFunctionBytes = (
      registry.getFunction(functionId)!.params[0]!.meta as unknown as { bytes: Uint8Array }
    ).bytes;
    expect(firstFunctionBytes).toBeInstanceOf(Uint8Array);
    const signatureParam = (
      registry.getFunctionSignatureInfo(functionId)!.scheme.body as unknown as {
        $arrow: { params: Array<{ meta?: unknown }> };
      }
    ).$arrow.params[0]!;
    // Effective schemes are semantic type judgments; the Fenel planner retains
    // the canonical metadata envelope but does not transport the caller's
    // arbitrary runtime Bytes leaf into that judgment.
    expect(signatureParam.meta).toEqual({});
    expect((signatureParam.meta as { bytes?: unknown }).bytes).toBeUndefined();
    firstFunctionBytes[0] = 99;

    const rereadFunctionBytes = (
      registry.getFunction(functionId)!.params[0]!.meta as unknown as { bytes: Uint8Array }
    ).bytes;
    expect(Array.from(rereadFunctionBytes)).toEqual([3, 5, 8]);

    const firstRoster = registry.listFunctions();
    const expectedRosterIds = firstRoster.map((fn) => fn.id);
    const firstRosterBytes = (
      firstRoster.find((fn) => fn.id === functionId)!.params[0]!.meta as unknown as { bytes: Uint8Array }
    ).bytes;
    expect(firstRosterBytes).toBeInstanceOf(Uint8Array);
    firstRosterBytes[0] = 77;
    expect(Object.isFrozen(firstRoster)).toBe(false);
    firstRoster.splice(0, firstRoster.length);
    const rereadRoster = registry.listFunctions();
    const rereadRosterBytes = (
      rereadRoster.find((fn) => fn.id === functionId)!.params[0]!.meta as unknown as { bytes: Uint8Array }
    ).bytes;
    expect(rereadRoster.map((fn) => fn.id)).toEqual(expectedRosterIds);
    expect(Array.from(rereadRosterBytes)).toEqual([3, 5, 8]);

    const contextBytes = (
      registry.evaluateContext().getFunction?.(functionId)!.params[0]!.meta as unknown as {
        bytes: Uint8Array;
      }
    ).bytes;
    contextBytes[2] = 99;
    expect(Array.from((
      registry.evaluateContext().getFunction?.(functionId)!.params[0]!.meta as unknown as {
        bytes: Uint8Array;
      }
    ).bytes)).toEqual([3, 5, 8]);

    const moduleBytes = (
      registry.modules.find((mod) => mod.name === "bytes-egress")!.functions![0]!.params[0]!.meta as unknown as {
        bytes: RegistryPublicBytesSnapshot;
      }
    ).bytes;
    expect(moduleBytes).toEqual({ $bytes: [3, 5, 8] });
    expect(Object.isFrozen(moduleBytes)).toBe(true);
    expect(Object.isFrozen(moduleBytes.$bytes)).toBe(true);

    bytes[0] = 42;
    expect(Array.from((
      registry.getFunction(functionId)!.params[0]!.meta as unknown as { bytes: Uint8Array }
    ).bytes)).toEqual([3, 5, 8]);
  }, 180_000);

  // E3 (2026-10-23): the recursive freezer records each frozen node's Bytes
  // verdict and the egress scan trusts it. Pin both verdicts per function, a
  // Bytes leaf shared twice inside one graph, and a roster mixing the two.
  test("freeze-time Bytes verdicts keep copy-on-read exactly where Bytes are", () => {
    const shared = new Uint8Array([1, 2]);
    const param = (name: string, meta: unknown): FieldDef => ({
      name,
      type: { $ref: "String" },
      label: { $tag: "Nothing" },
      ui: { $tag: "Nothing" },
      meta: meta as never,
    });
    const registry = createEngineBootstrapRegistry([{
      name: "bytes-verdicts",
      label: "Bytes verdicts",
      entities: [],
      functions: [{
        id: "bytes-verdicts:plain",
        params: [param("value", { note: { nested: ["x"] } })],
        returns: { $ref: "String" },
        body: { var: "value" },
      }, {
        id: "bytes-verdicts:shared",
        params: [param("first", { bytes: shared }), param("second", { again: { bytes: shared } })],
        returns: { $ref: "String" },
        body: { var: "first" },
      }, {
        id: "bytes-verdicts:single",
        params: [param("value", { deep: { bytes: new Uint8Array([4]) } })],
        returns: { $ref: "String" },
        body: { var: "value" },
      }],
    }], {
      dispatchRegistry: createDispatchRegistry(),
      publishCatalogEntities: false,
    });

    const plain = registry.getFunction("bytes-verdicts:plain")!;
    expect(registry.getFunction("bytes-verdicts:plain")).toBe(plain);
    expect(Object.isFrozen(plain.params[0]!.meta)).toBe(true);

    const read = () => {
      const fn = registry.getFunction("bytes-verdicts:shared")!;
      return [
        (fn.params[0]!.meta as unknown as { bytes: Uint8Array }).bytes,
        (fn.params[1]!.meta as unknown as { again: { bytes: Uint8Array } }).again.bytes,
      ] as const;
    };
    const [first, second] = read();
    expect(first).toBe(second);
    first[0] = 9;
    expect(Array.from(read()[0])).toEqual([1, 2]);
    expect(Array.from(read()[1])).toEqual([1, 2]);

    const single = () => (registry.getFunction("bytes-verdicts:single")!.params[0]!.meta as unknown as { deep: { bytes: Uint8Array } }).deep.bytes;
    single()[0] = 9;
    expect(Array.from(single())).toEqual([4]);

    const roster = registry.listFunctions();
    const rosterShared = roster.find((fn) => fn.id === "bytes-verdicts:shared")!;
    (rosterShared.params[1]!.meta as unknown as { again: { bytes: Uint8Array } }).again.bytes[1] = 9;
    expect(Array.from(read()[1])).toEqual([1, 2]);
    // perf 2026-10-31 (clone tax): a Bytes-bearing roster still copies its
    // Bytes spine per read, but a plain frozen Bytes-free function inside it
    // is now shared as it is (`frozenRegistryCopy`), like `getFunction` does.
    expect(roster.find((fn) => fn.id === "bytes-verdicts:plain")).toBe(plain);
    expect(roster.find((fn) => fn.id === "bytes-verdicts:shared")).not.toBe(registry.getFunction("bytes-verdicts:shared"));
  });

  test("a node whose only Bytes leaf was first reached elsewhere still answers true", () => {
    const u8 = new Uint8Array([1]);
    const root = __deepFreezeRegistryValueForTests({ a: u8, b: { c: u8 } });
    expect(__registryValueContainsBytesForTests(root)).toBe(true);
    expect(__registryValueContainsBytesForTests(root.b)).toBe(true);
    expect(__registryValueContainsBytesForTests(root.b.c)).toBe(true);
    const plain = __deepFreezeRegistryValueForTests({ a: { b: [1, "x"] }, c: null });
    expect(__registryValueContainsBytesForTests(plain)).toBe(false);
    expect(__registryValueContainsBytesForTests(plain.a)).toBe(false);
  });

  test("a module member's Bytes stay copy-on-read through the member path", () => {
    const shared = new Uint8Array([6, 7]);
    const instance: Instance = {
      typeName: "Exemplifiable",
      args: ["MemberBytes"],
      methods: { examples: [shared] },
      declaration: {
        name: "memberBytes",
        type: { name: "Exemplifiable", args: ["MemberBytes"] },
        value: { $tag: "Exemplifiable", examples: [shared], nested: { again: shared } },
      },
    } as unknown as Instance;
    const registry = createEngineBootstrapRegistry([{
      name: "member-bytes",
      label: "Member bytes",
      entities: [],
      functions: [],
      instances: [instance],
    }], { dispatchRegistry: createDispatchRegistry(), publishCatalogEntities: false });
    const read = (): Uint8Array | undefined => {
      const resolved = registry.resolveModuleMember("member-bytes", "memberBytes") as { kind: string; value?: { examples?: unknown[] } };
      return resolved.kind === "instance" ? resolved.value?.examples?.[0] as Uint8Array | undefined : undefined;
    };
    const first = read();
    expect(first).toBeInstanceOf(Uint8Array);
    first![0] = 99;
    expect(Array.from(read()!)).toEqual([6, 7]);
  });

  test("rejects arbitrary exotic prototypes in instance-method examples", () => {
    const exotic = Object.assign(Object.create({ inherited: true }), {
      value: "not transport data",
    });

    expect(() => createEngineBootstrapRegistry([
      moduleWith({
        typeName: "Exemplifiable",
        args: ["ExoticExample"],
        methods: { examples: [exotic] },
      }),
    ], { publishCatalogEntities: false })).toThrow(
      "non-plain transport object is not allowed",
    );
  });

  test("a module name accessor rejects without invocation", () => {
    let reads = 0;
    const mod = moduleWith({
      typeName: "Codeable",
      args: ["accessor-hostile:value"],
      methods: { codeName: "value" },
    });
    Object.defineProperty(mod, "name", {
      enumerable: true,
      get() {
        reads += 1;
        return "accessor-hostile";
      },
    });

    expect(() => createRegistry([mod])).toThrow(
      'accessor property "name" is not allowed',
    );
    expect(reads).toBe(0);
  });

  test("a module imports accessor rejects without invocation", () => {
    let reads = 0;
    const mod = moduleWith({
      typeName: "Codeable",
      args: ["accessor-hostile:value"],
      methods: { codeName: "value" },
    });
    Object.defineProperty(mod, "imports", {
      enumerable: true,
      get() {
        reads += 1;
        return [];
      },
    });

    expect(() => createRegistry([mod])).toThrow(
      'accessor property "imports" is not allowed',
    );
    expect(reads).toBe(0);
  });

  test("a nested import selector accessor rejects without invocation", () => {
    let reads = 0;
    const mod = moduleWith({
      typeName: "Codeable",
      args: ["accessor-hostile:value"],
      methods: { codeName: "value" },
    });
    const entry: Record<string, unknown> = { module: "safe" };
    Object.defineProperty(entry, "names", {
      enumerable: true,
      get() {
        reads += 1;
        return ["value"];
      },
    });
    mod.imports = [entry as NonNullable<FenelModule["imports"]>[number]];

    expect(() => createRegistry([mod])).toThrow(
      'accessor property "names" is not allowed',
    );
    expect(reads).toBe(0);
  });

  test("a cyclic nested import selector rejects deterministically", () => {
    const mod = moduleWith({
      typeName: "Codeable",
      args: ["accessor-hostile:value"],
      methods: { codeName: "value" },
    });
    const entry: Record<string, unknown> = { module: "safe" };
    entry.names = [entry];
    mod.imports = [entry as NonNullable<FenelModule["imports"]>[number]];

    expect(() => createRegistry([mod])).toThrow(
      "cyclic transport data is not allowed",
    );
  });

  test("a module entities accessor rejects without invocation", () => {
    let reads = 0;
    const mod = moduleWith({
      typeName: "Codeable",
      args: ["accessor-hostile:value"],
      methods: { codeName: "value" },
    });
    Object.defineProperty(mod, "entities", {
      enumerable: true,
      get() {
        reads += 1;
        return [];
      },
    });

    expect(() => createRegistry([mod])).toThrow(
      'accessor property "entities" is not allowed',
    );
    expect(reads).toBe(0);
  });

  test("a module instances accessor rejects without invocation", () => {
    let reads = 0;
    const mod = moduleWith({
      typeName: "Codeable",
      args: ["accessor-hostile:value"],
      methods: { codeName: "value" },
    });
    Object.defineProperty(mod, "instances", {
      enumerable: true,
      get() {
        reads += 1;
        return [];
      },
    });

    expect(() => createRegistry([mod])).toThrow(
      'accessor property "instances" is not allowed',
    );
    expect(reads).toBe(0);
  });

  test("an instance typeName accessor rejects without invocation", () => {
    let reads = 0;
    const instance = {
      args: ["accessor-hostile:value"],
      methods: { codeName: "value" },
    } as unknown as Instance;
    Object.defineProperty(instance, "typeName", {
      enumerable: true,
      get() {
        reads += 1;
        return "Codeable";
      },
    });

    expect(() => createRegistry([moduleWith(instance)])).toThrow(
      'accessor property "typeName" is not allowed',
    );
    expect(reads).toBe(0);
  });

  test("an instance args accessor rejects without invocation", () => {
    let reads = 0;
    const instance = {
      typeName: "Codeable",
      methods: { codeName: "value" },
    } as unknown as Instance;
    Object.defineProperty(instance, "args", {
      enumerable: true,
      get() {
        reads += 1;
        return ["accessor-hostile:value"];
      },
    });

    expect(() => createRegistry([moduleWith(instance)])).toThrow(
      'accessor property "args" is not allowed',
    );
    expect(reads).toBe(0);
  });

  test("sparse instance args reject instead of retargeting dispatch", () => {
    const args = new Array(2) as string[];
    args[1] = "accessor-hostile:victim";
    const instance: Instance = {
      typeName: "Codeable",
      args,
      methods: { codeName: "poison" },
    };

    expect(() => createRegistry([moduleWith(instance)])).toThrow(
      "sparse array slot 0 is not allowed",
    );
  });

  test("a methods-envelope accessor rejects without invocation", () => {
    let reads = 0;
    const instance = {
      typeName: "Codeable",
      args: ["accessor-hostile:value"],
    } as unknown as Instance;
    Object.defineProperty(instance, "methods", {
      enumerable: true,
      get() {
        reads += 1;
        return { codeName: "value" };
      },
    });

    expect(() => createRegistry([moduleWith(instance)])).toThrow(
      'accessor property "methods" is not allowed',
    );
    expect(reads).toBe(0);
  });

  test("a nested semantic-method accessor rejects without invocation", () => {
    let reads = 0;
    const methods: Record<string, unknown> = {};
    Object.defineProperty(methods, "codeName", {
      enumerable: true,
      get() {
        reads += 1;
        return "value";
      },
    });
    const instance: Instance = {
      typeName: "Codeable",
      args: ["accessor-hostile:value"],
      methods,
    };

    expect(() => createRegistry([moduleWith(instance)])).toThrow(
      'accessor property "codeName" is not allowed',
    );
    expect(reads).toBe(0);
  });

  test("a late registry rejection cannot publish a partial entity catalog", () => {
    const entityId = "Phase2AtomicityPoison_RegistryAccessorSafety";
    expect(__catalogHasRegisteredEntityForTests(entityId)).toBe(false);

    let reads = 0;
    const mod: FenelModule = {
      name: "catalog-atomicity-hostile",
      label: "Catalog atomicity hostile",
      entities: [{
        id: entityId,
        type: { $record: { fields: [] } },
      }],
      functions: [],
      instances: [],
    };
    Object.defineProperty(mod, "lateAccessor", {
      enumerable: true,
      get() {
        reads += 1;
        return "poison";
      },
    });

    expect(() => createRegistry([mod])).toThrow(
      'accessor property "lateAccessor" is not allowed',
    );
    expect(reads).toBe(0);
    expect(__catalogHasRegisteredEntityForTests(entityId)).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// Transport-clone construction shape.
//
// `cloneRegistryTransportValue` builds each array/record behind a NULL
// prototype, writes own data by ordinary assignment, then restores the final
// Array/Object prototype. That replaced one `Object.defineProperty` per
// element. These tests pin the properties that made the previous
// defineProperty construction safe, so a later "simplification" back to plain
// assignment on a prototype-carrying object is caught here rather than in a
// browser: an inherited setter must never observe or intercept a transport
// write, a `__proto__` own data key must stay own data, the final prototypes
// and the canonical sorted key order must survive, shared subgraphs must stay
// deduplicated, and cycles/accessors must still reject.
// ---------------------------------------------------------------------------
describe("registry transport clone construction", () => {
  function exampleModule(name: string, example: unknown): FenelModule {
    return moduleWith({
      typeName: "Exemplifiable",
      args: [name],
      methods: { examples: [example] },
    });
  }

  function publishedExamples(mod: FenelModule): unknown[] {
    const registry = createEngineBootstrapRegistry([mod], {
      publishCatalogEntities: false,
    });
    return registry.modules.find((published) => published.name === mod.name)!
      .instances![0]!.methods.examples as unknown[];
  }

  test("restores the canonical prototypes and canonical sorted own-key order", () => {
    const examples = publishedExamples(
      exampleModule("TransportShapeExample", { zeta: 1, alpha: [10, 20] }),
    );

    expect(Array.isArray(examples)).toBe(true);
    expect(Object.getPrototypeOf(examples)).toBe(Array.prototype);
    const record = examples[0] as Record<string, unknown>;
    expect(Object.getPrototypeOf(record)).toBe(Object.prototype);
    expect(Object.keys(record)).toEqual(["alpha", "zeta"]);
    const nested = record.alpha as unknown[];
    expect(Array.isArray(nested)).toBe(true);
    expect(Object.getPrototypeOf(nested)).toBe(Array.prototype);
    expect(nested).toEqual([10, 20]);
    expect(record.zeta).toBe(1);
  }, 180_000);

  test("an inherited record setter neither runs nor intercepts an own transport write", () => {
    const probeKey = "fenelTransportProbeKey";
    const sentinel = "fenel-transport-record-sentinel";
    let intercepted = 0;
    Object.defineProperty(Object.prototype, probeKey, {
      configurable: true,
      get() { return undefined; },
      set(value: unknown) {
        if (value === sentinel) intercepted += 1;
        Object.defineProperty(this as object, probeKey, {
          value, writable: true, enumerable: true, configurable: true,
        });
      },
    });
    let published: unknown[];
    try {
      published = publishedExamples(
        exampleModule("InheritedRecordSetterExample", { [probeKey]: sentinel }),
      );
    } finally {
      delete (Object.prototype as Record<string, unknown>)[probeKey];
    }

    expect(intercepted).toBe(0);
    const record = published[0] as Record<string, unknown>;
    expect(Object.hasOwn(record, probeKey)).toBe(true);
    expect(record[probeKey]).toBe(sentinel);
  }, 180_000);

  test("an inherited array-index setter neither runs nor intercepts an own transport write", () => {
    const sentinel = "fenel-transport-array-sentinel";
    let intercepted = 0;
    // Transparent poison: ordinary code keeps assignment semantics because the
    // setter installs the own data property itself. Only a write carrying this
    // test's sentinel is counted, and only the transport clone ever holds it.
    Object.defineProperty(Array.prototype, "0", {
      configurable: true,
      get() { return undefined; },
      set(value: unknown) {
        if (value === sentinel) intercepted += 1;
        Object.defineProperty(this as object, "0", {
          value, writable: true, enumerable: true, configurable: true,
        });
      },
    });
    let published: unknown[];
    try {
      published = publishedExamples(
        exampleModule("InheritedArraySetterExample", { slots: [sentinel, "tail"] }),
      );
    } finally {
      delete (Array.prototype as unknown as Record<string, unknown>)["0"];
    }

    expect(intercepted).toBe(0);
    const slots = (published[0] as { slots: unknown[] }).slots;
    expect(Object.hasOwn(slots, "0")).toBe(true);
    expect(slots).toEqual([sentinel, "tail"]);
  }, 180_000);

  test("a __proto__ own data key stays own data and never re-parents the clone", () => {
    const poisoned = { polluted: true };
    const source: Record<string, unknown> = { safe: 1 };
    Object.defineProperty(source, "__proto__", {
      value: poisoned, writable: true, enumerable: true, configurable: true,
    });

    const record = publishedExamples(
      exampleModule("ProtoDataKeyExample", source),
    )[0] as Record<string, unknown>;

    expect(Object.getPrototypeOf(record)).toBe(Object.prototype);
    const descriptor = Object.getOwnPropertyDescriptor(record, "__proto__");
    expect(descriptor).toBeDefined();
    expect("value" in descriptor!).toBe(true);
    expect(descriptor!.value).toEqual({ polluted: true });
    expect(descriptor!.value).not.toBe(poisoned);
    expect(({} as Record<string, unknown>).polluted).toBeUndefined();
    expect(record.safe).toBe(1);
  }, 180_000);

  test("keeps one clone per shared subgraph and drops non-enumerable own data", () => {
    const shared = { shared: true };
    const source: Record<string, unknown> = { first: shared, second: shared };
    Object.defineProperty(source, "hidden", {
      value: "not transport data", writable: true, enumerable: false, configurable: true,
    });

    const record = publishedExamples(
      exampleModule("SharedSubgraphExample", source),
    )[0] as Record<string, unknown>;

    expect(Object.keys(record)).toEqual(["first", "second"]);
    expect(record.first).toEqual({ shared: true });
    expect(record.first).toBe(record.second);
    expect(record.first).not.toBe(shared);
  }, 180_000);

  test("a cyclic transport array still rejects instead of publishing a partial clone", () => {
    const cyclic: unknown[] = ["head"];
    cyclic.push(cyclic);

    expect(() => createEngineBootstrapRegistry(
      [exampleModule("CyclicArrayExample", cyclic)],
      { publishCatalogEntities: false },
    )).toThrow("cyclic transport data is not allowed");
  }, 180_000);

  test("an accessor at an array index rejects without invocation", () => {
    let reads = 0;
    const hostile: unknown[] = [];
    Object.defineProperty(hostile, "0", {
      enumerable: true,
      configurable: true,
      get() { reads += 1; return "poison"; },
    });
    Object.defineProperty(hostile, "length", {
      value: 1, writable: true, enumerable: false, configurable: false,
    });

    expect(() => createEngineBootstrapRegistry(
      [exampleModule("AccessorArraySlotExample", hostile)],
      { publishCatalogEntities: false },
    )).toThrow('accessor property "0" is not allowed');
    expect(reads).toBe(0);
  }, 180_000);
});
