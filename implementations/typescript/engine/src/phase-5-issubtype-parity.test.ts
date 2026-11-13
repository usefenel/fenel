// ---------------------------------------------------------------------------
// containment-substrate Phase 5 — the isSubtype → engine:subset parity gate.
//
// `isSubtype` is now a thin marshal SHIM: `isJustTrue(dispatchedSubset(a, b))`.
// Its ~240-line structural body was DELETED — the WHOLE algorithm (every
// structural arm + the named-hierarchy bridge + ref-resolution + co-induction +
// the two soundness fixes) lives in the Fenel `engine:subset` decider
// (containment.fenel). This test is the safety net for that swap:
//
//   (1) WIRING — `isSubtype(a,b) === isJustTrue(dispatchedSubset(a,b))` on every
//       corpus pair (the shim IS that; this pins it stays wired).
//   (2) FAITHFUL VERDICTS — the corpus is the union of the Step-0 probe corpus +
//       the `set-algebra.test.ts` isSubtype oracle inputs, each with its EXPECTED
//       Bool verdict (the faithful `isJustTrue ∘ dispatchedSubset` collapse). A
//       regression in any arm reds a row here.
//   (3) SOUNDNESS SWEEP — no `false → true` flip vs the legacy verdicts EXCEPT
//       the ONE sanctioned ACCEPT-more-precise case (`Number ⊆ union(Number,
//       String)`): the Fenel tier-2 `$union` arm decides this correctly `true`;
//       legacy `isSubtype` had no `$union` arm and fell to `false`. The swap
//       makes `isSubtype` MORE precise (genuinely sound true).
//       P1(a.6)'s old-true -> Tri-`Nothing` precision losses are tracked in a
//       separate tuple slot; they do not share this sanctioned-precision slot.
//   (4) THE DEFERRED CASE — `Nat-opaque ⊆ NonNegInt` (the opaque↔refined cross-
//       presentation, Phase-3 surprise #1): `dispatchedSubset` is `Nothing`
//       (the named bridge decides the base rung Nat⊆Int, the [0,∞) predicate
//       over the opaque stays undecidable), so `isJustTrue` is `false` — the
//       structural trio does NOT bridge the iso (a value-level witness, not
//       structural subtyping). Pinned with the explanatory note.
// ---------------------------------------------------------------------------

import { test, expect, describe } from "bun:test";
import { setDefaultTimeout } from "bun:test";

// type-substrate P1(a.5) — budget raise, no assertion weakened. This suite drives
// the INTERPRETED Fenel deciders, and P1(a.5) threaded an extra `rp` parameter
// through the disjoint walk (the `$opaque`-peel flag). That is a real cost: rows
// here measured 9.5 s against bun's 5 s default afterwards while their
// VERDICTS are unchanged. A red that is really a clock is how a genuine red went
// unnoticed at P1(a). Raise the budget; never weaken an assertion to fit it.
setDefaultTimeout(300_000);
import { isSubtype, isJustTrue } from "./set-algebra";
import {
  dispatchedSubset,
  type ContainmentDispatchOptions,
} from "./engine-bodies-dispatch";
import {
  Nat,
  Int,
  Bool,
  Char,
  Str,
  List,
  Maybe,
  Refined,
  Just,
  Nothing,
  foundationTemplates,
  Integer,
  NonNegInt,
} from "./type-foundation";
import type { FenelType, FieldKey } from "./types";
import type { ModuleRegistry } from "./registry";

const ft = foundationTemplates() as Record<string, unknown>;
const Ascii = Refined(Char, { $tag: "SeInterval", interval: { lo: Just({ value: 0, inclusive: true }), hi: Just({ value: 127, inclusive: true }) } });

