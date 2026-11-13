// decide-substrate Phase 8μ.3 (Steps A+B+D) — the ∀-INTRO arm + the ∀-law e2e.
// `SeCtor c fs ⊆ SeWhere{pred}` decides by symbolic validity over the ctor's
// field domains (setAlgebraCtorSubsetWhere — all-pure, kernel-premise-safe);
// `propForallSet v S P = propSubset S (comprehend v P)` presents a ∀ as the
// subset judgment (the judgment iso's PropForall row made callable), and a SeMu
// domain rides the shipped 8μ.2 Park pipeline to SolverChecked — the FIRST
// GENUINE STRUCTURAL-INDUCTION PROOFS. Brief:
// `workstreams/decide-substrate/briefs/phase-8mu-3-abd-forall-intro.md`.

import { describe, it, expect } from "vitest";
import { isSubset } from "./set-algebra";
import {
  dispatchEngineBody,
  __registerFnBodyFixtureForTests,
} from "./engine-bodies-dispatch";
import { loadFenelModule } from "./fenel-module";
import { verify } from "./kernel";
import { decidableSetProposerNative } from "./modules/prover";
import { decidableSetProof } from "./prover";
import type { SetExpr } from "./types";

function mb(m: unknown): "true" | "false" | "nothing" {
  const x = m as { $tag?: string; _0?: unknown; value?: unknown };
  if (x?.$tag === "Just") return (x._0 ?? x.value) ? "true" : "false";
  return "nothing";
}

// --- Se* builders (the mu-park style — hand-built, registration-independent) --
const ctor = (c: string, fields: unknown[]): SetExpr =>
  ({ $tag: "SeCtor", ctor: c, fields } as unknown as SetExpr);
const MU_FORALL_FIELD_IDS: Record<string, string> = {
  head: "63000000-0000-4000-8000-000000000001",
  tail: "63000000-0000-4000-8000-000000000002",
  v: "63000000-0000-4000-8000-000000000003",
};
const fld = (wireName: string, set: unknown) => ({
  $tag: "SetCtorField",
  key: wireName === "_0"
    ? { $tag: "PositionalField", index: 0 }
    : { $tag: "NamedField", ref: { $ref: MU_FORALL_FIELD_IDS[wireName] } },
  wireName,
  set,
});
const enumS = (...vs: unknown[]): SetExpr => ({ $tag: "SeEnum", values: vs } as unknown as SetExpr);
const ref = (h: string): SetExpr => ({ $tag: "SeRef", handle: h } as unknown as SetExpr);
const mu = (v: string, body: SetExpr): SetExpr => ({ $tag: "SeMu", var: v, body } as unknown as SetExpr);
const union = (...bs: unknown[]): SetExpr => ({ $tag: "SeUnion", branches: bs } as unknown as SetExpr);
const intervalGte0: SetExpr = {
  $tag: "SeInterval",
  interval: { lo: { $tag: "Just", _0: { value: 0, inclusive: true } }, hi: { $tag: "Nothing" } },
} as unknown as SetExpr;

// --- Expr / Pattern builders (the fork-exec style) ---------------------------
const EVar = (name: string) => ({ $tag: "EVar", name });
const ELit = (value: unknown) => ({ $tag: "ELit", value });
const ECall = (fnId: string, args: unknown[]) => ({ $tag: "ECall", fnId, args });
const EMatch = (scrutinee: unknown, arms: unknown[]) => ({ $tag: "EMatch", scrutinee, arms });
const PatVar = (name: string) => ({ $tag: "PatVar", name });
const PatLit = (value: unknown) => ({ $tag: "PatLit", value });
const PatConstruct = (c: string, args: unknown[] = []) => ({ $tag: "PatConstruct", ctor: c, args });
const PatWildcard = { $tag: "PatWildcard" };

// ⟦{x | P}⟧ — the ONE comprehension-builder (fences a match pred to SeWhere{pred: Expr}).
const comp = (p: unknown): SetExpr => dispatchEngineBody("engine:comprehend", ["x", p]) as SetExpr;
// The ∀-presentation builder (Step D): ∀ x ∈ S. P as the subset judgment.
const forallClaim = (S: SetExpr, p: unknown): unknown =>
  dispatchEngineBody("engine:propForallSet", ["x", S, p]);

