// ---------------------------------------------------------------------------
// type-substrate P1(a.5) — the Tt object-carrier sort model, failed closed.
//
// Brief: `workstreams/type-substrate/briefs/phase-1a5-tt-object-carrier-fail-closed.md`
//
// `containment.fenel` used to read "distinct rigid former ⇒ `Just true` disjoint"
// (`disjointLeaf`), "atomic name vs rigid former ⇒ `Just true`" (`disjointNamed`),
// and "kinds differ ⇒ `Just false`" (`resolveArm`). All three are PRODUCER claims
// promoted to claims about the host-value universe — the same error P1(a)
// retracted one core over (`dis.arrow.ctor`). Formers are not sorts: the FACES
// decide which host values inhabit a type, and there the object formers overlap.
//
// WHAT THIS FILE PINS, and why each pin is worth its runtime:
//   1. Every fail-closed cell, with its shared witness EXECUTED at a real
//      membership face — so the pin is evidence, not a comment. A witness that
//      stops inhabiting both sides makes the pin fail, which is the point.
//   2. Every surviving `Just true` with the host partition it cites.
//   3. The picker view (`typeSubsumes`) byte-identical — the whole repair sits
//      BELOW `ssResolve`'s picker split.
//   4. DISCRIMINATING pins (search `DISCRIMINATES`): each fails on exactly ONE
//      reverted clause of the repair. The P1(a) precedent — a repair with no
//      discriminating pin is a repair nobody will notice being undone.
//
// THE EVIDENCE RULE this phase established, restated because every reader needs
// it: at the `validate` face, `validationOk value` (an IDENTITY accept) is
// membership evidence; `validationOk (f value)` is a COERCION and is not. That
// is why `validate(String, 42).valid === true` is NOT a counterexample to the
// scalar partition — `validationValidateString` returns a coerced value. And a
// face with NO arm for a kind (`decompose`'s `_ -> true`, `validate`'s `VtOther`
// refuse-all, a keyless `SeAll` projection) is a DEGRADE: never evidence, in
// either direction.
// ---------------------------------------------------------------------------

import { test, expect, describe } from "bun:test";
import {
  dispatchedDisjointType,
  dispatchedSubset,
  dispatchedEmpty,
  dispatchedMatchesShape,
  universeTypeSubsumes,
} from "./engine-bodies-dispatch";
import { validate } from "./validate";
import { Void, List, Maybe, Int, Nat } from "./type-foundation";
import type { ModuleRegistry } from "./registry";
import type { FieldKey } from "./types";

import { setDefaultTimeout } from "bun:test";

// type-substrate P1(a) — bun's 5 s per-test default is wrong for this file: it
// drives the INTERPRETED Fenel deciders, and on a slow Windows host individual
// assertions measure 5-75 s. A suite that reports clock as failure is a gate
// nobody can read. Raise the budget; never weaken an assertion to fit it.
setDefaultTimeout(300_000);

type Tri = { $tag: "Just"; _0: boolean } | { $tag: "Nothing" };
const JT: Tri = { $tag: "Just", _0: true };
const JF: Tri = { $tag: "Just", _0: false };
const NO: Tri = { $tag: "Nothing" };

const dis = (a: unknown, b: unknown) => dispatchedDisjointType(a, b) as Tri;
const sub = (a: unknown, b: unknown) => dispatchedSubset(a, b) as Tri;
const emp = (t: unknown) => dispatchedEmpty(t) as Tri;

const Num = { $ref: "Number" };
const Str = { $ref: "String" };
const Bool = { $ref: "Boolean" };

let nextFieldId = 1;
const namedKeys = new Map<string, FieldKey>();
const keyFor = (axis: string): FieldKey => {
  const prior = namedKeys.get(axis);
  if (prior) return prior;
  const suffix = String(nextFieldId++).padStart(12, "0");
  const key: FieldKey = {
    $tag: "NamedField",
    ref: { $ref: `00000000-0000-4000-8000-${suffix}` },
  };
  namedKeys.set(axis, key);
  return key;
};
const field = (name: string, type: unknown, key: FieldKey = keyFor(name)) => ({
  name,
  key,
  type,
});

