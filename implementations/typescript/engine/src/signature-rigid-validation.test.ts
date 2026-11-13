// ---------------------------------------------------------------------------
// signature-rigid-validation.test.ts — the Phase 4+4b validation rigid atom κ.
//
// SLICE 3a SCOPE: the rigid REPRESENTATION and its algebra, proven inert.
// Grounding, the reflection fence, and the checker wiring are slice-3b/3c
// additions to this file.
//
// THE THEOREM UNDER TEST IS EQUIVARIANCE (substitution), NOT NON-UNIFICATION.
// "κ does not unify" is not a soundness statement. The statement is: every
// `Just true` derived at a fresh rigid κ must remain valid when κ is replaced
// by EVERY well-kinded realizable ground type. Two rows the naive battery got
// backwards are pinned here because of that:
//   * κ ⟂ κ is `Nothing`, NOT `Just false` — at κ := ∅, ∅ ⟂ ∅ is TRUE.
//   * ⊤ ⊆ κ is `Nothing`, NOT `Just false` — at κ := ⊤ it HOLDS.
// The `GROUNDS` table below is that quantifier made executable: every row
// asserted `Just true` at a rigid is re-asserted after substituting each ground
// type in turn, and every row asserted `Nothing` is shown to have at least one
// ground instantiation on EACH side (so the abstention is forced, not lazy).
//
// METHOD NOTE (earned in slice 2b): every expected verdict here was read off
// the live decider BEFORE it was written down. A test written from a wrong
// model makes the wrong model permanent.
// ---------------------------------------------------------------------------

import { setDefaultTimeout, describe, it, expect } from "bun:test";

// THE DECIDER MATRICES IN THIS FILE ARE GENUINELY SLOW — each row runs a
// containment judgment through the kernel, and a matrix is dozens of rows. On a
// slower box several of them cross bun's 5s default and report as TIMEOUTS,
// which reads exactly like a semantic failure and is not one (verified against
// the entry HEAD in a detached worktree: the same six tests time out there,
// unchanged, so this is machine speed and not a regression). The timeout is a
// harness fact, so it is stated as one rather than left to look like a flake.
setDefaultTimeout(60000);
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join, dirname, sep } from "node:path";
import { fileURLToPath } from "node:url";
import {
  buildSetExpr,
  isSetExpr,
  peelSetExpr,
  setExprToDollarKey,
  setExprToTag,
  SET_EXPR_TAGS,
  VALIDATION_RIGID_TAG,
} from "./set-marker";
import {
  contains,
  decideEmpty,
  isDisjoint,
  isSubset,
  normalize,
  registerNamedSet,
  witnessOf,
} from "./set-algebra";
import {
  dispatchEngineBody,
  dispatchEngineBodyWithDeciderCtx,
  dispatchedSubset,
  dispatchedFormatSetExpr,
  dispatchedAutoLabel,
  print,
} from "./engine-bodies-dispatch";
import { canonicalDigest } from "./validation-canonical-bytes";
import type { FieldKey, SetExpr } from "./types";

const HERE = dirname(fileURLToPath(import.meta.url));
const REPO = join(HERE, "..", "..", "..", "..");
const read = (relative: string): string => readFileSync(join(REPO, relative), "utf8");

// ---------------------------------------------------------------------------
// fixtures
// ---------------------------------------------------------------------------

// The REAL `Kind` ADT (`types.ts`): `KType | KArrow {input, output}`. An
// earlier draft of this file spelled the arrow `{from, to}` — a wrong-model
// fixture that only passed because `SeRigid.kind` was unvalidated. The
// recognizer now enforces the closed ADT, so a malformed kind is not a rigid.
const KTYPE = { $tag: "KType" };
const KARROW = { $tag: "KArrow", input: { $tag: "KType" }, output: { $tag: "KType" } };

/** A rigid atom. `buildSetExpr.rigid` is the ONE host construction site. */
const K = (scopeToken: string, ordinal: number, kind: unknown = KTYPE): SetExpr =>
  buildSetExpr.rigid(scopeToken, ordinal, kind);

const ALL: SetExpr = { $tag: "SeAll" };
const NONE: SetExpr = { $tag: "SeNone" };
const ref = (handle: string): SetExpr => ({ $tag: "SeRef", handle });
const enumS = (...values: unknown[]): SetExpr => ({ $tag: "SeEnum", values });
const union = (...branches: SetExpr[]): SetExpr => ({ $tag: "SeUnion", branches });
const inter = (...branches: SetExpr[]): SetExpr => ({ $tag: "SeIntersect", branches });
const compl = (inner: SetExpr): SetExpr => ({ $tag: "SeComplement", inner });
const diff = (left: SetExpr, right: SetExpr): SetExpr => ({ $tag: "SeDiff", left, right });
const mu = (variable: string, body: SetExpr): SetExpr => ({ $tag: "SeMu", var: variable, body });

const fk = (i: number): FieldKey => ({
  $tag: "NamedField",
  ref: { $ref: `30000000-0000-4000-8000-${String(i + 1).padStart(12, "0")}` },
});
const arrowSet = (params: SetExpr[], returns: SetExpr): SetExpr => ({
  $tag: "SeArrow",
  params: params.map((set, i) => buildSetExpr.arrowParam(fk(i), `p${i}`, set)),
  returns,
});
const ctorSet = (ctor: string, fields: [string, SetExpr][]): SetExpr =>
  buildSetExpr.ctor(ctor, fields.map(([wireName, set], i) => buildSetExpr.ctorField(fk(i), wireName, set)));

/** Two live check scopes whose SOURCE binders share the spelling `a`. */
const KAPPA = K("scope-A", 0);
const KAPPA_SAME = K("scope-A", 0);
const KAPPA_ORD1 = K("scope-A", 1);
const KAPPA_OTHER_SCOPE = K("scope-B", 0);
const KAPPA_OTHER_KIND = K("scope-A", 0, KARROW);

type Tri = "true" | "false" | "nothing";
const tri = (m: unknown): Tri => {
  const v = m as { $tag?: string; _0?: boolean } | null;
  if (v && v.$tag === "Just") return v._0 ? "true" : "false";
  return "nothing";
};

/** The well-kinded realizable ground types the equivariance quantifier ranges
 * over. `NONE` (∅) and `ALL` (⊤) are the two that break the naive rules, and
 * they are the reason this list is not "a couple of representative types". */
const GROUNDS: [string, SetExpr][] = [
  ["∅ (SeNone)", NONE],
  ["⊤ (SeAll)", ALL],
  ["Int (SeRef)", ref("Int")],
  ["{1,2} (SeEnum)", enumS(1, 2)],
  ["Nil (SeCtor)", ctorSet("Nil", [])],
  ["μX.Nil|Cons (SeMu)", mu("X", union(ctorSet("Nil", []), ctorSet("Cons", [["tail", ref("X")]])))],
  ["(Int)→Int (SeArrow)", arrowSet([ref("Int")], ref("Int"))],
  ["Int ∪ {1} (SeUnion)", union(ref("Int"), enumS(1))],
  ["¬{1} (SeComplement)", compl(enumS(1))],
];

/** Substitute every rigid in `s` with the ground type `g` — the executable
 * form of "replace κ by a well-kinded realizable ground type". */
function ground(s: SetExpr, g: SetExpr): SetExpr {
  switch (s.$tag) {
    case "SeRigid": return g;
    case "SeCtor": return buildSetExpr.ctor(
      s.ctor,
      s.fields.map((f) => buildSetExpr.ctorField(f.key, f.wireName, ground(f.set, g))),
    );
    case "SeMu": return mu(s.var, ground(s.body, g));
    case "SeArrow": return {
      $tag: "SeArrow",
      params: s.params.map((p) => buildSetExpr.arrowParam(p.key, p.wireName, ground(p.set, g))),
      returns: ground(s.returns, g),
    };
    case "SeUnion": return union(...s.branches.map((b) => ground(b, g)));
    case "SeIntersect": return inter(...s.branches.map((b) => ground(b, g)));
    case "SeDiff": return diff(ground(s.left, g), ground(s.right, g));
    case "SeComplement": return compl(ground(s.inner, g));
    default: return s;
  }
}

// ---------------------------------------------------------------------------
// 3a-D2 — the exhaustive decider matrix, row by row
// ---------------------------------------------------------------------------

describe("the rigid decider matrix — the three Just-true rows", () => {
  it("κ ⊆ κ (same scopeToken + ordinal + kind) ⇒ Just true", () => {
    expect(tri(isSubset(KAPPA, KAPPA_SAME))).toBe("true");
  });

  it("∅ ⊆ κ ⇒ Just true", () => {
    expect(tri(isSubset(NONE, KAPPA))).toBe("true");
  });

  it("κ ⊆ ⊤ ⇒ Just true", () => {
    expect(tri(isSubset(KAPPA, ALL))).toBe("true");
  });

  it("all three survive substituting each of the nine ground types (equivariance)", () => {
    // NOT a quantified proof — nine witnesses, chosen to cover every SetExpr
    // former plus the two that break the naive rules (∅ and ⊤). The universally
    // quantified statement is the LEDGER's claim; this is its executable
    // sampling, and the two bold corrections below are the cases where a wrong
    // rule would have been caught by ∅/⊤ alone.
    for (const [label, g] of GROUNDS) {
      expect(tri(isSubset(ground(KAPPA, g), ground(KAPPA_SAME, g))), `κ ⊆ κ at κ := ${label}`).toBe("true");
      expect(tri(isSubset(NONE, ground(KAPPA, g))), `∅ ⊆ κ at κ := ${label}`).toBe("true");
      expect(tri(isSubset(ground(KAPPA, g), ALL)), `κ ⊆ ⊤ at κ := ${label}`).toBe("true");
    }
  });
});

