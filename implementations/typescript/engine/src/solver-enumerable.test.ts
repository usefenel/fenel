// ---------------------------------------------------------------------------
// solver-enumerable.test.ts — typed enumeration and carrier completeness.
// Ordinary Int/Nat Enumerable steppers list a mathematical range. Complete
// interval enumeration abstains because those scalar lists omit admitted exact
// digit and pure constructor carriers. Finite enums and Char stepping retain
// their existing exact extension, findall and seeded-sampling behavior.
//
// This oracle exercises:
//   (a) `Enumerable` is a real boot-registry dispatch class (Monoid-shape arg-0
//       dispatch, NO TS seed — the Eq / Numeric precedent);
//   (b) the `Int` / `Nat` instances resolve their `enumFromTo` REFERENCES; the
//       irrational rungs (Rational / Real) are NOT Enumerable (the honest gap);
//   (c) the `intEnumFromTo` / `natEnumFromTo` stepper bodies (the pure cons-spine
//       [lo..hi]; empty when lo > hi; singleton when lo == hi);
//   (d) the integer-interval completeness fence, including singleton carriers;
//   (e) the `enumerableSolveAll` / `enumerableSampleSet` payoff consumers.
//
// Ledgered test-tooling (the number-tower.test.ts precedent). The fence is a
// pure `.fenel` body edit; this oracle drives it via the exported
// `dispatchEngineBody` (no new dispatch-wrapper TS) + the parse/evaluate harness.
// ---------------------------------------------------------------------------

import { test, expect, describe, beforeAll } from "bun:test";
import { evaluate } from "./json-logic";
import { parse } from "./fenel-parser";
import { dispatchRegistry } from "./system-entities";
import { getSystemEvaluateContext } from "./system-registry";
import { methodDispatchPosition } from "./effect-dispatch";
import { dispatchEngineBody, dispatchedEnumerableInhabit } from "./engine-bodies-dispatch";
import { buildSetExpr } from "./set-marker";
import { Just, Nothing } from "./type-foundation";
import type { EvaluateContext } from "./json-logic";
import { GLOBAL_ONLY } from "./dispatch-registry";
import { contains } from "./set-algebra";

let ctx: EvaluateContext;
beforeAll(() => {
  ctx = getSystemEvaluateContext();
});
const ev = (src: string) => evaluate(parse(src), {}, ctx);

// --- WitSet marker + Expr builders (the enumerate.test.ts shapes) ----------
const MBjust = (value: number | string, inclusive: boolean) => ({ $tag: "Just", _0: { value, inclusive } });
const MBnone = { $tag: "Nothing" };
const SeInterval = (lo: unknown, hi: unknown) => ({ $tag: "SeInterval", interval: { lo, hi } });
const SeUnion = (branches: unknown[]) => ({ $tag: "SeUnion", branches });
const SeIntersect = (branches: unknown[]) => ({ $tag: "SeIntersect", branches });
const SeEnum = (values: unknown[]) => ({ $tag: "SeEnum", values });
const EVar = (name: string) => ({ $tag: "EVar", name });
const ELit = (value: unknown) => ({ $tag: "ELit", value });
const ECall = (fnId: string, args: unknown[]) => ({ $tag: "ECall", fnId, args });

type MaybeV = { $tag: string; _0?: unknown };

// Walk a pure cons-spine `List` ({$tag:"Cons",_0,_1} / {$tag:"Nil"}) → length.
const spineLen = (v: unknown): number => {
  let n = 0;
  let cur = v as { $tag?: string; _1?: unknown };
  while (cur && cur.$tag === "Cons") {
    n += 1;
    cur = cur._1 as { $tag?: string; _1?: unknown };
  }
  return n;
};

// ---------------------------------------------------------------------------
// (a) Enumerable is a boot-registry dispatch class (Monoid-shape, no TS seed).
// ---------------------------------------------------------------------------

describe("Phase 1 (a) — Enumerable is a boot-registry class (Monoid-shape arg-0 dispatch)", () => {
  test("getClass resolves Enumerable in the boot dispatchRegistry", () => {
    expect(dispatchRegistry.getClass("Enumerable")).toBeDefined();
  });

  test("enumFromTo derives arg-0 dispatch (the class var `a` heads a bare arg-0)", () => {
    expect(methodDispatchPosition(dispatchRegistry, "Enumerable", "enumFromTo")).toBe(0);
  });

  test("the method set is exactly [enumFromTo] (succ/pred deferred to a later phase)", () => {
    const cls = dispatchRegistry.getClass("Enumerable") as unknown as { methods: Array<{ name: string }> };
    expect(cls.methods.map((m) => m.name)).toEqual(["enumFromTo"]);
  });
});

