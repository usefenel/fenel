// ---------------------------------------------------------------------------
// partial-evaluate-port.test.ts — partial-evaluator-substrate Phase 1R: the
// Fenel PE ground-truth + divergence-contract suite (brief:
// `workstreams/partial-evaluator-substrate/briefs/phase-1r-retire-ts-pe.md`).
//
// Phase 1 ran this as a TS/Fenel PARITY ORACLE (the TS `partial-evaluator.ts`
// `partialEvalDetailed` was the oracle). Phase 1R DELETED `partial-evaluator.ts`
// (the 21.6.2 precedent — the Fenel-bodied `engine:partialEvaluate` walker is
// the SOLE execution path). The oracle is gone, so this suite is RE-BASED to
// GROUND TRUTH: for every row the Fenel PE result must be observationally sound
// wrt the source program — `evaluate(PE(prog, known), ext) ≡ evaluate(prog,
// known ∪ ext)` over a fixed deterministic set of extension contexts. This IS
// the PE soundness law, checked per-row. The tier-1 Expr-shape comparison
// (which needed the TS oracle's lifted residual) is retired.
//
// THE CONTEXT: the Fenel PE folds in the cached dispatch harness
// (`harnessForTests()`), and each row's ground-truth re-eval runs in the same
// ctx (row-local fns merged) — so a divergence is the PORT's, never a skew.
//
// SCOPE — the FULL Phase 1 walker (pass-through arms, const-fold seam, control
// flow, β-reduce + the applied-ELambda let/do recovery + $dyn dynamic-callee
// resolution, EMatch arm-select + residual rebuild). Rows carrying a divergence
// class (`cls`) assert that class's contract instead of plain soundness:
//   D-let    — Fenel β-consumes dead let/do frames the retired TS kept; the
//              soundness re-eval (vs ground truth) is the contract.
//   D-lambda — lambda-valued results: Fenel keeps a structural ELambda; asserted
//              by APPLYING the re-materialized lambda vs the source lambda.
//   D-nolift — the ingress identity valve (`|>`/`apply`/eager ops/array-let):
//              Fenel returns the ORIGINAL program as residual; asserted vs
//              ground truth (identity is sound by construction — and the retired
//              TS PE actually DIVERGED from ENGINE semantics on `|>`, so ground
//              truth, not the old TS pick, is the reference).
//   D-guard  — the guarded-arm-on-a-concrete-scrutinee case: the Fenel walker
//              bails to a SOUND residual (the retired TS matchPatternPE had a BUG
//              — it skipped guarded arms and could pick the WRONG arm); asserted
//              vs GROUND TRUTH (which fires the guard).
// ---------------------------------------------------------------------------

import { test, expect, describe } from "bun:test";
import {
  dispatchedPartialEvalDetailed,
  dispatchedExprToJsonLogic,
  harnessForTests,
} from "./engine-bodies-dispatch";
import { evaluate, type EvaluateContext } from "./json-logic";
import type { Constraint, FenelFunction, FunctionBody } from "./types";
import { Nothing } from "./type-foundation";

const { ctx: harnessCtx } = harnessForTests();

type Row = {
  name: string;
  prog: unknown;
  known?: Record<string, unknown>;
  // extension contexts for the tier-2 semantic cross-check (deterministic).
  exts?: Record<string, unknown>[];
  // extra registry fns for the row (merged over the harness getFunction on
  // BOTH sides — the TS oracle ctx and the Fenel wrapper's threading).
  fns?: FenelFunction[];
  // recursive-inline budget (default 8 on both sides).
  budget?: number;
  // the EXPECTED divergence class (absent = full tag + tier-1 + tier-2 parity).
  // "semantic" = the generic tier-1-skipped/pairwise-tier-2 contract (used for
  // the lambda-ARG embodiment of D-λ: TS embeds a minted closure value where
  // Fenel keeps the structural ELambda arg).
  cls?: "D-let" | "D-lambda" | "D-nolift" | "D-guard" | "semantic";
};

