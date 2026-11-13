// expr-substrate Phase 5 — conformance tests for `solve` / `solveFn` /
// `inhabit` + the quantifier builders (brief:
// `workstreams/expr-substrate/briefs/phase-5-quantifiers-solve.md`).
// Re-pinned for decide-substrate Phase 1 Stage B: the representation is the
// canonical `Se*` SetExpr end-to-end (`solve = inhabit ∘ comprehend`
// LITERALLY; the WitSet marker vocabulary + the Inh* type-marker inhabit are
// retired).
//
// THE LOCKED COMPOSITION under test: `solveFn f = solve (reify f)` — the user
// writes a lambda predicate (⇒ a Fn value), reify (P3a) lifts its body to
// `Expr`, solve finds a witness. The captures case (`y = 5; \x -> x == y` ⇒
// Just 5) is the reify payoff.
//
// SetExpr representation: `comprehend` emits the canonical registered `$tag`
// `Se*` ADT (constructors write the `$tag` — Fenel-authorable), and `inhabit`
// reads it. Since `$tag` Se* IS the SetExpr the prover natives read
// (peelSetExpr's dual-read), the quantifier-builder markers feed
// decidableSetProver DIRECTLY — the old WitSet→`$enum` unmarshal is gone.

import { describe, it, expect } from "vitest";
import {
  dispatchEngineBody,
  dispatchedSolve,
  dispatchedSolveFn,
  dispatchedInhabit,
} from "./engine-bodies-dispatch";
import { createRegistry } from "./registry";
import { stdModule } from "./modules/std";
import { engineModule } from "./modules/engine";
import { localeModule } from "./modules/locale";
import { dispatchModule } from "./modules/dispatch";
import { proverModule, decidableSetProposerNative } from "./modules/prover";
import { verify } from "./kernel";

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

// --- canonical Se* builders (the registered $tag SetExpr shapes) ----------
const SeEnum = (values: unknown[]) => ({ $tag: "SeEnum", values });
const SeInterval = (lo: unknown, hi: unknown) => ({ $tag: "SeInterval", interval: { lo, hi } });
const MBjust = (value: unknown, inclusive: boolean) => ({ $tag: "Just", _0: { value, inclusive } });
const MBnone = { $tag: "Nothing" };

const cph = (varName: string, expr: unknown) =>
  dispatchEngineBody("engine:comprehend", [varName, expr]) as {
    $tag: string;
    [k: string]: unknown;
  };
const wit = (s: unknown) => dispatchedInhabit(s) as { $tag: string; _0?: unknown };

type MaybeV = { $tag: string; _0?: unknown };

// ---------------------------------------------------------------------------
// comprehend — the decidable fragment (both orientations)
// ---------------------------------------------------------------------------

