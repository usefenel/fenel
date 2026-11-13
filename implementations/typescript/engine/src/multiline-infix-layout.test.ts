import { afterAll, describe, expect, test } from "bun:test";
import SUBJECT_SOURCE from "../../../../fenel/modules/auth/subject.fenel?raw";
import { parse } from "./fenel-parser";
import {
  dispatchEngineBody,
  PARSE_VIA_FENEL_FAIL,
  parseViaFenelParser,
  setParserInterpreted,
} from "./engine-bodies-dispatch";

// C1: execute the canonical source parser while compiled owners are deferred.
// The existing B1 parser already accepts these infix continuations.
setParserInterpreted(true);
afterAll(() => setParserInterpreted(null));

function layout(source: string): Array<{ t: string; v: string }> {
  return dispatchEngineBody("engine:layoutTokens", [
    dispatchEngineBody("engine:lexAll", [source]),
  ]) as Array<{ t: string; v: string }>;
}

describe("equal-column infix continuation", () => {
  test("wrapped conditions and arithmetic preserve the complete expression", () => {
    for (const operator of ["&&", "||", "+", "-", "<", ">", "++", "and", "or"]) {
      const inline = `f x =\n  x ${operator} x`;
      const wrapped = `f x =\n  x ${operator}\n  x`;
      expect(layout(wrapped).filter((token) => token.t === "vsemi")).toEqual([]);
      expect(parse(wrapped)).toEqual(parse(inline));
      expect(parseViaFenelParser(wrapped)).toEqual(parse(inline));
    }
  }, 450_000);

  test("generic type closers retain the following directive boundary", () => {
    for (const type of [
      "Maybe<String>",
      "Foo < a >",
      "Result < String, Number >",
      "Foo < Maybe < String > >",
    ]) {
      const source = `f : ${type}\n@label "Identity"\ng x = x`;
      expect(layout(source).filter((token) => token.t === "vsemi")).toHaveLength(2);
      expect(parseViaFenelParser(source)).toEqual(parse(source));
    }
  }, 180_000);

  test("the actual Subject declaration leaves its codeName on the following accessor", () => {
    const start = SUBJECT_SOURCE.indexOf("Subject = User accountId: String userId: String");
    const end = SUBJECT_SOURCE.indexOf("-- requireAccountId", start);
    expect(start).toBeGreaterThanOrEqual(0);
    expect(end).toBeGreaterThan(start);
    const source = SUBJECT_SOURCE.slice(start, end).trimEnd();
    const tokens = layout(source);
    const directive = tokens.findIndex((token) => token.t === "@");
    expect(tokens[directive - 1]?.t).toBe("vsemi");
    expect(parseViaFenelParser(source)).toEqual(parse(source));
  }, 180_000);

  test("greater-than comparisons keep numeric and parenthesized operands", () => {
    for (const left of ["1", "(x)", "use x"]) {
      const source = `f x =\n  ${left} >\n  x`;
      expect(layout(source).filter((token) => token.t === "vsemi")).toEqual([]);
      expect(parseViaFenelParser(source)).toEqual(parse(source.replace(/>\n  x$/, "> x")));
    }
  }, 180_000);

  test("a directive cannot supply the right operand of an unfinished comparison", () => {
    const source = "f x =\n  x >\n  @label \"Other\"\n  g y = y";
    const tokens = layout(source);
    const directive = tokens.findIndex((token) => token.t === "@");
    expect(tokens[directive - 1]?.t).toBe("vsemi");
    expect(parseViaFenelParser(source)).toBe(PARSE_VIA_FENEL_FAIL);
  }, 60_000);

  test("comments and the following declaration retain their boundaries", () => {
    const source = "f x =\n  x &&\n  -- the right operand belongs to the same expression\n\n  x\ng y = y";
    expect(layout(source).filter((token) => token.t === "vsemi")).toHaveLength(1);
    expect(parseViaFenelParser(source)).toEqual(parse(source));
  }, 60_000);

  test("ordinary sibling expressions and bare word-operator values remain separate", () => {
    for (const first of ["x", "and", "or", "use (and)", "map (and) xs"]) {
      const source = `f x =\n  ${first}\n  x`;
      expect(layout(source).filter((token) => token.t === "vsemi")).toHaveLength(1);
      expect(parseViaFenelParser(source)).toEqual(parse(source));
    }
  }, 60_000);

  test("bare word infix retains its ordinary operator tree rather than becoming function data", () => {
    for (const source of ["f x =\n  use and\n  x", "f x =\n  map or\n  x"]) {
      const inline = source.replace(/\n  x$/, " x");
      expect(parseViaFenelParser(source)).toEqual(parse(inline));
      expect(parse(source)).toEqual(parse(inline));
    }
  }, 60_000);

  test("let and case-arm blocks keep their existing layout", () => {
    for (const source of [
      "f x =\n  let y = x\n  y &&\n  x",
      "f x =\n  case x of\n    True -> true &&\n            true\n    False -> false",
    ]) {
      expect(parseViaFenelParser(source)).toEqual(parse(source));
    }
  }, 60_000);

  test("an absent or dedented operand remains refused", () => {
    for (const source of [
      "f x =\n  x &&",
      "f x =\n  x &&\ng y = y",
      "f x =\n  x &&\nx",
      "f x =\n  -\n  x",
    ]) {
      expect(parseViaFenelParser(source)).toBe(PARSE_VIA_FENEL_FAIL);
    }
  }, 60_000);
});
