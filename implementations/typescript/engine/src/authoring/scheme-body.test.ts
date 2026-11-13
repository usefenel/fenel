import { expect, test } from "bun:test";
import { Nothing } from "../type-foundation";
import type { FenelType, FieldDef, Kind, TypeScheme } from "../types";
import { reconcileAuthoringSchemeBody } from "./scheme-body";
import { createRegistry } from "../registry";
import { loadFenelModule } from "../fenel-module";
import { moduleSourceCoordinate } from "../json-logic";
import type { EvaluateContext } from "../json-logic";

const typeKind: Kind = { $tag: "KType" };
const unary: Kind = { $tag: "KArrow", input: typeKind, output: typeKind };
const quantified = [{ id: "binder:f", sourceName: "f", kind: unary }, { id: "binder:a", sourceName: "a", kind: typeKind }];
const field = (name: string, index: number, type: FenelType): FieldDef => ({ name, type, label: Nothing, ui: Nothing, meta: {},
  key: { $tag: "NamedField", ref: { $ref: `7d388daa-64b0-4345-a801-${String(index).padStart(12, "0")}` } } });
function accepted(scheme: TypeScheme, nextBody: FenelType): TypeScheme {
  const result = reconcileAuthoringSchemeBody({ scheme, nextBody });
  if (!result.ok) throw new Error(result.message);
  return result.scheme;
}

test("structural scheme edit follows FieldKeys without conflating equal nominal spellings", () => {
  const first = field("first", 1, { $ref: "Token" }), second = field("second", 2, { $ref: "Token" });
  const body: FenelType = { $record: { fields: [first, second] } };
  const scheme: TypeScheme = { quantified: [], body, nominals: [
    { path: ["$record", "fields", "0", "type"], identity: "first-owner", publicName: "Token" },
    { path: ["$record", "fields", "1", "type"], identity: "second-owner", publicName: "Token" },
  ] };
  const nextBody: FenelType = { $record: { fields: [second, first] } };
  const next = accepted(scheme, nextBody);
  expect(next.nominals).toEqual([
    { ...scheme.nominals![0]!, path: ["$record", "fields", "1", "type"] },
    { ...scheme.nominals![1]!, path: ["$record", "fields", "0", "type"] },
  ]);
  expect(next.body).toBe(nextBody);
  expect(next.quantified).toBe(scheme.quantified);
  expect(scheme.body).toBe(body);
  expect(accepted(scheme, { $record: { fields: [first] } }).nominals).toEqual([scheme.nominals![0]!]);
}, 120_000);

test("fresh higher-kind applications use only the declared binder and current arguments", () => {
  const argument: FenelType = { $var: "a" };
  const nextBody: FenelType = { $record: { fields: [field("wrapped", 1, { $el: { call: ["f", argument] } })] } };
  const scheme: TypeScheme = { quantified, body: { $unit: true } };
  const next = accepted(scheme, nextBody);
  expect(next.applications).toEqual([{ path: ["$record", "fields", "0", "type"], headVarId: "binder:f", kind: unary, args: [argument] }]);
  expect(next.applications![0]!.args[0]).toBe(argument);
  expect(next.quantified).toBe(quantified);
  const movedBody: FenelType = { $record: { fields: [field("new", 2, { $unit: true }),
    field("wrapped", 1, { $el: { call: ["f", { $ref: "Number" }] } })] } };
  const moved = accepted(next, movedBody);
  expect(moved.applications![0]!.path).toEqual(["$record", "fields", "1", "type"]);
  expect(moved.applications![0]!.args).toEqual([{ $ref: "Number" }]);
}, 120_000);

test("deletion removes owned sidecars while malformed old mirrors and wrong kinds refuse", () => {
  const body: FenelType = { $record: { fields: [field("wrapped", 1, { $el: { call: ["f", { $var: "a" }] } })] } };
  const scheme = accepted({ quantified, body: { $unit: true } }, body);
  expect(accepted(scheme, { $record: { fields: [] } }).applications).toEqual([]);
  const stale: TypeScheme = { ...scheme, applications: scheme.applications!.map(app => ({ ...app, args: [{ $ref: "String" }] })) };
  expect(reconcileAuthoringSchemeBody({ scheme: stale, nextBody: body })).toMatchObject({ ok: false });
  const overApplied: FenelType = { $el: { call: ["f", { $var: "a" }, { $var: "a" }] } };
  expect(reconcileAuthoringSchemeBody({ scheme: { quantified, body: { $unit: true } }, nextBody: overApplied })).toMatchObject({ ok: false });
  expect(reconcileAuthoringSchemeBody({ scheme: { quantified, body: { $unit: true } }, nextBody: { $el: { call: ["UnknownFamily", { $var: "a" }] } } })).toMatchObject({ ok: false });
}, 120_000);

