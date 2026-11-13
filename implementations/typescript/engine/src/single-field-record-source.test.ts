// Existing C1 test harness: complete source trees, legacy IR and constructor
// inference/evaluation/compilation. No production host policy is introduced.
import { describe, expect, test } from "bun:test";
import { parse } from "./fenel-parser";
import {
  dispatchEngineBody,
  dispatchedJsonLogicToSyntax,
  dispatchedSerializeJsModule,
  PARSE_VIA_FENEL_FAIL,
  parseViaFenelParser,
  setParserInterpreted,
} from "./engine-bodies-dispatch";
import { evaluate, type EvaluateContext } from "./json-logic";
import { compileFenelToJsNative } from "./modules/compile-js";
import { inferJsonLogicType, type JsonLogicInferenceOptions } from "./signature-inference";
import { exprNodeToLogic, logicToExprNode } from "./authoring/expression-authoring";
import { List, Nothing } from "./type-foundation";
import { peelList } from "./set-algebra";
import type { CompileFieldSlot } from "./compilable";
import type { Expression, FenelFunction, FenelType, FieldDef, TypeScheme } from "./types";

const TO = 120_000;
const diagnostic = { code: "x", path: ["x"], functionId: "x", message: "x" };
const cases = [
  {
    name: "original diagnostic-record list",
    source: 'make = Invalid { diagnostics = [{ code = "x", path = ["x"], functionId = "x", message = "x" }] }',
    body: { construct: ["Invalid", { diagnostics: [diagnostic] }] },
  },
  { name: "empty list", source: "make = Invalid { diagnostics = [] }", body: { construct: ["Invalid", { diagnostics: [] }] } },
  { name: "singleton list", source: 'make = Invalid { diagnostics = ["x"] }', body: { construct: ["Invalid", { diagnostics: ["x"] }] } },
  { name: "two-item list", source: 'make = Invalid { diagnostics = ["x", "y"] }', body: { construct: ["Invalid", { diagnostics: ["x", "y"] }] } },
  { name: "three-item list", source: 'make = Invalid { diagnostics = ["x", "y", "z"] }', body: { construct: ["Invalid", { diagnostics: ["x", "y", "z"] }] } },
  { name: "two-field record control", source: 'make = Invalid { diagnostics = ["x"], reason = "x" }', body: { construct: ["Invalid", { diagnostics: ["x"], reason: "x" }] } },
  { name: "genuine appendItem field value", source: 'make = Invalid { diagnostics = appendItem "x" [] }', body: { construct: ["Invalid", { diagnostics: { call: ["appendItem", "x", []] } }] } },
  { name: "ordinary explicit record", source: 'make = { diagnostics = ["x"] }', body: { diagnostics: ["x"] } },
  { name: "ordinary record with genuine appendItem", source: 'make = { diagnostics = appendItem "x" [] }', body: { diagnostics: { call: ["appendItem", "x", []] } } },
  { name: "nested lists", source: 'make = Invalid { diagnostics = [["x"], []] }', body: { construct: ["Invalid", { diagnostics: [["x"], []] }] } },
  { name: "nested list-valued record", source: 'make = Invalid { diagnostics = [{ code = ["x"] }] }', body: { construct: ["Invalid", { diagnostics: [{ code: ["x"] }] }] } },
  { name: "genuine appendItem body", source: 'make = appendItem "x" ["y"]', body: { call: ["appendItem", "x", ["y"]] } },
  { name: "genuine call with list argument", source: 'make = consume ["x"]', body: { call: ["consume", ["x"]] } },
  { name: "genuine appendItem with nonempty tail", source: 'make = Invalid { diagnostics = appendItem "x" ["y"] }', body: { construct: ["Invalid", { diagnostics: { call: ["appendItem", "x", ["y"]] } }] } },
] as const;
const executionSamples = [
  { sample: cases[0], payload: [diagnostic] },
  { sample: cases[2], payload: ["x"] },
  { sample: cases[6], payload: ["x"] },
  { sample: cases[13], payload: ["y", "x"] },
] as const;

