import { describe, expect, test } from "bun:test";
import { authoringBindingNameIssue, editAuthoringBinding, editAuthoringCall, inspectAuthoringExpressionOccurrence, projectAuthoringGraphEdgeIssue, proposeAuthoringResultBinding, readAuthoringExpressionPath, reconcileAuthoringBindingRows, replaceAuthoringExpressionOccurrence, selectAuthoringCallCandidates, wrapAuthoringExpressionOccurrenceForCheck, type AuthoringBindingDraft, type AuthoringCallEdit } from "./binding-edits";
import { exprNodeToLogic, logicToExprNode, type ExprNode } from "./expression-authoring";
import { dispatchEngineBody, marshalStoredBodyForValidation, withInterpretedCompiledArtifacts } from "../engine-bodies-dispatch";
import type { FieldDef, FenelType, InferenceOutcome, TypeScheme } from "../types";
import { Nothing } from "../type-foundation";
import { evaluate } from "../json-logic";

const literal = (value: unknown): ExprNode => ({ kind: "literal", value });
const param = (name: string): ExprNode => ({ kind: "param", name });
const lambda = (params: string[], body: ExprNode): ExprNode => literal({ __lambda: { params, body, arrayParams: true } });
const draft = (body: ExprNode): AuthoringBindingDraft => ({ params: [{ name: "x" }], body });
const rename = <T extends AuthoringBindingDraft>(value: T, name = "y") => withInterpretedCompiledArtifacts(() =>
  editAuthoringBinding(value, { kind: "rename", index: 0, name }));
const remove = (value: AuthoringBindingDraft) => withInterpretedCompiledArtifacts(() =>
  editAuthoringBinding(value, { kind: "remove", index: 0 }));
const schemeField = (name: string, id: string, type: FenelType = { $ref: "Thing" }): FieldDef => ({
  name, key: { $tag: "NamedField", ref: { $ref: id } }, type, label: Nothing, ui: Nothing, meta: {},
});

describe("source-owned annotation occurrence transport", () => {
  const call = (fnId: string, ...args: ExprNode[]): ExprNode => ({ kind: "call", fnId, args });
  const ann = (expr: ExprNode, type: FenelType): ExprNode => literal({ __ann: { expr, type } });
  const number: FenelType = { $ref: "Number" };
  const inspect = (root: ExprNode, selected: ExprNode) => withInterpretedCompiledArtifacts(() => inspectAuthoringExpressionOccurrence(root, selected));
  const replace = (root: ExprNode, path: (string | number)[], replacement: ExprNode) => withInterpretedCompiledArtifacts(() =>
    replaceAuthoringExpressionOccurrence(root, path, replacement));
  const wrap = (root: ExprNode, path: (string | number)[], consumer: string) => withInterpretedCompiledArtifacts(() =>
    wrapAuthoringExpressionOccurrenceForCheck(root, path, consumer));

  test("selects the exact deep executable occurrence and projects nested annotations inside out", () => {
    const selected = literal(7), sibling = literal(7);
    const innerType: FenelType = { $union: [number, { $ref: "String" }] };
    const inner = ann(selected, innerType);
    const root = ann(call("combine", inner, sibling), number);
    const result = inspect(root, selected);
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.path).toEqual(["value", "__ann", "expr", "args", 0, "value", "__ann", "expr"]);
      expect(result.value.hasEnclosingAnnotation).toBe(true);
      expect(result.value.detached).toBe(false);
      expect(result.value.annotations.map(site => site.expression)).toEqual([selected, readAuthoringExpressionPath(root, ["value", "__ann", "expr"]) as ExprNode]);
      expect(result.value.annotations[0]!.expression).toBe(selected);
      expect(result.value.annotations.map(site => site.type)).toEqual([innerType, number]);
      expect(result.value.annotations[0]!.type).toBe(innerType);
      expect(inspect(root, sibling)).toMatchObject({ ok: true, value: { path: ["value", "__ann", "expr", "args", 1] } });
    }
  });

  test("refuses a missing or shared identity instead of selecting a structurally equal sibling", () => {
    const shared = literal(7);
    expect(inspect(call("combine", shared, shared), shared)).toMatchObject({ ok: false, diagnostics: [{ code: "binding.occurrence" }] });
    expect(inspect(call("combine", literal(7), literal(7)), literal(7))).toMatchObject({ ok: false, diagnostics: [{ code: "binding.occurrence" }] });
  });

  test("literal data, type payloads and metadata never become executable replacement paths", () => {
    const selected = literal(7);
    for (const root of [literal({ nested: selected }), literal([selected]), literal({ $tag: "Box", nested: selected }),
      literal({ __fenelFn: true, body: selected }), { ...literal(1), metadata: selected }]) {
      expect(inspect(root, selected)).toMatchObject({ ok: false });
      expect(inspect(root, root)).toMatchObject({ ok: true, value: { annotations: [] } });
    }
    const typed = ann(literal(1), { $el: selected } as unknown as FenelType);
    expect(inspect(typed, selected)).toMatchObject({ ok: false });
    expect(replace(typed, ["value", "__ann", "type", "$el"], literal(2))).toMatchObject({ ok: false, diagnostics: [{ code: "binding.occurrence" }] });
    expect(inspect(literal({ __futureExecutable: selected }), selected)).toMatchObject({ ok: false, diagnostics: [{ code: "binding.unsupported" }] });
  });

  test("retains own annotations while distinguishing free initializers from returned expressions", () => {
    const first = ann(literal(1), number), final = literal(2), body = param("x");
    const letNode = literal({ __let: { bindings: [{ name: "x", expr: first, type: number }, { name: "y", expr: final }] } });
    expect(inspect(letNode, first)).toMatchObject({ ok: true, value: { detached: true, hasEnclosingAnnotation: true } });
    expect(inspect(letNode, final)).toMatchObject({ ok: true, value: { detached: false } });
    const whereNode = literal({ __where: { bindings: [{ name: "x", expr: first }], body } });
    expect(inspect(whereNode, first)).toMatchObject({ ok: true, value: { detached: true } });
    expect(inspect(whereNode, body)).toMatchObject({ ok: true, value: { detached: false } });
    const doNode = literal({ __do: [letNode, body] });
    expect(inspect(doNode, final)).toMatchObject({ ok: true, value: { detached: true } });
    expect(inspect(doNode, letNode)).toMatchObject({ ok: true, value: { path: ["value", "__do", 0], detached: true } });
    expect(inspect(doNode, body)).toMatchObject({ ok: true, value: { detached: false } });
  });

  test("reattaches only the selected occurrence and preserves frozen siblings, holes and metadata", () => {
    const selected = literal(undefined), sibling = literal(7), replacement = call("length", literal("text"));
    const args = Object.freeze([selected, sibling]);
    const root = Object.freeze({ kind: "call" as const, fnId: "combine", args: args as unknown as ExprNode[], metadata: { keep: true }, hole: undefined });
    const result = replace(root, ["args", 0], replacement);
    expect(result.ok).toBe(true);
    if (result.ok) {
      const next = result.value as typeof root;
      expect(next.args[0]).toBe(replacement);
      expect(next.args[1]).toBe(sibling);
      expect(next.metadata).toBe(root.metadata);
      expect(Object.hasOwn(next, "hole")).toBe(true);
      expect(next.hole).toBeUndefined();
      expect(root.args[0]).toBe(selected);
    }
    expect(replace(root, ["args", 3], replacement)).toMatchObject({ ok: false });
    expect(replace(root, ["metadata"], replacement)).toMatchObject({ ok: false });
  });

  test("source-owned checker wrappers preserve lexical placement and prior descendant checks", () => {
    const selected = param("x");
    const root = lambda(["x"], ann(ann(selected, number), number));
    const initial = inspect(root, selected);
    expect(initial.ok).toBe(true);
    if (!initial.ok) return;
    let checking = root;
    for (const [index, site] of initial.value.annotations.entries()) {
      const current = readAuthoringExpressionPath(checking, site.expressionPath) as ExprNode;
      const wrapped = wrap(checking, site.expressionPath, `<expected-${index}>`);
      expect(wrapped.ok).toBe(true);
      if (!wrapped.ok) return;
      checking = wrapped.value;
      const wrapper = readAuthoringExpressionPath(checking, site.expressionPath) as Extract<ExprNode, { kind: "literal" }>;
      const statements = (wrapper.value as { __do: ExprNode[] }).__do;
      expect((statements[0] as Extract<ExprNode, { kind: "call" }>).args[0]).toBe(current);
      expect(statements[1]).toBe(current);
    }
    const logic = exprNodeToLogic(checking);
    expect(JSON.stringify(logic)).toContain("<expected-0>");
    expect(JSON.stringify(logic)).toContain("<expected-1>");
    expect(exprNodeToLogic(root)).toEqual({ fn: [["x"], { ann: [{ ann: [{ var: "x" }, number] }, number] }] });
    expect(wrap(root, ["value", "__lambda", "params", 0], "<expected>")).toMatchObject({ ok: false });
    expect(wrap(root, [], "")).toMatchObject({ ok: false, diagnostics: [{ code: "binding.check-consumer" }] });
  });

  test("path reads reject inherited properties and accessors without invoking them", () => {
    let reads = 0;
    const root = literal(1);
    Object.defineProperty(root, "trap", { get() { reads += 1; return literal(2); } });
    expect(() => readAuthoringExpressionPath(root, ["trap"])).toThrow("own data property");
    expect(() => readAuthoringExpressionPath(root, ["toString"])).toThrow("own data property");
    expect(() => readAuthoringExpressionPath(root, [-1])).toThrow("component is invalid");
    expect(reads).toBe(0);
  });

  test("checker wrappers preserve lexical references without adding a generalization boundary", () => {
    const selected = param("annotationValue");
    const wrapped = wrap(selected, [], "<expected>");
    expect(wrapped.ok).toBe(true);
    if (!wrapped.ok) return;
    expect(exprNodeToLogic(wrapped.value)).toEqual({ do: [
      { call: ["<expected>", { var: "annotationValue" }] },
      { var: "annotationValue" },
    ] });
    expect(selected).toEqual(param("annotationValue"));
  });

  test("bounds checking work without returning an unchecked replacement", () => {
    let root = literal(1);
    for (let depth = 0; depth < 9; depth += 1) root = call("combine", root, root);
    expect(wrap(root, [], "<expected>")).toMatchObject({ ok: false, diagnostics: [{ code: "binding.check-budget" }] });
  }, 60000);
});

