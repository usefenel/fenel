// perf 2026-10-31 (clone tax): `frozenRegistryCopy` replaces
// `deepFreezeRegistryValue(deepCloneRegistryValue(x))` on the routing-table and
// Bytes-egress paths. It must stay equal to the two-step form, keep every Bytes
// leaf fresh per caller, never reuse a copy of a graph that can still change,
// and (the point of the change) stop re-copying a frozen Bytes-free subgraph.
import { describe, expect, test } from "bun:test";
import { runInNewContext } from "node:vm";

import {
  __deepFreezeCloneRegistryValueForTests as twoStep,
  __deepFreezeRegistryValueForTests as deepFreeze,
  __frozenRegistryCopyForTests as frozenCopy,
  __registryValueContainsBytesForTests as containsBytes,
  createEngineBootstrapRegistry,
  __bootstrapFreezeForTests as freezeWalk,
} from "./registry";
import { createDispatchRegistry } from "./dispatch-registry";
import type { FenelModule, FieldDef, Instance } from "./types";

/** Structural comparison that also checks what toEqual ignores: prototypes
 * (null vs plain), array-ness, own key order, frozenness, Bytes contents,
 * and the graph's internal aliasing (a DAG/cycle stays a DAG/cycle). */
function sameShape(a: unknown, b: unknown, pairs = new Map<object, object>()): void {
  if (a === null || typeof a !== "object") {
    expect(Object.is(a, b)).toBe(true);
    return;
  }
  expect(b !== null && typeof b === "object").toBe(true);
  const seen = pairs.get(a);
  if (seen !== undefined) {
    expect(seen).toBe(b as object);
    return;
  }
  pairs.set(a, b as object);
  expect(Object.getPrototypeOf(b)).toBe(Object.getPrototypeOf(a));
  if (a instanceof Uint8Array) {
    expect(Array.from(b as Uint8Array)).toEqual(Array.from(a));
    return;
  }
  expect(Array.isArray(b)).toBe(Array.isArray(a));
  expect(Object.isFrozen(b)).toBe(Object.isFrozen(a));
  expect(Reflect.ownKeys(b as object)).toEqual(Reflect.ownKeys(a));
  for (const key of Reflect.ownKeys(a)) {
    if (key === "length") continue;
    const da = Object.getOwnPropertyDescriptor(a, key)!;
    const db = Object.getOwnPropertyDescriptor(b as object, key)!;
    expect([db.enumerable, db.writable, db.configurable]).toEqual([da.enumerable, da.writable, da.configurable]);
    sameShape(da.value, db.value, pairs);
  }
}

/** A plain graph above the freezer's record threshold (FREEZE_RECORD_MIN_NODES):
 * smaller frozen subgraphs are deliberately not memoized. */
function bulk(tag: string): { tag: string; items: Array<{ i: number; nested: { j: string } }> } {
  return { tag, items: Array.from({ length: 40 }, (_, i) => ({ i, nested: { j: `${tag}${i}` } })) };
}

function hostileGraph(): Record<string, unknown> {
  const shared = { s: [1, "two", null] };
  const nullProto = Object.assign(Object.create(null), { k: "v", inner: shared });
  const withHidden = { visible: 1 };
  Object.defineProperty(withHidden, "hidden", { value: 2, enumerable: false });
  Object.defineProperty(withHidden, "getter", { get: () => ({ fresh: true }), enumerable: true });
  // eslint-disable-next-line no-sparse-arrays
  const sparse = [1, , 3];
  const cyclic: Record<string, unknown> = { name: "cycle" };
  cyclic.self = cyclic;
  return {
    plain: { a: { b: { c: [1, 2, 3] } } },
    shared,
    again: { shared },
    nullProto,
    withHidden,
    sparse,
    date: new Date(0),
    map: new Map([["k", 1]]),
    cyclic,
    bytes: new Uint8Array([1, 2, 3]),
    deepBytes: { x: { y: new Uint8Array([4]) } },
  };
}

