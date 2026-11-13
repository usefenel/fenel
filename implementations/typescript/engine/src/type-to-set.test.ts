// unified-static-analysis Phase 3b-3b — SHAPE-PARITY tests for the
// `typeToSetExpr` port. Brief:
// `workstreams/unified-static-analysis/briefs/phase-3b-3b-typetosetexpr-typemarker.md`.
//
// Under test: `typeToSetExpr` (fenel-check.ts) — the thin TraversalType delegate over
// the Fenel `engine:typeToSetProjection` envelope. Projection shapes are compared to a TS ORACLE
// (`oTypeToSetExpr`) that reproduces the pre-port `FenelType → SetExpr` logic
// verbatim (the `propagate.test.ts` / `assignable.test.ts` precedent), over a
// representative corpus of FenelTypes. Loss status is asserted separately:
// the old oracle had no way to distinguish suggestion shapes from evidence.
//
// The corpus's load-bearing case is the `{$ref:"multiple:2"}` refinement set
// (D-3b-3b-2) — proving the OPAQUE-CARRY marshal round-trips a `$ref`
// refinement byte-exact (vs `marshalSet` which would lower it to `$ref` and
// lose the key).

import { describe, it, expect } from "vitest";
import { checkAssignable, typeToSetExpr } from "./fenel-check";
import {
  dispatchEngineBody,
  dispatchEngineBodyWithDeciderCtx,
  dispatchedSearch,
  dispatchedSearchTyped,
  dispatchedSynthesizeFix,
  harnessForTests,
  marshalCanonicalRepresentationType,
  marshalTraversalType,
} from "./engine-bodies-dispatch";
import { withRuntimeRepresentationProjection } from "./json-logic";
import {
  contains,
  decideEmpty,
  enumerateOf,
  isDisjoint,
  isSubset,
  witnessOf,
} from "./set-algebra";
import { Int, Nat, Rational, refHandle } from "./type-foundation";
import { isSetExpr } from "./types";
import type { FenelType, FieldKey, SetExpr } from "./types";
import {
  isDegradedTypeProjection,
  peelSetExpr,
  setExprToDollarKey,
} from "./set-marker";

// Form-canonicalizing comparator: deeply lower ANY-form SetExpr (incl. the
// post-3b-2 `$tag` form) back to the legacy `$`-key form. This comparison omits
// ONLY semanticProjectionDegraded on recognized set nodes: the historical
// oracle describes their shapes, while each corpus row asserts loss status
// separately. An ordinary value's same-named field remains part of its data.
function cf(x: unknown): unknown {
  if (Array.isArray(x)) return x.map(cf);
  if (x && typeof x === "object") {
    const setNode = isSetExpr(x);
    const sx = setNode ? setExprToDollarKey(x) : x;
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(sx as object)) {
      if (setNode && k === "semanticProjectionDegraded") continue;
      out[k] = cf(v);
    }
    return out;
  }
  return x;
}

// ===========================================================================
// The pre-port TS logic, reproduced verbatim as the parity oracle.
// ===========================================================================

function oTypeToSetExpr(type: FenelType): SetExpr {
  if ("$refined" in type) {
    const baseSet = oTypeToSetExpr(type.$refined.base);
    if (peelSetExpr(baseSet)?.kind === "SeAll") return type.$refined.set;
    return { $tag: "SeIntersect", branches: [baseSet, type.$refined.set] };
  }
  if ("$opaque" in type && type.$opaque.pure) return oTypeToSetExpr(type.$opaque.pure);
  if ("$el" in type) return { $tag: "SeAll" };
  if ("$type" in type) return { $tag: "SeAll" };
  const named = refHandle(type);
  if (named !== undefined) {
    switch (named) {
      case "Number": return { $tag: "SeRef", handle: "ℝ" };
      case "Int": case "ℤ": return { $tag: "SeRef", handle: "ℤ" };
      case "Nat": case "ℕ": return { $tag: "SeRef", handle: "ℕ" };
      case "String": return { $tag: "SeRef", handle: "String" };
      case "Boolean": return { $tag: "SeEnum", values: [true, false] };
    }
    return { $tag: "SeRef", handle: named };
  }
  return { $tag: "SeAll" };
}

// ===========================================================================
// Corpus builders
// ===========================================================================

const named = (n: string): FenelType => ({ $ref: n } as unknown as FenelType);
const namedField = (id: string): FieldKey => ({ $tag: "NamedField", ref: { $ref: id } });
const positionalField = (index: number): FieldKey => ({ $tag: "PositionalField", index });
const FIELD_X = namedField("11111111-1111-4111-8111-111111111111");
const FIELD_NEXT = namedField("22222222-2222-4222-8222-222222222222");
const PARAM_X = namedField("33333333-3333-4333-8333-333333333333");
const refined = (base: FenelType, set: SetExpr): FenelType =>
  ({ $refined: { base, set } } as FenelType);
