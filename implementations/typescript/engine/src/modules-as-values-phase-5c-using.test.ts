// modules-as-values Phase 5c-1a — file-top `using`, lowercase aliases, and
// uppercase dotted names (brief `workstreams/modules-as-values/briefs/
// phase-5c-1-using-with-explicit-names.md`, section "5c-1a").
//
//   (P) both parsers: `using M (a, b)` is today's `import M (a, b)` frame and
//       `using M as A` the alias frame, any case; `import m as a` (lowercase)
//       parses; open-all and hiding `using` are refused (Phase 5b); legacy
//       `import` forms keep their frames;
//   (E) `using` in an expression or block position is a parse error in both
//       parsers; record field names and dotted segments are unaffected;
//   (R) the printer writes `using` for selected and alias frames, `import`
//       for qualified and hiding ones, and every legacy frame round-trips;
//   (C) the corpus rewrite (`import M (…)` → `using M (…)`) loads to the same
//       modules and the same registry import frames;
//   (X) two selections of one name from two sources: a load error naming both
//       (same file, across files, a directly supplied frame); a same-source
//       repeat is fine; a module's own member still wins;
//   (I) a selection naming a bundle's named instance is refused;
//   (U) uppercase dotted names: `Class.method` in argument position lowers as
//       in head position, any other dotted uppercase name is a dotted path.
//
// The Fenel grammar is interpreted (run with FENEL_PARSER_LEGACY=1): each
// Fenel-side parse costs seconds, so the cases are few and small.
// Test/tooling harness only (ts-exceptions ledger: test files).

import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { parse } from "./fenel-parser";
import {
  dispatchEngineBody,
  dispatchedJsonLogicToSyntax,
  marshalParsedFrames,
  PARSE_VIA_FENEL_FAIL,
  parseViaFenelParser,
  print,
} from "./engine-bodies-dispatch";
import { DeclarationNameError, loadFenelModule, loadFenelModuleUnion } from "./fenel-module";
import { createRegistry } from "./registry";
import type { FenelModule } from "./types";

const TO = 300_000;
const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..", "..", "..", "..");
const src = (...lines: string[]): string => lines.join("\n");

// --- the Fenel parser harness (the phase-2d loader direction) --------------
const TABLE = dispatchEngineBody("engine:defaultFixityTable", []);
const lexAll = (s: string): unknown => dispatchEngineBody("engine:lexAll", [s]);
const layoutTokens = (t: unknown): unknown => dispatchEngineBody("engine:layoutTokens", [t]);
const spliceSetBodies = (s: string, toks: unknown): unknown =>
  dispatchEngineBody("engine:spliceSetBodies", [s, toks]);
type MaybeWire = { $tag: string; _0?: unknown };

const fenelFrames = (s: string): unknown => {
  const toks = layoutTokens(spliceSetBodies(s, lexAll(s)));
  const r = dispatchEngineBody("engine:parseProgToks", [TABLE, null, toks]) as MaybeWire;
  if (r.$tag !== "Just") return { $NOTHING: s };
  return marshalParsedFrames(dispatchEngineBody("engine:programToFrames", [r._0]) as unknown[]);
};
const isFrame = (d: unknown): boolean =>
  typeof d === "object" && d !== null
  && ("def" in d || "type_sig" in d || "type_def" in d || "fixity" in d || "module_decl" in d || "import_decl" in d);
const tsFrames = (s: string): unknown[] => {
  const ast = parse(s, "en");
  if (typeof ast === "object" && ast !== null && "program" in ast) {
    return (ast as { program: unknown[] }).program.filter(isFrame);
  }
  return isFrame(ast) ? [ast] : [];
};
const fenelExpr = (s: string): MaybeWire =>
  dispatchEngineBody("engine:parseExprToks", [TABLE, null, layoutTokens(lexAll(s))]) as MaybeWire;
const fenelSyntax = (s: string): unknown => {
  const r = fenelExpr(s);
  return r.$tag === "Just" ? r._0 : { $NOTHING: s };
};
const adapterSyntax = (s: string): unknown => {
  const r = dispatchedJsonLogicToSyntax(parse(s)) as MaybeWire;
  return r.$tag === "Ok" ? r._0 : { $ERR: r };
};

const importOf = (s: string): unknown => (tsFrames(s).find((f) => "import_decl" in (f as object)) as { import_decl: unknown }).import_decl;

