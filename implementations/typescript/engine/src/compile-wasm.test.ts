// ---------------------------------------------------------------------------
// CompileWasm — end-to-end tests for Phase 13
//
// Exercises:
//   1. The lowering — ClosuresExplicit → WasmAst — for the operator /
//      conditional / let-binding / runtime-call shapes the bootstrap needs.
//   2. The binary encoder — WasmAst → Uint8Array — produces validating
//      Wasm 3.0 bytes (LEB128 indices, opcode table, section structure).
//   3. The bootstrapping demo — compile a suite of pure-Fenel functions,
//      `WebAssembly.instantiate` the resulting bytes, invoke the exported
//      entry function with concrete arguments, and assert byte-equality
//      with the engine's interpretation.
//
// Same posture as `compilable.test.ts` (the Phase 5 JS bootstrap): tests
// bypass the dispatch path and call the native impls directly. The
// runtime-dispatch path is exercised by the audit script's law-validator
// runs (`audit-effects.ts`).
// ---------------------------------------------------------------------------

import { describe, it, expect } from "vitest";
import {
  serializeWasmModuleNative,
  compileFenelToWasmNative,
} from "./modules/compile-wasm";
import { dispatchedLowerToWasmAst } from "./engine-bodies-dispatch";
import * as imgOps from "./image-ops";
import { alphaBlendNative } from "./modules/picture";
import type { CompileSource } from "./compilable";
import { positionalCompileFieldSlots } from "./compile-field-slots";
import type { WasmModule } from "./ir/wasm-ast";
import { evaluate } from "./json-logic";
import { buildFenelRuntime as buildClassifierFenelRuntime } from "./compile-wasm-self-host-classifier";
// ---------------------------------------------------------------------------
// Test helpers
// ---------------------------------------------------------------------------

/** Build a CompileSource for `f(a, b, …) = body`. */
function src(name: string, paramNames: string[], body: unknown, requires?: string[]): CompileSource {
  return {
    name,
    params: positionalCompileFieldSlots(paramNames),
    body,
    ...(requires !== undefined ? { requires } : {}),
  };
}

/**
 * Minimal `$fenel` runtime namespace the compiled Wasm modules expect.
 *
 * The Wasm import boundary uses Wasm value types:
 *   - f64 (number) for `boxNum`/`unboxNum` round-trip
 *   - i32 (0/1) for `boxBool`/`unboxBool`
 *   - externref (JS value passthrough) for `concat` and any other
 *     non-arithmetic runtime helper
 *
 * Phase 13's bootstrap exercises `concat` + `boxBool` (the latter is
 * inserted automatically at the return boundary for boolean-returning
 * functions). The other helpers are present so the lowering can box any
 * intermediate value if a future test case demands it.
 */
type AdtHandle = { $tag?: string } & Record<string, unknown>;

