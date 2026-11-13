// ---------------------------------------------------------------------------
// set-algebra-to-fenel Phase 6 Step 2b — the SOUND `subset` (containment.fenel).
//
// `engine:subset` (= `subsetW False`) is the precise containment member: a sound
// `⟦have⟧ ⊆ ⟦want⟧` decider returning Tri. These tests pin the Step-2b composite
// soundness — arrow variance (north-star §6), record width+depth, variant
// case-wise, tuple pairwise, map value-subset, and `Tri` `Nothing` surfacing —
// AND assert the picker-view (`typeSubsumes` = `collapse(subsetW True)`) stays
// generous (constructor-level) on the SAME inputs the sound member rejects, so the
// FunctionPicker is un-regressed (the picker-mode arms are dark to the new
// strictness). The seam is `dispatchedSubset` / `universeTypeSubsumes`
// (engine-bodies-dispatch.ts) — marshal/context only; the decision is the `.fenel` body.
// ---------------------------------------------------------------------------

import { test, expect, describe } from "bun:test";
import { dispatchedSubset, universeTypeSubsumes } from "./engine-bodies-dispatch";
import type { ModuleRegistry } from "./registry";
import type { FieldKey } from "./types";

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
const Str = { $ref: "String" };
const refined = (set: unknown) => ({ $refined: { base: Num, set } });
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
const positionalField = (index: number, type: unknown) => ({
  name: `_${index}`,
  key: { $tag: "PositionalField" as const, index },
  type,
});
const rec = (fs: unknown[]) => ({ $record: { fields: fs } });
const arrow = (ps: unknown[], r: unknown) => ({
  $arrow: {
    params: ps.map((t, i) => field(`p${i}`, t, keyFor(`arrow-param-${i}`))),
    returns: r,
  },
});
const variant = (names: string[]) => ({
  $variant: { cases: names.map((n) => ({ name: n, fields: [] })) },
});
const tup = (...ts: unknown[]) => ({ $tuple: ts });
const map = (v: unknown) => ({ $map: { values: v } });

function collectNamedFieldWires(
  value: unknown,
  into: Map<string, string>,
  seen: WeakSet<object>,
): void {
  if (value === null || typeof value !== "object" || seen.has(value)) return;
  seen.add(value);
  if (Array.isArray(value)) {
    for (const item of value) collectNamedFieldWires(item, into, seen);
    return;
  }
  const record = value as Record<string, unknown>;
  const key = record.key;
  if (
    typeof record.name === "string"
    && key !== null
    && typeof key === "object"
    && (key as { readonly $tag?: unknown }).$tag === "NamedField"
  ) {
    const ref = (key as { readonly ref?: unknown }).ref;
    if (
      ref !== null
      && typeof ref === "object"
      && typeof (ref as { readonly $ref?: unknown }).$ref === "string"
    ) {
      into.set((ref as { readonly $ref: string }).$ref, record.name);
    }
  }
  for (const child of Object.values(record)) collectNamedFieldWires(child, into, seen);
}

type CurrentWireOverride = readonly [key: FieldKey, wireName: string];

function namedFieldId(key: FieldKey): string {
  if (key.$tag !== "NamedField") throw new Error("current-wire override requires NamedField");
  return key.ref.$ref;
}

/** Historical fixtures predate registry-local field presentation. Give each
 * call exactly the fields in its operands; optional overrides model a newer
 * live presentation without rewriting either embedded type snapshot. */
function projectionRegistryFor(
  have: unknown,
  want: unknown,
  currentWireOverrides: readonly CurrentWireOverride[] = [],
): ModuleRegistry {
  const wires = new Map<string, string>();
  const seen = new WeakSet<object>();
  collectNamedFieldWires(have, wires, seen);
  collectNamedFieldWires(want, wires, seen);
  for (const [key, wireName] of currentWireOverrides) {
    const fieldId = namedFieldId(key);
    if (!wires.has(fieldId)) throw new Error(`override for unreferenced synthetic field ${fieldId}`);
    wires.set(fieldId, wireName);
  }
  return {
    getFieldRepresentation: (typeName: string, fieldId: string) => {
      const wireName = wires.get(fieldId);
      if (typeName !== "Codeable" || wireName === undefined) return undefined;
      return {
        typeName: "Codeable",
        args: [fieldId],
        methods: { codeName: wireName },
      };
    },
    resolveFieldPresentation: (fieldId: string) => {
      const wireName = wires.get(fieldId);
      if (wireName === undefined) throw new Error(`unresolved synthetic field ${fieldId}`);
      return {
        label: wireName,
        source: "uuid-field-facet",
      };
    },
  } as unknown as ModuleRegistry;
}