// ===========================================================================
// (P) both parsers read file-top `using` as the import frame
// ===========================================================================

const FRAME_CASES: { label: string; source: string; frame: Record<string, unknown> }[] = [
  { label: "using, lowercase bundle", source: "module p where\nusing std (map, fold)\nf x = x", frame: { module: "std", names: ["map", "fold"] } },
  { label: "using, uppercase names (types)", source: "module p where\nusing DrawingDemo (PointLineChart, pointLineChart)\nf x = x", frame: { module: "DrawingDemo", names: ["PointLineChart", "pointLineChart"] } },
  { label: "using, the empty list (the module editor's seed)", source: "module p where\nusing engine ()\nf x = x", frame: { module: "engine", names: [] } },
  { label: "using, a repeated name", source: "module p where\nusing std (map, map)\nf x = x", frame: { module: "std", names: ["map", "map"] } },
  { label: "using, lowercase alias", source: "module p where\nusing codec as c\nf x = x", frame: { module: "codec", as: "c" } },
  { label: "using, uppercase alias", source: "module p where\nusing Codec as C\nf x = x", frame: { module: "Codec", as: "C" } },
  { label: "import, lowercase alias (was a parse error)", source: "module p where\nimport codec as c\nf x = x", frame: { module: "codec", as: "c" } },
  { label: "import, legacy selective", source: "module p where\nimport std (map)\nf x = x", frame: { module: "std", names: ["map"] } },
  { label: "import, legacy uppercase alias", source: "module p where\nimport Telegram as Tg\nf x = x", frame: { module: "Telegram", as: "Tg" } },
  { label: "import, legacy hiding", source: "module p where\nimport Telegram hiding (run)\nf x = x", frame: { module: "Telegram", hiding: ["run"] } },
  { label: "import, legacy qualified", source: "module p where\nimport Telegram\nf x = x", frame: { module: "Telegram", qualified: true } },
  { label: "headerless using", source: "using std (map)\nf x = x", frame: { module: "std", names: ["map"] } },
];

describe("(P) file-top using — both parsers, one frame", () => {
  for (const c of FRAME_CASES) {
    test(c.label, () => {
      expect(importOf(c.source)).toEqual(c.frame);
      expect(fenelFrames(c.source)).toEqual(tsFrames(c.source));
    }, TO);
  }

  test("using M (…) and import M (…) give byte-identical frames", () => {
    expect(JSON.stringify(tsFrames("using std (map)\nf x = x"))).toBe(JSON.stringify(tsFrames("import std (map)\nf x = x")));
    expect(JSON.stringify(tsFrames("using codec as c\nf x = x"))).toBe(JSON.stringify(tsFrames("import codec as c\nf x = x")));
  });

  const REFUSED: { label: string; source: string; message: RegExp }[] = [
    { label: "open-all using (lowercase)", source: "module p where\nusing std\nf x = x", message: /`using std` without names is not available yet.*Phase 5b/ },
    { label: "open-all using (uppercase)", source: "module p where\nusing Telegram\nf x = x", message: /`using Telegram` without names.*Phase 5b/ },
    { label: "using with hiding (lowercase)", source: "module p where\nusing std hiding (map)\nf x = x", message: /`using std hiding \(…\)` is not available yet.*Phase 5b/ },
    { label: "using with hiding (uppercase)", source: "module p where\nusing Telegram hiding (run)\nf x = x", message: /`using Telegram hiding \(…\)` is not available yet.*Phase 5b/ },
  ];
  for (const c of REFUSED) {
    test(`refused in both: ${c.label}`, () => {
      expect(() => parse(c.source)).toThrow(c.message);
      expect(fenelFrames(c.source)).toEqual({ $NOTHING: c.source });
    }, TO);
  }

  test("a lowercase bare or hiding import is still not an import frame", () => {
    expect(() => parse("module p where\nimport codec\nf x = x")).toThrow();
    expect(() => parse("module p where\nimport codec hiding (x)\nf x = x")).toThrow();
  });

  test("a definition named like the keywords still parses as a definition", () => {
    // `import x as y = …` / `using x y = …` are definitions, never import lines.
    for (const [source, name, params] of [
      ["import x as y = x", "import", ["x", "as", "y"]],
      ["using x y = x", "using", ["x", "y"]],
    ] as const) {
      expect(tsFrames(source)).toHaveLength(1);
      expect(tsFrames(source)[0]).toMatchObject({ def: { name, params, body: { var: "x" } } });
      expect(fenelFrames(source)).toEqual(tsFrames(source));
    }
  }, TO);
});