test("function result replacement refreshes app mirrors and removes replaced nominal evidence", () => {
  const params = [field("input", 1, { $var: "a" })];
  const returns: FenelType = { $el: { call: ["f", { $var: "a" }] } };
  const scheme = accepted({ quantified, body: { $arrow: { params, returns: { $unit: true } } } }, { $arrow: { params, returns } });
  const next = accepted(scheme, { $arrow: { params, returns: { $el: { call: ["f", { $ref: "String" }] } } } });
  expect(next.applications![0]!.path).toEqual(["$arrow", "returns"]);
  expect(next.applications![0]!.args).toEqual([{ $ref: "String" }]);
  const old: TypeScheme = { quantified: [], body: { $ref: "Token" }, nominals: [{ path: [], identity: "owner", publicName: "Token" }] };
  expect(accepted(old, { $ref: "Other" }).nominals).toEqual([]);
  expect(reconcileAuthoringSchemeBody({ scheme: old, nextBody: { $tuple: [{ $ref: "Token" }] } })).toMatchObject({ ok: false });
}, 120_000);

test("diagnostic ownership moves by key and refuses stale semantic repairs", () => {
  const first = field("first", 1, { $ref: "Number" }), second = field("second", 2, { $ref: "String" });
  const scheme: TypeScheme = { quantified: [], body: { $record: { fields: [first, second] } }, diagnostics: [{
    path: ["$record", "fields", "0", "type"], code: "retained", declaration: "Fixture", spelling: "Number", message: "Source diagnostic",
  }] };
  const moved = accepted(scheme, { $record: { fields: [second, first] } });
  expect(moved.diagnostics![0]!.path).toEqual(["$record", "fields", "1", "type"]);
  expect(reconcileAuthoringSchemeBody({ scheme, nextBody: { $record: { fields: [{ ...first, type: { $ref: "String" } }, second] } } })).toMatchObject({ ok: false });
}, 120_000);

test("positional deletion and equal-looking swaps cannot transfer nominal owners", () => {
  const positional = (index: number): FieldDef => ({ name: `_${index}`, key: { $tag: "PositionalField", index },
    type: { $ref: "Token" }, label: Nothing, ui: Nothing, meta: {} });
  const params = [positional(0), positional(1)];
  const scheme: TypeScheme = { quantified: [], body: { $arrow: { params, returns: { $unit: true } } }, nominals: [
    { path: ["$arrow", "params", "0", "type"], identity: "owner-A", publicName: "Token" },
    { path: ["$arrow", "params", "1", "type"], identity: "owner-B", publicName: "Token" },
  ] };
  const reindex = (param: FieldDef, index: number): FieldDef => ({ ...param, name: `_${index}`, key: { $tag: "PositionalField", index } });
  const deletion: FenelType = { $arrow: { params: [reindex(params[1]!, 0)], returns: { $unit: true } } };
  const swap: FenelType = { $arrow: { params: [reindex(params[1]!, 0), reindex(params[0]!, 1)], returns: { $unit: true } } };
  expect(swap as FenelType).toEqual(scheme.body);
  expect(reconcileAuthoringSchemeBody({ scheme, nextBody: deletion })).toMatchObject({ ok: false });
  expect(reconcileAuthoringSchemeBody({ scheme, nextBody: swap })).toMatchObject({ ok: false });
  const unchangedContainer = accepted(scheme, { $arrow: { params, returns: { $ref: "Number" } } });
  expect(unchangedContainer.nominals).toEqual(scheme.nominals);
  const noEvidence: TypeScheme = { quantified: [], body: scheme.body };
  expect(reconcileAuthoringSchemeBody({ scheme: noEvidence, nextBody: deletion }).ok).toBe(true);
  expect(reconcileAuthoringSchemeBody({ scheme: noEvidence, nextBody: swap }).ok).toBe(true);
}, 120_000);

test("positional application evidence requires the original container too", () => {
  const type: FenelType = { $el: { call: ["f", { $var: "a" }] } };
  const params: FieldDef[] = [0, 1].map(index => ({ name: `_${index}`, key: { $tag: "PositionalField", index },
    type, label: Nothing, ui: Nothing, meta: {} }));
  const scheme: TypeScheme = { quantified, body: { $arrow: { params, returns: { $unit: true } } }, applications: params.map((_, index) => ({
    path: ["$arrow", "params", String(index), "type"], headVarId: "binder:f", kind: unary, args: [{ $var: "a" }],
  })) };
  const nextBody: FenelType = { $arrow: { params: [{ ...params[1]!, name: "_0", key: { $tag: "PositionalField", index: 0 } }], returns: { $unit: true } } };
  expect(reconcileAuthoringSchemeBody({ scheme, nextBody })).toMatchObject({ ok: false });
  expect(accepted(scheme, { $arrow: { params, returns: { $ref: "Number" } } }).applications).toEqual(scheme.applications);
}, 120_000);

