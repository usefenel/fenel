import { expect, test } from "bun:test";
import { authoringGenericTypeBindings, projectAuthoringGenericTypeApplication } from "./generic-type-application";
import { reconcileAuthoringSchemeBody } from "./scheme-body";
import type { TypeScheme } from "../types";

const typeKind = { $tag: "KType" } as const;
const unary = { $tag: "KArrow", input: typeKind, output: typeKind } as const;
const scheme: TypeScheme = { quantified: [
  { id: "binder-f", sourceName: "f", kind: unary }, { id: "binder-a", sourceName: "a", kind: typeKind },
], body: { $unit: true } };

test("local type applications project through explicit stable binders and retain canonical arguments", () => {
  const scope = { scheme };
  const argument = { $var: "a", retained: { note: "same object" } };
  const canonical = { call: ["f", argument] };
  const editor = projectAuthoringGenericTypeApplication(scope, canonical, "editor") as { call: unknown[] };
  expect(editor.call[0]).toEqual({ var: "f" });
  expect(editor.call[1]).toBe(argument);
  expect(projectAuthoringGenericTypeApplication(scope, editor, "type")).toEqual(canonical);
  expect(authoringGenericTypeBindings(scope)).toMatchObject([{ id: "binder-f", name: "f", type: { $arrow: {} } }, { id: "binder-a", name: "a", type: { $type: true } }]);
  const whole = reconcileAuthoringSchemeBody({ scheme, nextBody: { $el: { call: ["f", { $var: "a" }] } } });
  expect(whole).toMatchObject({ ok: true, scheme: { applications: [{ headVarId: "binder-f", kind: unary, args: [{ $var: "a" }] }] } });
}, 120_000);

test("global heads, shadowed names and arbitrary closures retain their original carrier", () => {
  const global = { call: ["List", { $var: "a" }] };
  expect(projectAuthoringGenericTypeApplication({ scheme }, global, "editor")).toBe(global);
  const local = { call: ["f", { $var: "a" }] };
  expect(projectAuthoringGenericTypeApplication({ scheme, shadowed: ["f"] }, local, "editor")).toBe(local);
  expect(authoringGenericTypeBindings({ scheme, shadowed: ["f"] }).map(binding => binding.name)).toEqual(["a"]);
  const closure = { call: [{ fn: ["x", { var: "x" }] }, { $var: "a" }] };
  expect(projectAuthoringGenericTypeApplication({ scheme }, closure, "type")).toBe(closure);
  expect(() => projectAuthoringGenericTypeApplication({ scheme }, { call: ["a", { $unit: true }] }, "editor")).toThrow("not callable");
  expect(() => projectAuthoringGenericTypeApplication({ scheme }, { call: [] }, "editor")).toThrow("no callable head");
  expect(() => authoringGenericTypeBindings({ scheme: { ...scheme, quantified: [...scheme.quantified, scheme.quantified[0]!] } })).toThrow("malformed");
}, 120_000);

test("higher-order Kind supplies saturated slots and only declared argument references become type variables", () => {
  const higher = { $tag: "KArrow", input: unary, output: unary } as const;
  const higherScheme: TypeScheme = { ...scheme, quantified: [
    { id: "binder-f", sourceName: "f", kind: higher }, { id: "binder-g", sourceName: "g", kind: unary }, scheme.quantified[1]!,
  ] };
  const scope = { scheme: higherScheme };
  const bindings = authoringGenericTypeBindings(scope);
  expect(bindings[0]!.type).toMatchObject({ $arrow: { returns: { $arrow: {} } } });
  expect(bindings[0]!.typeApplication).toMatchObject({ ready: true, seeds: ["g", ""], returns: { $type: true } });
  expect(bindings[0]!.typeApplication!.params).toHaveLength(2);
  const canonical = { call: ["f", { $var: "g" }, { $var: "a" }] };
  const editor = projectAuthoringGenericTypeApplication(scope, canonical, "editor");
  expect(editor).toEqual({ call: [{ var: "f" }, { var: "g" }, { $var: "a" }] });
  expect(projectAuthoringGenericTypeApplication(scope, editor, "type")).toEqual(canonical);
  const reconciled = reconcileAuthoringSchemeBody({ scheme: higherScheme, nextBody: { $el: canonical } });
  expect(reconciled).toMatchObject({ ok: true, scheme: { applications: [{ headVarId: "binder-f", kind: higher,
    args: [{ $var: "g" }, { $var: "a" }] }] } });
  expect(() => projectAuthoringGenericTypeApplication(scope, { call: [{ var: "f" }, { var: "a" }, { $var: "a" }] }, "type")).toThrow("different argument kind");
  const withoutG = authoringGenericTypeBindings({ scheme: { ...higherScheme, quantified: [higherScheme.quantified[0]!, higherScheme.quantified[2]!] } });
  expect(withoutG[0]!.typeApplication!.ready).toBe(false);
}, 120_000);
