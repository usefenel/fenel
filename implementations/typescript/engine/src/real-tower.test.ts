// ---------------------------------------------------------------------------
// real-tower.test.ts — numeric-tower Phase 4. The LAST tower rung: Real =
// Cauchy-sequence-with-modulus (D3). Exercises the TOTAL arithmetic bodies
// (realNegate/realAdd/realSub/realMul) pointwise over a grid of constructed
// reals, the PARTIAL comparison bodies (realLt/realEq → Maybe Bool, D4 — the
// first typed-partial ops in the tower) including the SEPARATION case and the
// undecidable-equality carve-out, the bridges, the `Reprable JsRuntime/Jsonb
// Real` round-trip, and the D8 ℝ-iso, sample-discharged.
//
// THE D7 CARVE-OUT FOR REAL (brief §2h). Arithmetic is TOTAL and verified
// EXACTLY: reals are built from exact Rationals via the ℚ↪ℝ embedding ratToReal
// (a constant sequence, modulus 0), so sampling a result yields the exact
// rational, compared structurally against exact cross-multiplied Rational
// arithmetic. Comparison is PARTIAL: the `Just` branch agrees with the exact
// order; the `Nothing` branch is EXEMPT — a real that cannot be decided within
// the fuel budget returns Nothing (the partiality is the point, not a wrong
// answer). The pinned undecidable case (realEq of two reals converging to the
// SAME limit by different constructions ⇒ Nothing) is the canonical exercise of
// the decidability boundary as a typed value.
//
// MODULUS CONVENTION = 1/(k+1). The combined-error bound ratEps2 k = 2/(k+1) is a
// plain Succ-k denominator (NO pow2 — the 1/2^k convention's pow2 helper both
// triggers an engine scope-collision bug AND materializes a 2^k Peano spine; see
// the roadmap Phase-4 surprises). 1/(k+1) converges linearly, so a close pair
// (1/3 vs 1/2, gap 1/6) needs ~13 precisions to separate — hence fuel = 20 here;
// each iteration is cheap (small-denominator rationals). Production never runs
// this — the Number native is the perf branch; this cost is test-only. Ledgered
// test-tooling (the rational-tower.test.ts / int-tower.test.ts precedent).
// ---------------------------------------------------------------------------

import { test, expect } from "bun:test";
import realArithSrc from "../../../../fenel/modules/std/real/real-arith.fenel?raw";
import realBridgeSrc from "../../../../fenel/modules/std/real/real-bridge.fenel?raw";
import { loadFenelModuleUnion } from "./fenel-module";
import { stdModule } from "./modules/std";
import { createRegistry } from "./registry";
import { evaluate } from "./json-logic";
import { dispatchRegistry } from "./system-entities";

const ARITH_IDS = [
  "std:natMax", "std:ratEps2",
  "std:realNegate", "std:realAdd", "std:realSub", "std:realMul",
  "std:realSampleAt", "std:sepDecision", "std:realSeparate", "std:realLt", "std:realEq",
];
const BRIDGE_IDS = ["std:ratToReal", "std:numberToReal", "std:realToNumber", "std:realToRefined", "std:realFromRefined"];

test("real-arith.fenel + real-bridge.fenel parse to exactly the expected fnIds", () => {
  const mod = loadFenelModuleUnion([realArithSrc, realBridgeSrc].map((src) => ({ src, name: "std" }))).find((m) => m.name === "std")!;
  const ids = (mod.functions ?? []).map((f) => f.id).sort();
  expect(ids).toEqual([...ARITH_IDS, ...BRIDGE_IDS].sort());
  for (const f of mod.functions ?? []) expect(f.body).toBeDefined();
});

test("the Real ops + the bridges are wired into stdModule with Fenel bodies", () => {
  for (const id of [...ARITH_IDS, ...BRIDGE_IDS]) {
    const fn = (stdModule.functions ?? []).find((f) => f.id === id);
    expect(fn).toBeDefined();
    expect(fn!.body).toBeDefined();
  }
});

