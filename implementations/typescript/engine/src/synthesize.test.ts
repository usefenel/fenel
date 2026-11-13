// decide-substrate Phase 8λ.3 — goal-directed term SYNTHESIS (synthesize.fenel).
// Past the const/vacuous witnesses (8λ.1), inhabiting `⟦A→B⟧` is a fuel-bounded
// intro/base/var/ctor term search whose LAMBDA WITNESS the EXISTING kernel witness
// rule re-checks (the 8λ.2 route). This suite drives the WHOLE synthesizer through
// `witnessOf` (inhabit → seWitnessArrow → synthesizeArrow, the production hook —
// ZERO new TS wrapper) and re-certifies every found witness through `contains`
// (the kernel `{closure} ⊆ SeArrow` membership route). `decideEmpty` pins the
// honest-`TvEmpty` bar (a decidably-empty goal yields NO dishonest witness).
//
// Design: `design/arrow-synthesis.md` §0.3/§0.4/§5. Brief:
// `briefs/phase-8lambda-3-synthesize.md`.

import { test, expect, describe } from "bun:test";
import { contains, isSubset, decideEmpty, witnessOf } from "./set-algebra";
import { typeToSetExpr } from "./fenel-check";
import { verify } from "./kernel";
import { decidableSetProof, propInhabited } from "./prover";
import { decidableSetProposerNative } from "./modules/prover";
import type { FenelType, FieldKey, SetExpr } from "./types";

import { setDefaultTimeout } from "bun:test";

// type-substrate P1(a) - bun's 5 s per-test default is wrong for this file: it
// drives the INTERPRETED Fenel deciders/synthesizer, and on a slow Windows host
// individual assertions measured 5-70 s BEFORE this phase and after it (verdicts
// identical either side). A suite that reports clock as failure is a gate nobody
// can read, which is how a real red in tcb-recheck went unnoticed. Raise the
// budget; never weaken an assertion to fit it.
setDefaultTimeout(600_000);

const namedFixtureKey = (i: number): FieldKey => ({
  $tag: "NamedField",
  ref: { $ref: `30000000-0000-4000-8000-${String(i + 1).padStart(12, "0")}` },
});

// MaybeBool → "true" | "false" | "nothing".
function mb(m: unknown): "true" | "false" | "nothing" {
  const x = m as { $tag?: string; _0?: unknown; value?: unknown };
  if (x?.$tag === "Just") return (x._0 ?? x.value) ? "true" : "false";
  return "nothing";
}

// The witnessOf result unwrapped: Just closure ⇒ the closure; else null.
type Closure = { __fenelFn?: boolean; params?: string[]; body?: unknown; closure?: unknown };
function witClosure(set: SetExpr): Closure | null {
  const w = witnessOf(set) as { $tag?: string; _0?: Closure };
  if (w?.$tag === "Just") return w._0 ?? null;
  return null;
}

const INT: FenelType = { $ref: "Int" } as unknown as FenelType;
const NUM: FenelType = { $ref: "Number" } as unknown as FenelType;
const STR: FenelType = { $ref: "String" } as unknown as FenelType;
const intSet = typeToSetExpr(INT) as SetExpr;
const numSet = typeToSetExpr(NUM) as SetExpr;
const strSet = typeToSetExpr(STR) as SetExpr;

// Direct SeArrow / leaf builders (the arrow.test.ts idiom).
const arrowSet = (paramSets: SetExpr[], ret: SetExpr): SetExpr =>
  ({
    $tag: "SeArrow",
    params: paramSets.map((s, i) => ({ $tag: "SetArrowParam", key: namedFixtureKey(i), wireName: `p${i}`, set: s })),
    returns: ret,
  } as unknown as SetExpr);
const enumS = (...vs: unknown[]): SetExpr => ({ $tag: "SeEnum", values: vs } as unknown as SetExpr);
const NONE: SetExpr = { $tag: "SeNone" } as unknown as SetExpr;
const ctorS = (c: string, fieldSets: SetExpr[]): SetExpr =>
  ({
    $tag: "SeCtor",
    ctor: c,
    fields: fieldSets.map((s, i) => ({ $tag: "SetCtorField", key: { $tag: "PositionalField", index: i }, wireName: `_${i}`, set: s })),
  } as unknown as SetExpr);

// ── the const/vacuous fast path is BYTE-PRESERVED (regression guard) ─────────
describe("synthesize — the vacuous fast path is untouched; the const-first probe is GONE (8λ.6)", () => {
  // APPROVED CHANGE (8λ.6). This test used to pin `body === 1` — the const
  // closure `seWitnessArrowConst` produced by probing `inhabit(returns)` BEFORE
  // search. That probe was the first of six point-pre-emption surfaces and,
  // while it stood, it masked the other five: every arrow whose return had a
  // cheap point collapsed to `\_ -> <point>`. Pin 17 deletes it, so `({1})→{1}`
  // is now inhabited by the admitted BASE-FREE projection instead. Both are
  // sound total functions {1}→{1} and both kernel-re-certify; the constant is
  // still reachable, it is simply no longer preferred over an admitted
  // base-free term. What this test now pins is exactly that ordering.
  test("({1})→{1} prefers the base-free PROJECTION over the constant (the const-first probe is retired)", () => {
    const c = witClosure(arrowSet([enumS(1)], enumS(1)));
    expect(c?.__fenelFn).toBe(true);
    expect(c?.params?.length).toBe(1);
    expect(c?.body).toEqual({ var: c!.params![0] } as never); // the projection, not the raw 1
    expect(mb(contains(arrowSet([enumS(1)], enumS(1)), c, null))).toBe("true");
  });
  test("(∅)→{1} still witnesses a VACUOUS closure — the root-spine vacuous candidate is offered FIRST, uncharged, at every fuel and budget", () => {
    const c = witClosure(arrowSet([NONE], enumS(1)));
    expect(c?.__fenelFn).toBe(true);
    expect(c?.body).toBe(false); // byte-identical to the pre-8λ.6 vacuous witness
  });
});

