// A28 (Nov 12, seen on build B10): a deep link to the Tree of life painted its value with the plain structural reader
// (`LifeClassification`, `crossSets`, `SeEnum` in code) for a minute until the typed view arrived. Before the reader
// is prepared, a focused value that the plain reader would print as a constructor tag over code-named fields shows a
// quiet waiting state instead; text, numbers, lists, media, plain records and compact cards keep the early preview.
//   bun test ./distros/narthex/solid/src/lib/early-structure.test.ts
import { describe, expect, test } from "bun:test";
import { readFile } from "node:fs/promises";
import { plainReaderPrintsConstructorTag } from "./early-structure";

describe("which early value waits for its typed view", () => {
  test("a constructor's record with fields waits", () => {
    expect(plainReaderPrintsConstructorTag({ $tag: "LifeClassification", coverage: "These sets…", crossSets: [], sets: [] })).toBe(true);
    expect(plainReaderPrintsConstructorTag(Object.assign(Object.create(null), { $tag: "Project", name: "Fenel" }))).toBe(true);
  });

  test("what the plain reader shows well keeps the early preview", () => {
    for (const value of ["text", 42, true, null, undefined, [], [{ $tag: "Project", name: "x" }], { name: "a plain record" },
      { $tag: "Tomato" }, { $tag: "Just", _0: 3 }, { $tag: "Nothing" }, { $tag: "6f1c2d3e-0000-4000-8000-000000000001", a: 1 },
      { $tag: "", a: 1 }, new Date(0)]) {
      expect(plainReaderPrintsConstructorTag(value)).toBe(false);
    }
  });

  test("the early page of a focused value uses it; compact cards do not", async () => {
    const entry = (await readFile(new URL("./home-entry.tsx", import.meta.url), "utf8")).replaceAll("\r\n", "\n");
    expect(entry).toContain("const fallback = () => <Show when={compact || !plainReaderPrintsConstructorTag(data.value)} fallback={<CardLoadingIndicator />}>");
    expect(entry).toContain("<Loading fallback={<Show when={bodyProps.compact || !plainReaderPrintsConstructorTag(value())} fallback={<CardLoadingIndicator />}><DataPreview value={value()} /></Show>}>");
  });
});
