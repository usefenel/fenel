import { beforeAll, describe, expect, test } from "bun:test";
import DOCUMENT_FORMATS_SOURCE from "../../../../fenel/modules/std/document-formats.fenel?raw";
import { parse, tokenize } from "./fenel-parser";
import { evaluate } from "./json-logic";
import {
  __getHarnessForTests,
  dispatchEngineBody,
  marshalParsedFrames,
  parseViaFenelParser,
  PARSE_VIA_FENEL_FAIL,
  withInterpretedCompiledArtifacts,
  dispatchedJsonLogicToSyntax,
  dispatchedSourceSyntaxToJsonLogic,
  dispatchedExprToJsonLogic,
  dispatchedNormaliseToCore,
  dispatchedMakeEffectsExplicit,
  dispatchedMakeClosuresExplicit,
  dispatchedEmitJs,
  dispatchedSerializeJsModule,
  parserBaseRuntimeForTests,
} from "./engine-bodies-dispatch";
import { positionalCompileFieldSlots } from "./compile-field-slots";
import type { CoreProgram } from "./ir/core";
import type { EffectsExplicitProgram } from "./ir/effects-explicit";
import type { ClosuresExplicitProgram } from "./ir/closures-explicit";
import type { JsModule } from "./ir/js-ast";

// C1: actual source grammar + existing production frame egress. The oracle
// only compares results; no parser replacement or emitted artifact supplies an AST.
type Token = { t: string; v: string; ln: number; col: number };
const tokenProjection = ({ t, v, ln, col }: Token) => ({ t, v, ln, col });
const sourceParse = (source: string): unknown =>
  withInterpretedCompiledArtifacts(() => parseViaFenelParser(source));

beforeAll(() => {
  expect(withInterpretedCompiledArtifacts(() => dispatchEngineBody("engine:unitLen", ["warm"]))).toBe(4);
}, 180_000);

const unitApplicationCases = [
  ["nullary variant alternatives", "Envelope = EvTop | EvRows rows: List ActRow"],
  ["bare nullary constructor", "f = Box"],
  ["unit function application", "f = target ()"],
  ["unit constructor application", "f = Box ()"],
  ["nonunit application", "f x = target x"],
  ["multiple ordinary arguments", "f x y = target x y"],
] as const;

describe("source unit application guards", () => {
  test("an empty argument list never reaches the partial unit inspection", () => {
    const { reg, ctx } = __getHarnessForTests();
    const helper = reg.getFunction("engine:buildAppU");
    if (helper?.body === undefined) throw new Error("The actual source application helper is unavailable");
    let inspections = 0;
    const inspect = () => { inspections++; throw new Error("An empty argument list has no unit value to inspect"); };
    const checking = { ...ctx, nativesCtx: { ...ctx.nativesCtx, isUnitLit: inspect, "engine:isUnitLit": inspect } };
    const actual = withInterpretedCompiledArtifacts(() => evaluate(helper.body!, {
      head: { $tag: "SVar", name: "target" }, args: [], nullValue: null,
    }, checking));
    expect(actual).toEqual({ $tag: "SVar", name: "target" });
    expect(inspections).toBe(0);
  }, 180_000);

  test.each(unitApplicationCases)("%s retains exact AST parity", (_name, source) => {
    const actual = sourceParse(source);
    expect(actual).not.toBe(PARSE_VIA_FENEL_FAIL);
    expect(JSON.stringify(actual)).toBe(JSON.stringify(parse(source)));
  }, 180_000);
});

describe("compiled unit application guards", () => {
  test.each(unitApplicationCases)("%s retains exact AST parity", (_name, source) => {
    const actual = parseViaFenelParser(source, { mode: "build-verification" });
    expect(actual).not.toBe(PARSE_VIA_FENEL_FAIL);
    expect(JSON.stringify(actual)).toBe(JSON.stringify(parse(source)));
  }, 180_000);
});