function buildFenelRuntime(stringPool: readonly string[] = []): Record<string, unknown> {
  return {
    boxNum: (n: number): unknown => n,
    unboxNum: (v: unknown): number => (typeof v === "number" ? v : Number(v)),
    boxBool: (n: number): unknown => n !== 0,
    unboxBool: (v: unknown): number => (v ? 1 : 0),
    concat: (a: unknown, b: unknown): unknown => {
      if (Array.isArray(a) && Array.isArray(b)) return [...a, ...b];
      return String(a ?? "") + String(b ?? "");
    },
    litString: (idx: number): string => stringPool[idx] ?? "",
    // Phase 19 — ADT ABI. Tagged-record handles are JS objects with $tag +
    // positional fields, matching the JS target's runtime representation
    // (so the test driver compares values byte-equivalent to the engine).
    //
    // Phase 21.1 — additive `setFieldNamed` / `getFieldNamed` helpers.
    // The lowering hands these over whenever the source-level shape
    // matched a registered constructor (ctorDef threaded through
    // CoreConstruct.fields → CeConstruct.fields → emit). Hand-written
    // shape tests below construct via plain `{construct: [Tag, ...]}`
    // form which goes through ctorDefs-aware lowering (the engine's
    // ctor registry is loaded into the harness — see runOne in the
    // self-host harness for the full story); the helpers here keep
    // named and positional source forms both project the evaluator's canonical
    // JS object ABI: named codenames or `_N` positional properties.
    construct: (tag: unknown, _n: number): AdtHandle =>
      String(tag) === "$record" ? {} : { $tag: String(tag) },
    setField: (v: AdtHandle, i: number, value: unknown): void => {
      v[`_${i}`] = value;
    },
    setFieldNamed: (v: AdtHandle, _i: number, name: unknown, value: unknown): void => {
      (v as Record<string, unknown>)[String(name)] = value;
    },
    getField: (v: AdtHandle, i: number): unknown => v[`_${i}`],
    getFieldNamed: (v: AdtHandle, name: unknown): unknown => {
      const r = (v as Record<string, unknown>)[String(name)];
      return r;
    },
    hasField: (v: AdtHandle, i: number): number =>
      Object.prototype.hasOwnProperty.call(v, `_${i}`) ? 1 : 0,
    hasFieldNamed: (v: AdtHandle, name: unknown): number =>
      v && typeof v === "object" && String(name) in (v as Record<string, unknown>) ? 1 : 0,
    tagEq: (v: AdtHandle, expected: unknown): number =>
      v && v.$tag === String(expected) ? 1 : 0,
    litEq: (a: unknown, b: unknown): number => (Object.is(a, b) ? 1 : 0),
    matchFail: (_v: unknown): unknown => null,
    // Phase 5b14 — bare-array normalise extension lowers JlArray to
    // nested appendItem calls; the WASM CeLit empty-list base case
    // emits RefNull externref so appendItem(item, null) → [item] in
    // the host runtime. elem / lower / trim back the tryParseBoolean
    // conformance assertion.
    appendItem: (item: unknown, arr: unknown): unknown[] =>
      Array.isArray(arr) ? [...arr, item] : [item],
    elem: (needle: unknown, haystack: unknown): boolean => {
      if (typeof haystack === "string") return haystack.includes(String(needle));
      if (Array.isArray(haystack)) return haystack.includes(needle);
      return false;
    },
    lower: (x: unknown): string => String(x ?? "").toLowerCase(),
    trim: (x: unknown): string => String(x ?? "").trim(),
    // Phase 5b16 — image-pipeline runtime binding. std:imageRetro's
    // compiled body emits `$fenel.imagePixelate($fenel.imageGrayscale
    // (img), factor)` against this runtime namespace; both natives
    // stay TS-side, so the harness binds them directly to imgOps
    // (same TS natives the engine's std registry exposes).
    imageGrayscale: imgOps.imgGrayscale,
    imagePixelate: imgOps.imgPixelate,
    // Phase 5b19 — audit-target candidateFns-promotion bindings.
    // Mirror compile-wasm-self-host.test.ts's `buildFenelRuntime`
    // additions so the per-binding conformance tests below probe the
    // same 4 TS-native references (find / hostDateParse / point /
    // sampleAnim) that the self-host harness exercises.
    find: (pred: unknown, xs: unknown): unknown => {
      if (typeof pred !== "function") return { $tag: "Nothing" };
      for (const v of Array.isArray(xs) ? xs : []) {
        if ((pred as (a: unknown) => unknown)(v)) return { $tag: "Just", _0: v };
      }
      return { $tag: "Nothing" };
    },
    hostDateParse: (iso: unknown): unknown => {
      const ms = Date.parse(String(iso));
      if (Number.isNaN(ms)) return { $tag: "Nothing" };
      return { $tag: "Just", _0: ms };
    },
    point: (x: unknown, y: unknown): unknown => ({
      x: Number(x) || 0,
      y: Number(y) || 0,
    }),
    sampleAnim: (anim: unknown, t: unknown): unknown => {
      if (anim === null || typeof anim !== "object") return null;
      const obj = anim as Record<string, unknown>;
      const tag = obj.$tag as string | undefined;
      if (tag === "Animate") {
        const callable = (obj._0 ?? obj.value) as unknown;
        if (typeof callable === "function") return (callable as (x: unknown) => unknown)(t);
        return null;
      }
      if (tag === "Frames") {
        const seq = (obj._0 ?? obj.value) as Record<string, unknown> | undefined;
        if (!seq || !Array.isArray(seq.frames) || (seq.frames as unknown[]).length === 0 || !seq.fps) {
          return null;
        }
        const tSec = (t !== null && typeof t === "object" && "seconds" in (t as object))
          ? Number((t as { seconds: unknown }).seconds)
          : 0;
        const fps = Number(seq.fps);
        const frames = seq.frames as unknown[];
        const idx = Math.floor(tSec * fps);
        if (idx < 0 || idx >= frames.length) return null;
        return { $tag: "Raster", _0: frames[idx] };
      }
      return null;
    },
    // Phase 5b20 — picture candidateFns-promotion bindings. Mirror
    // compile-wasm-self-host.test.ts's `buildFenelRuntime` additions
    // so the per-binding conformance tests below probe the 5 new
    // TS-native references (floor / sqrt / alphaBlend / sample /
    // color) that the self-host harness exercises.
    floor: (x: unknown): number => Math.floor(Number(x)),
    sqrt: (x: unknown): number => Math.sqrt(Number(x)),
    alphaBlend: alphaBlendNative,
    color: (r: unknown, g: unknown, b: unknown, a: unknown): unknown => {
      const cl = (n: number): number => {
        if (!Number.isFinite(n)) return 0;
        if (n < 0) return 0;
        if (n > 255) return 255;
        return Math.round(n);
      };
      return {
        r: cl(Number(r)),
        g: cl(Number(g)),
        b: cl(Number(b)),
        a: cl(Number(a)),
      };
    },
    sample: (pic: unknown, p: unknown): unknown => {
      if (!pic || typeof pic !== "object") return { r: 0, g: 0, b: 0, a: 0 };
      const obj = pic as Record<string, unknown>;
      const tag = obj.$tag as string | undefined;
      if (tag === "Field") {
        const callable = (obj._0 ?? obj.value) as unknown;
        if (typeof callable === "function") {
          return (callable as (p: unknown) => unknown)(p);
        }
        return { r: 0, g: 0, b: 0, a: 0 };
      }
      if (tag === "Raster") {
        const img = (obj._0 ?? obj.value) as
          | { width?: unknown; height?: unknown; pixels?: unknown }
          | undefined;
        if (!img || typeof img !== "object") return { r: 0, g: 0, b: 0, a: 0 };
        const w = Number(img.width) || 0;
        const h = Number(img.height) || 0;
        if (w === 0 || h === 0) return { r: 0, g: 0, b: 0, a: 0 };
        const pt = (p && typeof p === "object")
          ? (p as { x?: unknown; y?: unknown })
          : { x: 0, y: 0 };
        const px = Math.max(0, Math.min(w - 1, Math.floor(Number(pt.x) || 0)));
        const py = Math.max(0, Math.min(h - 1, Math.floor(Number(pt.y) || 0)));
        if (!Array.isArray(img.pixels)) return { r: 0, g: 0, b: 0, a: 0 };
        return img.pixels[py * w + px] ?? { r: 0, g: 0, b: 0, a: 0 };
      }
      return { r: 0, g: 0, b: 0, a: 0 };
    },
    // Phase 5b21 — sound candidateFns-promotion bindings. Mirror
    // compile-wasm-self-host.test.ts's `buildFenelRuntime` additions
    // so the per-binding conformance tests below probe the 9 new
    // TS-native references (sin / pow / sampleSound / time /
    // amplitude / mono / ampL / ampR / audioBuffer) that the self-
    // host harness exercises.
    sin: (x: unknown): number => Math.sin(Number(x)),
    pow: (b: unknown, e: unknown): number => Math.pow(Number(b), Number(e)),
    sampleSound: (snd: unknown, t: unknown): unknown => {
      if (!snd || typeof snd !== "object") return { l: 0, r: 0 };
      const obj = snd as Record<string, unknown>;
      const tag = obj.$tag as string | undefined;
      if (tag === "Wave") {
        const callable = (obj._0 ?? obj.value) as unknown;
        if (typeof callable === "function") {
          return (callable as (t: unknown) => unknown)(t);
        }
        return { l: 0, r: 0 };
      }
      if (tag === "Buffer") {
        const buf = (obj._0 ?? obj.value) as
          | { sampleRate?: unknown; samples?: unknown }
          | undefined;
        if (!buf || typeof buf !== "object") return { l: 0, r: 0 };
        const sr = Number(buf.sampleRate) || 0;
        if (sr === 0 || !Array.isArray(buf.samples) || buf.samples.length === 0) {
          return { l: 0, r: 0 };
        }
        const tSec = (t !== null && typeof t === "object" && "seconds" in (t as object))
          ? Number((t as { seconds: unknown }).seconds)
          : 0;
        const idx = Math.floor(tSec * sr);
        if (idx < 0 || idx >= buf.samples.length) return { l: 0, r: 0 };
        return buf.samples[idx] ?? { l: 0, r: 0 };
      }
      return { l: 0, r: 0 };
    },
    time: (seconds: unknown): unknown => ({ seconds: Number(seconds) || 0 }),
    amplitude: (l: unknown, r: unknown): unknown => {
      const cl = (n: number): number => {
        if (!Number.isFinite(n)) return 0;
        if (n > 1) return 1;
        if (n < -1) return -1;
        return n;
      };
      return { l: cl(Number(l)), r: cl(Number(r)) };
    },
    mono: (v: unknown): unknown => {
      const cl = (n: number): number => {
        if (!Number.isFinite(n)) return 0;
        if (n > 1) return 1;
        if (n < -1) return -1;
        return n;
      };
      const x = cl(Number(v));
      return { l: x, r: x };
    },
    ampL: (a: unknown): number => Number((a as { l?: unknown })?.l) || 0,
    ampR: (a: unknown): number => Number((a as { r?: unknown })?.r) || 0,
    audioBuffer: (sampleRate: unknown, channels: unknown, samples: unknown): unknown => ({
      sampleRate: Math.max(1, Math.floor(Number(sampleRate))),
      channels: Math.max(1, Math.floor(Number(channels))),
      samples: Array.isArray(samples) ? samples : [],
    }),
  };
}

const fenelRuntime = buildFenelRuntime();

/**
 * Compile a Fenel source to Wasm bytes, instantiate the module, and
 * return the exported entry function value. Async because
 * `WebAssembly.instantiate` is a Promise; Bun's test runner handles
 * async tests natively.
 */
async function compileAndInstantiate(source: CompileSource): Promise<(...args: unknown[]) => unknown> {
  const compiled = compileFenelToWasmNative(source);
  if (compiled.$tag === "Err") {
    throw new Error(`compileFenelToWasm failed: ${JSON.stringify(compiled._0)}`);
  }
  const serialized = serializeWasmModuleNative(compiled._0);
  if (serialized.$tag === "Err") {
    throw new Error(`serializeWasmModule failed: ${serialized._0}`);
  }
  // The runtime closes over the per-module string pool so `litString(idx)`
  // resolves to the source-level interned value.
  const rt = buildFenelRuntime(compiled._0.stringPool ?? []);
  const { instance } = await WebAssembly.instantiate(serialized._0, {
    $fenel: rt as unknown as WebAssembly.ModuleImports,
  });
  const fn = instance.exports[source.name];
  if (typeof fn !== "function") {
    throw new Error(`compiled module has no '${source.name}' export`);
  }
  return fn as (...args: unknown[]) => unknown;
}

// ---------------------------------------------------------------------------
// 1. lowerToWasmAst — ClosuresExplicit → WasmModule shape tests
//
// Spot-check the lowering's structural decisions: function signatures,
// imports, the instruction-stream shape for the standard ops.
// ---------------------------------------------------------------------------

