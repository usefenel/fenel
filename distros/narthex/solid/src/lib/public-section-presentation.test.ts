import { describe, expect, test } from "bun:test";
import { firstSentence, publicSectionTarget } from "./public-section-presentation";

describe("public section presentation", () => {
  test("a description shows its first sentence; the rest stays in the data", () => {
    expect(firstSentence("Two pure recipe functions: a formula and another. The first three values give it foods."))
      .toBe("Two pure recipe functions: a formula and another.");
    expect(firstSentence("Earlier demos that have not been reworked yet. They may be rough."))
      .toBe("Earlier demos that have not been reworked yet.");
    expect(firstSentence("  One sentence only.  ")).toBe("One sentence only.");
    expect(firstSentence("No final period")).toBe("No final period");
    // A period inside a number or a name is not a sentence end.
    expect(firstSentence("Version 3.5 reads UTF-8.files well. Then more.")).toBe("Version 3.5 reads UTF-8.files well.");
    expect(firstSentence("")).toBe("");
  });

  test("a section's key is its address, distinct for every path and never a bare name", () => {
    expect(publicSectionTarget("demo", [])).toBe('section:["demo"]');
    expect(publicSectionTarget("demo", ["Unfinished demos", "Statistics"])).toBe('section:["demo","Unfinished demos","Statistics"]');
    expect(publicSectionTarget("demo", ["a/b"])).not.toBe(publicSectionTarget("demo", ["a", "b"]));
    expect(publicSectionTarget("demo", ["Statistics"])).not.toBe("Statistics");
  });
});