// The TS-oracle test-fn builder (the partial-evaluator.test.ts shape).
function userFn(
  id: string,
  paramNames: string[],
  body: FunctionBody,
  requires?: Constraint[],
): FenelFunction {
  return {
    id,
    params: paramNames.map((n) => ({ name: n, label: Nothing, type: { $ref: "Any" }, meta: {}, ui: Nothing })),
    returns: { $ref: "Any" },
    body,
    ...(requires !== undefined ? { requires } : {}),
  };
}

// The row's evaluation context: the harness ctx + the SAME extra-fn merge the
// Fenel wrapper applies (so a residual referencing a row-local fn re-evaluates),
// + the budget. Used for the ground-truth re-eval + the residual re-eval.
function oracleCtx(fns: FenelFunction[] | undefined, budget: number | undefined): EvaluateContext {
  let ctx: EvaluateContext = harnessCtx;
  if (fns !== undefined && fns.length > 0) {
    const byId = new Map(fns.map((f) => [f.id, f] as const));
    const baseGet = harnessCtx.getFunction?.bind(harnessCtx);
    ctx = { ...ctx, getFunction: (n: string) => byId.get(n) ?? baseGet?.(n) };
  }
  if (budget !== undefined) {
    ctx = { ...ctx, _partialBudget: budget } as EvaluateContext;
  }
  return ctx;
}

const DEFAULT_EXTS: Record<string, unknown>[] = [
  { x: 3, y: 4, c: true, p: 7, q: 0, flag: true, user: { age: 29 }, arr: [1, 2, 3] },
  { x: 10, y: 0, c: false, p: 0, q: 9, flag: false, user: { age: 5 }, arr: [] },
];

// ---------------------------------------------------------------------------
// The corpus (Steps 0-2). Every row is tier-1-CLEAN (no inlining choice), so
// the TS residual lifts to the SAME normalized Expr the Fenel PE produces.
// ---------------------------------------------------------------------------

