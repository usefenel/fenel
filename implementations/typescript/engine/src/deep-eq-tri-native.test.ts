// Recipes lane 2 (Nov 8): the sanctioned performance branch
// `deepEqValueTriStructural` (engine-bodies-dispatch.ts) answers exactly what
// its Fenel source of truth answers: rel-solve.fenel
// `deepEqValueTriStep a b remaining depth false` (verdict AND remaining
// budget), on generated values covering every layout the body distinguishes.
// Registry-light (engine harness only):
//   FENEL_PARSER_LEGACY=1 bun test --timeout 3600000 ./implementations/typescript/engine/src/deep-eq-tri-native.test.ts
import { describe, expect, test } from "bun:test";
import { deepEqValueTriStructural, dispatchRecipeEngineBody } from "./engine-bodies-dispatch";

const fenel = (a: unknown, b: unknown, remaining: number, depth: number): unknown =>
  dispatchRecipeEngineBody("engine:deepEqValueTriStep", [a, b, remaining, depth, false]);
// The Fenel callers reach the branch by name: recipeSourceDataEqual's non-scalar
// arm asks it with budget 4096 and depth 128.
const sourceDataEqual = (a: unknown, b: unknown): unknown => dispatchRecipeEngineBody("engine:recipeSourceDataEqual", [a, b]);

// Deterministic generator (mulberry32).
function rng(seed: number) {
  let t = seed >>> 0;
  return () => { t = (t + 0x6d2b79f5) >>> 0; let r = Math.imul(t ^ (t >>> 15), 1 | t); r ^= r + Math.imul(r ^ (r >>> 7), 61 | r); return ((r ^ (r >>> 14)) >>> 0) / 4294967296; };
}
class Host { constructor(public x: number) {} }
function scalar(next: () => number): unknown {
  const pool: unknown[] = [0, -0, 1, 1.5, -2, NaN, Infinity, "", "a", "b", "1", "Just", true, false, null, undefined, 2 ** 53];
  return pool[Math.floor(next() * pool.length)];
}
function value(next: () => number, depth: number): unknown {
  const roll = next();
  if (depth <= 0 || roll < 0.35) return scalar(next);
  if (roll < 0.55) return Array.from({ length: Math.floor(next() * 4) }, () => value(next, depth - 1));
  if (roll < 0.85) {
    const out: Record<string, unknown> = {};
    const names = ["a", "b", "$tag", "_0", "name", "value", "__fenelFn", "__fenelPartial"];
    for (let i = Math.floor(next() * 4); i > 0; i--) {
      const name = names[Math.floor(next() * names.length)]!;
      out[name] = name === "__fenelFn" || name === "__fenelPartial" ? next() < 0.5 : name === "$tag" ? (next() < 0.5 ? "Just" : "Nothing") : value(next, depth - 1);
    }
    return out;
  }
  // Exotic layouts the snapshot refuses or treats specially.
  const exotic = Math.floor(next() * 7);
  if (exotic === 0) { const a: unknown[] = [1, 2]; (a as unknown as Record<string, unknown>).extra = 3; return a; }
  if (exotic === 1) { const a = new Array(3); a[1] = 1; return a; }
  if (exotic === 2) return Object.defineProperty({ a: 1 }, "hidden", { value: 2, enumerable: false });
  if (exotic === 3) return Object.defineProperty({}, "g", { get: () => 1, enumerable: true });
  if (exotic === 4) return new Host(1);
  if (exotic === 5) return Object.assign(Object.create(null), { a: 1 });
  return { [Symbol("s")]: 1, a: 1 };
}
function variant(next: () => number, base: unknown, depth: number): unknown {
  if (next() < 0.3) return value(next, depth);
  if (next() < 0.5) return structuredCloneSafe(base);
  return base;
}
function structuredCloneSafe(value: unknown): unknown {
  try { return structuredClone(value); } catch { return value; }
}

describe("deepEqValueTriStructural equals deepEqValueTriStep(…, false)", () => {
  test("generated pairs: verdict and remaining budget", () => {
    const next = rng(20261108);
    let compared = 0;
    for (let i = 0; i < 1500; i++) {
      const a = value(next, 4);
      const b = variant(next, a, 4);
      const remaining = next() < 0.3 ? Math.floor(next() * 12) - 1 : 4096;
      const depth = next() < 0.3 ? Math.floor(next() * 5) : 128;
      const expected = fenel(a, b, remaining, depth);
      expect<unknown>([i, deepEqValueTriStructural(a, b, remaining, depth)]).toEqual([i, expected]);
      const full = fenel(a, b, 4096, 128) as { verdict: { $tag: string; _0?: boolean } };
      expect([i, sourceDataEqual(a, b)]).toEqual([i, full.verdict.$tag === "Just" && full.verdict._0 === true]);
      compared++;
    }
    expect(compared).toBe(1500);
  }, 3_600_000);
  test("closures, cycles and deep nesting", () => {
    const cyclic: Record<string, unknown> = { a: 1 }; cyclic.self = cyclic;
    let deep: unknown = 0; for (let i = 0; i < 200; i++) deep = [deep];
    const closure = { __fenelFn: true, params: ["x"], body: { var: "x" } };
    const pairs: Array<[unknown, unknown]> = [[cyclic, cyclic], [cyclic, { a: 1, self: { a: 1 } }], [deep, deep], [closure, closure],
      [closure, { ...closure }], [{}, {}], [[], []], [{ $tag: "Just", _0: 1 }, { _0: 1, $tag: "Just" }], [1, "1"], [NaN, NaN]];
    for (const [a, b] of pairs) for (const [remaining, depth] of [[4096, 128], [5, 128], [4096, 3]] as const)
      expect<unknown>(deepEqValueTriStructural(a, b, remaining, depth)).toEqual(fenel(a, b, remaining, depth));
  }, 3_600_000);
});