describe("frozenRegistryCopy", () => {
  test("is equal to the two-step copy on a first, a second and a copy-of-a-copy call", () => {
    const source = hostileGraph();
    const reference = twoStep(source);
    sameShape(reference, frozenCopy(source));
    // Second call over the same (still mutable) source.
    sameShape(reference, frozenCopy(source));
    // A frozen registry graph (the source of the reuse) and a copy of a copy.
    const frozenSource = deepFreeze(hostileGraph());
    const first = frozenCopy(frozenSource);
    sameShape(twoStep(frozenSource), first);
    sameShape(twoStep(frozenSource), frozenCopy(frozenSource));
    sameShape(twoStep(first), frozenCopy(first));
  });

  test("shares frozen Bytes-free subgraphs and keeps a fresh spine to every Bytes leaf", () => {
    const source = deepFreeze({
      free: { deep: { list: [1, 2, { x: "y" }], bulk: bulk("free") } },
      withBytes: { label: "b", bytes: new Uint8Array([7, 8]) },
    });
    const a = frozenCopy(source);
    const b = frozenCopy(source);
    // The reuse: a plain frozen Bytes-free subgraph is answered by itself.
    expect(a.free).toBe(source.free);
    expect(b.free).toBe(a.free);
    expect(Object.isFrozen(a.free.deep.list[2])).toBe(true);
    expect(containsBytes(a.free)).toBe(false);
    // The Bytes spine is fresh per call, and so is each Uint8Array.
    expect(b).not.toBe(a);
    expect(b.withBytes).not.toBe(a.withBytes);
    expect(b.withBytes.bytes).not.toBe(a.withBytes.bytes);
    a.withBytes.bytes[0] = 99;
    expect(Array.from(b.withBytes.bytes)).toEqual([7, 8]);
    expect(Array.from(source.withBytes.bytes)).toEqual([7, 8]);
    expect(Array.from(frozenCopy(source).withBytes.bytes)).toEqual([7, 8]);
  });

  test("a frozen but non-plain Bytes-free subgraph is copied afresh by every call; its recorded plain children are shared", () => {
    const hidden = { visible: [1, 2], bulk: bulk("hidden") };
    Object.defineProperty(hidden, "hidden", { value: "h", enumerable: false });
    const exotic = Object.assign(Object.create({ inherited: true }), { own: bulk("own") });
    const source = deepFreeze({ hidden, exotic, bytes: new Uint8Array([1]) });
    const a = frozenCopy(source);
    const b = frozenCopy(source);
    for (const key of ["hidden", "exotic"] as const) {
      expect(a[key]).not.toBe(source[key]);
      expect(b[key]).not.toBe(a[key]);
      expect(Object.getPrototypeOf(a[key])).toBe(Object.prototype);
      sameShape(twoStep(source)[key], a[key]);
    }
    expect(Object.keys(a.hidden)).toEqual(["visible", "bulk"]);
    // Recorded (32+ node) plain children are shared as they are; a small,
    // unrecorded one is copied (equal, frozen).
    expect(a.hidden.bulk).toBe(hidden.bulk);
    expect(a.hidden.visible).not.toBe(hidden.visible);
    sameShape(hidden.visible, a.hidden.visible);
    expect(a.exotic.own).toBe(source.exotic.own);
  });

  test("internal aliasing equals the two-step form on every call, through shared and copied graphs", () => {
    const aliasing = (make: () => { s: { n: unknown }; n: unknown }) => {
      const reference = twoStep(make());
      const expected = reference.s.n === reference.n;
      expect(expected).toBe(true);
      for (let call = 0; call < 3; call++) {
        const out = frozenCopy(make());
        expect(out.s.n === out.n).toBe(expected);
        // A copy of a copy (the routing table's egress) skips the aliasing walk.
        const again = frozenCopy(out);
        expect(again.s.n === again.n).toBe(expected);
      }
    };
    // A recorded NON-plain graph (a hidden slot) holding a small node that is
    // also reachable outside it (review probe2).
    const n1 = { small: [1, 2] };
    const nonPlain: Record<string, unknown> = { n: n1, bulk: bulk("np") };
    Object.defineProperty(nonPlain, "hidden", { value: 1, enumerable: false });
    deepFreeze(nonPlain);
    aliasing(() => ({ s: nonPlain as { n: unknown }, n: n1, bytes: new Uint8Array([1]) }));
    // The same with a small node that is itself copied (a hidden slot).
    const n3: Record<string, unknown> = { small: [5] };
    Object.defineProperty(n3, "hidden", { value: 1, enumerable: false });
    const nonPlain2: Record<string, unknown> = { n: n3, bulk: bulk("np2") };
    Object.defineProperty(nonPlain2, "hidden", { value: 1, enumerable: false });
    deepFreeze(nonPlain2);
    aliasing(() => ({ s: nonPlain2 as { n: unknown }, n: n3, bytes: new Uint8Array([4]) }));
    // A recorded PLAIN graph holding such a node, outer occurrence after or before it.
    const n2 = { small: [3, 4] };
    const plainGraph = deepFreeze({ n: n2, bulk: bulk("p") });
    aliasing(() => ({ s: plainGraph, n: n2, bytes: new Uint8Array([2]) }));
    aliasing(() => ({ n: n2, s: plainGraph, bytes: new Uint8Array([3]) }));
  });

  test("records only frozen subgraphs above the threshold, with exact verdicts through shared small nodes", () => {
    // A small node shared twice inside a large graph: the freezer does not
    // record it, so its second occurrence is answered by a bounded re-walk,
    // and the large graph still gets its PLAIN verdict.
    const smallShared = { k: 1 };
    const large = deepFreeze({ x: smallShared, y: { z: smallShared }, bulk: bulk("dag") });
    const a = frozenCopy({ large, bytes: new Uint8Array([1]) });
    expect(a.large).toBe(large);
    // The same through a small shared node that holds Bytes.
    const smallBytes = { b: new Uint8Array([2]) };
    const withBytes = deepFreeze({ x: smallBytes, y: { z: smallBytes }, bulk: bulk("dagb") });
    expect(containsBytes(withBytes)).toBe(true);
    expect(containsBytes(withBytes.y)).toBe(true);
    const copied = frozenCopy({ withBytes });
    expect(copied.withBytes).not.toBe(withBytes);
    expect(copied.withBytes.y.z).toBe(copied.withBytes.x);
    copied.withBytes.x.b[0] = 9;
    expect(Array.from(withBytes.x.b)).toEqual([2]);
    // A small frozen plain interior node is not recorded, so it is copied; a
    // shared graph that holds it (here the recorded root) is then copied too,
    // keeping its two occurrences one object as in the two-step form.
    const holder = deepFreeze({ small: { s: [1, 2] }, n: 1 });
    const read = frozenCopy({ holder, small: holder.small, bytes: new Uint8Array([3]) });
    expect(read.small).not.toBe(holder.small);
    expect(read.holder).not.toBe(holder);
    expect(read.holder.small).toBe(read.small);
    sameShape(twoStep({ holder, small: holder.small }).holder, read.holder);
  });

  test("never shares a caller-owned object: a frozen Proxy or a caller-frozen small row is copied", () => {
    let traps = 0;
    const target = Object.freeze({ q: 1, list: Object.freeze([1, 2]) });
    const proxy = new Proxy(target, {
      getOwnPropertyDescriptor(t, k) { traps++; return Reflect.getOwnPropertyDescriptor(t, k); },
    });
    const out = frozenCopy({ proxy, bytes: new Uint8Array([1]) });
    expect(out.proxy).not.toBe(proxy);
    sameShape(twoStep({ proxy }).proxy, out.proxy);
    const before = traps;
    void out.proxy.q;
    expect(traps).toBe(before);
    // A revocable Proxy: the copy stays readable after revocation.
    const { proxy: revocable, revoke } = Proxy.revocable(Object.freeze({ z: 1 }), {});
    const kept = frozenCopy({ revocable, bytes: new Uint8Array([2]) });
    revoke();
    expect(kept.revocable.z).toBe(1);
    // A caller's deep-frozen small row (the shape of a dispatch row's methods).
    const row = Object.freeze({ methods: Object.freeze({ label: "x", tags: Object.freeze(["a"]) }) });
    for (let call = 0; call < 2; call++) {
      const copied = frozenCopy({ row, bytes: new Uint8Array([3]) });
      expect(copied.row).not.toBe(row);
      expect(copied.row.methods).not.toBe(row.methods);
      sameShape(twoStep({ row }).row, copied.row);
    }
    // Nor as the root: a caller-frozen value is never shared, nor recorded.
    const rootRow = Object.freeze({ k: Object.freeze([1]) });
    expect(frozenCopy(rootRow)).not.toBe(rootRow);
    expect(frozenCopy({ rootRow, bytes: new Uint8Array([4]) }).rootRow).not.toBe(rootRow);
  });

  test("never reuses a copy of a graph that can still change", () => {
    // A mutable source: each call must see its current contents.
    const mutable = { inner: { x: 1 }, bytes: new Uint8Array([1]) };
    expect(frozenCopy(mutable).inner.x).toBe(1);
    mutable.inner.x = 2;
    expect(frozenCopy(mutable).inner.x).toBe(2);
    // A caller's shallow Object.freeze is not evidence: the child is mutable.
    const child = { y: 1 };
    const shallow = Object.freeze({ child });
    expect(frozenCopy(shallow).child.y).toBe(1);
    child.y = 2;
    expect(frozenCopy(shallow).child.y).toBe(2);
    // A frozen graph that contains Bytes is copied afresh every time.
    const withBytes = deepFreeze({ bytes: new Uint8Array([5]) });
    const first = frozenCopy(withBytes);
    withBytes.bytes[0] = 6;
    expect(Array.from(frozenCopy(withBytes).bytes)).toEqual([6]);
    expect(Array.from(first.bytes)).toEqual([5]);
  });
});