// ── the VAR tactic — the headline synthesis gain ────────────────────────────
describe("synthesize — the var tactic (identity over a non-cheaply-witnessable domain)", () => {
  test("(Int)→Int synthesizes `\\x -> x` (was Nothing — ℤ has no cheap point witness)", () => {
    const c = witClosure(arrowSet([intSet], intSet));
    expect(c?.__fenelFn).toBe(true);
    expect(c?.params?.length).toBe(1);
    // the body is a VARIABLE reference to the fresh param (the identity) — NOT a
    // const literal (inhabit(ℤ) = Nothing, so base can't fire; var does).
    const name = c?.params?.[0];
    expect(c?.body).toEqual({ var: name });
  });
  test("(Int)→Int — the synthesized witness re-certifies through the kernel (contains = Just true)", () => {
    const goal = arrowSet([intSet], intSet);
    const c = witClosure(goal);
    expect(mb(contains(goal, c, null))).toBe("true");
  });
  test("(Int)→Number synthesizes a witness (identity: ℤ ⊆ ℝ) — re-certifies", () => {
    const goal = arrowSet([intSet], numSet);
    const c = witClosure(goal);
    expect(c?.__fenelFn).toBe(true);
    expect(mb(contains(goal, c, null))).toBe("true");
  });
});

// ── the CTOR tactic (× var) — `\x -> Just x` ────────────────────────────────
describe("synthesize — the ctor tactic (EConstruct over per-field synthesis)", () => {
  test("(Int)→(Just Int) synthesizes `\\x -> Just x` (base fails on the ctor, ctor+var build it)", () => {
    const goal = arrowSet([intSet], ctorS("Just", [intSet]));
    const c = witClosure(goal);
    expect(c?.__fenelFn).toBe(true);
    // the body constructs Just applied to the fresh param variable.
    const name = c?.params?.[0];
    expect(c?.body).toEqual({ construct: ["Just", { var: name }] });
  });
  test("(Int)→(Just Int) — the ctor witness re-certifies through the kernel (contains = Just true)", () => {
    const goal = arrowSet([intSet], ctorS("Just", [intSet]));
    expect(mb(contains(goal, witClosure(goal), null))).toBe("true");
  });
  test("(Int)→(Just Int | Nothing) — a SeUnion return synthesizes via the first branch", () => {
    // union of two ctors; the first branch (Just Int) synthesizes `Just x`.
    const uni = { $tag: "SeUnion", branches: [ctorS("Just", [intSet]), ctorS("Nothing", [])] } as unknown as SetExpr;
    const goal = arrowSet([intSet], uni);
    const c = witClosure(goal);
    expect(c?.__fenelFn).toBe(true);
    expect(mb(contains(goal, c, null))).toBe("true");
  });
});

// ── nested intro (currying) + fuel sufficiency ──────────────────────────────
describe("synthesize — nested intro (curried arrows) within the fuel budget", () => {
  test("(Int)→((Int)→((Int)→Int)) synthesizes a nested lambda + re-certifies", () => {
    const goal = arrowSet([intSet], arrowSet([intSet], arrowSet([intSet], intSet)));
    const c = witClosure(goal);
    expect(c?.__fenelFn).toBe(true);
    expect(mb(contains(goal, c, null))).toBe("true");
  });
  // 8λ.6 renamed rather than reasserted: this goal is `\f x -> f x`-shaped and
  // the const also covers it (2 ∈ {2}), so before the ordered search the const
  // probe answered. Now the base-free apply wins and the constant is the
  // count-free reserve behind it. The assertions were already about arity and
  // re-certification, so they hold unchanged; only the name was a lie.
  test("an arrow-of-arrows goal is inhabited at the right arity, and now by the base-free APPLY rather than the constant", () => {
    // ((({1})→{2}),{1})→{2} — the `\f x -> f x` shape.
    const fArrow = arrowSet([enumS(1)], enumS(2));
    const goal = arrowSet([fArrow, enumS(1)], enumS(2));
    const c = witClosure(goal);
    expect(c?.__fenelFn).toBe(true);
    expect(c?.params?.length).toBe(2);
    expect(mb(contains(goal, c, null))).toBe("true");
  });
});

// ── the honest-TvEmpty bar + the Γ-apply v1 fence ───────────────────────────
describe("synthesize — the honest bar (no dishonest witness)", () => {
  test("({1})→∅ is decidably EMPTY ⇒ NO witness (TvEmpty, not a fake closure)", () => {
    const goal = arrowSet([enumS(1)], NONE);
    expect(mb(decideEmpty(goal))).toBe("true"); // the arrow IS empty (exponential law)
    expect(witnessOf(goal)).toEqual({ $tag: "Nothing" }); // ⇒ no witness
  });
  test("the FORMER Γ-apply-ONLY fence goal ((String→Int),String)→Int now WITNESSES `\\f x -> f x` (8λ.4 Γ-apply v2 — the 8λ.3 Nothing pin flipped by the widening)", () => {
    // 8λ.3 pinned witnessOf = Nothing here (the honest v1 fence: `f x` could not
    // be spelled/checked). 8λ.4's apply tactic emits `ECall "$dyn:f" [x]`; the
    // check arms carry both dynamic-head spellings, so it self- AND
    // kernel-re-certifies. The goal stays NON-empty as before.
    const fArrow = arrowSet([strSet], intSet);
    const goal = arrowSet([fArrow, strSet], intSet);
    expect(mb(decideEmpty(goal))).toBe("false"); // NON-empty — unchanged
    const c = witClosure(goal);
    expect(c?.__fenelFn).toBe(true);
    expect(mb(contains(goal, c, null))).toBe("true");
  });
});

