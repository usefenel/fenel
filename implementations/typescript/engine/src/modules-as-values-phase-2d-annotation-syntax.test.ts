// modules-as-values Phase 2d — the annotation SURFACE `( Expr : Type )` (plan
// decision 9, brief `workstreams/modules-as-values/briefs/
// phase-2d-types-at-the-call-site.md`). One colon, ONE parenthesised
// expression, lowering to `{ann: [e, T]}` with T a real FenelType in both
// parsers; `::` is not syntax; `SAnn` joins the Syntax ADT (desugar transparent
// except over a qualified method call, which the compiler boundary rejects);
// the adapter carries the type opaquely; the printer prints `(e : T)` with the
// real type printer, and every printed type re-parses.
//
// Families (both parsers must agree on every input):
//   • TS parser shapes + rejections (`::`, `(a, b : T)`), unchanged neighbours;
//   • the Fenel grammar's rejections;
//   • PARITY — one annotation-type language: every type both accept alike,
//     every type both refuse (the TS arm reads the grammar's TyExpr, strictly);
//   • SYNTAX SPACE — grammar Syntax vs `jsonLogicToSyntax(parse src)`, the
//     annotation types compared after the loader marshal (the grammar carries
//     its `{mk}` marker, the adapter the JsonLogic image of the FenelType);
//   • LOADER DIRECTION — marshalParsedFrames(programToFrames(parseProgToks))
//     vs the TS parser's frames (byte-equal bodies, the `$`-keyed type
//     authored by marshalPatterns' ann arm);
//   • round trips parse → print → parse through BOTH parsers (and the
//     printer's type surface);
//   • desugar / jsonLogicToExpr / normaliseToCore (the compiler entry), the
//     adapter, inference.
// Test/tooling harness only (ts-exceptions ledger: test files).

import { describe, it, expect } from "vitest";
import { parse } from "./fenel-parser";
import {
  dispatchEngineBody,
  dispatchedJsonLogicToExpr,
  dispatchedJsonLogicToSyntax,
  dispatchedNormaliseToCore,
  marshalParsedFrames,
  marshalPatterns,
  print,
} from "./engine-bodies-dispatch";
import { positionalCompileFieldSlots } from "./compile-field-slots";

const TO = 180000;
const BS = String.fromCharCode(92);

// --- the Fenel parser harness (mirrors fenel-expr-grammar / fenel-syntax-marshal)
const TABLE = dispatchEngineBody("engine:defaultFixityTable", []);
const lexAll = (s: string): unknown => dispatchEngineBody("engine:lexAll", [s]);
const layoutTokens = (t: unknown): unknown => dispatchEngineBody("engine:layoutTokens", [t]);
const spliceSetBodies = (src: string, toks: unknown): unknown =>
  dispatchEngineBody("engine:spliceSetBodies", [src, toks]);

type MaybeWire = { $tag: string; _0?: unknown };

const fenelExpr = (src: string): MaybeWire =>
  dispatchEngineBody("engine:parseExprToks", [TABLE, null, layoutTokens(lexAll(src))]) as MaybeWire;

const fenelSyntax = (src: string): unknown => {
  const r = fenelExpr(src);
  return r.$tag === "Just" ? r._0 : { $NOTHING: src };
};

const adapterSyntax = (src: string): unknown => {
  const r = dispatchedJsonLogicToSyntax(parse(src)) as MaybeWire;
  return r.$tag === "Ok" ? r._0 : { $ERR: r };
};

// The annotation type of one SAnn node, as the loader marshal authors it:
// syntaxToJsonLogic (value-expression args lowered Fenel-side) then the TS
// marshal's ann arm (a `{mk}` marker ⇒ walkType; a JsonLogic image ⇒ the raw
// type). Both sides of the Syntax-space differential go through it.
const annTypeOf = (sann: unknown): unknown => {
  const jl = marshalPatterns(dispatchEngineBody("engine:syntaxToJsonLogic", [sann])) as {
    ann: [unknown, unknown];
  };
  return jl.ann[1];
};

