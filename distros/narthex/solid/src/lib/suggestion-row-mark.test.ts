import { expect, test } from "bun:test";
import { suggestionRowMark } from "./suggestion-row-mark";

import fallbacks from "./type-icon-fallbacks.json";
const neutral = (fallbacks as Record<string, string>).Type;
const known = { hash: true, list: true, "help-circle": true, [neutral]: true, image: true, layers: true, function: true };

test("a suggestion row leads with its result type's icon, the one a value of that type shows (owner review, Nov 11)", () => {
  expect(suggestionRowMark({ $ref: "Number" }, { label: "Number", icon: "hash" }, known))
    .toEqual({ icon: "hash", typeLabel: "Number" });
  expect(suggestionRowMark({ $ref: "List" }, { label: "List of transactions", icon: "list" }, known))
    .toEqual({ icon: "list", typeLabel: "List of transactions" });
  // "Group by date" returns an optional map: its mark is that type's icon, never the function's own @icon.
  expect(suggestionRowMark({ $ref: "Maybe" }, { label: "Optional map of dates and lists of transactions", icon: "help-circle" }, known).icon)
    .toBe("help-circle");
});

test("no function glyph, ever: an unknown result type has no icon and no type chip", () => {
  expect(suggestionRowMark(undefined, undefined, known)).toEqual({ icon: undefined, typeLabel: undefined });
  // A presentation without a type (stale) is not shown either.
  expect(suggestionRowMark(undefined, { label: "Number", icon: "hash" }, known)).toEqual({ icon: undefined, typeLabel: undefined });
});

test("a known type whose presentation is still pending shows the neutral type glyph, not a function glyph", () => {
  const pending = suggestionRowMark({ $ref: "Shape" }, undefined, known);
  expect(pending.icon).toBe(neutral);
  expect(pending.typeLabel).toBeUndefined();
});

test("an icon name outside the app's icon roster falls back to the neutral type glyph", () => {
  expect(suggestionRowMark({ $ref: "Shape" }, { label: "Shape", icon: "not-an-icon" }, known))
    .toEqual({ icon: neutral, typeLabel: "Shape" });
});

test("the row source no longer leads with the function's icon or a function glyph", async () => {
  const source = await Bun.file(new URL("./related-data-panels.tsx", import.meta.url)).text();
  expect(source).not.toContain(`candidate()?.icon || "function"`);
  expect(source).toContain("suggestionRowMark(");
});
