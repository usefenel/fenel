import { beforeAll, describe, expect, test } from "bun:test";
import { loadSsrFixture, markupText } from "../ssr-render-fixture";

// The read frame of a function (Rom, Nov 12): Parameters and Returns are
// stated once, as TypeContract rows at the top; the graph is separate, with
// one name-only node per use of a parameter; its last arrow ends in a Result
// card. No old indigo badge, no "↓ Number" line, no "Function" caption, and a
// type the engine did not settle shows nothing (never "Anything").
let rendered: Record<string, string>;
let constructorGlyph: unknown;
beforeAll(async () => {
  const fixture = await loadSsrFixture<{ cases(): Record<string, string>; constructorGlyph(): unknown }>(
    new URL("./function-read.ssr-fixture.tsx", import.meta.url), "function-read");
  rendered = fixture.cases();
  constructorGlyph = fixture.constructorGlyph();
}, 240_000);

const signatures = (html: string) => [...html.matchAll(/<div class="type-contract type-contract--signature[^"]*"[\s\S]*?<\/div><\/div>/g)]
  .map(match => [...match[0].matchAll(/<div class="type-contract__slot type-contract__slot--[^"]*"[^>]*>([\s\S]*?)<\/div>/g)]
    .map(row => markupText(row[1]!)));
const resultCards = (html: string) => [...html.matchAll(/<div class="data-card function-result-card"[^>]*>([\s\S]*?)<\/div>/g)]
  .map(match => markupText(match[1]!));
const nameNodes = (html: string) => [...html.matchAll(/<span class="expr-function-input[^"]*"[^>]*>([\s\S]*?)<\/span><\/span>/g)]
  .map(match => markupText(match[1]!));

describe("a function's read frame", () => {
  test("Square formula: the signature once at the top, name-only inputs, one Result card", () => {
    const html = rendered.square!;
    expect(signatures(html)).toEqual([["Parameters x Number", "Returns Number"]]);
    expect(nameNodes(html)).toEqual(["x", "x"]);
    expect(resultCards(html)).toEqual(["Result Number"]);
    // The signature (2) and the Result card (1) are the only places the type is said.
    expect(markupText(html).match(/\bNumber\b/g)?.length).toBe(3);
  });

  test("the retired duplicates are gone", () => {
    for (const name of ["square", "recipe", "identity", "unsettled"]) {
      const html = rendered[name]!;
      expect(html).not.toContain("fr-type-badge");
      expect(html).not.toContain("expr-function-result");
      expect(html).not.toContain("↓");
      expect(html).not.toContain("expr-scope__caption");
      expect(html).not.toContain("expr-function-inputs");
    }
  });

  test("an inferred signature says so quietly, on each inferred slot and on the Result card", () => {
    expect(signatures(rendered.squareInferred!)).toEqual([["Parameters x Number inferred", "Returns Number inferred"]]);
    expect(resultCards(rendered.squareInferred!)).toEqual(["Result Number inferred"]);
  });

  test("an unknown origin reads plainly", () => {
    expect(signatures(rendered.squareUnknownOrigin!)).toEqual([["Parameters x Number", "Returns Number"]]);
  });

  test("an unsettled type shows nothing, never Anything", () => {
    const html = rendered.unsettled!;
    expect(signatures(html)).toEqual([["Parameters x"]]);
    expect(resultCards(html)).toEqual(["Result"]);
    expect(markupText(html)).not.toContain("Anything");
  });

  test("a body that is not a graph still ends in the Result card", () => {
    expect(resultCards(rendered.identity!)).toEqual(["Result Number"]);
  });

  test("recipe formula: local names read as rows, the nested function has its own signature and Result card", () => {
    const html = rendered.recipe!;
    expect(signatures(html)).toEqual([["Parameters foods List of foods", "Returns List of preparations"], ["Parameters food"]]);
    // The nested function's result (unsettled: no type) and the If's shared result.
    expect(resultCards(html).sort()).toEqual(["Result", "Result List of preparations"]);
    const text = markupText(html);
    expect(text).toContain("has");
    expect(text).toContain("essentials");
    expect(text).not.toContain("Anything");
  });

  // Rom (Nov 13): the Sports formula's [tomato, watermelon, cucumber] showed
  // emoji where every data card shows the foods' pictures. A constructor item
  // in a graph list carries the reader's own picture for it, beside its emoji.
  test("a nullary constructor in a graph list carries the reader's picture, not only its emoji", () => {
    expect(constructorGlyph).toEqual({ name: "Tomato", emoji: "\u{1F345}",
      picture: { $tag: "GlyphPictureReference", handle: "tomato-picture" } });
  });
});