describe("comprehend — fragment recognition (both orientations)", () => {
  it("x == 5 ⇒ SeEnum [5]; 5 == x ⇒ SeEnum [5]", () => {
    expect(cph("x", ECall("eq", [EVar("x"), ELit(5)]))).toEqual(SeEnum([5]));
    expect(cph("x", ECall("eq", [ELit(5), EVar("x")]))).toEqual(SeEnum([5]));
  });

  it("x < 7 / 7 > x ⇒ hi-exclusive 7; x > 3 / 3 < x ⇒ lo-exclusive 3", () => {
    const hiExcl7 = SeInterval(MBnone, MBjust(7, false));
    const loExcl3 = SeInterval(MBjust(3, false), MBnone);
    expect(cph("x", ECall("lt", [EVar("x"), ELit(7)]))).toEqual(hiExcl7);
    expect(cph("x", ECall("gt", [ELit(7), EVar("x")]))).toEqual(hiExcl7); // 7 > x ⇒ x < 7
    expect(cph("x", ECall("gt", [EVar("x"), ELit(3)]))).toEqual(loExcl3);
    expect(cph("x", ECall("lt", [ELit(3), EVar("x")]))).toEqual(loExcl3); // 3 < x ⇒ x > 3
  });

  it("x <= 7 ⇒ hi-inclusive; x >= 3 ⇒ lo-inclusive", () => {
    expect(cph("x", ECall("lte", [EVar("x"), ELit(7)]))).toEqual(SeInterval(MBnone, MBjust(7, true)));
    expect(cph("x", ECall("gte", [EVar("x"), ELit(3)]))).toEqual(SeInterval(MBjust(3, true), MBnone));
  });

  it("and ⇒ SeIntersect, or ⇒ SeUnion, not ⇒ SeComplement", () => {
    expect((cph("x", ECall("and", [ECall("gt", [EVar("x"), ELit(3)]), ECall("lte", [EVar("x"), ELit(7)])]))).$tag).toBe("SeIntersect");
    expect((cph("x", ECall("or", [ECall("eq", [EVar("x"), ELit(1)]), ECall("eq", [EVar("x"), ELit(2)])]))).$tag).toBe("SeUnion");
    expect((cph("x", ECall("not", [ECall("eq", [EVar("x"), ELit(1)])]))).$tag).toBe("SeComplement");
  });

  it("literal true ⇒ SeAll, false ⇒ SeNone; out-of-fragment ⇒ the SeWhere fence carrying the residual Expr", () => {
    expect(cph("x", ELit(true))).toEqual({ $tag: "SeAll" });
    expect(cph("x", ELit(false))).toEqual({ $tag: "SeNone" });
    expect(cph("x", ECall("foo", [EVar("x")]))).toEqual({ $tag: "SeWhere", pred: ECall("foo", [EVar("x")]) });
    // a comparison NOT over the solve var ⇒ the SeWhere fence
    expect((cph("x", ECall("eq", [EVar("y"), ELit(5)]))).$tag).toBe("SeWhere");
  });
});

// ---------------------------------------------------------------------------
// inhabit — witness rules + the honest fences (Se* input)
// ---------------------------------------------------------------------------

describe("inhabit — witness rules + exclusive-bound Nothing fences", () => {
  it("SeEnum ⇒ first value; empty enum ⇒ Nothing", () => {
    expect(wit(SeEnum([5, 6]))).toEqual({ $tag: "Just", _0: 5 });
    expect((wit(SeEnum([])) as MaybeV).$tag).toBe("Nothing");
  });

  it("interval with an INCLUSIVE bound ⇒ that bound (hi preferred)", () => {
    expect(wit(SeInterval(MBnone, MBjust(7, true)))).toEqual({ $tag: "Just", _0: 7 });
    expect(wit(SeInterval(MBjust(3, true), MBnone))).toEqual({ $tag: "Just", _0: 3 });
  });

  it("both-exclusive / unbounded-open ⇒ Nothing (the ℝ honesty fence)", () => {
    expect((wit(SeInterval(MBjust(3, false), MBnone)) as MaybeV).$tag).toBe("Nothing");
    expect((wit(SeInterval(MBjust(3, false), MBjust(7, false))) as MaybeV).$tag).toBe("Nothing");
  });

  it("SeComplement / SeWhere / SeAll / SeNone ⇒ Nothing (documented fences)", () => {
    expect((wit({ $tag: "SeComplement", inner: SeEnum([1]) }) as MaybeV).$tag).toBe("Nothing");
    expect((wit({ $tag: "SeWhere", pred: ELit(true) }) as MaybeV).$tag).toBe("Nothing");
    expect((wit({ $tag: "SeAll" }) as MaybeV).$tag).toBe("Nothing");
    expect((wit({ $tag: "SeNone" }) as MaybeV).$tag).toBe("Nothing");
  });

  it("SeUnion ⇒ first witnessing child", () => {
    expect(wit({ $tag: "SeUnion", branches: [{ $tag: "SeWhere", pred: ELit(true) }, SeEnum([9])] })).toEqual({ $tag: "Just", _0: 9 });
  });

  it("a legacy `$`-key SetExpr normalizes through the dispatcher (setExprToTag)", () => {
    // dispatchedInhabit tolerates the `$`-key form (the dual-read normalize);
    // the engine body itself reads only the canonical `$tag` Se*.
    expect(wit({ $enum: [4] })).toEqual({ $tag: "Just", _0: 4 });
  });
});

