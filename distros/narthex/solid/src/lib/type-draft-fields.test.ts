import { expect, test } from "bun:test";
import type { FenelType, FieldDef } from "@fenel/engine/types";
import { typeCardSubmission } from "./type-draft-fields";

const field = (id: string, name: string, type: FenelType = { $ref: "String" }) =>
  ({ name, type, key: { $tag: "NamedField", ref: { $ref: id } } }) as unknown as FieldDef;
const record = (...fields: FieldDef[]): FenelType => ({ $record: { fields } });

test("a field the card added and nobody named is left out while its type is the default", () => {
  const minted = new Map([["a", "field1"], ["b", "field2"]]);
  const labels: Record<string, string> = { b: "Email" };
  const { shape, unnamed } = typeCardSubmission(record(field("a", "field1"), field("b", "email", { $ref: "Address" })), minted, (id) => labels[id]);
  expect(unnamed).toEqual([]);
  expect((shape as { $record: { fields: FieldDef[] } }).$record.fields.map((f) => f.name)).toEqual(["email"]);
});

test("a field with a chosen type but no name refuses Create; a typed or edited name is kept", () => {
  const minted = new Map([["a", "field1"], ["b", "field2"], ["c", "field3"]]);
  const labels: Record<string, string> = { b: "  " };
  const input = record(field("a", "field1", { $ref: "Address" }), field("b", "field2", { $ref: "Number" }), field("c", "code"), field("d", "field4"));
  const { shape, unnamed } = typeCardSubmission(input, minted, (id) => labels[id]);
  expect(unnamed).toEqual(["a", "b"]);
  expect(shape).toBe(input);
});
