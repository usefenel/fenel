import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { createVersionedRoutingTableReader, isVersionedRoutingTableCopy } from "../../src/routing-copy";
import { deleteEngineModuleNamespace, registerCompletedEngineModule } from "../../src/engine-module-state";
import { mergeBrowserEvaluateContext } from "../../../../../distros/narthex/solid/src/lib/expression-runner/authoring-session-scope";
import type { EvaluateContext } from "../../src/json-logic";

type Reader = ReturnType<typeof createVersionedRoutingTableReader>;

function originalReader(): Reader {
  // Exact pre-edit production copier/cache, retained as the normal-realm
  // differential oracle. It has no registry-proof or monkey-patching claims.
  const source = readFileSync(new URL("./routing-copy-owner-before.txt", import.meta.url), "utf8");
  const js = new Bun.Transpiler({ loader: "ts" }).transformSync(source);
  return new Function(`${js}\nreturn versionedRoutingTableRead;`)() as Reader;
}

function compareGraphs(left: unknown, right: unknown): void {
  const forward = new Map<object, object>();
  const backward = new Map<object, object>();
  const visit = (a: unknown, b: unknown): void => {
    if (a === null || typeof a !== "object") { expect(Object.is(a, b)).toBe(true); return; }
    expect(b !== null && typeof b === "object").toBe(true);
    const target = b as object;
    if (forward.has(a)) { expect(forward.get(a)).toBe(target); return; }
    expect(backward.has(target)).toBe(false);
    forward.set(a, target); backward.set(target, a);
    expect(Object.getPrototypeOf(a)).toBe(Object.getPrototypeOf(target));
    expect(Object.isFrozen(a)).toBe(Object.isFrozen(target));
    expect(Reflect.ownKeys(a)).toEqual(Reflect.ownKeys(target));
    if (a instanceof Uint8Array) {
      expect(target instanceof Uint8Array).toBe(true);
      expect(Array.from(a)).toEqual(Array.from(target as Uint8Array));
    }
    for (const key of Reflect.ownKeys(a)) {
      const first = Object.getOwnPropertyDescriptor(a, key)!;
      const second = Object.getOwnPropertyDescriptor(target, key)!;
      expect(first.enumerable).toBe(second.enumerable);
      expect(first.configurable).toBe(second.configurable);
      expect(first.writable).toBe(second.writable);
      expect(Object.hasOwn(first, "value")).toBe(Object.hasOwn(second, "value"));
      visit(first.value, second.value);
    }
  };
  visit(left, right);
}

// These controls source-execute the exact private producer bookkeeping. They
// establish its state/triple rules, not actual registry integration or replay
// admission; that control runs separately after identity-artifact generation.
const registrySource = readFileSync(new URL("../../src/registry.ts", import.meta.url), "utf8");
const producerSource = registrySource.slice(registrySource.indexOf("type RoutingTableProducerProof ="),
  registrySource.indexOf("// A2/B3: producer-owned provenance for the declaration-only"));
const producerJs = new Bun.Transpiler({ loader: "ts" }).transformSync(
  producerSource.replace("export function isCompletedRegistryRoutingTableProducer", "function isCompletedRegistryRoutingTableProducer"));
const producer = new Function(`${producerJs}\nreturn { state: routingTableProducerProof(), isCompletedRegistryRoutingTableProducer };`)() as {
  state: { complete(getter: object, version: object): void; published(getter: object, root: object): void };
  isCompletedRegistryRoutingTableProducer(getter: unknown, version: unknown, root: unknown): boolean;
};
const installProducer = () => registerCompletedEngineModule("registry", {
  isCompletedRegistryRoutingTableProducer: producer.isCompletedRegistryRoutingTableProducer,
});
installProducer();

// Exact namespace helper emitted in the native baseline's Vite worker bundle
// field-identity-worker-BEgm9QAw.js. Its real registry export map uses accessor
// exports such as `isRegistryRoutingTableSnapshot:()=>V8`. Reuse that emitted
// infrastructure protocol here without importing a browser bundle or claiming
// that these source-extracted producer fixtures are a real registry namespace.
const viteNamespaceHelper = readFileSync(new URL("./routing-copy-vite-namespace-helper.txt", import.meta.url), "utf8").trim();
const viteNamespace = new Function("exports", `var te=Object.defineProperty,${viteNamespaceHelper};return b(exports);`) as
  (exports: Record<string, () => unknown>) => Record<PropertyKey, unknown>;

