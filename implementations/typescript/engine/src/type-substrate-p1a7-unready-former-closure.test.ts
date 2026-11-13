// ---------------------------------------------------------------------------
// type-substrate P1(a.7) — unready-former definite closure.
//
// The phase retires `t.sub.composite-toplevel-ungated` (UNSOUND-KNOWN): the
// TOP-LEVEL `ssMap` / `arrowSub` / `tupleSub` / `ssApp` arms and the tagged
// carrier recursion emitted structural definites with no readiness gate at all.
//
// Post-repair dispositions (all sound mode; picker mode is untouched):
//   tuple  POSITIVES ONLY  (`ttKeepTrue` at the ssCompositeSound call site)
//   arrow  Nothing, both polarities
//   map    Nothing, both polarities
//   app    Nothing, both polarities (picker branch byte-identical)
//   empty(arrow)  the two `Just false` clauses only
//   + one refute-only Tri→Bool collapse at `validationFunctionFact`
//
// Every entry value in a comment below was MEASURED at `7a84f06b` before any
// production edit and is frozen verbatim in
// `workstreams/type-substrate/notes/phase-1a7-unready-former-definite-closure.md`.
// Pins marked DISCRIMINATES fail if their fence is reverted in isolation; the
// revert runs are recorded in that note.
// ---------------------------------------------------------------------------

import { describe, expect, setDefaultTimeout, test } from "bun:test";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import {
  dispatchedEmpty,
  dispatchedSubset,
  universeTypeSubsumes,
} from "./engine-bodies-dispatch";
import { isSubtype } from "./set-algebra";
import { Maybe, Vec } from "./type-foundation";
import { validate } from "./validate";
import type { FenelType } from "./types";

setDefaultTimeout(600_000);

type Tri = { $tag: "Just"; _0: boolean } | { $tag: "Nothing" };
const JT: Tri = { $tag: "Just", _0: true };
const JF: Tri = { $tag: "Just", _0: false };
const NO: Tri = { $tag: "Nothing" };

const Num = { $ref: "Number" };
const Int = { $ref: "Int" };
const Nat = { $ref: "Nat" };
const Str = { $ref: "String" };
const Void = { $void: true };
const unit = { $record: { fields: [] } };

const pf = (index: number, type: unknown) => ({
  name: `_${index}`,
  key: { $tag: "PositionalField" as const, index },
  type,
});
const recP = (types: unknown[]) => ({
  $record: { fields: types.map((t, i) => pf(i, t)) },
});
const tup = (...ts: unknown[]) => ({ $tuple: ts });
const arrow = (ps: unknown[], r: unknown) => ({
  $arrow: { params: ps.map((t, i) => pf(i, t)), returns: r },
});
const variant = (names: string[]) => ({
  $variant: { cases: names.map((n) => ({ name: n, fields: [] })) },
});
const map = (v: unknown) => ({ $map: { values: v } });
const app = (head: string, ...args: unknown[]) => ({ $el: { call: [head, ...args] } });
const notT = (t: unknown) => ({ $complement: t });
const tagged = (value: unknown) => ({
  $tagged: { value, phantom: { $refined: { base: Str, set: { $enum: ["Bot"] } } } },
});

const sub = (a: unknown, b: unknown) => dispatchedSubset(a, b) as unknown as Tri;
const emp = (t: unknown) => dispatchedEmpty(t) as unknown as Tri;
const pick = (a: unknown, b: unknown) => universeTypeSubsumes(a, b) as unknown as boolean;

// ---------------------------------------------------------------------------
// §1 — the seven measured obligations, at their post values.
// ---------------------------------------------------------------------------

