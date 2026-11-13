// A46 (Nov 13, Rom on the video's first scene: "The output in the expression is empty"). In the Expression panel the
// graph of `reverse (sortAscending [3, 1, 2])` stacked its input, two steps and its result 8rem apart; at the
// recording size the result card fell below the panel's fold, so only its top edge and ports showed. Inside the
// Expression panel the steps keep a shorter rhythm that still leaves room for the edge annotations. Source-level.
//   bun test ./distros/narthex/solid/src/lib/expression-panel-rhythm.test.ts
import { describe, expect, test } from "bun:test";
import { readFile } from "node:fs/promises";

const css = (await readFile(new URL("../routes/app.css", import.meta.url), "utf8")).replaceAll("\r\n", "\n").replace(/\/\*[\s\S]*?\*\//g, "");
const rules = [...css.matchAll(/([^{}]+)\{([^{}]*)\}/g)].map(match => ({ selectors: match[1]!.replace(/\s+/g, " ").trim(), body: match[2]!.replace(/\s+/g, " ").trim() }));
const rem = (body: string) => Number(body.match(/gap: ([\d.]+)rem/)?.[1]);

describe("an expression's result is inside the Expression panel", () => {
  test("the general graph rhythm is 8rem", () => {
    const base = rules.find(rule => rule.selectors === ".expr-call-graph--active > .expr-call-graph__stage");
    expect(rem(base!.body)).toBe(8);
  });

  test("inside the Expression panel (inline lens or dialog) the steps are closer, with room for an annotation", () => {
    const panel = rules.find(rule => rule.selectors.includes('[aria-label="Expression panel"]')
      && rule.selectors.endsWith(".expr-call-graph--active > .expr-call-graph__stage") && /gap:/.test(rule.body));
    expect(panel).toBeDefined();
    expect(panel!.selectors.startsWith(".data-inspection-dialog__panel[")).toBe(true);
    expect(rem(panel!.body)).toBeLessThanOrEqual(5);
    // An edge annotation (a one-line data card, about 1.9rem) and the arrow heads still fit between two steps.
    expect(rem(panel!.body)).toBeGreaterThanOrEqual(4);
  });
});
