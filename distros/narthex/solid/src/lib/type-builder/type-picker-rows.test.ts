import { expect, test } from "bun:test";
import { createRoot } from "solid-js";
import { createListboxKeys } from "../listbox-keys";
import { typePickerRows } from "./type-picker-rows";

type Row = { id: string; name: string };
const AUTO: Row = { id: "", name: "" };
const TYPES: Row[] = [{ id: "std:Email", name: "Email" }, { id: "std:EmailList", name: "EmailList" }];

test("the auto row leads only while the query is blank", () => {
  expect(typePickerRows(AUTO, TYPES, "")).toEqual([AUTO, ...TYPES]);
  expect(typePickerRows(AUTO, TYPES, "   ")).toEqual([AUTO, ...TYPES]);
  expect(typePickerRows(AUTO, TYPES, "ema")).toEqual(TYPES);
  expect(typePickerRows(AUTO, [], "zzz")).toEqual([]);
  expect(typePickerRows(undefined, TYPES, "")).toEqual(TYPES);
});

function enterWithoutHighlight(query: string, types: readonly Row[]): string[] {
  const picked: string[] = [];
  createRoot((dispose) => {
    const keys = createListboxKeys<Row>({
      rows: () => typePickerRows(AUTO, types, query),
      id: (row) => row === AUTO ? "auto" : `type:${row.id}`,
      domPrefix: "type-picker-test",
      pick: (row) => picked.push(row.name),
    });
    keys.keyDown({
      key: "Enter", isComposing: false, ctrlKey: false, metaKey: false,
      preventDefault: () => {},
    } as unknown as KeyboardEvent);
    dispose();
  });
  return picked;
}

test("with allowAuto, Enter after a query takes the first matching type, not auto", () => {
  expect(enterWithoutHighlight("ema", TYPES)).toEqual(["Email"]);
  expect(enterWithoutHighlight("", TYPES)).toEqual([""]);
  expect(enterWithoutHighlight("zzz", [])).toEqual([]);
});

import { listedTypeIdentities, preferredTypePickerEntries, splitPreferredTypes } from "./type-picker-rows";

type Entry = { id: string; name: string; entityId?: string };
const catalogue: Entry[] = Array.from({ length: 150 }, (_, i) => ({ id: `std:T${i}`, name: `T${i}` }));
const person: Entry = { id: "entity:5f0c", name: "Person", entityId: "5f0c" };
const naive = (entries: readonly Entry[], query: string, limit: number) =>
  entries.filter((e) => !query || e.name.toLowerCase().includes(query.toLowerCase())).slice(0, limit);

test("a preferred type beyond the catalogue cut leads the picker", () => {
  const all = [...catalogue, person];
  expect(naive(all, "", 100).includes(person)).toBe(false);
  const { rows, leadCount } = preferredTypePickerEntries(all, ["5f0c"], "", 100, naive);
  expect(rows[0]).toBe(person);
  expect(leadCount).toBe(1);
  expect(rows.length).toBe(100);
  expect(rows.filter((row) => row === person).length).toBe(1);
});

test("a search keeps preferred matches first and drops preferred rows that do not match", () => {
  const all = [...catalogue, person];
  expect(preferredTypePickerEntries(all, ["5f0c"], "pers", 100, naive).rows).toEqual([person]);
  expect(preferredTypePickerEntries(all, ["5f0c"], "T1", 100, naive).rows[0]?.name).toBe("T1");
});

test("preferred identities match entity id, catalogue id, or a unique name", () => {
  const twin = { id: "std:Person", name: "Person" };
  expect(splitPreferredTypes([person, twin], ["Person"]).lead).toEqual([]);
  expect(splitPreferredTypes([person], ["Person"]).lead).toEqual([person]);
  expect(splitPreferredTypes([person], ["entity:5f0c"]).lead).toEqual([person]);
  expect(splitPreferredTypes([person, twin], ["std:Person", "5f0c"]).lead).toEqual([twin, person]);
});

test("a list's types: a placed type reference and the named types inside value types", () => {
  expect(listedTypeIdentities([
    { source: { kind: "expr", expr: { kind: "literal", value: { $ref: "5f0c" } } }, valueType: { $type: true } },
    { valueType: { $record: { fields: [{ name: "person", type: { $ref: "5f0c" } }, { name: "when", type: { $ref: "CalendarDate" } }] } } },
    { valueType: { $list: { $ref: "Transaction" } } },
    { expr: { kind: "literal", value: 3 }, valueType: { $ref: "Number" } },
  ])).toEqual(["5f0c", "CalendarDate", "Transaction", "Number"]);
});

test("blank query: the list's own types, then the common types in the New menu's order, then the catalogue", () => {
  const alpha = (name: string): Entry => ({ id: `system:${name}`, name });
  const all = [alpha("AcceptedGiftTypes"), alpha("Account"), alpha("Number"), { id: "string", name: "String" }, alpha("Act"),
    { id: "entity:String", name: "String" }, person];
  const { rows, groupStarts } = preferredTypePickerEntries(all, ["5f0c"], "", 100, naive, ["String", "Number", "Tree"]);
  expect(rows.map((row) => row.id)).toEqual(["entity:5f0c", "string", "system:Number",
    "system:AcceptedGiftTypes", "system:Account", "system:Act", "entity:String"]);
  expect(groupStarts).toEqual([1, 3]);
  // No list types: the common types lead; a search ranks by match alone.
  expect(preferredTypePickerEntries(all, [], "", 3, naive, ["String", "Number"]).rows.map((row) => row.id))
    .toEqual(["string", "system:Number", "system:AcceptedGiftTypes"]);
  expect(preferredTypePickerEntries(all, [], "ac", 100, naive, ["Account"]).rows.map((row) => row.id))
    .toEqual(["system:AcceptedGiftTypes", "system:Account", "system:Act"]);
});

test("the everyday group holds only rows the small form can fill; a same-named fillable row wins", () => {
  const rows: Entry[] = [{ id: "entity:Address", name: "Address", entityId: "Address" }, { id: "entity:Email", name: "Email", entityId: "Email" },
    { id: "entity:EmailStr", name: "Email", entityId: "EmailStr" }, { id: "string", name: "String", entityId: "String" }, { id: "ctor:List", name: "List", entityId: "List" }];
  const fillable = new Set(["String", "EmailStr"]);
  const everyday = (row: Entry, name: string) => name === "List" || fillable.has(row.entityId ?? "");
  const { rows: shown, groupStarts } = preferredTypePickerEntries(rows, [], "", 100, naive, ["String", "Email", "EmailStr", "Address", "List"], everyday);
  expect(shown.map((row) => row.id)).toEqual(["string", "entity:EmailStr", "ctor:List", "entity:Address", "entity:Email"]);
  expect(groupStarts).toEqual([3]);
});