const sub = (
  a: unknown,
  b: unknown,
  currentWireOverrides: readonly CurrentWireOverride[] = [],
) => dispatchedSubset(
  a,
  b,
  { registry: projectionRegistryFor(a, b, currentWireOverrides) },
) as Tri;
const pick = (a: unknown, b: unknown) => universeTypeSubsumes(
  a,
  b,
  { registry: projectionRegistryFor(a, b) },
);

describe("Phase 6 Step 2b — sound subset: leaves + transparency (regression of 2a)", () => {
  test("named: N ⊆ N is Just true; N ⊆ S is Nothing (honest closed-world abstention)", () => {
    expect(sub(Num, Num)).toEqual(JT);
    // decide-substrate (Tt* named-leaf honesty): the Tt* named leaf does
    // HIERARCHY-only reasoning (namedSubsetCheck both ways). Number and String
    // are hierarchy-UNRELATED (neither is the other's Subsumable super), so the
    // sound member ABSTAINS (Nothing) rather than committing to Just false — a
    // same-kind named pair the hierarchy doesn't relate (a registry/refined alias,
    // or a cross-domain pair) could still be a subset the Park/SetExpr path proves.
    // Disjointness refutation lives on the Park side (which is ALSO Nothing here).
    expect(sub(Num, Str)).toEqual(NO);
  });
  test("a type-variable expected slot is UNDECIDABLE for the sound member (Nothing)", () => {
    // The picker accepts a polymorphic slot; the sound ⊆ cannot (a free var's
    // denotation is unknown) — this is the deliberate sound/picker divergence.
    expect(sub(Num, { $var: "a" })).toEqual(NO);
    expect(pick(Num, { $var: "a" })).toBe(true); // picker still accepts
  });
  test("refined ⊆ keeps the positive coordinate and abstains on a predicate refutation", () => {
    expect(sub(refined({ $enum: [1, 2] }), refined({ $enum: [1, 2, 3] }))).toEqual(JT);
    expect(sub(refined({ $enum: [1, 2, 3, 4] }), refined({ $enum: [1, 2, 3] }))).toEqual(NO);
  });
});

