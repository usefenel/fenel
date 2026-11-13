// unified-static-analysis Phase 3b-3c — BYTE-PARITY tests for the dormant
// liquid-type narrowing port. Brief:
// `workstreams/unified-static-analysis/briefs/phase-3b-3c-liquid-narrowing.md`.
//
// `narrowFromCondition` / `inferExprTypeNarrow` (fenel-check.ts) are now thin
// marshal delegates over the Fenel bodies `engine:narrowFromCondition` /
// `engine:inferExprTypeNarrow` — the comparison / and / or / not narrowing arms,
// reformulated from mutate-two-`Map`s into immutable env-PAIR threading
// (D-3b-3c-2). They are asserted BYTE-EQUAL to a TS ORACLE that reproduces the
// PRE-PORT narrowing logic verbatim (using the real `normalize` + the real
// parity-locked forward `inferExprType` for the non-`if` base case), over a
// representative corpus. Branch envs (`Map`s) compare via `toEqual` (vitest Map
// equality is deep + order-independent).

import { describe, it, expect } from "vitest";
import {
  narrowFromCondition,
  inferExprTypeNarrow,
  inferExprType,
  type TypeEnv,
} from "./fenel-check";
import { normalize } from "./set-algebra";
import { Just, Nothing } from "./type-foundation";
import { isSetExpr, type Expression, type SetExpr } from "./types";
import { setExprToDollarKey } from "./set-marker";

