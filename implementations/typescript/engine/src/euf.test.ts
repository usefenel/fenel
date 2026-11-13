// decide-substrate Phase 5 — conformance tests for `euf` (congruence closure
// over `Expr` term-singletons — ground EUF, Fenel-native). brief:
// `workstreams/decide-substrate/briefs/phase-5-euf-congruence.md`.
//
// EUF = ground equational logic over UNINTERPRETED applications. Congruence
// closure decides which term-singletons {s} / {t} are forced equal; the sole
// refutation source in v1 is a class holding two type/value-distinct ground
// lits. All verdicts ride `Tri` (Maybe Boolean); every `Just` is sound over
// every interpretation. THE ENABLER (partial-evaluator-substrate Phase 2): the
// read-to-read symbolic dependency read(k1) == read(k2) | k1 == k2 IS f(a)==f(b)
// congruence over the lifted Expr.

import { describe, it, expect } from "vitest";
import {
  dispatchEngineBody,
  dispatchEngineBodyWithDeciderCtx,
  dispatchedJsonLogicToExpr,
} from "./engine-bodies-dispatch";

// --- tiny Expr builders (plain $tag-tagged objects) ----------------------
const EVar = (name: string) => ({ $tag: "EVar", name });
const ELit = (value: unknown) => ({ $tag: "ELit", value });
const ECall = (fnId: string, args: unknown[]) => ({ $tag: "ECall", fnId, args });
const EConstruct = (ctor: string, args: unknown[], fields?: { name: string; value: unknown }[]) =>
  fields === undefined ? { $tag: "EConstruct", ctor, args } : { $tag: "EConstruct", ctor, args, fields };
const ERecord = (fields: { name: string; value: unknown }[]) => ({ $tag: "ERecord", fields });
const SeWhere = (pred: unknown) => ({ $tag: "SeWhere", pred });

type Eq = { lhs: unknown; rhs: unknown };
type Tri = { $tag: string; _0?: unknown };

const JUST_TRUE = { $tag: "Just", _0: true };
const JUST_FALSE = { $tag: "Just", _0: false };
const NOTHING = { $tag: "Nothing" };

const entails = (eqs: Eq[], lhs: unknown, rhs: unknown) =>
  dispatchEngineBody("engine:eufEntails", [eqs, lhs, rhs]) as Tri;
const sat = (eqs: Eq[], neqs: Eq[]) => dispatchEngineBody("engine:eufSat", [eqs, neqs]) as Tri;
// decideEmpty runs under the DECIDER ctx in production (dispatchSetAlgebraDecider);
// a bare SeWhere's CORE arm needs whereEmpty, which only that ctx carries.
const decideEmpty = (s: unknown) =>
  dispatchEngineBodyWithDeciderCtx("engine:setAlgebraDecideEmpty", [s]) as Tri;

// ---------------------------------------------------------------------------
// Congruence chains — the core capability.
// ---------------------------------------------------------------------------

describe("euf — congruence chains (eufEntails)", () => {
  it("a=b, b=c ⊨ f(a)=f(c) (transitivity + congruence)", () => {
    const eqs = [{ lhs: EVar("a"), rhs: EVar("b") }, { lhs: EVar("b"), rhs: EVar("c") }];
    expect(entails(eqs, ECall("f", [EVar("a")]), ECall("f", [EVar("c")]))).toEqual(JUST_TRUE);
  });

  it("the classic f(f(a))=a ∧ f(f(f(a)))=a ⊨ f(a)=a", () => {
    const fa = ECall("f", [EVar("a")]);
    const ffa = ECall("f", [fa]);
    const fffa = ECall("f", [ffa]);
    const eqs = [{ lhs: ffa, rhs: EVar("a") }, { lhs: fffa, rhs: EVar("a") }];
    expect(entails(eqs, fa, EVar("a"))).toEqual(JUST_TRUE);
  });

  it("a=b ⊨ f(a)=g(b) is NOT entailed (distinct heads) — honest Nothing", () => {
    expect(entails([{ lhs: EVar("a"), rhs: EVar("b") }], ECall("f", [EVar("a")]), ECall("g", [EVar("b")]))).toEqual(
      NOTHING,
    );
  });

  it("no premises ⊨ f(a)=f(b) is Nothing (a and b are not forced equal)", () => {
    expect(entails([], ECall("f", [EVar("a")]), ECall("f", [EVar("b")]))).toEqual(NOTHING);
  });
});

