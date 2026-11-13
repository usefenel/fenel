// @ts-nocheck -- C1 harness executes the production browser projection with the real checker.
import { describe, expect, test } from "bun:test";
import { List, Nothing, Just } from "@fenel/engine/type-foundation";
import {
  inferAuthoringCallGuidance,
  inferAuthoringExpressionWithLiteralWitnesses,
  projectAuthoringScheme,
  createAuthoringEnvironment,
  prepareAuthoringLiteralWitnesses,
} from "@fenel/engine/authoring/environment";
import { expandAuthoringParamPaths } from "../../../../../../implementations/typescript/engine/src/authoring/expression-authoring";
import { expectedTypeConsumer } from "../../../../../../implementations/typescript/engine/src/authoring/call-scheme";
import { dispatchEngineBody, dispatchedJsonLogicToSyntax, marshalTraversalType } from "../../../../../../implementations/typescript/engine/src/engine-bodies-dispatch";
import { createDetachedAuthoringEnvironment } from "./detached-authoring-environment";

const source = await Bun.file(new URL("./index.tsx", import.meta.url)).text();
const extended = await Bun.file(new URL("./ExtendedExpressionForms.tsx", import.meta.url)).text();
const start = source.indexOf("  const applicationType = createMemo", source.indexOf("function StructuralFormEditor("));
const projection = source.slice(start, source.indexOf("  const graphCapture =", start));
const transpiler = new Bun.Transpiler({ loader: "ts" });
const make = new Function("props", "localParams", "parentScheme", "inferenceContext", "session", "createMemo",
  "peelArrowType", "inferAuthoringCallGuidance", "inferAuthoringExpressionWithLiteralWitnesses",
  // B4 slice 2: no Local live guidance here (the page inference path).
  `const liveGuidance = undefined; ${transpiler.transformSync(projection)}; return applicationType;`);
const contextStart = source.indexOf("function useExpressionInferenceContext(");
const contextSource = source.slice(contextStart, source.indexOf("\nfunction inferExpression(", contextStart));
// B4 F2: an Account session keeps its own environment and membership judge.
const makeContext = new Function("useContext", "LambdaParamsContext", "SavedValuesContext", "createMemo", "literalMembershipFor",
  "editorEnvironment", "localStructure", "abstainingMembership",
  `${transpiler.transformSync(contextSource)}; return useExpressionInferenceContext;`);
function contextFor(params) {
  const paramContext = {};
  return makeContext(token => token === paramContext ? () => params : undefined, paramContext, {}, fn => fn, () => undefined,
    session => session.environment, () => false, () => Nothing)({ environment: {} });
}
const field = (name, type, index) => ({ name, type, ...(index === undefined ? {} : { key: { $tag: "PositionalField", index } }),
  label: Nothing, ui: Nothing, meta: {} });
const number = { $ref: "Number" };
const string = { $ref: "String" };
const record = { $record: { fields: [field("_0", number, 0), field("_1", string, 1)] } };
const variable = name => ({ $var: name });
const mapScheme = {
  quantified: ["a", "b"].map((sourceName, index) => ({ id: `q${index}`, sourceName, kind: { $tag: "KType" } })),
  body: { $arrow: {
    params: [field("_0", { $arrow: { params: [field("_0", variable("a"), 0)], returns: variable("b") } }, 0),
      field("_1", List(variable("a")), 1)],
    returns: List(variable("b")),
  } },
};
const appendScheme = { quantified: [mapScheme.quantified[0]], body: { $arrow: {
  params: [field("_0", variable("a"), 0), field("_1", List(variable("a")), 1)], returns: List(variable("a")),
} } };
const appendEntry = { id: "fixture-append", targetId: "fixture-append", parentModule: "std", codeName: "appendItem",
  kind: "function", params: appendScheme.body.$arrow.params, returns: appendScheme.body.$arrow.returns,
  scheme: appendScheme, signatureOutcome: { $tag: "Solved" } };
const mapEntry = { id: "fixture-map", targetId: "fixture-map", parentModule: "std", codeName: "map", kind: "function",
  params: mapScheme.body.$arrow.params, returns: mapScheme.body.$arrow.returns,
  scheme: mapScheme, signatureOutcome: { $tag: "Solved" } };
