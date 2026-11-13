import { describe, it, expect } from "vitest";
import { widgetForType } from "./widget-hint";
import { fenelTypeToJsonSchema } from "./json-schema";
import { measureType, unitFamilies } from "./units";
import { phantomUnitOf } from "./field-meta";
import type { FenelType, MeasureExpr, UnitDefinition } from "./types";
import { Nothing, Rational } from "./type-foundation";

const metre = (): UnitDefinition => unitFamilies().find(family => family.name === "distance")!
  .choices.find(choice => choice.code === "m")!.unit;
const atom = (): MeasureExpr => ({ $tag: "MeasureAtom", unit: metre() });

describe("unit metadata consumers", () => {
  it("uses typed unit data and source-owned suffix text", () => {
    const unit = atom();
    const hint = widgetForType(measureType(unit));
    expect(hint.config?.unit).toEqual(unit);
    expect(hint.config?.unitLabel).toBe("m");
  });

  it("retains the measure inside a refined scalar", () => {
    const unit = atom();
    const type: FenelType = { $refined: { base: measureType(unit),
      set: { $tag: "SeInterval", interval: { lo: Nothing, hi: Nothing } } } };
    expect(widgetForType(type).config?.unit).toEqual(unit);
  });

  it("preserves compound expressions in the hint", () => {
    const unit: MeasureExpr = { $tag: "MeasurePower", base: atom(),
      exponent: { $tag: "Rational", num: "2", den: "1" } };
    expect(widgetForType(measureType(unit)).config?.unit).toEqual(unit);
  });

  it("exports exact Rational representation and complete typed x-unit data", () => {
    const unit = atom();
    const schema = fenelTypeToJsonSchema(measureType(unit));
    expect(schema.type).toBe("object");
    expect(schema.properties).toHaveProperty("num");
    expect(schema.properties).toHaveProperty("den");
    if (!schema.properties?.num || !schema.properties.den) throw new Error("Expected Rational numerator and denominator properties.");
    expect(schema.properties.num.type).toBe("string");
    expect(schema.properties.den.type).toBe("string");
    expect(schema["x-unit"]).toEqual(unit);
  });

  it("does not export unit metadata on plain Rational", () => {
    const schema = fenelTypeToJsonSchema({ $ref: "Rational" });
    expect(schema["x-unit"]).toBeUndefined();
    expect(schema.type).toBe("object");
    const opaqueSchema = fenelTypeToJsonSchema(Rational);
    expect(opaqueSchema.properties).toHaveProperty("num");
    if (!opaqueSchema.properties?.num) throw new Error("Expected the opaque Rational numerator property.");
    expect(opaqueSchema.properties.num.type).toBe("string");
  });

  it("preserves the explicit scalar base in schema output", () => {
    const unit = atom();
    const schema = fenelTypeToJsonSchema(measureType(unit, { $ref: "Number" }));
    expect(schema.type).toBe("number");
    expect(schema["x-unit"]).toEqual(unit);
  });

  it("does not assign Rational's representation to a same-named custom opaque", () => {
    const local: FenelType = { $opaque: { name: "Rational", pure: { $ref: "String" } } };
    expect(fenelTypeToJsonSchema(local).type).toBe("string");
  });

  it("does not confuse another phantom domain with measurement units", () => {
    const currency: FenelType = { $tagged: { value: { $ref: "Rational" },
      phantom: { $refined: { base: { $ref: "CurrencyCode" },
        set: { $tag: "SeEnum", values: ["USD"] } } } } };
    expect(fenelTypeToJsonSchema(currency)["x-unit"]).toBeUndefined();
    expect(phantomUnitOf(currency)).toBe(null);
  });

  it("keeps entity references on their existing picker/schema path", () => {
    const type: FenelType = { $tagged: { value: { $ref: "Id" },
      phantom: { $refined: { base: { $ref: "String" },
        set: { $tag: "SeEnum", values: ["profile"] } } } } };
    expect(widgetForType(type).widget).toBe("entity-picker");
    expect(fenelTypeToJsonSchema(type).type).toBe("string");
  });
});
