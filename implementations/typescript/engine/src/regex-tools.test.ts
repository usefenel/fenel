import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { loadFenelModule } from "./fenel-module";
import { evaluate, invokeCallable, type EvaluateContext } from "./json-logic";
import { createRegistry } from "./registry";
import { stdNatives, stdNativesCtx } from "../../../../fenel/modules/std/ffi/std-ffi";
import type { FenelFunction } from "./types";

// C1: execute the actual source reader and public projection, without a full
// registry or compiled-owner rebuild. No test parser or structural classifier.
const root = resolve(import.meta.dir, "../../../..");
const functions = new Map<string, FenelFunction>();
for (const path of [
  "fenel/modules/engine/regex-parse.fenel",
  "fenel/modules/publicdemo/regex-tools.fenel",
  "fenel/modules/std/appendItem.fenel",
  "fenel/modules/std/operators.fenel",
]) {
  const module = loadFenelModule(readFileSync(resolve(root, path), "utf8"),
    path.includes("/engine/") ? "engine" : path.includes("/publicdemo/") ? "ImportDemo" : "std",
    { bootstrapParser: "typescript" });
  for (const fn of module.functions ?? []) {
    functions.set(fn.id, fn);
    functions.set(fn.id.slice(fn.id.indexOf(":") + 1), fn);
  }
}
const context: EvaluateContext = {
  getFunction: name => functions.get(name),
  natives: Object.assign(Object.create(null), stdNatives, {
    // C1: the fast source controls enter the same authored reader through the
    // declared A4 leaf. The separate seed control uses the shipped bridge.
    "ImportDemo:regexToolRead": (tokens: unknown) => call("engine:rxParseWhole", tokens),
    regexToolRead: (tokens: unknown) => call("engine:rxParseWhole", tokens),
  }),
  nativesCtx: Object.assign(Object.create(null), stdNativesCtx),
  _constructors: {
    Ok: ["_0"], Err: ["_0"], Just: ["_0"], Nothing: [],
    RegexEmpty: [], RegexEmptyText: [], RegexLiteral: [], RegexCharacterClass: [],
    RegexAnyCharacter: [], RegexSequence: [], RegexAlternative: [],
    RegexRepetition: [], RegexNamedGroup: [],
  },
};
const call = (name: string, ...args: unknown[]): any => {
  const fn = functions.get(name)!;
  return evaluate(fn.body, Object.fromEntries(fn.params.map((param, i) => [param.name, args[i]])), context);
};
const inspect = (text: unknown): any => call("inspectRegexInput", { $tag: "ImportTextInput", text });
const accepted = (text: unknown): any => {
  const result = inspect(text);
  expect(result.$tag, JSON.stringify(result)).toBe("Ok");
  return result._0;
};
const refused = (text: unknown): string => {
  const result = inspect(text);
  expect(result.$tag, JSON.stringify(result)).toBe("Err");
  expect(typeof result._0).toBe("string");
  expect(result._0.length).toBeGreaterThan(0);
  return result._0;
};

