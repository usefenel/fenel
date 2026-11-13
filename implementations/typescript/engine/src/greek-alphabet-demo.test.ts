// C1 test harness: execute the source-owned Greek catalogue and predicates
// through the existing evaluator and set judgment. The only fixture native is
// EncyclopediaDemo's existing B3 type-envelope bridge, with its real body.
import { beforeAll, describe, expect, test } from "bun:test";
import { loadFenelModule } from "./fenel-module";
import { invokeCallable, evaluateWithTrace, type EvaluateContext } from "./json-logic";
import { createRegistry, type ModuleRegistry } from "./registry";
import { stdModule } from "./modules/std";
import { decidableMembershipModule } from "./modules/decidable-membership";
import { dispatchRegistry } from "./system-entities";
import { countries } from "./reference-data";
import { Just, Nothing, setExprAsType } from "./type-foundation";
import { peelSetExpr } from "./set-marker";
import { fieldEditPlan } from "./authoring/field-render";
import { withInterpretedResolver } from "./engine-bodies-dispatch";
import type { FenelType, SetExpr } from "./types";
import SOURCE from "../../../../fenel/modules/publicdemo/greek-alphabet-demo.fenel?raw";
import ENCYCLOPEDIA from "../../../../fenel/modules/publicdemo/encyclopedia-demo.fenel?raw";

type Letter = { order: number; name: string; greekName: string; unicodeStem: string; capital: string; capitalCode: string; small: string; smallCode: string; lowercaseForms: string[]; vowel: boolean };
type Character = { glyph: string; name: string; unicodeName: string; codepoint: string; scalar: number; letterOrder: number; category: string; script: string; block: string; simpleUppercase: string; simpleLowercase: string; release: string; source: string };
type Selection = { $tag: string };
type Exploration = { glyphs: string[]; characters: Character[]; count: number; characterType: FenelType; constraint: unknown; selected: unknown; membership: unknown; explanation: string };
type CharacterCheck = { position: number; glyph: string; membership: unknown; character: unknown };
type TextResult = { candidate: string; count: number; membership: unknown; checks: CharacterCheck[]; firstOutside: unknown; uppercase: unknown; lowercase: unknown; constraint: unknown; textType: FenelType };
const selection = (name: string): Selection => ({ $tag: name });
const all = selection("AllGreekLetters"), upper = selection("UppercaseGreek"), lower = selection("LowercaseGreek");
const vowels = selection("GreekVowels"), consonants = selection("GreekConsonants"), finalSigma = selection("FinalSigma");
const capitals = Array.from("ΑΒΓΔΕΖΗΘΙΚΛΜΝΞΟΠΡΣΤΥΦΧΨΩ");
const small = Array.from("αβγδεζηθικλμνξοπρστυφχψω");
const lowerForms = Array.from("αβγδεζηθικλμνξοπρσςτυφχψω");
let registry: ModuleRegistry;
let context: EvaluateContext;
let alphabet: Letter[];
let characters: Character[];

function call(name: string, ...args: unknown[]): unknown {
  return withInterpretedResolver(() => invokeCallable({ $ref: `GreekAlphabetDemo:${name}` }, args, context));
}

beforeAll(() => withInterpretedResolver(() => {
  const encyclopedia = loadFenelModule(ENCYCLOPEDIA, "EncyclopediaDemo");
  const bridge = { ...encyclopedia, nativeImpls: {
    "EncyclopediaDemo:encyclopediaSourceCountries": () => countries,
    "EncyclopediaDemo:encyclopediaTypeFromSet": (base: unknown, constraint: unknown) => setExprAsType(base as FenelType, constraint as SetExpr),
  } };
  registry = createRegistry([stdModule, decidableMembershipModule, bridge, loadFenelModule(SOURCE, "GreekAlphabetDemo")], { dispatchRegistry });
  context = registry.evaluateContext();
  alphabet = call("greekAlphabet") as Letter[];
  characters = call("greekCharacters") as Character[];
}), 60_000);

