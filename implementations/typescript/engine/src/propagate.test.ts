// unified-static-analysis Phase 3b-1 — PARITY + round-trip tests for the
// forward-propagation port. Brief:
// `workstreams/unified-static-analysis/briefs/phase-3b-1-propagate-and-setmarker-roundtrip.md`.
//
// Two things under test:
//   1. `propagate` (propagate.ts) — the thin marshal seam over the Fenel
//      `engine:propagate` body. The historical oracle retains the scalar enum
//      fragment and explicitly re-pins interval transfers that cannot certify
//      raw scalar carriers after exact Nat/Int admission.
//   2. The `setExprToTag` boundary (decide-substrate Phase 1 Stage E replaced
//      the retired `Sm*` round-trip) — the foundation every inference seam
//      reuses: `toTag ≡ identity up to normalize` on the fragment, the `$where`
//      pred preserved verbatim, `$ref` dual-read.

import { describe, it, expect } from "vitest";
import { propagate } from "./propagate";
import { peelSetExpr, setExprToTag } from "./set-marker";
import { contains, normalize } from "./set-algebra";
import { stdNatives } from "../../../../fenel/modules/std/ffi/std-ffi";
import { Just, Nothing } from "./type-foundation";
import type { SetExpr, Interval } from "./types";
import { isSetExpr } from "./types";
import { setExprToDollarKey } from "./set-marker";

// set-algebra-to-fenel Phase 3b-2 — a few propagate arms delegate to the flipped
// `sets.*` producers (now `$tag`), while the verbatim pre-port oracle stays
// `$`-key. `cf` folds the migrating `$tag` SetExpr form back to `$`-key (deeply,
// recursing into nested SetExprs) so the byte-parity stays a LOGIC check. A real
// structural/value regression still fails. The sanctioned test-oracle re-pin.
function cf(x: unknown): unknown {
  if (Array.isArray(x)) return x.map(cf);
  if (x && typeof x === "object") {
    const sx = isSetExpr(x) ? setExprToDollarKey(x as SetExpr) : x;
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(sx as object)) out[k] = cf(v);
    return out;
  }
  return x;
}

// ===========================================================================
// The pre-port TS logic, reproduced verbatim as the parity oracle.
// ===========================================================================

type NumBound = { value: number; inclusive: boolean };

