import { beforeAll, describe, expect, test } from "bun:test";
import TYPES from "../../../../fenel/modules/publicdemo/import-types.fenel?raw";
import SOURCE from "../../../../fenel/modules/publicdemo/import-demo.fenel?raw";
import JSON_TOOLS from "../../../../fenel/modules/publicdemo/json-tools.fenel?raw";
import CSV_TOOLS from "../../../../fenel/modules/publicdemo/csv-tools.fenel?raw";
import STATISTICS_TYPES from "../../../../fenel/modules/publicdemo/statistics-types.fenel?raw";
import STATISTICS from "../../../../fenel/modules/publicdemo/statistics-demo.fenel?raw";
import STATISTICS_INPUTS from "../../../../fenel/modules/publicdemo/statistics-inputs.fenel?raw";
import DRAWING from "../../../../fenel/modules/publicdemo/drawing-demo.fenel?raw";
import { loadFenelModule, loadFenelModuleUnion } from "./fenel-module";
import { invokeCallable, type EvaluateContext } from "./json-logic";
import { createRegistry, type ModuleRegistry } from "./registry";
import { stdModule } from "./modules/std";
import { codecModule } from "./modules/codec";
import { pictureModule } from "./modules/picture";
import { pathModule } from "./modules/path";
import { decidableMembershipModule } from "./modules/decidable-membership";
import { Just } from "./type-foundation";
import type { FenelModule } from "./types";

// C1: acceptance cases exercise the source-owned converters and existing
// evaluator/codec. No test-local parser or serializer acts as an oracle.
type Purchase = { $tag: "StatisticsPurchase"; id: string; customerId: string; amountCents: number };
type Customer = { $tag: "StatisticsCustomer"; id: string; name: string };
type Result<T> = { $tag: "Ok"; _0: T } | { $tag: "Err"; _0: string };
type PurchaseStatistics = {
  $tag: "PurchaseStatistics";
  purchases: Purchase[];
  summary: { count: number; total: number; average: unknown };
  breakdown: Array<{ customerId: string; count: number; totalCents: number }>;
};
const HEADER = "id,customerId,amountCents";
const SAMPLE_CSV = `${HEADER}\np1,ada,1200\np2,ada,800\np3,bo,1500\np4,guest,500`;
const SAMPLE_JSON = '[{"id":"p1","customerId":"ada","amountCents":1200},{"id":"p2","customerId":"ada","amountCents":800},{"id":"p3","customerId":"bo","amountCents":1500},{"id":"p4","customerId":"guest","amountCents":500}]';
const purchase = (id: string, customerId: string, amountCents: number): Purchase =>
  ({ $tag: "StatisticsPurchase", id, customerId, amountCents });
const SAMPLE_ROWS = [purchase("p1", "ada", 1200), purchase("p2", "ada", 800), purchase("p3", "bo", 1500), purchase("p4", "guest", 500)];
const CUSTOMERS: Customer[] = [
  { $tag: "StatisticsCustomer", id: "ada", name: "Ada" },
  { $tag: "StatisticsCustomer", id: "bo", name: "Bo" },
  { $tag: "StatisticsCustomer", id: "cy", name: "Cy" },
];

function ok<T>(value: unknown): T {
  const result = value as Result<T>;
  expect(result.$tag, JSON.stringify(result)).toBe("Ok");
  if (result.$tag !== "Ok") throw new Error(result._0);
  return result._0;
}

function refusal(value: unknown): string {
  const result = value as Result<unknown>;
  expect(result.$tag, JSON.stringify(result)).toBe("Err");
  if (result.$tag !== "Err") throw new Error("Expected a conversion refusal");
  expect(result._0.length).toBeGreaterThan(0);
  return result._0;
}

