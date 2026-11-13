// expr-substrate Phase 14a — conformance tests for `symbolizeEffects` /
// `solveSymbolic` / `solveFnSymbolic` (brief:
// `workstreams/expr-substrate/briefs/phase-14a-symbolize-effects.md`; design:
// `design/symbolic-execution.md`; Step-0 lock:
// `workstreams/expr-substrate/notes/phase-14-step0.md`).
//
// THE THESIS under test: symbolic execution of effectful Fenel code is a PURE
// `Expr -> Expr` rewrite + the already-shipped solver. Each effect-call site
// becomes a fresh unknown `EVar`; `solve` finds the read-value that satisfies
// the predicate — WITHOUT performing the IO. Zero new solver surface, no new
// `Expr` case, no native, no evaluator strategy. These tests promote the
// Step-0 PROBE C/D/E into shipped, registry-backed conformance + pin the D-A
// recogniser, the D-B fence, the dot-free-name Step-0 surprise, and the
// two-distinct-sites no-collision property.

import { describe, it, expect } from "vitest";
import {
  dispatchEngineBody,
  dispatchedSolve,
  dispatchedSymbolize,
  dispatchedSolveSymbolic,
  dispatchedSolveFnSymbolic,
} from "./engine-bodies-dispatch";

// --- tiny Expr builders (plain $tag-tagged objects) ----------------------
const EVar = (name: string) => ({ $tag: "EVar", name });
const ELit = (value: unknown) => ({ $tag: "ELit", value });
const ECall = (fnId: string, args: unknown[]) => ({ $tag: "ECall", fnId, args });

// FenelClosure the way the `fn` op builds it (json-logic.ts:1729).
const closure = (
  params: string[],
  body: unknown,
  scope: Record<string, unknown> = {},
) => ({ __fenelFn: true as const, params, body, closure: scope });

type MaybeV = { $tag: string; _0?: unknown };

const STATE_GET = "$effect:HasStateIO:getInstance"; // canonical sentinel form
const isEffect = (set: string[], fnId: string) =>
  dispatchEngineBody("engine:isEffectFnId", [set, fnId]) as boolean;
const siteName = (fnId: string, path: string) =>
  dispatchEngineBody("engine:effectSiteName", [fnId, path]) as string;

// ---------------------------------------------------------------------------
// D-A — the hybrid recogniser (caller set ∪ the `$effect:` sentinel)
// ---------------------------------------------------------------------------