// Replace every SAnn's `type` by its marshalled FenelType (deep).
function normaliseAnnotations(node: unknown): unknown {
  if (Array.isArray(node)) return node.map(normaliseAnnotations);
  if (node === null || typeof node !== "object") return node;
  const o = node as Record<string, unknown>;
  const out: Record<string, unknown> = {};
  for (const k of Object.keys(o)) out[k] = normaliseAnnotations(o[k]);
  if (o.$tag === "SAnn") out.type = annTypeOf(node);
  return out;
}

// The loader direction (fenel-syntax-marshal FAMILY 1's oracle).
const prepToks = (src: string): unknown => layoutTokens(spliceSetBodies(src, lexAll(src)));
const fenelFrames = (src: string): unknown => {
  const r = dispatchEngineBody("engine:parseProgToks", [TABLE, null, prepToks(src)]) as MaybeWire;
  if (r.$tag !== "Just") return { $NOTHING: src };
  return marshalParsedFrames(dispatchEngineBody("engine:programToFrames", [r._0]) as unknown[]);
};
function flattenProgram(ast: unknown): unknown[] {
  if (ast == null) return [];
  const isFrame = (d: unknown): boolean =>
    typeof d === "object" &&
    d !== null &&
    ("def" in d || "type_sig" in d || "type_def" in d || "fixity" in d || "module_decl" in d || "import_decl" in d);
  if (typeof ast === "object" && "program" in (ast as object))
    return (ast as { program: unknown[] }).program.filter(isFrame);
  return isFrame(ast) ? [ast] : [];
}
const tsFrames = (src: string): unknown[] => flattenProgram(parse(src, "en"));

const ref = (name: string) => ({ $ref: name });

// =========================================================================
// TS parser — the surface
// =========================================================================
describe("Phase 2d surface — TS parser", () => {
  it("(x : T) lowers to {ann:[e, T]} with a FenelType, never a bare string", () => {
    expect(parse("(x : String)")).toEqual({ ann: [{ var: "x" }, ref("String")] });
    expect(parse("(1 + 2 : Number)")).toEqual({ ann: [{ call: ["add", 1, 2] }, ref("Number")] });
    expect(parse("(x : Fenel.Type)")).toEqual({ ann: [{ var: "x" }, ref("Fenel.Type")] });
  });

  it("a qualified method call keeps its {method} shape under the annotation", () => {
    const ast = parse("(Iso.decode s : Result String Bytes)") as { ann: [unknown, unknown] };
    expect(ast.ann[0]).toEqual({ method: ["Iso", "decode", { var: "s" }] });
    expect(ast.ann[1]).toMatchObject({ $variant: {} });
    expect(ast.ann[1]).toEqual((parse("(y : Result<String, Bytes>)") as { ann: [unknown, unknown] }).ann[1]);
  });

  it("the type is the TyExpr grammar's: arrows, records, generics, value-dependent args", () => {
    const t = (src: string) => (parse(src) as { ann: [unknown, unknown] }).ann[1];
    expect(t("(f : Int -> Bool)")).toMatchObject({ $arrow: { returns: ref("Bool") } });
    expect(t("(r : { a: Int })")).toMatchObject({ $record: { fields: [{ name: "a", type: ref("Int") }] } });
    expect(t("(x : Vec a 3)")).toEqual({ $el: { call: ["Vec", ref("a"), 3] } });
    expect(t("(x : schemaOf typeId)")).toEqual({ $el: { call: ["schemaOf", { var: "typeId" }] } });
    expect(t("(x : Type)")).toEqual({ $type: true });
  });

  it("`::` is not syntax any more (the token stays reserved)", () => {
    expect(() => parse("x :: String")).toThrow();
    expect(() => parse("(x :: String)")).toThrow();
    expect(() => parse("1 + 2 :: Number")).toThrow();
  });

  it("a refinement is not an annotation type, and the error says so", () => {
    expect(() => parse("(x : Int where value > 0)")).toThrow(/cannot be a refinement/);
    expect(() => parse("(x : (where: Int) -> Int)")).not.toThrow(/refinement/);
    expect(() => parse("(x : (where: Int) -> Int)")).toThrow();
  });

  it("an argument read both as a type and as a value does not multiply the parses", () => {
    // `(A)` is a parenthesised type and a parenthesised value expression; the
    // parser keeps the first parse per end position, so n such arguments cost
    // polynomial time (a list of every parse took 2^n: ~0.4 s at n = 18).
    const n = 24;
    const src = `(x : F ${Array(n).fill("(A)").join(" ")})`;
    parse("(x : F (A))");
    const t0 = performance.now();
    const ast = parse(src) as { ann: [unknown, { $el: { call: unknown[] } }] };
    const ms = performance.now() - t0;
    expect(ast.ann[1].$el.call).toEqual(["F", ...Array(n).fill(ref("A"))]);
    expect(ms).toBeLessThan(250);
  });

  it("only a single expression: (a, b : T) and (a : T, b) are parse errors", () => {
    expect(() => parse("(a, b : Int)")).toThrow();
    expect(() => parse("(a : Int, b)")).toThrow();
  });

  it("neighbouring paren forms parse exactly as before", () => {
    expect(parse("(1, 2)")).toEqual({ tuple: [1, 2] });
    expect(parse("(+)")).toEqual({ fn: ["a", "b", { call: ["add", { var: "a" }, { var: "b" }] }] });
    expect(parse("()")).toBeNull();
    expect(parse("(f x)")).toEqual({ call: ["f", { var: "x" }] });
    expect(parse("read(String)")).toEqual({ call: ["read", { schema: { type: "string" } }] });
    expect(parse(BS + "x -> x")).toEqual({ fn: ["x", { var: "x" }] });
    // a signature is still `name : T` at statement level
    expect((parse("f : Int -> Int") as { type_sig: { name: string } }).type_sig.name).toBe("f");
  });
});