// ---------------------------------------------------------------------------
// Ground refutation — the only Just-false source in v1 (lit-conflict).
// ---------------------------------------------------------------------------

describe("euf — ground refutation (eufEntails Just false)", () => {
  it("a=1, b=2 ⊨ a≠b (closing a=b conflicts) ⇒ Just false", () => {
    const eqs = [{ lhs: EVar("a"), rhs: ELit(1) }, { lhs: EVar("b"), rhs: ELit(2) }];
    expect(entails(eqs, EVar("a"), EVar("b"))).toEqual(JUST_FALSE);
  });

  it("a=1, b=1 ⊨ a=b ⇒ Just true (same constant)", () => {
    const eqs = [{ lhs: EVar("a"), rhs: ELit(1) }, { lhs: EVar("b"), rhs: ELit(1) }];
    expect(entails(eqs, EVar("a"), EVar("b"))).toEqual(JUST_TRUE);
  });
});

// ---------------------------------------------------------------------------
// Sat / unsat — the theory verdict (eufSat).
// ---------------------------------------------------------------------------

describe("euf — sat / unsat (eufSat)", () => {
  it("[a=1, a=2] ⇒ Just false (lit-conflict, unsat)", () => {
    expect(sat([{ lhs: EVar("a"), rhs: ELit(1) }, { lhs: EVar("a"), rhs: ELit(2) }], [])).toEqual(JUST_FALSE);
  });

  it("[a=b] with [a≠b] ⇒ Just false (collapsed disequality, unsat)", () => {
    expect(sat([{ lhs: EVar("a"), rhs: EVar("b") }], [{ lhs: EVar("a"), rhs: EVar("b") }])).toEqual(JUST_FALSE);
  });

  it("[a=b] alone ⇒ Just true (EUF-consistent)", () => {
    expect(sat([{ lhs: EVar("a"), rhs: EVar("b") }], [])).toEqual(JUST_TRUE);
  });

  it("congruence-forced disequality: [a=b] with [f(a)≠f(b)] ⇒ Just false", () => {
    expect(
      sat([{ lhs: EVar("a"), rhs: EVar("b") }], [{ lhs: ECall("f", [EVar("a")]), rhs: ECall("f", [EVar("b")]) }]),
    ).toEqual(JUST_FALSE);
  });

  it("the subset-drop mixed constraint is still refuted: f(v)=1, f(v)=2 (a comparison would ride alongside) ⇒ Just false", () => {
    // eufSat sees only the extracted eq/neq atoms; the decideEmpty arm drops
    // the non-extractable comparison conjuncts, so unsat of this subset stands.
    const fv = ECall("f", [EVar("v")]);
    expect(sat([{ lhs: fv, rhs: ELit(1) }, { lhs: fv, rhs: ELit(2) }], [])).toEqual(JUST_FALSE);
  });
});

// ---------------------------------------------------------------------------
// Constructor + record congruence (constructors ARE functions).
// ---------------------------------------------------------------------------

describe("euf — EConstruct / ERecord congruence", () => {
  it("x=y ⊨ Just x = Just y (positional constructor congruence)", () => {
    expect(
      entails([{ lhs: EVar("x"), rhs: EVar("y") }], EConstruct("Just", [EVar("x")]), EConstruct("Just", [EVar("y")])),
    ).toEqual(JUST_TRUE);
  });

  it("no premises ⊨ Just x = Just y is Nothing (x, y not forced equal)", () => {
    expect(entails([], EConstruct("Just", [EVar("x")]), EConstruct("Just", [EVar("y")]))).toEqual(NOTHING);
  });

  it("different constructors are NOT congruence-merged: x=y ⊭ Just x = Foo y ⇒ Nothing", () => {
    expect(
      entails([{ lhs: EVar("x"), rhs: EVar("y") }], EConstruct("Just", [EVar("x")]), EConstruct("Foo", [EVar("y")])),
    ).toEqual(NOTHING);
  });

  it("named-field constructors: field NAMES fold into the signature (same names ⇒ congruent)", () => {
    const a = EConstruct("Bot", [], [{ name: "token", value: EVar("x") }]);
    const b = EConstruct("Bot", [], [{ name: "token", value: EVar("y") }]);
    expect(entails([{ lhs: EVar("x"), rhs: EVar("y") }], a, b)).toEqual(JUST_TRUE);
  });

  it("named-field constructors with DIFFERENT field names are distinct terms ⇒ Nothing", () => {
    const a = EConstruct("Bot", [], [{ name: "token", value: EVar("x") }]);
    const b = EConstruct("Bot", [], [{ name: "secret", value: EVar("y") }]);
    expect(entails([{ lhs: EVar("x"), rhs: EVar("y") }], a, b)).toEqual(NOTHING);
  });

  it("x=y ⊨ {p=x} = {p=y} (ERecord congruence over the field values)", () => {
    expect(
      entails(
        [{ lhs: EVar("x"), rhs: EVar("y") }],
        ERecord([{ name: "p", value: EVar("x") }]),
        ERecord([{ name: "p", value: EVar("y") }]),
      ),
    ).toEqual(JUST_TRUE);
  });
});

