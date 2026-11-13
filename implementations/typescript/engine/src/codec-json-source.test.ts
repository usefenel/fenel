import { describe, expect, test } from "bun:test";
import { invokeCallable, evaluate } from "./json-logic";
import { createEngineBootstrapRegistry } from "./registry";
import { stdModule } from "./modules/std";
import { codecModule, codecNatives, isoBase64, isoJson, isoCanonicalJson, jsonValueExemplifiable } from "./modules/codec";
import { codecHostNatives, wrapJsonValue, type JsonValueWrapped } from "../../../../fenel/modules/codec/ffi/codec-ffi";
import { __getHarnessForTests } from "./engine-bodies-dispatch";
import { Anything, Maybe, List, Result } from "./type-foundation";
import { getLoadedFunctionSignatureDeclaration } from "./signature-declaration-transport";

const registry = createEngineBootstrapRegistry([stdModule, codecModule]);
const ctx = () => registry.evaluateContext();
const call = (name: string, value: unknown) => invokeCallable(`codec:${name}`, [value], ctx());
const ok = (value: unknown) => {
  expect(value).toMatchObject({ $tag: "Ok" });
  return (value as { $tag: "Ok"; _0: unknown })._0;
};
const entry = (key: string, value: JsonValueWrapped) => ({ $tag: "JsonObjectEntry" as const, key, value });
const number = (value: number): JsonValueWrapped => ({ $tag: "JsonNumber", value });

describe("codec source owner and shallow host seam", () => {
  test("existing JSON identities have bodies and cannot be shadowed by facade natives", () => {
    for (const name of ["base64Encode", "base64Decode", "jsonEncode", "jsonDecode", "canonicalJsonEncode", "canonicalJsonDecode", "wrapJsonValue", "unwrapJsonValue"]) {
      expect(codecModule.functions?.find(fn => fn.id === `codec:${name}`)?.body).toBeDefined();
      expect(codecModule.nativeImpls?.[`codec:${name}`]).toBeUndefined();
      expect(typeof codecNatives[name]).toBe("function");
    }
  });

  test("host projection keeps child objects untouched for Fenel to visit", () => {
    const child = { nested: [1, 2] };
    const parts = codecHostNatives.jsonHostParts!({ child }) as { pairs: { _0: Array<{ value: unknown }> } };
    expect(parts.pairs._0[0]!.value).toBe(child);
    const items = codecHostNatives.jsonHostParts!([child]) as { items: { _0: unknown[] } };
    expect(items.items._0[0]).toBe(child);
  });

  test("captured heterogeneous raw slots bind to the existing universal type", () => {
    const pair = codecModule.entities?.find(entity => entity.id === "JsonHostPair")?.type;
    const parts = codecModule.entities?.find(entity => entity.id === "JsonHostParts")?.type;
    expect(pair && "$record" in pair ? pair.$record.fields.find(field => field.name === "value")?.type : undefined).toEqual(Anything);
    expect(pair && "$record" in pair ? pair.$record.fields.find(field => field.name === "key")?.type : undefined).toEqual({ $ref: "String" });
    expect(parts && "$record" in parts ? parts.$record.fields.find(field => field.name === "items")?.type : undefined).toEqual(Maybe(List(Anything)));
    expect(parts && "$record" in parts ? parts.$record.fields.find(field => field.name === "scalar")?.type : undefined).toEqual(Maybe({ $ref: "JsonValue" }));
    expect(parts && "$record" in parts ? parts.$record.fields.find(field => field.name === "pairs")?.type : undefined).toEqual(Maybe(List({ $ref: "JsonHostPair" })));
    for (const name of ["jsonHostParts", "jsonWrappedValue"]) {
      const fn = codecModule.functions?.find(candidate => candidate.id === `codec:${name}`)!;
      expect(fn.params[0]?.type).toEqual(Anything);
      const declaration = getLoadedFunctionSignatureDeclaration(fn)!;
      expect(declaration.scheme?.body).toMatchObject({ $arrow: { params: [{ type: Anything }] } });
    }
    expect(codecModule.functions?.find(fn => fn.id === "codec:jsonHostAssemble")?.returns).toEqual(Anything);
    expect(codecModule.functions?.find(fn => fn.id === "codec:jsonParseHost")?.returns).toEqual(Result({ $ref: "String" }, Anything));
    expect(codecModule.functions?.find(fn => fn.id === "codec:base64ByteValuesHost")?.params[0]?.type).toEqual(Anything);
    expect(codecModule.functions?.find(fn => fn.id === "codec:base64ByteValuesHost")?.returns).toEqual(Maybe(List(Anything)));
    expect(codecModule.functions?.find(fn => fn.id === "codec:decodeJsonString")?.params[0]?.type).toEqual({ $ref: "JsonValue" });
  });

  test("all prior sample values remain source-owned ordinary JsonValue", () => {
    const samples = jsonValueExemplifiable.methods.examples as JsonValueWrapped[];
    expect(samples).toHaveLength(17);
    expect(samples[0]).toEqual({ $tag: "JsonNull" });
    expect(samples[16]).toEqual(wrapJsonValue({ nested: { a: [1, 2], b: { c: null } } }));
  });

  test("adapter enrollment supplies only the pure Duration dependency", () => {
    const harness = __getHarnessForTests();
    expect(harness.reg.getFunction("time:duration")?.body).toBeDefined();
    expect(harness.reg.getFunction("time:now")).toBeUndefined();
    expect(harness.reg.getFunction("time:nowIso")).toBeUndefined();
    expect(harness.ctx.natives?.["time:now"]).toBeUndefined();
  });
});