function oNumLo(iv: Interval): NumBound {
  if (iv.lo.$tag === "Nothing") return { value: -Infinity, inclusive: false };
  const v = iv.lo._0.value;
  if (typeof v === "object") return { value: -Infinity, inclusive: false };
  return { value: v as number, inclusive: iv.lo._0.inclusive };
}
function oNumHi(iv: Interval): NumBound {
  if (iv.hi.$tag === "Nothing") return { value: Infinity, inclusive: false };
  const v = iv.hi._0.value;
  if (typeof v === "object") return { value: Infinity, inclusive: false };
  return { value: v as number, inclusive: iv.hi._0.inclusive };
}
function oPoint(v: number): Interval {
  return { lo: Just({ value: v, inclusive: true }), hi: Just({ value: v, inclusive: true }) };
}
function oIvOp(_op: string, _a: Interval, _b: Interval): SetExpr {
  // Interval membership includes integer records; raw arithmetic coerces them
  // to zero. The scalar endpoint oracle no longer bounds all admitted inputs.
  return { $tag: "SeAll" };
}
function oArith(op: string, a: number, b: number): number | undefined {
  switch (op) {
    case "+": return a + b;
    case "-": return a - b;
    case "*": return a * b;
    case "/": return b === 0 ? undefined : a / b;
    case "%": return b === 0 ? undefined : a % b;
    default: return undefined;
  }
}
function oCompareIv(op: string, a: Interval, b: Interval): SetExpr {
  const aL = oNumLo(a), aH = oNumHi(a), bL = oNumLo(b), bH = oNumHi(b);
  switch (op) {
    case ">":
      if (aL.value > bH.value) return { $tag: "SeEnum", values: [true, false] };
      if (aH.value < bL.value || (aH.value === bL.value && (!aH.inclusive || !bL.inclusive)))
        return { $tag: "SeEnum", values: [false] };
      break;
    case ">=":
      if (aL.value > bH.value || (aL.value === bH.value && aL.inclusive && bH.inclusive))
        return { $tag: "SeEnum", values: [true, false] };
      if (aH.value < bL.value) return { $tag: "SeEnum", values: [false] };
      break;
    case "<":
      if (aH.value < bL.value) return { $tag: "SeEnum", values: [true, false] };
      if (aL.value > bH.value || (aL.value === bH.value && aL.inclusive && bH.inclusive))
        return { $tag: "SeEnum", values: [false] };
      break;
    case "<=":
      if (aH.value < bL.value || (aH.value === bL.value && aH.inclusive && bL.inclusive))
        return { $tag: "SeEnum", values: [true, false] };
      if (aL.value > bH.value) return { $tag: "SeEnum", values: [false] };
      break;
  }
  return { $tag: "SeEnum", values: [true, false] };
}
const O_CANONICAL: Record<string, string> = {
  "ℕ": "ℕ", Nat: "ℕ", "ℤ": "ℤ", Int: "ℤ", "ℚ": "ℚ", Rational: "ℚ", "ℝ": "ℝ", Real: "ℝ",
};
const O_ORDER = ["ℕ", "ℤ", "ℚ", "ℝ"];
function oWider(a: string, b: string): string {
  const ia = O_ORDER.indexOf(O_CANONICAL[a] ?? "ℝ");
  const ib = O_ORDER.indexOf(O_CANONICAL[b] ?? "ℝ");
  return O_ORDER[Math.max(ia, ib)] ?? "ℝ";
}
function oNamedArith(op: string, a: string, b: string): SetExpr {
  if (!(a in O_CANONICAL) || !(b in O_CANONICAL)) return { $tag: "SeAll" };
  const w = oWider(a, b);
  switch (op) {
    case "+": case "*": case "%": return { $tag: "SeRef", handle: w };
    case "-": return { $tag: "SeRef", handle: w === "ℕ" ? "ℤ" : w };
    case "/": return { $tag: "SeRef", handle: w === "ℕ" || w === "ℤ" ? "ℚ" : w };
    default: return { $tag: "SeAll" };
  }
}
function oConcatSets(a: SetExpr, b: SetExpr): SetExpr {
  const av = peelSetExpr(a);
  const bv = peelSetExpr(b);
  if (av?.kind === "SeEnum" && bv?.kind === "SeEnum") {
    const r: unknown[] = [];
    for (const va of av.values)
      for (const vb of bv.values)
        if (typeof va === "string" && typeof vb === "string") r.push(va + vb);
    return r.length ? { $tag: "SeEnum", values: r } : { $tag: "SeNone" };
  }
  return { $tag: "SeRef", handle: "String" };
}
function oBinaryArith(op: string, a: SetExpr, b: SetExpr): SetExpr {
  const av = peelSetExpr(a);
  const bv = peelSetExpr(b);
  const aH = av?.kind === "SeRef" ? av.handle : undefined;
  const bH = bv?.kind === "SeRef" ? bv.handle : undefined;
  if (av?.kind === "SeAll" || bv?.kind === "SeAll") return { $tag: "SeAll" };
  if (av?.kind === "SeNone" || bv?.kind === "SeNone") return { $tag: "SeNone" };
  if (av?.kind === "SeUnion") return normalize({ $tag: "SeUnion", branches: av.branches.map((s) => oBinaryArith(op, s, b)) });
  if (bv?.kind === "SeUnion") return normalize({ $tag: "SeUnion", branches: bv.branches.map((s) => oBinaryArith(op, a, s)) });
  if (av?.kind === "SeIntersect") return normalize({ $tag: "SeIntersect", branches: av.branches.map((s) => oBinaryArith(op, s, b)) });
  if (bv?.kind === "SeIntersect") return normalize({ $tag: "SeIntersect", branches: bv.branches.map((s) => oBinaryArith(op, a, s)) });
  if (av?.kind === "SeInterval" && bv?.kind === "SeInterval") return oIvOp(op, av.interval, bv.interval);
  if (av?.kind === "SeEnum" && bv?.kind === "SeEnum") {
    const r = new Set<unknown>();
    for (const va of av.values)
      for (const vb of bv.values)
        if (typeof va === "number" && typeof vb === "number") {
          const v = oArith(op, va, vb);
          if (v !== undefined && Number.isFinite(v)) r.add(v);
        }
    return r.size ? { $tag: "SeEnum", values: [...r] } : { $tag: "SeNone" };
  }
  if (av?.kind === "SeEnum" && bv?.kind === "SeInterval") {
    const parts: SetExpr[] = [];
    for (const v of av.values) if (typeof v === "number") parts.push(oIvOp(op, oPoint(v), bv.interval));
    return parts.length ? normalize({ $tag: "SeUnion", branches: parts }) : { $tag: "SeNone" };
  }
  if (av?.kind === "SeInterval" && bv?.kind === "SeEnum") {
    const parts: SetExpr[] = [];
    for (const v of bv.values) if (typeof v === "number") parts.push(oIvOp(op, av.interval, oPoint(v)));
    return parts.length ? normalize({ $tag: "SeUnion", branches: parts }) : { $tag: "SeNone" };
  }
  if (aH !== undefined && bH !== undefined) return oNamedArith(op, aH, bH);
  if (aH !== undefined && (bv?.kind === "SeInterval" || bv?.kind === "SeEnum"))
    return aH in O_CANONICAL ? oNamedArith(op, aH, aH) : { $tag: "SeAll" };
  if (bH !== undefined && (av?.kind === "SeInterval" || av?.kind === "SeEnum"))
    return bH in O_CANONICAL ? oNamedArith(op, bH, bH) : { $tag: "SeAll" };
  return { $tag: "SeAll" };
}
function oBinaryCompare(op: string, a: SetExpr, b: SetExpr): SetExpr {
  const av = peelSetExpr(a);
  const bv = peelSetExpr(b);
  if (av?.kind === "SeNone" || bv?.kind === "SeNone") return { $tag: "SeNone" };
  if (av?.kind === "SeUnion") return normalize({ $tag: "SeUnion", branches: av.branches.map((s) => oBinaryCompare(op, s, b)) });
  if (bv?.kind === "SeUnion") return normalize({ $tag: "SeUnion", branches: bv.branches.map((s) => oBinaryCompare(op, a, s)) });
  if (av?.kind === "SeInterval" && bv?.kind === "SeInterval") return oCompareIv(op, av.interval, bv.interval);
  if (av?.kind === "SeEnum" && bv?.kind === "SeEnum") {
    const results = new Set<boolean>();
    const cmp = (va: unknown, vb: unknown): boolean | undefined => {
      if (typeof va !== "number" || typeof vb !== "number") return undefined;
      switch (op) {
        case ">": return va > vb;
        case ">=": return va >= vb;
        case "<": return va < vb;
        case "<=": return va <= vb;
        case "==": return va == vb;
        case "===": return va === vb;
        case "!=": return va != vb;
        case "!==": return va !== vb;
        default: return undefined;
      }
    };
    for (const va of av.values)
      for (const vb of bv.values) {
        const r = cmp(va, vb);
        if (r !== undefined) results.add(r);
      }
    if (results.size === 1) return { $tag: "SeEnum", values: [[...results][0]] };
    return { $tag: "SeEnum", values: [true, false] };
  }
  return { $tag: "SeEnum", values: [true, false] };
}
function oUnary(op: string, a: SetExpr): SetExpr {
  const av = peelSetExpr(a);
  if (av?.kind === "SeNone") return { $tag: "SeNone" };
  if (av?.kind === "SeUnion") return normalize({ $tag: "SeUnion", branches: av.branches.map((s) => oUnary(op, s)) });
  switch (op) {
    case "-":
    case "negate": {
      if (av?.kind === "SeInterval") {
        return { $tag: "SeAll" };
      }
      if (av?.kind === "SeEnum") return { $tag: "SeEnum", values: av.values.map((v) => (typeof v === "number" ? -v : v)) };
      {
        const aH = av?.kind === "SeRef" ? av.handle : undefined;
        if (aH !== undefined) {
          const c = O_CANONICAL[aH];
          if (c === "ℕ") return { $tag: "SeRef", handle: "ℤ" };
          if (c) return { $tag: "SeRef", handle: aH };
        }
      }
      return { $tag: "SeAll" };
    }
    case "!":
    case "not":
      if (av?.kind === "SeEnum") return { $tag: "SeEnum", values: av.values.map((v) => !v) };
      return { $tag: "SeEnum", values: [true, false] };
    default:
      return { $tag: "SeAll" };
  }
}
function oMinMax(_op: "min" | "max", inputs: SetExpr[]): SetExpr {
  if (inputs.length === 0) return { $tag: "SeNone" };
  if (inputs.length === 1) return inputs[0]!;
  const ivs = inputs
    .map((s) => peelSetExpr(s))
    .filter((v): v is Extract<NonNullable<ReturnType<typeof peelSetExpr>>, { kind: "SeInterval" }> => v?.kind === "SeInterval");
  if (ivs.length === inputs.length) {
    return { $tag: "SeAll" };
  }
  return { $tag: "SeAll" };
}
const O_ARITH = new Set(["+", "-", "*", "/", "%"]);
const O_CMP = new Set([">", ">=", "<", "<=", "==", "!=", "===", "!=="]);
function oraclePropagate(op: string, ...inputs: SetExpr[]): SetExpr {
  if (inputs.length === 1) return normalize(oUnary(op, inputs[0]!));
  if (op === "min" || op === "max") return normalize(oMinMax(op, inputs));
  if (inputs.length >= 2) {
    const [a, b] = inputs as [SetExpr, SetExpr];
    if (O_ARITH.has(op)) return normalize(oBinaryArith(op, a!, b!));
    if (O_CMP.has(op)) return normalize(oBinaryCompare(op, a!, b!));
    if (op === "cat") return inputs.reduce((acc, s) => normalize(oConcatSets(acc, s)));
  }
  return { $tag: "SeAll" };
}

