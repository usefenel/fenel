// Nov 12 (Rom, on the Programming languages tiles: "Smalltalk: the k is spilling over on the next line"). A tile's
// label (its corner name, and the name a small tile shows as its mark) takes two lines between words only; a single
// word longer than the line ends in an ellipsis instead of breaking inside the word. Source-level, no browser.
//   bun test ./distros/narthex/solid/src/lib/list-tile-label.test.ts
import { describe, expect, test } from "bun:test";
import { readFile } from "node:fs/promises";

const css = (await readFile(new URL("./list-tile.css", import.meta.url), "utf8")).replaceAll("\r\n", "\n").replace(/\/\*[\s\S]*?\*\//g, "");
const rules = [...css.matchAll(/([^{}]+)\{([^{}]*)\}/g)].map(match => ({ selectors: match[1]!.replace(/\s+/g, " ").trim(), body: match[2]!.replace(/\s+/g, " ").trim() }));

describe("a tile label never breaks inside a word", () => {
  test("no tile rule lets a word break anywhere", () => {
    expect(css).not.toMatch(/overflow-wrap:\s*anywhere|word-break:\s*break-all/);
  });

  for (const selector of [".list-tile__corner", '[data-thumbnail-field]']) {
    test(`${selector}: two lines between words, an ellipsis for a word too long`, () => {
      const rule = rules.find(candidate => candidate.selectors.includes(selector) && /-webkit-line-clamp: 2/.test(candidate.body));
      expect(rule).toBeDefined();
      expect(rule!.body).toMatch(/overflow-wrap: normal/);
      expect(rule!.body).toMatch(/text-overflow: ellipsis/);
      expect(rule!.body).toMatch(/overflow: hidden/);
    });
  }
});