// representation-substrate Phase 5a — `repr` retired; opaque is { name, pure? }.
const opaque = (name: string, pure?: FenelType): FenelType =>
  ({ $opaque: pure ? { name, pure } : { name } } as FenelType);

const whereSet: SetExpr = { $where: { ">": [{ var: "value" }, 0] } } as unknown as SetExpr;
const multipleSet: SetExpr = { $ref: "multiple:2" } as unknown as SetExpr;
const enumSet: SetExpr = { $tag: "SeEnum", values: [1, 2, 3] };

const CORPUS: Array<[string, FenelType, boolean]> = [
  // --- named atoms (the tower switch + String + Boolean + a non-tower name) ---
  ["named Number", named("Number"), false],
  ["named Int", named("Int"), false],
  ["named ℤ", named("ℤ"), false],
  ["named Nat", named("Nat"), false],
  ["named ℕ", named("ℕ"), false],
  ["named String", named("String"), false],
  ["named Boolean", named("Boolean"), false],
  ["named non-tower (Bot)", named("Bot"), false],
  ["named via $ref (legacy handle)", { $ref: "ℤ" } as unknown as FenelType, false],

  // --- $refined over a named base, three refinement-set shapes ---
  ["refined ℤ with $where", refined(named("Int"), whereSet), false],
  ["refined ℤ with $enum", refined(named("Int"), enumSet), false],
  // THE FIDELITY CASE — synthetic $ref refinement set must round-trip byte-exact.
  ["refined ℤ with $ref (multiple:2)", refined(named("Int"), multipleSet), false],
  ["refined String with $where", refined(named("String"), whereSet), false],

  // --- $refined whose base is $all ⇒ bare set passthrough ---
  ["refined over $all-base (non-tower)", refined(named("Bot"), whereSet), false],
  ["refined over $el-base ⇒ passthrough", refined({ $el: { var: "x" } } as unknown as FenelType, multipleSet), true],

  // --- nested $refined over $refined ---
  ["nested refined-over-refined", refined(refined(named("Int"), enumSet), whereSet), false],

  // --- $opaque with .pure (recurse) vs without (⇒ $all) ---
  ["opaque with pure ⇒ recurse", opaque("Count", named("Nat")), false],
  ["opaque with pure (refined) ⇒ recurse", opaque("Pos", refined(named("Int"), whereSet)), false],
  ["opaque WITHOUT pure ⇒ $all", opaque("Mystery"), true],

  // --- $el / $type ⇒ $all ---
  ["$el ⇒ $all", { $el: { var: "x" } } as unknown as FenelType, true],
  ["$type ⇒ $all", { $type: true } as unknown as FenelType, true],

  // --- default arm: $tuple ⇒ $all ($variant/$record project since 8μ.1a; $mu
  //     projects to SeMu since 8μ.1b; $arrow ⇒ SeArrow + $void ⇒ SeNone since
  //     8λ.1 — the strictly-better re-pins are in the 8λ.1 block below)
  ["$tuple ⇒ $all", { $tuple: [] } as unknown as FenelType, true],
];

describe("typeToSetExpr — shape parity with the pre-port oracle and explicit loss status", () => {
  for (const [name, type, degraded] of CORPUS) {
    it(name, () => {
      const projection = typeToSetExpr(type);
      expect(cf(projection)).toEqual(cf(oTypeToSetExpr(type)));
      expect(isDegradedTypeProjection(projection)).toBe(degraded);
    });
  }
});

describe("typeToSetExpr — direct canonical projection", () => {
  it("reads optional projection flags and raw group type metadata safely under guarded inspection", () => {
    const { ctx } = harnessForTests();
    const inspect = (name: string, value: unknown) => withRuntimeRepresentationProjection(ctx, frame =>
      dispatchEngineBody(name, [value], frame));
    const ref = { $tag: "SeRef", handle: "String" };
    expect(inspect("engine:typeToSetMarkedSet", ref)).toBe(false);
    expect(inspect("engine:typeToSetMarkedSet", { ...ref, semanticProjectionDegraded: true })).toBe(true);
    expect(inspect("engine:typeToSetMarkedSet", { ...ref, semanticProjectionDegraded: false })).toBe(false);
    expect(inspect("engine:typeToSetMarkedPattern", { t: "group", child: { t: "eps" } })).toBe(false);
    expect(inspect("engine:typeToSetMarkedPattern", {})).toBe(true);
    expect(inspect("engine:typeToSetMarkedPattern", {
      t: "group", child: { t: "eps" }, type: { ...ref, semanticProjectionDegraded: true },
    })).toBe(true);
  });

  it("returns the canonical SeWhere JSON-Logic shape directly from the Fenel body", () => {
    const finiteMap = {
      $map: {
        keys: {
          $tag: "SeInterval",
          interval: {
            lo: { $tag: "Just", _0: { value: 0, inclusive: true } },
            hi: { $tag: "Just", _0: { value: 3, inclusive: false } },
          },
        },
        values: named("Int"),
      },
    } as unknown as FenelType;

    expect(dispatchEngineBody("engine:typeToSetExpr", [marshalTraversalType(finiteMap)])).toEqual({
      $tag: "SeWhere",
      pred: {
        and: [
          { "==": [{ call: ["length", { var: "value" }] }, 3] },
          { call: ["all", { var: "value" }, { fn: [["x"], { call: ["isNumber", { var: "x" }] }] }] },
        ],
      },
    });
  }, 180_000);

  it("projects a raw legacy refinement through its canonical setView", () => {
    const type = refined(named("Int"), {
      $where: { ">": [{ var: "value" }, 0] },
    } as unknown as SetExpr);

    expect(dispatchEngineBody("engine:typeToSetExpr", [marshalTraversalType(type)])).toEqual({
      $tag: "SeIntersect",
      branches: [
        { $tag: "SeRef", handle: "ℤ" },
        { $tag: "SeWhere", pred: { ">": [{ var: "value" }, 0] } },
      ],
    });
  }, 180_000);
});

