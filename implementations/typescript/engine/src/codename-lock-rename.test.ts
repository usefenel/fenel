// ---------------------------------------------------------------------------
// The lock's in-place rename writer (modules-as-values Phase 5, per-owner type
// identity S2). A type row is re-keyed from its bare name to its owner key
// KEEPING its UUID — the pin-a-rename policy of the lock header (precedent:
// 805476ec re-keyed 305 field rows in place). The writer applies a whole
// rename set or nothing: a missing or mismatched old row, or an occupied new
// key, refuses before any byte is written.
// ---------------------------------------------------------------------------

import { afterAll, describe, expect, test } from "bun:test";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { renameLockFileRows } from "./codename-lock";

const A = "0f000000-0000-4000-8000-000000000001";
const B = "0f000000-0000-4000-8000-000000000002";
const C = "0f000000-0000-4000-8000-000000000003";

const dir = mkdtempSync(join(tmpdir(), "fenel-lock-rename-"));
afterAll(() => rmSync(dir, { recursive: true, force: true }));

let counter = 0;
function lockFile(rows: string[]): string {
  const path = join(dir, `lock-${counter++}.fenel.lock`);
  writeFileSync(path, `# header\n\n${rows.join("\n")}\n`, "utf8");
  return path;
}

function rowsOf(path: string): string[] {
  return readFileSync(path, "utf8").split("\n").filter((line) => line && !line.startsWith("#"));
}

describe("renameLockFileRows", () => {
  test("renames each row in place with its UUID; every other row is untouched", () => {
    const path = lockFile([
      "Animation ; " + A,
      "Update ; " + B,
      "field:type%3Atelegram%3AUpdate/named%3AupdateId ; " + C,
    ]);
    const result = renameLockFileRows(path, [
      { from: "Animation", to: "type/module/animation/Animation", id: A },
      { from: "Update", to: "type/module/telegram/Update", id: B },
    ]);
    expect(result).toEqual({ renamed: 2 });
    expect(rowsOf(path)).toEqual([
      "field:type%3Atelegram%3AUpdate/named%3AupdateId ; " + C,
      "type/module/animation/Animation ; " + A,
      "type/module/telegram/Update ; " + B,
    ]);
    expect(readFileSync(path, "utf8").startsWith("# .fenel.lock")).toBe(true);
  });

  test("a missing old row, a mismatched UUID or an occupied new key refuses and writes nothing", () => {
    const path = lockFile(["Animation ; " + A, "type/module/telegram/Animation ; " + B]);
    const before = readFileSync(path, "utf8");
    expect(() => renameLockFileRows(path, [
      { from: "Ghost", to: "type/module/x/Ghost", id: A },
    ])).toThrow(/Ghost.*no such row/);
    expect(() => renameLockFileRows(path, [
      { from: "Animation", to: "type/module/animation/Animation", id: C },
    ])).toThrow(/Animation.*pins/);
    expect(() => renameLockFileRows(path, [
      { from: "Animation", to: "type/module/telegram/Animation", id: A },
    ])).toThrow(/occupied/);
    // One bad rename in a set refuses the whole set.
    expect(() => renameLockFileRows(path, [
      { from: "Animation", to: "type/module/animation/Animation", id: A },
      { from: "Ghost", to: "type/module/x/Ghost", id: C },
    ])).toThrow(/Ghost/);
    expect(readFileSync(path, "utf8")).toBe(before);
  });

  test("a key occupied in the wider union, two renames to one key, and a malformed UUID refuse", () => {
    const path = lockFile(["Animation ; " + A, "Game ; " + B]);
    const before = readFileSync(path, "utf8");
    expect(() => renameLockFileRows(
      path,
      [{ from: "Animation", to: "type/module/animation/Animation", id: A }],
      new Map([["type/module/animation/Animation", C]]),
    )).toThrow(/occupied/);
    expect(() => renameLockFileRows(path, [
      { from: "Animation", to: "type/module/x/T", id: A },
      { from: "Game", to: "type/module/x/T", id: B },
    ])).toThrow(/twice/);
    expect(() => renameLockFileRows(path, [
      { from: "Animation", to: "type/module/animation/Animation", id: "not-a-uuid" },
    ])).toThrow(/UUID/);
    expect(readFileSync(path, "utf8")).toBe(before);
  });
});
