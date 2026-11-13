// ---------------------------------------------------------------------------
// rational-tower.test.ts — numeric-tower Phase 3. The D7 round-trip law for the
// pure ratio Rational ops + the two Number bridges + the D8 Rational↔ℚ iso,
// sample-tested over a grid of (num, den) Int pairs, plus the LOWEST-TERMS
// canonical-form pins (the central Phase-3 hazard), the ratDiv zero-divisor
// boundary, and the `Reprable JsRuntime Rational` round-trip.
//
// Pure arithmetic is checked against exact integer arithmetic + a JS gcd
// oracle, compared structurally and through the explicit approximate Number
// bridge. Reprable now uses lossless integer-string ratio parts, including
// fractions and integers beyond Number precision; its round-trips below cover
// canonical representation values. The D8 refinement witness retains the
// exact Rational carrier and normalizes it without a Number projection.
//
// MECHANISM: the bodies use the NAMED-record surface (`Rational { num = q, den =
// d }`) over real materialized Int numerators + Nat denominators. The construct
// gap is dissolved (Rational is a registered catalog entity via foundation.fenel
// `@directives`), so the named surface builds the canonical `{$tag:"Rational",
// num, den}` value. Ledgered test-tooling (the int-tower.test.ts /
// nat-peano.test.ts precedent).
//
// LOWEST TERMS (§1 of the brief): a rational has infinitely many
// representations (1/2 = 2/4 = …) + a sign that can sit on num OR den. The
// `mkRational` smart constructor reduces by gcd, forces a positive denominator,
// and maps 0 ⇒ 0/1, so no non-canonical value escapes. The pins below assert
// every result is reduced (gcd(|num|, den) === 1), den > 0, and zero is exactly
// {num:0, den:1}. ratEq compares by cross-multiplication, so admitted unreduced
// ratios also have mathematical equality.
// ---------------------------------------------------------------------------

import { test, expect } from "bun:test";
import ratArithSrc from "../../../../fenel/modules/std/rational/rational-arith.fenel?raw";
import ratBridgeSrc from "../../../../fenel/modules/std/rational/rational-bridge.fenel?raw";
import { loadFenelModuleUnion } from "./fenel-module";
import { stdModule } from "./modules/std";
import { createRegistry } from "./registry";
import { evaluate } from "./json-logic";
import { dispatchRegistry } from "./system-entities";

const ARITH_IDS = [
  "std:natGcd", "std:mkRational", "std:ratNeg",
  "std:ratAdd", "std:ratSub", "std:ratMul", "std:ratDiv", "std:ratEq", "std:ratLt",
];
const BRIDGE_IDS = ["std:rationalToNumber", "std:numberToRational", "std:ratToRefined", "std:ratFromRefined"];

test("rational-arith.fenel + rational-bridge.fenel parse to exactly the 13 expected fnIds", () => {
  const mod = loadFenelModuleUnion([ratArithSrc, ratBridgeSrc].map((src) => ({ src, name: "std" }))).find((m) => m.name === "std")!;
  const ids = (mod.functions ?? []).map((f) => f.id).sort();
  expect(ids).toEqual([...ARITH_IDS, ...BRIDGE_IDS].sort());
  for (const f of mod.functions ?? []) expect(f.body).toBeDefined();
});

test("the Rational ops + the two bridges are wired into stdModule with Fenel bodies", () => {
  for (const id of [...ARITH_IDS, ...BRIDGE_IDS]) {
    const fn = (stdModule.functions ?? []).find((f) => f.id === id);
    expect(fn).toBeDefined();
    expect(fn!.body).toBeDefined();
  }
});

// The registry + evaluator harness (the int-tower.test.ts pattern). systemEntities
// (incl. Rational — registered as a catalog entity in numeric-tower Phase 3) are
// pulled into the registry automatically, so the `$opaque`-peel indexes the
// `Rational` constructor and the named-record surface builds/matches correctly.
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
// Invoke the declared bridge, including its registered representation branch.
const call1 = (id: string, v: unknown) => evaluate({ call: [id, { var: "x" }] }, { x: v }, ctx);

