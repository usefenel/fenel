// ---------------------------------------------------------------------------
// containment-substrate Phase 2.4 — the variant-disjoint-by-tag arm.
//
// The `engine:disjoint` body (fenel/modules/engine/containment.fenel) now decides
// variant-vs-variant disjointness BY CONSTRUCTOR TAG: `disjoint(V[Yes], V[No]) =
// Just true` because distinct tags force it (no value carries a tag in both).
// Pre-2.4 both `$variant`s fell to `disjointLeaf`'s same-shape arm and coarsened
// to `Nothing` (Step-2 surprise #3's gap). This closes the ISO-2 tag-disjointness
// side-condition at the variant-TYPE level (it was already decidable at the
// tag/enum level via set:decideDisjoint).
//
// The locked soundness spec (brief §"the locked soundness spec"):
//  1. sharedTags = tags(da) ∩ tags(db).
//  2. NO shared tag ⇒ Just true.
//  3. Shared tags ⇒ mAnd-fold of productDisjoint(payload_da[t], payload_db[t]):
//     disjoint iff EVERY shared tag's payloads are disjoint; overlap iff SOME
//     shared tag's payloads provably overlap (a unit / proven-non-disjoint payload).
//
// The FENCES (verified below): NO `Nothing → Just` (the trio's cardinal rule);
// `disjoint` is COMMUTATIVE; byte-identity of every NON-variant-vs-variant decision
// (a variant vs a record / named still routes through the unchanged leaf cascade).
// ---------------------------------------------------------------------------

import { test, expect, describe } from "bun:test";
import { setDefaultTimeout } from "bun:test";

// type-substrate P1(a.5) — the same budget raise P1(a) applied to ten sibling
// files, extended here: bun's 5 s per-test default is wrong for a suite that
// drives the INTERPRETED Fenel deciders, and on a slow Windows host the
// whole-corpus soundness sweep in this file measures ~110 s. Three rows were
// reporting CLOCK as failure, which is a gate nobody can read. Budget raised;
// no assertion weakened.
setDefaultTimeout(300_000);
import { dispatchedDisjointType } from "./engine-bodies-dispatch";
import type { ModuleRegistry } from "./registry";
import { setExprAsType } from "./type-foundation";
import type { FenelType, FieldKey, SetExpr } from "./types";

// --- Tri (the trio's Maybe<Bool>) ------------------------------------------
type Tri = { $tag: "Just"; _0: boolean } | { $tag: "Nothing" };
const JT: Tri = { $tag: "Just", _0: true };
const JF: Tri = { $tag: "Just", _0: false };
const NO: Tri = { $tag: "Nothing" };

// --- FenelType builders ----------------------------------------------------
const Num: FenelType = { $ref: "Number" } as unknown as FenelType;
const Str: FenelType = { $ref: "String" } as unknown as FenelType;
// a singleton string-enum refinement (a proven-non-disjoint payload when shared).
const enumT = (vals: string[]): FenelType =>
  setExprAsType(Str, { $enum: vals } as unknown as SetExpr);
let nextFieldId = 1;
const namedKeys = new Map<string, FieldKey>();
const liveFieldWires = new Map<string, string>();
const liveFieldRegistry = {
  getFieldRepresentation: (typeName: string, fieldId: string) => {
    const wireName = liveFieldWires.get(fieldId);
    if (typeName !== "Codeable" || wireName === undefined) return undefined;
    return {
      typeName: "Codeable",
      args: [fieldId],
      methods: { codeName: wireName },
    };
  },
  resolveFieldPresentation: (fieldId: string) => {
    const wireName = liveFieldWires.get(fieldId);
    if (wireName === undefined) throw new Error(`unresolved fixture field ${fieldId}`);
    return { label: wireName, source: "uuid-field-facet" };
  },
} as unknown as ModuleRegistry;
const exactOptions = { registry: liveFieldRegistry };
const dis = (a: unknown, b: unknown) =>
  dispatchedDisjointType(a, b, exactOptions) as Tri;
const keyFor = (axis: string): FieldKey => {
  const prior = namedKeys.get(axis);
  if (prior) return prior;
  const suffix = String(nextFieldId++).padStart(12, "0");
  const fieldId = `20000000-0000-4000-8000-${suffix}`;
  const key: FieldKey = {
    $tag: "NamedField",
    ref: { $ref: fieldId },
  };
  namedKeys.set(axis, key);
  liveFieldWires.set(fieldId, axis);
  return key;
};
type Field = { name: string; key: FieldKey; type: FenelType };
const f = (name: string, type: FenelType, key: FieldKey = keyFor(name)): Field => ({
  name,
  key,
  type,
});
const c = (name: string, fields: Field[] = []) => ({ name, fields });
const V = (cases: { name: string; fields: Field[] }[]): FenelType =>
  ({ $variant: { cases } }) as unknown as FenelType;