describe("P1(a.7) §1 — the measured obligations", () => {
  test("O1: the tuple slot negative the retired row cited is ALREADY Nothing at entry", () => {
    // ENTRY = Nothing, POST = Nothing. The `t.sub.composite-toplevel-ungated`
    // row cited `tuple[Number] ⊆ tuple[Int] = Just false` as its tuple witness.
    // That measurement went STALE inside the same phase that wrote it: P1(a.6)
    // made `ssNamedArm` positive-only, so the ITEM verdict `Number ⊆ Int` is
    // `Nothing` and `mAnd` propagates it. The live tuple defect is the
    // have-emptiness hole pinned below, not this cell. Pinned so the stale
    // witness can never be cited again as evidence of a tuple refutation.
    expect(sub(tup(Num), tup(Int))).toEqual(NO);
    expect(sub(Num, Int)).toEqual(NO);
    // The forward direction is a RETAINED positive (entitled named hierarchy).
    expect(sub(tup(Int), tup(Num))).toEqual(JT);
  });

  test("O2: the map partial-dictionary false positive is retired", () => {
    // ENTRY: Vec 3 ⊆ Vec 4 = Just true (the partial-dictionary reading) while
    // `validationValidateMap`'s finite arm accepts a length-3 array only on the
    // have side; Vec 4 ⊆ Vec 3 = Just false. POST: both Nothing.
    expect(sub(Vec(Num as never, 3), Vec(Num as never, 4))).toEqual(NO);
    expect(sub(Vec(Num as never, 4), Vec(Num as never, 3))).toEqual(NO);
  });

  test("O3: both arrow refutation shapes are retired", () => {
    // ENTRY: both Just false. The contravariant-param form goes through
    // `arrowSubVariance`; the arity form through `ttArrowArityTail`.
    expect(sub(arrow([recP([Num])], Num), arrow([unit], Num))).toEqual(NO);
    expect(sub(arrow([Num], Num), arrow([Num, Num], Num))).toEqual(NO);
    // The contravariant param pair is STILL definite at the record arm, so the
    // loss is the arrow LIFT, not the underlying leaf.
    expect(sub(unit, recP([Num]))).toEqual(JF);
  });

  test("O4/O5: the ssApp head mismatch and the args-fold negative are retired", () => {
    // ENTRY: both Just false.
    expect(sub(app("F", Nat), app("G", Int))).toEqual(NO);
    expect(sub(app("F", Maybe(Int as never)), app("F", variant(["A", "B"])))).toEqual(NO);
    // O5's ELEMENT pair is still definite — it is the exact-Maybe-have vs
    // ordinary-want null refutation, plan-ready post-P1(a.6). Only the app lift
    // is fenced, so this pin is the unconditional anchor the brief asked for.
    expect(sub(Maybe(Int as never), variant(["A", "B"]))).toEqual(JF);
  });

  test("O6: the exponential-law EMPTY leg is fenced; the inhabited clauses stand", () => {
    // ENTRY: empty((Int)→Void) = Just true. Conceptually derivable and FALSE at
    // validation's implemented arrow arm, which accepts "" for every arrow type.
    expect(emp(arrow([Int], Void))).toEqual(NO);
    expect(emp(arrow([unit], Void))).toEqual(NO);
    // Both `Just false` clauses are RETAINED (§7.4 retained-positive pins).
    expect(emp(arrow([Num], unit))).toEqual(JF); // inhabited return ⇒ constants
    expect(emp(arrow([Void], Num))).toEqual(JF); // empty param ⇒ vacuous fn
    expect(emp(arrow([{ $ref: "Bot" }], Void))).toEqual(NO); // unchanged residue
  });

  test("O7: the vacuity short-circuit that killed two designs is retired", () => {
    // ENTRY: Just true, via `someParamEmptyW`. Witness `"std:negate"` (a
    // REGISTERED unary) validates against the have and is refused against the
    // 2-param want at validation's non-circular `paramCount` axis, so the
    // `Just true` was face-refuted.
    expect(sub(arrow([Num], Num), arrow([Void, Num], Num))).toEqual(NO);
  });
});

// ---------------------------------------------------------------------------
// The phase's own finding: tuple negatives were ungated for have-emptiness.
// ---------------------------------------------------------------------------