// ---------------------------------------------------------------------------
// The §2 read-to-read enabler rows (Expr-lift → EUF; the PE-Phase-2 hook).
// jsonLogicToExpr returns a Result — the enabler unwraps the Ok term.
// ---------------------------------------------------------------------------

const read = (k: string) =>
  (dispatchedJsonLogicToExpr({ call: ["$effect:HasStateIO:read", { var: k }] }) as { _0: unknown })._0;

describe("euf — read-to-read enabler (partial-evaluator-substrate Phase 2 hook)", () => {
  it("k1=k2 ⊨ read(k1)=read(k2) ⇒ Just true (the congruence that unblocks PE symbolic reach)", () => {
    expect(entails([{ lhs: EVar("k1"), rhs: EVar("k2") }], read("k1"), read("k2"))).toEqual(JUST_TRUE);
  });

  it("no premise ⊨ read(k1)=read(k2) is Nothing (distinct keys, no forced equality)", () => {
    expect(entails([], read("k1"), read("k2"))).toEqual(NOTHING);
  });

  it("k1=k2 with [read(k1)≠read(k2)] ⇒ Just false (unsat — congruence collapses the disequality)", () => {
    expect(sat([{ lhs: EVar("k1"), rhs: EVar("k2") }], [{ lhs: read("k1"), rhs: read("k2") }])).toEqual(JUST_FALSE);
  });

  it("euf itself does NOT fence effects — the $effect: head is treated as a plain function symbol here (the caller owns the memory model)", () => {
    // Congruence over read(...) works precisely BECAUSE euf treats the effect
    // head mathematically; the DEFENSIVE fence lives only in the decider arm.
    expect(entails([{ lhs: EVar("k1"), rhs: EVar("k2") }], read("k1"), read("k2"))).toEqual(JUST_TRUE);
  });
});

// ---------------------------------------------------------------------------
// Key discrimination — ELit "1" vs ELit 1 (the peTruthy bug class regression).
// std eq is JS-loose ("1" == 1), so a naive comparator would MERGE them.
// ---------------------------------------------------------------------------

describe("euf — scalar-lit type discrimination (peTruthy regression)", () => {
  it('f("1")=x, f(1)=y with [x≠y] is SAT ⇒ Just true (ELit "1" and ELit 1 are distinct terms)', () => {
    expect(
      sat(
        [
          { lhs: ECall("f", [ELit("1")]), rhs: EVar("x") },
          { lhs: ECall("f", [ELit(1)]), rhs: EVar("y") },
        ],
        [{ lhs: EVar("x"), rhs: EVar("y") }],
      ),
    ).toEqual(JUST_TRUE);
  });

  it('x="1", y=1 ⊨ x≠y ⇒ Just false (the string "1" and the number 1 are DISTINCT constants; a JS-loose comparator would wrongly say Just true)', () => {
    expect(entails([{ lhs: EVar("x"), rhs: ELit("1") }, { lhs: EVar("y"), rhs: ELit(1) }], EVar("x"), EVar("y"))).toEqual(
      JUST_FALSE,
    );
  });

  it("bool vs number lits stay distinct: a=true, b=1 with [a≠b] ⇒ Just true (SAT)", () => {
    expect(sat([{ lhs: EVar("a"), rhs: ELit(true) }, { lhs: EVar("b"), rhs: ELit(1) }], [{ lhs: EVar("a"), rhs: EVar("b") }])).toEqual(
      JUST_TRUE,
    );
  });
});

