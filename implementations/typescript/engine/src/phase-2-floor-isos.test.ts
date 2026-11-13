// ---------------------------------------------------------------------------
// containment-substrate Phase 2 Step 2 — the floor-iso WITNESSES + the D3-unity
// mechanization.
//
// ISO-2 (`$variant ≅ tagged-disjoint ∪`) and ISO-4 (`$record ≅
// ∩-of-field-presence`) are witnessed by the Fenel-bodied fns in
// fenel/modules/engine/floor-isos.fenel (invoked here via
// dispatchEngineBody over hand-built TraversalType values — the marshalled ADT
// the witnesses work over, per the $-key barrier). The VP (verification plan,
// design-lock §2) proves each iso DENOTATIONALLY: the trio (subset/disjoint/empty)
// verdict-identity over LHS and its floor RHS (built by the TS smart-ctors). An
// iso is "proven" where mutual containment holds, "coarsened" where the trio
// returns Nothing (the Tri-Nothing honesty — flagged, NOT failed; a Nothing→Just
// would be unsound and is FORBIDDEN — none occur). The former ISO-5 is now a
// focused regression guard: positional identity is list ordinal, so projecting
// `_1` into a singleton list cannot preserve its axis and the semantic boundary
// must reject the old name-authoritative decomposition.
//
// The D3-unity (design-lock §1.7): the SAME tag-predicate is three faces — intro
// (a constructor's image ⊆ the type), elim (caseTagsCover decides coverage on
// values), static (the trio decides exhaustiveness over the whole type). The
// headline mechanization: `matchExhaustive ⟺ empty(complement(∪cases) ∩ scrutinee)
// ⟺ subset(scrutineeTags, ∪caseTags)` — the §1 thesis "exhaustiveness IS set
// disjointness" made executable, demonstrated to AGREE with the elim-side fn.
// ---------------------------------------------------------------------------

import { test, expect, describe } from "bun:test";
import {
  dispatchEngineBody,
  dispatchedSubset,
  dispatchedEmpty,
  dispatchedDisjointType,
  type ContainmentDispatchOptions,
} from "./engine-bodies-dispatch";
import { unionTypes, intersectTypes, complementType, setExprAsType } from "./type-foundation";
import type { ModuleRegistry } from "./registry";
import type { FenelType, FieldKey, SetExpr } from "./types";

import { setDefaultTimeout } from "bun:test";

// type-substrate P1(a) — bun's 5 s per-test default is wrong for this file: it
// drives the INTERPRETED Fenel deciders, and on a slow Windows host individual
// assertions measured 5-75 s BEFORE this phase and after it (verdicts identical
// either side). A suite that reports clock as failure is a gate nobody can read,
// which is how a real red in the sibling tcb-recheck suite went unnoticed. Raise
// the budget; never weaken an assertion to fit it.
setDefaultTimeout(300_000);

// --- Tri (the trio's Maybe<Bool>) ------------------------------------------
type Tri = { $tag: "Just"; _0: boolean } | { $tag: "Nothing" };
const JT: Tri = { $tag: "Just", _0: true };
const JF: Tri = { $tag: "Just", _0: false };
const NO: Tri = { $tag: "Nothing" };
const sub = (a: unknown, b: unknown, options?: ContainmentDispatchOptions) =>
  dispatchedSubset(a, b, options) as Tri;
const emp = (t: unknown) => dispatchedEmpty(t) as Tri;
const dis = (a: unknown, b: unknown) => dispatchedDisjointType(a, b) as Tri;