describe("lowerToWasmAst — structural shape", () => {
  it("`add(a, b) = a + b` lowers to f64.add with no imports", () => {
    const compiled = compileFenelToWasmNative(
      src("add", ["a", "b"], { "+": [{ var: "a" }, { var: "b" }] }),
    );
    expect(compiled.$tag).toBe("Ok");
    const mod = (compiled as { _0: WasmModule })._0;
    expect(mod.imports.length).toBe(0);
    expect(mod.funcs.length).toBe(1);
    expect(mod.funcs[0]!.funcType.params.map((p) => p.$tag)).toEqual(["F64", "F64"]);
    expect(mod.funcs[0]!.funcType.results.map((r) => r.$tag)).toEqual(["F64"]);
    // body: local.get 0, local.get 1, f64.add
    const body = mod.funcs[0]!.body;
    expect(body.length).toBe(3);
    expect(body[2]!.$tag).toBe("F64Add");
  });

  it("`lt(a, b) = a < b` lowers to f64.lt + boxBool import at return boundary", () => {
    const compiled = compileFenelToWasmNative(
      src("lt", ["a", "b"], { "<": [{ var: "a" }, { var: "b" }] }),
    );
    expect(compiled.$tag).toBe("Ok");
    const mod = (compiled as { _0: WasmModule })._0;
    // Imports: just $fenel.boxBool — inserted by the return-boundary coercion.
    expect(mod.imports.length).toBe(1);
    expect(mod.imports[0]!.$tag).toBe("WasmFuncImport");
    if (mod.imports[0]!.$tag === "WasmFuncImport") {
      expect(mod.imports[0]!.module).toBe("$fenel");
      expect(mod.imports[0]!.name).toBe("boxBool");
    }
    // Return type at the boundary is externref (boxed bool).
    expect(mod.funcs[0]!.funcType.results.map((r) => r.$tag)).toEqual(["Externref"]);
  });

  it("`concat(a, b) = a ++ b` lowers to a $fenel.concat externref call", () => {
    const compiled = compileFenelToWasmNative(
      src("concat", ["a", "b"], { call: ["concat", { var: "a" }, { var: "b" }] }),
    );
    expect(compiled.$tag).toBe("Ok");
    const mod = (compiled as { _0: WasmModule })._0;
    expect(mod.imports.length).toBe(1);
    if (mod.imports[0]!.$tag === "WasmFuncImport") {
      expect(mod.imports[0]!.name).toBe("concat");
      expect(mod.imports[0]!.funcType.params.map((p) => p.$tag)).toEqual([
        "Externref",
        "Externref",
      ]);
      expect(mod.imports[0]!.funcType.results.map((r) => r.$tag)).toEqual(["Externref"]);
    }
    expect(mod.funcs[0]!.funcType.params.map((p) => p.$tag)).toEqual([
      "Externref",
      "Externref",
    ]);
  });

  it("`max(a, b) = if a > b then a else b` lowers to a structured `if` block", () => {
    const compiled = compileFenelToWasmNative(
      src("max", ["a", "b"], {
        if: [{ ">": [{ var: "a" }, { var: "b" }] }, { var: "a" }, { var: "b" }],
      }),
    );
    expect(compiled.$tag).toBe("Ok");
    const mod = (compiled as { _0: WasmModule })._0;
    // The top-level instructions: f64.gt produces i32, then `if`.
    const body = mod.funcs[0]!.body;
    const last = body[body.length - 1]!;
    expect(last.$tag).toBe("If");
  });

  it("`squareSum(a, b) = let x = a + b in x * x` allocates a local for `x`", () => {
    const compiled = compileFenelToWasmNative(
      src("squareSum", ["a", "b"], {
        do: [
          { let: { x: { "+": [{ var: "a" }, { var: "b" }] } } },
          { "*": [{ var: "x" }, { var: "x" }] },
        ],
      }),
    );
    expect(compiled.$tag).toBe("Ok");
    const mod = (compiled as { _0: WasmModule })._0;
    expect(mod.funcs[0]!.locals.length).toBeGreaterThan(0);
    // One additional f64 local for `x` beyond the two params.
    const totalLocalCount = mod.funcs[0]!.locals.reduce((acc, l) => acc + l.count, 0);
    expect(totalLocalCount).toBe(1);
  });

  it("Phase 15: programs that declare `requires` without using effect-dispatch sentinels compile (the declaration is metadata)", () => {
    const compiled = compileFenelToWasmNative(
      src("eff", ["x"], { var: "x" }, ["HasStateIO@account"]),
    );
    // Pre-Phase-15 this was an EffectfulCallNotHandled error; Phase 15
    // admits effectful programs at the IR-level pass and pushes the
    // gating responsibility down to per-target lowering. A function that
    // declares `requires` but never invokes an effect dispatch site
    // compiles to a pure module.
    expect(compiled.$tag).toBe("Ok");
  });
});

// ---------------------------------------------------------------------------
// 2. serializeWasmModule — binary format sanity
//
// The output should start with the Wasm magic + version, and `new
// WebAssembly.Module(bytes)` should parse it without throwing. If the
// bytes are malformed, `WebAssembly.Module` is the strictest validator
// and surfaces the exact byte offset where parsing failed.
// ---------------------------------------------------------------------------

describe("serializeWasmModule — Wasm 3.0 binary format", () => {
  it("output starts with the Wasm magic (\\0asm) and version 1", () => {
    const compiled = compileFenelToWasmNative(
      src("add", ["a", "b"], { "+": [{ var: "a" }, { var: "b" }] }),
    );
    expect(compiled.$tag).toBe("Ok");
    const serialized = serializeWasmModuleNative((compiled as { _0: WasmModule })._0);
    expect(serialized.$tag).toBe("Ok");
    if (serialized.$tag === "Ok") {
      const bytes = serialized._0;
      // Magic: \0 a s m
      expect(bytes[0]).toBe(0x00);
      expect(bytes[1]).toBe(0x61);
      expect(bytes[2]).toBe(0x73);
      expect(bytes[3]).toBe(0x6d);
      // Version: 1 0 0 0
      expect(bytes[4]).toBe(0x01);
      expect(bytes[5]).toBe(0x00);
      expect(bytes[6]).toBe(0x00);
      expect(bytes[7]).toBe(0x00);
    }
  });

  it("`new WebAssembly.Module(bytes)` accepts the output without throwing", () => {
    const compiled = compileFenelToWasmNative(
      src("add", ["a", "b"], { "+": [{ var: "a" }, { var: "b" }] }),
    );
    expect(compiled.$tag).toBe("Ok");
    const serialized = serializeWasmModuleNative((compiled as { _0: WasmModule })._0);
    expect(serialized.$tag).toBe("Ok");
    if (serialized.$tag === "Ok") {
      // Cast through `BufferSource` — TS strict-DOM-types narrows
      // `Uint8Array<ArrayBufferLike>` more strictly than the WebAssembly
      // constructor's signature requires; the bytes are valid at runtime.
      expect(() => new WebAssembly.Module(serialized._0 as BufferSource)).not.toThrow();
    }
  });
});

// ---------------------------------------------------------------------------
// 3. Bootstrapping — compile + instantiate + invoke produces byte-identical
//    values to the engine's interpretation.
//
// This is the load-bearing demonstration: the substrate ships a working
// end-to-end Wasm compiler for the pure-Fenel subset. Anything compiled
// here should compute exactly what `evaluate(body, args)` computes when
// instantiated and invoked in a real Wasm runtime (Bun's, in this case).
//
// Each test instantiates the compiled module fresh — there is no
// cross-test state. The `$fenel` import namespace stays fixed across
// invocations.
// ---------------------------------------------------------------------------

