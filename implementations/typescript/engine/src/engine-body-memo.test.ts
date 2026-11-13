// S1a — the engine-body memo's canonical encoder, own-data snapshot, and the
// store/miss rules of one memoized call (design/tcb-ledger.md, "content-keyed
// replay of engine-body applications"). No registry is built here; the
// dispatcher seam and the drift digest have their own files.
import "./engine-body-host-install";
import { afterEach, describe, expect, spyOn, test } from "bun:test";
import zlib from "node:zlib";
import crypto from "node:crypto";
import { decodeReplayValue, encodeReplayValue } from "./engine-body-value-transport";
import {
  __setEngineBodyMemoForTests,
  clearEngineBodyMemo,
  clearEngineBodyMemoPartition,
  __breakEngineBodyMemoKeyChecksForTests,
  __engineBodyMemoCopyWalksForTests,
  copyEngineBodyValue,
  digestEngineBodyData,
  exportEngineBodyMemoEntries,
  engineBodyMemoRecording,
  engineBodyMemoStats,
  engineBodyMemoSwitchedOn,
  memoizedEngineBodyCall,
  noteEngineBodyMemoHostRead,
  noteEngineBodyMemoLeaf,
  noteEngineBodyMemoTaint,
  REPOSITORY_PARTITION,
  activeEngineBodyMemoPartition,
  withRegistryBuildPartitionScope,
  sha256OfEncoding,
  snapshotEngineBodyArguments,
  withEngineBodyMemoPartition,
  type EngineBodyMemoHost,
} from "./engine-body-memo";

function keyOf(...args: unknown[]): string {
  const s = snapshotEngineBodyArguments(args);
  if (!s.ok) throw new Error(`refused: ${s.reason}`);
  return s.key;
}

function refusal(...args: unknown[]): string {
  const s = snapshotEngineBodyArguments(args);
  if (s.ok) throw new Error("expected a refusal");
  return s.reason;
}

describe("canonical encoder — refusals (D2)", () => {
  test("Proxy (including a revoked one) is refused without invoking a trap", () => {
    let trapped = 0;
    const p = new Proxy({ a: 1 }, { get: () => { trapped += 1; return 1; }, ownKeys: () => { trapped += 1; return []; } });
    expect(refusal(p)).toBe("proxy");
    const { proxy, revoke } = Proxy.revocable({}, {});
    revoke();
    expect(refusal(proxy)).toBe("proxy");
    expect(trapped).toBe(0);
  });

  test("accessors are refused without being called", () => {
    let called = 0;
    const o = Object.defineProperty({}, "x", { get: () => { called += 1; return 1; }, enumerable: true, configurable: true });
    expect(refusal(o)).toBe("accessor property");
    const a: unknown[] = [];
    Object.defineProperty(a, 0, { get: () => { called += 1; return 1; }, enumerable: true, configurable: true });
    expect(refusal(a)).toBe("accessor element");
    expect(called).toBe(0);
  });

  test("non-plain prototypes are refused", () => {
    class Box { v = 1; }
    expect(refusal(new Map())).toContain("non-plain prototype");
    expect(refusal(new Set())).toContain("non-plain prototype");
    expect(refusal(new Date(0))).toContain("non-plain prototype");
    expect(refusal(/x/)).toContain("non-plain prototype");
    expect(refusal(new Box())).toBe("non-plain prototype");
    expect(refusal(Object.create({ inherited: 1 }))).toContain("non-plain prototype");
  });

  test("rejected prototype diagnostics never read constructor or name getters", () => {
    let constructorReads = 0, nameReads = 0;
    const named = Object.defineProperty({}, "name", { get() { nameReads++; return "Rejected"; } });
    const constructorGetter = Object.defineProperty({}, "constructor", { get() { constructorReads++; return named; } });
    for (const prototype of [constructorGetter, { constructor: named }]) {
      const value = Object.create(prototype);
      const snapshot = snapshotEngineBodyArguments([value]);
      const copy = copyEngineBodyValue(value);
      const digest = digestEngineBodyData(value);
      expect(constructorReads).toBe(0);
      expect(nameReads).toBe(0);
      expect(snapshot).toEqual({ ok: false, reason: "non-plain prototype" });
      expect(copy).toEqual({ ok: false, reason: "non-plain prototype" });
      expect(digest).toBeUndefined();
    }
  });

  test("functions, symbols, closures and partials are refused", () => {
    expect(refusal(() => 1)).toBe("function value");
    expect(refusal(Symbol("s"))).toBe("symbol value");
    expect(refusal({ [Symbol("k")]: 1 })).toBe("symbol key");
    expect(refusal({ __fenelFn: true, params: [], body: 1, env: {} })).toBe("evaluator closure or partial");
    expect(refusal({ __fenelPartial: true, fn: "std:add", collected: [1], arity: 2 })).toBe("evaluator closure or partial");
  });

  test("sparse arrays and extra array keys are refused", () => {
    // eslint-disable-next-line no-sparse-arrays
    expect(refusal([1, , 3])).toBe("sparse array or extra keys");
    const extra = [1, 2] as unknown[] & { tag?: string };
    extra.tag = "x";
    expect(refusal(extra)).toBe("sparse array or extra keys");
  });

  test("a Buffer or an offset Bytes view is refused; a plain Uint8Array is admitted", () => {
    expect(refusal(Buffer.from([1, 2]))).toContain("non-plain prototype");
    const backing = new Uint8Array([1, 2, 3, 4]);
    expect(refusal(backing.subarray(1, 3))).toBe("bytes view over a foreign buffer");
    expect(snapshotEngineBodyArguments([new Uint8Array([1, 2])]).ok).toBe(true);
  });

  test("a host failure while reading (deep value) is a refusal, not a throw", () => {
    let deep: unknown = 0;
    for (let i = 0; i < 200_000; i++) deep = [deep];
    const s = snapshotEngineBodyArguments([deep]);
    expect(s.ok).toBe(false);
  });
});

describe("canonical encoder — distinct tags (D2)", () => {
  test("-0, 0, NaN, Infinity and their strings are all distinct", () => {
    const keys = [keyOf(0), keyOf(-0), keyOf(NaN), keyOf(Infinity), keyOf(-Infinity), keyOf("0"), keyOf("NaN")];
    expect(new Set(keys).size).toBe(keys.length);
  });

  test("numbers, strings, booleans, null and undefined are distinct", () => {
    const keys = [keyOf(1), keyOf("1"), keyOf(true), keyOf("true"), keyOf(null), keyOf(undefined), keyOf("null"), keyOf(1n)];
    expect(new Set(keys).size).toBe(keys.length);
  });

  test("undefined-present differs from absent", () => {
    expect(keyOf({ a: 1, b: undefined })).not.toBe(keyOf({ a: 1 }));
    expect(keyOf([undefined])).not.toBe(keyOf([]));
  });

  test("arrays differ from records, plain from null-prototype, Bytes from number lists", () => {
    expect(keyOf([1])).not.toBe(keyOf({ 0: 1 }));
    const bare = Object.assign(Object.create(null), { a: 1 });
    expect(keyOf(bare)).not.toBe(keyOf({ a: 1 }));
    expect(keyOf(new Uint8Array([1, 2]))).not.toBe(keyOf([1, 2]));
    expect(keyOf(new Uint8Array([1, 2]))).toBe(keyOf(new Uint8Array([1, 2])));
    expect(keyOf(new Uint8Array([1, 2]))).not.toBe(keyOf(new Uint8Array([1, 3])));
  });

  test("key order is part of the encoding", () => {
    expect(keyOf({ a: 1, b: 2 })).not.toBe(keyOf({ b: 2, a: 1 }));
    expect(keyOf({ a: 1, b: 2 })).toBe(keyOf({ a: 1, b: 2 }));
  });

  test("string boundaries cannot be confused", () => {
    expect(keyOf(["ab", "c"])).not.toBe(keyOf(["a", "bc"]));
    expect(keyOf({ "a:": "b" })).not.toBe(keyOf({ a: ":b" }));
  });

  test("property attributes are part of the encoding", () => {
    const hidden = Object.defineProperty({}, "x", { value: 1, enumerable: false, writable: true, configurable: true });
    const readOnly = Object.defineProperty({}, "x", { value: 1, enumerable: true, writable: false, configurable: true });
    const keys = [keyOf({ x: 1 }), keyOf(hidden), keyOf(readOnly)];
    expect(new Set(keys).size).toBe(3);
    const element: unknown[] = [];
    Object.defineProperty(element, 0, { value: 1, enumerable: true, writable: false, configurable: true });
    expect(keyOf(element)).not.toBe(keyOf([1]));
  });

  test("frozen-ness is part of the encoding (natives observe it)", () => {
    expect(keyOf(Object.freeze({ a: 1 }))).not.toBe(keyOf({ a: 1 }));
    expect(keyOf(Object.freeze([1]))).not.toBe(keyOf([1]));
    expect(keyOf(Object.seal({ a: 1 }))).not.toBe(keyOf(Object.freeze({ a: 1 })));
    expect(keyOf(Object.preventExtensions({ a: 1 }))).not.toBe(keyOf({ a: 1 }));
  });

  test("sharing is part of the encoding; cycles are encoded", () => {
    const shared = { v: 1 };
    expect(keyOf([shared, shared])).not.toBe(keyOf([{ v: 1 }, { v: 1 }]));
    const cyclic: Record<string, unknown> = { a: 1 };
    cyclic.self = cyclic;
    expect(snapshotEngineBodyArguments([cyclic]).ok).toBe(true);
  });
});

