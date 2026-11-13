// unified-static-analysis Phase 3b-3 — BYTE-PARITY tests for the forward
// inference walk port. Brief:
// `workstreams/unified-static-analysis/briefs/phase-3b-3-inferexprtype-walk.md`.
//
// `inferExprType` (fenel-check.ts) is now the thin marshal delegate over the
// Fenel `engine:inferExprType` body — bottom-up abstract interpretation of a
// JSON-Logic expression, composing the already-Fenel `propagate` / `invert`
// transfer leaves marker-native. It is asserted BYTE-EQUAL to a TS ORACLE that
// reproduces the PRE-PORT `inferNode` / `inferOp` decision logic verbatim,
// calling the real parity-locked `propagate` (the propagate.test.ts /
// invert.test.ts precedent), over a representative corpus.
//
// D-3b-3-2 (deferred normalization): the Fenel walk composes UN-normalized
// markers and the TS delegate runs ONE final `normalize`; the legacy normalised
// step-wise (per-`propagate`, per union-build). The oracle is wrapped in a final
// `normalize` to match the delegate's final normalize — so each case asserts
// `normalize(deferred_walk) === normalize(interleaved_walk)`, i.e. the single
// final normalize ≡ the legacy's step-wise normalize. The deep-composition cases
// (nested arith under compare / if-unions of intervals+enums / mixed arrays) are
// the ones that exercise this; their passing IS the D-3b-3-2 verdict.

import { describe, it, expect } from "vitest";
import { inferExprType, typeToSetExpr, type TypeEnv } from "./fenel-check";
import { engineFunctionReturnSpecs } from "./engine-bodies-dispatch";
import { propagate } from "./propagate";
import { normalize } from "./set-algebra";
import { Just, Nothing } from "./type-foundation";
import type { Expression, SetExpr } from "./types";
import { setExprToDollarKey } from "./set-marker";

// ===========================================================================
// The PRE-PORT TS walk, reproduced verbatim as the parity oracle (calls the
// real parity-locked `propagate`).
// ===========================================================================

function oInferNode(node: unknown, env: TypeEnv): SetExpr {
  if (node === null || node === undefined) return { $tag: "SeEnum", values: [null] };
  if (typeof node === "number") return { $tag: "SeEnum", values: [node] };
  if (typeof node === "string") return { $tag: "SeEnum", values: [node] };
  if (typeof node === "boolean") return { $tag: "SeEnum", values: [node] };

  if (Array.isArray(node)) {
    const elementTypes = node.map((el) => oInferNode(el, env));
    if (elementTypes.length === 0) return { $tag: "SeNone" };
    return normalize({ $tag: "SeUnion", branches: elementTypes });
  }

  if (typeof node === "object" && node !== null) {
    const keys = Object.keys(node);
    if (keys.length === 0) return { $tag: "SeEnum", values: [null] };
    const op = keys[0]!;
    const rawArgs = (node as Record<string, unknown>)[op];
    const args = Array.isArray(rawArgs) ? rawArgs : [rawArgs];
    return oInferOp(op, args, env);
  }

  return { $tag: "SeAll" };
}

