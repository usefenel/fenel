import { describe, expect, test } from "bun:test";
import { loadFenelModule } from "../src/fenel-module";
import { positionalCompileFieldSlots } from "../src/compile-field-slots";
import { compileFenelToWasmNative, serializeWasmModuleNative } from "../src/modules/compile-wasm";
import { buildFenelRuntime, classifyFnId, requireWasmStdConcatNative, rewireClosureHandles } from "../src/compile-wasm-self-host-classifier";
import { wasmLlvmBaseEngineContext } from "../src/self-host-wasm-llvm-bootstrap";

// C2/B3: exercise existing Wasm closure handles and exact owner-instance
// binding. Actual source bodies use the shipped Fenel compiler unchanged.
const source = loadFenelModule(`module ClosureOwner where
producer : Number -> (Number -> Number)
producer base = \\value -> base + value
borrower : (Number -> Number) -> Number -> Number
borrower callback value = callback value
pairProducer : Number -> (Number -> Number -> Number)
pairProducer base = \\first second -> base + first + second
concatLiteralTail : List Number -> List Number
concatLiteralTail values = concat values []
concatLiteralHead : List Number -> List Number
concatLiteralHead values = concat [] values
concatLiteralEmpty : Number -> List Number
concatLiteralEmpty ignored = concat [] []
`, "ClosureOwner");

type Handle = { __cl: string; env: unknown; __userFn?: (...args: unknown[]) => unknown };

async function instantiate(member: string, exportName = member) {
  const fn = source.functions?.find(fn => fn.id === `ClosureOwner:${member}`)!;
  const compiled = compileFenelToWasmNative({ name: exportName, params: positionalCompileFieldSlots(fn.params.map(param => param.name)), body: fn.body });
  if (compiled.$tag !== "Ok") throw new Error(JSON.stringify(compiled));
  const serialized = serializeWasmModuleNative(compiled._0);
  if (serialized.$tag !== "Ok") throw new Error(JSON.stringify(serialized));
  const runtime = buildFenelRuntime(compiled._0.stringPool ?? [], compiled._0);
  const { instance } = await WebAssembly.instantiate(serialized._0, { $fenel: runtime.rt as WebAssembly.ModuleImports });
  runtime.setInstance(instance);
  return { ...runtime, instance, fn: instance.exports[exportName] as (...args: unknown[]) => unknown };
}