describe("Phase 6 Step 2b — record width + depth", () => {
  test("width: {x:N, y:S} ⊆ {x:N} (extra have-field OK)", () => {
    expect(sub(rec([field("x", Num), field("y", Str)]), rec([field("x", Num)]))).toEqual(JT);
  });
  test("missing want-field: {x:N} ⊄ {x:N, y:S}", () => {
    expect(sub(rec([field("x", Num)]), rec([field("x", Num), field("y", Str)]))).toEqual(JF);
  });
  test("depth: {x:S} vs {x:N} — the field leaf (String vs Number) abstains ⇒ record Nothing", () => {
    // The field verdict is the named-leaf String ⊆ Number = Nothing (see the
    // named-leaf honesty test above); the record fold (mAnd) propagates it. The
    // sound member no longer REFUTES this depth mismatch — it abstains, honestly
    // (the refutation was hierarchy-unrelated, not a proven non-subset).
    expect(sub(rec([field("x", Str)]), rec([field("x", Num)]))).toEqual(NO);
  });

  test("stable UUID survives current-wire rename + reorder when both embedded faces align", () => {
    const x = keyFor("stable-x");
    const y = keyFor("stable-y");
    const have = rec([
      field("staleX", Num, x),
      field("staleY", Str, y),
    ]);
    const want = rec([
      field("staleY", Str, y),
      field("staleX", Num, x),
    ]);
    // Both operands carry the same stale embedded snapshot, while the exact
    // per-call registry projects each shared UUID to its renamed current wire.
    // The embedded and current faces therefore each agree across the pair.
    expect(sub(have, want, [[x, "currentX"], [y, "currentY"]])).toEqual(JT);
  });

  test("same wire spelling with different UUIDs ABSTAINS (witness-graded: the host populations may coincide)", () => {
    // Phase-3 stabilization + Phase 4a (review F9 pin sync): distinct field
    // identities never PROVE a subset, but the missing-key refutation is
    // witness-graded — when a have field still shares the want field's current
    // wire projection under a different UUID, the host-value populations may
    // coincide, so the verdict honestly abstains (the disjointness twin's
    // posture). The pre-stabilization JF here refuted possibly-coincident
    // populations without a witness.
    expect(sub(
      rec([field("value", Num, keyFor("left-value"))]),
      rec([field("value", Num, keyFor("right-value"))]),
    )).toEqual(NO);
  });

  test("F1: a shared wire under a different UUID abstains even when the want-field is ERASABLE", () => {
    // Phase 4a review F1 — the erasable shortcut must not precede the wire-
    // ambiguity check: have={x_A:Number} puts a NUMBER at wire x, and the
    // optional want-field x_B:Maybe<String> constrains the value AT wire x if
    // present — {x:1} inhabits have and fails want, so Just true was unsound.
    const maybeStr = {
      $variant: {
        cases: [
          { name: "Nothing", fields: [] },
          { name: "Just", fields: [{ name: "_0", key: { $tag: "PositionalField", index: 0 }, type: Str }] },
        ],
      },
    };
    expect(sub(
      rec([field("x", Num, keyFor("f1-left"))]),
      rec([field("x", maybeStr, keyFor("f1-right"))]),
    )).toEqual(NO);
  });

  test("F2: an EMPTY left product is a vacuous subset (∅ ⊆ want), not a missing-wire refutation", () => {
    // Phase 4a review F2 — have={x:Void} denotes ∅; the width witness (a
    // have-value lacking want's wire) is realizable only over an inhabited
    // left product. Pre-fix this refuted ∅ ⊆ {y:String}.
    expect(sub(
      rec([field("x", { $void: true }, keyFor("f2-void"))]),
      rec([field("y", Str, keyFor("f2-want"))]),
    )).toEqual(JT);
  });

  test("F2: an UNDECIDED-emptiness left product degrades the missing-wire refutation to Nothing", () => {
    // refined({}) has undecidable emptiness (unrecognized set) — the width
    // witness cannot be proven realizable, so the refutation abstains.
    expect(sub(
      rec([field("x", refined({}), keyFor("f2-undecided"))]),
      rec([field("y", Str, keyFor("f2-want-2"))]),
    )).toEqual(NO);
  });

  test("F2: an INHABITED left product still refutes genuine wire absence (the width witness stands)", () => {
    expect(sub(
      rec([field("x", Num, keyFor("f2-inhabited"))]),
      rec([field("y", Str, keyFor("f2-want-3"))]),
    )).toEqual(JF);
  });

  test("keyless, duplicate-key, duplicate-wire, and positional mismatch reject before judgment", () => {
    expect(() => sub(
      { $record: { fields: [{ name: "x", type: Num }] } },
      rec([]),
    )).toThrow(/not identity-total|invalid/i);

    const duplicate = keyFor("duplicate-axis");
    expect(() => sub(
      rec([field("a", Num, duplicate), field("b", Str, duplicate)]),
      rec([]),
    )).toThrow(/duplicate semantic field key/i);

    expect(() => sub(
      rec([
        field("same", Num, keyFor("wire-left")),
        field("same", Str, keyFor("wire-right")),
      ]),
      rec([]),
    )).toThrow(/duplicate wire field name/i);

    expect(() => sub(
      rec([positionalField(1, Num)]),
      rec([]),
    )).toThrow(/does not match ordinal 0/i);
  });
});