describe("the rigid decider matrix — the two EQUIVARIANCE CORRECTIONS", () => {
  it("⊤ ⊆ κ ⇒ Nothing (the leaf default's Just false FAILS at κ := ⊤)", () => {
    expect(tri(isSubset(ALL, KAPPA))).toBe("nothing");
    // The abstention is FORCED, not lazy: the two ground instantiations below
    // disagree, so no constant verdict is sound.
    expect(tri(isSubset(ALL, ground(KAPPA, ALL)))).toBe("true");
    expect(tri(isSubset(ALL, ground(KAPPA, enumS(1, 2))))).toBe("false");
  });

  it("κ ⟂ κ (SELF-disjointness) ⇒ Nothing (the same-handle Just false FAILS at κ := ∅)", () => {
    expect(tri(isDisjoint(KAPPA, KAPPA_SAME))).toBe("nothing");
    // Forced: ∅ ⟂ ∅ is TRUE, {1,2} ⟂ {1,2} is FALSE.
    expect(tri(isDisjoint(ground(KAPPA, NONE), ground(KAPPA_SAME, NONE)))).toBe("true");
    expect(tri(isDisjoint(ground(KAPPA, enumS(1, 2)), ground(KAPPA_SAME, enumS(1, 2))))).toBe("false");
  });

  it("the SeRef same-handle rule this corrects still answers Just false for a NAMED leaf", () => {
    // The rule the rigid arm must NOT inherit, pinned so the correction reads
    // as deliberate rather than as a regression of the named-leaf theory.
    expect(tri(isDisjoint(ref("Int"), ref("Int")))).toBe("false");
  });
});

describe("the rigid decider matrix — the abstention rows", () => {
  it("κ₁ ⟂ κ₂ (distinct rigids) ⇒ Nothing (they may instantiate equal)", () => {
    expect(tri(isDisjoint(KAPPA, KAPPA_ORD1))).toBe("nothing");
    expect(tri(isDisjoint(KAPPA, KAPPA_OTHER_SCOPE))).toBe("nothing");
  });

  it("κ ⊆ <any concrete> ⇒ Nothing", () => {
    for (const [label, g] of GROUNDS) {
      if (g === ALL) continue; // κ ⊆ ⊤ is a Just-true row
      expect(tri(isSubset(KAPPA, g)), `κ ⊆ ${label}`).toBe("nothing");
    }
  });

  it("<any concrete> ⊆ κ ⇒ Nothing", () => {
    for (const [label, g] of GROUNDS) {
      if (g === NONE) continue; // ∅ ⊆ κ is a Just-true row
      expect(tri(isSubset(g, KAPPA)), `${label} ⊆ κ`).toBe("nothing");
    }
  });

  it("{w} ⊆ κ (membership of a concrete value) ⇒ Nothing", () => {
    for (const w of [0, 1, -1, "", "x", true, false, [], {}]) {
      expect(tri(contains(KAPPA, w, null)), `contains κ ${JSON.stringify(w)}`).toBe("nothing");
    }
    expect(tri(isSubset(enumS(1), KAPPA))).toBe("nothing");
  });

  it("empty(κ) ⇒ Nothing and nonempty(κ) ⇒ Nothing — κ is never decidably either", () => {
    expect(tri(decideEmpty(KAPPA))).toBe("nothing");
    // Forced: empty at κ := ∅, nonempty at κ := ⊤.
    expect(tri(decideEmpty(ground(KAPPA, NONE)))).toBe("true");
    expect(tri(decideEmpty(ground(KAPPA, ALL)))).toBe("false");
  });

  it("enumerate / witness / sample at κ ⇒ no extension, no witness", () => {
    expect(witnessOf(KAPPA)).toEqual({ $tag: "Nothing" });
    expect(tri(dispatchEngineBody("engine:enumerateSet", [KAPPA]))).toBe("nothing");
    // The load-bearing split: NOT `Just []`. A complete empty extension would
    // mean "decidably empty", i.e. the vacuity trap by another route.
    expect(dispatchEngineBody("engine:enumerateSet", [KAPPA])).toEqual({ $tag: "Nothing" });
  });

  it("κ is never a registered named member nor a particular constructor", () => {
    expect(tri(isSubset(KAPPA, ref("Int")))).toBe("nothing");
    expect(tri(isSubset(KAPPA, ctorSet("Nil", [])))).toBe("nothing");
    expect(tri(isDisjoint(KAPPA, ctorSet("Nil", [])))).toBe("nothing");
  });

  it("normalize passes a rigid through UNCHANGED (no collapse to ∅/⊤/a handle)", () => {
    expect(normalize(KAPPA)).toEqual(KAPPA);
    expect(normalize(union(KAPPA, NONE))).toEqual(KAPPA);
    // ...and does not erase it from a compound it survives inside.
    expect(JSON.stringify(normalize(inter(KAPPA, ref("Int"))))).toContain("SeRigid");
  });
});

describe("κ-INDEPENDENT facts still decide (the abstentions are precise, not blanket)", () => {
  it("κ ⟂ ∅ ⇒ Just true (holds at every κ)", () => {
    expect(tri(isDisjoint(KAPPA, NONE))).toBe("true");
  });

  it("κ ⟂ ¬κ ⇒ Just true (κ ∩ ¬κ = ∅ at every κ)", () => {
    expect(tri(isDisjoint(KAPPA, compl(KAPPA_SAME)))).toBe("true");
    for (const [label, g] of GROUNDS) {
      expect(
        tri(isDisjoint(ground(KAPPA, g), compl(ground(KAPPA_SAME, g)))),
        `κ ⟂ ¬κ at κ := ${label}`,
      ).toBe("true");
    }
  });

  it("empty(κ ∩ ¬κ) ⇒ Just true and empty(κ ∖ κ) ⇒ Just true", () => {
    expect(tri(decideEmpty(inter(KAPPA, compl(KAPPA_SAME))))).toBe("true");
    expect(tri(decideEmpty(diff(KAPPA, KAPPA_SAME)))).toBe("true");
  });

  it("κ ⟂ ⊤ ⇒ Nothing (Just true fails at κ := ⊤; Just false fails at κ := ∅)", () => {
    expect(tri(isDisjoint(KAPPA, ALL))).toBe("nothing");
  });

  it("a ctor CARRYING a rigid field: the tag-distinctness rules stay sound", () => {
    const boxK = ctorSet("Box", [["v", KAPPA]]);
    const boxKSame = ctorSet("Box", [["v", KAPPA_SAME]]);
    const boxInt = ctorSet("Box", [["v", ref("Int")]]);
    const nil = ctorSet("Nil", []);
    // Distinct constructor TAGS are disjoint at every instantiation — the field
    // contents are irrelevant, so this decides and is κ-independent.
    expect(tri(isDisjoint(boxK, nil))).toBe("true");
    // Fieldwise subset rides the rigid arm: same field ⇒ proves, different ⇒ abstains.
    expect(tri(isSubset(boxK, boxKSame))).toBe("true");
    expect(tri(isSubset(boxK, boxInt))).toBe("nothing");
    expect(tri(isDisjoint(boxK, boxKSame))).toBe("nothing");
  });

  it("the ctor tag-distinctness REFUTATION is correctly gated off by a rigid field", () => {
    // `Box{κ} ⊆ Nil{}` must NOT refute: at κ := ∅ the ctor set `Box{∅}` is EMPTY,
    // and ∅ ⊆ anything HOLDS. The distinct-ctor `Just false` is gated on `a`
    // being provably NONEMPTY, and `empty(Box{κ})` is `Nothing` because
    // `empty(κ)` is — so the gate closes exactly where equivariance needs it to.
    // This is a pre-existing gate doing rigid-soundness work for free; pinned so
    // a future precision pass cannot remove it without failing here.
    expect(tri(isSubset(ctorSet("Box", [["v", KAPPA]]), ctorSet("Nil", [])))).toBe("nothing");
    expect(tri(decideEmpty(ctorSet("Box", [["v", KAPPA]])))).toBe("nothing");
    // CONTROL — with a provably-nonempty field the refutation DOES fire.
    expect(tri(isSubset(ctorSet("Box", [["v", enumS(1)]]), ctorSet("Nil", [])))).toBe("false");
    // ...and the ground instantiation that forces the abstention above:
    expect(tri(isSubset(ctorSet("Box", [["v", NONE]]), ctorSet("Nil", [])))).toBe("true");
  });
});

// ---------------------------------------------------------------------------
// rigid IDENTITY — scope-uniqueness and alpha-stability at the ATOM level
// ---------------------------------------------------------------------------

describe("rigid identity", () => {
  it("same scopeToken + ordinal + kind is ONE atom", () => {
    expect(tri(isSubset(KAPPA, KAPPA_SAME))).toBe("true");
  });

  it("a different ORDINAL is a different atom (two binders of ONE scheme)", () => {
    expect(tri(isSubset(KAPPA, KAPPA_ORD1))).toBe("nothing");
    expect(tri(isSubset(KAPPA_ORD1, KAPPA))).toBe("nothing");
  });

  it("a different scopeToken is a different atom — two live scopes sharing a source spelling stay non-unifiable", () => {
    // Both scopes' binder is spelled `a` in the source; only the mint nonce
    // separates them, and it must.
    expect(tri(isSubset(KAPPA, KAPPA_OTHER_SCOPE))).toBe("nothing");
    expect(tri(isSubset(KAPPA_OTHER_SCOPE, KAPPA))).toBe("nothing");
    expect(tri(isDisjoint(KAPPA, KAPPA_OTHER_SCOPE))).toBe("nothing");
  });

  it("a same-token same-ordinal DIFFERENT-KIND pair is not the same atom (over-fencing, deliberate)", () => {
    expect(tri(isSubset(KAPPA, KAPPA_OTHER_KIND))).toBe("nothing");
  });

  it("a fully applied KArrow rigid behaves exactly like a KType rigid on the matrix", () => {
    const ka = K("scope-K", 0, KARROW);
    const kaSame = K("scope-K", 0, KARROW);
    expect(tri(isSubset(ka, kaSame))).toBe("true");
    expect(tri(isSubset(ALL, ka))).toBe("nothing");
    expect(tri(isDisjoint(ka, kaSame))).toBe("nothing");
    expect(tri(decideEmpty(ka))).toBe("nothing");
    expect(tri(contains(ka, 1, null))).toBe("nothing");
  });
});

// ---------------------------------------------------------------------------
// THE VACUITY TRAP — the concrete soundness failure S0 was opened to prevent
// ---------------------------------------------------------------------------