let nextFieldId = 1;
const fieldKeys = new Map<string, FieldKey>();
const fieldWires = new Map<string, string>();
// These are real semantic field identities, not the invalid keyless fixtures
// that used to make both parity loops throw before reaching the decider. The
// registry below is fixture-local and contains exactly these record fields; it
// neither consults nor mutates the process-global/system registry.
const keyFor = (wireName: string): FieldKey => {
  const prior = fieldKeys.get(wireName);
  if (prior) return prior;
  const suffix = String(nextFieldId++).padStart(12, "0");
  const key: FieldKey = {
    $tag: "NamedField",
    ref: { $ref: `c1a60000-0000-4000-8000-${suffix}` },
  };
  fieldKeys.set(wireName, key);
  fieldWires.set(key.ref.$ref, wireName);
  return key;
};
const f = (n: string, t: unknown) => ({ name: n, key: keyFor(n), label: Nothing, type: t, meta: {}, ui: Nothing });
const rec = (fs: unknown[]) => ({ $record: { fields: fs } });
const vrt = (ns: string[]) => ({ $variant: { cases: ns.map((n) => ({ name: n, label: Nothing })) } });
const arrow = (ps: unknown[], r: unknown) => ({
  $arrow: {
    params: ps.map((t, i) => ({
      name: `_${i}`,
      key: { $tag: "PositionalField" as const, index: i },
      label: Nothing,
      type: t,
      meta: {},
      ui: Nothing,
    })),
    returns: r,
  },
});
const ref = (n: string) => ({ $ref: n });
const ri = (lo: number, hi: number) => ({
  $refined: {
    base: ref("Int"),
    set: { $tag: "SeInterval", interval: { lo: Just({ value: lo, inclusive: true }), hi: Just({ value: hi, inclusive: true }) } },
  },
});
const app = (c: string, ...a: unknown[]) => ({ $el: { call: [c, ...a] } });

const recordRegistry = {
  getFieldRepresentation: (typeName: string, fieldId: string) => {
    const wireName = fieldWires.get(fieldId);
    if (typeName !== "Codeable" || wireName === undefined) return undefined;
    return {
      typeName: "Codeable",
      args: [fieldId],
      methods: { codeName: wireName },
    };
  },
  resolveFieldPresentation: (fieldId: string) => {
    const wireName = fieldWires.get(fieldId);
    if (wireName === undefined) {
      throw new Error(`unresolved phase-5 fixture field ${fieldId}`);
    }
    return {
      label: wireName,
      source: "uuid-field-facet",
    };
  },
} as unknown as ModuleRegistry;
const RECORD_OPTIONS: ContainmentDispatchOptions = { registry: recordRegistry };

type Tri = { $tag: "Just"; _0: boolean } | { $tag: "Nothing" };
const TRI_NOTHING: Tri = { $tag: "Nothing" };
const exactTri = (value: boolean): Tri => ({ $tag: "Just", _0: value });

const P1A6_NAMED_CARRIER_ABSTENTION =
  "P1(a.6): named carrier needs unavailable validation-source context" as const;
const P1A6_OPEN_ERASABLE_WANT_ABSTENTION =
  "P1(a.6): open record cannot prove an absent erasable want axis" as const;
const P1A6_BOTTOM_MU_ABSTENTION =
  "P1(a.6): sound-mode bottom-mu shortcut is not a live-face proof" as const;
const P1A6_REFINED_NEGATIVE_ABSTENTION =
  "P1(a.6): positive-only refined containment cannot emit a negative" as const;
const P1A6_NAMED_ARM_NEGATIVE_ABSTENTION =
  "P1(a.6): Number/Int/Nat share one validator, so a named negative has no live-face witness" as const;
const P1A5_CROSS_KIND_ABSTENTION =
  "P1(a.5): cross-kind containment is fenced" as const;
const P1A7_ARROW_ABSTENTION =
  "P1(a.7): the sound arrow arm abstains — validation's paramCount axis and the flatten/written-arity divergence refute every verdict" as const;
const P1A7_MAP_ABSTENTION =
  "P1(a.7): the sound map arm abstains — ssMap's partial-dictionary key rule contradicts validationValidateMap's total-length finite arm" as const;
const P1A7_APP_ABSTENTION =
  "P1(a.7): the sound app arm abstains — TtApp.head is an arbitrary type-level function, so covariance is an unchecked premise" as const;
const P1A7_TUPLE_NEGATIVE_ABSTENTION =
  "P1(a.7): the sound tuple arm is positive-only — its negatives had no have-nonemptiness gate" as const;
const CONSERVATIVE_NAMED_NEGATIVE_ABSTENTION =
  "baseline: an absent named-hierarchy proof is not a negative proof" as const;
