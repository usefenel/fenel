import { describe, expect, test } from "bun:test";
import type { FenelType, FieldDef } from "@fenel/engine/types";
import { List, Maybe, Nothing } from "@fenel/engine/type-foundation";
import type { CatalogSection } from "@fenel/engine";
import { buildAuthoringCatalogSnapshot, createAuthoringEnvironment } from "@fenel/engine/authoring/environment";
import { declaredFieldOrder, groupingEntryKey, groupingTableColumns, groupingTableHeadings, locusTableColumns, projectedTableColumns } from "./locus-table-columns";
import { firstFieldText } from "./data-transfer/thumbnail-text";
import { tileCornerLabel } from "./list-tile-model";

const field = (name: string, type: FenelType): FieldDef => ({ name, label: Nothing, type, meta: {}, ui: Nothing });
const StringType: FenelType = { $ref: "String" };
const NumberType: FenelType = { $ref: "Number" };
const countryFields = [field("code", StringType), field("name", StringType), field("dialCode", StringType)];
const named: Record<string, FenelType> = {
  // `Country = Country code: String ...`: one constructor, a record with a name.
  Country: { $variant: { cases: [{ name: "Country", label: Nothing, fields: countryFields }] } },
  Point: { $record: { fields: [field("x", NumberType), field("y", NumberType)] } },
  Shape: { $variant: { cases: [
    { name: "Circle", label: Nothing, fields: [field("radius", NumberType)] },
    { name: "Square", label: Nothing, fields: [field("side", NumberType)] },
  ] } },
  Unit: { $variant: { cases: [{ name: "Unit", label: Nothing }] } },
  // A primitive: its values are the native representation, not this ADT.
  Rational: { $opaque: { name: "Rational", pure: { $variant: { cases: [
    { name: "Rational", label: Nothing, fields: [field("num", NumberType), field("den", NumberType)] },
  ] } } } } as FenelType,
};
const resolver = { resolveNamedType: (name: string) => named[name] };
const columns = (type: FenelType | undefined, label?: (f: FieldDef) => string) =>
  locusTableColumns(type, { resolver, label });
const ids = (type: FenelType | undefined) => {
  const result = columns(type);
  return result.kind === "fields" ? result.columns.map((column) => column.id) : result.kind;
};

describe("the table of a list takes its columns from the element type", () => {
  test("a record element gives one column per declared field, in order", () => {
    expect(ids({ $record: { fields: [field("title", StringType), field("count", NumberType)] } }))
      .toEqual(["title", "count"]);
  });

  test("a named record resolves through the authoring environment", () => {
    expect(ids({ $ref: "Point" })).toEqual(["x", "y"]);
  });

  test("a type with one constructor is read off that constructor", () => {
    expect(ids({ $ref: "Country" })).toEqual(["code", "name", "dialCode"]);
  });

  test("a refinement of a record keeps the record's columns", () => {
    expect(ids({ $refined: { base: { $ref: "Point" }, set: { $tag: "SeUniverse" } } } as unknown as FenelType))
      .toEqual(["x", "y"]);
  });

  test("the shape hook sees the element type first", () => {
    const seen: FenelType[] = [];
    const result = locusTableColumns({ $ref: "Alias" }, { resolver,
      shape: (type) => { seen.push(type); return named.Point!; } });
    expect(seen).toEqual([{ $ref: "Alias" }]);
    expect(result.kind === "fields" && result.columns.map((column) => column.id)).toEqual(["x", "y"]);
  });

  test("labels come from the label projection, ids stay the wire names", () => {
    const result = columns({ $ref: "Point" }, (f) => f.name.toUpperCase());
    expect(result.kind === "fields" && result.columns.map((column) => [column.id, column.label]))
      .toEqual([["x", "X"], ["y", "Y"]]);
    const plain = columns({ $ref: "Point" });
    expect(plain.kind === "fields" && plain.columns.map((column) => column.label)).toEqual(["x", "y"]);
  });

  test("anything else is one column showing the item through its own view", () => {
    expect(ids(undefined)).toBe("item");
    expect(ids(StringType)).toBe("item");
    expect(ids({ $ref: "Shape" })).toBe("item");
    expect(ids(Maybe({ $ref: "Point" }))).toBe("item");
    expect(ids(List({ $ref: "Point" }))).toBe("item");
    expect(ids({ $ref: "Unit" })).toBe("item");
    expect(ids({ $ref: "Rational" })).toBe("item");
    expect(ids({ $record: { fields: [] } })).toBe("item");
    expect(ids({ $ref: "Unknown" })).toBe("item");
  });
});