// ===========================================================================
// Corpus builders
// ===========================================================================

const S = (...vs: unknown[]): SetExpr => ({ $tag: "SeEnum", values: vs });
const ivl = (lo: number | null, hi: number | null, loInc = true, hiInc = true): SetExpr => ({ $tag: "SeInterval", interval: {
    lo: lo === null ? Nothing : Just({ value: lo, inclusive: loInc }),
    hi: hi === null ? Nothing : Just({ value: hi, inclusive: hiInc }),
  } });
const ref = (n: string): SetExpr => ({ $tag: "SeRef", handle: n });
const W: SetExpr = { $where: { ">": [{ var: "value" }, 0] } } as unknown as SetExpr;

// ===========================================================================
// Stage 1 — BYTE-PARITY: the seam `propagate` === the pre-port oracle
// ===========================================================================

type Case = [string, string, SetExpr[]];

const ARITH_CORPUS: Case[] = [];
for (const op of ["+", "-", "*", "/", "%"]) {
  ARITH_CORPUS.push(
    [`${op}: interval × interval`, op, [ivl(2, 5), ivl(1, 3)]],
    [`${op}: interval × interval (neg corners)`, op, [ivl(-2, 3), ivl(-4, 1)]],
    [`${op}: interval × interval (unbounded lo)`, op, [ivl(null, 5), ivl(1, 3)]],
    [`${op}: interval × interval (unbounded hi)`, op, [ivl(2, null), ivl(1, 3)]],
    [`${op}: interval × interval (exclusive bounds)`, op, [ivl(2, 5, false, false), ivl(1, 3, false, true)]],
    [`${op}: interval × interval (straddle-zero divisor)`, op, [ivl(2, 5), ivl(-1, 1)]],
    [`${op}: interval × interval (inclusive-zero divisor)`, op, [ivl(2, 5), ivl(0, 3)]],
    [`${op}: interval × interval (exclusive-zero divisor)`, op, [ivl(2, 5), ivl(0, 3, false, true)]],
    [`${op}: interval × interval (neg dividend mod)`, op, [ivl(-7, -2), ivl(1, 3)]],
    [`${op}: enum × enum`, op, [S(1, 2, 3), S(2, 4)]],
    [`${op}: enum × enum (÷0 filtered)`, op, [S(1, 2), S(0, 2)]],
    [`${op}: enum × enum (dup collapse)`, op, [S(1, 2, 3), S(0)]],
    [`${op}: enum × interval`, op, [S(1, 2), ivl(0, 4)]],
    [`${op}: interval × enum`, op, [ivl(0, 4), S(1, 2)]],
    [`${op}: named × named (ℕ,ℤ)`, op, [ref("ℕ"), ref("ℤ")]],
    [`${op}: named × named (ℤ,ℚ)`, op, [ref("ℤ"), ref("ℚ")]],
    [`${op}: named × named (Nat,Real aliases)`, op, [ref("Nat"), ref("Real")]],
    [`${op}: named × interval`, op, [ref("ℤ"), ivl(0, 4)]],
    [`${op}: interval × named`, op, [ivl(0, 4), ref("ℤ")]],
    [`${op}: non-tower named × interval`, op, [ref("String"), ivl(0, 4)]],
    [`${op}: union × enum (distribute)`, op, [{ $tag: "SeUnion", branches: [S(1), S(2)] }, S(10)]],
    [`${op}: enum × union (distribute)`, op, [S(10), { $tag: "SeUnion", branches: [S(1), S(2)] }]],
    [`${op}: intersect × enum (distribute)`, op, [{ $tag: "SeIntersect", branches: [ivl(0, 10), ivl(2, 5)] }, S(1)]],
    [`${op}: $all absorb`, op, [{ $tag: "SeAll" }, S(1)]],
    [`${op}: $none absorb`, op, [{ $tag: "SeNone" }, S(1)]],
    [`${op}: $where opaque ⇒ all`, op, [W, S(1)]],
  );
}