// --- TraversalType builders (plain $tag-tagged objects, the marshalled ADT) -
const TtNamed = (name: string) => ({ $tag: "TtNamed", name, raw: { $ref: name } });
const TtCase = (name: string, fields: unknown[] = []) => ({ $tag: "TtVariantCase", name, fields });
const TtVariant = (cases: unknown[], raw: unknown = null) => ({ $tag: "TtVariant", cases, raw });
const X_KEY: FieldKey = {
  $tag: "NamedField",
  ref: { $ref: "00000000-0000-4000-8000-000000000001" },
};
const Y_KEY: FieldKey = {
  $tag: "NamedField",
  ref: { $ref: "00000000-0000-4000-8000-000000000002" },
};
const positionalKey = (index: number): FieldKey => ({ $tag: "PositionalField", index });
const TtField = (wireName: string, type: unknown, semanticKey: FieldKey) => ({
  $tag: "TtField",
  name: wireName,
  key:
    semanticKey.$tag === "NamedField"
      ? { $tag: "NamedFieldInput", handle: semanticKey.ref.$ref }
      : { $tag: "PositionalFieldInput", index: semanticKey.index },
  semanticKey,
  wireName,
  token:
    semanticKey.$tag === "NamedField"
      ? `floor-iso:named:${semanticKey.ref.$ref}`
      : `floor-iso:tuple:${semanticKey.index}`,
  type,
  raw: type,
});
const TtNamedField = (wireName: string, type: unknown, semanticKey: FieldKey) =>
  TtField(wireName, type, semanticKey);
const TtRecord = (fields: unknown[], raw: unknown = null) => ({ $tag: "TtRecord", fields, raw });
const TtTuple = (items: unknown[], raw: unknown = null) => ({ $tag: "TtTuple", items, raw });
const TtUnion = (branches: unknown[], raw: unknown = null) => ({ $tag: "TtUnion", branches, raw });
const TtIntersect = (branches: unknown[], raw: unknown = null) => ({ $tag: "TtIntersect", branches, raw });

// --- invoke a Fenel-bodied witness -----------------------------------------
const variantToUnion = (t: unknown) => dispatchEngineBody("variantToUnion", [t]);
const unionToVariant = (t: unknown) => dispatchEngineBody("unionToVariant", [t]);
const recordToIntersect = (t: unknown) => dispatchEngineBody("recordToIntersect", [t]);
const intersectToRecord = (t: unknown) => dispatchEngineBody("intersectToRecord", [t]);
const tupleAsIntersect = (t: unknown, names: string[]) =>
  dispatchEngineBody("tupleAsIntersect", [t, names]);
const caseTagsCover = (scrut: string[], cases: string[]) =>
  dispatchEngineBody("caseTagsCover", [scrut, cases]) as boolean;
const variantCaseTags = (t: unknown) => dispatchEngineBody("variantCaseTags", [t]) as string[];

const Just = (x: unknown) => ({ $tag: "Just", _0: x });
const Nothing = { $tag: "Nothing" };

// ===========================================================================
// S1 — the witness functions exercised over the marshalled TraversalType ADT.
// ===========================================================================
describe("Phase 2 Step 2 — ISO-2 witness (variant ↔ tagged union)", () => {
  const variant = TtVariant([TtCase("Yes"), TtCase("No")], "RAW");

  test("variantToUnion: a variant ⇒ a union of single-case-variant branches", () => {
    expect(variantToUnion(variant)).toEqual(
      TtUnion([TtVariant([TtCase("Yes")], "RAW"), TtVariant([TtCase("No")], "RAW")], "RAW"),
    );
  });
  test("unionToVariant ∘ variantToUnion = Just (round-trip law, proof = inhabitant)", () => {
    expect(unionToVariant(variantToUnion(variant))).toEqual(Just(variant));
  });
  test("unionToVariant on an UNTAGGED union ⇒ Nothing (left-inverse only — no preimage)", () => {
    expect(unionToVariant(TtUnion([TtNamed("Int"), TtNamed("String")]))).toEqual(Nothing);
  });
  test("variantCaseTags reads the constructor-tag set", () => {
    expect(variantCaseTags(variant)).toEqual(["Yes", "No"]);
  });
});

