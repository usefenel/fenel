// decide-substrate Phase 6 — conformance tests for `theory-combine` (Nelson-Oppen
// combination of EUF + an order theory over the shared `Tri` currency). brief:
// `workstreams/decide-substrate/briefs/phase-6-equality-ground-truth-nelson-oppen.md`.
//
// The order theory (over the euf universe root-indices) derives entailed
// equalities from nonstrict cycles and hands them to EUF; EUF's congruence +
// lit-conflict refute; the loop runs to a fixpoint. All verdicts ride `Tri`;
// every `Just false` is sound over EVERY interpretation of the Step-1 (type-
// honest eq/order) runtime semantics. NEVER `Just true` (no combined-sat
// certificate — the Phase-5 honesty). This phase is GATED on Step 1 (the
// coercing `lte("5",5)` would make the R3 equality derivation unsound).

import { describe, it, expect } from "vitest";
import {
  dispatchEngineBody,
  dispatchEngineBodyWithDeciderCtx,
  dispatchedSatSymbolic,
} from "./engine-bodies-dispatch";

// --- tiny Expr builders (plain $tag-tagged objects) ----------------------
const EVar = (name: string) => ({ $tag: "EVar", name });
const ELit = (value: unknown) => ({ $tag: "ELit", value });
const ECall = (fnId: string, args: unknown[]) => ({ $tag: "ECall", fnId, args });
const SeWhere = (pred: unknown) => ({ $tag: "SeWhere", pred });

type Pair = { lhs: unknown; rhs: unknown };
type Tri = { $tag: string; _0?: unknown };

const JUST_TRUE = { $tag: "Just", _0: true };
const JUST_FALSE = { $tag: "Just", _0: false };
const NOTHING = { $tag: "Nothing" };

const satCombined = (eqs: Pair[], neqs: Pair[], ltes: Pair[], lts: Pair[]) =>
  dispatchEngineBody("engine:satCombined", [eqs, neqs, ltes, lts]) as Tri;
const whereAtoms = (pred: unknown) => dispatchEngineBody("engine:noWhereAtoms", [pred]) as {
  eqs: Pair[]; neqs: Pair[]; ltes: Pair[]; lts: Pair[];
};
const decideEmpty = (s: unknown) =>
  dispatchEngineBodyWithDeciderCtx("engine:setAlgebraDecideEmpty", [s]) as Tri;

// left-nested and-spine: and(c1, and(c2, and(c3, …)))
const andSpine = (...cs: unknown[]) => cs.reduceRight((acc, c) => ECall("and", [c, acc]));

const x = EVar("x"), y = EVar("y"), z = EVar("z");
const f = (t: unknown) => ECall("f", [t]);

// ---------------------------------------------------------------------------
// The mixed-atom collector (Step 2 / D1).
// ---------------------------------------------------------------------------

