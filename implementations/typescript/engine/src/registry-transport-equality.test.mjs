import { describe, expect, test } from "bun:test";
import { representationValueSnapshot } from "./representation-value";

// C1: execute the existing copier and exact equality's actual descriptor
// observation, without preparing an unrelated repository registry. Fenel still
// owns equality and its abstention; these controls establish input fidelity.
const transpiler = new Bun.Transpiler({ loader: "ts" });
const [registrySource, dispatchSource] = await Promise.all([
  Bun.file(new URL("./registry-transport.ts", import.meta.url)).text(),
  Bun.file(new URL("./engine-bodies-dispatch.ts", import.meta.url)).text(),
]);
const transportStart = registrySource.indexOf("export function registryTransportSnapshot<");
const transportEnd = registrySource.indexOf("/** An injective text encoding of a transport value,", transportStart);
const slotStart = dispatchSource.indexOf("function traversalOwnDataSlot(");
const slotEnd = dispatchSource.indexOf("function traversalOwnDataValue(", slotStart);
const snapshotStart = dispatchSource.indexOf("    exactEqualitySnapshot: (_ctx, value) => {");
const snapshotEnd = dispatchSource.indexOf("    exactValueOwnerType:", snapshotStart);
if ([transportStart, slotStart, snapshotStart].some(index => index < 0)
  || transportEnd < transportStart || slotEnd < slotStart || snapshotEnd < snapshotStart)
  throw new Error("The descriptor transport fixture boundary moved.");
const compile = source => transpiler.transformSync(source).replace(/^export /gm, "");
const snapshot = new Function(`${compile(registrySource.slice(transportStart, transportEnd))}; return registryTransportSnapshot;`)();
const exactEqualitySnapshot = new Function("representationValueSnapshot", `${compile(`${dispatchSource.slice(slotStart, slotEnd)}
  const callbacks = { ${dispatchSource.slice(snapshotStart, snapshotEnd)} };`)}; return callbacks.exactEqualitySnapshot;`)(representationValueSnapshot);
const observe = value => exactEqualitySnapshot({}, value);
const equalityCopy = value => snapshot(value, "equality fixture", "equality");
const hidden = (value, key, entry) => Object.defineProperty(value, key, { value: entry, enumerable: false });