describe("Phase 2 Step 2 — ISO-4 witness (record ↔ ∩-of-field-presence)", () => {
  const rec = TtRecord(
    [TtNamedField("x", TtNamed("Number"), X_KEY), TtNamedField("y", TtNamed("String"), Y_KEY)],
    "RAW",
  );

  test("recordToIntersect: a record ⇒ ∩ of single-field-presence records", () => {
    expect(recordToIntersect(rec)).toEqual(
      TtIntersect(
        [
          TtRecord([TtNamedField("x", TtNamed("Number"), X_KEY)], "RAW"),
          TtRecord([TtNamedField("y", TtNamed("String"), Y_KEY)], "RAW"),
        ],
        "RAW",
      ),
    );
  });
  test("intersectToRecord ∘ recordToIntersect = Just (round-trip law)", () => {
    expect(intersectToRecord(recordToIntersect(rec))).toEqual(Just(rec));
  });
  test("intersectToRecord on a cross-base ∩ ⇒ Nothing (no record preimage)", () => {
    expect(intersectToRecord(TtIntersect([TtNamed("Int"), TtNamed("String")]))).toEqual(Nothing);
  });
});

describe("field-identity Phase 3 — retired ISO-5 positional singleton witness", () => {
  const tup = TtTuple([TtNamed("Number"), TtNamed("String")], "RAW");

  test("tupleAsIntersect is a conservative no-op instead of fabricating key-invalid singleton axes", () => {
    expect(tupleAsIntersect(tup, ["_0", "_1"])).toEqual(tup);
  });
});

// ===========================================================================
// S3 — the VP: denotation-preservation through the trio (the smart-ctor RHS).
// FenelType LHS/RHS; the trio is the denotational oracle. Coarsening (Nothing)
// is flagged, never a Nothing→Just (which would be unsound).
// ===========================================================================
const Num: FenelType = { $ref: "Number" };
const Str: FenelType = { $ref: "String" };
// the tag set of a constructor, as an enum refinement over String (a tag is a
// singleton string-enum refinement — design-lock §1.3).
const tagsTypeT = (tags: string[]): FenelType =>
  setExprAsType(Str, { $enum: tags } as unknown as SetExpr);
const variantFT = (names: string[]): FenelType =>
  ({ $variant: { cases: names.map((n) => ({ name: n, fields: [] })) } }) as unknown as FenelType;
const recordFT = (fields: [string, FieldKey, FenelType][]): FenelType =>
  ({
    $record: {
      fields: fields.map(([name, key, type]) => ({ name, key, type })),
    },
  }) as unknown as FenelType;

describe("Phase 2 Step 2 — ISO-2 VP (variant ≅ tagged-disjoint union, via the trio)", () => {
  // Choice = Yes | No  ≅  V[Yes] ∪ V[No]  (single-case-variant branches).
  const choice = variantFT(["Yes", "No"]);
  const vYes = variantFT(["Yes"]);
  const vNo = variantFT(["No"]);
  const rhs = unionTypes([vYes, vNo]);

  test("forward: (V[Yes] ∪ V[No]) ⊆ Choice ⇒ Just true (every branch ⊆)", () => {
    expect(sub(rhs, choice)).toEqual(JT);
  });
  test("tag-disjointness side-condition: disjoint {Yes} {No} ⇒ Just true (tag AND variant level)", () => {
    // The disjointness that makes ∪ a coproduct is on the TAGS (distinct singleton
    // string-enums). The trio decides it at the tag level via set:decideDisjoint.
    expect(dis(tagsTypeT(["Yes"]), tagsTypeT(["No"]))).toEqual(JT);
    // Phase 2.4 — and now at the VARIANT level too: disjointVariant decides
    // variant-vs-variant disjointness BY TAG (distinct constructor tags force it —
    // no value carries a tag in both). The ISO-2 tag-disjointness side-condition is
    // decidable at the variant-type level; the §1 thesis "exhaustiveness IS set
    // disjointness" advanced (was Nothing pre-2.4 — Step-2 surprise #3's gap):
    expect(dis(vYes, vNo)).toEqual(JT);
  });
  test("reverse coarsens: Choice ⊆ (V[Yes] ∪ V[No]) ⇒ Nothing (RHS-union ∃ incomplete, SOUND)", () => {
    // Choice splits ACROSS the branches; no single branch ⊇ Choice ⇒ Nothing.
    // Coarsening, NOT a wrong verdict (never Just false).
    expect(sub(choice, rhs)).toEqual(NO);
  });
});