// The induction happy path supplies an exact native scalar enum. A bare
// interval also admits exact Nat/Int records and proves no native-order fact.
const listNativeSamples = (): SetExpr =>
  mu("L", union(ctor("Nil", []), ctor("Cons", [fld("head", enumS(0, 1, 2)), fld("tail", ref("L"))])));
const listInterval = (): SetExpr =>
  mu("L", union(ctor("Nil", []), ctor("Cons", [fld("head", intervalGte0), fld("tail", ref("L"))])));

// P_ok: case x of Nil -> true; Cons h t -> h >= 0   (tag-membership + interval-over-field)
const P_ok = EMatch(EVar("x"), [
  { pattern: PatConstruct("Nil", []), body: ELit(true) },
  { pattern: PatConstruct("Cons", [PatVar("h"), PatVar("t")]), body: ECall("gte", [EVar("h"), ELit(0)]) },
]);
// P_false: case x of Nil -> true; Cons h t -> h >= 1   (falsifiable at h = 0)
const P_false = EMatch(EVar("x"), [
  { pattern: PatConstruct("Nil", []), body: ELit(true) },
  { pattern: PatConstruct("Cons", [PatVar("h"), PatVar("t")]), body: ECall("gte", [EVar("h"), ELit(1)]) },
]);

describe("8μ.3 Step A — the ctor⊆comprehension arm (SeCtor ⊆ SeWhere)", () => {
  it("FENCE (interval field): ordered membership cannot prove a native scalar comparison", () => {
    const P = EMatch(EVar("x"), [
      { pattern: PatConstruct("Nothing", []), body: ELit(true) },
      { pattern: PatConstruct("Just", [PatVar("v")]), body: ECall("gte", [EVar("v"), ELit(0)]) },
    ]);
    expect(mb(isSubset(ctor("Just", [fld("_0", intervalGte0)]), comp(P)))).toBe("nothing");
  });

  it("PROVE (enum field, min/max atoms): Tag {v ∈ {1,2,3}} ⊆ ⟦case x of Tag v→v≤3⟧ = Just true", () => {
    const P = EMatch(EVar("x"), [
      { pattern: PatConstruct("Tag", [PatVar("v")]), body: ECall("lte", [EVar("v"), ELit(3)]) },
    ]);
    expect(mb(isSubset(ctor("Tag", [fld("v", enumS(1, 2, 3))]), comp(P)))).toBe("true");
  });

  it("PROVE (catch-all arm): any ctor ⊆ ⟦case x of _→true⟧ = Just true", () => {
    const P = EMatch(EVar("x"), [{ pattern: PatWildcard, body: ELit(true) }]);
    expect(mb(isSubset(ctor("Just", [fld("_0", intervalGte0)]), comp(P)))).toBe("true");
  });

  it("PROVE (tag-membership / distinct-ctor skip): Nothing-ctor ⊆ ⟦case x of Just v→false; Nothing→true⟧ = Just true", () => {
    // The Just arm provably can't match a Nothing-value ($tag distinctness) — skipped.
    const P = EMatch(EVar("x"), [
      { pattern: PatConstruct("Just", [PatVar("v")]), body: ELit(false) },
      { pattern: PatConstruct("Nothing", []), body: ELit(true) },
    ]);
    expect(mb(isSubset(ctor("Nothing", []), comp(P)))).toBe("true");
  });

  it("REFUTE (ground witness): Just {_0 ∈ [0,∞)} ⊆ ⟦case x of Nothing→true; Just v→v≥1⟧ = Just false (witness v=0)", () => {
    const P = EMatch(EVar("x"), [
      { pattern: PatConstruct("Nothing", []), body: ELit(true) },
      { pattern: PatConstruct("Just", [PatVar("v")]), body: ECall("gte", [EVar("v"), ELit(1)]) },
    ]);
    expect(mb(isSubset(ctor("Just", [fld("_0", intervalGte0)]), comp(P)))).toBe("false");
  });

  it("REFUTE (definite-false arm body): Just {_0 ∈ {5}} ⊆ ⟦case x of Just v→false; _→true⟧ = Just false", () => {
    const P = EMatch(EVar("x"), [
      { pattern: PatConstruct("Just", [PatVar("v")]), body: ELit(false) },
      { pattern: PatWildcard, body: ELit(true) },
    ]);
    expect(mb(isSubset(ctor("Just", [fld("_0", enumS(5))]), comp(P)))).toBe("false");
  });

  it("FENCE: a guard on the selected arm ⇒ Nothing (no false verdict)", () => {
    const P = EMatch(EVar("x"), [
      {
        pattern: PatConstruct("Just", [PatVar("v")]),
        guard: ECall("gte", [EVar("v"), ELit(0)]),
        body: ELit(true),
      },
    ]);
    expect(mb(isSubset(ctor("Just", [fld("_0", intervalGte0)]), comp(P)))).toBe("nothing");
  });

  it("FENCE: a lit ctor-pattern arg (per-arm case split — v2) ⇒ Nothing", () => {
    const P = EMatch(EVar("x"), [
      { pattern: PatConstruct("Just", [PatLit(0)]), body: ELit(true) },
    ]);
    expect(mb(isSubset(ctor("Just", [fld("_0", enumS(0))]), comp(P)))).toBe("nothing");
  });

  it("FENCE: a non-EMatch pred (a bare call the comprehension fenced) ⇒ Nothing", () => {
    const P = ECall("someOpaqueFn", [EVar("x")]);
    expect(mb(isSubset(ctor("Just", [fld("_0", intervalGte0)]), comp(P)))).toBe("nothing");
  });

  it("uncertified order negation NEVER false-proves — the PROVE face abstains; the REFUTE face may still soundly refute", () => {
    // The field domain is a STRING enum — the ¬(v ≥ 0) flip needs numeric certs
    // on both operands, so the PROVE face abstains ("a"/"b" certify nothing).
    // The REFUTE face then fires legitimately: witness v="a", and gte("a", 0)
    // is FALSE under the Step-1 same-type comparisons ⇒ Just{"a"} genuinely
    // fails the pred ⇒ Just false is a REAL refutation (strictly better than
    // Nothing). The invariant pinned here is "never a false PROVE".
    const P = EMatch(EVar("x"), [
      { pattern: PatConstruct("Just", [PatVar("v")]), body: ECall("gte", [EVar("v"), ELit(0)]) },
    ]);
    expect(mb(isSubset(ctor("Just", [fld("_0", enumS("a", "b"))]), comp(P)))).toBe("false");
  });
});

