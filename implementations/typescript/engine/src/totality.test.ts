// unified-static-analysis Phase 1 — conformance tests for the totality
// checker (rung 1, structural recursion). Brief:
// `workstreams/unified-static-analysis/briefs/phase-1-analyze-skeleton-and-totality-rung1.md`.
//
// Invocation path mirrors desugar.test.ts: `dispatchEngineBody("engine:…", […])`
// over hand-built core `Expr` / `Pattern` trees (plain `{$tag, …}` objects — the
// `construct` op tags with `$tag`; the body pattern-matches on it). Name-lists
// (params / pattern args) are plain JS arrays (the List "array" repr). Verdicts
// are read off the returned Totality value's `$tag` (Total / Unknown / Partial).
//
// Coverage: non-recursive ⇒ Total; structural recursion on a destructured field
// ⇒ Total; nested-constructor decrease ⇒ Total; recursion on an unchanged param
// ⇒ Unknown; mixed good+bad self-calls ⇒ Unknown (ALL must decrease); the
// SOUNDNESS case — a decreasing var shadowed by a lambda param ⇒ Unknown (never
// wrongly Total); and totalityVerdict folding the @partial escape-hatch.

import { describe, it, expect } from "vitest";
import { dispatchEngineBody } from "./engine-bodies-dispatch";

// --- tiny Expr / Pattern builders (plain $tag-tagged objects) -----------
const ELit = (value: unknown) => ({ $tag: "ELit", value });
const EVar = (name: string) => ({ $tag: "EVar", name });
const ECall = (fnId: string, args: unknown[]) => ({ $tag: "ECall", fnId, args });
const ELambda = (params: string[], body: unknown) => ({ $tag: "ELambda", params, body });
const EMatch = (scrutinee: unknown, arms: unknown[]) => ({ $tag: "EMatch", scrutinee, arms });
const ECon = (ctor: string, args: unknown[]) => ({ $tag: "EConstruct", ctor, args, fields: [] });
const arm = (pattern: unknown, body: unknown) => ({ pattern, body });
const PatVar = (name: string) => ({ $tag: "PatVar", name });
const PatCon = (ctor: string, args: unknown[]) => ({ $tag: "PatConstruct", ctor, args });

// rung-2 sugar. Stored bodies spell comparisons / arithmetic with the bare
// desugar codenames (`>` ⇒ gt, `-` ⇒ sub, … — fixity-resolve.fenel
// DEFAULT_OPERATOR_FIXITY); the oracle reads facts only off the CANONICAL ids
// its callers resolve them to (std:gt, std:sub, … — 2026-10-03), so these
// builders emit the resolved form. `bare*` keep the unresolved spelling.
const If = (cond: unknown, thenE: unknown, elseE: unknown) => ECall("if", [cond, thenE, elseE]);
const sub = (a: unknown, b: unknown) => ECall("std:sub", [a, b]);
const add = (a: unknown, b: unknown) => ECall("std:add", [a, b]);
const eqE = (a: unknown, b: unknown) => ECall("std:eq", [a, b]);
const gt = (a: unknown, b: unknown) => ECall("std:gt", [a, b]);
const gte = (a: unknown, b: unknown) => ECall("std:gte", [a, b]);
const lt = (a: unknown, b: unknown) => ECall("std:lt", [a, b]);
const lte = (a: unknown, b: unknown) => ECall("std:lte", [a, b]);
const orE = (args: unknown[]) => ECall("std:or", args);
const andE = (args: unknown[]) => ECall("std:and", args);
// `v > 0 && v <= 1000`: positivity, the exact-decrement bound and Number-ness —
// the evidence a unit countdown needs over JS Numbers (2026-10-03).
const posB = (v: string) => andE([gt(EVar(v), ELit(0)), lte(EVar(v), ELit(1000))]);
const bareSub = (a: unknown, b: unknown) => ECall("sub", [a, b]);
const bareGt = (a: unknown, b: unknown) => ECall("gt", [a, b]);
const bareLte = (a: unknown, b: unknown) => ECall("lte", [a, b]);

const tag = (v: unknown) => (v as { $tag: string }).$tag;

const check = (selfId: string, params: string[], body: unknown) =>
  dispatchEngineBody("engine:checkStructuralTotality", [selfId, params, body]);
const verdict = (declaredPartial: boolean, selfId: string, params: string[], body: unknown) =>
  dispatchEngineBody("engine:totalityVerdict", [declaredPartial, selfId, params, body]);

// rung-3c (slice C) — the MUTUAL-recursion entry over a function GROUP. A group
// member is `{ id, params, body }` (the mutually-recursive set the caller
// supplies — slice C does not discover SCCs itself).
const member = (id: string, params: string[], body: unknown) => ({ id, params, body });
const checkMutual = (group: unknown[]) =>
  dispatchEngineBody("engine:checkMutualTotality", [group]);

