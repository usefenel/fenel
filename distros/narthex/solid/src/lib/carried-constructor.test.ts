import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import type { FenelType } from "@fenel/engine/types";
import { loadFenelModule } from "../../../../../implementations/typescript/engine/src/fenel-module";
import { carriedConstructor } from "./carried-constructor";

describe("carriedConstructor: the declared fields of the constructor a value carries", () => {
  // A record field typed by a variant of several constructors (LifeCrossSet's `constraint: SetExpr`) had no
  // declared fields in the typed reader, so `{ $tag: "SeEnum", values: [{ $tag: "CocosNucifera" }, …] }` fell to
  // the untyped preview, which prints raw tags ("SeEnum", "CocosNucifera"). The case the value names has them.
  const source = [
    "module CarriedConstructorProbe where", "",
    "Thing = AllThings | LeafThing", "",
    "Choice = Everything | OneOf values: List Any | Between low: Number high: Number", "",
  ].join(String.fromCharCode(10));
  const loaded = loadFenelModule(source, "CarriedConstructorProbe");
  const entities = loaded.entities as unknown as Array<{ id: string; type: FenelType }>;
  const resolver = { resolveNamedType: (name: string) => entities.find(row => row.id === name)?.type };
  const choice = { $ref: "Choice" } as FenelType;

  test("a constructor with fields gives its own fields, by the value's tag", () => {
    const carried = carriedConstructor(choice, { $tag: "OneOf", values: [{ $tag: "LeafThing" }] }, resolver);
    expect(carried?.tag).toBe("OneOf");
    expect(carried?.fields.map(field => field.name)).toEqual(["values"]);
    expect(carriedConstructor(choice, { $tag: "Between", low: 1, high: 2 }, resolver)?.fields.map(field => field.name)).toEqual(["low", "high"]);
  });

  test("nothing for a case without fields, an unknown case, an untagged or non-record value, or an unknown type", () => {
    expect(carriedConstructor(choice, { $tag: "Everything" }, resolver)).toBeUndefined();
    expect(carriedConstructor(choice, { $tag: "Elsewhere", values: [] }, resolver)).toBeUndefined();
    expect(carriedConstructor(choice, { values: [] }, resolver)).toBeUndefined();
    expect(carriedConstructor(choice, [{ $tag: "OneOf" }], resolver)).toBeUndefined();
    expect(carriedConstructor({ $ref: "Missing" } as FenelType, { $tag: "OneOf", values: [] }, resolver)).toBeUndefined();
    expect(carriedConstructor(undefined, { $tag: "OneOf", values: [] }, resolver)).toBeUndefined();
  });

  test("the real SetExpr declaration: SeEnum carries its values", () => {
    const text = readFileSync(new URL("../../../../../fenel/modules/engine/set-expr-types.fenel", import.meta.url), "utf8");
    // Only the SetExpr declaration, as written in the engine's source (its other types are not needed here).
    const start = text.indexOf("SetExpr =");
    const end = text.indexOf("\n\n", start);
    const declaration = text.slice(start, end).split("\n").filter(line => !line.trim().startsWith("--")).join("\n");
    const probeModule = loadFenelModule(["module SetExprProbe where", "", "SetPattern = SpAny", "SetCtorField = SetCtorField name: String", "SetArrowParam = SetArrowParam name: String", "", declaration, ""].join("\n"), "SetExprProbe");
    const rows = probeModule.entities as unknown as Array<{ id: string; type: FenelType }>;
    const setExpr = { resolveNamedType: (name: string) => rows.find(row => row.id === name)?.type };
    const value = { $tag: "SeEnum", values: [{ $tag: "CocosNucifera" }, { $tag: "CitrusLimon" }] };
    expect(carriedConstructor({ $ref: "SetExpr" } as FenelType, value, setExpr)?.fields.map(field => field.name)).toEqual(["values"]);
  });
});
