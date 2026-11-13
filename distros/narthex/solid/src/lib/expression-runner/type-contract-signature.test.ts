import { beforeAll, describe, expect, test } from "bun:test";
import { loadSsrFixture, markupText } from "../ssr-render-fixture";

// TypeContract's signature rows (Rom, Nov 12): a function states its
// parameters and its return type once, as record-style rows, in the card's
// type face. A written type is plain, an inferred one carries a quiet
// "inferred", and a type the engine did not settle shows nothing.
let rendered: Record<string, string>;
beforeAll(async () => {
  rendered = (await loadSsrFixture<{ cases(): Record<string, string> }>(
    new URL("./type-contract.ssr-fixture.tsx", import.meta.url), "type-contract")).cases();
}, 120_000);

const rows = (html: string) => [...html.matchAll(/<div class="type-contract__slot type-contract__slot--[^"]*"[^>]*>([\s\S]*?)<\/div>/g)]
  .map(match => markupText(match[1]!));
/** Each signature badge, from its opening tag to its balanced closing tag. */
const badges = (html: string) => [...html.matchAll(/<span class="type-contract__badge expr-function-input"[^>]*>/g)].map(match => {
  let depth = 1;
  const tags = /<(\/?)span\b[^>]*>/g;
  tags.lastIndex = match.index! + match[0].length;
  for (let tag = tags.exec(html); tag; tag = tags.exec(html)) {
    depth += tag[1] ? -1 : 1;
    if (depth === 0) return markupText(html.slice(match.index! + match[0].length, tag.index));
  }
  return "";
});

describe("TypeContract signature rows", () => {
  test("a written signature reads Parameters then Returns, each type once, with no inferred mark", () => {
    const html = rendered.declared!;
    expect(html).toContain("type-contract--signature");
    expect(rows(html)).toEqual(["Parameters x Number", "Returns Number"]);
    expect(markupText(html)).not.toContain("inferred");
  });

  test("an inferred type carries a quiet inferred mark", () => {
    expect(rows(rendered.inferred!)).toEqual(["Parameters food Food inferred", "Returns Boolean inferred"]);
  });

  test("a type the engine did not settle shows nothing, and no Returns row", () => {
    const text = markupText(rendered.unsettled!);
    expect(rows(rendered.unsettled!)).toEqual(["Parameters food"]);
    expect(text).not.toContain("Anything");
    expect(text).not.toContain("Returns");
  });

  test("Parameters is said once for several parameters, all on its row", () => {
    expect(rows(rendered.several!)).toEqual(["Parameters foods List of foods pantry Set of foods", "Returns List of preparations"]);
  });

  // Rom, Nov 12 and 13: a parameter is ONE badge, its name and its type
  // together, never a name floating beside its type; Returns is a badge of the
  // same family. The badge is the graph's own input chip.
  test("each parameter is one badge holding its name and its type; Returns is the same badge with the type", () => {
    expect(badges(rendered.declared!)).toEqual(["x Number", "Number"]);
    expect(badges(rendered.inferred!)).toEqual(["food Food inferred", "Boolean inferred"]);
    expect(badges(rendered.several!)).toEqual(["foods List of foods", "pantry Set of foods", "List of preparations"]);
    expect(badges(rendered.unsettled!)).toEqual(["food"]);
    expect(badges(rendered.nullary!)).toEqual(["Text"]);
    for (const name of ["declared", "inferred", "several", "unsettled", "nullary"])
      expect(rendered[name]!).not.toContain("type-contract__slot-name");
  });

  test("a function without parameters has no Parameters row (no empty-state copy)", () => {
    expect(rows(rendered.nullary!)).toEqual(["Returns Text"]);
  });

  test("rows use the card's type face, never code chips or the old indigo badge", () => {
    for (const name of ["declared", "inferred", "several"]) {
      const html = rendered[name]!;
      expect(html).toContain("home-item__type-tag");
      expect(html).not.toContain("<code");
      expect(html).not.toContain("fr-type-badge");
    }
  });

  test("the single-occurrence contract is unchanged", () => {
    const text = markupText(rendered.single!);
    expect(text).toBe("Inferred Number Declared Text");
    expect(rendered.single!).not.toContain("type-contract--signature");
  });
});
