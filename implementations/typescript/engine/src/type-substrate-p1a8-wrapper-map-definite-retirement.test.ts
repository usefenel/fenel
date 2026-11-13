// ---------------------------------------------------------------------------
// type-substrate P1(a.8) — wrapper + map definite retirement.
//
// The phase retires four false-definite families, all MONOTONE (every change
// moves a definite to `Nothing`; nothing is minted):
//
//   `t.sub.resolve` cond 2   resolveHaveStep / resolveWantStep: an unresolvable
//                            registry name refuted. Neither the open-world nor
//                            the closed-world reading entitles that refutation.
//   `t.emp.map`              `emptyKC`'s unconditional map `Just false`, replaced
//                            by the READING-INVARIANT rule behind two gates.
//   `t.map.wellformed-card`  the new gate: no map verdict on a card no host
//                            array length can satisfy.
//   the `$tagged` wrapper    ALL FIVE `tsTaggedValue` peel sites across FOUR
//                            judgments — disjoint LEFT (`:106`) and RIGHT
//                            (`:107`), subset (`:1429`), `ttTopCover` (`:2212`)
//                            and emptiness (`:2486`).
//
// Every ENTRY value in a comment below was MEASURED at `656ec1fc` BEFORE any
// production edit, by
// `implementations/typescript/engine/scripts/entitlement-differential.ts
//  --manifest`, and is frozen verbatim in
// `workstreams/type-substrate/notes/phase-1a8-wrapper-and-map-definite-retirement.md`
// alongside the committed `entitlement-entry.json` baseline.
//
// Pins marked DISCRIMINATES fail when their fence is reverted IN ISOLATION.
// There are ELEVEN such fences (the tagged family alone is five, and the two
// disjoint peels need separately-ordered operands because `:107` is reachable
// only when the LEFT operand is not tagged): the five tagged peels, the two
// resolver steps, the map rule, its two gates, and the arrow factor gate. The
// revert runs are recorded in that note; the driver is
// `workstreams/type-substrate/notes/p1a8-discriminates.sh`, which matches each
// revert against the EXPECTED pin title BELOW, so retitling one of these tests
// without updating the script fails the run rather than silently passing.
//
// ⚠ LINE NUMBERS IN THE TAGGED PIN TITLES ARE THE **ENTRY** ONES — the sites as
// the brief names them (`ttTopCover :2212`, `emptyK :2486`). The ledger and the
// execution note instead cite the lines AT THE BEHAVIOUR COMMIT `9c404c3d`
// (`:106`, `:107`, `:1429`, `:2221`, `:2495`), which is immutable.
//
// DO NOT read either set as CURRENT. Every review round's comment edits move
// them — as of round 9 the five clauses sit at `122 / 123 / 1449 / 2241 / 2525`
// and the next comment will move them again. The ANCHOR is the named function
// and its clause; the integer is a convenience pinned to a commit.
// ---------------------------------------------------------------------------

import { describe, expect, setDefaultTimeout, test } from "bun:test";
import {
  dispatchedConformable,
  dispatchedDisjointType,
  dispatchedEmpty,
  dispatchedSubset,
  dispatchedValidationRuntime,
  universeTypeSubsumes,
} from "./engine-bodies-dispatch";
import { matchesShape } from "./decompose";
import { contains, decideEmpty, isDisjoint, isSubset, normalize } from "./set-algebra";
import { typeToSetExpr } from "./fenel-check";
import { isDegradedTypeProjection } from "./set-marker";
import { registerCatalogEntities } from "./type-catalog";
import { Int as IntOpaque, Vec } from "./type-foundation";
import { validate } from "./validate";
import { pureEvaluateContext } from "./json-logic";
import { getSystemEvaluateContext } from "./system-registry";
import type { FenelType } from "./types";

setDefaultTimeout(600_000);

type Tri = { $tag: "Just"; _0: boolean } | { $tag: "Nothing" };
const JT: Tri = { $tag: "Just", _0: true };
const JF: Tri = { $tag: "Just", _0: false };
const NO: Tri = { $tag: "Nothing" };

const Num = { $ref: "Number" } as FenelType;
const Int = { $ref: "Int" } as FenelType;
const Str = { $ref: "String" } as FenelType;
const Void = { $void: true } as FenelType;
const unit = { $record: { fields: [] } } as FenelType;

/** An entity the strict resolver cannot see. */
const NX = { $ref: "P1A8PinUnregistered" } as FenelType;
/** A CATALOG-registered entity whose body has a duplicate semantic field key.
 *  `validationNamedFacts` resolves it through `getEntityTypeByName` and
 *  elaborates the malformed body, so validation refuses EVERY value for it;
 *  the judgment's `resolveRef` reads the strict identified projection and never
 *  sees it, so `TtNamed` is all the map arm has to go on. */
const BAD = "P1A8PinBadSlots";

const nf = (uuid: string) => ({ $tag: "NamedField" as const, ref: { $ref: uuid } });
const DUP = "c1c1c1c1-1111-4111-8111-111111111111";
const dupSlots = {
  $record: {
    fields: [
      { name: "a", key: nf(DUP), type: Num, label: { $tag: "Nothing" }, meta: {}, ui: { $tag: "Nothing" } },
      { name: "b", key: nf(DUP), type: Str, label: { $tag: "Nothing" }, meta: {}, ui: { $tag: "Nothing" } },
    ],
  },
} as unknown as FenelType;
registerCatalogEntities([{ id: BAD, type: dupSlots }] as never);
const BadRef = { $ref: BAD } as FenelType;

const pf = (index: number, type: FenelType) => ({
  name: `_${index}`,
  key: { $tag: "PositionalField" as const, index },
  type,
});
const recP = (types: FenelType[]) =>
  ({ $record: { fields: types.map((t, i) => pf(i, t)) } }) as unknown as FenelType;
const tup = (...ts: FenelType[]) => ({ $tuple: ts }) as FenelType;
const arrow = (ps: FenelType[], r: FenelType) =>
  ({ $arrow: { params: ps.map((t, i) => pf(i, t)), returns: r } }) as FenelType;
const notT = (t: FenelType) => ({ $complement: t }) as FenelType;
const unionT = (...ts: FenelType[]) => ({ $union: ts }) as FenelType;
const taggedT = (value: FenelType, brand = "Bot") =>
  ({
    $tagged: { value, phantom: { $refined: { base: Str, set: { $enum: [brand] } } } },
  }) as unknown as FenelType;
