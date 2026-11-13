import { describe, expect, test } from "bun:test";
import type { ExprNode } from "@fenel/engine/authoring/expression";
import type { FenelType, FieldDef } from "@fenel/engine/types";
import { Nothing } from "@fenel/engine/type-foundation";
import {
  NOT_DATA, dataOfNode, replaceRow, rowIssue, simpleFormModel, type SimpleFormFacts,
} from "./simple-data-form-model";

// Demo 1 (Nov 8): New data of a record type reads like a simple form.
const field = (name: string, type: FenelType): FieldDef => ({ name, type, label: Nothing, ui: Nothing, meta: {} });
const lit = (value: unknown): ExprNode => ({ kind: "literal", value });
const construct = (tag: string, fields: [string, ExprNode][]): ExprNode =>
  lit({ __construct: { tag, fields: fields.map(([name, value]) => ({ name, value })) } });

const personFields = [field("name", { $ref: "String" }), field("phone", { $ref: "Phone" })];
const dateFields = [field("year", { $ref: "Int" }), field("month", { $ref: "Int" }), field("day", { $ref: "Int" })];
const txFields = [field("amount", { $ref: "Number" }), field("person", { $ref: "person-uuid" }), field("date", { $ref: "CalendarDate" })];
const seededPerson = construct("@ctor/Person", [["name", lit("")], ["phone", lit(undefined)]]);
const seededTx = construct("@ctor/Transaction", [["amount", lit(0)], ["person", seededPerson], ["date", lit(undefined)]]);

function facts(saved: { id: string; expr: ExprNode }[] = []): SimpleFormFacts {
  return {
    constructorFields: (tag) => tag === "@ctor/Transaction" ? txFields : tag === "@ctor/Person" ? personFields : undefined,
    // Every field here has an input; the computed ones are told apart by their node.
    hasWidget: () => true,
    saved: () => saved,
  };
}

describe("which drafts the simple form shows", () => {
  test("a constructor draft with exactly its declared named fields", () => {
    const model = simpleFormModel(seededTx, facts());
    expect(model?.tag).toBe("@ctor/Transaction");
    expect(model?.rows.map((row) => row.field.name)).toEqual(["amount", "person", "date"]);
  });
  test("anything else keeps the full editor", () => {
    expect(simpleFormModel(lit(3), facts())).toBeUndefined();
    expect(simpleFormModel({ kind: "call", fnId: "add", args: [lit(1), lit(2)] }, facts())).toBeUndefined();
    expect(simpleFormModel(construct("@ctor/Unknown", [["a", lit(1)]]), facts())).toBeUndefined();
    // A partial draft (a field removed in Advanced) is not a form.
    expect(simpleFormModel(construct("@ctor/Transaction", [["amount", lit(1)]]), facts())).toBeUndefined();
  });
});

describe("what each row is", () => {
  test("data fields get their own input; a field typed by saved records picks one", () => {
    const alex = { id: "alex", expr: construct("@ctor/Person", [["name", lit("Alex Martin")], ["phone", lit("+14155552671")]]) };
    const withSaved = simpleFormModel(seededTx, facts([alex]))!;
    expect(withSaved.rows.map((row) => row.kind)).toEqual(["value", "saved", "value"]);
    // Without any saved Person the person's own fields are entered.
    expect(simpleFormModel(seededTx, facts())!.rows.map((row) => row.kind)).toEqual(["value", "value", "value"]);
  });
  test("a picked reference stays a saved row; a computed field is shown, edited under Advanced", () => {
    const draft = construct("@ctor/Transaction", [["amount", { kind: "call", fnId: "add", args: [lit(1), lit(2)] }],
      ["person", { kind: "ref", savedExprId: "alex" }], ["date", lit({ year: 2026, month: 11, day: 3 })]]);
    expect(simpleFormModel(draft, facts())!.rows.map((row) => row.kind)).toEqual(["advanced", "saved", "value"]);
  });
  test("a row reads its data and writes back into the same constructor", () => {
    const model = simpleFormModel(seededTx, facts())!;
    expect(dataOfNode(model.rows[1]!.node)).toEqual({ name: "" });
    expect(dataOfNode({ kind: "param", name: "x" })).toBe(NOT_DATA);
    const next = replaceRow(model, 0, lit(40));
    expect(next).toEqual(construct("@ctor/Transaction", [["amount", lit(40)], ["person", seededPerson], ["date", lit(undefined)]]));
  });
});

describe("when a row speaks, and in which words", () => {
  const model = simpleFormModel(seededTx, facts([{ id: "alex", expr: seededPerson }]))!;
  const parts = (type: FenelType) => "$ref" in type && type.$ref === "CalendarDate" ? dateFields : undefined;
  test("nothing before the row was left or a Create was tried", () => {
    for (const row of model.rows) expect(rowIssue(row, row.field.name, "Person", false, parts)).toBeUndefined();
  });
  test("after leaving: plain words, never an engine diagnostic", () => {
    const [amount, person, date] = model.rows;
    expect(rowIssue(amount!, "amount", undefined, true, parts)).toBeUndefined();
    expect(rowIssue(person!, "person", "Person", true, parts)).toBe("Choose a Person.");
    expect(rowIssue(date!, "date", "Calendar date", true, parts)).toBe("Enter the date.");
    const halfDate = { ...date!, node: lit({ year: 2026, month: 11 }) };
    expect(rowIssue(halfDate, "date", "Calendar date", true, parts)).toBe("Enter the date.");
    const fullDate = { ...date!, node: lit({ year: 2026, month: 11, day: 3 }) };
    expect(rowIssue(fullDate, "date", "Calendar date", true, parts)).toBeUndefined();
    const picked = { ...person!, node: { kind: "ref", savedExprId: "alex" } as ExprNode };
    expect(rowIssue(picked, "person", "Person", true, parts)).toBeUndefined();
  });
});
