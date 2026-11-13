// @ts-nocheck -- C1 executes the production browser boundary with canonical inference.
import { describe, expect, test } from "bun:test";
import ts from "typescript";
import {
  createAuthoringEnvironment, inferAuthoringExpressionWithLiteralWitnesses,
  prepareAuthoringLiteralWitnesses,
} from "@fenel/engine/authoring/environment";
import {
  inspectAuthoringExpressionOccurrence, readAuthoringExpressionPath,
  replaceAuthoringExpressionOccurrence, wrapAuthoringExpressionOccurrenceForCheck,
} from "@fenel/engine/authoring/binding-edits";
import { asAuthoringScheme, expectedTypeConsumer } from "../../../../../../implementations/typescript/engine/src/authoring/call-scheme";
import { transferInferenceContext } from "../data-transfer/expressions";
import { annotationTypeForEditor } from "./annotation-lens";
import { literalMembershipFor } from "./literal-membership";
import { draftSaveIssue, functionBodySaveIssue } from "./creation-validation";

const suggestionSource = await Bun.file(new URL("../data-suggestions.ts", import.meta.url)).text();
const editorSource = await Bun.file(new URL("./index.tsx", import.meta.url)).text();
const transpiler = new Bun.Transpiler({ loader: "ts" });
const number = { $ref: "Number" }, string = { $ref: "String" };
const nothing = { $tag: "Nothing" };
const literal = value => ({ kind: "literal", value });
const param = name => ({ kind: "param", name });
const ann = (expr, type) => literal({ __ann: { expr, type } });
const lambda = (names, body) => literal({ __lambda: { params: names, arrayParams: true, body } });
const ground = body => ({ quantified: [], body });
const destination = expected => ({ expected, outcome: { $tag: "Solved" } });
const field = (type, index = 0) => ({ name: `_` + index, type, key: { $tag: "PositionalField", index },
  label: nothing, ui: nothing, meta: {} });
const arrow = (params, returns) => ({ $arrow: { params: params.map(field), returns } });
function entry(id, params, returns) {
  return { id, targetId: id, kind: "function", label: id, description: "", params: params.map(field), returns,
    scheme: ground(arrow(params, returns)), signatureOutcome: { $tag: "Solved" } };
}
function explicitResultDeclaration(returns) {
  const authored = { $tag: "Authored", source: { $tag: "HostSpec", module: "annotation-save-control" } };
  return { id: "annotation-save-control", params: [], returns, body: "before",
    signatureDeclaration: { functionId: "annotation-save-control", declarationName: "annotationSaveControl", codeName: "annotationSaveControl",
      params: [], returns: authored, scheme: ground(arrow([], returns)) } };
}

function declarations(source, names) {
  const syntax = ts.createSourceFile("adapter.ts", source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TS);
  return names.map(name => {
    const node = syntax.statements.find(node => ts.isFunctionDeclaration(node) && node.name?.text === name
      || ts.isVariableStatement(node) && node.declarationList.declarations.some(declaration => declaration.name.getText(syntax) === name));
    expect(node, `production declaration ${name}`).toBeDefined();
    return node.getText(syntax);
  }).join("\n");
}

const productionCode = transpiler.transformSync(declarations(suggestionSource,
  ["lambda", "inferenceContext", "checkExpression", "destinationScheme", "checkEnclosingPlan"]));
const imports = {
  inferAuthoringExpressionWithLiteralWitnesses, prepareAuthoringLiteralWitnesses,
  inspectAuthoringExpressionOccurrence, readAuthoringExpressionPath,
  replaceAuthoringExpressionOccurrence, wrapAuthoringExpressionOccurrenceForCheck,
  asAuthoringScheme, expectedTypeConsumer, transferInferenceContext, annotationTypeForEditor, literalMembershipFor,
};
const production = new Function(...Object.keys(imports), `${productionCode}; return { checkEnclosingPlan, checkExpression };`)(...Object.values(imports));