function knownProducer(initial: object) {
  let root = initial;
  let stamp = 1;
  const getter = () => root;
  const version = () => stamp;
  producer.state.complete(getter, version);
  producer.state.published(getter, root);
  return { getter, version, change(next: object) { root = next; stamp++; producer.state.published(getter, root); } };
}

describe("versioned routing-copy owner: exact original normal-realm differential", () => {
  test("complete graph/descriptor/key/prototype bijection, sparse slots, aliases, cycles and Bytes", () => {
    const symbol = Symbol("scalar");
    const fn = () => 1;
    const sparse = new Array(5);
    sparse[2] = { symbol, fn };
    Object.defineProperty(sparse, "hidden", { value: 4 });
    const ordinary = { sparse, bytes: new Uint8Array([1, 4]), stable: { value: 2 } } as Record<string, unknown>;
    Object.defineProperty(ordinary, "__proto__", { value: { own: true }, enumerable: true });
    Object.defineProperty(ordinary, "hidden", { value: 8 });
    const root = Object.assign(Object.create(null), { ordinary, again: ordinary, sparse });
    root.cycle = root;
    ordinary.root = root;
    const oracle = originalReader();
    const owner = createVersionedRoutingTableReader();
    const getter = () => root;
    const version = () => 1;
    const first = owner(getter, version) as typeof root;
    const second = owner(getter, version) as typeof root;
    compareGraphs(oracle(getter, version), first);
    compareGraphs(oracle(getter, version), second);
    expect(first).not.toBe(root);
    expect(first).not.toBe(second);
    expect(first.cycle).toBe(first);
    expect(first.again).toBe(first.ordinary);
    expect(first.ordinary.stable).toBe(second.ordinary.stable);
    expect(first.ordinary.bytes).not.toBe(second.ordinary.bytes);
    first.ordinary.bytes[0] = 99;
    expect(second.ordinary.bytes[0]).toBe(1);
    expect((ordinary.bytes as Uint8Array)[0]).toBe(1);
  });

  for (const rejected of ["accessor", "hidden accessor", "symbol", "exotic"] as const) {
    test(`same ${rejected} refusal and foreign-input Proxy observation order`, () => {
      const run = (reader: Reader) => {
        const events: string[] = [];
        const source: Record<PropertyKey, unknown> = { first: { x: 1 } };
        if (rejected === "accessor" || rejected === "hidden accessor") Object.defineProperty(source, "bad", {
          enumerable: rejected === "accessor", get() { events.push("GETTER"); return 2; },
        });
        if (rejected === "symbol") source[Symbol("bad")] = 2;
        if (rejected === "exotic") Object.setPrototypeOf(source, { inherited: 3 });
        const proxy = new Proxy(source, {
          getPrototypeOf(target) { events.push("prototype"); return Reflect.getPrototypeOf(target); },
          ownKeys(target) { events.push("keys"); return Reflect.ownKeys(target); },
          getOwnPropertyDescriptor(target, key) { events.push(`descriptor:${String(key)}`); return Reflect.getOwnPropertyDescriptor(target, key); },
          get(target, key, receiver) { events.push(`get:${String(key)}`); return Reflect.get(target, key, receiver); },
        });
        let error: unknown;
        try { reader(() => { events.push("source"); return proxy; }, () => { events.push("version"); return 1; }); }
        catch (caught) { error = caught; }
        expect(error instanceof TypeError).toBe(true);
        return { events, message: (error as Error).message };
      };
      expect(run(createVersionedRoutingTableReader())).toEqual(run(originalReader()));
    });
  }

  test("ordinary array length Proxy read and exotic Bytes iterator callbacks remain observable", () => {
    const run = (reader: Reader) => {
      const events: string[] = [];
      const bytes = Object.create(Uint8Array.prototype);
      Object.defineProperty(bytes, Symbol.iterator, { get() {
        events.push("bytes:iterator");
        return function* () { events.push("bytes:start"); yield 3; events.push("bytes:end"); };
      } });
      const source = new Proxy([bytes, , bytes], {
        getPrototypeOf(target) { events.push("prototype"); return Reflect.getPrototypeOf(target); },
        ownKeys(target) { events.push("keys"); return Reflect.ownKeys(target); },
        getOwnPropertyDescriptor(target, key) { events.push(`descriptor:${String(key)}`); return Reflect.getOwnPropertyDescriptor(target, key); },
        get(target, key, receiver) { events.push(`get:${String(key)}`); return Reflect.get(target, key, receiver); },
      });
      const output = reader(() => source, () => 1);
      return { events, output };
    };
    const expected = run(originalReader());
    const actual = run(createVersionedRoutingTableReader());
    expect(actual.events).toEqual(expected.events);
    compareGraphs(actual.output, expected.output);
    expect(actual.events).toContain("get:length");
    expect(actual.events).toContain("bytes:iterator");
  });

  test("version/source order, primitive reads, Object.is versions, and failed-copy retry", () => {
    const run = (reader: Reader) => {
      const events: string[] = [];
      let stamp = NaN;
      let value: unknown = { ok: 1 };
      const get = () => { events.push("source"); return value; };
      const version = () => { events.push("version"); return stamp; };
      const a = reader(get, version); const b = reader(get, version);
      stamp = -0; reader(get, version);
      stamp = +0; reader(get, version);
      stamp = 2;
      value = Object.defineProperty({}, "bad", { enumerable: true, get() { throw new Error("must not run"); } });
      let failed = false;
      try { reader(get, version); } catch { failed = true; }
      value = { repaired: true };
      reader(get, version);
      stamp = 3; value = 17; reader(get, version); reader(get, version);
      return { events, reused: a === b, failed };
    };
    expect(run(createVersionedRoutingTableReader())).toEqual(run(originalReader()));
  });
});

