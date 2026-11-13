import { describe, expect, test } from "bun:test";
import { fileURLToPath } from "node:url";
import { cloneRegistryTransportValue } from "./registry-transport";

// The strict registry copier's RECORD construction, observed in V8 (Chrome's
// engine, where the catalogue worker and the page run it). Bun runs JSC, which
// cannot answer "is this object in fast mode?", so this test runs the real
// `registry-transport.ts` (import-free) under node with natives syntax.
//
// It pins two facts at once, because each alone admits a wrong copier:
//   1. Every copied record is in V8 fast mode, frozen or not, and two frozen
//      copies of one key sequence share one map. `Object.create(null)` gives
//      dictionary-mode records; a `{}` detached with `setPrototypeOf(null)`
//      and restored is fast but gets a private map per frozen copy.
//   2. Inside the same V8 realm, a poisoned `Object.prototype` setter never
//      runs or intercepts a copy's own data, and a `__proto__` own data key
//      stays own data without re-parenting the copy. Plain assignment onto a
//      `{}` would be fast and fail this.
const transportUrl = new URL("./registry-transport.ts", import.meta.url).href;
const node = Bun.which("node");

const probe = `
const { cloneRegistryTransportValue: copy } = await import(${JSON.stringify(transportUrl)});
const isFast = new Function("o", "return %HasFastProperties(o)");
const sameMap = new Function("a", "b", "return %HaveSameMap(a, b)");
const shapes = [
  {},
  { $tag: "Nothing" },
  { call: ["add", 1, { var: "x" }] },
  { $tag: "ECall", _0: "std:add", _1: [{ $tag: "ELit", _0: 1 }] },
  Object.fromEntries(Array.from({ length: 16 }, (_, i) => ["k" + String(i).padStart(2, "0"), i])),
];
const records = [];
const collect = (v) => { if (v === null || typeof v !== "object") return;
  if (Array.isArray(v)) { v.forEach(collect); return; } records.push(v); for (const k of Object.keys(v)) collect(v[k]); };
const first = shapes.map((s, i) => copy(s, "shape " + i));
const second = shapes.map((s, i) => copy(s, "shape " + i));
first.forEach(collect);
const liveFast = records.every(isFast);
first.forEach(Object.freeze); second.forEach(Object.freeze);
const frozenFast = records.every(isFast);
const frozenShared = first.every((a, i) => sameMap(a, second[i]));
let intercepted = 0;
Object.defineProperty(Object.prototype, "fenelV8Probe", { configurable: true, get() { return undefined; },
  set(v) { intercepted += 1; Object.defineProperty(this, "fenelV8Probe", { value: v, writable: true, enumerable: true, configurable: true }); } });
const poisoned = { polluted: true };
const hostile = { safe: 1, fenelV8Probe: "sentinel" };
Object.defineProperty(hostile, "__proto__", { value: poisoned, writable: true, enumerable: true, configurable: true });
let hostileCopy;
try { hostileCopy = copy(hostile, "hostile"); } finally { delete Object.prototype.fenelV8Probe; }
const protoSlot = Object.getOwnPropertyDescriptor(hostileCopy, "__proto__");
console.log(JSON.stringify({
  records: records.length, liveFast, frozenFast, frozenShared,
  intercepted, probeOwn: Object.hasOwn(hostileCopy, "fenelV8Probe") && hostileCopy.fenelV8Probe === "sentinel",
  prototypeKept: Object.getPrototypeOf(hostileCopy) === Object.prototype,
  protoOwnData: protoSlot !== undefined && "value" in protoSlot && protoSlot.value !== poisoned && protoSlot.value.polluted === true,
  keys: Object.keys(hostileCopy), hostileFast: isFast(hostileCopy),
  nullPrototypeKept: Object.getPrototypeOf(copy(Object.create(null), "null record")) === null,
}));
`;