describe("Wasm closure producing-instance ownership", () => {
  test("a closure passed directly into another compiled module retains its producer and captures", async () => {
    const producer = await instantiate("producer");
    const borrower = await instantiate("borrower");
    const handle = producer.fn(40) as Handle;
    expect(handle.__cl).toBe("producer__cl0");
    expect(typeof handle.__userFn).toBe("function");
    expect(borrower.instance.exports[handle.__cl]).toBeUndefined();
    expect(borrower.fn(handle, 2)).toBe(42);
    expect(borrower.fn(handle, -3)).toBe(37);
    expect((borrower.rt.callClosure_1 as (handle: Handle, value: number) => unknown)(handle, 10)).toBe(50);
  }, 180_000);

  test("same-named exports in another instance cannot replace the original producing instance", async () => {
    const first = await instantiate("producer");
    const second = await instantiate("producer");
    const env = [17];
    const handle = (first.rt.makeClosure as (name: string, env: unknown[]) => Handle)("producer__cl0", env);
    expect(handle.env).toBe(env);
    const fromSecond = second.fn(100) as Handle;
    const call = second.rt.callClosure_1 as (handle: Handle, value: number) => unknown;
    expect(call(handle, 2)).toBe(19);
    expect(call(fromSecond, 2)).toBe(102);
  }, 180_000);

  test("the existing multi-argument and host callback ABIs are preserved", async () => {
    const producer = await instantiate("pairProducer");
    const borrower = await instantiate("borrower");
    const handle = producer.fn(10) as Handle;
    expect((borrower.rt.callClosure_2 as (handle: Handle, first: number, second: number) => unknown)(handle, 2, 3)).toBe(15);
    expect(borrower.fn({ __userFn: (value: number) => value * 2 }, 4)).toBe(8);
  }, 180_000);

  test("helper-return rewiring preserves already-owned handles and cyclic original captures", async () => {
    const producer = await instantiate("producer");
    const frame = Object.freeze({ opaqueFrameMarker: Symbol("frame") });
    const env: unknown[] = [frame];
    env.push(env);
    const handle = (producer.rt.makeClosure as (name: string, env: unknown[]) => Handle)("producer__cl0", env);
    expect(rewireClosureHandles(handle, producer.instance)).toBe(handle);
    expect(handle.env).toBe(env);
    expect((handle.env as unknown[])[0]).toBe(frame);
    expect((handle.env as unknown[])[1]).toBe(env);
    const returned = rewireClosureHandles({ callback: handle }, producer.instance) as { callback: Handle };
    expect(returned.callback).toBe(handle);
    expect(returned.callback.env).toBe(env);
  }, 180_000);

  test("owned-handle rewiring never accepts accessor or inherited host callables", () => {
    const instance = { exports: {} } as WebAssembly.Instance;
    let reads = 0;
    const accessor = { __cl: "callback", env: [] };
    Object.defineProperty(accessor, "__userFn", { get() { reads++; return () => 0; } });
    expect(() => rewireClosureHandles(accessor, instance)).toThrow("callable must be own function data");
    expect(reads).toBe(0);
    const inherited = Object.assign(Object.create({ __userFn: () => 0 }), { __cl: "callback", env: [] });
    expect(() => rewireClosureHandles(inherited, instance)).toThrow("callable must be own function data");
  });

  test("unbound instances, absent/noncallable/inherited/accessor exports refuse at creation", () => {
    const { rt, setInstance } = buildFenelRuntime([]);
    const make = rt.makeClosure as (name: string, env: unknown[]) => Handle;
    expect(() => make("missing", [])).toThrow("producing instance not bound");
    let reads = 0;
    const exports = Object.assign(Object.create({ inherited: () => 0 }), { noncallable: 1 });
    Object.defineProperty(exports, "accessor", { get() { reads++; return () => 0; } });
    setInstance({ exports } as unknown as WebAssembly.Instance);
    for (const name of ["missing", "noncallable", "inherited", "accessor"]) {
      expect(() => make(name, [])).toThrow(`no callable export '${name}' on producing instance`);
    }
    expect(reads).toBe(0);
  });

  test("concat reuses the exact std representation leaf for lists, null ends, strings and mixed kinds", () => {
    const native = wasmLlvmBaseEngineContext.natives!["std:concat"]!;
    const concat = buildFenelRuntime([]).rt.concat as typeof native;
    expect(concat).toBe(native);
    const cases: readonly [unknown, unknown, unknown][] = [
      [null, null, []],
      [[], null, []],
      [null, [1], [1]],
      [[1], null, [1]],
      [[1], [2, 3], [1, 2, 3]],
      ["🦊$&", "𐐀$$", "🦊$&𐐀$$"],
      ["🦊", [1], [1]],
      [["$&"], "𐐀", ["$&"]],
    ];
    for (const [left, right, expected] of cases) {
      expect(concat(left, right)).toEqual(expected);
      expect(concat(left, right)).toEqual(native(left, right));
    }
  });

  test("concat refuses absent, noncallable, inherited and accessor std native slots", () => {
    const natives = wasmLlvmBaseEngineContext.natives!;
    const original = natives["std:concat"]!;
    let reads = 0;
    const hostile: (Readonly<Record<string, unknown>> | undefined)[] = [
      undefined,
      Object.freeze({}),
      Object.freeze({ "std:concat": 1 }),
      Object.freeze(Object.create(Object.freeze({ "std:concat": original }))),
      Object.freeze(Object.defineProperty({}, "std:concat", { get() { reads++; return original; } })),
    ];
    for (const table of hostile) {
      expect(() => requireWasmStdConcatNative(table)).toThrow("std:concat must be own function data");
    }
    expect(reads).toBe(0);
    expect(requireWasmStdConcatNative(Object.freeze({ "std:concat": original }))).toBe(original);
    expect(buildFenelRuntime([]).rt.concat).toBe(original);
  });

  test("actual source empty-list literals preserve the compiled concat ABI on either side", async () => {
    const tail = await instantiate("concatLiteralTail");
    const head = await instantiate("concatLiteralHead");
    const empty = await instantiate("concatLiteralEmpty");
    expect(tail.fn([1, 2])).toEqual([1, 2]);
    expect(head.fn([1, 2])).toEqual([1, 2]);
    expect(tail.fn([])).toEqual([]);
    expect(head.fn([])).toEqual([]);
    expect(empty.fn(0)).toEqual([]);
  }, 180_000);

  test("all nineteen actual normaliseToCore Wasm samples compare successfully", async () => {
    const result = await classifyFnId("engine:normaliseToCore");
    if (result.status === "FAIL" || result.status === "SKIP") throw new Error(result.reason.slice(-2_000));
    expect(result).toEqual({ status: "OK", samplesCompared: 19 });
  }, 600_000);
});