// every Phase-2.4 verdict must be SOUND: never a `Nothing → Just` (a wrong proof).
// A characterization test pins the EXACT verdict; this asserts the weaker invariant
// over the whole corpus as a backstop.
const isSound = (v: Tri) =>
  v.$tag === "Nothing" || (v.$tag === "Just" && typeof v._0 === "boolean");

// ===========================================================================
// S3 — the characterization net.
// ===========================================================================
describe("Phase 2.4 — variant-vs-variant disjointness by tag", () => {
  test("distinct tags ⇒ Just true (the headline: distinct constructors force disjointness)", () => {
    // V[Yes] and V[No] share NO tag ⇒ no value co-inhabits ⇒ disjoint.
    expect(dis(V([c("Yes")]), V([c("No")]))).toEqual(JT);
    // multi-case, fully tag-disjoint.
    expect(dis(V([c("A"), c("B")]), V([c("C"), c("D")]))).toEqual(JT);
  });

  test("shared unit tag ⇒ Just false (the bare constructor value inhabits both)", () => {
    // V[Yes,No] and V[Yes,Maybe] share the nullary tag Yes ⇒ both contain the bare
    // `Yes` value ⇒ they overlap ⇒ NON-disjoint.
    expect(dis(V([c("Yes"), c("No")]), V([c("Yes"), c("Maybe")]))).toEqual(JF);
    // identical single-nullary-case variants overlap on their one shared value.
    expect(dis(V([c("Yes")]), V([c("Yes")]))).toEqual(JF);
  });

  test("shared tag with DISJOINT payloads ⇒ Just true", () => {
    // shared tag T, payloads Number vs String ⇒ disjoint payloads (different named
    // value-domains) ⇒ no value carries T in both ⇒ disjoint.
    expect(dis(V([c("T", [f("x", Num)])]), V([c("T", [f("x", Str)])]))).toEqual(JT);
  });

  test("shared named payload axes align by UUID across rename/reorder", () => {
    const first = keyFor("rename-first");
    const second = keyFor("rename-second");
    const a = V([c("T", [
      f("oldFirst", Num, first),
      f("oldSecond", Num, second),
    ])]);
    const b = V([c("T", [
      f("oldSecond", Num, second),
      f("oldFirst", Num, first),
    ])]);
    expect(dis(a, b)).toEqual(JF);
    expect(dis(b, a)).toEqual(JF);
  });

  test("same UUID with conflicting embedded rename snapshots abstains", () => {
    const first = keyFor("rename-first");
    const second = keyFor("rename-second");
    const a = V([c("T", [
      f("oldFirst", Num, first),
      f("oldSecond", Num, second),
    ])]);
    const b = V([c("T", [
      f("newSecond", Num, second),
      f("newFirst", Num, first),
    ])]);
    expect(dis(a, b)).toEqual(NO);
    expect(dis(b, a)).toEqual(NO);
  });

  test("same wire spelling with different UUIDs is an unaligned payload axis", () => {
    const a = V([c("T", [f("value", Num, keyFor("payload-left"))])]);
    const b = V([c("T", [f("value", Str, keyFor("payload-right"))])]);
    expect(dis(a, b)).toEqual(NO);
  });

  test("shared tag overlap is decided only when the payload witness lifts through its type", () => {
    // A definitionally inhabited identical named payload gives a genuine shared
    // T-value, so the product refutes disjointness.
    expect(dis(V([c("T", [f("x", Num)])]), V([c("T", [f("x", Num)])]))).toEqual(JF);
    // Predicate-set overlap alone does not prove refined(base,set) overlap: the
    // common set value could be outside the base. Phase 3c drops the old false
    // Just and honestly abstains until a base-membership witness is carried.
    expect(
      dis(V([c("T", [f("x", enumT(["a"]))])]), V([c("T", [f("x", enumT(["a"]))])])),
    ).toEqual(NO);
  });

  test("3+ cases, mixed: all shared payloads disjoint + da-only case ⇒ Just true", () => {
    // shared A (Num|Str disjoint), shared B (Str|Num disjoint), da-only C, db-only D.
    const a = V([c("A", [f("x", Num)]), c("B", [f("x", Str)]), c("C")]);
    const b = V([c("A", [f("x", Str)]), c("B", [f("x", Num)]), c("D")]);
    expect(dis(a, b)).toEqual(JT);
  });

  test("3+ cases, mixed: a shared nullary tag overlaps ⇒ Just false (overlap dominates)", () => {
    // shared A (disjoint payloads), shared nullary B (overlaps), da-only C, db-only D.
    const a = V([c("A", [f("x", Num)]), c("B"), c("C")]);
    const b = V([c("A", [f("x", Str)]), c("B"), c("D")]);
    expect(dis(a, b)).toEqual(JF);
  });

  test("commutativity — disjoint da db ≡ disjoint db da", () => {
    const pairs: [FenelType, FenelType][] = [
      [V([c("Yes")]), V([c("No")])],
      [V([c("Yes"), c("No")]), V([c("Yes"), c("Maybe")])],
      [V([c("T", [f("x", Num)])]), V([c("T", [f("x", Str)])])],
      [V([c("A", [f("x", Num)]), c("B"), c("C")]), V([c("A", [f("x", Str)]), c("B"), c("D")])],
    ];
    for (const [x, y] of pairs) {
      expect(dis(x, y)).toEqual(dis(y, x));
    }
  });

  test("$mu-recursive variant — terminates + stays sound", () => {
    // μX. Nil | Cons { head: Number, tail: X } — a CYCLIC FenelType. The disjoint
    // marshaller treats `$mu` as a leaf (no descent into its body), so marshalling
    // a variant whose case field references the μ terminates; the body's variant
    // recursion bottoms at the `$mu` leaf. Both the marshal and the decision halt.
    const muList: { $mu: { var: string; body: unknown } } = {
      $mu: { var: "X", body: null },
    };
    muList.$mu.body = {
      $variant: {
        cases: [c("Nil"), c("Cons", [f("head", Num), f("tail", muList as unknown as FenelType)])],
      },
    };
    const recVar = muList.$mu.body as unknown as FenelType;
    // The point of this row is that it RETURNS on a cyclic operand; the verdict
    // is secondary, and after type-substrate P1(a.6) both directions abstain.
    // `recVar` carries a `tail` field typed by a non-List μ, which validation
    // refuses wholesale (`VtOther "mu"`), so the operand is not plan-ready and
    // the readiness gate gates the whole operand rather than the individual case
    // pair. That is a PRICED precision loss, not a correction: the
    // `{$tag:"Nil"}` overlap witness never visits the μ coordinate, so both old
    // `Just false` results were sound. Recovering them needs a carrier-fact
    // argument (a witness that provably avoids the unready coordinate) and is
    // out of phase — see `t.sub.plan-ready-gate`'s priced-loss note.
    // This test is therefore now purely a TERMINATION oracle; the arm's ability
    // to still emit `Just false` is covered by every other row in this file.
    expect(dis(recVar, recVar)).toEqual(NO);
    expect(dis(recVar, V([c("Nil")]))).toEqual(NO);
  });
});

