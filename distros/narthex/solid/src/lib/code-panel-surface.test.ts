// A48 (Nov 13, Rom: "The code panel would look better if the whole panel was the code editor. Right now it's a code
// editor inside a panel with padding."). With code shown, the Code panel (inline lens and dialog) has no inner padding
// and no second box: the editor fills it and the panel's radius rounds it. The composer's code box is one dark
// surface whose apply / reset row sits on it. Source-level, no browser.
//   bun test ./distros/narthex/solid/src/lib/code-panel-surface.test.ts
import { describe, expect, test } from "bun:test";
import { readFile } from "node:fs/promises";

const parse = async (path: string) => {
  const css = (await readFile(new URL(path, import.meta.url), "utf8")).replaceAll("\r\n", "\n").replace(/\/\*[\s\S]*?\*\//g, "");
  return [...css.matchAll(/([^{}]+)\{([^{}]*)\}/g)].map(match => ({ selectors: match[1]!.split(",").map(part => part.replace(/\s+/g, " ").trim()),
    body: match[2]!.replace(/\s+/g, " ").trim() }));
};
const panel = await parse("./data-inspection-dialog.css");
const app = await parse("../routes/app.css");
const ruleFor = (rules: Awaited<ReturnType<typeof parse>>, selector: string) => rules.filter(rule => rule.selectors.includes(selector)).at(-1);

describe("the Code panel is the code editor", () => {
  test("no inner padding, in a dialog and in an inline lens (stronger than the inline panels' padding rule)", () => {
    const own = ruleFor(panel, '.data-inspection-dialog__panel[aria-label="Code panel"]:has(.data-inspection-expression__code)');
    const inline = ruleFor(panel, '.data-inspection-dialog__panels--inline > .data-inspection-dialog__panel[aria-label="Code panel"]:has(.data-inspection-expression__code)');
    for (const rule of [own, inline]) {
      expect(rule?.body).toMatch(/padding: 0;/);
      expect(rule?.body).toMatch(/overflow: hidden;/);
    }
    expect(ruleFor(panel, '.data-inspection-dialog__panel[aria-label="Code panel"] .data-inspection-expression__content:has(> .data-inspection-expression__code)')?.body)
      .toMatch(/padding: 0;/);
  });

  test("the editor draws no second box; the panel's radius rounds it", () => {
    expect(ruleFor(panel, '.data-inspection-dialog__panel[aria-label="Code panel"] .data-inspection-expression__code .cm-editor')?.body)
      .toMatch(/border: 0; border-radius: 0;/);
  });

  test("the composer's code box is one dark surface with its buttons on it", () => {
    const lens = ruleFor(app, ".expr-code-lens");
    expect(lens?.body).toMatch(/background: #0f172a;/);
    expect(lens?.body).toMatch(/border-radius: 6px;/);
    expect(lens?.body).toMatch(/overflow: hidden;/);
    expect(ruleFor(app, ".expr-code-lens > .expr-code-view")?.body).toMatch(/border: 0; border-radius: 0;/);
    expect(ruleFor(app, ".expr-code-lens > .expr-code-lens__actions")?.body).toMatch(/border-top: 1px solid/);
  });
});
