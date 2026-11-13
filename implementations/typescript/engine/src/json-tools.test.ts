import { beforeAll, describe, expect, test } from "bun:test";
import SOURCE from "../../../../fenel/modules/publicdemo/json-tools.fenel?raw";
import TYPES from "../../../../fenel/modules/publicdemo/import-types.fenel?raw";
import { loadFenelModule, loadFenelModuleUnion } from "./fenel-module";
import { invokeCallable, type EvaluateContext } from "./json-logic";
import { createRegistry, type ModuleRegistry } from "./registry";
import { stdModule } from "./modules/std";
import { codecModule } from "./modules/codec";

// C1: execute the authored source with the real evaluator and JSON codec.
// JSON.parse supplies only the independent output meaning comparison.
let context: EvaluateContext;
let registry: ModuleRegistry;
beforeAll(() => {
  const types = loadFenelModule(TYPES, "ImportDemo");
  const source = loadFenelModuleUnion([{ src: SOURCE, name: "json-tools.fenel" }])[0]!;
  registry = createRegistry([stdModule, codecModule,
    { ...types, entities: types.entities?.filter(entity => entity.id === "ImportTextInput"), functions: [], instances: [] }, source]);
  context = registry.evaluateContext();
}, 180_000);

type Inspection = { $tag: "JsonInspection"; parsed: unknown; compact: string; formatted: string; nodeCount: number; maximumDepth: number };
type Result<T> = { $tag: "Ok"; _0: T } | { $tag: "Err"; _0: string };
const call = (name: string, ...args: unknown[]) => invokeCallable({ $ref: `ImportDemo:${name}` }, args, context);
const input = (text: string) => ({ $tag: "ImportTextInput", text });
const number = (value: number) => ({ $tag: "JsonNumber", value });
const string = (value: string) => ({ $tag: "JsonString", value });
const array = (items: unknown[]) => ({ $tag: "JsonArray", items });
const object = (entries: Array<[string, unknown]>) => ({ $tag: "JsonObject", pairs: entries.map(([key, value]) => ({ $tag: "JsonObjectEntry", key, value })) });
function ok<T>(value: unknown): T {
  const result = value as Result<T>;
  expect(result.$tag).toBe("Ok");
  if (result.$tag !== "Ok") throw new Error(result._0);
  return result._0;
}
function refusal(value: unknown): string {
  const result = value as Result<unknown>;
  expect(result.$tag).toBe("Err");
  if (result.$tag !== "Err") throw new Error("Expected JSON refusal");
  expect(typeof result._0).toBe("string");
  expect(result._0.length).toBeGreaterThan(0);
  return result._0;
}
const inspect = (text: string) => ok<Inspection>(call("inspectJsonInput", input(text)));