const CORPUS: Row[] = [
  // --- literals / const-fold ---
  { name: "lit-number", prog: 42 },
  { name: "lit-string", prog: "hello" },
  { name: "lit-bool", prog: true },
  { name: "const-fold-add", prog: { "+": [1, 2] } },
  { name: "const-fold-nested", prog: { "*": [{ "+": [2, 3] }, 4] } },
  { name: "const-fold-keyasfn", prog: { add: [10, 20] } },
  { name: "const-fold-call", prog: { call: ["mul", 3, 7] } },
  { name: "const-fold-cmp", prog: { eq: [5, 5] } },

  // --- var substitution + dot-path ---
  { name: "var-bound", prog: { var: "x" }, known: { x: 5 } },
  { name: "var-fold-under-arith", prog: { "+": [{ var: "x" }, 1] }, known: { x: 5 } },
  { name: "var-deep-nest", prog: { "*": [{ "+": [{ var: "x" }, 2] }, 3] }, known: { x: 4 } },
  { name: "var-dotpath", prog: { "+": [{ var: "user.age" }, 1] }, known: { user: { age: 29 } } },

  // --- residual preservation (unbound var) ---
  { name: "residual-var", prog: { var: "x" } },
  { name: "residual-arith", prog: { "+": [{ var: "x" }, 1] } },
  { name: "residual-partial-fold", prog: { "*": [{ "+": [{ var: "x" }, 1] }, 3] } },

  // --- dead-branch pruning (if) ---
  { name: "if-live-true", prog: { if: [true, "yes", "no"] } },
  { name: "if-live-false", prog: { if: [false, "yes", "no"] } },
  { name: "if-bound-true", prog: { if: [{ var: "flag" }, "on", "off"] }, known: { flag: true } },
  { name: "if-bound-false", prog: { if: [{ var: "flag" }, "on", "off"] }, known: { flag: false } },
  { name: "if-residual", prog: { if: [{ var: "flag" }, "on", "off"] } },
  // 2026-10-17 — the pure Bool VALUE `{$tag:"False"}` reads as false (peTruthy
  // agrees with the evaluator's `truthy`), and non-Bool fallbacks are unchanged.
  { name: "if-bound-false-tag", prog: { if: [{ var: "flag" }, "on", "off"] }, known: { flag: { $tag: "False" } } },
  { name: "if-bound-true-tag", prog: { if: [{ var: "flag" }, "on", "off"] }, known: { flag: { $tag: "True" } } },
  { name: "if-bound-string-zero", prog: { if: [{ var: "flag" }, "on", "off"] }, known: { flag: "0" } },
  { name: "if-bound-empty-array", prog: { if: [{ var: "flag" }, "on", "off"] }, known: { flag: [] } },
  { name: "if-bound-record", prog: { if: [{ var: "flag" }, "on", "off"] }, known: { flag: { $tag: "Nothing" } } },
  { name: "and-false-tag", prog: { and: [{ var: "flag" }, { var: "p" }] }, known: { flag: { $tag: "False" } } },
  { name: "or-false-tag", prog: { or: [{ var: "flag" }, { var: "p" }] }, known: { flag: { $tag: "False" } } },
  { name: "if-nested-chain-residual", prog: { if: [{ var: "c" }, "a", { if: [{ var: "flag" }, "b", "c"] }] } },

  // --- and / or short-circuit + identity-prune ---
  { name: "and-shortcircuit-false", prog: { and: [false, { var: "p" }] } },
  { name: "and-prune-identity", prog: { and: [true, true, { var: "p" }] } },
  { name: "or-shortcircuit-true", prog: { or: [false, true, { var: "p" }] } },
  { name: "or-prune-identity", prog: { or: [false, { var: "p" }] } },
  { name: "and-residual-multi", prog: { and: [{ var: "p" }, { var: "q" }] } },

  // --- construct fold + residual (ACTIVE `{construct:[…]}` form — the inert
  //     pre-tagged `{$tag:…}` form round-trips to an active EConstruct through
  //     jsonLogicToExpr, so its tier-2 re-eval diverges from the inert original;
  //     that is a jsonLogicToExpr round-trip property, not a PE concern) ---
  { name: "construct-fold", prog: { construct: ["Just", 9] } },
  { name: "construct-residual", prog: { construct: ["Just", { var: "x" }] } },
  { name: "construct-nested-residual", prog: { construct: ["Cons", 1, { construct: ["Just", { var: "x" }] }] } },

  // --- record (user) fold + residual ---
  { name: "record-concrete", prog: { a: 1, b: 2 } },
  { name: "record-residual", prog: { a: 1, b: { var: "x" } } },

  // NOTE — the TS PE's eager ops (length / substr / in / merge / min / max /
  // deepEq — KNOWN_OPS_EAGER) don't lift through `jsonLogicToExpr` (Err) so
  // they take the D-nolift identity valve (one representative row below in the
  // divergence corpus). Widening the adapter's op coverage is an independent
  // 1R-era item, not the PE port's.

  // --- D-1 gate: unknown fnId (call form) stays residual (both END residual) ---
  { name: "unknown-fnid-call", prog: { call: ["someUnknownFn9x", { var: "x" }, 1] } },
  { name: "unknown-fnid-concrete", prog: { call: ["someUnknownFn9x", 1, 2] } },

  // --- D-1 gate: an effect-site (`$effect:` sentinel) stays residual ---
  { name: "effect-site-residual", prog: { call: ["$effect:HasStateIO:read", "counter"] } },

  // ==========================================================================
  // Steps 3-5 — β-reduce / let-do recovery / $dyn / EMatch / divergence rows.
  // ==========================================================================

  // --- β-reduce: fold / specialise / outer-var / impure / bodyless ---
  { name: "beta-fold-all-known", prog: { call: ["fx1", 10] }, fns: [userFn("fx1", ["x"], { "+": [{ var: "x" }, 1] })] },
  {
    name: "beta-specialise-partial",
    prog: { call: ["gab", 5, { var: "x" }] },
    fns: [userFn("gab", ["a", "b"], { "+": [{ var: "a" }, { "*": [{ var: "b" }, 2] }] })],
  },
  {
    name: "beta-inline-outer-var",
    prog: { call: ["tri", { var: "y" }] },
    fns: [userFn("tri", ["x"], { "*": [{ var: "x" }, 3] })],
  },
  {
    name: "impure-requires-no-inline",
    prog: { call: ["effy", 10] },
    fns: [userFn("effy", ["x"], { "+": [{ var: "x" }, 1] }, [
      { class: { $tag: "Id", entityId: "HasIO" }, args: [] } as unknown as Constraint,
    ])],
  },
  {
    name: "under-application-partial",
    prog: { call: ["gab2", 5] },
    fns: [userFn("gab2", ["a", "b"], { "+": [{ var: "a" }, { var: "b" }] })],
  },

  // --- recursion budget (8 = full unroll; 2 = residual call at the floor) ---
  {
    name: "recursion-power-unroll",
    prog: { call: ["power", { var: "b" }, 3] },
    fns: [userFn("power", ["b", "e"], { if: [{ eq: [{ var: "e" }, 0] }, 1, { mul: [{ var: "b" }, { call: ["power", { var: "b" }, { sub: [{ var: "e" }, 1] }] }] }] })],
    exts: [{ b: 2 }, { b: 5 }],
  },
  {
    name: "recursion-countdown-budget-2",
    prog: { call: ["countdown", { var: "n" }] },
    fns: [userFn("countdown", ["n"], { if: [{ lte: [{ var: "n" }, 0] }, "done", { call: ["countdown", { sub: [{ var: "n" }, 1] }] }] })],
    budget: 2,
    exts: [{ n: 1 }, { n: 5 }],
  },
  {
    name: "recursion-countdown-concrete-folds",
    prog: { call: ["countdown", 100] },
    fns: [userFn("countdown", ["n"], { if: [{ lte: [{ var: "n" }, 0] }, "done", { call: ["countdown", { sub: [{ var: "n" }, 1] }] }] })],
    budget: 2,
  },

  // --- the let/do recovery (desugared applied-ELambda) — D-let ---
  { name: "do-let-concrete", prog: { do: [{ let: { a: 5 } }, { "+": [{ var: "a" }, 1] }] }, cls: "D-let" },
  { name: "do-let-residual-binding", prog: { do: [{ let: { a: { var: "x" } } }, { "+": [{ var: "a" }, 1] }] }, cls: "D-let" },
  { name: "do-let-shadow-known", prog: { do: [{ let: { x: 42 } }, { "+": [{ var: "x" }, 1] }] }, known: { x: 5 }, cls: "D-let" },
  { name: "do-let-scope-chain", prog: { do: [{ let: { a: 2 } }, { let: { b: { "+": [{ var: "a" }, 3] } } }, { "*": [{ var: "b" }, { var: "x" }] }] }, cls: "D-let" },

  // --- $dyn dynamic callees ---
  {
    name: "dyn-callee-string-inlines",
    prog: { call: [{ var: "f" }, { var: "x" }] },
    known: { f: "dbl" },
    fns: [userFn("dbl", ["x"], { "*": [{ var: "x" }, 2] })],
  },
  {
    name: "dyn-callee-concrete-folds",
    prog: { call: [{ var: "f" }, 4] },
    known: { f: "dbl" },
    fns: [userFn("dbl", ["x"], { "*": [{ var: "x" }, 2] })],
  },
  // Unbound dynamic callee: both stay residual; tier-1 skipped (TS keeps the
  // raw {call: [{var}]} which lifts to the SAME $dyn Expr — actually asserted).
  { name: "dyn-callee-unbound", prog: { call: [{ var: "f" }, 4] }, exts: [{ f: "dbl9" }] },

  // --- EMatch: concrete arm-select ---
  {
    name: "match-concrete-bind",
    prog: { match: [{ var: "m" }, { $tag: "Just", _0: { $bind: "v" } }, { "+": [{ var: "v" }, 1] }, "_", 0] },
    known: { m: { $tag: "Just", _0: 6 } },
  },
  {
    name: "match-concrete-wildcard-default",
    prog: { match: [{ var: "m" }, { $tag: "Just", _0: { $bind: "v" } }, { var: "v" }, "_", 99] },
    known: { m: { $tag: "Nothing" } },
  },
  {
    name: "match-concrete-literal-arms",
    prog: { match: [{ var: "op" }, "add", 1, "sub", 2, 0] },
    known: { op: "sub" },
  },
  {
    name: "match-concrete-bool-opaque",
    prog: { match: [{ var: "flag" }, { $tag: "True" }, "on", { $tag: "False" }, "off", "?"] },
    known: { flag: true },
  },
  {
    name: "match-concrete-nested-ctor",
    prog: { match: [{ var: "m" }, { $tag: "Just", _0: { $tag: "Just", _0: { $bind: "v" } } }, { var: "v" }, "_", 0] },
    known: { m: { $tag: "Just", _0: { $tag: "Just", _0: 42 } } },
  },

  // --- EMatch: residual scrutinee (+ pattern-var shadowing) ---
  {
    name: "match-residual-arms-walked",
    prog: { match: [{ var: "m" }, { $tag: "Just", _0: { $bind: "v" } }, { "+": [{ var: "v" }, { "+": [1, 2] }] }, "_", 0] },
    exts: [{ m: { $tag: "Just", _0: 10 } }, { m: { $tag: "Nothing" } }],
  },
  {
    name: "match-residual-shadowing",
    // outer known x=5 must NOT substitute into the arm body where the pattern
    // rebinds x — the runtime binds it at match time.
    prog: { match: [{ var: "m" }, { $tag: "Just", _0: { $bind: "x" } }, { "+": [{ var: "x" }, 1] }, "_", { var: "x" }] },
    known: { x: 5 },
    exts: [{ m: { $tag: "Just", _0: 10 } }, { m: { $tag: "Nothing" } }],
  },

  // --- the Futamura specialisation (the interpreter-dispatch demo) ---
  {
    name: "futamura-dispatch-add",
    prog: { call: ["dispatch9", "add", { var: "x" }, { var: "y" }] },
    fns: [userFn("dispatch9", ["op", "x", "y"], { match: [{ var: "op" }, "add", { add: [{ var: "x" }, { var: "y" }] }, "sub", { sub: [{ var: "x" }, { var: "y" }] }, "mul", { mul: [{ var: "x" }, { var: "y" }] }, 0] })],
  },
  {
    name: "futamura-dispatch-sub",
    prog: { call: ["dispatch9", "sub", { var: "x" }, { var: "y" }] },
    fns: [userFn("dispatch9", ["op", "x", "y"], { match: [{ var: "op" }, "add", { add: [{ var: "x" }, { var: "y" }] }, "sub", { sub: [{ var: "x" }, { var: "y" }] }, "mul", { mul: [{ var: "x" }, { var: "y" }] }, 0] })],
  },

  // --- higher-order call-form folds (the D-4 peEval higher-order power) ---
  { name: "higher-order-map-fold", prog: { call: ["map", [1, 2, 3], { fn: ["x", { "+": [{ var: "x" }, 1] }] }] } },
  { name: "higher-order-filter-fold", prog: { call: ["filter", [1, 2, 3, 4], { fn: ["x", { gt: [{ var: "x" }, 2] }] }] } },
  {
    // The lambda-ARG embodiment of D-λ: std:map is bodyless (@native) so
    // neither side inlines; the TS residual EMBEDS the minted closure value
    // where the Fenel residual keeps the structural ELambda arg — tier-1
    // diverges by representation, semantics agree.
    name: "higher-order-map-residual-arr",
    prog: { call: ["map", { var: "arr" }, { fn: ["x", { "+": [{ var: "x" }, 1] }] }] },
    exts: [{ arr: [1, 2] }, { arr: [] }],
    cls: "semantic",
  },

  // --- named-field construct (the record-form egress) ---
  { name: "construct-namedfield-fold", prog: { construct: ["ELit", { value: 7 }] } },
  {
    name: "construct-namedfield-residual",
    prog: { construct: ["ELit", { value: { var: "x" } }] },
  },

  // --- truthiness strictness regressions (the loose-eq bug class) ---
  { name: "truthy-whitespace-string", prog: { if: [" ", "t", "f"] } },
  { name: "truthy-nested-empty-array", prog: { if: [[[]], "t", "f"] } },
  { name: "truthy-zero-string", prog: { if: ["0", "t", "f"] } },
];

