// @ts-nocheck -- C1 executes the actual browser adapters with canonical checking.
import { describe, expect, test } from "bun:test";
import ts from "typescript";
import {
  authoringScopeForLetBinding, createAuthoringEnvironment, inferAuthoringCallGuidance, inferAuthoringExpressionWithLiteralWitnesses,
  judgeAuthoringSchemeCompatibility, projectAuthoringScheme, rankAuthoringFunctionSuggestions,
} from "@fenel/engine/authoring/environment";
import { functionBodySaveIssue } from "./creation-validation";
import { displayFunctionSignature } from "./call-display";

const editorSource = await Bun.file(new URL("./index.tsx", import.meta.url)).text();
const homeSource = await Bun.file(new URL("../../routes/app/home.tsx", import.meta.url)).text();
const transpiler = new Bun.Transpiler({ loader: "ts" });
const nothing = { $tag: "Nothing" };
const number = { $ref: "Number" }, string = { $ref: "String" };
const field = (type) => ({ name: "x", type, key: { $tag: "PositionalField", index: 0 }, label: nothing, ui: nothing, meta: {} });
const arrow = (input, returns) => ({ $arrow: { params: [field(input)], returns } });
const variable = { $var: "a" };
const identityScheme = { quantified: [{ id: "local-a", sourceName: "a", kind: { $tag: "KType" } }], body: arrow(variable, variable) };

