import { beforeAll, describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { createHash } from "node:crypto";
import { resolve } from "node:path";
import { loadFenelModule } from "./fenel-module";
import { evaluate, invokeCallable, type EvaluateContext } from "./json-logic";
import { stdNatives, stdNativesCtx } from "../../../../fenel/modules/std/ffi/std-ffi";
import { bytesToListNative } from "../../../../fenel/modules/std/ffi/bytes-ffi";
import { codecHostNatives } from "../../../../fenel/modules/codec/ffi/codec-ffi";
import type { FenelFunction } from "./types";
import type { ModuleRegistry } from "./registry";

// C1: actual source bodies and the existing host codec, with a bounded direct
// evaluator harness. No complete registry, parser owner rebuild or test parser.
const root = resolve(import.meta.dir, "../../../..");
const functions = new Map<string, FenelFunction>();
for (const path of [
  "fenel/modules/publicdemo/file-tools.fenel",
  "fenel/modules/publicdemo/import-types.fenel",
  "fenel/modules/publicdemo/import-demo.fenel",
  "fenel/modules/publicdemo/json-tools.fenel",
  "fenel/modules/publicdemo/csv-tools.fenel",
  "fenel/modules/codec/codec.fenel",
  "fenel/modules/std/appendItem.fenel",
  "fenel/modules/std/fromMaybe.fenel",
  "fenel/modules/std/not.fenel",
  "fenel/modules/std/operators.fenel",
]) {
  const module = loadFenelModule(readFileSync(resolve(root, path), "utf8"),
    path.includes("/publicdemo/") ? "ImportDemo" : path.includes("/codec/") ? "codec" : "std",
    { bootstrapParser: "typescript" });
  for (const fn of module.functions ?? []) {
    functions.set(fn.id, fn);
    functions.set(fn.id.replace(":", "."), fn);
    functions.set(fn.id.slice(fn.id.indexOf(":") + 1), fn);
  }
}
const nativeAliases = Object.fromEntries([
  ...Object.entries(stdNatives).flatMap(([name, fn]) => [[`std:${name}`, fn], [`std.${name}`, fn]]),
  ...Object.entries(codecHostNatives).flatMap(([name, fn]) => [[`codec:${name}`, fn], [`codec.${name}`, fn]]),
]);
const context: EvaluateContext = {
  getFunction: name => functions.get(name),
  natives: Object.assign(Object.create(null), stdNatives, codecHostNatives, nativeAliases),
  nativesCtx: Object.assign(Object.create(null), stdNativesCtx),
  _constructors: {
    Ok: ["_0"], Err: ["_0"], Just: ["_0"], Nothing: [],
    FileText: ["file", "text"], FileJson: ["file", "text", "inspection"], FileCsv: ["file", "text", "inspection"],
    FileUtf8State: ["output", "remaining", "codepoint", "minimum", "offset", "failure"],
    ImportTextInput: ["text"], ImportCsvState: ["fields", "current", "mode", "failure"],
    ImportCsvBare: [], ImportCsvQuoted: [], ImportCsvClosed: [],
    JsonInspection: ["parsed", "compact", "formatted", "nodeCount", "maximumDepth"],
    JsonToolRendered: ["compact", "formatted", "nodeCount", "maximumDepth"],
    JsonToolParts: ["compact", "formatted", "compactSize", "formattedSize", "nodeCount", "maximumDepth"],
    CsvTable: ["headers", "rows"], CsvInspection: ["table", "rowCount", "columnCount", "json"],
    JsonNull: [], JsonBool: ["value"], JsonNumber: ["value"], JsonString: ["value"],
    JsonArray: ["items"], JsonObject: ["pairs"], JsonObjectEntry: ["key", "value"],
    JsonHostPair: ["key", "value"], JsonHostParts: ["scalar", "items", "pairs"],
  },
};
const call = (name: string, ...args: unknown[]): any => {
  const fn = functions.get(name)!;
  return evaluate(fn.body, Object.fromEntries(fn.params.map((param, i) => [param.name, args[i]])), context);
};
const accepted = (result: any): any => {
  expect(result.$tag, JSON.stringify(result)).toBe("Ok");
  return result._0;
};
const refused = (result: any): string => {
  expect(result.$tag, JSON.stringify(result)).toBe("Err");
  expect(typeof result._0).toBe("string");
  expect(result._0.length).toBeGreaterThan(0);
  return result._0;
};
const retainedFile = (content: string | number[], mimeType = "text/plain", name = "local.txt") => {
  const bytes = typeof content === "string" ? Buffer.from(content, "utf8") : Buffer.from(content);
  return { name, mimeType, size: bytes.length, hash: createHash("sha256").update(bytes).digest("hex"), url: `data:${mimeType};base64,${bytes.toString("base64")}` };
};

describe("retained browser File to existing typed text/JSON/CSV utilities", () => {
  test("source-owned public recipes call ordinary File functions", () => {
    for (const name of ["fileText", "fileJson", "fileCsv"]) {
      expect(functions.get(name)?.body).toBeDefined();
      expect(functions.get(name)?.returns).not.toEqual({ $record: { fields: [] } });
      expect(stdNatives[name]).toBeUndefined();
    }
    const recipes = call("fileDemoStartingInputs");
    expect(recipes).toHaveLength(3);
    for (const recipe of recipes) {
      const value = accepted(invokeCallable(recipe.function, recipe.arguments, context));
      expect(recipe.arguments[0]).not.toHaveProperty("_0");
      expect(recipe.arguments[0]).not.toHaveProperty("$tag");
      expect(value.file).toEqual(recipe.arguments[0]);
      expect(value.file.hash).toHaveLength(64);
    }
  });

  test("exact UTF-8 text and all original File metadata survive", () => {
    const text = "\u0000Aé€🦊\r\n";
    const file = retainedFile(text);
    expect(accepted(call("fileText", file))).toMatchObject({ file, text });
    expect(accepted(call("fileText", retainedFile(""))).text).toBe("");
    expect(accepted(call("fileText", retainedFile("\u007f\u0080\u07ff\u0800\ud7ff\ue000\uffff\u{10000}\u{10ffff}"))).text)
      .toBe("\u007f\u0080\u07ff\u0800\ud7ff\ue000\uffff\u{10000}\u{10ffff}");
  });

  test("file inspection and pasted text use the same JSON and CSV owners", () => {
    const json = '{"name":"🦊","items":[null,true,1]}';
    const csv = 'name,code,note\r\nAda,001,"red, blue"\r\n🦊,002,"say ""hi"""\r\n';
    for (const [operation, textOperation, text, mime] of [
      ["fileJson", "inspectJsonInput", json, "application/json"],
      ["fileCsv", "inspectCsvInput", csv, "text/csv"],
    ]) {
      const file = retainedFile(text!, mime!);
      const value = accepted(call(operation!, file));
      expect(value.file).toEqual(file);
      expect(value.text).toBe(text);
      expect(value.inspection).toEqual(accepted(call(textOperation!, { text })));
    }
    expect(accepted(call("fileCsv", retainedFile(csv, "text/csv"))).inspection.table.rows[0][1]).toBe("001");
  });

  test("a leading BOM is retained, while only parser input loses it without truncating astral text", () => {
    for (const [operation, textOperation, text] of [
      ["fileJson", "inspectJsonInput", '{"name":"🦊"}'],
      ["fileCsv", "inspectCsvInput", "name,code\n🦊,001"],
    ]) {
      const file = retainedFile(`\ufeff${text}`);
      const value = accepted(call(operation!, file));
      expect(value.text).toBe(`\ufeff${text}`);
      expect(value.inspection).toEqual(accepted(call(textOperation!, { text })));
      expect(accepted(call("fileText", file)).text).toBe(`\ufeff${text}`);
    }
    refused(call("fileJson", retainedFile('\ufeff\ufeff{"name":"🦊"}')));
  });

  test("malformed syntax errors match text utilities and a subsequent good file recovers", () => {
    for (const [operation, textOperation, text] of [
      ["fileJson", "inspectJsonInput", '{"name":'],
      ["fileCsv", "inspectCsvInput", "name,code\nAda,001,extra"],
      ["fileCsv", "inspectCsvInput", 'name,code\n"Ada,001'],
    ]) {
      expect(refused(call(operation!, retainedFile(text!)))).toBe(refused(call(textOperation!, { text })));
    }
    expect(accepted(call("fileJson", retainedFile('{"fixed":true}'))).inspection.compact).toBe('{"fixed":true}');
  });

  test("bounded JSON decode refuses deep arrays and objects before wrapping, including retained Files", () => {
    const sources = [
      ...[17, 1000, 2047].map(depth => "[".repeat(depth) + "0" + "]".repeat(depth)),
      ...[17, 682].map(depth => '{"n":'.repeat(depth) + "0" + "}".repeat(depth)),
    ];
    for (const text of sources) {
      expect(text.length).toBeLessThanOrEqual(4096);
      for (const name of ["inspectJsonInput", "formatJsonInput", "minifyJsonInput", "jsonTextToCsvInput"])
        expect(refused(call(name, { text }))).toContain("maximum value depth 16");
      expect(refused(call("inspectJsonText", text))).toContain("maximum value depth 16");
      expect(refused(call("purchasesFromJson", text))).toContain("maximum value depth 16");
      expect(call("checkPurchaseJson", text)).toMatchObject({ $tag: "ImportTextRefused", reason: expect.stringContaining("maximum value depth 16") });
      expect(refused(call("fileJson", retainedFile(text, "application/json")))).toBe(refused(call("inspectJsonText", text)));
    }
    const largerObject = '{"n":'.repeat(1000) + "0" + "}".repeat(1000);
    expect(refused(call("csvTableFromJsonText", largerObject))).toContain("maximum value depth 16");
    expect(refused(call("purchasesFromJson", largerObject))).toContain("maximum value depth 16");
    for (const text of ["[".repeat(16) + "0" + "]".repeat(16), "[".repeat(17) + "]".repeat(17), '{"n":'.repeat(16) + "0" + "}".repeat(16)]) {
      const inspected = accepted(call("inspectJsonText", text));
      expect(inspected.maximumDepth).toBe(16);
      expect(accepted(call("fileJson", retainedFile(text))).inspection).toEqual(inspected);
    }
    expect(accepted(call("inspectJsonText", '{"fixed":true}')).compact).toBe('{"fixed":true}');
    expect(accepted(call("fileJson", retainedFile('{"fixed":true}'))).inspection.compact).toBe('{"fixed":true}');
    expect(refused(call("csvTableFromJsonText", "{}"))).toContain("Expected a JSON array");
    expect(accepted(call("purchasesFromJson", "[]"))).toEqual([]);
  }, 30_000);

  test("codec depth limits use decoded values, preserve syntax errors and leave ordinary decoding unbounded", () => {
    for (const text of ['"' + "[]{}".repeat(900) + '"', JSON.stringify('quote" escaped\\\\ []{} \\" 🦊')]) {
      expect(accepted(call("jsonDecodeBounded", 0, text))).toEqual({ $tag: "JsonString", value: JSON.parse(text) });
      expect(accepted(call("inspectJsonText", text)).maximumDepth).toBe(0);
    }
    const quotedKey = JSON.stringify({ ['quote" slash\\ []{}']: '[]{}\\"' });
    expect(accepted(call("jsonDecodeBounded", 1, quotedKey))).toMatchObject({ $tag: "JsonObject" });
    expect(accepted(call("jsonDecodeBounded", 0, "[]"))).toEqual({ $tag: "JsonArray", items: [] });
    expect(refused(call("jsonDecodeBounded", 0, "[0]"))).toContain("maximum value depth 0");
    const deepMalformed = "[".repeat(1000) + "0" + "]".repeat(999);
    for (const text of [deepMalformed, '"unterminated\\"', '"invalid\\q"', '{"x":]']) {
      expect(refused(call("jsonDecodeBounded", 16, text))).toBe(refused(call("jsonDecode", text)));
      expect(refused(call("inspectJsonText", text))).toBe(refused(call("jsonDecode", text)));
      expect(call("checkPurchaseJson", text)).toMatchObject({ $tag: "ImportJsonSyntaxRejected", reason: refused(call("jsonDecode", text)) });
    }
    const ordinary = "[".repeat(24) + "0" + "]".repeat(24);
    expect(accepted(call("jsonDecode", ordinary))).toHaveProperty("$tag", "JsonArray");
    expect(call("wrapJsonValue", JSON.parse(ordinary))).toEqual(accepted(call("jsonDecode", ordinary)));
    expect(refused(call("jsonDecodeBounded", 16, ordinary))).toContain("maximum value depth 16");
    expect(accepted(call("jsonDecodeBounded", 2, '[{"a":1,"a":2}]')).items[0].pairs).toEqual([
      { $tag: "JsonObjectEntry", key: "a", value: { $tag: "JsonNumber", value: 2 } },
    ]);
  });

  test("strict UTF-8 refuses invalid bytes rather than replacing them", () => {
    for (const bytes of [
      [0x80], [0xc0, 0x80], [0xc1, 0xbf], [0xe0, 0x80, 0x80], [0xed, 0xa0, 0x80],
      [0xf0, 0x80, 0x80, 0x80], [0xf4, 0x90, 0x80, 0x80], [0xf5, 0x80, 0x80, 0x80],
      [0xff], [0xc2], [0xe2, 0x82], [0xf0, 0x9f, 0xa6], [0xc2, 0x41],
    ]) expect(refused(call("fileText", retainedFile(bytes)))).toContain("UTF-8 byte");
    for (const byte of [-1, 256, 1.5, NaN, Infinity, "65", null]) refused(call("fileUtf8Text", [byte]));
    refused(call("fileUtf8Text", new Uint8Array([65])));
  });

  test("retained byte count, canonical base64 and inline-only bounds refuse forged or large Files", () => {
    const file = retainedFile("a");
    for (const value of [
      { ...file, size: -1 }, { ...file, size: 1.5 }, { ...file, size: NaN }, { ...file, size: 16385 },
      { ...file, size: 2 }, { ...file, url: "https://example.com/file.txt" },
      { ...file, url: "data:text/plain;base64,YR==" }, // nonzero padding bits
      { ...file, url: "data:text/plain;base64,YQ==\n" },
      { ...file, url: "data:text/plain;base64," + "A".repeat(21852) },
      { ...file, url: "data:text/html;base64,YQ==" }, { ...file, mimeType: "text/🦊" },
      { ...file, name: "x".repeat(513) },
    ]) refused(call("fileText", value));
    expect(accepted(call("fileText", retainedFile("a".repeat(16384)))).text).toHaveLength(16384);
    refused(call("fileText", retainedFile("a".repeat(16385))));
    refused(call("fileJson", retainedFile(JSON.stringify({ text: "x".repeat(4097) }))));
    refused(call("fileCsv", retainedFile("name\n" + "x\n".repeat(65))));
  }, 30_000);
});

describe("A3/B3 Bytes List Byte representation bridge", () => {
  test("copies native bytes without executing candidate properties or iterators", () => {
    let reads = 0;
    class HostileBytes extends Uint8Array {}
    Object.defineProperty(HostileBytes.prototype, Symbol.iterator, { get() { reads++; throw new Error("candidate iterator"); } });
    const bytes = new HostileBytes([0, 128, 255]);
    for (const name of ["length", "values", "buffer", "byteLength"]) {
      Object.defineProperty(bytes, name, { get() { reads++; throw new Error("candidate getter"); } });
    }
    const list = bytesToListNative(bytes);
    expect(list).toEqual([0, 128, 255]);
    list[0] = 99;
    expect(Uint8Array.prototype.values.call(bytes).next().value).toBe(0);
    expect(reads).toBe(0);
  });

  test("refuses wrong brands, proxies, prototype imitations and detached storage", () => {
    for (const value of [[], new Uint8ClampedArray([1]), new Int8Array([1]), new ArrayBuffer(1),
      new Proxy(new Uint8Array([1]), {}), Object.create(Uint8Array.prototype), null]) {
      expect(() => bytesToListNative(value)).toThrow();
    }
    const bytes = new Uint8Array([1]);
    structuredClone(bytes.buffer, { transfer: [bytes.buffer] });
    expect(() => bytesToListNative(bytes)).toThrow();
    expect(bytesToListNative(new Uint8Array())).toEqual([]);
  });
});

// A focused exact-profile control is opt-in because checked seed preparation
// initializes the full repository signatures. Routine source runs stay short.
const seedDescribe = process.env.FENEL_FILE_SEED_CHECK === "1" ? describe : describe.skip;
seedDescribe("File utilities in the actual checked seed profile", () => {
  let registry: ModuleRegistry;
  let seedContext: EvaluateContext;
  beforeAll(async () => {
    const [{ modulesFor }, { createRepositoryRegistry }, { mintAnonymousAuthority }] = await Promise.all([
      import("./module-manifest"), import("./repository-registry"), import("../../runtime/src/authority-mint"),
    ]);
    const files = modulesFor("seed").flatMap(module => (module.entities ?? [])
      .filter(entity => entity.id === "File").map(entity => ({ module: module.name, type: entity.type })));
    expect(files.map(file => file.module)).toContain("std");
    expect(files.map(file => file.module)).toContain("telegram");
    registry = createRepositoryRegistry(modulesFor("seed"));
    seedContext = { ...registry.evaluateContext(), _authority: mintAnonymousAuthority(registry) };
  }, 180_000);

  const seedCall = (name: string, ...args: unknown[]): any => {
    const fn = registry.getFunction(`ImportDemo.${name}`)!;
    const identity = registry.getUuid(fn.id)!;
    expect(registry.getFunction(identity)?.id).toBe(fn.id);
    return invokeCallable({ $ref: identity }, args, seedContext);
  };

  test("exact public schemes admit every flat source-owned File default", () => {
    const recipes = seedCall("fileDemoStartingInputs") as Array<{ function: { $ref: string }; arguments: any[] }>;
    expect(recipes).toHaveLength(3);
    for (const recipe of recipes) {
      const fn = registry.getFunction(recipe.function.$ref)!;
      expect(["ImportDemo:fileText", "ImportDemo:fileJson", "ImportDemo:fileCsv"]).toContain(fn.id);
      expect(registry.getFunctionSignatureInfo(recipe.function.$ref)?.outcome.$tag).toBe("Solved");
      expect(recipe.arguments[0]).not.toHaveProperty("$tag");
      expect(recipe.arguments[0]).not.toHaveProperty("_0");
      const parameter = registry.callSiteTyping.resolveType(fn.params[0]!.type, fn.id);
      expect(parameter.ok).toBe(true);
      if (!parameter.ok) throw new Error("The source File parameter must resolve in ImportDemo scope.");
      // GLOBAL_ONLY: anonymous public source types and candidates; no account
      // rows participate. Reuse the existing membership judgment unchanged.
      expect(registry.callSiteTyping.member(parameter.type, recipe.arguments[0], null, seedContext)).toBe("yes");
      const value = accepted(invokeCallable(recipe.function, recipe.arguments, seedContext));
      expect(value.file).toEqual(recipe.arguments[0]);
      expect(value.text).toBe(Buffer.from(value.file.url.split(",")[1], "base64").toString("utf8"));
    }
  }, 60_000);

  test("flat browser-like Files execute text/JSON/CSV with the existing parser result and recovery", () => {
    const json = '\ufeff{"name":"🦊"}';
    const csv = '\ufeffname,code\n🦊,001';
    for (const [name, text, mime, textOperation] of [
      ["fileText", "Exact é€🦊\r\n", "text/plain", undefined],
      ["fileJson", json, "application/json", "inspectJsonInput"],
      ["fileCsv", csv, "text/csv", "inspectCsvInput"],
    ] as const) {
      const file = retainedFile(text, mime);
      const value = accepted(seedCall(name, file));
      expect(value.file).toEqual(file);
      expect(value.text).toBe(text);
      if (textOperation) expect(value.inspection).toEqual(accepted(seedCall(textOperation, { text: text.slice(1) })));
    }
    expect(refused(seedCall("fileJson", retainedFile("{")))).toContain("JSON");
    expect(accepted(seedCall("fileJson", retainedFile("true"))).inspection.parsed).toMatchObject({ $tag: "JsonBool", value: true });
  }, 60_000);

});