describe("source-owned strict Base64 and raw host conversion", () => {
  const refused = { $tag: "Err", _0: expect.any(String) };
  const asBytes = (value: unknown) => Array.from(ok(value) as Uint8Array);

  test("canonical vectors retain source, facade and ordinary Iso dispatch", () => {
    for (const [text, values] of [["", []], ["Zg==", [102]], ["Zm8=", [102, 111]], ["Zm9v", [102, 111, 111]], ["AP8=", [0, 255]]] as const) {
      const bytes = Uint8Array.from(values);
      expect(call("base64Encode", bytes)).toEqual({ $tag: "Ok", _0: text });
      expect(codecNatives.base64Encode!(bytes)).toEqual(call("base64Encode", bytes));
      expect(asBytes(call("base64Decode", text))).toEqual([...values]);
      expect(asBytes(codecNatives.base64Decode!(text))).toEqual([...values]);
      expect(evaluate({ call: [isoBase64.methods.encode, { var: "bytes" }] }, { bytes }, ctx())).toEqual({ $tag: "Ok", _0: text });
      expect(asBytes(evaluate({ call: [isoBase64.methods.decode, text] }, {}, ctx()))).toEqual([...values]);
    }
  });

  test("every unused padding-bit combination refuses unless re-encoding preserves the text", () => {
    const alphabet = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";
    for (let index = 0; index < alphabet.length; index++) {
      for (const [text, canonical] of [[`Z${alphabet[index]}==`, index % 16 === 0], [`Zm${alphabet[index]}=`, index % 4 === 0]] as const) {
        const result = call("base64Decode", text);
        if (canonical) expect(call("base64Encode", ok(result))).toEqual({ $tag: "Ok", _0: text });
        else expect(result).toMatchObject(refused);
      }
    }
    for (const text of ["Zh==", "Zm9="]) {
      expect(codecNatives.base64Decode!(text)).toMatchObject(refused);
    }
  });

  test("Fenel rejects malformed alphabet, padding and raw types before invoking the host decoder", () => {
    let hostCalls = 0;
    const original = ctx();
    const guarded = {
      ...original,
      natives: { ...original.natives, "codec:base64DecodeHost": () => { hostCalls++; throw new Error("unexpected host decode"); } },
    };
    for (const text of ["Zg", "Zg=", "Zg===", "A===", "====", "AA=A", "=AAA", "AA==AA==", "Zg==\n", " Zg==", "Zg-_", "🦊AAA", 42, null, undefined]) {
      expect(invokeCallable("codec:base64Decode", [text], guarded)).toMatchObject(refused);
      expect(codecNatives.base64Decode!(text)).toMatchObject(refused);
    }
    expect(hostCalls).toBe(0);
    expect(codecHostNatives.base64Encode).toBeUndefined();
    expect(codecHostNatives.base64Decode).toBeUndefined();
  });

  test("compatibility byte carriers preserve whole bytes and refuse lossy numeric coercion", () => {
    const expected = { $tag: "Ok", _0: "AEH/" };
    for (const carrier of [[0, 65, 255], Uint8Array.of(0, 65, 255), Uint8Array.of(0, 65, 255).buffer]) {
      expect(call("base64Encode", carrier)).toEqual(expected);
      expect(codecNatives.base64Encode!(carrier)).toEqual(expected);
    }
    for (const carrier of [[65.9], [1.5], [-1], [256], [NaN], [Infinity], ["65"], [undefined], Array(1), new Int8Array([65]), {}, Object.create(Uint8Array.prototype), Object.create(ArrayBuffer.prototype)]) {
      expect(call("base64Encode", carrier)).toMatchObject(refused);
      expect(codecNatives.base64Encode!(carrier)).toMatchObject(refused);
    }
    const allBytes = Uint8Array.from({ length: 256 }, (_, index) => index);
    expect(asBytes(call("base64Decode", ok(call("base64Encode", allBytes))))).toEqual([...allBytes]);
    const detached = new ArrayBuffer(1);
    const detachedView = new Uint8Array(detached);
    structuredClone(detached, { transfer: [detached] });
    expect(call("base64Encode", detached)).toMatchObject(refused);
    expect(call("base64Encode", detachedView)).toMatchObject(refused);
  });

  test("browser atob/btoa conversion obeys the same source admission and missing codecs fail closed", () => {
    const descriptors = new Map(["Buffer", "atob", "btoa"].map(name => [name, Object.getOwnPropertyDescriptor(globalThis, name)]));
    try {
      Object.defineProperty(globalThis, "Buffer", { configurable: true, writable: true, value: undefined });
      expect(call("base64Encode", [0, 65, 255])).toEqual({ $tag: "Ok", _0: "AEH/" });
      expect(asBytes(call("base64Decode", "AEH/"))).toEqual([0, 65, 255]);
      expect(call("base64Decode", "Zh==")).toMatchObject(refused);
      expect(call("base64Decode", "Zm9=")).toMatchObject(refused);
      expect(call("base64Decode", "Zg==\n")).toMatchObject(refused);
      Object.defineProperty(globalThis, "btoa", { configurable: true, writable: true, value: undefined });
      expect(call("base64Encode", [102])).toMatchObject(refused);
      expect(call("base64Decode", "Zg==")).toMatchObject(refused);
      Object.defineProperty(globalThis, "atob", { configurable: true, writable: true, value: undefined });
      expect(call("base64Decode", "Zg==")).toMatchObject(refused);
    } finally {
      for (const [name, descriptor] of descriptors) {
        if (descriptor) Object.defineProperty(globalThis, name, descriptor);
        else Reflect.deleteProperty(globalThis, name);
      }
    }
  });
});