describe("isEffectFnId — D-A hybrid recogniser", () => {
  it("recognises a caller-supplied effect fnId (option (c) — the registry set)", () => {
    expect(isEffect(["state:getInstance"], "state:getInstance")).toBe(true);
    expect(isEffect(["state:getInstance"], "std:add")).toBe(false);
  });

  it("recognises a `$effect:<Class>:<method>` sentinel with an EMPTY set (option (a))", () => {
    expect(isEffect([], STATE_GET)).toBe(true);
    expect(isEffect([], "$effect:HasCryptoRandom:nextNumber")).toBe(true);
    // a malformed sentinel is NOT recognised (parseEffectFnId ⇒ Nothing)
    expect(isEffect([], "$effect:")).toBe(false);
    // a plain pure fnId with an empty set ⇒ not an effect
    expect(isEffect([], "eq")).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// effectSiteName — the dot-free deterministic namer (the Step-0 surprise)
// ---------------------------------------------------------------------------

describe("effectSiteName — dot-free, deterministic, distinct-per-site", () => {
  it("produces `?<fnId>@<path>` and contains NO `.` (the collectFreeVars field-access constraint)", () => {
    const n = siteName(STATE_GET, "0");
    expect(n).toBe(`?${STATE_GET}@0`);
    expect(n.includes(".")).toBe(false);
  });

  it("distinct paths ⇒ distinct names (no gensym counter needed)", () => {
    expect(siteName(STATE_GET, "0/0")).not.toBe(siteName(STATE_GET, "0/1"));
  });

  it("REGRESSION: a `.` in an EVar name truncates the free var ⇒ solve misses it; a `/` name does not", () => {
    // `?a.b` is parsed as field-access `?a` by collectFreeVars (Step-0): the
    // free var becomes `?a`, which no longer matches the EVar `?a.b` ⇒ Nothing.
    expect((dispatchedSolve(ECall("eq", [EVar("?a.b"), ELit(42)])) as MaybeV).$tag).toBe("Nothing");
    // the dot-free `/`-separated form solve consumes correctly.
    expect(dispatchedSolve(ECall("eq", [EVar("?a/b"), ELit(42)]))).toEqual({ $tag: "Just", _0: 42 });
  });
});

// ---------------------------------------------------------------------------
// symbolizeEffects — the pure rewrite (PROBE D)
// ---------------------------------------------------------------------------

describe("symbolizeEffects — effect site → fresh EVar; everything else passes through", () => {
  it("an effect call becomes a fresh site-named EVar; pure args untouched", () => {
    // eq (state:getInstance "counter") 42 — recognised via the set.
    const prog = ECall("eq", [ECall("state:getInstance", [ELit("counter")]), ELit(42)]);
    const out = dispatchedSymbolize(["state:getInstance"], prog) as {
      $tag: string;
      fnId: string;
      args: Array<{ $tag: string; name?: string; value?: unknown }>;
    };
    expect(out.$tag).toBe("ECall");
    expect(out.fnId).toBe("eq");
    // arg 0 = the rewritten read (EVar, NOT an ECall); arg 1 = the literal.
    expect(out.args[0]!.$tag).toBe("EVar");
    expect(out.args[0]!.name).toBe("?state:getInstance@0/0");
    expect(out.args[1]).toEqual(ELit(42));
  });

  it("recognises the `$effect:` sentinel with an EMPTY set", () => {
    const prog = ECall("eq", [ECall(STATE_GET, [ELit("counter")]), ELit(42)]);
    const out = dispatchedSymbolize([], prog) as { args: Array<{ $tag: string; name?: string }> };
    expect(out.args[0]!.$tag).toBe("EVar");
    expect(out.args[0]!.name).toBe(`?${STATE_GET}@0/0`);
  });

  it("a NON-effect call is left structurally intact (no spurious symbolization)", () => {
    const prog = ECall("eq", [ECall("add", [ELit(1), ELit(2)]), ELit(3)]);
    const out = dispatchedSymbolize(["state:getInstance"], prog);
    expect(out).toEqual(prog);
  });

  it("TWO distinct effect sites ⇒ TWO distinct names (no collision)", () => {
    // and (eq (read) 1) (eq (read) 2) — two reads at distinct structural paths.
    const prog = ECall("and", [
      ECall("eq", [ECall("state:getInstance", [ELit("a")]), ELit(1)]),
      ECall("eq", [ECall("state:getInstance", [ELit("b")]), ELit(2)]),
    ]);
    const out = dispatchedSymbolize(["state:getInstance"], prog) as {
      args: Array<{ args: Array<{ $tag: string; name?: string }> }>;
    };
    const n0 = out.args[0]!.args[0]!.name;
    const n1 = out.args[1]!.args[0]!.name;
    expect(out.args[0]!.args[0]!.$tag).toBe("EVar");
    expect(out.args[1]!.args[0]!.$tag).toBe("EVar");
    expect(n0).not.toBe(n1); // distinct paths ⇒ distinct names
  });
});

// ---------------------------------------------------------------------------
// solveSymbolic — THE HEADLINE: solve an effectful predicate WITHOUT the IO
// ---------------------------------------------------------------------------

describe("solveSymbolic — IO result as just-another-unknown (the headline)", () => {
  it("eq (state:getInstance \"counter\") 42 ⇒ Just 42 — NO state read performed", () => {
    const prog = ECall("eq", [ECall(STATE_GET, [ELit("counter")]), ELit(42)]);
    // The rewrite removes the effect ECall ENTIRELY before solve runs — so no
    // IO handler can fire (there is no state ECall left to evaluate).
    const symbolized = dispatchedSymbolize([], prog) as { args: Array<{ $tag: string }> };
    expect(symbolized.args[0]!.$tag).toBe("EVar"); // no ECall to the effect remains
    // and the solve finds the read that satisfies the predicate.
    expect(dispatchedSolveSymbolic(prog)).toEqual({ $tag: "Just", _0: 42 });
  });

  it("works through the registry `requires`-walk set too (a real effectful fnId)", () => {
    // state:* fns aren't in this harness, but `$effect:`-marked sites are
    // ALWAYS recognised; confirm the composed entry round-trips both reads.
    const prog = ECall("eq", [ELit(7), ECall(STATE_GET, [ELit("k")])]); // flipped orientation
    expect(dispatchedSolveSymbolic(prog)).toEqual({ $tag: "Just", _0: 7 });
  });

  it("a non-effectful predicate solves exactly as plain `solve` (rewrite is a no-op)", () => {
    const prog = ECall("eq", [EVar("x"), ELit(5)]);
    expect(dispatchedSolveSymbolic(prog)).toEqual({ $tag: "Just", _0: 5 });
  });
});

// ---------------------------------------------------------------------------
// solveFnSymbolic — the lambda case (PROBE E): reify ∘ symbolize ∘ solve
// ---------------------------------------------------------------------------

describe("solveFnSymbolic — the lambda-wrapped effectful predicate", () => {
  it("\\_ -> eq (state:getInstance \"counter\") 42 ⇒ Just 42 (the only unknown is the read)", () => {
    const fn = closure([], { call: ["eq", { call: [STATE_GET, "counter"] }, 42] });
    expect(dispatchedSolveFnSymbolic(fn)).toEqual({ $tag: "Just", _0: 42 });
  });

  it("a native / bodyless fn ⇒ Nothing (reify Err ⇒ Nothing, like solveFn)", () => {
    expect((dispatchedSolveFnSymbolic("std:add") as MaybeV).$tag).toBe("Nothing");
  });
});

// ---------------------------------------------------------------------------
// D-B — `if`/`match` path-sensitivity is FENCED in 14a (evidence-backed)
// ---------------------------------------------------------------------------

describe("D-B fence — branching predicates (the intervals-only intersect blocker LIFTED by decide-substrate Phase 4 search)", () => {
  it("decide-substrate Phase 4 Step B GAIN: `and (eq ?k 5) True` ⇒ Just 5 — the old intervals-only intersect fence (Nothing) is subsumed by the ∩ witness search (generator {5} ∩ SeAll)", () => {
    // comprehend lowers this to SeIntersect[SeEnum[5], SeAll]; the v1 interval-fold
    // fenced it (a non-interval branch ⇒ Nothing). The search core now witnesses:
    // generator {5}, filter SeAll (contains 5 ⇒ Just true) ⇒ Just 5. A strictly-
    // better Nothing→Just gain (the differential's expected direction).
    const prog = ECall("and", [ECall("eq", [EVar("?k"), ELit(5)]), ELit(true)]);
    const r = dispatchedSolve(prog) as MaybeV;
    expect(r.$tag).toBe("Just");
    expect(r._0).toBe(5);
  });

  it("so a symbolized branching predicate `if (read) then True else False` ⇒ Nothing (fenced, not witnessing — recorded, no if→boolean rewrite shipped)", () => {
    // if is `ECall "if" […]`; predicateToSet does not recognise it ⇒ WsWhere.
    const prog = ECall("if", [ECall(STATE_GET, [ELit("flag")]), ELit(true), ELit(false)]);
    expect((dispatchedSolveSymbolic(prog) as MaybeV).$tag).toBe("Nothing");
  });
});