describe("8μ.3 Step D — the ∀-law e2e over μ (the capstone)", () => {
  it("does not inductively certify native-order predicates over record-admitting interval heads", () => {
    expect(mb(isSubset(listInterval(), comp(P_ok)))).toBe("nothing");
  });
  it("HEADLINE: ∀ xs ∈ ⟦List {0,1,2}⟧. (case xs of Nil→true; Cons h t→h≥0) — the subset decides Just true through Park", () => {
    expect(mb(isSubset(listNativeSamples(), comp(P_ok)))).toBe("true");
  });

  it("HEADLINE (kernel): the ∀-claim round-trips proposer → mu-induction cert → verifyMuInduction ⇒ SolverChecked", () => {
    const claim = forallClaim(listNativeSamples(), P_ok);
    const out = decidableSetProposerNative(claim) as { $tag: string; _0: { kind?: string } };
    expect(out.$tag).toBe("Ok");
    expect(out._0.kind).toBe("mu-induction"); // the domain is a μ ⇒ the Park certificate
    const v = verify(claim as never, out._0 as never);
    expect(v.$tag).toBe("Ok");
    if (v.$tag === "Ok") expect(v._0.$tag).toBe("SolverChecked");
  });

  it("a FALSE property (h ≥ 1 over native sample heads) is NEVER proven (honest Nothing through the μ)", () => {
    // The Cons obligation's refute needs a tail witness drawn from the
    // comprehension itself — unwitnessable v1 ⇒ the ∀ stays undecided (sound).
    expect(mb(isSubset(listNativeSamples(), comp(P_false)))).toBe("nothing");
  });

  it("a FALSE ∀ over a FINITE ADT domain is REFUTED (the union carries the ctor refutation)", () => {
    // ∀ m ∈ (Nothing | Just {_0 ∈ [0,∞)}). case m of Nothing→true; Just v→v≥1
    // — the Just-branch refutes by the ground witness v=0 ⇒ Just false.
    const maybeNat = union(ctor("Nothing", []), ctor("Just", [fld("_0", intervalGte0)]));
    const P = EMatch(EVar("x"), [
      { pattern: PatConstruct("Nothing", []), body: ELit(true) },
      { pattern: PatConstruct("Just", [PatVar("v")]), body: ECall("gte", [EVar("v"), ELit(1)]) },
    ]);
    expect(mb(isSubset(maybeNat, comp(P)))).toBe("false");
  });

  it("SOUNDNESS: a tampered mu-induction cert for the FALSE ∀-claim is REJECTED (the kernel re-derives)", () => {
    const claimFalse = forallClaim(listNativeSamples(), P_false);
    const bogus = decidableSetProof("mu-induction", { left: listNativeSamples(), right: comp(P_false) });
    const v = verify(claimFalse as never, bogus);
    expect(v.$tag).toBe("Err");
  });
});

