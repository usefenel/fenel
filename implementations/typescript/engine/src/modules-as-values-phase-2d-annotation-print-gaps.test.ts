// ---------------------------------------------------------------------------
// modules-as-values Phase 2d — the printer never writes an annotation that no
// parser reads back.
//
// Both parsers read one annotation-type language (the Fenel `typeGrammar` and
// its TypeScript mirror `parseAnnotationType`). A type outside it — a
// refinement, a tuple of fewer than two types, an arrow with no parameter, a
// field or parameter name that is not one identifier token (a reserved word:
// `(where: Int) -> Int`) — used to print as text both parsers refuse, which
// the editor's code lens then offered as editable source. `ppAnn` now prints
// the `<no surface syntax: …>` diagnostic for each (`ppTypeSurfaceGap`,
// `ppNameGap`), and the printable controls still round-trip. A juxtaposed
// string argument (`Infixable "std.add"`) is printable: both parsers read it.
// ---------------------------------------------------------------------------

import { describe, expect, it } from "bun:test";
import { parse } from "./fenel-parser";
import { KW } from "./parser-keywords";
import { print } from "./engine-bodies-dispatch";
import type { FenelType } from "./types";

const TO = 180_000;
const x = { var: "x" };
const ref = (name: string): FenelType => ({ $ref: name }) as FenelType;
const printAnn = (type: unknown): string => print({ ann: [x, type] } as never);

describe("Phase 2d printer — annotation types outside the annotation language print as a gap", () => {
  const GAPS: Array<[label: string, type: unknown, reason: string]> = [
    [
      "a refinement",
      { $refined: { base: ref("Int"), set: { $tag: "SeInterval", interval: { lo: { $tag: "Closed", _0: 0 }, hi: { $tag: "Unbounded" } } } } },
      "a refinement",
    ],
    ["the empty tuple", { $tuple: [] }, "a tuple of fewer than two types"],
    ["a one-element tuple", { $tuple: [ref("Int")] }, "a tuple of fewer than two types"],
    ["an arrow with no parameter", { $arrow: { params: [], returns: ref("Int") } }, "an arrow with no parameter"],
    [
      "a reserved word as an arrow parameter name",
      { $arrow: { params: [{ name: "where", type: ref("Int") }], returns: ref("Int") } },
      'a parameter name that is not an identifier: "where"',
    ],
    [
      "a reserved word as a later arrow parameter name",
      { $arrow: { params: [{ name: "n", type: ref("Int") }, { name: "in", type: ref("Int") }], returns: ref("Int") } },
      'a parameter name that is not an identifier: "in"',
    ],
    [
      "a reserved word as a record field name",
      { $record: { fields: [{ name: "end", type: ref("Int") }] } },
      'a record field name that is not an identifier: "end"',
    ],
  ];
  for (const [label, type, reason] of GAPS) {
    it(`${label} prints the diagnostic, never text a parser would refuse`, () => {
      const printed = printAnn(type);
      expect(printed).toContain("<no surface syntax:");
      expect(printed).toContain(reason);
      expect(() => parse(printed)).toThrow();
    }, TO);
  }

  const PRINTABLE: Array<[label: string, source: string]> = [
    ["a named type", "(x : Int)"],
    ["a two-element tuple parameter", "(x : (A -> B, C) -> D)"],
    ["an EntityRef with its string argument", '(x : EntityRef "profile")'],
    ["an application", "(x : Result String (List Int))"],
    ["a record", "(x : {a: Int})"],
    ["a juxtaposed string argument", '(x : Infixable "std.add")'],
    ["a string argument after a type argument", '(x : Vec Int "three")'],
    ["a named arrow parameter", "(x : (n: Int) -> Int)"],
    ["named arrow parameters", "(x : (n: Int, m: Int) -> Int)"],
  ];
  for (const [label, source] of PRINTABLE) {
    it(`${label} still prints as a type and reads back`, () => {
      const logic = parse(source);
      const printed = print(logic as never);
      expect(printed).not.toContain("<no surface syntax:");
      expect(parse(printed)).toEqual(logic);
    }, TO);
  }

  // The reserved words the fence covers are the lexer's own (every keyword and
  // the two Bool literals lex as non-identifier tokens): each is refused as a
  // parameter name by the TypeScript parser, and each prints as the gap.
  const RESERVED = [...KW, "true", "false"];
  it("every reserved word is refused as a parameter name, and prints as the gap", () => {
    for (const word of RESERVED) {
      expect(() => parse(`(x : (${word}: Int) -> Int)`)).toThrow();
      const printed = printAnn({ $arrow: { params: [{ name: word, type: ref("Int") }], returns: ref("Int") } });
      expect(printed).toBe(`(x : <no surface syntax: a parameter name that is not an identifier: "${word}">)`);
    }
  }, TO);
});