describe("typeToSetExpr — canonical Rational carrier membership", () => {
  const exactHalf = { $tag: "Rational", num: "1", den: "2" };
  const pureHalf = {
    $tag: "Rational",
    num: { $tag: "Int", magnitude: { $tag: "Succ", _0: { $tag: "Zero" } }, negative: { $tag: "False" } },
    den: { $tag: "Succ", _0: { $tag: "Succ", _0: { $tag: "Zero" } } },
  };
  // C1/B3 test harness: preserve the generated declaration's semantic keys
  // while varying a concrete occurrence. No UUID oracle duplicates the lock.
  const identifiedRationalFields = (): Array<{ name: string; key: FieldKey; type: FenelType }> => {
    const traversal = marshalTraversalType(Rational) as {
      pure: { fields: Array<{ wireName: string; semanticKey: FieldKey }> };
    };
    return traversal.pure.fields.map(field => ({
      name: field.wireName,
      key: field.semanticKey,
      type: named(field.wireName === "num" ? "Int" : "PositiveNat"),
    }));
  };
  const ratioWithFields = (fields: ReturnType<typeof identifiedRationalFields>): FenelType =>
    opaque("Rational", { $record: { fields } } as unknown as FenelType);

  it("projects the canonical opaque and its named type to the same existing Membership face", () => {
    const projection = typeToSetExpr(Rational);
    expect(projection).toEqual({ $tag: "SeRef", handle: "Rational" });
    expect(projection).toEqual(typeToSetExpr(named("Rational")));
    expect(isDegradedTypeProjection(projection)).toBe(false);
    for (const value of [exactHalf, pureHalf, { $tag: "Rational", num: 1, den: 2 }]) {
      expect(contains(projection, value, null)).toEqual({ $tag: "Just", _0: true });
    }
    for (const value of [0.5, { $tag: "Rational", num: "1", den: "0" }]) {
      expect(contains(projection, value, null)).toEqual({ $tag: "Just", _0: false });
    }
    expect(contains(projection, { $tag: "Rational", num: "1".repeat(4097), den: "2" }, null))
      .toEqual({ $tag: "Nothing" });
  }, 180_000);

  it("finds canonical fields by semantic identity rather than declaration order", () => {
    const fields = identifiedRationalFields().reverse();
    expect(typeToSetExpr(ratioWithFields(fields))).toEqual({ $tag: "SeRef", handle: "Rational" });
  });

  it("does not grant a Rational carrier to another pure type or unrelated field identities", () => {
    const unrelated = identifiedRationalFields().map((field, index) => ({
      ...field, key: index === 0 ? FIELD_X : FIELD_NEXT,
    }));
    for (const type of [opaque("Rational", named("String")), ratioWithFields(unrelated)]) {
      const projection = typeToSetExpr(type);
      expect(isDegradedTypeProjection(projection)).toBe(true);
      expect(contains(projection, exactHalf, null)).toEqual({ $tag: "Nothing" });
    }
    const ordinary = typeToSetExpr(opaque("Caption", named("String")));
    expect(ordinary).toEqual({ $tag: "SeRef", handle: "String" });
    expect(isDegradedTypeProjection(ordinary)).toBe(false);
    expect(contains(ordinary, "caption", null)).toEqual({ $tag: "Just", _0: true });
  });

  it("fences changed occurrence types and concrete carrier wire slots", () => {
    const fields = identifiedRationalFields();
    const changedType = fields.map(field => field.name === "num" ? { ...field, type: named("String") } : field);
    const changedWire = fields.map(field => field.name === "num" ? { ...field, name: "numerator" } : field);
    for (const changed of [changedType, changedWire, [...fields, { name: "other", key: FIELD_X, type: named("Int") }]]) {
      const projection = typeToSetExpr(ratioWithFields(changed));
      expect(isDegradedTypeProjection(projection)).toBe(true);
      expect(contains(projection, exactHalf, null)).toEqual({ $tag: "Nothing" });
    }
  });

  it("fences lexical binders that would capture the nominal face or its part references", () => {
    for (const binder of ["Rational", "Int", "PositiveNat"]) {
      const captured = { $mu: { var: binder, body: Rational } } as unknown as FenelType;
      const projection = typeToSetExpr(captured);
      expect(isDegradedTypeProjection(projection)).toBe(true);
      expect(contains(projection, exactHalf, null)).toEqual({ $tag: "Nothing" });
    }
  });

  it("does not turn a source-created opaque with missing repository facts into an exact projection", () => {
    const node = { ...(marshalTraversalType(Rational) as Record<string, unknown>) };
    delete node.repositoryRationalKeys;
    expect(dispatchEngineBody("engine:typeToSetRationalOpaque", [node])).toBe(false);
    expect(dispatchEngineBody("engine:typeToSetProjection", [node])).toMatchObject({ degraded: true });
  });
});