// Nov 12 (Countries tiles showed "AF" / "AFN"): the authoring catalogue's type
// rows are picker rows deduplicated by display label. Once the encyclopedia
// demo's instances were installed, `EncyclopediaCountry`'s label "Country"
// equalled std `Country`'s, its row was dropped, and the catalogue could no
// longer resolve the type: no Table columns, so no declared order for tiles.
describe("a declared type whose label another type shares", () => {
  const encyclopediaFields = ["flag", "name", "code", "currency", "language"].map(name => field(name, StringType));
  const EncyclopediaCountry: FenelType = { $variant: { cases: [{ name: "EncyclopediaCountry", label: Nothing, fields: encyclopediaFields }] } };
  const sections: CatalogSection[] = [{ id: "entity", label: "Types", description: "", entries: [
    { id: "entity:country", name: "Country", description: "", category: "entity", entity: { id: "country", type: named.Country! } },
    { id: "entity:EncyclopediaCountry", name: "Country", description: "", category: "entity", entity: { id: "EncyclopediaCountry", type: EncyclopediaCountry } },
  ] }];
  const environment = createAuthoringEnvironment(buildAuthoringCatalogSnapshot(sections));
  const declarations: Record<string, FenelType> = { country: named.Country!, EncyclopediaCountry };
  const declared = (name: string) => declarations[name];

  test("its list still has its declared field order, read from the reader's declaration", () => {
    expect(declaredFieldOrder({ $ref: "EncyclopediaCountry" }, environment, declared))
      .toEqual(["flag", "name", "code", "currency", "language"]);
    // The type that kept the catalogue row is unchanged.
    expect(declaredFieldOrder({ $ref: "country" }, environment, declared)).toEqual(["code", "name", "dialCode"]);
  });

  test("served records with sorted keys read as flag and name on a tile", () => {
    const order = declaredFieldOrder({ $ref: "EncyclopediaCountry" }, environment, declared);
    const afghanistan = { code: "AF", currency: "AFN", flag: "🇦🇫", language: "ps", name: "Afghanistan" };
    expect(firstFieldText(afghanistan, order)).toBe("🇦🇫");
    expect(tileCornerLabel(afghanistan, undefined, order)).toBe("Afghanistan");
  });

  test("an unknown name stays unknown: no columns are guessed", () => {
    expect(declaredFieldOrder({ $ref: "Nowhere" }, environment, declared)).toBeUndefined();
  });
});

describe("a grouping as a table (polish lane 2)", () => {
  test("the cells are the entry's value, typed by its declared value field", () => {
    const entry = { kind: "fields" as const, columns: [
      { id: "key", label: "key", field: field("key", { $ref: "Person" }) },
      { id: "value", label: "value", field: field("value", NumberType) }] };
    const columns = groupingTableColumns(entry);
    expect(columns.kind).toBe("fields");
    expect(columns.kind === "fields" && columns.columns.map(column => [column.id, column.label, column.field.type])).toEqual([["value", "Value", NumberType]]);
  });
  // groupedtable (Nov 13): the opened Group by person read "Key | Value".
  test("the headings name what the columns hold: the key's type and the value's type, as their captions read", () => {
    const entry = { kind: "fields" as const, columns: [
      { id: "key", label: "key", field: field("key", { $ref: "Person" }) },
      { id: "value", label: "value", field: field("value", List({ $ref: "Transaction" })) }] };
    const label = (type: FenelType) => "$ref" in type && type.$ref === "Person" ? "Person" : "List of transactions";
    expect(groupingTableHeadings(entry, label)).toEqual({ key: "Person", value: "List of transactions" });
    expect(groupingTableHeadings({ kind: "item" }, label)).toEqual({ key: "Key", value: "Value" });
    expect(groupingTableHeadings(entry, () => "Anything")).toEqual({ key: "Key", value: "Value" });
    expect(groupingTableHeadings(entry, () => "")).toEqual({ key: "Key", value: "Value" });
  });
  test("a row is headed by its entry's own key, not a numbered caption", () => {
    const rom = { name: "Rom", email: "rom@usefenel.com" };
    expect(groupingEntryKey({ key: rom, value: [1, 2] })).toEqual({ key: rom });
    expect(groupingEntryKey({ key: 0, value: [] })).toEqual({ key: 0 });
    expect(groupingEntryKey(undefined)).toBeUndefined();
    expect(groupingEntryKey([1, 2])).toBeUndefined();
  });
  test("an undecided entry type still gives the value column, never one Data column of pairs", () => {
    const columns = groupingTableColumns({ kind: "item" });
    expect(columns.kind === "fields" && columns.columns.map(column => column.id)).toEqual(["value"]);
  });
});


describe("table field identity projection", () => {
  test("reordering keeps the original column and wire key; stale identities select nothing", () => {
    const first = { id: "wireA", identity: "field-a", label: "First field", field: field("wireA", NumberType) };
    const second = { id: "wireB", identity: "field-b", label: "Second field", field: field("wireB", NumberType) };
    const projected = projectedTableColumns({ kind: "fields", columns: [first, second] }, ["field-b", "removed-field"]);
    expect(projected).toEqual({ kind: "fields", columns: [second] });
    expect(projected.kind === "fields" && projected.columns[0]).toBe(second);
  });
  test("an explicit empty projection hides every field; scalar tables retain their single data column", () => {
    expect(projectedTableColumns({ kind: "fields", columns: [] }, [])).toEqual({ kind: "fields", columns: [] });
    expect(projectedTableColumns({ kind: "item" }, ["field-a"])).toEqual({ kind: "item" });
  });
});