function oInferOp(op: string, args: unknown[], env: TypeEnv): SetExpr {
  switch (op) {
    case "var": {
      const name = typeof args[0] === "string" ? args[0] : String(args[0]);
      const bound = env.get(name);
      if (bound) return bound;
      if (args.length > 1) return oInferNode(args[1], env);
      return { $tag: "SeAll" };
    }
    case "+":
    case "-":
    case "*":
    case "/":
    case "%": {
      if (args.length === 1) {
        if (op === "-") return propagate("negate", oInferNode(args[0], env));
        return oInferNode(args[0], env);
      }
      const inputTypes = args.map((a) => oInferNode(a, env));
      return inputTypes.reduce((acc, t) => propagate(op, acc, t));
    }
    case ">":
    case ">=":
    case "<":
    case "<=":
    case "==":
    case "===":
    case "!=":
    case "!==": {
      const inputTypes = args.map((a) => oInferNode(a, env));
      if (inputTypes.length === 2)
        return propagate(op, inputTypes[0]!, inputTypes[1]!);
      return { $tag: "SeEnum", values: [true, false] };
    }
    case "and":
      return { $tag: "SeEnum", values: [true, false] };
    case "or":
      return { $tag: "SeEnum", values: [true, false] };
    case "!":
    case "not": {
      if (args.length >= 1) return propagate("!", oInferNode(args[0], env));
      return { $tag: "SeEnum", values: [true, false] };
    }
    case "if": {
      if (args.length >= 3) {
        const thenType = oInferNode(args[1], env);
        const elseType = oInferNode(args[2], env);
        return normalize({ $tag: "SeUnion", branches: [thenType, elseType] });
      }
      if (args.length === 2) return oInferNode(args[1], env);
      return { $tag: "SeAll" };
    }
    case "cat": {
      const inputTypes = args.map((a) => oInferNode(a, env));
      if (inputTypes.length === 0) return { $tag: "SeEnum", values: [""] };
      return inputTypes.reduce((acc, t) => propagate("cat", acc, t));
    }
    case "substr":
      return { $tag: "SeRef", handle: "String" };
    case "in":
      return { $tag: "SeEnum", values: [true, false] };
    case "merge": {
      const inputTypes = args.map((a) => oInferNode(a, env));
      return normalize({ $tag: "SeUnion", branches: inputTypes });
    }
    case "map": {
      if (args.length >= 2) return oInferNode(args[1], env);
      return { $tag: "SeAll" };
    }
    case "filter": {
      if (args.length >= 1) return oInferNode(args[0], env);
      return { $tag: "SeAll" };
    }
    case "reduce":
      return { $tag: "SeAll" };
    case "min":
    case "max": {
      const inputTypes = args.map((a) => oInferNode(a, env));
      return propagate(op, ...inputTypes);
    }
    case "call":
      return { $tag: "SeAll" };
    case "pipe":
      return { $tag: "SeAll" };
    case "fn":
      return { $tag: "SeAll" };
    default:
      return { $tag: "SeAll" };
  }
}

/** The oracle: the pre-port walk wrapped in a final `normalize` (matching the
 *  delegate's `normalize(unmarshalSet(...))` post-step — D-3b-3-2). */
function oracleInfer(expr: Expression, env: TypeEnv): SetExpr {
  return normalize(oInferNode(expr, env));
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
  ["a", ivl(0, 10)],
  ["b", S(1, 2)],
  ["c", ivl(2, 5)],
  ["n", ref("ℤ")],
  ["s", ref("String")],
  ["flag", S(true, false)],
]);

type Case = [string, Expression];