// =========================================================================
// Fenel grammar — rejections
// =========================================================================
describe("Phase 2d surface — the Fenel grammar rejects what the TS parser rejects", () => {
  for (const src of ["x :: String", "(x :: String)", "(a, b : Int)", "(a : Int, b)"]) {
    it(`Nothing for ${JSON.stringify(src)}`, () => {
      expect(fenelExpr(src).$tag).toBe("Nothing");
    }, TO);
  }
});

// =========================================================================
// PARITY — one annotation-type language. The Fenel grammar's TyExpr is the
// source of truth; the TS annotation arm reads its type with the strict
// mirror `parseAnnotationType` (never the wider declaration `parseTypeExpr`).
// Every input is accepted by BOTH with the same `{ann:[e, T]}`, or refused by
// BOTH (the grammar: no parse, or — for a string in angle brackets anywhere but
// `EntityRef<"X">` — the loader marshal's refusal).
// =========================================================================

// The grammar route, end to end: parse, lower Fenel-side, marshal the `$`-keys.
// Throws when the marshal refuses; `undefined` when the grammar has no parse.
const grammarJsonLogic = (src: string): unknown => {
  const r = fenelExpr(src);
  if (r.$tag !== "Just") return undefined;
  return marshalPatterns(dispatchEngineBody("engine:syntaxToJsonLogic", [r._0]));
};
const grammarRefuses = (src: string): boolean => {
  try {
    return grammarJsonLogic(src) === undefined;
  } catch {
    return true;
  }
};

describe("Phase 2d surface — parity: both parsers refuse the same annotation types", () => {
  const BOTH_REJECT: string[] = [
    // a refinement: TyExpr has no `where` arm
    "(x : Int where value > 0)",
    "(x : Maybe (Int where value > 0))",
    // unit / a named paren list without an arrow / the nullary arrow
    "(x : ())",
    "(x : (a: Int))",
    "(x : () -> Int)",
    // a keyword (or a Bool literal) as a parameter or field name
    "(x : (where: Int) -> Int)",
    "(x : (n: Int, in: Int) -> Int)",
    "(x : (true: Int) -> Int)",
    "(x : {end: Int})",
    // only a name heads an application
    "(x : [Int] Int)",
    "(x : (Maybe) Int)",
    "(x : {a: Int} Int)",
    "(x : [Int]<Bool>)",
    // angle arguments are types (or EntityRef's one entity name), comma-separated
    "(x : Vec<a, 3>)",
    "(x : Map<K,>)",
    '(x : Tagged<UUID, "user">)',
    '(x : f<"s">)',
    "(x : EntityRef<Int>)",
    // separators are commas, never optional, never trailing in a param list
    "(x : {a: Int b: Int})",
    "(x : (a: Int,) -> Bool)",
    // `>>` lexes as one operator
    "(x : Maybe<List<Int>>)",
    // a value argument is a whole parenthesised expression
    "(x : Vec a (n : Int))",
  ];
  for (const src of BOTH_REJECT) {
    it(src, () => {
      expect(() => parse(src)).toThrow();
      expect(grammarRefuses(src)).toBe(true);
    }, TO);
  }
});

