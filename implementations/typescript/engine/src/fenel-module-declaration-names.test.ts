// modules-as-values Phase 3a — unnamed `_` declarations, duplicate names, and
// which references in instance method values the loader lowers. Brief:
// `workstreams/modules-as-values/briefs/phase-3a-unnamed-declarations-and-duplicates.md`.
//
// The rules' source of truth is `fenel/modules/engine/declaration-names.fenel`;
// `fenel-module-declaration-names-parity.test.ts` pins the loader's TypeScript
// mirror to it. This file pins what the loader DOES with the verdicts. It needs
// no engine harness: run it with FENEL_PARSER_LEGACY=1, like every loader test.
//
// TS ledger: test/tooling category (an existing sanctioned exception).

import { describe, expect, test } from "bun:test";
import { loadFenelModule, loadFenelModuleUnion, type LoadFenelModuleOptions } from "./fenel-module";
import { migration } from "./migration";
import { lowerMaybeFunctionReferences } from "./modules/migration";

const src = (...lines: string[]): string => `${lines.join("\n")}\n`;

const TWO_PAIRS = src(
  "module ops where",
  "",
  "_ : Infixable std.add",
  '_ = Infixable { notation = "+", precedence = 6, associativity = "left" }',
  "",
  "_ : Infixable std.sub",
  '_ = Infixable { notation = "-", precedence = 6, associativity = "left" }',
);

/** The error a load throws, checked by class NAME so each case fails on
 *  behaviour (no throw, or a different error) before the loader change. */
function loadError(source: string, opts: LoadFenelModuleOptions = {}): Error {
  try {
    loadFenelModule(source, "test", opts);
  } catch (e) {
    return e as Error;
  }
  throw new Error("expected the load to fail, but it succeeded");
}

function rejects(source: string, pattern: RegExp, opts: LoadFenelModuleOptions = {}): void {
  const error = loadError(source, opts);
  expect(error.name).toBe("DeclarationNameError");
  expect(error.message).toMatch(pattern);
}

function unionError(sources: Parameters<typeof loadFenelModuleUnion>[0]): Error {
  try {
    loadFenelModuleUnion(sources);
  } catch (e) {
    return e as Error;
  }
  throw new Error("expected the union to fail, but it succeeded");
}

