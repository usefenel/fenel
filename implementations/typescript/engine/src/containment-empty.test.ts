// ---------------------------------------------------------------------------
// set-algebra-to-fenel Phase 6 Step 3 — the SOUND `empty` (containment.fenel).
//
// `engine:empty` is the containment relation's UNARY member: a sound `⟦t⟧ = ∅`
// (is the type uninhabited?) decider returning Tri. These tests pin every arm's
// SOUNDNESS — void / refined (via set:decideEmpty) / opaque-transparent / record
// (product: any-factor-empty) / variant (sum: all-cases-empty) / tuple / map / the
// `$mu` voidVar flag-flip (least fixpoint) / tagged / and the arrow rule
// (return-empty AND all-params-inhabited). The seam is `dispatchedEmpty`
// (engine-bodies-dispatch.ts) — marshal-only; the decision is the `.fenel` body.
//
// SOUNDNESS INVARIANT (the gate for every assertion): `Just true ⇒ provably ∅`,
// `Just false ⇒ provably inhabited`, `Nothing ⇒ undecided`. Never a false
// `Just true`/`Just false`. The refined arm deliberately returns `Nothing` rather
// than a `Just false` over a refined base (the Nat ∩ {<0} disjoint-refinement gap —
// see containment.fenel `emptyRefined` + notes/phase-6-step3-step0-probe.md §4).
// ---------------------------------------------------------------------------

import { test, expect, describe } from "bun:test";
import {
  dispatchedEmpty,
  dispatchedMatchesShape,
  dispatchedPeelList,
} from "./engine-bodies-dispatch";
import { Str, Void } from "./type-foundation";
import type { ModuleRegistry } from "./registry";
import type { FieldKey } from "./types";
import { validate } from "./validate";
import { getSystemEvaluateContext } from "./system-registry";

import { setDefaultTimeout } from "bun:test";

// type-substrate P1(a) — bun's 5 s per-test default is wrong for this file: it
// drives the INTERPRETED Fenel deciders, and on a slow Windows host individual
// assertions measured 5-75 s BEFORE this phase and after it (verdicts identical
// either side). A suite that reports clock as failure is a gate nobody can read,
// which is how a real red in the sibling tcb-recheck suite went unnoticed. Raise
// the budget; never weaken an assertion to fit it.
setDefaultTimeout(300_000);

type Tri = { $tag: "Just"; _0: boolean } | { $tag: "Nothing" };
const JT: Tri = { $tag: "Just", _0: true };
const JF: Tri = { $tag: "Just", _0: false };
const NO: Tri = { $tag: "Nothing" };

const Num = { $ref: "Number" };
const refined = (set: unknown) => ({ $refined: { base: Num, set } });
let nextFieldId = 1;
const namedKeys = new Map<string, FieldKey>();
const namedKey = (axis: string): FieldKey => {
  const prior = namedKeys.get(axis);
  if (prior) return prior;
  const suffix = String(nextFieldId++).padStart(12, "0");
  const key: FieldKey = {
    $tag: "NamedField",
    ref: { $ref: `10000000-0000-4000-8000-${suffix}` },
  };
  namedKeys.set(axis, key);
  return key;
};
const field = (name: string, type: unknown, key?: FieldKey) => {
  const positional = /^_(\d+)$/.exec(name);
  return {
    name,
    key: key ?? (positional
      ? { $tag: "PositionalField" as const, index: Number(positional[1]) }
      : namedKey(name)),
    type,
  };
};
const rec = (fs: unknown[]) => ({ $record: { fields: fs } });
const unit = rec([]); // the unit record {} — inhabited
const variantC = (cases: { name: string; fields?: unknown[] }[]) => ({
  $variant: { cases: cases.map((c) => ({ name: c.name, fields: c.fields ?? [] })) },
});
const arrow = (ps: unknown[], r: unknown) => ({
  $arrow: {
    params: ps.map((t, i) => field(`p${i}`, t, namedKey(`arrow-param-${i}`))),
    returns: r,
  },
});
const tup = (...ts: unknown[]) => ({ $tuple: ts });
const map = (v: unknown) => ({ $map: { values: v } });
const Maybe = (value: unknown) => variantC([
  { name: "Nothing" },
  { name: "Just", fields: [field("_0", value)] },
]);
const Result = (error: unknown, value: unknown) => variantC([
  { name: "Err", fields: [field("_0", error)] },
  { name: "Ok", fields: [field("_0", value)] },
]);
const listHeadKey: FieldKey = {
  $tag: "NamedField",
  ref: { $ref: "ffd5bf84-d5d7-4755-a3c9-649b4adbf994" },
};
const listTailKey: FieldKey = {
  $tag: "NamedField",
  ref: { $ref: "f604d45e-9b60-4b72-83ce-755d2780162c" },
};
const listBody = (
  elem: unknown,
  tail: unknown = { $ref: "List" },
  headKey: FieldKey = listHeadKey,
  tailKey: FieldKey = listTailKey,
) => variantC([
  { name: "Nil" },
  {
    name: "Cons",
    fields: [
      field("head", elem, headKey),
      field("tail", tail, tailKey),
    ],
  },
]);
const List = (elem: unknown) => ({
  $opaque: {
    name: "List",
    pure: listBody(elem),
  },
});
const MuList = (elem: unknown) => ({
  $mu: {
    var: "X",
    body: listBody(elem, { $var: "X" }),
  },
});

