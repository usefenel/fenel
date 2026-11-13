import { describe, expect, test } from "bun:test";
import { evaluate } from "../json-logic";
import { print } from "../engine-bodies-dispatch";
import { parse } from "../fenel-parser";
import { Nothing } from "../type-foundation";
import { contains } from "../set-algebra";
import { typeToSetExpr } from "../fenel-check";
import type { Expression, FenelType } from "../types";
import { editTypePredicateSugar, inspectTypePredicateSugar } from "./type-predicate-sugar";

const fieldId = "ba35bbd5-cb04-47ab-a80d-1b424d660a95";
const constructorId = "79f7d54d-ccec-4d0f-a3bb-c5112cead977";
const field = { name: "accepted", key: { $tag: "NamedField" as const, ref: { $ref: fieldId } }, type: { $ref: "Boolean" } as FenelType, label: Nothing, ui: Nothing, meta: {}, optionalDraft: undefined };
const base: FenelType = { $variant: { cases: [
  { name: "Good", fields: [field], label: Nothing },
  { name: "Other", fields: [], label: Nothing },
] } };
function changed(result: ReturnType<typeof editTypePredicateSugar>): FenelType {
  if (!result.ok) throw new Error(result.message);
  return result.type;
}
function predicate(type: FenelType): Expression {
  if (!("$refined" in type) || type.$refined.set.$tag !== "SeWhere") throw new Error("Expected where refinement");
  return type.$refined.set.pred;
}

