import { beforeAll, describe, expect, test } from "bun:test";
import { invokeSelfHostSourceBody } from "../src/self-host-body-oracle";
import { evaluate, invokeCallable, type EvaluateContext, type TypeclassDictFrame } from "../src/json-logic";
import { createEngineBootstrapRegistry } from "../src/registry";
import { stdModule } from "../src/modules/std";
import { pictureModule, sampleNative } from "../src/modules/picture";
import { algebraModule } from "../src/modules/algebra";
import { compileCallBindingsByFnId } from "../src/compile-call-bindings";
import { loadFenelModule } from "../src/fenel-module";
import type { FenelFunction } from "../src/types";

// C2 actual-source oracle controls. No image algorithm, comparator, resolver
// or source body is replaced; the adapter only transports existing metadata.
let context: EvaluateContext;
let over: FenelFunction;
beforeAll(() => {
  const registry = createEngineBootstrapRegistry([stdModule, pictureModule]);
  context = registry.evaluateContext();
  over = pictureModule.functions!.find(fn => fn.id === "picture:over")!;
}, 120_000);

const top = { $tag: "Raster", _0: { width: 1, height: 1, pixels: [{ r: 255, g: 0, b: 0, a: 255 }] } };
const bottom = { $tag: "Raster", _0: { width: 1, height: 1, pixels: [{ r: 0, g: 255, b: 0, a: 255 }] } };
const point = { $tag: "Point", x: 0, y: 0 };
const red = { r: 255, g: 0, b: 0, a: 255 };
type Field = { $tag: string; _0: { lexicalImports?: unknown; sourceFunction?: string } };

describe("self-host source-body oracle metadata transport", () => {
  test("actual picture body keeps its captured lexical names and matches canonical source invocation", () => {
    const detached = evaluate(over.body, { top, bot: bottom }, context) as Field;
    expect(invokeCallable(detached._0, [point], context)).toEqual({ r: 0, g: 0, b: 0, a: 0 });
    const named = invokeCallable({ $ref: over.id }, [top, bottom], context) as Field;
    const observed = invokeSelfHostSourceBody(over, [top, bottom], context) as Field;
    expect(observed.$tag).toBe("Field");
    expect(observed._0.lexicalImports).toEqual(named._0.lexicalImports);
    expect(invokeCallable(observed._0, [point], context)).toEqual(red);
    expect(invokeCallable(named._0, [point], context)).toEqual(red);
  });

  test("captured source names outrank caller names while live dictionary and authority remain at invocation", () => {
    const originalStack = [{ names: { sample: "missing:callerSample" }, aliases: {} }];
    const creationFrames: TypeclassDictFrame[] = [{ typeName: "OracleCreationFrame", args: [], methods: {} }];
    const caller: EvaluateContext = { ...context, _importStack: originalStack, _dictStack: creationFrames };
    const field = invokeSelfHostSourceBody(over, [top, bottom], caller) as Field;
    expect(field._0.sourceFunction).toBe(over.id);
    expect(Object.keys(field._0)).not.toContain("_authority");
    expect(Object.keys(field._0)).not.toContain("_dictStack");
    expect(caller._importStack).toBe(originalStack);
    const invocationContext = createEngineBootstrapRegistry([stdModule, pictureModule]).evaluateContext();
    const invocationFrames: TypeclassDictFrame[] = [{ typeName: "OracleInvocationFrame", args: [], methods: {} }];
    const seen: EvaluateContext[] = [];
    const live: EvaluateContext = { ...invocationContext, _dictStack: invocationFrames,
      nativesCtx: { ...invocationContext.nativesCtx,
        "picture:sample": (received, picture, coordinate) => {
          seen.push(received);
          return sampleNative(received, picture, coordinate);
        },
      },
    };
    expect(live._authority).toBeDefined();
    expect(invokeCallable(field._0, [point], live)).toEqual(red);
    expect(seen).toHaveLength(2);
    for (const received of seen) {
      expect(received._dictStack).toBe(invocationFrames);
      expect(received._authority).toBe(live._authority);
    }
    expect(live._dictStack).toBe(invocationFrames);
    expect(caller._dictStack).toBe(creationFrames);
  });

  test("the reference uses the exact supplied Fenel body despite a native root shadow", () => {
    let nativeCalls = 0;
    const shadowed: EvaluateContext = { ...context, natives: { ...context.natives,
      [over.id]: () => { nativeCalls++; return "native root must not be the oracle"; },
    } };
    const observed = invokeSelfHostSourceBody(over, [top, bottom], shadowed) as Field;
    expect(invokeCallable(observed._0, [point], shadowed)).toEqual(red);
    expect(nativeCalls).toBe(0);
    expect(invokeSelfHostSourceBody({ ...over, body: 17 }, [top, bottom], shadowed)).toBe(17);
    expect(nativeCalls).toBe(0);
    expect(() => invokeSelfHostSourceBody({ ...over, body: undefined }, [top, bottom], shadowed)).toThrow("has no source body");
  });

  test("registered lexical data is retained and actual arguments shadow it through the canonical closure invoker", () => {
    const fn = loadFenelModule("module OracleBinding where\nvalue : Number -> Number\nvalue actual = actual + sourceValue\n", "OracleBinding")
      .functions!.find(fn => fn.id === "OracleBinding:value")!;
    const lexical = { actual: 999, sourceValue: 5 };
    const bound: EvaluateContext = { ...context,
      getFunctionLexicalData: id => id === fn.id ? lexical : context.getFunctionLexicalData?.(id),
    };
    expect(invokeSelfHostSourceBody(fn, [7], bound)).toBe(12);
    expect(lexical).toEqual({ actual: 999, sourceValue: 5 });
  });
});

