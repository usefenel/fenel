import { describe, expect, it } from "vitest";
// Populate every browser-safe lazy engine module before the compiler dispatch
// harness is first requested. This is the same ordering as the public barrel.
import "./index";
import { compileFenelToJsNative } from "./modules/compile-js";
import {
  compileFenelToWasmNative,
  serializeWasmModuleNative,
} from "./modules/compile-wasm";
import { dispatchedSerializeJsModule } from "./engine-bodies-dispatch";
import {
  buildFenelRuntime,
  buildWasmCompilerEvaluationData,
  rewireClosureHandles,
  type AdtHandle,
} from "./compile-wasm-self-host-classifier";
import {
  buildLlvmCompilerEvaluationData,
  defineLlvmMarshalledOwnField,
} from "./compile-llvm-self-host-classifier";
import { buildCompilerEvaluationData } from "./compile-js-self-host-classifier";
import type { CompileFieldSlot, CompileSource } from "./compilable";
import { positionalCompileFieldSlots } from "./compile-field-slots";

const hostileSlots: readonly CompileFieldSlot[] = [
  {
    key: {
      $tag: "NamedField",
      ref: { $ref: "11111111-1111-4111-8111-111111111111" },
    },
    wireName: "__proto__",
  },
  {
    key: {
      $tag: "NamedField",
      ref: { $ref: "22222222-2222-4222-8222-222222222222" },
    },
    wireName: "constructor",
  },
];

function hostileConstructSource(name: string): CompileSource {
  const fields = Object.create(null) as Record<string, unknown>;
  Object.defineProperty(fields, "__proto__", {
    value: "proto-value",
    enumerable: true,
    configurable: true,
    writable: true,
  });
  Object.defineProperty(fields, "constructor", {
    value: "constructor-value",
    enumerable: true,
    configurable: true,
    writable: true,
  });
  return {
    name,
    params: [],
    body: { construct: ["IdentityBearing", fields] },
    ctorDefs: { IdentityBearing: hostileSlots },
  };
}

function hostilePatternSource(name: string): CompileSource {
  const pattern = Object.create(null) as Record<string, unknown>;
  Object.defineProperty(pattern, "$tag", {
    value: "IdentityBearing",
    enumerable: true,
    configurable: true,
    writable: true,
  });
  Object.defineProperty(pattern, "__proto__", {
    value: { $bind: "protoValue" },
    enumerable: true,
    configurable: true,
    writable: true,
  });
  Object.defineProperty(pattern, "constructor", {
    value: { $bind: "constructorValue" },
    enumerable: true,
    configurable: true,
    writable: true,
  });
  return {
    name,
    params: positionalCompileFieldSlots(["input"]),
    body: {
      match: [
        { var: "input" },
        pattern,
        "own-hostile-fields",
        { $tag: "IdentityBearing" },
        "fallback",
      ],
    },
    ctorDefs: { IdentityBearing: hostileSlots },
  };
}

function expectHostileOwnFields(value: unknown): void {
  expect(value).toBeTypeOf("object");
  expect(value).not.toBeNull();
  const record = value as Record<string, unknown>;
  expect(Object.getPrototypeOf(record)).toBe(Object.prototype);
  expect(Object.prototype.hasOwnProperty.call(record, "__proto__")).toBe(true);
  expect(Object.prototype.hasOwnProperty.call(record, "constructor")).toBe(true);
  expect(record["__proto__"]).toBe("proto-value");
  expect(record["constructor"]).toBe("constructor-value");
  expect(record["$tag"]).toBe("IdentityBearing");
}

