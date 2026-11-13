import { describe, expect, test } from "bun:test";
import { locusPathAccessibleName, locusPathEntries, locusPathNameMinChars } from "./locus-path";

describe("locusPathEntries", () => {
  test("lists the All data overview first, the ancestors in order, then the current data marked current", () => {
    expect(locusPathEntries({ ancestors: ["root", "view", "item"], current: "field", allDataEntry: true })).toEqual([
      { kind: "all-data" },
      { kind: "scope", scope: "root", current: false },
      { kind: "scope", scope: "view", current: false },
      { kind: "scope", scope: "item", current: false },
      { kind: "scope", scope: "field", current: true },
    ]);
  });

  test("omits the overview when the lens does not offer it or already shows it", () => {
    expect(locusPathEntries({ ancestors: ["root"], current: "view", allDataEntry: false })).toEqual([
      { kind: "scope", scope: "root", current: false },
      { kind: "scope", scope: "view", current: true },
    ]);
  });

  test("the root alone is one current entry", () => {
    expect(locusPathEntries({ ancestors: [], current: "root", allDataEntry: false })).toEqual([
      { kind: "scope", scope: "root", current: true },
    ]);
  });
});

describe("locusPathAccessibleName", () => {
  test("reads the whole path with separators", () => {
    expect(locusPathAccessibleName(["All data", "Fenel", "Alphabets", "Katakana"])).toBe("Path: All data > Fenel > Alphabets > Katakana");
  });

  test("an unnamed step reads as Data, never as an empty step", () => {
    expect(locusPathAccessibleName(["All data", "  ", "Katakana"])).toBe("Path: All data > Data > Katakana");
  });
});

describe("locusPathNameMinChars", () => {
  test("a short name stays whole", () => {
    expect(locusPathNameMinChars("Kana")).toBe(4);
    expect(locusPathNameMinChars("Russian")).toBe(7);
  });

  test("a longer name keeps six characters plus its ellipsis", () => {
    expect(locusPathNameMinChars("Russian alphabet")).toBe(7);
    expect(locusPathNameMinChars("An intermediate field with a long descriptive name")).toBe(7);
  });

  test("counts code points and ignores surrounding space", () => {
    expect(locusPathNameMinChars("  カタカナ  ")).toBe(4);
    expect(locusPathNameMinChars("🍎🍐")).toBe(2);
  });
});