describe("P1(a.7) — the tuple have-emptiness hole (a MEASURED false definite)", () => {
  test("DISCRIMINATES: a Void-factor tuple no longer refutes", () => {
    // ENTRY: both Just false, while ⟦have⟧ = ∅. `subsetW`'s only empty-have
    // short-circuits are SYNTACTIC (`tsIsVoid`, `isBottomMu`), so a provably
    // empty tuple reached `tupleSub`, whose arity refutations carry no
    // have-nonemptiness gate — unlike EVERY sibling product former
    // (`recordSubGated`'s `anyEmpty` rescue, `variantCaseSub`'s inhabitance
    // gate, `arrowSub`'s `nonemptyKnown`). `∅ ⊆ anything` is true conceptually
    // AND at the implemented `decomposeMatchesTuple` face.
    expect(sub(tup(Void, Num), tup(Void))).toEqual(NO);
    expect(sub(tup(Void), tup(Void, Num))).toEqual(NO);
    // The have really is empty — this is the evidence, not an assumption.
    expect(emp(tup(Void, Num))).toEqual(JT);
  });

  test("DISCRIMINATES: the slot twin of the same hole", () => {
    // ENTRY: Just false. Item 0 is Just true (Void ⊆ Void), item 1 is the
    // record missing-required-field Just false, and `mAnd` lifted it over an
    // empty have.
    expect(sub(tup(Void, recP([Num])), tup(Void, recP([Num, Str])))).toEqual(NO);
    // The ITEM verdict is untouched: the record arm keeps its gated refutation.
    expect(sub(recP([Num]), recP([Num, Str]))).toEqual(JF);
  });

  test("the tuple ARITY negative is a PRICED loss, not an unentitled one", () => {
    // ENTRY: Just false. Unlike the two above, this have is NOT empty, and
    // `decomposeMatchesTuple` genuinely implements the arity axis
    // (`eq (length xs) (length types)`, decompose.fenel:149) — so a
    // have-nonemptiness-GATED arity rule would be entitled. That rule is a NEW
    // decider rule with its own row and review, and the `Just true` half of a
    // full vacuity rescue would MINT a definite, so it is out of phase.
    // Recorded in `t.sub.tuple` as the named recovery.
    expect(sub(tup(Num, Str), tup(Num))).toEqual(NO);
    expect(emp(tup(Num, Str))).toEqual(JF); // decidably NONempty — the gate input
  });
});

// ---------------------------------------------------------------------------
// Retained positives (§7.4) and priced degrades (§7.3).
// ---------------------------------------------------------------------------

describe("P1(a.7) — retained tuple positives", () => {
  test("tuple reflexivity and the entitled item lift survive", () => {
    expect(sub(tup(Num, Str), tup(Num, Str))).toEqual(JT);
    expect(sub(tup(Int), tup(Num))).toEqual(JT);
    expect(sub(tup(), tup())).toEqual(JT);
  });

  test("a tuple positive over formers matchesShape ACTUALLY implements", () => {
    // `decomposeMatchesUnit` and the `TtVoid -> false` arm are implemented, so
    // these lifts are not riding an accept-all leaf.
    expect(sub(tup(unit), tup(unit))).toEqual(JT);
    expect(sub(tup(Void), tup(Num))).toEqual(JT); // ∅ item ⇒ item-wise Just true
  });
});