const e = (t: unknown, registry?: ModuleRegistry) => dispatchedEmpty(
  t,
  registry === undefined ? undefined : { registry },
) as Tri;

describe("Phase 6 Step 3 — empty: leaves + transparency", () => {
  test("void is provably empty (Just true)", () => {
    expect(e(Void)).toEqual(JT);
  });
  test("a KNOWN atom is decidably NONEMPTY (Number ⇒ Just false — 8λ.1-r: the atom tower is inhabited BY CONSTRUCTION, no registry hop needed; unknown entity names stay Nothing)", () => {
    // Re-pinned strictly-better (was Nothing): 0 witnesses Number definitionally.
    // The widening is what lets emptyArrow certify param-inhabitance, which the
    // arrowSub emptiness gate (the ∅-arrow ⊆ B soundness fix) depends on.
    expect(e(Num)).toEqual(JF);
    expect(e({ $ref: "Bot" })).toEqual(NO); // a registered entity could be Void-like ⇒ still honest
  });
  test("map always inhabits (the empty map) ⇒ Just false", () => {
    expect(e(map(Num))).toEqual(JF);
  });
});

describe("Phase 6 Step 3 — refined leaf (via set:decideEmpty, SOUND direction only)", () => {
  test("an empty enum refinement is provably empty: refined {$enum:[]} ⇒ Just true", () => {
    expect(e(refined({ $enum: [] }))).toEqual(JT);
  });
  test("a non-empty refinement over a refined base is UNDECIDED (Nothing), NOT Just false", () => {
    // The sound correction: decideEmpty({1,2,3}) = Just false, but base-inhabited ∧
    // set-non-empty does NOT prove the intersection inhabited (Nat ∩ {<0} gap) — so
    // the refined arm surfaces Nothing, never a refined inhabited-claim. (probe §4)
    expect(e(refined({ $enum: [1, 2, 3] }))).toEqual(NO);
  });
});

describe("Phase 6 Step 3 — record (product): empty iff ANY field empty", () => {
  test("a void field makes the product empty: {x: Void} ⇒ Just true", () => {
    expect(e(rec([field("_0", Void)]))).toEqual(JT);
  });
  test("the empty record {} is the unit type — inhabited ⇒ Just false", () => {
    expect(e(unit)).toEqual(JF);
  });
  test("all-inhabited fields ⇒ Just false: {x: {}} (the only field is the unit)", () => {
    expect(e(rec([field("_0", unit)]))).toEqual(JF);
  });
});