// ── The six rigid formers, in their canonical spellings ────────────────────
const RECORD = { $record: { fields: [] } }; // the OPEN empty record
const VARIANT = { $variant: { cases: [{ name: "P", fields: [] }] } };
const TUPLE = { $tuple: [Num] };
const MAP = { $map: { values: Num } };
const ARROW = { $arrow: { params: [], returns: Num } };
const UNIT = { $unit: true };

// `Vec(Number, 3)` — a `$map` whose key domain is `Fin 3`. Spelled out rather
// than imported so the pin survives a `dependent-types` refactor: what matters
// is that a `$map` over a finite interval key domain EXISTS and takes arrays.
const VEC3 = {
  $map: {
    keys: {
      $tag: "SeInterval",
      interval: {
        lo: { $tag: "Just", _0: { value: 0, inclusive: true } },
        hi: { $tag: "Just", _0: { value: 3, inclusive: false } },
      },
    },
    values: Num,
  },
};
const TUPLE3 = { $tuple: [Num, Num, Num] };

// ===========================================================================
// 1 — the FAIL-CLOSED cells, each with its shared witness EXECUTED
// ===========================================================================
describe("P1(a.5) — cross-former disjointness fails closed, with live witnesses", () => {
  test("record{} ∩ variant P{} ∋ {$tag:'P'} — MEASURED at two real faces", () => {
    const w = { $tag: "P" };
    // face (B) matchesShape: real record arm (DcvObject, no declared fields) and
    // real variant arm (DcvObject + matching tag).
    expect(dispatchedMatchesShape(w, RECORD as never)).toBe(true);
    expect(dispatchedMatchesShape(w, VARIANT as never)).toBe(true);
    // face (C) validate: both real arms, both IDENTITY accepts.
    expect(validate(RECORD as never, w, null).valid).toBe(true);
    expect(validate(VARIANT as never, w, null).valid).toBe(true);
    // ⇒ the intersection is inhabited, so the old `Just true` was a false definite.
    expect(dis(RECORD, VARIANT)).toEqual(NO);
    expect(dis(VARIANT, RECORD)).toEqual(NO); // commutative
    // Both subset directions abstain too. NOTE the trap the brief names: the
    // OLD `Just false` for `record{} ⊆ variant P{}` happened to be TRUE ({} is in
    // the record and in no variant case) while its mirror was FALSE. A rule that
    // cannot see subset's direction is not a denotation — so both abstain, and
    // the accidentally-right polarity is NOT preserved.
    expect(sub(RECORD, VARIANT)).toEqual(NO);
    expect(sub(VARIANT, RECORD)).toEqual(NO);
  });

  test("record{} ∩ arrow ∋ {__fenelFn:…} — the closure witness needs no chimera", () => {
    const closure = { __fenelFn: { params: [], body: 1 } };
    expect(dispatchedMatchesShape(closure, RECORD as never)).toBe(true);
    expect(validate(RECORD as never, closure, null).valid).toBe(true);
    // validationValidateArrow's callable-record arm — an IDENTITY accept.
    expect(validate(ARROW as never, closure, null).valid).toBe(true);
    expect(dis(RECORD, ARROW)).toEqual(NO);
    expect(dis(ARROW, RECORD)).toEqual(NO);
    expect(sub(RECORD, ARROW)).toEqual(NO);
    expect(sub(ARROW, RECORD)).toEqual(NO);
  });

  test("record{} ∩ map ∋ {} and ∩ unit ∋ {} — the open object carrier", () => {
    expect(dispatchedMatchesShape({}, RECORD as never)).toBe(true);
    expect(dispatchedMatchesShape({}, MAP as never)).toBe(true);
    expect(dispatchedMatchesShape({}, UNIT as never)).toBe(true);
    expect(validate(RECORD as never, {}, null).valid).toBe(true);
    expect(validate(MAP as never, {}, null).valid).toBe(true);
    expect(dis(RECORD, MAP)).toEqual(NO);
    expect(dis(RECORD, UNIT)).toEqual(NO);
    expect(dis(MAP, UNIT)).toEqual(NO);
  });

  test("variant P{} ∩ map ∋ {$tag:'P'}, and ∩ arrow ∋ the LIVE chimera", () => {
    const w = { $tag: "P" };
    expect(dispatchedMatchesShape(w, MAP as never)).toBe(true);
    expect(dispatchedMatchesShape(w, VARIANT as never)).toBe(true);
    expect(dis(VARIANT, MAP)).toEqual(NO);
    expect(dis(MAP, ARROW)).toEqual(NO);

    // The variant/arrow cell is MEASURED, not derived: this is EXACTLY the
    // chimera whose Se twin forced the 8λ.1 `SeArrow ⊥ SeCtor` retraction at
    // P1(a) — a tagged record that is ALSO a callable — and here it inhabits
    // both sorts at ONE face, through two REAL implemented arms, both identity
    // accepts. No cross-face argument needed.
    const chimera = { $tag: "P", __fenelFn: { params: [], body: 1 } };
    expect(validate(VARIANT as never, chimera, null).valid).toBe(true);
    expect(validate(ARROW as never, chimera, null).valid).toBe(true);
    expect(dis(VARIANT, ARROW)).toEqual(NO);

    // `variant × unit` is MEASURED, not derived: P1(a.6)'s exact
    // `Maybe(Unit)` forwards the untagged `{}` carrier to its inner Unit face,
    // while Unit accepts that same `{}`. This ordinary `P{}` control refuses
    // `{}`, proving only that its particular case encoding differs; it cannot
    // promote the whole variant kind into a disjoint host sort.
    expect(dispatchedMatchesShape({}, UNIT as never)).toBe(true);
    expect(dispatchedMatchesShape({}, VARIANT as never)).toBe(false);
    expect(dispatchedMatchesShape(w, UNIT as never)).toBe(false);
    expect(dis(VARIANT, UNIT)).toEqual(NO);
  });

  test("DISCRIMINATES ttHostSortExclusive: map ∩ tuple ∋ [1,2,3] via Vec(Number,3)", () => {
    // The kind `map` does NOT fix the carrier: `Vec(n)` is a `$map` over `Fin n`
    // and its validate arm accepts a host ARRAY, identically. So the
    // `Array.isArray` partition — the one axis this phase still cites — does not
    // separate `map` from `tuple`, and `map` is excluded from the allow-list.
    expect(validate(VEC3 as never, [1, 2, 3], null).valid).toBe(true);
    expect(dispatchedMatchesShape([1, 2, 3], TUPLE3 as never)).toBe(true);
    expect(dis(VEC3, TUPLE3)).toEqual(NO);
    expect(dis(MAP, TUPLE)).toEqual(NO);
    expect(sub(VEC3, TUPLE3)).toEqual(NO);
    expect(sub(TUPLE3, VEC3)).toEqual(NO);
  });

  test("DISCRIMINATES ttArrayExclusiveKind's arrow exclusion: a DECORATED ARRAY is callable", () => {
    // `json-logic.ts:isClosure/isPartial/isRef` all test `typeof val === "object"`
    // plus a key and NEVER consult `Array.isArray`; `typeof [] === "object"`. So
    // arrowhood is a MARKER on a plain host object, not a host sort, and the
    // engine's own application gate would invoke this value.
    const callableArray: unknown[] = [];
    Object.assign(callableArray, { $ref: "someFn" });
    expect(Array.isArray(callableArray)).toBe(true);
    expect(dispatchedMatchesShape(callableArray, { $tuple: [] } as never)).toBe(true);
    // validate's array refusal is `validationIsRecord` POLICY (it excludes
    // isArray) and the Se face re-encodes the same convention — one convention
    // counted twice, not two independent witnesses, and nothing enforces it.
    expect(dis(ARROW, TUPLE)).toEqual(NO);
    expect(sub(ARROW, TUPLE)).toEqual(NO);
    expect(sub(TUPLE, ARROW)).toEqual(NO);
  });
});

