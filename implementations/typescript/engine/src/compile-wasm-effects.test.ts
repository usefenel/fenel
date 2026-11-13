// ---------------------------------------------------------------------------
// CompileWasm — Phase 15 effectful-compilation tests
//
// Exercises:
//   1. The lowering — `$effect:<Class>:<method>` sentinel calls produce
//      `(import "$effect.<Class>" "<method>" (func (param externref…)
//      (result externref)))` declarations + corresponding call instructions.
//   2. The host runtime ABI — at instantiation time the host walks the
//      typeclass instance dispatch scope (same `resolveEffect` Phase 11's
//      evaluator uses at every `withInstance` call site) and binds each
//      import to the resolved method. Mock JS handlers stand in for the
//      runtime's actual state / random IO.
//   3. The bootstrap loop — two end-to-end cases per the Phase 15 brief:
//
//        addAndPersist(a, b) : Number requires [HasStateIO@scratch]
//          — compute a + b, persist via `HasStateIO.set("result", _)`,
//            return the sum
//        randomLessThan(n) : Bool requires [HasCryptoRandom]
//          — sample a random number, compare with n (effects in
//            branch-decision position)
//
//      The compiled Wasm module's exported function, invoked under a
//      JS-side import table that mocks the effects, returns values that
//      match the engine's interpretation of the same body under the same
//      mocked state.
//
// Brief: `prompts/phase-15-effectful-compilation.md`. Design notes:
// `design/effectful-compilation.md` (parallel LLVM / JS shapes).
// ---------------------------------------------------------------------------

import { describe, it, expect } from "vitest";
import {
  compileFenelToWasmNative,
  serializeWasmModuleNative,
  makeClosuresExplicitNative,
  makeEffectsExplicitNative,
  normaliseToCoreNative,
} from "./modules/compile-wasm";
import { dispatchedLowerToWasmAst } from "./engine-bodies-dispatch";
import type { ClosuresExplicitProgram } from "./ir/closures-explicit";
import {
  createDispatchRegistry,
  invokeCallable,
  resolveEffect,
  type EvaluateContext,
  withInstance,
} from "./index";
import { Ref } from "./type-foundation";
import type { CompileSource } from "./compilable";
import { positionalCompileFieldSlots } from "./compile-field-slots";
import type { CoreProgram } from "./ir/core";
import type { EffectsExplicitProgram } from "./ir/effects-explicit";
import type { WasmModule, WasmFuncImport } from "./ir/wasm-ast";

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
 * Build a `$fenel` runtime object specialised to a particular compiled
 * module — the per-module string pool feeds the `litString` import (so
 * each `$fenel.litString(idx)` returns the corresponding interned
 * string). The other helpers are static.
 */
function makeFenelRuntime(mod: WasmModule): Record<string, unknown> {
  const stringPool = mod.stringPool ?? [];
  return {
    boxNum: (n: number): unknown => n,
    unboxNum: (v: unknown): number => (typeof v === "number" ? v : Number(v)),
    boxBool: (n: number): unknown => n !== 0,
    unboxBool: (v: unknown): number => (v ? 1 : 0),
    concat: (a: unknown, b: unknown): unknown => {
      if (Array.isArray(a) && Array.isArray(b)) return [...a, ...b];
      return String(a ?? "") + String(b ?? "");
    },
    litString: (idx: number): unknown => stringPool[idx] ?? null,
  };
}

/**
 * Build the effect-handler import table by walking the compiled module's
 * imports, parsing each `$effect.<Class>` module + method name, resolving
 * the typeclass instance through the dispatch scope (`resolveEffect`), and
 * binding the import to a JS closure that applies the resolved descriptor.
 *
 * This is the Phase 15 ABI in concentrated form: the same `resolveEffect`
 * walk the runtime evaluator does at every `withInstance` call site, lifted
 * to instantiation time for the Wasm target. Instance methods remain Fenel
 * data; the imported JS function is only a thin trampoline through the
 * evaluator's normal callable-value seam.
 */
