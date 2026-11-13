// expr-substrate Phase 12 — conformance tests for the AFFINE WIDENING of the
// ONE shared recognizer fragment (brief:
// `workstreams/expr-substrate/briefs/phase-12-decidable-arithmetic.md`).
// Re-pinned for decide-substrate Phase 1 Stage B: the recognizer is
// `engine:comprehend` (predicateToSet is retired) and the representation is
// the canonical `Se*` SetExpr.
//
// P7 shipped `refine` over the ONE shared predicate fragment; P5 owns
// `solve`/`solveFn`. P12 widens that fragment so a COMPOUND affine term
// `coeff·x + k` on either/both sides inverts to the witness: the headline
// `solveFn (\x -> 2*x + 5 == 6)` ⇒ Just 0.5. The widening lives as the
// FALL-THROUGH of comprehend's eq/compare arms — the bare var-vs-lit arms
// fire FIRST, and only their miss tries the affine path. BOTH consumers
// (solve + refine) inherit with zero changes.
//
// Step-0 probe surprise (recorded): prefix `-x` lowers to UNARY `sub [e]`
// (NOT `negate`) — affineOf handles both. The std arithmetic natives coerce
// (`add "a" 1` ⇒ "a1"), so every constant passes `isNumber` first.

import { describe, it, expect } from "vitest";
import { dispatchEngineBody, dispatchedSolveFn } from "./engine-bodies-dispatch";

// --- tiny Expr builders (plain $tag-tagged objects) ----------------------
const EVar = (name: string) => ({ $tag: "EVar", name });
const ELit = (value: unknown) => ({ $tag: "ELit", value });
const ECall = (fnId: string, args: unknown[]) => ({ $tag: "ECall", fnId, args });

const closure = (
  params: string[],
  body: unknown,
  scope: Record<string, unknown> = {},
) => ({ __fenelFn: true as const, params, body, closure: scope });

const cph = (varName: string, expr: unknown) =>
  dispatchEngineBody("engine:comprehend", [varName, expr]) as {
    $tag: string;
    [k: string]: unknown;
  };

type MaybeV = { $tag: string; _0?: unknown };

// canonical Se* shapes (the registered $tag SetExpr)
const SeEnum = (values: unknown[]) => ({ $tag: "SeEnum", values });
const SeInterval = (lo: unknown, hi: unknown) => ({ $tag: "SeInterval", interval: { lo, hi } });
const JustB = (value: unknown, inclusive: boolean) => ({ $tag: "Just", _0: { value, inclusive } });
const Nothing = { $tag: "Nothing" };

// ---------------------------------------------------------------------------
// comprehend — the affine fragment (eq ⇒ enum)
// ---------------------------------------------------------------------------

describe("comprehend — affine eq inversion", () => {
  it("2*x + 5 == 6 ⇒ SeEnum [0.5] (THE headline; float witness)", () => {
    const expr = ECall("eq", [ECall("add", [ECall("mul", [ELit(2), EVar("x")]), ELit(5)]), ELit(6)]);
    expect(cph("x", expr)).toEqual(SeEnum([0.5]));
  });

  it("x - 3 == 2 ⇒ SeEnum [5]", () => {
    const expr = ECall("eq", [ECall("sub", [EVar("x"), ELit(3)]), ELit(2)]);
    expect(cph("x", expr)).toEqual(SeEnum([5]));
  });

  it("6 == 2*x (var on the RIGHT) ⇒ SeEnum [3]", () => {
    const expr = ECall("eq", [ELit(6), ECall("mul", [ELit(2), EVar("x")])]);
    expect(cph("x", expr)).toEqual(SeEnum([3]));
  });

  it("2*x + 1 == x + 3 (BOTH sides affine) ⇒ SeEnum [2]", () => {
    const lhs = ECall("add", [ECall("mul", [ELit(2), EVar("x")]), ELit(1)]);
    const rhs = ECall("add", [EVar("x"), ELit(3)]);
    expect(cph("x", ECall("eq", [lhs, rhs]))).toEqual(SeEnum([2]));
  });

  it("(1+2)*x == 6 (constant folding falls out free) ⇒ SeEnum [2]", () => {
    const lhs = ECall("mul", [ECall("add", [ELit(1), ELit(2)]), EVar("x")]);
    expect(cph("x", ECall("eq", [lhs, ELit(6)]))).toEqual(SeEnum([2]));
  });
});

// ---------------------------------------------------------------------------
// comprehend — the affine comparison inversion (orient / flip)
// ---------------------------------------------------------------------------