// ===========================================================================
// `_` means "no name".
// ===========================================================================
describe("unnamed declarations", () => {
  for (const [where, opts] of [
    ["outside an instance file", {}],
    ["inside an instance file", { dispatchInstanceFile: true }],
  ] as const) {
    test(`two _ pairs load as two distinct instances, and nothing else (${where})`, () => {
      const loaded = loadFenelModule(TWO_PAIRS, "ops", opts);
      const infixables = (loaded.instances ?? []).filter((i) => i.typeName === "Infixable");
      expect(infixables.map((i) => i.args)).toEqual([["std.add"], ["std.sub"]]);
      expect(infixables.map((i) => (i.methods as { notation: string }).notation)).toEqual(["+", "-"]);
      // An unnamed instance is found by type: no function, no Codeable, no
      // signature declaration (so no lock row), and no other instance.
      expect(loaded.functions ?? []).toEqual([]);
      expect(loaded.functionSignatureDeclarations ?? []).toEqual([]);
      expect((loaded.instances ?? []).length).toBe(2);
    });
  }

  test("two _ instances with the same type and parameters are both kept", () => {
    // `(typeName, args)` is never a duplicate: `Infixable "std:and"` is declared
    // twice in parser-fixities.fenel, once per spelling.
    const loaded = loadFenelModule(
      src(
        "_ : Infixable std.and",
        '_ = Infixable { notation = "&&", precedence = 3, associativity = "right" }',
        "_ : Infixable std.and",
        '_ = Infixable { notation = "and", precedence = 3, associativity = "right" }',
        "andSymbol : Infixable std.and",
        'andSymbol = Infixable { notation = "&&", precedence = 3, associativity = "right" }',
        "andWord : Infixable std.and",
        'andWord = Infixable { notation = "and", precedence = 3, associativity = "right" }',
      ),
      "fixities",
      { dispatchInstanceFile: true },
    );
    const infixables = (loaded.instances ?? []).filter((i) => i.typeName === "Infixable");
    expect(infixables.map((i) => (i.methods as { notation: string }).notation))
      .toEqual(["&&", "and", "&&", "and"]);
  });

  test("a _ signature at the end of the file has no definition", () => {
    rejects(
      src("foo = 1", "_ : Infixable std.add"),
      /unnamed declaration #1: the "_" signature at declaration 2 in test is not immediately followed by a "_" definition/,
    );
  });

  test("a _ signature pairs only with the definition right after it", () => {
    const error = loadError(src(
      "_ : Infixable std.add",
      "foo = 1",
      '_ = Infixable { notation = "+" }',
    ));
    expect(error.name).toBe("DeclarationNameError");
    expect(error.message).toMatch(/unnamed declaration #1: the "_" signature at declaration 1 in test is not immediately followed/);
    expect(error.message).toMatch(/unnamed declaration #2: the "_" definition at declaration 3 in test has no "_" signature immediately before it/);
  });

  test("a _ definition needs a signature", () => {
    rejects(
      src('_ = Infixable { notation = "+" }'),
      /unnamed declaration #1: the "_" definition at declaration 1 in test has no "_" signature immediately before it\. An unnamed instance is found by its type and parameters, so it needs a signature\./,
    );
  });

  test("a _ definition takes no parameters", () => {
    rejects(
      src("_ : Infixable std.add", "_ x = Infixable { notation = x }"),
      /unnamed declaration #1: the "_" definition at declaration 2 in test takes parameters/,
    );
  });

  test("a _ definition must construct its signature's type", () => {
    rejects(
      src("_ : Infixable std.add", '_ = Prefixable { notation = "-" }'),
      /unnamed declaration #1: the "_" definition at declaration 2 in test must be a constructor application of its signature's type "Infixable"/,
    );
    rejects(
      src("_ : Infixable std.add", "_ = 5"),
      /must be a constructor application of its signature's type "Infixable"/,
    );
    rejects(
      src("_ : Number -> Number", '_ = Infixable { notation = "+" }'),
      /the "_" definition at declaration 2 in test cannot be an instance: its signature does not name a type/,
    );
  });

  test("a _ declaration carries no directives", () => {
    rejects(
      src('@label "Plus"', "_ : Infixable std.add", '_ = Infixable { notation = "+" }'),
      /unnamed declaration #1: the "_" signature at declaration 1 in test carries directives/,
    );
    rejects(
      src("_ : Infixable std.add", '@label "Plus"', '_ = Infixable { notation = "+" }'),
      /unnamed declaration #1: the "_" definition at declaration 2 in test carries directives/,
    );
  });

  test("the error names the module and reports every violation at once", () => {
    const error = loadError(src(
      "module ops where",
      "_ : Infixable std.add",
      "_ x = Prefixable { notation = x }",
    ));
    expect(error.message).toMatch(/^Declaration name errors in module "ops":/);
    expect(error.message).toMatch(/#1: the "_" definition at declaration 3 in test takes parameters/);
    expect(error.message).toMatch(/#1: the "_" definition at declaration 3 in test must be a constructor application/);
  });
});

// ===========================================================================
// A name declared twice is an error, not a silent overwrite.
// ===========================================================================
describe("duplicate names in one file", () => {
  test("two definitions of one name", () => {
    rejects(
      src("foo = 1", "foo = 2"),
      /duplicate definition "foo": declaration 1 in test and declaration 2 in test/,
    );
  });

  test("two signatures of one name", () => {
    rejects(
      src("foo : Number", "foo : String", "foo = 1"),
      /duplicate signature "foo": declaration 1 in test and declaration 2 in test/,
    );
  });

  test("two type declarations of one name", () => {
    rejects(
      src("Color = Red | Green", "Color = Blue"),
      /duplicate type declaration "Color": declaration 1 in test and declaration 2 in test/,
    );
  });

  test("a function whose @codeName is another function's name", () => {
    rejects(
      src("foo = 1", '@codeName "foo"', "bar = 2"),
      /code name "foo" is registered by two functions, "foo" \(declaration 1 in test\) and "bar" \(declaration 2 in test\)/,
    );
  });

  test("two functions with one @codeName, including a native", () => {
    rejects(
      src("@native", '@codeName "shared"', "foo : Number -> Number", '@codeName "shared"', "bar = 2"),
      /code name "shared" is registered by two functions, "foo" \(declaration 1 in test\) and "bar" \(declaration 2 in test\)/,
    );
  });

  test("names and effective code names are separate namespaces", () => {
    // Raw names {foo, bar} and code names {bar, foo} are each unique.
    const loaded = loadFenelModule(
      src('@codeName "bar"', "foo = 1", '@codeName "foo"', "bar = 2"),
      "test",
    );
    expect((loaded.functions ?? []).map((f) => f.id)).toEqual(["test:foo", "test:bar"]);
  });

  test("a signature and its definition are one declaration", () => {
    const loaded = loadFenelModule(src("foo : Number", "foo = 1", "Foo = Foo"), "test");
    expect((loaded.functions ?? []).map((f) => f.id)).toEqual(["test:foo"]);
  });
});

describe("duplicate names across the files of one module", () => {
  test("a named instance declared in two files", () => {
    const error = unionError([
      { name: "a.fenel", src: src("module m where", "fooShow : Show Foo", "fooShow = Show { show = f }"), opts: { dispatchInstanceFile: true } },
      { name: "b.fenel", src: src("module m where", "fooShow : Show Bar", "fooShow = Show { show = g }"), opts: { dispatchInstanceFile: true } },
    ]);
    expect(error.name).toBe("DeclarationNameError");
    expect(error.message).toMatch(/module "m"/);
    expect(error.message).toMatch(/duplicate definition "fooShow": declaration 3 in a\.fenel and declaration 3 in b\.fenel/);
  });

  test("a named instance and a function of one name in two files", () => {
    const error = unionError([
      { name: "a.fenel", src: src("module m where", "fooShow : Show Foo", "fooShow = Show { show = f }"), opts: { dispatchInstanceFile: true } },
      { name: "b.fenel", src: src("module m where", "fooShow x = x") },
    ]);
    expect(error.message).toMatch(/duplicate definition "fooShow": declaration 3 in a\.fenel and declaration 2 in b\.fenel/);
  });

  test("sources that share a name are told apart by their position", () => {
    // The engine union names every source "engine".
    const error = unionError([
      { name: "m", src: src("module m where", "fooShow : Show Foo", "fooShow = Show { show = f }"), opts: { dispatchInstanceFile: true } },
      { name: "m", src: src("module m where", "fooShow : Show Bar", "fooShow = Show { show = g }"), opts: { dispatchInstanceFile: true } },
    ]);
    expect(error.message).toMatch(/duplicate definition "fooShow": declaration 3 in m \(source 1\) and declaration 3 in m \(source 2\)/);
  });

  test("a function code name registered in two files", () => {
    const error = unionError([
      { name: "a.fenel", src: src("module m where", "foo = 1") },
      { name: "b.fenel", src: src("module m where", '@codeName "foo"', "bar = 2") },
    ]);
    expect(error.name).toBe("DeclarationNameError");
    expect(error.message).toMatch(/code name "foo" is registered by two functions, "foo" \(declaration 2 in a\.fenel\) and "bar" \(declaration 2 in b\.fenel\)/);
  });

  test("unnamed instances of one type and parameters in two files are both kept", () => {
    const [m] = loadFenelModuleUnion([
      { name: "a.fenel", src: src("module m where", "_ : Infixable std.add", '_ = Infixable { notation = "+" }') },
      { name: "b.fenel", src: src("module m where", "_ : Infixable std.add", '_ = Infixable { notation = "plus" }') },
    ]);
    expect((m!.instances ?? []).map((i) => [i.typeName, i.args, (i.methods as { notation: string }).notation]))
      .toEqual([["Infixable", ["std.add"], "+"], ["Infixable", ["std.add"], "plus"]]);
    expect(m!.functions ?? []).toEqual([]);
  });
});

// ===========================================================================
// Only a TOP-LEVEL method reference lowers to `{$ref}` (the Phase-10 flip).
// Nested positions keep their lowering: the IR cannot tell a reference from
// data there.
// ===========================================================================
describe("references in method values", () => {
  const methodsOf = (...fields: string[]): Record<string, unknown> => {
    const loaded = loadFenelModule(
      src("inst : Migration A B", `inst = Migration { ${fields.join(", ")} }`),
      "probe",
      { dispatchInstanceFile: true },
    );
    const inst = (loaded.instances ?? []).find((i) => i.typeName === "Migration");
    if (inst === undefined) throw new Error("no Migration instance projected");
    return inst.methods as Record<string, unknown>;
  };

  test("a record literal with a field named `var` stays a record", () => {
    // The parser emits it as `{construct:["Packet",{var:"hello"}]}`.
    expect(methodsOf('packet = Packet { var = "hello" }').packet)
      .toEqual({ $tag: "Packet", var: "hello" });
    // A nested record whose field is named like an expression node, too.
    expect(methodsOf("rec = { f = { call = std.add } }").rec)
      .toEqual({ f: { call: { var: "std.add" } } });
  });

  test("a reference nested in a constructor is lowered by the declared field type, at registry time", () => {
    // The parser emits the application `Just migration.x` and the record
    // literal `Just { var = "migration.x" }` as the same JSON,
    // `{construct:["Just",{var:"migration.x"}]}`, so the LOADER still spreads
    // it as a record: no key-name rule can tell them apart, since a record may
    // have a field named `var` or `call`. The declared field type can
    // (modules-as-values Phase 2d): Migration's `backward` is
    // `Maybe (v2 -> Result MigrationError v1)`, so its Just payload is a
    // function, and `lowerMaybeFunctionReferences` (the migration seam runs it
    // before registration) turns it into `{$tag:"Just", _0:{$ref:"migration.x"}}`.
    expect(methodsOf("backward = Just migration.x").backward)
      .toEqual({ $tag: "Just", var: "migration.x" });
    const loaded = (loadFenelModule(
      src("inst : Migration A B", "inst = Migration { backward = Just migration.x, packet = Packet hello }"),
      "probe",
      { dispatchInstanceFile: true },
    ).instances ?? []).find((i) => i.typeName === "Migration")!;
    const lowered = lowerMaybeFunctionReferences(loaded, migration).methods as Record<string, unknown>;
    expect(lowered.backward).toEqual({ $tag: "Just", _0: { $ref: "migration.x" } });
    // A field the class does not declare as `Maybe (arrow)` is never touched:
    // an ordinary record with a field named `var` stays a record.
    expect(lowered.packet).toEqual({ $tag: "Packet", var: "hello" });
    expect(methodsOf("packet = Packet hello").packet)
      .toEqual(methodsOf('packet = Packet { var = "hello" }').packet);
  });

  test("lambdas and applications are left alone", () => {
    // A `{var}` inside an operator node is a lexical reference or an argument,
    // never a function reference.
    expect(methodsOf("lam = \\x -> x").lam).toEqual({ fn: ["x", { var: "x" }] });
    expect(methodsOf("app = f x").app).toEqual({ call: ["f", { var: "x" }] });
    expect(methodsOf("rec = { g = \\x -> x }").rec).toEqual({ g: { fn: ["x", { var: "x" }] } });
    expect(methodsOf("xs = [f x]").xs).toEqual([{ call: ["f", { var: "x" }] }]);
  });

  test("top-level references and nullary constructors keep their shapes", () => {
    const methods = methodsOf("forward = migration.x", "fallback = Nothing");
    expect(methods.forward).toEqual({ $ref: "migration.x" });
    expect(methods.fallback).toEqual({ $tag: "Nothing" });
  });
});

describe("same-file arrow recovery for a constantly-true refinement", () => {
  const source = src(
    "module SigUnfold where",
    "Food = Apple | Pear",
    "Pantry = List Food | if true then true else true",
    "Ingredients = List Food | if true then true else true",
    "Recipe = (Pantry -> List Ingredients) | if true then true else true",
    "Email = String | if true then true else true",
    "sample : Recipe",
    "sample pantry = pantry",
    "widen : Email",
    "widen value = value",
    "@native",
    "foreignRecipe : Recipe",
  );

  test("a Recipe signature keeps the name and recovers the arrow", () => {
    const loaded = loadFenelModule(source, "SigUnfold");
    const sample = (loaded.functions ?? []).find((fn) => fn.id === "SigUnfold:sample");
    const scheme = loaded.functionSignatureDeclarations?.find((row) => row.functionId === "SigUnfold:sample")?.scheme?.body;
    expect(sample?.params.map((param) => ({ name: param.name, type: param.type }))).toEqual([
      { name: "pantry", type: { $ref: "Pantry" } },
    ]);
    expect(JSON.stringify(sample?.returns)).toContain("Ingredients");
    expect(sample?.returns).not.toEqual({ $ref: "Recipe" });
    expect(scheme).toEqual({ $ref: "Recipe" });
    const foreign = (loaded.functions ?? []).find((fn) => fn.id === "SigUnfold:foreignRecipe");
    expect(foreign?.params).toHaveLength(1);
    expect(foreign?.params[0]?.type).toEqual({ $ref: "Pantry" });
    expect(JSON.stringify(foreign?.returns)).toContain("Ingredients");
    const foreignScheme = loaded.functionSignatureDeclarations?.find((row) => row.functionId === "SigUnfold:foreignRecipe")?.scheme?.body;
    expect(foreignScheme).toEqual({ $ref: "Recipe" });
  });

  test("a refinement whose base is not an arrow stays the written name", () => {
    const loaded = loadFenelModule(source, "SigUnfold");
    const widen = (loaded.functions ?? []).find((fn) => fn.id === "SigUnfold:widen");
    expect(widen?.params[0]?.type).toEqual({ $var: "__absent__SigUnfold:widen__param-0" });
    expect(widen?.returns).toEqual({ $ref: "Email" });
    expect(loaded.functionSignatureDeclarations?.find((row) => row.functionId === "SigUnfold:widen")?.scheme?.body)
      .toEqual({ $ref: "Email" });
  });
});