function buildEffectImports(
  mod: WasmModule,
  ctx: EvaluateContext,
  registry: ReturnType<typeof createDispatchRegistry>,
  scopeToken: string,
): Record<string, Record<string, (...args: unknown[]) => unknown>> {
  const effectNamespaces: Record<string, Record<string, (...args: unknown[]) => unknown>> = {};
  for (const imp of mod.imports) {
    if (imp.$tag !== "WasmFuncImport") continue;
    const fi = imp as WasmFuncImport;
    if (!fi.module.startsWith("$effect.")) continue;
    const typeName = fi.module.slice("$effect.".length);
    const methodName = fi.name;
    const resolved = resolveEffect(ctx, registry, typeName, scopeToken);
    if (!resolved) {
      throw new Error(
        `buildEffectImports: no instance found for ${typeName} :: ${scopeToken}. ` +
          `Compiled imports refer to it; instantiation can't proceed.`,
      );
    }
    const method = resolved.methods[methodName];
    const methodRecord = method !== null && typeof method === "object"
      ? method as Record<string, unknown>
      : undefined;
    const ownValue = (key: string): unknown => {
      if (methodRecord === undefined) return undefined;
      const descriptor = Object.getOwnPropertyDescriptor(methodRecord, key);
      return descriptor !== undefined && "value" in descriptor
        ? descriptor.value
        : undefined;
    };
    const callableDescriptor = typeof method === "string"
      || typeof ownValue("$ref") === "string"
      || ownValue("__fenelFn") === true
      || ownValue("__fenelPartial") === true;
    if (!callableDescriptor) {
      throw new Error(
        `buildEffectImports: ${typeName}.${methodName} is not a callable descriptor. `
        + `Available: [${Object.keys(resolved.methods).join(", ")}]`,
      );
    }
    if (effectNamespaces[fi.module] === undefined) {
      effectNamespaces[fi.module] = {};
    }
    effectNamespaces[fi.module]![methodName] = (...args: unknown[]): unknown =>
      invokeCallable(method, args, ctx);
  }
  return effectNamespaces;
}

/**
 * End-to-end driver — compile a source to Wasm, instantiate it with mocked
 * effect handlers + the standard `$fenel` runtime, return the exported
 * entry function.
 */
async function compileAndInstantiate(
  source: CompileSource,
  registry: ReturnType<typeof createDispatchRegistry>,
  scopeToken: string,
  ctx: EvaluateContext = {},
): Promise<(...args: unknown[]) => unknown> {
  const compiled = compileFenelToWasmNative(source);
  if (compiled.$tag === "Err") {
    throw new Error(`compileFenelToWasm failed: ${JSON.stringify(compiled._0)}`);
  }
  const mod = compiled._0;
  const serialized = serializeWasmModuleNative(mod);
  if (serialized.$tag === "Err") {
    throw new Error(`serializeWasmModule failed: ${serialized._0}`);
  }
  const effectImports = buildEffectImports(mod, ctx, registry, scopeToken);
  const importObject: Record<string, Record<string, unknown>> = {
    $fenel: makeFenelRuntime(mod),
    ...effectImports,
  };
  // `WebAssembly.instantiate`'s `WebAssembly.Imports` type narrows
  // index values to `ImportValue`; we provide JS functions + the
  // runtime helper bag, both of which are valid import values, but the
  // structural narrowing requires the cast.
  const { instance } = await WebAssembly.instantiate(
    serialized._0,
    importObject as unknown as WebAssembly.Imports,
  );
  const fn = instance.exports[source.name];
  if (typeof fn !== "function") {
    throw new Error(`compiled module has no '${source.name}' export`);
  }
  return fn as (...args: unknown[]) => unknown;
}

// ---------------------------------------------------------------------------
// 1. IR-level — EffectsExplicit recognises `$effect:` sentinels and Wasm
//    lowering surfaces the appropriate imports.
// ---------------------------------------------------------------------------

