import { describe, expect, test } from "bun:test";
import { enumOptionLabel, type DefaultRegistry } from "./field-meta";
import { dispatchEngineBody, withInterpretedResolver } from "./engine-bodies-dispatch";
import { GLOBAL_ONLY } from "./dispatch-registry";
import { humanizeCodeName } from "./fenel-module";

describe("canonical finite-choice labels", () => {
  test.each(["a", "A", "α", "Α", "σ", "ς", "ß", "𐐨", "𐐀", "😀"])(
    "literal codepoint %s retains its exact case through the Fenel body and host projection",
    value => withInterpretedResolver(() => {
      expect(dispatchEngineBody("engine:enumOptionLabelFallback", [value])).toBe(value);
      expect(enumOptionLabel("", value)).toBe(value);
    }),
  );

  test.each([
    ["", ""], ["pending", "Pending"], ["firstName", "First Name"],
    ["snake_case", "Snake Case"], ["kebab-case", "Kebab Case"],
    ["URLPath", "URL Path"], ["all_lower", "All Lower"],
    ["two words", "Two Words"], ["Σίγμα", "Σίγμα"],
  ])("word choice %s keeps its existing label %s", (value, expected) => withInterpretedResolver(() => {
    expect(enumOptionLabel("Status", value)).toBe(expected);
    expect(enumOptionLabel("Status", value)).toBe(humanizeCodeName(value));
  }));

  test.each(["Lowercase alpha", "", "Σ (authored)"])(
    "explicit Labelable %s remains authoritative, including an empty label",
    label => {
      const registry: DefaultRegistry = { resolve(type, typeName, visibility) {
        expect([type, typeName, visibility]).toEqual(["Greek.α", "Labelable", GLOBAL_ONLY]);
        return { label };
      } };
      expect(enumOptionLabel("Greek", "α", registry)).toBe(label);
    },
  );

  test.each([undefined, null, 4, false, {}, { en: "Alpha" }, ["Alpha"]].map(label => [label]))(
    "nonstring legacy Labelable %j is ignored without changing literal or word data",
    label => withInterpretedResolver(() => {
      const registry: DefaultRegistry = { resolve: () => ({ label }) };
      expect(enumOptionLabel("Greek", "α", registry)).toBe("α");
      expect(enumOptionLabel("Greek", "ς", registry)).toBe("ς");
      expect(enumOptionLabel("Status", "in_progress", registry)).toBe("In Progress");
    }),
  );

  test("unrelated code-name labels retain their existing capitalization", () => {
    expect(humanizeCodeName("α")).toBe("Α");
    expect(humanizeCodeName("a")).toBe("A");
  });

  test.each([undefined, null, false, 0].map(value => [value]))(
    "legacy falsy nonstring input %j retains its wire result",
    value => {
      expect(enumOptionLabel("", value as unknown as string)).toBe(humanizeCodeName(value as unknown as string));
    },
  );

  test.each([4, true, {}, ["a"]].map(value => [value]))(
    "truthy nonstring input %j remains refused at the String boundary",
    value => {
      expect(() => humanizeCodeName(value as unknown as string)).toThrow(TypeError);
      expect(() => enumOptionLabel("", value as unknown as string)).toThrow(TypeError);
    },
  );
});
