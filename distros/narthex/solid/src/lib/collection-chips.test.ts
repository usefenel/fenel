import { describe, expect, test } from "bun:test";
import { chipHref, chipName, chipSlice } from "./collection-chips";

// The shapes on Fenel's own record (showcase-data.fenel): social links, references to languages, an emblem.
const labels: Record<string, string> = { LeafThing: "A leaf" };
const read = {
  caption: (value: unknown) => (value as { id?: string } | undefined)?.id === "haskell-ref" ? "Haskell" : undefined,
  constructorName: (tag: string) => labels[tag] ?? tag,
};

describe("a list inside a record field: each item's mark and short name", () => {
  test("names: a reference by its caption, a record by its first field, a constructor field by its label", () => {
    expect(chipName({ id: "haskell-ref" }, read)).toBe("Haskell");
    expect(chipName({ $tag: "SocialLink", platform: { $tag: "X" }, url: "https://x.com/usefenel" }, read)).toBe("X");
    expect(chipName({ $tag: "Emblem", meaning: "Fire carried in a stalk", plant: { $ref: "p" } }, read)).toBe("Fire carried in a stalk");
    expect(chipName({ $tag: "LeafThing" }, read)).toBe("A leaf");
    expect(chipName("Fennel", read)).toBe("Fennel");
    expect(chipName(7, read)).toBe("7");
    // An address is the chip's link, not its name; a shape with nothing short has no name.
    expect(chipName("https://usefenel.com", read)).toBeUndefined();
    expect(chipName({ url: "https://x.com/usefenel" }, read)).toBeUndefined();
    expect(chipName({ picture: { width: 1 } }, read)).toBeUndefined();
    expect(chipName([1, 2], read)).toBeUndefined();
  });

  test("a name-like field first; never a long text: a record falls back to its own constructor's label", () => {
    // Fenel's page, Nov 12: the Emblems chip read "Carrier of the fire. In Greek myth Pro…" (the start of a
    // description). An emblem has no name-like field, so it reads as what it is.
    const emblem = { $tag: "Emblem", meaning: "Carrier of the fire. In Greek myth Prometheus hid the fire in a giant fennel stalk.",
      plant: { $ref: "giant-fennel" }, source: "https://en.wikipedia.org/wiki/Prometheus" };
    expect(chipName(emblem, read)).toBe("Emblem");
    expect(chipName(emblem, { ...read, constructorName: (tag: string) => tag === "Emblem" ? "Emblem of the project" : tag })).toBe("Emblem of the project");
    // The record heading's rule (record-card-plan.ts): a first field named like a name or title.
    expect(chipName({ $tag: "Mascot", name: "Fen", description: "Fenel's mascot (working name): a fictional character." }, read)).toBe("Fen");
    expect(chipName("A sentence far longer than forty characters, which is a description.", read)).toBeUndefined();
    expect(chipName({ $tag: "Note", text: "Another sentence that is far longer than forty characters." }, read)).toBe("Note");
  });

  test("links: an http(s) address, the value's own or its record's first", () => {
    expect(chipHref({ $tag: "SocialLink", platform: { $tag: "X" }, url: "https://x.com/usefenel" })).toBe("https://x.com/usefenel");
    expect(chipHref("https://usefenel.com")).toBe("https://usefenel.com");
    expect(chipHref({ url: "javascript:alert(1)" })).toBeUndefined();
    expect(chipHref({ url: "mailto:contact@usefenel.com" })).toBeUndefined();
    expect(chipHref({ name: "Fenel" })).toBeUndefined();
  });

  test("about twelve chips, then +N", () => {
    expect(chipSlice(4)).toEqual({ shown: 4, more: 0 });
    expect(chipSlice(12)).toEqual({ shown: 12, more: 0 });
    expect(chipSlice(63)).toEqual({ shown: 12, more: 51 });
    expect(chipSlice(0)).toEqual({ shown: 0, more: 0 });
  });
});
