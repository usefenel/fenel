import { describe, expect, test } from "bun:test";

// C1: run the actual PVF orchestration with controlled compiled-readiness and
// grammar results. Corpus tests below retain the real Fenel/TS AST comparison.
const source = (await Bun.file(new URL("./engine-bodies-dispatch.ts", import.meta.url)).text()).replace(/\r\n?/g, "\n");
const start = source.indexOf("export const PARSE_VIA_FENEL_FAIL =");
const end = source.indexOf("// ---------------------------------------------------------------------------\n// expr-substrate Phase 3a", start);
if (start < 0 || end < 0) throw new Error("The PVF source section is missing.");
const code = new Bun.Transpiler({ loader: "ts" }).transformSync(source.slice(start, end)).replace(/^export /gm, "");

type ParsedDriver = {
  parseViaFenelParser(source: string, options?: { mode: "interactive" | "build-verification" }): unknown;
  PARSE_VIA_FENEL_FAIL: symbol;
  ParserBuildVerificationUnavailableError: new (...args: unknown[]) => Error;
};
const entries = ["lexAll", "spliceSetBodies", "layoutTokens", "splitTopLevelDecls", "defaultFixityTable", "parseProgToks"];

function fixture(lengths: number[], options: { forced?: boolean; missing?: string; accessor?: string; namespaceThrow?: string; grammarThrow?: boolean } = {}) {
  const groups = lengths.map(length => Array.from({ length }, (_, index) => ({ t: "fixture", v: String(index) })));
  const compiledCalls: Array<{ name: string; args: unknown[] }> = [];
  const interpretedCalls: string[] = [];
  const grammarCalls: unknown[][] = [];
  const reg = {};
  function run(name: string, args: unknown[]): unknown {
    if (name === "lexAll") return args[0];
    if (name === "spliceSetBodies" || name === "layoutTokens") return [];
    if (name === "splitTopLevelDecls") return { headered: false, name: "", groups };
    if (name === "defaultFixityTable") return { revision: 0 };
    if (name === "parseProgToks") {
      grammarCalls.push(args);
      if (options.grammarThrow) throw new Error("Grammar rejected this input");
      return { $tag: "Just", _0: [{ def: { name: `declaration${grammarCalls.length}` } }] };
    }
    if (name === "applySourceFixityElements") return { revision: (args[0] as { revision: number }).revision + 1 };
    if (name === "programToFrames") return args[0];
    throw new Error(`Unexpected driver call: ${name}`);
  }
  let accessorReads = 0;
  const namespace: Record<string, unknown> = Object.fromEntries(entries.map(name => [name, (...args: unknown[]) => {
    compiledCalls.push({ name, args });
    return run(name, args);
  }]));
  if (options.accessor) Object.defineProperty(namespace, options.accessor, { get() { accessorReads++; return () => {}; } });
  const bindings = {
    dispatchEngineBody: (id: string, args: unknown[]) => { const name = id.slice(7); interpretedCalls.push(name); return run(name, args); },
    parserInterpretedForced: () => options.forced === true,
    getHarness: () => ({ reg }),
    withCompiledArtifactEvaluationSnapshot: (actual: object, callback: () => unknown) => {
      if (actual !== reg) throw new Error("The parser left its captured registry");
      return callback();
    },
    getParserNamespace: (actual: object, entry: string) => {
      if (actual !== reg) throw new Error("The parser certified a different registry");
      if (entry === `engine:${options.namespaceThrow}`) throw new Error("Compiled metadata is missing");
      return entry === `engine:${options.missing}` ? null : namespace;
    },
    shortCode: (id: string) => id.slice(7),
    marshalParsedFrames: (frames: unknown) => frames,
  };
  const driver = new Function(...Object.keys(bindings), `${code}; return { parseViaFenelParser, PARSE_VIA_FENEL_FAIL, ParserBuildVerificationUnavailableError };`)(...Object.values(bindings)) as ParsedDriver;
  return { driver, compiledCalls, interpretedCalls, grammarCalls, groups, accessorReads: () => accessorReads };
}