// ---------------------------------------------------------------------------
// The DIVERGENCE-CLASS corpus — rows where TS and Fenel legitimately differ;
// each asserts its class's contract (documented in the .fenel header ladder).
// ---------------------------------------------------------------------------

const DIVERGENCE_CORPUS: Row[] = [
  // D-lambda — a lambda VALUE result: TS mints a closure, Fenel keeps ELambda.
  { name: "bare-lambda-value", prog: { fn: ["x", { "+": [{ var: "x" }, 1] }] }, cls: "D-lambda" },
  // D-nolift — `|>` / `apply` / an eager op don't lift; identity residual.
  { name: "pipe-nolift", prog: { "|>": [{ var: "x" }, "negate"] }, cls: "D-nolift", exts: [{ x: 1 }, { x: -3 }] },
  { name: "apply-nolift", prog: { apply: ["add", [1, 2]] }, cls: "D-nolift" },
  { name: "eager-op-nolift", prog: { length: [[1, 2, 3]] }, cls: "D-nolift" },
  // D-guard — the TS guard bug: guarded arm SKIPPED on a concrete scrutinee.
  {
    name: "guarded-match-ts-bug",
    prog: {
      match: [
        { var: "m" },
        { $guard: [{ $tag: "Just", _0: { $bind: "v" } }, { gt: [{ var: "v" }, 0] }] },
        "guarded-arm",
        "_",
        "default-arm",
      ],
    },
    known: { m: { $tag: "Just", _0: 5 } },
    cls: "D-guard",
  },
];

