import { describe, expect, test } from "bun:test";
import { previewGlyphKeys, thumbnailMark } from "./thumbnail-glyph";
import { previewGlyph } from "./list-preview-glyph";

const known = { star: true, utensils: true };

describe("preview glyph keys", () => {
  test("a constructor comes before its owning type", () => {
    expect(previewGlyphKeys({ $tag: "Tomato" }, "Food")).toEqual(["Tomato", "Food"]);
  });

  test("a catalog reference is asked before the owning type", () => {
    expect(previewGlyphKeys({ $ref: "RecipeFunctions.lubeFormula" }, "Recipe")).toEqual([
      "RecipeFunctions.lubeFormula", "Recipe",
    ]);
  });

  test("a list has no constructor tag", () => {
    expect(previewGlyphKeys([{ $tag: "Honey" }, { $tag: "Egg" }], "List")).toEqual(["List"]);
  });

  test("duplicate identities are asked once", () => {
    expect(previewGlyphKeys({ $tag: "Tomato" }, "Food", ["Food", "Tomato"])).toEqual(["Tomato", "Food"]);
  });

  test("a getter is not a stored constructor tag", () => {
    let reads = 0;
    const hostile = {};
    Object.defineProperty(hostile, "$tag", { enumerable: true, get() { reads += 1; return "Tomato"; } });
    expect(previewGlyphKeys(hostile, "Food")).toEqual(["Food"]);
    expect(reads).toBe(0);
  });
});

describe("preview glyph selection", () => {
  const rows = new Map<string, { icon?: string; emoji?: string }>([
    ["Tomato", { emoji: " 🍅 " }],
    ["Food", { icon: "utensils", emoji: "🍽️" }],
    ["Honey", { icon: "star", emoji: "🍯" }],
    ["Plain", { icon: "missing", emoji: "   " }],
  ]);
  const resolve = (className: "Picturable" | "Iconable" | "Emojiable", key: unknown) => {
    const row = typeof key === "string" ? rows.get(key) : undefined;
    if (!row) return undefined;
    return className === "Iconable" ? { icon: row.icon } : className === "Emojiable" ? { emoji: row.emoji } : undefined;
  };

  test("the constructor glyph is used before the owning type icon", () => {
    expect(previewGlyph(["Tomato", "Food"], resolve, known)).toEqual({ emoji: "🍅" });
  });

  test("a registered constructor icon wins over that constructor's emoji", () => {
    expect(previewGlyph(["Honey", "Food"], resolve, known)).toEqual({ icon: "star" });
  });

  test("an unknown icon name does not hide a later glyph", () => {
    expect(previewGlyph(["Plain", "Food"], resolve, known)).toEqual({ icon: "utensils" });
  });

  test("a selected picture retains its own icon and emoji as media fallbacks", () => {
    const glyph = previewGlyph(["Honey", "Food"], (className, key) =>
      className === "Picturable" && key === "Honey" ? { picture: { $ref: "honey-picture" } } : resolve(className, key), known);
    expect(glyph).toEqual({ picture: { $tag: "GlyphPictureReference", handle: "honey-picture" }, icon: "star", emoji: "🍯" });
  });

  test("a constructor emoji keeps precedence over a broader type picture", () => {
    expect(previewGlyph(["Tomato", "Food"], (className, key) =>
      className === "Picturable" && key === "Food" ? { picture: { $ref: "food-picture" } } : resolve(className, key), known))
      .toEqual({ emoji: "🍅" });
  });

  test("oversized or malformed inline pictures leave the selected emoji intact", () => {
    for (const picture of [{ width: 129, height: 129, pixels: [] }, { $ref: "picture", extra: true }, { $pin: "function", id: "picture" }]) {
      expect(previewGlyph(["Tomato"], (className, key) => className === "Picturable" ? { picture } : resolve(className, key), known))
        .toEqual({ emoji: "🍅" });
    }
  });
});

describe("thumbnail mark", () => {
  test("a registered icon wins over emoji", () => {
    expect(thumbnailMark("star", "🍅", "box", known, "package")).toEqual({ kind: "icon", name: "star" });
  });

  test("emoji wins over the type-icon fallback", () => {
    expect(thumbnailMark(undefined, " 🍋 ", "box", known, "package")).toEqual({ kind: "emoji", text: "🍋" });
  });

  test("blank emoji keeps the type icon, then the generic mark", () => {
    expect(thumbnailMark("missing", " ", "utensils", known, "package")).toEqual({ kind: "icon", name: "utensils" });
    expect(thumbnailMark(undefined, undefined, undefined, known, "package")).toEqual({ kind: "icon", name: "package" });
  });
});