describe("registry transport records in V8", () => {
  test.skipIf(!node)("are fast-mode with shared frozen maps and keep the no-inherited-setter guarantee", () => {
    const run = Bun.spawnSync([node!, "--experimental-strip-types", "--no-warnings", "--allow-natives-syntax",
      "--input-type=module", "-e", probe], { cwd: fileURLToPath(new URL(".", import.meta.url)), stdout: "pipe", stderr: "pipe" });
    const stdout = run.stdout.toString().trim();
    if (run.exitCode !== 0) throw new Error(`node probe failed (${run.exitCode}): ${run.stderr.toString()}`);
    const observed = JSON.parse(stdout.split("\n").at(-1)!);
    expect(observed).toEqual({
      records: 7,
      liveFast: true,
      frozenFast: true,
      frozenShared: true,
      intercepted: 0,
      probeOwn: true,
      prototypeKept: true,
      protoOwnData: true,
      keys: ["__proto__", "fenelV8Probe", "safe"],
      hostileFast: true,
      nullPrototypeKept: true,
    });
  }, 60_000);
});

// The same construction guarantees, called directly in this (JSC) realm. The
// registry-level pins in `registry-accessor-safety.test.ts` § "registry
// transport clone construction" reach the copier through an instance's
// `methods.examples`, which no longer publishes there on dev (those tests fail
// before reaching the copier, with or without this construction), so these
// guard the copier itself.
describe("registry transport record construction", () => {
  test("an inherited Object.prototype setter never runs or intercepts a copied record's own data", () => {
    const probeKey = "fenelTransportDirectProbe";
    let intercepted = 0;
    Object.defineProperty(Object.prototype, probeKey, {
      configurable: true,
      get() { return undefined; },
      set(value: unknown) {
        intercepted += 1;
        Object.defineProperty(this as object, probeKey, { value, writable: true, enumerable: true, configurable: true });
      },
    });
    let copied: Record<string, unknown>;
    try {
      copied = cloneRegistryTransportValue({ [probeKey]: "sentinel", nested: { [probeKey]: 2 } }, "direct setter");
    } finally {
      delete (Object.prototype as Record<string, unknown>)[probeKey];
    }
    expect(intercepted).toBe(0);
    expect(Object.hasOwn(copied, probeKey)).toBe(true);
    expect(copied[probeKey]).toBe("sentinel");
    expect(Object.hasOwn(copied.nested as object, probeKey)).toBe(true);
    expect(Object.getPrototypeOf(copied)).toBe(Object.prototype);
  });

  test("a __proto__ own data key stays own data, never re-parents, and keys stay sorted", () => {
    const poisoned = { polluted: true };
    const source: Record<string, unknown> = { zeta: 1, alpha: [10, 20] };
    Object.defineProperty(source, "__proto__", { value: poisoned, writable: true, enumerable: true, configurable: true });
    const copied = cloneRegistryTransportValue(source, "direct proto key");
    expect(Object.getPrototypeOf(copied)).toBe(Object.prototype);
    const slot = Object.getOwnPropertyDescriptor(copied, "__proto__");
    expect(slot && "value" in slot).toBe(true);
    expect(slot!.value).toEqual({ polluted: true });
    expect(slot!.value).not.toBe(poisoned);
    expect(Object.getOwnPropertyDescriptor(copied, "alpha")).toEqual({ value: [10, 20], writable: true, enumerable: true, configurable: true });
    expect(Object.keys(copied)).toEqual(["__proto__", "alpha", "zeta"]);
    expect(({} as Record<string, unknown>).polluted).toBeUndefined();
  });

  test("a null-prototype source keeps a null-prototype copy; sharing is kept and cycles refuse", () => {
    const bare = Object.create(null) as Record<string, unknown>;
    bare.b = 2; bare.a = 1;
    const copied = cloneRegistryTransportValue(bare, "direct null record");
    expect(Object.getPrototypeOf(copied)).toBeNull();
    expect(Object.keys(copied)).toEqual(["a", "b"]);
    const shared = { s: 1 };
    const pair = cloneRegistryTransportValue({ first: shared, second: shared }, "direct sharing");
    expect(pair.first).toBe(pair.second);
    expect(pair.first).not.toBe(shared);
    const cyclic: Record<string, unknown> = { x: 1 };
    cyclic.self = cyclic;
    expect(() => cloneRegistryTransportValue(cyclic, "direct cycle")).toThrow("cyclic transport data is not allowed");
  });
});
