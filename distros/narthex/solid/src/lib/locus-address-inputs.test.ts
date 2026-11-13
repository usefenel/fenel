import { describe, expect, test } from "bun:test";
import { loadFenelModule } from "../../../../../implementations/typescript/engine/src/fenel-module";
import { parse as parseFenel } from "@fenel/engine/fenel-parser";
import { createAuthoringEnvironment, type AuthoringCatalogFunctionEntry } from "@fenel/engine/authoring/environment";
import type { ExprNode } from "@fenel/engine/authoring/expression";
import { encodeCheckpointValue } from "@fenel/engine/checkpoint-json";
import { dispatchedDataExpressionValue, __getHarnessForTests, print as printFenel } from "@fenel/engine/engine-bodies-dispatch";
import { evaluate } from "@fenel/engine/expressions";
import { parseInput } from "@fenel/engine/input-layer";
import type { ModuleRegistry } from "@fenel/engine/registry";
import { List, Nothing } from "@fenel/engine/type-foundation";
import type { FenelFunction, FenelType, FieldDef } from "@fenel/engine/types";
import type { AuthoringSession } from "./expression-runner/account-authoring-session";
import { emptyExpressionSlot, expressionForLiteralValue } from "./expression-runner/creation-seed";
import { authoringExpressionLogic, authoringExpressionSites } from "./expression-runner/expression-evaluation";
import { authoringLogicToExprNode } from "./expression-runner/expression-text";
import { inlineWidgetFor } from "./expression-runner/inline-widgets";
import { itemFromText, transferPlainText } from "./data-transfer/data";
import { expressionForTransfer } from "./data-transfer/expressions";
import type { LocusAddressInput } from "./locus-address-inputs";
import { printFenel as enginePrintFenel } from "@fenel/engine";
import { runReaderExtension } from "./expression-runner/authoring-worker-reader-extensions";
import STD_STRING_NATIVE_SOURCE from "../../../../../fenel/modules/std/native/string-native.fenel?raw";
import { stdNatives } from "../../../../../fenel/modules/std/ffi/std-ffi";

// Match detached-session-startup's harness: extract the actual DOM-free
// declarations instead of importing the editor's TSX barrel into Bun tests.
// The production bodies and every parser/codec/transfer dependency remain real.
const editorSource = await Bun.file(new URL("./expression-runner/index.tsx", import.meta.url)).text();
const toLogicStart = editorSource.indexOf("export function toLogic(");
const toLogicEnd = editorSource.indexOf("/** One marshal/evaluate boundary", toLogicStart);
const fromLogicStart = editorSource.indexOf("export function logicToExprNode(");
const fromLogicEnd = editorSource.indexOf("/** Walk the AST", fromLogicStart);
if (toLogicStart < 0 || toLogicEnd < 0 || fromLogicStart < 0 || fromLogicEnd < 0) {
  throw new Error("Expression codec adapter declarations changed");
}
const codecCode = new Bun.Transpiler({ loader: "ts" }).transformSync(
  `${editorSource.slice(toLogicStart, toLogicEnd)}\n${editorSource.slice(fromLogicStart, fromLogicEnd)}`,
).replace(/^export /gm, "");
const { toLogic, logicToExprNode } = new Function("authoringExpressionLogic", "authoringLogicToExprNode",
  `${codecCode}\nreturn { toLogic, logicToExprNode };`)(authoringExpressionLogic, authoringLogicToExprNode) as {
    toLogic(node: ExprNode, resolver: undefined, session: AuthoringSession): unknown;
    logicToExprNode(node: unknown, paramNames: string[], session: AuthoringSession): ExprNode;
  };