describe("Phase 6 Step 3 — variant (sum): empty iff ALL cases empty", () => {
  test("all cases carry a void field ⇒ Just true", () => {
    expect(e(variantC([
      { name: "A", fields: [field("_0", Void)] },
      { name: "B", fields: [field("_0", Void)] },
    ]))).toEqual(JT);
  });
  test("a nullary case inhabits ⇒ Just false: (A | B{_0: Void})", () => {
    expect(e(variantC([{ name: "A" }, { name: "B", fields: [field("_0", Void)] }]))).toEqual(JF);
  });
  test("the empty case-list is Void-like ⇒ Just true", () => {
    expect(e(variantC([]))).toEqual(JT);
  });
});

describe("Phase 6 Step 3 — tuple (product)", () => {
  test("a void item makes the tuple empty: (Number, Void) ⇒ Just true", () => {
    expect(e(tup(Num, Void))).toEqual(JT);
  });
  test("all-inhabited items ⇒ Just false: ({}, {})", () => {
    expect(e(tup(unit, unit))).toEqual(JF);
  });
});

describe("Phase 6 Step 3 — opaque transparency + Maybe/Result (canonical encodings)", () => {
  test("Maybe Void inhabits (Nothing) ⇒ Just false", () => {
    expect(e(Maybe(Void))).toEqual(JF);
  });
  test("Result Void Void is empty (both arms carry Void) ⇒ Just true", () => {
    expect(e(Result(Void, Void))).toEqual(JT);
  });
  test("Maybe Number inhabits (Nothing AND Just) ⇒ Just false", () => {
    expect(e(Maybe(Num))).toEqual(JF);
  });
});

describe("Phase 6 Step 3 — the $mu voidVar flag-flip (least fixpoint)", () => {
  // A genuinely-empty recursive type: μX. Cons { head: Number, tail: X } with NO
  // base (Nil) case. Substituting Void for the recursive occurrence kills the only
  // constructor (its `tail` field is empty) ⇒ no inhabitant ⇒ Just true. This is
  // the voidVar design end-to-end (the canonical List above uses {$ref:"List"} not
  // {$var}, so its Nil case decides it WITHOUT the flag — this is the real flip).
  const emptyMu = {
    $mu: {
      var: "X",
      body: variantC([{
        name: "Cons",
        fields: [field("_0", Num), field("_1", { $var: "X" })],
      }]),
    },
  };
  // type-substrate P1(a.6) reconciliation: both μ rows below now ABSTAIN, and the
  // pair is the clearest statement of why. Neither is a live List face
  // (`peelList` is null), so validation elaborates them to `VtOther "mu"` and
  // refuses EVERY value, while `matchesShape`'s unrecognized-μ fallback accepts.
  // The faces disagree in opposite directions: validation confirms `emptyMu` is
  // empty and denies that `inhabMu` is inhabited; `matchesShape` does exactly the
  // reverse. A structural verdict cannot be lifted over a leaf the two live faces
  // contradict each other about, so the honest answer is `Nothing` in both
  // directions — the same reason `t.sub.mu-congruence` is MISSING and the `μX.X`
  // half of the old bottom axiom was split out into `t.sub.bottom-mu-live`.
  test("μX. Cons{head:Number, tail:X} (no Nil) has no agreed live face ⇒ Nothing", () => {
    expect(dispatchedPeelList(emptyMu as never)).toBeNull();
    expect(e(emptyMu)).toEqual(NO);
  });
  const inhabMu = {
    $mu: {
      var: "X",
      body: variantC([
        { name: "Nil" },
        {
          name: "Cons",
          fields: [field("_0", Num), field("_1", { $var: "X" })],
        },
      ]),
    },
  };
  test("μX. Nil | Cons{head:Number, tail:X} has no agreed live face ⇒ Nothing", () => {
    expect(dispatchedPeelList(inhabMu as never)).toBeNull();
    expect(e(inhabMu)).toEqual(NO);
  });
});