describe("complete modern Greek base alphabet", () => {
  test("all 24 ordered letters retain the sourced orthographic distinction and both lowercase sigma forms", () => {
    expect(alphabet).toHaveLength(24);
    expect(alphabet.map(letter => letter.order)).toEqual(Array.from({ length: 24 }, (_, index) => index + 1));
    expect(alphabet.map(letter => letter.capital)).toEqual(capitals);
    expect(alphabet.map(letter => letter.small)).toEqual(small);
    expect(alphabet.flatMap(letter => letter.lowercaseForms)).toEqual(lowerForms);
    expect(alphabet.filter(letter => letter.lowercaseForms.length > 1)).toEqual([expect.objectContaining({ name: "Sigma", order: 18, lowercaseForms: ["σ", "ς"] })]);
    expect(alphabet.filter(letter => letter.vowel).map(letter => letter.small)).toEqual(Array.from("αεηιουω"));
    expect(alphabet[10]).toMatchObject({ name: "Lambda", greekName: "λάμδα", unicodeStem: "LAMDA" });
  });

  test("49 glyph rows preserve Unicode17 facts without conflating script, block or alphabet membership", () => {
    expect(characters).toHaveLength(49);
    expect(new Set(characters.map(character => character.glyph)).size).toBe(49);
    expect(characters.filter(character => character.category === "Lu").map(character => character.glyph)).toEqual(capitals);
    expect(characters.filter(character => character.category === "Ll").map(character => character.glyph)).toEqual(lowerForms);
    for (const character of characters) {
      expect(character.scalar).toBe(character.glyph.codePointAt(0)!);
      expect(character.codepoint).toBe(`U+${character.scalar.toString(16).toUpperCase().padStart(4, "0")}`);
      expect(character.script).toBe("Greek");
      expect(character.block).toBe("Greek and Coptic");
      expect(character.release).toBe("Unicode 17.0.0");
      expect(character.source).toBe("https://www.unicode.org/Public/17.0.0/ucd/UnicodeData.txt");
      const letter = alphabet[character.letterOrder - 1]!;
      expect(character.simpleUppercase).toBe(letter.capital);
      expect(character.simpleLowercase).toBe(character.category === "Lu" ? letter.small : character.glyph);
      expect(character.unicodeName).toBe(character.glyph === "ς" ? "GREEK SMALL LETTER FINAL SIGMA"
        : `GREEK ${character.category === "Lu" ? "CAPITAL" : "SMALL"} LETTER ${letter.unicodeStem}`);
    }
    for (const glyph of ["A", "ϕ", "µ", "ά", "Ϝ", ";", "Ώ"]) {
      expect(characters.some(character => character.glyph === glyph)).toBe(false);
    }
    const sources = call("greekAlphabetSources") as { release: string; scope: string; orthography: string; scripts: string; blocks: string; casing: string };
    expect(sources.release).toBe("Unicode 17.0.0");
    expect(sources.orthography).toContain("ebooks.edu.gr");
    expect(sources.scripts).toContain("/17.0.0/ucd/Scripts.txt");
    expect(sources.blocks).toContain("/17.0.0/ucd/Blocks.txt");
    expect(sources.casing).toContain("/17.0.0/ucd/SpecialCasing.txt");
    expect(sources.scope).toContain("not all Greek-script characters");
  });

  test.each([[all, 49, "Α"], [upper, 24, "Α"], [lower, 25, "ς"], [vowels, 14, "α"], [consonants, 35, "Σ"], [finalSigma, 1, "ς"]] as const)(
    "selection %j enumerates %i members and uses exactly those values as its member type", (cut, count, glyph) => {
      const result = call("greekAlphabetExplore", cut, glyph) as Exploration;
      expect(result.count).toBe(count);
      expect(result.characters.map(character => character.glyph)).toEqual(result.glyphs);
      expect(result.selected).toEqual(Just(result.characters.find(character => character.glyph === glyph)!));
      expect(result.membership).toEqual(Just(true));
      expect(result.characterType).toHaveProperty("$refined");
      if (!("$refined" in result.characterType)) throw new Error("Missing finite member type.");
      expect(peelSetExpr(result.characterType.$refined.set)).toEqual({ kind: "SeEnum", values: result.glyphs });
    });

  test("a lowercase glyph or Latin lookalike is refused by the uppercase set and cannot become a selected row", () => {
    for (const glyph of ["α", "ς", "A", "ΑΒ", "ϒ", ""]) {
      const result = call("greekAlphabetExplore", upper, glyph) as Exploration;
      expect(result.selected).toEqual(Nothing);
      expect(result.membership).toEqual(Just(false));
    }
  });

  test.each([
    [upper, "GreekIntersection", vowels, Array.from("ΑΕΗΙΟΥΩ"), "Α", true],
    [upper, "GreekUnion", lower, characters => characters.map(character => character.glyph), "ς", true],
    [all, "GreekDifference", vowels, characters => characters.filter(character => !Array.from("ΑαΕεΗηΙιΟοΥυΩω").includes(character.glyph)).map(character => character.glyph), "α", false],
    [upper, "GreekIntersection", lower, [], "Α", false],
    [lower, "GreekIntersection", finalSigma, ["ς"], "ς", true],
    [lower, "GreekDifference", finalSigma, small, "ς", false],
  ] as Array<[Selection, string, Selection, string[] | ((rows: Character[]) => string[]), string, boolean]>)(
    "existing set operation %j %s %j preserves its exact inhabitants and verdict", (left, operation, right, expected, candidate, admitted) => {
      const result = call("greekAlphabetSets", left, selection(operation), right, candidate) as Exploration;
      const expectedGlyphs = typeof expected === "function" ? expected(characters) : expected;
      expect(result.glyphs).toEqual(expectedGlyphs);
      expect(result.count).toBe(expectedGlyphs.length);
      expect(new Set(result.glyphs).size).toBe(result.count);
      expect(result.membership).toEqual(Just(admitted));
      expect(peelSetExpr(result.constraint)).toHaveProperty("kind", operation === "GreekUnion" ? "SeUnion" : operation === "GreekIntersection" ? "SeIntersect" : "SeDiff");
      if (!("$refined" in result.characterType)) throw new Error("Missing derived finite result type.");
      expect(peelSetExpr(result.characterType.$refined.set)).toEqual({ kind: "SeEnum", values: expectedGlyphs });
    });

  test("the declared dependent choice resolves to the same finite type and existing select plan", () => {
    const field = registry.getFunction("GreekAlphabetDemo:greekAlphabetExplore")!.params[1]!;
    expect(field.name).toBe("character");
    if (!("$el" in field.type)) throw new Error("Missing dependent character type.");
    const dependentPayload = field.type.$el;
    for (const cut of [upper, lower, finalSigma]) {
      const evaluated = withInterpretedResolver(() => evaluateWithTrace(dependentPayload, { selection: cut }, context).result) as FenelType;
      expect(evaluated).toEqual(call("greekLetterType", cut) as FenelType);
      const plan = withInterpretedResolver(() => fieldEditPlan({ field: { ...field, type: evaluated }, value: cut === upper ? "Α" : "ς" }));
      expect(plan.editor.kind).toBe("select");
      if (plan.editor.kind !== "select") throw new Error("The existing member picker was not selected.");
      expect(plan.editor.options.map(option => option.value)).toEqual((call("greekAlphabetExplore", cut, cut === upper ? "Α" : "ς") as Exploration).glyphs);
    }
  });
});

