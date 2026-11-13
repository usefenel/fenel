import { describe, expect, test } from "bun:test";
import type { FenelType, FieldDef } from "@fenel/engine/types";
import { openParameterFields, parameterLabel, suggestionInputField, suggestionInputsLayout, type SuggestionParameter } from "./suggestion-inputs";

const number: FenelType = { $ref: "Number" };
const image: FenelType = { $ref: "Image" };
const declared = (name: string, type: FenelType, label?: string): FieldDef => ({ name, type,
  label: label ? { $tag: "Just", _0: label } : { $tag: "Nothing" }, meta: {}, ui: { $tag: "Nothing" } } as unknown as FieldDef);

describe("a suggestion row's remaining inputs (Box blur on an image)", () => {
  const boxBlur: SuggestionParameter[] = [{ name: "img", subject: true }, { name: "radius", subject: false, open: 0 }];

  // Rom, Nov 12: the data the suggestion applies to is not an input at all;
  // only the other inputs are fields of the form.
  test("the input bound to the data is not shown; every other input is a field", () => {
    expect(suggestionInputsLayout(boxBlur, 1)).toEqual({ fields: [{ name: "radius", open: 0 }] });
  });

  test("a row whose function needs nothing more shows no inputs at all", () => {
    expect(suggestionInputsLayout([], 0)).toEqual({ fields: [] });
    expect(suggestionInputsLayout([{ name: "img", subject: true }], 0)).toEqual({ fields: [] });
  });

  test("the fields keep declaration order around the data's own position", () => {
    const clamp: SuggestionParameter[] = [{ name: "low", subject: false, open: 0 }, { name: "x", subject: true },
      { name: "high", subject: false, open: 1 }];
    expect(suggestionInputsLayout(clamp, 2)).toEqual({ fields: [{ name: "low", open: 0 }, { name: "high", open: 1 }] });
  });

  test("a plan that does not say where the data goes shows only its fields", () => {
    const open: SuggestionParameter[] = [{ name: "input 1", subject: false, open: 0 }];
    expect(suggestionInputsLayout(open, 1)).toEqual({ fields: [{ name: "input 1", open: 0 }] });
  });
});

describe("an input's label is a person's word, never its code name (Rom, Nov 12)", () => {
  test("an authored label wins", () => {
    expect(parameterLabel({ name: "radius", field: declared("radius", number, "Blur radius") })).toBe("Blur radius");
  });

  test("without one, the code name reads as words, as the engine's default label does", () => {
    expect(parameterLabel({ name: "radius" })).toBe("Radius");
    expect(parameterLabel({ name: "pixelSize" })).toBe("Pixel Size");
    expect(parameterLabel({ name: "max_width" })).toBe("Max Width");
    expect(parameterLabel({ name: "URL" })).toBe("URL");
    expect(parameterLabel({ name: "input 1" })).toBe("Input 1");
  });

  test("the field an input is edited as carries that label", () => {
    expect(suggestionInputField({ name: "radius", type: number })?.label).toEqual({ $tag: "Just", _0: "Radius" });
  });
});

describe("each field is the function's declared input, with the type its editor calls for", () => {
  test("declared inputs line up with the open slots, skipping the data's own", () => {
    const params = [declared("img", image), declared("radius", number, "Radius")];
    expect(openParameterFields(["img", "radius"], 0, params)).toEqual([params[1]]);
  });

  test("declarations that do not match the operation's inputs are not used", () => {
    expect(openParameterFields(["img", "radius"], 0, [declared("other", number)])).toEqual([undefined]);
    expect(openParameterFields(["img", "radius"], 0, undefined)).toEqual([undefined]);
    expect(openParameterFields(["img", "size"], 0, [declared("img", image), declared("radius", number)])).toEqual([undefined]);
  });

  test("a declared input keeps its authored label and takes the inline editor's type", () => {
    const radius = declared("radius", { $ref: "a" }, "Radius");
    const field = suggestionInputField({ name: "radius", type: number, field: radius });
    expect(field?.type).toEqual(number);
    expect(field?.label).toEqual(radius.label);
    expect(field?.name).toBe("radius");
  });

  test("an input without a declaration is named by its name; one without an inline editor is no field", () => {
    const field = suggestionInputField({ name: "input 1", type: number });
    expect(field).toEqual({ name: "input 1", type: number, label: { $tag: "Just", _0: "Input 1" }, meta: {}, ui: { $tag: "Nothing" } } as unknown as FieldDef);
    expect(suggestionInputField({ name: "callback" })).toBeUndefined();
  });
});