describe("typeToSetExpr — canonical exact integer carrier membership", () => {
  const zero = { $tag: "Zero" };
  const successor = { $tag: "Succ", _0: zero };
  const integer = { $tag: "Int", magnitude: successor, negative: { $tag: "False" } };

  it("projects canonical Nat and Int through their existing named Membership aliases", () => {
    for (const [type, name, handle, values] of [
      [Nat, "Nat", "ℕ", [{ $tag: "Nat", digits: "9007199254740993" }, zero, successor, 1]],
      [Int, "Int", "ℤ", [{ $tag: "Int", digits: "-9007199254740993" }, integer, -1]],
    ] as const) {
      const projection = typeToSetExpr(type);
      expect(projection).toEqual({ $tag: "SeRef", handle });
      expect(projection).toEqual(typeToSetExpr(named(name)));
      expect(dispatchEngineBody("engine:canonicalRepresentationName", [marshalTraversalType(type)])).toBe(name);
      for (const value of values) expect(contains(projection, value, null)).toEqual({ $tag: "Just", _0: true });
      expect(contains(projection, "1", null)).toEqual({ $tag: "Just", _0: false });
      expect(contains(projection, { $tag: name, digits: "1".repeat(4097) }, null)).toEqual({ $tag: "Nothing" });
    }
  }, 180_000);

  it("does not select integer Membership by opaque name or case names alone", () => {
    const fakeNat = opaque("Nat", {
      $variant: { cases: [
        { name: "Zero", fields: [] },
        { name: "Succ", fields: [{ name: "pred", key: FIELD_X, type: named("Nat") }] },
      ] },
    } as unknown as FenelType);
    const fakeInt = opaque("Int", {
      $record: { fields: [
        { name: "magnitude", key: FIELD_X, type: named("Nat") },
        { name: "negative", key: FIELD_NEXT, type: named("Bool") },
      ] },
    } as unknown as FenelType);
    for (const type of [opaque("Nat", named("String")), opaque("Int", named("String")), fakeNat, fakeInt]) {
      const projection = typeToSetExpr(type);
      expect(isDegradedTypeProjection(projection)).toBe(true);
      expect(contains(projection, zero, null)).toEqual({ $tag: "Nothing" });
      expect(dispatchEngineBody("engine:canonicalRepresentationName", [marshalTraversalType(type)])).toBe("");
    }
  });

  it("fences changed Nat discriminators and a changed Int occurrence signature", () => {
    const rawNat = structuredClone(Nat) as typeof Nat & { $opaque: { pure: { $variant: { discriminator?: string } } } };
    rawNat.$opaque.pure.$variant.discriminator = "kind";
    const rawInt = structuredClone(Int) as typeof Int & { $opaque: { pure: { $record: { fields: Array<{ type: FenelType }> } } } };
    rawInt.$opaque.pure.$record.fields[1]!.type = named("String");
    for (const type of [rawNat, rawInt]) {
      const projection = typeToSetExpr(type);
      expect(isDegradedTypeProjection(projection)).toBe(true);
      expect(contains(projection, zero, null)).toEqual({ $tag: "Nothing" });
    }
  });

  it("fences bound integer names, dependency names, glyph capture and missing identity facts", () => {
    for (const [type, binders] of [[Nat, ["Nat", "ℕ"]], [Int, ["Int", "ℤ", "Nat", "Bool"]]] as const) {
      for (const binder of binders) {
        const projection = typeToSetExpr({ $mu: { var: binder, body: type } } as unknown as FenelType);
        expect(isDegradedTypeProjection(projection)).toBe(true);
        expect(contains(projection, zero, null)).toEqual({ $tag: "Nothing" });
      }
      const node = { ...(marshalTraversalType(type) as Record<string, unknown>) };
      delete node.repositoryIntegerKeys;
      expect(dispatchEngineBody("engine:canonicalRepresentationName", [node])).toBe("");
      expect(dispatchEngineBody("engine:typeToSetProjection", [node])).toMatchObject({ degraded: true });
    }
  });

  it("marks finite-map element presentations lossy when their scalar guards exclude exact numeric carriers", () => {
    const keys = { $tag: "SeInterval", interval: {
      lo: { $tag: "Just", _0: { value: 0, inclusive: true } },
      hi: { $tag: "Just", _0: { value: 1, inclusive: false } },
    } };
    for (const values of [Nat, Int, Rational, named("Nat"), named("Int"), named("Rational")]) {
      const projection = typeToSetExpr({ $map: { keys, values } } as unknown as FenelType);
      expect(isDegradedTypeProjection(projection)).toBe(true);
      expect(contains(projection, [{ $tag: "Nat", digits: "9007199254740993" }], null)).toEqual({ $tag: "Nothing" });
      expect(contains(projection, [1], null)).toEqual({ $tag: "Nothing" });
    }
    const intervalValues = refined({ $record: { fields: [{ name: "digits", key: FIELD_X, type: named("String") }] } } as unknown as FenelType,
      { $tag: "SeInterval", interval: { lo: { $tag: "Just", _0: { value: 0, inclusive: true } }, hi: { $tag: "Just", _0: { value: 10, inclusive: true } } } });
    const intervalProjection = typeToSetExpr({ $map: { keys, values: intervalValues } } as unknown as FenelType);
    expect(isDegradedTypeProjection(intervalProjection)).toBe(true);
    expect(contains(intervalProjection, [{ $tag: "Int", digits: "9007199254740993" }], null)).toEqual({ $tag: "Nothing" });
    const ordinary = typeToSetExpr({ $map: { keys, values: named("Number") } } as unknown as FenelType);
    expect(isDegradedTypeProjection(ordinary)).toBe(false);
    expect(contains(ordinary, [1], null)).toEqual({ $tag: "Just", _0: true });
  });
});

