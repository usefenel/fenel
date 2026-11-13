import { describe, expect, test } from "bun:test";
import { asDisplayName, codeName, displayNameItemFields, displayNameText, displayNameTooltipCode, humanName, pickDisplayName, splitCodeText } from "./display-name";

describe("display names", () => {
  test("a label wins; a code name without a label is marked as code", () => {
    expect(pickDisplayName("Reversed words", "reversedWords")).toEqual(humanName("Reversed words"));
    expect(pickDisplayName(undefined, "reversedWords")).toEqual(codeName("reversedWords"));
    expect(pickDisplayName("  ", "reversedWords")).toEqual(codeName("reversedWords"));
    // A projection that already fell back to the code name stays code.
    expect(pickDisplayName("reversedWords", "reversedWords")).toEqual(codeName("reversedWords"));
    expect(pickDisplayName(undefined, undefined)).toBeUndefined();
  });

  test("plain strings stay human text", () => {
    expect(asDisplayName("Input 2")).toEqual(humanName("Input 2"));
    expect(displayNameText(codeName("s"))).toBe("s");
    expect(displayNameTooltipCode("Text")).toBeUndefined();
    expect(displayNameTooltipCode(codeName("s"))).toBe("s");
  });

  test("tooltip and menu text split around the code part", () => {
    expect(splitCodeText("s: missing data", "s")).toEqual(["", "s", ": missing data"]);
    expect(splitCodeText("Open arr and trailing parameters", "arr")).toEqual(["Open ", "arr", " and trailing parameters"]);
    expect(splitCodeText("Text: missing data", undefined)).toBeUndefined();
    expect(splitCodeText("Text", "s")).toBeUndefined();
  });

  test("layout items keep human captions and carry a code name as Codeable", () => {
    expect(displayNameItemFields("Reversed words")).toEqual({ caption: "Reversed words" });
    expect(displayNameItemFields(codeName("x"))).toEqual({ representations: { Codeable: { codeName: "x" } } });
    expect(displayNameItemFields(undefined)).toEqual({});
  });
});
