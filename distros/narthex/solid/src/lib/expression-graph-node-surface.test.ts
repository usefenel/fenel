// Nov 12 (Rom, on the frame of the solve example in the New data dialog): a pale yellow rectangle stood behind the
// `AllNumbers` node, larger than the node. It encoded no state: the text editor tints a constructor call amber
// (`.expr-call--ctor`, to echo the pattern-side editor), and that rule, declared after the graph node's own
// `.expr-call--graph { background: transparent }` with the same weight, painted the graph call's whole 12rem box.
// A graph node already says "Creates data" with its package icon; the tint belongs to the text editor only.
// Source-level: no browser, no registry.
//   bun test ./distros/narthex/solid/src/lib/expression-graph-node-surface.test.ts
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
const app = rules(await read("../routes/app.css"));

describe("a constructor call in a graph has no tinted box", () => {
  const paints = (rule: Rule) => /(^|;| )background(-color)?: (?!transparent|none)/.test(rule.body);

  test("the constructor tint exists for the text editor", () => {
    const tint = app.filter(rule => paints(rule) && rule.selectors.some(selector => /\.expr-call--ctor\b/.test(selector)));
    expect(tint.length).toBeGreaterThan(0);
  });

  test("every rule that paints a constructor call's background leaves graph nodes out", () => {
    for (const rule of app.filter(paints)) {
      for (const selector of rule.selectors) {
        if (!/\.expr-call--ctor(?![\w-])/.test(selector)) continue;
        expect(selector).toContain(":not(.expr-call--graph)");
      }
    }
  });
});