describe("typeToSetExpr — captured reader canonical declaration identities", () => {
  const sourceKey = (name: string, ...path: string[]): FieldKey => namedField(
    `field:${[`type:system:${name}`, ...path].map(encodeURIComponent).join("/")}`,
  );
  const sourceRational = opaque("Rational", { $record: { fields: [
    { name: "num", key: sourceKey("Rational", "named:num"), type: named("Int") },
    { name: "den", key: sourceKey("Rational", "named:den"), type: named("PositiveNat") },
  ] } } as unknown as FenelType);
  const sourceInt = opaque("Int", { $record: { fields: [
    { name: "magnitude", key: sourceKey("Int", "named:magnitude"), type: named("Nat") },
    { name: "negative", key: sourceKey("Int", "named:negative"), type: named("Bool") },
  ] } } as unknown as FenelType);
  const sourceNat = opaque("Nat", { $variant: { cases: [
    { name: "Zero", fields: [] },
    { name: "Succ", fields: [{ name: "pred", key: sourceKey("Nat", "case:Succ", "named:pred"), type: named("Nat") }] },
  ] } } as unknown as FenelType);
  const facts = (name: string) => ({
    readerOwnerIdentity: JSON.stringify(["system", name]),
    expectedSystemIdentity: JSON.stringify(["system", name]),
  });

  it("accepts authenticated canonical SourceHandle declarations without repository grafting", () => {
    for (const [name, type, handle] of [["Rational", sourceRational, "Rational"], ["Int", sourceInt, "ℤ"], ["Nat", sourceNat, "ℕ"]] as const) {
      const node = marshalCanonicalRepresentationType(type, facts(name));
      expect(dispatchEngineBody("engine:canonicalRepresentationName", [node])).toBe(name);
      expect(dispatchEngineBody("engine:typeToSetProjection", [node])).toEqual({
        set: { $tag: "SeRef", handle }, degraded: false,
      });
      expect(dispatchEngineBody("engine:typeToSetSemanticError", [node])).toEqual({ $tag: "Nothing" });
      expect(node).toMatchObject({ repositoryRationalKeys: { num: { $tag: "Nothing" }, den: { $tag: "Nothing" } } });
    }
  });

  it("does not authenticate an authored type from its name or forged metadata", () => {
    const spoofed = { ...sourceRational, readerCanonicalOwner: { $tag: "Just", _0: facts("Rational") } };
    expect(dispatchEngineBody("engine:canonicalRepresentationName", [marshalTraversalType(spoofed)])).toBe("");
    const mismatched = marshalCanonicalRepresentationType(sourceRational, {
      ...facts("Rational"), readerOwnerIdentity: JSON.stringify(["private", "Rational"]),
    });
    expect(dispatchEngineBody("engine:canonicalRepresentationName", [mismatched])).toBe("");
    expect(dispatchEngineBody("engine:typeToSetProjection", [mismatched])).toMatchObject({ degraded: true });
  });

  it("refuses another SourceHandle owner or role even when supplied owner tokens agree", () => {
    for (const key of [sourceKey("Int", "named:num"), sourceKey("Rational", "named:other")]) {
      const changed = opaque("Rational", { $record: { fields: [
        { name: "num", key, type: named("Int") },
        { name: "den", key: sourceKey("Rational", "named:den"), type: named("PositiveNat") },
      ] } } as unknown as FenelType);
      const node = marshalCanonicalRepresentationType(changed, facts("Rational"));
      expect(dispatchEngineBody("engine:canonicalRepresentationName", [node])).toBe("");
      expect(dispatchEngineBody("engine:typeToSetProjection", [node])).toMatchObject({ degraded: true });
    }
  });
});