describe("Phase 2 Step 2 — ISO-4 VP (record ≅ ∩-of-field-presence, via the trio)", () => {
  // {x:Num, y:Str}  ≅  {x:Num} ∩ {y:Str}   (OPEN reading — Fenel width-subtypes).
  const rec = recordFT([
    ["x", X_KEY, Num],
    ["y", Y_KEY, Str],
  ]);
  const rhs = intersectTypes([
    recordFT([["x", X_KEY, Num]]),
    recordFT([["y", Y_KEY, Str]]),
  ]);
  const fieldWires = new Map<string, string>([
    [X_KEY.ref.$ref, "x"],
    [Y_KEY.ref.$ref, "y"],
  ]);
  const registry = {
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
        throw new Error(`unresolved ISO-4 fixture field ${fieldId}`);
      }
      return {
        label: wireName,
        source: "uuid-field-facet",
      };
    },
  } as unknown as ModuleRegistry;
  const options: ContainmentDispatchOptions = { registry };

  test("forward: {x:Num,y:Str} ⊆ ({x:Num} ∩ {y:Str}) ⇒ Just true (width: ⊆ each narrower)", () => {
    expect(sub(rec, rhs, options)).toEqual(JT);
  });
  test("reverse coarsens: ({x:Num} ∩ {y:Str}) ⊆ {x:Num,y:Str} ⇒ Nothing (LHS-∩ ∃ incomplete)", () => {
    // The open ∩ IS the open record, but the LHS-intersect arm only proves via a
    // SINGLE branch ⊆ want, and neither {x} nor {y} alone ⊆ {x,y} ⇒ Nothing.
    // This is the existing generic intersect coarsening, not a retired backward
    // record-floor iso: the witness round-trip above remains intact.
    expect(sub(rhs, rec, options)).toEqual(NO);
  });
});

describe("field-identity Phase 3 — old positional floor decomposition is rejected", () => {
  // The full product is identity-valid: positional keys agree with their
  // containing-list ordinals. The old second singleton cannot be: preserving
  // PositionalField(1) puts it at local ordinal 0. Renumbering it would silently
  // change the semantic axis, so the boundary rejects rather than aliases it.
  const posRec = recordFT([
    ["_0", positionalKey(0), Num],
    ["_1", positionalKey(1), Str],
  ]);
  const staleNameAxisRhs = intersectTypes([
    recordFT([["_0", positionalKey(0), Num]]),
    recordFT([["_1", positionalKey(1), Str]]),
  ]);

  test("the semantic boundary rejects the stale {_0:A} ∩ {_1:B} singleton encoding", () => {
    expect(() => sub(posRec, staleNameAxisRhs)).toThrow(
      /positional field key index 1 does not match ordinal 0/,
    );
  });
  test("the $tuple kind is DISTINCT from $record — cross-kind subset now ABSTAINS", () => {
    // The trio still treats $tuple (array-repr) and the valid full positional
    // record (object-repr) as distinct value representations — the DISJOINT face
    // proves it, and that is what this row is really about.
    //
    // RE-BASELINED at type-substrate P1(a.5): the SUBSET verdict moved `Just
    // false` → `Nothing`. The cross-kind subset terminal is now an unconditional
    // fence, because the subset walk peels `$opaque` WITHOUT tracking it and
    // `$opaque` is exactly the wrapper that swaps the runtime carrier for the
    // pure ADT — `Int` peels to `$record` while holding NUMBERS, `List` peels to
    // `$variant` while holding ARRAYS. So at that terminal the kind pair
    // describes pure views and no carrier partition is available. Nothing
    // observable changed: every consumer of this face is `isJustTrue` or a Kleene
    // `mAnd`, so `Just false` and `Nothing` were already indistinguishable.
    const tup: FenelType = { $tuple: [Num, Str] };
    expect(sub(tup, posRec)).toEqual(NO);
    // the distinctness this row asserts is still DECIDED, on the disjoint face:
    expect(dis(tup, posRec)).toEqual(JT);
  });
});