function session(options = {}) {
  const functions = options.functions ?? [entry("numberIdentity", [number], number), entry("stringLength", [string], number),
    entry("pairNumbers", [number, number], number)];
  const environment = createAuthoringEnvironment({ types: [], functions, capabilities: [], catalogTypes: [], operatorCodeNameByNotation: new Map() });
  // Capture only reader type resolution here. Checking, lexical equations,
  // literal preparation and consumer admission are the production owners.
  const resolveType = type => {
    if (options.resolveType) return options.resolveType(type);
    if (type?.$ref === "Unreadable") return { ok: false };
    return { ok: true, type: asAuthoringScheme(type) };
  };
  return { environment, evaluateContext: {}, registry: {
    callSiteTyping: { resolveType, member: () => "unknown" },
    getIdentifiedEntity: () => undefined,
  } };
}

function captured(root, selected, options = {}) {
  const occurrence = inspectAuthoringExpressionOccurrence(root, selected);
  expect(occurrence.ok).toBe(true);
  return { expression: selected, revision: "nested-annotation", lexicalBindings: options.childBindings,
    destination: options.childDestination,
    enclosing: { expression: root, path: occurrence.value.path,
      lexicalBindings: options.rootBindings, destination: options.destination } };
}
function check(root, selected, replacement, options = {}) {
  return production.checkEnclosingPlan(options.session ?? session(), captured(root, selected, options), replacement, options.missing ?? []);
}
function expectSolved(result) {
  expect(result).toMatchObject({ available: true, rigid: false, checked: { outcome: { $tag: "Solved" } } });
}
function expectRefused(result) {
  expect(result.available && result.checked?.outcome.$tag === "Solved").toBe(false);
}