describe("Fenel-owned authoring call edits", () => {
  const call = (fnId: string, ...args: ExprNode[]): Extract<ExprNode, { kind: "call" }> => ({ kind: "call", fnId, args });
  const editCall = (node: ExprNode, edit: AuthoringCallEdit) => withInterpretedCompiledArtifacts(() => editAuthoringCall(node, edit));
  const empty = literal(undefined);

  test("wrapping reattaches the original subtree and retains seeded siblings and call metadata", () => {
    const input = { ...call("words", literal("the quick brown fox")), sourceHead: "words", sourceTargetId: "words-identity", unknown: { retained: true }, hole: undefined };
    const separator = literal(" ");
    const template = { ...call("join", empty, separator), callSyntax: "call" as const, sourceHead: "std.join", sourceTargetId: "join-identity", unknown: { retained: true }, hole: undefined };
    Object.freeze(template.args);
    Object.freeze(template);
    const result = editCall(input, { kind: "wrap", call: template });
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value).toEqual({ ...template, args: [input, separator] });
      const wrapped = result.value as typeof template;
      expect(wrapped.args[0]).toBe(input);
      expect(wrapped.args[1]).toBe(separator);
      expect(wrapped.unknown).toBe(template.unknown);
      expect(Object.hasOwn(wrapped, "hole")).toBe(true);
      expect(wrapped.hole).toBeUndefined();
      expect(Object.getOwnPropertyDescriptor(wrapped, "sourceHead")).toEqual(Object.getOwnPropertyDescriptor(template, "sourceHead"));
      expect(template.args[0]).toBe(empty);
    }
  });

  test("wrapping a selected incoming expression uses the same plan with its original input identity", () => {
    const selected: ExprNode = { kind: "ref", savedExprId: "saved-input" };
    const untouched = literal({ $tag: "Nothing" });
    const result = editCall(selected, { kind: "wrap", call: call("combine", untouched, empty), index: 1 });
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(exprNodeToLogic(result.value, { resolver: () => literal("saved data") })).toEqual({ call: ["combine", { $tag: "Nothing" }, "saved data"] });
      expect((result.value as Extract<ExprNode, { kind: "call" }>).args[0]).toBe(untouched);
      expect((result.value as Extract<ExprNode, { kind: "call" }>).args[1]).toBe(selected);
    }
  });

  test("named constructor wrapping retains its original field names and sibling carriers", () => {
    const input = param("selected");
    const sibling = literal(42);
    const fields = [{ name: "left", value: empty, meta: { retained: true } }, { name: "right", value: sibling }];
    const template = literal({ __construct: { tag: "Pair", fields, metadata: { original: true } } });
    const result = editCall(input, { kind: "wrap", call: template });
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(exprNodeToLogic(result.value)).toEqual({ construct: ["Pair", { left: { var: "selected" }, right: 42 }] });
      const next = (result.value as Extract<ExprNode, { kind: "literal" }>).value as { __construct: { fields: typeof fields; metadata: unknown } };
      expect(next.__construct.fields[0]!.value).toBe(input);
      expect(next.__construct.fields[0]!.meta).toBe(fields[0]!.meta);
      expect(next.__construct.fields[1]).toBe(fields[1]);
      expect(fields[0]!.value).toBe(empty);
    }
  });

  test("deleting an intermediary call retains its selected original input without evaluating it", () => {
    const source = literal("the quick brown fox");
    const words = call("words", source);
    const reverse = { ...call("reverse", words), metadata: { ignored: true } };
    const removedReverse = editCall(reverse, { kind: "remove", empty });
    expect(removedReverse).toEqual({ ok: true, value: words });
    if (removedReverse.ok) {
      expect(removedReverse.value).toBe(words);
      expect(exprNodeToLogic(call("join", removedReverse.value, literal(" ")))).toEqual({ call: ["join", { call: ["words", "the quick brown fox"] }, " "] });
    }
    const removedWords = editCall(words, { kind: "remove", empty });
    expect(removedWords).toEqual({ ok: true, value: source });
    if (removedWords.ok) {
      expect(removedWords.value).toBe(source);
      expect(exprNodeToLogic(call("reverse", removedWords.value))).toEqual({ call: ["reverse", "the quick brown fox"] });
    }
  });

  test("inserting before a call reattaches only the selected input while preserving its parent", () => {
    const words = call("words", literal("the quick brown fox"));
    const separator = literal(" ");
    const parent = { ...call("join", words, separator), sourceHead: "std.join", metadata: { original: true }, hole: undefined };
    const result = editCall(parent, { kind: "wrap", call: call("reverse", empty), targetIndex: 0 });
    expect(result.ok).toBe(true);
    if (result.ok) {
      const next = result.value as typeof parent;
      expect(exprNodeToLogic(next)).toEqual({ call: ["join", { call: ["reverse", { call: ["words", "the quick brown fox"] }] }, " "] });
      expect((next.args[0] as Extract<ExprNode, { kind: "call" }>).args[0]).toBe(words);
      expect(next.args[1]).toBe(separator);
      expect(next.metadata).toBe(parent.metadata);
      expect(next.sourceHead).toBe(parent.sourceHead);
      expect(Object.hasOwn(next, "hole")).toBe(true);
      expect(next.hole).toBeUndefined();
      expect(parent.args[0]).toBe(words);
    }
    expect(editCall(parent, { kind: "wrap", call: call("reverse", empty), targetIndex: 2 })).toMatchObject({ ok: false, diagnostics: [{ code: "call.argument" }] });
  });

  test("multi-input removal defaults to the first input and supports an explicit original input", () => {
    const first = literal(undefined);
    const second: ExprNode = { kind: "param", name: "other" };
    const node = call("combine", first, second);
    const defaulted = editCall(node, { kind: "remove", empty });
    expect(defaulted.ok).toBe(true);
    if (defaulted.ok) {
      expect(defaulted.value).toEqual(literal({ __where: { body: param("input1"), bindings: [{ name: "input1", expr: first }, { name: "input2", expr: second }] } }));
      expect(((defaulted.value as Extract<ExprNode, { kind: "literal" }>).value as { __where: { bindings: { expr: ExprNode }[] } }).__where.bindings[0]!.expr).toBe(first);
    }
    const selected = editCall(node, { kind: "remove", empty, index: 1 });
    expect(selected.ok).toBe(true);
    if (selected.ok) {
      expect(selected.value).toEqual(literal({ __where: { body: param("input2"), bindings: [{ name: "input1", expr: first }, { name: "input2", expr: second }] } }));
      expect(((selected.value as Extract<ExprNode, { kind: "literal" }>).value as { __where: { bindings: { expr: ExprNode }[] } }).__where.bindings[1]!.expr).toBe(second);
    }
    expect(node.args).toEqual([first, second]);
  });

  test("retained inputs use declared names and stay exact original expression carriers", () => {
    const primary = literal({ __where: { body: literal(["the", "quick", "brown", "fox"]), bindings: [{ name: "prefix", expr: literal("!") }], metadata: { original: true } } });
    const separator = literal(" ");
    const result = editCall(call("join", primary, separator), { kind: "remove", empty, names: ["arr", "separator"] });
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value).toEqual(literal({ __where: { body: param("arr"), bindings: [{ name: "arr", expr: primary }, { name: "separator", expr: separator }] } }));
      const where = ((result.value as Extract<ExprNode, { kind: "literal" }>).value as { __where: { body: ExprNode; bindings: { name: string; expr: ExprNode }[] } }).__where;
      expect(where.bindings[0]!.expr).toBe(primary);
      expect(where.bindings[1]!.expr).toBe(separator);
      expect(evaluate(exprNodeToLogic(result.value))).toEqual(["the", "quick", "brown", "fox"]);
    }
  });

  test("fresh input names avoid free references, dotted roots and unused inner binders", () => {
    const first = param("arr");
    const second = param("separator.name");
    const third = lambda(["input3"], literal(1));
    const result = editCall(call("combine", first, second, third), { kind: "remove", empty, names: ["arr", "separator", ""] });
    expect(result.ok).toBe(true);
    if (result.ok) {
      const where = ((result.value as Extract<ExprNode, { kind: "literal" }>).value as { __where: { body: ExprNode; bindings: { name: string; expr: ExprNode }[] } }).__where;
      expect(where.bindings.map(binding => binding.name)).toEqual(["arr2", "separator2", "input32"]);
      expect(where.body).toEqual(param("arr2"));
      expect(where.bindings.map(binding => binding.expr)).toEqual([first, second, third]);
      for (const [index, expression] of [first, second, third].entries()) expect(where.bindings[index]!.expr).toBe(expression);
    }
  });

  test("preserved eager inputs run once in their original order before returning the selected input", () => {
    const order: string[] = [];
    const node = call("combine", call("first"), call("second"), call("third"));
    const result = editCall(node, { kind: "remove", empty, index: 1, names: ["firstValue", "secondValue", "thirdValue"] });
    expect(result.ok).toBe(true);
    if (result.ok) {
      const value = evaluate(exprNodeToLogic(result.value), {}, { natives: {
        first: () => { order.push("first"); return 1; },
        second: () => { order.push("second"); return 2; },
        third: () => { order.push("third"); return 3; },
      } });
      expect(value).toBe(2);
      expect(order).toEqual(["first", "second", "third"]);
    }
  });

  test("structural lazy inputs and canonical aliases refuse instead of evaluating dormant branches", () => {
    const lazy = call("and", literal(false), call("dormant"));
    expect(editCall(lazy, { kind: "remove", empty })).toMatchObject({ ok: false, diagnostics: [{ code: "call.lazy-inputs" }] });
    const alias = call("c45f8d9a-5a23-4dc4-8485-987654321000", literal(false), call("dormant"));
    expect(editCall(alias, { kind: "remove", empty, logic: { and: [false, { call: ["dormant"] }] } })).toMatchObject({ ok: false, diagnostics: [{ code: "call.lazy-inputs" }] });
    expect(lazy.args[0]).toEqual(literal(false));
    expect(alias.args[1]).toEqual(call("dormant"));
    expect(editCall(call("combine", literal(1), literal({ __futureBinder: { body: param("arr") } })), { kind: "remove", empty })).toMatchObject({ ok: false, diagnostics: [{ code: "binding.unsupported" }] });
  });

  test("moving a call up swaps it with the call feeding its first input, keeping every other carrier", () => {
    const source = literal("the quick brown fox");
    const words = call("words", source);
    const reverse = { ...call("reverse", words), metadata: { reverse: true } };
    const separator = literal(" ");
    const join = { ...call("join", reverse, separator), sourceHead: "std.join", hole: undefined };
    const moved = editCall(join, { kind: "swap" });
    expect(moved.ok).toBe(true);
    if (!moved.ok) return;
    expect(exprNodeToLogic(moved.value)).toEqual({ call: ["reverse", { call: ["join", { call: ["words", "the quick brown fox"] }, " "] }] });
    const outer = moved.value as typeof reverse;
    const inner = outer.args[0] as typeof join;
    expect(outer.metadata).toBe(reverse.metadata);
    expect(inner.sourceHead).toBe("std.join");
    expect(Object.hasOwn(inner, "hole")).toBe(true);
    expect(inner.args[0]).toBe(words);
    expect(inner.args[1]).toBe(separator);
    expect(join.args[0]).toBe(reverse);
    expect(reverse.args[0]).toBe(words);
    // Moving the same step back down restores the original expression.
    const back = editCall(moved.value, { kind: "swap" });
    expect(back.ok).toBe(true);
    if (back.ok) {
      expect(exprNodeToLogic(back.value)).toEqual(exprNodeToLogic(join));
      expect((back.value as typeof join).args[0]).toMatchObject({ fnId: "reverse", metadata: reverse.metadata });
      expect((back.value as typeof join).args[1]).toBe(separator);
    }
    // The swap is structural: a step that would no longer type-check still moves.
    const blur = call("blur", literal("image"), literal(2));
    const pixelate = call("pixelate", blur, literal(8));
    const swapped = editCall(pixelate, { kind: "swap" });
    expect(swapped.ok && exprNodeToLogic(swapped.value)).toEqual({ call: ["blur", { call: ["pixelate", "image", 8] }, 2] });
  });

  test("a swap refuses atomically unless both steps are calls with a first input", () => {
    const text = literal("kept");
    const words = call("words", text);
    expect(editCall(words, { kind: "swap" })).toMatchObject({ ok: false, diagnostics: [{ code: "call.swap" }] });
    expect(editCall(text, { kind: "swap" })).toMatchObject({ ok: false, diagnostics: [{ code: "call.target" }] });
    expect(editCall(call("now"), { kind: "swap" })).toMatchObject({ ok: false, diagnostics: [{ code: "call.swap" }] });
    expect(editCall(call("reverse", call("now")), { kind: "swap" })).toMatchObject({ ok: false, diagnostics: [{ code: "call.swap" }] });
    expect(words.args[0]).toBe(text);
  });

  test("a call without inputs becomes the supplied incomplete carrier", () => {
    const result = editCall(call("now"), { kind: "remove", empty });
    expect(result).toEqual({ ok: true, value: empty });
    if (result.ok) {
      expect(result.value).toBe(empty);
      expect(exprNodeToLogic(result.value)).toBeUndefined();
    }
    expect(editCall(call("now"), { kind: "remove", empty: literal("filled") })).toMatchObject({ ok: false, diagnostics: [{ code: "call.empty" }] });
  });

  test("missing, fractional and malformed input slots refuse atomically", () => {
    const input = literal("kept");
    const node = call("words", input);
    for (const index of [-1, 0.5, 1]) {
      expect(editCall(node, { kind: "remove", empty, index })).toMatchObject({ ok: false, diagnostics: [{ code: "call.argument" }] });
      expect(node.args[0]).toBe(input);
    }
    expect(editCall(input, { kind: "remove", empty })).toMatchObject({ ok: false, diagnostics: [{ code: "call.target" }] });
    expect(editCall(input, { kind: "wrap", call: call("without-inputs") })).toMatchObject({ ok: false, diagnostics: [{ code: "call.argument" }] });
    expect(editCall(input, { kind: "wrap", call: { kind: "call", fnId: "broken", args: undefined } as unknown as Extract<ExprNode, { kind: "call" }> })).toMatchObject({ ok: false, diagnostics: [{ code: "call.arguments" }] });
  });
});