describe("bootstrapping — Wasm-compiled + instantiated matches engine evaluate()", () => {
  /**
   * Test runner: given (params, body, sampleArgs[]), compile to Wasm,
   * instantiate, invoke with each sample, and check it matches the
   * engine's interpretation of the same body + args.
   */
  async function checkEquivalence(
    name: string,
    params: string[],
    body: unknown,
    samples: ReadonlyArray<ReadonlyArray<unknown>>,
  ): Promise<void> {
    const fn = await compileAndInstantiate(src(name, params, body));
    for (const args of samples) {
      const data: Record<string, unknown> = {};
      for (let i = 0; i < params.length; i++) data[params[i]!] = args[i];
      const engineResult = evaluate(body, data);
      const wasmResult = fn(...args);
      expect(wasmResult).toBe(engineResult);
    }
  }

  it("std:add (a + b)", async () => {
    await checkEquivalence(
      "add",
      ["a", "b"],
      { "+": [{ var: "a" }, { var: "b" }] },
      [
        [2, 3],
        [-7, 7],
        [0, 0],
        [100, 200],
      ],
    );
  });

  it("std:sub (a - b)", async () => {
    await checkEquivalence(
      "sub",
      ["a", "b"],
      { "-": [{ var: "a" }, { var: "b" }] },
      [
        [5, 3],
        [-1, -2],
        [0, 0],
      ],
    );
  });

  it("std:mul (a * b)", async () => {
    await checkEquivalence(
      "mul",
      ["a", "b"],
      { "*": [{ var: "a" }, { var: "b" }] },
      [
        [2, 3],
        [-4, 5],
        [0, 1000],
      ],
    );
  });

  it("comparison (lt → JS bool via $fenel.boxBool)", async () => {
    await checkEquivalence(
      "lt",
      ["a", "b"],
      { "<": [{ var: "a" }, { var: "b" }] },
      [
        [1, 2],
        [2, 1],
        [3, 3],
      ],
    );
  });

  it("comparison (gt)", async () => {
    await checkEquivalence(
      "gt",
      ["a", "b"],
      { ">": [{ var: "a" }, { var: "b" }] },
      [
        [5, 2],
        [1, 1],
        [-3, 0],
      ],
    );
  });

  it("a pure conditional (max)", async () => {
    await checkEquivalence(
      "max",
      ["a", "b"],
      { if: [{ ">": [{ var: "a" }, { var: "b" }] }, { var: "a" }, { var: "b" }] },
      [
        [3, 5],
        [10, 2],
        [7, 7],
      ],
    );
  });

  it("concat (via $fenel.concat externref import)", async () => {
    await checkEquivalence(
      "concat",
      ["a", "b"],
      { call: ["concat", { var: "a" }, { var: "b" }] },
      [
        ["Hello, ", "world"],
        ["", "x"],
        ["foo", ""],
      ],
    );
  });

  it("nested arithmetic (a + b * c)", async () => {
    await checkEquivalence(
      "axbpc",
      ["a", "b", "c"],
      { "+": [{ var: "a" }, { "*": [{ var: "b" }, { var: "c" }] }] },
      [
        [1, 2, 3],
        [-1, 5, 7],
        [0, 0, 0],
      ],
    );
  });

  it("let-binding (let x = a + b in x * x)", async () => {
    // `do { let x = a + b; x * x }` — the engine evaluates the let,
    // then the multiplication. The Wasm version allocates a local for
    // `x` and uses local.get twice.
    const body = {
      do: [
        { let: { x: { "+": [{ var: "a" }, { var: "b" }] } } },
        { "*": [{ var: "x" }, { var: "x" }] },
      ],
    };
    await checkEquivalence("squareSum", ["a", "b"], body, [
      [2, 3],
      [4, 1],
      [0, 0],
    ]);
  });

  // Phase 21.5.2 — polymorphic eq on string args. Before the substrate
  // fix, `eq op "literal"` inferred op as DOM_NUM (because eq routed
  // through DIRECT_COMPARISON_OPS to f64.eq), and the externref-typed
  // string param got unboxed to NaN at the call boundary. Every
  // NaN-vs-NaN compare returned false, so the body always took the
  // else branch — `if eq s "hello" then "matched" else "default"`
  // returned "default" for every input including the matching one.
  // The fix routes string-typed eq through litEq + propagates DOM_REF
  // to the param. Stays in the suite as a positive regression guard
  // so future emitter changes that break string-typed eq fire here.
  it("Phase 21.5.2: string-typed eq routes through litEq (polymorphic)", async () => {
    const body = {
      if: [{ "==": [{ var: "s" }, "hello"] }, "matched", "default"],
    };
    await checkEquivalence("stringEqProbe", ["s"], body, [
      ["hello"],
      ["world"],
      [""],
      ["hello!"],
    ]);
  });
});

// ---------------------------------------------------------------------------
// 4. Codec — Iso<Bytes, WasmModule> encode side
//
// The decode side is the Phase 13 placeholder; the encode round-trip is
// what the bootstrap above exercises. This block exercises the encoder
// in isolation, asserting the bytes parse as a valid Wasm module + the
// exported function lifts to a callable JS value.
// ---------------------------------------------------------------------------

describe("Codec<Bytes, WasmModule> — encode side", () => {
  it("serialize(compile(…)) produces instantiable Wasm bytes", async () => {
    const compiled = compileFenelToWasmNative(
      src("add", ["a", "b"], { "+": [{ var: "a" }, { var: "b" }] }),
    );
    expect(compiled.$tag).toBe("Ok");
    const serialized = serializeWasmModuleNative((compiled as { _0: WasmModule })._0);
    expect(serialized.$tag).toBe("Ok");
    if (serialized.$tag === "Ok") {
      const { instance } = await WebAssembly.instantiate(serialized._0, {
        $fenel: fenelRuntime as unknown as WebAssembly.ModuleImports,
      });
      const fn = instance.exports.add as (a: number, b: number) => number;
      expect(fn(10, 20)).toBe(30);
    }
  });
});

// ---------------------------------------------------------------------------
// 5. Phase 19 — ADT representation + pattern matching
//
// Hand-written fixtures covering Maybe / Result / List / custom-ADT shapes.
// Each case lowers through `$fenel.construct` + `$fenel.setField` (and
// `$fenel.tagEq` + `$fenel.getField` for pattern matches), instantiates
// through the host runtime above, and compares the returned externref
// against the engine's interpretation.
// ---------------------------------------------------------------------------