const CONSERVATIVE_OPAQUE_NEGATIVE_ABSTENTION =
  "baseline: distinct opaque names do not prove carrier exclusion" as const;
const CONSERVATIVE_UNION_NEGATIVE_ABSTENTION =
  "baseline: a union negative needs a definite result for every branch" as const;
type AbstentionReason =
  | typeof P1A6_NAMED_CARRIER_ABSTENTION
  | typeof P1A6_OPEN_ERASABLE_WANT_ABSTENTION
  | typeof P1A6_BOTTOM_MU_ABSTENTION
  | typeof P1A6_REFINED_NEGATIVE_ABSTENTION
  | typeof P1A6_NAMED_ARM_NEGATIVE_ABSTENTION
  | typeof P1A5_CROSS_KIND_ABSTENTION
  | typeof P1A7_ARROW_ABSTENTION
  | typeof P1A7_MAP_ABSTENTION
  | typeof P1A7_APP_ABSTENTION
  | typeof P1A7_TUPLE_NEGATIVE_ABSTENTION
  | typeof CONSERVATIVE_NAMED_NEGATIVE_ABSTENTION
  | typeof CONSERVATIVE_OPAQUE_NEGATIVE_ABSTENTION
  | typeof CONSERVATIVE_UNION_NEGATIVE_ABSTENTION;