const inputsSource = await Bun.file(new URL("./locus-address-inputs.ts", import.meta.url)).text();
const decodeStart = inputsSource.indexOf("export function decodeLocusAddressInputs(");
const encodeStart = inputsSource.indexOf("export function encodeLocusAddressInputs(", decodeStart);
if (decodeStart < 0 || encodeStart < 0) throw new Error("Address input declarations changed");
const inputsCode = new Bun.Transpiler({ loader: "ts" }).transformSync(inputsSource.slice(decodeStart))
  .replace(/^export /gm, "");
const inputDependencies = {
  parseFenel, dispatchedDataExpressionValue, emptyExpressionSlot, expressionForLiteralValue,
  inlineWidgetFor, logicToExprNode, toLogic, parseInput, itemFromText, transferPlainText,
  encodeCheckpointValue, expressionForTransfer, authoringExpressionSites,
};
const { decodeLocusAddressInputs, encodeLocusAddressInputs } = new Function(...Object.keys(inputDependencies),
  `${inputsCode}\nreturn { decodeLocusAddressInputs, encodeLocusAddressInputs };`)(...Object.values(inputDependencies)) as
  Pick<typeof import("./locus-address-inputs"), "decodeLocusAddressInputs" | "encodeLocusAddressInputs">;

// C1: captured catalogue and constructor metadata follow the existing
// creation-seed fixture. The actual parser, current-reader ExprNode codec,
// data-expression projection and literal editor owner perform every decision.
// GLOBAL_ONLY: these fixture readers have no account, host authority or worker.
const textType: FenelType = { $ref: "String" };
const numberType: FenelType = { $ref: "Number" };
const booleanType: FenelType = { $ref: "Boolean" };
const field = (name: string, type: FenelType): FieldDef => ({ name, type, label: Nothing, ui: Nothing, meta: {} });
const boxFields: FieldDef[] = [{ ...field("_0", numberType), key: { $tag: "PositionalField", index: 0 } }];
const boxType: FenelType = { $variant: { cases: [{ name: "ProbeBox", label: Nothing, fields: boxFields }] } };
const boxReference: FenelType = { $ref: "ProbeBox" };
const readerA = "0fb3e512-464b-4fa9-9711-af43e5c2c1bd";
const readerB = "66b6542e-9f84-4c83-a01f-d8d1b32c86b0";
const stringNativeModule = loadFenelModule(STD_STRING_NATIVE_SOURCE, "std");
const fromEntriesFunction = stringNativeModule.functions?.find(fn => fn.id === "std:fromEntries");
const fromEntriesScheme = stringNativeModule.functionSignatureDeclarations
  ?.find(declaration => declaration.functionId === "std:fromEntries")?.scheme;
// A prepared reader includes the codec's internal constructor rows. Only
// these inert tables enter the fixture, never harness natives or authority.
const codecConstructorContext = __getHarnessForTests().ctx;

function constructor(targetId: string, parentModule: string): AuthoringCatalogFunctionEntry {
  return { id: "ProbeBox", targetId, codeName: "ProbeBox", label: "Probe box", description: "", kind: "constructor",
    parentEntity: "ProbeBox", parentModule, params: boxFields, returns: boxReference,
    scheme: { quantified: [], body: { $arrow: { params: boxFields, returns: boxReference } } },
    signatureOutcome: { $tag: "Solved" } };
}