describe("Phase 2d surface — parity: both parsers read the same annotation types alike", () => {
  const annType = (src: string): unknown => (parse(src) as { ann: [unknown, unknown] }).ann[1];
  const BOTH_ACCEPT: { src: string; type?: unknown }[] = [
    // a lowercase-headed application is value-dependent in BOTH spellings
    { src: "(x : f<a>)", type: { $el: { call: ["f", { var: "a" }] } } },
    { src: "(x : f a)", type: { $el: { call: ["f", { var: "a" }] } } },
    // a bare arrow parameter is an application, so `(A -> B, C)` is ONE tuple
    // parameter; a parenthesised arrow makes two parameters
    { src: "(x : (A -> B, C) -> D)" },
    { src: "(x : ((A -> B), C) -> D)" },
    // named and positional parameters mix
    { src: "(x : (a: Int, B) -> C)" },
    { src: "(x : Maybe {a: Int})" },
    { src: '(x : EntityRef<"profile">)' },
    { src: '(x : EntityRef "profile")' },
    { src: "(x : {a: Int,})" },
    { src: "(x : {})" },
    { src: "(x : Type a)", type: { $el: { call: ["Type", ref("a")] } } },
    { src: "(x :\n  Maybe\n  Int)" },
    { src: "(x : Maybe<List<Int> >)" },
    { src: "(x : Vec a (n))" },
    { src: "(x : Vec a (Maybe b))" },
    // `(A)` reads as a type and as a value: the type reading wins, in order
    { src: "(x : F (A) (A) (A) (A))", type: { $el: { call: ["F", ref("A"), ref("A"), ref("A"), ref("A")] } } },
    { src: '(x : Infixable "std.add")', type: { $el: { call: ["Infixable", "std.add"] } } },
    { src: "(x : f (g x))", type: { $el: { call: ["f", { $el: { call: ["g", { var: "x" }] } }] } } },
    // a nested annotation inside a value argument (the loader marshal walks it)
    {
      src: "(x : Vec Int ((n : Int) + 1))",
      type: { $el: { call: ["Vec", ref("Int"), { call: ["add", { ann: [{ var: "n" }, ref("Int")] }, 1] }] } },
    },
    { src: "(x : Vec Int (if (b : Bool) then 1 else 0))" },
    { src: "(x : Vec Int (g (" + BS + "y -> (y : Int))))" },
  ];
  for (const { src, type } of BOTH_ACCEPT) {
    it(src, () => {
      const ts = parse(src);
      if (type !== undefined) expect(annType(src)).toEqual(type);
      expect(grammarJsonLogic(src)).toEqual(ts);
    }, TO);
  }
});

// =========================================================================
// SYNTAX SPACE — grammar vs adapter (annotation types after the marshal)
// =========================================================================
const SYNTAX_CASES: string[] = [
  "(x : Int)",
  "(Iso.decode s : Result String Bytes)",
  "(x : List (Maybe Int))",
  "(f x : Result String (List Int))",
  "((x : Int) : Int)",
  BS + "x -> (f x : Maybe Int)",
  "f (x : Int) (y : [String])",
  "(x : Int -> Bool)",
  "(x : (a: Int, b: Int) -> Int)",
  "(x : { name: String, age: Int })",
  "(x : (Int, String))",
  "(x : Maybe<Int>)",
  "(x : Map String Int)",
  "(x : Vec a 3)",
  "(x : schemaOf typeId)",
  "(x : Type)",
  '(x : Infixable "std:add")',
  "(x : f<a>)",
  "(x : (A -> B, C) -> D)",
  "(x : Vec Int ((n : Int) + 1))",
  "(x : Vec Int (g (" + BS + "y -> (y : Int))))",
];