const toInt = (x: number) => run("std:numberToInt", { n: x });
// Build a Rational from an (int) num/den pair via the smart constructor.
const mkRat = (num: number, den: number) => run("std:mkRational", { num: toInt(num), den: toInt(den) });
// Read a Rational's raw reduced fraction: num (Int) → intToNumber, den (Nat) → natToNumber.
type RawRat = { $tag: string; num: unknown; den: unknown };
const fracOf = (r: unknown) => {
  const rr = r as RawRat;
  return {
    num: run("std:intToNumber", { i: rr.num }) as number,
    den: run("std:natToNumber", { n: rr.den }) as number,
  };
};
const ratToNum = (r: unknown) => run("std:rationalToNumber", { r }) as number;

// JS oracle — the exact reduced fraction (the legacy rational.ts:rat semantics).
const jsGcd = (a: number, b: number): number => {
  a = Math.abs(a);
  b = Math.abs(b);
  while (b) {
    [a, b] = [b, a % b];
  }
  return a;
};
const jsRat = (num: number, den: number): { num: number; den: number } => {
  if (den === 0) return { num: 0, den: 1 }; // mirrors the mkRational zero-den sentinel
  if (num === 0) return { num: 0, den: 1 };
  const sign = den < 0 ? -1 : 1;
  const n = sign * num;
  const d = sign * den;
  const g = jsGcd(n, d);
  return { num: n / g, den: d / g };
};

// Grid of numerators (signed, incl. 0) and denominators (signed, NON-zero — so
// mkRational's sign-fold is exercised; zero dens are the ratDiv-only boundary).
// Kept modest (7×4) because the O(n²) cross-product tests materialize Peano
// magnitudes through the interpreter — the heavy tests carry an explicit timeout.
const NUMS = [-3, -2, -1, 0, 1, 2, 3];
const DENS = [-2, -1, 1, 2];
const INTS = [-7, -6, -5, -4, -3, -2, -1, 0, 1, 2, 3, 4, 5, 6, 7];
const SLOW = 60_000; // ms — the cross-product grids exceed the 5s default.

// ---------------------------------------------------------------------------
// mkRational — the lowest-terms / sign-fold / zero canonicalization.
// ---------------------------------------------------------------------------

test("mkRational produces the canonical reduced fraction (lowest terms, positive den, 0=0/1) over the grid", () => {
  for (const num of NUMS) {
    for (const den of DENS) {
      const r = mkRat(num, den);
      const got = fracOf(r);
      const exp = jsRat(num, den);
      expect(got).toEqual(exp);
      // canonical pins
      expect(got.den).toBeGreaterThan(0);
      expect(jsGcd(Math.abs(got.num), got.den)).toBe(1);
      if (num === 0) expect(got).toEqual({ num: 0, den: 1 });
    }
  }
});

test("mkRational folds a negative denominator onto the numerator (−1/2 ≡ 1/−2)", () => {
  expect(fracOf(mkRat(1, -2))).toEqual({ num: -1, den: 2 });
  expect(fracOf(mkRat(-1, -2))).toEqual({ num: 1, den: 2 });
  // 2/4, 3/6, 6/-12 all reduce + sign-fold to the same canonical value.
  expect(fracOf(mkRat(2, 4))).toEqual({ num: 1, den: 2 });
  expect(fracOf(mkRat(3, 6))).toEqual({ num: 1, den: 2 });
  expect(fracOf(mkRat(6, -12))).toEqual({ num: -1, den: 2 });
});

test("mkRational zero-denominator guard returns the 0/1 sentinel (the rational div-by-zero boundary)", () => {
  expect(fracOf(run("std:mkRational", { num: toInt(5), den: toInt(0) }))).toEqual({ num: 0, den: 1 });
  expect(fracOf(run("std:mkRational", { num: toInt(-3), den: toInt(0) }))).toEqual({ num: 0, den: 1 });
});

// ---------------------------------------------------------------------------
// D7 (exact) — ratAdd / ratSub / ratMul / ratDiv against EXACT cross-multiply.
// ---------------------------------------------------------------------------

const PAIRS: Array<[number, number]> = [];
for (const n of NUMS) for (const d of DENS) PAIRS.push([n, d]);

test("D7 exact — ratAdd / ratSub / ratMul produce the reduced fraction over the ratio grid", () => {
  for (const [an, ad] of PAIRS) {
    for (const [bn, bd] of PAIRS) {
      const a = mkRat(an, ad);
      const b = mkRat(bn, bd);
      // expected reduced fractions via exact integer arithmetic.
      const expAdd = jsRat(an * bd + bn * ad, ad * bd);
      const expSub = jsRat(an * bd - bn * ad, ad * bd);
      const expMul = jsRat(an * bn, ad * bd);
      const add = fracOf(run("std:ratAdd", { a, b }));
      const sub = fracOf(run("std:ratSub", { a, b }));
      const mul = fracOf(run("std:ratMul", { a, b }));
      expect(add).toEqual(expAdd);
      expect(sub).toEqual(expSub);
      expect(mul).toEqual(expMul);
      // float bridge agrees (exact for these small samples).
      expect(ratToNum(run("std:ratAdd", { a, b }))).toBeCloseTo(expAdd.num / expAdd.den, 9);
    }
  }
}, SLOW);