describe("own-data snapshot (D2) and per-hit copies (D5)", () => {
  test("record copies define own data without inherited setters or read-only fields", () => {
    const key = "__memoInheritedFieldForTests";
    const original = { [key]: 42 };
    const expected = snapshotEngineBodyArguments([original]);
    let reads = 0, writes = 0;
    const results: ReturnType<typeof snapshotEngineBodyArguments>[] = [];
    const previous = Object.getOwnPropertyDescriptor(Object.prototype, key);
    try {
      Object.defineProperty(Object.prototype, key, {
        configurable: true,
        get() { reads += 1; return 999; },
        set(_value: unknown) { writes += 1; },
      });
      results.push(snapshotEngineBodyArguments([original]));
      results.push(copyEngineBodyValue([original]));
      Object.defineProperty(Object.prototype, key, {
        value: 999, writable: false, configurable: true,
      });
      results.push(snapshotEngineBodyArguments([original]));
    } finally {
      Reflect.deleteProperty(Object.prototype, key);
      if (previous !== undefined) Object.defineProperty(Object.prototype, key, previous);
    }
    expect(reads).toBe(0);
    expect(writes).toBe(0);
    for (const result of results) {
      if (!result.ok) throw new Error(result.reason);
      const copied = (result.copy as Record<string, unknown>[])[0]!;
      expect(Object.getOwnPropertyDescriptor(copied, key)).toEqual(Object.getOwnPropertyDescriptor(original, key));
      const encoded = snapshotEngineBodyArguments(result.copy as unknown[]);
      expect(encoded.ok && encoded.key).toBe(expected.ok && expected.key);
    }
  });

  test("array copies define own indices without inherited numeric setters", () => {
    const original = [[], [1], [1, 2], [1, 2, 3], [1, 2, 3, 4], Object.freeze([1, 2, 3, 4, 5, 6])];
    const expected = snapshotEngineBodyArguments(original);
    const previous = Object.getOwnPropertyDescriptor(Array.prototype, "0");
    let reads = 0, writes = 0;
    let snapshot: ReturnType<typeof snapshotEngineBodyArguments>;
    let copied: ReturnType<typeof copyEngineBodyValue>;
    try {
      Object.defineProperty(Array.prototype, "0", {
        configurable: true,
        get() { reads += 1; return 999; },
        set(_value: unknown) { writes += 1; },
      });
      snapshot = snapshotEngineBodyArguments(original);
      copied = copyEngineBodyValue(original);
    } finally {
      Reflect.deleteProperty(Array.prototype, "0");
      if (previous !== undefined) Object.defineProperty(Array.prototype, "0", previous);
    }
    expect(reads).toBe(0);
    expect(writes).toBe(0);
    for (const result of [snapshot, copied]) {
      if (!result.ok) throw new Error(result.reason);
      expect(result.copy).toEqual(original);
      const encoded = snapshotEngineBodyArguments(result.copy as unknown[]);
      expect(encoded.ok && encoded.key).toBe(expected.ok && expected.key);
    }
  });

  test("copy descriptors ignore inherited get and set slots", () => {
    const original = [Object.freeze({ x: 42 }), Object.freeze([43])];
    const expected = snapshotEngineBodyArguments(original);
    for (const key of ["get", "set"] as const) {
      const previous = Object.getOwnPropertyDescriptor(Object.prototype, key);
      let snapshot: ReturnType<typeof snapshotEngineBodyArguments>;
      let copied: ReturnType<typeof copyEngineBodyValue>;
      try {
        Object.defineProperty(Object.prototype, key, {
          __proto__: null, value: () => 999, writable: true, configurable: true,
        } as PropertyDescriptor);
        snapshot = snapshotEngineBodyArguments(original);
        copied = copyEngineBodyValue(original);
      } finally {
        Reflect.deleteProperty(Object.prototype, key);
        if (previous !== undefined) Object.defineProperty(Object.prototype, key, previous);
      }
      for (const result of [snapshot, copied]) {
        if (!result.ok) throw new Error(result.reason);
        const encoded = snapshotEngineBodyArguments(result.copy as unknown[]);
        expect(encoded.ok && encoded.key).toBe(expected.ok && expected.key);
      }
    }
  });

  test("an inherited descriptor value cannot admit an accessor", () => {
    let reads = 0;
    const original = Object.defineProperty({}, "x", {
      get() { reads += 1; return 42; }, enumerable: true,
    });
    const previous = Object.getOwnPropertyDescriptor(Object.prototype, "value");
    let snapshot: ReturnType<typeof snapshotEngineBodyArguments>;
    let copied: ReturnType<typeof copyEngineBodyValue>;
    try {
      Object.defineProperty(Object.prototype, "value", {
        __proto__: null, value: 999, writable: true, configurable: true,
      } as PropertyDescriptor);
      snapshot = snapshotEngineBodyArguments([original]);
      copied = copyEngineBodyValue(original);
    } finally {
      Reflect.deleteProperty(Object.prototype, "value");
      if (previous !== undefined) Object.defineProperty(Object.prototype, "value", previous);
    }
    expect(reads).toBe(0);
    expect(snapshot).toEqual({ ok: false, reason: "accessor property" });
    expect(copied).toEqual({ ok: false, reason: "accessor property" });
  });

  test("the snapshot is independent of the caller's live objects", () => {
    const live = { list: [1, 2], rec: { x: "a" } };
    const s = snapshotEngineBodyArguments([live]);
    if (!s.ok) throw new Error(s.reason);
    live.list.push(3);
    live.rec.x = "changed";
    expect(s.copy).toEqual([{ list: [1, 2], rec: { x: "a" } }]);
  });

  test("the snapshot reproduces integrity state, sharing, cycles and null prototypes", () => {
    const shared = Object.freeze({ v: 1 });
    const bare = Object.assign(Object.create(null), { k: 2 });
    const sealed = Object.seal({ s: 3 });
    const cyclic: Record<string, unknown> = { a: 1 };
    cyclic.self = cyclic;
    const bytes = new Uint8Array([9, 8]);
    const s = snapshotEngineBodyArguments([Object.freeze([shared, shared]), bare, sealed, cyclic, bytes]);
    if (!s.ok) throw new Error(s.reason);
    const [pair, bareCopy, sealedCopy, cyclicCopy, bytesCopy] = s.copy as [
      readonly object[], object, object, Record<string, unknown>, Uint8Array,
    ];
    expect(Object.isFrozen(pair)).toBe(true);
    expect(Object.isFrozen(pair[0])).toBe(true);
    expect(pair[0]).toBe(pair[1]);
    expect(pair[0]).not.toBe(shared);
    expect(Object.getPrototypeOf(bareCopy)).toBe(null);
    expect(Object.isSealed(sealedCopy) && !Object.isFrozen(sealedCopy)).toBe(true);
    expect(cyclicCopy.self).toBe(cyclicCopy);
    expect(bytesCopy).not.toBe(bytes);
    expect(Object.isExtensible(sealedCopy)).toBe(false);
    expect([...bytesCopy]).toEqual([9, 8]);
    // Re-encoding the copy gives the original's key: the copy is faithful.
    const again = snapshotEngineBodyArguments(s.copy as unknown[]);
    expect(again.ok && again.key).toBe(s.key);
  });

  test("the snapshot reproduces every property descriptor", () => {
    const o = Object.defineProperty({ a: 1 }, "hidden", { value: [2], enumerable: false, writable: false, configurable: true });
    const partlyFrozenArray: unknown[] = [1, 2];
    Object.defineProperty(partlyFrozenArray, 1, { writable: false });
    const s = snapshotEngineBodyArguments([o, partlyFrozenArray, Object.freeze([Object.freeze({ z: 0 })])]);
    if (!s.ok) throw new Error(s.reason);
    const [oc, ac, fc] = s.copy as [object, unknown[], unknown[]];
    expect(Object.getOwnPropertyDescriptors(oc)).toEqual(Object.getOwnPropertyDescriptors(o));
    expect(Object.getOwnPropertyDescriptors(ac)).toEqual(Object.getOwnPropertyDescriptors(partlyFrozenArray));
    expect(Object.isFrozen(fc) && Object.isFrozen(fc[0])).toBe(true);
    expect(Array.isArray(ac)).toBe(true);
  });

  test("a __proto__ own key is copied as data, not as a prototype", () => {
    const o = JSON.parse('{"__proto__": {"x": 1}}');
    const s = snapshotEngineBodyArguments([o]);
    if (!s.ok) throw new Error(s.reason);
    const copy = (s.copy as unknown[])[0] as object;
    expect(Object.getPrototypeOf(copy)).toBe(Object.prototype);
    expect(Object.getOwnPropertyDescriptor(copy, "__proto__")?.value).toEqual({ x: 1 });
  });

  test("copyEngineBodyValue refuses what the encoder refuses", () => {
    expect(copyEngineBodyValue({ f: () => 1 }).ok).toBe(false);
    expect(copyEngineBodyValue(new Map()).ok).toBe(false);
    expect(copyEngineBodyValue({ ok: [1, { a: null }] }).ok).toBe(true);
  });
});

