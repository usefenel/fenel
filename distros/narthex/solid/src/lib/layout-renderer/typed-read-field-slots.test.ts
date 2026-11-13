// @ts-nocheck -- Bun's test globals are outside the Solid ambient tsconfig.
import { describe, expect, test } from "bun:test";
import { fieldSlotName, recordChildNameFields } from "./typed-read-field-slots";

const ID = "11111111-1111-4111-8111-111111111111";
const field = (name) => ({ name, label: { $tag: "Nothing" }, type: { $ref: "Number" }, key: { $tag: "NamedField", ref: { $ref: ID } } });
const registry = (reps) => ({ getFieldRepresentation: (className, id) => id === ID && reps[className] ? { methods: reps[className] } : undefined });

describe("record row names", () => {
  test("a field labelled \"amount\" (code name amount) reads as a label, not as code", () => {
    expect(fieldSlotName(field("amount"), registry({ Labelable: { label: "amount" }, Codeable: { codeName: "amount" } })))
      .toEqual({ text: "amount", code: false });
  });
  test("a Labelable label different from the code name reads as a label", () => {
    expect(fieldSlotName(field("amountPaid"), registry({ Labelable: { label: "Amount paid" } }))).toEqual({ text: "Amount paid", code: false });
  });
  test("without a label the code name reads as code", () => {
    expect(fieldSlotName(field("amount"), registry({}))).toEqual({ text: "amount", code: true });
  });
});

describe("a focused record's field cards use the inline rows' field slot names", () => {
  const slots = [
    { wire: "scientificName", name: { text: "Scientific Name", code: false } },
    { wire: "lifeForm", name: { text: "Life Form", code: false } },
    { wire: "note", name: { text: "note", code: true } },
  ];
  test("an authored field label heads the card as human text, not the stored key", () => {
    expect(recordChildNameFields(slots, "scientificName", "scientificName")).toEqual({ caption: "Scientific Name" });
    expect(recordChildNameFields(slots, "lifeForm", "lifeForm")).toEqual({ caption: "Life Form" });
  });
  test("a declared field without a label keeps its code name as the Codeable occurrence (code face)", () => {
    expect(recordChildNameFields(slots, "note", "note")).toEqual({ representations: { Codeable: { codeName: "note" } } });
  });
  test("a saved value's authored name still wins over the field label", () => {
    expect(recordChildNameFields(slots, "scientificName", "scientificName", "My name")).toEqual({ caption: "My name" });
  });
  test("list items, undeclared keys and reads without slots keep their existing caption", () => {
    expect(recordChildNameFields(slots, 0, "Item 1")).toEqual({ caption: "Item 1" });
    expect(recordChildNameFields(slots, "extra", "extra")).toEqual({ caption: "extra" });
    expect(recordChildNameFields(undefined, "scientificName", "scientificName")).toEqual({ caption: "scientificName" });
  });
});
