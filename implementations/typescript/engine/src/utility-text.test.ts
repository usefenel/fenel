import { beforeAll, describe, expect, test } from "bun:test";
import SOURCE from "../../../../fenel/modules/publicdemo/utility-text.fenel?raw";
import INPUT_TYPES from "../../../../fenel/modules/publicdemo/import-types.fenel?raw";
import { loadFenelModule } from "./fenel-module";
import { invokeCallable, type EvaluateContext } from "./json-logic";
import { createRegistry, type ModuleRegistry } from "./registry";
import { stdModule } from "./modules/std";
import type { FenelType } from "./types";

// Existing C1 actual-source harness: exercise ordinary Fenel recipes through
// the shipped evaluator and String/List owners, without native replacements.
let registry: ModuleRegistry;
let context: EvaluateContext;
beforeAll(() => {
  const imports = loadFenelModule(INPUT_TYPES, "ImportDemo");
  const textInput = { ...imports, functions: [], entities: imports.entities?.filter(entity => entity.id === "ImportTextInput") };
  registry = createRegistry([stdModule, textInput, loadFenelModule(SOURCE, "UtilityDemo")]);
  context = registry.evaluateContext();
}, 180_000);

const call = (name: string, ...args: unknown[]): unknown => invokeCallable({ $ref: `UtilityDemo:${name}` }, args, context);
const source = (text: string) => ({ $tag: "ImportTextInput", text });
const ok = (value: unknown) => ({ $tag: "Ok", _0: value });
const refused = { $tag: "Err", _0: expect.any(String) };