describe("Fenel-owned import conversions", () => {
  let context: EvaluateContext;
  let importModule: FenelModule;
  beforeAll(() => {
    importModule = loadFenelModuleUnion([TYPES, SOURCE, JSON_TOOLS, CSV_TOOLS].map(src => ({ src, name: "ImportDemo" })))[0]!;
    const registry = createRegistry([
      stdModule, codecModule, pictureModule, pathModule, decidableMembershipModule,
      loadFenelModule(DRAWING, "DrawingDemo"),
      ...loadFenelModuleUnion([STATISTICS_TYPES, STATISTICS, STATISTICS_INPUTS].map(src => ({ src, name: "StatisticsDemo" }))),
      importModule,
    ]);
    context = registry.evaluateContext();
  }, 180_000);

  const call = (name: string, ...args: unknown[]): unknown =>
    invokeCallable({ $ref: `ImportDemo:${name}` }, args, context);

  test("JSON syntax failure, wrong purchase shape and accepted purchase remain distinct", () => {
    expect(call("checkPurchaseJson", '{"id":')).toHaveProperty("$tag", "ImportJsonSyntaxRejected");
    expect(call("checkPurchaseJson", '{"id":"p1","customerId":"ada","amountCents":"1200"}'))
      .toMatchObject({ $tag: "ImportPurchaseRejected", parsed: { $tag: "JsonObject" } });
    expect(call("checkPurchaseJson", '{"id":"p1","customerId":"ada","amountCents":1200}'))
      .toMatchObject({ $tag: "ImportPurchaseAccepted", parsed: { $tag: "JsonObject" }, purchase: SAMPLE_ROWS[0], amountMembership: Just(true) });
    expect(call("importAmountMembership", -1)).toEqual(Just(false));
    expect(call("importAmountMembership", 1000001)).toEqual(Just(false));
  });

  test("valid deep JSON is a text refusal, malformed deep JSON is syntax failure, and purchase input recovers", () => {
    for (const text of ["[".repeat(1000) + "0" + "]".repeat(1000), '{"n":'.repeat(1000) + "0" + "}".repeat(1000)]) {
      expect(call("checkPurchaseJson", text)).toMatchObject({ $tag: "ImportTextRefused", reason: expect.stringContaining("maximum value depth 16") });
      expect(refusal(call("purchasesFromJson", text))).toContain("maximum value depth 16");
    }
    expect(call("checkPurchaseJson", "[".repeat(1000) + "0" + "]".repeat(999))).toHaveProperty("$tag", "ImportJsonSyntaxRejected");
    expect(call("checkPurchaseJson", "1e999")).toMatchObject({ $tag: "ImportTextRefused", reason: expect.stringContaining("finite Number") });
    expect(call("checkPurchaseJson", '{"id":"p1","customerId":"ada","amountCents":1200}')).toHaveProperty("$tag", "ImportPurchaseAccepted");
    expect(ok<Purchase[]>(call("purchasesFromJson", SAMPLE_JSON))).toEqual(SAMPLE_ROWS);
  });

  test("the same sample rows feed both formats and the existing purchase statistics", () => {
    expect(call("importSampleCsv")).toBe(SAMPLE_CSV);
    expect(call("importSampleJson")).toBe(SAMPLE_JSON);
    expect(ok<Purchase[]>(call("purchasesFromCsv", SAMPLE_CSV))).toEqual(SAMPLE_ROWS);
    expect(ok<Purchase[]>(call("purchasesFromJson", SAMPLE_JSON))).toEqual(SAMPLE_ROWS);
    const csv = ok<PurchaseStatistics>(call("statisticsFromCsv", CUSTOMERS, SAMPLE_CSV));
    const json = ok<PurchaseStatistics>(call("statisticsFromJson", CUSTOMERS, SAMPLE_JSON));
    expect(csv).toEqual(json);
    expect(csv.purchases).toEqual(SAMPLE_ROWS);
    expect(csv.summary).toMatchObject({ count: 4, total: 4000, average: Just(1000) });
    expect(csv.breakdown.map(row => [row.customerId, row.count, row.totalCents])).toEqual([
      ["ada", 2, 2000], ["bo", 1, 1500], ["cy", 0, 0], ["guest", 1, 500],
    ]);
    const changed = ok<PurchaseStatistics>(call("statisticsFromCsv", CUSTOMERS, SAMPLE_CSV.replace("1200", "2200")));
    expect(changed.summary.total).toBe(5000);
    expect(csv.summary.total).toBe(4000);
    refusal(call("statisticsFromCsv", CUSTOMERS, `${HEADER}\np1,ada,no`));
    refusal(call("statisticsFromJson", CUSTOMERS, "["));
  });

  test("header order, CRLF, quoted commas and escaped quotes preserve ids and normalized cents", () => {
    const text = 'amountCents,customerId,id\r\n0007,"Ada, \"\"A\"\""," 001 "\r\n0,"😀 café",""\r\n';
    const rows = [purchase(" 001 ", 'Ada, "A"', 7), purchase("", "😀 café", 0)];
    expect(ok<Purchase[]>(call("purchasesFromCsv", text))).toEqual(rows);
    const json = ok<string>(call("csvToJson", text));
    expect(JSON.parse(json)).toEqual([
      { id: " 001 ", customerId: 'Ada, "A"', amountCents: 7 },
      { id: "", customerId: "😀 café", amountCents: 0 },
    ]);
    const normalizedCsv = ok<string>(call("jsonToCsv", json));
    expect(normalizedCsv).toBe(`${HEADER}\n" 001 ","Ada, ""A""",7\n"","😀 café",0`);
    expect(ok<Purchase[]>(call("purchasesFromCsv", normalizedCsv))).toEqual(rows);
    expect(ok<Purchase[]>(call("purchasesFromJson", ok<string>(call("csvToJson", normalizedCsv))))).toEqual(rows);
  });

  test("empty data and the cents boundaries round-trip as normalized typed rows", () => {
    for (const text of [HEADER, `${HEADER}\n`, `${HEADER}\r\n`]) {
      expect(ok<Purchase[]>(call("purchasesFromCsv", text))).toEqual([]);
    }
    expect(ok<string>(call("purchasesToCsv", []))).toBe(HEADER);
    expect(ok<string>(call("purchasesToJson", []))).toBe("[]");
    for (const rows of [[], [purchase("000", "", 0), purchase("max", "é", 1000000)], [purchase("same", "ada", 1), purchase("same", "ada", 2)]]) {
      const before = structuredClone(rows);
      expect(ok<Purchase[]>(call("purchasesFromCsv", ok<string>(call("purchasesToCsv", rows))))).toEqual(rows);
      expect(ok<Purchase[]>(call("purchasesFromJson", ok<string>(call("purchasesToJson", rows))))).toEqual(rows);
      expect(rows).toEqual(before);
    }
  });

  test.each([
    ["empty input", ""],
    ["missing header", "id,customerId\np1,ada"],
    ["repeated header", "id,id,amountCents\np1,ada,1"],
    ["extra header", "id,customerId,amountCents,note\np1,ada,1,x"],
    ["unknown header", "id,customerId,cents\np1,ada,1"],
    ["short row", `${HEADER}\np1,ada`],
    ["long row", `${HEADER}\np1,ada,1,extra`],
    ["unclosed quote", `${HEADER}\n"p1,ada,1`],
    ["quote inside bare field", `${HEADER}\np"1,ada,1`],
    ["padding after closing quote", `${HEADER}\n"p1" ,ada,1`],
    ["text after closing quote", `${HEADER}\n"p1"x,ada,1`],
    ["multiline quoted field", `${HEADER}\n"p\n1",ada,1`],
    ["blank internal line", `${HEADER}\n\np1,ada,1`],
    ["two trailing empty lines", `${HEADER}\np1,ada,1\n\n`],
    ["bare terminal header CR", `${HEADER}\r`],
    ["bare terminal row CR", `${HEADER}\np1,ada,1\r`],
    ["bare embedded CR", `${HEADER}\np1\rbreak,ada,1`],
  ])("CSV refuses %s without yielding partial rows", (_name, text) => {
    refusal(call("purchasesFromCsv", text));
    refusal(call("csvToJson", text));
  });

  test.each(["", "-1", "1000001", "0.5", "1e2", "+1", " 1", "1 ", "NaN", "Infinity", "0x10", "١"])
  ("CSV refuses the unsupported numeric cell %j", amount => {
    refusal(call("purchasesFromCsv", `${HEADER}\np1,ada,${amount}`));
  });

  test.each([
    "null", "true", "42", '"text"', "{}",
    '[{"id":"p1","customerId":"ada"}]',
    '[{"id":"p1","customerId":"ada","amountCents":1,"extra":true}]',
    '[{"id":1,"customerId":"ada","amountCents":1}]',
    '[{"id":"p1","customerId":null,"amountCents":1}]',
    '[{"id":"p1","customerId":"ada","amountCents":"1"}]',
    '[{"id":"p1","customerId":"ada","amountCents":-1}]',
    '[{"id":"p1","customerId":"ada","amountCents":0.5}]',
    '[{"id":"p1","customerId":"ada","amountCents":1000001}]',
    '[{"id":"p1","customerId":"ada","amountCents":1e400}]',
    '[{"id":"p1","customerId":"ada","amountCents":1},null]',
  ])("JSON refuses a wrong row or array shape: %s", text => {
    refusal(call("purchasesFromJson", text));
    refusal(call("jsonToCsv", text));
  });

  test("the host JSON duplicate-key policy is explicit, and constructed duplicate pairs refuse", () => {
    expect(call("checkPurchaseJson", '{"id":"old","id":"new","customerId":"ada","amountCents":1}'))
      .toMatchObject({ $tag: "ImportPurchaseAccepted", purchase: purchase("new", "ada", 1) });
    refusal(call("decodePurchaseRow", { $tag: "JsonObject", pairs: [
      { $tag: "JsonObjectEntry", key: "id", value: { $tag: "JsonString", value: "p1" } },
      { $tag: "JsonObjectEntry", key: "id", value: { $tag: "JsonString", value: "p2" } },
      { $tag: "JsonObjectEntry", key: "amountCents", value: { $tag: "JsonNumber", value: 1 } },
    ] }));
  });

  test("JSON numeric syntax normalizes signed zero and exponent notation to whole cents", () => {
    const text = '[{"id":"zero","customerId":"ada","amountCents":-0},{"id":"exponent","customerId":"ada","amountCents":1e2}]';
    const rows = [purchase("zero", "ada", 0), purchase("exponent", "ada", 100)];
    expect(ok<Purchase[]>(call("purchasesFromJson", text))).toEqual(rows);
    expect(ok<Purchase[]>(call("purchasesFromJson", ok<string>(call("purchasesToJson", rows))))).toEqual(rows);
    expect(ok<Purchase[]>(call("purchasesFromCsv", ok<string>(call("jsonToCsv", text))))).toEqual(rows);
  });

  test("exports refuse malformed id carriers and invalid amounts before serializing rows", () => {
    for (const row of [
      { ...SAMPLE_ROWS[0]!, id: 123 }, { ...SAMPLE_ROWS[0]!, customerId: null },
      { $tag: "StatisticsPurchase", id: "p1", amountCents: 1 },
      { ...SAMPLE_ROWS[0]!, amountCents: "1" }, { ...SAMPLE_ROWS[0]!, amountCents: Infinity },
      { ...SAMPLE_ROWS[0]!, amountCents: -1 }, { ...SAMPLE_ROWS[0]!, amountCents: 0.5 },
    ]) {
      refusal(call("purchasesToJson", [row]));
      refusal(call("purchasesToCsv", [row]));
    }
  });

  test("CSV output escaping and aggregate id text obey the declared output limit", () => {
    expect(refusal(call("purchasesToCsv", [purchase('"'.repeat(8200), "ada", 0)]))).toContain("16384");
    for (const name of ["purchasesToJson", "purchasesToCsv"]) {
      expect(refusal(call(name, [purchase("x".repeat(8192), "a", 0), purchase("x".repeat(8192), "b", 0)]))).toContain("16384");
    }
  }, 60_000);

  test("row and text limits refuse at the boundary without truncation", () => {
    const rows = Array.from({ length: 64 }, (_, index) => purchase(String(index), "ada", 1));
    const csv = `${HEADER}\n${rows.map(row => `${row.id},ada,1`).join("\n")}`;
    expect(ok<Purchase[]>(call("purchasesFromCsv", csv))).toEqual(rows);
    const json = ok<string>(call("purchasesToJson", rows));
    expect(ok<Purchase[]>(call("purchasesFromJson", json))).toEqual(rows);
    refusal(call("purchasesFromCsv", `${csv}\n65,ada,1`));
    refusal(call("purchasesFromJson", `${json.slice(0, -1)},{"id":"65","customerId":"ada","amountCents":1}]`));
    for (const name of ["purchasesToCsv", "purchasesToJson"]) refusal(call(name, [...rows, purchase("65", "ada", 1)]));
    const prefix = '{"id":"';
    const suffix = '","customerId":"ada","amountCents":0}';
    const limit = prefix + "x".repeat(16384 - prefix.length - suffix.length) + suffix;
    expect(limit).toHaveLength(16384);
    expect(call("checkPurchaseJson", limit)).toHaveProperty("$tag", "ImportPurchaseAccepted");
    expect(call("checkPurchaseJson", `${limit} `)).toHaveProperty("$tag", "ImportTextRefused");
    for (const name of ["purchasesFromCsv", "purchasesFromJson"]) {
      expect(refusal(call(name, "x".repeat(16385)))).toContain("16384");
    }
    expect(refusal(call("purchasesToJson", [purchase("x".repeat(16384), "ada", 0)]))).toContain("16384");
  }, 60_000);

  test("JSON preserves line breaks that this CSV fragment refuses to export", () => {
    for (const id of ["line\nbreak", "line\rbreak"]) {
      const rows = [purchase(id, "ada", 1)];
      const json = ok<string>(call("purchasesToJson", rows));
      expect(ok<Purchase[]>(call("purchasesFromJson", json))).toEqual(rows);
      refusal(call("purchasesToCsv", rows));
      refusal(call("jsonToCsv", json));
    }
  });

  test("the multiline input type retains its source-owned textarea field directive", () => {
    expect(importModule.entities?.find(entity => entity.id === "ImportTextInput")).toBeDefined();
    expect(importModule.fieldFacetDirectives).toContainEqual({
      owner: { module: "ImportDemo", entityId: "ImportTextInput" },
      selector: "text",
      source: { kind: "widget", widget: "textarea" },
      provenance: { module: "ImportDemo", declaration: "ImportTextInput", selector: "text" },
    });
  });

  test("multiline input wrappers preserve core results, refusals and the original source text", () => {
    const csv = SAMPLE_CSV.replaceAll("\n", "\r\n");
    const json = `[\n${SAMPLE_JSON.slice(1, -1)}\n]`;
    const cases: Array<[string, unknown[], string[]]> = [
      ["checkPurchaseJson", [], ['{\n"id":"p1","customerId":"ada","amountCents":1200\n}', '{"id":']],
      ["purchasesFromCsv", [], [csv, `${HEADER}\np1,ada,no`]],
      ["purchasesFromJson", [], [json, '[{"id":1}]']],
      ["csvToJson", [], [csv, `${HEADER}\n"unfinished`]],
      ["jsonToCsv", [], [json, "["]],
      ["statisticsFromCsv", [CUSTOMERS], [csv, `${HEADER}\np1,ada,no`]],
      ["statisticsFromJson", [CUSTOMERS], [json, "["]],
    ];
    for (const [name, prefix, texts] of cases) {
      for (const text of texts) {
        const input = { $tag: "ImportTextInput", text };
        expect(call(`${name}Input`, ...prefix, input), name).toEqual(call(name, ...prefix, text));
        expect(input).toEqual({ $tag: "ImportTextInput", text });
      }
    }
  });

  test("public starting inputs remain references to executable Fenel functions with multiline records", () => {
    const inputs = call("importDemoStartingInputs") as Array<{ function: { $ref: string }; arguments: unknown[] }>;
    expect(inputs.map(input => input.function.$ref)).toEqual([
      "checkPurchaseJsonInput", "purchasesFromCsvInput", "purchasesFromJsonInput", "csvToJsonInput", "jsonToCsvInput", "statisticsFromCsvInput", "statisticsFromJsonInput",
      "inspectJsonInput", "formatJsonInput", "minifyJsonInput", "inspectJsonValue",
      "inspectCsvInput", "csvTextToJsonInput", "jsonTextToCsvInput",
    ].map(name => `ImportDemo:${name}`));
    expect(inputs.slice(0, 7).map(input => input.arguments.at(-1))).toEqual([
      { $tag: "ImportTextInput", text: '{"id":"p1","customerId":"ada","amountCents":"1200"}' },
      ...[SAMPLE_CSV, SAMPLE_JSON, SAMPLE_CSV, SAMPLE_JSON, SAMPLE_CSV, SAMPLE_JSON].map(text => ({ $tag: "ImportTextInput", text })),
    ]);
    expect(inputs[5]!.arguments[0]).toEqual(CUSTOMERS);
    expect(inputs[6]!.arguments[0]).toEqual(CUSTOMERS);
    expect(invokeCallable(inputs[0]!.function, inputs[0]!.arguments, context)).toHaveProperty("$tag", "ImportPurchaseRejected");
    expect(ok<Purchase[]>(invokeCallable(inputs[1]!.function, inputs[1]!.arguments, context))).toEqual(SAMPLE_ROWS);
    for (const row of inputs.slice(7)) expect(invokeCallable(row.function, row.arguments, context)).toHaveProperty("$tag", "Ok");
  });

  test("complete import source files parse through Fenel and match the compatibility oracle", async () => {
    const [{ parseViaFenelParser, PARSE_VIA_FENEL_FAIL }, { parse }] = await Promise.all([
      import("./engine-bodies-dispatch"), import("./fenel-parser"),
    ]);
    for (const [name, source] of [["types", TYPES], ["functions", SOURCE]] as const) {
      const native = parseViaFenelParser(source);
      expect(native, name).not.toBe(PARSE_VIA_FENEL_FAIL);
      expect(native).toEqual(JSON.parse(JSON.stringify(parse(source))));
    }
  }, 60_000);
});