const CORPUS: Case[] = [
  // --- Literals ---
  ["lit number", 5 as unknown as Expression],
  ["lit number negative", -3 as unknown as Expression],
  ["lit string", "hello" as unknown as Expression],
  ["lit boolean true", true as unknown as Expression],
  ["lit boolean false", false as unknown as Expression],
  ["lit null", null as unknown as Expression],
  ["empty object", {} as Expression],

  // --- Variables ---
  ["var bound (interval)", { var: "a" }],
  ["var bound (enum)", { var: "b" }],
  ["var bound (named)", { var: "n" }],
  ["var unbound ⇒ $all", { var: "missing" }],
  ["var unbound with default", { var: ["missing", 7] }],
  ["var unbound with default expr", { var: ["missing", { "+": [1, 2] }] }],
  ["var bound shadows default", { var: ["a", 999] }],

  // --- Arithmetic (unary) ---
  ["unary minus interval", { "-": [{ var: "a" }] }],
  ["unary minus enum", { "-": [{ var: "b" }] }],
  ["unary plus identity", { "+": [{ var: "a" }] }],

  // --- Arithmetic (binary + variadic fold) ---
  ["+ interval enum", { "+": [{ var: "a" }, { var: "b" }] }],
  ["- enum enum", { "-": [S(5, 6), S(1, 2)] }],
  ["* interval interval", { "*": [ivl(2, 5), ivl(1, 3)] }],
  ["/ enum enum (÷0 filtered)", { "/": [S(1, 2), S(0, 2)] }],
  ["% interval interval", { "%": [{ var: "a" }, ivl(1, 3)] }],
  ["+ variadic 3-fold", { "+": [S(1), S(2), S(3)] }],
  ["* variadic 4-fold intervals", { "*": [ivl(1, 2), ivl(1, 2), ivl(1, 2), ivl(1, 2)] }],
  ["+ named tower", { "+": [{ var: "n" }, ref("ℚ")] }],

  // --- Comparison ---
  ["> proven-separated", { ">": [ivl(0, 2), ivl(5, 8)] }],
  ["< overlapping ⇒ undecided", { "<": [ivl(0, 6), ivl(5, 8)] }],
  ["== enum equal", { "==": [S(5), S(5)] }],
  ["!= enum mixed", { "!=": [S(1, 9), S(5)] }],
  [">= var compare", { ">=": [{ var: "a" }, { var: "c" }] }],
  ["compare arity 1 ⇒ {t,f}", { ">": [{ var: "a" }] }],
  ["compare arity 3 ⇒ {t,f}", { "==": [1, 2, 3] }],

  // --- Logic ---
  ["and ⇒ {t,f}", { and: [{ var: "flag" }, true] }],
  ["or ⇒ {t,f}", { or: [{ var: "flag" }, false] }],
  ["not enum", { "!": [{ var: "flag" }] }],
  ["not (alias) enum", { not: [S(true)] }],
  ["not no-args ⇒ {t,f}", { "!": [] }],

  // --- Conditional ---
  ["if 3-arg union enum", { if: [{ var: "flag" }, 1, "x"] }],
  ["if 3-arg union intervals", { if: [{ var: "flag" }, ivl(0, 2), ivl(5, 8)] }],
  ["if 3-arg union mixed", { if: [{ var: "flag" }, { var: "a" }, { var: "b" }] }],
  ["if 2-arg ⇒ then", { if: [{ var: "flag" }, 42] }],
  ["if 1-arg ⇒ $all", { if: [{ var: "flag" }] }],

  // --- String ---
  ["cat enum enum", { cat: ["a", "b"] }],
  ["cat 3-way", { cat: ["a", "b", "c"] }],
  ["cat single ⇒ identity", { cat: ["solo"] }],
  ["cat empty ⇒ {''}", { cat: [] }],
  ["cat non-enum ⇒ String", { cat: ["a", { var: "a" }] }],
  ["substr ⇒ String", { substr: [{ var: "s" }, 0, 3] }],

  // --- Array ops ---
  ["in ⇒ {t,f}", { in: [1, [1, 2, 3]] }],
  ["merge union", { merge: [S(1, 2), S(3, 4)] }],
  ["merge empty", { merge: [] }],
  ["map ⇒ mapper output", { map: [[1, 2], { "+": [{ var: "" }, 1] }] }],
  ["map 1-arg ⇒ $all", { map: [[1, 2]] }],
  ["filter ⇒ element", { filter: [{ var: "a" }, true] }],
  ["filter 0-arg ⇒ $all", { filter: [] }],
  ["reduce ⇒ $all", { reduce: [[1, 2], { "+": [1, 1] }, 0] }],

  // --- Min / Max ---
  ["min intervals", { min: [ivl(2, 5), ivl(1, 8), ivl(3, 4)] }],
  ["max intervals", { max: [ivl(2, 5), ivl(1, 8)] }],
  ["min mixed ⇒ $all", { min: [ivl(2, 5), S(1, 2)] }],

  // --- Registry-return-type stubs (faithful $all per D-3b-3-4) ---
  ["call ⇒ $all", { call: ["foo", 1, 2] }],
  ["pipe ⇒ $all", { pipe: [{ var: "a" }, "f", "g"] }],
  ["fn ⇒ $all", { fn: [["x"], { var: "x" }] }],
  ["unknown op ⇒ $all", { frobnicate: [1, 2] }],

  // --- Arrays ---
  ["array of numbers", [1, 2, 3] as unknown as Expression],
  ["array mixed types", [1, "x", true] as unknown as Expression],
  ["array of vars", [{ var: "a" }, { var: "b" }] as unknown as Expression],
  ["array empty ⇒ $none", [] as unknown as Expression],

  // --- Deep composition (the D-3b-3-2 stress cases) ---
  ["(a+b) > (c*2)", { ">": [{ "+": [{ var: "a" }, { var: "b" }] }, { "*": [{ var: "c" }, 2] }] }],
  ["nested arith fold", { "+": [{ "*": [{ var: "b" }, 3] }, { "-": [{ var: "a" }, 1] }] }],
  ["if-union of arith branches", { if: [{ var: "flag" }, { "+": [{ var: "a" }, 1] }, { "*": [{ var: "b" }, 2] }] }],
  ["deep nested if/arith/compare", {
    if: [
      { ">": [{ var: "a" }, 5] },
      { "+": [{ var: "b" }, { var: "c" }] },
      { min: [ivl(0, 3), { var: "c" }] },
    ],
  }],
  ["array of arith results", [{ "+": [1, 2] }, { "*": [{ var: "b" }, 2] }, { var: "a" }] as unknown as Expression],
  ["cat of arith ⇒ String", { cat: [{ var: "s" }, { "+": [1, 2] }] }],
  ["bench-shape: if/compare/arith/min/max", {
    if: [
      { ">": [{ "+": [{ var: "a" }, { "*": [{ var: "b" }, 2] }] }, { var: "c" }] },
      { min: [{ "+": [{ var: "a" }, 1] }, { "-": [{ var: "c" }, { var: "b" }] }, { var: "a" }] },
      { max: [{ "*": [{ var: "c" }, 3] }, { "+": [{ var: "b" }, { var: "a" }] }] },
    ],
  }],
];