test("captured nominal kinds admit the incremental List seed and then the declared generic head", () => {
  const registry = createRegistry([], { publishCatalogEntities: false });
  const context = registry.evaluateContext();
  const scheme: TypeScheme = { quantified, body: { $unit: true } };
  const listBody: FenelType = { $el: { call: ["List", { $ref: "String" }] } };
  const result = reconcileAuthoringSchemeBody({ scheme, nextBody: listBody, context });
  if (!result.ok) throw new Error(result.message);
  const owner = context._typeFamilyOwner!("List", context._sourceFunction)!;
  expect(result.scheme.applications).toEqual([{ path: [], headRef: "List", kind: unary, args: [{ $ref: "String" }] }]);
  expect(result.scheme.nominals).toEqual([{ path: [], identity: owner.ownerIdentity, publicName: "List" }]);
  const next = reconcileAuthoringSchemeBody({ scheme: result.scheme, nextBody: { $el: { call: ["f", { $var: "a" }] } }, context });
  if (!next.ok) throw new Error(next.message);
  expect(next.scheme.applications![0]!.headVarId).toBe("binder:f");
  expect(next.scheme.nominals).toEqual([]);
  expect(next.scheme.quantified).toBe(quantified);
  expect(reconcileAuthoringSchemeBody({ scheme, nextBody: listBody }).ok).toBe(false);
}, 120_000);

test("nominal capture respects same-name source aliases and never falls back across readers", () => {
  const left = loadFenelModule("Twin a = LeftTwin a", "leftOwner");
  const right = loadFenelModule("Twin a = RightTwin a", "rightOwner");
  const useLeft = { ...loadFenelModule("marker = 0", "leftReader"), imports: [{ module: "leftOwner", as: "pick" }] };
  const useRight = { ...loadFenelModule("marker = 0", "rightReader"), imports: [{ module: "rightOwner", as: "pick" }] };
  const leftRegistry = createRegistry([left, useLeft], { publishCatalogEntities: false });
  const rightRegistry = createRegistry([right, useRight], { publishCatalogEntities: false });
  const leftContext = { ...leftRegistry.evaluateContext(), _sourceFunction: moduleSourceCoordinate("leftReader") };
  const rightContext = { ...rightRegistry.evaluateContext(), _sourceFunction: moduleSourceCoordinate("rightReader") };
  const scheme: TypeScheme = { quantified: [], body: { $unit: true } };
  const nextBody: FenelType = { $el: { call: ["pick.Twin", { $ref: "Number" }] } };
  const l = reconcileAuthoringSchemeBody({ scheme, nextBody, context: leftContext });
  const r = reconcileAuthoringSchemeBody({ scheme, nextBody, context: rightContext });
  if (!l.ok || !r.ok) throw new Error(!l.ok ? l.message : !r.ok ? r.message : "Capture failed");
  expect(l.scheme.nominals![0]!.identity).toBe(leftContext._typeFamilyOwner!("pick.Twin", leftContext._sourceFunction)!.ownerIdentity);
  expect(r.scheme.nominals![0]!.identity).toBe(rightContext._typeFamilyOwner!("pick.Twin", rightContext._sourceFunction)!.ownerIdentity);
  expect(l.scheme.nominals![0]!.identity).not.toBe(r.scheme.nominals![0]!.identity);
  let fallbackReads = 0;
  const hidden: EvaluateContext = { ...leftContext, _typeFamilyOwner: () => undefined,
    getFunction: () => { fallbackReads++; throw new Error("No cross-reader fallback"); } };
  expect(reconcileAuthoringSchemeBody({ scheme, nextBody, context: hidden }).ok).toBe(false);
  expect(fallbackReads).toBe(0);
  expect(reconcileAuthoringSchemeBody({ scheme, nextBody, context: { ...leftContext, _sourceFunction: "unregistered:caller" } }).ok).toBe(false);
  expect(reconcileAuthoringSchemeBody({ scheme, nextBody, context: { ...leftContext, _typeFamilyOwner: () => { throw new Error("Private owner unreadable"); } } })).toMatchObject({ ok: false });
}, 120_000);

test("evidence-free dependent shape edits remain data without invented schemes", () => {
  const scheme: TypeScheme = { quantified: [], body: { $unit: true } };
  const dependent: FenelType = { $el: { var: "sibling" } };
  const next = reconcileAuthoringSchemeBody({ scheme, nextBody: dependent });
  expect(next).toEqual({ ok: true, scheme: { quantified: [], body: dependent } });
  if (!next.ok) throw new Error(next.message);
  expect(next.scheme).not.toHaveProperty("applications");
  expect(next.scheme).not.toHaveProperty("nominals");
  expect(reconcileAuthoringSchemeBody({ scheme: { ...scheme, quantified }, nextBody: dependent }).ok).toBe(false);
  expect(accepted(next.scheme, { $ref: "Number" }).body).toEqual({ $ref: "Number" });
});