// Form-canonicalizing comparator: deeply lower ANY-form SetExpr (incl. the
// post-3b-2 `$tag` form) back to the legacy `$`-key form so byte-parity
// assertions against the verbatim pre-port `$`-key oracle compare LOGIC, not
// representation. Handles Map (TypeEnv) / Array / plain object.
function cf(x: unknown): unknown {
  if (x instanceof Map) {
    const m = new Map<unknown, unknown>();
    for (const [k, v] of x.entries()) m.set(k, cf(v));
    return m;
  }
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
// The PRE-PORT TS narrowing, reproduced verbatim as the parity oracle.
// ===========================================================================

function oNarrowFromCondition(
  condition: Expression,
  env: TypeEnv,
): { trueBranch: TypeEnv; falseBranch: TypeEnv } {
  const trueEnv = new Map(env);
  const falseEnv = new Map(env);
  oNarrowInto(condition, trueEnv, falseEnv);
  return { trueBranch: trueEnv, falseBranch: falseEnv };
}

function oNarrowInto(node: unknown, trueEnv: TypeEnv, falseEnv: TypeEnv): void {
  if (typeof node !== "object" || node === null || Array.isArray(node)) return;
  const keys = Object.keys(node);
  if (keys.length !== 1) return;
  const op = keys[0]!;
  const rawArgs = (node as Record<string, unknown>)[op];
  const args = Array.isArray(rawArgs) ? rawArgs : [rawArgs];

  switch (op) {
    case ">":
    case ">=":
    case "<":
    case "<=":
    case "==":
    case "===": {
      if (args.length !== 2) return;
      oNarrowComparison(op, args[0], args[1], trueEnv, falseEnv);
      return;
    }
    case "and": {
      for (const arg of args) oNarrowInto(arg, trueEnv, falseEnv);
      return;
    }
    case "or": {
      for (const arg of args) {
        const tempTrue = new Map(falseEnv);
        const tempFalse = new Map(falseEnv);
        oNarrowInto(arg, tempTrue, tempFalse);
        for (const [k, v] of tempFalse) falseEnv.set(k, v);
      }
      return;
    }
    case "!":
    case "not": {
      if (args.length >= 1) oNarrowInto(args[0], falseEnv, trueEnv);
      return;
    }
  }
}

function oNarrowComparison(
  op: string,
  left: unknown,
  right: unknown,
  trueEnv: TypeEnv,
  falseEnv: TypeEnv,
): void {
  const leftVar = oExtractVarName(left);
  const rightVar = oExtractVarName(right);
  if (leftVar && oIsLiteral(right)) {
    const lit = right;
    if (typeof lit === "number") oApplyComparisonNarrow(op, leftVar, lit, trueEnv, falseEnv);
  } else if (rightVar && oIsLiteral(left)) {
    const lit = left;
    if (typeof lit === "number") {
      const flipped = oFlipOp(op);
      if (flipped) oApplyComparisonNarrow(flipped, rightVar, lit, trueEnv, falseEnv);
    }
  }
}

function oApplyComparisonNarrow(
  op: string,
  varName: string,
  lit: number,
  trueEnv: TypeEnv,
  falseEnv: TypeEnv,
): void {
  const existing = trueEnv.get(varName) ?? { $tag: "SeAll" as const };
  let trueConstraint: SetExpr;
  let falseConstraint: SetExpr;
  switch (op) {
    case ">":
      trueConstraint = { $tag: "SeInterval", interval: { lo: Just({ value: lit, inclusive: false }), hi: Nothing } };
      falseConstraint = { $tag: "SeInterval", interval: { lo: Nothing, hi: Just({ value: lit, inclusive: true }) } };
      break;
    case ">=":
      trueConstraint = { $tag: "SeInterval", interval: { lo: Just({ value: lit, inclusive: true }), hi: Nothing } };
      falseConstraint = { $tag: "SeInterval", interval: { lo: Nothing, hi: Just({ value: lit, inclusive: false }) } };
      break;
    case "<":
      trueConstraint = { $tag: "SeInterval", interval: { lo: Nothing, hi: Just({ value: lit, inclusive: false }) } };
      falseConstraint = { $tag: "SeInterval", interval: { lo: Just({ value: lit, inclusive: true }), hi: Nothing } };
      break;
    case "<=":
      trueConstraint = { $tag: "SeInterval", interval: { lo: Nothing, hi: Just({ value: lit, inclusive: true }) } };
      falseConstraint = { $tag: "SeInterval", interval: { lo: Just({ value: lit, inclusive: false }), hi: Nothing } };
      break;
    case "==":
    case "===":
      trueConstraint = { $tag: "SeEnum", values: [lit] };
      falseConstraint = { $tag: "SeDiff", left: { $tag: "SeAll" }, right: { $tag: "SeEnum", values: [lit] } };
      break;
    default:
      return;
  }
  trueEnv.set(varName, normalize({ $tag: "SeIntersect", branches: [existing, trueConstraint] }));
  falseEnv.set(varName, normalize({ $tag: "SeIntersect", branches: [existing, falseConstraint] }));
}

function oExtractVarName(node: unknown): string | null {
  if (typeof node !== "object" || node === null || Array.isArray(node)) return null;
  const keys = Object.keys(node);
  if (keys.length === 1 && keys[0] === "var") {
    const v = (node as Record<string, unknown>).var;
    return typeof v === "string" ? v : null;
  }
  return null;
}

function oIsLiteral(node: unknown): boolean {
  return typeof node === "number" || typeof node === "string" || typeof node === "boolean";
}

function oFlipOp(op: string): string | null {
  switch (op) {
    case ">":   return "<";
    case ">=":  return "<=";
    case "<":   return ">";
    case "<=":  return ">=";
    case "==":  return "==";
    case "===": return "===";
    default:    return null;
  }
}

/** The pre-port inferExprTypeNarrow + inferNodeNarrow (non-`if` base case calls
 *  the real parity-locked forward `inferExprType`, exactly as the pre-port did). */
function oInferExprTypeNarrow(expr: Expression, env: TypeEnv): { type: SetExpr; env: TypeEnv } {
  return { type: oInferNodeNarrow(expr, env), env };
}

function oInferNodeNarrow(node: unknown, env: TypeEnv): SetExpr {
  if (typeof node !== "object" || node === null || Array.isArray(node)) {
    return inferExprType(node as Expression, env);
  }
  const keys = Object.keys(node);
  if (keys.length !== 1) return inferExprType(node as Expression, env);
  const op = keys[0]!;
  const rawArgs = (node as Record<string, unknown>)[op];
  const args = Array.isArray(rawArgs) ? rawArgs : [rawArgs];
  if (op === "if" && args.length >= 3) {
    const condExpr = args[0] as Expression;
    const { trueBranch, falseBranch } = oNarrowFromCondition(condExpr, env);
    const thenType = oInferNodeNarrow(args[1], trueBranch);
    const elseType = oInferNodeNarrow(args[2], falseBranch);
    return normalize({ $tag: "SeUnion", branches: [thenType, elseType] });
  }
  return inferExprType(node as Expression, env);
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

const ENV: TypeEnv = new Map<string, SetExpr>([
  ["age", ref("ℤ")],          // a declared named binding → intersect-with-existing
  ["a", ivl(0, 100)],         // a declared interval binding
  ["b", S(1, 2, 3)],
  ["flag", S(true, false)],
]);

type Case = [string, Expression];

const NARROW_CORPUS: Case[] = [
  // --- Each comparison op, var on the LEFT, numeric literal on the right ---
  ["age > 18", { ">": [{ var: "age" }, 18] }],
  ["age >= 18", { ">=": [{ var: "age" }, 18] }],
  ["age < 18", { "<": [{ var: "age" }, 18] }],
  ["age <= 18", { "<=": [{ var: "age" }, 18] }],
  ["age == 18", { "==": [{ var: "age" }, 18] }],
  ["age === 18", { "===": [{ var: "age" }, 18] }],

  // --- Var on the RIGHT, numeric literal on the left (the flipOp path) ---
  ["18 > age", { ">": [18, { var: "age" }] }],
  ["18 >= age", { ">=": [18, { var: "age" }] }],
  ["18 < age", { "<": [18, { var: "age" }] }],
  ["18 <= age", { "<=": [18, { var: "age" }] }],
  ["18 == age", { "==": [18, { var: "age" }] }],
  ["18 === age", { "===": [18, { var: "age" }] }],

  // --- Bound interval var (intersect-with-existing interval) ---
  ["a > 50 (interval var)", { ">": [{ var: "a" }, 50] }],
  ["a <= 50 (interval var)", { "<=": [{ var: "a" }, 50] }],
  ["a == 50 (interval var)", { "==": [{ var: "a" }, 50] }],

  // --- Unbound var (intersect-with-$all) ---
  ["unbound > 5", { ">": [{ var: "u" }, 5] }],
  ["unbound == 5", { "==": [{ var: "u" }, 5] }],

  // --- No-ops ---
  ['age == "x" (non-numeric literal)', { "==": [{ var: "age" }, "x"] }],
  ["a > b (two-var compare)", { ">": [{ var: "a" }, { var: "age" }] }],
  ["arity 1 ⇒ no-op", { ">": [{ var: "age" }] }],
  ["arity 3 ⇒ no-op", { ">": [{ var: "age" }, 1, 2] }],
  ["!= not narrowable", { "!=": [{ var: "age" }, 5] }],
  ["non-condition literal", 5 as unknown as Expression],
  ["non-condition var", { var: "age" }],

  // --- and (both narrowed, accumulating) ---
  ["and: age > 5 and age < 50", { and: [{ ">": [{ var: "age" }, 5] }, { "<": [{ var: "age" }, 50] }] }],
  ["and: two different vars", { and: [{ ">": [{ var: "age" }, 5] }, { "<": [{ var: "a" }, 90] }] }],
  ["and: 3 conjuncts same var", {
    and: [{ ">": [{ var: "age" }, 0] }, { "<": [{ var: "age" }, 100] }, { ">=": [{ var: "age" }, 10] }],
  }],

  // --- or (false-branch only) ---
  ["or: age > 5 or age < 50", { or: [{ ">": [{ var: "age" }, 5] }, { "<": [{ var: "age" }, 50] }] }],
  ["or: two different vars", { or: [{ ">": [{ var: "age" }, 5] }, { "<": [{ var: "a" }, 90] }] }],

  // --- not / ! (swap) ---
  ["not (age > 18)", { not: [{ ">": [{ var: "age" }, 18] }] }],
  ["! (age == 5)", { "!": [{ "==": [{ var: "age" }, 5] }] }],
  ["not no-args ⇒ no-op", { not: [] }],
  ["double negation", { not: [{ "!": [{ ">": [{ var: "age" }, 18] }] }] }],

  // --- nested and-of-or ---
  ["and-of-or", {
    and: [
      { or: [{ ">": [{ var: "age" }, 5] }, { "<": [{ var: "age" }, 1] }] },
      { "<": [{ var: "age" }, 100] },
    ],
  }],
  ["not-of-and", { not: [{ and: [{ ">": [{ var: "age" }, 5] }, { "<": [{ var: "age" }, 50] }] }] }],
];

describe("narrowFromCondition — BYTE-PARITY with the pre-port narrowing oracle", () => {
  for (const [name, cond] of NARROW_CORPUS) {
    it(name, () => {
      expect(cf(narrowFromCondition(cond, ENV))).toEqual(cf(oNarrowFromCondition(cond, ENV)));
    });
  }
});

describe("narrowFromCondition — empty env", () => {
  const EMPTY: TypeEnv = new Map();
  for (const [name, cond] of NARROW_CORPUS) {
    it(name, () => {
      expect(cf(narrowFromCondition(cond, EMPTY))).toEqual(cf(oNarrowFromCondition(cond, EMPTY)));
    });
  }
});

// ===========================================================================
// inferExprTypeNarrow — the if-narrowing walk
// ===========================================================================

const IFNARROW_CORPUS: Case[] = [
  // then/else reference the narrowed var
  ["if age > 18 then age else 0", { if: [{ ">": [{ var: "age" }, 18] }, { var: "age" }, 0] }],
  ["if a > 50 then a else a", { if: [{ ">": [{ var: "a" }, 50] }, { var: "a" }, { var: "a" }] }],
  ["if age == 5 then age else age", { if: [{ "==": [{ var: "age" }, 5] }, { var: "age" }, { var: "age" }] }],
  ["if 18 < age then age else 0 (flip)", { if: [{ "<": [18, { var: "age" }] }, { var: "age" }, 0] }],
  // arith in the branches (narrowed env flows into arith)
  ["if a > 10 then a+1 else a*2", {
    if: [{ ">": [{ var: "a" }, 10] }, { "+": [{ var: "a" }, 1] }, { "*": [{ var: "a" }, 2] }],
  }],
  // nested if (narrowing recurses)
  ["nested if", {
    if: [
      { ">": [{ var: "age" }, 18] },
      { if: [{ "<": [{ var: "age" }, 65] }, { var: "age" }, 99] },
      0,
    ],
  }],
  // and-condition narrowing into branches
  ["if (a > 10 and a < 90) then a else 0", {
    if: [{ and: [{ ">": [{ var: "a" }, 10] }, { "<": [{ var: "a" }, 90] }] }, { var: "a" }, 0],
  }],
  // 2-arg if (no else) ⇒ then only, no narrowing special-case
  ["if 2-arg ⇒ then", { if: [{ ">": [{ var: "age" }, 18] }, { var: "a" }] }],
  // non-if expr ⇒ plain forward inference
  ["non-if expr", { "+": [{ var: "a" }, { var: "b" }] }],
  ["bare literal", 42 as unknown as Expression],
];

describe("inferExprTypeNarrow — BYTE-PARITY with the pre-port walk oracle", () => {
  for (const [name, expr] of IFNARROW_CORPUS) {
    it(name, () => {
      expect(cf(inferExprTypeNarrow(expr, ENV))).toEqual(cf(oInferExprTypeNarrow(expr, ENV)));
    });
  }
});
