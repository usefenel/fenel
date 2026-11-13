import { describe, expect, test } from "bun:test";
import { fieldPicture, fieldPictureEntry, firstFieldText, iconMarkText, ownNumberText, ownPictureMark, pictureOf } from "./thumbnail-text";

describe("the text a thumbnail circle shows when no picture, icon or emoji was authored", () => {
  test("a bare finite number reads as itself; nothing else does", () => {
    expect([3, 1, 2].map(ownNumberText)).toEqual(["3", "1", "2"]);
    expect(ownNumberText(-0.5)).toBe("-0.5");
    for (const value of [Number.NaN, Number.POSITIVE_INFINITY, "3", true, null, undefined, [3], { amount: 3 }])
      expect(ownNumberText(value)).toBeUndefined();
  });

  test("a record reads as its first declared field when that is short plain data", () => {
    expect(firstFieldText({ $tag: "Transaction", amount: 12, person: { name: "Alex" } })).toBe("12");
    expect(firstFieldText({ capital: "Α", small: "α" })).toBe("Α");
    expect(firstFieldText({ name: "  " })).toBeUndefined();
    // Only the FIRST field is read: a later scalar never stands in for it.
    expect(firstFieldText({ person: { name: "Alex" }, amount: 12 })).toBeUndefined();
    for (const value of [12, "Alex", [{ amount: 12 }], null, undefined, {}]) expect(firstFieldText(value)).toBeUndefined();
  });

  test("a declared field order decides which field is first, whatever the value's own key order", () => {
    // Served data can arrive with its keys sorted: the type's order still wins.
    const sorted = { code: "FR", currency: "EUR", flag: "🇫🇷", name: "France" };
    expect(firstFieldText(sorted)).toBe("FR");
    expect(firstFieldText(sorted, ["flag", "name", "code", "currency"])).toBe("🇫🇷");
    expect(firstFieldText({ $tag: "Letter", b: "β", a: "Α" }, ["a", "b"])).toBe("Α");
    // An order naming none of the value's keys leaves the value's own order.
    expect(firstFieldText(sorted, ["missing"])).toBe("FR");
  });
});

describe("a record holding its own picture shows it as its mark", () => {
  const photo = { width: 2, height: 1, pixels: [{ r: 1, g: 2, b: 3, a: 255 }, { r: 4, g: 5, b: 6, a: 255 }] };
  test("the first declared Image field with a value, direct or Just; nothing for Nothing, an empty image or no image", () => {
    expect(fieldPicture({ name: "Rom", picture: { $tag: "Just", _0: photo } })).toBe(photo);
    expect(fieldPicture({ image: photo, name: "Plate" })).toBe(photo);
    expect(fieldPicture({ name: "Thomas", picture: { $tag: "Nothing" } })).toBeUndefined();
    expect(fieldPicture({ picture: { width: 0, height: 0, pixels: [] } })).toBeUndefined();
    expect(fieldPicture({ name: "Alpha", order: 1 })).toBeUndefined();
    for (const value of [photo, [photo], null, "x"]) expect(fieldPicture(value)).toBeUndefined();
  });

  test("the portrait field is the first one holding a picture, by key", () => {
    expect(fieldPictureEntry({ name: "Rom", picture: { $tag: "Just", _0: photo }, logo: photo })).toEqual({ key: "picture", picture: photo });
    expect(fieldPictureEntry({ b: photo, a: photo }, ["a", "b"])?.key).toBe("a");
    expect(fieldPictureEntry({ name: "Thomas", picture: { $tag: "Nothing" } })).toBeUndefined();
    expect(pictureOf({ $tag: "Just", _0: photo })).toBe(photo);
    expect(pictureOf({ $tag: "Nothing" })).toBeUndefined();
  });

  test("a record's own picture is its mark over any icon or emoji; only a source picture comes first", () => {
    // The People list: Person has an Iconable icon, which reached the
    // thumbnail as the value's icon and hid every photo behind it.
    const rom = { name: "Rom", picture: { $tag: "Just", _0: photo } };
    expect(ownPictureMark(rom, false)).toBe(photo);
    expect(ownPictureMark(rom, true)).toBeUndefined();
    expect(ownPictureMark({ name: "Thomas", picture: { $tag: "Nothing" } }, false)).toBeUndefined();
    expect(ownPictureMark({ $tag: "Butter" }, false)).toBeUndefined();
  });
});

describe("the text that replaces an icon mark", () => {
  const lisp = { name: "LISP", year: 1960 };
  const circle = { generic: false, valueIcon: true, tileFace: false };

  test("in a circle, an icon the type or the caller supplies stays; only a generic mark gives way to the first field", () => {
    expect(iconMarkText(lisp, circle)).toBeUndefined();
    expect(iconMarkText(lisp, { generic: false, valueIcon: false, tileFace: false })).toBeUndefined();
    expect(iconMarkText(lisp, { generic: true, valueIcon: false, tileFace: false })).toBe("LISP");
    expect(iconMarkText(lisp, { generic: true, valueIcon: true, tileFace: false })).toBeUndefined();
  });

  test("on a tile face the item's first field wins over an icon its whole type shares", () => {
    // The programming languages: nine tiles, one code mark, no name.
    expect(iconMarkText(lisp, { ...circle, tileFace: true })).toBe("LISP");
    expect(iconMarkText({ year: 1960, name: "LISP" }, { ...circle, tileFace: true }, ["name", "year"])).toBe("LISP");
    // A value with no field text keeps its icon.
    expect(iconMarkText({ $tag: "Butter" }, { ...circle, tileFace: true })).toBeUndefined();
  });

  test("a bare number reads as itself whatever the mark", () => {
    expect(iconMarkText(3, circle)).toBe("3");
    expect(iconMarkText(3, { ...circle, tileFace: true })).toBe("3");
  });
});
