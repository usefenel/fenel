import { describe, expect, test } from "bun:test";
import type { EvaluateContext } from "@fenel/engine/expressions";
import { mergeBrowserEvaluateContext } from "./authoring-session-scope";

// perf 2026-10-30 (distro-copies item 1): the browser evaluator's authority
// copies. Listing calls egress row by row through the snapshot cache, and a
// deep-frozen source graph is copied once for every merged context.

type Row = { typeName: string; args: string[]; methods: Record<string, unknown> };

function deepFreeze<T>(value: T): T {
  if (value !== null && typeof value === "object" && !Object.isFrozen(value) && !(value instanceof Uint8Array)) {
    Object.freeze(value);
    for (const child of Object.values(value as object)) deepFreeze(child);
  }
  return value;
}

function pool(buckets: Map<string, Row[]>) {
  const deny = () => { throw new Error("source mutator reached"); };
  return {
    defineClass: deny, addInstance: deny, registerValue: deny, removeInstancesOwnedBy: deny, removeInstance: deny,
    getClass: () => undefined,
    satisfies: () => true,
    resolve: (_type: unknown, typeName: string) => buckets.get(typeName)?.[0],
    listMatchingInstances: (_type: unknown, typeName: string) => [...(buckets.get(typeName) ?? [])],
    listClasses: () => [],
    // The dispatch registry returns its live bucket for a class name and a
    // fresh flattened array otherwise (`dispatch-registry.ts` listInstances).
    listInstances: (typeName?: string) => typeName === undefined
      ? [...buckets.values()].flat()
      : buckets.get(typeName) ?? [],
    implementedBy: () => [],
    version: () => 1,
  } as unknown as NonNullable<EvaluateContext["_specRegistry"]>;
}

const merge = (context: EvaluateContext) => mergeBrowserEvaluateContext(context, {}, {});

function withInheritedDescriptorMember<T>(
  key: string,
  value: unknown,
  action: () => T,
): T {
  const prior = Object.getOwnPropertyDescriptor(Object.prototype, key);
  Object.defineProperty(Object.prototype, key, {
    __proto__: null,
    value,
    configurable: true,
    writable: true,
  } as PropertyDescriptor);
  try {
    return action();
  } finally {
    Reflect.deleteProperty(Object.prototype, key);
    if (prior !== undefined) Object.defineProperty(Object.prototype, key, prior);
  }
}

describe("browser evaluator own descriptor boundaries", () => {
  for (const member of ["get", "set"]) {
    test(`inherited descriptor ${member} cannot invalidate context or native data`, () => {
      const native = () => 7;
      const data = Object.assign(Object.create(null) as object, { nested: [new Uint8Array([4, 2])] });
      const context = withInheritedDescriptorMember(member, undefined, () => merge({
        _localData: data,
        natives: { fixture: native },
        nativesCtx: { fixture: native },
      } as EvaluateContext));
      const copied = context._localData as unknown as typeof data;
      expect(Object.getPrototypeOf(context)).toBeNull();
      expect(Object.getPrototypeOf(copied)).toBeNull();
      expect(Object.isFrozen(copied.nested)).toBe(true);
      expect(copied.nested[0]).not.toBe(data.nested[0]);
      expect([...copied.nested[0]]).toEqual([4, 2]);
      expect(context.natives!.fixture).toBe(native);
      expect(context.nativesCtx!.fixture).toBe(native);
      expect(Object.getPrototypeOf(context.natives)).toBeNull();
      expect(Object.isFrozen(context.natives)).toBe(true);
    });

    test(`inherited descriptor ${member} cannot invalidate listings or Bytes spines`, () => {
      const bytes = new Uint8Array([4, 2]);
      const stable = { label: "stable" };
      const row = { typeName: "Demo", args: ["String"], methods: { bytes, alias: bytes, stable } };
      let reads = 0;
      const routingTable = () => { reads++; return { stable, branch: { bytes, alias: bytes } }; };
      const source = {
        _specRegistry: pool(new Map([["Demo", [row as unknown as Row]]])),
        _routingTable: routingTable,
        _routingTableVersion: () => 1,
      } as EvaluateContext;
      const context = merge(source);
      const result = withInheritedDescriptorMember(member, undefined, () => ({
        listing: context._specRegistry!.listInstances(),
        first: context._routingTable!(),
        second: context._routingTable!(),
      }));
      const listed = result.listing[0] as unknown as typeof row;
      const first = result.first as ReturnType<typeof routingTable>;
      const second = result.second as typeof first;
      expect(Object.isFrozen(result.listing)).toBe(true);
      expect(listed.methods.bytes).toBe(listed.methods.alias);
      expect(listed.methods.bytes).not.toBe(bytes);
      expect([...listed.methods.bytes]).toEqual([4, 2]);
      expect(reads).toBe(1);
      expect(first.stable).toBe(second.stable);
      expect(first.branch.bytes).toBe(first.branch.alias);
      expect(first.branch.bytes).not.toBe(second.branch.bytes);
      first.branch.bytes[0] = 9;
      expect(second.branch.bytes[0]).toBe(4);
      expect(bytes[0]).toBe(4);
    });
  }

  for (const path of ["context", "getter", "static", "result", "listing"]) {
    test(`inherited descriptor value never admits a ${path} accessor`, () => {
      let getterReads = 0;
      const accessor = Object.defineProperty({}, "secret", {
        enumerable: true,
        get() { getterReads++; return "getter result"; },
      });
      let read: () => unknown;
      if (path === "context") {
        read = () => merge(accessor as EvaluateContext);
      } else if (path === "getter") {
        const source = Object.defineProperty({}, "getFunction", {
          enumerable: true,
          get() { getterReads++; return () => undefined; },
        });
        read = () => merge(source as EvaluateContext);
      } else if (path === "static") {
        read = () => merge({ _localData: accessor } as EvaluateContext);
      } else if (path === "result") {
        const context = merge({ getFunction: () => accessor } as unknown as EvaluateContext);
        read = () => context.getFunction!("fixture");
      } else {
        const row: Row = { typeName: "Demo", args: ["String"], methods: accessor };
        const context = merge({ _specRegistry: pool(new Map([["Demo", [row]]])) });
        read = () => context._specRegistry!.listInstances();
      }
      let failure: unknown;
      withInheritedDescriptorMember("value", "inherited poison", () => {
        try { read(); } catch (error) { failure = error; }
      });
      expect(failure).toBeInstanceOf(TypeError);
      expect(String(failure)).toContain("accessor property");
      expect(getterReads).toBe(0);
    });
  }
});