// ── self-re-check equivalence (every found witness re-certifies) ────────────
describe("synthesize — self-re-check equivalence (TvFound ⇒ kernel-certifiable BY CONSTRUCTION)", () => {
  const goals: [string, SetExpr][] = [
    ["(Int)→Int", arrowSet([intSet], intSet)],
    ["(Int)→Number", arrowSet([intSet], numSet)],
    ["(Int)→(Just Int)", arrowSet([intSet], ctorS("Just", [intSet]))],
    ["(Int,Int)→Int", arrowSet([intSet, intSet], intSet)],
    ["({1})→{1}", arrowSet([enumS(1)], enumS(1))],
  ];
  for (const [name, goal] of goals) {
    test(`every synthesized witness for ${name} passes contains(goal, w) = Just true`, () => {
      const c = witClosure(goal);
      expect(c).not.toBeNull();
      expect(mb(contains(goal, c, null))).toBe("true");
    });
  }
  test("a synthesized (Int)→Int witness is ALSO a member via the subset face (isSubset({w}, goal))", () => {
    // the kernel witness route: {w} ⊆ SeArrow (the singleton-subset membership face).
    const goal = arrowSet([intSet], intSet);
    const c = witClosure(goal);
    const singleton = { $tag: "SeEnum", values: [c] } as unknown as SetExpr;
    expect(mb(isSubset(singleton, goal))).toBe("true");
  });
});

// ── the KERNEL e2e (the brief's Commit 2 — added at 8λ.3-r; the Opus pass only
// exercised contains/isSubset, not the trusted kernel itself) ────────────────
describe("synthesize — the kernel e2e (JInhabited via the SYNTHESIZED witness)", () => {
  const jInhabited = (s: SetExpr) => ({ $tag: "JInhabited", _0: s }) as never;

  test("KERNEL e2e: JInhabited((Int)→Int) with the SYNTHESIZED identity witness ⇒ SolverChecked (a synthesis-ONLY goal — const can't hit, inhabit(ℤ)=Nothing)", () => {
    const goal = arrowSet([intSet], intSet);
    const w = witClosure(goal);
    const vr = verify(jInhabited(goal), decidableSetProof("witness", { left: w }));
    expect(vr.$tag).toBe("Ok");
    if (vr.$tag === "Ok") expect((vr as { _0: { $tag: string } })._0.$tag).toBe("SolverChecked");
  });

  test("KERNEL e2e: JInhabited((Int)→(Just Int)) with the synthesized ctor witness ⇒ SolverChecked (the ctor-return goal the const path can't hit)", () => {
    const goal = arrowSet([intSet], ctorS("Just", [intSet]));
    const w = witClosure(goal);
    const vr = verify(jInhabited(goal), decidableSetProof("witness", { left: w }));
    expect(vr.$tag).toBe("Ok");
    if (vr.$tag === "Ok") expect((vr as { _0: { $tag: string } })._0.$tag).toBe("SolverChecked");
  });

  test("KERNEL e2e: a TAMPERED synthesized body (\\x -> \"abc\" vs (Int)→Int) ⇒ REJECTED", () => {
    const goal = arrowSet([intSet], intSet);
    const w = witClosure(goal);
    const tampered = { ...w, body: "abc" }; // a string constant is definitely ∉ ℤ (exact ELit refutation)
    const vr = verify(jInhabited(goal), decidableSetProof("witness", { left: tampered }));
    expect(vr.$tag).toBe("Err");
    if (vr.$tag === "Err") expect((vr as { _0: { $tag: string } })._0.$tag).toBe("WitnessRejected");
  });

  test("PROVER §6: PropInhabited over an arrow goal routes propose() → verify() end-to-end", () => {
    // the §6 consumer confirmation — the DecidableSet proposer handles the arrow
    // claim (via the inverted-empty exponential-law arm and/or the witness rule)
    // and the kernel accepts what it emits.
    const goal = arrowSet([intSet], ctorS("Just", [intSet]));
    const out = decidableSetProposerNative(propInhabited(goal)) as { $tag: string; _0: unknown };
    expect(out.$tag).toBe("Ok");
    if (out.$tag === "Ok") {
      const vr = verify(propInhabited(goal) as never, out._0 as never);
      expect(vr.$tag).toBe("Ok");
      if (vr.$tag === "Ok") expect((vr as { _0: { $tag: string } })._0.$tag).toBe("SolverChecked");
    }
  });
});

