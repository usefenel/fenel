import { describe, it, expect } from "vitest";
import { measureType, unitFamilies } from "./units";
import { phantomUnitOf } from "./field-meta";
import type { MeasureExpr, UnitDefinition } from "./types";
import { runtimeRepresentationInspectionSuppressed } from "./json-logic";

// Canonical native Rational data crosses the same typed phantom boundary.
const zero = { $tag: "Rational", num: "0", den: "1" } as const;
const one = { $tag: "Rational", num: "1", den: "1" } as const;
const customUnit: UnitDefinition = {
  $tag: "UnitDefinition",
  dimension: { $tag: "DimensionVector", length: one, mass: zero, time: zero,
    current: zero, temperature: zero, information: zero, angle: zero },
  calibration: { $tag: "Linear", scale: { $tag: "Rational", num: "7", den: "3" } },
};
const atom: MeasureExpr = { $tag: "MeasureAtom", unit: customUnit };

describe("typed measure phantom", () => {
  it("prepares the source catalogue's exact dimensions and releases its private extent", () => {
    expect(runtimeRepresentationInspectionSuppressed()).toBe(false);
    const families = unitFamilies();
    const metre = families.find(family => family.name === "distance")!
      .choices.find(choice => choice.code === "m")!;
    // The catalogue authors these Rational fields as exact small integer data;
    // preparation preserves that existing layout instead of normalizing it.
    const catalogueZero = { $tag: "Rational", num: 0, den: 1 };
    const catalogueOne = { $tag: "Rational", num: 1, den: 1 };
    expect(metre.unit.dimension).toEqual({ $tag: "DimensionVector", length: catalogueOne,
      mass: catalogueZero, time: catalogueZero, current: catalogueZero,
      temperature: catalogueZero, information: catalogueZero, angle: catalogueZero });
    expect(metre.unit.calibration).toEqual({ $tag: "Linear", scale: catalogueOne });
    expect(families.some(family => family.name === "temperature")).toBe(true);
    expect(runtimeRepresentationInspectionSuppressed()).toBe(false);
  }, 180_000);

  it("carries a complete caller-owned unit definition on Rational", () => {
    expect(measureType(atom)).toEqual({ $tagged: {
      value: { $ref: "Rational" },
      phantom: { $refined: { base: { $ref: "MeasureExpr" },
        set: { $tag: "SeEnum", values: [atom] } } },
    } });
    expect(phantomUnitOf(measureType(atom))).toEqual(atom);
  });

  it("preserves compound expressions and exact fractional exponents", () => {
    const compound: MeasureExpr = { $tag: "MeasureQuotient", left: atom,
      right: { $tag: "MeasurePower", base: atom,
        exponent: { $tag: "Rational", num: "1", den: "3" } } };
    expect(phantomUnitOf(measureType(compound))).toEqual(compound);
  });

  it("recognizes a dimensionless expression", () => {
    expect(phantomUnitOf(measureType({ $tag: "MeasureOne" }))).toEqual({ $tag: "MeasureOne" });
  });

  it("preserves a caller's base type without changing unit meaning", () => {
    const type = measureType(atom, { $ref: "Int" });
    expect(type).toMatchObject({ $tagged: { value: { $ref: "Int" } } });
    expect(phantomUnitOf(type)).toEqual(atom);
  });

  it("does not mistake an entity's name for a unit", () => {
    expect(phantomUnitOf({ $tagged: { value: { $ref: "Id" },
      phantom: { $refined: { base: { $ref: "String" },
        set: { $tag: "SeEnum", values: ["profile"] } } } } })).toBe(null);
  });

  it("refuses old string and unrelated phantom domains", () => {
    expect(phantomUnitOf({ $tagged: { value: { $ref: "Rational" },
      phantom: { $refined: { base: { $ref: "String" },
        set: { $tag: "SeEnum", values: ["kg"] } } } } })).toBe(null);
    expect(phantomUnitOf({ $ref: "Rational" })).toBe(null);
    expect(phantomUnitOf(undefined)).toBe(null);
  });
});