describe("source-owned composition candidate arities", () => {
  test("requiring an input omits nullary rows without relying on a solved scheme", () => {
    const constant = { id: "constant", kind: "function", params: [] };
    const constructor = { id: "Nothing", kind: "constructor", params: [] };
    const input = { id: "join", params: [{ name: "arr" }, { name: "separator" }] };
    const rows = [constant, input, constructor];
    const selected = withInterpretedCompiledArtifacts(() => selectAuthoringCallCandidates(rows, true));
    expect(selected).toEqual([input]);
    expect(selected[0]).toBe(input);
    const all = withInterpretedCompiledArtifacts(() => selectAuthoringCallCandidates(rows, false));
    expect(all).toEqual(rows);
    for (const [index, row] of rows.entries()) expect(all[index]).toBe(row);
  });

  test("large catalogues retain exact row order and identities in both picker modes", () => {
    const rows = Object.freeze(Array.from({ length: 16_384 }, (_, index) => Object.freeze({
      id: `candidate-${index}`,
      kind: index % 4 === 0 ? "constructor" : "function",
      params: Object.freeze(Array.from({ length: index % 4 }, (_, parameter) => ({ name: `input${parameter}` }))),
      metadata: Object.freeze({ occurrence: index }),
    })));
    const all = withInterpretedCompiledArtifacts(() => selectAuthoringCallCandidates(rows, false));
    expect(all).toHaveLength(rows.length);
    for (const [index, row] of rows.entries()) expect(all[index]).toBe(row);

    const expected = rows.filter(row => row.params.length > 0);
    const selected = withInterpretedCompiledArtifacts(() => selectAuthoringCallCandidates(rows, true));
    expect(selected).toHaveLength(expected.length);
    for (const [index, row] of expected.entries()) expect(selected[index]).toBe(row);
  });

  test("the retained source helper respects its starting index and empty roster", () => {
    expect(withInterpretedCompiledArtifacts(() => dispatchEngineBody(
      "engine:abeCallCandidateIndices", [[0, 2, 0, 1], true, 7],
    ))).toEqual([8, 10]);
    expect(withInterpretedCompiledArtifacts(() => dispatchEngineBody(
      "engine:abeCallCandidateIndices", [[0, 2, 0, 1], false, 7],
    ))).toEqual([7, 8, 9, 10]);
    expect(withInterpretedCompiledArtifacts(() => selectAuthoringCallCandidates([], true))).toEqual([]);
    expect(withInterpretedCompiledArtifacts(() => selectAuthoringCallCandidates([], false))).toEqual([]);
  });
});