describe("source-owned global and choice predicate sugar", () => {
  test("global and case conditions execute as ordinary match and Boolean expressions", () => {
    const global: Expression = { var: "value.enabled" };
    const specific: Expression = { var: "value.accepted" };
    const withGlobal = changed(editTypePredicateSugar(base, { kind: "global", predicate: global }));
    const combined = changed(editTypePredicateSugar(withGlobal, { kind: "case", index: 0, predicate: specific }));
    const raw = predicate(combined);
    expect(evaluate(raw, { value: { $tag: "Good", enabled: true, accepted: true } })).toBe(true);
    expect(evaluate(raw, { value: { $tag: "Good", enabled: true, accepted: false } })).toBe(false);
    expect(evaluate(raw, { value: { $tag: "Other", enabled: true } })).toBe(true);
    expect(evaluate(raw, { value: { $tag: "Other", enabled: false } })).toBe(false);
    expect(contains(typeToSetExpr(combined), { $tag: "Unknown", enabled: true }, null)).toEqual({ $tag: "Just", _0: false });
    const reopened = inspectTypePredicateSugar(combined);
    if (!reopened.ok) throw new Error(reopened.message);
    expect(reopened.base).toBe(base);
    expect(reopened.global).toBe(global);
    expect(reopened.cases[0]!.predicate).toBe(specific);
    expect(reopened.cases[1]!.predicate).toBeUndefined();
    expect(parse(print(raw))).toEqual(raw);
    const cleared = changed(editTypePredicateSugar(combined, { kind: "case", index: 0 }));
    expect(predicate(cleared)).toBe(global);
    expect(changed(editTypePredicateSugar(cleared, { kind: "global" }))).toBe(base);
  });

  test("arbitrary existing where predicates and Ref bodies remain intact", () => {
    const arbitrary: Expression = { var: ["value.enabled", { $ref: fieldId }] };
    const existing: FenelType = { $refined: { base, set: { $tag: "SeWhere", pred: arbitrary } } };
    const specific: Expression = { call: ["externalPredicate", { $ref: fieldId }, { var: "value" }] };
    const combined = changed(editTypePredicateSugar(existing, { kind: "case", index: 0, predicate: specific }));
    const projected = inspectTypePredicateSugar(combined);
    if (!projected.ok) throw new Error(projected.message);
    expect(projected.global).toBe(arbitrary);
    expect(projected.cases[0]!.predicate).toBe(specific);
    expect(changed(editTypePredicateSugar(combined, { kind: "case", index: 0 }))).toEqual(existing);
    expect(predicate(existing)).toBe(arbitrary);
  });

  test("choice input type retains its exact case and owned field metadata", () => {
    const projected = inspectTypePredicateSugar(base);
    if (!projected.ok || !("$variant" in projected.cases[0]!.type) || !("$variant" in base)) throw new Error("Expected variant scope");
    expect(projected.cases[0]!.type.$variant.cases).toEqual([base.$variant.cases[0]!]);
    expect(projected.cases[0]!.type.$variant.cases[0]).toBe(base.$variant.cases[0]);
    expect(projected.cases[0]!.type.$variant.cases[0]!.fields![0]).toBe(field);
  });

  test("owned constructor identity stays in the pattern and current wire projection selects it", () => {
    if (!("$variant" in base)) throw new Error("Expected variant");
    const owned: FenelType = { $variant: { ...base.$variant, cases: [{ ...base.$variant.cases[0]!, constructorFunction: { $ref: constructorId } }, base.$variant.cases[1]!] } };
    const combined = changed(editTypePredicateSugar(owned, { kind: "case", index: 0, predicate: { do: [false] } }));
    expect(JSON.stringify(predicate(combined))).toContain(constructorId);
    const context = { _constructorWireNames: { [constructorId]: "Good" } };
    expect(evaluate(predicate(combined), { value: { $tag: "Good", accepted: true } }, context)).toBe(false);
    expect(contains(typeToSetExpr(combined), { $tag: "Good", accepted: true }, null)).toEqual(Nothing);
    const reopened = inspectTypePredicateSugar(combined);
    if (!reopened.ok) throw new Error(reopened.message);
    expect(reopened.cases[0]!.target).toBe(constructorId);
  });

  test("actual refined-type membership abstains without an owned projection and decides only with it", () => {
    const owned: FenelType = { $variant: { cases: [{ name: "Owned", constructorFunction: { $ref: constructorId }, fields: [], label: Nothing }] } };
    const value = { $tag: "Owned" };
    const context = { _constructorWireNames: { [constructorId]: "Owned" } };
    let mappingReads = 0;
    const accessorContext = Object.defineProperty({}, "_constructorWireNames", {
      get() { mappingReads += 1; return context._constructorWireNames; },
    });
    expect(contains(typeToSetExpr(owned), value, null)).toEqual({ $tag: "Just", _0: true });
    for (const verdict of [true, false]) {
      const constrained = changed(editTypePredicateSugar(owned, { kind: "case", index: 0, predicate: { do: [verdict] } }));
      const set = typeToSetExpr(constrained);
      expect(contains(set, value, null)).toEqual(Nothing);
      expect(contains(set, value, null, undefined, context)).toEqual({ $tag: "Just", _0: verdict });
      expect(contains(set, value, null, undefined, accessorContext)).toEqual(Nothing);
      expect(mappingReads).toBe(0);
      expect(contains(set, { $tag: "OutsideBase" }, null)).toEqual({ $tag: "Just", _0: false });
    }
  });

  test("base edits retain conditions by owned constructor identity through rename and reorder", () => {
    if (!("$variant" in base)) throw new Error("Expected variant");
    const originalCase = { ...base.$variant.cases[0]!, constructorFunction: { $ref: constructorId } };
    const owned: FenelType = { $variant: { cases: [originalCase, base.$variant.cases[1]!] } };
    const condition: Expression = { var: "value.accepted" };
    const conditioned = changed(editTypePredicateSugar(owned, { kind: "case", index: 0, predicate: condition }));
    const extra = { ...field, name: "extra", key: { $tag: "NamedField" as const, ref: { $ref: "ba35bbd5-cb04-47ab-a80d-1b424d660a96" } } };
    const editedBase: FenelType = { $variant: { cases: [base.$variant.cases[1]!, { ...originalCase, name: "Renamed", fields: [field, extra] }, { name: "Added", fields: [], label: Nothing }] } };
    const edited = changed(editTypePredicateSugar(conditioned, { kind: "base", base: editedBase }));
    const projected = inspectTypePredicateSugar(edited);
    if (!projected.ok) throw new Error(projected.message);
    expect(projected.base).toBe(editedBase);
    expect(projected.cases[1]!.target).toBe(constructorId);
    expect(projected.cases[1]!.predicate).toBe(condition);
    expect(projected.cases[0]!.predicate).toBeUndefined();
    expect(projected.cases[2]!.predicate).toBeUndefined();
    expect(evaluate(predicate(edited), { value: { $tag: "Added" } })).toBe(true);
  });

  test("base edits refuse dropping conditioned targets or invalidating their field references", () => {
    if (!("$variant" in base)) throw new Error("Expected variant");
    const conditioned = changed(editTypePredicateSugar(base, { kind: "case", index: 0, predicate: { var: "value.accepted" } }));
    const badFields = [[], [{ ...field, name: "renamed" }], [{ ...field, type: { $ref: "String" } as FenelType }]];
    for (const fields of badFields) {
      const next: FenelType = { $variant: { cases: [{ ...base.$variant.cases[0]!, fields }, base.$variant.cases[1]!] } };
      expect(editTypePredicateSugar(conditioned, { kind: "base", base: next }).ok).toBe(false);
    }
    expect(editTypePredicateSugar(conditioned, { kind: "base", base: { $variant: { cases: [base.$variant.cases[1]!] } } }).ok).toBe(false);
    expect(editTypePredicateSugar(conditioned, { kind: "base", base: { $variant: { cases: [{ ...base.$variant.cases[0]!, name: "Renamed" }, base.$variant.cases[1]!] } } }).ok).toBe(false);
    const current = inspectTypePredicateSugar(conditioned);
    if (!current.ok) throw new Error(current.message);
    expect(current.base).toBe(base);
  });

  test("arbitrary global predicates retain their scope during base edits", () => {
    if (!("$variant" in base)) throw new Error("Expected variant");
    const global: Expression = { call: ["externalScopeCheck", { var: "value" }] };
    const conditioned = changed(editTypePredicateSugar(base, { kind: "global", predicate: global }));
    const reordered: FenelType = { $variant: { cases: [...base.$variant.cases].reverse() } };
    expect(predicate(changed(editTypePredicateSugar(conditioned, { kind: "base", base: reordered })))).toBe(global);
    const added: FenelType = { $variant: { cases: [...base.$variant.cases, { name: "Added", label: Nothing }] } };
    expect(editTypePredicateSugar(conditioned, { kind: "base", base: added }).ok).toBe(false);
    expect(editTypePredicateSugar(conditioned, { kind: "base", base: { $unit: true } }).ok).toBe(false);
  });

  test("unknown choices, duplicate names, malformed refs and arbitrary SetExpr constraints refuse", () => {
    expect(editTypePredicateSugar(base, { kind: "case", index: 99, predicate: { do: [true] } }).ok).toBe(false);
    const duplicate: FenelType = { $variant: { cases: [{ name: "Same", label: Nothing }, { name: "Same", label: Nothing }] } };
    expect(inspectTypePredicateSugar(duplicate).ok).toBe(false);
    const malformed: FenelType = { $variant: { cases: [{ name: "Good", label: Nothing, constructorFunction: { $ref: "not-an-identity" } }] } };
    expect(inspectTypePredicateSugar(malformed).ok).toBe(false);
    const constrained: FenelType = { $refined: { base, set: { $tag: "SeEnum", values: [] } } };
    expect(inspectTypePredicateSugar(constrained).ok).toBe(false);
    expect(editTypePredicateSugar(constrained, { kind: "global", predicate: { do: [true] } }).ok).toBe(false);
    expect(constrained.$refined.set).toEqual({ $tag: "SeEnum", values: [] });
    let reads = 0;
    const hostile = { get $variant() { reads++; return {}; } } as FenelType;
    expect(inspectTypePredicateSugar(hostile).ok).toBe(false);
    expect(reads).toBe(0);
  });
});
