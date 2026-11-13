import { beforeAll, describe, expect, test } from "bun:test";
import { parse } from "./fenel-parser";
import {
  dispatchEngineBody, dispatchedJsonLogicToSyntax, dispatchedJsonLogicToExpr, parseViaFenelParser,
  PARSE_VIA_FENEL_FAIL, print,
} from "./engine-bodies-dispatch";
import { loadFenelModule } from "./fenel-module";
import { createRegistry } from "./registry";
import { createDispatchRegistry } from "./dispatch-registry";
import { seedFromType } from "./effect-dispatch";
import { evaluate, invokeCallable, type EvaluateContext } from "./json-logic";
import { inferJsonLogicType } from "./signature-inference";
import { exprNodeToLogic, logicToExprNode } from "./authoring/expression-authoring";
import { Nothing } from "./type-foundation";
import type { FieldDef, FenelType } from "./types";

// C1: exercise the existing source parser, codecs, inference and evaluator.
// The class fixture uses an isolated dispatch registry; no system rows mutate.
const LONG = 600_000;
const ref = (name: string): FenelType => ({ $ref: name });
const param = (index: number, type: FenelType): FieldDef => ({
  name: `_${index}`, key: { $tag: "PositionalField", index }, type,
  label: Nothing, ui: Nothing, meta: {},
});
const source = `module NullaryProbe where
sample : String
sample = "sample"
echo : String -> String
echo text = text
`;
const sampleProjection = { method: ["NullaryProbe", "sample"] };
const sampleApplication = { call: [sampleProjection] };
let context: EvaluateContext;
beforeAll(() => {
  context = createRegistry([loadFenelModule(source, "NullaryProbe", { bootstrapParser: "typescript" })]).evaluateContext();
}, LONG);