describe("Phase 2d surface — Syntax space (grammar ≡ jsonLogicToSyntax(parse src))", () => {
  for (const src of SYNTAX_CASES) {
    it(src, () => {
      const g = fenelSyntax(src);
      expect(JSON.stringify(g)).toContain("SAnn");
      expect(normaliseAnnotations(g)).toEqual(normaliseAnnotations(adapterSyntax(src)));
    }, TO);
  }

  it("the marshalled annotation type is exactly the TS parser's", () => {
    const src = "(f x : Result String (List Int))";
    const g = fenelSyntax(src) as { $tag: string };
    expect(g.$tag).toBe("SAnn");
    expect(annTypeOf(g)).toEqual((parse(src) as { ann: [unknown, unknown] }).ann[1]);
  }, TO);
});

// =========================================================================
// LOADER DIRECTION — byte-equal frames
// =========================================================================
const LOADER_CASES: { name: string; src: string }[] = [
  { name: "annotated var", src: "f x = (x : Int)" },
  { name: "annotated qualified method", src: "f s = (Iso.decode s : Result String Bytes)" },
  { name: "nested generics", src: "f x = (x : List (Maybe Int))" },
  { name: "result of list", src: "g f x = (f x : Result String (List Int))" },
  { name: "nested annotations", src: "f x = ((x : Int) : Int)" },
  { name: "inside a lambda", src: "f = " + BS + "x -> (g x : Maybe Int)" },
  { name: "inside a let", src: "f x =\n  let y = (x : Int)\n  y" },
  { name: "inside a case arm", src: "f m = case m of\n  Just y -> (y : Int)\n  Nothing -> 0" },
  { name: "annotated argument", src: "f x = g (x : [String]) 1" },
  { name: "arrow type", src: "f g = (g : Int -> Bool)" },
  { name: "record type", src: "f r = (r : { name: String })" },
  { name: "value-dependent (lowercase head)", src: "f x typeId = (x : schemaOf typeId)" },
  { name: "value-level expression arg", src: "f x n = (x : Vec a (n + 1))" },
  // an annotation nested in an annotation type's value argument (the marshal
  // walks the lowered argument recursively)
  { name: "nested in a value argument", src: "f x n = (x : Vec Int ((n : Int) + 1))" },
  { name: "nested twice", src: "f x n = (x : Vec Int ((n : Vec Int ((n : Int) + 1)) + 1))" },
  { name: "a lambda inside a value argument", src: "f x = (x : Vec Int (g (" + BS + "y -> (y : Int))))" },
  {
    name: "nested in a case arm",
    src: "f m n = case m of\n  Just y -> (y : Vec Int ((n : Int) + 1))\n  Nothing -> 0",
  },
  {
    name: "in a guard and its arm",
    src: "f m = case m of\n  Just y | (y : Int) > 0 -> (y : Vec Int ((y : Int) + 1))\n  _ -> 0",
  },
  { name: "lowercase-headed angle application", src: "f x = (x : f<a>)" },
];

describe("Phase 2d surface — loader direction (marshalParsedFrames ≡ parse frames)", () => {
  for (const { name, src } of LOADER_CASES) {
    it(name, () => {
      const ts = tsFrames(src);
      expect(JSON.stringify(ts)).toContain('"ann"');
      expect(fenelFrames(src)).toEqual(ts);
    }, TO);
  }
});