function detachedAppendContext(entry = appendEntry) {
  const base = createAuthoringEnvironment({ types: [], functions: [], capabilities: [], catalogTypes: [],
    operatorCodeNameByNotation: new Map() });
  const select = id => ["appendItem", "std.appendItem", entry.targetId].includes(id) ? entry
    : ["map", "std.map", mapEntry.targetId].includes(id) ? mapEntry : undefined;
  return createDetachedAuthoringEnvironment({ ...base, catalog: { ...base.catalog, functions: [entry, mapEntry] },
    getFunctionEntry: select,
    resolveFunctionId: name => select(name)?.targetId,
  });
}
const lambda = { kind: "literal", value: { __lambda: {
  params: ["row"], arrayParams: true, body: { kind: "param", name: "row._0" },
} } };

function fixture(expected) {
  const parameter = { name: "mapper", type: mapScheme.body, scheme: mapScheme };
  const context = { ...detachedAppendContext(), bindings: { mapper: mapScheme, rows: { quantified: [], body: List(record) } } };
  const props = { form: { kind: "apply", content: { target: { kind: "param", name: "mapper" }, syntax: "call",
    args: [lambda, { kind: "param", name: "rows" }] } } };
  const read = make(props, () => [parameter], () => expected, () => context, {}, fn => fn,
    type => type && "$arrow" in type ? type : undefined, inferAuthoringCallGuidance,
    inferAuthoringExpressionWithLiteralWitnesses);
  return { props, parameter, context, read };
}
function wholeMapped(f) {
  return { kind: "literal", value: { __do: [
    { kind: "literal", value: { __let: { bindings: [{ name: "mapper",
      expr: { kind: "literal", value: { $ref: mapEntry.targetId } } }] } } },
    { kind: "literal", value: { __apply: f.props.form.content } },
  ] } };
}