describe("registry equality transport keeps descriptor observations", () => {
  test("canonical mode retains its existing sorted own-data API", () => {
    const value = { z: { second: 2, first: 1 }, a: [undefined, null, false] };
    const expected = '{"a":[null,null,false],"z":{"first":1,"second":2}}';
    expect(JSON.stringify(snapshot(value, "default fixture"))).toBe(expected);
    expect(JSON.stringify(snapshot(value, "explicit canonical fixture", "canonical"))).toBe(expected);
    expect(Object.keys(value)).toEqual(["z", "a"]);
    expect(Object.keys(value.z)).toEqual(["second", "first"]);
  });

  test("equality mode retains nested record order through browser structured clone", () => {
    const value = { z: { second: 2, first: 1 }, a: [1, { last: null, first: undefined }] };
    const copied = equalityCopy(value), delivered = structuredClone(copied);
    expect(JSON.stringify(copied)).toBe(JSON.stringify(value));
    expect(Object.keys(copied.z)).toEqual(Object.keys(value.z));
    expect(Object.keys(delivered.a[1])).toEqual(Object.keys(value.a[1]));
    for (const current of [copied, delivered]) {
      expect(observe(current)).toEqual(observe(value));
      expect(observe(current.z)).toEqual(observe(value.z));
      expect(observe(current.a)).toEqual(observe(value.a));
      expect(observe(current.a[1])).toEqual(observe(value.a[1]));
    }
  });

  test("copies stay isolated and mutable while preserving shared data", () => {
    const shared = Object.freeze({ z: 1, a: 2 });
    const value = Object.freeze({ first: shared, second: shared, list: Object.freeze([shared]) });
    const copied = equalityCopy(value);
    expect(copied).not.toBe(value);
    expect(copied.first).not.toBe(shared);
    expect(copied.first).toBe(copied.second);
    expect(copied.first).toBe(copied.list[0]);
    expect(Object.isFrozen(copied)).toBe(false);
    expect(Object.isFrozen(copied.first)).toBe(false);
    expect(Object.isFrozen(copied.list)).toBe(false);
    copied.first.z = 9;
    copied.list.push("copied only");
    expect(shared.z).toBe(1);
    expect(value.list).toHaveLength(1);
  });

  test("plain null-prototype records and awkward own keys retain the same observations", () => {
    const value = Object.assign(Object.create(null), { z: 1, a: 2 });
    Object.defineProperty(value, "__proto__", { value: { declared: true }, enumerable: true });
    const copied = equalityCopy(value), delivered = structuredClone(copied);
    expect(Object.getPrototypeOf(copied)).toBeNull();
    expect(Object.hasOwn(copied, "__proto__")).toBe(true);
    expect(observe(copied)).toEqual(observe(value));
    expect(observe(delivered)).toEqual(observe(value));
  });

  test("hidden record fields refuse before normalization can erase source unreadability", () => {
    const value = hidden({ visible: "same" }, "hidden", "different");
    expect(observe(value)).toEqual({ $tag: "SnapshotUnreadable" });
    const canonical = snapshot(value, "default fixture");
    expect(canonical).toEqual({ visible: "same" });
    expect(observe(canonical).$tag).toBe("SnapshotRecord");
    expect(() => equalityCopy(value)).toThrow("non-enumerable property");
    expect(() => equalityCopy({ nested: [value] })).toThrow("non-enumerable property");
    expect(observe(value)).toEqual({ $tag: "SnapshotUnreadable" });
  });

  test("non-enumerable array cells refuse before becoming readable indexed data", () => {
    const value = hidden(["same"], "0", "same");
    expect(observe(value)).toEqual({ $tag: "SnapshotUnreadable" });
    expect(observe(snapshot(value, "default fixture"))).toEqual({ $tag: "SnapshotArray", _0: ["same"] });
    expect(() => equalityCopy(value)).toThrow("non-enumerable array slot");
  });

  for (const key of ["hidden", "01", "-1", "4294967295"]) {
    test(`hidden array extra ${key} refuses before being discarded`, () => {
      const value = hidden([1], key, "must remain unreadable");
      expect(observe(value)).toEqual({ $tag: "SnapshotUnreadable" });
      expect(observe(snapshot(value, "default fixture"))).toEqual({ $tag: "SnapshotArray", _0: [1] });
      expect(() => equalityCopy(value)).toThrow("array properties");
    });
  }

  test("sparse arrays and own extras refuse without synthesizing members", () => {
    const sparse = new Array(2); sparse[0] = 1;
    const replacedHole = hidden([1, , 3], "hidden", "not the missing member");
    const extra = [1]; extra.extra = true;
    const numericExtra = [1]; numericExtra["4294967295"] = true;
    for (const value of [sparse, replacedHole, extra, numericExtra]) {
      expect(observe(value)).toEqual({ $tag: "SnapshotUnreadable" });
      expect(() => equalityCopy(value)).toThrow();
    }
    expect(() => snapshot(sparse, "default fixture")).toThrow("sparse array slot");
    expect(() => snapshot(extra, "default fixture")).toThrow("non-index array property");
  });

  test("nonstandard array prototypes cannot be normalized into readable lists", () => {
    class HostArray extends Array {}
    for (const value of [Object.setPrototypeOf([1], null), new HostArray(1, 2)]) {
      expect(observe(value)).toEqual({ $tag: "SnapshotUnreadable" });
      expect(observe(snapshot(value, "default fixture")).$tag).toBe("SnapshotArray");
      expect(() => equalityCopy(value)).toThrow("non-plain array prototype");
    }
  });

  test("Bytes remain copied native carriers with unchanged unreadable equality observations", () => {
    const value = new Uint8Array([1, 255, 0]);
    const copied = equalityCopy(value), delivered = structuredClone(copied);
    expect(Object.getPrototypeOf(copied)).toBe(Uint8Array.prototype);
    expect(copied).toEqual(value);
    expect(copied).not.toBe(value);
    expect(copied.buffer).not.toBe(value.buffer);
    for (const current of [value, copied, delivered]) expect(observe(current)).toEqual({ $tag: "SnapshotUnreadable" });
    copied[0] = 9;
    expect(value[0]).toBe(1);
    value[Symbol("hidden bytes field")] = "retained only by the source";
    expect(() => equalityCopy(value)).toThrow("symbol properties");
    expect(snapshot(value, "default fixture")).toEqual(new Uint8Array([1, 255, 0]));
  });

  test("both modes retain strict refusals without executing accessor code", () => {
    let reads = 0;
    const accessor = {};
    Object.defineProperty(accessor, "value", { enumerable: true, get() { reads++; return "must not read"; } });
    const cycle = {}; cycle.self = cycle;
    const symbolic = { [Symbol("field")]: 1 };
    for (const mode of ["canonical", "equality"]) {
      for (const value of [accessor, cycle, symbolic, { fn() {} }, { value: Symbol("value") }, new Map(), new Date()]) {
        expect(() => snapshot(value, "strict fixture", mode)).toThrow();
      }
    }
    expect(reads).toBe(0);
  });

  test("no numeric or container-size policy is added at the host copy", () => {
    const values = [undefined, null, true, false, "", -0, NaN, Infinity, -Infinity, 4n];
    for (const value of values) {
      expect(Object.is(equalityCopy(value), value)).toBe(true);
      expect(observe(equalityCopy(value))).toEqual(observe(value));
    }
    const large = Array.from({ length: 4097 }, (_, index) => index);
    expect(equalityCopy(large)).toEqual(large);
    expect(observe(large)).toEqual({ $tag: "SnapshotUnreadable" });
    expect(observe(equalityCopy(large))).toEqual(observe(large));
  });
});