// ---------------------------------------------------------------------------
// The differential.
// ---------------------------------------------------------------------------

describe("partial-evaluate — Fenel PE soundness vs ground truth (Phase 1R)", () => {
  for (const row of [...CORPUS, ...DIVERGENCE_CORPUS]) {
    test(row.name, () => {
      const known = row.known ?? {};
      const ctx = oracleCtx(row.fns, row.budget);
      const fen = dispatchedPartialEvalDetailed(row.prog, known, row.budget, row.fns);
      const exts = row.exts ?? DEFAULT_EXTS;

      // The Fenel PE's value under an extension context. A residual Expr egresses
      // through dispatchedExprToJsonLogic (except the D-nolift identity valve,
      // whose residual IS the raw original JSON-Logic — no egress).
      const fenJl =
        fen.$tag === "Residual"
          ? row.cls === "D-nolift"
            ? fen.expr
            : dispatchedExprToJsonLogic(fen.expr)
          : undefined;
      // The combined context for the soundness law: `known` (the PE static
      // channel, already substituted) is authoritative, so it WINS over `ext`
      // when a row's `known` key collides with a DEFAULT_EXTS key (e.g. `flag` /
      // `x` / `user`). This is the `ctx1 ∪ ctx2` of the law with ctx1-precedence.
      const combined = (ext: Record<string, unknown>): Record<string, unknown> => ({
        ...ext,
        ...known,
      });
      const fenValue = (ext: Record<string, unknown>): unknown =>
        fen.$tag === "Concrete" ? fen.value : evaluate(fenJl, combined(ext), ctx);
      // GROUND TRUTH — the source program evaluated under the combined context.
      const groundTruth = (ext: Record<string, unknown>): unknown =>
        evaluate(row.prog, combined(ext), ctx);

      switch (row.cls) {
        case undefined:
        case "D-let":
        case "semantic": {
          // SOUNDNESS: `evaluate(PE(prog, known), ext) ≡ evaluate(prog, known ∪
          // ext)`. (Tier-1 Expr-shape parity retired with the TS oracle; for
          // D-let/semantic the Fenel tree legitimately differs from the retired
          // TS one — β-consumed frames / structural lambdas — so soundness IS
          // the whole contract.)
          for (const ext of exts) {
            expect(fenValue(ext), `${row.name}: sound vs ground truth`).toEqual(groundTruth(ext));
          }
          return;
        }
        case "D-lambda": {
          // A lambda-valued result: the Fenel PE keeps a structural ELambda.
          // Assert applied-equality vs the SOURCE lambda (ground truth).
          expect(fen.$tag, `${row.name}: structural tag`).toBe("Residual");
          const fenLambda = (fen as { expr?: unknown }).expr as { $tag?: string };
          expect(fenLambda.$tag, `${row.name}: ELambda kept`).toBe("ELambda");
          const fenClosure = evaluate(fenJl, known, ctx);
          const gtClosure = evaluate(row.prog, known, ctx);
          for (const arg of [5, 0]) {
            expect(
              evaluate({ call: [fenClosure, arg] }, {}, ctx),
              `${row.name}: applied equality vs ground truth`,
            ).toEqual(evaluate({ call: [gtClosure, arg] }, {}, ctx));
          }
          return;
        }
        case "D-nolift": {
          // The ingress identity valve: the Fenel residual IS the original
          // program, asserted against GROUND TRUTH (identity is sound by
          // construction). Note the retired TS PE actually DIVERGED from ENGINE
          // semantics here — e.g. its walkPipeBin reduced `{|>: [{var:x},
          // "negate"]}` to `{call:["sub",0,x]}` (⇒ -1 at x=1) while the engine
          // evaluates the SAME `|>` JSON to null. The Fenel valve preserves the
          // engine's semantics; ground truth is the reference.
          expect(fen.$tag, `${row.name}: identity residual`).toBe("Residual");
          expect((fen as { expr?: unknown }).expr, `${row.name}: identity preserved`).toEqual(row.prog);
          for (const ext of exts) {
            expect(fenValue(ext), `${row.name}: D-nolift == ground truth`).toEqual(groundTruth(ext));
          }
          return;
        }
        case "D-guard": {
          // Guarded arm on a concrete scrutinee: the Fenel walker bails to a
          // SOUND residual (the retired TS matchPatternPE had a BUG — it walked
          // `$guard` as an object key, skipped the guarded arm, and could pick
          // the WRONG arm concretely). Asserted vs GROUND TRUTH, which fires the
          // guard (v=5 > 0 ⇒ "guarded-arm").
          expect(fen.$tag, `${row.name}: sound residual`).toBe("Residual");
          for (const ext of exts) {
            expect(fenValue(ext), `${row.name}: Fenel == ground truth`).toEqual(groundTruth(ext));
          }
          expect(groundTruth({}), `${row.name}: ground truth fires the guard`).toBe("guarded-arm");
          return;
        }
      }
    });
  }
});