function fixture(target = readerA, ambiguous = false, constructorMetadata = true) {
  let nativeCalls = 0;
  let callerLookups = 0;
  if (!fromEntriesFunction || !fromEntriesScheme) throw new Error("The standard record constructor declaration must be available to the transfer fixture.");
  const callables: FenelFunction[] = [
    { id: "std:add", params: [field("left", numberType), field("right", numberType)], returns: numberType },
    { id: "probe:touch", params: [field("value", numberType)], returns: numberType },
    fromEntriesFunction,
  ];
  const functions: AuthoringCatalogFunctionEntry[] = callables.map((fn, index) => ({
    id: fn.id, targetId: fn.id, codeName: ["add", "touch", "fromEntries"][index], label: ["Add", "Touch", "From entries"][index]!,
    description: "", kind: "function", params: fn.params, returns: fn.returns,
    scheme: fn.id === "std:fromEntries" ? fromEntriesScheme
      : { quantified: [], body: { $arrow: { params: fn.params, returns: fn.returns } } },
    signatureOutcome: { $tag: "Solved" },
  }));
  const constructors = constructorMetadata ? [constructor(target, target === readerA ? "ReaderA" : "ReaderB"),
    ...(ambiguous ? [constructor(readerB, "ReaderB")] : [])] : [];
  const environment = createAuthoringEnvironment({
    types: [{ id: "probe-box", entityId: "ProbeBox", name: "ProbeBox", description: "", category: "type", type: boxType }],
    functions: [...functions, ...constructors], capabilities: [], catalogTypes: [boxType],
    operatorCodeNameByNotation: new Map(),
  });
  const captured: AuthoringSession["evaluateContext"] = {
    getFunction: id => { callerLookups++; return callables.find(fn => fn.id === id); },
    natives: Object.assign(Object.create(null), {
      "std:add": () => { nativeCalls++; return 3; },
      "probe:touch": () => { nativeCalls++; return 7; },
      add: () => { nativeCalls++; return 3; },
      touch: () => { nativeCalls++; return 7; },
      "std:fromEntries": stdNatives.fromEntries,
      "std.fromEntries": stdNatives.fromEntries,
      fromEntries: stdNatives.fromEntries,
    }),
    _constructors: { ...codecConstructorContext._constructors, ...Object.fromEntries(constructors.map(entry => [entry.targetId!, ["_0"]])) },
    _constructorWireNames: { ...codecConstructorContext._constructorWireNames, ...Object.fromEntries(constructors.map(entry => [entry.targetId!, "ProbeBox"])) },
    _ctorFieldKeys: { ...codecConstructorContext._ctorFieldKeys, ...Object.fromEntries(constructors.map(entry => [entry.targetId!, [{
      key: { $tag: "PositionalField", index: 0 }, wire: "_0",
    }]])) },
  };
  const registry = {
    getFunction: (id: string) => callables.find(fn => fn.id === id),
    getIdentifiedEntity: () => undefined,
    getEntityNominalIdentity: () => undefined,
  } as unknown as ModuleRegistry;
  const session: AuthoringSession = { mode: "detached", registry, catalog: environment.catalog, environment, evaluateContext: captured };
  return { session, nativeCalls: () => nativeCalls, callerLookups: () => callerLookups };
}

function data(node: ExprNode, session: AuthoringSession): unknown {
  const projected = dispatchedDataExpressionValue(toLogic(node, undefined, session), session.evaluateContext);
  expect(projected.$tag).toBe("Concrete");
  if (projected.$tag !== "Concrete") throw new Error("The accepted input must retain closed data.");
  return projected.value;
}

function share(args: readonly ExprNode[], params: readonly FieldDef[], session: AuthoringSession) {
  return encodeLocusAddressInputs(args, params, session, node => toLogic(node, undefined, session), wire => printFenel(wire));
}

// The transfer planner constructs sensitive records with the existing standard
// data function. This exercises its real codec/evaluator path, without making
// the stricter closed-data projection accept an ordinary named function call.
function transferredData(node: ExprNode, session: AuthoringSession): unknown {
  return evaluate(toLogic(node, undefined, session), {}, session.evaluateContext);
}