// ===========================================================================
// 2 — the SURVIVING definites, each citing its host partition
// ===========================================================================
describe("P1(a.5) — the Array.isArray partition survives, and only it", () => {
  test("tuple ⊥ record / unit — arrays are refused by every implemented arm", () => {
    expect(dispatchedMatchesShape([1], RECORD as never)).toBe(false);
    expect(validate(RECORD as never, [1], null).valid).toBe(false);
    expect(dis(TUPLE, RECORD)).toEqual(JT);
    expect(dis(RECORD, TUPLE)).toEqual(JT);
    expect(dis(TUPLE, UNIT)).toEqual(JT);
    // `variant` is NOT here — see the round-2 block below. A bare `$variant`
    // does refuse arrays, but the KIND does not imply that, so the cell went.
    expect(dispatchedMatchesShape([1], VARIANT as never)).toBe(false);
    expect(dis(TUPLE, VARIANT)).toEqual(NO);
  });

  test("the THIN one — unit rests on a single real face, so pin its witness", () => {
    // `decomposeMatchesUnit` accepts only `DcvNull` or an EMPTY `DcvObject`, and
    // `marshalDcValue` routes EVERY array to the separate `DcvArray` case, so an
    // array can never reach the unit arm. `validate` has no unit arm at all
    // (the `VtOther` refuse-all — a DEGRADE, not evidence that unit is ∅).
    expect(dispatchedMatchesShape([], UNIT as never)).toBe(false);
    expect(dispatchedMatchesShape([1], UNIT as never)).toBe(false);
    expect(dispatchedMatchesShape({}, UNIT as never)).toBe(true);
    expect(dispatchedMatchesShape(null, UNIT as never)).toBe(true);
    expect(dis(UNIT, TUPLE)).toEqual(JT);
  });

  test("same-kind pairs still coarsen (unchanged)", () => {
    expect(dis(RECORD, RECORD)).toEqual(NO);
    expect(dis(TUPLE, TUPLE)).toEqual(NO);
    expect(dis(MAP, MAP)).toEqual(NO);
    expect(dis(ARROW, ARROW)).toEqual(NO);
    expect(dis(UNIT, UNIT)).toEqual(NO);
  });
});