// ---------------------------------------------------------------------------
// (b) The Int / Nat instances resolve; the irrational rungs are NOT Enumerable.
// ---------------------------------------------------------------------------

describe("Phase 1 (b) — the Enumerable per-base instances", () => {
  test("Int / Nat reference their stepper bodies (function references, not bare strings)", () => {
    expect(dispatchRegistry.resolve("Int", "Enumerable", GLOBAL_ONLY)).toEqual({ enumFromTo: { $ref: "intEnumFromTo" } });
    expect(dispatchRegistry.resolve("Nat", "Enumerable", GLOBAL_ONLY)).toEqual({ enumFromTo: { $ref: "natEnumFromTo" } });
  });

  test("Int / Nat satisfy Enumerable; Rational / Real do NOT (dense/uncountable — no successor)", () => {
    expect(dispatchRegistry.satisfies("Int", "Enumerable", GLOBAL_ONLY)).toBe(true);
    expect(dispatchRegistry.satisfies("Nat", "Enumerable", GLOBAL_ONLY)).toBe(true);
    expect(dispatchRegistry.satisfies("Rational", "Enumerable", GLOBAL_ONLY)).toBe(false);
    expect(dispatchRegistry.satisfies("Real", "Enumerable", GLOBAL_ONLY)).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// (c) The stepper bodies — the pure cons-spine [lo..hi].
// ---------------------------------------------------------------------------

describe("Phase 1 (c) — intEnumFromTo / natEnumFromTo step the bounded range", () => {
  test("intEnumFromTo 2 5 ⇒ a 4-element cons-spine; lo > hi ⇒ Nil; lo == hi ⇒ singleton", () => {
    expect(spineLen(ev("intEnumFromTo (numberToInt 2) (numberToInt 5)"))).toBe(4);
    expect((ev("intEnumFromTo (numberToInt 5) (numberToInt 2)") as { $tag: string }).$tag).toBe("Nil");
    expect(spineLen(ev("intEnumFromTo (numberToInt 3) (numberToInt 3)"))).toBe(1);
    // a NEGATIVE range steps over ℤ (the sign-magnitude Int rung) — −2..2 is 5 wide.
    expect(spineLen(ev("intEnumFromTo (numberToInt (negate 2)) (numberToInt 2)"))).toBe(5);
  });

  test("natEnumFromTo 0 3 ⇒ a 4-element cons-spine (pure Peano Succ stepping)", () => {
    expect(spineLen(ev("natEnumFromTo (numberToNat 0) (numberToNat 3)"))).toBe(4);
    expect((ev("natEnumFromTo (numberToNat 4) (numberToNat 1)") as { $tag: string }).$tag).toBe("Nil");
  });
});

// ---------------------------------------------------------------------------
// (d) Complete interval enumeration must include every admitted carrier.
// ---------------------------------------------------------------------------

const enumerableSet = (base: string, w: unknown) => dispatchEngineBody("engine:enumerableSet", [base, w]) as MaybeV;
const enumerateSet = (w: unknown) => dispatchEngineBody("engine:enumerateSet", [w]) as MaybeV;

describe("Phase 1 (d) — integer interval carrier completeness", () => {
  test("integer intervals abstain from complete enumeration", () => {
    const closed = SeInterval(MBjust(2, true), MBjust(5, true));
    // the shipped type-erased reader STAYS honest (Nothing — no base type).
    expect(enumerateSet(closed).$tag).toBe("Nothing");
    // Int now also admits exact records and pure constructors.
    const r = enumerableSet("Int", closed);
    expect(r.$tag).toBe("Nothing");
  });

  test("empty, singleton and negative integer intervals share the conservative fence", () => {
    expect(enumerableSet("Int", SeInterval(MBjust(5, true), MBjust(2, true))).$tag).toBe("Nothing");
    expect(enumerableSet("Int", SeInterval(MBjust(3, true), MBjust(3, true))).$tag).toBe("Nothing");
    expect(enumerableSet("Int", SeInterval(MBjust(-2, true), MBjust(2, true))).$tag).toBe("Nothing");
  });

  test("exclusive bounds do not restore a complete scalar extension", () => {
    expect(enumerableSet("Int", SeInterval(MBjust(2, false), MBjust(6, false))).$tag).toBe("Nothing");
  });

  test("the honesty fence: unbounded interval, non-integer base ⇒ Nothing", () => {
    // an unbounded side is an infinite ℤ ⇒ not finitely enumerable.
    expect(enumerableSet("Int", SeInterval(MBjust(2, true), MBnone)).$tag).toBe("Nothing");
    expect(enumerableSet("Int", SeInterval(MBnone, MBjust(5, true))).$tag).toBe("Nothing");
    // a non-integer (dense/uncountable) base ⇒ Nothing (no successor — the ℝ fence).
    expect(enumerableSet("Real", SeInterval(MBjust(2, true), MBjust(5, true))).$tag).toBe("Nothing");
  });

  test("Nat intervals also abstain from complete enumeration", () => {
    const r = enumerableSet("Nat", SeInterval(MBjust(0, true), MBjust(3, true)));
    expect(r.$tag).toBe("Nothing");
  });

  test("a singleton numeric interval admits scalar and pure zero while refusing a small digit box", () => {
    const zero = SeInterval(MBjust(0, true), MBjust(0, true));
    for (const value of [0, { $tag: "Zero" }]) {
      // GLOBAL_ONLY: the captured boot reader has no request account.
      expect(contains(zero as never, value, null, undefined, ctx)).toEqual(Just(true));
    }
    expect(contains(zero as never, { $tag: "Nat", digits: "0" }, null, undefined, ctx)).toEqual(Just(false));
    expect(enumerableSet("Nat", zero)).toEqual(Nothing);
  });

  test("non-interval markers delegate to the type-erased enumerateSet (still enumerable)", () => {
    // a SeEnum rides through unchanged.
    const r = enumerableSet("Int", SeEnum([5, 7, 5]));
    expect(r.$tag).toBe("Just");
    expect(r._0).toEqual([5, 7]);
  });
});

// ---------------------------------------------------------------------------
// (e) The payoff — enumerableSolveAll / enumerableSampleSet over an Int interval.
// ---------------------------------------------------------------------------

const enumerableSolveAll = (base: string, expr: unknown) =>
  dispatchEngineBody("engine:enumerableSolveAll", [base, expr]) as MaybeV;
const enumerableSampleSet = (base: string, seed: number, w: unknown) =>
  dispatchEngineBody("engine:enumerableSampleSet", [base, seed, w]) as MaybeV;

describe("Phase 1 (e) — the typed findall + sample payoff", () => {
  test("integer relational findall abstains when complete carrier enumeration is unavailable", () => {
    const pred = ECall("and", [
      ECall("gte", [EVar("x"), ELit(2)]),
      ECall("lte", [EVar("x"), ELit(5)]),
    ]);
    const r = enumerableSolveAll("Int", pred);
    expect(r.$tag).toBe("Nothing");
  });

  test("enumerableSolveAll Int (x == 5 or x == 7) ⇒ Just [5,7] (delegates to the enum reader)", () => {
    const pred = ECall("or", [
      ECall("eq", [EVar("x"), ELit(5)]),
      ECall("eq", [EVar("x"), ELit(7)]),
    ]);
    const r = enumerableSolveAll("Int", pred);
    expect(r.$tag).toBe("Just");
    expect(r._0).toEqual([5, 7]);
  });

  test("interval sampling requires complete enumeration; finite enum sampling stays deterministic", () => {
    const w = SeInterval(MBjust(2, true), MBjust(5, true));
    expect(enumerableSampleSet("Int", 1, w).$tag).toBe("Nothing");
    const finite = SeEnum([2, 3, 4, 5]);
    const r1 = enumerableSampleSet("Int", 1, finite);
    expect(r1.$tag).toBe("Just");
    expect([2, 3, 4, 5]).toContain(r1._0 as number);
    // same seed ⇒ same pick (pinned determinism).
    expect(enumerableSampleSet("Int", 1, finite)._0 as number).toBe(r1._0 as number);
    // a non-enumerable (ℝ) interval ⇒ Nothing (sampleSet's honesty preserved).
    expect(enumerableSampleSet("Real", 1, w).$tag).toBe("Nothing");
  });
});

// ===========================================================================
// PHASE 2 — Enumerable Char (codepoint stepping) + endpoint-attained optimize.
// ===========================================================================

// ---------------------------------------------------------------------------
// (f) Enumerable Char — the first NON-numeric base (a discrete codepoint order).
// ---------------------------------------------------------------------------

describe("Phase 2 (f) — Enumerable Char (codepoint stepping)", () => {
  test("the Char instance resolves its stepper reference; Char satisfies Enumerable", () => {
    expect(dispatchRegistry.resolve("Char", "Enumerable", GLOBAL_ONLY)).toEqual({ enumFromTo: { $ref: "charEnumFromTo" } });
    expect(dispatchRegistry.satisfies("Char", "Enumerable", GLOBAL_ONLY)).toBe(true);
    // String is NOT Enumerable (a 1-char Char is a discrete codepoint; a String is not).
    expect(dispatchRegistry.satisfies("String", "Enumerable", GLOBAL_ONLY)).toBe(false);
  });

  test("charEnumFromTo 'a' 'e' ⇒ a 5-element cons-spine; lo > hi ⇒ Nil; lo == hi ⇒ singleton", () => {
    expect(spineLen(ev('charEnumFromTo "a" "e"'))).toBe(5);
    expect((ev('charEnumFromTo "e" "a"') as { $tag: string }).$tag).toBe("Nil");
    expect(spineLen(ev('charEnumFromTo "m" "m"'))).toBe(1);
  });
});

// ---------------------------------------------------------------------------
// (g) The Char de-fence — a Char-typed SeInterval ⇒ Just [chars].
// ---------------------------------------------------------------------------

describe("Phase 2 (g) — the typed Char interval de-fence", () => {
  test('Char SeInterval ⇒ Just ["a".."e"] (the predicate lowers via the generic gte/lte — no extension)', () => {
    const r = enumerableSet("Char", SeInterval(MBjust("a", true), MBjust("e", true)));
    expect(r.$tag).toBe("Just");
    expect(r._0).toEqual(["a", "b", "c", "d", "e"]);
  });

  test("EXCLUSIVE Char bounds step in by one codepoint (a < c < e ⇒ {b,c,d})", () => {
    expect((enumerableSet("Char", SeInterval(MBjust("a", false), MBjust("e", false)))._0)).toEqual(["b", "c", "d"]);
  });

  test("the headline: enumerableSolveAll Char (c >= 'a' and c <= 'e') ⇒ Just [a..e]", () => {
    const pred = ECall("and", [
      ECall("gte", [EVar("c"), ELit("a")]),
      ECall("lte", [EVar("c"), ELit("e")]),
    ]);
    const r = dispatchEngineBody("engine:enumerableSolveAll", ["Char", pred]) as MaybeV;
    expect(r.$tag).toBe("Just");
    expect(r._0).toEqual(["a", "b", "c", "d", "e"]);
  });

  test("the honesty fence holds for Char: unbounded ⇒ Nothing; a Char sample picks a real member", () => {
    expect(enumerableSet("Char", SeInterval(MBjust("a", true), MBnone)).$tag).toBe("Nothing");
    const w = SeInterval(MBjust("a", true), MBjust("e", true));
    const s = enumerableSampleSet("Char", 3, w);
    expect(s.$tag).toBe("Just");
    expect(["a", "b", "c", "d", "e"]).toContain(s._0 as string);
  });
});

// ---------------------------------------------------------------------------
// (h) Endpoint-attained optimize — exclusive discrete bounds ATTAIN; ℝ stays Nothing.
// ---------------------------------------------------------------------------

const minOf = (base: string, w: unknown) => dispatchEngineBody("engine:enumerableMinOfSet", [base, w]) as MaybeV;
const maxOf = (base: string, w: unknown) => dispatchEngineBody("engine:enumerableMaxOfSet", [base, w]) as MaybeV;

describe("Phase 2 (h) — endpoint-attained optimize over typed intervals", () => {
  test("exclusive ℤ bounds ATTAIN: (x > 2 and x < 6) ⇒ min Just 3, max Just 5 (was Nothing)", () => {
    const w = SeIntersect([SeInterval(MBjust(2, false), MBnone), SeInterval(MBnone, MBjust(6, false))]);
    expect(minOf("Int", w)).toEqual({ $tag: "Just", _0: 3 });
    expect(maxOf("Int", w)).toEqual({ $tag: "Just", _0: 5 });
  });

  test("inclusive ℤ bounds attain the endpoints directly", () => {
    const w = SeInterval(MBjust(2, true), MBjust(5, true));
    expect(minOf("Int", w)).toEqual({ $tag: "Just", _0: 2 });
    expect(maxOf("Int", w)).toEqual({ $tag: "Just", _0: 5 });
  });

  test("Char exclusive bounds attain the next/previous codepoint", () => {
    const w = SeInterval(MBjust("a", true), MBjust("e", false)); // [a, e)
    expect(minOf("Char", w)).toEqual({ $tag: "Just", _0: "a" });
    expect(maxOf("Char", w)).toEqual({ $tag: "Just", _0: "d" });
  });

  test("the ℝ honesty fence is PRESERVED: exclusive Real bound ⇒ Nothing; unbounded ⇒ Nothing", () => {
    expect(minOf("Real", SeInterval(MBjust(2, false), MBjust(6, true))).$tag).toBe("Nothing");
    expect(minOf("Int", SeInterval(MBnone, MBjust(6, true))).$tag).toBe("Nothing"); // unbounded below
  });
});

// ===========================================================================
// PHASE 3 — typed-UNION widening (disjunctive discrete constraints enumerate).
// ===========================================================================

describe("Phase 3 (i) — the typed-union de-fence (disjunctive discrete constraints)", () => {
  test("a union of integer intervals preserves the complete-enumeration fence", () => {
    const u = SeUnion([
      SeInterval(MBjust(2, true), MBjust(3, true)),
      SeInterval(MBjust(7, true), MBjust(8, true)),
    ]);
    // the type-erased reader STILL fences (any interval branch ⇒ Nothing).
    expect(enumerateSet(u).$tag).toBe("Nothing");
    // Every branch must enumerate completely.
    const r = enumerableSet("Int", u);
    expect(r.$tag).toBe("Nothing");
  });

  test("a mixed enum and integer interval union also abstains", () => {
    const u = SeUnion([SeEnum([1]), SeIntersect([SeInterval(MBjust(5, true), MBnone), SeInterval(MBnone, MBjust(7, true))])]);
    expect(enumerableSet("Int", u).$tag).toBe("Nothing");
  });

  test("disjunctive integer relational findall abstains", () => {
    const band = (lo: number, hi: number) =>
      ECall("and", [ECall("gte", [EVar("x"), ELit(lo)]), ECall("lte", [EVar("x"), ELit(hi)])]);
    const pred = ECall("or", [band(2, 3), band(7, 8)]);
    const r = dispatchEngineBody("engine:enumerableSolveAll", ["Int", pred]) as MaybeV;
    expect(r.$tag).toBe("Nothing");
  });

  test("a Char interval union enumerates over codepoints", () => {
    const u = SeUnion([
      SeInterval(MBjust("a", true), MBjust("b", true)),
      SeInterval(MBjust("x", true), MBjust("z", true)),
    ]);
    expect((enumerableSet("Char", u))._0).toEqual(["a", "b", "x", "y", "z"]);
  });

  test("the honesty fence holds: a union with an UNBOUNDED branch ⇒ Nothing", () => {
    const u = SeUnion([SeInterval(MBjust(2, true), MBjust(3, true)), SeInterval(MBjust(7, true), MBnone)]);
    expect(enumerableSet("Int", u).$tag).toBe("Nothing");
  });
});

describe("Phase 3 (j) — optimize over a discrete union", () => {
  test("union extrema abstain when their complete integer enumeration is unavailable", () => {
    const u = SeUnion([
      SeInterval(MBjust(2, true), MBjust(3, true)),
      SeInterval(MBjust(7, true), MBjust(8, true)),
    ]);
    expect(minOf("Int", u)).toEqual(Nothing);
    expect(maxOf("Int", u)).toEqual(Nothing);
  });
});

// ===========================================================================
// PHASE 6 — refined-type INHABITANT enumeration. LIST the values of a bounded
// refined TYPE (`Digit = Int ∈ [0..9]` ⇒ Just [0..9]) — not just solve a
// predicate. The `FenelType → {base, WitSet}` marshal (the ledgered `$`-key
// boundary on the shipped `peelSetExpr`, value-preserving) feeds the Phase 1–3
// typed `enumerableSet`, byte-untouched. `⟦$refined base S⟧ = ⟦base⟧ ∩ S` — the
// inhabitants are EXACT; honest Nothing for non-enumerable / unbounded /
// undecidable / non-refined. Driven end-to-end through `dispatchedEnumerableInhabit`
// over REAL `$refined` FenelTypes (the marshal IS under test, not bypassed).
// ===========================================================================

// --- refined-type FenelType builders (the `type-foundation.Refined` shape) --
const Refined = (base: string, set: unknown) => ({ $refined: { base: { $ref: base }, set } });
const RefInterval = (lo: unknown, hi: unknown) => buildSetExpr.interval({ lo, hi } as never);
const Bnd = (value: number | string, inclusive: boolean) => Just({ value, inclusive });
const inhabit = (t: unknown) => dispatchedEnumerableInhabit(t) as MaybeV;

describe("Phase 6 (k) — bounded refined enumeration preserves completeness", () => {
  test("an Int interval refinement abstains from complete inhabitant enumeration", () => {
    const r = inhabit(Refined("Int", RefInterval(Bnd(0, true), Bnd(9, true))));
    expect(r.$tag).toBe("Nothing");
  });

  test("a Char alias ∈ [a..e] ⇒ Just the char list (value-preserving — STRINGS, not codepoints)", () => {
    const r = inhabit(Refined("Char", RefInterval(Bnd("a", true), Bnd("e", true))));
    expect(r.$tag).toBe("Just");
    expect(r._0).toEqual(["a", "b", "c", "d", "e"]);
  });

  test("an $enum-refined type ⇒ Just its values (deduped)", () => {
    const r = inhabit(Refined("Int", buildSetExpr.enum([3, 5, 7, 5])));
    expect(r.$tag).toBe("Just");
    expect(r._0).toEqual([3, 5, 7]);
  });

  test("exclusive Int interval refinements preserve the completeness fence", () => {
    const r = inhabit(Refined("Int", RefInterval(Bnd(2, false), Bnd(6, false))));
    expect(r.$tag).toBe("Nothing");
  });

  test("multi-clause Int interval refinements preserve the completeness fence", () => {
    const r = inhabit(Refined("Int", buildSetExpr.intersect([
      RefInterval(Bnd(2, true), Nothing),
      RefInterval(Nothing, Bnd(8, true)),
    ])));
    expect(r.$tag).toBe("Nothing");
  });

  test("disjunctive Int interval refinements preserve the completeness fence", () => {
    const r = inhabit(Refined("Int", buildSetExpr.union([
      buildSetExpr.intersect([RefInterval(Bnd(2, true), Nothing), RefInterval(Nothing, Bnd(3, true))]),
      buildSetExpr.intersect([RefInterval(Bnd(7, true), Nothing), RefInterval(Nothing, Bnd(8, true))]),
    ])));
    expect(r.$tag).toBe("Nothing");
  });
});

describe("Phase 6 (l) — the honesty fence: non-enumerable / unbounded / undecidable / non-refined ⇒ Nothing", () => {
  test("an unbounded refinement (Int ∈ [0,∞) = Nat) ⇒ Nothing (infinite — we never invent)", () => {
    expect(inhabit(Refined("Int", RefInterval(Bnd(0, true), Nothing))).$tag).toBe("Nothing");
  });

  test("a $refined Real (dense/uncountable — no successor) ⇒ Nothing", () => {
    expect(inhabit(Refined("Real", RefInterval(Bnd(0, true), Bnd(9, true)))).$tag).toBe("Nothing");
  });

  test("a $where refinement (undecidable set ⇒ WsWhere) ⇒ Nothing", () => {
    expect(inhabit(Refined("Int", buildSetExpr.where({ var: "x" } as never))).$tag).toBe("Nothing");
  });

  test("a non-refined type (a plain record) ⇒ Nothing", () => {
    expect(inhabit({ $record: { fields: [] } }).$tag).toBe("Nothing");
  });
});

describe("Phase 6 (m) — the Fenel bodies in isolation (inhabitSet / enumerableInhabit over the marker)", () => {
  const inhabitSet = (m: unknown) => dispatchEngineBody("engine:inhabitSet", [m]) as MaybeV;
  const enumerableInhabit = (m: unknown) => dispatchEngineBody("engine:enumerableInhabit", [m]) as MaybeV;

  test("inhabitSet unwraps an InhRefined marker to Just {base,set}; InhNone ⇒ Nothing", () => {
    const ws = RefInterval(MBjust(0, true), MBjust(2, true));
    const r = inhabitSet({ tag: "InhRefined", base: "Int", set: ws });
    expect(r.$tag).toBe("Just");
    expect((r._0 as { base: string }).base).toBe("Int");
    expect(inhabitSet({ tag: "InhNone" }).$tag).toBe("Nothing");
  });

  test("enumerableInhabit preserves the integer interval completeness fence", () => {
    const ws = RefInterval(MBjust(0, true), MBjust(2, true));
    const r = enumerableInhabit({ tag: "InhRefined", base: "Int", set: ws });
    expect(r.$tag).toBe("Nothing");
    expect(enumerableInhabit({ tag: "InhNone" }).$tag).toBe("Nothing");
  });
});