// type-substrate P1(a.7) — the sound arrow arm now ABSTAINS in BOTH polarities.
// Two independent IMPLEMENTED refuters survive every arrow verdict: validation's
// registered-name `paramCount` axis (witness `"std:negate"` against a 2-param
// want, which `arrowSub`'s `someParamEmptyW` short-circuit called `Just true`)
// and the flatten-vs-written-arity divergence (`ttArrowFlatten` curry-normalizes
// while `validationValidateArrow` counts the UNFLATTENED `VtArrow` field list).
// `fact.signatureSubtype` is excluded as CIRCULAR — it IS this judgment.
// The expectations below are therefore PRICED LOSSES, each with a named recovery
// (`sub.refl.deepeq`, or a written-arity-equal variance slice); see ledger row
// `t.sub.arrow` (AXIOM → MISSING) and
// `type-substrate-p1a7-unready-former-closure.test.ts`.
describe("Phase 6 Step 2b — arrow variance (north-star §6)", () => {
  test("identity: (N->N) ⊆ (N->N) — PRICED LOSS at P1(a.7), was Just true", () => {
    expect(sub(arrow([Num], Num), arrow([Num], Num))).toEqual(NO);
  });
  test("CONTRAVARIANT arg ({1,2,3}->N) ⊆ ({1,2}->N) — PRICED LOSS at P1(a.7), was Just true", () => {
    expect(
      sub(arrow([refined({ $enum: [1, 2, 3] })], Num), arrow([refined({ $enum: [1, 2] })], Num)),
    ).toEqual(NO);
  });
  test("CONTRAVARIANT refined-arg negative abstains: ({1,2}->N) vs ({1,2,3}->N)", () => {
    // The reversed parameter check reaches the same refined-set negative as
    // the direct leaf test, so carrier-honest Tt propagates Nothing here too.
    expect(
      sub(arrow([refined({ $enum: [1, 2] })], Num), arrow([refined({ $enum: [1, 2, 3] })], Num)),
    ).toEqual(NO);
  });
  test("COVARIANT result: (N->S) vs (N->N) — result leaf (String vs Number) abstains ⇒ Nothing", () => {
    // Covariant result: the result-leaf verdict is String ⊆ Number = Nothing
    // (hierarchy-unrelated ⇒ honest abstention), so the arrow verdict is Nothing.
    expect(sub(arrow([Num], Str), arrow([Num], Num))).toEqual(NO);
  });
  test("arity mismatch — PRICED LOSS at P1(a.7), was Just false: (N->N) vs (N->N->N)", () => {
    // The genuine arity refutation. Its Se twin in tcb-recheck.test.ts is
    // untouched and still proves it, which is now a pinned cross-face divergence.
    expect(sub(arrow([Num], Num), arrow([Num, Num], Num))).toEqual(NO);
  });
  // decide-substrate 8λ.1-r — the ∅-arrow gate: an EMPTY have-arrow is ⊆
  // EVERYTHING (the exponential law: return empty ∧ params inhabited ⇒ no such
  // fn exists ⇒ ∅ ⊆ want). Pre-8λ.1-r this was a FALSE REFUTATION (arity fired
  // without an emptiness gate); the fix mirrors the SetExpr judgment's SeArrow
  // arm + the subsetW prelude's tsIsVoid/isBottomMu empty-have rule.
  test("∅-arrow gate — PRICED LOSS at P1(a.7): (N->Void) vs (N->N->Void), was Just true", () => {
    // The gate itself rode `empty((N)→Void) = Just true`, which P1(a.7) fenced:
    // that emptiness is conceptually derivable and FALSE at validation's
    // implemented arrow arm, which accepts "" for every arrow type. See
    // ledger row `t.emp.arrow` (THEOREM → SIDE-CONDITIONED).
    expect(sub(arrow([Num], { $void: true }), arrow([Num, Num], { $void: true }))).toEqual(NO);
  });
  test("∅-arrow gate — PRICED LOSS at P1(a.7): (N->Void) vs (N->N), was Just true", () => {
    expect(sub(arrow([Num], { $void: true }), arrow([Num], Num))).toEqual(NO);
  });

  test("arrow variance is list-positional even when retained UUID metadata differs — PRICED LOSS at P1(a.7)", () => {
    const have = {
      $arrow: {
        params: [field("before", Num, keyFor("arrow-before"))],
        returns: Num,
      },
    };
    const want = {
      $arrow: {
        params: [field("after", Num, keyFor("arrow-after"))],
        returns: Num,
      },
    };
    // The list-positional property is unobservable while the arm abstains; the
    // pin is kept so a future arrow-recovery slice must re-decide it explicitly.
    expect(sub(have, want)).toEqual(NO);
  });
});