describe("checkStructuralTotality — rung 1 (structural recursion)", () => {
  it("non-recursive body ⇒ Total", () => {
    // f x = x
    expect(tag(check("f", ["x"], EVar("x")))).toBe("Total");
  });

  it("a callee that is not self ⇒ Total (no self-recursion to police)", () => {
    // f x = g x x   (g ≠ f)
    expect(tag(check("f", ["x"], ECall("g", [EVar("x"), EVar("x")])))).toBe("Total");
  });

  it("structural recursion on a destructured field ⇒ Total", () => {
    // length xs = case xs of Cons h t -> add 1 (length t) ; Nil -> 0
    const body = EMatch(EVar("xs"), [
      arm(
        PatCon("Cons", [PatVar("h"), PatVar("t")]),
        ECall("add", [ELit(1), ECall("length", [EVar("t")])]),
      ),
      arm(PatCon("Nil", []), ELit(0)),
    ]);
    expect(tag(check("length", ["xs"], body))).toBe("Total");
  });

  it("nested-constructor decrease ⇒ Total", () => {
    // f t = case t of Cons h (Cons h2 t2) -> f t2
    const body = EMatch(EVar("t"), [
      arm(
        PatCon("Cons", [PatVar("h"), PatCon("Cons", [PatVar("h2"), PatVar("t2")])]),
        ECall("f", [EVar("t2")]),
      ),
    ]);
    expect(tag(check("f", ["t"], body))).toBe("Total");
  });

  it("recursion on an unchanged parameter ⇒ Unknown", () => {
    // loop xs = loop xs   (xs is a param, never destructured ⇒ not smaller)
    expect(tag(check("loop", ["xs"], ECall("loop", [EVar("xs")])))).toBe("Unknown");
  });

  it("recursion on the matched scrutinee itself (not its fields) ⇒ Unknown", () => {
    // f xs = case xs of Cons h t -> f xs    (calls on xs, not t)
    const body = EMatch(EVar("xs"), [
      arm(PatCon("Cons", [PatVar("h"), PatVar("t")]), ECall("f", [EVar("xs")])),
    ]);
    expect(tag(check("f", ["xs"], body))).toBe("Unknown");
  });

  it("mixed good + bad self-calls ⇒ Unknown (every self-call must decrease)", () => {
    // f xs = case xs of Cons h t -> add (f t) (f xs) ; Nil -> 0
    const body = EMatch(EVar("xs"), [
      arm(
        PatCon("Cons", [PatVar("h"), PatVar("t")]),
        ECall("add", [ECall("f", [EVar("t")]), ECall("f", [EVar("xs")])]),
      ),
      arm(PatCon("Nil", []), ELit(0)),
    ]);
    expect(tag(check("f", ["xs"], body))).toBe("Unknown");
  });

  it("SOUNDNESS: a decreasing var shadowed by a lambda param ⇒ Unknown, never Total", () => {
    // f xs = case xs of Cons h t -> ($ (\t -> f t) t)
    // The inner lambda's `t` shadows the smaller `t`; `f t` inside it is on the
    // FRESH binding, not the structurally-smaller one — so it is NOT a proven
    // decrease. A checker that ignored shadowing would wrongly say Total.
    const body = EMatch(EVar("xs"), [
      arm(
        PatCon("Cons", [PatVar("h"), PatVar("t")]),
        ECall("$", [ELambda(["t"], ECall("f", [EVar("t")])), EVar("t")]),
      ),
    ]);
    expect(tag(check("f", ["xs"], body))).toBe("Unknown");
  });

  it("a smaller var used unshadowed elsewhere still proves Total", () => {
    // control for the shadowing test: f xs = case xs of Cons h t -> f t
    const body = EMatch(EVar("xs"), [
      arm(PatCon("Cons", [PatVar("h"), PatVar("t")]), ECall("f", [EVar("t")])),
    ]);
    expect(tag(check("f", ["xs"], body))).toBe("Total");
  });
});

