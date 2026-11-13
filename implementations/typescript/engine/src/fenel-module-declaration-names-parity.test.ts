// modules-as-values Phase 3a — the loader's declaration-name rules are a
// MECHANICAL MIRROR of `fenel/modules/engine/declaration-names.fenel`. This file
// is the pin: it runs the Fenel bodies (through the engine harness) and the
// TypeScript mirror (`fenel-module.ts`) over the same declaration lists and
// asserts deep-equal results, messages included. Each synthetic list also pins
// the fault it must produce, so an agreement on "no errors" cannot pass for
// parity. Heads built from real corpus files close the loop on the head
// builder's shapes.
//
// Run with FENEL_PARSER_LEGACY=1 (the new `.fenel` file is not in the parse
// cache until the next regeneration).
//
// TS ledger: test/tooling category (an existing sanctioned exception).

import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { dispatchEngineBody, print } from "./engine-bodies-dispatch";
import { parse } from "./fenel-parser";
import {
  declarationGroupClashes,
  declarationHeadsOf,
  declarationNameClashes,
  declarationSelectionConflicts,
  declarationUnnamedErrors,
  importSelectionsOf,
  type DeclarationHead,
  type DeclarationNameErrorValue,
  type ImportSelection,
} from "./fenel-module";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..", "..", "..", "..");

// Engine-harness boot is charged to the first case; the bodies run interpreted.
const TO = 180_000;

type Form = "SignatureForm" | "DefinitionForm" | "TypeForm" | "OtherForm";
const Just = <T>(value: T) => ({ $tag: "Just" as const, _0: value });
const Nothing = { $tag: "Nothing" as const };

function head(
  index: number,
  form: Form,
  name: string | null,
  extra: Partial<Omit<DeclarationHead, "$tag" | "form" | "name" | "index">> = {},
): DeclarationHead {
  return {
    $tag: "DeclarationHead",
    form: { $tag: form },
    name: name === null ? Nothing : Just(name),
    codeName: Nothing,
    file: "a.fenel",
    index,
    hasParams: false,
    hasDirectives: false,
    typeHead: Nothing,
    bodyHead: Nothing,
    ...extra,
  };
}

const sig = (index: number, name: string | null, type: string | null = "Infixable", extra = {}) =>
  head(index, "SignatureForm", name, { typeHead: type === null ? Nothing : Just(type), ...extra });
const def = (index: number, name: string | null, ctor: string | null = "Infixable", extra = {}) =>
  head(index, "DefinitionForm", name, { bodyHead: ctor === null ? Nothing : Just(ctor), ...extra });
const fn = (index: number, name: string, code = name, extra = {}) =>
  head(index, "DefinitionForm", name, { codeName: Just(code), ...extra });

/** What a verdict says, without the heads and messages the parity assertion
 *  already covers: `fault#number` for an unnamed refusal, else `$tag:name`. */
function summary(errors: readonly DeclarationNameErrorValue[]): string[] {
  return errors.map((e) =>
    e.$tag === "UnnamedDeclarationError"
      ? `${e.fault.$tag}#${e.number}`
      : e.$tag === "DuplicateDeclaration" || e.$tag === "SelectionConflict"
        ? `${e.$tag}:${e.name}`
        : `${e.$tag}:${e.codeName}`,
  );
}

type Case = { label: string; heads: DeclarationHead[]; unnamed: string[]; clashes: string[]; group: string[] };