// The registry + evaluator harness (the rational-tower.test.ts pattern).
// systemEntities (incl. Real + Cauchy — registered as catalog entities in
// numeric-tower Phase 4 via foundation.fenel) are pulled in automatically, so the
// `$opaque`-peel indexes the `Real` constructor and the named-record surface
// (incl. the FUNCTION-typed seq/modulus fields holding lambda closures) builds/
// matches correctly.
const reg = createRegistry([stdModule]);
const ctx = reg.evaluateContext();
// modules-as-values Phase 2b: an instance's lift / lower is a qualified function
// reference (`{$ref: "std.natToNumber"}`); this registry resolves it to the id of
// the function the harness runs.
const declaredId = (ref: unknown): string => {
  const handle = (ref as { $ref?: unknown } | undefined)?.$ref;
  const id = typeof handle === "string" ? reg.getFunction(handle)?.id : undefined;
  if (id === undefined) throw new Error(`unresolvable lift/lower reference ${JSON.stringify(ref)}`);
  return id;
};
const body = (id: string) => (stdModule.functions ?? []).find((f) => f.id === id)!.body;
const run = (id: string, data: Record<string, unknown>) => evaluate(body(id), data, ctx);

const toInt = (x: number) => run("std:numberToInt", { n: x });
const toNat = (x: number) => run("std:numberToNat", { n: x });
const mkRat = (num: number, den: number) => run("std:mkRational", { num: toInt(num), den: toInt(den) });
const ratToReal = (num: number, den: number) => run("std:ratToReal", { q: mkRat(num, den) });

// Read a Rational's raw reduced fraction (num: Int → intToNumber, den: Nat → natToNumber).
type RawRat = { $tag: string; num: unknown; den: unknown };
const fracOf = (r: unknown) => {
  const rr = r as RawRat;
  return {
    num: run("std:intToNumber", { i: rr.num }) as number,
    den: run("std:natToNumber", { n: rr.den }) as number,
  };
};
// Sample a Real's sequence at precision k (a Nat), returning the raw fraction.
const sampleFrac = (real: unknown, k: number) => fracOf(run("std:realSampleAt", { r: real, k: toNat(k) }));
// Decode a Maybe Bool: Just True → true, Just False → false, Nothing → null.
const maybeBool = (v: unknown): boolean | null => {
  const o = v as { $tag: string; _0?: boolean };
  return o.$tag === "Nothing" ? null : (o._0 as boolean);
};

// Exact JS gcd/rat oracle (the rational-tower precedent).
const jsGcd = (a: number, b: number): number => { a = Math.abs(a); b = Math.abs(b); while (b) { [a, b] = [b, a % b]; } return a; };
const jsRat = (num: number, den: number): { num: number; den: number } => {
  if (den === 0 || num === 0) return { num: 0, den: 1 };
  const sign = den < 0 ? -1 : 1; const n = sign * num; const d = sign * den; const g = jsGcd(n, d);
  return { num: n / g, den: d / g };
};

const NUMS = [-2, -1, 0, 1, 2];
const DENS = [1, 2, 3];
const SLOW = 60_000;

// ---------------------------------------------------------------------------
// TOTAL arithmetic — D7 exact (reals built from exact Rationals; sample the
// constant-derived result at k=0, where the modulus is Zero ⇒ the exact value).
// ---------------------------------------------------------------------------

test("D7 exact — realAdd / realSub / realMul agree with exact Rational arithmetic, sampled", () => {
  for (const an of NUMS) for (const ad of DENS) for (const bn of NUMS) for (const bd of DENS) {
    const a = ratToReal(an, ad);
    const b = ratToReal(bn, bd);
    const expAdd = jsRat(an * bd + bn * ad, ad * bd);
    const expSub = jsRat(an * bd - bn * ad, ad * bd);
    const expMul = jsRat(an * bn, ad * bd);
    expect(sampleFrac(run("std:realAdd", { a, b }), 0)).toEqual(expAdd);
    expect(sampleFrac(run("std:realSub", { a, b }), 0)).toEqual(expSub);
    expect(sampleFrac(run("std:realMul", { a, b }), 0)).toEqual(expMul);
  }
}, SLOW);