// ===========================================================================
// decide-substrate Phase 8μ.1a — the DATATYPE SET former projection. `$variant`
// / `$record` used to collapse to `$all` (the old default arm); they now project
// to the `SeCtor` former (a variant ⇒ a SeUnion of its SeCtors; a record ⇒ a
// single SeCtor with the synthetic ctor ""). A capability GAIN, re-pinned here as
// strictly-better (the old `$record ⇒ $all` corpus case is retired). The
// coercing-ctor exclusion keeps a `True|False` variant on the `$all` arm (Bool
// stays the enum). Asserted on the raw `$tag` structure (SeCtor has no legacy
// `$`-key form, so `cf`/`setExprToDollarKey` does not lower it).
// ===========================================================================

const recordType = { $record: { fields: [{ name: "x", key: FIELD_X, type: named("Int") }] } } as unknown as FenelType;
const maybeVariant = {
  $variant: {
    cases: [
      { name: "Nothing", fields: [] },
      { name: "Just", fields: [{ name: "_0", key: positionalField(0), type: named("Int") }] },
    ],
  },
} as unknown as FenelType;
const boolVariant = {
  $variant: { cases: [{ name: "True", fields: [] }, { name: "False", fields: [] }] },
} as unknown as FenelType;

describe("typeToSetExpr — SeCtor projection (decide-substrate 8μ.1a)", () => {
  it("$record ⇒ a single SeCtor (ctor \"\") over the field set", () => {
    expect(typeToSetExpr(recordType)).toEqual({
      $tag: "SeCtor",
      ctor: "",
      fields: [{ $tag: "SetCtorField", key: FIELD_X, wireName: "x", set: { $tag: "SeRef", handle: "ℤ" } }],
    });
  });

  it("$variant ⇒ a SeUnion of one SeCtor per case", () => {
    expect(typeToSetExpr(maybeVariant)).toEqual({
      $tag: "SeUnion",
      branches: [
        { $tag: "SeCtor", ctor: "Nothing", fields: [] },
        {
          $tag: "SeCtor",
          ctor: "Just",
          fields: [{ $tag: "SetCtorField", key: positionalField(0), wireName: "_0", set: { $tag: "SeRef", handle: "ℤ" } }],
        },
      ],
    });
  });

  it("True|False variant ⇒ $all (the coercing-ctor exclusion — Bool stays the enum)", () => {
    const projection = typeToSetExpr(boolVariant);
    expect(cf(projection)).toEqual({ $all: true });
    expect(isDegradedTypeProjection(projection)).toBe(true);
  });
});