describe("source-owned naming of a linear expression result", () => {
  const call = (fnId: string, ...args: ExprNode[]): Extract<ExprNode, { kind: "call" }> => ({ kind: "call", fnId, args });
  const proposal = (root: ExprNode, path: (string | number)[], name: string, options: Parameters<typeof proposeAuthoringResultBinding>[3] = {}) =>
    withInterpretedCompiledArtifacts(() => proposeAuthoringResultBinding(root, path, name, options));
  const where = (value: ExprNode) => (value as Extract<ExprNode, { kind: "literal" }>).value as { __where: { body: ExprNode; bindings: { name: string; expr: ExprNode }[] } };

  test("names Words once for Reverse and Join while preserving their exact sibling metadata", () => {
    const words = { ...call("words", literal("the quick brown fox")), metadata: { original: true } };
    const reverse = { ...call("reverse", words), hole: undefined, metadata: { original: true } };
    const separator = literal(" ");
    const root = { ...call("join", reverse, separator), sourceHead: "std.join", metadata: { original: true } };
    const result = proposal(root, ["args", 0, "args", 0], "tokens");
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.scopePath).toEqual([]);
      expect(result.value.targetPath).toEqual(["args", 0, "args", 0]);
      expect(result.value.name).toBe("tokens");
      expect(result.value.scope).toBe(root);
      const named = where(result.value.expression).__where;
      expect(named.bindings[0]!.expr).toBe(words);
      expect(exprNodeToLogic(result.value.expression)).toEqual({ where: [{ call: ["join", { call: ["reverse", { var: "tokens" }] }, " "] }, { tokens: { call: ["words", "the quick brown fox"] } }] });
      const continuation = named.body as typeof root;
      expect(continuation.args[1]).toBe(separator);
      expect(continuation.metadata).toBe(root.metadata);
      expect(continuation.sourceHead).toBe(root.sourceHead);
      const nextReverse = continuation.args[0] as typeof reverse;
      expect(nextReverse.metadata).toBe(reverse.metadata);
      expect(Object.hasOwn(nextReverse, "hole")).toBe(true);
      expect(nextReverse.hole).toBeUndefined();
      expect(root.args[0]).toBe(reverse);
      expect(reverse.args[0]).toBe(words);
    }
  });

  test("the exact occurrence path distinguishes two equal inputs and stops at a non-primary input", () => {
    const first = call("words", literal("same"));
    const second = call("words", literal("same"));
    const root = call("combine", first, call("reverse", second));
    const result = proposal(root, ["args", 1, "args", 0], "secondWords");
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.scopePath).toEqual(["args", 1]);
      const next = result.value.expression as typeof root;
      expect(next.args[0]).toBe(first);
      expect(where(next.args[1]!).__where.bindings[0]!.expr).toBe(second);
      expect((where(next.args[1]!).__where.body as typeof root).args[0]).toEqual(param("secondWords"));
    }
  });

  test("markers and lowered lazy aliases stop continuation lifting", () => {
    const words = call("words", literal("same"));
    const body = call("reverse", words);
    const lambdaRoot = lambda(["input"], body);
    const inLambda = proposal(lambdaRoot, ["value", "__lambda", "body", "args", 0], "tokens");
    expect(inLambda.ok).toBe(true);
    if (inLambda.ok) {
      expect(inLambda.value.scopePath).toEqual(["value", "__lambda", "body"]);
      expect(where(((inLambda.value.expression as Extract<ExprNode, { kind: "literal" }>).value as { __lambda: { body: ExprNode } }).__lambda.body).__where.bindings[0]!.expr).toBe(words);
    }
    const lazyAlias = call("lazy-alias", body, call("dormant"));
    const inLazy = proposal(lazyAlias, ["args", 0, "args", 0], "tokens", {
      lower: node => node === lazyAlias ? { and: [{ call: ["reverse", { call: ["words", "same"] }] }, { call: ["dormant"] }] } : exprNodeToLogic(node),
    });
    expect(inLazy.ok).toBe(true);
    if (inLazy.ok) {
      expect(inLazy.value.scopePath).toEqual(["args", 0]);
      expect((inLazy.value.expression as typeof lazyAlias).args[1]).toBe(lazyAlias.args[1]);
    }
  });

  test("naming keeps original eager argument evaluation order and evaluates the named input once", () => {
    const first = call("first");
    const root = call("outer", call("inner", first, call("second")), call("third"));
    const result = proposal(root, ["args", 0, "args", 0], "firstValue");
    expect(result.ok).toBe(true);
    if (result.ok) {
      const order: string[] = [];
      const value = evaluate(exprNodeToLogic(result.value.expression), {}, { natives: {
        first: () => { order.push("first"); return 1; },
        second: () => { order.push("second"); return 2; },
        inner: (...args) => { order.push("inner"); return args; },
        third: () => { order.push("third"); return 3; },
        outer: (...args) => { order.push("outer"); return args; },
      } });
      expect(value).toEqual([[1, 2], 3]);
      expect(order).toEqual(["first", "second", "inner", "third", "outer"]);
    }
  });

  test("invalid names, scope collisions and stale paths refuse without changing the original", () => {
    const selected = call("words", param("source"));
    const root = call("join", selected, param("separator"));
    expect(proposal(root, ["args", 0], "_")).toMatchObject({ ok: false, diagnostics: [{ code: "binding.name" }] });
    expect(proposal(root, ["args", 0], "separator")).toMatchObject({ ok: false, diagnostics: [{ code: "binding.capture" }] });
    expect(proposal(root, ["args", 0], "tokens", { boundNames: ["tokens"] })).toMatchObject({ ok: false, diagnostics: [{ code: "binding.capture" }] });
    expect(proposal(root, ["args", 3], "tokens")).toMatchObject({ ok: false, diagnostics: [{ code: "binding.boundary" }] });
    expect(root.args[0]).toBe(selected);
    expect(selected.args[0]).toEqual(param("source"));
  });
});