// ── 8λ.3-r — the Fable-5 review pins (nested vacuous / shadow freshening) ────
// The Opus-run 8λ.3 hid two probe-confirmed defects: (1) the arrow-return
// reroute LOST the nested-vacuous witness class — pre-8λ.3 the const path
// wrapped the inner vacuous closure (Just); synthesis had NO vacuous tactic ⇒
// Just→Nothing regression; (2) declared-name reuse across nesting levels
// (`p0`/`p0` — what projections emit) shadowed the outer binding ⇒ the
// cross-level projection `\x -> \y -> x` was unreachable (synVar's pick
// resolved differently under the re-check's head-first scoping).
describe("synthesize — 8λ.3-r review pins (nested vacuous / shadow freshening)", () => {
  // an EMPTY interval [5,1] — decidably empty, but subset-vs-arbitrary-goal UNDECIDED
  // (unlike SeNone, whose ∅⊆X always decides — the class that masked the regression).
  const EI: SetExpr = {
    $tag: "SeInterval",
    interval: {
      lo: { $tag: "Just", value: { value: 5, inclusive: true } },
      hi: { $tag: "Just", value: { value: 1, inclusive: true } },
    },
  } as unknown as SetExpr;
  // an undecidable-membership leaf (an opaque SeWhere predicate).
  const W: SetExpr = { $tag: "SeWhere", pred: { call: ["someUnknownPred", { var: "value" }] } } as unknown as SetExpr;
  const namedArrow = (ps: [string, SetExpr][], ret: SetExpr): SetExpr =>
    ({ $tag: "SeArrow", params: ps.map(([wireName, set], i) => ({ $tag: "SetArrowParam", key: namedFixtureKey(i), wireName, set })), returns: ret } as unknown as SetExpr);

  test("NESTED VACUOUS (the regression pin): (Int)→((∅ᴵ)→W) synthesizes the vacuous inner lambda + re-certifies (was Just pre-8λ.3, Nothing in the Opus 8λ.3)", () => {
    expect(mb(decideEmpty(EI))).toBe("true"); // the interval IS decidably empty
    const goal = arrowSet([intSet], namedArrow([["p0", EI]], W));
    const c = witClosure(goal);
    expect(c?.__fenelFn).toBe(true);
    expect(mb(contains(goal, c, null))).toBe("true");
  });

  test("SHADOW FRESHENING (the incompleteness pin): (String p0)→((Int p0)→String) synthesizes the cross-level projection + re-certifies (was Nothing under raw declared names)", () => {
    const goal = namedArrow([["p0", strSet]], namedArrow([["p0", intSet]], strSet));
    const c = witClosure(goal);
    expect(c?.__fenelFn).toBe(true);
    // the inner param freshened (p0 ⇒ p0'), the body projects the OUTER p0.
    expect(mb(contains(goal, c, null))).toBe("true");
  });

  test("distinct-name control: (String x)→((Int y)→String) synthesizes \\x -> \\y -> x + re-certifies", () => {
    const goal = namedArrow([["x", strSet]], namedArrow([["y", intSet]], strSet));
    const c = witClosure(goal);
    expect(c?.params).toEqual(["x"]);
    expect(mb(contains(goal, c, null))).toBe("true");
  });
});

// ── 8λ.4 Commit B — CASE-SPLIT synthesis (the `case` tactic) ─────────────────
// A non-shadowed Γ binding whose set decomposes to ctor branches splits into an
// EMatch with one arm per branch; every arm body synthesizes under the
// checkArmClassify-narrowed env (the check arm's OWN narrowing — synthesis and
// re-check agree by construction). The witness-egress wrappers apply the
// ledgered marshalPatterns so the closure's match body both RUNS and LIFTS BACK
// (probe 2f: raw Pattern ADT values in pattern position match nothing).
describe("synthesize — the case tactic (8λ.4: match-intro over variant domains)", () => {
  const eitherII = {
    $tag: "SeUnion",
    branches: [ctorS("Left", [intSet]), ctorS("Right", [intSet])],
  } as unknown as SetExpr;

  test("HEADLINE — the eliminator: (Either ℤ ℤ)→ℤ synthesizes `\\e -> case e of Left y -> y | Right z -> z` (base/var/ctor all fail; was Nothing)", () => {
    const goal = arrowSet([eitherII], intSet);
    const c = witClosure(goal);
    expect(c?.__fenelFn).toBe(true);
    // the body is a match over the param with one arm per ctor branch
    const body = c?.body as { match?: unknown[] };
    expect(Array.isArray(body?.match)).toBe(true);
  });

  test("the eliminator witness re-certifies through BOTH faces: contains(goal, w) AND isSubset({w}, goal) = Just true (the kernel witness route — the match body lifts back)", () => {
    const goal = arrowSet([eitherII], intSet);
    const c = witClosure(goal);
    expect(mb(contains(goal, c, null))).toBe("true");
    const singleton = { $tag: "SeEnum", values: [c] } as unknown as SetExpr;
    expect(mb(isSubset(singleton, goal))).toBe("true");
  });

  test("the eliminator witness RUNS correctly (the marshalled match body evaluates — probe 2f's operational check)", () => {
    const goal = arrowSet([eitherII], intSet);
    const c = witClosure(goal);
    const { evaluate } = require("./json-logic") as typeof import("./json-logic");
    const outL = evaluate({ call: [{ var: "w" }, { var: "v" }] } as never, { w: c, v: { $tag: "Left", _0: 41 } }, {} as never);
    const outR = evaluate({ call: [{ var: "w" }, { var: "v" }] } as never, { w: c, v: { $tag: "Right", _0: 42 } }, {} as never);
    expect(outL).toBe(41);
    expect(outR).toBe(42);
  });

  test("single-SeCtor split — the UNWRAP: (Just ℤ)→ℤ synthesizes `\\x -> case x of Just _0 -> _0` + re-certifies", () => {
    const goal = arrowSet([ctorS("Just", [intSet])], intSet);
    const c = witClosure(goal);
    expect(c?.__fenelFn).toBe(true);
    expect(mb(contains(goal, c, null))).toBe("true");
  });

  test("KERNEL e2e: JInhabited((Either ℤ ℤ)→ℤ) with the case-split witness ⇒ SolverChecked (a case-split-ONLY goal)", () => {
    const goal = arrowSet([eitherII], intSet);
    const w = witClosure(goal);
    const vr = verify({ $tag: "JInhabited", _0: goal } as never, decidableSetProof("witness", { left: w }));
    expect(vr.$tag).toBe("Ok");
    if (vr.$tag === "Ok") expect((vr as { _0: { $tag: string } })._0.$tag).toBe("SolverChecked");
  });

  test("KERNEL e2e: a TAMPERED case-split witness (the Right arm body swapped to a string) ⇒ REJECTED", () => {
    const goal = arrowSet([eitherII], intSet);
    const w = witClosure(goal) as { body?: { match?: unknown[] } };
    const match = (w?.body?.match ?? []).slice();
    match[match.length - 1] = "abc"; // the last arm BODY (a string constant ∉ ℤ)
    const tampered = { ...w, body: { match } };
    const vr = verify({ $tag: "JInhabited", _0: goal } as never, decidableSetProof("witness", { left: tampered }));
    expect(vr.$tag).toBe("Err");
    if (vr.$tag === "Err") expect((vr as { _0: { $tag: string } })._0.$tag).toBe("WitnessRejected");
  });

  // APPROVED CHANGE (8λ.6), and a capability GAIN. This used to pin Nothing on
  // the reasoning that "the Nothing-arm has NO ℤ source". That was true of the
  // OLD arm search, which had only Γ to draw on. Under the ordered search an arm
  // body may be a paid internal Point, so the Nothing-arm takes the canonical ℤ
  // point and the whole eliminator becomes a total, kernel-certified function.
  // The derivation is point-DEPENDENT (any internal Point makes it so), which is
  // why it sorts after every base-free candidate — and it still beats the bare
  // reserve, because the reserve is the count-free candidate offered LAST.
  test("(Maybe ℤ)→ℤ now synthesizes the TOTAL eliminator: the Nothing-arm takes the canonical point, the Just-arm projects", () => {
    const maybeI = { $tag: "SeUnion", branches: [ctorS("Nothing", []), ctorS("Just", [intSet])] } as unknown as SetExpr;
    const goal = arrowSet([maybeI], intSet);
    const c = witClosure(goal);
    expect(c?.__fenelFn).toBe(true);
    expect((c?.body as { match?: unknown[] })?.match).toBeDefined(); // an eliminator, not a constant
    expect(mb(contains(goal, c, null))).toBe("true");
    expect(mb(decideEmpty(goal))).not.toBe("true");
  });

  test("fast-path-first guard: (Either ℤ ℤ, ℤ)→ℤ still prefers the VAR projection (the case tactic runs on the var Nothing tail only)", () => {
    // with a direct ℤ in Γ the var tactic fires first — the case tactic must
    // NOT preempt it (fast-path-first, the pre-phase differential).
    const goal = arrowSet([eitherII, intSet], intSet);
    const c = witClosure(goal);
    expect(c?.__fenelFn).toBe(true);
    // the body is the direct projection {var: <second param>}, NOT a match
    expect((c?.body as { var?: string })?.var).toBeDefined();
    expect(mb(contains(goal, c, null))).toBe("true");
  });
});