// ===========================================================================
// 3 — the NAMED-atom arm, narrowed to the sorts each former genuinely refuses
// ===========================================================================
describe("P1(a.5) — disjointNamed: the typeof partition, minus what formers accept", () => {
  test("DISCRIMINATES ttNamedSortExclusive's arrow exclusion: a fnId STRING is an arrow value", () => {
    // `validationValidateArrow`'s `isString` branch is an IDENTITY accept that
    // looks the name up and checks arity + signature subtype. The Ref substrate
    // is type-TRANSPARENT and `AGENTS.md` Cornerstone 4 states it outright:
    // "a method is a fnId, `Ref`, closure or partial".
    // The Se arrow face ABSTAINS on strings rather than refuting, so nothing
    // underwrites a definite either way.
    expect(validate(ARROW as never, "someFnName", null).valid).toBe(true);
    expect(validate(ARROW as never, "", null).valid).toBe(true);
    expect(dis(Str, ARROW)).toEqual(NO);
    expect(dis(ARROW, Str)).toEqual(NO);
  });

  test("DISCRIMINATES ttNamedSortExclusive's map exclusion: a $map refuses no host sort", () => {
    // locale arm ⇒ bare strings; enum-key arm ⇒ any value at all; Fin-n ⇒ arrays.
    expect(validate(MAP as never, "someFnName", null).valid).toBe(true);
    const mapEnum = { $map: { keys: { $enum: ["a", "b"] }, values: Num } };
    expect(validate(mapEnum as never, 42, null).valid).toBe(true);
    expect(validate(mapEnum as never, [1], null).valid).toBe(true);
    expect(dis(Str, MAP)).toEqual(NO);
    expect(dis(Num, MAP)).toEqual(NO);
    expect(dis(Bool, MAP)).toEqual(NO);
  });

  test("Number / Boolean vs arrow SURVIVE — typeof is closed at the callable gate too", () => {
    // `isClosure` requires `typeof val === "object"`, so a raw number or boolean
    // can never be a callable — no face, and not the evaluator, disagrees.
    expect(validate(ARROW as never, 42, null).valid).toBe(false);
    expect(validate(ARROW as never, true, null).valid).toBe(false);
    expect(dis(Num, ARROW)).toEqual(JT);
    expect(dis(Bool, ARROW)).toEqual(JT);
  });

  test("the scalar partition survives against the object/array formers", () => {
    for (const atom of [Num, Str, Bool]) {
      expect(dis(atom, RECORD)).toEqual(JT);
      expect(dis(atom, TUPLE)).toEqual(JT);
      expect(dis(atom, UNIT)).toEqual(JT);
      expect(dis(atom, VARIANT)).toEqual(NO); // round 2 — canonical Maybe forwards
    }
    // ...and `validate(String, 42).valid === true` is NOT a counterexample: that
    // is `validationOk (validationStringCoerce value)`, a COERCION. The identity
    // vs coerced distinction is the evidence rule this phase runs on.
    expect(validate(Str as never, 42, null).valid).toBe(true);
  });
});

