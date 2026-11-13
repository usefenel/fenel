// Finite-set judgments over large enums run in constant host stack.
//
// The interpreter has no tail calls, so a Fenel loop that recursed once per
// enum member took one evaluator nesting (about eight host frames) per member.
// A browser worker overflowed on the Encyclopedia's 20 euro-area flags against
// 258 country flags (Nov 8). Bun's default stack is larger, so the judgments
// run here in a FRESH realm whose stack is cut to 256 KB: the member-recursive
// bodies overflowed at about 70 members there; the fold-based ones decide 2000.
import { describe, expect, test } from "bun:test";
import { dirname } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));

function runSmallStackRealm(code: string): Record<string, unknown> {
  const result = Bun.spawnSync([process.execPath, "-e", code], {
    cwd: here,
    env: { ...process.env, BUN_JSC_maxPerThreadStackUsage: String(256 * 1024) },
    stdout: "pipe",
    stderr: "pipe",
  });
  const stdout = result.stdout.toString();
  if (result.exitCode !== 0) throw new Error(`realm failed (${result.exitCode}): ${result.stderr.toString()}\n${stdout}`);
  return JSON.parse(stdout.trim().split("\n").at(-1) ?? "") as Record<string, unknown>;
}

describe("enum judgments in a small host stack", () => {
  test("contains, subset and disjointness decide a 2000-member enum", () => {
    const out = runSmallStackRealm(`
      const sa = await import("./set-algebra.ts");
      const flag = (i) => String.fromCodePoint(0x1f1e6 + Math.floor(i / 26) % 26, 0x1f1e6 + (i % 26)) + (i >= 676 ? String(i) : "");
      const en = (vs) => ({ $tag: "SeEnum", values: vs });
      const big = Array.from({ length: 2000 }, (_, i) => flag(i));
      const tail = big.slice(1998);
      const outside = [flag(2001), flag(2002)];
      const run = (f) => { try { return f(); } catch (e) { return String(e && e.name) + ": " + String(e && e.message); } };
      console.log(JSON.stringify({
        containsLast: run(() => sa.contains(en(big), big[1999], null)),
        containsOutside: run(() => sa.contains(en(big), outside[0], null)),
        tailWithin: run(() => sa.isSubset(en(tail), en(big))),
        bigWithinTail: run(() => sa.isSubset(en(big), en(tail))),
        outsideWithin: run(() => sa.isSubset(en([big[1999], outside[0]]), en(big))),
        tailDisjoint: run(() => sa.isDisjoint(en(tail), en(big))),
        outsideDisjoint: run(() => sa.isDisjoint(en(outside), en(big))),
      }));
    `);
    const just = (answer: boolean) => ({ $tag: "Just", _0: answer });
    expect(out).toEqual({
      containsLast: just(true),
      containsOutside: just(false),
      tailWithin: just(true),
      bigWithinTail: just(false),
      outsideWithin: just(false),
      tailDisjoint: just(false),
      outsideDisjoint: just(true),
    });
  }, 600_000);
});