const CMP_CORPUS: Case[] = [];
for (const op of [">", ">=", "<", "<=", "==", "!=", "===", "!=="]) {
  CMP_CORPUS.push(
    [`${op}: interval proven-separated`, op, [ivl(0, 2), ivl(5, 8)]],
    [`${op}: interval proven-other-way`, op, [ivl(5, 8), ivl(0, 2)]],
    [`${op}: interval touching (inclusive)`, op, [ivl(0, 5), ivl(5, 8)]],
    [`${op}: interval touching (exclusive)`, op, [ivl(0, 5, true, false), ivl(5, 8, false, true)]],
    [`${op}: interval overlapping ⇒ undecided`, op, [ivl(0, 6), ivl(5, 8)]],
    [`${op}: enum × enum proven`, op, [S(1, 2), S(8, 9)]],
    [`${op}: enum × enum mixed`, op, [S(1, 9), S(5)]],
    [`${op}: enum × enum equal`, op, [S(5), S(5)]],
    [`${op}: union distribute`, op, [{ $tag: "SeUnion", branches: [ivl(0, 2), ivl(5, 8)] }, ivl(5, 8)]],
    [`${op}: $none absorb`, op, [{ $tag: "SeNone" }, S(1)]],
    [`${op}: enum × interval ⇒ undecided`, op, [S(1, 2), ivl(0, 4)]],
  );
}