// ===========================================================================
// The FENCES — byte-identity of non-variant decisions + soundness.
// ===========================================================================
describe("Phase 2.4 — fences (byte-identity of non-variant decisions, soundness)", () => {
  test("a variant vs a NON-variant routes through the unchanged leaf cascade", () => {
    // The variant arm fires ONLY when BOTH operands are `$variant`; a mixed pair
    // still falls to `disjointLeaf`. What the LEAF now answers changed at
    // type-substrate P1(a.5): the "different shape tags ⇒ Just true" structural
    // rule is RETRACTED as a producer claim, so a variant vs a RECORD abstains —
    // `{$tag:"Yes"}` inhabits both (the open record declares no fields, and
    // `matchesShape` / `validate` both accept it there). The variant vs a NAMED
    // SCALAR still proves, on the surviving `typeof` partition.
    // This pin's ROUTE is unchanged; only the leaf's verdict moved. See
    // `type-substrate-p1a5-tt-object-carrier.test.ts` for the witnesses.
    const rec: FenelType = { $record: { fields: [f("x", Num)] } } as unknown as FenelType;
    expect(dis(V([c("Yes")]), rec)).toEqual(NO);
    expect(dis(rec, V([c("Yes")]))).toEqual(NO);
    // A variant vs a NAMED SCALAR also abstains, as of P1(a.5)'s round-2
    // narrowing: canonical `Maybe` is a bare `$variant` whose validate arm
    // FORWARDS a non-null untagged value to its inner type, so `42` inhabits
    // `Maybe Number` — the `$variant` KIND does not imply tagged-object
    // membership, and the atom-vs-variant cell had to go with the rest.
    expect(dis(V([c("Yes")]), Num)).toEqual(NO);
  });

  test("NO Nothing → Just: every variant-pair verdict is sound", () => {
    const variants: FenelType[] = [
      V([c("Yes")]),
      V([c("No")]),
      V([c("Yes"), c("No")]),
      V([c("T", [f("x", Num)])]),
      V([c("T", [f("x", Str)])]),
      V([c("A", [f("x", Num)]), c("B"), c("C")]),
      V([]),
    ];
    for (const a of variants) {
      for (const b of variants) {
        const v = dis(a, b) as Tri;
        expect(isSound(v)).toBe(true);
        expect(dis(a, b)).toEqual(dis(b, a)); // commutative over the whole corpus
      }
    }
  });

  test("two empty variants ($none-like) ⇒ Just true (no shared tag, vacuously disjoint)", () => {
    // V[] has no constructors ⇒ no shared tag with anything ⇒ Just true. Reference
    // the NO sentinel so an unused-import lint never masks a future regression.
    expect(dis(V([]), V([c("Yes")]))).toEqual(JT);
    expect(NO.$tag).toBe("Nothing");
  });
});