describe("typeToSetExpr — Fenel-owned field identity preflight", () => {
  // typeToSetExpr is a PROJECTION (an inference/synthesis env builder), not a
  // verdict face or an authoring write: an identity-invalid anonymous shape
  // degrades to the unconstrained ⊤ projection (the historical unknown ⇒ $all
  // posture) instead of throwing at editor-adjacent consumers. Named canonical
  // shapes (the keyless List(a) authoring helper) are normalized through the
  // registry's identified declaration at the marshal seam and project fully.
  it("projects a keyless anonymous record to the unconstrained top (no throw)", () => {
    const keyless = {
      $record: { fields: [{ name: "x", type: named("Int") }] },
    } as unknown as FenelType;
    const projection = typeToSetExpr(keyless);
    expect(cf(projection)).toEqual({ $all: true });
    expect(isDegradedTypeProjection(projection)).toBe(true);
    expect(contains(projection, { x: 1 }, null)).toEqual({ $tag: "Nothing" });
    expect(isSubset(projection, projection)).toEqual({ $tag: "Nothing" });
    expect(decideEmpty(projection)).toEqual({ $tag: "Nothing" });
    expect(witnessOf(projection)).toEqual({ $tag: "Nothing" });
    expect(enumerateOf(projection)).toEqual({ $tag: "Nothing" });
    const composed = { $tag: "SeDiff", left: projection, right: projection } as SetExpr;
    expect(isDegradedTypeProjection(composed)).toBe(true);
    expect(decideEmpty(composed)).toEqual({ $tag: "Nothing" });
    expect(checkAssignable(projection, projection)).toMatchObject({
      ok: false,
      confidence: "unknown",
    });
    const patterned = {
      $tag: "SePattern",
      pattern: { t: "group", name: "x", child: { t: "eps" }, type: projection },
    } as SetExpr;
    expect(isDegradedTypeProjection(patterned)).toBe(true);
    expect(dispatchedSearch(8, patterned)).toMatchObject({ $tag: "SvUnknown" });
    expect(dispatchedSearchTyped({ $ref: "Int" }, 8, patterned)).toMatchObject({
      $tag: "SvUnknown",
    });
    expect(dispatchEngineBodyWithDeciderCtx(
      "engine:checkExpr",
      [{ $tag: "ELit", value: { x: 1 } }, [], composed],
    )).toEqual({ $tag: "Nothing" });
    expect(dispatchedSynthesizeFix(8, composed)).toEqual({ $tag: "Nothing" });
  });

  it("projects a keyless anonymous arrow to the unconstrained top (no throw)", () => {
    const keyless = {
      $arrow: {
        params: [{ name: "x", type: named("Int") }],
        returns: named("Int"),
      },
    } as unknown as FenelType;
    const projection = typeToSetExpr(keyless);
    expect(cf(projection)).toEqual({ $all: true });
    expect(isDegradedTypeProjection(projection)).toBe(true);
  });

  it("marks a benign-unrecognized refinement set as degraded evidence", () => {
    const unknownCodec = {
      $refined: {
        base: named("Int"),
        set: { futureSetEncoding: true },
      },
    } as unknown as FenelType;
    const projection = typeToSetExpr(unknownCodec);
    expect(cf(projection)).toEqual({ $all: true });
    expect(isDegradedTypeProjection(projection)).toBe(true);
    expect(contains(projection, "not-an-int", null)).toEqual({ $tag: "Nothing" });
    expect(isSubset(projection, projection)).toEqual({ $tag: "Nothing" });
  });

  it("abstains when catalog resolution injects a degraded projection", () => {
    const degraded = typeToSetExpr({
      $record: { fields: [{ name: "unkeyed", type: named("Int") }] },
    } as unknown as FenelType);
    const deferred = { $tag: "SeRef", handle: "Deferred" } as SetExpr;
    const resolve = () => degraded as unknown as FenelType;

    expect(contains(deferred, { unkeyed: 1 }, null, undefined, undefined, resolve))
      .toEqual({ $tag: "Nothing" });
    expect(isSubset(deferred, { $tag: "SeAll" }, undefined, resolve))
      .toEqual({ $tag: "Nothing" });
    expect(isDisjoint(deferred, { $tag: "SeNone" }, undefined, resolve))
      .toEqual({ $tag: "Nothing" });
  });
});

// ===========================================================================
// decide-substrate Phase 8μ.1b — the FIXPOINT projection. A structural `$mu`
// projects to `SeMu` (the 8μ.1a "v1 fence" corpus case retired); a bound
// `$var`/`$ref` occurrence projects to `SeRef{handle}` under the binder; a
// FREE `$var` stays `$all` (HEAD behavior). The canonical NAMED-self-reference
// knot (`$opaque{name, pure}` — the List idiom) is exercised in `mu.test.ts`.
// ===========================================================================

describe("typeToSetExpr — SeMu projection (decide-substrate 8μ.1b)", () => {
  it("structural $mu ⇒ SeMu with the bound $var as SeRef", () => {
    const muType = {
      $mu: {
        var: "X",
        body: {
          $variant: {
            cases: [
              { name: "Leaf", fields: [] },
              { name: "Node", fields: [{ name: "next", key: FIELD_NEXT, type: { $var: "X" } }] },
            ],
          },
        },
      },
    } as unknown as FenelType;
    expect(typeToSetExpr(muType)).toEqual({
      $tag: "SeMu",
      var: "X",
      body: {
        $tag: "SeUnion",
        branches: [
          { $tag: "SeCtor", ctor: "Leaf", fields: [] },
          {
            $tag: "SeCtor",
            ctor: "Node",
            fields: [{ $tag: "SetCtorField", key: FIELD_NEXT, wireName: "next", set: { $tag: "SeRef", handle: "X" } }],
          },
        ],
      },
    });
  });

  it("a FREE $var stays $all (an ordinary type parameter — HEAD behavior)", () => {
    const projection = typeToSetExpr({ $var: "a" } as unknown as FenelType);
    expect(cf(projection)).toEqual({ $all: true });
    expect(isDegradedTypeProjection(projection)).toBe(true);
  });
});