describe("shared JSON key and numeric admission", () => {
  const source = '{"__proto__":{"visible":true},"constructor":1,"nested":[{"__proto__":2,"prototype":3}]}';

  test("nested special keys survive decode, ordinary encode and public unwrap", () => {
    const wrapped = ok(call("jsonDecode", source));
    expect(ok(call("jsonEncode", wrapped))).toBe(source);
    const lowered = call("unwrapJsonValue", wrapped) as Record<string, unknown>;
    expect(Object.hasOwn(lowered, "__proto__")).toBe(true);
    expect(Object.getPrototypeOf(lowered)).toBe(Object.prototype);
    expect(lowered.__proto__).toEqual({ visible: true });
    expect(Object.hasOwn((lowered.nested as unknown[])[0] as object, "__proto__")).toBe(true);
    expect(wrapJsonValue(lowered)).toEqual(wrapped as JsonValueWrapped);
    expect(codecNatives.unwrapJsonValue!(wrapped)).toEqual(lowered);
    expect(codecNatives.jsonEncode!(wrapped)).toEqual({ $tag: "Ok", _0: source });
  });

  test("canonical integer-like keys sort lexically at every object level", () => {
    const raw = JSON.parse('{"2":2,"10":10,"nested":{"2":2,"10":10},"__proto__":0,"constructor":1}');
    const expected = '{"10":10,"2":2,"__proto__":0,"constructor":1,"nested":{"10":10,"2":2}}';
    expect(call("canonicalJsonEncode", wrapJsonValue(raw))).toEqual({ $tag: "Ok", _0: expected });
    expect(codecNatives.canonicalJsonEncode!(raw)).toEqual({ $tag: "Ok", _0: expected });
    expect(call("isCanonicalJsonString", expected)).toBe(true);
    expect(call("isCanonicalJsonString", '{"2":2,"10":10}')).toBe(false);
  });

  test("ordinary object order and duplicate pair policy retain their prior meaning", () => {
    const wrapped: JsonValueWrapped = { $tag: "JsonObject", pairs: [entry("z", number(1)), entry("10", number(10)), entry("2", number(2)), entry("z", number(9)), entry("a", number(0))] };
    expect(call("jsonEncode", wrapped)).toEqual({ $tag: "Ok", _0: '{"2":2,"10":10,"z":9,"a":0}' });
    expect(call("canonicalJsonEncode", wrapped)).toEqual({ $tag: "Ok", _0: '{"10":10,"2":2,"a":0,"z":9}' });
    expect(call("unwrapJsonValue", wrapped)).toEqual({ "2": 2, "10": 10, z: 9, a: 0 });
    expect(ok(call("jsonDecode", '{"z":1,"a":0,"z":9}'))).toEqual({ $tag: "JsonObject", pairs: [entry("z", number(9)), entry("a", number(0))] });
  });

  test.each([NaN, Infinity, -Infinity])("nonfinite authored number %s refuses at root/list/object", value => {
    for (const [tree, path] of [[number(value), "(root)"], [{ $tag: "JsonArray", items: [number(value)] }, "[0]"], [{ $tag: "JsonObject", pairs: [entry("n", number(value))] }, "n"]] as const) {
      for (const name of ["jsonEncode", "canonicalJsonEncode"]) {
        const expected = { $tag: "Err", _0: `${name}: non-finite number at ${path}` };
        expect(call(name, tree)).toEqual(expected);
        expect(codecNatives[name]!(tree)).toEqual(expected);
      }
    }
  });

  test.each(["1e400", "[1e400]", '{"n":1e400}'])("overflowing parsed numbers refuse: %s", text => {
    expect(call("jsonDecode", text)).toMatchObject({ $tag: "Err", _0: expect.stringContaining("finite Number") });
    expect(codecNatives.jsonDecode!(text)).toEqual(call("jsonDecode", text));
  });

  test("finite scalar normalization, quoting and raw facade compatibility stay", () => {
    for (const raw of [null, true, false, -0, 0.125, Number.MAX_VALUE, 'a"\\\n😀', [], { b: 2, a: 1 }]) {
      const wrapped = wrapJsonValue(raw);
      expect(ok(call("jsonEncode", wrapped))).toBe(JSON.stringify(raw));
      expect(ok(codecNatives.jsonEncode!(raw))).toBe(JSON.stringify(raw));
      expect(ok(call("jsonDecode", JSON.stringify(raw)))).toEqual(Object.is(raw, -0) ? number(0) : wrapped);
    }
    expect(call("wrapJsonValue", undefined)).toEqual({ $tag: "JsonNull" });
    expect(codecNatives.jsonEncode!(undefined)).toMatchObject({ $tag: "Err" });
    expect(codecNatives.jsonEncode!(() => 1)).toMatchObject({ $tag: "Err" });
  });

  test("malformed scalar and container carriers cannot silently become other JSON data", () => {
    for (const value of [{ $tag: "JsonString", value: 42 }, { $tag: "JsonBool", value: "false" }, { $tag: "JsonNumber", value: "1" }, { $tag: "JsonArray", items: "wrong" }, { $tag: "JsonObject", pairs: "wrong" }, { $tag: "JsonObject", pairs: [{ key: 42, value: number(1) }] }, { $tag: "Unknown" }]) {
      expect(codecNatives.jsonEncode!(value)).toMatchObject({ $tag: "Err" });
    }
  });

  test("the two existing Iso values dispatch to the same repaired source", () => {
    const wrapped = ok(call("jsonDecode", source));
    const ordinary = evaluate({ call: [{ var: "encode" }, { var: "input" }] }, { ...isoJson.methods, input: wrapped }, ctx());
    expect(ordinary).toEqual({ $tag: "Ok", _0: source });
    const canonical = evaluate({ call: [{ var: "encode" }, { var: "input" }] }, { ...isoCanonicalJson.methods, input: wrapped }, ctx());
    expect(ok(canonical)).toBe('{"__proto__":{"visible":true},"constructor":1,"nested":[{"__proto__":2,"prototype":3}]}');
    expect(evaluate({ call: [{ var: "decode" }, { var: "input" }] }, { ...isoJson.methods, input: ok(ordinary) }, ctx())).toEqual({ $tag: "Ok", _0: wrapped });
  });
});
