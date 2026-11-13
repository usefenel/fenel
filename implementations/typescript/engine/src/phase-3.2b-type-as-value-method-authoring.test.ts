// Phase 3.2b of typeclass-substrate-completion — conformance tests for the
// loader's type-as-value method-field projection + the aggregable migration.
//
// Phase 3 / 3.1 / 3.2 carried every method-value shape the hand-authored
// instance corpus uses EXCEPT one: a method whose value is a TYPE. aggregable's
// 7 `Aggregable` instances carry `inputType` / `outputType` method fields
// declared `FenelType` in the spec, holding bare type refs (`{$ref:"List"}`,
// `{$ref:"Nat"}`, `{$ref:"Number"}`, `{$ref:"Any"}`). Authoring
// `inputType = List` parses `List` (uppercase, value position) to a nullary
// constructor application `{construct:["List"]}`, which the ordinary
// `lowerConstructLiteral` lowers to the runtime VALUE `{$tag:"List"}` — not the
// TYPE reference `{$ref:"List"}` the const holds.
//
// Phase 3.2b adds a DECLARATIVE capability: the caller passes
// `typeValuedFields: { AggregableSpec: ["inputType", "outputType"] }`, and the
// loader lowers a bare nullary `{construct:["X"]}` in those fields to
// `{$ref:"X"}`. NO type-vs-value shape-guess — a guess would corrupt real
// nullary-variant method values like `Nothing` (which must stay `{$tag:...}`).
//
// Pins: (1) lowerTypeValue + end-to-end lowering, incl. the disambiguation
// guard (a non-type-valued nullary construct still → `{$tag}`); (2) aggregable
// projects byte-identically (full object incl. type refs / monotonicity /
// strings / label); (3) Aggregable dispatch via dispatchRegistry.satisfies/.resolve;
// (4) corpus-complete (aggregable carries `{$ref:...}` type refs end-to-end).

import { describe, it, expect } from "bun:test";
import { loadFenelModule, lowerTypeValue } from "./fenel-module";
import { dispatchRegistry } from "./system-entities";
import type { Instance } from "./types";

import {
  aggregableModule,
  aggregableLength,
  aggregableCount,
  aggregableSum,
  aggregableAvg,
  aggregableMinimum,
  aggregableMaximum,
  aggregableDistinctCount,
} from "./modules/aggregable";

import AGGREGABLE_INSTANCES_FENEL from "../../../../fenel/modules/aggregable/instances.fenel?raw";
import { GLOBAL_ONLY } from "./dispatch-registry";

// Phase 3.4b — the spec is `Aggregable` (suffix dropped), so the
// `typeValuedFields` key (looked up by the literal declared type-name) is
// `Aggregable`, and instance files load with `dispatchInstanceFile: true`.
const TV = {
  dispatchInstanceFile: true,
  typeValuedFields: { Aggregable: ["inputType", "outputType"] },
};

const full = (i: Instance) => ({
  typeName: i.typeName,
  args: i.args,
  methods: i.methods,
  label: i.label,
});

// The byte-identity oracle — the exact `{typeName, args, methods, label}`
// shapes the deleted TS consts held (probed before deletion). Independent of
// the loader, so this is a real regression guard, not a self-comparison.
const ORACLE: Record<string, ReturnType<typeof full>> = Object.fromEntries(
  (
    [
      ["length", "Nat", "Neither"],
      ["count", "Nat", "Neither"],
      ["sum", "Number", "Monotone"],
      ["avg", "Number", "Neither"],
      ["minimum", "Any", "Neither"],
      ["maximum", "Any", "Neither"],
      ["distinctCount", "Nat", "Neither"],
    ] as const
  ).map(([agg, out, mono]) => [
    agg,
    {
      typeName: "Aggregable",
      args: [agg],
      methods: {
        inputType: { $ref: "List" },
        outputType: { $ref: out },
        monotonicity: { $tag: mono },
        // modules-as-values Phase 2b: the instances write the qualified
        // functions (`imageOf = aggregable.lengthImageOf`), loaded as
        // references resolved per registry; HEAD before it held the id strings
        // `aggregable:<agg>ImageOf` (the same functions).
        imageOf: { $ref: `aggregable.${agg}ImageOf` },
        preimageOf: { $ref: `aggregable.${agg}PreimageOf` },
      },
      label: `${agg} Aggregable`,
    },
  ]),
);

// ---------------------------------------------------------------------------