describe("type-substrate P1(a.6) — carrier-honest exact List emptiness", () => {
  const opaqueNumber = List(Num);
  const immediateMuNumber = MuList(Num);

  test("canonical opaque and immediate-mu Lists use the live [] witness", () => {
    expect(dispatchedPeelList(opaqueNumber as never)).not.toBeNull();
    expect(dispatchedPeelList(immediateMuNumber as never)).not.toBeNull();
    expect(e(opaqueNumber)).toEqual(JF);
    expect(e(immediateMuNumber)).toEqual(JF);
    expect(validate(opaqueNumber as never, [], null, { coerce: false }).valid).toBe(true);
    expect(validate(immediateMuNumber as never, [], null, { coerce: false }).valid).toBe(true);
    expect(dispatchedMatchesShape([], opaqueNumber as never)).toBe(true);
    expect(dispatchedMatchesShape([], immediateMuNumber as never)).toBe(true);
  });

  test("one ordinary opaque peel reaches a nested exact List, but direct tagged ADT does not", () => {
    const nested = { $opaque: { name: "Outer", pure: opaqueNumber } };
    expect(e(nested)).toEqual(JF);
    expect(e(listBody(Num))).toEqual(NO);
  });

  test("the empty-array witness is independent of element inhabitance and tail contents", () => {
    expect(e(List(Void))).toEqual(JF);
    const tailBlind = {
      $opaque: {
        name: "TailBlindList",
        pure: listBody(Num, { $ref: "String" }, listHeadKey, namedKey("weird-list-tail")),
      },
    };
    expect(dispatchedPeelList(tailBlind as never)).not.toBeNull();
    expect(e(tailBlind)).toEqual(JF);
    expect(validate(tailBlind as never, [], null, { coerce: false }).valid).toBe(true);
    expect(dispatchedMatchesShape([], tailBlind as never)).toBe(true);
  });

  test("invented List-head identity and hidden refinement stay outside the live rule", () => {
    const inventedHead = {
      $opaque: {
        name: "NearList",
        pure: listBody(Num, { $ref: "List" }, namedKey("invented-list-head")),
      },
    };
    expect(dispatchedPeelList(inventedHead as never)).toBeNull();
    expect(e(inventedHead)).toEqual(NO);

    const hiddenEmpty = {
      $opaque: {
        name: "HiddenRefinedList",
        pure: { $refined: { base: listBody(Num), set: { $tag: "SeNone" } } },
      },
    };
    expect(e(hiddenEmpty)).toEqual(JT);
  });

  test("unready element plans abstain, including with an explicitly supplied registry", () => {
    // A supplied registry is validation's field authority: its evaluate
    // context carries the frozen current-wire index (validate.ts). This one
    // knows no field, so the index is empty; its functions are the system's.
    const registry = {
      getFieldRepresentation: () => undefined,
      resolveFieldPresentation: () => {
        throw new Error("no fixture field presentation");
      },
      evaluateContext: () => ({
        ...getSystemEvaluateContext(),
        _fieldCurrentWire: Object.freeze(Object.create(null)),
        _fieldCurrentWireAmbiguous: Object.freeze(Object.create(null)),
      }),
    } as unknown as ModuleRegistry;
    const namedElement = List({ $ref: "AccountOnlyElement" });
    expect(dispatchedPeelList(namedElement as never)).not.toBeNull();
    expect(e(namedElement)).toEqual(NO);
    expect(e(namedElement, registry)).toEqual(NO);

    const unresolvedFieldElement = List(rec([
      field("accountOnly", Num, namedKey("unresolved-list-element-field")),
    ]));
    expect(e(unresolvedFieldElement)).toEqual(NO);
    expect(e(unresolvedFieldElement, registry)).toEqual(NO);
    // Without a registry, validation deliberately uses the embedded snapshot
    // and the runtime List walk visits no element for `[]`.  Once an explicit
    // registry scopes identity, the missing live projection fails eager
    // planning even for `[]`; containment abstains in both contexts.
    expect(validate(unresolvedFieldElement as never, [], null, { coerce: false }).valid).toBe(true);
    const scoped = validate(unresolvedFieldElement as never, [], null, {
      registry,
      coerce: false,
    });
    expect(scoped.valid).toBe(false);
    // The refusal is the supplied registry's missing projection, not a degrade.
    expect(JSON.stringify(scoped.errors)).toContain("validation field projection: no fixture field presentation");
    expect(validate(unresolvedFieldElement as never, [{}], null, { coerce: false }).valid).toBe(false);
    expect(dispatchedMatchesShape([], unresolvedFieldElement as never)).toBe(true);
  });

  test("Str is not silently reclassified through its nonprimitive Char element", () => {
    expect(e(Str)).toEqual(NO);
  });
});