// ===========================================================================
// 4 — the SUBSET terminal: an allow-list plus a nonemptiness gate
// ===========================================================================
describe("P1(a.5) — the cross-kind subset terminal (a FENCE, round 2)", () => {
  test("the terminal ABSTAINS unconditionally — all three blockers pinned", () => {
    // Blocker 2 — ∅ ⊆ everything. `subsetW`'s only emptiness short-circuits are
    // SYNTACTIC (`$void`, `μX.X`), so a genuinely-empty record REFUTED against a
    // tuple. A restored refutation must gate on `empty have = Just false`.
    const emptyRecord = {
      $record: {
        fields: [field("_0", Void, { $tag: "PositionalField", index: 0 })],
      },
    };
    expect(emp(emptyRecord)).toEqual(JT); // provably uninhabited
    expect(sub(emptyRecord, TUPLE)).toEqual(NO);

    // Named fields need their exact live projection before record emptiness may
    // use an occurrence type.  Keep this fixture local: no system/global
    // registry can accidentally make the registry-less control plan-ready.
    const namedVoidKey = keyFor("p1a5-empty-named");
    const namedEmptyRecord = {
      $record: { fields: [field("voidAxis", Void, namedVoidKey)] },
    };
    expect(emp(namedEmptyRecord)).toEqual(NO);
    if (namedVoidKey.$tag !== "NamedField") {
      throw new Error("expected a named fixture field");
    }
    const namedVoidId = namedVoidKey.ref.$ref;
    const namedEmptyRegistry = {
      getFieldRepresentation: (typeName: string, fieldId: string) =>
        typeName === "Codeable" && fieldId === namedVoidId
          ? {
              typeName: "Codeable",
              args: [namedVoidId],
              methods: { codeName: "voidAxis" },
            }
          : undefined,
      resolveFieldPresentation: (fieldId: string) => {
        if (fieldId !== namedVoidId) {
          throw new Error(`unresolved P1(a.5) fixture field ${fieldId}`);
        }
        return {
          label: "Void axis",
          display: { widget: { $tag: "Just", _0: "text" } },
          source: "uuid-field-facet",
        };
      },
    } as unknown as ModuleRegistry;
    expect(dispatchedEmpty(namedEmptyRecord, { registry: namedEmptyRegistry })).toEqual(JT);
    // Blocker 3 — the PEEL. Unlike `disjointW`, the subset walk has no `rp` flag,
    // and `$opaque` swaps the carrier: `Int` peels to `$record` while holding
    // NUMBERS. So the kind pair here describes PURE views, and no carrier
    // partition is available at all. Hence even a nonempty have abstains.
    expect(emp(RECORD)).toEqual(JF); // decidably NONempty...
    expect(sub(RECORD, TUPLE)).toEqual(NO); // ...and it still abstains
    expect(sub(TUPLE, RECORD)).toEqual(NO);
    expect(sub(TUPLE, UNIT)).toEqual(NO);
  });

  test("the disjoint/subset asymmetry is CORRECT — do not 'fix' it", () => {
    // `unit ⊥ tuple` is `Just true` — `disjointW` threads the peel flag, so its
    // carrier rule is sound. `unit ⊆ tuple` is `Nothing` — the subset walk does
    // not thread it, and no consumer distinguishes `Just false` from `Nothing`
    // there anyway (`isSubtype` is `isJustTrue`; `conformCongruent` is a Kleene
    // `mAnd`), so the flag was priced and deliberately not built.
    expect(dis(UNIT, TUPLE)).toEqual(JT);
    expect(sub(UNIT, TUPLE)).toEqual(NO);
    expect(sub(TUPLE, UNIT)).toEqual(NO);
  });

  test("DISCRIMINATES the exclusivity gate: mu / var / tagged never refute", () => {
    // None of these is a host sort, and all three reached the old blanket
    // `Just false`. Each is a measured false definite retired here.
    const muVariant = {
      $mu: { var: "X", body: { $variant: { cases: [{ name: "P", fields: [] }] } } },
    };
    expect(dispatchedMatchesShape({ $tag: "P" }, muVariant as never)).toBe(true);
    expect(dispatchedMatchesShape({ $tag: "P" }, RECORD as never)).toBe(true);
    expect(sub(muVariant, RECORD)).toEqual(NO);

    // a free type-var: instantiate `a := record{}` and the subset holds, so no
    // instantiation-independent refutation exists.
    expect(sub({ $var: "a" }, RECORD)).toEqual(NO);

    // `$tagged` peels on the disjoint side and on same-kind subset (value
    // erasure) but NOT cross-kind — it used to refute instead. The `⊆ record{}`
    // direction is the sharpest: under the value-erasure reading this register
    // already grants at `t.sub.tagged`, the two sides denote the SAME set, so the
    // old `Just false` was refuting a subset that holds.
    const tagged = { $tagged: { value: RECORD, phantom: Str } };
    expect(sub(tagged, VARIANT)).toEqual(NO);
    expect(sub(tagged, RECORD)).toEqual(NO);
  });
});