// =========================================================================
// ROUND TRIPS — parse → print → parse through BOTH parsers (the printed text
// reads back to the same IR in the TS parser AND the Fenel grammar), and the
// printer's type surface (juxtaposition-printed nested types, `[T]` lists)
// =========================================================================
const ROUND_TRIPS: string[] = [
  "(Iso.decode s : Result String Bytes)",
  "(x : List (Maybe Int))",
  "(f x : Result String (List Int))",
  "(x : Maybe (Maybe Int))",
  "(x : Result (Maybe String) (Maybe (List Int)))",
  "((x : Int) : Int)",
  BS + "x -> (f x : Maybe Int)",
  "f (x : Int) (y : [String])",
  "(x : Int -> Bool)",
  "(x : (Int -> Int) -> Int)",
  "(x : (a: Int, b: Int) -> Int)",
  "(x : { name: String, age: Maybe Int })",
  "(x : (Int, String))",
  "(x : Map String (List Int))",
  "(x : Vec a 3)",
  "(x : schemaOf typeId)",
  "(x : Type)",
  "if (x : Bool) then (y : Int) else 0",
  "(x : f<a>)",
  "(x : Vec Int ((n : Int) + 1))",
  "(x : (A -> B, C) -> D)",
  "(x : {a: Int})",
  '(x : EntityRef<"profile">)',
  // a juxtaposed string argument reads in both parsers and prints juxtaposed
  '(x : Infixable "std.add")',
  // a named parameter that is an identifier (a reserved word prints the gap)
  "(x : (n: Int) -> Int)",
];

describe("Phase 2d surface — round trip parse → print → parse", () => {
  for (const src of ROUND_TRIPS) {
    it(src, () => {
      const ast = parse(src);
      const printed = print(ast);
      expect(printed).not.toContain(">>");
      expect(printed).not.toContain("::");
      expect(printed).not.toContain("<no surface syntax");
      expect(parse(printed)).toEqual(ast);
      // the Fenel grammar reads the source and the printed text to the same IR
      expect(grammarJsonLogic(src)).toEqual(ast);
      expect(grammarJsonLogic(printed)).toEqual(ast);
    }, TO);
  }

  // `grammarReadsPrinted: false` — the printer writes a let-block body as
  // `do … end`, a spelling the Fenel grammar does not read (for any body, with
  // or without an annotation; the same at 3a7b4166). The source still parses
  // alike in both parsers, and the printed text reads back in the TS parser.
  for (const { src, grammarReadsPrinted } of [
    { src: "f x =\n  let y = (x : Int)\n  y", grammarReadsPrinted: false },
    { src: "f m = case m of\n  Just y -> (y : Maybe (List Int))\n  Nothing -> 0", grammarReadsPrinted: true },
    {
      src: "f m n = case m of\n  Just y | (y : Int) > 0 -> (y : Vec Int ((n : Int) + 1))\n  _ -> 0",
      grammarReadsPrinted: true,
    },
  ]) {
    it(`multi-line body: ${JSON.stringify(src)}`, () => {
      const ast = parse(src);
      const printed = print(ast);
      expect(printed).toContain(" : ");
      expect(parse(printed)).toEqual(ast);
      const frames = tsFrames(src);
      expect(fenelFrames(src)).toEqual(frames);
      if (grammarReadsPrinted) expect(fenelFrames(printed)).toEqual(frames);
    }, TO);
  }

  it("prints the one surface (e : T) with the real type printer", () => {
    expect(print({ ann: [{ var: "x" }, ref("Int")] })).toBe("(x : Int)");
    expect(print(parse("(Iso.decode s : Result String Bytes)"))).toBe("(Iso.decode s : Result String Bytes)");
    expect(print(parse("(x : List (Maybe Int))"))).toBe("(x : [Maybe Int])");
    expect(print(parse("(f x : Result String (List Int))"))).toBe("(f x : Result String [Int])");
    expect(print(parse("(x : Maybe (Maybe Int))"))).toBe("(x : Maybe (Maybe Int))");
    // a legacy bare-string type still prints verbatim
    expect(print({ ann: [{ var: "x" }, "String"] })).toBe("(x : String)");
  });

  it("a type with no type-expression surface prints a diagnostic, never a JSON dump", () => {
    const variant = {
      $variant: { cases: [{ name: "A", label: { $tag: "Nothing" } }, { name: "B", label: { $tag: "Nothing" } }] },
    };
    const printed = print({ ann: [{ var: "x" }, variant] });
    expect(printed).toBe("(x : <no surface syntax: an inline variant type>)");
    expect(printed).not.toContain("$variant");
  });

  it("printed signatures and positional constructor fields re-parse (no nested angle brackets)", () => {
    for (const src of [
      "f : Maybe (Maybe Int) -> Result String (List Int)",
      "g : (Int -> Int) -> Maybe (Result String Int)",
      "Box = Box (Maybe Int) | Empty",
      "Wrap = Wrap (Result String (Maybe Int))",
    ]) {
      const ast = parse(src);
      const printed = print(ast);
      expect(printed).not.toContain(">>");
      expect(parse(printed)).toEqual(ast);
    }
  });
});