describe("Phase 6 Step 2b — variant case-wise + tuple + map", () => {
  test("variant: (A|B) ⊆ (A|B|C) (fewer cases); (A|B|C) ⊄ (A|B)", () => {
    expect(sub(variant(["A", "B"]), variant(["A", "B", "C"]))).toEqual(JT);
    expect(sub(variant(["A", "B", "C"]), variant(["A", "B"]))).toEqual(JF);
  });
  test("tuple pairwise: (N,S) ⊆ (N,S) survives; the arity negative is a P1(a.7) PRICED LOSS", () => {
    // type-substrate P1(a.7): the sound tuple arm is POSITIVE-ONLY. Its
    // negatives carried a measured false definite — they have no
    // have-nonemptiness gate, so `tuple[Void, Number] ⊆ tuple[Void]` refuted
    // while the have denotes ∅. Ledger row `t.sub.tuple`; the recovery is a
    // have-nonemptiness-gated arity rule, out of phase.
    expect(sub(tup(Num, Str), tup(Num, Str))).toEqual(JT);
    expect(sub(tup(Num, Str), tup(Num))).toEqual(NO);
  });
  test("map — PRICED LOSS at P1(a.7): both polarities abstain", () => {
    // `ssMap` reads `$map` as a partial dictionary while validation's finite arm
    // requires a TOTAL array of length `card`, so `Map[3,T] ⊆ Map[4,T]` was a
    // false POSITIVE at an implemented arm. Ledger row `t.sub.map`
    // (THEOREM → MISSING); the recovery is a key-EQUALITY-gated positive.
    expect(sub(map(Num), map(Num))).toEqual(NO);
    expect(sub(map(Str), map(Num))).toEqual(NO);
  });

  test("named payload axes survive current-wire rename + reorder when both embedded faces align", () => {
    const first = keyFor("variant-first");
    const second = keyFor("variant-second");
    const have = {
      $variant: {
        cases: [{
          name: "Case",
          fields: [field("staleFirst", Num, first), field("staleSecond", Str, second)],
        }],
      },
    };
    const want = {
      $variant: {
        cases: [{
          name: "Case",
          fields: [field("staleSecond", Str, second), field("staleFirst", Num, first)],
        }],
      },
    };
    expect(sub(have, want, [[first, "currentFirst"], [second, "currentSecond"]])).toEqual(JT);
  });

  test("named payloads with the same wire spelling but different UUIDs abstain (no proof without reuse, no witness to refute)", () => {
    // Distinct field identities never PROVE a subset (explicit reuse is the
    // way to assert cross-record sameness), but with the same current wire
    // projection the host-value populations may coincide, so a refutation has
    // no witness either — the honest Tri verdict is Nothing, mirroring the
    // disjointness twin's abstention on key-domain mismatch.
    const have = {
      $variant: {
        cases: [{ name: "Case", fields: [field("value", Num, keyFor("variant-left"))] }],
      },
    };
    const want = {
      $variant: {
        cases: [{ name: "Case", fields: [field("value", Num, keyFor("variant-right"))] }],
      },
    };
    expect(sub(have, want)).toEqual(NO);
  });

  test("a want field whose key AND wire are both absent from have still refutes (the classic width witness)", () => {
    const have = {
      $variant: {
        cases: [{ name: "Case", fields: [field("value", Num, keyFor("variant-left"))] }],
      },
    };
    const want = {
      $variant: {
        cases: [{
          name: "Case",
          fields: [
            field("value", Num, keyFor("variant-left")),
            field("extra", Str, keyFor("variant-extra")),
          ],
        }],
      },
    };
    expect(sub(have, want)).toEqual(JF);
  });

  test("extra have-axes only shrink the have set (width tolerance preserved)", () => {
    const have = {
      $variant: {
        cases: [{
          name: "Case",
          fields: [
            field("value", Num, keyFor("variant-left")),
            field("extra", Str, keyFor("variant-extra")),
          ],
        }],
      },
    };
    const want = {
      $variant: {
        cases: [{ name: "Case", fields: [field("value", Num, keyFor("variant-left"))] }],
      },
    };
    expect(sub(have, want)).toEqual(JT);
  });
});

describe("Phase 6 Step 2b — Tri Nothing surfaces through composites", () => {
  test("an undecided refined field ⇒ the record verdict is Nothing (not false)", () => {
    // {} is an unrecognised SetExpr ⇒ decideSubset = Nothing ⇒ the SOUND refined
    // leaf surfaces Nothing ⇒ the record fold (mAnd) propagates Nothing.
    expect(sub(rec([field("x", refined({}))]), rec([field("x", refined({}))]))).toEqual(NO);
  });
});

describe("Phase 6 Step 2b — the picker stays generous (typeSubsumes un-regressed)", () => {
  // The SAME inputs the sound member rejects, the picker-view still ACCEPTS at
  // constructor level — the FunctionPicker's deliberate coarsening is preserved
  // (picker-mode composite arms are untouched by 2b).
  test("picker accepts composites the sound member refutes", () => {
    expect(pick(variant(["A", "B", "C"]), variant(["A", "B"]))).toBe(true);
    expect(pick(rec([field("x", Num)]), rec([field("x", Num), field("y", Str)]))).toBe(true);
    expect(pick(arrow([Num], Num), arrow([Num, Num], Num))).toBe(true);
    expect(pick(tup(Num, Str), tup(Num))).toBe(true);
  });
});