/** Exotic nodes the PLAIN verdict must refuse, each LARGE (its own 40+ node
 * bulk, so the freezer records it) and small (unrecorded, so never shared).
 * Each must be copied (normalized) exactly as the
 * two-step form does, never shared. */
const exoticKinds: Record<string, (payload: Record<string, unknown>) => object> = {
  accessor: (payload) => Object.defineProperty({ ...payload }, "g", { get: () => 1, enumerable: true }),
  symbol: (payload) => ({ ...payload, [Symbol("s")]: 1 }),
  map: (payload) => Object.assign(new Map([["k", 1]]), payload),
  date: (payload) => Object.assign(new Date(0), payload),
  arrayBuffer: (payload) => Object.assign(new ArrayBuffer(8), payload),
  dataView: (payload) => Object.assign(new DataView(new ArrayBuffer(8)), payload),
  foreignArray: (payload) => {
    const array = runInNewContext("[]") as unknown[];
    array.push(payload);
    return array;
  },
};

describe("frozenRegistryCopy never shares an exotic node", () => {
  for (const [kind, make] of Object.entries(exoticKinds)) {
    for (const size of ["large", "small"] as const) {
      test(`${kind} (${size})`, () => {
        const exotic = make(size === "large" ? { bulk: bulk(kind) } : { v: 1 });
        const source = deepFreeze({ exotic, bytes: new Uint8Array([1]) });
        const reference = twoStep(source);
        const copy = frozenCopy(source);
        expect(copy.exotic).not.toBe(exotic);
        sameShape(reference.exotic, copy.exotic);
        sameShape(reference.exotic, frozenCopy(source).exotic);
      });
    }
  }
});