const CASES: Case[] = [
  { label: "an empty file", heads: [], unnamed: [], clashes: [], group: [] },
  {
    label: "two valid _ pairs of one type and parameters",
    heads: [head(0, "OtherForm", null), sig(1, null), def(2, null), sig(3, null), def(4, null)],
    unnamed: [],
    clashes: [],
    group: [],
  },
  {
    label: "a _ signature at the end",
    heads: [fn(0, "foo"), sig(1, null)],
    unnamed: ["UnpairedSignature#1"],
    clashes: [],
    group: [],
  },
  {
    label: "a _ signature followed by a named declaration, then a _ definition",
    heads: [sig(0, null), fn(1, "foo"), def(2, null)],
    unnamed: ["UnpairedSignature#1", "UnpairedDefinition#2"],
    clashes: [],
    group: [],
  },
  {
    label: "a _ signature followed by a fixity, then a _ definition",
    heads: [sig(0, null), head(1, "OtherForm", null), def(2, null)],
    unnamed: ["UnpairedSignature#1", "UnpairedDefinition#2"],
    clashes: [],
    group: [],
  },
  {
    label: "two _ signatures in a row, then one _ definition",
    heads: [sig(0, null), sig(1, null), def(2, null)],
    unnamed: ["UnpairedSignature#1"],
    clashes: [],
    group: [],
  },
  {
    label: "a _ definition first, with parameters and directives",
    heads: [def(0, null, "Infixable", { hasParams: true, hasDirectives: true }), fn(1, "foo")],
    unnamed: ["UnpairedDefinition#1", "UnnamedWithParameters#1", "UnnamedWithDirectives#1"],
    clashes: [],
    group: [],
  },
  {
    label: "a paired _ definition with every fault",
    heads: [sig(0, null, "Infixable", { hasDirectives: true }), def(1, null, "Prefixable", { hasParams: true, hasDirectives: true })],
    unnamed: ["UnnamedWithDirectives#1", "UnnamedWithParameters#1", "UnnamedNotInstance#1", "UnnamedWithDirectives#1"],
    clashes: [],
    group: [],
  },
  {
    label: "a _ body that is not a constructor application",
    heads: [sig(0, null), def(1, null, null)],
    unnamed: ["UnnamedNotInstance#1"],
    clashes: [],
    group: [],
  },
  {
    label: "a _ signature that names no type",
    heads: [sig(0, null, null), def(1, null)],
    unnamed: ["UnnamedNotInstance#1"],
    clashes: [],
    group: [],
  },
  {
    label: "numbering continues past a valid pair",
    heads: [sig(0, null), def(1, null), def(2, null), sig(3, null)],
    unnamed: ["UnpairedDefinition#2", "UnpairedSignature#3"],
    clashes: [],
    group: [],
  },
  {
    label: "duplicate definitions, signatures and types, three of one",
    heads: [
      sig(0, "foo", null), fn(1, "foo"), sig(2, "foo", null), fn(3, "foo"),
      head(4, "TypeForm", "Color"), head(5, "TypeForm", "Color"), fn(6, "foo"),
    ],
    unnamed: [],
    clashes: [
      "DuplicateDeclaration:foo", "DuplicateDeclaration:foo",
      "DuplicateDeclaration:Color", "DuplicateDeclaration:foo",
    ],
    group: ["DuplicateDeclaration:foo", "DuplicateDeclaration:foo"],
  },
  {
    label: "one spelling in three namespaces is no clash, and _ never clashes",
    heads: [sig(0, "Foo", null), def(1, "Foo", null), head(2, "TypeForm", "Foo"), sig(3, null), def(4, null), sig(5, null), def(6, null)],
    unnamed: [],
    clashes: [],
    group: [],
  },
  {
    label: "code names: a collision, the crossover, and a same-name pair",
    heads: [
      fn(0, "foo"), fn(1, "bar", "foo"),
      fn(2, "left", "right"), fn(3, "right", "left"),
      fn(4, "twice"), fn(5, "twice"),
      sig(6, "leaf", null, { codeName: Just("foo") }),
    ],
    unnamed: [],
    clashes: [
      "CodeNameClash:foo", "DuplicateDeclaration:twice", "CodeNameClash:foo",
    ],
    group: ["CodeNameClash:foo", "DuplicateDeclaration:twice", "CodeNameClash:foo"],
  },
  {
    label: "across files: named instances, a function, natives and ignored heads",
    heads: [
      head(0, "OtherForm", null),
      sig(1, "fooShow", "Show"), def(2, "fooShow", "Show"),
      { ...sig(1, "fooShow", "Show"), file: "b.fenel" },
      { ...def(2, "fooShow", "Show"), file: "b.fenel" },
      { ...fn(3, "fooShow"), file: "c.fenel" },
      { ...sig(4, "native", null, { codeName: Just("n") }), file: "c.fenel" },
      { ...sig(4, "orphan", null), file: "d.fenel" },
      { ...sig(5, "orphan", null), file: "e.fenel" },
      { ...head(6, "TypeForm", "Color"), file: "d.fenel" },
      { ...head(6, "TypeForm", "Color"), file: "e.fenel" },
      { ...fn(7, "other", "n"), file: "e.fenel" },
    ],
    unnamed: [],
    clashes: [
      "DuplicateDeclaration:fooShow", "DuplicateDeclaration:fooShow", "DuplicateDeclaration:fooShow",
      "DuplicateDeclaration:orphan", "DuplicateDeclaration:Color", "CodeNameClash:n",
    ],
    group: ["DuplicateDeclaration:fooShow", "DuplicateDeclaration:fooShow", "CodeNameClash:n"],
  },
];