describe("checkStructuralTotality — rung 2 (guarded measure / well-founded descent)", () => {
  it("THE soundness case: unguarded f (v - 1) ⇒ Unknown, never Total", () => {
    // f v = f (v - 1)   — NO guard ⇒ v may underflow (0 → -1 → -2 → …) ⇒ diverges.
    // A wrong Total here is the exact unsoundness totality exists to prevent.
    expect(tag(check("f", ["v"], ECall("f", [sub(EVar("v"), ELit(1))])))).toBe("Unknown");
  });

  it("the rung-2 win: f v = if v > 0 then f (v - 1) else 0 ⇒ Total", () => {
    const body = If(posB("v"), ECall("f", [sub(EVar("v"), ELit(1))]), ELit(0));
    expect(tag(check("f", ["v"], body))).toBe("Total");
  });

  it("flipped guard: f v = if 0 < v && 1000 > v then f (v - 1) else 0 ⇒ Total", () => {
    const body = If(andE([lt(ELit(0), EVar("v")), gt(ELit(1000), EVar("v"))]), ECall("f", [sub(EVar("v"), ELit(1))]), ELit(0));
    expect(tag(check("f", ["v"], body))).toBe("Total");
  });

  it("gte guard: f v = if v >= 1 && v < 1000 then f (v - 1) else 0 ⇒ Total", () => {
    const body = If(andE([gte(EVar("v"), ELit(1)), lt(EVar("v"), ELit(1000))]), ECall("f", [sub(EVar("v"), ELit(1))]), ELit(0));
    expect(tag(check("f", ["v"], body))).toBe("Total");
  });

  it("else-form: f v = if v <= 0 then 0 else if v <= 1000 then f (v - 1) else 0 ⇒ Total (false-branch narrows)", () => {
    // The else branch of `v <= 0` gives v > 0 only for a non-NaN number; the
    // true branch of `v <= 1000` proves that (and the bound).
    const body = If(lte(EVar("v"), ELit(0)), ELit(0), If(lte(EVar("v"), ELit(1000)), ECall("f", [sub(EVar("v"), ELit(1))]), ELit(0)));
    expect(tag(check("f", ["v"], body))).toBe("Total");
  });

  it("guard/decrement mismatch fence: if v > 0 then f (v - 2) ⇒ Unknown (k=2 may underflow at v=1)", () => {
    const body = If(posB("v"), ECall("f", [sub(EVar("v"), ELit(2))]), ELit(0));
    expect(tag(check("f", ["v"], body))).toBe("Unknown");
  });

  it("or-guard cannot narrow: if (or [v > 0, p]) then f (v - 1) ⇒ Unknown", () => {
    // The true-branch of an `or` does not prove any disjunct, so `v > 0` is not
    // established ⇒ the measure floor is unknown ⇒ Unknown.
    const body = If(orE([posB("v"), EVar("p")]), ECall("f", [sub(EVar("v"), ELit(1))]), ELit(0));
    expect(tag(check("f", ["v"], body))).toBe("Unknown");
  });

  it("mixed self-calls under one guard ⇒ Unknown (every self-call must decrease)", () => {
    // f v = if v > 0 then add (f (v - 1)) (f v) else 0   — the `f v` call is not decreasing.
    const body = If(
      posB("v"),
      ECall("add", [ECall("f", [sub(EVar("v"), ELit(1))]), ECall("f", [EVar("v")])]),
      ELit(0),
    );
    expect(tag(check("f", ["v"], body))).toBe("Unknown");
  });

  it("SOUNDNESS: a pos var shadowed by a lambda param before the self-call ⇒ Unknown", () => {
    // f v = if v > 0 then ($ (\v -> f (v - 1)) v) else 0
    // The inner lambda's `v` shadows the guarded `v`; `f (v - 1)` inside it is on
    // the FRESH binding, NOT known > 0 — the stale `pos` must be dropped.
    const body = If(
      posB("v"),
      ECall("$", [ELambda(["v"], ECall("f", [sub(EVar("v"), ELit(1))])), EVar("v")]),
      ELit(0),
    );
    expect(tag(check("f", ["v"], body))).toBe("Unknown");
  });

  it("structural + measure union: structural on one arg, measure on another ⇒ Total", () => {
    // f t n = if n > 0 then (case t of Cons h rest -> f rest (n - 1) ; Nil -> 0) else 0
    // The self-call f rest (n - 1) decreases by BOTH rungs (rest is structurally
    // smaller; n - 1 is a guarded measure) — the union still proves Total.
    const inner = EMatch(EVar("t"), [
      arm(PatCon("Cons", [PatVar("h"), PatVar("rest")]), ECall("f", [EVar("rest"), sub(EVar("n"), ELit(1))])),
      arm(PatCon("Nil", []), ELit(0)),
    ]);
    const body = If(posB("n"), inner, ELit(0));
    expect(tag(check("f", ["t", "n"], body))).toBe("Total");
  });

  it("guarded measure with the numeric param unchanged elsewhere ⇒ Total", () => {
    // f v = if v > 0 then f (v - 1) else f-with-no-call... pure measure descent.
    // (Re-checks the canonical case via totalityVerdict's chain in the next block.)
    const body = If(posB("v"), ECall("f", [sub(EVar("v"), ELit(1))]), ELit(0));
    expect(tag(verdict(false, "f", ["v"], body))).toBe("Total");
  });
});

describe("trusted primitive identities (2026-10-03)", () => {
  it("a countdown whose comparison and decrement are bare spellings yields no fact ⇒ Unknown", () => {
    // gt a b = True; sub a b = a; loop n = if gt n 0 then loop (sub n 1) else 0
    // diverges; a bare spelling may name such a user function, so it proves nothing.
    const body = If(bareGt(EVar("n"), ELit(0)), If(bareLte(EVar("n"), ELit(1000)), ECall("loop", [bareSub(EVar("n"), ELit(1))]), ELit(0)), ELit(0));
    expect(tag(check("loop", ["n"], body))).toBe("Unknown");
  });

  it("the same countdown over the canonical std ids ⇒ Total", () => {
    const body = If(gt(EVar("n"), ELit(0)), If(lte(EVar("n"), ELit(1000)), ECall("loop", [sub(EVar("n"), ELit(1))]), ELit(0)), ELit(0));
    expect(tag(check("loop", ["n"], body))).toBe("Total");
  });

  it("a bare `and` is no conjunction: its operands prove nothing in the true branch", () => {
    const body = If(ECall("and", [gt(EVar("n"), ELit(0)), lte(EVar("n"), ELit(1000))]), ECall("loop", [sub(EVar("n"), ELit(1))]), ELit(0));
    expect(tag(check("loop", ["n"], body))).toBe("Unknown");
    const trusted = If(andE([gt(EVar("n"), ELit(0)), lte(EVar("n"), ELit(1000))]), ECall("loop", [sub(EVar("n"), ELit(1))]), ELit(0));
    expect(tag(check("loop", ["n"], trusted))).toBe("Total");
  });
});