describe("pre-codec local binding name validation", () => {
  const where = (bindings: { name: string; expr: ExprNode }[], body: ExprNode = literal(1)) => literal({ __where: { body, bindings } });
  const repeated = () => where([{ name: "x", expr: literal(1) }, { name: "x", expr: literal(2) }], param("x"));
  const issue = (node: ExprNode) => withInterpretedCompiledArtifacts(() => authoringBindingNameIssue(node));

  test("rejects duplicate sibling rows before object serialization loses their original expressions", () => {
    const node = repeated();
    expect(issue(node)).toContain("x is repeated in this scope");
    expect(exprNodeToLogic(node)).toEqual({ where: [{ var: "x" }, { x: 2 }] });
    const rows = ((node as Extract<ExprNode, { kind: "literal" }>).value as { __where: { bindings: { expr: ExprNode }[] } }).__where.bindings;
    expect(rows).toHaveLength(2);
    expect(rows[0]!.expr).toEqual(literal(1));
    expect(rows[1]!.expr).toEqual(literal(2));
    const withInertFlag = literal({ ...((node as Extract<ExprNode, { kind: "literal" }>).value as object), __fenelFn: false });
    expect(issue(withInertFlag)).toContain("x is repeated in this scope");
  });

  test("finds duplicates in calls, initializers and authored structural child slots", () => {
    const duplicate = repeated();
    for (const node of [
      { kind: "call", fnId: "identity", args: [duplicate] } as ExprNode,
      where([{ name: "outer", expr: duplicate }]),
      lambda(["input"], duplicate),
      literal({ __record: { fields: [{ name: "nested", value: duplicate }] } }),
      literal({ __list: [duplicate] }),
      literal({ __do: [duplicate] }),
      literal({ __apply: { target: param("f"), args: [duplicate] } }),
      literal({ __pipe: { value: literal(1), steps: [duplicate] } }),
      literal({ __operator: { op: "custom-operation", args: [duplicate] } }),
      literal({ __withInstance: { frame: literal({ $tag: "Nothing" }), body: duplicate } }),
    ]) expect(issue(node)).toContain("x is repeated in this scope");
  });

  test("permits ordinary lexical shadowing across separate where scopes", () => {
    const nested = where([{ name: "x", expr: literal(2) }], param("x"));
    const node = where([{ name: "x", expr: literal(1) }, { name: "nested", expr: nested }], param("x"));
    expect(issue(node)).toBeUndefined();
    expect(issue(lambda(["x"], node))).toBeUndefined();
  });

  test("rejects invalid binding identifiers while preserving the existing underscore contract", () => {
    for (const name of ["", "where", "bad.name", "2bad", "bad name"]) {
      expect(issue(where([{ name, expr: literal(1) }]))).toBe("Use a nonempty identifier for each local binding.");
    }
    expect(issue(where([{ name: "_", expr: literal(1) }]))).toBeUndefined();
    expect(issue(where([{ name: "_", expr: literal(1) }, { name: "_", expr: literal(2) }]))).toContain("_ is repeated");
  });

  test("does not inspect marker-looking nested data or opaque literal carriers", () => {
    const data = { __where: { body: param("x"), bindings: [{ name: "x", expr: literal(1) }, { name: "x", expr: literal(2) }] } };
    for (const node of [literal({ nested: data }), literal([data]), literal({ $ref: "Data", nested: data }),
      literal({ $tag: "Box", value: data }), literal({ __fenelFn: true, params: [], body: data }),
      literal({ __futureMarker: data }), literal({ __var: { path: ["dynamic", "lookup"], fallback: data } })]) {
      expect(issue(node)).toBeUndefined();
    }
  });
});

