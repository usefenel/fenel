import { describe, expect, test } from "bun:test";
import type { Constraint, FenelType } from "../types";
import { Just, List, Maybe, Nothing, Result, Str, Int } from "../type-foundation";
import { peelList } from "../set-algebra";
import { repositoryIdentityLock } from "../repository-identity-manifest";
import {
  TYPE_KIND_GROUPS,
  constraintDraftToConstraint,
  constraintToDraft,
  defaultElExpressionForMode,
  defaultTypeForKind,
  detectElMode,
  detectTypeKind,
  fenelTypeToTypeExpr,
  peelResultForAuthoring,
  replaceTypeSugarArgument,
  newPositionalTypeField,
  reindexPositionalTypeFields,
  peelMaybeForAuthoring,
  peelListForAuthoring,
  typeExprToFenelType,
  type TypeKind,
} from "./type-authoring";

const ALL_KINDS: TypeKind[] = [
  "void", "unit", "named", "var", "type",
  "record", "variant", "tuple", "map",
  "list", "maybe", "result",
  "union", "intersect", "complement",
  "el-call", "refined", "mu",
  "tagged", "opaque", "arrow",
  "el",
];

describe("type authoring helpers", () => {
  test("unresolved and empty reference drafts remain in the named editor", () => {
    expect(detectTypeKind({ $ref: "" })).toBe("named");
    expect(detectTypeKind({ $ref: "MyModule.ForwardType" })).toBe("named");
  });
  test("transient record types remain editable before field identity normalization", () => {
    const type: FenelType = { $record: { fields: [{ name: "draft", type: { $ref: "String" }, label: Nothing, ui: Nothing, meta: {} }] } };
    expect(peelMaybeForAuthoring(type)).toBeNull();
    expect(peelListForAuthoring(type)).toBeNull();
    expect(peelResultForAuthoring(type)).toBeNull();
    expect(detectTypeKind(type)).toBe("record");
  });
  test("declared List elements retain nested unkeyed records while semantic peeling refuses them", () => {
    const element: FenelType = { $record: { fields: [{ name: "capture", type: { $ref: "String" }, label: Nothing, ui: Nothing, meta: {} }] } };
    const type = List(element);
    expect(peelListForAuthoring(type)?.elem).toBe(element);
    expect(() => peelList(type)).toThrow(/field-identity semantic boundary/);
    element.$record.fields[0]!.key = { $tag: "NamedField", ref: { $ref: "invalid" } };
    expect(peelListForAuthoring(type)?.elem).toBe(element);
    expect(() => peelList(type)).toThrow(/field-identity semantic boundary/);
  });
  test("identified List heads follow their canonical key after a wire rename", () => {
    const lock = repositoryIdentityLock();
    expect(lock.get("field:type%3Asystem%3AList/case%3ACons/named%3Ahead")).toBe("ffd5bf84-d5d7-4755-a3c9-649b4adbf994");
    expect(lock.get("field:type%3Asystem%3AList/case%3ACons/named%3Atail")).toBe("f604d45e-9b60-4b72-83ce-755d2780162c");
    const element: FenelType = { $ref: "String" };
    const type = List(element);
    if (!("$opaque" in type) || !type.$opaque.pure || !("$variant" in type.$opaque.pure)) throw new Error("Expected List declaration");
    const fields = type.$opaque.pure.$variant.cases.find((entry) => entry.name === "Cons")!.fields!;
    fields[0]!.key = { $tag: "NamedField", ref: { $ref: "ffd5bf84-d5d7-4755-a3c9-649b4adbf994" } };
    fields[0]!.name = "item";
    fields[1]!.key = { $tag: "NamedField", ref: { $ref: "f604d45e-9b60-4b72-83ce-755d2780162c" } };
    expect(peelListForAuthoring(type)?.elem).toBe(element);
    fields[0]!.key = { $tag: "NamedField", ref: { $ref: "ff33e9af-e819-4c9b-a564-20ec2401c83e" } };
    expect(peelListForAuthoring(type)).toBeNull();
    fields[0]!.name = "head";
    fields[0]!.key = { $tag: "NamedField", ref: { $ref: "invalid" } };
    expect(peelListForAuthoring(type)).toBeNull();
  });
  test("a canonical List spine retains an inferred record element before its local fields are normalized", () => {
    const element: FenelType = { $record: { fields: [
      { name: "amount", key: { $tag: "PositionalField", index: 0 }, type: { $ref: "Number" }, label: Nothing, ui: Nothing, meta: {} },
      { name: "label", key: { $tag: "PositionalField", index: 1 }, type: { $ref: "String" }, label: Nothing, ui: Nothing, meta: {} },
    ] } };
    const type = List(element);
    if (!("$opaque" in type) || !type.$opaque.pure || !("$variant" in type.$opaque.pure)) throw new Error("Expected List declaration");
    const fields = type.$opaque.pure.$variant.cases.find((entry) => entry.name === "Cons")!.fields!;
    fields[0]!.key = { $tag: "NamedField", ref: { $ref: "ffd5bf84-d5d7-4755-a3c9-649b4adbf994" } };
    fields[1]!.key = { $tag: "NamedField", ref: { $ref: "f604d45e-9b60-4b72-83ce-755d2780162c" } };
    expect(peelListForAuthoring(type)?.elem).toBe(element);
    expect(() => peelList(type)).toThrow(/field-identity semantic boundary/);
    fields[1]!.key = fields[0]!.key;
    expect(peelListForAuthoring(type)).toBeNull();
    fields[1]!.key = { $tag: "NamedField", ref: { $ref: "invalid" } };
    expect(peelListForAuthoring(type)).toBeNull();
  });
  test("declared List projection refuses malformed shape and accessor payloads without invoking them", () => {
    const type = List({ $ref: "String" });
    if (!("$opaque" in type) || !type.$opaque.pure || !("$variant" in type.$opaque.pure)) throw new Error("Expected List declaration");
    const variant = type.$opaque.pure.$variant;
    variant.cases.push({ name: "Pending", label: Nothing });
    expect(peelListForAuthoring(type)).toBeNull();
    variant.cases.pop();
    const fields = variant.cases.find((entry) => entry.name === "Cons")!.fields!;
    let reads = 0;
    Object.defineProperty(fields[0], "type", { get: () => { reads += 1; return { $ref: "String" }; }, configurable: true });
    expect(peelListForAuthoring(type)).toBeNull();
    expect(reads).toBe(0);
    Object.defineProperty(fields[0], "type", { value: { $ref: "String" }, configurable: true });
    Object.defineProperty(fields[0], "key", { get: () => { reads += 1; return undefined; }, configurable: true });
    expect(peelListForAuthoring(type)).toBeNull();
    expect(reads).toBe(0);
  });
  test("ordinary primitive opaques retain their shallow non-List authoring projection", () => {
    expect(peelListForAuthoring(Str)).toBeNull();
    expect(peelListForAuthoring(Int)).toBeNull();
  });
  test("positional field deletion/reordering keeps local ordinals and wire names", () => {
    const first = newPositionalTypeField(0);
    const second = newPositionalTypeField(1);
    const named = { ...newPositionalTypeField(2), name: "display", key: { $tag: "NamedField" as const, ref: { $ref: "ff33e9af-e819-4c9b-a564-20ec2401c83e" } } };
    const reordered = reindexPositionalTypeFields([second, named, first]);
    expect(reordered.map((field) => field.name)).toEqual(["_1", "display", "_0"]);
    expect(reordered.map((field) => field.key)).toEqual([{ $tag: "PositionalField", index: 0 }, named.key, { $tag: "PositionalField", index: 2 }]);
    expect(reordered[1]).toBe(named);
    expect(reindexPositionalTypeFields([second])[0]!.key).toEqual({ $tag: "PositionalField", index: 0 });
  });
  test("sugar payload edits preserve wrappers and occurrence identity", () => {
    for (const [base, argument] of [[List({ $ref: "String" }), "element"], [Maybe({ $ref: "String" }), "inner"], [Result({ $ref: "String" }, { $ref: "Number" }), "err"]] as const) {
      const variant = "$opaque" in base ? base.$opaque.pure! : base;
      if (!("$variant" in variant)) throw new Error("Expected canonical variant");
      variant.$variant.discriminator = "kind";
      const caseName = argument === "element" ? "Cons" : argument === "inner" ? "Just" : "Err";
      const entry = variant.$variant.cases.find((c) => c.name === caseName)!;
      entry.label = Just("Payload");
      const field = entry.fields![0]!;
      field.label = Just("Retained field");
      const originalType = field.type;
      const type: FenelType = { $refined: { base, set: { $tag: "SeWhere", pred: { var: "value" } } } };
      const next = replaceTypeSugarArgument(type, argument, { $ref: "Boolean" });
      const expected = structuredClone(type);
      const expectedBase = (expected as Extract<FenelType, { $refined: unknown }>).$refined.base;
      const expectedVariant = "$opaque" in expectedBase ? expectedBase.$opaque.pure! : expectedBase;
      if (!("$variant" in expectedVariant)) throw new Error("Expected variant");
      expectedVariant.$variant.cases.find((c) => c.name === caseName)!.fields![0]!.type = { $ref: "Boolean" };
      expect(next).toEqual(expected);
      expect(field.type).toBe(originalType);
    }
  });

  test("Result convenience does not conceal additional cases or payload fields", () => {
    const type = Result({ $ref: "String" }, { $ref: "Number" });
    if (!("$variant" in type)) throw new Error("Expected variant");
    type.$variant.cases.push({ name: "Pending", label: Nothing });
    expect(peelResultForAuthoring(type)).toBeNull();
    expect(detectTypeKind(type)).toBe("variant");
  });

  test("the picker exposes every supported FenelType constructor exactly once", () => {
    const pickable = TYPE_KIND_GROUPS.flatMap((g) => g.kinds);
    expect(new Set(pickable).size).toBe(pickable.length);
    expect(new Set(pickable)).toEqual(new Set(ALL_KINDS));
  });

  test("defaults detect back to their kind for every pickable former", () => {
    for (const kind of ALL_KINDS) {
      expect(detectTypeKind(defaultTypeForKind(kind))).toBe(kind);
    }
  });

  test("Result peeling accepts positional and named result variants", () => {
    const positional: FenelType = {
      $variant: {
        cases: [
          { name: "Err", label: Nothing, fields: [{ name: "_0", label: Nothing, type: { $ref: "String" }, meta: {}, ui: Nothing }] },
          { name: "Ok", label: Nothing, fields: [{ name: "_0", label: Nothing, type: { $ref: "Number" }, meta: {}, ui: Nothing }] },
        ],
      },
    };
    const named: FenelType = {
      $variant: {
        cases: [
          { name: "Err", label: Nothing, fields: [{ name: "value", label: Nothing, type: { $ref: "String" }, meta: {}, ui: Nothing }] },
          { name: "Ok", label: Nothing, fields: [{ name: "value", label: Nothing, type: { $ref: "Boolean" }, meta: {}, ui: Nothing }] },
        ],
      },
    };
    expect(peelResultForAuthoring(positional)).toEqual({
      err: { $ref: "String" },
      ok: { $ref: "Number" },
    });
    expect(peelResultForAuthoring(named)).toEqual({
      err: { $ref: "String" },
      ok: { $ref: "Boolean" },
    });
  });

  test("$el expression modes project the canonical expression shapes", () => {
    expect(detectElMode(defaultElExpressionForMode("sibling"))).toBe("sibling");
    expect(detectElMode(defaultElExpressionForMode("call"))).toBe("call");
    expect(detectElMode(defaultElExpressionForMode("if"))).toBe("if");
    expect(detectElMode(defaultElExpressionForMode("match"))).toBe("match");
    expect(detectElMode({ let: { t: { $ref: "String" } } })).toBe("expression");
  });

  test("constraint drafts preserve the persisted class/id shape", () => {
    const constraint = constraintDraftToConstraint({
      interfaceName: "HasStateIO",
      args: [{ $var: "scope" }, { $ref: "Profile" }],
    });
    expect(constraint).toEqual({
      class: { $tag: "Id", entityId: "HasStateIO" },
      args: [{ $var: "scope" }, "Profile"],
    });
    expect(constraintToDraft(constraint)).toEqual({
      interfaceName: "HasStateIO",
      args: [{ $var: "scope" }, { $ref: "Profile" }],
    });
  });

  test("TypeExpr conversion covers named refs, variables, and generic apps", () => {
    const type: FenelType = {
      $el: { call: ["Maybe", { $var: "a" }, { $ref: "Profile" }] },
    };
    const expr = fenelTypeToTypeExpr(type);
    expect(expr).toEqual({
      $el: { call: ["Maybe", { $var: "a" }, "Profile"] },
    });
    expect(typeExprToFenelType(expr)).toEqual(type);
  });

  test("loaded constraints with TypeExpr args become type-builder drafts", () => {
    const loaded: Constraint = {
      class: { $tag: "Id", entityId: "Symbolic" },
      args: [{ $el: { call: ["Vec", "Nat", { $var: "a" }] } }],
    };
    expect(constraintToDraft(loaded)).toEqual({
      interfaceName: "Symbolic",
      args: [{ $el: { call: ["Vec", { $ref: "Nat" }, { $var: "a" }] } }],
    });
  });
});