// ===========================================================================
// 4b — ROUND 2: the peel, and the variant kind that does not fix its carrier
// ===========================================================================
// Both holes were found by the result-review round on the FIRST landing of this
// phase, which had kept `variant` in the allow-lists and had no peel flag. Both
// are the SAME argument that removed `$map`: the KIND does not fix the carrier.
describe("P1(a.5) round 2 — the carrier survives neither the peel nor the kind", () => {
  test("DISCRIMINATES the rp flag: an $opaque peels to a kind that lies about its values", () => {
    // `Int` is `$opaque { pure = $record … }` and `Nat` is `$opaque { pure =
    // $variant … }`, yet both hold host NUMBERS. `disjoint` peels `$opaque`
    // BEFORE the leaf, so these reached `named × record` / `named × variant` and
    // answered `Just true` against `{$ref:"Number"}` — while every natural
    // number inhabits both sides. The `rp` flag is what stops it.
    expect(Object.keys(Int as never)[0]).toBe("$opaque");
    expect(Object.keys(Nat as never)[0]).toBe("$opaque");
    expect(dis(Num, Int)).toEqual(NO);
    expect(dis(Num, Nat)).toEqual(NO);
    // ...while the SAME rule still fires on an un-peeled operand.
    expect(dis(Num, RECORD)).toEqual(JT);
  });

  test("DISCRIMINATES the rp gate on the TAG arm: List vs Maybe(List)", () => {
    // The THIRD definite emitter below the peel, and the one a two-predicate fix
    // leaves live. `disjointNonFormer` routes two variants to `disjointVariant`
    // BEFORE the leaf, and that arm decides by the PURE ADT's constructor tags —
    // which say nothing about host inhabitants once an `$opaque` has been peeled.
    // `List` peels to `Nil | Cons`, shares no tag with `Nothing | Just`, and the
    // arm returned `Just true` while `[1]` inhabits BOTH at both real faces.
    // `untaggedToVariant` consumes that verdict as a positive disjointness PROOF.
    const LN = List(Num as never);
    const MLN = Maybe(LN as never);
    expect(dispatchedMatchesShape([1], LN as never)).toBe(true);
    expect(dispatchedMatchesShape([1], MLN as never)).toBe(true);
    expect(validate(LN as never, [1], null).valid).toBe(true);
    expect(validate(MLN as never, [1], null).valid).toBe(true);
    expect(dis(LN, MLN)).toEqual(NO);
    expect(dis(MLN, LN)).toEqual(NO); // commutative
    // ...and the tag arm still DECIDES on an un-peeled variant pair, which is the
    // whole point of gating on `rp` rather than deleting the arm.
    expect(dis(Maybe(Num as never), Maybe({ $ref: "String" } as never))).toEqual(JF);
    expect(dis(VARIANT, { $variant: { cases: [{ name: "Q", fields: [] }] } })).toEqual(JT);
  });

  test("DISCRIMINATES the variant exclusion: List is array-repped, Maybe forwards", () => {
    const LN = List(Num as never);
    const MLN = Maybe(LN as never);
    const MN = Maybe(Num as never);
    // `List` is `$opaque` over a `$variant` whose LIVE values are host arrays.
    expect(dispatchedMatchesShape([1], LN as never)).toBe(true);
    expect(validate(LN as never, [1], null).valid).toBe(true);
    expect(dispatchedMatchesShape([1], TUPLE as never)).toBe(true);
    expect(dis(LN, TUPLE)).toEqual(NO);
    expect(sub(TUPLE, LN)).toEqual(NO);

    // `Maybe` is a BARE `$variant` — no wrapper at all — and
    // `validationValidateMaybe` FORWARDS a non-null untagged value to its inner
    // type unchanged. So the peel flag alone would not have caught these two:
    // the `variant` kind itself had to leave both allow-lists.
    expect(validate(MLN as never, [1], null).valid).toBe(true);
    expect(dis(MLN, TUPLE)).toEqual(NO);
    expect(validate(MN as never, 42, null).valid).toBe(true);
    expect(dis(Num, MN)).toEqual(NO);
  });
});