describe("a binder that shadows a source parameter hides it (2026-10-03)", () => {
  // The guard is bounded so that only the shadowing decides the verdict.
  const countdownOn = (v: string, self: string, rest: unknown[] = []) =>
    If(andE([gt(EVar(v), ELit(0)), lte(EVar(v), ELit(1000))]), ECall(self, [sub(EVar(v), ELit(1)), ...rest]), ELit(0));

  it("lambda shadow: loop n = (\\n -> if n > 0 then loop (n - 1) else 0) $ 1 ⇒ Unknown", () => {
    // The inner n is always 1: loop 0 → loop 0 → … never returns.
    const body = ECall("$", [ELambda(["n"], countdownOn("n", "loop")), ELit(1)]);
    expect(tag(check("loop", ["n"], body))).toBe("Unknown");
  });

  it("let shadow (an applied lambda over a non-literal value): loop n = let n = 1 + 0 in … ⇒ Unknown", () => {
    const body = ECall("$", [ELambda(["n"], countdownOn("n", "loop")), add(ELit(1), ELit(0))]);
    expect(tag(check("loop", ["n"], body))).toBe("Unknown");
  });

  it("pattern shadow: f n xs = case xs of Cons n t -> if n > 0 then f (n - 1) xs else 0 ⇒ Unknown", () => {
    // n is the list head: xs never shrinks and n is re-read from it each call.
    const body = EMatch(EVar("xs"), [
      arm(PatCon("Cons", [PatVar("n"), PatVar("t")]), countdownOn("n", "f", [EVar("xs")])),
      arm(PatCon("Nil", []), ELit(0)),
    ]);
    expect(tag(check("f", ["n", "xs"], body))).toBe("Unknown");
  });

  it("the unshadowed countdown stays Total (no false reject)", () => {
    expect(tag(check("loop", ["n"], countdownOn("n", "loop")))).toBe("Total");
  });
});

describe("rung 2 over JS Numbers: a unit decrement needs a well-founded, exact domain (2026-10-03)", () => {
  const countdown = (guard: unknown) => If(guard, ECall("f", [sub(EVar("v"), ELit(1))]), ELit(0));

  it("an unbounded countdown is Unknown: 1e20 - 1 = 1e20 and Infinity - 1 = Infinity", () => {
    expect(tag(check("f", ["v"], countdown(gt(EVar("v"), ELit(0)))))).toBe("Unknown");
  });

  it("the else-form without a positive comparison is Unknown: NaN passes every negated test", () => {
    // f NaN: NaN <= 0 is false, so f (NaN - 1) = f NaN forever.
    const body = If(lte(EVar("v"), ELit(0)), ELit(0), ECall("f", [sub(EVar("v"), ELit(1))]));
    expect(tag(check("f", ["v"], body))).toBe("Unknown");
    // Both bounds from negations still admit NaN.
    const negations = If(lte(EVar("v"), ELit(0)), ELit(0), If(gt(EVar("v"), ELit(1000)), ELit(0), ECall("f", [sub(EVar("v"), ELit(1))])));
    expect(tag(check("f", ["v"], negations))).toBe("Unknown");
  });

  it("a bound above 2^53 is no evidence, nor is a non-numeric literal", () => {
    expect(tag(check("f", ["v"], countdown(andE([gt(EVar("v"), ELit(0)), lte(EVar("v"), ELit(1e20))]))))).toBe("Unknown");
    expect(tag(check("f", ["v"], countdown(andE([gt(EVar("v"), ELit(0)), lte(EVar("v"), ELit("1000"))]))))).toBe("Unknown");
  });

  it("positivity, the bound and Number-ness together prove the countdown", () => {
    expect(tag(check("f", ["v"], countdown(posB("v"))))).toBe("Total");
    expect(tag(check("f", ["v"], countdown(andE([gt(EVar("v"), ELit(0)), lt(EVar("v"), ELit(9007199254740992))]))))).toBe("Total");
  });
});

describe("list literals are constructions (2026-10-03)", () => {
  // `[item]` lowers to `appendItem item []` marked `lit = true`.
  const litAppend = (item: unknown, rest: unknown) => ({ ...ECall("appendItem", [item, rest]), lit: true });

  it("appendItem item arr = concat arr [item] ⇒ Total: the literal is no self-call", () => {
    const body = ECall("std:concat", [EVar("arr"), litAppend(EVar("item"), ELit([]))]);
    expect(tag(checkMutual([member("std:appendItem", ["item", "arr"], body)]))).toBe("Total");
  });

  it("the same body with an UNMARKED appendItem is a non-decreasing self-call ⇒ Unknown", () => {
    const body = ECall("std:concat", [EVar("arr"), ECall("appendItem", [EVar("item"), ELit([])])]);
    expect(tag(checkMutual([member("std:appendItem", ["item", "arr"], body)]))).toBe("Unknown");
  });

  it("a recursion inside a literal's element is walked ⇒ Unknown", () => {
    expect(tag(checkMutual([member("f", ["x"], litAppend(ECall("f", [EVar("x")]), ELit([])))]))).toBe("Unknown");
  });
});