const fenel = (fnName: string, heads: readonly DeclarationHead[]): DeclarationNameErrorValue[] =>
  dispatchEngineBody(`engine:${fnName}`, [heads]) as DeclarationNameErrorValue[];

// Deep equality over plain JSON: the interpreter builds records with a null
// prototype, the mirror with Object's. Neither carries anything JSON drops.
const plain = (value: unknown): unknown => JSON.parse(JSON.stringify(value));

describe("declaration-names.fenel ≡ the fenel-module.ts mirror", () => {
  for (const c of CASES) {
    test(c.label, () => {
      const unnamed = declarationUnnamedErrors(c.heads);
      const clashes = declarationNameClashes(c.heads);
      const group = declarationGroupClashes(c.heads);
      expect(summary(unnamed)).toEqual(c.unnamed);
      expect(summary(clashes)).toEqual(c.clashes);
      expect(summary(group)).toEqual(c.group);
      expect(plain(fenel("declarationUnnamedErrors", c.heads))).toEqual(plain(unnamed));
      expect(plain(fenel("declarationNameClashes", c.heads))).toEqual(plain(clashes));
      expect(plain(fenel("declarationGroupClashes", c.heads))).toEqual(plain(group));
    }, TO);
  }

  test("the messages are the loader's messages", () => {
    const [pairFault] = declarationUnnamedErrors([sig(2, null)]);
    expect(pairFault!.message).toBe(
      'unnamed declaration #1: the "_" signature at declaration 3 in a.fenel is not immediately followed by '
      + 'a "_" definition. Each "_" signature pairs with the "_" definition right after it.',
    );
    const [duplicate] = declarationNameClashes([fn(0, "foo"), { ...fn(4, "foo"), file: "b.fenel" }]);
    expect(duplicate!.message).toBe(
      'duplicate definition "foo": declaration 1 in a.fenel and declaration 5 in b.fenel. '
      + "A name is declared once in a module; rename or remove one of them.",
    );
  });

  // Real files: the head builder's output must be accepted by both sides alike
  // (and the corpus has no duplicates, so both must say nothing).
  const REAL: [string, boolean][] = [
    ["fenel/modules/engine/declaration-names.fenel", false],
    ["fenel/modules/engine/directive-policy.fenel", false],
    ["fenel/modules/engine/kinds.fenel", false],
    ["fenel/std/parser-fixities.fenel", true],
  ];
  for (const [file, instanceFile] of REAL) {
    test(`real heads: ${file}`, () => {
      const heads = declarationHeadsOf(
        readFileSync(join(ROOT, file), "utf8"),
        file,
        instanceFile ? { dispatchInstanceFile: true } : {},
      );
      expect(heads.length).toBeGreaterThan(0);
      for (const [fnName, mirror] of [
        ["declarationUnnamedErrors", declarationUnnamedErrors],
        ["declarationNameClashes", declarationNameClashes],
        ["declarationGroupClashes", declarationGroupClashes],
      ] as const) {
        expect(mirror(heads)).toEqual([]);
        expect(plain(fenel(fnName, heads))).toEqual([]);
      }
    }, TO);
  }
});