describe("source-owned graph edge diagnostic projection", () => {
  const issue = (compatibility: "compatible" | "incompatible" | "unknown", outcome: InferenceOutcome) =>
    withInterpretedCompiledArtifacts(() => projectAuthoringGraphEdgeIssue(compatibility, outcome, "This connection needs a list of strings."));
  const diagnostic = (code: string, path?: string[]) => ({ code, path, message: "This value does not satisfy the required input type.", functionId: "<authoring-expression>" });

  test("retains a known direct compatibility mismatch without inventing a judgment", () => {
    expect(issue("incompatible", { $tag: "Solved" })).toBe("This connection needs a list of strings.");
    expect(issue("compatible", { $tag: "Solved" })).toBeUndefined();
    expect(issue("unknown", { $tag: "AnnotationRequired", diagnostics: [] })).toBeUndefined();
  });

  test("shows an exact-root literal refusal without attributing descendant errors to its outgoing edge", () => {
    expect(issue("unknown", { $tag: "Invalid", diagnostics: [diagnostic("authoring.literal-membership", ["$expression"])] })).toBe("This value does not satisfy the required input type.");
    for (const current of [diagnostic("authoring.literal-membership", ["$expression.args[0]"]),
      diagnostic("inference.nominal-mismatch", ["authoring/expression/arg/p:0"]),
      diagnostic("authoring-boundary-invalid"), diagnostic("authoring.literal-membership", [])]) {
      expect(issue("unknown", { $tag: "Invalid", diagnostics: [current] })).toBeUndefined();
    }
  });
});
const schemeDraft = (params: FieldDef[]) => {
  const returns: FenelType = { $ref: "Thing" };
  const scheme: TypeScheme & { untouched?: undefined } = {
    quantified: [{ id: "declaration:T", sourceName: "T", kind: { $tag: "KType" } }],
    body: { $arrow: { params, returns } },
    applications: params.map((_, index) => ({ path: ["$arrow", "params", String(index), "type"], headRef: `owner:${index}`, args: [], kind: { $tag: "KType" } })),
    nominals: [...params.map((_, index) => ({ path: ["$arrow", "params", String(index), "type"], identity: `nominal:${index}`, publicName: "Thing" })),
      { path: ["$arrow", "returns"], identity: "nominal:result", publicName: "Thing" }],
    diagnostics: params.map((_, index) => ({ path: ["$arrow", "params", String(index), "type"], code: "fixture", declaration: "test", spelling: "Thing", message: "preserved" })),
    untouched: undefined,
  };
  return { params, body: literal(undefined), returns, scheme };
};