function exemplifiable(target: string, examples: unknown[]): Instance {
  return { typeName: "Exemplifiable", args: [target], methods: { examples } };
}

function param(name: string): FieldDef {
  return { name, type: { $ref: "String" }, label: { $tag: "Nothing" }, ui: { $tag: "Nothing" }, meta: {} };
}

describe("registry routing-table snapshot", () => {
  test("copies only the Bytes spine per read; Bytes stay private to each reader", () => {
    const callerBytes = new Uint8Array([0, 127, 255]);
    const dispatchRegistry = createDispatchRegistry();
    const instances = [
      exemplifiable("BytesExample", [callerBytes]),
      exemplifiable("PlainExample", [{ deep: { list: ["a", "b"] } }, bulk("example")]),
    ];
    for (const instance of instances) {
      dispatchRegistry.addInstance({ ...instance, methods: { examples: [...(instance.methods.examples as unknown[])] } });
    }
    const mod: FenelModule = {
      name: "routing-bytes",
      label: "Routing bytes",
      entities: [],
      functions: [{ id: "routing-bytes:identity", params: [param("value")], returns: { $ref: "String" }, body: { var: "value" } }],
      instances,
    };
    const registry = createEngineBootstrapRegistry([mod], { dispatchRegistry, publishCatalogEntities: false });
    type Table = { routeIdx: object; instanceIdx: Record<string, Record<string, Array<{ methods: { examples: unknown[] } }>>> };
    const first = registry.routingTable() as unknown as Table;
    const second = registry.routingTable() as unknown as Table;
    const bytesOf = (table: Table) => table.instanceIdx.Exemplifiable!.BytesExample![0]!.methods.examples[0] as Uint8Array;
    const plainOf = (table: Table) => table.instanceIdx.Exemplifiable!.PlainExample![0]!;
    expect(bytesOf(first)).toBeInstanceOf(Uint8Array);
    // The table has a Bytes leaf, so each read gets its own root and Bytes.
    expect(second).not.toBe(first);
    expect(bytesOf(second)).not.toBe(bytesOf(first));
    // The Bytes-free remainder is equal and frozen; a large Bytes-free
    // subgraph (32+ nodes, so recorded by the freezer) is shared as it is.
    expect(second.routeIdx).toEqual(first.routeIdx);
    expect(Object.isFrozen(second.routeIdx)).toBe(true);
    expect(plainOf(second)).toBe(plainOf(first));
    expect(Object.isFrozen(plainOf(first))).toBe(true);
    sameShape(first, second);
    // Mutating one reader's Bytes reaches no other reader nor the registry.
    bytesOf(first)[0] = 42;
    expect(Array.from(bytesOf(second))).toEqual([0, 127, 255]);
    expect(Array.from(bytesOf(registry.routingTable() as unknown as Table))).toEqual([0, 127, 255]);
    callerBytes[1] = 1;
    expect(Array.from(bytesOf(registry.routingTable() as unknown as Table))).toEqual([0, 127, 255]);
    // A caller registers a deep-frozen row straight into the dispatch pool: the
    // published table holds copies, never the caller's objects.
    const callerExamples = Object.freeze([Object.freeze({ caller: Object.freeze(["frozen"]) })]);
    const callerMethods = Object.freeze({ examples: callerExamples });
    dispatchRegistry.addInstance(Object.freeze({ typeName: "Exemplifiable", args: Object.freeze(["CallerRow"]),
      methods: callerMethods }) as unknown as Instance);
    for (let read = 0; read < 2; read++) {
      const table = registry.routingTable() as unknown as Table;
      const entry = table.instanceIdx.Exemplifiable!.CallerRow![0]!;
      expect(entry.methods).not.toBe(callerMethods);
      expect(entry.methods.examples).not.toBe(callerExamples);
      expect(entry.methods.examples[0]).not.toBe(callerExamples[0]);
      expect(entry.methods.examples).toEqual(callerExamples as unknown as unknown[]);
    }
  }, 180_000);
});