describe("Suggestions check every live nested annotation in one enclosing expression", () => {
  test("a valid sibling path cannot replace a different captured source occurrence", () => {
    const selected = literal(1), sibling = literal(2);
    const root = literal({ __do: [ann(selected, number), ann(sibling, number)] });
    const input = captured(root, selected), other = captured(root, sibling);
    input.enclosing.path = other.enclosing.path;
    expect(production.checkEnclosingPlan(session(), input, literal(7), []))
      .toEqual({ available: false, rigid: false });
    expect(root.value.__do[0].value.__ann.expr).toBe(selected);
    expect(root.value.__do[1].value.__ann.expr).toBe(sibling);
  });

  test("an unreadable captured occurrence path stays unavailable", () => {
    const selected = literal(1), root = ann(selected, number);
    const input = captured(root, selected);
    input.enclosing.path = ["value", "__ann", "missing"];
    expect(production.checkEnclosingPlan(session(), input, literal(7), []))
      .toEqual({ available: false, rigid: false });
  });

  test("a Number annotation accepts a replacement, including recovery from the currently wrong String", () => {
    for (const before of [1, "currently wrong"]) {
      const selected = literal(before), root = ann(selected, number);
      expectSolved(check(root, selected, literal(7), { destination: destination(number) }));
      expect(selected.value).toBe(before);
      expect(root.value.__ann.expr).toBe(selected);
    }
  }, 60000);

  test("the annotation on the selected value must agree even when the outer result is Number", () => {
    const selected = literal("original");
    const root = { kind: "call", fnId: "stringLength", args: [ann(selected, string)] };
    expectSolved(check(root, selected, literal("replacement"), { destination: destination(number) }));
    expectRefused(check(root, selected, literal(7), { destination: destination(number) }));
  }, 60000);

  test("independent annotation inference is insufficient; explicit consumers reject a wrong sibling", () => {
    const selected = literal(1), wrongSibling = ann(literal("wrong"), number);
    const root = literal({ __do: [wrongSibling, ann(selected, number)] });
    const plain = production.checkExpression(session(), { expression: root, revision: "plain" }, root);
    expect(plain.outcome.$tag).toBe("Solved");
    expectRefused(check(root, selected, literal(7), { destination: destination(number) }));
  }, 60000);

  test("both nested annotations remain enforced in their original lexical positions", () => {
    const selected = literal(1), root = ann(ann(selected, number), string);
    expectRefused(check(root, selected, literal(7)));
    const compatible = ann(ann(selected, number), number);
    expectSolved(check(compatible, selected, literal(7)));
  }, 60000);

  test("one missing argument shares its equations with all annotation consumers", () => {
    const selected = literal(1);
    const root = literal({ __do: [ann(param("extra"), string), ann(selected, number)] });
    expectRefused(check(root, selected, param("extra"), { missing: ["extra"] }));
    const coherent = literal({ __do: [ann(param("extra"), number), ann(selected, number)] });
    expectSolved(check(coherent, selected, param("extra"), { missing: ["extra"] }));
  }, 60000);

  test("an identity retains source-accepted specializations across annotation and enclosing callable contracts", () => {
    const selected = lambda(["x"], param("x"));
    const numberFunction = arrow([number], number), stringFunction = arrow([string], string);
    const callableSession = session({ functions: [entry("useStringFunction", [stringFunction], string)] });
    const root = { kind: "call", fnId: "useStringFunction", args: [ann(selected, numberFunction)] };
    const draftIssue = draftSaveIssue(root, callableSession.environment, { expectedType: string });
    const authoredIssue = functionBodySaveIssue(root, explicitResultDeclaration(string), callableSession.environment);
    const enclosing = check(root, selected, lambda(["x"], param("x")), {
      session: callableSession, destination: destination(string),
    });
    expect(draftIssue).toBeUndefined();
    expect(authoredIssue).toBeUndefined();
    expectSolved(enclosing);
  }, 60000);

  test("a matching enclosing callable contract retains the same annotated lambda's positive result", () => {
    const selected = lambda(["x"], param("x"));
    const numberFunction = arrow([number], number);
    const callableSession = session({ functions: [entry("useNumberFunction", [numberFunction], number)] });
    const root = { kind: "call", fnId: "useNumberFunction", args: [ann(selected, numberFunction)] };
    expect(draftSaveIssue(root, callableSession.environment, { expectedType: number })).toBeUndefined();
    expect(functionBodySaveIssue(root, explicitResultDeclaration(number), callableSession.environment)).toBeUndefined();
    expectSolved(check(root, selected, lambda(["x"], param("x")), {
      session: callableSession, destination: destination(number),
    }));
  }, 60000);

  test("call, Let, Where and lambda descendants use their real executable paths", () => {
    const selected = literal("wrong");
    const call = { kind: "call", fnId: "numberIdentity", args: [ann(selected, number)] };
    const roots = [call,
      literal({ __do: [literal({ __let: { bindings: [{ name: "x", type: number, expr: ann(selected, number) }] } }), param("x")] }),
      literal({ __where: { bindings: [{ name: "x", expr: ann(selected, number) }], body: param("x") } }),
      lambda(["unused"], call),
    ];
    for (const root of roots) {
      expectSolved(check(root, selected, literal(7)));
      expectRefused(check(root, selected, literal("still wrong")));
    }
  }, 60000);

  test("declared binding types are live requirements even without an annotation expression", () => {
    const selected = literal(1);
    const root = literal({ __do: [literal({ __let: { bindings: [{ name: "x", type: number, expr: selected }] } }), param("x")] });
    expectSolved(check(root, selected, literal(7)));
    expectRefused(check(root, selected, literal("wrong")));
  }, 60000);

  test("checking starts with root lexical bindings instead of a child's shadowing rows", () => {
    const selected = literal(1), root = ann(selected, number);
    const bindings = { rootBindings: [{ name: "outside", type: number }], childBindings: [{ name: "outside", type: string }] };
    expectSolved(check(root, selected, param("outside"), bindings));
    expectRefused(check(root, selected, param("outside"), { ...bindings,
      rootBindings: [{ name: "outside", type: string }], childBindings: [{ name: "outside", type: number }] }));
  }, 60000);

  test("a child's Number requirement never invents an absent root result requirement", () => {
    const selected = literal(1), root = literal({ __do: [ann(selected, number), literal("root result")] });
    expectSolved(check(root, selected, literal(7), { childDestination: destination(number) }));
    expectRefused(check(root, selected, literal(7), { childDestination: destination(number), destination: destination(number) }));
  }, 60000);

  test("unreadable and quantified root requirements remain unavailable", () => {
    const selected = literal(1), root = ann(selected, number);
    expect(check(root, selected, literal(7), { destination: destination({ $ref: "Unreadable" }) }))
      .toMatchObject({ available: false, rigid: false });
    const quantified = { quantified: [{ id: "owner-a", sourceName: "a", kind: { $tag: "KType" } }], body: { $var: "a" } };
    expect(check(root, selected, literal(7), { destination: destination(quantified) }))
      .toMatchObject({ available: false, rigid: true });
    expect(check(root, selected, literal(7), { rootBindings: [{ name: "generic", type: quantified.body, scheme: quantified }] }))
      .toMatchObject({ available: false, rigid: true });
    expect(check(root, selected, literal(7), { destination: { expected: number, outcome: { $tag: "AnnotationRequired", diagnostics: [] } } }))
      .toMatchObject({ available: false, rigid: false });
  }, 60000);

  test("same display names retain foreign nominal owners in the annotation equation", () => {
    const token = { $ref: "Token" }, owned = identity => ({ ...ground(token), nominals: [{ path: [], identity, publicName: "Token" }] });
    const selected = param("source"), root = ann(selected, token);
    const nominalSession = session({ resolveType: type => ({ ok: true, type: type === token ? owned("annotation-owner") : asAuthoringScheme(type) }) });
    const bindings = owner => [{ name: "source", type: token, scheme: owned(owner) }];
    expectSolved(check(root, selected, param("source"), { session: nominalSession, rootBindings: bindings("annotation-owner") }));
    expectRefused(check(root, selected, param("source"), { session: nominalSession, rootBindings: bindings("foreign-owner") }));
  }, 60000);
});