const UNARY_CORPUS: Case[] = [];
for (const op of ["-", "negate", "!", "not"]) {
  UNARY_CORPUS.push(
    [`${op}: interval`, op, [ivl(2, 5)]],
    [`${op}: interval (unbounded hi)`, op, [ivl(2, null)]],
    [`${op}: enum numbers`, op, [S(1, -2, 3)]],
    [`${op}: enum booleans`, op, [S(true, false)]],
    [`${op}: named ℕ`, op, [ref("ℕ")]],
    [`${op}: named ℤ`, op, [ref("ℤ")]],
    [`${op}: named Nat alias`, op, [ref("Nat")]],
    [`${op}: non-tower named`, op, [ref("String")]],
    [`${op}: union distribute`, op, [{ $tag: "SeUnion", branches: [ivl(2, 5), S(1, 2)] }]],
    [`${op}: $none`, op, [{ $tag: "SeNone" }]],
    [`${op}: $all`, op, [{ $tag: "SeAll" }]],
  );
}

const MISC_CORPUS: Case[] = [
  ["min: intervals", "min", [ivl(2, 5), ivl(1, 8), ivl(3, 4)]],
  ["max: intervals", "max", [ivl(2, 5), ivl(1, 8), ivl(3, 4)]],
  ["min: unbounded mix", "min", [ivl(null, 5), ivl(1, 8)]],
  ["max: unbounded mix", "max", [ivl(2, null), ivl(1, 8)]],
  ["min: single", "min", [ivl(2, 5)]],
  ["min: mixed (non-interval) ⇒ all", "min", [ivl(2, 5), S(1, 2)]],
  ["min: empty ⇒ none", "min", []],
  ["cat: enum × enum strings", "cat", [S("a", "b"), S("x", "y")]],
  ["cat: enum × enum (3-way)", "cat", [S("a"), S("b"), S("c")]],
  ["cat: enum × non-enum ⇒ String", "cat", [S("a"), ivl(0, 4)]],
  ["cat: non-string enum ⇒ none", "cat", [S(1, 2), S("x")]],
  ["unknown op ⇒ all", "frobnicate", [S(1), S(2)]],
];