// ---------------------------------------------------------------------------
// substituteCaptures — inline captured values into the body
// ---------------------------------------------------------------------------

describe("substituteCaptures — EVar(captured) ⇒ ELit(value)", () => {
  it("y captured ⇒ x == y becomes x == 5; x (not captured) stays EVar", () => {
    const body = ECall("eq", [EVar("x"), EVar("y")]);
    const out = dispatchEngineBody("engine:substituteCaptures", [body, [{ name: "y", value: 5 }]]);
    expect(out).toEqual(ECall("eq", [EVar("x"), ELit(5)]));
  });
});

// ---------------------------------------------------------------------------
// solve — free-var fences + out-of-fragment
// ---------------------------------------------------------------------------

describe("solve — single-free-var, fences", () => {
  it("x == 5 ⇒ Just 5", () => {
    expect(dispatchedSolve(ECall("eq", [EVar("x"), ELit(5)]))).toEqual({ $tag: "Just", _0: 5 });
  });

  it("0 free vars ⇒ Nothing; ≥2 free vars ⇒ Nothing (the v1 fence)", () => {
    expect((dispatchedSolve(ELit(5)) as MaybeV).$tag).toBe("Nothing"); // no free var
    expect((dispatchedSolve(ECall("eq", [EVar("x"), EVar("y")])) as MaybeV).$tag).toBe("Nothing"); // x, y
  });

  it("out-of-fragment predicate ⇒ Nothing", () => {
    expect((dispatchedSolve(ECall("foo", [EVar("x")])) as MaybeV).$tag).toBe("Nothing");
  });
});

// ---------------------------------------------------------------------------
// solveFn — THE locked composition end-to-end
// ---------------------------------------------------------------------------

describe("solveFn — solve ∘ reify (the locked composition)", () => {
  it("\\x -> x == 5 ⇒ Just 5", () => {
    expect(dispatchedSolveFn(closure(["x"], { call: ["eq", { var: "x" }, 5] }))).toEqual({ $tag: "Just", _0: 5 });
  });

  it("\\x -> x > 3 and x <= 7 ⇒ a witness SATISFYING the original lambda", () => {
    const r = dispatchedSolveFn(
      closure(["x"], { and: [{ call: ["gt", { var: "x" }, 3] }, { call: ["lte", { var: "x" }, 7] }] }),
    ) as MaybeV;
    expect(r.$tag).toBe("Just");
    // assert by satisfying the original predicate, NOT by pinning the value.
    const w = r._0 as number;
    expect(w > 3 && w <= 7).toBe(true);
  });

  it("captures: y = 5; \\x -> x == y ⇒ Just 5 (THE reify payoff)", () => {
    expect(
      dispatchedSolveFn(closure(["x"], { call: ["eq", { var: "x" }, { var: "y" }] }, { y: 5 })),
    ).toEqual({ $tag: "Just", _0: 5 });
  });

  it("a native / bodyless fn ⇒ Nothing (reify Err ⇒ Nothing)", () => {
    expect((dispatchedSolveFn("std:add") as MaybeV).$tag).toBe("Nothing");
  });
});

// ---------------------------------------------------------------------------
// Quantifier builders — JUDGMENT-NATIVE claims with Se* payloads
// (decide-substrate Phase 2, K2: `every`/`exists` emit the one lattice judgment
//  JEmpty/JInhabited, not the closed Prop* markers)
// ---------------------------------------------------------------------------

