// expr-substrate Phase 6a — conformance tests for prove-on-missing law
// discharge (brief: `workstreams/expr-substrate/briefs/phase-6a-law-discharge.md`).
//
// The ~1297 decidable representation-presence / enum-membership "law
// violations" are `Verified`-typed fields whose value was never authored.
// `buildProveMissingHook` decides them from the instance's sibling method
// values (`engine:lawProposition` builds the `$`-key-free Proposition marker;
// this leaf unmarshals → real `$enum` SetExprs → propose+verify). A
// kernel-accepted `SolverChecked` discharges the law; a genuinely empty /
// out-of-set value REFUTES (the new failure mode, distinct from "missing").
//
// With the hook ABSENT, `validateSpecRecord` is byte-identical to today.

import { describe, it, expect } from "vitest";
import { validateSpecRecord, type FenelType } from "@fenel/engine";
import { buildProveMissingHook } from "./law-discharge";

// A minimal `Verified T`-shaped field type (the `isVerifiedFieldType`
// recognizer: a single-case `$variant` whose case is named "Verified").
const VERIFIED_FIELD = {
  $variant: { cases: [{ name: "Verified", fields: [{ name: "predicate" }, { name: "evidence" }] }] },
} as unknown as FenelType;

/** A spec record type carrying one Verified-typed law field. */
const specType = (lawField: string): FenelType =>
  ({ $record: { fields: [{ name: lawField, type: VERIFIED_FIELD }] } }) as unknown as FenelType;

describe("validateSpecRecord — hook ABSENT is byte-identical (construction-time safety)", () => {
  it("a missing Verified field surfaces the verbatim 'missing Verified value' error", () => {
    expect(validateSpecRecord(specType("labelNonEmpty"), { label: "Hi" })).toEqual([
      { field: "labelNonEmpty", reason: "missing Verified value (got undefined)" },
    ]);
  });

  it("a present, well-formed Verified value still passes without a hook", () => {
    expect(
      validateSpecRecord(specType("labelNonEmpty"), {
        label: "Hi",
        labelNonEmpty: { predicate: true, evidence: { $tag: "SolverChecked" } },
      }),
    ).toEqual([]);
  });
});

describe("prove-on-missing — non-empty-string laws (PropDisjoint vs {''})", () => {
  it("labelNonEmpty with a non-empty string ⇒ discharged (no error)", () => {
    const { hook, stats } = buildProveMissingHook();
    expect(validateSpecRecord(specType("labelNonEmpty"), { label: "Geo Level" }, hook)).toEqual([]);
    expect(stats.discharged).toBe(1);
    expect(stats.refuted).toBe(0);
  });

  it("iconNonEmpty / emojiNonEmpty discharge from their own sibling methods", () => {
    const { hook } = buildProveMissingHook();
    expect(validateSpecRecord(specType("iconNonEmpty"), { icon: "layers" }, hook)).toEqual([]);
    expect(validateSpecRecord(specType("emojiNonEmpty"), { emoji: "📌" }, hook)).toEqual([]);
  });

  it("an EMPTY label ⇒ refuted (the new failure mode — NOT 'missing')", () => {
    const { hook, stats } = buildProveMissingHook();
    const errs = validateSpecRecord(specType("labelNonEmpty"), { label: "" }, hook);
    expect(errs.length).toBe(1);
    expect(errs[0]!.reason).toContain("refuted");
    expect(errs[0]!.reason).not.toContain("missing");
    expect(stats.refuted).toBe(1);
    expect(stats.discharged).toBe(0);
  });
});

describe("prove-on-missing — LocaleString ∃-locale projection (decision 3)", () => {
  it("a LocaleString with ∃ a non-empty locale ⇒ discharged", () => {
    const { hook } = buildProveMissingHook();
    expect(
      validateSpecRecord(specType("labelNonEmpty"), { label: { en: "", fr: "Bonjour" } }, hook),
    ).toEqual([]);
  });

  it("an all-empty LocaleString ⇒ refuted (∃-semantics: no locale is non-empty)", () => {
    const { hook } = buildProveMissingHook();
    const errs = validateSpecRecord(specType("labelNonEmpty"), { label: { en: "", fr: "" } }, hook);
    expect(errs.length).toBe(1);
    expect(errs[0]!.reason).toContain("refuted");
  });
});

describe("prove-on-missing — enum-membership laws (PropSubset)", () => {
  it("structureValid: groupStructure ∈ {flat, tree} ⇒ discharged; out-of-set ⇒ refuted", () => {
    const { hook } = buildProveMissingHook();
    expect(validateSpecRecord(specType("structureValid"), { groupStructure: "flat" }, hook)).toEqual([]);
    expect(validateSpecRecord(specType("structureValid"), { groupStructure: "tree" }, hook)).toEqual([]);
    const errs = validateSpecRecord(specType("structureValid"), { groupStructure: "bogus" }, hook);
    expect(errs.length).toBe(1);
    expect(errs[0]!.reason).toContain("refuted");
  });

  it("geometryTypeValid: geometryType ∈ {point, polygon, multipolygon} ⇒ discharged", () => {
    const { hook } = buildProveMissingHook();
    expect(
      validateSpecRecord(specType("geometryTypeValid"), { geometryType: "multipolygon" }, hook),
    ).toEqual([]);
    expect(
      validateSpecRecord(specType("geometryTypeValid"), { geometryType: "point" }, hook),
    ).toEqual([]);
  });
});

describe("prove-on-missing — the prover-diverse tail stays violating", () => {
  it("an out-of-table law field falls through to 'missing Verified value'", () => {
    const { hook, stats } = buildProveMissingHook();
    const errs = validateSpecRecord(specType("isoDecodeEncodeRoundtrip"), { whatever: 1 }, hook);
    expect(errs).toEqual([
      { field: "isoDecodeEncodeRoundtrip", reason: "missing Verified value (got undefined)" },
    ]);
    expect(stats.discharged).toBe(0);
    expect(stats.refuted).toBe(0);
  });
});