describe("recursive editor Suggestions capture lifetime", () => {
  const start = editorSource.indexOf("  const suggestionCheckScope: SuggestionCheckScope = {");
  const end = editorSource.indexOf("  const suggestionOwner =", start);
  expect(start).toBeGreaterThan(0); expect(end).toBeGreaterThan(start);
  const makeCapture = new Function("props", "parentSuggestionCheck", "suggestionDestination", "suggestionLexicalBindings",
    "session", "inspectAuthoringExpressionOccurrence", "transferSaved", "resultBindingContinuation", "draftValueFingerprint",
    "suggestionDraft", "recordValues", "editorFrame",
    `${transpiler.transformSync(editorSource.slice(start, end))}; return { suggestionCheckScope, suggestionSnapshot };`);
  function capture(props, parent, ownDestination, ownBindings, inspect = inspectAuthoringExpressionOccurrence) {
    // B4 F2: an Account session's draft analyses keep its own frame.
    return makeCapture(props, parent, () => ownDestination, () => ownBindings, { evaluateContext: {} },
      inspect, undefined, () => ({ root: () => props.node, path: () => [] }),
      value => JSON.stringify(value), () => props.node, () => ({}), session => session.evaluateContext);
  }

  test("a mounted initializer starts a fresh root and retains its own lexical scope", () => {
    const selected = literal(1), own = ann(selected, number), enclosing = ann(literal(2), string);
    const ownBindings = [{ name: "own", type: number }], outerBindings = [{ name: "outer", type: string }];
    const parent = { node: () => enclosing, destination: () => destination(string), lexicalBindings: () => outerBindings };
    const detached = capture({ node: own, detachSuggestionContext: true }, parent, undefined, ownBindings);
    expect(detached.suggestionCheckScope.node()).toBe(own);
    expect(detached.suggestionCheckScope.destination()).toBeUndefined();
    expect(detached.suggestionCheckScope.lexicalBindings()).toBe(ownBindings);
    expect(detached.suggestionSnapshot().enclosing.expression).toBe(own);
  });

  test("an absent parent destination stays absent while child requirements remain local", () => {
    const selected = literal(1), root = ann(selected, number);
    const rootBindings = [{ name: "outer", type: number }];
    const parent = { node: () => root, destination: () => undefined, lexicalBindings: () => rootBindings };
    const adapter = capture({ node: selected }, parent, destination(number), []);
    expect(adapter.suggestionSnapshot()).toMatchObject({ destination: destination(number), enclosing: { expression: root, lexicalBindings: rootBindings } });
    expect(adapter.suggestionSnapshot().enclosing.destination).toBeUndefined();
  });

  test("a free initializer drops its ancestor's Number use while retaining its own nested String annotation", () => {
    const selected = literal("before"), own = ann(selected, string);
    const outer = literal({ __where: { bindings: [{ name: "x", expr: own }],
      body: { kind: "call", fnId: "numberIdentity", args: [param("x")] } } });
    const parent = { node: () => outer, destination: () => destination(number), lexicalBindings: () => [] };
    const initializer = capture({ node: own, detachSuggestionContext: true }, parent, undefined, []);
    const child = capture({ node: selected }, initializer.suggestionCheckScope, destination(string), []);
    const snapshot = child.suggestionSnapshot();
    expect(snapshot.enclosing.expression).toBe(own);
    expect(snapshot.enclosing.destination).toBeUndefined();
    const input = { ...snapshot, expression: selected, revision: "detached-initializer" };
    expectSolved(production.checkEnclosingPlan(session(), input, literal("after"), []));
    expectRefused(production.checkEnclosingPlan(session(), input, literal(7), []));
  }, 60000);

  test("an unannotated initializer stays free to change its inferred type", () => {
    const selected = literal("before");
    const outer = { kind: "call", fnId: "numberIdentity", args: [selected] };
    const parent = { node: () => outer, destination: () => destination(number), lexicalBindings: () => [] };
    const initializer = capture({ node: selected, detachSuggestionContext: true }, parent, undefined, []);
    const snapshot = initializer.suggestionSnapshot();
    expect(snapshot.destination).toBeUndefined();
    expect(snapshot.enclosing).toBeUndefined();
    const input = { ...snapshot, expression: selected, revision: "free-initializer" };
    const before = production.checkExpression(session(), input, selected);
    const after = production.checkExpression(session(), input, literal(7));
    expect(before).toMatchObject({ outcome: { $tag: "Solved" }, scheme: { body: string } });
    expect(after).toMatchObject({ outcome: { $tag: "Solved" }, scheme: { body: number } });
  }, 60000);

  test("occurrence inspection waits for an explicit snapshot instead of running at provider creation", () => {
    const selected = literal(1), root = ann(selected, number);
    let scans = 0;
    const parent = { node: () => root, destination: () => undefined, lexicalBindings: () => [] };
    const adapter = capture({ node: selected }, parent, destination(number), [], (...args) => {
      scans++;
      return inspectAuthoringExpressionOccurrence(...args);
    });
    expect(scans).toBe(0);
    expect(adapter.suggestionCheckScope.node()).toBe(root);
    expect(scans).toBe(0);
    adapter.suggestionSnapshot();
    expect(scans).toBe(1);
  });

  test("root requirements, siblings and lexical schemes invalidate an unchanged child's captured revision", () => {
    const selected = literal(1), sibling = literal("before");
    const root = literal({ __do: [sibling, ann(selected, number)] });
    let rootDestination;
    let rootBindings = [{ name: "outside", type: number, scheme: ground(number) }];
    const parent = { node: () => root, destination: () => rootDestination, lexicalBindings: () => rootBindings };
    const adapter = capture({ node: selected }, parent, destination(number), []);
    const initial = adapter.suggestionSnapshot();
    expect(initial.enclosing.destination).toBeUndefined();
    rootDestination = destination(number);
    const required = adapter.suggestionSnapshot();
    expect(required.revision).not.toBe(initial.revision);
    expect(required.enclosing.destination).toBe(rootDestination);
    sibling.value = "after";
    const changedSibling = adapter.suggestionSnapshot();
    expect(changedSibling.revision).not.toBe(required.revision);
    rootBindings = [{ name: "outside", type: number, scheme: { ...ground(number),
      nominals: [{ path: [], identity: "new-captured-owner", publicName: "Number" }] } }];
    const changedScope = adapter.suggestionSnapshot();
    expect(changedScope.revision).not.toBe(changedSibling.revision);
    rootDestination = { expected: number, outcome: { $tag: "AnnotationRequired", diagnostics: [] } };
    const unresolved = adapter.suggestionSnapshot();
    expect(unresolved.revision).not.toBe(changedScope.revision);
    expect(unresolved.enclosing.destination).toBe(rootDestination);
    expect(unresolved.destination).toEqual(destination(number));
    expect(root.value.__do[1].value.__ann.expr).toBe(selected);
  });

  // NodeEditorBody holds the recursive editor; NodeEditor only adds its pending-insertion preview.
  for (const componentName of ["NodeEditorBody", "MatchPatternEditor"]) {
  test(`${componentName}'s modal thunk restores its captured live authoring contexts`, () => {
    const syntax = ts.createSourceFile("index.tsx", editorSource, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
    const component = syntax.statements.find(node => ts.isFunctionDeclaration(node) && node.name?.text === componentName);
    const guard = component.body.statements.find(node => ts.isIfStatement(node)
      && node.expression.getText(syntax).includes("pathCtx.depth >= NODE_DEPTH_LIMIT"));
    const recordCapture = component.body.statements.find(node => ts.isVariableStatement(node)
      && node.declarationList.declarations.some(declaration => declaration.name.getText(syntax) === "recordValues"));
    expect(recordCapture.end).toBeLessThan(guard.pos);
    let expand;
    const visit = node => {
      if (ts.isJsxSelfClosingElement(node) && node.tagName.getText(syntax) === "CollapseStub") {
        expand = node.attributes.properties.find(prop => ts.isJsxAttribute(prop) && prop.name.text === "onExpand")
          .initializer.expression.getText(syntax);
      }
      ts.forEachChild(node, visit);
    };
    visit(guard);
    expect(expand).toBeDefined();
    const code = ts.transpileModule(`const subject = ${expand};`, { compilerOptions: {
      target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.None, jsx: ts.JsxEmit.React, jsxFactory: "jsx",
    } }).outputText;
    const providerNames = ["SuggestionCheckContext", "SuggestionDraftContext", "LambdaParamsContext", "RecordValuesContext",
      "SavedValuesContext", "ResultBindingContext", "ExpressionGraphScopeCaptureContext"];
    const tokens = Object.fromEntries([...providerNames, componentName].map(name => [name, { name }]));
    let draft = literal(1), lexical = [{ name: "before", type: number }], siblings = { before: 1 };
    const suggestionCheck = { node: () => draft }, saved = { list: () => [] };
    const resultBinding = { root: () => draft }, scopeCapture = { node: () => draft };
    const values = { parentSuggestionCheck: suggestionCheck, suggestionCheck, suggestionDraft: () => draft,
      params: () => lexical, recordValues: () => siblings, transferSaved: saved, saved,
      parentResultBinding: resultBinding, resultBinding, inheritedScopeCapture: scopeCapture, scopeCapture };
    const fullPath = [{ label: "nested" }], props = componentName === "NodeEditorBody"
      ? { node: draft, detachSuggestionContext: true } : { value: draft, scrutineeType: number };
    let render, openedPath;
    const scope = { ...tokens, ...values, props, fullPath,
      openModal: (path, thunk) => { openedPath = path; render = thunk; },
      jsx: (type, props, ...children) => ({ type, props, children }) };
    const onExpand = new Function(...Object.keys(scope), `${code}; return subject;`)(...Object.values(scope));
    expect(render).toBeUndefined();
    onExpand();
    expect(openedPath).toBe(fullPath);
    draft = literal(2); lexical = [{ name: "after", type: string }]; siblings = { after: 2 };
    let node = render();
    const expectedValues = [values.parentSuggestionCheck, values.suggestionDraft, values.params, values.recordValues,
      values.transferSaved, values.parentResultBinding, values.inheritedScopeCapture];
    for (const [index, name] of providerNames.entries()) {
      expect(node.type).toBe(tokens[name]);
      expect(node.props.value).toBe(expectedValues[index]);
      expect(node.children).toHaveLength(1);
      node = node.children[0];
    }
    expect(node.type).toBe(tokens[componentName]);
    expect(node.props).toEqual(props);
    expect(values.suggestionDraft()).toBe(draft);
    expect(values.params()).toBe(lexical);
    expect(values.recordValues()).toBe(siblings);
  });
  }
});