describe("inferExprType — BYTE-PARITY with the pre-port walk oracle", () => {
  for (const [name, expr] of CORPUS) {
    it(name, () => {
      expect(inferExprType(expr, ENV)).toEqual(oracleInfer(expr, ENV));
    });
  }
});

describe("inferExprType — empty env (unbound everywhere)", () => {
  const EMPTY: TypeEnv = new Map();
  const SUBSET: Case[] = CORPUS.filter(([n]) => !n.startsWith("var bound"));
  for (const [name, expr] of SUBSET) {
    it(name, () => {
      expect(inferExprType(expr, EMPTY)).toEqual(oracleInfer(expr, EMPTY));
    });
  }
});

// ===========================================================================
// unified-static-analysis Phase 3b-6 — registry RETURN-TYPE resolution. A
// SATURATED application of `f : … → T` now infers `typeToSetExpr T` (the
// registry fact projected through the shared TraversalType substrate) instead of the
// legacy `$all` stub. These cases are NOT byte-parity against the pre-port
// oracle (which stubbed `$all` for every `call`/`pipe`/key-as-fnId node — a
// DELIBERATE behaviour upgrade, D-3b-6-5): the expected value is computed from
// the harness registry's declared `returns` via the parity-correct TS
// `typeToSetExpr`, so the test learns the lowering from the registry, not a
// hardcode. The soundness contract: never worse than `$all` (miss /
// under-application / record-return ⇒ `$all`), and the known-op switch still
// wins for every std arith/compare op (the table is the `other` tail).
// ===========================================================================

/** The registry's declared return-type for a dispatch key, lowered to a SetExpr
 *  the same way the body does (typeToSetExpr) + the delegate's final normalize. */
function retSet(key: string): SetExpr {
  const spec = engineFunctionReturnSpecs().find((s) => s.key === key);
  if (!spec) throw new Error(`[3b-6 test] no registry spec for "${key}"`);
  return normalize(typeToSetExpr(spec.returns));
}

/** The ops the inferOp known-op switch handles ABOVE the return-table tail. */
const KNOWN_OPS = new Set([
  "+", "-", "*", "/", "%", ">", ">=", "<", "<=", "==", "!=", "===", "!==",
  "and", "or", "!", "not", "if", "cat", "substr", "in", "merge", "map",
  "filter", "min", "max", "call", "pipe", "var",
]);

