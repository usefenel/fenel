// The Fenel highlighter (CodeMirror stream language). Phase 2d: a type
// annotation is `(e : T)`, one colon; `::` is no longer Fenel syntax, so the
// highlighter no longer lists it as an operator.
import { describe, expect, test } from "bun:test";
import { StringStream } from "@codemirror/language";
import { tags as t } from "@lezer/highlight";
import { fenelParser } from "./fenel-language";

function tokens(line: string): { text: string; style: string | null }[] {
  const parser = fenelParser;
  const state = parser.startState!(2);
  const stream = new StringStream(line, 2, 2);
  const out: { text: string; style: string | null }[] = [];
  while (!stream.eol()) {
    const style = parser.token(stream, state);
    out.push({ text: stream.current(), style });
    stream.start = stream.pos;
  }
  return out.filter((token) => token.text.trim() !== "");
}

describe("Fenel highlighter", () => {
  test("an annotation's single colon is its own token", () => {
    const toks = tokens("(x : List String)");
    expect(toks.map((token) => token.text)).toEqual(["(", "x", ":", "List", "String", ")"]);
    expect(toks.find((token) => token.text === ":")?.style).toBe(t.bracket.toString());
    expect(toks.find((token) => token.text === "List")?.style).toBe(t.typeName.toString());
  });

  test("`::` is not an operator token", () => {
    const toks = tokens("x :: String");
    expect(toks.some((token) => token.text === "::")).toBe(false);
    expect(toks.filter((token) => token.text === ":").length).toBe(2);
  });

  test("the other two-character operators are unchanged", () => {
    for (const op of ["==", "!=", "<=", ">=", "|>", "->", "<-", ".."]) {
      const toks = tokens(`a ${op} b`);
      expect(toks.find((token) => token.text === op)?.style).toBe(t.operator.toString());
    }
  });
});

// modules-as-values Phase 5c-1a — `using` is a keyword everywhere (it is
// reserved in expressions); `import` and `module` only where a declaration
// starts, since they stay ordinary names elsewhere.
describe("Fenel highlighter — file-top using", () => {
  test("using is a keyword, its bundle and names are not", () => {
    const toks = tokens("using std (map, fold)");
    expect(toks.find((token) => token.text === "using")?.style).toBe(t.keyword.toString());
    expect(toks.find((token) => token.text === "std")?.style).toBe(t.variableName.toString());
    expect(toks.find((token) => token.text === "map")?.style).toBe(t.variableName.toString());
  });

  test("import and module are keywords at the start of a line only", () => {
    expect(tokens("import Telegram hiding (run)")[0]).toEqual({ text: "import", style: t.keyword.toString() });
    expect(tokens("module demo where")[0]).toEqual({ text: "module", style: t.keyword.toString() });
    expect(tokens("f import module").slice(1).map((token) => token.style)).toEqual([
      t.variableName.toString(),
      t.variableName.toString(),
    ]);
  });
});