describe("identity-bearing hostile compiler field names", () => {
  it("all target classifiers build null-prototype own-only parameter environments", () => {
    const params = hostileSlots.map((slot) => ({
      name: slot.wireName,
      key: slot.key,
    }));
    const builders = [
      buildCompilerEvaluationData,
      buildWasmCompilerEvaluationData,
      buildLlvmCompilerEvaluationData,
    ];
    for (const build of builders) {
      const data = build(params, ["proto-value", "constructor-value"]);
      expect(Object.getPrototypeOf(data)).toBeNull();
      expect(Object.prototype.hasOwnProperty.call(data, "__proto__")).toBe(true);
      expect(Object.prototype.hasOwnProperty.call(data, "constructor")).toBe(true);
      expect(data["__proto__"]).toBe("proto-value");
      expect(data["constructor"]).toBe("constructor-value");
    }
  });

  it("JS serializer emits computed own properties without changing the prototype", () => {
    const compiled = compileFenelToJsNative(hostileConstructSource("hostileJs"));
    expect(compiled.$tag).toBe("Ok");
    if (compiled.$tag !== "Ok") return;
    const serialized = dispatchedSerializeJsModule(compiled._0);
    expect(serialized.$tag).toBe("Ok");
    if (serialized.$tag !== "Ok") return;
    expect(serialized._0).toContain('["__proto__"]');
    expect(serialized._0).toContain('["constructor"]');
    // eslint-disable-next-line @typescript-eslint/no-implied-eval, no-new-func
    const fn = new Function("$fenel", `return ${serialized._0};`)({}) as () => unknown;
    expectHostileOwnFields(fn());
  });

  it("JS resolved patterns reject absent/inherited hostile fields and accept own fields", () => {
    const compiled = compileFenelToJsNative(hostilePatternSource("hostilePatternJs"));
    expect(compiled.$tag).toBe("Ok");
    if (compiled.$tag !== "Ok") return;
    const serialized = dispatchedSerializeJsModule(compiled._0);
    expect(serialized.$tag).toBe("Ok");
    if (serialized.$tag !== "Ok") return;
    expect(serialized._0).toContain("$fenel.hasOwn");
    // eslint-disable-next-line @typescript-eslint/no-implied-eval, no-new-func
    const fn = new Function("$fenel", `return ${serialized._0};`)({
      hasOwn: (value: unknown, key: unknown): boolean =>
        value !== null
        && typeof value === "object"
        && Object.prototype.hasOwnProperty.call(value, String(key)),
      matchFail: (): null => null,
    }) as (value: unknown) => unknown;

    expect(fn({ $tag: "IdentityBearing" })).toBe("fallback");
    const inheritedFields = Object.create(null) as Record<string, unknown>;
    Object.defineProperty(inheritedFields, "__proto__", {
      value: "inherited-proto",
      enumerable: true,
    });
    Object.defineProperty(inheritedFields, "constructor", {
      value: "inherited-constructor",
      enumerable: true,
    });
    const inherited = Object.create(inheritedFields) as Record<string, unknown>;
    Object.defineProperty(inherited, "$tag", {
      value: "IdentityBearing",
      enumerable: true,
    });
    expect(fn(inherited)).toBe("fallback");

    const own = Object.create(Object.prototype) as Record<string, unknown>;
    Object.defineProperty(own, "$tag", {
      value: "IdentityBearing",
      enumerable: true,
    });
    Object.defineProperty(own, "__proto__", {
      value: "proto-value",
      enumerable: true,
    });
    Object.defineProperty(own, "constructor", {
      value: "constructor-value",
      enumerable: true,
    });
    expect(fn(own)).toBe("own-hostile-fields");
  });

  it("Wasm named-field ABI writes and reads own properties only", async () => {
    const compiled = compileFenelToWasmNative(hostileConstructSource("hostileWasm"));
    expect(compiled.$tag).toBe("Ok");
    if (compiled.$tag !== "Ok") return;
    const serialized = serializeWasmModuleNative(compiled._0);
    expect(serialized.$tag).toBe("Ok");
    if (serialized.$tag !== "Ok") return;
    const { rt, setInstance } = buildFenelRuntime(compiled._0.stringPool ?? []);
    const result = await WebAssembly.instantiate(serialized._0, {
      $fenel: rt as unknown as WebAssembly.ModuleImports,
    });
    setInstance(result.instance);
    const fn = (result.instance.exports as Record<string, unknown>)["hostileWasm"] as
      | (() => unknown)
      | undefined;
    expect(fn).toBeTypeOf("function");
    if (fn === undefined) return;
    expectHostileOwnFields(fn());

    const getNamed = rt["getFieldNamed"] as (v: AdtHandle, name: unknown) => unknown;
    const hasNamed = rt["hasFieldNamed"] as (v: AdtHandle, name: unknown) => number;
    const inherited = Object.create({ constructor: "inherited" }) as AdtHandle;
    expect(getNamed(inherited, "constructor")).toBeUndefined();
    expect(getNamed(inherited, "__proto__")).toBeUndefined();
    expect(hasNamed(inherited, "constructor")).toBe(0);
    expect(hasNamed(inherited, "__proto__")).toBe(0);
  });

  it("Wasm runtime installs only direct bodyless registry natives", () => {
    const nativeImports = {
      imports: ["mapGet", "at", "isNull", "some", "picture:rasterAt"].map((name) => ({
        $tag: "WasmFuncImport" as const,
        module: "$fenel",
        name,
        funcType: { $tag: "WasmFuncType" as const, params: [], results: [] },
      })),
    };
    const { rt } = buildFenelRuntime([], nativeImports);

    expect(Object.getPrototypeOf(rt)).toBeNull();
    expect((rt.mapGet as (record: unknown, key: unknown) => unknown)(
      { present: 7 },
      "present",
    )).toEqual({ $tag: "Just", _0: 7 });
    expect((rt.at as (values: unknown, index: unknown) => unknown)(["first"], 0))
      .toBe("first");
    expect((rt.isNull as (value: unknown) => unknown)(null)).toBe(true);
    // `some` is an ambiguous bare spelling (`std:some` / `engine:some`), so
    // the runtime must not pick either native by iteration order.
    expect(Object.prototype.hasOwnProperty.call(rt, "some")).toBe(false);
    // A Fenel-bodied helper stays owned by the lazy self-host compiler even
    // when imported under its exact id.
    expect(Object.prototype.hasOwnProperty.call(rt, "picture:rasterAt")).toBe(false);
  });

  it("Wasm closure rewiring preserves prototypes and hostile own data", () => {
    const source = {} as Record<string, unknown>;
    Object.defineProperty(source, "__proto__", {
      value: "proto-value",
      enumerable: true,
      configurable: true,
      writable: true,
    });
    Object.defineProperty(source, "constructor", {
      value: "constructor-value",
      enumerable: true,
      configurable: true,
      writable: true,
    });
    const instance = { exports: {} } as unknown as WebAssembly.Instance;
    const rewired = rewireClosureHandles(source, instance) as Record<string, unknown>;
    expectHostileOwnFields({ $tag: "IdentityBearing", ...rewired });

    const nullPrototypeSource = Object.create(null) as Record<string, unknown>;
    Object.defineProperty(nullPrototypeSource, "__proto__", {
      value: "proto-value",
      enumerable: true,
      configurable: true,
      writable: true,
    });
    const nullPrototypeRewired = rewireClosureHandles(
      nullPrototypeSource,
      instance,
    ) as Record<string, unknown>;
    expect(Object.getPrototypeOf(nullPrototypeRewired)).toBeNull();
    expect(Object.prototype.hasOwnProperty.call(nullPrototypeRewired, "__proto__")).toBe(true);
    expect(nullPrototypeRewired["__proto__"]).toBe("proto-value");
  });

  it("LLVM return marshalling defines hostile names without prototype mutation", () => {
    const out: Record<string, unknown> = { $tag: "IdentityBearing" };
    defineLlvmMarshalledOwnField(out, "__proto__", "proto-value");
    defineLlvmMarshalledOwnField(out, "constructor", "constructor-value");
    expectHostileOwnFields(out);

    const nullPrototypeOut = Object.create(null) as Record<string, unknown>;
    defineLlvmMarshalledOwnField(nullPrototypeOut, "__proto__", "proto-value");
    expect(Object.getPrototypeOf(nullPrototypeOut)).toBeNull();
    expect(Object.prototype.hasOwnProperty.call(nullPrototypeOut, "__proto__")).toBe(true);
  });
});