describe("source-owned bounded text utilities", () => {
  test("the tool record has honest arrow fields holding the real function references", () => {
    const tools = call("textTools") as Record<string, { $ref: string }>;
    const fn = registry.getFunction("UtilityDemo:textTools")!;
    expect(fn.params).toEqual([]);
    expect(fn.returns).toHaveProperty("$record.fields");
    const fields = (fn.returns as { $record: { fields: Array<{ name: string; type: FenelType }> } }).$record.fields;
    expect(fields.map(field => field.name)).toEqual(Object.keys(tools));
    expect(fields).toHaveLength(14);
    for (const field of fields) {
      expect(field.type).toHaveProperty("$arrow");
      const ref = tools[field.name]!;
      const target = registry.getFunction(ref.$ref)!;
      expect(target).toBeDefined();
      expect(target.body).toBeDefined();
      expect(target.params.length).toBeGreaterThan(0);
      expect(ref.$ref.startsWith("UtilityDemo:")).toBe(true);
    }
    expect(invokeCallable(tools.reverse!, ["ab🦊"], context)).toEqual(ok("🦊ba"));
  });

  test("source-owned starting inputs cover every exposed tool and run without a substitute evaluator", () => {
    const tools = call("textTools") as Record<string, { $ref: string }>;
    const starting = call("utilityTextStartingInputs") as Array<{ function: { $ref: string }; arguments: unknown[] }>;
    expect(starting.map(row => row.function.$ref).sort()).toEqual(Object.values(tools).map(ref => ref.$ref).sort());
    for (const row of starting) {
      const target = registry.getFunction(row.function.$ref)!;
      expect(row.arguments).toHaveLength(target.params.length);
      expect(invokeCallable(row.function, row.arguments, context)).toMatchObject(ok(expect.anything()));
    }
    for (const name of ["summarizeText", "splitText", "sortTextLines", "deduplicateTextLines", "textCodePointFrequencies", "normalizeTextWhitespace", "replaceText"]) {
      expect(registry.getFunction(`UtilityDemo:${name}`)?.params[0]?.type).toEqual({ $ref: "ImportTextInput" });
    }
  });

  test("reverse and counters keep code points distinct from graphemes and alphabetic letters", () => {
    expect(call("reverseText", "A🦊e\u0301")).toEqual(ok("\u0301e🦊A"));
    expect(call("summarizeText", source("A🦊e\u0301"))).toEqual(ok({ codePoints: 4, whitespaceTokens: 1, lines: 1 }));
    expect(call("summarizeText", source(""))).toEqual(ok({ codePoints: 0, whitespaceTokens: 0, lines: 0 }));
    expect(call("summarizeText", source("one\r\ntwo\n"))).toEqual(ok({ codePoints: 9, whitespaceTokens: 2, lines: 3 }));
    expect(call("summarizeText", source(" \t\n"))).toEqual(ok({ codePoints: 3, whitespaceTokens: 0, lines: 2 }));
    expect(call("summarizeText", source("one\rtwo"))).toEqual(ok({ codePoints: 7, whitespaceTokens: 2, lines: 1 }));
    expect(call("reverseText", "🦊".repeat(4096))).toEqual(ok("🦊".repeat(4096)));
    expect(call("reverseText", "🦊".repeat(4097))).toMatchObject(refused);
  });

  test("Unicode case expansion respects the output limit and empty data", () => {
    expect(call("uppercaseText", "Straße")).toEqual(ok("STRASSE"));
    expect(call("lowercaseText", "İΣ")).toEqual(ok("i\u0307ς"));
    expect(call("uppercaseText", "ß".repeat(2048))).toEqual(ok("SS".repeat(2048)));
    expect(call("uppercaseText", "ß".repeat(2049))).toMatchObject(refused);
    expect(call("lowercaseText", "İ".repeat(2049))).toMatchObject(refused);
    for (const name of ["reverseText", "uppercaseText", "lowercaseText", "trimText", "sortTextCodePoints", "slugifyText"]) {
      expect(call(name, "")).toEqual(ok(""));
      expect(call(name, "x".repeat(4097))).toMatchObject(refused);
    }
  });

  test("split is literal, retains empty fields and refuses a surrogate-splitting empty delimiter", () => {
    expect(call("splitText", source("a,,🦊,"), ",")).toEqual(ok(["a", "", "🦊", ""]));
    expect(call("splitText", source("a.*b.*c"), ".*")).toEqual(ok(["a", "b", "c"]));
    expect(call("splitText", source(""), ",")).toEqual(ok([""]));
    expect(call("splitText", source("🦊🦊"), "")).toMatchObject(refused);
    expect(call("splitText", source("a,".repeat(127)), ",")).toMatchObject(ok(expect.any(Array)));
    expect(call("splitText", source("a,".repeat(128)), ",")).toMatchObject(refused);
    expect(call("splitText", source("x"), "x".repeat(4097))).toMatchObject(refused);
  });

  test("split refuses surrogate-half delimiters while matching complete supplementary characters", () => {
    const scalarRefusal = { $tag: "Err", _0: "Use well-formed Unicode text without unpaired UTF-16 surrogates." };
    for (const delimiter of ["\ud83e", "\udd8a", "🦊\ud83e", "\udd8a🦊"]) {
      expect(call("splitText", source("🦊"), delimiter)).toEqual(scalarRefusal);
      expect(call("splitText", source("safe"), delimiter)).toEqual(scalarRefusal);
    }
    expect(call("splitText", source("a🦊b🦊"), "🦊")).toEqual(ok(["a", "b", ""]));
    expect(call("splitText", source("🦊".repeat(4096)), "🦊".repeat(4096))).toEqual(ok(["", ""]));
    expect(call("splitText", source("\ud83e"), "🦊")).toEqual(ok(["\ud83e"]));
    expect(call("splitText", source("x".repeat(4097)), "\ud83e")).toEqual({ $tag: "Err", _0: "Use text with at most 4096 Unicode code points; the result must fit the same limit." });
  });

  test("join admits empty lists and exact limits but refuses excessive item/output sizes", () => {
    expect(call("joinText", [], ",")).toEqual(ok(""));
    expect(call("joinText", ["a", "", "🦊"], ",")).toEqual(ok("a,,🦊"));
    expect(call("joinText", Array(128).fill(""), "")).toEqual(ok(""));
    expect(call("joinText", Array(129).fill(""), "")).toMatchObject(refused);
    expect(call("joinText", ["🦊".repeat(4096)], "")).toEqual(ok("🦊".repeat(4096)));
    expect(call("joinText", ["a".repeat(2048), "b".repeat(2048)], "")).toEqual(ok("a".repeat(2048) + "b".repeat(2048)));
    expect(call("joinText", ["a".repeat(2048), "b".repeat(2048)], ",")).toMatchObject(refused);
    expect(call("joinText", ["a", "b"], "🦊".repeat(4096))).toMatchObject(refused);
  });

  test("sorting preserves duplicates and explicit line/newline semantics", () => {
    expect(call("sortTextCodePoints", "cab🦊a ")).toEqual(ok(" aabc🦊"));
    // Existing lexical String order compares UTF-16 units, so U+10000 sorts
    // before U+E000; a numeric-code-point order would be a different promise.
    expect(call("sortTextCodePoints", "\ue000\u{10000}")).toEqual(ok("\u{10000}\ue000"));
    expect(call("sortTextLines", source("pear\r\napple\r\npear\n"))).toEqual(ok("\napple\npear\npear"));
    expect(call("sortTextLines", source("b\ra\na"))).toEqual(ok("a\nb\ra"));
    expect(call("sortTextLines", source(""))).toEqual(ok(""));
    expect(call("sortTextLines", source(Array(128).fill("x").join("\n")))).toMatchObject(ok(expect.any(String)));
    expect(call("sortTextLines", source(Array(129).fill("x").join("\n")))).toMatchObject(refused);
  });

  test("deduplication keeps first-occurrence order and exact line equality", () => {
    expect(call("deduplicateTextLines", source("pear\r\napple\r\npear\nbanana\napple"))).toEqual(ok("pear\napple\nbanana"));
    expect(call("deduplicateTextLines", source("a\nA\n a\na\n"))).toEqual(ok("a\nA\n a\n"));
    expect(call("deduplicateTextLines", source("\nx\n\nx\n"))).toEqual(ok("\nx"));
    expect(call("deduplicateTextLines", source("b\ra\na\nb\ra"))).toEqual(ok("b\ra\na"));
    expect(call("deduplicateTextLines", source(""))).toEqual(ok(""));
    expect(call("deduplicateTextLines", source(Array(128).fill("🦊").join("\n")))).toEqual(ok("🦊"));
    expect(call("deduplicateTextLines", source(Array(129).fill("same").join("\n")))).toMatchObject(refused);
    expect(call("deduplicateTextLines", source("🦊".repeat(4096)))).toEqual(ok("🦊".repeat(4096)));
  });

  test("frequencies preserve first appearance and count scalar text rather than graphemes", () => {
    expect(call("textCodePointFrequencies", source("bA🦊bA e\u0301é🦊"))).toEqual(ok([
      { codePoint: "b", count: 2 }, { codePoint: "A", count: 2 }, { codePoint: "🦊", count: 2 },
      { codePoint: " ", count: 1 }, { codePoint: "e", count: 1 }, { codePoint: "\u0301", count: 1 },
      { codePoint: "é", count: 1 },
    ]));
    expect(call("textCodePointFrequencies", source("AaA\n\n\u0000$.$"))).toEqual(ok([
      { codePoint: "A", count: 2 }, { codePoint: "a", count: 1 }, { codePoint: "\n", count: 2 },
      { codePoint: "\u0000", count: 1 }, { codePoint: "$", count: 2 }, { codePoint: ".", count: 1 },
    ]));
    expect(call("textCodePointFrequencies", source("👩‍💻👩"))).toEqual(ok([
      { codePoint: "👩", count: 2 }, { codePoint: "‍", count: 1 }, { codePoint: "💻", count: 1 },
    ]));
    expect(call("textCodePointFrequencies", source(""))).toEqual(ok([]));
    expect(call("textCodePointFrequencies", source("🦊".repeat(4096)))).toEqual(ok([{ codePoint: "🦊", count: 4096 }]));
    const distinct = Array.from({ length: 128 }, (_, index) => String.fromCodePoint(0x10000 + index));
    expect(call("textCodePointFrequencies", source(distinct.join("")))).toEqual(ok(distinct.map(codePoint => ({ codePoint, count: 1 }))));
    expect(call("textCodePointFrequencies", source(distinct.join("") + "x"))).toMatchObject(refused);
    for (const text of ["\ud83e", "\uddea", "🦊\ud83e", "\uddea🦊"]) {
      expect(call("textCodePointFrequencies", source(text))).toMatchObject(refused);
    }
    expect(call("textCodePointFrequencies", source("current"))).toMatchObject(ok(expect.any(Array)));
  });

  test("trim and normalization use the existing whitespace policy without changing ordinary text", () => {
    expect(call("trimText", " \talpha  beta\n ")).toEqual(ok("alpha  beta"));
    expect(call("normalizeTextWhitespace", source(" \talpha\u00a0 beta\n gamma  "))).toEqual(ok("alpha beta gamma"));
    expect(call("normalizeTextWhitespace", source(" \t\r\n"))).toEqual(ok(""));
    expect(call("normalizeTextWhitespace", source("line one\nline two"))).toEqual(ok("line one line two"));
  });

  test("replace refuses empty searches and output explosion, preserving literal nonoverlap rules", () => {
    expect(call("replaceText", source("aaaa"), "aa", "🦊")).toEqual(ok("🦊🦊"));
    expect(call("replaceText", source("alpha alpha"), "alpha", "$&")).toEqual(ok("$& $&"));
    expect(call("replaceText", source("hello"), "", "x")).toMatchObject(refused);
    expect(call("replaceText", source(""), "x", "y")).toEqual(ok(""));
    expect(call("replaceText", source("a".repeat(4096)), "a", "b")).toEqual(ok("b".repeat(4096)));
    expect(call("replaceText", source("a".repeat(4096)), "a", "bb")).toMatchObject(refused);
    expect(call("replaceText", source("aa"), "a", "🦊".repeat(4096))).toMatchObject(refused);
    expect(call("replaceText", source("aaaa"), "aa", "")).toEqual(ok(""));
    expect(call("replaceText", source("safe"), "missing", "x".repeat(4096))).toEqual(ok("safe"));
    expect(call("replaceText", source("🦊".repeat(2049)), "\ud83e", "x")).toMatchObject(refused);
  });

  test("replace refuses unpaired search/replacement surrogates and keeps prior admission order", () => {
    const scalarRefusal = { $tag: "Err", _0: "Use well-formed Unicode text without unpaired UTF-16 surrogates." };
    for (const text of ["\ud83e", "\udd8a", "🦊\ud83e", "\udd8a🦊"]) {
      expect(call("replaceText", source("🦊"), text, "x")).toEqual(scalarRefusal);
      expect(call("replaceText", source("🦊"), "🦊", text)).toEqual(scalarRefusal);
      expect(call("replaceText", source("safe"), "missing", text)).toEqual(scalarRefusal);
    }
    expect(call("replaceText", source("a🦊b🦊"), "🦊", "🦄")).toEqual(ok("a🦄b🦄"));
    expect(call("replaceText", source("🦊".repeat(4096)), "🦊", "🦄")).toEqual(ok("🦄".repeat(4096)));
    expect(call("replaceText", source("\ud83e"), "🦊", "x")).toEqual(ok("\ud83e"));
    expect(call("replaceText", source("safe"), "", "\ud83e")).toEqual({ $tag: "Err", _0: "Choose a nonempty literal search string." });
    expect(call("replaceText", source("x".repeat(4097)), "\ud83e", "x")).toEqual({ $tag: "Err", _0: "Use text with at most 4096 Unicode code points; the result must fit the same limit." });
  });

  test("slugs reuse the existing ASCII/combining-mark policy without universal transliteration claims", () => {
    expect(call("slugifyText", "  Étoile du nord — Volume One!  ")).toEqual(ok("etoile-du-nord-volume-one"));
    expect(call("slugifyText", "東京🦊")).toEqual(ok(""));
  });

  test("multiline tools consistently refuse oversized sources and recover with a current valid source", () => {
    for (const [name, rest] of [
      ["summarizeText", []], ["splitText", [","]], ["sortTextLines", []],
      ["deduplicateTextLines", []], ["textCodePointFrequencies", []],
      ["normalizeTextWhitespace", []], ["replaceText", ["x", "y"]],
    ] as const) {
      expect(call(name, source("x".repeat(4097)), ...rest)).toMatchObject(refused);
      expect(call(name, source("x"), ...rest)).toMatchObject(ok(expect.anything()));
    }
  });
});