// modules-as-values Phase 5c-1a — file-top selections: one name selected from
// two different sources is an error naming both; a same-source repeat is fine.
const sel = (index: number, name: string, source: string, file = "a.fenel"): ImportSelection =>
  ({ $tag: "ImportSelection", name, source, file, index });

const SELECTION_CASES: { label: string; selections: ImportSelection[]; conflicts: string[] }[] = [
  { label: "no selections", selections: [], conflicts: [] },
  {
    label: "one name from one source, twice, beside another name",
    selections: [sel(1, "map", "std"), sel(2, "map", "std"), sel(2, "fold", "std")],
    conflicts: [],
  },
  {
    label: "one name from two sources",
    selections: [sel(1, "map", "std"), sel(2, "map", "picture")],
    conflicts: ["SelectionConflict:map"],
  },
  {
    label: "three sources across files, each reported against the first selection",
    selections: [
      sel(1, "map", "std"), sel(1, "map", "picture", "b.fenel"), sel(3, "map", "std"),
      sel(2, "map", "path", "c.fenel"), sel(4, "Point", "picture"), sel(5, "Point", "picture", "b.fenel"),
    ],
    conflicts: ["SelectionConflict:map", "SelectionConflict:map"],
  },
];

describe("declaration-names.fenel ≡ the mirror: file-top selection conflicts", () => {
  for (const c of SELECTION_CASES) {
    test(c.label, () => {
      const conflicts = declarationSelectionConflicts(c.selections);
      expect(summary(conflicts)).toEqual(c.conflicts);
      expect(plain(fenel("declarationSelectionConflicts", c.selections as never))).toEqual(plain(conflicts));
    }, TO);
  }

  test("the message names both sources and their sites", () => {
    const [conflict] = declarationSelectionConflicts([sel(1, "map", "std"), sel(4, "map", "picture", "b.fenel")]);
    expect(conflict!.message).toBe(
      '"map" is selected from two sources: std (declaration 2 in a.fenel) and picture (declaration 5 in b.fenel). '
      + "A module opens a name from one source; keep one selection and write the other as picture.map.",
    );
  });

  // The corpus's file-top selections: built like the loader builds them, and
  // conflict-free on both sides.
  for (const file of [
    "fenel/modules/publicdemo/drawing-demo.fenel",
    "fenel/modules/publicdemo/statistics-demo.fenel",
    "fenel/modules/publicdemo/locale-demo.fenel",
  ]) {
    test(`real selections: ${file}`, () => {
      const selections = importSelectionsOf(readFileSync(join(ROOT, file), "utf8"), file);
      expect(selections.length).toBeGreaterThan(1);
      expect(declarationSelectionConflicts(selections)).toEqual([]);
      expect(plain(fenel("declarationSelectionConflicts", selections as never))).toEqual([]);
    }, TO);
  }
});

describe("the printer round-trips unnamed declarations", () => {
  test("_ : T and _ = T { … } print and re-parse unchanged", () => {
    const source = [
      "_ : Infixable std.add",
      '_ = Infixable { notation = "+", precedence = 6, associativity = "left" }',
      "",
      "_ : Infixable std.sub",
      '_ = Infixable { notation = "-", precedence = 6, associativity = "left" }',
      "",
    ].join("\n");
    const printed = print(parse(source));
    expect(printed).toContain("_ : Infixable std.add");
    expect(printed).toContain("_ = Infixable {");
    expect(parse(printed)).toEqual(parse(source));
  }, TO);
});
