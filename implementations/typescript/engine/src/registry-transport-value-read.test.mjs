import { describe, expect, test } from "bun:test";
import { captureRegistryTransportKey, captureRegistryTransportObservation, captureRegistryTransportRoundTrip, exactTransportKey } from "./registry-transport";
import { censusSourceAcquisitions } from "../scripts/lib/compiled-artifact-acquisition";
import { repositoryRelativePath } from "../scripts/lib/artifact-bytes";

// C1/B3: run the actual native transport boundary without loading a registry.
// These controls copy native data slots; they do not format dates or decide
// Fenel membership, equality, capabilities or presentation.
const source = await Bun.file(new URL("./registry-transport.ts", import.meta.url)).text();
const start = source.indexOf("export function registryTransportSnapshot<");
const end = source.indexOf("/** An injective text encoding of a transport value,", start);
if (start < 0 || end < start) throw new Error("The value-read transport boundary moved.");
const code = new Bun.Transpiler({ loader: "ts" }).transformSync(source.slice(start, end)).replace(/^export /gm, "");
const snapshot = new Function(`${code}; return registryTransportSnapshot;`)();
const copy = (value, bridge) => snapshot(value, "value-read fixture", "value-read", bridge);
const own = (value, key, descriptor) => Object.defineProperty(value, key, { configurable: true, ...descriptor });
const typedArrays = [Int8Array, Uint8Array, Uint8ClampedArray, Int16Array, Uint16Array, Int32Array, Uint32Array,
  Float32Array, Float64Array, BigInt64Array, BigUint64Array,
  ...(typeof globalThis.Float16Array === "function" ? [globalThis.Float16Array] : [])];
const viewBytes = value => [...new Uint8Array(value.buffer, value.byteOffset, value.byteLength)];

describe("captured registry transport keys", () => {
  const keyed = value => captureRegistryTransportKey(value, "reader key fixture", "value-read", Reflect.get);

  test("the existing signature key grammar retains its distinctions and refusals", () => {
    expect(exactTransportKey({ value: NaN })).not.toBe(exactTransportKey({ value: null }));
    expect(exactTransportKey([-0])).not.toBe(exactTransportKey([0]));
    expect(exactTransportKey({ value: undefined })).not.toBe(exactTransportKey({}));
    for (const value of [1n, new Date(0), Uint8Array.of(1), new Map()]) expect(exactTransportKey(value)).toBeUndefined();
  });

  test("every admitted primitive and native kind keeps a separate key", () => {
    const buffer = new ArrayBuffer(16);
    const values = [undefined, null, false, true, "", -0, 0, NaN, Infinity, -Infinity, 1n,
      new Date(0), new Date(NaN), buffer, ...typedArrays.map(Constructor => new Constructor(buffer)),
      new DataView(buffer), {}, { 0: 0 }];
    const keys = values.map(value => keyed(value).key);
    expect(new Set(keys).size).toBe(values.length);
    for (const value of values) expect(keyed(keyed(value).copy).key).toBe(keyed(value).key);
  });

  test("backing buffers, offsets and aliases remain part of the native key", () => {
    const buffer = Uint8Array.of(1, 2, 1, 2).buffer;
    const left = new Uint8Array(buffer, 0, 2), right = new Uint8Array(buffer, 2, 2);
    expect(keyed(left).key).not.toBe(keyed(right).key);
    expect(keyed({ left: buffer, right: buffer }).key)
      .not.toBe(keyed({ left: buffer, right: buffer.slice(0) }).key);
    expect(keyed({ left, right }).key)
      .not.toBe(keyed({ left, right: new Uint8Array(buffer.slice(0), 2, 2) }).key);
    const captured = keyed({ buffer, left, right });
    new Uint8Array(buffer)[0] = 9;
    expect(keyed(captured.copy).key).toBe(captured.key);
    expect(keyed({ buffer, left, right }).key).not.toBe(captured.key);
  });
});

