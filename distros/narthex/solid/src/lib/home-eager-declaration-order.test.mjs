import { expect, test } from "bun:test";

// Fix lane A (Nov 8): two Home crashes were reads of a `const` before its
// declaration from code that runs when the component is created (a memo, or an
// effect's compute):
// - home.tsx: every Local item editor threw "Cannot access 'se' before
//   initialization" when it opened, because the Inspection print's
//   `hold: () => sourceReadPending()` ran before `sourceReadPending` existed;
// - home-entry.tsx: the notices memo read `newExpressionRequest()`, declared
//   about 500 lines later.
// TypeScript accepts both (the reads sit inside closures). This test checks
// that every same-component `const` CALLED inside such an eager region is
// declared above it. It reads source text, so it guards these regions only.
const read = async path => (await Bun.file(new URL(path, import.meta.url)).text()).replace(/\r\n?/g, "\n");
const home = await read("../routes/app/home.tsx");
const entry = await read("./home-entry.tsx");

function componentStart(source, at) {
  const start = source.lastIndexOf("\nfunction ", at);
  const exported = source.lastIndexOf("\nexport function ", at);
  return Math.max(start, exported);
}

/** Names called in `source[from, to)` that are declared by a component-level
 *  `const` (or a signal tuple) at or after `from` in the same component. */
function lateDeclarations(source, from, to) {
  if (from < 0 || to <= from) throw new Error("Eager region moved");
  const begin = componentStart(source, from);
  const end = source.indexOf("\nfunction ", to) < 0 ? source.length : source.indexOf("\nfunction ", to);
  const component = source.slice(begin, end);
  const declared = new Map();
  for (const match of component.matchAll(/\n  const (?:\[(\w+)[^\]]*\]|(\w+))\s*=/g)) {
    const name = match[1] ?? match[2];
    if (!declared.has(name)) declared.set(name, begin + match.index);
  }
  const late = new Set();
  for (const match of source.slice(from, to).matchAll(/\b([A-Za-z_]\w*)\(/g)) {
    const at = declared.get(match[1]);
    if (at !== undefined && at > from) late.add(match[1]);
  }
  return [...late];
}

test("the Inspection print's creation-time reads are declared above it (home.tsx)", () => {
  const from = home.indexOf("  const localText = localGuidance ? createLocalExpressionPrint(");
  const to = home.indexOf("\n  const localTyping", from);
  expect(lateDeclarations(home, from, to)).toEqual([]);
  expect(home.slice(from, to)).toContain("hold: () => sourceReadPending()");
});

test("the notices memo's reads are declared above it (home-entry.tsx)", () => {
  const from = entry.indexOf("  const raisedNotices = createMemo<LocusNotice[]>(");
  const to = entry.indexOf("\n  });\n", from);
  expect(lateDeclarations(entry, from, to)).toEqual([]);
  expect(entry.slice(from, to)).toContain("newExpressionRequest()");
});
