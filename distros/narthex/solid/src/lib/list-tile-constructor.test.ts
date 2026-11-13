import { describe, expect, test } from "bun:test";
import fixture from "./nested-sets-classification.fixture.json";
import { hasTileMark, listShowsTiles, tileCornerLabel, tileMarkScale } from "./list-tile-model";

// The tree of life's 63 leaves (a real `List LivingThing`): bare constructors
// whose pictures are their own Picturable instances, keyed by the tag. The
// glyph is the one the reader already selected for each item (its packet).
const leaves = fixture.leaves as unknown[];
const picture = { $tag: "GlyphPictureReference", handle: "tomatoDrawing" } as const;

describe("a bare constructor with a registered picture or emoji is a tile's face", () => {
  test("the item's own selected glyph makes the mark; without one nothing changes", () => {
    expect(hasTileMark({ $tag: "SolanumLycopersicum" })).toBe(false);
    expect(hasTileMark({ $tag: "SolanumLycopersicum" }, undefined, {})).toBe(false);
    expect(hasTileMark({ $tag: "SolanumLycopersicum" }, undefined, { picture })).toBe(true);
    expect(hasTileMark({ $tag: "Mammalia" }, undefined, { emoji: "🐾" })).toBe(true);
    expect(hasTileMark({ $tag: "Mammalia" }, undefined, { emoji: "  " })).toBe(false);
    // An icon is a type's mark, not the item's picture; a payload is not a bare constructor.
    expect(hasTileMark({ $tag: "Mammalia" }, undefined, { icon: "leaf" })).toBe(false);
    expect(hasTileMark({ $tag: "Leaf", _0: { size: 1 } }, undefined, { emoji: "🐾" })).toBe(false);
  });

  test("the leaves draw as tiles only when every one has its mark", () => {
    expect(listShowsTiles(leaves)).toBe(false);
    expect(listShowsTiles(leaves, undefined, () => ({ picture }))).toBe(true);
    expect(listShowsTiles(leaves, undefined, (index) => index === 5 ? {} : { picture })).toBe(false);
  });

  test("the picture fills the face and the item's name sits in the corner", () => {
    expect(tileMarkScale({ $tag: "SolanumLycopersicum" })).toBe("large");
    expect(tileCornerLabel({ $tag: "SolanumLycopersicum" }, "Solanum lycopersicum")).toBe("Solanum lycopersicum");
  });
});