describe("value-read native registry transport", () => {
  test("the native transport source remains import-free and passes artifact acquisition", () => {
    const census = censusSourceAcquisitions(repositoryRelativePath("implementations/typescript/engine/src/registry-transport.ts"), source);
    expect(census.acquisitions).toEqual([]);
    expect(census.hostSensitiveOperations).toEqual([]);
  });

  test("hosts without Float16Array retain the other native carriers", () => {
    const withoutFloat16 = new Function("Float16Array", `${code}; return registryTransportSnapshot;`)(undefined);
    const buffer = new ArrayBuffer(16), view = new Float32Array(buffer, 4, 2);
    view.set([1.5, -2.75]);
    const result = withoutFloat16({ buffer, view, date: new Date(7) }, "no Float16 fixture", "value-read");
    expect(result.view).toBeInstanceOf(Float32Array);
    expect([...result.view]).toEqual([1.5, -2.75]);
    expect(result.view.byteOffset).toBe(4);
    expect(result.view.buffer).toBe(result.buffer);
    expect(result.buffer).not.toBe(buffer);
    expect(result.date.getTime()).toBe(7);
    if (typeof Float16Array === "function") {
      const half = new Float16Array([1.5, -2.75]);
      expect(copy(half)).toBeInstanceOf(Float16Array);
      expect([...copy(half)]).toEqual([...half]);
      expect(() => withoutFloat16(half, "no Float16 fixture", "value-read")).toThrow("non-plain transport object");
    }
  });

  test("Date leaves retain exact native prototypes, values, invalid state and aliases without JSON conversion", () => {
    for (const timestamp of [0, -1, 1700000000000, NaN]) {
      const date = new Date(timestamp), value = { second: date, first: date, nested: [date] };
      const copied = copy(value), delivered = structuredClone(copied);
      for (const packet of [copied, delivered]) {
        expect(Object.keys(packet)).toEqual(["second", "first", "nested"]);
        expect(Object.getPrototypeOf(packet.first)).toBe(Date.prototype);
        expect(Object.is(Date.prototype.getTime.call(packet.first), timestamp)).toBe(true);
        expect(packet.first).not.toBe(date);
      }
      expect(copied.first).toBe(copied.second);
      expect(copied.first).toBe(copied.nested[0]);
      // Bun 1.3's structuredClone duplicates repeated Date references. The
      // actual copier's alias contract is asserted above; this host-delivery
      // control checks native kind/value without normalizing around that bug.
      if (!Number.isNaN(timestamp)) copied.first.setTime(timestamp + 12);
      expect(Object.is(Date.prototype.getTime.call(date), timestamp)).toBe(true);
    }
  });

  test("ArrayBuffer leaves keep bytes, zero-length data, shared references and isolation", () => {
    for (const data of [[], [0, 255, 17, 3]]) {
      const buffer = Uint8Array.from(data).buffer;
      const copied = copy({ second: buffer, first: buffer, nested: [buffer] });
      const delivered = structuredClone(copied);
      for (const packet of [copied, delivered]) {
        expect(Object.getPrototypeOf(packet.first)).toBe(ArrayBuffer.prototype);
        expect([...new Uint8Array(packet.first)]).toEqual(data);
        expect(packet.first).toBe(packet.second);
        expect(packet.first).toBe(packet.nested[0]);
        expect(packet.first).not.toBe(buffer);
      }
      if (data.length) new Uint8Array(copied.first)[0] = 8;
      expect([...new Uint8Array(buffer)]).toEqual(data);
    }
  });

  test("default and explicit canonical/equality modes still reject both new native leaf categories", () => {
    for (const value of [new Date(0), new Date(NaN), new ArrayBuffer(0), new ArrayBuffer(3)]) {
      expect(() => snapshot(value, "default fixture")).toThrow("non-plain transport object");
      for (const mode of ["canonical", "equality"])
        expect(() => snapshot(value, "strict fixture", mode)).toThrow("non-plain transport object");
    }
    expect(Object.keys(snapshot({ z: 1, a: 2 }, "canonical fixture"))).toEqual(["a", "z"]);
    expect(Object.keys(copy({ z: 1, a: 2 }))).toEqual(["z", "a"]);
  });

  test("value-read retains existing primitive and Uint8Array carriers without numeric normalization", () => {
    const values = [undefined, null, true, false, "", -0, NaN, Infinity, -Infinity, 12345678901234567890n];
    for (const mode of ["canonical", "equality", "value-read"])
      for (const value of values) expect(Object.is(snapshot(value, "primitive fixture", mode), value)).toBe(true);
    const bytes = Uint8Array.of(0, 255, 4);
    for (const mode of ["canonical", "equality", "value-read"]) {
      const copied = snapshot({ first: bytes, second: bytes }, "Bytes fixture", mode);
      expect(copied.first).toBe(copied.second);
      expect(copied.first).not.toBe(bytes);
      expect(Object.getPrototypeOf(copied.first)).toBe(Uint8Array.prototype);
      expect([...copied.first]).toEqual([0, 255, 4]);
      expect(copied.first.buffer).not.toBe(bytes.buffer);
    }
  });

  test("every exact standard binary view retains its native type, byte window and backing aliases", () => {
    for (const Constructor of [...typedArrays, DataView]) {
      const buffer = new ArrayBuffer(48), bytes = new Uint8Array(buffer);
      for (let index = 0; index < bytes.length; index++) bytes[index] = index * 5;
      const width = Constructor === DataView ? 1 : Constructor.BYTES_PER_ELEMENT;
      const view = new Constructor(buffer, width * 2, Constructor === DataView ? 13 : 3);
      const overlapping = new Uint8Array(buffer, width * 2 + 1, 2);
      for (const input of [{ view, same: view, overlapping, buffer }, { buffer, overlapping, view, same: view }]) {
        const copied = copy(input), delivered = structuredClone(copied);
        for (const packet of [copied, delivered]) {
          expect(Object.getPrototypeOf(packet.view)).toBe(Constructor.prototype);
          expect(packet.view).toBe(packet.same);
          expect(packet.view.buffer).toBe(packet.buffer);
          expect(packet.overlapping.buffer).toBe(packet.buffer);
          expect(packet.view.byteOffset).toBe(view.byteOffset);
          expect(packet.view.byteLength).toBe(view.byteLength);
          expect(viewBytes(packet.view)).toEqual(viewBytes(view));
          expect(packet.buffer).not.toBe(buffer);
        }
        new Uint8Array(copied.buffer)[view.byteOffset] = 0;
        expect(bytes[view.byteOffset]).toBe(view.byteOffset * 5);
      }
      if (Constructor !== Uint8Array) for (const mode of ["canonical", "equality"])
        expect(() => snapshot(view, "strict binary fixture", mode)).toThrow("non-plain transport object");
    }
  });

  test("resizable ArrayBuffers retain intrinsic capacity and shared current view windows when supported", () => {
    const resizable = Object.getOwnPropertyDescriptor(ArrayBuffer.prototype, "resizable")?.get;
    const maxByteLength = Object.getOwnPropertyDescriptor(ArrayBuffer.prototype, "maxByteLength")?.get;
    if (!resizable || !maxByteLength) return;
    const buffer = new ArrayBuffer(16, { maxByteLength: 40 });
    new Uint8Array(buffer).fill(17);
    const view = new Uint16Array(buffer, 4, 3), data = new DataView(buffer, 2, 5);
    const copied = copy({ view, data, buffer, again: buffer });
    expect(resizable.call(copied.buffer)).toBe(true);
    expect(maxByteLength.call(copied.buffer)).toBe(40);
    expect(copied.buffer.byteLength).toBe(16);
    expect(copied.buffer).toBe(copied.again);
    expect(copied.view.buffer).toBe(copied.buffer);
    expect(copied.data.buffer).toBe(copied.buffer);
    expect(copied.view.byteOffset).toBe(4);
    expect(copied.view.length).toBe(3);
    expect(copied.data.byteOffset).toBe(2);
    expect(copied.data.byteLength).toBe(5);
    expect(viewBytes(copied.view)).toEqual(viewBytes(view));
    copied.buffer.resize(24);
    expect(buffer.byteLength).toBe(16);
    expect(copied.view.length).toBe(3);
    const fixed = copy(new ArrayBuffer(4));
    expect(resizable.call(fixed)).toBe(false);
    expect(maxByteLength.call(fixed)).toBe(4);
  });

  test("shared-backed native views remain independent fixed byte-window snapshots without admitting shared roots", () => {
    if (typeof SharedArrayBuffer !== "function") return;
    const buffer = new SharedArrayBuffer(48), bytes = new Uint8Array(buffer);
    for (let index = 0; index < bytes.length; index++) bytes[index] = index * 3;
    expect(() => copy(buffer)).toThrow("non-plain transport object");
    for (const Constructor of [...typedArrays, DataView]) {
      const width = Constructor === DataView ? 1 : Constructor.BYTES_PER_ELEMENT;
      const view = new Constructor(buffer, width, Constructor === DataView ? 9 : 2);
      const second = new Constructor(buffer, width, Constructor === DataView ? 9 : 2);
      const copied = copy({ view, same: view, second });
      expect(Object.getPrototypeOf(copied.view)).toBe(Constructor.prototype);
      expect(Object.getPrototypeOf(copied.view.buffer)).toBe(ArrayBuffer.prototype);
      expect(copied.view).toBe(copied.same);
      expect(copied.view.buffer).not.toBe(copied.second.buffer);
      expect(copied.view.byteOffset).toBe(0);
      expect(copied.view.byteLength).toBe(view.byteLength);
      expect(copied.view.buffer.byteLength).toBe(view.byteLength);
      expect(viewBytes(copied.view)).toEqual(viewBytes(view));
      new Uint8Array(copied.view.buffer)[0] = 0;
      expect(bytes[view.byteOffset]).toBe(view.byteOffset * 3);
    }
  });

  test("native subclasses, forged prototypes and detached buffers cannot be normalized into valid leaves", () => {
    class UserDate extends Date {}
    class UserBuffer extends ArrayBuffer {}
    for (const value of [new UserDate(0), new UserBuffer(3), Object.create(Date.prototype), Object.create(ArrayBuffer.prototype)])
      expect(() => copy(value)).toThrow();
    for (const size of [0, 4]) {
      const detached = new ArrayBuffer(size);
      structuredClone(detached, { transfer: [detached] });
      expect(() => copy(detached)).toThrow();
    }
    for (const Constructor of [...typedArrays, DataView]) {
      class UserView extends Constructor {}
      expect(() => copy(new UserView(new ArrayBuffer(24)))).toThrow();
      expect(() => copy(Object.create(Constructor.prototype))).toThrow();
      const buffer = new ArrayBuffer(24), view = new Constructor(buffer);
      structuredClone(buffer, { transfer: [buffer] });
      expect(() => copy(view)).toThrow();
    }
    for (const Constructor of typedArrays) {
      const other = Constructor === Uint8Array ? Int16Array : Uint8Array;
      const reparented = Object.setPrototypeOf(new Constructor(new ArrayBuffer(24)), other.prototype);
      expect(() => copy(reparented)).toThrow("binary view kind");
    }
    if (typeof SharedArrayBuffer === "function") {
      const buffer = Object.setPrototypeOf(new ArrayBuffer(24), SharedArrayBuffer.prototype);
      expect(() => copy(new Uint8Array(buffer))).toThrow();
    }
  });

  test("out-of-bounds resizable views refuse instead of becoming valid empty windows", () => {
    if (!Object.getOwnPropertyDescriptor(ArrayBuffer.prototype, "resizable")?.get) return;
    for (const Constructor of [...typedArrays, DataView]) {
      const width = Constructor === DataView ? 1 : Constructor.BYTES_PER_ELEMENT;
      const buffer = new ArrayBuffer(width * 5, { maxByteLength: width * 8 });
      const view = new Constructor(buffer, width, 2);
      buffer.resize(0);
      expect(() => copy(view)).toThrow();
    }
  });

  test("all native own keys refuse before getters, user methods or the reactive bridge can run", () => {
    let calls = 0;
    const user = () => { calls++; throw new Error("Native user code must not run"); };
    const bridge = () => { calls++; throw new Error("Native properties must not be observed"); };
    for (const make of [() => new Date(0), () => new ArrayBuffer(3)]) {
      for (const key of ["extra", "constructor", "toJSON", "valueOf", "getTime", "slice", Symbol.toPrimitive, Symbol("native")]) {
        for (const descriptor of [{ value: user, enumerable: true }, { value: "hidden", enumerable: false }, { get: user, enumerable: true }]) {
          expect(() => copy(own(make(), key, descriptor), bridge)).toThrow("native leaves cannot carry own properties");
          expect(calls).toBe(0);
        }
      }
    }
  });

  test("captured native intrinsics never dispatch overridden prototype methods or ArrayBuffer species", () => {
    const date = new Date(42), buffer = Uint8Array.of(5, 2).buffer;
    const originalTime = Date.prototype.getTime, originalSlice = ArrayBuffer.prototype.slice;
    const constructor = Object.getOwnPropertyDescriptor(ArrayBuffer.prototype, "constructor");
    const species = Object.getOwnPropertyDescriptor(ArrayBuffer, Symbol.species);
    let calls = 0;
    const user = () => { calls++; throw new Error("Overridden native projection must not run"); };
    try {
      Date.prototype.getTime = user;
      ArrayBuffer.prototype.slice = user;
      own(ArrayBuffer.prototype, "constructor", { get: user });
      own(ArrayBuffer, Symbol.species, { get: user });
      const copiedDate = copy(date), copiedBuffer = copy(buffer);
      expect(originalTime.call(copiedDate)).toBe(42);
      expect([...new Uint8Array(copiedBuffer)]).toEqual([5, 2]);
      expect(calls).toBe(0);
    } finally {
      Date.prototype.getTime = originalTime;
      ArrayBuffer.prototype.slice = originalSlice;
      Object.defineProperty(ArrayBuffer.prototype, "constructor", constructor);
      Object.defineProperty(ArrayBuffer, Symbol.species, species);
    }
  });

  test("binary view own code and symbols refuse before native slot reads, and inherited overrides never run", () => {
    let calls = 0;
    const user = () => { calls++; throw new Error("Binary user code must not run"); };
    for (const Constructor of [...typedArrays, DataView]) {
      for (const key of ["extra", "constructor", "buffer", "byteOffset", "byteLength", "length", Symbol.iterator]) {
        for (const descriptor of [{ value: user, enumerable: true }, { value: "hidden", enumerable: false }, { get: user, enumerable: true }]) {
          const view = own(new Constructor(new ArrayBuffer(24)), key, descriptor);
          expect(() => copy(view)).toThrow("malformed value-read binary view");
          expect(calls).toBe(0);
        }
      }
    }
    const prototype = Object.getPrototypeOf(Uint8Array.prototype);
    const slots = Object.fromEntries(["buffer", "byteOffset", "byteLength", "length"].map(key => [key, Object.getOwnPropertyDescriptor(prototype, key)]));
    const set = Uint8Array.prototype.set;
    const input = new Int16Array(new ArrayBuffer(16), 2, 3);
    let copied;
    try {
      for (const key of Object.keys(slots)) own(prototype, key, { get: user });
      Uint8Array.prototype.set = user;
      copied = copy(input);
      expect(calls).toBe(0);
    } finally {
      for (const [key, descriptor] of Object.entries(slots)) Object.defineProperty(prototype, key, descriptor);
      Uint8Array.prototype.set = set;
    }
    expect(Object.getPrototypeOf(copied)).toBe(Int16Array.prototype);
    expect(copied.byteOffset).toBe(2);
    expect(copied.length).toBe(3);
  });

  test("native leaves coexist with admitted live data reads while descriptor refusals remain strict", () => {
    const value = { z: new Date(7), a: new ArrayBuffer(2) }, reads = [];
    const copied = copy(value, (owner, key) => { reads.push({ owner, key }); return Reflect.get(owner, key); });
    expect(reads.map(row => row.key)).toEqual(["z", "a"]);
    expect(reads.every(row => row.owner === value)).toBe(true);
    expect(Date.prototype.getTime.call(copied.z)).toBe(7);
    expect(copied.a.byteLength).toBe(2);
    let getterCalls = 0;
    const unreadable = own({ date: new Date(7) }, "hidden", { get() { getterCalls++; return 1; } });
    expect(() => copy(unreadable, Reflect.get)).toThrow("accessor property");
    expect(getterCalls).toBe(0);
    expect(() => copy(own({}, "hidden", { value: 1 }), Reflect.get)).toThrow("non-enumerable");
    expect(() => copy({ [Symbol("field")]: 1 })).toThrow("symbol properties");
    const cycle = {}; cycle.self = cycle;
    expect(() => copy(cycle)).toThrow("cyclic transport");
    expect(() => copy({ method() {} })).toThrow("executable transport");
    const native = new Date(8), nestedReads = [];
    const nested = copy({ values: [native, native] }, (owner, key) => { nestedReads.push(key); return Reflect.get(owner, key); });
    expect(nested.values[0]).toBe(nested.values[1]);
    expect(nestedReads).toEqual(["values", "length", "0", "1"]);
  });
});