test("D7 exact — realNegate agrees with exact negation, sampled at several precisions", () => {
  for (const an of NUMS) for (const ad of DENS) {
    const a = ratToReal(an, ad);
    const neg = run("std:realNegate", { a });
    // negate preserves the modulus, so the sample is exact at every precision.
    for (const k of [0, 1, 3]) expect(sampleFrac(neg, k)).toEqual(jsRat(-an, ad));
  }
}, SLOW);

test("natMax computes correctly; ratEps2 = 2/(k+1) decreases (the modulus helpers)", () => {
  const natToNum = (n: unknown) => run("std:natToNumber", { n }) as number;
  for (const [a, b] of [[0, 0], [3, 5], [5, 3], [7, 7]] as Array<[number, number]>) {
    expect(natToNum(run("std:natMax", { a: toNat(a), b: toNat(b) }))).toBe(Math.max(a, b));
  }
  // ratEps2 k = 2/(k+1): the linearly-decreasing combined-error bound.
  for (const k of [0, 1, 3, 5]) expect(fracOf(run("std:ratEps2", { k: toNat(k) }))).toEqual(jsRat(2, k + 1));
});

// ---------------------------------------------------------------------------
// PARTIAL comparison — realLt / realEq → Maybe Bool (D4). Separation witnessed
// ⇒ Just; budget exhausted on equal reals ⇒ Nothing (the carve-out).
// ---------------------------------------------------------------------------

test("realLt SEPARATION — distinct reals are decided within a small fuel budget", () => {
  const fuel = toNat(20);
  // 1/3 < 1/2 (close — needs ~5 precisions). Just True.
  expect(maybeBool(run("std:realLt", { a: ratToReal(1, 3), b: ratToReal(1, 2), fuel }))).toBe(true);
  // 1/2 < 1/3 is false (1/2 > 1/3). Just False.
  expect(maybeBool(run("std:realLt", { a: ratToReal(1, 2), b: ratToReal(1, 3), fuel }))).toBe(false);
  // 1 < 2 (well separated — decided fast). Just True.
  expect(maybeBool(run("std:realLt", { a: ratToReal(1, 1), b: ratToReal(2, 1), fuel }))).toBe(true);
  // -1 < 1. Just True.
  expect(maybeBool(run("std:realLt", { a: ratToReal(-1, 1), b: ratToReal(1, 1), fuel }))).toBe(true);
}, SLOW);

test("realLt UNDECIDABLE — equal reals exhaust the budget ⇒ Nothing (NOT a wrong False)", () => {
  // 1/2 vs 1/2: never separate ⇒ Nothing (the honest decidability boundary).
  expect(maybeBool(run("std:realLt", { a: ratToReal(1, 2), b: ratToReal(1, 2), fuel: toNat(20) }))).toBe(null);
}, SLOW);

test("realEq SOUND-conservative — separated ⇒ Just False; equal ⇒ Nothing (never Just True)", () => {
  const fuel = toNat(20);
  // distinct reals separate ⇒ unequal ⇒ Just False.
  expect(maybeBool(run("std:realEq", { a: ratToReal(1, 3), b: ratToReal(1, 2), fuel }))).toBe(false);
  // equal reals (same value, SAME construction) ⇒ cannot confirm equality ⇒ Nothing.
  expect(maybeBool(run("std:realEq", { a: ratToReal(2, 4), b: ratToReal(1, 2), fuel }))).toBe(null);
}, SLOW);