describe("address inputs use the existing typed Call data boundary", () => {
  test("String inputs preserve raw quotes, empty text, whitespace and expression-looking text", () => {
    const f = fixture();
    const params = [field("s", textType)];
    for (const value of ["", '"quoted"', "  Fenel\n", "std.add 1 2", "touch 1", "100% + a/b", "e\u0301"]) {
      const decoded = decodeLocusAddressInputs([{ name: "s", text: value }], params, f.session);
      expect(decoded.issues).toEqual([]);
      expect(decoded.args).toEqual([{ kind: "literal", value }]);
      expect(share(decoded.args, params, f.session)).toEqual({ inputs: [{ name: "s", text: value }], omittedExpressions: false });
    }
    expect(f.nativeCalls()).toBe(0);
    expect(f.callerLookups()).toBe(0);
  });

  test("Number, Boolean, list and multi-field record literals remain ordinary data", () => {
    const f = fixture();
    const record: FenelType = { $record: { fields: [field("count", numberType), field("note", textType)] } };
    const cases: Array<{ type: FenelType; text: string; expected: unknown }> = [
      { type: numberType, text: "42", expected: 42 },
      { type: numberType, text: "-2.5", expected: -2.5 },
      { type: numberType, text: "-0", expected: -0 },
      { type: numberType, text: "+1e2", expected: 100 },
      { type: numberType, text: "-1e-2", expected: -0.01 },
      { type: booleanType, text: "true", expected: true },
      { type: booleanType, text: "false", expected: false },
      { type: List(numberType), text: "[1, 2, 3]", expected: [1, 2, 3] },
      { type: List(numberType), text: "[1, -2, -2.5, -1e2]", expected: [1, -2, -2.5, -100] },
      { type: List(numberType), text: "[]", expected: [] },
      { type: record, text: '{ count = 3, note = "Fenel" }', expected: { count: 3, note: "Fenel" } },
      { type: record, text: '{"count":-2.5,"note":"Fenel"}', expected: { count: -2.5, note: "Fenel" } },
    ];
    for (const candidate of cases) {
      const params = [field("value", candidate.type)];
      const decoded = decodeLocusAddressInputs([{ name: "value", text: candidate.text }], params, f.session);
      expect(decoded.issues).toEqual([]);
      const first = data(decoded.args[0]!, f.session);
      expect(first).toEqual(candidate.expected);
      if (typeof candidate.expected === "number") expect(Object.is(first, candidate.expected)).toBe(true);
      const encoded = share(decoded.args, params, f.session);
      expect(encoded.omittedExpressions).toBe(false);
      const again = decodeLocusAddressInputs(encoded.inputs, params, f.session);
      expect(again.issues).toEqual([]);
      const restored = data(again.args[0]!, f.session);
      expect(restored).toEqual(candidate.expected);
      if (typeof candidate.expected === "number") expect(Object.is(restored, candidate.expected)).toBe(true);
    }
    expect(f.nativeCalls()).toBe(0);
    expect(f.callerLookups()).toBe(0);
  });

  test("JSON nested signed numbers share and refresh through the existing data transfer owner", () => {
    const f = fixture();
    const childType: FenelType = { $record: { fields: [field("x", numberType), field("label", textType)] } };
    const nestedType: FenelType = { $record: { fields: [field("point", childType), field("values", List(numberType))] } };
    const params = [field("data", nestedType)];
    const value = { point: { x: -2.5, label: "negative" }, values: [1, -2, -100] };
    const decoded = decodeLocusAddressInputs([{ name: "data", text: JSON.stringify(value) }], params, f.session);
    expect(decoded.issues).toEqual([]);
    expect(data(decoded.args[0]!, f.session)).toEqual(value);
    const encoded = share(decoded.args, params, f.session);
    expect(encoded.omittedExpressions).toBe(false);
    expect(encoded.inputs).toHaveLength(1);
    const query = new URLSearchParams(encoded.inputs.map(input => [input.name, input.text]));
    const restored = [...new URLSearchParams(query.toString())].map(([name, text]) => ({ name, text }));
    const again = decodeLocusAddressInputs(restored, params, f.session);
    expect(again.issues).toEqual([]);
    expect(data(again.args[0]!, f.session)).toEqual(value);
    expect(f.nativeCalls()).toBe(0);
    expect(f.callerLookups()).toBe(0);
  });

  test("composite signed-zero representations omit sharing when the existing printer cannot preserve them", () => {
    const f = fixture();
    const rows: Array<{ type: FenelType; value: unknown }> = [
      { type: List(numberType), value: [-0, 1] },
      { type: { $record: { fields: [field("number", numberType), field("other", numberType)] } }, value: { number: -0, other: 1 } },
    ];
    for (const row of rows) {
      const argument = expressionForLiteralValue(row.value, row.type, f.session.environment);
      expect(data(argument, f.session)).toEqual(row.value);
      expect(share([argument], [field("value", row.type)], f.session)).toEqual({ inputs: [], omittedExpressions: true });
    }
    expect(share([{ kind: "literal", value: -0 }], [field("value", numberType)], f.session))
      .toEqual({ inputs: [{ name: "value", text: "-0" }], omittedExpressions: false });
    expect(f.nativeCalls()).toBe(0);
    expect(f.callerLookups()).toBe(0);
  });

  test("a single-field JSON record is data while Fenel unary-call record text remains refused", () => {
    const f = fixture();
    const oneField: FenelType = { $record: { fields: [field("x", numberType)] } };
    const params = [field("data", oneField)];
    const decoded = decodeLocusAddressInputs([{ name: "data", text: '{"x":-2}' }], params, f.session);
    expect(decoded.issues).toEqual([]);
    expect(f.nativeCalls()).toBe(0);
    expect(f.callerLookups()).toBe(0);
    expect(transferredData(decoded.args[0]!, f.session)).toEqual({ x: -2 });
    const refused = decodeLocusAddressInputs([{ name: "data", text: "{ x = -2 }" }], params, f.session);
    expect(refused.issues.length).toBeGreaterThan(0);
    expect(refused.args).toEqual([{ kind: "literal", value: undefined }]);
    expect(f.nativeCalls()).toBe(0);
  });

  test("single-key JSON call and variable envelopes remain data through the actual transfer codec", () => {
    const f = fixture();
    const cases: Array<{ type: FenelType; value: unknown }> = [
      { type: { $record: { fields: [field("call", List({ $union: [textType, numberType] }))] } }, value: { call: ["touch", 1] } },
      { type: { $record: { fields: [field("touch", List(numberType))] } }, value: { touch: [1] } },
      { type: { $record: { fields: [field("var", textType)] } }, value: { var: "privateData" } },
    ];
    for (const candidate of cases) {
      const previousLookups = f.callerLookups();
      const decoded = decodeLocusAddressInputs([{ name: "data", text: JSON.stringify(candidate.value) }],
        [field("data", candidate.type)], f.session);
      expect(decoded.issues).toEqual([]);
      expect(f.nativeCalls()).toBe(0);
      expect(f.callerLookups()).toBe(previousLookups);
      expect(transferredData(decoded.args[0]!, f.session)).toEqual(candidate.value);
    }
    expect(f.nativeCalls()).toBe(0);
  });

  test("a JSON __record marker retains nested expression-shaped payloads without executing them", () => {
    const f = fixture();
    const literalNode: FenelType = { $record: { fields: [field("kind", textType), field("value", numberType)] } };
    const callNode: FenelType = { $record: { fields: [field("kind", textType), field("fnId", textType), field("args", List(literalNode))] } };
    const marker: FenelType = { $record: { fields: [field("fields", List({ $record: {
      fields: [field("name", textType), field("value", callNode)],
    } }))] } };
    const type: FenelType = { $record: { fields: [field("__record", marker)] } };
    const value = { __record: { fields: [{ name: "payload", value: {
      kind: "call", fnId: "probe:touch", args: [{ kind: "literal", value: 1 }],
    } }] } };
    const decoded = decodeLocusAddressInputs([{ name: "data", text: JSON.stringify(value) }], [field("data", type)], f.session);
    expect(decoded.issues).toEqual([]);
    expect(f.nativeCalls()).toBe(0);
    expect(f.callerLookups()).toBe(0);
    const restored = transferredData(decoded.args[0]!, f.session);
    expect(restored).toEqual(value);
    expect(Object.hasOwn(restored as object, "__record")).toBe(true);
    expect(f.nativeCalls()).toBe(0);
  });

  test("function calls and nested effect calls refuse without invoking caller natives", () => {
    const f = fixture();
    for (const value of ["std.add 1 2", "add 1 2", "touch 1", "probe.touch 1", "unknown 1",
      '[1, touch 2]', '{ count = touch 1, note = "value" }', "if true then 1 else touch 2"]) {
      const decoded = decodeLocusAddressInputs([{ name: "value", text: value }], [field("value", numberType)], f.session);
      expect(decoded.issues.length).toBeGreaterThan(0);
      expect(decoded.args).toEqual([{ kind: "literal", value: undefined }]);
    }
    expect(f.nativeCalls()).toBe(0);
    expect(f.callerLookups()).toBe(0);
  });

  test("unknown and repeated parameter names cannot fill a different slot", () => {
    const f = fixture();
    const params = [field("count", numberType), field("text", textType), field("other", numberType)];
    const decoded = decodeLocusAddressInputs([
      { name: "count", text: "3" }, { name: "unknown", text: "9" },
      { name: "count", text: "4" }, { name: "text", text: "" },
    ], params, f.session);
    expect(decoded.issues).toEqual(['There is no parameter named "unknown".', 'The address supplies "count" more than once.']);
    expect(decoded.args).toEqual([
      { kind: "literal", value: undefined }, { kind: "literal", value: "" }, { kind: "literal", value: undefined },
    ]);
    expect(decodeLocusAddressInputs([], params, f.session)).toEqual({
      args: params.map(() => ({ kind: "literal", value: undefined })), issues: [],
    });
  });

  test("malformed literal syntax refuses without inventing a default value", () => {
    const f = fixture();
    const decoded = decodeLocusAddressInputs([{ name: "count", text: "1 +" }], [field("count", numberType)], f.session);
    expect(decoded.issues.length).toBeGreaterThan(0);
    expect(decoded.args).toEqual([{ kind: "literal", value: undefined }]);
    expect(f.nativeCalls()).toBe(0);
  });

  test("the same constructor source name binds to each reader's own captured identity", () => {
    const params = [field("box", boxReference)];
    for (const target of [readerA, readerB]) {
      const f = fixture(target);
      const decoded = decodeLocusAddressInputs([{ name: "box", text: "ProbeBox 7" }], params, f.session);
      expect(decoded.issues).toEqual([]);
      expect(data(decoded.args[0]!, f.session)).toEqual({ $tag: "ProbeBox", _0: 7 });
      const wire = toLogic(decoded.args[0]!, undefined, f.session) as { construct: unknown[] };
      expect(wire.construct[0]).toBe(target);
      expect(f.nativeCalls()).toBe(0);
      expect(f.callerLookups()).toBe(0);
    }
    const ambiguous = fixture(readerA, true);
    const refused = decodeLocusAddressInputs([{ name: "box", text: "ProbeBox 7" }], params, ambiguous.session);
    expect(refused.issues.length).toBeGreaterThan(0);
    expect(refused.args).toEqual([{ kind: "literal", value: undefined }]);
  });

  test("unavailable constructor metadata preserves tagged JSON as data and refuses constructor source", () => {
    const f = fixture(readerA, false, false);
    const params = [field("box", boxReference)];
    const value = { $tag: "ProbeBox", _0: 7 };
    const imported = decodeLocusAddressInputs([{ name: "box", text: JSON.stringify(value) }], params, f.session);
    expect(imported.issues).toEqual([]);
    expect(imported.args).toEqual([{ kind: "literal", value }]);
    expect(f.nativeCalls()).toBe(0);
    expect(f.callerLookups()).toBe(0);
    expect(transferredData(imported.args[0]!, f.session)).toEqual(value);
    const refused = decodeLocusAddressInputs([{ name: "box", text: "ProbeBox 7" }], params, f.session);
    expect(refused.issues.length).toBeGreaterThan(0);
    expect(refused.args).toEqual([{ kind: "literal", value: undefined }]);
    expect(f.nativeCalls()).toBe(0);
  });

  test("missing captured constructor layouts refuse source import and sharing without calling reader natives", () => {
    const f = fixture();
    const params = [field("box", boxReference)];
    const argument: ExprNode = { kind: "call", fnId: readerA, callSyntax: "construct", args: [{ kind: "literal", value: 7 }] };
    const unavailable: Array<Partial<AuthoringSession["evaluateContext"]>> = [
      { _constructors: undefined, _constructorWireNames: undefined, _ctorFieldKeys: undefined },
      { _constructors: Object.create(null) },
      { _ctorFieldKeys: Object.create(null) },
      { _constructors: Object.fromEntries(Object.entries(f.session.evaluateContext._constructors!).filter(([id]) => id !== readerA)) },
      { _ctorFieldKeys: Object.fromEntries(Object.entries(f.session.evaluateContext._ctorFieldKeys!).filter(([id]) => id !== readerA)) },
    ];
    for (const metadata of unavailable) {
      const session: AuthoringSession = { ...f.session, evaluateContext: { ...f.session.evaluateContext, ...metadata } };
      const decoded = decodeLocusAddressInputs([{ name: "box", text: "ProbeBox 7" }], params, session);
      expect(decoded.issues.length).toBeGreaterThan(0);
      expect(decoded.args).toEqual([{ kind: "literal", value: undefined }]);
      const json = decodeLocusAddressInputs([{ name: "box", text: '{"$tag":"ProbeBox","_0":7}' }], params, session);
      expect(json.issues.length).toBeGreaterThan(0);
      expect(json.args).toEqual([{ kind: "literal", value: undefined }]);
      expect(share([argument], params, session)).toEqual({ inputs: [], omittedExpressions: true });
    }
    expect(f.nativeCalls()).toBe(0);
    expect(f.callerLookups()).toBe(0);
  });

  test("sharing omits executable expressions and foreign constructor identities", () => {
    const f = fixture();
    const params = [field("value", numberType)];
    for (const argument of [
      { kind: "call", fnId: "std:add", args: [{ kind: "literal", value: 1 }, { kind: "literal", value: 2 }] },
      { kind: "call", fnId: "probe:touch", args: [{ kind: "literal", value: 1 }] },
      { kind: "ref", savedExprId: "saved" },
      { kind: "call", fnId: readerB, callSyntax: "construct", args: [{ kind: "literal", value: 7 }] },
    ] as ExprNode[]) {
      expect(share([argument], params, f.session)).toEqual({ inputs: [], omittedExpressions: true });
    }
    expect(share([{ kind: "literal", value: undefined }], params, f.session))
      .toEqual({ inputs: [], omittedExpressions: false });
    expect(f.nativeCalls()).toBe(0);
    expect(f.callerLookups()).toBe(0);
  });

  test("actual codec and printer share a query that roundtrips raw String and closed numeric data", () => {
    const f = fixture();
    const params = [field("text", textType), field("count", numberType), field("values", List(numberType))];
    const inputs: LocusAddressInput[] = [
      { name: "text", text: '"Fenel" + 100% / e\u0301\n' }, { name: "count", text: "12" }, { name: "values", text: "[1, 2]" },
    ];
    const decoded = decodeLocusAddressInputs(inputs, params, f.session);
    expect(decoded.issues).toEqual([]);
    const encoded = share(decoded.args, params, f.session);
    expect(encoded.omittedExpressions).toBe(false);
    const query = new URLSearchParams(encoded.inputs.map(input => [input.name, input.text]));
    const restored = [...new URLSearchParams(query.toString())].map(([name, value]) => ({ name, text: value }));
    const again = decodeLocusAddressInputs(restored, params, f.session);
    expect(again.issues).toEqual([]);
    expect(data(again.args[0]!, f.session)).toBe(inputs[0]!.text);
    expect(data(again.args[1]!, f.session)).toBe(12);
    expect(data(again.args[2]!, f.session)).toEqual([1, 2]);
    expect(f.nativeCalls()).toBe(0);
  });
});