describe("local mapped application context", () => {
  test("direct Syntax mixed tails and identity overrides cannot impersonate a serialized list literal", () => {
    const mixed = { $tag: "SCall", fnId: "appendItem", lit: true,
      args: [{ $tag: "SLit", value: 1 }, { $tag: "SVar", name: "xs" }] };
    const plain = { ...mixed, lit: false };
    expect(dispatchEngineBody("engine:collectList", [mixed]).$tag).toBe("Nothing");
    expect(dispatchEngineBody("engine:syntaxToJsonLogic", [mixed])).toEqual(
      dispatchEngineBody("engine:syntaxToJsonLogic", [plain]));
    const boundary = scheme => ({ quantified: scheme.quantified, bodyTraversal: marshalTraversalType(scheme.body), applications: [] });
    const local = { quantified: [], body: { $arrow: {
      params: [field("_0", number, 0), field("_1", List(number), 1)], returns: string,
    } } };
    const bindings = [{ name: "xs", scheme: boundary({ quantified: [], body: List(number) }) },
      { name: "appendItem", scheme: boundary(local) }];
    const callables = [{ name: "std.appendItem", targetId: appendEntry.targetId, status: "resolved", trust: "authoring",
      scheme: boundary(appendScheme), valueFields: [], openFields: [] }];
    const infer = syntax => dispatchEngineBody("engine:inferSyntaxType", [syntax, bindings, callables, "test/direct-syntax-list"]);
    const marked = infer(mixed);
    const unmarked = infer(plain);
    expect(marked.$tag).toBe("Solved");
    expect(unmarked.$tag).toBe("Solved");
    expect(marked.plan.scheme).toEqual(unmarked.plan.scheme);
    expect(dispatchEngineBody("engine:inferenceSyntheticListCall", [mixed, "appendItem"])).toBe(false);
    const full = dispatchedJsonLogicToSyntax([1])._0;
    expect(dispatchEngineBody("engine:inferenceSyntheticListCall", [full, "appendItem"])).toBe(true);
    const overridden = { ...full, identityHead: { $tag: "SVar", name: "fixture-identity", identity: true } };
    expect(dispatchEngineBody("engine:inferenceSyntheticListCall", [overridden, "appendItem"])).toBe(false);
    expect(dispatchEngineBody("engine:inferenceSurfaceReferences", [overridden])).not.toContain("std.appendItem");
  }, 180_000);

  test("synthetic list construction uses the existing exact detached signature and retains argument scope", () => {
    const context = detachedAppendContext();
    expect(context.getFunctionEntry("appendItem")).toBeUndefined();
    expect(context.getFunctionEntry("std.appendItem")).toBe(appendEntry);
    const literal = { kind: "literal", value: { __list: [{ kind: "param", name: "item" }] } };
    const bindings = { item: { quantified: [], body: number }, appendItem: { quantified: [], body: string },
      std: { quantified: [], body: string } };
    const inferred = inferAuthoringExpressionWithLiteralWitnesses(literal, { ...context, bindings });
    expect(inferred.outcome.$tag).toBe("Solved");
    const genuine = inferAuthoringExpressionWithLiteralWitnesses({ kind: "call", fnId: "appendItem",
      args: [{ kind: "param", name: "item" }, { kind: "literal", value: [] }] }, { ...context, bindings });
    expect(genuine.outcome.$tag).toBe("Invalid");
    const unknown = inferAuthoringExpressionWithLiteralWitnesses({ kind: "call", fnId: "appendItem", args: [] }, context);
    expect(unknown.outcome.$tag).toBe("AnnotationRequired");
    const syntax = dispatchedJsonLogicToSyntax([{ var: "item" }]);
    expect(syntax.$tag).toBe("Ok");
    expect(dispatchEngineBody("engine:inferenceSurfaceReferences", [syntax._0])).toEqual(["std.appendItem", "item"]);
    expect(dispatchEngineBody("engine:inferenceCallsIn", [syntax._0, ["std", "appendItem"],
      [{ name: "std.appendItem", status: "resolved", targetId: appendEntry.targetId }], []])).toEqual([appendEntry.targetId]);
  }, 180_000);

  test("synthetic construction cannot turn missing or fenced canonical evidence into a type", () => {
    const literal = { kind: "literal", value: [{ amount: 4, label: "Example" }] };
    const missing = inferAuthoringExpressionWithLiteralWitnesses(literal, { getFunctionEntry: () => undefined });
    expect(missing.outcome.$tag).toBe("AnnotationRequired");
    const fenced = detachedAppendContext({ ...appendEntry, signatureOutcome: { $tag: "AnnotationRequired",
      diagnostics: [{ code: "fixture.append-unavailable", message: "canonical append signature is unavailable", functionId: appendEntry.id }] } });
    const result = inferAuthoringExpressionWithLiteralWitnesses(literal, fenced);
    expect(result.outcome.$tag).toBe("AnnotationRequired");
    expect(result.outcome.diagnostics[0].code).toBe("fixture.append-unavailable");
    const heterogeneous = inferAuthoringExpressionWithLiteralWitnesses({ kind: "literal", value: [1, "wrong"] }, detachedAppendContext());
    expect(heterogeneous.outcome.$tag).toBe("Invalid");
    const ordinary = { $tag: "SCall", fnId: "unavailable", args: [], lit: true };
    expect(dispatchEngineBody("engine:inferenceSurfaceReferences", [ordinary])).toEqual(["unavailable"]);
  });

  test("the sibling's complete list type reaches the callback parameter and its field scope", () => {
    const f = fixture();
    const unchanged = structuredClone(f.props.form);
    const guided = f.read();
    expect(guided.scheme.quantified).toHaveLength(2);
    const callback = guided.paramSchemes[0];
    expect(callback.body.$arrow.params[0].type).toEqual(record);
    const row = projectAuthoringScheme(callback, ["$arrow", "params", "0", "type"]);
    expect(row).toBeDefined();
    const scope = expandAuthoringParamPaths([{ name: "row", type: row.body, scheme: row }]);
    expect(scope.find(binding => binding.name === "row._0")?.type).toEqual(number);
    const body = inferAuthoringExpressionWithLiteralWitnesses(lambda.value.__lambda.body, { bindings: { row } },
      { expectedScheme: projectAuthoringScheme(callback, ["$arrow", "returns"]) });
    expect(body.outcome.$tag).toBe("Solved");
    expect(body.type).toEqual(number);
    expect(f.props.form).toEqual(unchanged);
  }, 180_000);

  test("a destination result still constrains an incorrect current callback", () => {
    const f = fixture({ quantified: [], body: List(string) });
    const callback = f.read().paramSchemes[0];
    expect(callback.body.$arrow.params[0].type).toEqual(record);
    expect(callback.body.$arrow.returns).toEqual(string);
    const checked = inferAuthoringExpressionWithLiteralWitnesses(lambda, f.context, { expectedScheme: callback });
    expect(checked.outcome.$tag).not.toBe("Solved");
  });

  test("editing the sibling refreshes the same mounted callback scope", () => {
    const f = fixture();
    expect(f.read().paramSchemes[0].body.$arrow.params[0].type).toEqual(record);
    const changed = { $record: { fields: [field("_1", number, 1)] } };
    f.context.bindings.rows = { quantified: [], body: List(changed) };
    const callback = f.read().paramSchemes[0];
    expect(callback.body.$arrow.params[0].type).toEqual(changed);
    const row = projectAuthoringScheme(callback, ["$arrow", "params", "0", "type"]);
    const names = expandAuthoringParamPaths([{ name: "row", type: row.body, scheme: row }]).map(binding => binding.name);
    expect(names).toContain("row._1");
    expect(names).not.toContain("row._0");
  });

  test("explicit type applications keep their declared argument carriers without value-call inference", () => {
    const f = fixture();
    const params = [field("type", { $type: true }, 0)];
    f.parameter.typeApplication = { params, ready: true };
    const guided = f.read();
    expect(guided.params).toBe(params);
    expect(guided.paramSchemes).toBeUndefined();
    expect(guided.scheme).toBe(mapScheme);
  });

  test("an unbound local callable scheme cannot manufacture solved guidance", () => {
    const f = fixture();
    const malformed = { ...mapScheme, quantified: [] };
    f.parameter.scheme = malformed;
    f.context.bindings.mapper = malformed;
    const guided = f.read();
    expect(guided.scheme).toBeUndefined();
    expect(guided.paramSchemes).toBeUndefined();
    expect(guided.params).toBe(mapScheme.body.$arrow.params);
  });

  test("a populated record annotation cannot supply separately authored field identities", () => {
    const f = fixture();
    const type = List({ $record: { fields: [
      { ...field("amount", number), key: { $tag: "NamedField", ref: { $ref: "6c895f5f-a215-4da9-a5c7-bf32c6c93321" } } },
      { ...field("label", string), key: { $tag: "NamedField", ref: { $ref: "ce6cab26-0f2c-48a0-bae5-a73f570cdb33" } } },
    ] } });
    const source = { kind: "literal", value: { __ann: {
      expr: { kind: "literal", value: [{ amount: 4, label: "Example" }] }, type,
    } } };
    f.props.form.content.args = [
      { kind: "literal", value: { __lambda: { params: ["row"], arrayParams: true,
        body: { kind: "param", name: "row.amount" } } } }, source,
    ];
    const sibling = inferAuthoringExpressionWithLiteralWitnesses(source, f.context);
    expect(sibling.outcome.$tag).toBe("Solved");
    const consumer = expectedTypeConsumer({ quantified: [], body: type });
    const originalChild = inferAuthoringExpressionWithLiteralWitnesses({ kind: "call", fnId: consumer.id,
      args: [source.value.__ann.expr] }, { ...f.context,
      getFunctionEntry: id => id === consumer.id ? consumer : f.context.getFunctionEntry(id) });
    expect(originalChild.outcome.$tag).not.toBe("Solved");
    const membership = Object.assign(() => Just(true), { resolveAnnotationScheme: body => ({ quantified: [], body }) });
    const prepared = prepareAuthoringLiteralWitnesses(source, f.context, { literalMembership: membership });
    expect(Object.keys(prepared.bindings)).toEqual(Object.keys(f.context.bindings));
    expect(prepared.literalChecks).toEqual([]);
  });

  test("ordinary populated record lists supply their whole-inferred field scope without a separate declaration", () => {
    const f = fixture();
    const body = { kind: "param", name: "row.amount" };
    const callback = { kind: "literal", value: { __lambda: { params: ["row"], arrayParams: true, body } } };
    f.props.form.content.args = [callback, { kind: "literal", value: [{ amount: 4, label: "Example" }] }];
    const guided = f.read();
    const row = projectAuthoringScheme(guided.paramSchemes[0], ["$arrow", "params", "0", "type"]);
    expect(row.body.$record.fields.map(field => field.name).sort()).toEqual(["amount", "label"]);
    const scope = expandAuthoringParamPaths([{ name: "row", type: row.body, scheme: row }]);
    expect(scope.find(binding => binding.name === "row.amount")).toBeDefined();
    expect(scope.find(binding => binding.name === "row.label")).toBeDefined();
    const expression = wholeMapped(f);
    expect(inferAuthoringExpressionWithLiteralWitnesses(expression, f.context).outcome.$tag).toBe("Solved");
    body.name = "row.label";
    expect(inferAuthoringExpressionWithLiteralWitnesses(expression, f.context).outcome.$tag).toBe("Solved");
    const consumer = expectedTypeConsumer({ quantified: [], body: List(number) });
    const refused = inferAuthoringExpressionWithLiteralWitnesses({ kind: "call", fnId: consumer.id, args: [expression] },
      { ...f.context, getFunctionEntry: id => id === consumer.id ? consumer : f.context.getFunctionEntry(id) });
    expect(refused.outcome.$tag).toBe("Invalid");
  });

  test("specialized callback fields retain the sibling's captured nominal owner", () => {
    const f = fixture();
    const rows = f.context.bindings.rows;
    const cases = rows.body.$opaque.pure.$variant.cases;
    const cons = cases.findIndex(item => item.name === "Cons");
    const head = cases[cons].fields.findIndex(item => item.name === "head");
    const identity = '["account-shadow","Number"]';
    rows.nominals = [{ path: ["$opaque", "pure", "$variant", "cases", String(cons), "fields", String(head),
      "type", "$record", "fields", "0", "type"], identity, publicName: "Number" }];
    const callback = f.read().paramSchemes[0];
    const row = projectAuthoringScheme(callback, ["$arrow", "params", "0", "type"]);
    const result = inferAuthoringExpressionWithLiteralWitnesses(lambda.value.__lambda.body, { bindings: { row } });
    expect(result.outcome.$tag).toBe("Solved");
    expect(result.scheme.nominals).toEqual([{ path: [], identity, publicName: "Number" }]);
  });

  test("dotted presentation aliases cannot erase or replace a captured field owner", () => {
    const identity = '["owner-A","Number"]';
    const foreign = '["owner-B","Number"]';
    const row = { quantified: [], body: record,
      nominals: [{ path: ["$record", "fields", "0", "type"], identity, publicName: "Number" }] };
    const params = expandAuthoringParamPaths([{ name: "row", type: record, scheme: row }]);
    expect(params.some(param => param.name === "row._0")).toBe(true);
    const context = contextFor(params)();
    expect(Object.keys(context.bindings)).toEqual(["row"]);
    const result = inferAuthoringExpressionWithLiteralWitnesses(lambda.value.__lambda.body, context);
    expect(result.outcome.$tag).toBe("Solved");
    expect(result.scheme.nominals).toEqual([{ path: [], identity, publicName: "Number" }]);
    const consumer = expectedTypeConsumer({ quantified: [], body: number,
      nominals: [{ path: [], identity: foreign, publicName: "Number" }] });
    const rejected = inferAuthoringExpressionWithLiteralWitnesses({ kind: "call", fnId: consumer.id,
      args: [lambda.value.__lambda.body] }, { ...context, getFunctionEntry: id => id === consumer.id ? consumer : undefined });
    expect(rejected.outcome.$tag).not.toBe("Solved");
    expect(params.some(param => param.name === "row._0")).toBe(true);
  });

  test("a dotted local callable projects its complete scheme from the captured root", () => {
    const f = fixture();
    const type = { $record: { fields: [field("_0", mapScheme.body, 0)] } };
    const roots = [{ name: "tools", type, scheme: { quantified: mapScheme.quantified, body: type } },
      { name: "rows", type: List(record), scheme: f.context.bindings.rows }];
    const params = expandAuthoringParamPaths(roots);
    f.props.form.content.target.name = "tools._0";
    const read = make(f.props, () => params, () => undefined, contextFor(params), {}, fn => fn,
      type => type && "$arrow" in type ? type : undefined, inferAuthoringCallGuidance,
      inferAuthoringExpressionWithLiteralWitnesses);
    expect(read().paramSchemes[0].body.$arrow.params[0].type).toEqual(record);
  });

  test("the innermost matching explicit type binder supplies application carriers", () => {
    const f = fixture();
    const outer = { ...f.parameter, typeApplication: { params: [field("_0", string, 0)], ready: true } };
    const inner = { ...f.parameter, typeApplication: { params: [field("_0", { $type: true }, 0)], ready: true } };
    const read = make(f.props, () => [outer, inner], () => undefined, () => f.context, {}, fn => fn,
      type => type && "$arrow" in type ? type : undefined, inferAuthoringCallGuidance,
      inferAuthoringExpressionWithLiteralWitnesses);
    expect(read().params).toBe(inner.typeApplication.params);
  });

  test("the recursive renderer transports each argument's own complete scheme", () => {
    const declaration = extended.slice(extended.indexOf("function ExpressionRows("));
    const getter = declaration.match(/get scheme\(\) \{ return ([^;]+); \}/);
    expect(getter).not.toBeNull();
    const readScheme = new Function("props", "index", `return ${getter[1]};`);
    const first = { quantified: [], body: number, nominals: [{ path: [], identity: "owned-number", publicName: "Number" }] };
    const second = { quantified: [], body: string };
    const props = { schemes: [first, second], scheme: { quantified: [], body: { $unit: true } } };
    expect(readScheme(props, 0)).toBe(first);
    expect(readScheme(props, 1)).toBe(second);
    expect(readScheme(props, 2)).toBe(props.scheme);
    expect(extended).toContain("schemes={props.applicationParameterSchemes}");
    expect(source).toContain("applicationParameterSchemes={applicationType()?.paramSchemes}");
    expect(source).toContain("applicationScheme={applicationType()?.scheme}");
  });
});