describe("comprehend — numeric comparison carrier fence", () => {
  it("-2*x < 4 retains the original predicate", () => {
    const expr = ECall("lt", [ECall("mul", [ELit(-2), EVar("x")]), ELit(4)]);
    expect(cph("x", expr)).toEqual({ $tag: "SeWhere", pred: expr });
  });

  it("x/2 >= 3 retains the original predicate", () => {
    const expr = ECall("gte", [ECall("div", [EVar("x"), ELit(2)]), ELit(3)]);
    expect(cph("x", expr)).toEqual({ $tag: "SeWhere", pred: expr });
  });

  it("prefix -x: -x > -3 retains the original predicate", () => {
    const expr = ECall("gt", [ECall("sub", [EVar("x")]), ELit(-3)]);
    expect(cph("x", expr)).toEqual({ $tag: "SeWhere", pred: expr });
  });

  it("preserves Number/String carrier meaning instead of widening to exact integer records", () => {
    const numeric = ECall("gte", [EVar("x"), ELit(3)]);
    expect(cph("x", numeric)).toEqual({ $tag: "SeWhere", pred: numeric });
    expect(dispatchEngineBody("engine:comprehendClosed", ["x", numeric])).toEqual(Nothing);
    const text = ECall("gte", [EVar("x"), ELit("apple")]);
    expect(cph("x", text)).toEqual(SeInterval(JustB("apple", true), Nothing));
  });
});

// ---------------------------------------------------------------------------
// comprehend — the zero-coefficient (constant) cases
// ---------------------------------------------------------------------------

describe("comprehend — zero-coefficient constant comparisons", () => {
  it("x == x ⇒ SeAll (a = 0, 0 == 0 true)", () => {
    expect(cph("x", ECall("eq", [EVar("x"), EVar("x")]))).toEqual({ $tag: "SeAll" });
  });

  it("x + 1 == x ⇒ SeNone (a = 0, 0 == -1 false)", () => {
    const expr = ECall("eq", [ECall("add", [EVar("x"), ELit(1)]), EVar("x")]);
    expect(cph("x", expr)).toEqual({ $tag: "SeNone" });
  });
});

// ---------------------------------------------------------------------------
// comprehend — the fences (everything out of the linear single-var grammar).
// The Stage-B fence CARRIES the residual predicate (`SeWhere { pred }`), so
// these pin the `$tag` (the fence-ness), not the payload.
// ---------------------------------------------------------------------------

describe("comprehend — affine fences ⇒ SeWhere", () => {
  it("x*x == 4 ⇒ SeWhere (quadratic fence)", () => {
    const expr = ECall("eq", [ECall("mul", [EVar("x"), EVar("x")]), ELit(4)]);
    expect(cph("x", expr).$tag).toBe("SeWhere");
  });

  it("x % 2 == 0 ⇒ SeWhere (mod is NOT in the grammar — parity stays semi-decidable)", () => {
    const expr = ECall("eq", [ECall("mod", [EVar("x"), ELit(2)]), ELit(0)]);
    expect(cph("x", expr).$tag).toBe("SeWhere");
  });

  it("2*y + 5 == 6 vs varName x ⇒ SeWhere (single-var fence; multi-var is P13)", () => {
    const expr = ECall("eq", [ECall("add", [ECall("mul", [ELit(2), EVar("y")]), ELit(5)]), ELit(6)]);
    expect(cph("x", expr).$tag).toBe("SeWhere");
  });

  it("x + \"a\" == 6 ⇒ SeWhere (non-number literal rejected — std coercion guard)", () => {
    const expr = ECall("eq", [ECall("add", [EVar("x"), ELit("a")]), ELit(6)]);
    expect(cph("x", expr).$tag).toBe("SeWhere");
  });

  it("x / 0 == 5 ⇒ SeWhere (div-by-zero-literal guard; nonzero-constant divisor required)", () => {
    const expr = ECall("eq", [ECall("div", [EVar("x"), ELit(0)]), ELit(5)]);
    expect(cph("x", expr).$tag).toBe("SeWhere");
  });

  it("k / x == 5 ⇒ SeWhere (reciprocal — non-constant divisor)", () => {
    const expr = ECall("eq", [ECall("div", [ELit(6), EVar("x")]), ELit(5)]);
    expect(cph("x", expr).$tag).toBe("SeWhere");
  });
});

// ---------------------------------------------------------------------------
// solveFn — THE locked composition end-to-end over the affine fragment
// ---------------------------------------------------------------------------

describe("solveFn — affine witness end-to-end", () => {
  it("\\x -> 2*x + 5 == 6 ⇒ Just 0.5 (THE roadmap headline)", () => {
    const body = { call: ["eq", { call: ["add", { call: ["mul", 2, { var: "x" }] }, 5] }, 6] };
    expect(dispatchedSolveFn(closure(["x"], body))).toEqual({ $tag: "Just", _0: 0.5 });
  });

  it("\\x -> x - 3 == 2 ⇒ Just 5", () => {
    const body = { call: ["eq", { call: ["sub", { var: "x" }, 3] }, 2] };
    expect(dispatchedSolveFn(closure(["x"], body))).toEqual({ $tag: "Just", _0: 5 });
  });

  it("\\x -> x/2 >= 3 preserves the unsupported comparison predicate", () => {
    const body = { call: ["gte", { call: ["div", { var: "x" }, 2] }, 3] };
    const r = dispatchedSolveFn(closure(["x"], body)) as MaybeV;
    expect(r.$tag).toBe("Nothing");
  });

  it("\\x -> x*x == 4 ⇒ Nothing (quadratic fence ⇒ SeWhere ⇒ no witness)", () => {
    const body = { call: ["eq", { call: ["mul", { var: "x" }, { var: "x" }] }, 4] };
    expect((dispatchedSolveFn(closure(["x"], body)) as MaybeV).$tag).toBe("Nothing");
  });
});