describe("over-application invokes the callee's result (2026-10-03)", () => {
  // Arguments beyond a callee's params spill onto its result when that result
  // is callable: the spill invokes a value whose body the walk never checked.
  it("a checked local closure called with more arguments than its lambda has params is Unknown", () => {
    // applyLet f x = let g = \k -> k in g f x   (g f returns f; x spills onto it)
    const body = ECall("$", [ELambda(["g"], ECall("$dyn:g", [EVar("f"), EVar("x")])), ELambda(["k"], EVar("k"))]);
    expect(tag(check("applyLet", ["f", "x"], body))).toBe("Unknown");
    // The exact call stays Total.
    const exact = ECall("$", [ELambda(["g"], ECall("$dyn:g", [EVar("x")])), ELambda(["k"], EVar("k"))]);
    expect(tag(check("useLet", ["x"], exact))).toBe("Total");
  });

  it("a lambda literal applied to more arguments than its params is Unknown", () => {
    // lamOver f x = (\k -> k) $ f x
    const body = ECall("$", [ELambda(["k"], EVar("k")), EVar("f"), EVar("x")]);
    expect(tag(check("lamOver", ["f", "x"], body))).toBe("Unknown");
  });

  it("an over-applied call to a group member is Unknown even when its first argument descends", () => {
    // f xs = case xs of Cons h t -> f t h ; Nil -> 0   (f has one param)
    const body = EMatch(EVar("xs"), [
      arm(PatCon("Cons", [PatVar("h"), PatVar("t")]), ECall("f", [EVar("t"), EVar("h")])),
      arm(PatCon("Nil", []), ELit(0)),
    ]);
    expect(tag(check("f", ["xs"], body))).toBe("Unknown");
  });
});

describe("checkStructuralTotality — rung 3a (lexicographic descent; the multi-arg soundness repair)", () => {
  it("THE soundness repair (structural cross-position): f a b = case a of Cons h t -> f (Cons h t) t ⇒ Unknown", () => {
    // `t` (sub-term of `a`) lands in `b`'s slot; `a` is reconstructed unchanged.
    // f [1,2,3] [] → f [1,2,3] [2,3] → … `a` never shrinks: loops forever.
    // Rungs 1+2 wrongly said Total (position-agnostic) — THIS is the bug fixed.
    const body = EMatch(EVar("a"), [
      arm(
        PatCon("Cons", [PatVar("h"), PatVar("t")]),
        ECall("f", [ECon("Cons", [EVar("h"), EVar("t")]), EVar("t")]),
      ),
    ]);
    expect(tag(check("f", ["a", "b"], body))).toBe("Unknown");
  });

  it("THE soundness repair (measure cross-position): f a b = if a > 0 then f (b + 1) (a - 1) else 0 ⇒ Unknown", () => {
    // `a-1` lands in `b`'s slot; `b+1` in `a`'s. f 2 0 → f 1 1 → f 2 0 cycles
    // (the a > 0 guard holds at every entry). Rungs 1+2 wrongly said Total.
    const body = If(
      posB("a"),
      ECall("f", [add(EVar("b"), ELit(1)), sub(EVar("a"), ELit(1))]),
      ELit(0),
    );
    expect(tag(check("f", ["a", "b"], body))).toBe("Unknown");
  });

  it("lexicographic win (later-arg descent, earlier held): f a b = if b > 0 then f a (b - 1) else 0 ⇒ Total", () => {
    // pos 0 `a` RelEq, pos 1 `b-1` RelLt ⇒ lex-decreasing at k=1.
    const body = If(posB("b"), ECall("f", [EVar("a"), sub(EVar("b"), ELit(1))]), ELit(0));
    expect(tag(check("f", ["a", "b"], body))).toBe("Total");
  });

  it("lexicographic win (two branches, different k): f a b = if a>0 then (if b>0 then f a (b-1) else f (a-1) b) else 0 ⇒ Total", () => {
    // then-then: k=1 on `b`; then-else: k=0 on `a` (the `b` reset is fine — k=0 fires first).
    const inner = If(
      posB("b"),
      ECall("f", [EVar("a"), sub(EVar("b"), ELit(1))]),
      ECall("f", [sub(EVar("a"), ELit(1)), EVar("b")]),
    );
    const body = If(posB("a"), inner, ELit(0));
    expect(tag(check("f", ["a", "b"], body))).toBe("Total");
  });

  it("structural lexicographic: f xs ys = case xs of Cons h t -> f t ys ; Nil -> 0 ⇒ Total", () => {
    // pos 0 `t` RelLt (origin xs = param 0) ⇒ k=0; `ys` held in its own slot.
    const body = EMatch(EVar("xs"), [
      arm(PatCon("Cons", [PatVar("h"), PatVar("t")]), ECall("f", [EVar("t"), EVar("ys")])),
      arm(PatCon("Nil", []), ELit(0)),
    ]);
    expect(tag(check("f", ["xs", "ys"], body))).toBe("Total");
  });

  it("structural + measure mixed positions (both in OWN slots): f t n = if n>0 then (case t of Cons h rest -> f rest (n-1) ; Nil -> 0) else 0 ⇒ Total", () => {
    // pos 0 `rest` RelLt (origin `t` = param 0); pos 1 `n-1` RelLt (`n ∈ pos`); k=0.
    const inner = EMatch(EVar("t"), [
      arm(PatCon("Cons", [PatVar("h"), PatVar("rest")]), ECall("f", [EVar("rest"), sub(EVar("n"), ELit(1))])),
      arm(PatCon("Nil", []), ELit(0)),
    ]);
    const body = If(posB("n"), inner, ELit(0));
    expect(tag(check("f", ["t", "n"], body))).toBe("Total");
  });

  it("permuted/reorder win (slice B UPGRADE): f a b = if a > 0 then f b (a - 1) else 0 ⇒ Total", () => {
    // Terminating, but pos 0 gets `b` (RelUnknown vs `a`) ⇒ no fixed identity
    // order works — slice A said Unknown. Slice B (rung-3b) PROVES it: the
    // call-site graph G = {b →↓= a, a →↓ b}; the idempotent G ; G = {a →↓ a,
    // b →↓ b} carries strict self-edges ⇒ size-change terminating ⇒ Total.
    const body = If(posB("a"), ECall("f", [EVar("b"), sub(EVar("a"), ELit(1))]), ELit(0));
    expect(tag(check("f", ["a", "b"], body))).toBe("Total");
  });

  it("`== 0` equality-guard FENCE (D-3c-2): f m n = if m == 0 then n else f (m - 1) n ⇒ Unknown", () => {
    // Terminating on ℕ (m decreases), but slice A cannot derive `m > 0` from
    // `m ≠ 0` without a ℕ type (the `eq` guard does not narrow `pos`), so pos 0
    // `m-1` is RelUnknown ⇒ Unknown. A wrong Total here would be unsound on ℤ.
    const body = If(eqE(EVar("m"), ELit(0)), EVar("n"), ECall("f", [sub(EVar("m"), ELit(1)), EVar("n")]));
    expect(tag(check("f", ["m", "n"], body))).toBe("Unknown");
  });
});