describe("propagate — BYTE-PARITY with the pre-port oracle (arithmetic)", () => {
  for (const [name, op, inputs] of ARITH_CORPUS) {
    it(name, () => {
      expect(cf(propagate(op, ...inputs))).toEqual(cf(oraclePropagate(op, ...inputs)));
    });
  }
});

describe("propagate — BYTE-PARITY with the pre-port oracle (comparison)", () => {
  for (const [name, op, inputs] of CMP_CORPUS) {
    it(name, () => {
      expect(cf(propagate(op, ...inputs))).toEqual(cf(oraclePropagate(op, ...inputs)));
    });
  }
});

describe("propagate — BYTE-PARITY with the pre-port oracle (unary)", () => {
  for (const [name, op, inputs] of UNARY_CORPUS) {
    it(name, () => {
      expect(cf(propagate(op, ...inputs))).toEqual(cf(oraclePropagate(op, ...inputs)));
    });
  }
});

describe("propagate — BYTE-PARITY with the pre-port oracle (min/max/cat/misc)", () => {
  for (const [name, op, inputs] of MISC_CORPUS) {
    it(name, () => {
      expect(cf(propagate(op, ...inputs))).toEqual(cf(oraclePropagate(op, ...inputs)));
    });
  }
});

describe("propagate — output containment with exact integer interval carriers", () => {
  const three = { $tag: "Succ", _0: { $tag: "Succ", _0: { $tag: "Succ", _0: { $tag: "Zero" } } } };
  // integerBoxMembership admits digit carriers only beyond safe Number
  // capacity. Their interval uses a safe endpoint and no finite upper bound.
  const records = [
    ["boxed Nat", { $tag: "Nat", digits: "9007199254740992" }, ivl(2, null), S(true, false)],
    ["boxed Int", { $tag: "Int", digits: "9007199254740992" }, ivl(2, null), S(true, false)],
    ["pure Nat", three, ivl(2, 5), S(false)],
    ["pure Int", { $tag: "Int", negative: false, magnitude: three }, ivl(2, 5), S(false)],
  ] as const;

  for (const [name, value, input, reverseLess] of records) {
    for (const [op, native] of [["+", "add"], ["-", "sub"], ["*", "mul"], ["/", "div"]] as const) {
      it(`${name}: ${op} keeps the actual coercing output`, () => {
        expect(contains(input, value, null)).toEqual(Just(true));
        const actual = stdNatives[native]!(value, 1);
        expect(contains(propagate(op, input, S(1)), actual, null)).toEqual(Just(true));
        expect(contains(propagate(op, S(1), input), stdNatives[native]!(1, value), null)).toEqual(Just(true));
      });
    }

    it(`${name}: interval negation and minimum keep zero`, () => {
      expect(contains(input, value, null)).toEqual(Just(true));
      const negative = stdNatives.sub!(0, value);
      expect(negative).toBe(0);
      expect(contains(propagate("negate", input), negative, null)).toEqual(Just(true));
      const minimum = stdNatives.min!(value, 4);
      expect(minimum).toBe(0);
      expect(contains(propagate("min", input, ivl(4, 8)), minimum, null)).toEqual(Just(true));
    });

    for (const [op, native, other, scalar, reversed] of [
      ["<", "lt", ivl(8, 10), 9, reverseLess],
      ["<=", "lte", ivl(8, 10), 9, reverseLess],
      [">", "gt", ivl(-2, 0), -1, S(false)],
      [">=", "gte", ivl(-2, 0), -1, S(false)],
    ] as const) {
      it(`${name}: ${op} includes both scalar and record execution`, () => {
        expect(contains(input, value, null)).toEqual(Just(true));
        const output = propagate(op, input, other);
        const recordResult = stdNatives[native]!(value, scalar);
        const scalarResult = stdNatives[native]!(3, scalar);
        expect(recordResult).toBe(false);
        expect(scalarResult).toBe(true);
        expect(contains(output, recordResult, null)).toEqual(Just(true));
        expect(contains(output, scalarResult, null)).toEqual(Just(true));
        // A boxed carrier's input has no upper bound, so reversing < or <=
        // remains undecided; finite pure-spine intervals still prove false.
        expect(propagate(op, other, input)).toEqual(reversed);
      });
    }
  }

  it("negative integer record coercion stays in the maximum result", () => {
    const negative = { $tag: "Int", digits: "-9007199254740992" };
    const input = ivl(null, -2);
    expect(contains(input, negative, null)).toEqual(Just(true));
    const actual = stdNatives.max!(negative, -6);
    expect(actual).toBe(0);
    expect(contains(propagate("max", input, ivl(-8, -4)), actual, null)).toEqual(Just(true));
  });

  it("finite native enum witnesses retain arithmetic and ordering precision", () => {
    expect(propagate("+", S(3), S(1))).toEqual(S(4));
    expect(propagate("<", S(3), S(9))).toEqual(S(true));
  });

  it("string interval separation still proves true", () => {
    const left: SetExpr = { $tag: "SeInterval", interval: { lo: Just({ value: "a", inclusive: true }), hi: Just({ value: "b", inclusive: true }) } };
    const right: SetExpr = { $tag: "SeInterval", interval: { lo: Just({ value: "d", inclusive: true }), hi: Just({ value: "e", inclusive: true }) } };
    expect(contains(left, "b", null)).toEqual(Just(true));
    expect(contains(right, "d", null)).toEqual(Just(true));
    expect(propagate("<", left, right)).toEqual(S(true));
    expect(propagate("<=", left, right)).toEqual(S(true));
    expect(propagate(">", right, left)).toEqual(S(true));
    expect(propagate(">=", right, left)).toEqual(S(true));
  });
});