describe("bounded existing-reader regex semantic inspection", () => {
  test("the whole live source passes compiled build verification and its TS AST oracle", async () => {
    const [{ parseViaFenelParser, PARSE_VIA_FENEL_FAIL }, { parse }] = await Promise.all([
      import("./engine-bodies-dispatch"), import("./fenel-parser"),
    ]);
    const source = readFileSync(resolve(root, "fenel/modules/publicdemo/regex-tools.fenel"), "utf8");
    const actual = parseViaFenelParser(source, { mode: "build-verification" });
    expect(actual).not.toBe(PARSE_VIA_FENEL_FAIL);
    expect(actual).toEqual(JSON.parse(JSON.stringify(parse(source))));
  }, 60000);

  test("the lexical fold callback counts named groups and retains its zero/default cases", () => {
    const named = accepted("(?<outer>(?<inner>a))").nodes;
    const plain = accepted("abc").nodes;
    expect(call("regexToolNamedGroupCount", [])).toBe(0);
    expect(call("regexToolNamedGroupCount", plain)).toBe(0);
    expect(call("regexToolNamedGroupCount", named)).toBe(2);
    expect(call("regexToolNamedGroupCount", [...named, ...named])).toBe(4);
    expect(call("regexToolNamedGroupCount", [...plain, ...named])).toBe(2);
  });

  test("the actual seed profile invokes the shipped reader bridge without executable engine enrollment", async () => {
    const [{ modulesFor }, { publicImportDemoModule }, { prepareEngineBodyDispatch }] = await Promise.all([
      import("./module-manifest"), import("./modules/public-demos"), import("./engine-bodies-dispatch"),
    ]);
    await prepareEngineBodyDispatch();
    const modules = modulesFor("seed");
    expect(modules.includes(publicImportDemoModule)).toBe(true);
    expect(modules.flatMap(module => module.functions ?? []).some(fn => fn.id === "engine:rxParseWhole")).toBe(false);
    const registry = createRegistry(modules);
    expect(registry.getFunction("engine:rxParseWhole")).toBeUndefined();
    expect(registry.getFunction("ImportDemo:regexToolRead")?.body).toBeUndefined();
    const actual: any = invokeCallable({ $ref: "ImportDemo:inspectRegexInput" }, [{ $tag: "ImportTextInput", text: "^(?<word>a|b)+$" }], registry.evaluateContext());
    expect(actual.$tag, JSON.stringify(actual)).toBe("Ok");
    expect(actual._0.retainedNamedGroupCount).toBe(1);
    expect(actual._0.semanticNodeCount).toBe(5);
    const refused: any = invokeCallable({ $ref: "ImportDemo:inspectRegexInput" }, [{ $tag: "ImportTextInput", text: "(abc" }], registry.evaluateContext());
    expect(refused).toEqual({ $tag: "Err", _0: "Missing closing parenthesis" });
  }, 180000);

  test("source owns typed public results and the executable starting recipe", () => {
    for (const name of ["inspectRegexText", "inspectRegexInput"]) {
      expect(functions.get(name)?.body).toBeDefined();
      expect(functions.get(name)?.returns).not.toEqual({ $record: { fields: [] } });
    }
    const starts = call("regexDemoStartingInputs");
    expect(starts).toHaveLength(1);
    const result: any = invokeCallable(starts[0].function, starts[0].arguments, context);
    expect(result.$tag).toBe("Ok");
    expect(result._0.retainedNamedGroupCount).toBe(3);
  });

  test("a nested named group retains explicit semantic paths and repetition bounds", () => {
    const value = accepted("^(?<letter>a|b){2,4}$");
    expect(value.source).toBe("^(?<letter>a|b){2,4}$");
    expect(value.semanticNodeCount).toBe(5);
    expect(value.retainedNamedGroupCount).toBe(1);
    expect(value.maximumDepth).toBe(3);
    expect(value.nodes.map((row: any) => [row.path, row.depth, row.kind.$tag])).toEqual([
      ["root", 0, "RegexRepetition"], ["root.child", 1, "RegexNamedGroup"],
      ["root.child.child", 2, "RegexAlternative"],
      ["root.child.child.left", 3, "RegexLiteral"], ["root.child.child.right", 3, "RegexLiteral"],
    ]);
    expect(value.nodes[0].minimum).toEqual({ $tag: "Just", _0: 2 });
    expect(value.nodes[0].maximum).toEqual({ $tag: "Just", _0: 4 });
    expect(value.nodes[1].retainedName).toEqual({ $tag: "Just", _0: "letter" });
    expect(value.nodes[3].literal).toEqual({ $tag: "Just", _0: "a" });
    expect(value.nodes[3].codePoint).toEqual({ $tag: "Just", _0: 97 });
  });

  test("class ranges, negation and unbounded repeats retain the reader's data", () => {
    const value = accepted("[^a-c0-2]+");
    expect(value.nodes[0].minimum).toEqual({ $tag: "Just", _0: 1 });
    expect(value.nodes[0].maximum).toEqual({ $tag: "Nothing" });
    expect(value.nodes[1].kind.$tag).toBe("RegexCharacterClass");
    expect(value.nodes[1].negated).toBe(true);
    expect(value.nodes[1].ranges).toEqual([
      { $tag: "RegexCodeRange", lower: 48, upper: 50 },
      { $tag: "RegexCodeRange", lower: 97, upper: 99 },
    ]);
  });

  test("plain/noncapturing wrappers and boundary anchors are not counted as retained groups", () => {
    for (const source of ["a", "^a$", "(a)", "(?:a)", "^((?:a))$"]) {
      const value = accepted(source);
      expect(value.source).toBe(source);
      expect(value.semanticNodeCount).toBe(1);
      expect(value.retainedNamedGroupCount).toBe(0);
      expect(value.nodes[0].literal).toEqual({ $tag: "Just", _0: "a" });
    }
    expect(accepted("").nodes[0].kind.$tag).toBe("RegexEmptyText");
    expect(accepted("^(?<outer>(?<inner>))$").retainedNamedGroupCount).toBe(2);
  });

  test("inherited reader meanings are explicit, rather than full JavaScript validation", () => {
    for (const text of ["^(?=abc)$", "^\\babc$", "^a{2$", "^[abc$", "^a**$"]) {
      expect(accepted(text).explanation).toContain("not complete JavaScript Regex validation");
    }
    expect(accepted("^\\babc$").nodes.some((row: any) => row.literal?._0 === "b")).toBe(true);
    expect(accepted("^a{2$").nodes[0].maximum).toEqual({ $tag: "Just", _0: 2 });
  });

  test("existing complete-reader group refusals survive the public handoff", () => {
    expect(refused("(abc")).toBe("Missing closing parenthesis");
    expect(refused("abc)")).toBe("Unexpected unconsumed token: )");
    expect(refused("^((abc)$")).toBe("Missing closing parenthesis");
    expect(accepted("^(?<word>abc)$").retainedNamedGroupCount).toBe(1);
  });

  test("Unicode literals remain whole code points and exact original source", () => {
    const value = accepted("^(?<animal>🦊)$");
    const row = value.nodes.find((item: any) => item.kind.$tag === "RegexLiteral");
    expect(row.literal).toEqual({ $tag: "Just", _0: "🦊" });
    expect(row.codePoint).toEqual({ $tag: "Just", _0: 0x1f98a });
    expect(value.source).toBe("^(?<animal>🦊)$");
    // No capture text or UTF-16 source-span claim is introduced by the projection.
    expect(row).not.toHaveProperty("start");
    expect(row).not.toHaveProperty("end");
  });

  test("surrogate values and reversed class ranges retain declared reader meanings", () => {
    const surrogate = accepted("\ud800");
    expect(surrogate.nodes[0].codePoint).toEqual({ $tag: "Just", _0: 0xd800 });
    expect(surrogate.nodes[0].literal).toEqual({ $tag: "Just", _0: "\ud800" });
    expect(accepted("^[z-a]$").nodes[0].ranges).toEqual([
      { $tag: "RegexCodeRange", lower: 122, upper: 97 },
    ]);
  });

  test("nonfinite or nonnatural reader numbers refuse before constructing Nat-typed rows", () => {
    const leaf = { $tag: "RxChar", _0: "a", _1: 97 };
    for (const minimum of [Infinity, NaN, -1, 0.5, "2"]) {
      const node = { $tag: "RxRep", _0: leaf, _1: minimum, _2: 4 };
      expect(call("regexToolFlatten", node, "root", 0, []).$tag).toBe("Err");
    }
    for (const maximum of [Infinity, NaN, -2, 0.5, "4"]) {
      const node = { $tag: "RxRep", _0: leaf, _1: 1, _2: maximum };
      expect(call("regexToolFlatten", node, "root", 0, []).$tag).toBe("Err");
    }
    const longBound = "1".repeat(110);
    const reported = accepted(`a{${longBound}}`).nodes[0].minimum._0;
    expect(Number.isFinite(reported)).toBe(true);
    expect(Number.isInteger(reported)).toBe(true);
    expect(reported).toBeGreaterThan(1e109);
    expect(reported).toBeLessThan(1e110);
  });

  test("unknown raw helper nodes and nonboolean class negation refuse before typed rows", () => {
    for (const node of [{ $tag: "Unknown" }, {}, null, { $tag: "RxCls", _0: [], _1: "yes" }, { $tag: "RxCls", _0: [], _1: 1 }]) {
      expect(call("regexToolFlatten", node, "root", 0, []).$tag).toBe("Err");
    }
    for (const negated of [true, false]) {
      expect(call("regexToolFlatten", { $tag: "RxCls", _0: [], _1: negated }, "root", 0, []).$tag).toBe("Ok");
    }
    expect(accepted(".").nodes[0].kind.$tag).toBe("RegexAnyCharacter");
    expect(accepted("a|b").nodes[0].kind.$tag).toBe("RegexAlternative");
    expect(accepted("ab").nodes[0].kind.$tag).toBe("RegexSequence");
  });

  test("raw input is bounded before the recursive reader, independently of simplification", () => {
    expect(accepted("()".repeat(64)).semanticNodeCount).toBe(1);
    expect(accepted("(".repeat(63) + "a" + ")".repeat(63)).semanticNodeCount).toBe(1);
    expect(refused("()".repeat(64) + "a")).toContain("128 Unicode code points");
    for (const value of [null, 2, [], {}, { source: "a" }]) expect(refused(value)).toBe("Expected regex source text.");
  });

  test("projection depth and node budgets refuse without partial success", () => {
    expect(accepted("a".repeat(65)).maximumDepth).toBe(64);
    expect(refused("a".repeat(66))).toContain("depth 64");
    const leaf = { $tag: "RxChar", _0: "a", _1: 97 };
    expect(call("regexToolFlatten", leaf, "root", 65, []).$tag).toBe("Err");
    expect(call("regexToolFlatten", leaf, "root", 0, Array(256).fill({})).$tag).toBe("Err");
  });
});