describe("checkStructuralTotality — rung 3b (size-change graph closure; permuted / reordering descents)", () => {
  it("THE permuted win (measure): f a b = if a > 0 then f b (a - 1) else 0 ⇒ Total", () => {
    // The headline new capability. arg₀ = b (RelEq vs b ⇒ b →↓= a); arg₁ = a-1
    // (a ∈ pos ⇒ a →↓ b). G = {b →↓= a, a →↓ b}; G;G = {a →↓ a, b →↓ b} —
    // idempotent with strict self-edges ⇒ Total (slice A said Unknown).
    const body = If(posB("a"), ECall("f", [EVar("b"), sub(EVar("a"), ELit(1))]), ELit(0));
    expect(tag(check("f", ["a", "b"], body))).toBe("Total");
  });

  it("THE permuted win (structural): f a b = case a of Cons h t -> f b t ; Nil -> 0 ⇒ Total", () => {
    // arg₀ = b (RelEq vs b ⇒ b →↓= a); arg₁ = t (origin a ⇒ a →↓ b). Same
    // idempotent-with-strict-diagonals shape as the measure permuted win.
    const body = EMatch(EVar("a"), [
      arm(PatCon("Cons", [PatVar("h"), PatVar("t")]), ECall("f", [EVar("b"), EVar("t")])),
      arm(PatCon("Nil", []), ELit(0)),
    ]);
    expect(tag(check("f", ["a", "b"], body))).toBe("Total");
  });

  it("multi-step rotation (closure depth ≥ 3): f a b c = if a > 0 then f b c (a - 1) else 0 ⇒ Total", () => {
    // The 3-cycle a →↓ c, c →↓= b, b →↓= a; the strict self-edges surface only
    // after composing THREE times — proves the closure fixpoint (a single
    // composition misses it).
    const body = If(
      posB("a"),
      ECall("f", [EVar("b"), EVar("c"), sub(EVar("a"), ELit(1))]),
      ELit(0),
    );
    expect(tag(check("f", ["a", "b", "c"], body))).toBe("Total");
  });

  it("soundness repair PRESERVED (structural): f a b = case a of Cons h t -> f (Cons h t) t ⇒ Unknown", () => {
    // G = {a →↓ b} (arg₀ = Cons h t construction ⇒ no edge; arg₁ = t origin a ⇒
    // a →↓ b); G;G = {} empty idempotent, no strict self-edge ⇒ Unknown. A wrong
    // Total here is the unsoundness slice A fixed — slice B MUST keep it Unknown.
    const body = EMatch(EVar("a"), [
      arm(
        PatCon("Cons", [PatVar("h"), PatVar("t")]),
        ECall("f", [ECon("Cons", [EVar("h"), EVar("t")]), EVar("t")]),
      ),
    ]);
    expect(tag(check("f", ["a", "b"], body))).toBe("Unknown");
  });

  it("soundness repair PRESERVED (measure): f a b = if a > 0 then f (b + 1) (a - 1) else 0 ⇒ Unknown", () => {
    // Same G = {a →↓ b} (arg₀ = b+1 ⇒ no edge; arg₁ = a-1 ⇒ a →↓ b) ⇒ empty
    // idempotent ⇒ Unknown (f 2 0 → f 1 1 → f 2 0 cycles).
    const body = If(
      posB("a"),
      ECall("f", [add(EVar("b"), ELit(1)), sub(EVar("a"), ELit(1))]),
      ELit(0),
    );
    expect(tag(check("f", ["a", "b"], body))).toBe("Unknown");
  });

  it("`== 0` equality-guard FENCE (inherited D-3c-2): f m n = if m == 0 then n else f (m - 1) n ⇒ Unknown", () => {
    // The `eq` guard does not establish m ∈ pos, so m-1 yields no edge into m;
    // the only idempotent ({n →↓= n}) lacks a strict self-edge ⇒ Unknown.
    const body = If(eqE(EVar("m"), ELit(0)), EVar("n"), ECall("f", [sub(EVar("m"), ELit(1)), EVar("n")]));
    expect(tag(check("f", ["m", "n"], body))).toBe("Unknown");
  });

  it("mutual-recursion FENCE (slice C): f x = g x (g ≠ f) ⇒ Total (no self-call ⇒ vacuously total)", () => {
    // The walk polices ONE selfId; a call to a different function g contributes
    // no graph ⇒ empty graph set ⇒ vacuously total (re-confirmed under the graph
    // collector). Genuine mutual recursion is slice C (rung-3c).
    expect(tag(check("f", ["x"], ECall("g", [EVar("x")])))).toBe("Total");
  });

  it("single-arg structural still Total under the collector: length xs = case xs of Cons h t -> add 1 (length t) ; Nil -> 0", () => {
    // No regression: G = {xs →↓ xs}; G;G = G (idempotent, strict self-edge) ⇒ Total.
    const body = EMatch(EVar("xs"), [
      arm(
        PatCon("Cons", [PatVar("h"), PatVar("t")]),
        ECall("add", [ELit(1), ECall("length", [EVar("t")])]),
      ),
      arm(PatCon("Nil", []), ELit(0)),
    ]);
    expect(tag(check("length", ["xs"], body))).toBe("Total");
  });

  it("unchanged-param self-loop still Unknown: loop xs = loop xs ⇒ Unknown", () => {
    // No regression: G = {xs →↓= xs} (non-strict); G;G = G idempotent with no
    // strict self-edge ⇒ Unknown.
    expect(tag(check("loop", ["xs"], ECall("loop", [EVar("xs")])))).toBe("Unknown");
  });
});