describe("one memoized call — store and miss rules (D4, D5, D6)", () => {
  afterEach(() => {
    clearEngineBodyMemo();
    __setEngineBodyMemoForTests(null);
  });

  function host(
    compute: (args: unknown[]) => unknown,
    options: {
      leaves?: ReadonlySet<string> | undefined;
      code?: () => string | undefined;
      variant?: () => ReadonlySet<string> | undefined;
      fingerprint?: (leaf: string) => string;
    } = {},
  ): EngineBodyMemoHost & { calls: number } {
    const h = {
      calls: 0,
      codeState: options.code ?? (() => "pool:1;fixtures:0"),
      deterministicLeaves: () => ("leaves" in options ? options.leaves : new Set(["std:add"])),
      hostVariantLeaves: options.variant ?? (() => new Set<string>()),
      hostFingerprint: options.fingerprint ?? (() => "engine:test"),
      compute: (args: unknown[]) => {
        h.calls += 1;
        return compute(args);
      },
    };
    return h;
  }

  const call = (fnId: string, args: unknown[], h: EngineBodyMemoHost) =>
    withEngineBodyMemoPartition("test", () => memoizedEngineBodyCall(fnId, args, h));

  test("a rejected prototype keeps the ordinary fallback without diagnostic getter execution", () => {
    let reads = 0;
    const prototype = Object.defineProperty({}, "constructor", { get() { reads++; throw new Error("do not inspect"); } });
    const value = Object.assign(Object.create(prototype), { answer: 42 });
    const h = host(args => {
      expect(args[0]).toBe(value);
      return value.answer;
    });
    expect(call("t:prototype-refusal", [value], h)).toBe(42);
    expect(call("t:prototype-refusal", [value], h)).toBe(42);
    expect(reads).toBe(0);
    expect(h.calls).toBe(2);
    expect(engineBodyMemoStats().byFn["t:prototype-refusal"]).toMatchObject({
      stored: 0, hits: 0, refused: { "non-plain prototype": 2 },
    });
  });

  test("a clean run is stored; a hit returns an equal, fresh copy", () => {
    const h = host((args) => {
      noteEngineBodyMemoLeaf("std:add");
      return { sum: (args[0] as number) + 1, list: [1, 2] };
    });
    const first = call("t:clean", [41], h) as { sum: number; list: number[] };
    const second = call("t:clean", [41], h) as { sum: number; list: number[] };
    expect(h.calls).toBe(1);
    expect(second).toEqual(first);
    expect(second).not.toBe(first);
    second.list.push(99);
    const third = call("t:clean", [41], h) as { list: number[] };
    expect(third.list).toEqual([1, 2]);
    expect(engineBodyMemoStats().byFn["t:clean"]).toMatchObject({ calls: 3, hits: 2, stored: 1, computed: 1 });
  });

  test("the kernel computes on the snapshot, never on the caller's live objects", () => {
    const live = { n: 1 };
    let seen: unknown;
    const h = host((args) => { seen = args[0]; return 0; });
    call("t:snapshot", [live], h);
    expect(seen).toEqual({ n: 1 });
    expect(seen).not.toBe(live);
  });

  test("misses and hits preserve own fields when the prototype has a setter", () => {
    const key = "__memoInheritedFieldForTests";
    const original = { [key]: 42 };
    const previous = Object.getOwnPropertyDescriptor(Object.prototype, key);
    const h = host(args => args[0]);
    let reads = 0, writes = 0;
    let first: unknown, second: unknown;
    try {
      Object.defineProperty(Object.prototype, key, {
        configurable: true,
        get() { reads += 1; return 999; },
        set(_value: unknown) { writes += 1; },
      });
      first = call("t:own-data-publication", [original], h);
      second = call("t:own-data-publication", [original], h);
    } finally {
      Reflect.deleteProperty(Object.prototype, key);
      if (previous !== undefined) Object.defineProperty(Object.prototype, key, previous);
    }
    expect(reads).toBe(0);
    expect(writes).toBe(0);
    expect(h.calls).toBe(1);
    expect(first).toEqual(original);
    expect(second).toEqual(original);
    expect(second).not.toBe(first);
    expect(Object.hasOwn(first as object, key)).toBe(true);
    expect(Object.hasOwn(second as object, key)).toBe(true);
  });

  test("a replay lookup cannot mutate the argument snapshot used by a miss", () => {
    const live = { n: 1 };
    const h = host(args => (args[0] as { n: number }).n);
    const result = call("t:pre-lookup-snapshot", [live], {
      ...h,
      replayLookup: () => { live.n = 2; return undefined; },
    });
    expect(result).toBe(1);
    expect(live.n).toBe(2);
    expect(h.calls).toBe(1);
  });

  test("inherited toJSON cannot change an answer stored for a later hit", () => {
    const previous = Object.getOwnPropertyDescriptor(Object.prototype, "toJSON");
    let jsonCalls = 0;
    const h = host(() => ({ answer: 42 }));
    let first: unknown, second: unknown;
    try {
      Object.defineProperty(Object.prototype, "toJSON", {
        configurable: true,
        value(this: object) {
          jsonCalls += 1;
          return Object.hasOwn(this, "n") && Object.hasOwn(this, "r") ? { n: [], r: 999 } : this;
        },
      });
      first = call("t:own-json-publication", [], h);
      second = call("t:own-json-publication", [], h);
    } finally {
      Reflect.deleteProperty(Object.prototype, "toJSON");
      if (previous !== undefined) Object.defineProperty(Object.prototype, "toJSON", previous);
    }
    expect(jsonCalls).toBe(0);
    expect(first).toEqual({ answer: 42 });
    expect(second).toEqual(first);
    expect(second).not.toBe(first);
    expect(h.calls).toBe(1);
  });

  test("a different argument encoding misses", () => {
    const h = host((args) => args[0]);
    call("t:args", [1], h);
    call("t:args", ["1"], h);
    call("t:args", [-0], h);
    call("t:args", [0], h);
    expect(h.calls).toBe(4);
  });

  test("a run reaching an uncertified native is not stored", () => {
    const h = host(() => { noteEngineBodyMemoLeaf("std:now"); return 5; });
    call("t:now", [], h);
    call("t:now", [], h);
    expect(h.calls).toBe(2);
    expect(engineBodyMemoStats().byFn["t:now"]?.notStored).toEqual({ "uncertified native std:now": 2 });
  });

  test("a tainted run (caught exception, process-global read) is not stored", () => {
    const h = host(() => {
      try {
        throw new Error("absorbed");
      } catch {
        noteEngineBodyMemoTaint("exception crossed an evaluator door");
      }
      return { $tag: "Nothing" };
    });
    call("t:caught", [], h);
    call("t:caught", [], h);
    expect(h.calls).toBe(2);
  });

  test("a throw is never stored and propagates; the recording slot is restored", () => {
    let throwNext = true;
    const h = host(() => {
      if (throwNext) throw new Error("boom");
      return 1;
    });
    expect(() => call("t:throw", [], h)).toThrow("boom");
    expect(engineBodyMemoRecording.frame).toBe(null);
    throwNext = false;
    expect(call("t:throw", [], h)).toBe(1);
    expect(h.calls).toBe(2);
  });

  test("an unreadable leaf list stores nothing", () => {
    const h = host(() => 1, { leaves: undefined });
    call("t:noleaves", [], h);
    call("t:noleaves", [], h);
    expect(h.calls).toBe(2);
  });

  test("a code-state change (pool stamp or fixtures) misses, and a change during the run is not stored", () => {
    let version = 1;
    const h = host(() => 1, { code: () => `pool:${version};fixtures:0` });
    call("t:code", [], h);
    version = 2;
    call("t:code", [], h);
    expect(h.calls).toBe(2);
    const during = host(() => { version += 1; return 1; }, { code: () => `pool:${version};fixtures:0` });
    call("t:during", [], during);
    call("t:during", [], during);
    expect(during.calls).toBe(2);
    expect(engineBodyMemoStats().byFn["t:during"]?.notStored).toEqual({ "code state changed during the run": 2 });
  });

  test("an unstatable code state or no open partition computes every time", () => {
    const h = host(() => 1, { code: () => undefined });
    call("t:nocode", [], h);
    call("t:nocode", [], h);
    expect(h.calls).toBe(2);
    const outside = host(() => 1);
    memoizedEngineBodyCall("t:nopartition", [], outside);
    memoizedEngineBodyCall("t:nopartition", [], outside);
    expect(outside.calls).toBe(2);
  });

  test("a one-shot partition (retain: false) releases its entries when it closes", () => {
    const h = host(() => ({ v: "x".repeat(100) }));
    withEngineBodyMemoPartition("kept", () => memoizedEngineBodyCall("t:kept", [], h));
    withEngineBodyMemoPartition("once", () => {
      memoizedEngineBodyCall("t:once", [], h);
      memoizedEngineBodyCall("t:once", [], h);
    }, { retain: false });
    expect(engineBodyMemoStats().byFn["t:once"]).toMatchObject({ hits: 1, stored: 1 });
    expect(engineBodyMemoStats().entries).toBe(1);
    withEngineBodyMemoPartition("once", () => memoizedEngineBodyCall("t:once", [], h), { retain: false });
    expect(engineBodyMemoStats().byFn["t:once"]).toMatchObject({ hits: 1, stored: 2 });
    withEngineBodyMemoPartition("kept", () => memoizedEngineBodyCall("t:kept", [], h));
    expect(engineBodyMemoStats().byFn["t:kept"]).toMatchObject({ hits: 1, stored: 1 });
  });

  test("an entry that reached a host-variant native is replayed only under the same fingerprint", () => {
    let fingerprint = "case:A";
    // As the real std:lower native: noted by selection, and reporting that it
    // read the host's case tables (non-ASCII text).
    const h = host(() => { noteEngineBodyMemoLeaf("std:lower"); noteEngineBodyMemoHostRead("std:lower"); noteEngineBodyMemoLeaf("std:add"); return { v: 1 }; }, {
      leaves: new Set(["std:lower", "std:add"]),
      variant: () => new Set(["std:lower"]),
      fingerprint: (leaf: string) => (leaf === "std:lower" ? fingerprint : "engine:X"),
    });
    const run = () => withEngineBodyMemoPartition("test", () => memoizedEngineBodyCall("t:variant", [], h));
    run();
    run();
    expect(h.calls).toBe(1);
    fingerprint = "case:B";
    run();
    expect(h.calls).toBe(2);
    expect(engineBodyMemoStats().byFn["t:variant"]?.refused).toEqual({ "host fingerprint differs": 1 });
    run(); // re-recorded under B
    expect(h.calls).toBe(2);
    expect(engineBodyMemoStats().entries).toBe(1);
    // A host-invariant entry consults no fingerprint.
    const plain = host(() => { noteEngineBodyMemoLeaf("std:add"); return 2; }, {
      variant: () => new Set(["std:lower"]),
      fingerprint: (): string => { throw new Error("not consulted"); },
    });
    withEngineBodyMemoPartition("test", () => memoizedEngineBodyCall("t:invariant", [], plain));
    withEngineBodyMemoPartition("test", () => memoizedEngineBodyCall("t:invariant", [], plain));
    expect(plain.calls).toBe(1);
  });

  test("an unreadable host-variant list stores nothing that reached a native", () => {
    const h = host(() => { noteEngineBodyMemoLeaf("std:add"); return 1; }, { variant: () => undefined });
    withEngineBodyMemoPartition("test", () => memoizedEngineBodyCall("t:novariant", [], h));
    withEngineBodyMemoPartition("test", () => memoizedEngineBodyCall("t:novariant", [], h));
    expect(h.calls).toBe(2);
    expect(engineBodyMemoStats().byFn["t:novariant"]?.notStored).toEqual({ "host-variant list unavailable": 2 });
  });

  test("an unknown host fingerprint computes normally without storing or exporting the variant entry", () => {
    const h = host(() => { noteEngineBodyMemoLeaf("host:variant"); return { answer: 42 }; }, {
      leaves: new Set(["host:variant"]),
      variant: () => new Set(["host:variant"]),
      fingerprint: () => "engine:unknown",
    });
    const run = () => withEngineBodyMemoPartition(REPOSITORY_PARTITION, () => memoizedEngineBodyCall("t:unknown-host", [], h));
    expect(run()).toEqual({ answer: 42 });
    expect(run()).toEqual({ answer: 42 });
    expect(h.calls).toBe(2);
    expect(engineBodyMemoStats().entries).toBe(0);
    expect(exportEngineBodyMemoEntries(REPOSITORY_PARTITION)).toEqual([]);
    expect(engineBodyMemoStats().byFn["t:unknown-host"]).toMatchObject({
      hits: 0, stored: 0, computed: 2, notStored: { "host fingerprint unavailable": 2 },
    });
  });

  test("the encoding digest is SHA-256 over UTF-16LE code units, lone surrogates included", () => {
    expect(sha256OfEncoding("")).toBe("e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855");
    expect(sha256OfEncoding("\ud800")).not.toBe(sha256OfEncoding("\ufffd"));
    expect(digestEngineBodyData({ __fenelFn: true, params: [], body: 1 })).toBeDefined();
    expect(digestEngineBodyData({ f: () => 1 })).toBeUndefined();
  });

  test("an artifact entry serves an in-realm miss once, then the in-realm table serves", () => {
    const seen: string[] = [];
    const h = { ...host(() => ({ computed: true })) } as EngineBodyMemoHost & { calls: number };
    let computes = 0;
    const replayed = {
      ...h,
      compute: () => { computes += 1; return { computed: true }; },
      replayLookup: (keyDigest: string) => {
        seen.push(keyDigest);
        return keyDigest === sha256OfEncoding(`repository\u0000pool:1;fixtures:0\u0000t:replayed\u0000${keyOf(7)}`)
          ? { value: { replayed: [1] } } : undefined;
      },
    };
    const first = withEngineBodyMemoPartition("test", () => memoizedEngineBodyCall("t:replayed", [7], replayed));
    const second = withEngineBodyMemoPartition("test", () => memoizedEngineBodyCall("t:replayed", [7], replayed));
    expect(first).toEqual({ replayed: [1] });
    expect(second).toEqual({ replayed: [1] });
    expect(first).not.toBe(second);
    expect(computes).toBe(0);
    expect(seen.length).toBe(1);
    // The artifact holds public repository entries: the lookup uses the
    // digest of the repository portable key (the artifact key digest).
    expect(seen[0]).toBe(sha256OfEncoding(`repository\u0000pool:1;fixtures:0\u0000t:replayed\u0000${keyOf(7)}`));
    expect(engineBodyMemoStats().byFn["t:replayed"]).toMatchObject({ artifactHits: 1, hits: 1, computed: 0 });
  });

  test("a body the artifact does not hold is never looked up (no portable-key digest)", () => {
    let lookups = 0;
    const asked: string[] = [];
    const replayed = {
      ...host(() => "computed"),
      replayHolds: (fnId: string) => { asked.push(fnId); return fnId === "t:held"; },
      replayLookup: () => { lookups += 1; return undefined; },
    };
    expect(call("t:not-held", [1], replayed)).toBe("computed");
    expect(lookups).toBe(0);
    expect(call("t:held", [1], replayed)).toBe("computed");
    expect(lookups).toBe(1);
    expect(asked).toEqual(["t:not-held", "t:held"]);
  });

  test("an artifact entry whose host check fails is a miss (computed, recorded)", () => {
    let computes = 0;
    const replayed = {
      ...host(() => 0),
      compute: () => { computes += 1; return "live"; },
      hostFingerprint: () => "case:LIVE",
      replayLookup: () => ({ value: "stale", hostChecks: [["std:lower", "case:OTHER"]] as const }),
    };
    const out = withEngineBodyMemoPartition("test", () => memoizedEngineBodyCall("t:replay-host", [], replayed));
    expect(out).toBe("live");
    expect(computes).toBe(1);
    expect(engineBodyMemoStats().byFn["t:replay-host"]?.refused).toEqual({ "artifact host fingerprint differs": 1 });
  });

  test.each([
    ["engine:unknown", "engine:unknown", false],
    ["engine:unknown", "engine:known", false],
    ["engine:known", "engine:unknown", false],
    ["case:known", "case:known", true],
  ] as const)("artifact host checks require known evidence: live %s, recorded %s", (live, recorded, accepted) => {
    const h = host(() => { noteEngineBodyMemoLeaf("std:lower"); noteEngineBodyMemoHostRead("std:lower"); return "computed"; }, {
      leaves: new Set(["std:lower"]),
      variant: () => new Set(["std:lower"]),
      fingerprint: () => live,
    });
    const replayed = { ...h, replayLookup: () => ({ value: "replayed", hostChecks: [["std:lower", recorded]] as const }) };
    expect(call("t:replay-host-evidence", [], replayed)).toBe(accepted ? "replayed" : "computed");
    expect(h.calls).toBe(accepted ? 0 : 1);
    expect(engineBodyMemoStats().byFn["t:replay-host-evidence"]).toMatchObject({
      artifactHits: accepted ? 1 : 0,
      computed: accepted ? 0 : 1,
    });
    if (!accepted) expect(engineBodyMemoStats().byFn["t:replay-host-evidence"]?.refused).toEqual({ "artifact host fingerprint differs": 1 });
    if (live === "engine:unknown") expect(engineBodyMemoStats().entries).toBe(0);
    expect(exportEngineBodyMemoEntries("test").every(entry =>
      entry.hostChecks?.every(([, fingerprint]) => fingerprint !== "engine:unknown") ?? true)).toBe(true);
  });

  test("artifact text refuses closures and partials at the same boundary as decoded replay", () => {
    for (const marker of ["__fenelFn", "__fenelPartial"]) {
      for (const encoded of [false, true]) {
        clearEngineBodyMemo();
        const value = { [marker]: true, body: { literal: 7 } };
        const h = host(() => "computed");
        const replay = encoded ? { text: encodeReplayValue(value) } : { value };
        expect(call("t:artifact-admission", [], { ...h, replayLookup: () => replay })).toBe("computed");
        expect(h.calls).toBe(1);
        expect(engineBodyMemoStats().byFn["t:artifact-admission"]?.refused["artifact value: evaluator closure or partial"]).toBe(1);
      }
    }
  });

  test("an artifact text hit hands out its decoded graph without a second copy; no hit returns a shared graph", () => {
    const value = { list: [1, { a: "x" }], frozen: Object.freeze({ k: 1 }), shared: [] as unknown[] };
    (value as { again?: unknown }).again = value.shared;
    const text = encodeReplayValue(value);
    const h = host(() => { throw new Error("the artifact must serve"); });
    const replayed = { ...h, replayLookup: () => ({ text }) };
    const copiesBefore = __engineBodyMemoCopyWalksForTests();
    const first = call("t:text-hit", [], replayed) as typeof value & { again: unknown };
    expect(__engineBodyMemoCopyWalksForTests() - copiesBefore).toBe(0);
    expect(first).toEqual(value as typeof first);
    expect(Object.isFrozen(first.frozen)).toBe(true);
    expect(first.again).toBe(first.shared);
    const second = call("t:text-hit", [], replayed) as typeof first;
    expect(second).toEqual(first);
    expect(second).not.toBe(first);
    expect(second.list).not.toBe(first.list);
    expect(second.list[1]).not.toBe(first.list[1]);
    expect(h.calls).toBe(0);
    // Mutating a handed graph never reaches a later caller.
    (first.list[1] as { a: string }).a = "mutated";
    expect((call("t:text-hit", [], replayed) as typeof first).list[1]).toEqual({ a: "x" });
  });

  test("an artifact text hit is kept as a public entry: another Local partition reuses it, and its text is not charged", () => {
    const big = { rows: Array.from({ length: 2000 }, (_, i) => ({ i, s: "x".repeat(20) })) };
    const text = encodeReplayValue(big);
    let lookups = 0;
    const h = host(() => { throw new Error("the artifact or the table must serve"); });
    const replayed = { ...h, replayLookup: () => { lookups += 1; return { text }; } };
    const inLocal = (source: string) =>
      withEngineBodyMemoPartition(`local:${source}`, () => memoizedEngineBodyCall("t:public-artifact", [3], replayed));
    expect(inLocal("a")).toEqual(big);
    expect(inLocal("b")).toEqual(big);
    expect(lookups).toBe(1);
    const stats = engineBodyMemoStats();
    expect(stats.byFn["t:public-artifact"]).toMatchObject({ artifactHits: 1, hits: 1, repositoryHits: 1, computed: 0 });
    expect(stats.entries).toBe(1);
    // The entry holds the artifact's own text (a view of the resident artifact),
    // so the cap is charged for its key and overhead only.
    expect(stats.textChars).toBe(text.length);
    expect(stats.bytes).toBeLessThan(text.length);
    // Clearing a Local partition does not drop the public entry.
    clearEngineBodyMemoPartition("local:a");
    expect(inLocal("c")).toEqual(big);
    expect(lookups).toBe(1);
  });

  test("artifact text admission refuses exactly what decode-then-copy refused", () => {
    const hidden = (marker: string, flag: unknown) =>
      Object.defineProperty({}, marker, { value: flag, enumerable: false, writable: false, configurable: false });
    const cyclic: Record<string, unknown> = { __fenelPartial: true };
    cyclic.self = { back: cyclic };
    const nullProto = Object.assign(Object.create(null) as Record<string, unknown>, { __fenelFn: true });
    const cases: readonly (readonly [string, unknown, boolean])[] = [
      ["nested closure marker", { a: [{ b: { __fenelFn: true, body: 1 } }] }, false],
      ["partial marker in a cycle", { root: cyclic }, false],
      ["null-prototype record", [nullProto], false],
      ["non-enumerable marker", { x: hidden("__fenelFn", true) }, false],
      ["marker false is data", { __fenelFn: false, __fenelPartial: "true" }, true],
      ["marker as an array element", ["__fenelFn", true], true],
      ["marker key holding a record", { __fenelFn: { $tag: "True" } }, true],
      ["plain data", { $tag: "Just", _0: [1, "two", null, undefined, -0, NaN] }, true],
    ];
    for (const [label, value, admitted] of cases) {
      clearEngineBodyMemo();
      const text = encodeReplayValue(value);
      // The previous admission, for reference: decode, then the copier.
      const old = copyEngineBodyValue(decodeReplayValue(text));
      expect([label, old.ok]).toEqual([label, admitted]);
      const h = host(() => "computed");
      const out = call("t:text-admission", [], { ...h, replayLookup: () => ({ text }) });
      expect([label, out === "computed"]).toEqual([label, !admitted]);
    }
  });

  test("artifact text preserves false-like values, prototypes, descriptors and aliases", () => {
    const shared = Object.create(null) as Record<string, unknown>;
    Object.defineProperty(shared, "__proto__", { value: false, enumerable: true, writable: false, configurable: false });
    Object.defineProperty(shared, "hidden", { value: undefined, enumerable: false, writable: true, configurable: true });
    const graph = Object.freeze({ first: shared, second: shared });
    shared.self = shared;
    for (const value of [false, 0, -0, "", null, undefined, graph]) {
      clearEngineBodyMemo();
      const h = host(() => { throw new Error("artifact must serve"); });
      const replayHost = { ...h, replayLookup: () => ({ text: encodeReplayValue(value) }) };
      const first = call("t:artifact-text", [], replayHost);
      const second = call("t:artifact-text", [], replayHost);
      expect(keyOf(first)).toBe(keyOf(value));
      expect(keyOf(second)).toBe(keyOf(value));
      expect(h.calls).toBe(0);
      expect(engineBodyMemoStats().byFn["t:artifact-text"]).toMatchObject({ artifactHits: 1, hits: 1 });
      if (value === graph) {
        const a = first as typeof graph;
        const b = second as typeof graph;
        expect(a.first).toBe(a.second);
        expect(a.first.self).toBe(a.first);
        expect(a.first).not.toBe(b.first);
        expect(Object.getPrototypeOf(a.first)).toBeNull();
      }
    }
  });

  test("a Local partition reads the public repository partition but stores only under its own", () => {
    const h = host((args) => ({ v: args[0] }));
    withEngineBodyMemoPartition(REPOSITORY_PARTITION, () => memoizedEngineBodyCall("t:public", [1], h));
    withEngineBodyMemoPartition("local:tab-a", () => memoizedEngineBodyCall("t:public", [1], h));
    expect(h.calls).toBe(1);
    expect(engineBodyMemoStats().byFn["t:public"]).toMatchObject({ hits: 1, repositoryHits: 1 });
    // A Local-only computation is invisible to the repository and to another tab.
    withEngineBodyMemoPartition("local:tab-a", () => memoizedEngineBodyCall("t:public", [2], h));
    withEngineBodyMemoPartition("local:tab-b", () => memoizedEngineBodyCall("t:public", [2], h));
    withEngineBodyMemoPartition(REPOSITORY_PARTITION, () => memoizedEngineBodyCall("t:public", [2], h));
    expect(h.calls).toBe(4);
  });

  test("a registry build keeps only the partition its own opener offered; a nested build runs with none", () => {
    const h = host((args) => ({ v: args[0] }));
    const counts = () => engineBodyMemoStats().byFn["t:nested"]?.calls ?? 0;
    withEngineBodyMemoPartition(REPOSITORY_PARTITION, () => withRegistryBuildPartitionScope(() => {
      // The opener's own build: memoized in the public partition.
      memoizedEngineBodyCall("t:nested", [1], h);
      expect(activeEngineBodyMemoPartition()).toBe(REPOSITORY_PARTITION);
      // A build nested inside it (e.g. an account build): no partition at all.
      withRegistryBuildPartitionScope(() => {
        expect(activeEngineBodyMemoPartition()).toBe(null);
      });
      expect(activeEngineBodyMemoPartition()).toBe(REPOSITORY_PARTITION);
    }));
    expect(counts()).toBe(1);
    // A build with no opener at all runs with none either.
    withRegistryBuildPartitionScope(() => expect(activeEngineBodyMemoPartition()).toBe(null));
    // A nested opener (a Local build inside a repository build) gets its own.
    withEngineBodyMemoPartition(REPOSITORY_PARTITION, () => withRegistryBuildPartitionScope(() =>
      withEngineBodyMemoPartition("local:tab", () => withRegistryBuildPartitionScope(() =>
        expect(activeEngineBodyMemoPartition()).toBe("local:tab")))));
  });

  test("a stored miss hands out a copy, never the kernel's own result", () => {
    const own = { list: [1] };
    const h = host(() => own);
    const first = withEngineBodyMemoPartition("test", () => memoizedEngineBodyCall("t:copy", [], h));
    expect(first).toEqual(own);
    expect(first).not.toBe(own);
  });

  test("the table keeps results as transport text, and every handed value is a fresh graph with the recorded integrity", () => {
    const own = Object.freeze({ list: Object.freeze([1, { x: "y" }]), open: { n: -0 } });
    const h = host(() => own);
    const first = withEngineBodyMemoPartition("text", () => memoizedEngineBodyCall("t:text", [], h)) as typeof own;
    const second = withEngineBodyMemoPartition("text", () => memoizedEngineBodyCall("t:text", [], h)) as typeof own;
    expect(h.calls).toBe(1);
    const [entry] = exportEngineBodyMemoEntries("text");
    expect(typeof entry!.text).toBe("string");
    expect(entry!.value).toEqual(own);
    for (const handed of [first, second]) {
      expect(handed).not.toBe(own);
      expect(Object.isFrozen(handed) && Object.isFrozen(handed.list)).toBe(true);
      expect(Object.isFrozen(handed.open)).toBe(false);
      expect(Object.is(handed.open.n, -0)).toBe(true);
    }
    expect(first).not.toBe(second);
    expect(first.list).not.toBe(second.list);
  });

  test("a long key is held as a digest with a key check: hits work, a failing check misses, export gives the portable digest", () => {
    const long = "k".repeat(70_000);
    const h = host((args) => ({ n: (args[0] as string).length }));
    const call = (arg: string) => withEngineBodyMemoPartition("long", () => memoizedEngineBodyCall("t:long", [arg], h));
    expect(call(long)).toEqual({ n: 70_000 });
    expect(call(long)).toEqual({ n: 70_000 });
    expect(h.calls).toBe(1);
    expect(call(long + "x")).toEqual({ n: 70_001 });
    expect(h.calls).toBe(2);
    const stats = engineBodyMemoStats();
    expect(stats.keyChars).toBeGreaterThan(140_000);
    expect(stats.bytes).toBeLessThan(70_000);
    const encoding = (arg: string) => { const s = snapshotEngineBodyArguments([arg]); if (!s.ok) throw new Error(s.reason); return s.key; };
    const digests = exportEngineBodyMemoEntries("long").map((entry) => entry.keyDigest).sort();
    const expected = [long, long + "x"].map((arg) => sha256OfEncoding(`long\u0000pool:1;fixtures:0\u0000t:long\u0000${encoding(arg)}`)).sort();
    expect(digests).toEqual(expected);
    expect(__breakEngineBodyMemoKeyChecksForTests()).toBe(2);
    expect(call(long)).toEqual({ n: 70_000 });
    expect(h.calls).toBe(3);
  });

  // base-on-empty item 2 (2026-10-30): a long key is hashed once per call.
  // The map keys of every partition, the repository lookup, the replay lookup
  // (the artifact key digest) and the stored portable digest all derive from
  // one SHA-256 of the repository portable key; the exact key check keeps
  // collision safety.
  test("a long-key call hashes its key once: map keys, repository lookup, replay lookup and storage", () => {
    const createHash = crypto.createHash;
    let hashes = 0;
    const spy = spyOn(crypto, "createHash").mockImplementation((...args) => { hashes += 1; return createHash(...args); });
    const seen: string[] = [];
    const counted = host((args) => ({ n: (args[0] as string).length }));
    const h = { ...counted, replayLookup: (key: string) => { seen.push(key); return undefined; } };
    const arg = "k".repeat(70_000);
    const run = (partition: string) => withEngineBodyMemoPartition(partition, () => memoizedEngineBodyCall("t:hash-once", [arg], h));
    try {
      // A Local miss: own key, repository key, replay lookup, store.
      expect(run("local:tab")).toEqual({ n: 70_000 });
      expect(hashes).toBe(1);
      // A Local hit.
      expect(run("local:tab")).toEqual({ n: 70_000 });
      expect(hashes).toBe(2);
      // A repository-partition miss: own key, replay lookup, store.
      expect(run(REPOSITORY_PARTITION)).toEqual({ n: 70_000 });
      expect(hashes).toBe(3);
      expect(counted.calls).toBe(2);
    } finally {
      spy.mockRestore();
    }
    const portable = (partition: string) => `${partition}\u0000pool:1;fixtures:0\u0000t:hash-once\u0000${keyOf(arg)}`;
    // The replay lookup receives the artifact key digest itself.
    expect(seen).toEqual([sha256OfEncoding(portable(REPOSITORY_PARTITION)), sha256OfEncoding(portable(REPOSITORY_PARTITION))]);
    // Export keeps each entry's portable-key digest (the artifact key).
    expect(exportEngineBodyMemoEntries(REPOSITORY_PARTITION).map((entry) => entry.keyDigest))
      .toEqual([sha256OfEncoding(portable(REPOSITORY_PARTITION))]);
    expect(exportEngineBodyMemoEntries("local:tab").map((entry) => entry.keyDigest))
      .toEqual([sha256OfEncoding(portable("local:tab"))]);
    // Collision safety: a broken key check misses in both partitions.
    expect(__breakEngineBodyMemoKeyChecksForTests()).toBe(2);
    expect(run("local:tab")).toEqual({ n: 70_000 });
    expect(run(REPOSITORY_PARTITION)).toEqual({ n: 70_000 });
    expect(counted.calls).toBe(4);
  });

  // fix-engine 2026-10-31 (items 4-5): export reads a long key's check only
  // for an entry without a stored portable digest, and decodes the inflated
  // bytes as explicit little-endian pairs (any byte offset, any host order).
  test("export inflates a key check only without a portable digest, and decodes it at any offset", () => {
    const counted = host((args) => ({ n: (args[0] as string).length }));
    const arg = "k\u00e9\ud800".repeat(25_000);
    const run = (partition: string) => withEngineBodyMemoPartition(partition, () => memoizedEngineBodyCall("t:export-read", [arg], counted));
    // Local first (a repository entry would serve the Local call).
    expect(run("local:tab")).toEqual({ n: 75_000 });
    expect(run(REPOSITORY_PARTITION)).toEqual({ n: 75_000 });
    expect(counted.calls).toBe(2);
    const portable = (partition: string) => `${partition}\u0000pool:1;fixtures:0\u0000t:export-read\u0000${keyOf(arg)}`;
    const inflate = zlib.inflateRawSync;
    let inflates = 0;
    // The host's inflated bytes, handed back as a view at an odd byte offset.
    const spy = spyOn(zlib, "inflateRawSync").mockImplementation(((...args: Parameters<typeof inflate>) => {
      inflates += 1;
      const bytes = inflate(...args);
      const shifted = new Uint8Array(bytes.length + 1);
      shifted.set(bytes, 1);
      return shifted.subarray(1);
    }) as typeof inflate);
    try {
      expect(exportEngineBodyMemoEntries(REPOSITORY_PARTITION).map((entry) => entry.keyDigest))
        .toEqual([sha256OfEncoding(portable(REPOSITORY_PARTITION))]);
      expect(inflates).toBe(0);
      expect(exportEngineBodyMemoEntries("local:tab").map((entry) => entry.keyDigest))
        .toEqual([sha256OfEncoding(portable("local:tab"))]);
      expect(inflates).toBe(1);
    } finally {
      spy.mockRestore();
    }
  });

  test("compression failure keeps an exact raw key check and the computed result", () => {
    const compress = spyOn(zlib, "deflateRawSync").mockImplementation(() => { throw new Error("compression unavailable"); });
    try {
      const h = host(() => ({ answer: 42 }));
      const args = ["k".repeat(70_000)];
      expect(call("t:compression-failure", args, h)).toEqual({ answer: 42 });
      expect(call("t:compression-failure", args, h)).toEqual({ answer: 42 });
      expect(h.calls).toBe(1);
      expect(__breakEngineBodyMemoKeyChecksForTests()).toBe(1);
      expect(call("t:compression-failure", args, h)).toEqual({ answer: 42 });
      expect(h.calls).toBe(2);
    } finally {
      compress.mockRestore();
    }
  });

  test("hashing failure uses the full map key without failing the computation", () => {
    const hash = spyOn(crypto, "createHash").mockImplementation(() => { throw new Error("hash unavailable"); });
    try {
      const h = host(() => ({ answer: 42 }));
      const args = ["k".repeat(70_000)];
      expect(call("t:hash-failure", args, h)).toEqual({ answer: 42 });
      expect(call("t:hash-failure", args, h)).toEqual({ answer: 42 });
      expect(h.calls).toBe(1);
      expect(__breakEngineBodyMemoKeyChecksForTests()).toBe(0);
    } finally {
      hash.mockRestore();
    }
  });

  // Storage reuses the call's key digest (one pass); a failure of that one
  // hash stores under the exact full key, exported with its portable digest.
  test("a key digest failure stores under the exact key with the portable digest", () => {
    const hash = spyOn(crypto, "createHash").mockImplementation(() => { throw new Error("hash unavailable"); });
    const args = ["k".repeat(70_000)];
    try {
      const h = host(() => ({ answer: 42 }));
      expect(withEngineBodyMemoPartition(REPOSITORY_PARTITION, () =>
        memoizedEngineBodyCall("t:storage-failure", args, h))).toEqual({ answer: 42 });
      expect(h.calls).toBe(1);
      const stats = engineBodyMemoStats();
      expect(stats.entries).toBe(1);
      expect(stats.byFn["t:storage-failure"]?.stored).toBe(1);
      expect(__breakEngineBodyMemoKeyChecksForTests()).toBe(0);
    } finally {
      hash.mockRestore();
    }
    expect(exportEngineBodyMemoEntries(REPOSITORY_PARTITION).map((entry) => entry.keyDigest))
      .toEqual([sha256OfEncoding(`repository\u0000pool:1;fixtures:0\u0000t:storage-failure\u0000${keyOf(...args)}`)]);
  });

  test("partitions do not share entries", () => {
    const h = host(() => ({ v: 1 }));
    withEngineBodyMemoPartition("a", () => memoizedEngineBodyCall("t:part", [], h));
    withEngineBodyMemoPartition("b", () => memoizedEngineBodyCall("t:part", [], h));
    withEngineBodyMemoPartition("a", () => memoizedEngineBodyCall("t:part", [], h));
    expect(h.calls).toBe(2);
  });

  test("an unstorable result (a function) is returned but not stored", () => {
    const fn = () => 1;
    const h = host(() => ({ fn }));
    expect((call("t:fnresult", [], h) as { fn: unknown }).fn).toBe(fn);
    call("t:fnresult", [], h);
    expect(h.calls).toBe(2);
  });

  test("the byte cap bounds the table (LRU eviction)", () => {
    const previous = process.env["FENEL_ENGINE_BODY_MEMO_MB"];
    process.env["FENEL_ENGINE_BODY_MEMO_MB"] = "0.01"; // ~10 KB
    try {
      const h = host((args) => "x".repeat(2000) + String(args[0]));
      for (let i = 0; i < 10; i++) call("t:cap", [i], h);
      const stats = engineBodyMemoStats();
      expect(stats.bytes).toBeLessThanOrEqual(0.01 * 1024 * 1024);
      expect(stats.evictions).toBeGreaterThan(0);
      call("t:cap", [9], h); // most recent survives
      expect(h.calls).toBe(10);
    } finally {
      if (previous === undefined) delete process.env["FENEL_ENGINE_BODY_MEMO_MB"];
      else process.env["FENEL_ENGINE_BODY_MEMO_MB"] = previous;
    }
  });

  test("an oversized entry is reported even when no stored entry was evicted", () => {
    const previous = process.env["FENEL_ENGINE_BODY_MEMO_MB"];
    process.env["FENEL_ENGINE_BODY_MEMO_MB"] = "0";
    try {
      const h = host(() => ({ answer: 42 }));
      expect(call("t:oversized", [], h)).toEqual({ answer: 42 });
      const stats = engineBodyMemoStats();
      expect(stats.entries).toBe(0);
      expect(stats.evictions).toBe(0);
      expect(stats.byFn["t:oversized"]?.notStored["over the byte cap"]).toBe(1);
    } finally {
      if (previous === undefined) delete process.env["FENEL_ENGINE_BODY_MEMO_MB"];
      else process.env["FENEL_ENGINE_BODY_MEMO_MB"] = previous;
    }
  });

  test("an artifact hit still reports when its entry cannot be retained", () => {
    const previous = process.env["FENEL_ENGINE_BODY_MEMO_MB"];
    process.env["FENEL_ENGINE_BODY_MEMO_MB"] = "0";
    try {
      const h = host(() => { throw new Error("artifact must serve"); });
      expect(call("t:oversized-replay", [], {
        ...h, replayLookup: () => ({ text: encodeReplayValue(false) }),
      })).toBe(false);
      const stats = engineBodyMemoStats();
      expect(stats.entries).toBe(0);
      expect(stats.evictions).toBe(0);
      expect(stats.byFn["t:oversized-replay"]).toMatchObject({
        artifactHits: 1, computed: 0, notStored: { "over the byte cap": 1 },
      });
    } finally {
      if (previous === undefined) delete process.env["FENEL_ENGINE_BODY_MEMO_MB"];
      else process.env["FENEL_ENGINE_BODY_MEMO_MB"] = previous;
    }
  });
});