// label, have, want, expected (the faithful collapse), [sanctioned-precision?],
// [Tri abstention reason?]. Keep the two optional evidence slots distinct:
// slot 4 remains the legacy false -> sound true allowlist; slot 5 records only
// exact Tri-Nothing outcomes (including old-true precision losses introduced by
// P1(a.6)'s sound fences and conservative rows that predate it).
// Slot 6 carries the exact per-call field-presentation scope when a row needs it.
type Row = [
  string,
  FenelType,
  FenelType,
  boolean,
  boolean?,
  AbstentionReason?,
  ContainmentDispatchOptions?,
];
const CORPUS: Row[] = [
  // atoms
  ["void ⊆ unit", { $void: true } as FenelType, { $unit: true } as FenelType, true],
  ["void ⊆ Int", { $void: true } as FenelType, ref("Int") as FenelType, true],
  ["unit ⊆ unit", { $unit: true } as FenelType, { $unit: true } as FenelType, true],
  ["unit ⊄ void", { $unit: true } as FenelType, { $void: true } as FenelType, false, undefined, P1A5_CROSS_KIND_ABSTENTION],
  // named hierarchy
  ["Nat ⊆ Int", ref("Nat") as FenelType, ref("Int") as FenelType, true],
  ["Int ⊆ ℝ", ref("Int") as FenelType, ref("ℝ") as FenelType, true],
  ["Bool ⊄ Int", ref("Bool") as FenelType, ref("Int") as FenelType, false, undefined, CONSERVATIVE_NAMED_NEGATIVE_ABSTENTION],
  // variant
  ["Color2 ⊆ Color3", vrt(["Red", "Blue"]) as FenelType, vrt(["Red", "Blue", "Green"]) as FenelType, true],
  ["Color3 ⊄ Color2", vrt(["Red", "Blue", "Green"]) as FenelType, vrt(["Red", "Blue"]) as FenelType, false],
  // record width + depth + erasable
  ["rec width", rec([f("x", ref("Nat")), f("y", ref("Nat"))]) as FenelType, rec([f("x", ref("Nat"))]) as FenelType, true, undefined, undefined, RECORD_OPTIONS],
  ["rec missing required", rec([f("x", ref("Nat"))]) as FenelType, rec([f("x", ref("Nat")), f("y", ref("Nat"))]) as FenelType, false, undefined, undefined, RECORD_OPTIONS],
  ["rec Maybe-field optional", rec([f("x", ref("Nat"))]) as FenelType, rec([f("x", ref("Nat")), f("y", Maybe(ref("Nat")))]) as FenelType, false, undefined, P1A6_OPEN_ERASABLE_WANT_ABSTENTION, RECORD_OPTIONS],
  ["rec Maybe-have for required-want", rec([f("x", Maybe(ref("Nat")))]) as FenelType, rec([f("x", ref("Nat"))]) as FenelType, false, undefined, undefined, RECORD_OPTIONS],
  ["rec depth covariant", rec([f("v", ref("Nat"))]) as FenelType, rec([f("v", ref("Int"))]) as FenelType, true, undefined, undefined, RECORD_OPTIONS],
  ["rec depth refutation", rec([f("v", ref("Int"))]) as FenelType, rec([f("v", ref("Nat"))]) as FenelType, false, undefined, P1A6_NAMED_ARM_NEGATIVE_ABSTENTION, RECORD_OPTIONS],
  // tuple
  ["tuple pairwise", { $tuple: [ref("Nat"), ref("Nat")] } as FenelType, { $tuple: [ref("Int"), ref("Int")] } as FenelType, true],
  ["tuple arity", { $tuple: [ref("Nat")] } as FenelType, { $tuple: [ref("Nat"), ref("Nat")] } as FenelType, false, undefined, P1A7_TUPLE_NEGATIVE_ABSTENTION],
  // map keys + values
  ["map narrower keys+values", { $map: { keys: { $tag: "SeEnum", values: ["a"] }, values: ref("Nat") } } as FenelType, { $map: { keys: { $tag: "SeEnum", values: ["a", "b"] }, values: ref("Int") } } as FenelType, false, undefined, P1A7_MAP_ABSTENTION],
  ["map wider keys", { $map: { keys: { $tag: "SeEnum", values: ["a", "b"] }, values: ref("Nat") } } as FenelType, { $map: { keys: { $tag: "SeEnum", values: ["a"] }, values: ref("Int") } } as FenelType, false, undefined, P1A7_MAP_ABSTENTION],
  ["map open supertype", { $map: { keys: { $tag: "SeEnum", values: ["a", "b"] }, values: ref("Int") } } as FenelType, { $map: { keys: { $tag: "SeRef", handle: "String" }, values: ref("Int") } } as FenelType, false, undefined, P1A7_MAP_ABSTENTION],
  // opaque atoms
  ["Nat ⊆ Nat (opaque)", Nat as FenelType, Nat as FenelType, false, undefined, P1A6_NAMED_CARRIER_ABSTENTION],
  ["Int ⊆ Int (opaque)", Int as FenelType, Int as FenelType, false, undefined, P1A6_NAMED_CARRIER_ABSTENTION],
  ["Bool ⊆ Bool (opaque)", Bool as FenelType, Bool as FenelType, true],
  ["opaque Foo ⊆ Foo", { $opaque: { name: "Foo" } } as FenelType, { $opaque: { name: "Foo" } } as FenelType, true],
  ["opaque Foo ⊄ Bar", { $opaque: { name: "Foo" } } as FenelType, { $opaque: { name: "Bar" } } as FenelType, false, undefined, CONSERVATIVE_OPAQUE_NEGATIVE_ABSTENTION],
  // refined
  ["refined set ⊆", ri(0, 10) as FenelType, ri(0, 100) as FenelType, true],
  ["refined set ⊄", ri(0, 100) as FenelType, ri(0, 10) as FenelType, false, undefined, P1A6_REFINED_NEGATIVE_ABSTENTION],
  ["refined forget", ri(0, 10) as FenelType, ref("Int") as FenelType, true],
  ["unrefined ⊄ refined", ref("Int") as FenelType, ri(0, 10) as FenelType, false, undefined, P1A6_REFINED_NEGATIVE_ABSTENTION],
  // Char / Str (opaque ↔ refined ↔ list)
  ["Char ⊆ Char", Char as FenelType, Char as FenelType, true],
  ["Char ⊆ Nat", Char as FenelType, Nat as FenelType, false, undefined, P1A6_NAMED_CARRIER_ABSTENTION],
  ["Nat ⊄ Char", Nat as FenelType, Char as FenelType, false, undefined, P1A6_REFINED_NEGATIVE_ABSTENTION],
  ["Ascii ⊆ Char", Ascii, Char as FenelType, true],
  ["Char ⊄ Ascii", Char as FenelType, Ascii, false, undefined, P1A6_REFINED_NEGATIVE_ABSTENTION],
  ["Str ⊆ Str", Str as FenelType, Str as FenelType, false, undefined, P1A6_NAMED_CARRIER_ABSTENTION],
  ["List(Char) ⊆ Str", List(Char) as FenelType, Str as FenelType, false, undefined, P1A6_NAMED_CARRIER_ABSTENTION],
  ["Str ⊆ List(Char)", Str as FenelType, List(Char) as FenelType, false, undefined, P1A6_NAMED_CARRIER_ABSTENTION],
  ["List(Nat) ⊄ Str", List(Nat) as FenelType, Str as FenelType, false, undefined, P1A6_NAMED_CARRIER_ABSTENTION],
  ["List(Ascii) ⊆ Str", List(Ascii) as FenelType, Str as FenelType, false, undefined, P1A6_NAMED_CARRIER_ABSTENTION],
  ["Str ⊄ List(Bool)", Str as FenelType, List(Bool) as FenelType, false, undefined, P1A6_NAMED_CARRIER_ABSTENTION],
  // List / Maybe congruence
  ["List(Nat) ⊆ List(Int)", List(ref("Nat")) as FenelType, List(ref("Int")) as FenelType, true],
  ["List(Int) ⊄ List(Nat)", List(ref("Int")) as FenelType, List(ref("Nat")) as FenelType, false, undefined, P1A6_NAMED_ARM_NEGATIVE_ABSTENTION],
  ["Maybe(Nat) ⊆ Maybe(Int)", Maybe(ref("Nat")) as FenelType, Maybe(ref("Int")) as FenelType, true],
  // arrow variance
  ["arrow identity", arrow([ref("Nat")], ref("Nat")) as FenelType, arrow([ref("Nat")], ref("Nat")) as FenelType, false, undefined, P1A7_ARROW_ABSTENTION],
  ["arrow contravariant param", arrow([ri(1, 3)], ref("Nat")) as FenelType, arrow([ri(1, 2)], ref("Nat")) as FenelType, false, undefined, P1A7_ARROW_ABSTENTION],
  ["arrow arity", arrow([ref("Nat")], ref("Nat")) as FenelType, arrow([ref("Nat"), ref("Nat")], ref("Nat")) as FenelType, false, undefined, P1A7_ARROW_ABSTENTION],
  // $el.call (TtApp)
  ["app F Nat ⊆ app F Int", app("F", ref("Nat")) as FenelType, app("F", ref("Int")) as FenelType, false, undefined, P1A7_APP_ABSTENTION],
  ["app F ⊄ app G", app("F", ref("Nat")) as FenelType, app("G", ref("Int")) as FenelType, false, undefined, P1A7_APP_ABSTENTION],
  // tier-2 union — the SANCTIONED accept-more-precise (legacy false → new true)
  ["Number ⊆ union(Number,String) [SANCTIONED precision]", ref("Number") as FenelType, { $union: [ref("Number"), ref("String")] } as FenelType, true, true],
  ["union(Number,String) ⊄ Number", { $union: [ref("Number"), ref("String")] } as FenelType, ref("Number") as FenelType, false, undefined, CONSERVATIVE_UNION_NEGATIVE_ABSTENTION],
  // mu
  ["μX.X ⊆ μX.X (bottom, no loop)", { $mu: { var: "X", body: { $var: "X" } } } as FenelType, { $mu: { var: "X", body: { $var: "X" } } } as FenelType, false, undefined, P1A6_BOTTOM_MU_ABSTENTION],
  ["μX.X ⊆ Int (bottom ⊆ anything)", { $mu: { var: "X", body: { $var: "X" } } } as FenelType, ref("Int") as FenelType, false, undefined, P1A6_BOTTOM_MU_ABSTENTION],
];