// ===========================================================================
// Stage 2 → Stage E — the boundary foundation. The `Sm*` SetMarker round-trip
// (`marshalSet`/`unmarshalSet`) is RETIRED (decide-substrate Phase 1 Stage E);
// the surviving boundary is `setExprToTag` (the dual-read `$tag` normalize the
// inference seams pass inputs through). Same characterization properties,
// re-pinned onto the surviving boundary.
// ===========================================================================

describe("setExprToTag boundary — toTag ≡ identity up to normalize", () => {
  const FRAGMENT: Array<[string, SetExpr]> = [
    ["$all", { $tag: "SeAll" }],
    ["$none", { $tag: "SeNone" }],
    ["enum", S(1, 2, 3)],
    ["interval (bounded)", ivl(0, 10)],
    ["interval (unbounded lo)", ivl(null, 10)],
    ["interval (exclusive)", ivl(0, 10, false, false)],
    ["ref", ref("ℤ")],
    ["union", { $tag: "SeUnion", branches: [S(1), ivl(0, 4)] }],
    ["intersect", { $tag: "SeIntersect", branches: [ivl(0, 10), ivl(2, 5)] }],
    ["diff", { $tag: "SeDiff", left: S(1, 2, 3), right: S(3) }],
    ["nested union/interval", { $tag: "SeUnion", branches: [ivl(0, 2), { $tag: "SeUnion", branches: [S(5), ref("ℝ")] }] }],
  ];
  for (const [name, set] of FRAGMENT) {
    it(name, () => {
      const tagged = setExprToTag(set);
      expect(normalize(tagged)).toEqual(normalize(set));
    });
  }

  it("setExprToTag preserves a $where pred verbatim", () => {
    const tagged = setExprToTag(W) as unknown as { $tag: string; pred: unknown };
    expect(tagged.$tag).toEqual("SeWhere");
    expect(tagged.pred).toEqual((W as unknown as { $where: unknown }).$where);
  });

  it("$ref tags to the same SeRef as $ref (refHandle dual-read)", () => {
    const viaNamed = setExprToTag({ $ref: "ℤ" } as unknown as SetExpr);
    const viaRef = setExprToTag(ref("ℤ"));
    expect(viaNamed).toEqual(viaRef);
  });
});