test("D7 exact — ratDiv produces the reduced fraction; bNum=0 hits the zero-divisor 0/1 boundary", () => {
  for (const [an, ad] of PAIRS) {
    for (const [bn, bd] of PAIRS) {
      const a = mkRat(an, ad);
      const b = mkRat(bn, bd);
      const div = fracOf(run("std:ratDiv", { a, b }));
      // a/b ÷ c/d = (a·d)/(b·c); when bn=0 the divisor is 0 ⇒ mkRational sentinel 0/1.
      const exp = bn === 0 ? { num: 0, den: 1 } : jsRat(an * bd, ad * bn);
      expect(div).toEqual(exp);
    }
  }
}, SLOW);

test("D7 exact — ratNeg agrees with exact negation; ratLt / ratEq agree with exact cmp", () => {
  for (const [an, ad] of PAIRS) {
    expect(fracOf(run("std:ratNeg", { a: mkRat(an, ad) }))).toEqual(jsRat(-an, ad));
    for (const [bn, bd] of PAIRS) {
      const a = mkRat(an, ad);
      const b = mkRat(bn, bd);
      // both dens positive after normalization ⇒ cross-multiply with positive |den|.
      const aN = jsRat(an, ad);
      const bN = jsRat(bn, bd);
      const expLt = aN.num * bN.den < bN.num * aN.den;
      const expEq = aN.num * bN.den === bN.num * aN.den;
      expect(run("std:ratLt", { a, b })).toBe(expLt);
      expect(run("std:ratEq", { a, b })).toBe(expEq);
    }
  }
}, SLOW);

// ---------------------------------------------------------------------------
// Lowest-terms leak spot-check — NO op ever emits a non-reduced / negative-den /
// forked-zero value (the §1 hazard).
// ---------------------------------------------------------------------------

const isCanonical = (r: unknown) => {
  const f = fracOf(r);
  if (f.den <= 0) return false;
  if (jsGcd(Math.abs(f.num), f.den) !== 1) return false;
  if (f.num === 0 && f.den !== 1) return false;
  return true;
};

test("NO body emits a non-canonical Rational (the lowest-terms leak spot-check)", () => {
  for (const [an, ad] of PAIRS) {
    expect(isCanonical(run("std:ratNeg", { a: mkRat(an, ad) }))).toBe(true);
    for (const [bn, bd] of PAIRS) {
      const a = mkRat(an, ad);
      const b = mkRat(bn, bd);
      expect(isCanonical(run("std:ratAdd", { a, b }))).toBe(true);
      expect(isCanonical(run("std:ratSub", { a, b }))).toBe(true);
      expect(isCanonical(run("std:ratMul", { a, b }))).toBe(true);
      expect(isCanonical(run("std:ratDiv", { a, b }))).toBe(true);
    }
  }
}, SLOW);

// ---------------------------------------------------------------------------
// natGcd — Euclid over Nat.
// ---------------------------------------------------------------------------

const toNat = (x: number) => run("std:numberToNat", { n: x });
const natToNum = (n: unknown) => run("std:natToNumber", { n }) as number;

test("natGcd computes the gcd over Nat (incl. gcd a 0 = a)", () => {
  const cases: Array<[number, number]> = [
    [12, 8], [8, 12], [7, 1], [0, 5], [5, 0], [6, 9], [17, 13], [100, 60], [0, 0],
  ];
  for (const [a, b] of cases) {
    expect(natToNum(run("std:natGcd", { a: toNat(a), b: toNat(b) }))).toBe(jsGcd(a, b));
  }
});

// ---------------------------------------------------------------------------
// D8 iso — Rational ↔ ℚ refinement view on the exact carrier. The witnesses
// normalize admitted Rational values; fractions never cross through Number.
// ---------------------------------------------------------------------------

