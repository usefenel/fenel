// ---------------------------------------------------------------------------
// containment-substrate Phase 2 Step 3 — the glyph → `Symbolable` subsumption
// (design §10.3). CLOSES Phase 2.
//
// The math glyphs (`∪`/`∩`/`¬`/`\`) were hardcoded string literals in two emit
// surfaces (`set-syntax.fenel:formatSetExpr` + the frontend `ExpressionDisplay.tsx`)
// — a per-former Fenel fact encoded in formatter source ([[feedback_no_language_
// concept_in_ts]]). This step retires them into ONE `Symbolable` projection:
// per-former glyph instances (fenel/std/dispatch-instances.fenel), resolved by
// `engine:getSymbol`, routed by both emit surfaces.
//
// Two assertion blocks:
//   1. `getSymbol`/`Symbolable` resolution — every registered former resolves to
//      its glyph; a miss returns undefined.
//   2. The CHARACTERIZATION NET — `formatSetExpr` glyph output BYTE-IDENTICAL to
//      the pre-routing literals (the load-bearing guard: this is a ROUTING change,
//      not a rendering change). Mirrors the Phase-1a render-harvest precedent.
// ---------------------------------------------------------------------------

import { test, expect, describe } from "bun:test";
import { dispatchedGetSymbol } from "./engine-bodies-dispatch";
import { formatSetExpr } from "./set-syntax";

// Hand-built canonical `$tag` Se* values (the form the formatter walks).
const tag = (t: string, o: Record<string, unknown> = {}) => ({ $tag: t, ...o });
const ref = (h: string) => tag("SeRef", { handle: h });
const enm = (vs: unknown[]) => tag("SeEnum", { values: vs });
const union = (...bs: unknown[]) => tag("SeUnion", { branches: bs });
const inter = (...bs: unknown[]) => tag("SeIntersect", { branches: bs });
const compl = (inner: unknown) => tag("SeComplement", { inner });
const diff = (left: unknown, right: unknown) => tag("SeDiff", { left, right });

describe("containment-substrate Phase 2 Step 3 — Symbolable resolves every former glyph", () => {
  const expected: Record<string, string> = {
    union: "∪",
    intersect: "∩",
    complement: "¬",
    diff: "\\",
    top: "⊤",
    bottom: "⊥",
    arrow: "→",
  };
  for (const [former, glyph] of Object.entries(expected)) {
    test(`getSymbol "${former}" = "${glyph}"`, () => {
      expect(dispatchedGetSymbol(former)).toBe(glyph);
    });
  }
  test("getSymbol on an unregistered former returns undefined (Nothing)", () => {
    expect(dispatchedGetSymbol("not-a-former")).toBeUndefined();
  });
});

describe("containment-substrate Phase 2 Step 3 — formatSetExpr glyph output is BYTE-IDENTICAL after routing", () => {
  // The named-set display aliases (ℕ/ℤ/ℝ) are unchanged; the GLYPH between/around
  // them is now resolved through Symbolable. Each expected string is the exact
  // pre-routing output (the characterization net).
  const cases: Array<[string, unknown, string]> = [
    ["union", union(ref("Nat"), ref("Int")), "ℕ ∪ ℤ"],
    ["n-ary union", union(ref("Nat"), ref("Int"), ref("Real")), "ℕ ∪ ℤ ∪ ℝ"],
    ["intersect", inter(ref("Nat"), enm([1, 2, 3])), "ℕ ∩ {1, 2, 3}"],
    ["complement", compl(ref("Nat")), "¬ℕ"],
    ["diff", diff(ref("Int"), ref("Nat")), "ℤ \\ ℕ"],
    ["union inside intersect (parens)", inter(union(ref("Nat"), ref("Int")), ref("Real")), "(ℕ ∪ ℤ) ∩ ℝ"],
    ["complement of union (parens)", compl(union(ref("Nat"), ref("Int"))), "¬(ℕ ∪ ℤ)"],
    ["diff of complement", diff(ref("Int"), compl(ref("Nat"))), "ℤ \\ ¬ℕ"],
  ];
  for (const [name, expr, want] of cases) {
    test(`formatSetExpr(${name}) = ${JSON.stringify(want)}`, () => {
      expect(formatSetExpr(expr as never)).toBe(want);
    });
  }
});