describe("P1(a.7) — priced degrades (pin the losses)", () => {
  test("arrow reflexivity is a priced loss with ONE named recovery", () => {
    // ENTRY: Just true. The recovery is the `sub.refl.deepeq` Tt twin — a
    // deep-equality reflexivity rule, which MINTS a definite and is therefore
    // out of this phase by its stop rule. Do not "fix" this by reviving
    // `arrowSub` without re-litigating the §2.1 entitlement.
    expect(sub(arrow([Num], Num), arrow([Num], Num))).toEqual(NO);
  });

  test("map reflexivity and the Vec equality proof are priced losses", () => {
    // ENTRY: map<Number> ⊆ map<Number> = Just true; and
    // `vec-map-unification.test.ts` proved `refined(List Int, length==3)` and
    // `Vec 3 Int` mutually-subset. Same `sub.refl.deepeq` recovery, plus a
    // second candidate specific to maps: a key-EQUALITY-gated positive (the
    // `conformMap` rule), which is reading-invariant where `ssMap` is not.
    expect(sub(map(Num), map(Num))).toEqual(NO);
    expect(sub(Vec(Num as never, 3), Vec(Num as never, 3))).toEqual(NO);
  });

  test("the t.sub.arrow.flatten cross-face pin degrades on the Tt face only", () => {
    // ENTRY: both Just true (the floor-kernel Phase-2 STOP-clause fix). The
    // Se* twin in `tcb-recheck.test.ts` is UNTOUCHED and still proves them —
    // that suite pins the cross-face divergence explicitly.
    expect(sub(arrow([Num, Num], Num), arrow([Num], arrow([Num], Num)))).toEqual(NO);
    expect(sub(arrow([Num], arrow([Num], Num)), arrow([Num, Num], Num))).toEqual(NO);
  });

  test("the ∅-arrow gate and app reflexivity are priced losses", () => {
    // ENTRY: both Just true. App reflexivity was a §7.4 retained-positive in
    // the brief; the design review moved it here, because `ssApp`'s positive
    // rests on an unchecked monotonicity premise over an OPEN head domain.
    expect(sub(arrow([Num], Void), arrow([Num], Num))).toEqual(NO);
    expect(sub(app("F", Int), app("F", Int))).toEqual(NO);
    expect(sub(app("F", Nat), app("F", Int))).toEqual(NO);
  });

  test("the emptiness cascade through a nested arrow param degrades, never flips", () => {
    // ENTRY: empty(((Int)→Void)→Void) = Just false, on a vacuity proof that
    // rode the now-fenced inner emptiness. POST Nothing — a withdrawal, not a
    // flip. The independent inhabited-return clause is unaffected.
    expect(emp(arrow([arrow([Int], Void)], Void))).toEqual(NO);
    // type-substrate P1(a.8): the second cell was `Just false` on an
    // INDEPENDENT inhabited-return clause, and it is now `Nothing` because
    // `emptyArrow` is FACTOR-GATED — an arrow-typed PARAM is not plan-ready
    // (`ttValidationPlanReady(TtArrow)` is unconditionally false), and
    // validation's plan preflight audits an arrow's params before
    // `validationValidateArrow` is reached. Ledger `t.emp.arrow`, amended.
    // The clause itself is retained and is pinned on a plannable arrow in
    // `type-substrate-p1a8-…test.ts` §3b.
    expect(emp(arrow([arrow([Int], Void)], Num))).toEqual(NO);
    // The record/variant vacuity rescues were ALREADY dead for arrow-bearing
    // products (`ttValidationPlanReady` is unconditionally false for TtArrow),
    // so this fence moved nothing there.
    expect(emp(recP([arrow([Int], Void)]))).toEqual(NO);
  });

  test("the non-arrow emptiness walk is untouched", () => {
    expect(emp(map(Num))).toEqual(JF);
    expect(emp(tup(Num, Void))).toEqual(JT);
    expect(emp(tup(unit, unit))).toEqual(JF);
  });
});

// ---------------------------------------------------------------------------
// §7.5 — the laundromat pin.
// ---------------------------------------------------------------------------

describe("P1(a.7) §7.5 — the laundromat", () => {
  test("DISCRIMINATES: tuple reflexivity does not launder a revived arrow verdict", () => {
    // Moot by construction while arrow abstains (the item recursion reaches the
    // arrow arm and `mAnd`/`ttKeepTrue` propagate `Nothing` upward), but it
    // fails loudly if anyone re-adds the `someParamEmptyW` vacuity
    // short-circuit or revives the arrow arm without re-litigating §2.1.
    // Tuple reflexivity survives only when EVERY item decides positively, so
    // `tuple[arrow-anything]` reflexivity is Nothing until the deepEq twin.
    expect(sub(tup(arrow([Num], Num)), tup(arrow([Void, Num], Num)))).toEqual(NO);
    expect(sub(tup(arrow([Num], Num)), tup(arrow([Num], Num)))).toEqual(NO);
  });
});

// ---------------------------------------------------------------------------
// §7.7 — the tagged transit (the exposure is closed TRANSITIVELY).
// ---------------------------------------------------------------------------

describe("P1(a.7) §7.7 — tagged carrier recursion", () => {
  test("the tagged arm emits no definite of its own; it inherits its value slot", () => {
    // ENTRY: Just false / Just true / Just true.
    expect(sub(tagged(tup(Num, Str)), tagged(tup(Num)))).toEqual(NO);
    expect(sub(tagged(arrow([Num], Num)), tagged(arrow([Num], Num)))).toEqual(NO);
    // type-substrate P1(a.8): this cell used to read `Just true` — "a tagged
    // tuple over an ENTITLED item keeps its positive" — and it is now `Nothing`.
    // The P1(a.7) claim it carried is SUPERSEDED, not falsified: the arm no
    // longer forwards ANYTHING in sound mode, because the two live faces
    // disagree about what a `$tagged` denotes (validation reads UUID syntax
    // only; `matchesShape` recurses into the value slot). Ledger `t.sub.tagged`,
    // MISSING as of P1(a.8); recovery rides `sub.refl.deepeq` plus the brand
    // ruling. The UNDERLYING item verdict is untouched and still positive,
    // which is the evidence this pin exists to carry.
    expect(sub(tagged(tup(Int)), tagged(tup(Num)))).toEqual(NO);
    expect(sub(tup(Int), tup(Num))).toEqual(JT);
  });
});