describe("the vacuity trap — `∀a. a -> R` must NOT validate through κ-emptiness", () => {
  const ELambda = (params: string[], body: unknown): unknown => ({ $tag: "ELambda", params, body });
  const EVar = (name: string): unknown => ({ $tag: "EVar", name });
  const ELit = (value: unknown): unknown => ({ $tag: "ELit", value });
  const chk = (e: unknown, goal: SetExpr): Tri =>
    tri(dispatchEngineBodyWithDeciderCtx("engine:checkExpr", [e, [], goal]));

  it("CONTROL — the vacuous shortcut EXISTS: a decidably-EMPTY param domain accepts any body", () => {
    // This is the mechanism the trap exploits, pinned live so the fence below
    // is demonstrably fencing something real rather than a hypothesis.
    expect(chk(ELambda(["x"], ELit(9)), arrowSet([NONE], enumS(5)))).toBe("true");
  });

  it("CONTROL — a genuinely wrong body against a concrete domain still REFUTES", () => {
    expect(chk(ELambda(["x"], ELit(9)), arrowSet([enumS(1)], enumS(5)))).toBe("false");
  });

  it("TRAP FENCED — the same wrong body against a RIGID domain does not validate", () => {
    expect(chk(ELambda(["x"], ELit(9)), arrowSet([KAPPA], enumS(5)))).toBe("nothing");
  });

  it("the payoff still works — `∀a. a -> a` with the identity body VALIDATES", () => {
    expect(chk(ELambda(["x"], EVar("x")), arrowSet([KAPPA], KAPPA_SAME))).toBe("true");
  });

  it("and `∀a. a -> Int` with the identity body does NOT (abstains, never falsely refutes)", () => {
    // At κ := Int this body IS well-typed, so `Just false` would be unsound.
    expect(chk(ELambda(["x"], EVar("x")), arrowSet([KAPPA], ref("Int")))).toBe("nothing");
  });

  it("arrowSomeParamEmpty does not fire on a rigid param (the subset-side twin of the trap)", () => {
    // `setAlgebraSubsetArrowArm` answers an unconditional Just true when SOME
    // param domain of `b` is decidably empty. That must not trigger at a rigid.
    expect(tri(isSubset(arrowSet([ref("Int")], ref("Int")), arrowSet([NONE], ref("Int"))))).toBe("true");
    expect(tri(isSubset(arrowSet([ref("Int")], ref("Int")), arrowSet([KAPPA], ref("Int"))))).toBe("nothing");
  });

  it("empty(SeArrow) with a rigid param stays κ-independent, and no vacuous witness is minted", () => {
    // `empty(P→R) ⟺ empty(R) ∧ every param inhabited` (`setAlgebraArrowEmpty` =
    // `mAnd (decideEmpty R) (arrowParamsInhab ps)`). At a rigid PARAM:
    // `arrowParamsInhab` is `Nothing`, but `decideEmpty Int` is `Just false`, and
    // Kleene AND short-circuits on false ⇒ `Just false` (NOT empty). Sound at
    // every κ: Int is inhabited, so constant functions inhabit the arrow.
    expect(tri(decideEmpty(arrowSet([KAPPA], ref("Int"))))).toBe("false");
    // signature-substrate slice 3jw — this row WAS `Nothing`, and the change is
    // a sound Nothing→Just widening rather than a regression. The `Nothing` was
    // never a statement about rigids: `seWitnessArrow` builds a CONSTANT
    // function from a witness of the RETURN set, and `inhabit (SeRef "Int")`
    // had no witness before this slice de-fenced SeRef. Now it does, so the
    // constant function exists — which is exactly what this test's own comment
    // above already argued ("Int is inhabited, so constant functions inhabit
    // the arrow"). The assertion is strengthened rather than deleted: the
    // witness must be a constant function that IGNORES its argument (hence
    // κ-INDEPENDENT — the property the test is actually about), and it must
    // re-check as a member of the arrow set.
    const w = witnessOf(arrowSet([KAPPA], ref("Int"))) as { $tag: string; _0?: Record<string, unknown> };
    expect(w.$tag).toBe("Just");
    expect(w._0?.__fenelFn).toBe(true);
    expect((w._0?.params as string[]).length).toBe(1);
    // The body is the return-set witness `0` — it does not mention the param,
    // so no κ-dependent value was minted.
    expect(w._0?.body).toBe(0);
    expect(contains(arrowSet([KAPPA], ref("Int")), w._0, null)).toEqual({ $tag: "Just", _0: true });
  });

  it("empty(SeArrow) with a rigid RETURN abstains — the direction that MUST NOT decide", () => {
    // The mirror case, and the one where a wrong answer would be unsound:
    // `⟦(Int)→κ⟧` is EMPTY at κ := ∅ (no total function from an inhabited domain
    // into ∅) and NONEMPTY at κ := ⊤. So neither polarity is available. The
    // `mAnd Nothing (Just true)` composition gives exactly that.
    expect(tri(decideEmpty(arrowSet([ref("Int")], KAPPA)))).toBe("nothing");
    expect(witnessOf(arrowSet([ref("Int")], KAPPA))).toEqual({ $tag: "Nothing" });
    // ...and the two ground instantiations that force the abstention disagree.
    expect(tri(decideEmpty(arrowSet([ref("Int")], NONE)))).toBe("true");
    expect(tri(decideEmpty(arrowSet([ref("Int")], ALL)))).toBe("false");
  });
});

// ---------------------------------------------------------------------------
// THE μ-COLLAPSE NEGATIVE — a rigid is never encoded as SeMu
// ---------------------------------------------------------------------------

describe("the μ-collapse negative", () => {
  it("μκ.κ collapses to ⊥ — so encoding a rigid as SeMu would be the vacuity trap", () => {
    // The recorded fact, re-verified live: this is WHY SeRigid is its own
    // constructor rather than a self-referential μ binder.
    expect(tri(decideEmpty(mu("k", ref("k"))))).toBe("true");
  });

  it("a real rigid is NOT decidably empty — the two are genuinely different sets", () => {
    expect(tri(decideEmpty(KAPPA))).toBe("nothing");
    expect(tri(decideEmpty(mu("k", ref("k"))))).toBe("true");
    // `μk.k ⊆ κ` proves — but via PARK with T := κ (`substSet k κ (SeRef k)` = κ,
    // then `κ ⊆ κ`), not via a bottom-μ shortcut; `isBottomMu` lives on the Tt
    // face, which rigids never reach. Sound either way: μk.k IS ∅, and ∅ ⊆ κ.
    expect(tri(isSubset(mu("k", ref("k")), KAPPA))).toBe("true");
    expect(tri(isSubset(KAPPA, mu("k", ref("k"))))).toBe("nothing"); // κ ⊆ ∅ undecided
  });

  it("the projection rewrite never produces a SeMu for a binder", () => {
    const projected = project("scope-P", [binder("a", 0, KTYPE)], ref("a"));
    expect(projected).not.toBeNull();
    expect((projected as SetExpr).$tag).toBe("SeRigid");
  });

  it("a rigid under a μ body does not unguard or de-monotone the fixpoint", () => {
    // `List κ` — the μ var occurs positively, the rigid contributes nothing to
    // the occurrence analysis, and Nil keeps the type inhabited at every κ.
    const listOfK = mu("X", union(ctorSet("Nil", []), ctorSet("Cons", [["head", KAPPA], ["tail", ref("X")]])));
    expect(tri(decideEmpty(listOfK))).toBe("false");
    for (const [label, g] of GROUNDS) {
      expect(tri(decideEmpty(ground(listOfK, g))), `empty(List κ) at κ := ${label}`).toBe("false");
    }
  });

  it("a μ binder that SHADOWS a quantified spelling is not rigidified", () => {
    // `∀a. μa. Nil | Cons {tail: a}` — the inner `a` is the recursion variable.
    const body = mu("a", union(ctorSet("Nil", []), ctorSet("Cons", [["tail", ref("a")]])));
    const projected = project("scope-S", [binder("a", 0, KTYPE)], body) as SetExpr;
    expect(projected).not.toBeNull();
    expect(JSON.stringify(projected)).not.toContain("SeRigid");
    expect(projected).toEqual(body);
  });
});

// ---------------------------------------------------------------------------
// THE HOSTILE NAMED-SET CAPTURE PROBE — the channel that killed bound-SeRef
// ---------------------------------------------------------------------------

describe("the hostile named-set capture probe", () => {
  it("registerNamedSet under rigid-looking handles cannot change ANY rigid verdict", () => {
    const before = {
      selfSubset: tri(isSubset(KAPPA, KAPPA_SAME)),
      topSubset: tri(isSubset(ALL, KAPPA)),
      selfDisjoint: tri(isDisjoint(KAPPA, KAPPA_SAME)),
      empty: tri(decideEmpty(KAPPA)),
      member: tri(contains(KAPPA, 42, null)),
      witness: witnessOf(KAPPA),
    };

    // Every spelling an attacker could guess at, plus the exact field values.
    for (const handle of [
      "SeRigid",
      "scope-A",
      "@rigid/scope-A/0",
      "@rigid",
      "rigid",
      "κ",
      "a",
      "0",
      JSON.stringify(KAPPA),
    ]) {
      registerNamedSet(handle, () => true);
    }

    expect(tri(isSubset(KAPPA, KAPPA_SAME))).toBe(before.selfSubset);
    expect(tri(isSubset(ALL, KAPPA))).toBe(before.topSubset);
    expect(tri(isDisjoint(KAPPA, KAPPA_SAME))).toBe(before.selfDisjoint);
    expect(tri(decideEmpty(KAPPA))).toBe(before.empty);
    expect(tri(contains(KAPPA, 42, null))).toBe(before.member);
    expect(witnessOf(KAPPA)).toEqual(before.witness);

    // The withdrawn design's exact counterexample: an always-true membership
    // predicate under a rigid-looking handle must NOT flip `42 ∈ κ`.
    expect(tri(contains(KAPPA, 42, null))).toBe("nothing");
    expect(tri(isSubset(enumS(42), KAPPA))).toBe("nothing");
  });

  it("...whereas the SAME registration DOES capture a bound SeRef (why the candidate was withdrawn)", () => {
    // The live counterexample, kept executable so nobody re-proposes the
    // reserved-namespace design believing it was merely untested.
    registerNamedSet("@rigid/withdrawn/0", () => true);
    expect(tri(contains(ref("@rigid/withdrawn/0"), 42, null))).toBe("true");
    expect(tri(isSubset(enumS(42), ref("@rigid/withdrawn/0")))).toBe("true");
  });
});