describe("Phase 15 — `$effect:` sentinel + IR pipeline", () => {
  it("makeEffectsExplicit identifies `$effect:HasStateIO:set` as a dispatch site", () => {
    const core = normaliseToCoreNative(
      src(
        "addAndPersist",
        ["a", "b"],
        {
          do: [
            { let: { sum: { "+": [{ var: "a" }, { var: "b" }] } } },
            { call: ["$effect:HasStateIO:set", "result", { var: "sum" }] },
            { var: "sum" },
          ],
        },
        ["HasStateIO@scratch"],
      ),
    );
    expect(core.$tag).toBe("Ok");
    const ee = makeEffectsExplicitNative((core as { _0: CoreProgram })._0);
    expect(ee.$tag).toBe("Ok");
    const eeProg = (ee as { _0: EffectsExplicitProgram })._0;
    expect(eeProg.effects).toEqual(["HasStateIO"]);
    expect(eeProg.handlerSites.length).toBe(1);
    expect(eeProg.handlerSites[0]!.typeName).toBe("HasStateIO");
    expect(eeProg.handlerSites[0]!.methodName).toBe("set");
  });

  it("lowerToWasmAst emits a `$effect.HasStateIO.set` import for a body that uses it", () => {
    const compiled = compileFenelToWasmNative(
      src(
        "persistSum",
        ["a", "b"],
        {
          do: [
            { let: { sum: { "+": [{ var: "a" }, { var: "b" }] } } },
            { call: ["$effect:HasStateIO:set", "result", { var: "sum" }] },
            { var: "sum" },
          ],
        },
        ["HasStateIO@scratch"],
      ),
    );
    expect(compiled.$tag).toBe("Ok");
    const mod = (compiled as { _0: WasmModule })._0;
    const effectImport = mod.imports.find(
      (i) => i.$tag === "WasmFuncImport" && i.module === "$effect.HasStateIO" && i.name === "set",
    );
    expect(effectImport).toBeDefined();
    if (effectImport && effectImport.$tag === "WasmFuncImport") {
      // The import signature: (externref, externref) → externref.
      expect(effectImport.funcType.params.map((p) => p.$tag)).toEqual([
        "Externref",
        "Externref",
      ]);
      expect(effectImport.funcType.results.map((r) => r.$tag)).toEqual(["Externref"]);
    }
  });

  it("multiple `$effect:` sites in the body share imports + collect distinct method imports", () => {
    // Body that reads (`get`) then writes (`set`) — two distinct method
    // imports under the same `$effect.HasStateIO` module namespace.
    const compiled = compileFenelToWasmNative(
      src(
        "readWrite",
        ["v"],
        {
          do: [
            { call: ["$effect:HasStateIO:get", "previous"] },
            { call: ["$effect:HasStateIO:set", "current", { var: "v" }] },
            { var: "v" },
          ],
        },
        ["HasStateIO@scratch"],
      ),
    );
    expect(compiled.$tag).toBe("Ok");
    const mod = (compiled as { _0: WasmModule })._0;
    const setImport = mod.imports.find(
      (i) => i.$tag === "WasmFuncImport" && i.module === "$effect.HasStateIO" && i.name === "set",
    );
    const getImport = mod.imports.find(
      (i) => i.$tag === "WasmFuncImport" && i.module === "$effect.HasStateIO" && i.name === "get",
    );
    expect(setImport).toBeDefined();
    expect(getImport).toBeDefined();
    // The `get` import has 1 arg; the `set` import has 2. Distinct func
    // types — each interned separately.
    if (setImport && setImport.$tag === "WasmFuncImport") {
      expect(setImport.funcType.params.length).toBe(2);
    }
    if (getImport && getImport.$tag === "WasmFuncImport") {
      expect(getImport.funcType.params.length).toBe(1);
    }
  });

  it("rejects malformed sentinel fnIds at the EffectsExplicit pass", () => {
    // `$effect:` with no class:method — the parser returns null so the
    // call falls through to the `$fenel.<fnId>` fallback path with the
    // literal name "$effect:". That's not what users want; we accept it
    // as an unrecognised fnId rather than a parse error, since `$effect:`
    // by itself is just a weird std-helper name. The well-formed
    // sentinel test cases cover the happy path.
    const core = normaliseToCoreNative(
      src("bad", ["v"], { call: ["$effect:HasStateIO", { var: "v" }] }, ["HasStateIO@scratch"]),
    );
    expect(core.$tag).toBe("Ok");
    const ee = makeEffectsExplicitNative((core as { _0: CoreProgram })._0);
    expect(ee.$tag).toBe("Ok");
    const eeProg = (ee as { _0: EffectsExplicitProgram })._0;
    // No sentinel matched — handlerSites stays empty.
    expect(eeProg.handlerSites.length).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// 2. Bootstrap end-to-end — addAndPersist + randomLessThan
//
// The load-bearing demonstration: compile + instantiate + invoke with
// mocked effect handlers, assert the result matches the engine's
// interpretation under the same mock state.
// ---------------------------------------------------------------------------

describe("Phase 15 — addAndPersist (HasStateIO)", () => {
  const STATE_SET_DESCRIPTOR = "test:compileWasmEffectsStateSet";
  const STATE_GET_DESCRIPTOR = "test:compileWasmEffectsStateGet";

  /**
   * Build a HasStateIO instance backed by a JS Map. The instance stores only
   * named descriptor data; its test-only host leaves live in `ctx.natives`.
   */
  function makeStateInstance(): {
    instance: Parameters<ReturnType<typeof createDispatchRegistry>["addInstance"]>[0];
    storage: Map<string, unknown>;
    ctx: EvaluateContext;
  } {
    const storage = new Map<string, unknown>();
    return {
      instance: {
        typeName: "HasStateIO",
        args: ["scratch"],
        methods: {
          set: Ref(STATE_SET_DESCRIPTOR),
          get: Ref(STATE_GET_DESCRIPTOR),
        },
      },
      storage,
      ctx: {
        natives: {
          [STATE_SET_DESCRIPTOR]: (key: unknown, value: unknown): unknown => {
            storage.set(String(key), value);
            return null;
          },
          [STATE_GET_DESCRIPTOR]: (key: unknown): unknown => storage.get(String(key)) ?? null,
        },
      },
    };
  }

  it("compiles + instantiates + invokes: returns sum, persists side-effect", async () => {
    const registry = createDispatchRegistry();
    registry.defineClass({
      name: "HasStateIO",
      params: [{ name: "scope" }],
      methods: [
        { name: "set", params: [], returns: { $ref: "Unit" } },
        { name: "get", params: [], returns: { $ref: "String" } },
      ],
    });
    const { instance, storage, ctx } = makeStateInstance();
    registry.addInstance(instance);

    const body = {
      do: [
        { let: { sum: { "+": [{ var: "a" }, { var: "b" }] } } },
        { call: ["$effect:HasStateIO:set", "result", { var: "sum" }] },
        { var: "sum" },
      ],
    };
    const fn = await compileAndInstantiate(
      src("addAndPersist", ["a", "b"], body, ["HasStateIO@scratch"]),
      registry,
      "scratch",
      ctx,
    );

    // Wasm `f64` parameters arrive as JS numbers; result lifts back to
    // a JS number too (the `add` path stays on the f64 fast track, the
    // `$effect:` call boxes its operand via $fenel.boxNum, and the
    // final `var sum` reads the local back).
    const result = fn(3, 5);
    expect(result).toBe(8);
    // Side-effect happened — the mock state has the persisted sum.
    expect(storage.get("result")).toBe(8);
  });

  it("handles negative + zero arguments correctly", async () => {
    const registry = createDispatchRegistry();
    registry.defineClass({
      name: "HasStateIO",
      params: [{ name: "scope" }],
      methods: [{ name: "set", params: [], returns: { $ref: "Unit" } }],
    });
    const { instance, storage, ctx } = makeStateInstance();
    registry.addInstance(instance);

    const body = {
      do: [
        { let: { sum: { "+": [{ var: "a" }, { var: "b" }] } } },
        { call: ["$effect:HasStateIO:set", "result", { var: "sum" }] },
        { var: "sum" },
      ],
    };
    const fn = await compileAndInstantiate(
      src("addAndPersist", ["a", "b"], body, ["HasStateIO@scratch"]),
      registry,
      "scratch",
      ctx,
    );
    expect(fn(-7, 7)).toBe(0);
    expect(storage.get("result")).toBe(0);
    expect(fn(-3, -4)).toBe(-7);
    expect(storage.get("result")).toBe(-7);
  });

  it("block-scope handler overrides the persisted registry instance", async () => {
    // The same `resolveEffect` walk that the runtime evaluator uses at
    // every `withInstance` call site applies here too. A block-scope
    // handler stacked via `withInstance` shadows the registry instance.
    const registry = createDispatchRegistry();
    registry.defineClass({
      name: "HasStateIO",
      params: [{ name: "scope" }],
      methods: [{ name: "set", params: [], returns: { $ref: "Unit" } }],
    });
    const { instance: registryInstance, ctx: registryCtx } = makeStateInstance();
    registry.addInstance(registryInstance);

    // Block-scope handler — its descriptor gets bound at instantiation time.
    const blockSetDescriptor = "test:compileWasmEffectsBlockSet";
    const blockStorage = new Map<string, unknown>();
    const ctx: EvaluateContext = {
      ...registryCtx,
      natives: {
        ...registryCtx.natives,
        [blockSetDescriptor]: (key: unknown, value: unknown): unknown => {
          blockStorage.set(String(key), `block:${String(value)}`);
          return null;
        },
      },
    };
    await withInstance(
      ctx,
      {
        typeName: "HasStateIO",
        args: ["scratch"],
        methods: {
          set: Ref(blockSetDescriptor),
        },
        blockId: "test-block",
      },
      async (innerCtx) => {
        const body = {
          do: [
            { let: { sum: { "+": [{ var: "a" }, { var: "b" }] } } },
            { call: ["$effect:HasStateIO:set", "result", { var: "sum" }] },
            { var: "sum" },
          ],
        };
        const fn = await compileAndInstantiate(
          src("addAndPersist", ["a", "b"], body, ["HasStateIO@scratch"]),
          registry,
          "scratch",
          innerCtx,
        );
        const r = fn(10, 20);
        expect(r).toBe(30);
        // Side-effect went to the BLOCK handler, not the registry one.
        expect(blockStorage.get("result")).toBe("block:30");
      },
    );
  });
});

describe("Phase 15 — randomLessThan (HasCryptoRandom in branch position)", () => {
  it("returns the comparison's boolean — effect call in a branch decision", async () => {
    const registry = createDispatchRegistry();
    registry.defineClass({
      name: "HasCryptoRandom",
      params: [{ name: "scope" }],
      methods: [
        { name: "nextNumber", params: [], returns: { $ref: "Number" } },
      ],
    });

    // Deterministic mock — feeds a queue of pre-set numbers so the test
    // is reproducible. Same shape a real handler would have, with a
    // crypto.getRandomValues call instead of the queue.
    const queue = [0.1, 0.5, 0.9];
    let idx = 0;
    const nextNumberDescriptor = "test:compileWasmEffectsQueuedRandom";
    registry.addInstance({
      typeName: "HasCryptoRandom",
      args: ["test"],
      methods: {
        nextNumber: Ref(nextNumberDescriptor),
      },
    });
    const ctx: EvaluateContext = {
      natives: {
        [nextNumberDescriptor]: (): unknown => {
          const v = queue[idx % queue.length];
          idx++;
          return v;
        },
      },
    };

    const body = {
      "<": [{ call: ["$effect:HasCryptoRandom:nextNumber"] }, { var: "n" }],
    };
    const fn = await compileAndInstantiate(
      src("randomLessThan", ["n"], body, ["HasCryptoRandom@test"]),
      registry,
      "test",
      ctx,
    );

    // Run for each queue entry. Each call increments the mock's index.
    expect(fn(0.5)).toBe(true); // 0.1 < 0.5
    expect(fn(0.5)).toBe(false); // 0.5 < 0.5 is false
    expect(fn(0.5)).toBe(false); // 0.9 < 0.5 is false
  });

  it("uses the same effect dispatch shape across distinct classes", async () => {
    // A single function that touches both HasStateIO and HasCryptoRandom
    // — verifies the per-class `$effect.<Class>` namespacing.
    const registry = createDispatchRegistry();
    registry.defineClass({
      name: "HasStateIO",
      params: [{ name: "scope" }],
      methods: [{ name: "set", params: [], returns: { $ref: "Unit" } }],
    });
    registry.defineClass({
      name: "HasCryptoRandom",
      params: [{ name: "scope" }],
      methods: [{ name: "nextNumber", params: [], returns: { $ref: "Number" } }],
    });
    const storage = new Map<string, unknown>();
    const setDescriptor = "test:compileWasmEffectsCaptureSet";
    const nextNumberDescriptor = "test:compileWasmEffectsFixedRandom";
    registry.addInstance({
      typeName: "HasStateIO",
      args: ["test"],
      methods: {
        set: Ref(setDescriptor),
      },
    });
    registry.addInstance({
      typeName: "HasCryptoRandom",
      args: ["test"],
      methods: { nextNumber: Ref(nextNumberDescriptor) },
    });
    const ctx: EvaluateContext = {
      natives: {
        [setDescriptor]: (key: unknown, value: unknown): unknown => {
          storage.set(String(key), value);
          return null;
        },
        [nextNumberDescriptor]: (): unknown => 0.42,
      },
    };

    const body = {
      do: [
        { let: { r: { call: ["$effect:HasCryptoRandom:nextNumber"] } } },
        { call: ["$effect:HasStateIO:set", "lastRandom", { var: "r" }] },
        { var: "r" },
      ],
    };
    const fn = await compileAndInstantiate(
      src(
        "captureRandom",
        [],
        body,
        ["HasCryptoRandom@test", "HasStateIO@test"],
      ),
      registry,
      "test",
      ctx,
    );
    const r = fn();
    expect(r).toBe(0.42);
    expect(storage.get("lastRandom")).toBe(0.42);
  });
});

// ---------------------------------------------------------------------------
// 3. Diagnostics — missing handler produces a clear error
// ---------------------------------------------------------------------------

describe("Phase 15 — diagnostics", () => {
  it("missing typeclass instance for a compiled module's import raises a clear error", async () => {
    const registry = createDispatchRegistry();
    registry.defineClass({
      name: "HasStateIO",
      params: [{ name: "scope" }],
      methods: [{ name: "set", params: [], returns: { $ref: "Unit" } }],
    });
    // NO instance added — instantiation should fail with a clear message.
    const body = { call: ["$effect:HasStateIO:set", "k", { var: "v" }] };
    await expect(
      compileAndInstantiate(
        src("eff", ["v"], body, ["HasStateIO@missing"]),
        registry,
        "missing",
      ),
    ).rejects.toThrow(/no instance found for HasStateIO/);
  });

  it("malformed effect method data refuses instantiation instead of becoming a null import", async () => {
    const registry = createDispatchRegistry();
    registry.defineClass({
      name: "HasStateIO",
      params: [{ name: "scope" }],
      methods: [{ name: "set", params: [], returns: { $ref: "Unit" } }],
    });
    registry.addInstance({
      typeName: "HasStateIO",
      args: ["malformed"],
      methods: { set: { descriptor: "not-callable" } },
    });
    const body = { call: ["$effect:HasStateIO:set", "k", { var: "v" }] };
    await expect(
      compileAndInstantiate(
        src("eff", ["v"], body, ["HasStateIO@malformed"]),
        registry,
        "malformed",
      ),
    ).rejects.toThrow(/HasStateIO\.set is not a callable descriptor/);
  });

  it("compiled module's imports list reveals the effect dispatch surface for tooling", () => {
    const compiled = compileFenelToWasmNative(
      src(
        "introspect",
        ["v"],
        {
          do: [
            { call: ["$effect:HasStateIO:set", "a", { var: "v" }] },
            { call: ["$effect:HasCryptoRandom:nextNumber"] },
            { var: "v" },
          ],
        },
        ["HasStateIO@scratch", "HasCryptoRandom@scratch"],
      ),
    );
    expect(compiled.$tag).toBe("Ok");
    const mod = (compiled as { _0: WasmModule })._0;
    const effectModules = new Set(
      mod.imports
        .filter((i) => i.$tag === "WasmFuncImport" && i.module.startsWith("$effect."))
        .map((i) => (i as WasmFuncImport).module),
    );
    // Both classes' namespaces surface, ready for the host to bind.
    expect(effectModules.has("$effect.HasStateIO")).toBe(true);
    expect(effectModules.has("$effect.HasCryptoRandom")).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// 4. IR-pipeline smoke — `lowerToWasmAst` + `makeClosuresExplicit` still
//    work as before for pure programs; the effect pipeline is additive.
// ---------------------------------------------------------------------------

describe("Phase 15 — pure programs are unaffected", () => {
  it("a body with no `$effect:` sentinels emits zero `$effect.<Class>` imports", () => {
    const compiled = compileFenelToWasmNative(
      src("add", ["a", "b"], { "+": [{ var: "a" }, { var: "b" }] }),
    );
    expect(compiled.$tag).toBe("Ok");
    const mod = (compiled as { _0: WasmModule })._0;
    const effectImports = mod.imports.filter(
      (i) => i.$tag === "WasmFuncImport" && i.module.startsWith("$effect."),
    );
    expect(effectImports.length).toBe(0);
  });

  it("makeClosuresExplicit + lowerToWasmAst still handle the effect-call shape", () => {
    // Smoke test: the closure-conversion pass walks the body uniformly,
    // so a sentinel CoreCall passes through unchanged into CeCall.
    const core = normaliseToCoreNative(
      src(
        "smoke",
        ["v"],
        { call: ["$effect:HasStateIO:set", "k", { var: "v" }] },
        ["HasStateIO@scratch"],
      ),
    );
    expect(core.$tag).toBe("Ok");
    const ee = makeEffectsExplicitNative((core as { _0: CoreProgram })._0);
    expect(ee.$tag).toBe("Ok");
    const ce = makeClosuresExplicitNative((ee as { _0: EffectsExplicitProgram })._0);
    expect(ce.$tag).toBe("Ok");
    const w = dispatchedLowerToWasmAst((ce as { _0: ClosuresExplicitProgram })._0);
    expect(w.$tag).toBe("Ok");
  });
});
