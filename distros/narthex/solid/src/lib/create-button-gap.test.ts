// Nov 12 (Rom, on the frame of the New data dialog): the Create button's status dot touched its label ("●Create").
// The button laid its two children out with `.btn` alone, which has no gap; icon-plus-label buttons share
// `.home-action-button` (a 0.4rem gap). The Create button takes that shared rule instead of a one-off margin.
// Source-level: no browser, no registry.
//   bun test ./distros/narthex/solid/src/lib/create-button-gap.test.ts
import { describe, expect, test } from "bun:test";
import { readFile } from "node:fs/promises";

const read = async (name: string) => (await readFile(new URL(name, import.meta.url), "utf8")).replaceAll("\r\n", "\n");
const home = await read("../routes/app/home.tsx");
const entryCss = (await read("./home-entry.css")).replace(/\/\*[\s\S]*?\*\//g, "");

describe("the Create button spaces its status dot like other icon-plus-label buttons", () => {
  test("the shared icon-plus-label rule has a gap", () => {
    const rule = entryCss.match(/(?:^|\n)\.home-action-button\s*\{([^}]*)\}/);
    expect(rule?.[1]).toMatch(/gap: *0\.4rem/);
  });

  test("the Create button carries the shared rule", () => {
    const button = home.match(/<button type="button" class="([^"]*home-composer-modal__create(?![\w-])[^"]*)"/);
    expect(button?.[1]?.split(/\s+/)).toContain("home-action-button");
  });
});
