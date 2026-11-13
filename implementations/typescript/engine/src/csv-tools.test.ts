import { beforeAll, describe, expect, test } from "bun:test";
import TYPES from "../../../../fenel/modules/publicdemo/import-types.fenel?raw";
import IMPORT from "../../../../fenel/modules/publicdemo/import-demo.fenel?raw";
import SOURCE from "../../../../fenel/modules/publicdemo/csv-tools.fenel?raw";
import { loadFenelModuleUnion } from "./fenel-module";
import { invokeCallable, type EvaluateContext } from "./json-logic";
import { createRegistry, type ModuleRegistry } from "./registry";
import { stdModule } from "./modules/std";
import { codecModule } from "./modules/codec";

// C1: actual source/evaluator/codec acceptance harness. The small fixture keeps
// strict purchase CSV helpers unchanged; no test-local parser replaces them.
let registry: ModuleRegistry;
let context: EvaluateContext;
beforeAll(() => {
  const module = loadFenelModuleUnion([TYPES, IMPORT, SOURCE].map(src => ({ src, name: "ImportDemo" })))[0]!;
  const csvLeaves = new Set([
    "importTextAdmitted", "importTextLimitMessage", "importCsvFailure", "importCsvAppend",
    "importCsvEndField", "importCsvBareStep", "importCsvQuotedStep", "importCsvClosedStep",
    "importCsvStep", "importCsvLine", "importCsvPhysicalLine", "importCsvEscapeCharacter", "importCsvString",
  ]);
  const csvEntities = new Set(["ImportTextInput", "ImportCsvMode", "ImportCsvState", "CsvTable", "CsvInspection", "CsvReadState"]);
  registry = createRegistry([stdModule, codecModule, {
    ...module,
    functions: module.functions?.filter(fn => {
      const name = fn.id.split(/[:.]/).at(-1)!;
      return name.startsWith("csv") || name === "inspectCsvInput" || name === "jsonTextToCsvInput" || csvLeaves.has(name);
    }),
    entities: module.entities?.filter(entity => csvEntities.has(entity.id)),
    instances: [],
  }]);
  context = registry.evaluateContext();
}, 180_000);

type CsvTable = { $tag: "CsvTable"; headers: string[]; rows: string[][] };
type CsvInspection = { $tag: "CsvInspection"; table: CsvTable; rowCount: number; columnCount: number; json: string };
type Result<T> = { $tag: "Ok"; _0: T } | { $tag: "Err"; _0: string };
const call = (name: string, ...args: unknown[]) => invokeCallable({ $ref: `ImportDemo:${name}` }, args, context);
const input = (text: unknown) => ({ $tag: "ImportTextInput", text });
const table = (headers: string[], rows: string[][]): CsvTable => ({ $tag: "CsvTable", headers, rows });
const string = (value: unknown) => ({ $tag: "JsonString", value });
const object = (entries: Array<[string, unknown]>) => ({ $tag: "JsonObject", pairs: entries.map(([key, value]) => ({ $tag: "JsonObjectEntry", key, value })) });
const array = (items: unknown[]) => ({ $tag: "JsonArray", items });
function ok<T>(value: unknown): T {
  const result = value as Result<T>;
  expect(result.$tag, JSON.stringify(result)).toBe("Ok");
  if (result.$tag !== "Ok") throw new Error(result._0);
  return result._0;
}
function refusal(value: unknown): string {
  const result = value as Result<unknown>;
  expect(result.$tag, JSON.stringify(result)).toBe("Err");
  if (result.$tag !== "Err") throw new Error("Expected CSV refusal");
  expect(typeof result._0).toBe("string");
  expect(result._0.length).toBeGreaterThan(0);
  return result._0;
}