// ---------------------------------------------------------------------------
// decide-substrate Phase 8μ.4 — the v2 NAMED-PREDICATE SEAM. A RECURSIVE
// predicate defined by structural recursion — `allHeadsGte0 xs` — proves
// SolverChecked through the trusted kernel, the IH discharged by the Park
// premise. The comprehension pred is the NAMED CALL `ECall f [EVar x]`;
// `cswNamedUnfold` resolves f's body via the `fnBody` seam native (a registry
// fn-body read + jsonLogicToExpr lift), and `cswIsIH` discharges the recursive
// conjunct against the tail field's comprehension domain. The fixtures are
// authored as real `.fenel` predicates (the "test fixtures are globally
// registered" precedent) and registered by BARE name — the harness module set
// is fixed + cached, and the kernel's Park re-check threads no evalCtx.
// ---------------------------------------------------------------------------
const regFixture = (name: string, src: string): void => {
  const mod = loadFenelModule(src, `ihfix-${name}`);
  const fn = (mod.functions ?? [])[0];
  if (fn === undefined) throw new Error(`fixture ${name} produced no function`);
  __registerFnBodyFixtureForTests(name, fn.body);
};

// allHeadsGte0 xs = case xs of Nil → true; Cons h t → and (h ≥ 0) (allHeadsGte0 t)
regFixture(
  "allHeadsGte0",
  `allHeadsGte0 xs = case xs of\n  Nil -> true\n  Cons h t -> and (gte h 0) (allHeadsGte0 t)`,
);
// allHeadsGte1 — the FALSE property (falsifiable at h = 0).
regFixture(
  "allHeadsGte1",
  `allHeadsGte1 xs = case xs of\n  Nil -> true\n  Cons h t -> and (gte h 1) (allHeadsGte1 t)`,
);
// recAlpha — the α case: the fn's formal param `ys` ≠ the comprehension binder `x`.
regFixture(
  "recAlpha",
  `recAlpha ys = case ys of\n  Nil -> true\n  Cons a b -> and (gte a 0) (recAlpha b)`,
);
// recMutual — mutual recursion: the recursive conjunct calls a DIFFERENT g.
regFixture(
  "recMutual",
  `recMutual xs = case xs of\n  Nil -> true\n  Cons h t -> and (gte h 0) (recOther t)`,
);
// recNested — a non-bare-var recursive arg: `recNested (tail t)`.
regFixture(
  "recNested",
  `recNested xs = case xs of\n  Nil -> true\n  Cons h t -> and (gte h 0) (recNested (tail t))`,
);
// recWrongDom — the recursive call is on the HEAD field (domain ≠ the comprehension).
regFixture(
  "recWrongDom",
  `recWrongDom xs = case xs of\n  Nil -> true\n  Cons h t -> and (gte h 0) (recWrongDom h)`,
);

// The recursive-P claim (named call) over ⟦List {0,1,2}⟧.
const namedRec = (f: string) => ECall(f, [EVar("x")]);