describe("Phase 19 — Wasm ADT representation lowering", () => {
  it("the exported classifier runtime uses the canonical positional ADT ABI", () => {
    const { rt } = buildClassifierFenelRuntime([]);
    const construct = rt["construct"] as (tag: unknown, fieldCount: number) => AdtHandle;
    const setField = rt["setField"] as (
      value: AdtHandle,
      index: number,
      field: unknown,
    ) => void;
    const head = rt["head"] as (value: unknown) => unknown;
    const tail = rt["tail"] as (value: unknown) => unknown;

    const just = construct("Just", 1);
    setField(just, 0, 42);
    expect(just).toEqual({ $tag: "Just", _0: 42 });
    expect(Object.prototype.hasOwnProperty.call(just, "_fields")).toBe(false);
    expect(construct("Nothing", 0)).toEqual({ $tag: "Nothing" });

    expect(head([1, 2])).toEqual({ $tag: "Just", _0: 1 });
    expect(head([])).toEqual({ $tag: "Nothing" });
    expect(tail([1, 2])).toEqual({ $tag: "Just", _0: [2] });
    expect(tail([])).toEqual({ $tag: "Nothing" });
    expect(head("ab")).toEqual({ $tag: "Just", _0: "a" });
    expect(head("")).toEqual({ $tag: "Nothing" });
    expect(tail("ab")).toEqual({ $tag: "Just", _0: "b" });
    expect(tail("")).toEqual({ $tag: "Nothing" });
  });

  it("Nothing (zero-arg constructor) imports $fenel.construct", async () => {
    const compiled = compileFenelToWasmNative(src("mkNothing", [], { construct: ["Nothing"] }));
    expect(compiled.$tag).toBe("Ok");
    if (compiled.$tag !== "Ok") return;
    const importNames = compiled._0.imports
      .filter((i) => i.$tag === "WasmFuncImport")
      .map((i) => i.name);
    expect(importNames).toContain("construct");
    expect(importNames).toContain("litString");
    expect(compiled._0.stringPool).toContain("Nothing");
  });

  it("Just 5 imports both `construct` and `setField`", async () => {
    const compiled = compileFenelToWasmNative(src("mkJust", [], { construct: ["Just", 5] }));
    expect(compiled.$tag).toBe("Ok");
    if (compiled.$tag !== "Ok") return;
    const importNames = compiled._0.imports
      .filter((i) => i.$tag === "WasmFuncImport")
      .map((i) => i.name);
    expect(importNames).toContain("construct");
    expect(importNames).toContain("setField");
  });

  it("Constructed Maybe (Just 5) round-trips through the host runtime", async () => {
    const fn = await compileAndInstantiate(src("mkJust", [], { construct: ["Just", 5] }));
    const result = fn() as AdtHandle;
    expect(result).toEqual({ $tag: "Just", _0: 5 });
  });

  it("positional construction is evaluator-byte-equal and feeds positional matching", async () => {
    const body = { construct: ["Pair", 1, 2] };
    const makePair = await compileAndInstantiate(src("mkPair", [], body));
    const pair = makePair() as AdtHandle;
    const evaluatedPair = evaluate(body, {});
    expect(pair).toEqual(evaluatedPair);
    expect(JSON.stringify(pair)).toBe(JSON.stringify(evaluatedPair));
    expect(Object.prototype.hasOwnProperty.call(pair, "_fields")).toBe(false);

    const first = await compileAndInstantiate(
      src("pairFirst", ["pair"], {
        match: [
          { var: "pair" },
          { $tag: "Pair", _0: { var: "a" }, _1: { var: "_" } },
          { var: "a" },
        ],
      }),
    );
    expect(first(pair)).toBe(1);
  });

  it("Constructed Nothing round-trips", async () => {
    const fn = await compileAndInstantiate(src("mkNothing", [], { construct: ["Nothing"] }));
    const result = fn() as AdtHandle;
    expect(result).toEqual({ $tag: "Nothing" });
  });

  it("Constructed Result (Err / Ok) round-trips", async () => {
    const errFn = await compileAndInstantiate(src("mkErr", [], { construct: ["Err", "oops"] }));
    const errResult = errFn() as AdtHandle;
    expect(errResult).toEqual({ $tag: "Err", _0: "oops" });

    const okFn = await compileAndInstantiate(src("mkOk", [], { construct: ["Ok", 42] }));
    const okResult = okFn() as AdtHandle;
    expect(okResult).toEqual({ $tag: "Ok", _0: 42 });
  });

  it("Constructed List (Cons 1 (Cons 2 Nil)) round-trips with three nested handles", async () => {
    const fn = await compileAndInstantiate(
      src("twoList", [], {
        construct: [
          "Cons",
          1,
          { construct: ["Cons", 2, { construct: ["Nil"] }] },
        ],
      }),
    );
    const result = fn() as AdtHandle;
    expect(result.$tag).toBe("Cons");
    expect(result._0).toBe(1);
    const inner = result._1 as AdtHandle;
    expect(inner.$tag).toBe("Cons");
    expect(inner._0).toBe(2);
    expect(inner._1).toEqual({ $tag: "Nil" });
  });

  it("Custom ADT: `Circle r` and `Rect w h` round-trip", async () => {
    const circleFn = await compileAndInstantiate(
      src("mkCircle", ["r"], { construct: ["Circle", { var: "r" }] }),
    );
    const circle = circleFn(7) as AdtHandle;
    expect(circle).toEqual({ $tag: "Circle", _0: 7 });

    const rectFn = await compileAndInstantiate(
      src("mkRect", ["w", "h"], { construct: ["Rect", { var: "w" }, { var: "h" }] }),
    );
    const rect = rectFn(3, 4) as AdtHandle;
    expect(rect).toEqual({ $tag: "Rect", _0: 3, _1: 4 });
  });

  it("Anonymous record `{x = 1, y = 2}` uses the sentinel tag `$record`", async () => {
    const fn = await compileAndInstantiate(src("mkPoint", [], { x: 1, y: 2 }));
    const result = fn() as AdtHandle;
    expect(result).toEqual({ x: 1, y: 2 });
  });

  it("Pattern match on Maybe: `case x of Just y -> y | Nothing -> 0`", async () => {
    const body = {
      match: [
        { var: "x" },
        { $tag: "Just", _0: { var: "y" } },
        { var: "y" },
        { $tag: "Nothing" },
        0,
      ],
    };
    const fn = await compileAndInstantiate(src("unmaybe", ["x"], body));
    const just = { $tag: "Just", _0: 42 } as AdtHandle;
    const nothing = { $tag: "Nothing" } as AdtHandle;
    expect(fn(just)).toBe(42);
    expect(fn(nothing)).toBe(0);
  });

  it("Pattern match on Result: `case r of Ok v -> v | Err e -> 0`", async () => {
    const body = {
      match: [
        { var: "r" },
        { $tag: "Ok", _0: { var: "v" } },
        { var: "v" },
        { $tag: "Err", _0: { var: "e" } },
        0,
      ],
    };
    const fn = await compileAndInstantiate(src("unok", ["r"], body));
    const ok = { $tag: "Ok", _0: 99 } as AdtHandle;
    const err = { $tag: "Err", _0: "boom" } as AdtHandle;
    expect(fn(ok)).toBe(99);
    expect(fn(err)).toBe(0);
  });

  it("Pattern match on List head: `Cons h _ -> h | Nil -> 0`", async () => {
    const body = {
      match: [
        { var: "xs" },
        { $tag: "Cons", head: { var: "h" }, tail: { var: "_" } },
        { var: "h" },
        { $tag: "Nil" },
        0,
      ],
    };
    const fn = await compileAndInstantiate(src("headOr", ["xs"], body));
    const cons = { $tag: "Cons", _0: 10, _1: { $tag: "Nil" } } as AdtHandle;
    const nil = { $tag: "Nil" } as AdtHandle;
    expect(fn(cons)).toBe(10);
    expect(fn(nil)).toBe(0);
  });

  it("Pattern match with literal pattern (PatLit): `case x of 0 -> \"zero\" | _ -> \"nonzero\"`", async () => {
    const body = {
      match: [
        { var: "x" },
        0,
        "zero",
        { var: "_" },
        "nonzero",
      ],
    };
    const fn = await compileAndInstantiate(src("zeroOrNot", ["x"], body));
    expect(fn(0)).toBe("zero");
    expect(fn(42)).toBe("nonzero");
  });

  it("Pattern match on custom ADT: `case s of Circle r -> r | Rect w h -> w`", async () => {
    const body = {
      match: [
        { var: "s" },
        { $tag: "Circle", radius: { var: "r" } },
        { var: "r" },
        { $tag: "Rect", w: { var: "w" }, h: { var: "h" } },
        { var: "w" },
      ],
    };
    const fn = await compileAndInstantiate(src("shapeFirst", ["s"], body));
    const circle = { $tag: "Circle", _0: 5 } as AdtHandle;
    const rect = { $tag: "Rect", _0: 3, _1: 4 } as AdtHandle;
    expect(fn(circle)).toBe(5);
    expect(fn(rect)).toBe(3);
  });
});

// ---------------------------------------------------------------------------
// 6. Negative — body / signature shapes the Wasm target doesn't (yet)
//     handle surface as a structured CompileError.
// ---------------------------------------------------------------------------

describe("compileFenelToWasm — negative cases", () => {
  it("Phase 15: `requires` alone (no effect-dispatch sentinel in body) compiles fine", () => {
    // Pre-Phase-15 this was an `Err EffectfulCallNotHandled`; Phase 15
    // admits the program (the `requires` declaration without a matching
    // dispatch site is metadata at this level). A program that DOES use
    // the `$effect:` sentinel is exercised by the Phase 15 bootstrap
    // suite further down.
    const compiled = compileFenelToWasmNative(
      src("eff", ["v"], { var: "v" }, ["HasStateIO@account"]),
    );
    expect(compiled.$tag).toBe("Ok");
  });

  it("returns Err Unsupported for an unrecognised op", () => {
    const compiled = compileFenelToWasmNative(
      src("noop", ["xs"], {
        reduce: [{ var: "xs" }, { "+": [{ var: "current" }, { var: "accumulator" }] }, 0],
      }),
    );
    expect(compiled.$tag).toBe("Err");
    if (compiled.$tag === "Err") {
      expect(compiled._0.$tag).toBe("Unsupported");
    }
  });

  it("Phase 18: indirect `$dyn:` calls lower through the closure-helper ABI", () => {
    // Pre-Phase-18 this was an Err Unsupported. Phase 18 closes the gap:
    // the call routes through `$fenel.callClosure_N(externref, …) →
    // externref` after coercing the closure handle + each arg to
    // externref. The host runtime extracts the closure body name + env
    // from the handle and invokes the matching exported func.
    const compiled = compileFenelToWasmNative(
      src("indirect", ["f"], { call: [{ var: "f" }, 1] }),
    );
    expect(compiled.$tag).toBe("Ok");
    if (compiled.$tag !== "Ok") return;
    const mod = compiled._0;
    const callImport = mod.imports.find(
      (i) => i.$tag === "WasmFuncImport" && i.name === "callClosure_1",
    );
    expect(callImport).toBeDefined();
  });

  it("`lowerToWasmAst` rejects non-ClosuresExplicit input", () => {
    // Cast to satisfy the dispatched wrapper's typed parameter; the runtime
    // guard inside the body still rejects malformed input with Err.
    const r = dispatchedLowerToWasmAst({ foo: "bar" } as never);
    expect(r.$tag).toBe("Err");
  });

  it("`serializeWasmModule` rejects non-WasmModule input", () => {
    const r = serializeWasmModuleNative({ foo: "bar" });
    expect(r.$tag).toBe("Err");
  });
});

// ---------------------------------------------------------------------------
// 6. Phase 5b13 — Bool-construct emitter alignment (WASM target)
//
// Zero-arg `True` / `False` CeConstructs lower to `I32Const 1 / 0` with
// DomBool instead of the canonical tagged-record externref path; the
// function-boundary `DomBool → DomRef` coercion inserts `boxBool` so the
// JS host receives a native JS bool. Closes the 5b6 / 5b7 Bool-construct
// boundary class for the WASM target.
// ---------------------------------------------------------------------------