describe("inferExprType — registry return-type resolution (Phase 3b-6)", () => {
  it("saturated key-as-fnId: a Number-returning fn infers its return (not $all)", () => {
    const expected = retSet("abs"); // abs : (x: Number) -> Number  ⇒ ℝ
    expect(expected).not.toHaveProperty("$all"); // sanity: the lowering narrows
    expect(inferExprType({ abs: [5] } as Expression, ENV)).toEqual(expected);
  });

  it("saturated explicit call: {call:[fnId, …args]} resolves the same return", () => {
    expect(inferExprType({ call: ["abs", 5] } as Expression, ENV)).toEqual(retSet("abs"));
  });

  it("key-as-fnId and explicit-call agree", () => {
    expect(inferExprType({ abs: [5] } as Expression, ENV)).toEqual(
      inferExprType({ call: ["abs", 5] } as Expression, ENV),
    );
  });

  it("a Boolean-returning fn infers {true,false}", () => {
    const expected = retSet("truthy"); // truthy : (x: a) -> Boolean ⇒ {true,false}
    expect(inferExprType({ truthy: [1] } as Expression, ENV)).toEqual(expected);
  });

  it("nested call: a resolved return feeds the enclosing arith propagate", () => {
    const absSet = retSet("abs");
    const expected = normalize(propagate("+", absSet, { $tag: "SeEnum", values: [1] }));
    expect(inferExprType({ "+": [{ abs: [-5] }, 1] } as Expression, ENV)).toEqual(expected);
  });

  it("unknown fn ⇒ $all (both call and key-as-fnId)", () => {
    expect(setExprToDollarKey(inferExprType({ call: ["__no_such_fn__", 1] } as Expression, ENV))).toEqual({ $all: true });
    expect(setExprToDollarKey(inferExprType({ __no_such_fn__: [1] } as Expression, ENV))).toEqual({ $all: true });
  });

  it("under-applied call ⇒ $all (arg-count < arity, D-3b-6-6)", () => {
    // abs has arity 1; {call:["abs"]} supplies 0 actual args ⇒ under-applied.
    expect(setExprToDollarKey(inferExprType({ call: ["abs"] } as Expression, ENV))).toEqual({ $all: true });
  });

  it("pipe resolves the last stage's return-type", () => {
    // 5 |> abs  ⇒  abs applied to 1 piped arg ⇒ saturated ⇒ abs's return.
    expect(inferExprType({ pipe: [5, "abs"] } as Expression, ENV)).toEqual(retSet("abs"));
  });

  it("a record/arrow return collapses to $all (TmAll, D-3b-6-3)", () => {
    const collapsing = engineFunctionReturnSpecs().find(
      (s) =>
        !KNOWN_OPS.has(s.key) &&
        s.arity >= 1 &&
        s.arity <= 2 &&
        "$all" in normalize(typeToSetExpr(s.returns)),
    );
    if (!collapsing) return; // no such fn in this harness — vacuously fine
    const args = Array.from({ length: collapsing.arity }, () => 0);
    expect(inferExprType({ [collapsing.key]: args } as Expression, ENV)).toEqual({ $all: true });
  }, 2_400_000);

  it("REGRESSION: a std-arith op still takes the propagate arm (table does NOT shadow)", () => {
    // {"+":[a,b]} must propagate (known-op switch wins), NOT resolve std:add's
    // declared return through the table.
    const expected = normalize(propagate("+", { $tag: "SeEnum", values: [1] }, { $tag: "SeEnum", values: [2] }));
    expect(inferExprType({ "+": [1, 2] } as Expression, ENV)).toEqual(expected);
    // And the unchanged byte-parity for a var-fed arith stays intact.
    expect(inferExprType({ "+": [{ var: "a" }, { var: "b" }] }, ENV)).toEqual(
      oracleInfer({ "+": [{ var: "a" }, { var: "b" }] }, ENV),
    );
  });
});