describe("8μ.4 Step B — the IH via the v2 named-predicate seam (recursive-P induction)", () => {
  it("HEADLINE: ∀ xs ∈ ⟦List {0,1,2}⟧. allHeadsGte0 xs — the named recursive predicate decides Just true (the FIRST recursive structural-induction proof)", () => {
    expect(mb(isSubset(listNativeSamples(), comp(namedRec("allHeadsGte0"))))).toBe("true");
  });

  it("HEADLINE (kernel): the recursive-P ∀-claim round-trips proposer → mu-induction cert → verifyMuInduction ⇒ SolverChecked (IH discharged by the Park premise)", () => {
    const claim = forallClaim(listNativeSamples(), namedRec("allHeadsGte0"));
    const out = decidableSetProposerNative(claim) as {
      $tag: string;
      _0: { kind?: string };
    };
    expect(out.$tag).toBe("Ok");
    expect(out._0.kind).toBe("mu-induction");
    const v = verify(claim as never, out._0 as never);
    expect(v.$tag).toBe("Ok");
    if (v.$tag === "Ok") expect(v._0.$tag).toBe("SolverChecked");
  });

  it("SOUNDNESS: a tampered mu-induction cert for a FALSE recursive property (allHeadsGte1) is REJECTED (the kernel re-derives the premise)", () => {
    const claimFalse = forallClaim(listNativeSamples(), namedRec("allHeadsGte1"));
    const bogus = decidableSetProof("mu-induction", {
      left: listNativeSamples(),
      right: comp(namedRec("allHeadsGte1")),
    });
    const v = verify(claimFalse as never, bogus);
    expect(v.$tag).toBe("Err");
  });

  it("a FALSE recursive property (allHeadsGte1 over native sample heads) is NEVER proven — refute-or-abstain (here abstains: the tail witness is unwitnessable v1), never a false proof", () => {
    expect(mb(isSubset(listNativeSamples(), comp(namedRec("allHeadsGte1"))))).toBe("nothing");
  });

  it("SIBLING (unregistered name): the fnBody seam MISSES ⇒ honest Nothing (never a false proof for an unknown predicate)", () => {
    expect(mb(isSubset(listNativeSamples(), comp(namedRec("allHeadsUnknown"))))).toBe(
      "nothing",
    );
  });

  it("α/binder: the fn's formal param (`ys`) ≠ the comprehension binder (`x`) ⇒ still Just true (the IH check is binder-name-insensitive)", () => {
    expect(mb(isSubset(listNativeSamples(), comp(namedRec("recAlpha"))))).toBe("true");
  });

  it("FENCE (mutual recursion): the recursive conjunct calls a DIFFERENT fn (g ≠ f) ⇒ Nothing (no multi-name unfolding in v2)", () => {
    expect(mb(isSubset(listNativeSamples(), comp(namedRec("recMutual"))))).toBe("nothing");
  });

  it("FENCE (non-bare-var recursive arg): `recNested (tail t)` ⇒ Nothing (the IH grants membership only for the bare tail var)", () => {
    expect(mb(isSubset(listNativeSamples(), comp(namedRec("recNested"))))).toBe("nothing");
  });

  it("FENCE (wrong-domain recursive conjunct): the recursive call is on the HEAD field (domain ≠ the comprehension) ⇒ Nothing", () => {
    expect(mb(isSubset(listNativeSamples(), comp(namedRec("recWrongDom"))))).toBe(
      "nothing",
    );
  });

  it("FENCE (arity ≠ 1 at the comprehension pred): `f x y` is not the single-bare-var v2 fragment ⇒ Nothing (the unfold fences)", () => {
    const arity2 = ECall("allHeadsGte0", [EVar("x"), EVar("y")]);
    expect(mb(isSubset(listNativeSamples(), comp(arity2)))).toBe("nothing");
  });

  it("the v1 inline finding STILL holds: an INLINE-match recursive conjunct stays Nothing (recName \"\" ⇒ the IH never fires; the finite-tree self-containment theorem)", () => {
    // The pred is the INLINE EMatch (not a named call), so cswNamedUnfold keeps
    // recName "" and the recursive conjunct `allHeadsGte0 t` cannot discharge —
    // exactly the 8μ.3 honest-Nothing finding, preserved.
    const P_rec = EMatch(EVar("x"), [
      { pattern: PatConstruct("Nil", []), body: ELit(true) },
      {
        pattern: PatConstruct("Cons", [PatVar("h"), PatVar("t")]),
        body: ECall("and", [
          ECall("gte", [EVar("h"), ELit(0)]),
          ECall("allHeadsGte0", [EVar("t")]),
        ]),
      },
    ]);
    expect(mb(isSubset(listNativeSamples(), comp(P_rec)))).toBe("nothing");
  });
});