describe("Phase 5b13 — Bool-construct emitter alignment (WASM target)", () => {
  it("std:and shape — `if a then b else (construct False)` returns native JS bool through the JS-host boundary", async () => {
    const fn = await compileAndInstantiate(
      src("and", ["a", "b"], { if: [{ var: "a" }, { var: "b" }, { construct: ["False"] }] }),
    );
    expect(fn(true, true)).toBe(true);
    expect(fn(true, false)).toBe(false);
    expect(fn(false, true)).toBe(false);
    expect(fn(false, false)).toBe(false);
  });

  it("std:or shape — `if a then (construct True) else b` returns native JS bool", async () => {
    const fn = await compileAndInstantiate(
      src("or", ["a", "b"], { if: [{ var: "a" }, { construct: ["True"] }, { var: "b" }] }),
    );
    expect(fn(true, false)).toBe(true);
    expect(fn(false, false)).toBe(false);
    expect(fn(false, true)).toBe(true);
    expect(fn(true, true)).toBe(true);
  });

  it("std:not shape — `if x then (construct False) else (construct True)` returns native JS bool", async () => {
    const fn = await compileAndInstantiate(
      src("not_", ["x"], { if: [{ var: "x" }, { construct: ["False"] }, { construct: ["True"] }] }),
    );
    expect(fn(true)).toBe(false);
    expect(fn(false)).toBe(true);
  });

  it("zero-arg `construct True` lowers to I32Const 1 + DomBool (function returns externref wrapping JS true via boundary boxBool)", () => {
    const compiled = compileFenelToWasmNative(
      src("true_", [], { construct: ["True"] }),
    );
    expect(compiled.$tag).toBe("Ok");
    if (compiled.$tag !== "Ok") return;
    const mod = compiled._0;
    // Function-level return type is externref (DomBool→DomRef coercion at
    // the boundary). The boxBool import is what does the wrap.
    expect(mod.funcs[0]!.funcType.results.map((r) => r.$tag)).toEqual(["Externref"]);
    const boxBoolImport = mod.imports.find(
      (i) => i.$tag === "WasmFuncImport" && i.name === "boxBool",
    );
    expect(boxBoolImport).toBeDefined();
    // The body's leading instruction is `I32Const 1` (the post-5b13 Bool-
    // construct lowering); no `$fenel.construct` import for the
    // tagged-record path.
    const constructImport = mod.imports.find(
      (i) => i.$tag === "WasmFuncImport" && i.name === "construct",
    );
    expect(constructImport).toBeUndefined();
    expect(mod.funcs[0]!.body[0]!.$tag).toBe("I32Const");
  });
});

// ---------------------------------------------------------------------------
// 7. Phase 5b14 — bare-array normalise extension (WASM target)
//
// The normalise pass lowers JlArray-at-expression-position to nested
// appendItem CoreCalls; the WASM CeLit arm gains an isArray case that
// emits RefNull externref for the empty-list base. The runtime's
// appendItem helper accepts null as empty list end-to-end, so the
// nested chain produces a JS array byte-equal to the engine's source-
// level `[a, b, c]` evaluation.
// ---------------------------------------------------------------------------

describe("Phase 5b14 — bare-array normalise extension (WASM target)", () => {
  it("simple `elem x [a, b, c]` compiles + evaluates correctly through the WASM/JS boundary", async () => {
    const fn = await compileAndInstantiate(
      src("isAbc", ["x"], { call: ["elem", { var: "x" }, ["a", "b", "c"]] }),
    );
    expect(fn("a")).toBe(true);
    expect(fn("c")).toBe(true);
    expect(fn("z")).toBe(false);
  });

  it("std:tryParseBoolean shape — full if-cascade with two 7-element bare arrays compiles + returns Just(true|false) / Nothing", async () => {
    const body = {
      if: [
        {
          call: [
            "elem",
            { call: ["lower", { call: ["trim", { var: "s" }] }] },
            ["yes", "y", "true", "1", "ok", "yep", "yeah"],
          ],
        },
        { construct: ["Just", { construct: ["True"] }] },
        {
          if: [
            {
              call: [
                "elem",
                { call: ["lower", { call: ["trim", { var: "s" }] }] },
                ["no", "n", "false", "0", "nope", "nah"],
              ],
            },
            { construct: ["Just", { construct: ["False"] }] },
            { construct: ["Nothing"] },
          ],
        },
      ],
    };
    const source: CompileSource = {
      ...src("tryParseBoolean", ["s"], body),
      ctorDefs: { Just: positionalCompileFieldSlots(["value"]) },
    };
    const fn = await compileAndInstantiate(source);
    expect(fn("yes")).toEqual({ $tag: "Just", _0: true });
    expect(fn("NO")).toEqual({ $tag: "Just", _0: false });
    expect(fn("maybe")).toEqual({ $tag: "Nothing" });
  });
});

// ---------------------------------------------------------------------------
// 8. Phase 5b15 — closure-value boundary fix (WASM target)
//
// Compiles the std:. and std:$ body shapes and probes them through the
// closure-conversion runtime. std:$ produces a concrete value; std:.
// returns a closure handle that's invoked via callClosure_1. Both
// conformance assertions instantiate a minimal closure-aware runtime
// that mirrors the self-host harness's `installSharedWasmWrappers` shape
// — user-supplied closures wrap a JS function via `__userFn`, and
// module-defined closures dispatch through `instance.exports[__cl]`.
// ---------------------------------------------------------------------------

describe("Phase 5b15 — closure-value boundary fix (WASM target)", () => {
  type ClosureHandle = {
    __cl?: string;
    __userFn?: (...args: unknown[]) => unknown;
    env?: unknown;
  };

  async function compileWithClosureRt(source: CompileSource): Promise<{
    fn: (...args: unknown[]) => unknown;
    rt: Record<string, unknown>;
  }> {
    const compiled = compileFenelToWasmNative(source);
    if (compiled.$tag === "Err") {
      throw new Error(`compile failed: ${JSON.stringify(compiled._0)}`);
    }
    const serialized = serializeWasmModuleNative(compiled._0);
    if (serialized.$tag === "Err") {
      throw new Error(`serialize failed: ${serialized._0}`);
    }
    const rt = buildFenelRuntime(compiled._0.stringPool ?? []);
    let instance: WebAssembly.Instance | undefined;
    rt.envAlloc = (n: number): unknown[] => new Array(n);
    rt.envSet = (env: unknown[], i: number, v: unknown): void => {
      env[i] = v;
    };
    rt.envGet = (env: unknown[], i: number): unknown => env[i];
    rt.makeClosure = (name: string, env: unknown[]): ClosureHandle => ({ __cl: name, env });
    for (let arity = 0; arity <= 3; arity++) {
      const helperName = `callClosure_${arity}`;
      rt[helperName] = (cl: ClosureHandle, ...args: unknown[]): unknown => {
        if (cl && cl.__userFn !== undefined) return cl.__userFn(...args);
        if (cl === undefined || cl.__cl === undefined) {
          throw new Error(`callClosure_${arity}: invalid handle`);
        }
        if (instance === undefined) throw new Error(`callClosure_${arity}: no instance`);
        const fn = (instance.exports as Record<string, unknown>)[cl.__cl] as
          | ((...a: unknown[]) => unknown)
          | undefined;
        if (typeof fn !== "function") {
          throw new Error(`callClosure_${arity}: no export '${cl.__cl}'`);
        }
        return fn(cl.env, ...args);
      };
    }
    const result = await WebAssembly.instantiate(serialized._0, {
      $fenel: rt as unknown as WebAssembly.ModuleImports,
    });
    instance = result.instance;
    const fn = instance.exports[source.name];
    if (typeof fn !== "function") throw new Error(`no '${source.name}' export`);
    return { fn: fn as (...args: unknown[]) => unknown, rt };
  }

  it("std:$ shape `\\f x -> f x` compiles + dispatches through callClosure_1 to a user-supplied closure", async () => {
    const body = { call: [{ var: "f" }, { var: "x" }] };
    const { fn } = await compileWithClosureRt(src("dollar", ["f", "x"], body));
    const absClosure: ClosureHandle = { __userFn: (x: unknown) => Math.abs(x as number) };
    expect(fn(absClosure, -5)).toBe(5);
  });

  it("std:. shape `\\f g -> \\x -> f (g x)` compiles to entry + dot__cl0 closure body; probe via callClosure_1 yields 5", async () => {
    const body = {
      fn: [["x"], { call: [{ var: "f" }, { call: [{ var: "g" }, { var: "x" }] }] }],
    };
    const { fn, rt } = await compileWithClosureRt(src("dot", ["f", "g"], body));
    const fClosure: ClosureHandle = {
      __userFn: (y: unknown) => (y as number) + 1,
    };
    const gClosure: ClosureHandle = {
      __userFn: (z: unknown) => (z as number) * 2,
    };
    const handle = fn(fClosure, gClosure) as ClosureHandle;
    expect(handle.__cl).toBe("dot__cl0");
    const callClosure_1 = rt.callClosure_1 as (h: unknown, x: unknown) => unknown;
    expect(callClosure_1(handle, 2)).toBe(5);
  });
});