// ===========================================================================
// (B) one declaration boundary for import and using lines (astra review of
//     5c-1a, finding 3). The Fenel grammar is the source of truth: its layout
//     pass continues a line whose tokens are indented past the declaration's
//     column, and comments are whitespace, so the TS mirror reads such a line
//     as one declaration too. An explicit `;` between top-level declarations
//     is outside the Fenel declaration grammar for EVERY declaration kind (a
//     standing fence: `f : Number; f = 1` fails there as well), so the public
//     path (parsedViaCache: the Fenel parser, then the TS fallback on a
//     failure) serves it from the TS parser, for `import` and `using` alike.
// ===========================================================================

/** The parse-cache miss path of `parsedViaCache`: the Fenel parser drives and
 *  the TS parser serves the sources it does not cover. */
const publicParse = (s: string): unknown => {
  const fen = parseViaFenelParser(s);
  return fen === PARSE_VIA_FENEL_FAIL ? parse(s) : fen;
};

describe("(B) import and using lines: one declaration boundary in both parsers", () => {
  const H = "module p where\n";
  const DEF = { def: { name: "f", params: ["x"], body: { var: "x" } } };
  const prog = (frame: Record<string, unknown>): unknown => ({ program: [{ module_decl: { name: "p" } }, { import_decl: frame }, DEF] });
  const CONTINUED: [string, string, Record<string, unknown>][] = [
    ["using: the alias on the next line", `${H}using codec as\n  c\nf x = x`, { module: "codec", as: "c" }],
    ["using: `as c` on the next line", `${H}using codec\n  as c\nf x = x`, { module: "codec", as: "c" }],
    ["using: the name list on the next line, past a comment line", `${H}using std\n  -- the names\n  (map)\nf x = x`, { module: "std", names: ["map"] }],
    ["import (legacy): `as C` on the next line", `${H}import Codec\n  as C\nf x = x`, { module: "Codec", as: "C" }],
    ["import (legacy): the name list on the next line", `${H}import Codec\n  (x)\nf x = x`, { module: "Codec", names: ["x"] }],
    ["using: a comment after the line and inside the list", `${H}using std (map, -- one\n  fold) -- two\nf x = x`, { module: "std", names: ["map", "fold"] }],
  ];
  for (const [label, source, frame] of CONTINUED) {
    test(`continued line, both parsers: ${label}`, () => {
      expect(parse(source) as unknown).toEqual(prog(frame));
      expect(parseViaFenelParser(source)).toEqual(prog(frame));
    }, TO);
  }

  test("a continued open-all or hiding using is refused by both", () => {
    for (const source of [`${H}using codec\n  hiding (x)\nf x = x`, `${H}using codec\n  -- nothing\nf x = x`]) {
      expect(() => parse(source)).toThrow(/is not available yet/);
      expect(parseViaFenelParser(source)).toBe(PARSE_VIA_FENEL_FAIL);
    }
  }, TO);

  test("a line at the declaration column ends the import line in both", () => {
    const source = `${H}using codec\nas c = c\nf x = x`;
    expect(() => parse(source)).toThrow(/`using codec` without names/);
    expect(parseViaFenelParser(source)).toBe(PARSE_VIA_FENEL_FAIL);
  }, TO);

  test("an explicit `;`: the TS parser reads it, the public path serves it the same, for import and using alike", () => {
    for (const [source, frame] of [
      [`${H}using codec as c; f x = x`, { module: "codec", as: "c" }],
      [`${H}import codec as c; f x = x`, { module: "codec", as: "c" }],
      [`${H}using std (map); f x = x`, { module: "std", names: ["map"] }],
      [`${H}import Codec as C;\nf x = x`, { module: "Codec", as: "C" }],
    ] as const) {
      expect(parse(source) as unknown).toEqual(prog(frame));
      expect(publicParse(source)).toEqual(prog(frame));
    }
    // The fence is the Fenel grammar's for every declaration kind, not the import line's.
    expect(parseViaFenelParser(`${H}using codec as c; f x = x`)).toBe(PARSE_VIA_FENEL_FAIL);
    expect(parseViaFenelParser(`${H}f : Number; f = 1`)).toBe(PARSE_VIA_FENEL_FAIL);
  }, TO);
});