describe("source mixed conditional layout", () => {
  test.each([
    ["two-level mixed chain", "f a b =\n  if a then 1\n  else if b\n    then 2\n  else 3"],
    ["longer chain ending in mixed layout", "f a b c =\n  if a then 1\n  else if b then 2\n  else if c\n    then 3\n  else 4"],
    ["mixed branch with a further else-if", "f a b c =\n  if a then 1\n  else if b\n    then 2\n  else if c then 3\n  else 4"],
    ["existing B layout", "f a b =\n  if a\n    then 1\n    else if b\n      then 2\n      else 3"],
    ["existing C layout", "f a b =\n  if a then 1\n  else if b then 2\n  else 3"],
    ["existing D layout", "f a b =\n  if a\n  then 1\n  else if b\n  then 2\n  else 3"],
    ["mixed then branch with local statements", "f a b =\n  if a then 1\n  else if b\n    then\n      let picked = 2\n      picked + 1\n  else 3"],
  ])("%s matches the existing parser AST", (_name, source) => {
    const actual = sourceParse(source);
    expect(actual).not.toBe(PARSE_VIA_FENEL_FAIL);
    expect(JSON.stringify(actual)).toBe(JSON.stringify(parse(source)));
  }, 180_000);

  test("source parser retains its existing abstention for missing final else", () => {
    // B1 admits a two-entry if array when else is absent. Pin the existing
    // source parser's abstention here without deciding that language policy.
    const source = "f a b =\n  if a then 1\n  else if b\n    then 2";
    expect(sourceParse(source)).toBe(PARSE_VIA_FENEL_FAIL);
  }, 180_000);

  test("the exact document Markdown character declaration retains lexer and complete AST parity", () => {
    const lines = DOCUMENT_FORMATS_SOURCE.split(/\r?\n/);
    const start = lines.findIndex(line => line === "documentMarkdownCharacter character =");
    if (start < 0) throw new Error("The source document Markdown character declaration is missing");
    let end = start + 1;
    while (end < lines.length && !lines[end]!.startsWith("@category")) end++;
    const source = lines.slice(start, end).join("\n").trimEnd();

    // This actual declaration is above the unchanged interactive 120-token
    // cap. The finite test orchestrates existing source kernels under the 2048
    // build bound and uses the same production marshaller, without changing
    // the facade's bounds or claiming compiled build-verification clearance.
    const actual = withInterpretedCompiledArtifacts(() => {
      const invoke = (name: string, ...args: unknown[]): unknown => dispatchEngineBody(`engine:${name}`, args);
      const lexed = invoke("lexAll", source) as Token[];
      expect(lexed.map(tokenProjection)).toEqual(tokenize(source).map(tokenProjection));
      const spliced = invoke("spliceSetBodies", source, lexed);
      const layout = invoke("layoutTokens", spliced);
      const grouped = invoke("splitTopLevelDecls", layout) as { headered: boolean; name: string; groups: Token[][] };
      expect(grouped.headered).toBe(false);
      expect(grouped.groups).toHaveLength(1);
      const group = grouped.groups[0]!;
      expect(group.length).toBeGreaterThan(120);
      expect(group.length).toBeLessThanOrEqual(2048);
      const virtual = (t: string) => ({ t, v: "", ln: 0, col: 0 });
      const table = invoke("defaultFixityTable");
      const parsed = invoke("parseProgToks", table, null, [virtual("vopen"), ...group, virtual("vclose"), virtual("eof")]) as { $tag: string; _0: unknown[] };
      expect(parsed.$tag).toBe("Just");
      const frames = marshalParsedFrames(invoke("programToFrames", parsed._0) as unknown[]);
      expect(frames).toHaveLength(1);
      return frames[0];
    });
    expect(JSON.stringify(actual)).toBe(JSON.stringify(parse(source)));
  }, 180_000);
});