// ── 8λ.4 Commit C — Γ-APPLY v2 (the `apply` tactic + the dynamic-head arms) ──
// A Γ-bound arrow whose RETURN set decidably ⊆ the goal applies: args
// synthesized depth-1 (base/var only), emission `ECall "$dyn:f" args`. The
// self-re-check sees the `$dyn:` head; the kernel-side lift of the egressed
// witness sees the `$` vehicle (`{call:["$",{var:f},…]}` ⇒ ECall "$" [EVar f,…]
// — probe 1: the round-trip is NOT an identity); check.fenel carries BOTH.
describe("synthesize — the apply tactic (8λ.4: Γ-apply v2 over the $dyn: convention)", () => {
  const fArrow = arrowSet([strSet], intSet);
  const goal = arrowSet([fArrow, strSet], intSet);

  test("HEADLINE — `\f x -> f x`: the witness body is the $-vehicle dynamic call over the arrow param", () => {
    const c = witClosure(goal);
    expect(c?.__fenelFn).toBe(true);
    expect(c?.params?.length).toBe(2);
    // the egressed body: {call:["$", {var:<f>}, {var:<x>}]}
    const body = c?.body as { call?: unknown[] };
    expect(Array.isArray(body?.call)).toBe(true);
    expect(body?.call?.[0]).toBe("$");
  });

  test("the apply witness re-certifies through BOTH faces (contains + the {w}⊆goal singleton route)", () => {
    const c = witClosure(goal);
    expect(mb(contains(goal, c, null))).toBe("true");
    const singleton = { $tag: "SeEnum", values: [c] } as unknown as SetExpr;
    expect(mb(isSubset(singleton, goal))).toBe("true");
  });

  test("KERNEL e2e: JInhabited(((String→Int),String)→Int) with the apply witness ⇒ SolverChecked", () => {
    const w = witClosure(goal);
    const vr = verify({ $tag: "JInhabited", _0: goal } as never, decidableSetProof("witness", { left: w }));
    expect(vr.$tag).toBe("Ok");
    if (vr.$tag === "Ok") expect((vr as { _0: { $tag: string } })._0.$tag).toBe("SolverChecked");
  });

  test("KERNEL e2e: a TAMPERED apply witness (body swapped to a string const ∉ ℤ) ⇒ REJECTED", () => {
    const w = witClosure(goal);
    const tampered = { ...w, body: "abc" };
    const vr = verify({ $tag: "JInhabited", _0: goal } as never, decidableSetProof("witness", { left: tampered }));
    expect(vr.$tag).toBe("Err");
    if (vr.$tag === "Err") expect((vr as { _0: { $tag: string } })._0.$tag).toBe("WitnessRejected");
  });

  // APPROVED CHANGE (8λ.6). The DEPTH-1 fence itself is unchanged and still
  // pinned — what changed is that a goal the fence blocks is no longer Nothing,
  // because the count-free bare reserve now offers the ground return's canonical
  // point after the paid window. So the assertion moves from "no witness" to the
  // thing the fence is actually about: the witness is NOT the nested chain.
  test("DEPTH-1 honest fence: a goal needing a NESTED apply chain `f (g x)` is never given one — the reserve answers instead", () => {
    // f: (Wombat)→Int, g: (String)→Wombat, x: String — ℤ reachable only via
    // f(g(x)) (Wombat = an unknown atom: no base witness, no Γ var of that
    // type; x:String ⊄ ℤ kills the direct projection). Apply arguments range
    // over `Point(paramSet)` plus eligible live Vars and nothing else, so no
    // ticket can ever spell `g x` in f's Wombat slot; and Wombat has no point,
    // so that Apply ticket realizes as a charged miss.
    const wombat = { $tag: "SeRef", handle: "Wombat" } as unknown as SetExpr;
    const f2 = arrowSet([wombat], intSet);
    const g2 = arrowSet([strSet], wombat);
    const chainGoal = arrowSet([f2, g2, strSet], intSet);
    const c = witClosure(chainGoal);
    expect(c?.__fenelFn).toBe(true);
    expect(c?.body).toBe(0); // the reserve's canonical ℤ point, NOT a call
    expect((c?.body as { call?: unknown })?.call).toBeUndefined();
    expect(mb(contains(chainGoal, c, null))).toBe("true");
  });

  test("fast-path-first guard: (Int, (String→Int)) → Int still prefers the VAR projection (apply runs on the var/case Nothing tail)", () => {
    const g2 = arrowSet([intSet, fArrow], intSet);
    const c = witClosure(g2);
    expect(c?.__fenelFn).toBe(true);
    expect((c?.body as { var?: string })?.var).toBeDefined();
    expect(mb(contains(g2, c, null))).toBe("true");
  });
});