// ---------------------------------------------------------------------------
// §6 / §7.6 — picker insulation and the accounted transit cells.
// ---------------------------------------------------------------------------

type TransitRow = {
  readonly label: string;
  readonly have: unknown;
  readonly want: unknown;
  readonly sound: Tri;
  readonly directPicker: boolean;
  readonly transitPicker: boolean;
  readonly entryTransitPicker: boolean;
};

const TRANSIT: readonly TransitRow[] = [
  // Retired NEGATIVES — the picker's ¬¬ transit gains an accept.
  { label: "tuple arity", have: tup(Num, Str), want: tup(Num), sound: NO, directPicker: true, transitPicker: true, entryTransitPicker: false },
  { label: "tuple arity, empty have", have: tup(Void, Num), want: tup(Void), sound: NO, directPicker: true, transitPicker: true, entryTransitPicker: false },
  { label: "tuple slot, empty have", have: tup(Void, recP([Num])), want: tup(Void, recP([Num, Str])), sound: NO, directPicker: true, transitPicker: true, entryTransitPicker: false },
  { label: "arrow arity", have: arrow([Num], Num), want: arrow([Num, Num], Num), sound: NO, directPicker: true, transitPicker: true, entryTransitPicker: false },
  { label: "map wider keys", have: Vec(Num as never, 4), want: Vec(Num as never, 3), sound: NO, directPicker: true, transitPicker: true, entryTransitPicker: false },
  { label: "app head mismatch", have: app("F", Nat), want: app("G", Int), sound: NO, directPicker: false, transitPicker: true, entryTransitPicker: false },
  // Retired POSITIVES — the picker does not move at all (`Nothing → true`).
  { label: "arrow reflexivity", have: arrow([Num], Num), want: arrow([Num], Num), sound: NO, directPicker: true, transitPicker: true, entryTransitPicker: true },
  { label: "map narrower keys", have: Vec(Num as never, 3), want: Vec(Num as never, 4), sound: NO, directPicker: true, transitPicker: true, entryTransitPicker: true },
  { label: "app covariant args", have: app("F", Nat), want: app("F", Int), sound: NO, directPicker: true, transitPicker: true, entryTransitPicker: true },
  // Retained positive — nothing moves anywhere.
  { label: "tuple item positive", have: tup(Int), want: tup(Num), sound: JT, directPicker: true, transitPicker: true, entryTransitPicker: true },
];

describe("P1(a.7) §6 — the transit diff", () => {
  test("every direct picker decision is byte-identical; only ¬¬ transit cells move, and only by ACCEPT", () => {
    // The one flagless route from picker into the sound walk is
    // `subsetWK`'s want-side complement arm (`ttDisjoint`, no picker flag),
    // then `disjointW`'s own complement arms, which call `subsetW false`. So
    // `typeSubsumes have ¬¬w = collapse(subsetW false have w)` and the ONLY
    // possible movement is a retired NEGATIVE turning into an accept.
    for (const row of TRANSIT) {
      expect(sub(row.have, row.want), `${row.label}: sound`).toEqual(row.sound);
      expect(pick(row.have, row.want), `${row.label}: direct picker`).toBe(row.directPicker);
      expect(pick(row.have, notT(notT(row.want))), `${row.label}: ¬¬ picker`).toBe(row.transitPicker);
      // The accounted class: entry false → post true, and nothing else.
      if (row.entryTransitPicker !== row.transitPicker) {
        expect(row.entryTransitPicker, `${row.label}: movement class`).toBe(false);
        expect(row.transitPicker, `${row.label}: movement class`).toBe(true);
        expect(row.sound, `${row.label}: movement rides an abstention`).toEqual(NO);
      }
    }
  });

  test("no truth-consuming caller of typeSubsumes exists (stop rule 4)", () => {
    // The `typeSubsumes` consumers are the FunctionPicker fold
    // (`universeFunctionsMatchingReturn`), the production authoring filter
    // (`filterAuthoringFunctionsByReturn`), and the Solid expression-runner —
    // all admission filters whose documented default is include-with-no-claim.
    // This asserts the collapse itself, which is what makes them presentation:
    // an abstention ADMITS rather than excludes.
    expect(pick(arrow([Num], Num), arrow([Num, Num], Num))).toBe(true);
    expect(sub(arrow([Num], Num), arrow([Num, Num], Num))).toEqual(NO);
  });
});