// ===========================================================================
// S2 — the D3-unity mechanization: intro = elim = static, one tag-predicate.
// The headline: exhaustiveness IS set containment, demonstrated executably.
// ===========================================================================
describe("Phase 2 Step 2 — D3-unity: intro = elim = static (one $el tag-predicate)", () => {
  const choice = variantFT(["Yes", "No"]);
  const vYes = variantFT(["Yes"]);

  test("INTRO face: a constructor's image ⊆ the type — V[Yes] ⊆ Choice ⇒ Just true", () => {
    // `Yes : Choice` establishes the tag-predicate; its singleton type ⊆ Choice.
    expect(sub(vYes, choice)).toEqual(JT);
  });

  test("ELIM face: caseTagsCover decides coverage on the tag set (the match decision)", () => {
    expect(caseTagsCover(["Yes", "No"], ["Yes", "No"])).toBe(true); // exhaustive
    expect(caseTagsCover(["Yes", "No"], ["Yes"])).toBe(false); // missing No
    expect(caseTagsCover(["Yes", "No"], ["Yes", "No", "Maybe"])).toBe(true); // over-covers
  });
});

describe("Phase 2 Step 2 — the exhaustiveness identity (exhaustiveness IS set containment)", () => {
  // Model the tag sets as enum refinements over String. scrutinee = {Yes,No}.
  const tagsType = (tags: string[]): FenelType =>
    setExprAsType(Str, { $enum: tags } as unknown as SetExpr);
  const scrutTags = ["Yes", "No"];
  const scrutType = tagsType(scrutTags);

  // The corpus of (case-set) covers — exhaustive + two non-exhaustive + over.
  const covers: { cases: string[]; exhaustive: boolean }[] = [
    { cases: ["Yes", "No"], exhaustive: true },
    { cases: ["Yes"], exhaustive: false },
    { cases: ["No"], exhaustive: false },
    { cases: ["Yes", "No", "Maybe"], exhaustive: true },
  ];

  test("STATIC (trio enum-subset) AGREES with ELIM (caseTagsCover) — the mechanization", () => {
    for (const { cases, exhaustive } of covers) {
      const elim = caseTagsCover(scrutTags, cases);
      // static: scrutinee ⊆ ∪caseTags  ⟺  exhaustive.
      const staticV = sub(scrutType, tagsType(cases));
      expect(elim).toBe(exhaustive);
      // P1(a.6) keeps refined containment positive-only: exhaustive and
      // over-cover cases remain exact, while a missing enum member abstains
      // instead of manufacturing a negative from an incomplete face.
      expect(staticV).toEqual(exhaustive ? JT : NO);
      // the two faces decide the SAME predicate:
      const staticBool = JSON.stringify(staticV) === JSON.stringify(JT);
      expect(staticBool).toBe(elim);
    }
  });

  test("the empty(complement(∪cases) ∩ scrutinee) form is the SAME identity (set algebra)", () => {
    // empty(¬C ∩ S) ⟺ S ⊆ C ⟺ exhaustive. Through the trio the complement-disjoint
    // arm is conservatively Nothing (the undecided frontier, design-lock §1.5), so
    // the LITERAL complement form COARSENS to Nothing — flagged, not failed; the
    // subset form (above) is the exact decidable equivalent.
    for (const { cases } of covers) {
      const C = tagsType(cases);
      const form = emp(intersectTypes([complementType(C), scrutType]));
      // SOUND: never a wrong Just — either the exact Just true (exhaustive) or the
      // conservative Nothing. NEVER Just false.
      expect(JSON.stringify(form) !== JSON.stringify(JF)).toBe(true);
    }
  });
});