// ===========================================================================
// decide-substrate Phase 8λ.1 — the EXPONENTIAL SET former projection. `$arrow`
// used to collapse to `$all` (no information — the judgment could not SEE
// function types); it now projects to the `SeArrow` former (params → SetArrowParam
// via typeToSetExpr on each param type, returns recursed). `$void` used to fall
// through to `$all`; it now projects to `SeNone` (the empty domain — the
// vacuous-witness floor). Both are capability GAINS, re-pinned here as
// strictly-better (the old `$arrow ⇒ $all` / `$void ⇒ $all` corpus rows retired).
// Asserted on the raw `$tag` structure (SeArrow has no legacy `$`-key form).
// ===========================================================================

describe("typeToSetExpr — the $arrow / $void projection (decide-substrate 8λ.1)", () => {
  it("$void ⇒ SeNone (the empty domain — was $all)", () => {
    expect(typeToSetExpr({ $void: true } as unknown as FenelType)).toEqual({ $tag: "SeNone" });
  });

  it("$arrow ⇒ SeArrow over the projected params + return (was $all)", () => {
    const arrowType = {
      $arrow: {
        params: [{ name: "x", key: PARAM_X, type: { $ref: "Int" } }],
        returns: { $ref: "Number" },
      },
    } as unknown as FenelType;
    expect(typeToSetExpr(arrowType)).toEqual({
      $tag: "SeArrow",
      params: [{ $tag: "SetArrowParam", key: PARAM_X, wireName: "x", set: { $tag: "SeRef", handle: "ℤ" } }],
      returns: { $tag: "SeRef", handle: "ℝ" },
    });
  });

  it("a nullary $arrow to $void ⇒ SeArrow [] SeNone", () => {
    const arrowType = { $arrow: { params: [], returns: { $void: true } } } as unknown as FenelType;
    expect(typeToSetExpr(arrowType)).toEqual({ $tag: "SeArrow", params: [], returns: { $tag: "SeNone" } });
  });
});

describe("typeToSetExpr — descriptor-safe shared TraversalType ingress", () => {
  it("does not consult an inherited type discriminator", () => {
    const inherited = Object.create({
      $record: { fields: [{ name: "x", key: FIELD_X, type: named("Int") }] },
    }) as FenelType;
    expect(() => typeToSetExpr(inherited)).toThrow("invalid own-data type boundary");
  });

  it("does not invoke a type-discriminator accessor", () => {
    let reads = 0;
    const hostile = {} as Record<string, unknown>;
    Object.defineProperty(hostile, "$record", {
      enumerable: true,
      get() {
        reads += 1;
        return { fields: [] };
      },
    });
    expect(() => typeToSetExpr(hostile as FenelType)).toThrow(
      "invalid own-data type boundary",
    );
    expect(reads).toBe(0);
  });

  it("rejects an ambiguous own-data type envelope", () => {
    const ambiguous = {
      $ref: "Int",
      $record: { fields: [] },
    } as unknown as FenelType;
    expect(() => typeToSetExpr(ambiguous)).toThrow("invalid own-data type boundary");
  });

  it("accepts a non-enumerable own-data discriminator", () => {
    const type = {} as Record<string, unknown>;
    Object.defineProperty(type, "$record", {
      enumerable: false,
      value: { fields: [{ name: "x", key: FIELD_X, type: named("Int") }] },
    });
    expect(typeToSetExpr(type as FenelType)).toEqual({
      $tag: "SeCtor",
      ctor: "",
      fields: [{
        $tag: "SetCtorField",
        key: FIELD_X,
        wireName: "x",
        set: { $tag: "SeRef", handle: "ℤ" },
      }],
    });
  });

  it("does not invoke nested finite-map interval accessors", () => {
    let reads = 0;
    const interval = {
      hi: { $tag: "Just", _0: { value: 3, inclusive: false } },
    } as Record<string, unknown>;
    Object.defineProperty(interval, "lo", {
      enumerable: true,
      get() {
        reads += 1;
        return { $tag: "Just", _0: { value: 0, inclusive: true } };
      },
    });
    const hostile = {
      $map: {
        keys: { $tag: "SeInterval", interval },
        values: named("Int"),
      },
    } as unknown as FenelType;
    expect(() => typeToSetExpr(hostile)).toThrow("invalid own-data type boundary");
    expect(reads).toBe(0);
  });

  it("terminates an active recursive host graph conservatively", () => {
    const recursive = { $record: { fields: [] as unknown[] } } as unknown as FenelType;
    (recursive as { $record: { fields: unknown[] } }).$record.fields.push({
      name: "next",
      key: FIELD_NEXT,
      type: recursive,
    });
    const projection = typeToSetExpr(recursive);
    expect(projection).toEqual({
      $tag: "SeCtor",
      ctor: "",
      fields: [{
        $tag: "SetCtorField",
        key: FIELD_NEXT,
        wireName: "next",
        set: { $tag: "SeAll" },
      }],
      semanticProjectionDegraded: true,
    });
    expect(isDegradedTypeProjection(projection)).toBe(true);
    expect(contains(projection, { next: null }, null)).toEqual({ $tag: "Nothing" });
  });
});