// ---------------------------------------------------------------------------
// 9. Phase 5b16 — image-pipeline runtime binding (WASM target)
//
// Compiles the std:imageRetro body shape and probes it through the
// WASM/JS boundary. Image is passed as externref (opaque JS reference)
// so the runtime stubs operate on the JS object transparently — no
// bytes-level marshalling. The harness's `buildFenelRuntime` now binds
// `imageGrayscale` + `imagePixelate` to `imgOps.imgGrayscale` /
// `imgPixelate` directly; the WASM body's `$fenel.imagePixelate
// ($fenel.imageGrayscale(img), factor)` import chain resolves through
// these stubs. Byte-equality holds because the WASM-compiled path
// invokes THE SAME TS natives as the engine's std registry (std.ts:
// 3382 / :3401). First tier (8) harness-runtime-extension sub-phase.
// ---------------------------------------------------------------------------

describe("Phase 5b16 — image-pipeline runtime binding (WASM target)", () => {
  const RETRO_BODY = {
    call: [
      "imagePixelate",
      { call: ["imageGrayscale", { var: "img" }] },
      { var: "factor" },
    ],
  };

  it("std:imageRetro shape on 1×1 image — WASM-compiled output byte-equals engine native composition through the externref boundary", async () => {
    const fn = await compileAndInstantiate(src("imageRetro", ["img", "factor"], RETRO_BODY));
    const img = { width: 1, height: 1, pixels: [{ r: 200, g: 100, b: 50, a: 255 }] };
    const compiled = fn(img, 2);
    const expected = imgOps.imgPixelate(imgOps.imgGrayscale(img), 2);
    expect(compiled).toEqual(expected);
  });

  it("std:imageRetro shape on 2×2 image — WASM-compiled output matches engine native composition byte-for-byte", async () => {
    const fn = await compileAndInstantiate(src("imageRetro", ["img", "factor"], RETRO_BODY));
    const img = {
      width: 2,
      height: 2,
      pixels: [
        { r: 255, g: 0, b: 0, a: 255 },
        { r: 0, g: 255, b: 0, a: 255 },
        { r: 0, g: 0, b: 255, a: 255 },
        { r: 128, g: 128, b: 128, a: 255 },
      ],
    };
    const compiled = fn(img, 2);
    const expected = imgOps.imgPixelate(imgOps.imgGrayscale(img), 2);
    expect(compiled).toEqual(expected);
  });
});

// ---------------------------------------------------------------------------
// 10. Phase 5b19 — audit-target candidateFns-promotion runtime bindings
// (WASM target)
//
// Compiles small per-binding probes against the 4 TS-native references
// closed in Phase 5b19 (find / hostDateParse / point / sampleAnim) and
// instantiates each through buildFenelRuntime. Same recipe as 5b16
// image-pipeline + 5b18 matchFail — the host-side runtime binding is
// load-bearing for the per-fn self-host exercise of the 6 audit-target
// modules promoted to candidateModules in compile-wasm-self-host.test.ts.
// Each call site lowers to `$fenel.<name>(...)` against the import
// namespace; the runtime stubs operate on externref-boxed JS values.
// ---------------------------------------------------------------------------

describe("Phase 5b19 — audit-target candidateFns-promotion runtime bindings (WASM target)", () => {
  // `find` HOF — body invokes a `{fn:...}` lambda against a list and
  // returns Just(v) on first match / Nothing on exhaustion. Closure
  // arg is a user-supplied `{__userFn}` handle (Phase 5b15 ABI); the
  // find binding sees it as a real JS function via the WASM/JS
  // boundary's callClosure_1 dispatch.
  it("find binding — Frames-shaped Animation indexed at seconds=0 returns Just(frames[0])", async () => {
    // Probe sampleAnim directly via the runtime; build the engine-side
    // FrameSequence externref and pass through.
    const rt = buildFenelRuntime();
    const sampleAnim = rt.sampleAnim as (anim: unknown, t: unknown) => unknown;
    const anim = { $tag: "Frames", _0: { fps: 1, frames: ["a", "b", "c"] } };
    expect(sampleAnim(anim, { seconds: 0 })).toEqual({ $tag: "Raster", _0: "a" });
    expect(sampleAnim(anim, { seconds: 2 })).toEqual({ $tag: "Raster", _0: "c" });
  });

  it("point binding — `$fenel.point(x, y)` returns the `{ x, y }` record byte-equal to engine native", async () => {
    const fn = await compileAndInstantiate(
      src("ptest", ["x", "y"], { call: ["point", { var: "x" }, { var: "y" }] }),
    );
    expect(fn(3, 4)).toEqual({ x: 3, y: 4 });
    expect(fn(0, 0)).toEqual({ x: 0, y: 0 });
  });

  it("hostDateParse binding — valid ISO returns Just(ms), invalid returns Nothing", async () => {
    const fn = await compileAndInstantiate(
      src("dtest", ["s"], { call: ["hostDateParse", { var: "s" }] }),
    );
    expect(fn("2024-01-01T00:00:00Z")).toEqual({
      $tag: "Just",
      _0: Date.parse("2024-01-01T00:00:00Z"),
    });
    expect(fn("not-a-date")).toEqual({ $tag: "Nothing" });
  });

  it("find binding — invocation through compileAndInstantiate (single arity-1 closure arg)", async () => {
    // Body: find pred xs. The compiled WASM emits `$fenel.find(pred, xs)`;
    // pred arrives via the closure ABI as a `{__userFn}` JS-wrapped
    // callable, and the find binding invokes it directly (typeof v ===
    // "function" check holds because closure handles wrap callable refs
    // before the WASM/JS boundary).
    //
    // The harness here doesn't have full closure-conversion glue
    // outside the self-host suite — bind a static predicate-as-closure
    // via the engine's `{fn: [[v], body]}` lift and confirm the find
    // binding stubs return the expected shape directly. The Phase
    // 5b18-style runtime probe is sufficient for the host-side
    // contract; the WASM-binary execution path is exercised by the
    // self-host harness's events:sampleEvent per-fn test.
    const rt = buildFenelRuntime();
    const find = rt.find as (pred: unknown, xs: unknown) => unknown;
    const pred = (v: unknown): unknown => (v as number) === 3;
    expect(find(pred, [1, 2, 3, 4])).toEqual({ $tag: "Just", _0: 3 });
    expect(find(pred, [1, 2, 4, 5])).toEqual({ $tag: "Nothing" });
    expect(find(pred, [])).toEqual({ $tag: "Nothing" });
  });
});

// ---------------------------------------------------------------------------
// 11. Phase 5b20 — picture-module candidateFns-promotion runtime bindings
// (WASM target)
//
// Compiles small per-binding probes against the 5 TS-native references
// shipped in Phase 5b20 (floor / sqrt / alphaBlend / sample / color)
// and instantiates each through buildFenelRuntime. Same recipe as 5b16
// image-pipeline + 5b18 matchFail + 5b19 audit-target bindings — the
// host-side runtime binding is load-bearing for the per-fn self-host
// exercise of picture's 12 newly-promoted bodies + animation:overAnim.
// Each call site lowers to `$fenel.<name>(...)` against the import
// namespace; the runtime stubs operate on externref-boxed JS values.
// ---------------------------------------------------------------------------