test("realEq the D7 ℝ carve-out — two reals converging to the same limit by DIFFERENT constructions ⇒ Nothing", () => {
  // 1/2 directly vs (1/4 + 1/4): the same limit, built differently. realEq cannot
  // POSITIVELY confirm equality (no finite sampling can) ⇒ Nothing. This is the
  // partiality being the point — the Nothing is exempt from the agrees-with-native
  // requirement (it is NOT a wrong answer).
  const half = ratToReal(1, 2);
  const quarterSum = run("std:realAdd", { a: ratToReal(1, 4), b: ratToReal(1, 4) });
  expect(maybeBool(run("std:realEq", { a: half, b: quarterSum, fuel: toNat(20) }))).toBe(null);
  // and the sum genuinely IS 1/2 (sampled exactly) — so Nothing is the undecidable
  // EQUAL case, not a separation we missed.
  expect(sampleFrac(quarterSum, 0)).toEqual({ num: 1, den: 2 });
}, SLOW);

// ---------------------------------------------------------------------------
// Bridges + the D8 ℝ-iso, over the integer sub-domain (where the Number sample
// is exact). realToNumber is LOSSY in general (a sample at one precision).
// ---------------------------------------------------------------------------

test("bridges — numberToReal / realToNumber round-trip over integers; ratToReal embeds exactly", () => {
  for (const k of [-3, -1, 0, 2, 5]) {
    // realToNumber (numberToReal k) ≡ k on the integer Number domain.
    expect(run("std:realToNumber", { r: run("std:numberToReal", { x: k }) })).toBe(k);
  }
  // ratToReal embeds a non-integer rational exactly (sampled), though realToNumber is lossy.
  expect(sampleFrac(ratToReal(1, 3), 4)).toEqual({ num: 1, den: 3 });
});

test("D8 ℝ-iso — round-trips to the identity over the integer sub-domain", () => {
  for (const k of [-3, -1, 0, 1, 4]) {
    // refinement side: integer Number → Real → Number.
    expect(run("std:realToRefined", { r: run("std:realFromRefined", { n: k }) })).toBe(k);
  }
});

// ---------------------------------------------------------------------------
// Reprable JsRuntime Real + Reprable Jsonb Real (option A: native Number, the
// lossy sample bridges; round-trip over the integer sub-domain). Keyed off the
// instance's DECLARED method fnIds (the int/rational precedent).
// ---------------------------------------------------------------------------

const reprableReal = (target: string) => {
  const i = [...dispatchRegistry.listInstances("Reprable")].find((x) => x.args[0] === target && x.args[1] === "Real");
  if (!i) throw new Error(`Reprable ${target} Real instance not registered`);
  return i;
};

test("Reprable JsRuntime Real — instance projected with native type-ref + sample lift/lower", () => {
  const r = reprableReal("JsRuntime");
  expect(r.typeName).toBe("Reprable");
  expect(r.args).toEqual(["JsRuntime", "Real"]);
  expect(r.methods.native).toEqual({ $ref: "Number" });
  expect(r.methods.lift).toEqual({ $ref: "std.realToNumber" });
  expect(r.methods.lower).toEqual({ $ref: "std.numberToReal" });
});

test("Reprable Jsonb Real — the storage-target sibling shares the sample bridges", () => {
  const r = reprableReal("Jsonb");
  expect(r.args).toEqual(["Jsonb", "Real"]);
  expect(r.methods.lift).toEqual({ $ref: "std.realToNumber" });
  expect(r.methods.lower).toEqual({ $ref: "std.numberToReal" });
});

test("Reprable JsRuntime Real — round-trip via the declared lift/lower over integers", () => {
  const inst = reprableReal("JsRuntime");
  const liftFn = declaredId(inst.methods.lift);  // Real -> Number
  const lowerFn = declaredId(inst.methods.lower); // Number -> Real
  for (const k of [-2, 0, 3, 7]) {
    expect(run(liftFn, { r: run(lowerFn, { x: k }) })).toBe(k);
  }
});