describe("Phase 3.2b — type-as-value method lowering (declarative, not a guess)", () => {
  it("lowerTypeValue: bare nullary construct → {$ref} type reference", () => {
    expect(lowerTypeValue({ construct: ["List"] })).toEqual({ $ref: "List" });
    expect(lowerTypeValue({ construct: ["Nat"] })).toEqual({ $ref: "Nat" });
    expect(lowerTypeValue({ construct: ["Any"] })).toEqual({ $ref: "Any" });
  });

  it("lowerTypeValue: already-{$ref} type ref passes through untouched", () => {
    expect(lowerTypeValue({ $ref: "Nat" })).toEqual({ $ref: "Nat" });
  });

  it("lowerTypeValue: non-object values pass through", () => {
    expect(lowerTypeValue("fnId")).toBe("fnId");
    expect(lowerTypeValue(7)).toBe(7);
  });

  it("end-to-end: a type-valued field lowers to {$ref}, a non-type-valued field stays {$tag}", () => {
    const src = `x : Aggregable length
x = Aggregable { inputType = List, outputType = Nat, monotonicity = Neither, imageOf = "i", preimageOf = "p", label = "L" }`;
    const insts = loadFenelModule(src, "t", TV).instances ?? [];
    expect(insts).toHaveLength(1);
    const m = insts[0]!.methods as Record<string, unknown>;
    // inputType / outputType are type-valued → type references.
    expect(m.inputType).toEqual({ $ref: "List" });
    expect(m.outputType).toEqual({ $ref: "Nat" });
    // monotonicity is a nullary construct in a NON-type-valued field — the
    // disambiguation GUARD: it stays the runtime variant value, NOT a type ref.
    expect(m.monotonicity).toEqual({ $tag: "Neither" });
    expect(insts[0]!.label).toBe("L");
  });

  it("guard: WITHOUT typeValuedFields, a nullary construct in inputType lowers to {$tag} (no shape-guess)", () => {
    const src = `x : Aggregable length
x = Aggregable { inputType = List, outputType = Nat, monotonicity = Neither, imageOf = "i", preimageOf = "p", label = "L" }`;
    const insts = loadFenelModule(src, "t", { dispatchInstanceFile: true }).instances ?? [];
    const m = insts[0]!.methods as Record<string, unknown>;
    // No caller declaration → the loader makes NO type-vs-value inference; a
    // bare `{construct:["List"]}` lowers to the runtime value `{$tag:"List"}`.
    // This is why a `Nothing`-style nullary-variant value in any non-declared
    // field is never corrupted.
    expect(m.inputType).toEqual({ $tag: "List" });
  });
});

// ---------------------------------------------------------------------------

describe("Phase 3.2b — aggregable byte-identity (type refs / monotonicity / strings / label)", () => {
  const projected = loadFenelModule(AGGREGABLE_INSTANCES_FENEL, "aggregable", TV).instances ?? [];
  const pick = (agg: string) =>
    projected.find((i) => i.typeName === "Aggregable" && i.args[0] === agg)!;

  it("projects exactly the 7 Aggregable instances", () => {
    expect(projected).toHaveLength(7);
    expect(projected.every((i) => i.typeName === "Aggregable")).toBe(true);
  });

  for (const agg of Object.keys(ORACLE)) {
    it(`${agg} projects byte-identically to the oracle`, () => {
      expect(full(pick(agg))).toEqual(ORACLE[agg]!);
    });
  }

  it("the module re-sources its exported consts from the projection", () => {
    const consts: Record<string, Instance> = {
      length: aggregableLength,
      count: aggregableCount,
      sum: aggregableSum,
      avg: aggregableAvg,
      minimum: aggregableMinimum,
      maximum: aggregableMaximum,
      distinctCount: aggregableDistinctCount,
    };
    for (const [agg, konst] of Object.entries(consts)) {
      expect(full(konst)).toEqual(ORACLE[agg]!);
      // The module's `instances` field carries the same objects the consts
      // resolve to (set-algebra reads them via the registry, but reference
      // identity keeps the const ⇔ module wiring honest).
      expect((aggregableModule.instances ?? []).some((i) => i === konst)).toBe(true);
    }
  });
});

// ---------------------------------------------------------------------------

describe("Phase 3.2b — aggregable dispatch parity", () => {
  it("dispatchRegistry.satisfies keys Aggregable off args[0] (the aggregator codeName)", () => {
    for (const agg of Object.keys(ORACLE)) {
      expect(dispatchRegistry.satisfies(agg, "Aggregable", GLOBAL_ONLY)).toBe(true);
    }
    expect(dispatchRegistry.satisfies("notAnAggregator", "Aggregable", GLOBAL_ONLY)).toBe(false);
  });

  it("dispatchRegistry.resolve returns the byte-identical methods (incl. {$ref} type refs)", () => {
    expect(dispatchRegistry.resolve("length", "Aggregable", GLOBAL_ONLY)).toEqual(ORACLE.length!.methods);
    expect(dispatchRegistry.resolve("sum", "Aggregable", GLOBAL_ONLY)).toMatchObject({
      inputType: { $ref: "List" },
      outputType: { $ref: "Number" },
      monotonicity: { $tag: "Monotone" },
    });
    expect(dispatchRegistry.resolve("minimum", "Aggregable", GLOBAL_ONLY)).toMatchObject({
      outputType: { $ref: "Any" },
    });
  });
});

// ---------------------------------------------------------------------------

describe("Phase 3.2b — corpus-complete (type refs, not runtime tags)", () => {
  it("every aggregable instance carries {$ref:...} type refs in inputType/outputType, never {$tag:...}", () => {
    for (const inst of aggregableModule.instances ?? []) {
      if (inst.typeName !== "Aggregable") continue;
      const m = inst.methods as Record<string, unknown>;
      expect(m.inputType).toHaveProperty("$ref");
      expect(m.inputType).not.toHaveProperty("$tag");
      expect(m.outputType).toHaveProperty("$ref");
      expect(m.outputType).not.toHaveProperty("$tag");
      // monotonicity stays a runtime variant value — type-as-value is scoped
      // to the declared FenelType fields only.
      expect(m.monotonicity).toHaveProperty("$tag");
    }
  });
});