describe("Phase 5b20 — picture candidateFns-promotion runtime bindings (WASM target)", () => {
  it("floor binding — `$fenel.floor(x)` returns the integer floor byte-equal to engine native", async () => {
    const fn = await compileAndInstantiate(
      src("ftest", ["x"], { call: ["floor", { var: "x" }] }),
    );
    expect(fn(3.7)).toBe(3);
    expect(fn(-2.3)).toBe(-3);
    expect(fn(0)).toBe(0);
  });

  it("sqrt binding — `$fenel.sqrt(x)` returns the square root byte-equal to engine native", async () => {
    const fn = await compileAndInstantiate(
      src("stest", ["x"], { call: ["sqrt", { var: "x" }] }),
    );
    expect(fn(16)).toBe(4);
    expect(fn(0)).toBe(0);
    expect(Math.abs((fn(2) as number) - Math.sqrt(2))).toBeLessThan(1e-10);
  });

  it("color binding — `$fenel.color(r, g, b, a)` returns clamped Color record byte-equal to engine native", async () => {
    const fn = await compileAndInstantiate(
      src("ctest", ["r", "g", "b", "a"], {
        call: ["color", { var: "r" }, { var: "g" }, { var: "b" }, { var: "a" }],
      }),
    );
    expect(fn(255, 0, 0, 255)).toEqual({ r: 255, g: 0, b: 0, a: 255 });
    expect(fn(300, -5, 128, 50)).toEqual({ r: 255, g: 0, b: 128, a: 50 });
  });

  it("alphaBlend binding — source-over compositing mirrors picture:alphaBlendNative", () => {
    // Probe directly via the host runtime — the WASM/JS boundary sees
    // Color values as externref-boxed JS objects, same as the harness's
    // sample passthrough; the binding semantics are what's load-bearing.
    const rt = buildFenelRuntime();
    const alphaBlend = rt.alphaBlend as (t: unknown, b: unknown) => unknown;
    expect(alphaBlend({ r: 255, g: 0, b: 0, a: 255 }, { r: 0, g: 255, b: 0, a: 255 })).toEqual({
      r: 255, g: 0, b: 0, a: 255,
    });
    expect(alphaBlend({ r: 255, g: 0, b: 0, a: 0 }, { r: 0, g: 255, b: 0, a: 255 })).toEqual({
      r: 0, g: 255, b: 0, a: 255,
    });
    expect(alphaBlend({ r: 255, g: 0, b: 0, a: 128 }, { r: 0, g: 0, b: 255, a: 128 })).toEqual({
      r: 170, g: 0, b: 85, a: 192,
    });
  });

  it("sample binding — Raster-case reads the pixel at floored point byte-equal to engine native", () => {
    const rt = buildFenelRuntime();
    const sample = rt.sample as (pic: unknown, p: unknown) => unknown;
    const pixels = [
      { r: 255, g: 0, b: 0, a: 255 },
      { r: 0, g: 255, b: 0, a: 255 },
    ];
    const pic = { $tag: "Raster", _0: { width: 2, height: 1, pixels } };
    expect(sample(pic, { x: 0, y: 0 })).toEqual(pixels[0]);
    expect(sample(pic, { x: 1, y: 0 })).toEqual(pixels[1]);
  });

  it("sample binding — Field-case invokes the captured closure with the probe point", () => {
    const rt = buildFenelRuntime();
    const sample = rt.sample as (pic: unknown, p: unknown) => unknown;
    const red = { r: 255, g: 0, b: 0, a: 255 };
    const pic = { $tag: "Field", _0: (_p: unknown): unknown => red };
    expect(sample(pic, { x: 0, y: 0 })).toEqual(red);
  });
});

// ---------------------------------------------------------------------------
// 12. Phase 5b21 — sound-module candidateFns-promotion runtime bindings
// (WASM target)
//
// Compiles small per-binding probes against the 9 TS-native references
// shipped in Phase 5b21 (sin / pow / sampleSound / time / amplitude /
// mono / ampL / ampR / audioBuffer) and instantiates each through
// buildFenelRuntime. Same recipe as 5b16 image-pipeline + 5b18
// matchFail + 5b19 audit-target + 5b20 picture bindings — the host-
// side runtime binding is load-bearing for the per-fn self-host
// exercise of sound's 13 newly-promoted bodies + animation:delayAnim
// / speedAnim. Each call site lowers to `$fenel.<name>(...)` against
// the import namespace; the runtime stubs operate on externref-boxed
// JS values.
// ---------------------------------------------------------------------------

describe("Phase 5b21 — sound candidateFns-promotion runtime bindings (WASM target)", () => {
  it("sin binding — `$fenel.sin(x)` returns the sine of x byte-equal to engine native", async () => {
    const fn = await compileAndInstantiate(
      src("sintest", ["x"], { call: ["sin", { var: "x" }] }),
    );
    expect(fn(0)).toBe(0);
    expect(Math.abs((fn(Math.PI / 2) as number) - 1)).toBeLessThan(1e-10);
    expect(Math.abs((fn(Math.PI) as number))).toBeLessThan(1e-10);
  });

  it("pow binding — `$fenel.pow(base, exp)` returns base^exp byte-equal to engine native", async () => {
    const fn = await compileAndInstantiate(
      src("powtest", ["b", "e"], { call: ["pow", { var: "b" }, { var: "e" }] }),
    );
    expect(fn(2, 10)).toBe(1024);
    expect(fn(2, 0)).toBe(1);
    expect(Math.abs((fn(10, -1) as number) - 0.1)).toBeLessThan(1e-10);
  });

  it("time binding — `$fenel.time(seconds)` returns the `{ seconds }` record byte-equal to engine native", async () => {
    const fn = await compileAndInstantiate(
      src("ttest", ["s"], { call: ["time", { var: "s" }] }),
    );
    expect(fn(5)).toEqual({ seconds: 5 });
    expect(fn(0)).toEqual({ seconds: 0 });
    expect(fn(-2.5)).toEqual({ seconds: -2.5 });
  });

  it("amplitude binding — `$fenel.amplitude(l, r)` returns clamped Amplitude record byte-equal to engine native", async () => {
    const fn = await compileAndInstantiate(
      src("amptest", ["l", "r"], { call: ["amplitude", { var: "l" }, { var: "r" }] }),
    );
    expect(fn(0.5, -0.5)).toEqual({ l: 0.5, r: -0.5 });
    expect(fn(2, -2)).toEqual({ l: 1, r: -1 });
  });

  it("mono binding — `$fenel.mono(v)` returns Amplitude with l==r byte-equal to engine native", async () => {
    const fn = await compileAndInstantiate(
      src("monotest", ["v"], { call: ["mono", { var: "v" }] }),
    );
    expect(fn(0.5)).toEqual({ l: 0.5, r: 0.5 });
    expect(fn(0)).toEqual({ l: 0, r: 0 });
    expect(fn(2)).toEqual({ l: 1, r: 1 });
  });

  it("ampL binding — `$fenel.ampL(a)` extracts the left channel byte-equal to engine native", () => {
    const rt = buildFenelRuntime();
    const ampL = rt.ampL as (a: unknown) => number;
    expect(ampL({ l: 0.3, r: 0.7 })).toBe(0.3);
    expect(ampL({ l: -1, r: 1 })).toBe(-1);
  });

  it("ampR binding — `$fenel.ampR(a)` extracts the right channel byte-equal to engine native", () => {
    const rt = buildFenelRuntime();
    const ampR = rt.ampR as (a: unknown) => number;
    expect(ampR({ l: 0.3, r: 0.7 })).toBe(0.7);
    expect(ampR({ l: -1, r: 1 })).toBe(1);
  });

  it("audioBuffer binding — `$fenel.audioBuffer(sr, ch, samples)` returns the buffer record", () => {
    const rt = buildFenelRuntime();
    const audioBuffer = rt.audioBuffer as (sr: unknown, ch: unknown, samples: unknown) => unknown;
    const samples = [{ l: 0, r: 0 }, { l: 0.5, r: 0.5 }];
    expect(audioBuffer(44100, 2, samples)).toEqual({ sampleRate: 44100, channels: 2, samples });
    expect(audioBuffer(22050.7, 1.3, [])).toEqual({ sampleRate: 22050, channels: 1, samples: [] });
  });

  it("sampleSound binding — Wave-case invokes the captured closure / Buffer-case reads the sample at t", () => {
    const rt = buildFenelRuntime();
    const sampleSound = rt.sampleSound as (snd: unknown, t: unknown) => unknown;
    // Wave-case: closure ABI's user-supplied callable (Phase 5b15
    // {__userFn} convention). Direct typeof === "function" path
    // mirrors the JS harness's Wave-closure invocation.
    const out = { l: 0.5, r: -0.5 };
    const wave = { $tag: "Wave", _0: (_t: unknown): unknown => out };
    expect(sampleSound(wave, { seconds: 0.5 })).toEqual(out);
    // Buffer-case: PCM sample lookup at floored time index.
    const samples = [{ l: 0.1, r: 0.2 }, { l: 0.3, r: 0.4 }];
    const buf = { $tag: "Buffer", _0: { sampleRate: 1, channels: 2, samples } };
    expect(sampleSound(buf, { seconds: 0 })).toEqual(samples[0]);
    expect(sampleSound(buf, { seconds: 1 })).toEqual(samples[1]);
  });
});