// ---------------------------------------------------------------------------
// D1 — the validation-seam collapse (the one TS change in this phase).
// ---------------------------------------------------------------------------

describe("P1(a.7) D1 — the refute-only signature collapse", () => {
  test("the Bool consumers of the SOUND subset lose their arrow/map answers", () => {
    // `isSubtype` is `isJustTrue ∘ dispatchedSubset` and is LEFT ALONE
    // (`Nothing → false`), so its presentation consumers keep their meaning.
    // ENTRY: both true.
    expect(isSubtype(arrow([Num], Num) as never, arrow([Num], Num) as never)).toBe(false);
    // This one is a GAIN: the map false positive stops reaching a Bool caller.
    expect(isSubtype(Vec(Num as never, 3), Vec(Num as never, 4))).toBe(false);
  });

  test("DISCRIMINATES: validation still accepts a registered function name of matching arity", () => {
    // Without the refute-only collapse at `validationFunctionFact`, an
    // abstaining arrow judgment would make `signatureSubtype` false for every
    // KNOWN function name, so this exact call would fail with
    // "signature is not a subtype of the expected arrow" — while `""` and
    // every UNKNOWN name still validated. `std:negate : (x: Number) -> Number`.
    const unary = arrow([Num], Num) as FenelType;
    expect(validate(unary, "std:negate", null).valid).toBe(true);
    expect(validate(unary, "", null).valid).toBe(true);
    expect(validate(unary, "std:notARegisteredFunction", null).valid).toBe(true);
  });

  test("the INDEPENDENT paramCount axis still refutes — the column is inert, not removed", () => {
    // `paramCount` is the non-circular half of the same fact and is untouched;
    // it is also the axis that refuted the `someParamEmptyW` vacuity Just true.
    const binary = arrow([Num, Num], Num) as FenelType;
    const result = validate(binary, "std:negate", null);
    expect(result.valid).toBe(false);
    expect(
      result.errors.some((e) => /param\(s\) but expected/i.test(JSON.stringify(e.message))),
    ).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// §7.8 — the gate-untouched receipt.
// ---------------------------------------------------------------------------

describe("P1(a.7) §7.8 — the readiness gate is UNTOUCHED", () => {
  test("both readiness predicates keep their P1(a.6) case lists and their unconditional arms", () => {
    // This phase closed the top-level exposure at the SOURCE arms instead of by
    // adding a consult here, precisely because these arms are unconditional: a
    // consult on TtArrow/TtMap/TtTuple would be an unexercisable TCB branch.
    // The receipt asserts both halves — the arms are still unconditional, and
    // the twin case lists still match (the P1(a.6) divergence bug class).
    const root = join(dirname(fileURLToPath(import.meta.url)), "..", "..", "..", "..");
    const src = readFileSync(join(root, "fenel", "modules", "engine", "containment.fenel"), "utf8");
    const bodyOf = (fn: string): string => {
      const at = src.indexOf(`\n${fn} t = case t of\n`);
      expect(at, `${fn} declaration`).toBeGreaterThan(-1);
      const body = src.slice(at + fn.length + 14);
      const end = body.indexOf("\n\n");
      return body.slice(0, end === -1 ? undefined : end);
    };
    const heads = (fn: string): string[] =>
      bodyOf(fn)
        .split("\n")
        .map((line) => /^\s{2}(Tt[A-Za-z]+|_)\b/.exec(line)?.[1])
        .filter((head): head is string => head !== undefined);

    expect(heads("ttValidationPlanReady")).toEqual(heads("ttOccurrenceEnforcing"));
    expect(heads("ttValidationPlanReadyTail")).toEqual(heads("ttOccurrenceEnforcingTail"));

    for (const fn of ["ttValidationPlanReady", "ttOccurrenceEnforcing"]) {
      const body = bodyOf(fn);
      expect(body, `${fn}: TtMap arm`).toContain("TtMap {} -> false");
      expect(body, `${fn}: TtArrow arm`).toContain("TtArrow {} -> false");
    }
    for (const fn of ["ttValidationPlanReadyTail", "ttOccurrenceEnforcingTail"]) {
      expect(bodyOf(fn), `${fn}: fail-closed tail`).toContain("_ -> false");
    }
  });
});