describe("Phase 5 — isSubtype shim wiring (=== isJustTrue ∘ dispatchedSubset)", () => {
  for (const [label, a, b, , , , options] of CORPUS) {
    test(`wiring: ${label}`, () => {
      expect(isSubtype(a, b, undefined, undefined, options)).toBe(
        isJustTrue(dispatchedSubset(a, b, options) as never),
      );
    });
  }
});

  describe("Phase 5 — isSubtype faithful verdicts (the full-Fenel port)", () => {
    for (const [label, a, b, expected, , , options] of CORPUS) {
      test(`verdict: ${label}`, () => {
        expect(isSubtype(a, b, undefined, undefined, options)).toBe(expected);
      });
    }
  });

describe("Phase 5 — soundness sweep + the deferred opaque↔refined case", () => {
  test("the ONLY sanctioned false→true is Number ⊆ union(Number,String) (more precise)", () => {
    // The single sanctioned precision improvement is the tier-2 $union arm
    // (legacy had none ⇒ fell to false; the Fenel decider proves the genuine
    // sound true). P1(a.6) abstentions live in slot 5 and cannot enter this filter.
    const sanctioned = CORPUS.filter((r) => r[4] === true);
    expect(sanctioned.length).toBe(1);
    expect(isSubtype(
      sanctioned[0]![1],
      sanctioned[0]![2],
      undefined,
      undefined,
      sanctioned[0]![6],
    )).toBe(true);
  });

  // type-substrate P1(a.7) added NINE rows to this list in one transaction: the
  // tuple arity negative (its refutations had no have-nonemptiness gate), all
  // three map rows (the partial-dictionary key rule contradicts validation's
  // total-length finite arm), all three arrow rows (two independent implemented
  // refuters survive every arrow verdict), and both app rows (`TtApp.head` is an
  // arbitrary type-level function, so covariance is an unchecked premise). Each
  // is a PRICED loss with a named recovery — see ledger rows `t.sub.tuple`,
  // `t.sub.map`, `t.sub.arrow`, `t.sub.app`.
  test("exact Tri abstentions are exactly the enumerated conservative rows", () => {
    const abstentions = CORPUS.filter((r) => r[5] !== undefined);
    expect(abstentions.map(([label]) => label)).toEqual([
      "unit ⊄ void",
      "Bool ⊄ Int",
      "rec Maybe-field optional",
      "rec depth refutation",
      "tuple arity",
      "map narrower keys+values",
      "map wider keys",
      "map open supertype",
      "Nat ⊆ Nat (opaque)",
      "Int ⊆ Int (opaque)",
      "opaque Foo ⊄ Bar",
      "refined set ⊄",
      "unrefined ⊄ refined",
      "Char ⊆ Nat",
      "Nat ⊄ Char",
      "Char ⊄ Ascii",
      "Str ⊆ Str",
      "List(Char) ⊆ Str",
      "Str ⊆ List(Char)",
      "List(Nat) ⊄ Str",
      "List(Ascii) ⊆ Str",
      "Str ⊄ List(Bool)",
      "List(Int) ⊄ List(Nat)",
      "arrow identity",
      "arrow contravariant param",
      "arrow arity",
      "app F Nat ⊆ app F Int",
      "app F ⊄ app G",
      "union(Number,String) ⊄ Number",
      "μX.X ⊆ μX.X (bottom, no loop)",
      "μX.X ⊆ Int (bottom ⊆ anything)",
    ]);
    const mismatches: Array<{ label: string; actual: Tri; wanted: Tri }> = [];
    for (const [label, have, want, expected, , reason, options] of CORPUS) {
      const wanted = reason === undefined ? exactTri(expected) : TRI_NOTHING;
      const actual = dispatchedSubset(have, want, options) as Tri;
      const equal = actual.$tag === wanted.$tag
        && (actual.$tag === "Nothing" || (wanted.$tag === "Just" && actual._0 === wanted._0));
      if (!equal) mismatches.push({ label, actual, wanted });
    }
    expect(mismatches).toEqual([]);
  });

  test("DEFERRED — Nat-opaque ⊆ NonNegInt is false (the iso is a value-witness, not structural)", () => {
    // dispatchedSubset = Nothing (the named bridge decides the base rung Nat ⊆ Int;
    // the [0,∞) predicate over the opaque Peano stays undecidable) ⇒ isJustTrue
    // false. The opaque (inductive) ↔ refined cross-presentation is NOT structurally
    // bridged (Phase-3 surprise #1); ⟦Nat⟧ = ⟦NonNegInt⟧ holds only via the
    // value-level round-trips (the numeric tower witnesses), record-and-defer.
    expect(isSubtype(ft.Nat as FenelType, NonNegInt)).toBe(false);
    expect(isSubtype(ft.Int as FenelType, Integer)).toBe(false);
  });
});