// ===========================================================================
// (E) `using` is reserved in expression and block positions
// ===========================================================================

describe("(E) block and expression using is a parse error in both parsers", () => {
  const MESSAGE = /block and expression `using` is not available yet; write `telegram\.sendMessage`, or open names at the file top/;
  const EXPRS = [
    "using telegram (sendMessage) in sendMessage 1",
    "f using",
    "using",
    "do\n  using telegram (sendMessage)\n  sendMessage 1",
  ];
  for (const e of EXPRS) {
    test(`expression ${JSON.stringify(e)}`, () => {
      expect(() => parse(e)).toThrow(MESSAGE);
      expect(fenelExpr(e).$tag).toBe("Nothing");
    }, TO);
  }

  // astra review of 5c-1a, finding 4: a backtick call is a call head too, so
  // `using` may not be spelled there either (it printed as `using 1 2`, which
  // reparsing rejected).
  for (const e of ["1 `using` 2", "f (1 `using` 2)", "1 + 2 `using` 3"]) {
    test(`backtick call ${JSON.stringify(e)}`, () => {
      expect(() => parse(e)).toThrow(MESSAGE);
      expect(fenelExpr(e).$tag).toBe("Nothing");
    }, TO);
  }

  test("other backtick calls parse, print and reparse identically in both parsers", () => {
    for (const e of ["1 `div` 2", "f (1 `div` 2)", "r.using `max` 2"]) {
      const ast = parse(e);
      expect(parse(print(ast as never))).toEqual(ast);
      expect(fenelSyntax(e)).toEqual(adapterSyntax(e));
    }
  }, TO);

  test("a definition body", () => {
    const s = "module p where\nf x = using t (a) in a x";
    expect(() => parse(s)).toThrow(MESSAGE);
    expect(fenelFrames(s)).toEqual({ $NOTHING: s });
  }, TO);

  test("record field names and dotted segments are unaffected", () => {
    for (const e of ["{ using = 1 }", "r.using", "f r.using 2"]) {
      expect(fenelSyntax(e)).toEqual(adapterSyntax(e));
    }
    expect(parse("{ using = 1 }")).toEqual({ using: 1 });
    expect(parse("r.using")).toEqual({ var: "r.using" });
  }, TO);
});

// ===========================================================================
// (R) printing
// ===========================================================================

describe("(R) the printer: using for selected and alias frames, import otherwise", () => {
  const PRINTED: [string, string][] = [
    ["import std (map)", "using std (map)"],
    ["using std (map, fold)", "using std (map, fold)"],
    ["using engine ()", "using engine ()"],
    ["import std (map, map)", "using std (map, map)"],
    ["import codec as c", "using codec as c"],
    ["import Telegram as Tg", "using Telegram as Tg"],
    ["import Telegram hiding (run)", "import Telegram hiding (run)"],
    ["import Telegram hiding ()", "import Telegram hiding ()"],
    ["import Telegram", "import Telegram"],
  ];
  for (const [written, printed] of PRINTED) {
    test(`${written} prints as ${printed} and round-trips`, () => {
      const source = `module p where\n${written}\nf x = x`;
      const out = print(parse(source));
      expect(out.split("\n")).toContain(printed);
      expect(out).not.toContain(`${printed.startsWith("using") ? "import" : "using"} `);
      expect(parse(out)).toEqual(parse(source));
    });
  }

  test("a directly built frame prints the same way (the module editor's path)", () => {
    expect(print({ program: [{ import_decl: { module: "engine", names: [] } }] } as never).trim()).toBe("using engine ()");
    expect(print({ program: [{ import_decl: { module: "codec", as: "c" } }] } as never).trim()).toBe("using codec as c");
    expect(print({ program: [{ import_decl: { module: "Telegram", qualified: true } }] } as never).trim()).toBe("import Telegram");
  });
});

// ===========================================================================
// (C) the corpus rewrite loads to the same modules and registry import frames
// ===========================================================================

