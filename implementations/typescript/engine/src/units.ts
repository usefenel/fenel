// A2/B3: source catalogue transport and the existing FenelType dollar-key seam.
// Unit arithmetic, conversion, equality and presentation remain Fenel-bodied.
import type { FenelType, MeasureExpr, UnitFamily } from "./types";
import { dispatchEngineBody } from "./engine-bodies-dispatch";
import { buildSetExpr } from "./set-marker";
import { withRuntimeRepresentationProjection } from "./json-logic";

export type { DimensionVector, UnitCalibration, UnitDefinition, UnitChoice, UnitFamily, MeasureExpr } from "./types";

/** A scalar carries the actual unit expression in its type. */
export function measureType(unit: MeasureExpr, base: FenelType = { $ref: "Rational" }): FenelType {
  return { $tagged: { value: base, phantom: {
    $refined: { base: { $ref: "MeasureExpr" }, set: buildSetExpr.enum([unit]) },
  } } };
}

/** Catalogue expressions evaluate after registry boot, preserving typed data. */
export function unitFamilies(): UnitFamily[] {
  // A2/B3 — GLOBAL_ONLY: this frameless repository catalogue invokes its fixed
  // source factory without authority or perform, including numeric defaults.
  return withRuntimeRepresentationProjection({}, frame =>
    (dispatchEngineBody("units:unitCatalogue", [], frame) as { families: UnitFamily[] }).families);
}

/** Display spelling is a source projection of a typed expression. */
export function formatMeasure(unit: MeasureExpr): string {
  return dispatchEngineBody("units:formatMeasure", [unit]) as string;
}