const openMap = (v: FenelType) => ({ $map: { values: v } }) as unknown as FenelType;
const strMap = (v: FenelType) =>
  ({ $map: { keys: { $tag: "SeRef", handle: "String" }, values: v } }) as unknown as FenelType;
const vec = (n: number, v: FenelType) => Vec(v, n);

const sub = (a: FenelType, b: FenelType) => dispatchedSubset(a, b) as unknown as Tri;
const emp = (t: FenelType) => dispatchedEmpty(t) as unknown as Tri;
const dis = (a: FenelType, b: FenelType) => dispatchedDisjointType(a, b) as unknown as Tri;
const conf = (a: FenelType, b: FenelType) => dispatchedConformable(a, b) as unknown as Tri;
const pick = (a: FenelType, b: FenelType) => universeTypeSubsumes(a, b) as unknown as boolean;
const valid = (t: FenelType, v: unknown) => validate(t, v, null).valid;
// The Fenel validation plan alone, as `validate` calls it with no registry,
// without the door's `contains` fallback for an all-"Unknown field type" result.
const planValid = (t: FenelType, v: unknown) => dispatchedValidationRuntime(t, v, {
  evalCtx: pureEvaluateContext(getSystemEvaluateContext()),
  formData: typeof v === "object" && v !== null && !Array.isArray(v) ? v as Record<string, unknown> : {},
  requestAccount: null,
}).errors.length === 0;

const UUID = "123e4567-e89b-12d3-a456-426614174000";

// ---------------------------------------------------------------------------
// §1 — map emptiness. The reading-invariant rule, its two gates, and the three
// structural LIFTS that exported the old verdict.
// ---------------------------------------------------------------------------