/** Restore before assertions: pollution is confined to one synchronous host
 * copy, never Bun's test reporter or another asynchronous task. */
function withInheritedDescriptorSlot<T>(name: "value" | "get" | "set", value: unknown, run: () => T): T {
  const prior = Object.getOwnPropertyDescriptor(Object.prototype, name);
  Object.defineProperty(Object.prototype, name, Object.setPrototypeOf({ value, configurable: true, writable: true }, null));
  try { return run(); }
  finally {
    Reflect.deleteProperty(Object.prototype, name);
    if (prior) Object.defineProperty(Object.prototype, name, Object.setPrototypeOf(prior, null));
  }
}

describe("registry copying ignores inherited descriptor fields", () => {
  test("an inherited value never turns an accessor into a copied data slot", () => {
    let reads = 0;
    const source = Object.defineProperty({ own: 7 }, "accessor", { get: () => { reads++; return 999; }, enumerable: true });
    const result = withInheritedDescriptorSlot("value", 42, () => frozenCopy(source));
    expect(Object.keys(result)).toEqual(["own"]);
    expect(result.own).toBe(7);
    expect(reads).toBe(0);
    expect(Object.isFrozen(result)).toBe(true);
  });

  test("an accessor graph is never recorded plain through an inherited value", () => {
    let reads = 0;
    const accessor = Object.defineProperty({}, "answer", { get: () => { reads++; return 999; }, enumerable: true });
    // The second edge exercises the bounded revisit of a small unrecorded node.
    const graph = { first: accessor, second: accessor };
    withInheritedDescriptorSlot("value", 42, () => deepFreeze(graph));
    const result = frozenCopy(graph);
    expect(result).not.toBe(graph);
    expect(result.first).not.toBe(accessor);
    expect(result.second).toBe(result.first);
    expect(Object.keys(result.first)).toEqual([]);
    expect(reads).toBe(0);
  });

  test("an inherited Bytes value does not change a data-graph Bytes verdict", () => {
    const source = Object.defineProperty({}, "answer", { get: () => new Uint8Array([9]), enumerable: true });
    const hasBytes = withInheritedDescriptorSlot("value", new Uint8Array([42]), () => containsBytes(source));
    expect(hasBytes).toBe(false);
  });

  for (const name of ["get", "set"] as const) {
    test(`an inherited ${name} never participates in an own-data output descriptor`, () => {
      const source = { own: [1, { nested: 2 }] };
      let calls = 0;
      const results = withInheritedDescriptorSlot(name, () => { calls++; }, () => [frozenCopy(source), twoStep(source)]);
      for (const result of results) {
        expect(result).toEqual(source);
        expect(result).not.toBe(source);
        expect(result.own[1]).not.toBe(source.own[1]);
      }
      expect(calls).toBe(0);
    });
  }

  test("own prototype-spelled fields bypass inherited setters and retain their order", () => {
    const source = {};
    Object.defineProperty(source, "__proto__", { value: { own: 1 }, enumerable: true });
    Object.defineProperty(source, "constructor", { value: { own: 2 }, enumerable: true });
    Object.defineProperty(source, "toString", { value: { own: 3 }, enumerable: true });
    const result = frozenCopy(source);
    expect(Reflect.ownKeys(result)).toEqual(Reflect.ownKeys(source));
    expect(Object.getPrototypeOf(result)).toBe(Object.prototype);
    expect(Object.getOwnPropertyDescriptor(result, "__proto__")?.value).toEqual({ own: 1 });
    expect(Object.getOwnPropertyDescriptor(result, "constructor")?.value).toEqual({ own: 2 });
  });

  test("the own-data freeze agrees with the descriptor oracle at every copied node", () => {
    let reference: ReturnType<typeof hostileGraph>;
    let actual: ReturnType<typeof hostileGraph>;
    let listed = 0;
    try {
      freezeWalk.useDescriptorWalk(true);
      reference = frozenCopy(hostileGraph());
      freezeWalk.useDescriptorWalk(false);
      const before = freezeWalk.keysListedNodes();
      actual = frozenCopy(hostileGraph());
      listed = freezeWalk.keysListedNodes() - before;
    } finally { freezeWalk.useDescriptorWalk(false); }
    sameShape(reference!, actual!);
    expect(listed).toBeGreaterThan(0);
    const seen = new Set<object>();
    const compareCodes = (left: unknown, right: unknown): void => {
      if (left === null || typeof left !== "object" || seen.has(left)) return;
      seen.add(left);
      expect(freezeWalk.recordedCode(right as object)).toBe(freezeWalk.recordedCode(left));
      if (left instanceof Uint8Array) return;
      for (const key of Reflect.ownKeys(left)) {
        const descriptor = Object.getOwnPropertyDescriptor(left, key)!;
        if (Object.hasOwn(descriptor, "value")) compareCodes(descriptor.value, Object.getOwnPropertyDescriptor(right as object, key)!.value);
      }
    };
    compareCodes(reference!, actual!);
  });
});