// Source/wire underscore is operationally wildcard, including a quoted "_"
// pattern. Canonical Pattern distinguishes that intent from an explicitly
// authored Core PatLit("_"). Source preflight uses current Fenel kernels;
// the separate compiled group requires freshly certified parser artifacts.
type WildcardMatch = {
  $tag: "SMatch" | "EMatch";
  arms: Array<{ pattern: { $tag: string; value?: unknown; args?: Array<{ $tag: string }> } }>;
};
function wildcardOk<T>(result: unknown): T {
  const candidate = result as { $tag?: string; _0?: T };
  expect(candidate?.$tag).toBe("Ok");
  if (candidate?.$tag !== "Ok") throw new Error(`Expected Ok: ${JSON.stringify(result)}`);
  return candidate._0 as T;
}
function wildcardCompileCore(program: CoreProgram): (value: unknown) => unknown {
  const effects = wildcardOk<EffectsExplicitProgram>(dispatchedMakeEffectsExplicit(program));
  const closures = wildcardOk<ClosuresExplicitProgram>(dispatchedMakeClosuresExplicit(effects));
  const module = wildcardOk<JsModule>(dispatchedEmitJs(closures));
  const code = wildcardOk<string>(dispatchedSerializeJsModule(module));
  return new Function("$fenel", `return ${code};`)(parserBaseRuntimeForTests()) as (value: unknown) => unknown;
}
function wildcardCore(body: CoreProgram["body"]): CoreProgram {
  return { $tag: "CoreProgram", name: "wildcardPreflight", params: positionalCompileFieldSlots(["x"]), body, requires: [] };
}
function wildcardSourceSyntax(source: string): WildcardMatch {
  const lexed = dispatchEngineBody("engine:lexAll", [source]);
  const spliced = dispatchEngineBody("engine:spliceSetBodies", [source, lexed]);
  const tokens = dispatchEngineBody("engine:layoutTokens", [spliced]);
  const table = dispatchEngineBody("engine:defaultFixityTable", []);
  const result = dispatchEngineBody("engine:parseExprToks", [table, null, tokens]) as { $tag: string; _0: WildcardMatch };
  expect(result.$tag).toBe("Just");
  if (result.$tag !== "Just") throw new Error(`Source grammar refused: ${source}`);
  expect(result._0.$tag).toBe("SMatch");
  return result._0;
}

const wildcardGrammarCases = [
  ["bare default", "case x of\n  _ -> 7", false],
  ["quoted operational underscore", "case x of\n  \"_\" -> 7\n  otherwise -> 9", false],
  ["nested constructor wildcard", "case x of\n  Box _ -> 7\n  otherwise -> 9", true],
] as const;