test("D8 iso — exact Rational refinement round-trips preserve fractions and large integer parts", () => {
  const samples = [
    { r: mkRat(1, 3), num: "1", den: "3" },
    { r: mkRat(-3, 2), num: "-3", den: "2" },
    { r: mkRat(0, 1), num: "0", den: "1" },
    { r: { $tag: "Rational", num: "2", den: "4" }, num: "1", den: "2" },
    { r: { $tag: "Rational", num: "9007199254740993123456789012345678901", den: "2" }, num: "9007199254740993123456789012345678901", den: "2" },
  ];
  for (const { r, num, den } of samples) {
    const expected = { $tag: "RationalRepresentation", num, den };
    const refined = call1("std:ratToRefined", r);
    const back = call1("std:ratFromRefined", refined);
    expect(call1("std:rationalRepresentationParts", refined)).toEqual(expected);
    expect(call1("std:rationalRepresentationParts", back)).toEqual(expected);
    expect(call1("std:rationalRepresentationParts", call1("std:ratToRefined", call1("std:ratFromRefined", refined)))).toEqual(expected);
    expect(call1("std:boolToNative", evaluate({ call: ["std:ratEq", { var: "a" }, { var: "b" }] }, { a: r, b: back }, ctx))).toBe(true);
  }
});

// ---------------------------------------------------------------------------
// `Reprable JsRuntime Rational` uses exact integer-string ratio parts. Keyed
// off the instance's DECLARED method fnIds, so the laws exercise its registered
// representation crossing rather than the separate approximate Number bridge.
// ---------------------------------------------------------------------------

const reprableRational = () => {
  const i = [...dispatchRegistry.listInstances("Reprable")].find(
    (x) => x.args[0] === "JsRuntime" && x.args[1] === "Rational",
  );
  if (!i) throw new Error("Reprable JsRuntime Rational instance not registered");
  return i;
};

test("Reprable JsRuntime Rational — instance projected with exact native type-ref + bridge lift/lower", () => {
  const r = reprableRational();
  expect(r.typeName).toBe("Reprable");
  expect(r.args).toEqual(["JsRuntime", "Rational"]);
  expect(r.methods.native).toEqual({ $ref: "RationalRepresentation" });
  expect(r.methods.lift).toEqual({ $ref: "std.rationalRepresentationParts" });
  expect(r.methods.lower).toEqual({ $ref: "std.rationalRepresentationLower" });
});

test("Reprable JsRuntime Rational — declared lift/lower preserve canonical exact fractions and large integer parts", () => {
  const inst = reprableRational();
  const liftFn = declaredId(inst.methods.lift);
  const lowerFn = declaredId(inst.methods.lower);
  const samples = [
    { $tag: "RationalRepresentation", num: "0", den: "1" },
    { $tag: "RationalRepresentation", num: "1", den: "3" },
    { $tag: "RationalRepresentation", num: "-1", den: "7" },
    { $tag: "RationalRepresentation", num: "9007199254740993123456789012345678901", den: "2" },
  ];
  for (const parts of samples) {
    const rational = call1(lowerFn, parts);
    // lower exposes a semantic Rational with represented Int/Nat children;
    // exact transfer identity is checked by re-lifting rather than byte shape.
    expect(rational).toHaveProperty("$tag", "Rational");
    expect(call1(liftFn, rational)).toEqual(parts);
    const canonical = call1("std:rationalFromRepresentationParts", parts);
    expect(call1("std:boolToNative", evaluate({ call: ["std:ratEq", { var: "a" }, { var: "b" }] }, { a: rational, b: canonical }, ctx))).toBe(true);
  }
  for (const k of INTS) {
    // The materialized pure value returns through the same exact transfer.
    const p = mkRat(k, 1);
    const parts = { $tag: "RationalRepresentation", num: String(k), den: "1" };
    expect(call1(liftFn, p)).toEqual(parts);
    const back = call1(lowerFn, call1(liftFn, p));
    expect(call1(liftFn, back)).toEqual(parts);
    expect(call1("std:boolToNative", evaluate({ call: ["std:ratEq", { var: "a" }, { var: "b" }] }, { a: p, b: back }, ctx))).toBe(true);
  }
  for (const [num, den] of [[1, 3], [-1, 7], [2, 4]]) {
    const p = mkRat(num!, den!);
    const expected = jsRat(num!, den!);
    const parts = { $tag: "RationalRepresentation", num: String(expected.num), den: String(expected.den) };
    expect(call1(liftFn, p)).toEqual(parts);
    expect(call1(liftFn, call1(lowerFn, call1(liftFn, p)))).toEqual(parts);
  }
});