describe("checkMutualTotality — rung 3c (mutual recursion; the call-graph size-change closure)", () => {
  it("THE mutual win (structural): f x = …g t… / g y = …f t… ⇒ Total", () => {
    // f x = case x of Cons h t -> g t ; Nil -> 0
    // g y = case y of Cons h t -> f t ; Nil -> 0
    // G1 : f→g {x →↓ y}, G2 : g→f {y →↓ x}; G1;G2 = f→f {x →↓ x}, G2;G1 = g→g
    // {y →↓ y} — both idempotent with a strict self-edge ⇒ size-change terminating.
    const fBody = EMatch(EVar("x"), [
      arm(PatCon("Cons", [PatVar("h"), PatVar("t")]), ECall("g", [EVar("t")])),
      arm(PatCon("Nil", []), ELit(0)),
    ]);
    const gBody = EMatch(EVar("y"), [
      arm(PatCon("Cons", [PatVar("h"), PatVar("t")]), ECall("f", [EVar("t")])),
      arm(PatCon("Nil", []), ELit(0)),
    ]);
    expect(tag(checkMutual([member("f", ["x"], fBody), member("g", ["y"], gBody)]))).toBe("Total");
  });

  it("THE mutual win (measure): f a = if a>0 then g (a-1) / g b = if b>0 then f (b-1) ⇒ Total", () => {
    // G1 : f→g {a →↓ b} (a ∈ pos, a-1), G2 : g→f {b →↓ a}; closure f→f {a →↓ a},
    // g→g {b →↓ b} ⇒ Total.
    const fBody = If(posB("a"), ECall("g", [sub(EVar("a"), ELit(1))]), ELit(0));
    const gBody = If(posB("b"), ECall("f", [sub(EVar("b"), ELit(1))]), ELit(0));
    expect(tag(checkMutual([member("f", ["a"], fBody), member("g", ["b"], gBody)]))).toBe("Total");
  });

  it("3-function cycle (closure depth 3): f→g→h→f, each structural ⇒ Total", () => {
    // f x = case x of Cons p t -> g t ; g y = … h t ; h z = … f t.
    // (head var `p`, not `h`, to avoid colliding with function `h`.) The f→f
    // idempotent surfaces only after composing THREE graphs ⇒ the closure catches it.
    const fBody = EMatch(EVar("x"), [
      arm(PatCon("Cons", [PatVar("p"), PatVar("t")]), ECall("g", [EVar("t")])),
      arm(PatCon("Nil", []), ELit(0)),
    ]);
    const gBody = EMatch(EVar("y"), [
      arm(PatCon("Cons", [PatVar("p"), PatVar("t")]), ECall("h", [EVar("t")])),
      arm(PatCon("Nil", []), ELit(0)),
    ]);
    const hBody = EMatch(EVar("z"), [
      arm(PatCon("Cons", [PatVar("p"), PatVar("t")]), ECall("f", [EVar("t")])),
      arm(PatCon("Nil", []), ELit(0)),
    ]);
    expect(
      tag(checkMutual([member("f", ["x"], fBody), member("g", ["y"], gBody), member("h", ["z"], hBody)])),
    ).toBe("Total");
  });

  it("THE soundness canary (unchanged param): f a = g a / g b = f b ⇒ Unknown", () => {
    // G1 : f→g {a →↓= b} (a unchanged ⇒ non-strict), G2 : g→f {b →↓= a}; closure
    // f→f {a →↓= a} — idempotent with NO strict self-edge ⇒ Unknown (f 5 → g 5 →
    // f 5 → … diverges). A wrong Total here is the unsoundness slice C must refuse.
    const fBody = ECall("g", [EVar("a")]);
    const gBody = ECall("f", [EVar("b")]);
    expect(tag(checkMutual([member("f", ["a"], fBody), member("g", ["b"], gBody)]))).toBe("Unknown");
  });

  it("permutation ping-pong: f a b = g b a / g x y = f y x ⇒ Unknown", () => {
    // Swaps args, never shrinks. The f→f cycle swaps-back to {a →↓= a, b →↓= b},
    // idempotent, no strict self-edge ⇒ Unknown.
    const fBody = ECall("g", [EVar("b"), EVar("a")]);
    const gBody = ECall("f", [EVar("y"), EVar("x")]);
    expect(tag(checkMutual([member("f", ["a", "b"], fBody), member("g", ["x", "y"], gBody)]))).toBe("Unknown");
  });

  it("mixed strict/non-strict cycle, no net descent: f a = g a / g b = f (b - 1) UNGUARDED ⇒ Unknown", () => {
    // g→f is {} (the b-1 has no b ∈ pos, so no strict edge AND b-1 ≠ EVar b, so no
    // edge at all); the f→f idempotent is empty ⇒ no strict self-edge ⇒ Unknown.
    const fBody = ECall("g", [EVar("a")]);
    const gBody = ECall("f", [sub(EVar("b"), ELit(1))]);
    expect(tag(checkMutual([member("f", ["a"], fBody), member("g", ["b"], gBody)]))).toBe("Unknown");
  });

  it("`== 0` ℕ-fence on a mutual pair (inherited D-3c-2): even n / odd n ⇒ Unknown", () => {
    // even n = if n == 0 then true else odd (n - 1)
    // odd n  = if n == 0 then false else even (n - 1)
    // The `eq` guard does not establish n ∈ pos, so n-1 yields no strict edge ⇒
    // the even→even cycle is non-strict ⇒ Unknown. A wrong Total would be unsound on ℤ.
    const evenBody = If(eqE(EVar("n"), ELit(0)), ELit(true), ECall("odd", [sub(EVar("n"), ELit(1))]));
    const oddBody = If(eqE(EVar("n"), ELit(0)), ELit(false), ECall("even", [sub(EVar("n"), ELit(1))]));
    expect(tag(checkMutual([member("even", ["n"], evenBody), member("odd", ["n"], oddBody)]))).toBe("Unknown");
  });

  it("a group member with a non-decreasing back-edge: f x = …g x… / g y = f y ⇒ Unknown", () => {
    // f x = case x of Cons h t -> g x ; Nil -> 0   (calls g on the WHOLE x)
    // g y = f y
    // f→g {x →↓= y} (x unchanged), g→f {y →↓= x}; the f→f cycle is non-strict ⇒ Unknown.
    const fBody = EMatch(EVar("x"), [
      arm(PatCon("Cons", [PatVar("h"), PatVar("t")]), ECall("g", [EVar("x")])),
      arm(PatCon("Nil", []), ELit(0)),
    ]);
    const gBody = ECall("f", [EVar("y")]);
    expect(tag(checkMutual([member("f", ["x"], fBody), member("g", ["y"], gBody)]))).toBe("Unknown");
  });

  it("singleton group = the single-function case: length xs (structural) ⇒ Total", () => {
    // checkMutual of a one-member group reduces EXACTLY to slice B (the regression
    // guard that checkStructuralTotality's singleton sugar relies on).
    const body = EMatch(EVar("xs"), [
      arm(
        PatCon("Cons", [PatVar("h"), PatVar("t")]),
        ECall("add", [ELit(1), ECall("length", [EVar("t")])]),
      ),
      arm(PatCon("Nil", []), ELit(0)),
    ]);
    expect(tag(checkMutual([member("length", ["xs"], body)]))).toBe("Total");
  });

  it("singleton group, unchanged-param self-loop ⇒ Unknown", () => {
    expect(tag(checkMutual([member("loop", ["xs"], ECall("loop", [EVar("xs")]))]))).toBe("Unknown");
  });

  it("a call OUTSIDE the group contributes no graph: f x = g x with group [f] only ⇒ Total", () => {
    // g is not a group member ⇒ totGroupLookup g → Nothing ⇒ no graph ⇒ vacuously
    // total (sound: a missing edge only weakens the criterion; f alone DOES
    // terminate if g does — the group verdict is for what's passed).
    expect(tag(checkMutual([member("f", ["x"], ECall("g", [EVar("x")]))]))).toBe("Total");
  });
});

describe("totalityVerdict — three-valued (folds the @partial escape-hatch)", () => {
  it("declaredPartial ⇒ Partial", () => {
    // even a structurally-total body is Partial when declared @partial
    const body = EMatch(EVar("xs"), [
      arm(PatCon("Cons", [PatVar("h"), PatVar("t")]), ECall("f", [EVar("t")])),
    ]);
    expect(tag(verdict(true, "f", ["xs"], body))).toBe("Partial");
  });

  it("not declared partial, total body ⇒ Total", () => {
    const body = EMatch(EVar("xs"), [
      arm(PatCon("Cons", [PatVar("h"), PatVar("t")]), ECall("f", [EVar("t")])),
    ]);
    expect(tag(verdict(false, "f", ["xs"], body))).toBe("Total");
  });

  it("not declared partial, non-decreasing body ⇒ Unknown", () => {
    expect(tag(verdict(false, "loop", ["xs"], ECall("loop", [EVar("xs")])))).toBe("Unknown");
  });
});