// =========================================================================
// desugar / jsonLogicToExpr / normaliseToCore, the adapter, inference
// =========================================================================

// Every `{ann:[e, T]}` replaced by `e` (deep): the body the annotation wraps.
function stripAnnotations(node: unknown): unknown {
  if (Array.isArray(node)) return node.map(stripAnnotations);
  if (node === null || typeof node !== "object") return node;
  const o = node as Record<string, unknown>;
  const keys = Object.keys(o);
  if (keys.length === 1 && keys[0] === "ann" && Array.isArray(o.ann) && o.ann.length === 2) {
    return stripAnnotations(o.ann[0]);
  }
  const out: Record<string, unknown> = {};
  for (const k of keys) out[k] = stripAnnotations(o[k]);
  return out;
}

// The ACTUAL compiler entry over a parsed definition's body.
const compileDef = (src: string): { $tag: string; _0?: { $tag?: string; reason?: string; body?: unknown } } => {
  const def = (parse(src) as { def: { params: string[]; body: unknown } }).def;
  return compileBody(def.params, def.body);
};
const compileBody = (params: string[], body: unknown) =>
  dispatchedNormaliseToCore({
    name: "f",
    params: positionalCompileFieldSlots(params),
    body,
    requires: [],
  }) as unknown as { $tag: string; _0?: { $tag?: string; reason?: string; body?: unknown } };

// One annotated call in every wrapper a body can put around it. `CALL` is
// replaced by the annotated call under test.
const WRAPPERS: { name: string; src: string }[] = [
  { name: "the whole body", src: "f s = CALL" },
  { name: "a let binding", src: "f s =\n  let y = CALL\n  y" },
  { name: "a let body", src: "f s =\n  let y = s\n  CALL" },
  { name: "a lambda", src: "f = " + BS + "s -> CALL" },
  { name: "a lambda inside a let", src: "f t =\n  let g = " + BS + "s -> CALL\n  g t" },
  { name: "an if branch", src: 'f b s = if b then CALL else Err "no"' },
  { name: "an if condition", src: "f s = if isOk CALL then 1 else 0" },
  { name: "a case arm", src: 'f m = case m of\n  Just s -> CALL\n  Nothing -> Err "no"' },
  { name: "a case scrutinee", src: "f s = case CALL of\n  Ok v -> 1\n  Err e -> 0" },
  { name: "a guard", src: "f m = case m of\n  Just s | isOk CALL -> 1\n  _ -> 0" },
  { name: "a do statement", src: "f s = do\n  y <- CALL\n  pure y" },
  { name: "a where binding", src: "f s = g x where x = CALL" },
  { name: "a call argument", src: "f s = g CALL 1" },
  { name: "a record field", src: "f s = { r = CALL, k = 1 }" },
  { name: "another annotation", src: "f s = (CALL : Result String Bytes)" },
];