describe("production imports in the checked execute profile", () => {
  let product: ModuleRegistry;
  let context: EvaluateContext;
  beforeAll(async () => {
    const [{ modulesFor }, { createRepositoryRegistry }, { publicImportDemoModule }, { dispatchRegistry }, { mintAnonymousAuthority }] = await Promise.all([
      import("./module-manifest"), import("./repository-registry"), import("./modules/public-demos"),
      import("./system-entities"), import("../../runtime/src/authority-mint"),
    ]);
    expect(modulesFor("seed").includes(publicImportDemoModule)).toBe(true);
    expect(modulesFor("execute").includes(publicImportDemoModule)).toBe(true);
    product = createRepositoryRegistry(modulesFor("execute"), { dispatchRegistry });
    context = { ...product.evaluateContext(), _authority: mintAnonymousAuthority(product) };
  }, 900_000);

  const call = (name: string, ...args: unknown[]): unknown => {
    const fn = product.getFunction(`ImportDemo.${name}`);
    if (!fn) throw new Error(`Missing ImportDemo.${name}`);
    const handle = product.getUuid(fn.id);
    if (!handle || product.getFunction(handle)?.id !== fn.id) throw new Error(`Missing exact identity for ImportDemo.${name}`);
    return invokeCallable({ $ref: handle }, args, context);
  };

  test("source-owned public signatures and anonymous physical references execute the same conversions", () => {
    for (const name of ["checkPurchaseJson", "purchasesFromCsv", "purchasesFromJson", "purchasesToCsv", "purchasesToJson", "csvToJson", "jsonToCsv", "statisticsFromCsv", "statisticsFromJson", "checkPurchaseJsonInput", "purchasesFromCsvInput", "purchasesFromJsonInput", "csvToJsonInput", "jsonToCsvInput", "statisticsFromCsvInput", "statisticsFromJsonInput", "importDemoStartingInputs"]) {
      const fn = product.getFunction(`ImportDemo.${name}`)!;
      const handle = product.getUuid(fn.id)!;
      expect(handle).toMatch(/^[0-9a-f-]{36}$/i);
      expect(product.getFunctionSignatureInfo(handle)!.outcome.$tag).toBe("Solved");
      expect(fn.body).toBeDefined();
    }
    const inputs = call("importDemoStartingInputs") as Array<{ function: { $ref: string }; arguments: unknown[] }>;
    expect(inputs.map(input => input.function.$ref)).toEqual([
      "checkPurchaseJsonInput", "purchasesFromCsvInput", "purchasesFromJsonInput", "csvToJsonInput", "jsonToCsvInput", "statisticsFromCsvInput", "statisticsFromJsonInput",
      "inspectJsonInput", "formatJsonInput", "minifyJsonInput", "inspectJsonValue",
      "inspectCsvInput", "csvTextToJsonInput", "jsonTextToCsvInput",
    ].map(name => product.getUuid(`ImportDemo:${name}`)!));
    expect(ok<Purchase[]>(invokeCallable(inputs[1]!.function, inputs[1]!.arguments, context))).toEqual(SAMPLE_ROWS);
    expect(ok<PurchaseStatistics>(invokeCallable(inputs[5]!.function, inputs[5]!.arguments, context)).summary.total).toBe(4000);
    expect(ok<Purchase[]>(call("purchasesFromCsv", SAMPLE_CSV))).toEqual(SAMPLE_ROWS);
    expect(ok<Purchase[]>(call("purchasesFromJson", ok<string>(call("csvToJson", SAMPLE_CSV))))).toEqual(SAMPLE_ROWS);
    expect(ok<PurchaseStatistics>(call("statisticsFromJson", CUSTOMERS, SAMPLE_JSON)).summary.total).toBe(4000);
  }, 180_000);

  test("the existing membership judgment checks actual purchases and preserves the JSON List carrier fence", () => {
    const hooks = product.callSiteTyping;
    const purchaseType = hooks.resolveType({ $ref: "StatisticsPurchase" }, "StatisticsDemo:purchaseStatistics");
    const jsonType = hooks.resolveType({ $ref: "JsonValue" }, "codec:jsonDecode");
    if (!purchaseType.ok || !jsonType.ok) throw new Error("The source-owned purchase and JSON types must resolve");
    // GLOBAL_ONLY: these are public system types and pure candidates; no
    // account-owned dispatch rows participate in this regression check.
    const member = (value: unknown) => hooks.member(purchaseType.type, value, null, context);
    const rows = ok<Purchase[]>(call("purchasesFromJson", SAMPLE_JSON));
    for (const row of rows) expect(member(row)).toBe("yes");
    for (const bad of [
      { ...rows[0]!, amountCents: "1200" }, { ...rows[0]!, amountCents: -1 },
      { ...rows[0]!, amountCents: 0.5 }, { ...rows[0]!, amountCents: 1000001 },
      { ...rows[0]!, id: 123 }, { $tag: "StatisticsPurchase", id: "p1", amountCents: 1 },
    ]) expect(member(bad)).toBe("no");
    for (const text of [SAMPLE_JSON, '{"id":"p1","customerId":"ada","amountCents":1200}', "[]", "{}"]) {
      const parsed = ok<unknown>(invokeCallable({ $ref: product.getUuid("codec:jsonDecode")! }, [text], context));
      expect(hooks.member(jsonType.type, parsed, null, context)).toBe("unknown");
    }
    expect(hooks.member(jsonType.type, { $tag: "JsonNumber", value: 1 }, null, context)).toBe("yes");
  }, 180_000);
});