describe("wildcard source preflight", () => {
  test("JSON Logic ingress produces canonical wildcards and compiled execution agrees", () => {
    withInterpretedCompiledArtifacts(() => {
      const cases = [
        { body: { match: [{ var: "x" }, 0, "zero", "fallback"] }, arm: 1, nested: false, tag: "PatWildcard" },
        { body: { match: [{ var: "x" }, "_", "wild", { $bind: "otherwise" }, "fallback"] }, arm: 0, nested: false, tag: "PatWildcard" },
        { body: { match: [{ var: "x" }, { $tag: "Box", _0: "_" }, "box", { $bind: "otherwise" }, "fallback"] }, arm: 0, nested: true, tag: "PatWildcard" },
        { body: { match: [{ var: "x" }, "ordinary", "literal", { $bind: "otherwise" }, "fallback"] }, arm: 0, nested: false, tag: "PatLit" },
      ];
      for (const fixture of cases) {
        const syntax = wildcardOk<WildcardMatch>(dispatchedJsonLogicToSyntax(fixture.body));
        const pattern = syntax.arms[fixture.arm]!.pattern;
        expect(fixture.nested ? pattern.args?.[0]?.$tag : pattern.$tag).toBe(fixture.tag);
        if (fixture.tag === "PatLit") expect(pattern.value).toBe("ordinary");
        expect(dispatchedSourceSyntaxToJsonLogic(syntax)).toEqual(fixture.body);
        const program = wildcardOk<CoreProgram>(dispatchedNormaliseToCore({
          name: "wildcardWirePreflight", params: positionalCompileFieldSlots(["x"]), body: fixture.body,
        }));
        const run = wildcardCompileCore(program);
        for (const x of [null, 0, "_", "ordinary", "different", { $tag: "Box", _0: null }]) {
          expect(run(x)).toEqual(evaluate(fixture.body, { x }));
        }
      }
    });
  }, 180_000);

  test.each(wildcardGrammarCases)("direct source Syntax keeps %s wildcard through compilation", (_name, source, nested) => {
    withInterpretedCompiledArtifacts(() => {
      const syntax = wildcardSourceSyntax(source);
      const pattern = syntax.arms[0]!.pattern;
      expect(nested ? pattern.args?.[0]?.$tag : pattern.$tag).toBe("PatWildcard");
      const wire = dispatchedSourceSyntaxToJsonLogic(syntax);
      expect(wire).toEqual(JSON.parse(JSON.stringify(parse(source))));
      const expr = dispatchEngineBody("engine:desugar", [syntax]) as CoreProgram["body"];
      const run = wildcardCompileCore(wildcardCore(expr));
      for (const x of [null, 0, "_", "different", { $tag: "Box", _0: "anything" }]) {
        expect(run(x)).toEqual(evaluate(wire, { x }));
      }
    });
  }, 180_000);

  test("existing egress preserves guarded, nested named-field and default wildcards", () => {
    withInterpretedCompiledArtifacts(() => {
      const field = {
        key: { $tag: "NamedField", ref: { $ref: "44444444-4444-4444-8444-444444444444" } },
        wireName: "child",
      };
      const nested = { $tag: "PatConstruct", ctor: "Box", args: [{ $tag: "PatWildcard" }], fields: [field], observation: "preserve" };
      const projected = dispatchEngineBody("engine:matchPatternForJsonLogic", [nested]) as typeof nested;
      expect(projected.fields).toEqual([field]);
      expect(projected.observation).toBe("preserve");
      const syntax = {
        $tag: "SMatch", scrutinee: { $tag: "SVar", name: "x" }, arms: [
          { pattern: { $tag: "PatWildcard" }, guard: { $tag: "SLit", value: false }, body: { $tag: "SLit", value: "guarded" } },
          { pattern: nested, body: { $tag: "SLit", value: "nested" } },
          { pattern: { $tag: "PatWildcard" }, body: { $tag: "SLit", value: "default" } },
        ],
      };
      const expected = { match: [{ var: "x" }, { $guard: ["_", false] }, "guarded", { $tag: "Box", child: "_" }, "nested", "default"] };
      const wire = dispatchedSourceSyntaxToJsonLogic(syntax);
      expect(wire).toEqual(expected);
      expect(evaluate(wire, { x: { $tag: "Box", child: null } })).toBe("nested");
      expect(evaluate(wire, { x: "different" })).toBe("default");
      const expr = dispatchEngineBody("engine:desugar", [syntax]);
      expect(dispatchedExprToJsonLogic(expr)).toEqual(expected);
    });
  }, 180_000);

  test("direct Core PatLit underscore retains literal matching", () => {
    withInterpretedCompiledArtifacts(() => {
      const program = wildcardCore({
        $tag: "EMatch", scrutinee: { $tag: "EVar", name: "x" }, arms: [
          { pattern: { $tag: "PatLit", value: "_" }, body: { $tag: "ELit", value: "literal" } },
          { pattern: { $tag: "PatWildcard" }, body: { $tag: "ELit", value: "default" } },
        ],
      });
      const run = wildcardCompileCore(program);
      expect(run("_")).toBe("literal");
      for (const value of [null, 0, "different"]) expect(run(value)).toBe("default");
    });
  }, 180_000);
});

describe("wildcard fresh compiled", () => {
  test.each([
    ["nonempty variable list", "f left right = [left, right]"],
    ["nested recipe criteria", "recipeCriteriaAnd left right = case left of\n  RcNone -> RcNone\n  RcAll -> right\n  _ -> case right of\n    RcNone -> RcNone\n    RcAll -> left\n    _ -> RcAnd { terms = [left, right] }"],
    ["quoted nontrailing wildcard", "f x = case x of\n  \"_\" -> 7\n  otherwise -> 9"],
  ])("%s retains exact AST parity", (_name, source) => {
    const actual = parseViaFenelParser(source, { mode: "build-verification" });
    expect(actual).not.toBe(PARSE_VIA_FENEL_FAIL);
    expect(actual).toEqual(JSON.parse(JSON.stringify(parse(source))));
  }, 180_000);

  test("whole recipe criteria retains exact AST parity", async () => {
    const source = await Bun.file(new URL("../../../../fenel/modules/engine/recipe-criteria.fenel", import.meta.url)).text();
    const actual = parseViaFenelParser(source, { mode: "build-verification" });
    expect(actual).not.toBe(PARSE_VIA_FENEL_FAIL);
    expect(actual).toEqual(JSON.parse(JSON.stringify(parse(source))));
  }, 180_000);
});