describe("P1(a.8) §1 — map emptiness is reading-invariant", () => {
  test("DISCRIMINATES (map rule): a nonempty card over an empty value type abstains", () => {
    // ENTRY: Just false — `emptyKC`'s map arm was an unconditional `Just false`.
    // ⟦Vec n Void⟧ = ∅ under the TOTAL reading the repo commits to, and {} under
    // the PARTIAL one. The readings disagree, so the honest verdict is Nothing.
    expect(emp(vec(3, Void))).toEqual(NO);
    expect(emp(vec(1, Void))).toEqual(NO);
    expect(emp(strMap(Void))).toEqual(NO);
  });

  test("RETAINED: an empty key domain inhabits under BOTH readings", () => {
    // ENTRY: Just false. POST: Just false — the unique empty function IS the
    // empty dictionary, so the two readings AGREE and the definite is entitled.
    expect(emp(vec(0, Void))).toEqual(JF);
    expect(emp(vec(0, Int))).toEqual(JF);
  });

  test("RETAINED: provably inhabited values inhabit under BOTH readings", () => {
    // ENTRY: Just false. POST: Just false — the precision this phase preserves.
    // A constant function/dictionary exists whenever the value type does.
    expect(emp(openMap(Num))).toEqual(JF);
    expect(emp(vec(3, Num))).toEqual(JF);
    expect(emp(vec(3, Int))).toEqual(JF);
  });

  test("NEVER Just true: the rule may not prove a map EMPTY", () => {
    // A `Just true` here would be false under the partial reading. The rule has
    // no `Just true` clause at all; these are the shapes that would tempt one.
    expect(emp(vec(3, Void))).not.toEqual(JT);
    expect(emp(strMap(Void))).not.toEqual(JT);
    expect(emp(vec(1, Void))).not.toEqual(JT);
  });

  test("DISCRIMINATES (the three LIFTS): tuple / arrow-return / union", () => {
    // ENTRY: all three Just false, each exporting the map arm's verdict through
    // a fold that has no gate of its own. The record fold already abstained
    // (its product gate refuses a map factor), which is why the P1(a.7) review's
    // "no live consumer" argument looked complete and was not.
    expect(emp(tup(vec(3, Void)))).toEqual(NO);
    expect(emp(arrow([Int], vec(3, Void)))).toEqual(NO);
    expect(emp(unionT(vec(3, Void), Void))).toEqual(NO);
    // the DOUBLE-COMPLEMENT lift — a fourth the first census missed
    expect(emp(notT(notT(vec(3, Void))))).toEqual(NO);
    // the record fold: Nothing at entry AND post (its gate never admitted a map)
    expect(emp(recP([vec(3, Void)]))).toEqual(NO);
  });

  test("the live faces, unchanged — this phase fences the judgment, not validation", () => {
    // The whole point of the fence is that these do NOT move.
    expect(valid(vec(3, Void), {})).toBe(false);
    expect(valid(vec(3, Void), [1, 2, 3])).toBe(true);
    expect(valid(vec(0, Void), [])).toBe(true);
    expect(valid(vec(1, Int), [1])).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// §2 — the well-formed-card gate (`t.map.wellformed-card`).
// ---------------------------------------------------------------------------

describe("P1(a.8) §2 — no map verdict on a card no array length can satisfy", () => {
  test("DISCRIMINATES (card gate): negative and fractional cards", () => {
    // ENTRY: both Just false. `validationFiniteMapCard` accepts ANY numeric
    // exclusive upper bound with no Nat check (`validate.fenel:787`), so
    // `Fin(-1)` = [0,-1) is a PROVABLY EMPTY key domain — without this gate the
    // keys-empty clause would emit `Just false` for a type validation refuses
    // every value for.
    expect(emp(vec(-1, Int))).toEqual(NO);
    expect(emp(vec(2.5, Int))).toEqual(NO);
    // validation is unchanged and still refuses every value for both
    expect(valid(vec(-1, Int), [])).toBe(false);
    expect(valid(vec(-1, Int), [1])).toBe(false);
    expect(valid(vec(2.5, Int), [1, 2, 3])).toBe(false);
  });

  test("DISCRIMINATES (card gate): NaN, +Infinity, and the 2^32 boundary", () => {
    // "Is it a Nat?" is NOT the condition — HOST-REALIZABLE is. No JavaScript
    // array reaches length 2^32 (the max is 2^32 − 1), so `Vec 2^32 Number` is
    // uninhabited at the live face while its denotation is not.
    expect(emp(vec(Number.NaN, Int))).toEqual(NO);
    expect(emp(vec(Number.POSITIVE_INFINITY, Int))).toEqual(NO);
    expect(emp(vec(4294967296, Num))).toEqual(NO);
    // …and 2^32 − 1 IS a legal array length, so it keeps its definite.
    expect(emp(vec(4294967295, Num))).toEqual(JF);
  });
});

// ---------------------------------------------------------------------------
// §3 — the plan-readiness gate on the map value type.
// ---------------------------------------------------------------------------

describe("P1(a.8) §3 — no map verdict over a value type validation cannot plan", () => {
  test("DISCRIMINATES (plan gate): a catalog name whose body has duplicate keys", () => {
    // The § 2.2 witness. Validation RESOLVES the name through the catalog and
    // elaborates the malformed body, so it refuses every value; the judgment's
    // `resolveRef` reads the strict identified projection and cannot see it, so
    // the map arm has only an opaque `TtNamed` to reason from.
    expect(valid(BadRef, {})).toBe(false);
    expect(valid(vec(0, BadRef), [])).toBe(false);
    // ENTRY: Just false (the keys-empty clause, ungated). POST: Nothing.
    expect(emp(vec(0, BadRef))).toEqual(NO);
    expect(emp(vec(3, BadRef))).toEqual(NO);
  });

  test("the gate is the EXISTING ledgered readiness predicate, not a second doctrine", () => {
    // `ttValidationPlanReady` admits `TtVoid` and primitive `TtNamed` and
    // refuses `TtMap` / `TtArrow` / every `VtOther` former. These two pins are
    // the observable consequence of that allow-list, and they are what makes
    // the retained clauses above survive the gate.
    expect(emp(vec(0, Void))).toEqual(JF); // TtVoid is plan-ready
    expect(emp(openMap(Num))).toEqual(JF); // primitive TtNamed is plan-ready
    expect(emp(vec(3, vec(2, Int)))).toEqual(NO); // TtMap is NOT — priced
    expect(emp(vec(3, arrow([Num], Num)))).toEqual(NO); // TtArrow is NOT — priced
  });
});

// ---------------------------------------------------------------------------
// §3b — the arrow FACTOR gate. Same shape as the map gate, found by design
// review of this phase: P1(a.7) entitled `emptyArrow`'s two retained clauses on
// the claim that `validationValidateArrow` accepts `""` for EVERY arrow type,
// and that claim is false by ORDERING — the plan preflight audits the arrow's
// params and return before that leaf is ever reached.
// ---------------------------------------------------------------------------

describe("P1(a.8) §3b — no arrow verdict over a factor validation cannot plan", () => {
  test("DISCRIMINATES (arrow factor gate): a param whose catalog body is malformed", () => {
    // ENTRY: Just false, from the return-inhabited clause — `mAnd` short-circuits
    // on `emptyW(Number) = Just false` and never looks at the param.
    expect(emp(arrow([BadRef], Num))).toEqual(NO);
    expect(valid(arrow([BadRef], Num), "")).toBe(false);
    expect(valid(arrow([BadRef], Num), "std:negate")).toBe(false);
    // …and the same lift through a map value, closed twice over.
    expect(emp(vec(3, arrow([BadRef], Num)))).toEqual(NO);
  });

  test("RETAINED: a plannable arrow keeps its inhabited definite", () => {
    // ENTRY and POST: Just false. `""` inhabits it at the validation face, and
    // every factor is plan-ready, so the clause is entitled.
    expect(emp(arrow([Num], Num))).toEqual(JF);
    expect(valid(arrow([Num], Num), "")).toBe(true);
    // the vacuous-param clause, same gate
    expect(emp(arrow([Void], Num))).toEqual(JF);
  });

  test("PRICED: a non-primitive named factor loses the definite", () => {
    // `ttValidationPlanReady` is false for every non-primitive `TtNamed`, which
    // is exactly what contains the FILED `t.emp.named-atoms` defect: the tower
    // asserts `notEmpty({$ref:"ℝ"})` from a table, and this gate stops that
    // reaching an arrow or a map verdict.
    expect(emp(arrow([{ $ref: "P1A8PinUnregistered" } as FenelType], Num))).toEqual(NO);
    expect(emp(vec(3, { $ref: "ℝ" } as FenelType))).toEqual(NO);
  });
});

// ---------------------------------------------------------------------------
// §4 — the resolver misses. RUN FIRST in the repair order: once these abstain,
// every tagged cell that went through the resolver stops discriminating the
// tagged fence.
// ---------------------------------------------------------------------------

describe("P1(a.8) §4 — an unresolvable name refutes nothing", () => {
  test("DISCRIMINATES (resolveHaveStep): the have-side miss", () => {
    // ENTRY: Just false. `Just false` asserts ∃v ∈ ⟦NX⟧ ∖ ⟦want⟧; open-world
    // ⟦NX⟧ is unknown and closed-world it has no denotation, so NEITHER
    // documented reading entitles the refutation (standing rule C).
    expect(sub(NX, Void)).toEqual(NO);
    expect(sub(NX, unit)).toEqual(NO);
  });

  test("DISCRIMINATES (resolveWantStep): the want-side twin", () => {
    // ENTRY: Just false. Separately reachable — the have side is structural.
    expect(sub(unit, NX)).toEqual(NO);
    expect(sub(Num, NX)).toEqual(NO);
  });

  test("the already-fenced sibling and the positive-only named arm do not move", () => {
    expect(sub(tup(NX), tup(Void))).toEqual(NO); // fenced at P1(a.7)
    expect(sub(Int, NX)).toEqual(NO); // positive-only named arm, P1(a.6)
    expect(valid(NX, 1)).toBe(false); // the refuse-all face is untouched
  });

  test("NAMED REFLEXIVITY is retained — and it is NOT a co-induction pin", () => {
    // ⚠ This test was first written as "co-induction (condition 1) is
    // untouched". That name was WRONG and the post-commit adversarial review
    // caught it: `ssNamedArm`'s handle equality short-circuits BEFORE
    // `ssResolve`, so neither cell reaches `resolveHaveSide`, `resolveHaveStep`
    // or `seenPair`. Break `seenPair` and both of these stay green.
    //
    // NOTHING in this repository pins co-induction today, and that is a
    // consequence of the phase's own finding: the resolver's SUCCESS path is
    // unreachable (`resolveRef` double-marshals), so no cell can exercise the
    // co-inductive accept at all. `t.sub.resolve` lands MISSING for exactly
    // that reason, and restoring a co-induction pin is part of the
    // double-marshal slice, not of this one. What IS pinned here is the
    // retention: named reflexivity must not have been collateral.
    expect(sub(NX, NX)).toEqual(JT);
    expect(sub(BadRef, BadRef)).toEqual(JT);
    expect(sub({ $ref: "Bot" } as FenelType, { $ref: "Bot" } as FenelType)).toEqual(JT);
    // …and the resolve path itself now emits nothing in EITHER direction, for
    // a name the strict identified projection DOES publish. This is the cell
    // that shows the success path was a miss all along.
    expect(sub({ $ref: "Bot" } as FenelType, unit)).toEqual(NO);
    expect(sub(unit, { $ref: "Bot" } as FenelType)).toEqual(NO);
  });
});

// ---------------------------------------------------------------------------
// §5 — the `$tagged` wrapper, all FIVE peel sites across FOUR judgments.
// ---------------------------------------------------------------------------

describe("P1(a.8) §5 — the tagged wrapper emits nothing in sound mode", () => {
  test("DISCRIMINATES (emptyK :2486): tagged emptiness", () => {
    // ENTRY: Just true — while `validate($tagged{value=$void}, <uuid>)` is
    // VALID. The judgment called EMPTY a type validation admits a value into.
    expect(emp(taggedT(Void))).toEqual(NO);
    expect(valid(taggedT(Void), UUID)).toBe(true);
    // priced: the nonempty baseline goes with it
    expect(emp(taggedT(Num))).toEqual(NO); // ENTRY Just false
  });

  test("DISCRIMINATES (disjointW :106, the LEFT peel)", () => {
    // ENTRY: both Just true. Reachable when the LEFT operand is tagged AND no
    // earlier arm decided — the void checks sit ABOVE both peels, so
    // `dis(Tag(Number), $void)` is `Just true` there and never reaches this one
    // (round 6; "whenever the left operand is tagged" was wrong).
    expect(dis(taggedT(Void), taggedT(Void))).toEqual(NO);
    expect(dis(taggedT(Void), Num)).toEqual(NO);
  });

  test("DISCRIMINATES (disjointW :107, the RIGHT peel — separately reachable)", () => {
    // ENTRY: Just true. `:107` fires only when the LEFT operand is NOT tagged,
    // so a census of left-operand cells pins ONE of the two fences.
    expect(dis(Num, taggedT(Void))).toEqual(NO);
    expect(dis(unit, taggedT(Void))).toEqual(NO);
  });

  test("DISCRIMINATES (ssSameKind :1429): tagged subset", () => {
    // ENTRY: Just false. A RECORD-WIDTH refutation with NO resolver
    // involvement — the brief's stale-witness trap is that `sub(Tag(NX),
    // Tag(Void))` also moves, but through §4, so it cannot discriminate this.
    expect(sub(taggedT(unit), taggedT(recP([Num])))).toEqual(NO);
    // priced: tagged reflexivity, and the brand cell
    expect(sub(taggedT(Num), taggedT(Num))).toEqual(NO); // ENTRY Just true
    expect(sub(taggedT(Str, "Bot"), taggedT(Str, "User"))).toEqual(NO); // ENTRY Just true
    // already abstaining at entry; pairs with the picker pin in §7
    expect(sub(taggedT(Num), taggedT(Str))).toEqual(NO);
  });

  test("DISCRIMINATES (ttTopCover :2212): BOTH polarities", () => {
    // The positive alone under-pins this arm — `ttTopCover` feeds complement
    // SUBSET and complement EMPTINESS, so a wrong tagged top-cover is exported
    // twice.
    expect(emp(notT(taggedT(Num)))).toEqual(NO); // ENTRY Just false — NEGATIVE leg
    expect(emp(notT(taggedT(notT(Void))))).toEqual(NO); // ENTRY Just true — POSITIVE leg
    expect(sub(notT(taggedT(notT(Void))), Void)).toEqual(NO); // ENTRY Just true — the consumer
  });

  test("the CONTRADICTION the fence answers is still measurable at the faces", () => {
    // Validation reads a `$tagged` by UUID syntax only and never looks at the
    // value slot; `matchesShape` recurses into it. That disagreement is what
    // makes every peeled verdict a verdict across two readings.
    expect(valid(taggedT(Void), UUID)).toBe(true);
    expect(valid(taggedT(recP([Num])), UUID)).toBe(true);
    expect(matchesShape(UUID, taggedT(Void))).toBe(false);
    expect(matchesShape(5, taggedT(Num))).toBe(true);
  });

  test("PRICED: conformable loses tagged congruence transitively", () => {
    // ENTRY: Just true, through `conformCongruent`'s mutual `subsetW`.
    expect(conf(taggedT(Num), taggedT(Num))).toEqual(NO);
    // The ARRAY arm keeps its KEY reasoning — `conformMap` decides key domains
    // with `decideSubset` in both directions and never peels a tagged wrapper
    // itself.
    expect(conf(vec(3, Num), vec(3, Num))).toEqual(JT);
    expect(conf(vec(3, Num), vec(4, Num))).toEqual(JF);
  });

  test("PRICED: the ARRAY arm loses its definite when the ELEMENT is tagged", () => {
    // ⚠ Found by adversarial review round 5, and it corrects a claim the first
    // landing wrote HERE: "the array side is untouched". The ARM does not peel a
    // tagged wrapper, but `conformMap` decides its VALUE factor with
    // `subsetW false (tsMapValues have) (tsMapValues want)` — which is exactly the
    // `t.sub.tagged` fence. So a total array over a `$tagged` ELEMENT loses its
    // conformance definite even though the key domains are equal and provable.
    expect(conf(vec(3, taggedT(Num)), vec(3, taggedT(Num)))).toEqual(NO);
    // …while the same shape over an untagged element keeps it, which is what
    // makes this a VALUE-factor loss and not a key-domain one.
    expect(conf(vec(3, Num), vec(3, Num))).toEqual(JT);
    // The key refutation survives even with a tagged element: `mAnd` is
    // false-dominant, so an unequal key domain still refutes.
    expect(conf(vec(3, taggedT(Num)), vec(4, taggedT(Num)))).toEqual(JF);
    // CENSUS SCOPE, pinned so it is not re-discovered: the Entitlement
    // Differential has NO `conformable` column (its relation columns are
    // ttSub / ttSubRev / ttDisjoint / seSub / seDegraded / pickDirect /
    // pickTransit), so conformance movements are covered HERE, exactly as the
    // Boolean wrappers in §8b are. A `conformable` column is a P1(d) obligation.
  });
});

// ---------------------------------------------------------------------------
// §6 — the DIRECT picker arms. STOP RULE 4: absolute byte-identity.
// ---------------------------------------------------------------------------

describe("P1(a.8) §6 — the DIRECT picker recursion is byte-identical", () => {
  test("the tagged picker arm still recurses", () => {
    // `typeSubsumes(Tag(N), Tag(N)) = true` is VACUOUS on its own — an
    // unconditional `Nothing` also collapses to `true` (`Nothing -> true`). The
    // DISCRIMINATING pin is the pair: a picker REFUSAL can only come from the
    // direct recursion actually running.
    expect(pick(taggedT(Num), taggedT(Num))).toBe(true);
    expect(pick(taggedT(Num), taggedT(Str))).toBe(false);
    // The record pair is NOT a discriminator and this was measured, not
    // assumed: picker-mode record subtyping is generous in BOTH directions
    // (`unit` vs `rec{_0}` is `true` either way), so only the ATOM pair above
    // separates "the recursion ran" from "the arm abstained and the
    // `Nothing -> true` default fired". Kept as a non-movement pin.
    expect(pick(taggedT(recP([Num])), taggedT(unit))).toBe(true);
    expect(pick(taggedT(unit), taggedT(recP([Num])))).toBe(true);
    // The SOUND face of that same pair does refute — which is the point: the
    // picker and the judgment have deliberately different jobs here.
    expect(sub(taggedT(unit), taggedT(recP([Num])))).toEqual(NO);
  });

  test("pairs with no complement — the picker's own recursion, unchanged", () => {
    // ⚠ NOT a claim that a complement-free pair CANNOT reach a sound arm.
    // Adversarial review refuted the structural version of that both ways:
    // `typeSubsumes(Tag(N), Tag(¬Tag(N)))` reaches `ttDisjoint` at a RECURSIVE
    // call with no complement at the want root, and `¬A ⊆ ¬B` has one but the
    // have-side arm wins first. These are RETENTION pins on cells that in fact
    // did not move; the STOP-RULE-4 gate is an enumeration in the differential.
    expect(pick(vec(3, Void), vec(3, Void))).toBe(true);
    expect(pick(Int, Num)).toBe(true);
    expect(pick(Num, Str)).toBe(false);
    expect(pick(NX, NX)).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// §7 — the FLAGLESS TRANSIT. `subsetWK`'s want-side complement arm calls
// `ttDisjoint` with NO picker flag, and `typeSubsumes` collapses
// `Nothing -> true`. A `Just false -> Nothing` fence is therefore an
// ACCEPT-GAIN in a presentation filter. Pre-authorised, enumerated, priced.
// ---------------------------------------------------------------------------

describe("P1(a.8) §7 — the pre-authorised picker accept-gains", () => {
  test("the two enumerated transit movements", () => {
    // ENTRY: both false. The sound `ttDisjoint` / resolver answered `Just false`
    // through the flagless arm; both now abstain and the picker's UX-honest
    // default admits the candidate.
    expect(pick(taggedT(Num), notT(Num))).toBe(true);
    expect(pick(unit, notT(notT(NX)))).toBe(true);
  });

  test("every transit movement is an ACCEPT-GAIN, never an accept LOSS", () => {
    // A transit that LOST an accept would be a stop-rule event: the filter would
    // start hiding candidates on the strength of a retired claim.
    expect(pick(taggedT(Void), notT(Num))).toBe(true);
    expect(pick(NX, notT(Num))).toBe(true);
    expect(pick(Num, notT(Str))).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// §8 — the TRUTH-CONSUMING consumer census, pinned rather than inferred from a
// green suite. P1(a.7) shipped a would-be incoherent validator past a fully
// green suite; the census is what caught it.
// ---------------------------------------------------------------------------

describe("P1(a.8) §8 — truth-consuming consumers", () => {
  test("`untaggedToVariant` collapses disjointness through `containmentProven`", () => {
    // eslint-disable-next-line @typescript-eslint/no-require-imports, @typescript-eslint/no-var-requires
    const algebra = require("./type-algebra") as typeof import("./type-algebra");
    const payload = (uuid: string, type: FenelType) => ({
      $tag: "MintField" as const,
      field: { key: nf(uuid), name: "value", label: { $tag: "Nothing" }, type, meta: {}, ui: { $tag: "Nothing" } },
    });
    const cands = (ts: FenelType[]) =>
      ts.map((type, i) => ({
        type,
        payload: payload(`d${i}d${i}d${i}d${i}-4444-4444-8444-44444444444${i}`, type),
      })) as never;
    // A pair with NO tagged operand is untouched: still provably disjoint.
    expect("ok" in algebra.untaggedToVariant(cands([Num, Str]))).toBe(true);
    // A TAGGED operand now abstains, so the consumer reports the pair as not
    // provably disjoint. That is a PRICED precision loss in a sugar desugarer,
    // not a wrong answer: it refuses to build a union it can no longer prove
    // well-formed. ENTRY: `ok`.
    expect("err" in algebra.untaggedToVariant(cands([taggedT(Void), Num]))).toBe(true);
    expect("err" in algebra.untaggedToVariant(cands([taggedT(Num), taggedT(Str)]))).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// §8b — the BOOLEAN-WRAPPER census, and the PRODUCT-VISIBLE price.
//
// The brief's §5 requires this census and the first landing MISSED it; the
// post-commit adversarial review found it. `isSubtype` / `isDisjointType` /
// `emptyB` all collapse `Nothing -> false`, so a retired `Just true` does not
// read downstream as an abstention — it reads as a REFUSAL. That is an ACCEPT
// LOSS, the opposite direction from the priced picker accept-gains, and two
// production surfaces take it directly:
//
//   `distros/narthex/solid/src/lib/data-search/matcher.ts:227` (params) and
//   `:231` (return) — `:233` is a comment; round 3 established the return call
//   is at `:231`, and round 4 fixed only the other citation of it.
//       the signature-match preflight — a candidate whose param or return is a
//       `$tagged` type no longer matches a query with the SAME tagged type, so
//       it never reaches exact-equality scoring and vanishes from results.
//   `distros/narthex/solid/src/routes/app/types/[id]/usages.tsx:145-146`
//       two entities with identical `$tagged` types stop being reported as
//       refinements / generalizations / equivalent.
//
// These are PRICED, not defects: the surfaces become conservative, never wrong.
// Recovery is the narrow tagged rule named in `t.sub.tagged` / `t.emp.tagged`.
// ---------------------------------------------------------------------------

describe("P1(a.8) §8b — the Boolean-wrapper collapses", () => {
  // eslint-disable-next-line @typescript-eslint/no-require-imports, @typescript-eslint/no-var-requires
  const sa = require("./set-algebra") as typeof import("./set-algebra");
  // eslint-disable-next-line @typescript-eslint/no-require-imports, @typescript-eslint/no-var-requires
  const algebra = require("./type-algebra") as typeof import("./type-algebra");
  // eslint-disable-next-line @typescript-eslint/no-require-imports, @typescript-eslint/no-var-requires
  const bodies = require("./engine-bodies-dispatch") as typeof import("./engine-bodies-dispatch");
  /** The REGISTERED Fenel `engine:subsetB` / `engine:emptyB`. Neither has a TS
   *  seam — nothing in `src/`, `distros/` or `fenel/` calls either — so they are
   *  registered-but-unreached wrappers rather than live production consumers,
   *  and they are exercised here by dispatching the body directly. Both take
   *  MARSHALLED operands (the `$`-key boundary), exactly as `dispatchedSubset`
   *  and `dispatchedEmpty` do; passing raw `FenelType` reaches the body with an
   *  unmarshalled value and measures nothing. They ALSO need the decider
   *  ctx-natives (`namedSubsetCheck`, `resolveRef`, …): the plain
   *  `dispatchEngineBody` does not merge them, so the body silently resolves
   *  those names to null and every verdict collapses to `false` — which is how
   *  the first two cuts of this pin produced a bogus
   *  `subsetB(Number, Number) = false`. Both mistakes are recorded because they
   *  are the standing Fenel-body silent-null traps, not one-off slips. */
  const marshal = (t: FenelType) => bodies.marshalTraversalType(t);
  const subsetB = (a: FenelType, b: FenelType): boolean =>
    bodies.dispatchEngineBodyWithDeciderCtx("engine:subsetB", [marshal(a), marshal(b)]) as boolean;
  const emptyBFenel = (t: FenelType): boolean =>
    bodies.dispatchEngineBodyWithDeciderCtx("engine:emptyB", [marshal(t)]) as boolean;

  test("PRICED: every Boolean wrapper loses its tagged positive", () => {
    // ENTRY: all true. POST: all false, through `Nothing -> false`. Each of
    // these calls the REAL exported wrapper, not a local re-implementation of
    // the collapse — a distinction adversarial review had to point out.
    expect(sa.isSubtype(taggedT(Num), taggedT(Num))).toBe(false);
    expect(sa.isSubtype(taggedT(Str), taggedT(Str))).toBe(false);
    expect(sa.isSubtype(taggedT(recP([Num])), taggedT(recP([Num])))).toBe(false);
    expect(subsetB(taggedT(Num), taggedT(Num))).toBe(false);
    expect(algebra.isDisjointType(taggedT(Void), Num)).toBe(false);
    expect(emptyBFenel(taggedT(Void))).toBe(false);
  });

  test("PRICED: the loss LIFTS through a product former that CAN carry a tagged item", () => {
    // ⚠ CORRECTED after adversarial review round 2. The first cut claimed the
    // loss lifts through `(Tag(N))->N` and `rec{_0: Tag(N)}`. Both were FALSE
    // measurements: the arrow pair was ALREADY `false` at entry because
    // P1(a.7) abstained top-level arrow subset, and the record pair was
    // ALREADY `false` because `ttValidationPlanReady` has no `TtTagged` arm, so
    // a tagged field is not plan-ready and `ttProductPairReady` refuses the
    // whole product. Reverting `ssTagged` alone leaves both green — i.e. they
    // pinned nothing. TUPLE is the former that does carry it: `tupleSub` is
    // positive-only (`ttKeepTrue`) and its item verdict IS the tagged one.
    expect(sa.isSubtype(tup(taggedT(Num)), tup(taggedT(Num)))).toBe(false);
    // …and the underlying tuple machinery still works on an untagged item, so
    // this is the tagged leaf and not the tuple arm.
    expect(sa.isSubtype(tup(Num), tup(Num))).toBe(true);
  });

  test("PRICED: the right-disjoint and top-cover fences reach the wrappers too", () => {
    // Added after review round 2: §8b's first cut covered only the LEFT peel's
    // consumers, so reverting the right-disjoint or the top-cover fence alone
    // left this section green.
    expect(algebra.isDisjointType(Num, taggedT(Void))).toBe(false); // the RIGHT peel
    // ⚠ CORRECTED by review round 3: this one is NOT top-cover. `subsetWK`'s
    // want-side complement arm hands off to `ttDisjoint(unit, Tag(N))`, so it is
    // the RIGHT tagged peel again — reverting `ttTopCover` alone leaves it
    // green. The two below ARE the top-cover discriminators.
    expect(sa.isSubtype(unit, notT(taggedT(Num)))).toBe(false); // want-¬ → ttDisjoint (matcher.ts:227 params, :231 return)
    expect(sa.isSubtype(notT(taggedT(notT(Void))), Void)).toBe(false); // TOP-COVER (complement-subset)
    expect(emptyBFenel(notT(taggedT(notT(Void))))).toBe(false); // TOP-COVER (complement-emptiness)
  });

  test("the collapse is CONFINED to the fenced arms — controls hold", () => {
    // If these moved, the fence would have reached past its family and the
    // product surfaces would be losing untagged candidates too.
    expect(sa.isSubtype(Num, Num)).toBe(true);
    expect(sa.isSubtype(recP([Num]), recP([Num]))).toBe(true);
    expect(sa.isSubtype(Int, Num)).toBe(true);
    expect(subsetB(Num, Num)).toBe(true);
    expect(algebra.isDisjointType(Num, Str)).toBe(true);
    expect(emptyBFenel(Void)).toBe(true);
  });

  test("the RESOLVER fence causes NO Boolean-wrapper movement", () => {
    // `Just false` and `Nothing` both collapse to `false`, so retiring a
    // refutation is invisible to a Boolean caller. Only the retired POSITIVES
    // cost anything downstream — which is why the tagged family is the whole
    // product price and the (much larger) resolver family is free.
    expect(sa.isSubtype(NX, Void)).toBe(false); // was Just false, now Nothing
    expect(sa.isSubtype(Num, Void)).toBe(false); // was Just false, now Nothing
  });
});

// ---------------------------------------------------------------------------
// §9 — frozen for the successors. If any of these moves, the successor brief
// must be RE-DERIVED rather than amended.
// ---------------------------------------------------------------------------

// ---------------------------------------------------------------------------
// §8c — obligations originally FILED by P1(a.8). The September 2026 audit repair
// closes prj.catchall-under-complement through the Fenel-owned projection loss
// envelope; its three pins below now assert the repaired abstentions. The
// other two obligations retain their original status and current behavior:
//   * `prj.catchall-under-complement` — a demonstrated false definite, now
//     fenced as degraded evidence while preserving the presentation shape.
//   * `t.emp.named-atoms` — a demonstrated false definite, but its pin is a
//     TARGET: it samples refused values rather than quantifying, so it is red
//     for the PLANNED repair and not for every valid one.
//   * `t.top.opaque` — a RETENTION pin. There is NO executed refutation (round
//     10 reclassified the row SIDE-CONDITIONED); the pin records current
//     behaviour and the `matchesShape` line is CONTEXT, not evidence. The
//     witness it owes is TOPNESS DISAGREEMENT between an opaque's `pure` view
//     and its live carrier — NOT merely a carrier split, which `Int` already
//     has while `empty(¬Int) = Just false` stays sound (round 12).
// ---------------------------------------------------------------------------
describe("P1(a.8) §8c — repaired projection and remaining filed obligations", () => {
  test("REPAIRED prj.catchall-under-complement: ⊤-widening is fenced under ¬", () => {
    // `typeToSetNode` has no `TtTagged` arm, so the catchall projects ⊤; the
    // `TtComplement` arm wraps it. Previously its unmarked projection let
    // `decideEmpty` return `Just true`. ¬ is ANTITONE, so the maximal
    // OVER-approximation became the maximal UNDER-approximation. The loss flag
    // now survives complement and prevents either false definite polarity.
    //
    // ⚠ THE WITNESS IS `Tag($void)`, NOT `Tag(Number)`, and round 8 was right to
    // insist on the difference. `matchesShape(5, ¬Tag(Number))` is `true` only
    // via `decomposeMatchesShapeTail`'s complement wildcard — the SAME accept-all
    // lane §5's `t.top.tagged` rebuttal excludes as recognizer non-evidence — so
    // using it here would have made this pin red for a `matchesShape` repair that
    // left the projection defect untouched. `Tag($void)` needs no such lane: BOTH
    // implemented inner faces refuse `5` (asserted below), so classical complement
    // puts `5` in `¬Tag($void)` under either reading, from the INNER faces alone.
    const notTagV = notT(taggedT(Void));
    expect(matchesShape(5, taggedT(Void))).toBe(false); // inner face 1 refuses
    expect(valid(taggedT(Void), 5)).toBe(false); //          inner face 2 refuses
    const seV = typeToSetExpr(notTagV);
    // Shape asserted STRUCTURALLY, not by `JSON.stringify` — key order is not a
    // property of the projection (round 8 nit).
    expect((seV as { $tag: string }).$tag).toBe("SeComplement");
    expect(((seV as { inner: { $tag: string } }).inner).$tag).toBe("SeAll");
    expect(isDegradedTypeProjection(seV)).toBe(true);
    expect(decideEmpty(seV as never)).toEqual(NO);
    expect(contains(seV as never, 5, null)).toEqual(NO);
    expect(isSubset(seV as never, { $tag: "SeNone" } as never)).toEqual(NO);
    expect(isDisjoint(seV as never, { $tag: "SeAll" } as never)).toEqual(NO);
    expect(normalize(seV as never)).toEqual(seV);
    expect(isDegradedTypeProjection(normalize(seV as never))).toBe(true);
    // The Tt face, which P1(a.8) fenced, continues to abstain.
    expect(emp(notTagV)).toEqual(NO);
    // CONTROL: a complement over a former the projection DOES model abstains,
    // so the defect is the catchall and not complements in general.
    const exactComplement = typeToSetExpr(notT(Num));
    expect(isDegradedTypeProjection(exactComplement)).toBe(false);
    expect(decideEmpty(exactComplement as never)).toEqual(NO);
  });

  test("REPAIRED prj.catchall-under-complement: EXPLICIT SeAll producers too", () => {
    // ⚠ The row id says `catchall`, but round 9 showed the scope is WIDER: an
    // inline variant and an OPEN map are EXPLICIT `SeAll` arms, not catchall
    // members, and they take the same complement defect. Both witnesses are
    // NON-CIRCULAR — `matchesShape` and `validate` BOTH refuse `5` for the inner
    // type, so `5` is in the real complement under either reading, with no
    // complement-wildcard lane involved.
    const inlineBool = {
      $variant: { cases: [{ name: "True", fields: [] }, { name: "False", fields: [] }] },
    } as unknown as FenelType;
    const openNumMap = { $map: { values: Num } } as unknown as FenelType;
    for (const inner of [inlineBool, openNumMap]) {
      expect(matchesShape(5, inner)).toBe(false); // inner face 1 refuses
      expect(valid(inner, 5)).toBe(false); //        inner face 2 refuses
      const se = typeToSetExpr(notT(inner));
      expect((se as { $tag: string }).$tag).toBe("SeComplement");
      expect(((se as { inner: { $tag: string } }).inner).$tag).toBe("SeAll");
      expect(isDegradedTypeProjection(se)).toBe(true);
      expect(decideEmpty(se as never)).toEqual(NO);
      expect(contains(se as never, 5, null)).toEqual(NO);
      expect(isSubset(se as never, { $tag: "SeNone" } as never)).toEqual(NO);
      expect(isDisjoint(se as never, { $tag: "SeAll" } as never)).toEqual(NO);
      expect(normalize(se as never)).toEqual(se);
      expect(isDegradedTypeProjection(normalize(se as never))).toBe(true);
    }
  });

  test("REPAIRED prj.catchall-under-complement: every verdict and normalization retain uncertainty", () => {
    // Round 8 measured false definites beyond emptiness-driven subset:
    // normalization used to erase the loss by collapsing this shape to SeNone.
    const seV = typeToSetExpr(notT(taggedT(Void)));
    expect(isDegradedTypeProjection(seV)).toBe(true);
    expect(decideEmpty(seV as never)).toEqual(NO);
    expect(contains(seV as never, "a", null)).toEqual(NO);
    expect(isSubset(seV as never, { $tag: "SeNone" } as never)).toEqual(NO);
    expect(isDisjoint(seV as never, { $tag: "SeAll" } as never)).toEqual(NO);
    const normalized = normalize(seV as never);
    expect(normalized).toEqual(seV);
    expect(normalized.$tag).toBe("SeComplement");
    expect(isDegradedTypeProjection(normalized)).toBe(true);

    // Directly authored complement(top) is exact and still normalizes to empty.
    const authored = { $tag: "SeComplement", inner: { $tag: "SeAll" } };
    expect(isDegradedTypeProjection(authored)).toBe(false);
    expect(normalize(authored as never)).toEqual({ $tag: "SeNone" });
    expect(decideEmpty(authored as never)).toEqual(JT);
  });

  test("FILED t.top.opaque: RETENTION pin — the peel has no carrier flag", () => {
    // ⚠ READ THE LABEL. This is a RETENTION pin of current behaviour, not an
    // executed refutation. Round 8 was right that `matchesShape(0, ¬O)` = true
    // comes from the complement wildcard — the same non-evidence lane §5's
    // `t.top.tagged` rebuttal excludes — so it is recorded as CONTEXT and the
    // assertion is not labelled a witness. The row's own text carries what the
    // defect actually is: `ttTopCover` peels `$opaque` with no carrier flag,
    // ⚠ and NOT "while every membership face describes the REPRESENTATION" —
    // that ground is RETRACTED (ordinary inline opaques recurse into `pure` at
    // BOTH faces: `validate($opaque{pure=Number}, 0) = true`). The peel
    // exposes the PURE view. ⚠ The witness owed by P1(a.11) is a TOPNESS
    // DISAGREEMENT between an opaque's `pure` view and its live carrier — NOT
    // a representation-carrier split, which `Int` already is while
    // `empty(¬Int) = Just false` stays sound. `ttTopCover` only emits "is ⊤" /
    // "is not ⊤", so a split on the same side of ⊤ is invisible to it
    // (round 12; the §8c header was updated at round 12 and this body at 13).
    const O = { $opaque: { name: "P1A8PinTopOpaque", pure: notT(Void) } } as unknown as FenelType;
    const H = notT(O);
    expect(sub(H, Void)).toEqual(JT); // current behaviour
    expect(emp(H)).toEqual(JT); //     its emptiness twin
    expect(matchesShape(0, H)).toBe(true); // CONTEXT ONLY — the complement lane
  });

  test("FILED t.emp.named-atoms: TARGET pin — the tower is wider than the live face", () => {
    // ⚠ A TARGET, NOT AN EXACT DETECTOR (round 8). If the repair goes the OTHER
    // way — validation starts ACCEPTING some ℝ value — then `empty(ℝ) = Just
    // false` becomes sound and this pin still passes, because it samples two
    // refused values rather than quantifying over the domain. It is red exactly
    // for the PLANNED repair (narrowing `emptyNamed`'s tower to tower ∩
    // live-face-inhabited), which is what a filing needs to be useful; it is not
    // a proof that the row is closed.
    //
    // ⚠ THE SAMPLED FACE IS THE FENEL VALIDATION PLAN (2026-09-23). Since
    // `178ffe1c` the public `validate` door answers a result whose every error
    // is "Unknown field type" from `contains(typeToSetExpr(type), value)`, so it
    // ACCEPTS `ℝ` values. That is the judgment's own Se face answering for
    // validation: circular, and not evidence for this row (tcb-ledger's DEGRADE
    // lane). It is recorded as CONTEXT; the pin samples the plan, which still
    // has no arm for `ℝ`.
    const R = { $ref: "ℝ" } as FenelType;
    expect(emp(R)).toEqual(JF); // ⚠ WRONG — the validation plan refuses these ℝ values
    expect(planValid(R, 1)).toBe(false);
    expect(planValid(R, "1")).toBe(false);
    expect(planValid(R, 1.5)).toBe(false);
    expect(valid(R, 1)).toBe(true); // CONTEXT ONLY — the public door's contains fallback
    // and it is EXPORTED, not contained: the tuple lift carries it out.
    expect(emp(tup(R))).toEqual(JF);
  });
});

describe("P1(a.8) §9 — frozen for P1(a.9) / P1(a.10)", () => {
  test("the D1 seam (P1(a.9)) — the fail-open interim, priced not repaired here", () => {
    expect(sub(arrow([Num], Num), arrow([Num], Num))).toEqual(NO);
    expect(valid(arrow([Num], Num), "std:negate")).toBe(true); // correct accept
    expect(valid(arrow([Num], Num), "std:not")).toBe(true); // WRONG accept — the D1 widening
    expect(valid(arrow([Str], Str), "std:negate")).toBe(true); // WRONG accept — the D1 widening
    expect(valid(arrow([Num, Num], Num), "std:negate")).toBe(false); // arity still refutes
  });

  test("the arrow-mint TRIPWIRE (P1(a.10)) — the nominal bridge must stay unlifted", () => {
    // A minted return-covariance rule would make the second cell `Just true`,
    // lifting the DISPUTED `t.sub.nominal-bridge` positive into an outer
    // definite. Mints need the bridge settled first.
    expect(sub(Int, IntOpaque)).toEqual(JT);
    expect(sub(arrow([Num], Int), arrow([Num], IntOpaque))).toEqual(NO);
  });
});