const moduleSource = (source: string): string => `module RecordListSource where\n\n${source}`;
const fenelTrees = new Map<string, unknown>();
function fenelTree(source: string): unknown {
  if (!fenelTrees.has(source)) fenelTrees.set(source, parseViaFenelParser(source));
  return fenelTrees.get(source);
}
function bodyOf(tree: unknown): unknown {
  const frames = tree as { program: Array<{ def?: { name: string; body: unknown } }> };
  const definition = frames.program.find((frame) => frame.def?.name === "make")?.def;
  if (definition === undefined) throw new Error("make definition is missing");
  return definition.body;
}

describe("one-field records — exact complete source/IR parity", () => {
  for (const sample of cases) {
    test(sample.name, () => {
      const source = moduleSource(sample.source);
      const host = parse(source);
      const fenel = fenelTree(source);
      expect(fenel).not.toBe(PARSE_VIA_FENEL_FAIL);
      expect(fenel).toEqual(host);
      expect(bodyOf(host)).toEqual(sample.body);
      expect(bodyOf(fenel)).toEqual(sample.body);
    }, TO);
  }

  test("binding the list first remains an exact-parity spelling", () => {
    const source = moduleSource('make =\n  let diagnostics = ["x"]\n  Invalid { diagnostics = diagnostics }');
    const host = parse(source);
    const fenel = fenelTree(source);
    expect(fenel).not.toBe(PARSE_VIA_FENEL_FAIL);
    expect(fenel).toEqual(host);
    expect(evaluate(bodyOf(fenel) as Expression, {}, { _constructors: { Invalid: ["diagnostics"] } }))
      .toEqual({ $tag: "Invalid", diagnostics: ["x"] });
  }, TO);

  test("case-arm and nested argument records retain their source field", () => {
    for (const definition of [
      'make value = case value of\n  Just item -> Invalid { diagnostics = [item] }\n  Nothing -> Invalid { diagnostics = [] }',
      'make = consume (Invalid { diagnostics = ["x"] })',
    ]) {
      const source = moduleSource(definition);
      const fenel = fenelTree(source);
      expect(fenel).not.toBe(PARSE_VIA_FENEL_FAIL);
      expect(fenel).toEqual(parse(source));
    }
  }, TO);
});

describe("one-field records — separate source and legacy IR intent", () => {
  test("buildRecord retains both marked list literals and genuine calls", () => {
    const list = { $tag: "SCall", fnId: "appendItem", args: [{ $tag: "SLit", value: "x" }, { $tag: "SLit", value: [] }], lit: true };
    const genuine = { $tag: "SCall", fnId: "appendItem", args: [{ $tag: "SLit", value: "x" }, { $tag: "SLit", value: [] }] };
    setParserInterpreted(true);
    try {
      for (const value of [list, genuine]) {
        const fields = [{ name: "diagnostics", value }];
        expect(dispatchEngineBody("engine:buildRecord", [fields])).toEqual({ $tag: "SRecord", fields });
      }
      expect(dispatchEngineBody("engine:buildRecord", [[]])).toEqual({ $tag: "SRecord", fields: [] });
    } finally {
      setParserInterpreted(null);
    }
  }, TO);

  test("raw nonempty-array key-as-function IR keeps its legacy call meaning", () => {
    const syntax = dispatchedJsonLogicToSyntax({ diagnostics: ["x"] }) as { $tag: string; _0: unknown };
    expect(syntax).toEqual({ $tag: "Ok", _0: { $tag: "SCall", fnId: "diagnostics", args: [{ $tag: "SLit", value: "x" }] } });
    expect(dispatchEngineBody("engine:syntaxToJsonLogic", [syntax._0])).toEqual({ call: ["diagnostics", "x"] });
  }, TO);
});