describe("browser evaluator authority copies", () => {
  test("listInstances keeps one frozen snapshot per source row across calls", () => {
    const row: Row = { typeName: "Demo", args: ["String"], methods: { run: "owner:run" } };
    const context = merge({ _specRegistry: pool(new Map([["Demo", [row]]])) });
    const first = context._specRegistry!.listInstances();
    const second = context._specRegistry!.listInstances();
    expect(first[0]).not.toBe(row);
    expect(second[0]).toBe(first[0]);
    expect(context._specRegistry!.listInstances("Demo")[0]).toBe(first[0]);
    expect(Object.isFrozen(first)).toBe(true);
    expect(Object.isFrozen(first[0])).toBe(true);
    expect(() => { (first[0] as unknown as Row).args[0] = "Poison"; }).toThrow();
    expect(() => { (first as unknown as Row[]).push(row); }).toThrow();
    expect(row.args[0]).toBe("String");
  });

  test("a listing reflects a live bucket that grew since the previous call", () => {
    const bucket: Row[] = [{ typeName: "Demo", args: ["A"], methods: {} }];
    const context = merge({ _specRegistry: pool(new Map([["Demo", bucket]])) });
    expect(context._specRegistry!.listInstances("Demo").map(row => row.args[0])).toEqual(["A"]);
    bucket.push({ typeName: "Demo", args: ["B"], methods: {} });
    expect(context._specRegistry!.listInstances("Demo").map(row => row.args[0])).toEqual(["A", "B"]);
  });

  test("one listing keeps the source's sharing between rows, as one copy did", () => {
    // The catalogue fingerprint digests listInstances() with its DAG sharing
    // (engine-body-memo back-references): per-row copies must not split it.
    const shared = { $ref: "String" };
    const rows: Row[] = [
      { typeName: "Demo", args: [shared as never], methods: {} },
      { typeName: "Other", args: [shared as never], methods: {} },
    ];
    const context = merge({ _specRegistry: pool(new Map([["Demo", [rows[0]!]], ["Other", [rows[1]!]]])) });
    const listed = context._specRegistry!.listInstances() as unknown as Row[];
    expect(listed[0]!.args[0]).toBe(listed[1]!.args[0]);
    expect(listed[0]!.args[0]).not.toBe(shared as never);
  });

  test("a refused listing leaves no partial copy behind", () => {
    const methods: Record<string, unknown> = { ok: { label: "kept" } };
    Object.defineProperty(methods, "bad", { get: () => "accessor", enumerable: true, configurable: true });
    const row: Row = { typeName: "Demo", args: ["String"], methods };
    const context = merge({ _specRegistry: pool(new Map([["Demo", [row]]])) });
    expect(() => context._specRegistry!.listInstances()).toThrow("accessor property");
    Object.defineProperty(methods, "bad", { value: "data", enumerable: true, configurable: true, writable: true });
    const listed = context._specRegistry!.listInstances()[0] as unknown as Row;
    expect(Object.isFrozen(listed.methods)).toBe(true);
    expect(listed.methods.bad).toBe("data");
  });

  test("a refused listing leaves no Bytes-free verdict for repaired source data", () => {
    const retained: Row = { typeName: "Stable", args: ["String"], methods: {} };
    const ok: { label: string; sample?: Uint8Array } = { label: "old" };
    const row = { typeName: "Demo", args: ["String"], methods: { ok } };
    Object.defineProperty(row.methods, "bad", {
      enumerable: true,
      configurable: true,
      get() { throw new Error("getter must not run"); },
    });
    const context = merge({ _specRegistry: pool(new Map([
      ["Stable", [retained]],
      ["Demo", [row as unknown as Row]],
    ])) });
    const stable = context._specRegistry!.listInstances("Stable")[0];
    expect(() => context._specRegistry!.listInstances()).toThrow("accessor property");
    Reflect.deleteProperty(row.methods, "bad");
    ok.sample = new Uint8Array([4, 2]);
    const first = context._specRegistry!.listInstances("Demo")[0] as unknown as typeof row;
    first.methods.ok.sample![0] = 9;
    const second = context._specRegistry!.listInstances("Demo")[0] as unknown as typeof row;
    expect(second).not.toBe(first);
    expect(second.methods.ok.sample).not.toBe(first.methods.ok.sample);
    expect(second.methods.ok.sample![0]).toBe(4);
    expect(ok.sample[0]).toBe(4);
    expect(context._specRegistry!.listInstances("Stable")[0]).toBe(stable);
  });

  test("a Bytes-bearing row is copied afresh for every read", () => {
    const row = { typeName: "Demo", args: ["String"], methods: { sample: new Uint8Array([4, 2]) } };
    const context = merge({ _specRegistry: pool(new Map([["Demo", [row as unknown as Row]]])) });
    const first = context._specRegistry!.listInstances()[0] as unknown as typeof row;
    first.methods.sample[0] = 9;
    const second = context._specRegistry!.listInstances()[0] as unknown as typeof row;
    expect(second).not.toBe(first);
    expect(second.methods.sample[0]).toBe(4);
    expect(row.methods.sample[0]).toBe(4);
  });

  test("a deep-frozen routing table is copied once for every merged context", () => {
    const table = deepFreeze({
      $tag: "RoutingTable",
      routes: [{ name: "run", resolution: { $tag: "RDirect" } }],
      routeIdx: { run: { $tag: "RDirect" } },
    });
    let reads = 0;
    const source = { _routingTable: () => { reads++; return table; } } as EvaluateContext;
    const first = merge(source)._routingTable!() as typeof table;
    const second = merge(source)._routingTable!() as typeof table;
    expect(reads).toBe(2);
    expect(first).not.toBe(table);
    expect(second).toBe(first);
    expect(Object.isFrozen(first.routeIdx)).toBe(true);
    expect(() => { (first.routeIdx as Record<string, unknown>).poison = { $tag: "RDirect" }; }).toThrow();
    expect(() => { (first.routes as unknown[]).push({}); }).toThrow();
  });

  test("a routing table with any unfrozen node is never shared across contexts", () => {
    const routes = [{ name: "run", resolution: { $tag: "RDirect" } }];
    // Shallowly frozen root over an unfrozen child: not evidence of immutability.
    const table = Object.freeze({ $tag: "RoutingTable", routes, routeIdx: Object.freeze({}) });
    const source = { _routingTable: () => table } as EvaluateContext;
    const firstContext = merge(source);
    const first = firstContext._routingTable!() as typeof table;
    expect(firstContext._routingTable!()).toBe(first);
    routes.push({ name: "late", resolution: { $tag: "RDirect" } });
    const second = merge(source)._routingTable!() as typeof table;
    expect(second).not.toBe(first);
    expect(second.routes.map(route => route.name)).toEqual(["run", "late"]);
    expect(first.routes.map(route => route.name)).toEqual(["run"]);
  });

  test("a versioned Bytes-bearing routing table is read once per version and shares its Bytes-free nodes", () => {
    let version = 1;
    let reads = 0;
    // Like the registry: a fresh deep-frozen copy per read, with a Bytes leaf
    // (Exemplifiable samples) that JavaScript cannot freeze.
    const publish = () => {
      reads++;
      return deepFreeze({
        $tag: "RoutingTable",
        routeIdx: { run: { $tag: "RDirect" }, version: String(version) },
        instanceIdx: { Exemplifiable: { Bytes: [{ methods: { examples: [new Uint8Array([4, 2])] } }] } },
      });
    };
    const source = { _routingTable: publish, _routingTableVersion: () => version } as EvaluateContext;
    const first = merge(source)._routingTable!() as ReturnType<typeof publish>;
    const second = merge(source)._routingTable!() as ReturnType<typeof publish>;
    expect(reads).toBe(1);
    expect(second.routeIdx).toBe(first.routeIdx);
    expect(second).not.toBe(first);
    expect(Object.isFrozen(first)).toBe(true);
    expect(Object.isFrozen(first.instanceIdx.Exemplifiable.Bytes[0]!.methods.examples)).toBe(true);
    expect(() => { (first.routeIdx as Record<string, unknown>).poison = { $tag: "RDirect" }; }).toThrow();
    const bytes = first.instanceIdx.Exemplifiable.Bytes[0]!.methods.examples[0]!;
    bytes[0] = 9;
    expect(second.instanceIdx.Exemplifiable.Bytes[0]!.methods.examples[0]![0]).toBe(4);
    expect((merge(source)._routingTable!() as typeof first).instanceIdx.Exemplifiable.Bytes[0]!.methods.examples[0]![0]).toBe(4);
    version = 2;
    const third = merge(source)._routingTable!() as typeof first;
    expect(reads).toBe(2);
    expect(third.routeIdx.version).toBe("2");
  });
});