// B3/C2: exercise host correspondence through this host's native clone only.
// Actual browser Worker serialization and caller lifetime/publication fences
// need their own integration evidence; these controls run no Fenel policy.
describe("request-local registry transport graph correspondence", () => {
  const capture = input => {
    const captured = captureRegistryTransportRoundTrip(input, "graph fixture");
    expect(captured.kind).toBe("captured");
    return captured;
  };
  const roundTrip = (input, operation) => {
    const captured = capture(input);
    try {
      const request = structuredClone(captured.wire);
      // One clone of both roots is essential: cloning them independently loses
      // the correspondence between returned input and retained result nodes.
      const response = structuredClone({ request, packet: operation(request) });
      const result = captured.reattach(response.request, response.packet);
      captured.assertCurrent();
      return result;
    } finally { captured.release(); }
  };

  test("layout edits retain unchanged branches and command-owned replacement identities", () => {
    const input = { state: { revision: 1, values: [{ row: { nested: { unchanged: true } } }], layout: { x: 1 } },
      commands: [{ layout: { x: 2 } }] };
    const result = roundTrip(input, request => ({ state: { ...request.state, revision: 2, layout: request.commands[0].layout } }));
    expect(result.state).not.toBe(input.state);
    expect(result.state.values).toBe(input.state.values);
    expect(result.state.values[0].row.nested).toBe(input.state.values[0].row.nested);
    expect(result.state.layout).toBe(input.commands[0].layout);
    expect(input.state.revision).toBe(1);
  });

  test("nested edits retain siblings and distinguish real aliases from equal distinct objects", () => {
    const shared = { same: true }, left = { same: true }, right = { same: true };
    const input = { state: { a: shared, b: shared, left, right }, commands: [{ value: shared }] };
    const result = roundTrip(input, request => ({ state: { ...request.state, left: request.commands[0].value },
      all: [request.state.a, request.state.b, request.state.left, request.state.right, request.commands[0].value], fresh: { same: true } }));
    expect(result.state).not.toBe(input.state);
    expect(result.state.left).toBe(shared);
    expect(result.state.right).toBe(right);
    expect(result.all).toEqual([shared, shared, left, right, shared]);
    for (const index of [0, 1, 4]) expect(result.all[index]).toBe(shared);
    expect(result.all[2]).toBe(left);
    expect(result.all[3]).toBe(right);
    expect(result.all[2]).not.toBe(result.all[3]);
    for (const original of [shared, left, right]) expect(result.fresh).not.toBe(original);
  });

  test("fresh result aliases are copied once without writing original or returned input objects", () => {
    const original = Object.freeze({ nested: Object.freeze({ value: 1 }) });
    const captured = capture({ original });
    try {
      const request = structuredClone(captured.wire);
      const fresh = Object.freeze({ retained: request.original.nested });
      const packet = Object.freeze({ left: fresh, right: fresh });
      const result = captured.reattach(request, packet);
      expect(result.left).toBe(result.right);
      expect(result.left).not.toBe(fresh);
      expect(result.left.retained).toBe(original.nested);
      expect(fresh.retained).toBe(request.original.nested);
      expect(fresh.retained).not.toBe(original.nested);
      expect(Object.isFrozen(original)).toBe(true);
      expect(original.nested.value).toBe(1);
    } finally { captured.release(); }
  });

  test("null prototypes, frozen descriptors and own __proto__ data restore the exact original", () => {
    const original = Object.create(null);
    Object.defineProperty(original, "__proto__", { value: Object.freeze({ payload: true }), enumerable: true });
    Object.defineProperty(original, "readonly", { value: -0, enumerable: true });
    Object.freeze(original);
    const result = roundTrip({ original }, request => ({ same: request.original, child: request.original.__proto__ }));
    expect(result.same).toBe(original);
    expect(Object.getPrototypeOf(result.same)).toBeNull();
    expect(result.child).toBe(original.__proto__);
    expect(Object.getOwnPropertyDescriptor(result.same, "readonly").writable).toBe(false);
  });

  test("wire mutation cannot alter private slot or byte observations", () => {
    const input = { value: { n: 1 }, buffer: Uint8Array.of(1, 2).buffer }, captured = capture(input);
    captured.wire.value.n = 2;
    new Uint8Array(captured.wire.buffer)[0] = 9;
    const request = structuredClone(captured.wire);
    expect(() => captured.reattach(request, { value: request.value })).toThrow();
    expect(() => captured.assertCurrent()).toThrow("released");
    expect(input.value.n).toBe(1);
    expect([...new Uint8Array(input.buffer)]).toEqual([1, 2]);
    captured.release();
  });

  for (const [name, mutate] of [
    ["primitive", input => { input.child.value = 2; }],
    ["equal child replacement", input => { input.child = { value: 1 }; }],
    ["alias split", input => { input.alias = { value: 1 }; }],
    ["own-key order", input => { const child = input.child; delete input.child; input.child = child; }],
    ["prototype", input => Object.setPrototypeOf(input.child, null)],
    ["writable descriptor", input => Object.defineProperty(input.child, "value", { writable: false })],
    ["configurable descriptor", input => Object.defineProperty(input.child, "value", { configurable: false })],
    ["accessor descriptor", input => Object.defineProperty(input.child, "value", { get() { throw Error("must not invoke getter"); } })],
    ["hidden slot", input => Object.defineProperty(input.child, "hidden", { value: 1 })],
    ["extensibility", input => Object.preventExtensions(input.child)],
  ]) test(`original ${name} mutation refuses and releases the proof`, () => {
    const child = { value: 1 }, input = { child, alias: child, tail: true }, captured = capture(input);
    const request = structuredClone(captured.wire);
    mutate(input);
    expect(() => captured.reattach(request, { kept: request.child })).toThrow();
    expect(() => captured.assertCurrent()).toThrow("released");
    captured.release();
  });

  for (const [name, mutate] of [
    ["NaN to null", input => { input.nan = null; }],
    ["negative zero to zero", input => { input.zero = 0; }],
    ["buffer bytes", input => { new Uint8Array(input.buffer)[0] = 9; }],
  ]) test(`original ${name} mutation refuses`, () => {
    const input = { nan: NaN, zero: -0, buffer: Uint8Array.of(1, 2).buffer }, captured = capture(input);
    const request = structuredClone(captured.wire);
    mutate(input);
    expect(() => captured.reattach(request, request)).toThrow();
    captured.release();
  });

  for (const [name, mutate] of [
    ["extra slot", request => { request.extra = true; }],
    ["missing slot", request => { delete request.right; }],
    ["collapsed distinct nodes", request => { request.right = request.left; }],
    ["split repeated alias", request => { request.alias = { value: 1 }; }],
    ["primitive", request => { request.zero = 0; }],
    ["own-key order", request => { const left = request.left; delete request.left; request.left = left; }],
    ["prototype", request => Object.setPrototypeOf(request.left, null)],
    ["descriptor", request => Object.defineProperty(request.left, "value", { writable: false })],
    ["accessor", request => Object.defineProperty(request.left, "value", { get() { throw Error("must not invoke getter"); } })],
    ["native bytes", request => { new Uint8Array(request.buffer)[1] = 9; }],
  ]) test(`malformed returned graph ${name} refuses and releases the proof`, () => {
    const left = { value: 1 }, input = { left, right: { value: 1 }, alias: left, zero: -0, buffer: Uint8Array.of(1, 2).buffer };
    const captured = capture(input), request = structuredClone(captured.wire);
    mutate(request);
    expect(() => captured.reattach(request, {})).toThrow();
    expect(() => captured.assertCurrent()).toThrow("released");
    expect(input.right.value).toBe(1);
    expect(input.alias).toBe(input.left);
    captured.release();
  });

  test("binary views restore native type, offset and shared backing identities", () => {
    const buffer = Uint8Array.of(1, 2, 3, 4, 5, 6, 7, 8).buffer;
    const input = { buffer, bytes: new Uint8Array(buffer, 2, 4), data: new DataView(buffer, 1, 6), wide: new Uint16Array(buffer, 2, 2) };
    const result = roundTrip(input, request => ({ all: [request.buffer, request.bytes, request.data, request.wide] }));
    for (const [index, key] of ["buffer", "bytes", "data", "wide"].entries()) expect(result.all[index]).toBe(input[key]);
    expect(result.all[1].buffer).toBe(buffer);
    expect(result.all[2].byteOffset).toBe(1);
    expect(result.all[3].byteOffset).toBe(2);
  });

  test("all host standard typed arrays retain input identity", () => {
    for (const Constructor of typedArrays) {
      const buffer = new ArrayBuffer(32), view = new Constructor(buffer, 8, 2), input = { buffer, view };
      const result = roundTrip(input, request => ({ view: request.view, buffer: request.buffer }));
      expect(result.view).toBe(view);
      expect(result.buffer).toBe(buffer);
    }
  });

  test("native Date stays initially unsupported while ordinary Fenel Date data remains admitted", () => {
    for (const date of [new Date(7), new Date(NaN)]) {
      const result = captureRegistryTransportRoundTrip({ first: date, second: date }, "Date fixture");
      expect(result.kind).toBe("unsupported");
      expect(result.reason).toMatch(/Date.*alias fidelity/);
    }
    for (const value of [{ $tag: "Date", _0: "2026-10-27" }, "2026-10-27", 1729980000000]) {
      const result = roundTrip({ value }, request => ({ value: request.value }));
      expect(result.value).toBe(value);
    }
  });

  test("unsupported initial carriers return reasons without evaluating accessors", () => {
    const cycle = {}; cycle.self = cycle;
    let getterCalls = 0;
    const accessor = { get value() { getterCalls++; return 1; } };
    const values = [new Map([["x", 1]]), new Set([1]), /x/g, new Array(2), cycle, accessor, { method() {} }, { [Symbol("field")]: 1 }];
    if (typeof SharedArrayBuffer === "function") values.push(new SharedArrayBuffer(8), new Uint8Array(new SharedArrayBuffer(8)));
    for (const value of values) {
      const result = captureRegistryTransportRoundTrip({ value }, "unsupported fixture");
      expect(result.kind).toBe("unsupported");
      expect(typeof result.reason).toBe("string");
      expect(result.reason.length).toBeGreaterThan(0);
    }
    expect(getterCalls).toBe(0);
  });

  test("release is idempotent and successful reattachment is single-use", () => {
    const input = { child: { value: 1 } }, captured = capture(input), request = structuredClone(captured.wire);
    expect(captured.reattach(request, { child: request.child }).child).toBe(input.child);
    captured.assertCurrent();
    expect(() => captured.reattach(request, {})).toThrow("consumed");
    captured.release();
    captured.release();
    expect(() => captured.reattach(request, {})).toThrow("released");
    expect(() => captured.assertCurrent()).toThrow("released");
    const unused = capture({ value: 1 });
    unused.release();
    unused.release();
    expect(() => unused.assertCurrent()).toThrow("released");
  });

  test("deep original mutation after reattachment refuses before publication", () => {
    const input = { child: { value: 1 } }, captured = capture(input), request = structuredClone(captured.wire);
    captured.reattach(request, { child: request.child });
    captured.assertCurrent();
    input.child.value = 2;
    expect(() => captured.assertCurrent()).toThrow("changed");
    expect(() => captured.assertCurrent()).toThrow("released");
    captured.release();
  });

  test("unsupported admitted result data throws and releases instead of returning initial compatibility", () => {
    const captured = capture({ value: 1 }), request = structuredClone(captured.wire);
    expect(() => captured.reattach(request, { method() {} })).toThrow("executable transport");
    expect(() => captured.assertCurrent()).toThrow("released");
    captured.release();
  });
});

