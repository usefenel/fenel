// ---------------------------------------------------------------------------
// imports-csv-parse.test.ts — Phase 5a-csv byte-equality round-trip proof.
//
// THE F-PERMANENT OVERTURN's safety net. The 12d-7 wrapper-side TS parseCsv +
// splitCsvLine were folded into the imports.fenel body as a pure char-fold
// (splitCsvLine via std:fold over `split line ""`; parseCsv via head/tail +
// zipRowGo). Because the bodies are PURE (no IO / DB), they run in-process via
// the engine `evaluate` — no standalone-script wall. This test asserts the
// Fenel parsers produce BYTE-IDENTICAL output to the EXACT original TS
// parseCsv / splitCsvLine (inlined verbatim below) across the full tricky-case
// set: the proof the overturn is faithful.
// ---------------------------------------------------------------------------

import { test, expect, describe } from "bun:test";
import { evaluate } from "./json-logic";
import { createRegistry } from "./registry";
import { stdModule } from "./modules/std";
import { importsModule } from "./modules/imports";

// --- The ORIGINAL wrapper-side TS, inlined verbatim from the pre-port
//     core/src/actions/imports.ts (the reference oracle). ------------------
function tsSplitCsvLine(line: string): string[] {
  const result: string[] = [];
  let current = "";
  let inQuote = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i]!;
    if (ch === '"') {
      if (inQuote && line[i + 1] === '"') {
        current += '"';
        i++;
      } else {
        inQuote = !inQuote;
      }
    } else if (ch === "," && !inQuote) {
      result.push(current);
      current = "";
    } else {
      current += ch;
    }
  }
  result.push(current);
  return result;
}

function tsParseCsv(text: string): Record<string, string>[] {
  const lines = text.trim().split("\n");
  if (lines.length < 2) return [];
  const headers = tsSplitCsvLine(lines[0]!);
  const rows: Record<string, string>[] = [];
  for (let i = 1; i < lines.length; i++) {
    const values = tsSplitCsvLine(lines[i]!);
    const row: Record<string, string> = {};
    for (let j = 0; j < headers.length; j++) {
      row[headers[j]!.trim()] = (values[j] ?? "").trim();
    }
    rows.push(row);
  }
  return rows;
}

// --- The Fenel side, evaluated in-process. -------------------------------
const reg = createRegistry([stdModule, importsModule]);
const ctx = reg.evaluateContext();
const fSplit = (line: string): unknown => evaluate({ call: ["splitCsvLine", line] }, {}, ctx);
const fParse = (text: string): unknown => evaluate({ call: ["parseCsv", text] }, {}, ctx);

// --- The tricky-case corpus. ---------------------------------------------
const SPLIT_CASES: string[] = [
  "a,b,c", // plain
  "", // empty line
  "single", // one field, no comma
  "a,,c", // empty middle field
  "a,b,", // trailing empty field
  ",a,b", // leading empty field
  '"a,b",c', // quoted field with embedded comma
  '"hello world",x', // quoted field with space
  '"a""b",c', // "" escape → literal quote
  '"""quoted"""', // escaped quotes at field edges
  '"a""""b"', // double "" escape
  'x"y"z', // quote mid-field (toggles)
  '"unterminated', // unterminated quote
  'a,"b,c",d', // comma inside quotes between plain fields
  '"x"y"z"', // alternating quote/plain
  '  spaced  ,  values  ', // whitespace (NOT trimmed by splitCsvLine)
  "café,naïve", // unicode (BMP)
  "emoji😀,tail", // unicode (astral / surrogate pair)
  "trailing\r", // bare CR (CRLF artifact — NOT trimmed by splitCsvLine)
  '"a\rb",c', // CR inside quotes
  ",", // just a comma → ["",""]
  '","', // quoted comma → [","]
  '""', // empty quoted field → [""]
];

const PARSE_CASES: string[] = [
  "", // empty input → []
  "   ", // whitespace-only → []
  "email\n", // header only (after trim, 1 line) → []
  "email", // header only, no newline → []
  "email,phone\na@b.co,123", // basic two-column
  "email,phone\na@b.co,123\nc@d.co,456", // multiple data rows
  "  email  ,  phone  \n  a@b.co  ,  123  ", // header + value whitespace (trimmed)
  'name,note\nAlice,"hello, world"', // embedded comma in quotes
  'name,note\nBob,"say ""hi"""', // "" escape in a value
  "a,b,c\n1,2", // short data row (missing value → "")
  "a,b\n1,2,3", // long data row (extra value ignored)
  "email\r\na@b.co\r", // CRLF line endings (\r trimmed at row build)
  "x,y\n,", // empty values
  "first_name,last_name\nAda,Lovelace\nGrace,Hopper", // realistic
];

describe("splitCsvLine — byte-equality vs the original TS oracle", () => {
  for (const line of SPLIT_CASES) {
    test(`splitCsvLine(${JSON.stringify(line)})`, () => {
      expect(fSplit(line)).toEqual(tsSplitCsvLine(line));
    });
  }
});

describe("parseCsv — byte-equality vs the original TS oracle", () => {
  for (const text of PARSE_CASES) {
    test(`parseCsv(${JSON.stringify(text)})`, () => {
      expect(fParse(text)).toEqual(tsParseCsv(text));
    });
  }
});

describe("parseJsonRows — JSON fork leaf (JSON.parse + array-coerce)", () => {
  const fJson = (s: string): unknown => evaluate({ call: ["parseJsonRows", s] }, {}, ctx);
  test("array passes through", () => {
    expect(fJson('[{"email":"a@b.co"},{"email":"c@d.co"}]')).toEqual([
      { email: "a@b.co" },
      { email: "c@d.co" },
    ]);
  });
  test("single object is wrapped to a one-element list", () => {
    expect(fJson('{"email":"a@b.co"}')).toEqual([{ email: "a@b.co" }]);
  });
  test("empty array", () => {
    expect(fJson("[]")).toEqual([]);
  });
});