describe("bounded ordinary JSON tools", () => {
  test("source owns all algorithms and has honest result signatures", () => {
    expect(loadFenelModule(SOURCE, "ImportDemo").nativeImpls).toBeUndefined();
    for (const name of ["inspectJsonValue", "inspectJsonText", "inspectJsonInput", "formatJsonInput", "minifyJsonInput"]) {
      const fn = registry.getFunction(`ImportDemo:${name}`)!;
      expect(fn.body).toBeDefined();
      expect(fn.returns).not.toEqual({ $record: { fields: [] } });
    }
    expect(registry.getEntity("JsonInspection")!.type).toHaveProperty("$record.fields");
  });

  test("all four source-owned starting inputs execute their real functions", () => {
    const starts = call("jsonDemoStartingInputs") as Array<{ function: unknown; arguments: unknown[] }>;
    expect(starts).toHaveLength(4);
    for (const row of starts) expect((invokeCallable(row.function, row.arguments, context) as Result<unknown>).$tag).toBe("Ok");
  });

  test("nested data supplies its ordinary tree, two formats and value-node statistics", () => {
    const inspected = inspect('{"name":"Fenel","items":[1,true,null,{"text":"Hello 🦊"}]}');
    expect(inspected.nodeCount).toBe(8);
    expect(inspected.maximumDepth).toBe(3);
    expect(inspected.compact).toBe('{"name":"Fenel","items":[1,true,null,{"text":"Hello 🦊"}]}');
    expect(inspected.formatted).toBe('{\n  "name": "Fenel",\n  "items": [\n    1,\n    true,\n    null,\n    {\n      "text": "Hello 🦊"\n    }\n  ]\n}');
    expect(inspected.parsed).toEqual(object([["name", string("Fenel")], ["items", array([number(1), { $tag: "JsonBool", value: true }, { $tag: "JsonNull" }, object([["text", string("Hello 🦊")]])])]]));
    expect(JSON.parse(inspected.formatted)).toEqual(JSON.parse(inspected.compact));
  });

  test.each(["null", "true", "false", "42", '""', "[]", "{}"])("root %s has one data node at depth zero", source => {
    const result = inspect(source);
    expect(result).toMatchObject({ compact: source, formatted: source, nodeCount: 1, maximumDepth: 0 });
  });

  test("distinct prototype-like keys survive every nested object boundary", () => {
    const source = '{"__proto__":{"visible":true},"constructor":1,"prototype":[{"__proto__":false}]}';
    const result = inspect(source);
    expect(result.compact).toBe(source);
    expect(Object.keys(JSON.parse(result.formatted))).toEqual(["__proto__", "constructor", "prototype"]);
    expect(JSON.parse(result.formatted)).toEqual(JSON.parse(source));
  });

  test("string/key quoting preserves escapes, code points and lone UTF-16 surrogates", () => {
    const value = object([['quote"\\\n🦊', string('nul\u0000 tab\t line\n quote" slash\\ 🦊 e\u0301 lone\ud800')]]);
    const result = ok<Inspection>(call("inspectJsonValue", value));
    expect(JSON.parse(result.compact)).toEqual({ ['quote"\\\n🦊']: 'nul\u0000 tab\t line\n quote" slash\\ 🦊 e\u0301 lone\ud800' });
    expect(JSON.parse(result.formatted)).toEqual(JSON.parse(result.compact));
    expect(inspect(result.compact).parsed).toEqual(value);
  });

  test("codec numeric normalization and last-key-wins remain visible, without an exact-number claim", () => {
    expect(inspect('{"a":1,"a":2}').compact).toBe('{"a":2}');
    expect(inspect('{"2":2,"1":1}').compact).toBe('{"1":1,"2":2}');
    expect(inspect("-0").compact).toBe("0");
    expect(inspect("9007199254740993").compact).toBe("9007199254740992");
    for (const source of ["1e400", "-1e400", '{"n":1e400}']) expect(refusal(call("inspectJsonInput", input(source)))).toContain("finite Number");
    for (const value of [NaN, Infinity, -Infinity]) refusal(call("inspectJsonValue", number(value)));
    expect(inspect("1.7976931348623157e308").compact).toBe("1.7976931348623157e+308");
  });

  test("malformed syntax, wrong carriers and duplicate authored keys refuse and valid input recovers", () => {
    for (const source of ["", "{", "[1,]", '{"a":}', "undefined", "NaN", "Infinity", "{} trailing", "/* comment */ {}"])
      for (const fn of ["inspectJsonInput", "formatJsonInput", "minifyJsonInput"]) refusal(call(fn, input(source)));
    for (const value of [null, {}, { $tag: "JsonBool", value: "false" }, array("wrong" as unknown as unknown[]), object([["a", number(1)], ["a", number(2)]])]) refusal(call("inspectJsonValue", value));
    expect(inspect('{"ok":true}').compact).toBe('{"ok":true}');
  });

  test("source and scalar bounds count Unicode code points", () => {
    expect(inspect('"' + "🦊".repeat(4094) + '"').compact).toBe('"' + "🦊".repeat(4094) + '"');
    refusal(call("inspectJsonInput", input('"' + "🦊".repeat(4095) + '"')));
    expect(ok<Inspection>(call("inspectJsonValue", string("🦊".repeat(4096)))).nodeCount).toBe(1);
    refusal(call("inspectJsonValue", string("🦊".repeat(4097))));
    refusal(call("inspectJsonValue", object([["x".repeat(4097), number(1)]])));
  });

  test("global value-node and depth budgets count siblings and nested containers", () => {
    expect(inspect("[" + Array(255).fill("0").join(",") + "]").nodeCount).toBe(256);
    refusal(call("inspectJsonInput", input("[" + Array(256).fill("0").join(",") + "]")));
    expect(inspect("[".repeat(16) + "0" + "]".repeat(16))).toMatchObject({ nodeCount: 17, maximumDepth: 16 });
    refusal(call("inspectJsonInput", input("[".repeat(17) + "0" + "]".repeat(17))));
    const branch = array(Array(127).fill(number(0)));
    refusal(call("inspectJsonValue", array([branch, branch])));
  });

  test("output budgets include scalar expansion, separators, object keys and indentation", () => {
    refusal(call("inspectJsonValue", string("\u0000".repeat(2731))));
    const exact = string("\u0000".repeat(2730) + "xx");
    expect(ok<Inspection>(call("inspectJsonValue", exact)).compact.length).toBe(16384);
    refusal(call("inspectJsonValue", array([exact])));
    const values = array(Array.from({ length: 8 }, () => string("x".repeat(2043))));
    refusal(call("inspectJsonValue", values));
    refusal(call("inspectJsonValue", object([["k".repeat(4096), string("\u0000".repeat(2050))]])));
  });

  test("text formatting and minification use the same normalized data and are idempotent", () => {
    const source = '{ "b": [1, {"a": "escaped \\\" value"}], "a": true }';
    const formatted = ok<string>(call("formatJsonInput", input(source)));
    const compact = ok<string>(call("minifyJsonInput", input(source)));
    expect(JSON.parse(formatted)).toEqual(JSON.parse(source));
    expect(JSON.parse(compact)).toEqual(JSON.parse(source));
    expect(ok<string>(call("formatJsonInput", input(formatted)))).toBe(formatted);
    expect(ok<string>(call("minifyJsonInput", input(compact)))).toBe(compact);
  });
});
