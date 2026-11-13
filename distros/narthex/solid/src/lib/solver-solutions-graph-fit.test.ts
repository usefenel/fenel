// Nov 12 (the announcement's example typed in Local): the solver's answers are a card of a fixed measure
// (`.solver-solutions { width: 24rem }`, 40rem for several answers), while a graph draws its result in a 17rem card
// that centres its body. Outside the Expression panel nothing let the answers fit that card, so in the New data
// dialog "1 answer" showed as "swer" and `x = 3` was cut off on the left: computed, in the page, and not visible.
// The rule that lets a Solutions read fit its result card must hold in every call graph (a dialog, an editor, a
// panel), and must win over each fixed measure. Source-level: no browser, no registry.
//   bun test ./distros/narthex/solid/src/lib/solver-solutions-graph-fit.test.ts
import { describe, expect, test } from "bun:test";
import { readFile } from "node:fs/promises";

const read = async (name: string) => (await readFile(new URL(name, import.meta.url), "utf8")).replaceAll("\r\n", "\n");
type Rule = { selectors: string[]; body: string };
function rules(css: string): Rule[] {
  const found: Rule[] = [];
  const plain = css.replace(/\/\*[\s\S]*?\*\//g, "");
  for (const match of plain.matchAll(/([^{}]+)\{([^{}]*)\}/g)) {
    const selectors = match[1]!.split(",").map(selector => selector.replace(/\s+/g, " ").trim()).filter(Boolean);
    if (selectors.length && !selectors[0]!.startsWith("@")) found.push({ selectors, body: match[2]!.replace(/\s+/g, " ").trim() });
  }
  return found;
}
/** Classes, attributes and pseudo-classes that count (nothing inside `:where()` does). */
function specificity(selector: string): number {
  const counted = selector.replace(/:where\((?:[^()]|\([^()]*\))*\)/g, "");
  return (counted.match(/\.[\w-]+|\[[^\]]+\]|:(?!where|is|not)[\w-]+/g) ?? []).length;
}
const view = rules(await read("./solver-solutions-view.css"));
const graph = rules(await read("./expression-runner/structural-surfaces.css"));

describe("a Solutions read fits the result card of every call graph", () => {
  const fixed = view.filter(rule => /(^|;| )width: [\d.]+rem/.test(rule.body)).flatMap(rule => rule.selectors.filter(selector => /\.solver-solutions(\[[^\]]+\])?$/.test(selector)));
  const fitting = graph.filter(rule => /(^|;| )width: auto/.test(rule.body) && /max-width: 100%/.test(rule.body))
    .flatMap(rule => rule.selectors.filter(selector => /\.expr-call-graph__result \.solver-solutions$/.test(selector)));

  test("the answers card has a fixed measure wider than a graph's 17rem result card", () => {
    expect(fixed).toEqual([".solver-solutions", ".solver-solutions[data-solver-solutions=\"every\"]", ".solver-solutions[data-solver-solutions=\"family\"]"]);
  });

  test("one rule lets it fit in any call graph, not only inside one named panel", () => {
    // A selector scoped by a panel, a dialog or the function read leaves every other graph cut.
    const anywhere = fitting.filter(selector => !/section\[|\[aria-label|\.expr-form--function|\.modal|\.home-/.test(selector));
    expect(anywhere).toHaveLength(1);
    expect(anywhere[0]).toBe(".expr-call-graph--root .expr-call-graph__result .solver-solutions");
  });

  test("that rule wins over each fixed measure", () => {
    const anywhere = fitting.filter(selector => !/section\[|\[aria-label|\.expr-form--function|\.modal|\.home-/.test(selector));
    expect(anywhere).toHaveLength(1);
    const strongest = Math.max(...fixed.map(specificity));
    expect(strongest).toBe(2);
    for (const selector of anywhere) expect(specificity(selector)).toBeGreaterThan(strongest);
  });
});