// ---------------------------------------------------------------------------
// 3a-D2 — the PROJECTION rewrite (bound placeholders → SeRigid)
// ---------------------------------------------------------------------------

const binder = (name: string, ordinal: number, kind: unknown): unknown =>
  ({ $tag: "VrgBinder", name, ordinal, kind });

const project = (scopeToken: string, binders: unknown[], s: SetExpr): SetExpr | null => {
  const out = dispatchEngineBody("engine:vrgProject", [scopeToken, binders, s]) as
    { $tag: string; _0?: SetExpr };
  return out.$tag === "Just" ? (out._0 as SetExpr) : null;
};
const hasRigid = (s: unknown): boolean =>
  dispatchEngineBody("engine:vrgHasRigid", [s]) === true;

describe("the projection rewrite — bound placeholders to SeRigid", () => {
  const bs = [binder("a", 0, KTYPE), binder("b", 1, KTYPE)];

  it("rewrites a bare bound occurrence", () => {
    expect(project("s", bs, ref("a"))).toEqual(K("s", 0));
    expect(project("s", bs, ref("b"))).toEqual(K("s", 1));
  });

  it("leaves a NON-binder handle alone", () => {
    expect(project("s", bs, ref("Int"))).toEqual(ref("Int"));
  });

  it("descends every SetExpr child position", () => {
    const before = arrowSet(
      [ref("a"), ctorSet("Box", [["v", ref("b")]])],
      union(ref("a"), inter(compl(ref("b")), diff(ref("a"), ref("Int")))),
    );
    const after = project("s", bs, before) as SetExpr;
    expect(after).not.toBeNull();
    // No binder spelling survives...
    expect(JSON.stringify(after)).not.toContain('"handle":"a"');
    expect(JSON.stringify(after)).not.toContain('"handle":"b"');
    // ...the non-binder handle does...
    expect(JSON.stringify(after)).toContain('"handle":"Int"');
    // ...and both rigids are present with their ordinals.
    expect(JSON.stringify(after)).toContain('"ordinal":0');
    expect(JSON.stringify(after)).toContain('"ordinal":1');
    expect(hasRigid(after)).toBe(true);
  });

  it("FENCES a binder occurrence under a SetPattern rather than rebuilding the host form", () => {
    // The runtime carrier under `SePattern.pattern` is the legacy
    // `.t`-discriminated host Pattern, not the registered Sp* ADT. Faithfully
    // rebuilding it in Fenel would have to preserve min/max and the
    // omitted-vs-Nothing distinction on an optional `type`; a subtly wrong
    // rebuild silently corrupts a pattern. So the rewrite declines and the
    // totality post-condition turns that into a REFUSAL — never a
    // partially-rigidified term reaching a decider.
    const before: SetExpr = { $tag: "SePattern", pattern: { t: "match", pred: ref("a") } } as SetExpr;
    expect(project("s", bs, before)).toBeNull();
    // ...including when the binder is buried under seq/alt/rep/group.
    for (const pattern of [
      { t: "seq", a: { t: "match", pred: ref("a") }, b: { t: "eps" } },
      { t: "alt", a: { t: "eps" }, b: { t: "match", pred: ref("b") } },
      { t: "rep", child: { t: "match", pred: ref("a") }, min: 0, max: 3 },
      { t: "group", name: "g", child: { t: "eps" }, type: ref("a") },
    ]) {
      expect(project("s", bs, { $tag: "SePattern", pattern } as SetExpr), JSON.stringify(pattern)).toBeNull();
    }
    // A pattern with NO binder occurrence projects fine, untouched.
    const clean: SetExpr = { $tag: "SePattern", pattern: { t: "match", pred: ref("Int") } } as SetExpr;
    expect(project("s", bs, clean)).toEqual(clean);
  });

  it("the residual post-condition sees the LEGACY host pattern carrier, not just the Sp* ADT", () => {
    // A cascade that only matched `SpMatch {…}` would report "no residual" for
    // every real pattern and let the projection through. This is that pin.
    const legacyCarried: SetExpr = { $tag: "SePattern", pattern: { t: "match", pred: ref("a") } } as SetExpr;
    expect(project("s", bs, legacyCarried)).toBeNull();
    // and a rigid already nested under the legacy carrier is FOUND by the deep
    // non-escape predicate (the same dual-read).
    expect(hasRigid({ $tag: "SePattern", pattern: { t: "match", pred: KAPPA } })).toBe(true);
    expect(hasRigid({ $tag: "SePattern", pattern: { t: "seq", a: { t: "eps" }, b: { t: "match", pred: KAPPA } } })).toBe(true);
    expect(hasRigid({ $tag: "SePattern", pattern: { t: "rep", child: { t: "match", pred: KAPPA }, min: 0, max: 1 } })).toBe(true);
    expect(hasRigid({ $tag: "SePattern", pattern: { t: "group", name: "g", child: { t: "eps" }, type: KAPPA } })).toBe(true);
    expect(hasRigid({ $tag: "SePattern", pattern: { t: "match", pred: ref("Int") } })).toBe(false);
  });

  it("honors μ shadowing — an inner binder of the same spelling stops the rewrite", () => {
    const shadowed = mu("a", union(ctorSet("Nil", []), ctorSet("Cons", [["tail", ref("a")]])));
    expect(project("s", bs, shadowed)).toEqual(shadowed);
    // ...while a FREE `a` OUTSIDE that μ is still rewritten in the same term.
    const mixed = union(ref("a"), shadowed);
    const after = project("s", bs, mixed) as SetExpr;
    expect((after as { branches: SetExpr[] }).branches[0]).toEqual(K("s", 0));
    expect((after as { branches: SetExpr[] }).branches[1]).toEqual(shadowed);
  });

  it("is PURE — repeated projection of the same input is identical, and the input is not mutated", () => {
    const input = arrowSet([ref("a")], ref("b"));
    const snapshot = JSON.stringify(input);
    const first = project("s", bs, input);
    const second = project("s", bs, input);
    expect(first).toEqual(second);
    expect(JSON.stringify(input)).toBe(snapshot);
  });

  it("carries the binder's KIND onto the atom", () => {
    const kinded = [binder("f", 0, KARROW)];
    expect(project("s", kinded, ref("f"))).toEqual(K("s", 0, KARROW));
  });

  it("two scopes projecting the SAME source spelling produce NON-UNIFIABLE atoms", () => {
    const one = project("scope-1", bs, ref("a")) as SetExpr;
    const two = project("scope-2", bs, ref("a")) as SetExpr;
    expect(tri(isSubset(one, two))).toBe("nothing");
    expect(tri(isSubset(one, project("scope-1", bs, ref("a")) as SetExpr))).toBe("true");
  });

  it("the deep non-escape predicate finds a rigid in every child position", () => {
    expect(hasRigid(KAPPA)).toBe(true);
    expect(hasRigid(union(ref("Int"), KAPPA))).toBe(true);
    expect(hasRigid(inter(ref("Int"), KAPPA))).toBe(true);
    expect(hasRigid(compl(KAPPA))).toBe(true);
    expect(hasRigid(diff(ref("Int"), KAPPA))).toBe(true);
    expect(hasRigid(mu("X", KAPPA))).toBe(true);
    expect(hasRigid(ctorSet("Box", [["v", KAPPA]]))).toBe(true);
    expect(hasRigid(arrowSet([KAPPA], ref("Int")))).toBe(true);
    expect(hasRigid(arrowSet([ref("Int")], KAPPA))).toBe(true);
    // ...and does not false-positive on a rigid-free term.
    expect(hasRigid(union(ref("Int"), mu("X", ctorSet("Cons", [["tail", ref("X")]]))))).toBe(false);
    expect(hasRigid(ALL)).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// 3a-D4 — the canonical rigid digest
// ---------------------------------------------------------------------------

const RIGID_DOMAIN = "fenel.validation.rigid.v1";
const payload = (
  validatorVersion: string,
  sccId: string,
  functionId: string,
  schemeHash: string,
  binders: unknown[],
): unknown => dispatchEngineBody(
  "engine:vrgDigestPayload",
  [validatorVersion, sccId, functionId, schemeHash, binders],
);
const digest = (...args: Parameters<typeof payload>): string =>
  canonicalDigest(RIGID_DOMAIN, payload(...args));

describe("fenel.validation.rigid.v1 — the only projection that leaves the frame", () => {
  const BS = [binder("a", 0, KTYPE), binder("b", 1, KARROW)];
  const SCOPE = ["v1", "scc-1", "fn-1", "scheme-hash-1"] as const;

  it("the payload carries the domain, the alpha-normal ordinals, and the semantic scope", () => {
    expect(payload(...SCOPE, BS)).toEqual({
      domain: RIGID_DOMAIN,
      rigids: [{ ordinal: 0, kind: KTYPE }, { ordinal: 1, kind: KARROW }],
      scope: { validatorVersion: "v1", sccId: "scc-1", functionId: "fn-1", schemeHash: "scheme-hash-1" },
    });
  });

  it("NEITHER the runtime nonce NOR the source spelling reaches canonical bytes", () => {
    const serialized = JSON.stringify(payload(...SCOPE, BS));
    expect(serialized).not.toContain("scopeToken");
    expect(serialized).not.toContain("scope-A");
    // The source binder spellings are `a` and `b`; neither may appear as a value.
    expect(serialized).not.toContain('"a"');
    expect(serialized).not.toContain('"b"');
    expect(serialized).not.toContain('"name"');
  });

  it("ALPHA-STABLE — identical semantic input ⇒ identical digest, regardless of source spelling", () => {
    const spelledAb = [binder("a", 0, KTYPE), binder("b", 1, KARROW)];
    const spelledXy = [binder("x", 0, KTYPE), binder("y", 1, KARROW)];
    expect(digest(...SCOPE, spelledXy)).toBe(digest(...SCOPE, spelledAb));
    // ...and repeat validation of identical semantic input is stable.
    expect(digest(...SCOPE, spelledAb)).toBe(digest(...SCOPE, spelledAb));
  });

  it("the digest SEPARATES on every semantic axis", () => {
    const base = digest(...SCOPE, BS);
    expect(digest("v2", "scc-1", "fn-1", "scheme-hash-1", BS)).not.toBe(base);
    expect(digest("v1", "scc-2", "fn-1", "scheme-hash-1", BS)).not.toBe(base);
    expect(digest("v1", "scc-1", "fn-2", "scheme-hash-1", BS)).not.toBe(base);
    expect(digest("v1", "scc-1", "fn-1", "scheme-hash-2", BS)).not.toBe(base);
    // kind matters
    expect(digest(...SCOPE, [binder("a", 0, KARROW), binder("b", 1, KARROW)])).not.toBe(base);
    // arity matters
    expect(digest(...SCOPE, [binder("a", 0, KTYPE)])).not.toBe(base);
  });

  it("a MIS-ORDERED binder list produces a different digest (detectable, not a silent collision)", () => {
    const ordered = digest(...SCOPE, BS);
    const swapped = digest(...SCOPE, [binder("b", 1, KARROW), binder("a", 0, KTYPE)]);
    expect(swapped).not.toBe(ordered);
  });

  it("the digest is domain-tagged — the same payload under another domain differs", () => {
    const p = payload(...SCOPE, BS);
    expect(canonicalDigest("fenel.validation.scheme.v1", p)).not.toBe(canonicalDigest(RIGID_DOMAIN, p));
  });

  it("the digest is a hex SHA-256 and contains no token material", () => {
    const d = digest(...SCOPE, BS);
    expect(d).toMatch(/^[0-9a-f]{64}$/);
    expect(d).not.toContain("scope-A");
  });
});

// ---------------------------------------------------------------------------
// NON-ESCAPE
// ---------------------------------------------------------------------------

describe("non-escape — the `$`-key egress marshal rejects a rigid", () => {
  it("rejects a bare rigid", () => {
    expect(() => setExprToDollarKey(KAPPA)).toThrow(/fenel\.validation\.rigid/);
  });

  it("rejects a rigid nested at any SetExpr CHILD depth (the recursive arms route back through the guard)", () => {
    // Scope stated precisely: "child" means a declared `SetExpr`-typed slot.
    // The codec copies the three OPAQUE payloads — `SeEnum.values`,
    // `SeInterval.interval`, `SeWhere.pred` — verbatim, because their contents
    // are arbitrary VALUES, not set expressions. A rigid-SHAPED object sitting
    // in `SeEnum.values` is an ordinary record, not a rigid; the reason that is
    // not a leak is the provenance boundary (a rigid never leaves a validation
    // frame to become someone's enum member in the first place), not this
    // codec. Recorded in the audit note's flagged list.
    for (const wrapped of [
      union(ref("Int"), KAPPA),
      inter(ref("Int"), KAPPA),
      compl(KAPPA),
      diff(ref("Int"), KAPPA),
      mu("X", KAPPA),
      ctorSet("Box", [["v", KAPPA]]),
      arrowSet([KAPPA], ref("Int")),
      arrowSet([ref("Int")], KAPPA),
      { $tag: "SePattern", pattern: { t: "match", pred: KAPPA } } as SetExpr,
    ]) {
      expect(() => setExprToDollarKey(wrapped), JSON.stringify(wrapped).slice(0, 60))
        .toThrow(/fenel\.validation\.rigid/);
    }
  });

  it("there is no `$`-key spelling to accept on the way IN either", () => {
    // Nothing in the legacy dual-read maps to a rigid, so a hostile `$`-key
    // input cannot manufacture one: an invented rigid-ish envelope is simply
    // not a SetExpr, and a `$ref` naming the constructor is just a name handle.
    for (const hostile of [
      { $rigid: { scopeToken: "x", ordinal: 0 } },
      { "@rigid/x/0": true },
    ]) {
      expect(peelSetExpr(hostile as unknown), JSON.stringify(hostile)).toBeNull();
      expect(() => setExprToTag(hostile as unknown)).toThrow();
    }
    const namedLikeRigid = setExprToTag({ $ref: "SeRigid" });
    expect(namedLikeRigid).toEqual(ref("SeRigid"));
    expect(hasRigid(namedLikeRigid)).toBe(false);
    // ...and that name handle decides nothing about a real rigid.
    expect(tri(isSubset(namedLikeRigid, KAPPA))).toBe("nothing");
    expect(tri(isSubset(KAPPA, namedLikeRigid))).toBe("nothing");
  });

  it("THE PROVENANCE BOUNDARY — an untrusted caller cannot canonicalize a forged rigid", () => {
    // Recognizing `SeRigid` in the roster is what lets the internal deciders
    // reason about one — but `setExprToTag` is also the gateway the query API,
    // the permission-policy store, and the policy evaluator use to sanitize
    // caller-supplied filters. Admission is therefore OPT-IN.
    //
    // This matters because no CONSTANT lowering of an unknown set is stable
    // under negation: a rigid lowers to SQL `FALSE`, so `¬κ` would lower to
    // `NOT FALSE` = `TRUE` and silently disable a user's filter (JSON-Schema's
    // `{not:{}}` inverts the same way). Closing the ingress is what makes that
    // unreachable rather than merely unlikely.
    const forged: SetExpr = { $tag: "SeRigid", scopeToken: "attacker", ordinal: 0, kind: KTYPE };
    expect(() => setExprToTag(forged)).toThrow(/untrusted or non-validation caller/);
    // ...at any depth, since the recursive arms carry the same options.
    expect(() => setExprToTag({ $tag: "SeComplement", inner: forged })).toThrow(/untrusted/);
    expect(() => setExprToTag({ $tag: "SeUnion", branches: [{ $tag: "SeAll" }, forged] })).toThrow(/untrusted/);
    expect(() => setExprToTag({ $tag: "SeIntersect", branches: [forged] })).toThrow(/untrusted/);
    expect(() => setExprToTag({ $tag: "SeDiff", left: { $tag: "SeAll" }, right: forged })).toThrow(/untrusted/);
    expect(() => setExprToTag({ $tag: "SeMu", var: "X", body: forged })).toThrow(/untrusted/);
    // The engine-internal decider seams opt in explicitly, so the matrix works.
    expect(setExprToTag(forged, { admitValidationRigid: true })).toEqual(forged);
    expect(tri(isSubset(KAPPA, KAPPA_SAME))).toBe("true");
  });

  it("a malformed KIND makes the value NOT a rigid (the `Any` hole, closed)", () => {
    // `SeRigid.kind` is `Any` in the registered ADT, and the whole μ-metadata
    // group treats a rigid as a LEAF "because it has no SetExpr child" — while
    // the digest copies `kind` verbatim. A kind carrying a SetExpr, or another
    // rigid, would break both claims at once and put a foreign scopeToken into
    // the one projection allowed to leave the frame. The recognizer therefore
    // enforces the closed `Kind` ADT.
    const nested = { $tag: "SeRigid", scopeToken: "inner", ordinal: 0, kind: KTYPE };
    for (const badKind of [
      nested,                                   // a rigid as a kind
      { $tag: "SeAll" },                        // a SetExpr as a kind
      { $tag: "KArrow", from: KTYPE, to: KTYPE }, // the WRONG field spelling
      { $tag: "KArrow", input: KTYPE },         // missing output
      { $tag: "KType", extra: 1 },              // KType is nullary
      { $tag: "KWhat" },
      "KType",
      null,
    ]) {
      const value = { $tag: "SeRigid", scopeToken: "s", ordinal: 0, kind: badKind };
      expect(peelSetExpr(value), JSON.stringify(badKind)).toBeNull();
      expect(() => setExprToTag(value, { admitValidationRigid: true })).toThrow();
    }
    // ...and the well-formed kinds ARE rigids, at both kinds.
    expect(peelSetExpr(K("s", 0, KTYPE))?.kind).toBe("SeRigid");
    expect(peelSetExpr(K("s", 0, KARROW))?.kind).toBe("SeRigid");
    const nestedArrow = { $tag: "KArrow", input: KARROW, output: KTYPE };
    expect(peelSetExpr(K("s", 0, nestedArrow))?.kind).toBe("SeRigid");
    // So the leafness argument the μ-metadata arms rely on is a FACT about
    // every value the host will call a rigid, not an assumption about callers.
    expect(hasRigid(K("s", 0, nestedArrow))).toBe(true);
  });

  it("an EXTRA key on either kind arm is rejected — the exact-shape check covers both", () => {
    // The first draft checked the complete own-key set only for `KType`, so
    // `{$tag:"KArrow", input, output, leak}` was accepted and could carry a
    // nested rigid — the very transitive-SetExpr case the check exists to stop.
    const smuggled = { $tag: "SeRigid", scopeToken: "foreign", ordinal: 0, kind: KTYPE };
    const leakyArrow = { $tag: "KArrow", input: KTYPE, output: KTYPE, leak: smuggled };
    expect(peelSetExpr({ $tag: "SeRigid", scopeToken: "s", ordinal: 0, kind: leakyArrow })).toBeNull();
    // ...and the key set is read with `Reflect.ownKeys`, so a NON-ENUMERABLE or
    // SYMBOL-keyed extra cannot slip past `Object.keys`.
    const hiddenOnKType: Record<string, unknown> = { $tag: "KType" };
    Object.defineProperty(hiddenOnKType, "leak", { value: smuggled, enumerable: false });
    expect(peelSetExpr({ $tag: "SeRigid", scopeToken: "s", ordinal: 0, kind: hiddenOnKType })).toBeNull();
    const symbolOnKType: Record<string | symbol, unknown> = { $tag: "KType" };
    symbolOnKType[Symbol("leak")] = smuggled;
    expect(peelSetExpr({ $tag: "SeRigid", scopeToken: "s", ordinal: 0, kind: symbolOnKType })).toBeNull();
  });

  it("kind validation is TOTAL — a hostile `ownKeys` makes the value malformed, not an exception", () => {
    // A structural recognizer must never throw out of itself: the caller cannot
    // tell "not a rigid" from "your input broke my recognizer".
    const trapped = new Proxy({ $tag: "KType" }, { ownKeys() { throw new Error("boom"); } });
    expect(() => peelSetExpr({ $tag: "SeRigid", scopeToken: "s", ordinal: 0, kind: trapped })).not.toThrow();
    expect(peelSetExpr({ $tag: "SeRigid", scopeToken: "s", ordinal: 0, kind: trapped })).toBeNull();
  });

  it("kind validation bounds WORK, not arity — a deeply curried kind is still valid", () => {
    // An earlier draft capped nesting depth at 64, which declared a structurally
    // valid 65-arrow Kind malformed while doing nothing about a shared-DAG kind
    // whose repeated sub-validation is exponential. A node budget bounds total
    // work instead, terminates on a cycle, and rejects no legitimate arity.
    let deep: unknown = { $tag: "KType" };
    for (let i = 0; i < 200; i++) deep = { $tag: "KArrow", input: { $tag: "KType" }, output: deep };
    expect(peelSetExpr({ $tag: "SeRigid", scopeToken: "s", ordinal: 0, kind: deep })?.kind).toBe("SeRigid");
    // A cyclic kind terminates (budget exhaustion) rather than recursing forever.
    const cyclic: Record<string, unknown> = { $tag: "KArrow", input: { $tag: "KType" } };
    cyclic.output = cyclic;
    expect(() => peelSetExpr({ $tag: "SeRigid", scopeToken: "s", ordinal: 0, kind: cyclic })).not.toThrow();
    expect(peelSetExpr({ $tag: "SeRigid", scopeToken: "s", ordinal: 0, kind: cyclic })).toBeNull();
  });

  it("the provenance opt-in reaches EVERY child position, including SePattern", () => {
    // Threading `options` through the recursive arms was done by rewrite, and the
    // point-free `mapPatternSets(v.pattern, setExprToTag)` was missed — an
    // engine-internal opt-in call over a pattern-carried rigid threw. That never
    // leaked (the default is reject), but over-rejecting is the mirror error.
    const admit = { admitValidationRigid: true } as const;
    const patterned: SetExpr = { $tag: "SePattern", pattern: { t: "match", pred: KAPPA } } as SetExpr;
    expect(() => setExprToTag(patterned, admit)).not.toThrow();
    expect(hasRigid(setExprToTag(patterned, admit))).toBe(true);
    expect(() => setExprToTag(patterned)).toThrow(/untrusted or non-validation caller/);
    // ...and a typed SpGroup's `type` slot behaves the same.
    const grouped: SetExpr = {
      $tag: "SePattern",
      pattern: { t: "group", name: "g", child: { t: "eps" }, type: KAPPA },
    } as SetExpr;
    expect(() => setExprToTag(grouped, admit)).not.toThrow();
    expect(() => setExprToTag(grouped)).toThrow(/untrusted or non-validation caller/);
  });

  it("RECOGNITION is symmetric; canonicalization is opt-in; egress is closed", () => {
    // The three-way posture, stated exactly:
    //   recognize        — always (the internal deciders must reason about one)
    //   canonicalize     — only for a caller that declares validation provenance
    //   `$`-key egress   — never
    expect(isSetExpr(KAPPA)).toBe(true);
    expect(peelSetExpr(KAPPA)?.kind).toBe("SeRigid");
    expect(setExprToTag(KAPPA, { admitValidationRigid: true })).toEqual(KAPPA);
    expect(() => setExprToTag(KAPPA)).toThrow(/untrusted or non-validation caller/);
    expect(() => setExprToDollarKey(KAPPA)).toThrow(/fenel\.validation\.rigid/);
    // Recognition staying symmetric is what stops the swallow class: a rigid is
    // never silently reclassified as "not a set expression at all".
    expect(peelSetExpr({ $tag: "SeNotAThing" })).toBeNull();
    expect(isSetExpr({ $tag: "SeNotAThing" })).toBe(false);
  });

  it("a malformed rigid is NOT a rigid (descriptor-safe, domain-checked slots)", () => {
    const malformed: unknown[] = [
      { $tag: "SeRigid" },
      { $tag: "SeRigid", scopeToken: "s" },
      { $tag: "SeRigid", scopeToken: 1, ordinal: 0, kind: KTYPE },
      { $tag: "SeRigid", scopeToken: "s", ordinal: -1, kind: KTYPE },
      { $tag: "SeRigid", scopeToken: "s", ordinal: 1.5, kind: KTYPE },
      { $tag: "SeRigid", scopeToken: "s", ordinal: "0", kind: KTYPE },
    ];
    for (const value of malformed) {
      expect(peelSetExpr(value), JSON.stringify(value)).toBeNull();
    }
    // A hostile ACCESSOR on an identity slot makes it unrecognized rather than
    // a rigid whose identity reads differently on each access.
    const hostile = { $tag: "SeRigid", ordinal: 0, kind: KTYPE };
    let reads = 0;
    Object.defineProperty(hostile, "scopeToken", { get: () => `s${reads++}`, enumerable: true });
    expect(peelSetExpr(hostile)).toBeNull();
  });

  it("no rigid TOKEN reaches a printed / formatted / labelled surface", () => {
    // The claim is about TOKEN/identity material, not about the existence of a
    // rendering. A printer must return a string, so the honest posture is a
    // redacted constant that carries no scopeToken, no ordinal, and no kind —
    // "only the digest leaves the frame" governs identity, and `<rigid>` has
    // none. Pinned as an exact equality so a future edit cannot widen it.
    const surfaces = [
      String(dispatchEngineBody("engine:printSetExpr", [KAPPA, null])),
      String(dispatchedFormatSetExpr(KAPPA)),
      String(dispatchedAutoLabel(KAPPA)),
    ];
    for (const rendered of surfaces) {
      expect(rendered).not.toContain("scope-A");
      expect(rendered).not.toContain("scopeToken");
      expect(rendered).not.toContain("ordinal");
      expect(rendered).not.toContain("SeRigid");
    }
    // The printer and the set-syntax formatter both emit the redacted constant.
    expect(surfaces[0]).toBe("<rigid>");
    expect(surfaces[1]).toBe("<rigid>");
  });

  it("NO CONSTANT lowering of a rigid is polarity-stable — which is why the GATEWAY is the fix", () => {
    // The honest statement of the SQL/JSON-Schema arms' limit. A bare rigid
    // lowers to `FALSE`, so `¬κ` lowers to `NOT FALSE` = `TRUE`; at κ := ⊤ the
    // true answer is `FALSE`. No constant can be right in both polarities, so
    // "fail closed at the leaf" is NOT a property these projections can have —
    // the actual guarantee is that a rigid never reaches them from caller data.
    const frag = dispatchEngineBody("engine:setExprToSqlFragment", [compl(KAPPA)]) as unknown;
    expect(JSON.stringify(frag)).toContain("FALSE"); // ...under a NOT. Documented, not relied on.
    // THE GUARANTEE: the supported gateway refuses a complement-of-rigid outright,
    // so that fragment is unreachable from the query / permission-policy paths.
    expect(() => setExprToTag(compl(KAPPA))).toThrow(/untrusted or non-validation caller/);
    expect(() => setExprToTag(diff(ALL, KAPPA))).toThrow(/untrusted or non-validation caller/);
  });

  it("the SQL projection FAILS CLOSED (FALSE), never the permissive TRUE", () => {
    const frag = dispatchEngineBody("engine:setExprToSqlFragment", [KAPPA]) as Record<string, unknown>;
    expect(JSON.stringify(frag)).toContain("FALSE");
    expect(JSON.stringify(frag)).not.toContain("TRUE");
    expect(JSON.stringify(frag)).not.toContain("scope-A");
  });

  it("the JSON-Schema projection FAILS CLOSED (accepts nothing), never the permissive {}", () => {
    const constraints = dispatchEngineBody("engine:setExprToConstraints", [KAPPA, "string"]) as
      Record<string, unknown>;
    expect(Object.keys(constraints)).toEqual(["not"]);
    expect(constraints.not).toEqual({});
    expect(JSON.stringify(constraints)).not.toContain("scope-A");
  });

  it("no minted rigid TOKEN appears in ANY generated artifact", () => {
    const generated = join(REPO, "implementations/typescript/engine/src/generated");
    // The constructor NAME and the field NAME `scopeToken` legitimately appear
    // in artifacts: the registered 15-case ADT rides the parse cache and the
    // catalog, and `vrgMint`'s compiled body names the field. What must never
    // appear is a scopeToken bound to a LITERAL — a mint nonce exists only at
    // runtime inside a validation frame, so a literal here means one escaped
    // into a build artifact.
    //
    // Getting this scan right took three attempts, and each failure is worth
    // recording because each was a plausible-looking scan that proved nothing:
    //   1. `/scope-\w/` matched ordinary PROSE — "scope-dependent",
    //      "scope-aware", "scope-unique" — in the artifacts' embedded doc text.
    //   2. A regex for the escaped-quote binding matched inside bun but not in a
    //      standalone probe; the parse cache embeds JSON inside a TS string
    //      literal, so every quote arrives backslash-escaped and "an
    //      optionally-escaped quote" is an escaping puzzle that silently drifts.
    //   3. An indexOf scan for "scopeToken bound to a string literal" flagged
    //      `"scopeToken":"_"` — which is `setAlgebraShapeTag`'s PATTERN wildcard
    //      `SeRigid { scopeToken = _ }`. A compiled pattern binds the field to a
    //      binder NAME, so at the JSON level a pattern and a construction are
    //      indistinguishable by binding SHAPE alone.
    // So the invariant is stated on the bound VALUE's shape: an artifact may
    // bind `scopeToken` to a wildcard or a binder identifier (patterns and
    // `vrgMint`'s own parameter), and to nothing else. A mint nonce is not an
    // identifier — it carries separators, digits, or punctuation.
    const NAME = "scopeToken";
    // Two unambiguous steps rather than one composite character class: drop
    // backslashes by literal string replacement, then drop whitespace with the
    // one escape (`\s`) that has no alternative spelling.
    const strip = (s: string): string => s.replaceAll("\\", "").replace(/\s/g, "");
    const IDENTIFIER = /^[_A-Za-z][A-Za-z0-9_]*$/;
    for (const entry of readdirSync(generated)) {
      if (!/\.(ts|json)$/.test(entry)) continue;
      const text = readFileSync(join(generated, entry), "utf8");
      for (let i = text.indexOf(NAME); i !== -1; i = text.indexOf(NAME, i + 1)) {
        const tail = strip(text.slice(i + NAME.length, i + NAME.length + 96));
        const bound = /^"?[:=]"([^"]*)"/.exec(tail);
        if (bound === null) continue; // not a string binding (a var ref, a type, prose)
        expect(
          IDENTIFIER.test(bound[1]!),
          `${entry} binds ${NAME} to the non-identifier ${JSON.stringify(bound[1])} at offset ${i}`
          + " — a minted rigid token escaped into a build artifact",
        ).toBe(true);
      }
    }
  });
});

// ---------------------------------------------------------------------------
// THE Tt-FACE PROHIBITION
// ---------------------------------------------------------------------------

describe("the raw Tt face is prohibited for validation rigids", () => {
  it("the validation-rigid module declares nothing over the Tt face", () => {
    const source = read("fenel/modules/engine/validation-rigid.fenel");
    const code = source
      .split("\n")
      .filter((line) => !/^\s*--/.test(line) && !/^\s*@(label|description|tags|category)\b/.test(line))
      .join("\n");
    for (const forbidden of [
      "TraversalType", "TtVar", "TtRefined", "TtMu", "TtNamed", "TtOpaque",
      "TtVariant", "TtRecord", "TtArrow", "TtUnion", "TtIntersect", "TtComplement",
      "subsetW", "isBottomMu", "tsKind", "tsRefinedSet",
    ]) {
      expect(code.includes(forbidden), `validation-rigid.fenel reaches ${forbidden}`).toBe(false);
    }
  });

  it("a rigid riding a $refined set into the Tt face FAILS LOUD — it never silently refutes", () => {
    // The brief's requirement: a rigid reaching the raw Tt face must be a loud
    // failure, not a silent refutation. The have-side `TtVar` path there ends in
    // `resolveArm`'s `Just false`, and `isBottomMu` is binder-name-blind, so a
    // structural refutation could survive that does NOT survive ground
    // substitution.
    //
    // The enforcement is the traversal boundary: `traversalSnapshotSetIntervals`
    // has no host snapshot for a rigid, so the semantic-slot assertion rejects
    // the whole type. That is a THROW, which no caller can mistake for a
    // verdict.
    const refinedByRigid = { $refined: { base: { $ref: "Number" }, set: KAPPA } };
    expect(() => dispatchedSubset({ $ref: "Number" } as never, refinedByRigid as never))
      .toThrow(/field-identity semantic boundary/);
    expect(() => dispatchedSubset(refinedByRigid as never, { $ref: "Number" } as never))
      .toThrow(/field-identity semantic boundary/);
    // CONTROL — the same shape with an ordinary set decides normally, so the
    // throw above is about the rigid and not about `$refined` per se.
    const refinedByEnum = { $refined: { base: { $ref: "Number" }, set: enumS(1, 2) } };
    expect(() => dispatchedSubset({ $ref: "Number" } as never, refinedByEnum as never)).not.toThrow();
  });

  it("the Se face — the one D3 checks on — ABSTAINS instead of refuting", () => {
    // `ssBRefined` / `ttTopCoverRefined` query `decideSubset SeAll (tsRefinedSet want)`.
    // Before this slice that answered `Just false` for any leaf outside the
    // enumerated compounds, so a rigid-carrying refinement would have been a
    // FALSE refutation had it reached the decider. On the Se face it abstains.
    expect(tri(isSubset(ALL, KAPPA))).toBe("nothing");
    expect(tri(isSubset(KAPPA, ref("Number")))).toBe("nothing");
  });

  it("containment.fenel neither names nor constructs a rigid", () => {
    const source = read("fenel/modules/engine/containment.fenel");
    expect(source.includes("SeRigid")).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// THE EXHAUSTIVENESS META-TEST
// ---------------------------------------------------------------------------

describe("exhaustiveness — every censused SetExpr-matching face has an explicit rigid arm", () => {
  /** The slice-3a census work-list. Each entry is a face that dispatches on a
   * SetExpr constructor and whose DEFAULT arm would otherwise decide the rigid's
   * semantics for it. This is the test that stops a future 16th constructor from
   * silently inheriting a default: adding one without revisiting these faces
   * leaves this list stale, and the audit note explains the discipline. */
  const FENEL_FACES: [string, string[]][] = [
    ["fenel/modules/engine/set-algebra-deciders.fenel", [
      "setAlgebraContains", "setAlgebraDecideEmptyCore", "setAlgebraTopCover",
      "setAlgebraSearchable", "setAlgebraShapeTag", "setAlgebraDisjointArm",
      "setAlgebraSubsetAllArm", "setAlgebraDecideLeafSubset", "setAlgebraSubsetRigidArm",
      "setSemanticEq", "setAlgebraCtxFreeW", "isValueOnlyPredicate",
      "seRefHandles", "substSet", "sePositiveP", "seVarOccurs",
      "seVarUnderPattern", "seMuGuarded", "seSize", "setAlgebraNormalize",
    ]],
    ["fenel/modules/engine/propagate.fenel", ["seTag"]],
    ["fenel/modules/engine/enumerate.fenel", ["enumerateSet"]],
    // `inhabit` is the ONE documented shared-fence exception (its own test
    // below); it is at the parser's per-decl token budget.
    ["fenel/modules/engine/set-expr-sql.fenel", ["setExprToSqlFragment"]],
    ["fenel/modules/engine/fenel-printer.fenel", ["printSetExpr"]],
    ["fenel/modules/engine/set-syntax.fenel", ["setSyntaxFmtExpr"]],
    ["fenel/modules/engine/json-schema.fenel", ["setExprToConstraints"]],
    ["fenel/modules/engine/validation-hints.fenel", ["autoLabel"]],
  ];

  it("each censused Fenel face names SeRigid in its own declaration body", () => {
    for (const [file, fns] of FENEL_FACES) {
      const source = read(file);
      for (const fn of fns) {
        // Slice out the declaration: from its equation head to the next
        // top-level `@label`/declaration, so a mention in a NEIGHBOUR's body
        // cannot satisfy this assertion for the wrong function.
        const start = source.search(new RegExp(`^${fn}\\s*[:=]`, "m"));
        expect(start, `${file} declares no ${fn}`).toBeGreaterThan(-1);
        const rest = source.slice(start);
        const nextDecl = rest.slice(1).search(/^@label\b/m);
        const decl = nextDecl === -1 ? rest : rest.slice(0, nextDecl + 1);
        expect(
          /SeRigid/.test(decl),
          `${file}:${fn} has no explicit SeRigid arm — a rigid would inherit its default`,
        ).toBe(true);
      }
    }
  });

  it("`inhabit` is the ONE documented shared-fence exception, and it is documented", () => {
    // Its declaration is at the parser's 120-token per-decl budget, so a ninth
    // `else if` would force the file into FENCE_FALLBACK. The rigid rides the
    // documented trailing fall-through.
    //
    // signature-substrate slice 3jw RE-PIN. The fall-through spelling moved
    // from `else seWitnessNone s` to `else seWitnessFallback s` (a token-NEUTRAL
    // swap, measured 119 -> 119). Re-pinning the literal alone would let a
    // future edit route SeRigid somewhere that witnesses it while the string
    // still matched, so this asserts the fence's MEANING:
    //   (a) the fall-through is `seWitnessFallback`,
    //   (b) `seWitnessFallback` routes ONLY SeRef away and delegates everything
    //       else — SeRigid included — to `seWitnessNone`, and
    //   (c) `seWitnessNone` is still the constant-Nothing face.
    // (a)+(b)+(c) together are what makes (d), the observed behaviour, a
    // consequence rather than a coincidence.
    const source = read("fenel/modules/engine/inhabit.fenel");
    expect(/NO WITNESS AT A RIGID/.test(source)).toBe(true);
    expect(/PVF_DECL_CAP/.test(source)).toBe(true);
    // (a) the DISPATCHER's fall-through is the fallback, and the dispatcher no
    //     longer falls through to `seWitnessNone` directly. Anchored on the
    //     preceding arm, because `seWitnessFallback`'s OWN body legitimately
    //     contains `else seWitnessNone s` — an unanchored negative would be
    //     asserting something false.
    expect(/else if eq t "SeArrow" then seWitnessArrow s\s*\n\s*else seWitnessFallback s/.test(source)).toBe(true);
    expect(/else if eq t "SeArrow" then seWitnessArrow s\s*\n\s*else seWitnessNone s/.test(source)).toBe(false);
    // (b) the fallback's own body: SeRef leaves, everything else delegates.
    expect(
      /seWitnessFallback s =\s*\n\s*if eq \(seTag s\) "SeRef" then seWitnessRef s\s*\n\s*else seWitnessNone s/.test(source),
    ).toBe(true);
    // (c) the shared no-witness face is still constantly Nothing.
    expect(/seWitnessNone s = Nothing/.test(source)).toBe(true);
    // (d) ...and the behaviour all of that documents is the one observed.
    expect(witnessOf(KAPPA)).toEqual({ $tag: "Nothing" });
  });

  it("the host roster matches the registered 15-case ADT", () => {
    expect(VALIDATION_RIGID_TAG).toBe("SeRigid");
    expect(SET_EXPR_TAGS).toContain(VALIDATION_RIGID_TAG);
    expect(KAPPA.$tag).toBe(VALIDATION_RIGID_TAG);
    const registered = read("fenel/modules/engine/set-expr-types.fenel");
    expect(/\|\s*SeRigid\s+scopeToken:\s*String\s+ordinal:\s*Nat\s+kind:\s*Any/.test(registered)).toBe(true);
  });

  it("the DecidableMembership family has a row for the rigid shape", () => {
    const instances = read("fenel/modules/decidable-membership/instances.fenel");
    expect(/dmInstanceRigid\s*:\s*DecidableMembership\s+SetRigid/.test(instances)).toBe(true);
    // Every method is an abstention face, not a per-shape decision. The values
    // are qualified references (`set.contains` names `set:contains`;
    // modules-as-values Phase 2c).
    expect(/dmInstanceRigid = DecidableMembership \{ contains = set\.contains,/.test(instances)).toBe(true);
    expect(/dmInstanceRigid.*witness = engine\.seWitnessNone\b/.test(instances)).toBe(true);
    expect(/dmInstanceRigid.*enumerate = engine\.seEnumOpaque\b/.test(instances)).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// INERTNESS — nothing is judgment-reachable in slice 3a
// ---------------------------------------------------------------------------

describe("slice-3a inertness", () => {
  const JUDGMENT_SOURCES = [
    "fenel/modules/engine/check.fenel",
    "fenel/modules/engine/judgment.fenel",
    "fenel/modules/engine/kernel.fenel",
    "fenel/modules/engine/synthesize.fenel",
    "fenel/modules/engine/inference.fenel",
    "fenel/modules/engine/analyze.fenel",
    "fenel/modules/engine/totality.fenel",
    "fenel/modules/engine/containment.fenel",
    "fenel/modules/engine/set-algebra-deciders.fenel",
  ];

  it("NO Fenel source outside the rigid module references a vrg* function", () => {
    const rigidPath = join(REPO, "fenel", "modules", "engine", "validation-rigid.fenel");
    const offenders: string[] = [];
    const walk = (dir: string): void => {
      for (const entry of readdirSync(dir)) {
        const full = join(dir, entry);
        if (statSync(full).isDirectory()) { walk(full); continue; }
        if (!entry.endsWith(".fenel")) continue;
        if (full === rigidPath) continue;
        const code = readFileSync(full, "utf8")
          .split("\n")
          .filter((line) => !/^\s*--/.test(line) && !/^\s*@(label|description|tags|category)\b/.test(line))
          .join("\n");
        if (/\bvrg[A-Z]/.test(code)) offenders.push(full);
      }
    };
    walk(join(REPO, "fenel"));
    expect(offenders).toEqual([]);
  });

  it("the rigid module's own functions all carry the scannable vrg prefix", () => {
    const source = read("fenel/modules/engine/validation-rigid.fenel");
    const declared = [...source.matchAll(/^([a-z][A-Za-z0-9]*)\s*:\s*\(/gm)].map((m) => m[1]!);
    expect(declared.length).toBeGreaterThan(10);
    for (const name of declared) {
      expect(/^vrg[A-Z]/.test(name), `validation-rigid.fenel declares ${name} without the vrg prefix`).toBe(true);
    }
  });

  it("no judgment source MINTS a rigid or consumes the rigid vocabulary", () => {
    for (const source of JUDGMENT_SOURCES) {
      const code = read(source)
        .split("\n")
        .filter((line) => !/^\s*--/.test(line) && !/^\s*@(label|description|tags|category)\b/.test(line))
        .join("\n");
      // A decider may PATTERN-MATCH `SeRigid {…}` — that IS the whole matrix —
      // but must never MINT one. `vrgMint` is the only mint, and no judgment
      // source may reach it or the binder vocabulary that feeds it.
      expect(/\bvrg[A-Z]/.test(code), `${source} calls a vrg* function`).toBe(false);
      expect(/ValidationRigidBinder|VrgBinder/.test(code), `${source} names the rigid binder type`).toBe(false);
      // Every `SeRigid {…}` occurrence in a judgment source must be a case-arm
      // PATTERN, i.e. the text after its closing brace begins with `->`. A
      // construction sits in a value position and does not. (No source scan can
      // prove minting either way — the behavioural test below is the proof; this
      // is the tripwire that keeps a new construction visible.)
      for (const match of code.matchAll(/SeRigid\s*\{[^}]*\}/g)) {
        const after = code.slice((match.index ?? 0) + match[0].length);
        expect(
          /^\s*->/.test(after),
          `${source} has a non-pattern SeRigid occurrence at offset ${match.index} — only vrgMint may construct one`,
        ).toBe(true);
      }
    }
  });

  it("no decider MINTS a rigid — a rigid-free input never yields a rigid-bearing output", () => {
    // The behavioural form of "only the validation frame mints", which no
    // source scan can establish. Every decider face that RETURNS a SetExpr is
    // exercised on rigid-free input; none may invent one.
    const rigidFree: SetExpr[] = [
      ALL, NONE, enumS(1, 2), ref("Int"),
      union(ref("Int"), enumS(1)), inter(ref("Int"), ALL),
      compl(enumS(1)), diff(ALL, enumS(1)),
      mu("X", union(ctorSet("Nil", []), ctorSet("Cons", [["tail", ref("X")]]))),
      arrowSet([ref("Int")], ref("Int")),
    ];
    for (const s of rigidFree) {
      expect(hasRigid(normalize(s)), `normalize ${JSON.stringify(s).slice(0, 40)}`).toBe(false);
      expect(hasRigid(setExprToTag(s)), `setExprToTag ${JSON.stringify(s).slice(0, 40)}`).toBe(false);
      expect(hasRigid(dispatchEngineBody("engine:setAlgebraNnf", [s])), "nnf").toBe(false);
    }
  });

  it("no production TypeScript path constructs a rigid outside the ledgered host surface", () => {
    const roots = [
      "implementations/typescript/engine/src",
      "implementations/typescript/runtime/src",
      "distros/narthex/solid/src",
    ];
    const allowed = new Set([
      "set-marker.ts", // the ONE host construction site (`buildSetExpr.rigid`)
      "types.ts",      // the type MIRROR — a union member declaration, not a value
    ]);
    const offenders: string[] = [];
    const walk = (dir: string): void => {
      for (const entry of readdirSync(dir)) {
        const full = join(dir, entry);
        if (statSync(full).isDirectory()) {
          if (entry === "node_modules" || entry === "generated") continue;
          walk(full);
          continue;
        }
        if (!/\.(ts|tsx)$/.test(entry)) continue;
        if (/\.test\.tsx?$/.test(entry)) continue;
        if (allowed.has(entry)) continue;
        const text = readFileSync(full, "utf8");
        if (/buildSetExpr\.rigid\b/.test(text)) offenders.push(`${full} :: buildSetExpr.rigid`);
        if (/\$tag:\s*["']SeRigid["']/.test(text)) offenders.push(`${full} :: SeRigid literal`);
      }
    };
    for (const root of roots) walk(join(REPO, root));
    expect(offenders).toEqual([]);
  });

  it("the S2 canonical-byte leaf has exactly ONE production consumer (slice 3g's trusted entry)", () => {
    // 3a built the digest PAYLOAD in Fenel and hashed it here, in the test,
    // because no production validator existed to wire the encoder into. Slice
    // 3g is that validator: `vteValidate` must compute its own bindings, since
    // a digest handed in by its caller would make every binding the caller's
    // word. So the claim narrows rather than lapses — one named seam, not none.
    const roots = [
      "implementations/typescript/engine/src",
      "implementations/typescript/runtime/src",
      "distros/narthex/solid/src",
    ];
    const offenders: string[] = [];
    const walk = (dir: string): void => {
      for (const entry of readdirSync(dir)) {
        const full = join(dir, entry);
        if (statSync(full).isDirectory()) {
          if (entry === "node_modules" || entry === "generated") continue;
          walk(full);
          continue;
        }
        if (!/\.(ts|tsx)$/.test(entry)) continue;
        if (/\.test\.tsx?$/.test(entry)) continue;
        if (entry === "validation-canonical-bytes.ts") continue;
        if (readFileSync(full, "utf8").includes("validation-canonical-bytes")) offenders.push(full);
      }
    };
    for (const root of roots) walk(join(REPO, root));
    expect(offenders.map((o) => o.slice(join(REPO).length + 1).split(sep).join("/"))).toEqual([
      "implementations/typescript/engine/src/engine-bodies-dispatch.ts",
    ]);
  });

  it("no checker path instantiates a scheme with rigids yet (3b's step)", () => {
    const signatureSources = readdirSync(join(REPO, "implementations/typescript/engine/src"))
      .filter((entry) => /^signature-.*\.ts$/.test(entry) && !/\.test\.ts$/.test(entry));
    for (const entry of signatureSources) {
      const text = read(`implementations/typescript/engine/src/${entry}`);
      expect(text.includes("SeRigid"), `${entry} references SeRigid before slice 3b`).toBe(false);
      expect(/\bvrg[A-Z]/.test(text), `${entry} calls a vrg* function before slice 3b`).toBe(false);
    }
  });

  it("SignatureTrust is untouched by this slice", () => {
    const rigid = read("fenel/modules/engine/validation-rigid.fenel");
    expect(rigid.includes("SignatureTrust")).toBe(false);
    expect(rigid.includes("TrustedPrimitive")).toBe(false);
    expect(rigid.includes("InferredDerivation")).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// THE DECIDER CORPUS MUST NOT MOVE — rigid-free inputs are unaffected
// ---------------------------------------------------------------------------

describe("no leakage into the general path", () => {
  it("the ⊤ ⊆ <leaf> refutation is PRESERVED for every ordinary leaf", () => {
    // The arm added for the rigid sits BEFORE the leaf default; the default's
    // domain-bounded refutation must still fire for the leaves it was written
    // for, or the fix leaked.
    expect(tri(isSubset(ALL, enumS(1, 2)))).toBe("false");
    expect(tri(isSubset(ALL, ctorSet("Nil", [])))).toBe("false");
    expect(tri(isSubset(ALL, ref("Int")))).toBe("false");
    expect(tri(isSubset(ALL, arrowSet([ref("Int")], ref("Int"))))).toBe("false");
    expect(tri(isSubset(ALL, mu("X", ctorSet("Cons", [["tail", ref("X")]]))))).toBe("false");
    // ...and the Boolean compounds still abstain / decide as before.
    expect(tri(isSubset(ALL, ALL))).toBe("true");
    expect(tri(isSubset(ALL, inter()))).toBe("true");
  });

  it("setSemanticEq's new terminal default does not change any 14-case verdict", () => {
    // Reflexivity through the subset tail rules, per shape.
    for (const [label, g] of GROUNDS) {
      expect(tri(isSubset(g, g)), `${label} ⊆ itself`).not.toBe("false");
    }
    expect(tri(isSubset(enumS(1, 2), enumS(1, 2)))).toBe("true");
    expect(tri(isSubset(ref("Int"), ref("Int")))).toBe("true");
  });

  it("seTag still answers SeOther for a genuinely unknown shape", () => {
    expect(dispatchEngineBody("engine:seTag", [{ $tag: "SeNotAThing" }])).toBe("SeOther");
    expect(dispatchEngineBody("engine:seTag", [KAPPA])).toBe("SeRigid");
  });

  it("print() of an ordinary refinement is unchanged by the printer's new arm", () => {
    const refined = { $refined: { base: { $ref: "Number" }, set: enumS(1, 2) } };
    expect(String(print(refined as never))).toContain("value in [1, 2]");
  });
});