describe("Phase 2d surface — desugar, the adapter, inference", () => {
  const T = ref("Int");
  const methodCall = { method: ["Iso", "decode", { var: "s" }] };

  it("the adapter accepts {ann} and carries the type opaquely", () => {
    const r = dispatchedJsonLogicToSyntax({ ann: [{ var: "x" }, T] }) as MaybeWire;
    expect(r.$tag).toBe("Ok");
    const s = r._0 as { $tag: string; expr: unknown };
    expect(s.$tag).toBe("SAnn");
    expect(s.expr).toEqual({ $tag: "SVar", name: "x" });
    expect(annTypeOf(s)).toEqual(T);
    const bad = dispatchedJsonLogicToSyntax({ ann: [{ var: "x" }] }) as MaybeWire;
    expect(bad.$tag).toBe("Err");
  });

  it("jsonLogicToExpr is transparent over a non-method annotation", () => {
    const plain = { call: ["f", { var: "x" }] };
    expect(dispatchedJsonLogicToExpr({ ann: [plain, T] })).toEqual(dispatchedJsonLogicToExpr(plain));
  });

  for (const { name, src } of WRAPPERS) {
    it(`normaliseToCore REFUSES an annotated method call inside ${name} (never erases it)`, () => {
      const annotated = src.replace("CALL", "(Iso.decode s : Result String Bytes)");
      const r = compileDef(annotated);
      expect(r.$tag).toBe("Err");
      expect(r._0?.$tag).toBe("Unsupported");
      expect(r._0?.reason).toContain("Iso.decode");
      // the refusal is the annotation's: the same body without it is not refused
      // for that reason (erasing it would compile a different instance choice)
      const def = (parse(annotated) as { def: { params: string[]; body: unknown } }).def;
      const bare = compileBody(def.params, stripAnnotations(def.body));
      if (bare.$tag === "Err") expect(bare._0?.reason ?? "").not.toContain("selects the instance");
    }, TO);

    it(`normaliseToCore is transparent over an annotated plain call inside ${name}`, () => {
      const annotated = src.replace("CALL", "(decodeIt s : Result String Bytes)");
      const def = (parse(annotated) as { def: { params: string[]; body: unknown } }).def;
      const r = compileBody(def.params, def.body);
      expect(r.$tag).toBe("Ok");
      expect(r).toEqual(compileBody(def.params, stripAnnotations(def.body)));
    }, TO);
  }

  it("jsonLogicToExpr REJECTS an annotation over a qualified method call, at any depth", () => {
    for (const body of [
      { ann: [methodCall, T] },
      { call: ["g", { ann: [methodCall, T] }] },
      { fn: ["s", { ann: [methodCall, T] }] },
    ]) {
      const r = dispatchedJsonLogicToExpr(body) as { $tag: string; _0?: { $tag?: string; reason?: string } };
      expect(r.$tag).toBe("Err");
      expect(r._0?.$tag).toBe("Unsupported");
      expect(r._0?.reason).toContain("Iso.decode");
    }
  });

  it("desugar is transparent over SAnn, and never erases an SAnn over SMethod", () => {
    const inner = { $tag: "SCall", fnId: "f", args: [{ $tag: "SVar", name: "x" }] };
    expect(dispatchEngineBody("engine:desugar", [{ $tag: "SAnn", expr: inner, type: T }]))
      .toEqual(dispatchEngineBody("engine:desugar", [inner]));
    const method = { $tag: "SMethod", cls: "Iso", method: "decode", args: [{ $tag: "SVar", name: "s" }] };
    const kept = dispatchEngineBody("engine:desugar", [{ $tag: "SAnn", expr: method, type: T }]) as {
      $tag: string;
      fnId: string;
    };
    expect(kept.$tag).toBe("ECall");
    expect(kept.fnId).toBe("ann");
    const error = dispatchEngineBody("engine:desugarAnnotationError", [{ $tag: "SAnn", expr: method, type: T }]) as MaybeWire;
    expect(error.$tag).toBe("Just");
    expect(dispatchEngineBody("engine:desugarAnnotationError", [{ $tag: "SAnn", expr: inner, type: T }]))
      .toEqual({ $tag: "Nothing" });
  });

  it("inference infers the annotated expression, never the written type", () => {
    const lit = { $tag: "SLit", value: 1 };
    const written = ref("String");
    const plain = dispatchEngineBody("engine:inferSyntaxType", [lit, [], [], "root"]);
    const annotated = dispatchEngineBody("engine:inferSyntaxType", [{ $tag: "SAnn", expr: lit, type: written }, [], [], "root"]);
    expect(annotated).toEqual(plain);
    const call = { $tag: "SCall", fnId: "foo", args: [] };
    expect(dispatchEngineBody("engine:inferenceSurfaceReferences", [{ $tag: "SAnn", expr: call, type: written }]))
      .toEqual(dispatchEngineBody("engine:inferenceSurfaceReferences", [call]));
  });
});