describe("nonempty bounded alphabet text and explicit case mappings", () => {
  test.each([
    [upper, "ΚΟΣΜΟΣ", true], [upper, "Α", true], [lower, "κοσμος", true], [lower, "ς", true],
    [all, "ΑλΦα", true], [vowels, "ΑαΕεΗηΙιΟοΥυΩω", true], [finalSigma, "ςς", true],
    [upper, "ΚΟΣΜΟA", false], [upper, "Αλφα", false], [all, "άλφα", false], [all, "Α\u0301", false],
    [all, "Α Β", false], [all, "Α!", false], [all, "µ", false], [all, "ϕ", false], [all, "😀", false],
    [all, "", false], [upper, "Α".repeat(16), true], [upper, "Α".repeat(17), false],
  ] as const)("selection %j checks %s with the existing sequence judgment", (cut, candidate, admitted) => {
    const result = call("greekAlphabetText", cut, candidate) as TextResult;
    expect(result.candidate).toBe(candidate);
    expect(result.count).toBe(Array.from(candidate).length);
    expect(result.membership).toEqual(Just(admitted));
    expect(result.checks.map(check => check.glyph)).toEqual(Array.from(candidate));
    expect(result.checks.map(check => check.position)).toEqual(Array.from({ length: Array.from(candidate).length }, (_, index) => index + 1));
    expect(result.textType).toEqual(call("greekTextType", cut) as FenelType);
    expect(peelSetExpr(result.constraint)).toHaveProperty("kind", "SePattern");
  });

  test("Latin lookalike refusal locates the same codepoint without changing the submitted text", () => {
    const result = call("greekAlphabetText", upper, "ΚΟΣΜΟA") as TextResult;
    expect(result.firstOutside).toEqual(Just({ $tag: "GreekAlphabetCharacterCheck", position: 6, glyph: "A", membership: Just(false), character: Nothing }));
    expect(result.uppercase).toEqual(Nothing);
    expect(result.lowercase).toEqual(Nothing);
    const lowerFailure = call("greekAlphabetText", upper, "Αλφα") as TextResult;
    expect(lowerFailure.firstOutside).toMatchObject({ $tag: "Just", _0: { position: 2, glyph: "λ", membership: Just(false), character: { $tag: "Just", _0: { glyph: "λ" } } } });
    expect(lowerFailure.uppercase).toEqual(Just("ΑΛΦΑ"));
  });

  test.each([
    ["ΚΟΣΜΟΣ", "ΚΟΣΜΟΣ", "κοσμος"], ["ΟΣ", "ΟΣ", "ος"], ["Σ", "Σ", "σ"], ["ΣΣ", "ΣΣ", "σς"],
    ["ΣΟΣ", "ΣΟΣ", "σος"], ["οσ", "ΟΣ", "οσ"], ["ος", "ΟΣ", "ος"], ["ςΣ", "ΣΣ", "ςς"],
  ] as const)("word %s preserves simple uppercase %s and contextual lowercase %s", (candidate, uppercase, lowercase) => {
    const result = call("greekAlphabetText", all, candidate) as TextResult;
    expect(result.uppercase).toEqual(Just(uppercase));
    expect(result.lowercase).toEqual(Just(lowercase));
    expect(result.firstOutside).toEqual(Nothing);
  });

  test("all source-owned initial calls keep callable values, editable arguments and accepted/refused examples", () => {
    const inputs = call("greekAlphabetDemoStartingInputs") as Array<{ function: { $ref: string }; arguments: unknown[] }>;
    expect(inputs).toHaveLength(5);
    expect(inputs.map(input => input.function)).toEqual([
      { $ref: "GreekAlphabetDemo:greekAlphabetExplore" }, { $ref: "GreekAlphabetDemo:greekAlphabetSets" },
      { $ref: "GreekAlphabetDemo:greekAlphabetText" }, { $ref: "GreekAlphabetDemo:greekAlphabetText" },
      { $ref: "GreekAlphabetDemo:greekLetterType" },
    ]);
    const results = withInterpretedResolver(() => inputs.map(input => invokeCallable(input.function, input.arguments, context)));
    expect(results[0]).toMatchObject({ count: 24, membership: Just(true) });
    expect(results[1]).toMatchObject({ count: 7, membership: Just(true) });
    expect(results[2]).toMatchObject({ membership: Just(true), lowercase: Just("κοσμος") });
    expect(results[3]).toMatchObject({ membership: Just(false) });
    expect(results[4]).toHaveProperty("$refined");
    for (const fn of registry.modules.find(module => module.name === "GreekAlphabetDemo")!.functions!) {
      expect(fn.body, fn.id).toBeDefined();
    }
  });
});