const fieldKey = { $tag: "NamedField", ref: { $ref: "11111111-1111-4111-8111-111111111111" } } as const;
const slots: CompileFieldSlot[] = [{ key: fieldKey, wireName: "diagnostics" }];
const diagnosticField: FieldDef = { name: "diagnostics", key: fieldKey, type: List({ $ref: "String" }), label: Nothing, ui: Nothing, meta: {} };
const resultType: FenelType = { $variant: { cases: [{ name: "Invalid", label: Nothing, fields: [diagnosticField] }] } };
const elementType: FenelType = { $var: "a" };
const appendItemParams: FieldDef[] = [elementType, List(elementType)].map((type, index) => ({
  name: `_${index}`, key: { $tag: "PositionalField", index }, type, label: Nothing, ui: Nothing, meta: {},
}));
const appendItemScheme: TypeScheme = {
  quantified: [{ id: "source-list-a", sourceName: "a", kind: { $tag: "KType" } }],
  body: { $arrow: { params: appendItemParams, returns: List(elementType) } },
};
const resolveInvalid: NonNullable<JsonLogicInferenceOptions["resolvePatternConstructor"]> = (name) => name === "Invalid"
  ? { status: "resolved", targetId: "@ctor/source/Invalid", params: [diagnosticField], returns: resultType, scheme: { quantified: [], body: { $arrow: { params: [diagnosticField], returns: resultType } } } }
  : { status: "missing" };