// B4 unit C: a Local reader decodes and encodes its address inputs in its
// worker (`decode-` / `encode-reader-address-inputs`), which runs this same
// module over a structured-clone boundary in its own session. The page's
// former calls (Home's Call form) are the oracle.
describe("the Local worker's address input operations answer as the page did", () => {
  const worker = async (query: Record<string, unknown>, session: AuthoringSession) =>
    structuredClone(await runReaderExtension(structuredClone(query) as never, session, undefined, async () => {}));
  const params = [field("text", textType), field("count", numberType), field("values", List(numberType)), field("box", boxReference),
    field("flag", booleanType)];
  const corpus: LocusAddressInput[][] = [
    [{ name: "text", text: '"Fenel" + 100% / e\u0301\n' }, { name: "count", text: "12" }, { name: "values", text: "[1, 2]" }],
    [{ name: "box", text: "ProbeBox 7" }, { name: "count", text: "1 +" }],
    [{ name: "box", text: '{"$tag":"ProbeBox","_0":7}' }, { name: "flag", text: "True" }],
    [{ name: "missing", text: "1" }, { name: "count", text: "2" }, { name: "count", text: "3" }],
    [{ name: "values", text: "touch 1" }, { name: "count", text: "-0" }],
  ];
  test("decode: every corpus input, issues included", async () => {
    const f = fixture();
    for (const inputs of corpus) {
      const page = structuredClone(decodeLocusAddressInputs(inputs, params, f.session));
      expect(await worker({ method: "decode-reader-address-inputs", inputs, params }, f.session)).toEqual({ decoded: page });
    }
    expect(f.nativeCalls()).toBe(0);
  });
  test("encode: decoded inputs and computed or saved arguments share what the page shared", async () => {
    const f = fixture();
    const saved = new Map<string, ExprNode>([["seven", { kind: "literal", value: 7 }]]);
    const argumentSets: ExprNode[][] = [
      ...corpus.map(inputs => decodeLocusAddressInputs(inputs, params, f.session).args),
      [{ kind: "literal", value: "x" }, { kind: "ref", savedExprId: "seven" }, { kind: "literal", value: undefined },
        { kind: "call", fnId: readerA, callSyntax: "construct", args: [{ kind: "literal", value: 7 }] }, { kind: "call", fnId: "probe:touch", args: [] }],
    ];
    for (const args of argumentSets) {
      let page: unknown;
      try { page = { $tag: "Ok", _0: encodeLocusAddressInputs(args, params, f.session,
        node => authoringExpressionLogic(node, id => saved.get(id), f.session), wire => enginePrintFenel(wire as never)) }; }
      catch (error) { page = { $tag: "Err", _0: error instanceof Error ? error.message : String(error) }; }
      expect(await worker({ method: "encode-reader-address-inputs", args, params, savedExpressions: [...saved], priority: "guidance" }, f.session))
        .toEqual({ encoded: page } as never);
    }
  });
  test("malformed requests refuse", async () => {
    const f = fixture();
    await expect(worker({ method: "decode-reader-address-inputs", inputs: [{ name: 1, text: "1" }], params }, f.session)).rejects.toThrow("The address inputs request could not be read.");
    await expect(worker({ method: "encode-reader-address-inputs", args: [], params, savedExpressions: [[1]] }, f.session)).rejects.toThrow("The address inputs request could not be read.");
  });
});
