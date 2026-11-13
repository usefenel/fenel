import { describe, expect, test } from "bun:test";
import { hasTileMark, listShowsTiles, tileCornerLabel, tileMarkScale } from "./list-tile-model";

const alpha = { capital: "Α", small: "α", name: "Alpha", greekName: "άλφα", order: 1, unicodeStem: "ALPHA" };
const beta = { capital: "Β", small: "β", name: "Beta", greekName: "βήτα", order: 2, unicodeStem: "BETA" };
const france = { flag: "🇫🇷", name: "France", code: "FR", currency: "EUR", language: "fr" };

describe("a focused list draws its items as tiles when each has a compact mark", () => {
  test("the mark is the thumbnail's own: a bare number, a picture, or a record's short first field", () => {
    expect(listShowsTiles([alpha, beta])).toBe(true);
    expect(listShowsTiles([3, 1, 2])).toBe(true);
    expect(listShowsTiles([france])).toBe(true);
    expect(listShowsTiles(["https://example.org/a.png", "data:image/png;base64,AAAA"])).toBe(true);
    expect(hasTileMark({ url: "data:image/png;base64,AAAA", name: "a.png", mimeType: "image/png", size: 4 })).toBe(true);
    expect(hasTileMark({ width: 1, height: 1, pixels: [{ r: 1, g: 2, b: 3, a: 255 }] })).toBe(true);
  });

  test("a list whose items have no compact mark keeps its cards", () => {
    expect(listShowsTiles([])).toBe(false);
    // Text items show their type's icon in a circle, not themselves.
    expect(listShowsTiles(["a", "b"])).toBe(false);
    // A long first field is a sentence, not a key's mark.
    expect(listShowsTiles([{ description: "A long sentence about a plant species", size: 3 }])).toBe(false);
    // One item without a mark keeps the whole list as cards.
    expect(listShowsTiles([alpha, { person: { name: "Alex" } }])).toBe(false);
    expect(hasTileMark({ url: "data:image/png;base64,", name: "e.png", mimeType: "image/png", size: 0 })).toBe(false);
    expect(hasTileMark({ width: 0, height: 0, pixels: [] })).toBe(false);
    for (const value of [null, undefined, true, [1], {}, Number.NaN]) expect(hasTileMark(value)).toBe(false);
  });

  test("the mark's size follows its length in characters as read", () => {
    expect(tileMarkScale(alpha)).toBe("large");
    expect(tileMarkScale(france)).toBe("large");
    expect(tileMarkScale(12)).toBe("large");
    expect(tileMarkScale(2026)).toBe("medium");
    expect(tileMarkScale({ name: "Athens", country: "GR" })).toBe("small");
    expect(tileMarkScale({ name: "Smalltalk", year: 1972 })).toBe("small");
    expect(tileMarkScale({ name: "TypeScript", year: 2012 })).toBe("tiny");
    expect(tileMarkScale("https://example.org/a.png")).toBe("large");
  });

  test("the corner holds the item's next piece of identity, never a placeholder or a repeat", () => {
    expect(tileCornerLabel(alpha)).toBe("α");
    expect(tileCornerLabel(france)).toBe("France");
    expect(tileCornerLabel({ amount: 12, note: "  " }, "Rent")).toBe("Rent");
    expect(tileCornerLabel(3)).toBeUndefined();
    expect(tileCornerLabel(3, "Three")).toBe("Three");
    expect(tileCornerLabel(3, "3")).toBeUndefined();
    expect(tileCornerLabel({ code: "A", same: "A" })).toBeUndefined();
    expect(tileCornerLabel({ code: "A", nested: { b: 1 } }, "  ")).toBeUndefined();
    expect(tileCornerLabel({ count: 4, total: 9 })).toBe("9");
  });

  test("the type's field order decides the mark and the corner when the data's keys arrive sorted", () => {
    const sortedLetter = { capital: "Α", capitalCode: "U+0391", greekName: "άλφα", name: "Alpha", order: 1, small: "α" };
    const letterOrder = ["capital", "small", "name", "greekName", "order", "capitalCode"];
    expect(tileCornerLabel(sortedLetter, undefined, letterOrder)).toBe("α");
    const sortedCountry = { code: "AF", currency: "AFN", flag: "🇦🇫", language: "ps", name: "Afghanistan" };
    const countryOrder = ["flag", "name", "code", "currency", "language"];
    expect(tileCornerLabel(sortedCountry, undefined, countryOrder)).toBe("Afghanistan");
    expect(tileMarkScale(sortedCountry, countryOrder)).toBe("large");
    const note = { body: "A sentence much longer than a key", code: "N1" };
    expect(listShowsTiles([note])).toBe(false);
    expect(listShowsTiles([note], ["code", "body"])).toBe(true);
  });
});

describe("a record holding its own picture is a tile with its picture and its name", () => {
  const photo = { width: 1, height: 1, pixels: [{ r: 1, g: 2, b: 3, a: 255 }] };
  const rom = { name: "Rom", picture: { $tag: "Just", _0: photo }, biography: { $tag: "Nothing" } };
  const thomas = { name: "Thomas", picture: { $tag: "Nothing" }, biography: { $tag: "Nothing" } };
  test("the picture is the large mark, the name goes to the corner; without a picture the name is the mark", () => {
    expect(listShowsTiles([rom, thomas])).toBe(true);
    expect([tileMarkScale(rom), tileCornerLabel(rom, "Rom item")]).toEqual(["large", "Rom"]);
    expect([tileMarkScale(thomas), tileCornerLabel(thomas, "Thomas")]).toEqual(["small", undefined]);
  });
});