describe("Phase 6 Step 3 — arrow (LOCKED full rule: return-empty AND all-params-inhabited)", () => {
  // type-substrate P1(a.7) — the exponential law's EMPTY leg is FENCED. It is
  // conceptually derivable and FALSE at validation's implemented arrow arm,
  // which accepts "" for EVERY arrow type (validate.fenel:1523-1524), so no
  // arrow's live population is empty. The two `Just false` (inhabited) clauses
  // are entitled under both readings and are RETAINED below. Ledger row
  // `t.emp.arrow` (THEOREM → SIDE-CONDITIONED).
  test("({} -> Void) — PRICED LOSS at P1(a.7), was Just true (the fenced empty leg)", () => {
    expect(e(arrow([unit], Void))).toEqual(NO);
  });
  // type-substrate P1(a.8) — the two clauses are now FACTOR-GATED, and these
  // fixtures key their params with a NamedField whose projection no registry in
  // this file supplies. `ttSlotsPlanReady` is exact-caller-registry scoped and
  // fails closed, so a registry-less named-param arrow ABSTAINS — the same
  // doctrine P1(a.6) already ships for registry-less named RECORDS. The clauses
  // themselves are retained and are pinned on the POSITIONAL variant below.
  // Ledger `t.emp.arrow`; recovery is a registry-carrying caller, not a rule.
  test("(Number -> {}) with a NAMED param key: registry-less ⇒ Nothing (P1(a.8) factor gate)", () => {
    expect(e(arrow([Num], unit))).toEqual(NO);
  });
  test("(Void -> Number) with a NAMED param key: registry-less ⇒ Nothing (P1(a.8) factor gate)", () => {
    expect(e(arrow([Void], Num))).toEqual(NO);
  });
  test("POSITIONAL params: both INHABITED clauses are retained through the gate", () => {
    // The evidence the two tests above used to carry, on fixtures whose param
    // slots ARE plan-ready: a positional key needs only a non-empty wire name.
    const pos = (ps: unknown[], r: unknown) => ({
      $arrow: {
        params: ps.map((t, i) => field(`_${i}`, t)),
        returns: r,
      },
    });
    expect(e(pos([Num], unit))).toEqual(JF);
    expect(e(pos([Void], Num))).toEqual(JF);
    // …and the gate still bites on a factor validation cannot plan, whatever
    // the key kind: a non-primitive named param type is not plan-ready.
    expect(e(pos([{ $ref: "Bot" }], Num))).toEqual(NO);
  });
  test("(Number -> Void) — PRICED LOSS at P1(a.7), was Just true (8λ.1-r's closed law)", () => {
    // 8λ.1-r's atom-tower widening still computes the law; only its POSITIVE
    // (empty) leg is now fenced, because "" inhabits this arrow at validation.
    expect(e(arrow([Num], Void))).toEqual(NO);
  });

  test("the honest residue, and the P1(a.8) factor gate over it", () => {
    // The cascade: a nested arrow param whose emptiness was the fenced leg
    // WITHDRAWS its vacuity proof (JF → Nothing) rather than flipping polarity.
    expect(e(arrow([arrow([{ $ref: "Int" }], Void)], Void))).toEqual(NO);
    // P1(a.8): the second cell of this pair used to be JF on the strength of an
    // independent inhabited return. It is now Nothing for TWO independent
    // reasons, both of them the factor gate — the NAMED param key is
    // registry-less, and an arrow-typed param is not plan-ready in any case
    // (`ttValidationPlanReady(TtArrow)` is unconditionally false).
    expect(e(arrow([arrow([{ $ref: "Int" }], Void)], Num))).toEqual(NO);
  });
  test("(Bot -> Void): an UNKNOWN entity domain stays UNDECIDED ⇒ Nothing (the honest residue)", () => {
    // A registered entity could be Void-like — no false Just true.
    expect(e(arrow([{ $ref: "Bot" }], Void))).toEqual(NO);
  });
});