describe("qualified projection followed by explicit nullary application", () => {
  test("both parser sources retain explicit application and bare projection separately", () => {
    expect(parse("NullaryProbe.sample")).toEqual(sampleProjection);
    expect(parse("NullaryProbe.sample ()")).toEqual(sampleApplication);
    expect(parse("NullaryProbe.sample()")).toEqual(sampleApplication);
    const head = { $tag: "SVar", name: "NullaryProbe.sample" };
    const bare = dispatchEngineBody("engine:buildApp", [head, []]);
    const applied = dispatchEngineBody("engine:buildAppU", [head, [{ $tag: "SLit", value: null }], null]);
    expect(dispatchEngineBody("engine:syntaxToJsonLogic", [bare])).toEqual(sampleProjection);
    expect(dispatchEngineBody("engine:syntaxToJsonLogic", [applied])).toEqual(sampleApplication);
    expect(dispatchedJsonLogicToSyntax(sampleProjection)).toEqual({ $tag: "Ok", _0: bare });
    expect(dispatchedJsonLogicToSyntax(sampleApplication)).toEqual({ $tag: "Ok", _0: applied });
    expect(dispatchedJsonLogicToSyntax({ call: [sampleApplication] })).toHaveProperty("$tag", "Err");
  }, LONG);

  test("bounded native program-parser control matches the performance mirror", () => {
    const program = "probe = NullaryProbe.sample ()";
    const parsed = parseViaFenelParser(program);
    expect(parsed).not.toBe(PARSE_VIA_FENEL_FAIL);
    expect(parsed).toEqual(parse(program));
  }, LONG);

  test("codec and source round trips preserve projection, application and exact identity", () => {
    for (const logic of [sampleProjection, sampleApplication]) {
      const node = logicToExprNode(logic);
      expect(exprNodeToLogic(node, { fnCodeName: id => id })).toEqual(logic);
      expect(parse(print(logic))).toEqual(logic);
    }
    for (const unsupported of [
      { call: [sampleApplication] },
      { call: [{ var: "callback" }] },
      { call: [{ method: ["NullaryProbe", "sample"], extra: true }] },
      { call: [{ method: "ab" }] },
      { call: [{ method: ["NullaryProbe", 7] }] },
      { call: [{ method: ["NullaryProbe", "sample", 1] }] },
      { call: [sampleProjection, 1] },
    ]) expect(print(unsupported)).toContain("<no surface syntax:");
    const node = logicToExprNode(sampleApplication);
    expect(exprNodeToLogic(node, {
      fnCodeName: id => id,
      methodTarget: () => "NullaryProbe:sample",
    })).toEqual(sampleApplication);
    expect(exprNodeToLogic(logicToExprNode(sampleProjection), {
      fnCodeName: id => id,
      methodTarget: () => "NullaryProbe:sample",
    })).toEqual(sampleProjection);
    expect(evaluate(exprNodeToLogic(node, { fnCodeName: id => id }), {}, context)).toBe("sample");
    expect(evaluate(sampleProjection, {}, context)).toEqual({ $ref: "NullaryProbe:sample" });
  }, LONG);

  test("bare function inference stays an Arrow while its unit application returns String", () => {
    const resolveFunction = (name: string) => name === "NullaryProbe.sample"
      ? {
        targetId: "NullaryProbe:sample", params: [], returns: ref("String"),
        scheme: { quantified: [], body: { $arrow: { params: [], returns: ref("String") } } },
      }
      : undefined;
    const bare = inferJsonLogicType(sampleProjection, { resolveFunction });
    const called = inferJsonLogicType(sampleApplication, { resolveFunction });
    expect(bare.outcome.$tag).toBe("Solved");
    expect(bare.scheme?.body).toEqual({ $arrow: { params: [], returns: ref("String") } });
    expect(called.outcome.$tag).toBe("Solved");
    expect(called.scheme?.body).toEqual(ref("String"));
  }, LONG);

  test("deferred class dispatch stays callable, retains its remaining scheme and scope", () => {
    const dispatch = createDispatchRegistry();
    const params = [param(0, ref("Number")), param(1, ref("Number")), param(2, { $var: "a" })];
    dispatch.defineClass({ name: "Foldable", params: [{ name: "a" }], methods: [{ name: "foldr", params, returns: ref("Number") }] });
    dispatch.addInstance({ typeName: "Foldable", args: ["List"], methods: { foldr: "probe:foldr" } });
    const classContext: EvaluateContext = {
      _specRegistry: dispatch,
      natives: { "probe:foldr": () => 6, "probe:override": () => 9 },
    };
    const bare = evaluate(parse("Foldable.foldr"), {}, classContext);
    const called = evaluate(parse("Foldable.foldr ()"), {}, classContext);
    expect(bare).toHaveProperty("__fenelFn", true);
    expect(called).toHaveProperty("__fenelPartial", true);
    expect(invokeCallable(called as Parameters<typeof invokeCallable>[0], [0, 0, [1, 2, 3]], classContext)).toBe(6);
    expect(invokeCallable(called as Parameters<typeof invokeCallable>[0], [0, 0, [1, 2, 3]], {
      ...classContext,
      _dictStack: [{ typeName: "Foldable", args: ["List"], methods: { foldr: "probe:override" } }],
    })).toBe(9);
    const inferredParams = params.map((p, i) => i === 2 ? param(i, ref("List")) : p);
    const resolveFunction = (name: string) => name === "Foldable.foldr"
      ? {
        targetId: name, params: inferredParams, returns: ref("Number"),
        scheme: { quantified: [], body: { $arrow: { params: inferredParams, returns: ref("Number") } } },
      }
      : undefined;
    const inferredBare = inferJsonLogicType(parse("Foldable.foldr"), { resolveFunction });
    const inferredCall = inferJsonLogicType(parse("Foldable.foldr ()"), { resolveFunction });
    expect(inferredBare.outcome.$tag).toBe("Solved");
    expect(inferredCall.outcome.$tag).toBe("Solved");
    expect(inferredCall.scheme?.body).toEqual(inferredBare.scheme?.body);
  }, LONG);

  test("nonempty qualified calls and local field receivers retain their shapes and values", () => {
    expect(parse('NullaryProbe.echo "hello"')).toEqual({ method: ["NullaryProbe", "echo", "hello"] });
    expect(evaluate(parse('NullaryProbe.echo "hello"'), {}, context)).toBe("hello");
    expect(parse("record.method")).toEqual({ var: "record.method" });
    expect(parse("record.method ()")).toEqual({ call: ["record.method"] });
    expect(evaluate({ call: [{ var: "record.method" }] }, {
      record: { method: { __fenelFn: true, params: [], body: "local", closure: {} } },
    }, context)).toBe("local");
  }, LONG);

  test("canonical nullary applications preserve the return annotation typing door", () => {
    const empty: EvaluateContext = {
      _routingTable: () => ({ posIdx: { "Make.empty": -1 } }),
    };
    expect(() => evaluate(parse("(Make.empty () : String)"), {}, empty))
      .toThrow(/Make\.empty: this method is selected by its complete type/);
    expect(() => evaluate(parse("(Make.empty : String)"), {}, empty))
      .toThrow(/Make\.empty: this method is selected by its complete type/);
    const malformed = { ann: [{ call: new Array(1) }, ref("String")] };
    expect(evaluate(malformed, {}, empty)).toBeNull();
    // A second application must still run after the first returned callable.
    // It is not the canonical direct projection wrapper the typed door reads.
    const doubleApplication = { call: [{ call: [{ method: ["Make", "empty"] }] }] };
    expect(evaluate({ ann: [doubleApplication, ref("String")] }, {}, empty))
      .toHaveProperty("__fenelPartial", true);
    // A method with supplied arguments is already an application; do not
    // remove an outer call that may invoke a callable the method returns.
    expect(() => evaluate({ ann: [{ call: [{ method: ["Make", "empty", 1] }] }, ref("String")] }, {}, empty))
      .toThrow(/unresolved Make\.empty/);
    expect(evaluate(parse("(NullaryProbe.sample () : String)"), {}, context)).toBe("sample");
  }, LONG);

  test("the compiler keeps its existing expression-head application refusal", () => {
    for (const logic of [sampleApplication, { call: ["echo", sampleApplication] }]) {
      const compiled = dispatchedJsonLogicToExpr(logic) as { $tag: string; _0: { reason: string } };
      expect(compiled.$tag).toBe("Err");
      expect(compiled._0.reason).toContain("qualified method requires runtime projection");
    }
  }, LONG);

  test("a nullary return-position selection keeps the written type and strict result check", () => {
    const module = loadFenelModule(`module ReturnProbe where
TokenValue = TokenValue
ReturnToken a = ReturnToken empty: a
token : TokenValue
token = TokenValue
`, "ReturnProbe", { bootstrapParser: "typescript" });
    const entity = module.entities!.find(e => e.codeName === "ReturnToken" || e.id === "ReturnToken")!;
    expect(entity).toBeDefined();
    const dispatch = createDispatchRegistry();
    dispatch.defineClass(seedFromType("ReturnToken", entity.type, "a", {
      typeScheme: entity.typeScheme, sourceModule: module,
    }));
    dispatch.addInstance({ typeName: "ReturnToken", args: ["TokenValue"], methods: { empty: "ReturnProbe:token" } });
    const registry = createRegistry([module], { dispatchRegistry: dispatch });
    const typedContext = { ...registry.evaluateContext(), _sourceFunction: "ReturnProbe:token" };
    for (const source of ["(ReturnToken.empty : TokenValue)", "(ReturnToken.empty () : TokenValue)"]) {
      expect(evaluate(parse(source), {}, typedContext)).toEqual({ $tag: "TokenValue" });
    }
  }, LONG);
});
