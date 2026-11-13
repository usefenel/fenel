import { describe, expect, test } from "bun:test";
import { fieldConstructor, fieldHoldsNothing, recordHeadingField, recordPortraitField, recordRowPlan } from "./record-card-plan";

const photo = { width: 2, height: 1, pixels: [{ r: 1, g: 2, b: 3, a: 255 }, { r: 4, g: 5, b: 6, a: 255 }] };
// Rom's page (People and projects): Name, Picture, Biography, Birth Date, Social Links.
const rom = [
  { name: "name", value: "Rom" },
  { name: "picture", value: { $tag: "Just", _0: photo } },
  { name: "biography", value: { $tag: "Nothing" } },
  { name: "birthDate", value: { $tag: "Nothing" } },
  { name: "socialLinks", value: [] },
];

describe("a field with nothing to read", () => {
  test("absent, Nothing, an empty list or blank text; every other value holds something", () => {
    for (const value of [undefined, null, { $tag: "Nothing" }, [], "", "  "]) expect(fieldHoldsNothing(value)).toBe(true);
    for (const value of [0, false, "Rom", [1], { $tag: "Just", _0: 1 }, { $tag: "Nothing", note: 1 }, { $tag: "Butter" }, {}])
      expect(fieldHoldsNothing(value)).toBe(false);
  });
});

describe("a focused record's card head", () => {
  test("the portrait is the first field holding a drawable picture", () => {
    expect(recordPortraitField(rom)).toBe(1);
    expect(recordPortraitField([{ name: "picture", value: { $tag: "Nothing" } }, { name: "logo", value: photo }])).toBe(1);
    expect(recordPortraitField([{ name: "name", value: "Fenel" }, { name: "website", value: "https://usefenel.com" }])).toBeUndefined();
  });

  // A project's page (People and projects): its logo is a bare constructor of
  // Logo, `Just PrimalDiet`, whose picture is its own Picturable instance.
  const primalDiet = [
    { name: "name", value: "Primal Diet" },
    { name: "description", value: "A diet by Aajonus Vonderplanitz." },
    { name: "logo", value: { $tag: "Just", _0: { $tag: "PrimalDiet" } } },
    { name: "website", value: { $tag: "Nothing" } },
  ];
  const pictured = (value: unknown) => (value as { $tag?: string }).$tag === "PrimalDiet";

  test("a constructor with its own picture is a portrait candidate, after any real picture", () => {
    expect(recordPortraitField(primalDiet, pictured)).toBe(2);
    // Without a registered picture, or without the reader's answer, no portrait.
    expect(recordPortraitField(primalDiet, () => false)).toBeUndefined();
    expect(recordPortraitField(primalDiet)).toBeUndefined();
    // A real Image field still wins, wherever it stands.
    expect(recordPortraitField([...primalDiet, { name: "photo", value: photo }], pictured)).toBe(4);
    // People are unchanged; Fenel (no logo) has none.
    expect(recordPortraitField(rom, () => true)).toBe(1);
    expect(recordPortraitField([{ name: "name", value: "Fenel" }, { name: "logo", value: { $tag: "Nothing" } }], () => true)).toBeUndefined();
  });

  test("the constructor a field holds, directly or as Just", () => {
    expect(fieldConstructor({ $tag: "Just", _0: { $tag: "PrimalDiet" } })).toEqual({ $tag: "PrimalDiet" });
    expect(fieldConstructor({ $tag: "PrimalDiet" })).toEqual({ $tag: "PrimalDiet" });
    expect(fieldConstructor({ $tag: "Nothing" })).toBeUndefined();
    expect(fieldConstructor({ $tag: "Just", _0: "text" })).toBeUndefined();
    expect(fieldConstructor({ $tag: "Leaf", _0: 1 })).toBeUndefined();
    expect(fieldConstructor("PrimalDiet")).toBeUndefined();
  });

  test("the heading is the first field when it is named like a name and holds one short line", () => {
    expect(recordHeadingField(rom)).toBe(0);
    expect(recordHeadingField([{ name: "Full Name", value: "Sam Lee" }])).toBe(0);
    expect(recordHeadingField([{ name: "title", value: "Fenel" }])).toBe(0);
    // Not the first field, not name-like, blank, multi-line or too long: no heading.
    expect(recordHeadingField([{ name: "amount", value: 12 }, { name: "name", value: "Alex" }])).toBeUndefined();
    expect(recordHeadingField([{ name: "description", value: "A typespace" }])).toBeUndefined();
    expect(recordHeadingField([{ name: "name", value: " " }])).toBeUndefined();
    expect(recordHeadingField([{ name: "name", value: "a\nb" }])).toBeUndefined();
    expect(recordHeadingField([{ name: "name", value: "x".repeat(81) }])).toBeUndefined();
    expect(recordHeadingField([{ name: "name", value: 3 }])).toBeUndefined();
  });
});

describe("which rows a record shows by default", () => {
  const nothing = rom.map(field => fieldHoldsNothing(field.value));
  test("fields with nothing to read wait behind the more control; lifted fields are never rows", () => {
    expect(recordRowPlan({ holdsNothing: nothing, lifted: [0, 1], limit: 6, expanded: false })).toEqual({ shown: [], hidden: 3 });
    expect(recordRowPlan({ holdsNothing: nothing, limit: 6, expanded: false })).toEqual({ shown: [0, 1], hidden: 3 });
  });
  test("expanded, every row in declared order, still without the lifted ones", () => {
    expect(recordRowPlan({ holdsNothing: nothing, lifted: [0, 1], limit: 6, expanded: true })).toEqual({ shown: [2, 3, 4], hidden: 0 });
  });
  test("the row limit counts only fields that hold something", () => {
    const holdsNothing = [false, true, false, false, false, false, false, false, true];
    expect(recordRowPlan({ holdsNothing, limit: 6, expanded: false })).toEqual({ shown: [0, 2, 3, 4, 5, 6], hidden: 3 });
    expect(recordRowPlan({ holdsNothing: [false, false], limit: 6, expanded: false })).toEqual({ shown: [0, 1], hidden: 0 });
  });
});
