import { beforeAll, describe, expect, test } from "bun:test";
import UTILITY_TEXT_SOURCE from "../../../../fenel/modules/publicdemo/utility-text.fenel?raw";
import { parse, tokenize } from "./fenel-parser";
import {
  dispatchEngineBody,
  parseViaFenelParser,
  PARSE_VIA_FENEL_FAIL,
  withInterpretedCompiledArtifacts,
} from "./engine-bodies-dispatch";

// C1 actual-source differential: force source kernels, use the same frame
// marshaller, and compare their results with the existing B1 parser oracle.
// No emitted artifact, replacement evaluator or oracle payload supplies an AST.
type Token = { t: string; v: string; ln: number; col: number; off?: number };
const sourceCall = (name: string, ...args: unknown[]): unknown =>
  withInterpretedCompiledArtifacts(() => dispatchEngineBody(`engine:${name}`, args));
const sourceParse = (source: string): unknown =>
  withInterpretedCompiledArtifacts(() => parseViaFenelParser(source));
const tokenProjection = ({ t, v, ln, col }: Token) => ({ t, v, ln, col });

beforeAll(() => {
  expect(sourceCall("unitLen", "A🦊")).toBe(3);
}, 180_000);

describe("source token Unicode value preservation", () => {
  test("encoded scalar and template tokens retain complete decoded values", () => {
    const values = ["", "🦊", "a🦊b", "🦊🦊", "Hello 🦊 world\nOne more line\n", "🦊\t\"\\end", "a\u0000🦊"];
    for (const t of ["str", "ident", "identity", "str_begin", "str_mid", "str_end"]) {
      for (const v of values) {
        const encoded = sourceCall("encodeTok", { t, v }) as string;
        expect(encoded).toBe(`${t}\u0000${v}`);
        expect(sourceCall("splitVal", encoded)).toBe(v);
      }
    }
  });

  test("separator scans retain UTF-16 end bounds, including absent separators", () => {
    for (const value of ["", "plain", "🦊", "a🦊b", "🦊🦊"]) {
      expect(sourceCall("sepIndex", value, 0)).toBe(value.length);
      expect(sourceCall("splitVal", value)).toBe("");
    }
    expect(sourceCall("sepIndex", "🦊\u0000value", 0)).toBe(2);
    expect(sourceCall("splitVal", "🦊\u0000value")).toBe("value");
    expect(sourceCall("splitVal", "str\u0000a\u0000🦊")).toBe("a\u0000🦊");
  });

  test("the lexer still matches the oracle's values, UTF-16 columns and line positions", () => {
    const sources = [
      'a = "🦊"; b = 1',
      'a = "start🦊middle🦊end"\nb = "tail🦊"',
      'a = "Hello 🦊 world\\nOne more line\\n"\nb = "tab\\tquote\\\"slash\\\\end"',
      'render name = `🦊:${name}:🦊`',
    ];
    for (const source of sources) {
      const tokens = sourceCall("lexAll", source) as Token[];
      expect(tokens.map(tokenProjection)).toEqual(tokenize(source).map(tokenProjection));
    }
    const tokens = sourceCall("lexAll", sources[0]) as Token[];
    expect(tokens.find(token => token.v === "b")).toMatchObject({ ln: 1, col: 10, off: 10 });
  });

  test("ordinary parser literals, record fields and list positions preserve the complete AST", () => {
    const source = [
      'message = "Fenel 🦊"',
      'record = { text = "Hello 🦊 world\\nOne more line\\n", note = "tab\\tquote\\\"slash\\\\end" }',
      'values = ["🦊", "a🦊b", "🦊🦊", ""]',
    ].join("\n");
    const actual = sourceParse(source);
    expect(actual).not.toBe(PARSE_VIA_FENEL_FAIL);
    expect(JSON.stringify(actual)).toBe(JSON.stringify(parse(source)));
  }, 180_000);

  test("template segments retain astral values around an actual expression hole", () => {
    const source = 'render name = `🦊:${name}:🦊`';
    const actual = sourceParse(source);
    expect(actual).not.toBe(PARSE_VIA_FENEL_FAIL);
    expect(JSON.stringify(actual)).toBe(JSON.stringify(parse(source)));
  }, 180_000);

  test("actual utility provider rows preserve astral values, trailing newlines and tabs", () => {
    // Keep the source facade's existing declaration budget. Select intact
    // rows from the real file as finite source fixtures, rather than rebuilding
    // their values from the B1 oracle. Whole-file compiled parity is the cache
    // driver's separate responsibility.
    const lines = UTILITY_TEXT_SOURCE.split(/\r?\n/);
    const names = ["reverseText", "summarizeText", "sortTextCodePoints", "normalizeTextWhitespace"];
    const source = names.map((name, index) => {
      const row = lines.find(line => line.includes(`{ function = ${name},`));
      if (row === undefined) throw new Error(`The actual utility starting row for ${name} is missing`);
      return `example${index} = ${row.trim().replace(/,$/, "")}`;
    }).join("\n");
    const actual = sourceParse(source);
    expect(actual).not.toBe(PARSE_VIA_FENEL_FAIL);
    expect(JSON.stringify(actual)).toBe(JSON.stringify(parse(source)));
  }, 180_000);
});