describe("quantifier builders — judgment-native claims", () => {
  const pred = ECall("eq", [EVar("x"), ELit(2)]);
  const base = SeEnum([1, 2, 3]);

  it("every ⇒ JEmpty (¬comprehend-set ∩ baseSet) — the subset judgment (K2)", () => {
    // The Judgment payload rides `_0` (positional constructor field); jopSubset
    // builds branches = [¬t, s] (`appendItem` snoc puts s last).
    const m = dispatchEngineBody("engine:every", ["x", pred, base]) as {
      $tag: string;
      _0: { $tag: string; branches: Array<{ $tag: string; inner?: unknown }> };
    };
    expect(m.$tag).toBe("JEmpty");
    expect(m._0.$tag).toBe("SeIntersect");
    expect(m._0.branches[0]!.$tag).toBe("SeComplement");
    expect(m._0.branches[0]!.inner).toEqual(SeEnum([2]));
    expect(m._0.branches[1]).toEqual(base);
  });

  it("some ⇒ JInhabited over the intersection — the inhabited judgment (K2; Phase 6b absorbed the some-inversion; no `inverted` flag)", () => {
    const m = dispatchEngineBody("engine:some", ["x", pred, base]) as { $tag: string; inverted?: boolean; _0: { $tag: string } };
    expect(m.$tag).toBe("JInhabited");
    expect(m.inverted).toBeUndefined();
    expect(m._0.$tag).toBe("SeIntersect");
  });

  it("forall ≡ every, exists ≡ some (the type-arg-facing duals)", () => {
    expect(dispatchEngineBody("engine:forall", ["x", pred, base])).toEqual(dispatchEngineBody("engine:every", ["x", pred, base]));
    expect(dispatchEngineBody("engine:exists", ["x", pred, base])).toEqual(dispatchEngineBody("engine:some", ["x", pred, base]));
  });
});

// ---------------------------------------------------------------------------
// Dual-module wiring (decision 9) — engine:reify + engine:solve coexist with
// prover:decidableSetProver + kernel:verify in one registry; a Proposition
// built from the P5 pipeline round-trips Ok through the prover + kernel.
// Since Stage B the builder payloads ARE canonical SetExprs ($tag Se*), read
// by the prover natives via peelSetExpr's dual-read — no unmarshal needed.
// ---------------------------------------------------------------------------

describe("dual-module wiring — P5 pipeline → decidableSetProver → kernel:verify", () => {
  it("one registry resolves engine:reify / engine:solve / prover:decidableSetProver / kernel:verify", () => {
    const reg = createRegistry([stdModule, engineModule, localeModule, dispatchModule, proverModule]);
    expect(reg.getFunction("engine:reify")).toBeDefined();
    expect(reg.getFunction("engine:solve")).toBeDefined();
    expect(reg.getFunction("engine:solveFn")).toBeDefined();
    expect(reg.getFunction("prover:decidableSetProver")).toBeDefined();
    expect(reg.getFunction("kernel:verify")).toBeDefined();
  });

  it("every-derived subset judgment round-trips Ok (SolverChecked) through prover + kernel NATIVELY (K3)", () => {
    // Build the judgment from the P5 builders: every "x" (x == 2) over {2}.
    const pred = ECall("eq", [EVar("x"), ELit(2)]);
    const claim = dispatchEngineBody("engine:every", ["x", pred, SeEnum([2])]) as {
      $tag: string;
    };
    // K3: the judgment IS the claim currency — the proposer + kernel consume it
    // DIRECTLY (the shared shape recognizer recovers (s, t) from the composed
    // set; no Prop* reconstruction, the K2 back-map is dead).
    expect(claim.$tag).toBe("JEmpty");
    const out = decidableSetProposerNative(claim) as { $tag: string; _0: unknown };
    expect(out.$tag).toBe("Ok");
    const vr = verify(claim as Parameters<typeof verify>[0], out._0 as Parameters<typeof verify>[1]);
    expect(vr.$tag).toBe("Ok");
    if (vr.$tag === "Ok") expect(vr._0.$tag).toBe("SolverChecked");
  });
});