describe("source-extracted producer bookkeeping and actual copy owner (not registry integration)", () => {
  test("only exact completed getter/version/published-root triples qualify new bases", () => {
    const a = knownProducer({ stable: {} });
    const b = knownProducer({ other: {} });
    const qualified = createVersionedRoutingTableReader()(a.getter, a.version);
    expect(isVersionedRoutingTableCopy(qualified)).toBe(true);
    expect(isVersionedRoutingTableCopy(a.getter())).toBe(false);
    expect(isVersionedRoutingTableCopy(new Proxy(qualified as object, {}))).toBe(false);
    expect(isVersionedRoutingTableCopy(Object.freeze({ stable: {} }))).toBe(false);
    for (const [get, version] of [
      [new Proxy(a.getter, {}), a.version],
      [a.getter, new Proxy(a.version, {})],
      [a.getter, b.version],
      [() => a.getter(), a.version],
    ] as const) expect(isVersionedRoutingTableCopy(createVersionedRoutingTableReader()(get, version))).toBe(false);
    const unpublished = () => ({ unpublished: true });
    producer.state.complete(unpublished, a.version);
    expect(isVersionedRoutingTableCopy(createVersionedRoutingTableReader()(unpublished, a.version))).toBe(false);
  });

  test("getter-only hit sharing retains proof and cannot upgrade a custom-first base", () => {
    const a = knownProducer({ stable: {} });
    const customVersion = () => a.version();
    const qualifiedFirst = createVersionedRoutingTableReader();
    const first = qualifiedFirst(a.getter, a.version);
    expect(qualifiedFirst(a.getter, customVersion)).toBe(first);
    expect(isVersionedRoutingTableCopy(first)).toBe(true);
    const customFirst = createVersionedRoutingTableReader();
    const custom = customFirst(a.getter, customVersion);
    expect(customFirst(a.getter, a.version)).toBe(custom);
    expect(isVersionedRoutingTableCopy(custom)).toBe(false);
    a.change({ next: {} });
    expect(isVersionedRoutingTableCopy(customFirst(a.getter, a.version))).toBe(true);
  });

  test("namespace readiness is retried on misses without upgrading existing bases", () => {
    const a = knownProducer({ stable: {} });
    const owner = createVersionedRoutingTableReader();
    deleteEngineModuleNamespace("registry");
    let early: unknown;
    try { early = owner(a.getter, a.version); }
    finally { installProducer(); }
    expect(isVersionedRoutingTableCopy(early)).toBe(false);
    expect(owner(a.getter, a.version)).toBe(early);
    expect(isVersionedRoutingTableCopy(early)).toBe(false);
    a.change({ next: {} });
    expect(isVersionedRoutingTableCopy(owner(a.getter, a.version))).toBe(true);
  });

  test("Vite own accessor exports preserve namespace receivers under replaced Reflect operations", () => {
    const a = knownProducer({ stable: { value: 4 } });
    const owner = createVersionedRoutingTableReader();
    let getterReceiver: unknown;
    let verifierReceiver: unknown;
    let exportReads = 0;
    const namespace = viteNamespace({
      isCompletedRegistryRoutingTableProducer: function (this: unknown) {
        getterReceiver = this;
        exportReads++;
        return function (this: unknown, get: unknown, version: unknown, root: unknown) {
          verifierReceiver = this;
          return producer.isCompletedRegistryRoutingTableProducer(get, version, root);
        };
      },
    });
    const descriptor = Object.getOwnPropertyDescriptor(namespace, "isCompletedRegistryRoutingTableProducer")!;
    expect(Object.hasOwn(descriptor, "value")).toBe(false);
    expect(typeof descriptor.get).toBe("function");
    expect(descriptor.configurable).toBe(false);
    const reflectGet = Reflect.get;
    const reflectApply = Reflect.apply;
    let interceptions = 0;
    const poison = () => { interceptions++; throw new Error("replaced Reflect operation reached"); };
    let output: unknown;
    try {
      registerCompletedEngineModule("registry", namespace);
      Reflect.get = Reflect.apply = poison;
      output = owner(a.getter, a.version);
    } finally {
      Reflect.get = reflectGet;
      Reflect.apply = reflectApply;
      installProducer();
    }
    expect(isVersionedRoutingTableCopy(output)).toBe(true);
    expect(getterReceiver === namespace).toBe(true);
    expect(verifierReceiver === namespace).toBe(true);
    expect(exportReads).toBe(1);
    expect(interceptions).toBe(0);
    expect(owner(a.getter, a.version)).toBe(output);
    expect(exportReads).toBe(1);
  });

  test("namespace export admission requires an own callable with an exact true proof", () => {
    let inheritedReads = 0;
    const inherited = Object.create(viteNamespace({ isCompletedRegistryRoutingTableProducer: () => {
      inheritedReads++;
      return () => true;
    } }));
    const cases = [
      { namespace: { isCompletedRegistryRoutingTableProducer: producer.isCompletedRegistryRoutingTableProducer }, qualified: true },
      { namespace: {}, qualified: false },
      { namespace: inherited, qualified: false },
      { namespace: viteNamespace({ isCompletedRegistryRoutingTableProducer: () => { throw new Error("export getter failed"); } }), qualified: false },
      { namespace: viteNamespace({ isCompletedRegistryRoutingTableProducer: () => 17 }), qualified: false },
      { namespace: viteNamespace({ isCompletedRegistryRoutingTableProducer: () => () => false }), qualified: false },
      { namespace: viteNamespace({ isCompletedRegistryRoutingTableProducer: () => () => 1 }), qualified: false },
    ];
    for (const { namespace, qualified } of cases) {
      const a = knownProducer({ stable: { value: 4 } });
      const owner = createVersionedRoutingTableReader();
      let output: unknown;
      try {
        registerCompletedEngineModule("registry", namespace);
        output = owner(a.getter, a.version);
      } finally { installProducer(); }
      compareGraphs(output, originalReader()(a.getter, a.version));
      expect(isVersionedRoutingTableCopy(output)).toBe(qualified);
      expect(owner(a.getter, a.version)).toBe(output);
      expect(isVersionedRoutingTableCopy(output)).toBe(qualified);
    }
    expect(inheritedReads).toBe(0);
  });

  test("proof exceptions leave successful copies unbranded and never upgrade a retained base", () => {
    const revoked = Proxy.revocable({}, {});
    revoked.revoke();
    const inaccessible = new Proxy({}, { getOwnPropertyDescriptor() { throw new Error("unreadable proof"); } });
    const throwing = { isCompletedRegistryRoutingTableProducer() { throw new Error("proof failed"); } };
    for (const namespace of [throwing, inaccessible, revoked.proxy]) {
      const a = knownProducer({ stable: { value: 4 } });
      const owner = createVersionedRoutingTableReader();
      let first: unknown;
      try {
        registerCompletedEngineModule("registry", namespace);
        first = owner(a.getter, a.version);
      } finally { installProducer(); }
      compareGraphs(first, originalReader()(a.getter, a.version));
      expect(isVersionedRoutingTableCopy(first)).toBe(false);
      expect(owner(a.getter, a.version)).toBe(first);
      expect(isVersionedRoutingTableCopy(first)).toBe(false);
      a.change({ next: {} });
      expect(isVersionedRoutingTableCopy(owner(a.getter, a.version))).toBe(true);
    }
  });

  test("Bytes spines keep construction proof and independent mutable leaves", () => {
    const a = knownProducer({ stable: {}, branch: { bytes: new Uint8Array([4]) } });
    const owner = createVersionedRoutingTableReader();
    const first = owner(a.getter, a.version) as ReturnType<typeof a.getter> & { stable: object; branch: { bytes: Uint8Array } };
    const second = owner(a.getter, () => a.version()) as typeof first;
    expect(first).not.toBe(second);
    expect(first.stable).toBe(second.stable);
    expect(isVersionedRoutingTableCopy(first)).toBe(true);
    expect(isVersionedRoutingTableCopy(second)).toBe(true);
    first.branch.bytes[0] = 9;
    expect(second.branch.bytes[0]).toBe(4);
  });

  test("actual merger has distinct context wrappers and one shared module owner", () => {
    const a = knownProducer({ stable: {}, branch: { bytes: new Uint8Array([4]) } });
    const source = { _routingTable: a.getter, _routingTableVersion: a.version } as EvaluateContext;
    const first = mergeBrowserEvaluateContext(source, {}, {});
    const second = mergeBrowserEvaluateContext(source, {}, {});
    expect(first._routingTable).not.toBe(second._routingTable);
    const left = first._routingTable!() as { stable: object };
    const right = second._routingTable!() as typeof left;
    expect(left).not.toBe(right);
    expect(left.stable).toBe(right.stable);
    expect(isVersionedRoutingTableCopy(left)).toBe(true);
    expect(isVersionedRoutingTableCopy(right)).toBe(true);
  });

  test("captured internal operations cannot expose or replace owner/proof storage or allocations", () => {
    const a = knownProducer({ stable: {}, branch: { bytes: new Uint8Array([4]) } });
    const owner = createVersionedRoutingTableReader();
    const define = Object.defineProperty;
    const descriptor = Object.getOwnPropertyDescriptor;
    const restore: Array<readonly [object, PropertyKey, PropertyDescriptor]> = [];
    let interceptions = 0;
    const poison = () => { interceptions++; throw new Error("poisoned intrinsic reached"); };
    const replace = (target: object, key: PropertyKey) => {
      const prior = descriptor(target, key)!;
      restore.push([target, key, prior]);
      define(target, key, { ...prior, value: poison });
    };
    const targets: Array<readonly [object, PropertyKey]> = [
      ...["Object", "Array", "Uint8Array", "WeakMap", "WeakSet", "Map", "Set"].map(key => [globalThis, key] as const),
      ...["getPrototypeOf", "getOwnPropertyDescriptor", "getOwnPropertyDescriptors", "getOwnPropertySymbols", "hasOwn", "keys", "values", "entries", "create", "defineProperty", "freeze", "is"].map(key => [Object, key] as const),
      [Array, "isArray"], [Reflect, "apply"], [Reflect, "get"], [JSON, "stringify"], [Function.prototype, "call"],
      [Array.prototype, Symbol.iterator], [Array.prototype, "values"], [Array.prototype, "entries"], [Array.prototype, "keys"],
      ...["get", "set", "has", "delete"].map(key => [WeakMap.prototype, key] as const),
      ...["has", "add", "delete"].map(key => [WeakSet.prototype, key] as const),
      ...["get", "set", "has", "delete"].map(key => [Map.prototype, key] as const),
      ...["add", "has", "delete"].map(key => [Set.prototype, key] as const),
    ];
    const duringRoot = { during: true };
    let first: unknown;
    let second: unknown;
    let during: unknown;
    try {
      for (let index = 0; index < targets.length; index++) replace(targets[index]![0], targets[index]![1]);
      const addedWhilePoisoned = knownProducer(duringRoot);
      first = owner(a.getter, a.version);
      second = owner(a.getter, a.version);
      during = owner(addedWhilePoisoned.getter, addedWhilePoisoned.version);
    } finally {
      for (let index = restore.length - 1; index >= 0; index--) {
        const entry = restore[index]!;
        define(entry[0], entry[1], entry[2]);
      }
    }
    expect(interceptions).toBe(0);
    expect(isVersionedRoutingTableCopy(first)).toBe(true);
    expect(isVersionedRoutingTableCopy(second)).toBe(true);
    expect(isVersionedRoutingTableCopy(during)).toBe(true);
    compareGraphs(first, second);
    // Also exercise a later proof-state write after all poisoned operations
    // have been restored: no earlier method received its private receiver.
    const next = knownProducer({ next: true });
    expect(isVersionedRoutingTableCopy(owner(next.getter, next.version))).toBe(true);
  });
});