// ── 8λ.4 Commit D — the LAW-CONSTRAINED filter (synthesizeWithLaw) ───────────
// synthesize → on TvFound w, evaluate `lawPred w` (probe 5's route: direct
// param application — the var-callee invokeCallable path, no new ctx native) →
// truthy ⇒ TvFound, falsy ⇒ TvUnknown "law-rejected". Single-candidate v1;
// multi-candidate enumeration is the flagged v2. The editor's future
// "suggest a LAWFUL body" consumes this face.
describe("synthesize — synthesizeWithLaw (8λ.4: the law-constrained filter)", () => {
  const { dispatchEngineBodyWithDeciderCtx } = require("./engine-bodies-dispatch") as typeof import("./engine-bodies-dispatch");
  const swl = (fuel: number, goal: SetExpr, pred: unknown) =>
    dispatchEngineBodyWithDeciderCtx("engine:synthesizeWithLaw", [fuel, goal, pred]) as {
      $tag: string; value?: unknown; _0?: unknown; reason?: string;
    };
  // \f -> f 1 == 1 — the identity law (satisfied by \x -> x, refuted by consts ≠ 1)
  const idLaw = { __fenelFn: true, params: ["f"], body: { "==": [{ call: [{ var: "f" }, 1] }, 1] }, closure: {} };
  // \f -> f 1 == 2 — a law the identity witness violates
  const antiLaw = { __fenelFn: true, params: ["f"], body: { "==": [{ call: [{ var: "f" }, 1] }, 2] }, closure: {} };

  test("law ACCEPTS: (Int)→Int synthesizes the identity, `\f -> f 1 == 1` passes ⇒ TvFound", () => {
    const goal = arrowSet([intSet], intSet);
    const out = swl(8, goal, idLaw);
    expect(out.$tag).toBe("TvFound");
    const w = (out.value ?? out._0) as { __fenelFn?: boolean };
    expect(w?.__fenelFn).toBe(true);
    expect(mb(contains(goal, w, null))).toBe("true"); // the passed-through witness still kernel-re-certifies
  });

  test("law REJECTS: the identity violates `\f -> f 1 == 2` ⇒ TvUnknown \"law-rejected\" (honest — not TvEmpty)", () => {
    const goal = arrowSet([intSet], intSet);
    const out = swl(8, goal, antiLaw);
    expect(out.$tag).toBe("TvUnknown");
    expect(out.reason ?? out._0).toBe("law-rejected");
  });

  test("GROUND goal: {5} with `\v -> v == 5` ⇒ TvFound 5; with `\v -> v == 6` ⇒ law-rejected", () => {
    const eqLaw = (n: number) => ({ __fenelFn: true, params: ["v"], body: { "==": [{ var: "v" }, n] }, closure: {} });
    const ok = swl(8, enumS(5), eqLaw(5));
    expect(ok.$tag).toBe("TvFound");
    expect(ok.value ?? ok._0).toBe(5);
    const no = swl(8, enumS(5), eqLaw(6));
    expect(no.$tag).toBe("TvUnknown");
  });

  test("TvEmpty passes through UNTOUCHED: a decidably-empty goal ⇒ TvEmpty regardless of the law", () => {
    const goal = arrowSet([enumS(1)], NONE);
    const out = swl(8, goal, idLaw);
    expect(out.$tag).toBe("TvEmpty");
  });

  test("TvUnknown passes through UNTOUCHED: an unsynthesizable non-empty goal keeps its own reason", () => {
    const wombat = { $tag: "SeRef", handle: "Wombat" } as unknown as SetExpr;
    const out = swl(8, wombat, idLaw);
    expect(out.$tag).toBe("TvUnknown");
    expect(out.reason ?? out._0).not.toBe("law-rejected");
  });
});

