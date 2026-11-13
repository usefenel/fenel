import { expect, setDefaultTimeout, test } from "bun:test";
import { Anything, List } from "./type-foundation";
import { typeToSetExpr } from "./fenel-check";
import { validateValue } from "./validate";
import { contains, normalize } from "./set-algebra";
import { dispatchedSubset, dispatchedTypeToSetProjection, dispatchedValidationRuntime, dispatchEngineBody, marshalTraversalType } from "./engine-bodies-dispatch";

setDefaultTimeout(300_000);
const TOP = Anything;
const nativeValues = [null, true, false, 0, -0, NaN, Infinity, "text", Uint8Array.of(0, 255), { nested: [42, "value"] }, [], { $ref: "a-stable-reference" }];

test("Anything is the existing complement of Void with a non-degraded universal denotation", () => {
  const set = typeToSetExpr(TOP);
  expect(dispatchedTypeToSetProjection(marshalTraversalType(TOP)).degraded).toBe(false);
  expect(normalize(set)).toEqual({ $tag: "SeAll" });
  for (const value of nativeValues) expect(contains(set, value, null)).toEqual({ $tag: "Just", _0: true });
  expect(dispatchedSubset({ $ref: "String" }, TOP)).toEqual({ $tag: "Just", _0: true });
});

test("the live validator admits heterogeneous native values under List Anything", () => {
  for (const value of nativeValues) {
    expect(validateValue(TOP, value, null, { functions: {} })).toMatchObject({ valid: true, errors: [] });
  }
  const result = validateValue(List(TOP), nativeValues, null, { functions: {} });
  expect(result).toMatchObject({ valid: true, errors: [] });
  expect(result.value).toEqual(nativeValues);
  const direct = dispatchedValidationRuntime(TOP, "test", { requestAccount: null });
  expect(direct.errors).toEqual([]);
  expect(validateValue(List(TOP), 42, null, { functions: {} }).valid).toBe(false);
});

test("containment readiness recognizes precisely the supported universal complement", () => {
  const unsupported = { $complement: { $ref: "String" } };
  for (const fn of ["engine:ttValidationPlanReady", "engine:ttOccurrenceEnforcing"]) {
    expect(dispatchEngineBody(fn, [marshalTraversalType(TOP)])).toBe(true);
    expect(dispatchEngineBody(fn, [marshalTraversalType(unsupported)])).toBe(false);
  }
  expect(dispatchedValidationRuntime(unsupported, 42, { requestAccount: null }).errors).not.toEqual([]);
  expect(dispatchedSubset(List({ $ref: "String" }), List(TOP))).toEqual({ $tag: "Just", _0: true });
  // The existing composite decider does not yet produce a negative witness
  // for this direction. Preserve its honest abstention, never acceptance.
  expect(dispatchedSubset(List(TOP), List({ $ref: "String" }))).toEqual({ $tag: "Nothing" });
});