describe("one-field records — declared named-constructor consumers", () => {
  test("a visible same-named function cannot replace the constructor payload", () => {
    let calls = 0;
    const collision: FenelFunction = { id: "diagnostics", params: [], returns: { $ref: "String" }, body: "collision" };
    const context: EvaluateContext = {
      _constructors: { Invalid: ["diagnostics"] },
      getFunction: (name) => name === "diagnostics" ? collision : undefined,
      natives: { diagnostics: () => { calls += 1; return "collision"; }, appendItem: (value, rest) => [...(rest as unknown[]), value] },
    };
    for (const { sample, payload } of executionSamples) {
      const source = moduleSource(sample.source);
      for (const tree of [parse(source), fenelTree(source)]) {
        expect(tree).not.toBe(PARSE_VIA_FENEL_FAIL);
        const body = bodyOf(tree);
        expect(evaluate(body as Expression, {}, context)).toEqual({ $tag: "Invalid", diagnostics: payload });
        expect(exprNodeToLogic(logicToExprNode(body))).toEqual(body);
      }
    }
    expect(calls).toBe(0);
    // General plain records still use the existing raw-IR evaluator heuristic.
    // This bounded parser repair does not introduce a new record envelope.
    expect(evaluate(bodyOf(parse(moduleSource(cases[7].source))) as Expression, {}, context)).toBe("collision");
    expect(calls).toBe(1);
  }, TO);

  test("named list fields infer through declared constructor slots despite the collision", () => {
    const source = moduleSource(cases[2].source);
    const declared = inferJsonLogicType({ var: "declared" }, { bindings: { declared: resultType } });
    expect(declared.outcome.$tag).toBe("Solved");
    if (declared.type === undefined) throw new Error("declared result type projection is missing");
    for (const tree of [parse(source), fenelTree(source)]) {
      expect(tree).not.toBe(PARSE_VIA_FENEL_FAIL);
      const acquired: string[] = [];
      const result = inferJsonLogicType(bodyOf(tree), {
        resolvePatternConstructor: resolveInvalid,
        resolveFunction: (name) => {
          acquired.push(name);
          if (name === "diagnostics") return { targetId: "source:diagnostics", params: [], returns: { $ref: "Number" }, scheme: { quantified: [], body: { $arrow: { params: [], returns: { $ref: "Number" } } } } };
          if (name === "appendItem") return {
            targetId: "std:appendItem", params: appendItemParams, returns: List(elementType),
            scheme: appendItemScheme,
          };
          return undefined;
        },
      });
      expect(result.outcome.$tag).toBe("Solved");
      expect(result.type).toEqual(declared.type);
      if (result.type === undefined || !("$variant" in result.type)) throw new Error("expected the declared Invalid result variant");
      const [inferredCase] = result.type.$variant.cases;
      expect(result.type.$variant.cases).toHaveLength(1);
      expect(inferredCase?.name).toBe("Invalid");
      expect(inferredCase?.fields).toHaveLength(1);
      const inferredField = inferredCase!.fields![0]!;
      const { type: inferredFieldType, ...inferredSlot } = inferredField;
      const { type: _declaredFieldType, ...declaredSlot } = diagnosticField;
      expect(inferredSlot).toEqual(declaredSlot);
      expect(peelList(inferredFieldType)).toEqual({ elem: { $ref: "String" } });
      expect(acquired.filter((name) => name === "appendItem")).toEqual(["appendItem"]);
    }
  }, TO);

  test("a helper revealed by named-constructor marshalling respects a scoped miss", () => {
    const acquired: string[] = [];
    const result = inferJsonLogicType(bodyOf(parse(moduleSource(cases[2].source))), {
      resolvePatternConstructor: resolveInvalid,
      resolveFunction: (name) => { acquired.push(name); return undefined; },
    });
    expect(acquired.filter((name) => name === "appendItem")).toEqual(["appendItem"]);
    expect(result.outcome.$tag).toBe("AnnotationRequired");
    if (result.outcome.$tag === "AnnotationRequired") {
      expect(result.outcome.diagnostics.map(({ code }) => code)).toContain("inference.unknown-name");
      expect(result.outcome.diagnostics.some(({ message }) => message.includes("appendItem"))).toBe(true);
    }
  }, TO);

  test("a revealed helper still requires an inert authoritative TypeScheme", () => {
    const logic = bodyOf(parse(moduleSource(cases[2].source)));
    const signature = { targetId: "std:appendItem", params: appendItemParams, returns: List(elementType) };
    const missingScheme = inferJsonLogicType(logic, {
      resolvePatternConstructor: resolveInvalid,
      resolveFunction: (name) => name === "appendItem" ? signature : undefined,
    });
    expect(missingScheme.outcome.$tag).toBe("Invalid");
    if (missingScheme.outcome.$tag === "Invalid") {
      expect(missingScheme.outcome.diagnostics[0]?.code).toBe("INFERENCE_RESOLVER_SIGNATURE_BOUNDARY");
      expect(missingScheme.outcome.diagnostics[0]?.message).toContain("no authoritative registry TypeScheme");
    }
    let getterRuns = 0;
    const hostile = { ...signature };
    Object.defineProperty(hostile, "scheme", { enumerable: true, get: () => { getterRuns += 1; return appendItemScheme; } });
    const hostileScheme = inferJsonLogicType(logic, {
      resolvePatternConstructor: resolveInvalid,
      resolveFunction: (name) => name === "appendItem" ? hostile : undefined,
    });
    expect(hostileScheme.outcome.$tag).toBe("Invalid");
    expect(getterRuns).toBe(0);
    if (hostileScheme.outcome.$tag === "Invalid") {
      expect(hostileScheme.outcome.diagnostics[0]?.code).toBe("INFERENCE_RESOLVER_SIGNATURE_BOUNDARY");
    }
  }, TO);

  test("JS compilation preserves exact named list payloads and genuine appendItem", () => {
    let calls = 0;
    const runtime = { diagnostics: () => { calls += 1; return "collision"; }, appendItem: (value: unknown, rest: unknown[]) => [...rest, value] };
    for (const { sample, payload } of executionSamples) {
      const source = moduleSource(sample.source);
      for (const tree of [parse(source), fenelTree(source)]) {
        expect(tree).not.toBe(PARSE_VIA_FENEL_FAIL);
        const compiled = compileFenelToJsNative({ name: "make", params: [], body: bodyOf(tree), ctorDefs: { Invalid: slots } });
        expect(compiled.$tag).toBe("Ok");
        if (compiled.$tag !== "Ok") throw new Error(JSON.stringify(compiled._0));
        const serialized = dispatchedSerializeJsModule(compiled._0);
        expect(serialized.$tag).toBe("Ok");
        if (serialized.$tag !== "Ok") throw new Error(JSON.stringify(serialized._0));
        const fn = new Function("$fenel", `return ${serialized._0};`)(runtime) as () => unknown;
        expect(fn()).toEqual({ $tag: "Invalid", diagnostics: payload });
      }
    }
    expect(calls).toBe(0);
  }, TO);
});