function inspectorAdapter(source) {
  const syntax = ts.createSourceFile("home.tsx", source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
  const declaration = syntax.statements.find(node => ts.isFunctionDeclaration(node) && node.name?.text === "InspectionExpression");
  let editor;
  const visit = node => {
    if ((ts.isJsxSelfClosingElement(node) || ts.isJsxOpeningElement(node)) && node.tagName.getText(syntax) === "ExpressionEditor") editor = node;
    ts.forEachChild(node, visit);
  };
  visit(declaration);
  const prop = name => editor.attributes.properties.find(node => ts.isJsxAttribute(node) && node.name.text === name)
    ?.initializer?.expression?.getText(syntax) ?? "undefined";
  const start = source.indexOf("  const bodyScheme = createMemo", declaration.pos);
  // B4 slice 2: the Local live-guidance block follows the inspector's schemes.
  const end = source.indexOf("  // B4 slice 2: a Local reader's Inspection check", start);
  expect(start).toBeGreaterThan(0); expect(end).toBeGreaterThan(start);
  return new Function("fn", "scheme", "createMemo", "projectAuthoringScheme", "Nothing",
    transpiler.transformSync(`${source.slice(start, end)}\nreturn () => ({ field: ${prop("fieldDef")}, scheme: ${prop("expectedScheme")} });`));
}

describe("function inspector result requirements", () => {
  const make = inspectorAdapter(homeSource);
  const environment = createAuthoringEnvironment({ types: [], functions: [], capabilities: [], catalogTypes: [], operatorCodeNameByNotation: new Map() });
  function definition(intent) {
    const scheme = { quantified: [], body: { $arrow: { params: [], returns: string } } };
    return { id: "inspectResult", params: [], returns: string, body: "before",
      ...(intent === "legacy" ? {} : { signatureDeclaration: {
        functionId: "inspectResult", declarationName: "inspectResult", codeName: "inspectResult", params: [], scheme,
        returns: intent === "auto" ? { $tag: "Absent" } : { $tag: "Authored", source: { $tag: "HostSpec", module: "inspector-fixture" } },
      } }) };
  }

  test("inferred returns stay display evidence while body editing and save accept a new result type", () => {
    const fn = definition("auto");
    const effective = { quantified: [], body: { $arrow: { params: [], returns: fn.returns } } };
    const requirement = make(() => fn, () => effective, compute => compute, projectAuthoringScheme, nothing)();
    expect(requirement).toEqual({ field: undefined, scheme: undefined });
    expect(effective.body.$arrow.returns).toBe(string);
    expect(functionBodySaveIssue({ kind: "literal", value: 7 }, fn, environment)).toBeUndefined();
  }, 60000);

  test("explicit and legacy contracts remain required and incompatible body edits refuse", () => {
    for (const intent of ["explicit", "legacy"]) {
      const fn = definition(intent);
      const effective = { quantified: [], body: { $arrow: { params: [], returns: fn.returns } } };
      const requirement = make(() => fn, () => effective, compute => compute, projectAuthoringScheme, nothing)();
      expect(requirement.field.type).toBe(string);
      expect(requirement.scheme.body).toBe(string);
      expect(functionBodySaveIssue({ kind: "literal", value: 7 }, fn, environment)).toBeDefined();
      expect(functionBodySaveIssue({ kind: "literal", value: "recovered" }, fn, environment)).toBeUndefined();
    }
  }, 60000);

  test("changing reader declaration intent refreshes the same adapter without losing return sidecars", () => {
    let fn = definition("explicit");
    const returned = { $ref: "Token" };
    const effective = { quantified: [], body: { $arrow: { params: [], returns: returned } },
      nominals: [{ path: ["$arrow", "returns"], identity: "captured-token", publicName: "Token" }] };
    const read = make(() => fn, () => effective, compute => compute, projectAuthoringScheme, nothing);
    expect(read().scheme.nominals).toEqual([{ path: [], identity: "captured-token", publicName: "Token" }]);
    fn = definition("auto");
    expect(read()).toEqual({ field: undefined, scheme: undefined });
    fn = definition("explicit");
    expect(read().scheme.body).toBe(returned);
  });
});

describe("local callable picker scheme transport", () => {
  const start = editorSource.indexOf("  const localRows = createMemo(() => {");
  const end = editorSource.indexOf("  // The keyboard walks", start);
  const make = new Function("props", "localParams", "kindFilter", "filter", "session", "expected", "showOther", "createMemo",
    "peelArrowType", "judgeAuthoringSchemeCompatibility", "rankAuthoringFunctionSuggestions", "inferenceContext", "inferAuthoringExpressionWithLiteralWitnesses",
    `${transpiler.transformSync(editorSource.slice(start, end))}; return localRows;`);
  const contextStart = editorSource.indexOf("function useExpressionInferenceContext(");
  const contextEnd = editorSource.indexOf("\nfunction inferExpression(", contextStart);
  const makeContext = new Function("useContext", "LambdaParamsContext", "SavedValuesContext", "createMemo", "literalMembershipFor",
    `${transpiler.transformSync(editorSource.slice(contextStart, contextEnd))}; return useExpressionInferenceContext;`);
  function checkedRows(params, expected, other = false, rankedEntries = []) {
    const token = {};
    const context = makeContext(key => key === token ? () => params : undefined, token, {}, compute => compute, () => undefined)({ environment: {} });
    return make({ onPickLocal() {} }, () => params, () => "all", () => "", {}, () => expected, () => other, compute => compute,
      type => "$arrow" in type ? type : undefined, judgeAuthoringSchemeCompatibility, (entries, wanted, options) => {
        rankedEntries.push(...entries);
        return rankAuthoringFunctionSuggestions(entries, wanted, options);
      },
      context, inferAuthoringExpressionWithLiteralWitnesses)();
  }
  const rows = (...args) => checkedRows(...args).map(({ param, compatible }) => ({ param, compatible }));
  const local = (name, scheme) => ({ name, type: scheme.body, scheme });

  test("generic local identity is offered for Number using its complete callable scheme", () => {
    const param = local("identity", identityScheme);
    expect(rows([param], number)).toEqual([{ param, compatible: true }]);
    const guidance = inferAuthoringCallGuidance({ id: "identity", ...identityScheme.body.$arrow,
      scheme: identityScheme, signatureOutcome: { $tag: "Solved" } }, [{ kind: "literal", value: undefined }], number);
    expect(guidance.outcome.$tag).toBe("Solved");
    expect(judgeAuthoringSchemeCompatibility(guidance.paramSchemes[0], number)).toBe("compatible");
  }, 60000);

  test("local signature presentation retains the exact checked entry used for ranking", () => {
    const param = local("identity", identityScheme);
    const ranked = [];
    const row = checkedRows([param], number, false, ranked)[0];
    expect(row.entry).toBe(ranked[0]);
    expect(row.entry.scheme.quantified).toHaveLength(1);
    expect(displayFunctionSignature(row.entry, () => undefined)).toBe("∀ a0. (_0:a0) → a0");
    expect(editorSource).toContain("<PickerSignature entry={entry} session={session} />");
    expect(editorSource).toContain("fallback={typeCode(row.param.type)}");
  }, 60000);

  test("ordinary Let scope exposes its inferred callable without a fabricated binding identity", () => {
    const scope = authoringScopeForLetBinding([{ name: "identity", expr: { kind: "literal", value: {
      __lambda: { params: ["x"], body: { kind: "param", name: "x" } },
    } } }], 1, []);
    expect(scope[0].bindingId).toBeUndefined();
    expect(rows(scope, number)).toEqual([{ param: scope[0], compatible: true }]);
  }, 60000);

  test("the same lexical root selection drives inference and visible shadowed rows", () => {
    const outer = local("callback", { quantified: [], body: arrow(number, number) });
    const inner = local("callback", { quantified: [], body: arrow(number, string) });
    expect(rows([outer, inner], number)).toEqual([]);
    expect(rows([outer, inner], number, true)).toEqual([{ param: inner, compatible: false }]);
    expect(rows([outer, inner], string)).toEqual([{ param: inner, compatible: true }]);
  }, 60000);

  test("same display names retain their nominal owner through the projected return", () => {
    const token = { $ref: "Token" };
    const scheme = { quantified: [], body: arrow(number, token),
      nominals: [{ path: ["$arrow", "returns"], identity: "owner-A", publicName: "Token" }] };
    const param = local("owned", scheme);
    const expected = identity => ({ quantified: [], body: token, nominals: [{ path: [], identity, publicName: "Token" }] });
    expect(rows([param], expected("owner-A"))).toEqual([{ param, compatible: true }]);
    expect(rows([param], expected("owner-B"))).toEqual([]);
    expect(rows([param], expected("owner-B"), true)).toEqual([{ param, compatible: false }]);
  }, 60000);

  test("unbound and malformed local schemes cannot become compatible choices", () => {
    const unbound = local("unbound", { quantified: [], body: arrow(number, variable) });
    const malformed = { ...local("malformed", { quantified: [], body: number }), type: arrow(number, number) };
    for (const param of [unbound, malformed]) {
      expect(rows([param], number)).toEqual([]);
      expect(rows([param], number, true)).toEqual([{ param, compatible: false }]);
    }
  }, 60000);

  test("explicit type applications retain their specialized result and readiness fence", () => {
    const ready = { ...local("typeApplication", identityScheme), bindingId: "declared-type-variable", typeApplication: { returns: number, params: [], seeds: [], ready: true } };
    expect(rows([ready], number)).toEqual([{ param: ready, compatible: true }]);
    const pending = { ...ready, typeApplication: { ...ready.typeApplication, ready: false } };
    expect(rows([pending], number)).toEqual([{ param: pending, compatible: false }]);
    expect(rows([ready], string)).toEqual([]);
  }, 60000);
});