// B3/C2: the same private graph recorder can guard caller-owned copies without
// claiming native serializer alias fidelity or computing semantic equality.
describe("request-local registry transport original graph observations", () => {
  const capture = input => {
    const captured = captureRegistryTransportObservation(input, "observation fixture");
    expect(captured.kind).toBe("captured");
    return captured;
  };

  test("the observation exposes only currentness and release, with stable Date aliases and invalid dates", () => {
    const date = new Date(42), invalid = new Date(NaN), child = Object.freeze({ value: 1 });
    const input = Object.freeze({ first: date, second: date, invalid, child, alias: child });
    const captured = capture(input);
    try {
      expect(Reflect.ownKeys(captured)).toEqual(["kind", "assertCurrent", "release"]);
      captured.assertCurrent();
      // The copy is owned by this caller; its serializer need not preserve a
      // Date alias for this guard to prove the original graph is still current.
      const queued = copy(input);
      captured.assertCurrent();
      expect(queued.first).not.toBe(date);
      expect(queued.first).toBe(queued.second);
      expect(queued.child).toBe(queued.alias);
      expect(Number.isNaN(Date.prototype.getTime.call(queued.invalid))).toBe(true);
      queued.child.value = 2;
      queued.first.setTime(99);
      captured.assertCurrent();
      expect(date.getTime()).toBe(42);
    } finally { captured.release(); }
  });

  test("stable primitive roots and invalid native Date roots remain current", () => {
    for (const input of [undefined, null, true, "", -0, NaN, Infinity, 1n, new Date(NaN)]) {
      const captured = capture(input);
      try { captured.assertCurrent(); captured.assertCurrent(); }
      finally { captured.release(); }
    }
  });

  for (const [name, mutate] of [
    ["equal Date replacement", input => { input.date = new Date(42); }],
    ["equal plain child replacement", input => { input.child = { value: 1 }; }],
    ["Date alias split", input => { input.alias = new Date(42); }],
    ["Date time", input => { input.date.setTime(43); }],
    ["invalid Date becomes valid", input => { input.invalid.setTime(0); }],
    ["nested primitive", input => { input.child.value = 2; }],
    ["negative zero", input => { input.zero = 0; }],
    ["NaN", input => { input.nan = null; }],
    ["own-key order", input => { const child = input.child; delete input.child; input.child = child; }],
    ["child prototype", input => Object.setPrototypeOf(input.child, null)],
    ["Date prototype", input => Object.setPrototypeOf(input.date, null)],
    ["writable descriptor", input => Object.defineProperty(input.child, "value", { writable: false })],
    ["enumerable descriptor", input => Object.defineProperty(input.child, "value", { enumerable: false })],
    ["configurable descriptor", input => Object.defineProperty(input.child, "value", { configurable: false })],
    ["hidden slot", input => Object.defineProperty(input.child, "hidden", { value: 1 })],
    ["Date own slot", input => Object.defineProperty(input.date, "hidden", { value: 1 })],
    ["child extensibility", input => Object.preventExtensions(input.child)],
    ["Date extensibility", input => Object.preventExtensions(input.date)],
  ]) test(`original ${name} mutation refuses and releases observations`, () => {
    const date = new Date(42), input = { date, alias: date, invalid: new Date(NaN), child: { value: 1 }, zero: -0, nan: NaN };
    const captured = capture(input);
    captured.assertCurrent();
    mutate(input);
    expect(() => captured.assertCurrent()).toThrow("changed");
    expect(() => captured.assertCurrent()).toThrow("released");
    captured.release();
  });

  test("descriptor changes refuse without invoking newly installed getters", () => {
    for (const key of ["child", "date"]) {
      const input = { child: { value: 1 }, date: new Date(42) }, captured = capture(input);
      let calls = 0;
      Object.defineProperty(input, key, { get() { calls++; throw new Error("must not run"); } });
      expect(() => captured.assertCurrent()).toThrow("descriptor changed");
      expect(calls).toBe(0);
      expect(() => captured.assertCurrent()).toThrow("released");
    }
  });

  test("Date currentness uses the captured intrinsic and retains frozen invalid Dates", () => {
    const date = Object.freeze(new Date(NaN)), input = { first: date, second: date };
    const getTime = Date.prototype.getTime;
    let calls = 0;
    try {
      Date.prototype.getTime = () => { calls++; throw new Error("overridden method must not run"); };
      const captured = capture(input);
      try {
        captured.assertCurrent();
        date.setTime(NaN);
        captured.assertCurrent();
        expect(calls).toBe(0);
        date.setTime(42);
        expect(() => captured.assertCurrent()).toThrow("Date time changed");
        expect(calls).toBe(0);
      } finally { captured.release(); }
    } finally { Date.prototype.getTime = getTime; }
  });

  test("binary aliases, standard windows and backing identities stay current", () => {
    for (const Constructor of [...typedArrays, DataView]) {
      const buffer = new ArrayBuffer(32), view = new Constructor(buffer, 8, 2);
      const input = { buffer, view, alias: view }, captured = capture(input);
      try {
        captured.assertCurrent();
        const queued = copy(input);
        captured.assertCurrent();
        expect(queued.view).toBe(queued.alias);
        expect(queued.view.buffer).toBe(queued.buffer);
        new Uint8Array(buffer)[0] = 1;
        expect(() => captured.assertCurrent()).toThrow("changed");
        expect(() => captured.assertCurrent()).toThrow("released");
      } finally { captured.release(); }
    }
  });

  test("equal binary replacement, detach and backing resize refuse", () => {
    for (const mutate of [
      input => { input.view = new Uint8Array(input.buffer); },
      input => { structuredClone(input.buffer, { transfer: [input.buffer] }); },
      ...(Object.getOwnPropertyDescriptor(ArrayBuffer.prototype, "resizable")?.get
        ? [input => { input.buffer.resize(4); }] : []),
    ]) {
      const buffer = new ArrayBuffer(8, { maxByteLength: 16 }), input = { buffer, view: new Uint8Array(buffer) };
      const captured = capture(input);
      mutate(input);
      expect(() => captured.assertCurrent()).toThrow();
      expect(() => captured.assertCurrent()).toThrow("released");
      captured.release();
    }
  });

  test("unsupported initial carriers stay unsupported without evaluating getters", () => {
    let calls = 0;
    const accessor = { get value() { calls++; throw new Error("must not run"); } };
    const dateAccessor = own(new Date(42), "getTime", { get() { calls++; throw new Error("must not run"); } });
    const cycle = {}; cycle.self = cycle;
    class CustomDate extends Date {}
    const values = [new Map(), new Set(), /x/g, new CustomDate(42), Object.create({}),
      Object.create(Date.prototype), new Proxy(new Date(42), {}), new Array(2), cycle,
      accessor, dateAccessor, own(new Date(42), "hidden", { value: 1 }), { method() {} }, { [Symbol("field")]: 1 }];
    if (typeof File === "function") values.push(new File(["data"], "fixture.txt"));
    if (typeof SharedArrayBuffer === "function") {
      const shared = new SharedArrayBuffer(8);
      values.push(shared, new Uint8Array(shared), new DataView(shared));
    }
    for (const value of values) {
      const captured = captureRegistryTransportObservation({ value }, "unsupported observation fixture");
      expect(captured.kind).toBe("unsupported");
      expect(typeof captured.reason).toBe("string");
      expect(captured.reason.length).toBeGreaterThan(0);
    }
    expect(calls).toBe(0);
  });

  test("release is idempotent and refuses further graph reads", () => {
    const captured = capture({ date: new Date(42), child: { value: 1 } });
    captured.assertCurrent();
    captured.release();
    captured.release();
    expect(() => captured.assertCurrent()).toThrow("released");
  });
});