describe("parser declaration budgets", () => {
  test("empty input retains the interactive result and still requires compiled build readiness", () => {
    const ordinary = fixture([]);
    expect(ordinary.driver.parseViaFenelParser("")).toBeNull();
    expect(ordinary.grammarCalls).toHaveLength(0);
    for (const options of [{ forced: true }, { missing: "lexAll" }]) {
      const f = fixture([], options);
      expect(() => f.driver.parseViaFenelParser("", { mode: "build-verification" })).toThrow(f.driver.ParserBuildVerificationUnavailableError);
      expect(f.interpretedCalls).toEqual([]);
      expect(f.grammarCalls).toHaveLength(0);
    }
  });

  test("interactive default still admits 120 tokens and refuses 121 before grammar", () => {
    const allowed = fixture([120]);
    expect(allowed.driver.parseViaFenelParser("f = 1")).not.toBe(allowed.driver.PARSE_VIA_FENEL_FAIL);
    expect(allowed.grammarCalls).toHaveLength(1);
    const refused = fixture([121]);
    expect(refused.driver.parseViaFenelParser("f = 1")).toBe(refused.driver.PARSE_VIA_FENEL_FAIL);
    expect(refused.grammarCalls).toHaveLength(0);
    expect(refused.compiledCalls).toHaveLength(0);
  });

  test("build verification admits its bounded 4096-token declaration and refuses 4097", () => {
    const allowed = fixture([4096]);
    expect(allowed.driver.parseViaFenelParser("f = 1", { mode: "build-verification" })).not.toBe(allowed.driver.PARSE_VIA_FENEL_FAIL);
    expect(allowed.grammarCalls).toHaveLength(1);
    expect(allowed.interpretedCalls.filter(name => entries.includes(name))).toEqual([]);
    const refused = fixture([4097]);
    expect(refused.driver.parseViaFenelParser("f = 1", { mode: "build-verification" })).toBe(refused.driver.PARSE_VIA_FENEL_FAIL);
    expect(refused.grammarCalls).toHaveLength(0);
    expect(refused.interpretedCalls).toEqual([]);
  });

  for (const missing of entries) test(`unavailable compiled ${missing} refuses without interpreted grammar`, () => {
    const f = fixture([1087], { missing });
    expect(() => f.driver.parseViaFenelParser("f = 1", { mode: "build-verification" })).toThrow(f.driver.ParserBuildVerificationUnavailableError);
    expect(f.interpretedCalls.filter(name => entries.includes(name))).toEqual([]);
    expect(f.grammarCalls).toHaveLength(0);
  });

  test("forced interpretation, unreadable entry and missing metadata fail explicitly", () => {
    for (const options of [{ forced: true }, { accessor: "parseProgToks" }, { namespaceThrow: "parseProgToks" }]) {
      const f = fixture([1087], options);
      expect(() => f.driver.parseViaFenelParser("f = 1", { mode: "build-verification" })).toThrow(f.driver.ParserBuildVerificationUnavailableError);
      expect(f.grammarCalls).toHaveLength(0);
      expect(f.interpretedCalls.filter(name => entries.includes(name))).toEqual([]);
      expect(f.accessorReads()).toBe(0);
    }
  });

  test("compiled calls retain the argument ABI, source normalization and evolving fixity table", () => {
    const f = fixture([121, 1087]);
    const result = f.driver.parseViaFenelParser("f = 1\r\ng = 2\r", { mode: "build-verification" });
    expect(result).toEqual({ program: [{ def: { name: "declaration1" } }, { def: { name: "declaration2" } }] });
    expect(f.compiledCalls[0]?.args).toEqual(["f = 1\ng = 2\n"]);
    for (let index = 0; index < 2; index++) {
      const args = f.grammarCalls[index]!;
      expect(args[0]).toEqual({ revision: index });
      expect(args[1]).toBeNull();
      const tokens = args[2] as unknown[];
      expect(tokens.slice(1, -2)).toEqual(f.groups[index]!);
      expect(tokens[0]).toEqual({ t: "vopen", v: "", ln: 0, col: 0 });
      expect(tokens.at(-2)).toEqual({ t: "vclose", v: "", ln: 0, col: 0 });
      expect(tokens.at(-1)).toEqual({ t: "eof", v: "", ln: 0, col: 0 });
    }
  });

  test("a compiled grammar error remains a parse refusal without falling back", () => {
    const f = fixture([1087], { grammarThrow: true });
    expect(f.driver.parseViaFenelParser("f = 1", { mode: "build-verification" })).toBe(f.driver.PARSE_VIA_FENEL_FAIL);
    expect(f.interpretedCalls).toEqual([]);
  });
});

describe("compiled build-budget corpus parity", () => {
  for (const file of ["publicdemo/axioms-demo.fenel", "publicdemo/claims-demo.fenel", "std/document.fenel", "publicdemo/document-demo.fenel"]) {
    test(`whole ${file} agrees with its parser oracle`, async () => {
      const [{ parseViaFenelParser, PARSE_VIA_FENEL_FAIL }, { parse }] = await Promise.all([
        import("./engine-bodies-dispatch"), import("./fenel-parser"),
      ]);
      const text = await Bun.file(new URL(`../../../../fenel/modules/${file}`, import.meta.url)).text();
      const native = parseViaFenelParser(text, { mode: "build-verification" });
      expect(native).not.toBe(PARSE_VIA_FENEL_FAIL);
      expect(native).toEqual(JSON.parse(JSON.stringify(parse(text))));
    }, 60_000);
  }

  test("the source unit catalogue retains exact AST parity within the measured build budget", async () => {
    const [{ parseViaFenelParser, PARSE_VIA_FENEL_FAIL }, { parse }] = await Promise.all([
      import("./engine-bodies-dispatch"), import("./fenel-parser"),
    ]);
    const text = await Bun.file(new URL("../../../../fenel/modules/units/catalogue.fenel", import.meta.url)).text();
    const native = parseViaFenelParser(text, { mode: "build-verification" });
    expect(native).not.toBe(PARSE_VIA_FENEL_FAIL);
    expect(native).toEqual(JSON.parse(JSON.stringify(parse(text))));
  }, 180_000);
});