describe("Fenel-owned authoring binding edits", () => {
  test("renames dotted references and callable heads, preserving literal data", () => {
    const body = literal({ __list: [param("x.name"), { kind: "ref", savedExprId: "x" },
      { kind: "call", fnId: "x.run", args: [literal("x.name")] }] });
    const result = rename(draft(body));
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.value.body).toEqual(literal({ __list: [param("y.name"), { kind: "ref", savedExprId: "x" }, { kind: "call", fnId: "y.run", args: [literal("x.name")] }] }));
  });

  test("honors inner shadowing and refuses capture in both directions", () => {
    const inner = lambda(["x"], param("x"));
    const shadowed = rename(draft(inner));
    expect(shadowed.ok).toBe(true);
    if (shadowed.ok) expect(shadowed.value.body).toBe(inner);
    expect(rename(draft(lambda(["y"], param("x"))))).toMatchObject({ ok: false, diagnostics: [{ code: "binding.capture" }] });
    expect(rename(draft(literal({ __list: [param("x"), param("y")] })))).toMatchObject({ ok: false });
  });

  test("let initializers see the outer binding and later do statements see the local", () => {
    const source = { do: [{ let: { x: { var: "x" } } }, { var: "x" }] };
    const result = rename(draft(logicToExprNode(source, ["x"])));
    expect(result.ok).toBe(true);
    if (result.ok) expect(exprNodeToLogic(result.value.body)).toEqual({ do: [{ let: { x: { var: "y" } } }, { var: "x" }] });
  });

  test("where bindings shadow only after their initializer", () => {
    const source = { where: [{ var: "x" }, { x: { var: "x" } }] };
    const result = rename(draft(logicToExprNode(source, ["x"])));
    expect(result.ok).toBe(true);
    if (result.ok) expect(exprNodeToLogic(result.value.body)).toEqual({ where: [{ var: "x" }, { x: { var: "y" } }] });
  });

  test("guard-only uses refuse removal and nested named pattern binders shadow", () => {
    const source = { match: [1, { $guard: [{ $tag: "Box", value: { $bind: "z" } }, { var: "x" }] }, { var: "z" }] };
    const value = draft(logicToExprNode(source, ["x", "z"]));
    expect(remove(value)).toMatchObject({ ok: false, diagnostics: [{ code: "binding.used" }] });
    const result = rename(value);
    expect(result.ok).toBe(true);
    if (result.ok) expect(exprNodeToLogic(result.value.body)).toEqual({ match: [1, { $guard: [{ $tag: "Box", value: { $bind: "z" } }, { var: "y" }] }, { var: "z" }] });
    expect(remove(draft(logicToExprNode({ match: [1, { $tag: "Box", value: { $bind: "x" } }, { var: "x" }] }, ["x"])))).toMatchObject({ ok: true });
  });

  test("dependent result and annotation references participate", () => {
    const value: AuthoringBindingDraft = { ...draft(literal(1)), returns: { $el: { var: "x" } } };
    expect(remove(value)).toMatchObject({ ok: false, diagnostics: [{ code: "binding.used" }] });
    const renamed = rename(value);
    expect(renamed.ok).toBe(true);
    if (renamed.ok) expect(renamed.value.returns).toEqual({ $el: { var: "y" } });
    const annotation = draft(literal({ __ann: { expr: literal(1), type: { $el: { var: "x" } } } }));
    expect(remove(annotation)).toMatchObject({ ok: false });
  });

  test("raw dependent let initializers rename in parameter and result types", () => {
    const parameterType = { $el: { let: { saved: { var: "x" } } } };
    const returns = { $el: { let: { result: { var: "x" } } } };
    const value = { params: [{ name: "x" }, { name: "z", type: parameterType }], body: literal(1), returns };
    const before = JSON.stringify(value);
    const renamed = rename(value);
    expect(renamed.ok).toBe(true);
    if (renamed.ok) {
      expect(renamed.value.params[0]!.name).toBe("y");
      expect(renamed.value.params[1]!.type).toEqual({ $el: { let: { saved: { var: "y" } } } });
      expect(renamed.value.returns).toEqual({ $el: { let: { result: { var: "y" } } } });
      expect(renamed.value.body).toBe(value.body);
      const typeValue = { $ref: "String" };
      expect(evaluate(renamed.value.params[1]!.type!.$el, { y: typeValue })).toBe(typeValue);
      expect(evaluate(renamed.value.returns.$el, { y: typeValue })).toBe(evaluate(returns.$el, { x: typeValue }));
    }
    expect(JSON.stringify(value)).toBe(before);
    expect(value.params[1]!.type).toBe(parameterType);
    expect(value.returns).toBe(returns);
  });

  test("raw dependent let removal and capture refuse atomically with binding diagnostics", () => {
    const returns = { $el: { let: { y: 1, saved: { var: "x" } } } };
    const value = { ...draft(literal(1)), returns };
    const before = JSON.stringify(value);
    expect(remove(value)).toMatchObject({ ok: false, diagnostics: [{ code: "binding.used" }] });
    expect(rename(value)).toMatchObject({ ok: false, diagnostics: [{ code: "binding.capture" }] });
    expect(JSON.stringify(value)).toBe(before);
    expect(value.returns).toBe(returns);
    expect(value.params[0]!.name).toBe("x");

    const parameterOnly: AuthoringBindingDraft = {
      ...draft(literal(1)), params: [{ name: "x" }, { name: "z", type: { $el: { let: { saved: { var: "x" } } } } }],
    };
    const parameterBefore = JSON.stringify(parameterOnly);
    expect(remove(parameterOnly)).toMatchObject({ ok: false, diagnostics: [{ code: "binding.used" }] });
    expect(JSON.stringify(parameterOnly)).toBe(parameterBefore);
  });

  test("raw dependent let bindings shadow only after their initializer", () => {
    const returns = { $el: { let: { x: { var: "x" }, saved: { var: "x" } } } };
    const value = { ...draft(literal(1)), returns };
    const renamed = rename(value);
    expect(renamed.ok).toBe(true);
    if (renamed.ok) {
      expect(renamed.value.returns).toEqual({ $el: { let: { x: { var: "y" }, saved: { var: "x" } } } });
      const typeValue = { $ref: "Int" };
      expect(evaluate(renamed.value.returns.$el, { y: typeValue })).toBe(evaluate(returns.$el, { x: typeValue }));
    }
    expect(value.returns).toBe(returns);
    expect(returns.$el.let.x.var).toBe("x");

    const shadowed = { ...draft(literal(1)), returns: { $el: { let: { x: { $ref: "Int" }, saved: { var: "x" } } } } };
    const localRename = rename(shadowed);
    expect(localRename.ok).toBe(true);
    if (localRename.ok) expect(localRename.value.returns).toBe(shadowed.returns);
    const removed = remove(shadowed);
    expect(removed.ok).toBe(true);
    if (removed.ok) expect(removed.value).toBe(shadowed);
  });

  test("preserves complete parameter identity, vector lambda encoding and undefined holes", () => {
    const key = { $tag: "NamedField", field: "field-identity" };
    const hole = literal(undefined);
    const value = { params: [{ name: "x", key, meta: { original: true } }], body: lambda(["z"], literal({ __list: [param("x"), hole] })) };
    const result = rename(value);
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.params[0]!.key).toBe(key);
      expect(result.value.params[0]!.meta).toBe(value.params[0]!.meta);
      expect(exprNodeToLogic(result.value.body)).toEqual({ fn: [["z"], [{ var: "y" }, undefined]] });
      expect(result.value.body).not.toBe(value.body);
      expect(value.params[0]!.name).toBe("x");
    }
  });

  test("add checks existing free names; remove and add validate without changing rows", () => {
    const value = draft(param("outside"));
    expect(withInterpretedCompiledArtifacts(() => editAuthoringBinding(value, { kind: "add", name: "outside" }))).toMatchObject({ ok: false });
    const added = withInterpretedCompiledArtifacts(() => editAuthoringBinding(value, { kind: "add", name: "fresh" }));
    expect(added.ok).toBe(true);
    if (added.ok) expect(added.value).toBe(value);
    const removed = remove(value);
    expect(removed.ok).toBe(true);
    if (removed.ok) expect(removed.value).toBe(value);
  });

  test("refuses unsupported forms atomically and leaves original values untouched", () => {
    const body = literal({ __list: [param("x"), literal({ __futureBinder: { body: param("x") } })] });
    const value = draft(body);
    expect(rename(value)).toMatchObject({ ok: false });
    expect(value.body).toBe(body);
    expect(value.params[0]!.name).toBe("x");
  });

  test("variable defaults are raw data and are never renamed", () => {
    const body = literal({ __var: { path: "x.name", fallback: { var: "x" }, arrayForm: true, extra: [undefined] } });
    const result = rename(draft(body));
    expect(result.ok).toBe(true);
    if (result.ok) expect(exprNodeToLogic(result.value.body)).toEqual({ var: ["y.name", { var: "x" }, undefined] });
  });

  test("whole rows follow named identity through movement and simultaneous rename", () => {
    const x = { name: "x", key: { $tag: "NamedField", ref: { $ref: "x-field" } } };
    const y = { name: "y", key: { $tag: "NamedField", ref: { $ref: "y-field" } } };
    const value = { params: [x, y], body: literal({ __list: [param("x"), param("y")] }) };
    const next = [{ ...y, name: "x" }, { ...x, name: "y" }];
    const result = withInterpretedCompiledArtifacts(() => reconcileAuthoringBindingRows(value, next));
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.params).toBe(next);
      expect(exprNodeToLogic(result.value.body)).toEqual([{ var: "y" }, { var: "x" }]);
    }
  });

  test("whole rows refuse replacing a used identity even with the same name", () => {
    const value = { params: [{ name: "x", key: { $tag: "NamedField", ref: { $ref: "before" } } }], body: param("x") };
    const next = [{ name: "x", key: { $tag: "NamedField", ref: { $ref: "after" } } }];
    const result = withInterpretedCompiledArtifacts(() => reconcileAuthoringBindingRows(value, next));
    expect(result).toMatchObject({ ok: false, diagnostics: [{ code: "binding.used" }] });
    expect(value.params[0]!.key.ref.$ref).toBe("before");
  });

  test("row type edits and pure identity-preserving reorder leave body references unchanged", () => {
    const x = { name: "x", key: { $tag: "NamedField", ref: { $ref: "x-field" } }, type: { $ref: "String" } };
    const y = { name: "y", key: { $tag: "NamedField", ref: { $ref: "y-field" } }, type: { $ref: "String" } };
    const value = { params: [x, y], body: literal({ __futureBinder: undefined }) };
    const next = [y, { ...x, type: { $ref: "Number" } }];
    const result = withInterpretedCompiledArtifacts(() => reconcileAuthoringBindingRows(value, next));
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.body).toBe(value.body);
      expect(result.value.params).toBe(next);
    }
  });

  test("dependent parameter types and canonical set predicates are included", () => {
    const value: AuthoringBindingDraft = { params: [{ name: "x" }, { name: "z", type: { $el: { var: "x" } } }], body: literal(1),
      returns: { $refined: { base: { $ref: "String" }, set: { $tag: "SeWhere", pred: { var: "value" } } } } };
    expect(remove(value)).toMatchObject({ ok: false });
    const result = rename(value);
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.params[1]!.type).toEqual({ $el: { var: "y" } });
      expect(result.value.returns).toBe(value.returns);
    }
  });

  test("raw embedded executable values do not hide uses or silently change", () => {
    expect(remove(draft(literal([{ var: "x" }])))).toMatchObject({ ok: false });
    expect(rename(draft(literal({ unknownBindingForm: { var: "x" } })))).toMatchObject({ ok: false });
    expect(rename(draft(literal(1)), "where")).toMatchObject({ ok: false, diagnostics: [{ code: "binding.name" }] });
    expect(rename(draft(param("x")), "_")).toMatchObject({ ok: false, diagnostics: [{ code: "binding.unnamed-used" }] });
    expect(rename(draft(literal(1)), "_")).toMatchObject({ ok: true });
  });

  test("whole-row rename preserves dependent next parameter types and refuses ambiguous combined edits", () => {
    const x = { name: "x", key: { $tag: "NamedField", ref: { $ref: "x-field" } }, type: { $ref: "String" } };
    const z = { name: "z", key: { $tag: "NamedField", ref: { $ref: "z-field" } }, type: { $el: { var: "x" } } };
    const value = { params: [x, z], body: param("x") };
    const next = [{ ...x, name: "y" }, z];
    const result = withInterpretedCompiledArtifacts(() => reconcileAuthoringBindingRows(value, next));
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.value.params[1]!.type).toEqual({ $el: { var: "y" } });
    const ambiguous = [{ ...x, name: "y", type: { $ref: "Number" } }, z];
    expect(withInterpretedCompiledArtifacts(() => reconcileAuthoringBindingRows(value, ambiguous))).toMatchObject({ ok: false, diagnostics: [{ code: "binding.combined-type-edit" }] });
  });

  test("scheme evidence follows field identity across moves with identical nominal display names", () => {
    const value = schemeDraft([schemeField("a", "a-field"), schemeField("b", "b-field")]);
    const next = [value.params[1]!, value.params[0]!];
    const result = withInterpretedCompiledArtifacts(() => reconcileAuthoringBindingRows(value, next));
    expect(result.ok).toBe(true);
    if (result.ok) {
      const scheme = result.value.scheme;
      expect(scheme.quantified).toBe(value.scheme.quantified);
      expect(scheme.applications?.map((row) => row.path[2])).toEqual(["1", "0"]);
      expect(scheme.nominals?.map((row) => [row.path[2], row.identity])).toEqual([["1", "nominal:0"], ["0", "nominal:1"], [undefined, "nominal:result"]]);
      expect(scheme.diagnostics?.map((row) => row.path[2])).toEqual(["1", "0"]);
      expect(scheme.nominals?.[2]).toBe(value.scheme.nominals?.[2]);
      expect(scheme.applications?.[0]?.args).toBe(value.scheme.applications?.[0]?.args);
      expect(scheme.applications?.[0]?.kind).toBe(value.scheme.applications?.[0]?.kind);
      expect("untouched" in scheme).toBe(true);
      expect(scheme.untouched).toBeUndefined();
      expect(result.value.body).toBe(value.body);
      if ("$arrow" in scheme.body) expect(scheme.body.$arrow.params).toBe(next);
    }
  });

  test("removal drops only that parameter's evidence and retains result evidence", () => {
    const value = schemeDraft([schemeField("a", "a-field"), schemeField("b", "b-field")]);
    const result = withInterpretedCompiledArtifacts(() => reconcileAuthoringBindingRows(value, [value.params[1]!]));
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.scheme.applications?.map((row) => [row.path[2], row.headRef])).toEqual([["0", "owner:1"]]);
      expect(result.value.scheme.nominals?.map((row) => row.identity)).toEqual(["nominal:1", "nominal:result"]);
      expect(result.value.scheme.diagnostics).toHaveLength(1);
      expect(value.scheme.nominals).toHaveLength(3);
    }
  });

  test("add retains old evidence and refuses stale semantic evidence after a type edit", () => {
    const value = schemeDraft([schemeField("a", "a-field")]);
    const added = withInterpretedCompiledArtifacts(() => reconcileAuthoringBindingRows(value, [...value.params, schemeField("b", "b-field")]));
    expect(added.ok).toBe(true);
    if (added.ok) expect(added.value.scheme.applications).toBe(value.scheme.applications);
    const changed = [{ ...value.params[0]!, type: { $ref: "Other" } }];
    expect(withInterpretedCompiledArtifacts(() => reconcileAuthoringBindingRows(value, changed))).toMatchObject({ ok: false, diagnostics: expect.arrayContaining([expect.objectContaining({ code: "binding.scheme-refresh" })]) });
  });

  test("scheme result dependencies are renamed and curried mismatches refuse without flattening", () => {
    const field = schemeField("x", "x-field");
    const returns: FenelType = { $el: { var: "x" } };
    const value = { params: [field], body: literal(1), returns,
      scheme: { quantified: [], body: { $arrow: { params: [field], returns } } } as TypeScheme };
    const result = rename(value);
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.returns).toEqual({ $el: { var: "y" } });
      if ("$arrow" in result.value.scheme.body) {
        expect(result.value.scheme.body.$arrow.params[0]!.name).toBe("y");
        expect(result.value.scheme.body.$arrow.returns).toBe(result.value.returns);
      }
    }
    const second = schemeField("z", "z-field");
    const curried = { ...value, params: [field, second], scheme: { quantified: [], body: { $arrow: { params: [field], returns: { $arrow: { params: [second], returns } } } } } as TypeScheme };
    expect(withInterpretedCompiledArtifacts(() => reconcileAuthoringBindingRows(curried, [second, field]))).toMatchObject({ ok: false, diagnostics: [{ code: "binding.scheme-shape" }] });
  });

  test("single-binding edits preserve unchanged-position evidence on keyless inline contracts", () => {
    const value = schemeDraft([{ ...schemeField("x", "unused"), key: undefined }]);
    const result = rename(value);
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.scheme.applications).toBe(value.scheme.applications);
      expect(result.value.scheme.nominals).toBe(value.scheme.nominals);
      expect(result.value.scheme.diagnostics).toBe(value.scheme.diagnostics);
    }
  });

  test("saved data identities never rename or capture when their spelling collides", () => {
    const saved: ExprNode = { kind: "ref", savedExprId: "x" };
    const value = draft(saved);
    const renamed = rename(value);
    expect(renamed.ok).toBe(true);
    if (renamed.ok) expect(renamed.value.body).toBe(saved);
    expect(remove(value)).toMatchObject({ ok: true });
    const collision = draft({ kind: "ref", savedExprId: "y" });
    expect(rename(collision)).toMatchObject({ ok: true });
    expect(withInterpretedCompiledArtifacts(() => editAuthoringBinding(collision, { kind: "add", name: "y" }))).toMatchObject({ ok: true });
  });

  test("refinement candidate value and dotted projections are local, in canonical and legacy sets", () => {
    for (const set of [{ $tag: "SeWhere", pred: { call: ["eq", { var: "value" }, { var: "value.name" }] } },
      { $where: { call: ["eq", { var: "value" }, { var: "value.name" }] } }]) {
      const returns = { $refined: { base: { $ref: "String" }, set } } as FenelType;
      const value: AuthoringBindingDraft = { params: [{ name: "value" }], body: literal(undefined), returns };
      const renamed = rename(value);
      expect(renamed.ok).toBe(true);
      if (renamed.ok) expect(renamed.value.returns).toBe(returns);
      expect(remove(value)).toMatchObject({ ok: true });
    }
  });

  test("candidate record fields cannot be mistaken for an outer parameter", () => {
    const returns: FenelType = { $refined: { base: { $record: { fields: [schemeField("x", "candidate-x")] } },
      set: { $tag: "SeWhere", pred: { var: "x.name" } } } };
    const value = { ...draft(literal(1)), returns };
    expect(rename(value)).toMatchObject({ ok: false, diagnostics: [{ code: "binding.predicate-scope" }] });
    expect(remove(value)).toMatchObject({ ok: false, diagnostics: [{ code: "binding.predicate-scope" }] });
    expect(value.returns).toBe(returns);
    expect(value.params[0]!.name).toBe("x");
    const shadowed: AuthoringBindingDraft = { ...value, returns: { $refined: { base: { $ref: "String" },
      set: { $tag: "SeWhere", pred: { fn: ["x", { var: "x" }] } } } } };
    expect(remove(shadowed)).toMatchObject({ ok: true });
  });

  test("shared type-root collection follows annotation slots without treating term binders as type scope", () => {
    const body = lambda(["T"], literal({ __do: [literal({ __let: { bindings: [{ name: "x", type: { $var: "T" }, expr: literal(undefined) }] } }),
      literal({ __ann: { expr: param("T"), type: { $var: "T" } } })] }));
    const result = withInterpretedCompiledArtifacts(() => dispatchEngineBody("engine:authoringBindingTypeRoots", [marshalStoredBodyForValidation(body), ["body"]]));
    expect(result).toEqual({ roots: [
      { path: ["body", "value", "__lambda", "body", "value", "__do", 0, "value", "__let", "bindings", 0, "type"], scope: [] },
      { path: ["body", "value", "__lambda", "body", "value", "__do", 1, "value", "__ann", "type"], scope: [] },
    ], diagnostics: [] });
  });
});
