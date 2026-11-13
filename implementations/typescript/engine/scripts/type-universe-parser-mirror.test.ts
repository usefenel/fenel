// B1/C1: the existing Type-of-Types atom in every type-argument spelling.
import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { parse, tokenize } from "../src/fenel-parser";
import { List, Maybe, Result } from "../src/type-foundation";
import type { FenelType } from "../src/types";

const universe: FenelType = { $type: true };
type Signature = { name: string; type: FenelType; scheme: { body: FenelType; quantified: { sourceName: string }[]; diagnostics: unknown[] } };
function signature(spelling: string): Signature {
  return (parse(`value : ${spelling}`) as unknown as { type_sig: Signature }).type_sig;
}

describe("Type universe parser performance mirror", () => {
  test.each([
    ["Type", universe],
    ["List Type", List(universe)],
    ["Maybe Type", Maybe(universe)],
    ["Result String Type", Result({ $ref: "String" }, universe)],
    ["Result Type String", Result(universe, { $ref: "String" })],
    ["Id Type", { $el: { call: ["Id", universe] } }],
    ["List (Maybe Type)", List(Maybe(universe))],
    ["Maybe (List Type)", Maybe(List(universe))],
    ["List (Type)", List(universe)],
    ["List<Type>", List(universe)],
    ["Maybe<Type>", Maybe(universe)],
    ["Result<String, Type>", Result({ $ref: "String" }, universe)],
    ["[Type]", List(universe)],
  ] as [string, FenelType][])("%s preserves the universe in compatibility and scheme types", (spelling, expected) => {
    const parsed = signature(spelling);
    expect(parsed.type).toEqual(expected);
    expect(parsed.scheme.body).toEqual(expected);
    expect(parsed.scheme.quantified).toEqual([]);
    expect(parsed.scheme.diagnostics).toEqual([]);
  });

  test("record fields and declaration aliases use the same universe atom", () => {
    const record = signature("{ marker: Type, members: List Type }").type as { $record: { fields: { type: FenelType }[] } };
    expect(record.$record.fields.map(field => field.type)).toEqual([universe, List(universe)]);
    const definition = parse("Box = Box members: List Type") as unknown as { type_def: { constructors: { fields: { type: FenelType }[] }[] } };
    expect(definition.type_def.constructors[0]!.fields[0]!.type).toEqual(List(universe));
    const alias = parse('opaque "types" Types = List Type') as unknown as { type_def: { alias: FenelType } };
    expect(alias.type_def.alias).toEqual(List(universe));
    const refinedAlias = parse("TypeCollection = List Type | true") as unknown as { type_def: { refined: { $refined: { base: FenelType } } } };
    expect(refinedAlias.type_def.refined.$refined.base).toEqual(List(universe));
  });

  test("the actual TypeUnion source retains the identical type in its field, parameter and scheme", () => {
    const source = readFileSync(resolve(import.meta.dir, "../../../../fenel/modules/std/type-union.fenel"), "utf8");
    const parsed = parse(source) as unknown as { program: { type_def?: { name: string; constructors: { fields: { type: FenelType }[] }[] }; type_sig?: Signature }[] };
    const marker = parsed.program.find(frame => frame.type_def?.name === "TypeUnionMarker")!.type_def!;
    const fn = parsed.program.find(frame => frame.type_sig?.name === "typeUnion")!.type_sig!;
    expect(marker.constructors[0]!.fields[0]!.type).toEqual(List(universe));
    const compatibility = fn.type as { $arrow: { params: { type: FenelType }[]; returns: FenelType } };
    const scheme = fn.scheme.body as typeof compatibility;
    expect(compatibility.$arrow.params[0]!.type).toEqual(List(universe));
    expect(scheme.$arrow.params[0]!.type).toEqual(List(universe));
    expect(compatibility.$arrow.returns).toEqual(universe);
    expect(fn.scheme.body).toEqual(fn.type);
    expect(JSON.stringify(parsed)).not.toContain('"$ref":"Type"');
  });

  test("nominal names, source variables and exact identity references keep their old roles", () => {
    expect(signature("List Customer").type).toEqual(List({ $ref: "Customer" }));
    expect(signature("List Types").type).toEqual(List({ $ref: "Types" }));
    const variable = signature("List a");
    expect(variable.type).toEqual(List({ $var: "a" }));
    expect(variable.scheme.quantified.map(row => row.sourceName)).toEqual(["a"]);
    const identity = "12345678-1234-4234-8234-123456789abc";
    expect(signature(`List @{${identity}}`).type).toEqual(List({ $ref: identity }));
  });

  test("Type stays an ordinary value identifier and parameter name", () => {
    expect(tokenize("Type").map(token => ({ t: token.t, v: token.v }))).toEqual([
      { t: "ident", v: "Type" }, { t: "eof", v: "" },
    ]);
    expect(parse("Type")).toEqual({ construct: ["Type"] });
    expect(parse("{ Type = 7 }")).toEqual({ Type: 7 });
    expect(parse("ignore Type = 7")).toEqual({ def: { name: "ignore", params: ["Type"], body: 7 } });
    const named = signature("(Type: String) -> String").type as { $arrow: { params: { name: string }[] } };
    expect(named.$arrow.params[0]!.name).toBe("Type");
    expect(signature("Vec Int (Type + 1)").type).toEqual({ $el: { call: ["Vec", { $ref: "Int" }, { call: ["add", { construct: ["Type"] }, 1] }] } });
  });
});