const CORPUS_USING_FILES = [
  "fenel/examples/image-demo.fenel",
  "fenel/modules/publicdemo/check-demo.fenel",
  "fenel/modules/publicdemo/drawing-demo.fenel",
  "fenel/modules/publicdemo/locale-demo.fenel",
  "fenel/modules/publicdemo/statistics-demo.fenel",
  "fenel/modules/publicdemo/statistics-types.fenel",
];

describe("(C) the corpus rewrite changes no frame", () => {
  const read = (file: string): string => readFileSync(join(ROOT, file), "utf8");
  const legacy = (source: string): string => source.replace(/^using (\S+ \()/gm, "import $1");

  test("the corpus has twelve file-top using lines and no import (…) line left", () => {
    const sources = CORPUS_USING_FILES.map(read);
    expect(sources.map((s) => (s.match(/^using \S+ \(/gm) ?? []).length)).toEqual([1, 1, 3, 2, 3, 2]);
    for (const s of sources) expect(s).not.toMatch(/^import \S+ \(/m);
  });

  test("each file loads to the same module as its legacy import spelling", () => {
    for (const file of CORPUS_USING_FILES) {
      const source = read(file);
      expect(legacy(source)).not.toBe(source);
      const now = loadFenelModule(source, file);
      const before = loadFenelModule(legacy(source), file);
      expect(JSON.stringify(now)).toBe(JSON.stringify(before));
    }
  }, TO);

  test("the statistics module (three files) builds the same registry import frames", () => {
    const files = [
      "fenel/modules/publicdemo/statistics-types.fenel",
      "fenel/modules/publicdemo/statistics-inputs.fenel",
      "fenel/modules/publicdemo/statistics-demo.fenel",
    ];
    const frames = (rewrite: (s: string) => string): unknown => {
      const modules = loadFenelModuleUnion(files.map((file) => ({ src: rewrite(read(file)), name: "StatisticsDemo" })));
      const reg = createRegistry(modules);
      return modules.map((m) => ({
        name: m.name,
        imports: m.imports,
        frame: reg.getModuleImportFrame(m.name),
      }));
    };
    expect(JSON.stringify(frames((s) => s))).toBe(JSON.stringify(frames(legacy)));
  }, TO);
});

// ===========================================================================
// (X) selection conflicts
// ===========================================================================

describe("(X) one name selected from two sources is an error naming both", () => {
  const conflictMessage = (fn: () => unknown): string => {
    try {
      fn();
    } catch (error) {
      return String((error as Error).message);
    }
    throw new Error("expected a load error");
  };

  test("in one file", () => {
    const message = conflictMessage(() => loadFenelModule(src(
      "module m5c where",
      "using std (map)",
      "using picture (map)",
      "f x = x",
    ), "a.fenel"));
    expect(message).toContain('"map" is selected from two sources: std (declaration 2 in a.fenel) and picture (declaration 3 in a.fenel)');
    expect(message).toContain("write the other as picture.map");
  });

  test("across two files of one module", () => {
    expect(() => loadFenelModuleUnion([
      { src: src("module m5c where", "using std (map)", "f x = x"), name: "a.fenel" },
      { src: src("module m5c where", "g x = x"), name: "b.fenel" },
    ])).not.toThrow();
    const message = conflictMessage(() => loadFenelModuleUnion([
      { src: src("module m5c where", "using std (map)", "f x = x"), name: "a.fenel" },
      { src: src("module m5c where", "import picture (fold, map)", "g x = x"), name: "b.fenel" },
    ]));
    expect(message).toContain('"map" is selected from two sources: std (declaration 2 in a.fenel) and picture (declaration 2 in b.fenel)');
  });

  test("in a directly supplied frame (registry ingress)", () => {
    const direct: FenelModule = {
      name: "m5c",
      label: "m5c",
      imports: [{ module: "std", names: ["map"] }, { module: "picture", names: ["map"] }],
    } as FenelModule;
    expect(() => createRegistry([direct])).toThrow(/"map" is selected from two sources: std and picture/);
  });

  // astra review of 5c-1a, finding 2: the ingress rule covers every supplied
  // fragment of one effective module, as loadFenelModuleUnion does.
  test("across two directly supplied fragments of one module (registry ingress)", () => {
    const fragment = (module: string, names: string[], fn: string, owner = "m5c"): FenelModule => ({
      ...loadFenelModule(src(`module ${owner} where`, `${fn} x = x`), `${fn}.fenel`),
      imports: [{ module, names }],
    } as FenelModule);
    expect(() => createRegistry([fragment("std", ["map"], "f"), fragment("picture", ["map"], "g")])).toThrow(
      /"map" is selected from two sources: std \(registry modules\[\d+\]\) and picture \(registry modules\[\d+\]\)/,
    );
    // A same-source repeat across fragments, and distinct names, stay fine.
    expect(() => createRegistry([fragment("std", ["map"], "f"), fragment("std", ["map"], "g")])).not.toThrow();
    expect(() => createRegistry([fragment("std", ["map"], "f"), fragment("picture", ["fold"], "g")])).not.toThrow();
    // Fragments of DIFFERENT modules never clash.
    expect(() => createRegistry([fragment("std", ["map"], "f"), fragment("picture", ["map"], "g", "n5c")])).not.toThrow();
  });

  test("the same name from the same source twice is fine", () => {
    expect(() => loadFenelModule(src("module m5c where", "using std (map)", "import std (map, fold)", "f x = x"), "a.fenel")).not.toThrow();
    expect(() => loadFenelModuleUnion([
      { src: src("module m5c where", "using std (map)", "f x = x"), name: "a.fenel" },
      { src: src("module m5c where", "using std (map)", "g x = x"), name: "b.fenel" },
    ])).not.toThrow();
    expect(() => createRegistry([{
      name: "m5c",
      label: "m5c",
      imports: [{ module: "std", names: ["map"] }, { module: "std", names: ["map", "fold"] }],
    } as FenelModule])).not.toThrow();
  });

  test("a module's own member still wins over a selection", () => {
    const lib = loadFenelModule(src("module lib5c where", "twice x = x"), "lib5c");
    const own = loadFenelModule(src("module own5c where", "using lib5c (twice)", "twice x = x", "f x = twice x"), "own5c");
    const reg = createRegistry([lib, own]);
    const frame = reg.getModuleImportFrame("own5c") as { names: Record<string, string> };
    expect(frame.names.twice).toBe("own5c:twice");
  });

  test("the conflict error is a DeclarationNameError", () => {
    let caught: unknown;
    try {
      loadFenelModule(src("using std (map)", "using picture (map)", "f x = x"), "a.fenel");
    } catch (error) {
      caught = error;
    }
    expect(caught).toBeInstanceOf(DeclarationNameError);
    expect((caught as DeclarationNameError).errors.map((e) => e.$tag)).toEqual(["SelectionConflict"]);
  });
});

// ===========================================================================
// (I) a selection naming a named instance is refused
// ===========================================================================

describe("(I) a file-top selection opens functions and types, never a named instance", () => {
  const SHAPE_TYPE = src("module shapes5c where", "Shape a = Shape name: String size: a");
  const instances: FenelModule = {
    name: "shapebox5c",
    label: "shapebox5c",
    instances: loadFenelModule(
      src("sq : Shape Number", 'sq = Shape { name = "sq", size = 4 }'),
      "shapebox5c",
      { dispatchInstanceFile: true },
    ).instances ?? [],
  } as FenelModule;
  const helpers = loadFenelModule(src("module shapebox5c where", "area s = s"), "shapebox5c-fns");

  test("selecting the instance is a registry load error with a clear message", () => {
    const user = loadFenelModule(src("module user5c where", "using shapebox5c (sq)", "f x = x"), "user5c");
    expect(() => createRegistry([loadFenelModule(SHAPE_TYPE, "shapes5c"), instances, helpers, user])).toThrow(
      /using shapebox5c \(sq\): shapebox5c\.sq is a named instance, not a function or a type/,
    );
  });

  test("selecting a function of the same bundle still works, and a miss stays a lazy carrier", () => {
    const user = loadFenelModule(src("module user5c where", "using shapebox5c (area, nosuch)", "f x = area x"), "user5c");
    const reg = createRegistry([loadFenelModule(SHAPE_TYPE, "shapes5c"), instances, helpers, user]);
    const frame = reg.getModuleImportFrame("user5c") as { names: Record<string, string> };
    expect(frame.names.area).toBe("shapebox5c:area");
    expect(frame.names.nosuch).toBe("shapebox5c:nosuch");
  });

  // astra review of 5c-1a, finding 1: a name bound to BOTH a function and a
  // named instance of one bundle is ambiguous (design/module-system.md §4, the
  // 5a member index's rule); the selection must not silently pick the function.
  test("a name that is both a function and a named instance of one bundle is refused as ambiguous", () => {
    const twiceFns = loadFenelModule(src("module twice5c where", "dup x = x"), "twice5c-fns");
    const twiceInstances: FenelModule = {
      name: "twice5c",
      label: "twice5c",
      instances: loadFenelModule(
        src("dup : Shape Number", 'dup = Shape { name = "sq", size = 4 }'),
        "twice5c",
        { dispatchInstanceFile: true },
      ).instances ?? [],
    } as FenelModule;
    const user = loadFenelModule(src("module user5c where", "using twice5c (dup)", "f x = dup x"), "user5c");
    const build = (): unknown => createRegistry([loadFenelModule(SHAPE_TYPE, "shapes5c"), twiceFns, twiceInstances, user]);
    expect(build).toThrow(/using twice5c \(dup\): twice5c\.dup is ambiguous: the bundle twice5c binds dup to 2 targets/);
    expect(build).toThrow(/the function twice5c:dup/);
    expect(build).toThrow(/the instance dup : Shape/);
    // Without the selection the bundle loads, and the member index agrees.
    const reg = createRegistry([loadFenelModule(SHAPE_TYPE, "shapes5c"), twiceFns, twiceInstances]);
    expect(reg.resolveModuleMember("twice5c", "dup").kind).toBe("ambiguous");
    // The public frame builder refuses the same selection.
    expect(() => reg.buildImportFrame([{ module: "twice5c", names: ["dup"] }])).toThrow(/twice5c\.dup is ambiguous/);
  }, TO);
});

// ===========================================================================
// (U) uppercase dotted names
// ===========================================================================

describe("(U) uppercase dotted names: never a constructor tag", () => {
  const CASES: [string, unknown][] = [
    ["id Telegram.sendMessage", { call: ["id", { method: ["Telegram", "sendMessage"] }] }],
    ["id Monad.bind", { call: ["id", { method: ["Monad", "bind"] }] }],
    ["fmap Iso.decode x", { call: ["fmap", { method: ["Iso", "decode"] }, { var: "x" }] }],
    ["Telegram.Update", { var: "Telegram.Update" }],
    ["id Telegram.Update", { call: ["id", { var: "Telegram.Update" }] }],
    ["Telegram.isoBase64.decode x", { call: ["Telegram.isoBase64.decode", { var: "x" }] }],
    ["id DrawingDemo.Point.x", { call: ["id", { var: "DrawingDemo.Point.x" }] }],
    ["Telegram.Update ()", { call: ["Telegram.Update"] }],
    // Unchanged neighbours.
    ["Telegram.sendMessage x", { method: ["Telegram", "sendMessage", { var: "x" }] }],
    ["Just True", { construct: ["Just", { construct: ["True"] }] }],
    ["f Nothing", { call: ["f", { construct: ["Nothing"] }] }],
    // A record argument with a `var` field is not a name (type-to-set.fenel's
    // `SeMu { var = name, body = body }` crashed the TS argument lift).
    ["SeMu { var = name, body = b }", { construct: ["SeMu", { var: { var: "name" }, body: { var: "b" } }] }],
    // astra review of 5c-1a, finding 6: only a NAME lifts. A record literal
    // whose `var` field holds a string is a record in both parsers, in
    // argument and in head position (the TS lift used to read it as the name).
    ['f { var = "Monad.bind", body = 1 }', { call: ["f", { var: "Monad.bind", body: 1 }] }],
    ['f { var = "Foo", body = 1 }', { call: ["f", { var: "Foo", body: 1 }] }],
    ['f ({ var = "Foo", body = 1 })', { call: ["f", { var: "Foo", body: 1 }] }],
    ['{ var = "Monad.bind", body = 1 }', { var: "Monad.bind", body: 1 }],
    ['{ var = "Foo", body = 1 }', { var: "Foo", body: 1 }],
    // A parenthesised name is still a name.
    ["(f) x", { call: ["f", { var: "x" }] }],
    ["f (Foo)", { call: ["f", { construct: ["Foo"] }] }],
  ];
  for (const [source, expected] of CASES) {
    test(source, () => {
      expect(parse(source) as unknown).toEqual(expected);
      expect(fenelSyntax(source)).toEqual(adapterSyntax(source));
    }, TO);
  }
});