describe("enablement (D3)", () => {
  afterEach(() => __setEngineBodyMemoForTests(null));

  test("off under NODE_ENV=test unless a test forces it", () => {
    expect(process.env["NODE_ENV"]).toBe("test");
    expect(engineBodyMemoSwitchedOn()).toBe(false);
    __setEngineBodyMemoForTests(true);
    expect(engineBodyMemoSwitchedOn()).toBe(true);
  });
});

describe("replay transport own-data publication", () => {
  test("private serialization carriers never inherit toJSON", () => {
    const original = [
      Object.freeze({ answer: 42, toJSON: "ordinary data" }),
      Object.freeze([undefined, -0, NaN, Infinity, 12n]),
      new Uint8Array([1, 255]),
    ];
    const text = encodeReplayValue(original);
    for (const prototype of [Object.prototype, Array.prototype]) {
      const previous = Object.getOwnPropertyDescriptor(prototype, "toJSON");
      let reads = 0, calls = 0;
      let encoded: string;
      try {
        Object.defineProperty(prototype, "toJSON", {
          configurable: true,
          get() { reads += 1; return () => { calls += 1; return 999; }; },
        });
        encoded = encodeReplayValue(original);
      } finally {
        Reflect.deleteProperty(prototype, "toJSON");
        if (previous !== undefined) Object.defineProperty(prototype, "toJSON", previous);
      }
      expect(reads).toBe(0);
      expect(calls).toBe(0);
      expect(encoded).toBe(text);
    }
  });

  test("record publication ignores inherited setters and read-only fields", () => {
    const key = "__memoInheritedFieldForTests";
    const original = { [key]: 42 };
    const text = encodeReplayValue(original);
    const previous = Object.getOwnPropertyDescriptor(Object.prototype, key);
    let reads = 0, writes = 0;
    let first: unknown, second: unknown, encoded: string;
    try {
      Object.defineProperty(Object.prototype, key, {
        configurable: true,
        get() { reads += 1; return 999; },
        set(_value: unknown) { writes += 1; },
      });
      encoded = encodeReplayValue(original);
      first = decodeReplayValue(text);
      Object.defineProperty(Object.prototype, key, { value: 999, writable: false, configurable: true });
      second = decodeReplayValue(text);
    } finally {
      Reflect.deleteProperty(Object.prototype, key);
      if (previous !== undefined) Object.defineProperty(Object.prototype, key, previous);
    }
    expect(reads).toBe(0);
    expect(writes).toBe(0);
    expect(encoded).toBe(text);
    for (const copied of [first, second]) {
      expect(Object.getOwnPropertyDescriptor(copied, key)).toEqual(Object.getOwnPropertyDescriptor(original, key));
      expect(copied).toEqual(original);
    }
  });

  test("array publication ignores inherited numeric setters", () => {
    const original = [Object.freeze([42]), { v: 43 }];
    const text = encodeReplayValue(original);
    const expected = snapshotEngineBodyArguments(original);
    const previous = Object.getOwnPropertyDescriptor(Array.prototype, "0");
    let reads = 0, writes = 0;
    let copied: unknown, encoded: string;
    try {
      Object.defineProperty(Array.prototype, "0", {
        configurable: true,
        get() { reads += 1; return 999; },
        set(_value: unknown) { writes += 1; },
      });
      encoded = encodeReplayValue(original);
      copied = decodeReplayValue(text);
    } finally {
      Reflect.deleteProperty(Array.prototype, "0");
      if (previous !== undefined) Object.defineProperty(Array.prototype, "0", previous);
    }
    expect(reads).toBe(0);
    expect(writes).toBe(0);
    expect(encoded).toBe(text);
    const actual = snapshotEngineBodyArguments(copied as unknown[]);
    expect(actual.ok && actual.key).toBe(expected.ok && expected.key);
  });

  test("replay descriptors ignore inherited get and set slots", () => {
    const original = [Object.freeze({ x: 42 }), Object.freeze([43])];
    const text = encodeReplayValue(original);
    const expected = snapshotEngineBodyArguments(original);
    for (const key of ["get", "set"] as const) {
      const previous = Object.getOwnPropertyDescriptor(Object.prototype, key);
      let copied: unknown, encoded: string;
      try {
        Object.defineProperty(Object.prototype, key, {
          __proto__: null, value: () => 999, writable: true, configurable: true,
        } as PropertyDescriptor);
        encoded = encodeReplayValue(original);
        copied = decodeReplayValue(text);
      } finally {
        Reflect.deleteProperty(Object.prototype, key);
        if (previous !== undefined) Object.defineProperty(Object.prototype, key, previous);
      }
      expect(encoded).toBe(text);
      const actual = snapshotEngineBodyArguments(copied as unknown[]);
      expect(actual.ok && actual.key).toBe(expected.ok && expected.key);
    }
  });

  test("replay encoding cannot admit an accessor through an inherited descriptor value", () => {
    let reads = 0;
    const original = Object.defineProperty({}, "x", {
      get() { reads += 1; return 42; }, enumerable: true,
    });
    const previous = Object.getOwnPropertyDescriptor(Object.prototype, "value");
    let refusal: unknown;
    try {
      Object.defineProperty(Object.prototype, "value", {
        __proto__: null, value: 999, writable: true, configurable: true,
      } as PropertyDescriptor);
      try { encodeReplayValue(original); } catch (error) { refusal = error; }
    } finally {
      Reflect.deleteProperty(Object.prototype, "value");
      if (previous !== undefined) Object.defineProperty(Object.prototype, "value", previous);
    }
    expect(reads).toBe(0);
    expect(refusal).toBeInstanceOf(TypeError);
    expect(String(refusal)).toContain("accessor");
  });

  test("absent replay integrity flags cannot be supplied by Object.prototype", () => {
    const original = [{ v: 42 }, [43]];
    const text = encodeReplayValue(original);
    const expected = snapshotEngineBodyArguments(original);
    const keys = ["x", "lw", "ea"] as const;
    const previous = keys.map(key => Object.getOwnPropertyDescriptor(Object.prototype, key));
    let copied: unknown;
    try {
      Object.defineProperty(Object.prototype, "x", { value: 0, configurable: true });
      Object.defineProperty(Object.prototype, "lw", { value: 0, configurable: true });
      Object.defineProperty(Object.prototype, "ea", { value: [[0, "---"]], configurable: true });
      copied = decodeReplayValue(text);
    } finally {
      keys.forEach((key, index) => {
        Reflect.deleteProperty(Object.prototype, key);
        if (previous[index] !== undefined) Object.defineProperty(Object.prototype, key, previous[index]!);
      });
    }
    const actual = snapshotEngineBodyArguments(copied as unknown[]);
    expect(actual.ok && actual.key).toBe(expected.ok && expected.key);
  });
});