describe("theory-combine — noWhereAtoms (the mixed collector)", () => {
  it("collects eq / neq / not(eq) / lte / lt verbatim; gte / gt flip to swapped lte / lt", () => {
    const pred = andSpine(
      ECall("eq", [x, ELit(1)]),
      ECall("neq", [y, ELit(2)]),
      ECall("not", [ECall("eq", [z, ELit(3)])]),
      ECall("lte", [x, y]),
      ECall("lt", [y, z]),
      ECall("gte", [z, ELit(5)]), // z ≥ 5  ⇒  5 ≤ z
      ECall("gt", [ELit(9), x]), //  9 > x  ⇒  x < 9
    );
    const a = whereAtoms(pred);
    expect(a.eqs).toEqual([{ lhs: x, rhs: ELit(1) }]);
    expect(a.neqs).toEqual([{ lhs: y, rhs: ELit(2) }, { lhs: z, rhs: ELit(3) }]);
    expect(a.ltes).toEqual([{ lhs: x, rhs: y }, { lhs: ELit(5), rhs: z }]);
    expect(a.lts).toEqual([{ lhs: y, rhs: z }, { lhs: x, rhs: ELit(9) }]);
  });

  it("non-extractable conjuncts are DROPPED (sound subset-drop)", () => {
    const pred = andSpine(ECall("eq", [x, ELit(1)]), ECall("isString", [y]), ECall("or", [x, y]));
    const a = whereAtoms(pred);
    expect(a.eqs).toEqual([{ lhs: x, rhs: ELit(1) }]);
    expect(a.neqs).toEqual([]);
    expect(a.ltes).toEqual([]);
    expect(a.lts).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// The headline Nelson-Oppen rows (§5.3) — satCombined directly.
// ---------------------------------------------------------------------------

describe("theory-combine — satCombined (the exchange loop)", () => {
  it("THE textbook row: x ≤ y ∧ y ≤ x ∧ f(x) ≠ f(y) ⇒ Just false (order derives x=y, EUF refutes)", () => {
    expect(satCombined([], [{ lhs: f(x), rhs: f(y) }], [{ lhs: x, rhs: y }, { lhs: y, rhs: x }], [])).toEqual(JUST_FALSE);
  });

  it("lit-anchored cycle: x ≤ 5 ∧ 5 ≤ x ∧ f(x) ≠ f(5) ⇒ Just false", () => {
    const f5 = f(ELit(5));
    expect(
      satCombined([], [{ lhs: f(x), rhs: f5 }], [{ lhs: x, rhs: ELit(5) }, { lhs: ELit(5), rhs: x }], []),
    ).toEqual(JUST_FALSE);
  });

  it("R2 numeric-lit path: x ≤ 3 ∧ 5 ≤ x ⇒ Just false (5 ⇝ x ⇝ 3, but 5 > 3)", () => {
    expect(satCombined([], [], [{ lhs: x, rhs: ELit(3) }, { lhs: ELit(5), rhs: x }], [])).toEqual(JUST_FALSE);
  });

  it("R1 strict cycle: x < y ∧ y < x ⇒ Just false", () => {
    expect(satCombined([], [], [], [{ lhs: x, rhs: y }, { lhs: y, rhs: x }])).toEqual(JUST_FALSE);
  });

  it("a strict self-edge x < x ⇒ Just false (R1 catches the degenerate strict cycle)", () => {
    expect(satCombined([], [], [], [{ lhs: x, rhs: x }])).toEqual(JUST_FALSE);
  });

  it("no cycle, no conflict: x ≤ y ∧ y ≤ z ⇒ Nothing (honest — never Just true)", () => {
    expect(satCombined([], [], [{ lhs: x, rhs: y }, { lhs: y, rhs: z }], [])).toEqual(NOTHING);
  });

  it("a consistent order chain is Nothing even when total-looking: x ≤ y ∧ y ≤ z ∧ x ≤ z ⇒ Nothing", () => {
    expect(satCombined([], [], [{ lhs: x, rhs: y }, { lhs: y, rhs: z }, { lhs: x, rhs: z }], [])).toEqual(NOTHING);
  });

  it("R3 across three nodes: x ≤ y ∧ y ≤ z ∧ z ≤ x ∧ f(x) ≠ f(z) ⇒ Just false (3-cycle ⇒ x=y=z)", () => {
    expect(
      satCombined([], [{ lhs: f(x), rhs: f(z) }], [{ lhs: x, rhs: y }, { lhs: y, rhs: z }, { lhs: z, rhs: x }], []),
    ).toEqual(JUST_FALSE);
  });

  it("order equality feeds a lit-conflict: x ≤ 5 ∧ 5 ≤ x ∧ x ≤ 3 ∧ 3 ≤ x ⇒ Just false (x=5 ∧ x=3)", () => {
    expect(
      satCombined([], [], [
        { lhs: x, rhs: ELit(5) }, { lhs: ELit(5), rhs: x },
        { lhs: x, rhs: ELit(3) }, { lhs: ELit(3), rhs: x },
      ], []),
    ).toEqual(JUST_FALSE);
  });

  it("empty atoms ⇒ Nothing", () => {
    expect(satCombined([], [], [], [])).toEqual(NOTHING);
  });
});

// ---------------------------------------------------------------------------
// Phase 6D — the DATATYPE theory (ctor distinctness + injectivity).
// Sound over the Step-1 structural eq: every ctor except True/False is
// tag-preserving (the B5 coercion arm is Bool-only), so distinct ctor names ⇒
// distinct `$tag`s ⇒ never structurally equal; same-shape constructs are equal
// iff their children are (injectivity).
// ---------------------------------------------------------------------------

const ECon = (ctor: string, args: unknown[]) => ({ $tag: "EConstruct", ctor, args });

describe("theory-combine — the datatype theory (Phase 6D)", () => {
  it("D1 distinctness: x = Just 1 ∧ x = Nothing ⇒ Just false", () => {
    expect(
      satCombined([{ lhs: x, rhs: ECon("Just", [ELit(1)]) }, { lhs: x, rhs: ECon("Nothing", []) }], [], [], []),
    ).toEqual(JUST_FALSE);
  });

  it("D2 injectivity feeds congruence: x = Just a ∧ x = Just b ∧ f(a) ≠ f(b) ⇒ Just false", () => {
    const a = EVar("a"), b = EVar("b");
    expect(
      satCombined(
        [{ lhs: x, rhs: ECon("Just", [a]) }, { lhs: x, rhs: ECon("Just", [b]) }],
        [{ lhs: f(a), rhs: f(b) }], [], [],
      ),
    ).toEqual(JUST_FALSE);
  });

  it("D2 injectivity feeds the lit-conflict: x = Just 1 ∧ x = Just 2 ⇒ Just false (1 = 2 derived)", () => {
    expect(
      satCombined([{ lhs: x, rhs: ECon("Just", [ELit(1)]) }, { lhs: x, rhs: ECon("Just", [ELit(2)]) }], [], [], []),
    ).toEqual(JUST_FALSE);
  });

  it("D2 recurses through nested constructs: x = Just (Just 1) ∧ x = Just (Just 2) ⇒ Just false", () => {
    expect(
      satCombined(
        [
          { lhs: x, rhs: ECon("Just", [ECon("Just", [ELit(1)])]) },
          { lhs: x, rhs: ECon("Just", [ECon("Just", [ELit(2)])]) },
        ],
        [], [], [],
      ),
    ).toEqual(JUST_FALSE);
  });

  it("the 3-theory exchange: x ≤ y ∧ y ≤ x ∧ x = Just 1 ∧ y = Nothing ⇒ Just false (order derives x=y, datatype refutes)", () => {
    expect(
      satCombined(
        [{ lhs: x, rhs: ECon("Just", [ELit(1)]) }, { lhs: y, rhs: ECon("Nothing", []) }],
        [], [{ lhs: x, rhs: y }, { lhs: y, rhs: x }], [],
      ),
    ).toEqual(JUST_FALSE);
  });

  it("D3 lit-vs-ctor: x = ⟨{$tag:'Nothing'} literal⟩ ∧ x = Just 1 ⇒ Just false", () => {
    expect(
      satCombined([{ lhs: x, rhs: ELit({ $tag: "Nothing" }) }, { lhs: x, rhs: ECon("Just", [ELit(1)]) }], [], [], []),
    ).toEqual(JUST_FALSE);
  });

  it("the coercing family abstains: x = True ∧ x = False ⇒ Nothing (Bool ctors coerce — B5; the boolean-lit spelling refutes via euf)", () => {
    expect(satCombined([{ lhs: x, rhs: ECon("True", []) }, { lhs: x, rhs: ECon("False", []) }], [], [], [])).toEqual(
      NOTHING,
    );
  });

  it("same ctor, different spelling (positional vs named) does NOT trip distinctness: honest Nothing", () => {
    const positional = ECon("Just", [EVar("a")]);
    const named = { $tag: "EConstruct", ctor: "Just", args: [], fields: [{ name: "value", value: EVar("b") }] };
    expect(satCombined([{ lhs: x, rhs: positional }, { lhs: x, rhs: named }], [], [], [])).toEqual(NOTHING);
  });

  it("a lone construct equation stays honest: x = Just a ⇒ Nothing", () => {
    expect(satCombined([{ lhs: x, rhs: ECon("Just", [EVar("a")]) }], [], [], [])).toEqual(NOTHING);
  });

  it("the match-arm currency (the fork-driver enabler): decideEmpty {v | v == Just 1 ∧ v == Nothing} ⇒ Just true", () => {
    const v = EVar("v");
    const pred = ECall("and", [
      ECall("eq", [v, ECon("Just", [ELit(1)])]),
      ECall("eq", [v, ECon("Nothing", [])]),
    ]);
    expect(decideEmpty(SeWhere(pred))).toEqual(JUST_TRUE);
  });

  it("satSymbolic inherits the datatype theory: read(k) == Just 1 ∧ read(k) == Nothing ⇒ Just false (zero IO)", () => {
    const rk = ECall(GET, [ELit("k")]);
    const pred = ECall("and", [
      ECall("eq", [rk, ECon("Just", [ELit(1)])]),
      ECall("eq", [rk, ECon("Nothing", [])]),
    ]);
    expect(satSym(specHS, pred)).toEqual(JUST_FALSE);
  });
});

// ---------------------------------------------------------------------------
// The decideEmpty face (Deliverable D4.1) — the arm WIDENS in place.
// ---------------------------------------------------------------------------

describe("theory-combine — the decideEmpty arm (widened in place)", () => {
  it("the Nelson-Oppen headline: {v | v ≥ 5 ∧ v ≤ 5 ∧ f v ≠ f 5} ⇒ Just true (was Nothing)", () => {
    const v = EVar("v");
    const pred = andSpine(
      ECall("gte", [v, ELit(5)]),
      ECall("lte", [v, ELit(5)]),
      ECall("neq", [f(v), f(ELit(5))]),
    );
    expect(decideEmpty(SeWhere(pred))).toEqual(JUST_TRUE);
  });

  it("a pure-order refutation: {v | v < 0 ∧ 0 < v} ⇒ Just true (R1 strict cycle)", () => {
    const v = EVar("v");
    const pred = ECall("and", [ECall("lt", [v, ELit(0)]), ECall("lt", [ELit(0), v])]);
    expect(decideEmpty(SeWhere(pred))).toEqual(JUST_TRUE);
  });

  it("an R2 lit-path refutation: {v | v ≤ 3 ∧ 5 ≤ v} ⇒ Just true", () => {
    const v = EVar("v");
    const pred = ECall("and", [ECall("lte", [v, ELit(3)]), ECall("lte", [ELit(5), v])]);
    expect(decideEmpty(SeWhere(pred))).toEqual(JUST_TRUE);
  });

  it("the EUF headline still refutes: {v | f v == 1 ∧ f v == 2} ⇒ Just true", () => {
    const v = EVar("v");
    const pred = ECall("and", [ECall("eq", [f(v), ELit(1)]), ECall("eq", [f(v), ELit(2)])]);
    expect(decideEmpty(SeWhere(pred))).toEqual(JUST_TRUE);
  });

  it("a satisfiable ordered predicate stays Nothing: {v | v ≤ 5 ∧ 3 ≤ v} (never Just true/false)", () => {
    const v = EVar("v");
    const pred = ECall("and", [ECall("lte", [v, ELit(5)]), ECall("lte", [ELit(3), v])]);
    expect(decideEmpty(SeWhere(pred))).toEqual(NOTHING);
  });

  it("the $effect: fence holds over mixed atoms: {v | read v ≤ 5 ∧ 5 ≤ read v ∧ f (read v) ≠ f 5} ⇒ Nothing", () => {
    const v = EVar("v");
    const rv = ECall("$effect:HasStateIO:read", [v]);
    const pred = andSpine(
      ECall("lte", [rv, ELit(5)]),
      ECall("lte", [ELit(5), rv]),
      ECall("neq", [f(rv), f(ELit(5))]),
    );
    expect(decideEmpty(SeWhere(pred))).toEqual(NOTHING);
  });
});

// ---------------------------------------------------------------------------
// The satSymbolic face (Deliverable D4.2) — the lawful memory-model gate + the
// combined atoms. Order constraints over reads refute too.
// ---------------------------------------------------------------------------

const GET = "$effect:HasStateIO:getInstance";
const SET = "$effect:HasStateIO:setInstance"; // a WRITE method (not in `reads`)
const specHS = [{ effectClass: "HasStateIO", reads: ["getInstance"] }];
const readV = (k: string) => ECall(GET, [EVar(k)]);
const satSym = (spec: unknown, pred: unknown) => dispatchedSatSymbolic(spec, pred) as Tri;

describe("theory-combine — satSymbolic widened to mixed atoms", () => {
  it("read(a) ≤ read(b) ∧ read(b) ≤ read(a) ∧ f(read a) ≠ f(read b) ⇒ Just false (zero IO, order⇄EUF)", () => {
    const ra = readV("a"), rb = readV("b");
    const pred = andSpine(
      ECall("lte", [ra, rb]),
      ECall("lte", [rb, ra]),
      ECall("neq", [f(ra), f(rb)]),
    );
    expect(satSym(specHS, pred)).toEqual(JUST_FALSE);
  });

  it("a WRITE present anywhere ⇒ Nothing (the gate refuses to model past a write)", () => {
    const ra = readV("a"), rb = readV("b");
    const base = andSpine(ECall("lte", [ra, rb]), ECall("lte", [rb, ra]), ECall("neq", [f(ra), f(rb)]));
    const withWrite = ECall("and", [base, ECall("eq", [ECall(SET, [ELit("k")]), ELit(0)])]);
    expect(satSym(specHS, withWrite)).toEqual(NOTHING);
  });

  it("a class NOT declared Symbolic ⇒ Nothing (unmodeled effect — honest)", () => {
    const ra = readV("a"), rb = readV("b");
    const pred = andSpine(ECall("lte", [ra, rb]), ECall("lte", [rb, ra]), ECall("neq", [f(ra), f(rb)]));
    expect(satSym([{ effectClass: "OtherClass", reads: ["getInstance"] }], pred)).toEqual(NOTHING);
  });

  it("the Phase-2 EUF row still refutes verbatim: read(k)==1 ∧ read(k)==2 ⇒ Just false", () => {
    const rk = ECall(GET, [ELit("k")]);
    const pred = ECall("and", [ECall("eq", [rk, ELit(1)]), ECall("eq", [rk, ELit(2)])]);
    expect(satSym(specHS, pred)).toEqual(JUST_FALSE);
  });

  it("a genuinely-satisfiable ordered read predicate ⇒ Nothing (never Just true)", () => {
    const ra = readV("a"), rb = readV("b");
    const pred = ECall("and", [ECall("lte", [ra, rb]), ECall("lte", [rb, ra])]);
    expect(satSym(specHS, pred)).toEqual(NOTHING);
  });
});