// ===========================================================================
// 5 — ttTopCover: `$map` can no longer be proven PROPER by its kind
// ===========================================================================
describe("P1(a.5) — ttTopCover's rigid arm, narrowed for $map AND $variant", () => {
  test("DISCRIMINATES the ttTopCover map arm: empty(¬map) abstains", () => {
    // `topCover(t)` asks "is `t` the universe?". For a rigid former the answer
    // used to be an unconditional `Just false`. An enum-keyed `$map` accepts ANY
    // value identically at its validate arm, and canonical `Maybe` — a bare
    // `$variant` — forwards, so `Maybe (Map<enum,_>)` accepts everything too;
    // neither KIND can prove properness. The other rigid formers still can
    // (`42` is outside all of them). RESIDUAL, stated: this face has no `rp`
    // flag, so a future `$opaque` whose pure view is record/tuple/unit/arrow but
    // whose representation accepts every value would defeat the remainder.
    expect(emp({ $complement: MAP })).toEqual(NO);
    expect(emp({ $complement: RECORD })).toEqual(JF);
    expect(emp({ $complement: TUPLE })).toEqual(JF);
    expect(emp({ $complement: ARROW })).toEqual(JF);
  });
});

// ===========================================================================
// 6 — the PICKER view is byte-identical (the repair is below the split)
// ===========================================================================
describe("P1(a.5) — typeSubsumes (picker mode) is unmoved", () => {
  test("every cross-former pair still collapses exactly as before", () => {
    // `ssResolve` returns `Just false` immediately when `picker` is true, so the
    // FunctionPicker never reaches `resolveArm` / `ttSubsetSortRefute`. Pin the
    // whole cross-former grid so a future edit above the split is caught.
    const ops: Array<[string, unknown]> = [
      ["record", RECORD],
      ["variant", VARIANT],
      ["tuple", TUPLE],
      ["map", MAP],
      ["arrow", ARROW],
      ["unit", UNIT],
    ];
    for (const [an, a] of ops) {
      for (const [bn, b] of ops) {
        const expected = an === bn;
        expect(universeTypeSubsumes(a, b), `${an} <: ${bn}`).toBe(expected);
      }
    }
    // and the named-atom row, likewise unmoved.
    expect(universeTypeSubsumes(Str, ARROW)).toBe(false);
    expect(universeTypeSubsumes(Num, MAP)).toBe(false);
  });

  test("the ONE un-picker-gated route into disjoint — the complement want-arm", () => {
    // Found by this phase's own consumer census, not by either design reviewer:
    // `subsetWK`'s `wk == "complement"` arm calls `ttDisjoint have inner` with NO
    // picker flag, so a picker-mode subset against a `¬X` want DOES reach the
    // repaired disjoint face. The picker is nevertheless unmoved, and the reason
    // is worth pinning rather than trusting: every P1(a.5) cell changed here went
    // `Just true` → `Nothing`, and `typeSubsumes` collapses `Nothing → true`, so
    // these P1(a.5) picker answers stayed identical. This is not a permanent
    // admission-monotonicity law: P1(a.6) M4 has a live `null` witness for the
    // opposite definite and its flagless transit is deliberately classified
    // `proved-refute-exclude`, while its direct picker route remains unchanged.
    expect(universeTypeSubsumes(RECORD, { $complement: VARIANT })).toBe(true);
    expect(universeTypeSubsumes(Str, { $complement: ARROW })).toBe(true);
    expect(universeTypeSubsumes(RECORD, { $complement: TUPLE })).toBe(true);

    // The SOUND member DOES move here, which proves the route is live and that
    // the pin above is testing something rather than passing vacuously.
    expect(sub(RECORD, { $complement: VARIANT })).toEqual(NO); // was Just true
    expect(sub(RECORD, { $complement: TUPLE })).toEqual(JT); // the surviving partition
  });
});

// ===========================================================================
// 7 — the cardinal fence: no `Just` this phase emits may be wrong
// ===========================================================================
describe("P1(a.5) — the Tri fence over the whole rigid grid", () => {
  test("every surviving cross-former `Just true` is the tuple/array partition", () => {
    const ops: Array<[string, unknown]> = [
      ["record", RECORD],
      ["variant", VARIANT],
      ["tuple", TUPLE],
      ["map", MAP],
      ["arrow", ARROW],
      ["unit", UNIT],
    ];
    const arrayExclusive = new Set(["record", "unit"]);
    for (const [an, a] of ops) {
      for (const [bn, b] of ops) {
        if (an === bn) continue;
        const v = dis(a, b) as Tri;
        const expected =
          (an === "tuple" && arrayExclusive.has(bn)) ||
          (bn === "tuple" && arrayExclusive.has(an))
            ? JT
            : NO;
        expect(v, `disjoint(${an}, ${bn})`).toEqual(expected);
        expect(dis(b, a), `commutative(${an}, ${bn})`).toEqual(v);
      }
    }
  });
});