// ---------------------------------------------------------------------------
// Totality — a deep congruence chain terminates under the round bound.
// ---------------------------------------------------------------------------

describe("euf — totality (the round bound)", () => {
  it("a deep f-chain f^8(a)=a closes without hanging ⇒ Just true (SAT)", () => {
    let t: unknown = EVar("a");
    for (let i = 0; i < 8; i++) t = ECall("f", [t]);
    expect(sat([{ lhs: t, rhs: EVar("a") }], [])).toEqual(JUST_TRUE);
  });
});

// ---------------------------------------------------------------------------
// The decideEmpty EUF arm (Deliverable C) — the D′ public-top precedent.
// unsat ⇒ Just true (empty); satisfiable / effectful ⇒ Nothing (never Just false).
// ---------------------------------------------------------------------------

const andSpine = (...cs: unknown[]) => cs.reduce((acc, c) => ECall("and", [c, acc]));

describe("euf — the decideEmpty arm (Deliverable C)", () => {
  it("the headline: {v | f v == 1 ∧ f v == 2} ⇒ Just true (was Nothing; an uninterpreted head refuted)", () => {
    const fv = ECall("f", [EVar("v")]);
    const s = SeWhere(ECall("and", [ECall("eq", [fv, ELit(1)]), ECall("eq", [fv, ELit(2)])]));
    expect(decideEmpty(s)).toEqual(JUST_TRUE);
  });

  it("a satisfiable predicate {v | f v == 1 ∧ g v == 2} stays Nothing (EUF-sat does NOT certify empty)", () => {
    const s = SeWhere(
      ECall("and", [ECall("eq", [ECall("f", [EVar("v")]), ELit(1)]), ECall("eq", [ECall("g", [EVar("v")]), ELit(2)])]),
    );
    expect(decideEmpty(s)).toEqual(NOTHING);
  });

  it("mixed predicate {v | f v == 1 ∧ f v == 2 ∧ v > 0} ⇒ Just true (the comparison conjunct is dropped; the eq subset still refutes)", () => {
    const fv = ECall("f", [EVar("v")]);
    const s = SeWhere(
      andSpine(ECall("eq", [fv, ELit(1)]), ECall("eq", [fv, ELit(2)]), ECall("gt", [EVar("v"), ELit(0)])),
    );
    expect(decideEmpty(s)).toEqual(JUST_TRUE);
  });

  it("the $effect: fence: {v | read v == 1 ∧ read v == 2} stays Nothing (effectful sites are never congruence-merged by the ambient decider)", () => {
    const rv = ECall("$effect:HasStateIO:read", [EVar("v")]);
    const s = SeWhere(ECall("and", [ECall("eq", [rv, ELit(1)]), ECall("eq", [rv, ELit(2)])]));
    expect(decideEmpty(s)).toEqual(NOTHING);
  });

  it("a neq refutation: {v | f v == 1 ∧ not (f v == 1)} ⇒ Just true", () => {
    const fv = ECall("f", [EVar("v")]);
    const s = SeWhere(ECall("and", [ECall("eq", [fv, ELit(1)]), ECall("not", [ECall("eq", [fv, ELit(1)])])]));
    expect(decideEmpty(s)).toEqual(JUST_TRUE);
  });

  it("a SeWhere with no extractable eq/neq atoms stays Nothing (zero atoms ⇒ no verdict)", () => {
    const s = SeWhere(ECall("gt", [EVar("v"), ELit(0)]));
    expect(decideEmpty(s)).toEqual(NOTHING);
  });

  it("the CORE (connective algebra) is untouched — a bare SeWhere is Nothing without whereEmpty deciding it, before the EUF arm", () => {
    // The arm sits at the PUBLIC top; the CORE never calls EUF (no cycle).
    const fv = ECall("f", [EVar("v")]);
    const s = SeWhere(ECall("and", [ECall("eq", [fv, ELit(1)]), ECall("eq", [fv, ELit(2)])]));
    const core = dispatchEngineBodyWithDeciderCtx("engine:setAlgebraDecideEmptyCore", [s]) as Tri;
    expect(core).toEqual(NOTHING);
  });
});