test("actual JS and Wasm sampled picture bodies keep the strict source-versus-compiled comparison", async () => {
  const js = await import("../src/compile-js-self-host-classifier");
  const wasm = await import("../src/compile-wasm-self-host-classifier");
  const pictureIds = js.candidateFns.filter(fn => fn.id.startsWith("picture:") && js.FN_SAMPLES[fn.id]?.length)
    .map(fn => fn.id);
  expect(pictureIds).toContain("picture:over");
  expect(Object.keys(js.EXPECTED_GAPS)).toEqual([]);
  expect(Object.keys(wasm.EXPECTED_GAPS)).toEqual([]);
  for (const fnId of pictureIds) {
    const jsResult = js.classifyFnId(fnId);
    const wasmResult = await wasm.classifyFnId(fnId);
    expect({ fnId, target: "js", result: jsResult }).toMatchObject({ fnId, target: "js", result: { status: "OK" } });
    expect({ fnId, target: "wasm", result: wasmResult }).toMatchObject({ fnId, target: "wasm", result: { status: "OK" } });
  }
}, 300_000);

test("source-owned sequential example retains its exact local binding and original Vec result", async () => {
  const registry = createEngineBootstrapRegistry([stdModule, algebraModule]);
  const caller = registry.evaluateContext();
  const fn = algebraModule.functions!.find(fn => fn.id === "algebra:seqTakeTwo")!;
  const input = [10, 20, 30, 40];
  const expected = { "0": 10, "1": 20, $tag: "Vec" };
  expect(caller.getFunctionImportFrame?.(fn.id)?.names.take).toBe("algebra:take");
  expect(compileCallBindingsByFnId([algebraModule]).get(fn.id)?.take).toBe("algebra:take");
  expect(invokeCallable({ $ref: fn.id }, [input], caller)).toEqual(expected);
  expect(invokeSelfHostSourceBody(fn, [input], caller)).toEqual(expected);
  expect(input).toEqual([10, 20, 30, 40]);
  const js = await import("../src/compile-js-self-host-classifier");
  expect(js.FN_SAMPLES[fn.id]).toEqual([[input]]);
  expect(js.classifyFnId(fn.id)).toEqual({ status: "OK", samplesCompared: 1 });
  const localTake = js.candidateFns.find(fn => fn.id === "algebra:take");
  if (localTake === undefined) throw new Error("The source-owned algebra take must remain a compiler candidate");
  expect(js.runOne(localTake, [
    [0, []], [0, { $tag: "Vec" }],
    [2, input], [2, { "0": 10, "1": 20, "2": 30, "3": 40, $tag: "Vec" }],
  ])).toEqual({ status: "ok", fnId: "algebra:take", samples: 4 });
}, 300_000);

test("the separate global compiled dispatcher still selects the List instance", async () => {
  const js = await import("../src/compile-js-self-host-classifier");
  const dispatcher = js.compiledDispatcherFor("take");
  expect(typeof dispatcher).toBe("function");
  if (dispatcher === undefined) throw new Error("The global Sequential take dispatcher must remain installed");
  expect(dispatcher(2, [10, 20, 30, 40])).toEqual([10, 20]);
  expect(js.compiledDispatchTargetId("take", { $ref: "std.take" })).toBe("std:take");
}, 300_000);

test("source binding retention leaves original Bool and callback samples strict", async () => {
  const js = await import("../src/compile-js-self-host-classifier");
  const wasm = await import("../src/compile-wasm-self-host-classifier");
  for (const fnId of ["std:and", "std:or", "std:not", "std:ifElse", "std:$", "std:."]) {
    expect({ fnId, target: "js", result: js.classifyFnId(fnId) })
      .toMatchObject({ fnId, target: "js", result: { status: "OK" } });
    expect({ fnId, target: "wasm", result: await wasm.classifyFnId(fnId) })
      .toMatchObject({ fnId, target: "wasm", result: { status: "OK" } });
  }
}, 300_000);