describe("bounded general CSV and JSON text tables", () => {
  test("depth refusals recover and existing maximum row/column breadth remains admitted", () => {
    for (const text of ["[".repeat(1000) + "0" + "]".repeat(1000), '{"n":'.repeat(1000) + "0" + "}".repeat(1000)])
      expect(refusal(call("jsonTextToCsvInput", input(text)))).toContain("maximum value depth 16");
    expect(ok<string>(call("jsonTextToCsvInput", input('[{"fixed":"true"}]')))).toBe('"fixed"\n"true"');
    const headers = Array.from({ length: 32 }, (_, index) => String(index));
    const row = Object.fromEntries(headers.map(key => [key, ""]));
    const text = JSON.stringify(Array.from({ length: 64 }, () => row));
    expect(text.length).toBeLessThanOrEqual(16384);
    expect(ok<CsvTable>(call("csvTableFromJsonText", text))).toEqual(table(headers, Array.from({ length: 64 }, () => Array(32).fill(""))));
  }, 60_000);

  test("source owns the generic operations, table shape and executable samples", () => {
    for (const name of ["inspectCsvInput", "csvTextToJsonInput", "jsonTextToCsvInput", "csvTableFromText", "csvTableFromJsonValue", "csvTableToText", "csvTableToJson"]) {
      const fn = registry.getFunction(`ImportDemo:${name}`)!;
      expect(fn.body).toBeDefined();
      expect(fn.returns).not.toEqual({ $record: { fields: [] } });
    }
    expect(registry.getEntity("CsvTable")!.type).toHaveProperty("$record.fields");
    const starts = call("csvDemoStartingInputs") as Array<{ function: unknown; arguments: unknown[] }>;
    expect(starts).toHaveLength(3);
    for (const row of starts) expect((invokeCallable(row.function, row.arguments, context) as Result<unknown>).$tag).toBe("Ok");
  });

  test("inspection retains arbitrary named columns, leading zeros, Unicode and empty text", () => {
    const text = 'name,code,note\r\n"Ada, 🦊",001,"He said ""hello"""\r\nBo,002,""\r\n';
    const inspected = ok<CsvInspection>(call("inspectCsvInput", input(text)));
    expect(inspected.table).toEqual(table(["name", "code", "note"], [["Ada, 🦊", "001", 'He said "hello"'], ["Bo", "002", ""]]));
    expect(inspected.rowCount).toBe(2);
    expect(inspected.columnCount).toBe(3);
    expect(JSON.parse(inspected.json)).toEqual([{ name: "Ada, 🦊", code: "001", note: 'He said "hello"' }, { name: "Bo", code: "002", note: "" }]);
    expect(ok<string>(call("csvTextToJsonInput", input(text)))).toBe(inspected.json);
    expect(ok<CsvTable>(call("csvTableFromText", ok<string>(call("jsonTextToCsvInput", input(inspected.json)))))).toEqual(inspected.table);
  });

  test.each(["\n", "\r\n", "\r"])("quoted cells retain embedded %j through the typed table and both conversions", separator => {
    const note = `first${separator}${separator}He said "hello", 🦊${separator}last`;
    const expected = table(["name", "code", "note"], [["Ada", "001", note], ["Bo", "002", ""]]);
    const text = `name,code,note\r\nAda,001,"${note.replaceAll('"', '""')}"\r\nBo,002,""\r\n`;
    const inspected = ok<CsvInspection>(call("inspectCsvInput", input(text)));
    expect(inspected.table).toEqual(expected);
    expect(inspected.rowCount).toBe(2);
    expect(inspected.columnCount).toBe(3);
    expect(JSON.parse(inspected.json)).toEqual([{ name: "Ada", code: "001", note }, { name: "Bo", code: "002", note: "" }]);
    expect(ok<CsvTable>(call("csvTableFromJsonText", inspected.json))).toEqual(expected);
    const normalized = ok<string>(call("jsonTextToCsvInput", input(inspected.json)));
    expect(normalized).toBe(`"name","code","note"\n"Ada","001","${note.replaceAll('"', '""')}"\n"Bo","002",""`);
    expect(ok<CsvTable>(call("csvTableFromText", normalized))).toEqual(expected);
    expect(JSON.parse(ok<string>(call("csvTextToJsonInput", input(normalized))))).toEqual(JSON.parse(inspected.json));
  });

  test("mixed embedded separators and doubled quotes keep record boundaries independent", () => {
    const text = 'h\n"a""\nb\r\nc\rd"\n"next"';
    expect(ok<CsvTable>(call("csvTableFromText", text))).toEqual(table(["h"], [['a"\nb\r\nc\rd'], ["next"]]));
    expect(ok<CsvTable>(call("csvTableFromText", 'h\n"a"\nb'))).toEqual(table(["h"], [["a"], ["b"]]));
    expect(ok<CsvTable>(call("csvTableFromText", 'h\n""\n""'))).toEqual(table(["h"], [[""], [""]]));
  });

  test("multiline records preserve physical error lines and keep strict purchase helpers unchanged", () => {
    expect(refusal(call("csvTableFromText", 'h\n"a\nb"\nstray"quote'))).toContain("CSV line 4:");
    expect(refusal(call("csvTableFromText", 'h\n"a\nb",extra'))).toContain("CSV line 3 must have the same number of cells");
    expect(refusal(call("csvTableFromText", 'h\n"a\nb\n'))).toContain("CSV line 4: Unclosed CSV quote");
    expect(refusal(call("csvTableFromText", '"multi\nline"\nx'))).toContain("CSV line 1:");
    for (const cell of ["first\nsecond", "first\r\nsecond", "first\rsecond"]) {
      refusal(call("importCsvLine", `"${cell}"`));
      refusal(call("importCsvString", cell));
    }
  });

  test("logical row limits and the exact source bound include embedded physical lines", () => {
    const record = '"first\n\nlast"';
    expect(ok<CsvTable>(call("csvTableFromText", "h\n" + Array(64).fill(record).join("\n"))).rows).toHaveLength(64);
    expect(refusal(call("csvTableFromText", "h\n" + Array(65).fill(record).join("\n")))).toContain("64 CSV data rows");
    const cell = "x".repeat(16379) + "\n";
    const exact = `h\n"${cell}"`;
    expect(exact.length).toBe(16384);
    expect(ok<CsvTable>(call("csvTableFromText", exact))).toEqual(table(["h"], [[cell]]));
    refusal(call("csvTableFromText", exact + "\n"));
    const manyLines = "\n".repeat(16380);
    expect(`h\n"${manyLines}"`.length).toBe(16384);
    expect(ok<CsvTable>(call("csvTableFromText", `h\n"${manyLines}"`))).toEqual(table(["h"], [[manyLines]]));
  }, 60_000);

  test("header-only inspection retains the header while [] explicitly cannot recover it", () => {
    for (const text of ["name,code", "name,code\n", "name,code\r\n"]) {
      expect(ok<CsvInspection>(call("inspectCsvInput", input(text)))).toEqual({ $tag: "CsvInspection", table: table(["name", "code"], []), rowCount: 0, columnCount: 2, json: "[]" });
    }
    expect(refusal(call("jsonTextToCsvInput", input("[]")))).toContain("headers");
    expect(ok<CsvTable>(call("csvTableFromText", 'name\n""'))).toEqual(table(["name"], [[""]]));
  });

  test("header-only JSON output needs no quoted-key budget at the exact source limit", () => {
    const header = "h".repeat(16384);
    const expected = table([header], []);
    expect(ok<CsvInspection>(call("inspectCsvInput", input(header)))).toEqual({ $tag: "CsvInspection", table: expected, rowCount: 0, columnCount: 1, json: "[]" });
    expect(ok<string>(call("csvTextToJsonInput", input(header)))).toBe("[]");
    expect(ok<string>(call("csvTableToJson", expected))).toBe("[]");
    refusal(call("csvTableToJson", table([header + "h"], [])));
  });

  test("JSON key order differs safely; all cells remain literal strings", () => {
    const text = '[{"name":"Ada","code":"001","enabled":"false"},{"enabled":"null","code":"1e2","name":"Bo"}]';
    const normalized = ok<string>(call("jsonTextToCsvInput", input(text)));
    expect(normalized).toBe('"name","code","enabled"\n"Ada","001","false"\n"Bo","1e2","null"');
    expect(JSON.parse(ok<string>(call("csvTextToJsonInput", input(normalized))))).toEqual(JSON.parse(text));
  });

  test("special and integer-like keys survive existing pair-tree codec normalization", () => {
    const csv = '__proto__,constructor,$tag,10,2\nvisible,ordinary,data,ten,two';
    const json = ok<string>(call("csvTextToJsonInput", input(csv)));
    const decoded = JSON.parse(json) as Array<Record<string, string>>;
    expect(Object.hasOwn(decoded[0]!, "__proto__")).toBe(true);
    expect(decoded[0]!.__proto__).toBe("visible");
    expect(Object.getOwnPropertyDescriptor(decoded[0]!, "constructor")?.value).toBe("ordinary");
    expect(decoded[0]!.$tag).toBe("data");
    const again = ok<string>(call("jsonTextToCsvInput", input(json)));
    expect(JSON.parse(ok<string>(call("csvTextToJsonInput", input(again))))).toEqual(decoded);
  });

  test.each([
    "", ",code\nx,001", "name,name\nAda,Bo", '"",code\nx,001',
    "name,code\nAda", "name\nAda,extra", 'name\n"unfinished', 'name\nA"da', 'name\n"Ada" ',
    "name\r", "name\nAda\r", "name\n\nAda", "name\nAda\n\n", 'name\n"Ada"\r',
    'name\n"a\nb" ', 'name\n"a\nb"x', 'name\n"a\nb"\r', 'name\n"a\nb"\n\n',
    'name\n"a\n', 'name\n"a\r\n', "name\na\rb", '"multi\nline"\nx',
  ])("the shared CSV parser and generic header/width policy refuse %j", text => {
    refusal(call("inspectCsvInput", input(text)));
    refusal(call("csvTextToJsonInput", input(text)));
  });

  test.each([
    "{", "null", "true", "42", '"text"', "{}", "[]", "[{}]", '[{"":"x"}]',
    '[{"name":1}]', '[{"name":true}]', '[{"name":null}]', '[{"name":[]}]', '[{"name":{}}]',
    '[{"name":"Ada"},null]', '[{"name":"Ada"},{"code":"001"}]', '[{"name":"Ada"},{"name":"Bo","extra":"x"}]',
    '[{"multi\\nline":"value"}]', '[{"multi\\rline":"value"}]',
  ])("JSON admission refuses unsupported %j", text => {
    refusal(call("jsonTextToCsvInput", input(text)));
  });

  test("text duplicate keys use the codec policy; authored duplicate pairs refuse", () => {
    expect(ok<string>(call("jsonTextToCsvInput", input('[{"name":"old","name":"new"}]')))).toBe('"name"\n"new"');
    refusal(call("csvTableFromJsonValue", array([object([["name", string("old")], ["name", string("new")]])])));
    refusal(call("csvTableFromJsonValue", array([object([["name", string(123)]])])));
  });

  test("source, rows, columns and malformed authored shapes have explicit bounds", () => {
    expect(ok<CsvTable>(call("csvTableFromText", "name\n" + Array(64).fill("Ada").join("\n"))).rows).toHaveLength(64);
    refusal(call("csvTableFromText", "name\n" + Array(65).fill("Ada").join("\n")));
    const headers = Array.from({ length: 32 }, (_, i) => `h${i}`);
    expect(ok<CsvTable>(call("csvTableFromText", headers.join(","))).headers).toHaveLength(32);
    refusal(call("csvTableFromText", [...headers, "extra"].join(",")));
    for (const name of ["inspectCsvInput", "csvTextToJsonInput", "jsonTextToCsvInput"]) {
      refusal(call(name, input("x".repeat(16385))));
      refusal(call(name, input(null)));
    }
    for (const invalid of [null, {}, table([], []), table(["h", "h"], []), table(["h"], [["x", "y"]]), { $tag: "CsvTable", headers: ["h"], rows: [[123]] }]) {
      refusal(call("csvTableToJson", invalid));
      refusal(call("csvTableToText", invalid));
    }
  });

  test("expanded JSON and CSV outputs refuse before whole-output serialization", () => {
    const atJsonLimit = table(["h"], [['"'.repeat(8187)]]);
    expect(ok<string>(call("csvTableToJson", atJsonLimit)).length).toBe(16384);
    refusal(call("csvTableToJson", table(["h"], [['"'.repeat(8188)]])));
    const repeatedHeader = "k".repeat(300);
    refusal(call("csvTextToJsonInput", input(repeatedHeader + "\n" + Array(64).fill('""').join("\n"))));
    const atCsvLimit = table(["h"], [['"'.repeat(8189)]]);
    expect(ok<string>(call("csvTableToText", atCsvLimit)).length).toBe(16384);
    refusal(call("csvTableToText", table(["h"], [['"'.repeat(8190)]])));
    const emoji = table(["h"], [["🦊".repeat(16374)]]);
    expect(Array.from(ok<string>(call("csvTableToJson", emoji)))).toHaveLength(16384);
    const newlineJsonLimit = table(["h"], [["x".repeat(16372) + "\n"]]);
    expect(ok<string>(call("csvTableToJson", newlineJsonLimit)).length).toBe(16384);
    refusal(call("csvTableToJson", table(["h"], [["x".repeat(16373) + "\n"]])));
    const newlineCsvLimit = table(["h"], [["x".repeat(16377) + "\n"]]);
    expect(ok<string>(call("csvTableToText", newlineCsvLimit)).length).toBe(16384);
    refusal(call("csvTableToText", table(["h"], [["x".repeat(16378) + "\n"]])));
  });
});
