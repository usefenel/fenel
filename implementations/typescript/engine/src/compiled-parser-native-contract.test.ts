import { describe, expect, test } from "bun:test";
import { KNOWN_PARSER_NATIVES } from "../scripts/generate-compiled-parser-worker";
import { stdNatives } from "../../../../fenel/modules/std/ffi/std-ffi";
import { stdModule } from "./modules/std";
import { compileFenelToJsNative } from "./modules/compile-js";
import { positionalCompileFieldSlots } from "./compile-field-slots";
import { truthy } from "./json-logic";
import { compiledParserNativesAvailable, dispatchedSerializeJsModule, parserBaseRuntimeForTests } from "./engine-bodies-dispatch";

describe("compiled parser native contract", () => {
  test("Boolean native ABI projects the existing callbacks and exact evaluator truthiness", () => {
    const runtime = parserBaseRuntimeForTests();
    expect(runtime.and).toBe(stdModule.nativeImpls?.["std:and"]);
    expect(runtime.or).toBe(stdModule.nativeImpls?.["std:or"]);
    expect(runtime["std:and"]).toBe(runtime.and);
    expect(runtime["std:or"]).toBe(runtime.or);
    expect(runtime.$structuralTruthy).toBe(truthy);
    for (const name of ["and", "or", "std:and", "std:or", "$structuralTruthy"]) {
      expect(compiledParserNativesAvailable([name], runtime)).toBe(true);
      const { [name]: _missing, ...without } = runtime;
      expect(compiledParserNativesAvailable([name], without)).toBe(false);
      expect(compiledParserNativesAvailable([name], Object.create({ [name]: runtime[name] }))).toBe(false);
      let reads = 0;
      const accessor = Object.defineProperty({}, name, { get() { reads++; return runtime[name]; } });
      expect(compiledParserNativesAvailable([name], accessor)).toBe(false);
      expect(reads).toBe(0);
    }
  });

  test("the generator allowlist equals the actual runtime and missing/accessor natives refuse", () => {
    const runtime = parserBaseRuntimeForTests();
    expect([...KNOWN_PARSER_NATIVES].sort()).toEqual(Object.keys(runtime).sort());
    expect(compiledParserNativesAvailable(["join"], runtime)).toBe(true);
    const { join: _join, ...oldRuntime } = runtime;
    expect(compiledParserNativesAvailable(["join"], oldRuntime)).toBe(false);
    expect(compiledParserNativesAvailable(["futureUnknownNative"], runtime)).toBe(false);
    expect(compiledParserNativesAvailable(Array(1), runtime)).toBe(false);
    let reads = 0;
    const accessor = Object.defineProperty({}, "join", { get() { reads++; return runtime.join; } });
    expect(compiledParserNativesAvailable(["join"], accessor)).toBe(false);
    expect(reads).toBe(0);
  });

  test("join has the existing std array-first ABI, including its carrier coercions", () => {
    const join = parserBaseRuntimeForTests().join as (...args: unknown[]) => string;
    for (const args of [
      [["5"], ""], [["1", "2"], ""], [["a", "b"], ","], [["🙂", "β"], ":"],
      [[null, undefined, 2, false], "|"], [["a", "b"], null], ["not-a-list", ","], [null, ""],
    ]) expect(stdNatives.join!(...args)).toBe(join(...args));
    expect(join(["5"], "")).toBe("5");
    expect(join("", ["5"])).toBe("");
  });

  test("identity lexing string operations reuse the existing std leaves and refuse missing runtime slots", () => {
    const runtime = parserBaseRuntimeForTests();
    expect(runtime.lower).toBe(stdModule.nativeImpls?.["std:lower"]);
    expect(runtime.replaceAll).toBe(stdModule.nativeImpls?.["std:replaceAll"]);
    const lower = runtime.lower as (...args: unknown[]) => string;
    const replaceAll = runtime.replaceAll as (...args: unknown[]) => string;
    for (const value of ["ABC-DEF", "İSTANBUL", "Straße 😀", "", null, undefined, 123]) {
      expect(stdNatives.lower!(value)).toBe(lower(value));
    }
    for (const args of [["aaaa", "aa", "$&"], ["😀🦊😀", "😀", "fox"], ["keep", "", "replace"], [null, "x", "y"]]) {
      expect(stdNatives.replaceAll!(...args)).toBe(replaceAll(...args));
    }
    expect(replaceAll("aaaa", "aa", "$&")).toBe("$&$&");
    for (const name of ["lower", "replaceAll"]) {
      expect(compiledParserNativesAvailable([name], runtime)).toBe(true);
      const { [name]: _missing, ...oldRuntime } = runtime;
      expect(compiledParserNativesAvailable([name], oldRuntime)).toBe(false);
      expect(compiledParserNativesAvailable([name], Object.create({ [name]: runtime[name] }))).toBe(false);
      expect(compiledParserNativesAvailable([name], { [name]: true })).toBe(false);
      let reads = 0;
      const accessor = Object.defineProperty({}, name, { get() { reads++; return runtime[name]; } });
      expect(compiledParserNativesAvailable([name], accessor)).toBe(false);
      expect(reads).toBe(0);
    }
  });

  test("predicate traversal natives refuse missing, inherited, nonfunction and accessor runtime slots", () => {
    const runtime = parserBaseRuntimeForTests();
    for (const name of ["entries", "isArray", "isBoolean", "isNull", "isNumber"]) {
      expect(compiledParserNativesAvailable([name], runtime)).toBe(true);
      const { [name]: _missing, ...oldRuntime } = runtime;
      expect(compiledParserNativesAvailable([name], oldRuntime)).toBe(false);
      expect(compiledParserNativesAvailable([name], Object.create({ [name]: runtime[name] }))).toBe(false);
      expect(compiledParserNativesAvailable([name], { [name]: true })).toBe(false);
      let reads = 0;
      const accessor = Object.defineProperty({}, name, { get() { reads++; return runtime[name]; } });
      expect(compiledParserNativesAvailable([name], accessor)).toBe(false);
      expect(reads).toBe(0);
    }
  });

  test("shape predicates have the existing std host-representation ABI", () => {
    const runtime = parserBaseRuntimeForTests();
    const values = [null, undefined, false, true, 0, 1, NaN, Infinity, "", "1", [], [1], {}, Object.create(null), new Number(1), new Boolean(false), () => true];
    for (const name of ["isArray", "isBoolean", "isNull", "isNumber"]) {
      const native = runtime[name] as (value: unknown) => boolean;
      for (const value of values) expect(native(value)).toBe(stdNatives[name]!(value) as boolean);
    }
    expect((runtime.isNull as (value: unknown) => boolean)(undefined)).toBe(true);
    expect((runtime.isNumber as (value: unknown) => boolean)(NaN)).toBe(true);
  });

  test("entries matches std own enumerable string-field behavior and preserves field data", () => {
    const entries = parserBaseRuntimeForTests().entries as (value: unknown) => { key: string; value: unknown }[];
    const record = Object.assign(Object.create({ inherited: 3 }), { first: 1, second: false });
    Object.defineProperty(record, "hidden", { value: 2 });
    record[Symbol("symbol")] = 4;
    const protoData = JSON.parse('{"__proto__":{"and":[false,true]},"last":5}');
    const sparse = [1, , 3];
    for (const value of [null, undefined, "ab", 1, true, [], sparse, {}, Object.create(null), record, protoData]) {
      expect(stdNatives.entries!(value)).toEqual(entries(value));
    }
    expect(entries(record)).toEqual([{ key: "first", value: 1 }, { key: "second", value: false }]);
    expect(entries(protoData)[0]).toEqual({ key: "__proto__", value: { and: [false, true] } });
    expect(entries(protoData)[0]!.value).toBe(protoData.__proto__);
    expect(entries(sparse).map(({ key }) => key)).toEqual(["0", "2"]);
  });

  test("the shipped JS compiler calls join with the correct order in the numeric-prefix expression", () => {
    const namespace = Object.assign(Object.create(null), parserBaseRuntimeForTests(), { Nothing: { $tag: "Nothing" }, True: true, False: false });
    namespace.$fenel = namespace;
    const compile = (name: string, params: string[], body: unknown): string => {
      const compiled = compileFenelToJsNative({ name, params: positionalCompileFieldSlots(params), body });
      if (compiled.$tag !== "Ok") throw new Error(JSON.stringify(compiled));
      const serialized = dispatchedSerializeJsModule(compiled._0);
      if (serialized.$tag !== "Ok") throw new Error(JSON.stringify(serialized));
      namespace[name] = new Function("$ns", `with($ns) { return (${serialized._0}); }`)(namespace);
      return serialized._0;
    };
    // Compile the actual shipped HOF bodies, rather than replacing takeWhile
    // with a handwritten native or bypassing the compiler with a JS fixture.
    for (const name of ["fromMaybe", "takeWhile"]) {
      const fn = stdModule.functions?.find((entry) => entry.id === `std:${name}`);
      if (!fn || fn.body === undefined) throw new Error(`Missing shipped std body: ${name}`);
      compile(name, fn.params.map((param) => param.name), fn.body);
    }
    const emitted = compile("numericPrefix", ["token"], {
      call: ["toNumber", { call: ["join", { call: ["takeWhile", { fn: ["c", { call: ["elem", { var: "c" }, { call: ["chars", "0123456789"] }] }] }, { call: ["chars", { var: "token" }] }] }, ""] }],
    });
    expect(emitted).toMatch(/\$fenel(?:\.join|\["join"\])/);
    for (const token of ["5", "5.5", "12.9", "0.75", "5e3", "8"]) {
      expect(namespace.numericPrefix(token)).toBe(Number.parseInt(token, 10));
    }
  }, 180_000);
});
