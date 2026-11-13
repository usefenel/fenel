// Nov 12 (Rom, on the Expression panel: "the image is cropped, and its size label too: 24 x 16, we only see the
// 16"). An image inspected inside a graph node's card is displayed 320px wide, wider than the 17rem card; a
// percentage cap does not bound a flex item's min-content size, so the image and its caption overflowed and were
// clipped. Inside a graph card (a data node or the result) the image has an absolute cap that fits the card.
// Source-level, no browser.
//   bun test ./distros/narthex/solid/src/lib/expression-runner/image-canvas-graph-fit.test.ts
import { describe, expect, test } from "bun:test";
import { readFile } from "node:fs/promises";

const plain = (text: string) => text.replaceAll("\r\n", "\n").replace(/\/\*[\s\S]*?\*\//g, "");
const canvas = plain(await readFile(new URL("./image-canvas.css", import.meta.url), "utf8"));
const app = plain(await readFile(new URL("../../routes/app.css", import.meta.url), "utf8"));
const rules = [...canvas.matchAll(/([^{}]+)\{([^{}]*)\}/g)].map(match => ({ selectors: match[1]!.replace(/\s+/g, " ").trim(), body: match[2]!.replace(/\s+/g, " ").trim() }));
const rem = (value: string) => Number(value.replace("rem", ""));

describe("an image inside a graph card is whole", () => {
  test("both graph cards cap the inspected image with an absolute measure", () => {
    const cap = rules.find(rule => rule.selectors.includes(".expr-graph-data-card") && rule.selectors.includes(".expr-call-graph__result-data-card")
      && /max-width: [\d.]+rem/.test(rule.body));
    expect(cap).toBeDefined();
    const width = rem(cap!.body.match(/max-width: ([\d.]+rem)/)![1]!);
    // The card body is 17rem with 0.7rem padding on each side.
    expect(app).toMatch(/\.expr-graph-collection__body \{ width: 17rem;/);
    expect(app).toMatch(/\.expr-graph-data-card \.home-item__body \{ min-height: 0; padding: 0\.55rem 0\.7rem; \}/);
    expect(width).toBeLessThanOrEqual(17 - 2 * 0.7);
  });

  test("the cap comes after the 320px display width it bounds", () => {
    const display = canvas.indexOf("width: var(--expr-image-display-width, auto)");
    const cap = canvas.search(/max-width: [\d.]+rem/);
    expect(display).toBeGreaterThan(0);
    expect(cap).toBeGreaterThan(display);
  });
});