// ── 8λ.5 — fix-intro: STRUCTURAL RECURSION as a tactic ──────────────────────
// The final λ-rung. The DIRECT face `synthesizeFixArrow` (dispatchedSynthesizeFix
// — the marshalling wrapper) FORCES the recursion-shaped derivation: a
// recursion-marked Γ entry + the case split on the first μ-decomposable param,
// recursive-call-first arms; `checkExprFix` (the chk.fix rule) self-re-checks;
// the emitted witness is a FIX-MARKED closure ({…, fix}) that (a) kernel-
// re-certifies through arrowClosureContains and (b) RUNS through the
// evaluator's invoke self-bind. Fixtures hand-KEYED (the mu-park fld() style —
// the fi-P3 typeToSetExpr(List…) keyless degrade is a different, known-RED
// class). witnessOf's ordinary route is byte-preserved (fix rides only the
// plain search's Nothing tail — pinned below).
describe("synthesize — fix-intro (8λ.5: recursion synthesis, the direct face)", () => {
  const { dispatchedSynthesizeFix } = require("./engine-bodies-dispatch") as typeof import("./engine-bodies-dispatch");
  const FIX_FIELD_IDS: Record<string, string> = {
    head: "66000000-0000-4000-8000-000000000001",
    tail: "66000000-0000-4000-8000-000000000002",
  };
  const fld = (wireName: string, set: SetExpr) => ({
    $tag: "SetCtorField",
    key: { $tag: "NamedField", ref: { $ref: FIX_FIELD_IDS[wireName] } },
    wireName,
    set,
  });
  const refS = (h: string): SetExpr => ({ $tag: "SeRef", handle: h } as unknown as SetExpr);
  const muS = (v: string, body: SetExpr): SetExpr => ({ $tag: "SeMu", var: v, body } as unknown as SetExpr);
  const uni = (...branches: SetExpr[]): SetExpr => ({ $tag: "SeUnion", branches } as unknown as SetExpr);
  const muList = muS("X", uni(
    ctorS("Nil", []),
    { $tag: "SeCtor", ctor: "Cons", fields: [fld("head", intSet), fld("tail", refS("X"))] } as unknown as SetExpr,
  ));
  const muNat = muS("N", uni(
    ctorS("Z", []),
    ctorS("S", [refS("N")]),
  ));
  type Tv = { $tag: string; value?: unknown; _0?: unknown; reason?: string };
  const sfx = (fuel: number, goal: SetExpr) => dispatchedSynthesizeFix(fuel, goal) as Tv;
  const tvW = (out: Tv): Closure | null =>
    out.$tag === "TvFound" ? ((out.value ?? out._0) as Closure) : null;

  test("HEADLINE — the FOLD shape: (Int, List Int)→Int synthesizes a genuinely RECURSIVE witness (fix-marked, match body, a $-dyn self-call in the Cons arm)", () => {
    const goal = arrowSet([intSet, muList], intSet);
    const out = sfx(8, goal);
    expect(out.$tag).toBe("TvFound");
    const w = tvW(out) as (Closure & { fix?: string }) | null;
    expect(w?.__fenelFn).toBe(true);
    expect(w?.params?.length).toBe(2);
    expect(typeof w?.fix).toBe("string"); // the recursion mark rides the envelope
    const body = w?.body as { match?: unknown[] };
    expect(Array.isArray(body?.match)).toBe(true); // the forced case split
    expect(JSON.stringify(body)).toContain(`{"var":"${w?.fix}"}`); // a REAL self-call in some arm
  });

  test("HEADLINE — the fold witness kernel-re-certifies (contains + the {w}⊆goal singleton face) AND JInhabited ⇒ SolverChecked e2e", () => {
    const goal = arrowSet([intSet, muList], intSet);
    const w = tvW(sfx(8, goal));
    expect(mb(contains(goal, w, null))).toBe("true");
    const singleton = { $tag: "SeEnum", values: [w] } as unknown as SetExpr;
    expect(mb(isSubset(singleton, goal))).toBe("true");
    const vr = verify({ $tag: "JInhabited", _0: goal } as never, decidableSetProof("witness", { left: w }));
    expect(vr.$tag).toBe("Ok");
    if (vr.$tag === "Ok") expect((vr as { _0: { $tag: string } })._0.$tag).toBe("SolverChecked");
  });

  // KNOWN-FAILING, and NOT a type-substrate P1(a) regression — it fails IDENTICALLY
  // on the pre-P1(a) deciders (measured 2026-08-16: `Expected 100, Received 0` both
  // sides). It is a WITNESS-QUALITY degradation from 8-lambda.6's preference-ordered
  // candidate search, and `test.failing` records it rather than re-pinning the
  // numbers, because re-pinning would silently bless the degradation.
  //
  // The witness this goal now yields, dumped verbatim:
  //   fix f. \_0 _1 -> case _1 of Nil -> 0 | Cons -> f 0 _1.tail
  // It is type-correct, fix-marked, genuinely recursive, terminating and
  // kernel-re-certified — the sibling `kernel-re-certifies` test still passes — but
  // it discards BOTH the accumulator and the head, so it is the constant-0 recursor,
  // not the fold this test's title describes. Measured: apply(acc=100, Nil) = 0 and
  // apply(acc=100, [7,9]) = 0, where 8-lambda.5 gave 100 and 9.
  //
  // Worth stating plainly because it cuts against 8-lambda.6's headline: that phase
  // made synthesis return INFORMATIVE terms where it had returned constants, and on
  // THIS goal it did the reverse. Revisit with the preference ordering, not here.
  test.failing("HEADLINE — the fold witness RUNS (the evaluator's invoke self-bind): the recursion terminates and folds to the last head / the acc default", () => {
    const goal = arrowSet([intSet, muList], intSet);
    const w = tvW(sfx(8, goal));
    const { evaluate } = require("./json-logic") as typeof import("./json-logic");
    const nil = { $tag: "Nil" };
    const list79 = { $tag: "Cons", head: 7, tail: { $tag: "Cons", head: 9, tail: nil } };
    const call = { call: [{ var: "w" }, { var: "acc" }, { var: "v" }] } as never;
    // \acc xs -> case xs of Nil -> acc | Cons -> f xs.head xs.tail
    expect(evaluate(call, { w, acc: 100, v: nil }, {} as never)).toBe(100);
    expect(evaluate(call, { w, acc: 100, v: list79 }, {} as never)).toBe(9);
  });

  test("HEADLINE — the Peano structural recursor: (ℕ)→ℕ synthesizes fix f. \\n -> case n of Z -> Z | S -> f n._0 (kernel-re-certified + runs to Z)", () => {
    const goal = arrowSet([muNat], muNat);
    const out = sfx(8, goal);
    expect(out.$tag).toBe("TvFound");
    const w = tvW(out) as (Closure & { fix?: string }) | null;
    expect(typeof w?.fix).toBe("string");
    expect(mb(contains(goal, w, null))).toBe("true");
    const { evaluate } = require("./json-logic") as typeof import("./json-logic");
    const two = { $tag: "S", _0: { $tag: "S", _0: { $tag: "Z" } } };
    const outV = evaluate({ call: [{ var: "w" }, { var: "v" }] } as never, { w, v: two }, {} as never) as { $tag?: string };
    expect(outV?.$tag).toBe("Z"); // the recursor bottoms out at Z
  });

  test("NEGATIVE — a NON-POSITIVE μ param (μX.¬X) ⇒ no fix-intro (TvUnknown; the goal is NOT decidably empty either — the honest bars)", () => {
    const badMu = muS("X", { $tag: "SeComplement", inner: refS("X") } as unknown as SetExpr);
    const out = sfx(8, arrowSet([badMu], enumS(1)));
    expect(out.$tag).toBe("TvUnknown");
  });

  test("NEGATIVE — a DESCENT-VIOLATION candidate is rejected by the kernel bar (the fix-marked loop body ⇒ WitnessRejected — the proposer never emits it; the bar catches it anyway)", () => {
    const goal = arrowSet([intSet, muList], intSet);
    const w = tvW(sfx(8, goal)) as (Closure & { fix?: string }) | null;
    // tamper: replace the body with the whole-binder self-call f acc xs (no descent)
    const loop = { ...w, body: { call: [{ var: w?.fix }, { var: "acc" }, { var: "xs" }] } };
    const vr = verify({ $tag: "JInhabited", _0: goal } as never, decidableSetProof("witness", { left: loop }));
    expect(vr.$tag).toBe("Err");
    if (vr.$tag === "Err") expect((vr as { _0: { $tag: string } })._0.$tag).toBe("WitnessRejected");
  });

  // APPROVED CHANGE (8λ.6). Both of these were "BYTE-PRESERVATION" pins on the
  // const-first probe, and §2c of the locked contract retires that guarantee by
  // name: global/compositional byte preservation does not survive a later
  // widening of a recursive dependency. What survives is narrower and is what
  // these two now pin — FIX NEVER PRE-EMPTS. The ordinary ordered search answers
  // first, and the returned witness carries no `fix` marker.
  test("FIX NEVER PRE-EMPTS — a μ-param goal with an inhabitable return is answered by the ORDINARY search, unmarked (was the const fast path)", () => {
    const goal = arrowSet([muList], enumS(1));
    const c = witClosure(goal);
    expect(c?.__fenelFn).toBe(true);
    expect((c as { fix?: unknown })?.fix).toBeUndefined(); // the fixed-point tail did not run
    expect(mb(contains(goal, c, null))).toBe("true");
  });

  test("⟦(List Int)→Int⟧ now WITNESSES (was Nothing): the Cons arm projects the head, the Nil arm takes the canonical point — and fix still never pre-empts", () => {
    const goal = arrowSet([muList], intSet);
    const c = witClosure(goal);
    expect(c?.__fenelFn).toBe(true);
    expect((c as { fix?: unknown })?.fix).toBeUndefined();
    expect(mb(contains(goal, c, null))).toBe("true");
  });

  test("synthesizeWithLaw composes over ground goals unchanged (regression guard on the synthesize entry's new tail)", () => {
    const { dispatchEngineBodyWithDeciderCtx } = require("./engine-bodies-dispatch") as typeof import("./engine-bodies-dispatch");
    const swlTop = (fuel: number, goal: SetExpr, pred: unknown) =>
      dispatchEngineBodyWithDeciderCtx("engine:synthesizeWithLaw", [fuel, goal, pred]) as Tv;
    const out = swlTop(8, enumS(5), { __fenelFn: true, params: ["v"], body: { "==": [{ var: "v" }, 5] }, closure: {} });
    expect(out.$tag).toBe("TvFound");
  });

  // ── the GPT-5.6-Sol review pins (2026-07-17): the two calling-convention
  // seams between the CHECK judgment and the evaluator, closed at the ROOT ──
  test("REVIEW pin — the `$` application head EXECUTES (context-free): the kernel-lift spelling runs, incl. a $-spelled recursive fix closure (retro-closes the 8λ.4 apply-witness execution memo)", () => {
    const { evaluate } = require("./json-logic") as typeof import("./json-logic");
    const g = { __fenelFn: true, params: ["n"], body: { var: "n" }, closure: {} };
    expect(evaluate({ call: ["$", { var: "g" }, 7] } as never, { g }, {} as never)).toBe(7);
    const w = {
      __fenelFn: true,
      params: ["xs"],
      body: { match: [{ var: "xs" }, { $tag: "Nil" }, 0, { $tag: "Cons" }, { call: ["$", { var: "f" }, { var: "xs.tail" }] }] },
      closure: {},
      fix: "f",
    };
    const l = { $tag: "Cons", head: 1, tail: { $tag: "Nil" } };
    expect(evaluate({ call: [{ var: "w" }, { var: "v" }] } as never, { w, v: l }, {} as never)).toBe(0);
  });

  test("REVIEW pin — a `$`-keyed record argument is a WIRE VALUE, never named-args: a param literally named \"$tag\" no longer corrupts a {$tag:…} argument", () => {
    const { evaluate } = require("./json-logic") as typeof import("./json-logic");
    const h = { __fenelFn: true, params: ["$tag"], body: { var: "$tag" }, closure: {} };
    const out = evaluate({ call: [{ var: "h" }, { var: "v" }] } as never, { h, v: { $tag: "Nil" } }, {} as never);
    expect(out).toEqual({ $tag: "Nil" });
  });
});
